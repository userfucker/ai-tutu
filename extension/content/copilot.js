/**
 * AI图图 · Copilot 页面自动操作（2026-10-09）
 *
 * 页面结构来自 Lee 在谷歌浏览器里用 Copilot 探测插件（0.1.2）录的报告（copilot.com；Edge 不允许插件进 Copilot）：
 *  - 输入框：[data-testid=chat-input-wrapper] 里的 span[contenteditable][role=textbox]（“向 Copilot 发送消息”）
 *  - 发送按钮：button.fai-SendButton（aria “发送”，type=submit）
 *  - 加号菜单：[data-testid=PlusMenuButton]；隐藏的文件框 input#upload-file-button（multiple，接受图片）
 *  - 拖图：拖到 [data-testid=chat-input-drag-drop-wrapper] 有效（Lee 手动拖过）
 *  - 附件：.fx-AttachmentList .fx-Attachment，删除按钮 aria “删除附件 文件名”
 *  - 每一轮对话：[data-testid=m365-chat-llm-web-ui-chat-message]（data-message-index），里面有
 *    [data-testid=chatQuestion]（我的消息）和 [data-testid=copilot-message-div]（Copilot 的回复）
 *  - 回复生成中 .fai-CopilotMessage 带 aria-busy=true，结束后去掉；生图时页面读屏提示“正在创建图像...”
 *  - 生成的图：button[aria-label="Generated image"] 里的 img（alt “Generated image”），data:image/png，实测 1536×1024
 *  - 新建聊天：顶栏 button[aria-label="新建聊天"]，或左侧 a[aria-label="新建聊天"]
 *  - 模式按钮 #gptModeSwitcher（“自动”），插件不切换
 *
 * 选择器集中写在 COP 里，Copilot 改版时只改这里。
 */
const COP = {
  input: () =>
    document.querySelector('[data-testid="chat-input-wrapper"] [contenteditable="true"][role="textbox"]') ||
    document.querySelector('[role="textbox"][contenteditable="true"][aria-label*="Copilot"]') ||
    document.querySelector('[data-testid="chat-input-wrapper"] [contenteditable="true"]'),
  sendBtn: () =>
    document.querySelector('[data-testid="chat-input-wrapper"] button.fai-SendButton') ||
    document.querySelector("button.fai-SendButton") ||
    document.querySelector('[data-testid="chat-input-wrapper"] button[type="submit"]'),
  newChatBtn: () =>
    [...document.querySelectorAll('button[aria-label="新建聊天"], a[aria-label="新建聊天"], button[aria-label="New chat"], a[aria-label="New chat"]')].find(
      (e) => e.getBoundingClientRect().width > 0,
    ),
  fileInput: () => document.querySelector("input#upload-file-button") || document.querySelector('[data-testid="chat-input-wrapper"] input[type="file"]'),
  dropZone: () => document.querySelector('[data-testid="chat-input-drag-drop-wrapper"]'),
  attachments: () => document.querySelectorAll(".fx-AttachmentList .fx-Attachment"),
  attachLoading: () =>
    document.querySelector('.fx-AttachmentList [role="progressbar"], .fx-AttachmentList .fui-Spinner, .fx-AttachmentList [aria-busy="true"]'),
  attachCloseButtons: () => document.querySelectorAll('.fx-AttachmentList button[aria-label^="删除附件"], .fx-AttachmentList button[aria-label^="Remove"]'),
  turns: () => [...document.querySelectorAll('[data-testid="m365-chat-llm-web-ui-chat-message"]')],
  reply: (turn) => turn.querySelector('[data-testid="copilot-message-div"]') || turn.querySelector(".fai-CopilotMessage"),
  modeBtn: () => document.querySelector("#gptModeSwitcher"),
};
const copSleep = siteSleep;
const copWait = siteWait;
const COP_LIMIT_RE = /上限|限制|额度|配额|稍后再试|太多|频繁|limit|quota|try again later|too many|boost/i;

const copTurnIndex = (t) => Number(t.getAttribute("data-message-index") ?? -1);
/** 现在最后一轮的序号（发送前记下，等回复时找序号更大的那一轮） */
function copMark() {
  const list = COP.turns();
  return list.length ? Math.max(...list.map(copTurnIndex)) : -1;
}
function copNewTurn(base) {
  return COP.turns().filter((t) => copTurnIndex(t) > base).pop() || null;
}
function copBusy(reply) {
  if (reply && (reply.getAttribute("aria-busy") === "true" || reply.querySelector('[aria-busy="true"]'))) return true;
  const b = COP.sendBtn();
  return /停止|stop/i.test((b && b.getAttribute("aria-label")) || "");
}
/** 页面读屏提示“正在创建图像...”（Copilot 生图时回复文字可能已经结束，靠这个判断还在画） */
function copDesignerBusy() {
  const el = document.querySelector('[data-testid="designer-loading-announcement"]');
  return !!el && /正在|creating|generating/i.test(el.textContent || "");
}
function copPageAlert() {
  if (document.querySelector('iframe[src*="captcha"], iframe[src*="challenges.cloudflare"], iframe[title*="验证"]')) return "页面出现了人机验证";
  const t = (document.body.innerText || "").slice(-4000);
  if (/unusual activity|异常活动|验证你是人类|are you a robot|verify you are human/i.test(t)) return "页面提示异常活动 / 需要验证";
  return "";
}

/** 新建聊天：点顶栏或左侧的“新建聊天”，等页面上没有对话、输入框出来 */
async function copNewChat(signal) {
  const b = COP.newChatBtn();
  if (b) b.click();
  else location.assign("/chat");
  await copWait(() => COP.input() && COP.turns().length === 0, { timeout: 15000, signal, what: "新聊天打开" });
  await copSleep(800);
}

async function copClearInput(signal) {
  const closes = [...COP.attachCloseButtons()];
  for (const b of closes) {
    b.click();
    await copSleep(200);
  }
  if (closes.length) await copWait(() => COP.attachments().length === 0, { timeout: 5000, signal, what: "清空附件" }).catch(() => {});
  const input = COP.input();
  if (input && (input.innerText || "").trim()) {
    input.focus();
    document.execCommand("selectAll");
    document.execCommand("delete");
    await copSleep(200);
  }
}

/**
 * 贴图：三种方法依次试（探测时三种都测过，哪种有效记下来，下一张直接用）：
 *  paste = 在输入框上模拟粘贴；input = 塞进隐藏的文件框；drop = 模拟拖到输入区
 */
let copUploadWay = "";
async function copPasteFiles(files, signal) {
  const input = await copWait(COP.input, { timeout: 10000, signal, what: "输入框" });
  const ways = copUploadWay ? [copUploadWay] : ["paste", "input", "drop"];
  const before = COP.attachments().length;
  let lastErr = "";
  for (const way of ways) {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    try {
      if (way === "paste") {
        input.focus();
        input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      } else if (way === "input") {
        const fi = COP.fileInput();
        if (!fi) throw new Error("没有文件框");
        fi.files = dt.files;
        fi.dispatchEvent(new Event("input", { bubbles: true }));
        fi.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        const z = COP.dropZone() || input;
        for (const t of ["dragenter", "dragover", "drop"]) z.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
      }
      await copWait(() => COP.attachments().length >= before + files.length, { timeout: way === copUploadWay ? 15000 : 5000, signal, what: "图片出现在输入框" });
      copUploadWay = way;
      await copSleep(300);
      return;
    } catch (e) {
      if (signal && signal.aborted) throw e;
      lastErr = `${way}: ${e.message}`;
      // 只贴进去一部分：清掉重来，免得重复
      if (COP.attachments().length > before) await copClearInput(signal);
    }
  }
  copUploadWay = "";
  throw new Error(`图片没能放进 Copilot 输入框（${lastErr}）`);
}

/** 填文字：先模拟粘贴纯文本（多行文字更稳），不行再用 insertText */
async function copInsertText(text, signal) {
  const input = await copWait(COP.input, { timeout: 10000, signal, what: "输入框" });
  input.focus();
  const len = () => (input.innerText || "").trim().length;
  const before = len();
  const need = Math.min(20, text.length / 2);
  const dt = new DataTransfer();
  dt.setData("text/plain", text);
  input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  await copSleep(500);
  if (len() < before + need) {
    input.focus();
    document.execCommand("insertText", false, text);
    await copSleep(400);
  }
  if (len() < before + need) throw new Error("提示词没能填进 Copilot 输入框");
}

async function copWaitReady(expected, signal) {
  await copWait(
    () => {
      const b = COP.sendBtn();
      return COP.attachments().length >= expected && !COP.attachLoading() && b && !b.disabled && b.getAttribute("aria-disabled") !== "true";
    },
    { timeout: 120000, signal, what: "图片上传完成" },
  );
  await copSleep(800);
}

function copClickSend() {
  const b = COP.sendBtn();
  if (!b || b.disabled) throw new Error("发送按钮不能点");
  b.click();
}

async function copWaitUserSend(base, signal) {
  await copWait(() => copNewTurn(base), { timeout: 0, interval: 300, signal, what: "你按发送" });
}

/** 等这一轮回复结束：出图（返回 img），或者没出图（被拒 / 只回了文字） */
async function copWaitResult(base, signal) {
  const turn = await copWait(() => copNewTurn(base), { timeout: 60000, signal, what: "Copilot 开始回复" });
  const t0 = Date.now();
  let quietSince = 0;
  let lastText = "";
  for (;;) {
    if (signal && signal.aborted) throw new Error("已停止");
    const alert = copPageAlert();
    if (alert) return { alert };
    const t = copNewTurn(base) || turn;
    const reply = COP.reply(t);
    const text = reply ? (reply.innerText || "").trim() : "";
    const imgs = reply ? [...reply.querySelectorAll('img[alt="Generated image"], button[aria-label="Generated image"] img, img')] : [];
    const img = imgs.find((i) => i.complete && i.naturalWidth >= 200);
    const busy = copBusy(reply) || (!img && copDesignerBusy());
    if (img && !busy) {
      await copSleep(800);
      return { img, text };
    }
    // 回复不再忙、也没有图、文字 8 秒没变：算没出图（Copilot 生图前会先回一句话，所以多等一会）
    if (reply && !busy && !img && text) {
      if (text !== lastText) { lastText = text; quietSince = Date.now(); }
      if (Date.now() - quietSince > 8000) return { refused: true, text };
    } else {
      quietSince = 0;
      lastText = text;
    }
    if (Date.now() - t0 > 300000) throw new Error("等待超时：Copilot 出图（5 分钟）");
    await copSleep(500);
  }
}

const copGrabImage = (img) => siteGrabImage(img, (src) => [src], "Copilot");

/** 面板（panel.js）用的统一接口（和 gemini.js 里的一样） */
const AITUTU_SITE = {
  id: "copilot",
  name: "Copilot",
  home: "copilot.com",
  input: () => COP.input(),
  mark: copMark,
  hasMessages: () => COP.turns().length > 0,
  newChat: copNewChat,
  clearInput: copClearInput,
  pasteFiles: copPasteFiles,
  insertText: copInsertText,
  waitReady: copWaitReady,
  clickSend: copClickSend,
  waitUserSend: copWaitUserSend,
  waitResult: copWaitResult,
  grabImage: copGrabImage,
  limitRe: COP_LIMIT_RE,
  // 只记录当前模式（日志里看），不切换
  currentMode: () => { const b = COP.modeBtn(); return b ? { label: "Copilot " + (b.innerText || "").trim() } : null; },
};
