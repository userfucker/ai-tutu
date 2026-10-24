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
    refine: { label: "图片精修", locks: { ratio: "auto", fill: "keep", angle: "keep", retouch: "on", format: "jpeg" }, outSizes: ["original", "800", "1024"], formats: ["jpeg"] },
    free: { label: "自由模式", locks: {}, outSizes: ["800", "1024", "original"], formats: ["jpeg", "png", "png-alpha"] },
  };
  const LABELS = { outSize: { 800: "800×800", 1024: "1K（1024）", original: "AI 原尺寸" }, format: { jpeg: "JPG", png: "PNG", "png-alpha": "PNG 透明底" } };
  const SITES = [["", "自动（Gemini / Copilot 轮流）"], ["gemini", "只用 Gemini"], ["copilot", "只用 Copilot"]];
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

  // ------------------------------------------------------------ 开始一批
  async function startBatch(files, redoOf) {
    const s = S();
    const todo = files || P.files.filter((f) => !f.done).slice(0, Math.max(1, +s.batchSize || 10));
    if (!todo.length) return toast(P.files.length ? "都做过了（缩略图上有 ✓）。要再做，点结果里的“重做”" : "先加产品图", true);
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
        const ps = { ...s, requirement: fillProduct(r0 || "", n0 || ""), productName: n0 || "", background: s.mode === "refine" ? s.refineBg : s.background };
        jobs.push({ id, redoOf: redoOf ? redoOf.id : "", fileId: f.id, name: f.name, inKey, prompt: buildWebPrompt(ps, f, aiRatio, {}), aiRatio, inSize: { w: input.w, h: input.h }, req: r0, productName: n0 });
      }
      await op({ op: "addJobs", jobs });
      if (!redoOf) { req = ""; productName = ""; $("requirement").value = ""; $("productName").value = ""; } // 做完一批自动清空（和插件一样）
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
      <div class="sgrid">
        ${s.mode === "refine" ? `<label class="f">背景<select data-s="refineBg">${opt("original", "原图背景", s.refineBg)}${opt("white", "白底图", s.refineBg)}${opt("custom", "自定义（写在精修要求里）", s.refineBg)}</select></label>` : `<label class="f">背景${sel("background", [["white", "白底图"], ["original", "原图背景"]])}</label>`}
        <label class="f">尺寸比例${sel("ratio", [["auto", "自动（跟原图）"], ["1:1", "1:1 正方形"], ["3:4", "3:4 竖版"], ["4:3", "4:3 横版"], ["2:3", "2:3 竖版"], ["3:2", "3:2 横版"], ["4:5", "4:5 竖版"], ["5:4", "5:4 横版"], ["9:16", "9:16 竖屏"], ["16:9", "16:9 宽屏"]])}</label>
        <label class="f">输出尺寸<select data-s="outSize">${M.outSizes.map((v) => opt(v, LABELS.outSize[v], s.outSize)).join("")}</select></label>
        <label class="f">输出格式<select data-s="format" ${dis("format")}>${M.formats.map((v) => opt(v, LABELS.format[v], val("format"))).join("")}</select></label>
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
        <span class="sp row"><button class="sm" data-act="fromLib">从素材中心选</button><button class="sm" data-act="addFiles">上传图片</button>${files.length ? '<button class="sm" data-act="clearFiles">清空</button>' : ""}</span></div>
        ${files.length ? `<div class="thumbs">${files.map((f, i) => `<div class="thumb ${f.done ? "done" : ""}" data-edit="${i}" title="${esc(f.name)}（点一下编辑：框选、标注、取色、旋转）"><img src="${thumbOf(f.curKey)}" alt="">
          ${f.crop ? `<span class="box" style="left:${f.crop.x * 100}%;top:${f.crop.y * 100}%;width:${f.crop.w * 100}%;height:${f.crop.h * 100}%"></span>` : ""}
          ${(f.parts || []).length || (f.colors || []).length ? `<span class="badge">${(f.parts || []).length ? `配件 ${f.parts.length}` : ""}${(f.colors || []).length ? ` 颜色 ${f.colors.length}` : ""}</span>` : ""}
          <button class="x" data-delfile="${f.id}" title="移除">×</button></div>`).join("")}</div>
          <div class="muted" style="margin-top:6px">点缩略图：框选商品、画笔标注配件、吸管取色、旋转。打 ✓ 的是做过的，“开始这一批”只做没打 ✓ 的。</div>`
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
      ${j.outKey ? `<img class="checker" src="${blobUrl(j.outKey)}" data-view="out" title="做好的图（点一下看大图）" alt="">` : '<div class="ph">…</div>'}
      <div class="col" style="gap:3px"><div class="row"><b class="jname">${esc(j.outName || j.name)}</b>${tag}${j.w ? `<span class="tag">${j.w}×${j.h}</span>` : ""}${j.site ? `<span class="tag">${esc(j.site === "gemini" ? "Gemini" : j.site === "copilot" ? "Copilot" : j.site)}</span>` : ""}</div>
        ${j.note ? `<div class="muted">${esc(j.note)}</div>` : ""}${j.error ? `<div class="muted bad">${esc(j.error)}</div>` : ""}${j.req ? `<div class="muted">精修要求：${esc(j.req)}</div>` : ""}
        <div class="row">${j.outKey ? `<a href="${blobUrl(j.outKey)}" download="${esc(j.outName || "结果.jpg")}"><button class="sm">下载</button></a>` : ""}${j.aiKey ? '<button class="sm" data-act="viewAi">看 AI 原图</button>' : ""}
          <button class="sm" data-act="redo" ${j.status === "queued" || j.status === "running" ? "disabled" : ""}>重做</button>${j.outKey ? '<button class="sm" data-act="useOut" title="把这张做好的图放回产品图，接着调整">拿来接着做</button>' : ""}
          <button class="sm danger" data-act="delJob">删除</button></div></div></div>`;
  }

  // 看大图：做好的图左右切换
  async function viewer(startId, which) {
    const list = (P.jobs || []).filter((j) => (which === "out" ? j.outKey : which === "ai" ? j.aiKey : j.inKey));
    let i = Math.max(0, list.findIndex((j) => j.id === startId));
    const key = (j) => (which === "out" ? j.outKey : which === "ai" ? j.aiKey : j.inKey);
    const html = () => `<div style="text-align:center"><img src="${blobUrl(key(list[i]))}" class="${which === "out" ? "checker" : ""}" style="max-width:100%;max-height:72vh;border-radius:8px"></div><div class="row" style="margin-top:8px"><b>${esc(list[i].outName || list[i].name)}</b><span class="sp muted">${i + 1} / ${list.length}（← → 切换）</span></div>`;
    const k = (e) => { if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return; i = (i + (e.key === "ArrowLeft" ? -1 : 1) + list.length) % list.length; const b = document.querySelector("#modal .vbox"); if (b) b.innerHTML = html(); };
    document.addEventListener("keydown", k);
    await modal(`<div class="vbox">${html()}</div>`, { title: which === "ai" ? "AI 原图" : which === "in" ? "交给 AI 的图" : "做好的图", big: true });
    document.removeEventListener("keydown", k);
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
    clearFiles: async () => { if (await confirmBox("清空所有产品图？（结果不受影响）", "清空", true)) op({ op: "delFiles", fids: P.files.map((f) => f.id) }); },
    start: () => startBatch(),
    stop: () => op({ op: "stop" }),
    tpls: () => manageTpls(),
    redo: async (el) => { const j = jobOf(el); const f = P.files.find((x) => x.id === j.fileId); if (!f) return toast("这张产品图已经移除了，没法重做", true); await startBatch([f], j); },
    selRedo: async () => { for (const j of P.jobs.filter((x) => sel.has(x.id) && x.status !== "queued" && x.status !== "running")) { const f = P.files.find((x) => x.id === j.fileId); if (f) await startBatch([f], j); } },
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
    if (t.dataset.delfile) { e.stopPropagation(); op({ op: "delFiles", fids: [t.dataset.delfile] }); return; }
    const b = t.closest("[data-act]");
    if (b && !b.disabled && ACT[b.dataset.act]) { ACT[b.dataset.act](b, e); return; }
    if (t.closest("[data-edit]")) { openEditor(+t.closest("[data-edit]").dataset.edit); return; }
    if (t.closest("[data-mode]") && P) { const mode = t.closest("[data-mode]").dataset.mode; const L = MODES[mode].locks; const s = { mode, ...L }; if (!MODES[mode].outSizes.includes(P.settings.outSize)) s.outSize = MODES[mode].outSizes[0]; if (!MODES[mode].formats.includes(L.format || P.settings.format)) s.format = MODES[mode].formats[0]; op({ op: "settings", settings: s }); return; }
    if (t.dataset.view) { viewer(t.closest("[data-jid]").dataset.jid, t.dataset.view); return; }
    if (t.dataset.ck) { t.checked ? sel.add(t.dataset.ck) : sel.delete(t.dataset.ck); render(); return; }
    const open = t.closest("[data-open]");
    if (open) location.hash = "#p=" + open.dataset.open;
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (!P) return;
    if (t.dataset.s) op({ op: "settings", settings: { [t.dataset.s]: t.type === "number" ? Math.max(1, Math.min(50, +t.value || 10)) : t.value } });
    if (t.id === "selAll") { for (const j of P.jobs) t.checked ? sel.add(j.id) : sel.delete(j.id); render(); }
    if (t.id === "tplSel" && t.value !== "") { const tp = tpls[+t.value]; if (tp) { req = tp.text; $("requirement").value = req; } t.value = ""; }
  });
  document.addEventListener("input", (e) => { if (e.target.id === "requirement") req = e.target.value; if (e.target.id === "productName") productName = e.target.value; });
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
