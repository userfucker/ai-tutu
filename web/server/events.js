// 实时推送（SSE）：插件状态、任务变化、分析进度、项目变化
import os from "node:os";
const clients = new Set();
const viewers = new Map(); // send → 打开网页的电脑（IP）

/** IP 统一写法：本机（127.0.0.1、::1、服务器自己的局域网地址）都算 "server" */
export function normIp(ip) {
  const a = String(ip || "").replace(/^::ffff:/, "");
  if (a === "::1" || a.startsWith("127.")) return "server";
  for (const list of Object.values(os.networkInterfaces())) for (const x of list || []) if (x.address === a) return "server";
  return a;
}
export function addClient(send, ip) {
  clients.add(send);
  if (ip) viewers.set(send, normIp(ip));
  return () => { clients.delete(send); viewers.delete(send); };
}
/** 现在开着工作台网页的电脑（AI 作图优先交给别的电脑上的插件，Lee 2026-10-26） */
export const viewerIps = () => new Set(viewers.values());
export function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const send of clients) {
    try { send(msg); } catch { clients.delete(send); viewers.delete(send); }
  }
}
