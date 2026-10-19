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

// ------------------------------------------------------------ 详情页工作室（0.7.0，Lee 2026-10-19）
// 面板上点“做详情页”：把图先存起来，打开工作室页面，工作室加载后来取。点工具栏上的插件图标也能打开。
const STUDIO_URL = chrome.runtime.getURL("studio/studio.html");
async function openStudio(hash) {
  // 工作室已经开着：让它自己报标签页编号（这样不用申请“读取所有标签页”的权限）
  const here = await new Promise((res) => {
    try { chrome.runtime.sendMessage({ type: "aitutu-studio-where", pending: !!hash }, (r) => { void chrome.runtime.lastError; res(r && r.tabId ? r : null); }); } catch { res(null); }
  });
  if (here) {
    await chrome.tabs.update(here.tabId, { active: true });
    try { await chrome.windows.update(here.windowId, { focused: true }); } catch {}
    return;
  }
  await chrome.tabs.create({ url: STUDIO_URL + (hash ? "#" + hash : "") });
}
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return false;
  if (msg.type === "aitutu-open-studio") {
    (async () => {
      if (Array.isArray(msg.images) && msg.images.length) {
        const old = (await tabStore("readonly", (s) => s.get("studio-pending"))) || [];
        await tabStore("readwrite", (s) => s.put([...old, ...msg.images], "studio-pending"));
      }
      await openStudio(msg.images && msg.images.length ? "import" : "");
      sendResponse({ ok: true });
    })().catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true;
  }
  if (msg.type === "aitutu-studio-take-pending") {
    (async () => {
      const list = (await tabStore("readonly", (s) => s.get("studio-pending"))) || [];
      await tabStore("readwrite", (s) => s.delete("studio-pending"));
      sendResponse({ ok: true, images: list });
    })().catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true;
  }
  return false;
});
chrome.action.onClicked.addListener(() => { openStudio("").catch(() => {}); });
