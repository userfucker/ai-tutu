/**
 * 详情页图片 → 给 AI 看的几张 JPG。
 * 详情图一般 750～790 宽、十几张，拼起来有一两万像素高。整张长图发给 AI 会被缩小，字就看不清了，
 * 所以统一缩到 750 宽拼起来，再切成几段（每段 1600 像素左右，最多 10 段），切的位置尽量找空白行，免得把一行字切成两半。
 * JPG 质量 70：一段大约 100～200 KB，字还能看清。
 */
import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const W = 750;
const SEG = 1600, MAX_SEG = 10, MAX_H = 30000, MAX_IMGS = 40;

/** 下载一张详情图（淘宝 CDN），失败返回 null */
async function download(url) {
  const u = url.startsWith("//") ? "https:" + url : url;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch(u, { signal: ctl.signal, headers: { Referer: "https://item.taobao.com/", "User-Agent": "Mozilla/5.0" } });
    clearTimeout(t);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch { return null; }
}

/** 一行像素“忙不忙”（颜色变化多 = 有字或图）。切线找最不忙的那一行 */
function quietest(g, from, to) {
  from = Math.max(1, Math.round(from)); to = Math.round(to);
  if (to <= from) return to;
  const d = g.getImageData(0, from, W, to - from).data;
  let best = to, bestScore = Infinity;
  for (let y = 0; y < to - from; y += 2) {
    let score = 0, o = y * W * 4;
    for (let x = 4; x < W * 4; x += 16) score += Math.abs(d[o + x] - d[o + x - 4]) + Math.abs(d[o + x + 1] - d[o + x - 3]);
    // 越靠近目标位置越好（同样安静时选靠后的，段数少一点）
    score += (to - from - y) * 0.02;
    if (score < bestScore) { bestScore = score; best = from + y; }
  }
  return best;
}

/**
 * sources = 图片网址或 Buffer 的数组；outDir 里写 <prefix>_1.jpg … 返回 { files: [文件名], width, height, used, failed, cut }
 */
export async function buildDescImages(sources, outDir, prefix) {
  // GIF 动图跳过：一般是装饰动画，读不出字，有的还特别大
  const isGifUrl = (s) => !Buffer.isBuffer(s) && /\.gif(\?|_|$)/i.test(String(s));
  let gifs = sources.filter(isGifUrl).length;
  const list = sources.filter((s) => !isGifUrl(s)).slice(0, MAX_IMGS);
  const bufs = [];
  for (let i = 0; i < list.length; i += 4) {
    const part = await Promise.all(list.slice(i, i + 4).map((s) => (Buffer.isBuffer(s) ? s : download(String(s)))));
    bufs.push(...part);
  }
  const imgs = [];
  let failed = Math.max(0, sources.length - gifs - MAX_IMGS);
  for (const b of bufs) {
    if (!b) { failed++; continue; }
    if (b.subarray(0, 4).toString("latin1") === "GIF8") { gifs++; continue; }
    try {
      const im = await loadImage(b);
      if (im.width < 200 || im.height < 40) continue; // 小图标、分隔线
      imgs.push(im);
    } catch { failed++; }
  }
  if (!imgs.length) return { files: [], width: 0, height: 0, used: 0, failed, gifs, cut: false };
  let H = imgs.reduce((a, im) => a + Math.round(im.height * (W / im.width)), 0);
  const cut = H > MAX_H;
  H = Math.min(H, MAX_H);
  const c = createCanvas(W, H);
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, W, H);
  let y = 0;
  for (const im of imgs) {
    if (y >= H) break;
    const h = Math.round(im.height * (W / im.width));
    g.drawImage(im, 0, y, W, h);
    y += h;
  }
  // 切段：段数不超过 10，每段大约一样高，切线在目标位置往上 250 像素内找空白行
  const n = Math.min(MAX_SEG, Math.max(1, Math.ceil(H / SEG)));
  const segH = H / n;
  const cuts = [0];
  for (let k = 1; k < n; k++) cuts.push(quietest(g, Math.max(cuts[k - 1] + segH * 0.6, k * segH - 250), k * segH));
  cuts.push(H);
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const h = cuts[k + 1] - cuts[k];
    if (h < 20) continue;
    const s = createCanvas(W, h);
    s.getContext("2d").drawImage(c, 0, cuts[k], W, h, 0, 0, W, h);
    const name = `${prefix}_${files.length + 1}.jpg`;
    fs.writeFileSync(path.join(outDir, name), s.toBuffer("image/jpeg", 70));
    files.push(name);
  }
  return { files, width: W, height: H, used: imgs.length, failed, gifs, cut };
}
