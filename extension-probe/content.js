/**
 * AI图图 · Gemini 页面探测（2026-10-09）
 *
 * 目的：开发正式插件前，先摸清 Gemini 网页的结构——输入框、上传图片的入口、
 * 发送按钮、生成的图片在哪、能不能取到原图。页面左下角会出现一个小面板。
 *
 * 隐私：不收集聊天内容。只记录元素的标签名、class、aria-label 等界面信息；
 * 输入框只记文字长度；侧边栏（对话列表）里的元素一律跳过；
 * 图片地址只保留开头和结尾一小段。报告显示在面板里，你看过再复制。
 */
(() => {
  if (window.__aitutuProbe) return;
  window.__aitutuProbe = true;
  const VERSION = "probe-0.2.0";

  // ------------------------------------------------------------ 小工具
  const short = (s, n = 50) => {
    if (s == null || s === "") return undefined;
    s = String(s).replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n) + "…" : s;
  };
  const cls = (el) => [...(el.classList || [])].filter((c) => !/\d{3,}/.test(c)).slice(0, 4);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const isOurs = (el) => !!(el.closest && el.closest("#aitutu-probe-host"));
  /**
   * 侧边栏 / 对话列表里的东西可能带对话标题，一律不收集。
   * 注意：Gemini 整个页面都套在 bard-sidenav-container / bard-sidenav-content 里，
   * 不能按 class 名里的 "sidenav" 判断（0.1.0 就是这样把整页都跳过了）。
   * 只认真正的侧边栏组件；聊天窗口和输入区里的东西一律不算侧边栏。
   */
  const NAV_SEL =
    'nav,[role="navigation"],side-navigation-v2,side-navigation-content,conversations-list,project-sidenav-list,gem-nav-list-item,mat-nav-list,sidenav-mavatar-footer,bard-sidenav';
  const MAIN_SEL = "chat-window,input-container,chat-app-banners,top-bar-actions,model-response,user-query";
  const inNav = (el) => !el.closest(MAIN_SEL) && !!el.closest(NAV_SEL);
  function cssPath(el) {
    const parts = [];
    let e = el;
    for (let i = 0; e && e.nodeType === 1 && i < 8; i++, e = e.parentElement) {
      let p = e.tagName.toLowerCase();
      if (e.id && !/\d{3,}/.test(e.id)) p += "#" + e.id;
      const c = cls(e).slice(0, 2);
      if (c.length) p += "." + c.join(".");
      parts.unshift(p);
      if (e.tagName === "BODY") break;
    }
    return parts.join(" > ");
  }
  function desc(el) {
    if (!el || el.nodeType !== 1) return null;
    const r = el.getBoundingClientRect();
    const a = (n) => el.getAttribute(n);
    const d = {
      tag: el.tagName.toLowerCase(),
      id: el.id ? (/\d{3,}/.test(el.id) ? "(随机id)" : el.id) : undefined,
      cls: cls(el).length ? cls(el) : undefined,
      role: a("role") || undefined,
      aria: short(a("aria-label")),
      title: short(a("title")),
      tooltip: short(a("mattooltip") || a("data-tooltip")),
      testid: a("data-test-id") || a("data-testid") || undefined,
      placeholder: short(a("placeholder") || a("data-placeholder")),
      type: a("type") || undefined,
      accept: a("accept") || undefined,
      multiple: el.hasAttribute("multiple") || undefined,
      contenteditable: a("contenteditable") || undefined,
      disabled: el.disabled || a("aria-disabled") === "true" || undefined,
      visible: r.width > 0 && r.height > 0,
      size: `${Math.round(r.width)}x${Math.round(r.height)}`,
      pos: `${Math.round(r.left)},${Math.round(r.top)}`,
      path: cssPath(el),
    };
    Object.keys(d).forEach((k) => d[k] === undefined && delete d[k]);
    return d;
  }
  /** 按钮上的文字（界面文字，最多 30 字；更长的不收） */
  function btnText(el) {
    const t = (el.innerText || "").replace(/\s+/g, " ").trim();
    if (!t) return undefined;
    return t.length <= 30 ? t : `(文字 ${t.length} 字，略)`;
  }
  /** 图片地址只留开头和结尾（结尾常带 =s1024 这类尺寸参数，有用） */
  function redactSrc(src) {
    if (!src) return undefined;
    if (src.startsWith("blob:")) return "blob:(本地临时地址)";
    if (src.startsWith("data:")) return `data:(内嵌，长 ${src.length})`;
    try {
      const u = new URL(src);
      const rest = u.pathname + u.search;
      return u.origin + (rest.length > 60 ? rest.slice(0, 24) + "…" + rest.slice(-30) : rest);
    } catch {
      return short(src, 60);
    }
  }
  const tNow = () => Math.round((performance.now() - recStart) / 100) / 10;

  // ------------------------------------------------------------ 探测
  function findMainInput() {
    const cands = [...document.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]')].filter(
      (e) => !isOurs(e) && !inNav(e) && visible(e),
    );
    // 一般是最下面、最宽的那个
    return cands.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0] || null;
  }
  function bigImages() {
    return [...document.images].filter((i) => !isOurs(i) && !inNav(i) && i.naturalWidth >= 200 && i.naturalHeight >= 200);
  }
  function nearbyButtons(el) {
    let box = el;
    for (let i = 0; i < 6 && box.parentElement; i++) box = box.parentElement;
    return [...box.querySelectorAll('button,[role="button"],a[download]')]
      .filter((b) => !isOurs(b) && !inNav(b) && visible(b))
      .slice(0, 12)
      .map((b) => ({ aria: short(b.getAttribute("aria-label")), tooltip: short(b.getAttribute("mattooltip")), text: btnText(b), testid: b.getAttribute("data-test-id") || undefined, path: cssPath(b) }));
  }

  function probe() {
    const r = {
      version: VERSION,
      time: new Date().toISOString(),
      url: location.origin + location.pathname.replace(/\/[A-Za-z0-9_-]{10,}/g, "/<id>"),
      ua: navigator.userAgent,
      viewport: `${innerWidth}x${innerHeight}`,
      lang: document.documentElement.lang,
    };
    const main = findMainInput();
    r.mainInput = main ? { ...desc(main), textLength: (main.innerText || main.value || "").length } : null;
    r.inputs = [...document.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"], input[type="text"]')]
      .filter((e) => !isOurs(e) && !inNav(e))
      .slice(0, 10)
      .map((e) => ({ ...desc(e), textLength: (e.innerText || e.value || "").length }));
    r.fileInputs = [...document.querySelectorAll('input[type="file"]')].filter((e) => !isOurs(e)).map(desc);
    const allBtns = [...document.querySelectorAll('button,[role="button"]')].filter((e) => !isOurs(e));
    // 左侧边栏的按钮也收（用户同意收集对话标题），主要为了找“发起新对话”
    r.navButtons = allBtns.filter(inNav).filter(visible).slice(0, 60).map((e) => ({ aria: short(e.getAttribute("aria-label")), text: btnText(e), testid: e.getAttribute("data-test-id") || undefined, path: cssPath(e) }));
    r.navLinks = [...document.querySelectorAll("a[href]")].filter((e) => !isOurs(e) && inNav(e) && visible(e)).slice(0, 15).map((e) => ({ aria: short(e.getAttribute("aria-label")), text: btnText(e), href: e.getAttribute("href"), path: cssPath(e) }));
    r.buttons = allBtns
      .filter((e) => !inNav(e) && visible(e))
      .slice(0, 150)
      .map((e) => ({ ...desc(e), text: btnText(e) }));
    const tagCount = {};
    document.querySelectorAll("*").forEach((e) => {
      const t = e.tagName.toLowerCase();
      if (t.includes("-") && !isOurs(e)) tagCount[t] = (tagCount[t] || 0) + 1;
    });
    r.customTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 80);
    r.images = bigImages().slice(-12).map((img) => ({
      ...desc(img),
      src: redactSrc(img.currentSrc || img.src),
      natural: `${img.naturalWidth}x${img.naturalHeight}`,
      alt: short(img.alt, 40),
      nearbyButtons: nearbyButtons(img),
    }));
    const shadowHosts = [...document.querySelectorAll("*")].filter((e) => e.shadowRoot && !isOurs(e));
    r.shadowHosts = { count: shadowHosts.length, tags: [...new Set(shadowHosts.map((e) => e.tagName.toLowerCase()))].slice(0, 20) };
    r.iframes = [...document.querySelectorAll("iframe")].map((f) => {
      try { return new URL(f.src).origin; } catch { return "(无地址)"; }
    });
    const send = document.querySelector("gem-icon-button.send-button button, .send-button-container button");
    r.sendButton = send ? { aria: short(send.getAttribute("aria-label")), disabled: send.disabled || send.getAttribute("aria-disabled") === "true", path: cssPath(send) } : null;
    r.generatedImages = generatedImages().map((i) => ({ src: redactSrc(i.currentSrc || i.src), natural: `${i.naturalWidth}x${i.naturalHeight}`, classes: cls(i), shimmer: !!i.closest(".gem-shimmer-active") }));
    r.attachments = { count: attachCount(), loading: attachLoading() };
    r.recording = recLog;
    r.tests = tests;
    return r;
  }

  // ------------------------------------------------------------ 录制（记录你手动操作时点了什么）
  let recording = false;
  let recStart = performance.now();
  const recLog = [];
  const push = (ev) => { if (recording && recLog.length < 400) recLog.push({ t: tNow(), ...ev }); };

  document.addEventListener("click", (e) => {
    if (!recording || isOurs(e.target)) return;
    const el = e.target.closest('button,[role="button"],a,input,[role="menuitem"],[role="option"],mat-option,label,[role="tab"]') || e.target;
    if (inNav(el)) return push({ ev: "click", what: "(侧边栏元素，略)" });
    push({ ev: "click", el: { ...desc(el), text: btnText(el) } });
  }, true);
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (!recording || !t || t.type !== "file") return;
    push({ ev: "file-change", el: desc(t), files: [...(t.files || [])].map((f) => ({ type: f.type, size: f.size })) });
  }, true);
  document.addEventListener("keydown", (e) => {
    if (!recording || e.key !== "Enter" || isOurs(e.target)) return;
    push({ ev: "Enter", shift: e.shiftKey || undefined, ctrl: e.ctrlKey || undefined, el: desc(e.target) });
  }, true);
  document.addEventListener("paste", (e) => {
    if (!recording || isOurs(e.target)) return;
    push({ ev: "paste", types: [...(e.clipboardData?.types || [])], files: e.clipboardData?.files?.length || 0, el: desc(e.target) });
  }, true);
  document.addEventListener("drop", (e) => {
    if (!recording || isOurs(e.target)) return;
    push({ ev: "drop", files: e.dataTransfer?.files?.length || 0, el: desc(e.target) });
  }, true);

  const mo = new MutationObserver((muts) => {
    if (!recording) return;
    for (const m of muts) {
      if (m.type === "attributes") {
        const el = m.target;
        if (el.nodeType === 1 && el.matches('button,[role="button"]') && !isOurs(el) && !inNav(el)) {
          push({ ev: "button-attr", attr: m.attributeName, el: { aria: short(el.getAttribute("aria-label")), disabled: el.disabled || el.getAttribute("aria-disabled") === "true", path: cssPath(el) } });
        }
        continue;
      }
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || isOurs(n)) continue;
        const imgs = n.tagName === "IMG" ? [n] : [...n.querySelectorAll("img")];
        for (const img of imgs) {
          const report = () => {
            if (img.naturalWidth >= 120 && !inNav(img)) {
              push({ ev: "img-added", src: redactSrc(img.currentSrc || img.src), natural: `${img.naturalWidth}x${img.naturalHeight}`, el: desc(img) });
            }
          };
          if (img.complete && img.naturalWidth) report();
          else img.addEventListener("load", report, { once: true });
        }
        const fis = n.matches?.('input[type="file"]') ? [n] : [...n.querySelectorAll('input[type="file"]')];
        fis.forEach((fi) => push({ ev: "file-input-added", el: desc(fi) }));
      }
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label", "disabled", "aria-disabled"] });

  // ------------------------------------------------------------ 测试：能不能自动填文字、贴图片、取原图
  const tests = {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function makeTestFile() {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 256;
    const g = c.getContext("2d");
    g.fillStyle = "#e5e7eb"; g.fillRect(0, 0, 256, 256);
    g.fillStyle = "#111"; g.font = "bold 36px sans-serif"; g.fillText("TEST", 80, 140);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    return new File([blob], "aitutu-test.png", { type: "image/png" });
  }
  /** 输入区里的附件数量（Gemini：uploader-file-preview）；还在上传的数量（带 loading） */
  const attachCount = () => document.querySelectorAll("input-container uploader-file-preview, uploader-file-preview").length;
  const attachLoading = () => document.querySelectorAll("uploader-file-preview .loading, uploader-file-preview [class*='loading']").length;
  async function waitAttach(before, ms = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (attachCount() > before && !attachLoading()) return { added: attachCount() - before, waitedMs: Date.now() - t0 };
      await sleep(200);
    }
    return { added: attachCount() - before, stillLoading: attachLoading(), waitedMs: ms };
  }

  async function testFill() {
    const out = {};
    const input = findMainInput();
    if (!input) { tests.fill = { error: "没找到输入框" }; return; }
    out.input = desc(input);
    input.focus();
    const before = (input.innerText || input.value || "").length;
    const okCmd = document.execCommand("insertText", false, "AI图图测试");
    await sleep(300);
    out.insertText = { execCommandReturned: okCmd, lengthBefore: before, lengthAfter: (input.innerText || input.value || "").length };
    const file = await makeTestFile();

    // 方法 1：在输入框上模拟粘贴图片
    let a = attachCount();
    const dt = new DataTransfer();
    dt.items.add(file);
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    out.pasteImage = { before: a, ...(await waitAttach(a)) };

    // 方法 2：模拟把图片拖到 Gemini 的拖放区（手动拖图时出现的那个区域）
    a = attachCount();
    const zone = document.querySelector(".xap-uploader-dropzone") || input;
    out.dropZone = cssPath(zone);
    const dt2 = new DataTransfer();
    dt2.items.add(file);
    zone.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt2, bubbles: true, cancelable: true }));
    zone.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt2, bubbles: true, cancelable: true }));
    await sleep(400);
    const overlay = document.querySelector("file-drop-indicator .overlay-container") || zone;
    out.dropOverlay = cssPath(overlay);
    overlay.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt2, bubbles: true, cancelable: true }));
    overlay.dispatchEvent(new DragEvent("drop", { dataTransfer: dt2, bubbles: true, cancelable: true }));
    out.dropImage = { before: a, ...(await waitAttach(a)) };

    out.fileInputsFound = [...document.querySelectorAll('input[type="file"]')].filter((e) => !isOurs(e)).length;
    out.attachmentsNow = attachCount();
    tests.fill = out;
  }

  /** Gemini 生成的图：generated-image 里的 img（可能是 blob: 或 https: 地址） */
  function generatedImages() {
    const list = [...document.querySelectorAll("generated-image img, single-image img")].filter((i) => !isOurs(i) && i.naturalWidth >= 200);
    return list.length ? list : bigImages().filter((i) => !i.closest("user-query, uploader-file-preview"));
  }

  async function testFetch() {
    const imgs = generatedImages();
    const img = imgs[imgs.length - 1];
    if (!img) { tests.fetch = { error: "页面上没找到生成的图片（先让 Gemini 生成一张图）" }; return; }
    const src = img.currentSrc || img.src;
    const out = { count: imgs.length, src: redactSrc(src), kind: src.split(":")[0], shown: `${img.naturalWidth}x${img.naturalHeight}`, classes: cls(img) };
    const sizeOf = async (blob) => {
      try { const bm = await createImageBitmap(blob); const d = `${bm.width}x${bm.height}`; bm.close(); return d; } catch { return null; }
    };
    // 网页里直接取（blob: 地址只能在网页里取）
    for (const [key, cred] of [["pageFetch", "include"], ["pageFetchNoCookie", "omit"]]) {
      try {
        const r = await fetch(src, { credentials: cred });
        const b = await r.blob();
        out[key] = { ok: r.ok, status: r.status, type: b.type, size: b.size, dims: await sizeOf(b) };
      } catch (e) {
        out[key] = { ok: false, error: String(e.message || e) };
      }
    }
    // 画到画布上能不能读出像素
    try {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const px = g.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      out.canvasRead = { ok: true, centerPixel: Array.from(px).join(","), pngSize: blob && blob.size };
    } catch (e) {
      out.canvasRead = { ok: false, error: String(e.message || e).slice(0, 100) };
    }
    if (/^https:/.test(src)) {
      const viaBg = (url) => new Promise((resolve) => {
        try { chrome.runtime.sendMessage({ type: "aitutu-fetch", url }, (res) => resolve(res || { ok: false, error: String(chrome.runtime.lastError?.message || "无回复") })); }
        catch (e) { resolve({ ok: false, error: String(e) }); }
      });
      out.bgFetch = await viaBg(src);
      const m = /^(.*?)(=[^/=]*)?$/.exec(src);
      if (/googleusercontent\.com/.test(src) && m) {
        out.bgFetchS0 = await viaBg(m[1] + "=s0");
        out.bgFetchD = await viaBg(m[1] + "=d");
      }
    }
    // 下载按钮的信息（不点它，只看在哪）
    const dl = img.closest("generated-image, single-image")?.querySelector("download-generated-image-button button");
    out.downloadButton = dl ? { aria: short(dl.getAttribute("aria-label")), path: cssPath(dl) } : null;
    tests.fetch = out;
  }

  // ------------------------------------------------------------ 面板
  const host = document.createElement("div");
  host.id = "aitutu-probe-host";
  host.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      .box { width: 340px; background: #fff; color: #18181b; border: 1px solid #d4d4d8; border-radius: 14px; box-shadow: 0 8px 30px rgba(0,0,0,.18);
        font: 13px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; padding: 10px; }
      .box.min .body { display: none; }
      .head { display: flex; align-items: center; gap: 6px; font-weight: 600; cursor: move; user-select: none; }
      .head span { margin-right: auto; }
      .row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      button { border: 1px solid #d4d4d8; background: #fff; border-radius: 9px; padding: 5px 9px; font: inherit; cursor: pointer; }
      button:hover { background: #f4f4f5; }
      button.on { background: #dc2626; color: #fff; border-color: #dc2626; }
      .tip { color: #71717a; font-size: 12px; margin-top: 6px; }
      textarea { width: 100%; height: 160px; margin-top: 8px; font: 11px/1.4 ui-monospace, Consolas, monospace; border: 1px solid #e4e4e7; border-radius: 8px; box-sizing: border-box; }
    </style>
    <div class="box" id="box">
      <div class="head" id="drag"><span>AI图图 · 页面探测（按住这里拖动）</span><button id="min">收起</button></div>
      <div class="body">
        <div class="tip">按顺序：① 点“开始录制” → 手动上传一张图、输入几个字、发送、等出图、点下载 → ② 点“停止录制” → ③ 点“测试取图” → ④ 点“试填测试”（会往输入框里填“AI图图测试”和一张 TEST 图，<b>不会发送</b>，测完请自己删掉）→ ⑤ 点“生成报告并复制”。</div>
        <div class="row">
          <button id="rec">① 开始录制</button>
          <button id="fetch">③ 测试取图</button>
          <button id="fill">④ 试填测试</button>
          <button id="copy">⑤ 生成报告并复制</button>
        </div>
        <div class="tip" id="status">录制：未开始</div>
        <textarea id="out" readonly placeholder="报告会显示在这里（不含聊天内容），复制后发给 AI"></textarea>
      </div>
    </div>`;
  document.documentElement.appendChild(host);
  const $ = (id) => root.getElementById(id);
  const setStatus = (t) => { $("status").textContent = t; };
  let recTimer = null;

  // 按住标题栏拖动面板，免得挡住 Gemini 的按钮
  $("drag").addEventListener("pointerdown", (e) => {
    if (e.target.tagName === "BUTTON") return;
    const r = host.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const move = (ev) => {
      host.style.left = Math.max(0, Math.min(innerWidth - 60, ev.clientX - ox)) + "px";
      host.style.top = Math.max(0, Math.min(innerHeight - 30, ev.clientY - oy)) + "px";
      host.style.bottom = "auto";
    };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  });
  $("min").onclick = () => {
    $("box").classList.toggle("min");
    $("min").textContent = $("box").classList.contains("min") ? "展开" : "收起";
  };
  $("rec").onclick = () => {
    recording = !recording;
    if (recording) {
      recLog.length = 0;
      recStart = performance.now();
      $("rec").textContent = "② 停止录制";
      $("rec").classList.add("on");
      clearInterval(recTimer);
      recTimer = setInterval(() => setStatus(`录制中… ${tNow()} 秒，已记录 ${recLog.length} 条`), 500);
    } else {
      clearInterval(recTimer);
      $("rec").textContent = "① 开始录制";
      $("rec").classList.remove("on");
      setStatus(`录制结束：共 ${recLog.length} 条，${tNow()} 秒`);
    }
  };
  $("fetch").onclick = async () => {
    setStatus("测试取图中…");
    await testFetch();
    setStatus("取图测试完成：" + JSON.stringify(tests.fetch).slice(0, 120));
  };
  $("fill").onclick = async () => {
    setStatus("试填中（约 8 秒）…");
    await testFill();
    setStatus("试填完成，请把输入框里的测试文字和 TEST 图片删掉（不要发送）");
  };
  $("copy").onclick = async () => {
    const text = "# AI图图 · Gemini 页面探测报告\n" + JSON.stringify(probe(), null, 1);
    $("out").value = text;
    try {
      await navigator.clipboard.writeText(text);
      setStatus(`报告已复制（${Math.round(text.length / 1024)} KB），可以直接粘贴发给 AI`);
    } catch {
      $("out").select();
      document.execCommand("copy");
      setStatus("报告已复制（如果没复制上，请在下面框里全选后 Ctrl+C）");
    }
  };
})();
