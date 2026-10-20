/**
 * 竞品分析报告：生成一个独立的 HTML 文件（样式都写在文件里，发给别人直接用浏览器打开）。
 */
import { esc, bj } from "../util.js";

const CSS = `
:root{--ink:#1b1f27;--sub:#5d6472;--mute:#8a909c;--line:#e3e6ec;--soft:#f5f6f8;--bg:#fafbfc;--accent:#2f5fd0;--good:#1f8a4c;--goodsoft:#e4f4ea;--bad:#c2362f;--badsoft:#fbe8e6;--warn:#a86400;--warnsoft:#fdf2df;--ours:#7a3fd1;--ourssoft:#f1e9fc}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.7 -apple-system,"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:32px 20px 80px}
h1{font-size:28px;line-height:1.3;margin:0 0 6px}
h2{font-size:21px;margin:44px 0 14px;padding-top:12px;border-top:2px solid var(--ink)}
h3{font-size:16px;margin:22px 0 8px}
.meta{color:var(--mute);font-size:13px}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:12px 0}
.summary{font-size:16px;background:#fff;border-left:4px solid var(--accent);padding:14px 18px;border-radius:0 10px 10px 0}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{border-bottom:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
th{background:var(--soft);font-weight:600;color:var(--sub);font-size:13px}
.scroll{overflow-x:auto}
.tag{display:inline-block;font-size:12px;padding:1px 8px;border-radius:6px;background:var(--soft);color:var(--sub);margin:2px 4px 2px 0;white-space:nowrap}
.tag.ours{background:var(--ourssoft);color:var(--ours);font-weight:600}
.tag.good{background:var(--goodsoft);color:var(--good)}
.tag.bad{background:var(--badsoft);color:var(--bad)}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
@media(max-width:760px){.grid{grid-template-columns:minmax(0,1fr)}}
.bars{display:flex;flex-direction:column;gap:6px}
.bar{display:grid;grid-template-columns:minmax(0,9em) minmax(0,1fr) 4.5em;gap:8px;align-items:center;font-size:13.5px}
.bar .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar .b{height:10px;border-radius:5px;background:var(--soft);overflow:hidden}
.bar .b i{display:block;height:100%;border-radius:5px}
.bar .n{text-align:right;color:var(--sub);font-variant-numeric:tabular-nums}
.good .b i{background:var(--good)}.bad .b i{background:var(--bad)}.neu .b i{background:var(--accent)}
details{margin:2px 0 6px 0}
details summary{cursor:pointer;color:var(--accent);font-size:12.5px}
.q{font-size:13px;color:var(--sub);background:var(--soft);border-radius:8px;padding:6px 10px;margin:4px 0}
.q small{color:var(--mute)}
.sent{display:flex;height:14px;border-radius:7px;overflow:hidden;background:var(--soft);margin:6px 0}
.sent i{display:block;height:100%}
.list li{margin:4px 0}
.pain{border-left:3px solid var(--bad);padding:8px 12px;background:#fff;border-radius:0 8px 8px 0;margin:8px 0}
.pain b{display:block}
.pain .op{color:var(--good)}
.head{display:flex;gap:14px;align-items:flex-start}
.head img{width:84px;height:84px;object-fit:cover;border-radius:10px;border:1px solid var(--line);flex:none}
.note{font-size:13px;color:var(--sub);background:var(--soft);border-radius:10px;padding:10px 14px}
a{color:var(--accent)}
@media print{body{background:#fff}.card{break-inside:avoid}}
`;

const bars = (list, cls, max = 10) => list && list.length
  ? `<div class="bars">${list.slice(0, max).map((x) => `<div class="bar ${cls}"><span class="t" title="${esc(x.name)}">${esc(x.name)}</span><span class="b"><i style="width:${Math.min(100, x.pct)}%"></i></span><span class="n">${x.pct}%</span></div>
    ${x.quotes && x.quotes.length ? `<details><summary>看评价原话（${x.count} 条提到）</summary>${x.quotes.map((q) => `<div class="q">${esc(q.text)} <small>${esc(q.date || "")} ${esc(q.sku || "")}</small></div>`).join("")}</details>` : ""}`).join("")}</div>`
  : '<div class="meta">没有</div>';
const ul = (list) => (list && list.length ? `<ul class="list">${list.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : '<div class="meta">没有</div>');
const roleTag = (s) => (s.role === "ours" ? '<span class="tag ours">我们</span>' : '<span class="tag">竞品</span>');
const shortTitle = (s) => esc((s.title || s.url || s.key).slice(0, 36));

export function renderReport(an, stats, w) {
  const names = Object.fromEntries(stats.map((s) => [s.key, s]));
  const w2 = w || {};
  const prodBlock = (s) => {
    const wp = (w2.products || []).find((x) => x.key === s.key) || {};
    const sent = s.sentiment;
    if (s.manual && !s.analyzed) {
      const m = s.manual;
      return `<div class="card"><h3>${roleTag(s)} ${esc(m.name || "我们的产品")}（没有评价数据，按我们填写的信息）</h3>
        <table>${[["价格", m.price], ["卖点", m.points], ["参数", m.params], ["说明", m.notes]].filter(([, v]) => v).map(([k, v]) => `<tr><th style="width:7em">${k}</th><td>${esc(v)}</td></tr>`).join("")}</table></div>`;
    }
    return `<div class="card">
      <div class="head">${s.image ? `<img src="${esc(s.image)}" alt="">` : ""}<div><h3 style="margin-top:0">${roleTag(s)} ${esc(s.title)}</h3>
      <div class="meta">${esc(s.shop)} · ${esc(s.price || "价格未知")} · ${esc(s.sales ? "销量 " + s.sales : "")} · 平台评价 ${esc(s.rateTotal || "?")} · 采到 ${s.collected} 条，分析 ${s.analyzed} 条${s.period ? `（${bj(s.period.from).slice(0, 10)} ～ ${bj(s.period.to).slice(0, 10)}）` : ""} ${s.url ? `· <a href="${esc(s.url)}" target="_blank" rel="noopener">商品链接</a>` : ""}</div>
      ${wp.positioning ? `<div style="margin-top:6px"><b>定位：</b>${esc(wp.positioning)}</div>` : ""}</div></div>
      <div class="sent" title="满意 ${sent.posPct}% / 一般 ${sent.neuPct}% / 不满意 ${sent.negPct}%"><i style="width:${sent.posPct}%;background:var(--good)"></i><i style="width:${sent.neuPct}%;background:#c9ced8"></i><i style="width:${sent.negPct}%;background:var(--bad)"></i></div>
      <div class="meta">满意 ${sent.posPct}% · 一般 ${sent.neuPct}% · 不满意 ${sent.negPct}%</div>
      ${wp.strengths || wp.weaknesses ? `<div class="grid" style="margin-top:8px"><div><b>优势</b>${ul(wp.strengths)}</div><div><b>短板</b>${ul(wp.weaknesses)}</div></div>` : ""}
      <div class="grid" style="margin-top:10px"><div><h3>买家满意的地方</h3>${bars(s.good, "good")}</div><div><h3>买家不满意的地方</h3>${bars(s.bad, "bad")}</div></div>
      <div class="grid"><div><h3>用途和需求</h3>${bars(s.need, "neu", 8)}</div><div><h3>买家身份</h3>${bars(s.who, "neu", 8)}</div></div>
      ${s.recent.length ? `<h3>最近 30 天冒出来的问题</h3>${s.recent.map((x) => `<span class="tag bad">${esc(x.name)}：最近 ${x.recentPct}%，之前 ${x.beforePct}%</span>`).join("")}` : ""}
      <div class="grid"><div><h3>评价里的规格分布</h3>${bars(s.sku.map((x) => ({ ...x, quotes: [] })), "neu", 8)}</div>
      <div><h3>问大家（${esc(s.qa.total || 0)} 个问题，分析 ${s.qa.analyzed} 个）</h3>${s.qa.topics.length ? s.qa.topics.map((t) => `<div class="bar neu"><span class="t">${esc(t.name)}${t.worry ? " ⚠" : ""}</span><span class="b"><i style="width:${Math.min(100, (t.count / (s.qa.topics[0].count || 1)) * 100)}%"></i></span><span class="n">${t.count} 次</span></div>`).join("") : '<div class="meta">没有</div>'}</div></div>
      ${s.platformTags.length ? `<h3>淘宝的印象标签</h3>${s.platformTags.map((t) => `<span class="tag">${esc(t.title)}${t.count ? " " + esc(t.count) : ""}</span>`).join("")}` : ""}
    </div>`;
  };
  const ov = stats.filter((s) => s.analyzed || s.manual);
  const sug = w2.suggestions || {};
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(an.name)} · 竞品分析报告</title><style>${CSS}</style></head><body><div class="wrap">
<h1>${esc(an.name)}</h1>
<div class="meta">竞品分析报告 · 生成于 ${bj(Date.now())}（北京时间）· ${stats.length} 个商品 · 每个商品按时间从新到旧最多采 ${an.options.rates} 条评价</div>
${w2.summary ? `<h2>总体结论</h2><div class="summary">${esc(w2.summary)}</div>` : ""}
<h2>对比总览</h2>
<div class="scroll"><table><thead><tr><th>商品</th><th>价格</th><th>销量</th><th>分析评价</th><th>满意率</th><th>最多人满意</th><th>最多人不满意</th></tr></thead><tbody>
${ov.map((s) => `<tr><td>${roleTag(s)}${shortTitle(s)}</td><td>${esc(s.price || (s.manual && s.manual.price) || "")}</td><td>${esc(s.sales || "")}</td><td>${s.analyzed || "—"}</td><td>${s.analyzed ? s.sentiment.posPct + "%" : "—"}</td>
<td>${s.good.slice(0, 3).map((x) => `<span class="tag good">${esc(x.name)} ${x.pct}%</span>`).join("")}</td><td>${s.bad.slice(0, 3).map((x) => `<span class="tag bad">${esc(x.name)} ${x.pct}%</span>`).join("")}</td></tr>`).join("")}
</tbody></table></div>
${w2.needs && w2.needs.length ? `<h2>买家的核心需求</h2>${ul(w2.needs)}` : ""}
${w2.pains && w2.pains.length ? `<h2>共性痛点和我们的机会</h2>${w2.pains.map((p) => `<div class="pain"><b>${esc(p.point)}</b><div class="meta">${esc(p.evidence || "")}</div>${p.opportunity ? `<div class="op">机会：${esc(p.opportunity)}</div>` : ""}</div>`).join("")}` : ""}
${w2.compare ? `<h2>我们 vs 竞品</h2><div class="grid"><div class="card"><h3 style="margin-top:0;color:var(--good)">我们更好的地方</h3>${ul(w2.compare.better)}</div><div class="card"><h3 style="margin-top:0;color:var(--bad)">我们不如竞品的地方</h3>${ul(w2.compare.worse)}</div></div>
<div class="card"><h3 style="margin-top:0">竞品买家在抱怨、我们可以解决的</h3>${ul(w2.compare.gaps)}</div>` : ""}
${w2.suggestions ? `<h2>优化建议</h2><div class="grid">
<div class="card"><h3 style="margin-top:0">产品改进</h3>${ul(sug.product)}</div><div class="card"><h3 style="margin-top:0">详情页和主图</h3>${ul(sug.detail)}</div>
<div class="card"><h3 style="margin-top:0">建议主打的卖点</h3>${ul(sug.points)}</div><div class="card"><h3 style="margin-top:0">详情页里要提前回答的问题</h3>${ul(sug.faq)}</div>
<div class="card"><h3 style="margin-top:0">价格和规格</h3>${ul(sug.price)}</div><div class="card"><h3 style="margin-top:0">要注意的风险</h3>${ul(w2.risks)}</div></div>` : ""}
<h2>每个商品的详细情况</h2>
${stats.map(prodBlock).join("")}
<h2>说明</h2>
<div class="note">
<p>· 评价按时间从新到旧采集，每个商品最多 ${an.options.rates} 条；淘宝折叠的评价、默认好评、空评价不计入。报告是样本统计，不是全部评价。</p>
<p>· 每条评价由 AI 打标签（满意点、不满意点、用途、人群），意思相近的标签再由 AI 合并；百分比 = 提到这一点的评价条数 ÷ 分析的评价条数，由程序统计。</p>
<p>· 结论和建议由 AI 根据统计数据写成，请结合评价原话核对后再用。</p>
${stats.filter((s) => s.analyzed === 0 && !s.manual).map((s) => `<p>· ${esc(names[s.key] ? shortTitle(s) : s.key)}：没有拿到可分析的评价。</p>`).join("")}
</div>
</div></body></html>`;
}
