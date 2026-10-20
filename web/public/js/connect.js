/**
 * AI 连接：插件怎么连、现在连着哪些插件和网站、AI 分工（每种任务先交给哪个网站）。
 */
(() => {
  const esc = W.esc;
  const APP_HELP = {
    taobao: "淘宝采集插件：采集商品信息、评价、问大家（竞品分析用）",
    aiweb: "ai-web 插件：DeepSeek、智谱、Kimi、千问、豆包，写文字、分析评价",
    aitutu: "AI图图 插件：Gemini、Copilot，看图、画图（详情页用），也能写文字",
  };
  W.pages.connect = {
    async render(main) {
      await W.refreshStatus();
      const s = W.status;
      const host = location.hostname, port = location.port || "80";
      const now = Date.now();
      main.innerHTML = `<div class="head"><div><h1>AI 连接</h1><div class="muted">三个浏览器插件连上工作台以后，任务会自动交给它们去做。插件和工作台要在同一个局域网里。</div></div></div>
        <div class="card"><h3>插件怎么连</h3>
          <div class="form" style="margin-top:6px">
            <div class="f">工作台 IP<span class="copy">${esc(host)}</span></div>
            <div class="f">端口<span class="copy">${esc(port)}</span></div>
            <div class="f">插件口令<span class="row"><span class="copy">${esc(s.extToken)}</span><button class="sm" data-act="resetToken">换一个</button></span></div>
          </div>
          <div class="note" style="margin-top:10px">在每个插件的“选项”（或“设置”）里填上面三项，点“保存并连接”。
            ai-web 插件同一时间只连一个服务器：要给工作台干活就把它改成这里的地址，开 AI 会议时再改回会议中转站。
            每个 AI 网站要在浏览器里登录一次；插件会单独开窗口干活，别最小化那些窗口。</div></div>
        <div class="card"><h3>现在连着的插件</h3>
          ${s.workers.length ? s.workers.map((w) => `<div class="worker"><div class="row"><b>${esc(w.appName)}</b><span class="muted">${esc(w.name)}${w.version ? " · v" + esc(w.version) : ""} · 连上 ${W.ago(w.since)}</span></div>
            <div class="muted">${esc(APP_HELP[w.app] || "")}</div>
            <div class="sites">${w.sites.map((x) => {
              const st = s.siteStates[`${w.connId}|${x.site}`] || {};
              const cool = st.cooldownUntil > now;
              const cls = st.busy ? "busy" : cool ? "warn" : x.ready || w.app !== "aiweb" ? "ok" : "";
              const txt = st.busy ? "忙" : cool ? `暂停到 ${W.bj(st.cooldownUntil).slice(11)}（${esc(st.why || "额度 / 限流")}）` : w.app === "aiweb" && !x.open ? "没打开（用到时自动打开）" : "空闲";
              return `<span class="site"><span class="dot ${cls}"></span>${esc(x.name)} · ${txt}</span>`;
            }).join("")}</div></div>`).join("") : '<div class="empty" style="padding:24px">一个插件都没连上</div>'}
        </div>
        <div class="card"><div class="row"><h3>AI 分工</h3><span class="muted">每种任务按顺序找空闲的网站；排前面的忙、额度用完、没连上，就换下一个。取消勾选就不用这个网站。</span></div>
          <div class="roles" id="roles" style="margin-top:8px">${Object.entries(s.roleNames).map(([role, name]) => roleHtml(role, name, s)).join("")}</div>
          <div class="row" style="margin-top:10px"><button class="primary" data-act="saveRoles">保存分工</button><span class="muted">写文字的任务可以同时交给好几个网站，分析评价会快很多。</span></div></div>`;
    },
    act: {
      resetToken: async () => {
        if (!(await W.confirm("换一个插件口令？换了以后，所有插件都要在选项里填新口令重新连接。", "换口令"))) return;
        await W.api("POST", "/api/ext-token/reset");
        W.render();
      },
      up: (el) => { const it = el.closest(".it"); if (it.previousElementSibling) it.parentNode.insertBefore(it, it.previousElementSibling); },
      down: (el) => { const it = el.closest(".it"); if (it.nextElementSibling) it.parentNode.insertBefore(it.nextElementSibling, it); },
      saveRoles: async () => {
        const roles = {};
        document.querySelectorAll("#roles .role").forEach((r) => { roles[r.dataset.role] = [...r.querySelectorAll(".it")].filter((it) => it.querySelector("input").checked).map((it) => it.dataset.site); });
        await W.api("PUT", "/api/roles", { roles });
        W.toast("分工已保存");
        W.render();
      },
    },
  };
  const CAN = { text: ["deepseek", "kimi", "glm", "doubao", "qwen", "gemini", "copilot"], vision: ["gemini", "copilot"], image: ["gemini", "copilot"], collect: ["taobao"] };
  function roleHtml(role, name, s) {
    const cur = s.roles[role] || [];
    const all = [...cur, ...CAN[role].filter((x) => !cur.includes(x))];
    const online = new Set(s.workers.flatMap((w) => w.sites.map((x) => x.site)));
    return `<div class="role" data-role="${role}"><b>${esc(name)}</b><div class="lst">${all.map((site) => `<div class="it ${cur.includes(site) ? "" : "off"}" data-site="${site}">
      <input type="checkbox" ${cur.includes(site) ? "checked" : ""} onchange="this.parentNode.classList.toggle('off', !this.checked)"><span class="grow"><span class="dot ${online.has(site) ? "ok" : ""}"></span>${esc(s.siteNames[site] || site)}</span>
      <button class="sm ghost" data-act="up">↑</button><button class="sm ghost" data-act="down">↓</button></div>`).join("")}</div></div>`;
  }
  W.on("status", () => { if (W.cur === "connect") W.soon(W.render, 500); });
})();
