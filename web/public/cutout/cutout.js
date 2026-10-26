/**
 * 网页版 · 抠白底图（Lee 2026-10-24：AI图图 插件右侧面板的功能搬到网页，网页指挥插件干活）
 *
 * 三种模式：抠白底图 1:1 / 图片精修（跟原图比例）/ 自由模式；产品图可以上传、拖进来、Ctrl+V 粘贴、从素材中心选；
 * 点缩略图打开编辑框（editor.js）；精修要求、“这个是：”产品名、精修模板；背景、比例、输出尺寸 / 格式、镂空处、主体大小、角度、精修、清晰度、对比度、亮度；
 * Gemini / Copilot 轮流做，也可以指定一个；Gemini 可以选模型。
 * “开始这一批”：网页把每张图按编辑框的设置准备好（imagekit.js 的 prepareInput），写好提示词（buildWebPrompt），交给服务器；
 * 服务器排 AI 任务、收图、后期，结果存进项目和素材中心（关掉网页也不停）。
 * 结果：看大图（左右切换）、看 AI 原图、下载、重做、拿来接着做、删除；多选：重做 / 下载 zip / 删除 / 做主图 / 做详情页。
 */
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (id) => document.getElementById(id);
  let P = null; // 当前项目
  const cache = new Map(); // 产品图编号 → { curKey, dataUrl, mask, maskKey }（编辑用，不保存）
  const sel = new Set(); // 选中的结果
  let tpls = [];
  const MODES = {
    white: { label: "抠白底图 1:1", locks: { ratio: "1:1", background: "white" }, outSizes: ["800", "1024"], formats: ["jpeg", "png-alpha"] },
    refine: { label: "图片精修", locks: { ratio: "auto", fill: "keep", angle: "keep", retouch: "on" }, outSizes: ["original", "800", "1024"], formats: ["jpeg", "png", "png-alpha"] }, // PNG 可选（Lee 2026-10-25）；透明底只在白底时能用
    free: { label: "自由模式", locks: {}, outSizes: ["800", "1024", "original"], formats: ["jpeg", "png", "png-alpha"] },
  };
  const LABELS = { outSize: { 800: "800×800", 1024: "1K（1024）", original: "AI 原尺寸" }, format: { jpeg: "JPG", png: "PNG", "png-alpha": "PNG 透明底" } };
  const SITES = [["", "按 AI 分工（默认 Copilot）"], ["gemini", "只用 Gemini"], ["copilot", "只用 Copilot"]];
  const blobUrl = (key) => "/api/blobs/" + encodeURIComponent(key);
  let req = "", productName = ""; // 精修要求、产品名：不保存（做完一批自动清空，和插件一样）

  // ------------------------------------------------------------ 小工具
  const toast = (msg, bad) => { const t = $("toast"); t.textContent = msg; t.className = bad ? "bad" : ""; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), bad ? 6000 : 2800); };
  const modal = (html, o = {}) => new Promise((resolve) => {
    const wrap = $("modalWrap"), m = $("modal");
    m.className = o.big ? "big" : "";
    m.innerHTML = `<div class="mh"><h2>${esc(o.title || "")}</h2><button class="ghost sp" data-ret="">✕</button></div>${html}`;
    wrap.hidden = false;
    const done = (v) => { wrap.hidden = true; m.innerHTML = ""; m.onclick = null; resolve(v); };
    wrap.onmousedown = (e) => { if (e.target === wrap) done(null); };
    m.onclick = async (e) => { const b = e.target.closest("[data-ret]"); if (!b) return; const v = b.dataset.ret; if (v && o.check && (await o.check(v, m)) === false) return; done(v || null); };
    if (o.onOpen) o.onOpen(m);
  });
  const confirmBox = async (msg, yes = "确定", danger) => (await modal(`<p>${esc(msg)}</p><div class="mf"><button data-ret="">取消</button><button class="${danger ? "danger" : "primary"}" data-ret="yes">${esc(yes)}</button></div>`, { title: "请确认" })) === "yes";
  const api = async (method, url, body) => {
    const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { location.href = "/"; throw new Error("请先登录"); }
    if (!r.ok) throw new Error(d.error || `出错了（${r.status}）`);
    return d;
  };
  const putBlob = async (key, blob) => { const r = await fetch(blobUrl(key), { method: "PUT", headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob, credentials: "same-origin" }); if (!r.ok) throw new Error("图片上传失败"); };
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const toDataUrl = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  async function op(body) {
    try {
      const d = await api("POST", `/api/cutout/${encodeURIComponent(P.id)}/op`, body);
      if (d.project && P && d.project.id === P.id) { P = d.project; render(); }
      return d.project;
    } catch (e) { toast(e.message, true); return null; }
  }
  const S = () => ({ ...P.settings });

  // ------------------------------------------------------------ 产品图：取图（编辑、准备交给 AI 的图要用 dataUrl 和标注蒙版）
  async function full(f) {
    let c = cache.get(f.id);
    if (!c || c.curKey !== f.curKey) {
      const r = await fetch(blobUrl(f.curKey) + "?v=" + encodeURIComponent(f.curKey), { credentials: "same-origin" });
      c = { curKey: f.curKey, dataUrl: await toDataUrl(await r.blob()) };
      cache.set(f.id, c);
    }
    if (f.maskKey && c.maskKey !== f.maskKey) {
      const img = await loadImage(blobUrl(f.maskKey));
      const m = document.createElement("canvas");
      m.width = img.naturalWidth; m.height = img.naturalHeight;
      m.getContext("2d").drawImage(img, 0, 0);
      c.mask = m; c.maskKey = f.maskKey;
    }
    if (!f.maskKey) { c.mask = null; c.maskKey = ""; }
    let orig = null;
    if (f.key !== f.curKey) { const r = await fetch(blobUrl(f.key), { credentials: "same-origin" }); const b = await r.blob(); orig = { dataUrl: await toDataUrl(b), w: f.ow || f.w, h: f.oh || f.h, type: b.type, size: b.size }; }
    return { ...f, dataUrl: c.dataUrl, base64: c.dataUrl.split(",")[1], mask: c.mask || null, orig };
  }
  async function addFiles(fileList, fromLibrary) {
    const imgs = [...fileList].filter((f) => /^image\//.test(f.type));
    let n = 0;
    for (const f of imgs) {
      try {
        const img = await loadImage(URL.createObjectURL(f));
        const id = uid("f");
        const key = `${P.id}:${id}-orig`;
        await putBlob(key, f);
        await op({ op: "addFile", id, key, name: f.name && f.name !== "image.png" ? f.name : `粘贴-${id.slice(-4)}.png`, w: img.naturalWidth, h: img.naturalHeight, fromLibrary });
        n++;
      } catch (e) { toast(`${f.name} 打不开：${e.message}`, true); }
    }
    if (n) toast(`加了 ${n} 张图`);
  }
  /** 产品图去白边：保存 = 替换原图；另存 = 新产品图，放在原图后面 */
  async function peFile(fid) {
    const f = P.files.find((x) => x.id === fid);
    if (!f) return;
    const r = await PNGEDIT.open({ src: blobUrl(f.curKey), name: f.name });
    if (!r) return;
    const id = uid("f");
    const key = `${P.id}:${id}-orig`;
    await putBlob(key, r.blob);
    cache.delete(f.id);
    if (r.how === "save") { await op({ op: "replaceFile", fid: f.id, key, name: r.name, w: r.w, h: r.h }); return toast("去白边保存好了"); }
    await op({ op: "addFile", id, key, name: r.name, w: r.w, h: r.h, after: f.id, libTag: "白底图" });
    toast("去白边的图另存好了（在原图后面，也放进了素材中心）");
  }
  async function openEditor(i) {
    const list = await Promise.all(P.files.map(full));
    CE.open(list, i, {
      toast,
      onRemove: (f) => op({ op: "delFiles", fids: [f.id] }),
      onClose: async (changed) => {
        for (const f of changed) {
          const fields = { crop: f.crop, lasso: f.lasso, colors: f.colors || [], partsNote: f.partsNote || "", parts: f.parts || [] };
          if (f.rotDirty) {
            const key = `${P.id}:${f.id}-rot-${Date.now()}`;
            await putBlob(key, f.rotBlob);
            Object.assign(fields, { curKey: key, w: f.w, h: f.h, type: f.type, rot90: f.rot90, fine: f.fine });
          }
          if (f.maskDirty) {
            if (f.mask && f.parts && f.parts.length) {
              const key = `${P.id}:${f.id}-mask-${Date.now()}`;
              await putBlob(key, await canvasToBlob(f.mask, "image/png"));
              fields.maskKey = key;
            } else fields.maskKey = "";
          }
          await op({ op: "setFile", fid: f.id, fields });
        }
      },
    });
  }

  /** 原图是什么格式：JPG / PNG / PNG 透明底（四周大多透明） */
  async function fileFormat(f) {
    const type = f.type || "";
    if (type !== "image/png") return "jpeg";
    try {
      const img = await loadImage(blobUrl(f.key || f.curKey));
      const W = img.naturalWidth, H = img.naturalHeight, k = Math.min(1, 200 / Math.max(W, H));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(H * k));
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0, c.width, c.height);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0, clear = 0;
      const at = (x, y) => { n++; if (d[(y * c.width + x) * 4 + 3] < 20) clear++; };
      for (let x = 0; x < c.width; x++) { at(x, 0); at(x, c.height - 1); }
      for (let y = 0; y < c.height; y++) { at(0, y); at(c.width - 1, y); }
      return clear / n > 0.6 ? "png-alpha" : "png";
    } catch { return "png"; }
  }

  // ------------------------------------------------------------ 开始一批
  async function startBatch(files, redoOf) {
    const s = S();
    // ✓ 只是提示做过；打 × 的不做，其他的不管做没做过都做（超过每批张数时先做没做过的）
    const todo = files || P.files.filter((f) => !f.skip).sort((a, b) => !!a.done - !!b.done).slice(0, Math.max(1, +s.batchSize || 10));
    if (!todo.length) return toast(P.files.length ? "产品图都打了 ×（不做）。点左上角的 × 取消，就会做这张" : "先加产品图", true);
    $("startBtn").disabled = true;
    const jobs = [];
    try {
      for (const f0 of todo) {
        const f = await full(f0);
        const aiRatio = s.mode === "white" ? "1:1" : s.mode === "refine" || s.ratio === "auto" ? closestAiRatio(inputSize(f).w || 1, inputSize(f).h || 1) : s.ratio;
        const input = await prepareInput(f, { single: true });
        const id = redoOf ? redoOf.id : uid("j");
        const inKey = `${P.id}:${id}-in-${Date.now()}`;
        await putBlob(inKey, await (await fetch(input.dataUrl)).blob());
        const r0 = redoOf && !req.trim() ? redoOf.req : req;
        const n0 = redoOf && !productName.trim() ? redoOf.productName : productName;
        // 精修 + 原图背景：每张按原图的格式出；原图是透明 PNG 就出透明底（AI 画白底，再去白底）
        const over = s.mode === "refine" && s.refineBg === "original" && s.formatAuto ? { format: await fileFormat(f0) } : null;
        if (over && over.format === "png-alpha") over.refineBg = "white";
        const s1 = { ...s, ...(over || {}) };
        const ps = { ...s1, requirement: fillProduct(r0 || "", n0 || ""), productName: n0 || "", background: s1.mode === "refine" ? s1.refineBg : s1.background };
        jobs.push({ id, redoOf: redoOf ? redoOf.id : "", fileId: f.id, name: f.name, inKey, prompt: buildWebPrompt(ps, f, aiRatio, {}), aiRatio, inSize: { w: input.w, h: input.h }, req: r0, productName: n0, over });
      }
      await op({ op: "addJobs", jobs });
      if (!redoOf) { req = ""; productName = ""; $("requirement").value = ""; $("productName").value = ""; reqShow(); } // 做完一批自动清空（和插件一样）
      toast(`交给服务器做 ${jobs.length} 张（关掉网页也不停）`);
    } catch (e) { toast("没开始成：" + e.message, true); }
    $("startBtn").disabled = false;
  }

  // ------------------------------------------------------------ 页面
  async function route() {
    const m = /p=([^&]+)/.exec(location.hash);
    tpls = (await api("GET", "/api/meta/cutoutTpls").catch(() => ({}))).value || [];
    if (m) {
      const d = await api("GET", `/api/projects/${m[1]}`).catch(() => null);
      if (d && d.project && d.project.kind === "cutout") { P = d.project; return render(); }
      toast("项目不存在了", true);
    }
    P = null;
    renderHome();
  }
  window.addEventListener("hashchange", route);

  async function renderHome() {
    $("projName").hidden = true;
    const { list } = await api("GET", "/api/projects?kind=cutout");
    $("main").innerHTML = `<div class="head"><div><h1>抠白底图</h1><div class="muted">抠白底图 1:1 / 图片精修 / 自由模式。和 AI图图 插件右侧面板一样，但在服务器上做：网页指挥插件里的 Gemini / Copilot，关掉网页也不停。</div></div>
      <div class="sp"><button class="primary" data-act="newProj">＋ 新建抠白底图项目</button></div></div>
      ${list.length ? `<div class="pgrid">${list.map((x) => `<div class="pcard" data-open="${x.id}"><div class="pic checker">${x.firstAsset ? `<img src="${blobUrl(x.firstAsset)}" alt="">` : '<span class="muted">还没有图</span>'}</div>
        <b class="pname">${esc(x.name)}</b><div class="muted">${x.files} 张产品图 · 做好 ${x.done} 张${x.running ? ` · 正在做 ${x.running} 张` : ""}</div>
        <div class="row"><button class="sm danger" data-act="delProj" data-id="${x.id}">删除</button></div></div>`).join("")}</div>` : '<div class="empty">还没有项目，点右上角“新建抠白底图项目”。</div>'}`;
  }

  const opt = (v, t, cur) => `<option value="${v}" ${String(cur) === String(v) ? "selected" : ""}>${esc(t)}</option>`;
  function settingsHtml(s) {
    const M = MODES[s.mode] || MODES.white;
    const L = M.locks;
    const dis = (k) => (k in L ? "disabled" : "");
    const val = (k) => (k in L ? L[k] : s[k]);
    const sel = (k, list) => `<select data-s="${k}" ${dis(k)}>${list.map(([v, t]) => opt(v, t, val(k))).join("")}</select>`;
    return `
      <div class="modes">${Object.entries(MODES).map(([k, m]) => `<button data-mode="${k}" class="${s.mode === k ? "active" : ""}">${m.label}</button>`).join("")}</div>
      <div class="row" style="margin-top:12px"><b>精修要求</b><select id="tplSel" style="margin-left:auto;max-width:60%"><option value="">选择精修模板…</option>${tpls.map((t, i) => `<option value="${i}">${esc(t.name)}</option>`).join("")}</select><button class="sm" data-act="tpls">管理模板</button></div>
      <div class="row" style="margin-top:6px;flex-wrap:nowrap"><span style="white-space:nowrap">这个是：</span><input id="productName" value="${esc(productName)}" placeholder="产品名称（选填，模板里的 [产品名] 会换成它）" style="flex:1"></div>
      <textarea id="requirement" rows="3" placeholder="简单描述产品：是什么、什么材质、怎么摆放的；哪些是背景（例如：放在书上的手机壳，书本是背景）。颜色不用写，需要锁定颜色请用吸管取色。">${esc(req)}</textarea>
      <div class="muted reqfull" id="reqPreview"></div>
      <div class="sgrid">
        ${s.mode === "refine" ? `<label class="f">背景<select data-s="refineBg">${opt("original", "原图背景", s.refineBg)}${opt("white", "白底图", s.refineBg)}${opt("custom", "自定义（写在精修要求里）", s.refineBg)}</select></label>` : `<label class="f">背景${sel("background", [["white", "白底图"], ["original", "原图背景"]])}</label>`}
        <label class="f">尺寸比例${sel("ratio", [["auto", "自动（跟原图）"], ["1:1", "1:1 正方形"], ["3:4", "3:4 竖版"], ["4:3", "4:3 横版"], ["2:3", "2:3 竖版"], ["3:2", "3:2 横版"], ["4:5", "4:5 竖版"], ["5:4", "5:4 横版"], ["9:16", "9:16 竖屏"], ["16:9", "16:9 宽屏"]])}</label>
        <label class="f">输出尺寸<select data-s="outSize">${M.outSizes.map((v) => opt(v, LABELS.outSize[v], s.outSize)).join("")}</select></label>
        <label class="f">输出格式<select data-s="format" ${dis("format")}>${M.formats.map((v) => opt(v, LABELS.format[v], val("format"))).join("")}</select>${s.mode === "refine" && s.refineBg === "original" && s.formatAuto ? '<span class="muted">原图背景：每张按原图的格式出（JPG / PNG / PNG 透明底）</span>' : ""}</label>
        ${val("format") === "png-alpha" ? `<label class="f" title="被产品围住的白色（戒指中间的孔、手腕绳围成的圈、金属高光）怎么处理">镂空处<select data-s="holes">${opt("auto", "自动（推荐）", s.holes)}${opt("off", "保留（白色都不抠）", s.holes)}${opt("on", "都抠透明", s.holes)}</select></label>` : ""}
        <label class="f">主体大小${sel("fill", [["keep", "保持原图"], ["70", "适中 70%"], ["85", "饱满 85%"]])}</label>
        <label class="f">拍摄角度${sel("angle", [["keep", "保持原图"], ["auto", "自动摆正"], ["front", "正面平视"], ["45", "45° 俯视"], ["top", "正上方俯拍"]])}</label>
        <label class="f">精修${sel("retouch", [["on", "精修（去瑕疵）"], ["off", "不精修"]])}</label>
        <label class="f">清晰度${sel("sharp", [["keep", "原样"], ["enhance", "提升（AI）"]])}</label>
        <label class="f">对比度${sel("contrast", [["0", "原样"], ["1", "稍微提高"], ["2", "明显提高"]])}</label>
        <label class="f">亮度${sel("bright", [["0", "原样"], ["1", "稍亮"], ["2", "更亮"]])}</label>
      </div>
      <div class="sgrid" style="margin-top:12px">
        <label class="f">用哪个 AI<select data-s="site">${SITES.map(([v, t]) => opt(v, t, s.site)).join("")}</select></label>
        <label class="f">Gemini 模型<select data-s="model">${opt("Flash", "Flash（推荐）", s.model)}${opt("Pro", "Pro", s.model)}${opt("Flash-Lite", "Flash-Lite", s.model)}${opt("", "不切换（用网页上选的）", s.model)}</select></label>
        <label class="f">每批张数<input type="number" data-s="batchSize" min="1" max="50" value="${esc(s.batchSize || 10)}"></label>
      </div>`;
  }

  let thumbUrls = new Map();
  const thumbOf = (key) => blobUrl(key);
  const isPng = (f) => f.type === "image/png";
  /** 北京时间，精确到秒：2026-10-26 18:03:57 */
  const bjTime = (ms) => { const d = new Date(ms + 8 * 3600e3), p = (n) => String(n).padStart(2, "0"); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`; };
  const isPngJob = (j) => j.ext === ".png" || /\.png$/i.test(j.outName || "");
  // 深色底：和看大图共用一个开关（lib/viewer.js 也读这个）
  const darkThumbs = () => { try { return localStorage.getItem("st:viewerDark") === "1"; } catch { return false; } };
  let rendering = false, again = false;
  async function render() { if (rendering) { again = true; return; } rendering = true; try { do { again = false; await renderProject(); } while (again); } finally { rendering = false; } }
  async function renderProject() {
    const s = { ...P.settings };
    const name = $("projName");
    name.hidden = false; name.value = P.name; name.readOnly = true; name.title = "项目名称建好以后不能改";
    const jobs = P.jobs || [];
    const nRun = jobs.filter((j) => j.status === "queued" || j.status === "running").length;
    const nDone = jobs.filter((j) => j.status === "done").length, nFail = jobs.filter((j) => j.status === "failed").length;
    for (const id of [...sel]) if (!jobs.some((j) => j.id === id)) sel.delete(id);
    const selDone = jobs.filter((j) => sel.has(j.id) && j.status === "done");
    const focused = document.activeElement && document.activeElement.id;
    const keepReq = focused === "requirement" || focused === "productName";
    if (keepReq && $("settingsBox")) { renderRight(jobs, nRun, nDone, nFail, selDone); return; } // 正在打字：只刷新右边
    $("main").innerHTML = `<div class="cwrap">
      <div class="cleft"><div class="card" id="settingsBox">${settingsHtml(s)}
        <div class="row" style="margin-top:12px"><button class="primary grow" id="startBtn" data-act="start">开始这一批</button><button data-act="stop" ${nRun ? "" : "disabled"}>停止</button></div>
        <div class="status ${nRun ? "" : nFail ? "warn" : nDone ? "ok" : ""}" id="status"></div></div></div>
      <div class="cright" id="cright"></div></div>`;
    reqShow();
    renderRight(jobs, nRun, nDone, nFail, selDone);
  }
  function renderRight(jobs, nRun, nDone, nFail, selDone) {
    const st = $("status");
    if (st) st.textContent = nRun ? `服务器正在做 ${nRun} 张（关掉网页也不停），进度看下面的结果和工作台“任务中心”。` : jobs.length ? `做好 ${nDone} 张${nFail ? `，失败 ${nFail} 张（点“重做”）` : ""}。` : "准备好了：先加图片，再点“开始这一批”。";
    const sb = document.querySelector('[data-act="stop"]');
    if (sb) sb.disabled = !nRun;
    const files = P.files || [];
    $("cright").innerHTML = `
      <div class="card"><div class="row"><b>产品图</b><span class="muted">${files.length} 张</span>
        <span class="sp row">${files.some(isPng) ? `<button class="sm ${darkThumbs() ? "on" : ""}" data-act="darkThumbs" title="PNG 透明图换深色底，看白边">深色底</button>` : ""}<button class="sm" data-act="fromLib">从素材中心选</button><button class="sm" data-act="addFiles">上传图片</button>${files.length ? '<button class="sm" data-act="clearFiles">清空</button>' : ""}</span></div>
        ${files.length ? `<div class="thumbs ${darkThumbs() ? "darkthumbs" : ""}">${files.map((f, i) => `<div class="thumb ${f.done ? "done" : ""} ${f.skip ? "skip" : ""} ${isPng(f) ? "png" : ""}" data-edit="${i}" title="${esc(f.name)}（点一下编辑：框选、标注、取色、旋转）"><img src="${thumbOf(f.curKey)}" alt="">
          <button class="sk" data-skipfile="${f.id}" title="${f.skip ? "这张不做。点一下取消 ×，就会做" : "点一下打 ×：这张不做"}">×</button>${isPng(f) ? `<span class="fmt">PNG</span><button class="pe" data-pefile="${f.id}" title="钢笔选区删除、一键去白边，另存一张新图">去白边</button>` : ""}
          ${f.crop ? `<span class="box" style="left:${f.crop.x * 100}%;top:${f.crop.y * 100}%;width:${f.crop.w * 100}%;height:${f.crop.h * 100}%"></span>` : ""}
          ${(f.parts || []).length || (f.colors || []).length ? `<span class="badge">${(f.parts || []).length ? `配件 ${f.parts.length}` : ""}${(f.colors || []).length ? ` 颜色 ${f.colors.length}` : ""}</span>` : ""}
          <button class="x" data-delfile="${f.id}" title="移除">×</button></div>`).join("")}</div>
          <div class="muted" style="margin-top:6px">点缩略图：框选商品、画笔标注配件、吸管取色、旋转。打 ✓ 的是做过的（只是提示）。不想做的点左上角打 ×，“开始这一批”会做所有没打 × 的图。</div>`
        : '<div class="empty" id="drop">点“上传图片”，或者把图片拖到这里、按 Ctrl+V 粘贴，或者“从素材中心选”<br><span class="muted">JPG / PNG / WebP，可以一次多张</span></div>'}</div>
      <div class="card"><div class="row"><b>结果</b><span class="muted">${jobs.length ? `${jobs.length} 张` : ""}</span></div>
        ${jobs.length ? `<div class="row selbar"><label class="row"><input type="checkbox" id="selAll" ${jobs.length && jobs.every((j) => sel.has(j.id)) ? "checked" : ""}> 全选</label><span class="muted">${sel.size ? `已选 ${sel.size} 张` : ""}</span>
          <span class="sp row"><button class="sm" data-act="selRedo" ${sel.size ? "" : "disabled"}>重做选中</button><button class="sm" data-act="selZip" ${selDone.length ? "" : "disabled"}>下载选中 zip</button>
          <button class="sm blue" data-act="toMain" ${selDone.length ? "" : "disabled"}>做主图</button><button class="sm blue" data-act="toDetail" ${selDone.length ? "" : "disabled"}>做详情页</button><button class="sm danger" data-act="selDel" ${sel.size ? "" : "disabled"}>删除选中</button></span></div>` : ""}
        <div id="jobs">${jobs.map((j) => jobHtml(j)).join("") || '<div class="muted">还没有结果。</div>'}</div></div>`;
  }
  function jobHtml(j) {
    const tag = j.status === "done" ? '<span class="tag ok">完成</span>' : j.status === "failed" ? '<span class="tag bad">失败</span>' : j.status === "stopped" ? '<span class="tag warn">已停止</span>' : `<span class="tag blue">${esc(j.job || "排队中")}</span>`;
    return `<div class="job" data-jid="${j.id}"><input type="checkbox" class="ck" data-ck="${j.id}" ${sel.has(j.id) ? "checked" : ""}>
      <img src="${blobUrl(j.inKey)}" data-view="in" title="交给 AI 的图" alt="">
      ${j.outKey ? `<div class="outwrap"><img class="checker ${darkThumbs() ? "dk" : ""}" src="${blobUrl(j.outKey)}" data-view="out" title="做好的图（点一下看大图）" alt="">${isPngJob(j) ? '<button class="pe" data-act="peJob" title="钢笔选区删除、一键去白边（只能保存）">去白边</button>' : ""}</div>` : '<div class="ph">…</div>'}
      <div class="col" style="gap:3px"><div class="row"><b class="jname">${esc(j.outName || j.name)}</b>${tag}${j.w ? `<span class="tag">${j.w}×${j.h}</span>` : ""}${j.site ? `<span class="tag">${esc(j.site === "gemini" ? "Gemini" : j.site === "copilot" ? "Copilot" : j.site)}</span>` : ""}${j.status === "done" && j.ended ? `<span class="tag jtime" title="做好的时间（北京时间）">${bjTime(j.ended)}</span>` : j.created ? `<span class="tag jtime" title="开始做的时间（北京时间）">提交 ${bjTime(j.created)}</span>` : ""}</div>
        ${j.note ? `<div class="muted">${esc(j.note)}</div>` : ""}${j.error ? `<div class="muted bad">${esc(j.error)}</div>` : ""}${j.req ? `<div class="muted reqfull">精修要求：${esc(fillProduct(j.req, j.productName) || j.req)}</div>` : ""}
        <div class="row">${j.outKey ? `<a href="${blobUrl(j.outKey)}" download="${esc(j.outName || "结果.jpg")}"><button class="sm">下载</button></a>` : ""}${j.aiKey ? '<button class="sm" data-act="viewAi">看 AI 原图</button>' : ""}
          <button class="sm" data-act="redo" ${j.status === "queued" || j.status === "running" ? "disabled" : ""}>重做</button>${j.outKey ? '<button class="sm" data-act="useOut" title="把这张做好的图放回产品图，接着调整">拿来接着做</button>' : ""}
          <button class="sm danger" data-act="delJob">删除</button></div></div></div>`;
  }

  // 看大图：滚轮缩放、拖动、← → 切换；做好的 PNG 可以换深色底看白边（lib/viewer.js）
  function viewer(startId, which) {
    const key = (j) => (which === "out" ? j.outKey : which === "ai" ? j.aiKey : j.inKey);
    const list = (P.jobs || []).filter(key);
    const label = which === "ai" ? "AI 原图" : which === "in" ? "交给 AI 的图" : "做好的图";
    VIEWER.open(list.map((j) => ({ src: blobUrl(key(j)), name: `${j.outName || j.name} · ${label}`, png: which === "out" && j.ext === ".png", info: which === "out" && j.w ? `${j.w}×${j.h}` : "", download: blobUrl(key(j)) })), Math.max(0, list.findIndex((j) => j.id === startId)));
  }

  async function manageTpls() {
    const draw = () => tpls.map((t, i) => `<div class="tplrow" data-i="${i}"><input data-tn value="${esc(t.name)}" placeholder="模板名"><textarea data-tt rows="2" placeholder="精修要求，可以用 [产品名]">${esc(t.text)}</textarea><button class="sm danger" data-tdel>删除</button></div>`).join("") || '<div class="muted">还没有模板。</div>';
    const r = await modal(`<div class="muted">选模板会替换精修要求里原来的内容；可以用 [产品名] 代表“这个是：”里填的产品名。所有抠白底图项目共用。</div><div id="tplBox" style="margin-top:8px">${draw()}</div>
      <button class="sm" id="tplAdd" style="margin-top:8px">添加模板</button><div class="mf"><button data-ret="">取消</button><button class="primary" data-ret="ok">保存</button></div>`, {
      title: "精修模板", big: true,
      onOpen: (m) => {
        m.querySelector("#tplAdd").onclick = () => { collect(m); tpls.push({ name: `模板 ${tpls.length + 1}`, text: "" }); m.querySelector("#tplBox").innerHTML = draw(); };
        m.querySelector("#tplBox").onclick = (e) => { if (e.target.dataset.tdel !== undefined) { collect(m); tpls.splice(+e.target.closest("[data-i]").dataset.i, 1); m.querySelector("#tplBox").innerHTML = draw(); } };
      },
      check: (v, m) => collect(m),
    });
    function collect(m) { tpls = [...m.querySelectorAll(".tplrow")].map((row) => ({ name: row.querySelector("[data-tn]").value.trim() || "模板", text: row.querySelector("[data-tt]").value })); }
    if (r === "ok") { await api("PUT", "/api/meta/cutoutTpls", { value: tpls }); toast("模板已保存"); render(); }
  }

  // ------------------------------------------------------------ 点击、输入
  const jobOf = (el) => P.jobs.find((j) => j.id === el.closest("[data-jid]").dataset.jid);
  const ACT = {
    newProj: async () => {
      let name = null;
      const ok = await modal(`<input id="npName" style="width:100%" placeholder="如：钱包"><div class="muted" style="margin-top:6px">只填名字，会自动变成“白底图-钱包10-24-1”（月-日-当天第几个项目），建好以后不能改。</div>
        <div class="mf"><button data-ret="">取消</button><button class="primary" data-ret="ok">新建</button></div>`, { title: "新建抠白底图项目", onOpen: (m) => { const i = m.querySelector("#npName"); i.focus(); i.onkeydown = (e) => { if (e.key === "Enter") m.querySelector('[data-ret="ok"]').click(); }; }, check: (v, m) => { name = m.querySelector("#npName").value.trim(); } });
      if (ok !== "ok") return;
      const d = await api("POST", "/api/cutout", { name });
      location.hash = "#p=" + d.id;
    },
    delProj: async (el, e) => { e.stopPropagation(); if (!(await confirmBox("删除这个抠白底图项目？里面的图都会删掉（已经放进素材中心的不受影响）。", "删除", true))) return; await api("DELETE", `/api/projects/${el.dataset.id}`); renderHome(); },
    addFiles: () => { const i = document.createElement("input"); i.type = "file"; i.accept = "image/png,image/jpeg,image/webp"; i.multiple = true; i.onchange = () => addFiles(i.files); i.click(); },
    fromLib: async () => {
      const list = await LIB.pick({ title: "从素材中心选产品图" });
      if (!list || !list.length) return;
      try { await api("POST", "/api/library/send", { to: "cutout", projectId: P.id, ids: list.map((x) => x.id) }); toast(`从素材中心放进来 ${list.length} 张`); pull(); } catch (e) { toast(e.message, true); }
    },
    darkThumbs: () => { try { localStorage.setItem("st:viewerDark", darkThumbs() ? "0" : "1"); } catch {} render(); },
    clearFiles: async () => { if (await confirmBox("清空所有产品图？（结果不受影响）", "清空", true)) op({ op: "delFiles", fids: P.files.map((f) => f.id) }); },
    start: () => startBatch(),
    stop: () => op({ op: "stop" }),
    tpls: () => manageTpls(),
    redo: async (el) => { const j = jobOf(el); const f = P.files.find((x) => x.id === j.fileId); if (!f) return toast("这张产品图已经移除了，没法重做", true); await startBatch([f], j); },
    selRedo: async () => { for (const j of P.jobs.filter((x) => sel.has(x.id) && x.status !== "queued" && x.status !== "running")) { const f = P.files.find((x) => x.id === j.fileId); if (f) await startBatch([f], j); } },
    // 去白边（lib/pngedit.js）：另存成一条新结果，放在原来那条后面
    peJob: async (el) => {
      const j = jobOf(el);
      // 结果只能“保存”（替换），另存是灰的（Lee 2026-10-26）
      const r = await PNGEDIT.open({ src: blobUrl(j.outKey), name: j.outName || j.name, saveAs: false });
      if (!r) return;
      const key = `${P.id}:${uid("e")}-edit-${Date.now()}`;
      await putBlob(key, r.blob);
      await op({ op: "replaceOutput", jid: j.id, key, w: r.w, h: r.h });
      toast("去白边保存好了（素材中心里那张也换了）");
    },
    useOut: async (el) => { const replace = await confirmBox("把这张做好的图放回产品图接着调整：要清空现有的产品图吗？（选“不清空”就加在后面）", "清空后放进去"); op({ op: "useOutput", jid: jobOf(el).id, replace }); },
    delJob: (el) => op({ op: "delJobs", jids: [jobOf(el).id] }),
    selDel: async () => { if (await confirmBox(`删除选中的 ${sel.size} 条结果？`, "删除", true)) { op({ op: "delJobs", jids: [...sel] }); sel.clear(); } },
    selZip: async () => {
      const files = [];
      for (const j of P.jobs.filter((x) => sel.has(x.id) && x.outKey)) files.push({ name: j.outName || `${j.id}.jpg`, blob: await (await fetch(blobUrl(j.outKey), { credentials: "same-origin" })).blob() });
      const a = document.createElement("a"); a.href = URL.createObjectURL(await makeZip(files)); a.download = `${P.name}.zip`; a.click();
    },
    toMain: () => LIB.sendDialog(P.jobs.filter((j) => sel.has(j.id) && j.libId).map((j) => j.libId), "main"),
    toDetail: () => LIB.sendDialog(P.jobs.filter((j) => sel.has(j.id) && j.libId).map((j) => j.libId), "detail"),
    viewAi: (el) => viewer(jobOf(el).id, "ai"),
  };
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("#modal") || t.closest("#ceModal") || t.closest("#libLayer")) return;
    if (t.dataset.pefile) { e.stopPropagation(); peFile(t.dataset.pefile); return; }
    if (t.dataset.skipfile) { e.stopPropagation(); const f = P.files.find((x) => x.id === t.dataset.skipfile); if (f) op({ op: "setFile", fid: f.id, fields: { skip: !f.skip } }); return; }
    if (t.dataset.delfile) { e.stopPropagation(); op({ op: "delFiles", fids: [t.dataset.delfile] }); return; }
    const b = t.closest("[data-act]");
    if (b && !b.disabled && ACT[b.dataset.act]) { ACT[b.dataset.act](b, e); return; }
    if (t.closest("[data-edit]")) { openEditor(+t.closest("[data-edit]").dataset.edit); return; }
    if (t.closest("[data-mode]") && P) { const mode = t.closest("[data-mode]").dataset.mode; const L = MODES[mode].locks; const s = { mode, ...L }; if (!MODES[mode].outSizes.includes(P.settings.outSize)) s.outSize = MODES[mode].outSizes[0]; if (!MODES[mode].formats.includes(L.format || P.settings.format)) s.format = MODES[mode].formats[0]; if (mode === "refine" && (s.format || P.settings.format) === "png-alpha") s.refineBg = "white"; op({ op: "settings", settings: s }); return; }
    if (t.dataset.view) { viewer(t.closest("[data-jid]").dataset.jid, t.dataset.view); return; }
    if (t.dataset.ck) { t.checked ? sel.add(t.dataset.ck) : sel.delete(t.dataset.ck); render(); return; }
    const open = t.closest("[data-open]");
    if (open) location.hash = "#p=" + open.dataset.open;
  });
  document.addEventListener("change", async (e) => {
    const t = e.target;
    if (!P) return;
    if (t.dataset.s) {
      const set = { [t.dataset.s]: t.type === "number" ? Math.max(1, Math.min(50, +t.value || 10)) : t.value };
      // 精修：背景和输出格式联动（Lee 2026-10-26）。选 PNG 透明底 → 背景变白底；背景选原图背景 → 每张按原图的格式出
      if (P.settings.mode === "refine") {
        if (t.dataset.s === "format") { set.formatAuto = false; if (t.value === "png-alpha") set.refineBg = "white"; }
        if (t.dataset.s === "refineBg" && t.value === "original") { set.formatAuto = true; const f = P.files.find((x) => !x.skip) || P.files[0]; if (f) set.format = await fileFormat(f); }
        if (t.dataset.s === "refineBg" && t.value === "custom" && P.settings.format === "png-alpha") set.format = "png";
      }
      op({ op: "settings", settings: set });
    }
    if (t.id === "selAll") { for (const j of P.jobs) t.checked ? sel.add(j.id) : sel.delete(j.id); render(); }
    if (t.id === "tplSel" && t.value !== "") { const tp = tpls[+t.value]; if (tp) { req = tp.text; $("requirement").value = req; reqShow(); } t.value = ""; }
  });
  document.addEventListener("input", (e) => { if (e.target.id === "requirement") req = e.target.value; if (e.target.id === "productName") productName = e.target.value; if (e.target.id === "requirement" || e.target.id === "productName") reqShow(); });
  /** 精修要求显示完整（Lee 2026-10-26）：输入框跟着内容变高；用了模板时下面显示换好产品名的完整要求（就是发给 AI 的那句） */
  function reqShow() {
    const ta = $("requirement"), pv = $("reqPreview");
    if (ta) { ta.style.height = "auto"; ta.style.height = Math.max(ta.scrollHeight + 2, 64) + "px"; }
    if (!pv) return;
    const has = /[\[{【]产品名[\]}】]/.test(req);
    pv.textContent = has ? (productName.trim() ? `发给 AI 的要求：${fillProduct(req, productName.trim())}` : "“这个是：”填上产品名，模板里的 [产品名] 会换成它（不填的话，带 [产品名] 的那句不发）") : "";
    pv.hidden = !has;
  }
  document.addEventListener("dragover", (e) => { if (P) e.preventDefault(); });
  document.addEventListener("drop", (e) => { if (!P) return; e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  document.addEventListener("paste", (e) => {
    if (!P || /INPUT|TEXTAREA/.test(document.activeElement.tagName) || $("ceModal")?.classList.contains("show")) return;
    const fl = [...((e.clipboardData && e.clipboardData.files) || [])];
    if (fl.length) { e.preventDefault(); addFiles(fl); }
  });

  // 服务器推送：项目变了（后台做完一张）就取最新的
  let pullT = null;
  const pull = async () => { if (!P) return; const d = await api("GET", `/api/projects/${P.id}`).catch(() => null); if (d && d.project && P && d.project.id === P.id) { P = d.project; render(); } };
  try {
    const es = new EventSource("/api/events");
    es.addEventListener("project", (e) => {
      let d = {};
      try { d = JSON.parse(e.data); } catch {}
      if (P && d.id === P.id && !d.deleted && (d.rev || 0) > (P.rev || 0)) { clearTimeout(pullT); pullT = setTimeout(pull, 200); }
      else if (!P && d.kind === "cutout") { clearTimeout(pullT); pullT = setTimeout(renderHome, 500); }
    });
  } catch {}
  route().catch((e) => { $("main").innerHTML = `<div class="note warn">出错了：${esc(e.message)}</div>`; });
})();
