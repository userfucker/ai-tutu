/**
 * AI图图 · 各网站共用的小工具（2026-10-09）：等待、插件后台取图、取回生成的原图。
 * gemini.js / copilot.js 都先加载这个文件（manifest 里的顺序）。
 */
const siteSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 等 fn() 返回真值；超时抛错。signal.aborted 时抛 "已停止"。 */
async function siteWait(fn, { timeout = 30000, interval = 250, signal, what = "条件" } = {}) {
  const t0 = Date.now();
  for (;;) {
    if (signal && signal.aborted) throw new Error("已停止");
    const v = fn();
    if (v) return v;
    if (timeout && Date.now() - t0 > timeout) throw new Error(`等待超时：${what}`);
    await siteSleep(interval);
  }
}


/**
 * 取回生成的原图。
 *  - blob: / data: 地址（3.8 Flash 实测是 blob:）：网页里直接 fetch。
 *  - https: 地址（3.1 Pro 实测出的图是网络地址，在 googleusercontent 上）：网页里 fetch 会被跨域挡住，
 *    画到画布上也导不出来（“Tainted canvases”），所以交给插件后台去取（后台有这些网站的权限）。
 *    googleusercontent 的地址结尾带尺寸参数（如 =s1024-rj），先试 =s0（原始尺寸），不行再用页面上的地址。
 */
function siteBgFetch(url) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "aitutu-fetch-image", url }, (res) => {
        if (chrome.runtime.lastError || !res || !res.ok) return resolve({ error: (res && res.error) || chrome.runtime.lastError?.message || "后台没有回复" });
        const bin = atob(res.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        resolve({ blob: new Blob([bytes], { type: res.type || "image/png" }) });
      });
    } catch (e) {
      resolve({ error: String(e.message || e) });
    }
  });
}
async function siteIsImage(blob) {
  if (!blob || blob.size < 1000) return false;
  try { const bm = await createImageBitmap(blob); bm.close(); return true; } catch { return false; }
}
async function siteGrabImage(img, fullSizeUrls = (src) => [src], aiName = "AI") {
  const src = img.currentSrc || img.src;
  const errors = [];
  if (/^https?:/.test(src)) {
    for (const url of fullSizeUrls(src)) {
      const r = await siteBgFetch(url);
      if (r.blob && (await siteIsImage(r.blob))) return r.blob;
      errors.push(`后台取图：${r.error || "拿到的不是图片"}`);
    }
  }
  try {
    const r = await fetch(src, { credentials: "include" });
    const b = await r.blob();
    if (await siteIsImage(b)) return b;
    errors.push(`网页取图：HTTP ${r.status}，${b.size} 字节`);
  } catch (e) {
    errors.push(`网页取图：${e.message || e}`);
  }
  try {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    return await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("画布导出为空"))), "image/png"));
  } catch (e) {
    errors.push(`画布取图：${e.message || e}`);
  }
  const kind = src.startsWith("blob:") ? "blob" : src.split("/")[2] || src.slice(0, 20);
  throw new Error(`取不到 ${aiName} 生成的图（图片地址类型：${kind}）。${errors.join("；")}`);
}

