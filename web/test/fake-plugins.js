// 测试用的假插件：假 ai-web（DeepSeek / Kimi 写文字）、假淘宝采集、假 AI图图（Gemini）
import WebSocket from "ws";

export function connect(url, hello, onCmd) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open", () => ws.send(JSON.stringify({ type: "hello", ...hello })));
    ws.on("message", async (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === "welcome") resolve(ws);
      if (m.type === "error") reject(new Error(m.error));
      if (m.type === "cmd") {
        const progress = (extra) => ws.send(JSON.stringify({ type: "progress", id: m.id, site: m.site, ...extra }));
        try {
          const data = await onCmd(m, progress);
          ws.send(JSON.stringify({ type: "result", id: m.id, site: m.site, cmd: m.cmd, ok: !data.error, data }));
        } catch (e) {
          ws.send(JSON.stringify({ type: "result", id: m.id, site: m.site, cmd: m.cmd, ok: false, data: { error: e.message } }));
        }
      }
    });
    ws.on("error", reject);
  });
}

// ---------------------------------------------------------------- 假淘宝数据
const GOOD = ["保温效果很好，早上的热水下午还烫", "做工精细，拿着有质感", "颜值高，送给女朋友很喜欢", "容量刚好，上班带着方便", "物流很快，包装严实"];
const BAD = ["杯盖有点漏水，放包里湿了", "有点重，学生背着累", "刚到的时候有异味", "保温效果一般，晚上就凉了", "盖子不好拧"];
export function fakeItem(id, nRates, badRatio = 0.3) {
  const day = 86400000, now = Date.UTC(2026, 9, 18);
  const rates = Array.from({ length: nRates }, (_, i) => {
    const bad = (i * 7) % 10 < badRatio * 10;
    const d = new Date(now - i * day * 0.8);
    return {
      id: `${id}-${i}`, user: "买家" + i, date: d.toISOString().slice(0, 10), sku: i % 3 ? "颜色分类:白色;容量:500ml" : "颜色分类:黑色;容量:350ml",
      content: bad ? BAD[i % BAD.length] + (i % 4 === 0 ? "，学生党买的" : "") : GOOD[i % GOOD.length] + (i % 5 === 0 ? "，买来送礼" : ""),
      pics: [], video: "", appendContent: i % 9 === 0 ? "用了一个月还不错" : "", appendPics: [], likes: "0",
    };
  });
  rates.push({ id: `${id}-x`, user: "x", date: "2026-01-01", sku: "", content: "此用户没有填写评价。", pics: [], appendContent: "", appendPics: [] });
  return {
    url: `https://item.taobao.com/item.htm?id=${id}`,
    item: { itemId: id, title: `测试保温杯 ${id} 316不锈钢`, shopName: "测试店铺", sellCount: "1000+", rateTotal: "2000+", mainImages: [`https://img.alicdn.com/fake/${id}.jpg`],
      skus: [{ name: "白色 500ml", price: "59.00" }, { name: "黑色 350ml", price: "49.00" }], skuProps: [{ name: "颜色分类", values: [{ name: "白色" }, { name: "黑色" }] }],
      params: [{ name: "材质", value: "316不锈钢" }, { name: "容量", value: "500ml" }], rateKeywords: [{ title: "保温好", count: "100" }] },
    rates: { tags: [{ title: "保温好", count: "100" }], counts: { all: "2000+" }, list: rates, hasNext: true },
    qa: { total: "12", list: [{ id: "q1", title: "会漏水吗？", answers: [{ content: "不会" }] }, { id: "q2", title: "能保温多久", answers: [{ content: "8 小时左右" }] }, { id: "q3", title: "放包里会不会漏", answers: [] }] },
  };
}

// ---------------------------------------------------------------- 假 AI：按提示词类型回 JSON
const pick = (text, rules) => rules.filter(([re]) => re.test(text)).map(([, t]) => t);
export function fakeAnswer(prompt, material) {
  const lines = String(material || "").split("\n").filter((l) => /^#\d+/.test(l));
  let out;
  if (/给每条评价打标签/.test(prompt)) {
    out = lines.map((l) => {
      const i = Number(/^#(\d+)/.exec(l)[1]);
      const good = pick(l, [[/保温效果很好/, "保温效果好"], [/做工精细/, "做工好"], [/颜值高/, "颜值高"], [/容量刚好/, "容量合适"], [/物流很快/, "物流快"]]);
      const bad = pick(l, [[/漏水/, "杯盖漏水"], [/有点重/, "太重"], [/异味/, "有异味"], [/保温效果一般/, "保温差"], [/不好拧/, "盖子难拧"]]);
      return { i, s: bad.length ? -1 : 1, good, bad, need: pick(l, [[/送/, "送礼"], [/上班/, "上班用"]]), who: pick(l, [[/学生/, "学生"], [/女朋友/, "情侣"]]),
        ...(/漏水/.test(l) ? { x: 1 } : {}), ...(/回购|第二次/.test(l) ? { rb: 1 } : {}), ...(/追评/.test(l) ? { ap: /还不错/.test(l) ? "up" : "down" } : {}) };
    });
  } else if (/归纳一个主题/.test(prompt)) {
    out = lines.map((l) => ({ i: Number(/^#(\d+)/.exec(l)[1]), topic: /漏/.test(l) ? "是否漏水" : /保温/.test(l) ? "保温时间" : "其他", worry: /漏/.test(l), a: /｜\s*$/.test(l) ? "none" : /不会/.test(l) ? "good" : "dodge" }));
  } else if (/合并成一个归类名/.test(prompt)) {
    const v = JSON.parse(material);
    out = Object.fromEntries(Object.entries(v).map(([k, o]) => [k, Object.fromEntries(Object.keys(o).map((t) => [t, t === "保温差" ? "保温效果差" : t]))]));
  } else if (/标题优化专家/.test(prompt)) {
    const m = JSON.parse(material);
    out = { products: Object.entries(m).map(([key, v]) => ({ key, core: ["保温杯"], modifiers: key === "ours" ? ["高颜值"] : ["新款"], attrs: { 材质: ["316不锈钢"], 款式外观: [], 季节时间: [], 人群: key === "ours" ? ["学生"] : [], 场景: [] }, fillers: [], repeats: [], orderIssues: ["核心词靠后"], coverage: key === "ours" ? 2 : 1, suggest: "316不锈钢保温杯 学生 大容量", advice: ["加上场景词"] })) };
  } else if (/的主图（1:1/.test(prompt)) {
    out = { firstType: "白底图", promo: false, textPoints: ["保温 24 小时"], tone: "冷色调", focus: "清楚", benefit: "卖点透出", pros: ["干净"], cons: ["没有场景"], ctr: { level: "中", reason: "和同类差不多" }, images: [{ i: 1, what: "白底正面", advice: "加场景" }] };
  } else if (/电商产品经理/.test(prompt)) {
    const m = JSON.parse(material);
    out = { hard: [{ name: "材质", values: Object.fromEntries(Object.keys(m).map((k) => [k, "316不锈钢"])) }, { name: "容量", values: Object.fromEntries(Object.keys(m).map((k, i) => [k, i ? "350ml" : "500ml"])) }], soft: Object.fromEntries(Object.keys(m).map((k) => [k, { audience: "上班族", season: "秋冬", pricePos: "中端品质", detailStyle: "白底简约" }])), gaps: [{ key: Object.keys(m)[0], attr: "保温", merchant: "保温 24 小时", buyers: "10% 说保温差" }] };
  } else if (/从上到下按顺序切开/.test(prompt)) {
    out = { selling: ["316 不锈钢内胆", "保温 24 小时", "一键开盖不漏水"], structure: ["第 1 屏：首屏海报", "第 2 屏：保温测试"], params: ["容量：500ml"], claims: ["保温 24 小时"], promises: ["一年换新"], audience: "上班族", scenes: "办公室、通勤", style: "白底简约" };
  } else if (/竞品分析结论/.test(prompt)) {
    const st = JSON.parse(material);
    out = { summary: `共分析 ${st.length} 个商品，买家最在意保温和漏水。`, products: st.map((s) => ({ key: s.key, positioning: "中端保温杯", strengths: ["保温好"], weaknesses: ["杯盖漏水"] })),
      needs: ["上班用", "送礼"], pains: [{ point: "杯盖漏水", evidence: "竞品 1 有 20% 的评价提到", opportunity: "做双层密封盖" }],
      compare: { better: ["更轻"], worse: ["价格高"], gaps: ["漏水"] }, suggestions: { product: ["加密封圈"], detail: ["首屏放倒置不漏水的图"], points: ["倒置不漏"], faq: ["会漏水吗"], price: ["主推 500ml"] }, risks: ["夸大保温时间"],
      qaCheck: st.map((x) => ({ key: x.key, worry: "会不会漏水", real: "成真：杯盖漏水 10%" })),
      detail: { products: st.filter((x) => x.详情页).map((x) => ({ key: x.key, accepted: ["316 不锈钢内胆，满意点里做工好 30%"], doubted: ["详情页说保温 24 小时，评价里 20% 说保温差"], missing: ["买家问会不会漏水，详情页没讲"] })), ours: ["首屏写清楚倒置不漏"] } };
  } else out = { ok: true };
  return "好的，结果如下：\n```json\n" + JSON.stringify(out) + "\n```";
}
