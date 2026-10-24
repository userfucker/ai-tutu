// 融入背景（B 方式）的排版部分：融入后的图什么时候用、产品挪了就退回原贴图；多角度 / 融入的“轮流”分网站
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { product, png } from "./fake-detail.js";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "wb-harm-"));
const { getST } = await import("../server/detail/runtime.js");
const store = await import("../server/detail/store.js");
const { newProject } = await import("../server/detail/importer.js");

test("融入后的图：布局没变才用；挪了产品、关掉开关都显示原贴图", async () => {
  const ST = getST();
  const p = newProject({ name: "测试" });
  const blob = (buf) => new Blob([buf], { type: "image/png" });
  await ST.saveImage(`${p.id}:a1-orig`, blob(product("#ffffff")));
  p.assets.push({ id: "a1", name: "白底.png", tag: "white", note: "", group: "", key: `${p.id}:a1-orig`, w: 600, h: 600, white: "", cut: "", cutBox: null, edgeWhite: true });
  const sc = ST.newScreen("hero");
  sc.slots.main = "a1";
  sc.bg.key = `${p.id}:bg1`;
  await ST.saveImage(sc.bg.key, blob(png(750, 1000, (g, w, h) => { g.fillStyle = "#d9c2a5"; g.fillRect(0, 0, w, h); })));
  p.screens.push(sc);
  store.putProject(p);

  let h = await ST.harmState(p, sc);
  assert.equal(h.can, true, "有背景图、有主产品图：可以融入");
  assert.equal(h.used, false);
  // 假装 AI 融入好了（整张换成绿色，好认）
  const pf = ST.platformOf(p, p.platform);
  sc.harm = { key: `${p.id}:harm1`, sig: h.sig, on: true, status: "ok" };
  const base = await ST.renderScreen(p, sc, { platform: pf, lang: p.lang, pxWidth: 300, only: "base" });
  await ST.saveImage(sc.harm.key, blob(png(base.canvas.width, base.canvas.height, (g, w, hh) => { g.fillStyle = "#00ff00"; g.fillRect(0, 0, w, hh); })));
  const px = async (o = {}) => { const r = await ST.renderScreen(p, sc, { platform: pf, lang: p.lang, pxWidth: 300, ...o }); const d = r.canvas.getContext("2d").getImageData(150, Math.round(r.canvas.height * 0.75), 1, 1).data; return { r, rgb: [...d.slice(0, 3)] }; };
  let x = await px();
  assert.equal(x.r.harm.used, true, "布局没变：用融入后的图");
  assert.deepEqual(x.rgb, [0, 255, 0], "产品那里画的是融入后的图（产品层没再贴一次）");
  x = await px({ harm: false });
  assert.equal(x.r.harm.used, false, "harm:false = 看原贴图");
  sc.harm.on = false;
  assert.equal((await px()).r.harm.used, false, "开关关掉：原贴图");
  sc.harm.on = true;
  sc.ov = { main: { dx: 40 } };
  h = await ST.harmState(p, sc);
  assert.equal(h.used, false, "产品挪过了：不用融入后的图");
  assert.equal(h.stale, true, "并且提示作废了");
  sc.ov = {};
  sc.bg.blend = true;
  assert.equal((await ST.harmState(p, sc)).can, false, "A 方式（AI 把产品画进背景）不再融入");
});

test("角度列表和提示词", () => {
  const ST = getST();
  assert.equal(ST.ANGLES.map((a) => a.name).join(","), ["主视图", "左视图", "右视图", "后视图", "俯视图", "底视图", "45°侧面"].join(","));
  const p = { info: { name: "保温杯" } };
  assert.match(ST.P.angleView(p, { note: "" }, "45", "1:1"), /three-quarter view, 45 degrees/);
  assert.match(ST.P.pickBetter(p), /保温杯/);
  assert.match(ST.P.harmonize(p, "1:1"), /white patches inside openings/);
});

test("文字对比度：深背景自动换白字；背景花时按设置加底 / 不处理就提示看不清", async () => {
  const ST = getST();
  assert.ok(ST.contrastRatio("#000000", "#ffffff") > 20);
  const p = newProject({ name: "对比度" });
  const blob = (buf) => new Blob([buf], { type: "image/png" });
  const sc = ST.newScreen("hero");
  sc.text.title = { [p.lang]: "保温十二小时" };
  sc.text.sub = { [p.lang]: "" };
  sc.items = [];
  sc.bg.key = `${p.id}:dark`;
  await ST.saveImage(sc.bg.key, blob(png(750, 1000, (g, w, h) => { g.fillStyle = "#101010"; g.fillRect(0, 0, w, h); })));
  p.screens.push(sc);
  const pf = ST.platformOf(p, p.platform);
  const titleArea = async (o = {}) => {
    const r = await ST.renderScreen(p, sc, { platform: pf, lang: p.lang, pxWidth: 500, ...o });
    const d = r.canvas.getContext("2d").getImageData(50, 60, 400, 80).data;
    let bright = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 120) bright++;
    return { r, bright };
  };
  let x = await titleArea();
  assert.ok(x.bright > 200, "黑背景上的深色标题自动换成白字");
  assert.equal((await titleArea({ contrast: false })).bright, 0, "关掉对比度处理：还是深色字（看不见）");
  p.textColorAuto = false;
  x = await titleArea();
  assert.ok(x.r.issues.some((i) => i.type === "lowcontrast") || x.bright > 200, "不许换颜色时：要么加了底 / 阴影，要么提示看不清");
  p.textFix = "none";
  x = await titleArea();
  assert.ok(x.r.issues.some((i) => i.type === "lowcontrast" && i.id === "title"), "设成不处理：检查里提示“文字看不清”");
  p.textFix = "scrim";
  x = await titleArea();
  assert.ok(!x.r.issues.some((i) => i.type === "lowcontrast"), "加半透明底：不再提示");
  assert.ok(x.bright > 200, "浅色半透明底画出来了");
});
