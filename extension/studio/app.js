/**
 * 详情页工作室 · 主程序：状态、顶部导航、我的项目、设置（AI / 平台 / 违禁词 / 品牌）、弹窗、保存、撤销。
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
    const go = () => ST.db.putProject(p).catch((e) => APP.toast("保存失败：" + e.message, true));
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
    APP.go(step || (p.screens.length ? "edit" : p.assets.length ? "info" : "assets"));
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
  const STEPS = [["setup", "新建项目"], ["assets", "素材"], ["info", "产品信息"], ["ref", "参考详情图"], ["outline", "提纲"], ["edit", "生成和编辑"], ["export", "检查和导出"]];
  APP.STEPS = STEPS;
  APP.go = (step) => {
    APP.step = step;
    try { localStorage.setItem("studioStep", step); } catch {}
    APP.render();
    window.scrollTo(0, 0);
  };
  APP.render = () => {
    const p = APP.project;
    $("steps").innerHTML = p && APP.step !== "home" ? STEPS.map(([id, name], i) => `<button data-go="${id}" class="${APP.step === id ? "on" : ""}"><b>${"①②③④⑤⑥⑦"[i]}</b>${name}</button>`).join("") : "";
    $("projName").hidden = !p || APP.step === "home";
    if (p && document.activeElement !== $("projName")) $("projName").value = p.name;
    const view = APP.steps[APP.step] || APP.steps.home;
    $("main").className = view.wide ? "wide" : "";
    view.render($("main"));
    document.title = p && APP.step !== "home" ? `${p.name} · 详情页工作室` : "详情页工作室 · AI图图";
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
    const n = ST.AI.queue.length + (ST.AI.current ? 1 : 0);
    chip.className = "chip " + ({ busy: "busy", ok: "ok", warn: "warn", bad: "bad" }[st.kind] || "");
    chip.querySelector("span").textContent = n ? `AI 任务 ${n}` : ST.AI.status.kind === "idle" ? `${ST.AI.SITES[ST.AI.S.site].name} 未连接` : `${ST.AI.SITES[ST.AI.S.site].name}`;
    chip.title = st.msg;
    const dock = $("aiDock");
    if (dock.hidden) return;
    const jobs = [...(ST.AI.current ? [ST.AI.current] : []), ...ST.AI.queue];
    const done = (APP.aiHistory || []).slice(-8).reverse();
    dock.innerHTML = `<div class="dh"><b>AI 任务</b><span class="muted">${esc(ST.AI.SITES[ST.AI.S.site].name)} 网页版</span>
      <span class="sp row"><button class="sm" data-act="aiFocus">看 AI 窗口</button>${ST.AI.paused ? '<button class="sm blue" data-act="aiResume">继续</button>' : ""}<button class="sm danger" data-act="aiStop" ${jobs.length ? "" : "disabled"}>全部停止</button><button class="sm ghost" data-act="aiDock">✕</button></span></div>
      <div class="db"><div class="note ${st.kind === "bad" || st.kind === "warn" ? "warn" : ""}">${esc(st.msg)}</div>
      ${jobs.map((j) => `<div class="job ${j.status}"><b>${j.status === "run" ? "进行中" : "排队"}</b> ${esc(j.label)}${j.steps.length ? `<pre>${esc(j.steps.slice(-4).join("\n"))}</pre>` : ""}</div>`).join("")}
      ${done.length ? '<div class="muted">最近完成</div>' + done.map((j) => `<div class="job ${j.status}">${j.status === "ok" ? "✓" : "✕"} ${esc(j.label)}${j.error ? `<pre>${esc(j.error)}</pre>` : ""}</div>`).join("") : ""}
      </div>`;
  };
  APP.aiHistory = [];
  let lastCur = null;
  ST.AI.onChange(() => {
    if (lastCur && lastCur !== ST.AI.current && (lastCur.status === "ok" || lastCur.status === "fail")) APP.aiHistory.push(lastCur);
    lastCur = ST.AI.current;
    APP.renderAi();
    if (APP.onAiChange) APP.onAiChange();
  });

  /** 调 AI 写文字并解析 JSON（失败抛错） */
  APP.aiJson = async (prompt, images, label) => {
    const r = await ST.AI.run("text", prompt, images || [], { label });
    return ST.extractJson(r.text, r.codes);
  };
  APP.aiImage = async (prompt, images, label) => {
    const r = await ST.AI.run("image", prompt, images || [], { label });
    return ST.b64ToBlob(r.b64, r.mime || "image/png");
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
      <div class="pills" id="setTabs"><span class="pill on" data-tab="ai">AI</span><span class="pill" data-tab="pf">平台尺寸</span><span class="pill" data-tab="ban">违禁词</span><span class="pill" data-tab="brand">品牌</span></div>
      <div data-pane="ai" style="margin-top:14px">
        <div class="form">
          <label class="f">用哪个 AI<select id="sSite"><option value="gemini">Gemini 网页版</option><option value="copilot">Copilot 网页版（只能用谷歌浏览器）</option></select></label>
          <label class="f">Gemini 模型<select id="sModel"><option value="">不切换（用网页上选的）</option><option value="Flash">Flash</option><option value="Pro">Pro</option></select></label>
          <label class="f">每个任务间隔（秒，随机）<span class="row nw"><input type="number" id="sGapMin" min="0" max="300" style="width:80px">～<input type="number" id="sGapMax" min="0" max="300" style="width:80px"></span></label>
          <label class="f">画图失败自动重试（次）<input type="number" id="sRetries" min="0" max="3"></label>
        </div>
        <label class="row" style="margin-top:10px"><input type="checkbox" id="sNewChat"> 每个任务开新对话（推荐：免得上一个产品的内容干扰）</label>
        <div class="note" style="margin-top:10px">工作室会在屏幕右边打开一个单独的 ${"Gemini / Copilot"} 小窗口来干活。做图期间不要最小化、不要完全挡住它（网页在看不见时会暂停）。第一次用请先在那个窗口里登录。</div>
      </div>
      <div data-pane="pf" hidden style="margin-top:14px">
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
        m.querySelector("#sSite").value = s.site;
        m.querySelector("#sModel").value = s.model || "";
        m.querySelector("#sGapMin").value = s.gapMin;
        m.querySelector("#sGapMax").value = s.gapMax;
        m.querySelector("#sRetries").value = s.retries;
        m.querySelector("#sNewChat").checked = !!s.newChat;
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
        s.site = m.querySelector("#sSite").value;
        s.model = m.querySelector("#sModel").value;
        s.gapMin = Math.max(0, +m.querySelector("#sGapMin").value || 0);
        s.gapMax = Math.max(s.gapMin, +m.querySelector("#sGapMax").value || 0);
        s.retries = ST.clamp(+m.querySelector("#sRetries").value || 0, 0, 3);
        s.newChat = m.querySelector("#sNewChat").checked;
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
  APP.steps.home = {
    async render(main) {
      const list = await ST.db.listProjects();
      APP.homeSel = APP.homeSel || new Set();
      const cards = await Promise.all(list.map(async (p) => {
        const a = p.assets.find((x) => x.tag === "white") || p.assets[0];
        const bgKey = (p.screens[0] && p.screens[0].bg && p.screens[0].bg.key) || "";
        const thumb = (p.thumb && (await ST.urlOf(p.thumb))) || (a ? await ST.urlOf(a.cut || a.key) : bgKey ? await ST.urlOf(bgKey) : "");
        const pf = ST.platformOf(p, p.platform);
        return `<div class="proj"><input type="checkbox" class="ck" data-sel="${p.id}" ${APP.homeSel.has(p.id) ? "checked" : ""}>
          <div class="thumb" data-act="openProj" data-id="${p.id}" style="background-image:url('${thumb}')"></div>
          <div class="body"><b title="${esc(p.name)}">${esc(p.name)}</b>
          <span class="muted">${esc(pf.name)} · ${esc(ST.lang(p.lang).name)}${p.langs.length ? ` +${p.langs.length} 种语言` : ""} · ${p.screens.length} 屏</span>
          <span class="muted">更新于 ${ST.bj(p.updated)}</span></div>
          <div class="acts"><button class="sm primary" data-act="openProj" data-id="${p.id}">打开</button><button class="sm" data-act="copyProj" data-id="${p.id}" title="排版、背景、风格都保留，换新产品的素材和文案">复制成新产品</button><button class="sm" data-act="backupProj" data-id="${p.id}">备份</button><button class="sm danger" data-act="delProj" data-id="${p.id}">删除</button></div></div>`;
      }));
      main.innerHTML = `
        <div class="head"><div><h1>我的项目</h1><div class="muted">项目保存在这台电脑的浏览器里；换电脑请用“备份”导出，再“导入备份”。</div></div>
          <div class="sp"><button data-act="importProj">导入备份</button><button data-act="openMyTpls">我的模板（${APP.mytpls.length}）</button><button class="primary" data-act="newProj">＋ 新建项目</button></div></div>
        ${list.length ? `<div class="row" style="margin-bottom:10px"><span class="muted">勾选多个项目可以批量处理：</span><button class="sm" data-act="batchRun" ${APP.homeSel.size ? "" : "disabled"}>依次生成缺的背景 + 翻译（${APP.homeSel.size}）</button><button class="sm" data-act="batchExport" ${APP.homeSel.size ? "" : "disabled"}>依次导出</button></div>
          <div class="projgrid">${cards.join("")}</div>` : `<div class="empty">还没有项目。点右上角“新建项目”开始，或者在 Gemini 页面的 AI图图 面板上点“做详情页”。</div>`}
        <input type="file" id="importInput" accept=".zip" hidden>`;
      main.onchange = async (e) => {
        if (e.target.dataset.sel) { e.target.checked ? APP.homeSel.add(e.target.dataset.sel) : APP.homeSel.delete(e.target.dataset.sel); APP.render(); }
        if (e.target.id === "importInput" && e.target.files[0]) {
          try { const p = await ST.unpackProject(e.target.files[0]); APP.toast("已导入：" + p.name); APP.render(); } catch (err) { APP.toast(err.message, true); }
        }
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
      backupProj: async (el) => {
        const p = await ST.db.getProject(el.dataset.id);
        APP.toast("正在打包…");
        APP.download(await ST.packProject(p), `项目备份_${ST.safeName(p.name)}.aitutu.zip`);
      },
      importProj: () => document.getElementById("importInput").click(),
      copyProj: async (el) => {
        const src = await ST.db.getProject(el.dataset.id);
        const name = await APP.ask("新项目名称（排版、背景、风格都沿用，素材和文案换成新产品的）", src.name.replace(/（.*?）$/, "") + "（新产品）");
        if (!name) return;
        const p = await APP.cloneLayout(src, name);
        APP.toast("已复制，接下来上传新产品的素材");
        APP.project = p;
        APP.go("assets");
      },
      openMyTpls: () => APP.openMyTpls(),
      batchRun: () => APP.batch([...APP.homeSel], "run"),
      batchExport: () => APP.batch([...APP.homeSel], "export"),
    },
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
