/**
 * 工作台里的“抠白底图”：项目列表（点名称打开 /cutout/，后面只有“删除”）。
 */
(() => {
  W.pages.cutout = {
    async render(main) {
      const { list } = await W.api("GET", "/api/projects?kind=cutout");
      main.innerHTML = `<div class="head"><div><h1>抠白底图</h1><div class="muted">抠白底图 1:1 / 图片精修 / 自由模式：和 AI图图 插件右侧面板一样，但在服务器上做（网页指挥插件里的 Gemini / Copilot，关掉网页也不停）。做好的图自动放进素材中心。</div></div>
        <div class="sp"><a class="btn primary" href="/cutout/">打开抠白底图</a></div></div>
        ${list.length ? `<div class="card"><table class="tbl"><thead><tr><th>项目</th><th>产品图</th><th>做好</th><th>更新</th><th></th></tr></thead><tbody>
          ${list.slice(0, 50).map((p) => `<tr><td><a href="/cutout/#p=${encodeURIComponent(p.id)}" title="打开">${W.esc(p.name)}</a></td><td>${p.files}</td><td>${p.done}${p.running ? `（正在做 ${p.running}）` : ""}</td><td>${W.bj ? W.bj(p.updated) : new Date(p.updated).toLocaleString()}</td><td><button class="sm danger" data-del="${p.id}">删除</button></td></tr>`).join("")}
          </tbody></table></div>` : '<div class="empty">还没有抠白底图项目。点右上角“打开抠白底图”开始。</div>'}`;
      main.onclick = async (e) => {
        const b = e.target.closest("[data-del]");
        if (!b || !(await W.confirm("删除这个抠白底图项目？里面的图都会删掉（已经放进素材中心的不受影响）。", "删除", true))) return;
        await W.api("DELETE", `/api/projects/${encodeURIComponent(b.dataset.del)}`);
        W.pages.cutout.render(main);
      };
    },
  };
  const redraw = () => { if (W.cur === "cutout") W.pages.cutout.render(document.getElementById("main")).catch(() => {}); };
  W.on("project", () => W.soon(redraw, 800));
})();
