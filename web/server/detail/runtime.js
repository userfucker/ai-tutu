/**
 * 详情页：在服务器上运行网页里的同一套排版代码（public/detail/core + extension/lib/imagekit.js）。
 * 全自动用它来抠图、排版、检查、导出，浏览器关了也能做。
 *
 * 做法：把这些脚本放进一个单独的 vm 环境，补上浏览器才有的东西（document.createElement("canvas")、Image、toBlob），
 * 画布用 @napi-rs/canvas，字体用 web/fonts 里的 Noto（和网页同一套），图片和项目直接读写服务器的存储。
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createCanvas, Image, ImageData, GlobalFonts } from "@napi-rs/canvas";
import { PUBLIC_DIR, REPO_DIR, FONT_DIR } from "../config.js";
import * as store from "./store.js";

// 字体：文件名 → 字体名（和 ST.FONTS 里写的一样）
const FAMILIES = { NotoSans: "Noto Sans", NotoSansSC: "Noto Sans SC", NotoSansTC: "Noto Sans TC", NotoSansJP: "Noto Sans JP", NotoSansKR: "Noto Sans KR", NotoSansArabic: "Noto Sans Arabic", NotoSansThai: "Noto Sans Thai", NotoSerif: "Noto Serif", NotoSerifSC: "Noto Serif SC" };
let fontsDone = false;
function loadFonts() {
  if (fontsDone) return;
  fontsDone = true;
  if (!fs.existsSync(FONT_DIR)) return;
  for (const f of fs.readdirSync(FONT_DIR)) {
    const m = /^(\w+)-(\d+)\.woff2$/.exec(f);
    if (m && FAMILIES[m[1]]) GlobalFonts.registerFromPath(path.join(FONT_DIR, f), FAMILIES[m[1]]);
  }
}

const MIME = { png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", webp: "image/webp" };
/** 画布：补上 toBlob（浏览器的写法） */
function makeCanvas(w = 300, h = 150) {
  const c = createCanvas(Math.max(1, w), Math.max(1, h));
  c.toBlob = (cb, type = "image/png", q = 0.92) => {
    try {
      const t = /jpe?g/.test(type) ? "image/jpeg" : /webp/.test(type) ? "image/webp" : "image/png";
      const buf = t === "image/png" ? c.toBuffer(t) : c.toBuffer(t, Math.round((q || 0.92) * 100));
      setImmediate(() => cb(new Blob([buf], { type: t })));
    } catch (e) { setImmediate(() => cb(null)); }
  };
  c.style = {};
  return c;
}
/** 解码图片（napi 的 Image 是异步解码的，要等 onload，不然画出来是空的） */
const bufToImage = (buf) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("图片打不开"));
  img.src = buf;
});

const FILES = [
  ["extension/lib/imagekit.js", REPO_DIR],
  ...["data", "util", "store", "text", "icons", "templates", "render", "prompts", "check", "export", "refsplit", "harmony", "mainimg"].map((n) => [`detail/core/${n}.js`, PUBLIC_DIR]),
];

let ctx = null;
/** 拿到服务器上的 ST（第一次调用时加载） */
export function getST() {
  if (ctx) return ctx.ST;
  loadFonts();
  const sandbox = {
    console, setTimeout, clearTimeout, setImmediate, queueMicrotask, structuredClone, atob, btoa,
    Blob, Response, TextDecoder, TextEncoder, DecompressionStream, CompressionStream, URL, performance,
    Image, ImageData,
    document: { createElement: (t) => (t === "canvas" ? makeCanvas() : {}), fonts: null },
    navigator: { language: "zh-CN" },
    screen: { availWidth: 1400, availHeight: 900 },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  ctx = vm.createContext(sandbox);
  for (const [rel, base] of FILES) {
    const file = path.join(base, rel);
    vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  }
  const ST = ctx.ST;
  // 存取：直接读写服务器存储
  ST.db = {
    getProject: async (id) => store.getProject(id),
    putProject: async (p) => store.putProject(p),
    listProjects: async () => store.listProjects(),
    deleteProject: async (id) => store.deleteProject(id),
    putBlob: async (key, blob) => store.putBlob(key, Buffer.from(await blob.arrayBuffer()), blob.type),
    getBlob: async (key) => { const b = key && store.getBlob(key); return b ? new Blob([b.buf], { type: b.type }) : null; },
    delBlob: async (key) => store.delBlob(key),
    blobKeys: async (prefix) => store.blobKeys(prefix),
    getMeta: async (k, def) => store.getMeta(k, def),
    setMeta: async (k, v) => store.setMeta(k, v),
  };
  // 图片：从存储读，解码成 napi 的 Image（缓存按“键名 + 文件修改时间”）
  const cache = new Map();
  ST.imgOf = async (key) => {
    if (!key) return null;
    const b = store.getBlob(key);
    if (!b) return null;
    const mt = fs.statSync(b.file).mtimeMs;
    const c = cache.get(key);
    if (c && c.mt === mt) return c.img;
    try {
      const img = await bufToImage(b.buf);
      cache.set(key, { mt, img });
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      return img;
    } catch { return null; }
  };
  ST.forget = (key) => cache.delete(key);
  ST.urlOf = async (key) => key;
  ST.saveImage = async (key, blob) => { cache.delete(key); await ST.db.putBlob(key, blob); return key; };
  ST.loadImage = async (src) => { throw new Error("服务器上不能按网址读图：" + String(src).slice(0, 60)); };
  ST.blobToImage = async (blob) => bufToImage(Buffer.from(await blob.arrayBuffer()));
  ST.blobToB64 = async (blob) => Buffer.from(await blob.arrayBuffer()).toString("base64");
  ST.b64ToBlob = (b64, type = "image/png") => new Blob([Buffer.from(b64, "base64")], { type });
  return ST;
}
/** imagekit.js 里的函数（composeOutput、closestAiRatio …） */
export function kit(name) { getST(); return ctx[name] || vm.runInContext(`typeof ${name} === "undefined" ? undefined : ${name}`, ctx); }
export const mimeOf = (name) => MIME[(/\.(\w+)$/.exec(name) || [])[1]?.toLowerCase()] || "application/octet-stream";
