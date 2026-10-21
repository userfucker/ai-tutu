/**
 * 和浏览器插件的连接：插件连 ws://服务器:端口/ext。
 *  - ai-web（DeepSeek / 智谱 / Kimi / 豆包；千问不用了）：协议见 ai-web 仓库 docs/protocol.md，这里原样兼容
 *  - AI图图（Gemini / Copilot）：hello 里带 app: "aitutu"，命令 run（写文字 / 看图 / 画图）
 *  - 淘宝采集（淘宝 / 天猫）：hello 里带 app: "taobao"，命令 collect（按链接采集）
 * 可以同时连好几个插件；同一台电脑上同一种插件重连时顶替旧的连接。
 */
import { EventEmitter } from "node:events";
import { WebSocketServer } from "ws";
import { extToken } from "./auth.js";

export const SITE_NAMES = {
  deepseek: "DeepSeek", glm: "智谱清言", kimi: "Kimi", doubao: "豆包",
  gemini: "Gemini", copilot: "Copilot", taobao: "淘宝 / 天猫",
};
export const APP_NAMES = { aiweb: "ai-web", aitutu: "AI图图", taobao: "淘宝采集" };

class Bridge extends EventEmitter {
  constructor() {
    super();
    this.conns = new Map(); // id → conn
    this.seq = 0;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
    setInterval(() => {
      for (const c of this.conns.values()) { try { c.ws.send(JSON.stringify({ type: "ping", t: Date.now() })); } catch {} }
    }, 25000).unref();
  }

  handleUpgrade(req, socket, head) {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, req));
  }

  onConnection(ws, req) {
    let conn = null;
    ws.on("message", (raw) => {
      let m;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.type === "hello") {
        if (m.token !== extToken()) {
          ws.send(JSON.stringify({ type: "error", error: "插件口令不对（在工作台网页“AI 连接”里看）", fatal: true }));
          setTimeout(() => ws.close(), 100);
          return;
        }
        ws.send(JSON.stringify({ type: "welcome", server: "AI图图 工作台" }));
        if (m.test) { setTimeout(() => ws.close(), 200); return; }
        const app = m.app === "aitutu" || m.app === "taobao" ? m.app : "aiweb";
        const name = String(m.name || req.socket.remoteAddress || "插件");
        // 同一台电脑、同一种插件：顶替旧连接
        for (const [id, c] of this.conns) if (c.app === app && c.name === name && c.ws !== ws) { try { c.ws.close(); } catch {} this.drop(id); }
        conn = { id: `c${++this.seq}`, ws, app, name, version: String(m.version || ""), since: Date.now(), sites: new Map(), pending: new Map() };
        for (const s of m.sites || []) if (s && s.site) conn.sites.set(s.site, { ...s, name: s.name || SITE_NAMES[s.site] || s.site });
        this.conns.set(conn.id, conn);
        this.emit("status");
        return;
      }
      if (!conn) return;
      if (m.type === "ping") { try { ws.send(JSON.stringify({ type: "pong", t: m.t })); } catch {} return; }
      if (m.type === "event" && m.event === "tab" && m.site) {
        conn.sites.set(m.site, { ...(conn.sites.get(m.site) || {}), ...(m.data || {}), site: m.site, name: SITE_NAMES[m.site] || m.site });
        this.emit("status");
        return;
      }
      if (m.type === "event" && m.event === "sites" && Array.isArray(m.sites)) {
        for (const s of m.sites) conn.sites.set(s.site, { ...(conn.sites.get(s.site) || {}), ...s, name: SITE_NAMES[s.site] || s.site });
        this.emit("status");
        return;
      }
      if (m.type === "progress") { const p = conn.pending.get(m.id); if (p && p.onProgress) p.onProgress(m); return; }
      if (m.type === "result") {
        const p = conn.pending.get(m.id);
        if (!p) return;
        conn.pending.delete(m.id);
        clearTimeout(p.timer);
        p.resolve({ ok: !!m.ok, data: m.data || {} });
      }
    });
    ws.on("close", () => { if (conn) this.drop(conn.id); });
    ws.on("error", () => {});
  }

  drop(id) {
    const c = this.conns.get(id);
    if (!c) return;
    this.conns.delete(id);
    for (const [, p] of c.pending) { clearTimeout(p.timer); p.resolve({ ok: false, data: { error: "插件断开了", disconnected: true } }); }
    c.pending.clear();
    this.emit("status");
  }

  /** 给某个插件的某个网站发命令，等结果 */
  call(connId, site, cmd, args = {}, { timeout = 600000, onProgress } = {}) {
    const c = this.conns.get(connId);
    if (!c) return Promise.resolve({ ok: false, data: { error: "插件没连上", disconnected: true } });
    const id = `k${++this.seq}_${Date.now()}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { c.pending.delete(id); resolve({ ok: false, data: { error: `等了 ${Math.round(timeout / 60000)} 分钟没结果`, timeout: true } }); }, timeout);
      c.pending.set(id, { resolve, onProgress, timer });
      try { c.ws.send(JSON.stringify({ type: "cmd", id, site, cmd, args })); }
      catch (e) { clearTimeout(timer); c.pending.delete(id); resolve({ ok: false, data: { error: "发不出去：" + e.message, disconnected: true } }); }
    });
  }

  /** 所有插件和网站：[{ connId, app, name, version, since, sites: [...] }] */
  status() {
    return [...this.conns.values()].map((c) => ({
      connId: c.id, app: c.app, appName: APP_NAMES[c.app], name: c.name, version: c.version, since: c.since,
      sites: [...c.sites.values()].map((s) => ({ site: s.site, name: s.name || SITE_NAMES[s.site] || s.site, open: !!s.open, ready: !!s.ready, url: s.url || "" })),
    }));
  }
  /** 能做这个网站的插件连接 */
  connsFor(site) { return [...this.conns.values()].filter((c) => c.sites.has(site)); }
  siteInfo(connId, site) { const c = this.conns.get(connId); return c ? c.sites.get(site) : null; }
}

export const bridge = new Bridge();
