/**
 * 素材中心 → 主图制作 / 详情页：把选中的图放进新项目或已有项目（Lee 2026-10-24：每次弹框选“新建”还是已有项目）。
 * 图片复制一份进项目（素材中心删了也不影响项目），并记下“用在了哪个项目”。
 */
import * as lib from "./library.js";
import * as store from "./detail/store.js";
import * as mainImg from "./main/index.js";
import { newProject as newDetail } from "./detail/importer.js";
import { getST } from "./detail/runtime.js";
import { projectName } from "./naming.js";

/** 素材中心的类型 → 详情页素材的标签 */
const DETAIL_TAG = { 白底图: "white", SKU图: "spec", 详情图: "other", 主图: "angle", 原图: "other", "AI 生成": "other" };

export async function send(b) {
  const ST = getST();
  const ids = (b.ids || []).filter((id) => lib.get(id));
  if (!ids.length) throw new Error("先选图片");
  if (b.to === "main") {
    let p = b.projectId ? store.getProject(b.projectId) : null;
    if (b.projectId && (!p || p.kind !== "main")) throw new Error("没有这个主图项目");
    if (!p) { p = mainImg.newProject({ name: projectName("main", b.name), fixedName: true }); store.putProject(p); }
    for (const id of ids) {
      const f = lib.read(id);
      const prid = ST.uid("pr");
      const key = `${p.id}:${prid}-orig`;
      store.putBlob(key, f.buf, f.mime);
      await mainImg.op(p.id, { op: "addProduct", id: prid, key, name: f.row.name, fromLibrary: true });
    }
    lib.markUsed(ids, { type: "main", id: p.id, name: p.name });
    return { projectId: p.id, name: store.getProject(p.id).name, url: `/main/#p=${encodeURIComponent(p.id)}` };
  }
  if (b.to === "detail") {
    let p = b.projectId ? store.getProject(b.projectId) : null;
    if (b.projectId && (!p || p.kind === "main")) throw new Error("没有这个详情页项目");
    if (!p) { p = newDetail({ name: projectName("detail", b.name) }); p.fixedName = true; }
    for (const id of ids) {
      const f = lib.read(id);
      const aid = ST.uid("a");
      const key = `${p.id}:${aid}-orig`;
      store.putBlob(key, f.buf, f.mime);
      const img = await ST.imgOf(key);
      const white = img ? ST.edgeIsWhite(img) : false;
      p.assets.push({ id: aid, name: f.row.name, tag: DETAIL_TAG[f.row.tag] === "other" && white ? "white" : DETAIL_TAG[f.row.tag] || "other", note: "", group: "", key, w: f.row.w, h: f.row.h, white: "", cut: "", cutBox: null, edgeWhite: white });
    }
    store.putProject(p);
    lib.markUsed(ids, { type: "detail", id: p.id, name: p.name });
    return { projectId: p.id, name: p.name, url: `/detail/#p=${encodeURIComponent(p.id)}` };
  }
  throw new Error("不知道发到哪里：" + b.to);
}

/** 打包下载选中的图 */
export async function zip(ids) {
  const ST = getST();
  const files = [];
  const names = new Set();
  for (const id of ids || []) {
    const f = lib.read(id);
    if (!f) continue;
    let name = f.row.name;
    for (let k = 2; names.has(name); k++) name = f.row.name.replace(/(\.\w+)?$/, `(${k})$1`);
    names.add(name);
    files.push({ name, blob: new Blob([f.buf], { type: f.mime }) });
  }
  const blob = await ST.makeZip(files);
  return Buffer.from(await blob.arrayBuffer());
}
