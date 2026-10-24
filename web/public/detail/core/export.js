/**
 * 详情页工作室 · 导出（长图 + 每屏切片 + 文案，多语言多平台打成一个 zip）、项目备份和导入。
 */
var ST = globalThis.ST || (globalThis.ST = {});

/** 按平台限制压缩：JPG 一点点降质量，直到不超过 maxKB */
ST.encodeLimited = async (canvas, format, maxKB) => {
  if (format === "png") {
    const b = await ST.toBlob(canvas, "image/png");
    return { blob: b, ext: ".png", over: maxKB && b.size > maxKB * 1024 };
  }
  let last = null;
  for (const q of [0.92, 0.86, 0.8, 0.72, 0.64, 0.55, 0.45]) {
    last = await ST.toBlob(canvas, "image/jpeg", q);
    if (!maxKB || last.size <= maxKB * 1024) return { blob: last, ext: ".jpg", q };
  }
  return { blob: last, ext: ".jpg", over: true };
};
const flatten = (c) => {
  const o = ST.canvas(c.width, c.height);
  const g = o.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, o.width, o.height);
  g.drawImage(c, 0, 0);
  return o;
};

/**
 * o = { langs, platforms, long, slices, texts, project（含项目备份）, format, brand, onProgress }
 * 返回 { blob, notes }
 */
ST.exportZip = async (project, o) => {
  const files = [];
  const notes = [];
  const total = o.platforms.length * o.langs.length;
  let n = 0;
  const pad = (i) => String(i + 1).padStart(2, "0");
  for (const pid of o.platforms) {
    const pf = ST.platformOf(project, pid);
    for (const lang of o.langs) {
      const dir = `${ST.safeName(pf.name)}_${pf.w}${pf.h ? "x" + pf.h : ""}/${ST.lang(lang).name}`;
      const canvases = [];
      for (let si = 0; si < project.screens.length; si++) {
        if (o.onProgress) o.onProgress(`${pf.name} · ${ST.lang(lang).name}：第 ${si + 1}/${project.screens.length} 屏`, n / total);
        const r = await ST.renderScreen(project, project.screens[si], { platform: pf, lang, brand: o.brand, forExport: true });
        canvases.push(r.canvas);
      }
      if (o.slices) {
        for (let si = 0; si < canvases.length; si++) {
          const c = canvases[si];
          const parts = !pf.h && pf.sliceH && c.height > pf.sliceH * 1.15 ? Math.ceil(c.height / pf.sliceH) : 1;
          for (let k = 0; k < parts; k++) {
            const h = Math.ceil(c.height / parts);
            const part = ST.canvas(c.width, Math.min(h, c.height - k * h));
            part.getContext("2d").drawImage(c, 0, -k * h);
            const e = await ST.encodeLimited(o.format === "png" ? part : flatten(part), o.format, pf.maxKB);
            const name = `${dir}/切片/${pad(si)}${parts > 1 ? "-" + (k + 1) : ""}${e.ext}`;
            files.push({ name, blob: e.blob });
            if (e.over) notes.push(`${name} 超过 ${pf.maxKB} KB`);
          }
        }
      }
      if (o.long && canvases.length) {
        // 长图：最多 30000 像素一张，超了分成几张
        const W = canvases[0].width;
        const groups = [[]];
        let h = 0;
        for (const c of canvases) {
          if (h + c.height > 30000 && groups[groups.length - 1].length) { groups.push([]); h = 0; }
          groups[groups.length - 1].push(c);
          h += c.height;
        }
        for (let gi = 0; gi < groups.length; gi++) {
          const list = groups[gi];
          const L = ST.canvas(W, list.reduce((a, c) => a + c.height, 0));
          const g = L.getContext("2d");
          let y = 0;
          for (const c of list) { g.drawImage(c, 0, y, W, c.height * (W / c.width)); y += c.height; }
          const e = await ST.encodeLimited(o.format === "png" ? L : flatten(L), o.format, 0);
          files.push({ name: `${dir}/长图${groups.length > 1 ? "-" + (gi + 1) : ""}${e.ext}`, blob: e.blob });
        }
      }
      if (o.texts) {
        const lines = [];
        project.screens.forEach((sc, si) => {
          lines.push(`【第 ${si + 1} 屏 · ${ST.TPL[sc.tpl].name}】`);
          for (const t of ST.screenTexts(project, sc, lang)) lines.push(`${t.id}：${t.text}`);
          lines.push("");
        });
        files.push({ name: `${dir}/文案.txt`, blob: new Blob(["﻿" + lines.join("\r\n")], { type: "text/plain" }) });
      }
      n++;
    }
  }
  if (o.project) {
    const pack = await ST.packProject(project);
    files.push({ name: `项目备份_${ST.safeName(project.name)}.aitutu.zip`, blob: pack });
  }
  if (notes.length) files.push({ name: "注意.txt", blob: new Blob(["﻿以下图片压到最低质量还是超过平台大小限制，上传前请检查：\r\n" + notes.join("\r\n")], { type: "text/plain" }) });
  if (o.onProgress) o.onProgress("打包 zip…", 1);
  return { blob: await ST.makeZip(files), notes, count: files.length, files };
};

/** 项目备份：project.json + 所有图片 */
ST.packProject = async (project) => {
  const files = [{ name: "project.json", blob: new Blob([JSON.stringify({ app: "aitutu-studio", version: ST.VERSION, project })], { type: "application/json" }) }];
  const keys = await ST.db.blobKeys(project.id + ":");
  for (const k of keys) {
    const b = await ST.db.getBlob(k);
    const ext = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" }[b && b.type] || ".bin";
    if (b) files.push({ name: "blobs/" + encodeURIComponent(k.slice(project.id.length + 1)) + ext, blob: b });
  }
  return ST.makeZip(files);
};
/** 导入项目备份：换一个新编号，图片一起存进来 */
ST.unpackProject = async (zipBlob) => {
  const files = await ST.readZip(zipBlob);
  const pj = files.find((f) => f.name === "project.json");
  if (!pj) throw new Error("这不是详情页工作室的项目备份（里面没有 project.json）");
  const data = JSON.parse(await pj.blob.text());
  if (!data || data.app !== "aitutu-studio" || !data.project) throw new Error("项目备份格式不对");
  const old = data.project.id;
  const id = ST.uid("p");
  const p = JSON.parse(JSON.stringify(data.project).split(`"${old}:`).join(`"${id}:`));
  p.id = id;
  p.name = (p.name || "导入的项目") + "（导入）";
  for (const f of files) {
    if (!f.name.startsWith("blobs/")) continue;
    const k = decodeURIComponent(f.name.slice(6).replace(/\.(png|jpg|webp|bin)$/, ""));
    await ST.db.putBlob(`${id}:${k}`, f.blob);
  }
  await ST.db.putProject(p);
  return p;
};
