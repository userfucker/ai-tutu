/**
 * AI图图 · 电商作图助手：右侧面板（2026-10-09；Gemini / Copilot 共用，网页操作走 AITUTU_SITE）
 *
 * 在 Gemini 页面右侧放一个可以左右收起的面板：上传 / 粘贴多张产品图，框选、标注配件、取色，
 * 选处理模式和参数，然后一批一批交给 Gemini 网页版生成（A：插件填好你按回车；B：插件自动发送），
 * 收回 1024 原图，用共用的 imagekit.js 做主体校准 / 抠透明底 / 调色 / 缩放，单张下载或打包 zip。
 * 页面自动操作在 content/gemini.js。
 */
(() => {
  if (window.__aitutuPanel) return;
  window.__aitutuPanel = true;
  const VERSION = "0.6.0";
  const SITE = AITUTU_SITE; // gemini.js 或 copilot.js 提供
  const AI = SITE.name;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------------ 设置
  const MODES = {
    white: { label: "抠白底图 1:1", locks: { ratio: "1:1", background: "white" }, outSizes: ["800", "1024"], formats: ["jpeg", "png-alpha"] },
    refine: { label: "图片精修", locks: { ratio: "auto", fill: "keep", angle: "keep", retouch: "on", format: "jpeg" }, outSizes: ["original", "800", "1024"], formats: ["jpeg"] },
    free: { label: "自由模式", locks: {}, outSizes: ["800", "1024", "original"], formats: ["jpeg", "png", "png-alpha"] },
  };
  const DEFAULTS = {
    mode: "white", ratio: "1:1", background: "white", outSize: "800", format: "jpeg", fill: "85", angle: "keep",
    retouch: "on", sharp: "keep", contrast: "0", bright: "0", requirement: "",
    batchSize: 10, session: "new", everyN: 5, send: "B", model: "Flash", extended: "any", holes: "auto",
    gapMin: 20, gapMax: 60, retryWait: 30, onFail: "stop", retryMax: 3, retryNewChat: false, askWhy: true, holesV: 2,
    refineBg: "original", // 图片精修的背景：original 原图背景（默认）/ white 白底图 / custom 自定义（写在精修要求里）
  };
  const LABELS = {
    outSize: { 800: "800×800", 1024: "1K（1024）", original: "AI 原尺寸" },
    format: { jpeg: "JPG", png: "PNG", "png-alpha": "PNG 透明底" },
  };
  let S = { ...DEFAULTS };
  // 设置按网站分开存（Gemini 一套、Copilot 一套），关了浏览器也保留，除非手动改
  const SETTINGS_KEY = `aitutuSettings:${SITE.id}`;
  // 精修要求不保存：刷新 / 重开浏览器后清空，免得上一个产品的描述（篮球）带到下一个产品（杯子）上
  const saveSettings = () => { try { chrome.storage.local.set({ [SETTINGS_KEY]: { ...S, requirement: "", productName: "" } }); } catch {} };

  // ------------------------------------------------------------ 状态
  let extraFiles = []; // “取当前会话的图”取回来的图（不是产品图，不在缩略图里，只给结果记录用）
  let files = []; // {id,name,size,type,dataUrl,base64,w,h,crop,mask,parts,partsNote,colors,sampler,done}
  let jobs = []; // {id,file,status,steps[],aiUrl,outBlob,outUrl,w,h,note,text,error,startedAt,endedAt}
  let nextId = 1;
  let running = false;
  let abortCtl = null;
  let panelActive = false;
  let sessionCount = 0; // 当前对话里已经做了几张
  let saveTimer = null, restoring = true; // 刷新后恢复面板内容（见文件末尾 saveTab / restoreTab）

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
  .dropmask { position: absolute; inset: 0; z-index: 4; display: none; place-items: center; background: rgba(24,24,27,.55); color: #fff; font-size: 18px; font-weight: 600;
    border: 3px dashed #fff; border-radius: 12px; pointer-events: none; }
  .wrap.dragging .dropmask { display: grid; }
  .thumbs { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin-top: 8px; }
  .thumb { position: relative; border-radius: 8px; overflow: hidden; border: 1px solid #e4e4e7; cursor: pointer; background: #f4f4f5; }
  .thumb { aspect-ratio: 1 / 1; }
  .thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
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
  .chathead { cursor: pointer; user-select: none; }
  .chatlist { max-height: 260px; overflow-y: auto; margin-top: 6px; }
  .chatlist label { display: flex; gap: 6px; align-items: center; padding: 3px 2px; font-size: 12px; border-bottom: 1px solid #f4f4f5; cursor: pointer; }
  .chatlist label span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chatlist .gone { color: #a1a1aa; text-decoration: line-through; }
  .setbox { margin-top: 8px; padding: 10px; border: 1px dashed #d4d4d8; border-radius: 10px; }
  .setbox input[type=number] { width: 100%; }
  .selbar { margin: 6px 0 2px; padding: 4px 0; border-bottom: 1px solid #f4f4f5; }
  .job { grid-template-columns: 16px 64px 64px 1fr !important; }
  .job .ck { margin-top: 24px; }
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
  .lasso { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .lasso path { fill: rgba(0,0,0,.45); }
  .lasso polygon, .lasso polyline { fill: none; stroke: #22c55e; stroke-width: 4; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
  .lasso polyline { stroke: rgba(34,197,94,.85); stroke-width: 6; }
  .sel.withLasso { box-shadow: none; border-style: dashed; border-color: rgba(34,197,94,.6); }
  .sel .h { position: absolute; width: 14px; height: 14px; background: #fff; border: 2px solid #22c55e; border-radius: 3px; }
  .h.nw { left: -8px; top: -8px; cursor: nwse-resize; } .h.ne { right: -8px; top: -8px; cursor: nesw-resize; }
  .h.sw { left: -8px; bottom: -8px; cursor: nesw-resize; } .h.se { right: -8px; bottom: -8px; cursor: nwse-resize; }
  .h.n { left: calc(50% - 7px); top: -8px; cursor: ns-resize; } .h.s { left: calc(50% - 7px); bottom: -8px; cursor: ns-resize; }
  .h.w { top: calc(50% - 7px); left: -8px; cursor: ew-resize; } .h.e { top: calc(50% - 7px); right: -8px; cursor: ew-resize; }
  /* 不是"框选商品"工具时：框变成细线，不能拖动、不能调大小 */
  .stage.painting .sel { border-width: 1px; box-shadow: none; }
  .stage.painting .sel .h { display: none; }
  .rotbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .rotbar input[type=range] { width: 140px; }
  .colors .crow { display: flex; gap: 6px; align-items: center; font-size: 12px; margin-top: 4px; }
  .crow .sw { width: 18px; height: 18px; border-radius: 5px; border: 1px solid #d4d4d8; flex: none; }
  .crow input { flex: 1; border: 1px solid #e4e4e7; border-radius: 7px; padding: 3px 6px; font: inherit; }
  /* 看大图 */
  .viewer { position: fixed; inset: 0; background: rgba(0,0,0,.88); display: none; z-index: 6; overflow: hidden; }
  .viewer.show { display: block; }
  .viewer img { position: absolute; left: 0; top: 0; transform-origin: 0 0; max-width: none; background: repeating-conic-gradient(#e4e4e7 0% 25%, #fff 0% 50%) 50% / 20px 20px; cursor: grab; }
  .vnav { position: absolute; top: 50%; transform: translateY(-50%); width: 46px; height: 64px; border: 0; border-radius: 10px; background: rgba(24,24,27,.6); color: #fff; font-size: 34px; line-height: 1; cursor: pointer; z-index: 2; }
  .vnav:hover { background: rgba(24,24,27,.9); }
  .vnav.prev { left: 14px; } .vnav.next { right: 14px; }
  .vidx { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); color: #ddd; font-size: 13px; background: rgba(24,24,27,.6); border-radius: 999px; padding: 2px 10px; }
  .cmenu { position: fixed; display: none; z-index: 8; background: #fff; border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.25); padding: 4px 0; min-width: 200px; }
  .cmenu div { padding: 8px 14px; cursor: pointer; font-size: 13px; white-space: nowrap; }
  .cmenu div:hover { background: #f4f4f5; }
  .vbar { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; gap: 6px; background: rgba(24,24,27,.9); border-radius: 999px; padding: 5px 8px; }
  .vbar button { background: rgba(255,255,255,.15); color: #fff; border: 0; border-radius: 999px; }
  .toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); background: #18181b; color: #fff; padding: 7px 14px; border-radius: 999px; display: none; z-index: 7; font-size: 13px; }
</style>
<div class="wrap" id="wrap">
  <div class="handle" id="handle" title="展开 / 收起 AI图图">AI<br>图<br>图<br>▶</div>
  <div class="dropmask">松开鼠标，添加图片</div>
  <div class="panel">
    <div class="card">
      <div class="row"><h2>AI图图 · 电商作图 · ${AI}</h2><span class="muted" style="margin-left:auto">v${VERSION}</span></div>
    </div>

    <div class="card">
      <div class="modes" id="modes">
        <button data-mode="white">抠白底图 1:1</button><button data-mode="refine">图片精修</button><button data-mode="free">自由模式</button>
      </div>
    </div>

    <div class="card">
      <div class="row"><b>产品图</b><span class="muted" id="count">0 张</span><button id="clearFiles" style="margin-left:auto" hidden>清空</button></div>
      <div class="drop" id="drop">点击选择，或把图片拖到面板任意位置，或点一下面板后按 Ctrl+V 粘贴<br><span class="muted">JPG / PNG / WebP，可以一次多张</span></div>
      <input type="file" id="fileInput" accept="image/png,image/jpeg,image/webp" multiple hidden>
      <div class="thumbs" id="thumbs"></div>
      <div class="muted" id="thumbHint" hidden>点缩略图：框选商品、画笔标注配件、吸管取色。</div>
    </div>

    <div class="card">
      <div class="row"><b>精修要求</b><select id="tplSel" style="margin-left:auto;max-width:60%" title="在“设置”里添加模板"><option value="">选择精修模板…</option></select></div>
      <div class="row" style="margin-top:6px;flex-wrap:nowrap"><span style="white-space:nowrap">这个是：</span><input id="productName" placeholder="产品名称（选填，模板里的 [产品名] 会换成它）" style="flex:1;border:1px solid #e4e4e7;border-radius:9px;padding:5px 8px;font:inherit"></div>
      <textarea id="requirement" placeholder="简单描述产品：是什么、什么材质、怎么摆放的；哪些是背景（例如：放在书上的手机壳，书本是背景）。颜色不用写，需要锁定颜色请用吸管取色。"></textarea>
      <div class="grid" style="margin-top:8px">
        <label class="f">背景<select id="background"><option value="white">白底图</option><option value="original">原图背景</option></select></label>
        <label class="f">尺寸比例<select id="ratio">
          <option value="auto">自动（跟原图）</option><option value="1:1">1:1 正方形</option><option value="3:4">3:4 竖版</option><option value="4:3">4:3 横版</option>
          <option value="2:3">2:3 竖版</option><option value="3:2">3:2 横版</option><option value="4:5">4:5 竖版</option><option value="5:4">5:4 横版</option>
          <option value="9:16">9:16 竖屏</option><option value="16:9">16:9 宽屏</option></select></label>
        <label class="f">输出尺寸<select id="outSize"></select></label>
        <label class="f">输出格式<select id="format"></select></label>
        <label class="f" id="holesWrap" hidden title="被产品围住的白色（枝叶间的空隙、戒指中间的孔、金属高光）怎么处理">镂空处<select id="holes"><option value="auto">自动（推荐）</option><option value="off">保留（白色都不抠）</option><option value="on">都抠透明</option></select></label>
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
        <label class="f" id="modelWrap">${AI} 模型<select id="model"><option value="Flash">Flash（推荐）</option><option value="Pro">Pro</option><option value="Flash-Lite">Flash-Lite</option><option value="">不切换（用网页上选的）</option></select></label>
        <label class="f" id="extendedWrap">扩展思考<select id="extended"><option value="any">不管</option><option value="off">关</option><option value="on">开</option></select></label>
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
      <div class="row selbar" id="selBar" hidden>
        <label class="muted"><input type="checkbox" id="selAll"> 全选</label><span class="muted" id="selCount"></span>
        <button id="selRetry" disabled>重做选中</button><button id="selZip" disabled>下载选中 zip</button><button id="selDel" class="danger" disabled>删除选中</button>
      </div>
      <div id="jobs"></div>
      <div class="row" style="margin-top:8px">
        <button id="zipBtn" disabled>打包下载 zip</button>
        <button id="grabBtn" title="把当前对话里 AI 生成的图都取回来（插件漏收的图也能拿回来），按现在的设置做后期">取当前会话的图</button>
        <button id="setBtn">设置</button>
        <button id="clearJobs" style="margin-left:auto">清空结果</button>
      </div>
      <div class="setbox" id="setBox" hidden>
        <div class="grid">
          <label class="f">每张间隔（秒，随机）<span class="row" style="flex-wrap:nowrap"><input type="number" id="gapMin" min="0" max="600">～<input type="number" id="gapMax" min="0" max="600"></span></label>
          <label class="f">失败后等待（秒）再重试<input type="number" id="retryWait" min="0" max="600"></label>
          <label class="f">被拒或出错时<select id="onFail"><option value="stop">自动停止</option><option value="retry">自动重试</option></select></label>
          <label class="f">每张最多重试（次）<input type="number" id="retryMax" min="1" max="10"></label>
        </div>
        <label class="muted" style="display:block;margin-top:8px"><input type="checkbox" id="askWhy"> 没出图时，先在同一个对话里发一句“怎么回事不生成图片？”</label>
        <label class="muted" style="display:block;margin-top:4px"><input type="checkbox" id="retryNewChat"> 重试时打开新会话（不勾就在原来的对话里重发）</label>
        <div style="margin-top:10px"><b>精修文本模板</b> <span class="muted">（可以用 [产品名] 代表“这个是：”里填的产品名；选模板会替换精修要求里原来的内容）</span></div>
        <div id="tplList"></div>
        <button id="tplAdd" style="margin-top:6px">添加模板</button>
        <div class="muted" style="margin-top:6px">间隔只用于 B 模式（自动发送）。重试几次还不行就记下来，接着做下一张。出现人机验证、额度 / 频率限制时总是停下。</div>
      </div>
    </div>
    <div class="card" id="chatCard" hidden>
      <div class="row chathead" id="chatHead"><b><span id="chatArrow">▸</span> ${AI} 会话管理</b><span class="muted" id="chatCount"></span>
        <button id="chatLoad" style="margin-left:auto">读取左侧会话</button></div>
      <div id="chatBody" hidden>
      <div class="muted">只能读到左侧已经显示出来的会话；想删更早的，先在左侧往下滚动，再点“读取”。删除后找不回来。</div>
      <div class="row" id="chatBar" hidden style="margin-top:6px">
        <label class="muted"><input type="checkbox" id="chatAll"> 全选</label>
        <button id="chatDel" class="danger" disabled>删除选中</button><button id="chatStop" disabled>停止</button>
      </div>
      <div id="chatList" class="chatlist"></div>
      <div class="status" id="chatStatus" hidden></div>
      </div>
    </div>
  </div>
</div>

<div class="modal" id="modal"><div class="mcard">
  <div class="row"><b id="mTitle" style="margin-right:auto"></b><button id="mPrev">上一张</button><button id="mNext">下一张</button></div>
  <div class="row">
    <div class="seg" id="tools"><button data-tool="crop" class="active">框选商品</button><button data-tool="lasso">自由框选</button><button data-tool="brush">画笔标注配件</button><button data-tool="eraser">橡皮擦</button><button data-tool="picker">吸管取色</button></div>
    <span class="muted">粗细</span><input type="range" id="brush" min="4" max="80" value="20" style="width:90px">
    <button id="markClear" title="清除当前工具画的内容（框选 / 自由框选 / 画笔标注 / 取色）">清除标注</button><button id="markClearAll" title="清除这张图的框选、自由框选、画笔标注和取色">全部清除</button>
  </div>
  <div class="rotbar"><span class="muted">旋转</span><button id="rotL" title="向左转 90°">↺ 90°</button><button id="rotR" title="向右转 90°">↻ 90°</button>
    <span class="muted">微调</span><input type="range" id="rotFine" min="-45" max="45" step="1" value="0"><span class="muted" id="rotVal">0°</span><button id="rotReset">复原</button>
    <span class="muted">（框选、标注会跟着一起转；发给 AI 的是转好的图）</span></div>
  <div class="muted" id="toolHint"></div>
  <div class="stage" id="stage"><img id="mImg" draggable="false"><canvas class="mark" id="markCv"></canvas><div class="picks" id="picks"></div>
    <svg class="lasso" id="lassoSvg" viewBox="0 0 100 100" preserveAspectRatio="none" style="display:none"><path id="lassoMask" fill-rule="evenodd"></path><polygon id="lassoPoly"></polygon><polyline id="lassoLine"></polyline></svg>
    <div class="sel" id="sel" hidden><span class="h nw" data-h="nw"></span><span class="h n" data-h="n"></span><span class="h ne" data-h="ne"></span><span class="h e" data-h="e"></span><span class="h se" data-h="se"></span><span class="h s" data-h="s"></span><span class="h sw" data-h="sw"></span><span class="h w" data-h="w"></span></div></div>
  <input id="partsNote" placeholder="配件说明（选填）：例如“右边两个白色插头是配件，必须保留”" style="border:1px solid #e4e4e7;border-radius:9px;padding:6px 8px;font:inherit">
  <div class="colors" id="colors"></div>
  <div class="row"><span class="muted" id="mInfo" style="margin-right:auto"></span>
    <button id="cropClear">清除框选</button><button id="cropAll">框选应用到所有图片</button><button id="mRemove" class="danger">移除这张</button><button class="primary" id="mOk" style="padding:5px 14px">完成</button></div>
</div></div>

<div class="viewer" id="viewer"><img id="vImg" draggable="false"><button class="vnav prev" id="vPrev" title="上一张（←）">‹</button><button class="vnav next" id="vNext" title="下一张（→）">›</button><span class="vidx" id="vIdx"></span><div class="vbar">
  <button data-z="out">－</button><button data-z="in">＋</button><button data-z="one">1:1</button><button data-z="fit">适应窗口</button><button data-z="close">关闭</button></div></div>
<div class="cmenu" id="cmenu"><div data-cm="add">添加到产品图（替换现有的产品图）</div><div data-cm="view">查看大图</div></div>
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
    // 背景：图片精修有"原图背景（默认）/ 白底图 / 自定义"，其他模式是"白底图 / 原图背景"
    $("background").innerHTML = S.mode === "refine"
      ? `<option value="original">原图背景</option><option value="white">白底图</option><option value="custom">自定义（写在精修要求里）</option>`
      : `<option value="white">白底图</option><option value="original">原图背景</option>`;
    for (const id of FIELDS) {
      const el = $(id);
      if (id in cfg.locks) {
        el.value = cfg.locks[id];
        el.disabled = true;
      } else {
        el.disabled = false;
        const want = id === "background" && S.mode === "refine" ? S.refineBg : S[id];
        el.value = [...el.options].some((o) => o.value === want) ? want : el.options[0].value;
      }
    }
    $("modelWrap").hidden = $("extendedWrap").hidden = !SITE.ensureMode;
    const alphaOpt = [...$("format").options].find((o) => o.value === "png-alpha");
    if (alphaOpt) {
      alphaOpt.disabled = $("background").value !== "white";
      if (alphaOpt.disabled && $("format").value === "png-alpha") $("format").value = "jpeg";
    }
    $("holesWrap").hidden = $("format").value !== "png-alpha";
  }
  function readSettings() {
    const bgBefore = S.background;
    for (const id of FIELDS) S[id] = $(id).value;
    if (S.mode === "refine") { S.refineBg = $("background").value; S.background = bgBefore; } // 精修的背景单独存
    S.productName = $("productName").value.trim();
    S.requirement = $("requirement").value.trim();
    S.batchSize = Math.max(1, Math.min(50, Number($("batchSize").value) || 10));
    S.session = $("session").value;
    S.everyN = Math.max(1, Math.min(50, Number($("everyN").value) || 5));
    S.send = $("send").value;
    S.model = $("model").value;
    S.holes = $("holes").value;
    S.gapMin = Math.max(0, Math.min(600, Number($("gapMin").value) || 0));
    S.gapMax = Math.max(S.gapMin, Math.min(600, Number($("gapMax").value) || 0));
    S.retryWait = Math.max(0, Math.min(600, Number($("retryWait").value) || 0));
    S.onFail = $("onFail").value;
    S.retryMax = Math.max(1, Math.min(10, Number($("retryMax").value) || 3));
    S.askWhy = $("askWhy").checked;
    S.retryNewChat = $("retryNewChat").checked;
    S.extended = $("extended").value;
  }
  function renderBatchHints() {
    $("everyNWrap").hidden = $("session").value !== "everyN";
    $("sendHint").textContent = $("send").value === "B"
      ? `B 模式：插件自动发送，每张之间随机等 ${S.gapMin}～${S.gapMax} 秒（在“设置”里改）；被拒 / 出错时${S.onFail === "retry" ? "自动重试" : "自动停下"}，遇到验证、额度提示停下，页面切到后台暂停。`
      : "A 模式：插件把图片和提示词填好后会提示你，你检查一下按回车发送，插件接着收图、准备下一张。";
  }
  function loadSettingsToUi() {
    $("requirement").value = "";
    S.requirement = "";
    $("batchSize").value = S.batchSize;
    $("session").value = S.session;
    $("everyN").value = S.everyN;
    $("send").value = S.send;
    $("model").value = S.model ?? "Flash";
    $("holes").value = S.holes || "off";
    $("gapMin").value = S.gapMin ?? 20;
    $("gapMax").value = S.gapMax ?? 60;
    $("retryWait").value = S.retryWait ?? 30;
    $("onFail").value = S.onFail || "stop";
    $("retryMax").value = S.retryMax ?? 3;
    $("askWhy").checked = S.askWhy !== false;
    $("retryNewChat").checked = !!S.retryNewChat;
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
  root.querySelectorAll("select, input[type=number], textarea#requirement, #askWhy, #retryNewChat").forEach((el) =>
    el.addEventListener("change", () => {
      if (FIELDS.includes(el.id) && !(el.id in MODES[S.mode].locks)) {
        if (el.id === "background" && S.mode === "refine") S.refineBg = el.value; else S[el.id] = el.value;
      }
      readSettings();
      applyMode();
      renderBatchHints();
      saveSettings();
    }),
  );
  try {
    chrome.storage.local.get([SETTINGS_KEY, "aitutuSettings", "aitutuClosed"], (r) => {
      // 0.2.0 以前只有一套设置（aitutuSettings），Gemini 第一次升级时接着用
      const saved = (r && r[SETTINGS_KEY]) || (SITE.id === "gemini" && r && r.aitutuSettings);
      if (saved) S = { ...DEFAULTS, ...saved };
      if (S.holesV !== 2) { if (S.holes === "off") S.holes = "auto"; S.holesV = 2; } // 0.4.0 起默认“自动”
      if (r && r.aitutuClosed) { $("wrap").classList.add("closed"); $("handle").innerHTML = "AI<br>图<br>图<br>◀"; }
      loadSettingsToUi();
    });
  } catch {
    loadSettingsToUi();
  }

  // ------------------------------------------------------------ 精修文本模板（Lee 2026-10-11）
  // 在"设置"里加多条，精修要求上方下拉选一条：替换精修要求框里的内容。Gemini / Copilot 共用一套，长期保存。
  let templates = [];
  const saveTemplates = () => { try { chrome.storage.local.set({ aitutuTemplates: templates }); } catch {} };
  function renderTemplates() {
    $("tplSel").innerHTML = `<option value="">选择精修模板…${templates.length ? "" : "（在“设置”里添加）"}</option>` +
      templates.map((t, i) => `<option value="${i}">${esc((t.split(/\n/)[0] || "").slice(0, 30) || `模板 ${i + 1}`)}</option>`).join("");
    $("tplList").innerHTML = templates.map((t, i) => `<div class="row" style="margin-top:6px;align-items:flex-start;flex-wrap:nowrap">
      <textarea data-tpl="${i}" rows="2" style="flex:1;min-height:44px">${esc(t)}</textarea><button data-tpldel="${i}" class="danger">删除</button></div>`).join("") ||
      `<div class="muted" style="margin-top:4px">还没有模板。</div>`;
  }
  $("tplAdd").addEventListener("click", () => { templates.push("这个是[产品名]，"); saveTemplates(); renderTemplates(); });
  $("tplList").addEventListener("input", (e) => {
    const i = e.target.dataset.tpl;
    if (i === undefined) return;
    templates[Number(i)] = e.target.value;
    saveTemplates();
    clearTimeout(renderTemplates.t);
    renderTemplates.t = setTimeout(() => { const sel = $("tplSel"); const v = sel.value; sel.innerHTML = ""; renderTemplatesSelectOnly(); sel.value = v; }, 400);
  });
  function renderTemplatesSelectOnly() {
    $("tplSel").innerHTML = `<option value="">选择精修模板…</option>` +
      templates.map((t, i) => `<option value="${i}">${esc((t.split(/\n/)[0] || "").slice(0, 30) || `模板 ${i + 1}`)}</option>`).join("");
  }
  $("tplList").addEventListener("click", (e) => {
    const i = e.target.dataset.tpldel;
    if (i === undefined) return;
    templates.splice(Number(i), 1);
    saveTemplates();
    renderTemplates();
  });
  $("tplSel").addEventListener("change", (e) => {
    const t = templates[Number(e.target.value)];
    e.target.value = "";
    if (t === undefined) return;
    $("requirement").value = t; // 每次只用一条：替换原来的内容
    S.requirement = t.trim();
    toast("已填入模板");
  });
  try { chrome.storage.local.get("aitutuTemplates", (r) => { templates = (r && Array.isArray(r.aitutuTemplates)) ? r.aitutuTemplates : []; renderTemplates(); }); } catch { renderTemplates(); }

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
    scheduleSave();
    $("count").textContent = `${files.length} 张，未做 ${files.filter((f) => !f.done).length} 张`;
    $("clearFiles").hidden = !files.length;
    $("thumbHint").hidden = !files.length;
    $("thumbs").innerHTML = files.map((f) => {
      const badge = [f.crop ? "框选" : "", f.parts?.length ? `配件${f.parts.length}` : "", f.colors?.length ? `色${f.colors.length}` : ""].filter(Boolean).join("·");
      // 缩略图一律是小正方形（图片完整放在里面），不跟图片长宽走；框选在点开后的编辑框里做
      return `<div class="thumb${f.done ? " done" : ""}" data-open="${f.id}" title="${esc(f.name)}">
        <img src="${f.dataUrl}">
        ${badge ? `<span class="badge">${badge}</span>` : ""}<button class="x" data-remove="${f.id}">×</button></div>`;
    }).join("");
  }
  $("drop").addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
  // 图片拖到面板任意位置都能加（不用对准虚线框）
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  let dragDepth = 0;
  const endDrag = () => { dragDepth = 0; $("wrap").classList.remove("dragging"); };
  $("wrap").addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); dragDepth++; $("wrap").classList.add("dragging"); });
  $("wrap").addEventListener("dragover", (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; $("wrap").classList.add("dragging"); });
  $("wrap").addEventListener("dragleave", (e) => { if (!hasFiles(e)) return; e.stopPropagation(); if (--dragDepth <= 0) endDrag(); });
  $("wrap").addEventListener("drop", (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); endDrag(); addFiles(e.dataTransfer.files); });
  document.addEventListener("dragend", endDrag, true);
  document.addEventListener("drop", endDrag, true);
  // guard.js 在网页之前拦住“拖到面板上”的事件（不让 Copilot 也收一份），交给这里处理
  window.__aitutuDragHook = (e) => {
    if (!hasFiles(e)) return;
    if (e.type === "dragenter" || e.type === "dragover") { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; $("wrap").classList.add("dragging"); }
    else if (e.type === "drop") { e.preventDefault(); endDrag(); addFiles(e.dataTransfer.files); }
  };
  window.__aitutuDragLeave = endDrag;
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
  // Ctrl+V：只在最近点过面板时接管（否则让网页自己处理粘贴）
  document.addEventListener("pointerdown", (e) => { panelActive = e.composedPath().includes(host); }, true);
  document.addEventListener("paste", (e) => {
    // 只接管你真按的 Ctrl+V；插件自己往网页输入框模拟的粘贴（isTrusted=false）不能拦
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
  let edIndex = -1, edRect = null, edLasso = null, drag = null, tool = "crop";
  const edFile = () => files[edIndex];
  const TOOL_HINT = {
    crop: "按住拖出一个框，把商品框进去（四周留一点空）。拖框内部移动，拖四个角调大小。",
    lasso: "像画笔一样按住鼠标沿着商品外面画一圈（任意形状），松开自动闭合；只把圈里面的内容交给 AI，圈外面涂白。再画一次就重新圈。",
    brush: `在容易被当成杂物的小配件上涂抹，连在一起的算一个配件；只发一张图给 ${AI}，配件的位置写在提示词里。`,
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
    edLasso = f.crop && f.lasso ? f.lasso.map((p) => ({ ...p })) : null;
    $("mImg").src = f.dataUrl;
    $("mTitle").textContent = `第 ${edIndex + 1}/${files.length} 张：${f.name}（${f.w}×${f.h}）`;
    $("mPrev").disabled = edIndex === 0;
    $("mNext").disabled = edIndex === files.length - 1;
    $("partsNote").value = f.partsNote || "";
    $("rotFine").value = f.fine || 0;
    $("rotVal").textContent = `${f.fine || 0}°`;
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
    // 自由框选：圈外变暗，圈的轮廓画绿线；外接矩形就是实际裁剪范围
    $("lassoSvg").style.display = edLasso ? "" : "none"; // SVG 元素改 .hidden 没用（0.5.1 自由框选看不见就是这个原因）
    if (edLasso) {
      const pts = edLasso.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`);
      const drawing = drag && drag.mode === "lasso";
      // 画的时候像画笔一样显示一条粗线；松开后闭合成圈，圈外变暗
      $("lassoLine").setAttribute("points", drawing ? pts.join(" ") : "");
      $("lassoPoly").setAttribute("points", drawing ? "" : pts.join(" "));
      $("lassoMask").setAttribute("d", drawing ? "" : `M0,0H100V100H0Z M${pts.join(" L")} Z`);
    }
    if (edLasso) {
      $("sel").hidden = true; // 自由框选不显示方框
      $("mInfo").textContent = (edRect ? `自由框选 ${Math.round(edRect.w * f.w)}×${Math.round(edRect.h * f.h)}（只发圈里的内容）` : "正在画…") + extra;
      return;
    }
    if (!edRect) { $("sel").hidden = true; $("mInfo").textContent = `未框选：整张图交给 ${AI}` + extra; return; }
    const sel = $("sel");
    sel.hidden = false;
    sel.classList.toggle("withLasso", !!edLasso);
    Object.assign(sel.style, { left: edRect.x * 100 + "%", top: edRect.y * 100 + "%", width: edRect.w * 100 + "%", height: edRect.h * 100 + "%" });
    $("mInfo").textContent = `${edLasso ? "自由框选" : "框选"} ${Math.round(edRect.w * f.w)}×${Math.round(edRect.h * f.h)}` + extra;
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
    f.lasso = f.crop && edLasso ? edLasso.map((p) => ({ ...p })) : null;
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
    // 画笔 = 滑动条的 15%，橡皮擦 = 滑动条的 50%
    g.lineWidth = Math.max(1, Number($("brush").value) * (tool === "eraser" ? 0.5 : 0.15)) * (m.width / shown);
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
    if (tool === "lasso") {
      drag = { mode: "lasso" };
      edLasso = [p];
      edRect = null;
      $("stage").setPointerCapture(e.pointerId);
      drawSel();
      return;
    }
    if (tool !== "crop") {
      drag = { mode: "paint", last: p };
      $("stage").setPointerCapture(e.pointerId);
      paintSeg(p, p);
      return;
    }
    const h = e.target.dataset.h;
    if (h && edRect) edLasso = null; // 拖点调大小就变回普通矩形框
    if (h && edRect) drag = { mode: "resize", h, orig: { ...edRect } };
    else if (e.target === $("sel") && edRect) drag = { mode: "move", start: p, orig: { ...edRect }, lassoOrig: edLasso && edLasso.map((q) => ({ ...q })) };
    else { drag = { mode: "new", start: p }; edRect = { x: p.x, y: p.y, w: 0, h: 0 }; edLasso = null; }
    $("stage").setPointerCapture(e.pointerId);
    drawSel();
  });
  $("stage").addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = stagePt(e);
    if (drag.mode === "paint") { paintSeg(drag.last, p); drag.last = p; return; }
    if (drag.mode === "lasso") {
      const last = edLasso[edLasso.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > 0.004) { edLasso.push(p); drawSel(); }
      return;
    }
    if (drag.mode === "resize") {
      // 8 个点：四角同时改两条边，四边中点只改一条边；不保持宽高比
      const o = drag.orig, h = drag.h, MIN = 0.02;
      let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
      if (h.includes("w")) x0 = Math.min(p.x, x1 - MIN);
      if (h.includes("e")) x1 = Math.max(p.x, x0 + MIN);
      if (h.includes("n")) y0 = Math.min(p.y, y1 - MIN);
      if (h.includes("s")) y1 = Math.max(p.y, y0 + MIN);
      edRect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    } else if (drag.mode === "move") {
      const o = drag.orig;
      edRect = { ...o, x: Math.min(1 - o.w, Math.max(0, o.x + p.x - drag.start.x)), y: Math.min(1 - o.h, Math.max(0, o.y + p.y - drag.start.y)) };
      if (edLasso && drag.lassoOrig) { const dx = edRect.x - o.x, dy = edRect.y - o.y; edLasso = drag.lassoOrig.map((q) => ({ x: q.x + dx, y: q.y + dy })); }
    } else {
      const s = drag.start;
      edRect = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) };
    }
    drawSel();
  });
  $("stage").addEventListener("pointerup", () => {
    if (drag && drag.mode === "lasso") {
      drag = null;
      if (edLasso.length < 3) { edLasso = null; drawSel(); return; }
      const xs = edLasso.map((q) => q.x), ys = edLasso.map((q) => q.y);
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      edRect = { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
      if (edRect.w < 0.02 || edRect.h < 0.02) { edRect = null; edLasso = null; }
      drawSel();
      return;
    }
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
  $("cropClear").addEventListener("click", () => { edRect = null; edLasso = null; drawSel(); });
  $("cropAll").addEventListener("click", () => {
    if (!edRect) { toast("先框一个区域"); return; }
    files.forEach((f) => { f.crop = { ...edRect }; f.lasso = edLasso ? edLasso.map((q) => ({ ...q })) : null; });
    toast(`框选已应用到全部 ${files.length} 张`);
  });
  // 清除标注：只清当前工具画的内容；全部清除：这张图的框选、自由框选、画笔标注、取色都清掉
  function clearMarks(kind) {
    const f = edFile();
    if (kind === "all" || kind === "crop") { if (!edLasso) edRect = null; }
    if (kind === "all" || kind === "lasso") { if (edLasso) edRect = null; edLasso = null; }
    if (kind === "all" || kind === "brush" || kind === "eraser") { f.mask = null; f.parts = []; drawMark(); }
    if (kind === "all" || kind === "picker") { f.colors = []; renderPicks(); }
    drawSel();
  }
  // ------------------------------------------------------------ 旋转（Lee 2026-10-11）
  // 角度 = 90° 的整数倍（左右转按钮）+ 微调（-45°～45°）。每次都从原图重新转（不会越转越糊），
  // 框选、自由框选、画笔标注、取色点跟着一起转；发给 AI 的就是转好的图。
  async function rotateTo(f, rot90, fine) {
    if (!f.orig) f.orig = { dataUrl: f.dataUrl, w: f.w, h: f.h, type: f.type, size: f.size };
    const oldA = (f.rot90 || 0) + (f.fine || 0);
    const newA = rot90 + fine;
    const delta = newA - oldA;
    if (!delta) return;
    const img = await loadImage(f.orig.dataUrl);
    if (!img) return;
    const W0 = f.orig.w, H0 = f.orig.h;
    const rad = (newA * Math.PI) / 180;
    const right = newA % 90 === 0; // 90° 整数倍：尺寸精确对调，不留白边
    const c = right ? Math.round(Math.abs(Math.cos(rad))) : Math.abs(Math.cos(rad));
    const sn = right ? Math.round(Math.abs(Math.sin(rad))) : Math.abs(Math.sin(rad));
    const W = Math.round(W0 * c + H0 * sn), H = Math.round(W0 * sn + H0 * c);
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    g.fillStyle = "#ffffff"; // 微调转出来的四个角补白
    g.fillRect(0, 0, W, H);
    g.translate(W / 2, H / 2);
    g.rotate(rad);
    g.imageSmoothingQuality = "high";
    g.drawImage(img, -W0 / 2, -H0 / 2);
    const png = f.orig.type === "image/png";
    const blob = await canvasToBlob(cv, png ? "image/png" : "image/jpeg", 0.95);
    const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
    // 标注坐标：旧图（f.w×f.h）→ 新图（W×H），绕中心转 delta
    const dr = (delta * Math.PI) / 180, cs = Math.cos(dr), si = Math.sin(dr);
    const tp = (q) => {
      const x = q.x * f.w - f.w / 2, y = q.y * f.h - f.h / 2;
      return { x: Math.min(1, Math.max(0, (x * cs - y * si + W / 2) / W)), y: Math.min(1, Math.max(0, (x * si + y * cs + H / 2) / H)) };
    };
    const bbox = (pts) => {
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
    };
    if (f.lasso && f.lasso.length > 2) {
      f.lasso = f.lasso.map(tp);
      f.crop = bbox(f.lasso);
    } else if (f.crop) {
      const r = f.crop;
      f.crop = bbox([{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h }].map(tp));
    }
    if (f.colors) f.colors = f.colors.map((c0) => ({ ...c0, ...tp(c0) }));
    if (f.mask) {
      const k = f.mask.width / f.w;
      const m = document.createElement("canvas");
      m.width = Math.max(1, Math.round(W * k)); m.height = Math.max(1, Math.round(H * k));
      const mg = m.getContext("2d");
      mg.translate(m.width / 2, m.height / 2);
      mg.rotate(dr);
      mg.drawImage(f.mask, -f.mask.width / 2, -f.mask.height / 2);
      f.mask = m;
      f.parts = findParts(m);
    }
    Object.assign(f, { dataUrl, base64: dataUrl.split(",")[1], w: W, h: H, type: blob.type, size: blob.size, rot90, fine, sampler: null });
  }
  async function rotateEditor(rot90, fine) {
    const f = edFile();
    if (!f) return;
    saveEditor();
    await rotateTo(f, ((rot90 % 360) + 360) % 360, fine);
    showEditor();
    renderThumbs();
  }
  $("rotL").addEventListener("click", () => { const f = edFile(); rotateEditor((f.rot90 || 0) - 90, f.fine || 0); });
  $("rotR").addEventListener("click", () => { const f = edFile(); rotateEditor((f.rot90 || 0) + 90, f.fine || 0); });
  $("rotFine").addEventListener("input", (e) => { $("rotVal").textContent = `${e.target.value}°`; });
  $("rotFine").addEventListener("change", (e) => { const f = edFile(); rotateEditor(f.rot90 || 0, Number(e.target.value)); });
  $("rotReset").addEventListener("click", () => rotateEditor(0, 0));

  $("markClear").addEventListener("click", () => clearMarks(tool));
  $("markClearAll").addEventListener("click", () => clearMarks("all"));
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
  // 看大图：结果里的所有图（交给 AI 的图、修好的图，从左到右、从上到下）用左右箭头循环切换
  let vList = [], vPos = 0;
  function showAt(i) {
    if (!vList.length) return;
    vPos = (i + vList.length) % vList.length;
    $("vImg").onload = vFit;
    $("vImg").src = vList[vPos];
    $("vIdx").textContent = vList.length > 1 ? `${vPos + 1} / ${vList.length}` : "";
    $("vPrev").hidden = $("vNext").hidden = vList.length < 2;
  }
  function openViewer(src, list) {
    vList = list && list.length ? list : [src];
    $("viewer").classList.add("show");
    showAt(Math.max(0, vList.indexOf(src)));
  }
  const jobImages = () => [...$("jobs").querySelectorAll("img[data-view]")].map((im) => im.dataset.view);
  $("vPrev").addEventListener("click", (e) => { e.stopPropagation(); showAt(vPos - 1); });
  $("vNext").addEventListener("click", (e) => { e.stopPropagation(); showAt(vPos + 1); });
  document.addEventListener("keydown", (e) => {
    if (!$("viewer").classList.contains("show")) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); showAt(vPos - 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); showAt(vPos + 1); }
  }, true);
  $("viewer").addEventListener("wheel", (e) => { e.preventDefault(); vZoom(V.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY); }, { passive: false });
  $("viewer").addEventListener("pointerdown", (e) => {
    if (e.target.closest(".vbar") || e.target.closest(".vnav")) return;
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
  /** 结果里的文件名：超过 10 个字只显示前 10 个（鼠标停上去看全名） */
  const shortName = (n) => { const base = n.replace(/\.[^.]+$/, ""); return base.length > 10 ? base.slice(0, 10) + "…" : base; };
  /** 处理说明 + 模型合成一个标签，去掉重复的话（PNG 就是透明底，不用再写“透明底”） */
  function infoTag(j) {
    const parts = (j.note || "").split("，").filter(Boolean).map((t) => (/^白底提纯/.test(t) ? "白底提纯" : t === "透明底（含镂空）" ? "含镂空" : t)).filter((t) => t !== "透明底");
    if (j.model) parts.push(j.model + (j.modeWarn ? " ⚠" : ""));
    return parts.length ? `<span class="tag${j.modeWarn ? " warn" : ""}" title="${esc([j.note, j.modeWarn].filter(Boolean).join("；"))}">${esc(parts.join(" · "))}</span>` : "";
  }
  function renderJobs() {
    scheduleSave();
    $("jobs").innerHTML = jobs.slice().reverse().map((j) => {
      const [label, cls] = STATUS[j.status];
      const sec = j.endedAt ? ` ${((j.endedAt - j.startedAt) / 1000).toFixed(0)} 秒` : "";
      return `<div class="job">
        <input type="checkbox" class="ck" data-sel="${j.id}" ${sel.has(j.id) ? "checked" : ""}>
        <img src="${j.inputUrl || j.file.dataUrl}" data-view="${j.inputUrl || j.file.dataUrl}" title="交给 ${AI} 的图">
        ${j.outUrl ? `<img src="${j.outUrl}" data-view="${j.outUrl}" title="最终输出">` : `<div class="ph">${j.status === "running" ? "生成中…" : "—"}</div>`}
        <div><div title="${esc(j.file.name)}"><b>${esc(shortName(j.file.name))}</b></div>
          <span class="tag ${cls}">${label}${sec}${j.retries ? `（重试 ${j.retries} 次）` : ""}</span>${j.w ? `<span class="tag">${j.w}×${j.h}${j.ext === ".png" ? " PNG" : ""}</span>` : ""}${infoTag(j)}
          ${j.partCount ? `<span class="tag warn">标注配件 ${j.partCount} 处，请核对</span>` : ""}
          ${j.status !== "ok" && j.steps.length ? `<div class="txt">${esc(j.steps[j.steps.length - 1])}</div>` : ""}
          ${j.error ? `<div class="txt" style="color:#b91c1c">${esc(j.error)}</div>` : ""}
          ${j.text && j.status !== "ok" ? `<div class="txt">${AI}：${esc(j.text.slice(0, 160))}</div>` : ""}
          <div class="row" style="margin-top:3px">
            ${j.outUrl ? `<button data-dl="${j.id}">下载</button>` : ""}
            ${["refused", "fail", "cancel"].includes(j.status) && !running && !j.file.fromChat ? `<button data-retry="${j.id}">重做这张</button>` : ""}
            ${j.status !== "running" ? `<button data-del="${j.id}" class="danger" title="删除这条结果和面板里对应的产品图">删除</button>` : ""}
          </div></div></div>`;
    }).join("");
    const ok = jobs.filter((j) => j.status === "ok").length;
    $("sumText").textContent = jobs.length ? `共 ${jobs.length} 张，完成 ${ok}` : "";
    $("zipBtn").disabled = !ok;
    for (const id of [...sel]) if (!jobs.some((j) => j.id === id)) sel.delete(id);
    $("selBar").hidden = !jobs.length;
    $("selCount").textContent = sel.size ? `已选 ${sel.size}` : "";
    $("selAll").checked = jobs.length > 0 && sel.size === jobs.length;
    $("selRetry").disabled = running || !selJobs().some((j) => j.status !== "running");
    $("selZip").disabled = !selJobs().some((j) => j.status === "ok");
    $("selDel").disabled = !selJobs().some((j) => j.status !== "running");
  }
  // ---- 多选：重做 / 下载 zip / 删除
  const sel = new Set();
  const selJobs = () => jobs.filter((j) => sel.has(j.id));
  /** 删除结果，同时把面板里对应的产品图删掉（正在做的那张不能删） */
  function deleteJobs(list) {
    list = list.filter((j) => j.status !== "running");
    list.forEach((j) => { j.removed = true; sel.delete(j.id); });
    jobs = jobs.filter((j) => !j.removed);
    // 产品图只有在它的记录全删光了才一起删（同一张图可能有好几条成功记录）
    const delFiles = new Set(list.map((j) => j.file).filter((f) => !jobs.some((x) => x.file === f)));
    files = files.filter((f) => !delFiles.has(f));
    extraFiles = extraFiles.filter((f) => !delFiles.has(f));
    renderJobs();
    renderThumbs();
    return list.length;
  }
  /** 重做：就在原来那条记录上重做（不新加记录，失败的记录不会留在列表里） */
  function retryJobs(list) {
    if (running) { toast("正在处理，先点“停止”"); return; }
    list = list.filter((j) => j.status !== "running" && !j.file.fromChat);
    const fs = [...new Set(list.map((j) => j.file))];
    fs.forEach((f) => (f.done = false));
    list.forEach((j) => sel.delete(j.id));
    if (fs.length) startBatch(fs);
  }
  async function zipJobs(list) {
    const ok = list.filter((j) => j.status === "ok");
    if (!ok.length) { toast("没有可下载的图"); return; }
    const used = new Set();
    const items = ok.map((j) => {
      let n = outName(j), k = 2;
      while (used.has(n)) n = outName(j).replace(/(\.[a-z]+)$/, `-${k++}$1`);
      used.add(n);
      return { name: n, blob: j.outBlob };
    });
    downloadBlob(await makeZip(items), `AI图图-${bj().replace(/[-: ]/g, "").slice(0, 14)}.zip`);
  }
  $("selAll").addEventListener("change", () => { if ($("selAll").checked) jobs.forEach((j) => sel.add(j.id)); else sel.clear(); renderJobs(); });
  $("selRetry").addEventListener("click", () => retryJobs(selJobs()));
  $("selZip").addEventListener("click", () => zipJobs(selJobs()));
  $("selDel").addEventListener("click", () => { const n = deleteJobs(selJobs()); toast(`已删除 ${n} 条`); });
  $("setBtn").addEventListener("click", () => { $("setBox").hidden = !$("setBox").hidden; });
  $("jobs").addEventListener("change", (e) => {
    const id = Number(e.target.dataset.sel);
    if (!id) return;
    if (e.target.checked) sel.add(id); else sel.delete(id);
    renderJobs();
  });
  // 结果里的图（修好的图 / 交给 AI 的图）右键"添加"：清空现有产品图，把这张放进去，方便接着调整
  let cmTarget = null;
  $("jobs").addEventListener("contextmenu", (e) => {
    const im = e.target.closest("img[data-view]");
    if (!im) return;
    e.preventDefault();
    cmTarget = im;
    const m = $("cmenu");
    m.style.display = "block";
    m.style.left = Math.min(e.clientX, innerWidth - 220) + "px";
    m.style.top = Math.min(e.clientY, innerHeight - 90) + "px";
  });
  document.addEventListener("pointerdown", (e) => { if (!e.composedPath().includes($("cmenu"))) $("cmenu").style.display = "none"; }, true);
  $("cmenu").addEventListener("click", async (e) => {
    const act = e.target.dataset.cm;
    $("cmenu").style.display = "none";
    if (!act || !cmTarget) return;
    const src = cmTarget.dataset.view;
    if (act === "view") { openViewer(src, jobImages()); return; }
    if (running) { toast("正在处理，先点“停止”"); return; }
    try {
      const blob = await (await fetch(src)).blob();
      const jobEl = cmTarget.closest(".job");
      const base = (jobEl && jobEl.querySelector("b") ? jobEl.querySelector("b").textContent : "结果").replace(/\.[^.]+$/, "");
      const isOut = cmTarget.title === "最终输出";
      const type = /^image\/(png|jpeg|webp)$/.test(blob.type) ? blob.type : "image/png";
      const file = new File([blob], `${base}-${isOut ? "修好" : "原图"}.${type === "image/jpeg" ? "jpg" : type.split("/")[1]}`, { type });
      files = [];
      await addFiles([file]);
      toast("已添加到产品图（原来的产品图已清空）");
    } catch (err) {
      toast("添加失败：" + (err && err.message ? err.message : err));
    }
  });
  $("jobs").addEventListener("click", (e) => {
    const del = Number(e.target.dataset.del);
    if (del) { deleteJobs(jobs.filter((x) => x.id === del)); return; }
    const v = e.target.dataset.view;
    if (v) { openViewer(v, jobImages()); return; }
    const dl = Number(e.target.dataset.dl);
    if (dl) { const j = jobs.find((x) => x.id === dl); downloadBlob(j.outBlob, outName(j)); return; }
    const rt = Number(e.target.dataset.retry);
    if (rt) retryJobs(jobs.filter((x) => x.id === rt));
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
  $("zipBtn").addEventListener("click", () => zipJobs(jobs));
  $("clearJobs").addEventListener("click", () => {
    if (running) { toast("正在处理，先点“停止”"); return; }
    jobs = [];
    sel.clear();
    renderJobs();
  });
  // ------------------------------------------------------------ 批量处理
  function step(j, msg) {
    j.steps.push(`${((Date.now() - j.startedAt) / 1000).toFixed(1)}s ${msg}`);
    renderJobs();
  }
  async function waitVisible(signal) {
    while (document.visibilityState !== "visible") {
      if (signal.aborted) throw new Error("已停止");
      setStatus(`${AI} 页面在后台，已暂停。切回这个标签页后自动继续。`, "warn");
      await sleep(1000);
    }
  }
  async function countdown(sec, signal, what, tail = "秒后发送下一张…") {
    for (let t = sec; t > 0; t--) {
      if (signal.aborted) throw new Error("已停止");
      setStatus(`${what}：${t} ${tail}`, "");
      await sleep(1000);
    }
  }
  function aiRatioOf(f) {
    if (S.mode === "white") return "1:1";
    if (S.mode === "refine" || S.ratio === "auto") { const s = inputSize(f); return closestAiRatio(s.w || 1, s.h || 1); }
    return S.ratio;
  }

  /** AI 出图 → 按当前设置后期处理，结果写进记录 j（inSize = 交给 AI 的图的尺寸，用来定比例） */
  async function finishJob(j, blob, inSize) {
    j.aiUrl = URL.createObjectURL(blob);
    const img = await loadImage(j.aiUrl);
    j.aiW = img.naturalWidth; j.aiH = img.naturalHeight; j.aiBytes = blob.size;
    step(j, `收到 ${j.aiW}×${j.aiH}，后期处理`);
    inSize = inSize || { w: j.aiW, h: j.aiH };
    const out = await composeOutput(img, {
      ratio: S.mode === "white" ? 1 : S.mode === "free" && S.ratio !== "auto" ? ratioValue(S.ratio) : null,
      inputRatio: inSize.w / inSize.h, inputSize: inSize,
      outSize: S.outSize, fill: S.fill, background: S.mode === "refine" ? (S.refineBg === "white" ? "white" : "original") : S.background, format: S.format, contrast: S.contrast, bright: S.bright,
      holes: S.holes === "on" ? true : S.holes === "off" ? false : "auto",
    });
    if (out.same) { j.outBlob = blob; j.w = j.aiW; j.h = j.aiH; j.ext = blob.type === "image/png" ? ".png" : ".jpg"; }
    else { j.outBlob = out.blob; j.w = out.w; j.h = out.h; j.ext = out.ext; j.note = out.note; }
    j.outUrl = URL.createObjectURL(j.outBlob);
  }

  async function runOne(j, signal, isFirst) {
    j.status = "running";
    j.startedAt = Date.now();
    renderJobs();
    await waitVisible(signal);
    // 1. 准备图片（框选、标注图、特写）
    const input = await prepareInput(j.file, { single: true }); // 只发一张图（配件位置写进提示词）
    j.inputW = input.w; j.inputH = input.h;
    j.inputUrl = input.cropped ? input.dataUrl : null;
    j.partCount = input.partCount;
    const toFile = (b64, name, type = "image/jpeg") => new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type });
    const upload = [toFile(input.base64, input.cropped ? input.name : j.file.name, input.cropped ? "image/jpeg" : j.file.type)];
    input.extras.forEach((x, i) => upload.push(toFile(x.base64, x.kind === "mark" ? "配件标注图.jpg" : `配件特写${i}.jpg`)));
    j.aiRatio = aiRatioOf(j.file);
    // 2. 会话
    const needNew = j.forceChat ? j.forceChat === "new" : S.session === "new" || (S.session === "everyN" && sessionCount % S.everyN === 0);
    j.newChat = needNew;
    if (needNew) {
      step(j, "发起新对话");
      await SITE.newChat(signal);
      sessionCount = 0;
    }
    // 模型：每张发之前看一眼，不对就切（新对话有时会变回默认模型）
    const wantExt = S.extended === "on" ? true : S.extended === "off" ? false : null;
    if (SITE.ensureMode && (S.model || wantExt !== null)) {
      // 切换失败不停下：按网页上当前的模型继续做，结果上标黄色提示
      try {
        const before = SITE.currentMode();
        const after = await SITE.ensureMode(S.model, wantExt, signal);
        if (before && after && before.label !== after.label) step(j, `切换模型：${before.label} → ${after.label}`);
      } catch (e) {
        if (signal.aborted) throw e;
        j.modeWarn = `模型没切成（${e.message}），用的是网页当前的模型`;
        step(j, "⚠ " + j.modeWarn);
      }
    }
    j.model = SITE.currentMode ? SITE.currentMode()?.label || "（没找到模型按钮）" : "";
    const ps = { ...S, requirement: fillProduct(j.req || "", j.productName || ""), productName: j.productName || "", background: S.mode === "refine" ? S.refineBg : S.background };
    j.prompt = buildWebPrompt(ps, j.file, j.aiRatio, { fresh: !needNew && (sessionCount > 0 || !isFirst || SITE.hasMessages()) });
    // 3. 填图和提示词
    await SITE.clearInput(signal);
    step(j, `贴图 ${upload.length} 张`);
    await SITE.pasteFiles(upload, signal);
    step(j, "填提示词");
    await SITE.insertText(j.prompt, signal);
    step(j, "等图片上传完");
    await SITE.waitReady(upload.length, signal);
    const base = SITE.mark();
    // 4. 发送
    if (S.send === "B") {
      step(j, "自动发送");
      SITE.clickSend();
    } else {
      setStatus(`第 ${j.idx}/${j.total} 张已经填好：请检查 ${AI} 输入框，按回车发送。`, "warn");
      step(j, "等你按回车发送");
      await SITE.waitUserSend(base, signal);
    }
    sessionCount++;
    if (SITE.verifySent) await SITE.verifySent(base, upload.length, signal); // 图片真的发出去了吗（Copilot 偶尔收不到图）
    setStatus(`第 ${j.idx}/${j.total} 张：等 ${AI} 出图…`);
    step(j, `等 ${AI} 出图`);
    let r = await SITE.waitResult(base, signal);
    // 没出图：同一个对话里催一次。回的是“参数文字”（Copilot 实测回了 {"orientation":"square"}）用专门的话，
    // 其他情况在设置里勾了“发一句”就问“怎么回事不生成图片？”
    const nudge = !r.alert && r.refused ? (SITE.nudge && SITE.nudge(r.text || "")) || (S.askWhy ? "怎么回事不生成图片？" : "") : "";
    if (nudge) {
      step(j, `${AI} 没出图，只回了：${(r.text || "").slice(0, 60)}；再催一次`);
      j.nudged = r.text;
      await SITE.clearInput(signal);
      await SITE.insertText(nudge, signal);
      await SITE.waitReady(0, signal);
      const base2 = SITE.mark();
      if (S.send === "B") SITE.clickSend();
      else {
        setStatus(`第 ${j.idx}/${j.total} 张：${AI} 没出图，插件填好了催促的话，请按回车发送。`, "warn");
        await SITE.waitUserSend(base2, signal);
      }
      r = await SITE.waitResult(base2, signal, base); // 第一次发送以后出来的图也算（图晚到的情况）
    }
    if (r.alert) { j.status = "fail"; j.error = r.alert; return "alert"; }
    j.text = r.text || "";
    if (r.refused) {
      j.status = "refused";
      step(j, `${AI} 没有出图`);
      return SITE.limitRe.test(j.text) ? "limit" : "refused";
    }
    // 5. 收图 + 后期
    const blob = await SITE.grabImage(r.img);
    j.aiSrc = r.img.currentSrc || r.img.src;
    await finishJob(j, blob, { w: input.w, h: input.h });
    j.status = "ok";
    j.file.done = true;
    step(j, "完成");
    return "ok";
  }

  async function startBatch(list) {
    if (running) return;
    readSettings();
    saveSettings();
    if (!SITE.input()) { setStatus(`没找到 ${AI} 输入框：请先打开 ${SITE.home} 的对话页面。`, "bad"); return; }
    if (!list && files.length && files.every((f) => f.done)) {
      // 面板里的图都做过了（打了 ✓）：比如换了模型想再做一遍
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
    // 每张图只有一条记录：这张图以前做过就在原记录上重做（清掉旧结果），没做过才新建
    const batchJobs = list.map((f, i) => {
      // 成功的记录保留（同一张图做几次好对比提示词）；只有失败 / 被拒 / 停止的记录会被这次的结果覆盖
      const old = jobs.filter((x) => x.file === f && x.status !== "ok").pop();
      // 精修要求框做完一批就清空：重做时框是空的，就用这张图上次用的要求和产品名
      const prev = jobs.filter((x) => x.file === f).pop();
      const req = S.requirement || (prev && prev.req) || "";
      const productName = S.productName || (prev && prev.productName) || "";
      const fresh = { file: f, mode: S.mode, status: "waiting", steps: [], idx: i + 1, total: list.length, error: "", text: "", nudged: "", retries: 0,
        aiUrl: null, outBlob: null, outUrl: null, outData: null, w: 0, h: 0, ext: "", note: "", model: "", modeWarn: "", startedAt: 0, endedAt: 0, inputUrl: null, forceChat: "", req, productName };
      if (old) { Object.assign(old, fresh); return old; }
      const j = { id: nextId++, ...fresh };
      jobs.push(j);
      return j;
    });
    renderJobs();
    let stopReason = "";
    let retried = 0, failedKept = 0;
    // 页面上 data-aitutu-test-gap 只给自动测试用（把间隔缩短成固定秒数）
    const testGap = document.documentElement.dataset.aitutuTestGap;
    const gapSec = () => (testGap !== undefined ? Number(testGap) : S.gapMin + Math.floor(Math.random() * (S.gapMax - S.gapMin + 1)));
    for (let i = 0; i < batchJobs.length; i++) {
      const j = batchJobs[i];
      if (signal.aborted) break;
      if (j.removed) continue; // 排队时被删掉了
      let r = "";
      j.forceChat = "";
      const maxAttempts = S.send === "B" && S.onFail === "retry" ? 1 + S.retryMax : 1;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt) {
          // 自动重试：等一会儿，同一张再做一次（在原对话里重发，或者按设置开新会话）
          retried++;
          j.retries = attempt;
          j.forceChat = S.retryNewChat ? "new" : "same";
          j.error = ""; j.text = ""; j.nudged = "";
          const wait = testGap !== undefined ? Number(testGap) : S.retryWait;
          try { await countdown(wait, signal, `第 ${i + 1} 张没成功，重试`, "秒后重试…"); } catch { break; }
          j.steps.push(`—— 第 ${attempt + 1} 次 ——`);
        }
        setStatus(`第 ${i + 1}/${batchJobs.length} 张：${j.file.name}${attempt ? "（重试）" : ""}`);
        try {
          r = await runOne(j, signal, i === 0 && !attempt);
        } catch (e) {
          if (signal.aborted) { j.status = "cancel"; break; }
          j.status = "fail";
          j.error = e.message;
          r = "fail";
        }
        j.endedAt = Date.now();
        renderJobs();
        renderThumbs();
        // 重试只管“被拒 / 出错”；验证、额度提示重试也没用
        if (r === "ok" || signal.aborted || S.send !== "B" || S.onFail !== "retry" || !["refused", "fail"].includes(r)) break;
      }
      if (signal.aborted) break;
      if (S.send === "B" && r !== "ok") {
        if (S.onFail === "retry" && ["refused", "fail"].includes(r)) failedKept++; // 重试过还不行：记下，接着做下一张
        else {
          stopReason = { alert: j.error, limit: `${AI} 提示额度 / 频率限制`, refused: `${AI} 拒绝出图`, fail: "出错：" + j.error }[r];
          break;
        }
      }
      if (S.send === "B" && i < batchJobs.length - 1) {
        try { await countdown(gapSec(), signal, `第 ${i + 1} 张${r === "ok" ? "完成" : "没成功"}`); } catch { break; }
      }
    }
    batchJobs.filter((j) => j.status === "waiting" || j.status === "running").forEach((j) => (j.status = "cancel"));
    if (!signal.aborted) {
      // 做完一批（或一张）：清空精修要求和产品名，免得带到下一个产品上（重做时会用这张图上次的要求）
      $("requirement").value = "";
      $("productName").value = "";
      S.requirement = "";
      S.productName = "";
    }
    running = false;
    $("startBtn").disabled = false;
    $("stopBtn").disabled = true;
    renderJobs();
    const ok = batchJobs.filter((j) => j.status === "ok").length;
    if (signal.aborted) setStatus(`已停止。这一批完成 ${ok}/${batchJobs.length} 张。`, "warn");
    else if (stopReason) setStatus(`已自动停下：${stopReason}。完成 ${ok}/${batchJobs.length} 张。处理好后可以点“重做这张”或继续下一批。`, "bad");
    else if (failedKept) setStatus(`这一批做完了：完成 ${ok}/${batchJobs.length} 张，${failedKept} 张重试后还是没成功（可以勾选后“重做选中”）。`, "warn");
    else setStatus(`这一批完成：${ok}/${batchJobs.length} 张。${files.some((f) => !f.done) ? "还有没做的图，可以点“开始这一批”继续。" : ""}`, ok === batchJobs.length ? "ok" : "warn");
  }
  // ------------------------------------------------------------ 会话管理（批量删除左侧会话，目前只有 Copilot）
  let chats = [];
  const chatSel = new Set();
  let chatAbort = null;
  if (SITE.listChats) $("chatCard").hidden = false;
  // 折叠：点标题展开 / 收起（默认收起，记住上次的状态）
  const setChatOpen = (open) => { $("chatBody").hidden = !open; $("chatArrow").textContent = open ? "▾" : "▸"; };
  $("chatHead").addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    const open = $("chatBody").hidden;
    setChatOpen(open);
    try { chrome.storage.local.set({ aitutuChatOpen: open }); } catch {}
  });
  try { chrome.storage.local.get("aitutuChatOpen", (r) => setChatOpen(!!(r && r.aitutuChatOpen))); } catch {}
  const chatStatus = (msg, kind = "") => { $("chatStatus").hidden = !msg; $("chatStatus").className = "status" + (kind ? " " + kind : ""); $("chatStatus").textContent = msg; };
  function renderChats() {
    $("chatBar").hidden = !chats.length;
    $("chatCount").textContent = chats.length ? `${chats.length} 个，选中 ${chatSel.size}` : "";
    $("chatAll").checked = chats.length > 0 && chats.filter((c) => !c.gone).every((c) => chatSel.has(c.id));
    $("chatDel").disabled = !!chatAbort || !chatSel.size;
    $("chatList").innerHTML = chats.map((c) => `<label class="${c.gone ? "gone" : ""}"><input type="checkbox" data-chat="${esc(c.id)}" ${chatSel.has(c.id) ? "checked" : ""} ${c.gone ? "disabled" : ""}><span title="${esc(c.title)}">${esc(c.title)}</span></label>`).join("");
  }
  $("chatLoad").addEventListener("click", () => {
    setChatOpen(true);
    chats = SITE.listChats();
    chatSel.clear();
    renderChats();
    chatStatus(chats.length ? "" : "左侧没找到会话：请先展开左侧边栏。", chats.length ? "" : "warn");
  });
  $("chatList").addEventListener("change", (e) => {
    const id = e.target.dataset.chat;
    if (!id) return;
    if (e.target.checked) chatSel.add(id); else chatSel.delete(id);
    renderChats();
  });
  $("chatAll").addEventListener("change", () => {
    chats.filter((c) => !c.gone).forEach((c) => ($("chatAll").checked ? chatSel.add(c.id) : chatSel.delete(c.id)));
    renderChats();
  });
  $("chatStop").addEventListener("click", () => chatAbort && chatAbort.abort());
  $("chatDel").addEventListener("click", async () => {
    if (running) { toast("正在作图，先等这一批做完或点“停止”"); return; }
    const todo = chats.filter((c) => chatSel.has(c.id) && !c.gone);
    if (!todo.length) return;
    if (!confirm(`确定删除选中的 ${todo.length} 个 ${AI} 会话？删除后找不回来。`)) return;
    chatAbort = new AbortController();
    $("chatStop").disabled = false;
    renderChats();
    let ok = 0, fail = 0;
    for (const c of todo) {
      if (chatAbort.signal.aborted) break;
      chatStatus(`正在删除 ${ok + fail + 1}/${todo.length}：${c.title}`);
      try {
        await SITE.deleteChat(c, chatAbort.signal);
        c.gone = true;
        chatSel.delete(c.id);
        ok++;
      } catch (e) {
        if (chatAbort.signal.aborted) break;
        fail++;
        c.error = e.message;
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); // 收起没点完的菜单
      }
      renderChats();
      await sleep(800 + Math.floor(Math.random() * 700));
    }
    const stopped = chatAbort.signal.aborted;
    chatAbort = null;
    $("chatStop").disabled = true;
    renderChats();
    chatStatus(`${stopped ? "已停止。" : ""}删除了 ${ok} 个${fail ? `，${fail} 个没删掉（${todo.find((c) => c.error)?.error || ""}）` : ""}。`, fail ? "warn" : "ok");
  });

  // ---- 取当前会话的图：插件漏收、或者你自己在网页里让 AI 改过的图，都能拿回来
  $("grabBtn").addEventListener("click", async () => {
    if (running) { toast("正在作图，先等这一批做完"); return; }
    const imgs = SITE.chatImages ? SITE.chatImages() : [];
    const have = new Set(jobs.map((j) => j.aiSrc).filter(Boolean));
    const todo = imgs.filter((i) => !have.has(i.currentSrc || i.src));
    if (!todo.length) { toast(imgs.length ? "当前会话里的图都已经在结果里了" : "当前会话里没找到 AI 生成的图"); return; }
    setStatus(`正在取回当前会话的 ${todo.length} 张图…`);
    const stamp = bj().slice(11).replace(/:/g, "");
    let n = 0;
    for (const [k, img] of todo.entries()) {
      try {
        const blob = await SITE.grabImage(img);
        const dataUrl = await toDataUrl(blob);
        const f = { id: nextId++, name: `会话图片-${stamp}-${k + 1}.png`, size: blob.size, type: blob.type, dataUrl, w: img.naturalWidth, h: img.naturalHeight, done: true, fromChat: true };
        extraFiles.push(f);
        const j = { id: nextId++, file: f, mode: S.mode, status: "running", steps: [], idx: k + 1, total: todo.length, startedAt: Date.now(), aiSrc: img.currentSrc || img.src };
        jobs.push(j);
        await finishJob(j, blob, null);
        j.status = "ok";
        j.endedAt = Date.now();
        step(j, "从当前会话取回");
        n++;
      } catch (e) {
        console.warn("[AI图图] 取图失败：", e);
      }
    }
    renderJobs();
    setStatus(`从当前会话取回 ${n} 张图（按现在的设置做了后期）。`, n ? "ok" : "warn");
  });

  $("startBtn").addEventListener("click", () => startBatch());
  $("stopBtn").addEventListener("click", () => { if (abortCtl) abortCtl.abort(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if ($("viewer").classList.contains("show")) $("viewer").classList.remove("show");
    else if ($("modal").classList.contains("show")) closeEditor();
  });

  // ------------------------------------------------------------ 刷新页面后保留产品图和结果（关掉标签页 / 浏览器才清空，存在插件后台）
  const toDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  function scheduleSave() {
    if (restoring) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveTab, 800);
  }
  async function saveTab() {
    try {
      const fs = files.concat(extraFiles).map((f) => ({
        id: f.id, name: f.name, size: f.size, type: f.type, dataUrl: f.dataUrl, w: f.w, h: f.h, crop: f.crop || null, lasso: f.lasso || null, done: !!f.done, fromChat: !!f.fromChat,
        colors: f.colors || [], partsNote: f.partsNote || "", parts: f.parts || [], maskUrl: f.mask ? f.mask.toDataURL("image/png") : "",
      }));
      const js = [];
      for (const j of jobs) {
        if (j.outBlob && !j.outData) j.outData = await toDataUrl(j.outBlob);
        js.push({
          id: j.id, fileId: j.file.id, mode: j.mode, status: ["running", "waiting"].includes(j.status) ? "cancel" : j.status,
          steps: j.steps.slice(-3), error: j.error || "", text: (j.text || "").slice(0, 500), retries: j.retries || 0,
          outData: j.outData || "", inputUrl: j.inputUrl || "", w: j.w || 0, h: j.h || 0, ext: j.ext || "", note: j.note || "",
          model: j.model || "", modeWarn: j.modeWarn || "", startedAt: j.startedAt || 0, endedAt: j.endedAt || 0, partCount: j.partCount || 0,
          aiW: j.aiW || 0, aiH: j.aiH || 0, aiRatio: j.aiRatio || "", aiSrc: j.aiSrc || "", req: j.req || "", productName: j.productName || "",
        });
      }
      chrome.runtime.sendMessage({ type: "aitutu-tab-save", data: { files: fs, jobs: js, nextId, savedAt: Date.now() } }, () => void chrome.runtime.lastError);
    } catch (e) {
      console.warn("[AI图图] 保存面板内容失败：", e);
    }
  }
  async function restoreTab() {
    let data = null;
    try {
      data = await new Promise((res) => chrome.runtime.sendMessage({ type: "aitutu-tab-load" }, (r) => { void chrome.runtime.lastError; res(r && r.ok ? r.data : null); }));
    } catch {}
    if (data && (data.files?.length || data.jobs?.length)) {
      for (const d of data.files || []) {
        const f = { ...d };
        delete f.maskUrl;
        if (d.maskUrl) {
          const im = await loadImage(d.maskUrl);
          if (im) { f.mask = document.createElement("canvas"); f.mask.width = im.naturalWidth; f.mask.height = im.naturalHeight; f.mask.getContext("2d").drawImage(im, 0, 0); }
        }
        if (f.fromChat) { if (!extraFiles.some((x) => x.id === f.id)) extraFiles.push(f); }
        else if (!files.some((x) => x.id === f.id)) files.push(f);
      }
      for (const d of data.jobs || []) {
        const file = files.concat(extraFiles).find((f) => f.id === d.fileId);
        if (!file || jobs.some((x) => x.id === d.id)) continue;
        const j = { ...d, file };
        delete j.fileId;
        if (d.outData) { j.outBlob = await (await fetch(d.outData)).blob(); j.outUrl = URL.createObjectURL(j.outBlob); }
        jobs.push(j);
      }
      nextId = Math.max(nextId, data.nextId || 0, ...files.concat(extraFiles).map((f) => f.id + 1), ...jobs.map((j) => j.id + 1));
      toast(`已恢复 ${files.length} 张产品图${jobs.length ? `、${jobs.length} 条结果` : ""}`);
    }
    restoring = false;
    renderThumbs();
    renderJobs();
  }
  renderThumbs();
  renderJobs();
  restoreTab();
  // ------------------------------------------------------------ 淘宝采集插件发来的图（0.5.1，Lee 2026-10-11）
  // 后台（background.js）收到淘宝插件的图片后转到这里，跟拖进来的图一样走 addFiles。
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== "aitutu-import-files" || !Array.isArray(msg.images)) return false;
    (async () => {
      for (let i = 0; i < 50 && restoring; i++) await sleep(200); // 等刷新后的恢复做完，免得编号冲突
      const list = msg.images.map((im) => {
        const bin = atob(im.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new File([bytes], im.name || "淘宝图片.jpg", { type: im.mime || "image/jpeg" });
      });
      const before = files.length;
      await addFiles(list);
      if ($("wrap").classList.contains("closed")) $("handle").click(); // 面板收起着就展开
      const added = files.length - before;
      toast(`收到淘宝插件发来的 ${added} 张图片`);
      sendResponse({ ok: true, added });
    })().catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true;
  });
  try { chrome.runtime.sendMessage({ type: "aitutu-wt-hello" }, () => void chrome.runtime.lastError); } catch {}
})();
