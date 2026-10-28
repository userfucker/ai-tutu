/**
 * 主图 · 合成（网页显示 / 下载、服务器融入都用这一份）
 *
 * 一张主图 it：
 *  - 先画背景再融入（it.mode 不是 "scene"）：背景 it.bg + 程序贴的产品（it.pos：中心 x、y 和大小 s，都是 0～1）= 原贴图；
 *    it.harm = { key（AI 调光影后的图）, sig, on（true = 用 AI 图）, choice, why, note }，产品挪过（sig 对不上）就退回原贴图。
 *  - AI 直接画场景（it.mode = "scene"）：it.scene 就是成品。
 */
var ST = globalThis.ST || (globalThis.ST = {});
(() => {
  const hash = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0; return h.toString(36); };
  ST.mainProduct = (p, id) => (p.products || []).find((x) => x.id === id) || (p.products || []).find((x) => x.id === p.cur) || (p.products || [])[0] || null;

  /** 返回 { canvas, box（产品在图上的位置，像素）, sig, used（用的是 AI 图）, stale（产品挪过，融入的图作废） } */
  ST.mainCompose = async (p, it, px, useHarm = true) => {
    const c = ST.canvas(px, px);
    const g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    const cover = (img) => { const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, s = Math.max(px / iw, px / ih); g.drawImage(img, (px - iw * s) / 2, (px - ih * s) / 2, iw * s, ih * s); };
    g.fillStyle = "#f2f2f2";
    g.fillRect(0, 0, px, px);
    if (it.mode === "scene" || it.mode === "poster" || it.mode === "tpl") {
      const sc = it.scene ? await ST.imgOf(it.scene) : null;
      if (sc) cover(sc);
      return { canvas: c, box: null, sig: "", used: !!sc, stale: false };
    }
    const pr = ST.mainProduct(p, it.product);
    const pos = it.pos || { x: 0.5, y: 0.53, s: 0.85 };
    const sig = hash(JSON.stringify([it.bg, pr ? pr.cut || pr.key : "", +pos.x.toFixed(3), +pos.y.toFixed(3), +pos.s.toFixed(3)]));
    const img = pr ? await ST.imgOf(pr.cut || pr.key) : null;
    const bx = pr && pr.cut && pr.cutBox ? pr.cutBox : img ? { x: 0, y: 0, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height } : null;
    let box = null;
    if (bx) {
      const max = pos.s * px, s = Math.min(max / bx.w, max / bx.h);
      const dw = bx.w * s, dh = bx.h * s;
      box = { x: pos.x * px - dw / 2, y: pos.y * px - dh / 2, w: dw, h: dh };
    }
    const hm = it.harm || {};
    const stale = !!(hm.key && hm.sig !== sig);
    if (useHarm && hm.on && hm.key && hm.sig === sig) {
      const h = await ST.imgOf(hm.key);
      if (h) { cover(h); return { canvas: c, box, sig, used: true, stale }; }
    }
    const bg = it.bg ? await ST.imgOf(it.bg) : null;
    if (bg) cover(bg);
    if (img && box) {
      const { x: dx, y: dy, w: dw, h: dh } = box;
      if (pr.cut) {
        // 接触投影 + 投射阴影（和详情页一样，让贴图不那么“飘”）
        const gr = g.createRadialGradient(dx + dw / 2, dy + dh, 1, dx + dw / 2, dy + dh, dw * 0.45);
        gr.addColorStop(0, "rgba(0,0,0,0.2)"); gr.addColorStop(1, "rgba(0,0,0,0)");
        g.save(); g.translate(dx + dw / 2, dy + dh); g.scale(1, 0.12); g.translate(-(dx + dw / 2), -(dy + dh));
        g.fillStyle = gr; g.beginPath(); g.arc(dx + dw / 2, dy + dh, dw * 0.45, 0, Math.PI * 2); g.fill(); g.restore();
        g.save(); g.shadowColor = "rgba(0,0,0,0.22)"; g.shadowBlur = px * 0.028; g.shadowOffsetY = px * 0.014;
      }
      g.drawImage(img, bx.x, bx.y, bx.w, bx.h, dx, dy, dw, dh);
      if (pr.cut) g.restore();
    }
    return { canvas: c, box, sig, used: false, stale };
  };

  /** 白底图：产品放中间，占 80% */
  ST.mainWhite = async (p, px) => {
    const pr = ST.mainProduct(p);
    const c = ST.canvas(px, px);
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, px, px);
    const img = pr && (await ST.imgOf(pr.cut || pr.key));
    if (img) {
      const bx = pr.cut && pr.cutBox ? pr.cutBox : { x: 0, y: 0, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
      const s = Math.min((px * 0.8) / bx.w, (px * 0.8) / bx.h);
      g.imageSmoothingQuality = "high";
      g.drawImage(img, bx.x, bx.y, bx.w, bx.h, (px - bx.w * s) / 2, (px - bx.h * s) / 2, bx.w * s, bx.h * s);
    }
    return c;
  };
})();
