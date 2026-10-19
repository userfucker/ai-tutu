/**
 * 详情页工作室 · ①～⑤ 步：新建项目、素材、产品信息和卖点、参考详情图、提纲。
 */
(() => {
  const esc = ST.esc;
  const P = () => APP.project;
  const busy = new Map(); // 素材编号 → 正在做什么（不保存）

  const pills = (list, isOn, attr) => list.map(([v, label, extra]) => `<span class="pill ${isOn(v) ? "on" : ""}" ${attr}="${esc(v)}">${esc(label)}${extra ? `<small>${esc(extra)}</small>` : ""}</span>`).join("");

  // ================================================================ ① 新建项目
  APP.steps.setup = {
    render(main) {
      const p = P();
      const groups = [...new Set(ST.PLATFORMS.map((x) => x.group))];
      const pfPills = (attr, isOn) => groups.map((g) => `<div class="group-label">${g}</div><div class="pills">${pills(ST.PLATFORMS.filter((x) => x.group === g).map((x) => { const q = ST.platformOf(p, x.id); return [x.id, x.name, `${q.w}${q.h ? "×" + q.h : ""}`]; }), isOn, attr)}</div>`).join("");
      const verify = p.platforms.map((id) => ST.platformOf(p, id)).filter((x) => x.verify);
      main.innerHTML = `
        <div class="head"><div><h1>① 新建项目</h1><div class="muted">选平台、语言和风格。这些以后随时可以回来改。</div></div><div class="sp"><button class="primary" data-go="assets">下一步：上传素材 →</button></div></div>
        <div class="card"><div class="form">
          <label class="f">项目名称<input id="fName" value="${esc(p.name)}"></label>
          <label class="f">主语言（AI 先用这个语言写文案）<select id="fLang">${ST.LANGS.map((l) => `<option value="${l.code}" ${l.code === p.lang ? "selected" : ""}>${esc(l.name)}（${esc(l.native)}）</option>`).join("")}</select></label>
          <label class="f">品牌<span class="row nw"><select id="fBrand" class="grow"><option value="">不用品牌（用风格默认配色）</option>${APP.brands.map((b) => `<option value="${b.id}" ${b.id === p.brandId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select><button class="sm" data-act="settings">管理品牌</button></span></label>
          <label class="f">单位显示<select id="fUnits"><option value="auto">自动（英语显示公制+英制，其他公制）</option><option value="metric">公制（cm、kg）</option><option value="imperial">英制（in、lb）</option><option value="both">都显示</option></select></label>
        </div></div>
        <div class="card"><h3>主平台 <span class="muted">（决定出图宽度和检查规则）</span></h3>${pfPills("data-main", (v) => v === p.platform)}</div>
        <div class="card"><h3>同时导出到 <span class="muted">（可以多选；同一套内容按各平台的尺寸自动重新排）</span></h3>${pfPills("data-also", (v) => p.platforms.includes(v))}
          ${verify.length ? `<div class="note warn" style="margin-top:10px">${verify.map((x) => esc(x.name)).join("、")} 的尺寸是常用值，还没对照平台后台核对，上传前请确认（可以在“设置 → 平台尺寸”里改）。</div>` : ""}</div>
        <div class="card"><h3>还要导出的语言 <span class="muted">（主语言写好后，AI 一次翻译成这些语言）</span></h3>
          <div class="pills" style="margin-top:8px">${pills(ST.LANGS.filter((l) => l.code !== p.lang).map((l) => [l.code, l.name, l.rtl ? "从右往左" : ""]), (v) => p.langs.includes(v), "data-lang")}</div></div>
        <div class="card"><h3>风格语气</h3><div class="pills" style="margin-top:8px">${pills(Object.entries(ST.TONES).map(([k, t]) => [k, t.name, t.zh.split("，")[0]]), (v) => v === p.tone, "data-tone")}</div></div>`;
      main.querySelector("#fUnits").value = p.units || "auto";
      main.onclick = (e) => {
        const m = e.target.closest("[data-main]"), a = e.target.closest("[data-also]"), l = e.target.closest("[data-lang]"), t = e.target.closest("[data-tone]");
        if (m) { p.platform = m.dataset.main; if (!p.platforms.includes(p.platform)) p.platforms.unshift(p.platform); }
        else if (a) { const v = a.dataset.also; if (v === p.platform) return APP.toast("主平台一定会导出"); p.platforms = p.platforms.includes(v) ? p.platforms.filter((x) => x !== v) : [...p.platforms, v]; }
        else if (l) { const v = l.dataset.lang; p.langs = p.langs.includes(v) ? p.langs.filter((x) => x !== v) : [...p.langs, v]; }
        else if (t) p.tone = t.dataset.tone;
        else return;
        APP.save();
        APP.render();
      };
      main.oninput = (e) => {
        if (e.target.id === "fName") { p.name = e.target.value || "未命名"; document.getElementById("projName").value = p.name; }
        APP.save();
      };
      main.onchange = (e) => {
        if (e.target.id === "fName") return; // 名字只在输入时保存，不重画（重画会吞掉紧接着的点击）
        if (e.target.id === "fLang") {
          const old = p.lang;
          p.lang = e.target.value;
          p.langs = p.langs.filter((x) => x !== p.lang);
          if (p.screens.length && old !== p.lang) APP.toast("主语言改了：已有的文案还是原来的语言，可以在提纲里重新让 AI 写", true);
        }
        if (e.target.id === "fBrand") p.brandId = e.target.value;
        if (e.target.id === "fUnits") p.units = e.target.value;
        APP.save();
        APP.render();
      };
    },
  };

  // ================================================================ ② 素材
  APP.addAssetFiles = async (fileList, o = {}) => {
    const p = P();
    const files = [...fileList].filter((f) => /^image\//.test(f.type) || ST.isImageName(f.name || ""));
    let n = 0;
    for (const f of files) {
      try {
        const blob = f.type ? f : new Blob([f], { type: ST.mimeOf(f.name) });
        const img = await ST.blobToImage(blob);
        const id = ST.uid("a");
        const key = `${p.id}:${id}-orig`;
        await ST.saveImage(key, blob);
        const white = ST.edgeIsWhite(img);
        p.assets.push({ id, name: f.name || "图片", tag: o.tag || (white ? "white" : "other"), note: o.note || "", group: o.group ? o.group(f) : "", key, w: img.naturalWidth, h: img.naturalHeight, white: "", cut: "", cutBox: null, edgeWhite: white });
        n++;
      } catch (e) { APP.toast(`${f.name} 打不开：${e.message}`, true); }
    }
    await APP.save(true);
    return n;
  };

  /** 去白底：src = 白底图 Blob（AI 出的或原图），结果存成透明 PNG */
  async function makeCut(a, srcBlob) {
    const p = P();
    const img = await ST.blobToImage(srcBlob);
    const out = await composeOutput(img, { ratio: null, inputRatio: img.naturalWidth / img.naturalHeight, inputSize: { w: img.naturalWidth, h: img.naturalHeight }, outSize: "original", fill: "keep", background: "white", format: "png-alpha", contrast: "0", bright: "0", holes: "auto" });
    const blob = out.blob || srcBlob;
    const key = `${p.id}:${a.id}-cut`;
    await ST.saveImage(key, blob);
    const cimg = await ST.imgOf(key);
    a.cut = key;
    a.cutBox = ST.alphaBox(cimg);
    a.cutW = cimg.naturalWidth; a.cutH = cimg.naturalHeight;
  }
  APP.cutAsset = async (a, how) => {
    const p = P();
    busy.set(a.id, how === "ai" ? "AI 抠图排队中…" : "去白底中…");
    APP.render();
    try {
      let src;
      if (how === "ai") {
        const orig = await ST.db.getBlob(a.key);
        const ratio = closestAiRatio(a.w, a.h);
        busy.set(a.id, "AI 抠图中…");
        APP.render();
        src = await APP.aiImage(ST.P.cutout(p, a, ratio), [{ blob: orig, name: a.name }], `抠图：素材${p.assets.indexOf(a) + 1}`);
        a.white = `${p.id}:${a.id}-white`;
        await ST.saveImage(a.white, src);
      } else src = await ST.db.getBlob(a.white || a.key);
      await makeCut(a, src);
      busy.delete(a.id);
      await APP.save(true);
    } catch (e) {
      busy.set(a.id, "失败：" + e.message);
      if (!(e.result && e.result.cancelled)) APP.toast(`抠图没成功：${e.message}`, true);
    }
    APP.render();
  };

  /** 修边：擦掉多余的 / 把抠掉的找回来 */
  async function trimAsset(a) {
    const cutImg = await ST.imgOf(a.cut);
    const srcImg = await ST.imgOf(a.white || a.key);
    let mode = "erase", size = 24;
    const r = await APP.modal(`
      <div class="row" style="margin-bottom:10px"><span class="pills" id="tMode"><span class="pill on" data-m="erase">擦除（去掉多余的）</span><span class="pill" data-m="restore">恢复（找回被抠掉的）</span></span>
      <label class="row lb">笔刷大小 <input type="range" id="tSize" min="4" max="120" value="24" style="width:140px"></label><button class="sm" id="tReset">重新来</button></div>
      <div class="trim checker"><canvas id="tCanvas"></canvas></div><div class="brush" id="tBrush" hidden></div>
      <div class="mf"><button data-ret="">取消</button><button class="primary" data-ret="save">保存</button></div>`, {
      title: "修边", big: true,
      onOpen: (m) => {
        const c = m.querySelector("#tCanvas");
        c.width = cutImg.naturalWidth; c.height = cutImg.naturalHeight;
        const g = c.getContext("2d");
        g.drawImage(cutImg, 0, 0);
        const brush = m.querySelector("#tBrush");
        m.querySelector("#tMode").onclick = (e) => { const t = e.target.closest("[data-m]"); if (!t) return; mode = t.dataset.m; m.querySelectorAll("#tMode .pill").forEach((x) => x.classList.toggle("on", x === t)); };
        m.querySelector("#tSize").oninput = (e) => (size = +e.target.value);
        m.querySelector("#tReset").onclick = () => { g.clearRect(0, 0, c.width, c.height); g.drawImage(cutImg, 0, 0); };
        let down = false, last = null;
        const pt = (e) => { const b = c.getBoundingClientRect(); return { x: ((e.clientX - b.left) / b.width) * c.width, y: ((e.clientY - b.top) / b.height) * c.height, s: c.width / b.width }; };
        const dab = (q) => {
          const rr = size * q.s / 2;
          const n = last ? Math.max(1, Math.ceil(Math.hypot(q.x - last.x, q.y - last.y) / (rr / 2))) : 1;
          const pts = last ? Array.from({ length: n }, (_, i) => ({ x: last.x + ((q.x - last.x) * (i + 1)) / n, y: last.y + ((q.y - last.y) * (i + 1)) / n })) : [q];
          for (const p0 of pts) {
            g.save();
            g.beginPath(); g.arc(p0.x, p0.y, rr, 0, Math.PI * 2);
            if (mode === "erase") { g.globalCompositeOperation = "destination-out"; g.fill(); }
            else { g.clip(); g.clearRect(p0.x - rr, p0.y - rr, rr * 2, rr * 2); g.drawImage(srcImg, 0, 0, c.width, c.height); }
            g.restore();
          }
          last = q;
        };
        c.onpointerdown = (e) => { down = true; last = null; c.setPointerCapture(e.pointerId); dab(pt(e)); };
        c.onpointermove = (e) => {
          brush.hidden = false;
          brush.style.width = brush.style.height = size + "px";
          brush.style.left = e.clientX - size / 2 + "px"; brush.style.top = e.clientY - size / 2 + "px";
          if (down) dab(pt(e));
        };
        c.onpointerup = () => { down = false; last = null; };
        c.onpointerleave = () => (brush.hidden = true);
        m._canvas = c;
      },
      check: async (v, m) => {
        const blob = await ST.toBlob(m._canvas, "image/png");
        await ST.saveImage(a.cut, blob);
        const img = await ST.imgOf(a.cut);
        a.cutBox = ST.alphaBox(img);
      },
    });
    if (r === "save") { await APP.save(true); APP.toast("修边已保存"); APP.render(); }
  }

  /** 淘宝采集插件导出的 zip */
  async function importTaobao(file) {
    const p = P();
    APP.toast("正在读取 zip…");
    const files = await ST.readZip(file);
    const dj = files.find((f) => /(^|\/)data\.json$/.test(f.name));
    const data = dj ? JSON.parse(await dj.blob.text()) : null;
    const root = dj ? dj.name.replace(/data\.json$/, "") : (files[0] && files[0].name.includes("/") ? files[0].name.split("/")[0] + "/" : "");
    const inDir = (re) => files.filter((f) => f.name.startsWith(root) && re.test(f.name.slice(root.length)) && ST.isImageName(f.name)).sort((a, b) => a.name.localeCompare(b.name, "zh"));
    const groups = [
      ["main", "主图", inDir(/^主图\//), "当素材"],
      ["main34", "3:4 主图", inDir(/^3比4主图\//), "当素材"],
      ["sku", "SKU 图", inDir(/^SKU图\//), "当规格图素材（名字自动填）"],
      ["picked", "我选的图片", inDir(/^我选的图片\//), "当素材"],
      ...[...new Set(files.map((f) => (/^(详情图[^/]*)\//.exec(f.name.slice(root.length)) || [])[1]).filter(Boolean))].map((d) => [`desc:${d}`, d.replace("_", " "), inDir(new RegExp("^" + d + "\\/")), "当参考详情图"]),
    ].filter((g) => g[2].length);
    const rateN = data && data.rates && data.rates.list ? data.rates.list.length : 0;
    const qaN = data && data.qa && data.qa.list ? data.qa.list.length : 0;
    const html = `<div class="col">
      ${groups.map(([id, name, list, how], i) => `<label class="row"><input type="checkbox" data-g="${esc(id)}" ${i === 0 || id === "sku" ? "checked" : ""}> <b>${esc(name)}</b> <span class="muted">${list.length} 张 · ${how}</span></label>`).join("")}
      ${data && data.item ? `<label class="row"><input type="checkbox" data-g="info" checked> <b>商品信息</b> <span class="muted">标题 → 产品名称，商品参数 → 参数表（只填空着的）</span></label>` : ""}
      ${rateN || qaN ? `<label class="row"><input type="checkbox" data-g="reviews" checked> <b>评价和问大家</b> <span class="muted">${rateN} 条评价、${qaN} 个问题 → 用来挖卖点</span></label>` : ""}
      ${!groups.length && !data ? '<div class="note warn">这个 zip 里没找到淘宝采集插件导出的内容。</div>' : ""}
      <div class="note">参考详情图只学排版和风格，不会直接用别人的图片和文字。</div></div>
      <div class="mf"><button data-ret="">取消</button><button class="primary" data-ret="ok">导入</button></div>`;
    let chosen = [];
    const r = await APP.modal(html, { title: "从淘宝采集导入", check: (v, m) => { chosen = [...m.querySelectorAll("[data-g]:checked")].map((x) => x.dataset.g); } });
    if (r !== "ok") return;
    let added = 0;
    for (const [id, , list] of groups) {
      if (!chosen.includes(id)) continue;
      if (id.startsWith("desc:")) {
        await APP.setRefImages(list.map((f) => f.blob));
        APP.toast(`参考详情图 ${list.length} 张已放到“④ 参考详情图”`);
        continue;
      }
      const fl = list.map((f) => new File([f.blob], f.name.split("/").pop(), { type: f.blob.type }));
      added += await APP.addAssetFiles(fl, id === "sku" ? { tag: "spec", group: (f) => (f.name.replace(/\.\w+$/, "").split("_").slice(1).join("_") || "") } : {});
    }
    if (chosen.includes("info") && data.item) {
      const it = data.item;
      if (!p.info.name && it.title) p.info.name = it.title.slice(0, 40);
      if (!p.info.params.length && Array.isArray(it.params)) p.info.params = it.params.filter((x) => x.name && x.value).slice(0, 14).map((x) => ({ k: x.name, v: x.value }));
      if (!p.info.colors && it.skuProps && it.skuProps.length) p.info.colors = it.skuProps.map((x) => `${x.name}：${x.values.map((v) => v.name).join("、")}`).join("；");
    }
    if (chosen.includes("reviews")) {
      const lines = [];
      ((data.rates && data.rates.list) || []).forEach((x) => { if (x.content) lines.push("评价：" + x.content + (x.appendContent ? " 追评：" + x.appendContent : "")); });
      ((data.qa && data.qa.list) || []).forEach((q) => lines.push("问：" + q.title + (q.answers && q.answers.length ? " 答：" + q.answers.map((a) => a.content).join(" / ") : "")));
      p.reviews.raw = lines.join("\n");
    }
    await APP.save(true);
    APP.toast(`导入完成：素材 ${added} 张`);
    APP.render();
  }

  APP.steps.assets = {
    async render(main) {
      const p = P();
      const cards = await Promise.all(p.assets.map(async (a, i) => {
        const url = await ST.urlOf(a.cut || a.key);
        const b = busy.get(a.id);
        return `<div class="asset" data-aid="${a.id}">
          <div class="pic ${a.cut ? "checker" : ""}" data-act="viewAsset"><img src="${url}" alt=""><span class="no">素材${i + 1}</span>
            ${b ? `<span class="st tag ${/失败/.test(b) ? "bad" : "blue"}">${esc(b)}</span>` : a.cut ? '<span class="st tag ok">已抠图</span>' : ""}</div>
          <select data-k="tag">${ST.TAGS.map((t) => `<option value="${t.id}" ${t.id === a.tag ? "selected" : ""}>${t.name}</option>`).join("")}</select>
          <input data-k="note" value="${esc(a.note)}" placeholder="说明（如：加厚拉链、侧面）">
          ${a.tag === "spec" ? `<input data-k="group" value="${esc(a.group)}" placeholder="规格名（如：灰色、L 码）">` : ""}
          <div class="acts">
            <button class="sm" data-act="cutAi" ${b && !/失败/.test(b) ? "disabled" : ""} title="让 AI 出一张纯白背景的图，再去白底（适合背景复杂的图）">AI 抠图</button>
            <button class="sm" data-act="cutDirect" ${b && !/失败/.test(b) ? "disabled" : ""} title="图本来就是白底：直接去掉白色背景，不用 AI">直接去白底</button>
            ${a.cut ? '<button class="sm" data-act="trim">修边</button><button class="sm" data-act="uncut" title="不用抠好的图，用原图">用原图</button>' : ""}
            <button class="sm danger" data-act="delAsset">删除</button></div></div>`;
      }));
      main.innerHTML = `
        <div class="head"><div><h1>② 素材</h1><div class="muted">上传产品图，给每张图打标签（程序靠标签决定哪张图放进哪一屏）。产品要贴到背景上，所以白底主图、角度图、规格图最好都抠成透明底。</div></div>
          <div class="sp"><button data-act="pickFiles">上传图片</button><button data-act="pickTaobao">从淘宝采集导入</button><button class="blue" data-act="cutAll" ${p.assets.some((a) => !a.cut && ["white", "angle", "spec", "package"].includes(a.tag)) ? "" : "disabled"}>全部抠图</button><button class="primary" data-go="info">下一步：产品信息 →</button></div></div>
        ${p.assets.length ? `<div class="assets">${cards.join("")}</div>` : `<div class="empty" id="dropZone">把图片拖到这里，或者点“上传图片”，或者按 Ctrl+V 粘贴<br><span class="muted">白底主图、多角度图、细节图、规格图（每个颜色一张）、包装图、真实场景图都可以</span></div>`}
        <div class="note" style="margin-top:14px">“全部抠图”：白底图直接去白底，背景复杂的图交给 AI 先出白底图再去白底。白色、透明、反光的产品边缘可能抠不干净，可以点“修边”手动处理。</div>
        <input type="file" id="assetInput" accept="image/*" multiple hidden><input type="file" id="tbInput" accept=".zip" hidden>`;
      main.oninput = (e) => {
        const card = e.target.closest("[data-aid]");
        if (!card || !e.target.dataset.k) return;
        const a = p.assets.find((x) => x.id === card.dataset.aid);
        a[e.target.dataset.k] = e.target.value;
        APP.save();
      };
      main.onchange = async (e) => {
        if (e.target.dataset.k === "tag") APP.render();
        if (e.target.id === "assetInput" && e.target.files.length) { const n = await APP.addAssetFiles(e.target.files); e.target.value = ""; APP.toast(`加了 ${n} 张图`); APP.render(); }
        if (e.target.id === "tbInput" && e.target.files[0]) { const f = e.target.files[0]; e.target.value = ""; importTaobao(f).catch((err) => APP.toast(err.message, true)); }
      };
      main.ondragover = (e) => { e.preventDefault(); main.classList.add("drop-on"); };
      main.ondragleave = (e) => { if (!main.contains(e.relatedTarget)) main.classList.remove("drop-on"); };
      main.ondrop = async (e) => {
        e.preventDefault();
        main.classList.remove("drop-on");
        const fl = [...e.dataTransfer.files];
        const zip = fl.find((f) => /\.zip$/i.test(f.name));
        if (zip) return importTaobao(zip).catch((err) => APP.toast(err.message, true));
        const n = await APP.addAssetFiles(fl);
        if (n) { APP.toast(`加了 ${n} 张图`); APP.render(); }
      };
    },
    act: {
      pickFiles: () => document.getElementById("assetInput").click(),
      pickTaobao: () => document.getElementById("tbInput").click(),
      cutAi: (el) => APP.cutAsset(P().assets.find((x) => x.id === el.closest("[data-aid]").dataset.aid), "ai"),
      cutDirect: (el) => APP.cutAsset(P().assets.find((x) => x.id === el.closest("[data-aid]").dataset.aid), "direct"),
      trim: (el) => trimAsset(P().assets.find((x) => x.id === el.closest("[data-aid]").dataset.aid)),
      uncut: async (el) => {
        const a = P().assets.find((x) => x.id === el.closest("[data-aid]").dataset.aid);
        a.cut = ""; a.cutBox = null;
        await APP.save(true); APP.render();
      },
      delAsset: async (el) => {
        const p = P();
        const a = p.assets.find((x) => x.id === el.closest("[data-aid]").dataset.aid);
        const used = p.screens.some((s) => Object.values(s.slots || {}).includes(a.id) || (s.items || []).some((it) => it.asset === a.id));
        if (!(await APP.confirm(used ? "这张图已经用在详情页里了，删除后那些位置会空出来。确定删除？" : "删除这张图？", "删除", true))) return;
        p.assets = p.assets.filter((x) => x !== a);
        p.screens.forEach((s) => { for (const k of Object.keys(s.slots || {})) if (s.slots[k] === a.id) s.slots[k] = ""; (s.items || []).forEach((it) => { if (it.asset === a.id) it.asset = ""; }); });
        for (const k of [a.key, a.cut, a.white]) if (k) { ST.forget(k); ST.db.delBlob(k); }
        await APP.save(true); APP.render();
      },
      cutAll: async () => {
        const p = P();
        const list = p.assets.filter((a) => !a.cut && ["white", "angle", "spec", "package"].includes(a.tag));
        APP.toast(`开始抠图：${list.length} 张（白底的直接去白底，其他的排队交给 AI）`);
        await Promise.all(list.map((a) => APP.cutAsset(a, a.edgeWhite ? "direct" : "ai")));
      },
      viewAsset: async (el) => {
        const a = P().assets.find((x) => x.id === el.closest("[data-aid]").dataset.aid);
        const urls = await Promise.all([a.key, a.white, a.cut].filter(Boolean).map((k) => ST.urlOf(k)));
        APP.modal(`<div class="row" style="align-items:flex-start">${urls.map((u, i) => `<div class="grow col"><span class="muted">${["原图", a.white ? "AI 白底图" : "抠好的图", "抠好的图"][i]}</span><img src="${u}" class="${i && u === urls[urls.length - 1] && a.cut ? "checker" : ""}" style="max-width:100%;max-height:60vh;object-fit:contain;border-radius:8px"></div>`).join("")}</div><div class="muted" style="margin-top:8px">${a.w}×${a.h}</div>`, { title: a.name, big: true });
      },
    },
  };
  document.addEventListener("paste", async (e) => {
    if (APP.step !== "assets" || !APP.project || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const fl = [...(e.clipboardData && e.clipboardData.files) || []];
    if (!fl.length) return;
    const n = await APP.addAssetFiles(fl);
    if (n) { APP.toast(`粘贴了 ${n} 张图`); APP.render(); }
  });

  // ================================================================ ③ 产品信息和卖点
  APP.steps.info = {
    render(main) {
      const p = P();
      const i = p.info;
      const fld = (k, label, ph = "") => `<label class="f">${label}<input data-info="${k}" value="${esc(i[k] || "")}" placeholder="${esc(ph)}"></label>`;
      const d = i.dims || {};
      main.innerHTML = `
        <div class="head"><div><h1>③ 产品信息和卖点</h1><div class="muted">参数、尺寸必须你来填，AI 不会编数字。卖点自己填，AI 帮着补充和润色。</div></div><div class="sp"><button class="primary" data-go="ref">下一步：参考详情图 →</button></div></div>
        <div class="card"><h3>基本信息</h3><div class="form" style="margin-top:10px">
          ${fld("name", "产品名称", "如：男士商务双肩包")}${fld("category", "类目", "如：箱包 / 双肩包")}${fld("brand", "品牌名（会出现在文案里）")}${fld("material", "材质", "如：防泼水牛津布")}
          ${fld("weight", "重量", "如：0.9 kg")}${fld("colors", "颜色 / 规格", "如：黑色、灰色、蓝色")}${fld("package", "包装清单", "如：背包 ×1、防尘袋 ×1")}${fld("audience", "适用人群", "如：上班族、出差")}
          ${fld("scenes", "使用场景", "如：通勤、出差、短途旅行")}${fld("size", "尺寸说明（文字）", "如：可放 15.6 寸电脑")}
          <label class="f">尺寸（尺寸图用，会自动换算单位）<span class="row nw"><input data-dim="l" value="${esc(d.l || "")}" placeholder="长/深" style="width:70px"><input data-dim="w" value="${esc(d.w || "")}" placeholder="宽" style="width:70px"><input data-dim="h" value="${esc(d.h || "")}" placeholder="高" style="width:70px">
            <select data-dim="unit">${["cm", "mm", "m"].map((u) => `<option ${u === (d.unit || "cm") ? "selected" : ""}>${u}</option>`).join("")}</select></span></label>
          <label class="f wide">其他说明（给 AI 看的，不直接显示）<textarea data-info="extra" rows="2" placeholder="产品的特别之处、和别家的区别……">${esc(i.extra || "")}</textarea></label>
        </div></div>
        <div class="card"><div class="head"><h3>参数表</h3><span class="muted">显示在“参数表”那一屏；翻译时会一起翻译</span><div class="sp"><button class="sm" data-act="paramsFromInfo">把上面的材质/尺寸/重量/颜色加进来</button><button class="sm" data-act="addParam">＋ 加一行</button></div></div>
          <table class="ptable">${(i.params || []).map((r, n) => `<tr data-pi="${n}"><td style="width:32%"><input data-pk="k" value="${esc(r.k)}" placeholder="参数名"></td><td><input data-pk="v" value="${esc(r.v)}" placeholder="参数值"></td><td style="width:40px"><button class="sm ghost" data-act="delParam">✕</button></td></tr>`).join("") || '<tr><td class="muted">还没有参数</td></tr>'}</table></div>
        <div class="card"><div class="head"><h3>卖点</h3><span class="muted">拖动排序（越前越重要），勾选的才会用</span>
          <div class="sp"><button class="sm" data-act="addPoint">＋ 自己加</button><button class="sm" data-act="aiPoints">AI 再想几个</button><button class="sm" data-act="aiPolish">AI 润色勾选的</button></div></div>
          <div class="plist" id="plist">${(p.points || []).map((x) => `<div class="pitem" draggable="true" data-pid="${x.id}"><span class="drag">⠿</span><input type="checkbox" data-pon ${x.on ? "checked" : ""}><input type="text" data-ptext value="${esc(x.text)}"><span class="tag ${x.src === "me" ? "" : "blue"}">${{ me: "我填的", ai: "AI 建议", review: "来自评价" }[x.src] || ""}</span><button class="sm ghost" data-act="delPoint">✕</button></div>`).join("") || '<div class="muted">还没有卖点。自己填几个，或者点“AI 再想几个”。</div>'}</div></div>
        <div class="card"><div class="head"><h3>从评价里挖卖点</h3><span class="muted">粘贴评价和问答（淘宝采集插件导入的会自动填进来），AI 总结买家最在意、最担心什么</span><div class="sp"><button class="sm" data-act="aiReviews" ${p.reviews.raw ? "" : "disabled"}>AI 总结</button></div></div>
          <textarea id="revRaw" rows="5" placeholder="把评价、问大家的内容粘贴到这里，一行一条">${esc(p.reviews.raw || "")}</textarea>
          ${p.reviews.concerns && p.reviews.concerns.length ? `<div class="lb" style="margin-top:10px">买家在意的点</div><div class="pills">${p.reviews.concerns.map((c) => `<span class="pill">${esc(c.text)}${c.count ? `<small>${esc(c.count)}</small>` : ""}</span>`).join("")}</div>` : ""}</div>`;
      main.oninput = (e) => {
        const t = e.target;
        if (t.dataset.info) i[t.dataset.info] = t.value;
        else if (t.dataset.dim) { i.dims = i.dims || {}; i.dims[t.dataset.dim] = t.value; }
        else if (t.dataset.pk) { const n = +t.closest("[data-pi]").dataset.pi; i.params[n][t.dataset.pk] = t.value; }
        else if (t.dataset.ptext !== undefined) { const x = p.points.find((q) => q.id === t.closest("[data-pid]").dataset.pid); x.text = t.value; }
        else if (t.id === "revRaw") { p.reviews.raw = t.value; main.querySelector('[data-act="aiReviews"]').disabled = !t.value.trim(); }
        APP.save();
      };
      main.onchange = (e) => {
        if (e.target.dataset.pon !== undefined) { const x = p.points.find((q) => q.id === e.target.closest("[data-pid]").dataset.pid); x.on = e.target.checked; APP.save(); }
        if (e.target.dataset.dim === "unit") APP.save();
      };
      // 拖动排序卖点
      let dragId = null;
      main.ondragstart = (e) => { const it = e.target.closest("[data-pid]"); if (!it) return; dragId = it.dataset.pid; it.classList.add("dragging"); };
      main.ondragend = (e) => { const it = e.target.closest("[data-pid]"); if (it) it.classList.remove("dragging"); };
      main.ondragover = (e) => { if (dragId && e.target.closest("[data-pid]")) e.preventDefault(); };
      main.ondrop = (e) => {
        const it = e.target.closest("[data-pid]");
        if (!dragId || !it) return;
        e.preventDefault();
        const from = p.points.findIndex((x) => x.id === dragId), to = p.points.findIndex((x) => x.id === it.dataset.pid);
        const [m] = p.points.splice(from, 1);
        p.points.splice(to, 0, m);
        dragId = null;
        APP.save(); APP.render();
      };
    },
    act: {
      addParam: () => { P().info.params.push({ k: "", v: "" }); APP.save(); APP.render(); },
      delParam: (el) => { P().info.params.splice(+el.closest("[data-pi]").dataset.pi, 1); APP.save(); APP.render(); },
      paramsFromInfo: () => {
        const i = P().info;
        const zh = /^zh/.test(P().lang);
        const d = i.dims || {};
        const have = new Set(i.params.map((r) => r.k));
        const add = (k, v) => { if (v && !have.has(k)) i.params.push({ k, v }); };
        add(zh ? "材质" : "Material", i.material);
        if (d.l || d.w || d.h) add(zh ? "尺寸" : "Size", [d.l, d.w, d.h].filter(Boolean).join("×") + (d.unit || "cm"));
        add(zh ? "重量" : "Weight", i.weight);
        add(zh ? "颜色" : "Color", i.colors);
        APP.save(); APP.render();
      },
      addPoint: () => { P().points.push({ id: ST.uid("pt"), text: "", on: true, src: "me" }); APP.save(); APP.render(); setTimeout(() => { const l = document.querySelectorAll("[data-ptext]"); if (l.length) l[l.length - 1].focus(); }, 30); },
      delPoint: (el) => { const p = P(); p.points = p.points.filter((x) => x.id !== el.closest("[data-pid]").dataset.pid); APP.save(); APP.render(); },
      aiPoints: async (el) => {
        const p = P();
        el.disabled = true;
        try {
          const a = p.assets.find((x) => x.tag === "white") || p.assets[0];
          const imgs = a ? [{ blob: await ST.db.getBlob(a.cut || a.key), name: "产品图.jpg", max: 1024 }] : [];
          const r = await APP.aiJson(ST.P.suggestPoints(p, 5), imgs, "AI 想卖点");
          const list = (r.points || []).map((t) => String(typeof t === "string" ? t : t.text || "")).filter(Boolean);
          list.forEach((t) => p.points.push({ id: ST.uid("pt"), text: t, on: false, src: "ai" }));
          APP.toast(`AI 建议了 ${list.length} 个卖点，勾选要用的`);
          await APP.save(true);
        } catch (e) { if (!(e.result && e.result.cancelled)) APP.toast("AI 想卖点没成功：" + e.message, true); }
        APP.render();
      },
      aiPolish: async (el) => {
        const p = P();
        const list = p.points.filter((x) => x.on && x.text);
        if (!list.length) return APP.toast("先勾选要润色的卖点", true);
        el.disabled = true;
        try {
          const r = await APP.aiJson(ST.P.polishPoints(p, list.map((x) => x.text)), [], "AI 润色卖点");
          (r.points || []).forEach((t, n) => { if (list[n] && t) list[n].text = String(t); });
          APP.toast("已润色");
          await APP.save(true);
        } catch (e) { if (!(e.result && e.result.cancelled)) APP.toast("润色没成功：" + e.message, true); }
        APP.render();
      },
      aiReviews: async (el) => {
        const p = P();
        el.disabled = true;
        try {
          const r = await APP.aiJson(ST.P.reviewPoints(p, p.reviews.raw), [], "AI 总结评价");
          p.reviews.concerns = (r.concerns || []).map((c) => ({ text: String(c.text || c), count: c.count || "" })).filter((c) => c.text);
          (r.points || []).forEach((t) => p.points.push({ id: ST.uid("pt"), text: String(t), on: false, src: "review" }));
          APP.toast(`总结了 ${p.reviews.concerns.length} 个关注点，加了 ${(r.points || []).length} 个卖点建议`);
          await APP.save(true);
        } catch (e) { if (!(e.result && e.result.cancelled)) APP.toast("总结没成功：" + e.message, true); }
        APP.render();
      },
    },
  };

  // ================================================================ ④ 参考详情图
  APP.setRefImages = async (blobs) => {
    const p = P();
    const { canvas, joins } = await ST.stitch(blobs);
    const key = `${p.id}:ref`;
    await ST.saveImage(key, await ST.toBlob(canvas, "image/jpeg", 0.9));
    p.ref = { key, w: canvas.width, h: canvas.height, cuts: ST.autoCuts(canvas, joins), analysis: [] };
    await APP.save(true);
  };
  let segCache = { sig: "", urls: [] };
  async function segments(p) {
    const sig = p.ref.key + p.ref.cuts.join(",");
    if (segCache.sig === sig) return segCache;
    const img = await ST.imgOf(p.ref.key);
    const c = ST.canvas(img.naturalWidth, img.naturalHeight);
    c.getContext("2d").drawImage(img, 0, 0);
    const blobs = await ST.cropSegments(c, p.ref.cuts, 1024);
    segCache.urls.forEach((u) => URL.revokeObjectURL(u));
    segCache = { sig, blobs, urls: blobs.map((b) => URL.createObjectURL(b)) };
    return segCache;
  }
  APP.steps.ref = {
    async render(main) {
      const p = P();
      if (!p.ref) {
        main.innerHTML = `<div class="head"><div><h1>④ 参考详情图（可选）</h1><div class="muted">导入一套别人的详情页（长图或多张图），自动切成一屏一屏，AI 学它的排版顺序和风格。只学排版，不用它的图片和文字。</div></div><div class="sp"><button class="primary" data-go="outline">跳过，下一步：提纲 →</button></div></div>
          <div class="empty" id="refDrop">把参考详情图拖到这里（可以多张，按顺序拼起来），或者 <button data-act="refPick">选择图片</button><br><span class="muted">淘宝采集插件导出的 zip 里的“详情图”，可以在“② 素材 → 从淘宝采集导入”里直接导进来</span></div>
          <input type="file" id="refInput" accept="image/*" multiple hidden>`;
      } else {
        const url = await ST.urlOf(p.ref.key);
        const seg = await segments(p);
        const an = p.ref.analysis || [];
        main.innerHTML = `<div class="head"><div><h1>④ 参考详情图</h1><div class="muted">红色虚线是切线：点图片空白处加一条，拖动调整位置，点 ✕ 删除。切好以后让 AI 分析每一屏。</div></div>
          <div class="sp"><button data-act="refPick">换参考图</button><button data-act="refAuto">重新自动切</button><button class="danger" data-act="refClear">不用参考图</button><button class="blue" data-act="refAnalyze">AI 分析每一屏</button><button class="primary" data-act="refToOutline" ${an.length ? "" : "disabled"}>按参考图列提纲 →</button></div></div>
          <div class="refwrap"><div class="refbox" id="refBox"><img src="${url}" id="refImg" draggable="false">${p.ref.cuts.map((y, n) => `<div class="cut" data-cut="${n}" style="top:${(y / p.ref.h) * 100}%"><span class="n">${n + 2}</span><span class="x" data-delcut="${n}">✕</span></div>`).join("")}</div>
          <div class="seglist">${seg.urls.map((u, n) => { const a = an[n]; return `<div class="seg"><img src="${u}"><div class="col"><b>第 ${n + 1} 屏${a ? ` · ${esc(a.purpose || "")}` : ""}</b>${a ? `<span class="row"><span class="tag blue">${esc((ST.TPL[a.template] || {}).name || a.template || "")}</span>${(a.colors || []).map((c) => `<span title="${esc(c)}" style="width:14px;height:14px;border-radius:3px;display:inline-block;background:${esc(c)};border:1px solid var(--line)"></span>`).join("")}</span><span class="muted">${esc(a.layout || "")}</span><span class="muted">${esc(a.style || "")}</span>` : '<span class="muted">还没分析</span>'}</div></div>`; }).join("")}</div></div>
          <input type="file" id="refInput" accept="image/*" multiple hidden>`;
        const box = main.querySelector("#refBox");
        let drag = null;
        box.onpointerdown = (e) => {
          const del = e.target.closest("[data-delcut]");
          if (del) { p.ref.cuts.splice(+del.dataset.delcut, 1); p.ref.analysis = []; APP.save(); APP.render(); return; }
          const cut = e.target.closest("[data-cut]");
          const rect = box.getBoundingClientRect();
          const yOf = (ev) => Math.round(ST.clamp((ev.clientY - rect.top) / rect.height, 0.01, 0.99) * p.ref.h);
          if (cut) { drag = { n: +cut.dataset.cut, el: cut }; box.setPointerCapture(e.pointerId); return; }
          p.ref.cuts.push(yOf(e));
          p.ref.cuts.sort((a, b) => a - b);
          p.ref.analysis = [];
          APP.save(); APP.render();
        };
        box.onpointermove = (e) => {
          if (!drag) return;
          const rect = box.getBoundingClientRect();
          const y = ST.clamp((e.clientY - rect.top) / rect.height, 0.01, 0.99);
          drag.el.style.top = y * 100 + "%";
          drag.y = Math.round(y * p.ref.h);
        };
        box.onpointerup = () => {
          if (!drag) return;
          if (drag.y) { p.ref.cuts[drag.n] = drag.y; p.ref.cuts.sort((a, b) => a - b); p.ref.analysis = []; APP.save(); }
          drag = null;
          APP.render();
        };
      }
      main.onchange = async (e) => {
        if (e.target.id === "refInput" && e.target.files.length) {
          const fl = [...e.target.files].sort((a, b) => a.name.localeCompare(b.name, "zh", { numeric: true }));
          e.target.value = "";
          await APP.setRefImages(fl);
          APP.render();
        }
      };
      main.ondragover = (e) => e.preventDefault();
      main.ondrop = async (e) => {
        e.preventDefault();
        const fl = [...e.dataTransfer.files].filter((f) => /^image\//.test(f.type)).sort((a, b) => a.name.localeCompare(b.name, "zh", { numeric: true }));
        if (!fl.length) return;
        await APP.setRefImages(fl);
        APP.render();
      };
    },
    act: {
      refPick: () => document.getElementById("refInput").click(),
      refAuto: async () => {
        const p = P();
        const img = await ST.imgOf(p.ref.key);
        const c = ST.canvas(img.naturalWidth, img.naturalHeight);
        c.getContext("2d").drawImage(img, 0, 0);
        p.ref.cuts = ST.autoCuts(c, []);
        p.ref.analysis = [];
        APP.save(); APP.render();
      },
      refClear: async () => { if (!(await APP.confirm("不用参考图了？"))) return; const p = P(); if (p.ref) ST.db.delBlob(p.ref.key); p.ref = null; p.screens.forEach((s) => delete s.refIndex); APP.save(); APP.render(); },
      refAnalyze: async (el) => {
        const p = P();
        const seg = await segments(p);
        el.disabled = true;
        const out = [];
        try {
          for (let i = 0; i < seg.blobs.length; i += 5) {
            const part = seg.blobs.slice(i, i + 5);
            const r = await APP.aiJson(ST.P.analyzeRef(p, i + 1, part.length), part.map((b, k) => ({ blob: b, name: `第${i + k + 1}屏.jpg`, max: 1024 })), `分析参考图 ${i + 1}～${i + part.length} 屏`);
            const list = r.screens || [];
            part.forEach((_, k) => { out[i + k] = list.find((x) => +x.i === i + k + 1) || list[k] || {}; });
          }
          p.ref.analysis = out;
          await APP.save(true);
          APP.toast("分析完了，可以按参考图列提纲");
        } catch (e) { if (!(e.result && e.result.cancelled)) APP.toast("分析没成功：" + e.message, true); }
        APP.render();
      },
      refToOutline: async () => { APP.go("outline"); APP.runOutline(); },
    },
  };

  // ================================================================ ⑤ 提纲
  APP.runOutline = async (structure) => {
    const p = P();
    if (p.screens.length && !structure && !(await APP.confirm("重新列提纲会替换现在的所有屏幕（背景图、手动调整都会丢掉）。继续？", "重新列"))) return;
    APP.outlineBusy = true;
    APP.render();
    try {
      const a = p.assets.find((x) => x.tag === "white") || p.assets[0];
      const imgs = a ? [{ blob: await ST.db.getBlob(a.cut || a.key), name: "产品图.jpg", max: 1024 }] : [];
      const data = await APP.aiJson(ST.P.outline(p, { structure: structure && structure.map((s) => s.tpl) }), imgs, "AI 列提纲、写文案");
      let screens = ST.screensFromOutline(p, data);
      if (!screens.length) throw new Error("AI 没有给出提纲");
      if (structure) {
        // 按我的模板：结构、背景、调整用模板的，文字用 AI 写的
        screens = structure.map((s, i) => {
          const n = screens[i];
          if (!n || n.tpl !== s.tpl) return s;
          s.text = n.text;
          s.items = s.items.map((it, k) => ({ ...it, title: (n.items[k] || {}).title || {}, desc: (n.items[k] || {}).desc || {}, asset: it.asset || (n.items[k] || {}).asset || "" }));
          for (const [k, v] of Object.entries(n.slots)) if (!s.slots[k]) s.slots[k] = v;
          if (!s.bg.prompt) s.bg.prompt = n.bg.prompt;
          return s;
        });
      }
      APP.mark();
      p.screens = screens;
      APP.commit();
      APP.toast(`AI 列了 ${screens.length} 屏，检查一下再去生成`);
    } catch (e) {
      if (structure && !p.screens.length) { p.screens = structure; APP.save(); } // 按模板写文案失败：至少把结构留下
      if (!(e.result && e.result.cancelled)) APP.toast("列提纲没成功：" + e.message, true);
    }
    APP.outlineBusy = false;
    APP.render();
  };
  /** 换模板：同名文字保留，项数按新模板调整 */
  function changeTpl(sc, id) {
    const t = ST.TPL[id];
    const n = ST.newScreen(id);
    n.id = sc.id;
    n.purpose = t.name;
    for (const x of t.texts || []) if (sc.text[x.key]) n.text[x.key] = sc.text[x.key];
    if (t.items) {
      const k = Math.max(t.items.min, Math.min(t.items.max, sc.items.length || t.items.def));
      n.items = Array.from({ length: k }, (_, i) => sc.items[i] ? { ...sc.items[i] } : { id: ST.uid("i"), title: {}, desc: {}, asset: "", icon: "" });
    }
    n.slots = { ...sc.slots };
    n.bg = { ...sc.bg, mode: t.bg === "ai" ? (sc.bg.mode === "color" ? "ai" : sc.bg.mode) : sc.bg.key ? sc.bg.mode : "color" };
    return ST.assignAssets(P(), [n])[0];
  }
  APP.changeTpl = changeTpl;
  /** 提纲和编辑页面共用：按路径写字段 */
  APP.setField = (sc, path, val) => {
    const m = P().lang;
    const [kind, a, b] = path.split(":");
    if (kind === "text") { sc.text[a] = sc.text[a] || {}; sc.text[a][APP.editLang || m] = val; }
    else if (kind === "item") { const it = sc.items.find((x) => x.id === a); if (!it) return; if (b === "icon") it.icon = val; else { it[b] = it[b] || {}; it[b][APP.editLang || m] = val; } }
    else if (kind === "bg") sc.bg[a] = val;
  };

  APP.steps.outline = {
    async render(main) {
      const p = P();
      APP.editLang = p.lang;
      const m = p.lang;
      const assetThumb = async (id) => { const a = ST.assetOf(p, id); return a ? await ST.urlOf(a.cut || a.key) : ""; };
      const rows = await Promise.all(p.screens.map(async (sc, si) => {
        const t = ST.TPL[sc.tpl];
        const texts = (t.texts || []).map((x) => `<label class="f">${esc(x.name)}<input data-sid="${sc.id}" data-path="text:${x.key}" value="${esc(ST.tr(sc.text[x.key], m, m).text)}"></label>`).join("");
        const slots = await Promise.all((t.slots || []).map(async (s) => `<div class="f">${esc(s.name)}<span class="slot"><button class="thumbbtn" data-act="pickSlot" data-sid="${sc.id}" data-slot="${s.key}" style="background-image:url('${await assetThumb(sc.slots[s.key])}')" title="点一下换图"></button></span></div>`));
        const items = t.items ? await Promise.all(sc.items.map(async (it) => `<div class="it ${t.items.asset ? "" : "noimg"}">
          ${t.items.asset ? `<button class="thumbbtn" data-act="pickItem" data-sid="${sc.id}" data-iid="${it.id}" style="background-image:url('${await assetThumb(it.asset)}')" title="点一下换图"></button>` : ""}
          <input data-sid="${sc.id}" data-path="item:${it.id}:title" value="${esc(ST.tr(it.title, m, m).text)}" placeholder="${sc.tpl === "compare" ? "我们的优点" : "标题"}">
          ${t.items.fields.includes("desc") ? `<input data-sid="${sc.id}" data-path="item:${it.id}:desc" value="${esc(ST.tr(it.desc, m, m).text)}" placeholder="${sc.tpl === "compare" ? "普通款的问题" : "说明"}">` : "<span></span>"}
          ${t.items.icon ? `<select data-sid="${sc.id}" data-path="item:${it.id}:icon"><option value="">图标：自动</option>${Object.entries(ST.ICONS).map(([k, n]) => `<option value="${k}" ${it.icon === k ? "selected" : ""}>${n}</option>`).join("")}</select>` : "<span></span>"}
          <button class="sm ghost" data-act="delItem" data-sid="${sc.id}" data-iid="${it.id}" ${sc.items.length <= t.items.min ? "disabled" : ""}>✕</button></div>`)) : [];
        return `<div class="oitem" draggable="true" data-osid="${sc.id}">
          <div class="ohead"><span class="drag" title="拖动排序">⠿</span><span class="idx">${si + 1}</span>
            <select data-act-change="tpl" data-sid="${sc.id}">${ST.TPL_ORDER.map((id) => `<option value="${id}" ${id === sc.tpl ? "selected" : ""}>${ST.TPL[id].name}</option>`).join("")}</select>
            <span class="muted">${esc(t.desc)}</span>
            <span class="sp row">${t.bg === "ai" || sc.bg.mode === "ai" ? '<span class="tag blue">AI 画背景</span>' : ""}<button class="sm danger" data-act="delScreen" data-sid="${sc.id}">删除这屏</button></span></div>
          <div class="obody">${texts}${slots.join("")}
            ${t.bg === "ai" || sc.bg.mode === "ai" ? `<label class="f wide">背景画面（英文，给 AI 画背景用）<input data-sid="${sc.id}" data-path="bg:prompt" value="${esc(sc.bg.prompt || "")}" placeholder="如：soft beige marble surface, warm morning light"></label>` : ""}
            ${t.items ? `<div class="items"><div class="lb">${esc(t.items.name)}（${t.items.min}～${t.items.max} 项）</div>${items.join("")}${sc.items.length < t.items.max ? `<div><button class="sm" data-act="addItem" data-sid="${sc.id}">＋ 加一项</button></div>` : ""}</div>` : ""}
          </div></div>`;
      }));
      main.innerHTML = `
        <div class="head"><div><h1>⑤ 提纲</h1><div class="muted">先让 AI 列出要做哪几屏、每屏的文案，你再增删、调顺序、改字、换图。确认后去生成背景。</div></div>
          <div class="sp"><button data-act="olDefault" title="不用 AI：按常用顺序排一套，文字取自产品信息和卖点">按常用顺序排</button><button data-act="olMyTpl" ${APP.mytpls.length ? "" : "disabled"}>用我的模板</button>
          <button class="blue" data-act="olAi" ${APP.outlineBusy ? "disabled" : ""}>${APP.outlineBusy ? "AI 正在列提纲…" : p.ref && p.ref.analysis && p.ref.analysis.length ? "AI 按参考图列提纲" : "AI 列提纲"}</button>
          <button class="primary" data-go="edit" ${p.screens.length ? "" : "disabled"}>确认，去生成和编辑 →</button></div></div>
        ${!p.assets.length ? '<div class="note warn" style="margin-bottom:12px">还没有素材：先到“② 素材”上传产品图，AI 才知道把哪张图放哪里。</div>' : ""}
        ${p.screens.length ? `<div class="olist">${rows.join("")}</div>` : `<div class="empty">还没有提纲。点右上角“AI 列提纲”，或者“按常用顺序排”。</div>`}
        <div class="row" style="margin-top:12px"><select id="addTpl">${ST.TPL_ORDER.map((id) => `<option value="${id}">${ST.TPL[id].name}</option>`).join("")}</select><button data-act="addScreen">＋ 加一屏</button></div>`;
      main.onfocusin = (e) => { if (e.target.dataset.path) APP.mark(); };
      main.oninput = (e) => {
        const el = e.target;
        if (!el.dataset.path || el.tagName === "SELECT") return;
        const sc = p.screens.find((x) => x.id === el.dataset.sid);
        APP.setField(sc, el.dataset.path, el.value);
        APP.save();
      };
      main.onchange = (e) => {
        const el = e.target;
        const sc = el.dataset.sid && p.screens.find((x) => x.id === el.dataset.sid);
        if (el.dataset.actChange === "tpl") {
          APP.mark();
          p.screens[p.screens.indexOf(sc)] = changeTpl(sc, el.value);
          APP.commit(); APP.render();
        } else if (el.dataset.path && el.tagName === "SELECT") { APP.mark(); APP.setField(sc, el.dataset.path, el.value); APP.commit(); }
        else if (el.dataset.path) APP.commit();
      };
      let dragId = null;
      main.ondragstart = (e) => {
        if (/INPUT|SELECT|BUTTON/.test(e.target.tagName)) { e.preventDefault(); return; }
        const it = e.target.closest("[data-osid]"); if (!it) return; dragId = it.dataset.osid; it.classList.add("dragging");
      };
      main.ondragend = (e) => { const it = e.target.closest("[data-osid]"); if (it) it.classList.remove("dragging"); };
      main.ondragover = (e) => { if (dragId && e.target.closest("[data-osid]")) e.preventDefault(); };
      main.ondrop = (e) => {
        const it = e.target.closest("[data-osid]");
        if (!dragId || !it) return;
        e.preventDefault();
        APP.mark();
        const from = p.screens.findIndex((x) => x.id === dragId), to = p.screens.findIndex((x) => x.id === it.dataset.osid);
        const [mv] = p.screens.splice(from, 1);
        p.screens.splice(to, 0, mv);
        dragId = null;
        APP.commit(); APP.render();
      };
    },
    act: {
      olAi: () => APP.runOutline(),
      olDefault: async () => {
        const p = P();
        if (p.screens.length && !(await APP.confirm("替换现在的所有屏幕？", "替换"))) return;
        APP.mark(); p.screens = ST.defaultOutline(p); APP.commit(); APP.render();
      },
      olMyTpl: async () => {
        const r = await APP.modal(`<div class="plist">${APP.mytpls.map((t) => `<div class="pitem"><b class="grow">${esc(t.name)}</b><span class="muted">${t.screens.length} 屏：${t.screens.map((s) => ST.TPL[s.tpl].name).join("、")}</span><button class="sm" data-ret="plain:${t.id}">只用结构</button><button class="sm primary" data-ret="ai:${t.id}">用结构 + AI 写文案</button></div>`).join("")}</div><div class="mf"><button data-ret="">取消</button></div>`, { title: "用我的模板", big: true });
        if (!r) return;
        const [how, id] = r.split(":");
        const t = APP.mytpls.find((x) => x.id === id);
        const p = P();
        if (p.screens.length && !(await APP.confirm("替换现在的所有屏幕？", "替换"))) return;
        const screens = await APP.screensFromMyTpl(t);
        p.tone = t.tone || p.tone;
        if (how === "ai") { p.screens = []; APP.runOutline(screens); }
        else { APP.mark(); p.screens = screens; APP.commit(); APP.render(); }
      },
      addScreen: () => { const p = P(); APP.mark(); p.screens.push(ST.assignAssets(p, [ST.newScreen(document.getElementById("addTpl").value)])[0]); APP.commit(); APP.render(); },
      delScreen: async (el) => { const p = P(); APP.mark(); p.screens = p.screens.filter((x) => x.id !== el.dataset.sid); APP.commit(); APP.render(); },
      addItem: (el) => { const sc = P().screens.find((x) => x.id === el.dataset.sid); APP.mark(); sc.items.push({ id: ST.uid("i"), title: {}, desc: {}, asset: "", icon: "" }); ST.assignAssets(P(), [sc]); APP.commit(); APP.render(); },
      delItem: (el) => { const sc = P().screens.find((x) => x.id === el.dataset.sid); APP.mark(); sc.items = sc.items.filter((x) => x.id !== el.dataset.iid); APP.commit(); APP.render(); },
      pickItem: async (el) => {
        const sc = P().screens.find((x) => x.id === el.dataset.sid);
        const it = sc.items.find((x) => x.id === el.dataset.iid);
        const id = await APP.pickAsset(it.asset, ST.TPL[sc.tpl].items.assetTags || ["detail"]);
        if (id === null) return;
        APP.mark(); it.asset = id; APP.commit(); APP.render();
      },
      pickSlot: async (el) => {
        const sc = P().screens.find((x) => x.id === el.dataset.sid);
        const def = (ST.TPL[sc.tpl].slots || []).find((s) => s.key === el.dataset.slot);
        const id = await APP.pickAsset(sc.slots[el.dataset.slot], def ? def.tags : []);
        if (id === null) return;
        APP.mark(); sc.slots[el.dataset.slot] = id; APP.commit(); APP.render();
      },
    },
  };
})();
