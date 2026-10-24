/**
 * 工作台里的“主图”：主图项目列表，点进去打开主图页面（/main/，单独的页面）。
 */
(() => {
  W.pages.main = {
    async render(main) {
      const { list } = await W.api("GET", "/api/projects?kind=main");
      main.innerHTML = `<div class="head"><div><h1>主图</h1><div class="muted">上传白底图，选几种背景风格（预设、上传图片让 AI 识别、自己写），AI 画背景，程序贴产品，AI 调光影融入（产品不变）。800×800 或 1000×1000。</div></div>
        <div class="sp"><button class="primary" data-new="main">＋ 新建项目</button></div></div>
        ${list.length ? `<div class="card"><table class="tbl"><thead><tr><th>项目</th><th>主图</th><th>已采用</th><th>更新</th><th></th></tr></thead><tbody>
          ${list.slice(0, 50).map((p) => `<tr><td><a href="/main/#p=${encodeURIComponent(p.id)}" title="打开">${W.esc(p.name)}</a></td><td>${p.items}</td><td>${p.done}</td><td>${W.bj ? W.bj(p.updated) : new Date(p.updated).toLocaleString()}</td><td><button class="sm danger" data-del="${p.id}">删除</button></td></tr>`).join("")}
          </tbody></table></div>` : '<div class="empty">还没有主图项目。点右上角“新建项目”开始。</div>'}`;
      main.onclick = async (e) => {
        if (e.target.closest("[data-new]")) return W.newProject(e.target.closest("[data-new]").dataset.new);
        const b = e.target.closest("[data-del]");
        if (!b || !(await W.confirm("删除这个主图项目？里面的图都会删掉。", "删除", true))) return;
        await W.api("DELETE", `/api/projects/${encodeURIComponent(b.dataset.del)}`);
        W.pages.main.render(main);
      };
    },
  };
  const redraw = () => { if (W.cur === "main") W.pages.main.render(document.getElementById("main")).catch(() => {}); };
  W.on("project", () => W.soon(redraw, 800));
})();
