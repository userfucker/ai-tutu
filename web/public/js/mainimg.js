/**
 * 工作台里的“主图”：主图项目列表，点进去打开主图页面（/main/，单独的页面）。
 */
(() => {
  W.pages.main = {
    async render(main) {
      const { list } = await W.api("GET", "/api/projects?kind=main");
      main.innerHTML = `<div class="head"><div><h1>主图</h1><div class="muted">上传白底图，选几种背景风格（预设、上传图片让 AI 识别、自己写），AI 画背景，程序贴产品，AI 调光影融入（产品不变）。800×800 或 1000×1000。</div></div>
        <div class="sp"><a class="btn primary" href="/main/">打开主图</a></div></div>
        ${list.length ? `<div class="card"><table class="tbl"><thead><tr><th>项目</th><th>主图</th><th>已采用</th><th>更新</th><th></th></tr></thead><tbody>
          ${list.slice(0, 50).map((p) => `<tr><td>${W.esc(p.name)}</td><td>${p.items}</td><td>${p.done}</td><td>${W.bj ? W.bj(p.updated) : new Date(p.updated).toLocaleString()}</td><td><a href="/main/#p=${encodeURIComponent(p.id)}">打开</a></td></tr>`).join("")}
          </tbody></table></div>` : '<div class="empty">还没有主图项目。点右上角“打开主图”开始。</div>'}`;
    },
  };
  const redraw = () => { if (W.cur === "main") W.pages.main.render(document.getElementById("main")).catch(() => {}); };
  W.on("project", () => W.soon(redraw, 800));
})();
