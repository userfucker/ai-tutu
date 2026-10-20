/**
 * 设置：改密码、磁盘、退出登录。
 */
(() => {
  W.pages.settings = {
    async render(main) {
      await W.refreshStatus();
      const d = W.status.disk;
      const gb = (n) => (n / 1073741824).toFixed(1);
      main.innerHTML = `<div class="head"><div><h1>设置</h1></div></div>
        <div class="card"><h3>磁盘</h3>${d ? `<div class="row"><span>还剩 <b>${gb(d.free)} GB</b>，共 ${gb(d.total)} GB</span></div>
          <div class="progress" style="margin-top:8px;max-width:420px"><i style="width:${Math.round(((d.total - d.free) / d.total) * 100)}%;background:${d.free < 1073741824 ? "var(--bad)" : "var(--accent)"}"></i></div>
          ${d.free < 1073741824 ? '<div class="note bad" style="margin-top:10px">磁盘快满了：删掉不要的分析和项目，或者给 Docker 扩容。</div>' : ""}` : '<span class="muted">读不到磁盘信息</span>'}</div>
        <div class="card"><h3>改管理密码</h3><div class="form" style="max-width:640px">
          <label class="f">原密码<input type="password" id="pOld" autocomplete="current-password"></label>
          <label class="f">新密码<input type="password" id="pNew" autocomplete="new-password"></label></div>
          <div class="row" style="margin-top:10px"><button class="primary" data-act="pw">修改</button></div></div>
        <div class="card"><h3>退出登录</h3><button data-act="logout">退出</button></div>
        <div class="muted" style="margin-top:14px">AI图图 工作台 v${W.esc(W.status.version)}</div>`;
    },
    act: {
      pw: async () => {
        await W.api("POST", "/api/auth/password", { old: document.getElementById("pOld").value, password: document.getElementById("pNew").value });
        W.toast("密码已修改");
        W.render();
      },
      logout: async () => { await W.api("POST", "/api/auth/logout"); location.reload(); },
    },
  };
})();
