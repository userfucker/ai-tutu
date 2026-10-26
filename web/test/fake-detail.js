// 测试用：详情页的假素材（淘宝采集 zip）和假 AI图图（按提示词回 JSON、画图）
import zlib from "node:zlib";
import { createCanvas } from "@napi-rs/canvas";

// ---------------------------------------------------------------- 测试图片和 zip
export function png(w, h, draw) {
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  draw(g, w, h);
  return c.toBuffer("image/png");
}
export const product = (bg) => png(600, 600, (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = "#2a5db0"; g.fillRect(180, 120, 240, 360); g.fillStyle = "#e0b040"; g.fillRect(220, 200, 160, 40); });
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
export const tbZip = () => zip([
  ["测试保温杯/data.json", Buffer.from(JSON.stringify({ item: { title: "测试保温杯 316不锈钢 大容量", params: [{ name: "材质", value: "316不锈钢" }, { name: "容量", value: "500ml" }], skuProps: [{ name: "颜色分类", values: [{ name: "蓝色" }] }] },
    rates: { list: [{ content: "保温效果很好" }, { content: "杯盖有点漏水" }] }, qa: { list: [{ title: "会漏水吗", answers: [{ content: "不会" }] }] } }))],
  ["测试保温杯/主图/01.png", product("#ffffff")],
  ["测试保温杯/主图/02.png", product("#8a6d4e")],
  ["测试保温杯/SKU图/01_蓝色.png", product("#ffffff")],
  ["测试保温杯/详情图/01.png", descImg("#f0e0d0")],
  ["测试保温杯/详情图/02.png", descImg("#d0e0f0")],
]);

// ---------------------------------------------------------------- 假 AI图图（Gemini）：按提示词回 JSON / 画图
function answer(badBg, prompt, nImages, harmBad) {
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
  else if (/哪张更适合当电商图片/.test(prompt)) out = harmBad ? { better: 1, why: "第 2 张产品不见了" } : { better: 2, why: "去掉了白边，光线更自然" };
  else if (/是不是同一个产品/.test(prompt)) out = { ok: !harmBad, why: harmBad ? "产品不见了" : "" };
  else if (/总结背景风格/.test(prompt)) out = { name: "暖色木桌", desc: "温暖的木桌，早晨阳光", prompt: "warm wooden table, soft morning sunlight, cozy home" };
  else if (/背景图（按顺序）/.test(prompt)) out = { bad: badBg() ? [{ i: 1, why: "有文字" }] : [] };
  else if (/重写下面这一屏/.test(prompt)) { const cur = JSON.parse(/【当前文案】\n(.*)\n/.exec(prompt)[1]); out = { ...cur, title: "品质之选保温杯" }; }
  else if (/翻译成/.test(prompt)) { const map = JSON.parse(prompt.split("\n").find((l) => l.startsWith("{"))); out = { t: Object.fromEntries(Object.entries(map).map(([k, v]) => [k, "EN " + v])) }; }
  else out = { ok: true };
  return { text: "好的：\n```json\n" + JSON.stringify(out) + "\n```", codes: [JSON.stringify(out)] };
}
const aiImage = (prompt, images, harmBad) => {
  if (/isolated on a pure white background/.test(prompt) || /different camera angle/.test(prompt) || /a refined e-commerce product photo/.test(prompt)) return product("#ffffff");
  // AI 直接画场景：harmBad = 产品画没了
  if (/featuring EXACTLY the product in the uploaded image \(a cut-out PNG/.test(prompt) && !harmBad) return png(800, 800, (g, w, h) => { g.fillStyle = "#d9c2a5"; g.fillRect(0, 0, w, h); g.fillStyle = "#2a5db0"; g.fillRect(260, 160, 280, 480); });
  // 融入背景：正常就原样还回去（产品没变）；harmBad = 产品被 AI 画没了（测重做、退回原贴图）
  if (/Edit the uploaded image/.test(prompt) && images && images[0] && !harmBad) return Buffer.from(images[0].b64, "base64");
  return png(768, 1024, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#f3e9dc"); gr.addColorStop(1, "#d9c2a5"); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
};


/** 假 AI图图：onCmd 给 connect() 用；asked 记下每个任务；第一次检查背景时说第 1 张有字（测重画） */
export function fakeDetailAI(o = {}) {
  const asked = [];
  let once = true;
  const badBg = () => { const r = once; once = false; return r; };
  return {
    asked,
    async onCmd(m) {
      if (m.cmd !== "run") return { error: "不支持" };
      asked.push({ kind: m.args.kind, prompt: m.args.prompt, images: (m.args.images || []).length, files: (m.args.images || []).map((i) => i.name), mimes: (m.args.images || []).map((i) => i.mime), model: m.args.model || "", site: m.site });
      await new Promise((r) => setTimeout(r, 5));
      if (m.args.kind === "image") return { b64: aiImage(m.args.prompt, m.args.images, o.harmBad).toString("base64"), mime: "image/png" };
      return answer(badBg, m.args.prompt, (m.args.images || []).length, o.harmBad);
    },
  };
}
