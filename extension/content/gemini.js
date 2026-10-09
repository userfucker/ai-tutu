/**
 * AI图图 · Gemini 页面自动操作（2026-10-09）
 *
 * 页面结构来自探测插件（extension-probe）在 Lee 的 Edge 上实测的两份报告：
 *  - 输入框：rich-textarea 里的 div.ql-editor[contenteditable]（“为 Gemini 输入提示”）
 *  - 贴图：在输入框上模拟粘贴（ClipboardEvent paste）有效；附件出现在 uploader-file-preview，
 *    上传中带 .loading；上传时发送按钮会转圈
 *  - 发送按钮：gem-icon-button.send-button 里的 button，生成中 aria-label 变成“停止回答”
 *  - 新建对话：侧边栏 a[href="/app"]（“发起新对话”），单页跳转，不刷新页面
 *  - 生成的图：最后一个 model-response 里 generated-image / single-image 的 img，
 *    blob: 地址、1024×1024，加载中外层有 .gem-shimmer-active，加载完 img 带 .loaded；
 *    插件可以直接 fetch(blob) 取到原图
 *
 * 选择器集中写在 GEM 里，Gemini 改版时只改这里。
 */
const GEM = {
  input: () =>
    document.querySelector('rich-textarea .ql-editor[contenteditable="true"]') ||
    document.querySelector('[contenteditable="true"][role="textbox"]'),
  sendBtn: () =>
    document.querySelector("gem-icon-button.send-button button") || document.querySelector(".send-button-container button"),
  newChatLink: () => document.querySelector('a[href="/app"]'),
  attachments: () => document.querySelectorAll("uploader-file-preview"),
  attachLoading: () => document.querySelector("uploader-file-preview .loading"),
  attachCloseButtons: () => document.querySelectorAll("uploader-file-preview .gem-attachment-close-button button, uploader-file-preview button[aria-label]"),
  responses: () => document.querySelectorAll("model-response"),
};

const gemSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 等 fn() 返回真值；超时抛错。signal.aborted 时抛 "已停止"。 */
async function gemWait(fn, { timeout = 30000, interval = 250, signal, what = "条件" } = {}) {
  const t0 = Date.now();
  for (;;) {
    if (signal && signal.aborted) throw new Error("已停止");
    const v = fn();
    if (v) return v;
    if (timeout && Date.now() - t0 > timeout) throw new Error(`等待超时：${what}`);
    await gemSleep(interval);
  }
}

function gemIsStop(btn = GEM.sendBtn()) {
  return /停止|stop/i.test((btn && btn.getAttribute("aria-label")) || "");
}
function gemSendSpinning() {
  const box = document.querySelector(".send-button-container") || document.querySelector("gem-icon-button.send-button");
  return !!(box && box.querySelector('mat-progress-spinner, [role="progressbar"], mat-spinner'));
}
function gemSendDisabled(btn = GEM.sendBtn()) {
  return !btn || btn.disabled || btn.getAttribute("aria-disabled") === "true";
}

/** 页面上有没有验证码 / 异常流量之类的提示（B 模式遇到就停） */
function gemPageAlert() {
  if (document.querySelector('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA"]')) return "页面出现了人机验证";
  const t = (document.body.innerText || "").slice(-4000);
  if (/unusual traffic|异常流量|验证您是真人|are you a robot/i.test(t)) return "页面提示异常流量 / 需要验证";
  return "";
}
/** 回复文字里像额度 / 频率限制的说法 */
const GEM_LIMIT_RE = /上限|额度|配额|稍后再试|频繁|limit|quota|try again later|too many/i;

/** 发起新对话：优先点侧边栏“发起新对话”；侧边栏收起找不到时用单页路由跳转。 */
async function gemNewChat(signal) {
  const link = GEM.newChatLink();
  if (link) link.click();
  else {
    history.pushState({}, "", "/app");
    dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  }
  await gemWait(() => GEM.input() && GEM.responses().length === 0, { timeout: 15000, signal, what: "新对话打开" });
  await gemSleep(600);
}

/** 清空输入框里的文字和附件 */
async function gemClearInput(signal) {
  const closes = [...GEM.attachCloseButtons()];
  for (const b of closes) {
    b.click();
    await gemSleep(150);
  }
  if (closes.length) await gemWait(() => GEM.attachments().length === 0, { timeout: 5000, signal, what: "清空附件" }).catch(() => {});
  const input = GEM.input();
  if (input && (input.innerText || "").trim()) {
    input.focus();
    document.execCommand("selectAll");
    document.execCommand("delete");
    await gemSleep(150);
  }
}

/** 往输入框里贴图片（一张一张模拟粘贴，每张等附件出现） */
async function gemPasteFiles(files, signal) {
  const input = await gemWait(GEM.input, { timeout: 10000, signal, what: "输入框" });
  for (const file of files) {
    const before = GEM.attachments().length;
    input.focus();
    const dt = new DataTransfer();
    dt.items.add(file);
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    await gemWait(() => GEM.attachments().length > before, { timeout: 10000, signal, what: `图片“${file.name}”出现在输入框` });
    await gemSleep(300);
  }
}

/** 往输入框里填文字（先模拟粘贴纯文本，不行再用 insertText） */
async function gemInsertText(text, signal) {
  const input = await gemWait(GEM.input, { timeout: 10000, signal, what: "输入框" });
  input.focus();
  const before = (input.innerText || "").trim().length;
  const dt = new DataTransfer();
  dt.setData("text/plain", text);
  input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  await gemSleep(400);
  if ((input.innerText || "").trim().length < before + Math.min(20, text.length / 2)) {
    input.focus();
    document.execCommand("insertText", false, text);
    await gemSleep(300);
  }
  const after = (input.innerText || "").trim().length;
  if (after < before + Math.min(20, text.length / 2)) throw new Error("提示词没能填进输入框");
}

/** 等附件都传完、发送按钮可以点（不转圈、没禁用、不是“停止”） */
async function gemWaitReady(expected, signal) {
  await gemWait(
    () => GEM.attachments().length >= expected && !GEM.attachLoading() && !gemSendSpinning() && !gemSendDisabled() && !gemIsStop(),
    { timeout: 120000, signal, what: "图片上传完成" },
  );
  await gemSleep(500);
}

function gemClickSend() {
  const b = GEM.sendBtn();
  if (!b || gemSendDisabled(b)) throw new Error("发送按钮不能点");
  b.click();
}

/** A 模式：等用户自己按回车 / 点发送 */
async function gemWaitUserSend(base, signal) {
  await gemWait(() => GEM.responses().length > base || gemIsStop(), { timeout: 0, interval: 300, signal, what: "你按发送" });
}

/**
 * 等这一轮回复结束：出图（返回 img），或者没出图（被拒 / 只回了文字）。
 * base = 发送前 model-response 的数量。
 */
async function gemWaitResult(base, signal) {
  await gemWait(() => GEM.responses().length > base || gemIsStop(), { timeout: 60000, signal, what: "Gemini 开始回复" });
  const t0 = Date.now();
  let quietSince = 0;
  for (;;) {
    if (signal && signal.aborted) throw new Error("已停止");
    const alert = gemPageAlert();
    if (alert) return { alert };
    const list = GEM.responses();
    const last = list[list.length - 1];
    const text = last ? ((last.querySelector("message-content") || last).innerText || "").trim() : "";
    const imgs = last ? [...last.querySelectorAll("generated-image img, single-image img")] : [];
    const img = imgs.find((i) => i.complete && i.naturalWidth >= 200 && !i.closest(".gem-shimmer-active"));
    const generating = gemIsStop();
    if (img && !generating) {
      await gemSleep(800);
      return { img, text };
    }
    if (!generating && list.length > base && !imgs.length) {
      // 回复已结束但没有图片：再等几秒确认（图片有时稍晚出现）
      if (!quietSince) quietSince = Date.now();
      if (Date.now() - quietSince > 5000) return { refused: true, text };
    } else {
      quietSince = 0;
    }
    if (Date.now() - t0 > 300000) throw new Error("等待超时：Gemini 出图（5 分钟）");
    await gemSleep(500);
  }
}

/** 取回生成的原图（blob: 地址直接 fetch；不行就画到画布上导出） */
async function gemGrabImage(img) {
  const src = img.currentSrc || img.src;
  try {
    const r = await fetch(src);
    const b = await r.blob();
    if (b.size > 1000) return b;
  } catch {}
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d").drawImage(img, 0, 0);
  return await new Promise((r) => c.toBlob(r, "image/png"));
}
