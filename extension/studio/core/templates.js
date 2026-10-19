/**
 * 详情页工作室 · 排版模板
 *
 * 每个模板说明：要几张什么图（slots / items）、有哪些文字（texts）、背景要不要 AI 画（bg）、
 * 给 AI 画背景时的构图说明（bgHint，英文），以及 layout(c)：算出每一层放在哪里。
 *
 * 坐标用“设计单位”：宽固定 1000，高按内容算（亚马逊 A+ 这类固定尺寸的，高 = 1000 × 高/宽，c.land = true 横版）。
 * 画的时候再按平台宽度缩放成像素，所以同一个项目换平台宽度会自动重新排。
 *
 * 层的种类（render.js 负责画）：
 *  rect / text / img / icon / line / circle；带 id 的层可以在编辑页面里点中、拖动、改字号。
 */
var ST = globalThis.ST || (globalThis.ST = {});

(() => {
// 一些常用的层
const L = {
  head: (c, id, x, y, w, h, size, o = {}) => ({ t: "text", id, text: o.text ?? c.t(id), x, y, w, h, size, min: size * 0.5, role: "head", weight: 700, color: c.T.text, align: "center", valign: "middle", lines: 2, lh: 1.25, ...o }),
  body: (c, id, x, y, w, h, size, o = {}) => ({ t: "text", id, text: o.text ?? c.t(id), x, y, w, h, size, min: size * 0.6, role: "body", weight: 400, color: c.T.sub, align: "center", valign: "top", lines: 3, lh: 1.45, ...o }),
  product: (id, asset, x, y, w, h, o = {}) => ({ t: "img", id, asset, use: "auto", fit: "contain", shadow: true, x, y, w, h, align: "bottom", ...o }),
  photo: (id, asset, x, y, w, h, o = {}) => ({ t: "img", id, asset, use: "orig", fit: "cover", x, y, w, h, r: 14, ...o }),
  card: (c, x, y, w, h, o = {}) => ({ t: "rect", x, y, w, h, fill: c.T.card, r: 22, shadow: 0.08, ...o }),
};
/** 产品按自身比例放进框里以后实际占的位置（尺寸图要按它画尺寸线） */
function containBox(ratio, x, y, w, h, alignBottom) {
  if (!ratio) return { x, y, w, h };
  let bw = w, bh = w / ratio;
  if (bh > h) { bh = h; bw = h * ratio; }
  return { x: x + (w - bw) / 2, y: alignBottom ? y + h - bh : y + (h - bh) / 2, w: bw, h: bh };
}
/** 标题区（大标题 + 副标题），返回下面内容开始的 y */
function titleBlock(c, y, o = {}) {
  const out = [];
  const size = o.size || (c.land ? 46 : 60);
  const hasSub = o.sub !== false && c.t("sub");
  out.push(L.head(c, "title", o.x ?? 60, y, o.w ?? 880, c.land ? 70 : 100, size, { align: o.align || "center", lines: o.lines || 2 }));
  y += c.land ? 72 : 104;
  if (hasSub) {
    out.push(L.body(c, "sub", o.x ?? 80, y, o.w ?? 840, c.land ? 40 : 60, c.land ? 22 : 30, { align: o.align || "center", lines: 2 }));
    y += c.land ? 44 : 66;
  }
  return { layers: out, y: y + (c.land ? 10 : 24) };
}
const grid = (n, cols, x0, y0, w, cellW, cellH, gapX, gapY) => {
  const out = [];
  const rows = Math.ceil(n / cols);
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), k = i % cols;
    const inRow = r === rows - 1 ? n - r * cols : cols;
    const rowW = inRow * cellW + (inRow - 1) * gapX;
    out.push({ x: x0 + (w - rowW) / 2 + k * (cellW + gapX), y: y0 + r * (cellH + gapY) });
  }
  return out;
};

ST.TPL = {
  hero: {
    name: "首屏海报", bg: "ai", bgColor: "light",
    desc: "大标题 + 产品主图 + 背景场景，详情页第一屏",
    slots: [{ key: "main", name: "产品图", tags: ["white", "angle"] }],
    texts: [{ key: "title", name: "大标题", max: 14 }, { key: "sub", name: "副标题", max: 24 }],
    items: { min: 0, max: 3, def: 3, fields: ["title"], name: "小卖点（最多 3 个，一行字）" },
    bgHint: (land) => land
      ? "Wide banner composition. Keep the left half calm, soft and low-detail for headline text. On the right half, an empty pedestal or surface where a product will be placed later."
      : "Vertical poster composition. The top 30% is a calm, clean, low-detail area for a headline. In the lower middle, an empty pedestal, podium or surface where a product will be placed later.",
    layout(c) {
      const out = [];
      if (c.land) {
        const H = c.H;
        if (c.logo) out.push({ t: "img", id: "logo", key: c.logo, use: "orig", fit: "contain", x: 50, y: 28, w: 150, h: 50, align: "left" });
        out.push(L.head(c, "title", 50, H * 0.2, 440, H * 0.3, 54, { align: "left", lines: 2 }));
        out.push(L.body(c, "sub", 50, H * 0.52, 440, H * 0.14, 24, { align: "left", lines: 2 }));
        c.items.slice(0, 3).forEach((it, i) => {
          out.push({ t: "rect", x: 50 + i * 150, y: H * 0.72, w: 140, h: 44, fill: c.T.primary, r: 22 });
          out.push(L.body(c, `item${i}.title`, 54 + i * 150, H * 0.72, 132, 44, 18, { text: c.it(i, "title"), color: "#ffffff", valign: "middle", lines: 1 }));
        });
        if (!c.blend) out.push(L.product("main", c.slot("main"), 520, 30, 440, H - 60));
        return { h: H, layers: out };
      }
      if (c.logo) out.push({ t: "img", id: "logo", key: c.logo, use: "orig", fit: "contain", x: 50, y: 40, w: 200, h: 64, align: "left" });
      out.push(L.head(c, "title", 70, 120, 860, 150, 78, { lines: 2 }));
      out.push(L.body(c, "sub", 90, 280, 820, 80, 34, { lines: 2 }));
      if (!c.blend) out.push(L.product("main", c.slot("main"), 140, 390, 720, 700));
      const n = Math.min(3, c.items.length);
      grid(n, 3, 60, 1140, 880, 270, 64, 30, 0).forEach((p, i) => {
        out.push({ t: "rect", x: p.x, y: p.y, w: 270, h: 64, fill: c.T.primary, r: 32 });
        out.push(L.body(c, `item${i}.title`, p.x + 10, p.y, 250, 64, 26, { text: c.it(i, "title"), color: "#ffffff", valign: "middle", lines: 1 }));
      });
      return { h: n ? 1260 : 1150, layers: out };
    },
  },

  features3: {
    name: "卖点三宫格", bg: "color", bgColor: "light",
    desc: "三个卖点并排，每个配一张细节图或图标",
    texts: [{ key: "title", name: "标题", max: 12 }, { key: "sub", name: "副标题", max: 24 }],
    items: { min: 2, max: 3, def: 3, fields: ["title", "desc"], asset: true, icon: true, name: "卖点" },
    bgHint: () => "Very soft, subtle, low-detail background texture with gentle gradient light, suitable to sit behind cards and text.",
    layout(c) {
      const n = Math.max(1, Math.min(3, c.items.length));
      if (c.land) {
        const tb = titleBlock(c, 24, { sub: false });
        const out = [...tb.layers];
        const top = tb.y, ch = c.H - top - 24, cw = (920 - (n - 1) * 24) / n;
        for (let i = 0; i < n; i++) {
          const x = 40 + i * (cw + 24);
          out.push(L.card(c, x, top, cw, ch));
          const ih = ch * 0.48;
          if (c.item(i)) out.push(L.photo(`item${i}.img`, c.item(i), x + 12, top + 12, cw - 24, ih));
          else out.push({ t: "icon", id: `item${i}.icon`, name: c.items[i].icon || "sparkle", x: x + cw / 2 - ih * 0.3, y: top + 12 + ih * 0.2, s: ih * 0.6, color: c.T.accent });
          out.push(L.head(c, `item${i}.title`, x + 14, top + ih + 20, cw - 28, 44, 26, { text: c.it(i, "title"), lines: 1 }));
          out.push(L.body(c, `item${i}.desc`, x + 14, top + ih + 70, cw - 28, ch - ih - 80, 18, { text: c.it(i, "desc"), lines: 3 }));
        }
        return { h: c.H, layers: out };
      }
      const tb = titleBlock(c, 70);
      const out = [...tb.layers];
      const top = tb.y, cw = n === 3 ? 296 : 420, ch = 690;
      grid(n, 3, 40, top, 920, cw, ch, 26, 0).forEach((p, i) => {
        out.push(L.card(c, p.x, p.y, cw, ch));
        if (c.item(i)) out.push(L.photo(`item${i}.img`, c.item(i), p.x + 16, p.y + 16, cw - 32, 320));
        else {
          out.push({ t: "circle", cx: p.x + cw / 2, cy: p.y + 176, r: 100, fill: c.T.light });
          out.push({ t: "icon", id: `item${i}.icon`, name: c.items[i].icon || "sparkle", x: p.x + cw / 2 - 60, y: p.y + 116, s: 120, color: c.T.accent });
        }
        out.push(L.head(c, `item${i}.title`, p.x + 18, p.y + 352, cw - 36, 100, 36, { text: c.it(i, "title") }));
        out.push(L.body(c, `item${i}.desc`, p.x + 18, p.y + 462, cw - 36, 200, 25, { text: c.it(i, "desc"), lines: 5 }));
      });
      return { h: top + ch + 70, layers: out };
    },
  },

  features4: {
    name: "卖点四宫格", bg: "color", bgColor: "light",
    desc: "四个卖点，两行两列",
    texts: [{ key: "title", name: "标题", max: 12 }, { key: "sub", name: "副标题", max: 24 }],
    items: { min: 4, max: 4, def: 4, fields: ["title", "desc"], asset: true, icon: true, name: "卖点" },
    bgHint: () => "Very soft, subtle, low-detail background texture with gentle gradient light, suitable to sit behind cards and text.",
    layout(c) {
      const n = Math.min(4, Math.max(1, c.items.length));
      const out = [];
      if (c.land) {
        const tb = titleBlock(c, 24, { sub: false });
        out.push(...tb.layers);
        const top = tb.y, ch = c.H - top - 24, cw = (940 - (n - 1) * 20) / n;
        for (let i = 0; i < n; i++) {
          const x = 30 + i * (cw + 20);
          out.push(L.card(c, x, top, cw, ch));
          const ih = ch * 0.45;
          if (c.item(i)) out.push(L.photo(`item${i}.img`, c.item(i), x + 10, top + 10, cw - 20, ih));
          else out.push({ t: "icon", id: `item${i}.icon`, name: c.items[i].icon || "sparkle", x: x + cw / 2 - ih * 0.3, y: top + 10 + ih * 0.2, s: ih * 0.6, color: c.T.accent });
          out.push(L.head(c, `item${i}.title`, x + 10, top + ih + 16, cw - 20, 40, 22, { text: c.it(i, "title"), lines: 1 }));
          out.push(L.body(c, `item${i}.desc`, x + 10, top + ih + 60, cw - 20, ch - ih - 70, 16, { text: c.it(i, "desc"), lines: 3 }));
        }
        return { h: c.H, layers: out };
      }
      const tb = titleBlock(c, 70);
      out.push(...tb.layers);
      const top = tb.y, cw = 440, ch = 480;
      grid(n, 2, 40, top, 920, cw, ch, 40, 36).forEach((p, i) => {
        out.push(L.card(c, p.x, p.y, cw, ch));
        if (c.item(i)) out.push(L.photo(`item${i}.img`, c.item(i), p.x + 16, p.y + 16, cw - 32, 250));
        else {
          out.push({ t: "circle", cx: p.x + cw / 2, cy: p.y + 140, r: 90, fill: c.T.light });
          out.push({ t: "icon", id: `item${i}.icon`, name: c.items[i].icon || "sparkle", x: p.x + cw / 2 - 55, y: p.y + 85, s: 110, color: c.T.accent });
        }
        out.push(L.head(c, `item${i}.title`, p.x + 20, p.y + 280, cw - 40, 60, 34, { text: c.it(i, "title"), lines: 1 }));
        out.push(L.body(c, `item${i}.desc`, p.x + 20, p.y + 350, cw - 40, 110, 24, { text: c.it(i, "desc"), lines: 3 }));
      });
      const rows = Math.ceil(n / 2);
      return { h: top + rows * ch + (rows - 1) * 36 + 70, layers: out };
    },
  },

  feature: {
    name: "单个卖点大图", bg: "ai", bgColor: "light",
    desc: "一个卖点配一张大场景图",
    slots: [{ key: "main", name: "产品图", tags: ["white", "angle", "detail"] }],
    texts: [{ key: "title", name: "卖点标题", max: 14 }, { key: "sub", name: "说明", max: 40 }],
    bgHint: (land) => land
      ? "Wide composition that visually expresses the selling point. Keep the left 45% calm and low-detail for text. Empty surface area on the right where a product will be placed later."
      : "Vertical composition that visually expresses the selling point. The top 30% is calm and low-detail for text. Empty surface in the lower middle where a product will be placed later.",
    layout(c) {
      const out = [];
      if (c.land) {
        out.push(L.head(c, "title", 50, c.H * 0.22, 420, c.H * 0.26, 46, { align: "left" }));
        out.push(L.body(c, "sub", 50, c.H * 0.52, 420, c.H * 0.3, 22, { align: "left", lines: 4 }));
        if (!c.blend) out.push(L.product("main", c.slot("main"), 500, 30, 460, c.H - 60));
        return { h: c.H, layers: out };
      }
      out.push(L.head(c, "title", 70, 80, 860, 150, 66));
      out.push(L.body(c, "sub", 90, 240, 820, 120, 30, { lines: 3 }));
      if (!c.blend) out.push(L.product("main", c.slot("main"), 170, 400, 660, 620));
      return { h: 1100, layers: out };
    },
  },

  callout: {
    name: "细节放大", bg: "color", bgColor: "light",
    desc: "产品图 + 圆圈放大细节，用引线指到对应位置（引线端点可以拖）",
    slots: [{ key: "main", name: "产品图", tags: ["white", "angle"] }],
    texts: [{ key: "title", name: "标题", max: 12 }, { key: "sub", name: "副标题", max: 24 }],
    items: { min: 1, max: 3, def: 3, fields: ["title", "desc"], asset: true, name: "细节" },
    bgHint: () => "Clean, soft, low-detail studio backdrop with gentle gradient light.",
    layout(c) {
      const n = Math.min(3, Math.max(1, c.items.length));
      const out = [];
      let pb, circles;
      if (c.land) {
        const tb = titleBlock(c, 20, { sub: false, size: 40 });
        out.push(...tb.layers);
        pb = { x: 30, y: tb.y, w: 400, h: c.H - tb.y - 20 };
        const slot = 520 / n;
        const r = Math.max(30, Math.min(slot / 2 - 14, (c.H - tb.y - 110) / 2, 100));
        circles = Array.from({ length: n }, (_, i) => ({ cx: 460 + slot * (i + 0.5), cy: tb.y + r + 6, r }));
        circles.forEach((q, i) => {
          out.push(L.head(c, `item${i}.title`, q.cx - slot / 2 + 6, q.cy + q.r + 10, slot - 12, 34, 20, { text: c.it(i, "title"), lines: 1 }));
          out.push(L.body(c, `item${i}.desc`, q.cx - slot / 2 + 6, q.cy + q.r + 46, slot - 12, Math.max(36, c.H - q.cy - q.r - 56), 15, { text: c.it(i, "desc"), lines: 2 }));
        });
      } else {
        const tb = titleBlock(c, 60);
        out.push(...tb.layers);
        pb = { x: 30, y: tb.y, w: 560, h: 860 };
        const step = 860 / n;
        const r = Math.min(110, (step - 126) / 2);
        circles = Array.from({ length: n }, (_, i) => ({ cx: 790, cy: tb.y + step * i + r + 4, r }));
        circles.forEach((q, i) => {
          out.push(L.head(c, `item${i}.title`, q.cx - 170, q.cy + q.r + 8, 340, 44, 30, { text: c.it(i, "title"), lines: 1 }));
          out.push(L.body(c, `item${i}.desc`, q.cx - 170, q.cy + q.r + 54, 340, Math.max(64, step - 2 * q.r - 62), 22, { text: c.it(i, "desc"), lines: 2 }));
        });
      }
      out.push(L.product("main", c.slot("main"), pb.x, pb.y, pb.w, pb.h, { align: "center" }));
      const pr = containBox(c.ratio(c.slot("main")), pb.x, pb.y, pb.w, pb.h);
      circles.forEach((q, i) => {
        const a = c.items[i].anchor || { x: 0.55, y: 0.25 + (0.5 * i) / Math.max(1, n - 1) };
        const ax = pr.x + pr.w * a.x, ay = pr.y + pr.h * a.y;
        out.push({ t: "line", link: [`item${i}.img`, `item${i}.anchor`], color: c.T.accent, w: 3 });
        out.push({ t: "circle", id: `item${i}.anchor`, cx: ax, cy: ay, r: 9, fill: c.T.accent, stroke: "#ffffff", sw: 3, handle: true });
        out.push({ t: "img", id: `item${i}.img`, asset: c.item(i), use: "orig", fit: "cover", x: q.cx - q.r, y: q.cy - q.r, w: q.r * 2, h: q.r * 2, circle: true, border: c.T.accent, bw: 6 });
      });
      return { h: c.land ? c.H : pb.y + pb.h + 50, layers: out };
    },
  },

  angles: {
    name: "多角度展示", bg: "color", bgColor: "white",
    desc: "正面 / 侧面 / 背面等多张角度图",
    texts: [{ key: "title", name: "标题", max: 12 }, { key: "sub", name: "副标题", max: 24 }],
    items: { min: 2, max: 4, def: 3, fields: ["title"], asset: true, assetTags: ["angle", "white"], name: "角度" },
    bgHint: () => "Clean, bright, low-detail studio backdrop.",
    layout(c) {
      const n = Math.min(4, Math.max(1, c.items.length));
      const out = [];
      if (c.land) {
        const tb = titleBlock(c, 20, { sub: false, size: 40 });
        out.push(...tb.layers);
        const cw = (940 - (n - 1) * 20) / n, ch = c.H - tb.y - 70;
        for (let i = 0; i < n; i++) {
          const x = 30 + i * (cw + 20);
          out.push({ t: "rect", x, y: tb.y, w: cw, h: ch, fill: c.T.light, r: 16 });
          out.push(L.product(`item${i}.img`, c.item(i), x + 14, tb.y + 14, cw - 28, ch - 28, { align: "center", shadow: false }));
          out.push(L.body(c, `item${i}.title`, x, tb.y + ch + 8, cw, 40, 20, { text: c.it(i, "title"), lines: 1, color: c.T.text }));
        }
        return { h: c.H, layers: out };
      }
      const tb = titleBlock(c, 60);
      out.push(...tb.layers);
      const cols = n === 4 ? 2 : n;
      const cw = cols === 2 ? 440 : 296, ch = cols === 2 ? 440 : 420;
      grid(n, cols, 40, tb.y, 920, cw, ch + 60, cols === 2 ? 40 : 26, 20).forEach((p, i) => {
        out.push({ t: "rect", x: p.x, y: p.y, w: cw, h: ch, fill: c.T.light, r: 20 });
        out.push(L.product(`item${i}.img`, c.item(i), p.x + 20, p.y + 20, cw - 40, ch - 40, { align: "center", shadow: false }));
        out.push(L.body(c, `item${i}.title`, p.x, p.y + ch + 8, cw, 48, 28, { text: c.it(i, "title"), lines: 1, color: c.T.text, valign: "middle" }));
      });
      const rows = Math.ceil(n / cols);
      return { h: tb.y + rows * (ch + 60) + (rows - 1) * 20 + 50, layers: out };
    },
  },

  colors: {
    name: "颜色 / 规格展示", bg: "color", bgColor: "white",
    desc: "每个颜色或规格一张图，下面写名字",
    texts: [{ key: "title", name: "标题", max: 12 }, { key: "sub", name: "副标题", max: 24 }],
    items: { min: 1, max: 9, def: 3, fields: ["title"], asset: true, assetTags: ["spec", "white"], name: "颜色/规格" },
    bgHint: () => "Clean, bright, low-detail studio backdrop.",
    layout(c) {
      const n = Math.min(9, Math.max(1, c.items.length));
      const out = [];
      if (c.land) {
        const tb = titleBlock(c, 20, { sub: false, size: 40 });
        out.push(...tb.layers);
        const m = Math.min(n, 6);
        const cw = Math.min(220, (940 - (m - 1) * 16) / m), ch = c.H - tb.y - 64;
        grid(m, m, 30, tb.y, 940, cw, ch, 16, 0).forEach((p, i) => {
          out.push({ t: "rect", x: p.x, y: p.y, w: cw, h: ch, fill: c.T.light, r: 14 });
          out.push(L.product(`item${i}.img`, c.item(i), p.x + 10, p.y + 10, cw - 20, ch - 20, { align: "center", shadow: false }));
          out.push(L.body(c, `item${i}.title`, p.x, p.y + ch + 6, cw, 36, 18, { text: c.it(i, "title"), lines: 1, color: c.T.text }));
        });
        return { h: c.H, layers: out };
      }
      const tb = titleBlock(c, 60);
      out.push(...tb.layers);
      const cols = n <= 4 ? 2 : 3;
      const cw = cols === 2 ? 430 : 290;
      grid(n, cols, 40, tb.y, 920, cw, cw + 64, cols === 2 ? 40 : 25, 24).forEach((p, i) => {
        out.push({ t: "rect", x: p.x, y: p.y, w: cw, h: cw, fill: c.T.light, r: 18 });
        out.push(L.product(`item${i}.img`, c.item(i), p.x + 16, p.y + 16, cw - 32, cw - 32, { align: "center", shadow: false }));
        out.push(L.body(c, `item${i}.title`, p.x, p.y + cw + 8, cw, 50, 28, { text: c.it(i, "title"), lines: 1, color: c.T.text, valign: "middle" }));
      });
      const rows = Math.ceil(n / cols);
      return { h: tb.y + rows * (cw + 64) + (rows - 1) * 24 + 50, layers: out };
    },
  },

  scene: {
    name: "使用场景", bg: "ai", bgColor: "light",
    desc: "生活场景图，产品放在场景里",
    slots: [{ key: "main", name: "产品图", tags: ["white", "angle"] }],
    texts: [{ key: "title", name: "标题", max: 14 }, { key: "sub", name: "说明", max: 30 }],
    bgHint: (land) => land
      ? "Wide realistic lifestyle scene. The left 45% is calmer for text. A clear empty surface on the right side where a product will be placed later."
      : "Vertical realistic lifestyle scene. The top 25% is calmer for text. A clear empty surface in the lower middle where a product will be placed later.",
    layout(c) {
      const out = [];
      if (c.land) {
        out.push({ t: "rect", x: 0, y: 0, w: 560, h: c.H, grad: ["rgba(255,255,255,0.78)", "rgba(255,255,255,0)"], dir: "h" });
        out.push(L.head(c, "title", 50, c.H * 0.24, 430, c.H * 0.26, 46, { align: "left" }));
        out.push(L.body(c, "sub", 50, c.H * 0.54, 430, c.H * 0.26, 22, { align: "left", lines: 3, color: c.T.text }));
        if (!c.blend) out.push(L.product("main", c.slot("main"), 560, 60, 400, c.H - 100));
        return { h: c.H, layers: out };
      }
      out.push({ t: "rect", x: 0, y: 0, w: 1000, h: 420, grad: ["rgba(255,255,255,0.8)", "rgba(255,255,255,0)"], dir: "v" });
      out.push(L.head(c, "title", 70, 70, 860, 130, 62));
      out.push(L.body(c, "sub", 90, 210, 820, 100, 30, { lines: 2, color: c.T.text }));
      if (!c.blend) out.push(L.product("main", c.slot("main"), 230, 480, 540, 540));
      return { h: 1100, layers: out };
    },
  },

  compare: {
    name: "对比", bg: "color", bgColor: "light",
    desc: "我们 vs 普通款，一条条对比",
    slots: [{ key: "right", name: "我们的产品图（可不放）", tags: ["white"] }, { key: "left", name: "普通款图（可不放）", tags: ["other"] }],
    texts: [{ key: "title", name: "标题", max: 12 }, { key: "left", name: "左边标题（普通款）", max: 8 }, { key: "right", name: "右边标题（我们的）", max: 8 }],
    items: { min: 3, max: 6, def: 4, fields: ["title", "desc"], name: "对比项（标题=我们的，说明=普通款）" },
    bgHint: () => "Very soft, subtle, low-detail background.",
    layout(c) {
      const n = Math.min(6, Math.max(1, c.items.length));
      const out = [];
      const land = c.land;
      const tb = titleBlock(c, land ? 20 : 60, { sub: false, size: land ? 40 : 60 });
      out.push(...tb.layers);
      let y = tb.y;
      const hasImg = c.slot("left") || c.slot("right");
      const colX = [60, 520], colW = 420;
      if (hasImg && !land) {
        if (c.slot("left")) out.push(L.product("left.img", c.slot("left"), colX[0] + 40, y, colW - 80, 280, { shadow: false, align: "center" }));
        if (c.slot("right")) out.push(L.product("right.img", c.slot("right"), colX[1] + 40, y, colW - 80, 280, { align: "center" }));
        y += 300;
      }
      const hh = land ? 46 : 72;
      out.push({ t: "rect", x: colX[0], y, w: colW, h: hh, fill: "#9aa0a6", r: hh / 2 });
      out.push(L.head(c, "left", colX[0], y, colW, hh, land ? 22 : 32, { color: "#ffffff", lines: 1 }));
      out.push({ t: "rect", x: colX[1], y, w: colW, h: hh, fill: c.T.primary, r: hh / 2 });
      out.push(L.head(c, "right", colX[1], y, colW, hh, land ? 22 : 32, { color: "#ffffff", lines: 1 }));
      y += hh + (land ? 10 : 20);
      const rh = land ? Math.max(30, (c.H - y - 16) / n) : 96;
      for (let i = 0; i < n; i++) {
        const ry = y + i * rh;
        out.push({ t: "rect", x: colX[0], y: ry, w: colW, h: rh - 8, fill: c.T.card, r: 14 });
        out.push({ t: "rect", x: colX[1], y: ry, w: colW, h: rh - 8, fill: c.T.card, r: 14, stroke: c.T.primary, sw: 2 });
        const is = Math.min(40, rh * 0.5);
        out.push({ t: "icon", name: "cross", x: colX[0] + 16, y: ry + (rh - 8 - is) / 2, s: is, color: "#c0392b" });
        out.push({ t: "icon", name: "check", x: colX[1] + 16, y: ry + (rh - 8 - is) / 2, s: is, color: c.T.primary });
        out.push(L.body(c, `item${i}.desc`, colX[0] + 24 + is, ry, colW - 40 - is, rh - 8, land ? 16 : 25, { text: c.it(i, "desc"), align: "left", valign: "middle", lines: 2 }));
        out.push(L.body(c, `item${i}.title`, colX[1] + 24 + is, ry, colW - 40 - is, rh - 8, land ? 16 : 25, { text: c.it(i, "title"), align: "left", valign: "middle", lines: 2, color: c.T.text, weight: 700 }));
      }
      return { h: land ? c.H : y + n * rh + 50, layers: out };
    },
  },

  params: {
    name: "参数表", bg: "color", bgColor: "white",
    desc: "产品参数表格（内容来自“产品信息”里的参数表，AI 不改数字）",
    slots: [{ key: "main", name: "产品图", tags: ["white", "angle"] }],
    texts: [{ key: "title", name: "标题", max: 10 }],
    bgHint: () => "Clean, bright, low-detail studio backdrop.",
    layout(c) {
      const rows = c.params();
      const n = Math.max(1, rows.length);
      const out = [];
      if (c.land) {
        const tb = titleBlock(c, 20, { sub: false, size: 40 });
        out.push(...tb.layers);
        out.push(L.product("main", c.slot("main"), 30, tb.y, 330, c.H - tb.y - 20, { align: "center" }));
        const rh = Math.min(48, (c.H - tb.y - 20) / n);
        rows.forEach((r, i) => {
          const y = tb.y + i * rh;
          out.push({ t: "rect", x: 390, y, w: 580, h: rh, fill: i % 2 ? c.T.card : c.T.light });
          out.push(L.body(c, `param${i}.k`, 400, y, 190, rh, 17, { text: r.k, align: "left", valign: "middle", lines: 1, color: c.T.sub }));
          out.push(L.body(c, `param${i}.v`, 600, y, 360, rh, 17, { text: r.v, align: "left", valign: "middle", lines: 2, color: c.T.text }));
        });
        return { h: c.H, layers: out };
      }
      const tb = titleBlock(c, 60, { sub: false });
      out.push(...tb.layers);
      out.push(L.product("main", c.slot("main"), 220, tb.y, 560, 380, { align: "center" }));
      let y = tb.y + 410;
      const rh = 76;
      rows.forEach((r, i) => {
        out.push({ t: "rect", x: 60, y: y + i * rh, w: 880, h: rh, fill: i % 2 ? c.T.card : c.T.light, r: 0 });
        out.push(L.body(c, `param${i}.k`, 90, y + i * rh, 260, rh, 26, { text: r.k, align: "left", valign: "middle", lines: 1 }));
        out.push(L.body(c, `param${i}.v`, 370, y + i * rh, 550, rh, 26, { text: r.v, align: "left", valign: "middle", lines: 2, color: c.T.text }));
      });
      out.push({ t: "rect", x: 60, y, w: 880, h: n * rh, stroke: c.T.light, sw: 2, r: 0 });
      return { h: y + n * rh + 60, layers: out };
    },
  },

  size: {
    name: "尺寸图", bg: "color", bgColor: "white",
    desc: "产品图加尺寸标注线（尺寸来自“产品信息”，自动换算单位）",
    slots: [{ key: "main", name: "正面图", tags: ["white", "angle", "size"] }, { key: "side", name: "侧面图（可不放）", tags: ["angle"] }],
    texts: [{ key: "title", name: "标题", max: 10 }, { key: "note", name: "备注", max: 30 }],
    bgHint: () => "Clean, bright, low-detail studio backdrop.",
    layout(c) {
      const d = c.dims();
      const out = [];
      const tb = titleBlock(c, c.land ? 20 : 60, { sub: false, size: c.land ? 40 : 60 });
      out.push(...tb.layers);
      const H = c.land ? c.H - tb.y - 70 : 600;
      const side = c.slot("side");
      const boxes = side ? [{ id: "main", x: 80, w: 460 }, { id: "side", x: 600, w: 320 }] : [{ id: "main", x: 200, w: 560 }];
      const col = c.T.sub;
      boxes.forEach((b, k) => {
        const asset = c.slot(b.id);
        out.push(L.product(b.id, asset, b.x, tb.y + 10, b.w, H - 40, { align: "bottom", shadow: false }));
        const pr = containBox(c.ratio(asset), b.x, tb.y + 10, b.w, H - 40, true);
        const by = pr.y + pr.h + 30;
        const wl = k === 0 ? d.w : d.l;
        if (wl) {
          out.push({ t: "line", pts: [[pr.x, by], [pr.x + pr.w, by]], color: col, w: 2, arrows: true });
          out.push(L.body(c, `dim.${k ? "l" : "w"}`, pr.x - 40, by + 8, pr.w + 80, 44, c.land ? 18 : 26, { text: wl, lines: 1, color: c.T.text, valign: "top" }));
        }
        if (k === 0 && d.h) {
          const rx = pr.x + pr.w + 30;
          out.push({ t: "line", pts: [[rx, pr.y], [rx, pr.y + pr.h]], color: col, w: 2, arrows: true });
          out.push(L.body(c, "dim.h", rx + 10, pr.y + pr.h / 2 - 24, 200, 48, c.land ? 18 : 26, { text: d.h, lines: 1, align: "left", color: c.T.text, valign: "middle" }));
        }
      });
      let y = tb.y + H + 60;
      if (c.t("note")) { out.push(L.body(c, "note", 80, y, 840, 60, c.land ? 16 : 24, { lines: 2 })); y += 70; }
      return { h: c.land ? c.H : y + 30, layers: out };
    },
  },

  package: {
    name: "包装清单", bg: "color", bgColor: "light",
    desc: "包装里有哪些东西，每样一张图",
    texts: [{ key: "title", name: "标题", max: 10 }, { key: "sub", name: "说明", max: 30 }],
    items: { min: 1, max: 8, def: 3, fields: ["title"], asset: true, assetTags: ["package", "white", "other"], name: "包装里的东西" },
    bgHint: () => "Very soft, subtle, low-detail background.",
    layout(c) {
      const n = Math.min(8, Math.max(1, c.items.length));
      const out = [];
      if (c.land) {
        const tb = titleBlock(c, 20, { sub: false, size: 40 });
        out.push(...tb.layers);
        const cw = Math.min(200, (940 - (n - 1) * 16) / n), ch = c.H - tb.y - 60;
        grid(n, n, 30, tb.y, 940, cw, ch, 16, 0).forEach((p, i) => {
          out.push(L.card(c, p.x, p.y, cw, ch));
          out.push(L.product(`item${i}.img`, c.item(i), p.x + 10, p.y + 10, cw - 20, ch - 20, { align: "center", shadow: false }));
          out.push(L.body(c, `item${i}.title`, p.x, p.y + ch + 6, cw, 34, 17, { text: c.it(i, "title"), lines: 1, color: c.T.text }));
        });
        return { h: c.H, layers: out };
      }
      const tb = titleBlock(c, 60);
      out.push(...tb.layers);
      const cols = n <= 4 ? 2 : 3;
      const cw = cols === 2 ? 430 : 290;
      grid(n, cols, 40, tb.y, 920, cw, cw + 60, cols === 2 ? 40 : 25, 20).forEach((p, i) => {
        out.push(L.card(c, p.x, p.y, cw, cw));
        out.push(L.product(`item${i}.img`, c.item(i), p.x + 20, p.y + 20, cw - 40, cw - 40, { align: "center", shadow: false }));
        out.push(L.body(c, `item${i}.title`, p.x, p.y + cw + 6, cw, 48, 27, { text: c.it(i, "title"), lines: 1, color: c.T.text, valign: "middle" }));
      });
      const rows = Math.ceil(n / cols);
      return { h: tb.y + rows * (cw + 60) + (rows - 1) * 20 + 50, layers: out };
    },
  },

  service: {
    name: "售后保障", bg: "color", bgColor: "white",
    desc: "售后、发货、质保等承诺，配图标",
    texts: [{ key: "title", name: "标题", max: 10 }],
    items: { min: 2, max: 6, def: 4, fields: ["title", "desc"], icon: true, name: "保障项" },
    bgHint: () => "Very soft, subtle, low-detail background.",
    layout(c) {
      const n = Math.min(6, Math.max(1, c.items.length));
      const out = [];
      const tb = titleBlock(c, c.land ? 20 : 60, { sub: false, size: c.land ? 40 : 56 });
      out.push(...tb.layers);
      const cols = c.land ? n : n <= 4 ? 2 : 3;
      const cw = c.land ? (940 - (n - 1) * 16) / n : cols === 2 ? 430 : 290;
      const ch = c.land ? c.H - tb.y - 24 : 250;
      grid(n, cols, c.land ? 30 : 40, tb.y, c.land ? 940 : 920, cw, ch, c.land ? 16 : cols === 2 ? 40 : 25, 24).forEach((p, i) => {
        out.push({ t: "rect", x: p.x, y: p.y, w: cw, h: ch, fill: c.T.light, r: 20 });
        const is = c.land ? Math.min(70, ch * 0.32) : 84;
        out.push({ t: "circle", cx: p.x + cw / 2, cy: p.y + 20 + is / 2 + 8, r: is / 2 + 8, fill: c.T.primary });
        out.push({ t: "icon", id: `item${i}.icon`, name: c.items[i].icon || "shield", x: p.x + cw / 2 - is * 0.32, y: p.y + 28 + is * 0.18, s: is * 0.64, color: "#ffffff" });
        const ty = p.y + 40 + is;
        out.push(L.head(c, `item${i}.title`, p.x + 12, ty, cw - 24, c.land ? 34 : 50, c.land ? 20 : 30, { text: c.it(i, "title"), lines: 1 }));
        out.push(L.body(c, `item${i}.desc`, p.x + 14, ty + (c.land ? 36 : 54), cw - 28, ch - (ty - p.y) - (c.land ? 40 : 60), c.land ? 15 : 22, { text: c.it(i, "desc"), lines: 2 }));
      });
      const rows = Math.ceil(n / cols);
      return { h: c.land ? c.H : tb.y + rows * ch + (rows - 1) * 24 + 60, layers: out };
    },
  },
};
ST.TPL_ORDER = ["hero", "features3", "features4", "feature", "callout", "angles", "colors", "scene", "compare", "params", "size", "package", "service"];
ST.containBox = containBox;
})();
