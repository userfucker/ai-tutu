/**
 * 素材中心（Lee 2026-10-24）：工作台里所有图片的中转站，不用存到电脑再上传。
 *
 * 放进来的图：自己上传 / 粘贴的、淘宝采集插件发来的、AI图图 插件做好的、抠白底 / 主图 / 详情页做出来的（自动放进来）。
 * 每张图：分组 grp（比如“淘宝：男士长款钱包”“主图-钱包10-24-1”）、来源 source、类型 tag（原图 / 白底图 / 主图 / 详情图 / SKU图 / AI 生成）、
 * 尺寸、文件大小、用在了哪些项目 used。同一张图（内容一样）只存一份。
 * 文件：data/files/library/<编号>.<扩展名>，小图 data/files/library/thumbs/<编号>.jpg。不自动删除。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { db, uid } from "./db.js";
import { FILES_DIR } from "./config.js";
import { broadcast } from "./events.js";
import { stamp } from "./naming.js";

const DIR = path.join(FILES_DIR, "library");
const THUMB = path.join(DIR, "thumbs");
fs.mkdirSync(THUMB, { recursive: true });

db.exec(`CREATE TABLE IF NOT EXISTS library (
  id TEXT PRIMARY KEY, name TEXT, grp TEXT, source TEXT, tag TEXT, file TEXT, mime TEXT,
  w INTEGER, h INTEGER, size INTEGER, sha1 TEXT, used TEXT, created INTEGER
);
CREATE INDEX IF NOT EXISTS library_grp ON library(grp);
CREATE INDEX IF NOT EXISTS library_sha1 ON library(sha1);`);

const S = {
  ins: db.prepare("INSERT INTO library (id, name, grp, source, tag, file, mime, w, h, size, sha1, used, created) VALUES (@id, @name, @grp, @source, @tag, @file, @mime, @w, @h, @size, @sha1, @used, @created)"),
  get: db.prepare("SELECT * FROM library WHERE id = ?"),
  bySha: db.prepare("SELECT * FROM library WHERE sha1 = ? AND grp = ?"),
  del: db.prepare("DELETE FROM library WHERE id = ?"),
  setUsed: db.prepare("UPDATE library SET used = ? WHERE id = ?"),
  all: db.prepare("SELECT * FROM library ORDER BY created DESC, id DESC"),
};
export const SOURCES = { upload: "上传", taobao: "淘宝采集", aitutu: "AI图图 插件", cutout: "抠白底图", main: "主图制作", detail: "详情页" };
export const TAGS = ["原图", "白底图", "主图", "详情图", "SKU图", "AI 生成"];

const view = (r) => r && ({ id: r.id, name: r.name, grp: r.grp, source: r.source, sourceName: SOURCES[r.source] || r.source, tag: r.tag, w: r.w, h: r.h, size: r.size, mime: r.mime, used: JSON.parse(r.used || "[]"), created: r.created });
const extOf = (mime) => (/png/.test(mime) ? "png" : /webp/.test(mime) ? "webp" : /gif/.test(mime) ? "gif" : "jpg");
const mimeOf = (buf) => (buf[0] === 0x89 && buf[1] === 0x50 ? "image/png" : buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg" : buf.slice(0, 4).toString() === "RIFF" ? "image/webp" : buf.slice(0, 3).toString() === "GIF" ? "image/gif" : "");
export const filePath = (r) => path.join(DIR, r.file);
export const thumbPath = (id) => path.join(THUMB, `${id}.jpg`);

/** 同一次发送里的序号：淘宝发来的图用时间戳命名（20261024153012-1.jpg，Lee 2026-10-24） */
let lastStamp = "", seq = 0;
export function stampName(ext) {
  const s = stamp();
  seq = s === lastStamp ? seq + 1 : 1;
  lastStamp = s;
  return `${s}-${seq}.${ext}`;
}

/**
 * 放一张图进来。o = { name, grp, source, tag, used: {type, id, name}, stampName（用时间戳命名） }
 * 同一组里已经有一模一样的图就不再存，返回原来那张（并把 used 合进去）
 */
export async function add(buf, o = {}) {
  const mime = mimeOf(buf);
  if (!mime) throw new Error("不是图片（只认 JPG / PNG / WebP / GIF）");
  const sha1 = crypto.createHash("sha1").update(buf).digest("hex");
  const grp = String(o.grp || "未分组").slice(0, 80);
  const old = S.bySha.get(sha1, grp);
  if (old) { if (o.used) markUsed([old.id], o.used); return view(S.get.get(old.id)); }
  const id = uid("L");
  const ext = extOf(mime);
  const file = `${id}.${ext}`;
  fs.writeFileSync(path.join(DIR, file), buf);
  let w = 0, h = 0;
  try {
    const img = await loadImage(buf);
    w = img.width; h = img.height;
    const s = Math.min(1, 360 / Math.max(w, h));
    const c = createCanvas(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
    const g = c.getContext("2d");
    if (mime === "image/png") { g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height); } // 透明图的小图用白底看
    g.drawImage(img, 0, 0, c.width, c.height);
    fs.writeFileSync(thumbPath(id), c.toBuffer("image/jpeg", 80));
  } catch { /* 解不开的图也收着，只是没有小图 */ }
  const name = o.stampName ? stampName(ext) : String(o.name || stampName(ext)).replace(/[\\/:*?"<>|\r\n\t]+/g, "_").slice(0, 100);
  S.ins.run({ id, name, grp, source: SOURCES[o.source] ? o.source : "upload", tag: TAGS.includes(o.tag) ? o.tag : "原图", file, mime, w, h, size: buf.length, sha1, used: JSON.stringify(o.used ? [o.used] : []), created: Date.now() });
  broadcast("library", { added: id, grp });
  return view(S.get.get(id));
}

export function get(id) { return view(S.get.get(id)); }
export function raw(id) { return S.get.get(id); }
export function read(id) { const r = S.get.get(id); return r ? { buf: fs.readFileSync(filePath(r)), mime: r.mime, row: view(r) } : null; }

/** 列表：可以按分组、类型、来源筛选；同时给出各组的张数、大小，以及全部加起来多大 */
export function list(q = {}) {
  const rows = S.all.all();
  const groups = new Map();
  let n = 0, size = 0;
  for (const r of rows) {
    n++; size += r.size;
    const g = groups.get(r.grp) || { name: r.grp, n: 0, size: 0, last: 0 };
    g.n++; g.size += r.size; g.last = Math.max(g.last, r.created);
    groups.set(r.grp, g);
  }
  const items = rows.filter((r) => (!q.grp || r.grp === q.grp) && (!q.tag || r.tag === q.tag) && (!q.source || r.source === q.source)).map(view);
  return { items, groups: [...groups.values()].sort((a, b) => b.last - a.last), total: { n, size }, tags: TAGS, sources: SOURCES };
}

export function remove(ids) {
  let n = 0;
  for (const id of ids || []) {
    const r = S.get.get(id);
    if (!r) continue;
    fs.rmSync(filePath(r), { force: true });
    fs.rmSync(thumbPath(id), { force: true });
    S.del.run(id);
    n++;
  }
  if (n) broadcast("library", { removed: n });
  return n;
}

/** 记一笔：这些图用在了哪个项目 */
export function markUsed(ids, use) {
  for (const id of ids) {
    const r = S.get.get(id);
    if (!r) continue;
    const used = JSON.parse(r.used || "[]").filter((u) => !(u.type === use.type && u.id === use.id));
    used.push({ type: use.type, id: use.id, name: use.name || "" });
    S.setUsed.run(JSON.stringify(used.slice(-20)), id);
  }
}
