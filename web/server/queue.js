/**
 * AI 任务队列（存在数据库里，服务器重启后接着做）。
 *
 * 任务种类：
 *   text    写文字（文案、翻译、给评价打标签、写报告）→ ai-web 的网站，或者 AI图图 的 Gemini / Copilot
 *   vision  看图写文字（认图、分析参考图、验图）      → AI图图（ai-web 不能发图片）
 *   image   画图（背景、场景、抠图用的白底图）        → AI图图
 *   collect 按链接采集商品数据                       → 淘宝采集插件
 * 哪种任务先交给哪个网站，在“设置 → AI 分工”里排顺序；排在前面的忙、额度用完、没连上，就换下一个。
 * 同一个网站一次只做一个任务，做完随机隔几秒再做下一个。不同网站可以同时做。
 */
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { db, kvGet, kvSet } from "./db.js";
import { bridge, SITE_NAMES } from "./bridge.js";
import { broadcast } from "./events.js";
import { FILES_DIR } from "./config.js";

export const DEFAULT_ROLES = {
  text: ["deepseek", "kimi", "doubao", "glm"], // 写文字默认用国内模型；Gemini / Copilot 可以在“AI 分工”里勾上（Lee 2026-10-21）
  vision: ["gemini", "copilot"],
  image: ["gemini", "copilot"],
  read: ["kimi", "doubao", "glm", "deepseek", "gemini", "copilot"], // 看详情图：国产优先（要 ai-web 1.4.0 以上才能发图片），不行再用 Gemini / Copilot
  collect: ["taobao"],
};
export const ROLE_NAMES = { text: "写文字（文案、翻译、评价分析、报告）", vision: "看图（认图、分析参考图、验图）", image: "画图（背景、抠图）", read: "看详情图（读详情页图片里的字）", collect: "采集商品数据" };
const DEFAULT_GAPS = { text: [2, 6], vision: [6, 15], image: [8, 20], read: [6, 15], collect: [5, 12] };
const LIMIT_RE = /限流|额度|频繁|上限|繁忙|拥挤|busy|too many|rate limit|quota|稍后再试|try again later/i;
const COOLDOWN_MS = 10 * 60 * 1000;

const emitter = new EventEmitter();
emitter.setMaxListeners(0);
const siteState = new Map(); // "connId|site" → { busy, cooldownUntil, nextAt, why }
const st = (connId, site) => {
  const k = `${connId}|${site}`;
  if (!siteState.has(k)) siteState.set(k, { busy: false, cooldownUntil: 0, nextAt: 0, why: "" });
  return siteState.get(k);
};
export const roles = () => ({ ...DEFAULT_ROLES, ...(kvGet("aiRoles") || {}) });
// 老版本存的分工：写文字换成新的默认（国内模型），千问去掉（2026-10-21）
if (kvGet("rolesVer") !== 2) {
  const old = kvGet("aiRoles");
  if (old) { delete old.text; for (const k of Object.keys(old)) old[k] = (old[k] || []).filter((s) => s !== "qwen"); kvSet("aiRoles", old); }
  kvSet("rolesVer", 2);
}
const gaps = () => (process.env.QUEUE_FAST ? { text: [0, 0], vision: [0, 0], image: [0, 0], read: [0, 0], collect: [0, 0] } : { ...DEFAULT_GAPS, ...(kvGet("gaps") || {}) });

const Q = {
  insert: db.prepare(`INSERT INTO tasks (key, kind, label, owner_type, owner_id, payload, status, priority, max_attempts, created)
    VALUES (@key, @kind, @label, @owner_type, @owner_id, @payload, 'queued', @priority, @max_attempts, @created)`),
  byKey: db.prepare("SELECT * FROM tasks WHERE key = ?"),
  progress: db.prepare("UPDATE tasks SET progress = ? WHERE id = ?"),
  byId: db.prepare("SELECT * FROM tasks WHERE id = ?"),
  queued: db.prepare("SELECT * FROM tasks WHERE status = 'queued' ORDER BY priority DESC, id ASC LIMIT 200"),
  setPayload: db.prepare("UPDATE tasks SET payload = ? WHERE id = ?"),
  update: db.prepare(`UPDATE tasks SET status=@status, site=@site, worker=@worker, result=@result, error=@error, progress=@progress,
    attempts=@attempts, not_before=@not_before, started=@started, finished=@finished WHERE id=@id`),
};
db.prepare("UPDATE tasks SET status='queued', progress=NULL WHERE status='running'").run(); // 重启：做到一半的重新排队

const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
export function view(row) {
  if (!row) return null;
  return {
    id: row.id, key: row.key, kind: row.kind, label: row.label, ownerType: row.owner_type, ownerId: row.owner_id,
    status: row.status, site: row.site, siteName: SITE_NAMES[row.site] || row.site || "", worker: row.worker,
    error: row.error, progress: row.progress, attempts: row.attempts, created: row.created, started: row.started, finished: row.finished,
  };
}
const save = (row) => { Q.update.run(row); broadcast("task", view(row)); };

/** 排一个任务（有 key 且已经存在就返回原来的） */
export function enqueue(spec) {
  if (spec.key) {
    const old = Q.byKey.get(spec.key);
    if (old) {
      if (old.status === "failed" || old.status === "cancelled") {
        if (!spec.retryFailed) return old;
        // 重新排队：用这次的内容（比如图片换了新的临时文件）
        Object.assign(old, { status: "queued", error: null, attempts: 0, not_before: 0, result: null, progress: null, payload: JSON.stringify(spec.payload || {}) });
        Q.setPayload.run(old.payload, old.id);
        save(old);
        tick();
      }
      return old;
    }
  }
  const info = Q.insert.run({
    key: spec.key || null, kind: spec.kind, label: spec.label || "", owner_type: spec.ownerType || null, owner_id: spec.ownerId || null,
    payload: JSON.stringify(spec.payload || {}), priority: spec.priority || 0, max_attempts: spec.maxAttempts || (spec.kind === "collect" ? 2 : 3), created: Date.now(),
  });
  const row = Q.byId.get(info.lastInsertRowid);
  broadcast("task", view(row));
  setImmediate(tick);
  return row;
}

/** 等任务做完：成功返回结果，失败抛错（err.task 是任务） */
export function wait(id) {
  return new Promise((resolve, reject) => {
    const check = () => {
      const row = Q.byId.get(id);
      if (!row) { reject(new Error("任务不存在")); return true; }
      if (row.status === "done") { resolve(parse(row.result)); return true; }
      if (row.status === "failed" || row.status === "cancelled") { reject(Object.assign(new Error(row.error || (row.status === "cancelled" ? "已取消" : "失败")), { task: view(row) })); return true; }
      return false;
    };
    if (check()) return;
    const fn = () => { if (check()) emitter.off(`end:${id}`, fn); };
    emitter.on(`end:${id}`, fn);
  });
}
/** 排任务并等结果（流水线用：同一个 key 重复调用不会重复做） */
export async function ensure(spec) {
  const row = enqueue(spec);
  return wait(row.id);
}

export function get(id) { return view(Q.byId.get(id)); }
export function rawResult(id) { const r = Q.byId.get(id); return r ? parse(r.result) : null; }
export function list({ status, ownerType, ownerId, limit = 200 } = {}) {
  const where = [], args = [];
  if (status) { where.push("status = ?"); args.push(status); }
  if (ownerType) { where.push("owner_type = ?"); args.push(ownerType); }
  if (ownerId) { where.push("owner_id = ?"); args.push(ownerId); }
  const sql = `SELECT * FROM tasks ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, id DESC LIMIT ${Number(limit) || 200}`;
  return db.prepare(sql).all(...args).map(view);
}
export function counts() {
  const out = { queued: 0, running: 0, failed: 0, done: 0 };
  for (const r of db.prepare("SELECT status, COUNT(*) n FROM tasks GROUP BY status").all()) out[r.status] = r.n;
  return out;
}
export function cancel(id) {
  const row = Q.byId.get(id);
  if (!row || row.status === "done") return false;
  if (row.status === "running" && row.worker) {
    const [connId] = row.worker.split("|");
    bridge.call(connId, row.site, "stop", {}, { timeout: 15000 }).catch(() => {});
  }
  Object.assign(row, { status: "cancelled", error: "已取消", finished: Date.now() });
  save(row);
  emitter.emit(`end:${id}`);
  return true;
}
export function cancelOwner(ownerType, ownerId) {
  for (const r of db.prepare("SELECT id FROM tasks WHERE owner_type=? AND owner_id=? AND status IN ('queued','running')").all(ownerType, ownerId)) cancel(r.id);
}
export function retry(id) {
  const row = Q.byId.get(id);
  if (!row || (row.status !== "failed" && row.status !== "cancelled")) return false;
  Object.assign(row, { status: "queued", error: null, attempts: 0, not_before: 0, progress: null });
  save(row);
  tick();
  return true;
}
export function bump(id) {
  db.prepare("UPDATE tasks SET priority = (SELECT COALESCE(MAX(priority),0)+1 FROM tasks) WHERE id = ? AND status='queued'").run(id);
  broadcast("task", get(id));
  tick();
}

/** 每个网站现在的状态（AI 连接页面显示） */
export function siteStates() {
  const out = {};
  for (const [k, v] of siteState) out[k] = { busy: v.busy, cooldownUntil: v.cooldownUntil, why: v.why };
  return out;
}

// ------------------------------------------------------------ 派活
let ticking = false, again = false;
export function tick() {
  if (ticking) { again = true; return; }
  ticking = true;
  try {
    do {
      again = false;
      const now = Date.now();
      for (const row of Q.queued.all()) {
        if (row.not_before && row.not_before > now) continue;
        const payload = parse(row.payload) || {};
        const role = payload.role || (row.kind === "text" && payload.images && payload.images.length ? "vision" : row.kind);
        let order = payload.sites && payload.sites.length ? payload.sites : roles()[role] || [];
        // 这个任务在某个网站失败过：先换别的网站；都失败过了再从头来
        const bad = badSites.get(row.id);
        if (bad && order.some((x) => !bad.has(x) && bridge.connsFor(x).length)) order = order.filter((x) => !bad.has(x));
        let pick = null;
        for (const site of order) {
          for (const c of bridge.connsFor(site)) {
            if (c.app === "aiweb" && role !== "text" && !(role === "read" && verAtLeast(c.version, "1.4.0"))) continue; // ai-web 只能写文字；1.4.0 起能发图片看详情图
            const s = st(c.id, site);
            if (!s.busy && now >= s.cooldownUntil && now >= s.nextAt) { pick = { conn: c, site }; break; }
          }
          if (pick) break;
        }
        if (pick) run(row, payload, pick.conn, pick.site);
      }
    } while (again);
  } finally { ticking = false; }
}
setInterval(tick, 2000).unref();
const badSites = new Map(); // 任务编号 → 失败过的网站
const verAtLeast = (v, want) => { const a = String(v || "0").split(".").map(Number), b = want.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i]; } return true; };
bridge.on("status", () => setImmediate(tick));

function readImages(list) {
  return (list || []).map((im) => {
    const buf = fs.readFileSync(path.join(FILES_DIR, im.file));
    const mime = im.mime || (/\.png$/i.test(im.file) ? "image/png" : /\.webp$/i.test(im.file) ? "image/webp" : "image/jpeg");
    return { b64: buf.toString("base64"), mime, name: im.name || path.basename(im.file) };
  });
}

async function run(row, payload, conn, site) {
  const s = st(conn.id, site);
  s.busy = true;
  Object.assign(row, { status: "running", site, worker: `${conn.id}|${site}`, started: Date.now(), progress: "开始", attempts: (row.attempts || 0) + 1, error: null });
  save(row);
  // 进度最多一秒存一次；要紧的（滑块、验证、登录）马上存，其他的一秒内来了好几条就存最后一条
  let lastProg = 0, pending = null, progTimer = null;
  const flush = () => {
    progTimer = null;
    if (!pending || row.status !== "running") return;
    lastProg = Date.now();
    row.progress = pending; Q.progress.run(pending, row.id); broadcast("task", view(row));
    pending = null;
  };
  const onProgress = (m) => {
    const text = m.msg || (m.answer ? `正在回复：${String(m.answer).slice(-80)}` : "");
    if (!text) return;
    pending = text;
    if (/滑块|验证|登录/.test(text) || Date.now() - lastProg >= 1000) { clearTimeout(progTimer); flush(); }
    else if (!progTimer) progTimer = setTimeout(flush, 1000 - (Date.now() - lastProg));
  };
  let r;
  try {
    if (conn.app === "aiweb") {
      const info = bridge.siteInfo(conn.id, site) || {};
      if (!info.open || !info.ready) {
        row.progress = `打开 ${SITE_NAMES[site] || site}`;
        broadcast("task", view(row));
        const o = await bridge.call(conn.id, site, "open", { timeoutMs: 90000 }, { timeout: 120000 });
        if (!o.ok) throw Object.assign(new Error(o.data.error || "网站打不开"), { data: o.data });
      }
      const files = [...(payload.material ? [{ name: payload.materialName || "材料.txt", content: payload.material }] : []), ...readImages(payload.images)];
      r = await bridge.call(conn.id, site, "ask", { text: payload.prompt, files: files.length ? files : undefined, newChat: payload.newChat !== false, timeoutMs: 600000 }, { timeout: 660000, onProgress });
      if (r.ok && (r.data.error || !r.data.answer)) r = { ok: false, data: { error: r.data.error || "AI 没有回复内容" } };
      if (r.ok) r = { ok: true, result: { text: r.data.answer, codes: [], site } };
    } else if (conn.app === "aitutu") {
      const prompt = payload.material ? `${payload.prompt}\n\n【材料】\n${payload.material}` : payload.prompt;
      const kind = row.kind === "image" ? "image" : "text";
      r = await bridge.call(conn.id, site, "run", { kind, prompt, images: readImages(payload.images), newChat: payload.newChat !== false }, { timeout: 15 * 60000, onProgress });
      if (r.ok && kind === "image") {
        const ext = /png/.test(r.data.mime || "") ? "png" : "jpg";
        const rel = `tasks/${row.id}.${ext}`;
        fs.mkdirSync(path.join(FILES_DIR, "tasks"), { recursive: true });
        fs.writeFileSync(path.join(FILES_DIR, rel), Buffer.from(r.data.b64 || "", "base64"));
        r = { ok: true, result: { file: rel, mime: r.data.mime, text: r.data.text || "", site } };
      } else if (r.ok) r = { ok: true, result: { text: r.data.text || "", codes: r.data.codes || [], site } };
    } else if (conn.app === "taobao") {
      r = await bridge.call(conn.id, site, "collect", payload, { timeout: 120 * 60000, onProgress });
      if (r.ok) {
        const rel = `tasks/${row.id}.json`;
        fs.mkdirSync(path.join(FILES_DIR, "tasks"), { recursive: true });
        fs.writeFileSync(path.join(FILES_DIR, rel), JSON.stringify(r.data));
        r = { ok: true, result: { file: rel, site, summary: { rates: (r.data.rates && r.data.rates.list || []).length, qa: (r.data.qa && r.data.qa.list || []).length, title: r.data.item && r.data.item.title } } };
      }
    } else r = { ok: false, data: { error: "这个插件不能做这种任务" } };
  } catch (e) {
    r = { ok: false, data: { error: String((e && e.message) || e), ...(e && e.data) } };
  }
  const now = Date.now();
  const cur = Q.byId.get(row.id);
  s.busy = false;
  const [g0, g1] = gaps()[row.kind] || [3, 8];
  s.nextAt = now + (g0 + Math.random() * Math.max(0, g1 - g0)) * 1000;
  if (cur && cur.status === "cancelled") { setImmediate(tick); return; }
  if (r.ok) {
    Object.assign(row, { status: "done", result: JSON.stringify(r.result), finished: now, progress: null, error: null });
    badSites.delete(row.id);
    save(row);
  } else {
    const err = String((r.data && r.data.error) || "失败");
    if (!r.data.disconnected) { if (!badSites.has(row.id)) badSites.set(row.id, new Set()); badSites.get(row.id).add(site); }
    const limit = LIMIT_RE.test(err) || r.data.limit;
    if (limit) { s.cooldownUntil = now + COOLDOWN_MS; s.why = err; }
    if (r.data.disconnected) row.attempts = Math.max(0, row.attempts - 1); // 插件断了不算次数
    const giveUp = row.attempts >= (row.max_attempts || 3) && !r.data.disconnected;
    Object.assign(row, giveUp
      ? { status: "failed", error: err, finished: now, progress: null }
      : { status: "queued", error: err, not_before: now + (limit ? 5000 : 15000), progress: `上次失败：${err.slice(0, 60)}，稍后重试` });
    save(row);
  }
  if (row.status === "done" || row.status === "failed") emitter.emit(`end:${row.id}`);
  setImmediate(tick);
}

/** 文件小工具：结果里的文件读出来 */
export const filePath = (rel) => path.join(FILES_DIR, rel);
