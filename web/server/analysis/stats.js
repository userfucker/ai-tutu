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
  const sku = [...skuMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count, pct: pct(count, rates.length) }));
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
    qa: { total: (raw && raw.qa && raw.qa.total) || qas.length, analyzed: qaTag.size, topics: [...topicMap.values()].sort((a, b) => b.count - a.count).slice(0, 10) },
    manual: p.manual || null,
  };
}

/** 给 AI 写结论用的精简版（去掉引用原文，控制长度） */
export function compactForWriting(all) {
  return all.map((s) => ({
    key: s.key, role: s.role, title: s.title, price: s.price, sales: s.sales, 评价样本: s.analyzed,
    满意率: s.sentiment.posPct, 不满意率: s.sentiment.negPct,
    满意点: s.good.map((x) => `${x.name} ${x.pct}%`), 不满意点: s.bad.map((x) => `${x.name} ${x.pct}%`),
    用途需求: s.need.map((x) => `${x.name} ${x.pct}%`), 人群: s.who.map((x) => `${x.name} ${x.pct}%`),
    规格分布: s.sku.slice(0, 6).map((x) => `${x.name} ${x.pct}%`), 最近新增问题: s.recent.map((x) => `${x.name} 最近30天${x.recentPct}% 之前${x.beforePct}%`),
    问大家主题: s.qa.topics.map((x) => `${x.name} ${x.count}次${x.worry ? `（${x.worry}次是担心）` : ""}`),
    参数: s.params.map((x) => `${x.name}:${x.value}`).slice(0, 10), 规格: s.skuProps, 平台印象标签: s.platformTags.map((t) => `${t.title}${t.count ? "(" + t.count + ")" : ""}`),
    manual: s.manual || undefined,
  }));
}
