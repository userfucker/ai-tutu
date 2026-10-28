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
  const MODES = [["scene", "AI 直接画场景", "把产品图（铺白底）发给 AI，一步画出带产品的场景（最自然）"], ["paste", "先画背景再融入", "产品最稳：AI 画空背景，程序贴产品，AI 只调光影"], ["poster", "文字版主图", "虚拟产品、纯文字主图：先让 AI 写文字版方案（字体、字号、文字、配色、风格），你改好了再按方案出图；参考图可选"]];
  const modeOf = (p) => (p.mode === "paste" || p.mode === "poster" ? p.mode : "scene");
  // 实物 / 文字建项目时就定了（旧项目用过“文字版主图”的算文字），实物项目只在两种画法里选
  const REAL_MODES = MODES.filter(([v]) => v !== "poster");
  const PLACES = [["free", "AI 自由发挥", "让 AI 自己决定怎么摆（立着、平放、斜着……）"], ["same", "和产品图一样", "保持产品图里的角度和朝向"]];
  const SITES = [["", "自动（按 AI 分工轮流）"], ["gemini", "Gemini"], ["copilot", "Copilot"]];
  const ls = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  let site = ls.get("st:mainSite", "");
  // 文字版主图：写方案用哪个 AI、写几套；审核用哪个 AI（Lee 2026-10-27：放在主图页，切换方便）
  const PLAN_SITES = [["deepseek", "DeepSeek"], ["doubao", "豆包"], ["kimi", "Kimi"], ["glm", "智谱清言"], ["gemini", "Gemini"], ["copilot", "Copilot"]];
  const JUDGE_SITES = [["doubao", "豆包"], ["deepseek", "DeepSeek"], ["kimi", "Kimi"], ["glm", "智谱清言"]];
  let planSite = ls.get("st:planSite", "doubao"), planCount = +ls.get("st:planCount", "3") || 3, judgeSite = ls.get("st:judgeSite", "doubao");
  let myStyles = []; // [{ id, name, desc, prompt, ref }]
  // 文字主图的框模板（Lee 2026-10-27）：内置 ST.BOX_TPLS + 我的模板（meta posterBoxTpls：从参考图生成的 J、K…，另存的 A-1、A-2…）
  let myBoxTpls = [];
  let learnSite = ls.get("st:learnSite", "gemini");
  const LEARN_SITES = [["gemini", "Gemini"], ["copilot", "Copilot"], ["doubao", "豆包"], ["kimi", "Kimi"], ["glm", "智谱清言"]];
  const bsel = {}; // 方案编号 → 选中的框编号
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
  const loadMyStyles = async () => { myStyles = (await ST.db.getMeta("mainStyles", [])) || []; myBoxTpls = (await ST.db.getMeta("posterBoxTpls", [])) || []; };
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
  // 产品图原来的格式（看文件名，没有扩展名就当 JPG）
  const fmtOf = (pr) => { const m = /\.(png|jpe?g|webp|gif)$/i.exec(pr.name || ""); return m ? (/^jpe?g$/i.test(m[1]) ? "JPG" : m[1].toUpperCase()) : "JPG"; };
  const isPngKey = (pr) => /\.png$/i.test(pr.name || "");
  /** 参考图放进项目（最多 3 张，多的顶掉最早的） */
  async function addPosterRefs(files) {
    const p = P();
    let n = 0;
    for (const f of files.filter((f) => /^image\//.test(f.type) || ST.isImageName(f.name || "")).slice(0, 3)) {
      try {
        const blob = f.type ? f : new Blob([f], { type: ST.mimeOf(f.name) });
        await ST.blobToImage(blob);
        const key = `${p.id}:pref-${ST.uid("r")}`;
        await ST.saveImage(key, blob);
        await op({ op: "addPosterRef", key, name: f.name || "参考图" });
        n++;
      } catch (e) { APP.toast(`${f.name} 打不开：${e.message}`, true); }
    }
    if (n) APP.toast(`加了 ${n} 张参考图`);
  }
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
    if (n) APP.toast(`加了 ${n} 张产品图（保留原来的格式；“画背景 + 融入”才要抠图）`);
  }
  async function generate() {
    // 刚打的字（行业、想用的信息……）还没存的，先存上
    if (Object.keys(setPend).length) { clearTimeout(setT); const f = setPend; setPend = {}; await op({ op: "set", fields: f }); }
    // 文字版主图勾了“附上草图”：每套方案先画一张草图存起来，出图时一起发给 AI
    const p0 = P();
    // 框模板的方案：每套都画一张草图（程序画，字一定对），出图时发给 AI
    if (p0.mode === "poster" && p0.posterKind !== "free" && (p0.plans || []).some((x) => x.boxes && x.on !== false)) {
      for (const pl of p0.plans.filter((x) => x.boxes && x.on !== false)) {
        const key = `${p0.id}:sketch-${pl.id}-${Date.now()}`;
        await ST.saveImage(key, await ST.toBlob(await renderBoxSketch(pl, 1024), "image/png"));
        pl.sketchKey = key;
      }
      await op({ op: "set", fields: { plans: p0.plans } });
    } else if (p0.mode === "poster" && p0.sketch) {
      for (const pl of (p0.plans || []).filter((x) => x.on !== false && !x.tpl)) {
        const key = `${p0.id}:sketch-${pl.id || ST.uid("pl")}-${Date.now()}`;
        await ST.saveImage(key, await ST.toBlob(await renderSketch(pl, 800), "image/jpeg", 0.92));
        pl.sketchKey = key;
      }
      await op({ op: "set", fields: { plans: p0.plans } });
    }
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
    const cards = await Promise.all(list.map(async (x) => `<div class="mcard proj" data-open="${x.id}"><div class="pic ${x.firstAsset ? "checker" : ""}">${x.firstAsset ? `<img src="${await ST.urlOf(x.firstAsset)}" alt="">` : '<span class="muted">${x.text ? "还没有主图" : "还没有产品图"}</span>'}</div>
      <b>${esc(x.name)}</b> <span class="tag">${x.text ? "文字主图" : "实物主图"}</span><div class="muted">${x.items} 张主图 · 采用 ${x.done} 张 · ${esc(ST.bj(x.updated).slice(5, 16))}</div>
      <div class="acts"><button class="sm danger" data-act="delProj" data-id="${x.id}">删除</button></div></div>`));
    $("main").innerHTML = `<div class="head"><div><h1>主图</h1><div class="muted">实物主图：上传产品图，选背景风格，AI 画场景。文字主图：虚拟产品、服务，用模板（线框）或让 AI 照参考图自由发挥。800×800 或 1000×1000。</div></div>
      <div class="sp"><button class="primary" data-act="newProj">＋ 新建主图项目</button></div></div>
      ${list.length ? `<div class="mcards">${cards.join("")}</div>` : '<div class="empty">还没有主图项目，点右上角“新建主图项目”。</div>'}`;
  }

  const SITE_NAME = { gemini: "Gemini", copilot: "Copilot" };
  const siteName = (s) => SITE_NAME[s] || s || "";
  /** 这张主图是哪个 AI 画的：AI 直接画 = 画场景的；画背景 + 融入 = 两个都写（一样就写一个） */
  function whoDrew(it) {
    if (it.mode === "scene" || it.mode === "poster") return siteName(it.sceneSite);
    const bg = siteName(it.bgSite), bl = it.harm && it.harm.key ? siteName(it.blendSite) : "";
    if (bg && bl && bg !== bl) return `背景 ${bg} · 融入 ${bl}`;
    return bg || bl;
  }
  // ------------------------------------------------------------ 文字版方案：表格（方案 A），每一格都能改
  const PLAN_FONTS = ["黑体", "圆体", "宋体", "楷体", "手写体", "综艺体"], PLAN_WEIGHTS = ["常规", "中粗", "粗", "特粗"];
  /** 给定版式的方案：左边版式缩略图，右边“格子 → 文字 → 字数”，还有配色、图标、店铺图标、补充说明 */
  function planTplCard(pl, i, p) {
    const t = ST.posterTpl(pl.tpl);
    const hitsAll = Object.values(pl.slots || {}).flatMap((v) => ST.banHits(v, p.posterBan));
    return `<div class="plan tplplan ${pl.on === false ? "off" : ""}" data-plan="${i}">
      <div class="row ph"><label class="row"><input type="checkbox" data-pf="${i}|on" ${pl.on !== false ? "checked" : ""}> 用这套</label>
        <b>方案 ${i + 1}</b><input class="ptheme" id="pl${i}_theme" data-pf="${i}|theme" value="${esc(pl.theme || "")}" title="这张图讲什么">
        <span class="tag">版式 ${t.id} ${esc(t.name)}</span>
        ${pl.by ? `<span class="tag">${esc((PLAN_SITES.find((x) => x[0] === pl.by) || [0, pl.by])[1])} 写的</span>` : ""}
        <span class="tag bad" id="pl${i}_ban" ${hitsAll.length ? "" : "hidden"}>有禁用词：${esc([...new Set(hitsAll)].join("、"))}</span>
        <span class="sp row"><label class="row lb">配色 <select id="pl${i}_palette" data-pf="${i}|palette">${t.palettes.map(([nm], k) => `<option value="${k}" ${(+pl.palette || 0) === k ? "selected" : ""}>${esc(nm)}</option>`).join("")}</select></label>
        <button class="sm danger" data-act="planDel">删除方案</button></span></div>
      <div class="tplbody"><div class="tplthumb"><img src="/main/tpl/${t.id}.png" data-act="viewTpl" title="点一下看大图（示例和线框图）" alt=""><div class="muted">${esc(t.use)}</div></div>
        <div class="grow"><table class="ptable"><thead><tr><th style="width:150px">格子</th><th>文字</th><th style="width:56px">字数</th></tr></thead><tbody>
        ${t.slots.map(([k, nm, max]) => {
          const v = (pl.slots || {})[k] || "", len = [...v].length, hits = ST.banHits(v, p.posterBan);
          return `<tr><td class="muted">${esc(nm)}</td><td><input id="pl${i}_s_${k}" data-pf="${i}|slots|${k}" value="${esc(v)}" class="${hits.length || len > max ? "banhit" : ""}" title="${hits.length ? "禁用词：" + esc(hits.join("、")) : len > max ? "超出字数" : ""}"></td><td class="muted" id="pl${i}_c_${k}">${len}/${max}</td></tr>`;
        }).join("")}
        ${(t.icons || []).map(([k, nm]) => `<tr><td class="muted">图标：${esc(nm)}</td><td colspan="2"><input id="pl${i}_i_${k}" data-pf="${i}|icons|${k}" value="${esc((pl.icons || {})[k] || "")}" placeholder="画什么图标 / 插画（不是文字）"></td></tr>`).join("")}
        <tr><td class="muted">补充说明</td><td colspan="2"><input id="pl${i}_note" data-pf="${i}|note" value="${esc(pl.note || "")}" placeholder="可以不填，如：主标题再大一点、图标用电脑"></td></tr>
        </tbody></table>
        <div class="row" style="margin-top:6px;gap:8px">${pl.iconKey ? `<img class="plicon" src="${esc(ST.urlFor(pl.iconKey))}" alt=""><span class="muted">出图时用这张店铺图标 / logo</span><button class="sm" data-act="planIconDel">不用了</button>` : '<button class="sm" data-act="planIcon" title="上传你自己的 logo / 吉祥物，出图时放在图标位置（不让 AI 画）">上传店铺图标（可选）</button>'}</div></div></div></div>`;
  }
  function planCard(pl, i, p) {
    const f = (k, label, wide) => `<label class="pf ${wide ? "wide" : ""}"><span>${label}</span><input id="pl${i}_${k}" data-pf="${i}|${k}" value="${esc(pl[k] || "")}"></label>`;
    const hitsAll = (pl.blocks || []).flatMap((b) => ST.banHits(b.text, p.posterBan));
    const opt = (list, v) => list.map((x) => `<option ${x === v ? "selected" : ""}>${x}</option>`).join("");
    return `<div class="plan ${pl.on === false ? "off" : ""}" data-plan="${i}">
      <div class="row ph"><label class="row"><input type="checkbox" data-pf="${i}|on" ${pl.on !== false ? "checked" : ""}> 用这套</label>
        <b>方案 ${i + 1}</b><input class="ptheme" id="pl${i}_theme" data-pf="${i}|theme" value="${esc(pl.theme || "")}" title="这张图讲什么">
        ${pl.by ? `<span class="tag">${esc((PLAN_SITES.find((x) => x[0] === pl.by) || [0, pl.by])[1])} 写的</span>` : ""}
        <span class="tag bad" id="pl${i}_ban" ${hitsAll.length ? "" : "hidden"}>有禁用词：${esc([...new Set(hitsAll)].join("、"))}</span>
        <span class="sp row"><button class="sm" data-act="planSketch" title="程序按方案画一张平面草图，看字的位置、大小、颜色对不对">看草图</button><button class="sm danger" data-act="planDel">删除方案</button></span></div>
      <div class="pgrid2">${f("style", "风格")}${f("colors", "色系")}
        <label class="pf"><span>底色</span><span class="row"><input type="color" id="pl${i}_bgColor" data-pf="${i}|bgColor" value="${esc(pl.bgColor || "#f2f4f7")}"> → <input type="color" id="pl${i}_bgColor2" data-pf="${i}|bgColor2" value="${esc(pl.bgColor2 || pl.bgColor || "#ffffff")}"></span></label>
        ${f("background", "背景", true)}${f("layout", "版式", true)}${f("icons", "图标 / 装饰", true)}${f("note", "补充说明", true)}</div>
      <table class="ptable"><thead><tr><th>位置</th><th>文字</th><th>字体</th><th>粗细</th><th>字号</th><th>左右 %</th><th>上下 %</th><th>颜色</th><th>效果</th><th>底色</th><th></th></tr></thead><tbody>
        ${(pl.blocks || []).map((b, j) => {
          const id = (k) => `id="pl${i}_b${j}_${k}" data-pf="${i}|${j}|${k}"`;
          const hits = ST.banHits(b.text, p.posterBan);
          return `<tr data-row="${j}"><td><input ${id("pos")} value="${esc(b.pos || "")}" class="w6"></td>
            <td><input ${id("text")} value="${esc(b.text || "")}" class="w14 ${hits.length ? "banhit" : ""}" title="${hits.length ? "禁用词：" + esc(hits.join("、")) : ""}"></td>
            <td><select ${id("font")}>${opt(PLAN_FONTS, b.font || "黑体")}</select></td><td><select ${id("weight")}>${opt(PLAN_WEIGHTS, b.weight || "粗")}</select></td>
            <td><input type="number" ${id("size")} value="${+b.size || 40}" min="12" max="200" class="w4"></td><td><input type="number" ${id("x")} value="${+b.x || 50}" min="2" max="98" class="w4"></td><td><input type="number" ${id("y")} value="${+b.y || 50}" min="2" max="98" class="w4"></td>
            <td><input type="color" ${id("color")} value="${esc(b.color || "#333333")}"></td><td><input ${id("effect")} value="${esc(b.effect || "")}" class="w8"></td>
            <td><input ${id("bg")} value="${esc(b.bg || "")}" placeholder="无" class="w6"></td><td><button class="sm ghost" data-act="planDelRow" title="删掉这一行">✕</button></td></tr>`;
        }).join("")}</tbody></table>
      <button class="sm" data-act="planAddRow" style="margin-top:6px">＋ 加一行文字</button>
      <div class="muted" style="margin-top:4px">字号按 800×800 算（像素）；左右 / 上下 = 这行字的中心在画面里的位置（%，左右 50 就是居中；左右分栏一般左 25～30、右 70～75）；左右都是 50、上下也一样的几行会自动排成一排（比如三个标签）。</div></div>`;
  }
  /** 改方案里的一格：直接改项目里的数据，半秒后保存；文字改了马上重新查禁用词 */
  function planEdit(t) {
    const [i, a, b] = t.dataset.pf.split("|");
    const pl = P().plans && P().plans[+i];
    if (!pl) return;
    const v = t.type === "checkbox" ? t.checked : t.type === "number" || a === "palette" ? +t.value : t.value;
    if (b && (a === "slots" || a === "icons")) { pl[a] = pl[a] || {}; pl[a][b] = v; }
    else if (b) pl.blocks[+a][b] = v; else pl[a] = v;
    setSoon({ plans: P().plans });
    if (t.type === "checkbox") render();
    if (b === "text" || a === "slots") banRefresh();
  }
  /** 自己填的禁止词，在“要表达的内容”里也出现了（会让 AI 写出意思不对的话） */
  function banConflict(p) {
    const content = String(p.posterContent != null ? p.posterContent : "");
    return String(p.posterBan || "").split(/[,，、;；\s]+/).map((x) => x.trim()).filter((w) => w && content.includes(w));
  }
  function banRefresh() {
    const p = P();
    const bc = $("banConflict");
    if (bc) { const c = banConflict(p); bc.hidden = !c.length; bc.textContent = `注意：禁止词里的“${c.join("”“")}”在“要表达的内容”里也有——AI 写方案时会避开它，可能写出意思不对的话（比如不让写“退款”，就写成“不成功也收费”）。`; }
    (p.plans || []).forEach((pl, i) => {
      const all = [];
      const tp = pl.tpl && ST.posterTpl(pl.tpl);
      if (tp) for (const [k, , max] of tp.slots) {
        const v = (pl.slots || {})[k] || "", el = $(`pl${i}_s_${k}`), c = $(`pl${i}_c_${k}`), h = ST.banHits(v, p.posterBan), len = [...v].length;
        all.push(...h);
        if (el) { el.classList.toggle("banhit", !!h.length || len > max); el.title = h.length ? "禁用词：" + h.join("、") : len > max ? "超出字数" : ""; }
        if (c) c.textContent = `${len}/${max}`;
      }
      for (const b of (pl.boxes || []).filter((x) => x.type === "text")) {
        const el = $(`pb${i}_${b.id}`), h = ST.banHits(b.text, p.posterBan);
        all.push(...h);
        if (el) { el.classList.toggle("banhit", !!h.length); el.classList.toggle("overlen", !h.length && ST.boxLen(b.text) > ST.boxMax(b)); }
      }
      (pl.blocks || []).forEach((b, j) => {
        const el = $(`pl${i}_b${j}_text`);
        const h = ST.banHits(b.text, p.posterBan);
        all.push(...h);
        if (el) { el.classList.toggle("banhit", !!h.length); el.title = h.length ? "禁用词：" + h.join("、") : ""; }
      });
      const tag = $(`pl${i}_ban`);
      if (tag) { tag.hidden = !all.length; tag.textContent = `有禁用词：${[...new Set(all)].join("、")}`; }
    });
  }
  /**
   * 草图：程序按方案画的平面图——字、位置、大小、颜色都照方案（字一定对），没有质感、光影和图标。
   * 用来先看布局；勾“附上草图”时一起发给 AI，让它照着排版再做精致。
   */
  async function renderSketch(pl, px = 800) {
    const c = document.createElement("canvas");
    c.width = c.height = px;
    const g = c.getContext("2d");
    const k = px / 800;
    const gr = g.createLinearGradient(0, 0, 0, px);
    gr.addColorStop(0, pl.bgColor || "#f2f4f7"); gr.addColorStop(1, pl.bgColor2 || pl.bgColor || "#ffffff");
    g.fillStyle = gr; g.fillRect(0, 0, px, px);
    const fam = (f) => (/宋|楷/.test(f || "") ? '"Noto Serif SC", serif' : '"Noto Sans SC", sans-serif');
    const wt = (w) => ({ 常规: 400, 中粗: 500, 粗: 700, 特粗: 900 })[w] || 700;
    const blocks = (pl.blocks || []).filter((b) => String(b.text || "").trim());
    try { await Promise.all(blocks.map((b) => document.fonts.load(`${wt(b.weight)} ${Math.round((+b.size || 40) * k)}px ${fam(b.font)}`, b.text))); } catch {}
    // 上下位置差不多的几块排成一排
    // 左右位置是 50（居中）、上下位置差不多的几块排成一排；指定了左右位置的按位置放
    const rows = [];
    for (const b of [...blocks].sort((x, y) => (+x.y || 50) - (+y.y || 50))) {
      const free = (+b.x || 50) === 50;
      const r = free && rows.find((r) => r.free && Math.abs(r.y - (+b.y || 50)) < 3);
      r ? r.items.push(b) : rows.push({ y: +b.y || 50, free, items: [b] });
    }
    for (const r of rows) {
      const cy = (r.y / 100) * px, n = r.items.length;
      r.items.forEach((b, idx) => {
        let size = (+b.size || 40) * k;
        const font = () => `${wt(b.weight)} ${size}px ${fam(b.font)}`;
        g.font = font();
        const bx = r.free ? (px / n) * (idx + 0.5) : ((+b.x || 50) / 100) * px;
        const maxW = r.free ? (px * 0.92) / n : Math.min(bx, px - bx) * 2 * 0.96;
        while (g.measureText(b.text).width > maxW && size > 10) { size -= 1; g.font = font(); }
        const w = g.measureText(b.text).width, cx = bx;
        const ef = b.effect || "";
        g.save();
        if (/横条|底条|横幅|通栏/.test(ef)) { g.fillStyle = b.bg || "#1d4ed8"; g.fillRect(0, cy - size * 0.95, px, size * 1.9); }
        else if (/框|标签|胶囊|底块|色块/.test(ef) || b.bg) {
          const pw = w + size * 1.2, ph = size * 1.6, x = cx - pw / 2, y = cy - ph / 2, rr = ph / 2;
          g.beginPath(); g.roundRect ? g.roundRect(x, y, pw, ph, rr) : g.rect(x, y, pw, ph);
          if (b.bg) { g.fillStyle = b.bg; g.fill(); }
          if (/虚线/.test(ef)) { g.setLineDash([6 * k, 5 * k]); g.lineWidth = 2 * k; g.strokeStyle = b.color || "#333"; g.stroke(); }
          else if (!b.bg) { g.lineWidth = 2 * k; g.strokeStyle = b.color || "#333"; g.stroke(); }
        }
        g.restore();
        g.save();
        g.font = font(); g.textAlign = "center"; g.textBaseline = "middle";
        if (/阴影/.test(ef)) { g.shadowColor = "rgba(0,0,0,.25)"; g.shadowOffsetY = size * 0.06; g.shadowBlur = size * 0.12; }
        if (/描边/.test(ef)) { g.lineJoin = "round"; g.lineWidth = size * 0.14; g.strokeStyle = /黑色描边|深色描边/.test(ef) ? "#222" : "#fff"; g.strokeText(b.text, cx, cy); }
        g.fillStyle = b.color || "#333"; g.fillText(b.text, cx, cy);
        g.restore();
      });
    }
    return c;
  }

  // ------------------------------------------------------------ 文字主图：框模板（Lee 2026-10-27）
  const boxTpl = (id) => ST.boxTpl(id, myBoxTpls);
  const natural = (a, b) => String(a.id).localeCompare(String(b.id), "en", { numeric: true });
  const allBoxTpls = () => [...ST.BOX_TPLS.map((t) => myBoxTpls.find((x) => x.id === t.id) || t), ...myBoxTpls.filter((x) => !ST.BOX_TPLS.some((t) => t.id === x.id)).sort(natural)];
  const refUrl = (t) => (t && t.refKey ? ST.urlFor(t.refKey) : (t && t.ref) || "");
  const BOX_ROLE = { text: "文字", icon: "图标", block: "色块", line: "线" };
  const planOf = (el) => P().plans[+el.closest("[data-plan]").dataset.plan];
  const boxOf = (pl) => (pl.boxes || []).find((b) => b.id === bsel[pl.id]) || null;
  /** 一个方案：左边草图编辑器，右边选中框的样式 + 所有文字框 / 图标框的字 */
  function boxPlanCard(pl, i, p) {
    const rows = ST.boxTexts(pl.boxes).filter((b) => b.type === "text" || b.type === "icon");
    const hitsAll = rows.filter((b) => b.type === "text").flatMap((b) => ST.banHits(b.text, p.posterBan));
    return `<div class="plan boxplan ${pl.on === false ? "off" : ""}" data-plan="${i}">
      <div class="row ph"><label class="row"><input type="checkbox" data-pf="${i}|on" ${pl.on !== false ? "checked" : ""}> 用这套</label>
        <b>方案 ${i + 1}</b><input class="ptheme" id="pl${i}_theme" data-pf="${i}|theme" value="${esc(pl.theme || "")}" title="这张图讲什么">
        <span class="tag" data-refhover="${esc(refUrl(pl))}" data-refname="模板 ${esc(pl.tpl)} 的参考图">模板 ${esc(pl.tpl)}${pl.tplName ? " " + esc(pl.tplName) : ""}</span>
        ${pl.by ? `<span class="tag">${esc((PLAN_SITES.find((x) => x[0] === pl.by) || [0, pl.by])[1])} 写的</span>` : ""}
        <span class="tag bad" id="pl${i}_ban" ${hitsAll.length ? "" : "hidden"}>有禁用词：${esc([...new Set(hitsAll)].join("、"))}</span>
        <span class="sp row"><label class="row lb" title="背景从上到下两个颜色（只是草图的底色，AI 出图按参考图的风格画）">底色 <input type="color" data-bp="${i}|bg1" value="${esc(pl.bg1 || "#ffffff")}"><input type="color" data-bp="${i}|bg2" value="${esc(pl.bg2 || pl.bg1 || "#ffffff")}"></label>
        <button class="sm" data-act="boxSketch" title="看大图：程序画的草图（出图时发给 AI 的就是这张）">看草图</button>
        <button class="sm" data-act="boxSaveTpl" title="把现在的框（位置、大小、样式，不含字）存成“我的模板”，名字 ${esc(String(pl.tpl).split("-")[0])}-1、${esc(String(pl.tpl).split("-")[0])}-2…">存为我的模板</button>
        <button class="sm danger" data-act="planDel">删除方案</button></span></div>
      <div class="boxed"><div class="bedit"><canvas data-bed="${i}" width="900" height="900" tabindex="0"></canvas>
        <div class="row btools"><button class="sm" data-act="boxAdd" data-type="text">＋文字</button><button class="sm" data-act="boxAdd" data-type="icon">＋图标</button><button class="sm" data-act="boxAdd" data-type="block">＋色块</button><button class="sm" data-act="boxAdd" data-type="line">＋线</button>
          <span class="sp row"><button class="sm" data-act="boxDup" title="复制选中的框">复制</button><button class="sm danger" data-act="boxDel" title="删除选中的框（也可以按 Delete）">删除框</button></span></div></div>
        <div class="grow bside"><div class="bprops" id="bprops${i}">${boxProps(pl, i)}</div>
          <table class="ptable"><thead><tr><th style="width:110px">框</th><th>文字 / 图标画什么</th><th style="width:56px">字数</th></tr></thead><tbody>
          ${rows.map((b) => boxRow(pl, i, b, p)).join("")}
          <tr><td class="muted">补充说明</td><td colspan="2"><input id="pl${i}_note" data-pf="${i}|note" value="${esc(pl.note || "")}" placeholder="可以不填，如：大标题用 3D 立体字"></td></tr></tbody></table></div></div></div>`;
  }
  function boxRow(pl, i, b, p) {
    const on = bsel[pl.id] === b.id ? "on" : "";
    if (b.type === "icon") return `<tr class="brow ${on}" data-bid="${b.id}"><td class="muted">图标：${esc(b.role)}</td><td colspan="2"><input id="pb${i}_${b.id}" data-bx="${i}|${b.id}|desc" value="${esc(b.desc || "")}" placeholder="画什么图标 / 插画（不是文字）"></td></tr>`;
    const v = b.text || "", len = ST.boxLen(v), max = ST.boxMax(b), hits = ST.banHits(v, p.posterBan);
    return `<tr class="brow ${on}" data-bid="${b.id}"><td class="muted">${esc(b.role)}</td><td><input id="pb${i}_${b.id}" data-bx="${i}|${b.id}|text" value="${esc(v)}" class="${hits.length ? "banhit" : len > max ? "overlen" : ""}" title="${hits.length ? "禁用词：" + esc(hits.join("、")) : len > max ? "字可能放不下（框太小会自动缩小字）" : ""}"></td><td class="muted" id="bc${i}_${b.id}">${len}/${max}</td></tr>`;
  }
  /** 选中框的样式（没选中就是提示） */
  function boxProps(pl, i) {
    const b = boxOf(pl);
    if (!b) return '<div class="muted">点草图里的框（或下面表格里的一行）选中它，在这里改位置、大小、颜色。</div>';
    const f = (k, label, type = "number", extra = "") => `<label class="row lb">${label} <input type="${type}" data-bx="${i}|${b.id}|${k}" id="bp${i}_${k}" value="${esc(b[k] != null ? b[k] : "")}" ${extra}></label>`;
    const col = (k, label) => `<label class="row lb">${label} <input type="color" data-bx="${i}|${b.id}|${k}" value="${esc(b[k] || "#ffffff")}">${k !== "color" ? `<input type="checkbox" data-bx="${i}|${b.id}|${k}On" ${b[k] ? "checked" : ""} title="有没有">` : ""}</label>`;
    return `<div class="row" style="gap:8px;flex-wrap:wrap"><b>${BOX_ROLE[b.type] || ""}框</b>${f("role", "名称", "text", 'style="width:110px"')}
      ${f("x", "左", "number", 'step="0.5" class="w4"')}${f("y", "上", "number", 'step="0.5" class="w4"')}${f("w", "宽", "number", 'step="0.5" class="w4"')}${f("h", "高", "number", 'step="0.5" class="w4"')}<span class="muted">（%）</span></div>
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:6px">${b.type === "text" ? `${col("color", "字色")}${col("bg", "底色")}${col("border", "边框")}${f("lines", "行数", "number", 'min="1" max="4" class="w4"')}
        <label class="row lb"><input type="checkbox" data-bx="${i}|${b.id}|bold" ${b.bold !== false ? "checked" : ""}> 粗体</label>
        <label class="row lb">对齐 <select data-bx="${i}|${b.id}|align">${[["left", "左"], ["center", "中"], ["right", "右"]].map(([v, t]) => `<option value="${v}" ${(b.align || "center") === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        ${f("radius", "圆角", "number", 'min="0" max="99" class="w4" title="胶囊形写 99"')}${col("stroke", "描边字")}` : b.type === "block" ? `${col("bg", "颜色")}${f("radius", "圆角", "number", 'min="0" max="99" class="w4"')}` : b.type === "line" ? `${col("color", "颜色")}<label class="row lb"><input type="checkbox" data-bx="${i}|${b.id}|frame" ${b.frame ? "checked" : ""}> 整圈边框</label>` : `<span class="muted">图标框：AI 在这里画图标，画什么写在下面表格里</span>`}</div>`;
  }
  /** 画一个方案的编辑器（选中的框描蓝边，右下角一个改大小的小方块） */
  function drawEditor(i) {
    const cv = document.querySelector(`canvas[data-bed="${i}"]`), pl = P().plans[i];
    if (!cv || !pl) return;
    const g = cv.getContext("2d"), S = cv.width;
    g.clearRect(0, 0, S, S);
    ST.drawBoxes(g, pl.boxes, S, { mode: "sketch", bg1: pl.bg1, bg2: pl.bg2, sel: bsel[pl.id], hint: true });
    const b = boxOf(pl);
    if (b) { const k = S / 100, hs = 16; g.fillStyle = "#2563eb"; g.fillRect((b.x + b.w) * k - hs / 2, (b.y + b.h) * k - hs / 2, hs, hs); }
  }
  /** 出图用的草图（不画提示框、空框不写名字） */
  async function renderBoxSketch(pl, px = 1024) {
    try { await document.fonts.ready; } catch {}
    const c = document.createElement("canvas");
    c.width = c.height = px;
    ST.drawBoxes(c.getContext("2d"), pl.boxes, px, { mode: "sketch", bg1: pl.bg1, bg2: pl.bg2 });
    return c;
  }
  /** 画完页面：模板缩略图（线框）和每个方案的编辑器 */
  function drawCanvases() {
    for (const cv of document.querySelectorAll("canvas[data-wire]")) { const t = boxTpl(cv.dataset.wire); if (t) ST.drawBoxes(cv.getContext("2d"), t.boxes, cv.width, { mode: "wire" }); }
    (P().plans || []).forEach((pl, i) => { if (pl.boxes) drawEditor(i); });
  }
  /** 选中的框变了：只换右边的样式面板和表格高亮，不重画整页 */
  function selChanged(i) {
    const pl = P().plans[i], el = $(`bprops${i}`);
    if (el) el.innerHTML = boxProps(pl, i);
    document.querySelectorAll(`[data-plan="${i}"] .brow`).forEach((r) => r.classList.toggle("on", r.dataset.bid === bsel[pl.id]));
    drawEditor(i);
  }
  const saveBoxes = () => setSoon({ plans: P().plans });
  /** 改框的一项（右边的样式、表格里的字） */
  function bxEdit(t) {
    const [i, bid, k] = t.dataset.bx.split("|");
    const pl = P().plans[+i], b = pl && pl.boxes.find((x) => x.id === bid);
    if (!b) return;
    if (/On$/.test(k)) { const kk = k.slice(0, -2); b[kk] = t.checked ? (t.parentNode.querySelector('input[type="color"]').value || "#ffffff") : ""; }
    else if (t.type === "checkbox") b[k] = t.checked;
    else if (t.type === "number") { const v = +t.value; if (!Number.isFinite(v)) return; b[k] = k === "lines" ? Math.min(4, Math.max(1, Math.round(v))) : ST.clamp(v, 0, k === "radius" ? 99 : 100); }
    else if (t.type === "color") { b[k] = t.value; const on = t.parentNode.querySelector('input[type="checkbox"]'); if (on) on.checked = true; }
    else b[k] = t.value;
    if (k === "text") {
      const v = b.text || "", len = ST.boxLen(v), max = ST.boxMax(b), h = ST.banHits(v, P().posterBan), c = $(`bc${i}_${bid}`);
      if (c) c.textContent = `${len}/${max}`;
      t.classList.toggle("banhit", !!h.length);
      t.classList.toggle("overlen", !h.length && len > max);
      t.title = h.length ? "禁用词：" + h.join("、") : len > max ? "字可能放不下（框太小会自动缩小字）" : "";
      banRefresh();
    }
    drawEditor(+i);
    saveBoxes();
  }
  // 拖框、改大小（拖的时候不重画整页）
  let dragHold = false, dragLater = false, drag = null;
  const ptOf = (cv, e) => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 }; };
  function hitBox(pl, pt) {
    const inside = (b, m = 0) => pt.x >= b.x - m && pt.x <= b.x + b.w + m && pt.y >= b.y - m && pt.y <= b.y + b.h + m;
    const bs = [...(pl.boxes || [])].reverse();
    return bs.find((b) => (b.type === "text" || b.type === "icon") && inside(b))
      || bs.find((b) => b.type === "line" && (b.frame ? inside(b) && (pt.x - b.x < 2 || b.x + b.w - pt.x < 2 || pt.y - b.y < 2 || b.y + b.h - pt.y < 2) : inside(b, 1.5)))
      || bs.find((b) => b.type === "block" && inside(b)) || null;
  }
  document.addEventListener("pointerdown", (e) => {
    const cv = e.target.closest && e.target.closest("canvas[data-bed]");
    if (!cv || !P()) return;
    const i = +cv.dataset.bed, pl = P().plans[i], pt = ptOf(cv, e), cur = boxOf(pl);
    let b = null, how = "move";
    if (cur && Math.abs(pt.x - (cur.x + cur.w)) < 2.2 && Math.abs(pt.y - (cur.y + cur.h)) < 2.2) { b = cur; how = "size"; }
    else b = hitBox(pl, pt);
    bsel[pl.id] = b ? b.id : "";
    selChanged(i);
    if (!b) return;
    e.preventDefault();
    cv.focus({ preventScroll: true }); // 别让页面滚动（拖到一半框会跳）
    cv.setPointerCapture(e.pointerId);
    drag = { cv, i, b, how, pt, o: { x: b.x, y: b.y, w: b.w, h: b.h }, moved: false };
    dragHold = true;
  });
  document.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const pt = ptOf(drag.cv, e), dx = pt.x - drag.pt.x, dy = pt.y - drag.pt.y, b = drag.b, o = drag.o, r = (v) => Math.round(v * 2) / 2;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 0.4) return;
    drag.moved = true;
    if (drag.how === "size") { b.w = r(ST.clamp(o.w + dx, 1, 100 - b.x)); b.h = r(ST.clamp(o.h + dy, 0.5, 100 - b.y)); }
    else { b.x = r(ST.clamp(o.x + dx, 0, 100 - b.w)); b.y = r(ST.clamp(o.y + dy, 0, 100 - b.h)); }
    drawEditor(drag.i);
  });
  const dragEnd = () => {
    if (!drag) return;
    const d = drag;
    drag = null; dragHold = false;
    if (d.moved) { for (const k of ["x", "y", "w", "h"]) { const el = $(`bp${d.i}_${k}`); if (el) el.value = d.b[k]; } saveBoxes(); }
    if (dragLater) { dragLater = false; render(); }
  };
  document.addEventListener("pointerup", dragEnd);
  document.addEventListener("pointercancel", dragEnd);
  // 键盘：Delete 删框，方向键挪 0.5%（Shift 挪 2%）
  document.addEventListener("keydown", (e) => {
    const cv = document.activeElement && document.activeElement.closest && document.activeElement.closest("canvas[data-bed]");
    if (!cv || !P()) return;
    const i = +cv.dataset.bed, pl = P().plans[i], b = boxOf(pl);
    if (!b) return;
    const st = e.shiftKey ? 2 : 0.5;
    const mv = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
    if (mv) { e.preventDefault(); b.x = ST.clamp(b.x + mv[0], 0, 100 - b.w); b.y = ST.clamp(b.y + mv[1], 0, 100 - b.h); selChanged(i); saveBoxes(); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); pl.boxes = pl.boxes.filter((x) => x !== b); bsel[pl.id] = ""; saveBoxes(); render(); }
  });
  // 鼠标移到模板 / 方案的“模板”标签上：旁边显示模板的参考图
  const hov = document.createElement("div");
  hov.className = "refhover";
  hov.hidden = true;
  document.body.appendChild(hov);
  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest && e.target.closest("[data-refhover]");
    if (!el || !el.dataset.refhover) { hov.hidden = true; return; }
    if (hov.dataset.src !== el.dataset.refhover) { hov.dataset.src = el.dataset.refhover; hov.innerHTML = `<img src="${esc(el.dataset.refhover)}" alt=""><div>${esc(el.dataset.refname || "参考图")}</div>`; }
    const r = el.getBoundingClientRect(), W = 320;
    const left = r.right + 10 + W < innerWidth ? r.right + 10 : Math.max(8, r.left - 10 - W);
    hov.style.left = left + "px";
    hov.style.top = Math.max(8, Math.min(r.top, innerHeight - W - 50)) + "px";
    hov.hidden = false;
  });
  /**
   * 编辑模板（Lee 2026-10-28：在模板上右键）：删框、挪位置、改大小、加框，可以叠在参考图上对着改。
   * 保存：我的模板直接改；内置模板改过的存进“我的模板”（同名，标“改过”），能恢复原样。另存为 = 新模板 X-1、X-2…
   * 已经写好的方案用的是当时的一份，不受影响。
   */
  async function editTpl(id) {
    const t0 = boxTpl(id);
    if (!t0) return;
    const builtin = ST.BOX_TPLS.find((t) => t.id === id);
    const work = { boxes: JSON.parse(JSON.stringify(t0.boxes)) };
    let sel = "", overlay = true, drg = null;
    const ref = refUrl(t0);
    const refImg = new Image();
    if (ref) refImg.src = ref;
    const mine0 = (await ST.db.getMeta("posterBoxTpls", [])) || [];
    const asName = ST.nextDerivedName(id, [...ST.BOX_TPLS.map((t) => t.id), ...mine0.map((t) => t.id)]);
    let cv, m0;
    const cur = () => work.boxes.find((b) => b.id === sel) || null;
    const draw = () => {
      const g = cv.getContext("2d"), S = cv.width;
      g.fillStyle = "#fff"; g.fillRect(0, 0, S, S);
      if (overlay && refImg.complete && refImg.naturalWidth) { g.drawImage(refImg, 0, 0, S, S); g.fillStyle = "rgba(255,255,255,.55)"; g.fillRect(0, 0, S, S); }
      ST.drawBoxes(g, work.boxes, S, { mode: "wire", clear: true, sel });
      const b = cur();
      if (b) { const k = S / 100, hs = 16; g.fillStyle = "#2563eb"; g.fillRect((b.x + b.w) * k - hs / 2, (b.y + b.h) * k - hs / 2, hs, hs); }
    };
    const props = () => {
      const b = cur(), el = m0.querySelector("#teProps");
      if (!b) { el.innerHTML = '<div class="muted">点一个框选中它：拖动换位置，拖右下角蓝色小方块改大小，Delete 删掉，方向键微调（Shift 挪得多）。</div>'; return; }
      const f = (k, label, type = "number") => `<label class="row lb">${label} <input type="${type}" data-te="${k}" value="${esc(b[k] != null ? b[k] : "")}" ${type === "number" ? 'step="0.5"' : ""}></label>`;
      el.innerHTML = `<div class="row" style="gap:8px;flex-wrap:wrap"><b>${BOX_ROLE[b.type] || ""}框</b>${f("role", "名称", "text")}${b.type === "text" ? f("lines", "行数") : ""}</div>
        <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:6px">${f("x", "左")}${f("y", "上")}${f("w", "宽")}${f("h", "高")}<span class="muted">（%）</span></div>`;
    };
    const syncNums = () => { const b = cur(); if (!b) return; for (const k of ["x", "y", "w", "h"]) { const el = m0.querySelector(`[data-te="${k}"]`); if (el && document.activeElement !== el) el.value = b[k]; } };
    const nextId = () => "b" + (Math.max(0, ...work.boxes.map((b) => +String(b.id).slice(1) || 0)) + 1);
    const r = await APP.modal(`<div class="tedit"><div class="tecv"><canvas id="teCv" width="900" height="900" tabindex="0"></canvas>
        <div class="row btools"><button class="sm" data-te-add="text">＋文字</button><button class="sm" data-te-add="icon">＋图标</button><button class="sm" data-te-add="block">＋色块</button><button class="sm" data-te-add="line">＋线</button>
          <span class="sp row"><button class="sm" id="teDup">复制</button><button class="sm danger" id="teDel">删除框</button></span></div></div>
        <div class="teside">${ref ? `<label class="row lb"><input type="checkbox" id="teOver" checked> 叠在参考图上看（对着原图挪位置）</label><img class="teref" src="${esc(ref)}" alt="">` : ""}<div class="bprops" id="teProps" style="margin-top:8px"></div>
          <div class="muted">${builtin ? "这是内置模板：保存后用改过的（标“改过”），以后可以“恢复原样”。" : "保存会直接改这个模板。"}已经写好的方案不受影响，重新写方案才用新的。</div></div></div>
      <div class="mf"><button data-ret="">取消</button>${builtin && t0.edited ? '<button data-ret="restore">恢复原样</button>' : ""}<button data-ret="saveas">另存为 ${esc(asName)}</button><button class="primary" data-ret="save">保存</button></div>`, {
      title: `编辑模板 ${id}${t0.name ? " · " + t0.name : ""}`, big: true,
      onOpen: (m) => {
        m0 = m; cv = m.querySelector("#teCv");
        refImg.onload = draw;
        draw(); props();
        const pt = (e) => { const rc = cv.getBoundingClientRect(); return { x: ((e.clientX - rc.left) / rc.width) * 100, y: ((e.clientY - rc.top) / rc.height) * 100 }; };
        cv.onpointerdown = (e) => {
          const p = pt(e), c = cur();
          let b = null, how = "move";
          if (c && Math.abs(p.x - (c.x + c.w)) < 2.2 && Math.abs(p.y - (c.y + c.h)) < 2.2) { b = c; how = "size"; } else b = hitBox(work, p);
          sel = b ? b.id : ""; draw(); props();
          if (!b) return;
          e.preventDefault(); cv.focus({ preventScroll: true }); cv.setPointerCapture(e.pointerId);
          drg = { b, how, p, o: { x: b.x, y: b.y, w: b.w, h: b.h } };
        };
        cv.onpointermove = (e) => {
          if (!drg) return;
          const p = pt(e), dx = p.x - drg.p.x, dy = p.y - drg.p.y, b = drg.b, o = drg.o, rd = (v) => Math.round(v * 2) / 2;
          if (drg.how === "size") { b.w = rd(ST.clamp(o.w + dx, 1, 100 - b.x)); b.h = rd(ST.clamp(o.h + dy, 0.5, 100 - b.y)); }
          else { b.x = rd(ST.clamp(o.x + dx, 0, 100 - b.w)); b.y = rd(ST.clamp(o.y + dy, 0, 100 - b.h)); }
          draw(); syncNums();
        };
        cv.onpointerup = cv.onpointercancel = () => { drg = null; };
        cv.onkeydown = (e) => {
          const b = cur();
          if (!b) return;
          const st = e.shiftKey ? 2 : 0.5, mv = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
          if (mv) { e.preventDefault(); b.x = ST.clamp(b.x + mv[0], 0, 100 - b.w); b.y = ST.clamp(b.y + mv[1], 0, 100 - b.h); draw(); syncNums(); }
          else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); work.boxes = work.boxes.filter((x) => x !== b); sel = ""; draw(); props(); }
        };
        m.addEventListener("input", (e) => {
          const k = e.target.dataset.te, b = cur();
          if (k && b) { if (k === "role") b.role = e.target.value.slice(0, 16); else { const v = +e.target.value; if (Number.isFinite(v)) b[k] = k === "lines" ? Math.min(4, Math.max(1, Math.round(v))) : ST.clamp(v, 0, 100); } draw(); }
          if (e.target.id === "teOver") { overlay = e.target.checked; draw(); }
        });
        m.addEventListener("click", (e) => {
          const add = e.target.closest("[data-te-add]");
          if (add) {
            const type = add.dataset.teAdd, role = `${BOX_ROLE[type]} ${work.boxes.filter((b) => b.type === type).length + 1}`;
            const b = { text: { type, role, x: 30, y: 45, w: 40, h: 8, color: "#111111", bg: "", bold: true, lines: 1, align: "center" }, icon: { type, role, x: 40, y: 40, w: 20, h: 20, desc: "" }, block: { type, role, x: 0, y: 84, w: 100, h: 16, bg: "#1d4ed8", radius: 0 }, line: { type, role, x: 10, y: 50, w: 80, h: 0.6, color: "#333333" } }[type];
            b.id = nextId();
            type === "block" ? work.boxes.unshift(b) : work.boxes.push(b);
            sel = b.id; draw(); props(); return;
          }
          const b = cur();
          if (e.target.id === "teDel") { if (!b) return APP.toast("先点一个框选中它", true); work.boxes = work.boxes.filter((x) => x !== b); sel = ""; draw(); props(); }
          if (e.target.id === "teDup") { if (!b) return APP.toast("先点一个框选中它", true); const c = { ...JSON.parse(JSON.stringify(b)), id: nextId(), x: Math.min(100 - b.w, b.x + 3), y: Math.min(100 - b.h, b.y + 3) }; work.boxes.splice(work.boxes.indexOf(b) + 1, 0, c); sel = c.id; draw(); props(); }
        });
      },
    });
    if (!r) return;
    const mine = ((await ST.db.getMeta("posterBoxTpls", [])) || []);
    const boxes = work.boxes.map((b) => { const x = { ...b }; delete x.text; return x; });
    let msg;
    if (r === "restore") { myBoxTpls = mine.filter((x) => x.id !== id); msg = `模板 ${id} 恢复原样了`; }
    else if (r === "saveas") {
      const nid = ST.nextDerivedName(id, [...ST.BOX_TPLS.map((t) => t.id), ...mine.map((t) => t.id)]);
      myBoxTpls = [...mine, { ...JSON.parse(JSON.stringify(t0)), id: nid, builtin: false, edited: false, base: false, parent: id, t: Date.now(), boxes }];
      msg = `另存好了：模板 ${nid}`;
    } else {
      const nt = { ...JSON.parse(JSON.stringify(t0)), boxes, t: Date.now() };
      if (builtin) Object.assign(nt, { builtin: true, edited: true });
      myBoxTpls = mine.some((x) => x.id === id) ? mine.map((x) => (x.id === id ? nt : x)) : [...mine, nt];
      msg = `模板 ${id} 保存好了`;
    }
    await ST.db.setMeta("posterBoxTpls", myBoxTpls);
    APP.toast(msg);
    render();
  }
  document.addEventListener("contextmenu", (e) => {
    const c = e.target.closest && e.target.closest("[data-btpl]");
    if (!c || !P()) return;
    e.preventDefault();
    hov.hidden = true;
    editTpl(c.dataset.btpl);
  });
  /** 从一张参考图生成模板：图存起来，交给服务器（看图的 AI 拆成框，存进“我的模板”） */
  async function learnTpl(f) {
    if (!f) return;
    try {
      const blob = f.type ? f : new Blob([f], { type: ST.mimeOf(f.name) });
      await ST.blobToImage(blob);
      const key = `mtpl:${ST.uid("r")}`;
      await ST.saveImage(key, await ST.shrink(blob, 1280));
      const p = await op({ op: "learnBoxTpl", key, site: learnSite });
      if (p) APP.toast("AI 正在看这张图拆版式，生成好了会出现在模板最后面，并且自动选上");
    } catch (e) { APP.toast(`图片打不开：${e.message}`, true); }
  }

  async function itemCard(it) {
    const st = it.job || "";
    const poster = it.mode === "poster";
    const scene = it.mode === "scene" || poster; // 照参考图设计和 AI 直接画一样：一张 AI 图
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
        if (j && poster) { warn = j.ok === false; line = j.ok === null ? j.note : j.ok ? "AI 审核：文字没问题" : `AI 审核：文字有问题——${(j.bad || []).length ? "“" + j.bad.join("”“") + "”；" : ""}${j.why || ""}`; }
        else if (j) { warn = j.ok === false; line = j.ok === null ? j.note : (j.ok ? "AI 审核：产品没被改" : "AI 审核：产品可能被改了——") + (j.why ? (j.ok ? "（" + j.why + "）" : j.why) : ""); }
        if (it.placement === "ref") line = ["摆放照参考图", line].filter(Boolean).join("；");
        else if (it.placement === "same") line = ["摆放和产品图一样", line].filter(Boolean).join("；");
      }
      else if (c && c.stale) line = "产品改过了，显示原贴图；点“重新融入”";
      else if (has) line = (hm.on ? "AI 图" : "原贴图") + (ST.harmText(hm) ? "；" + ST.harmText(hm) : "");
      else if (it.bg) line = "原贴图（没有融入）";
    }
    // 哪个 AI 画的（Lee 2026-10-26：好对比）
    const aiTag = whoDrew(it);
    return `<div class="mcard" data-iid="${it.id}">
      <div class="pic" data-act="view">${url ? `<img src="${url}" alt="">` : ""}${st ? `<span class="st tag ${/失败/.test(st) ? "bad" : "blue"}">${esc(st)}</span>` : ""}</div>
      <div class="row"><b>${esc(it.styleName)}${poster ? ' <span class="muted">文字版</span>' : scene ? ' <span class="muted">AI 直接画</span>' : ""}</b>${aiTag ? `<span class="tag aisite" title="哪个 AI 画的">${esc(aiTag)}</span>` : ""}${it.doneAt || it.t ? `<span class="tag mtime" title="${it.doneAt ? "画好的时间" : "开始画的时间"}（北京时间）">${it.doneAt ? "" : "提交 "}${ST.bj(it.doneAt || it.t, true)}</span>` : ""}${has ? `<span class="sp pills"><span class="pill ${hm.on ? "on" : ""}" data-act="harmView" data-v="1">AI 图</span><span class="pill ${hm.on ? "" : "on"}" data-act="harmView" data-v="0">原贴图</span></span>` : ""}</div>
      ${line ? `<div class="muted ${warn ? "warntext" : ""}">${esc(line)}</div>` : ""}
      <div class="acts">
        <button class="sm" data-act="dlOne" ${ready ? "" : "disabled"}>下载</button>
        <button class="sm" data-act="judge" ${ready && !busy && (scene || hm.key) ? "" : "disabled"} title="让审核 AI（默认豆包）看一眼：${poster ? "读出图上的字，查违禁词、过度承诺、错字" : scene ? "产品有没有被改" : "原贴图和 AI 图哪张好"}">AI 审核</button>
        ${it.state === "ok" ? `<button class="sm" data-act="unaccept">取消采用</button>` : `<button class="sm primary" data-act="accept" ${ready && !busy ? "" : "disabled"}>采用</button>`}
        ${poster ? "" : `<button class="sm" data-act="placeRef" ${ready ? "" : "disabled"} title="以后用“AI 直接画场景”时，产品都照这张的摆法放">用这个摆放</button>`}
        ${scene ? "" : `<button class="sm" data-act="adjust" ${ready && !busy ? "" : "disabled"}>调整产品</button>
        <button class="sm" data-act="reblend" ${ready && !busy ? "" : "disabled"}>${hm.key ? "重新融入" : "融入背景"}</button>`}
        <button class="sm" data-act="redraw" ${busy ? "disabled" : ""}>${/失败/.test(st) ? "重试" : scene ? "重画" : "重画背景"}</button>
        <button class="sm danger" data-act="delItem">不要</button></div></div>`;
  }

  let rendering = false, renderAgain = false;
  // 拼音输入法正在选字的时候不重画、不保存（Lee 2026-10-26：打“zhongshi”按 2 选字，输入框里变成 zhongshi2）
  let composing = false, renderLater = false;
  document.addEventListener("compositionstart", () => { composing = true; });
  document.addEventListener("compositionend", (e) => {
    composing = false;
    e.target.dispatchEvent(new Event("input", { bubbles: true })); // 选好的字现在才保存
    if (renderLater) { renderLater = false; setTimeout(render, 0); }
  });
  async function render() {
    if (!P()) return;
    if (composing) { renderLater = true; return; }
    if (dragHold) { dragLater = true; return; }
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
      return `<div class="mcard ${pr.id === (curProduct() || {}).id ? "cur" : ""}" data-prid="${pr.id}"><div class="pic ${pr.cut || isPngKey(pr) ? "checker dark" : ""}" data-act="viewProduct" title="点一下看大图"><img src="${await ST.urlOf(pr.cut || pr.key)}" alt="">
        ${st ? `<span class="st tag ${/失败/.test(st) ? "bad" : "blue"}">${esc(st)}</span>` : pr.cut ? '<span class="st tag ok">已抠图</span>' : `<span class="st tag">原图 ${fmtOf(pr)}</span>`}</div>
        <div class="acts"><button class="sm" data-act="useProduct">${pr.id === (curProduct() || {}).id ? "正在用" : "用这张"}</button>
        ${!pr.cut && pr.edgeWhite ? `<button class="sm" data-act="cutDirect" ${st && !/失败/.test(st) ? "disabled" : ""} title="白底图：直接去掉白色背景，变成透明 PNG（“画背景 + 融入”要用；“AI 直接画”不用）">去白底</button>` : ""}
        ${!pr.cut || pr.white ? `<button class="sm" data-act="cutAi" ${st && !/失败/.test(st) ? "disabled" : ""}>AI 抠图</button>` : ""}
        ${pr.cut ? '<button class="sm" data-act="peProduct" title="钢笔选区删除、一键去白边，另存一张新产品图">去白边</button>' : ""}
        <button class="sm danger" data-act="delProduct">删除</button></div>
        ${pr.cut && pr.cut !== pr.key ? `<label class="row lb" title="手腕绳、提手这种围成圈的地方，中间的白色也抠掉"><input type="checkbox" data-holes ${pr.holes ? "checked" : ""} ${st && !/失败/.test(st) ? "disabled" : ""}> 镂空的白色也抠掉</label>` : ""}</div>`;
    }));
    const sel = new Set(p.styles || []);
    const myPills = await Promise.all(myStyles.map(async (s) => `<span class="stypill ${sel.has("my:" + s.id) ? "on" : ""}" data-sty="my:${s.id}" title="${esc(s.desc || s.prompt)}">${s.ref ? `<img src="${await ST.urlOf(s.ref)}" alt="">` : ""}${esc(s.name)}<span class="x" data-act="delStyle" data-sid="${s.id}" title="删除这个风格">✕</span></span>`));
    const poster = p.mode === "poster";
    const plansOn = (p.plans || []).filter((x) => x.on !== false);
    const freeMode = poster && p.posterKind === "free";
    const n = freeMode ? Math.min(6, p.freeCount || 3) : poster ? plansOn.length * Math.min(3, p.perPlan || 1) : chosenStyles(p).length * (p.count || 1);
    const canGo = freeMode ? String(p.posterContent || "").trim() || (p.posterRefs || []).length : poster ? plansOn.length && !/中$/.test(p.planJob || "") : n && curProduct();
    // 文字版主图（Lee 2026-10-27）：① 参考图（可选）② 写方案（AI 写、人改）③ 按方案出图
    const refCells = poster ? await Promise.all((p.posterRefs || []).map(async (r) => `<div class="mcard pref" data-pkey="${esc(r.key)}"><div class="pic" data-act="viewPosterRef"><img src="${await ST.urlOf(r.key)}" alt=""></div><div class="row"><span class="muted pname" title="${esc(r.name)}">${esc(r.name)}</span><button class="sm danger" data-act="delPosterRef">删除</button></div></div>`)) : [];
    const content = p.posterContent != null ? p.posterContent : [p.industry, p.posterNote].filter(Boolean).join("；");
    const kind = p.posterKind === "free" ? "free" : "box", pick = (p.boxPick || []).filter((id) => boxTpl(id));
    const plansHtml = (p.plans || []).length ? `<div class="plans">${p.plans.map((pl, i) => (pl.boxes ? boxPlanCard(pl, i, p) : pl.tpl ? planTplCard(pl, i, p) : planCard(pl, i, p))).join("")}</div>` : "";
    const posterHtml = poster ? `
      <div class="card"><div class="head"><div><h3>① 内容和做法</h3><div class="muted">“模板”：选几个照参考图画的线框模板，AI 往框里写字，你改字、挪框，先看草图再出图，最好控制。“AI 根据参考图”：放几张你喜欢的主图，AI 自由发挥。</div></div></div>
        <div class="lb">要表达的内容（卖什么、卖点、服务、售后……）</div>
        <textarea id="posterContent" rows="2" placeholder="如：远程安装 MySQL，5.x～8.x 任意版本，Win / Linux / Mac，赠送可视化工具，一对一远程，安装不成功全额退款">${esc(content)}</textarea>
        <label class="row lb" style="margin-top:8px">禁止出现的词（逗号隔开） <input id="posterBan" value="${esc(p.posterBan || "")}" placeholder="如：秒装, 包售后, 某某品牌" style="flex:1"></label>
        <div class="muted warntext" id="banConflict" ${banConflict(p).length ? "" : "hidden"}>注意：禁止词里的“${esc(banConflict(p).join("”“"))}”在“要表达的内容”里也有——AI 写方案时会避开它，可能写出意思不对的话（比如不让写“退款”，就写成“不成功也收费”）。</div>
        <div class="muted" style="margin-top:4px">广告法违禁词和虚假承诺（${ST.BAN_WORDS.slice(0, 8).join("、")}……）默认就禁，不用填；“安装不成功全额退款”这种真实的售后承诺可以写。</div>
        <div class="row" style="margin-top:12px;gap:8px"><span class="lb">做法</span><span class="pills"><span class="pill ${kind === "box" ? "on" : ""}" data-pkind="box">模板</span><span class="pill ${kind === "free" ? "on" : ""}" data-pkind="free">AI 根据参考图（自由发挥）</span></span></div></div>
      ${kind === "free" ? `
      <div class="card"><div class="head"><div><h3>② 参考图</h3><div class="muted">放 1～3 张你觉得好的主图，AI 照它的风格、排版和文案密度，写你的内容。别家的店名、品牌、价格不会照抄。</div></div>
        <div class="sp"><button data-act="posterFromLib">从素材中心选</button><button data-act="posterUpload">上传参考图</button></div></div>
        ${refCells.length ? `<div class="mcards">${refCells.join("")}</div>` : '<div class="empty">还没有参考图。点右上角“上传参考图”或“从素材中心选”，也可以拖进来、Ctrl+V。</div>'}
        <div class="row" style="margin-top:10px;gap:10px;flex-wrap:wrap">
          <label class="row lb"><input type="checkbox" id="freeRefs" ${p.freeRefs !== false ? "checked" : ""}> 发送参考图（出图时把上面的图发给 AI 参考）</label>
          <label class="row lb">想要的风格 <select id="freeStyle"><option value="">按参考图的风格</option>${ST.POSTER_TPLS.map((t) => `<option value="${t.id}" ${p.freeStyle === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}<option value="custom" ${p.freeStyle === "custom" ? "selected" : ""}>自己写</option></select></label>
          ${p.freeStyle === "custom" ? `<input id="freeStyleText" value="${esc(p.freeStyleText || "")}" placeholder="如：红白色块、信息密集、粗黑体、底部通栏承诺" style="flex:1;min-width:280px">` : ""}
          <label class="row lb">一共 <select id="freeCount">${[1, 2, 3, 4, 5, 6].map((k) => `<option ${(p.freeCount || 3) === k ? "selected" : ""}>${k}</option>`).join("")}</select> 张（每张一个重点：${ST.POSTER_THEMES.map((t) => t.name).join(" / ")}）</label></div></div>` : `
      <div class="card"><div class="head"><div><h3>② 选模板</h3><div class="muted">每个模板是照一张参考图画的线框（方框是字，打叉的是图标，虚线是色块）。鼠标移到模板上看它的参考图，右键可以编辑模板（删框、挪位置）。点一下选上，可以选几个，按选的顺序一张一套方案；同一个模板点“＋”可以多选几次。</div></div>
        <div class="sp row"><label class="row lb">看图用 <select id="learnSite">${LEARN_SITES.map(([v, t]) => `<option value="${v}" ${v === learnSite ? "selected" : ""}>${t}</option>`).join("")}</select></label><button data-act="learnFromLib">从素材中心选图生成模板</button><button data-act="learnUpload" title="上传一张你喜欢的主图，AI 把它的版式拆成框，存成“我的模板”（名字接着 ${esc(ST.nextBaseName(allBoxTpls().map((t) => t.id)))} 往下排）">上传参考图生成模板</button></div></div>
        ${p.learnJob ? `<div class="row" style="margin-bottom:8px"><span class="tag ${/失败/.test(p.learnJob) ? "bad" : "blue"}">${esc(p.learnJob)}</span></div>` : ""}
        <div class="tplgrid boxgrid">${allBoxTpls().map((t) => { const n = pick.filter((x) => x === t.id).length; return `<div class="tplc boxc ${n ? "on" : ""}" data-btpl="${esc(t.id)}" title="右键编辑这个模板" data-refhover="${esc(refUrl(t))}" data-refname="模板 ${esc(t.id)} 的参考图">
          <canvas class="wire" data-wire="${esc(t.id)}" width="300" height="300"></canvas><div class="tn"><b>${esc(t.id)}</b> ${esc(t.name || "")}${t.edited ? ' <span class="tag">改过</span>' : t.builtin ? "" : ` <span class="tag">${t.parent ? "另存" : "我的"}</span>`}</div><div class="muted tu">${esc(t.use || "")}</div>
          ${n ? `<span class="tcount">${pick.map((x, k) => (x === t.id ? k + 1 : 0)).filter(Boolean).join("、")}</span>` : ""}<button class="sm tplus" data-act="btplMore" title="这个模板再多选一套">＋</button>${t.builtin ? "" : '<button class="sm tdel" data-act="btplDel" title="删除这个模板">✕</button>'}</div>`; }).join("")}</div>
        <div class="row" style="margin-top:10px;gap:10px;flex-wrap:wrap">
          <span class="muted">已选 ${pick.length} 套${pick.length ? "：" + pick.join(" → ") : ""}</span>${pick.length ? '<button class="sm" data-act="btplClear">清空</button>' : ""}
          <label class="row lb">写方案用 <select id="planSite">${PLAN_SITES.map(([v, t]) => `<option value="${v}" ${v === planSite ? "selected" : ""}>${t}</option>`).join("")}</select></label>
          <button class="primary" data-act="writeBoxPlans" ${/中$/.test(p.planJob || "") || !pick.length ? "disabled" : ""}>AI 往框里写字（${pick.length} 套）</button>
          ${p.planJob ? `<span class="tag ${/失败/.test(p.planJob) ? "bad" : "blue"}">${esc(p.planJob)}</span>` : ""}</div></div>
      <div class="card"><div class="head"><div><h3>③ 方案（改字、挪框）</h3><div class="muted">左边是草图：拖框换位置，拖右下角的蓝色小方块改大小，点框在右边改字和样式；也可以加框、删框。改好了可以“存为我的模板”（叫 A-1、A-2…）。出图时把草图和模板的参考图一起发给 AI：草图定字和位置，参考图定风格。</div></div></div>
        ${plansHtml || '<div class="empty">还没有方案。填好“要表达的内容”，选模板，点“AI 往框里写字”。</div>'}</div>`}` : "";
    const placeUrl = p.placeRef ? await ST.urlOf(p.placeRef) : "";
    const pend = p.items.filter((x) => x.state !== "ok"), done = p.items.filter((x) => x.state === "ok");
    const html = `
      ${poster ? posterHtml : `<div class="card"><div class="head"><div><h3>① 产品图</h3><div class="muted">产品图保留原来的格式，不自动抠图。“AI 直接画场景”直接用原图（白底图最好）；“画背景 + 融入”要抠好的图：白底图点“去白底”，不是白底的点“AI 抠图”。抠好的图放在深色格子上，有没有白边一眼能看出来；手腕绳、提手围成的圈里有白色，勾“镂空的白色也抠掉”。</div></div>
        <div class="sp"><button data-act="fromLib">从素材中心选</button><button data-act="addProducts">上传产品图</button></div></div>
        <label class="row lb" style="margin-bottom:10px">产品名称（可以不填，告诉 AI 这是什么）<input id="pName" value="${esc((p.info && p.info.name) || "")}" placeholder="如：男士保温杯" style="width:240px"></label>
        ${prods.length ? `<div class="mcards">${prods.join("")}</div>` : '<div class="empty" id="dropZone">把白底图拖到这里、按 Ctrl+V 粘贴，或者点“上传产品图”“从素材中心选”</div>'}</div>
      <div class="card"><div class="head"><div><h3>② 背景风格</h3><div class="muted">可以多选，每种风格各画几张。</div></div>
        <div class="sp"><button data-act="learnStyle" title="上传一张你喜欢的主图或场景图，AI 识别它的背景风格，存起来以后都能用">上传图片识别风格</button></div></div>
        <div class="lb">预设</div><div class="stypills">${ST.MAIN_STYLES.map((s) => `<span class="stypill noimg ${sel.has(s.id) ? "on" : ""}" data-sty="${s.id}" title="${esc(s.prompt)}">${esc(s.name)}</span>`).join("")}</div>
        <div class="lb" style="margin-top:10px">我的风格</div><div class="stypills">${myPills.join("") || '<span class="muted">还没有。点右上角“上传图片识别风格”。</span>'}</div>
        <label class="row lb" style="margin-top:10px"><input type="checkbox" id="customOn" ${p.customOn ? "checked" : ""}> 自己写</label>
        <textarea id="custom" rows="2" placeholder="中文或英文都行，如：浅灰色水泥台面，旁边有一盆绿植，早晨的阳光" ${p.customOn ? "" : "hidden"}>${esc(p.custom || "")}</textarea></div>`}
      <div class="card"><h3>${poster ? "④" : "③"} 生成</h3><div class="mrow">
        ${poster ? "" : `<span class="lb">做法</span><span class="pills">${REAL_MODES.map(([v, t, tip]) => `<span class="pill ${modeOf(p) === v ? "on" : ""}" data-mode="${v}" title="${esc(tip)}">${t}</span>`).join("")}</span>`}
        <span class="lb">尺寸</span><span class="pills">${SIZES.map((s) => `<span class="pill ${p.size === s ? "on" : ""}" data-size="${s}">${s}×${s}</span>`).join("")}</span>
        ${modeOf(p) === "scene" ? `<span class="lb">摆放</span><span class="pills">${PLACES.map(([v, t, tip]) => `<span class="pill ${(p.placement || "free") === v ? "on" : ""}" data-place="${v}" title="${esc(tip)}">${t}</span>`).join("")}${p.placeRef ? `<span class="pill ${p.placement === "ref" ? "on" : ""}" data-place="ref" title="照这张图里的摆法"><img src="${esc(placeUrl)}" class="placeimg" alt="">照“${esc(p.placeRefName || "")}”那张摆<span class="x" data-act="clearPlace" title="不用这张了">✕</span></span>` : ""}</span>` : ""}
        ${poster && !freeMode && (p.posterRefs || []).length && (p.plans || []).some((x) => x.tpl && !x.boxes) ? `<label class="row lb" title="默认不发：参考图的版式和版式模板不一样，会打架，还会带出参考图上的字。勾上也只让 AI 学配色和质感"><input type="checkbox" id="tplRefs" ${p.tplRefs ? "checked" : ""}> 出图时也参考参考图的风格</label>` : ""}
        ${freeMode ? "" : poster ? `<label class="row lb">每套方案出 <select id="perPlan">${[1, 2, 3].map((k) => `<option ${(p.perPlan || 1) === k ? "selected" : ""}>${k}</option>`).join("")}</select> 张</label>
        ${(p.plans || []).some((x) => !x.tpl) ? `<label class="row lb" title="程序按方案画一张平面草图（字、位置、大小、颜色都准，但没有质感和图标），一起发给 AI，让它照草图排版"><input type="checkbox" id="sketch" ${p.sketch ? "checked" : ""}> 附上草图（让 AI 照草图排版）</label>` : ""}` : `<label class="row lb">每种风格 <select id="count">${[1, 2, 3, 4, 5, 6].map((k) => `<option ${(p.count || 1) === k ? "selected" : ""}>${k}</option>`).join("")}</select> 张</label>`}
        ${p.mode !== "paste" ? "" : `<label class="row lb">产品大小 <input type="range" id="scale" min="40" max="95" value="${Math.round((p.scale || 0.85) * 100)}"><span id="scaleV">${Math.round((p.scale || 0.85) * 100)}%</span></label>
        <label class="row lb"><input type="checkbox" id="blend" ${p.blend !== false ? "checked" : ""}> 融入背景（AI 只调光影）</label>`}
        <label class="row lb">审核用 <select id="judgeSite">${JUDGE_SITES.map(([v, t]) => `<option value="${v}" ${v === judgeSite ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <label class="row lb">${poster ? "出图用" : "用哪个 AI"} <select id="site">${SITES.map(([v, t]) => `<option value="${v}" ${v === site ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <button class="primary" data-act="generate" ${canGo ? "" : "disabled"}>生成 ${n} 张</button></div>
        <div class="note" style="margin-top:10px">${poster ? (freeMode ? "AI 根据参考图：按“要表达的内容”和选的风格自由发挥，勾了“发送参考图”就把参考图一起发过去。" : "模板：勾上的方案每套出几张，发给 AI 的是草图（字和位置）+ 模板的参考图（风格），字一字不差地照草图画。") + "AI 画字偶尔会错，点图片下面的“AI 审核”，让审核 AI 读一遍图上的字。" : p.mode !== "paste" ? "AI 直接画：把抠好的产品图（铺白底）发给 AI，一步画出带产品的场景，最自然；产品可能被 AI 改一点，不放心就点图片下面的“AI 审核”。喜欢哪张的摆法，点那张的“用这个摆放”。" : "先画背景再融入：AI 画空背景 → 程序把抠好的 PNG 贴到中间 → AI 调光影融入，直接显示 AI 图（原贴图留着可以切换，想让 AI 判断哪张好点“AI 审核”）。"}
          在服务器上做，关掉网页也不停。${poster ? "" : "默认不加文字。"}</div></div>
      ${pend.length ? `<div class="card pendbox"><div class="head"><div><h3>待确认（${pend.length}）</h3><div class="muted">看过点“采用”；不满意可以调整产品、重新融入、重画背景，或者不要。</div></div></div>
        <div class="mcards">${(await Promise.all(pend.map(itemCard))).join("")}</div></div>` : ""}
      ${done.length ? `<div class="card"><div class="head"><div><h3>已采用（${done.length}）</h3><div class="muted">下载的是 ${p.size}×${p.size} 的 JPG；“下载全部”里另外带一张白底图。</div></div>
        <div class="sp"><button class="primary" data-act="dlAll">下载全部（zip）</button></div></div>
        <div class="mcards">${(await Promise.all(done.map(itemCard))).join("")}</div></div>` : ""}`;
    // 重画页面时别把正在打字的输入框弄丢（Lee 2026-10-26：“自己写”点进去就没了）：记下光标和内容，画完放回去
    const ae = document.activeElement;
    const keep = ae && ae.id && $("main").contains(ae) && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && !/^(checkbox|radio|file|range)$/.test(ae.type)
      ? { id: ae.id, value: ae.value, s: ae.selectionStart, e: ae.selectionEnd, top: ae.scrollTop } : null;
    $("main").innerHTML = html;
    drawCanvases();
    const el = keep && $(keep.id);
    if (el) {
      el.value = keep.value;
      el.hidden = false;
      el.focus();
      try { el.setSelectionRange(keep.s, keep.e); } catch {}
      el.scrollTop = keep.top;
    }
  }

  // ------------------------------------------------------------ 点击、输入
  const itemOf = (el) => P().items.find((x) => x.id === el.closest("[data-iid]").dataset.iid);
  const prodOf = (el) => P().products.find((x) => x.id === el.closest("[data-prid]").dataset.prid);
  const ACT = {
    home: () => { location.hash = ""; },
    newProj: async () => {
      let name = null, textMode = false;
      const ok = await APP.modal(`<input id="npName" style="width:100%" placeholder="如：钱包"><div class="muted" style="margin-top:6px">只填名字，会自动变成“主图-钱包10-24-1”（月-日-当天第几个项目），建好以后不能改。</div>
        <div class="lb" style="margin:10px 0 6px">做哪种主图（建好以后不能改）</div>
        <label class="row lb"><input type="radio" name="npKind" value="real" checked> 实物主图 <span class="muted">有产品照片：AI 直接画场景 / 先画背景再融入</span></label>
        <label class="row lb"><input type="radio" name="npKind" value="text"> 文字主图 <span class="muted">虚拟产品、服务：用模板（线框）或让 AI 照参考图自由发挥</span></label>
        <div class="mf"><button data-ret="">取消</button><button class="primary" data-ret="ok">新建</button></div>`, { title: "新建主图项目", onOpen: (m) => { const i = m.querySelector("#npName"); i.focus(); i.onkeydown = (e) => { if (e.key === "Enter") m.querySelector('[data-ret="ok"]').click(); }; }, check: (v, m) => { name = m.querySelector("#npName").value.trim(); textMode = !!m.querySelector('input[name="npKind"][value="text"]:checked'); } });
      if (ok !== "ok") return;
      const r = await fetch("/api/main", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, textMode }), credentials: "same-origin" });
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
    // 照参考图设计：参考图
    posterUpload: async () => addPosterRefs(await pick("image/*", true)),
    posterFromLib: async () => {
      const list = await LIB.pick({ title: "从素材中心选参考图（最多 3 张）" });
      if (!list || !list.length) return;
      addPosterRefs(await Promise.all(list.slice(0, 3).map(async (x) => new File([await LIB.blob(x.id)], x.name, { type: x.mime || "image/jpeg" }))));
    },
    delPosterRef: (el) => op({ op: "delPosterRef", key: el.closest("[data-pkey]").dataset.pkey }),
    viewPosterRef: async (el) => {
      const refs = P().posterRefs || [];
      VIEWER.open(await Promise.all(refs.map(async (r) => ({ src: await ST.urlOf(r.key), name: r.name, png: false, info: "参考图" }))), refs.findIndex((r) => r.key === el.closest("[data-pkey]").dataset.pkey));
    },
    useProduct: (el) => setFields({ cur: prodOf(el).id }),
    cutAi: (el) => op({ op: "cutAi", prid: prodOf(el).id }),
    cutDirect: (el) => op({ op: "cutDirect", prid: prodOf(el).id }),
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
    judge: (el) => op({ op: "judge", iid: itemOf(el).id, site: judgeSite }),
    // 文字主图：框模板
    btplMore: (el, e) => { e.stopPropagation(); const id = el.closest("[data-btpl]").dataset.btpl; setFields({ boxPick: [...(P().boxPick || []), id].slice(0, 6) }); render(); },
    btplClear: () => { setFields({ boxPick: [] }); render(); },
    btplDel: async (el, e) => {
      e.stopPropagation();
      const id = el.closest("[data-btpl]").dataset.btpl, t = myBoxTpls.find((x) => x.id === id);
      if (!t || !(await confirm(`删除“我的模板”里的 ${t.id}？（所有主图项目都不能再选它，已经写好的方案不受影响）`, "删除", true))) return;
      myBoxTpls = ((await ST.db.getMeta("posterBoxTpls", [])) || []).filter((x) => x.id !== id);
      await ST.db.setMeta("posterBoxTpls", myBoxTpls);
      await setFields({ boxPick: (P().boxPick || []).filter((x) => x !== id) });
      render();
    },
    learnUpload: async () => { const [f] = await pick("image/*", false); learnTpl(f); },
    learnFromLib: async () => {
      const list = await LIB.pick({ title: "从素材中心选一张参考图（生成模板）" });
      if (!list || !list.length) return;
      learnTpl(new File([await LIB.blob(list[0].id)], list[0].name, { type: list[0].mime || "image/jpeg" }));
    },
    writeBoxPlans: async () => {
      const p = P();
      if (Object.keys(setPend).length) { clearTimeout(setT); const f = setPend; setPend = {}; await op({ op: "set", fields: f }); }
      if (!String(p.posterContent || p.industry || "").trim()) return APP.toast("先写“要表达的内容”", true);
      const ids = (p.boxPick || []).filter((id) => boxTpl(id));
      if (!ids.length) return APP.toast("先选模板", true);
      if ((p.plans || []).length && !(await confirm("重新写会替换现在的方案（你改过的字和框也会没了），继续吗？", "重新写"))) return;
      op({ op: "writePlans", site: planSite, n: ids.length, boxTpls: ids });
    },
    boxAdd: (el) => {
      const pl = planOf(el), type = el.dataset.type;
      const n = Math.max(0, ...pl.boxes.map((b) => +String(b.id).slice(1) || 0)) + 1;
      const role = `${BOX_ROLE[type]} ${pl.boxes.filter((b) => b.type === type).length + 1}`;
      const b = { text: { type, role, x: 30, y: 45, w: 40, h: 8, color: "#111111", bg: "", bold: true, lines: 1, align: "center", text: "" }, icon: { type, role, x: 40, y: 40, w: 20, h: 20, desc: "" }, block: { type, role, x: 0, y: 84, w: 100, h: 16, bg: "#1d4ed8", radius: 0 }, line: { type, role, x: 10, y: 50, w: 80, h: 0.6, color: "#333333" } }[type];
      b.id = "b" + n;
      type === "block" ? pl.boxes.unshift(b) : pl.boxes.push(b); // 色块放最底下，不挡字
      bsel[pl.id] = b.id;
      saveBoxes(); render();
    },
    boxDup: (el) => {
      const pl = planOf(el), b = boxOf(pl);
      if (!b) return APP.toast("先点一个框选中它", true);
      const n = Math.max(0, ...pl.boxes.map((x) => +String(x.id).slice(1) || 0)) + 1;
      const c = { ...JSON.parse(JSON.stringify(b)), id: "b" + n, x: Math.min(100 - b.w, b.x + 3), y: Math.min(100 - b.h, b.y + 3) };
      pl.boxes.splice(pl.boxes.indexOf(b) + 1, 0, c);
      bsel[pl.id] = c.id;
      saveBoxes(); render();
    },
    boxDel: (el) => {
      const pl = planOf(el), b = boxOf(pl);
      if (!b) return APP.toast("先点一个框选中它", true);
      pl.boxes = pl.boxes.filter((x) => x !== b);
      bsel[pl.id] = "";
      saveBoxes(); render();
    },
    boxSketch: async (el) => {
      const pl = planOf(el);
      const c = await renderBoxSketch(pl, 1024);
      VIEWER.open([{ src: URL.createObjectURL(await ST.toBlob(c, "image/png")), name: `草图：${pl.theme}`, png: false, info: "程序画的草图：字、位置、大小、颜色都准。出图时发给 AI，再加上模板的参考图让它照着做成精致的成品" }, ...(refUrl(pl) ? [{ src: refUrl(pl), name: `模板 ${pl.tpl} 的参考图`, png: false, info: "出图时一起发给 AI，只学风格" }] : [])], 0);
    },
    boxSaveTpl: async (el) => {
      const pl = planOf(el);
      const mine = (await ST.db.getMeta("posterBoxTpls", [])) || [];
      const id = ST.nextDerivedName(pl.tpl, [...ST.BOX_TPLS.map((t) => t.id), ...mine.map((t) => t.id)]);
      const base = boxTpl(String(pl.tpl).split("-")[0]) || boxTpl(pl.tpl) || {};
      let use = null;
      const ok = await APP.modal(`<p>把方案 ${P().plans.indexOf(pl) + 1} 现在的框（位置、大小、样式，不含字）存成 <b>${esc(id)}</b>，以后所有文字主图项目都能选。</p>
        <label class="f">适合什么（可以不填）<input id="stUse" value="${esc(base.use || "")}"></label>
        <div class="mf"><button data-ret="">取消</button><button class="primary" data-ret="ok">存为 ${esc(id)}</button></div>`, { title: "存为我的模板", check: (v, m) => { use = m.querySelector("#stUse").value.trim().slice(0, 30); } });
      if (ok !== "ok") return;
      const boxes = JSON.parse(JSON.stringify(pl.boxes)).map((b) => { delete b.text; return b; });
      const t = { id, name: pl.tplName || base.name || "", use, style: pl.style || "", bg1: pl.bg1, bg2: pl.bg2, ref: pl.ref || "", refKey: pl.refKey || "", parent: pl.tpl, t: Date.now(), boxes };
      myBoxTpls = [...mine.filter((x) => x.id !== id), t];
      await ST.db.setMeta("posterBoxTpls", myBoxTpls);
      pl.tpl = id;
      await setFields({ plans: P().plans });
      APP.toast(`存好了：模板 ${id}`);
      render();
    },
    // 文字版方案
    writePlans: async () => {
      const p = P();
      if (Object.keys(setPend).length) { clearTimeout(setT); const f = setPend; setPend = {}; await op({ op: "set", fields: f }); }
      if (!String(p.posterContent || p.industry || "").trim() && !(p.posterRefs || []).length) return APP.toast("先写“要表达的内容”（或者放参考图）", true);
      if (!(p.tplPick || []).length) return APP.toast("先选版式", true);
      if ((p.plans || []).length && !(await confirm("重新写会替换现在的方案（你改过的也会没了），继续吗？", "重新写"))) return;
      op({ op: "writePlans", site: planSite, n: p.tplPick.length, tpls: p.tplPick });
    },
    tplMore: (el) => { const id = el.closest("[data-tpl]").dataset.tpl; setFields({ tplPick: [...(P().tplPick || []), id].slice(0, 6) }); render(); },
    tplClear: () => { setFields({ tplPick: [] }); render(); },
    viewTpl: (el) => {
      const t = ST.posterTpl(P().plans[+el.closest("[data-plan]").dataset.plan].tpl);
      VIEWER.open([{ src: `/main/tpl/${t.id}.png`, name: `版式 ${t.id} ${t.name}（示例）`, png: false, info: t.use }, { src: `/main/tpl/${t.id}-wire.png`, name: `版式 ${t.id} 线框图（发给出图 AI 看版式，上面的字只是格子名）`, png: false, info: "" }], 0);
    },
    planIcon: async (el) => {
      const pl = P().plans[+el.closest("[data-plan]").dataset.plan];
      const [f] = await pick("image/*", false);
      if (!f) return;
      const key = `${P().id}:planicon-${ST.uid("i")}`;
      await ST.saveImage(key, f);
      pl.iconKey = key;
      await setFields({ plans: P().plans }); render();
    },
    planIconDel: (el) => { const pl = P().plans[+el.closest("[data-plan]").dataset.plan]; delete pl.iconKey; setFields({ plans: P().plans }); render();
    },
    planSketch: async (el) => {
      const pl = P().plans[+el.closest("[data-plan]").dataset.plan];
      const c = await renderSketch(pl, 800);
      VIEWER.open([{ src: URL.createObjectURL(await ST.toBlob(c, "image/png")), name: `草图：${pl.theme}`, png: false, info: "程序按方案画的平面草图：字、位置、大小、颜色都准，没有质感和图标（那些由 AI 画）" }], 0);
    },
    planDel: async (el) => { const i = +el.closest("[data-plan]").dataset.plan; if (!(await confirm("删除这套方案？", "删除", true))) return; const plans = P().plans.filter((_, k) => k !== i); setFields({ plans }); render(); },
    planAddRow: (el) => { const pl = P().plans[+el.closest("[data-plan]").dataset.plan]; pl.blocks.push({ pos: "文字", text: "", font: "黑体", weight: "粗", size: 40, x: 50, y: 60, color: "#333333", effect: "", bg: "" }); setFields({ plans: P().plans }); render(); },
    planDelRow: (el) => { const pl = P().plans[+el.closest("[data-plan]").dataset.plan]; pl.blocks.splice(+el.closest("[data-row]").dataset.row, 1); setFields({ plans: P().plans }); render(); },
    placeRef: async (el) => { const p = await op({ op: "placeRef", iid: itemOf(el).id }); if (p) APP.toast("以后“AI 直接画场景”都照这张的摆法放（在“③ 生成 → 摆放”里可以改回去）"); },
    clearPlace: (el, e) => { e.stopPropagation(); op({ op: "placeRef", clear: true }); },
    // 看大图（滚轮缩放、拖动、← → 切换所有画好的主图）
    view: async (el) => {
      const it0 = itemOf(el);
      const ready = (it) => (it.mode === "scene" || it.mode === "poster" ? it.scene : it.bg);
      if (!ready(it0)) return;
      const list = P().items.filter(ready);
      const out = [];
      for (const it of list) {
        const c = await compose(it, 1000);
        out.push({ src: URL.createObjectURL(await ST.toBlob(c.canvas, "image/jpeg", 0.92)), name: `${it.styleName}（${it.mode === "poster" ? "文字版" : it.mode === "scene" ? "AI 直接画" : c.used ? "AI 图" : "原贴图"}）${whoDrew(it) ? " · " + whoDrew(it) : ""}`, png: false });
      }
      VIEWER.open(out, list.indexOf(it0));
    },
    // 去白边（lib/pngedit.js）：保存 = 换掉抠好的图；另存 = 新产品图，放在这张后面，也放进素材中心
    peProduct: async (el) => {
      const p = P(), pr = p.products.find((x) => x.id === el.closest("[data-prid]").dataset.prid);
      const r = await PNGEDIT.open({ src: await ST.urlOf(pr.cut), name: /\.png$/i.test(pr.name) ? pr.name : pr.name.replace(/\.[^.]+$/, "") + ".png" });
      if (!r) return;
      if (r.how === "save") {
        const key = `${p.id}:${pr.id}-cut-${Date.now()}`;
        await ST.saveImage(key, r.blob);
        await op({ op: "replaceCut", prid: pr.id, key });
        return APP.toast("去白边保存好了");
      }
      const id = ST.uid("pr");
      const key = `${p.id}:${id}-orig`;
      await ST.saveImage(key, r.blob);
      await op({ op: "addProduct", id, key, name: r.name, after: pr.id, libTag: "白底图", isCut: true });
      APP.toast("去白边的图另存好了（在这张后面，也放进了素材中心）");
    },
    viewProduct: async (el) => {
      const prs = P().products;
      const i = prs.findIndex((x) => x.id === el.closest("[data-prid]").dataset.prid);
      VIEWER.open(await Promise.all(prs.map(async (pr) => ({ src: await ST.urlOf(pr.cut || pr.key), name: pr.name, png: !!pr.cut || isPngKey(pr), info: `${pr.w}×${pr.h}${pr.cut ? " · 抠好的 PNG" : " · 原图 " + fmtOf(pr)}` }))), i);
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
        if (ST.mainProduct(p)) files.push({ name: "白底图.jpg", blob: await ST.toBlob(await ST.mainWhite(p, p.size), "image/jpeg", 0.95) });
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
    const pk = e.target.closest("[data-pkind]");
    if (pk && P()) { setFields({ posterKind: pk.dataset.pkind }); render(); return; }
    const btc = e.target.closest("[data-btpl]");
    if (btc && P()) {
      const id = btc.dataset.btpl, list = [...(P().boxPick || [])], k = list.lastIndexOf(id);
      if (k >= 0) list.splice(k, 1); else list.push(id);
      setFields({ boxPick: list.slice(0, 6) }); render();
      return;
    }
    const brow = e.target.closest(".brow");
    if (brow && P()) { const i = +brow.closest("[data-plan]").dataset.plan, pl = P().plans[i]; if (bsel[pl.id] !== brow.dataset.bid) { bsel[pl.id] = brow.dataset.bid; selChanged(i); } return; }
    const tc = e.target.closest("[data-tpl]");
    if (tc && P()) {
      // 点一下：没选就加上，选了就去掉（加几次的去掉最后一次）
      const id = tc.dataset.tpl, list = [...(P().tplPick || [])], k = list.lastIndexOf(id);
      if (k >= 0) list.splice(k, 1); else list.push(id);
      setFields({ tplPick: list.slice(0, 6) }); render();
      return;
    }
    const md = e.target.closest("[data-mode]");
    if (md && P()) { setFields({ mode: md.dataset.mode }); return; }
    const open = e.target.closest("[data-open]");
    if (open) location.hash = "#p=" + open.dataset.open;
  });
  document.addEventListener("input", (e) => {
    const p = P();
    if (!p || e.isComposing || composing) return;
    const t = e.target;
    if (t.id === "projName") { if (!p.fixedName) setSoon({ name: t.value }); }
    else if (t.id === "pName") setSoon({ info: { ...(p.info || {}), name: t.value } });
    else if (t.id === "custom") setSoon({ custom: t.value });
    else if (t.id === "posterContent") { setSoon({ posterContent: t.value }); banRefresh(); }
    else if (t.id === "freeStyleText") setSoon({ freeStyleText: t.value });
    else if (t.id === "posterBan") { setSoon({ posterBan: t.value }); banRefresh(); }
    else if (t.dataset.bx && t.tagName !== "SELECT" && t.type !== "checkbox") bxEdit(t);
    else if (t.dataset.bp) { const [i, k] = t.dataset.bp.split("|"); P().plans[+i][k] = t.value; drawEditor(+i); saveBoxes(); }
    else if (t.dataset.pf && t.tagName !== "SELECT" && t.type !== "checkbox") planEdit(t);
    else if (t.id === "scale") { $("scaleV").textContent = t.value + "%"; setSoon({ scale: +t.value / 100 }); }
  });
  document.addEventListener("change", (e) => {
    const p = P();
    if (!p) return;
    const t = e.target;
    if (t.id === "customOn") setFields({ customOn: t.checked });
    else if (t.id === "count") setFields({ count: +t.value });
    else if (t.id === "perPlan") setFields({ perPlan: +t.value });
    else if (t.id === "freeStyle") { setFields({ freeStyle: t.value }); render(); }
    else if (t.id === "freeCount") setFields({ freeCount: +t.value });
    else if (t.id === "tplRefs") setFields({ tplRefs: t.checked });
    else if (t.id === "sketch") setFields({ sketch: t.checked });
    else if (t.id === "planSite") { planSite = t.value; ls.set("st:planSite", planSite); render(); }
    else if (t.id === "planCount") { planCount = +t.value; ls.set("st:planCount", String(planCount)); }
    else if (t.id === "judgeSite") { judgeSite = t.value; ls.set("st:judgeSite", judgeSite); }
    else if (t.dataset.bx) { if (t.tagName === "SELECT" || t.type === "checkbox") bxEdit(t); }
    else if (t.dataset.bp) {}
    else if (t.id === "learnSite") { learnSite = t.value; ls.set("st:learnSite", learnSite); }
    else if (t.id === "freeRefs") setFields({ freeRefs: t.checked });
    else if (t.dataset.pf) planEdit(t);
    else if (t.id === "blend") setFields({ blend: t.checked });
    else if (t.dataset.holes !== undefined) op({ op: "holes", prid: prodOf(t).id, holes: t.checked });
    else if (t.id === "site") { site = t.value; ls.set("st:mainSite", site); }
  });
  document.addEventListener("dragover", (e) => { if (P()) e.preventDefault(); });
  const dropFiles = (fl) => {
    if (!fl.length) return;
    if (P().mode !== "poster") return addProducts(fl);
    if (P().posterKind === "free") return addPosterRefs(fl);
    APP.toast("模板做法不用放参考图；想用这张图做新模板，点“上传参考图生成模板”", true);
  };
  document.addEventListener("drop", (e) => { if (!P()) return; e.preventDefault(); dropFiles([...e.dataTransfer.files]); });
  document.addEventListener("paste", (e) => {
    if (!P() || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const fl = [...((e.clipboardData && e.clipboardData.files) || [])];
    dropFiles(fl);
  });

  // 服务器推送：项目变了（后台做完一步）就取最新的
  let pullT = null;
  const pull = async () => {
    const p = P();
    if (!p) return;
    const q = await ST.db.getProject(p.id).catch(() => null);
    if (!q || !P() || P().id !== q.id) return;
    if (q.mode === "poster") myBoxTpls = (await ST.db.getMeta("posterBoxTpls", []).catch(() => null)) || myBoxTpls;
    if (q.learnDone && q.learnDone !== p.learnDone) APP.toast(`模板 ${q.learnDone} 生成好了，已经选上（鼠标移上去看参考图）`);
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
