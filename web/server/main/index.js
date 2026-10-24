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
import * as store from "../detail/store.js";
import { getST, kit } from "../detail/runtime.js";
import { FILES_DIR } from "../config.js";
import * as lib from "../library.js";

const running = new Set(); // 正在做的“项目:主图/产品”
const SITE_OK = ["gemini", "copilot"]; // 画图可以临时指定的网站（空 = 按 AI 分工轮流）
const SET_KEYS = ["name", "info", "size", "count", "scale", "blend", "styles", "custom", "customOn", "cur", "mode", "placement"];

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
  const ask = async (key, kind, prompt, images, label, opt = {}) => Q.ensure({ key: `mn:${pid}:${tag}:${key}`, kind, label: `${(store.getProject(pid) || {}).name || "主图"}：${label}`, ownerType: "project", ownerId: pid, retryFailed: true, payload: { prompt, images: images.filter(Boolean), role: opt.role, rotate: opt.rotate || undefined, sites: opt.site ? [opt.site] : undefined } });
  return {
    img,
    async image(key, prompt, images, label, opt) {
      const r = await ask(key, "image", prompt, images, label, opt);
      if (!r.file) throw new Error("AI 没有给出图片");
      return new Blob([fs.readFileSync(Q.filePath(r.file))], { type: r.mime || "image/png" });
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
  editProduct(pid, prid, (pr, p) => { old = pr.cut && !p.items.some((it) => it.product === prid) ? pr.cut : ""; pr.cut = key; pr.cutBox = box; pr.job = ""; });
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
    const it0 = editItem(pid, iid, (it) => { it.run = resume ? it.run || 1 : (it.run || 0) + 1; it.job = what === "blend" ? "融入：排队中" : it.mode === "scene" ? "AI 画场景：排队中" : "画背景：排队中"; it.what = what; });
    if (!it0) return;
    let p = store.getProject(pid);
    let it = p.items.find((x) => x.id === iid);
    ai = aiOf(pid, `${iid}-r${it.run}`);
    const rot = it.rot || 0;
    const set = (patch) => { const q = editItem(pid, iid, (x) => { Object.assign(x, patch); }); if (!q) throw new Error("主图已经删掉了"); p = q; it = p.items.find((x) => x.id === iid); };
    if (it.mode === "scene") {
      // AI 直接画场景：把抠好的透明 PNG 发过去；摆放照 it.placement（free / same / ref = 照某张图的摆法）
      const pr = ST.mainProduct(p, it.product);
      set({ job: "AI 画场景中" });
      const png = await ai.img(await ST.db.getBlob(pr.cut || pr.key), "产品.png", 1536, !!pr.cut);
      const place = it.placement === "ref" && it.placeRef ? await ai.img(await ST.db.getBlob(it.placeRef), "摆放参考.jpg", 1024) : null;
      const ref = it.ref ? await ai.img(await ST.db.getBlob(it.ref), "风格参考.jpg", 1024) : null;
      const placement = place ? "ref" : it.placement === "same" ? "same" : "free";
      const blob = await ai.image("scene", ST.P.mainScene(p, it.prompt, placement, !!ref), [png, place, ref], `主图（AI 直接画）：${it.styleName}`, { role: "mn_bg", rotate: rot, site: it.site });
      const key = `${pid}:${iid}-scene-${Date.now()}`;
      await ST.saveImage(key, blob);
      const old = it.scene;
      set({ scene: key, job: "", judge: null });
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
      set({ bg: key });
      delBlob(old);
    }
    if (p.blend === false && what !== "blend") { set({ job: "" }); return; }
    set({ job: "融入中" });
    const c = await ST.mainCompose(p, it, 1024, false);
    const res = await ST.harmonizeCanvas(p, c.canvas, c.box, {
      image: async (prompt, imgs, label) => ai.image("blend", prompt, await Promise.all(imgs.map((x) => ai.img(x.blob, x.name, 1536))), label, { role: "mn_blend", rotate: rot, site: it.site }),
    }, `主图 ${it.styleName}`); // 不自动审核：直接用 AI 图，要审核点“AI 审核”
    const key = `${pid}:${iid}-harm-${Date.now()}`;
    await ST.saveImage(key, res.blob);
    const old = it.harm && it.harm.key;
    set({ harm: { key, sig: c.sig, on: true, status: "ok" }, job: "" });
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
function runJudge(pid, iid) {
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
    const json = async (prompt, imgs, label) => ai.json("judge", prompt, await Promise.all(imgs.map((x) => ai.img(x.blob, x.name, 1024))), label, { role: "mn_check" });
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
      const p = edit(pid, (q) => { q.products.push(pr); if (!q.cur) q.cur = pr.id; });
      if (pr.edgeWhite) runProduct(pid, pr.id, "direct");
      // 上传的产品图也放进素材中心（从素材中心发过来的就不用了）
      if (!b.fromLibrary) { const f = store.getBlob(b.key); if (f) lib.add(f.buf, { grp: p.name, source: "main", tag: "原图", name: pr.name, used: { type: "main", id: pid, name: p.name } }).catch(() => {}); }
      return p;
    }
    case "holes": { const p = editProduct(pid, prid, (pr) => { pr.holes = !!b.holes; }); runProduct(pid, prid, "direct"); return p; }
    case "cutAi": runProduct(pid, prid, "ai"); return store.getProject(pid);
    case "delProduct": return edit(pid, (p) => {
      const pr = p.products.find((x) => x.id === prid);
      if (!pr) return false;
      p.products = p.products.filter((x) => x !== pr);
      if (p.cur === pr.id) p.cur = (p.products[0] || {}).id || "";
      if (!p.items.some((it) => it.product === pr.id)) [pr.key, pr.cut, pr.white].forEach(delBlob);
    });
    case "generate": {
      const pr = ST.mainProduct(p0);
      if (!pr) throw new Error("先上传产品图");
      if (!pr.cut) throw new Error("这张产品图还没抠好（不是白底的图点“AI 抠图”）");
      const styles = chosenStyles(p0);
      if (!styles.length) throw new Error("先选至少一种背景风格");
      const list = [];
      let n = 0;
      for (const s of styles) for (let k = 0; k < (p0.count || 1); k++) list.push({ id: ST.uid("it"), mode: p0.mode === "paste" ? "paste" : "scene", placement: p0.placement === "ref" && p0.placeRef ? "ref" : p0.placement === "same" ? "same" : "free", placeRef: p0.placement === "ref" ? p0.placeRef || "" : "", style: s.id, styleName: s.name, prompt: s.prompt, ref: s.ref || "", product: pr.id, bg: "", pos: { x: 0.5, y: 0.53, s: p0.scale || 0.85 }, harm: null, state: "pending", t: Date.now(), rot: n++, job: "排队中", site: SITE_OK.includes(b.site) ? b.site : "" });
      const p = edit(pid, (q) => { q.items.unshift(...list); });
      for (const it of list) runItem(pid, it.id, "full");
      return p;
    }
    case "judge": runJudge(pid, iid); return store.getProject(pid);
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
