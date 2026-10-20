/**
 * 详情页工作室 · 启动：读设置，打开上次的项目，接收面板带过来的图片。
 */
(async () => {
  await APP.loadSettings();
  APP.renderAi();

  /** 面板上点“做详情页”带过来的图 */
  async function takePending() {
    const r = await new Promise((res) => chrome.runtime.sendMessage({ type: "aitutu-studio-take-pending" }, (x) => { void chrome.runtime.lastError; res(x); }));
    const list = (r && r.images) || [];
    if (!list.length) return;
    const files = list.map((im) => new File([ST.b64ToBlob(im.b64, im.mime || "image/jpeg")], im.name || "图片.jpg", { type: im.mime || "image/jpeg" }));
    if (!APP.project) {
      APP.project = APP.newProject();
      await APP.save(true);
    }
    const n = await APP.addAssetFiles(files);
    APP.toast(`收到面板带过来的 ${n} 张图，已加到“② 素材”`);
    APP.go(APP.project.screens.length ? "assets" : APP.project.assets.length > n ? "assets" : "setup");
  }
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg && msg.type === "aitutu-studio-where") {
      chrome.tabs.getCurrent((t) => {
        sendResponse(t ? { tabId: t.id, windowId: t.windowId } : null);
        if (t && msg.pending) setTimeout(takePending, 300);
      });
      return true;
    }
    return false;
  });

  let step = "home";
  try { step = localStorage.getItem("studioStep") || "home"; } catch {}
  const last = APP.settings.lastProject && (await ST.db.getProject(APP.settings.lastProject));
  if (last && step !== "home") { APP.project = last; APP.step = step; APP.render(); }
  else APP.go("home");
  if (location.hash === "#import") { history.replaceState(null, "", location.pathname); await takePending(); }
})().catch((e) => { console.error(e); document.getElementById("main").innerHTML = `<div class="note warn">工作室启动出错：${ST.esc(e.message)}</div>`; });
