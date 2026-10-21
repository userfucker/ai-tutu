// 登录：一个管理密码（只有你自己用）；插件口令（插件连服务器时用）
import crypto from "node:crypto";
import { kvGet, kvSet } from "./db.js";

const COOKIE = "aitutu_s";
const DAYS = 30;

function hash(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString("hex");
}
export const isSetup = () => !!kvGet("password");
export function setPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  kvSet("password", { salt, hash: hash(password, salt) });
  kvSet("sessions", {});
}
export function checkPassword(password) {
  const p = kvGet("password");
  if (!p) return false;
  const a = Buffer.from(hash(password, p.salt), "hex"), b = Buffer.from(p.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function newSession() {
  const token = crypto.randomBytes(24).toString("hex");
  const s = kvGet("sessions", {});
  const now = Date.now();
  for (const [k, v] of Object.entries(s)) if (v < now) delete s[k];
  s[token] = now + DAYS * 86400000;
  kvSet("sessions", s);
  return token;
}
export function dropSession(token) {
  const s = kvGet("sessions", {});
  delete s[token];
  kvSet("sessions", s);
}
export function sessionOk(token) {
  if (!token) return false;
  const s = kvGet("sessions", {});
  return !!s[token] && s[token] > Date.now();
}
export function cookieToken(header) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]+)`).exec(header || "");
  return m ? m[1] : "";
}
export const cookieHeader = (token) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86400}`;
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

/** 插件口令：第一次用时随机生成，网页“AI 连接”里能看到、能换 */
export function extToken() {
  let t = kvGet("extToken");
  if (!t) { t = crypto.randomBytes(4).toString("hex"); kvSet("extToken", t); }
  return t;
}
/** 自己设口令（比如和 AI 会议中转站用同一个，ai-web 切换时只改端口） */
export function setExtToken(t) {
  t = String(t || "").trim();
  if (!/^[\x21-\x7e]{4,40}$/.test(t)) throw new Error("口令要 4～40 个字母、数字或符号，不能有空格和中文");
  kvSet("extToken", t);
  return t;
}
export function resetExtToken() {
  const t = crypto.randomBytes(4).toString("hex");
  kvSet("extToken", t);
  return t;
}
