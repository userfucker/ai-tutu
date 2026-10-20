/**
 * 详情页 · 存取（网页版）：项目、图片、设置都存在工作台服务器上。
 * 接口和插件版（IndexedDB）一样：ST.db.getProject / putProject / listProjects / putBlob / getBlob …
 * 项目保存时带上版本号（rev），服务器上的版本对不上（别处改过、全自动在做）就会拒绝。
 */
var ST = globalThis.ST || (globalThis.ST = {});

ST.db = (() => {
  const revs = new Map(); // 项目编号 → 服务器上的版本号
  const j = async (method, url, body) => {
    const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
    let d = null;
    try { d = await r.json(); } catch {}
    if (r.status === 401) { location.href = "/"; throw new Error("请先登录"); }
    if (!r.ok) throw Object.assign(new Error((d && d.error) || `出错了（${r.status}）`), { conflict: !!(d && d.conflict), status: r.status });
    return d;
  };
  const bk = (key) => "/api/blobs/" + encodeURIComponent(key);
  return {
    getProject: async (id) => {
      try { const d = await j("GET", "/api/projects/" + encodeURIComponent(id)); revs.set(id, d.project.rev || 0); return d.project; }
      catch (e) { if (e.status === 404) return null; throw e; }
    },
    putProject: async (p) => {
      const d = await j("PUT", "/api/projects/" + encodeURIComponent(p.id), { project: p, rev: revs.has(p.id) ? revs.get(p.id) : null });
      revs.set(p.id, d.rev);
      p.rev = d.rev;
      return d.rev;
    },
    listProjects: async () => (await j("GET", "/api/projects")).list,
    deleteProject: (id) => j("DELETE", "/api/projects/" + encodeURIComponent(id)),
    putBlob: async (key, blob) => {
      const r = await fetch(bk(key), { method: "PUT", headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob, credentials: "same-origin" });
      if (!r.ok) throw new Error("图片上传失败（" + r.status + "）");
      ST.blobVer[key] = Date.now();
    },
    getBlob: async (key) => {
      if (!key) return null;
      const r = await fetch(bk(key) + "?v=" + (ST.blobVer[key] || 0), { credentials: "same-origin" });
      return r.ok ? await r.blob() : null;
    },
    delBlob: (key) => fetch(bk(key), { method: "DELETE", credentials: "same-origin" }),
    blobKeys: async (prefix) => (await j("GET", "/api/blobs?prefix=" + encodeURIComponent(prefix))).keys,
    getMeta: async (k, def) => { const d = await j("GET", "/api/meta/" + encodeURIComponent(k)); return d.value === null || d.value === undefined ? def : d.value; },
    setMeta: (k, v) => j("PUT", "/api/meta/" + encodeURIComponent(k), { value: v }),
    rev: (id) => revs.get(id),
    setRev: (id, r) => revs.set(id, r),
  };
})();

// 图片：直接用服务器地址（同源，可以画到画布上导出）；改过的图换一个 ?v= 避免读到旧的
ST.blobVer = {};
ST.imgCache = new Map();
ST.urlFor = (key) => (key ? "/api/blobs/" + encodeURIComponent(key) + "?v=" + (ST.blobVer[key] || 0) : "");
ST.imgOf = (key) => {
  if (!key) return Promise.resolve(null);
  const ck = key + "|" + (ST.blobVer[key] || 0);
  if (!ST.imgCache.has(ck)) ST.imgCache.set(ck, ST.loadImage(ST.urlFor(key)).catch(() => null));
  return ST.imgCache.get(ck);
};
ST.urlOf = async (key) => ST.urlFor(key);
ST.forget = (key) => { for (const k of [...ST.imgCache.keys()]) if (k.startsWith(key + "|")) ST.imgCache.delete(k); };
ST.saveImage = async (key, blob) => { ST.forget(key); await ST.db.putBlob(key, blob); return key; };
