/**
 * 详情页 · 启动：读设置，打开上次的项目（或者网址里 #p=项目编号 指定的），接收服务器推送的项目变化。
 */
(async () => {
  await APP.loadSettings();
  APP.renderAi();

  // 服务器推送：项目变了（全自动的进度、别处的修改）
  try {
    const es = new EventSource("/api/events");
    es.addEventListener("project", (e) => { try { APP.onProjectEvent(JSON.parse(e.data)); } catch (err) { console.error(err); } });
  } catch {}

  const m = /#p=([\w-]+)/.exec(location.hash);
  if (m) { history.replaceState(null, "", location.pathname); return APP.open(m[1]); }
  let step = "home";
  try { step = localStorage.getItem("studioStep") || "home"; } catch {}
  const last = APP.settings.lastProject && step !== "home" && (await ST.db.getProject(APP.settings.lastProject));
  if (last) APP.open(last.id, step);
  else APP.go("home");
})().catch((e) => { console.error(e); document.getElementById("main").innerHTML = `<div class="note warn">详情页启动出错：${ST.esc(e.message)}</div>`; });
