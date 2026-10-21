/**
 * 竞品分析流水线：采集 → 评价打标签 → 合并同义标签 → 程序统计 → AI 写结论 → HTML 报告。
 * 每一步的任务都有固定的 key：服务器重启后重新跑这个函数，做过的直接用结果，接着往下做。
 */
import fs from "node:fs";
import path from "node:path";
import { db, uid } from "../db.js";
import { DATA_DIR, FILES_DIR } from "../config.js";
import * as queue from "../queue.js";
import { broadcast } from "../events.js";
import { extractJson } from "../util.js";
import { tagPrompt, qaPrompt, vocabPrompt, writePrompt, descPrompt } from "./prompts.js";
import { buildDescImages } from "./descimg.js";
import { usableRates, usableQa, rateMaterial, qaMaterial, productStats, compactForWriting } from "./stats.js";
import { renderReport } from "./report.js";

export const RATE_OPTIONS = [100, 200, 300, 500, 800, 1000];
export const BATCH_OPTIONS = [50, 100, 200]; // 评价打标签每轮几条（Lee 2026-10-21：默认 100）
const QA_BATCH = 200; // 问大家一般一轮做完，特别多才拆开
const dirOf = (id) => path.join(DATA_DIR, "analysis", id);
// 详情页切好的图放在 files/desc/<分析编号>/（任务队列从 files 下面读图片发给 AI）
const descDir = (id) => path.join(FILES_DIR, "desc", id);

const S = {
  get: db.prepare("SELECT * FROM analyses WHERE id = ?"),
  all: db.prepare("SELECT id, name, status, data, created, updated FROM analyses ORDER BY updated DESC"),
  put: db.prepare(`INSERT INTO analyses (id, name, status, data, created, updated) VALUES (@id, @name, @status, @data, @created, @updated)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, status=excluded.status, data=excluded.data, updated=excluded.updated`),
  del: db.prepare("DELETE FROM analyses WHERE id = ?"),
};
export function load(id) { const r = S.get.get(id); return r ? JSON.parse(r.data) : null; }
export function save(an) {
  an.updated = Date.now();
  S.put.run({ id: an.id, name: an.name, status: an.stage, data: JSON.stringify(an), created: an.created, updated: an.updated });
  broadcast("analysis", summary(an));
}
export function summary(an) {
  return { id: an.id, name: an.name, stage: an.stage, progress: an.progress, created: an.created, updated: an.updated, error: an.error || "",
    products: an.products.map((p) => ({ key: p.key, role: p.role, url: p.url, title: p.title, status: p.status, error: p.error || "", counts: p.counts || null })),
    hasReport: !!an.reportFile, options: an.options };
}
export function listAll() { return S.all.all().map((r) => summary(JSON.parse(r.data))); }
export function remove(id) {
  queue.cancelOwner("analysis", id);
  S.del.run(id);
  fs.rmSync(dirOf(id), { recursive: true, force: true });
  fs.rmSync(descDir(id), { recursive: true, force: true });
  broadcast("analysis", { id, deleted: true });
}

/** 链接整理：一行一个，去掉空行和重复；只认淘宝 / 天猫（以后加别的平台） */
export function parseLinks(text) {
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = /(https?:\/\/[^\s，,；;]+)/.exec(line.trim());
    if (!m) continue;
    let u = m[1];
    if (!/(taobao\.com|tmall\.com|tmall\.hk|tb\.cn)/i.test(u)) continue;
    // 只留商品 id，去掉一大串跟踪参数
    try { const x = new URL(u); const id = x.searchParams.get("id"); if (id && /item\.htm/.test(x.pathname)) u = `${x.origin}${x.pathname}?id=${id}`; } catch {}
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

export function create({ name, rivals, ours, rates, qa, batch, desc, oursDesc }) {
  const id = uid("a");
  const products = [];
  if (ours && (ours.url || ours.manual)) products.push({ key: "ours", role: "ours", url: ours.url || "", manual: ours.url ? null : ours.manual, status: ours.url ? "waiting" : "manual", title: ours.url ? "" : (ours.manual && ours.manual.name) || "我们的产品" });
  rivals.forEach((u, i) => products.push({ key: `p${i + 1}`, role: "rival", url: u, status: "waiting", title: "" }));
  const an = { id, name: name || `竞品分析 ${new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace("T", " ")}`, created: Date.now(), updated: Date.now(),
    options: { rates: RATE_OPTIONS.includes(+rates) ? +rates : 300, qa: qa !== false, batch: BATCH_OPTIONS.includes(+batch) ? +batch : 100, desc: desc !== false }, products, stage: "collect", progress: { msg: "排队采集", done: 0, total: 0 }, error: "" };
  fs.mkdirSync(dirOf(id), { recursive: true });
  // 我们的详情页图片（手动上传的）
  const ourP = products.find((p) => p.role === "ours");
  if (ourP && oursDesc && oursDesc.length) {
    const d = path.join(dirOf(id), "ours_desc");
    fs.mkdirSync(d, { recursive: true });
    ourP.descUploads = oursDesc.slice(0, 40).map((im, i) => { const f = `${String(i + 1).padStart(2, "0")}.${/png/.test(im.mime || "") ? "png" : "jpg"}`; fs.writeFileSync(path.join(d, f), Buffer.from(im.b64 || "", "base64")); return f; });
  }
  save(an);
  run(id);
  return an;
}

const running = new Set();
export function run(id) {
  if (running.has(id)) return;
  running.add(id);
  pipeline(id).catch((e) => {
    const an = load(id);
    if (an && an.stage !== "stopped") { an.stage = "failed"; an.error = String(e.message || e); save(an); }
  }).finally(() => running.delete(id));
}
/** 服务器启动时：没做完的分析接着做 */
export function resumeAll() {
  for (const a of listAll()) if (!["done", "failed", "stopped"].includes(a.stage)) run(a.id);
}
export function stop(id) {
  const an = load(id);
  if (!an) return;
  queue.cancelOwner("analysis", id);
  an.stage = "stopped";
  an.progress = { ...an.progress, msg: "已停止" };
  save(an);
}
/** 重新开始（失败或停止后）：做过的任务结果都保留，失败的任务重试 */
export function restart(id) {
  const an = load(id);
  if (!an) return;
  for (const t of queue.list({ ownerType: "analysis", ownerId: id, limit: 2000 })) if (t.status === "failed" || t.status === "cancelled") queue.retry(t.id);
  an.stage = "collect";
  an.error = "";
  an.products.forEach((p) => { if (p.status === "failed") { p.status = "waiting"; p.error = ""; } });
  save(an);
  run(id);
}

const readJson = (f, def = null) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return def; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); };
const stopped = (id) => { const a = load(id); return !a || a.stage === "stopped"; };

/** 文字任务 + 解析 JSON；解析失败换个 key 再问一次 */
async function askJson(an, key, label, prompt, material, check) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const k = attempt ? `${key}:again` : key;
    const r = await queue.ensure({ key: k, kind: "text", label, ownerType: "analysis", ownerId: an.id, payload: { prompt, material } });
    try {
      const v = extractJson(r.text, r.codes);
      if (!check || check(v)) return v;
    } catch {}
  }
  throw new Error(`${label}：AI 两次都没按格式回复`);
}

async function pipeline(id) {
  let an = load(id);
  if (!an || an.stage === "done" || an.stage === "stopped") return;
  const dir = dirOf(id);
  const prog = (msg, done, total) => { an = load(id); if (!an || an.stage === "stopped") throw new Error("已停止"); an.progress = { msg, done, total }; save(an); };

  // 1. 采集
  an.stage = "collect"; save(an);
  const toCollect = an.products.filter((p) => p.url);
  let got = 0;
  prog(`采集商品数据：0/${toCollect.length}（交给淘宝采集插件，一个一个来）`, 0, toCollect.length);
  await Promise.all(toCollect.map(async (p) => {
    const rawFile = path.join(dir, `raw_${p.key}.json`);
    if (!fs.existsSync(rawFile)) {
      try {
        const r = await queue.ensure({ key: `an:${id}:collect:${p.key}`, kind: "collect", label: `采集：${p.role === "ours" ? "我们的产品" : "竞品 " + p.key.slice(1)}`, ownerType: "analysis", ownerId: id,
          payload: { url: p.url, rates: an.options.rates, sort: "time", qa: an.options.qa, qaMax: 0, desc: an.options.desc !== false } });
        fs.copyFileSync(queue.filePath(r.file), rawFile);
      } catch (e) {
        setProduct(id, p.key, { status: "failed", error: e.message });
        return;
      }
    }
    const raw = readJson(rawFile, {});
    setProduct(id, p.key, { status: "collected", title: (raw.item && raw.item.title) || p.url, counts: { rates: (raw.rates && raw.rates.list || []).length, qa: (raw.qa && raw.qa.list || []).length } });
    got++;
    prog(`采集商品数据：${got}/${toCollect.length}`, got, toCollect.length);
  }));
  if (stopped(id)) return;
  an = load(id);
  const ready = an.products.filter((p) => p.status === "collected");
  if (!ready.some((p) => p.role === "rival") && !ready.length) throw new Error("一个商品都没采到，看看淘宝采集插件有没有连上、淘宝有没有登录");

  // 2. 给评价、问大家打标签（几个网站同时做）；同时让“看详情图”的 AI 读详情页
  an.stage = "tag"; save(an);
  const descJob = readDescs(an, dir);
  const RB = an.options.batch || 40; // 老的分析没有这个选项：还是 40 条一轮
  const QB = an.options.batch ? QA_BATCH : 60;
  const jobs = [];
  for (const p of ready) {
    const raw = readJson(path.join(dir, `raw_${p.key}.json`), {});
    const rates = usableRates(raw), qas = usableQa(raw);
    for (let i = 0; i < rates.length; i += RB) jobs.push({ p, type: "rates", n: i / RB, batch: rates.slice(i, i + RB) });
    for (let i = 0; i < qas.length; i += QB) jobs.push({ p, type: "qa", n: i / QB, batch: qas.slice(i, i + QB) });
  }
  const bTag = an.options.batch ? `b${RB}:` : ""; // 每轮条数不同，任务和结果分开存
  let doneJobs = 0;
  prog(`AI 分析评价：0/${jobs.length} 批`, 0, jobs.length);
  const tagsFile = path.join(dir, "tags.json");
  const tags = readJson(tagsFile, {});
  await Promise.all(jobs.map(async (j) => {
    const slot = `${j.p.key}:${j.type}:${bTag}${j.n}`;
    if (!tags[slot]) {
      const isRate = j.type === "rates";
      const label = `${isRate ? "评价打标签" : "问大家归类"}：${j.p.role === "ours" ? "我们的" : "竞品 " + j.p.key.slice(1)} 第 ${j.n + 1} 批（${j.batch.length} 条）`;
      try {
        const arr = await askJson(an, `an:${id}:${j.type}:${j.p.key}:${bTag}${j.n}`, label, isRate ? tagPrompt() : qaPrompt(), isRate ? rateMaterial(j.batch) : qaMaterial(j.batch),
          (v) => Array.isArray(v) && v.length >= Math.max(Math.min(3, j.batch.length) * 0.5, j.batch.length * 0.6)); // 漏太多（少于六成）就再问一次
        tags[slot] = arr.map((x) => {
          const k = Number(x.i) - 1;
          const src = j.batch[k];
          if (!src) return null;
          return isRate ? { idx: src.idx, s: Number(x.s) || 0, good: arr2(x.good), bad: arr2(x.bad), need: arr2(x.need), who: arr2(x.who) } : { idx: src.idx, topic: String(x.topic || "").trim(), worry: !!x.worry };
        }).filter(Boolean);
      } catch (e) {
        tags[slot] = [];
        tags[`${slot}:error`] = e.message;
      }
      writeJson(tagsFile, tags);
    }
    doneJobs++;
    prog(`AI 分析评价：${doneJobs}/${jobs.length} 批`, doneJobs, jobs.length);
  }));
  if (stopped(id)) return;
  const descs = await descJob;
  if (stopped(id)) return;

  // 3. 合并同义标签
  an = load(id);
  an.stage = "vocab"; save(an);
  prog("AI 合并意思相同的标签", 0, 1);
  const byProd = {};
  for (const p of ready) byProd[p.key] = { rates: [], qa: [] };
  for (const [slot, list] of Object.entries(tags)) {
    if (slot.endsWith(":error") || !Array.isArray(list)) continue;
    const [key, type] = slot.split(":");
    if (byProd[key]) byProd[key][type].push(...list);
  }
  const freq = { good: {}, bad: {}, need: {}, who: {}, qa: {} };
  for (const v of Object.values(byProd)) {
    for (const t of v.rates) for (const f of ["good", "bad", "need", "who"]) for (const x of t[f]) freq[f][x] = (freq[f][x] || 0) + 1;
    for (const q of v.qa) if (q.topic) freq.qa[q.topic] = (freq.qa[q.topic] || 0) + 1;
  }
  const top = (o, n) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n));
  const vocabInput = Object.fromEntries(Object.entries(freq).map(([k, o]) => [k, top(o, 300)]));
  let vocab = { good: {}, bad: {}, need: {}, who: {}, qa: {} };
  if (Object.values(vocabInput).some((o) => Object.keys(o).length)) {
    try {
      const v = await askJson(an, `an:${id}:vocab`, "合并同义标签", vocabPrompt(), JSON.stringify(vocabInput), (x) => x && typeof x === "object" && !Array.isArray(x));
      for (const k of Object.keys(vocab)) if (v[k] && typeof v[k] === "object") vocab[k] = v[k];
    } catch { /* 合并失败就按原标签统计 */ }
  }
  writeJson(path.join(dir, "vocab.json"), vocab);
  if (stopped(id)) return;

  // 4. 程序统计
  an = load(id);
  an.stage = "stats"; save(an);
  const stats = an.products.filter((p) => p.status === "collected" || p.status === "manual").map((p) => {
    const raw = p.status === "collected" ? readJson(path.join(dir, `raw_${p.key}.json`), {}) : { item: { title: p.title } };
    const st = productStats(p, raw, byProd[p.key] || { rates: [], qa: [] }, vocab);
    if (descs[p.key]) st.desc = descs[p.key];
    return st;
  });
  writeJson(path.join(dir, "stats.json"), stats);

  // 5. AI 写结论
  an.stage = "write"; save(an);
  prog("AI 写结论和建议", 0, 1);
  const ours = an.products.find((p) => p.role === "ours");
  let written = null;
  try {
    written = await askJson(an, `an:${id}:write`, "写结论和建议", writePrompt(!!ours, !!(ours && ours.manual)), JSON.stringify(compactForWriting(stats)), (x) => x && typeof x === "object" && x.summary);
  } catch (e) {
    written = { summary: `（AI 没写出结论：${e.message}。下面的统计数据仍然可用。）` };
  }
  writeJson(path.join(dir, "written.json"), written);

  // 6. 报告
  an = load(id);
  an.stage = "report"; save(an);
  fs.writeFileSync(path.join(dir, "report.html"), renderReport(an, stats, written));
  an = load(id);
  an.reportFile = "report.html";
  an.stage = "done";
  an.progress = { msg: "报告做好了", done: 1, total: 1 };
  save(an);
}
/**
 * 读详情页：每个商品的详情图（采集到的网址，或者我们上传的图片）拼起来切成几张 JPG，交给“看详情图”的 AI 读成文字。
 * 返回 { 商品 key: { selling, structure, params, claims, promises, audience, scenes, style, images, error } }，结果存 desc.json
 */
async function readDescs(an, dir) {
  if (an.options.desc === false) return {};
  const file = path.join(dir, "desc.json");
  const out = readJson(file, {});
  const prods = an.products.filter((p) => p.status === "collected" || p.descUploads);
  await Promise.all(prods.map(async (p) => {
    if (out[p.key] && !out[p.key].error) return;
    const who = p.role === "ours" ? "我们的" : "竞品 " + p.key.slice(1);
    try {
      let sources = [];
      if (p.descUploads && p.descUploads.length) sources = p.descUploads.map((f) => fs.readFileSync(path.join(dir, "ours_desc", f)));
      else {
        const raw = readJson(path.join(dir, `raw_${p.key}.json`), {});
        sources = (raw.item && raw.item.descImages) || [];
      }
      if (!sources.length) return;
      const ddir = descDir(an.id);
      const built = await buildDescImages(sources, ddir, p.key);
      if (!built.files.length) { out[p.key] = { error: "详情图下载不下来" }; return; }
      const images = built.files.map((f, i) => ({ file: `desc/${an.id}/${f}`, name: `详情页第${i + 1}段.jpg`, mime: "image/jpeg" }));
      let v = null;
      for (let attempt = 0; attempt < 2 && !v; attempt++) {
        const r = await queue.ensure({ key: `an:${an.id}:desc:${p.key}${attempt ? ":again" : ""}`, kind: "text", label: `读详情页：${who}（${images.length} 张图）`, ownerType: "analysis", ownerId: an.id,
          maxAttempts: 6, payload: { role: "read", prompt: descPrompt(images.length), images } });
        try { const x = extractJson(r.text, r.codes); if (x && typeof x === "object" && !Array.isArray(x) && (x.selling || x.structure)) v = x; } catch {}
      }
      if (!v) throw new Error("AI 没按格式回复");
      out[p.key] = { ...v, images: built.files.length, height: built.height, cut: built.cut };
    } catch (e) {
      if (stopped(an.id)) return;
      out[p.key] = { error: `读详情页没成功：${e.message}` };
    } finally { writeJson(file, out); }
  }));
  return Object.fromEntries(Object.entries(out).filter(([, v]) => !v.error));
}

const arr2 = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter((x) => x && x.length <= 20).slice(0, 6);

function setProduct(id, key, patch) {
  const an = load(id);
  if (!an) return;
  const p = an.products.find((x) => x.key === key);
  if (p) Object.assign(p, patch);
  save(an);
}

/** 只重新生成报告（改了模板 / 想重写结论时） */
export async function rewrite(id) {
  const an = load(id);
  if (!an) return;
  const dir = dirOf(id);
  const stats = readJson(path.join(dir, "stats.json"));
  if (!stats) throw new Error("还没有统计数据");
  const written = readJson(path.join(dir, "written.json"), {});
  fs.writeFileSync(path.join(dir, "report.html"), renderReport(an, stats, written));
  an.reportFile = "report.html";
  save(an);
}
export const reportPath = (id) => path.join(dirOf(id), "report.html");
