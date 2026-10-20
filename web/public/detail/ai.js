/**
 * 详情页工作室 · 找 AI 干活的通道（插件版：网页版 Gemini / Copilot）
 *
 * 所有 AI 任务排成一队，一个一个做，中间随机间隔几秒。
 * 任务发到一个 Gemini / Copilot 标签页里的 content/studio-runner.js 去做（和右侧面板同一套网页操作）。
 * 以后做网页版：把这个文件换成调用 API 的版本，ST.AI.run() 的用法不变，其他代码不用改。
 */
var ST = globalThis.ST || (globalThis.ST = {});

ST.AI = (() => {
  const SITES = {
    gemini: { name: "Gemini", patterns: ["https://gemini.google.com/*"], open: "https://gemini.google.com/app" },
    copilot: { name: "Copilot", patterns: ["https://copilot.com/*", "https://*.copilot.com/*", "https://copilot.microsoft.com/*"], open: "https://copilot.com/" },
  };
  const S = { site: "gemini", gapMin: 8, gapMax: 20, newChat: true, retries: 1, model: "" };
  const queue = [];
  let running = false, paused = false, current = null, tabId = null, winId = null, nextId = 1;
  let status = { kind: "idle", msg: "AI 还没连接（第一次用到时自动打开）" };
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  const setStatus = (kind, msg) => { status = { kind, msg }; emit(); };

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "aitutu-studio-progress" && current && msg.jobId === current.id) {
      current.steps.push(`${((Date.now() - current.t0) / 1000).toFixed(0)}s ${msg.msg}`);
      setStatus(/暂停|等它/.test(msg.msg) ? "warn" : "busy", `${current.label}：${msg.msg}`);
    }
    return false;
  });

  const tabMsg = (id, m) => new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(id, m, (r) => { const e = chrome.runtime.lastError; resolve(e ? { __err: e.message } : r); });
    } catch (e) { resolve({ __err: String(e.message || e) }); }
  });
  const ping = (id) => tabMsg(id, { type: "aitutu-studio-ping" });

  /** 找到（或打开）AI 页面，放在单独的窗口里：标签页被切到后台时网页会暂停，所以不能和工作室在同一个窗口 */
  async function connect() {
    const site = SITES[S.site] || SITES.gemini;
    const me = await chrome.windows.getCurrent();
    if (tabId) {
      try {
        const t = await chrome.tabs.get(tabId);
        if (!site.patterns.some((p) => new RegExp("^" + p.replace(/[.]/g, "\\.").replace(/\*/g, ".*") + "$").test(t.url || ""))) tabId = null;
        else winId = t.windowId;
      } catch { tabId = null; }
    }
    if (!tabId) {
      const tabs = (await chrome.tabs.query({ url: site.patterns })).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
      const t = tabs.find((x) => x.windowId !== me.id) || tabs[0];
      if (t) { tabId = t.id; winId = t.windowId; }
    }
    const geo = () => {
      const W = screen.availWidth || 1400, H = screen.availHeight || 900;
      const w = Math.max(480, Math.round(W * 0.42));
      return { left: (screen.availLeft || 0) + W - w, top: screen.availTop || 0, width: w, height: H };
    };
    if (!tabId) {
      setStatus("busy", `正在打开 ${site.name}（单独的小窗口，放在右边）…`);
      const w = await chrome.windows.create({ url: site.open, focused: false, ...geo() }).catch(() => chrome.windows.create({ url: site.open, focused: false }));
      tabId = w.tabs[0].id; winId = w.id;
    } else if (winId === me.id) {
      // 和工作室在同一个窗口：移到单独的窗口
      const w = await chrome.windows.create({ tabId, focused: false, ...geo() }).catch(() => chrome.windows.create({ tabId, focused: false }));
      winId = w.id;
      setStatus("warn", `已把 ${site.name} 移到右边的单独窗口。做图期间不要最小化、不要挡住它。`);
    }
    // 等页面和插件准备好
    let r = null, reloaded = false;
    for (let i = 0; i < 90; i++) {
      r = await ping(tabId);
      if (r && !r.__err && r.ready) break;
      if (r && r.__err && i === 8 && !reloaded) { reloaded = true; await chrome.tabs.reload(tabId); } // 页面是插件更新前打开的，刷新一下
      await ST.sleep(1000);
    }
    if (!r || r.__err) throw new Error(`${site.name} 页面没有响应。请在那个窗口里登录 ${site.name}，然后再试。`);
    if (!r.ready) throw new Error(`${site.name} 页面上没找到输入框：请在那个窗口里登录，打开对话页面。`);
    return r;
  }

  async function focusAiWindow() {
    if (!winId) await connect();
    await chrome.windows.update(winId, { focused: true, state: "normal" });
  }

  async function prepImages(list) {
    const out = [];
    for (const it of list || []) {
      const blob = it.blob || it;
      const small = it.raw ? blob : await ST.shrink(blob, it.max || 1536);
      out.push({ b64: await ST.blobToB64(small), mime: small.type || "image/jpeg", name: it.name || "图片.jpg" });
    }
    return out;
  }

  async function runJob(j) {
    current = j;
    j.status = "run"; j.t0 = Date.now(); j.steps = [];
    emit();
    const attempts = 1 + (j.kind === "image" ? S.retries : 0);
    let last = null;
    for (let a = 0; a < attempts; a++) {
      if (a) { j.steps.push("—— 重试 ——"); await countdown(Math.max(5, S.gapMin), "重试"); }
      try {
        await connect();
        setStatus("busy", `${j.label}：开始`);
        const images = await prepImages(j.images);
        const r = await tabMsg(tabId, { type: "aitutu-studio-run", job: { id: j.id, kind: j.kind, prompt: j.prompt, images, newChat: j.newChat ?? S.newChat, model: S.model } });
        if (r && r.__err) last = { ok: false, error: "AI 页面断开了（可能刷新或关掉了）：" + r.__err };
        else last = r || { ok: false, error: "AI 页面没有回复" };
      } catch (e) {
        last = { ok: false, error: String(e.message || e), stop: /没有响应|登录|输入框/.test(String(e.message || e)) };
      }
      if (last.ok || last.stop || last.stopped) break;
    }
    j.result = last;
    j.status = last.ok ? "ok" : "fail";
    j.error = last.ok ? "" : last.error || "失败";
    current = null;
    emit();
    return last;
  }

  let stopFlag = false;
  async function countdown(sec, what) {
    for (let t = sec; t > 0; t--) {
      if (stopFlag) return;
      setStatus("busy", `${what}：${t} 秒后继续（还有 ${queue.length} 个任务）`);
      await ST.sleep(1000);
    }
  }

  async function pump() {
    if (running) return;
    running = true;
    stopFlag = false;
    let first = true;
    while (queue.length && !paused && !stopFlag) {
      if (!first) {
        const gap = ST.AI.testGap !== undefined ? ST.AI.testGap : S.gapMin + Math.random() * Math.max(0, S.gapMax - S.gapMin);
        await countdown(Math.round(gap), "间隔");
        if (stopFlag || paused) break;
      }
      first = false;
      const j = queue.shift();
      const r = await runJob(j);
      if (r.ok) j.resolve(r);
      else {
        j.reject(Object.assign(new Error(j.error), { result: r }));
        if (r.stop) { paused = true; setStatus("bad", `已暂停：${j.error}。处理好以后点“继续”。`); break; }
        if (r.stopped) break;
      }
    }
    running = false;
    if (!paused && !stopFlag) setStatus(queue.length ? "warn" : "ok", queue.length ? "已停止" : "AI 任务都做完了");
    emit();
  }

  return {
    S,
    SITES,
    get status() { return status; },
    get queue() { return queue; },
    get current() { return current; },
    get paused() { return paused; },
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    configure(o) { Object.assign(S, o); if (o.site) { tabId = null; winId = null; } emit(); },
    /**
     * 排一个任务。kind = text / image；images = [Blob 或 { blob, name, max }]
     * 返回 Promise：成功给 { ok, text, codes } 或 { ok, b64, mime }，失败抛错（err.result 里有详情）
     */
    run(kind, prompt, images, o = {}) {
      return new Promise((resolve, reject) => {
        const j = { id: `j${nextId++}_${Date.now()}`, kind, prompt, images, label: o.label || (kind === "text" ? "AI 写文字" : "AI 画图"), newChat: o.newChat, status: "wait", steps: [], resolve, reject, group: o.group || "" };
        queue.push(j);
        emit();
        pump();
      });
    },
    resume() { paused = false; pump(); },
    async stop() {
      stopFlag = true;
      paused = false;
      const dropped = queue.splice(0);
      dropped.forEach((j) => { j.status = "fail"; j.error = "已取消"; j.reject(Object.assign(new Error("已取消"), { result: { ok: false, cancelled: true } })); });
      if (tabId) await tabMsg(tabId, { type: "aitutu-studio-stop" });
      setStatus("warn", "已停止");
    },
    focusAiWindow,
    connect,
    ping: async () => (tabId ? ping(tabId) : null),
  };
})();
