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
await api('PUT', '/api/roles', { roles: { text: ['gemini'], vision: ['gemini'], image: ['gemini'] } }); // 审核用默认的豆包
const ai = fakeDetailAI();
const plugin = await connect(`ws://127.0.0.1:${PORT}/ext`, { token, name: '测试电脑', version: '0.8.0', app: 'aitutu', sites: [{ site: 'gemini', name: 'Gemini', open: true, ready: true }] }, ai.onCmd);
// 假 ai-web（豆包）：AI 审核默认用它；记下每次收到的时间，看点了“AI 审核”多久才发过来
const doubao = [];
const plugin2 = await connect(`ws://127.0.0.1:${PORT}/ext`, { token, name: '测试电脑', version: '1.5.0', app: 'aiweb', sites: [{ site: 'doubao', name: '豆包', open: true, ready: true }] }, async (m) => {
  if (m.cmd !== 'ask') return { error: '不支持' };
  doubao.push({ t: Date.now(), text: m.args.text, files: (m.args.files || []).length });
  const out = /哪张更适合/.test(m.args.text) ? { better: 2, why: '去掉了白边，光线更自然' } : { ok: true, why: '形状颜色 logo 都一样' };
  return { answer: '```json\n' + JSON.stringify(out) + '\n```' };
});

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
  await page.waitForSelector('[data-new="main"]');
  check('工作台左边有“主图制作”栏目，右上角是“新建项目”', (await page.locator('#nav [data-nav="main"]').count()) === 1);
  await page.click('[data-new="main"]');
  await page.fill('#npName', '钱包');
  await page.click('#modal [data-ret="ok"]');
  await page.waitForURL(/\/main\/#p=/);
  await page.waitForSelector('text=① 产品图');
  const md = (() => { const d = new Date(Date.now() + 8 * 3600e3); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; })();
  check('新建项目：名字是“主图-钱包月-日-1”，不能改', (await page.inputValue('#projName')) === `主图-钱包${md}-1` && (await page.getAttribute('#projName', 'readonly')) !== null, await page.inputValue('#projName'));
  const fc = page.waitForEvent('filechooser');
  await page.click('[data-act="addProducts"]');
  await (await fc).setFiles({ name: '白底.png', mimeType: 'image/png', buffer: product('#ffffff') });
  await page.waitForSelector('.mcard[data-prid] .tag.ok');
  check('上传白底图：自动去白底', true);
  await page.click('.mcard[data-prid] .pic');
  await page.waitForSelector('#vwLayer [data-vw="dark"]:not([hidden])');
  const bg0 = await page.$eval('#vwLayer .vwimg', (e) => e.className);
  await page.click('#vwLayer [data-vw="dark"]');
  const bg1 = await page.$eval('#vwLayer .vwimg', (e) => e.className);
  await page.click('#vwLayer [data-vw="dark"]');
  const bg2 = await page.$eval('#vwLayer .vwimg', (e) => e.className);
  check('产品图点开看大图；抠好的 PNG 可以一键换深色底，再点换回来', /light/.test(bg0) && /dark/.test(bg1) && /light/.test(bg2), [bg0, bg1, bg2].join(' / '));
  await page.click('#vwLayer .vwclose');
  // 去白边：抠好的产品图 → 一键去白边 → 另存成新产品图（在这张后面；透明 PNG 直接算抠好的）
  await page.click('.mcard[data-prid] [data-act="peProduct"]');
  await page.waitForSelector('#peLayer #peCv');
  await page.click('#peWhiteBtn'); await page.fill('#peStr', '6'); await page.dispatchEvent('#peStr', 'input'); await sleep(300); await page.click('#peWhiteOk');
  await page.click('#peSaveAs');
  await page.waitForFunction(() => document.querySelectorAll('.pgrid .mcard[data-prid], .mcard[data-prid]').length >= 2);
  await sleep(500);
  const mid = /p=([^&]+)/.exec(page.url())[1];
  let mp = (await api('GET', `/api/projects/${mid}`)).project;
  check('主图产品图去白边：另存成新产品图，在后面，透明 PNG 直接算抠好的', mp.products.length === 2 && /-去白边\.png$/.test(mp.products[1].name) && mp.products[1].cut === mp.products[1].key && mp.products[1].cutBox && mp.cur === mp.products[0].id, JSON.stringify(mp.products.map((x) => [x.name, !!x.cut])));
  await api('POST', `/api/main/${mid}/op`, { op: 'delProduct', prid: mp.products[1].id });
  await page.waitForFunction(() => document.querySelectorAll('.mcard[data-prid]').length === 1);
  // 保存 = 换掉抠好的图（还是一张产品图）
  const cut0 = (await api('GET', `/api/projects/${mid}`)).project.products[0].cut;
  await page.click('.mcard[data-prid] [data-act="peProduct"]');
  await page.waitForSelector('#peLayer #peCv');
  await sleep(300);
  const mb = await (await page.$('#peCv')).boundingBox();
  for (const [fx, fy] of [[0.05, 0.05], [0.3, 0.05], [0.3, 0.3], [0.05, 0.05]]) await page.mouse.click(mb.x + mb.width * fx, mb.y + mb.height * fy);
  await page.click('#peDel');
  await page.click('#peSave');
  await page.waitForFunction(() => !document.getElementById('peLayer'));
  await sleep(800);
  mp = (await api('GET', `/api/projects/${mid}`)).project;
  check('主图产品图去白边“保存”：换掉抠好的图，不多出产品图', mp.products.length === 1 && mp.products[0].cut !== cut0 && mp.products[0].cutBox);
  // 左上角“工作台”：鼠标移上去弹出菜单
  await page.hover('a.backwb');
  await page.waitForSelector('.nmdrop a[data-nm="library"]', { state: 'visible' });
  check('左上角“工作台”：鼠标移上去弹出 8 个菜单，当前页标出来', (await page.locator('.nmdrop a').count()) === 8 && (await page.getAttribute('.nmdrop a[data-nm="main"]', 'class')).includes('on'));
  await page.mouse.move(700, 600);
  // “自己写”：打字时服务器推送项目变化（重画页面），输入框不能丢焦点、字不能丢
  await page.check('#customOn');
  await page.waitForSelector('#custom:not([hidden])');
  await page.click('#custom');
  await page.keyboard.type('浅灰色水泥', { delay: 30 });
  await api('POST', `/api/main/${mid}/op`, { op: 'set', fields: { count: 2 } }); // 别处改了项目 → 网页重画
  await sleep(1200);
  await page.keyboard.type('台面', { delay: 30 });
  await sleep(1200);
  check('主图“自己写”：页面重画时还能接着打字', (await page.inputValue('#custom')) === '浅灰色水泥台面' && await page.evaluate(() => document.activeElement && document.activeElement.id === 'custom'), await page.inputValue('#custom'));
  check('主图“自己写”：写的内容存到服务器', (await api('GET', `/api/projects/${mid}`)).project.custom === '浅灰色水泥台面');
  // 拼音输入法：选字的时候页面要重画（服务器推送），不能变成“zhongshi2”
  const cdp = await page.context().newCDPSession(page);
  await page.click('#custom');
  await page.keyboard.press('End');
  await cdp.send('Input.imeSetComposition', { text: 'zhong', selectionStart: 5, selectionEnd: 5 });
  await cdp.send('Input.imeSetComposition', { text: 'zhongshi', selectionStart: 8, selectionEnd: 8 });
  await api('POST', `/api/main/${mid}/op`, { op: 'set', fields: { count: 3 } }); // 选字中途网页重画
  await sleep(1500);
  await cdp.send('Input.insertText', { text: '中式' }); // 按 2 选了“中式”
  await sleep(1200);
  check('主图“自己写”：拼音选字时页面重画，不会变成拼音字母', (await page.inputValue('#custom')) === '浅灰色水泥台面中式', await page.inputValue('#custom'));
  check('主图“自己写”：选好的字也存到服务器', (await api('GET', `/api/projects/${mid}`)).project.custom === '浅灰色水泥台面中式');
  await page.uncheck('#customOn');
  await api('POST', `/api/main/${mid}/op`, { op: 'set', fields: { count: 1 } });
  await sleep(800);
  check('默认做法：AI 直接画场景、AI 自由摆放', await page.isVisible('[data-mode="scene"].on') && await page.isVisible('[data-place="free"].on'));
  await page.click('[data-sty="marble"]');
  await page.selectOption('#count', '1');
  await page.waitForSelector('[data-act="generate"]:has-text("生成 2 张")');
  check('选两种风格：生成 2 张', true);
  await page.click('[data-act="generate"]');
  await page.waitForFunction(() => document.querySelectorAll('.pendbox .mcard[data-iid]').length === 2);
  await idle();
  const sc1 = ai.asked.filter((a) => /a cut-out PNG with transparent background/.test(a.prompt));
  check('AI 直接画：把抠好的 PNG 发给 AI，让它自由摆放', sc1.length === 2 && sc1.every((a) => a.images === 1 && /you may choose a natural, attractive way/.test(a.prompt)));
  check('每张主图标出是哪个 AI 画的', (await page.locator('.pendbox .mcard .tag.aisite', { hasText: 'Gemini' }).count()) === 2);
  check('不自动审核：没有问审核 AI', doubao.length === 0 && !ai.asked.some((a) => /是不是同一个产品|哪张更适合/.test(a.prompt)));
  check('每张图下面有“下载”“AI 审核”“用这个摆放”', (await page.locator('.pendbox [data-act="dlOne"]:not([disabled])').count()) === 2 && (await page.locator('.pendbox [data-act="judge"]:not([disabled])').count()) === 2 && (await page.locator('.pendbox [data-act="placeRef"]').count()) === 2);
  const t0 = Date.now();
  await page.click('.pendbox [data-act="judge"] >> nth=0');
  await page.waitForSelector('.pendbox .mcard:has-text("AI 审核：产品没被改")', { timeout: 30000 });
  check('点“AI 审核”：马上发给豆包（产品原图 + 场景图）', doubao.length === 1 && doubao[0].files === 2 && doubao[0].t - t0 < 5000, `${doubao.length ? doubao[0].t - t0 : '-'} 毫秒`);
  // 用这个摆放 → 再画一张照它摆
  await page.click('.pendbox [data-act="placeRef"] >> nth=0');
  await page.waitForSelector('[data-place="ref"].on');
  check('用这个摆放：“摆放”里多了这张，自动选上', true);
  await page.click('[data-sty="marble"]'); // 只留纯色渐变棚拍
  await page.waitForSelector('[data-act="generate"]:has-text("生成 1 张")');
  let nAsk = ai.asked.length;
  await page.click('[data-act="generate"]');
  await page.waitForFunction(() => document.querySelectorAll('.pendbox .mcard[data-iid]').length === 3);
  await idle();
  const sc2 = ai.asked.slice(nAsk).find((a) => /a cut-out PNG/.test(a.prompt));
  check('照参考图摆：产品 PNG + 那张图一起发给 AI', sc2 && sc2.images === 2 && /SECOND uploaded image/.test(sc2.prompt));
  await page.click('[data-place="same"]');
  await page.waitForSelector('[data-place="same"].on');
  nAsk = ai.asked.length;
  await page.click('[data-act="generate"]');
  await page.waitForFunction(() => document.querySelectorAll('.pendbox .mcard[data-iid]').length === 4);
  await idle();
  const sc3 = ai.asked.slice(nAsk).find((a) => /a cut-out PNG/.test(a.prompt));
  check('和产品图一样：要求保持产品图的角度朝向', sc3 && sc3.images === 1 && /keep the product's orientation/.test(sc3.prompt));
  await page.click('[data-place="ref"] .x');
  await page.waitForFunction(() => !document.querySelector('[data-place="ref"]'));
  check('参考图可以去掉', true);

  // 先画背景再融入：不自动审核，直接显示 AI 图
  await page.click('[data-mode="paste"]');
  await page.waitForSelector('[data-mode="paste"].on');
  await page.click('[data-sty="marble"]');
  await page.waitForSelector('[data-act="generate"]:has-text("生成 2 张")');
  nAsk = ai.asked.length;
  await page.click('[data-act="generate"]');
  await page.waitForFunction(() => document.querySelectorAll('.pendbox .mcard[data-iid]').length === 6);
  await idle();
  const bgAsk = ai.asked.slice(nAsk).filter((a) => a.kind === 'image' && /empty background scene/.test(a.prompt));
  check('先画背景再融入：AI 画了 2 张空背景，然后融入', bgAsk.length === 2 && bgAsk.some((a) => /marble/.test(a.prompt)) && ai.asked.slice(nAsk).filter((a) => /Edit the uploaded image/.test(a.prompt)).length === 2);
  check('融入后不自动审核，直接显示 AI 图', doubao.length === 1 && (await page.locator('.pendbox [data-act="harmView"][data-v="1"].on').count()) === 2);
  await page.click('.pendbox .mcard:has([data-act="harmView"]) [data-act="judge"] >> nth=0');
  await page.waitForSelector('.pendbox .mcard:has-text("审核选了 AI 图：去掉了白边")', { timeout: 30000 });
  check('AI 审核（融入的图）：豆包比一比原贴图和 AI 图', doubao.length === 2 && /哪张更适合/.test(doubao[1].text) && doubao[1].files === 2);
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

  // 关掉网页再打开：后台照样做完
  const url = page.url();
  const nItems = (await api('GET', `/api/projects/${/p=([^&]+)/.exec(url)[1]}`)).project.items.length;
  await page.click('[data-act="generate"]');
  await sleep(200);
  await page.goto('about:blank');
  const pid = /p=([^&]+)/.exec(url)[1];
  let done = false;
  for (let i = 0; i < 100 && !done; i++) { const pp = (await api('GET', `/api/projects/${pid}`)).project; done = pp.items.length > nItems && pp.items.every((x) => !x.job); await sleep(300); }
  check('关掉网页：服务器照样做完', done);
  await page.goto(url);
  await page.waitForSelector('.pendbox .mcard[data-iid]');

  // 主图项目不出现在详情页里
  const detailList = await api('GET', '/api/projects');
  const mainList = await api('GET', '/api/projects?kind=main');
  check('主图项目和详情页项目分开', detailList.list.length === 0 && mainList.list.length === 1 && mainList.list[0].done === 1, JSON.stringify(mainList.list));
  // 素材中心：上传的产品图、采用的主图都自动放进来了
  await page.goto(BASE + '/#/library');
  await page.waitForSelector('.lit');
  const libAll = (await api('GET', '/api/library')).items;
  check('素材中心：产品图（原图）和采用的主图自动放进来了', libAll.some((x) => x.tag === '原图' && x.source === 'main') && libAll.some((x) => x.tag === '主图' && x.source === 'main'));
  check('素材中心：每张图显示尺寸和文件大小，上面显示一共多大', /\d+×\d+ · \d+(\.\d)? (KB|MB)/.test(await page.textContent('.lit')) && /一共 \d+ 张 · 占/.test(await page.textContent('.head')));
  const fc3 = page.waitForEvent('filechooser');
  await page.click('[data-act="upload"]');
  await (await fc3).setFiles({ name: '新产品.png', mimeType: 'image/png', buffer: product('#ffffff') });
  await page.waitForFunction((n) => document.querySelectorAll('.lit').length === n + 1, libAll.length);
  check('素材中心：上传图片', true);
  await page.click('.lit:has-text("新产品.png") .lck');
  await page.waitForSelector('.libbar:has-text("已选 1 张")');
  await page.click('[data-act="toDetail"]');
  await page.fill('#lsName', '新产品');
  await page.click('#libLayer [data-ret="ok"]');
  await page.waitForSelector('#libLayer:has-text("已经放进")');
  await page.click('#libLayer [data-ret=""]');
  const dl3 = (await api('GET', '/api/projects')).list;
  check('素材中心：发送到详情页（新建项目“详情图-新产品…”）', dl3.length === 1 && /^详情图-新产品\d\d-\d\d-2$/.test(dl3[0].name) && dl3[0].assets === 1, JSON.stringify(dl3.map((x) => x.name)));
  await page.screenshot({ path: path.join(out, '5-library.png'), fullPage: true });
  check('素材中心：发完就取消勾选', !(await page.textContent('.libbar')).includes('已选'));
  // 勾了图再换分组：勾选清掉，看不见的图不会跟着发出去
  await page.click('.lit:has-text("新产品.png") .lck');
  await page.waitForSelector('.libbar:has-text("已选 1 张")');
  await page.click('.lgi[data-grp]:not([data-grp=""]) >> nth=0');
  await page.waitForFunction(() => !document.querySelector('.libbar').textContent.includes('已选'));
  await page.click('.lgi[data-grp=""]');
  check('素材中心：换分组后之前的勾选清掉', (await page.locator('.lit.on').count()) === 0);
  await page.click('.lit:has-text("新产品.png") .lck');
  await page.waitForSelector('.libbar:has-text("已选 1 张")');
  await page.click('[data-act="del"]');
  await page.click('#modal [data-ret="yes"]');
  await page.waitForFunction((n) => document.querySelectorAll('.lit').length === n, libAll.length);
  check('素材中心：批量删除', true);
  // 素材中心 PNG：去白边另存一张新图（同一个分组、同一个类型）
  const pngLit = page.locator('.lit:has([data-pe]):has(.lname:text-is("白底.png"))');
  const pngName = '白底';
  const nLit = await page.locator('.lit').count();
  await pngLit.locator('[data-pe]').click();
  await page.waitForSelector('#peLayer #peCv');
  await sleep(300);
  const lb = await (await page.$('#peCv')).boundingBox();
  for (const [fx, fy] of [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4], [0.1, 0.1]]) await page.mouse.click(lb.x + lb.width * fx, lb.y + lb.height * fy);
  await page.click('#peDel');
  await page.click('#peFringeBtn'); // 素材中心页面没有 imagekit.js：点了才加载
  await page.waitForSelector('#peWhite.show');
  check('素材中心：边缘修色能用（用到时才加载）', await page.evaluate(() => typeof defringeAlpha === 'function') && (await page.textContent('#pePanelT')) === '边缘修色');
  await page.click('#peWhiteNo');
  await page.click('#peSaveAs');
  await page.waitForFunction((n) => document.querySelectorAll('.lit').length === n + 1, nLit);
  check('素材中心：PNG 有“去白边”，另存成新图', (await api('GET', '/api/library')).items.some((x) => x.name === pngName + '-去白边.png' && x.mime === 'image/png'), pngName);
  // 保存 = 换掉这张图（张数不变，名字不变，内容变了）
  const lb0 = (await api('GET', '/api/library')).items.find((x) => x.name === '白底.png');
  await page.locator('.lit:has(.lname:text-is("白底.png")) [data-pe]').click();
  await page.waitForSelector('#peLayer #peCv');
  await sleep(300);
  for (const [fx, fy] of [[0.6, 0.6], [0.9, 0.6], [0.9, 0.9], [0.6, 0.6]]) await page.mouse.click(lb.x + lb.width * fx, lb.y + lb.height * fy);
  await page.click('#peDel');
  await page.click('#peSave');
  await page.waitForFunction(() => !document.getElementById('peLayer'));
  await sleep(800);
  const after = (await api('GET', '/api/library')).items.find((x) => x.id === lb0.id);
  check('素材中心：去白边“保存”换掉原图（名字不变、张数不变）', after && after.name === '白底.png' && after.v !== lb0.v && (await page.locator('.lit').count()) === nLit + 1, JSON.stringify([lb0.v, after && after.v]));
  await api('DELETE', `/api/projects/${dl3[0].id}`);

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
plugin2.close();
srv.kill();
console.log('截图在', out);
const bad = checks.filter((x) => !x).length;
console.log(`\n${checks.length - bad}/${checks.length} 通过`);
process.exit(bad ? 1 : 0);
