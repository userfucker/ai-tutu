/**
 * 详情页 · 产品融入背景（B 方式，Lee 2026-10-23）
 *
 * 程序先把产品贴到背景上（就是平常看到的那张），再交给 AI 只调光影：加接触阴影、投影、反光，让光线颜色和背景一致。
 * 产品本身不许变。做完直接用 AI 图；原贴图一直留着，随时可以切换（screen.harm.on）。想让 AI 帮着判断，点“AI 审核”（默认豆包）比一比哪张好。
 *
 * 网页和服务器（全自动）共用。ai = { image(prompt, images, label, n), json(prompt, images, label, n) }，images = [{ blob, name }]
 */
var ST = globalThis.ST || (globalThis.ST = {});
(() => {
  // 产品那块每个像素平均差（0～255）大到这个程度，基本是产品画没了 / 换了东西（只在审核没做成时用来兜底）
  const GROSS_SHAPE = 60, GROSS_COLOR = 90;

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

  /**
   * 融入一张贴好产品的图（详情页的一屏、主图都用它）。canvas = 程序贴好的图（原贴图），box = 产品在图上的位置（像素）。
   * AI 调光影画一次（不重做），默认直接用 AI 图；o.judge = true 时再让审核 AI 比一比原贴图和 AI 图哪张好（平时不自动审核，点“AI 审核”才做）。
   * 返回 { ok: true, blob（AI 图）, choice: "ai" | "orig", why（审核理由）, note }
   */
  ST.harmonizeCanvas = async (p, canvas, b, ai, what, o = {}) => {
    const W = canvas.width, H = canvas.height;
    const baseBlob = await ST.toBlob(canvas, "image/jpeg", 0.92);
    const ratio = closestAiRatio(W, H);
    const out = await ai.image(ST.P.harmonize(p, ratio), [{ blob: baseBlob, name: "原图.jpg" }], `融入背景：${what}`, 0);
    const cv = await fit(out, W, H);
    const blob = await ST.toBlob(cv, "image/jpeg", 0.92);
    if (!o.judge) return { ok: true, blob, choice: "ai", why: "", note: "" }; // 不自动审核（Lee 2026-10-24）：直接用 AI 图，要审核点“AI 审核”
    const box = b ? { x: Math.max(0, b.x), y: Math.max(0, b.y), w: Math.max(4, Math.min(W - Math.max(0, b.x), b.w)), h: Math.max(4, Math.min(H - Math.max(0, b.y), b.h)) } : null;
    const diff = box ? ST.regionDiff(canvas, cv, box) : { shape: 0, color: 0 };
    return { ok: true, blob, ...(await ST.pickBetter(p, baseBlob, blob, ai, what, diff.shape > GROSS_SHAPE || diff.color > GROSS_COLOR)) };
  };
  /** 审核：原贴图和 AI 图哪张好 → { choice: "ai" | "orig", why, note }。审核没做成默认 AI 图（gross = 程序看产品那块几乎全变了，就默认原贴图） */
  ST.pickBetter = async (p, baseBlob, aiBlob, ai, what, gross) => {
    try {
      const r = await ai.json(ST.P.pickBetter(p), [{ blob: baseBlob, name: "1-原贴图.jpg" }, { blob: aiBlob, name: "2-AI图.jpg" }], `审核融入的图：${what}`, 0);
      const better = String(r && (r.better ?? r.pick ?? "")).replace(/\D/g, "");
      if (better === "1" || better === "2") return { choice: better === "1" ? "orig" : "ai", why: String((r && r.why) || "").slice(0, 200), note: "" };
      throw new Error("审核回复里没有选 1 还是 2");
    } catch (e) {
      if (e && (e.stopped || /已停止/.test(e.message || ""))) throw e;
      const msg = String((e && e.message) || e).slice(0, 80);
      return gross ? { choice: "orig", why: "", note: `审核没做成（${msg}）；程序看产品那块变化很大，先用原贴图` } : { choice: "ai", why: "", note: `审核没做成（${msg}），还用 AI 图` };
    }
  };
  /** 详情页一屏：点“AI 审核”时用（原贴图现画，AI 图是 sc.harm.key） */
  ST.judgeScreen = async (p, sc, ai) => {
    const hm = sc.harm || {};
    if (!hm.key) throw new Error("这一屏还没融入");
    const r = await ST.renderScreen(p, sc, { platform: ST.platformOf(p, p.platform), lang: p.lang, pxWidth: 1000, only: "base" });
    const res = await ST.pickBetter(p, await ST.toBlob(r.canvas, "image/jpeg", 0.92), await ST.db.getBlob(hm.key), ai, `第 ${p.screens.indexOf(sc) + 1} 屏`);
    sc.harm = { ...hm, on: res.choice === "ai", choice: res.choice, why: res.why, note: res.note };
    return res;
  };

  /** 审核结果写成一句话（网页上显示） */
  ST.harmText = (hm) => {
    if (!hm || !hm.key) return hm && hm.note ? hm.note : "";
    const pick = hm.choice ? `审核选了${hm.choice === "ai" ? " AI 图" : "原贴图"}${hm.why ? "：" + hm.why : ""}` : "";
    return [pick, hm.note].filter(Boolean).join("；");
  };

  /** 融入一屏：sc.harm = { key（AI 图）, sig, on（true = 用 AI 图）, choice, why（审核理由）, note } */
  ST.harmonize = async (p, sc, ai) => {
    const pf = ST.platformOf(p, p.platform);
    const r = await ST.renderScreen(p, sc, { platform: pf, lang: p.lang, pxWidth: 1000, only: "base" });
    if (!r.harm.can) return { ok: false, skip: true, why: "这一屏没有背景图或产品图" };
    const k = r.k;
    const b = r.harm.box;
    const res = await ST.harmonizeCanvas(p, r.canvas, b ? { x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k } : null, ai, `第 ${p.screens.indexOf(sc) + 1} 屏`);
    const key = `${p.id}:harm-${sc.id}-${Date.now()}`;
    await ST.saveImage(key, res.blob);
    const old = sc.harm && sc.harm.key;
    if (old && old !== key) { ST.forget && ST.forget(old); ST.db.delBlob(old); }
    sc.harm = { key, sig: r.harm.sig, on: res.choice === "ai", status: "ok", choice: res.choice, why: res.why, note: res.note, t: Date.now() };
    return { ok: true, choice: res.choice, why: res.why, note: res.note };
  };
})();
