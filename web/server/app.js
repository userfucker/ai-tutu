// 网页接口
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import * as auth from "./auth.js";
import { bridge, SITE_NAMES, APP_NAMES } from "./bridge.js";
import * as queue from "./queue.js";
import { addClient } from "./events.js";
import { kvGet, kvSet } from "./db.js";
import { PUBLIC_DIR, FONT_DIR, REPO_DIR, DATA_DIR, FILES_DIR, VERSION } from "./config.js";
import * as analysis from "./analysis/pipeline.js";
import * as dstore from "./detail/store.js";
import * as auto from "./detail/auto.js";
import * as importer from "./detail/importer.js";

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
  roles: queue.roles(), roleNames: queue.ROLE_NAMES, modules: queue.MODULES, follows: queue.follows(), siteNames: SITE_NAMES, appNames: APP_NAMES, disk: disk(),
}));
app.post("/api/ext-token/reset", (c) => c.json({ token: auth.resetExtToken() }));
app.put("/api/ext-token", async (c) => {
  const { token } = await c.req.json();
  try { return c.json({ token: auth.setExtToken(token) }); } catch (e) { return c.json({ error: e.message }, 400); }
});
app.delete("/api/roles", (c) => { kvSet("aiRoles", null); queue.tick(); return c.json({ ok: true, roles: queue.roles() }); });
app.put("/api/roles", async (c) => {
  const { roles } = await c.req.json();
  const clean = {};
  // 模块没传（选了“跟着走”）就不存，用它跟的那一类
  for (const [k, v] of Object.entries(roles || {})) if ((queue.DEFAULT_ROLES[k] || queue.MODULES[k]) && Array.isArray(v)) clean[k] = v.filter((s) => SITE_NAMES[s]);
  kvSet("aiRoles", clean);
  queue.tick();
  return c.json({ ok: true, roles: queue.roles() });
});
app.get("/api/settings/:key", (c) => c.json({ value: kvGet("ui:" + c.req.param("key"), null) }));
app.put("/api/settings/:key", async (c) => { const { value } = await c.req.json(); kvSet("ui:" + c.req.param("key"), value); return c.json({ ok: true }); });

// ------------------------------------------------------------ 任务
app.get("/api/tasks", (c) => c.json({ tasks: queue.list({ status: c.req.query("status") || undefined, ownerType: c.req.query("ownerType") || undefined, ownerId: c.req.query("ownerId") || undefined, limit: c.req.query("limit") || 300 }), counts: queue.counts() }));
// 手动发一个任务（测试插件、临时问 AI 用）。images: [{ b64, mime, name }]
app.post("/api/tasks", async (c) => {
  const b = await c.req.json();
  if (!["text", "vision", "image"].includes(b.kind)) return c.json({ error: "kind 只能是 text / vision / image" }, 400);
  if (!String(b.prompt || "").trim()) return c.json({ error: "没有提示词" }, 400);
  const images = [];
  fs.mkdirSync(path.join(FILES_DIR, "manual"), { recursive: true });
  for (const [i, im] of (b.images || []).entries()) {
    const ext = /png/.test(im.mime || "") ? "png" : "jpg";
    const rel = `manual/${Date.now()}_${i}.${ext}`;
    fs.writeFileSync(path.join(FILES_DIR, rel), Buffer.from(im.b64 || "", "base64"));
    images.push({ file: rel, name: im.name || `图片${i + 1}.${ext}` });
  }
  const row = queue.enqueue({ kind: b.kind === "vision" ? "text" : b.kind, label: b.label || "手动任务", ownerType: b.ownerType === "project" ? "project" : "manual", ownerId: b.ownerType === "project" ? String(b.ownerId || "") : "manual", payload: { prompt: b.prompt, material: b.material || undefined, images, sites: Array.isArray(b.sites) && b.sites.length ? b.sites.filter((x) => SITE_NAMES[x]) : undefined, role: queue.MODULES[b.role] ? b.role : undefined, rotate: Number(b.rotate) || undefined } });
  return c.json({ ok: true, id: row.id });
});
app.get("/api/tasks/:id/result", (c) => c.json({ task: queue.get(Number(c.req.param("id"))), result: queue.rawResult(Number(c.req.param("id"))) }));
app.get("/api/files/*", (c) => { const f = inside(FILES_DIR, decodeURIComponent(c.req.path.slice(11))); return f ? sendFile(c, f) : c.text("404", 404); });
app.post("/api/tasks/:id/cancel", (c) => c.json({ ok: queue.cancel(Number(c.req.param("id"))) }));
app.post("/api/tasks/:id/retry", (c) => c.json({ ok: queue.retry(Number(c.req.param("id"))) }));
app.post("/api/tasks/:id/bump", (c) => { queue.bump(Number(c.req.param("id"))); return c.json({ ok: true }); });

// ------------------------------------------------------------ 竞品分析
app.get("/api/analyses", (c) => c.json({ list: analysis.listAll(), rateOptions: analysis.RATE_OPTIONS, batchOptions: analysis.BATCH_OPTIONS, mods: analysis.MODS, lastMods: kvGet("ui:anMods", null), maxProducts: analysis.MAX_PRODUCTS }));
app.post("/api/analyses", async (c) => {
  const b = await c.req.json();
  const rivals = analysis.parseLinks(b.links);
  const oursUrl = analysis.parseLinks(b.oursUrl || "")[0] || "";
  const manual = b.oursManual && Object.values(b.oursManual).some((v) => String(v || "").trim()) ? b.oursManual : null;
  if (!rivals.length && !oursUrl) return c.json({ error: "没有找到淘宝 / 天猫的商品链接（一行一个）" }, 400);
  const oursDesc = Array.isArray(b.oursDesc) ? b.oursDesc.filter((x) => x && x.b64) : [];
  const ours = oursUrl ? { url: oursUrl } : manual ? { manual } : oursDesc.length ? { manual: { name: "我们的产品" } } : null;
  const keep = analysis.MAX_PRODUCTS - (ours ? 1 : 0);
  const dropped = rivals.slice(keep);
  const an = analysis.create({ name: b.name, rivals, ours, rates: b.rates, qa: b.qa, batch: b.batch, desc: b.desc, oursDesc: oursUrl ? [] : oursDesc, mods: b.mods });
  if (Array.isArray(b.mods)) kvSet("ui:anMods", b.mods); // 记住这次勾的模块，下次新建默认这样
  return c.json({ ok: true, id: an.id, dropped });
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

// ------------------------------------------------------------ 详情页：项目、图片、设置
app.get("/api/projects", (c) => c.json({ list: dstore.listProjects() }));
app.get("/api/projects/:id", (c) => { const p = dstore.getProject(c.req.param("id")); return p ? c.json({ project: p }) : c.json({ error: "项目不存在" }, 404); });
app.put("/api/projects/:id", async (c) => {
  const { project, rev } = await c.req.json();
  if (!project || project.id !== c.req.param("id")) return c.json({ error: "数据不对" }, 400);
  const cur = dstore.getProject(project.id);
  if (cur && cur.auto && (cur.auto.status === "running" || cur.auto.status === "exporting")) return c.json({ error: "全自动正在做这个项目，等它做完再改", conflict: true }, 409);
  if (cur) project.auto = cur.auto; // 全自动的状态由服务器管
  const r = dstore.putProject(project, rev);
  if (r === null) return c.json({ error: "项目在别处被改过了，请重新打开", conflict: true }, 409);
  return c.json({ ok: true, rev: r });
});
app.delete("/api/projects/:id", (c) => { auto.stop(c.req.param("id")); queue.cancelOwner("project", c.req.param("id")); dstore.deleteProject(c.req.param("id")); return c.json({ ok: true }); });
app.post("/api/projects/:id/auto", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  try { auto.start(c.req.param("id"), b || {}); return c.json({ ok: true }); } catch (e) { return c.json({ error: e.message }, 400); }
});
app.post("/api/projects/:id/auto/stop", (c) => { auto.stop(c.req.param("id")); return c.json({ ok: true }); });
app.post("/api/projects/:id/auto/approve", async (c) => {
  try { await auto.approve(c.req.param("id")); return c.json({ ok: true }); } catch (e) { return c.json({ error: e.message }, 400); }
});
// 新建项目：上传淘宝采集的 zip（或者图片打包的 zip），?auto=1 建好马上开始全自动。设置放在 ?o= 里（JSON）
app.post("/api/projects/import", async (c) => {
  const buf = Buffer.from(await c.req.arrayBuffer());
  if (buf.length > 500 * 1024 * 1024) return c.json({ error: "zip 太大（超过 500 MB）" }, 400);
  let o = {};
  try { o = JSON.parse(c.req.query("o") || "{}"); } catch {}
  try {
    const p = await importer.importZip(buf, o);
    if (c.req.query("auto")) auto.start(p.id);
    return c.json({ ok: true, id: p.id, name: p.name, assets: p.assets.length });
  } catch (e) { return c.json({ error: "导入失败：" + e.message }, 400); }
});
app.get("/api/projects/:id/export", (c) => {
  const p = dstore.getProject(c.req.param("id"));
  if (!p || !p.auto || !p.auto.exportFile) return c.text("还没有导出文件", 404);
  return sendFile(c, path.join(FILES_DIR, p.auto.exportFile), { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`详情页_${p.name}.zip`)}` });
});
app.get("/api/blobs", (c) => c.json({ keys: dstore.blobKeys(c.req.query("prefix") || "") }));
app.get("/api/blobs/:key", (c) => {
  const b = dstore.getBlob(c.req.param("key"));
  if (!b) return c.text("没有这张图", 404);
  return new Response(b.buf, { headers: { "Content-Type": b.type, "Cache-Control": "no-cache" } });
});
app.put("/api/blobs/:key", async (c) => {
  const buf = Buffer.from(await c.req.arrayBuffer());
  if (buf.length > 60 * 1024 * 1024) return c.json({ error: "图片太大（超过 60 MB）" }, 400);
  dstore.putBlob(c.req.param("key"), buf, c.req.header("content-type"));
  return c.json({ ok: true });
});
app.delete("/api/blobs/:key", (c) => { dstore.delBlob(c.req.param("key")); return c.json({ ok: true }); });
app.get("/api/meta/:key", (c) => c.json({ value: dstore.getMeta(c.req.param("key"), null) }));
app.put("/api/meta/:key", async (c) => { const { value } = await c.req.json(); dstore.setMeta(c.req.param("key"), value); return c.json({ ok: true }); });

// ------------------------------------------------------------ 静态文件（网页、字体、和插件共用的图片处理代码）
app.get("/fonts/*", (c) => { const f = inside(FONT_DIR, c.req.path.slice(7)); return f ? sendFile(c, f) : c.text("404", 404); });
app.get("/lib/imagekit.js", (c) => sendFile(c, path.join(REPO_DIR, "extension", "lib", "imagekit.js")));
app.get("*", (c) => {
  const p = decodeURIComponent(c.req.path);
  const f = p === "/" ? path.join(PUBLIC_DIR, "index.html") : inside(PUBLIC_DIR, p.slice(1));
  if (f && fs.existsSync(f) && fs.statSync(f).isFile()) return sendFile(c, f);
  if (f && fs.existsSync(path.join(f, "index.html"))) return p.endsWith("/") ? sendFile(c, path.join(f, "index.html")) : c.redirect(p + "/");
  if (p.startsWith("/api/")) return c.json({ error: "没有这个接口" }, 404);
  return sendFile(c, path.join(PUBLIC_DIR, "index.html"));
});

app.onError((e, c) => { console.error(e); return c.json({ error: String(e.message || e) }, 500); });
