/**
 * 详情页工作室 · 本机存储（浏览器 IndexedDB）
 *  projects：项目（文字、排版、设置，不含图片）
 *  blobs：图片，键名“项目编号:xxx”，删项目时一起删；品牌 logo 用“brand:xxx”
 *  meta：品牌、我的模板、设置
 * 以后做网页版，换成存服务器，接口保持一样。
 */
var ST = globalThis.ST || (globalThis.ST = {});

ST.db = (() => {
  let dbp = null;
  const open = () => (dbp = dbp || new Promise((resolve, reject) => {
    const req = indexedDB.open("aitutu-studio", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("projects");
      db.createObjectStore("blobs");
      db.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const tx = async (store, mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      let out;
      const r = fn(t.objectStore(store));
      if (r && "onsuccess" in r) r.onsuccess = () => (out = r.result);
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("存储失败（可能是磁盘空间不够）"));
    });
  };
  return {
    getProject: (id) => tx("projects", "readonly", (s) => s.get(id)),
    putProject: (p) => { p.updated = Date.now(); return tx("projects", "readwrite", (s) => s.put(p, p.id)); },
    listProjects: async () => {
      const all = (await tx("projects", "readonly", (s) => s.getAll())) || [];
      return all.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    },
    deleteProject: async (id) => {
      await tx("projects", "readwrite", (s) => s.delete(id));
      await tx("blobs", "readwrite", (s) => s.delete(IDBKeyRange.bound(id + ":", id + ":￿")));
    },
    putBlob: (key, blob) => tx("blobs", "readwrite", (s) => s.put(blob, key)),
    getBlob: (key) => (key ? tx("blobs", "readonly", (s) => s.get(key)) : Promise.resolve(null)),
    delBlob: (key) => tx("blobs", "readwrite", (s) => s.delete(key)),
    blobKeys: (prefix) => tx("blobs", "readonly", (s) => s.getAllKeys(IDBKeyRange.bound(prefix, prefix + "￿"))),
    getMeta: async (k, def) => { const v = await tx("meta", "readonly", (s) => s.get(k)); return v === undefined ? def : v; },
    setMeta: (k, v) => tx("meta", "readwrite", (s) => s.put(v, k)),
  };
})();

// 图片缓存：同一个键只读一次、只解码一次
ST.imgCache = new Map(); // key → Promise<HTMLImageElement|null>
ST.urlCache = new Map(); // key → objectURL
ST.imgOf = (key) => {
  if (!key) return Promise.resolve(null);
  if (!ST.imgCache.has(key)) {
    ST.imgCache.set(key, ST.db.getBlob(key).then(async (b) => {
      if (!b) return null;
      const url = URL.createObjectURL(b);
      ST.urlCache.set(key, url);
      const img = await ST.loadImage(url);
      return img;
    }).catch(() => null));
  }
  return ST.imgCache.get(key);
};
ST.urlOf = async (key) => { await ST.imgOf(key); return ST.urlCache.get(key) || ""; };
ST.forget = (key) => {
  ST.imgCache.delete(key);
  const u = ST.urlCache.get(key);
  if (u) { URL.revokeObjectURL(u); ST.urlCache.delete(key); }
};
ST.saveImage = async (key, blob) => { ST.forget(key); await ST.db.putBlob(key, blob); return key; };
