/**
 * 详情页工作室 · 发给 AI 的话（提示词）和默认提纲
 *
 * 文字类任务都要求 AI “只回复一个 JSON 代码块”，回来以后用 ST.extractJson 解析。
 * 画图类任务都是英文提示词：只画背景 / 场景，不画字、不画产品（产品和字由程序贴上去）。
 */
var ST = globalThis.ST || (globalThis.ST = {});
ST.P = (() => {
  const L = (code) => ST.lang(code).ai;
  const tone = (p) => ST.TONES[p.tone] || ST.TONES.minimal;
  const pf = (p) => ST.platformOf(p, p.platform);
  const isEn = (code) => !/^(zh|ja|ko)/.test(code);
  const lenHint = (code, zh, en) => (isEn(code) ? en : zh);

  /** 素材编号：按素材列表的顺序，从 1 开始 */
  const assetLabel = (p, a) => `素材${p.assets.indexOf(a) + 1}（${ST.tagName(a.tag)}${a.group ? "·" + a.group : ""}${a.note ? "：" + a.note : ""}）`;

  function brief(p) {
    const i = p.info || {};
    const lines = [];
    const add = (k, v) => { if (v && String(v).trim()) lines.push(`${k}：${String(v).trim()}`); };
    add("产品名称", i.name);
    add("类目", i.category);
    add("品牌", i.brand);
    add("材质", i.material);
    const d = i.dims || {};
    if (d.w || d.h || d.l) lines.push(`尺寸：${[d.l && "长 " + d.l, d.w && "宽 " + d.w, d.h && "高 " + d.h].filter(Boolean).join("，")} ${d.unit || "cm"}`);
    add("尺寸说明", i.size);
    add("重量", i.weight);
    add("颜色/规格", i.colors);
    add("包装清单", i.package);
    add("适用人群", i.audience);
    add("使用场景", i.scenes);
    add("其他说明", i.extra);
    const params = (i.params || []).filter((r) => r.k && r.v);
    if (params.length) lines.push("参数表：" + params.map((r) => `${r.k}：${r.v}`).join("；"));
    const pts = (p.points || []).filter((x) => x.on && x.text);
    if (pts.length) lines.push("卖点（已确认，按重要程度排序）：\n" + pts.map((x, n) => `  ${n + 1}. ${x.text}`).join("\n"));
    const notes = p.assets.filter((a) => a.note);
    if (notes.length) lines.push("图片说明：" + notes.map((a) => assetLabel(p, a)).join("；"));
    if (p.reviews && p.reviews.concerns && p.reviews.concerns.length) lines.push("买家最在意的点（来自评价）：" + p.reviews.concerns.map((c) => c.text).join("；"));
    return lines.join("\n") || "（用户没有填写产品信息，请根据图片判断）";
  }
  const RULES_ZH = "不要编造参数、认证、销量、获奖；不要用“最、第一、顶级、100%”这类绝对化用语；不要写价格、促销、运费。";
  const JSON_ONLY = "只回复一个 JSON 代码块，不要其他文字。";

  function tplCatalog(p, only) {
    const land = !!pf(p).h;
    return ST.TPL_ORDER.filter((id) => !only || only.includes(id)).map((id) => {
      const t = ST.TPL[id];
      const texts = (t.texts || []).map((x) => `${x.key}=${x.name}${x.max ? `（≤${x.max}字）` : ""}`).join("，");
      const it = t.items ? `；items ${t.items.min}～${t.items.max} 项（${t.items.name}），每项字段：${t.items.fields.join("/")}${t.items.asset ? "/image" : ""}${t.items.icon ? "/icon" : ""}` : "";
      const slots = (t.slots || []).length ? `；图片位：${t.slots.map((s) => `${s.key}=${s.name}`).join("，")}` : "";
      return `- ${id}：${t.name}——${t.desc}。文字：${texts}${it}${slots}${t.bg === "ai" ? "；背景由 AI 画" : ""}`;
    }).join("\n") + (land ? "\n（这个平台是横版固定尺寸模块，每屏文字要更少）" : "");
  }

  return {
    brief,
    assetLabel,

    /** 补充卖点 */
    suggestPoints(p, n = 5) {
      const have = (p.points || []).map((x) => x.text).filter(Boolean);
      return [
        `你是资深电商详情页文案。根据下面的产品信息（和附带的产品图片），补充 ${n} 个新的卖点，不要和已有卖点重复。`,
        `语言：${L(p.lang)}。风格：${tone(p).zh}。每个卖点一句话，${lenHint(p.lang, "不超过 16 个字", "no more than 8 words")}，要具体、讲买家能得到的好处。${RULES_ZH}`,
        "【产品信息】", brief(p),
        have.length ? "【已有卖点】\n" + have.join("\n") : "",
        `${JSON_ONLY}格式：{"points":["卖点1","卖点2"]}`,
      ].filter(Boolean).join("\n");
    },
    /** 润色卖点 */
    polishPoints(p, list) {
      return [
        `你是资深电商详情页文案。把下面 ${list.length} 个卖点润色得更简洁有力，保持原意和顺序，一条对应一条。`,
        `语言：${L(p.lang)}。风格：${tone(p).zh}。每条${lenHint(p.lang, "不超过 16 个字", "no more than 8 words")}。${RULES_ZH}`,
        "【卖点】", list.map((t, n) => `${n + 1}. ${t}`).join("\n"),
        `${JSON_ONLY}格式：{"points":["…"]}`,
      ].join("\n");
    },
    /** 从评价 / 问大家里挖卖点 */
    reviewPoints(p, text) {
      return [
        "下面是一个商品（或同类商品）的买家评价和问答。请：",
        "1. 总结买家最在意、最担心的 5～8 点（concerns），按提到的次数从多到少，count 写大概提到几次；",
        `2. 针对这些点写 3～6 个卖点建议（points），一句话，回应买家的顾虑；只写下面产品信息里有依据、产品真的能做到的。语言：${L(p.lang)}，${lenHint(p.lang, "每条不超过 16 个字", "no more than 8 words each")}。${RULES_ZH}`,
        "【产品信息】", brief(p),
        "【评价和问答】", String(text).slice(0, 8000),
        `${JSON_ONLY}格式：{"concerns":[{"text":"担心肩带勒肩","count":12}],"points":["加厚肩带，背久不勒"]}`,
      ].join("\n");
    },
    /** 分析参考详情图（一次发几屏） */
    analyzeRef(p, from, count) {
      return [
        `这 ${count} 张图是一个电商详情页按屏切开的参考图（第 ${from}～${from + count - 1} 屏，按顺序）。逐张说明：`,
        "purpose：这一屏讲什么（中文，10 个字以内）；template：最接近下面哪个模板（填 id）；layout：排版方式（中文一句话）；colors：主要配色 2～3 个十六进制色号；style：画面风格（英文短语，用来画背景，不要提产品和文字）。",
        "只学排版和风格，不要照抄文字和图片。",
        "【可用模板】", tplCatalog(p),
        `${JSON_ONLY}格式：{"screens":[{"i":${from},"purpose":"首屏海报","template":"hero","layout":"产品居中，标题在上","colors":["#f5f5f5","#222222"],"style":"soft beige studio, warm light"}]}`,
      ].join("\n");
    },
    /** 列提纲 + 写文案（主语言） */
    outline(p, o = {}) {
      const pl = pf(p);
      const ref = p.ref && p.ref.analysis && p.ref.analysis.length ? p.ref.analysis : null;
      const assets = p.assets.length ? p.assets.map((a) => assetLabel(p, a)).join("；") : "（没有素材）";
      const fixed = o.structure && o.structure.length ? o.structure : null;
      const hasTag = (t) => p.assets.some((a) => a.tag === t);
      return [
        `你是资深电商详情页策划和文案。请为下面的产品规划一套详情页。平台：${pl.name}；语言：${L(p.lang)}；风格：${tone(p).zh}。`,
        "【产品信息】", brief(p),
        "【可用素材】", assets,
        "【可用模板】", tplCatalog(p),
        ref ? "【参考详情页的结构（按顺序）】\n" + ref.map((r, n) => `第${n + 1}屏：${r.template || "?"}，${r.purpose || ""}，${r.layout || ""}`).join("\n") : "",
        "【要求】",
        fixed ? `- 必须严格按这个结构，一屏对应一屏：${fixed.map((t, n) => `第${n + 1}屏 ${t}`).join("，")}。` : `- 一共 ${ref ? ref.length + " 屏左右，按参考详情页的顺序，模板选最接近的" : "7～10 屏"}；第一屏用 hero。`,
        `- params 只在有参数表时用；size 只在有尺寸时用；colors 只在有规格图时用（${hasTag("spec") ? "有" : "没有"}）；package 只在有包装图时用（${hasTag("package") ? "有" : "没有"}）。${pl.id.startsWith("amazon") ? "亚马逊不要用 service（不能写售后、运费承诺）。" : ""}`,
        `- 文案用${L(p.lang)}，简短有力：标题${lenHint(p.lang, "不超过 14 个字", "no more than 6 words")}，说明${lenHint(p.lang, "不超过 40 个字", "no more than 20 words")}。${RULES_ZH}`,
        "- 卖点按“已确认的卖点”的顺序安排，最重要的放前面。",
        "- 每屏 bg 写一句英文的背景画面描述：场景、材质、光线；不要出现产品、文字、人物；整套风格统一。",
        "- image / main 写素材编号（数字），没有合适的写 0。icon 从这些里选：" + Object.keys(ST.ICONS).join(","),
        "- compare 的 items：title 写我们的优点，desc 写普通款的问题；left / right 是两列的标题。",
        `${JSON_ONLY}格式：`,
        '{"screens":[{"template":"hero","purpose":"首屏","title":"…","sub":"…","main":1,"items":[{"title":"…","desc":"…","image":2,"icon":"shield"}],"bg":"soft beige marble surface, warm morning light"}]}',
      ].filter(Boolean).join("\n");
    },
    /** 某一屏重新写文案 */
    rewriteScreen(p, screen) {
      const t = ST.TPL[screen.tpl];
      const cur = {};
      (t.texts || []).forEach((x) => (cur[x.key] = ST.tr(screen.text && screen.text[x.key], p.lang, p.lang).text));
      cur.items = (screen.items || []).map((it) => Object.fromEntries((t.items ? t.items.fields : []).map((f) => [f, ST.tr(it[f], p.lang, p.lang).text])));
      return [
        `你是资深电商详情页文案。重写下面这一屏（模板：${t.name}——${t.desc}）的文案，换一种说法，结构和项数不变。语言：${L(p.lang)}。风格：${tone(p).zh}。${RULES_ZH}`,
        "【产品信息】", brief(p),
        "【当前文案】", JSON.stringify(cur),
        `${JSON_ONLY}格式和当前文案一样。`,
      ].join("\n");
    },
    /** 翻译：map = { key: 原文 } */
    translate(p, map, to) {
      const pl = pf(p);
      return [
        `把下面 JSON 里每个值从${L(p.lang)}翻译成${L(to)}，用于电商详情页（${pl.name}）。`,
        "要求：简短、地道，符合当地电商的说法；品牌名、型号、数字和单位保持原样；不要加解释；标题要和原文一样短（德语、俄语这类较长的语言用更简短的说法）；key 不变，一个都不能少。",
        JSON.stringify(map),
        `${JSON_ONLY}格式：{"t":{"key":"译文"}}`,
      ].join("\n");
    },
    /** 画背景（不画产品、不画字） */
    background(p, screen, ratio, hasStyleRef) {
      const t = ST.TPL[screen.tpl];
      const land = !!pf(p).h;
      const ref = p.ref && p.ref.analysis && screen.refIndex !== undefined ? p.ref.analysis[screen.refIndex] : null;
      return [
        `Generate one image: a background for an e-commerce product detail page section, aspect ratio ${ratio}${ratio === "1:1" ? " (square)" : ""}.`,
        `Scene: ${screen.bg.prompt || "clean studio backdrop"}.`,
        `Composition: ${t.bgHint(land)}`,
        `Style: ${tone(p).en}${ref && ref.style ? "; " + ref.style : ""}${ref && ref.colors && ref.colors.length ? "; color palette " + ref.colors.join(", ") : ""}.`,
        hasStyleRef ? "Match the color palette, lighting and overall style of the attached reference image, but use a different composition suitable for this section." : "",
        "Strict rules: absolutely NO text, letters, numbers, logos, watermarks or UI elements. NO people. Do NOT include any product (the product photo will be added on top later). Photorealistic, high quality, soft and clean.",
        "Text will be placed on the calm areas described above: keep those areas plain, evenly lit and low in detail (one soft tone, no busy patterns or strong highlights) so the text stays readable.",
        "Reply with the image only.",
      ].filter(Boolean).join("\n");
    },
    /** 产品融入场景（AI 把产品画进去，产品可能会变样） */
    blend(p, screen, ratio, hasStyleRef) {
      const t = ST.TPL[screen.tpl];
      const land = !!pf(p).h;
      const name = (p.info && p.info.name) || "";
      return [
        `Generate one image: a photorealistic e-commerce scene, aspect ratio ${ratio}, featuring EXACTLY the product in the first uploaded image${name ? ` (it is "${name}", name in Chinese)` : ""}.`,
        "- Same product: shape, proportions, colors, materials, patterns, text and logos must stay identical; do not redesign it; do not add or remove parts.",
        `- Scene: ${screen.bg.prompt || "clean studio"}.`,
        `- Composition: ${land ? "product on the right half, left half calm for text" : "product in the lower middle, top 30% calm and low-detail for text"}; realistic contact shadow and lighting.`,
        `- Style: ${tone(p).en}.`,
        hasStyleRef ? "- Match the color palette and lighting of the second uploaded image (style reference only)." : "",
        "- Absolutely NO text, letters, logos or watermarks other than what is printed on the product itself. No people.",
        "Reply with the image only.",
      ].filter(Boolean).join("\n");
    },
    /** 抠图：先让 AI 出一张纯白背景、无阴影的图，再由程序去白底 */
    cutout(p, a, ratio) {
      const bgText = typeof T !== "undefined" && T.en && T.en.background ? T.en.background.alpha : "Pure white (RGB 255,255,255) background, no shadows or reflections, crisp clean edges.";
      return [
        `Generate one image: the exact same product from the uploaded image, isolated on a pure white background, aspect ratio ${ratio}.`,
        `- Same product: shape, proportions, structure, colors, materials, patterns, text, logos and number of parts must not change.${p.info && p.info.name ? ` It is "${p.info.name}" (Chinese name).` : ""}`,
        "- Keep the camera angle, perspective and product orientation exactly as in the reference.",
        `- Background: ${bgText}`,
        "- Only remove dust and specks; do not redesign anything. Show the whole product, nothing cropped.",
        a.note ? `- Note (Chinese): ${a.note}` : "",
        "Reply with the image only.",
      ].filter(Boolean).join("\n");
    },
    /** 多角度图：照着上传的产品图，画同一个产品的另一个角度（白底，程序再去白底） */
    angleView(p, a, angle, ratio) {
      const A = ST.ANGLES.find((x) => x.id === angle) || ST.ANGLES[0];
      const name = (p.info && p.info.name) || "";
      return [
        `Generate one image: the exact same product as in the uploaded image, shown from a different camera angle: ${A.en}. Aspect ratio ${ratio}.`,
        `- Same product: shape, proportions, structure, colors, materials, patterns, printed text, logos and number of parts must stay identical; do not redesign it.${name ? ` It is "${name}" (Chinese name).` : ""}`,
        "- Infer hidden sides sensibly from the visible design (same material and color); do not invent new decorations, text or logos.",
        "- Pure white (RGB 255,255,255) background, soft even studio light, no shadows or reflections on the background, crisp clean edges.",
        "- Show the whole product, centered, nothing cropped. No people, no props, no text.",
        a.note ? `- Note about the uploaded photo (Chinese): ${a.note}` : "",
        "Reply with the image only.",
      ].filter(Boolean).join("\n");
    },
    /** 细节特写：第 1 张图上红框圈出的地方，第 2 张是那块放大 */
    closeUp(p, note, ratio) {
      const name = (p.info && p.info.name) || "";
      return [
        `Generate one image: a photorealistic macro close-up photo of the area outlined in red in the first uploaded image (the second uploaded image is that area enlarged). Aspect ratio ${ratio}.`,
        `- It is the same product${name ? ` ("${name}", Chinese name)` : ""}: keep exactly the same material, texture, color, stitching, pattern, printed text and logos of that area; do not redesign it.`,
        "- Show that part as a close-up product cut-out filling most of the frame, sharp focus, soft even studio light.",
        "- Background: pure white (RGB 255,255,255), no shadows or reflections on the background, crisp clean edges (the white will be removed by a program afterwards).",
        "- Do NOT draw the red outline. No people, no added text, no watermark.",
        note ? `- What this detail is (Chinese): ${note}` : "",
        "Reply with the image only.",
      ].filter(Boolean).join("\n");
    },
    /** 融入背景（B 方式）：程序已经把产品贴好了，AI 只调光影 */
    harmonize(p, ratio) {
      const name = (p.info && p.info.name) || "";
      return [
        `Edit the uploaded image and return the whole edited image, aspect ratio ${ratio}. It is an e-commerce picture: a product${name ? ` ("${name}", Chinese name)` : ""} was pasted onto a background photo, so it looks stuck on.`,
        "Make it look like one real photo:",
        "- Add realistic contact shadows and cast shadows that match the light direction of the background; add subtle reflections if the surface is glossy.",
        "- Adjust the product's lighting, color temperature and edge blending slightly to match the scene; ambient light may spill onto the product.",
        "- Clean up cut-out leftovers: remove white fringes around the product edges and white patches inside openings (e.g. inside a wrist strap loop or handle) so the background shows through.",
        "Strict rules:",
        "- Do NOT change the product: same position, size, angle, shape, proportions, colors, materials, patterns, printed text and logos. Do not redraw or redesign it, do not add or remove parts.",
        "- Keep the composition, framing and the background content the same. Do not crop, zoom or move anything.",
        "- Do not add any text, letters, logos, watermarks, people or other products.",
        "Reply with the image only.",
      ].filter(Boolean).join("\n");
    },
    /** 主图背景：空场景，中间留出放产品的地方（产品由程序贴上去） */
    mainBg(p, style, hasRef) {
      return [
        "Generate one image: an empty background scene for an e-commerce main product photo, square 1:1.",
        `- Scene: ${style}.`,
        "- Composition: a surface, table or podium in the center where a product will be placed later; the center area must be EMPTY (no objects there); camera at product height with a slight high angle; soft realistic lighting, shallow depth of field in the far background.",
        hasRef ? "- Match the background style, colors, materials and lighting of the uploaded reference image. Do NOT copy any product, text or logo from it." : "",
        "- Absolutely NO products, NO text, letters, numbers, logos or watermarks, NO people. Photorealistic, high quality.",
        "Reply with the image only.",
      ].filter(Boolean).join("\n");
    },
    /** 看一张图，说出它的背景风格（存成“我的风格”） */
    styleOf() {
      return [
        "这是一张电商主图或场景图。请只看它的背景（不管里面的产品），总结背景风格，给 AI 画图用。",
        "name：风格名称，中文，6 个字以内；desc：中文描述，30 个字以内（场景、台面材质、光线、颜色、氛围）；",
        "prompt：英文，40 个词以内，描述背景场景、台面 / 展台、光线、配色和氛围，给画图 AI 用，不要提到产品、文字、logo。",
        '只回复一个 JSON 代码块，格式：{"name":"","desc":"","prompt":""}',
      ].join("\n");
    },
    /** 审核：原贴图和 AI 调光影后的图，哪张好（Lee 2026-10-24：抠图残留的白边、白块被 AI 去掉算变好） */
    pickBetter(p) {
      const name = (p.info && p.info.name) || "";
      return [
        "第 1 张是原贴图：产品是程序从白底图抠出来、直接贴到背景上的。抠图可能残留白边、镂空处（比如手腕绳、提手围成的圈里）的白块，产品看起来像“贴上去的”。",
        "第 2 张是 AI 调整光影后的图。",
        `请判断哪张更适合当电商图片${name ? `（产品是：${name}）` : ""}。`,
        "- 第 2 张如果去掉了抠图残留的白边、白块，或者阴影、反光、光线更自然、产品和背景融为一体，这是变好了，选 2。",
        "- 只有这些情况才算第 2 张不好、选 1：产品被换成别的东西；logo、文字变了或错了；零件少了或多了；形状、比例明显变了；产品颜色明显变了；画面有明显的瑕疵或变形。",
        '只回复一个 JSON 代码块，格式：{"better":2,"why":"理由"}。better 填 1 或 2；why 用中文说清楚为什么（选 1 的话说清楚第 2 张哪里不对）。',
      ].join("\n");
    },
    /** AI 直接画场景（把抠好的透明 PNG 发给 AI，一步画出带产品的场景图） */
    /** placement：free = AI 自由摆放；same = 和产品图一样的角度朝向；ref = 照第 2 张图里的摆法（Lee 2026-10-24） */
    mainScene(p, style, placement = "free", hasStyleRef) {
      const name = (p.info && p.info.name) || "";
      const place = {
        free: "- Placement: you may choose a natural, attractive way to place the product (standing, lying flat, slightly angled, etc.) and a pleasing camera angle; the product itself must stay identical.",
        same: "- Placement: keep the product's orientation, viewing angle and pose exactly as in the uploaded product image; do not rotate it, lay it down or show it from another side.",
        ref: "- Placement: place the product in the same pose, orientation, camera angle and position in the frame as in the SECOND uploaded image (placement reference only — use the new scene below, not that background).",
      }[placement] || "";
      return [
        "Generate one image: a photorealistic e-commerce main product photo, square 1:1, featuring EXACTLY the product in the first uploaded image (the product, cut out and placed on a plain white background or photographed on white; that background is NOT part of the product and must be replaced by the new scene; white or light areas inside the product, such as clear lamp lenses, glass, chrome and reflections, ARE part of the product and must keep their real look — never turn them into dark spots or holes).",
        `- Same product${name ? ` ("${name}", Chinese name)` : ""}: shape, proportions, colors, materials, patterns, printed text, logos and number of parts must stay identical; do not redesign it. Remove any leftover white fringes from the cut-out.`,
        `- Scene: ${style}.`,
        place,
        "- Composition: the product large (about 85% of the frame) and the clear focus, realistic contact shadows, reflections and lighting matching the scene.",
        hasStyleRef ? `- Match the background style, colors and lighting of the ${placement === "ref" ? "THIRD" : "SECOND"} uploaded image (style reference only; do not copy anything from it).` : "",
        "- Absolutely NO text, letters, logos or watermarks other than what is printed on the product itself. No people, no other products.",
        "Reply with the image only.",
      ].filter(Boolean).join("\n");
    },
    /**
     * 照参考图设计（Lee 2026-10-27）：虚拟产品 / 纯文字主图。参考图只学风格 + 排版，文字由 AI 按行业自己写；
     * 手机上“一眼见”：大标题够大、字少、对比强；避开广告法违禁词和过度承诺。
     */
    mainPoster(p, it) {
      const th = ST.POSTER_THEMES[it.theme || 0] || ST.POSTER_THEMES[0];
      const n = (p.posterRefs || []).length || 1;
      const note = String(p.posterNote || "").trim();
      return [
        `Generate one image: a square 1:1 e-commerce main image (Taobao / Tmall product listing image) for this business: "${String(p.industry || "").trim()}" (written in Chinese).`,
        `- The uploaded image${n > 1 ? "s are" : " is"} a STYLE AND LAYOUT REFERENCE ONLY. Follow ${n > 1 ? "their" : "its"} visual style (color scheme, font weight and feel, decorations, icons, background treatment) and ${n > 1 ? "their" : "its"} layout structure (where the headline, sub-headline, tag pills, bottom banner and icons sit, and how big they are).`,
        "- Do NOT copy any words, numbers, logos, brand names, mascots or prices from the reference. Write NEW, natural Simplified Chinese copy that fits this business.",
        note ? `- Information the shop wants to use (Chinese; use only what fits, keep it short): ${note}` : "",
        `- This image's focus: ${th.en}`,
        "- Mobile one-glance readability: the main headline is by far the biggest element, 1-2 lines of at most 8 Chinese characters each, spanning about 70% of the width; no more than 4 text blocks and about 30 Chinese characters in total; very strong contrast between text and background; no small or dense text; everything must still be readable when the image is shown only 200 pixels wide on a phone.",
        "- Text quality: every Chinese character must be correct, complete and standard Simplified Chinese — no typos, no missing strokes, no garbled or made-up characters, no fake English filler, no watermark.",
        "- Advertising-law compliance (China): no absolute or superlative words (最, 第一, 首个, 唯一, 顶级, 极致, 国家级, 世界级, 全网, 100%, 绝对, 永久, 万能, 独家); no over-promises or guarantees of results (保证, 包过, 包会, 根治, 立即见效, 无效退款, 零风险, 稳赚, 秒杀全网); no medical or financial claims; no made-up prices, discounts or sales numbers; no contact details (微信, QQ, phone numbers, website addresses); no other brands' names or logos.",
        "Reply with the image only.",
      ].filter(Boolean).join("\n");
    },
    /** 审核“照参考图设计”的主图：读出图上的字，查违禁词、过度承诺、错字、手机上看不看得清 */
    posterCheck(p) {
      return [
        `这是一张电商主图（行业：${String(p.industry || "").trim() || "未填"}），图上的字是 AI 画的。请：`,
        "1. 把图上所有文字按顺序读出来；",
        "2. 检查有没有广告法违禁词（最、第一、唯一、顶级、极致、国家级、全网、100%、绝对、永久、万能等）和过度承诺（保证、包过、根治、立即见效、零风险、无效退款等），有没有联系方式（微信、QQ、电话、网址）；",
        "3. 检查有没有错别字、缺笔画、乱码字；",
        "4. 在手机上缩成小图时，大标题能不能一眼看清。",
        '只回复一个 JSON 代码块，格式：{"ok":true,"text":"图上的字","bad":["有问题的词或字"],"why":"理由"}。有任何一项不合格 ok 就是 false，why 用中文说清楚。',
      ].join("\n");
    },
    /** 审核“AI 直接画”的场景图：产品有没有被改 */
    sceneCheck(p) {
      const name = (p.info && p.info.name) || "";
      return [
        `第 1 张是产品原图（抠好的产品${name ? `：${name}` : ""}），第 2 张是 AI 照着它画的电商场景图。`,
        "请判断第 2 张里的产品是不是同一个产品：形状、比例、颜色、材质、logo 和文字、零件数量有没有被改；去掉白边、加阴影反光不算改。",
        '只回复一个 JSON 代码块，格式：{"ok":true,"why":"理由"}。ok 为 false 时，why 用中文说清楚哪里被改了。',
      ].join("\n");
    },
  };
})();

/** 照参考图设计：一套 1～6 张，每张一个重点（主图的常见分工） */
ST.POSTER_THEMES = [
  { name: "核心卖点", en: "the hero image — what the product or service is and the single strongest reason to choose it (this is the click-attracting first image)." },
  { name: "服务内容", en: "what is included or which options are available (e.g. versions, packages), shown as a few short tags or icons." },
  { name: "流程步骤", en: "how simple it is — 3 or 4 short numbered steps with small icons." },
  { name: "售后保障", en: "after-sales support and trust — what happens if something goes wrong, response time, support period (stated factually, no guarantees of results)." },
  { name: "适用人群", en: "who it is for / which common problems it solves, as 3 or 4 short scenarios." },
  { name: "主图变体", en: "an alternative version of the hero image with a different headline wording and a different accent color, same overall style." },
];

/** 多角度图可选的角度（Lee 2026-10-23） */
ST.ANGLES = [
  { id: "front", name: "主视图", en: "straight-on front view, camera at product height" },
  { id: "left", name: "左视图", en: "left side view (camera on the product's left, 90 degrees from the front)" },
  { id: "right", name: "右视图", en: "right side view (camera on the product's right, 90 degrees from the front)" },
  { id: "back", name: "后视图", en: "back view (camera behind the product, 180 degrees from the front)" },
  { id: "top", name: "俯视图", en: "top-down view (camera directly above, looking down)" },
  { id: "bottom", name: "底视图", en: "bottom view (camera directly below, looking up at the underside / sole / base of the product)" },
  { id: "45", name: "45°侧面", en: "three-quarter view, 45 degrees between front and side, camera slightly above" },
];

/** 平台：用户在“平台设置”里改过的尺寸优先 */
ST.platformOf = (project, id) => {
  const base = ST.PLATFORMS.find((x) => x.id === id) || ST.PLATFORMS[0];
  const custom = (ST.platformOverrides || {})[id];
  return custom ? { ...base, ...custom } : base;
};

/** 新建一屏（模板默认结构） */
ST.newScreen = (tplId) => {
  const t = ST.TPL[tplId];
  const sc = { id: ST.uid("s"), tpl: tplId, purpose: t.name, text: {}, items: [], slots: {}, bg: { mode: t.bg === "ai" ? "ai" : "color", prompt: "", key: "", blend: false }, ov: {}, shadow: { dir: "b", op: 0.35 } };
  if (t.items) for (let i = 0; i < t.items.def; i++) sc.items.push({ id: ST.uid("i"), title: {}, desc: {}, asset: "", icon: "" });
  return sc;
};

/** 给空着的图片位自动配素材（按标签） */
ST.assignAssets = (project, screens) => {
  const by = (tags) => project.assets.filter((a) => tags.includes(a.tag));
  const used = new Set();
  const take = (tags, allowUsed) => {
    const list = by(tags);
    const a = list.find((x) => !used.has(x.id)) || (allowUsed ? list[0] : null);
    if (a) used.add(a.id);
    return a ? a.id : "";
  };
  const mainId = () => (by(["white"])[0] || by(["angle"])[0] || project.assets[0] || {}).id || "";
  for (const sc of screens) {
    const t = ST.TPL[sc.tpl];
    for (const s of t.slots || []) {
      if (sc.slots[s.key]) continue;
      if (s.key === "main" || s.key === "right") sc.slots[s.key] = sc.tpl === "size" ? (by(["size"])[0] || {}).id || mainId() : mainId();
    }
    if (t.items && t.items.asset) {
      const tags = t.items.assetTags || ["detail"];
      sc.items.forEach((it) => { if (!it.asset) it.asset = take(tags, sc.tpl !== "features3" && sc.tpl !== "features4"); });
    }
  }
  return screens;
};

/** 不用 AI：按常用顺序排一套，文字取自产品信息和卖点 */
ST.defaultOutline = (project) => {
  const m = project.lang;
  const v = (s) => ({ [m]: s || "" });
  const zh = /^zh/.test(m);
  const pts = (project.points || []).filter((x) => x.on && x.text).map((x) => x.text);
  const has = (tag) => project.assets.some((a) => a.tag === tag);
  const info = project.info || {};
  const pl = ST.platformOf(project, project.platform);
  const out = [];
  const add = (tpl, fill) => { const sc = ST.newScreen(tpl); fill(sc); out.push(sc); };
  add("hero", (sc) => { sc.text.title = v(info.name || (zh ? "产品名称" : "Product Name")); sc.text.sub = v(pts[0] || ""); sc.items = sc.items.slice(0, Math.min(3, pts.length)); sc.items.forEach((it, i) => (it.title = v(pts[i] || ""))); });
  if (pts.length >= 2) add("features3", (sc) => { sc.text.title = v(zh ? "核心卖点" : "Key Features"); sc.items = sc.items.slice(0, Math.min(3, pts.length)); sc.items.forEach((it, i) => { it.title = v(pts[i] || ""); it.icon = ["sparkle", "shield", "thumb"][i]; }); });
  if (pts[3]) add("feature", (sc) => { sc.text.title = v(pts[3]); });
  if (has("detail")) add("callout", (sc) => { sc.text.title = v(zh ? "细节展示" : "Details"); const d = project.assets.filter((a) => a.tag === "detail").slice(0, 3); sc.items = sc.items.slice(0, Math.max(1, d.length)); sc.items.forEach((it, i) => { it.title = v((d[i] && d[i].note) || ""); it.asset = (d[i] && d[i].id) || ""; }); });
  if (project.assets.filter((a) => a.tag === "angle").length >= 2) add("angles", (sc) => { sc.text.title = v(zh ? "多角度展示" : "All Angles"); const d = project.assets.filter((a) => a.tag === "angle").slice(0, 4); sc.items = d.map((a) => ({ id: ST.uid("i"), title: v(a.note || ""), desc: {}, asset: a.id, icon: "" })); });
  if (has("spec")) add("colors", (sc) => { sc.text.title = v(zh ? "颜色可选" : "Colors"); const d = project.assets.filter((a) => a.tag === "spec").slice(0, 9); sc.items = d.map((a) => ({ id: ST.uid("i"), title: v(a.group || a.note || ""), desc: {}, asset: a.id, icon: "" })); });
  add("scene", (sc) => { sc.text.title = v(info.scenes ? info.scenes.split(/[，,、;；]/)[0] : zh ? "使用场景" : "In Use"); sc.text.sub = v(pts[4] || ""); });
  if ((info.params || []).some((r) => r.k && r.v)) add("params", (sc) => { sc.text.title = v(zh ? "产品参数" : "Specifications"); });
  if (info.dims && (info.dims.w || info.dims.h)) add("size", (sc) => { sc.text.title = v(zh ? "产品尺寸" : "Dimensions"); sc.text.note = v(zh ? "手工测量，存在 1～2 cm 误差" : "Measured by hand, allow 1-2 cm difference"); });
  if (has("package")) add("package", (sc) => { sc.text.title = v(zh ? "包装清单" : "What's in the Box"); const d = project.assets.filter((a) => a.tag === "package").slice(0, 8); sc.items = d.map((a) => ({ id: ST.uid("i"), title: v(a.note || ""), desc: {}, asset: a.id, icon: "" })); });
  if (!pl.id.startsWith("amazon")) add("service", (sc) => {
    const list = zh ? [["品质保障", "严格质检，放心购买", "shield"], ["快速发货", "下单后尽快发出", "truck"], ["贴心客服", "有问题随时联系", "headset"], ["安心退换", "按平台规则退换", "refresh"]]
      : [["Quality Checked", "Every item inspected", "shield"], ["Fast Dispatch", "Ships quickly", "truck"], ["Friendly Support", "Here to help", "headset"], ["Easy Returns", "Per platform policy", "refresh"]];
    sc.text.title = v(zh ? "购物保障" : "Shop with Confidence");
    sc.items = list.map(([a, b, ic]) => ({ id: ST.uid("i"), title: v(a), desc: v(b), asset: "", icon: ic }));
  });
  return ST.assignAssets(project, out);
};

/** AI 回来的提纲 → 屏幕列表 */
ST.screensFromOutline = (project, data) => {
  const m = project.lang;
  const v = (s) => ({ [m]: String(s ?? "") });
  const assetAt = (n) => { const a = project.assets[(Number(n) || 0) - 1]; return a ? a.id : ""; };
  const list = (data && data.screens) || [];
  const out = [];
  // AI 没写项目的屏（比如首屏的小标签）用已确认的卖点补上，免得出现空的框
  const pts = (project.points || []).filter((x) => x.on && x.text).map((x) => x.text);
  let pi = 0;
  list.forEach((s, idx) => {
    const id = ST.TPL[s.template] ? s.template : "features3";
    const t = ST.TPL[id];
    const sc = ST.newScreen(id);
    sc.purpose = s.purpose || t.name;
    for (const x of t.texts || []) if (s[x.key] !== undefined) sc.text[x.key] = v(s[x.key]);
    if (t.items) {
      const items = Array.isArray(s.items) ? s.items : [];
      const n = Math.max(t.items.min, Math.min(t.items.max, items.length || t.items.def));
      sc.items = Array.from({ length: n }, (_, i) => {
        const it = items[i] || {};
        return { id: ST.uid("i"), title: v(it.title || (items.length ? "" : pts[pi++] || "")), desc: v(it.desc), asset: t.items.asset ? assetAt(it.image) : "", icon: ST.ICONS[it.icon] ? it.icon : "" };
      });
    }
    if (s.main) sc.slots.main = assetAt(s.main);
    if (id === "compare" && s.main) sc.slots.right = assetAt(s.main);
    sc.bg.prompt = String(s.bg || "");
    if (project.ref && project.ref.analysis && project.ref.analysis[idx]) sc.refIndex = idx;
    out.push(sc);
  });
  return ST.assignAssets(project, out);
};

/** 把一屏里所有要翻译的文字列出来：{ key: 原文 } */
ST.textsOf = (project) => {
  const m = project.lang;
  const map = {};
  project.screens.forEach((sc, si) => {
    for (const [k, v] of Object.entries(sc.text || {})) if (v && v[m]) map[`${si}.${k}`] = v[m];
    (sc.items || []).forEach((it, ii) => {
      for (const f of ["title", "desc"]) if (it[f] && it[f][m]) map[`${si}.i${ii}.${f}`] = it[f][m];
    });
  });
  (project.info.params || []).forEach((r, i) => { if (r.k) map[`p${i}.k`] = r.k; if (r.v) map[`p${i}.v`] = r.v; });
  return map;
};
/** 翻译结果写回去；onlyMissing = 只填还没有译文的 */
ST.applyTranslation = (project, lang, t) => {
  for (const [key, val] of Object.entries(t || {})) {
    if (typeof val !== "string") continue;
    let m;
    if ((m = /^p(\d+)\.(k|v)$/.exec(key))) {
      project.info.tr = project.info.tr || {};
      project.info.tr[lang] = project.info.tr[lang] || {};
      project.info.tr[lang][key] = val;
    } else if ((m = /^(\d+)\.i(\d+)\.(title|desc)$/.exec(key))) {
      const it = project.screens[+m[1]] && project.screens[+m[1]].items[+m[2]];
      if (it) { it[m[3]] = it[m[3]] || {}; it[m[3]][lang] = val; }
    } else if ((m = /^(\d+)\.(\w+)$/.exec(key))) {
      const sc = project.screens[+m[1]];
      if (sc) { sc.text[m[2]] = sc.text[m[2]] || {}; sc.text[m[2]][lang] = val; }
    }
  }
};
/** 还缺哪些译文 */
ST.missingTexts = (project, lang) => {
  const all = ST.textsOf(project);
  const out = {};
  for (const [key, val] of Object.entries(all)) {
    let have = "";
    let m;
    if ((m = /^p(\d+)\.(k|v)$/.exec(key))) have = project.info.tr && project.info.tr[lang] && project.info.tr[lang][key];
    else if ((m = /^(\d+)\.i(\d+)\.(title|desc)$/.exec(key))) { const it = project.screens[+m[1]].items[+m[2]]; have = it && it[m[3]] && it[m[3]][lang]; }
    else if ((m = /^(\d+)\.(\w+)$/.exec(key))) { const sc = project.screens[+m[1]]; have = sc.text[m[2]] && sc.text[m[2]][lang]; }
    if (!have) out[key] = val;
  }
  return out;
};

/** 主图的预设背景风格（Lee 2026-10-23；还可以上传图片让 AI 识别风格，存成“我的风格”） */
ST.MAIN_STYLES = [
  { id: "studio", name: "纯色渐变棚拍", prompt: "seamless studio backdrop with a soft color gradient, smooth matte tabletop, soft diffused studio light" },
  { id: "marble", name: "大理石台面", prompt: "white marble tabletop with subtle gray veins, soft window light, clean bright minimal interior background" },
  { id: "wood", name: "木桌居家", prompt: "warm wooden table in a cozy modern home, soft morning sunlight, blurred living room background" },
  { id: "nature", name: "户外自然", prompt: "natural outdoor setting, a flat stone or wooden surface, green plants and soft sunlight, blurred nature background" },
  { id: "podium", name: "简约展台", prompt: "minimal geometric podium in soft pastel colors, simple shapes, soft even light, clean modern backdrop" },
  { id: "festival", name: "节日促销", prompt: "festive promotional scene with a podium, red and gold accents, soft bokeh lights, celebratory mood" },
  { id: "tech", name: "科技感", prompt: "dark high-tech scene, reflective floor, subtle neon blue rim lights, sleek modern mood" },
];

