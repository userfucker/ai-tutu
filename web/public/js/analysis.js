/**
 * 竞品分析：列表、新建（贴链接）、进度和报告。
 */
(() => {
  const esc = W.esc;
  const STAGES = [["collect", "采集"], ["tag", "分析评价"], ["vocab", "合并标签"], ["stats", "统计"], ["write", "写结论"], ["report", "出报告"]];
  const STAGE_TEXT = { collect: "采集中", tag: "分析评价中", vocab: "合并标签", stats: "统计中", write: "写结论", report: "出报告", done: "已完成", failed: "失败", stopped: "已停止" };
  const P_STATUS = { waiting: ["排队", ""], collecting: ["采集中", "blue"], collected: ["已采集", "ok"], failed: ["没采到", "bad"], manual: ["手动填写", "ours"] };
  const stageTag = (s) => `<span class="tag ${s === "done" ? "ok" : s === "failed" ? "bad" : s === "stopped" ? "warn" : "blue"}">${STAGE_TEXT[s] || s}</span>`;
  let rateOptions = [100, 200, 300, 500, 800, 1000];
  let cache = { list: null, detail: null };

  function stagesHtml(a) {
    const i = STAGES.findIndex(([k]) => k === a.stage);
    return `<div class="stages">${STAGES.map(([k, n], j) => `<span class="${a.stage === "done" || j < i ? "done" : j === i ? (a.stage === "failed" ? "bad" : "on") : ""}">${n}</span>`).join("")}</div>`;
  }
  const hasTaobao = () => W.status && W.status.workers.some((w) => w.app === "taobao");
  const hasText = () => W.status && W.status.workers.some((w) => w.sites.some((s) => (W.status.roles.text || []).includes(s.site)));

  W.pages.analysis = {
    async render(main, params) {
      if (params[0] === "new") return renderNew(main);
      if (params[0]) return renderDetail(main, params[0]);
      const r = await W.api("GET", "/api/analyses");
      rateOptions = r.rateOptions || rateOptions;
      cache.list = r.list;
      main.innerHTML = `<div class="head"><div><h1>竞品分析</h1><div class="muted">贴上淘宝 / 天猫的商品链接，插件自动采集商品信息、评价和问大家，AI 分析买家的需求和不满，出一份 HTML 报告。</div></div>
        <div class="sp"><button class="primary" data-act="new">＋ 新建分析</button></div></div>
        ${!hasTaobao() ? `<div class="note warn" style="margin-bottom:12px">淘宝采集插件还没连上工作台：在插件的“选项”里填工作台地址和口令（在“AI 连接”页面看）。没连上时任务会排队等着。</div>` : ""}
        ${r.list.length ? `<div class="alist">${r.list.map((a) => `<div class="aitem" data-act="open" data-id="${a.id}">
          <div class="row"><b class="grow">${esc(a.name)}</b>${stageTag(a.stage)}</div>
          <div class="muted">${a.products.filter((p) => p.role === "rival").length} 个竞品${a.products.some((p) => p.role === "ours") ? " + 我们的产品" : ""} · 每个最多 ${a.options.rates} 条评价 · ${W.bj(a.created).slice(5)}</div>
          ${["done", "failed", "stopped"].includes(a.stage) ? "" : `<div class="muted">${esc(a.progress && a.progress.msg || "")}</div><div class="progress"><i style="width:${a.progress && a.progress.total ? Math.round((a.progress.done / a.progress.total) * 100) : 5}%"></i></div>`}
          ${a.error ? `<div class="muted" style="color:var(--bad)">${esc(a.error)}</div>` : ""}</div>`).join("")}</div>` : `<div class="empty">还没有分析。点右上角“新建分析”，贴上竞品链接就能开始。</div>`}`;
    },
    act: {
      new: () => W.go("#/analysis/new"),
      open: (el) => W.go(`#/analysis/${el.dataset.id}`),
      submit: async (el) => {
        const m = document.getElementById("main");
        const v = (id) => (m.querySelector("#" + id) || {}).value || "";
        const mode = m.querySelector("input[name=ours]:checked").value;
        const body = {
          name: v("aName").trim(), links: v("aLinks"), rates: +v("aRates"), qa: m.querySelector("#aQa").checked,
          oursUrl: mode === "link" ? v("oUrl") : "",
          oursManual: mode === "manual" ? { name: v("oName"), price: v("oPrice"), points: v("oPoints"), params: v("oParams"), notes: v("oNotes") } : null,
        };
        el.disabled = true;
        try {
          const r = await W.api("POST", "/api/analyses", body);
          W.toast("已开始：插件会一个一个采集");
          W.go(`#/analysis/${r.id}`);
        } catch (e) { W.toast(e.message, true); el.disabled = false; }
      },
      stop: async () => { if (await W.confirm("停止这个分析？已经做完的部分会保留，之后可以“重新开始”接着做。", "停止")) { await W.api("POST", `/api/analyses/${W.params[0]}/stop`); W.render(); } },
      restart: async () => { await W.api("POST", `/api/analyses/${W.params[0]}/restart`); W.toast("接着做：没做完和失败的部分会重新排队"); W.render(); },
      del: async () => { if (await W.confirm("删除这个分析和报告？不能恢复。", "删除", true)) { await W.api("DELETE", `/api/analyses/${W.params[0]}`); W.go("#/analysis"); } },
      retryTask: async (el) => { await W.api("POST", `/api/tasks/${el.dataset.id}/retry`); W.toast("已重新排队"); },
      dupe: async () => {
        const a = cache.detail;
        sessionStorage.setItem("aitutuDupe", JSON.stringify({ name: a.name + "（重新分析）", links: a.products.filter((p) => p.role === "rival").map((p) => p.url).join("\n"), oursUrl: (a.products.find((p) => p.role === "ours" && p.url) || {}).url || "", rates: a.options.rates }));
        W.go("#/analysis/new");
      },
    },
  };

  function renderNew(main) {
    let pre = {};
    try { pre = JSON.parse(sessionStorage.getItem("aitutuDupe") || "{}"); sessionStorage.removeItem("aitutuDupe"); } catch {}
    main.innerHTML = `<div class="head"><div><h1>新建竞品分析</h1><div class="muted">现在只支持淘宝和天猫的链接，其他平台以后补充。</div></div><div class="sp"><button data-act="back" onclick="history.back()">返回</button></div></div>
      <div class="card"><div class="form">
        <label class="f wide">名称（可以不填）<input id="aName" value="${esc(pre.name || "")}" placeholder="例如：保温杯竞品 10 月"></label>
        <label class="f wide">竞品链接（一行一个）<textarea id="aLinks" rows="6" placeholder="https://item.taobao.com/item.htm?id=...&#10;https://detail.tmall.com/item.htm?id=...">${esc(pre.links || "")}</textarea></label>
        <label class="f">每个商品采集多少条评价（按时间，最新的优先）<select id="aRates">${rateOptions.map((n) => `<option value="${n}" ${n === (pre.rates || 300) ? "selected" : ""}>${n} 条</option>`).join("")}</select></label>
        <label class="f">问大家<span class="row" style="color:var(--ink)"><label class="row"><input type="checkbox" id="aQa" checked> 也采集“问大家”（最多 200 个问题）</label></span></label>
      </div></div>
      <div class="card"><h3>我们的产品（用来对比）</h3>
        <div class="pills" id="oursMode" style="margin:6px 0 12px">
          <label class="pill on"><input type="radio" name="ours" value="link" hidden checked>贴我们的链接</label>
          <label class="pill"><input type="radio" name="ours" value="manual" hidden>手动填写</label>
          <label class="pill"><input type="radio" name="ours" value="none" hidden>不对比</label></div>
        <div data-mode="link"><label class="f">我们的商品链接（也会采集我们的评价）<input id="oUrl" value="${esc(pre.oursUrl || "")}" placeholder="https://item.taobao.com/item.htm?id=..."></label></div>
        <div data-mode="manual" hidden><div class="form">
          <label class="f">产品名称<input id="oName"></label><label class="f">价格<input id="oPrice" placeholder="例如 59 元"></label>
          <label class="f wide">卖点<textarea id="oPoints" rows="2" placeholder="我们主打的卖点"></textarea></label>
          <label class="f wide">参数<textarea id="oParams" rows="2" placeholder="材质、容量、尺寸、重量……"></textarea></label>
          <label class="f wide">其他说明<textarea id="oNotes" rows="2" placeholder="和竞品的区别、我们已知的问题……"></textarea></label></div></div>
        <div data-mode="none" hidden class="muted">只分析竞品，报告里不写“我们 vs 竞品”。</div>
      </div>
      <div class="row" style="margin-top:14px"><button class="primary" data-act="submit">开始分析</button><span class="muted">采集交给淘宝采集插件，分析评价交给 ai-web（DeepSeek / Kimi 等），做的时候可以关掉这个网页。</span></div>`;
    main.querySelector("#oursMode").onchange = (e) => {
      const v = e.target.value;
      main.querySelectorAll("#oursMode .pill").forEach((p) => p.classList.toggle("on", p.querySelector("input").checked));
      main.querySelectorAll("[data-mode]").forEach((d) => (d.hidden = d.dataset.mode !== v));
    };
  }

  async function renderDetail(main, id) {
    const r = await W.api("GET", `/api/analyses/${id}`);
    const a = (cache.detail = r.analysis);
    const tasks = r.tasks;
    const done = a.stage === "done";
    const active = !["done", "failed", "stopped"].includes(a.stage);
    const fails = tasks.filter((t) => t.status === "failed");
    const waiting = tasks.filter((t) => t.status === "queued");
    main.innerHTML = `<div class="head"><div class="grow"><div class="row"><a href="#/analysis">竞品分析</a><span class="muted">›</span></div><h1>${esc(a.name)}</h1>
        <div class="row">${stagesHtml(a)}${stageTag(a.stage)}</div></div>
        <div class="sp">${done ? `<a href="/api/analyses/${a.id}/report?download=1"><button class="primary">下载 HTML 报告</button></a><a href="/api/analyses/${a.id}/report" target="_blank"><button>新窗口打开</button></a>` : ""}
          ${active ? '<button data-act="stop">停止</button>' : ""}${a.stage === "failed" || a.stage === "stopped" ? '<button class="blue" data-act="restart">重新开始</button>' : ""}
          <button data-act="dupe">再分析一次</button><button class="danger" data-act="del">删除</button></div></div>
      ${active ? `<div class="card"><div class="row"><b>${esc(a.progress && a.progress.msg || "")}</b><span class="sp muted">${waiting.length ? `排队 ${waiting.length} 个任务` : ""}</span></div>
        <div class="progress" style="margin-top:8px"><i style="width:${a.progress && a.progress.total ? Math.round((a.progress.done / a.progress.total) * 100) : 4}%"></i></div>
        ${a.stage === "collect" && !hasTaobao() ? '<div class="note warn" style="margin-top:10px">淘宝采集插件没连上，采集任务在排队等着。请打开插件“选项”，填工作台地址和口令。</div>' : ""}
        ${a.stage !== "collect" && !hasText() ? '<div class="note warn" style="margin-top:10px">没有能写文字的 AI 连着（ai-web 或 AI图图），分析任务在排队等着。</div>' : ""}
        ${tasks.some((t) => t.status === "running" && /滑块|登录/.test(t.progress || "")) ? '<div class="note bad" style="margin-top:10px">淘宝要求登录或滑块验证：请到弹出的淘宝窗口里操作，完成后自动接着采。</div>' : ""}</div>` : ""}
      ${a.error ? `<div class="note bad" style="margin-top:12px">${esc(a.error)}</div>` : ""}
      <div class="card" style="margin-top:14px"><h3>商品（每个最多 ${a.options.rates} 条评价${a.options.qa ? "，加问大家" : ""}）</h3><div class="prods">
        ${a.products.map((p) => {
          let st = p.status;
          if (st === "waiting") { const ct = tasks.find((t) => (t.key || "").endsWith(`:collect:${p.key}`)); if (ct && ct.status === "running") st = "collecting"; }
          const [t, c] = P_STATUS[st] || [st, ""];
          const ctask = st === "collecting" ? tasks.find((t) => (t.key || "").endsWith(`:collect:${p.key}`)) : null; return `<div class="prod"><span class="tag ${p.role === "ours" ? "ours" : ""}">${p.role === "ours" ? "我们" : "竞品 " + p.key.slice(1)}</span>
          <div style="min-width:0"><div class="t" title="${esc(p.title || p.url)}">${esc(p.title || p.url)}</div>${ctask && ctask.progress ? `<div class="muted">${esc(ctask.progress)}</div>` : ""}${p.url ? `<a class="muted" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url.slice(0, 70))}</a>` : ""}${p.error ? `<div class="muted" style="color:var(--bad)">${esc(p.error)}</div>` : ""}</div>
          <div class="row"><span class="tag ${c}">${t}</span>${p.counts ? `<span class="muted">评价 ${p.counts.rates} · 问大家 ${p.counts.qa}</span>` : ""}</div></div>`; }).join("")}</div></div>
      ${done ? `<div style="margin-top:14px"><iframe class="report" src="/api/analyses/${a.id}/report"></iframe></div>` : ""}
      <details class="card" style="margin-top:14px" ${fails.length ? "open" : ""}><summary><b>任务记录</b> <span class="muted">${tasks.length} 个${fails.length ? `，${fails.length} 个失败` : ""}</span></summary>
        <div class="tasklog tscroll" style="margin-top:8px"><table class="table"><thead><tr><th>任务</th><th>状态</th><th>交给</th><th>说明</th><th></th></tr></thead><tbody>
        ${tasks.map((t) => `<tr><td>${esc(t.label)}</td><td>${W.taskTag(t)}</td><td>${esc(t.siteName || "")}</td><td class="muted">${esc((t.status === "failed" ? t.error : t.progress) || "")}</td><td>${t.status === "failed" ? `<button class="sm" data-act="retryTask" data-id="${t.id}">重试</button>` : ""}</td></tr>`).join("")}
        </tbody></table></div></details>`;
  }

  W.taskTag = (t) => {
    const m = { queued: ["排队", ""], running: ["进行中", "blue"], done: ["完成", "ok"], failed: ["失败", "bad"], cancelled: ["已取消", "warn"] }[t.status] || [t.status, ""];
    return `<span class="tag ${m[1]}">${m[0]}</span>`;
  };

  // 实时更新
  W.on("analysis", (d) => {
    if (W.cur !== "analysis") return;
    if (!W.params[0] || (W.params[0] === d.id)) W.soon(W.render, 400);
  });
  W.on("task", (t) => { if (W.cur === "analysis" && W.params[0] && t.ownerId === W.params[0]) W.soon(W.render, 800); });
})();
