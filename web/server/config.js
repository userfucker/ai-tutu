// 工作台配置：端口、数据目录。可以用环境变量改：PORT、DATA_DIR
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const WEB_DIR = path.resolve(here, "..");
export const REPO_DIR = path.resolve(WEB_DIR, "..");
export const PUBLIC_DIR = path.join(WEB_DIR, "public");
export const FONT_DIR = path.join(WEB_DIR, "fonts");
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(WEB_DIR, "data"));
export const FILES_DIR = path.join(DATA_DIR, "files");
export const PORT = Number(process.env.PORT || 8766);
export const HOST = process.env.HOST || "0.0.0.0";
export const VERSION = JSON.parse(fs.readFileSync(path.join(WEB_DIR, "package.json"), "utf8")).version;

fs.mkdirSync(FILES_DIR, { recursive: true });
