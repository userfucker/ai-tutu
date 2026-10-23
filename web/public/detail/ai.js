/**
 * 详情页 · 找 AI 干活的通道（网页版）：任务交给工作台服务器排队，由连上工作台的插件（AI图图 / ai-web）去做。
 * 用法和插件版一样：ST.AI.run(kind, prompt, images, { label }) 返回 Promise。
 * 关掉网页，已经排进去的任务服务器还会做完（结果在“任务中心”里），但这个页面就拿不到结果了；要不怕关网页，用“一键全自动”。
 */
var ST = globalThis.ST || (globalThis.ST = {});

ST.AI = (() => {
  const S = { site: "workbench" };
  const SITES = { workbench: { name: "工作台" } };
  const queue = []; // 还没做完的任务（排队 + 进行中）
  let status = { kind: "idle", msg: "AI 由连上工作台的插件来做" };
  let workers = null; // 能干活的插件（null = 还不知道）
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  const setStatus = (kind, msg) => { status = { kind, msg }; emit(); };

  const api = async (method, url, body) => {
    const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
    let d = null;
    try { d = await r.json(); } catch {}
    if (r.status === 401) { location.href = "/"; throw new Error("请先登录"); }
    if (!r.ok) throw new Error((d && d.error) || `出错了（${r.status}）`);
    return d;
  };

  async function refreshWorkers() {
    try {
      const st = await api("GET", "/api/status");
      workers = (st.workers || []).filter((w) => w.app === "aitutu" || w.app === "aiweb" || !w.app);
      const img = workers.some((w) => w.app === "aitutu");
      if (!queue.length) {
        if (!workers.length) setStatus("bad", "没有 AI 插件连上工作台：在插件设置里填工作台地址和口令（见工作台“AI 连接”）");
        else setStatus(img ? "ok" : "warn", img ? `AI 已连接：${workers.map((w) => w.name).join("、")}` : "只连了 ai-web（只能写文字）；画背景、抠图要 AI图图 插件连上工作台");
      }
    } catch {}
  }
  refreshWorkers();
  setInterval(refreshWorkers, 15000);

  async function prepImages(list) {
    const out = [];
    for (const it of list || []) {
      const blob = it.blob || it;
      if (!blob) continue;
      const small = it.raw ? blob : await ST.shrink(blob, it.max || 1536);
      out.push({ b64: await ST.blobToB64(small), mime: small.type || "image/jpeg", name: it.name || "图片.jpg" });
    }
    return out;
  }
  const cancelled = () => Object.assign(new Error("已取消"), { result: { ok: false, cancelled: true } });

  async function runJob(j) {
    const images = await prepImages(j.images);
    if (j.cancelled) throw cancelled();
    const kind = j.kind === "text" && images.length ? "vision" : j.kind;
    const r = await api("POST", "/api/tasks", { kind, prompt: j.prompt, images, label: j.label, role: j.role, sites: j.sites, rotate: j.rotate, ownerType: "project", ownerId: (globalThis.APP && APP.project && APP.project.id) || "" });
    j.taskId = r.id;
    emit();
    for (;;) {
      await ST.sleep(1200);
      const d = await api("GET", `/api/tasks/${j.taskId}/result`).catch(() => null);
      if (!d || !d.task) continue;
      const t = d.task;
      const st = t.status === "running" ? "run" : t.status === "queued" ? "wait" : j.status;
      if (st !== j.status || (t.progress && t.progress !== j.steps[j.steps.length - 1])) {
        j.status = st;
        if (t.progress && t.progress !== j.steps[j.steps.length - 1]) j.steps.push(t.progress);
        setStatus("busy", `${j.label}：${t.progress || (st === "run" ? "进行中" : "排队中")}`);
      }
      if (t.status === "done") {
        const res = d.result || {};
        if (j.kind === "image") {
          const f = await fetch("/api/files/" + res.file, { credentials: "same-origin" });
          if (!f.ok) throw new Error("取画好的图失败");
          const blob = await f.blob();
          return { ok: true, blob, mime: blob.type || res.mime };
        }
        return { ok: true, text: res.text || "", codes: res.codes || [] };
      }
      if (t.status === "cancelled") throw cancelled();
      if (t.status === "failed") throw Object.assign(new Error(t.error || "失败"), { result: { ok: false, error: t.error } });
    }
  }

  return {
    S, SITES,
    get status() { return status; },
    get queue() { return queue.filter((j) => j.status === "wait"); },
    get current() { return queue.find((j) => j.status === "run") || null; },
    get running() { return queue.slice(); },
    get paused() { return false; },
    get workers() { return workers; },
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    configure() {},
    /**
     * 排一个任务。kind = text / image；images = [Blob 或 { blob, name, max }]
     * o.role = “AI 分工”里的模块（dt_angle …），o.sites = 只用这些网站，o.rotate = 一批任务里的第几个（轮流分给不同网站）
     * 成功给 { ok, text, codes } 或 { ok, blob, mime }，失败抛错（err.result 里有详情）
     */
    async run(kind, prompt, images, o = {}) {
      const j = { kind, prompt, images, label: o.label || (kind === "text" ? "AI 写文字" : "AI 画图"), role: o.role, sites: o.sites, rotate: o.rotate, status: "wait", steps: [], t0: Date.now() };
      queue.push(j);
      emit();
      try {
        const r = await runJob(j);
        j.status = "ok";
        return r;
      } catch (e) {
        j.status = "fail";
        j.error = e.message;
        throw e.result ? e : Object.assign(e, { result: { ok: false, error: e.message } });
      } finally {
        queue.splice(queue.indexOf(j), 1);
        if (globalThis.APP && APP.aiHistory) APP.aiHistory.push(j);
        if (!queue.length) refreshWorkers();
        emit();
      }
    },
    resume() {},
    async stop() {
      for (const j of queue) {
        j.cancelled = true;
        if (j.taskId) await api("POST", `/api/tasks/${j.taskId}/cancel`).catch(() => {});
      }
      setStatus("warn", "已停止");
    },
    focusAiWindow: async () => { window.open("/#/connect", "_blank"); },
    refreshWorkers,
  };
})();
