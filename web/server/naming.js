/**
 * 项目名称（Lee 2026-10-24）：前缀-名字月-日-序号，比如“主图-钱包10-24-1”。
 * 前缀：白底图 / 主图 / 详情图；名字是用户起的（不填就是“未命名”）；序号是北京时间当天第几个新建的项目，
 * 三个模块一起数，删了项目也不回退。项目建好以后不能改名（project.fixedName = true）。
 */
import { kvGet, kvSet } from "./db.js";

export const PREFIX = { cutout: "白底图", main: "主图", detail: "详情图" };

/** 北京时间的 年-月-日 */
export function bjDate(ms = Date.now()) {
  const d = new Date(ms + 8 * 3600 * 1000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
}
const p2 = (n) => String(n).padStart(2, "0");

export function projectName(kind, name) {
  const t = bjDate();
  const key = `projSeq:${t.y}-${p2(t.m)}-${p2(t.d)}`;
  const n = (Number(kvGet(key)) || 0) + 1;
  kvSet(key, n);
  const base = String(name || "").replace(/[\\/:*?"<>|\r\n\t]+/g, " ").trim().slice(0, 30) || "未命名";
  return `${PREFIX[kind] || PREFIX.detail}-${base}${p2(t.m)}-${p2(t.d)}-${n}`;
}

/** 时间戳文件名：20261024153012（北京时间） */
export function stamp(ms = Date.now()) {
  const t = bjDate(ms);
  return `${t.y}${p2(t.m)}${p2(t.d)}${p2(t.h)}${p2(t.mi)}${p2(t.s)}`;
}
