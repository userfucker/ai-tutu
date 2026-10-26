/**
 * 抠白底图 / 主图 / 详情页左上角的“← 工作台”：鼠标移上去弹出工作台左边的菜单，点一下直接切过去（Lee 2026-10-26）
 */
(() => {
  const ITEMS = [["cutout", "抠白底图"], ["main", "主图制作"], ["detail", "详情页"], ["library", "素材中心"], ["analysis", "竞品分析"], ["tasks", "任务中心"], ["connect", "AI 连接"], ["settings", "设置"]];
  const a = document.querySelector("a.backwb");
  if (!a) return;
  const here = location.pathname.split("/")[1];
  const st = document.createElement("style");
  st.textContent = `
.navmenu { position: relative; display: inline-block; }
.navmenu .nmdrop { display: none; position: absolute; left: 0; top: 100%; padding-top: 6px; z-index: 800; }
.navmenu:hover .nmdrop, .navmenu.open .nmdrop { display: block; }
.navmenu .nmbox { background: #fff; border: 1px solid #e4e4e7; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.12); padding: 6px; min-width: 150px; }
.navmenu .nmbox a { display: block; padding: 8px 12px; border-radius: 7px; color: #1f2329; text-decoration: none; font-size: 14px; white-space: nowrap; }
.navmenu .nmbox a:hover { background: #f2f3f5; }
.navmenu .nmbox a.on { background: #1f2329; color: #fff; }`;
  document.head.appendChild(st);
  const wrap = document.createElement("span");
  wrap.className = "navmenu";
  a.parentNode.insertBefore(wrap, a);
  wrap.appendChild(a);
  a.removeAttribute("title");
  const drop = document.createElement("div");
  drop.className = "nmdrop";
  drop.innerHTML = `<div class="nmbox">${ITEMS.map(([k, n]) => `<a href="/#/${k}" data-nm="${k}" class="${k === here ? "on" : ""}">${n}</a>`).join("")}</div>`;
  wrap.appendChild(drop);
  // 手机 / 触屏：点一下先展开
  a.addEventListener("touchstart", (e) => { if (!wrap.classList.contains("open")) { e.preventDefault(); wrap.classList.add("open"); } }, { passive: false });
  document.addEventListener("touchstart", (e) => { if (!wrap.contains(e.target)) wrap.classList.remove("open"); });
})();
