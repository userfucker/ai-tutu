// 主图页面：真实 Chromium 打开 /main/，假 AI图图 插件连上工作台。
// 测：新建 → 上传白底图（自动去白底）→ 选两种风格生成 → 待确认（融入后 / 原贴图）→ 上传图片识别风格并保存 → 调整产品 → 采用 → 下载 zip。
// 运行：node tests/workbench/e2e-main.mjs
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { connect } from '../../web/test/fake-plugins.js';
import { product, fakeDetailAI } from '../../web/test/fake-detail.js';

const here = path.dirname(new URL(import.meta.url).pathname);
const web = path.resolve(here, '../../web');
const out = path.join(os.tmpdir(), 'e2e-main');
fs.mkdirSync(out, { recursive: true });
const checks = [];
const check = (name, ok, info = '') => { checks.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
// （headless Chromium 不认中文下载文件名，所以看图片本身的尺寸）
const jpegSize = (b) => { for (let i = 2; i < b.length - 9;) { if (b[i] !== 0xff) return ''; const m = b[i + 1]; if (m >= 0xc0 && m <= 0xc3) return `${b.readUInt16BE(i + 7)}x${b.readUInt16BE(i + 5)}`; i += 2 + b.readUInt16BE(i + 2); } return ''; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = 18700 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-main-'));
const srv = spawn(process.execPath, ['server/index.js'], { cwd: web, env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, QUEUE_FAST: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let so = '';
srv.stdout.on('data', (d) => (so += d));
for (let i = 0; i < 150 && !/插件口令 (\w+)/.test(so); i++) await sleep(100);
const token = /插件口令 (\w+)/.exec(so)[1];
let cookie = '';
const api = async (method, url, body) => {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return r.json();
};
await api('POST', '/api/auth/setup', { password: '1234' });
await api('PUT', '/api/roles', { roles: { text: ['gemini'], vision: ['gemini'], image: ['gemini'], mn_check: ['gemini'] } });
const ai = fakeDetailAI();
const plugin = await connect(`ws://127.0.0.1:${PORT}/ext`, { token, name: '测试电脑', version: '0.8.0', app: 'aitutu', sites: [{ site: 'gemini', name: 'Gemini', open: true, ready: true }] }, ai.onCmd);

const browser = await chromium.launch({ channel: 'chromium', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1], url: BASE }]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const idle = () => page.waitForFunction(() => !document.querySelector('.mcard[data-iid] .st, .mcard[data-prid] .st.blue'), null, { timeout: 60000 });

try {
  await page.goto(BASE + '/#/main');
  await page.waitForSelector('a[href="/main/"]');
  check('工作台左边有“主图”栏目', (await page.locator('#nav [data-nav="main"]').count()) === 1);
  await page.click('a[href="/main/"]');
  await page.waitForSelector('[data-act="newProj"]');
  await page.click('[data-act="newProj"]');
  await page.waitForSelector('text=① 产品图');
  const fc = page.waitForEvent('filechooser');
  await page.click('[data-act="addProducts"]');
  await (await fc).setFiles({ name: '白底.png', mimeType: 'image/png', buffer: product('#ffffff') });
  await page.waitForSelector('.mcard[data-prid] .tag.ok');
  check('上传白底图：自动去白底', true);
  await page.click('[data-sty="marble"]');
  await page.selectOption('#count', '1');
  await page.waitForSelector('[data-act="generate"]:has-text("生成 2 张")');
  check('选两种风格：生成 2 张', true);
  await page.click('[data-act="generate"]');
  await page.waitForFunction(() => document.querySelectorAll('.pendbox .mcard[data-iid]').length === 2);
  await idle();
  const bgAsk = ai.asked.filter((a) => a.kind === 'image' && /empty background scene/.test(a.prompt));
  check('AI 画了 2 张空背景（不带产品）', bgAsk.length === 2 && bgAsk.some((a) => /marble/.test(a.prompt)));
  check('每张都融入了背景，审核比过原贴图和 AI 图', ai.asked.filter((a) => /Edit the uploaded image/.test(a.prompt)).length === 2 && ai.asked.filter((a) => /哪张更适合当电商图片/.test(a.prompt) && a.images === 2).length === 2);
  check('审核选了 AI 图，理由写在卡片上', (await page.locator('.pendbox .mcard:has-text("审核选了 AI 图：去掉了白边")').count()) === 2);
  check('待确认卡片上能切换“AI 图 / 原贴图”', (await page.locator('.pendbox [data-act="harmView"]').count()) === 4);
  await page.click('.pendbox [data-act="harmView"][data-v="0"] >> nth=0');
  await page.waitForSelector('.pendbox [data-act="harmView"][data-v="0"].on');
  await page.screenshot({ path: path.join(out, '1-pending.png'), fullPage: true });

  // 上传图片识别风格
  const fc2 = page.waitForEvent('filechooser');
  await page.click('[data-act="learnStyle"]');
  await (await fc2).setFiles({ name: '参考.png', mimeType: 'image/png', buffer: product('#c8a27a') });
  await page.waitForSelector('#lsName');
  check('AI 识别出风格（可以改）', (await page.inputValue('#lsName')) === '暖色木桌' && /wooden/.test(await page.inputValue('#lsPrompt')));
  await page.screenshot({ path: path.join(out, '2-style.png') });
  await page.click('#modal [data-ret="ok"]');
  await page.waitForSelector('.stypill.on:has-text("暖色木桌")');
  check('保存到“我的风格”，自动选上', true);
  const meta = await api('GET', '/api/meta/mainStyles');
  check('“我的风格”存在服务器上（所有项目共用）', meta.value && meta.value.length === 1 && meta.value[0].ref);

  // 调整产品 → 重新融入
  const before = ai.asked.filter((a) => /Edit the uploaded image/.test(a.prompt)).length;
  await page.click('.pendbox [data-act="adjust"] >> nth=0');
  const cv = await page.waitForSelector('#adjC');
  const bb = await cv.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2 - 60, bb.y + bb.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  await page.fill('#adjS', '55');
  await page.click('#modal [data-ret="ok"]');
  await sleep(300);
  await idle();
  check('调整产品后自动重新融入', ai.asked.filter((a) => /Edit the uploaded image/.test(a.prompt)).length === before + 1);

  // 采用 → 下载
  await page.click('.pendbox [data-act="accept"] >> nth=0');
  await page.waitForSelector('[data-act="dlAll"]');
  const dl = page.waitForEvent('download');
  await page.click('[data-act="dlAll"]');
  const d = await dl;
  const zp = path.join(out, 'main.zip');
  await d.saveAs(zp);
  const z = fs.readFileSync(zp);
  check('下载全部：zip 里有主图和白底图', z.includes(Buffer.from('主图01_')) && z.includes(Buffer.from('白底图.jpg')));
  await page.screenshot({ path: path.join(out, '3-done.png'), fullPage: true });

  // 1000×1000
  await page.click('[data-size="1000"]');
  const dl2 = page.waitForEvent('download');
  await page.click('[data-act="dlOne"]');
  const jp = path.join(out, 'one.jpg');
  await (await dl2).saveAs(jp);
  check('切到 1000×1000：单张下载就是 1000×1000', jpegSize(fs.readFileSync(jp)) === '1000x1000', jpegSize(fs.readFileSync(jp)));

  // 镂空的白色也抠掉：重新去白底
  const cutBefore = await page.getAttribute('.mcard[data-prid] img', 'src');
  await page.check('.mcard[data-prid] [data-holes]');
  await page.waitForFunction((src) => { const i = document.querySelector('.mcard[data-prid] img'); return i && i.getAttribute('src') !== src && document.querySelector('.mcard[data-prid] .tag.ok'); }, cutBefore, { timeout: 30000 });
  check('勾“镂空的白色也抠掉”：重新抠图', true);
  check('抠好的图放在深色格子上', (await page.locator('.mcard[data-prid] .pic.dark').count()) === 1);

  // AI 直接画场景
  await page.click('[data-mode="scene"]');
  await page.click('[data-sty="marble"]'); // 只留一种风格（纯色渐变棚拍）
  await page.click('[data-sty^="my:"]', { position: { x: 12, y: 12 } });
  await page.waitForSelector('[data-act="generate"]:has-text("生成 1 张")');
  await page.click('[data-act="generate"]');
  await page.waitForSelector('.pendbox .mcard:has-text("AI 直接画")');
  await idle();
  const sceneAsk = ai.asked.find((a) => /a cut-out PNG with transparent background/.test(a.prompt));
  check('AI 直接画场景：把抠好的 PNG 发给 AI，审核看产品有没有被改', sceneAsk && sceneAsk.images === 1 && ai.asked.some((a) => /是不是同一个产品/.test(a.prompt)) && (await page.locator('.pendbox .mcard:has-text("审核：产品没被改")').count()) === 1);
  await page.screenshot({ path: path.join(out, '4-scene.png'), fullPage: true });

  // 关掉网页再打开：后台照样做完
  await page.click('[data-mode="paste"]');
  await page.waitForSelector('[data-mode="paste"].on');
  const url = page.url();
  await page.click('[data-act="generate"]');
  await sleep(200);
  await page.goto('about:blank');
  const pid = /p=([^&]+)/.exec(url)[1];
  let done = false;
  for (let i = 0; i < 100 && !done; i++) { const pp = (await api('GET', `/api/projects/${pid}`)).project; done = pp.items.length === 4 && pp.items.every((x) => !x.job); await sleep(300); }
  check('关掉网页：服务器照样做完', done);
  await page.goto(url);
  await page.waitForSelector('.pendbox .mcard[data-iid]');

  // 主图项目不出现在详情页里
  const detailList = await api('GET', '/api/projects');
  const mainList = await api('GET', '/api/projects?kind=main');
  check('主图项目和详情页项目分开', detailList.list.length === 0 && mainList.list.length === 1 && mainList.list[0].done === 1, JSON.stringify(mainList.list));
  // 工作台“主图”列表：点名称打开，后面只有“删除”
  await page.goto(BASE + '/#/main');
  await page.waitForSelector('td a[href^="/main/#p="]');
  check('工作台列表：项目名称就是打开链接，没有“打开”按钮', (await page.locator('td a:text("打开")').count()) === 0);
  await page.click('[data-del]');
  await page.click('#modal [data-ret="yes"]');
  await page.waitForSelector('text=还没有主图项目');
  check('工作台列表：删除', (await api('GET', '/api/projects?kind=main')).list.length === 0);
  check('全程没有页面报错', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('出错：' + e.message.split('\n')[0], false, errors.join(' | '));
  await page.screenshot({ path: path.join(out, 'error.png') }).catch(() => {});
}
await browser.close();
plugin.close();
srv.kill();
console.log('截图在', out);
const bad = checks.filter((x) => !x).length;
console.log(`\n${checks.length - bad}/${checks.length} 通过`);
process.exit(bad ? 1 : 0);
