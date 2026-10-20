/**
 * 详情页 · ⚡ 全自动：看服务器上全自动做到哪一步、审核、下载；首页的“一键全自动新建”（可以一次拖进多个 zip / 文件夹）。
 */
(() => {
  const esc = ST.esc;
  const P = () => APP.project;
  const STEPS = ["识别素材", "抠图", "卖点", "参考图", "提纲和文案", "背景", "检查背景", "翻译", "检查修正", "导出"];
  const ISSUE = { banned: "违禁词", overflow: "文字放不下", noimg: "缺图", nobg: "缺背景", overlap: "重叠", shrink: "文字缩小", untranslated: "没翻译" };

  APP.steps.auto = {
    render(main) {
      const p = P();
      const a = p.auto;
      const pf = ST.platformOf(p, p.platform);
      const setupLine = `<div class="muted">平台：${esc(p.platforms.map((id) => ST.platformOf(p, id).name).join("、"))} · 语言：${esc([p.lang, ...p.langs].map((l) => ST.lang(l).name).join("、"))} · 风格：${esc((ST.TONES[p.tone] || {}).name || "")} <a href="#" data-go="setup">改</a></div>`;
      if (!a) {
        main.innerHTML = `<div class="head"><div><h1>⚡ 一键全自动</h1>${setupLine}</div></div>
          <div class="card"><p>在服务器上自动做完整套详情页，关掉浏览器也不停，做完导出 zip 等你审核：</p>
          <div class="asteps">${STEPS.map((s, i) => `<div>${i + 1}. ${s}</div>`).join("")}</div>
          <div class="note">${p.assets.length ? `已有 ${p.assets.length} 张素材。` : "还没有素材：先到“② 素材”上传产品图（或者从淘宝采集导入）。"}已经填好的东西（产品信息、卖点、提纲、背景）会保留，只补缺的。AI 任务由连上工作台的插件来做（画图要 AI图图 插件）。</div>
          <div class="row" style="margin-top:12px"><button class="primary" data-act="autoStart" ${p.assets.length ? "" : "disabled"}>开始一键全自动</button><button data-go="assets">先看看素材</button></div></div>`;
        return;
      }
      const busy = a.status === "running" || a.status === "exporting";
      const issues = Object.entries(a.issues || {}).filter(([, n]) => n);
      main.innerHTML = `<div class="head"><div><h1>⚡ 一键全自动 <span class="astat ${a.status}">${esc(APP.AUTO_NAMES[a.status] || a.status)}</span></h1>${setupLine}</div>
          <div class="sp">${busy ? '<button class="danger" data-act="autoStop">停止</button>' : ""}
          ${a.status === "failed" || a.status === "stopped" ? '<button class="primary" data-act="autoStart">接着做</button>' : ""}
          ${a.exportFile ? `<a class="btnlink" style="padding:5px 11px;font-size:13px" href="/api/projects/${p.id}/export">下载 zip</a>` : ""}</div></div>
        <div class="card"><div class="asteps">${STEPS.map((s, i) => `<div class="${a.status === "review" || a.status === "approved" || i < a.step ? "done" : i === a.step && busy ? "on" : ""}">${i + 1}. ${s}</div>`).join("")}</div>
          ${busy ? `<div class="note">正在做：${esc(a.msg || "")}。AI 任务一个一个排队做，可能要几分钟到半小时；可以关掉这个页面，做完回来看。</div>` : ""}
          ${a.status === "failed" ? `<div class="note warn">出错了：${esc(a.error || "")}。处理好以后点“接着做”，做过的不会重做。</div>` : ""}
          ${a.status === "review" || a.status === "approved" ? `<div class="note">${a.status === "review" ? "做完了，请审核：" : "已审核通过。"}导出了 ${a.files || 0} 个文件。${issues.length ? "还有这些问题：" + issues.map(([t, n]) => `${esc(ISSUE[t] || t)} ${n} 处`).join("、") + "，可以到“⑦ 检查和导出”里点问题跳过去改。" : "检查没有发现问题。"}${(a.notes || []).length ? ` ${a.notes.length} 张图超过平台大小限制。` : ""}</div>
            <div class="row" style="margin-top:10px"><button class="primary" data-go="edit">逐屏看看、手动改</button><button data-go="export">检查结果</button>
            <button class="blue" data-act="autoApprove">${a.status === "approved" ? "改完了，重新导出" : "审核通过（按现在的内容导出）"}</button>
            <button class="sm" data-act="autoAgain" title="已经做好的保留，只补缺的；要整套重来，先到提纲里删掉屏幕">再跑一遍全自动</button></div>` : ""}
        </div>
        <div class="card"><h3>过程记录</h3><div class="alog" id="alog">${esc((a.log || []).join("\n")) || "（还没有）"}</div>
          <div class="muted" style="margin-top:6px">每个 AI 任务的详情在工作台的 <a href="/#/tasks" target="_blank">任务中心</a>。</div></div>`;
      const lg = main.querySelector("#alog");
      if (lg) lg.scrollTop = lg.scrollHeight;
    },
    act: {
      autoStart: async () => { await APP.startAuto(P().id); P().auto = { status: "running", step: 0, msg: "开始" }; APP.render(); },
      autoAgain: async () => { if (!(await APP.confirm("再跑一遍全自动？已经做好的保留，只补缺的（比如新加的语言、没生成的背景）。", "开始"))) return; await APP.startAuto(P().id); },
      autoStop: async () => { await APP.api("POST", `/api/projects/${P().id}/auto/stop`); APP.toast("已停止"); },
      autoApprove: async (el) => {
        el.disabled = true;
        el.textContent = "正在导出…";
        await APP.save(true);
        try { await APP.api("POST", `/api/projects/${P().id}/auto/approve`); APP.toast("已审核通过，可以下载 zip 了"); } catch (e) { APP.toast(e.message, true); }
        APP.project = await ST.db.getProject(P().id);
        APP.render();
      },
    },
  };

  // ------------------------------------------------------------ 一键全自动新建（批量）
  /** 拖进来的东西 → [{ name, kind: "zip"|"dir", file | files: [{ name, blob }] }] */
  async function readEntries(dt) {
    const out = [];
    const walk = (entry, prefix) => new Promise((resolve) => {
      if (entry.isFile) entry.file((f) => resolve([{ name: prefix + f.name, blob: f }]), () => resolve([]));
      else if (entry.isDirectory) {
        const r = entry.createReader();
        const all = [];
        const more = () => r.readEntries(async (list) => {
          if (!list.length) { const sub = await Promise.all(all.map((e) => walk(e, prefix + entry.name + "/"))); resolve(sub.flat()); return; }
          all.push(...list);
          more();
        }, () => resolve([]));
        more();
      } else resolve([]);
    });
    const items = [...(dt.items || [])].map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
    if (items.length) {
      for (const e of items) {
        if (e.isDirectory) out.push({ name: e.name, kind: "dir", files: await walk(e, "") });
        else if (/\.zip$/i.test(e.name)) out.push({ name: e.name.replace(/\.zip$/i, ""), kind: "zip", file: await new Promise((r) => e.file(r)) });
      }
      // 直接拖进来的一堆图片：算一个产品
      const loose = [];
      for (const e of items) if (e.isFile && ST.isImageName(e.name)) loose.push({ name: e.name, blob: await new Promise((r) => e.file(r)) });
      if (loose.length) out.push({ name: "新产品", kind: "dir", files: loose.map((f) => ({ name: "新产品/" + f.name, blob: f.blob })) });
    } else {
      for (const f of dt.files || []) if (/\.zip$/i.test(f.name)) out.push({ name: f.name.replace(/\.zip$/i, ""), kind: "zip", file: f });
    }
    return out;
  }
  /** 选文件夹（input webkitdirectory）：按第一层文件夹分成一个个产品；选的是一个产品文件夹就是一个 */
  function groupDirFiles(fileList) {
    const files = [...fileList].filter((f) => ST.isImageName(f.name) || /data\.json$/.test(f.name));
    const paths = files.map((f) => f.webkitRelativePath || f.name);
    const depth = paths.map((p) => p.split("/").length);
    const topHasImages = paths.some((p, i) => depth[i] === 2 && ST.isImageName(p)) || paths.some((p) => /^[^/]+\/data\.json$/.test(p));
    const groups = new Map();
    files.forEach((f, i) => {
      const parts = paths[i].split("/");
      const key = topHasImages || parts.length < 3 ? parts[0] : parts[0] + "/" + parts[1];
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ name: topHasImages || parts.length < 3 ? paths[i] : parts.slice(1).join("/"), blob: f });
    });
    return [...groups.entries()].map(([k, list]) => ({ name: k.split("/").pop(), kind: "dir", files: list }));
  }

  APP.openBatchNew = async () => {
    const items = [];
    const draw = (m) => {
      m.querySelector("#bnList").innerHTML = items.map((it, i) => `<div><span class="tag ${it.state === "失败" ? "bad" : it.state === "已开始" ? "ok" : ""}">${esc(it.state || (it.kind === "zip" ? "zip" : `文件夹 ${it.files.length} 个文件`))}</span><input data-bn="${i}" value="${esc(it.name)}" style="flex:1"><button class="sm ghost" data-del="${i}" ${it.state ? "disabled" : ""}>✕</button>${it.err ? `<span class="muted">${esc(it.err)}</span>` : ""}</div>`).join("") || '<div class="muted">还没有选</div>';
      m.querySelector('[data-ret="go"]').disabled = !items.some((x) => !x.state);
    };
    const groups = [...new Set(ST.PLATFORMS.map((x) => x.group))];
    const html = `
      <div class="dropbig" id="bnDrop">把 <b>淘宝采集插件导出的 zip</b> 或 <b>装着产品图的文件夹</b> 拖到这里（可以一次拖多个，每个是一个产品）<br>
        <span class="row" style="justify-content:center;margin-top:8px"><button id="bnZip">选 zip 文件</button><button id="bnDir">选文件夹</button></span>
        <input type="file" id="bnZipIn" accept=".zip" multiple hidden><input type="file" id="bnDirIn" webkitdirectory multiple hidden></div>
      <div class="flist" id="bnList"></div>
      <div class="form" style="margin-top:12px">
        <label class="f">主平台<select id="bnPf">${groups.map((g) => `<optgroup label="${esc(g)}">${ST.PLATFORMS.filter((x) => x.group === g).map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}</optgroup>`).join("")}</select></label>
        <label class="f">主语言<select id="bnLang">${ST.LANGS.map((l) => `<option value="${l.code}">${esc(l.name)}</option>`).join("")}</select></label>
        <label class="f">风格<select id="bnTone">${Object.entries(ST.TONES).map(([k, t]) => `<option value="${k}">${esc(t.name)}</option>`).join("")}</select></label>
        <label class="f">品牌<select id="bnBrand"><option value="">不用品牌</option>${APP.brands.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("")}</select></label>
      </div>
      <div class="lb" style="margin-top:8px">还要导出的语言</div>
      <div class="pills" id="bnLangs">${ST.LANGS.map((l) => `<span class="pill" data-l="${l.code}">${esc(l.name)}</span>`).join("")}</div>
      <div class="note" style="margin-top:10px">每个产品建一个项目，马上开始一键全自动（服务器上排队做，关掉网页也不停）。做完的在“我的项目”里显示“等你审核”。</div>
      <div class="mf"><button data-ret="">关闭</button><button class="primary" data-ret="go" disabled>开始</button></div>`;
    let uploading = false;
    await APP.modal(html, {
      title: "一键全自动新建", big: true,
      onOpen: (m) => {
        draw(m);
        const add = (list) => { items.push(...list); draw(m); };
        m.querySelector("#bnZip").onclick = () => m.querySelector("#bnZipIn").click();
        m.querySelector("#bnDir").onclick = () => m.querySelector("#bnDirIn").click();
        m.querySelector("#bnZipIn").onchange = (e) => { add([...e.target.files].map((f) => ({ name: f.name.replace(/\.zip$/i, ""), kind: "zip", file: f }))); e.target.value = ""; };
        m.querySelector("#bnDirIn").onchange = (e) => { add(groupDirFiles(e.target.files)); e.target.value = ""; };
        const drop = m.querySelector("#bnDrop");
        drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("drop-on"); };
        drop.ondragleave = () => drop.classList.remove("drop-on");
        drop.ondrop = async (e) => { e.preventDefault(); drop.classList.remove("drop-on"); const list = await readEntries(e.dataTransfer); if (!list.length) APP.toast("没认出 zip 或文件夹", true); add(list); };
        m.querySelector("#bnLangs").onclick = (e) => { const t = e.target.closest("[data-l]"); if (t) t.classList.toggle("on"); };
        m.addEventListener("input", (e) => { if (e.target.dataset.bn) items[+e.target.dataset.bn].name = e.target.value; });
        m.addEventListener("click", (e) => { const d = e.target.closest("[data-del]"); if (d) { items.splice(+d.dataset.del, 1); draw(m); } });
      },
      check: async (v, m) => {
        if (v !== "go" || uploading) return false;
        uploading = true;
        const lang = m.querySelector("#bnLang").value;
        const o = { platform: m.querySelector("#bnPf").value, lang, tone: m.querySelector("#bnTone").value, brandId: m.querySelector("#bnBrand").value, langs: [...m.querySelectorAll("#bnLangs .on")].map((x) => x.dataset.l).filter((l) => l !== lang) };
        m.querySelector('[data-ret="go"]').disabled = true;
        for (const it of items) {
          if (it.state) continue;
          it.state = "上传中"; draw(m);
          try {
            const body = it.kind === "zip" ? it.file : await makeZip(it.files.map((f) => ({ name: f.name, blob: f.blob })));
            const r = await fetch(`/api/projects/import?auto=1&o=${encodeURIComponent(JSON.stringify({ ...o, name: it.name }))}`, { method: "POST", body, credentials: "same-origin" });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(d.error || `出错了（${r.status}）`);
            it.state = "已开始";
          } catch (e) { it.state = "失败"; it.err = e.message; }
          draw(m);
        }
        uploading = false;
        APP.toast(`已开始 ${items.filter((x) => x.state === "已开始").length} 个，做完的在“我的项目”里等你审核`);
        if (APP.step === "home") APP.render();
        return false; // 弹窗留着，看每个的结果
      },
    });
    if (APP.step === "home") APP.render();
  };
})();
