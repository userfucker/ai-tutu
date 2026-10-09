// 测试“插件后台能不能直接取到 Gemini 生成的原图”（后台有 host_permissions，不受网页的跨域限制）。
// 只回报大小、类型、像素尺寸，不保存图片。
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "aitutu-fetch") return false;
  (async () => {
    try {
      let r;
      try {
        r = await fetch(msg.url, { credentials: "include" });
      } catch {
        r = await fetch(msg.url, { credentials: "omit" });
      }
      const blob = await r.blob();
      let dims = null;
      try {
        const bm = await createImageBitmap(blob);
        dims = `${bm.width}x${bm.height}`;
        bm.close();
      } catch {}
      sendResponse({ ok: r.ok, status: r.status, type: blob.type, size: blob.size, dims });
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  })();
  return true; // 异步回复
});

// 工具栏图标：页面上没出现面板时点一下，手动把探测脚本放进当前标签页；放不进去时在图标上显示原因
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    chrome.action.setBadgeText({ tabId: tab.id, text: "OK" });
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#16a34a" });
    chrome.action.setTitle({ tabId: tab.id, title: "探测脚本已放进页面：" + (tab.url || "") });
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    console.error("[AI图图] 放不进页面：", msg);
    chrome.action.setBadgeText({ tabId: tab.id, text: "ERR" });
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#dc2626" });
    chrome.action.setTitle({ tabId: tab.id, title: "放不进页面：" + msg + "（" + (tab.url || "") + "）" });
  }
});
