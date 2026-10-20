// 启动：网页 + 接口 + 插件 WebSocket（/ext），同一个端口（默认 8766）
import os from "node:os";
import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { bridge } from "./bridge.js";
import { extToken } from "./auth.js";
import { PORT, HOST, VERSION, DATA_DIR } from "./config.js";
import { broadcast } from "./events.js";
import * as analysis from "./analysis/pipeline.js";
import * as queue from "./queue.js";

const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST });
server.on("upgrade", (req, socket, head) => {
  if ((req.url || "").split("?")[0] === "/ext") bridge.handleUpgrade(req, socket, head);
  else socket.destroy();
});
bridge.on("status", () => broadcast("status", { workers: bridge.status(), counts: queue.counts() }));

const ips = Object.values(os.networkInterfaces()).flat().filter((x) => x && x.family === "IPv4" && !x.internal).map((x) => x.address);
console.log(`AI图图 工作台 ${VERSION} 已启动`);
console.log(`  网页地址：${ips.map((ip) => `http://${ip}:${PORT}/`).join("  ") || `http://localhost:${PORT}/`}`);
console.log(`  插件连接：服务器 IP 同上，端口 ${PORT}，插件口令 ${extToken()}`);
console.log(`  数据目录：${DATA_DIR}`);

analysis.resumeAll();
queue.tick();

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { console.log("正在停止…"); server.close(); process.exit(0); });
