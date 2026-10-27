/**
 * 主图（Lee 2026-10-24 搬到服务器上做：关掉 / 刷新网页也不停，结果一定拿得回来）
 *
 * 网页只发“操作”（POST /api/main/:id/op），服务器改项目、排 AI 任务、把结果写回项目，再推送 project 事件让网页刷新。
 * 每次改项目都是“读最新的 → 改 → 存”一口气做完（中间没有 await），所以网页的操作和后台的活不会互相覆盖。
 *
 * 一张主图怎么做（it.mode）：
 *  - 默认（先画背景再融入）：AI 画空背景 → 程序贴产品 → AI 调光影 → 审核 AI（默认豆包）比一比原贴图和 AI 图，默认用它选的，两张都留着。
 *  - scene（AI 直接画场景）：把抠好的透明 PNG 发给 AI，一步画出带产品的场景 → 审核 AI 看产品有没有被改（只提示，不拦）。
 * 产品图：白底的直接去白底（p.products[].holes = 镂空的白色也抠掉），不是白底的交给 AI 出白底图再去白底。
 */
import fs from "node:fs";
import path from "node:path";
import * as Q from "../queue.js";
import { SITE_NAMES } from "../bridge.js";
import * as store from "../detail/store.js";
import { getST, kit } from "../detail/runtime.js";
import { FILES_DIR } from "../config.js";
import * as lib from "../library.js";

const running = new Set(); // 正在做的“项目:主图/产品”
const SITE_OK = ["gemini", "copilot"]; // 画图可以临时指定的网站（空 = 按 AI 分工轮流）
const SET_KEYS = ["name", "info", "size", "count", "scale", "blend", "styles", "custom", "customOn", "cur", "mode", "placement", "industry", "posterNote", "posterTheme", "posterContent", "posterBan", "plans", "perPlan", "sketch"];

export function newProject(o = {}) {
  const ST = getST();
  return { id: ST.uid("m"), kind: "main", fixedName: !!o.fixedName, name: o.name || `主图 ${ST.bj().slice(5, 16)}`, info: { name: "" }, size: 800, products: [], cur: "", styles: ["studio"], custom: "", customOn: false, count: 1, scale: 0.85, blend: true, mode: "scene", placement: "free", placeRef: "", items: [] }; // 默认 AI 直接画场景（Lee 2026-10-24）
}

// ------------------------------------------------------------ 改项目（同步：读最新 → 改 → 存）
function edit(pid, fn) {
  const p = store.getProject(pid);
  if (!p || p.kind !== "main") return null;
  const r = fn(p);
  if (r === false) return p;
  store.putProject(p);
  return p;
}
const editItem = (pid, iid, fn) => edit(pid, (p) => { const it = (p.items || []).find((x) => x.id === iid); if (!it) return false; return fn(it, p); });
const editProduct = (pid, prid, fn) => edit(pid, (p) => { const pr = (p.products || []).find((x) => x.id === prid); if (!pr) return false; return fn(pr, p); });
const delBlob = (key) => { if (key) { getST().forget(key); store.delBlob(key); } };

// ------------------------------------------------------------ 找 AI 干活
function aiOf(pid, tag) {
  const ST = getST();
  const tmpDir = path.join(FILES_DIR, "tmp", pid, tag); // 每次做一个文件夹，做完删掉（别的主图同时在做，不能删整个项目的）
  /** 图片存到临时文件夹给任务用；raw = 原样（透明 PNG 不压成 JPG） */
  async function img(blob, name, max = 1536, raw) {
    if (!blob) return null;
    const out = raw ? blob : await ST.shrink(blob, max);
    fs.mkdirSync(tmpDir, { recursive: true });
    const file = `${ST.uid("i")}.${raw && /png/.test(blob.type) ? "png" : "jpg"}`;
    fs.writeFileSync(path.join(tmpDir, file), Buffer.from(await out.arrayBuffer()));
    return { file: `tmp/${pid}/${tag}/${file}`, name: name || "图片.jpg", mime: raw ? blob.type || "image/png" : "image/jpeg" };
  }
  const ask = async (key, kind, prompt, images, label, opt = {}) => Q.ensure({ key: `mn:${pid}:${tag}:${key}`, kind, label: `${(store.getProject(pid) || {}).name || "主图"}：${label}`, ownerType: "project", ownerId: pid, retryFailed: true, payload: { prompt, images: images.filter(Boolean), role: opt.role, rotate: opt.rotate || undefined, sites: opt.site ? [opt.site] : undefined, noWait: opt.noWait || undefined } });
  return {
    img,
    async image(key, prompt, images, label, opt) {
      const r = await ask(key, "image", prompt, images, label, opt);
      if (!r.file) throw new Error("AI 没有给出图片");
      const blob = new Blob([fs.readFileSync(Q.filePath(r.file))], { type: r.mime || "image/png" });
      blob.site = r.site || ""; // 哪个 AI 画的（主图卡片上标出来，Lee 2026-10-26）
      return blob;
    },
    async json(key, prompt, images, label, opt) {
      const r = await ask(key, "text", prompt, images, label, opt);
      try { return ST.extractJson(r.text, r.codes); }
      catch {
        const r2 = await ask(key + ":again", "text", prompt + "\n\n注意：上次的回复格式不对。这次只回复一个 JSON 代码块，不要别的文字。", images, label + "（再问一次）", opt);
        return ST.extractJson(r2.text, r2.codes);
      }
    },
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

// ------------------------------------------------------------ 产品图：去白底 / AI 抠图
async function cutWhite(pid, prid, srcBlob, holes) {
  const ST = getST();
  const img = await ST.blobToImage(srcBlob);
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const out = await kit("composeOutput")(img, { ratio: null, inputRatio: W / H, inputSize: { w: W, h: H }, outSize: "original", fill: "keep", background: "white", format: "png-alpha", contrast: "0", bright: "0", holes: holes ? true : "auto" });
  const key = `${pid}:${prid}-cut-${Date.now()}`; // 每次抠都换个名字，网页上的缓存才会换新图
  await ST.saveImage(key, out.blob || srcBlob);
  const cimg = await ST.imgOf(key);
  const box = ST.alphaBox(cimg);
  let old = "";
  editProduct(pid, prid, (pr, p) => { old = pr.cut && pr.cut !== pr.key && !p.items.some((it) => it.product === prid) ? pr.cut : ""; pr.cut = key; pr.cutBox = box; pr.job = ""; });
  delBlob(old);
}
function runProduct(pid, prid, how) {
  const k = `${pid}:${prid}`;
  if (running.has(k)) return;
  running.add(k);
  (async () => {
    const ST = getST();
    const p = store.getProject(pid);
    const pr = p && p.products.find((x) => x.id === prid);
    if (!pr) return;
    if (how === "ai") {
      editProduct(pid, prid, (x) => { x.job = "AI 抠图中…"; });
      const ai = aiOf(pid, `cut-${prid}-${Date.now()}`);
      try {
      const white = await ai.image("cut", ST.P.cutout(p, { note: "" }, kit("closestAiRatio")(pr.w, pr.h)), [await ai.img(await ST.db.getBlob(pr.key), pr.name, 1536)], "主图：抠图", { role: "mn_cut" });
      const wk = `${pid}:${prid}-white`;
      await ST.saveImage(wk, white);
      editProduct(pid, prid, (x) => { x.white = wk; });
      await cutWhite(pid, prid, white, pr.holes);
      } finally { ai.cleanup(); }
    } else {
      editProduct(pid, prid, (x) => { x.job = "去白底中…"; });
      await cutWhite(pid, prid, await ST.db.getBlob(pr.white || pr.key), pr.holes);
    }
  })().catch((e) => { console.error("主图抠图出错", e); editProduct(pid, prid, (x) => { x.job = "失败：" + (e.message || e); }); })
    .finally(() => running.delete(k));
}

// ------------------------------------------------------------ 一张主图：画背景 / 融入 / AI 直接画场景
/** what = full（画背景 / 场景，再融入）| blend（只重新融入）；resume = 服务器重启后接着做（任务编号不变，做完的不再问 AI） */
function runItem(pid, iid, what, resume) {
  const k = `${pid}:${iid}`;
  if (running.has(k)) return;
  running.add(k);
  let ai = null;
  (async () => {
    const ST = getST();
    const it0 = editItem(pid, iid, (it) => { it.run = resume ? it.run || 1 : (it.run || 0) + 1; it.job = what === "blend" ? "融入：排队中" : it.mode === "poster" ? "照参考图设计：排队中" : it.mode === "scene" ? "AI 画场景：排队中" : "画背景：排队中"; it.what = what; });
    if (!it0) return;
    let p = store.getProject(pid);
    let it = p.items.find((x) => x.id === iid);
    ai = aiOf(pid, `${iid}-r${it.run}`);
    const rot = it.rot || 0;
    const set = (patch) => { const q = editItem(pid, iid, (x) => { Object.assign(x, patch); }); if (!q) throw new Error("主图已经删掉了"); p = q; it = p.items.find((x) => x.id === iid); };
    if (it.mode === "poster") {
      // 照参考图设计（Lee 2026-10-27）：参考图学风格 + 排版，文字 AI 按行业自己写
      set({ job: "照参考图设计中" });
      const refs = [];
      for (const [n, r] of (p.posterRefs || []).slice(0, 3).entries()) refs.push(await ai.img(await ST.db.getBlob(r.key), `参考图${n + 1}.jpg`, 1536));
      let prompt, imgs = refs.filter(Boolean);
      if (it.plan) {
        // 文字版主图：按改好的方案画；参考图、草图都是可选的
        const sk = it.sketchKey ? await ai.img(await ST.db.getBlob(it.sketchKey), "草图.jpg", 1024) : null;
        prompt = ST.P.posterFromPlan(p, it.plan, { refs: imgs.length, sketch: !!sk });
        if (sk) imgs.push(sk);
      } else {
        if (!imgs.length) throw new Error("参考图没有了，先上传参考图");
        prompt = ST.P.mainPoster(p, it);
      }
      const blob = await ai.image("poster", prompt, imgs, `主图（文字版）：${it.styleName}`, { role: "mn_bg", rotate: rot, site: it.site });
      const key = `${pid}:${iid}-poster-${Date.now()}`;
      await ST.saveImage(key, blob);
      const old = it.scene;
      set({ scene: key, sceneSite: blob.site, doneAt: Date.now(), job: "", judge: null });
      delBlob(old);
      return;
    }
    if (it.mode === "scene") {
      // AI 直接画场景：把抠好的透明 PNG 发过去；摆放照 it.placement（free / same / ref = 照某张图的摆法）
      const pr = ST.mainProduct(p, it.product);
      set({ job: "AI 画场景中" });
      // 抠好的图铺白底再发（Lee 2026-10-26：透明 PNG 直接发给 Gemini，透明的地方——透明灯罩、抠穿的小孔——会被画成黑点；Copilot 不会）
      const png = await ai.img(await ST.db.getBlob(pr.cut || pr.key), "产品.jpg", 1536);
      const place = it.placement === "ref" && it.placeRef ? await ai.img(await ST.db.getBlob(it.placeRef), "摆放参考.jpg", 1024) : null;
      const ref = it.ref ? await ai.img(await ST.db.getBlob(it.ref), "风格参考.jpg", 1024) : null;
      const placement = place ? "ref" : it.placement === "same" ? "same" : "free";
      const blob = await ai.image("scene", ST.P.mainScene(p, it.prompt, placement, !!ref), [png, place, ref], `主图（AI 直接画）：${it.styleName}`, { role: "mn_bg", rotate: rot, site: it.site });
      const key = `${pid}:${iid}-scene-${Date.now()}`;
      await ST.saveImage(key, blob);
      const old = it.scene;
      set({ scene: key, sceneSite: blob.site, doneAt: Date.now(), job: "", judge: null });
      delBlob(old);
      return;
    }
    if (what === "full" || !it.bg) {
      set({ job: "画背景中" });
      const ref = it.ref ? await ai.img(await ST.db.getBlob(it.ref), "风格参考.jpg", 1024) : null;
      const blob = await ai.image("bg", ST.P.mainBg(p, it.prompt, !!ref), [ref], `主图背景：${it.styleName}`, { role: "mn_bg", rotate: rot, site: it.site });
      const key = `${pid}:${iid}-bg-${Date.now()}`;
      await ST.saveImage(key, blob);
      const old = it.bg;
      set({ bg: key, bgSite: blob.site, doneAt: Date.now() });
      delBlob(old);
    }
    if (p.blend === false && what !== "blend") { set({ job: "" }); return; }
    set({ job: "融入中" });
    const c = await ST.mainCompose(p, it, 1024, false);
    let blendSite = "";
    const res = await ST.harmonizeCanvas(p, c.canvas, c.box, {
      image: async (prompt, imgs, label) => { const b = await ai.image("blend", prompt, await Promise.all(imgs.map((x) => ai.img(x.blob, x.name, 1536))), label, { role: "mn_blend", rotate: rot, site: it.site }); blendSite = b.site; return b; },
    }, `主图 ${it.styleName}`); // 不自动审核：直接用 AI 图，要审核点“AI 审核”
    const key = `${pid}:${iid}-harm-${Date.now()}`;
    await ST.saveImage(key, res.blob);
    const old = it.harm && it.harm.key;
    set({ harm: { key, sig: c.sig, on: true, status: "ok" }, blendSite, doneAt: Date.now(), job: "" });
    delBlob(old);
  })().catch((e) => {
    if (!/主图已经删掉了/.test(e.message || "")) console.error("主图出错", e.message || e);
    editItem(pid, iid, (x) => { x.job = /已取消/.test(e.message || "") ? "" : "失败：" + (e.message || e); });
  }).finally(() => {
    running.delete(k);
    if (ai) ai.cleanup();
  });
}

// ------------------------------------------------------------ AI 审核（可选，点了才做；默认豆包，没连上直接报错）
const PLAN_OK = ["deepseek", "doubao", "kimi", "glm", "gemini", "copilot"];
const JUDGE_OK = ["doubao", "deepseek", "kimi", "glm"];
/** 文字版主图第一步：AI 写方案（JSON），写好放进 p.plans（替换原来的） */
function writePlans(pid, site, n) {
  let ai = null;
  (async () => {
    const ST = getST();
    const p = store.getProject(pid);
    ai = aiOf(pid, `plan-${Date.now()}`);
    const refs = [];
    for (const [i, r] of (p.posterRefs || []).slice(0, 3).entries()) refs.push(await ai.img(await ST.db.getBlob(r.key), `参考图${i + 1}.jpg`, 1280));
    const imgs = refs.filter(Boolean);
    // 有参考图要能看图：国内的走 ai-web（1.4.0 起能发图），所以按“看详情图”那一类派活；没参考图就是写文字
    const r = await ai.json("plan", ST.P.posterPlan(p, n, imgs.length), imgs, `主图文字方案（${n} 套）`, { role: imgs.length ? "read" : "text", site, noWait: true });
    const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v || "").trim()) ? String(v).trim() : d);
    const plans = (Array.isArray(r.plans) ? r.plans : Array.isArray(r) ? r : []).slice(0, n).map((x, i) => ({
      id: ST.uid("pl"), on: true, by: site,
      theme: String(x.theme || (ST.POSTER_THEMES[i] || {}).name || "方案").slice(0, 30), style: String(x.style || "").slice(0, 200), colors: String(x.colors || "").slice(0, 200),
      bgColor: hex(x.bgColor, "#F2F4F7"), bgColor2: hex(x.bgColor2, ""), background: String(x.background || "").slice(0, 300), layout: String(x.layout || "").slice(0, 300), icons: String(x.icons || "").slice(0, 200), note: "",
      blocks: (Array.isArray(x.blocks) ? x.blocks : []).slice(0, 16).map((b) => ({ pos: String(b.pos || "").slice(0, 20), text: String(b.text || "").slice(0, 40), font: String(b.font || "黑体").slice(0, 10), weight: String(b.weight || "粗").slice(0, 6), size: Math.min(200, Math.max(12, Math.round(+b.size || 40))), x: Math.min(98, Math.max(2, Math.round(+b.x || 50))), y: Math.min(98, Math.max(2, Math.round(+b.y || 50))), color: hex(b.color, "#333333"), effect: String(b.effect || "").slice(0, 40), bg: hex(b.bg, "") })),
    })).filter((x) => x.blocks.length);
    if (!plans.length) throw new Error("AI 没写出方案（格式不对），再点一次");
    edit(pid, (q) => { q.plans = plans; q.planJob = ""; });
  })().catch((e) => edit(pid, (q) => { q.planJob = "失败：" + String(e.message || e).slice(0, 200); }))
    .finally(() => { if (ai) ai.cleanup(); });
}

function runJudge(pid, iid, site) {
  const k = `${pid}:${iid}`;
  if (running.has(k)) return;
  running.add(k);
  let ai = null;
  (async () => {
    const ST = getST();
    const p0 = editItem(pid, iid, (it) => { it.jn = (it.jn || 0) + 1; it.job = "AI 审核中"; });
    if (!p0) return;
    const p = store.getProject(pid);
    const it = p.items.find((x) => x.id === iid);
    ai = aiOf(pid, `${iid}-j${it.jn}`);
    // 审核用哪个 AI：网页上选（豆包 / DeepSeek / Kimi / 智谱，Lee 2026-10-27），没选就按 AI 分工（默认豆包）
    const json = async (prompt, imgs, label) => ai.json("judge", prompt, await Promise.all(imgs.map((x) => ai.img(x.blob, x.name, 1024))), label, { role: "mn_check", site: JUDGE_OK.includes(site) ? site : undefined });
    if (it.mode === "poster") {
      if (!it.scene) throw new Error("还没画好");
      let judge;
      try {
        const r = await json(ST.P.posterCheck(p, it.plan), [{ blob: await ST.db.getBlob(it.scene), name: "主图.jpg" }], `AI 审核（文字）：${it.styleName}`);
        const bad = Array.isArray(r.bad) ? r.bad.map(String).filter(Boolean).slice(0, 10) : [];
        judge = { ok: !(r.ok === false || r.ok === "false") && !bad.length, why: String(r.why || "").slice(0, 300), bad, text: String(r.text || "").slice(0, 300) };
      } catch (e) { judge = { ok: null, why: "", note: `审核没做成：${String(e.message || e).slice(0, 120)}` }; }
      editItem(pid, iid, (x) => { x.judge = judge; x.job = ""; });
      return;
    }
    if (it.mode === "scene") {
      if (!it.scene) throw new Error("还没画好");
      const white = await ST.toBlob(await ST.mainWhite(p, 1024), "image/jpeg", 0.92);
      let judge;
      try {
        const r = await json(ST.P.sceneCheck(p), [{ blob: white, name: "1-产品原图.jpg" }, { blob: await ST.db.getBlob(it.scene), name: "2-场景图.jpg" }], `AI 审核：${it.styleName}`);
        judge = { ok: !(r.ok === false || r.ok === "false"), why: String(r.why || "").slice(0, 300) };
      } catch (e) { judge = { ok: null, why: "", note: `审核没做成：${String(e.message || e).slice(0, 120)}` }; }
      editItem(pid, iid, (x) => { x.judge = judge; x.job = ""; });
      return;
    }
    if (!it.harm || !it.harm.key) throw new Error("还没融入，没有可以比的");
    const c = await ST.mainCompose(p, it, 1024, false);
    const res = await ST.pickBetter(p, await ST.toBlob(c.canvas, "image/jpeg", 0.92), await ST.db.getBlob(it.harm.key), { json: (prompt, imgs, label) => json(prompt, imgs, label) }, `主图 ${it.styleName}`);
    editItem(pid, iid, (x) => { if (x.harm) Object.assign(x.harm, { on: res.choice === "ai", choice: res.choice, why: res.why, note: res.note }); x.job = ""; });
  })().catch((e) => editItem(pid, iid, (x) => { x.job = "失败：" + (e.message || e); }))
    .finally(() => { running.delete(k); if (ai) ai.cleanup(); });
}

// ------------------------------------------------------------ 网页发来的操作
/** 选中的风格 → [{ id, name, prompt, ref }] */
function chosenStyles(p) {
  const ST = getST();
  const mine = store.getMeta("mainStyles", []) || [];
  const out = [];
  for (const id of p.styles || []) {
    const pre = ST.MAIN_STYLES.find((s) => s.id === id);
    if (pre) out.push({ id, name: pre.name, prompt: pre.prompt, ref: "" });
    const my = id.startsWith("my:") && mine.find((s) => "my:" + s.id === id);
    if (my) out.push({ id, name: my.name, prompt: my.prompt, ref: my.useRef !== false ? my.ref : "" });
  }
  if (p.customOn && String(p.custom || "").trim()) out.push({ id: "custom", name: "自己写的", prompt: p.custom.trim(), ref: "" });
  return out;
}

export async function op(pid, b) {
  const ST = getST();
  const p0 = store.getProject(pid);
  if (!p0 || p0.kind !== "main") throw new Error("没有这个主图项目");
  const iid = b.iid, prid = b.prid;
  switch (b.op) {
    case "set": return edit(pid, (p) => { if ("mode" in (b.fields || {})) p.modeSet = true; for (const k of SET_KEYS) if (k in (b.fields || {}) && !(k === "name" && p.fixedName)) p[k] = b.fields[k]; });
    case "addProduct": {
      const img = await ST.imgOf(b.key);
      if (!img) throw new Error("图片打不开");
      const pr = { id: b.id || ST.uid("pr"), name: String(b.name || "产品图").slice(0, 80), key: b.key, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height, cut: "", cutBox: null, white: "", holes: false, edgeWhite: ST.edgeIsWhite(img), job: "" };
      // 已经抠好的透明 PNG：直接当抠好的图用
      if (b.isCut || (!pr.edgeWhite && ST.edgeIsClear(img))) { pr.edgeWhite = false; pr.cut = b.key; pr.cutBox = ST.alphaBox(img); }
      // after = 加在这张后面（去白边另存的新图）
      const p = edit(pid, (q) => { const i = b.after ? q.products.findIndex((x) => x.id === b.after) : -1; i >= 0 ? q.products.splice(i + 1, 0, pr) : q.products.push(pr); if (!q.cur) q.cur = pr.id; });
      // 不自动去白底：产品图保留原来的格式（Lee 2026-10-26）。AI 直接画用原图就行；画背景 + 融入要抠好的图，点“去白底”或“AI 抠图”
      // 上传的产品图也放进素材中心（从素材中心发过来的就不用了）
      if (!b.fromLibrary) { const f = store.getBlob(b.key); if (f) lib.add(f.buf, { grp: p.name, source: "main", tag: b.libTag === "白底图" ? "白底图" : "原图", name: pr.name, used: { type: "main", id: pid, name: p.name } }).catch(() => {}); }
      return p;
    }
    case "replaceCut": {
      // 产品图去白边“保存”：换掉抠好的图（已经生成的主图还用着旧图的话，旧图留着）
      const img = await ST.imgOf(b.key);
      if (!img) throw new Error("图片打不开");
      let old = "";
      const p = editProduct(pid, prid, (pr, q) => { old = pr.cut && pr.cut !== pr.key && pr.cut !== b.key && !q.items.some((it) => it.product === prid) ? pr.cut : ""; pr.cut = b.key; pr.cutBox = ST.alphaBox(img); pr.job = ""; });
      delBlob(old);
      return p;
    }
    case "holes": { const p = editProduct(pid, prid, (pr) => { pr.holes = !!b.holes; }); runProduct(pid, prid, "direct"); return p; }
    case "cutAi": runProduct(pid, prid, "ai"); return store.getProject(pid);
    case "cutDirect": runProduct(pid, prid, "direct"); return store.getProject(pid);
    case "delProduct": return edit(pid, (p) => {
      const pr = p.products.find((x) => x.id === prid);
      if (!pr) return false;
      p.products = p.products.filter((x) => x !== pr);
      if (p.cur === pr.id) p.cur = (p.products[0] || {}).id || "";
      if (!p.items.some((it) => it.product === pr.id)) [pr.key, pr.cut, pr.white].forEach(delBlob);
    });
    case "generate": {
      if (p0.mode === "poster" && (p0.plans || []).length) {
        // 文字版主图第二步：勾上的方案，每套出 perPlan 张
        const plans = p0.plans.filter((x) => x.on !== false && (x.blocks || []).some((b) => String(b.text || "").trim()));
        if (!plans.length) throw new Error("没有勾上的方案（或者方案里没有字）");
        const per = Math.min(3, Math.max(1, +p0.perPlan || 1));
        const list = [];
        let k = 0;
        for (const pl of plans) for (let j = 0; j < per; j++) list.push({ id: ST.uid("it"), mode: "poster", plan: JSON.parse(JSON.stringify(pl)), sketchKey: p0.sketch && pl.sketchKey ? pl.sketchKey : "", theme: 0, style: "poster", styleName: pl.theme || "方案", prompt: "", ref: "", product: "", bg: "", pos: { x: 0.5, y: 0.53, s: 0.85 }, harm: null, state: "pending", t: Date.now(), rot: k++, job: "排队中", site: SITE_OK.includes(b.site) ? b.site : "" });
        const p = edit(pid, (q) => { q.items.unshift(...list); });
        for (const it of list) runItem(pid, it.id, "full");
        return p;
      }
      if (p0.mode === "poster") {
        // 照参考图设计：一共 count 张；posterTheme = "set" 每张一个重点（一套主图），"hero" 都画核心卖点（多出几张对比）
        if (!(p0.posterRefs || []).length) throw new Error("先上传参考图");
        if (!String(p0.industry || "").trim()) throw new Error("先填你做的行业 / 产品");
        const cnt = Math.min(6, Math.max(1, +p0.count || 1));
        const list = [];
        for (let k = 0; k < cnt; k++) {
          const theme = p0.posterTheme === "hero" ? 0 : k % ST.POSTER_THEMES.length;
          list.push({ id: ST.uid("it"), mode: "poster", theme, style: "poster", styleName: ST.POSTER_THEMES[theme].name, prompt: "", ref: "", product: "", bg: "", pos: { x: 0.5, y: 0.53, s: 0.85 }, harm: null, state: "pending", t: Date.now(), rot: k, job: "排队中", site: SITE_OK.includes(b.site) ? b.site : "" });
        }
        const p = edit(pid, (q) => { q.items.unshift(...list); });
        for (const it of list) runItem(pid, it.id, "full");
        return p;
      }
      const pr = ST.mainProduct(p0);
      if (!pr) throw new Error("先上传产品图");
      if (p0.mode === "paste" && !pr.cut) throw new Error("“画背景 + 融入”要用抠好的产品图：白底图点产品图下面的“去白底”，不是白底的点“AI 抠图”");
      const styles = chosenStyles(p0);
      if (!styles.length) throw new Error("先选至少一种背景风格");
      const list = [];
      let n = 0;
      for (const s of styles) for (let k = 0; k < Math.min(6, Math.max(1, +p0.count || 1)); k++) list.push({ id: ST.uid("it"), mode: p0.mode === "paste" ? "paste" : "scene", placement: p0.placement === "ref" && p0.placeRef ? "ref" : p0.placement === "same" ? "same" : "free", placeRef: p0.placement === "ref" ? p0.placeRef || "" : "", style: s.id, styleName: s.name, prompt: s.prompt, ref: s.ref || "", product: pr.id, bg: "", pos: { x: 0.5, y: 0.53, s: p0.scale || 0.85 }, harm: null, state: "pending", t: Date.now(), rot: n++, job: "排队中", site: SITE_OK.includes(b.site) ? b.site : "" });
      const p = edit(pid, (q) => { q.items.unshift(...list); });
      for (const it of list) runItem(pid, it.id, "full");
      return p;
    }
    case "judge": runJudge(pid, iid, b.site); return store.getProject(pid);
    case "writePlans": {
      // 文字版主图第一步：AI 写方案（网页上选哪个 AI 写：DeepSeek / 豆包 / Kimi / 智谱 / Gemini / Copilot）
      if (!PLAN_OK.includes(b.site)) throw new Error("选一个写方案的 AI");
      if (p0.planJob && !/失败/.test(p0.planJob)) throw new Error("正在写方案，等一下");
      writePlans(pid, b.site, Math.min(6, Math.max(1, +b.n || 1)));
      return edit(pid, (p) => { p.planJob = `${SITE_NAMES[b.site] || b.site} 写方案中`; });
    }
    case "addPosterRef": {
      // 参考图（最多 3 张）
      const img = await ST.imgOf(b.key);
      if (!img) throw new Error("图片打不开");
      return edit(pid, (p) => { p.posterRefs = [...(p.posterRefs || []), { key: b.key, name: String(b.name || "参考图").slice(0, 80) }].slice(-3); });
    }
    case "delPosterRef": return edit(pid, (p) => {
      const r = (p.posterRefs || []).find((x) => x.key === b.key);
      if (!r) return false;
      p.posterRefs = p.posterRefs.filter((x) => x !== r);
      if (!p.items.some((it) => it.mode === "poster" && it.job)) delBlob(r.key);
    });
    case "placeRef": {
      // 用这张的摆法：把这张图复制一份当摆放参考（这张删了也不影响）
      const it = p0.items.find((x) => x.id === iid);
      const drop = (p) => { if (p.placeRef && !p.items.some((x) => x.placeRef === p.placeRef && x.job)) delBlob(p.placeRef); };
      if (b.clear || !it) return edit(pid, (p) => { drop(p); p.placeRef = ""; p.placeRefName = ""; if (p.placement === "ref") p.placement = "free"; });
      const src = it.mode === "scene" ? it.scene : (await ST.mainCompose(p0, it, 1024)).canvas;
      const blob = typeof src === "string" ? await ST.db.getBlob(src) : await ST.toBlob(src, "image/jpeg", 0.92);
      if (!blob) throw new Error("这张还没画好");
      const key = `${pid}:placeref-${Date.now()}`;
      await ST.saveImage(key, blob);
      return edit(pid, (p) => { drop(p); p.placeRef = key; p.placeRefName = it.styleName; p.placement = "ref"; p.mode = "scene"; });
    }
    case "view": return editItem(pid, iid, (it) => { if (!it.harm) return false; it.harm.on = !!b.on; });
    case "accept": {
      const p = editItem(pid, iid, (it) => { it.state = b.ok ? "ok" : "pending"; });
      // 采用的主图放进素材中心（按项目的尺寸，和下载的一样）
      const it = p && b.ok && p.items.find((x) => x.id === iid);
      if (it) {
        const c = await ST.mainCompose(p, it, p.size || 800);
        const buf = Buffer.from(await (await ST.toBlob(c.canvas, "image/jpeg", 0.92)).arrayBuffer());
        await lib.add(buf, { grp: p.name, source: "main", tag: "主图", name: `${p.name}_${it.styleName}.jpg`, used: { type: "main", id: pid, name: p.name } }).catch(() => {});
      }
      return p;
    }
    case "adjust": {
      const pos = b.pos || {};
      const p = editItem(pid, iid, (it) => { it.pos = { x: ST.clamp(+pos.x || 0.5, 0.05, 0.95), y: ST.clamp(+pos.y || 0.53, 0.05, 0.95), s: ST.clamp(+pos.s || 0.85, 0.2, 0.98) }; });
      if (b.again) { editItem(pid, iid, (it) => { it.site = SITE_OK.includes(b.site) ? b.site : ""; }); runItem(pid, iid, "blend"); }
      return p;
    }
    case "reblend": case "redraw":
      editItem(pid, iid, (it) => { it.site = SITE_OK.includes(b.site) ? b.site : ""; });
      runItem(pid, iid, b.op === "reblend" ? "blend" : "full");
      return store.getProject(pid);
    case "delItem": {
      Q.list({ ownerType: "project", ownerId: pid, status: "queued" }).filter((t) => t.key && t.key.startsWith(`mn:${pid}:${iid}-`)).forEach((t) => Q.cancel(t.id));
      return edit(pid, (p) => {
        const it = p.items.find((x) => x.id === iid);
        if (!it) return false;
        p.items = p.items.filter((x) => x !== it);
        [it.bg, it.scene, it.harm && it.harm.key].forEach(delBlob);
      });
    }
    default: throw new Error("不认识的操作：" + b.op);
  }
}

/** 服务器启动时：上次没做完的主图接着做 */
export function resumeAll() {
  // 主图默认改成“AI 直接画场景”（Lee 2026-10-24）：以前建的项目也改过来（之后手动切换过的会记 modeSet，不再动）
  if (!store.getMeta("mainModeMig2", false)) {
    for (const s of store.listProjects("main")) edit(s.id, (p) => { if (p.modeSet) return false; p.mode = "scene"; p.placement = p.placement || "free"; });
    store.setMeta("mainModeMig2", true);
  }
  for (const s of store.listProjects("main")) {
    const p = store.getProject(s.id);
    for (const it of p.items || []) if (it.job && !/失败/.test(it.job)) runItem(p.id, it.id, it.what || "full", true);
    for (const pr of p.products || []) if (pr.job && !/失败/.test(pr.job)) runProduct(p.id, pr.id, /AI/.test(pr.job) ? "ai" : "direct");
  }
}
