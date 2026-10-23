/**
 * 主图（Lee 2026-10-23）：上传白底图 → 选几种背景风格 → AI 画空背景 → 程序把产品贴上 → AI 只调光影融入（B 方式，检查产品没变样）
 * → 先放在“待确认”，采用后可以下载（800×800 或 1000×1000，另外带一张白底图）。
 *
 * - 风格：预设几种；也可以上传一张图让 AI 识别背景风格，存成“我的风格”（所有主图项目共用，存在 meta mainStyles）；也可以自己写。
 * - Gemini / Copilot 轮流画（“AI 分工 → 主图”里可以单独选网站），这里也可以临时指定一个。
 * - 目前只能手动做（不进全自动），默认不加文字。
 * 项目存在详情页同一张表里（kind = "main"），图片键名“项目编号:…”，“我的风格”的参考图键名“mstyle:…”。
 */
(() => {
  const esc = ST.esc;
  const $ = (id) => document.getElementById(id);
  const APP = (globalThis.APP = { project: null });
  const P = () => APP.project;
  const SIZES = [800, 1000];
  const SITES = [["", "自动（按 AI 分工轮流）"], ["gemini", "Gemini"], ["copilot", "Copilot"]];
  const ls = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  let site = ls.get("st:mainSite", "");
  let myStyles = []; // [{ id, name, desc, prompt, ref }]
  const jobs = new Map(); // 主图编号 / 产品编号 → 正在做什么（不保存）
  const thumbs = new Map(); // 主图编号 → { sig, url }

  // ------------------------------------------------------------ 小工具：提示、弹窗、保存
  APP.toast = (msg, bad) => {
    const t = $("toast");
    t.textContent = msg;
    t.className = bad ? "bad" : "";
    t.hidden = false;
    clearTimeout(APP.toast.t);
    APP.toast.t = setTimeout(() => (t.hidden = true), bad ? 6000 : 2800);
  };
  APP.modal = (html, o = {}) => new Promise((resolve) => {
    const wrap = $("modalWrap"), m = $("modal");
    m.className = o.big ? "big" : "";
    m.innerHTML = `<div class="mh"><h2>${esc(o.title || "")}</h2><button class="ghost sp" data-ret="">✕</button></div>${html}`;
    wrap.hidden = false;
    const done = (v) => { wrap.hidden = true; m.innerHTML = ""; m.onclick = null; wrap.onmousedown = null; document.removeEventListener("keydown", key); resolve(v); };
    const key = (e) => { if (e.key === "Escape") done(null); };
    document.addEventListener("keydown", key);
    wrap.onmousedown = (e) => { if (e.target === wrap) done(null); };
    m.onclick = async (e) => {
      const b = e.target.closest("[data-ret]");
      if (!b) return;
      const v = b.dataset.ret;
      if (v && o.check) { const ok = await o.check(v, m); if (ok === false) return; }
      done(v === "" ? null : v);
    };
    if (o.onOpen) o.onOpen(m, done);
  });
  const confirm = async (msg, yes = "确定", danger) => (await APP.modal(`<p>${esc(msg)}</p><div class="mf"><button data-ret="">取消</button><button class="${danger ? "danger" : "primary"}" data-ret="yes">${esc(yes)}</button></div>`, { title: "请确认" })) === "yes";
  const save = () => (P() ? ST.db.putProject(P()).catch((e) => APP.toast("保存失败：" + e.message, true)) : Promise.resolve());
  let saveT;
  const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(save, 500); };
  const pick = (accept, multiple) => new Promise((resolve) => {
    const i = document.createElement("input");
    i.type = "file"; i.accept = accept; i.multiple = !!multiple;
    i.onchange = () => resolve([...i.files]);
    i.click();
  });
  const download = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000); };
  const hash = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0; return h.toString(36); };
  const cancelled = (e) => !!(e && e.result && e.result.cancelled);

  // AI：任务交给工作台排队（ai.js），opt = { role, sites, rotate }
  const aiImage = async (prompt, images, label, opt) => (await ST.AI.run("image", prompt, images, { label, ...opt })).blob;
  const aiJson = async (prompt, images, label, opt) => { const r = await ST.AI.run("text", prompt, images, { label, ...opt }); return ST.extractJson(r.text, r.codes); };
  const sites = () => (site ? [site] : undefined);

  // ------------------------------------------------------------ 我的风格（所有主图项目共用）
  const loadMyStyles = async () => { myStyles = (await ST.db.getMeta("mainStyles", [])) || []; };
  const saveMyStyles = () => ST.db.setMeta("mainStyles", myStyles);
  /** 选中的风格 → [{ id, name, prompt, ref }] */
  function chosenStyles(p) {
    const out = [];
    for (const id of p.styles || []) {
      const pre = ST.MAIN_STYLES.find((s) => s.id === id);
      if (pre) out.push({ id, name: pre.name, prompt: pre.prompt, ref: "" });
      const my = id.startsWith("my:") && myStyles.find((s) => "my:" + s.id === id);
      if (my) out.push({ id, name: my.name, prompt: my.prompt, ref: my.useRef !== false ? my.ref : "" });
    }
    if (p.customOn && String(p.custom || "").trim()) out.push({ id: "custom", name: "自己写的", prompt: p.custom.trim(), ref: "" });
    return out;
  }

  // ------------------------------------------------------------ 产品图：去白底 / AI 抠图
  const curProduct = (p = P()) => (p.products || []).find((x) => x.id === p.cur) || (p.products || [])[0] || null;
  async function cutWhite(pr, srcBlob) {
    const p = P();
    const img = await ST.blobToImage(srcBlob);
    const out = await composeOutput(img, { ratio: null, inputRatio: img.naturalWidth / img.naturalHeight, inputSize: { w: img.naturalWidth, h: img.naturalHeight }, outSize: "original", fill: "keep", background: "white", format: "png-alpha", contrast: "0", bright: "0", holes: "auto" });
    const key = `${p.id}:${pr.id}-cut`;
    await ST.saveImage(key, out.blob || srcBlob);
    const cimg = await ST.imgOf(key);
    pr.cut = key;
    pr.cutBox = ST.alphaBox(cimg);
  }
  async function addProducts(files) {
    const p = P();
    let n = 0;
    for (const f of files.filter((f) => /^image\//.test(f.type) || ST.isImageName(f.name || ""))) {
      try {
        const blob = f.type ? f : new Blob([f], { type: ST.mimeOf(f.name) });
        const img = await ST.blobToImage(blob);
        const id = ST.uid("pr");
        const key = `${p.id}:${id}-orig`;
        await ST.saveImage(key, blob);
        const pr = { id, name: f.name || "产品图", key, w: img.naturalWidth, h: img.naturalHeight, cut: "", cutBox: null, white: "", edgeWhite: ST.edgeIsWhite(img) };
        p.products.push(pr);
        if (!p.cur) p.cur = id;
        if (pr.edgeWhite) await cutWhite(pr, blob);
        n++;
      } catch (e) { APP.toast(`${f.name} 打不开：${e.message}`, true); }
    }
    await save();
    render();
    if (n) APP.toast(`加了 ${n} 张产品图${p.products.some((x) => !x.cut) ? "；不是白底的图点“AI 抠图”" : ""}`);
  }
  async function cutAi(pr) {
    const p = P();
    jobs.set(pr.id, "AI 抠图中…");
    render();
    try {
      const white = await aiImage(ST.P.cutout(p, { note: "" }, closestAiRatio(pr.w, pr.h)), [{ blob: await ST.db.getBlob(pr.key), name: pr.name, max: 1536 }], "主图：抠图", { sites: sites() });
      pr.white = `${p.id}:${pr.id}-white`;
      await ST.saveImage(pr.white, white);
      await cutWhite(pr, white);
      jobs.delete(pr.id);
      await save();
    } catch (e) { if (cancelled(e)) jobs.delete(pr.id); else jobs.set(pr.id, "失败：" + e.message); }
    render();
  }

  // ------------------------------------------------------------ 合成：背景 + 产品（程序贴图）或融入后的图
  /** it = 一张主图；返回 { canvas, box（产品在图上的位置，像素）, sig, used（用的是融入后的图）, stale（产品挪过，融入的图作废） } */
  async function compose(it, px, useHarm = true) {
    const p = P();
    const c = ST.canvas(px, px);
    const g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    const cover = (img) => { const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, s = Math.max(px / iw, px / ih); g.drawImage(img, (px - iw * s) / 2, (px - ih * s) / 2, iw * s, ih * s); };
    const pr = (p.products || []).find((x) => x.id === it.product) || curProduct(p);
    const pos = it.pos || { x: 0.5, y: 0.56, s: 0.7 };
    const sig = hash(JSON.stringify([it.bg, pr ? pr.cut || pr.key : "", +pos.x.toFixed(3), +pos.y.toFixed(3), +pos.s.toFixed(3)]));
    const img = pr ? await ST.imgOf(pr.cut || pr.key) : null;
    const bx = pr && pr.cut && pr.cutBox ? pr.cutBox : img ? { x: 0, y: 0, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height } : null;
    let box = null;
    if (bx) {
      const max = pos.s * px, s = Math.min(max / bx.w, max / bx.h);
      const dw = bx.w * s, dh = bx.h * s;
      box = { x: pos.x * px - dw / 2, y: pos.y * px - dh / 2, w: dw, h: dh };
    }
    const hm = it.harm || {};
    const stale = !!(hm.key && hm.sig !== sig);
    if (useHarm && hm.on && hm.key && hm.sig === sig) {
      const h = await ST.imgOf(hm.key);
      if (h) { cover(h); return { canvas: c, box, sig, used: true, stale }; }
    }
    g.fillStyle = "#f2f2f2";
    g.fillRect(0, 0, px, px);
    const bg = it.bg ? await ST.imgOf(it.bg) : null;
    if (bg) cover(bg);
    if (img && box) {
      const { x: dx, y: dy, w: dw, h: dh } = box;
      if (pr.cut) {
        // 接触投影 + 投射阴影（和详情页一样，让贴图不那么“飘”）
        const gr = g.createRadialGradient(dx + dw / 2, dy + dh, 1, dx + dw / 2, dy + dh, dw * 0.45);
        gr.addColorStop(0, "rgba(0,0,0,0.2)"); gr.addColorStop(1, "rgba(0,0,0,0)");
        g.save(); g.translate(dx + dw / 2, dy + dh); g.scale(1, 0.12); g.translate(-(dx + dw / 2), -(dy + dh));
        g.fillStyle = gr; g.beginPath(); g.arc(dx + dw / 2, dy + dh, dw * 0.45, 0, Math.PI * 2); g.fill(); g.restore();
        g.save(); g.shadowColor = "rgba(0,0,0,0.22)"; g.shadowBlur = px * 0.028; g.shadowOffsetY = px * 0.014;
      }
      g.drawImage(img, bx.x, bx.y, bx.w, bx.h, dx, dy, dw, dh);
      if (pr.cut) g.restore();
    }
    return { canvas: c, box, sig, used: false, stale };
  }
  /** 白底图：产品放中间，占 80% */
  async function whiteImage(px) {
    const pr = curProduct();
    const c = ST.canvas(px, px);
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, px, px);
    const img = pr && (await ST.imgOf(pr.cut || pr.key));
    if (img) {
      const bx = pr.cut && pr.cutBox ? pr.cutBox : { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
      const s = Math.min((px * 0.8) / bx.w, (px * 0.8) / bx.h);
      g.imageSmoothingQuality = "high";
      g.drawImage(img, bx.x, bx.y, bx.w, bx.h, (px - bx.w * s) / 2, (px - bx.h * s) / 2, bx.w * s, bx.h * s);
    }
    return c;
  }

  // ------------------------------------------------------------ 生成：画背景 → 融入
  async function blendItem(it, i = 0) {
    const p = P();
    jobs.set(it.id, "融入：排队中");
    render();
    const c = await compose(it, 1024, false);
    const res = await ST.harmonizeCanvas(p, c.canvas, c.box, {
      image: (prompt, imgs, label, n) => { jobs.set(it.id, n ? "融入：重做中" : "融入中"); render(); return aiImage(prompt, imgs.map((x) => ({ ...x, max: 1536 })), label, { role: "mn_blend", sites: sites(), rotate: i + n }); },
      json: (prompt, imgs, label) => { jobs.set(it.id, "融入：检查中"); render(); return aiJson(prompt, imgs.map((x) => ({ ...x, max: 1024 })), label, { role: "mn_check", rotate: i }); },
    }, `主图 ${it.styleName}`);
    const old = it.harm && it.harm.key;
    if (res.ok) {
      const key = `${p.id}:${it.id}-harm-${Date.now()}`;
      await ST.saveImage(key, res.blob);
      it.harm = { key, sig: c.sig, on: true, status: "ok", note: res.note };
    } else it.harm = { key: "", sig: c.sig, on: false, status: "fallback", note: res.why + "；用原贴图" };
    if (old && old !== it.harm.key) { ST.forget(old); ST.db.delBlob(old); }
    await save();
    return res;
  }
  async function makeItem(it, i = 0, onlyBlend) {
    const p = P();
    try {
      if (!onlyBlend) {
        jobs.set(it.id, "画背景：排队中");
        render();
        const imgs = it.ref ? [{ blob: await ST.db.getBlob(it.ref), name: "风格参考.jpg", max: 1024 }].filter((x) => x.blob) : [];
        jobs.set(it.id, "画背景中");
        render();
        const blob = await aiImage(ST.P.mainBg(p, it.prompt, imgs.length > 0), imgs, `主图背景：${it.styleName}`, { role: "mn_bg", sites: sites(), rotate: i });
        const key = `${p.id}:${it.id}-bg-${Date.now()}`;
        await ST.saveImage(key, blob);
        const old = it.bg;
        it.bg = key;
        if (old) { ST.forget(old); ST.db.delBlob(old); }
        await save();
      }
      if (p.blend !== false || onlyBlend) {
        const r = await blendItem(it, i);
        if (!r.ok) APP.toast(`${it.styleName}：融入放弃，用原贴图（${r.why}）`, true);
      }
      jobs.delete(it.id);
    } catch (e) {
      if (cancelled(e)) jobs.delete(it.id);
      else jobs.set(it.id, "失败：" + e.message);
    }
    render();
  }
  async function generate() {
    const p = P();
    const pr = curProduct();
    if (!pr) return APP.toast("先上传产品图", true);
    if (!pr.cut) return APP.toast("这张产品图还没抠好（不是白底的图点“AI 抠图”）", true);
    const styles = chosenStyles(p);
    if (!styles.length) return APP.toast("先选至少一种背景风格", true);
    const list = [];
    for (const s of styles) for (let k = 0; k < (p.count || 1); k++) {
      const it = { id: ST.uid("it"), style: s.id, styleName: s.name, prompt: s.prompt, ref: s.ref || "", product: pr.id, bg: "", pos: { x: 0.5, y: 0.56, s: p.scale || 0.7 }, harm: null, state: "pending", t: Date.now() };
      p.items.unshift(it);
      list.push(it);
    }
    await save();
    APP.toast(`开始做 ${list.length} 张主图，画好放在“待确认”里`);
    await Promise.all(list.map((it, i) => makeItem(it, i)));
  }

  // ------------------------------------------------------------ 调整产品位置、大小
  async function adjust(it) {
    const pos = { ...(it.pos || { x: 0.5, y: 0.56, s: 0.7 }) };
    let again = true;
    const r = await APP.modal(`
      <div class="muted" style="margin-bottom:8px">拖动产品换位置，滑块改大小。改过以后，原来融入的图就不能用了（显示原贴图），可以保存后重新融入。</div>
      <div class="adjust"><canvas id="adjC"></canvas></div>
      <div class="row" style="margin-top:10px"><label class="row lb grow">大小 <input type="range" id="adjS" min="25" max="95" value="${Math.round(pos.s * 100)}" class="grow"><span id="adjV">${Math.round(pos.s * 100)}%</span></label>
        <button class="sm" id="adjReset">放回中间</button></div>
      <label class="row lb"><input type="checkbox" id="adjAgain" checked> 保存后重新融入背景</label>
      <div class="mf"><button data-ret="">取消</button><button class="primary" data-ret="ok">保存</button></div>`, {
      title: "调整产品", big: true,
      onOpen: (m) => {
        const cv = m.querySelector("#adjC");
        const draw = async () => { const c = await compose({ ...it, pos }, 720, false); cv.width = c.canvas.width; cv.height = c.canvas.height; cv.getContext("2d").drawImage(c.canvas, 0, 0); };
        draw();
        m.querySelector("#adjS").oninput = (e) => { pos.s = +e.target.value / 100; m.querySelector("#adjV").textContent = e.target.value + "%"; draw(); };
        m.querySelector("#adjReset").onclick = () => { pos.x = 0.5; pos.y = 0.56; draw(); };
        m.querySelector("#adjAgain").onchange = (e) => (again = e.target.checked);
        let d0 = null;
        cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); d0 = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }; };
        cv.onpointermove = (e) => {
          if (!d0) return;
          const b = cv.getBoundingClientRect();
          pos.x = ST.clamp(d0.px + (e.clientX - d0.x) / b.width, 0.1, 0.9);
          pos.y = ST.clamp(d0.py + (e.clientY - d0.y) / b.height, 0.1, 0.9);
          draw();
        };
        cv.onpointerup = () => (d0 = null);
      },
    });
    if (r !== "ok") return;
    it.pos = pos;
    await save();
    render();
    if (again && it.bg) makeItem(it, 0, true);
  }

  // ------------------------------------------------------------ 识别风格（上传图片）
  async function learnStyle() {
    const [f] = await pick("image/*");
    if (!f) return;
    APP.toast("AI 正在看这张图的背景风格…");
    let r;
    try { r = await aiJson(ST.P.styleOf(), [{ blob: f, name: "风格参考.jpg", max: 1024 }], "识别背景风格", { role: "mn_style" }); }
    catch (e) { if (!cancelled(e)) APP.toast("识别没成功：" + e.message, true); return; }
    const url = URL.createObjectURL(f);
    let st = null;
    const ok = await APP.modal(`
      <div class="row" style="align-items:flex-start;gap:14px"><img src="${url}" style="width:160px;border-radius:8px">
      <div class="grow col" style="gap:8px">
        <label class="f">风格名称<input id="lsName" value="${esc(r.name || "我的风格")}"></label>
        <label class="f">说明（中文，给你看的）<input id="lsDesc" value="${esc(r.desc || "")}"></label>
        <label class="f">给画图 AI 的描述（英文）<textarea id="lsPrompt" rows="4">${esc(r.prompt || "")}</textarea></label>
        <label class="row lb"><input type="checkbox" id="lsRef" checked> 画背景时也把这张图发给 AI 当参考（更像，但可能学到里面的东西）</label></div></div>
      <div class="mf"><button data-ret="">不要</button><button class="primary" data-ret="ok">保存到“我的风格”</button></div>`, {
      title: "AI 识别的背景风格", big: true,
      check: (v, m) => {
        const prompt = m.querySelector("#lsPrompt").value.trim();
        if (!prompt) { APP.toast("描述不能为空", true); return false; }
        st = { id: ST.uid("s"), name: m.querySelector("#lsName").value.trim().slice(0, 12) || "我的风格", desc: m.querySelector("#lsDesc").value.trim(), prompt, useRef: m.querySelector("#lsRef").checked, t: Date.now() };
      },
    });
    URL.revokeObjectURL(url);
    if (ok !== "ok" || !st) return;
    st.ref = `mstyle:${st.id}`;
    await ST.saveImage(st.ref, await ST.shrink(f, 1024));
    myStyles.push(st);
    await saveMyStyles();
    const p = P();
    if (p) { p.styles = [...new Set([...(p.styles || []), "my:" + st.id])]; await save(); }
    APP.toast(`已保存“${st.name}”，以后的主图项目都能用`);
    render();
  }

  // ------------------------------------------------------------ 页面
  async function route() {
    const m = /p=([^&]+)/.exec(location.hash);
    await loadMyStyles().catch(() => {});
    if (m) {
      const p = await ST.db.getProject(decodeURIComponent(m[1])).catch(() => null);
      if (p && p.kind === "main") { APP.project = p; return render(); }
      APP.toast("项目不存在了", true);
    }
    APP.project = null;
    renderHome();
  }
  window.addEventListener("hashchange", route);

  async function renderHome() {
    $("projName").hidden = true;
    const r = await fetch("/api/projects?kind=main", { credentials: "same-origin" });
    if (r.status === 401) { location.href = "/"; return; }
    const { list } = await r.json();
    const cards = await Promise.all(list.map(async (x) => `<div class="mcard proj" data-open="${x.id}"><div class="pic ${x.firstAsset ? "checker" : ""}">${x.firstAsset ? `<img src="${await ST.urlOf(x.firstAsset)}" alt="">` : '<span class="muted">还没有产品图</span>'}</div>
      <b>${esc(x.name)}</b><div class="muted">${x.items} 张主图 · 采用 ${x.done} 张 · ${esc(ST.bj(x.updated).slice(5, 16))}</div>
      <div class="acts"><button class="sm danger" data-act="delProj" data-id="${x.id}">删除</button></div></div>`));
    $("main").innerHTML = `<div class="head"><div><h1>主图</h1><div class="muted">上传白底图，选几种背景风格，AI 画背景、程序贴产品、AI 调光影融入（产品不变）。800×800 或 1000×1000。</div></div>
      <div class="sp"><button class="primary" data-act="newProj">＋ 新建主图项目</button></div></div>
      ${list.length ? `<div class="mcards">${cards.join("")}</div>` : '<div class="empty">还没有主图项目，点右上角“新建主图项目”。</div>'}`;
  }

  async function itemCard(it, i) {
    const st = jobs.get(it.id) || "";
    let url = "";
    if (it.bg) {
      const k = JSON.stringify([it.bg, it.pos, it.harm, it.product]);
      const t = thumbs.get(it.id);
      if (t && t.k === k) url = t.url;
      else {
        const c = await compose(it, 360);
        url = URL.createObjectURL(await ST.toBlob(c.canvas, "image/jpeg", 0.85));
        if (t) URL.revokeObjectURL(t.url);
        thumbs.set(it.id, { k, url });
      }
    }
    const hm = it.harm || {};
    const c = it.bg ? await compose(it, 64) : null;
    const busy = st && !/失败/.test(st);
    const has = hm.key && c && !c.stale;
    const line = st ? "" : c && c.stale ? "产品改过了，显示原贴图；点“重新融入”" : hm.status === "fallback" ? hm.note : has ? (hm.on ? "融入后" : "原贴图") + (hm.note ? "；" + hm.note : "") : it.bg ? "原贴图（没有融入）" : "";
    return `<div class="mcard" data-iid="${it.id}">
      <div class="pic" data-act="view">${url ? `<img src="${url}" alt="">` : ""}${st ? `<span class="st tag ${/失败/.test(st) ? "bad" : "blue"}">${esc(st)}</span>` : ""}</div>
      <div class="row"><b>${esc(it.styleName)}</b>${has ? `<span class="sp pills"><span class="pill ${hm.on ? "on" : ""}" data-act="harmView" data-v="1">融入后</span><span class="pill ${hm.on ? "" : "on"}" data-act="harmView" data-v="0">原贴图</span></span>` : ""}</div>
      ${line ? `<div class="muted">${esc(line)}</div>` : ""}
      <div class="acts">
        ${it.state === "ok" ? `<button class="sm primary" data-act="dlOne">下载</button><button class="sm" data-act="unaccept">取消采用</button>` : `<button class="sm primary" data-act="accept" ${it.bg && !busy ? "" : "disabled"}>采用</button>`}
        <button class="sm" data-act="adjust" ${it.bg && !busy ? "" : "disabled"}>调整产品</button>
        <button class="sm" data-act="reblend" ${it.bg && !busy ? "" : "disabled"}>${hm.key || hm.status ? "重新融入" : "融入背景"}</button>
        <button class="sm" data-act="redraw" ${busy ? "disabled" : ""}>${/失败/.test(st) ? "重试" : "重画背景"}</button>
        <button class="sm danger" data-act="delItem" ${busy ? "disabled" : ""}>不要</button></div></div>`;
  }

  let rendering = false, renderAgain = false;
  async function render() {
    if (!P()) return;
    if (rendering) { renderAgain = true; return; }
    rendering = true;
    try {
      do { renderAgain = false; await renderProject(); } while (renderAgain);
    } finally { rendering = false; }
  }
  async function renderProject() {
    const p = P();
    const name = $("projName");
    name.hidden = false;
    if (document.activeElement !== name) name.value = p.name || "";
    const prods = await Promise.all((p.products || []).map(async (pr) => {
      const st = jobs.get(pr.id) || "";
      return `<div class="mcard ${pr.id === (curProduct() || {}).id ? "cur" : ""}" data-prid="${pr.id}"><div class="pic ${pr.cut ? "checker" : ""}" data-act="useProduct"><img src="${await ST.urlOf(pr.cut || pr.key)}" alt="">
        ${st ? `<span class="st tag ${/失败/.test(st) ? "bad" : "blue"}">${esc(st)}</span>` : pr.cut ? '<span class="st tag ok">已抠图</span>' : '<span class="st tag warn">没抠图</span>'}</div>
        <div class="acts"><button class="sm" data-act="useProduct">${pr.id === (curProduct() || {}).id ? "正在用" : "用这张"}</button>
        ${!pr.cut || pr.white ? `<button class="sm" data-act="cutAi" ${st && !/失败/.test(st) ? "disabled" : ""}>AI 抠图</button>` : ""}
        <button class="sm danger" data-act="delProduct">删除</button></div></div>`;
    }));
    const sel = new Set(p.styles || []);
    const myPills = await Promise.all(myStyles.map(async (s) => `<span class="stypill ${sel.has("my:" + s.id) ? "on" : ""}" data-sty="my:${s.id}" title="${esc(s.desc || s.prompt)}">${s.ref ? `<img src="${await ST.urlOf(s.ref)}" alt="">` : ""}${esc(s.name)}<span class="x" data-act="delStyle" data-sid="${s.id}" title="删除这个风格">✕</span></span>`));
    const n = chosenStyles(p).length * (p.count || 1);
    const pend = p.items.filter((x) => x.state !== "ok"), done = p.items.filter((x) => x.state === "ok");
    $("main").innerHTML = `
      <div class="card"><div class="head"><div><h3>① 产品图</h3><div class="muted">上传白底图（白底的会自动去白底；不是白底的点“AI 抠图”）。可以传几张，点一张“用这张”。</div></div>
        <div class="sp"><button data-act="addProducts">上传产品图</button></div></div>
        <label class="row lb" style="margin-bottom:10px">产品名称（可以不填，告诉 AI 这是什么）<input id="pName" value="${esc((p.info && p.info.name) || "")}" placeholder="如：男士保温杯" style="width:240px"></label>
        ${prods.length ? `<div class="mcards">${prods.join("")}</div>` : '<div class="empty" id="dropZone">把白底图拖到这里，或者点“上传产品图”</div>'}</div>
      <div class="card"><div class="head"><div><h3>② 背景风格</h3><div class="muted">可以多选，每种风格各画几张。</div></div>
        <div class="sp"><button data-act="learnStyle" title="上传一张你喜欢的主图或场景图，AI 识别它的背景风格，存起来以后都能用">上传图片识别风格</button></div></div>
        <div class="lb">预设</div><div class="stypills">${ST.MAIN_STYLES.map((s) => `<span class="stypill noimg ${sel.has(s.id) ? "on" : ""}" data-sty="${s.id}" title="${esc(s.prompt)}">${esc(s.name)}</span>`).join("")}</div>
        <div class="lb" style="margin-top:10px">我的风格</div><div class="stypills">${myPills.join("") || '<span class="muted">还没有。点右上角“上传图片识别风格”。</span>'}</div>
        <label class="row lb" style="margin-top:10px"><input type="checkbox" id="customOn" ${p.customOn ? "checked" : ""}> 自己写</label>
        <textarea id="custom" rows="2" placeholder="中文或英文都行，如：浅灰色水泥台面，旁边有一盆绿植，早晨的阳光" ${p.customOn ? "" : "hidden"}>${esc(p.custom || "")}</textarea></div>
      <div class="card"><h3>③ 生成</h3><div class="mrow">
        <span class="lb">尺寸</span><span class="pills">${SIZES.map((s) => `<span class="pill ${p.size === s ? "on" : ""}" data-size="${s}">${s}×${s}</span>`).join("")}</span>
        <label class="row lb">每种风格 <select id="count">${[1, 2, 3, 4].map((k) => `<option ${(p.count || 1) === k ? "selected" : ""}>${k}</option>`).join("")}</select> 张</label>
        <label class="row lb">产品大小 <input type="range" id="scale" min="40" max="90" value="${Math.round((p.scale || 0.7) * 100)}"><span id="scaleV">${Math.round((p.scale || 0.7) * 100)}%</span></label>
        <label class="row lb"><input type="checkbox" id="blend" ${p.blend !== false ? "checked" : ""}> 融入背景（AI 只调光影，产品不变）</label>
        <label class="row lb">用哪个 AI <select id="site">${SITES.map(([v, t]) => `<option value="${v}" ${v === site ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <button class="primary" data-act="generate" ${n && curProduct() ? "" : "disabled"}>生成 ${n} 张</button></div>
        <div class="note" style="margin-top:10px">默认不加文字。每张：AI 画空背景 → 程序把产品贴到中间 → AI 调光影融入 → 检查产品没变样（变样了重做一次，还不行就用原贴图）。</div></div>
      ${pend.length ? `<div class="card pendbox"><div class="head"><div><h3>待确认（${pend.length}）</h3><div class="muted">看过点“采用”；不满意可以调整产品、重新融入、重画背景，或者不要。</div></div></div>
        <div class="mcards">${(await Promise.all(pend.map(itemCard))).join("")}</div></div>` : ""}
      ${done.length ? `<div class="card"><div class="head"><div><h3>已采用（${done.length}）</h3><div class="muted">下载的是 ${p.size}×${p.size} 的 JPG；“下载全部”里另外带一张白底图。</div></div>
        <div class="sp"><button class="primary" data-act="dlAll">下载全部（zip）</button></div></div>
        <div class="mcards">${(await Promise.all(done.map(itemCard))).join("")}</div></div>` : ""}`;
  }

  // ------------------------------------------------------------ 点击、输入
  const itemOf = (el) => P().items.find((x) => x.id === el.closest("[data-iid]").dataset.iid);
  const prodOf = (el) => P().products.find((x) => x.id === el.closest("[data-prid]").dataset.prid);
  const ACT = {
    home: () => { location.hash = ""; },
    newProj: async () => {
      const p = { id: ST.uid("m"), kind: "main", name: `主图 ${ST.bj().slice(5, 16)}`, info: { name: "" }, size: 800, products: [], cur: "", styles: ["studio"], custom: "", customOn: false, count: 1, scale: 0.7, blend: true, items: [] };
      await ST.db.putProject(p);
      location.hash = "#p=" + p.id;
    },
    delProj: async (el, e) => {
      e.stopPropagation();
      if (!(await confirm("删除这个主图项目？里面的图都会删掉。", "删除", true))) return;
      await ST.db.deleteProject(el.dataset.id);
      renderHome();
    },
    addProducts: async () => addProducts(await pick("image/*", true)),
    useProduct: async (el) => { P().cur = prodOf(el).id; await save(); render(); },
    cutAi: (el) => cutAi(prodOf(el)),
    delProduct: async (el) => {
      const p = P(), pr = prodOf(el);
      if (!(await confirm("删除这张产品图？", "删除", true))) return;
      p.products = p.products.filter((x) => x !== pr);
      if (p.cur === pr.id) p.cur = (p.products[0] || {}).id || "";
      for (const k of [pr.key, pr.cut, pr.white]) if (k && !p.items.some((it) => it.product === pr.id)) { ST.forget(k); ST.db.delBlob(k); }
      await save(); render();
    },
    learnStyle: () => learnStyle(),
    delStyle: async (el, e) => {
      e.stopPropagation();
      const s = myStyles.find((x) => x.id === el.dataset.sid);
      if (!s || !(await confirm(`删除“我的风格”里的“${s.name}”？（所有主图项目都不能再选它，已经画好的图不受影响）`, "删除", true))) return;
      myStyles = myStyles.filter((x) => x !== s);
      await saveMyStyles();
      if (s.ref) ST.db.delBlob(s.ref);
      const p = P();
      p.styles = (p.styles || []).filter((x) => x !== "my:" + s.id);
      await save(); render();
    },
    generate: () => generate(),
    harmView: async (el) => { const it = itemOf(el); if (it.harm) { it.harm.on = el.dataset.v === "1"; await save(); render(); } },
    accept: async (el) => { itemOf(el).state = "ok"; await save(); render(); },
    unaccept: async (el) => { itemOf(el).state = "pending"; await save(); render(); },
    adjust: (el) => adjust(itemOf(el)),
    reblend: (el) => makeItem(itemOf(el), 0, true),
    redraw: (el) => makeItem(itemOf(el), 0),
    delItem: async (el) => {
      const p = P(), it = itemOf(el);
      p.items = p.items.filter((x) => x !== it);
      for (const k of [it.bg, it.harm && it.harm.key]) if (k) { ST.forget(k); ST.db.delBlob(k); }
      jobs.delete(it.id);
      await save(); render();
    },
    view: async (el) => {
      const it = itemOf(el);
      if (!it.bg) return;
      const c = await compose(it, 900);
      const url = URL.createObjectURL(await ST.toBlob(c.canvas, "image/jpeg", 0.9));
      await APP.modal(`<img src="${url}" style="max-width:100%;max-height:72vh;display:block;margin:0 auto;border-radius:8px">`, { title: `${it.styleName}（${c.used ? "融入后" : "原贴图"}）`, big: true });
      URL.revokeObjectURL(url);
    },
    dlOne: async (el) => {
      const p = P(), it = itemOf(el);
      const c = await compose(it, p.size);
      download(await ST.toBlob(c.canvas, "image/jpeg", 0.92), `${ST.safeName(p.name)}_${ST.safeName(it.styleName)}_${p.size}.jpg`);
    },
    dlAll: async (el) => {
      const p = P();
      el.disabled = true; el.textContent = "正在打包…";
      try {
        const files = [];
        let n = 0;
        for (const it of p.items.filter((x) => x.state === "ok")) {
          const c = await compose(it, p.size);
          files.push({ name: `主图${String(++n).padStart(2, "0")}_${ST.safeName(it.styleName)}.jpg`, blob: await ST.toBlob(c.canvas, "image/jpeg", 0.92) });
        }
        files.push({ name: "白底图.jpg", blob: await ST.toBlob(await whiteImage(p.size), "image/jpeg", 0.95) });
        download(await ST.makeZip(files), `${ST.safeName(p.name)}_主图_${p.size}.zip`);
      } catch (e) { APP.toast("打包失败：" + e.message, true); }
      el.disabled = false; el.textContent = "下载全部（zip）";
    },
  };
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act]");
    if (t && !t.disabled && ACT[t.dataset.act] && !t.closest("#modal")) { ACT[t.dataset.act](t, e); return; }
    const sty = e.target.closest("[data-sty]");
    if (sty && P()) {
      const p = P(), id = sty.dataset.sty;
      const s = new Set(p.styles || []);
      s.has(id) ? s.delete(id) : s.add(id);
      p.styles = [...s];
      save(); render();
      return;
    }
    const sz = e.target.closest("[data-size]");
    if (sz && P()) { P().size = +sz.dataset.size; save(); render(); return; }
    const open = e.target.closest("[data-open]");
    if (open) location.hash = "#p=" + open.dataset.open;
  });
  document.addEventListener("input", (e) => {
    const p = P();
    if (!p) return;
    const t = e.target;
    if (t.id === "projName") { p.name = t.value; saveSoon(); }
    else if (t.id === "pName") { p.info = { ...(p.info || {}), name: t.value }; saveSoon(); }
    else if (t.id === "custom") { p.custom = t.value; saveSoon(); }
    else if (t.id === "scale") { p.scale = +t.value / 100; $("scaleV").textContent = t.value + "%"; saveSoon(); }
  });
  document.addEventListener("change", (e) => {
    const p = P();
    if (!p) return;
    const t = e.target;
    if (t.id === "customOn") { p.customOn = t.checked; save(); render(); }
    else if (t.id === "count") { p.count = +t.value; save(); render(); }
    else if (t.id === "blend") { p.blend = t.checked; save(); }
    else if (t.id === "site") { site = t.value; ls.set("st:mainSite", site); }
  });
  document.addEventListener("dragover", (e) => { if (P()) e.preventDefault(); });
  document.addEventListener("drop", (e) => { if (!P()) return; e.preventDefault(); const fl = [...e.dataTransfer.files]; if (fl.length) addProducts(fl); });
  document.addEventListener("paste", (e) => {
    if (!P() || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const fl = [...((e.clipboardData && e.clipboardData.files) || [])];
    if (fl.length) addProducts(fl);
  });

  // AI 状态
  const chip = $("aiChip");
  const showAi = () => {
    const st = ST.AI.status, n = ST.AI.running.length;
    chip.className = "chip " + ({ busy: "busy", ok: "ok", warn: "warn", bad: "bad" }[st.kind] || "");
    chip.querySelector("span").textContent = n ? `AI 任务 ${n}` : st.kind === "bad" ? "AI 未连接" : "AI";
    chip.title = st.msg || "";
  };
  ST.AI.onChange(showAi);
  showAi();
  route();
})();
