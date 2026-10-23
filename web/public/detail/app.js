/**
 * 详情页（网页版）· 主程序：状态、顶部导航、我的项目、设置（平台 / 违禁词 / 品牌）、弹窗、保存、撤销。
 * 项目和图片存在工作台服务器上；AI 任务交给服务器排队（ai.js）；“一键全自动”在服务器上做（auto.js 是它的页面）。
 * 每一步的页面在 steps.js（①～⑤）、editor.js（⑥）、finish.js（⑦ 和批量）。
 */
var APP = (globalThis.APP = {
  project: null,
  step: "home",
  settings: null,
  brands: [],
  mytpls: [],
  steps: {}, // 每一步：{ render(), act: { 名字: (el, e) => {} } }
  undo: [],
  redo: [],
});

(() => {
  const $ = (id) => document.getElementById(id);
  const esc = ST.esc;
  APP.$ = $;

  // ------------------------------------------------------------ 提示、弹窗
  APP.toast = (msg, bad) => {
    const t = $("toast");
    t.textContent = msg;
    t.className = bad ? "bad" : "";
    t.hidden = false;
    clearTimeout(APP.toast.t);
    APP.toast.t = setTimeout(() => (t.hidden = true), bad ? 6000 : 2800);
  };
  /** 弹窗：html 是内容；返回一个 Promise，点了带 data-ret 的按钮就结束，值是 data-ret（关闭为 null） */
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
  APP.confirm = async (msg, yes = "确定", danger) => (await APP.modal(`<p>${esc(msg)}</p><div class="mf"><button data-ret="">取消</button><button class="${danger ? "danger" : "primary"}" data-ret="yes">${esc(yes)}</button></div>`, { title: "请确认" })) === "yes";
  APP.ask = async (title, def = "", placeholder = "") => {
    let val = null;
    const r = await APP.modal(`<input id="askInput" style="width:100%" value="${esc(def)}" placeholder="${esc(placeholder)}"><div class="mf"><button data-ret="">取消</button><button class="primary" data-ret="ok">确定</button></div>`, {
      title, onOpen: (m) => { const i = m.querySelector("#askInput"); i.focus(); i.select(); i.onkeydown = (e) => { if (e.key === "Enter") m.querySelector('[data-ret="ok"]').click(); }; },
      check: (v, m) => { val = m.querySelector("#askInput").value.trim(); },
    });
    return r === "ok" ? val : null;
  };

  // ------------------------------------------------------------ 设置
  const DEF_SETTINGS = { site: "gemini", gapMin: 8, gapMax: 20, newChat: true, retries: 1, model: "", custom: "", platformOverrides: {}, lastProject: "" };
  APP.loadSettings = async () => {
    APP.settings = { ...DEF_SETTINGS, ...(await ST.db.getMeta("settings", {})) };
    APP.brands = await ST.db.getMeta("brands", []);
    APP.mytpls = await ST.db.getMeta("mytpls", []);
    ST.platformOverrides = APP.settings.platformOverrides || {};
    ST.AI.configure({ site: APP.settings.site, gapMin: APP.settings.gapMin, gapMax: APP.settings.gapMax, newChat: APP.settings.newChat, retries: APP.settings.retries, model: APP.settings.model });
  };
  APP.saveSettings = async () => {
    await ST.db.setMeta("settings", APP.settings);
    ST.platformOverrides = APP.settings.platformOverrides || {};
    ST.AI.configure({ site: APP.settings.site, gapMin: APP.settings.gapMin, gapMax: APP.settings.gapMax, newChat: APP.settings.newChat, retries: APP.settings.retries, model: APP.settings.model });
  };
  APP.customWords = () => String(APP.settings.custom || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
  APP.brandOf = (p = APP.project) => {
    const b = p && p.brandId ? APP.brands.find((x) => x.id === p.brandId) : null;
    return b ? { primary: b.primary, accent: b.accent, text: b.text, font: b.font, logo: b.logo || "" } : null;
  };

  // ------------------------------------------------------------ 项目
  APP.newProject = (o = {}) => ({
    id: ST.uid("p"), name: o.name || `新项目 ${ST.bj().slice(5)}`, created: Date.now(), updated: Date.now(),
    platform: "taobao-m", platforms: ["taobao-m"], lang: "zh-CN", langs: [], tone: "minimal", brandId: "", units: "auto",
    assets: [], info: { name: "", category: "", brand: "", material: "", size: "", weight: "", colors: "", package: "", audience: "", scenes: "", extra: "", params: [], dims: { l: "", w: "", h: "", unit: "cm" }, tr: {} },
    points: [], reviews: { raw: "", concerns: [] }, ref: null, screens: [], style: { styleRef: "" },
  });
  let saveTimer = 0;
  APP.save = (now) => {
    if (!APP.project) return Promise.resolve();
    clearTimeout(saveTimer);
    const p = APP.project;
    const go = () => ST.db.putProject(p).catch(async (e) => {
      APP.toast("保存失败：" + e.message, true);
      if (e.conflict && APP.project && APP.project.id === p.id) { const q = await ST.db.getProject(p.id); if (q) { APP.project = q; APP.render(); } }
    });
    if (now) return go();
    saveTimer = setTimeout(go, 600);
    return Promise.resolve();
  };
  APP.open = async (id, step) => {
    const p = await ST.db.getProject(id);
    if (!p) { APP.toast("项目不存在了", true); return APP.go("home"); }
    APP.project = p;
    APP.undo = []; APP.redo = [];
    APP.settings.lastProject = id;
    APP.saveSettings();
    if (p.auto && (p.auto.status === "running" || p.auto.status === "exporting")) return APP.go("auto");
    APP.go(step || (p.auto && p.auto.status === "review" ? "auto" : p.screens.length ? "edit" : p.assets.length ? "info" : "assets"));
  };

  // ------------------------------------------------------------ 撤销 / 重做（编辑和提纲用）
  const snap = () => JSON.stringify({ screens: APP.project.screens, params: APP.project.info.params, tr: APP.project.info.tr, style: APP.project.style });
  let lastSnap = "";
  APP.mark = () => { if (APP.project) lastSnap = snap(); };
  /** 改之前调 APP.mark()，改完调 APP.commit() */
  APP.commit = () => {
    if (!APP.project) return;
    const now = snap();
    if (lastSnap && now !== lastSnap) {
      APP.undo.push(lastSnap);
      if (APP.undo.length > 60) APP.undo.shift();
      APP.redo = [];
    }
    lastSnap = now;
    APP.save();
  };
  const restore = (s) => {
    const d = JSON.parse(s);
    APP.project.screens = d.screens; APP.project.info.params = d.params; APP.project.info.tr = d.tr; APP.project.style = d.style;
    lastSnap = s;
    APP.save();
    APP.render();
  };
  APP.doUndo = () => { if (!APP.undo.length) return APP.toast("没有可以撤销的"); APP.redo.push(snap()); restore(APP.undo.pop()); };
  APP.doRedo = () => { if (!APP.redo.length) return APP.toast("没有可以重做的"); APP.undo.push(snap()); restore(APP.redo.pop()); };

  // ------------------------------------------------------------ 导航
  const STEPS = [["auto", "全自动"], ["setup", "新建项目"], ["assets", "素材"], ["info", "产品信息"], ["ref", "参考详情图"], ["outline", "提纲"], ["edit", "生成和编辑"], ["export", "检查和导出"]];
  APP.STEPS = STEPS;
  APP.go = (step) => {
    APP.step = step;
    try { localStorage.setItem("studioStep", step); } catch {}
    APP.render();
    window.scrollTo(0, 0);
  };
  APP.render = () => {
    const p = APP.project;
    $("steps").innerHTML = p && APP.step !== "home" ? STEPS.map(([id, name], i) => `<button data-go="${id}" class="${APP.step === id ? "on" : ""}"><b>${i ? "①②③④⑤⑥⑦"[i - 1] : "⚡"}</b>${name}</button>`).join("") : "";
    $("projName").hidden = !p || APP.step === "home";
    if (p && document.activeElement !== $("projName")) $("projName").value = p.name;
    const view = APP.steps[APP.step] || APP.steps.home;
    $("main").className = view.wide ? "wide" : "";
    view.render($("main"));
    document.title = p && APP.step !== "home" ? `${p.name} · 详情页` : "详情页 · AI图图 工作台";
  };
  $("projName").addEventListener("input", () => { if (APP.project) { APP.project.name = $("projName").value || "未命名"; APP.save(); } });
  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-go]");
    if (g && !g.closest("#modal")) { APP.go(g.dataset.go); return; }
    const a = e.target.closest("[data-act]");
    if (!a || a.closest("#modal")) return;
    const view = APP.steps[APP.step];
    const fn = (view && view.act && view.act[a.dataset.act]) || APP.globalAct[a.dataset.act];
    if (fn) { e.preventDefault(); Promise.resolve(fn(a, e)).catch((err) => { console.error(err); APP.toast(err.message || String(err), true); }); }
  });
  document.addEventListener("keydown", (e) => {
    if (!APP.project || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? APP.doRedo() : APP.doUndo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); APP.doRedo(); }
  });

  // ------------------------------------------------------------ AI 状态
  APP.renderAi = () => {
    const st = ST.AI.status;
    const chip = $("aiChip");
    const jobs = ST.AI.running;
    chip.className = "chip " + ({ busy: "busy", ok: "ok", warn: "warn", bad: "bad" }[st.kind] || "");
    chip.querySelector("span").textContent = jobs.length ? `AI 任务 ${jobs.length}` : st.kind === "bad" ? "AI 未连接" : "AI";
    chip.title = st.msg;
    const dock = $("aiDock");
    if (dock.hidden) return;
    const done = (APP.aiHistory || []).slice(-8).reverse();
    dock.innerHTML = `<div class="dh"><b>AI 任务</b><span class="muted">交给连上工作台的插件做</span>
      <span class="sp row"><button class="sm" data-act="aiFocus">AI 连接</button><button class="sm danger" data-act="aiStop" ${jobs.length ? "" : "disabled"}>全部停止</button><button class="sm ghost" data-act="aiDock">✕</button></span></div>
      <div class="db"><div class="note ${st.kind === "bad" || st.kind === "warn" ? "warn" : ""}">${esc(st.msg)}</div>
      ${jobs.map((j) => `<div class="job ${j.status}"><b>${j.status === "run" ? "进行中" : "排队"}</b> ${esc(j.label)}${j.steps.length ? `<pre>${esc(j.steps.slice(-4).join("\n"))}</pre>` : ""}</div>`).join("")}
      ${done.length ? '<div class="muted">最近完成</div>' + done.map((j) => `<div class="job ${j.status}">${j.status === "ok" ? "✓" : "✕"} ${esc(j.label)}${j.error ? `<pre>${esc(j.error)}</pre>` : ""}</div>`).join("") : ""}
      <div class="muted">所有任务（包括全自动的）在工作台的 <a href="/#/tasks" target="_blank">任务中心</a> 里看。</div></div>`;
  };
  APP.aiHistory = [];
  ST.AI.onChange(() => {
    APP.renderAi();
    if (APP.onAiChange) APP.onAiChange();
  });

  /** 调 AI 写文字并解析 JSON（失败抛错） */
  APP.aiJson = async (prompt, images, label, o = {}) => {
    const r = await ST.AI.run("text", prompt, images || [], { ...o, label });
    return ST.extractJson(r.text, r.codes);
  };
  APP.aiImage = async (prompt, images, label, o = {}) => {
    const r = await ST.AI.run("image", prompt, images || [], { ...o, label });
    return r.blob || ST.b64ToBlob(r.b64, r.mime || "image/png");
  };

  // ------------------------------------------------------------ 全局按钮
  APP.globalAct = {
    home: () => APP.go("home"),
    aiDock: () => { $("aiDock").hidden = !$("aiDock").hidden; APP.renderAi(); },
    aiStop: () => ST.AI.stop(),
    aiResume: () => ST.AI.resume(),
    aiFocus: () => ST.AI.focusAiWindow().catch((e) => APP.toast(e.message, true)),
    settings: () => APP.openSettings(),
  };

  // ------------------------------------------------------------ 设置弹窗
  APP.openSettings = async () => {
    const s = APP.settings;
    const html = `
      <div class="pills" id="setTabs"><span class="pill on" data-tab="pf">平台尺寸</span><span class="pill" data-tab="ban">违禁词</span><span class="pill" data-tab="brand">品牌</span></div>
      <div class="note" style="margin-top:10px">AI 用哪个网站、间隔多久，在工作台的 <a href="/#/connect" target="_blank">AI 连接</a> 里设置。</div>
      <div data-pane="pf" style="margin-top:14px">
        <div class="note warn">标“待核对”的尺寸是常用值，还没对照平台官方后台核对过。上传前请以平台要求为准，可以在这里改。</div>
        <div style="overflow-x:auto;margin-top:10px"><table class="ptbl"><thead><tr><th>平台</th><th>宽（像素）</th><th>固定高</th><th>切片最高</th><th>单张最大 KB</th><th></th></tr></thead><tbody>
        ${ST.PLATFORMS.map((p0) => { const p = ST.platformOf(null, p0.id); return `<tr data-pf="${p.id}"><td>${esc(p.name)} ${p.verify ? '<span class="tag warn">待核对</span>' : ""}</td><td><input type="number" data-k="w" value="${p.w}"></td><td><input type="number" data-k="h" value="${p.h || ""}" placeholder="长图"></td><td><input type="number" data-k="sliceH" value="${p.sliceH || ""}"></td><td><input type="number" data-k="maxKB" value="${p.maxKB || ""}"></td><td><button class="sm" data-reset="${p.id}">恢复默认</button></td></tr>`; }).join("")}
        </tbody></table></div>
      </div>
      <div data-pane="ban" hidden style="margin-top:14px">
        <div class="lb">自己加的违禁词（每行一个，所有语言都检查）</div>
        <textarea id="sCustom" rows="6" placeholder="例如：秒杀&#10;正品&#10;cheap"></textarea>
        <div class="lb" style="margin-top:10px">自带的词表（按平台自动选用）</div>
        ${Object.entries(ST.BANNED).map(([id, L]) => `<div class="note" style="margin-top:6px"><b>${esc(L.name)}</b>：${esc(L.words.map(([w]) => (w instanceof RegExp ? w.source.replace(/\\b|\\s\?|\(\?![^)]*\)|[()?|\\]/g, " ").replace(/\s+/g, " ").trim() : w)).slice(0, 40).join("、"))}</div>`).join("")}
      </div>
      <div data-pane="brand" hidden style="margin-top:14px"><div id="brandPane"></div></div>
      <div class="mf"><button data-ret="">取消</button><button class="primary" data-ret="save">保存</button></div>`;
    const r = await APP.modal(html, {
      title: "设置", big: true,
      onOpen: (m) => {
        m.querySelector("#sCustom").value = s.custom || "";
        m.querySelector("#setTabs").onclick = (e) => {
          const t = e.target.closest("[data-tab]");
          if (!t) return;
          m.querySelectorAll("#setTabs .pill").forEach((x) => x.classList.toggle("on", x === t));
          m.querySelectorAll("[data-pane]").forEach((x) => (x.hidden = x.dataset.pane !== t.dataset.tab));
        };
        m.addEventListener("click", (e) => {
          const b = e.target.closest("[data-reset]");
          if (!b) return;
          const base = ST.PLATFORMS.find((x) => x.id === b.dataset.reset);
          const tr = b.closest("tr");
          for (const k of ["w", "h", "sliceH", "maxKB"]) tr.querySelector(`[data-k="${k}"]`).value = base[k] || "";
        });
        APP.renderBrandPane(m.querySelector("#brandPane"));
      },
      check: (v, m) => {
        s.custom = m.querySelector("#sCustom").value;
        const ov = {};
        m.querySelectorAll("tr[data-pf]").forEach((tr) => {
          const base = ST.PLATFORMS.find((x) => x.id === tr.dataset.pf);
          const o = {};
          for (const k of ["w", "h", "sliceH", "maxKB"]) {
            const val = +tr.querySelector(`[data-k="${k}"]`).value || 0;
            if ((base[k] || 0) !== val) o[k] = val || undefined;
          }
          if (o.w !== undefined && o.w < 200) o.w = 200;
          if (Object.keys(o).length) ov[base.id] = o;
        });
        s.platformOverrides = ov;
      },
    });
    if (r === "save") { await APP.saveSettings(); APP.toast("设置已保存"); APP.render(); }
  };

  // ------------------------------------------------------------ 品牌
  APP.renderBrandPane = (box) => {
    const draw = async () => {
      const rows = await Promise.all(APP.brands.map(async (b) => `<div class="pitem" data-bid="${b.id}">
        <span style="width:64px;height:36px;display:inline-block;background:#fff center/contain no-repeat url('${b.logo ? await ST.urlOf(b.logo) : ""}');border:1px solid var(--line);border-radius:6px"></span>
        <input type="text" data-k="name" value="${esc(b.name)}" placeholder="品牌名" style="max-width:160px">
        <label class="lb">主色 <input type="color" data-k="primary" value="${b.primary || "#1f2329"}"></label>
        <label class="lb">强调色 <input type="color" data-k="accent" value="${b.accent || "#3b6fd8"}"></label>
        <label class="lb">文字色 <input type="color" data-k="text" value="${b.text || "#1f2329"}"></label>
        <select data-k="font"><option value="">标题字体跟风格</option><option value="sans">标题用黑体</option><option value="serif" ${b.font === "serif" ? "selected" : ""}>标题用宋体（高端）</option></select>
        <button class="sm" data-logo>换 logo</button><button class="sm danger" data-del>删除</button></div>`));
      box.innerHTML = `<div class="note">品牌设置存一次，所有项目都能选用：logo 会放在首屏左上角，主色、强调色用在按钮、图标和标签上。</div>
        <div class="plist" style="margin-top:10px">${rows.join("") || '<div class="muted">还没有品牌</div>'}</div>
        <div class="row" style="margin-top:8px"><button data-addbrand>＋ 添加品牌</button></div>
        <input type="file" accept="image/png,image/jpeg,image/webp" hidden id="logoInput">`;
      box.querySelectorAll("[data-k=font]").forEach((sel) => { const b = APP.brands.find((x) => x.id === sel.closest("[data-bid]").dataset.bid); sel.value = b.font || ""; });
    };
    const persist = () => ST.db.setMeta("brands", APP.brands);
    let logoFor = null;
    box.addEventListener("input", (e) => {
      const row = e.target.closest("[data-bid]");
      if (!row || !e.target.dataset.k) return;
      const b = APP.brands.find((x) => x.id === row.dataset.bid);
      b[e.target.dataset.k] = e.target.value;
      persist();
    });
    box.addEventListener("click", async (e) => {
      if (e.target.closest("[data-addbrand]")) { APP.brands.push({ id: ST.uid("b"), name: "我的品牌", primary: "#1f2329", accent: "#3b6fd8", text: "#1f2329", font: "", logo: "" }); await persist(); draw(); }
      const row = e.target.closest("[data-bid]");
      if (!row) return;
      const b = APP.brands.find((x) => x.id === row.dataset.bid);
      if (e.target.closest("[data-del]")) { if (await APP.confirmInline(e.target, "再点一次删除")) { APP.brands = APP.brands.filter((x) => x !== b); await persist(); draw(); } }
      if (e.target.closest("[data-logo]")) { logoFor = b; box.querySelector("#logoInput").click(); }
    });
    box.addEventListener("change", async (e) => {
      if (e.target.id !== "logoInput" || !logoFor) return;
      const f = e.target.files[0];
      e.target.value = "";
      if (!f) return;
      const key = `brand:${logoFor.id}:${Date.now()}`;
      await ST.saveImage(key, f);
      logoFor.logo = key;
      await persist();
      draw();
    });
    draw();
  };
  /** 危险操作：按钮上原地再点一次确认（弹窗里不能再弹窗） */
  APP.confirmInline = (btn, text) => new Promise((resolve) => {
    if (btn.dataset.armed) { delete btn.dataset.armed; resolve(true); return; }
    const old = btn.textContent;
    btn.dataset.armed = "1";
    btn.textContent = text;
    setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = old; } }, 3000);
    resolve(false);
  });

  // ------------------------------------------------------------ 选图弹窗
  /** 从素材里选一张；tags 优先显示的标签。返回素材 id、""（不放图）或 null（取消） */
  APP.pickAsset = async (current, tags = []) => {
    const p = APP.project;
    const list = [...p.assets].sort((a, b) => (tags.includes(b.tag) ? 1 : 0) - (tags.includes(a.tag) ? 1 : 0));
    const cells = await Promise.all(list.map(async (a) => `<button data-ret="${a.id}" class="${a.id === current ? "on" : ""}"><img src="${await ST.urlOf(a.cut || a.key)}" class="${a.cut ? "checker" : ""}"><span>素材${p.assets.indexOf(a) + 1} · ${esc(ST.tagName(a.tag))}${a.note ? " · " + esc(a.note) : ""}</span></button>`));
    const r = await APP.modal(`${list.length ? `<div class="pickgrid">${cells.join("")}</div>` : '<div class="empty">还没有素材，先到“② 素材”上传图片</div>'}<div class="mf"><button data-ret="none">不放图片</button><button data-ret="">取消</button></div>`, { title: "选择图片", big: true });
    if (r === null) return null;
    return r === "none" ? "" : r;
  };

  // ------------------------------------------------------------ 首页：我的项目
  APP.AUTO_NAMES = { running: "全自动进行中", exporting: "正在导出", review: "等你审核", approved: "已审核通过", failed: "全自动出错", stopped: "全自动已停止" };
  APP.steps.home = {
    async render(main) {
      const list = await ST.db.listProjects();
      APP.homeSel = new Set([...(APP.homeSel || [])].filter((id) => list.some((p) => p.id === id)));
      const cards = list.map((p) => {
        const thumb = p.thumb || p.firstAsset;
        const pf = ST.platformOf(p, p.platform);
        const a = p.auto;
        return `<div class="proj"><input type="checkbox" class="ck" data-sel="${p.id}" ${APP.homeSel.has(p.id) ? "checked" : ""}>
          <div class="thumb" data-act="openProj" data-id="${p.id}" style="background-image:url('${thumb ? ST.urlFor(thumb) : ""}')"></div>
          <div class="body"><b title="${esc(p.name)}">${esc(p.name)}</b>
          <span class="muted">${esc(pf.name)} · ${esc(ST.lang(p.lang).name)}${(p.langs || []).length ? ` +${p.langs.length} 种语言` : ""} · ${p.screens} 屏</span>
          <span class="muted">更新于 ${ST.bj(p.updated)}</span>
          ${a ? `<span><span class="astat ${a.status}">${esc(APP.AUTO_NAMES[a.status] || a.status)}</span> <span class="muted">${esc(a.status === "running" ? a.msg || "" : "")}</span></span>` : ""}</div>
          <div class="acts"><button class="sm primary" data-act="openProj" data-id="${p.id}">打开</button>
          ${a && (a.status === "running" || a.status === "exporting") ? `<button class="sm" data-act="stopAuto" data-id="${p.id}">停止全自动</button>` : `<button class="sm blue" data-act="startAuto" data-id="${p.id}" title="服务器上自动做完：识别素材、抠图、卖点、提纲、背景、翻译、检查，导出后等你审核">一键全自动</button>`}
          ${a && a.exportFile ? `<a class="sm btnlink" href="/api/projects/${p.id}/export">下载 zip</a>` : ""}
          <button class="sm" data-act="copyProj" data-id="${p.id}" title="排版、背景、风格都保留，换新产品的素材和文案">复制成新产品</button><button class="sm danger" data-act="delProj" data-id="${p.id}">删除</button></div></div>`;
      });
      const n = APP.homeSel.size;
      main.innerHTML = `
        <div class="head"><div><h1>我的项目</h1><div class="muted">项目存在这台工作台服务器上。“一键全自动”在服务器上做，关掉浏览器也不停，做完等你审核。</div></div>
          <div class="sp"><button data-act="openMyTpls">我的模板（${APP.mytpls.length}）</button><button data-act="newProj">＋ 手动新建</button><button class="primary" data-act="batchNew">⚡ 一键全自动新建（可以多个）</button></div></div>
        ${list.length ? `<div class="row" style="margin-bottom:10px"><span class="muted">勾选多个项目批量处理：</span><button class="sm" data-act="batchAuto" ${n ? "" : "disabled"}>一键全自动（${n}）</button><button class="sm" data-act="batchExport" ${n ? "" : "disabled"}>下载导出的 zip（${n}）</button></div>
          <div class="projgrid">${cards.join("")}</div>` : `<div class="empty">还没有项目。点右上角“一键全自动新建”，把淘宝采集插件导出的 zip（或者一个装着产品图的文件夹）拖进去就行。</div>`}`;
      main.onchange = (e) => {
        if (e.target.dataset.sel) { e.target.checked ? APP.homeSel.add(e.target.dataset.sel) : APP.homeSel.delete(e.target.dataset.sel); APP.render(); }
      };
    },
    act: {
      newProj: async () => { APP.project = APP.newProject(); APP.undo = []; APP.redo = []; await APP.save(true); APP.go("setup"); },
      openProj: (el) => APP.open(el.dataset.id),
      delProj: async (el) => {
        const p = await ST.db.getProject(el.dataset.id);
        if (!(await APP.confirm(`删除项目“${p.name}”？图片和文案都会删掉，不能恢复。`, "删除", true))) return;
        await ST.db.deleteProject(p.id);
        APP.homeSel.delete(p.id);
        if (APP.project && APP.project.id === p.id) APP.project = null;
        APP.render();
      },
      copyProj: async (el) => {
        const src = await ST.db.getProject(el.dataset.id);
        const name = await APP.ask("新项目名称（排版、背景、风格都沿用，素材和文案换成新产品的）", src.name.replace(/（.*?）$/, "") + "（新产品）");
        if (!name) return;
        const p = await APP.cloneLayout(src, name);
        APP.toast("已复制，接下来上传新产品的素材");
        APP.project = p;
        APP.go("assets");
      },
      startAuto: async (el) => { await APP.startAuto(el.dataset.id); APP.render(); },
      stopAuto: async (el) => { await APP.api("POST", `/api/projects/${el.dataset.id}/auto/stop`); APP.toast("已停止"); APP.render(); },
      openMyTpls: () => APP.openMyTpls(),
      batchNew: () => APP.openBatchNew(),
      batchAuto: async () => {
        const ids = [...APP.homeSel];
        if (!(await APP.confirm(`${ids.length} 个项目都开始一键全自动？AI 任务会排队一个一个做，做完的等你审核。`, "开始"))) return;
        for (const id of ids) await APP.startAuto(id, true).catch((e) => APP.toast(e.message, true));
        APP.toast(`已开始 ${ids.length} 个`);
        APP.render();
      },
      batchExport: async () => {
        const list = (await ST.db.listProjects()).filter((p) => APP.homeSel.has(p.id));
        const ok = list.filter((p) => p.auto && p.auto.exportFile);
        if (!ok.length) return APP.toast("选中的项目还没有导出的 zip（一键全自动做完才有；手动做的到“⑦ 检查和导出”里导出）", true);
        for (const p of ok) { const a = document.createElement("a"); a.href = `/api/projects/${p.id}/export`; a.download = ""; document.body.appendChild(a); a.click(); a.remove(); await ST.sleep(800); }
        if (ok.length < list.length) APP.toast(`${list.length - ok.length} 个还没有导出的 zip，跳过了`, true);
      },
    },
  };

  APP.api = async (method, url, body) => {
    const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
    let d = null;
    try { d = await r.json(); } catch {}
    if (!r.ok) throw new Error((d && d.error) || `出错了（${r.status}）`);
    return d;
  };
  /** 开始全自动（当前打开的项目先存一下） */
  APP.startAuto = async (id, quiet) => {
    if (APP.project && APP.project.id === id) await APP.save(true);
    await APP.api("POST", `/api/projects/${id}/auto`, {});
    if (!quiet) APP.toast("已开始一键全自动：在服务器上做，关掉网页也不停");
  };
  /** 服务器推送的项目变化 */
  let evTimer = 0;
  APP.onProjectEvent = (s) => {
    if (APP.project && s.id === APP.project.id) {
      if (s.deleted) { APP.project = null; return APP.go("home"); }
      // 全自动在做：项目内容由服务器改，跟着刷新
      const a = s.auto || {};
      const was = APP.project.auto && APP.project.auto.status;
      if (a.status === "running" || a.status === "exporting" || (was && was !== a.status) || (APP.step === "auto" && s.rev !== APP.project.rev)) {
        clearTimeout(evTimer);
        evTimer = setTimeout(async () => {
          const p = await ST.db.getProject(s.id);
          if (!p || !APP.project || APP.project.id !== s.id) return;
          APP.project = p;
          if ((a.status === "running" || a.status === "exporting") && APP.step !== "auto") APP.step = "auto";
          if (APP.step === "auto" || APP.step === "home") APP.render();
        }, 400);
      }
    } else if (APP.step === "home") { clearTimeout(evTimer); evTimer = setTimeout(() => APP.step === "home" && APP.render(), 500); }
  };

  /** 复制排版到一个新项目：屏幕结构、背景图、调整、风格保留；素材、产品信息、文案清空 */
  APP.cloneLayout = async (src, name) => {
    const p = APP.newProject({ name });
    Object.assign(p, { platform: src.platform, platforms: [...src.platforms], lang: src.lang, langs: [...src.langs], tone: src.tone, brandId: src.brandId, units: src.units });
    for (const sc of src.screens) {
      const n = ST.newScreen(sc.tpl);
      n.purpose = sc.purpose;
      n.ov = ST.clone(sc.ov || {});
      n.shadow = ST.clone(sc.shadow || n.shadow);
      n.bg = { ...ST.clone(sc.bg), key: "" , blend: false };
      if (sc.bg.key && !sc.bg.blend) {
        const b = await ST.db.getBlob(sc.bg.key);
        if (b) { n.bg.key = `${p.id}:bg-${n.id}`; await ST.db.putBlob(n.bg.key, b); }
      }
      if (n.items && sc.items) n.items = sc.items.map((it) => ({ id: ST.uid("i"), title: {}, desc: {}, asset: "", icon: it.icon || "", anchor: it.anchor }));
      p.screens.push(n);
    }
    if (src.style && src.style.styleRef) {
      const b = await ST.db.getBlob(src.style.styleRef);
      if (b) { p.style.styleRef = `${p.id}:styleref`; await ST.db.putBlob(p.style.styleRef, b); }
    }
    p.layoutFrom = src.id;
    await ST.db.putProject(p);
    return p;
  };

  APP.download = (blob, name) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  };

  // ------------------------------------------------------------ 我的模板（把一个项目的排版存起来，给别的产品用）
  APP.saveMyTpl = async () => {
    const p = APP.project;
    if (!p.screens.length) return APP.toast("还没有屏幕", true);
    const name = await APP.ask("模板名称", `${p.name} 的排版`);
    if (!name) return;
    const id = ST.uid("t");
    const screens = [];
    for (let i = 0; i < p.screens.length; i++) {
      const sc = p.screens[i];
      let key = "";
      if (sc.bg.key && !sc.bg.blend) {
        const b = await ST.db.getBlob(sc.bg.key);
        if (b) { key = `tpl:${id}:${i}`; await ST.db.putBlob(key, b); }
      }
      screens.push({ tpl: sc.tpl, purpose: sc.purpose, ov: ST.clone(sc.ov || {}), shadow: ST.clone(sc.shadow || {}), items: (sc.items || []).length, icons: (sc.items || []).map((it) => it.icon || ""), bg: { mode: sc.bg.mode, prompt: sc.bg.prompt, color: sc.bg.color || "", key } });
    }
    APP.mytpls.push({ id, name, created: Date.now(), tone: p.tone, platform: p.platform, screens });
    await ST.db.setMeta("mytpls", APP.mytpls);
    APP.toast(`已存成模板“${name}”，新项目在“⑤ 提纲”里可以选用`);
  };
  APP.openMyTpls = async () => {
    const rows = APP.mytpls.map((t) => `<div class="pitem"><b class="grow">${esc(t.name)}</b><span class="muted">${t.screens.length} 屏 · ${esc((ST.TONES[t.tone] || {}).name || "")} · ${ST.bj(t.created)}</span><button class="sm danger" data-ret="del:${t.id}">删除</button></div>`).join("");
    const r = await APP.modal(`<div class="note">在“⑥ 生成和编辑”里点“存成我的模板”，就能把一个项目的排版（屏幕顺序、模板、背景图、手动调整）存起来；新项目在“⑤ 提纲”里选用，AI 按这个结构给新产品写文案。</div><div class="plist" style="margin-top:10px">${rows || '<div class="muted">还没有模板</div>'}</div><div class="mf"><button data-ret="">关闭</button></div>`, { title: "我的模板" });
    if (r && r.startsWith("del:")) {
      const id = r.slice(4);
      APP.mytpls = APP.mytpls.filter((t) => t.id !== id);
      await ST.db.setMeta("mytpls", APP.mytpls);
      for (const k of await ST.db.blobKeys(`tpl:${id}:`)) await ST.db.delBlob(k);
      APP.openMyTpls();
      APP.render();
    }
  };
  /** 按我的模板建屏幕（文字空着，背景图复制过来） */
  APP.screensFromMyTpl = async (t) => {
    const p = APP.project;
    const out = [];
    for (const s of t.screens) {
      const sc = ST.newScreen(s.tpl);
      sc.purpose = s.purpose;
      sc.ov = ST.clone(s.ov || {});
      sc.shadow = { ...sc.shadow, ...(s.shadow || {}) };
      if (sc.items && ST.TPL[s.tpl].items) {
        const n = Math.max(ST.TPL[s.tpl].items.min, Math.min(ST.TPL[s.tpl].items.max, s.items || 0));
        sc.items = Array.from({ length: n }, (_, i) => ({ id: ST.uid("i"), title: {}, desc: {}, asset: "", icon: (s.icons || [])[i] || "" }));
      }
      sc.bg = { mode: s.bg.mode, prompt: s.bg.prompt || "", color: s.bg.color || "", key: "", blend: false };
      if (s.bg.key) {
        const b = await ST.db.getBlob(s.bg.key);
        if (b) { sc.bg.key = `${p.id}:bg-${sc.id}`; await ST.db.putBlob(sc.bg.key, b); }
      }
      out.push(sc);
    }
    return ST.assignAssets(p, out);
  };
})();
