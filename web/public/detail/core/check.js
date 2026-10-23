/**
 * 详情页工作室 · 检查：违禁词、文字放不下 / 缩太小、文字压住产品、缺图、缺背景、没翻译。
 */
var ST = globalThis.ST || (globalThis.ST = {});

/** 一段文字里找违禁词。lists = 词表 id 列表；custom = 自己加的词（每行一个） */
ST.findBanned = (text, lang, lists, custom = []) => {
  const out = [];
  if (!text) return out;
  for (const id of lists) {
    const L = ST.BANNED[id];
    if (!L || !(L.langs.includes("*") || L.langs.includes(lang))) continue;
    for (const [w, tip] of L.words) {
      const hit = w instanceof RegExp ? w.exec(text) : text.includes(w) ? [w] : null;
      if (hit) out.push({ word: hit[0], tip, list: L.name });
    }
  }
  for (const w of custom) if (w && text.toLowerCase().includes(w.toLowerCase())) out.push({ word: w, tip: "你自己加的违禁词", list: "自定义" });
  return out;
};

/** 一屏、一种语言里所有的文字：[{ id, text }] */
ST.screenTexts = (project, sc, lang) => {
  const out = [];
  const m = project.lang;
  for (const [k, v] of Object.entries(sc.text || {})) { const t = ST.tr(v, lang, m).text; if (t) out.push({ id: k, text: t }); }
  (sc.items || []).forEach((it, i) => ["title", "desc"].forEach((f) => { const t = ST.tr(it[f], lang, m).text; if (t) out.push({ id: `item${i}.${f}`, text: t }); }));
  if (sc.tpl === "params") ST.paramRows(project, lang).forEach((r, i) => { out.push({ id: `param${i}.k`, text: r.k }); out.push({ id: `param${i}.v`, text: r.v }); });
  return out;
};

/**
 * 检查整个项目。o = { langs, platforms, brand, custom, onProgress }
 * 返回 [{ pf, lang, si, id, type, msg }]
 */
ST.checkProject = async (project, o) => {
  const out = [];
  const total = o.platforms.length * o.langs.length * project.screens.length;
  let n = 0;
  for (const pid of o.platforms) {
    const pf = ST.platformOf(project, pid);
    for (const lang of o.langs) {
      for (let si = 0; si < project.screens.length; si++) {
        const sc = project.screens[si];
        const r = await ST.renderScreen(project, sc, { platform: pf, lang, brand: o.brand, pxWidth: 500 });
        const seen = new Set();
        for (const is of r.issues) {
          const k = is.type + "|" + (is.id || "");
          if (seen.has(k)) continue;
          seen.add(k);
          out.push({ pf: pid, lang, si, id: is.id || "", type: is.type, msg: is.msg });
        }
        for (const t of ST.screenTexts(project, sc, lang)) {
          for (const b of ST.findBanned(t.text, lang, pf.rules || [], o.custom)) {
            out.push({ pf: pid, lang, si, id: t.id, type: "banned", msg: `“${b.word}”：${b.tip}（${b.list}）`, text: t.text });
          }
        }
        n++;
        if (o.onProgress) o.onProgress(n, total);
      }
    }
  }
  return out;
};
ST.ISSUE_NAMES = { banned: "违禁词", overflow: "文字放不下", shrink: "文字缩得太小", overlap: "文字压住产品", noimg: "缺图片", nobg: "缺背景", untranslated: "没翻译", lowcontrast: "文字看不清" };
ST.ISSUE_LEVEL = { banned: "bad", overflow: "bad", noimg: "bad", nobg: "warn", shrink: "warn", overlap: "warn", untranslated: "warn", lowcontrast: "warn" };
