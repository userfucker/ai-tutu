/**
 * 详情页 · ⑦ 检查和导出（在网页里导出，下载到这台电脑）。批量处理改成了首页的“一键全自动”（在服务器上做）。
 */
(() => {
  const esc = ST.esc;
  const P = () => APP.project;
  const X = (APP.ex = { langs: null, pfs: null, issues: null, checking: false, exporting: false, progress: 0, msg: "", long: true, slices: true, texts: true, backup: false, format: "jpeg", pid: "" });

  APP.steps.export = {
    render(main) {
      const p = P();
      if (X.pid !== p.id) Object.assign(X, { langs: [p.lang, ...p.langs], pfs: [...p.platforms], issues: null, pid: p.id });
      X.langs = X.langs.filter((l) => l === p.lang || p.langs.includes(l));
      X.pfs = X.pfs.filter((id) => p.platforms.includes(id));
      const allLangs = [p.lang, ...p.langs];
      const miss = p.langs.map((l) => [l, Object.keys(ST.missingTexts(p, l)).length]).filter(([, n]) => n);
      const needBg = p.screens.filter((s) => s.bg.mode === "ai" && !s.bg.key).length;
      const issues = X.issues || [];
      const byType = {};
      issues.forEach((i) => (byType[i.type] = (byType[i.type] || 0) + 1));
      main.innerHTML = `
        <div class="head"><div><h1>⑦ 检查和导出</h1><div class="muted">先检查违禁词、文字放不下、缺图缺背景，点一条问题直接跳到那一屏去改；然后一次导出所有语言、所有平台。</div></div></div>
        ${!p.screens.length ? '<div class="note warn">还没有屏幕，先去“⑤ 提纲”。</div>' : ""}
        <div class="card"><div class="head"><h3>要处理的语言和平台</h3></div>
          <div class="lb">语言</div><div class="pills">${allLangs.map((l) => `<span class="pill ${X.langs.includes(l) ? "on" : ""}" data-xl="${l}">${esc(ST.lang(l).name)}</span>`).join("")}</div>
          <div class="lb" style="margin-top:8px">平台</div><div class="pills">${p.platforms.map((id) => { const x = ST.platformOf(p, id); return `<span class="pill ${X.pfs.includes(id) ? "on" : ""}" data-xp="${id}">${esc(x.name)}<small>${x.w}${x.h ? "×" + x.h : ""}${x.verify ? " 待核对" : ""}</small></span>`; }).join("")}</div>
          ${miss.length || needBg ? `<div class="note warn" style="margin-top:10px">${needBg ? `还有 ${needBg} 屏的 AI 背景没生成。` : ""}${miss.length ? `还没翻译完：${miss.map(([l, n]) => `${esc(ST.lang(l).name)} 缺 ${n} 条`).join("、")}。` : ""}
            <span class="row" style="margin-top:6px">${needBg ? '<button class="sm blue" data-act="xGen">生成缺的背景</button>' : ""}${miss.length ? '<button class="sm blue" data-act="xTr">翻译缺的</button>' : ""}</span></div>` : ""}
        </div>
        <div class="card"><div class="head"><h3>检查</h3><span class="muted">违禁词按平台自动选词表（${esc([...new Set(X.pfs.flatMap((id) => ST.platformOf(p, id).rules || []))].map((r) => ST.BANNED[r].name).join("、") || "无")}${APP.customWords().length ? "、自定义" : ""}）</span>
          <div class="sp"><button class="primary" data-act="xCheck" ${X.checking || !p.screens.length ? "disabled" : ""}>${X.checking ? "检查中…" : X.issues ? "重新检查" : "开始检查"}</button></div></div>
          ${X.checking ? `<div class="progress"><i style="width:${Math.round(X.progress * 100)}%"></i></div>` : ""}
          ${X.issues ? (issues.length ? `<div class="row" style="margin-bottom:8px">${Object.entries(byType).map(([t, n]) => `<span class="tag ${ST.ISSUE_LEVEL[t]}">${esc(ST.ISSUE_NAMES[t] || t)} ${n}</span>`).join("")}</div>
            <div class="issues">${issues.map((i, n) => `<div class="is" data-act="xJump" data-n="${n}"><span class="tag ${ST.ISSUE_LEVEL[i.type]}">${esc(ST.ISSUE_NAMES[i.type] || i.type)}</span><span>第 ${i.si + 1} 屏 · ${esc(ST.TPL[p.screens[i.si].tpl].name)} · ${esc(ST.lang(i.lang).name)} · ${esc(ST.platformOf(p, i.pf).name)}${i.id ? `（${esc(i.id)}）` : ""}：${esc(i.msg)}</span></div>`).join("")}</div>` : '<div class="tag ok">没发现问题</div>') : '<div class="muted">还没检查。</div>'}
        </div>
        <div class="card"><div class="head"><h3>导出</h3></div>
          <div class="row"><label class="row"><input type="checkbox" data-xo="long" ${X.long ? "checked" : ""}> 整张长图</label><label class="row"><input type="checkbox" data-xo="slices" ${X.slices ? "checked" : ""}> 每屏切片（太高的自动切开）</label>
            <label class="row"><input type="checkbox" data-xo="texts" ${X.texts ? "checked" : ""}> 文案 txt</label>
            <select id="xFormat"><option value="jpeg">JPG</option><option value="png">PNG</option></select></div>
          <div class="note" style="margin-top:10px">zip 里按“平台/语言”分文件夹。JPG 会自动降低质量，直到每张不超过平台的大小限制。导出 ${X.langs.length} 种语言 × ${X.pfs.length} 个平台 × ${p.screens.length} 屏。</div>
          <div class="row" style="margin-top:10px"><button class="primary" data-act="xExport" ${X.exporting || !p.screens.length || !X.langs.length || !X.pfs.length ? "disabled" : ""}>${X.exporting ? "导出中…" : "导出 zip"}</button><span class="muted">${esc(X.msg)}</span></div>
          ${X.exporting ? `<div class="progress" style="margin-top:8px"><i style="width:${Math.round(X.progress * 100)}%"></i></div>` : ""}
        </div>`;
      main.querySelector("#xFormat").value = X.format;
      main.onclick = (e) => {
        const l = e.target.closest("[data-xl]"), f = e.target.closest("[data-xp]");
        if (l) { const v = l.dataset.xl; X.langs = X.langs.includes(v) ? X.langs.filter((x) => x !== v) : [...X.langs, v]; APP.render(); }
        if (f) { const v = f.dataset.xp; X.pfs = X.pfs.includes(v) ? X.pfs.filter((x) => x !== v) : [...X.pfs, v]; APP.render(); }
      };
      main.onchange = (e) => {
        if (e.target.dataset.xo) X[e.target.dataset.xo] = e.target.checked;
        if (e.target.id === "xFormat") X.format = e.target.value;
      };
    },
    act: {
      xCheck: async () => {
        const p = P();
        X.checking = true; X.progress = 0; APP.render();
        try {
          X.issues = await ST.checkProject(p, { langs: X.langs, platforms: X.pfs, brand: APP.brandOf(), custom: APP.customWords(), onProgress: (n, t) => { X.progress = n / t; const bar = document.querySelector(".progress i"); if (bar) bar.style.width = Math.round(X.progress * 100) + "%"; } });
          const order = { banned: 0, overflow: 1, noimg: 2, nobg: 3, overlap: 4, shrink: 5, untranslated: 6 };
          X.issues.sort((a, b) => order[a.type] - order[b.type] || a.si - b.si);
        } catch (e) { APP.toast("检查出错：" + e.message, true); }
        X.checking = false;
        APP.render();
      },
      xJump: (el) => {
        const i = X.issues[+el.dataset.n];
        Object.assign(APP.ed, { si: i.si, lang: i.lang, pf: i.pf, sel: i.id && !/^params$/.test(i.id) ? i.id : null, preview: false });
        APP.go("edit");
      },
      xGen: async () => { APP.genAllBg(); },
      xTr: async () => { APP.toast("开始翻译，进度看右上角“AI 任务”"); await APP.translateAll(); APP.render(); },
      xExport: async () => {
        const p = P();
        X.exporting = true; X.progress = 0; X.msg = ""; APP.render();
        try {
          const r = await ST.exportZip(p, { langs: X.langs, platforms: X.pfs, long: X.long, slices: X.slices, texts: X.texts, format: X.format, brand: APP.brandOf(),
            onProgress: (msg, v) => { X.msg = msg; X.progress = v; const bar = document.querySelector(".progress i"); if (bar) bar.style.width = Math.round(v * 100) + "%"; const m = document.querySelector('[data-act="xExport"] + .muted'); if (m) m.textContent = msg; } });
          APP.download(r.blob, `详情页_${ST.safeName(p.name, 30)}_${ST.stamp()}.zip`);
          // 长图放进素材中心（详情图）
          for (const f of r.files.filter((x) => /\/长图(-\d+)?\.\w+$/.test(x.name)).slice(0, 4)) APP.toLibrary(f.blob, { tag: "详情图", name: `${p.name}_${f.name.split("/").slice(-3).join("_")}` });
          X.msg = `导出完成：${r.count} 个文件${r.notes.length ? `，${r.notes.length} 张超过大小限制（见 zip 里的“注意.txt”）` : ""}`;
        } catch (e) { X.msg = "导出失败：" + e.message; APP.toast(X.msg, true); }
        X.exporting = false;
        APP.render();
      },
    },
  };

})();
