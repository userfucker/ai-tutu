// 小工具：从 AI 回复里取 JSON、转义、日期、北京时间
export function extractJson(text, codes = []) {
  const tryParse = (s) => {
    if (!s) return undefined;
    const start = s.search(/[{[]/);
    if (start < 0) return undefined;
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") { depth--; if (depth === 0) { end = i; break; } }
    }
    const body = s.slice(start, end < 0 ? s.length : end + 1);
    for (const fix of [(x) => x, (x) => x.replace(/,\s*([}\]])/g, "$1"), (x) => x.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, "$1")]) {
      try { return JSON.parse(fix(body)); } catch {}
    }
    return undefined;
  };
  // markdown 里的 ```json 代码块优先
  const fences = [...String(text || "").matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  for (const c of [...codes, ...fences]) { const v = tryParse(c); if (v !== undefined) return v; }
  const v = tryParse(String(text || ""));
  if (v !== undefined) return v;
  throw new Error("AI 的回复里没找到能用的 JSON：" + String(text || "").slice(0, 120));
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** 评价日期：2026-09-12 / 2026年09月12日 / 2026.9.12 → 毫秒；认不出返回 0 */
export function parseDate(s) {
  const m = /(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})/.exec(String(s || ""));
  if (!m) return 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

/** 北京时间 */
export function bj(ms = Date.now(), withSec = false) {
  const d = new Date(ms + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}${withSec ? ":" + p(d.getUTCSeconds()) : ""}`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
