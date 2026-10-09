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
  // 模型（模式）选择器：Lee 2026-10-09 探测报告
  //  按钮 data-testid=bard-mode-menu-button，aria “打开模式选择器，当前模式为“Flash””，文字 Flash / Pro / Flash-Lite / Flash-Lite 扩展
  //  菜单项 gem-menu-item[role=menuitem]，文字如 “3.1 Pro 高级推理”“3.5 Flash-Lite 极速回答”“扩展思考 擅长解决复杂问题”（开关项）
  modeBtn: () => document.querySelector('button[data-testid="bard-mode-menu-button"]'),
  modeItems: () => [...document.querySelectorAll('gem-menu-item[role="menuitem"], .cdk-overlay-container [role="menuitem"]')].filter((e) => e.getBoundingClientRect().width > 0),
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

/** 当前模型，例如 { family: "Flash", extended: false, label: "Flash" }；找不到选择器返回 null */
function gemCurrentMode() {
  const b = GEM.modeBtn();
  if (!b) return null;
  const m = /“([^”]+)”|"([^"]+)"/.exec(b.getAttribute("aria-label") || "");
  const label = ((m && (m[1] || m[2])) || b.innerText || "").replace(/\s+/g, " ").trim();
  const extended = /扩展|extended/i.test(label);
  const family = /lite/i.test(label) ? "Flash-Lite" : /pro/i.test(label) ? "Pro" : /flash/i.test(label) ? "Flash" : label.replace(/\s*(扩展|extended)\s*/i, "");
  return { family, extended, label };
}
const gemFamilyOf = (text) => (/lite/i.test(text) ? "Flash-Lite" : /\bpro\b/i.test(text) ? "Pro" : /flash/i.test(text) ? "Flash" : "");
async function gemOpenModeMenu(signal) {
  const b = GEM.modeBtn();
  if (!b) throw new Error("没找到 Gemini 的模型选择按钮");
  b.click();
  return await gemWait(() => (GEM.modeItems().length ? GEM.modeItems() : null), { timeout: 5000, signal, what: "模型菜单打开" });
}
async function gemCloseMenu() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
  const bd = document.querySelector(".cdk-overlay-backdrop");
  if (bd) bd.click();
  await gemSleep(250);
  if (GEM.modeItems().length && GEM.modeBtn()) GEM.modeBtn().click(); // 还开着就再点一下按钮收起
  await gemSleep(150);
}
/**
 * 切换模型。family = "Flash" | "Pro" | "Flash-Lite" | ""（不管）；extended = true / false / null（不管）。
 * 返回切换后的 gemCurrentMode()，菜单里找不到对应项时抛错。
 */
async function gemEnsureMode(family, extended, signal) {
  let cur = gemCurrentMode();
  if (!cur) throw new Error("没找到 Gemini 的模型选择按钮（可能改版了）");
  if (family && cur.family !== family) {
    const items = await gemOpenModeMenu(signal);
    const item = items.find((e) => gemFamilyOf(e.innerText || "") === family && !/扩展思考|extended thinking/i.test(e.innerText || ""));
    if (!item) {
      const names = items.map((e) => (e.innerText || "").replace(/\s+/g, " ").trim()).join(" / ");
      await gemCloseMenu();
      throw new Error(`模型菜单里没找到 ${family}（菜单里有：${names}）`);
    }
    item.click();
    await gemWait(() => gemCurrentMode()?.family === family, { timeout: 5000, signal, what: `切换到 ${family}` });
    await gemSleep(400);
    cur = gemCurrentMode();
  }
  if (extended !== null && extended !== undefined && cur.extended !== extended) {
    const items = await gemOpenModeMenu(signal);
    const item = items.find((e) => /扩展思考|extended thinking/i.test(e.innerText || ""));
    if (!item) {
      await gemCloseMenu();
      throw new Error("模型菜单里没找到“扩展思考”（当前模型可能不支持）");
    }
    item.click();
    await gemWait(() => gemCurrentMode()?.extended === extended, { timeout: 5000, signal, what: extended ? "打开扩展思考" : "关闭扩展思考" });
    await gemSleep(400);
    cur = gemCurrentMode();
  }
  if (GEM.modeItems().length) await gemCloseMenu();
  return cur;
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

/**
 * 取回生成的原图。
 *  - blob: / data: 地址（3.8 Flash 实测是 blob:）：网页里直接 fetch。
 *  - https: 地址（3.1 Pro 实测出的图是网络地址，在 googleusercontent 上）：网页里 fetch 会被跨域挡住，
 *    画到画布上也导不出来（“Tainted canvases”），所以交给插件后台去取（后台有这些网站的权限）。
 *    googleusercontent 的地址结尾带尺寸参数（如 =s1024-rj），先试 =s0（原始尺寸），不行再用页面上的地址。
 */
function gemFullSizeUrls(src) {
  const list = [];
  try {
    const u = new URL(src);
    if (/googleusercontent\.com$/.test(u.hostname)) {
      const base = src.replace(/=[a-z0-9-]*$/i, "");
      list.push(base + "=s0");
    }
  } catch {}
  list.push(src);
  return [...new Set(list)];
}
function gemBgFetch(url) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "aitutu-fetch-image", url }, (res) => {
        if (chrome.runtime.lastError || !res || !res.ok) return resolve({ error: (res && res.error) || chrome.runtime.lastError?.message || "后台没有回复" });
        const bin = atob(res.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        resolve({ blob: new Blob([bytes], { type: res.type || "image/png" }) });
      });
    } catch (e) {
      resolve({ error: String(e.message || e) });
    }
  });
}
async function gemIsImage(blob) {
  if (!blob || blob.size < 1000) return false;
  try { const bm = await createImageBitmap(blob); bm.close(); return true; } catch { return false; }
}
async function gemGrabImage(img) {
  const src = img.currentSrc || img.src;
  const errors = [];
  if (/^https?:/.test(src)) {
    for (const url of gemFullSizeUrls(src)) {
      const r = await gemBgFetch(url);
      if (r.blob && (await gemIsImage(r.blob))) return r.blob;
      errors.push(`后台取图：${r.error || "拿到的不是图片"}`);
    }
  }
  try {
    const r = await fetch(src, { credentials: "include" });
    const b = await r.blob();
    if (await gemIsImage(b)) return b;
    errors.push(`网页取图：HTTP ${r.status}，${b.size} 字节`);
  } catch (e) {
    errors.push(`网页取图：${e.message || e}`);
  }
  try {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    return await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("画布导出为空"))), "image/png"));
  } catch (e) {
    errors.push(`画布取图：${e.message || e}`);
  }
  const kind = src.startsWith("blob:") ? "blob" : src.split("/")[2] || src.slice(0, 20);
  throw new Error(`取不到 Gemini 生成的图（图片地址类型：${kind}）。${errors.join("；")}`);
}
