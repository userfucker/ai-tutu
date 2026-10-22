/**
 * 竞品分析：程序统计（数字全由程序算，AI 只负责给每条评价打标签、合并同义标签、写结论）。
 */
import { parseDate } from "../util.js";

const EMPTY_RE = /^(此用户没有填写评价|系统默认好评|该用户觉得商品较好|用户未及时评价|默认好评|无|好评)[。.！!]?$/;

/** 能拿来分析的评价：去掉默认好评、空评价 */
export function usableRates(raw) {
  const list = (raw && raw.rates && raw.rates.list) || [];
  return list.map((r, idx) => ({ ...r, idx, text: [r.content, r.appendContent ? `追评：${r.appendContent}` : ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() }))
    .filter((r) => r.text && !EMPTY_RE.test(r.content.trim()));
}
export function usableQa(raw) {
  return ((raw && raw.qa && raw.qa.list) || []).filter((q) => q.title).map((q, idx) => ({ ...q, idx }));
}

/** 一批评价 → 材料（#编号 [规格] 内容） */
export function rateMaterial(batch) {
  return batch.map((r, n) => `#${n + 1} ${r.sku ? `[${r.sku.replace(/\s+/g, " ").slice(0, 30)}] ` : ""}${r.text.slice(0, 400)}`).join("\n");
}
export function qaMaterial(batch) {
  return batch.map((q, n) => `#${n + 1} ${q.title.slice(0, 120)} ｜ ${(q.answers || []).map((a) => a.content).filter(Boolean).slice(0, 2).join(" / ").slice(0, 160)}`).join("\n");
}

const pct = (n, total) => (total ? Math.round((n / total) * 1000) / 10 : 0);

function topCats(entries, total, vocab, maxN, rates) {
  // entries: [{ rateIdx, tags: [...] }]
  const map = new Map(); // 归类 → { count, rates:Set, raw: Map }
  for (const e of entries) {
    const seen = new Set();
    for (const t0 of e.tags || []) {
      const t = String(t0 || "").trim();
      if (!t) continue;
      const cat = (vocab && vocab[t]) || t;
      if (seen.has(cat)) continue;
      seen.add(cat);
      if (!map.has(cat)) map.set(cat, { name: cat, count: 0, ids: [] });
      const m = map.get(cat);
      m.count++;
      m.ids.push(e.rateIdx);
    }
  }
  const byIdx = new Map((rates || []).map((r) => [r.idx, r]));
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, maxN).map((m) => {
    // 引用：挑长度适中的 3 条
    const quotes = m.ids.map((i) => byIdx.get(i)).filter(Boolean)
      .sort((a, b) => Math.abs(a.text.length - 60) - Math.abs(b.text.length - 60)).slice(0, 3)
      .map((r) => ({ text: r.text.slice(0, 160), date: r.date, sku: r.sku }));
    return { name: m.name, count: m.count, pct: pct(m.count, total), quotes };
  });
}

/**
 * 一个商品的统计。tags = { rates: [{idx, s, good, bad, need, who}], qa: [{idx, topic, worry}] }
 */
export function productStats(p, raw, tags, vocab) {
  const item = (raw && raw.item) || {};
  const rates = usableRates(raw);
  const tagBy = new Map((tags.rates || []).map((t) => [t.idx, t]));
  const tagged = rates.filter((r) => tagBy.has(r.idx));
  const n = tagged.length;
  const sent = { pos: 0, neu: 0, neg: 0 };
  for (const r of tagged) { const s = Number(tagBy.get(r.idx).s); if (s > 0) sent.pos++; else if (s < 0) sent.neg++; else sent.neu++; }
  const ent = (f) => tagged.map((r) => ({ rateIdx: r.idx, tags: tagBy.get(r.idx)[f] || [] }));
  // 规格分布（评价里的 sku 字段）
  const skuMap = new Map();
  for (const r of rates) { const k = (r.sku || "").replace(/\s+/g, " ").trim(); if (k) skuMap.set(k, (skuMap.get(k) || 0) + 1); }
  const sku = [...skuMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count, pct: pct(count, rates.length), price: skuPrice(raw && raw.item, name) }));
  // 时间范围、最近 30 天的问题
  const dates = rates.map((r) => parseDate(r.date)).filter(Boolean).sort((a, b) => a - b);
  const latest = dates.length ? dates[dates.length - 1] : 0;
  const cut = latest - 30 * 86400000;
  const recentRates = tagged.filter((r) => parseDate(r.date) >= cut);
  const olderRates = tagged.filter((r) => { const d = parseDate(r.date); return d && d < cut; });
  const badShare = (list) => {
    const m = new Map();
    for (const r of list) for (const t of new Set((tagBy.get(r.idx).bad || []).map((x) => (vocab.bad && vocab.bad[x]) || x))) m.set(t, (m.get(t) || 0) + 1);
    return m;
  };
  const rb = badShare(recentRates), ob = badShare(olderRates);
  const recent = recentRates.length >= 10 && olderRates.length >= 10
    ? [...rb.entries()].map(([name, c]) => ({ name, recentPct: pct(c, recentRates.length), beforePct: pct(ob.get(name) || 0, olderRates.length) }))
      .filter((x) => x.recentPct >= 5 && x.recentPct >= x.beforePct * 1.8 + 2).sort((a, b) => b.recentPct - a.recentPct).slice(0, 5)
    : [];
  // 问大家
  const qas = usableQa(raw);
  const qaTag = new Map((tags.qa || []).map((t) => [t.idx, t]));
  const topicMap = new Map();
  for (const q of qas) {
    const t = qaTag.get(q.idx);
    if (!t || !t.topic) continue;
    const name = (vocab.qa && vocab.qa[t.topic]) || t.topic;
    if (!topicMap.has(name)) topicMap.set(name, { name, count: 0, worry: 0, samples: [] });
    const m = topicMap.get(name);
    m.count++;
    if (t.worry) m.worry++;
    if (m.samples.length < 2) m.samples.push(q.title.slice(0, 80));
  }
  const prices = (item.skus || []).map((s) => parseFloat(String(s.price).replace(/[^\d.]/g, ""))).filter((x) => x > 0);
  return {
    key: p.key, role: p.role, url: p.url || "", title: item.title || p.title || "", shop: item.shopName || "",
    price: prices.length ? (Math.min(...prices) === Math.max(...prices) ? `¥${Math.min(...prices)}` : `¥${Math.min(...prices)}～${Math.max(...prices)}`) : "",
    sales: item.sellCount || "", rateTotal: item.rateTotal || (raw && raw.rates && raw.rates.counts && raw.rates.counts.all) || "",
    params: (item.params || []).slice(0, 16), skuProps: (item.skuProps || []).map((x) => `${x.name}：${x.values.map((v) => v.name).slice(0, 12).join("、")}`),
    platformTags: ((raw && raw.rates && raw.rates.tags) || item.rateKeywords || []).slice(0, 12),
    image: (item.mainImages || [])[0] || "",
    collected: (raw && raw.rates && raw.rates.list || []).length, analyzed: n,
    period: dates.length ? { from: dates[0], to: latest } : null,
    sentiment: { ...sent, posPct: pct(sent.pos, n), neuPct: pct(sent.neu, n), negPct: pct(sent.neg, n) },
    good: topCats(ent("good"), n, vocab.good, 12, rates),
    bad: topCats(ent("bad"), n, vocab.bad, 12, rates),
    need: topCats(ent("need"), n, vocab.need, 8, rates),
    who: topCats(ent("who"), n, vocab.who, 8, rates),
    sku, recent,
    qa: { total: (raw && raw.qa && raw.qa.total) || qas.length, analyzed: qaTag.size, topics: [...topicMap.values()].sort((a, b) => b.count - a.count).slice(0, 10), answers: answerStats(qas, qaTag) },
    manual: p.manual || null,
    ...extras(raw, rates, tagBy, n, sku),
  };
}

// ------------------------------------------------------------ 报告 2.0 新增的统计（Lee 2026-10-22）
const REBUY_RE = /第[二三四五六七八九十2-9]次|回购|又买|再次购买|再买|之前买过|一直在?买|老顾客|买了好几次|无限回购|复购/;
const dayKey = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
/**
 * 标题拆词结果（AI 切的 words）→ 程序统计：产品词 / 修饰词去重、标题里重复出现的词、覆盖范围 = 产品词数 × 修饰词数、产品词最早出现的位置。
 * AI 切的词连起来要和标题对得上（容许一点出入），对不上就标出来。
 */
export function titleWords(title, ai) {
  const words = (ai && Array.isArray(ai.words) ? ai.words : []).map((x) => ({ w: String(x.w || "").trim(), t: x.t === "core" ? "core" : "mod" })).filter((x) => x.w);
  if (!words.length) return null;
  const uniq = (t) => [...new Set(words.filter((x) => x.t === t).map((x) => x.w))];
  const core = uniq("core"), mod = uniq("mod");
  const count = new Map();
  for (const x of words) count.set(x.w, (count.get(x.w) || 0) + 1);
  const repeats = [...count.entries()].filter(([, n]) => n > 1).map(([w, n]) => ({ w, n }));
  const clean = (s) => String(s || "").replace(/\s+/g, "");
  const joined = clean(words.map((x) => x.w).join(""));
  const chars = [...clean(title)];
  let firstCore = -1;
  if (core.length) { const t = clean(title); const idx = Math.min(...core.map((c) => { const k = t.indexOf(c); return k < 0 ? Infinity : [...t.slice(0, k)].length; })); firstCore = idx === Infinity ? -1 : idx; }
  return { words, core, mod, repeats, coverage: core.length * mod.length, firstCore, matches: joined === clean(title), titleChars: chars.length };
}

/** 淘宝标题字数：汉字算 2，字母数字算 1，上限 60（30 个汉字） */
export const titleLen = (t) => [...String(t || "")].reduce((a, ch) => a + (/[\u0000-\u00ff]/.test(ch) ? 1 : 2), 0);
function answerStats(qas, qaTag) {
  const c = { none: 0, good: 0, dodge: 0, bad: 0 };
  const bad = [];
  for (const q of qas) {
    const t = qaTag.get(q.idx);
    const a = t && c[t.a] !== undefined ? t.a : (q.answers || []).some((x) => x.content) ? null : "none";
    if (a) c[a]++;
    if (a === "dodge" || a === "bad") bad.push({ q: q.title.slice(0, 80), a: ((q.answers || [])[0] || {}).content ? String(q.answers[0].content).slice(0, 80) : "", type: a });
  }
  return { ...c, judged: c.none + c.good + c.dodge + c.bad, samples: bad.slice(0, 6) };
}
function extras(raw, rates, tagBy, n, sku) {
  const item = (raw && raw.item) || {};
  // 极端负评、复购、追评
  const quote = (r) => ({ text: r.text.slice(0, 160), date: r.date, sku: r.sku });
  const extreme = rates.filter((r) => tagBy.get(r.idx) && tagBy.get(r.idx).x);
  const rebuy = rates.filter((r) => (tagBy.get(r.idx) && tagBy.get(r.idx).rb) || REBUY_RE.test(r.text));
  const appendList = rates.filter((r) => r.appendContent).map((r) => ({ date: r.date, sku: r.sku, content: String(r.content || "").slice(0, 120), append: String(r.appendContent).slice(0, 160), dir: (tagBy.get(r.idx) || {}).ap || "" }));
  const rebuyPct = pct(rebuy.length, n || rates.length);
  // 评价时间分布（用采到的全部评价，包括默认好评：都是成交）
  const all = ((raw && raw.rates && raw.rates.list) || []).map((r) => parseDate(r.date)).filter(Boolean).sort((a, b) => a - b);
  // 去掉零星几条特别早的评价（离后面超过 30 天、加起来不到 5%），不然时间跨度会被拉得很长
  let oldDropped = 0;
  while (all.length > 2 && all[1] - all[0] > 30 * 86400000 && oldDropped + 1 <= Math.max(1, all.length * 0.05)) { all.shift(); oldDropped++; }
  let time = null;
  if (all.length >= 2) {
    const byDay = new Map();
    for (const t of all) byDay.set(dayKey(t), (byDay.get(dayKey(t)) || 0) + 1);
    const first = Math.min(...all), last = Math.max(...all);
    const days = [];
    for (let t = Date.parse(dayKey(first) + "T00:00:00Z"); t <= Date.parse(dayKey(last) + "T00:00:00Z"); t += 86400000) { const k = new Date(t).toISOString().slice(0, 10); days.push({ d: k, n: byDay.get(k) || 0 }); }
    days.forEach((x, i) => { const w = days.slice(Math.max(0, i - 6), i + 1); x.ma = Math.round((w.reduce((a, y) => a + y.n, 0) / w.length) * 10) / 10; });
    const mean = all.length / days.length;
    const sd = Math.sqrt(days.reduce((a, x) => a + (x.n - mean) ** 2, 0) / days.length);
    const peaks = days.filter((x) => x.n >= 3 && x.n > mean + 2 * sd).sort((a, b) => b.n - a.n).slice(0, 5).map((x) => x.d);
    const avg = Math.round(mean * 100) / 100;
    time = {
      from: days[0].d, to: days[days.length - 1].d, totalDays: days.length, withRates: days.filter((x) => x.n).length, without: days.filter((x) => !x.n).length,
      total: all.length, avg, days: days.slice(-180), peaks, oldDropped,
      sales: { dailyMin: Math.round(avg * 5 * 10) / 10, dailyMax: Math.round(avg * 10 * 10) / 10, totalMin: Math.round(all.length * 5), totalMax: Math.round(all.length * 10) },
    };
  }
  // 规格：主推（占比最高）+ 按属性（颜色、尺码……）汇总
  const props = new Map();
  for (const r of rates) for (const part of String(r.sku || "").split(/[;；]/)) {
    const m = /^\s*([^:：]+)[:：]\s*(.+?)\s*$/.exec(part);
    if (!m) continue;
    if (!props.has(m[1])) props.set(m[1], new Map());
    const pm = props.get(m[1]);
    pm.set(m[2], (pm.get(m[2]) || 0) + 1);
  }
  const skuProps2 = [...props.entries()].map(([name, mp]) => ({ name, values: [...mp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([v, c]) => ({ name: v, count: c, pct: pct(c, rates.length) })) }));
  return {
    extreme: { count: extreme.length, pct: pct(extreme.length, n || rates.length), quotes: extreme.slice(0, 8).map(quote) },
    rebuy: { count: rebuy.length, pct: rebuyPct, level: rebuyPct >= 5 ? "强" : rebuyPct >= 2 ? "中" : rebuy.length ? "弱" : "没有", quotes: rebuy.slice(0, 6).map(quote) },
    appends: { count: appendList.length, up: appendList.filter((x) => x.dir === "up").length, down: appendList.filter((x) => x.dir === "down").length, list: appendList.slice(0, 40) },
    time,
    topSku: sku && sku[0] ? sku[0].name : "",
    skuByProp: skuProps2,
    titleInfo: { text: item.title || "", len: titleLen(item.title), max: 60 },
    mainImages: (item.mainImages || []).slice(0, 8),
    skuList: (item.skus || []).slice(0, 40).map((x) => ({ name: x.name, price: x.price })),
  };
}

/** 评价里的规格（如“颜色分类:白色;容量:500ml”）对应商品规格表里的价格：规格值都对得上才算 */
function skuPrice(item, rateSku) {
  const vals = String(rateSku || "").split(/[;；]/).map((x) => x.split(/[:：]/).pop().trim()).filter(Boolean);
  if (!vals.length || !item || !Array.isArray(item.skus)) return "";
  const norm = (x) => String(x).replace(/\s+/g, "");
  const hit = item.skus.find((k) => { const parts = String(k.name || "").split(" / ").map(norm); return vals.every((v) => parts.includes(norm(v))); })
    || item.skus.find((k) => vals.every((v) => norm(k.name || "").includes(norm(v))))
    // 评价里的规格名比商品规格表里的长（多了说明文字）：规格表里每一项都出现在评价的规格里就算
    || item.skus.find((k) => { const parts = String(k.name || "").split(/\s*\/\s*|\s+/).map(norm).filter(Boolean); return parts.length && parts.every((x) => norm(rateSku).includes(x)); });
  const p = hit && String(hit.price || "").trim();
  return p ? (/^[\d.]+/.test(p) ? "¥" + p : p) : "";
}

/** 给 AI 写结论用的精简版（去掉引用原文，控制长度） */
export function compactForWriting(all) {
  return all.map((s) => ({
    key: s.key, role: s.role, title: s.title, price: s.price, sales: s.sales, 评价样本: s.analyzed,
    满意率: s.sentiment.posPct, 不满意率: s.sentiment.negPct,
    满意点: s.good.map((x) => `${x.name} ${x.pct}%`), 不满意点: s.bad.map((x) => `${x.name} ${x.pct}%`),
    用途需求: s.need.map((x) => `${x.name} ${x.pct}%`), 人群: s.who.map((x) => `${x.name} ${x.pct}%`),
    规格分布: s.sku.slice(0, 6).map((x) => `${x.name}${x.price ? `（${x.price}）` : ""} ${x.pct}%`), 最近新增问题: s.recent.map((x) => `${x.name} 最近30天${x.recentPct}% 之前${x.beforePct}%`),
    问大家主题: s.qa.topics.map((x) => `${x.name} ${x.count}次${x.worry ? `（${x.worry}次是担心）` : ""}`),
    参数: s.params.map((x) => `${x.name}:${x.value}`).slice(0, 10), 规格: s.skuProps, 平台印象标签: s.platformTags.map((t) => `${t.title}${t.count ? "(" + t.count + ")" : ""}`),
    manual: s.manual || undefined,
    极端差评: s.extreme ? `${s.extreme.pct}%` : undefined, 回购信号: s.rebuy ? `${s.rebuy.pct}%（${s.rebuy.level}）` : undefined,
    追评: s.appends ? `${s.appends.count} 条，变好 ${s.appends.up}，变差 ${s.appends.down}` : undefined,
    评价时间: s.time ? `${s.time.from}～${s.time.to} 共 ${s.time.totalDays} 天，日均 ${s.time.avg} 条` : undefined,
    问大家回答: s.qa && s.qa.answers ? `没回答 ${s.qa.answers.none}，正面回答 ${s.qa.answers.good}，回避 ${s.qa.answers.dodge}，透露负面 ${s.qa.answers.bad}` : undefined,
    标题: s.title ? `${s.titleInfo ? s.titleInfo.len : ""}/60 字符：${s.titleInfo ? s.titleInfo.text : ""}` : undefined,
    标题分析: s.titleAI ? (() => { const tw = titleWords(s.title, s.titleAI); return { 产品词: tw && tw.core, 修饰词数: tw && tw.mod.length, 覆盖范围: tw && tw.coverage, 重复词: tw && tw.repeats.map((x) => x.w), 问题: s.titleAI.orderIssues }; })() : undefined,
    主图: s.mainAI ? { 首图: s.mainAI.firstType, 文字卖点: s.mainAI.textPoints, 点击率潜力: s.mainAI.ctr, 缺点: s.mainAI.cons } : undefined,
    详情页: s.desc ? { 卖点: s.desc.selling, 结构: (s.desc.structure || []).slice(0, 15), 宣传: s.desc.claims, 承诺: s.desc.promises, 参数: (s.desc.params || []).slice(0, 12), 人群: s.desc.audience, 场景: s.desc.scenes, 风格: s.desc.style } : undefined,
  }));
}
