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
// 用户自己已经开着 Gemini（和别的标签页在同一个窗口里）：插件应该接着用它，不另开新页面
await ctx.route('https://accounts.google.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<html><body>登录页（模拟）</body></html>' }));
const mine = ctx.pages()[0] || (await ctx.newPage());
await mine.goto('about:blank');
const userGem = await ctx.newPage();
await userGem.goto('https://gemini.google.com/app');
const userGemTabCount = ctx.pages().length;
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
check('没有新开 Gemini 页面：用的是已经开着的那个', gpages.length === 1 && gpages[0] === userGem, String(gpages.length));
const winOf = async (p) => sw.evaluate(async (u) => { const t = (await chrome.tabs.query({})).find((x) => x.url === u); const w = await chrome.windows.get(t.windowId, { populate: true }); return { id: w.id, n: w.tabs.length }; }, p.url());
const gw = await winOf(gpages[0]);
check('那个标签页被移到单独的窗口（一个 AI 一个窗口）', gw.n === 1, JSON.stringify(gw));
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
// 5b. 面板结果“发素材中心”（0.9.0）：插件页面发消息给后台，后台通过工作台的连接把图放进素材中心
const extId = new URL(sw.url()).host;
const ep = await ctx.newPage();
await ep.goto(`chrome-extension://${extId}/options.html`);
const pngB64 = fs.readFileSync(path.join(dataDir, 'files', r3.result.file)).toString('base64');
const libR = await ep.evaluate((b64) => new Promise((res) => chrome.runtime.sendMessage({ type: 'aitutu-to-lib', items: [{ b64, mime: 'image/png', name: '杯子-白底-800x800.png', tag: '白底图', grp: 'AI图图 插件 10-24' }] }, res)), pngB64);
const libItems = (await api('GET', '/api/library')).items;
check('面板结果“发素材中心”：放进工作台的素材中心（白底图，来源 AI图图 插件）', libR && libR.ok && libItems.some((x) => x.name === '杯子-白底-800x800.png' && x.tag === '白底图' && x.source === 'aitutu'), JSON.stringify(libR));
await ep.close();
// 6. 插件断开重连：任务排队，连回来接着做
await sw.evaluate(() => chrome.storage.local.set({ aitutu_wb: { enabled: false } }));
await sleep(800);
const t5 = await api('POST', '/api/tasks', { kind: 'text', prompt: '补充卖点 JSON', label: '断开时' });
await sleep(800);
check('插件断开时任务排队', (await api('GET', `/api/tasks/${t5.id}/result`)).task.status === 'queued');
await sw.evaluate(([port, tok]) => chrome.storage.local.set({ aitutu_wb: { enabled: true, host: '127.0.0.1', port, token: tok, name: '书房电脑' } }), [PORT, token]);
const r5 = await waitTask(t5.id);
check('连回来以后接着做', r5.task.status === 'done');

// 7. 同时来好几个任务（写文字 + 看图 + 写文字）：还是只有一个 Gemini 窗口
const many = [];
for (let i = 0; i < 3; i++) many.push((await api('POST', '/api/tasks', { kind: i === 1 ? 'vision' : 'text', prompt: '补充卖点 JSON', images: i === 1 ? [{ b64: png, mime: 'image/png', name: 'x.png' }] : undefined, label: '并发' + i })).id);
for (const id of many) await waitTask(id);
check('好几个任务一起来：还是一个 Gemini 窗口', ctx.pages().filter((p) => p.url().includes('gemini.google.com')).length === 1);
// 8. Gemini 跳到了登录页：不另开窗口，提示去登录；登录好（回到 Gemini）接着做
await gp.goto('https://accounts.google.com/signin');
const t8 = await api('POST', '/api/tasks', { kind: 'text', prompt: '补充卖点 JSON', label: '登录页' });
await sleep(9000);
const pagesNow = ctx.pages().filter((p) => /gemini\.google\.com|accounts\.google\.com/.test(p.url()));
const st8 = (await api('GET', `/api/tasks/${t8.id}/result`)).task;
check('跳到登录页时不另开窗口', pagesNow.length === 1, pagesNow.map((p) => p.url()).join(' '));
check('任务提示要登录', /登录/.test(st8.error || st8.progress || ''), st8.status + ' ' + (st8.error || st8.progress));
await gp.goto('https://gemini.google.com/app');
const r8 = await waitTask(t8.id);
check('登录好以后接着做', r8.task.status === 'done', r8.task.status + ' ' + (r8.task.error || ''));
// 9. 用户把 Gemini 窗口关了：下一个任务新开一个（只开一个）
await gp.close();
const t9 = await api('POST', '/api/tasks', { kind: 'text', prompt: '补充卖点 JSON', label: '窗口关了' });
const r9 = await waitTask(t9.id);
check('窗口关了：重新开一个，只开一个', r9.task.status === 'done' && ctx.pages().filter((p) => p.url().includes('gemini.google.com')).length === 1);
const log = await sw.evaluate(async () => (await chrome.storage.local.get('aitutu_wb_log')).aitutu_wb_log || []);
console.log('窗口记录：\n  ' + log.join('\n  '));
check('窗口记录写下来了', log.length >= 2);

await ctx.close();
srv.kill();
const bad = checks.filter((x) => !x).length;
console.log(`\n${checks.length - bad}/${checks.length} 通过`);
process.exit(bad ? 1 : 0);
