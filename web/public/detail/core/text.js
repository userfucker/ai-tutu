/**
 * 详情页工作室 · 文字排版：选字体、按语言分词换行、放不下自动缩小。
 * 泰语这类词之间没有空格的语言用浏览器自带的分词（Intl.Segmenter）；阿拉伯语从右往左写。
 */
var ST = globalThis.ST || (globalThis.ST = {});

(() => {
/** 字体字符串，例如 700 48px "Noto Sans SC", …；role = head（标题）/ body（正文） */
ST.fontFor = (langCode, role, headStyle, weight, px) => {
  const set = ST.FONTS[ST.lang(langCode).font] || ST.FONTS.latin;
  const fam = role === "head" && headStyle === "serif" ? set.serif : set.sans;
  const w = role === "head" && headStyle === "serif" ? 700 : weight;
  return `${w} ${Math.max(1, Math.round(px))}px ${fam}`;
};

/** 画之前先把要用到的字加载好（字体按字符分成很多小文件，用到哪些字才加载哪些） */
ST.ensureFonts = async (list) => {
  if (!document.fonts || !document.fonts.load) return;
  const seen = new Set();
  const jobs = [];
  for (const { font, text } of list) {
    const k = font + "|" + text;
    if (!text || seen.has(k)) continue;
    seen.add(k);
    jobs.push(document.fonts.load(font.replace(/\d+(\.\d+)?px/, "40px"), text).catch(() => {}));
  }
  await Promise.all(jobs);
};

const segCache = new Map();
function segmenter(lang, granularity) {
  const k = lang + granularity;
  if (!segCache.has(k)) {
    try { segCache.set(k, new Intl.Segmenter(lang, { granularity })); } catch { segCache.set(k, null); }
  }
  return segCache.get(k);
}
const splitWords = (text, lang) => {
  const s = segmenter(lang, "word");
  if (s) return [...s.segment(text)].map((x) => x.segment);
  return text.split(/(\s+)/).filter(Boolean);
};
const splitChars = (text, lang) => {
  const s = segmenter(lang, "grapheme");
  return s ? [...s.segment(text)].map((x) => x.segment) : [...text];
};
const NO_START = /^[，。！？、；：,.!?;:）)」』】》”’…%]/;

/** 按宽度换行；中日韩逐字、西文按单词、泰文按词 */
ST.breakLines = (g, text, maxW, lang) => {
  const out = [];
  const W = (s) => g.measureText(s).width;
  for (const para of String(text ?? "").split("\n")) {
    if (!para.trim()) { out.push(""); continue; }
    let line = "";
    const pushLong = (seg) => {
      for (const ch of splitChars(seg, lang)) {
        if (line && W(line + ch) > maxW) { out.push(line.trimEnd()); line = ch.trimStart(); }
        else line += ch;
      }
    };
    for (const seg of splitWords(para, lang)) {
      if (W(line + seg) <= maxW) { line += seg; continue; }
      if (!line.trim()) { line = ""; pushLong(seg); continue; }
      out.push(line.trimEnd());
      line = "";
      const s = seg.trimStart();
      if (W(s) > maxW) pushLong(s);
      else line = s;
    }
    if (line.trim()) out.push(line.trimEnd());
  }
  // 中文标点不放在行首
  for (let i = 1; i < out.length; i++) {
    while (out[i] && NO_START.test(out[i]) && out[i - 1]) { out[i - 1] += out[i][0]; out[i] = out[i].slice(1); }
  }
  return out.filter((l, i) => l !== "" || (i > 0 && i < out.length - 1));
};

/**
 * 在框里放文字：先按设定字号，放不下就一点点缩小，最小到 min。
 * o = { w, h, size, min, lines（最多几行）, lh（行高倍数）, lang, font(px) → 字体字符串 }
 * 返回 { size, lines, lh, overflow（最小字号也放不下）, shrink（缩到原来的多少） }
 */
ST.fitText = (g, text, o) => {
  const lh = o.lh || 1.3;
  const maxLines = o.lines || 99;
  let size = o.size;
  const min = Math.min(o.min || size * 0.55, size);
  let lines = [];
  for (let k = 0; k < 40; k++) {
    g.font = o.font(size);
    lines = ST.breakLines(g, text, o.w, o.lang);
    const tooWide = lines.some((l) => g.measureText(l).width > o.w + 0.5);
    if (lines.length <= maxLines && lines.length * size * lh <= o.h + size * 0.2 && !tooWide) {
      return { size, lines, lh, overflow: false, shrink: size / o.size };
    }
    if (size <= min) break;
    size = Math.max(min, size * 0.94);
  }
  g.font = o.font(size);
  const fit = Math.max(1, Math.min(maxLines, Math.floor((o.h + size * 0.2) / (size * lh))));
  if (lines.length > fit) {
    lines = lines.slice(0, fit);
    let last = lines[fit - 1];
    while (last && g.measureText(last + "…").width > o.w) last = last.slice(0, -1);
    lines[fit - 1] = last + "…";
  }
  return { size, lines, lh, overflow: true, shrink: size / o.size };
};
})();
