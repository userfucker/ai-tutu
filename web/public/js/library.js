/**
 * 工作台 · 素材中心（Lee 2026-10-24）：所有图片在这里中转。
 * 左边分组（张数、大小），上面按类型 / 来源筛选；每张图显示尺寸和文件大小、用在了哪些项目；
 * 勾选以后：发送到主图制作 / 详情页（新建或已有项目）、打包下载、删除。上面显示一共占多少空间。
 * 上传、拖进来、Ctrl+V 粘贴都能加图。点图看大图（左右键切换）。
 */
(() => {
  const esc = W.esc;
  const S = { grp: "", tag: "", source: "", sel: new Set(), data: null };
  const fmt = (n) => LIB.fmtSize(n);
  const uploadGrp = () => `上传 ${W.bj().slice(5, 10)}`;

  async function load() { S.data = await W.api("GET", "/api/library"); }
  const shown = () => S.data.items.filter((x) => (!S.grp || x.grp === S.grp) && (!S.tag || x.tag === S.tag) && (!S.source || x.source === S.source));
  const USED = { main: ["主图", "/main/#p="], detail: ["详情页", "/detail/#p="], cutout: ["抠白底", "/cutout/#p="] };

  function draw(main) {
    const d = S.data;
    const list = shown();
    for (const id of [...S.sel]) if (!d.items.some((x) => x.id === id)) S.sel.delete(id);
    const selSize = d.items.filter((x) => S.sel.has(x.id)).reduce((a, x) => a + x.size, 0);
    const n = S.sel.size;
    main.innerHTML = `
      <div class="head"><div><h1>素材中心</h1><div class="muted">所有图片在这里中转：上传的、淘宝采集插件和 AI图图 插件发来的、抠白底 / 主图 / 详情页做出来的。不会自动删除。</div></div>
        <div class="sp row"><span class="tag">一共 ${d.total.n} 张 · 占 ${fmt(d.total.size)}</span><button class="primary" data-act="upload">上传图片</button></div></div>
      <div class="libwrap">
        <div class="libgroups card">
          <div class="lgi ${S.grp ? "" : "on"}" data-grp="">全部<span class="muted">${d.total.n} 张 · ${fmt(d.total.size)}</span></div>
          ${d.groups.map((g) => `<div class="lgi ${S.grp === g.name ? "on" : ""}" data-grp="${esc(g.name)}" title="${esc(g.name)}">${esc(g.name)}<span class="muted">${g.n} 张 · ${fmt(g.size)}</span></div>`).join("")}
        </div>
        <div class="grow">
          <div class="row" style="margin-bottom:10px">
            <span class="pills">${["", ...d.tags].map((t) => `<span class="pill ${S.tag === t ? "on" : ""}" data-tag="${esc(t)}">${t || "全部类型"}</span>`).join("")}</span>
            <select id="libSrc"><option value="">全部来源</option>${Object.entries(d.sources).map(([k, v]) => `<option value="${k}" ${S.source === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>
          </div>
          <div class="row libbar">
            <label class="row"><input type="checkbox" id="libAll" ${list.length && list.every((x) => S.sel.has(x.id)) ? "checked" : ""}> 全选（${list.length}）</label>
            <span class="muted">${n ? `已选 ${n} 张 · ${fmt(selSize)}` : "勾选图片后可以发送、下载、删除"}</span>
            <span class="sp row">
              <button class="sm" data-act="toCutout" ${n ? "" : "disabled"}>发送到抠白底图</button>
              <button class="sm" data-act="toMain" ${n ? "" : "disabled"}>发送到主图制作</button>
              <button class="sm" data-act="toDetail" ${n ? "" : "disabled"}>发送到详情页</button>
              <button class="sm" data-act="zip" ${n ? "" : "disabled"}>打包下载</button>
              <button class="sm danger" data-act="del" ${n ? "" : "disabled"}>删除</button></span>
          </div>
          ${list.length ? `<div class="libgrid">${list.map((x) => `<div class="lit ${S.sel.has(x.id) ? "on" : ""}" data-id="${x.id}">
            <input type="checkbox" class="lck" data-ck="${x.id}" ${S.sel.has(x.id) ? "checked" : ""}>
            <div class="lpic" data-view="${x.id}"><img loading="lazy" src="/api/library/${x.id}/thumb" alt=""></div>
            <div class="lname" title="${esc(x.name)}">${esc(x.name)}</div>
            <div class="muted"><b class="fmt fmt-${fmtOf(x).toLowerCase()}">${fmtOf(x)}</b> · ${x.w}×${x.h} · ${fmt(x.size)}</div>
            <div class="row" style="gap:4px"><span class="tag">${esc(x.tag)}</span><span class="tag">${esc(x.sourceName)}</span>${x.mime === "image/png" ? `<button class="sm" data-pe="${x.id}" title="钢笔选区删除、一键去白边，另存一张新图" style="margin-left:auto">去白边</button>` : ""}</div>
            ${x.used.length ? `<div class="muted lused">用在：${x.used.map((u) => USED[u.type] ? `<a href="${USED[u.type][1]}${encodeURIComponent(u.id)}" target="_blank">${esc(u.name || USED[u.type][0])}</a>` : esc(u.name)).join("、")}</div>` : ""}
          </div>`).join("")}</div>` : `<div class="empty" id="libDrop">${d.total.n ? "这个筛选下没有图。" : "还没有图。点右上角“上传图片”，或者把图片拖进来、按 Ctrl+V 粘贴。"}</div>`}
        </div></div>`;
  }

  async function addFiles(files) {
    const imgs = [...files].filter((f) => /^image\//.test(f.type));
    if (!imgs.length) return;
    let ok = 0;
    for (const f of imgs) { try { await LIB.add(f, { grp: uploadGrp(), tag: "原图", source: "upload", name: f.name && f.name !== "image.png" ? f.name : "" }); ok++; } catch (e) { W.toast(e.message, true); } }
    if (ok) W.toast(`加了 ${ok} 张图`);
    await load();
    draw(document.getElementById("main"));
  }

  const FMT = { "image/jpeg": "JPG", "image/png": "PNG", "image/webp": "WebP", "image/gif": "GIF" };
  const fmtOf = (x) => FMT[x.mime] || (x.mime || "").replace("image/", "").toUpperCase() || "?";
  /** 看大图：滚轮缩放、拖动、← → 切换；PNG 可以一键换深色底（lib/viewer.js） */
  function view(id) {
    const list = shown();
    VIEWER.open(list.map((x) => ({ src: `/api/library/${x.id}/file`, download: `/api/library/${x.id}/file?dl=1`, name: x.name, png: x.mime === "image/png", info: `${fmtOf(x)} · ${x.w}×${x.h} · ${fmt(x.size)} · ${x.tag} · ${x.grp}` })), Math.max(0, list.findIndex((x) => x.id === id)));
  }

  /** 去白边（lib/pngedit.js）：另存一张新图，同一个分组、同一个类型 */
  async function pe(id) {
    const x = S.data.items.find((y) => y.id === id);
    if (!x) return;
    const r = await PNGEDIT.open({ src: `/api/library/${x.id}/file`, name: x.name });
    if (!r) return;
    try { await LIB.add(r.blob, { grp: x.grp, tag: x.tag, source: x.source, name: r.name }); W.toast("去白边的图另存好了"); }
    catch (e) { return W.toast(e.message, true); }
    await load(); draw(document.getElementById("main"));
  }

  W.pages.library = {
    async render(main) {
      await load();
      draw(main);
      main.onclick = async (e) => {
        const t = e.target;
        if (t.closest("[data-grp]")) { S.grp = t.closest("[data-grp]").dataset.grp; return draw(main); }
        if (t.closest("[data-tag]")) { S.tag = t.closest("[data-tag]").dataset.tag; return draw(main); }
        if (t.closest("[data-view]")) return view(t.closest("[data-view]").dataset.view);
        if (t.dataset.pe) return pe(t.dataset.pe);
        if (t.dataset.ck) { t.checked ? S.sel.add(t.dataset.ck) : S.sel.delete(t.dataset.ck); return draw(main); }
        const b = t.closest("[data-act]");
        if (!b || b.disabled) return;
        const ids = [...S.sel];
        const act = b.dataset.act;
        if (act === "upload") {
          const i = document.createElement("input");
          i.type = "file"; i.accept = "image/*"; i.multiple = true;
          i.onchange = () => addFiles(i.files);
          i.click();
        } else if (act === "toMain" || act === "toDetail" || act === "toCutout") {
          const r = await LIB.sendDialog(ids, { toMain: "main", toDetail: "detail", toCutout: "cutout" }[act]);
          if (r) { await load(); draw(main); }
        } else if (act === "zip") {
          const r = await fetch("/api/library/zip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }), credentials: "same-origin" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(await r.blob()); a.download = "素材中心.zip"; a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 30000);
        } else if (act === "del") {
          const size = S.data.items.filter((x) => S.sel.has(x.id)).reduce((a, x) => a + x.size, 0);
          if (!(await W.confirm(`删除选中的 ${ids.length} 张图（${fmt(size)}）？已经放进项目里的不受影响。`, "删除", true))) return;
          const r = await W.api("POST", "/api/library/delete", { ids });
          S.sel.clear();
          W.toast(`删除了 ${r.removed} 张`);
          await load(); draw(main);
        }
      };
      main.onchange = (e) => {
        if (e.target.id === "libSrc") { S.source = e.target.value; draw(main); }
        if (e.target.id === "libAll") { for (const x of shown()) e.target.checked ? S.sel.add(x.id) : S.sel.delete(x.id); draw(main); }
      };
      main.ondragover = (e) => e.preventDefault();
      main.ondrop = (e) => { e.preventDefault(); addFiles(e.dataTransfer.files); };
    },
  };
  document.addEventListener("paste", (e) => {
    if (W.cur !== "library" || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const fl = [...((e.clipboardData && e.clipboardData.files) || [])];
    if (fl.length) addFiles(fl);
  });
  const redraw = async () => { if (W.cur === "library") { await load(); draw(document.getElementById("main")); } };
  W.on("library", () => W.soon(redraw, 600));
})();
