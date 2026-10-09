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
