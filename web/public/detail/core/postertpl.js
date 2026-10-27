/**
 * 文字版主图的固定版式（Lee 2026-10-27）：从 Lee 给的 9 张好主图归纳出来的 9 个模板。
 * 每个模板 = 一张“设计说明卡”（风格、背景、字体、版式分区、不要什么）+ 格子（要填的字，带字数上限）+ 几套配色。
 * 写方案的 AI 只按格子填字；出图时把说明卡 + 线框图（/main/tpl/<id>-wire.png，我们自己画的）+ 填好的字发给出图 AI。
 * 缩略图 /main/tpl/<id>.png（示例文字），由 tools/poster-tpl/make.mjs 生成。
 */
ST.POSTER_TPLS = [
  {
    id: "A", name: "红白促销 · 大字居中", use: "单一服务、强调退款承诺",
    style: "Clean Chinese promotional poster: white background inside a thick red frame, flat design, only red / white (+ a little black), very bold sans-serif type.",
    layout: "0-11%: full-width red top bar with the shop / category text in white. 13-24%: one line of service keywords in big black bold type. 25-30%: a short, widely letter-spaced small line. 32-60%: the HUGE red keyword (2-4 characters) filling ~90% of the width. 62%: a thin red horizontal rule. 65-75%: the promise line in red bold. 80-100%: red bottom banner with an upward arc on top, white bold slogan inside.",
    avoid: "no gradients, no 3D, no photos, no tech blue, no thin fonts",
    slots: [["shop", "顶部红条（店名 / 品类）", 8], ["list", "服务清单（一行）", 12], ["small", "小字说明", 8], ["title", "超大关键词", 4], ["promise", "承诺", 10], ["bar", "底部横条", 8]],
    icons: [],
    palettes: [["红白（原色）", "red #E01E2B, white #FFFFFF, black #111111"], ["蓝白", "royal blue #1D4ED8, white #FFFFFF, black #111111"], ["绿白", "green #0F9D58, white #FFFFFF, black #111111"]],
  },
  {
    id: "B", name: "浅灰简约 · 双行巨字", use: "第 1 张主图，标题最醒目",
    style: "Minimal, clean poster: light warm-grey gradient background, two lines of giant extra-bold sans-serif headline where the key words use the brand color and the rest dark grey; white rounded pills; a solid dark bottom banner.",
    layout: "4-15%: a small tag inside a dashed rounded outline, centered. 18-58%: two lines of GIANT headline, centered, each line about 85% of the width, key words in brand color with a subtle white outline and soft shadow. 60-68%: one sub-title line, dark grey bold. 70-80%: three white rounded pills in a row with dark text. 83-100%: full-width dark brand-color banner with white bold slogan.",
    avoid: "no photos, no busy backgrounds, no more than 2 main colors",
    slots: [["tag", "顶部虚线标签", 12], ["title1", "大标题第 1 行", 6], ["title2", "大标题第 2 行", 6], ["sub", "副标题", 14], ["pill1", "胶囊 1", 5], ["pill2", "胶囊 2", 5], ["pill3", "胶囊 3", 5], ["bar", "底部横条", 12]],
    icons: [],
    palettes: [["蓝灰（原色）", "brand blue #2B5BFF, dark grey #333333, light grey #F2F2F0, banner #1D3FA8"], ["红灰", "brand red #E0262B, dark grey #333333, light grey #F2F2F0, banner #B3121C"], ["橙灰", "brand orange #FF7A00, dark grey #333333, light grey #F2F2F0, banner #1F2A44"]],
  },
  {
    id: "C", name: "描边大字 · 卖点卡片", use: "4 条左右卖点，突出专业",
    style: "Bold sticker-style poster: white background, huge headline in dark navy with a thick orange outline, a product logo top-right, a dark rounded card holding a list of selling points with small icons, an orange bottom banner.",
    layout: "3-22%: huge outlined headline on the left (navy fill, thick orange stroke); logo / icon at top-right (about 25% wide). 23-38%: the product name in big navy-blue letters. 38-50%: a second outlined line (smaller). 52-84%: a dark navy rounded card (90% wide) with 4 lines, each starting with a small orange icon, white bold text. 86-100%: orange full-width banner, black extra-bold slogan.",
    avoid: "no photos, no thin text, no more than 3 colors",
    slots: [["title1", "描边大标题", 4], ["product", "产品名", 8], ["title2", "第二行描边字", 8], ["point1", "卖点 1", 14], ["point2", "卖点 2", 14], ["point3", "卖点 3", 14], ["point4", "卖点 4", 14], ["bar", "底部横条", 14]],
    icons: [["logo", "右上图标 / 软件 logo"]],
    palettes: [["深蓝橙（原色）", "navy #0D4F73, orange #F2A20C, white #FFFFFF"], ["红黄", "red #C8102E, yellow #FFD100, white #FFFFFF"], ["墨绿金", "dark green #0B5D4B, gold #E8B23A, white #FFFFFF"]],
  },
  {
    id: "D", name: "橙色冲击 · 色块网格", use: "服务项目多（6 个以内）",
    style: "High-impact poster: pale peach background inside a thick orange frame, a giant black headline, an orange slab with white words, a black narrow banner, a 2x3 grid of orange pills, a corner badge with a diagonal cut.",
    layout: "3-24%: GIANT black extra-bold headline, centered. 26-46%: an orange rounded slab (92% wide) with the main keyword in huge white bold type. 47-57%: a black narrow banner with white bold sub-title. 60-78%: 2 rows x 3 orange rounded pills with white text. 80-100%: bottom-left orange badge with a curved / diagonal top-right corner (two lines of white bold text); to its right two lines of orange-red promise text (small then big).",
    avoid: "no photos, no tech blue, no thin fonts",
    slots: [["title", "超大黑字", 4], ["keyword", "色块关键词", 6], ["banner", "黑色横幅", 10], ["item1", "胶囊 1", 5], ["item2", "胶囊 2", 5], ["item3", "胶囊 3", 5], ["item4", "胶囊 4", 5], ["item5", "胶囊 5", 5], ["item6", "胶囊 6", 5], ["badge", "左下角标", 4], ["promise1", "右下小字", 10], ["promise2", "右下承诺", 10]],
    icons: [],
    palettes: [["橙黑（原色）", "orange #FF5A1F, black #111111, pale peach #FFE7DF, white"], ["红黑", "red #E01E2B, black #111111, pale pink #FFE5E5, white"], ["蓝黑", "blue #1D4ED8, black #111111, pale blue #E5EDFF, white"]],
  },
  {
    id: "E", name: "黑底大字报 · 红黄高对比", use: "维修、装机，最抓眼",
    style: "Chinese street-promotion 'big character poster': near-black background with faint warm texture / bokeh, extremely high contrast, every text bold and big; red boxes with yellow text; white giant headline with red drop shadow.",
    layout: "2-10%: a row of 3-4 small red rounded tags with yellow text on the left; a short yellow title at top-right. 12-40%: GIANT white extra-bold headline (2-4 characters) spanning the full width with a thick red drop shadow / outline. 41-50%: one line of yellow bold sub-title. 52-80%: 2x2 grid of red boxes with big yellow bold text (4 characters each). 82-98%: two big white bold phrases, one left and one right.",
    avoid: "no blue, no 3D, no photos of people, no thin or small text",
    slots: [["tag1", "小标签 1", 3], ["tag2", "小标签 2", 3], ["tag3", "小标签 3", 3], ["tag4", "小标签 4", 3], ["shop", "右上称号", 5], ["title", "超大白字", 4], ["sub", "黄色副标题", 10], ["box1", "方块 1", 4], ["box2", "方块 2", 4], ["box3", "方块 3", 4], ["box4", "方块 4", 4], ["foot1", "底部左句", 4], ["foot2", "底部右句", 4]],
    icons: [],
    palettes: [["黑红黄（原色）", "black #0A0A0A, red #E01E2B, yellow #FFE14D, white #FFFFFF"], ["黑蓝白", "black #0A0A0A, electric blue #1E6BFF, cyan #3FD0FF, white #FFFFFF"], ["黑金", "black #0A0A0A, dark red #8B0D12, gold #E8B23A, white #FFFFFF"]],
  },
  {
    id: "F1", name: "浅蓝 3D 质感 · 左列表右主体", use: "显得专业、高级",
    style: "Premium tech poster: light blue gradient background with soft light rays, a glossy 3D hero object, clean navy typography, round blue icon badges, a deep blue feature bar and a pale yellow slogan strip at the bottom.",
    layout: "2-14%: product / software logo centered. 15-25%: one big navy extra-bold headline line. 27-32%: a deep blue pill with 4 short phrases separated by '|'. 35-78%: LEFT 50%: 4 rows, each = round blue icon + bold navy title + small grey description, separated by thin dashed lines; RIGHT 45%: a glossy 3D hero object (e.g. database cylinder / computer / shield) on a glowing round base. 80-92%: deep blue rounded bar with 3 items (icon + bold white title + small white line). 92-100%: pale yellow strip with a navy bold slogan.",
    avoid: "no flat clip-art, no dark background, no red",
    slots: [["title", "大标题", 10], ["pill", "胶囊（4 个短词用 | 隔开）", 20], ["f1", "列表 1 标题", 4], ["f1d", "列表 1 说明", 8], ["f2", "列表 2 标题", 4], ["f2d", "列表 2 说明", 8], ["f3", "列表 3 标题", 4], ["f3d", "列表 3 说明", 8], ["f4", "列表 4 标题", 4], ["f4d", "列表 4 说明", 8], ["b1", "底部条 1", 12], ["b2", "底部条 2", 12], ["b3", "底部条 3", 12], ["slogan", "底部口号", 14]],
    icons: [["logo", "顶部 logo"], ["hero", "右侧 3D 主体"]],
    palettes: [["浅蓝（原色）", "light blue #EEF4FF to #D9E7FF, deep blue #1D4FD8, navy #0B1F5C, pale yellow #FDE9A8"], ["浅绿", "light mint #EAFBF3 to #D3F3E4, green #0E9F6E, dark green #064E3B, pale yellow #FDE9A8"], ["浅紫", "light lavender #F3EEFF to #E2D9FF, violet #6D28D9, deep purple #2E1065, pale yellow #FDE9A8"]],
  },
  {
    id: "F2", name: "深蓝科技 · 软件图标网格", use: "能做的项目很多",
    style: "Dark tech poster: deep navy-to-blue radial gradient with glow, a glowing white extra-bold headline, translucent blue pills, a laptop + headset illustration, a 4x2 grid of white rounded tiles each with a colorful software-style icon and a name, a bottom row of 4 guarantees.",
    layout: "3-10%: translucent blue pill with a small shield icon and a slogan. 11-27%: GIANT glowing white headline on the left 65%; top-right: laptop with a customer-service headset illustration. 28-35%: second translucent pill on the left; a small blue card with two lines on the right. 37-82%: 4 columns x 2 rows of white rounded tiles, each = colorful icon + bold black name. 85-97%: a thin-outlined rounded bar with 4 items (round icon + bold white word).",
    avoid: "no light background, no red/yellow street style, no photos of people",
    slots: [["tag", "顶部胶囊", 14], ["title", "发光大标题", 6], ["pill", "第二行胶囊", 14], ["card", "右侧小卡片（两行）", 12], ["g1", "格子 1", 8], ["g2", "格子 2", 8], ["g3", "格子 3", 8], ["g4", "格子 4", 8], ["g5", "格子 5", 8], ["g6", "格子 6", 8], ["g7", "格子 7", 8], ["g8", "格子 8", 8], ["a1", "保障 1", 4], ["a2", "保障 2", 4], ["a3", "保障 3", 4], ["a4", "保障 4", 4]],
    icons: [["hero", "右上插画"], ["grid", "格子里的图标"]],
    palettes: [["深蓝（原色）", "deep navy #08134A, blue #2747C9, glow #5B8CFF, white"], ["深紫", "deep purple #1B0B3F, violet #6D28D9, glow #A78BFA, white"], ["墨绿", "deep teal #04201E, teal #0F766E, glow #2DD4BF, white"]],
  },
  {
    id: "G", name: "流程步骤", use: "讲服务流程那张",
    style: "Friendly, clear process poster: light blue gradient background, a big navy headline, 4 white rounded cards each with a big orange number badge and a short step name, a solid navy bottom banner.",
    layout: "4-17%: big navy extra-bold headline, centered. 18-25%: one grey bold sub-title line. 28-80%: 2x2 white rounded cards with soft shadow; each card = orange round number badge (1-4) + bold dark step name; small arrows between cards are optional. 82-100%: full-width navy banner with white bold slogan.",
    avoid: "no photos, no clutter, no more than 4 steps",
    slots: [["title", "大标题", 10], ["sub", "副标题", 12], ["s1", "步骤 1", 5], ["s2", "步骤 2", 5], ["s3", "步骤 3", 5], ["s4", "步骤 4", 5], ["bar", "底部横条", 12]],
    icons: [],
    palettes: [["蓝橙（原色）", "light blue #EAF3FF, navy #0B3D91, orange #FF8A00, white"], ["绿橙", "light mint #EAFBF3, dark green #065F46, orange #FF8A00, white"], ["红黄", "light pink #FFF0F0, red #C8102E, yellow #FFC400, white"]],
  },
  {
    id: "H", name: "大数字居中 · 深色科技", use: "只突出一个最强卖点",
    style: "Dark tech poster with one giant glowing keyword / number in the center: deep indigo radial background, neon cyan glow, minimal text around it, a bright bottom banner.",
    layout: "4-11%: a small outlined cyan pill, centered. 15-25%: one white bold title line. 28-62%: the GIANT glowing cyan number / keyword (2-5 characters) in the center, about 80% of the width. 64-72%: one light-blue bold line of small selling points separated by '·'. 82-100%: bright orange full-width banner with black extra-bold slogan.",
    avoid: "no light background, no clutter, no photos",
    slots: [["tag", "顶部小胶囊", 8], ["title", "标题", 10], ["big", "超大数字 / 关键词", 5], ["sub", "一行小卖点", 16], ["bar", "底部横条", 10]],
    icons: [],
    palettes: [["深靛青（原色）", "deep indigo #0C0F2E to #2A2F6B, neon cyan #39D0FF, orange #FF8A00, white"], ["深红金", "deep wine #2A0A10 to #5A1220, gold #FFC24B, red #E01E2B, white"], ["深绿荧光", "deep green #031A12 to #0B3D2A, neon green #39FF8E, yellow #FFD400, white"]],
  },
];
ST.posterTpl = (id) => ST.POSTER_TPLS.find((t) => t.id === id) || null;

/**
 * 写方案（给定版式）：每套方案一个模板，AI 只按格子填字（借鉴参考图文案），返回 JSON。
 * tpls = 选的模板 id 列表（顺序 = 方案顺序）
 */
ST.P.posterTplPlan = (p, tpls, hasRefs) => {
  const ban = ST.banList(p.posterBan);
  const content = String(p.posterContent != null ? p.posterContent : [p.industry, p.posterNote].filter(Boolean).join("；")).trim();
  const blocks = tpls.map((id, i) => {
    const t = ST.posterTpl(id);
    return [`方案 ${i + 1}：模板 ${t.id}「${t.name}」（适合：${t.use}）`, `  格子（后面是字数上限，一个格子一句话，尽量用满但不能超）：`, ...t.slots.map(([k, n, max]) => `  - ${k}（${n}）：≤${max} 字`), ...(t.icons || []).map(([k, n]) => `  - 图标 ${k}（${n}）：用一句中文描述这里画什么图标 / 插画（不是文字）`)].join("\n");
  });
  return [
    `请为一款电商商品写 ${tpls.length} 套淘宝 / 天猫主图的文案方案。每套方案用指定的固定版式模板，你只负责往模板的格子里填文字。`,
    `【要表达的内容】${content || "（没写，按参考图的行业来）"}`,
    hasRefs ? "附上的图片是参考图：文案要参考它们的说法、卖点的组织方式和语气（直接、有力、具体），改写成符合【要表达的内容】的话；不要照抄别家的店名、品牌、价格。" : "",
    "写法要求：",
    "1. 标题要直接说“做什么 + 产品”（如：远程安装 MySQL），不要书面套话（如“用心协助、稳妥交付”）。",
    "2. 卖点要具体：版本号、平台、一对一、多久、赠送什么、退款承诺这类，照参考图的文案密度来。",
    "3. 真实的售后承诺可以写（如“安装不成功全额退款”）；不能用广告法违禁词和虚假承诺：" + ban.join("、") + "；不写联系方式。",
    "4. 每个格子不超过字数上限；数字、英文、斜杠都算字。",
    "",
    ...blocks,
    "",
    "只回复一个 JSON 代码块，格式：",
    '{"plans":[{"tpl":"模板 id","theme":"这张图讲什么（4 个字以内）","slots":{"格子 key":"文字"},"icons":{"图标 key":"描述"}}]}',
  ].filter((x) => x !== "").join("\n");
};

/** 出图（给定版式）：说明卡 + 线框图 + 填好的字 */
ST.P.posterFromTpl = (p, plan, o = {}) => {
  const t = ST.posterTpl(plan.tpl);
  const pal = (t.palettes[plan.palette || 0] || t.palettes[0])[1];
  const ban = ST.banList(p.posterBan);
  const lines = t.slots.map(([k, n]) => [n, String((plan.slots || {})[k] || "").trim()]).filter(([, v]) => v);
  const n = o.refs || 0;
  return [
    "Generate one image: a square 1:1 Chinese e-commerce main image (Taobao / Tmall listing image), designed by a top professional e-commerce designer.",
    `- The ${n ? "LAST" : "FIRST"} uploaded image is the LAYOUT WIREFRAME of the fixed template "${t.name}": follow its structure exactly — the same zones, positions, proportions, sizes and element types. Its texts are placeholder labels only: NEVER copy them.`,
    n ? `- The first ${n} uploaded image${n > 1 ? "s are" : " is"} the shop's style reference: borrow polish, mood and details, but keep the template's layout.` : "",
    o.icon ? "- One uploaded image (right before the wireframe) is the shop's own logo / icon: use it as is in the icon area, do not redraw it." : "",
    `- DESIGN CARD — style: ${t.style}`,
    `- DESIGN CARD — layout (percent of image height, top to bottom): ${t.layout}`,
    `- Color palette: ${pal}.`,
    `- Avoid: ${t.avoid}.`,
    ...(t.icons || []).map(([k, nm]) => ((plan.icons || {})[k] ? `- Icon / illustration for "${nm}": ${(plan.icons || {})[k]} (no text inside icons).` : "")),
    "- Texts — render EXACTLY these Simplified Chinese texts in their slots, character for character, and no other words anywhere:",
    ...lines.map(([nm, v]) => `  · ${nm}：「${v}」`),
    plan.note ? `- Extra notes from the shop (Chinese): ${plan.note}` : "",
    "- Every character must be correct and complete: no typos, no missing strokes, no garbled or made-up characters, no extra English, no watermark.",
    `- Never add any of these words: ${ban.join(", ")}.`,
    "- Mobile one-glance: the main headline is the biggest, boldest element; every text is bold and high-contrast and readable on a phone.",
    "Reply with the image only.",
  ].filter(Boolean).join("\n");
};

/** 自由发挥：不定版式，只给风格、要表达的内容、禁止词（参考图可选） */
ST.P.posterFree = (p, it, o = {}) => {
  const ban = ST.banList(p.posterBan);
  const t = ST.posterTpl(p.freeStyle);
  const content = String(p.posterContent != null ? p.posterContent : [p.industry, p.posterNote].filter(Boolean).join("；")).trim();
  const th = ST.POSTER_THEMES[it.theme || 0] || ST.POSTER_THEMES[0];
  return [
    "Generate one image: a square 1:1 Chinese e-commerce main image (Taobao / Tmall listing image), designed by a top professional e-commerce designer.",
    `- What the shop sells / wants to say (Chinese): ${content || "see the reference image"}`,
    o.refs ? `- The uploaded image${o.refs > 1 ? "s are" : " is"} the style reference: follow ${o.refs > 1 ? "their" : "its"} visual style, layout feel and copywriting density; write NEW copy for this shop (do not copy other shops' names, brands or prices).` : "",
    t ? `- Wanted style: ${t.style}` : p.freeStyleText ? `- Wanted style (Chinese): ${p.freeStyleText}` : "",
    `- This image's focus: ${th.en}`,
    "- Copy: direct and concrete (what service + which product as the headline; versions, platforms, one-to-one, refund promise as selling points); a real after-sales promise like \"安装不成功全额退款\" is fine.",
    `- Never use: ${ban.join(", ")}; no contact details, no other brands.`,
    "- Every Chinese character must be correct and complete; the headline is the biggest, boldest element; readable on a phone.",
    "Reply with the image only.",
  ].filter(Boolean).join("\n");
};
