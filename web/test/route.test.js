// 派活：别的电脑上有插件在线时，AI 活交给别的电脑，不用开着工作台网页的这台；只有这台在线才用这台（Lee 2026-10-26）
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aitutu-route-"));
process.env.QUEUE_FAST = "1";
const { bridge } = await import("../server/bridge.js");
const { addClient, normIp } = await import("../server/events.js");
const Q = await import("../server/queue.js");

/** 假的 AI图图 连接：收到命令马上回一段文字，记下是谁做的 */
const done = [];
function fake(id, ip) {
  const conn = { id, app: "aitutu", name: "AI图图", ip, version: "0.9.0", since: Date.now(), sites: new Map([["gemini", { site: "gemini", name: "Gemini", open: true, ready: true }]]), pending: new Map() };
  conn.ws = { send: (raw) => { const m = JSON.parse(raw); if (m.type !== "cmd") return; done.push(id); setTimeout(() => { const p = conn.pending.get(m.id); if (p) { conn.pending.delete(m.id); clearTimeout(p.timer); p.resolve({ ok: true, data: { text: "好" } }); } }, 5); }, close() {} };
  bridge.conns.set(id, conn);
  return conn;
}
const ask = async (n) => { const row = Q.enqueue({ kind: "text", label: "测试" + n, payload: { prompt: "你好" + n, sites: ["gemini"] } }); await Q.wait(row.id); };

test("IP 统一写法：本机地址都算工作台服务器", () => {
  assert.equal(normIp("::ffff:127.0.0.1"), "server");
  assert.equal(normIp("::1"), "server");
  assert.equal(normIp("::ffff:192.168.9.77"), "192.168.9.77");
});

test("别的电脑上有插件：活都交给别的电脑；只有本机在线就用本机", async () => {
  const off = addClient(() => {}, "::ffff:10.1.1.5"); // 开着网页的是 10.1.1.5
  const local = fake("cA", "10.1.1.5");
  fake("cB", "10.1.1.6");
  assert.equal(bridge.isLocal(local), true);
  assert.equal(bridge.status().find((x) => x.connId === "cA").local, true);
  for (let i = 0; i < 4; i++) await ask(i);
  assert.deepEqual([...new Set(done)], ["cB"], "本机的插件不用");
  bridge.drop("cB");
  done.length = 0;
  await ask(9);
  assert.deepEqual(done, ["cA"], "只剩本机：用本机");
  // 网页关了：哪台都算别的电脑
  off();
  assert.equal(bridge.isLocal(local), false);
  bridge.drop("cA");
});
