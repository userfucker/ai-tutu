/**
 * 抠白底图 · 编辑框（从 AI图图 插件右侧面板搬过来，操作一样）：
 * 框选商品（8 个点）、自由框选、画笔标注配件、橡皮擦、吸管取色（最多 8 个）、旋转（左右 90° + 微调 -45°～45°）。
 * 坐标都是 0～1（相对整张图）。用到 imagekit.js 的 loadImage / canvasToBlob / findParts。
 *
 * CE.open(files, index, { onSave(f, changed), onRemove(f) })：files 是网页里的产品图对象（有 dataUrl、w、h、crop、lasso、mask、parts、colors…）
 */
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (id) => document.getElementById(id);
  const TOOL_HINT = {
    crop: "按住拖出一个框，把商品框进去（四周留一点空）。拖框内部移动，拖 8 个点调大小。",
    lasso: "像画笔一样按住鼠标沿着商品外面画一圈（任意形状），松开自动闭合；只把圈里面的内容交给 AI，圈外面涂白。再画一次就重新圈。",
    brush: "在容易被当成杂物的小配件上涂抹，连在一起的算一个配件；配件的位置会写进提示词。",
    eraser: "擦掉涂错的地方。",
    picker: "在产品上点一下取色号，要求这个部位保持这个颜色（最多 8 个）。",
  };
  let files = [], idx = -1, rect = null, lasso = null, drag = null, tool = "crop", cb = {}, changed = new Set();
  // 放大缩小、拖动看（Lee 2026-10-25）：view = { z 倍数, x, y 平移（像素）}；深色底记在浏览器里
  let view = { z: 1, x: 0, y: 0 }, pan = null, space = false;
  let dark = (() => { try { return localStorage.getItem("st:viewerDark") === "1"; } catch { return false; } })();
  function applyView() {
    $("ceZoom").style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    $("ceZoomV").textContent = Math.round(view.z * 100) + "%";
    $("ceStage").classList.toggle("dark", dark);
    $("ceDark").classList.toggle("active", dark);
    $("ceDark").textContent = dark ? "深色底 ✓" : "深色底";
  }
  const cur = () => files[idx];

  function build() {
    if ($("ceModal")) return;
    const m = document.createElement("div");
    m.id = "ceModal";
    m.className = "ce-modal";
    m.innerHTML = `<div class="ce-card">
  <div class="row"><b id="ceTitle" style="margin-right:auto"></b><button id="cePrev">上一张</button><button id="ceNext">下一张</button></div>
  <div class="row">
    <div class="seg" id="ceTools"><button data-tool="crop" class="active">框选商品</button><button data-tool="lasso">自由框选</button><button data-tool="brush">画笔标注配件</button><button data-tool="eraser">橡皮擦</button><button data-tool="picker">吸管取色</button></div>
    <span class="muted">粗细</span><input type="range" id="ceBrush" min="4" max="80" value="20" style="width:90px">
    <button id="ceClear" title="清除当前工具画的内容">清除标注</button><button id="ceClearAll" title="清除这张图的框选、自由框选、画笔标注和取色">全部清除</button>
  </div>
  <div class="row"><span class="muted">旋转</span><button id="ceRotL" title="向左转 90°">↺ 90°</button><button id="ceRotR" title="向右转 90°">↻ 90°</button>
    <span class="muted">微调</span><input type="range" id="ceRotFine" min="-45" max="45" step="1" value="0" style="width:140px"><span class="muted" id="ceRotVal">0°</span><button id="ceRotReset">复原</button>
    <span class="muted">（框选、标注会跟着一起转；发给 AI 的是转好的图）</span></div>
  <div class="muted" id="ceHint"></div>
  <div class="row"><span class="muted">滚轮放大缩小，按住鼠标右键（或空格）拖动看别的地方</span><span class="muted" id="ceZoomV">100%</span><button id="ceZoomFit">适应窗口</button><button id="ceDark" title="透明底的 PNG：换成深色底看有没有白边">深色底</button></div>
  <div class="ce-stage" id="ceStage"><div class="ce-zoom" id="ceZoom"><img id="ceImg" draggable="false" alt=""><canvas class="ce-mark" id="ceMark"></canvas><div class="ce-picks" id="cePicks"></div>
    <svg class="ce-lasso" id="ceLassoSvg" viewBox="0 0 100 100" preserveAspectRatio="none" style="display:none"><path id="ceLassoMask" fill-rule="evenodd"></path><polygon id="ceLassoPoly"></polygon><polyline id="ceLassoLine"></polyline></svg>
    <div class="ce-sel" id="ceSel" hidden>${["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((h) => `<span class="h ${h}" data-h="${h}"></span>`).join("")}</div></div></div>
  <input id="ceParts" placeholder="配件说明（选填）：例如“右边两个白色插头是配件，必须保留”">
  <div id="ceColors"></div>
  <div class="row"><span class="muted" id="ceInfo" style="margin-right:auto"></span>
    <button id="ceCropClear">清除框选</button><button id="ceCropAll">框选应用到所有图片</button><button id="ceRemove" class="danger">移除这张</button><button class="primary" id="ceOk">完成</button></div>
</div>`;
    document.body.appendChild(m);
    bind();
  }

  function setTool(t) {
    tool = t;
    document.querySelectorAll("#ceTools button").forEach((b) => b.classList.toggle("active", b.dataset.tool === t));
    $("ceHint").textContent = TOOL_HINT[t];
    $("ceStage").classList.toggle("painting", t !== "crop");
  }
  function show() {
    const f = cur();
    rect = f.crop ? { ...f.crop } : null;
    lasso = f.crop && f.lasso ? f.lasso.map((p) => ({ ...p })) : null;
    $("ceImg").src = f.dataUrl;
    view = { z: 1, x: 0, y: 0 };
    applyView();
    $("ceTitle").textContent = `第 ${idx + 1}/${files.length} 张：${f.name}（${f.w}×${f.h}）`;
    $("cePrev").disabled = idx === 0;
    $("ceNext").disabled = idx === files.length - 1;
    $("ceParts").value = f.partsNote || "";
    $("ceRotFine").value = f.fine || 0;
    $("ceRotVal").textContent = `${f.fine || 0}°`;
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
    const cv = $("ceMark"), m = cur() && cur().mask;
    cv.width = m ? m.width : 1;
    cv.height = m ? m.height : 1;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, cv.width, cv.height);
    if (m) g.drawImage(m, 0, 0);
  }
  function drawSel() {
    const f = cur();
    const extra = (f.parts && f.parts.length ? ` · 配件 ${f.parts.length} 处` : "") + (f.colors && f.colors.length ? ` · 颜色 ${f.colors.length} 个` : "");
    $("ceLassoSvg").style.display = lasso ? "" : "none";
    if (lasso) {
      const pts = lasso.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`);
      const drawing = drag && drag.mode === "lasso";
      $("ceLassoLine").setAttribute("points", drawing ? pts.join(" ") : "");
      $("ceLassoPoly").setAttribute("points", drawing ? "" : pts.join(" "));
      $("ceLassoMask").setAttribute("d", drawing ? "" : `M0,0H100V100H0Z M${pts.join(" L")} Z`);
      $("ceSel").hidden = true;
      $("ceInfo").textContent = (rect ? `自由框选 ${Math.round(rect.w * f.w)}×${Math.round(rect.h * f.h)}（只发圈里的内容）` : "正在画…") + extra;
      return;
    }
    if (!rect) { $("ceSel").hidden = true; $("ceInfo").textContent = "未框选：整张图交给 AI" + extra; return; }
    const sel = $("ceSel");
    sel.hidden = false;
    Object.assign(sel.style, { left: rect.x * 100 + "%", top: rect.y * 100 + "%", width: rect.w * 100 + "%", height: rect.h * 100 + "%" });
    $("ceInfo").textContent = `框选 ${Math.round(rect.w * f.w)}×${Math.round(rect.h * f.h)}` + extra;
  }
  function renderPicks() {
    const list = cur().colors || [];
    $("cePicks").innerHTML = list.map((c, i) => `<span class="pick" style="left:${c.x * 100}%;top:${c.y * 100}%;background:${c.hex}">${i + 1}</span>`).join("");
    $("ceColors").innerHTML = list.map((c, i) => `<div class="crow"><span class="sw" style="background:${c.hex}"></span><b>${i + 1}</b><span>${c.hex}</span>
      <input data-cnote="${i}" value="${esc(c.note)}" placeholder="备注（选填），例如：无线充"><button data-cdel="${i}">×</button></div>`).join("");
    drawSel();
  }
  function save() {
    const f = cur();
    if (!f) return;
    const crop = rect && rect.w > 0.02 && rect.h > 0.02 ? { ...rect } : null;
    const ls = crop && lasso ? lasso.map((p) => ({ ...p })) : null;
    const note = $("ceParts").value.trim();
    if (JSON.stringify([f.crop, f.lasso, f.partsNote || ""]) !== JSON.stringify([crop, ls, note])) changed.add(f);
    f.crop = crop; f.lasso = ls; f.partsNote = note;
  }
  function close() {
    save();
    $("ceModal").classList.remove("show");
    const list = [...changed];
    changed = new Set();
    idx = -1;
    if (cb.onClose) cb.onClose(list);
  }
  const pt = (e) => {
    const r = $("ceImg").getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  async function pickColor(p) {
    const f = cur();
    f.colors = f.colors || [];
    if (f.colors.length >= 8) { if (cb.toast) cb.toast("最多 8 个颜色"); return; }
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
    changed.add(f);
    renderPicks();
  }
  function paintSeg(a, b) {
    const f = cur();
    const m = ensureMask(f);
    const g = m.getContext("2d");
    const shown = $("ceImg").getBoundingClientRect().width || 1;
    g.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    g.strokeStyle = "rgb(255,40,40)";
    g.lineCap = g.lineJoin = "round";
    g.lineWidth = Math.max(1, Number($("ceBrush").value) * (tool === "eraser" ? 0.5 : 0.15)) * (m.width / shown);
    g.beginPath();
    g.moveTo(a.x * m.width, a.y * m.height);
    g.lineTo(b.x * m.width + 0.01, b.y * m.height);
    g.stroke();
    f.maskDirty = true;
    changed.add(f);
    drawMark();
  }
  function clearMarks(kind) {
    const f = cur();
    if (kind === "all" || kind === "crop") { if (!lasso) rect = null; }
    if (kind === "all" || kind === "lasso") { if (lasso) rect = null; lasso = null; }
    if (kind === "all" || kind === "brush" || kind === "eraser") { f.mask = null; f.parts = []; f.maskDirty = true; changed.add(f); drawMark(); }
    if (kind === "all" || kind === "picker") { f.colors = []; changed.add(f); renderPicks(); }
    drawSel();
  }
  // 旋转：每次都从原图重新转（不会越转越糊），框选、标注、取色点跟着一起转
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
    const right = newA % 90 === 0;
    const c = right ? Math.round(Math.abs(Math.cos(rad))) : Math.abs(Math.cos(rad));
    const sn = right ? Math.round(Math.abs(Math.sin(rad))) : Math.abs(Math.sin(rad));
    const W = Math.round(W0 * c + H0 * sn), H = Math.round(W0 * sn + H0 * c);
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    const png = f.orig.type === "image/png";
    if (!png) { g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H); } // PNG 转出来的角留透明
    g.translate(W / 2, H / 2);
    g.rotate(rad);
    g.imageSmoothingQuality = "high";
    g.drawImage(img, -W0 / 2, -H0 / 2);
    const blob = await canvasToBlob(cv, png ? "image/png" : "image/jpeg", 0.95);
    const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
    const dr = (delta * Math.PI) / 180, cs = Math.cos(dr), si = Math.sin(dr);
    const tp = (q) => {
      const x = q.x * f.w - f.w / 2, y = q.y * f.h - f.h / 2;
      return { x: Math.min(1, Math.max(0, (x * cs - y * si + W / 2) / W)), y: Math.min(1, Math.max(0, (x * si + y * cs + H / 2) / H)) };
    };
    const bbox = (pts) => { const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y); const x0 = Math.min(...xs), y0 = Math.min(...ys); return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 }; };
    if (f.lasso && f.lasso.length > 2) { f.lasso = f.lasso.map(tp); f.crop = bbox(f.lasso); }
    else if (f.crop) { const r = f.crop; f.crop = bbox([{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h }].map(tp)); }
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
      f.maskDirty = true;
    }
    Object.assign(f, { dataUrl, rotBlob: blob, w: W, h: H, type: blob.type, size: blob.size, rot90, fine, sampler: null, rotDirty: true });
    changed.add(f);
  }
  async function rotate(rot90, fine) {
    const f = cur();
    if (!f) return;
    save();
    await rotateTo(f, ((rot90 % 360) + 360) % 360, fine);
    show();
  }

  function bind() {
    $("ceTools").addEventListener("click", (e) => { if (e.target.dataset.tool) setTool(e.target.dataset.tool); });
    $("ceColors").addEventListener("input", (e) => { const i = e.target.dataset.cnote; if (i !== undefined) { cur().colors[Number(i)].note = e.target.value.trim(); changed.add(cur()); } });
    $("ceColors").addEventListener("click", (e) => { const i = e.target.dataset.cdel; if (i !== undefined) { cur().colors.splice(Number(i), 1); changed.add(cur()); renderPicks(); } });
    const stage = $("ceStage");
    stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top;
      const z2 = Math.min(12, Math.max(1, view.z * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      view.x = z2 === 1 ? 0 : cx - ((cx - view.x) * z2) / view.z;
      view.y = z2 === 1 ? 0 : cy - ((cy - view.y) * z2) / view.z;
      view.z = z2;
      applyView();
    }, { passive: false });
    stage.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("keydown", (e) => { if (e.code === "Space" && $("ceModal").classList.contains("show") && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); space = true; stage.classList.add("panning"); } });
    document.addEventListener("keyup", (e) => { if (e.code === "Space") { space = false; stage.classList.remove("panning"); } });
    $("ceZoomFit").addEventListener("click", () => { view = { z: 1, x: 0, y: 0 }; applyView(); });
    $("ceDark").addEventListener("click", () => { dark = !dark; try { localStorage.setItem("st:viewerDark", dark ? "1" : "0"); } catch {} applyView(); });
    stage.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (e.button === 2 || space) { pan = { sx: e.clientX, sy: e.clientY, x: view.x, y: view.y }; stage.setPointerCapture(e.pointerId); stage.classList.add("panning"); return; }
      const p = pt(e);
      if (tool === "picker") { pickColor(p); return; }
      if (tool === "lasso") { drag = { mode: "lasso" }; lasso = [p]; rect = null; stage.setPointerCapture(e.pointerId); drawSel(); return; }
      if (tool !== "crop") { drag = { mode: "paint", last: p }; stage.setPointerCapture(e.pointerId); paintSeg(p, p); return; }
      const h = e.target.dataset.h;
      if (h && rect) lasso = null;
      if (h && rect) drag = { mode: "resize", h, orig: { ...rect } };
      else if (e.target === $("ceSel") && rect) drag = { mode: "move", start: p, orig: { ...rect } };
      else { drag = { mode: "new", start: p }; rect = { x: p.x, y: p.y, w: 0, h: 0 }; lasso = null; }
      stage.setPointerCapture(e.pointerId);
      drawSel();
    });
    stage.addEventListener("pointermove", (e) => {
      if (pan) { view.x = pan.x + e.clientX - pan.sx; view.y = pan.y + e.clientY - pan.sy; applyView(); return; }
      if (!drag) return;
      const p = pt(e);
      if (drag.mode === "paint") { paintSeg(drag.last, p); drag.last = p; return; }
      if (drag.mode === "lasso") { const last = lasso[lasso.length - 1]; if (Math.hypot(p.x - last.x, p.y - last.y) > 0.004) { lasso.push(p); drawSel(); } return; }
      if (drag.mode === "resize") {
        const o = drag.orig, h = drag.h, MIN = 0.02;
        let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
        if (h.includes("w")) x0 = Math.min(p.x, x1 - MIN);
        if (h.includes("e")) x1 = Math.max(p.x, x0 + MIN);
        if (h.includes("n")) y0 = Math.min(p.y, y1 - MIN);
        if (h.includes("s")) y1 = Math.max(p.y, y0 + MIN);
        rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      } else if (drag.mode === "move") {
        const o = drag.orig;
        rect = { ...o, x: Math.min(1 - o.w, Math.max(0, o.x + p.x - drag.start.x)), y: Math.min(1 - o.h, Math.max(0, o.y + p.y - drag.start.y)) };
      } else {
        const s = drag.start;
        rect = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) };
      }
      drawSel();
    });
    stage.addEventListener("pointerup", () => {
      if (pan) { pan = null; if (!space) stage.classList.remove("panning"); return; }
      if (drag && drag.mode === "lasso") {
        drag = null;
        if (lasso.length < 3) { lasso = null; drawSel(); return; }
        const xs = lasso.map((q) => q.x), ys = lasso.map((q) => q.y);
        const x0 = Math.min(...xs), y0 = Math.min(...ys);
        rect = { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
        if (rect.w < 0.02 || rect.h < 0.02) { rect = null; lasso = null; }
        drawSel();
        return;
      }
      if (drag && drag.mode === "paint") { drag = null; const f = cur(); f.parts = f.mask ? findParts(f.mask) : []; drawSel(); return; }
      drag = null;
      if (rect && (rect.w < 0.02 || rect.h < 0.02)) rect = null;
      drawSel();
    });
    $("cePrev").addEventListener("click", () => { save(); idx--; show(); });
    $("ceNext").addEventListener("click", () => { save(); idx++; show(); });
    $("ceCropClear").addEventListener("click", () => { rect = null; lasso = null; drawSel(); });
    $("ceCropAll").addEventListener("click", () => {
      if (!rect) { if (cb.toast) cb.toast("先框一个区域"); return; }
      files.forEach((f) => { f.crop = { ...rect }; f.lasso = lasso ? lasso.map((q) => ({ ...q })) : null; changed.add(f); });
      if (cb.toast) cb.toast(`框选已应用到全部 ${files.length} 张`);
    });
    $("ceClear").addEventListener("click", () => clearMarks(tool));
    $("ceClearAll").addEventListener("click", () => clearMarks("all"));
    $("ceRotL").addEventListener("click", () => { const f = cur(); rotate((f.rot90 || 0) - 90, f.fine || 0); });
    $("ceRotR").addEventListener("click", () => { const f = cur(); rotate((f.rot90 || 0) + 90, f.fine || 0); });
    $("ceRotFine").addEventListener("input", (e) => { $("ceRotVal").textContent = `${e.target.value}°`; });
    $("ceRotFine").addEventListener("change", (e) => { const f = cur(); rotate(f.rot90 || 0, Number(e.target.value)); });
    $("ceRotReset").addEventListener("click", () => rotate(0, 0));
    $("ceRemove").addEventListener("click", () => {
      const f = cur();
      files.splice(idx, 1);
      changed.delete(f);
      if (cb.onRemove) cb.onRemove(f);
      if (!files.length) { close(); return; }
      idx = Math.min(idx, files.length - 1);
      show();
    });
    $("ceOk").addEventListener("click", close);
    $("ceModal").addEventListener("mousedown", (e) => { if (e.target === $("ceModal")) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("ceModal").classList.contains("show")) close(); });
  }

  window.CE = {
    open(list, i, callbacks = {}) {
      build();
      files = list; idx = i; cb = callbacks; changed = new Set();
      $("ceModal").classList.add("show");
      show();
    },
  };
})();
