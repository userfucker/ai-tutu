/**
 * 工作台里的“详情页”：项目概况（全自动做到哪了），点进去打开详情页（/detail/，单独的页面）。
 */
(() => {
  const NAMES = { running: "全自动进行中", exporting: "正在导出", review: "等你审核", approved: "已审核通过", failed: "全自动出错", stopped: "全自动已停止" };
  W.pages.detail = {
    async render(main) {
      const { list } = await W.api("GET", "/api/projects");
      const n = (s) => list.filter((p) => p.auto && p.auto.status === s).length;
      main.innerHTML = `<div class="head"><div><h1>详情页</h1><div class="muted">上传产品图（或淘宝采集的 zip），一键全自动做出多平台、多语言的详情页；也可以一步一步手动做。</div></div>
        <div class="sp"><a class="btn primary" href="/detail/">打开详情页</a></div></div>
        <div class="row" style="margin-bottom:12px"><span class="tag">项目 ${list.length}</span><span class="tag blue">进行中 ${n("running")}</span><span class="tag warn">等审核 ${n("review")}</span><span class="tag ok">已通过 ${n("approved")}</span>${n("failed") ? `<span class="tag bad">出错 ${n("failed")}</span>` : ""}</div>
        ${list.length ? `<div class="card"><table class="tbl"><thead><tr><th>项目</th><th>屏数</th><th>状态</th><th>更新</th><th></th></tr></thead><tbody>
          ${list.slice(0, 50).map((p) => `<tr><td><a href="/detail/#p=${encodeURIComponent(p.id)}" title="打开">${W.esc(p.name)}</a></td><td>${p.screens}</td><td>${p.auto ? `${W.esc(NAMES[p.auto.status] || p.auto.status)}${p.auto.status === "running" ? " · " + W.esc(p.auto.msg || "") : ""}` : "手动"}</td><td>${W.bj ? W.bj(p.updated) : new Date(p.updated).toLocaleString()}</td>
            <td>${p.auto && p.auto.exportFile ? `<a href="/api/projects/${encodeURIComponent(p.id)}/export">下载 zip</a> ` : ""}<button class="sm danger" data-del="${p.id}">删除</button></td></tr>`).join("")}
          </tbody></table></div>` : '<div class="empty">还没有项目。点右上角“打开详情页”开始。</div>'}`;
      main.onclick = async (e) => {
        const b = e.target.closest("[data-del]");
        if (!b || !(await W.confirm("删除这个详情页项目？里面的图和导出的 zip 都会删掉。", "删除", true))) return;
        await W.api("DELETE", `/api/projects/${encodeURIComponent(b.dataset.del)}`);
        W.pages.detail.render(main);
      };
    },
  };
  const redraw = () => { if (W.cur === "detail") W.pages.detail.render(document.getElementById("main")).catch(() => {}); };
  W.on("project", () => W.soon(redraw, 800));
})();
