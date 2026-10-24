/**
 * 主图（Lee 2026-10-23）：上传白底图 → 选几种背景风格 → AI 画空背景 → 程序把产品贴上 → AI 只调光影融入（B 方式，检查产品没变样）
 * → 先放在“待确认”，采用后可以下载（800×800 或 1000×1000，另外带一张白底图）。
 *
 * - 风格：预设几种；也可以上传一张图让 AI 识别背景风格，存成“我的风格”（所有主图项目共用，存在 meta mainStyles）；也可以自己写。
 * - Gemini / Copilot 轮流画（“AI 分工 → 主图”里可以单独选网站），这里也可以临时指定一个。
 * - 目前只能手动做（不进全自动），默认不加文字。
 * 项目存在详情页同一张表里（kind = "main"），图片键名“项目编号:…”，“我的风格”的参考图键名“mstyle:…”。
 * 抠图、画背景、融入、审核都在服务器上做（server/main），关掉网页也不停；网页只发操作（/api/main/:id/op），收到推送就刷新。
 */
(() => {
  const esc = ST.esc;
  const $ = (id) => document.getElementById(id);
  const APP = (globalThis.APP = { project: null });
  const P = () => APP.project;
  const SIZES = [800, 1000];
  const MODES = [["scene", "AI 直接画场景", "把抠好的透明 PNG 发给 AI，一步画出带产品的场景（最自然）"], ["paste", "先画背景再融入", "产品最稳：AI 画空背景，程序贴产品，AI 只调光影"]];
  const PLACES = [["free", "AI 自由发挥", "让 AI 自己决定怎么摆（立着、平放、斜着……）"], ["same", "和产品图一样", "保持产品图里的角度和朝向"]];
  const SITES = [["", "自动（按 AI 分工轮流）"], ["gemini", "Gemini"], ["copilot", "Copilot"]];
  const ls = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  let site = ls.get("st:mainSite", "");
  let myStyles = []; // [{ id, name, desc, prompt, ref }]
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
  const pick = (accept, multiple) => new Promise((resolve) => {
    const i = document.createElement("input");
    i.type = "file"; i.accept = accept; i.multiple = !!multiple;
    i.onchange = () => resolve([...i.files]);
    i.click();
  });
  const download = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000); };
  const cancelled = (e) => !!(e && e.result && e.result.cancelled);

  // AI：任务交给工作台排队（ai.js），opt = { role, sites, rotate }
  const aiJson = async (prompt, images, label, opt) => { const r = await ST.AI.run("text", prompt, images, { label, ...opt }); return ST.extractJson(r.text, r.codes); };

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

  // ------------------------------------------------------------ 发操作给服务器
  const curProduct = (p = P()) => ST.mainProduct(p);
  const compose = (it, px, useHarm = true) => ST.mainCompose(P(), it, px, useHarm);
  /** 发一个操作，服务器改好项目返回最新的 */
  async function op(body) {
    const p = P();
    const r = await fetch(`/api/main/${encodeURIComponent(p.id)}/op`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { location.href = "/"; return; }
    if (!r.ok) { APP.toast(d.error || `出错了（${r.status}）`, true); return; }
    if (d.project && P() && d.project.id === P().id) { APP.project = d.project; render(); }
    return d.project;
  }
  const setFields = (fields) => { Object.assign(P(), fields); return op({ op: "set", fields }); };
  let setT, setPend = {};
  const setSoon = (fields) => { Object.assign(P(), fields); Object.assign(setPend, fields); clearTimeout(setT); setT = setTimeout(() => { const f = setPend; setPend = {}; op({ op: "set", fields: f }); }, 500); };
  async function addProducts(files) {
    const p = P();
    let n = 0;
    for (const f of files.filter((f) => /^image\//.test(f.type) || ST.isImageName(f.name || ""))) {
      try {
        const blob = f.type ? f : new Blob([f], { type: ST.mimeOf(f.name) });
        await ST.blobToImage(blob); // 打得开才传
        const id = ST.uid("pr");
        const key = `${p.id}:${id}-orig`;
        await ST.saveImage(key, blob);
        await op({ op: "addProduct", id, key, name: f.name || "产品图" });
        n++;
      } catch (e) { APP.toast(`${f.name} 打不开：${e.message}`, true); }
    }
    if (n) APP.toast(`加了 ${n} 张产品图${P().products.some((x) => !x.cut && !x.job) ? "；不是白底的图点“AI 抠图”" : ""}`);
  }
  async function generate() {
    const p = await op({ op: "generate", site });
    if (p) APP.toast("开始做了，画好放在“待确认”里（在服务器上做，关掉网页也不停）");
  }

  // ------------------------------------------------------------ 调整产品位置、大小
  async function adjust(it) {
    const pos = { ...(it.pos || { x: 0.5, y: 0.53, s: 0.85 }) };
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
        m.querySelector("#adjReset").onclick = () => { pos.x = 0.5; pos.y = 0.53; draw(); };
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
    await op({ op: "adjust", iid: it.id, pos, again: again && !!it.bg, site });
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
    if (p) await setFields({ styles: [...new Set([...(p.styles || []), "my:" + st.id])] });
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

  async function itemCard(it) {
    const st = it.job || "";
    const scene = it.mode === "scene";
    const ready = scene ? !!it.scene : !!it.bg;
    let url = "";
    if (ready) {
      const k = JSON.stringify([it.bg, it.scene, it.pos, it.harm, it.product]);
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
    const c = ready && !scene ? await compose(it, 64) : null;
    const busy = st && !/失败/.test(st);
    const has = hm.key && c && !c.stale;
    let line = "", warn = false;
    if (!busy) {
      if (scene) {
        const j = it.judge;
        if (j) { warn = j.ok === false; line = j.ok === null ? j.note : (j.ok ? "AI 审核：产品没被改" : "AI 审核：产品可能被改了——") + (j.why ? (j.ok ? "（" + j.why + "）" : j.why) : ""); }
        if (it.placement === "ref") line = ["摆放照参考图", line].filter(Boolean).join("；");
        else if (it.placement === "same") line = ["摆放和产品图一样", line].filter(Boolean).join("；");
      }
      else if (c && c.stale) line = "产品改过了，显示原贴图；点“重新融入”";
      else if (has) line = (hm.on ? "AI 图" : "原贴图") + (ST.harmText(hm) ? "；" + ST.harmText(hm) : "");
      else if (it.bg) line = "原贴图（没有融入）";
    }
    return `<div class="mcard" data-iid="${it.id}">
      <div class="pic" data-act="view">${url ? `<img src="${url}" alt="">` : ""}${st ? `<span class="st tag ${/失败/.test(st) ? "bad" : "blue"}">${esc(st)}</span>` : ""}</div>
      <div class="row"><b>${esc(it.styleName)}${scene ? ' <span class="muted">AI 直接画</span>' : ""}</b>${has ? `<span class="sp pills"><span class="pill ${hm.on ? "on" : ""}" data-act="harmView" data-v="1">AI 图</span><span class="pill ${hm.on ? "" : "on"}" data-act="harmView" data-v="0">原贴图</span></span>` : ""}</div>
      ${line ? `<div class="muted ${warn ? "warntext" : ""}">${esc(line)}</div>` : ""}
      <div class="acts">
        <button class="sm" data-act="dlOne" ${ready ? "" : "disabled"}>下载</button>
        <button class="sm" data-act="judge" ${ready && !busy && (scene || hm.key) ? "" : "disabled"} title="让审核 AI（默认豆包）看一眼：${scene ? "产品有没有被改" : "原贴图和 AI 图哪张好"}">AI 审核</button>
        ${it.state === "ok" ? `<button class="sm" data-act="unaccept">取消采用</button>` : `<button class="sm primary" data-act="accept" ${ready && !busy ? "" : "disabled"}>采用</button>`}
        <button class="sm" data-act="placeRef" ${ready ? "" : "disabled"} title="以后用“AI 直接画场景”时，产品都照这张的摆法放">用这个摆放</button>
        ${scene ? "" : `<button class="sm" data-act="adjust" ${ready && !busy ? "" : "disabled"}>调整产品</button>
        <button class="sm" data-act="reblend" ${ready && !busy ? "" : "disabled"}>${hm.key ? "重新融入" : "融入背景"}</button>`}
        <button class="sm" data-act="redraw" ${busy ? "disabled" : ""}>${/失败/.test(st) ? "重试" : scene ? "重画" : "重画背景"}</button>
        <button class="sm danger" data-act="delItem">不要</button></div></div>`;
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
    name.readOnly = !!p.fixedName;
    name.title = p.fixedName ? "项目名称建好以后不能改" : "";
    const prods = await Promise.all((p.products || []).map(async (pr) => {
      const st = pr.job || "";
      return `<div class="mcard ${pr.id === (curProduct() || {}).id ? "cur" : ""}" data-prid="${pr.id}"><div class="pic ${pr.cut ? "checker dark" : ""}" data-act="viewProduct" title="点一下看大图"><img src="${await ST.urlOf(pr.cut || pr.key)}" alt="">
        ${st ? `<span class="st tag ${/失败/.test(st) ? "bad" : "blue"}">${esc(st)}</span>` : pr.cut ? '<span class="st tag ok">已抠图</span>' : '<span class="st tag warn">没抠图</span>'}</div>
        <div class="acts"><button class="sm" data-act="useProduct">${pr.id === (curProduct() || {}).id ? "正在用" : "用这张"}</button>
        ${!pr.cut || pr.white ? `<button class="sm" data-act="cutAi" ${st && !/失败/.test(st) ? "disabled" : ""}>AI 抠图</button>` : ""}
        <button class="sm danger" data-act="delProduct">删除</button></div>
        ${pr.cut || pr.edgeWhite || pr.white ? `<label class="row lb" title="手腕绳、提手这种围成圈的地方，中间的白色也抠掉"><input type="checkbox" data-holes ${pr.holes ? "checked" : ""} ${st && !/失败/.test(st) ? "disabled" : ""}> 镂空的白色也抠掉</label>` : ""}</div>`;
    }));
    const sel = new Set(p.styles || []);
    const myPills = await Promise.all(myStyles.map(async (s) => `<span class="stypill ${sel.has("my:" + s.id) ? "on" : ""}" data-sty="my:${s.id}" title="${esc(s.desc || s.prompt)}">${s.ref ? `<img src="${await ST.urlOf(s.ref)}" alt="">` : ""}${esc(s.name)}<span class="x" data-act="delStyle" data-sid="${s.id}" title="删除这个风格">✕</span></span>`));
    const n = chosenStyles(p).length * (p.count || 1);
    const placeUrl = p.placeRef ? await ST.urlOf(p.placeRef) : "";
    const pend = p.items.filter((x) => x.state !== "ok"), done = p.items.filter((x) => x.state === "ok");
    $("main").innerHTML = `
      <div class="card"><div class="head"><div><h3>① 产品图</h3><div class="muted">上传白底图（白底的会自动去白底；不是白底的点“AI 抠图”）。抠好的图放在深色格子上，有没有白边一眼能看出来；手腕绳、提手围成的圈里有白色，勾“镂空的白色也抠掉”。</div></div>
        <div class="sp"><button data-act="fromLib">从素材中心选</button><button data-act="addProducts">上传产品图</button></div></div>
        <label class="row lb" style="margin-bottom:10px">产品名称（可以不填，告诉 AI 这是什么）<input id="pName" value="${esc((p.info && p.info.name) || "")}" placeholder="如：男士保温杯" style="width:240px"></label>
        ${prods.length ? `<div class="mcards">${prods.join("")}</div>` : '<div class="empty" id="dropZone">把白底图拖到这里、按 Ctrl+V 粘贴，或者点“上传产品图”“从素材中心选”</div>'}</div>
      <div class="card"><div class="head"><div><h3>② 背景风格</h3><div class="muted">可以多选，每种风格各画几张。</div></div>
        <div class="sp"><button data-act="learnStyle" title="上传一张你喜欢的主图或场景图，AI 识别它的背景风格，存起来以后都能用">上传图片识别风格</button></div></div>
        <div class="lb">预设</div><div class="stypills">${ST.MAIN_STYLES.map((s) => `<span class="stypill noimg ${sel.has(s.id) ? "on" : ""}" data-sty="${s.id}" title="${esc(s.prompt)}">${esc(s.name)}</span>`).join("")}</div>
        <div class="lb" style="margin-top:10px">我的风格</div><div class="stypills">${myPills.join("") || '<span class="muted">还没有。点右上角“上传图片识别风格”。</span>'}</div>
        <label class="row lb" style="margin-top:10px"><input type="checkbox" id="customOn" ${p.customOn ? "checked" : ""}> 自己写</label>
        <textarea id="custom" rows="2" placeholder="中文或英文都行，如：浅灰色水泥台面，旁边有一盆绿植，早晨的阳光" ${p.customOn ? "" : "hidden"}>${esc(p.custom || "")}</textarea></div>
      <div class="card"><h3>③ 生成</h3><div class="mrow">
        <span class="lb">做法</span><span class="pills">${MODES.map(([v, t, tip]) => `<span class="pill ${(p.mode === "paste" ? "paste" : "scene") === v ? "on" : ""}" data-mode="${v}" title="${esc(tip)}">${t}</span>`).join("")}</span>
        <span class="lb">尺寸</span><span class="pills">${SIZES.map((s) => `<span class="pill ${p.size === s ? "on" : ""}" data-size="${s}">${s}×${s}</span>`).join("")}</span>
        ${p.mode !== "paste" ? `<span class="lb">摆放</span><span class="pills">${PLACES.map(([v, t, tip]) => `<span class="pill ${(p.placement || "free") === v ? "on" : ""}" data-place="${v}" title="${esc(tip)}">${t}</span>`).join("")}${p.placeRef ? `<span class="pill ${p.placement === "ref" ? "on" : ""}" data-place="ref" title="照这张图里的摆法"><img src="${esc(placeUrl)}" class="placeimg" alt="">照“${esc(p.placeRefName || "")}”那张摆<span class="x" data-act="clearPlace" title="不用这张了">✕</span></span>` : ""}</span>` : ""}
        <label class="row lb">每种风格 <select id="count">${[1, 2, 3, 4].map((k) => `<option ${(p.count || 1) === k ? "selected" : ""}>${k}</option>`).join("")}</select> 张</label>
        ${p.mode !== "paste" ? "" : `<label class="row lb">产品大小 <input type="range" id="scale" min="40" max="95" value="${Math.round((p.scale || 0.85) * 100)}"><span id="scaleV">${Math.round((p.scale || 0.85) * 100)}%</span></label>
        <label class="row lb"><input type="checkbox" id="blend" ${p.blend !== false ? "checked" : ""}> 融入背景（AI 只调光影）</label>`}
        <label class="row lb">用哪个 AI <select id="site">${SITES.map(([v, t]) => `<option value="${v}" ${v === site ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <button class="primary" data-act="generate" ${n && curProduct() ? "" : "disabled"}>生成 ${n} 张</button></div>
        <div class="note" style="margin-top:10px">${p.mode !== "paste" ? "AI 直接画：把抠好的透明 PNG 发给 AI，一步画出带产品的场景，最自然；产品可能被 AI 改一点，不放心就点图片下面的“AI 审核”。喜欢哪张的摆法，点那张的“用这个摆放”。" : "先画背景再融入：AI 画空背景 → 程序把抠好的 PNG 贴到中间 → AI 调光影融入，直接显示 AI 图（原贴图留着可以切换，想让 AI 判断哪张好点“AI 审核”）。"}
          在服务器上做，关掉网页也不停。默认不加文字。</div></div>
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
      let name = null;
      const ok = await APP.modal(`<input id="npName" style="width:100%" placeholder="如：钱包"><div class="muted" style="margin-top:6px">只填名字，会自动变成“主图-钱包10-24-1”（月-日-当天第几个项目），建好以后不能改。</div>
        <div class="mf"><button data-ret="">取消</button><button class="primary" data-ret="ok">新建</button></div>`, { title: "新建主图项目", onOpen: (m) => { const i = m.querySelector("#npName"); i.focus(); i.onkeydown = (e) => { if (e.key === "Enter") m.querySelector('[data-ret="ok"]').click(); }; }, check: (v, m) => { name = m.querySelector("#npName").value.trim(); } });
      if (ok !== "ok") return;
      const r = await fetch("/api/main", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }), credentials: "same-origin" });
      const d = await r.json();
      if (!r.ok) return APP.toast(d.error || "新建失败", true);
      location.hash = "#p=" + d.id;
    },
    delProj: async (el, e) => {
      e.stopPropagation();
      if (!(await confirm("删除这个主图项目？里面的图都会删掉。", "删除", true))) return;
      await ST.db.deleteProject(el.dataset.id);
      renderHome();
    },
    addProducts: async () => addProducts(await pick("image/*", true)),
    fromLib: async () => {
      const list = await LIB.pick({ title: "从素材中心选产品图（白底图最好）" });
      if (!list || !list.length) return;
      const r = await fetch("/api/library/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: "main", projectId: P().id, ids: list.map((x) => x.id) }), credentials: "same-origin" });
      const d = await r.json();
      if (!r.ok) return APP.toast(d.error || "没放进来", true);
      APP.toast(`从素材中心放进来 ${list.length} 张`);
      pull();
    },
    useProduct: (el) => setFields({ cur: prodOf(el).id }),
    cutAi: (el) => op({ op: "cutAi", prid: prodOf(el).id }),
    delProduct: async (el) => { if (await confirm("删除这张产品图？", "删除", true)) op({ op: "delProduct", prid: prodOf(el).id }); },
    learnStyle: () => learnStyle(),
    delStyle: async (el, e) => {
      e.stopPropagation();
      const s = myStyles.find((x) => x.id === el.dataset.sid);
      if (!s || !(await confirm(`删除“我的风格”里的“${s.name}”？（所有主图项目都不能再选它，已经画好的图不受影响）`, "删除", true))) return;
      myStyles = myStyles.filter((x) => x !== s);
      await saveMyStyles();
      if (s.ref) ST.db.delBlob(s.ref);
      await setFields({ styles: (P().styles || []).filter((x) => x !== "my:" + s.id) });
    },
    generate: () => generate(),
    harmView: (el) => op({ op: "view", iid: itemOf(el).id, on: el.dataset.v === "1" }),
    accept: (el) => op({ op: "accept", iid: itemOf(el).id, ok: true }),
    unaccept: (el) => op({ op: "accept", iid: itemOf(el).id, ok: false }),
    adjust: (el) => adjust(itemOf(el)),
    reblend: (el) => op({ op: "reblend", iid: itemOf(el).id, site }),
    redraw: (el) => op({ op: "redraw", iid: itemOf(el).id, site }),
    delItem: (el) => op({ op: "delItem", iid: itemOf(el).id }),
    judge: (el) => op({ op: "judge", iid: itemOf(el).id }),
    placeRef: async (el) => { const p = await op({ op: "placeRef", iid: itemOf(el).id }); if (p) APP.toast("以后“AI 直接画场景”都照这张的摆法放（在“③ 生成 → 摆放”里可以改回去）"); },
    clearPlace: (el, e) => { e.stopPropagation(); op({ op: "placeRef", clear: true }); },
    // 看大图（滚轮缩放、拖动、← → 切换所有画好的主图）
    view: async (el) => {
      const it0 = itemOf(el);
      const ready = (it) => (it.mode === "scene" ? it.scene : it.bg);
      if (!ready(it0)) return;
      const list = P().items.filter(ready);
      const out = [];
      for (const it of list) {
        const c = await compose(it, 1000);
        out.push({ src: URL.createObjectURL(await ST.toBlob(c.canvas, "image/jpeg", 0.92)), name: `${it.styleName}（${it.mode === "scene" ? "AI 直接画" : c.used ? "AI 图" : "原贴图"}）`, png: false });
      }
      VIEWER.open(out, list.indexOf(it0));
    },
    viewProduct: async (el) => {
      const prs = P().products;
      const i = prs.findIndex((x) => x.id === el.closest("[data-prid]").dataset.prid);
      VIEWER.open(await Promise.all(prs.map(async (pr) => ({ src: await ST.urlOf(pr.cut || pr.key), name: pr.name, png: !!pr.cut, info: `${pr.w}×${pr.h}${pr.cut ? " · 抠好的 PNG" : ""}` }))), i);
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
        files.push({ name: "白底图.jpg", blob: await ST.toBlob(await ST.mainWhite(p, p.size), "image/jpeg", 0.95) });
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
      setFields({ styles: [...s] }); render();
      return;
    }
    const sz = e.target.closest("[data-size]");
    if (sz && P()) { setFields({ size: +sz.dataset.size }); return; }
    const pl = e.target.closest("[data-place]");
    if (pl && P()) { setFields({ placement: pl.dataset.place }); return; }
    const md = e.target.closest("[data-mode]");
    if (md && P()) { setFields({ mode: md.dataset.mode }); return; }
    const open = e.target.closest("[data-open]");
    if (open) location.hash = "#p=" + open.dataset.open;
  });
  document.addEventListener("input", (e) => {
    const p = P();
    if (!p) return;
    const t = e.target;
    if (t.id === "projName") { if (!p.fixedName) setSoon({ name: t.value }); }
    else if (t.id === "pName") setSoon({ info: { ...(p.info || {}), name: t.value } });
    else if (t.id === "custom") setSoon({ custom: t.value });
    else if (t.id === "scale") { $("scaleV").textContent = t.value + "%"; setSoon({ scale: +t.value / 100 }); }
  });
  document.addEventListener("change", (e) => {
    const p = P();
    if (!p) return;
    const t = e.target;
    if (t.id === "customOn") setFields({ customOn: t.checked });
    else if (t.id === "count") setFields({ count: +t.value });
    else if (t.id === "blend") setFields({ blend: t.checked });
    else if (t.dataset.holes !== undefined) op({ op: "holes", prid: prodOf(t).id, holes: t.checked });
    else if (t.id === "site") { site = t.value; ls.set("st:mainSite", site); }
  });
  document.addEventListener("dragover", (e) => { if (P()) e.preventDefault(); });
  document.addEventListener("drop", (e) => { if (!P()) return; e.preventDefault(); const fl = [...e.dataTransfer.files]; if (fl.length) addProducts(fl); });
  document.addEventListener("paste", (e) => {
    if (!P() || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const fl = [...((e.clipboardData && e.clipboardData.files) || [])];
    if (fl.length) addProducts(fl);
  });

  // 服务器推送：项目变了（后台做完一步）就取最新的
  let pullT = null;
  const pull = async () => {
    const p = P();
    if (!p) return;
    const q = await ST.db.getProject(p.id).catch(() => null);
    if (!q || !P() || P().id !== q.id) return;
    Object.assign(q, setPend); // 还没发出去的输入别被盖掉
    APP.project = q;
    render();
  };
  try {
    const es = new EventSource("/api/events");
    es.addEventListener("project", (e) => {
      let d = {};
      try { d = JSON.parse(e.data); } catch {}
      if (P() && d.id === P().id && !d.deleted && (d.rev || 0) > (P().rev || 0)) { clearTimeout(pullT); pullT = setTimeout(pull, 200); }
      else if (!P() && d.kind === "main") { clearTimeout(pullT); pullT = setTimeout(renderHome, 500); }
    });
  } catch {}

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
