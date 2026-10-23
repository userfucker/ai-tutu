/**
 * 详情页 · ② 素材：AI 画多角度图、细节特写（Lee 2026-10-23）
 *
 * - 多角度：在素材卡片上点“AI 多角度”，勾几个角度（主视图、左视图、右视图、后视图、俯视图、45°侧面），一次全部排进去，
 *   Gemini / Copilot 轮流画（也可以指定一个）。画出来是白底图，采用时直接去白底。
 * - 细节特写：点“圈细节”，用画笔在图上涂出要放大的地方，AI 照着画一张特写。
 * - AI 画的图先放在“待确认”里（p.pending），点“采用”才变成素材；全自动不做这一步。
 */
(() => {
  const esc = ST.esc;
  const P = () => APP.project;
  const jobs = []; // 正在画的（不保存）：{ id, label, status, from, again }
  const SITES = [["", "自动（按 AI 分工轮流）"], ["gemini", "Gemini"], ["copilot", "Copilot"]];
  let lastSite = (() => { try { return localStorage.getItem("st:angleSite") || ""; } catch { return ""; } })();
  const siteSel = (id) => `<select id="${id}">${SITES.map(([v, n]) => `<option value="${v}" ${v === lastSite ? "selected" : ""}>${n}</option>`).join("")}</select>`;
  const keepSite = (v) => { lastSite = v; try { localStorage.setItem("st:angleSite", v); } catch {} };
  const rerender = () => { if (APP.step === "assets") APP.render(); };
  const assetNo = (p, id) => p.assets.findIndex((x) => x.id === id) + 1;
  const angleName = (id) => (ST.ANGLES.find((x) => x.id === id) || {}).name || id;

  /** 排一张图：成功放进 p.pending，失败留在 jobs 里显示原因（可以重试） */
  async function runJob(job, make) {
    const p = P();
    job.status = "排队中";
    job.make = make;
    if (!jobs.includes(job)) jobs.push(job);
    rerender();
    try {
      const { blob, item } = await make(() => { job.status = "画图中"; rerender(); });
      const key = `${p.id}:${job.id}-pend`;
      await ST.saveImage(key, blob);
      const img = await ST.blobToImage(blob);
      (p.pending || (p.pending = [])).push({ id: job.id, key, w: img.naturalWidth, h: img.naturalHeight, t: Date.now(), ...item });
      jobs.splice(jobs.indexOf(job), 1);
      await APP.save(true);
    } catch (e) {
      if (e.result && e.result.cancelled) jobs.splice(jobs.indexOf(job), 1);
      else job.status = "失败：" + e.message;
    }
    rerender();
  }

  /** 多角度：angles = ["front", "45", …]，一次全部排进去 */
  APP.genAngles = async (a, angles, site) => {
    const p = P();
    const src = await ST.db.getBlob(a.cut || a.white || a.key);
    const no = assetNo(p, a.id);
    await Promise.all(angles.map((ag, i) => {
      const job = { id: ST.uid("pd"), label: `${angleName(ag)} · 素材${no}`, from: a.id };
      job.again = () => runJob(job, job.make);
      return runJob(job, async (started) => {
        started();
        const blob = await APP.aiImage(ST.P.angleView(p, a, ag, "1:1"), [{ blob: src, name: "产品.jpg", max: 1536 }], `多角度：素材${no} ${angleName(ag)}`, { role: "dt_angle", sites: site ? [site] : undefined, rotate: i });
        return { blob, item: { kind: "angle", angle: ag, from: a.id, note: angleName(ag) } };
      });
    }));
  };

  /** 细节特写：marked = 原图上画了红框，crop = 那一块放大 */
  APP.genCloseUp = async (a, marked, crop, ratio, note, site) => {
    const p = P();
    const no = assetNo(p, a.id);
    const job = { id: ST.uid("pd"), label: `细节${note ? "：" + note : ""} · 素材${no}`, from: a.id };
    const mk = `${p.id}:${job.id}-mark`, ck = `${p.id}:${job.id}-crop`;
    await ST.saveImage(mk, marked);
    await ST.saveImage(ck, crop);
    job.again = () => runJob(job, job.make);
    await runJob(job, async (started) => {
      started();
      const imgs = [{ blob: await ST.db.getBlob(mk), name: "圈出的地方.jpg", max: 1536 }, { blob: await ST.db.getBlob(ck), name: "放大.jpg", max: 1024 }];
      const blob = await APP.aiImage(ST.P.closeUp(p, note, ratio), imgs, `细节特写：素材${no}${note ? " " + note : ""}`, { role: "dt_angle", sites: site ? [site] : undefined });
      return { blob, item: { kind: "detail", from: a.id, note: note || "细节", ratio, src: [mk, ck] } };
    });
  };

  // ------------------------------------------------------------ 对话框
  async function angleDialog(a) {
    const chosen = new Set();
    let site = lastSite;
    const r = await APP.modal(`
      <p>照着这张图，让 AI 画同一个产品的其他角度（白底，采用时自动去白底）。可以多选，一次全部画。</p>
      <div class="pills" id="agList">${ST.ANGLES.map((x) => `<span class="pill" data-ag="${x.id}">${x.name}</span>`).join("")}</div>
      <label class="row lb" style="margin-top:12px">用哪个 AI 画 ${siteSel("agSite")}</label>
      <div class="note" style="margin-top:10px">AI 画的角度图可能和实物有出入（尤其是看不到的那一面），画好先放在“待确认”里，你看过点“采用”才会用。</div>
      <div class="mf"><button data-ret="">取消</button><button class="primary" data-ret="go" id="agGo" disabled>开始画</button></div>`, {
      title: "AI 多角度图",
      onOpen: (m) => {
        m.querySelector("#agList").onclick = (e) => {
          const t = e.target.closest("[data-ag]");
          if (!t) return;
          chosen.has(t.dataset.ag) ? chosen.delete(t.dataset.ag) : chosen.add(t.dataset.ag);
          t.classList.toggle("on", chosen.has(t.dataset.ag));
          const go = m.querySelector("#agGo");
          go.disabled = !chosen.size;
          go.textContent = chosen.size ? `开始画（${chosen.size} 张）` : "开始画";
        };
        m.querySelector("#agSite").onchange = (e) => (site = e.target.value);
      },
    });
    if (r !== "go") return;
    keepSite(site);
    APP.toast(`开始画 ${chosen.size} 张角度图，画好放在“待确认”里`);
    APP.genAngles(a, ST.ANGLES.map((x) => x.id).filter((id) => chosen.has(id)), site);
  }

  /** 涂过的范围（原图像素）；没涂返回 null */
  function maskBox(c) {
    const s = Math.min(1, 400 / Math.max(c.width, c.height));
    const t = ST.canvas(Math.max(1, Math.round(c.width * s)), Math.max(1, Math.round(c.height * s)));
    const g = t.getContext("2d", { willReadFrequently: true });
    g.drawImage(c, 0, 0, t.width, t.height);
    const d = g.getImageData(0, 0, t.width, t.height).data;
    let x0 = t.width, y0 = t.height, x1 = -1, y1 = -1;
    for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) if (d[(y * t.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : { x: x0 / s, y: y0 / s, w: (x1 - x0 + 1) / s, h: (y1 - y0 + 1) / s };
  }
  async function closeUpDialog(a) {
    const img = await ST.imgOf(a.key);
    const W = img.naturalWidth, H = img.naturalHeight;
    let size = 40, site = lastSite, note = "", mask = null;
    const r = await APP.modal(`
      <div class="row" style="margin-bottom:10px"><span class="muted">用画笔涂出要放大的地方（涂一块就行）</span>
        <label class="row lb">笔刷大小 <input type="range" id="cSize" min="8" max="160" value="40" style="width:140px"></label><button class="sm" id="cReset">重新涂</button></div>
      <div class="trim closeup"><div class="cwrap"><img id="cImg" src="${esc(await ST.urlOf(a.key))}" alt=""><canvas id="cMask"></canvas></div></div><div class="brush" id="cBrush" hidden></div>
      <div class="row" style="margin-top:10px"><input id="cNote" class="grow" placeholder="这是什么地方（可以不填），如：拉链头、鞋底纹路"> <label class="row lb">用哪个 AI ${siteSel("cSite")}</label></div>
      <div class="mf"><button data-ret="">取消</button><button class="primary" data-ret="go">画特写</button></div>`, {
      title: "圈细节：AI 画特写", big: true,
      onOpen: (m) => {
        const c = m.querySelector("#cMask");
        c.width = W; c.height = H;
        const g = c.getContext("2d");
        const brush = m.querySelector("#cBrush");
        m.querySelector("#cSize").oninput = (e) => (size = +e.target.value);
        m.querySelector("#cReset").onclick = () => g.clearRect(0, 0, W, H);
        m.querySelector("#cSite").onchange = (e) => (site = e.target.value);
        let down = false, last = null;
        const pt = (e) => { const b = c.getBoundingClientRect(); return { x: ((e.clientX - b.left) / b.width) * W, y: ((e.clientY - b.top) / b.height) * H, s: W / b.width }; };
        const dab = (q) => {
          g.strokeStyle = g.fillStyle = "rgba(255,40,40,0.45)";
          g.lineCap = g.lineJoin = "round";
          g.lineWidth = size * q.s;
          g.beginPath();
          if (last) { g.moveTo(last.x, last.y); g.lineTo(q.x, q.y); g.stroke(); }
          else { g.arc(q.x, q.y, (size * q.s) / 2, 0, Math.PI * 2); g.fill(); }
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
        m._mask = c;
      },
      check: (v, m) => {
        note = m.querySelector("#cNote").value.trim();
        mask = maskBox(m._mask);
        if (!mask || mask.w < 4 || mask.h < 4) { APP.toast("先用画笔涂出要放大的地方", true); return false; }
      },
    });
    if (r !== "go") return;
    keepSite(site);
    // 圈的范围往外放 15%，最小 64 像素
    const pad = Math.max(mask.w, mask.h) * 0.15;
    let x = Math.max(0, mask.x - pad), y = Math.max(0, mask.y - pad);
    let w = Math.min(W - x, mask.w + pad * 2), h = Math.min(H - y, mask.h + pad * 2);
    if (w < 64) { x = Math.max(0, x - (64 - w) / 2); w = Math.min(W - x, 64); }
    if (h < 64) { y = Math.max(0, y - (64 - h) / 2); h = Math.min(H - y, 64); }
    const mc = ST.canvas(W, H);
    const mg = mc.getContext("2d");
    mg.drawImage(img, 0, 0);
    mg.strokeStyle = "#ff2020";
    mg.lineWidth = Math.max(4, Math.round(Math.max(W, H) / 150));
    mg.strokeRect(x, y, w, h);
    const s = Math.min(4, 1024 / Math.max(w, h));
    const cc = ST.canvas(Math.round(w * s), Math.round(h * s));
    const cg = cc.getContext("2d");
    cg.imageSmoothingQuality = "high";
    cg.drawImage(img, x, y, w, h, 0, 0, cc.width, cc.height);
    APP.toast("开始画细节特写，画好放在“待确认”里");
    APP.genCloseUp(a, await ST.toBlob(mc, "image/jpeg", 0.9), await ST.toBlob(cc, "image/jpeg", 0.92), closestAiRatio(w, h), note, site);
  }

  // ------------------------------------------------------------ 待确认
  /** ② 素材页面上方的“待确认”区域 */
  APP.pendingHtml = async () => {
    const p = P();
    const list = p.pending || [];
    if (!list.length && !jobs.length) return "";
    const cards = await Promise.all(list.map(async (x) => `<div class="asset pend" data-pid="${x.id}">
        <div class="pic ${x.kind === "angle" ? "" : ""}" data-act="pendView"><img src="${await ST.urlOf(x.key)}" alt=""><span class="no">${x.kind === "angle" ? "角度" : "细节"}</span></div>
        <div class="muted">${esc(x.note || "")} · 来自素材${assetNo(p, x.from) || "（已删）"}</div>
        <div class="acts"><button class="sm primary" data-act="pendOk">采用</button><button class="sm" data-act="pendAgain" ${p.assets.some((a) => a.id === x.from) ? "" : "disabled"}>重画</button><button class="sm danger" data-act="pendNo">不要</button></div></div>`));
    const run = jobs.map((j) => `<div class="asset pend" data-jid="${j.id}"><div class="pic"><span class="st tag ${/失败/.test(j.status) ? "bad" : "blue"}">${esc(j.status)}</span></div>
        <div class="muted">${esc(j.label)}</div>
        ${/失败/.test(j.status) ? '<div class="acts"><button class="sm" data-act="jobAgain">重试</button><button class="sm danger" data-act="jobDel">移除</button></div>' : ""}</div>`);
    return `<div class="card pendbox"><div class="head"><div><h3>AI 画的图（待确认）</h3><div class="muted">看过没问题点“采用”，才会放进素材、用到详情页里；不像实物就点“不要”或“重画”。</div></div>
      ${list.length > 1 ? '<div class="sp"><button class="sm" data-act="pendAllOk">全部采用</button></div>' : ""}</div>
      <div class="assets">${run.join("")}${cards.join("")}</div></div>`;
  };

  async function dropPending(x, keepMain) {
    const p = P();
    p.pending = (p.pending || []).filter((y) => y !== x);
    for (const k of [keepMain ? "" : x.key, ...(x.src || [])]) if (k) { ST.forget(k); ST.db.delBlob(k); }
  }
  /** 采用：变成一张素材（角度图是白底，直接去白底） */
  async function accept(x) {
    const p = P();
    const id = ST.uid("a");
    const key = `${p.id}:${id}-orig`;
    await ST.saveImage(key, await ST.db.getBlob(x.key));
    const a = { id, name: `${x.kind === "angle" ? "AI角度" : "AI细节"}-${x.note || ""}.png`, tag: x.kind === "angle" ? "angle" : "detail", note: x.note || "", group: "", key, w: x.w, h: x.h, white: "", cut: "", cutBox: null, edgeWhite: x.kind === "angle", ai: true };
    const at = p.assets.findIndex((y) => y.id === x.from);
    p.assets.splice(at >= 0 ? at + 1 : p.assets.length, 0, a);
    await dropPending(x);
    if (x.kind === "angle") { try { await APP.makeCut(a, await ST.db.getBlob(key)); } catch (e) { APP.toast("去白底没成功，先用原图：" + e.message, true); } }
  }

  const pendOf = (el) => (P().pending || []).find((x) => x.id === el.closest("[data-pid]").dataset.pid);
  const jobOf = (el) => jobs.find((j) => j.id === el.closest("[data-jid]").dataset.jid);
  APP.viewActs = {
    angleAi: (el) => angleDialog(P().assets.find((x) => x.id === el.closest("[data-aid]").dataset.aid)),
    closeUp: (el) => closeUpDialog(P().assets.find((x) => x.id === el.closest("[data-aid]").dataset.aid)),
    pendOk: async (el) => { await accept(pendOf(el)); await APP.save(true); APP.toast("已采用，放进素材了"); APP.render(); },
    pendAllOk: async () => { for (const x of [...(P().pending || [])]) await accept(x); await APP.save(true); APP.toast("都采用了"); APP.render(); },
    pendNo: async (el) => { await dropPending(pendOf(el)); await APP.save(true); APP.render(); },
    pendAgain: async (el) => {
      const p = P();
      const x = pendOf(el);
      const a = p.assets.find((y) => y.id === x.from);
      if (!a) return;
      if (x.kind === "angle") { await dropPending(x); await APP.save(true); APP.genAngles(a, [x.angle], lastSite); return; }
      const [mk, ck] = x.src || [];
      const marked = mk && (await ST.db.getBlob(mk)), crop = ck && (await ST.db.getBlob(ck));
      if (!marked || !crop) return APP.toast("原来圈的地方找不到了，请重新“圈细节”", true);
      await dropPending(x);
      await APP.save(true);
      APP.genCloseUp(a, marked, crop, x.ratio || "1:1", x.note === "细节" ? "" : x.note, lastSite);
    },
    pendView: async (el) => {
      const p = P();
      const x = pendOf(el);
      const a = p.assets.find((y) => y.id === x.from);
      const urls = [a ? await ST.urlOf(a.cut || a.key) : "", await ST.urlOf(x.key)];
      APP.modal(`<div class="row" style="align-items:flex-start">${urls.map((u, i) => (u ? `<div class="grow col"><span class="muted">${i ? `AI 画的（${esc(x.note || "")}）` : "原来的素材"}</span><img src="${u}" style="max-width:100%;max-height:62vh;object-fit:contain;border-radius:8px"></div>` : "")).join("")}</div>`, { title: "对比看看", big: true });
    },
    jobAgain: (el) => { const j = jobOf(el); if (j && j.again) j.again(); },
    jobDel: (el) => { const j = jobOf(el); if (j) jobs.splice(jobs.indexOf(j), 1); rerender(); },
  };
  Object.assign(APP.steps.assets.act, APP.viewActs);
})();
