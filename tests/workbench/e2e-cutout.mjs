// 网页版抠白底图：真实 Chromium 打开 /cutout/，假 AI图图 插件连上工作台。
// 测：新建（名字规则）→ 上传 / Ctrl+V 加图 → 编辑框（框选、画笔标注配件、取色、旋转）→ 精修要求、产品名、Gemini 模型 → 开始这一批（服务器做）
// → 结果（完成、素材中心里有白底图、缩略图打 ✓、要求自动清空）→ 重做 → 选中做主图（新建项目）
// 运行：node tests/workbench/e2e-cutout.mjs
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { connect } from '../../web/test/fake-plugins.js';
import { product, png, fakeDetailAI } from '../../web/test/fake-detail.js';

const here = path.dirname(new URL(import.meta.url).pathname);
const web = path.resolve(here, '../../web');
const out = path.join(os.tmpdir(), 'e2e-cutout');
fs.mkdirSync(out, { recursive: true });
const checks = [];
const check = (name, ok, info = '') => { checks.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = 18500 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cutout-'));
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
await api('PUT', '/api/roles', { roles: { text: ['gemini'], vision: ['gemini'], image: ['gemini'] } });
const ai = fakeDetailAI();
const plugin = await connect(`ws://127.0.0.1:${PORT}/ext`, { token, name: '测试电脑', version: '0.8.0', app: 'aitutu', sites: [{ site: 'gemini', name: 'Gemini', open: true, ready: true }] }, ai.onCmd);

const browser = await chromium.launch({ channel: 'chromium', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1], url: BASE }]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const proj = async () => (await api('GET', `/api/projects/${/p=([^&]+)/.exec(page.url())[1]}`)).project;
const md = (() => { const d = new Date(Date.now() + 8 * 3600e3); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; })();

try {
  await page.goto(BASE + '/');
  await page.waitForSelector('#nav a');
  check('工作台左边菜单顺序：抠白底图、主图制作、详情页、素材中心、竞品分析……', (await page.$$eval('#nav a[data-nav]', (as) => as.map((a) => a.textContent.trim().replace(/\s*\d*$/, '')).join('、'))).startsWith('抠白底图、主图制作、详情页、素材中心、竞品分析、任务中心、AI 连接、设置'));
  check('打开工作台默认是抠白底图', await page.isVisible('a[href="/cutout/"]'));
  await page.click('a[href="/cutout/"]');
  await page.click('[data-act="newProj"]');
  await page.fill('#npName', '钱包');
  await page.click('#modal [data-ret="ok"]');
  await page.waitForSelector('[data-act="start"]');
  check('新建项目：名字是“白底图-钱包月-日-1”', (await page.inputValue('#projName')) === `白底图-钱包${md}-1`, await page.inputValue('#projName'));
  const fc = page.waitForEvent('filechooser');
  await page.click('[data-act="addFiles"]');
  await (await fc).setFiles([{ name: '钱包1.png', mimeType: 'image/png', buffer: product('#f0f0f0') }]);
  await page.waitForSelector('.thumb');
  // Ctrl+V 粘贴一张
  const pasteBuf = [...png(400, 300, (g, w, h) => { g.fillStyle = '#ddd'; g.fillRect(0, 0, w, h); g.fillStyle = '#7a4a2a'; g.fillRect(120, 80, 160, 140); })];
  await page.evaluate((bytes) => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' })); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }, pasteBuf);
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 2);
  check('上传、Ctrl+V 粘贴都能加图', true);

  // 编辑框
  await page.click('.thumb >> nth=0');
  await page.waitForSelector('#ceModal.show');
  const st = await (await page.$('#ceImg')).boundingBox();
  await page.mouse.move(st.x + st.width * 0.2, st.y + st.height * 0.15); await page.mouse.down(); await page.mouse.move(st.x + st.width * 0.8, st.y + st.height * 0.85, { steps: 6 }); await page.mouse.up();
  check('编辑框：框选商品（8 个点）', await page.isVisible('#ceSel') && (await page.locator('#ceSel .h').count()) === 8);
  await page.click('#ceTools [data-tool="brush"]');
  await page.mouse.move(st.x + st.width * 0.5, st.y + st.height * 0.5); await page.mouse.down(); await page.mouse.move(st.x + st.width * 0.55, st.y + st.height * 0.52, { steps: 4 }); await page.mouse.up();
  await page.click('#ceTools [data-tool="picker"]');
  await page.mouse.click(st.x + st.width * 0.45, st.y + st.height * 0.45);
  await page.waitForSelector('#ceColors .crow');
  await page.click('#ceRotR');
  await page.waitForFunction(() => /90/.test(document.getElementById('ceTitle').textContent) || true);
  await sleep(500);
  await page.screenshot({ path: path.join(out, '1-editor.png') });
  await page.click('#ceOk');
  await page.waitForFunction(() => !document.querySelector('#ceModal.show'));
  await sleep(800);
  let p = await proj();
  const f0 = p.files[0];
  check('编辑结果存到服务器：框选、配件、取色、旋转', f0.crop && f0.parts.length >= 1 && f0.colors.length === 1 && f0.rot90 === 90 && f0.curKey !== f0.key && f0.maskKey, JSON.stringify({ crop: !!f0.crop, parts: f0.parts.length, colors: f0.colors.length, rot: f0.rot90 }));

  // 设置 + 开始
  await page.fill('#productName', '钱包');
  await page.fill('#requirement', '黑色皮质[产品名]，拉链要清楚');
  await page.selectOption('[data-s="model"]', 'Pro');
  await page.waitForFunction(() => document.querySelector('[data-s="model"]').value === 'Pro');
  await page.click('[data-act="start"]');
  await page.waitForFunction(() => document.querySelectorAll('.job .tag.ok').length === 2, null, { timeout: 60000 });
  const asks = ai.asked.filter((a) => /a refined e-commerce product photo/.test(a.prompt));
  check('开始这一批：两张都交给 AI（服务器做），提示词带产品名、要求、配件位置、颜色', asks.length === 2 && asks.some((a) => /"钱包"/.test(a.prompt) && /黑色皮质钱包/.test(a.prompt) && /Accessories:.*\d+%/.test(a.prompt) && /#[0-9A-F]{6}/.test(a.prompt)));
  check('Gemini 模型：按设置切到 Pro', asks.every((a) => a.model === 'Pro'));
  check('做完一批自动清空精修要求和产品名', (await page.inputValue('#requirement')) === '' && (await page.inputValue('#productName')) === '');
  p = await proj();
  check('缩略图打 ✓；结果有尺寸（800×800）', (await page.locator('.thumb.done').count()) === 2 && p.jobs.every((j) => j.w === 800 && j.h === 800 && j.outKey));
  const lib = (await api('GET', '/api/library')).items;
  // （假 AI 两次给的是同一张图，素材中心同一组里一样的图只存一份）
  check('做好的白底图自动放进素材中心（白底图），原图也在', lib.filter((x) => x.tag === '白底图' && x.source === 'cutout').length >= 1 && p.jobs.every((j) => j.libId) && lib.filter((x) => x.tag === '原图' && x.source === 'cutout').length === 2);
  await page.screenshot({ path: path.join(out, '2-done.png'), fullPage: true });

  // 重做
  const n0 = asks.length;
  await page.click('.job >> nth=0 >> [data-act="redo"]');
  await page.waitForFunction(() => document.querySelectorAll('.job .tag.ok').length === 2 && !document.querySelector('.job .tag.blue'), null, { timeout: 60000 });
  await sleep(500);
  check('重做：重新交给 AI（用这张上次的要求）', ai.asked.filter((a) => /a refined e-commerce product photo/.test(a.prompt)).length === n0 + 1 && /黑色皮质钱包/.test(ai.asked[ai.asked.length - 1].prompt));

  // 模式切换
  await page.click('[data-mode="refine"]');
  await page.waitForSelector('[data-s="refineBg"]');
  check('切到图片精修：比例跟原图、背景可以选原图 / 白底 / 自定义', (await page.inputValue('[data-s="ratio"]')) === 'auto' && (await page.isDisabled('[data-s="ratio"]')));
  await page.click('[data-mode="white"]');

  // 选中做主图
  await page.check('#selAll');
  await page.click('[data-act="toMain"]');
  await page.fill('#lsName', '钱包');
  await page.click('#libLayer [data-ret="ok"]');
  await page.waitForSelector('#libLayer:has-text("已经放进")');
  await page.click('#libLayer [data-ret=""]');
  const mains = (await api('GET', '/api/projects?kind=main')).list;
  check('选中的白底图“做主图”：新建主图项目，两张都放进去', mains.length === 1 && /^主图-钱包\d\d-\d\d-2$/.test(mains[0].name) && (await api('GET', `/api/projects/${mains[0].id}`)).project.products.length === 2, JSON.stringify(mains.map((x) => x.name)));
  // 工作台列表
  await page.goto(BASE + '/#/cutout');
  await page.waitForSelector('td a[href^="/cutout/#p="]');
  check('工作台“抠白底图”列表：点名称打开，后面只有“删除”', (await page.locator('td button[data-del]').count()) === 1);
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
