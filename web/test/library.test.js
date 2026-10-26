// 素材中心 + 项目命名：放图（同组同图只存一份）、分组和大小、删除、发送到主图 / 详情页（新建或已有项目）、打包下载；
// 项目名“前缀-名字月-日-序号”，三个模块一起数，删了也不回退，建好不能改名
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { product, png } from "./fake-detail.js";

const PORT = 18900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aitutu-lib-"));
let srv, cookie = "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, url, body, raw) {
  const headers = { cookie };
  if (!raw && body) headers["Content-Type"] = "application/json";
  const r = await fetch(BASE + url, { method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, body: ct.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}
before(async () => {
  srv = spawn(process.execPath, ["server/index.js"], { cwd: path.resolve(import.meta.dirname, ".."), env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, QUEUE_FAST: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  srv.stdout.on("data", (d) => (out += d));
  srv.stderr.on("data", (d) => process.stderr.write(d));
  for (let i = 0; i < 150 && !/插件口令 (\w+)/.test(out); i++) await sleep(100);
  await api("POST", "/api/auth/setup", { password: "1234" });
});
after(() => { srv.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const md = () => { const d = new Date(Date.now() + 8 * 3600e3); return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`; };
let a1, a2;
test("放图：尺寸、大小、分组；同一组里一样的图只存一份；不是图片不收", async () => {
  const img = product("#ffffff");
  const r1 = await api("POST", "/api/library?grp=" + encodeURIComponent("淘宝：钱包") + "&tag=" + encodeURIComponent("主图") + "&source=taobao", img, true);
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  a1 = r1.body.item;
  assert.equal(a1.w, 600); assert.equal(a1.h, 600); assert.equal(a1.size, img.length); assert.equal(a1.tag, "主图"); assert.equal(a1.sourceName, "淘宝采集");
  const again = await api("POST", "/api/library?grp=" + encodeURIComponent("淘宝：钱包"), img, true);
  assert.equal(again.body.item.id, a1.id, "一样的图不再存");
  a2 = (await api("POST", "/api/library?grp=" + encodeURIComponent("上传 10-24"), png(300, 200, (g, w, h) => { g.fillStyle = "#c33"; g.fillRect(0, 0, w, h); }), true)).body.item;
  assert.equal((await api("POST", "/api/library", Buffer.from("hello"), true)).status, 400);
  const L = (await api("GET", "/api/library")).body;
  assert.equal(L.total.n, 2);
  assert.equal(L.total.size, a1.size + a2.size, "一共占多少空间");
  assert.deepEqual(L.groups.map((g) => g.name).sort(), ["上传 10-24", "淘宝：钱包"]);
  assert.equal((await api("GET", "/api/library?tag=" + encodeURIComponent("主图"))).body.items.length, 1);
  assert.ok((await api("GET", `/api/library/${a1.id}/thumb`)).body.length > 100, "有小图");
});

test("项目名字：前缀-名字月-日-序号，三个模块一起数，删了不回退，不能改名", async () => {
  const n1 = (await api("POST", "/api/project-name", { kind: "detail", name: "钱包" })).body.name;
  assert.equal(n1, `详情图-钱包${md()}-1`);
  const m = (await api("POST", "/api/main", { name: "收纳箱" })).body;
  assert.equal(m.project.name, `主图-收纳箱${md()}-2`);
  await api("DELETE", `/api/projects/${m.id}`);
  const n3 = (await api("POST", "/api/project-name", { kind: "cutout", name: "" })).body.name;
  assert.equal(n3, `白底图-未命名${md()}-3`, "删了也往下数；不填名字叫未命名");
  const m2 = (await api("POST", "/api/main", { name: "拖鞋" })).body;
  await api("POST", `/api/main/${m2.id}/op`, { op: "set", fields: { name: "改个名" } });
  assert.equal((await api("GET", `/api/projects/${m2.id}`)).body.project.name, `主图-拖鞋${md()}-4`, "建好不能改名");
});

test("发送到主图制作（新建项目）/ 详情页（新建、已有）；记下用在了哪；打包下载；删除", async () => {
  const r = await api("POST", "/api/library/send", { to: "main", ids: [a1.id], name: "钱包" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.name, /^主图-钱包\d\d-\d\d-\d+$/);
  const mp = (await api("GET", `/api/projects/${r.body.projectId}`)).body.project;
  assert.equal(mp.products.length, 1, "产品图放进去了");
  await sleep(800);
  const pr0 = (await api("GET", `/api/projects/${mp.id}`)).body.project.products[0];
  assert.ok(!pr0.cut && pr0.edgeWhite, "保留原来的格式，不自动去白底（Lee 2026-10-26），认出是白底图（可以点“去白底”）");
  assert.equal((await api("GET", "/api/library")).body.total.n, 2, "从素材中心发过去的不会再放回来一份");
  const d1 = await api("POST", "/api/library/send", { to: "detail", ids: [a1.id, a2.id], name: "钱包" });
  const dp = (await api("GET", `/api/projects/${d1.body.projectId}`)).body.project;
  assert.match(dp.name, /^详情图-钱包/);
  assert.equal(dp.assets.length, 2);
  assert.equal(dp.assets[0].tag, "angle", "淘宝主图 → 角度图");
  assert.ok(dp.fixedName);
  const d2 = await api("POST", "/api/library/send", { to: "detail", ids: [a1.id], projectId: dp.id });
  assert.equal(d2.body.projectId, dp.id);
  assert.equal((await api("GET", `/api/projects/${dp.id}`)).body.project.assets.length, 3, "放进已有项目");
  const used = (await api("GET", "/api/library")).body.items.find((x) => x.id === a1.id).used;
  assert.deepEqual(used.map((u) => u.type).sort(), ["detail", "main"], "记下用在了主图和详情页");
  const z = await api("POST", "/api/library/zip", { ids: [a1.id, a2.id] });
  assert.ok(z.body.length > 1000 && z.body.slice(0, 2).toString() === "PK");
  assert.equal((await api("POST", "/api/library/delete", { ids: [a2.id] })).body.removed, 1);
  assert.equal((await api("GET", "/api/library")).body.total.n, 1);
  assert.equal((await api("GET", `/api/projects/${dp.id}`)).body.project.assets.length, 3, "删素材中心的图不影响项目");
});
