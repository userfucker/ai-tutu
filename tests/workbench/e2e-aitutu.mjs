// AI图图 插件连接工作台：真实 Chromium 加载插件 + 启动工作台 + 模拟 Gemini 页面。
// 工作台发“写文字 / 看图 / 画图”任务 → 插件在单独窗口打开 Gemini → 做完把结果传回来。
// 运行：node tests/workbench/e2e-aitutu.mjs
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const here = path.dirname(new URL(import.meta.url).pathname);
const ext = path.resolve(here, '../../extension');
const web = path.resolve(here, '../../web');
const mock = fs.readFileSync(path.join(here, 'mock-gemini.html'), 'utf8');
const checks = [];
const check = (name, ok, info = '') => { checks.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = 18700 + Math.floor(Math.random() * 90);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-ai-'));
const srv = spawn(process.execPath, ['server/index.js'], { cwd: web, env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, QUEUE_FAST: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
srv.stdout.on('data', (d) => (out += d));
for (let i = 0; i < 80 && !/插件口令 (\w+)/.test(out); i++) await sleep(100);
const token = /插件口令 (\w+)/.exec(out)[1];
let cookie = '';
const api = async (method, url, body) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${url}`, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return r.json();
};
await api('POST', '/api/auth/setup', { password: '1234' });

const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium', headless: true, viewport: { width: 1300, height: 900 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP gemini.google.com ~NOTFOUND, MAP *.google.com ~NOTFOUND, MAP copilot.com ~NOTFOUND'],
});
await ctx.route('https://gemini.google.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: mock }));
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
await sw.evaluate(([port, tok]) => chrome.storage.local.set({ aitutu_wb: { enabled: true, host: '127.0.0.1', port, token: tok, name: '书房电脑' } }), [PORT, token]);
let st;
for (let i = 0; i < 50; i++) { st = await api('GET', '/api/status'); if (st.workers.some((w) => w.app === 'aitutu')) break; await sleep(200); }
const w = st.workers.find((x) => x.app === 'aitutu');
check('AI图图 连上工作台，报了 Gemini 和 Copilot', w && w.sites.map((s) => s.site).join() === 'gemini,copilot', JSON.stringify(w && w.sites));

// 只让 Gemini 干活（不连 ai-web）
await api('PUT', '/api/roles', { roles: { text: ['gemini'], vision: ['gemini'], image: ['gemini'] } });
const waitTask = async (id, ms = 120000) => {
  for (let t0 = Date.now(); Date.now() - t0 < ms;) {
    const r = await api('GET', `/api/tasks/${id}/result`);
    if (['done', 'failed', 'cancelled'].includes(r.task.status)) return r;
    await sleep(300);
  }
  throw new Error('任务超时');
};
// 1. 写文字
const t1 = await api('POST', '/api/tasks', { kind: 'text', prompt: '补充几个卖点，只回复一个 JSON 代码块', label: '测试写文字' });
const r1 = await waitTask(t1.id);
check('写文字：Gemini 回复，代码块原文也带回来', r1.task.status === 'done' && /背久不累/.test(r1.result.text) && r1.result.codes.length > 0, r1.task.error || r1.result.text.slice(0, 60));
const gpages = ctx.pages().filter((p) => p.url().includes('gemini.google.com'));
check('插件单独开了一个 Gemini 窗口', gpages.length === 1, String(gpages.length));
// 2. 看图（带图片）
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const t2 = await api('POST', '/api/tasks', { kind: 'vision', prompt: '看图，补充卖点，只回复一个 JSON 代码块', images: [{ b64: png, mime: 'image/png', name: '产品.png' }], label: '测试看图' });
const r2 = await waitTask(t2.id);
const files = await gpages[0].evaluate(() => window.__mock.files);
check('看图：图片贴进 Gemini，回复文字', r2.task.status === 'done' && files.some((f) => f.includes('产品.png')), JSON.stringify(files));
// 3. 画图
const t3 = await api('POST', '/api/tasks', { kind: 'image', prompt: 'Generate one image: a background, aspect ratio 3:4. Reply with the image only.', label: '测试画图' });
const r3 = await waitTask(t3.id);
check('画图：收到图片，存在工作台', r3.task.status === 'done' && r3.result.file && fs.statSync(path.join(dataDir, 'files', r3.result.file)).size > 1000, r3.task.error || r3.result.file);
const gp = gpages[0];
// （面板和工作台互相等：插件内部变量，测试脚本改不到，不在这里测）
// 5. 右侧面板还在（原来的功能没被删）
check('右侧面板还在', (await gp.locator('#aitutu-panel-host').count()) === 1);
// 6. 插件断开重连：任务排队，连回来接着做
await sw.evaluate(() => chrome.storage.local.set({ aitutu_wb: { enabled: false } }));
await sleep(800);
const t5 = await api('POST', '/api/tasks', { kind: 'text', prompt: '补充卖点 JSON', label: '断开时' });
await sleep(800);
check('插件断开时任务排队', (await api('GET', `/api/tasks/${t5.id}/result`)).task.status === 'queued');
await sw.evaluate(([port, tok]) => chrome.storage.local.set({ aitutu_wb: { enabled: true, host: '127.0.0.1', port, token: tok, name: '书房电脑' } }), [PORT, token]);
const r5 = await waitTask(t5.id);
check('连回来以后接着做', r5.task.status === 'done');

await ctx.close();
srv.kill();
const bad = checks.filter((x) => !x).length;
console.log(`\n${checks.length - bad}/${checks.length} 通过`);
process.exit(bad ? 1 : 0);
