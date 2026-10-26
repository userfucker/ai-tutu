/**
 * 网页版“抠白底图”（Lee 2026-10-24：把 AI图图 插件右侧面板的功能搬到网页，网页指挥插件干活）
 *
 * 和主图一样在服务器上做：关掉网页也不停，服务器重启后接着做。
 * 网页负责：加图、编辑（框选 / 自由框选 / 画笔标注配件 / 取色 / 旋转）、按设置写好提示词、把“交给 AI 的图”准备好（imagekit.js 的 prepareInput）；
 * 服务器负责：排 AI 任务（Gemini / Copilot 轮流，也可以指定；Gemini 可以指定模型）、收图、按设置做后期（composeOutput：主体校准、白底提纯、透明底、调色、缩放），
 * 结果存进项目，同时放进素材中心（抠白底 = 白底图，其他模式 = AI 生成）。
 *
 * 项目（kind = "cutout"）：settings（模式和各项参数）、files（产品图和编辑状态）、jobs（每做一次一条记录）。
 */
import fs from "node:fs";
import path from "node:path";
import * as Q from "../queue.js";
import * as store from "../detail/store.js";
import { getST, kit } from "../detail/runtime.js";
import { FILES_DIR } from "../config.js";
import * as lib from "../library.js";

export const DEFAULT_SETTINGS = {
  mode: "white", ratio: "1:1", background: "white", outSize: "800", format: "jpeg", fill: "85", angle: "keep",
  retouch: "on", sharp: "keep", contrast: "0", bright: "0", holes: "auto", refineBg: "original", formatAuto: true, model: "Flash", site: "", batchSize: 10,
};
const SITE_OK = ["gemini", "copilot"];
const running = new Set();

export function newProject(o = {}) {
  const ST = getST();
  return { id: ST.uid("c"), kind: "cutout", fixedName: !!o.fixedName, name: o.name || `白底图 ${ST.bj().slice(5, 16)}`, settings: { ...DEFAULT_SETTINGS }, files: [], jobs: [] };
}

function edit(pid, fn) {
  const p = store.getProject(pid);
  if (!p || p.kind !== "cutout") return null;
  if (fn(p) === false) return p;
  store.putProject(p);
  return p;
}
const editJob = (pid, jid, fn) => edit(pid, (p) => { const j = p.jobs.find((x) => x.id === jid); if (!j) return false; return fn(j, p); });
const delBlob = (key) => { if (key) { getST().forget(key); store.delBlob(key); } };

// ------------------------------------------------------------ 做一张
function runJob(pid, jid, resume) {
  const k = `${pid}:${jid}`;
  if (running.has(k)) return;
  running.add(k);
  const ST = getST();
  const tmpDir = path.join(FILES_DIR, "tmp", pid, jid);
  (async () => {
    const p0 = editJob(pid, jid, (j) => { j.status = "running"; j.job = "排队中"; j.run = resume ? j.run || 1 : (j.run || 0) + 1; j.error = ""; });
    if (!p0) return;
    const j = p0.jobs.find((x) => x.id === jid);
    const s = { ...DEFAULT_SETTINGS, ...(j.settings || p0.settings || {}) };
    // 交给 AI 的图（网页准备好的）写成临时文件
    fs.mkdirSync(tmpDir, { recursive: true });
    const images = [];
    for (const [i, key] of [j.inKey, ...(j.extraKeys || [])].entries()) {
      const b = store.getBlob(key);
      if (!b) throw new Error("交给 AI 的图找不到了，请点“重做”");
      const file = `${i}.jpg`;
      fs.writeFileSync(path.join(tmpDir, file), b.buf);
      images.push({ file: `tmp/${pid}/${jid}/${file}`, name: i ? `配件${i}.jpg` : j.name || "产品图.jpg", mime: b.type || "image/jpeg" });
    }
    editJob(pid, jid, (x) => { x.job = "AI 出图中"; });
    const r = await Q.ensure({
      key: `ct:${pid}:${jid}:r${j.run || 1}`, kind: "image", label: `${p0.name}：${j.name || "抠图"}`, ownerType: "project", ownerId: pid, retryFailed: true,
      payload: { prompt: j.prompt, images, role: "ct_draw", rotate: j.rot || undefined, sites: SITE_OK.includes(j.site) ? [j.site] : undefined, model: s.model || undefined },
    });
    if (!r.file) throw new Error("AI 没有给出图片");
    const aiBuf = fs.readFileSync(Q.filePath(r.file));
    const aiKey = `${pid}:${jid}-ai-${Date.now()}`;
    store.putBlob(aiKey, aiBuf, r.mime || "image/png");
    editJob(pid, jid, (x) => { x.job = "后期处理"; x.aiKey = aiKey; x.site = r.site || x.site; });
    // 后期：和插件面板 finishJob 一样
    const img = await ST.imgOf(aiKey);
    const inSize = j.inSize && j.inSize.w ? j.inSize : { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
    const out = await kit("composeOutput")(img, {
      ratio: s.mode === "white" ? 1 : s.mode === "free" && s.ratio !== "auto" ? kit("ratioValue")(s.ratio) : null,
      inputRatio: inSize.w / inSize.h, inputSize: inSize,
      outSize: s.outSize, fill: s.fill, background: s.mode === "refine" ? (s.refineBg === "white" ? "white" : "original") : s.background, format: s.format, contrast: s.contrast, bright: s.bright,
      holes: s.holes === "on" ? true : s.holes === "off" ? false : "auto",
    });
    let outBuf, outType, w, h, ext, note = "";
    if (out.same || !out.blob) { outBuf = aiBuf; outType = r.mime || "image/png"; w = img.naturalWidth || img.width; h = img.naturalHeight || img.height; ext = /png/.test(outType) ? ".png" : ".jpg"; }
    else { outBuf = Buffer.from(await out.blob.arrayBuffer()); outType = out.blob.type; w = out.w; h = out.h; ext = out.ext; note = out.note || ""; }
    const outKey = `${pid}:${jid}-out-${Date.now()}`;
    store.putBlob(outKey, outBuf, outType);
    const suffix = s.mode === "white" ? "白底" : s.mode === "refine" ? "精修" : "处理";
    const outName = `${String(j.name || "图片").replace(/\.[^.]+$/, "")}-${suffix}-${w}x${h}${ext}`;
    const p1 = store.getProject(pid);
    const item = p1 ? await lib.add(outBuf, { grp: p1.name, source: "cutout", tag: s.mode === "white" ? "白底图" : "AI 生成", name: outName, used: { type: "cutout", id: pid, name: p1.name } }).catch(() => null) : null;
    edit(pid, (p) => {
      const x = p.jobs.find((y) => y.id === jid);
      if (!x) return false;
      if (x.outKey && x.outKey !== outKey) delBlob(x.outKey);
      Object.assign(x, { status: "done", job: "", outKey, w, h, ext, note, outName, libId: item ? item.id : "", aiText: r.text || "", ended: Date.now() });
      const f = p.files.find((y) => y.id === x.fileId);
      if (f) f.done = true;
    });
  })().catch((e) => {
    const msg = String((e && e.message) || e);
    editJob(pid, jid, (x) => { x.status = /已取消/.test(msg) ? "stopped" : "failed"; x.job = ""; x.error = /已取消/.test(msg) ? "已停止" : msg; });
  }).finally(() => { running.delete(k); fs.rmSync(tmpDir, { recursive: true, force: true }); });
}

// ------------------------------------------------------------ 网页发来的操作
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && typeof o[k] === "string").map((k) => [k, o[k]]));
const FILE_KEYS = ["crop", "lasso", "colors", "partsNote", "parts", "rot90", "fine", "curKey", "w", "h", "type", "maskKey", "req", "productName", "skip"];
export async function op(pid, b) {
  const ST = getST();
  const p0 = store.getProject(pid);
  if (!p0 || p0.kind !== "cutout") throw new Error("没有这个抠白底图项目");
  switch (b.op) {
    case "settings": return edit(pid, (p) => { p.settings = { ...DEFAULT_SETTINGS, ...p.settings, ...(b.settings || {}) }; });
    case "addFile": {
      const f = store.getBlob(b.key);
      if (!f) throw new Error("图片没传上来");
      const file = { id: b.id || ST.uid("f"), name: String(b.name || "图片").slice(0, 100), key: b.key, curKey: b.key, w: +b.w || 0, h: +b.h || 0, ow: +b.w || 0, oh: +b.h || 0, type: f.type, size: f.buf.length, crop: null, lasso: null, colors: [], parts: [], partsNote: "", rot90: 0, fine: 0, done: false };
      // after = 加在这张后面（去白边另存的新图）
      const p = edit(pid, (q) => { const i = b.after ? q.files.findIndex((x) => x.id === b.after) : -1; i >= 0 ? q.files.splice(i + 1, 0, file) : q.files.push(file); });
      if (!b.fromLibrary) lib.add(f.buf, { grp: p.name, source: "cutout", tag: b.libTag === "白底图" ? "白底图" : "原图", name: file.name, used: { type: "cutout", id: pid, name: p.name } }).catch(() => {});
      return p;
    }
    case "setFile": return edit(pid, (p) => {
      const f = p.files.find((x) => x.id === b.fid);
      if (!f) return false;
      for (const k of FILE_KEYS) if (k in (b.fields || {})) {
        if ((k === "curKey" || k === "maskKey") && f[k] && f[k] !== b.fields[k] && f[k] !== f.key) delBlob(f[k]);
        f[k] = b.fields[k];
      }
    });
    case "delFiles": return edit(pid, (p) => {
      const ids = new Set(b.fids || []);
      for (const f of p.files.filter((x) => ids.has(x.id))) { if (!p.jobs.some((j) => j.fileId === f.id)) [f.key, f.curKey, f.maskKey].forEach((k) => k && delBlob(k)); }
      p.files = p.files.filter((x) => !ids.has(x.id));
    });
    case "addJobs": {
      // 网页准备好的：[{ id, fileId, inKey, extraKeys, prompt, aiRatio, inSize, name, req, productName }]
      const list = (b.jobs || []).filter((j) => j.inKey && j.prompt);
      const p = edit(pid, (q) => {
        let rot = q.jobs.length;
        for (const j of list) {
          const old = j.redoOf && q.jobs.find((x) => x.id === j.redoOf);
          const rec = { id: j.id || ST.uid("j"), fileId: j.fileId, name: j.name, inKey: j.inKey, extraKeys: j.extraKeys || [], prompt: j.prompt, aiRatio: j.aiRatio, inSize: j.inSize, req: j.req || "", productName: j.productName || "", settings: { ...q.settings, ...pick(j.over, ["format", "refineBg"]) }, site: SITE_OK.includes(q.settings.site) ? q.settings.site : "", rot: rot++, status: "queued", job: "排队中", created: Date.now() };
          if (old) { [old.inKey, ...(old.extraKeys || []), old.aiKey, old.outKey].forEach((k) => k && k !== rec.inKey && delBlob(k)); Object.assign(old, rec, { id: old.id, run: old.run || 0 }); }
          else q.jobs.unshift(rec);
        }
      });
      for (const j of list) runJob(pid, j.redoOf || j.id);
      return p;
    }
    case "stop": {
      Q.cancelOwner("project", pid);
      return edit(pid, (p) => { for (const j of p.jobs) if (j.status === "queued" || j.status === "running") Object.assign(j, { status: "stopped", job: "", error: "已停止" }); });
    }
    case "delJobs": return edit(pid, (p) => {
      const ids = new Set(b.jids || []);
      for (const j of p.jobs.filter((x) => ids.has(x.id))) [j.inKey, ...(j.extraKeys || []), j.aiKey, j.outKey].forEach((k) => k && delBlob(k));
      p.jobs = p.jobs.filter((x) => !ids.has(x.id));
    });
    case "replaceFile": {
      // 产品图去白边“保存”：替换原图（编辑框里的旋转已经在图里了）
      const f = store.getBlob(b.key);
      if (!f) throw new Error("图片没传上来");
      return edit(pid, (p) => {
        const x = p.files.find((y) => y.id === b.fid);
        if (!x) return false;
        if (!p.jobs.some((j) => j.fileId === x.id)) [x.key, x.curKey].forEach((k) => k && k !== b.key && delBlob(k));
        Object.assign(x, { key: b.key, curKey: b.key, type: f.type, size: f.buf.length, name: String(b.name || x.name).slice(0, 100), w: +b.w || x.w, h: +b.h || x.h, ow: +b.w || x.ow, oh: +b.h || x.oh, rot90: 0, fine: 0 });
      });
    }
    case "replaceOutput": {
      // 结果去白边“保存”：替换做好的图，素材中心里那张也换掉
      const j = p0.jobs.find((x) => x.id === b.jid);
      const f = store.getBlob(b.key);
      if (!j || !f) throw new Error("这条结果没有了");
      if (j.libId) await lib.replace(j.libId, f.buf).catch(() => {});
      return edit(pid, (p) => {
        const x = p.jobs.find((y) => y.id === b.jid);
        if (!x) return false;
        if (x.outKey && x.outKey !== b.key) delBlob(x.outKey);
        Object.assign(x, { outKey: b.key, w: +b.w || x.w, h: +b.h || x.h });
      });
    }
    case "addEdited": {
      // 结果去白边另存：加一条新结果，放在原来那条后面；新图也放进素材中心
      const j = p0.jobs.find((x) => x.id === b.jid);
      const f = store.getBlob(b.key);
      if (!j || !f) throw new Error("这条结果没有了");
      const id = ST.uid("j");
      const src = store.getBlob(j.inKey);
      const inKey = src ? `${pid}:${id}-in-${Date.now()}` : "";
      if (src) store.putBlob(inKey, src.buf, src.type);
      const name = String(b.name || "去白边.png").slice(0, 120);
      const item = await lib.add(f.buf, { grp: p0.name, source: "cutout", tag: "白底图", name, used: { type: "cutout", id: pid, name: p0.name } }).catch(() => null);
      return edit(pid, (p) => {
        const i = p.jobs.findIndex((x) => x.id === j.id);
        const rec = { ...j, id, inKey, extraKeys: [], aiKey: "", outKey: b.key, outName: name, ext: ".png", w: +b.w || j.w, h: +b.h || j.h, status: "done", job: "", error: "", note: "去白边", libId: item ? item.id : "", created: Date.now(), ended: Date.now() };
        p.jobs.splice(i < 0 ? 0 : i + 1, 0, rec);
      });
    }
    case "useOutput": {
      // 结果拿来接着做：换掉现有的产品图（和插件的“添加到产品图”一样）
      const j = p0.jobs.find((x) => x.id === b.jid);
      const f = j && store.getBlob(j.outKey);
      if (!f) throw new Error("这张还没做好");
      const fid = ST.uid("f");
      const key = `${pid}:${fid}-orig`;
      store.putBlob(key, f.buf, f.type);
      return edit(pid, (p) => { if (b.replace) p.files = []; p.files.push({ id: fid, name: j.outName || "结果.jpg", key, curKey: key, w: j.w, h: j.h, ow: j.w, oh: j.h, type: f.type, size: f.buf.length, crop: null, lasso: null, colors: [], parts: [], partsNote: "", rot90: 0, fine: 0, done: false }); });
    }
    default: throw new Error("不认识的操作：" + b.op);
  }
}

/** 服务器启动时：没做完的接着做 */
export function resumeAll() {
  for (const s of store.listProjects("cutout")) {
    const p = store.getProject(s.id);
    for (const j of p.jobs || []) if (j.status === "queued" || j.status === "running") runJob(p.id, j.id, true);
  }
}
