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
  check('打开项目：全自动页面，10 步都完成', (await page.locator('.asteps .done').count()) === 10);
  await page.screenshot({ path: path.join(out, '2-auto.png'), fullPage: true });
  await page.click('text=逐屏看看、手动改');
  await page.waitForSelector('canvas');
  await sleep(1500);
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
