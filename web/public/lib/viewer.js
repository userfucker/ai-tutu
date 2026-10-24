/**
 * 看大图（所有页面共用，Lee 2026-10-24）：
 *  - 打开时适应窗口；滚轮放大缩小（以鼠标位置为中心）；鼠标是抓手，按住拖动看别的位置；双击在“适应窗口”和“1:1”之间切换
 *  - ← → 切换（多张时）；Esc 关闭
 *  - PNG（透明底）有“深色底”按钮：一键把背景换成深色，看抠图有没有白边；再点一下换回浅色格子（记在浏览器里）
 * VIEWER.open(list, index)：list = [{ src, name, info, png（是不是 PNG，不填就按网址 / 名字猜）, download（下载网址，可选） }]
 */
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let dark = (() => { try { return localStorage.getItem("st:viewerDark") === "1"; } catch { return false; } })();
  let st = null;

  function style() {
    if (document.getElementById("vwStyle")) return;
    const s = document.createElement("style");
    s.id = "vwStyle";
    s.textContent = `
#vwLayer { position: fixed; inset: 0; z-index: 1000; background: rgba(12,14,18,.9); overflow: hidden; user-select: none; }
#vwLayer .vwimg { position: absolute; left: 0; top: 0; transform-origin: 0 0; max-width: none; cursor: grab; box-shadow: 0 6px 30px rgba(0,0,0,.4); }
#vwLayer.drag .vwimg { cursor: grabbing; }
#vwLayer .vwimg.light { background-color: #fff; background-image: linear-gradient(45deg, #e5e6ea 25%, transparent 25%), linear-gradient(-45deg, #e5e6ea 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e6ea 75%), linear-gradient(-45deg, transparent 75%, #e5e6ea 75%); background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0; }
#vwLayer .vwimg.dark { background-color: #2b2e35; background-image: linear-gradient(45deg, #23262c 25%, transparent 25%), linear-gradient(-45deg, #23262c 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #23262c 75%), linear-gradient(-45deg, transparent 75%, #23262c 75%); background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0; }
#vwLayer .vwbar { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); display: flex; gap: 6px; align-items: center; background: rgba(24,24,27,.92); border-radius: 999px; padding: 6px 10px; color: #ddd; font: 13px/1.4 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; white-space: nowrap; }
#vwLayer .vwbar button, #vwLayer .vwbar a { background: rgba(255,255,255,.14); color: #fff; border: 0; border-radius: 999px; padding: 4px 11px; cursor: pointer; font: inherit; text-decoration: none; }
#vwLayer .vwbar button:hover, #vwLayer .vwbar a:hover { background: rgba(255,255,255,.26); }
#vwLayer .vwbar button.on { background: #3b82f6; }
#vwLayer .vwtop { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); max-width: 80vw; color: #e5e7eb; font: 13px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; background: rgba(24,24,27,.7); border-radius: 999px; padding: 3px 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#vwLayer .vwnav { position: absolute; top: 50%; transform: translateY(-50%); width: 46px; height: 66px; border: 0; border-radius: 10px; background: rgba(24,24,27,.6); color: #fff; font-size: 34px; line-height: 1; cursor: pointer; }
#vwLayer .vwnav:hover { background: rgba(24,24,27,.9); }
#vwLayer .vwnav.prev { left: 14px; } #vwLayer .vwnav.next { right: 14px; }
#vwLayer .vwclose { position: absolute; right: 14px; top: 10px; width: 34px; height: 34px; border: 0; border-radius: 50%; background: rgba(24,24,27,.7); color: #fff; font-size: 18px; cursor: pointer; }`;
    document.head.appendChild(s);
  }
  const isPng = (it) => (it.png !== undefined ? !!it.png : /\.png($|\?)|image\/png/i.test(`${it.name || ""} ${it.src || ""} ${it.mime || ""}`));

  function apply() {
    const { img, z, x, y } = st;
    img.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    const zv = st.L.querySelector("[data-vw=zoom]");
    if (zv) zv.textContent = Math.round(z * 100) + "%";
  }
  function fit() {
    const { img, L } = st;
    const W = L.clientWidth, H = L.clientHeight - 70;
    const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
    st.z = Math.min(1, (W - 40) / iw, (H - 40) / ih);
    st.x = (W - iw * st.z) / 2;
    st.y = (H - ih * st.z) / 2 + 10;
    apply();
  }
  function zoomAt(f, cx, cy) {
    const z2 = Math.min(16, Math.max(0.05, st.z * f));
    st.x = cx - ((cx - st.x) * z2) / st.z;
    st.y = cy - ((cy - st.y) * z2) / st.z;
    st.z = z2;
    apply();
  }
  function show() {
    const it = st.list[st.i];
    const png = isPng(it);
    st.img.className = `vwimg ${png && dark ? "dark" : "light"}`;
    st.img.onload = fit;
    st.img.src = it.src;
    st.L.querySelector(".vwtop").textContent = [it.name, it.info, st.list.length > 1 ? `${st.i + 1} / ${st.list.length}（← → 切换）` : ""].filter(Boolean).join(" · ");
    st.L.querySelectorAll(".vwnav").forEach((b) => (b.hidden = st.list.length < 2));
    const db = st.L.querySelector("[data-vw=dark]");
    db.hidden = !png;
    db.classList.toggle("on", dark);
    db.textContent = dark ? "深色底 ✓" : "深色底";
    const dl = st.L.querySelector("[data-vw=dl]");
    dl.href = it.download || it.src;
    dl.setAttribute("download", it.name || "");
  }
  function close() {
    if (!st) return;
    document.removeEventListener("keydown", st.key, true);
    st.L.remove();
    st = null;
  }

  function open(list, index = 0) {
    list = (list || []).filter((x) => x && x.src);
    if (!list.length) return;
    style();
    close();
    const L = document.createElement("div");
    L.id = "vwLayer";
    L.innerHTML = `<img class="vwimg" draggable="false" alt=""><div class="vwtop"></div>
      <button class="vwnav prev" data-vw="prev" title="上一张（←）">‹</button><button class="vwnav next" data-vw="next" title="下一张（→）">›</button>
      <button class="vwclose" data-vw="close" title="关闭（Esc）">✕</button>
      <div class="vwbar"><button data-vw="out" title="缩小">－</button><span data-vw="zoom">100%</span><button data-vw="in" title="放大">＋</button><button data-vw="one">1:1</button><button data-vw="fit">适应窗口</button>
        <button data-vw="dark" title="PNG 透明底：换成深色底看有没有白边（再点一下换回来）">深色底</button><a data-vw="dl" title="下载">下载</a><button data-vw="close">关闭</button></div>`;
    document.body.appendChild(L);
    st = { L, img: L.querySelector(".vwimg"), list, i: Math.min(Math.max(0, index), list.length - 1), z: 1, x: 0, y: 0 };
    st.key = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === "ArrowLeft" && st.list.length > 1) { e.preventDefault(); e.stopPropagation(); st.i = (st.i - 1 + st.list.length) % st.list.length; show(); }
      else if (e.key === "ArrowRight" && st.list.length > 1) { e.preventDefault(); e.stopPropagation(); st.i = (st.i + 1) % st.list.length; show(); }
    };
    document.addEventListener("keydown", st.key, true);
    L.addEventListener("wheel", (e) => { e.preventDefault(); const r = L.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    let drag = null;
    st.img.addEventListener("pointerdown", (e) => { e.preventDefault(); drag = { sx: e.clientX, sy: e.clientY, x: st.x, y: st.y, moved: false }; L.classList.add("drag"); st.img.setPointerCapture(e.pointerId); });
    st.img.addEventListener("pointermove", (e) => { if (!drag) return; st.x = drag.x + e.clientX - drag.sx; st.y = drag.y + e.clientY - drag.sy; if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) drag.moved = true; apply(); });
    st.img.addEventListener("pointerup", () => { drag = null; L.classList.remove("drag"); });
    st.img.addEventListener("dblclick", (e) => { const r = L.getBoundingClientRect(); if (st.z < 0.999) zoomAt(1 / st.z, e.clientX - r.left, e.clientY - r.top); else fit(); });
    L.addEventListener("mousedown", (e) => { if (e.target === L) close(); });
    L.addEventListener("click", (e) => {
      const b = e.target.closest("[data-vw]");
      if (!b) return;
      const a = b.dataset.vw, cx = L.clientWidth / 2, cy = (L.clientHeight - 70) / 2;
      if (a === "close") close();
      else if (a === "prev") { st.i = (st.i - 1 + st.list.length) % st.list.length; show(); }
      else if (a === "next") { st.i = (st.i + 1) % st.list.length; show(); }
      else if (a === "in") zoomAt(1.25, cx, cy);
      else if (a === "out") zoomAt(1 / 1.25, cx, cy);
      else if (a === "one") zoomAt(1 / st.z, cx, cy);
      else if (a === "fit") fit();
      else if (a === "dark") { // 只换背景，不动缩放和位置
        dark = !dark;
        try { localStorage.setItem("st:viewerDark", dark ? "1" : "0"); } catch {}
        st.img.className = `vwimg ${dark ? "dark" : "light"}`;
        b.classList.toggle("on", dark);
        b.textContent = dark ? "深色底 ✓" : "深色底";
      }
    });
    show();
  }
  window.VIEWER = { open, close };
})();
