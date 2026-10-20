// 数据库（SQLite，data/workbench.sqlite）：设置、任务队列、竞品分析、详情页项目
import Database from "better-sqlite3";
import path from "node:path";
import { DATA_DIR } from "./config.js";

export const db = new Database(path.join(DATA_DIR, "workbench.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

db.exec(`
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE,
  kind TEXT NOT NULL,
  label TEXT,
  owner_type TEXT, owner_id TEXT,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  site TEXT, worker TEXT,
  result TEXT, error TEXT, progress TEXT,
  attempts INTEGER DEFAULT 0, max_attempts INTEGER DEFAULT 2,
  priority INTEGER DEFAULT 0,
  not_before INTEGER DEFAULT 0,
  created INTEGER, started INTEGER, finished INTEGER
);
CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS tasks_owner ON tasks(owner_type, owner_id);
CREATE TABLE IF NOT EXISTS analyses (id TEXT PRIMARY KEY, name TEXT, status TEXT, data TEXT, created INTEGER, updated INTEGER);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, status TEXT, data TEXT, created INTEGER, updated INTEGER);
`);

const kvGetStmt = db.prepare("SELECT value FROM kv WHERE key = ?");
const kvSetStmt = db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
export function kvGet(key, def = null) {
  const r = kvGetStmt.get(key);
  if (!r) return def;
  try { return JSON.parse(r.value); } catch { return def; }
}
export function kvSet(key, value) { kvSetStmt.run(key, JSON.stringify(value)); }

export const uid = (p = "") => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
