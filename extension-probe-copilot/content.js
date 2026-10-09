/**
 * AI图图 · Copilot 页面探测（2026-10-09）
 *
 * 目的：开发 Copilot 版插件前，先摸清 Copilot 网页的结构——输入框、上传图片的入口、
 * 发送 / 停止按钮、生成的图片在哪、能不能取到原图、被拒或额度提示长什么样。
 * 页面左下角会出现一个小面板。
 *
 * 和 Gemini 探测插件的区别：Copilot 的页面结构事先不知道，所以这里全部用“通用找法”
 * （最下面的输入框、名字像“发送”的按钮、大图片），并且会钻进 Shadow DOM 里找。
 * Lee 已同意收集对话标题和聊天内容（2026-10-09），回复文字只截前 200 字。
 */
(() => {
  if (window.__aitutuCopilotProbe) {
    // 已经加载过（比如又点了工具栏图标）：面板被页面删掉了就放回去
    window.__aitutuCopilotProbe();
    return;
  }
  const VERSION = "copilot-probe-0.1.2";
  console.log(`[AI图图] Copilot 探测 ${VERSION} 已加载：${location.href}`);

  // ------------------------------------------------------------ 小工具
  const short = (s, n = 50) => {
    if (s == null || s === "") return undefined;
    s = String(s).replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n) + "…" : s;
  };
  const cls = (el) => [...(el.classList || [])].filter((c) => !/\d{3,}|^[a-z0-9_-]{1,3}$|__[a-zA-Z0-9]{5,}$/.test(c)).slice(0, 4);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const isOurs = (el) => {
    for (let e = el; e; e = e.parentElement || (e.getRootNode && e.getRootNode().host)) {
      if (e.id === "aitutu-probe-host") return true;
    }
    return false;
  };
  /** 找父元素，可以跨出 Shadow DOM */
  const parentOf = (el) => el.parentElement || (el.getRootNode && el.getRootNode() instanceof ShadowRoot ? el.getRootNode().host : null);
  function closestDeep(el, sel) {
    for (let e = el; e; e = parentOf(e)) if (e.nodeType === 1 && e.matches(sel)) return e;
    return null;
  }
  /** 所有打开的 Shadow DOM 根 */
  function shadowRoots(root = document, out = []) {
    for (const e of root.querySelectorAll("*")) {
      if (e.shadowRoot && e.id !== "aitutu-probe-host") {
        out.push(e.shadowRoot);
        shadowRoots(e.shadowRoot, out);
      }
    }
    return out;
  }
  /** querySelectorAll，连 Shadow DOM 里的也找 */
  function deepAll(sel) {
    const out = [...document.querySelectorAll(sel)];
    for (const r of shadowRoots()) out.push(...r.querySelectorAll(sel));
    return out.filter((e) => !isOurs(e));
  }
  const NAV_SEL = 'nav,[role="navigation"],aside,[data-testid*="sidebar" i],[class*="sidebar" i],[class*="side-nav" i]';
  const inNav = (el) => !!closestDeep(el, NAV_SEL);
  function cssPath(el) {
    const parts = [];
    let e = el;
    for (let i = 0; e && e.nodeType === 1 && i < 9; i++, e = parentOf(e)) {
      let p = e.tagName.toLowerCase();
      if (e.id && !/\d{3,}|^:r/.test(e.id)) p += "#" + e.id;
      const tid = e.getAttribute("data-testid") || e.getAttribute("data-test-id");
      if (tid) p += `[data-testid="${tid}"]`;
      const c = cls(e).slice(0, 2);
      if (c.length) p += "." + c.join(".");
      if (e.getRootNode && e.getRootNode() instanceof ShadowRoot && !e.parentElement) p += " ⟪shadow⟫";
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
      id: el.id ? (/\d{3,}|^:r/.test(el.id) ? "(随机id)" : el.id) : undefined,
      cls: cls(el).length ? cls(el) : undefined,
      role: a("role") || undefined,
      aria: short(a("aria-label")),
      title: short(a("title")),
      testid: a("data-testid") || a("data-test-id") || undefined,
      placeholder: short(a("placeholder") || a("data-placeholder")),
      name: a("name") || undefined,
      type: a("type") || undefined,
      accept: a("accept") || undefined,
      multiple: el.hasAttribute("multiple") || undefined,
      contenteditable: a("contenteditable") || undefined,
      disabled: el.disabled || a("aria-disabled") === "true" || undefined,
      busy: a("aria-busy") || undefined,
      inShadow: el.getRootNode() instanceof ShadowRoot || undefined,
      nav: inNav(el) || undefined,
      visible: r.width > 0 && r.height > 0,
      size: `${Math.round(r.width)}x${Math.round(r.height)}`,
      pos: `${Math.round(r.left)},${Math.round(r.top)}`,
      path: cssPath(el),
    };
    Object.keys(d).forEach((k) => d[k] === undefined && delete d[k]);
    return d;
  }
  function btnText(el) {
    const t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    if (!t) return undefined;
    return t.length <= 40 ? t : t.slice(0, 40) + "…";
  }
  const btnInfo = (b) => {
    const d = { aria: short(b.getAttribute("aria-label")), title: short(b.getAttribute("title")), text: btnText(b), testid: b.getAttribute("data-testid") || undefined,
      disabled: b.disabled || b.getAttribute("aria-disabled") === "true" || undefined, path: cssPath(b) };
    Object.keys(d).forEach((k) => d[k] === undefined && delete d[k]);
    return d;
  };
  /** 图片地址：保留域名和路径开头结尾、查询参数的名字和值（尺寸参数有用） */
  function redactSrc(src) {
    if (!src) return undefined;
    if (src.startsWith("blob:")) return "blob:(本地临时地址)";
    if (src.startsWith("data:")) return `data:(内嵌 ${src.slice(5, 20)}…，长 ${src.length})`;
    try {
      const u = new URL(src);
      const p = u.pathname.length > 70 ? u.pathname.slice(0, 30) + "…" + u.pathname.slice(-30) : u.pathname;
      return u.origin + p + (u.search ? (u.search.length > 120 ? u.search.slice(0, 120) + "…" : u.search) : "");
    } catch {
      return short(src, 80);
    }
  }
  const tNow = () => Math.round((performance.now() - recStart) / 100) / 10;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------------ 通用找法
  function findMainInput() {
    const cands = deepAll('textarea, [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]').filter((e) => !inNav(e) && visible(e));
    return cands.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0] || null;
  }
  /** 输入区：从输入框往上找，碰到“太高（超过 320px）”或“包含聊天里的大图 / 消息”的父元素就停
   *  （测试过：附件缩略图不能算大图，否则贴图后输入区就只剩输入框本身） */
  function composerOf(input) {
    if (!input) return null;
    let box = input;
    for (let i = 0; i < 10; i++) {
      const p = parentOf(box);
      if (!p || p === document.body || p === document.documentElement) break;
      if (p.getBoundingClientRect().height > 320) break;
      // 聊天里的大图（显示得也大）；附件缩略图原图可能很大，但显示得小，不算
      if ([...p.querySelectorAll("img")].some((im) => { const b = im.getBoundingClientRect(); return im.naturalWidth >= 200 && b.width >= 150 && b.height >= 150; })) break;
      if (p.querySelector('[data-content],[data-message-author-role],[role="article"],cib-message')) break;
      box = p;
    }
    return box;
  }
  const deepIn = (box, sel) => {
    if (!box) return [];
    const out = [...box.querySelectorAll(sel)];
    const walk = (root) => root.querySelectorAll("*").forEach((e) => { if (e.shadowRoot) { out.push(...e.shadowRoot.querySelectorAll(sel)); walk(e.shadowRoot); } });
    walk(box);
    if (box.shadowRoot) out.push(...box.shadowRoot.querySelectorAll(sel));
    return out.filter((e) => !isOurs(e));
  };
  const SEND_RE = /send|submit|发送|提交|傳送|送出/i;
  const STOP_RE = /stop|停止|cancel generat|中止/i;
  const label = (b) => [b.getAttribute("aria-label"), b.getAttribute("title"), b.getAttribute("data-testid"), b.getAttribute("type") === "submit" ? "submit" : ""].join(" ");
  function findSendBtn() {
    const comp = composerOf(findMainInput());
    const pool = comp ? deepIn(comp, 'button,[role="button"]') : deepAll('button,[role="button"]');
    return pool.filter(visible).find((b) => SEND_RE.test(label(b)) || STOP_RE.test(label(b))) || null;
  }
  /** 输入区里的附件：图片缩略图、名字像附件的元素、上传中的转圈 */
  function attachState() {
    const comp = composerOf(findMainInput());
    if (!comp) return { imgs: 0, attachLike: 0, loading: 0 };
    const imgs = deepIn(comp, "img").filter(visible);
    const attachLike = deepIn(comp, '[data-testid*="attach" i],[data-testid*="file" i],[class*="attachment" i],[class*="thumbnail" i],[aria-label*="附件"],[aria-label*="attachment" i],[aria-label*="移除"],[aria-label*="删除"],[aria-label*="remove" i]').filter(visible);
    const loading = deepIn(comp, '[role="progressbar"],[aria-busy="true"],progress,[class*="spinner" i],[class*="loading" i],[class*="progress" i]').filter(visible);
    return { imgs: imgs.length, attachLike: attachLike.length, loading: loading.length };
  }
  const attachScore = () => { const s = attachState(); return s.imgs + s.attachLike; };
  function bigImages() {
    const comp = composerOf(findMainInput());
    return deepAll("img").filter((i) => !inNav(i) && i.naturalWidth >= 200 && i.naturalHeight >= 200 && !(comp && comp.contains(i)));
  }
  /** 图片往上 12 层的父元素（找“回复气泡 / 生成图片”外框的选择器用） */
  function ancestorChain(el) {
    const out = [];
    for (let e = parentOf(el), i = 0; e && e !== document.body && i < 12; e = parentOf(e), i++) {
      const d = { tag: e.tagName.toLowerCase() };
      const tid = e.getAttribute("data-testid") || e.getAttribute("data-test-id");
      if (tid) d.testid = tid;
      if (e.getAttribute("role")) d.role = e.getAttribute("role");
      if (e.getAttribute("aria-label")) d.aria = short(e.getAttribute("aria-label"), 40);
      const c = cls(e);
      if (c.length) d.cls = c;
      const data = [...e.attributes].filter((a) => a.name.startsWith("data-") && !/testid/.test(a.name)).slice(0, 4).map((a) => `${a.name}=${short(a.value, 30)}`);
      if (data.length) d.data = data;
      if (e.tagName === "A") d.href = redactSrc(e.href);
      out.push(d);
    }
    return out;
  }
  function nearbyButtons(el) {
    let box = el;
    for (let i = 0; i < 6 && parentOf(box); i++) box = parentOf(box);
    return deepIn(box, 'button,[role="button"],a[download],a[href]').filter(visible).slice(0, 15).map(btnInfo);
  }
  /** 像聊天消息的元素（取最后几条，文字截 200 字） */
  function messages() {
    const sel = '[data-content],[data-testid*="message" i],[data-message-author-role],[class*="message" i],[role="article"],cib-message,cib-message-group,[data-author]';
    const list = deepAll(sel).filter((e) => !inNav(e) && visible(e) && (e.innerText || "").trim().length > 0);
    // 只留最外层（去掉嵌在别的候选里的）
    const outer = list.filter((e) => !list.some((o) => o !== e && o.contains(e)));
    return outer.slice(-8).map((e) => ({ ...desc(e), data: [...e.attributes].filter((a) => a.name.startsWith("data-")).slice(0, 5).map((a) => `${a.name}=${short(a.value, 30)}`), author: e.getAttribute("data-message-author-role") || e.getAttribute("data-author") || e.getAttribute("source") || undefined,
      textLength: (e.innerText || "").length, text: short(e.innerText, 200), imgs: deepIn(e, "img").filter((i) => i.naturalWidth >= 200).length }));
  }

  function probe() {
    const r = {
      version: VERSION,
      time: new Date().toISOString(),
      url: location.origin + location.pathname,
      ua: navigator.userAgent,
      viewport: `${innerWidth}x${innerHeight}`,
      lang: document.documentElement.lang,
      title: document.title,
    };
    const main = findMainInput();
    r.mainInput = main ? { ...desc(main), textLength: (main.innerText || main.value || "").length, isTextarea: main.tagName === "TEXTAREA" } : null;
    const comp = composerOf(main);
    r.composer = comp ? { ...desc(comp), buttons: deepIn(comp, 'button,[role="button"]').filter(visible).map(btnInfo), fileInputs: deepIn(comp, 'input[type="file"]').map(desc) } : null;
    const send = findSendBtn();
    r.sendButton = send ? btnInfo(send) : null;
    r.attachments = attachState();
    r.inputs = deepAll('textarea, [contenteditable="true"], [role="textbox"], input[type="text"]').slice(0, 10).map((e) => ({ ...desc(e), textLength: (e.innerText || e.value || "").length }));
    r.fileInputs = deepAll('input[type="file"]').map(desc);
    const allBtns = deepAll('button,[role="button"]').filter(visible);
    r.navButtons = allBtns.filter(inNav).slice(0, 60).map(btnInfo);
    r.navLinks = deepAll("a[href]").filter((e) => inNav(e) && visible(e)).slice(0, 20).map((e) => ({ aria: short(e.getAttribute("aria-label")), text: btnText(e), href: e.getAttribute("href"), path: cssPath(e) }));
    r.buttons = allBtns.filter((e) => !inNav(e)).slice(0, 150).map((e) => ({ ...desc(e), text: btnText(e) }));
    const tids = {};
    deepAll("[data-testid],[data-test-id]").forEach((e) => { const t = e.getAttribute("data-testid") || e.getAttribute("data-test-id"); tids[t] = (tids[t] || 0) + 1; });
    r.testids = Object.entries(tids).sort((a, b) => b[1] - a[1]).slice(0, 200);
    const tagCount = {};
    deepAll("*").forEach((e) => { const t = e.tagName.toLowerCase(); if (t.includes("-")) tagCount[t] = (tagCount[t] || 0) + 1; });
    r.customTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 80);
    const roots = shadowRoots();
    r.shadowHosts = { count: roots.length, tags: [...new Set(roots.map((s) => s.host.tagName.toLowerCase()))].slice(0, 30) };
    r.iframes = [...document.querySelectorAll("iframe")].map((f) => {
      const b = f.getBoundingClientRect();
      let o = "(无地址)";
      try { o = new URL(f.src).origin + new URL(f.src).pathname.slice(0, 40); } catch {}
      return { src: o, size: `${Math.round(b.width)}x${Math.round(b.height)}`, title: short(f.title) };
    });
    r.images = bigImages().slice(-10).map((img) => ({
      ...desc(img),
      src: redactSrc(img.currentSrc || img.src),
      srcset: img.srcset ? short(img.srcset, 120) : undefined,
      natural: `${img.naturalWidth}x${img.naturalHeight}`,
      alt: short(img.alt, 60),
      complete: img.complete,
      chain: ancestorChain(img),
      nearbyButtons: nearbyButtons(img),
    }));
    r.messages = messages();
    r.alerts = deepAll('[role="alert"],[role="status"],[aria-live]').filter(visible).slice(0, 10).map((e) => ({ path: cssPath(e), text: short(e.innerText, 200) }));
    r.recording = recLog;
    r.tests = tests;
    return r;
  }

  // ------------------------------------------------------------ 录制（记录你手动操作时点了什么、页面怎么变）
  let recording = false;
  let recStart = performance.now();
  const recLog = [];
  const push = (ev) => { if (recording && recLog.length < 500) recLog.push({ t: tNow(), ...ev }); };
  const realTarget = (e) => (e.composedPath && e.composedPath()[0]) || e.target;

  document.addEventListener("click", (e) => {
    const t = realTarget(e);
    if (!recording || isOurs(t) || t.nodeType !== 1) return;
    const el = closestDeep(t, 'button,[role="button"],a,input,[role="menuitem"],[role="option"],label,[role="tab"],[role="menuitemradio"]') || t;
    push({ ev: "click", el: { ...desc(el), text: btnText(el) } });
  }, true);
  document.addEventListener("change", (e) => {
    const t = realTarget(e);
    if (!recording || !t || t.type !== "file") return;
    push({ ev: "file-change", el: desc(t), files: [...(t.files || [])].map((f) => ({ type: f.type, size: f.size })) });
  }, true);
  document.addEventListener("keydown", (e) => {
    const t = realTarget(e);
    if (!recording || e.key !== "Enter" || isOurs(t)) return;
    push({ ev: "Enter", shift: e.shiftKey || undefined, ctrl: e.ctrlKey || undefined, el: desc(t) });
  }, true);
  document.addEventListener("paste", (e) => {
    const t = realTarget(e);
    if (!recording || isOurs(t)) return;
    push({ ev: "paste", types: [...(e.clipboardData?.types || [])], files: e.clipboardData?.files?.length || 0, el: desc(t) });
  }, true);
  document.addEventListener("drop", (e) => {
    const t = realTarget(e);
    if (!recording || isOurs(t)) return;
    push({ ev: "drop", files: e.dataTransfer?.files?.length || 0, el: desc(t) });
  }, true);

  const ATTRS = ["aria-label", "disabled", "aria-disabled", "data-testid", "title", "aria-busy"];
  const mo = new MutationObserver((muts) => {
    if (!recording) return;
    for (const m of muts) {
      if (m.type === "attributes") {
        const el = m.target;
        if (el.nodeType === 1 && el.matches('button,[role="button"]') && !isOurs(el)) {
          push({ ev: "button-attr", attr: m.attributeName, el: btnInfo(el) });
        } else if (el.nodeType === 1 && m.attributeName === "aria-busy" && !isOurs(el)) {
          push({ ev: "busy", value: el.getAttribute("aria-busy"), path: cssPath(el) });
        }
        continue;
      }
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || isOurs(n)) continue;
        const imgs = n.tagName === "IMG" ? [n] : [...n.querySelectorAll("img")];
        for (const img of imgs) {
          const report = () => {
            if (img.naturalWidth >= 120) push({ ev: "img-added", src: redactSrc(img.currentSrc || img.src), natural: `${img.naturalWidth}x${img.naturalHeight}`, el: desc(img) });
          };
          if (img.complete && img.naturalWidth) report();
          else img.addEventListener("load", report, { once: true });
        }
        const fis = n.matches?.('input[type="file"]') ? [n] : [...n.querySelectorAll('input[type="file"]')];
        fis.forEach((fi) => push({ ev: "file-input-added", el: desc(fi) }));
        const alerts = n.matches?.('[role="alert"],[role="status"],[role="dialog"]') ? [n] : [...n.querySelectorAll('[role="alert"],[role="dialog"]')];
        alerts.forEach((a) => setTimeout(() => push({ ev: "alert-added", role: a.getAttribute("role"), path: cssPath(a), text: short(a.innerText, 200) }), 300));
        if (n.matches?.('[role="progressbar"],progress,[class*="spinner" i],[class*="loading" i]')) push({ ev: "loading-added", el: desc(n) });
      }
      for (const n of m.removedNodes) {
        if (n.nodeType === 1 && n.matches?.('[role="progressbar"],progress,[class*="spinner" i],[class*="loading" i]')) push({ ev: "loading-removed", tag: n.tagName.toLowerCase(), cls: cls(n) });
      }
    }
  });
  const observed = new WeakSet();
  const OBS = { childList: true, subtree: true, attributes: true, attributeFilter: ATTRS };
  function observeAll() {
    if (!observed.has(document)) { mo.observe(document.documentElement, OBS); observed.add(document); }
    for (const r of shadowRoots()) if (!observed.has(r)) { mo.observe(r, OBS); observed.add(r); }
  }
  observeAll();

  // ------------------------------------------------------------ 测试：自动填文字、贴图片、取原图
  const tests = {};
  async function makeTestFile() {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 256;
    const g = c.getContext("2d");
    g.fillStyle = "#e5e7eb"; g.fillRect(0, 0, 256, 256);
    g.fillStyle = "#111"; g.font = "bold 36px sans-serif"; g.fillText("TEST", 80, 140);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    return new File([blob], "aitutu-test.png", { type: "image/png" });
  }
  async function waitAttach(before, ms = 10000) {
    const t0 = Date.now();
    let sawLoading = false;
    while (Date.now() - t0 < ms) {
      const s = attachState();
      if (s.loading) sawLoading = true;
      if (s.imgs + s.attachLike > before && !s.loading) return { added: s.imgs + s.attachLike - before, sawLoading, waitedMs: Date.now() - t0, state: s };
      await sleep(200);
    }
    return { added: attachScore() - before, sawLoading, timeout: true, waitedMs: ms, state: attachState() };
  }
  const inputLen = (el) => (el.innerText || el.value || "").length;

  async function testFill() {
    const out = {};
    let input = findMainInput();
    if (!input) { tests.fill = { error: "没找到输入框" }; return; }
    out.input = desc(input);
    // 文字 1：execCommand insertText（对 textarea 和 contenteditable 都常用）
    input.focus();
    let before = inputLen(input);
    const okCmd = document.execCommand("insertText", false, "AI图图测试");
    await sleep(300);
    out.insertText = { execCommandReturned: okCmd, lengthBefore: before, lengthAfter: inputLen(input) };
    // 文字 2：React 写法（原生 value setter + input 事件），只对 textarea
    if (input.tagName === "TEXTAREA") {
      before = inputLen(input);
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(input, input.value + " 测试2");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(300);
      input = findMainInput() || input;
      out.reactSetter = { lengthBefore: before, lengthAfter: inputLen(input) };
    }
    // 文字 3：模拟粘贴纯文本
    before = inputLen(input);
    input.focus();
    const dtT = new DataTransfer();
    dtT.setData("text/plain", " 测试3");
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dtT, bubbles: true, cancelable: true }));
    await sleep(300);
    out.pasteText = { lengthBefore: before, lengthAfter: inputLen(input) };
    out.sendButtonAfterText = findSendBtn() ? btnInfo(findSendBtn()) : null;

    const file = await makeTestFile();
    // 图 1：在输入框上模拟粘贴图片
    let a = attachScore();
    const dt = new DataTransfer();
    dt.items.add(file);
    input.focus();
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    out.pasteImage = { before: a, ...(await waitAttach(a)) };

    // 图 2：模拟拖图到输入框 / 输入区
    a = attachScore();
    const zone = composerOf(input) || input;
    const dt2 = new DataTransfer();
    dt2.items.add(file);
    for (const target of [input, zone]) {
      for (const type of ["dragenter", "dragover"]) target.dispatchEvent(new DragEvent(type, { dataTransfer: dt2, bubbles: true, cancelable: true, composed: true }));
    }
    await sleep(400);
    out.dropZone = cssPath(zone);
    zone.dispatchEvent(new DragEvent("drop", { dataTransfer: dt2, bubbles: true, cancelable: true, composed: true }));
    out.dropImage = { before: a, ...(await waitAttach(a)) };

    // 图 3：直接给页面上的 <input type=file> 塞文件
    const fis = deepAll('input[type="file"]');
    out.fileInputsFound = fis.map((f) => ({ accept: f.accept, multiple: f.multiple, path: cssPath(f) }));
    const fi = fis.find((f) => !f.accept || /image|png|jpe?g|\*/i.test(f.accept)) || fis[0];
    if (fi) {
      a = attachScore();
      const dt3 = new DataTransfer();
      dt3.items.add(file);
      try {
        fi.files = dt3.files;
        fi.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        fi.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        out.fileInput = { used: cssPath(fi), before: a, ...(await waitAttach(a)) };
      } catch (e) {
        out.fileInput = { error: String(e.message || e) };
      }
    }
    out.attachmentsNow = attachState();
    out.sendButtonNow = findSendBtn() ? btnInfo(findSendBtn()) : null;
    tests.fill = out;
  }

  async function testFetch() {
    const imgs = bigImages();
    const img = imgs[imgs.length - 1];
    if (!img) { tests.fetch = { error: "页面上没找到大图片（先让 Copilot 生成一张图）" }; return; }
    const src = img.currentSrc || img.src;
    const out = { count: imgs.length, src: redactSrc(src), kind: src.split(":")[0], shown: `${img.naturalWidth}x${img.naturalHeight}`, chain: ancestorChain(img).slice(0, 6) };
    const sizeOf = async (blob) => {
      try { const bm = await createImageBitmap(blob); const d = `${bm.width}x${bm.height}`; bm.close(); return d; } catch { return null; }
    };
    for (const [key, cred] of [["pageFetch", "include"], ["pageFetchNoCookie", "omit"]]) {
      try {
        const r = await fetch(src, { credentials: cred });
        const b = await r.blob();
        out[key] = { ok: r.ok, status: r.status, type: b.type, size: b.size, dims: await sizeOf(b) };
      } catch (e) {
        out[key] = { ok: false, error: String(e.message || e) };
      }
    }
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
      // 去掉尺寸参数试试能不能拿到更大的原图（Bing 的图常带 ?w=&h=）
      const u = new URL(src);
      if (u.search) {
        out.bgFetchNoQuery = await viaBg(u.origin + u.pathname);
        const keep = new URL(src);
        ["w", "h", "c", "rs", "qlt", "o", "dpr", "r"].forEach((k) => keep.searchParams.delete(k));
        if (keep.href !== src && keep.search) out.bgFetchNoSize = await viaBg(keep.href);
      }
      // 外面包着的链接（点图片打开的大图地址）
      const a = closestDeep(img, "a[href]");
      if (a && /^https:/.test(a.href)) out.wrapLink = { href: redactSrc(a.href), bg: await viaBg(a.href) };
    }
    out.srcset = img.srcset ? short(img.srcset, 200) : undefined;
    out.nearbyButtons = nearbyButtons(img);
    tests.fetch = out;
  }

  // ------------------------------------------------------------ 面板
  const host = document.createElement("div");
  host.id = "aitutu-probe-host";
  // Copilot 的输入框在页面下方正中，面板放右上方，免得挡住
  host.style.cssText = "position:fixed;right:12px;top:72px;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });
  // 有的网站开了 Trusted Types，直接写 innerHTML 会报错；先建一个放行策略，不行再用原样字符串
  let ttPolicy = null;
  try { if (window.trustedTypes) ttPolicy = trustedTypes.createPolicy("aitutu-probe", { createHTML: (x) => x }); } catch (e) { console.warn("[AI图图] 建 Trusted Types 策略失败：", e); }
  const panelHtml = `
    <style>
      .box { width: 350px; background: #fff; color: #18181b; border: 1px solid #d4d4d8; border-radius: 14px; box-shadow: 0 8px 30px rgba(0,0,0,.18);
        font: 13px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; padding: 10px; }
      .box.min .body { display: none; }
      .head { display: flex; align-items: center; gap: 6px; font-weight: 600; cursor: move; user-select: none; }
      .head span { margin-right: auto; }
      .row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      button { border: 1px solid #d4d4d8; background: #fff; color: #18181b; border-radius: 9px; padding: 5px 9px; font: inherit; cursor: pointer; }
      button:hover { background: #f4f4f5; }
      button.on { background: #dc2626; color: #fff; border-color: #dc2626; }
      .tip { color: #71717a; font-size: 12px; margin-top: 6px; }
      textarea { width: 100%; height: 160px; margin-top: 8px; font: 11px/1.4 ui-monospace, Consolas, monospace; border: 1px solid #e4e4e7; border-radius: 8px; box-sizing: border-box; }
    </style>
    <div class="box" id="box">
      <div class="head" id="drag"><span>AI图图 · Copilot 探测（按住这里拖动）</span><button id="min">收起</button></div>
      <div class="body">
        <div class="tip">按顺序：① 点“开始录制” → 手动上传一张产品图、输入一句话、发送、等出图、点开大图、点下载 → ② 点“停止录制” → ③ 点“测试取图” → ④ 点“试填测试”（会往输入框里填几个测试字和 TEST 图，<b>不会发送</b>，测完请自己删掉）→ ⑤ 点“生成报告并复制”。</div>
        <div class="row">
          <button id="rec">① 开始录制</button>
          <button id="fetch">③ 测试取图</button>
          <button id="fill">④ 试填测试</button>
          <button id="copy">⑤ 生成报告并复制</button>
        </div>
        <div class="tip" id="status">录制：未开始</div>
        <textarea id="out" readonly placeholder="报告会显示在这里，复制后发给 AI"></textarea>
      </div>
    </div>`;
  try {
    root.innerHTML = ttPolicy ? ttPolicy.createHTML(panelHtml) : panelHtml;
  } catch (e) {
    console.error("[AI图图] 面板写入失败，改用 DOMParser：", e);
    const doc = new DOMParser().parseFromString(`<body>${panelHtml}</body>`, "text/html");
    [...doc.body.childNodes].forEach((n) => root.appendChild(document.importNode(n, true)));
  }
  // 面板挂在 <html> 下；页面重绘把它删掉时，每 2 秒放回去
  const attach = () => {
    if (!host.isConnected) {
      (document.body || document.documentElement).appendChild(host);
      console.log("[AI图图] 面板已放到页面上");
    }
  };
  document.documentElement.appendChild(host);
  setInterval(attach, 2000);
  window.__aitutuCopilotProbe = attach;
  const $ = (id) => root.getElementById(id);
  const setStatus = (t) => { $("status").textContent = t; };
  let recTimer = null;

  $("drag").addEventListener("pointerdown", (e) => {
    if (e.composedPath()[0].tagName === "BUTTON") return;
    const r = host.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const move = (ev) => {
      host.style.left = Math.max(0, Math.min(innerWidth - 60, ev.clientX - ox)) + "px";
      host.style.top = Math.max(0, Math.min(innerHeight - 30, ev.clientY - oy)) + "px";
      host.style.right = "auto";
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
      observeAll();
      $("rec").textContent = "② 停止录制";
      $("rec").classList.add("on");
      clearInterval(recTimer);
      recTimer = setInterval(() => { observeAll(); setStatus(`录制中… ${tNow()} 秒，已记录 ${recLog.length} 条`); }, 1000);
    } else {
      clearInterval(recTimer);
      $("rec").textContent = "① 开始录制";
      $("rec").classList.remove("on");
      setStatus(`录制结束：共 ${recLog.length} 条，${tNow()} 秒`);
    }
  };
  $("fetch").onclick = async () => {
    setStatus("测试取图中…");
    try { await testFetch(); } catch (e) { tests.fetch = { error: String(e.message || e) }; }
    setStatus("取图测试完成：" + JSON.stringify(tests.fetch).slice(0, 120));
  };
  $("fill").onclick = async () => {
    setStatus("试填中（约 15 秒）…");
    try { await testFill(); } catch (e) { tests.fill = { ...(tests.fill || {}), error: String(e.message || e) }; }
    setStatus("试填完成，请把输入框里的测试文字和 TEST 图片删掉（不要发送）");
  };
  $("copy").onclick = async () => {
    let text;
    try { text = "# AI图图 · Copilot 页面探测报告\n" + JSON.stringify(probe(), null, 1); }
    catch (e) { text = "# AI图图 · Copilot 页面探测报告（生成出错）\n" + String(e.stack || e) + "\n" + JSON.stringify({ recording: recLog, tests }, null, 1); }
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
