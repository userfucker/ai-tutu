// 启动：没登录就显示登录框
(async () => {
  try {
    const st = await (await fetch("/api/auth/state")).json();
    if (st.authed) W.start();
    else W.showLogin();
  } catch (e) {
    document.body.innerHTML = `<div style="padding:40px">连不上工作台：${W.esc(e.message)}</div>`;
  }
})();
