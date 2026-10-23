// 详情页网页版：真实 Chromium 打开工作台的 /detail/，假 AI图图 插件连上工作台。
// 测：一键全自动新建（上传 zip）→ 等你审核 → 打开看、编辑页能画；手动流程：上传图片、AI 抠图、AI 想卖点、列提纲、导出。
// 运行：node tests/workbench/e2e-detail.mjs
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { connect } from '../../web/test/fake-plugins.js';
import { tbZip, product, fakeDetailAI } from '../../web/test/fake-detail.js';

const here = path.dirname(new URL(import.meta.url).pathname);
const web = path.resolve(here, '../../web');
const out = path.join(os.tmpdir(), 'e2e-detail');
fs.mkdirSync(out, { recursive: true });
const checks = [];
const check = (name, ok, info = '') => { checks.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = 18600 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-detail-'));
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

const zipFile = path.join(out, '测试保温杯.zip');
fs.writeFileSync(zipFile, tbZip());
const imgFile = path.join(out, '背包.png');
fs.writeFileSync(imgFile, product('#8a6d4e'));

const browser = await chromium.launch({ channel: 'chromium', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1], url: BASE }]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });

try {
  // 工作台里的“详情页”概况
  await page.goto(BASE + '/#/detail');
  await page.waitForSelector('a[href="/detail/"]');
  check('工作台的“详情页”页面有入口', true);
  await page.click('a[href="/detail/"]');
  await page.waitForSelector('text=我的项目');
  check('打开 /detail/，显示我的项目', true);
  await page.waitForFunction(() => /AI/.test(document.querySelector('#aiChip').textContent));

  // 一键全自动新建：上传 zip
  await page.click('[data-act="batchNew"]');
  // （用文件路径传给 setInputFiles 在这里不触发 change，所以直接传内容）
  await page.setInputFiles('#bnZipIn', { name: '测试保温杯.zip', mimeType: 'application/zip', buffer: fs.readFileSync(zipFile) });
  await page.waitForSelector('#bnList input[value="测试保温杯"]');
  await page.click('#bnLangs [data-l="en"]');
  await page.click('[data-ret="go"]');
  await page.waitForSelector('#bnList .tag.ok', { timeout: 30000 });
  check('一键全自动新建：上传 zip、开始', true);
  await page.click('#modal [data-ret=""]');
  await page.waitForSelector('.astat.review', { timeout: 120000 });
  check('项目卡片显示“等你审核”（页面自动刷新）', true);
  await page.screenshot({ path: path.join(out, '1-home.png') });
  check('卡片上有“下载 zip”', (await page.locator('.proj a.btnlink').count()) === 1);

  // 打开：全自动页面
  await page.click('.proj [data-act="openProj"] >> nth=0');
  await page.waitForSelector('text=做完了，请审核');
  check('打开项目：全自动页面，11 步都完成', (await page.locator('.asteps .done').count()) === 11);
  await page.waitForSelector('#harmGrid .hcell', { timeout: 20000 });
  check('审核页有“产品融入背景”，每屏可以切换', (await page.locator('#harmGrid [data-act="autoHarm"]').count()) >= 2);
  await page.click('#harmGrid [data-act="autoHarm"][data-v="0"] >> nth=0');
  await page.waitForSelector('#harmGrid [data-act="autoHarm"][data-v="0"].on');
  await page.click('#harmGrid [data-act="autoHarm"][data-v="1"] >> nth=0');
  await page.waitForSelector('#harmGrid [data-act="autoHarm"][data-v="1"].on');
  check('切换“原贴图 / 融入后”', true);
  await page.screenshot({ path: path.join(out, '2-auto.png'), fullPage: true });
  await page.click('text=逐屏看看、手动改');
  await page.waitForSelector('canvas');
  await page.waitForSelector('#edRight .harm', { timeout: 20000 });
  check('编辑页右边有“产品融入背景”（融入后 / 原贴图、选 AI）', (await page.locator('#edRight .harm [data-act="harmView"]').count()) === 2 && (await page.locator('#harmSite option').count()) === 3);
  await sleep(1000);
  await page.screenshot({ path: path.join(out, '3-edit.png') });
  check('编辑页画出来了', errors.length === 0, errors.join(' | '));
  await page.click('#steps [data-go="auto"]');
  await page.click('[data-act="autoApprove"]');
  await page.waitForSelector('.astat.approved', { timeout: 30000 });
  check('审核通过', true);

  // 手动流程
  await page.click('[data-act="home"]');
  await page.click('[data-act="newProj"]');
  await page.waitForSelector('text=① 新建项目');
  await page.click('#steps [data-go="assets"]');
  await page.setInputFiles('#assetInput', { name: '背包.png', mimeType: 'image/png', buffer: fs.readFileSync(imgFile) });
  await page.waitForSelector('.asset');
  await page.click('.asset [data-act="cutAi"]');
  await page.waitForSelector('.asset .tag.ok', { timeout: 60000 });
  check('手动：上传图片，AI 抠图（任务交给工作台）', ai.asked.some((a) => a.kind === 'image' && /isolated/.test(a.prompt)));
  // AI 多角度：选两个角度，一次画完，先进“待确认”
  await page.click('.asset [data-act="angleAi"]');
  await page.click('#agList [data-ag="left"]');
  await page.click('#agList [data-ag="45"]');
  await page.screenshot({ path: path.join(out, '4-angles.png') });
  await page.click('#agGo');
  await page.waitForFunction(() => document.querySelectorAll('.pendbox [data-pid]').length === 2, null, { timeout: 60000 });
  check('AI 多角度：两张都画好，放在“待确认”', ai.asked.filter((a) => /different camera angle/.test(a.prompt)).length === 2);
  await page.click('.pendbox [data-pid] [data-act="pendOk"] >> nth=0');
  await page.waitForFunction(() => document.querySelectorAll('.assets > .asset[data-aid]').length === 2);
  check('采用一张：变成素材（角度图，已去白底）', await page.locator('.asset[data-aid] >> nth=1').locator('text=已抠图').count() === 1);
  await page.click('.pendbox [data-act="pendNo"]');
  await page.waitForFunction(() => !document.querySelector('.pendbox'));
  check('不要的那张删掉了', true);
  // 圈细节：用画笔涂一块
  await page.click('.asset[data-aid] [data-act="closeUp"] >> nth=0');
  const cm = await page.waitForSelector('#cMask');
  const bb = await cm.boundingBox();
  await page.mouse.move(bb.x + bb.width * 0.4, bb.y + bb.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width * 0.6, bb.y + bb.height * 0.35, { steps: 8 });
  await page.mouse.up();
  await page.fill('#cNote', '拉链头');
  await page.screenshot({ path: path.join(out, '5-closeup.png') });
  await page.click('#modal [data-ret="go"]');
  await page.waitForSelector('.pendbox [data-pid]', { timeout: 60000 });
  const cu = ai.asked.find((a) => /macro close-up/.test(a.prompt));
  check('圈细节：AI 收到圈好的图和放大图，画好放进“待确认”', cu && cu.images === 2 && /拉链头/.test(cu.prompt));
  await page.screenshot({ path: path.join(out, '6-pending.png'), fullPage: true });
  await page.click('.pendbox [data-act="pendOk"]');
  await page.waitForFunction(() => document.querySelectorAll('.assets > .asset[data-aid]').length === 3);
  check('采用细节图：放在原图后面，标签是“细节图”', (await page.locator('.asset[data-aid] >> nth=1').locator('select[data-k="tag"]').inputValue()) === 'detail');
  check('细节图采用后也去了白底（透明）', await page.locator('.asset[data-aid] >> nth=1').locator('text=已抠图').count() === 1);
  // 方框模式：拖出一个框，粗细、模式都记住
  await page.click('.asset[data-aid] [data-act="closeUp"] >> nth=0');
  await page.waitForSelector('#cMask');
  check('画笔默认最细（2），可以调', (await page.inputValue('#cSize')) === '2');
  await page.click('#cMode [data-m="box"]');
  const cb = await (await page.$('#cMask')).boundingBox();
  await page.mouse.move(cb.x + cb.width * 0.3, cb.y + cb.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(cb.x + cb.width * 0.6, cb.y + cb.height * 0.5, { steps: 6 });
  await page.mouse.up();
  check('方框模式：拖出 8 点方框', await page.isVisible('#cBox') && (await page.locator('#cBox i').count()) === 8);
  await page.screenshot({ path: path.join(out, '7-box.png') });
  const nBefore = ai.asked.filter((a) => /macro close-up/.test(a.prompt)).length;
  await page.click('#modal [data-ret="go"]');
  await page.waitForSelector('.pendbox [data-pid]', { timeout: 60000 });
  check('方框圈的细节也画好了', ai.asked.filter((a) => /macro close-up/.test(a.prompt) && /pure white/.test(a.prompt)).length === nBefore + 1);
  await page.click('.pendbox [data-act="pendNo"]');
  await page.click('.asset[data-aid] [data-act="closeUp"] >> nth=0');
  await page.waitForSelector('#cMask');
  check('下次打开还是方框模式', await page.isVisible('#cMode [data-m="box"].on'));
  await page.click('#modal [data-ret=""]');
  await page.click('#steps [data-go="info"]');
  await page.fill('[data-info="name"]', '男士双肩包');
  await page.click('[data-act="aiPoints"]');
  await page.waitForSelector('.pitem .tag.blue', { timeout: 60000 });
  check('手动：AI 想卖点', (await page.locator('.pitem').count()) >= 3);
  await page.click('#steps [data-go="outline"]');
  await page.click('[data-act="olAi"]');
  await page.waitForSelector('.oitem', { timeout: 60000 });
  check('手动：AI 列提纲', (await page.locator('.oitem').count()) === 3);
  // 刷新页面：项目还在（存在服务器上）
  await page.reload();
  await page.waitForSelector('.oitem');
  check('刷新页面，项目还在', (await page.locator('.oitem').count()) === 3);
  await page.click('#steps [data-go="export"]');
  const dl = page.waitForEvent('download', { timeout: 60000 });
  await page.click('[data-act="xExport"]');
  const d = await dl;
  const zp = path.join(out, 'manual.zip');
  await d.saveAs(zp);
  check('手动：网页里导出 zip', fs.statSync(zp).size > 20000);
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
