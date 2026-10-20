// 详情页全流程：上传淘宝采集 zip → 一键全自动（识别、抠图、卖点、参考图、提纲、背景、检查、翻译、改写、导出）→ 审核通过
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createCanvas } from "@napi-rs/canvas";
import { connect } from "./fake-plugins.js";

const PORT = 18800 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aitutu-detail-"));
let srv, cookie = "", token = "", plugin;
const asked = [];

async function api(method, url, body, raw) {
  const headers = { cookie };
  if (!raw && body) headers["Content-Type"] = "application/json";
  const r = await fetch(BASE + url, { method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, body: ct.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 测试图片和 zip
function png(w, h, draw) {
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  draw(g, w, h);
  return c.toBuffer("image/png");
}
const product = (bg) => png(600, 600, (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = "#2a5db0"; g.fillRect(180, 120, 240, 360); g.fillStyle = "#e0b040"; g.fillRect(220, 200, 160, 40); });
const descImg = (color) => png(750, 900, (g, w, h) => { g.fillStyle = color; g.fillRect(0, 0, w, h); g.fillStyle = "#fff"; g.fillRect(0, 880, w, 20); });
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const parts = [], cen = [];
  let off = 0;
  for (const [name, data] of files) {
    const nb = Buffer.from(name), body = zlib.deflateRawSync(data), cr = crc(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(cr, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(cr, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nb, body); cen.push(ch, nb);
    off += 30 + nb.length + body.length;
  }
  const cd = Buffer.concat(cen), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
const tbZip = () => zip([
  ["测试保温杯/data.json", Buffer.from(JSON.stringify({ item: { title: "测试保温杯 316不锈钢 大容量", params: [{ name: "材质", value: "316不锈钢" }, { name: "容量", value: "500ml" }], skuProps: [{ name: "颜色分类", values: [{ name: "蓝色" }] }] },
    rates: { list: [{ content: "保温效果很好" }, { content: "杯盖有点漏水" }] }, qa: { list: [{ title: "会漏水吗", answers: [{ content: "不会" }] }] } }))],
  ["测试保温杯/主图/01.png", product("#ffffff")],
  ["测试保温杯/主图/02.png", product("#8a6d4e")],
  ["测试保温杯/SKU图/01_蓝色.png", product("#ffffff")],
  ["测试保温杯/详情图/01.png", descImg("#f0e0d0")],
  ["测试保温杯/详情图/02.png", descImg("#d0e0f0")],
]);

// ---------------------------------------------------------------- 假 AI图图（Gemini）：按提示词回 JSON / 画图
let badBgOnce = true;
function answer(prompt, nImages) {
  let out;
  if (/逐张判断/.test(prompt)) out = { assets: Array.from({ length: nImages }, (_, i) => ({ i: i + 1, tag: i === 0 ? "white" : i === 1 ? "angle" : "spec", note: ["正面", "侧面", "蓝色"][i] || "", group: i === 2 ? "蓝色" : "" })), product: { name: "保温杯", category: "水杯", audience: "上班族", scenes: "办公室" } };
  else if (/买家评价和问答/.test(prompt)) out = { concerns: [{ text: "担心漏水", count: 3 }], points: ["双层密封不漏水"] };
  else if (/补充 \d+ 个新的卖点/.test(prompt)) out = { points: ["316 不锈钢内胆", "保温 12 小时", "一键开盖"] };
  else if (/按屏切开的参考图/.test(prompt)) { const from = +/第 (\d+)～/.exec(prompt)[1]; out = { screens: Array.from({ length: nImages }, (_, i) => ({ i: from + i, purpose: "卖点", template: i ? "features3" : "hero", layout: "居中", colors: ["#f0e0d0"], style: "warm beige" })) }; }
  else if (/规划一套详情页/.test(prompt)) out = { screens: [
    { template: "hero", purpose: "首屏", title: "最好的保温杯", sub: "保温 12 小时", main: 1, bg: "soft beige marble" },
    { template: "features3", purpose: "卖点", title: "三大卖点", items: [{ title: "不漏水", desc: "双层密封", icon: "shield" }, { title: "保温久", desc: "12 小时", icon: "clock" }, { title: "轻便", desc: "只有 300 克", icon: "feather" }], bg: "light studio" },
    { template: "params", purpose: "参数", title: "产品参数" },
  ] };
  else if (/背景图（按顺序）/.test(prompt)) { out = { bad: badBgOnce ? [{ i: 1, why: "有文字" }] : [] }; badBgOnce = false; }
  else if (/重写下面这一屏/.test(prompt)) { const cur = JSON.parse(/【当前文案】\n(.*)\n/.exec(prompt)[1]); out = { ...cur, title: "品质之选保温杯" }; }
  else if (/翻译成/.test(prompt)) { const map = JSON.parse(prompt.split("\n").find((l) => l.startsWith("{"))); out = { t: Object.fromEntries(Object.entries(map).map(([k, v]) => [k, "EN " + v])) }; }
  else out = { ok: true };
  return { text: "好的：\n```json\n" + JSON.stringify(out) + "\n```", codes: [JSON.stringify(out)] };
}
const aiImage = (prompt) => {
  if (/isolated on a pure white background/.test(prompt)) return product("#ffffff");
  return png(768, 1024, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#f3e9dc"); gr.addColorStop(1, "#d9c2a5"); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
};

before(async () => {
  srv = spawn(process.execPath, ["server/index.js"], { cwd: path.resolve(import.meta.dirname, ".."), env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, QUEUE_FAST: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  srv.stdout.on("data", (d) => (out += d));
  srv.stderr.on("data", (d) => process.stderr.write(d));
  for (let i = 0; i < 80 && !/插件口令 (\w+)/.test(out); i++) await sleep(100);
  token = /插件口令 (\w+)/.exec(out)[1];
  await api("POST", "/api/auth/setup", { password: "1234" });
  await api("PUT", "/api/roles", { roles: { text: ["gemini"], vision: ["gemini"], image: ["gemini"] } });
  plugin = await connect(`ws://127.0.0.1:${PORT}/ext`, { token, name: "测试电脑", version: "0.8.0", app: "aitutu", sites: [{ site: "gemini", name: "Gemini", open: true, ready: true }] }, async (m) => {
    if (m.cmd !== "run") return { error: "不支持" };
    asked.push({ kind: m.args.kind, prompt: m.args.prompt, images: (m.args.images || []).length });
    await sleep(5);
    if (m.args.kind === "image") return { b64: aiImage(m.args.prompt).toString("base64"), mime: "image/png" };
    return answer(m.args.prompt, (m.args.images || []).length);
  });
});
after(() => { if (plugin) plugin.close(); srv.kill(); if (process.env.KEEP) console.log("数据留在", dataDir); else fs.rmSync(dataDir, { recursive: true, force: true }); });

async function waitAuto(id, want, ms = 90000) {
  for (let t0 = Date.now(); Date.now() - t0 < ms;) {
    const r = await api("GET", `/api/projects/${id}`);
    const a = r.body.project.auto || {};
    if (want.includes(a.status)) return r.body.project;
    if (a.status === "failed") throw new Error("全自动出错：" + a.error);
    await sleep(300);
  }
  throw new Error("等太久了");
}

let pid;
test("上传淘宝采集 zip 建项目：素材、参考图、产品信息、评价都导进来", async () => {
  const r = await api("POST", "/api/projects/import?o=" + encodeURIComponent(JSON.stringify({ platform: "taobao-m", langs: ["en"] })), tbZip(), true);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  pid = r.body.id;
  const p = (await api("GET", `/api/projects/${pid}`)).body.project;
  assert.equal(p.assets.length, 3);
  assert.equal(p.assets[2].tag, "spec");
  assert.equal(p.assets[0].tag, "white", "白底图自动认出来");
  assert.ok(p.ref && p.ref.cuts.length >= 1, "参考详情图拼好、自动切了");
  assert.match(p.info.name, /保温杯/);
  assert.match(p.reviews.raw, /漏水/);
  assert.deepEqual(p.langs, ["en"]);
});

test("一键全自动：做完导出 zip，等审核", async () => {
  assert.equal((await api("POST", `/api/projects/${pid}/auto`, {})).status, 200);
  // 全自动做的时候，网页不能改
  const cur = (await api("GET", `/api/projects/${pid}`)).body.project;
  assert.equal((await api("PUT", `/api/projects/${pid}`, { project: cur, rev: cur.rev })).status, 409);
  const p = await waitAuto(pid, ["review"]);
  const kinds = asked.map((a) => a.prompt.split("\n")[0].slice(0, 30));
  assert.ok(asked.some((a) => /逐张判断/.test(a.prompt) && a.images === 3), "AI 看图识别素材");
  assert.ok(asked.some((a) => a.kind === "image" && /isolated/.test(a.prompt)), "背景复杂的那张交给 AI 抠图");
  assert.ok(p.assets[0].cut && p.assets[1].cut && p.assets[2].cut, "三张都抠好了");
  assert.equal(p.assets[1].note, "侧面");
  assert.ok(p.points.filter((x) => x.on).length >= 4, "卖点够了");
  assert.ok(p.ref.analysis.length >= 1, "参考图分析了");
  assert.equal(p.screens.length, 3);
  assert.ok(p.screens.filter((s) => s.bg.mode === "ai").every((s) => s.bg.key), "AI 背景都生成了");
  const nAi = p.screens.filter((s) => s.bg.mode === "ai").length;
  assert.ok(nAi >= 1);
  assert.equal(asked.filter((a) => a.kind === "image" && /background for an e-commerce/.test(a.prompt)).length, nAi + 1, "检查出有问题的背景重画了一次");
  assert.ok(p.auto.log.some((l) => /有问题（有文字），重画/.test(l)));
  assert.ok(Object.keys(p.screens[0].text.title || {}).includes("en"), "翻译成英语了");
  assert.equal(p.auto.exportFile, `exports/${pid}.zip`);
  const z = await api("GET", `/api/projects/${pid}/export`);
  assert.equal(z.status, 200);
  assert.ok(z.body.length > 50000, "zip 有内容");
  assert.ok(z.body.includes(Buffer.from("长图")), "zip 里有长图");
  console.log("  AI 任务：", kinds.length, "个");
});

test("审核：改一下文案再审核通过，重新导出", async () => {
  const p = (await api("GET", `/api/projects/${pid}`)).body.project;
  p.name = "改过的名字";
  const r = await api("PUT", `/api/projects/${pid}`, { project: p, rev: p.rev });
  assert.equal(r.status, 200);
  assert.equal((await api("PUT", `/api/projects/${pid}`, { project: p, rev: p.rev })).status, 409, "旧版本号不能覆盖");
  assert.equal((await api("POST", `/api/projects/${pid}/auto/approve`)).status, 200);
  const q = (await api("GET", `/api/projects/${pid}`)).body.project;
  assert.equal(q.auto.status, "approved");
  assert.equal(q.name, "改过的名字");
});

test("中途停止、再开始：做过的不重复问 AI", async () => {
  const r = await api("POST", "/api/projects/import", tbZip(), true);
  const id = r.body.id;
  await api("POST", `/api/projects/${id}/auto`, {});
  for (let i = 0; i < 100; i++) { const p = (await api("GET", `/api/projects/${id}`)).body.project; if (p.auto.step >= 2) break; await sleep(100); }
  await api("POST", `/api/projects/${id}/auto/stop`);
  const stopped = await waitAuto(id, ["stopped", "review"]);
  const before = asked.length;
  await api("POST", `/api/projects/${id}/auto`, {});
  await waitAuto(id, ["review"]);
  const again = asked.slice(before).filter((a) => /逐张判断/.test(a.prompt)).length;
  assert.equal(again, 0, `识别素材没有重做（停止时状态 ${stopped.auto.status}）`);
  // 列表里有两个项目，带缩略图和状态
  const list = (await api("GET", "/api/projects")).body.list;
  assert.equal(list.length, 2);
  assert.ok(list.every((x) => x.firstAsset && x.auto));
});
