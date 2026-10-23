/**
 * 详情页 · 一键全自动（在服务器上做，浏览器关了也不停；服务器重启后接着做）
 *
 * 1 识别素材（AI 看图打标签、猜产品信息）→ 2 抠图（白底直接去白底，其他交给 AI 出白底图）→ 3 卖点（评价挖掘 + AI 补充）
 * → 4 参考图（有的话 AI 分析每一屏）→ 5 提纲和文案 → 6 背景（先出一张当风格参考）→ 7 AI 检查背景（有字、有人、有产品的重画一次）
 * → 8 融入背景（B 方式：程序贴好产品，AI 只调光影，检查产品没变样；原贴图保留，可以切换）
 * → 9 翻译 → 10 检查违禁词、放不下的文字，AI 改写 → 11 导出 zip，等人审核。
 *
 * 每一步做之前看项目里是不是已经有了（有就跳过），AI 任务都带固定的 key，所以中途停了、服务器重启了，重新开始不会重复做。
 */
import fs from "node:fs";
import path from "node:path";
import * as Q from "../queue.js";
import * as store from "./store.js";
import { getST, kit } from "./runtime.js";
import { FILES_DIR } from "../config.js";

export const STEPS = ["识别素材", "抠图", "卖点", "参考图", "提纲和文案", "背景", "检查背景", "融入背景", "翻译", "检查修正", "导出"];
const running = new Map(); // 项目编号 → { stop }
class Stopped extends Error {}

const CUT_TAGS = ["white", "angle", "spec", "package"];
const MAX_AI_CUTS = 6;

function setAuto(p, patch) {
  p.auto = { ...(p.auto || {}), ...patch };
  store.putProject(p);
}
function log(p, msg) {
  const a = p.auto || {};
  const line = `${getST().bj(Date.now(), true).slice(11)} ${msg}`;
  setAuto(p, { msg, log: [...(a.log || []).slice(-40), line] });
}

// ------------------------------------------------------------ 找 AI 干活
function ctxOf(p) {
  const st = running.get(p.id);
  const check = () => { if (!st || st.stop) throw new Stopped("已停止"); };
  const k = (s) => `pj:${p.id}:r${p.auto.run}:${s}`;
  const tmpDir = path.join(FILES_DIR, "tmp", p.id);
  /** 图片缩小后存到临时文件夹，给 AI 任务用 */
  async function img(blobOrKey, name, max = 1024) {
    const ST = getST();
    const blob = typeof blobOrKey === "string" ? await ST.db.getBlob(blobOrKey) : blobOrKey;
    if (!blob) return null;
    const small = await ST.shrink(blob, max);
    fs.mkdirSync(tmpDir, { recursive: true });
    const file = `${ST.uid("i")}.jpg`;
    fs.writeFileSync(path.join(tmpDir, file), Buffer.from(await small.arrayBuffer()));
    return { file: `tmp/${p.id}/${file}`, name: name || "图片.jpg", mime: "image/jpeg" };
  }
  /** opt.role = “AI 分工”里的模块，opt.rotate = 一批里的第几个（轮流分给不同网站） */
  async function ask(key, kind, prompt, images, label, again, opt = {}) {
    check();
    const spec = { key: k(key), kind, label: `${p.name}：${label}`, ownerType: "project", ownerId: p.id, payload: { prompt, images: (images || []).filter(Boolean), role: opt.role, rotate: opt.rotate || undefined }, retryFailed: again };
    const r = await Q.ensure(spec);
    check();
    return r;
  }
  async function json(key, prompt, images, label, opt) {
    const ST = getST();
    try {
      const r = await ask(key, "text", prompt, images, label, true, opt);
      return ST.extractJson(r.text, r.codes);
    } catch (e) {
      if (e instanceof Stopped) throw e;
      if (e.task) throw e; // 任务本身失败（重试过了）
      // 回复里没有 JSON：再问一次
      const r = await ask(key + ":again", "text", prompt + "\n\n注意：上次的回复格式不对。这次只回复一个 JSON 代码块，不要别的文字。", images, label + "（再问一次）", true, opt);
      return ST.extractJson(r.text, r.codes);
    }
  }
  async function image(key, prompt, images, label, opt) {
    const r = await ask(key, "image", prompt, images, label, true, opt);
    if (!r.file) throw new Error("AI 没有给出图片");
    const buf = fs.readFileSync(Q.filePath(r.file));
    return new Blob([buf], { type: r.mime || "image/png" });
  }
  return { check, k, img, ask, json, image, tmpDir };
}

// ------------------------------------------------------------ 各步
const recognizePrompt = (n) => [
  `你是电商美工助理。下面 ${n} 张图是同一个产品的素材（按上传顺序，第 1 张、第 2 张……）。逐张判断：`,
  "tag：white（白底或纯色底的产品主图）、angle（其他角度的产品图）、detail（局部细节特写）、spec（不同颜色 / 规格的产品图）、package（包装）、scene（使用场景、模特图）、size（带尺寸标注的图）、other（文字海报、二维码、和产品无关的图）；",
  "note：这张图拍的是什么（中文，10 个字以内，如“侧面”“拉链细节”）；group：规格图写颜色 / 规格名，其他留空。",
  "再根据图片推断产品：name（产品名称，12 个字以内）、category（类目）、material（看不出来就留空）、colors、audience（适用人群）、scenes（使用场景）。不要编造数字参数。",
  '只回复一个 JSON 代码块，格式：{"assets":[{"i":1,"tag":"white","note":"正面","group":""}],"product":{"name":"","category":"","material":"","colors":"","audience":"","scenes":""}}',
].join("\n");
const checkBgPrompt = (n) => [
  `下面 ${n} 张图是给电商详情页用的背景图（按顺序）。背景图里不能有：文字、字母、数字、logo、水印、人物、任何商品。`,
  "逐张检查，有问题的写进 bad，并写出原因；都没问题 bad 就是空数组。",
  '只回复一个 JSON 代码块，格式：{"bad":[{"i":2,"why":"左上角有文字"}]}',
].join("\n");

async function stepRecognize(p, c) {
  const ST = getST();
  if (p.auto.recognized) return;
  const list = p.assets.slice(0, 30);
  for (let i = 0; i < list.length; i += 10) {
    const part = list.slice(i, i + 10);
    const imgs = [];
    for (const [n, a] of part.entries()) imgs.push(await c.img(a.key, `第${n + 1}张.jpg`, 768));
    const r = await c.json(`recognize:${i}`, recognizePrompt(part.length), imgs, `识别素材 ${i + 1}～${i + part.length}`);
    for (const x of r.assets || []) {
      const a = part[(+x.i || 0) - 1];
      if (!a) continue;
      if (ST.TAGS.some((t) => t.id === x.tag) && !(a.tag === "spec" && x.tag !== "spec")) a.tag = a.edgeWhite && x.tag === "angle" && !p.assets.some((q) => q.tag === "white") ? "white" : x.tag;
      if (x.note && !a.note) a.note = String(x.note).slice(0, 20);
      if (x.group && !a.group) a.group = String(x.group).slice(0, 20);
    }
    const pr = r.product || {};
    for (const f of ["name", "category", "material", "colors", "audience", "scenes"]) if (pr[f] && !p.info[f]) p.info[f] = String(pr[f]).slice(0, 60);
  }
  if (!p.assets.some((a) => a.tag === "white")) { const a = p.assets.find((x) => x.edgeWhite) || p.assets[0]; if (a) a.tag = "white"; }
  p.auto.recognized = true;
  store.putProject(p);
}

/** 去白底：src = 白底图 Blob，结果存成透明 PNG */
async function makeCut(p, a, srcBlob) {
  const ST = getST();
  const img = await ST.blobToImage(srcBlob);
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const out = await kit("composeOutput")(img, { ratio: null, inputRatio: W / H, inputSize: { w: W, h: H }, outSize: "original", fill: "keep", background: "white", format: "png-alpha", contrast: "0", bright: "0", holes: "auto" });
  const key = `${p.id}:${a.id}-cut`;
  await ST.saveImage(key, out.blob || srcBlob);
  const cimg = await ST.imgOf(key);
  a.cut = key;
  a.cutBox = ST.alphaBox(cimg);
  a.cutW = cimg.naturalWidth || cimg.width; a.cutH = cimg.naturalHeight || cimg.height;
}
async function stepCut(p, c) {
  const ST = getST();
  const list = p.assets.filter((a) => !a.cut && CUT_TAGS.includes(a.tag));
  let ai = 0;
  const jobs = [];
  for (const a of list) {
    c.check();
    if (a.edgeWhite) {
      await makeCut(p, a, await ST.db.getBlob(a.key));
      store.putProject(p);
    } else if (ai < MAX_AI_CUTS) {
      ai++;
      jobs.push((async () => {
        const ratio = kit("closestAiRatio")(a.w, a.h);
        const white = await c.image(`cut:${a.id}`, ST.P.cutout(p, a, ratio), [await c.img(a.key, a.name, 1536)], `抠图：素材${p.assets.indexOf(a) + 1}`);
        a.white = `${p.id}:${a.id}-white`;
        await ST.saveImage(a.white, white);
        await makeCut(p, a, white);
        store.putProject(p);
      })().catch((e) => { if (e instanceof Stopped) throw e; log(p, `素材${p.assets.indexOf(a) + 1} 抠图没成功，用原图：${e.message}`); }));
    }
  }
  await Promise.all(jobs);
}
async function stepPoints(p, c) {
  const ST = getST();
  if (p.reviews.raw && !(p.reviews.concerns || []).length) {
    const r = await c.json("reviews", ST.P.reviewPoints(p, p.reviews.raw), [], "总结评价");
    p.reviews.concerns = (r.concerns || []).map((x) => ({ text: String(x.text || x), count: x.count || "" })).filter((x) => x.text);
    (r.points || []).slice(0, 4).forEach((t) => p.points.push({ id: ST.uid("pt"), text: String(t), on: true, src: "review" }));
    store.putProject(p);
  }
  if (p.points.filter((x) => x.on && x.text).length < 4) {
    const a = p.assets.find((x) => x.tag === "white") || p.assets[0];
    const r = await c.json("points", ST.P.suggestPoints(p, 5), a ? [await c.img(a.cut || a.key, "产品图.jpg")] : [], "补充卖点");
    (r.points || []).map((t) => String(typeof t === "string" ? t : t.text || "")).filter(Boolean).forEach((t) => p.points.push({ id: ST.uid("pt"), text: t, on: true, src: "ai" }));
    store.putProject(p);
  }
}
async function stepRef(p, c) {
  const ST = getST();
  if (!p.ref || (p.ref.analysis && p.ref.analysis.length)) return;
  const img = await ST.imgOf(p.ref.key);
  if (!img) return;
  const cv = ST.canvas(img.width, img.height);
  cv.getContext("2d").drawImage(img, 0, 0);
  const blobs = await ST.cropSegments(cv, p.ref.cuts, 1024);
  const out = [];
  for (let i = 0; i < blobs.length; i += 5) {
    const part = blobs.slice(i, i + 5);
    const imgs = [];
    for (const [k2, b] of part.entries()) imgs.push(await c.img(b, `第${i + k2 + 1}屏.jpg`, 1024));
    const r = await c.json(`ref:${i}`, ST.P.analyzeRef(p, i + 1, part.length), imgs, `分析参考图 ${i + 1}～${i + part.length} 屏`);
    const list = r.screens || [];
    part.forEach((_, k2) => { out[i + k2] = list.find((x) => +x.i === i + k2 + 1) || list[k2] || {}; });
  }
  p.ref.analysis = out;
  store.putProject(p);
}
async function stepOutline(p, c) {
  const ST = getST();
  if (p.screens.length) return;
  const a = p.assets.find((x) => x.tag === "white") || p.assets[0];
  let screens = [];
  try {
    const data = await c.json("outline", ST.P.outline(p), a ? [await c.img(a.cut || a.key, "产品图.jpg")] : [], "列提纲、写文案");
    screens = ST.screensFromOutline(p, data);
  } catch (e) {
    if (e instanceof Stopped) throw e;
    log(p, `AI 列提纲没成功，按常用顺序排：${e.message}`);
  }
  if (!screens.length) screens = ST.defaultOutline(p);
  p.screens = screens;
  store.putProject(p);
}
async function screenRatio(p, sc) {
  const ST = getST();
  const pf = ST.platformOf(p, p.platform);
  if (pf.h) return kit("closestAiRatio")(pf.w, pf.h);
  const r = await ST.renderScreen(p, sc, { platform: pf, lang: p.lang, brand: brandOf(p), pxWidth: 100 });
  return kit("closestAiRatio")(1000, r.H);
}
async function genBg(p, c, sc, tag = "") {
  const ST = getST();
  const ratio = await screenRatio(p, sc);
  const imgs = [];
  const blend = !!sc.bg.blend && sc.slots && sc.slots.main;
  if (blend) { const a = ST.assetOf(p, sc.slots.main); if (a) imgs.push(await c.img(a.cut || a.key, "产品.jpg", 1536)); }
  const hasRef = !!(p.style.styleRef && store.getBlob(p.style.styleRef));
  if (hasRef) imgs.push(await c.img(p.style.styleRef, "风格参考.jpg"));
  const prompt = blend ? ST.P.blend(p, sc, ratio, hasRef) : ST.P.background(p, sc, ratio, hasRef);
  const blob = await c.image(`bg:${sc.id}${tag}`, prompt, imgs, `背景：第 ${p.screens.indexOf(sc) + 1} 屏 ${ST.TPL[sc.tpl].name}`);
  const key = `${p.id}:bg-${sc.id}-${Date.now()}`;
  await ST.saveImage(key, blob);
  sc.bg.key = key;
  if (sc.bg.mode === "color") sc.bg.mode = "ai";
  if (!p.style.styleRef && !blend) { p.style.styleRef = `${p.id}:styleref`; await ST.saveImage(p.style.styleRef, blob); }
  store.putProject(p);
}
async function stepBg(p, c) {
  const list = p.screens.filter((s) => s.bg.mode === "ai" && !s.bg.key);
  if (!list.length) return;
  const fail = (sc) => (e) => { if (e instanceof Stopped) throw e; log(p, `第 ${p.screens.indexOf(sc) + 1} 屏背景没生成：${e.message}`); };
  if (!p.style.styleRef) { const first = list.shift(); await genBg(p, c, first).catch(fail(first)); }
  await Promise.all(list.map((sc) => genBg(p, c, sc).catch(fail(sc))));
}
async function stepCheckBg(p, c) {
  if (p.auto.bgChecked) return;
  const list = p.screens.filter((s) => s.bg.key && s.bg.mode === "ai" && !s.bg.blend);
  const redo = [];
  for (let i = 0; i < list.length; i += 8) {
    const part = list.slice(i, i + 8);
    const imgs = [];
    for (const [n, sc] of part.entries()) imgs.push(await c.img(sc.bg.key, `背景${n + 1}.jpg`, 768));
    const r = await c.json(`checkbg:${i}`, checkBgPrompt(part.length), imgs, `检查背景 ${i + 1}～${i + part.length}`);
    for (const b of r.bad || []) { const sc = part[(+b.i || 0) - 1]; if (sc) { redo.push(sc); log(p, `第 ${p.screens.indexOf(sc) + 1} 屏背景有问题（${b.why || ""}），重画`); } }
  }
  await Promise.all(redo.map((sc) => genBg(p, c, sc, ":fix").catch((e) => { if (e instanceof Stopped) throw e; log(p, `重画背景没成功：${e.message}`); })));
  p.auto.bgChecked = true;
  store.putProject(p);
}
/** 融入背景：有背景图、有主产品图的屏都做（同一个布局做过、放弃过的不再做）；几屏同时做，Gemini / Copilot 轮流 */
async function stepHarmony(p, c) {
  const ST = getST();
  const list = [];
  for (const sc of p.screens) {
    const h = await ST.harmState(p, sc);
    if (h.can && !(sc.harm && sc.harm.sig === h.sig && (sc.harm.status === "fallback" || sc.harm.key))) list.push({ sc, sig: h.sig });
  }
  const imgs = (list2) => Promise.all(list2.map((x) => c.img(x.blob, x.name, 1536)));
  await Promise.all(list.map(({ sc, sig }, i) => ST.harmonize(p, sc, {
    image: async (prompt, list2, label, n) => c.image(`harm:${sc.id}:${sig}:${n}`, prompt, await imgs(list2), label, { role: "dt_blend", rotate: i + n }),
    json: async (prompt, list2, label, n) => c.json(`harmchk:${sc.id}:${sig}:${n}`, prompt, await imgs(list2), label, { role: "dt_check", rotate: i }),
  }).then((r) => {
    store.putProject(p);
    const no = p.screens.indexOf(sc) + 1;
    if (r.ok) log(p, `第 ${no} 屏融入背景完成${r.note ? "（" + r.note + "）" : ""}`);
    else if (!r.skip) log(p, `第 ${no} 屏融入背景放弃，用原贴图：${r.why}`);
  }).catch((e) => { if (e instanceof Stopped) throw e; log(p, `第 ${p.screens.indexOf(sc) + 1} 屏融入背景没成功，用原贴图：${e.message}`); })));
}
async function stepTranslate(p, c, tag = "") {
  const ST = getST();
  for (const lang of p.langs) {
    const miss = ST.missingTexts(p, lang);
    const keys = Object.keys(miss);
    for (let i = 0; i < keys.length; i += 50) {
      const chunk = Object.fromEntries(keys.slice(i, i + 50).map((k2) => [k2, miss[k2]]));
      try {
        const r = await c.json(`tr:${lang}:${i}${tag}:${keys.length}`, ST.P.translate(p, chunk, lang), [], `翻译成${ST.lang(lang).name}${keys.length > 50 ? `（${i / 50 + 1}）` : ""}`);
        ST.applyTranslation(p, lang, r.t || r);
        store.putProject(p);
      } catch (e) {
        if (e instanceof Stopped) throw e;
        log(p, `翻译成${ST.lang(lang).name}没成功：${e.message}`);
      }
    }
  }
}
function brandOf(p) {
  const brands = store.getMeta("brands", []);
  const b = p.brandId ? brands.find((x) => x.id === p.brandId) : null;
  return b ? { primary: b.primary, accent: b.accent, text: b.text, font: b.font, logo: b.logo || "" } : null;
}
const customWords = () => String((store.getMeta("settings", {}) || {}).custom || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
async function check(p) {
  const ST = getST();
  ST.platformOverrides = (store.getMeta("settings", {}) || {}).platformOverrides || {};
  return ST.checkProject(p, { langs: [p.lang, ...p.langs], platforms: p.platforms, brand: brandOf(p), custom: customWords() });
}
async function stepFix(p, c) {
  const ST = getST();
  const issues = await check(p);
  const bad = new Map(); // 屏幕序号 → 问题
  for (const i of issues) if ((i.type === "banned" || i.type === "overflow") && i.lang === p.lang) { if (!bad.has(i.si)) bad.set(i.si, []); bad.get(i.si).push(i.msg); }
  for (const [si, msgs] of bad) {
    const sc = p.screens[si];
    if (!sc) continue;
    try {
      const prompt = ST.P.rewriteScreen(p, sc) + `\n\n【必须改掉的问题】\n${[...new Set(msgs)].join("\n")}\n违禁词换成合规的说法；放不下的文字写得更短。`;
      const r = await c.json(`fix:${sc.id}`, prompt, [], `改写第 ${si + 1} 屏文案`);
      for (const x of ST.TPL[sc.tpl].texts || []) if (typeof r[x.key] === "string") sc.text[x.key] = { [p.lang]: r[x.key] };
      (r.items || []).forEach((it, n) => { if (!sc.items[n]) return; for (const f of ["title", "desc"]) if (typeof it[f] === "string") sc.items[n][f] = { [p.lang]: it[f] }; });
      store.putProject(p);
    } catch (e) {
      if (e instanceof Stopped) throw e;
      log(p, `第 ${si + 1} 屏改写没成功：${e.message}`);
    }
  }
  if (bad.size) await stepTranslate(p, c, ":fix");
}
async function exportProject(p) {
  const ST = getST();
  ST.platformOverrides = (store.getMeta("settings", {}) || {}).platformOverrides || {};
  const r = await ST.exportZip(p, { langs: [p.lang, ...p.langs], platforms: p.platforms, long: true, slices: true, texts: true, format: "jpeg", brand: brandOf(p) });
  const rel = `exports/${p.id}.zip`;
  fs.mkdirSync(path.join(FILES_DIR, "exports"), { recursive: true });
  fs.writeFileSync(path.join(FILES_DIR, rel), Buffer.from(await r.blob.arrayBuffer()));
  const issues = await check(p);
  const counts = {};
  issues.forEach((i) => (counts[i.type] = (counts[i.type] || 0) + 1));
  return { exportFile: rel, files: r.count, notes: r.notes, issues: counts, exported: Date.now() };
}

// ------------------------------------------------------------ 开始 / 停止 / 审核通过
const RUNNERS = [stepRecognize, stepCut, stepPoints, stepRef, stepOutline, stepBg, stepCheckBg, stepHarmony, (p, c) => stepTranslate(p, c), stepFix];

async function runPipeline(id) {
  let p = store.getProject(id);
  if (!p) return;
  const c = ctxOf(p);
  try {
    for (let i = 0; i < RUNNERS.length; i++) {
      c.check();
      setAuto(p, { step: i, msg: STEPS[i] });
      log(p, `第 ${i + 1} 步：${STEPS[i]}`);
      await RUNNERS[i](p, c);
    }
    c.check();
    setAuto(p, { step: STEPS.length - 1, msg: "导出" });
    const ex = await exportProject(p);
    setAuto(p, { ...ex, status: "review", finished: Date.now(), error: "" });
    log(p, `做完了：导出 ${ex.files} 个文件，等你审核`);
  } catch (e) {
    p = store.getProject(id) || p;
    if (e instanceof Stopped || (running.get(id) || {}).stop) setAuto(p, { status: "stopped", msg: "已停止" });
    else { console.error("全自动出错", id, e); setAuto(p, { status: "failed", error: String(e.message || e), msg: "出错了" }); log(p, "出错：" + (e.message || e)); }
  } finally {
    running.delete(id);
    fs.rmSync(c.tmpDir, { recursive: true, force: true });
  }
}

/** 开始全自动（opts.fresh = 已经做过的也重新问 AI） */
export function start(id, opts = {}) {
  const p = store.getProject(id);
  if (!p) throw new Error("没有这个项目");
  if (running.has(id)) return;
  const old = p.auto || {};
  const fresh = !!opts.fresh || old.status === "review" || old.status === "approved";
  setAuto(p, { status: "running", step: 0, msg: "开始", error: "", run: fresh || !old.run ? (old.run || 0) + 1 : old.run, started: Date.now(), finished: 0, ...(fresh ? { recognized: !!old.recognized && !opts.fresh, bgChecked: false } : {}) });
  running.set(id, { stop: false });
  runPipeline(id);
}
export function stop(id) {
  const st = running.get(id);
  if (st) st.stop = true;
  Q.cancelOwner("project", id);
  const p = store.getProject(id);
  if (p && p.auto && p.auto.status === "running" && !st) setAuto(p, { status: "stopped", msg: "已停止" });
}
/** 审核通过：按现在的内容（可能手动改过）重新导出 */
export async function approve(id) {
  const p = store.getProject(id);
  if (!p) throw new Error("没有这个项目");
  if (running.has(id)) throw new Error("全自动还在做");
  setAuto(p, { status: "exporting", msg: "正在导出" });
  try {
    const ex = await exportProject(p);
    setAuto(p, { ...ex, status: "approved", msg: "已审核通过" });
  } catch (e) {
    setAuto(p, { status: "review", msg: "导出失败：" + e.message, error: String(e.message || e) });
    throw e;
  }
}
/** 服务器启动时：上次没做完的接着做 */
export function resumeAll() {
  for (const s of store.listProjects()) {
    if (s.auto && (s.auto.status === "running" || s.auto.status === "exporting")) {
      const p = store.getProject(s.id);
      if (s.auto.status === "exporting") { setAuto(p, { status: "review" }); continue; }
      running.set(s.id, { stop: false });
      runPipeline(s.id);
    }
  }
}
export const isRunning = (id) => running.has(id);
