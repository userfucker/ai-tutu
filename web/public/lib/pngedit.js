/**
 * 去白边（只给 PNG 用，抠白底图 / 主图 / 详情页 / 素材中心共用）：
 *  PNGEDIT.open({ src, name, saveAs })  src = 图片地址或 Blob；saveAs: false = 只能“保存”（抠白底图的结果）
 *    返回 { how: "save" | "saveAs", blob, name, w, h }：save = 替换原图（名字不变），saveAs = 另存新图（原名-去白边.png）；取消返回 null
 *  PNGEDIT.isPngName(name)
 * 钢笔：点一下加锚点（两点之间直线），按住拖动拉出弧线；点回第一个点闭合，出现蚂蚁线；
 *       右键点锚点删掉它，退格删最后一个点，Esc 放弃；闭合以后 Delete（或“删除选区”）把选区变透明。
 * 边缘：硬（默认）/ 柔和 1 像素（记在浏览器里）。一键去白边：强度 0~20（默认 0 = 不变），拖动时马上看效果。
 * 撤销 / 重做：Ctrl+Z / Ctrl+Y，最多 20 步。滚轮放大缩小，按住空格（或鼠标中键）拖动看别的地方，默认深色底。
 */
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ls = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const MAX_UNDO = 20;

  let styled = false;
  function style() {
    if (styled) return;
    styled = true;
    const ck = (a, b) => `background-color:${a};background-image:linear-gradient(45deg,${b} 25%,transparent 25%),linear-gradient(-45deg,${b} 25%,transparent 25%),linear-gradient(45deg,transparent 75%,${b} 75%),linear-gradient(-45deg,transparent 75%,${b} 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0;`;
    const st = document.createElement("style");
    st.textContent = `
#peLayer { position: fixed; inset: 0; z-index: 950; background: rgba(15,18,25,.6); display: flex; padding: 16px; font-size: 13px; color: #1f2329; }
#peLayer .pebox { background: #fff; border-radius: 12px; flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
#peLayer .pebar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 14px; border-bottom: 1px solid #eceef2; }
#peLayer .pebar h2 { font-size: 15px; margin: 0 8px 0 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 320px; }
#peLayer button { border: 1px solid #d4d6dc; background: #fff; border-radius: 8px; padding: 5px 12px; cursor: pointer; font-size: 13px; color: inherit; }
#peLayer button.primary { background: #1f2329; color: #fff; border-color: #1f2329; }
#peLayer button.on { background: #1f2329; color: #fff; border-color: #1f2329; }
#peLayer button:disabled { opacity: .4; cursor: default; }
#peLayer select { border: 1px solid #d4d6dc; border-radius: 8px; padding: 4px 8px; font-size: 13px; }
#peLayer .sp { margin-left: auto; display: flex; gap: 8px; align-items: center; }
#peLayer .muted { color: #8a8f99; font-size: 12px; }
#peLayer .pehint { padding: 6px 14px; border-bottom: 1px solid #eceef2; }
#peLayer .pewhite { display: none; gap: 10px; align-items: center; padding: 8px 14px; background: #fffbea; border-bottom: 1px solid #f3e3a1; }
#peLayer .pewhite.show { display: flex; }
#peStage { position: relative; flex: 1; overflow: hidden; cursor: crosshair; ${ck("#fff", "#e9eaee")} user-select: none; touch-action: none; }
#peStage.dark { ${ck("#2b2e35", "#23262c")} }
#peStage.panning, #peStage.space { cursor: grab; }
#peStage.panning { cursor: grabbing; }
#peWrap { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
#peWrap canvas { display: block; }
#peWrap.pix canvas { image-rendering: pixelated; }
#peSvg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: hidden; pointer-events: none; }
#peSvg * { vector-effect: non-scaling-stroke; shape-rendering: crispEdges; }
#peSvg .p2 { fill: none; stroke: #1677ff; stroke-width: 1; shape-rendering: auto; }
#peSvg .ants1 { fill: none; stroke: #fff; stroke-width: 1; shape-rendering: auto; }
#peSvg .ants2 { fill: none; stroke: #000; stroke-width: 1; stroke-dasharray: 4 4; animation: peAnts .5s linear infinite; shape-rendering: auto; }
#peSvg .rub { fill: none; stroke: #1677ff; stroke-width: 1; shape-rendering: auto; }
#peSvg .hd { stroke: #1677ff; stroke-width: 1; shape-rendering: auto; }
#peSvg .an { fill: #fff; stroke: #1677ff; stroke-width: 1; }
#peSvg .an.last { fill: #1677ff; }
#peSvg .an.hot { fill: #1677ff; stroke: #000; }
#peSvg .hp { fill: #1677ff; shape-rendering: auto; }
@keyframes peAnts { to { stroke-dashoffset: -8; } }`;
    document.head.appendChild(st);
  }

  /** 路径（锚点 + 出手柄，进手柄 = 出手柄反过来）→ Path2D / SVG d */
  function trace(pts, closed, ctx) {
    if (!pts.length) return;
    ctx.moveTo(pts[0].x, pts[0].y);
    const seg = (a, b) => {
      if (!a.h && !b.h) return ctx.lineTo(b.x, b.y);
      const c1 = a.h ? { x: a.x + a.h.x, y: a.y + a.h.y } : a;
      const c2 = b.h ? { x: b.x - b.h.x, y: b.y - b.h.y } : b;
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
    };
    for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i]);
    if (closed) { seg(pts[pts.length - 1], pts[0]); ctx.closePath(); }
  }
  function svgD(pts, closed) {
    let d = "";
    const r = (v) => Math.round(v * 100) / 100;
    trace(pts, closed, {
      moveTo: (x, y) => (d += `M${r(x)} ${r(y)}`),
      lineTo: (x, y) => (d += `L${r(x)} ${r(y)}`),
      bezierCurveTo: (a, b, c, e, x, y) => (d += `C${r(a)} ${r(b)} ${r(c)} ${r(e)} ${r(x)} ${r(y)}`),
      closePath: () => (d += "Z"),
    });
    return d;
  }

  /** 选区变透明：soft = 边缘柔和 1 像素 */
  function cutPath(im, pts, soft) {
    const W = im.width, H = im.height;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d", { willReadFrequently: true });
    const path = new Path2D();
    trace(pts, true, path);
    g.fillStyle = "#fff";
    g.fill(path);
    const md = g.getImageData(0, 0, W, H).data;
    let m = new Float32Array(W * H);
    for (let i = 0; i < m.length; i++) m[i] = soft ? md[i * 4 + 3] / 255 : md[i * 4 + 3] >= 128 ? 1 : 0;
    if (soft) {
      const o = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; s += m[yy * W + xx]; n++; } }
        o[y * W + x] = s / n;
      }
      m = o;
    }
    const d = im.data;
    for (let i = 0; i < m.length; i++) if (m[i] > 0) d[i * 4 + 3] = Math.round(d[i * 4 + 3] * (1 - m[i]));
    return im;
  }

  /** 一键去白边：只去掉贴着透明处、偏白的边（产品本身的白色不挨着透明处，不会动） */
  function deWhite(src, s) {
    const W = src.width, H = src.height;
    const im = new ImageData(new Uint8ClampedArray(src.data), W, H);
    const d = im.data;
    if (!(s > 0)) return im; // 0 = 不变
    const passes = Math.ceil(s / 4), thr = 250 - s * 3.5; // 20 = 剥 5 层、偏白到 180 都算
    const clear = (i) => d[i * 4 + 3] < 16;
    const whiteish = (i, t) => { const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]; const lo = Math.min(r, g, b); return lo >= t && Math.max(r, g, b) - lo <= 40; };
    const nearClear = (i) => { const x = i % W, y = (i - x) / W; return (x > 0 && clear(i - 1)) || (x < W - 1 && clear(i + 1)) || (y > 0 && clear(i - W)) || (y < H - 1 && clear(i + W)); };
    // 只看边缘一带：先找出挨着透明处的点，往里一层层剥
    let front = [];
    for (let i = 0; i < W * H; i++) if (!clear(i) && nearClear(i)) front.push(i);
    for (let p = 0; p < passes && front.length; p++) {
      const del = front.filter((i) => whiteish(i, thr));
      for (const i of del) d[i * 4 + 3] = 0;
      const next = new Set();
      for (const i of del) {
        const x = i % W;
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < W * H && !clear(j)) next.add(j);
      }
      front = [...next];
    }
    // 最外一圈还有点发白的，变半透明，边不发亮
    for (let i = 0; i < W * H; i++) if (!clear(i) && whiteish(i, thr - 25) && nearClear(i)) d[i * 4 + 3] = Math.round(d[i * 4 + 3] * 0.5);
    return im;
  }

  const isPngName = (n) => /\.png$/i.test(String(n || ""));
  const newName = (n) => { const b = String(n || "图片").replace(/\.[^.]+$/, ""); return (/-去白边$/.test(b) ? b : b + "-去白边") + ".png"; };

  function loadImg(src) {
    return new Promise((res, rej) => {
      const url = src instanceof Blob ? URL.createObjectURL(src) : src;
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("图片打不开"));
      im.src = url;
    });
  }

  async function open(o = {}) {
    style();
    const img = await loadImg(o.src);
    const W = img.naturalWidth, H = img.naturalHeight;
    return new Promise((resolve) => {
      const L = document.createElement("div");
      L.id = "peLayer";
      L.innerHTML = `<div class="pebox">
        <div class="pebar"><h2 title="${esc(o.name || "")}">去白边 · ${esc(o.name || "")}</h2>
          <button id="peDel" disabled title="把蚂蚁线里面的地方变透明（Delete）">删除选区</button>
          <label class="row">边缘 <select id="peEdge"><option value="hard">硬</option><option value="soft">柔和 1 像素</option></select></label>
          <button id="peWhiteBtn" title="不用选，整张图贴着透明处的白边一起去掉">一键去白边</button>
          <button id="peUndo" disabled title="撤销（Ctrl+Z）">撤销</button><button id="peRedo" disabled title="重做（Ctrl+Y）">重做</button>
          <span class="sp"><span class="muted" id="peZoomV">100%</span><button id="peFit">适应窗口</button><button id="peDark">深色底</button>
          <button id="peCancel">取消</button><button id="peSaveAs" disabled title="${o.saveAs === false ? "这里只能保存" : "另存一张新图，原图不动"}">另存为新图</button><button class="primary" id="peSave" disabled title="替换原图">保存</button></span></div>
        <div class="pewhite" id="peWhite"><b>一键去白边</b> 强度 <input type="range" id="peStr" min="0" max="20" step="1" value="0"> <b id="peStrV">0</b>
          <span class="muted">0 是不变，往右越拉去得越多。只去贴着透明处、偏白的边，产品本身的白色不动</span><span class="sp"><button id="peWhiteNo">取消</button><button class="primary" id="peWhiteOk">确定</button></span></div>
        <div class="pehint muted">钢笔：点一下加锚点（两点之间是直线），按住拖动拉出弧线；点回第一个点闭合，出现蚂蚁线后按 Delete 或点“删除选区”。右键点锚点删掉它，退格删最后一个点，Esc 放弃。滚轮放大缩小，按住空格（或鼠标中键）拖动看别的地方。</div>
        <div id="peStage"><div id="peWrap"><canvas id="peCv" width="${W}" height="${H}"></canvas></div><svg id="peSvg"></svg></div></div>`;
      document.body.appendChild(L);
      const $ = (id) => L.querySelector("#" + id);
      const stage = $("peStage"), wrap = $("peWrap"), svg = $("peSvg"), cv = $("peCv");
      const g = cv.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      let cur = g.getImageData(0, 0, W, H);
      const undo = [], redo = [];
      let dirty = false;

      // ---------------------------------------------------------------- 视图
      const v = { z: 1, x: 0, y: 0, fit: 1 };
      let space = false, pan = null, dark = ls.get("st:peDark", "1") === "1";
      const fit = () => {
        const r = stage.getBoundingClientRect();
        v.fit = v.z = Math.min((r.width - 40) / W, (r.height - 40) / H, 4);
        v.x = (r.width - W * v.z) / 2; v.y = (r.height - H * v.z) / 2;
        apply();
      };
      const apply = () => {
        wrap.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.z})`;
        wrap.classList.toggle("pix", v.z >= 3);
        $("peZoomV").textContent = Math.round(v.z * 100) + "%";
        stage.classList.toggle("dark", dark);
        $("peDark").classList.toggle("on", dark);
        draw();
      };
      const toImg = (e) => { const r = stage.getBoundingClientRect(); return { x: (e.clientX - r.left - v.x) / v.z, y: (e.clientY - r.top - v.y) / v.z }; };

      // ---------------------------------------------------------------- 钢笔
      let pts = [], closed = false, drag = null, mouse = null, hot = -1;
      const near = (p, q, px = 8) => Math.hypot(p.x - q.x, p.y - q.y) * v.z <= px;
      const hitAnchor = (p) => pts.findIndex((q) => near(p, q));
      function draw() {
        // 线画在缩放层外面、用屏幕坐标：放多大都是 1 像素（Lee 2026-10-26）
        const r = 3; // 锚点：小方块，屏幕上一直 6 像素
        const sc = (q) => ({ x: v.x + q.x * v.z, y: v.y + q.y * v.z, h: q.h ? { x: q.h.x * v.z, y: q.h.y * v.z } : null });
        const sp = pts.map(sc), sm = mouse && sc(mouse);
        let h = "";
        if (sp.length) {
          const d = svgD(sp, closed);
          if (closed) h += `<path class="ants1" d="${d}"/><path class="ants2" d="${d}"/>`;
          else {
            h += `<path class="p2" d="${d}"/>`;
            if (sm && !drag) {
              const a = sp[sp.length - 1];
              h += `<path class="rub" d="${svgD([a, { x: sm.x, y: sm.y, h: null }], false)}"/>`;
            }
            sp.forEach((q) => { if (q.h) h += `<line class="hd" x1="${q.x - q.h.x}" y1="${q.y - q.h.y}" x2="${q.x + q.h.x}" y2="${q.y + q.h.y}"/><circle class="hp" cx="${q.x + q.h.x}" cy="${q.y + q.h.y}" r="${r * 0.8}"/><circle class="hp" cx="${q.x - q.h.x}" cy="${q.y - q.h.y}" r="${r * 0.8}"/>`; });
            sp.forEach((q, i) => (h += `<rect class="an ${i === sp.length - 1 ? "last" : ""} ${i === hot ? "hot" : ""}" x="${q.x - r}" y="${q.y - r}" width="${2 * r}" height="${2 * r}"/>`));
          }
        }
        svg.innerHTML = h;
        $("peDel").disabled = !closed;
      }
      const resetPath = () => { pts = []; closed = false; drag = null; hot = -1; draw(); };

      // ---------------------------------------------------------------- 图片改动 + 撤销
      const paint = (im) => g.putImageData(im, 0, 0);
      const commit = (im) => {
        undo.push(cur); if (undo.length > MAX_UNDO) undo.shift();
        redo.length = 0;
        cur = im; paint(cur); dirty = true; buttons();
      };
      const buttons = () => { $("peUndo").disabled = !undo.length; $("peRedo").disabled = !redo.length; $("peSave").disabled = !dirty; $("peSaveAs").disabled = !dirty || o.saveAs === false; };
      const doUndo = () => { if (!undo.length) return; redo.push(cur); cur = undo.pop(); paint(cur); dirty = true; buttons(); };
      const doRedo = () => { if (!redo.length) return; undo.push(cur); cur = redo.pop(); paint(cur); dirty = true; buttons(); };
      const delSel = () => {
        if (!closed) return;
        commit(cutPath(new ImageData(new Uint8ClampedArray(cur.data), W, H), pts, $("peEdge").value === "soft"));
        resetPath();
      };

      // ---------------------------------------------------------------- 一键去白边（拖动马上看效果）
      let whiteOn = false, preview = null, wt = 0;
      const showWhite = (on) => {
        whiteOn = on;
        $("peWhite").classList.toggle("show", on);
        $("peWhiteBtn").classList.toggle("on", on);
        if (on) { resetPath(); runPreview(); } else { preview = null; paint(cur); }
      };
      const runPreview = () => { clearTimeout(wt); wt = setTimeout(() => { if (!whiteOn) return; preview = deWhite(cur, +$("peStr").value); paint(preview); }, 60); };

      // ---------------------------------------------------------------- 鼠标
      stage.addEventListener("wheel", (e) => {
        e.preventDefault();
        const r = stage.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
        const z = Math.min(32, Math.max(v.fit * 0.5, v.z * Math.exp(-e.deltaY * 0.0015)));
        v.x = mx - ((mx - v.x) * z) / v.z; v.y = my - ((my - v.y) * z) / v.z; v.z = z;
        apply();
      }, { passive: false });
      stage.addEventListener("contextmenu", (e) => e.preventDefault());
      stage.addEventListener("pointerdown", (e) => {
        if (e.button === 1 || (e.button === 0 && space)) {
          e.preventDefault();
          pan = { x: e.clientX - v.x, y: e.clientY - v.y };
          stage.classList.add("panning");
          stage.setPointerCapture(e.pointerId);
          return;
        }
        if (whiteOn) return;
        const p = toImg(e);
        if (e.button === 2) {
          // 右键删锚点（闭合以前）
          if (closed) return;
          const i = hitAnchor(p);
          if (i >= 0) { pts.splice(i, 1); hot = -1; draw(); }
          return;
        }
        if (e.button !== 0) return;
        if (closed) resetPath(); // 闭合以后再点：重新画
        if (pts.length >= 3 && near(p, pts[0])) { closed = true; hot = -1; draw(); return; }
        pts.push({ x: p.x, y: p.y, h: null });
        drag = { i: pts.length - 1, sx: e.clientX, sy: e.clientY };
        stage.setPointerCapture(e.pointerId);
        draw();
      });
      stage.addEventListener("pointermove", (e) => {
        if (pan) { v.x = e.clientX - pan.x; v.y = e.clientY - pan.y; apply(); return; }
        const p = toImg(e);
        mouse = p;
        if (drag) {
          const q = pts[drag.i];
          q.h = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3 ? { x: p.x - q.x, y: p.y - q.y } : null;
        } else hot = closed ? -1 : hitAnchor(p);
        draw();
      });
      const up = () => { if (pan) { pan = null; stage.classList.remove("panning"); } drag = null; draw(); };
      stage.addEventListener("pointerup", up);
      stage.addEventListener("pointercancel", up);
      stage.addEventListener("pointerleave", () => { mouse = null; if (!drag) draw(); });

      // ---------------------------------------------------------------- 键盘
      const key = (e) => {
        const inInput = /INPUT|SELECT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName) && document.activeElement.type !== "range";
        if (inInput) return;
        const k = e.key, ctrl = e.ctrlKey || e.metaKey;
        if (k === " ") { e.preventDefault(); if (e.type === "keydown") { space = true; stage.classList.add("space"); } else { space = false; stage.classList.remove("space"); } return; }
        if (e.type !== "keydown") return;
        if (ctrl && (k === "z" || k === "Z") && !e.shiftKey) { e.preventDefault(); if (!whiteOn) doUndo(); return; }
        if (ctrl && (k === "y" || k === "Y" || ((k === "z" || k === "Z") && e.shiftKey))) { e.preventDefault(); if (!whiteOn) doRedo(); return; }
        if (k === "Escape") { e.preventDefault(); e.stopPropagation(); if (whiteOn) showWhite(false); else if (pts.length) resetPath(); else close(); return; }
        if (k === "Backspace") { e.preventDefault(); if (!closed && pts.length) { pts.pop(); draw(); } return; }
        if (k === "Delete") { e.preventDefault(); delSel(); return; }
      };
      document.addEventListener("keydown", key, true);
      document.addEventListener("keyup", key, true);

      // ---------------------------------------------------------------- 按钮
      $("peEdge").value = ls.get("st:peEdge2", "hard"); // 默认硬（Lee 2026-10-26）
      $("peEdge").onchange = (e) => { ls.set("st:peEdge2", e.target.value); e.target.blur(); };
      $("peDel").onclick = delSel;
      $("peUndo").onclick = doUndo;
      $("peRedo").onclick = doRedo;
      $("peFit").onclick = fit;
      $("peDark").onclick = () => { dark = !dark; ls.set("st:peDark", dark ? "1" : "0"); apply(); };
      $("peWhiteBtn").onclick = () => showWhite(!whiteOn);
      $("peStr").oninput = (e) => { $("peStrV").textContent = e.target.value; runPreview(); };
      $("peWhiteNo").onclick = () => showWhite(false);
      $("peWhiteOk").onclick = () => { clearTimeout(wt); if (+$("peStr").value === 0) return showWhite(false); /* 0 = 不变 */ const im = preview || deWhite(cur, +$("peStr").value); whiteOn = false; preview = null; $("peWhite").classList.remove("show"); $("peWhiteBtn").classList.remove("on"); commit(im); };
      const finish = (r) => { document.removeEventListener("keydown", key, true); document.removeEventListener("keyup", key, true); L.remove(); resolve(r); };
      const close = () => { if (dirty && !confirm("改过的还没保存，确定不要了？")) return; finish(null); };
      $("peCancel").onclick = close;
      const out = (how) => {
        if (whiteOn) $("peWhiteOk").click();
        const keep = String(o.name || "图片").replace(/\.[^.]+$/, "") + ".png";
        cv.toBlob((blob) => finish({ how, blob, name: how === "save" ? keep : newName(o.name), w: W, h: H }), "image/png");
      };
      $("peSave").onclick = () => out("save");
      $("peSaveAs").onclick = () => { if (o.saveAs !== false) out("saveAs"); };
      L._pe = { get pts() { return pts; }, get closed() { return closed; }, get undo() { return undo.length; } }; // 测试用
      requestAnimationFrame(fit);
    });
  }

  globalThis.PNGEDIT = { open, isPngName, newName, deWhite, cutPath };
})();
