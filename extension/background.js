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
