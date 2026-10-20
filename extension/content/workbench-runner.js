/**
 * AI图图 · 给工作台（网页版）干活（2026-10-20）
 *
 * 插件后台连着工作台（background.js），收到任务后发到这个 Gemini / Copilot 标签页：
 *   kind = "text"：发文字（可带图），等文字回复，回传文字和代码块（写文案、列提纲、翻译、分析参考图）
 *   kind = "image"：发图 + 提示词，等出图，回传图片（画背景、场景）
 * 页面操作全部用 gemini.js / copilot.js 里的 AITUTU_SITE，和右侧面板是同一套。
 * 面板正在做图时不接任务；接了任务时面板也不能开始（互相等）。
 */
(() => {
  if (window.__aitutuWbRunner) return;
  window.__aitutuWbRunner = true;
  const SITE = AITUTU_SITE;
  let busy = false;
  let abortCtl = null;
  window.__aitutuWbBusy = () => busy;

  const progress = (jobId, msg) => {
    try { chrome.runtime.sendMessage({ type: "aitutu-wb-progress", jobId, msg }, () => void chrome.runtime.lastError); } catch {}
  };
  const b64ToFile = (im) => {
    const bin = atob(im.b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], im.name || "图片.jpg", { type: im.mime || "image/jpeg" });
  };
  const blobToB64 = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });

  async function waitVisible(signal, jobId) {
    let told = false;
    while (document.visibilityState !== "visible") {
      if (signal.aborted) throw new Error("已停止");
      if (!told) { progress(jobId, `${SITE.name} 窗口被挡住或最小化了，已暂停（把它放到能看见的地方就继续）`); told = true; }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  async function run(job) {
    const signal = abortCtl.signal;
    const id = job.id;
    for (let i = 0; window.__aitutuPanelBusy && window.__aitutuPanelBusy(); i++) {
      if (signal.aborted) throw new Error("已停止");
      if (i === 0) progress(id, "右侧面板正在做图，等它做完");
      await new Promise((r) => setTimeout(r, 1500));
    }
    await waitVisible(signal, id);
    if (!SITE.input()) throw new Error(`没找到 ${SITE.name} 输入框，请确认已经登录、打开的是对话页面`);
    if (job.newChat) { progress(id, "发起新对话"); await SITE.newChat(signal); }
    if (job.model && SITE.ensureMode) {
      try { await SITE.ensureMode(job.model, null, signal); } catch (e) { if (signal.aborted) throw e; progress(id, "⚠ 模型没切成：" + e.message); }
    }
    const files = (job.images || []).map(b64ToFile);
    await SITE.clearInput(signal);
    if (files.length) { progress(id, `贴图 ${files.length} 张`); await SITE.pasteFiles(files, signal); }
    progress(id, "填提示词");
    await SITE.insertText(job.prompt, signal);
    await SITE.waitReady(files.length, signal);
    const base = SITE.mark();
    SITE.clickSend();
    if (SITE.verifySent && files.length) await SITE.verifySent(base, files.length, signal);
    const model = SITE.currentMode ? SITE.currentMode()?.label || "" : "";

    if (job.kind === "text") {
      progress(id, `等 ${SITE.name} 回复`);
      const r = await SITE.waitText(base, signal);
      if (r.alert) return { ok: false, stop: true, error: r.alert };
      return { ok: true, text: r.text, codes: r.codes || [], model };
    }

    progress(id, `等 ${SITE.name} 出图`);
    let r = await SITE.waitResult(base, signal);
    if (!r.alert && r.refused) {
      const nudge = (SITE.nudge && SITE.nudge(r.text || "")) || "请直接生成这张图片，不要只回复文字。Please generate the image now.";
      progress(id, `没出图，只回了：${(r.text || "").slice(0, 50)}；再催一次`);
      await SITE.clearInput(signal);
      await SITE.insertText(nudge, signal);
      await SITE.waitReady(0, signal);
      const base2 = SITE.mark();
      SITE.clickSend();
      r = await SITE.waitResult(base2, signal, base);
    }
    if (r.alert) return { ok: false, stop: true, error: r.alert };
    if (r.refused) {
      const limit = SITE.limitRe.test(r.text || "");
      return { ok: false, refused: true, limit, stop: limit, error: limit ? `${SITE.name} 提示额度 / 频率限制` : `${SITE.name} 没有出图`, text: r.text || "" };
    }
    progress(id, "收图");
    const blob = await SITE.grabImage(r.img);
    return { ok: true, b64: await blobToB64(blob), mime: blob.type || "image/png", text: r.text || "", model };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("aitutu-wb-")) return false;
    if (msg.type === "aitutu-wb-ping") {
      sendResponse({ ok: true, site: SITE.id, name: SITE.name, busy, panelBusy: !!(window.__aitutuPanelBusy && window.__aitutuPanelBusy()), ready: !!SITE.input(), visible: document.visibilityState === "visible", model: SITE.currentMode ? SITE.currentMode()?.label || "" : "" });
      return false;
    }
    if (msg.type === "aitutu-wb-stop") {
      if (abortCtl) abortCtl.abort();
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type !== "aitutu-wb-run" || !msg.job) return false;
    if (busy) { sendResponse({ ok: false, error: "上一个任务还没做完" }); return false; }
    busy = true;
    abortCtl = new AbortController();
    run(msg.job)
      .then((r) => sendResponse(r), (e) => sendResponse({ ok: false, error: String((e && e.message) || e), stopped: abortCtl.signal.aborted }))
      .finally(() => { busy = false; });
    return true;
  });
})();
