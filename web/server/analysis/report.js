/**
 * 竞品分析报告：生成一个独立的 HTML 文件（样式都写在文件里，发给别人直接用浏览器打开）。
 */
import { esc, bj } from "../util.js";
import { titleWords } from "./stats.js";

const CSS = `
:root{--ink:#1b1f27;--sub:#5d6472;--mute:#8a909c;--line:#e3e6ec;--soft:#f5f6f8;--bg:#fafbfc;--accent:#2f5fd0;--good:#1f8a4c;--goodsoft:#e4f4ea;--bad:#c2362f;--badsoft:#fbe8e6;--warn:#a86400;--warnsoft:#fdf2df;--ours:#7a3fd1;--ourssoft:#f1e9fc}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.7 -apple-system,"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif}
.wrap{margin:0;padding:28px 32px 28px}
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
.sku{display:grid;grid-template-columns:minmax(0,1fr) 5.5em minmax(60px,30%) 4em;gap:8px;align-items:center;font-size:13.5px;padding:3px 0;border-bottom:1px dashed var(--line)}
.sku .p{color:var(--ink);font-variant-numeric:tabular-nums;text-align:right}
.sku .b{height:10px;border-radius:5px;background:var(--soft);overflow:hidden}.sku .b i{display:block;height:100%;border-radius:5px;background:var(--accent)}
.sku .n{text-align:right;color:var(--sub);font-variant-numeric:tabular-nums}
.desc li{margin:3px 0}
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

/** 规格分布：规格名完整显示（可以换行），后面是价格 */
const skuBars = (list) => (list && list.length
  ? list.slice(0, 10).map((x) => `<div class="sku"><span>${esc(x.name)}</span><span class="p">${esc(x.price || "")}</span><span class="b"><i style="width:${Math.min(100, x.pct)}%"></i></span><span class="n">${x.pct}%</span></div>`).join("")
  : '<div class="meta">没有</div>');
/** 每个商品的详情页（AI 从详情图里读出来的） */
const descBlock = (d) => (d ? `<h3>详情页讲了什么（AI 读详情图，${d.images || "?"} 张${d.cut ? "，太长只读了前面一部分" : ""}）</h3>
  <div class="grid"><div><b>主打卖点</b>${ul(d.selling)}</div><div><b>具体的宣传</b>${ul(d.claims)}${d.promises && d.promises.length ? `<b>售后和保障</b>${ul(d.promises)}` : ""}</div></div>
  ${[["人群", d.audience], ["场景", d.scenes], ["风格", d.style]].filter(([, v]) => v).map(([k, v]) => `<div class="meta"><b>${k}：</b>${esc(v)}</div>`).join("")}
  ${d.structure && d.structure.length ? `<details><summary>详情页一屏一屏的结构（${d.structure.length} 屏）</summary><ul class="list desc">${d.structure.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>` : ""}` : "");
/** 详情页和评价对照 */
const detailSection = (d, names) => {
  if (!d || (!(d.products || []).length && !(d.ours || []).length)) return "";
  const nm = (k) => { const s = names[k]; return s ? `${s.role === "ours" ? '<span class="tag ours">我们</span>' : '<span class="tag">竞品</span>'}${esc((s.title || k).slice(0, 36))}` : esc(k); };
  return `<h2>详情页 vs 评价</h2>
  ${(d.products || []).map((p) => `<div class="card"><h3 style="margin-top:0">${nm(p.key)}</h3><div class="grid">
    <div><b style="color:var(--good)">详情页主打、买家也认可</b>${ul(p.accepted)}</div><div><b style="color:var(--bad)">详情页说了、评价里有人说不符</b>${ul(p.doubted)}</div></div>
    <b>买家在意、详情页没讲</b>${ul(p.missing)}</div>`).join("")}
  ${(d.ours || []).length ? `<div class="card"><h3 style="margin-top:0">我们的详情页怎么改</h3>${ul(d.ours)}</div>` : ""}`;
};

// ------------------------------------------------------------ 报告 2.0（Lee 2026-10-22）：模块可勾选，对比都左右并列（我们固定第一列）
const MOD_NAMES = { summary: "总体结论", overview: "对比总览", title: "标题分析", main: "主图分析", attr: "产品属性对比", time: "评价时间分布与销量估算", rates: "买家评价分析", sku: "规格分布", qa: "问大家", desc: "详情页分析", advice: "优化建议" };
const nameOf = (s) => `${roleTag(s)}<b>${shortTitle(s)}</b>`;
/** 左右并列：每个商品一列，超出屏幕左右滑动 */
const cols = (list, fn) => `<div class="cols" style="--n:${list.length}">${list.map((s) => `<div class="colx"><div class="colh">${nameOf(s)}</div>${fn(s)}</div>`).join("")}</div>`;
const kv = (rows) => `<table class="kv">${rows.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table>`;
const chips = (list, cls = "") => (list && list.length ? list.map((x) => `<span class="tag ${cls}">${esc(x)}</span>`).join("") : '<span class="meta">没有</span>');
const quotes = (list, label) => (list && list.length ? `<details><summary>${label}（${list.length} 条）</summary>${list.map((q) => `<div class="q">${esc(q.text)} <small>${esc(q.date || "")} ${esc(q.sku || "")}</small></div>`).join("")}</details>` : "");

/** 每天评价数折线 + 7 日平均 + 峰值标记（SVG，不用外部库） */
function timeChart(t) {
  const d = t.days || [];
  if (d.length < 2) return "";
  const W = 640, H = 200, pl = 34, pb = 26, pt = 10, pr = 8;
  const max = Math.max(1, ...d.map((x) => x.n));
  const X = (i) => pl + (i / (d.length - 1)) * (W - pl - pr), Y = (v) => pt + (1 - v / max) * (H - pt - pb);
  const line = (k) => d.map((x, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(x[k]).toFixed(1)}`).join("");
  const ticks = [0, Math.round(max / 2), max];
  const lab = [0, Math.floor((d.length - 1) / 2), d.length - 1];
  const peaks = new Set(t.peaks || []);
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="每天评价数">
    ${ticks.map((v) => `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e3e6ec"/><text x="${pl - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`).join("")}
    <path d="${line("n")}" fill="none" stroke="#9db4ea" stroke-width="1.5"/>
    <path d="${line("ma")}" fill="none" stroke="#2f5fd0" stroke-width="2.4"/>
    ${d.map((x, i) => (peaks.has(x.d) ? `<circle cx="${X(i)}" cy="${Y(x.n)}" r="4" fill="#c2362f"><title>${x.d}：${x.n} 条</title></circle>` : "")).join("")}
    ${lab.map((i) => `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${d[i].d.slice(5)}</text>`).join("")}
  </svg><div class="meta"><span style="color:#9db4ea">━</span> 每天评价数 <span style="color:#2f5fd0">━</span> 7 日平均 <span style="color:#c2362f">●</span> 异常高峰（可能是促销 / 活动）</div>`;
}

export function renderReport(an, stats0, w, extra = {}) {
  const stats = [...stats0].sort((a, b) => (a.role === "ours" ? -1 : 0) - (b.role === "ours" ? -1 : 0));
  const names = Object.fromEntries(stats.map((s) => [s.key, s]));
  const w2 = w || {};
  const mods = an.options.mods || Object.keys(MOD_NAMES);
  const on = (k) => mods.includes(k);
  const withRates = stats.filter((s) => s.analyzed || s.manual);
  const ours = stats.find((s) => s.role === "ours");
  const out = [];
  const sec = (k, html) => { if (on(k) && html) out.push(`<h2 id="m-${k}">${MOD_NAMES[k]}</h2>${html}`); };

  // 1 总体结论
  sec("summary", (w2.summary || (w2.needs || []).length || (w2.pains || []).length) ? `${w2.summary ? `<div class="summary">${esc(w2.summary)}</div>` : ""}
    ${w2.needs && w2.needs.length ? `<h3>买家的核心需求</h3>${ul(w2.needs)}` : ""}
    ${w2.pains && w2.pains.length ? `<h3>共性痛点和我们的机会</h3>${w2.pains.map((p) => `<div class="pain"><b>${esc(p.point)}</b><div class="meta">数据：${esc(p.evidence || "")}</div>${p.opportunity ? `<div class="op">建议方向：${esc(p.opportunity)}</div>` : ""}</div>`).join("")}` : ""}
    ${w2.compare ? `<div class="grid"><div class="card"><h3 style="margin-top:0;color:var(--good)">我们更好的地方</h3>${ul(w2.compare.better)}</div><div class="card"><h3 style="margin-top:0;color:var(--bad)">我们不如竞品的地方</h3>${ul(w2.compare.worse)}</div></div><div class="card"><h3 style="margin-top:0">竞品买家在抱怨、我们可以解决的</h3>${ul(w2.compare.gaps)}</div>` : ""}` : "");

  // 2 对比总览（属性一行，商品一列）
  const ovRows = [
    ["商品 / 店铺", (s) => `${nameOf(s)}<div class="meta">${esc(s.shop || "")}${s.url ? ` · <a href="${esc(s.url)}" target="_blank" rel="noopener">链接</a>` : ""}</div>`],
    ["价格", (s) => esc(s.price || (s.manual && s.manual.price) || "")], ["销量", (s) => esc(s.sales || "")], ["分析评价", (s) => (s.analyzed ? `${s.analyzed} 条` : "—")],
    ["满意率", (s) => (s.analyzed ? `<b>${s.sentiment.posPct}%</b>` : "—")],
    ["最多人满意", (s) => (s.good || []).slice(0, 3).map((x) => `<span class="tag good">${esc(x.name)} ${x.pct}%</span>`).join("")],
    ["最多人不满意", (s) => (s.bad || []).slice(0, 3).map((x) => `<span class="tag bad">${esc(x.name)} ${x.pct}%</span>`).join("")],
    ["淘宝印象标签", (s) => (s.platformTags || []).map((t) => `<span class="tag">${esc(t.title)}${t.count ? " " + esc(t.count) : ""}</span>`).join("")],
  ];
  sec("overview", withRates.length ? `<div class="scroll"><table class="cmp"><thead><tr><th></th>${withRates.map((s) => `<th>${roleTag(s)}${shortTitle(s)}</th>`).join("")}</tr></thead><tbody>
    ${ovRows.slice(1).map(([k, f]) => `<tr><th>${k}</th>${withRates.map((s) => `<td>${f(s) || '<span class="meta">—</span>'}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <div class="meta">满意率 = AI 判断为“满意”的评价条数 ÷ 分析的评价条数（程序统计）。</div>` : "");

  // 3 标题分析（AI 只负责把标题切成“产品词 / 修饰词”，数字都是程序算的）
  const titled = stats.filter((s) => s.titleInfo && s.titleInfo.text);
  if (on("title") && titled.length) {
    const tws = new Map(titled.map((s) => [s.key, titleWords(s.titleInfo.text, s.titleAI)]));
    const wordsOf = (s) => { const t = tws.get(s.key); return new Set(t ? [...t.core, ...t.mod] : []); };
    let html = cols(titled, (s) => {
      const t = s.titleAI || {}, ti = s.titleInfo, tw = tws.get(s.key);
      const marked = tw ? tw.words.map((x) => `<span class="w ${x.t}">${esc(x.w)}</span>`).join("") : esc(ti.text);
      return `<div class="ttl">${marked}</div>${tw ? '<div class="meta"><span class="w core">产品词</span> <span class="w mod">修饰词</span></div>' : ""}
        ${kv([["字数", `${ti.len} / ${ti.max} 字符（剩 ${Math.max(0, ti.max - ti.len)}）${ti.len >= ti.max - 2 ? ' <span class="tag good">基本写满</span>' : ' <span class="tag bad">没写满</span>'}`],
          ...(tw ? [
            ["产品词在前 15 个字", tw.firstCore < 0 ? "标题里没找到产品词" : tw.firstCore < 15 ? `是（第 ${tw.firstCore + 1} 个字开始）` : `否（第 ${tw.firstCore + 1} 个字才出现）`],
            ["产品词（去重）", `<b>${tw.core.length}</b> 个：${chips(tw.core, "good")}`],
            ["修饰词（去重）", `<b>${tw.mod.length}</b> 个：${chips(tw.mod)}`],
            ["重复的词", tw.repeats.length ? tw.repeats.map((x) => `<span class="tag bad">${esc(x.w)} ×${x.n}</span>`).join("") : '<span class="meta">没有</span>'],
            ["覆盖范围", `<b>${tw.core.length} × ${tw.mod.length} = ${tw.coverage}</b> 个词组合 <span class="meta">（产品词 × 修饰词，大体估算标题能覆盖多少搜索词）</span>`],
          ] : [])])}
        ${tw && !tw.matches ? '<div class="meta" style="color:var(--warn)">AI 切出来的词和原标题对不上，数字可能有出入</div>' : ""}
        ${!tw ? `<div class="meta">${esc(extra.titleError || "没有 AI 拆词结果")}</div>` : ""}
        ${t.orderIssues && t.orderIssues.length ? `<h4>词序问题</h4>${ul(t.orderIssues)}` : ""}
        ${t.suggest ? `<h4>优化后的标题</h4><div class="ttl good">${esc(t.suggest)}</div>` : ""}
        ${t.advice && t.advice.length ? `<h4>建议</h4>${ul(t.advice)}` : ""}`;
    });
    // 覆盖范围对比条（一眼看出谁的标题覆盖得多）
    const maxCov = Math.max(1, ...titled.map((s) => (tws.get(s.key) || {}).coverage || 0));
    html = `<div class="card">${titled.map((s) => { const tw = tws.get(s.key); return tw ? `<div class="sku"><span>${nameOf(s)}</span><span class="p">${tw.core.length}×${tw.mod.length}</span><span class="b"><i style="width:${(tw.coverage / maxCov) * 100}%"></i></span><span class="n">${tw.coverage}</span></div>` : ""; }).join("")}<div class="meta">覆盖范围 = 产品词数 × 修饰词数（都去重）</div></div>` + html;
    if (ours && tws.get(ours.key) && titled.length > 1) {
      const mine = wordsOf(ours);
      html += `<h3>标题用词差异（和我们比）</h3>${cols(titled.filter((s) => s !== ours && tws.get(s.key)), (s) => { const theirs = wordsOf(s); return kv([["竞品有、我们没有<br><span class=meta>可能漏掉的流量词</span>", chips([...theirs].filter((x) => !mine.has(x)), "bad")], ["我们有、竞品没有<br><span class=meta>我们的差异化</span>", chips([...mine].filter((x) => !theirs.has(x)), "ours")], ["都有", chips([...theirs].filter((x) => mine.has(x)))]]); })}`;
    }
    out.push(`<h2 id="m-title">标题分析</h2>${html}<div class="meta">字数按淘宝规则算：汉字 2 个字符，字母数字 1 个，上限 60。标题由 AI 切成产品词和修饰词（产品词以外的都算修饰词，包括品牌、型号）；去重、重复的词、覆盖范围、谁有谁没有都是程序算的。</div>`);
  }

  // 4 主图分析
  const mained = stats.filter((s) => s.mainAI || s.mainError);
  sec("main", mained.length ? cols(mained, (s) => {
    const m = s.mainAI;
    const thumbs = m && m.thumbs && m.thumbs.length ? m.thumbs.map((d, i) => `<img src="${d}" alt="主图${i + 1}">`).join("") : (s.mainImages || []).filter((u) => !/\.gif/i.test(u)).map((u, i) => `<img src="${esc(u.startsWith("//") ? "https:" + u : u)}" alt="主图${i + 1}" loading="lazy" referrerpolicy="no-referrer">`).join("");
    if (!m) return `<div class="thumbs">${thumbs}</div><div class="meta">${esc(s.mainError || "")}</div>`;
    return `<div class="thumbs">${thumbs}</div>${kv([["主图数量", `${m.count || (s.mainImages || []).length} 张`], ["首图类型", esc(m.firstType || "")], ["促销价格", m.promo ? "有" : "没有"], ["文字卖点", chips(m.textPoints)], ["色调风格", esc(m.tone || "")], ["视觉焦点", esc(m.focus || "")], ["利益点", esc(m.benefit || "")],
      ["点击率潜力", m.ctr ? `<span class="tag ${m.ctr.level === "高" ? "good" : m.ctr.level === "低" ? "bad" : ""}">${esc(m.ctr.level || "")}</span> ${esc(m.ctr.reason || "")} <span class="meta">（AI 的主观判断）</span>` : ""]])}
      <div class="grid"><div><b>优点</b>${ul(m.pros)}</div><div><b>缺点</b>${ul(m.cons)}</div></div>
      ${m.images && m.images.length ? `<h4>每张图的改进建议</h4><ol class="list">${m.images.map((x) => `<li>${esc(x.what || "")}<div class="op">→ ${esc(x.advice || "")}</div></li>`).join("")}</ol>` : ""}`;
  }) : "");

  // 5 产品属性对比
  const attr = extra.attr && !extra.attr.error ? extra.attr : null;
  sec("attr", attr ? `<h3>硬属性（商家标注的参数）</h3><div class="scroll"><table class="cmp"><thead><tr><th>属性</th>${stats.map((s) => `<th>${roleTag(s)}${shortTitle(s)}</th>`).join("")}</tr></thead><tbody>
      ${(attr.hard || []).map((r) => `<tr><th>${esc(r.name)}</th>${stats.map((s) => `<td>${esc((r.values || {})[s.key] || "未标注")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <h3>软属性（定位和策略）</h3><div class="scroll"><table class="cmp"><thead><tr><th></th>${stats.map((s) => `<th>${roleTag(s)}${shortTitle(s)}</th>`).join("")}</tr></thead><tbody>
      ${[["目标人群", "audience"], ["适用季节", "season"], ["价格定位", "pricePos"], ["详情页风格", "detailStyle"]].map(([k, f]) => `<tr><th>${k}</th>${stats.map((s) => `<td>${esc(((attr.soft || {})[s.key] || {})[f] || "—")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <h3>商家说的 vs 买家感受到的</h3>${(attr.gaps || []).length ? `<table><thead><tr><th>商品</th><th>属性</th><th>商家标注 / 宣传</th><th>买家实际感受</th></tr></thead><tbody>${attr.gaps.map((g) => `<tr><td>${names[g.key] ? nameOf(names[g.key]) : esc(g.key)}</td><td>${esc(g.attr)}</td><td>${esc(g.merchant)}</td><td>${esc(g.buyers)}</td></tr>`).join("")}</tbody></table>` : '<div class="meta">没发现明显落差</div>'}`
    : extra.attr && extra.attr.error ? `<div class="meta">属性对比没做成：${esc(extra.attr.error)}</div>` : "");

  // 6 评价时间分布与销量估算
  const timed = stats.filter((s) => s.time);
  sec("time", timed.length ? cols(timed, (s) => {
    const t = s.time;
    return `${kv([["时间跨度", `${t.from} ～ ${t.to}（${t.totalDays} 天）`], ["有评价 / 没评价的天数", `${t.withRates} 天 / ${t.without} 天`], ["评价总数 / 日均", `${t.total} 条 / ${t.avg} 条`], ["异常高峰", t.peaks.length ? t.peaks.join("、") : "没有"], ["没算进来", t.oldDropped ? `${t.oldDropped} 条特别早的评价（离其他评价超过 30 天）` : ""]])}
      ${timeChart(t)}
      <h4>销量估算（仅供参考）</h4>${kv([["日均销量", `${t.sales.dailyMin} ～ ${t.sales.dailyMax} 件`], ["这段时间总销量", `${t.sales.totalMin} ～ ${t.sales.totalMax} 件`], ["淘宝页面显示", esc(s.sales || "—")]])}`;
  }) + `<div class="meta">销量估算的前提：淘宝买家评价率大约 10%～20%，所以 销量 ≈ 评价数 × 5 ～ × 10。只用了采到的最近 ${an.options.rates} 条评价，折叠的评价不算，实际销量可能更高。</div>` : "");

  // 7 买家评价分析
  sec("rates", withRates.filter((s) => s.analyzed).length ? cols(withRates.filter((s) => s.analyzed), (s) => {
    const sent = s.sentiment;
    return `<div class="sent" title="满意 ${sent.posPct}% / 一般 ${sent.neuPct}% / 不满意 ${sent.negPct}%"><i style="width:${sent.posPct}%;background:var(--good)"></i><i style="width:${sent.neuPct}%;background:#c9ced8"></i><i style="width:${sent.negPct}%;background:var(--bad)"></i></div>
      <div class="meta">满意 ${sent.posPct}% · 一般 ${sent.neuPct}% · 不满意 ${sent.negPct}%${s.extreme ? ` · <b style="color:var(--bad)">极端差评 ${s.extreme.pct}%（${s.extreme.count} 条）</b>` : ""}</div>
      ${s.extreme && s.extreme.count ? quotes(s.extreme.quotes, "看极端差评原话") : ""}
      <h4>买家满意的地方 Top10</h4>${bars(s.good, "good", 10)}
      <h4>买家不满意的地方 Top10</h4>${bars(s.bad, "bad", 10)}
      <h4>用途和需求</h4>${bars(s.need, "neu", 8)}
      <h4>买家身份</h4>${bars(s.who, "neu", 8)}
      ${s.rebuy ? `<h4>回购信号：<span class="tag ${s.rebuy.level === "强" ? "good" : ""}">${esc(s.rebuy.level)}</span> ${s.rebuy.pct}%（${s.rebuy.count} 条）</h4>${quotes(s.rebuy.quotes, "看回购评价")}` : ""}
      ${s.appends ? `<h4>追评 ${s.appends.count} 条：<span class="tag good">变好 ${s.appends.up}</span><span class="tag bad">变差 ${s.appends.down}</span></h4>${s.appends.list.length ? `<details><summary>看全部追评</summary>${s.appends.list.map((x) => `<div class="q">${x.dir === "up" ? '<span class="tag good">变好</span>' : x.dir === "down" ? '<span class="tag bad">变差</span>' : '<span class="tag">差不多</span>'} 追评：${esc(x.append)}<br><small>当初：${esc(x.content)} · ${esc(x.date || "")} ${esc(x.sku || "")}</small></div>`).join("")}</details>` : ""}` : ""}
      ${s.recent && s.recent.length ? `<h4>最近 30 天冒出来的问题</h4>${s.recent.map((x) => `<span class="tag bad">${esc(x.name)}：最近 ${x.recentPct}%，之前 ${x.beforePct}%</span>`).join("")}` : ""}`;
  }) : "");

  // 8 规格分布
  sec("sku", stats.some((s) => (s.sku || []).length) ? cols(stats.filter((s) => (s.sku || []).length), (s) => `${s.topSku ? `<div class="meta">主推规格（评价里最多）：<b>${esc(s.topSku)}</b></div>` : ""}${skuBars(s.sku)}
    ${(s.skuByProp || []).map((p) => `<h4>按“${esc(p.name)}”汇总</h4>${bars(p.values, "neu", 10)}`).join("")}`) : "");

  // 9 问大家
  sec("qa", stats.some((s) => s.qa && s.qa.topics && s.qa.topics.length) ? cols(stats.filter((s) => s.qa && s.qa.topics && s.qa.topics.length), (s) => {
    const a = s.qa.answers || {};
    return `<div class="meta">${esc(s.qa.total || 0)} 个问题，分析 ${s.qa.analyzed} 个；⚠ = 买家在担心</div>
      ${s.qa.topics.map((t) => `<div class="bar neu"><span class="t">${esc(t.name)}${t.worry ? " ⚠" : ""}</span><span class="b"><i style="width:${Math.min(100, (t.count / (s.qa.topics[0].count || 1)) * 100)}%"></i></span><span class="n">${t.count} 次</span></div>`).join("")}
      ${a.judged ? `<h4>回答质量</h4><div><span class="tag good">正面回答 ${a.good}</span><span class="tag">没回答 ${a.none}</span><span class="tag bad">回避 ${a.dodge}</span><span class="tag bad">透露负面 ${a.bad}</span></div>${(a.samples || []).length ? `<details><summary>看回避 / 负面的回答</summary>${a.samples.map((x) => `<div class="q">问：${esc(x.q)}<br>答：${esc(x.a || "（没有回答）")} <small>${x.type === "dodge" ? "回避" : "透露负面"}</small></div>`).join("")}</details>` : ""}` : ""}
      ${(w2.qaCheck || []).filter((x) => x.key === s.key).length ? `<h4>担心有没有成真</h4>${(w2.qaCheck || []).filter((x) => x.key === s.key).map((x) => `<div class="pain"><b>${esc(x.worry)}</b><div class="meta">${esc(x.real)}</div></div>`).join("")}` : ""}`;
  }) : "");

  // 10 详情页分析
  const desced = stats.filter((s) => s.desc || s.descError);
  sec("desc", desced.length ? cols(desced, (s) => (s.desc ? descBlock(s.desc) : `<div class="meta">${esc(s.descError)}</div>`)) + detailSection(w2.detail, names).replace("<h2>详情页 vs 评价</h2>", "<h3>详情页 vs 评价</h3>") : "");

  // 11 优化建议
  const sug = w2.suggestions || {};
  sec("advice", w2.suggestions ? `<div class="grid">
    <div class="card"><h3 style="margin-top:0">产品改进</h3>${ul(sug.product)}</div><div class="card"><h3 style="margin-top:0">详情页和主图</h3>${ul(sug.detail)}</div>
    <div class="card"><h3 style="margin-top:0">建议主打的卖点</h3>${ul(sug.points)}</div><div class="card"><h3 style="margin-top:0">详情页里要提前回答的问题</h3>${ul(sug.faq)}</div>
    <div class="card"><h3 style="margin-top:0">价格和规格</h3>${ul(sug.price)}</div><div class="card"><h3 style="margin-top:0">要注意的风险</h3>${ul(w2.risks)}</div></div>` : "");

  const per = stats.map((s) => `${s.role === "ours" ? "我们" : "竞品 " + s.key.slice(1)} ${s.collected || 0} 条`).join(" · ");
  const shown = Object.keys(MOD_NAMES).filter((k) => on(k) && out.some((h) => h.includes(`id="m-${k}"`)));
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(an.name)} · 竞品分析报告</title><style>${CSS}${CSS2}</style></head><body><div class="wrap">
<h1>${esc(an.name)}</h1>
<div class="meta">竞品分析报告 · 生成于 ${bj(Date.now())}（北京时间）· ${stats.length} 个商品 · 采到的评价：${per}（按时间从新到旧，每个最多 ${an.options.rates} 条）</div>
<div class="toc">${shown.map((k) => `<a href="#m-${k}">${MOD_NAMES[k]}</a>`).join("")}<a href="#m-notes">说明</a></div>
${out.join("\n")}
<h2 id="m-notes">说明</h2>
<div class="note">
<p>· 评价采集：淘宝采集插件按时间从新到旧采集，每个商品最多 ${an.options.rates} 条；淘宝折叠的评价不采；默认好评、空评价不参与分析（评价时间分布里算）。报告是样本统计，不是全部评价。</p>
<p>· AI 打标签：每条评价由 AI 判断态度（满意 / 一般 / 不满意），并打上满意点、不满意点、用途、人群、是否极端差评、是否回购、追评变好还是变差；意思相近的标签再由 AI 合并。</p>
<p>· 百分比：某一点的百分比 = 提到这一点的评价条数 ÷ 分析的评价条数；满意率 = AI 判断为满意的条数 ÷ 分析的评价条数；全部由程序统计。回购信号 = AI 判断回购或含“回购 / 第二次 / 又买”等词的评价占比。</p>
<p>· 详情页、主图：把图片缩小（详情图拼起来切成几张 JPG）交给能看图的 AI 读出内容；AI 读图可能漏字或看错，重要的地方请对照原图。</p>
<p>· 销量估算：假设评价率 10%～20%，销量 ≈ 评价数 × 5 ～ × 10，只作参考。</p>
<p>· 结论和建议由 AI 根据统计数据写成，重要决策请结合评价原话和原始数据核对。</p>
${stats.filter((s) => s.descError).map((s) => `<p>· ${shortTitle(s)}：${esc(s.descError)}</p>`).join("")}
${stats.filter((s) => s.mainError).map((s) => `<p>· ${shortTitle(s)}：${esc(s.mainError)}</p>`).join("")}
${extra.titleError ? `<p>· 标题分析没做成：${esc(extra.titleError)}</p>` : ""}
${stats.filter((s) => s.analyzed === 0 && !s.manual).map((s) => `<p>· ${esc(names[s.key] ? shortTitle(s) : s.key)}：没有拿到可分析的评价。</p>`).join("")}
</div>
</div></body></html>`;
}

const CSS2 = `
.toc{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0 0}.toc a{font-size:13px;text-decoration:none;background:#fff;border:1px solid var(--line);border-radius:999px;padding:2px 10px}
.cols{display:grid;grid-template-columns:repeat(var(--n),minmax(380px,1fr));gap:14px;overflow-x:auto;padding-bottom:6px}
.colx{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px;min-width:0}
.colx:first-child:has(.tag.ours){border-color:#d8c5f3}
.colh{font-size:15px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--line)}
h4{font-size:14px;margin:16px 0 6px}
table.kv th{width:9em;background:none;color:var(--sub);font-weight:500;padding:5px 8px 5px 0}table.kv td{padding:5px 0}
table.cmp th:first-child{width:9em}table.cmp td,table.cmp thead th{min-width:220px}
.ttl{background:var(--soft);border-radius:8px;padding:8px 10px;margin:4px 0 8px}.ttl.good{background:var(--goodsoft)}
.w{display:inline-block;padding:0 3px;margin:1px;border-radius:4px}.w.core{background:var(--goodsoft);color:var(--good);font-weight:600}.w.mod{background:#eef1f6}
.score{height:10px;border-radius:5px;background:var(--soft);overflow:hidden;margin-bottom:6px}.score i{display:block;height:100%;background:var(--accent)}
.thumbs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}.thumbs img{width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--line)}
.chart{width:100%;height:auto;margin-top:8px}.chart text{font-size:11px;fill:#8a909c}
`;
