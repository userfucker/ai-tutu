/**
 * 详情页 · 产品融入背景（B 方式，Lee 2026-10-23）
 *
 * 程序先把产品贴到背景上（就是平常看到的那张），再交给 AI 只调光影：加接触阴影、投影、反光，让光线颜色和背景一致。
 * 产品本身不许变。做完先用程序比一比产品那块（挪了、变形了差别会很大），再让会看图的 AI 对比一次；
 * 变样了就重做一次（要求更保守），还变样就放弃，继续用原贴图。原贴图一直保留，可以随时切换（screen.harm.on）。
 *
 * 网页和服务器（全自动）共用。ai = { image(prompt, images, label, n), json(prompt, images, label, n) }，images = [{ blob, name }]
 */
var ST = globalThis.ST || (globalThis.ST = {});
(() => {
  // 产品那块每个像素平均差多少算“变样了”（0～255）：形状纹理差（去掉整体变亮变暗、偏色以后）超过 42，或者颜色直接差超过 70
  const SHAPE_LIMIT = 42, COLOR_LIMIT = 70;

  /** 这一屏融入的状态：{ can（能不能融入）, used（现在显示的是融入后的）, stale（产品挪过，融入的图作废了） } */
  ST.harmState = async (p, sc) => {
    if (!sc || !sc.bg || !sc.bg.key || sc.bg.mode === "color" || sc.bg.blend) return { can: false };
    const r = await ST.renderScreen(p, sc, { platform: ST.platformOf(p, p.platform), lang: p.lang, pxWidth: 120 });
    return r.harm;
  };

  /** 图片铺满 w×h（比例不一样就居中裁掉一点，和画背景一样） */
  async function fit(blob, w, h) {
    const img = await ST.blobToImage(blob);
    const c = ST.canvas(w, h);
    const g = c.getContext("2d");
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const s = Math.max(w / iw, h / ih);
    g.imageSmoothingQuality = "high";
    g.drawImage(img, (w - iw * s) / 2, (h - ih * s) / 2, iw * s, ih * s);
    return c;
  }
  /** 产品那块缩成 48×48 比较。shape：先各自减掉平均色（允许整体变亮、变暗、偏暖）再算平均差；color：直接算平均差 */
  ST.regionDiff = (a, b, box) => {
    const N = 48;
    const px = (cv) => {
      const c = ST.canvas(N, N);
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(cv, box.x, box.y, box.w, box.h, 0, 0, N, N);
      const d = g.getImageData(0, 0, N, N).data;
      const m = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) m[k] += d[i + k];
      return { d, m: m.map((v) => v / (N * N)) };
    };
    const A = px(a), B = px(b);
    let shape = 0, color = 0;
    for (let i = 0; i < A.d.length; i += 4) for (let k = 0; k < 3; k++) { shape += Math.abs(A.d[i + k] - A.m[k] - (B.d[i + k] - B.m[k])); color += Math.abs(A.d[i + k] - B.d[i + k]); }
    return { shape: shape / (N * N * 3), color: color / (N * N * 3) };
  };

  /** 融入一屏。成功：sc.harm = { key, sig, on: true, status: "ok" }；放弃：{ on: false, status: "fallback", note: 原因 } */
  ST.harmonize = async (p, sc, ai) => {
    const pf = ST.platformOf(p, p.platform);
    const r = await ST.renderScreen(p, sc, { platform: pf, lang: p.lang, pxWidth: 1000, only: "base" });
    if (!r.harm.can) return { ok: false, skip: true, why: "这一屏没有背景图或产品图" };
    const W = r.canvas.width, H = r.canvas.height;
    const baseBlob = await ST.toBlob(r.canvas, "image/jpeg", 0.92);
    const ratio = closestAiRatio(W, H);
    const k = r.k;
    const b = r.harm.box;
    const box = b ? { x: Math.max(0, b.x * k), y: Math.max(0, b.y * k), w: Math.max(4, Math.min(W - b.x * k, b.w * k)), h: Math.max(4, Math.min(H - b.y * k, b.h * k)) } : null;
    const no = p.screens.indexOf(sc) + 1;
    let why = "";
    for (let n = 0; n < 2; n++) {
      const out = await ai.image(ST.P.harmonize(p, ratio, n > 0), [{ blob: baseBlob, name: "原图.jpg" }], `融入背景：第 ${no} 屏${n ? "（重做）" : ""}`, n);
      const cv = await fit(out, W, H);
      const diff = box ? ST.regionDiff(r.canvas, cv, box) : { shape: 0, color: 0 };
      if (diff.shape > SHAPE_LIMIT || diff.color > COLOR_LIMIT) { why = `产品那块变化太大（形状 ${Math.round(diff.shape)}，颜色 ${Math.round(diff.color)}）`; continue; }
      const blob = await ST.toBlob(cv, "image/jpeg", 0.92);
      let note = "";
      try {
        const chk = await ai.json(ST.P.sameProduct(p), [{ blob: baseBlob, name: "原图.jpg" }, { blob, name: "调整后.jpg" }], `检查产品有没有变样：第 ${no} 屏${n ? "（重做）" : ""}`, n);
        if (chk && (chk.same === false || chk.same === "false")) { why = `AI 检查：${String(chk.why || "产品变样了").slice(0, 40)}`; continue; }
      } catch (e) {
        if (e && (e.stopped || /已停止/.test(e.message || ""))) throw e;
        note = `AI 检查没做成（${String((e && e.message) || e).slice(0, 30)}），程序比过产品那块，没问题`;
      }
      const key = `${p.id}:harm-${sc.id}-${Date.now()}`;
      await ST.saveImage(key, blob);
      const old = sc.harm && sc.harm.key;
      if (old && old !== key) { ST.forget && ST.forget(old); ST.db.delBlob(old); }
      sc.harm = { key, sig: r.harm.sig, on: true, status: "ok", note, t: Date.now() };
      return { ok: true, note };
    }
    const prev = sc.harm || {};
    if (prev.key && prev.sig === r.harm.sig && prev.status === "ok") sc.harm = { ...prev, note: `这次没成功（${why}），还用上一次融入的图` };
    else {
      if (prev.key) { ST.forget && ST.forget(prev.key); ST.db.delBlob(prev.key); }
      sc.harm = { key: "", sig: r.harm.sig, on: false, status: "fallback", note: why + "；用原贴图", t: Date.now() };
    }
    return { ok: false, why };
  };
})();
