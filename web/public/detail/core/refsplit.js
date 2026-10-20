/**
 * 详情页工作室 · 参考详情图：多张图拼成一张长图，按空白分隔线自动切成一屏一屏。
 */
var ST = globalThis.ST || (globalThis.ST = {});

/** 拼长图：每张缩放到同一宽度，从上往下排。返回 { canvas, joins（每张图的分界 y） } */
ST.stitch = async (blobs, width = 750) => {
  const imgs = [];
  for (const b of blobs) imgs.push(await ST.blobToImage(b));
  let W = width;
  let H = imgs.reduce((a, im) => a + Math.round(im.naturalHeight * (W / im.naturalWidth)), 0);
  if (H > 32000) { W = Math.floor(W * (32000 / H)); H = imgs.reduce((a, im) => a + Math.round(im.naturalHeight * (W / im.naturalWidth)), 0); }
  const c = ST.canvas(W, H);
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, W, H);
  let y = 0;
  const joins = [];
  for (const im of imgs) {
    const h = Math.round(im.naturalHeight * (W / im.naturalWidth));
    g.drawImage(im, 0, y, W, h);
    y += h;
    joins.push(y);
  }
  joins.pop();
  return { canvas: c, joins };
};

/**
 * 自动找切线：
 *  1. 整行颜色几乎一样、连续 8～400 像素的一段（空白分隔条），上下的内容和它不一样 → 切在中间；
 *  2. 两大块纯色背景直接相接（颜色差很多）→ 切在交界处；
 *  3. 多张图拼接的地方。太短的段合并。
 */
ST.autoCuts = (canvas, joins = [], minSeg = 260) => {
  const W = canvas.width, H = canvas.height;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  const uni = new Uint8Array(H);
  const col = new Float32Array(H * 3);
  const step = Math.max(1, Math.floor(W / 120));
  const CH = 2000;
  for (let y0 = 0; y0 < H; y0 += CH) {
    const h = Math.min(CH, H - y0);
    const d = g.getImageData(0, y0, W, h).data;
    for (let y = 0; y < h; y++) {
      let mn = 255, mx = 0, r = 0, gg = 0, b = 0, n = 0;
      for (let x = 0; x < W; x += step) {
        const i = (y * W + x) * 4;
        const v = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
        r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++;
      }
      const Y = y0 + y;
      uni[Y] = mx - mn <= 10 ? 1 : 0;
      col[Y * 3] = r / n; col[Y * 3 + 1] = gg / n; col[Y * 3 + 2] = b / n;
    }
  }
  const dist = (a, b) => Math.abs(col[a * 3] - col[b * 3]) + Math.abs(col[a * 3 + 1] - col[b * 3 + 1]) + Math.abs(col[a * 3 + 2] - col[b * 3 + 2]);
  // 分成一段段：同一种纯色的连续行算一段，其他算内容
  const runs = [];
  for (let y = 0; y < H; ) {
    let e = y + 1;
    if (uni[y]) while (e < H && uni[e] && dist(e, y) <= 18) e++;
    else while (e < H && !uni[e]) e++;
    runs.push({ y, e, uni: !!uni[y] });
    y = e;
  }
  const cands = new Set(joins.map((y) => Math.round(y)));
  runs.forEach((r, i) => {
    if (!r.uni) return;
    const len = r.e - r.y;
    if (len >= 8 && len <= 400 && r.y > 0 && r.e < H) cands.add(Math.round((r.y + r.e) / 2));
    const nx = runs[i + 1];
    if (nx && nx.uni && len >= 40 && nx.e - nx.y >= 40 && dist(r.y, nx.y) > 30) cands.add(nx.y);
  });
  const cuts = [...cands].filter((y) => y > 40 && y < H - 40).sort((a, b) => a - b);
  // 合并太短的段：从上往下，离上一条切线太近的切线去掉
  const out = [];
  let prev = 0;
  for (const y of cuts) {
    if (y - prev >= minSeg) { out.push(y); prev = y; }
  }
  if (out.length && H - out[out.length - 1] < minSeg) out.pop();
  return out;
};

/** 按切线裁出每一屏（缩小到长边 max） */
ST.cropSegments = async (canvas, cuts, max = 1024) => {
  const ys = [0, ...cuts, canvas.height];
  const out = [];
  for (let i = 0; i < ys.length - 1; i++) {
    const h = ys[i + 1] - ys[i];
    if (h < 10) continue;
    const s = Math.min(1, max / Math.max(canvas.width, h));
    const c = ST.canvas(canvas.width * s, h * s);
    c.getContext("2d").drawImage(canvas, 0, ys[i], canvas.width, h, 0, 0, c.width, c.height);
    out.push(await ST.toBlob(c, "image/jpeg", 0.88));
  }
  return out;
};
