/**
 * 详情页工作室 · ⑥ 生成和编辑
 *
 * 左边：每一屏的缩略图；中间：画布（点中文字 / 产品可以拖动，有对齐辅助线）；右边：选中的东西的设置。
 * 顶部切换语言、平台，画布马上按那个语言 / 尺寸重画。生成背景、翻译都排进 AI 任务队列。
 */
(() => {
  const esc = ST.esc;
  const P = () => APP.project;
  const ed = (APP.ed = { si: 0, lang: "", pf: "", sel: null, preview: false, last: null, rendering: false, again: false });
  const gen = new Map(); // 屏幕编号 → 生成背景的状态（不保存）
  const hgen = new Map(); // 屏幕编号 → 融入背景的状态（不保存）
  let harmSite = (() => { try { return localStorage.getItem("st:harmSite") || ""; } catch { return ""; } })(); // 融入用哪个 AI（空 = 按 AI 分工轮流）
  const thumbs = new Map(); // 屏幕编号 → { sig, url }

  const curPf = () => ST.platformOf(P(), ed.pf || P().platform);
  const cur = () => P().screens[ed.si];
  const brand = () => APP.brandOf();

  // ------------------------------------------------------------ 生成背景
  async function screenRatio(sc) {
    const p = P();
    const pf = ST.platformOf(p, p.platform);
    if (pf.h) return closestAiRatio(pf.w, pf.h);
    const r = await ST.renderScreen(p, sc, { platform: pf, lang: p.lang, brand: brand(), pxWidth: 100 });
    return closestAiRatio(1000, r.H);
  }
  APP.genBg = async (sc, i = 0) => {
    const p = P();
    if (gen.get(sc.id) && /排队|生成中/.test(gen.get(sc.id))) return;
    gen.set(sc.id, "排队中");
    refresh();
    try {
      const ratio = await screenRatio(sc);
      const imgs = [];
      const blend = !!sc.bg.blend && sc.slots && sc.slots.main;
      if (blend) {
        const a = ST.assetOf(p, sc.slots.main);
        imgs.push({ blob: await ST.db.getBlob(a.cut || a.key), name: "产品.jpg", max: 1536 });
      }
      const ref = p.style && p.style.styleRef && (await ST.db.getBlob(p.style.styleRef));
      if (ref) imgs.push({ blob: ref, name: "风格参考.jpg", max: 1024 });
      const prompt = blend ? ST.P.blend(p, sc, ratio, !!ref) : ST.P.background(p, sc, ratio, !!ref);
      gen.set(sc.id, "生成中");
      refresh();
      const blob = await APP.aiImage(prompt, imgs, `背景：第 ${p.screens.indexOf(sc) + 1} 屏 ${ST.TPL[sc.tpl].name}`);
      const key = `${p.id}:bg-${sc.id}-${Date.now()}`;
      await ST.saveImage(key, blob);
      APP.mark();
      const old = sc.bg.key;
      sc.bg.key = key;
      if (sc.bg.mode === "color") sc.bg.mode = "ai";
      if (!p.style.styleRef && !blend) { p.style.styleRef = `${p.id}:styleref`; await ST.saveImage(p.style.styleRef, blob); }
      APP.commit();
      if (old && !APP.undo.some((s) => s.includes(old))) { ST.forget(old); }
      gen.delete(sc.id);
      if (p.harmAuto !== false && !blend) setTimeout(() => APP.harmScreen(sc, i, true), 0); // 融入背景（B 方式）默认开
    } catch (e) {
      gen.set(sc.id, e.result && e.result.cancelled ? "" : "失败：" + e.message);
      if (!gen.get(sc.id)) gen.delete(sc.id);
    }
    refresh();
  };
  APP.genAllBg = async (force) => {
    const p = P();
    const list = p.screens.filter((s) => s.bg.mode === "ai" && (force || !s.bg.key));
    if (!list.length) return APP.toast("没有要生成的背景（需要 AI 背景的屏都已经有了）");
    APP.toast(`开始生成 ${list.length} 张背景，进度看右上角“AI 任务”`);
    if (!p.style.styleRef) { await APP.genBg(list[0]); list.shift(); } // 先出第一张，作为后面几张的风格参考
    await Promise.all(list.map((s, i) => APP.genBg(s, i + 1)));
  };

  // ------------------------------------------------------------ 融入背景（B 方式）
  /** 融入一屏：程序贴好的图交给 AI 调光影，检查产品没变样；i = 一批里的第几个（Gemini / Copilot 轮流） */
  APP.harmScreen = async (sc, i = 0, quiet) => {
    const p = P();
    if (/排队|中/.test(hgen.get(sc.id) || "")) return;
    const st0 = await ST.harmState(p, sc);
    if (!st0.can) { if (!quiet) APP.toast("这一屏没有背景图或产品图，不用融入", true); return; }
    hgen.set(sc.id, "融入：排队中");
    refresh();
    const sites = harmSite ? [harmSite] : undefined;
    const no = p.screens.indexOf(sc) + 1;
    try {
      const r = await ST.harmonize(p, sc, {
        image: (prompt, imgs, label, n) => { hgen.set(sc.id, n ? "融入：重做中" : "融入中"); refresh(); return APP.aiImage(prompt, imgs.map((x) => ({ ...x, max: 1536 })), label, { role: "dt_blend", sites, rotate: i + n }); },
        json: (prompt, imgs, label) => { hgen.set(sc.id, "融入：检查中"); refresh(); return APP.aiJson(prompt, imgs.map((x) => ({ ...x, max: 1024 })), label, { role: "dt_check", rotate: i }); },
      });
      hgen.delete(sc.id);
      await APP.save(true);
      if (r.ok) APP.toast(`第 ${no} 屏融入背景完成：${ST.harmText(sc.harm)}`, !!r.note);
    } catch (e) {
      if (e.result && e.result.cancelled) hgen.delete(sc.id);
      else hgen.set(sc.id, "融入失败：" + e.message);
    }
    refresh();
  };
  APP.harmAll = async () => {
    const p = P();
    const list = [];
    for (const sc of p.screens) { const h = await ST.harmState(p, sc); if (h.can && !h.used) list.push(sc); }
    if (!list.length) return APP.toast("没有要融入的屏（有背景图、有产品图的屏都融入过了）");
    APP.toast(`开始融入 ${list.length} 屏，进度看右上角“AI 任务”`);
    await Promise.all(list.map((sc, i) => APP.harmScreen(sc, i)));
  };
  /** 翻译所有缺的文字 */
  APP.translateAll = async (langs) => {
    const p = P();
    langs = langs || p.langs;
    let n = 0;
    for (const lang of langs) {
      const miss = ST.missingTexts(p, lang);
      const keys = Object.keys(miss);
      for (let i = 0; i < keys.length; i += 50) {
        const chunk = Object.fromEntries(keys.slice(i, i + 50).map((k) => [k, miss[k]]));
        try {
          const r = await APP.aiJson(ST.P.translate(p, chunk, lang), [], `翻译成${ST.lang(lang).name}${keys.length > 50 ? `（${i / 50 + 1}）` : ""}`);
          APP.mark();
          ST.applyTranslation(p, lang, r.t || r);
          APP.commit();
          n += Object.keys(r.t || r).length;
          refresh();
        } catch (e) {
          if (e.result && e.result.cancelled) return n;
          APP.toast(`翻译成${ST.lang(lang).name}没成功：${e.message}`, true);
        }
      }
    }
    return n;
  };

  // ------------------------------------------------------------ 画面
  let stageEl, boxEl, canvasEl;
  function layerData(id) {
    const sc = cur();
    let m;
    if (!id) return null;
    if ((m = /^item(\d+)\.(title|desc)$/.exec(id))) return { kind: "text", get: (l) => ST.tr(sc.items[+m[1]] && sc.items[+m[1]][m[2]], l, P().lang).text, set: (v, l) => { const it = sc.items[+m[1]]; it[m[2]] = it[m[2]] || {}; it[m[2]][l] = v; } };
    if ((m = /^item(\d+)\.img$/.exec(id))) return { kind: "img", asset: () => sc.items[+m[1]] && sc.items[+m[1]].asset, setAsset: (a) => (sc.items[+m[1]].asset = a), tags: ST.TPL[sc.tpl].items && ST.TPL[sc.tpl].items.assetTags };
    if ((m = /^item(\d+)\.icon$/.exec(id))) return { kind: "icon", get: () => sc.items[+m[1]].icon, set: (v) => (sc.items[+m[1]].icon = v) };
    if ((m = /^item(\d+)\.anchor$/.exec(id))) return { kind: "handle" };
    if ((m = /^param(\d+)\.(k|v)$/.exec(id))) {
      const i = +m[1], f = m[2];
      return { kind: "text", param: true, get: (l) => { const r = ST.paramRows(P(), l)[i]; return r ? r[f] : ""; },
        set: (v, l) => { const p = P(); const rows = (p.info.params || []).filter((r) => r.k || r.v); const row = rows[i]; if (!row) return; if (l === p.lang) row[f] = v; else { p.info.tr[l] = p.info.tr[l] || {}; p.info.tr[l][`p${p.info.params.indexOf(row)}.${f}`] = v; } } };
    }
    if (/^dim\./.test(id)) return { kind: "dim" };
    if (id === "logo") return { kind: "logo" };
    if (["main", "side"].includes(id) || /^(left|right)\.img$/.test(id)) { const k = id.replace(".img", ""); return { kind: "img", product: true, asset: () => sc.slots[k], setAsset: (a) => (sc.slots[k] = a), tags: ((ST.TPL[sc.tpl].slots || []).find((s) => s.key === k) || {}).tags }; }
    return { kind: "text", get: (l) => ST.tr(sc.text[id], l, P().lang).text, set: (v, l) => { sc.text[id] = sc.text[id] || {}; sc.text[id][l] = v; } };
  }

  async function drawCanvas() {
    if (ed.rendering) { ed.again = true; return; }
    ed.rendering = true;
    try {
      do {
        ed.again = false;
        const sc = cur();
        if (!sc || !canvasEl) break;
        const pf = curPf();
        const cssW = boxEl.clientWidth || 500;
        const r = await ST.renderScreen(P(), sc, { platform: pf, lang: ed.lang, brand: brand(), pxWidth: Math.min(pf.w, Math.round(cssW * (devicePixelRatio || 1))) });
        canvasEl.width = r.canvas.width; canvasEl.height = r.canvas.height;
        canvasEl.getContext("2d").drawImage(r.canvas, 0, 0);
        ed.last = r;
        drawSel();
        const hk = JSON.stringify(r.harm || {}) + sc.id;
        if (hk !== ed.hk) { ed.hk = hk; renderRight(); } // 融入背景那一栏要等画完才知道状态
      } while (ed.again);
    } finally { ed.rendering = false; }
  }
  function cssScale() { return boxEl.clientWidth / 1000; }
  function drawSel(guides = []) {
    if (!boxEl) return;
    boxEl.querySelectorAll(".selbox,.guide").forEach((x) => x.remove());
    const r = ed.last;
    if (!r) return;
    const s = cssScale();
    const b = ed.sel && r.boxes.find((x) => x.id === ed.sel);
    if (b) {
      const d = document.createElement("div");
      d.className = "selbox" + (b.locked ? " locked" : "");
      Object.assign(d.style, { left: b.x * s + "px", top: b.y * s + "px", width: b.w * s + "px", height: b.h * s + "px" });
      boxEl.appendChild(d);
    }
    for (const gl of guides) {
      const d = document.createElement("div");
      d.className = "guide " + gl.dir;
      if (gl.dir === "v") d.style.left = gl.v * s + "px"; else d.style.top = gl.v * s + "px";
      boxEl.appendChild(d);
    }
  }

  function hit(x, y) {
    const r = ed.last;
    if (!r) return null;
    const order = { handle: 0, text: 1, icon: 2, img: 3 };
    const list = r.boxes.filter((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    list.sort((a, b) => order[a.t] - order[b.t] || a.w * a.h - b.w * b.h);
    return list[0] || null;
  }

  function bindCanvas() {
    let drag = null;
    canvasEl.onpointerdown = (e) => {
      const rect = canvasEl.getBoundingClientRect();
      const s = rect.width / 1000;
      const x = (e.clientX - rect.left) / s, y = (e.clientY - rect.top) / s;
      const b = hit(x, y);
      ed.sel = b ? b.id : null;
      drawSel();
      renderRight();
      if (!b || b.locked) return;
      const sc = cur();
      sc.ov = sc.ov || {};
      const o = sc.ov[b.id] || {};
      APP.mark();
      drag = { id: b.id, x0: x, y0: y, dx0: o.dx || 0, dy0: o.dy || 0, box: { ...b }, moved: false };
      canvasEl.setPointerCapture(e.pointerId);
    };
    canvasEl.onpointermove = (e) => {
      if (!drag) return;
      const rect = canvasEl.getBoundingClientRect();
      const s = rect.width / 1000;
      let dx = (e.clientX - rect.left) / s - drag.x0, dy = (e.clientY - rect.top) / s - drag.y0;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      drag.moved = true;
      // 对齐：中线、画布边、其他东西的边和中线
      const H = ed.last.H;
      const others = ed.last.boxes.filter((b) => b.id !== drag.id);
      const xs = [0, 500, 1000, ...others.flatMap((b) => [b.x, b.x + b.w / 2, b.x + b.w])];
      const ys = [H / 2, ...others.flatMap((b) => [b.y, b.y + b.h / 2, b.y + b.h])];
      const b = drag.box;
      const guides = [];
      if (!e.altKey) {
        let best = null;
        for (const px of [b.x + dx, b.x + dx + b.w / 2, b.x + dx + b.w]) for (const gx of xs) { const d = gx - px; if (Math.abs(d) < 6 && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, v: gx }; }
        if (best) { dx += best.d; guides.push({ dir: "v", v: best.v }); }
        best = null;
        for (const py of [b.y + dy, b.y + dy + b.h / 2, b.y + dy + b.h]) for (const gy of ys) { const d = gy - py; if (Math.abs(d) < 6 && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, v: gy }; }
        if (best) { dy += best.d; guides.push({ dir: "h", v: best.v }); }
      }
      const sc = cur();
      sc.ov[drag.id] = { ...(sc.ov[drag.id] || {}), dx: Math.round(drag.dx0 + dx), dy: Math.round(drag.dy0 + dy) };
      const sel = boxEl.querySelector(".selbox");
      if (sel) { sel.style.left = (b.x + dx) * s + "px"; sel.style.top = (b.y + dy) * s + "px"; }
      drawSel.guides = guides;
      drawCanvas().then(() => drawSel(drag ? guides : []));
    };
    canvasEl.onpointerup = () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      drawSel();
      if (moved) { APP.commit(); thumbsLater(); renderRight(); }
    };
  }

  function nudge(dx, dy) {
    const sc = cur();
    if (!ed.sel) return;
    const b = ed.last && ed.last.boxes.find((x) => x.id === ed.sel);
    if (b && b.locked) return;
    APP.mark();
    sc.ov = sc.ov || {};
    const o = sc.ov[ed.sel] || {};
    sc.ov[ed.sel] = { ...o, dx: (o.dx || 0) + dx, dy: (o.dy || 0) + dy };
    APP.commit();
    drawCanvas();
  }
  document.addEventListener("keydown", (e) => {
    if (APP.step !== "edit" || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || !document.getElementById("modalWrap").hidden) return;
    const k = e.key;
    const st = e.shiftKey ? 10 : 1;
    if (k === "ArrowLeft") { e.preventDefault(); nudge(-st, 0); }
    else if (k === "ArrowRight") { e.preventDefault(); nudge(st, 0); }
    else if (k === "ArrowUp") { e.preventDefault(); nudge(0, -st); }
    else if (k === "ArrowDown") { e.preventDefault(); nudge(0, st); }
    else if (k === "Escape") { ed.sel = null; drawSel(); renderRight(); }
    else if ((k === "Delete" || k === "Backspace") && ed.sel) { e.preventDefault(); setOv({ hidden: true }); ed.sel = null; renderRight(); }
  });

  // 文字看不清时的处理（Lee 2026-10-23：多个选项，自己选）
  const FIXES = [["", "跟项目设置"], ["auto", "程序自己选"], ["scrim", "加半透明底"], ["outline", "加描边"], ["shadow", "加阴影"], ["none", "不处理（只在检查里提示）"]];
  function setOv(patch, commit = true) {
    const sc = cur();
    if (!ed.sel) return;
    if (commit) APP.mark();
    sc.ov = sc.ov || {};
    const o = { ...(sc.ov[ed.sel] || {}), ...patch };
    for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null || o[k] === "") delete o[k];
    if (Object.keys(o).length) sc.ov[ed.sel] = o; else delete sc.ov[ed.sel];
    if (commit) APP.commit();
    drawCanvas();
    thumbsLater();
  }

  // ------------------------------------------------------------ 缩略图
  let thumbTimer = 0;
  function thumbsLater() { clearTimeout(thumbTimer); thumbTimer = setTimeout(drawThumbs, 400); }
  async function drawThumbs() {
    const p = P();
    if (APP.step !== "edit") return;
    const pf = curPf();
    for (const sc of p.screens) {
      const sig = JSON.stringify(sc) + ed.lang + pf.id + pf.w + (p.info.params || []).length + p.tone + (p.brandId || "") + (p.textFix || "") + (p.textColorAuto === false);
      const t = thumbs.get(sc.id);
      const el = document.querySelector(`[data-thumb="${sc.id}"] img`);
      if (t && t.sig === sig) { if (el && el.src !== t.url) el.src = t.url; continue; }
      const r = await ST.renderScreen(p, sc, { platform: pf, lang: ed.lang, brand: brand(), pxWidth: 260 });
      const blob = await ST.toBlob(r.canvas, "image/jpeg", 0.8);
      if (t) URL.revokeObjectURL(t.url);
      const url = URL.createObjectURL(blob);
      thumbs.set(sc.id, { sig, url });
      const el2 = document.querySelector(`[data-thumb="${sc.id}"] img`);
      if (el2) el2.src = url;
      if (sc === p.screens[0] && ed.lang === p.lang && pf.id === p.platform) {
        p.thumb = `${p.id}:thumb`;
        ST.saveImage(p.thumb, blob).then(() => APP.save());
      }
    }
  }

  // ------------------------------------------------------------ 右边面板
  function issuesHtml() {
    const r = ed.last;
    if (!r || !r.issues.length) return '<span class="tag ok">这一屏没发现问题</span>';
    const seen = new Set();
    return r.issues.filter((i) => { const k = i.type + i.id; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((i) => `<div class="issue tag ${ST.ISSUE_LEVEL[i.type] || "warn"}" ${i.id ? `data-act="selLayer" data-id="${esc(i.id)}"` : ""} style="cursor:${i.id ? "pointer" : "default"}">${esc(ST.ISSUE_NAMES[i.type] || i.type)}${i.id ? `（${esc(i.id)}）` : ""}：${esc(i.msg)}</div>`).join("");
  }
  async function renderRight() {
    const box = document.getElementById("edRight");
    if (!box) return;
    const p = P();
    const sc = cur();
    if (!sc) { box.innerHTML = ""; return; }
    const t = ST.TPL[sc.tpl];
    const o = (sc.ov || {})[ed.sel] || {};
    const d = layerData(ed.sel);
    const banned = [];
    const lockHide = `<div class="row"><label class="row"><input type="checkbox" data-ov="locked" ${o.locked ? "checked" : ""}> 锁定（不能拖动）</label><button class="sm" data-act="hideLayer">隐藏</button><button class="sm" data-act="resetLayer">复位</button></div>`;
    const scaleRow = `<label class="lb">大小 ${Math.round((o.s || 1) * 100)}%<input type="range" min="40" max="250" step="5" value="${Math.round((o.s || 1) * 100)}" data-ovs></label>`;
    let html = "";
    if (d && d.kind === "text") {
      const val = d.get(ed.lang);
      const mainVal = d.get(p.lang);
      for (const b of ST.findBanned(val, ed.lang, curPf().rules || [], APP.customWords())) banned.push(b);
      html = `<div class="sec"><h3>文字 <span class="muted">${esc(ed.sel)}</span></h3>
        ${ed.lang !== p.lang ? `<div class="muted">原文（${esc(ST.lang(p.lang).name)}）：${esc(mainVal)}</div>` : ""}
        <textarea id="txtVal" rows="3">${esc(val)}</textarea>
        <div id="txtBanned">${banned.map((b) => `<div class="issue tag bad">违禁词“${esc(b.word)}”：${esc(b.tip)}</div>`).join("")}</div>
        ${scaleRow}
        <label class="row lb">颜色 <input type="color" data-ov="color" value="${o.color || "#000000"}"> <button class="sm" data-act="resetColor" ${o.color ? "" : "disabled"}>用默认颜色</button></label>
        <div class="muted">${o.color ? "手动选了颜色：不自动换黑白" : "和背景对比不够时，自动换成黑或白里对比更强的颜色"}</div>
        <label class="row lb">看不清时 <select id="txtFix">${FIXES.map(([v, n]) => `<option value="${v}" ${(o.fix || "") === v ? "selected" : ""}>${v ? n : `跟项目设置（${(FIXES.find((f) => f[0] === (p.textFix || "auto")) || [])[1]}）`}</option>`).join("")}</select></label>
        <label class="row lb">项目设置 <select id="projFix">${FIXES.slice(1).map(([v, n]) => `<option value="${v}" ${(p.textFix || "auto") === v ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <label class="row lb"><input type="checkbox" id="projColorAuto" ${p.textColorAuto !== false ? "checked" : ""}> 对比不够时自动换黑 / 白（整个项目）</label>
        ${lockHide}</div>`;
    } else if (d && d.kind === "img") {
      const a = ST.assetOf(p, d.asset());
      const url = a ? await ST.urlOf(a.cut || a.key) : "";
      html = `<div class="sec"><h3>图片 <span class="muted">${esc(ed.sel)}</span></h3>
        <div class="row nw"><button class="thumbbtn" data-act="pickLayerImg" style="width:64px;height:64px;background-image:url('${url}')"></button><div class="col"><button class="sm" data-act="pickLayerImg">换图</button>${a && !a.cut && d.product ? '<span class="muted">这张图还没抠图，贴到背景上会带着原背景</span>' : ""}</div></div>
        ${scaleRow}${lockHide}</div>`;
    } else if (d && d.kind === "icon") {
      html = `<div class="sec"><h3>图标</h3><select id="iconSel">${Object.entries(ST.ICONS).map(([k, n]) => `<option value="${k}" ${d.get() === k ? "selected" : ""}>${n}</option>`).join("")}</select>${scaleRow}${lockHide}</div>`;
    } else if (d && d.kind === "handle") {
      html = `<div class="sec"><h3>引线端点</h3><div class="muted">拖动小圆点，让引线指到产品上对应的位置。</div>${lockHide}</div>`;
    } else if (d && d.kind === "dim") {
      html = `<div class="sec"><h3>尺寸标注</h3><div class="muted">数字来自“③ 产品信息”里的尺寸，单位按语言自动换算。</div>${scaleRow}${lockHide}</div>`;
    } else if (d && d.kind === "logo") {
      html = `<div class="sec"><h3>品牌 logo</h3><div class="muted">在“设置 → 品牌”里换。</div>${scaleRow}${lockHide}</div>`;
    }
    const st = gen.get(sc.id) || "";
    const hidden = Object.entries(sc.ov || {}).filter(([, v]) => v.hidden).map(([k]) => k);
    html += `<div class="sec"><div class="row"><h3>第 ${ed.si + 1} 屏</h3><span class="muted">${esc(t.name)}</span>
        <span class="sp row"><button class="sm" data-act="moveScreen" data-d="-1" ${ed.si ? "" : "disabled"}>↑</button><button class="sm" data-act="moveScreen" data-d="1" ${ed.si < p.screens.length - 1 ? "" : "disabled"}>↓</button></span></div>
      <label class="lb">模板<select id="tplSel">${ST.TPL_ORDER.map((id) => `<option value="${id}" ${id === sc.tpl ? "selected" : ""}>${ST.TPL[id].name}</option>`).join("")}</select></label>
      ${t.items ? `<div class="row lb">${esc(t.items.name)}：${sc.items.length} 项 <button class="sm" data-act="itemCount" data-d="-1" ${sc.items.length > t.items.min ? "" : "disabled"}>－</button><button class="sm" data-act="itemCount" data-d="1" ${sc.items.length < t.items.max ? "" : "disabled"}>＋</button></div>` : ""}
      <div class="row"><button class="sm" data-act="rewrite">AI 重写这屏文案</button><button class="sm" data-act="dupScreen">复制这屏</button><button class="sm danger" data-act="delScreenEd">删除</button></div>
      ${hidden.length ? `<div class="lb">隐藏了：${hidden.map((h) => `<button class="sm" data-act="unhide" data-id="${esc(h)}">${esc(h)} 显示</button>`).join(" ")}</div>` : ""}</div>
      <div class="sec"><h3>背景</h3>
        <select id="bgMode"><option value="ai">AI 画</option><option value="color">纯色</option><option value="upload">上传图片</option></select>
        ${sc.bg.mode === "ai" ? `<label class="lb">画面描述（英文）<textarea id="bgPrompt" rows="3" placeholder="如：soft beige marble surface, warm morning light">${esc(sc.bg.prompt || "")}</textarea></label>
          ${(t.slots || []).some((s) => s.key === "main") && t.bg === "ai" ? `<label class="row lb"><input type="checkbox" id="bgBlend" ${sc.bg.blend ? "checked" : ""}> AI 直接把产品画进场景（A 方式：更自然，但产品可能变样；勾了就不再做下面的“融入背景”）</label>` : ""}
          <div class="row"><button class="sm blue" data-act="genOne" ${/排队|生成中/.test(st) ? "disabled" : ""}>${sc.bg.key ? "重新生成" : "生成背景"}</button>${sc.bg.key ? '<button class="sm" data-act="asStyle" title="后面生成的背景都参考这张的配色和光线">设为风格参考</button>' : ""}</div>
          ${st ? `<div class="issue tag ${/失败/.test(st) ? "bad" : "blue"}">${esc(st)}</div>` : ""}` : ""}
        ${sc.bg.mode === "upload" ? '<div class="row"><button class="sm" data-act="uploadBg">选择背景图</button></div>' : ""}
        ${harmHtml(sc)}
        <label class="row lb">底色 <input type="color" id="bgColor" value="${sc.bg.color || ST.theme(p, brand())[t.bgColor === "white" ? "card" : t.bgColor] || "#ffffff"}"> <button class="sm" data-act="bgColorReset" ${sc.bg.color ? "" : "disabled"}>用风格默认</button></label>
      </div>
      <div class="sec"><h3>产品投影</h3>
        <div class="row"><select id="shDir"><option value="b">正下方</option><option value="bl">左下</option><option value="br">右下</option><option value="none">不要投影</option></select>
        <label class="lb grow">深浅 ${Math.round((sc.shadow?.op ?? 0.35) * 100)}%<input type="range" id="shOp" min="0" max="80" value="${Math.round((sc.shadow?.op ?? 0.35) * 100)}"></label></div></div>
      <div class="sec"><h3>检查（${esc(ST.lang(ed.lang).name)} · ${esc(curPf().name)}）</h3>${issuesHtml()}</div>
      <div class="sec muted">点中画布上的文字或图片可以拖动、改大小；方向键微调（按住 Shift 一次 10），按住 Alt 拖动不吸附；Delete 隐藏；Ctrl+Z 撤销。</div>`;
    box.innerHTML = html;
    const q = (s) => box.querySelector(s);
    if (q("#bgMode")) q("#bgMode").value = sc.bg.mode;
    if (q("#shDir")) q("#shDir").value = (sc.shadow && sc.shadow.dir) || "b";
  }

  /** 右边“背景”里的融入背景（B 方式）一栏 */
  function harmHtml(sc) {
    const h = (ed.last && ed.last.harm) || {};
    if (!h.can) return "";
    const p = P();
    const st = hgen.get(sc.id) || "";
    const hm = sc.harm || {};
    const busy = /排队|中$|中…/.test(st) && !/失败/.test(st);
    const has = hm.key && !h.stale;
    let line = "";
    if (st) line = `<div class="issue tag ${/失败/.test(st) ? "bad" : "blue"}">${esc(st)}</div>`;
    else if (h.stale) line = '<div class="muted">产品挪过、换过图或背景，原来融入的图不能用了，现在显示原贴图。点“重新融入”。</div>';
    else if (hm.status === "fallback") line = `<div class="muted">上次没融入成功：${esc(hm.note || "")}</div>`;
    else if (has) line = `<div class="muted">${h.used ? "现在显示融入后的图（AI 图）" : "现在显示原贴图"}${ST.harmText(hm) ? "。" + esc(ST.harmText(hm)) : ""}</div>`;
    else line = '<div class="muted">程序已经把产品贴好；融入 = AI 只加阴影、反光、调光线，产品本身不变；做完审核 AI（默认豆包）比一比哪张好，两张都留着可以切换。</div>';
    return `<div class="harm"><div class="row"><b>产品融入背景</b>${has ? `<span class="sp pills"><span class="pill ${hm.on ? "on" : ""}" data-act="harmView" data-v="1">融入后</span><span class="pill ${hm.on ? "" : "on"}" data-act="harmView" data-v="0">原贴图</span></span>` : ""}</div>
      ${line}
      <div class="row"><button class="sm blue" data-act="harmOne" ${busy ? "disabled" : ""}>${hm.key || hm.status ? "重新融入" : "融入背景"}</button>
        <select id="harmSite" title="用哪个 AI 画"><option value="">自动（按 AI 分工轮流）</option><option value="gemini" ${harmSite === "gemini" ? "selected" : ""}>Gemini</option><option value="copilot" ${harmSite === "copilot" ? "selected" : ""}>Copilot</option></select></div>
      <label class="row lb"><input type="checkbox" id="harmAuto" ${p.harmAuto !== false ? "checked" : ""}> 生成背景后自动融入</label></div>`;
  }

  function bindRight() {
    const box = document.getElementById("edRight");
    box.addEventListener("focusin", (e) => { if (/TEXTAREA|INPUT/.test(e.target.tagName)) APP.mark(); });
    box.addEventListener("input", (e) => {
      const sc = cur();
      const el = e.target;
      if (el.id === "txtVal") {
        layerData(ed.sel).set(el.value, ed.lang); APP.save(); drawCanvas(); thumbsLater();
        const tb = box.querySelector("#txtBanned");
        if (tb) tb.innerHTML = ST.findBanned(el.value, ed.lang, curPf().rules || [], APP.customWords()).map((b) => `<div class="issue tag bad">违禁词“${esc(b.word)}”：${esc(b.tip)}</div>`).join("");
      }
      else if (el.dataset.ovs !== undefined) { setOv({ s: +el.value / 100 === 1 ? undefined : +el.value / 100 }, false); el.previousSibling.textContent = `大小 ${el.value}%`; }
      else if (el.dataset.ov === "color") setOv({ color: el.value }, false);
      else if (el.id === "bgPrompt") { sc.bg.prompt = el.value; APP.save(); }
      else if (el.id === "bgColor") { sc.bg.color = el.value; APP.save(); drawCanvas(); }
      else if (el.id === "shOp") { sc.shadow = { ...(sc.shadow || { dir: "b" }), op: +el.value / 100 }; APP.save(); drawCanvas(); }
    });
    box.addEventListener("change", (e) => {
      const sc = cur();
      const el = e.target;
      if (el.id === "txtVal" || el.dataset.ovs !== undefined || el.dataset.ov === "color" || el.id === "bgPrompt" || el.id === "bgColor" || el.id === "shOp") { APP.commit(); thumbsLater(); renderRight(); return; }
      APP.mark();
      if (el.dataset.ov === "locked") setOv({ locked: el.checked || undefined }, false);
      else if (el.id === "iconSel") layerData(ed.sel).set(el.value);
      else if (el.id === "tplSel") { P().screens[ed.si] = APP.changeTpl(sc, el.value); ed.sel = null; }
      else if (el.id === "bgMode") sc.bg.mode = el.value;
      else if (el.id === "bgBlend") sc.bg.blend = el.checked;
      else if (el.id === "harmSite") { harmSite = el.value; try { localStorage.setItem("st:harmSite", harmSite); } catch {} return; }
      else if (el.id === "harmAuto") P().harmAuto = el.checked;
      else if (el.id === "txtFix") { setOv({ fix: el.value || undefined }, false); APP.commit(); renderRight(); return; }
      else if (el.id === "projFix") P().textFix = el.value;
      else if (el.id === "projColorAuto") P().textColorAuto = el.checked;
      else if (el.id === "shDir") sc.shadow = { ...(sc.shadow || { op: 0.35 }), dir: el.value };
      APP.commit();
      refresh();
    });
  }

  function refresh() {
    if (APP.step !== "edit") return;
    drawCanvas();
    renderRight();
    renderLeftStatus();
    thumbsLater();
    renderBar();
  }
  function renderLeftStatus() {
    for (const sc of P().screens) {
      const el = document.querySelector(`[data-thumb="${sc.id}"] .busy`);
      if (!el) continue;
      const st = gen.get(sc.id) || hgen.get(sc.id) || "";
      el.hidden = !st;
      el.textContent = st.slice(0, 20);
      el.className = "busy" + (/失败/.test(st) ? " fail" : "");
    }
  }
  function renderBar() {
    const p = P();
    const bar = document.getElementById("edBar");
    if (!bar) return;
    const needBg = p.screens.filter((s) => s.bg.mode === "ai" && !s.bg.key).length;
    const miss = p.langs.reduce((a, l) => a + Object.keys(ST.missingTexts(p, l)).length, 0);
    bar.innerHTML = `
      <span class="lb">语言</span><span class="pills">${[p.lang, ...p.langs].map((l) => `<span class="pill ${l === ed.lang ? "on" : ""}" data-elang="${l}">${esc(ST.lang(l).name)}</span>`).join("")}</span>
      <span class="lb" style="margin-left:8px">平台</span><span class="pills">${p.platforms.map((id) => { const x = ST.platformOf(p, id); return `<span class="pill ${id === (ed.pf || p.platform) ? "on" : ""}" data-epf="${id}">${esc(x.name)}<small>${x.w}${x.h ? "×" + x.h : ""}</small></span>`; }).join("")}</span>
      <span class="sp row">
        <button class="sm blue" data-act="genAll" ${needBg ? "" : "disabled"}>生成全部背景${needBg ? `（${needBg}）` : ""}</button>
        <button class="sm" data-act="harmAll" title="有背景图、有产品图的屏：AI 只调光影让产品融进背景，产品不变">全部融入背景</button>
        ${p.langs.length ? `<button class="sm" data-act="trAll" ${miss ? "" : "disabled"}>翻译${miss ? `（缺 ${miss} 条）` : "（都翻好了）"}</button>` : ""}
        <button class="sm ${ed.preview ? "primary" : ""}" data-act="preview">整页预览</button>
        <button class="sm" data-act="undo" ${APP.undo.length ? "" : "disabled"} title="Ctrl+Z">撤销</button><button class="sm" data-act="redo" ${APP.redo.length ? "" : "disabled"} title="Ctrl+Y">重做</button>
        <button class="sm" data-act="saveTpl">存成我的模板</button>
        <button class="sm primary" data-go="export">检查和导出 →</button></span>`;
  }

  async function renderPreview() {
    const st = document.getElementById("edStage");
    const p = P();
    const pf = curPf();
    const W = Math.min(pf.w, Math.round(Math.min(st.clientWidth - 40, pf.h ? 900 : 560) * (devicePixelRatio || 1)));
    st.innerHTML = `<div class="preview" style="width:${Math.min(st.clientWidth - 40, pf.h ? 900 : 560)}px"></div>`;
    const box = st.firstChild;
    for (let i = 0; i < p.screens.length; i++) {
      const r = await ST.renderScreen(p, p.screens[i], { platform: pf, lang: ed.lang, brand: brand(), pxWidth: W });
      const img = document.createElement("img");
      img.src = URL.createObjectURL(await ST.toBlob(r.canvas, "image/jpeg", 0.85));
      img.dataset.si = i;
      img.title = `第 ${i + 1} 屏（点一下编辑）`;
      img.style.cursor = "pointer";
      box.appendChild(img);
    }
    box.onclick = (e) => { const i = e.target.dataset && e.target.dataset.si; if (i !== undefined) { ed.si = +i; ed.preview = false; APP.render(); } };
  }

  APP.steps.edit = {
    wide: true,
    async render(main) {
      const p = P();
      if (!ed.lang || ![p.lang, ...p.langs].includes(ed.lang)) ed.lang = p.lang;
      if (!ed.pf || !p.platforms.includes(ed.pf)) ed.pf = p.platform;
      APP.editLang = ed.lang;
      if (ed.si >= p.screens.length) ed.si = Math.max(0, p.screens.length - 1);
      if (!p.screens.length) {
        main.innerHTML = `<div style="padding:40px"><div class="empty">还没有屏幕。先到“⑤ 提纲”让 AI 列提纲，或者按常用顺序排一套。<br><br><button class="primary" data-go="outline">去提纲</button></div></div>`;
        return;
      }
      main.innerHTML = `<div class="ed">
        <div class="left">${p.screens.map((sc, i) => `<div class="sthumb ${i === ed.si ? "on" : ""}" data-thumb="${sc.id}" data-act="selScreen" data-i="${i}"><img alt=""><span class="n">${i + 1}</span><span class="busy" hidden></span></div>`).join("")}
          <select id="edAddTpl" style="width:100%">${ST.TPL_ORDER.map((id) => `<option value="${id}">${ST.TPL[id].name}</option>`).join("")}</select><button class="sm" data-act="addScreenEd">＋ 加一屏</button></div>
        <div class="mid"><div class="bar" id="edBar"></div><div class="stage" id="edStage"><div class="canvasbox" id="edBox"><canvas id="edCanvas"></canvas></div></div></div>
        <div class="right" id="edRight"></div></div>
        <input type="file" id="bgInput" accept="image/*" hidden>`;
      stageEl = document.getElementById("edStage");
      boxEl = document.getElementById("edBox");
      canvasEl = document.getElementById("edCanvas");
      const pf = curPf();
      boxEl.style.width = Math.max(280, Math.min(stageEl.clientWidth - 40, pf.h ? 900 : 560)) + "px";
      renderBar();
      bindCanvas();
      bindRight();
      main.querySelector(".mid").addEventListener("click", (e) => {
        const l = e.target.closest("[data-elang]"), f = e.target.closest("[data-epf]");
        if (l) { ed.lang = l.dataset.elang; APP.editLang = ed.lang; APP.render(); }
        if (f) { ed.pf = f.dataset.epf; APP.render(); }
      });
      main.querySelector("#bgInput").onchange = async (e) => {
        const f = e.target.files[0];
        e.target.value = "";
        if (!f) return;
        const sc = cur();
        const key = `${p.id}:bg-${sc.id}-${Date.now()}`;
        await ST.saveImage(key, f);
        APP.mark(); sc.bg.key = key; sc.bg.mode = "upload"; APP.commit();
        refresh();
      };
      if (ed.preview) await renderPreview();
      else { await drawCanvas(); renderRight(); }
      renderLeftStatus();
      drawThumbs();
    },
    act: {
      selScreen: (el) => { ed.si = +el.dataset.i; ed.sel = null; ed.preview = false; APP.render(); },
      selLayer: (el) => { ed.sel = el.dataset.id; drawSel(); renderRight(); },
      addScreenEd: () => { const p = P(); APP.mark(); p.screens.splice(ed.si + 1, 0, ST.assignAssets(p, [ST.newScreen(document.getElementById("edAddTpl").value)])[0]); ed.si++; APP.commit(); APP.render(); },
      dupScreen: () => { const p = P(); APP.mark(); const c = ST.clone(cur()); c.id = ST.uid("s"); c.items.forEach((it) => (it.id = ST.uid("i"))); p.screens.splice(ed.si + 1, 0, c); ed.si++; APP.commit(); APP.render(); },
      delScreenEd: async () => { if (!(await APP.confirm("删除这一屏？（可以撤销）", "删除", true))) return; const p = P(); APP.mark(); p.screens.splice(ed.si, 1); ed.si = Math.max(0, ed.si - 1); ed.sel = null; APP.commit(); APP.render(); },
      moveScreen: (el) => { const p = P(); const to = ed.si + +el.dataset.d; APP.mark(); const [m] = p.screens.splice(ed.si, 1); p.screens.splice(to, 0, m); ed.si = to; APP.commit(); APP.render(); },
      itemCount: (el) => {
        const sc = cur();
        APP.mark();
        if (+el.dataset.d > 0) { sc.items.push({ id: ST.uid("i"), title: {}, desc: {}, asset: "", icon: "" }); ST.assignAssets(P(), [sc]); } else sc.items.pop();
        APP.commit(); ed.sel = null; refresh();
      },
      hideLayer: () => { setOv({ hidden: true }); ed.sel = null; renderRight(); },
      resetLayer: () => { const sc = cur(); APP.mark(); delete sc.ov[ed.sel]; APP.commit(); drawCanvas(); renderRight(); thumbsLater(); },
      resetColor: () => { setOv({ color: undefined }); renderRight(); },
      unhide: (el) => { const sc = cur(); APP.mark(); delete sc.ov[el.dataset.id].hidden; if (!Object.keys(sc.ov[el.dataset.id]).length) delete sc.ov[el.dataset.id]; APP.commit(); refresh(); },
      pickLayerImg: async () => {
        const d = layerData(ed.sel);
        const id = await APP.pickAsset(d.asset(), d.tags || []);
        if (id === null) return;
        APP.mark(); d.setAsset(id); APP.commit(); refresh();
      },
      genOne: () => APP.genBg(cur()),
      genAll: () => APP.genAllBg(),
      harmAll: () => APP.harmAll(),
      harmOne: () => APP.harmScreen(cur()),
      harmView: async (el) => { const sc = cur(); if (!sc.harm) return; sc.harm.on = el.dataset.v === "1"; await APP.save(true); refresh(); },
      asStyle: async () => { const p = P(); const b = await ST.db.getBlob(cur().bg.key); p.style.styleRef = `${p.id}:styleref`; await ST.saveImage(p.style.styleRef, b); APP.save(); APP.toast("已设为风格参考：之后生成的背景都参考它的配色和光线"); },
      uploadBg: () => document.getElementById("bgInput").click(),
      bgColorReset: () => { const sc = cur(); APP.mark(); delete sc.bg.color; APP.commit(); refresh(); },
      trAll: async () => { APP.toast("开始翻译，进度看右上角“AI 任务”"); const n = await APP.translateAll(); if (n) APP.toast(`翻译了 ${n} 条`); refresh(); },
      preview: () => { ed.preview = !ed.preview; APP.render(); },
      undo: () => APP.doUndo(),
      redo: () => APP.doRedo(),
      saveTpl: () => APP.saveMyTpl(),
      rewrite: async (el) => {
        const p = P();
        const sc = cur();
        el.disabled = true;
        try {
          const r = await APP.aiJson(ST.P.rewriteScreen(p, sc), [], `重写第 ${ed.si + 1} 屏文案`);
          APP.mark();
          for (const x of ST.TPL[sc.tpl].texts || []) if (typeof r[x.key] === "string") sc.text[x.key] = { [p.lang]: r[x.key] };
          (r.items || []).forEach((it, i) => { if (!sc.items[i]) return; for (const f of ["title", "desc"]) if (typeof it[f] === "string") sc.items[i][f] = { [p.lang]: it[f] }; });
          APP.commit();
          APP.toast("已重写（其他语言的译文要重新翻译）");
        } catch (e) { if (!(e.result && e.result.cancelled)) APP.toast("重写没成功：" + e.message, true); }
        refresh();
      },
    },
  };
  APP.onAiChange = () => { if (APP.step === "edit") { renderLeftStatus(); } };
  window.addEventListener("resize", () => { if (APP.step === "edit" && !ed.preview) { APP.render(); } });
})();
