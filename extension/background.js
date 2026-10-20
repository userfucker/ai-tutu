// AI图图插件后台：替页面去取 Gemini 生成的图片。
// 3.1 Pro 出的图是 googleusercontent 上的网络地址，网页里取会被跨域挡住，后台有 host_permissions，不受限制。
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "aitutu-fetch-image") return false;
  (async () => {
    try {
      let r;
      try {
        r = await fetch(msg.url, { credentials: "include" });
      } catch {
        r = await fetch(msg.url, { credentials: "omit" });
      }
      if (!r.ok) return sendResponse({ ok: false, error: `HTTP ${r.status}` });
      const buf = new Uint8Array(await r.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      sendResponse({ ok: true, type: r.headers.get("content-type") || "", size: buf.length, b64: btoa(bin) });
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  })();
  return true; // 异步回复
});

// ------------------------------------------------------------ 每个标签页的产品图和结果（Lee 2026-10-10）
// 刷新页面、点了网页里的东西导致页面重载时，面板里已上传的图片和做好的结果都还在；
// 关掉这个标签页、或者关掉浏览器再打开，就清空。数据放在插件自己的 IndexedDB 里，按标签页编号存。
const tabDb = new Promise((resolve, reject) => {
  const req = indexedDB.open("aitutu", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("tabs");
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
async function tabStore(mode, fn) {
  const db = await tabDb;
  return new Promise((resolve, reject) => {
    const tx = db.transaction("tabs", mode);
    const r = fn(tx.objectStore("tabs"));
    tx.oncomplete = () => resolve(r && r.result);
    tx.onerror = () => reject(tx.error);
  });
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !sender.tab || (msg.type !== "aitutu-tab-save" && msg.type !== "aitutu-tab-load")) return false;
  const key = sender.tab.id;
  (async () => {
    try {
      if (msg.type === "aitutu-tab-save") {
        await tabStore("readwrite", (s) => s.put(msg.data, key));
        sendResponse({ ok: true });
      } else {
        const data = await tabStore("readonly", (s) => s.get(key));
        sendResponse({ ok: true, data: data || null });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  })();
  return true;
});
chrome.tabs.onRemoved.addListener((tabId) => { tabStore("readwrite", (s) => s.delete(tabId)).catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { tabStore("readwrite", (s) => s.clear()).catch(() => {}); }); // 浏览器重新打开：全部清空

// ------------------------------------------------------------ 淘宝采集插件联动（0.5.1，Lee 2026-10-11）
// 淘宝采集插件（固定插件 ID）在商品图上右键"发送到 Gemini / Copilot"，图片发到这里：
// 找到已打开的 Gemini / Copilot 标签页（没有就新开一个），交给那个页面的面板 addFiles()。
// 只收淘宝采集插件发来的消息。AI图图 自己的 ID 随安装位置变化，所以由这里主动告诉淘宝插件。
const WT_TAOBAO_ID = "oaofinkgflgmbcpohpdmjinnomfenkjf";
const WT_SITES = {
  gemini: { patterns: ["https://gemini.google.com/*"], open: "https://gemini.google.com/app" },
  copilot: { patterns: ["https://copilot.com/*", "https://*.copilot.com/*", "https://copilot.microsoft.com/*"], open: "https://copilot.com/" },
};
function wtHello() {
  try { chrome.runtime.sendMessage(WT_TAOBAO_ID, { type: "wt-hello", app: "aitutu" }, () => void chrome.runtime.lastError); } catch {}
}
chrome.runtime.onInstalled.addListener(wtHello);
chrome.runtime.onStartup.addListener(wtHello);
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "aitutu-wt-hello") wtHello(); // 面板每次加载时也报一次（淘宝插件后装的情况）
  return false;
});
async function wtDeliver(msg) {
  const site = WT_SITES[msg.target];
  if (!site) return { ok: false, error: "未知目标" };
  const tabs = await chrome.tabs.query({ url: site.patterns });
  let tab = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  let created = false;
  if (!tab) {
    tab = await chrome.tabs.create({ url: site.open, active: !!msg.switchTab });
    created = true;
  }
  // 新开的页面要等面板加载好；已有页面一般第一次就成功
  let resp = null;
  for (let i = 0; i < 60 && !resp; i++) {
    try {
      resp = await chrome.tabs.sendMessage(tab.id, { type: "aitutu-import-files", images: msg.images });
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (!resp) return { ok: false, error: "AI图图 面板没有响应，请刷新 Gemini / Copilot 页面后再试" };
  if (msg.switchTab) {
    try { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); } catch {}
  }
  return { ok: !!resp.ok, added: resp.added || 0, created, error: resp.error };
}
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (sender.id !== WT_TAOBAO_ID || !msg) return false;
  if (msg.type === "aitutu-ping") { sendResponse({ ok: true }); return false; }
  if (msg.type !== "aitutu-import" || !Array.isArray(msg.images)) return false;
  wtDeliver(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
  return true;
});

// ------------------------------------------------------------ 连接 AI图图 工作台（网页版，0.8.0，Lee 2026-10-20）
// 工作台把“写文字 / 看图 / 画图”的任务发过来，这里转给 Gemini / Copilot 页面里的 content/workbench-runner.js 去做。
// 协议和 ai-web 插件一样（WebSocket：hello / cmd / result / progress），hello 里带 app: "aitutu"。
// 每个网站用一个单独的窗口（和别的标签页放一起时，切到后台会被浏览器暂停）。在插件“选项”里填工作台 IP、端口、口令。
const AWB = { ws: null, state: "off", error: "", retry: 0, timer: null, ping: null, tabs: {}, jobs: new Map() };
const AWB_VERSION = chrome.runtime.getManifest().version;
async function awbConf() {
  const v = await chrome.storage.local.get("aitutu_wb");
  return { enabled: false, host: "", port: 8766, token: "", name: "", ...(v.aitutu_wb || {}) };
}
function awbSetState(state, error = "") {
  AWB.state = state;
  AWB.error = error;
  chrome.storage.local.set({ aitutu_wb_state: { state, error, t: Date.now() } });
}
const awbSend = (m) => { try { if (AWB.ws && AWB.ws.readyState === 1) AWB.ws.send(JSON.stringify(m)); } catch {} };
const awbMatch = (site, url) => WT_SITES[site].patterns.some((p) => new RegExp("^" + p.replace(/[.]/g, "\\.").replace(/\*/g, ".*") + "$").test(url || ""));
async function awbTabOf(site) {
  const id = AWB.tabs[site];
  if (!id) return null;
  const t = await chrome.tabs.get(id).catch(() => null);
  return t && awbMatch(site, t.url) ? t : null;
}
async function awbSites() {
  const out = [];
  for (const site of ["gemini", "copilot"]) {
    const t = await awbTabOf(site);
    let ready = false;
    if (t) { const r = await chrome.tabs.sendMessage(t.id, { type: "aitutu-wb-ping" }).catch(() => null); ready = !!(r && r.ready); }
    out.push({ site, name: site === "gemini" ? "Gemini" : "Copilot", open: !!t, ready });
  }
  return out;
}
async function awbConnect() {
  const c = await awbConf();
  clearTimeout(AWB.timer);
  if (!c.enabled || !c.host || !c.token) { awbClose(); awbSetState("off", c.enabled ? "还没填 IP 和口令" : ""); return; }
  if (AWB.ws && (AWB.ws.readyState === 0 || AWB.ws.readyState === 1)) return;
  let ws;
  try { ws = new WebSocket(`ws://${c.host}:${c.port || 8766}/ext`); } catch (e) { awbSetState("error", String(e.message || e)); return awbRetry(); }
  AWB.ws = ws;
  awbSetState("connecting");
  ws.onopen = async () => ws.send(JSON.stringify({ type: "hello", app: "aitutu", role: "extension", token: c.token, name: c.name || "AI图图", version: AWB_VERSION, sites: await awbSites() }));
  ws.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === "welcome") { AWB.retry = 0; awbSetState("on"); clearInterval(AWB.ping); AWB.ping = setInterval(() => awbSend({ type: "ping", t: Date.now() }), 20000); return; }
    if (m.type === "error") { awbSetState("error", m.error || "工作台拒绝连接"); if (m.fatal) AWB.retry = 99; return; }
    if (m.type === "ping") { awbSend({ type: "pong", t: m.t }); return; }
    if (m.type === "cmd") awbHandle(m);
  };
  ws.onclose = () => {
    clearInterval(AWB.ping);
    if (AWB.ws === ws) AWB.ws = null;
    if (AWB.state !== "error") awbSetState("off", "连接断开，稍后自动重连");
    awbRetry();
  };
  ws.onerror = () => {};
}
function awbRetry() {
  if (AWB.retry >= 99) return;
  const sec = Math.min(30, 2 ** AWB.retry++);
  clearTimeout(AWB.timer);
  AWB.timer = setTimeout(awbConnect, sec * 1000);
}
function awbClose() { clearInterval(AWB.ping); clearTimeout(AWB.timer); if (AWB.ws) { const w = AWB.ws; AWB.ws = null; try { w.close(); } catch {} } }

/** 找到（或新开）这个网站的单独窗口，等页面和插件准备好 */
async function awbEnsure(site, progress) {
  let t = await awbTabOf(site);
  if (!t) {
    // 已经开着这个网站、而且那个窗口里只有它一个标签页：直接用
    const tabs = await chrome.tabs.query({ url: WT_SITES[site].patterns });
    for (const x of tabs) { const w = await chrome.windows.get(x.windowId, { populate: true }).catch(() => null); if (w && w.tabs.length === 1) { t = x; break; } }
    if (!t) {
      progress(`打开 ${site === "gemini" ? "Gemini" : "Copilot"}（单独的窗口）`);
      const w = await chrome.windows.create({ url: "about:blank", focused: false, width: 1000, height: 900 });
      t = w.tabs[0];
      await chrome.tabs.update(t.id, { url: WT_SITES[site].open });
    }
    AWB.tabs[site] = t.id;
    chrome.storage.session && chrome.storage.session.set({ aitutu_wb_tabs: AWB.tabs });
  }
  let r = null;
  for (let i = 0; i < 90; i++) {
    r = await chrome.tabs.sendMessage(t.id, { type: "aitutu-wb-ping" }).catch(() => null);
    if (r && r.ready) return t;
    if (i === 10 && !r) { await chrome.tabs.reload(t.id).catch(() => {}); } // 页面是插件更新前打开的：刷新一下
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw Object.assign(new Error(r ? `${site === "gemini" ? "Gemini" : "Copilot"} 页面上没找到输入框：请在那个窗口里登录，打开对话页面` : "AI 页面没有响应，请刷新那个窗口"), { stop: true });
}

async function awbHandle(m) {
  const reply = (ok, data) => awbSend({ type: "result", id: m.id, site: m.site, cmd: m.cmd, ok, data });
  const progress = (msg) => awbSend({ type: "progress", id: m.id, site: m.site, msg });
  try {
    if (m.cmd === "status") return reply(true, { version: AWB_VERSION, sites: await awbSites() });
    if (!WT_SITES[m.site]) return reply(false, { error: "不支持的网站：" + m.site });
    if (m.cmd === "open") { await awbEnsure(m.site, progress); awbSend({ type: "event", event: "sites", sites: await awbSites() }); return reply(true, {}); }
    if (m.cmd === "stop") { const t = await awbTabOf(m.site); if (t) await chrome.tabs.sendMessage(t.id, { type: "aitutu-wb-stop" }).catch(() => {}); return reply(true, {}); }
    if (m.cmd !== "run") return reply(false, { error: "不支持的命令：" + m.cmd });
    const t = await awbEnsure(m.site, progress);
    AWB.jobs.set(m.id, progress);
    const r = await chrome.tabs.sendMessage(t.id, { type: "aitutu-wb-run", job: { id: m.id, ...m.args } }).catch((e) => ({ ok: false, error: "AI 页面断开了：" + (e && e.message) }));
    AWB.jobs.delete(m.id);
    awbSend({ type: "event", event: "sites", sites: await awbSites() });
    if (r && r.ok) return reply(true, { text: r.text || "", codes: r.codes || [], b64: r.b64, mime: r.mime, model: r.model || "" });
    return reply(false, { error: (r && r.error) || "失败", limit: !!(r && r.limit), refused: !!(r && r.refused) });
  } catch (e) {
    AWB.jobs.delete(m.id);
    reply(false, { error: String((e && e.message) || e) });
  }
}
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "aitutu-wb-progress" && AWB.jobs.has(msg.jobId)) AWB.jobs.get(msg.jobId)(msg.msg);
  return false;
});
chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg && msg.type === "aitutu-wb-test") {
    const ws = new WebSocket(`ws://${msg.host}:${msg.port || 8766}/ext`);
    const done = (r) => { try { ws.close(); } catch {} sendResponse(r); };
    const timer = setTimeout(() => done({ ok: false, error: "连不上（检查 IP、端口，工作台有没有启动）" }), 6000);
    ws.onopen = () => ws.send(JSON.stringify({ type: "hello", app: "aitutu", token: msg.token, test: true, name: "test", version: AWB_VERSION, sites: [] }));
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); clearTimeout(timer); done(m.type === "welcome" ? { ok: true, server: m.server } : { ok: false, error: m.error || "工作台拒绝连接" }); };
    ws.onerror = () => { clearTimeout(timer); done({ ok: false, error: "连不上（检查 IP、端口，工作台有没有启动）" }); };
    return true;
  }
  return false;
});
chrome.storage.onChanged.addListener((ch) => { if (ch.aitutu_wb) { AWB.retry = 0; awbClose(); awbConnect(); } });
chrome.runtime.onStartup.addListener(awbConnect);
chrome.runtime.onInstalled.addListener(awbConnect);
chrome.alarms.create("aitutu-wb", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "aitutu-wb") awbConnect(); });
(chrome.storage.session ? chrome.storage.session.get("aitutu_wb_tabs") : Promise.resolve({})).then((v) => { if (v && v.aitutu_wb_tabs) AWB.tabs = v.aitutu_wb_tabs; }).finally(awbConnect);
