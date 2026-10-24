/**
 * 详情页：项目、图片、设置的存取（服务器端）。
 *  项目：数据库 projects 表（data 是整个项目 JSON），rev 每存一次加 1，网页保存时带上 rev，对不上就说明别处改过（比如全自动在做）。
 *  图片：键名“项目编号:名字”→ data/files/blobs/项目编号/名字；“brand:…”“tpl:…”放在 blobs/brand、blobs/tpl 下。
 *  设置：kv 表里的 detail:xxx（品牌、我的模板、预设、平台尺寸、违禁词）。
 */
import fs from "node:fs";
import path from "node:path";
import { db, kvGet, kvSet } from "../db.js";
import { FILES_DIR } from "../config.js";
import { broadcast } from "../events.js";

const BLOB_DIR = path.join(FILES_DIR, "blobs");
fs.mkdirSync(BLOB_DIR, { recursive: true });

const S = {
  get: db.prepare("SELECT * FROM projects WHERE id = ?"),
  all: db.prepare("SELECT id, data, updated FROM projects ORDER BY updated DESC"),
  put: db.prepare(`INSERT INTO projects (id, name, status, data, created, updated) VALUES (@id, @name, @status, @data, @created, @updated)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, status=excluded.status, data=excluded.data, updated=excluded.updated`),
  del: db.prepare("DELETE FROM projects WHERE id = ?"),
};

export function getProject(id) { const r = S.get.get(id); return r ? JSON.parse(r.data) : null; }
/** 存项目。baseRev 给了就检查：和库里的不一样返回 null（别处改过） */
export function putProject(p, baseRev) {
  const old = S.get.get(p.id);
  const oldRev = old ? JSON.parse(old.data).rev || 0 : 0;
  if (baseRev !== undefined && baseRev !== null && old && baseRev !== oldRev) return null;
  p.rev = oldRev + 1;
  p.updated = Date.now();
  if (!p.created) p.created = p.updated;
  S.put.run({ id: p.id, name: p.name || "未命名", status: (p.auto && p.auto.status) || "", data: JSON.stringify(p), created: p.created, updated: p.updated });
  broadcast("project", summary(p));
  return p.rev;
}
export function summary(p) {
  if (p.kind === "main") { // 主图项目（Lee 2026-10-23）
    const pr = (p.products || []).find((x) => x.id === p.cur) || (p.products || [])[0];
    return { id: p.id, kind: "main", name: p.name, updated: p.updated, created: p.created, rev: p.rev || 0, size: p.size, firstAsset: pr ? pr.cut || pr.key : "", items: (p.items || []).length, done: (p.items || []).filter((x) => x.state === "ok").length };
  }
  if (p.kind === "cutout") { // 抠白底图项目
    const f = (p.files || [])[0];
    const done = (p.jobs || []).filter((j) => j.status === "done");
    return { id: p.id, kind: "cutout", name: p.name, updated: p.updated, created: p.created, rev: p.rev || 0, files: (p.files || []).length, done: done.length, running: (p.jobs || []).filter((j) => j.status === "queued" || j.status === "running").length, firstAsset: done[0] ? done[0].outKey : f ? f.curKey || f.key : "" };
  }
  return {
    id: p.id, kind: "detail", name: p.name, updated: p.updated, created: p.created, platform: p.platform, platforms: p.platforms, lang: p.lang, langs: p.langs,
    screens: (p.screens || []).length, assets: (p.assets || []).length, thumb: p.thumb || "", rev: p.rev || 0,
    auto: p.auto ? { status: p.auto.status, step: p.auto.step, msg: p.auto.msg, error: p.auto.error || "", exportFile: p.auto.exportFile || "" } : null,
    firstAsset: (p.assets || []).find((a) => a.tag === "white") ? ((p.assets.find((a) => a.tag === "white").cut) || p.assets.find((a) => a.tag === "white").key) : (p.assets && p.assets[0] && (p.assets[0].cut || p.assets[0].key)) || "",
  };
}
/** kind = detail（详情页，默认）/ main（主图） */
export function listProjects(kind = "detail") { return S.all.all().map((r) => summary(JSON.parse(r.data))).filter((x) => x.kind === kind); }
export function deleteProject(id) {
  S.del.run(id);
  fs.rmSync(path.join(BLOB_DIR, safe(id)), { recursive: true, force: true });
  broadcast("project", { id, deleted: true });
}

// ------------------------------------------------------------ 图片
const safe = (s) => String(s).replace(/[^0-9A-Za-z_.\-一-龥]/g, "_").slice(0, 120) || "_";
/** 键名 → 文件路径 */
export function blobPath(key) {
  const i = String(key).indexOf(":");
  const dir = i > 0 ? key.slice(0, i) : "_misc";
  const name = i > 0 ? key.slice(i + 1) : key;
  return path.join(BLOB_DIR, safe(dir), encodeURIComponent(name).slice(0, 200));
}
export function putBlob(key, buf, type) {
  const f = blobPath(key);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, buf);
  fs.writeFileSync(f + ".type", type || "application/octet-stream");
}
export function getBlob(key) {
  const f = blobPath(key);
  if (!fs.existsSync(f)) return null;
  let type = "application/octet-stream";
  try { type = fs.readFileSync(f + ".type", "utf8"); } catch {}
  return { buf: fs.readFileSync(f), type, file: f };
}
export function delBlob(key) {
  const f = blobPath(key);
  fs.rmSync(f, { force: true });
  fs.rmSync(f + ".type", { force: true });
}
export function blobKeys(prefix) {
  const i = prefix.indexOf(":");
  const dir = path.join(BLOB_DIR, safe(i > 0 ? prefix.slice(0, i) : prefix));
  if (!fs.existsSync(dir)) return [];
  const head = i > 0 ? prefix.slice(0, i) : prefix;
  return fs.readdirSync(dir).filter((n) => !n.endsWith(".type")).map((n) => `${head}:${decodeURIComponent(n)}`).filter((k) => k.startsWith(prefix));
}

// ------------------------------------------------------------ 设置
export const getMeta = (k, def) => kvGet("detail:" + k, def);
export const setMeta = (k, v) => kvSet("detail:" + k, v);
