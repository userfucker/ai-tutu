/**
 * 素材中心的小部件（工作台、主图、详情页、抠白底图共用）：
 *  LIB.pick({ title, multi })        从素材中心选图，返回选中的 [{ id, name, w, h, tag, … }]
 *  LIB.sendDialog(ids, to)          把图发到主图制作 / 详情页：弹框选“新建项目”（填名字）还是已有项目
 *  LIB.blob(id)                     取一张图（Blob）
 *  LIB.add(blob, { grp, tag, source, name })  放一张图进素材中心
 *  LIB.fmtSize(bytes)               156 KB / 2.3 MB
 * 用自己的弹层（#libLayer），不依赖页面的弹窗。
 */
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (method, url, body) => {
    const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { location.href = "/"; throw new Error("请先登录"); }
    if (!r.ok) throw new Error(d.error || `出错了（${r.status}）`);
    return d;
  };
  const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round((n || 0) / 1024)) + " KB");
  const KIND = { main: "主图制作", detail: "详情页", cutout: "抠白底图" };

  // 样式（第一次用时加进页面）
  let styled = false;
  function style() {
    if (styled) return;
    styled = true;
    const st = document.createElement("style");
    st.textContent = `
#libLayer { position: fixed; inset: 0; background: rgba(15,18,25,.45); z-index: 900; display: flex; align-items: center; justify-content: center; padding: 20px; }
#libLayer .lbox { background: #fff; border-radius: 14px; width: min(1100px, 100%); max-height: 92vh; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,.25); font-size: 14px; color: #1f2329; }
#libLayer .lbox.small { width: min(520px, 100%); }
#libLayer .lh { display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid #eceef2; }
#libLayer .lh h2 { margin: 0; font-size: 16px; }
#libLayer .lb { padding: 14px 18px; overflow: auto; flex: 1; }
#libLayer .lf { display: flex; gap: 8px; justify-content: flex-end; align-items: center; padding: 12px 18px; border-top: 1px solid #eceef2; }
#libLayer button { border: 1px solid #d4d6dc; background: #fff; border-radius: 8px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
#libLayer button.primary { background: #1f2329; color: #fff; border-color: #1f2329; }
#libLayer button:disabled { opacity: .45; cursor: default; }
#libLayer .lgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; }
#libLayer .lcell { border: 2px solid transparent; border-radius: 10px; padding: 4px; cursor: pointer; background: #f6f7f9; position: relative; }
#libLayer .lcell.on { border-color: #2563eb; background: #eef4ff; }
#libLayer .lcell img { width: 100%; aspect-ratio: 1; object-fit: contain; display: block; border-radius: 6px; background: #fff; }
#libLayer .lcell .ln { font-size: 11.5px; color: #6b7280; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#libLayer .lcell .ck { position: absolute; left: 8px; top: 8px; width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 2px solid #c3c6cd; }
#libLayer .lcell.on .ck { background: #2563eb; border-color: #2563eb; }
#libLayer select, #libLayer input[type=text] { border: 1px solid #d4d6dc; border-radius: 8px; padding: 6px 10px; font-size: 13px; }
#libLayer .muted { color: #8a8f99; font-size: 12.5px; }
#libLayer label.opt { display: flex; gap: 8px; align-items: center; padding: 8px 0; }`;
    document.head.appendChild(st);
  }
  /** 弹层：html 里带 data-ret 的按钮结束，返回 { v, el } */
  function layer(html, o = {}) {
    style();
    return new Promise((resolve) => {
      const L = document.createElement("div");
      L.id = "libLayer";
      L.innerHTML = `<div class="lbox ${o.small ? "small" : ""}"><div class="lh"><h2>${esc(o.title || "")}</h2><button data-ret="" style="margin-left:auto">✕</button></div>${html}</div>`;
      document.body.appendChild(L);
      const done = (v) => { document.removeEventListener("keydown", key, true); L.remove(); resolve(v); };
      const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(null); } };
      document.addEventListener("keydown", key, true);
      L.addEventListener("mousedown", (e) => { if (e.target === L) done(null); });
      L.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-ret]");
        if (!b || b.disabled) return;
        const v = b.dataset.ret;
        if (v && o.check && (await o.check(v, L)) === false) return;
        done(v || null);
      });
      if (o.onOpen) o.onOpen(L);
    });
  }

  /** 从素材中心选图 */
  async function pick(o = {}) {
    const data = await api("GET", "/api/library");
    let grp = "", tag = "";
    const sel = new Set();
    let out = null;
    const r = await layer(`
      <div class="lb">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          <select id="lgGrp"><option value="">全部分组（${data.total.n} 张）</option>${data.groups.map((g) => `<option value="${esc(g.name)}">${esc(g.name)}（${g.n}）</option>`).join("")}</select>
          <select id="lgTag"><option value="">全部类型</option>${data.tags.map((t) => `<option>${esc(t)}</option>`).join("")}</select>
          <span class="muted" id="lgN" style="align-self:center"></span></div>
        <div class="lgrid" id="lgGrid"></div></div>
      <div class="lf"><span class="muted">${o.multi === false ? "选一张" : "可以选多张"}</span><button data-ret="">取消</button><button class="primary" data-ret="ok" id="lgOk" disabled>用选中的</button></div>`, {
      title: o.title || "从素材中心选图",
      onOpen: (L) => {
        const draw = () => {
          const list = data.items.filter((x) => (!grp || x.grp === grp) && (!tag || x.tag === tag));
          L.querySelector("#lgGrid").innerHTML = list.map((x) => `<div class="lcell ${sel.has(x.id) ? "on" : ""}" data-id="${x.id}" title="${esc(x.grp)} · ${esc(x.name)}"><img loading="lazy" src="/api/library/${x.id}/thumb?v=${x.v || ""}" alt=""><span class="ck"></span><div class="ln">${esc(({ "image/jpeg": "JPG", "image/png": "PNG", "image/webp": "WebP", "image/gif": "GIF" })[x.mime] || "")} · ${esc(x.tag)} · ${x.w}×${x.h}</div></div>`).join("") || '<div class="muted">这里没有图。</div>';
          L.querySelector("#lgN").textContent = sel.size ? `已选 ${sel.size} 张` : "";
          L.querySelector("#lgOk").disabled = !sel.size;
        };
        L.querySelector("#lgGrp").onchange = (e) => { grp = e.target.value; draw(); };
        L.querySelector("#lgTag").onchange = (e) => { tag = e.target.value; draw(); };
        L.querySelector("#lgGrid").onclick = (e) => {
          const c = e.target.closest("[data-id]");
          if (!c) return;
          if (o.multi === false) sel.clear();
          sel.has(c.dataset.id) ? sel.delete(c.dataset.id) : sel.add(c.dataset.id);
          draw();
        };
        draw();
      },
      check: () => { out = data.items.filter((x) => sel.has(x.id)); },
    });
    return r === "ok" ? out : null;
  }

  /** 发到主图制作 / 详情页：新建（填名字）或已有项目。成功返回 { projectId, name, url } */
  async function sendDialog(ids, to) {
    if (!ids || !ids.length) return null;
    const { list } = await api("GET", `/api/projects${to === "detail" ? "" : "?kind=" + to}`);
    const prefix = { main: "主图", detail: "详情图", cutout: "白底图" }[to];
    let res = null;
    const r = await layer(`
      <div class="lb">
        <div class="muted" style="margin-bottom:8px">${ids.length} 张图发到“${KIND[to]}”：</div>
        <label class="opt"><input type="radio" name="lsTo" value="new" checked> 新建项目，名字 <input type="text" id="lsName" placeholder="如：钱包" style="flex:1"></label>
        <div class="muted" style="margin:-4px 0 8px 26px">会自动变成“${prefix}-钱包10-24-1”，建好以后不能改</div>
        <label class="opt"><input type="radio" name="lsTo" value="old" ${list.length ? "" : "disabled"}> 放进已有项目 <select id="lsProj" style="flex:1" ${list.length ? "" : "disabled"}>${list.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("") || "<option>还没有项目</option>"}</select></label>
      </div>
      <div class="lf"><button data-ret="">取消</button><button class="primary" data-ret="ok">发送</button></div>`, {
      title: `发送到${KIND[to]}`, small: true,
      onOpen: (L) => {
        L.querySelector("#lsProj").onfocus = () => { L.querySelector('[value="old"]').checked = true; };
        L.querySelector("#lsName").onfocus = () => { L.querySelector('[value="new"]').checked = true; };
        L.querySelector("#lsName").focus();
      },
      check: async (v, L) => {
        const old = L.querySelector('[name="lsTo"]:checked').value === "old";
        try { res = await api("POST", "/api/library/send", { to, ids, projectId: old ? L.querySelector("#lsProj").value : "", name: L.querySelector("#lsName").value.trim() }); }
        catch (e) { alert(e.message); return false; }
      },
    });
    if (r !== "ok" || !res) return null;
    await layer(`<div class="lb">已经放进 <b>${esc(res.name)}</b>。</div><div class="lf"><button data-ret="">留在这里</button><a href="${esc(res.url)}" target="_blank"><button class="primary" data-ret="go">打开这个项目</button></a></div>`, { title: "发送好了", small: true });
    return res;
  }

  const blob = async (id) => { const r = await fetch(`/api/library/${encodeURIComponent(id)}/file`, { credentials: "same-origin" }); if (!r.ok) throw new Error("取图失败"); return r.blob(); };
  const add = async (b, o = {}) => {
    const q = new URLSearchParams({ grp: o.grp || "", tag: o.tag || "原图", source: o.source || "upload", name: o.name || "" });
    const r = await fetch("/api/library?" + q, { method: "POST", body: b, credentials: "same-origin" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "放进素材中心失败");
    return d.item;
  };
  globalThis.LIB = { pick, sendDialog, blob, add, fmtSize, layer, esc };
})();
