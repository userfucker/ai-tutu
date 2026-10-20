/**
 * 任务中心：所有 AI 任务（排队、进行中、失败、完成），可以取消、重试、插队。
 */
(() => {
  const esc = W.esc;
  let filter = "active";
  const OWNER = { analysis: "竞品分析", project: "详情页", manual: "手动" };
  W.pages.tasks = {
    async render(main) {
      const q = filter === "active" ? "" : filter === "all" ? "" : `status=${filter}`;
      const r = await W.api("GET", `/api/tasks?limit=300&${q}`);
      let list = r.tasks;
      if (filter === "active") list = list.filter((t) => t.status === "queued" || t.status === "running");
      const c = r.counts;
      main.innerHTML = `<div class="head"><div><h1>任务中心</h1><div class="muted">所有交给插件做的任务。同一个网站一次只做一个，做完隔几秒再做下一个；不同网站同时做。</div></div></div>
        <div class="pills" style="margin-bottom:12px">${[["active", `进行中和排队（${(c.running || 0) + (c.queued || 0)}）`], ["failed", `失败（${c.failed || 0}）`], ["done", `完成（${c.done || 0}）`], ["all", "全部"]].map(([k, n]) => `<span class="pill ${filter === k ? "on" : ""}" data-act="filter" data-f="${k}">${n}</span>`).join("")}</div>
        ${list.length ? `<div class="card tscroll"><table class="table"><thead><tr><th>#</th><th>任务</th><th>来自</th><th>状态</th><th>交给</th><th>说明</th><th>时间</th><th></th></tr></thead><tbody>
        ${list.map((t) => `<tr><td class="muted">${t.id}</td><td>${esc(t.label)}</td><td>${t.ownerType === "analysis" ? `<a href="#/analysis/${esc(t.ownerId)}">${OWNER[t.ownerType]}</a>` : t.ownerType === "project" ? `<a href="#/detail/${esc(t.ownerId)}">${OWNER[t.ownerType]}</a>` : esc(OWNER[t.ownerType] || "")}</td>
          <td>${W.taskTag(t)}${t.attempts > 1 ? ` <span class="muted">第 ${t.attempts} 次</span>` : ""}</td><td>${esc(t.siteName || "")}</td>
          <td class="muted" style="max-width:360px">${esc((t.status === "failed" || t.status === "cancelled" ? t.error : t.progress) || "")}</td>
          <td class="muted">${W.ago(t.finished || t.started || t.created)}</td>
          <td class="row" style="flex-wrap:nowrap">${t.status === "queued" ? `<button class="sm" data-act="bump" data-id="${t.id}">插队</button>` : ""}${t.status === "queued" || t.status === "running" ? `<button class="sm danger" data-act="cancel" data-id="${t.id}">取消</button>` : ""}${t.status === "failed" || t.status === "cancelled" ? `<button class="sm" data-act="retry" data-id="${t.id}">重试</button>` : ""}</td></tr>`).join("")}
        </tbody></table></div>` : `<div class="empty">${filter === "active" ? "现在没有要做的任务" : "没有"}</div>`}`;
    },
    act: {
      filter: (el) => { filter = el.dataset.f; W.render(); },
      cancel: async (el) => { await W.api("POST", `/api/tasks/${el.dataset.id}/cancel`); W.render(); },
      retry: async (el) => { await W.api("POST", `/api/tasks/${el.dataset.id}/retry`); W.render(); },
      bump: async (el) => { await W.api("POST", `/api/tasks/${el.dataset.id}/bump`); W.render(); },
    },
  };
  W.on("task", () => { if (W.cur === "tasks") W.soon(W.render, 700); });
})();
