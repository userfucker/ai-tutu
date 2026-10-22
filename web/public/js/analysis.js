/**
 * 竞品分析：列表、新建（贴链接）、进度和报告。
 */
(() => {
  const esc = W.esc;
  const STAGES = [["collect", "采集"], ["tag", "分析评价和详情页"], ["vocab", "合并标签"], ["stats", "统计"], ["write", "写结论"], ["report", "出报告"]];
  const STAGE_TEXT = { collect: "采集中", tag: "分析评价和详情页", vocab: "合并标签", stats: "统计中", write: "写结论", report: "出报告", done: "已完成", failed: "失败", stopped: "已停止" };
  const P_STATUS = { waiting: ["排队", ""], collecting: ["采集中", "blue"], collected: ["已采集", "ok"], failed: ["没采到", "bad"], manual: ["手动填写", "ours"] };
  const stageTag = (s) => `<span class="tag ${s === "done" ? "ok" : s === "failed" ? "bad" : s === "stopped" ? "warn" : "blue"}">${STAGE_TEXT[s] || s}</span>`;
  let rateOptions = [100, 200, 300, 500, 800, 1000];
  let batchOptions = [50, 100, 200];
  let modList = [], lastMods = null, maxProducts = 3;
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
      batchOptions = r.batchOptions || batchOptions;
      modList = r.mods || modList; lastMods = r.lastMods; maxProducts = r.maxProducts || maxProducts;
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
          name: v("aName").trim(), links: v("aLinks"), rates: +v("aRates"), batch: +v("aBatch"),
          mods: [...m.querySelectorAll("[data-mod]:checked")].map((x) => x.dataset.mod),
          oursUrl: mode === "link" ? v("oUrl") : "",
          oursManual: mode === "manual" ? { name: v("oName"), price: v("oPrice"), points: v("oPoints"), params: v("oParams"), notes: v("oNotes") } : null,
          oursDesc: [],
        };
        if (!body.mods.length) return W.toast("至少勾一个模块", true);
        el.disabled = true;
        // 我们的详情页图片（手动填写时可以上传）：按文件名排序
        const files = mode === "manual" ? [...(m.querySelector("#oDesc").files || [])].sort((a, b) => a.name.localeCompare(b.name, "zh", { numeric: true })).slice(0, 40) : [];
        for (const f of files) body.oursDesc.push({ name: f.name, mime: f.type, b64: await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(f); }) });
        try {
          const r = await W.api("POST", "/api/analyses", body);
          W.toast(r.dropped && r.dropped.length ? `已开始。最多 ${maxProducts} 个商品（含我们的），后面 ${r.dropped.length} 个链接没分析` : "已开始：插件会一个一个采集", r.dropped && r.dropped.length);
          W.go(`#/analysis/${r.id}`);
        } catch (e) { W.toast(e.message, true); el.disabled = false; }
      },
      modsAll: () => document.querySelectorAll("[data-mod]").forEach((x) => (x.checked = true)),
      modsNone: () => document.querySelectorAll("[data-mod]").forEach((x) => (x.checked = false)),
      stop: async () => { if (await W.confirm("停止这个分析？已经做完的部分会保留，之后可以“重新开始”接着做。", "停止")) { await W.api("POST", `/api/analyses/${W.params[0]}/stop`); W.render(); } },
      restart: async () => { await W.api("POST", `/api/analyses/${W.params[0]}/restart`); W.toast("接着做：没做完和失败的部分会重新排队"); W.render(); },
      del: async () => { if (await W.confirm("删除这个分析和报告？不能恢复。", "删除", true)) { await W.api("DELETE", `/api/analyses/${W.params[0]}`); W.go("#/analysis"); } },
      rewrite: async () => { await W.api("POST", `/api/analyses/${W.params[0]}/rewrite`); W.toast("报告已按新样式重新生成"); W.render(); },
      retryTask: async (el) => { await W.api("POST", `/api/tasks/${el.dataset.id}/retry`); W.toast("已重新排队"); },
      dupe: async () => {
        const a = cache.detail;
        sessionStorage.setItem("aitutuDupe", JSON.stringify({ name: a.name + "（重新分析）", links: a.products.filter((p) => p.role === "rival").map((p) => p.url).join("\n"), oursUrl: (a.products.find((p) => p.role === "ours" && p.url) || {}).url || "", rates: a.options.rates, batch: a.options.batch, mods: a.options.mods }));
        W.go("#/analysis/new");
      },
    },
  };

  /** 每一步交给哪些 AI（在“AI 连接 → AI 分工”里改） */
  function modsHtml() {
    const s = W.status;
    if (!s || !s.modules) return "";
    const online = new Set(s.workers.flatMap((w) => w.sites.map((x) => x.site)));
    const rows = Object.entries(s.modules).filter(([, m]) => m.group === "竞品分析").map(([k, m]) => {
      const list = (s.roles[k] || []).map((x) => `<span class="${online.has(x) ? "" : "muted"}">${esc(s.siteNames[x] || x)}</span>`).join(" → ");
      return `<div class="row"><b style="min-width:9em">${esc(m.name)}</b><span>${list || '<span style="color:var(--bad)">一个都没选</span>'}</span>${s.follows[k] ? `<span class="muted">（跟“${esc(String(s.roleNames[m.follow] || "").replace(/（.*$/, ""))}”一样）</span>` : ""}</div>`;
    }).join("");
    return `<div class="card"><div class="row"><h3>每一步交给哪些 AI</h3><span class="muted">按顺序找空闲的；灰色的是现在没连上的</span><a class="sp" href="#/connect">去修改</a></div><div class="col" style="margin-top:8px;gap:4px">${rows}</div></div>`;
  }

  async function renderNew(main) {
    if (!modList.length) {
      const r = await W.api("GET", "/api/analyses");
      rateOptions = r.rateOptions || rateOptions; batchOptions = r.batchOptions || batchOptions;
      modList = r.mods || modList; lastMods = r.lastMods; maxProducts = r.maxProducts || maxProducts;
    }
    let pre = {};
    try { pre = JSON.parse(sessionStorage.getItem("aitutuDupe") || "{}"); sessionStorage.removeItem("aitutuDupe"); } catch {}
    main.innerHTML = `<div class="head"><div><h1>新建竞品分析</h1><div class="muted">现在只支持淘宝和天猫的链接，其他平台以后补充。</div></div><div class="sp"><button data-act="back" onclick="history.back()">返回</button></div></div>
      <div class="card"><div class="form">
        <label class="f wide">名称（可以不填）<input id="aName" value="${esc(pre.name || "")}" placeholder="例如：保温杯竞品 10 月"></label>
        <label class="f wide">竞品链接（一行一个；加上我们的最多 ${maxProducts} 个商品，多出来的不分析）<span class="muted" id="aLimit"></span><textarea id="aLinks" rows="4" placeholder="https://item.taobao.com/item.htm?id=...&#10;https://detail.tmall.com/item.htm?id=...">${esc(pre.links || "")}</textarea></label>
        <label class="f">每个商品采集多少条评价（按时间，最新的优先）<select id="aRates">${rateOptions.map((n) => `<option value="${n}" ${n === (pre.rates || 300) ? "selected" : ""}>${n} 条</option>`).join("")}</select></label>
        <label class="f">评价打标签每轮几条（越多轮数越少，但 AI 一次要处理的越多）<select id="aBatch">${batchOptions.map((n) => `<option value="${n}" ${n === (pre.batch || 100) ? "selected" : ""}>每轮 ${n} 条</option>`).join("")}</select></label>

      </div></div>
      <div class="card"><div class="row"><h3>报告里要哪些模块</h3><span class="muted">没勾的不采集、不分析、不显示；会记住这次的选择</span><span class="sp row"><button class="sm" data-act="modsAll">全选</button><button class="sm" data-act="modsNone">全不选</button></span></div>
        <div class="modgrid">${modList.map(([k, n]) => `<label class="row"><input type="checkbox" data-mod="${k}" ${(pre.mods || lastMods || modList.map((x) => x[0])).includes(k) ? "checked" : ""}> ${esc(n)}</label>`).join("")}</div>
        <div class="muted" style="margin-top:6px">标题、主图、属性对比、问大家、详情页会多一些 AI 任务；主图和详情页交给“看图”的 AI（AI 连接里可以指定）。</div></div>
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
          <label class="f wide">其他说明<textarea id="oNotes" rows="2" placeholder="和竞品的区别、我们已知的问题……"></textarea></label>
          <label class="f wide">我们的详情页图片（可以多选，按文件名排顺序；不传就不分析我们的详情页）<input type="file" id="oDesc" accept="image/*" multiple></label></div></div>
        <div data-mode="none" hidden class="muted">只分析竞品，报告里不写“我们 vs 竞品”。</div>
      </div>
      ${modsHtml()}
      <div class="row" style="margin-top:14px"><button class="primary" data-act="submit">开始分析</button><span class="muted">采集交给淘宝采集插件，分析评价交给 ai-web（DeepSeek / Kimi 等），读详情页按“AI 连接”里“看详情图”的顺序（国产优先），做的时候可以关掉这个网页。</span></div>`;
    const limitHint = () => {
      const n = (main.querySelector("#aLinks").value.match(/https?:\/\/\S*(taobao|tmall|tb\.cn)\S*/gi) || []).length;
      const mode = main.querySelector("input[name=ours]:checked").value;
      const keep = maxProducts - (mode === "none" ? 0 : 1);
      main.querySelector("#aLimit").innerHTML = n > keep ? ` <b style="color:var(--bad)">现在 ${n} 个竞品，只分析前 ${keep} 个</b>` : "";
    };
    main.querySelector("#aLinks").oninput = limitHint;
    main.addEventListener("change", limitHint);
    limitHint();
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
        <div class="sp">${done ? `<a href="/api/analyses/${a.id}/report?download=1"><button class="primary">下载 HTML 报告</button></a><a href="/api/analyses/${a.id}/report" target="_blank"><button>新窗口打开</button></a><button data-act="rewrite" title="用已经分析好的数据，按新的页面样式重新生成报告（不重新采集、不重新问 AI）">重新生成报告</button>` : ""}
          ${active ? '<button data-act="stop">停止</button>' : ""}${a.stage === "failed" || a.stage === "stopped" ? '<button class="blue" data-act="restart">重新开始</button>' : ""}
          <button data-act="dupe">再分析一次</button><button class="danger" data-act="del">删除</button></div></div>
      ${active ? `<div class="card"><div class="row"><b>${esc(a.progress && a.progress.msg || "")}</b><span class="sp muted">${waiting.length ? `排队 ${waiting.length} 个任务` : ""}</span></div>
        <div class="progress" style="margin-top:8px"><i style="width:${a.progress && a.progress.total ? Math.round((a.progress.done / a.progress.total) * 100) : 4}%"></i></div>
        ${a.stage === "collect" && !hasTaobao() ? '<div class="note warn" style="margin-top:10px">淘宝采集插件没连上，采集任务在排队等着。请打开插件“选项”，填工作台地址和口令。</div>' : ""}
        ${a.stage !== "collect" && !hasText() ? '<div class="note warn" style="margin-top:10px">没有能写文字的 AI 连着（ai-web 或 AI图图），分析任务在排队等着。</div>' : ""}
        ${[...new Set(waiting.map((t) => t.progress || "").filter((m) => /^等待：/.test(m)))].map((m) => `<div class="note warn" style="margin-top:10px">${esc(m)}</div>`).join("")}
        ${tasks.some((t) => t.status === "running" && /滑块|登录/.test(t.progress || "")) ? '<div class="note bad" style="margin-top:10px">淘宝要求登录或滑块验证：请到弹出的淘宝窗口里操作，完成后自动接着采。</div>' : ""}</div>` : ""}
      ${a.error ? `<div class="note bad" style="margin-top:12px">${esc(a.error)}</div>` : ""}
      <details class="card" style="margin-top:14px" ${done ? "" : "open"}><summary><b>商品（每个最多 ${a.options.rates} 条评价${a.options.qa ? "，加问大家" : ""}${a.options.desc ? "，读详情页" : ""}）</b> <span class="muted">${a.products.length} 个${done ? "，点开看" : ""}</span></summary><div class="prods" style="margin-top:8px">
        ${a.products.map((p) => {
          let st = p.status;
          if (st === "waiting") { const ct = tasks.find((t) => (t.key || "").endsWith(`:collect:${p.key}`)); if (ct && ct.status === "running") st = "collecting"; }
          const [t, c] = P_STATUS[st] || [st, ""];
          const ctask = st === "collecting" ? tasks.find((t) => (t.key || "").endsWith(`:collect:${p.key}`)) : null; return `<div class="prod"><span class="tag ${p.role === "ours" ? "ours" : ""}">${p.role === "ours" ? "我们" : "竞品 " + p.key.slice(1)}</span>
          <div style="min-width:0"><div class="t" title="${esc(p.title || p.url)}">${esc(p.title || p.url)}</div>${ctask && ctask.progress ? `<div class="muted">${esc(ctask.progress)}</div>` : ""}${p.url ? `<a class="muted" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url.slice(0, 70))}</a>` : ""}${p.error ? `<div class="muted" style="color:var(--bad)">${esc(p.error)}</div>` : ""}${p.descState ? (p.descState.error ? `<div class="muted" style="color:var(--warn)">详情页：${esc(p.descState.error)}</div>` : `<div class="muted" style="color:var(--ok)">详情页：已读（${p.descState.images} 张图）</div>`) : ""}</div>
          <div class="row"><span class="tag ${c}">${t}</span>${p.counts ? `<span class="muted">评价 ${p.counts.rates} · 问大家 ${p.counts.qa}${p.counts.desc !== undefined ? ` · 详情图 ${p.counts.desc}` : ""}</span>` : ""}</div></div>`; }).join("")}</div></details>
      ${done ? `<div style="margin-top:14px"><iframe class="report" id="reportFrame" scrolling="no" src="/api/analyses/${a.id}/report"></iframe></div>` : ""}
      <details class="card" style="margin-top:14px" open><summary><b>任务记录</b> <span class="muted">${tasks.length} 个${fails.length ? `，${fails.length} 个失败` : ""}</span></summary>
        <div class="tasklog tscroll" style="margin-top:8px"><table class="table"><thead><tr><th>任务</th><th>状态</th><th>交给</th><th>说明</th><th></th></tr></thead><tbody>
        ${tasks.map((t) => `<tr><td>${esc(t.label)}</td><td>${W.taskTag(t)}</td><td>${esc(t.siteName || "")}</td><td class="muted">${esc((t.status === "failed" ? t.error : t.progress) || "")}</td><td>${t.status === "failed" ? `<button class="sm" data-act="retryTask" data-id="${t.id}">重试</button>` : ""}</td></tr>`).join("")}
        </tbody></table></div></details>`;
    // 报告按内容的高度完全展开，整页一起滚动（不在小框里滚）
    const fr = main.querySelector("#reportFrame");
    if (fr) {
      const fit = () => { try { const d = fr.contentDocument; if (d && d.body) fr.style.height = Math.max(400, d.documentElement.scrollHeight) + "px"; } catch {} };
      fr.onload = () => { fit(); try { new ResizeObserver(fit).observe(fr.contentDocument.body); fr.contentDocument.addEventListener("toggle", fit, true); } catch {} setTimeout(fit, 500); };
    }
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
