/**
 * 文字类主图的框模板（Lee 2026-10-27）：照参考图的文字布局画成线框——白底、方框、细线。
 * 框的位置大小按画面的百分比（0～100），类型：text 文字框 / icon 图标框 / block 色块横条 / line 分隔线。
 * 内置 A～I 来自 Lee 给的 9 张参考图（原图 /main/tpl/ref/<id>.jpg，鼠标移到模板上显示）；
 * 用户从新参考图生成的叫 J、K…Z、A1、B1…，在某个模板上微调后另存的叫 A-1、A-2…（存在服务器 meta "posterBoxTpls"）。
 */
(() => {
  const T = (role, x, y, w, h, o = {}) => ({ type: "text", role, x, y, w, h, color: "#111111", bg: "", bold: true, lines: 1, align: "center", ...o });
  const I = (role, x, y, w, h, o = {}) => ({ type: "icon", role, x, y, w, h, desc: "", ...o });
  const K = (role, x, y, w, h, o = {}) => ({ type: "block", role, x, y, w, h, bg: "#1d4ed8", radius: 0, border: "", ...o });
  const L = (role, x, y, w, h, o = {}) => ({ type: "line", role, x, y, w, h, color: "#e01e2b", ...o });
  const tpl = (id, name, use, style, bg1, bg2, boxes) => ({ id, name, use, style, bg1, bg2, builtin: true, ref: `/main/tpl/ref/${id}.jpg`, boxes: boxes.map((b, i) => ({ id: "b" + (i + 1), ...b })) });

  ST.BOX_TPLS = [
    tpl("A", "红白 · 左标签右卖点", "版本 / 平台多的服务", "Flat red-and-white Chinese promotion poster: red top band and red frame, big red headline, red rounded pills with white text on the left, red '*' bullet points on the right, a product logo top-right, a red bottom band with a dark-red rounded button.", "#ffffff", "#ffffff", [
      K("顶部红条", 0, 0, 100, 11, { bg: "#e01e2b" }),
      T("店铺名", 4, 1.5, 30, 8, { color: "#ffffff" }),
      T("大标题", 3, 19, 37, 13, { color: "#e01e2b" }),
      I("产品 logo", 47, 6, 46, 30, { desc: "产品 / 软件 logo" }),
      T("标签 1", 4, 35, 30, 5.5, { color: "#ffffff", bg: "#e01e2b", radius: 99 }),
      T("标签 2", 4, 43.5, 30, 5.5, { color: "#ffffff", bg: "#e01e2b", radius: 99 }),
      T("标签 3", 4, 52, 30, 5.5, { color: "#ffffff", bg: "#e01e2b", radius: 99 }),
      T("标签 4", 4, 60.5, 30, 5.5, { color: "#ffffff", bg: "#e01e2b", radius: 99 }),
      T("标签 5", 4, 69, 30, 5.5, { color: "#ffffff", bg: "#e01e2b", radius: 99 }),
      T("卖点 1", 47, 41, 50, 6.5, { color: "#e01e2b", align: "left" }),
      T("卖点 2", 47, 50, 50, 6.5, { color: "#e01e2b", align: "left" }),
      T("卖点 3", 47, 59, 50, 6.5, { color: "#e01e2b", align: "left" }),
      T("卖点 4", 47, 68, 50, 6.5, { color: "#e01e2b", align: "left" }),
      K("底部红条", 0, 84, 100, 16, { bg: "#e01e2b" }),
      T("底部左字", 2, 87, 22, 9, { color: "#ffffff" }),
      T("底部按钮", 26, 87, 60, 10, { color: "#ffffff", bg: "#9b0f1c", radius: 99 }),
      I("购物车图标", 88, 87, 10, 10, { desc: "圆形里一个购物车图标" }),
    ]),
    tpl("B", "浅灰 · 居中双行巨字", "第 1 张主图，标题最醒目", "Minimal light warm-grey gradient poster: a small tag in a dashed rounded outline, two lines of giant extra-bold headline (key words in brand blue with white outline and soft shadow, the rest dark grey), a sub-title line, three white rounded pills, a solid dark-blue bottom band with a mascot icon and a white slogan.", "#f6f6f4", "#e6e6e2", [
      T("顶部虚线标签", 20, 8, 60, 7, { color: "#333333", border: "#555555", dash: true, radius: 99 }),
      T("大标题第 1 行", 6, 23, 88, 15, { color: "#2b5bff" }),
      T("大标题第 2 行", 6, 40, 88, 15, { color: "#333333" }),
      T("副标题", 16, 60, 68, 7, { color: "#444444" }),
      T("胶囊 1", 11, 74, 24, 7, { color: "#333333", bg: "#ffffff", radius: 99 }),
      T("胶囊 2", 38, 74, 24, 7, { color: "#333333", bg: "#ffffff", radius: 99 }),
      T("胶囊 3", 65, 74, 24, 7, { color: "#333333", bg: "#ffffff", radius: 99 }),
      K("底部深蓝条", 0, 85, 100, 15, { bg: "#1d3fa8" }),
      I("吉祥物图标", 2, 86.5, 13, 12, { desc: "可爱的白色小云朵吉祥物" }),
      T("底部口号", 16, 87, 82, 10, { color: "#ffffff" }),
    ]),
    tpl("C", "描边大字 · 卖点卡片", "4 条左右卖点，突出专业", "Bold sticker-style poster on white: huge navy headline with a thick orange outline, a product logo, a dark rounded card holding 4 selling points each starting with a small orange link icon, an orange bottom band with black extra-bold slogan.", "#ffffff", "#ffffff", [
      T("描边大标题", 2, 3, 66, 15, { color: "#0d4f73", stroke: "#f2a20c" }),
      I("右上图标", 64, 0, 34, 28, { desc: "产品 / 软件 logo 图形" }),
      T("产品名", 18, 24, 74, 14, { color: "#0d6c9a" }),
      T("第二行描边字", 6, 41, 72, 11, { color: "#0d4f73", stroke: "#f2a20c" }),
      K("深蓝卡片", 4, 55, 92, 30, { bg: "#0d5c84", radius: 4 }),
      T("卖点 1", 9, 57, 84, 6, { color: "#ffffff", align: "left" }),
      T("卖点 2", 9, 64, 84, 6, { color: "#ffffff", align: "left" }),
      T("卖点 3", 9, 71, 84, 6, { color: "#ffffff", align: "left" }),
      T("卖点 4", 9, 78, 84, 6, { color: "#ffffff", align: "left" }),
      K("底部橙条", 0, 88, 100, 12, { bg: "#f2a20c" }),
      T("底部口号", 2, 89, 96, 10, { color: "#111111" }),
    ]),
    tpl("D", "橙色冲击 · 色块网格", "服务项目多（6 个以内）", "High-impact orange poster: thick orange frame on pale peach, giant black headline, an orange slab with huge white keyword, a black narrow banner, a 2x3 grid of orange pills, a bottom-left orange badge with a curved corner, orange-red promise text on the right.", "#ffe7df", "#ffffff", [
      L("橙色边框", 0, 0, 100, 100, { color: "#ff5a1f", frame: true }),
      T("超大黑字", 8, 3, 84, 14, { color: "#111111" }),
      K("橙色色块", 3, 18, 94, 16, { bg: "#ff5a1f", radius: 2 }),
      T("色块关键词", 6, 19, 88, 14, { color: "#ffffff" }),
      K("黑色横幅", 6, 36, 88, 8, { bg: "#111111" }),
      T("黑横幅字", 8, 36.5, 84, 7, { color: "#ffffff" }),
      T("胶囊 1", 3, 48, 29, 6.5, { color: "#ffffff", bg: "#ff5a1f", radius: 99 }),
      T("胶囊 2", 35.5, 48, 29, 6.5, { color: "#ffffff", bg: "#ff5a1f", radius: 99 }),
      T("胶囊 3", 68, 48, 29, 6.5, { color: "#ffffff", bg: "#ff5a1f", radius: 99 }),
      T("胶囊 4", 3, 57, 29, 6.5, { color: "#ffffff", bg: "#ff5a1f", radius: 99 }),
      T("胶囊 5", 35.5, 57, 29, 6.5, { color: "#ffffff", bg: "#ff5a1f", radius: 99 }),
      T("胶囊 6", 68, 57, 29, 6.5, { color: "#ffffff", bg: "#ff5a1f", radius: 99 }),
      T("左下角标", 0, 78, 30, 22, { color: "#ffffff", bg: "#ff5a1f", radius: 6, lines: 2 }),
      T("右下小字", 36, 80, 60, 6, { color: "#e8471a" }),
      T("右下承诺", 33, 87, 65, 10, { color: "#e8471a", bg: "#ffffff" }),
    ]),
    tpl("E", "浅蓝 3D · 左列表右主体", "显得专业、高级", "Premium light-blue tech poster with soft light rays: product logo on top, a big navy headline, a deep-blue pill of 4 short phrases separated by '|', a left list of 5 rows (round blue icon + bold title + small grey description, dashed separators), a glossy 3D hero object on the right on a glowing base, a deep-blue bottom bar with 3 icon items and a pale-yellow slogan strip.", "#eef4ff", "#d9e7ff", [
      I("顶部 logo", 10, 1, 50, 14, { desc: "产品 / 软件 logo" }),
      T("大标题", 10, 16, 84, 10, { color: "#0b1f5c" }),
      T("蓝色胶囊", 11, 27, 69, 5.5, { color: "#ffffff", bg: "#1d4fd8", radius: 99 }),
      I("列表图标 1", 11, 34.5, 7, 7, { desc: "蓝色圆形闪电图标" }), T("列表 1 标题", 20, 34, 24, 4.5, { color: "#0b1f5c", align: "left" }), T("列表 1 说明", 20, 38.5, 24, 3.5, { color: "#556677", bold: false, align: "left" }),
      I("列表图标 2", 11, 43, 7, 7, { desc: "蓝色圆形盾牌图标" }), T("列表 2 标题", 20, 42.5, 24, 4.5, { color: "#0b1f5c", align: "left" }), T("列表 2 说明", 20, 47, 24, 3.5, { color: "#556677", bold: false, align: "left" }),
      I("列表图标 3", 11, 51.5, 7, 7, { desc: "蓝色圆形电脑图标" }), T("列表 3 标题", 20, 51, 24, 4.5, { color: "#0b1f5c", align: "left" }), T("列表 3 说明", 20, 55.5, 24, 3.5, { color: "#556677", bold: false, align: "left" }),
      I("列表图标 4", 11, 60, 7, 7, { desc: "蓝色圆形耳机图标" }), T("列表 4 标题", 20, 59.5, 24, 4.5, { color: "#0b1f5c", align: "left" }), T("列表 4 说明", 20, 64, 24, 3.5, { color: "#556677", bold: false, align: "left" }),
      I("列表图标 5", 11, 68.5, 7, 7, { desc: "蓝色圆形对勾图标" }), T("列表 5 标题", 20, 68, 24, 4.5, { color: "#0b1f5c", align: "left" }), T("列表 5 说明", 20, 72.5, 24, 3.5, { color: "#556677", bold: false, align: "left" }),
      I("右侧 3D 主体", 44, 36, 53, 45, { desc: "光滑的 3D 数据库圆柱 + 盾牌，放在发光底座上" }),
      K("底部蓝条", 3, 81, 94, 10.5, { bg: "#1d4fd8", radius: 3 }),
      I("底部图标 1", 9, 83, 6, 6, { desc: "白色 Windows 图标" }), T("底部条 1", 16, 83, 18, 6, { color: "#ffffff", lines: 2, align: "left" }),
      I("底部图标 2", 38, 83, 6, 6, { desc: "Linux 企鹅图标" }), T("底部条 2", 45, 83, 18, 6, { color: "#ffffff", lines: 2, align: "left" }),
      I("底部图标 3", 66, 83, 6, 6, { desc: "白色耳机图标" }), T("底部条 3", 73, 83, 22, 6, { color: "#ffffff", lines: 2, align: "left" }),
      K("底部浅黄条", 3, 91.5, 94, 8.5, { bg: "#fde9a8" }),
      T("底部口号", 15, 92.5, 70, 6.5, { color: "#0b1f5c" }),
    ]),
    tpl("F", "深蓝科技 · 软件图标网格", "能做的项目很多", "Dark tech poster: deep navy-to-blue radial gradient with glow, translucent blue pills, a glowing white giant headline, a laptop + customer-service headset illustration, a 4x2 grid of white rounded tiles each with a colorful software icon, a bold name and a small description, a bottom outlined bar with 4 guarantees (round icon + two lines).", "#2747c9", "#08134a", [
      T("顶部胶囊", 3, 4, 50, 6, { color: "#ffffff", bg: "#3355dd", radius: 99 }),
      T("发光大标题", 3, 12, 63, 13, { color: "#ffffff", glow: true }),
      I("右上插画", 66, 2, 33, 32, { desc: "笔记本电脑 + 客服耳机 + 对话气泡" }),
      T("第二行胶囊", 3, 27, 58, 6, { color: "#ffffff", bg: "#3355dd", radius: 99 }),
      T("右侧小卡片", 70, 25, 23, 9, { color: "#ffffff", bg: "#3f5ff0", radius: 4, lines: 2 }),
      ...[0, 1].flatMap((r) => [0, 1, 2, 3].flatMap((c) => {
        const x = 4 + c * 24, y = 36 + r * 25, n = r * 4 + c + 1;
        return [K(`格子 ${n} 底`, x, y, 20.5, 22, { bg: "#ffffff", radius: 3 }), I(`格子 ${n} 图标`, x + 4, y + 2, 12.5, 11, { desc: "软件图标" }), T(`格子 ${n} 名称`, x + 1, y + 13.5, 18.5, 4, { color: "#111111" }), T(`格子 ${n} 说明`, x + 1, y + 17.5, 18.5, 3.5, { color: "#444444", bold: false })];
      })),
      K("底部描边条", 3, 86, 94, 11, { bg: "", border: "#7aa0ff", radius: 3 }),
      ...[0, 1, 2, 3].flatMap((c) => [I(`保障图标 ${c + 1}`, 6 + c * 23.5, 87.5, 6, 8, { desc: "蓝色圆形图标" }), T(`保障 ${c + 1}`, 13 + c * 23.5, 87.5, 15, 8, { color: "#ffffff", lines: 2, align: "left" })]),
    ]),
    tpl("G", "黑底大字报 · 红黄", "维修、装机，最抓眼", "Chinese street-promotion big-character poster on near-black with faint texture: a row of red tags with yellow text, a yellow title top-right, a GIANT white headline with thick red drop shadow, a yellow sub-title, a 2x2 grid of red boxes with yellow text, two big white phrases at the bottom.", "#1a120c", "#050505", [
      T("小标签 1", 3, 2, 14, 7, { color: "#ffe14d", bg: "#e01e2b", radius: 99 }),
      T("小标签 2", 18.5, 2, 14, 7, { color: "#ffe14d", bg: "#e01e2b", radius: 99 }),
      T("小标签 3", 34, 2, 14, 7, { color: "#ffe14d", bg: "#e01e2b", radius: 99 }),
      T("小标签 4", 49.5, 2, 20, 7, { color: "#ffe14d", bg: "#e01e2b", radius: 99 }),
      T("右上称号", 72, 2.5, 26, 6, { color: "#ffe14d" }),
      T("超大白字", 2, 12, 96, 24, { color: "#ffffff", shadow: "#e01e2b" }),
      T("黄色副标题", 6, 37, 88, 9, { color: "#ffe14d" }),
      T("红块 1", 3, 49, 46, 12.5, { color: "#ffe14d", bg: "#e01e2b", radius: 2 }),
      T("红块 2", 51, 49, 46, 12.5, { color: "#ffe14d", bg: "#e01e2b", radius: 2 }),
      T("红块 3", 3, 64, 46, 12.5, { color: "#ffe14d", bg: "#e01e2b", radius: 2 }),
      T("红块 4", 51, 64, 46, 12.5, { color: "#ffe14d", bg: "#e01e2b", radius: 2 }),
      T("底部左句", 3, 80, 45, 13, { color: "#ffffff" }),
      T("底部右句", 52, 80, 45, 13, { color: "#ffffff" }),
    ]),
    tpl("H", "暗色大标题 · 黄框清单", "装机、重装这类", "Dark textured poster with a warm light glow: a red corner block with the shop name, a yellow '24h' title top-right, a giant light headline with red shadow, a yellow banner, a yellow-outlined frame containing 2 rows x 3 white bold items, a red bottom band with two white lines on the left and two yellow lines on the right.", "#2a1a10", "#0a0605", [
      T("左上红块", 0, 2, 40, 11, { color: "#ffffff", bg: "#e01e2b" }),
      T("右上黄字", 58, 3, 40, 8, { color: "#ffd400" }),
      T("超大标题", 5, 15, 90, 20, { color: "#f5ece4", shadow: "#c8102e" }),
      L("黄色边框", 6, 47, 88, 27, { color: "#ffd400", frame: true }),
      T("黄色横幅", 23, 42, 54, 10, { color: "#111111", bg: "#ffd400" }),
      T("清单 1", 8, 54, 28, 7, { color: "#ffffff" }), T("清单 2", 36, 54, 28, 7, { color: "#ffffff" }), T("清单 3", 64, 54, 28, 7, { color: "#ffffff" }),
      T("清单 4", 8, 64, 28, 7, { color: "#ffffff" }), T("清单 5", 36, 64, 28, 7, { color: "#ffffff" }), T("清单 6", 64, 64, 28, 7, { color: "#ffffff" }),
      K("底部红条", 0, 79, 100, 21, { bg: "#d7191f" }),
      T("底部左 1", 2, 81, 68, 8, { color: "#ffffff", align: "left" }),
      T("底部左 2", 2, 90, 68, 8, { color: "#ffffff", align: "left" }),
      T("底部右 1", 72, 81, 26, 8, { color: "#ffe14d" }),
      T("底部右 2", 72, 90, 26, 8, { color: "#ffe14d" }),
    ]),
    tpl("I", "红白 · 大字居中", "单一服务、强调退款承诺", "Clean red-and-white poster: a red top tab with the shop name, a white panel with red frame, one line of black service keywords, a widely spaced small line, a HUGE red keyword, a thin red rule, a red promise line, a red bottom band with an upward arc and a white letter-spaced slogan.", "#ffffff", "#ffffff", [
      L("红色边框", 0, 0, 100, 100, { color: "#e01e2b", frame: true }),
      T("顶部店名", 25, 0, 50, 8, { color: "#ffffff", bg: "#e01e2b" }),
      T("服务清单", 4, 10, 92, 11, { color: "#111111" }),
      T("小字说明", 28, 23, 44, 5.5, { color: "#333333", bold: false }),
      T("超大关键词", 4, 30, 92, 22, { color: "#e01e2b" }),
      L("红色细线", 4, 56, 92, 1, { color: "#e01e2b" }),
      T("承诺", 15, 61, 70, 9, { color: "#e01e2b" }),
      K("底部红条", 0, 84, 100, 16, { bg: "#e01e2b", arc: true }),
      T("底部口号", 8, 87, 84, 11, { color: "#ffffff" }),
    ]),
  ];
  ST.boxTpl = (id, mine) => ST.BOX_TPLS.find((t) => t.id === id) || (mine || []).find((t) => t.id === id) || null;
  /** 一个文字框按大小大概能放几个字（写方案时告诉 AI） */
  ST.boxMax = (b) => {
    const W = b.w * 8, H = b.h * 8, lines = Math.max(1, +b.lines || 1);
    const fs = Math.min((H / lines) * 0.66, 140);
    return Math.max(2, Math.floor(W / Math.max(10, fs)) * lines);
  };
  /** 字数（英文、数字、符号按半个字算） */
  ST.boxLen = (t) => Math.ceil([...String(t || "")].reduce((n, c) => n + (/[\x00-\xff]/.test(c) ? 0.55 : 1), 0));
  /** 模板名字：基础模板 A…Z、A1…Z1、A2…；另存的 X-1、X-2… */
  ST.nextBaseName = (taken) => {
    for (let k = 0; ; k++) for (let c = 0; c < 26; c++) { const n = String.fromCharCode(65 + c) + (k ? k : ""); if (!taken.includes(n)) return n; }
  };
  ST.nextDerivedName = (base, taken) => { const root = String(base).split("-")[0]; for (let i = 1; ; i++) if (!taken.includes(`${root}-${i}`)) return `${root}-${i}`; };
})();

/**
 * 画框（浏览器 canvas 用；服务器不用）：
 *  mode "wire"   = 线框缩略图：白底、细灰线、框里写角色名
 *  mode "sketch" = 草图：按配色画底色 / 色块 / 线，把文字按框大小自动缩放写进去，图标框画成虚线占位并写上图标说明
 *  opts.sel = 选中的框 id（编辑器里描蓝边）
 */
(() => {
  const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Noto Sans SC",sans-serif';
  const rr = (g, x, y, w, h, r) => { r = Math.max(0, Math.min(r, w / 2, h / 2)); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  /** 把字按框排成最多 n 行，返回 {lines, fs} */
  const fit = (g, text, W, H, n, bold) => {
    const raw = String(text || "").split("\n").map((s) => s.trim()).filter(Boolean);
    if (!raw.length) return { lines: [], fs: 0 };
    n = Math.max(n, raw.length);
    for (let fs = Math.min(H / n * 0.82, 200); fs >= 6; fs -= Math.max(1, fs * 0.06)) {
      g.font = `${bold ? 800 : 500} ${fs}px ${FONT}`;
      const out = [];
      for (const para of raw) {
        let cur = "";
        for (const ch of para) { if (g.measureText(cur + ch).width > W && cur) { out.push(cur); cur = ch; } else cur += ch; }
        if (cur) out.push(cur);
      }
      if (out.length <= n && out.every((l) => g.measureText(l).width <= W)) return { lines: out, fs };
    }
    return { lines: raw, fs: 6 };
  };
  ST.drawBoxes = (g, boxes, size, opts = {}) => {
    const mode = opts.mode || "sketch", S = size / 100, wire = mode === "wire";
    g.save();
    if (wire) { g.fillStyle = "#ffffff"; g.fillRect(0, 0, size, size); }
    else { const gr = g.createLinearGradient(0, 0, 0, size); gr.addColorStop(0, opts.bg1 || "#ffffff"); gr.addColorStop(1, opts.bg2 || opts.bg1 || "#ffffff"); g.fillStyle = gr; g.fillRect(0, 0, size, size); }
    const lw = Math.max(1, size / 400);
    for (const b of boxes || []) {
      const x = b.x * S, y = b.y * S, w = b.w * S, h = b.h * S, r = (+b.radius || 0) >= 99 ? h / 2 : (+b.radius || 0) * S;
      g.setLineDash([]);
      if (b.type === "line") {
        g.strokeStyle = wire ? "#9ca3af" : b.color || "#333"; g.lineWidth = wire ? lw : Math.max(lw, b.frame ? size * 0.012 : Math.min(h, w) || lw);
        g.beginPath();
        if (b.frame) { const k = g.lineWidth / 2; g.rect(x + k, y + k, w - 2 * k, h - 2 * k); }
        else if (w >= h) { g.moveTo(x, y + h / 2); g.lineTo(x + w, y + h / 2); } else { g.moveTo(x + w / 2, y); g.lineTo(x + w / 2, y + h); }
        g.stroke();
      } else if (b.type === "block") {
        if (wire) { g.setLineDash([4 * lw, 3 * lw]); g.strokeStyle = "#9ca3af"; g.lineWidth = lw; rr(g, x, y, w, h, r); g.stroke(); }
        else {
          g.fillStyle = b.bg || "#1d4ed8";
          if (b.arc) { g.beginPath(); g.moveTo(x, y + h * 0.35); g.quadraticCurveTo(x + w / 2, y - h * 0.3, x + w, y + h * 0.35); g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.closePath(); }
          else rr(g, x, y, w, h, r);
          g.fill();
          if (b.border) { g.strokeStyle = b.border; g.lineWidth = lw * 2; g.stroke(); }
        }
      } else if (b.type === "icon") {
        g.setLineDash([3 * lw, 3 * lw]); g.strokeStyle = wire ? "#6b7280" : "rgba(0,0,0,.45)"; g.lineWidth = lw; rr(g, x, y, w, h, Math.min(w, h) * 0.12); g.stroke();
        if (!wire) { g.fillStyle = "rgba(255,255,255,.35)"; g.fill(); }
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y + h); g.moveTo(x + w, y); g.lineTo(x, y + h); g.strokeStyle = wire ? "#d1d5db" : "rgba(0,0,0,.12)"; g.stroke();
        const t = fit(g, wire ? b.role : (b.desc || b.role), w * 0.86, h * 0.6, 3, false);
        g.fillStyle = wire ? "#374151" : "rgba(0,0,0,.6)"; g.textAlign = "center"; g.textBaseline = "middle";
        t.lines.forEach((l, i) => g.fillText(l, x + w / 2, y + h / 2 + (i - (t.lines.length - 1) / 2) * t.fs * 1.15));
      } else {
        // 文字框
        if (wire) { g.strokeStyle = "#6b7280"; g.lineWidth = lw; rr(g, x, y, w, h, r); g.stroke(); }
        else {
          if (opts.hint) { g.setLineDash([4 * lw, 3 * lw]); g.strokeStyle = "rgba(37,99,235,.45)"; g.lineWidth = lw; g.strokeRect(x, y, w, h); g.setLineDash([]); }
          if (b.bg) { g.fillStyle = b.bg; rr(g, x, y, w, h, r); g.fill(); }
          if (b.border) { g.strokeStyle = b.border; g.lineWidth = lw * 2; if (b.dash) g.setLineDash([6 * lw, 4 * lw]); rr(g, x, y, w, h, r); g.stroke(); g.setLineDash([]); }
        }
        const pad = Math.min(w, h) * (b.bg || b.border ? 0.12 : 0.04);
        const empty = !wire && !String(b.text || "").trim() && opts.hint;
        const text = wire || empty ? b.role : (b.text || "");
        const t = fit(g, text, w - pad * 2, h - pad * 2, wire || empty ? 1 : Math.max(1, +b.lines || 1), wire || empty ? false : b.bold !== false);
        if ((wire || empty) && t.fs > h * 0.5) t.fs = h * 0.5;
        g.font = `${wire || empty ? 500 : b.bold !== false ? 800 : 500} ${t.fs}px ${FONT}`;
        g.textBaseline = "middle";
        const al = wire || empty ? "center" : b.align || "center";
        g.textAlign = al;
        const tx = al === "left" ? x + pad : al === "right" ? x + w - pad : x + w / 2;
        t.lines.forEach((l, i) => {
          const ty = y + h / 2 + (i - (t.lines.length - 1) / 2) * t.fs * 1.12;
          if (wire || empty) { g.fillStyle = empty ? "rgba(100,116,139,.7)" : "#4b5563"; g.fillText(l, tx, ty); return; }
          if (b.glow) { g.shadowColor = b.glow; g.shadowBlur = t.fs * 0.4; }
          else if (b.shadow) { g.shadowColor = "rgba(0,0,0,.35)"; g.shadowBlur = t.fs * 0.15; g.shadowOffsetY = t.fs * 0.06; }
          if (b.stroke) { g.lineJoin = "round"; g.strokeStyle = b.stroke; g.lineWidth = Math.max(2, t.fs * 0.16); g.strokeText(l, tx, ty); }
          g.fillStyle = b.color || "#111"; g.fillText(l, tx, ty);
          g.shadowColor = "transparent"; g.shadowBlur = 0; g.shadowOffsetY = 0;
        });
      }
      if (opts.sel && opts.sel === b.id) { g.setLineDash([]); g.strokeStyle = "#2563eb"; g.lineWidth = Math.max(2, lw * 2); g.strokeRect(x, y, w, h); }
    }
    g.restore();
  };
})();

/** 整理 AI 给的框（从参考图生成模板时用）：类型、数字范围、字段长度，编号 b1、b2… */
ST.cleanBoxes = (list) => {
  const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v || "").trim()) ? String(v).trim() : d);
  const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v * 10) / 10)) : d);
  return (Array.isArray(list) ? list : []).filter((b) => b && ["text", "icon", "block", "line"].includes(b.type)).slice(0, 60).map((b) => {
    const type = b.type;
    const x = num(b.x, 0, 99, 0), y = num(b.y, 0, 99, 0);
    const o = { type, role: String(b.role || (type === "text" ? "文字" : type === "icon" ? "图标" : type === "block" ? "色块" : "线")).slice(0, 16), x, y, w: num(b.w, 0.5, 100 - x, 20), h: num(b.h, 0.3, 100 - y, 8) };
    if (type === "text") Object.assign(o, { color: hex(b.color, "#111111"), bg: hex(b.bg, ""), bold: b.bold !== false, lines: Math.min(4, Math.max(1, Math.round(+b.lines || 1))), align: ["left", "right"].includes(b.align) ? b.align : "center", radius: num(b.radius, 0, 99, 0), border: hex(b.border, "") });
    if (type === "icon") o.desc = String(b.desc || "").slice(0, 60);
    if (type === "block") Object.assign(o, { bg: hex(b.bg, "#1d4ed8"), radius: num(b.radius, 0, 99, 0) });
    if (type === "line") Object.assign(o, { color: hex(b.color, "#333333"), frame: !!b.frame });
    return o;
  }).filter((b) => b.w > 0 && b.h > 0).map((b, i) => ({ id: "b" + (i + 1), ...b }));
};

/** 框里应该出现的字 / 图标（从上到下、从左到右） */
ST.boxTexts = (boxes) => [...(boxes || [])].sort((a, b) => a.y - b.y || a.x - b.x);

if (ST.P) {
  /** AI 写方案（框模板）：每套一个模板，AI 往每个文字框里写字、给每个图标框写画什么 */
  ST.P.boxPlan = (p, tpls, nRefs) => {
    const ban = ST.banList(p.posterBan);
    const content = String(p.posterContent != null ? p.posterContent : [p.industry, p.posterNote].filter(Boolean).join("；")).trim();
    const blocks = tpls.map((t, i) => [
      `方案 ${i + 1}：模板 ${t.id}「${t.name || ""}」${t.use ? `（适合：${t.use}）` : ""}`,
      ...ST.boxTexts(t.boxes).filter((b) => b.type === "text" || b.type === "icon").map((b) => (b.type === "icon"
        ? `  - ${b.id}（图标：${b.role}${b.desc ? "，原来是 " + b.desc : ""}）：用一句中文描述这里画什么图标 / 插画（不是文字）`
        : `  - ${b.id}（${b.role}${(+b.lines || 1) > 1 ? `，${b.lines} 行` : ""}）：≤${ST.boxMax(b)} 字`)),
    ].join("\n"));
    return [
      `请为一款电商商品写 ${tpls.length} 套淘宝 / 天猫主图的文案。每套用指定的版式模板（照参考图画的线框），你只负责往每个框里写字。`,
      `【要表达的内容】${content || "（没写，按参考图的行业来）"}`,
      nRefs ? `附上的 ${nRefs} 张图是这些模板原来的参考图（顺序和模板一样，同一个模板只附一次）：每个框写什么，看参考图同一个位置原来写的是什么样的话（说法、语气、卖点怎么组织、字的多少），改写成【要表达的内容】的话；不要照抄别家的店名、品牌、价格。` : "",
      "写法要求：",
      "1. 标题直接说“做什么 + 产品”（如：远程安装 MySQL），不要书面套话。",
      "2. 卖点要具体：版本号、平台、一对一、多久、赠送什么、退款承诺这类。",
      "3. 真实的售后承诺可以写（如“安装不成功全额退款”）；不能用广告法违禁词和虚假承诺：" + ban.join("、") + "；不写联系方式。",
      "4. 每个框不超过字数上限（数字、英文、斜杠都算字），尽量写满；并排的几个同类框（标签 1、标签 2…）字数差不多。",
      "5. 店铺名一类的框：没给店名就写一个跟服务相关的短词（如“专业远程服务”）。",
      "",
      ...blocks,
      "",
      "只回复一个 JSON 代码块，格式：",
      '{"plans":[{"tpl":"模板 id","theme":"这张图讲什么（4 个字以内）","boxes":{"b1":"文字","b2":"图标描述"}}]}',
    ].filter((x) => x !== "").join("\n");
  };

  /** 出图（框模板）：草图（字、位置、大小、颜色都对）+ 模板的原参考图（学风格）+ 风格说明 */
  ST.P.posterFromBoxes = (p, plan, o = {}) => {
    const ban = ST.banList(p.posterBan);
    const list = ST.boxTexts(plan.boxes);
    const texts = list.filter((b) => b.type === "text" && String(b.text || "").trim());
    const icons = list.filter((b) => b.type === "icon");
    return [
      "Generate one image: a square 1:1 Chinese e-commerce main image (Taobao / Tmall listing image), designed by a top professional e-commerce designer.",
      "- The FIRST uploaded image is the LAYOUT SKETCH drawn by a program: every text is already in its final position, size, color and line break. Follow its layout exactly — the same zones, positions, proportions, text sizes and colors. Its flat look is only a draft: turn it into a finished design.",
      "- In the sketch, dashed boxes with a cross are ICON placeholders: draw the described icon / illustration there (no dashed lines, no placeholder words).",
      o.ref ? "- The SECOND uploaded image is the original reference design this layout came from: copy its VISUAL STYLE — color scheme, background, typography effects (outline, 3D, shadow, gradient), decorations, cards and pills, texture and polish — but NEVER its words, shop name, brand, product or prices." : "",
      plan.style ? `- Style: ${plan.style}` : "",
      "- Texts — render EXACTLY these Simplified Chinese texts, character for character, where the sketch puts them, and no other words anywhere. Even if a text looks unusual, render it exactly as given: do not fix, rephrase, translate or 'correct' it:",
      ...texts.map((b) => `  · ${b.role}：「${String(b.text).trim()}」`),
      ...icons.map((b) => `- Icon / illustration at "${b.role}": ${b.desc || b.role} (no text inside icons).`),
      plan.note ? `- Extra notes from the shop (Chinese): ${plan.note}` : "",
      "- The result must look like a FINISHED premium commercial design, not a flat mock-up: rich background, depth, soft shadows and light, strong headline typography.",
      "- Every character must be correct and complete: no typos, no missing strokes, no garbled or made-up characters, no extra English, no watermark.",
      `- Never add any of these words: ${ban.join(", ")}.`,
      "- Mobile one-glance: the main headline is the biggest, boldest element; all text is high-contrast and readable on a phone.",
      "Reply with the image only.",
    ].filter(Boolean).join("\n");
  };

  /** 从参考图生成框模板（看图的 AI） */
  ST.P.boxTplLearn = () => [
    "这是一张电商主图（参考图）。请把它的版式拆成“框模板”：每一块文字、图标 / 插画、色块 / 横条 / 卡片底、分隔线都画成一个框。",
    "坐标按画面的百分比（0～100）：x、y 是框的左上角，w、h 是宽和高，尽量量准。",
    "type 类型：",
    "- text 文字框：同一个样式的一行或几行字算一个框；并排的几个标签、几条卖点分开算；",
    "- icon 图标框：图标、插画、产品图、logo、吉祥物（不是字）；",
    "- block 色块：横条、卡片底、按钮底这类纯色块（写在压在它上面的文字框前面）；",
    "- line 线：分隔线；整张图一圈的边框写 frame:true。",
    "每个框写 role（中文角色名，如 大标题、副标题、卖点 1、标签 2、底部横条、产品 logo）。",
    "文字框还要写：color（字的颜色 #hex）、bg（字自带的底色，如胶囊、标签；没有就空）、bold（粗不粗）、lines（几行）、align（left / center / right）、radius（圆角，胶囊写 99）；色块写 bg、radius；线写 color；图标写 desc（画的是什么）。",
    "不要写原图上的文字内容。框按从上到下、从左到右排。",
    "另外写：name（这个版式的中文名，12 个字以内，如“红白 · 左标签右卖点”）、use（适合什么商品，15 个字以内）、style（英文一段话，描述视觉风格：配色、背景、字的效果、装饰、质感，给画图 AI 看）、bg1 / bg2（背景从上到下两个颜色 #hex）。",
    '只回复一个 JSON 代码块：{"name":"","use":"","style":"","bg1":"#ffffff","bg2":"#ffffff","boxes":[{"type":"text","role":"大标题","x":5,"y":10,"w":90,"h":15,"color":"#111111","bg":"","bold":true,"lines":1,"align":"center","radius":0}]}',
  ].join("\n");
}
