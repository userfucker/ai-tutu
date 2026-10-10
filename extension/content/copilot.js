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
 * 【个人版界面】Lee 第二批报告（www.copilot.com/chats/…，2026-10-09）是另一套页面，两套都要认：
 *  - 输入框：textarea#userInput[data-testid=composer-input]（普通 textarea，React）
 *  - 发送：button[data-testid=submit-button]（“提交消息”，输入框空时换成语音按钮）
 *  - 文件框：input[data-testid=composer-file-input]；拖图到输入框有效
 *  - 附件：[data-testid=composer-content] 里的缩略图 + 删除按钮（title “移除图像 文件名”）
 *  - 回复：[data-testid=ai-message]；图：[data-testid=ai-image-message] 里的 img（data:image/png 1024×1024）
 *  - 新建聊天：button[data-testid=sidebar-new-conversation-nav-item]；主页按钮 sidebar-copilot-brand-button
 *
 * 选择器集中写在 COP 里，Copilot 改版时只改这里。
 */
const vis = (e) => !!e && e.getBoundingClientRect().width > 0;
const COP = {
  input: () =>
    document.querySelector('textarea[data-testid="composer-input"]') ||
    document.querySelector("textarea#userInput") ||
    document.querySelector('[data-testid="chat-input-wrapper"] [contenteditable="true"][role="textbox"]') ||
    document.querySelector('[role="textbox"][contenteditable="true"][aria-label*="Copilot"]') ||
    document.querySelector('[data-testid="chat-input-wrapper"] [contenteditable="true"]'),
  sendBtn: () =>
    document.querySelector('button[data-testid="submit-button"]') ||
    document.querySelector('[data-testid="chat-input-wrapper"] button.fai-SendButton') ||
    document.querySelector("button.fai-SendButton") ||
    document.querySelector('[data-testid="chat-input-wrapper"] button[type="submit"]'),
  newChatBtn: () =>
    [...document.querySelectorAll('button[data-testid="sidebar-new-conversation-nav-item"], button[aria-label="新建聊天"], a[aria-label="新建聊天"], button[aria-label="New chat"], a[aria-label="New chat"]')].find(vis),
  homeBtn: () => [...document.querySelectorAll('button[data-testid="sidebar-copilot-brand-button"]')].find(vis),
  sidebarToggle: () => document.querySelector('button[data-testid="sidebar-toggle-button"]'),
  fileInput: () =>
    document.querySelector('input[data-testid="composer-file-input"]') ||
    document.querySelector("input#upload-file-button") ||
    document.querySelector('[data-testid="chat-input-wrapper"] input[type="file"]'),
  dropZone: () => document.querySelector('[data-testid="chat-input-drag-drop-wrapper"]') || COP.input(),
  // 附件：个人版按“删除图片”按钮数，工作版按 .fx-Attachment 数
  attachCloseButtons: () =>
    document.querySelectorAll(
      '[data-testid="composer-content"] button[title^="移除"], [data-testid="composer-content"] button[aria-label^="移除"], [data-testid="composer-content"] button[aria-label^="Remove"], .fx-AttachmentList button[aria-label^="删除附件"], .fx-AttachmentList button[aria-label^="Remove"]',
    ),
  attachments: () => {
    const m365 = document.querySelectorAll(".fx-AttachmentList .fx-Attachment");
    return m365.length ? m365 : document.querySelectorAll('[data-testid="composer-content"] button[title^="移除"], [data-testid="composer-content"] button[aria-label^="移除"], [data-testid="composer-content"] button[aria-label^="Remove"]');
  },
  attachLoading: () =>
    document.querySelector(
      '.fx-AttachmentList [role="progressbar"], .fx-AttachmentList .fui-Spinner, .fx-AttachmentList [aria-busy="true"], [data-testid="composer-content"] [role="progressbar"], [data-testid="composer-content"] [aria-busy="true"]',
    ),
  // 每一轮：工作版是一整轮的容器（带序号），个人版是 Copilot 的回复
  turns: () => {
    const m365 = [...document.querySelectorAll('[data-testid="m365-chat-llm-web-ui-chat-message"]')];
    return m365.length ? m365 : [...document.querySelectorAll('[data-testid="ai-message"]')];
  },
  reply: (turn) => turn.querySelector('[data-testid="copilot-message-div"]') || turn.querySelector(".fai-CopilotMessage") || turn,
  images: (reply) => [...reply.querySelectorAll('[data-testid="ai-image-message"] picture img, [data-testid="ai-image-message"] img, img[alt="Generated image"], button[aria-label="Generated image"] img, img')],
  imagePending: (reply) => [...reply.querySelectorAll('[data-testid="ai-image-message"]')].some((m) => ![...m.querySelectorAll("img")].some((i) => i.complete && i.naturalWidth >= 200)),
  stopBtn: () => [...document.querySelectorAll('button[data-testid="stop-button"], button[aria-label*="停止"], button[aria-label*="Stop"]')].find(vis),
  modeBtn: () => document.querySelector("#gptModeSwitcher") || document.querySelector('button[data-testid^="composer-chat-mode"]'),
};
const copSleep = siteSleep;
const copWait = siteWait;
const COP_LIMIT_RE = /上限|限制|额度|配额|稍后再试|太多|频繁|limit|quota|try again later|too many|boost/i;

const copTurnIndex = (t) => Number(t.getAttribute("data-message-index") ?? NaN);
/** 发送前记一下现在有哪些轮次，等回复时找新出来的那一轮 */
function copMark() {
  const list = COP.turns();
  const idx = list.map(copTurnIndex).filter((n) => !isNaN(n));
  return { els: new Set(list), maxIdx: idx.length ? Math.max(...idx) : -1, count: list.length };
}
function copNewTurn(base) {
  const list = COP.turns();
  const last = list[list.length - 1];
  if (!last) return null;
  const i = copTurnIndex(last);
  if (!isNaN(i)) return i > base.maxIdx ? last : null; // 工作版：按序号
  return !base.els.has(last) && list.length >= base.count ? last : null; // 个人版：最后一条是新的
}
function copBusy(reply) {
  if (reply && (reply.getAttribute("aria-busy") === "true" || reply.querySelector('[aria-busy="true"]'))) return true;
  if (reply && COP.imagePending(reply)) return true; // 个人版：图片框出来了、图还没画好
  if (COP.stopBtn()) return true;
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
  let b = COP.newChatBtn() || COP.homeBtn();
  if (!b && COP.sidebarToggle()) {
    // 侧边栏收起时先展开
    COP.sidebarToggle().click();
    await copSleep(600);
    b = COP.newChatBtn() || COP.homeBtn();
  }
  if (!b) throw new Error("没找到 Copilot 的“新建聊天”按钮");
  b.click();
  await copWait(() => COP.input() && COP.turns().length === 0, { timeout: 15000, signal, what: "新聊天打开" });
  await copSleep(800);
}

const copInputLen = (el) => ((el.value ?? el.innerText) || "").trim().length;
/** 普通 textarea（个人版，React）：用原生 value 赋值 + input 事件，React 才认 */
function copSetTextarea(el, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
async function copClearInput(signal) {
  const closes = [...COP.attachCloseButtons()];
  for (const b of closes) {
    b.click();
    await copSleep(200);
  }
  if (closes.length) await copWait(() => COP.attachments().length === 0, { timeout: 5000, signal, what: "清空附件" }).catch(() => {});
  const input = COP.input();
  if (input && copInputLen(input)) {
    if (input.tagName === "TEXTAREA") copSetTextarea(input, "");
    else {
      input.focus();
      document.execCommand("selectAll");
      document.execCommand("delete");
    }
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

/** 填文字：textarea 直接赋值；可编辑区域先模拟粘贴纯文本（多行更稳），不行再用 insertText */
async function copInsertText(text, signal) {
  const input = await copWait(COP.input, { timeout: 10000, signal, what: "输入框" });
  input.focus();
  const before = copInputLen(input);
  const need = Math.min(20, text.length / 2);
  if (input.tagName === "TEXTAREA") {
    copSetTextarea(input, (input.value ? input.value + "\n" : "") + text);
    await copSleep(400);
    if (copInputLen(input) < before + need) {
      input.focus();
      document.execCommand("insertText", false, text);
      await copSleep(300);
    }
  } else {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    await copSleep(500);
    if (copInputLen(input) < before + need) {
      input.focus();
      document.execCommand("insertText", false, text);
      await copSleep(400);
    }
  }
  if (copInputLen(input) < before + need) throw new Error("提示词没能填进 Copilot 输入框");
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
    const imgs = reply ? COP.images(reply) : [];
    const img = imgs.find((i) => i.complete && i.naturalWidth >= 200);
    const busy = copBusy(reply) || (!img && copDesignerBusy());
    if (img && !busy) {
      await copSleep(800);
      return { img, text };
    }
    // 回复不再忙、也没有图、文字 10 秒没变：算没出图（Copilot 生图前会先回一句话，所以多等一会）
    if (reply && !busy && !img && text) {
      if (text !== lastText) { lastText = text; quietSince = Date.now(); }
      if (Date.now() - quietSince > 10000) return { refused: true, text };
    } else {
      quietSince = 0;
      lastText = text;
    }
    if (Date.now() - t0 > 300000) throw new Error("等待超时：Copilot 出图（5 分钟）");
    await copSleep(500);
  }
}

const copGrabImage = (img) => siteGrabImage(img, (src) => [src], "Copilot");


// ------------------------------------------------------------ 左侧会话列表：批量删除
// 来自 Lee 2026-10-10 的两份录制：
//  个人版（www.copilot.com）：每行一个 button#conversation-options-<会话id>（“View Options / 视图选项”）→
//    菜单项 button[role=menuitem]，title “Delete conversation, 标题”（中文界面是“删除…”）→
//    确认框里 title=“Delete”的按钮（另一个是“Keep”）
//  工作版（copilot.com/chat）：每行 a.fui-NavSubItem[href*="/chat/conversation/<id>"]，旁边 “更多”按钮 →
//    菜单项 [role=menuitem][aria-label=删除] → 确认框 .fui-DialogSurface 里文字“删除”的按钮（另一个是“取消”）
const DEL_RE = /^(delete|删除)/i;
const textOf = (e) => ((e && (e.getAttribute("title") || e.getAttribute("aria-label") || e.innerText)) || "").replace(/\s+/g, " ").trim();

function copListChats() {
  const out = [];
  // 个人版
  for (const b of document.querySelectorAll('button[id^="conversation-options-"]')) {
    const id = b.id.replace("conversation-options-", "");
    if (!id || out.some((x) => x.id === id)) continue;
    const row = b.closest(".cursor-pointer") || b.parentElement?.parentElement?.parentElement;
    const title = ((row && row.innerText) || "").split("\n").map((t) => t.replace(/[…⋯]+$/, "").trim()).filter(Boolean)[0] || id;
    out.push({ id, title, ui: "consumer" });
  }
  // 工作版
  for (const a of document.querySelectorAll('a[href*="/chat/conversation/"]')) {
    const m = /\/chat\/conversation\/([^?/#]+)/.exec(a.getAttribute("href") || "");
    if (!m || out.some((x) => x.id === m[1])) continue;
    const title = (a.getAttribute("aria-label") || a.innerText || m[1]).split("\n")[0].replace(/按 Tab 可访问.*$/, "").trim();
    out.push({ id: m[1], title, ui: "m365" });
  }
  return out;
}

function copChatRowParts(chat) {
  if (chat.ui === "consumer") {
    const more = document.getElementById("conversation-options-" + chat.id);
    return { more, row: more && (more.closest(".cursor-pointer") || more.parentElement) };
  }
  const a = [...document.querySelectorAll('a[href*="/chat/conversation/"]')].find((x) => (x.getAttribute("href") || "").includes(chat.id));
  const box = a && (a.closest(".fui-SplitNavItem") || a.parentElement);
  const more = box && [...box.querySelectorAll("button")].find((b) => /^(更多|more)/i.test(b.getAttribute("aria-label") || "") || b.classList.contains("fui-MenuButton"));
  return { more, row: a };
}

/** 删除一个会话：点“…/更多” → 菜单里“删除” → 确认框里“删除”，等这一行从列表里消失 */
async function copDeleteChat(chat, signal) {
  const { more } = copChatRowParts(chat);
  if (!more) throw new Error("列表里找不到这个会话（可能已经删掉了）");
  more.scrollIntoView({ block: "center" });
  more.click();
  const item = await copWait(
    () => [...document.querySelectorAll('[role="menuitem"]')].find((e) => vis(e) && (DEL_RE.test(textOf(e)) || DEL_RE.test((e.innerText || "").trim()))),
    { timeout: 5000, signal, what: "菜单里的“删除”" },
  );
  item.click();
  const confirmBtn = await copWait(
    () => {
      const dlg = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], .fui-DialogSurface, div.fixed.inset-0')].filter(vis);
      for (const d of dlg) {
        const b = [...d.querySelectorAll("button")].find((x) => vis(x) && !x.disabled && /^(delete|删除)$/i.test((x.innerText || x.getAttribute("title") || "").trim()));
        if (b) return b;
      }
      return null;
    },
    { timeout: 5000, signal, what: "确认框里的“删除”" },
  );
  confirmBtn.click();
  await copWait(() => !copListChats().some((x) => x.id === chat.id), { timeout: 15000, signal, what: "会话从列表里消失" });
}

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
  listChats: copListChats,
  deleteChat: copDeleteChat,
  // 回的是生图参数文字（如 {"orientation":"square"}）而不是图：催一次
  nudge: (text) => (/^\s*[{\[][\s\S]*"(orientation|prompt|size|aspect|image)/i.test(text) ? "请直接生成这张图片（不要回复参数或 JSON）。Please generate the image now." : ""),
  // 只记录当前模式（日志里看），不切换
  currentMode: () => { const b = COP.modeBtn(); return b ? { label: "Copilot " + ((b.innerText || "").trim() || b.title || "") } : null; },
};
