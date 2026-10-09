/**
 * AI图图 · Gemini 电商作图助手：右侧面板（2026-10-09）
 *
 * 在 Gemini 页面右侧放一个可以左右收起的面板：上传 / 粘贴多张产品图，框选、标注配件、取色，
 * 选处理模式和参数，然后一批一批交给 Gemini 网页版生成（A：插件填好你按回车；B：插件自动发送），
 * 收回 1024 原图，用共用的 imagekit.js 做主体校准 / 抠透明底 / 调色 / 缩放，单张下载或打包 zip。
 * 页面自动操作在 content/gemini.js。
 */
(() => {
  if (window.__aitutuPanel) return;
  window.__aitutuPanel = true;
  const VERSION = "0.1.2";

  // ------------------------------------------------------------ 设置
  const MODES = {
    white: { label: "抠白底图 1:1", locks: { ratio: "1:1", background: "white" }, outSizes: ["800", "1024"], formats: ["jpeg", "png-alpha"] },
    refine: { label: "图片精修", locks: { ratio: "auto", background: "original", fill: "keep", angle: "keep", retouch: "on", format: "jpeg" }, outSizes: ["original", "800", "1024"], formats: ["jpeg"] },
    free: { label: "自由模式", locks: {}, outSizes: ["800", "1024", "original"], formats: ["jpeg", "png", "png-alpha"] },
  };
  const DEFAULTS = {
    mode: "white", ratio: "1:1", background: "white", outSize: "800", format: "jpeg", fill: "85", angle: "keep",
    retouch: "on", sharp: "keep", contrast: "0", bright: "0", requirement: "",
    batchSize: 10, session: "new", everyN: 5, send: "B", model: "Flash", extended: "any",
  };
  const LABELS = {
    outSize: { 800: "800×800", 1024: "1K（1024）", original: "AI 原尺寸" },
    format: { jpeg: "JPG", png: "PNG", "png-alpha": "PNG 透明底" },
  };
  let S = { ...DEFAULTS };
  const saveSettings = () => { try { chrome.storage.local.set({ aitutuSettings: S }); } catch {} };

  // ------------------------------------------------------------ 状态
  let files = []; // {id,name,size,type,dataUrl,base64,w,h,crop,mask,parts,partsNote,colors,sampler,done}
  let jobs = []; // {id,file,status,steps[],aiUrl,outBlob,outUrl,w,h,note,text,error,startedAt,endedAt}
  let nextId = 1;
  let running = false;
  let abortCtl = null;
  let panelActive = false;
  let sessionCount = 0; // 当前对话里已经做了几张

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const bj = (ms = Date.now()) => {
    const d = new Date(ms + 8 * 3600 * 1000);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  };

  // ------------------------------------------------------------ 界面
  const host = document.createElement("div");
  host.id = "aitutu-panel-host";
  host.style.cssText = "position:fixed;top:0;right:0;height:100vh;z-index:2147483000;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  .wrap { position: fixed; top: 0; right: 0; height: 100vh; width: 440px; transition: transform .2s ease; font: 13px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; color: #18181b; }
  .wrap.closed { transform: translateX(100%); }
  .handle { position: absolute; left: -30px; top: 40%; width: 30px; padding: 12px 0; background: #18181b; color: #fff; border-radius: 10px 0 0 10px; cursor: pointer;
    text-align: center; font-weight: 600; line-height: 1.35; white-space: nowrap; box-shadow: -2px 2px 10px rgba(0,0,0,.2); user-select: none; }
  .panel { height: 100%; overflow-y: auto; background: #f4f4f5; border-left: 1px solid #d4d4d8; box-shadow: -6px 0 24px rgba(0,0,0,.12); padding: 12px; }
  .card { background: #fff; border: 1px solid #e4e4e7; border-radius: 14px; padding: 12px; margin-bottom: 10px; }
  h2 { font-size: 16px; margin: 0; }
  .muted { color: #71717a; font-size: 12px; }
  .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .modes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .modes button { padding: 8px 4px; }
  .modes button.active, .seg button.active { background: #18181b; color: #fff; border-color: #18181b; }
  button { border: 1px solid #d4d4d8; background: #fff; color: #18181b; border-radius: 10px; padding: 5px 10px; font: inherit; cursor: pointer; }
  button:hover { background: #f4f4f5; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  button.primary { background: #18181b; color: #fff; border-color: #18181b; font-weight: 600; padding: 9px; }
  button.danger { color: #b91c1c; }
  .drop { border: 2px dashed #d4d4d8; border-radius: 12px; padding: 14px; text-align: center; cursor: pointer; color: #52525b; }
  .drop.over { background: #f4f4f5; border-color: #71717a; }
  .thumbs { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-top: 8px; }
  .thumb { position: relative; border-radius: 8px; overflow: hidden; border: 1px solid #e4e4e7; cursor: pointer; background: #f4f4f5; }
  .thumb img { width: 100%; height: 100%; object-fit: fill; display: block; }
  .thumb .x { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border-radius: 50%; border: 0; padding: 0; background: rgba(0,0,0,.6); color: #fff; font-size: 11px; line-height: 18px; }
  .thumb .badge { position: absolute; left: 2px; bottom: 2px; right: 2px; font-size: 9px; background: rgba(220,252,231,.95); color: #15803d; border-radius: 4px; padding: 0 3px; white-space: nowrap; overflow: hidden; }
  .thumb .box { position: absolute; border: 2px solid #22c55e; pointer-events: none; }
  .thumb.done::after { content: "✓"; position: absolute; top: 2px; left: 4px; color: #15803d; font-weight: 700; text-shadow: 0 0 2px #fff; }
  textarea, input[type=number], select { width: 100%; border: 1px solid #e4e4e7; border-radius: 9px; background: #f4f4f5; padding: 6px 8px; font: inherit; color: inherit; }
  textarea { min-height: 64px; resize: vertical; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  label.f { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: #52525b; }
  select:disabled { opacity: .55; }
  .status { font-size: 12px; padding: 8px 10px; border-radius: 10px; background: #f4f4f5; margin-top: 8px; white-space: pre-wrap; }
  .status.warn { background: #fef9c3; color: #854d0e; }
  .status.bad { background: #fee2e2; color: #b91c1c; }
  .status.ok { background: #dcfce7; color: #15803d; }
  .job { display: grid; grid-template-columns: 64px 64px 1fr; gap: 8px; align-items: start; border-top: 1px solid #f4f4f5; padding: 8px 0; }
  .job img { width: 64px; height: 64px; object-fit: contain; border-radius: 6px; border: 1px solid #e4e4e7; background: repeating-conic-gradient(#e4e4e7 0% 25%, #fff 0% 50%) 50% / 12px 12px; cursor: zoom-in; }
  .job .ph { width: 64px; height: 64px; border-radius: 6px; border: 1px dashed #d4d4d8; display: grid; place-items: center; color: #a1a1aa; font-size: 11px; }
  .tag { display: inline-block; font-size: 11px; border-radius: 999px; padding: 0 7px; background: #f4f4f5; color: #52525b; margin: 1px 2px 1px 0; }
  .tag.ok { background: #dcfce7; color: #15803d; } .tag.bad { background: #fee2e2; color: #b91c1c; } .tag.warn { background: #fef9c3; color: #854d0e; }
  .job .txt { font-size: 11px; color: #71717a; overflow-wrap: anywhere; }
  /* 框选 / 标注 / 取色 弹窗 */
  .modal { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: none; align-items: flex-start; justify-content: center; padding: 16px; overflow-y: auto; z-index: 5; }
  .modal.show { display: flex; }
  .mcard { background: #fff; border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 8px; max-width: calc(100vw - 32px); }
  .seg { display: inline-flex; border: 1px solid #d4d4d8; border-radius: 10px; overflow: hidden; }
  .seg button { border: 0; border-radius: 0; }
  .seg button + button { border-left: 1px solid #d4d4d8; }
  .stage { position: relative; user-select: none; touch-action: none; cursor: crosshair; align-self: center; line-height: 0; overflow: hidden; }
  .stage img { max-width: min(80vw, 1000px); max-height: 62vh; display: block; }
  .mark { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; opacity: .5; }
  .picks { position: absolute; inset: 0; pointer-events: none; }
  .pick { position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.6); color: #fff; font: bold 11px/16px sans-serif; text-align: center; text-shadow: 0 0 2px #000; }
  .sel { position: absolute; border: 2px solid #22c55e; box-shadow: 0 0 0 9999px rgba(0,0,0,.45); cursor: move; }
  .stage.painting .sel { pointer-events: none; }
  .sel .h { position: absolute; width: 14px; height: 14px; background: #fff; border: 2px solid #22c55e; border-radius: 3px; }
  .h.nw { left: -8px; top: -8px; cursor: nwse-resize; } .h.ne { right: -8px; top: -8px; cursor: nesw-resize; }
  .h.sw { left: -8px; bottom: -8px; cursor: nesw-resize; } .h.se { right: -8px; bottom: -8px; cursor: nwse-resize; }
  .colors .crow { display: flex; gap: 6px; align-items: center; font-size: 12px; margin-top: 4px; }
  .crow .sw { width: 18px; height: 18px; border-radius: 5px; border: 1px solid #d4d4d8; flex: none; }
  .crow input { flex: 1; border: 1px solid #e4e4e7; border-radius: 7px; padding: 3px 6px; font: inherit; }
  /* 看大图 */
  .viewer { position: fixed; inset: 0; background: rgba(0,0,0,.88); display: none; z-index: 6; overflow: hidden; }
  .viewer.show { display: block; }
  .viewer img { position: absolute; left: 0; top: 0; transform-origin: 0 0; max-width: none; background: repeating-conic-gradient(#e4e4e7 0% 25%, #fff 0% 50%) 50% / 20px 20px; cursor: grab; }
  .vbar { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; gap: 6px; background: rgba(24,24,27,.9); border-radius: 999px; padding: 5px 8px; }
  .vbar button { background: rgba(255,255,255,.15); color: #fff; border: 0; border-radius: 999px; }
  .toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); background: #18181b; color: #fff; padding: 7px 14px; border-radius: 999px; display: none; z-index: 7; font-size: 13px; }
</style>
<div class="wrap" id="wrap">
  <div class="handle" id="handle" title="展开 / 收起 AI图图">AI<br>图<br>图<br>▶</div>
  <div class="panel">
    <div class="card">
      <div class="row"><h2>AI图图 · 电商作图</h2><span class="muted" style="margin-left:auto">v${VERSION}</span></div>
      <div class="muted">在 Gemini 网页版里批量精修产品图。每张都由 Gemini 生成，插件负责填图、填提示词、收图和后期处理。</div>
    </div>

    <div class="card">
      <div class="modes" id="modes">
        <button data-mode="white">抠白底图 1:1</button><button data-mode="refine">图片精修</button><button data-mode="free">自由模式</button>
      </div>
    </div>

    <div class="card">
      <div class="row"><b>产品图</b><span class="muted" id="count">0 张</span><button id="clearFiles" style="margin-left:auto" hidden>清空</button></div>
      <div class="drop" id="drop">点击选择、拖进来，或点一下这里后按 Ctrl+V 粘贴<br><span class="muted">JPG / PNG / WebP，可以一次多张</span></div>
      <input type="file" id="fileInput" accept="image/png,image/jpeg,image/webp" multiple hidden>
      <div class="thumbs" id="thumbs"></div>
      <div class="muted" id="thumbHint" hidden>点缩略图：框选商品、画笔标注配件、吸管取色。</div>
    </div>

    <div class="card">
      <b>精修要求</b>
      <textarea id="requirement" placeholder="简单描述产品：是什么、什么材质、怎么摆放的；哪些是背景（例如：放在书上的手机壳，书本是背景）。颜色不用写，需要锁定颜色请用吸管取色。"></textarea>
      <div class="grid" style="margin-top:8px">
        <label class="f">背景<select id="background"><option value="white">白底图</option><option value="original">原图背景</option></select></label>
        <label class="f">尺寸比例<select id="ratio">
          <option value="auto">自动（跟原图）</option><option value="1:1">1:1 正方形</option><option value="3:4">3:4 竖版</option><option value="4:3">4:3 横版</option>
          <option value="2:3">2:3 竖版</option><option value="3:2">3:2 横版</option><option value="4:5">4:5 竖版</option><option value="5:4">5:4 横版</option>
          <option value="9:16">9:16 竖屏</option><option value="16:9">16:9 宽屏</option></select></label>
        <label class="f">输出尺寸<select id="outSize"></select></label>
        <label class="f">输出格式<select id="format"></select></label>
        <label class="f">主体大小<select id="fill"><option value="keep">保持原图</option><option value="70">适中 70%</option><option value="85">饱满 85%</option></select></label>
        <label class="f">拍摄角度<select id="angle"><option value="keep">保持原图</option><option value="auto">自动摆正</option><option value="front">正面平视</option><option value="45">45° 俯视</option><option value="top">正上方俯拍</option></select></label>
        <label class="f">精修<select id="retouch"><option value="on">精修（去瑕疵）</option><option value="off">不精修</option></select></label>
        <label class="f">清晰度<select id="sharp"><option value="keep">原样</option><option value="enhance">提升（AI）</option></select></label>
        <label class="f">对比度<select id="contrast"><option value="0">原样</option><option value="1">稍微提高</option><option value="2">明显提高</option></select></label>
        <label class="f">亮度<select id="bright"><option value="0">原样</option><option value="1">稍亮</option><option value="2">更亮</option></select></label>
      </div>
    </div>

    <div class="card">
      <b>批量</b>
      <div class="grid" style="margin-top:6px">
        <label class="f">Gemini 模型<select id="model"><option value="Flash">Flash（推荐）</option><option value="Pro">Pro</option><option value="Flash-Lite">Flash-Lite</option><option value="">不切换（用网页上选的）</option></select></label>
        <label class="f">扩展思考<select id="extended"><option value="any">不管</option><option value="off">关</option><option value="on">开</option></select></label>
        <label class="f">每批张数<input type="number" id="batchSize" min="1" max="50"></label>
        <label class="f">发送方式<select id="send"><option value="B">B：插件自动发送</option><option value="A">A：插件填好，我按回车</option></select></label>
        <label class="f">会话方式<select id="session"><option value="new">每张新会话</option><option value="current">当前会话连续做</option><option value="everyN">每 N 张换新会话</option></select></label>
        <label class="f" id="everyNWrap">N =<input type="number" id="everyN" min="1" max="50"></label>
      </div>
      <div class="muted" id="sendHint" style="margin-top:6px"></div>
      <div class="row" style="margin-top:8px">
        <button class="primary" id="startBtn" style="flex:1">开始这一批</button>
        <button id="stopBtn" disabled>停止</button>
      </div>
      <div class="status" id="status">准备好了：先加图片，再点“开始这一批”。</div>
    </div>

    <div class="card">
      <div class="row"><b>结果</b><span class="muted" id="sumText"></span></div>
      <div id="jobs"></div>
      <div class="row" style="margin-top:8px">
        <button id="zipBtn" disabled>打包下载 zip</button>
        <button id="copyLog">复制日志</button>
        <button id="clearJobs" style="margin-left:auto">清空结果</button>
      </div>
    </div>
  </div>
</div>

<div class="modal" id="modal"><div class="mcard">
  <div class="row"><b id="mTitle" style="margin-right:auto"></b><button id="mPrev">上一张</button><button id="mNext">下一张</button></div>
  <div class="row">
    <div class="seg" id="tools"><button data-tool="crop" class="active">框选商品</button><button data-tool="brush">画笔标注配件</button><button data-tool="eraser">橡皮擦</button><button data-tool="picker">吸管取色</button></div>
    <span class="muted">粗细</span><input type="range" id="brush" min="4" max="80" value="20" style="width:90px">
    <button id="markClear">清除标注</button>
  </div>
  <div class="muted" id="toolHint"></div>
  <div class="stage" id="stage"><img id="mImg" draggable="false"><canvas class="mark" id="markCv"></canvas><div class="picks" id="picks"></div>
    <div class="sel" id="sel" hidden><span class="h nw" data-h="nw"></span><span class="h ne" data-h="ne"></span><span class="h sw" data-h="sw"></span><span class="h se" data-h="se"></span></div></div>
  <input id="partsNote" placeholder="配件说明（选填）：例如“右边两个白色插头是配件，必须保留”" style="border:1px solid #e4e4e7;border-radius:9px;padding:6px 8px;font:inherit">
  <div class="colors" id="colors"></div>
  <div class="row"><span class="muted" id="mInfo" style="margin-right:auto"></span>
    <button id="cropClear">清除框选</button><button id="cropAll">框选应用到所有图片</button><button id="mRemove" class="danger">移除这张</button><button class="primary" id="mOk" style="padding:5px 14px">完成</button></div>
</div></div>

<div class="viewer" id="viewer"><img id="vImg" draggable="false"><div class="vbar">
  <button data-z="out">－</button><button data-z="in">＋</button><button data-z="one">1:1</button><button data-z="fit">适应窗口</button><button data-z="close">关闭</button></div></div>
<div class="toast" id="toast"></div>`;
  document.documentElement.appendChild(host);
  const $ = (id) => root.getElementById(id);
  const toast = (msg) => {
    const t = $("toast");
    t.textContent = msg;
    t.style.display = "block";
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (t.style.display = "none"), 2200);
  };
  const setStatus = (msg, kind = "") => {
    $("status").className = "status" + (kind ? " " + kind : "");
    $("status").textContent = msg;
  };

  // 左右收起
  $("handle").addEventListener("click", () => {
    const closed = $("wrap").classList.toggle("closed");
    $("handle").innerHTML = closed ? "AI<br>图<br>图<br>◀" : "AI<br>图<br>图<br>▶";
    try { chrome.storage.local.set({ aitutuClosed: closed }); } catch {}
  });

  // ------------------------------------------------------------ 设置读写 + 模式锁定
  const FIELDS = ["background", "ratio", "outSize", "format", "fill", "angle", "retouch", "sharp", "contrast", "bright"];
  function applyMode() {
    const cfg = MODES[S.mode];
    root.querySelectorAll("#modes button").forEach((b) => b.classList.toggle("active", b.dataset.mode === S.mode));
    $("outSize").innerHTML = cfg.outSizes.map((v) => `<option value="${v}">${LABELS.outSize[v]}</option>`).join("");
    $("format").innerHTML = cfg.formats.map((v) => `<option value="${v}">${LABELS.format[v]}</option>`).join("");
    for (const id of FIELDS) {
      const el = $(id);
      if (id in cfg.locks) {
        el.value = cfg.locks[id];
        el.disabled = true;
      } else {
        el.disabled = false;
        el.value = [...el.options].some((o) => o.value === S[id]) ? S[id] : el.options[0].value;
      }
    }
    const alphaOpt = [...$("format").options].find((o) => o.value === "png-alpha");
    if (alphaOpt) {
      alphaOpt.disabled = $("background").value !== "white";
      if (alphaOpt.disabled && $("format").value === "png-alpha") $("format").value = "jpeg";
    }
  }
  function readSettings() {
    for (const id of FIELDS) S[id] = $(id).value;
    S.requirement = $("requirement").value.trim();
    S.batchSize = Math.max(1, Math.min(50, Number($("batchSize").value) || 10));
    S.session = $("session").value;
    S.everyN = Math.max(1, Math.min(50, Number($("everyN").value) || 5));
    S.send = $("send").value;
    S.model = $("model").value;
    S.extended = $("extended").value;
  }
  function renderBatchHints() {
    $("everyNWrap").hidden = $("session").value !== "everyN";
    $("sendHint").textContent = $("send").value === "B"
      ? "B 模式：插件自动发送，每张之间随机等 20～60 秒；遇到被拒、验证、额度提示或页面切到后台，会自动停下 / 暂停。"
      : "A 模式：插件把图片和提示词填好后会提示你，你检查一下按回车发送，插件接着收图、准备下一张。";
  }
  function loadSettingsToUi() {
    $("requirement").value = S.requirement || "";
    $("batchSize").value = S.batchSize;
    $("session").value = S.session;
    $("everyN").value = S.everyN;
    $("send").value = S.send;
    $("model").value = S.model ?? "Flash";
    $("extended").value = S.extended || "any";
    applyMode();
    renderBatchHints();
  }
  $("modes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b || running) return;
    readSettings();
    S.mode = b.dataset.mode;
    applyMode();
    readSettings();
    saveSettings();
  });
  root.querySelectorAll("select, input[type=number], textarea#requirement").forEach((el) =>
    el.addEventListener("change", () => {
      if (FIELDS.includes(el.id) && !(el.id in MODES[S.mode].locks)) S[el.id] = el.value;
      readSettings();
      applyMode();
      renderBatchHints();
      saveSettings();
    }),
  );
  try {
    chrome.storage.local.get(["aitutuSettings", "aitutuClosed"], (r) => {
      if (r && r.aitutuSettings) S = { ...DEFAULTS, ...r.aitutuSettings };
      if (r && r.aitutuClosed) { $("wrap").classList.add("closed"); $("handle").innerHTML = "AI<br>图<br>图<br>◀"; }
      loadSettingsToUi();
    });
  } catch {
    loadSettingsToUi();
  }

  // ------------------------------------------------------------ 加图片
  async function addFiles(list) {
    const picked = [...list].filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type));
    if (picked.length < list.length) toast("只支持 JPG、PNG、WebP 图片");
    for (const file of picked) {
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const img = await loadImage(dataUrl);
      files.push({ id: nextId++, name: file.name || "粘贴图片.png", size: file.size, type: file.type, dataUrl, base64: dataUrl.split(",")[1], w: img?.naturalWidth || 0, h: img?.naturalHeight || 0, crop: null });
    }
    renderThumbs();
  }
  function renderThumbs() {
    $("count").textContent = `${files.length} 张，未做 ${files.filter((f) => !f.done).length} 张`;
    $("clearFiles").hidden = !files.length;
    $("thumbHint").hidden = !files.length;
    $("thumbs").innerHTML = files.map((f) => {
      const badge = [f.crop ? "框选" : "", f.parts?.length ? `配件${f.parts.length}` : "", f.colors?.length ? `色${f.colors.length}` : ""].filter(Boolean).join("·");
      return `<div class="thumb${f.done ? " done" : ""}" data-open="${f.id}" style="aspect-ratio:${f.w || 1}/${f.h || 1}" title="${esc(f.name)}">
        <img src="${f.dataUrl}">${f.crop ? `<span class="box" style="left:${f.crop.x * 100}%;top:${f.crop.y * 100}%;width:${f.crop.w * 100}%;height:${f.crop.h * 100}%"></span>` : ""}
        ${badge ? `<span class="badge">${badge}</span>` : ""}<button class="x" data-remove="${f.id}">×</button></div>`;
    }).join("");
  }
  $("drop").addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
  $("drop").addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); $("drop").classList.add("over"); });
  $("drop").addEventListener("dragleave", () => $("drop").classList.remove("over"));
  $("drop").addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); $("drop").classList.remove("over"); addFiles(e.dataTransfer.files); });
  $("thumbs").addEventListener("click", (e) => {
    const rm = Number(e.target.dataset.remove);
    if (rm) { files = files.filter((f) => f.id !== rm); renderThumbs(); return; }
    const t = e.target.closest("[data-open]");
    if (t && !running) openEditor(Number(t.dataset.open));
  });
  $("clearFiles").addEventListener("click", () => {
    if (running) { toast("正在处理，先点“停止”"); return; }
    if (!confirm(`清空面板里全部 ${files.length} 张图片？（结果不受影响）`)) return;
    files = [];
    renderThumbs();
  });
  // Ctrl+V：只在最近点过面板时接管（否则让 Gemini 自己处理粘贴）
  document.addEventListener("pointerdown", (e) => { panelActive = e.composedPath().includes(host); }, true);
  document.addEventListener("paste", (e) => {
    // 只接管你真按的 Ctrl+V；插件自己往 Gemini 输入框模拟的粘贴（isTrusted=false）不能拦
    if (!panelActive || !e.isTrusted) return;
    const items = [...(e.clipboardData?.items || [])].filter((it) => it.kind === "file" && it.type.startsWith("image/"));
    if (!items.length) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const stamp = bj().slice(11).replace(/:/g, "");
    addFiles(items.map((it, i) => {
      const f = it.getAsFile();
      return new File([f], `粘贴图片-${stamp}-${nextId + i}.${f.type === "image/jpeg" ? "jpg" : "png"}`, { type: f.type });
    }));
    toast(`已粘贴 ${items.length} 张图片`);
  }, true);

  // ------------------------------------------------------------ 框选 / 标注 / 取色（和测试页面同样的操作）
  let edIndex = -1, edRect = null, drag = null, tool = "crop";
  const edFile = () => files[edIndex];
  const TOOL_HINT = {
    crop: "按住拖出一个框，把商品框进去（四周留一点空）。拖框内部移动，拖四个角调大小。",
    brush: "在容易被当成杂物的小配件上涂抹，连在一起的算一个配件；会把标注图和配件特写一起交给 Gemini。",
    eraser: "擦掉涂错的地方。",
    picker: "在产品上点一下取色号，要求这个部位保持这个颜色（最多 8 个）。",
  };
  function setTool(t) {
    tool = t;
    root.querySelectorAll("#tools button").forEach((b) => b.classList.toggle("active", b.dataset.tool === t));
    $("toolHint").textContent = TOOL_HINT[t];
    $("stage").classList.toggle("painting", t !== "crop");
  }
  $("tools").addEventListener("click", (e) => { if (e.target.dataset.tool) setTool(e.target.dataset.tool); });
  function openEditor(id) {
    edIndex = files.findIndex((f) => f.id === id);
    if (edIndex < 0) return;
    $("modal").classList.add("show");
    showEditor();
  }
  function showEditor() {
    const f = edFile();
    edRect = f.crop ? { ...f.crop } : null;
    $("mImg").src = f.dataUrl;
    $("mTitle").textContent = `第 ${edIndex + 1}/${files.length} 张：${f.name}（${f.w}×${f.h}）`;
    $("mPrev").disabled = edIndex === 0;
    $("mNext").disabled = edIndex === files.length - 1;
    $("partsNote").value = f.partsNote || "";
    setTool(tool);
    drawMark();
    renderPicks();
  }
  function ensureMask(f) {
    if (!f.mask) {
      const k = Math.min(1, 1024 / Math.max(f.w, f.h));
      f.mask = document.createElement("canvas");
      f.mask.width = Math.max(1, Math.round(f.w * k));
      f.mask.height = Math.max(1, Math.round(f.h * k));
    }
    return f.mask;
  }
  function drawMark() {
    const cv = $("markCv"), m = edFile()?.mask;
    cv.width = m ? m.width : 1;
    cv.height = m ? m.height : 1;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, cv.width, cv.height);
    if (m) g.drawImage(m, 0, 0);
  }
  function drawSel() {
    const f = edFile();
    const extra = (f.parts?.length ? ` · 配件 ${f.parts.length} 处` : "") + (f.colors?.length ? ` · 颜色 ${f.colors.length} 个` : "");
    if (!edRect) { $("sel").hidden = true; $("mInfo").textContent = "未框选：整张图交给 Gemini" + extra; return; }
    const sel = $("sel");
    sel.hidden = false;
    Object.assign(sel.style, { left: edRect.x * 100 + "%", top: edRect.y * 100 + "%", width: edRect.w * 100 + "%", height: edRect.h * 100 + "%" });
    $("mInfo").textContent = `框选 ${Math.round(edRect.w * f.w)}×${Math.round(edRect.h * f.h)}` + extra;
  }
  function renderPicks() {
    const list = edFile().colors || [];
    $("picks").innerHTML = list.map((c, i) => `<span class="pick" style="left:${c.x * 100}%;top:${c.y * 100}%;background:${c.hex}">${i + 1}</span>`).join("");
    $("colors").innerHTML = list.map((c, i) => `<div class="crow"><span class="sw" style="background:${c.hex}"></span><b>${i + 1}</b><span>${c.hex}</span>
      <input data-cnote="${i}" value="${esc(c.note)}" placeholder="备注（选填），例如：无线充"><button data-cdel="${i}">×</button></div>`).join("");
    drawSel();
  }
  $("colors").addEventListener("input", (e) => { const i = e.target.dataset.cnote; if (i !== undefined) edFile().colors[Number(i)].note = e.target.value.trim(); });
  $("colors").addEventListener("click", (e) => { const i = e.target.dataset.cdel; if (i !== undefined) { edFile().colors.splice(Number(i), 1); renderPicks(); } });
  function saveEditor() {
    const f = edFile();
    if (!f) return;
    f.crop = edRect && edRect.w > 0.02 && edRect.h > 0.02 ? { ...edRect } : null;
    f.partsNote = $("partsNote").value.trim();
  }
  function closeEditor() {
    saveEditor();
    $("modal").classList.remove("show");
    edIndex = -1;
    renderThumbs();
  }
  const stagePt = (e) => {
    const r = $("mImg").getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  async function pickColor(p) {
    const f = edFile();
    f.colors = f.colors || [];
    if (f.colors.length >= 8) { toast("最多 8 个颜色"); return; }
    if (!f.sampler) {
      const img = await loadImage(f.dataUrl);
      const c = document.createElement("canvas");
      c.width = f.w; c.height = f.h;
      c.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0);
      f.sampler = c;
    }
    const x = Math.round(p.x * f.w), y = Math.round(p.y * f.h), r = 3;
    const d = f.sampler.getContext("2d").getImageData(Math.max(0, x - r), Math.max(0, y - r), r * 2 + 1, r * 2 + 1).data;
    let R = 0, G = 0, B = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
    const hex = "#" + [R, G, B].map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("").toUpperCase();
    f.colors.push({ x: p.x, y: p.y, hex, note: "" });
    renderPicks();
  }
  function paintSeg(a, b) {
    const m = ensureMask(edFile());
    const g = m.getContext("2d");
    const shown = $("mImg").getBoundingClientRect().width || 1;
    g.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    g.strokeStyle = "rgb(255,40,40)";
    g.lineCap = g.lineJoin = "round";
    g.lineWidth = Number($("brush").value) * (m.width / shown);
    g.beginPath();
    g.moveTo(a.x * m.width, a.y * m.height);
    g.lineTo(b.x * m.width + 0.01, b.y * m.height);
    g.stroke();
    drawMark();
  }
  $("stage").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const p = stagePt(e);
    if (tool === "picker") { pickColor(p); return; }
    if (tool !== "crop") {
      drag = { mode: "paint", last: p };
      $("stage").setPointerCapture(e.pointerId);
      paintSeg(p, p);
      return;
    }
    const h = e.target.dataset.h;
    if (h && edRect) drag = { mode: "new", start: { x: h.includes("w") ? edRect.x + edRect.w : edRect.x, y: h.includes("n") ? edRect.y + edRect.h : edRect.y } };
    else if (e.target === $("sel") && edRect) drag = { mode: "move", start: p, orig: { ...edRect } };
    else { drag = { mode: "new", start: p }; edRect = { x: p.x, y: p.y, w: 0, h: 0 }; }
    $("stage").setPointerCapture(e.pointerId);
    drawSel();
  });
  $("stage").addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = stagePt(e);
    if (drag.mode === "paint") { paintSeg(drag.last, p); drag.last = p; return; }
    if (drag.mode === "move") {
      const o = drag.orig;
      edRect = { ...o, x: Math.min(1 - o.w, Math.max(0, o.x + p.x - drag.start.x)), y: Math.min(1 - o.h, Math.max(0, o.y + p.y - drag.start.y)) };
    } else {
      const s = drag.start;
      edRect = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) };
    }
    drawSel();
  });
  $("stage").addEventListener("pointerup", () => {
    if (drag && drag.mode === "paint") {
      drag = null;
      const f = edFile();
      f.parts = f.mask ? findParts(f.mask) : [];
      drawSel();
      return;
    }
    drag = null;
    if (edRect && (edRect.w < 0.02 || edRect.h < 0.02)) edRect = null;
    drawSel();
  });
  $("mPrev").addEventListener("click", () => { saveEditor(); edIndex--; showEditor(); });
  $("mNext").addEventListener("click", () => { saveEditor(); edIndex++; showEditor(); });
  $("cropClear").addEventListener("click", () => { edRect = null; drawSel(); });
  $("cropAll").addEventListener("click", () => {
    if (!edRect) { toast("先框一个区域"); return; }
    files.forEach((f) => (f.crop = { ...edRect }));
    toast(`框选已应用到全部 ${files.length} 张`);
  });
  $("markClear").addEventListener("click", () => { const f = edFile(); f.mask = null; f.parts = []; drawMark(); drawSel(); });
  $("mRemove").addEventListener("click", () => {
    const f = edFile();
    files = files.filter((x) => x !== f);
    if (!files.length) { $("modal").classList.remove("show"); edIndex = -1; renderThumbs(); return; }
    edIndex = Math.min(edIndex, files.length - 1);
    showEditor();
    renderThumbs();
  });
  $("mOk").addEventListener("click", closeEditor);
  $("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeEditor(); });

  // ------------------------------------------------------------ 看大图（适应窗口、滚轮缩放、拖动）
  const V = { s: 1, x: 0, y: 0, drag: null };
  const vApply = () => { $("vImg").style.transform = `translate(${V.x}px,${V.y}px) scale(${V.s})`; };
  function vFit() {
    const im = $("vImg"), vw = innerWidth, vh = innerHeight - 60;
    V.s = Math.min((vw - 32) / im.naturalWidth, (vh - 32) / im.naturalHeight, 1);
    V.x = (vw - im.naturalWidth * V.s) / 2;
    V.y = (vh - im.naturalHeight * V.s) / 2;
    vApply();
  }
  function vZoom(s, cx = innerWidth / 2, cy = innerHeight / 2) {
    s = Math.min(16, Math.max(0.05, s));
    V.x = cx - (cx - V.x) * (s / V.s);
    V.y = cy - (cy - V.y) * (s / V.s);
    V.s = s;
    vApply();
  }
  function openViewer(src) { $("vImg").onload = vFit; $("vImg").src = src; $("viewer").classList.add("show"); }
  $("viewer").addEventListener("wheel", (e) => { e.preventDefault(); vZoom(V.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY); }, { passive: false });
  $("viewer").addEventListener("pointerdown", (e) => {
    if (e.target.closest(".vbar")) return;
    V.drag = { x: e.clientX, y: e.clientY, ox: V.x, oy: V.y, moved: false, onImg: e.target === $("vImg") };
    $("viewer").setPointerCapture(e.pointerId);
  });
  $("viewer").addEventListener("pointermove", (e) => {
    const d = V.drag;
    if (!d) return;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true;
    if (d.moved) { V.x = d.ox + e.clientX - d.x; V.y = d.oy + e.clientY - d.y; vApply(); }
  });
  $("viewer").addEventListener("pointerup", () => { const d = V.drag; V.drag = null; if (d && !d.moved && !d.onImg) $("viewer").classList.remove("show"); });
  root.querySelector(".vbar").addEventListener("click", (e) => {
    const z = e.target.dataset.z;
    if (z === "in") vZoom(V.s * 1.25); else if (z === "out") vZoom(V.s / 1.25);
    else if (z === "one") vZoom(1); else if (z === "fit") vFit(); else if (z === "close") $("viewer").classList.remove("show");
  });

  // ------------------------------------------------------------ 结果列表
  const STATUS = { waiting: ["排队", ""], running: ["进行中", "warn"], ok: ["完成", "ok"], refused: ["被拒", "bad"], fail: ["失败", "bad"], cancel: ["已停止", ""] };
  function outName(j) {
    const base = j.file.name.replace(/\.[^.]+$/, "");
    const tag = { white: "白底", refine: "精修", free: "处理" }[j.mode] || "处理";
    return `${base}-${tag}-${j.w}x${j.h}${j.ext}`;
  }
  function renderJobs() {
    $("jobs").innerHTML = jobs.slice().reverse().map((j) => {
      const [label, cls] = STATUS[j.status];
      const sec = j.endedAt ? ` ${((j.endedAt - j.startedAt) / 1000).toFixed(0)} 秒` : "";
      return `<div class="job">
        <img src="${j.inputUrl || j.file.dataUrl}" data-view="${j.inputUrl || j.file.dataUrl}" title="交给 Gemini 的图">
        ${j.outUrl ? `<img src="${j.outUrl}" data-view="${j.outUrl}" title="最终输出">` : `<div class="ph">${j.status === "running" ? "生成中…" : "—"}</div>`}
        <div><div><b>${esc(j.file.name)}</b></div>
          <span class="tag ${cls}">${label}${sec}</span>${j.w ? `<span class="tag">${j.w}×${j.h}${j.ext === ".png" ? " PNG" : ""}</span>` : ""}${j.note ? `<span class="tag">${esc(j.note)}</span>` : ""}${j.model ? `<span class="tag">${esc(j.model)}</span>` : ""}
          ${j.partCount ? `<span class="tag warn">标注配件 ${j.partCount} 处，请核对</span>` : ""}
          <div class="txt">${esc(j.steps[j.steps.length - 1] || "")}</div>
          ${j.error ? `<div class="txt" style="color:#b91c1c">${esc(j.error)}</div>` : ""}
          ${j.text && j.status !== "ok" ? `<div class="txt">Gemini：${esc(j.text.slice(0, 160))}</div>` : ""}
          <div class="row" style="margin-top:3px">
            ${j.outUrl ? `<button data-dl="${j.id}">下载</button>` : ""}${j.aiUrl ? `<button data-view="${j.aiUrl}">看 AI 原图</button>` : ""}
            ${["refused", "fail", "cancel"].includes(j.status) && !running ? `<button data-retry="${j.id}">重做这张</button>` : ""}
          </div></div></div>`;
    }).join("");
    const ok = jobs.filter((j) => j.status === "ok").length;
    $("sumText").textContent = jobs.length ? `共 ${jobs.length} 张，完成 ${ok}` : "";
    $("zipBtn").disabled = !ok;
  }
  $("jobs").addEventListener("click", (e) => {
    const v = e.target.dataset.view;
    if (v) { openViewer(v); return; }
    const dl = Number(e.target.dataset.dl);
    if (dl) { const j = jobs.find((x) => x.id === dl); downloadBlob(j.outBlob, outName(j)); return; }
    const rt = Number(e.target.dataset.retry);
    if (rt) { const j = jobs.find((x) => x.id === rt); j.file.done = false; jobs = jobs.filter((x) => x !== j); renderJobs(); renderThumbs(); startBatch([j.file]); }
  });
  function downloadBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.style.display = "none";
    document.body.appendChild(a); // 放在影子 DOM 里 Chrome 会忽略文件名

    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  $("zipBtn").addEventListener("click", async () => {
    const ok = jobs.filter((j) => j.status === "ok");
    const used = new Set();
    const list = ok.map((j) => {
      let n = outName(j), k = 2;
      while (used.has(n)) n = outName(j).replace(/(\.[a-z]+)$/, `-${k++}$1`);
      used.add(n);
      return { name: n, blob: j.outBlob };
    });
    downloadBlob(await makeZip(list), `AI图图-${bj().replace(/[-: ]/g, "").slice(0, 14)}.zip`);
  });
  $("clearJobs").addEventListener("click", () => {
    if (running) { toast("正在处理，先点“停止”"); return; }
    jobs = [];
    renderJobs();
  });
  $("copyLog").addEventListener("click", async () => {
    const lines = [`# AI图图 插件日志（v${VERSION}）`, `时间：${bj()}`, `浏览器：${navigator.userAgent}`,
      `设置：${JSON.stringify({ ...S, requirement: undefined })}`, `精修要求：${S.requirement || "（无）"}`, ""];
    for (const j of jobs) {
      lines.push(`## ${j.file.name}：${STATUS[j.status][0]}${j.endedAt ? `，${((j.endedAt - j.startedAt) / 1000).toFixed(1)} 秒` : ""}`);
      lines.push(`原图 ${j.file.w}×${j.file.h}${j.file.crop ? `，框选 ${j.inputW}×${j.inputH}` : ""}；AI 比例 ${j.aiRatio}；模型 ${j.model || "?"}；新会话 ${j.newChat ? "是" : "否"}；配件 ${j.partCount || 0}；颜色 ${j.file.colors?.length || 0}`);
      if (j.aiW) lines.push(`Gemini 出图：${j.aiW}×${j.aiH}，${Math.round(j.aiBytes / 1024)} KB；最终输出：${j.w}×${j.h}${j.ext}${j.note ? "，" + j.note : ""}`);
      j.steps.forEach((s) => lines.push("- " + s));
      if (j.error) lines.push("错误：" + j.error);
      if (j.text) lines.push("Gemini 回复：" + j.text.slice(0, 500));
      lines.push("");
    }
    if (jobs[0]?.prompt) lines.push("## 第 1 张的提示词", jobs[0].prompt);
    const text = lines.join("\n");
    try { await navigator.clipboard.writeText(text); toast("日志已复制"); }
    catch { toast("复制失败：请允许剪贴板权限"); }
  });

  // ------------------------------------------------------------ 批量处理
  function step(j, msg) {
    j.steps.push(`${((Date.now() - j.startedAt) / 1000).toFixed(1)}s ${msg}`);
    renderJobs();
  }
  async function waitVisible(signal) {
    while (document.visibilityState !== "visible") {
      if (signal.aborted) throw new Error("已停止");
      setStatus("Gemini 页面在后台，已暂停。切回这个标签页后自动继续。", "warn");
      await gemSleep(1000);
    }
  }
  async function countdown(sec, signal, what) {
    for (let t = sec; t > 0; t--) {
      if (signal.aborted) throw new Error("已停止");
      setStatus(`${what}：${t} 秒后发送下一张…`, "");
      await gemSleep(1000);
    }
  }
  function aiRatioOf(f) {
    if (S.mode === "white") return "1:1";
    if (S.mode === "refine" || S.ratio === "auto") { const s = inputSize(f); return closestAiRatio(s.w || 1, s.h || 1); }
    return S.ratio;
  }

  async function runOne(j, signal, isFirst) {
    j.status = "running";
    j.startedAt = Date.now();
    renderJobs();
    await waitVisible(signal);
    // 1. 准备图片（框选、标注图、特写）
    const input = await prepareInput(j.file);
    j.inputW = input.w; j.inputH = input.h;
    j.inputUrl = input.cropped ? input.dataUrl : null;
    j.partCount = input.partCount;
    const toFile = (b64, name, type = "image/jpeg") => new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type });
    const upload = [toFile(input.base64, input.cropped ? input.name : j.file.name, input.cropped ? "image/jpeg" : j.file.type)];
    input.extras.forEach((x, i) => upload.push(toFile(x.base64, x.kind === "mark" ? "配件标注图.jpg" : `配件特写${i}.jpg`)));
    j.aiRatio = aiRatioOf(j.file);
    // 2. 会话
    const needNew = S.session === "new" || (S.session === "everyN" && sessionCount % S.everyN === 0);
    j.newChat = needNew;
    if (needNew) {
      step(j, "发起新对话");
      await gemNewChat(signal);
      sessionCount = 0;
    }
    // 模型：每张发之前看一眼，不对就切（新对话有时会变回默认模型）
    const wantExt = S.extended === "on" ? true : S.extended === "off" ? false : null;
    if (S.model || wantExt !== null) {
      const before = gemCurrentMode();
      const after = await gemEnsureMode(S.model, wantExt, signal);
      if (before && after && before.label !== after.label) step(j, `切换模型：${before.label} → ${after.label}`);
    }
    j.model = gemCurrentMode()?.label || "（没找到模型按钮）";
    j.prompt = buildWebPrompt(S, j.file, j.aiRatio, { fresh: !needNew && (sessionCount > 0 || !isFirst || GEM.responses().length > 0) });
    // 3. 填图和提示词
    await gemClearInput(signal);
    step(j, `贴图 ${upload.length} 张`);
    await gemPasteFiles(upload, signal);
    step(j, "填提示词");
    await gemInsertText(j.prompt, signal);
    step(j, "等图片上传完");
    await gemWaitReady(upload.length, signal);
    const base = GEM.responses().length;
    // 4. 发送
    if (S.send === "B") {
      step(j, "自动发送");
      gemClickSend();
    } else {
      setStatus(`第 ${j.idx}/${j.total} 张已经填好：请检查 Gemini 输入框，按回车发送。`, "warn");
      step(j, "等你按回车发送");
      await gemWaitUserSend(base, signal);
    }
    sessionCount++;
    setStatus(`第 ${j.idx}/${j.total} 张：等 Gemini 出图…`);
    step(j, "等 Gemini 出图");
    const r = await gemWaitResult(base, signal);
    if (r.alert) { j.status = "fail"; j.error = r.alert; return "alert"; }
    j.text = r.text || "";
    if (r.refused) {
      j.status = "refused";
      step(j, "Gemini 没有出图");
      return GEM_LIMIT_RE.test(j.text) ? "limit" : "refused";
    }
    // 5. 收图 + 后期
    const blob = await gemGrabImage(r.img);
    j.aiUrl = URL.createObjectURL(blob);
    const img = await loadImage(j.aiUrl);
    j.aiW = img.naturalWidth; j.aiH = img.naturalHeight; j.aiBytes = blob.size;
    step(j, `收到 ${j.aiW}×${j.aiH}，后期处理`);
    const inSize = { w: input.w, h: input.h };
    const out = await composeOutput(img, {
      ratio: S.mode === "white" ? 1 : S.mode === "free" && S.ratio !== "auto" ? ratioValue(S.ratio) : null,
      inputRatio: inSize.w / inSize.h, inputSize: inSize,
      outSize: S.outSize, fill: S.fill, background: S.background, format: S.format, contrast: S.contrast, bright: S.bright,
    });
    if (out.same) { j.outBlob = blob; j.w = j.aiW; j.h = j.aiH; j.ext = blob.type === "image/png" ? ".png" : ".jpg"; }
    else { j.outBlob = out.blob; j.w = out.w; j.h = out.h; j.ext = out.ext; j.note = out.note; }
    j.outUrl = URL.createObjectURL(j.outBlob);
    j.status = "ok";
    j.file.done = true;
    step(j, "完成");
    return "ok";
  }

  async function startBatch(list) {
    if (running) return;
    readSettings();
    saveSettings();
    if (!GEM.input()) { setStatus("没找到 Gemini 输入框：请先打开 gemini.google.com 的对话页面。", "bad"); return; }
    if (!list && files.length && files.every((f) => f.done)) {
      // 面板里的图都做过了（打了 ✓）：比如换了模型想再做一遍
      if (!confirm(`面板里的 ${files.length} 张图都已经做过（打了 ✓）。\n要把它们全部再做一遍吗？（之前的结果会保留）`)) return;
      files.forEach((f) => (f.done = false));
      renderThumbs();
    }
    list = list || files.filter((f) => !f.done).slice(0, S.batchSize);
    if (!list.length) { setStatus("没有要做的图片：先加图片。", "warn"); return; }
    running = true;
    abortCtl = new AbortController();
    const signal = abortCtl.signal;
    $("startBtn").disabled = true;
    $("stopBtn").disabled = false;
    const batchJobs = list.map((f, i) => ({ id: nextId++, file: f, mode: S.mode, status: "waiting", steps: [], idx: i + 1, total: list.length }));
    jobs.push(...batchJobs);
    renderJobs();
    let stopReason = "";
    for (let i = 0; i < batchJobs.length; i++) {
      const j = batchJobs[i];
      if (signal.aborted) break;
      setStatus(`第 ${i + 1}/${batchJobs.length} 张：${j.file.name}`);
      let r;
      try {
        r = await runOne(j, signal, i === 0);
      } catch (e) {
        if (signal.aborted) { j.status = "cancel"; break; }
        j.status = "fail";
        j.error = e.message;
        r = "fail";
      }
      j.endedAt = Date.now();
      renderJobs();
      renderThumbs();
      if (S.send === "B" && r !== "ok") {
        stopReason = { alert: j.error, limit: "Gemini 提示额度 / 频率限制", refused: "Gemini 拒绝出图", fail: "出错：" + j.error }[r];
        break;
      }
      if (S.send === "B" && i < batchJobs.length - 1) {
        // 页面上 data-aitutu-test-gap 只给自动测试用（把 20～60 秒缩短）
        const testGap = document.documentElement.dataset.aitutuTestGap;
        const gap = testGap !== undefined ? Number(testGap) : 20 + Math.floor(Math.random() * 41);
        try { await countdown(gap, signal, `第 ${i + 1} 张完成`); } catch { break; }
      }
    }
    batchJobs.filter((j) => j.status === "waiting" || j.status === "running").forEach((j) => (j.status = "cancel"));
    running = false;
    $("startBtn").disabled = false;
    $("stopBtn").disabled = true;
    renderJobs();
    const ok = batchJobs.filter((j) => j.status === "ok").length;
    if (signal.aborted) setStatus(`已停止。这一批完成 ${ok}/${batchJobs.length} 张。`, "warn");
    else if (stopReason) setStatus(`已自动停下：${stopReason}。完成 ${ok}/${batchJobs.length} 张。处理好后可以点“重做这张”或继续下一批。`, "bad");
    else setStatus(`这一批完成：${ok}/${batchJobs.length} 张。${files.some((f) => !f.done) ? "还有没做的图，可以点“开始这一批”继续。" : ""}`, ok === batchJobs.length ? "ok" : "warn");
  }
  $("startBtn").addEventListener("click", () => startBatch());
  $("stopBtn").addEventListener("click", () => { if (abortCtl) abortCtl.abort(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if ($("viewer").classList.contains("show")) $("viewer").classList.remove("show");
    else if ($("modal").classList.contains("show")) closeEditor();
  });

  renderThumbs();
  renderJobs();
})();
