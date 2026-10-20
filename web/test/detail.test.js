// 详情页全流程：上传淘宝采集 zip → 一键全自动（识别、抠图、卖点、参考图、提纲、背景、检查、翻译、改写、导出）→ 审核通过
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connect } from "./fake-plugins.js";
import { tbZip, fakeDetailAI } from "./fake-detail.js";

const PORT = 18800 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aitutu-detail-"));
let srv, cookie = "", token = "", plugin;
const ai = fakeDetailAI();
const asked = ai.asked;

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

before(async () => {
  srv = spawn(process.execPath, ["server/index.js"], { cwd: path.resolve(import.meta.dirname, ".."), env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, QUEUE_FAST: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  srv.stdout.on("data", (d) => (out += d));
  srv.stderr.on("data", (d) => process.stderr.write(d));
  for (let i = 0; i < 150 && !/插件口令 (\w+)/.test(out); i++) await sleep(100);
  token = /插件口令 (\w+)/.exec(out)[1];
  await api("POST", "/api/auth/setup", { password: "1234" });
  await api("PUT", "/api/roles", { roles: { text: ["gemini"], vision: ["gemini"], image: ["gemini"] } });
  plugin = await connect(`ws://127.0.0.1:${PORT}/ext`, { token, name: "测试电脑", version: "0.8.0", app: "aitutu", sites: [{ site: "gemini", name: "Gemini", open: true, ready: true }] }, ai.onCmd);
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
