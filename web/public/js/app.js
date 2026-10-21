/**
 * 工作台网页：公共部分（接口、实时推送、路由、弹窗、提示）。每个页面在自己的文件里注册 W.pages.xxx。
 */
var W = (globalThis.W = { pages: {}, status: null, cur: null, params: [] });
(() => {
  const $ = (id) => document.getElementById(id);
  W.$ = $;
  W.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  W.bj = (ms = Date.now(), sec = false) => {
    if (!ms) return "";
    const d = new Date(ms + 8 * 3600 * 1000);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}${sec ? ":" + p(d.getUTCSeconds()) : ""}`;
  };
  W.ago = (ms) => {
    if (!ms) return "";
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    return s < 60 ? `${s} 秒前` : s < 3600 ? `${Math.round(s / 60)} 分钟前` : s < 86400 ? `${Math.round(s / 3600)} 小时前` : W.bj(ms).slice(5);
  };

  W.api = async (method, url, body) => {
    const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
    let data = null;
    try { data = await r.json(); } catch {}
    if (r.status === 401 && data && data.login) { W.showLogin(); throw new Error("请先登录"); }
    if (!r.ok) throw new Error((data && data.error) || `出错了（${r.status}）`);
    return data;
  };
  W.toast = (msg, bad) => {
    const t = $("toast");
    t.textContent = msg;
    t.className = bad ? "bad" : "";
    t.hidden = false;
    clearTimeout(W.toast.t);
    W.toast.t = setTimeout(() => (t.hidden = true), bad ? 6000 : 2800);
  };
  W.modal = (title, html, o = {}) => new Promise((resolve) => {
    const wrap = $("modalWrap"), m = $("modal");
    m.innerHTML = `<div class="mh"><h2>${W.esc(title)}</h2><button class="ghost sp" data-ret="">✕</button></div>${html}`;
    wrap.hidden = false;
    const done = (v) => { wrap.hidden = true; m.innerHTML = ""; m.onclick = null; resolve(v); };
    wrap.onmousedown = (e) => { if (e.target === wrap) done(null); };
    m.onclick = async (e) => {
      const b = e.target.closest("[data-ret]");
      if (!b) return;
      const v = b.dataset.ret;
      if (v && o.check && (await o.check(v, m)) === false) return;
      done(v || null);
    };
    if (o.onOpen) o.onOpen(m);
  });
  /** 输入一行字，返回输入的内容（取消为 null） */
  W.prompt = async (title, def = "") => {
    let val = null;
    const r = await W.modal(title, `<input id="wPrompt" style="width:100%" value="${W.esc(def)}"><div class="mf"><button data-ret="">取消</button><button class="primary" data-ret="ok">确定</button></div>`, {
      onOpen: (m) => { const i = m.querySelector("#wPrompt"); i.focus(); i.select(); i.onkeydown = (e) => { if (e.key === "Enter") m.querySelector('[data-ret="ok"]').click(); }; },
      check: (v, m) => { val = m.querySelector("#wPrompt").value.trim(); },
    });
    return r === "ok" ? val : null;
  };
  W.confirm = async (msg, yes = "确定", danger) => (await W.modal("请确认", `<p>${W.esc(msg)}</p><div class="mf"><button data-ret="">取消</button><button class="${danger ? "danger" : "primary"}" data-ret="yes">${W.esc(yes)}</button></div>`)) === "yes";

  // ------------------------------------------------------------ 路由：#/页面/参数
  W.go = (hash) => { if (location.hash === hash) W.render(); else location.hash = hash; };
  W.render = async () => {
    const parts = (location.hash.replace(/^#\/?/, "") || "analysis").split("/");
    const name = W.pages[parts[0]] ? parts[0] : "analysis";
    W.cur = name;
    W.params = parts.slice(1).map(decodeURIComponent);
    document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.nav === name));
    const main = $("main");
    main.onclick = main.oninput = main.onchange = null;
    try { await W.pages[name].render(main, W.params); }
    catch (e) { console.error(e); if (!/请先登录/.test(e.message)) main.innerHTML = `<div class="note bad">页面出错：${W.esc(e.message)}</div>`; }
  };
  window.addEventListener("hashchange", W.render);
  // 页面里 data-act 的按钮
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-act]");
    if (!a || a.closest("#modal")) return;
    const page = W.pages[W.cur];
    const fn = page && page.act && page.act[a.dataset.act];
    if (fn) { e.preventDefault(); Promise.resolve(fn(a, e)).catch((err) => W.toast(err.message, true)); }
  });

  // ------------------------------------------------------------ 实时推送
  let es = null;
  const handlers = {};
  W.on = (type, fn) => { (handlers[type] = handlers[type] || []).push(fn); };
  W.connectEvents = () => {
    if (es) es.close();
    es = new EventSource("/api/events");
    for (const type of ["status", "task", "analysis", "project"]) {
      es.addEventListener(type, (ev) => { let d; try { d = JSON.parse(ev.data); } catch { return; } (handlers[type] || []).forEach((fn) => fn(d)); });
    }
    es.onerror = () => { /* 浏览器会自动重连 */ };
  };
  /** 重画当前页面，但合并短时间里的多次调用 */
  W.soon = (fn, ms = 300) => { clearTimeout(fn.__t); fn.__t = setTimeout(fn, ms); };

  // ------------------------------------------------------------ 插件状态（左边导航的小红点）
  W.refreshStatus = async () => {
    try { W.status = await W.api("GET", "/api/status"); } catch { return; }
    W.renderNav();
  };
  W.renderNav = () => {
    const s = W.status;
    if (!s) return;
    const n = (s.counts.queued || 0) + (s.counts.running || 0);
    $("navTasks").textContent = n ? String(n) : s.counts.failed ? "!" : "";
    $("navTasks").className = !n && s.counts.failed ? "bad" : "";
    const sites = s.workers.reduce((a, w) => a + w.sites.length, 0);
    $("navConn").textContent = s.workers.length ? String(sites) : "0";
    $("navConn").className = s.workers.length ? "" : "bad";
    $("navFoot").textContent = `v${s.version}${s.disk ? ` · 磁盘剩 ${(s.disk.free / 1073741824).toFixed(1)} GB` : ""}`;
  };
  W.on("status", (d) => { if (W.status) { W.status.workers = d.workers; W.status.counts = d.counts; W.renderNav(); } });
  W.on("task", () => W.soon(W.refreshCounts, 800));
  W.refreshCounts = async () => { try { const r = await W.api("GET", "/api/tasks?limit=1"); if (W.status) { W.status.counts = r.counts; W.renderNav(); } } catch {} };

  // ------------------------------------------------------------ 登录
  W.showLogin = async () => {
    const st = await (await fetch("/api/auth/state")).json();
    $("shell").hidden = true;
    const box = $("login");
    box.hidden = false;
    box.innerHTML = `<form class="box" id="loginForm"><h1>AI图图 工作台</h1>
      <div class="muted">${st.setup ? "请输入管理密码" : "第一次使用：设置一个管理密码（至少 4 位）"}</div>
      <input type="password" id="pw" placeholder="管理密码" autocomplete="${st.setup ? "current-password" : "new-password"}" autofocus>
      ${st.setup ? "" : '<input type="password" id="pw2" placeholder="再输一次" autocomplete="new-password">'}
      <button class="primary" type="submit">${st.setup ? "登录" : "设置密码并进入"}</button><div class="muted" id="loginErr"></div></form>`;
    box.querySelector("#loginForm").onsubmit = async (e) => {
      e.preventDefault();
      const pw = box.querySelector("#pw").value;
      try {
        if (!st.setup) {
          if (pw !== box.querySelector("#pw2").value) throw new Error("两次输入的密码不一样");
          await W.api("POST", "/api/auth/setup", { password: pw });
        } else await W.api("POST", "/api/auth/login", { password: pw });
        box.hidden = true;
        W.start();
      } catch (err) { box.querySelector("#loginErr").textContent = err.message; }
    };
  };
  W.start = async () => {
    $("shell").hidden = false;
    $("login").hidden = true;
    W.connectEvents();
    await W.refreshStatus();
    W.render();
  };
})();
