/**
 * 详情页工作室 · 小工具：编号、转义、图片读写、JSON 提取、单位换算、zip 读写、北京时间。
 */
var ST = globalThis.ST || (globalThis.ST = {});

ST.uid = (p = "") => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
ST.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
ST.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ST.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
ST.clone = (o) => (typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

/** 北京时间 2026-10-19 12:30 */
ST.bj = (ms = Date.now(), sec = false) => {
  const d = new Date(ms + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}${sec ? ":" + p(d.getUTCSeconds()) : ""}`;
};
ST.stamp = () => ST.bj().replace(/[-: ]/g, "").slice(0, 12);
ST.safeName = (s, max = 40) => String(s || "未命名").replace(/[\\/:*?"<>|\r\n\t]+/g, " ").trim().slice(0, max) || "未命名";

// ---------------------------------------------------------------- 图片
ST.loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("图片打不开"));
  img.src = src;
});
ST.blobToImage = async (blob) => {
  const url = URL.createObjectURL(blob);
  try { return await ST.loadImage(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
};
ST.canvas = (w, h) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};
ST.toBlob = (c, type = "image/png", q = 0.92) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("图片导出失败"))), type, q));
ST.blobToB64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1]);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});
ST.b64ToBlob = (b64, type = "image/png") => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
};
/** 缩小到长边不超过 max，返回 JPEG Blob（发给 AI 的参考图用，省流量） */
ST.shrink = async (blob, max = 1024, type = "image/jpeg", bg = "#ffffff") => {
  const img = await ST.blobToImage(blob);
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = ST.canvas(img.naturalWidth * s, img.naturalHeight * s);
  const g = c.getContext("2d");
  if (type === "image/jpeg") { g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); }
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, c.width, c.height);
  return ST.toBlob(c, type, 0.9);
};
/** 透明图里不透明部分的外框（产品摆放时按产品本身的大小来放，不按整张图） */
ST.alphaBox = (img) => {
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const s = Math.min(1, 400 / Math.max(W, H));
  const c = ST.canvas(W * s, H * s);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (d[(y * c.width + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return { x: 0, y: 0, w: W, h: H };
  const pad = 1;
  return { x: Math.max(0, (x0 - pad) / s), y: Math.max(0, (y0 - pad) / s), w: Math.min(W, (x1 - x0 + 1 + 2 * pad) / s), h: Math.min(H, (y1 - y0 + 1 + 2 * pad) / s) };
};
/** 四周一圈是不是基本纯白（是的话可以不用 AI，直接去白底） */
ST.edgeIsWhite = (img) => {
  const W = img.naturalWidth, H = img.naturalHeight;
  const s = Math.min(1, 200 / Math.max(W, H));
  const c = ST.canvas(W * s, H * s);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let n = 0, white = 0;
  const at = (x, y) => { const i = (y * c.width + x) * 4; n++; if (Math.min(d[i], d[i + 1], d[i + 2]) >= 238 && d[i + 3] > 200) white++; };
  for (let x = 0; x < c.width; x++) { at(x, 0); at(x, c.height - 1); }
  for (let y = 0; y < c.height; y++) { at(0, y); at(c.width - 1, y); }
  return white / n > 0.92;
};
/** 3×3 锐化（图片放大以后用一点，减少发虚） */
ST.sharpen = (g, W, H, amount = 0.5) => {
  const im = g.getImageData(0, 0, W, H);
  const s = im.data, o = new Uint8ClampedArray(s);
  const k = amount;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) {
      const v = s[i + c] * (1 + 4 * k) - k * (s[i - 4 + c] + s[i + 4 + c] + s[i - W * 4 + c] + s[i + W * 4 + c]);
      o[i + c] = v;
    }
  }
  im.data.set(o);
  g.putImageData(im, 0, 0);
};

// ---------------------------------------------------------------- 从 AI 的回复里取 JSON
/** 回复里可能有说明文字、代码块、“复制代码”按钮文字，找第一个完整的 {…} 或 […] */
ST.extractJson = (text, codes = []) => {
  const tryParse = (s) => {
    if (!s) return undefined;
    const start = s.search(/[{[]/);
    if (start < 0) return undefined;
    // 括号配对，跳过字符串里的括号
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") { depth--; if (depth === 0) { end = i; break; } }
    }
    const body = s.slice(start, end < 0 ? s.length : end + 1);
    for (const fix of [(x) => x, (x) => x.replace(/,\s*([}\]])/g, "$1"), (x) => x.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, "$1")]) {
      try { return JSON.parse(fix(body)); } catch {}
    }
    return undefined;
  };
  for (const c of codes) { const v = tryParse(c); if (v !== undefined) return v; }
  const v = tryParse(text);
  if (v !== undefined) return v;
  throw new Error("AI 的回复里没找到能用的 JSON：" + String(text || "").slice(0, 120));
};

// ---------------------------------------------------------------- 单位换算
// mode：metric 公制 / imperial 英制 / both 都显示（如 45 cm (17.7 in)）
ST.convertUnits = (text, mode) => {
  if (!text || mode === "metric") return text;
  const num = (v) => {
    const r = v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100;
    return String(r);
  };
  const U = {
    mm: [0.0393701, "in"], cm: [0.393701, "in"], m: [3.28084, "ft"], kg: [2.20462, "lb"], g: [0.035274, "oz"],
    ml: [0.033814, "fl oz"], l: [0.264172, "gal"], L: [0.264172, "gal"],
  };
  // 支持 45×30×15cm、45 x 30 x 15 cm、0.9kg、500ml
  return String(text).replace(/(\d+(?:\.\d+)?(?:\s*[×xX*]\s*\d+(?:\.\d+)?)*)\s*(mm|cm|kg|ml|m|g|L|l)(?![a-zA-Z])/g, (all, nums, unit) => {
    const u = U[unit];
    if (!u) return all;
    const conv = nums.split(/\s*[×xX*]\s*/).map((n) => num(parseFloat(n) * u[0])).join(" × ");
    const imp = `${conv} ${u[1]}`;
    return mode === "imperial" ? imp : `${all} (${imp})`;
  });
};

// ---------------------------------------------------------------- zip
/** 打包（不压缩）。files = [{ name, blob }] */
ST.makeZip = async (files) => {
  if (typeof makeZip === "function") return makeZip(files); // imagekit.js 里的同一份
  throw new Error("缺少 makeZip");
};
/** 读 zip：支持不压缩和 deflate（淘宝采集插件导出的 zip 是不压缩的）。返回 [{ name, blob }] */
ST.readZip = async (blob) => {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer);
  // 找中央目录结尾
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("不是 zip 文件");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    const lNameLen = dv.getUint16(local + 26, true), lExtraLen = dv.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    else continue;
    out.push({ name, blob: new Blob([data], { type: ST.mimeOf(name) }) });
  }
  return out;
};
ST.mimeOf = (name) => {
  const ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1]?.toLowerCase();
  return { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", json: "application/json", txt: "text/plain", html: "text/html" }[ext] || "application/octet-stream";
};
ST.isImageName = (n) => /\.(jpe?g|png|webp|gif|bmp)$/i.test(n);
