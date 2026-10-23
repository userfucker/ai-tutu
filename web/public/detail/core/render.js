/**
 * 详情页工作室 · 把一屏画到画布上
 *
 * 四层叠起来：背景（AI 画的 / 纯色）→ 产品（抠好的透明图，程序加投影）→ 图标装饰 → 文字。
 * 改字、换语言只重画，不用重新生成。
 *
 * ST.renderScreen(project, screen, { platform, lang, scale, brand, forExport })
 *   → { canvas, H（设计单位高度）, k（每设计单位多少像素）, boxes（可点中的层）, issues（问题） }
 */
var ST = globalThis.ST || (globalThis.ST = {});
(() => {
  ST.theme = (project, brand) => {
    const T = { ...(ST.TONES[project.tone] || ST.TONES.minimal) };
    if (brand) {
      if (brand.primary) T.primary = brand.primary;
      if (brand.accent) T.accent = brand.accent;
      if (brand.text) T.text = brand.text;
      if (brand.font) T.head = brand.font;
    }
    return T;
  };
  ST.unitsMode = (project, lang) => (project.units && project.units !== "auto" ? project.units : ST.lang(lang).units);

  /** 文字：当前语言没有就用主语言（并记一个“没翻译”） */
  ST.tr = (obj, lang, main) => {
    if (!obj) return { text: "", missing: false };
    if (typeof obj === "string") return { text: obj, missing: false };
    const v = obj[lang];
    if (v !== undefined && v !== null && v !== "") return { text: v, missing: false };
    const m = obj[main] || "";
    return { text: m, missing: lang !== main && !!m };
  };

  ST.assetOf = (project, id) => (id ? project.assets.find((a) => a.id === id) : null);
  /** 产品图显示用哪张：use = auto（有抠图用抠图）/ cut / orig */
  const pickKey = (a, use) => (!a ? null : use === "orig" ? a.key : a.cut || a.key);
  const ratioOf = (a, use) => {
    if (!a) return 0;
    if (use !== "orig" && a.cut && a.cutBox) return a.cutBox.w / a.cutBox.h;
    return a.w && a.h ? a.w / a.h : 1;
  };

  /** 参数表（当前语言，单位按设置换算） */
  ST.paramRows = (project, lang) => {
    const main = project.lang;
    const tr = (project.info.tr && project.info.tr[lang]) || {};
    const units = ST.unitsMode(project, lang);
    return (project.info.params || []).map((r, i) => ({ r, i })).filter(({ r }) => r.k || r.v).map(({ r, i }) => ({
      k: lang === main ? r.k : tr[`p${i}.k`] || r.k,
      v: ST.convertUnits(lang === main ? r.v : tr[`p${i}.v`] || r.v, units),
      missing: lang !== main && (!tr[`p${i}.k`] || !tr[`p${i}.v`]),
    }));
  };
  ST.dimLabels = (project, lang) => {
    const d = project.info.dims || {};
    const u = d.unit || "cm";
    const units = ST.unitsMode(project, lang);
    const f = (v) => (v ? ST.convertUnits(`${v}${u}`, units).replace(/(\d)(cm|mm|m)\b/, "$1 $2") : "");
    return { w: f(d.w), h: f(d.h), l: f(d.l) };
  };

  function layoutScreen(project, screen, o) {
    const tpl = ST.TPL[screen.tpl];
    if (!tpl) throw new Error("没有这个模板：" + screen.tpl);
    const lang = o.lang || project.lang;
    const main = project.lang;
    const T = ST.theme(project, o.brand);
    const issues = [];
    const missing = new Set();
    const items = screen.items || [];
    const pf = o.platform;
    const land = !!pf.h;
    const c = {
      W: 1000, H: land ? (1000 * pf.h) / pf.w : 0, land, T, lang, screen, project,
      blend: !!(screen.bg && screen.bg.blend && screen.bg.key),
      logo: o.brand && o.brand.logo ? o.brand.logo : "",
      t: (key) => { const r = ST.tr(screen.text && screen.text[key], lang, main); if (r.missing) missing.add(key); return r.text; },
      it: (i, f) => { const r = ST.tr(items[i] && items[i][f], lang, main); if (r.missing) missing.add(`item${i}.${f}`); return r.text; },
      items,
      item: (i) => (items[i] && items[i].asset) || "",
      slot: (k) => (screen.slots && screen.slots[k]) || "",
      ratio: (id, use = "auto") => ratioOf(ST.assetOf(project, id), use),
      params: () => { const rows = ST.paramRows(project, lang); if (rows.some((r) => r.missing)) missing.add("params"); return rows; },
      dims: () => ST.dimLabels(project, lang),
    };
    const out = tpl.layout(c);
    const H = out.h;
    // 手动调整（拖动、缩放、隐藏、改颜色）
    const ov = screen.ov || {};
    const layers = [];
    for (const l0 of out.layers) {
      const l = { ...l0 };
      const v = l.id && ov[l.id];
      if (v) {
        if (v.hidden) continue;
        const dx = v.dx || 0, dy = v.dy || 0, s = v.s || 1;
        if (l.t === "circle") { l.cx += dx; l.cy += dy; }
        else if (l.t === "icon") { l.x += dx - (l.s * (s - 1)) / 2; l.y += dy - (l.s * (s - 1)) / 2; l.s *= s; }
        else if (l.x !== undefined) {
          l.x += dx - (l.w * (s - 1)) / 2; l.y += dy - (l.h * (s - 1)) / 2; l.w *= s; l.h *= s;
          if (l.t === "text") { l.size *= s; l.min *= s; }
        }
        if (v.color && l.t === "text") l.color = v.color;
        if (v.text !== undefined && l.t === "text") l.text = v.text;
        l.locked = !!v.locked;
      }
      layers.push(l);
    }
    // 从右往左的语言：整屏左右镜像（图片本身不翻）
    if (ST.lang(lang).rtl) {
      for (const l of layers) {
        if (l.t === "circle") l.cx = 1000 - l.cx;
        else if (l.t === "icon") l.x = 1000 - l.x - l.s;
        else if (l.pts) l.pts = l.pts.map(([x, y]) => [1000 - x, y]);
        else if (l.x !== undefined) l.x = 1000 - l.x - l.w;
        if (l.t === "text") l.align = l.align === "left" ? "right" : l.align === "right" ? "left" : l.align;
        if (l.t === "img" && l.align === "left") l.align = "right";
        if (l.grad && l.dir === "h") l.grad = [...l.grad].reverse();
      }
    }
    missing.forEach((id) => issues.push({ type: "untranslated", id, msg: "还没有翻译，暂时显示主语言" }));
    return { tpl, c, H, layers, issues, T, lang };
  }

  function roundRect(g, x, y, w, h, r) {
    r = Math.min(r || 0, w / 2, h / 2);
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r);
    else { g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  }

  ST.renderScreen = async (project, screen, o = {}) => {
    const pf = o.platform;
    const L = layoutScreen(project, screen, o);
    const { layers, T, lang, tpl } = L;
    const H = L.c.land ? L.c.H : L.H;
    const Wpx = Math.round(o.pxWidth || pf.w * (o.scale || 1));
    const k = Wpx / 1000;
    const Hpx = Math.round(L.c.land && !o.pxWidth ? pf.h * (o.scale || 1) : H * k);
    const canvas = ST.canvas(Wpx, Hpx);
    const g = canvas.getContext("2d");
    g.imageSmoothingQuality = "high";
    const issues = [...L.issues];
    const boxes = [];
    const rtl = !!ST.lang(lang).rtl;

    // 背景
    const bg = screen.bg || {};
    const bgColor = bg.color || T[tpl.bgColor === "white" ? "card" : tpl.bgColor] || "#ffffff";
    g.fillStyle = bgColor;
    g.fillRect(0, 0, Wpx, Hpx);
    let bgImg = bg.mode !== "color" && bg.key ? await ST.imgOf(bg.key) : null;
    // 融入背景（B 方式）：“底图” = 背景 + 产品（连同产品下面的色块、线），交给 AI 调光影。
    // 用的时候整张当背景画，底图里的层就不再画了；产品挪过、换过图、换过背景（sig 对不上）就自动退回原贴图
    const H0 = H;
    const base = bgImg && !bg.blend ? harmBase(layers) : new Set();
    const sig = base.size ? harmSig(project, bg, shadow0(screen), base, H0, L.c.land) : "";
    const hm = screen.harm || {};
    const harmImg = base.size && o.only !== "base" && o.harm !== false && hm.on && hm.key && hm.sig === sig ? await ST.imgOf(hm.key) : null;
    if (harmImg) bgImg = harmImg;
    if (bgImg) {
      const iw = bgImg.naturalWidth, ih = bgImg.naturalHeight;
      const s = Math.max(Wpx / iw, Hpx / ih);
      const dw = iw * s, dh = ih * s;
      if (o.forExport && s > 1.15) {
        const off = ST.canvas(Wpx, Hpx);
        const og = off.getContext("2d", { willReadFrequently: true });
        og.imageSmoothingQuality = "high";
        og.drawImage(bgImg, (Wpx - dw) / 2, (Hpx - dh) / 2, dw, dh);
        ST.sharpen(og, Wpx, Hpx, 0.35);
        g.drawImage(off, 0, 0);
      } else g.drawImage(bgImg, (Wpx - dw) / 2, (Hpx - dh) / 2, dw, dh);
    } else if (bg.mode === "ai" || bg.mode === "upload") {
      issues.push({ type: "nobg", msg: bg.mode === "ai" ? "背景还没生成" : "还没上传背景图" });
    }

    // 先把字体加载好
    const fontOf = (l, px) => ST.fontFor(lang, l.role, T.head, l.weight, px);
    await ST.ensureFonts(layers.filter((l) => l.t === "text" && l.text).map((l) => ({ font: fontOf(l, 40), text: String(l.text) })));
    // 预读图片
    const imgs = new Map();
    await Promise.all(layers.filter((l) => l.t === "img").map(async (l) => {
      const a = l.asset ? ST.assetOf(project, l.asset) : null;
      const key = l.key || pickKey(a, l.use);
      const img = key ? await ST.imgOf(key) : null;
      const useCut = !l.key && a && l.use !== "orig" && !!a.cut;
      imgs.set(l, { img, a, cut: useCut, box: useCut && a.cutBox ? a.cutBox : null });
    }));
    const byId = new Map(layers.filter((l) => l.id).map((l) => [l.id, l]));
    const shadow = shadow0(screen);
    const productBoxes = [];

    for (const l of layers) {
      if (o.only === "base" && !base.has(l)) continue;
      if (harmImg && base.has(l)) {
        if (l.t === "img" && l.id) {
          boxes.push({ id: l.id, t: "img", x: l.x, y: l.y, w: l.w, h: l.h, locked: l.locked, asset: l.asset || "" });
          if (l.shadow) productBoxes.push({ x: l.x, y: l.y, w: l.w, h: l.h });
        }
        continue;
      }
      g.save();
      if (l.t === "rect") {
        roundRect(g, l.x * k, l.y * k, l.w * k, l.h * k, (l.r || 0) * k);
        if (l.grad) {
          const gr = l.dir === "h" ? g.createLinearGradient(l.x * k, 0, (l.x + l.w) * k, 0) : g.createLinearGradient(0, l.y * k, 0, (l.y + l.h) * k);
          gr.addColorStop(0, l.grad[0]); gr.addColorStop(1, l.grad[1]);
          g.fillStyle = gr; g.fill();
        } else if (l.fill) {
          if (l.shadow) { g.shadowColor = `rgba(0,0,0,${l.shadow})`; g.shadowBlur = 24 * k; g.shadowOffsetY = 6 * k; }
          g.fillStyle = l.fill; g.fill();
        }
        if (l.stroke) { g.shadowColor = "transparent"; g.strokeStyle = l.stroke; g.lineWidth = (l.sw || 1) * k; g.stroke(); }
      } else if (l.t === "circle") {
        g.beginPath(); g.arc(l.cx * k, l.cy * k, l.r * k, 0, Math.PI * 2);
        if (l.fill) { g.fillStyle = l.fill; g.fill(); }
        if (l.stroke) { g.strokeStyle = l.stroke; g.lineWidth = (l.sw || 1) * k; g.stroke(); }
        if (l.id) boxes.push({ id: l.id, t: "handle", x: l.cx - l.r - 8, y: l.cy - l.r - 8, w: 2 * l.r + 16, h: 2 * l.r + 16, locked: l.locked });
      } else if (l.t === "icon") {
        ST.drawIcon(g, l.name, l.x * k, l.y * k, l.s * k, l.color);
        if (l.id) boxes.push({ id: l.id, t: "icon", x: l.x, y: l.y, w: l.s, h: l.s, locked: l.locked });
      } else if (l.t === "line") {
        let pts = l.pts;
        if (l.link) {
          const A = byId.get(l.link[0]), B = byId.get(l.link[1]);
          if (A && B) {
            const ax = A.x + A.w / 2, ay = A.y + A.h / 2, bx = B.cx, by = B.cy;
            const d = Math.hypot(bx - ax, by - ay) || 1, r = A.w / 2;
            pts = [[ax + ((bx - ax) * r) / d, ay + ((by - ay) * r) / d], [bx, by]];
          } else pts = null;
        }
        if (pts) {
          g.strokeStyle = l.color; g.lineWidth = (l.w || 2) * k;
          g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k))); g.stroke();
          if (l.arrows && pts.length === 2) {
            for (const [p, q] of [[pts[0], pts[1]], [pts[1], pts[0]]]) {
              const a = Math.atan2(q[1] - p[1], q[0] - p[0]);
              const e = 10 * k;
              g.beginPath();
              g.moveTo(p[0] * k + e * Math.cos(a + 0.5), p[1] * k + e * Math.sin(a + 0.5));
              g.lineTo(p[0] * k, p[1] * k);
              g.lineTo(p[0] * k + e * Math.cos(a - 0.5), p[1] * k + e * Math.sin(a - 0.5));
              g.stroke();
              // 端头小竖线
              g.beginPath();
              g.moveTo(p[0] * k + e * Math.cos(a + Math.PI / 2), p[1] * k + e * Math.sin(a + Math.PI / 2));
              g.lineTo(p[0] * k - e * Math.cos(a + Math.PI / 2), p[1] * k - e * Math.sin(a + Math.PI / 2));
              g.stroke();
            }
          }
        }
      } else if (l.t === "img") {
        const info = imgs.get(l);
        const x = l.x * k, y = l.y * k, w = l.w * k, h = l.h * k;
        if (!info || !info.img) {
          if (!o.forExport || !l.key) {
            roundRect(g, x, y, w, h, (l.r || 12) * k);
            g.fillStyle = "rgba(127,127,127,0.08)"; g.fill();
            g.setLineDash([8 * k, 6 * k]); g.strokeStyle = "rgba(127,127,127,0.5)"; g.lineWidth = 2 * k; g.stroke();
            g.setLineDash([]);
            g.fillStyle = "rgba(100,100,100,0.75)";
            g.font = ST.fontFor("zh-CN", "body", "sans", 400, Math.max(12, Math.min(28, w / 8 / k)) * k);
            g.textAlign = "center"; g.textBaseline = "middle";
            g.fillText("放图片", x + w / 2, y + h / 2);
          }
          if (!l.key) issues.push({ type: "noimg", id: l.id, msg: "这里还没放图片" });
        } else {
          const { img, box } = info;
          const sx = box ? box.x : 0, sy = box ? box.y : 0, sw = box ? box.w : img.naturalWidth, sh = box ? box.h : img.naturalHeight;
          if (l.circle || l.r) {
            g.save();
            if (l.circle) { g.beginPath(); g.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2); }
            else roundRect(g, x, y, w, h, l.r * k);
            g.clip();
          }
          if (l.fit === "cover") {
            const s = Math.max(w / sw, h / sh);
            const cw = w / s, ch = h / s;
            g.drawImage(img, sx + (sw - cw) / 2, sy + (sh - ch) / 2, cw, ch, x, y, w, h);
          } else {
            const s = Math.min(w / sw, h / sh);
            const dw = sw * s, dh = sh * s;
            const dx = l.align === "left" ? x : l.align === "right" ? x + w - dw : x + (w - dw) / 2;
            const dy = l.align === "bottom" ? y + h - dh : y + (h - dh) / 2;
            if (l.shadow && info.cut && shadow.dir !== "none") {
              const op = shadow.op ?? 0.35;
              // 接触投影：产品底下一团淡淡的影子
              const gr = g.createRadialGradient(dx + dw / 2, dy + dh, 1, dx + dw / 2, dy + dh, dw * 0.45);
              gr.addColorStop(0, `rgba(0,0,0,${op * 0.55})`); gr.addColorStop(1, "rgba(0,0,0,0)");
              g.save(); g.translate(dx + dw / 2, dy + dh); g.scale(1, 0.12); g.translate(-(dx + dw / 2), -(dy + dh));
              g.fillStyle = gr; g.beginPath(); g.arc(dx + dw / 2, dy + dh, dw * 0.45, 0, Math.PI * 2); g.fill(); g.restore();
              // 投射阴影
              const ox = shadow.dir === "bl" ? -18 : shadow.dir === "br" ? 18 : 0;
              g.shadowColor = `rgba(0,0,0,${op * 0.6})`;
              g.shadowBlur = 28 * k; g.shadowOffsetX = ox * k * (rtl ? -1 : 1); g.shadowOffsetY = 14 * k;
            }
            g.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
            if (l.shadow) productBoxes.push({ x: dx / k, y: dy / k, w: dw / k, h: dh / k });
          }
          if (l.circle || l.r) g.restore();
          if (l.border) {
            g.beginPath();
            if (l.circle) g.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2); else roundRect(g, x, y, w, h, (l.r || 0) * k);
            g.strokeStyle = l.border; g.lineWidth = (l.bw || 4) * k; g.stroke();
          }
        }
        if (l.id) boxes.push({ id: l.id, t: "img", x: l.x, y: l.y, w: l.w, h: l.h, locked: l.locked, asset: l.asset || "" });
      } else if (l.t === "text") {
        const text = String(l.text ?? "");
        if (text.trim()) {
          g.direction = rtl ? "rtl" : "ltr";
          const fit = ST.fitText(g, text, { w: l.w * k, h: l.h * k, size: l.size * k, min: l.min * k, lines: l.lines, lh: l.lh, lang, font: (px) => fontOf(l, px) });
          g.font = fontOf(l, fit.size);
          g.fillStyle = l.color;
          g.textBaseline = "middle";
          g.textAlign = l.align === "left" ? "left" : l.align === "right" ? "right" : "center";
          if (rtl) g.textAlign = l.align === "left" ? "left" : l.align === "right" ? "right" : "center";
          const lineH = fit.size * fit.lh;
          const total = fit.lines.length * lineH;
          let y0 = l.y * k + (l.valign === "middle" ? (l.h * k - total) / 2 : l.valign === "bottom" ? l.h * k - total : 0);
          const tx = l.align === "left" ? l.x * k : l.align === "right" ? (l.x + l.w) * k : (l.x + l.w / 2) * k;
          fit.lines.forEach((line, i) => g.fillText(line, tx, y0 + lineH * (i + 0.5)));
          if (fit.overflow) issues.push({ type: "overflow", id: l.id, msg: "文字太长，放不下（已截断）" });
          else if (fit.shrink < 0.72) issues.push({ type: "shrink", id: l.id, msg: `文字已缩到 ${Math.round(fit.shrink * 100)}%，建议检查` });
        }
        if (l.id) boxes.push({ id: l.id, t: "text", x: l.x, y: l.y, w: l.w, h: l.h, locked: l.locked });
      }
      g.restore();
    }
    // 文字和产品重叠
    for (const b of boxes.filter((b) => b.t === "text")) {
      const l = byId.get(b.id);
      if (!l || !String(l.text || "").trim()) continue;
      for (const p of productBoxes) {
        const ix = Math.max(0, Math.min(b.x + b.w, p.x + p.w) - Math.max(b.x, p.x));
        const iy = Math.max(0, Math.min(b.y + b.h, p.y + p.h) - Math.max(b.y, p.y));
        if ((ix * iy) / (b.w * b.h) > 0.25) { issues.push({ type: "overlap", id: b.id, msg: "文字和产品图重叠" }); break; }
      }
    }
    return { canvas, H, k, boxes, issues, harm: { can: base.size > 0, sig, used: !!harmImg, box: productBoxes[productBoxes.length - 1] || null, stale: !!(base.size && hm.key && hm.sig !== sig) } };
  };

  const shadow0 = (screen) => screen.shadow || { dir: "b", op: 0.35 };
  /** 底图包含的层：最后一个带投影的产品图（主图）以及它前面的所有非文字、非图标层；没有主产品图就是空的 */
  function harmBase(layers) {
    let last = -1;
    layers.forEach((l, i) => { if (l.t === "img" && l.shadow && l.asset) last = i; });
    return new Set(layers.slice(0, last + 1).filter((l) => l.t !== "text" && l.t !== "icon"));
  }
  const hash = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0; return h.toString(36); };
  const r1 = (v) => (typeof v === "number" ? Math.round(v * 10) / 10 : v ?? "");
  function harmSig(project, bg, shadow, base, H, land) {
    const ls = [...base].map((l) => [l.t, r1(l.x), r1(l.y), r1(l.w), r1(l.h), r1(l.cx), r1(l.cy), r1(l.r), l.asset || "", l.key || "", l.use || "", l.fit || "", l.align || "", !!l.shadow, l.fill || "", String(l.grad || ""), l.asset ? (ST.assetOf(project, l.asset) || {}).cut || "" : ""]);
    return hash(JSON.stringify([bg.mode, bg.key, bg.color || "", r1(H), !!land, shadow.dir, r1(shadow.op), ls]));
  }
})();
