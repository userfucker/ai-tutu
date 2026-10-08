#!/usr/bin/env node
/**
 * agy 生图测试：一键智能产品精修（2026-10-08）
 *
 * 用法（在 Ubuntu 22 桌面上、已经登录过 agy 的那个系统账号下）：
 *   node server.js
 * 然后用浏览器打开 http://127.0.0.1:5260
 *
 * 为什么还要这个文件：浏览器不能直接运行 agy，所以需要一个本地小程序帮网页
 * 调 agy。它只用 Node 自带的模块，不用 npm install，也没有数据库。
 *
 * 调 agy 的方式照搬 Claude Code WebUI（backend/handlers/geminiChat.ts）：
 *   agy --input-format stream-json --output-format stream-json
 *       --dangerously-skip-permissions --disable-slash-commands [--model <id>]
 *   消息从标准输入发一行：{"event":"user","message":{"content":"<消息>"}}
 * 生成的图片在 ~/.gemini/antigravity-cli/brain/<conversation_id>/ 里，
 * 协议和回复里都不给路径，所以跑完后去这个目录收图片。
 *
 * 环境变量（都可以不设）：
 *   PORT=5260              端口
 *   HOST=127.0.0.1         只允许本机访问；设成 0.0.0.0 才能从局域网其他电脑打开
 *                          （注意：能打开页面的人就能让 agy 在这台电脑上执行操作）
 *   AGY_PATH=/path/to/agy  指定 agy 路径（默认自动查找）
 *   AGY_TIMEOUT_SEC=600    每张图最长等多少秒，超时就结束 agy 进程
 */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn, execFile } = require("node:child_process");
const readline = require("node:readline");

const PORT = Number(process.env.PORT) || 5260;
const HOST = process.env.HOST || "127.0.0.1";
const TIMEOUT_MS = (Number(process.env.AGY_TIMEOUT_SEC) || 600) * 1000;
const MAX_BODY_BYTES = 40 * 1024 * 1024; // 单张图 base64 后的上限
const ROOT = __dirname;
const RUNS_DIR = path.join(ROOT, "runs");
const BRAIN_ROOT = path.join(os.homedir(), ".gemini", "antigravity-cli", "brain");
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".txt": "text/plain; charset=utf-8",
  ".ndjson": "text/plain; charset=utf-8",
};

// ---------------------------------------------------------------- 工具函数

/** 北京时间，格式 2026-10-08 15:04:05（不管这台电脑设的是哪个时区）。 */
function beijingTime(ms = Date.now()) {
  const d = new Date(ms + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

function isExecutableFile(p) {
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function askShell(flags) {
  return new Promise((resolve) => {
    execFile("bash", [flags, "command -v agy"], { timeout: 5000 }, (err, out) => {
      const found = String(out || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith("/"))
        .pop();
      resolve(!err && found && isExecutableFile(found) ? found : undefined);
    });
  });
}

let cachedAgyPath;
/** 找 agy 的绝对路径（跟 WebUI 的 resolveAgyPath 一样的顺序）。 */
async function resolveAgyPath() {
  if (process.env.AGY_PATH) return process.env.AGY_PATH;
  if (cachedAgyPath && isExecutableFile(cachedAgyPath)) return cachedAgyPath;
  const home = os.homedir();
  const candidates = [
    ...(process.env.PATH || "").split(path.delimiter).filter(Boolean).map((d) => path.join(d, "agy")),
    path.join(home, ".local", "bin", "agy"),
    path.join(home, ".antigravity", "bin", "agy"),
    path.join(home, ".antigravity-cli", "bin", "agy"),
    path.join(home, ".gemini", "antigravity-cli", "bin", "agy"),
    path.join(home, "bin", "agy"),
    path.join(home, ".npm-global", "bin", "agy"),
    "/usr/local/bin/agy",
    "/opt/antigravity/bin/agy",
    "/snap/bin/agy",
  ];
  let found = candidates.find(isExecutableFile);
  if (!found) found = await askShell("-lc");
  if (!found) found = await askShell("-ic");
  if (!found) return null;
  cachedAgyPath = found;
  return found;
}

/** 解析 `agy models` 的两列纯文本：模型 ID + 显示名（照搬 WebUI）。 */
function parseAgyModels(text) {
  const models = [];
  const seen = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\u001b\[[0-9;]*m/g, "").trim();
    if (!line || /[:：]$/.test(line)) continue;
    const m = /^(\S+)(?:\s+(.*))?$/.exec(line);
    const id = (m && m[1]) || "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(id) || id.endsWith(":")) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    models.push({ id, name: (m[2] || "").trim() || id });
  }
  return models;
}

let modelsCache = null; // { at, agyPath, models }
async function listModels(refresh) {
  if (!refresh && modelsCache && Date.now() - modelsCache.at < 5 * 60 * 1000) {
    return modelsCache;
  }
  const agyPath = await resolveAgyPath();
  if (!agyPath) {
    throw new Error(
      "找不到 agy。请在终端执行 `which agy` 查到完整路径，然后这样启动：AGY_PATH=<那个路径> node server.js",
    );
  }
  const models = await new Promise((resolve, reject) => {
    execFile(agyPath, ["models"], { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, out, errOut) => {
      if (err) {
        reject(new Error(`执行 agy models 失败：${err.message}${errOut ? `（${String(errOut).trim()}）` : ""}`));
        return;
      }
      const list = parseAgyModels(String(out));
      if (list.length === 0) reject(new Error("agy models 没有返回任何可识别的模型：" + String(out).slice(0, 500)));
      else resolve(list);
    });
  });
  modelsCache = { at: Date.now(), agyPath, models };
  return modelsCache;
}

async function listImages(dir) {
  try {
    const names = await fsp.readdir(dir);
    const out = [];
    for (const name of names) {
      if (!IMAGE_EXTS.has(path.extname(name).toLowerCase())) continue;
      const full = path.join(dir, name);
      const st = await fsp.stat(full).catch(() => null);
      if (st && st.isFile()) out.push({ name, full, mtimeMs: st.mtimeMs, size: st.size });
    }
    return out.sort((a, b) => a.mtimeMs - b.mtimeMs);
  } catch {
    return [];
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("图片太大（超过 40MB）"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

// ---------------------------------------------------------------- 精修一张图

/**
 * 跑一次 agy 精修一张图，进度一行一个 JSON 写回浏览器（NDJSON）：
 *   {type:"start", runId, agyPath, args}
 *   {type:"init", conversationId, tools}
 *   {type:"tool", name, parameters, state}
 *   {type:"text", text}                 agy 的回复文字（增量）
 *   {type:"done", ...}                  结束（成功或失败都只发一次）
 */
async function handleRefine(req, res) {
  let body;
  try {
    body = JSON.parse((await readBody(req)).toString("utf8"));
  } catch (e) {
    sendJson(res, 400, { error: "请求内容不对：" + e.message });
    return;
  }
  const { fileName = "image.png", imageBase64, prompt, model } = body || {};
  if (!imageBase64 || !prompt) {
    sendJson(res, 400, { error: "缺少图片或提示词" });
    return;
  }

  const agyPath = await resolveAgyPath();
  if (!agyPath) {
    sendJson(res, 500, { error: "找不到 agy，请用 AGY_PATH=<路径> node server.js 启动" });
    return;
  }

  // 每张图一个独立目录：runs/<北京时间>-<随机>/
  const stamp = beijingTime().replace(/[-: ]/g, "").replace(/^(\d{8})/, "$1-");
  const runId = `${stamp}-${crypto.randomBytes(3).toString("hex")}`;
  const runDir = path.join(RUNS_DIR, runId);
  const outDir = path.join(runDir, "out");
  await fsp.mkdir(outDir, { recursive: true });
  let ext = path.extname(String(fileName)).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) ext = ".png";
  const inputPath = path.join(runDir, "input" + ext);
  await fsp.writeFile(inputPath, Buffer.from(String(imageBase64), "base64"));

  const message = String(prompt).split("{{图片路径}}").join(inputPath);
  await fsp.writeFile(path.join(runDir, "prompt.txt"), message);

  const args = [
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--dangerously-skip-permissions",
    "--disable-slash-commands",
  ];
  if (model) args.push("--model", String(model));

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
  });
  const send = (obj) => {
    if (!res.writableEnded) res.write(JSON.stringify(obj) + "\n");
  };

  const startedAt = Date.now();
  send({ type: "start", runId, agyPath, args, startedAt: beijingTime(startedAt) });

  const rawLog = fs.createWriteStream(path.join(runDir, "agy-output.ndjson"));
  const child = spawn(agyPath, args, {
    cwd: runDir,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true, // 结束时连 agy 的子进程一起结束
  });
  child.stdin.on("error", () => {});
  child.stdin.end(JSON.stringify({ event: "user", message: { content: message } }) + "\n");

  let finished = false;
  let killedReason = "";
  const killChild = (reason) => {
    if (child.exitCode !== null || killedReason) return;
    killedReason = reason;
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
    setTimeout(() => {
      if (child.exitCode === null) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      }
    }, 5000).unref();
  };
  const timer = setTimeout(() => killChild(`超时（超过 ${TIMEOUT_MS / 1000} 秒）`), TIMEOUT_MS);
  // 浏览器点了"停止"或关掉页面
  res.on("close", () => {
    if (!finished) killChild("浏览器取消");
  });

  let stderrTail = "";
  child.stderr.on("data", (c) => {
    stderrTail = (stderrTail + c.toString("utf8")).slice(-4000);
  });

  let conversationId = "";
  let result = null;
  let firstImageToolAt = 0;
  const toolCalls = [];
  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    rawLog.write(line + "\n");
    const t = line.trim();
    if (!t.startsWith("{")) return;
    let ev;
    try { ev = JSON.parse(t); } catch { return; }
    if (ev.event === "init") {
      conversationId = ev.conversation_id || conversationId;
      send({ type: "init", conversationId, tools: (ev.init && ev.init.tools) || [] });
    } else if (ev.event === "step_update" && ev.step_update) {
      const s = ev.step_update;
      if (!conversationId && s.conversation_id) conversationId = s.conversation_id;
      if (s.step_type === "agent_response" && s.text_delta) {
        send({ type: "text", text: s.text_delta });
      } else if (s.step_type === "tool") {
        const name = s.tool_name || (s.tool_info && s.tool_info.name) || "";
        const parameters = (s.tool_info && s.tool_info.parameters) || undefined;
        if (s.state === "ACTIVE" && name === "generate_image" && !firstImageToolAt) {
          firstImageToolAt = Date.now();
        }
        if (s.state === "ACTIVE" || s.state === "DONE") {
          const item = {
            name,
            state: s.state,
            parameters,
            seconds: s.duration_seconds,
            at: Math.round((Date.now() - startedAt) / 100) / 10,
          };
          if (s.state === "DONE") toolCalls.push(item);
          send({ type: "tool", ...item });
        }
      }
    } else if (ev.event === "result") {
      result = ev.result || {};
      if (!conversationId && result.conversation_id) conversationId = result.conversation_id;
    }
  });

  const exitCode = await new Promise((resolve) => {
    child.on("close", (code) => resolve(code));
    child.on("error", (err) => {
      stderrTail += "\n" + err.message;
      resolve(null);
    });
  });
  clearTimeout(timer);
  rawLog.end();
  const endedAt = Date.now();

  // 收图：brain/<conversation_id>/ 里的图片 + 工作目录里 agy 自己写的图片（除了原图）
  const found = [];
  if (conversationId && /^[A-Za-z0-9._-]+$/.test(conversationId)) {
    found.push(...(await listImages(path.join(BRAIN_ROOT, conversationId))));
  }
  for (const img of await listImages(runDir)) {
    if (img.full !== inputPath) found.push(img);
  }
  const images = [];
  let i = 0;
  for (const img of found) {
    i += 1;
    const name = `${String(i).padStart(2, "0")}-${img.name}`;
    await fsp.copyFile(img.full, path.join(outDir, name)).catch(() => {});
    images.push({
      url: `/runs/${runId}/out/${encodeURIComponent(name)}`,
      fileName: img.name,
      bytes: img.size,
      readyAfterSec: Math.round((img.mtimeMs - startedAt) / 100) / 10,
    });
  }

  let error = "";
  if (killedReason) error = "已结束 agy：" + killedReason;
  else if (!result) error = `agy 没有正常结束（退出码 ${exitCode}）`;
  else if (result.status && result.status !== "SUCCESS") error = `agy 返回状态 ${result.status}`;
  if (!error && images.length === 0) error = "agy 跑完了，但没有找到生成的图片";

  const done = {
    type: "done",
    ok: !error,
    error,
    runId,
    runDir,
    conversationId,
    exitCode,
    wallSeconds: Math.round((endedAt - startedAt) / 100) / 10,
    firstImageToolAfterSec: firstImageToolAt ? Math.round((firstImageToolAt - startedAt) / 100) / 10 : null,
    agyStatus: result && result.status,
    agySeconds: result && result.duration_seconds,
    usage: result && result.usage,
    response: (result && result.response) || "",
    resultError: result && result.error,
    toolCalls,
    images,
    stderrTail: stderrTail.trim().slice(-2000),
    prompt: message,
    model: model || "",
    finishedAt: beijingTime(endedAt),
  };
  await fsp.writeFile(path.join(runDir, "result.json"), JSON.stringify(done, null, 2)).catch(() => {});
  finished = true;
  send(done);
  res.end();
  console.log(
    `[${beijingTime()}] ${runId} ${done.ok ? "成功" : "失败"} ${done.wallSeconds}s 图片 ${images.length} 张${error ? " " + error : ""}`,
  );
}

// ---------------------------------------------------------------- 静态文件

async function serveFile(res, filePath) {
  try {
    const st = await fsp.stat(filePath);
    if (!st.isFile()) throw new Error("not file");
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": "no-store",
    });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": MIME[".txt"] });
    res.end("没有这个文件");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const p = decodeURIComponent(url.pathname);
    if (req.method === "GET" && (p === "/" || p === "/index.html")) {
      await serveFile(res, path.join(ROOT, "index.html"));
    } else if (req.method === "GET" && p === "/api/models") {
      try {
        const r = await listModels(url.searchParams.get("refresh") === "1");
        sendJson(res, 200, { agyPath: r.agyPath, models: r.models, checkedAt: beijingTime(r.at) });
      } catch (e) {
        sendJson(res, 500, { error: e.message });
      }
    } else if (req.method === "POST" && p === "/api/refine") {
      await handleRefine(req, res);
    } else if (req.method === "GET" && p.startsWith("/runs/")) {
      // 只允许读 runs/ 目录里面的文件
      const full = path.resolve(RUNS_DIR, "." + p.slice("/runs".length));
      if (!full.startsWith(RUNS_DIR + path.sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      await serveFile(res, full);
    } else {
      res.writeHead(404, { "Content-Type": MIME[".txt"] });
      res.end("没有这个页面");
    }
  } catch (e) {
    if (!res.headersSent) sendJson(res, 500, { error: e.message });
    else res.end();
  }
});
server.requestTimeout = 0; // 一张图可能要好几分钟
server.headersTimeout = 60 * 1000;

server.listen(PORT, HOST, () => {
  console.log(`[${beijingTime()}] agy 产品精修测试已启动：http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}`);
  console.log(`结果保存在：${RUNS_DIR}`);
  if (HOST !== "127.0.0.1" && HOST !== "localhost") {
    console.log("注意：现在局域网里的其他电脑也能打开这个页面，并让 agy 在这台电脑上执行操作。");
  }
});
