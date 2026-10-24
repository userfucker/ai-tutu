// 竞品分析全流程：启动服务器 → 假插件连上 → 递交链接 → 采集 → 打标签 → 统计 → 写结论 → 报告
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connect, fakeItem, fakeAnswer } from "./fake-plugins.js";

const PORT = 18900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aitutu-test-"));
let srv, cookie = "", token = "";
const plugins = [];
const asked = { deepseek: 0, kimi: 0 };

async function api(method, url, body) {
  const r = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, body: ct.includes("json") ? await r.json() : await r.text() };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  srv = spawn(process.execPath, ["server/index.js"], { cwd: path.resolve(import.meta.dirname, ".."), env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, QUEUE_FAST: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  srv.stdout.on("data", (d) => (out += d));
  srv.stderr.on("data", (d) => process.stderr.write(d));
  for (let i = 0; i < 150 && !/插件口令 (\w+)/.test(out); i++) await sleep(100);
  token = /插件口令 (\w+)/.exec(out)[1];
});
after(() => { plugins.forEach((p) => p.close()); srv.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test("登录：第一次设置密码，之后要登录", async () => {
  assert.equal((await api("GET", "/api/status")).status, 401);
  const st = await api("GET", "/api/auth/state");
  assert.equal(st.body.setup, false);
  assert.equal((await api("POST", "/api/auth/setup", { password: "1234" })).status, 200);
  assert.equal((await api("GET", "/api/status")).status, 200);
  cookie = "";
  assert.equal((await api("POST", "/api/auth/login", { password: "x" })).status, 401);
  assert.equal((await api("POST", "/api/auth/login", { password: "1234" })).status, 200);
});

test("插件口令不对会被拒绝", async () => {
  await assert.rejects(connect(`ws://127.0.0.1:${PORT}/ext`, { token: "wrong", name: "x", sites: [] }, () => ({})), /口令不对/);
});

test("竞品分析：两个竞品 + 我们的产品，跑出报告", async () => {
  const url = `ws://127.0.0.1:${PORT}/ext`;
  // 假 ai-web：DeepSeek 和 Kimi
  plugins.push(await connect(url, { token, name: "测试电脑", version: "1.2.1", sites: [{ site: "deepseek", name: "DeepSeek", open: true, ready: true }, { site: "kimi", name: "Kimi", open: false, ready: false }] }, async (m, progress) => {
    if (m.cmd === "open") return { ok: true };
    if (m.cmd !== "ask") return { error: "不支持" };
    asked[m.site]++;
    progress({ answer: "正在想……", thinkingLen: 0, done: false });
    await sleep(20);
    return { answer: fakeAnswer(m.args.text, m.args.files && m.args.files[0] && m.args.files[0].content) };
  }));
  // 假淘宝采集
  plugins.push(await connect(url, { token, app: "taobao", name: "测试电脑", version: "0.7.0", sites: [{ site: "taobao", open: true, ready: true }] }, async (m, progress) => {
    if (m.cmd !== "collect") return { error: "不支持" };
    const id = /id=(\d+)/.exec(m.args.url)[1];
    progress({ msg: "正在采集评价 40/" + m.args.rates });
    return fakeItem(id, Math.min(m.args.rates, id === "222" ? 90 : 130), id === "222" ? 0.5 : 0.2);
  }));
  const st = await api("GET", "/api/status");
  assert.equal(st.body.workers.length, 2);

  const r = await api("POST", "/api/analyses", { name: "保温杯竞品", links: "https://item.taobao.com/item.htm?id=111&spm=abc\nhttps://detail.tmall.com/item.htm?id=222\n不是链接\nhttps://item.taobao.com/item.htm?id=111", oursUrl: "https://item.taobao.com/item.htm?id=333", rates: 100, qa: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const id = r.body.id;
  let a;
  for (let i = 0; i < 200; i++) {
    a = (await api("GET", `/api/analyses/${id}`)).body.analysis;
    if (["done", "failed"].includes(a.stage)) break;
    await sleep(150);
  }
  assert.equal(a.stage, "done", JSON.stringify(a));
  assert.equal(a.products.length, 3, "重复链接只算一个");
  assert.deepEqual(a.products.map((p) => p.status), ["collected", "collected", "collected"]);
  assert.ok(asked.deepseek > 0 && asked.kimi > 0, `两个网站同时干活：${JSON.stringify(asked)}`);
  const rep = await api("GET", `/api/analyses/${id}/report`);
  assert.equal(rep.status, 200);
  for (const s of ["保温杯竞品", "总体结论", "杯盖漏水", "保温效果好", "我们更好的地方", "优化建议", "问大家", "倒置不漏"]) assert.ok(rep.body.includes(s), "报告里应该有：" + s);
  fs.writeFileSync(path.join(os.tmpdir(), "aitutu-report-test.html"), rep.body);
  // 统计是程序算的：竞品 2（id=222）有一半差评
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "analysis", id, "stats.json"), "utf8"));
  const stats = saved.list || saved;
  const p2 = stats.find((s) => s.title.includes("222"));
  assert.equal(p2.analyzed, 90);
  assert.ok(p2.sentiment.negPct >= 45 && p2.sentiment.negPct <= 55, "差评比例 " + p2.sentiment.negPct);
  assert.ok(p2.bad.some((b) => b.name === "保温效果差"), "同义标签合并后的名字");
  // 任务都做完了
  const tasks = (await api("GET", `/api/tasks?ownerType=analysis&ownerId=${id}`)).body.tasks;
  assert.ok(tasks.every((t) => t.status === "done"), JSON.stringify(tasks.filter((t) => t.status !== "done")));
});

test("没有插件时任务排队等着，插件连上后接着做", async () => {
  plugins.forEach((p) => p.close());
  plugins.length = 0;
  await sleep(200);
  const r = await api("POST", "/api/analyses", { links: "https://item.taobao.com/item.htm?id=444", rates: 100 });
  await sleep(600);
  let a = (await api("GET", `/api/analyses/${r.body.id}`)).body.analysis;
  assert.equal(a.stage, "collect");
  const t = (await api("GET", `/api/tasks?status=queued`)).body.tasks;
  assert.ok(t.length >= 1);
  plugins.push(await connect(`ws://127.0.0.1:${PORT}/ext`, { token, app: "taobao", name: "电脑2", sites: [{ site: "taobao", open: true, ready: true }] }, async (m) => fakeItem("444", 50)));
  plugins.push(await connect(`ws://127.0.0.1:${PORT}/ext`, { token, name: "电脑2", sites: [{ site: "deepseek", open: true, ready: true }] }, async (m) => ({ answer: fakeAnswer(m.args.text, m.args.files && m.args.files[0].content) })));
  for (let i = 0; i < 200; i++) {
    a = (await api("GET", `/api/analyses/${r.body.id}`)).body.analysis;
    if (["done", "failed"].includes(a.stage)) break;
    await sleep(150);
  }
  assert.equal(a.stage, "done");
});

test("读详情页：详情图拼切成 JPG，国产 AI 失败了换下一个；我们上传的详情页也读；打标签每轮 50 条", async () => {
  plugins.forEach((p) => p.close());
  plugins.length = 0;
  await sleep(200);
  // 本地放几张详情图（假装是淘宝 CDN）
  const { createCanvas } = await import("@napi-rs/canvas");
  const png = (color, h) => { const c = createCanvas(790, h); const g = c.getContext("2d"); g.fillStyle = color; g.fillRect(0, 0, 790, h); g.fillStyle = "#222"; g.font = "40px sans-serif"; for (let y = 60; y < h; y += 120) g.fillText("保温 24 小时 不漏水", 60, y); return c.toBuffer("image/png"); };
  const imgs = { "/d1.png": png("#f0e0d0", 1800), "/d2.png": png("#d0e0f0", 2600), "/d3.png": png("#e0f0d0", 1500) };
  const http = await import("node:http");
  const cdn = http.createServer((req, res) => { const b = imgs[req.url]; if (!b) { res.statusCode = 404; return res.end(); } res.setHeader("Content-Type", "image/png"); res.end(b); });
  await new Promise((r) => cdn.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${cdn.address().port}`;
  const url = `ws://127.0.0.1:${PORT}/ext`;
  const seen = [];
  // 假 ai-web 1.4.0：Kimi 放不上图片（失败），DeepSeek 能读图
  plugins.push(await connect(url, { token, name: "测试电脑", version: "1.4.0", sites: [{ site: "kimi", open: true, ready: true }, { site: "deepseek", open: true, ready: true }] }, async (m) => {
    if (m.cmd !== "ask") return { ok: true };
    const files = m.args.files || [];
    const pics = files.filter((f) => f.b64);
    seen.push({ site: m.site, pics: pics.length, sizes: pics.map((f) => Buffer.from(f.b64, "base64").length) });
    if (pics.length && m.site === "kimi") return { error: "附件放不上去（试了：paste、input、drop）" };
    const txt = files.find((f) => f.content);
    return { answer: fakeAnswer(m.args.text, txt && txt.content) };
  }));
  plugins.push(await connect(url, { token, app: "taobao", name: "测试电脑", version: "0.7.2", sites: [{ site: "taobao", open: true, ready: true }] }, async (m) => {
    const item = fakeItem("555", 100, 0.3);
    if (m.args.desc) item.item.descImages = [`${base}/d1.png`, `${base}/d2.png`, `//127.0.0.1:1/没有这张.jpg`, `${base}/d3.png`];
    return item;
  }));
  const ours = [{ name: "a.png", mime: "image/png", b64: png("#ffffff", 1200).toString("base64") }];
  const r = await api("POST", "/api/analyses", { name: "读详情页", links: "https://item.taobao.com/item.htm?id=555", rates: 100, batch: 50, oursManual: { name: "我们的杯子", price: "59" }, oursDesc: ours });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  let a;
  for (let i = 0; i < 300; i++) { a = (await api("GET", `/api/analyses/${r.body.id}`)).body.analysis; if (["done", "failed"].includes(a.stage)) break; await sleep(150); }
  cdn.close();
  assert.equal(a.stage, "done", JSON.stringify(a));
  assert.equal(a.options.batch, 50);
  const tasks = (await api("GET", `/api/tasks?ownerType=analysis&ownerId=${r.body.id}`)).body.tasks;
  assert.equal(tasks.filter((t) => /评价打标签/.test(t.label)).length, 2, "100 条评价，每轮 50 条 = 2 轮");
  const reads = seen.filter((x) => x.pics);
  assert.ok(reads.some((x) => x.site === "kimi") && reads.some((x) => x.site === "deepseek"), "Kimi 失败后换 DeepSeek：" + JSON.stringify(reads.map((x) => x.site)));
  const big = reads.find((x) => x.site === "deepseek" && x.pics >= 3);
  assert.ok(big, "竞品详情页：3 张图拼起来 5900 像素高，切成 4 段左右：" + JSON.stringify(reads));
  assert.ok(big.sizes.every((n) => n < 400 * 1024), "每段 JPG 不超过 400 KB：" + big.sizes);
  const desc = JSON.parse(fs.readFileSync(path.join(dataDir, "analysis", r.body.id, "desc.json"), "utf8"));
  assert.ok(desc.p1 && desc.p1.selling && desc.ours && desc.ours.selling, "竞品和我们的详情页都读了：" + JSON.stringify(desc));
  const rep = (await api("GET", `/api/analyses/${r.body.id}/report`)).body;
  for (const s of ["详情页 vs 评价", "详情页讲了什么", "保温 24 小时", "我们的详情页怎么改", "¥59.00"]) assert.ok(rep.includes(s), "报告里应该有：" + s);
});

test("没有能看详情图的 AI：任务说明里写清楚原因，等一会儿就跳过，报告照样出来", async () => {
  plugins.forEach((p) => p.close());
  plugins.length = 0;
  await sleep(200);
  const url = `ws://127.0.0.1:${PORT}/ext`;
  // 只有老版本的 ai-web（1.3.0，发不了图片），没有 AI图图
  plugins.push(await connect(url, { token, name: "测试电脑", version: "1.3.0", sites: [{ site: "deepseek", open: true, ready: true }] }, async (m) => (m.cmd === "ask" ? { answer: fakeAnswer(m.args.text, (m.args.files || []).find((f) => f.content)?.content) } : { ok: true })));
  plugins.push(await connect(url, { token, app: "taobao", name: "测试电脑", sites: [{ site: "taobao", open: true, ready: true }] }, async () => {
    const it = fakeItem("666", 100);
    it.item.descImages = ["data:,x"]; // 有详情图网址（下载不下来也没关系，这里看排队）
    return it;
  }));
  // 给它一张能用的图：我们上传的详情页
  const { createCanvas } = await import("@napi-rs/canvas");
  const c = createCanvas(750, 900); c.getContext("2d").fillRect(0, 0, 10, 10);
  const r = await api("POST", "/api/analyses", { links: "https://item.taobao.com/item.htm?id=666", rates: 100, oursManual: { name: "我们" }, oursDesc: [{ name: "a.png", mime: "image/png", b64: c.toBuffer("image/png").toString("base64") }] });
  let a, why = "";
  for (let i = 0; i < 300; i++) {
    a = (await api("GET", `/api/analyses/${r.body.id}`)).body.analysis;
    const t = (await api("GET", `/api/tasks?ownerType=analysis&ownerId=${r.body.id}`)).body.tasks.find((x) => /读详情页/.test(x.label));
    if (t && /^等待：/.test(t.progress || "")) why = t.progress;
    if (["done", "failed"].includes(a.stage)) break;
    await sleep(150);
  }
  assert.equal(a.stage, "done", JSON.stringify(a));
  assert.match(why, /1\.4\.0/, "说明里写了要升级 ai-web：" + why);
  const rep = (await api("GET", `/api/analyses/${r.body.id}/report`)).body;
  assert.ok(rep.includes("没有能看详情图的 AI，跳过了"), "报告说明里写了跳过的原因");
});

test("分模块指定 AI：问大家只给 Kimi，评价只给 DeepSeek，设置保存下来", async () => {
  plugins.forEach((p) => p.close());
  plugins.length = 0;
  await sleep(200);
  const url = `ws://127.0.0.1:${PORT}/ext`;
  const who = [];
  plugins.push(await connect(url, { token, name: "测试电脑", version: "1.4.0", sites: [{ site: "deepseek", open: true, ready: true }, { site: "kimi", open: true, ready: true }, { site: "doubao", open: true, ready: true }] }, async (m) => {
    if (m.cmd !== "ask") return { ok: true };
    const txt = (m.args.files || []).find((f) => f.content);
    who.push({ site: m.site, what: /给每条评价打标签/.test(m.args.text) ? "rates" : /归纳一个主题/.test(m.args.text) ? "qa" : /合并成一个归类名/.test(m.args.text) ? "vocab" : /竞品分析结论/.test(m.args.text) ? "write" : "other" });
    return { answer: fakeAnswer(m.args.text, txt && txt.content) };
  }));
  plugins.push(await connect(url, { token, app: "taobao", name: "测试电脑", sites: [{ site: "taobao", open: true, ready: true }] }, async () => fakeItem("777", 100)));
  // 保存：问大家只用 Kimi，评价只用 DeepSeek，写结论只用豆包；合并标签跟着“写文字”
  const st0 = (await api("GET", "/api/status")).body;
  const save = await api("PUT", "/api/roles", { roles: { ...Object.fromEntries(Object.keys(st0.roleNames).map((k) => [k, st0.roles[k]])), an_qa: ["kimi"], an_rates: ["deepseek"], an_write: ["doubao"] } });
  assert.equal(save.status, 200);
  const st = (await api("GET", "/api/status")).body;
  assert.deepEqual(st.roles.an_qa, ["kimi"]);
  assert.equal(st.follows.an_qa, false);
  assert.equal(st.follows.an_vocab, true, "没单独设置的跟着走");
  assert.deepEqual(st.roles.an_vocab, st.roles.text);
  const r = await api("POST", "/api/analyses", { links: "https://item.taobao.com/item.htm?id=777", rates: 100, batch: 50 });
  let a;
  for (let i = 0; i < 300; i++) { a = (await api("GET", `/api/analyses/${r.body.id}`)).body.analysis; if (["done", "failed"].includes(a.stage)) break; await sleep(150); }
  assert.equal(a.stage, "done");
  const by = (w) => [...new Set(who.filter((x) => x.what === w).map((x) => x.site))];
  assert.deepEqual(by("qa"), ["kimi"], "问大家只给 Kimi");
  assert.deepEqual(by("rates"), ["deepseek"], "评价只给 DeepSeek");
  assert.deepEqual(by("write"), ["doubao"], "写结论只给豆包");
  // 恢复默认：模块都跟着走
  await api("DELETE", "/api/roles");
  const st2 = (await api("GET", "/api/status")).body;
  assert.ok(Object.entries(st2.follows).every(([k, v]) => v || st2.modules[k].def), "没有自己默认值的模块都跟着走");
});

test("报告 2.0：只勾选的模块；最多 3 个商品；标题 / 主图 / 属性 / 时间分布 / 回购 / 追评 / 回答质量", async () => {
  plugins.forEach((p) => p.close());
  plugins.length = 0;
  await sleep(200);
  const { createCanvas } = await import("@napi-rs/canvas");
  const http = await import("node:http");
  const png = (c0) => { const c = createCanvas(800, 800); const g = c.getContext("2d"); g.fillStyle = c0; g.fillRect(0, 0, 800, 800); return c.toBuffer("image/png"); };
  const cdn = http.createServer((req, res) => { res.setHeader("Content-Type", "image/png"); res.end(png(req.url.includes("2") ? "#cde" : "#edc")); });
  await new Promise((r) => cdn.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${cdn.address().port}`;
  const url = `ws://127.0.0.1:${PORT}/ext`;
  const asked2 = [];
  plugins.push(await connect(url, { token, name: "测试电脑", version: "1.4.0", sites: [{ site: "deepseek", open: true, ready: true }, { site: "kimi", open: true, ready: true }] }, async (m) => {
    if (m.cmd !== "ask") return { ok: true };
    asked2.push(m.args.text.slice(0, 40));
    const txt = (m.args.files || []).find((f) => f.content);
    return { answer: fakeAnswer(m.args.text, txt && txt.content) };
  }));
  plugins.push(await connect(url, { token, app: "taobao", name: "测试电脑", sites: [{ site: "taobao", open: true, ready: true }] }, async (m) => {
    const id = /id=(\d+)/.exec(m.args.url)[1];
    const it = fakeItem(id, 100);
    it.item.mainImages = [`${base}/m1.png`, `${base}/m2.png`, `${base}/x.gif`];
    it.rates.list.forEach((r, i) => { if (i % 10 === 3) r.content = "第二次回购了，" + r.content; });
    it.collectedQa = m.args.qa;
    return it;
  }));
  const mods = ["summary", "overview", "title", "main", "attr", "time", "rates", "sku", "qa", "advice"]; // 不要详情页
  const r = await api("POST", "/api/analyses", { name: "报告2", links: "https://item.taobao.com/item.htm?id=901\nhttps://item.taobao.com/item.htm?id=902\nhttps://item.taobao.com/item.htm?id=903", oursUrl: "https://item.taobao.com/item.htm?id=900", rates: 100, mods });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.dropped.length, 1, "加上我们的最多 3 个：第 3 个竞品不分析");
  let a;
  for (let i = 0; i < 300; i++) { a = (await api("GET", `/api/analyses/${r.body.id}`)).body.analysis; if (["done", "failed"].includes(a.stage)) break; await sleep(150); }
  cdn.close();
  assert.equal(a.stage, "done", JSON.stringify(a));
  assert.equal(a.products.length, 3);
  assert.equal(a.options.desc, false, "没勾详情页：不采详情图");
  assert.ok(!asked2.some((t) => /详情页/.test(t) && /切开/.test(t)), "没勾详情页：不读详情页");
  const rep = (await api("GET", `/api/analyses/${r.body.id}/report`)).body;
  fs.writeFileSync(path.join(os.tmpdir(), "aitutu-report2-test.html"), rep);
  for (const s of ["标题分析", "字符（剩", "覆盖范围", "1 × 3 = 3", "产品词（去重）", "标题用词差异", "竞品有、我们没有", "主图分析", "点击率潜力", "AI 的主观判断", "产品属性对比", "硬属性", "商家说的 vs 买家感受到的",
    "评价时间分布与销量估算", "<svg", "销量估算（仅供参考）", "回购信号", "追评", "极端差评", "主推规格", "按“颜色分类”汇总", "回答质量", "担心有没有成真", "优化建议", "说明"]) assert.ok(rep.includes(s), "报告里应该有：" + s);
  assert.ok(!rep.includes('id="m-desc"'), "没勾的模块不显示");
  assert.ok(rep.indexOf('class="tag ours"') < rep.indexOf('<span class="tag">竞品</span>'), "我们在第一列");
  // 下次新建默认勾这次的模块
  const list = (await api("GET", "/api/analyses")).body;
  assert.deepEqual(list.lastMods, mods);
});
