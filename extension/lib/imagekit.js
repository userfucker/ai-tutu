/**
 * AI图图 · 图片处理共用代码（测试页面 tools/agy-refine-test 和浏览器插件 extension 共用一份）
 *
 * 普通脚本（不是模块），函数直接挂在全局：测试页面用 <script src="/lib/imagekit.js"> 引入，
 * 插件作为 content script 先于其他脚本加载。改这里两边同时生效。
 *
 * 内容：比例 / 尺寸小工具、框选裁图 + 配件标注图 + 配件特写（prepareInput）、
 * 吸管取色换算、白底主体校准（findSubject）、透明底抠图（cutoutWhite）、亮度对比度（adjustTone）、
 * 最终输出（composeOutput）、提示词各段文字（T）、Gemini 网页版提示词（buildWebPrompt）、zip 打包（makeZip）。
 */
/** 填进模板的各段文字（中英文两套）。 */
const T = {
  en: {
    background: {
      white: "Pure white (RGB 255,255,255) clean seamless background; remove everything from the original background, including shadow edges; a subtle natural contact shadow under the product is allowed. The product outline must be crisp and go straight from the product's own color to the white background, with no white or light outline, rim light, glow or halo along the edges.",
      original: "Keep the original background and scene; only clean obvious clutter and stains in the background; do not replace the background.",
      refine: "Keep the original background, scene, lighting and color tone; only remove specks, stains and dust from the background; do not replace it or change the style.",
      custom: "Use the background described in the user note (Chinese). If the user note does not describe a background, keep the original background, scene, lighting and color tone, and only remove specks, stains and dust from it.",
      alpha: "Pure white (RGB 255,255,255) clean background with everything from the original background removed; absolutely no shadows, reflections or cast shadows (it will be cut out to a transparent PNG afterwards); crisp, clean product edges without fringes or halos; every gap between leaves, branches, handles or parts must show the same pure white background. Edges: the product outline must go straight from the product's own color to pure white — no white or light outline, no rim light, no glow, no bright edge line, no light bevel along the silhouette, no blur or feathering, no sharpening halo; dark products must keep a dark edge right up to the background.",
    },
    angle: {
      keep: "Keep the camera angle, perspective, product orientation and placement exactly as in the reference; cables, harnesses and accessories keep their routing and positions; do not rotate, flip or rearrange anything.",
      auto: "Straighten the product: level anything tilted, line up multiple items neatly, and use a standard e-commerce viewing angle that clearly shows the main features.",
      front: "Change to a straight-on front view at eye level; the product is upright and not tilted.",
      45: "Change to an approximately 45-degree elevated three-quarter view that shows both the front and the top; the product is upright.",
      top: "Change to a straight top-down flat-lay view; the product lies flat and square, multiple items neatly aligned.",
      extra: " Parts not visible in the reference must follow the product's real structure; do not invent text, logos or parts.",
    },
    retouch: {
      on: "Remove dust, scratches, blemishes, specks and noise, and also dirt, stains, smudges, oil marks, fingerprints, water spots, rust spots and discoloration: these are defects, not part of the product's patterns or colors, so remove them completely and do not add any new marks, stains or discoloration anywhere; even, soft lighting; realistic material texture; e-commerce main-image quality.",
      off: "Do not retouch the product: keep its surface, texture, wear marks, lighting and colors exactly as in the reference; only change what the background and composition requirements ask for.",
    },
    sharp: {
      keep: "Keep the original level of sharpness; do not add artificial sharpening or invent extra detail.",
      enhance: "Enhance sharpness and fine detail: remove blur, make edges crisp and textures clearly visible, without changing any shapes.",
    },
    compose: (r, fill) => fill === "keep"
      ? `Aspect ratio ${r}. Product size and position follow the reference; show the whole product and do not crop any part.`
      : `Aspect ratio ${r}. The whole product is visible and centered, occupying about ${fill}% of the frame${fill === "85" ? " (fill the frame)" : ""}, with ${fill === "85" ? "small" : "moderate"} margins; do not crop any part.`,
    composeRefine: (r) => `Aspect ratio ${r} (same as the reference). This is a retouch, not a redesign: keep the composition, framing, product position and size exactly unchanged; no cropping or re-composition; do not change the product's colors or lighting style.`,
    look: (n) => (n ? "the original image and the annotation image {{附图1}}" : "the original image"),
    pathsNote: (n, d) => (n
      ? ` (image 1 is the original and the basis for the retouch; image 2 is the accessory annotation image${d ? `; image${d > 1 ? `s 3-${2 + d} are` : " 3 is"} accessory close-up${d > 1 ? "s" : ""}` : ""}; these are references only)`
      : " (the original as the reference image)"),
    call: (r, paths) => `Immediately call invoke_subagent with subagent type image-generator (state this type explicitly in the parameters) and have it call generate_image exactly once to produce exactly one image, with parameters: ImageName: "refined"; AspectRatio: "${r}"; ImagePaths: ${paths}; Prompt: the English description you write after viewing the image (put it in your instructions to the subagent and have it use it verbatim). After delegating, just wait for it to finish: you may use manage_task to check progress; do nothing else.`,
    parts: (n, d, note) => `The ${n} area${n > 1 ? "s" : ""} marked with red numbered boxes in the annotation image ${n > 1 ? "are" : "is"} product accessor${n > 1 ? "ies" : "y"}, not stains or clutter, and must be fully preserved with the same shape, count and relative position.${d ? " The close-up images show their details." : ""} The red boxes and numbers are only markers; never draw them in the output.${note ? ` Accessory note (Chinese; translate faithfully): ${note}` : ""}`,
    partsNoteOnly: (note) => `Accessory note (Chinese; translate faithfully): ${note}. These accessories must be fully preserved; they are not clutter.`,
    partsAt: (list, note) => `The following area${list.length > 1 ? "s" : ""} of the uploaded image contain${list.length > 1 ? "" : "s a"} product accessor${list.length > 1 ? "ies" : "y"}, not stains or clutter, and must be fully preserved with the same shape, count and relative position: ${list.map((p, i) => `${i + 1}) from ${p.l}% to ${p.r}% from the left and ${p.t}% to ${p.b}% from the top`).join("; ")}.${note ? ` Accessory note (Chinese; translate faithfully): ${note}` : ""}`,
    partsDefault: "All parts, accessories and cables in the reference are part of the product, not clutter; keep them all.",
    colors: (list) => ` Color lock (sampled from the reference image): ${list.map((c, i) => `${i + 1}) ${c.hex} at about ${c.px}% from the left and ${c.py}% from the top${c.note ? ` (${c.note})` : ""}`).join("; ")}. These areas must keep exactly these colors.`,
    none: "none",
  },
  zh: {
    background: {
      white: "纯白色（RGB 255,255,255）干净背景，去掉原背景里的所有杂物和阴影边缘；可以保留产品下方自然、轻微的接触投影。产品轮廓清晰锐利，从产品本身的颜色直接过渡到白底，边缘不要白色或浅色描边、轮廓光、外发光和光晕。",
      original: "保留原图的背景和场景，只清理背景里明显的杂物和污点，不要换背景。",
      refine: "保留原图的背景、场景、光线和色调，只去掉背景里的杂点、污渍和灰尘，不要换背景，不要改变画面风格。",
      custom: "背景按用户备注里写的要求做；如果备注里没有写背景要求，就保留原图的背景、场景、光线和色调，只去掉背景里的杂点、污渍和灰尘。",
      alpha: "纯白色（RGB 255,255,255）干净背景，去掉原背景里的所有杂物；不要任何投影、倒影和阴影（之后要抠成透明底）；产品边缘清晰锐利、轮廓干净，没有毛边和白边；枝叶之间、把手里、零件之间的空隙也要露出同样的纯白背景。边缘：产品轮廓从产品本身的颜色直接过渡到纯白，不要白色或浅色描边、轮廓光、外发光、亮边线、沿轮廓的浅色倒角，不要模糊羽化，不要锐化光晕；深色产品的边缘要一直是深色。",
    },
    angle: {
      keep: "保持原图的拍摄角度、透视、产品朝向和摆放方式完全不变；线缆、线束和配件的走向与位置也不变；不要旋转、翻转或重新摆放任何部分。",
      auto: "把产品摆正：歪斜的扶正，多个产品排列整齐，视角调整为能看清产品主要特征的标准电商展示角度。",
      front: "改为正面平视角度：相机与产品正面等高、正对，产品端正不歪斜。",
      45: "改为约 45° 俯视的立体展示角度，能同时看到产品的正面和顶部，产品端正不歪斜。",
      top: "改为正上方垂直俯拍（平铺展示）：产品平放、端正，多个产品排列整齐。",
      extra: "原图里看不到的部分要符合产品的真实结构，不要编造文字、Logo 或零件。",
    },
    retouch: {
      on: "去除灰尘、划痕、瑕疵、杂点和噪点，还有污渍、油渍、指纹、水印、锈点和变色：这些都是瑕疵，不是产品的花纹或颜色，要彻底去掉，也不要在任何地方新加污渍、痕迹或变色；光线均匀柔和，质感真实，达到电商平台主图的水准。",
      off: "不要精修产品：表面、质感、磨损痕迹、光线和颜色都保持原图的样子，只按背景和构图的要求修改。",
    },
    sharp: {
      keep: "保持原图的清晰度，不要人为锐化，不要编造多余的细节。",
      enhance: "提升清晰度和细节：去模糊，边缘清晰锐利，纹理清楚可见，但不改变任何形状。",
    },
    compose: (r, fill) => fill === "keep"
      ? `画面比例 ${r}。产品在画面中的大小和位置参考原图，完整显示，不要裁掉产品任何部分。`
      : `画面比例 ${r}。产品完整显示、居中，主体约占画面的 ${fill}%${fill === "85" ? "（主体饱满）" : ""}，四周留出${fill === "85" ? "少量" : "适当"}空白，不要裁掉产品任何部分。`,
    composeRefine: (r) => `画面比例 ${r}（和原图一致）。这是精修，不是重新设计：保持原图的构图、取景、产品位置和大小完全不变，不要裁剪、不要重新构图，不改变产品颜色和光影风格。`,
    look: (n) => (n ? "这张原图和配件标注图 {{附图1}}" : "这张原图"),
    pathsNote: (n, d) => (n
      ? `（第 1 张是原图，是精修的依据；第 2 张是配件标注图${d ? `；第 ${d > 1 ? `3～${2 + d}` : "3"} 张是配件特写` : ""}，只用来参考）`
      : "（原图作为参考图）"),
    call: (r, paths) => `立即调用 invoke_subagent，子智能体类型必须是 image-generator（在参数里写明这个类型），让它只调用一次 generate_image、只生成这一张图，参数：ImageName: "refined"；AspectRatio: "${r}"；ImagePaths: ${paths}；Prompt: 你看完原图后用英文写的画面描述（写进交给它的说明里，让它原样使用）。委派之后你只需要等它完成：可以用 manage_task 查看进度，不要做任何别的事。`,
    parts: (n, d, note) => `标注图里用红框和编号标出的 ${n} 处是产品配件，不是污渍或杂物，成品里必须完整保留，形状、数量、相对位置都不变；${d ? "配件特写图用来看清它们的细节；" : ""}红框和编号只是标记，成品里绝对不要画出来。${note ? "配件说明：" + note : ""}`,
    partsNoteOnly: (note) => `${note}（这些配件必须完整保留，不是杂物）。`,
    partsDefault: "参考图里的所有零件、配件、线缆都是产品的一部分，不是杂物，要完整保留。",
    colors: (list) => `颜色锁定（从参考图上取的色号）：${list.map((c, i) => `${i + 1}）${c.hex}，位置约在从左 ${c.px}%、从上 ${c.py}% 处${c.note ? `（${c.note}）` : ""}`).join("；")}。这些部位必须保持这个颜色。`,
    none: "无",
  },
};

// generate_image 的 AspectRatio 常用值。“自动”时从这里挑最接近原图（或框选区域）的。
const AI_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

function gcd(a, b) { return b ? gcd(b, a % b) : a; }

function simpleRatio(w, h) {
  const g = gcd(w, h) || 1;
  const a = w / g, b = h / g;
  return a <= 50 && b <= 50 ? `${a}:${b}` : (w / h).toFixed(3);
}

function ratioValue(r) { const [a, b] = r.split(":").map(Number); return a / b; }

function closestAiRatio(w, h) {
  const v = Math.log(w / h);
  return AI_RATIOS.reduce((best, r) => (Math.abs(Math.log(ratioValue(r)) - v) < Math.abs(Math.log(ratioValue(best)) - v) ? r : best));
}

function fmtBytes(n) {
  if (!n && n !== 0) return "";
  return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB";
}

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** 比例 r（宽/高）、长边 L → 宽×高 */
function sizeFor(r, L) {
  return r >= 1 ? { w: L, h: Math.round(L / r) } : { w: Math.round(L * r), h: L };
}

function canvasToBlob(c, type, q) {
  return new Promise((resolve) => c.toBlob(resolve, type, q));
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.readAsDataURL(blob);
  });
}

/** 框选后实际交给 AI 的尺寸（像素）。 */
function inputSize(f) {
  if (!f.crop) return { w: f.w, h: f.h };
  return { w: Math.max(1, Math.round(f.crop.w * f.w)), h: Math.max(1, Math.round(f.crop.h * f.h)) };
}

/** 蒙版里连在一起的涂抹 → 一个配件，返回范围（0~1，按面积从大到小）。 */
function findParts(mask) {
  const k = Math.min(1, 256 / Math.max(mask.width, mask.height));
  const w = Math.max(1, Math.round(mask.width * k)), h = Math.max(1, Math.round(mask.height * k));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(mask, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const on = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) on[i] = d[i * 4 + 3] > 40 ? 1 : 0;
  const parts = [];
  const q = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!on[start]) continue;
    let qh = 0, qt = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    q[qt++] = start; on[start] = 0;
    while (qh < qt) {
      const i = q[qh++], x = i % w, y = (i - x) / w;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (on[j]) { on[j] = 0; q[qt++] = j; }
      }
    }
    if (qt >= 3) parts.push({ x: x0 / w, y: y0 / h, w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h, area: qt });
  }
  return parts.sort((a, b) => b.area - a.area);
}

/** 标注的配件换算到“交给 AI 的图”（框选后）的像素坐标；框选范围外的不要。 */
function partsInInput(f) {
  const ox = f.crop ? f.crop.x * f.w : 0, oy = f.crop ? f.crop.y * f.h : 0;
  const { w: W, h: H } = inputSize(f);
  const out = [];
  for (const p of f.parts || []) {
    const x0 = Math.max(0, p.x * f.w - ox), y0 = Math.max(0, p.y * f.h - oy);
    const x1 = Math.min(W, (p.x + p.w) * f.w - ox), y1 = Math.min(H, (p.y + p.h) * f.h - oy);
    if (x1 - x0 > 1 && y1 - y0 > 1) out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  return out;
}

const MAX_DETAILS = 4;

/**
 * 交给 AI 的图：框选后的原图（全分辨率）；有配件标注时再加
 *  - 标注图：同一张图，配件用红框 + 编号标出来（长边最多 1600）；
 *  - 配件特写：每个配件周围放大裁一张（最多 4 张，最大的优先）。
 */
async function prepareInput(f, opts = {}) {
  const img = await loadImage(f.dataUrl);
  const ox = f.crop ? Math.round(f.crop.x * f.w) : 0, oy = f.crop ? Math.round(f.crop.y * f.h) : 0;
  const { w, h } = inputSize(f);
  let base;
  // 透明 PNG：先铺白底再交给 AI。不铺的话框选后透明处会变黑，没框选时 AI 也可能把透明处当成黑色 / 花底，
  // 画出来边缘又带上白边、残留（Lee 2026-10-26：修干净的产品图让 AI 精修，残留又回来了）
  const isPng = /^data:image\/png/.test(f.dataUrl || "");
  if (!f.crop && !isPng) {
    // base64 可能没有（刷新后从插件后台恢复的图只存了 dataUrl）
    base = { dataUrl: f.dataUrl, base64: f.base64 || f.dataUrl.split(",")[1], w: f.w, h: f.h, bytes: f.size, name: f.name };
  } else {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const cg = c.getContext("2d");
    cg.fillStyle = "#ffffff";
    cg.fillRect(0, 0, w, h);
    cg.drawImage(img, ox, oy, w, h, 0, 0, w, h);
    // 自由框选（任意形状）：框外面的部分涂成白色，只把圈出来的商品交给 AI
    if (f.lasso && f.lasso.length > 2) {
      cg.fillStyle = "#ffffff";
      cg.beginPath();
      cg.rect(0, 0, w, h);
      f.lasso.forEach((pt, i) => (i ? cg.lineTo : cg.moveTo).call(cg, pt.x * f.w - ox, pt.y * f.h - oy));
      cg.closePath();
      cg.fill("evenodd");
    }
    const blob = await canvasToBlob(c, "image/jpeg", 0.95);
    base = { dataUrl: URL.createObjectURL(blob), base64: await blobToBase64(blob), w, h, bytes: blob.size, name: f.name.replace(/\.[^.]+$/, "") + ".jpg", cropped: !!f.crop };
  }
  base.extras = [];
  const parts = partsInInput(f);
  base.partCount = parts.length;
  base.detailCount = 0;
  // single：只交一张图给 AI（插件用），配件位置由 buildWebPrompt 写进提示词，不生成标注图和特写
  if (!parts.length || opts.single) return base;

  // 标注图
  const k = Math.min(1, 1600 / Math.max(w, h));
  const mc = document.createElement("canvas");
  mc.width = Math.round(w * k); mc.height = Math.round(h * k);
  const g = mc.getContext("2d");
  g.drawImage(img, ox, oy, w, h, 0, 0, mc.width, mc.height);
  const lw = Math.max(3, Math.round(Math.max(mc.width, mc.height) * 0.004));
  const fs = Math.max(16, Math.round(Math.max(mc.width, mc.height) * 0.025));
  parts.forEach((p, i) => {
    const pad = Math.max(6, Math.min(p.w, p.h) * k * 0.15);
    const x = p.x * k - pad, y = p.y * k - pad, rw = p.w * k + pad * 2, rh = p.h * k + pad * 2;
    g.strokeStyle = "#ff1744";
    g.lineWidth = lw;
    g.strokeRect(x, y, rw, rh);
    g.fillStyle = "#ff1744";
    g.fillRect(x - lw / 2, y - fs - 6, fs + 8, fs + 6);
    g.fillStyle = "#fff";
    g.font = `bold ${fs}px sans-serif`;
    g.fillText(String(i + 1), x + 3, y - 5);
  });
  const mblob = await canvasToBlob(mc, "image/jpeg", 0.9);
  base.markUrl = URL.createObjectURL(mblob);
  base.extras.push({ kind: "mark", base64: await blobToBase64(mblob) });

  // 配件特写
  for (const p of parts.slice(0, MAX_DETAILS)) {
    const side = Math.max(p.w, p.h) * 1.8, minSide = Math.min(w, h) * 0.15;
    const cw = Math.min(w, Math.max(p.w * 1.8, minSide, side * 0.6)), ch = Math.min(h, Math.max(p.h * 1.8, minSide, side * 0.6));
    const cx = Math.min(Math.max(0, p.x + p.w / 2 - cw / 2), w - cw), cy = Math.min(Math.max(0, p.y + p.h / 2 - ch / 2), h - ch);
    const L = Math.max(cw, ch);
    const sc = Math.min(1024 / L, Math.max(1, 512 / L)); // 太小的放大到至少 512，太大的缩到 1024
    const dc = document.createElement("canvas");
    dc.width = Math.round(cw * sc); dc.height = Math.round(ch * sc);
    const dg = dc.getContext("2d");
    dg.imageSmoothingQuality = "high";
    dg.drawImage(img, ox + cx, oy + cy, cw, ch, 0, 0, dc.width, dc.height);
    const dblob = await canvasToBlob(dc, "image/jpeg", 0.95);
    base.extras.push({ kind: "detail", base64: await blobToBase64(dblob) });
    base.detailCount++;
  }
  return base;
}

/** 吸管取的颜色换算到“交给 AI 的图”（框选后）里的位置百分比；框选范围外的不要。 */
function colorsInInput(f) {
  const out = [];
  for (const c of f.colors || []) {
    let px = c.x, py = c.y;
    if (f.crop) {
      px = (c.x - f.crop.x) / f.crop.w;
      py = (c.y - f.crop.y) / f.crop.h;
    }
    if (px < 0 || py < 0 || px > 1 || py > 1) continue;
    out.push({ hex: c.hex, note: c.note, px: Math.round(px * 100), py: Math.round(py * 100) });
  }
  return out;
}

/** 白底图上商品的范围（比白色暗的像素），找不到返回 null。坐标是原图像素。 */
function findSubject(img) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const k = Math.min(1, 600 / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const rows = new Array(h).fill(0), cols = new Array(w).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    // 比 225 暗的算商品；很淡的接触投影不算，免得把主体算大
    if (d[i] < 225 || d[i + 1] < 225 || d[i + 2] < 225) { rows[y]++; cols[x]++; }
  }
  const minRow = Math.max(1, Math.round(w * 0.004)), minCol = Math.max(1, Math.round(h * 0.004)); // 去掉零星噪点
  const ys = rows.map((n, i) => (n >= minRow ? i : -1)).filter((i) => i >= 0);
  const xs = cols.map((n, i) => (n >= minCol ? i : -1)).filter((i) => i >= 0);
  if (!xs.length || !ys.length) return null;
  const x0 = xs[0] / k, x1 = (xs[xs.length - 1] + 1) / k, y0 = ys[0] / k, y1 = (ys[ys.length - 1] + 1) / k;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * 白底提纯（只用于白底图）：AI 出的“白底”有时是乳白 / 偏黄 / 偏灰（3.1 Pro 实测乳白）。
 * 取图片四周一圈的颜色当背景色，按它把整张图每个通道等比提亮（背景 → 纯白），产品一起校正，
 * 所以不会出现“背景一块白一块乳白”的分界；最后把几乎纯白的像素（三个通道都 ≥ 250）定成纯白。
 * 背景不够白（任何通道 < 200）或已经是纯白时不处理。返回 { canvas, bg, gain } 或 null。
 */
function whitenBackground(img) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const c = document.createElement("canvas");
  c.width = iw; c.height = ih;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const im = g.getImageData(0, 0, iw, ih);
  const d = im.data;
  // 四周 2% 宽的一圈，按亮度取最亮的一半求平均（避开产品碰到边的部分和阴影）
  const band = Math.max(2, Math.round(Math.min(iw, ih) * 0.02));
  const px = [];
  const step = Math.max(1, Math.round(Math.max(iw, ih) / 400));
  for (let y = 0; y < ih; y += step) for (let x = 0; x < iw; x += step) {
    if (x >= band && x < iw - band && y >= band && y < ih - band) continue;
    const i = (y * iw + x) * 4;
    px.push([d[i], d[i + 1], d[i + 2]]);
  }
  px.sort((a, b) => b[0] + b[1] + b[2] - (a[0] + a[1] + a[2]));
  const top = px.slice(0, Math.max(1, Math.floor(px.length / 2)));
  const bg = [0, 1, 2].map((k) => top.reduce((t, p) => t + p[k], 0) / top.length);
  if (bg.some((v) => v < 200) || bg.every((v) => v >= 252)) return null;
  const gain = bg.map((v) => 255 / Math.max(v, 1));
  const lut = gain.map((k) => { const t = new Uint8ClampedArray(256); for (let v = 0; v < 256; v++) t[v] = Math.round(v * k); return t; });
  for (let i = 0; i < d.length; i += 4) {
    const r = lut[0][d[i]], gg = lut[1][d[i + 1]], b = lut[2][d[i + 2]];
    if (r >= 250 && gg >= 250 && b >= 250) { d[i] = d[i + 1] = d[i + 2] = 255; }
    else { d[i] = r; d[i + 1] = gg; d[i + 2] = b; }
  }
  g.putImageData(im, 0, 0);
  return { canvas: c, bg: bg.map((v) => Math.round(v)), gain };
}

function edgeColor(img) {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0, 64, 64);
  const d = g.getImageData(0, 0, 64, 64).data;
  let r = 0, gr = 0, b = 0, n = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    if (x > 1 && x < 62 && y > 1 && y < 62) continue;
    const i = (y * 64 + x) * 4;
    r += d[i]; gr += d[i + 1]; b += d[i + 2]; n++;
  }
  r = Math.round(r / n); gr = Math.round(gr / n); b = Math.round(b / n);
  return r > 235 && gr > 235 && b > 235 ? "#ffffff" : `rgb(${r},${gr},${b})`;
}

/**
 * 抠透明底（只用于白底图）：
 *  1. 从图片四周往里找“和外边相连的纯白”，这部分是背景。只认几乎纯白（容差 T）而且平整的像素：
 *     碰到明显的明暗变化（轮廓线、金属高光的边）就停，免得顺着贴边的高光抠进产品里（Lee 2026-10-09 反馈金属高光被抠透明）。
 *  2. 被产品围起来的大块纯白（环形零件中间的孔、树苗枝叶间的空隙）：opts.holes = true 都算背景、false 都保留、
 *     "auto" 按周围颜色判断（周围是叶子泥土这类有颜色的 → 背景；周围是灰色金属 → 高光，保留）。
 *  3. 背景里零星的小杂点去掉。
 *  4. 边缘 1 像素做柔和过渡（去锯齿），并把边缘残留的白色去掉（去白边）。
 */
function cutoutWhite(g, W, H, opts = {}) {
  const im = g.getImageData(0, 0, W, H);
  const d = im.data;
  const N = W * H;
  const dist = new Uint8Array(N); // 离纯白有多远：0 = 纯白
  for (let i = 0; i < N; i++) dist[i] = 255 - Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
  const T = 12; // 算“白”的容差（白底提纯后背景基本是 255）
  // 平整度：和上下左右邻居相差最多多少；背景是平的，轮廓和高光边缘变化大
  const grad = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, v = dist[i];
    let m = 0;
    if (x > 0) m = Math.max(m, Math.abs(v - dist[i - 1]));
    if (x < W - 1) m = Math.max(m, Math.abs(v - dist[i + 1]));
    if (y > 0) m = Math.max(m, Math.abs(v - dist[i - W]));
    if (y < H - 1) m = Math.max(m, Math.abs(v - dist[i + W]));
    grad[i] = m;
  }
  const G = 6;
  const isBg = (i) => dist[i] <= T && grad[i] <= G;
  const bg = new Uint8Array(N);
  const q = new Int32Array(N);
  let qh = 0, qt = 0;
  const seed = (i) => { if (!bg[i] && isBg(i)) { bg[i] = 1; q[qt++] = i; } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (qh < qt) {
    const i = q[qh++], x = i % W;
    if (x > 0) seed(i - 1);
    if (x < W - 1) seed(i + 1);
    if (i >= W) seed(i - W);
    if (i < N - W) seed(i + W);
  }
  // 背景旁边还没算进来的白色像素（平整度刚好超一点的过渡像素）：挨着背景、而且很白的也算背景
  for (let pass = 0; pass < 2; pass++) {
    const add = [];
    for (let i = 0; i < N; i++) {
      if (bg[i] || dist[i] > T) continue;
      const x = i % W;
      if ((x > 0 && bg[i - 1]) || (x < W - 1 && bg[i + 1]) || (i >= W && bg[i - W]) || (i < N - W && bg[i + W])) add.push(i);
    }
    add.forEach((i) => (bg[i] = 1));
  }
  // 连通块：flag=1 找“被围住的白色”（大块的才考虑算孔），flag=0 找“前景”（小块算杂点）
  //  opts.holes：true = 被围住的大块纯白都抠掉；false = 都保留；"auto" = 看它周围是什么：
  //   花草树苗枝叶间的空隙，周围是有颜色的叶子 / 泥土（饱和度高）或很深的颜色，边缘利落 → 是背景，抠掉；
  //   金属、陶瓷上的白色高光，周围是灰色、慢慢变暗 → 是产品，保留。（Lee 2026-10-10：树苗 PNG 中间一块白）
  const seen = new Uint8Array(N);
  const holeMin = Math.max(200, N * 0.002);
  const speckMax = Math.max(20, N * 0.00015);
  const holeMinAuto = Math.max(40, N * 0.00004);
  const sat = (i) => Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) - Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
  const label = opts.holes === "auto" ? new Int32Array(N) : null;
  let regionNo = 0;
  const looksLikeGap = (len) => {
    // 区域外面 3～10 个像素处（跨过过渡边）真正有内容的像素（离白 ≥ 40）是什么颜色
    const ds = [], ss = [];
    const stepK = Math.max(1, Math.floor(len / 6000));
    for (let k = 0; k < len; k += stepK) {
      const i = q[k], x = i % W, y = (i - x) / W;
      for (const r of [3, 6, 10]) {
        for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const j = yy * W + xx;
          if (label[j] === regionNo || bg[j] || dist[j] < 40) continue;
          ds.push(dist[j]); ss.push(sat(j));
        }
      }
    }
    if (ds.length < 20) return false;
    const med = (a) => a.sort((m, n) => m - n)[a.length >> 1];
    const ms = med(ss), md = med(ds);
    return ms >= 25 || md >= 140;
  };
  for (const white of opts.holes ? [1, 0] : [0]) {
    seen.fill(0);
    for (let start = 0; start < N; start++) {
      if (bg[start] || seen[start] || (white ? !isBg(start) : isBg(start) || dist[start] <= T)) continue;
      qh = 0; qt = 0;
      q[qt++] = start; seen[start] = 1;
      while (qh < qt) {
        const i = q[qh++], x = i % W;
        const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W];
        for (const j of nb) {
          if (j < 0 || j >= N || seen[j] || bg[j] || (white ? !isBg(j) : isBg(j) || dist[j] <= T)) continue;
          seen[j] = 1;
          q[qt++] = j;
        }
      }
      // auto 时小一点的空隙也看（枝叶间常有小空隙），反正要过“周围颜色”这一关
      let take = white ? qt >= (label ? holeMinAuto : holeMin) : qt <= speckMax;
      if (take && white && label) {
        regionNo++;
        for (let k = 0; k < qt; k++) label[q[k]] = regionNo;
        take = looksLikeGap(qt);
      }
      if (take) for (let k = 0; k < qt; k++) bg[q[k]] = 1;
    }
  }
  // 抠掉的孔旁边的白色过渡像素也算背景（和外圈一样扩两圈）
  if (opts.holes) {
    for (let pass = 0; pass < 2; pass++) {
      const add = [];
      for (let i = 0; i < N; i++) {
        if (bg[i] || dist[i] > T) continue;
        const x = i % W;
        if ((x > 0 && bg[i - 1]) || (x < W - 1 && bg[i + 1]) || (i >= W && bg[i - W]) || (i < N - W && bg[i + W])) add.push(i);
      }
      add.forEach((i) => (bg[i] = 1));
    }
  }
  // 透明度 + 边缘处理
  const alpha = new Uint8Array(N);
  for (let i = 0; i < N; i++) alpha[i] = bg[i] ? 0 : 255;
  const out = new Uint8ClampedArray(d);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (bg[i]) { out[i * 4 + 3] = 0; continue; }
    // 只处理挨着背景的边缘像素
    let edge = false, sum = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = yy * W + xx;
      if (bg[j]) edge = true;
      sum += alpha[j]; n++;
    }
    if (!edge) continue;
    // cover：这个像素里产品占多少（越接近白色越少）。白边像素按 cover 把混进去的白色减掉（去白边）；
    // 透明度再和周围平均一下（去锯齿）。深色边缘 cover = 1，颜色不动，只做柔和过渡。
    const cover = Math.max(0.08, Math.min(1, dist[i] / 72)); // 和容差无关：离纯白 72 以上算完全不透明
    if (cover < 1) {
      for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round((d[i * 4 + c] - 255 * (1 - cover)) / cover);
    }
    out[i * 4 + 3] = Math.round(Math.max(0.08, Math.min(cover, sum / n / 255)) * 255);
  }
  // 边缘修色：最外圈只去了 1 像素的白，往里第 2 圈偏浅的（AI 在白底上画的混色、压缩出的亮边）也染回产品色（Lee 2026-10-26：放大后边缘一级级的浅色台阶）
  if (opts.defringe !== false) defringeAlpha(out, W, H, { band: 2, strength: 1 });
  g.putImageData(new ImageData(out, W, H), 0, 0);
}

/**
 * 边缘修色（去色边）：透明底图片贴着透明处 band 圈以内、比里面的产品颜色更浅（混了白色）的像素，
 * 把颜色染回里面一点的真实产品色，最外两圈顺便按混进去的白色多少降一点透明度。不删像素，产品不会变小。
 * 参考色取 band+1～band+3 圈（离透明处更远）的像素；参考色本身很浅（白色产品）或这一带本来就是浅色（宽的浅色包边）就不动。
 * d = RGBA 数组（就地修改），透明 = alpha < 16；strength 0~1
 */
function defringeAlpha(d, W, H, o = {}) {
  const band = Math.max(1, Math.min(6, o.band || 2)), sMul = Math.max(0, Math.min(1, o.strength == null ? 1 : o.strength));
  if (!sMul) return d;
  const N = W * H, far = band + 3;
  const dep = new Uint8Array(N); // 离透明处几圈：0 = 透明（或还没算到），1 = 挨着透明处
  const q = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let i = 0; i < N; i++) if (d[i * 4 + 3] < 16) {
    const x = i % W;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < N && d[j * 4 + 3] >= 16 && !dep[j]) { dep[j] = 1; q[qt++] = j; }
  }
  while (qh < qt) {
    const i = q[qh++], x = i % W, k = dep[i] + 1;
    if (k > far) continue;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < N && d[j * 4 + 3] >= 16 && !dep[j]) { dep[j] = k; q[qt++] = j; }
  }
  const R = band + 3;
  const src = new Uint8ClampedArray(d);
  for (let i = 0; i < N; i++) {
    const de = dep[i];
    if (!de || de > band) continue;
    const x = i % W, y = (i - x) / W;
    // 参考色：紧挨着往里的 band+1～band+3 圈（再往里的不算：宽的浅色包边里，紧挨着的还是浅色，就不会被当成白边）
    let r = 0, g2 = 0, b = 0, n = 0;
    for (let yy = Math.max(0, y - R); yy <= Math.min(H - 1, y + R); yy++) for (let xx = Math.max(0, x - R); xx <= Math.min(W - 1, x + R); xx++) {
      const j = yy * W + xx;
      if (src[j * 4 + 3] < 250) continue;
      if (!dep[j] || dep[j] <= band) continue;
      r += src[j * 4]; g2 += src[j * 4 + 1]; b += src[j * 4 + 2]; n++;
    }
    if (n < 3) continue;
    const F = [r / n, g2 / n, b / n];
    // 混进去的白色有多少：a = 产品占的比例（按离白色的距离算，参考色太浅的通道不算）
    let as = 0, an = 0;
    for (let c = 0; c < 3; c++) { const room = 255 - F[c]; if (room >= 24) { as += (255 - src[i * 4 + c]) / room; an++; } }
    if (!an) continue; // 白色 / 很浅的产品：不动
    const a = Math.max(0, Math.min(1, as / an));
    if (a >= 0.97) continue; // 不比里面浅：不是白边
    const m = sMul;
    for (let c = 0; c < 3; c++) d[i * 4 + c] = Math.round(src[i * 4 + c] + (F[c] - src[i * 4 + c]) * m);
    const drop = de === 1 ? 1 : de === 2 ? 0.25 : 0; // 最外圈按混白多少变透明一点，第 2 圈少一点，再往里只改颜色
    if (drop) d[i * 4 + 3] = Math.round(src[i * 4 + 3] * (1 - m * drop * (1 - a) * 0.85));
  }
  return d;
}

/**
 * 亮度 / 对比度（程序调，不经过 AI）：亮度用伽马提亮中间调（纯黑纯白不变），
 * 对比度以中灰为中心拉开。纯白背景始终是纯白。
 */
function adjustTone(g, W, H, bright, contrast) {
  const gamma = [1, 1.12, 1.25][bright] || 1;
  const k = [1, 1.12, 1.25][contrast] || 1;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round((255 * Math.pow(v / 255, 1 / gamma) - 128) * k + 128);
  const im = g.getImageData(0, 0, W, H);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
  g.putImageData(im, 0, 0);
}


/**
 * AI 出图 → 最终输出（主体校准 + 缩放 / 裁边 / 补边 + 亮度对比度 + 透明底）。
 * o = {
 *   ratio: 目标比例（宽/高，数字），null = 跟交给 AI 的图一样（inputRatio）
 *   inputRatio, inputSize: {w,h}  交给 AI 的图（框选后）的比例和尺寸
 *   outSize: "800" | "1024" | "2048" | "original"（AI 原尺寸）| "source"（和原图一样大）
 *   fill: "keep" | "70" | "85"，background: "white" | "original"，format: "jpeg" | "png" | "png-alpha"
 *   contrast, bright: "0" | "1" | "2"
 *   holes: PNG 透明底时被产品围住的大块白色：true 抠掉 / false 保留 / "auto" 按周围颜色判断
 *   whiten: false = 不做白底提纯（默认白底图都做）
 * }
 * 返回 { blob, w, h, ext, upscaled, note, subjectPct } ；不需要处理时返回 { same: true }。
 */
async function composeOutput(img, o) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  // 白底提纯：先把乳白 / 偏色的背景校正成纯白，后面的主体校准、抠图都用校正后的图
  const whitened = o.background === "white" && o.whiten !== false ? whitenBackground(img) : null;
  if (whitened) img = whitened.canvas;
  const calibrate = o.fill !== "keep" && o.background === "white";
  const subject = calibrate ? findSubject(img) : null;
  const alpha = o.format === "png-alpha";
  const tone = o.contrast !== "0" || o.bright !== "0";
  const r = o.ratio || o.inputRatio || iw / ih;
  const closeToAi = Math.abs(Math.log(iw / ih / r)) < 0.03;
  if (o.outSize === "original" && !subject && !alpha && !tone && !whitened && o.format === "jpeg" && closeToAi) return { same: true };

  let W, H;
  if (o.outSize === "original") ({ w: W, h: H } = sizeFor(r, Math.max(iw, ih)));
  else if (o.outSize === "source") ({ w: W, h: H } = o.inputSize);
  else ({ w: W, h: H } = sizeFor(r, Number(o.outSize)));

  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: alpha || tone });
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  let scale, dx, dy;
  const notes = [];
  if (whitened) notes.push(`白底提纯（原背景 RGB ${whitened.bg.join(",")}）`);
  if (subject) {
    // 主体校准：商品的长边（相对画布）正好占 fill%，居中
    const f = Number(o.fill) / 100;
    scale = Math.min((W * f) / subject.w, (H * f) / subject.h);
    dx = W / 2 - (subject.x + subject.w / 2) * scale;
    dy = H / 2 - (subject.y + subject.h / 2) * scale;
    g.fillStyle = "#ffffff";
    notes.push(`主体校准 ${o.fill}%`);
  } else {
    // AI 出的比例和目标差不多（3% 以内）就铺满、裁掉边上几个像素；差得多就完整放进去、补边
    const close = Math.abs(Math.log(iw / ih / (W / H))) < 0.03;
    scale = close ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
    dx = (W - iw * scale) / 2;
    dy = (H - ih * scale) / 2;
    g.fillStyle = o.background === "white" ? "#ffffff" : edgeColor(img);
    if (!close) notes.push("比例不符，已补边");
    if (calibrate) notes.push("没找到商品边界，未校准");
  }
  g.fillRect(0, 0, W, H);
  g.drawImage(img, dx, dy, iw * scale, ih * scale);
  if (tone) {
    adjustTone(g, W, H, Number(o.bright), Number(o.contrast));
    if (o.bright !== "0") notes.push(`亮度${{ 1: "稍亮", 2: "更亮" }[o.bright]}`);
    if (o.contrast !== "0") notes.push(`对比度${{ 1: "稍微提高", 2: "明显提高" }[o.contrast]}`);
  }
  if (alpha) {
    cutoutWhite(g, W, H, { holes: o.holes });
    notes.push(o.holes === true ? "透明底（含镂空）" : "透明底");
  }
  const png = o.format !== "jpeg";
  const blob = await canvasToBlob(c, png ? "image/png" : "image/jpeg", 0.92);
  return {
    blob,
    w: W, h: H,
    ext: png ? ".png" : ".jpg",
    upscaled: scale > 1.001,
    note: notes.join("，"),
    subjectPct: subject ? Math.round(Math.max(subject.w / iw, subject.h / ih) * 100) : null,
  };
}

/**
 * 精修要求里的产品名占位符：[产品名]（也认 {产品名}、【产品名】）。
 * 填了产品名就替换；没填就把含占位符的那一句整句去掉（按 。；！？ 和换行分句）。
 */
function fillProduct(text, name) {
  const has = (t) => /[\[{【]产品名[\]}】]/.test(t);
  const t = String(text || "");
  if (!t) return "";
  if (name) return t.replace(/[\[{【]产品名[\]}】]/g, name).trim();
  return t.split(/(?<=[。；;！!？?\n])/).filter((seg) => !has(seg)).join("").trim();
}

/**
 * Gemini 网页版用的提示词（英文）：网页版没有比例参数，比例写进提示词。
 * s = 设置（mode, background, format, fill, angle, retouch, sharp, requirement）
 * f = 图片（crop / parts / partsNote / colors）
 * opts.fresh = true：在已有对话里继续做时，开头声明这是一个新的、独立的产品
 */
function buildWebPrompt(s, f, aiRatio, opts = {}) {
  const L = T.en;
  const inParts = partsInInput(f);
  // 插件只发一张图：配件不再单独发标注图 / 特写，按位置（百分比）写进提示词
  const nParts = 0;
  const nDetails = 0;
  const note = (f.partsNote || "").trim();
  const { w: IW, h: IH } = inputSize(f);
  const pct = (v, total) => Math.max(0, Math.min(100, Math.round((v / total) * 100)));
  const at = inParts.map((p) => ({ l: pct(p.x, IW), r: pct(p.x + p.w, IW), t: pct(p.y, IH), b: pct(p.y + p.h, IH) }));
  const parts = at.length ? L.partsAt(at, note) : note ? L.partsNoteOnly(note) : L.partsDefault;
  const colors = colorsInInput(f);
  let compose = L.compose(aiRatio, s.fill);
  let background = L.background[s.background];
  if (s.mode === "refine") {
    compose = L.composeRefine(aiRatio);
    // 精修的背景：原图背景（默认）/ 白底图 / 自定义（按用户备注，没写就保留原图背景）
    background = s.background === "white" ? L.background.white : s.background === "custom" ? L.background.custom : L.background.refine;
  } else if (s.format === "png-alpha") {
    background = L.background.alpha;
  }
  const angle = s.angle === "keep" ? L.angle.keep : L.angle[s.angle] + L.angle.extra;
  const lines = [];
  if (opts.fresh) lines.push("This is a NEW, independent product. Ignore all previous images, products and requests in this conversation.");
  lines.push(
    `Generate one image: a refined e-commerce product photo of the exact product in the first uploaded image (aspect ratio ${aiRatio}${aiRatio === "1:1" ? ", square" : ""}).` +
      (nParts ? ` The second uploaded image is an accessory annotation image${nDetails ? " and the following one(s) are accessory close-ups" : ""}; use them only as references.` : ""),
    "Requirements:",
    ...(s.productName ? [`- Product: this is "${s.productName}" (product name in Chinese; use it to understand what the product is).`] : []),
    "- Same product: it must be exactly the same product as in the reference image. Shape, proportions, structure, colors, materials, patterns, text, logos and the number of parts must not change; do not add or remove any part.",
    `- Colors: every color must match the reference image exactly. Color names in the user's note are only hints; if they conflict with the image, follow the image.${colors.length ? L.colors(colors) : ""}`,
    `- Accessories: ${parts}`,
    `- Angle: ${angle} Whatever the angle, the product's shape, proportions and colors must stay identical to the reference.`,
    `- Retouching: ${L.retouch[s.retouch] || L.retouch.on}`,
    `- Sharpness: ${L.sharp[s.sharp] || L.sharp.keep}`,
    `- Background: ${background}`,
    `- Composition: ${compose}`,
    `- User note (in Chinese): ${s.requirement || "none"}`,
    "Reply with the image only.",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------- zip 打包（不压缩，图片本来就压缩过）

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** files: [{ name, blob }] → zip Blob。文件名用 UTF-8（Windows 解压中文名不乱码）。 */
async function makeZip(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer());
    const name = enc.encode(f.name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 文件名
    local.setUint16(8, 0, true); // 不压缩
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, dosTime, true);
    cd.setUint16(14, dosDate, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}
