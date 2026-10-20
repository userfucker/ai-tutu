// 网页接口
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import * as auth from "./auth.js";
import { bridge, SITE_NAMES, APP_NAMES } from "./bridge.js";
import * as queue from "./queue.js";
import { addClient } from "./events.js";
import { kvGet, kvSet } from "./db.js";
import { PUBLIC_DIR, FONT_DIR, REPO_DIR, DATA_DIR, VERSION } from "./config.js";
import * as analysis from "./analysis/pipeline.js";

export const app = new Hono();

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon" };
function sendFile(c, file, extra = {}) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return c.text("没有这个文件", 404);
  const ext = path.extname(file).toLowerCase();
  return new Response(fs.readFileSync(file), { headers: { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": ext === ".woff2" ? "public, max-age=2592000" : "no-cache", ...extra } });
}
const inside = (base, rel) => { const f = path.resolve(base, "." + path.sep + rel); return f.startsWith(path.resolve(base) + path.sep) ? f : null; };

// ------------------------------------------------------------ 登录
app.get("/api/auth/state", (c) => c.json({ setup: auth.isSetup(), authed: auth.sessionOk(auth.cookieToken(c.req.header("cookie"))), version: VERSION }));
app.post("/api/auth/setup", async (c) => {
  if (auth.isSetup()) return c.json({ error: "已经设置过密码了" }, 400);
  const { password } = await c.req.json();
  if (!password || String(password).length < 4) return c.json({ error: "密码至少 4 位" }, 400);
  auth.setPassword(password);
  c.header("Set-Cookie", auth.cookieHeader(auth.newSession()));
  return c.json({ ok: true });
});
app.post("/api/auth/login", async (c) => {
  const { password } = await c.req.json();
  if (!auth.checkPassword(password)) return c.json({ error: "密码不对" }, 401);
  c.header("Set-Cookie", auth.cookieHeader(auth.newSession()));
  return c.json({ ok: true });
});
app.post("/api/auth/logout", (c) => {
  auth.dropSession(auth.cookieToken(c.req.header("cookie")));
  c.header("Set-Cookie", auth.clearCookie());
  return c.json({ ok: true });
});
app.post("/api/auth/password", async (c) => {
  const { old, password } = await c.req.json();
  if (!auth.checkPassword(old)) return c.json({ error: "原密码不对" }, 400);
  if (!password || String(password).length < 4) return c.json({ error: "新密码至少 4 位" }, 400);
  auth.setPassword(password);
  c.header("Set-Cookie", auth.cookieHeader(auth.newSession()));
  return c.json({ ok: true });
});
app.use("/api/*", async (c, next) => {
  if (!auth.sessionOk(auth.cookieToken(c.req.header("cookie")))) return c.json({ error: "请先登录", login: true }, 401);
  await next();
});

// ------------------------------------------------------------ 实时推送
app.get("/api/events", (c) => {
  let off = () => {}, timer = null;
  const body = new ReadableStream({
    start(ctrl) {
      const enc = new TextEncoder();
      const send = (s) => ctrl.enqueue(enc.encode(s));
      off = addClient(send);
      send(": hello\n\n");
      timer = setInterval(() => { try { send(": ping\n\n"); } catch { off(); } }, 20000);
    },
    cancel() { off(); clearInterval(timer); },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
});

// ------------------------------------------------------------ 状态、插件、AI 分工
function disk() {
  try { const s = fs.statfsSync(DATA_DIR); return { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch { return null; }
}
app.get("/api/status", (c) => c.json({
  version: VERSION, workers: bridge.status(), siteStates: queue.siteStates(), counts: queue.counts(), extToken: auth.extToken(),
  roles: queue.roles(), roleNames: queue.ROLE_NAMES, siteNames: SITE_NAMES, appNames: APP_NAMES, disk: disk(),
}));
app.post("/api/ext-token/reset", (c) => c.json({ token: auth.resetExtToken() }));
app.put("/api/roles", async (c) => {
  const { roles } = await c.req.json();
  const clean = {};
  for (const [k, v] of Object.entries(roles || {})) if (queue.DEFAULT_ROLES[k] && Array.isArray(v)) clean[k] = v.filter((s) => SITE_NAMES[s]);
  kvSet("aiRoles", clean);
  queue.tick();
  return c.json({ ok: true, roles: queue.roles() });
});
app.get("/api/settings/:key", (c) => c.json({ value: kvGet("ui:" + c.req.param("key"), null) }));
app.put("/api/settings/:key", async (c) => { const { value } = await c.req.json(); kvSet("ui:" + c.req.param("key"), value); return c.json({ ok: true }); });

// ------------------------------------------------------------ 任务
app.get("/api/tasks", (c) => c.json({ tasks: queue.list({ status: c.req.query("status") || undefined, ownerType: c.req.query("ownerType") || undefined, ownerId: c.req.query("ownerId") || undefined, limit: c.req.query("limit") || 300 }), counts: queue.counts() }));
app.post("/api/tasks/:id/cancel", (c) => c.json({ ok: queue.cancel(Number(c.req.param("id"))) }));
app.post("/api/tasks/:id/retry", (c) => c.json({ ok: queue.retry(Number(c.req.param("id"))) }));
app.post("/api/tasks/:id/bump", (c) => { queue.bump(Number(c.req.param("id"))); return c.json({ ok: true }); });

// ------------------------------------------------------------ 竞品分析
app.get("/api/analyses", (c) => c.json({ list: analysis.listAll(), rateOptions: analysis.RATE_OPTIONS }));
app.post("/api/analyses", async (c) => {
  const b = await c.req.json();
  const rivals = analysis.parseLinks(b.links);
  const oursUrl = analysis.parseLinks(b.oursUrl || "")[0] || "";
  const manual = b.oursManual && Object.values(b.oursManual).some((v) => String(v || "").trim()) ? b.oursManual : null;
  if (!rivals.length && !oursUrl) return c.json({ error: "没有找到淘宝 / 天猫的商品链接（一行一个）" }, 400);
  const an = analysis.create({ name: b.name, rivals, ours: oursUrl ? { url: oursUrl } : manual ? { manual } : null, rates: b.rates, qa: b.qa });
  return c.json({ ok: true, id: an.id });
});
app.get("/api/analyses/:id", (c) => {
  const an = analysis.load(c.req.param("id"));
  if (!an) return c.json({ error: "没有这个分析" }, 404);
  return c.json({ analysis: analysis.summary(an), tasks: queue.list({ ownerType: "analysis", ownerId: an.id, limit: 1000 }) });
});
app.post("/api/analyses/:id/stop", (c) => { analysis.stop(c.req.param("id")); return c.json({ ok: true }); });
app.post("/api/analyses/:id/restart", (c) => { analysis.restart(c.req.param("id")); return c.json({ ok: true }); });
app.post("/api/analyses/:id/rewrite", async (c) => { await analysis.rewrite(c.req.param("id")); return c.json({ ok: true }); });
app.delete("/api/analyses/:id", (c) => { analysis.remove(c.req.param("id")); return c.json({ ok: true }); });
app.get("/api/analyses/:id/report", (c) => {
  const an = analysis.load(c.req.param("id"));
  if (!an) return c.text("没有这个分析", 404);
  const dl = c.req.query("download") ? { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(an.name + "_竞品分析报告.html")}` } : {};
  return sendFile(c, analysis.reportPath(an.id), dl);
});

// ------------------------------------------------------------ 静态文件（网页、字体、和插件共用的图片处理代码）
app.get("/fonts/*", (c) => { const f = inside(FONT_DIR, c.req.path.slice(7)); return f ? sendFile(c, f) : c.text("404", 404); });
app.get("/lib/imagekit.js", (c) => sendFile(c, path.join(REPO_DIR, "extension", "lib", "imagekit.js")));
app.get("*", (c) => {
  const p = decodeURIComponent(c.req.path);
  const f = p === "/" ? path.join(PUBLIC_DIR, "index.html") : inside(PUBLIC_DIR, p.slice(1));
  if (f && fs.existsSync(f) && fs.statSync(f).isFile()) return sendFile(c, f);
  if (p.startsWith("/api/")) return c.json({ error: "没有这个接口" }, 404);
  return sendFile(c, path.join(PUBLIC_DIR, "index.html"));
});

app.onError((e, c) => { console.error(e); return c.json({ error: String(e.message || e) }, 500); });
