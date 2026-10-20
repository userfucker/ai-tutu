/**
 * 详情页：新建项目、导入淘宝采集插件的 zip（服务器端，批量和一键全自动用）。
 * 和网页里“② 素材 → 从淘宝采集导入”做的事一样：主图 / 3:4 主图 / 我选的图片 → 素材，SKU 图 → 规格图，
 * 详情图 → 参考详情图（拼成长图、自动切屏），商品标题和参数 → 产品信息，评价和问大家 → 用来挖卖点。
 */
import { getST } from "./runtime.js";
import * as store from "./store.js";

export function newProject(o = {}) {
  const ST = getST();
  const plat = o.platform || "taobao-m";
  return {
    id: ST.uid("p"), name: o.name || `新项目 ${ST.bj().slice(5)}`, created: Date.now(), updated: Date.now(),
    platform: plat, platforms: [...new Set([plat, ...(o.platforms || [])])], lang: o.lang || "zh-CN", langs: (o.langs || []).filter((l) => l !== (o.lang || "zh-CN")),
    tone: o.tone || "minimal", brandId: o.brandId || "", units: "auto",
    assets: [], info: { name: "", category: "", brand: "", material: "", size: "", weight: "", colors: "", package: "", audience: "", scenes: "", extra: "", params: [], dims: { l: "", w: "", h: "", unit: "cm" }, tr: {} },
    points: [], reviews: { raw: "", concerns: [] }, ref: null, screens: [], style: { styleRef: "" },
  };
}

/** 加一张素材图（Blob），返回素材 */
export async function addAsset(p, blob, name, o = {}) {
  const ST = getST();
  const img = await ST.blobToImage(blob);
  const id = ST.uid("a");
  const key = `${p.id}:${id}-orig`;
  await ST.saveImage(key, blob);
  const white = ST.edgeIsWhite(img);
  const a = { id, name: name || "图片", tag: o.tag || (white ? "white" : "other"), note: o.note || "", group: o.group || "", key, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height, white: "", cut: "", cutBox: null, edgeWhite: white };
  p.assets.push(a);
  return a;
}

/** 参考详情图：多张拼成长图，自动切 */
export async function setRef(p, blobs) {
  const ST = getST();
  if (!blobs.length) return;
  const { canvas, joins } = await ST.stitch(blobs);
  const key = `${p.id}:ref`;
  await ST.saveImage(key, await ST.toBlob(canvas, "image/jpeg", 0.9));
  p.ref = { key, w: canvas.width, h: canvas.height, cuts: ST.autoCuts(canvas, joins), analysis: [] };
}

/**
 * 导入一个 zip（淘宝采集导出的，或者一个装着图片的文件夹打包成的 zip）
 * o = { name, platform, platforms, lang, langs, tone, brandId }
 */
export async function importZip(buf, o = {}) {
  const ST = getST();
  const files = await ST.readZip(new Blob([buf]));
  const dj = files.find((f) => /(^|\/)data\.json$/.test(f.name));
  let data = null;
  try { data = dj ? JSON.parse(await dj.blob.text()) : null; } catch {}
  // 没有 data.json（自己打包的文件夹）：所有文件都在同一个文件夹里就把它当根目录
  const top = files.length && files.every((f) => f.name.includes("/") && f.name.split("/")[0] === files[0].name.split("/")[0]) ? files[0].name.split("/")[0] + "/" : "";
  const root = dj ? dj.name.replace(/data\.json$/, "") : top;
  const rel = (f) => f.name.slice(root.length);
  const imgs = files.filter((f) => f.name.startsWith(root) && ST.isImageName(f.name)).sort((a, b) => a.name.localeCompare(b.name, "zh", { numeric: true }));
  const inDir = (re) => imgs.filter((f) => re.test(rel(f)));
  const title = data && data.item && data.item.title;
  const p = newProject({ ...o, name: o.name || (title ? title.slice(0, 30) : "") || (root ? root.replace(/\/$/, "").split("/").pop() : "") || undefined });
  const known = /^(主图|3比4主图|SKU图|我选的图片|详情图[^/]*)\//;
  const main = inDir(/^主图\//), main34 = inDir(/^3比4主图\//), picked = inDir(/^我选的图片\//), sku = inDir(/^SKU图\//);
  const desc = inDir(/^详情图[^/]*\//);
  const loose = imgs.filter((f) => !known.test(rel(f)));
  const base = (f) => f.name.split("/").pop();
  for (const f of [...main, ...main34, ...picked, ...loose].slice(0, 30)) await addAsset(p, f.blob, base(f)).catch(() => {});
  for (const f of sku.slice(0, 12)) await addAsset(p, f.blob, base(f), { tag: "spec", group: base(f).replace(/\.\w+$/, "").split("_").slice(1).join("_") }).catch(() => {});
  if (desc.length) {
    // 只用第一个“详情图”文件夹
    const first = (/^(详情图[^/]*)\//.exec(rel(desc[0])) || [])[1];
    await setRef(p, desc.filter((f) => rel(f).startsWith(first + "/")).slice(0, 40).map((f) => f.blob)).catch(() => {});
  }
  if (data && data.item) {
    const it = data.item;
    if (it.title) p.info.name = it.title.slice(0, 40);
    if (Array.isArray(it.params)) p.info.params = it.params.filter((x) => x.name && x.value).slice(0, 14).map((x) => ({ k: x.name, v: x.value }));
    if (it.skuProps && it.skuProps.length) p.info.colors = it.skuProps.map((x) => `${x.name}：${x.values.map((v) => v.name).join("、")}`).join("；");
  }
  if (data) {
    const lines = [];
    ((data.rates && data.rates.list) || []).forEach((x) => { if (x.content) lines.push("评价：" + x.content + (x.appendContent ? " 追评：" + x.appendContent : "")); });
    ((data.qa && data.qa.list) || []).forEach((q) => lines.push("问：" + q.title + (q.answers && q.answers.length ? " 答：" + q.answers.map((a) => a.content).join(" / ") : "")));
    p.reviews.raw = lines.join("\n");
  }
  if (!p.assets.length) throw new Error("zip 里没有找到图片");
  store.putProject(p);
  return p;
}
