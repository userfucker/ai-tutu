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
 * 2026-10-08 实测：generate_image 的参数是 ImageName、Prompt、AspectRatio、
 * ImagePaths（参考图），没有清晰度参数，1:1 出图是 1024×1024。agy 有时自己调，
 * 有时委派给内部子智能体 image-generator（输出里 step_type 是 "subagent"）。
 * 为了不让它到处翻文件：工作目录是系统临时目录里只放原图的空目录；
 * 并且盯着每一步工具调用，越权就立刻结束（见 ALLOWED_TOOLS）。
 * 同一天第二轮实测：agy 自己直接调 generate_image（带 ImagePaths）没出图，
 * 委派 image-generator 才稳定出图，所以页面固定用委派；图片一落盘就结束 agy。
 *
 * 环境变量（都可以不设）：
 *   PORT=5260              端口
 *   HOST=127.0.0.1         只允许本机访问；设成 0.0.0.0（或者加参数 --lan）才能
 *                          从别的电脑打开，比如 VMware 外面的物理机
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
const HOST = process.argv.includes("--lan") ? "0.0.0.0" : process.env.HOST || "127.0.0.1";
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
 * 允许 agy 用的工具（2026-10-08 实测后定的）。看原图、生图、委派生图子智能体，
 * 以及等子智能体时可能用到的几个"等待/收消息"类工具；其余一律算越权。
 * view_file 只允许看原图和这次会话自己生成的图片。
 */
const ALLOWED_TOOLS = new Set([
  "view_file",
  "generate_image",
  "invoke_subagent",
  "finish",
  "wait",
  "wait_5_seconds",
  "manage_inbox",
  "manage_subagents",
]);

/** 在会话记录里找 generate_image 的实际参数（委派模式下它在子智能体的会话里）。 */
async function findGenerateImageCalls(startedAt, inputPath) {
  const calls = [];
  let dirs = [];
  try {
    dirs = await fsp.readdir(BRAIN_ROOT);
  } catch {
    return calls;
  }
  for (const d of dirs) {
    const dir = path.join(BRAIN_ROOT, d);
    const st = await fsp.stat(dir).catch(() => null);
    if (!st || !st.isDirectory() || st.mtimeMs < startedAt - 5000) continue;
    const file = path.join(dir, ".system_generated", "logs", "transcript_full.jsonl");
    const text = await fsp.readFile(file, "utf8").catch(() => "");
    if (!text.includes("generate_image") || !text.includes(inputPath)) continue;
    for (const line of text.split("\n")) {
      if (!line.includes('"generate_image"')) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      const walk = (v) => {
        if (!v || typeof v !== "object") return;
        if (Array.isArray(v)) return v.forEach(walk);
        if (v.name === "generate_image" && v.args && typeof v.args === "object") {
          const args = {};
          for (const [k, val] of Object.entries(v.args)) {
            if (/^tool(Action|Summary)$/.test(k)) continue;
            // 有的版本把参数值再 JSON 编码一次（"\"ls -la\""），解开
            if (typeof val === "string" && /^["[{]/.test(val)) {
              try { args[k] = JSON.parse(val); continue; } catch {}
            }
            args[k] = val;
          }
          if (JSON.stringify(args).includes(inputPath)) calls.push({ conversationId: d, args });
          return;
        }
        Object.values(v).forEach(walk);
      };
      walk(obj);
    }
  }
  return calls;
}

/**
 * 跑一次 agy 精修一张图，进度一行一个 JSON 写回浏览器（NDJSON）：
 *   {type:"start", runId, agyPath, args, inputPath}
 *   {type:"init", conversationId, tools}
 *   {type:"tool", name, parameters, state, at}   普通工具和委派子智能体都走这个
 *   {type:"violation", name, detail}             越权，马上结束 agy
 *   {type:"text", text}                          agy 的回复文字（增量）
 *   {type:"done", ...}                           结束（只发一次）
 */
async function handleRefine(req, res) {
  let body;
  try {
    body = JSON.parse((await readBody(req)).toString("utf8"));
  } catch (e) {
    sendJson(res, 400, { error: "请求内容不对：" + e.message });
    return;
  }
  const { fileName = "image.png", imageBase64, prompt, model, guard = true } = body || {};
  if (!imageBase64 || !prompt) {
    sendJson(res, 400, { error: "缺少图片或提示词" });
    return;
  }

  const agyPath = await resolveAgyPath();
  if (!agyPath) {
    sendJson(res, 500, { error: "找不到 agy，请用 AGY_PATH=<路径> node server.js 启动" });
    return;
  }

  // 结果目录：runs/<北京时间>-<随机>/（提示词、日志、结果都在这里，agy 看不到）
  const stamp = beijingTime().replace(/[-: ]/g, "").replace(/^(\d{8})/, "$1-");
  const runId = `${stamp}-${crypto.randomBytes(3).toString("hex")}`;
  const runDir = path.join(RUNS_DIR, runId);
  const outDir = path.join(runDir, "out");
  await fsp.mkdir(outDir, { recursive: true });
  let ext = path.extname(String(fileName)).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) ext = ".png";
  const imageBytes = Buffer.from(String(imageBase64), "base64");
  await fsp.writeFile(path.join(runDir, "input" + ext), imageBytes);

  // agy 的工作目录：系统临时目录里一个空目录，只放这一张原图
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ai-tutu-agy-"));
  const inputPath = path.join(workDir, "product" + ext);
  await fsp.writeFile(inputPath, imageBytes);

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
  const sec = (ms) => Math.round(ms / 100) / 10;
  send({ type: "start", runId, agyPath, args, inputPath, startedAt: beijingTime(startedAt) });

  const rawLog = fs.createWriteStream(path.join(runDir, "agy-output.ndjson"));
  const child = spawn(agyPath, args, {
    cwd: workDir,
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

  // 图片一落盘就结束 agy：后面它只是等子智能体回复、写总结，白白多等 20 秒左右。
  // 每秒看一次主会话的 brain 目录，图片大小连续两次不变（写完了）就结束。
  let earlyStop = false;
  let lastSeen = "";
  const watcher = setInterval(async () => {
    if (!conversationId || killedReason || !/^[A-Za-z0-9._-]+$/.test(conversationId)) return;
    const imgs = (await listImages(path.join(BRAIN_ROOT, conversationId))).filter(
      (x) => x.mtimeMs >= startedAt - 5000 && x.size > 0,
    );
    if (!imgs.length) return;
    const key = imgs.map((x) => `${x.name}:${x.size}`).join("|");
    if (key === lastSeen) {
      earlyStop = true;
      clearInterval(watcher);
      killChild("已拿到图片，提前结束");
    }
    lastSeen = key;
  }, 1000);

  let stderrTail = "";
  child.stderr.on("data", (c) => {
    stderrTail = (stderrTail + c.toString("utf8")).slice(-4000);
  });

  let conversationId = "";
  let result = null;
  let genStartAt = 0; // 第一次调用 generate_image 或委派 image-generator 的时刻
  let violation = null;
  const toolCalls = [];

  /** 检查一次工具调用是否越权，越权返回原因。 */
  const checkTool = (name, parameters, subagents) => {
    if (!ALLOWED_TOOLS.has(name)) return `调用了不允许的工具 ${name}`;
    if (name === "view_file") {
      const p = String((parameters && parameters.AbsolutePath) || "");
      const ownBrain = conversationId ? path.join(BRAIN_ROOT, conversationId) + path.sep : "\0";
      if (p !== inputPath && !p.startsWith(ownBrain)) return `查看了原图以外的文件 ${p}`;
    }
    if (name === "invoke_subagent" && subagents) {
      const bad = subagents.map((s) => s.type_name).filter((t) => t !== "image-generator");
      if (bad.length) return `委派了生图以外的子智能体 ${bad.join(",")}`;
    }
    return "";
  };

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
      } else if (s.step_type === "tool" || s.step_type === "subagent") {
        const name = s.tool_name || (s.tool_info && s.tool_info.name) || "";
        let parameters = (s.tool_info && s.tool_info.parameters) || undefined;
        const subagents = s.subagent_info && s.subagent_info.subagents;
        if (subagents) {
          parameters = subagents.map((x) => ({ type_name: x.type_name, role: x.role, initial_prompt: x.initial_prompt }));
        }
        if (s.state !== "ACTIVE" && s.state !== "DONE") return;
        if (s.state === "ACTIVE" && !genStartAt && (name === "generate_image" || name === "invoke_subagent")) {
          genStartAt = Date.now();
        }
        const item = { name, state: s.state, parameters, seconds: s.duration_seconds, at: sec(Date.now() - startedAt) };
        if (s.state === "DONE") toolCalls.push(item);
        send({ type: "tool", ...item });
        if (guard && s.state === "ACTIVE" && !violation) {
          const why = checkTool(name, parameters, subagents);
          if (why) {
            violation = { name, detail: why, at: item.at };
            send({ type: "violation", ...violation });
            killChild("越权：" + why);
          }
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
  clearInterval(watcher);
  rawLog.end();
  const endedAt = Date.now();

  // 收图：brain/<conversation_id>/ + 工作目录里 agy 自己写的图片（除了原图）
  const found = [];
  if (conversationId && /^[A-Za-z0-9._-]+$/.test(conversationId)) {
    found.push(...(await listImages(path.join(BRAIN_ROOT, conversationId))));
  }
  for (const img of await listImages(workDir)) {
    if (img.full !== inputPath) found.push(img);
  }
  const genCalls = await findGenerateImageCalls(startedAt, inputPath).catch(() => []);
  // 主会话目录里没有图时，去生图子智能体的会话目录里找
  if (found.length === 0) {
    for (const c of genCalls) {
      if (c.conversationId !== conversationId) {
        found.push(...(await listImages(path.join(BRAIN_ROOT, c.conversationId))));
      }
    }
  }
  const images = [];
  let i = 0;
  for (const img of found) {
    if (img.mtimeMs < startedAt - 5000) continue; // 不是这一次生成的
    i += 1;
    const name = `${String(i).padStart(2, "0")}-${img.name}`;
    await fsp.copyFile(img.full, path.join(outDir, name)).catch(() => {});
    images.push({
      url: `/runs/${runId}/out/${encodeURIComponent(name)}`,
      fileName: img.name,
      bytes: img.size,
      readyAfterSec: sec(img.mtimeMs - startedAt),
      mtimeMs: img.mtimeMs,
    });
  }
  await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});

  // 出了图就算成功；agy 自己报的错（比如 503）降级成警告
  const warnings = [];
  if (killedReason && !violation && !earlyStop) warnings.push("已结束 agy：" + killedReason);
  if (!killedReason && !result) warnings.push(`agy 没有正常结束（退出码 ${exitCode}）`);
  if (result && result.status && result.status !== "SUCCESS") {
    warnings.push(`agy 返回状态 ${result.status}${result.error ? "：" + JSON.stringify(result.error) : ""}`);
  }
  let error = "";
  if (images.length === 0) {
    error = violation ? "越权，已结束 agy：" + violation.detail : warnings.shift() || "agy 跑完了，但没有找到生成的图片";
  }

  // 三段耗时：准备（开始 → 调用生图）、生图（→ 图片写入）、收尾（→ 结束）
  const firstImgAt = images.length ? Math.min(...images.map((x) => x.mtimeMs)) : 0;
  const phases = {
    prepSec: genStartAt ? sec(genStartAt - startedAt) : null,
    genSec: genStartAt && firstImgAt ? sec(firstImgAt - genStartAt) : null,
    tailSec: firstImgAt ? sec(Math.max(0, endedAt - firstImgAt)) : null,
  };

  const done = {
    type: "done",
    ok: images.length > 0,
    error,
    warnings,
    violation,
    earlyStop,
    runId,
    runDir,
    conversationId,
    exitCode,
    wallSeconds: sec(endedAt - startedAt),
    phases,
    agyStatus: result && result.status,
    agySeconds: result && result.duration_seconds,
    usage: result && result.usage,
    response: (result && result.response) || "",
    toolCalls,
    genCalls,
    images: images.map(({ mtimeMs, ...rest }) => rest),
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
    `[${beijingTime()}] ${runId} ${done.ok ? "成功" : "失败"} ${done.wallSeconds}s 图片 ${images.length} 张` +
      `${error ? " " + error : ""}${warnings.length ? " 警告：" + warnings.join("；") : ""}`,
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

/** 这台电脑（虚拟机）自己的 IPv4 地址，比如 VMware NAT 网卡的 192.168.x.x。 */
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === "IPv4" && !a.internal && !/^(docker|br-|veth|virbr)/.test(name)) {
        out.push({ name, address: a.address });
      }
    }
  }
  return out;
}

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用：可能已经开着一个了，或者换个端口：PORT=5261 node server.js`);
  } else {
    console.error("启动失败：" + e.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`[${beijingTime()}] agy 产品精修测试已启动`);
  console.log(`本机打开：http://127.0.0.1:${PORT}`);
  if (HOST === "0.0.0.0") {
    const addrs = lanAddresses();
    if (addrs.length) {
      console.log("其他电脑（比如 VMware 外面的物理机）打开：");
      for (const a of addrs) console.log(`  http://${a.address}:${PORT}    （网卡 ${a.name}）`);
    }
    console.log("打不开的话，先在这台机器上放行端口：sudo ufw allow " + PORT + "/tcp");
  }
  console.log(`结果保存在：${RUNS_DIR}`);
  if (HOST !== "127.0.0.1" && HOST !== "localhost") {
    console.log("注意：能打开这个页面的人，都能让 agy 在这台电脑上执行操作，测完请不带 --lan 重新启动。");
  }
});
