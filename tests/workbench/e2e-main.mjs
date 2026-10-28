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
const plugin2 = await connect(`ws://127.0.0.1:${PORT}/ext`, { token, name: '测试电脑', version: '1.5.0', app: 'aiweb', sites: [{ site: 'doubao', name: '豆包', open: true, ready: true }, { site: 'deepseek', name: 'DeepSeek', open: true, ready: true }] }, async (m) => {
  if (m.cmd !== 'ask') return { error: '不支持' };
  doubao.push({ t: Date.now(), text: m.args.text, files: (m.args.files || []).length, site: m.site });
  if (/拆成“框模板”/.test(m.args.text)) {
    return { answer: '```json\n' + JSON.stringify({ name: '蓝白 · 大标题', use: '单一服务', style: 'Clean blue and white poster', bg1: '#eef4ff', bg2: '#ffffff', boxes: [{ type: 'block', role: '底部横条', x: 0, y: 85, w: 100, h: 15, bg: '#1d4ed8' }, { type: 'text', role: '大标题', x: 5, y: 20, w: 90, h: 18, color: '#1d4ed8', bold: true, lines: 1 }, { type: 'text', role: '副标题', x: 10, y: 45, w: 80, h: 8, color: '#333333' }, { type: 'icon', role: '产品 logo', x: 35, y: 58, w: 30, h: 22, desc: '电脑' }, { type: 'text', role: '底部口号', x: 5, y: 87, w: 90, h: 10, color: '#ffffff' }, { type: 'bad', role: 'x', x: 'a' }] }) + '\n```' };
  }
  if (/往每个框里写字/.test(m.args.text)) {
    const plans = m.args.text.split(/方案 \d+：/).slice(1).map((sec) => {
      const tpl = /^模板 (\S+?)「/.exec(sec)[1];
      const boxes = {};
      for (const [, id, role] of sec.matchAll(/- (b\d+)（([^，）]+)/g)) boxes[id] = /图标/.test(role) ? 'MySQL 海豚 logo' : role === '大标题' ? '远程装库' : role === '店铺名' ? '专业远程服务' : /标签/.test(role) ? '秒装' + role.slice(-1) : role.replace(/\s/g, '') + '字';
      return { tpl, theme: '核心卖点', boxes };
    });
    return { answer: '```json\n' + JSON.stringify({ plans }) + '\n```' };
  }
  if (/固定版式模板/.test(m.args.text)) {
    const ids = [...m.args.text.matchAll(/方案 \d+：模板 (\w+)/g)].map((x) => x[1]);
    const SL = {
      E: { tag1: '升级', tag2: '远程', tag3: '装库', tag4: '调试', shop: '装机专家', title: '远程安装', sub: 'MySQL 各版本都能装', box1: '秒装环境', box2: '版本任选', box3: '赠送工具', box4: '一对一', foot1: '不成功退', foot2: '售后无忧' },
      F2: { tag: '专业服务 · 快速响应', title: '远程装环境', pill: '环境搭建 · 问题解决', card: '一对一 快速解决', g1: 'MySQL', g2: 'JDK', g3: 'Node', g4: 'IDEA', g5: 'Redis', g6: 'Nginx', g7: 'Navicat', g8: 'Tomcat', a1: '专业团队', a2: '快速响应', a3: '质量保障', a4: '售后无忧' },
    };
    return { answer: '```json\n' + JSON.stringify({ plans: ids.map((id) => ({ tpl: id, theme: id === 'E' ? '核心卖点' : '服务内容', slots: SL[id] || {}, icons: id === 'F2' ? { hero: '笔记本电脑和客服耳机', grid: '各软件的图标' } : {} })) }) + '\n```' };
  }
  if (/文字版方案/.test(m.args.text)) {
    const plan = (theme, extra) => ({ theme, style: '科技简约', colors: '主色 宝蓝 #2B5BFF；文字 深灰 #333333', bgColor: '#F2F4F7', bgColor2: '#FFFFFF', background: '浅灰渐变', layout: '上标签 中标题 下横条', icons: '电脑图标', blocks: [{ pos: '顶部标签', text: '纯净原版 无捆绑', font: '黑体', weight: '中粗', size: 34, y: 12, color: '#333333', effect: '虚线圆角框', bg: '' }, { pos: '大标题', text: '远程安装系统', font: '黑体', weight: '特粗', size: 100, y: 40, color: '#2B5BFF', effect: '白色描边', bg: '' }, { pos: '标签', text: extra, font: '黑体', weight: '粗', size: 32, y: 70, color: '#2B5BFF', effect: '圆角底框', bg: '#E8EEFF' }, { pos: '左栏', text: 'Win7/10/11', font: '黑体', weight: '粗', size: 28, x: 27, y: 58, color: '#FFFFFF', effect: '圆角底框', bg: '#D7263D' }, { pos: '右栏卖点', text: '支持远程一对一', font: '黑体', weight: '中粗', size: 30, x: 72, y: 58, color: '#D7263D', effect: '无', bg: '' }, { pos: '底部横条', text: '装不好不收费', font: '黑体', weight: '粗', size: 48, y: 90, color: '#FFFFFF', effect: '深色底横条', bg: '#1D3FA8' }] });
    return { answer: '```json\n' + JSON.stringify({ plans: [plan('核心卖点', '秒装 Win11'), plan('服务内容', 'Win7/10/11')] }) + '\n```' };
  }
  const out = /哪张更适合/.test(m.args.text) ? { better: 2, why: '去掉了白边，光线更自然' } : /图上的字是 AI 画的/.test(m.args.text) ? { ok: false, text: '最专业的远程装系统', bad: ['最'], why: '有违禁词“最”' } : { ok: true, why: '形状颜色 logo 都一样' };
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
  await page.waitForSelector('.mcard[data-prid]');
  await sleep(1500);
  {
    const mid0 = /p=([^&]+)/.exec(page.url())[1];
    const pr0 = (await api('GET', `/api/projects/${mid0}`)).project.products[0];
    check('上传白底图：保留原来的格式，不自动抠图（卡片显示“原图 PNG”，有“去白底”按钮）', !pr0.cut && (await page.textContent('.mcard[data-prid] .st')).includes('原图 PNG') && (await page.locator('.mcard[data-prid] [data-act="cutDirect"]').count()) === 1, JSON.stringify({ cut: pr0.cut }));
  }
  await page.click('.mcard[data-prid] [data-act="cutDirect"]');
  await page.waitForSelector('.mcard[data-prid] .tag.ok');
  check('点“去白底”：抠成透明 PNG', true);
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
  check('默认做法：AI 直接画场景、AI 自由摆放；实物项目没有“文字版主图”', await page.isVisible('[data-mode="scene"].on') && await page.isVisible('[data-place="free"].on') && (await page.locator('[data-mode="poster"]').count()) === 0);
  await page.click('[data-sty="marble"]');
  check('每种风格最多 6 张', (await page.locator('#count option').count()) === 6 && (await page.locator('#count option').last().textContent()) === '6');
  await page.selectOption('#count', '1');
  await page.waitForSelector('[data-act="generate"]:has-text("生成 2 张")');
  check('选两种风格：生成 2 张', true);
  await page.click('[data-act="generate"]');
  await page.waitForFunction(() => document.querySelectorAll('.pendbox .mcard[data-iid]').length === 2);
  await idle();
  const sc1 = ai.asked.filter((a) => /the product, cut out and placed on a plain white background or photographed on white/.test(a.prompt));
  check('AI 直接画：抠好的图铺白底发给 AI（透明 PNG 发给 Gemini 会出黑点），提示词说透明灯罩、玻璃不要变黑', sc1.length === 2 && /clear lamp lenses/.test(sc1[0].prompt) && sc1[0].files && sc1[0].files[0] && /\.jpg$/.test(sc1[0].files[0]) && sc1[0].mimes[0] === 'image/jpeg', JSON.stringify(sc1[0] && sc1[0].files));
  check('AI 直接画：把抠好的 PNG 发给 AI，让它自由摆放', sc1.length === 2 && sc1.every((a) => a.images === 1 && /you may choose a natural, attractive way/.test(a.prompt)));
  check('每张主图显示时间（北京时间，精确到秒）', (await page.locator('.pendbox .mcard .tag.mtime').count()) === 2 && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test((await page.locator('.pendbox .mcard .tag.mtime').first().textContent()).trim()), await page.locator('.pendbox .mcard .tag.mtime').first().textContent());
  await page.screenshot({ path: path.join(out, '2b-cards.png'), fullPage: true });
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
  const sc2 = ai.asked.slice(nAsk).find((a) => /cut out and placed on a plain white background or photographed on white/.test(a.prompt));
  check('照参考图摆：产品 PNG + 那张图一起发给 AI', sc2 && sc2.images === 2 && /SECOND uploaded image/.test(sc2.prompt));
  await page.click('[data-place="same"]');
  await page.waitForSelector('[data-place="same"].on');
  nAsk = ai.asked.length;
  await page.click('[data-act="generate"]');
  await page.waitForFunction(() => document.querySelectorAll('.pendbox .mcard[data-iid]').length === 4);
  await idle();
  const sc3 = ai.asked.slice(nAsk).find((a) => /cut out and placed on a plain white background or photographed on white/.test(a.prompt));
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

  // 文字主图（Lee 2026-10-27）：新建时选“文字主图”；框模板（线框、悬停看参考图）→ AI 往框里写字 → 改字、拖框、加删框 → 草图 + 模板参考图出图；
  // 存为我的模板（A-1）、从参考图生成模板（J）；AI 根据参考图（自由发挥，默认发送参考图）
  {
    await page.goto(BASE + '/main/');
    await page.click('[data-act="newProj"]');
    await page.fill('#npName', '装系统');
    check('新建主图项目：选“实物主图”还是“文字主图”，默认实物', (await page.locator('input[name="npKind"]').count()) === 2 && await page.isChecked('input[name="npKind"][value="real"]'));
    await page.check('input[name="npKind"][value="text"]');
    await page.click('#modal [data-ret="ok"]');
    await page.waitForSelector('.boxgrid');
    const np = { id: decodeURIComponent(/p=([^&]+)/.exec(page.url())[1]) };
    let sp = (await api('GET', `/api/projects/${np.id}`)).project;
    check('文字主图：项目是文字的（mode poster），默认“模板”做法，9 个内置模板 A～I（线框图），没有产品图、风格、画法选择', sp.mode === 'poster' && sp.textMode && (await page.locator('.boxc').count()) === 9 && (await page.locator('.boxc canvas.wire').count()) === 9 && (await page.locator('[data-pkind="box"].on').count()) === 1 && (await page.locator('[data-mode]').count()) === 0 && (await page.locator('[data-act="addProducts"]').count()) === 0 && await page.isDisabled('[data-act="writeBoxPlans"]'));
    await api('POST', `/api/main/${np.id}/op`, { op: 'set', fields: { mode: 'scene' } });
    check('文字主图不能改成实物', (await api('GET', `/api/projects/${np.id}`)).project.mode === 'poster');
    // 线框缩略图真的画了东西（白底 + 灰线）
    const wirePx = await page.evaluate(() => { const c = document.querySelector('canvas[data-wire="A"]'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let gray = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 200 && Math.abs(d[i] - d[i + 2]) < 20) gray++; return gray; });
    check('模板缩略图是线框（白底、灰线、写着框名）', wirePx > 500, String(wirePx));
    await page.hover('.boxc[data-btpl="A"] canvas');
    await page.waitForSelector('.refhover:not([hidden]) img');
    check('鼠标移到模板上：显示它的参考图', (await page.getAttribute('.refhover img', 'src')) === '/main/tpl/ref/A.jpg');
    await page.mouse.move(5, 5);
    await page.fill('#posterContent', '远程安装 MySQL，5.x～8.x 任意版本，一对一远程，安装不成功全额退款');
    await page.fill('#posterBan', '秒装, 包售后, 退款');
    await page.waitForSelector('#banConflict:not([hidden])');
    check('禁止词和要表达的内容冲突（都有“退款”）：提醒', /退款/.test(await page.textContent('#banConflict')));
    await page.fill('#posterBan', '秒装, 包售后');
    await page.waitForSelector('#banConflict', { state: 'hidden' });
    await page.click('.boxc[data-btpl="A"] canvas');
    await page.waitForSelector('.boxc[data-btpl="A"].on');
    await page.click('.boxc[data-btpl="C"] canvas');
    await page.waitForSelector('.boxc[data-btpl="C"].on');
    check('选模板：点一下选上，按顺序标号', (await page.textContent('.boxc[data-btpl="A"] .tcount')) === '1' && (await page.textContent('.boxc[data-btpl="C"] .tcount')) === '2' && /（2 套）/.test(await page.textContent('[data-act="writeBoxPlans"]')));
    await sleep(700);
    const nd = doubao.length;
    await page.click('[data-act="writeBoxPlans"]');
    await page.waitForSelector('.boxplan[data-plan="1"]', { timeout: 30000 });
    const ask = doubao[nd];
    check('AI 往框里写字：发给豆包，带两个模板的参考图，每个框给出名字和字数上限', ask && ask.site === 'doubao' && ask.files === 2 && /模板 A「红白/.test(ask.text) && /模板 C「描边大字/.test(ask.text) && /b3（大标题）：≤\d+ 字/.test(ask.text) && /图标：产品 logo/.test(ask.text) && /安装不成功全额退款/.test(ask.text) && /秒装/.test(ask.text), ask && ask.text.slice(0, 120));
    check('方案：左边草图编辑器，右边每个文字框、图标框一行', (await page.locator('.boxplan[data-plan="0"] canvas[data-bed]').count()) === 1 && (await page.locator('.boxplan[data-plan="0"] .brow').count()) === 15 && (await page.inputValue('#pb0_b3')) === '远程装库' && (await page.inputValue('#pb0_b4')) === 'MySQL 海豚 logo');
    check('禁止词（自己填的“秒装”）标红', await page.evaluate(() => document.getElementById('pb0_b5').classList.contains('banhit')) && !(await page.isHidden('#pl0_ban')));
    await page.fill('#pb0_b5', 'mysql5.6');
    await page.waitForFunction(() => !document.getElementById('pb0_b5').classList.contains('banhit'));
    // 点表格里的一行：选中框，上面出样式
    await page.click('.boxplan[data-plan="0"] .brow[data-bid="b3"] td:first-child');
    await page.waitForSelector('#bp0_x');
    check('点一行选中框：显示位置、大小、颜色这些样式', (await page.inputValue('#bp0_x')) === '3' && (await page.inputValue('#bp0_w')) === '37');
    // 在草图上拖框：大标题往右拖 10%
    const cb = await (await page.$('canvas[data-bed="0"]')).boundingBox();
    const cx = cb.x + cb.width * 0.2, cy = cb.y + cb.height * 0.255;
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + cb.width * 0.05, cy, { steps: 4 }); await page.mouse.move(cx + cb.width * 0.1, cy, { steps: 4 }); await page.mouse.up();
    await sleep(1200);
    // 拖右下角改大小：宽 +5%
    const rx = cb.x + cb.width * (0.13 + 0.37), ry = cb.y + cb.height * (0.19 + 0.13);
    await page.mouse.move(rx, ry); await page.mouse.down(); await page.mouse.move(rx + cb.width * 0.05, ry, { steps: 5 }); await page.mouse.up();
    await sleep(1200);
    sp = (await api('GET', `/api/projects/${np.id}`)).project;
    let b3 = sp.plans[0].boxes.find((b) => b.id === 'b3');
    check('拖框换位置、拖右下角改大小：存到服务器', Math.abs(b3.x - 13) <= 0.5 && Math.abs(b3.w - 42) <= 0.5 && b3.y === 19 && sp.plans[0].boxes.find((b) => b.id === 'b5').text === 'mysql5.6', JSON.stringify(b3));
    await page.fill('#bp0_y', '20');
    await page.click('canvas[data-bed="0"]', { position: { x: cb.width * 0.3, y: cb.height * 0.27 } });
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.selectOption('.bprops select', 'left');
    await sleep(1200);
    b3 = (await api('GET', `/api/projects/${np.id}`)).project.plans[0].boxes.find((b) => b.id === 'b3');
    check('改样式（上 20%、左对齐）、方向键挪框（←0.5、Shift+←2）', b3.y === 20 && Math.abs(b3.x - 10.5) <= 0.6 && b3.align === 'left', JSON.stringify([b3.x, b3.y, b3.align]));
    // 加框、删框
    const nb = (await api('GET', `/api/projects/${np.id}`)).project.plans[0].boxes.length;
    await page.click('.boxplan[data-plan="0"] [data-act="boxAdd"][data-type="text"]');
    await page.waitForFunction(() => document.querySelectorAll('.boxplan[data-plan="0"] .brow').length === 16);
    await page.fill('#bp0_role', '新卖点');
    await page.click('.boxplan[data-plan="0"] [data-act="boxAdd"][data-type="block"]');
    await page.click('.boxplan[data-plan="0"] [data-act="boxDel"]');
    await sleep(1200);
    sp = (await api('GET', `/api/projects/${np.id}`)).project;
    check('加文字框（改名“新卖点”）、加色块再删掉', sp.plans[0].boxes.length === nb + 1 && sp.plans[0].boxes.some((b) => b.role === '新卖点' && b.type === 'text') && !sp.plans[0].boxes.some((b) => b.type === 'block' && b.role.startsWith('色块')));
    await page.fill('#pb0_b' + sp.plans[0].boxes.find((b) => b.role === '新卖点').id.slice(1), '赠送可视化工具');
    // 看草图
    await page.click('.boxplan[data-plan="0"] [data-act="boxSketch"]');
    await page.waitForSelector('#vwLayer .vwimg');
    check('看草图：草图 + 模板的参考图', /草图/.test(await page.textContent('#vwLayer')));
    await page.keyboard.press('Escape');
    // 存为我的模板 → A-1
    await page.click('.boxplan[data-plan="0"] [data-act="boxSaveTpl"]');
    await page.waitForSelector('#stUse');
    check('存为我的模板：名字按 A-1 往下排', /存为 A-1/.test(await page.textContent('#modal')));
    await page.click('#modal [data-ret="ok"]');
    await page.waitForSelector('.boxc[data-btpl="A-1"]');
    const mine = (await api('GET', '/api/meta/posterBoxTpls')).value;
    check('我的模板 A-1：存了框（不含字）、参考图跟着 A，方案换成 A-1', mine.length === 1 && mine[0].id === 'A-1' && mine[0].parent === 'A' && mine[0].ref === '/main/tpl/ref/A.jpg' && mine[0].boxes.every((b) => !b.text) && mine[0].boxes.some((b) => b.role === '新卖点') && /模板 A-1/.test(await page.textContent('.boxplan[data-plan="0"] .ph')));
    await page.click('.boxplan[data-plan="0"] [data-act="boxSaveTpl"]');
    await page.waitForSelector('#stUse');
    check('再存一次：A-2', /存为 A-2/.test(await page.textContent('#modal')));
    await page.click('#modal [data-ret=""]');
    // 从参考图生成模板 → J
    await page.selectOption('#learnSite', 'doubao');
    const nl = doubao.length;
    const fcl = page.waitForEvent('filechooser');
    await page.click('[data-act="learnUpload"]');
    await (await fcl).setFiles({ name: '新参考.png', mimeType: 'image/png', buffer: product('#ddeeff') });
    await page.waitForSelector('.boxc[data-btpl="J"]', { timeout: 30000 });
    const la = doubao.slice(nl).find((x) => /拆成“框模板”/.test(x.text));
    const mine2 = (await api('GET', '/api/meta/posterBoxTpls')).value;
    const J = mine2.find((t) => t.id === 'J');
    check('上传参考图生成模板：看图的 AI 拆框，存成 J（内置 A～I 后面），自动选上，不认识的框扔掉', la && la.files === 1 && J && J.boxes.length === 5 && J.refKey && J.name === '蓝白 · 大标题' && (await api('GET', `/api/projects/${np.id}`)).project.boxPick.includes('J'));
    await page.hover('.boxc[data-btpl="J"] canvas');
    await page.waitForSelector('.refhover:not([hidden]) img');
    check('J 也能悬停看参考图', /\/api\/blobs\//.test(await page.getAttribute('.refhover img', 'src')));
    await page.mouse.move(5, 5);
    // 出图：草图 + 模板参考图
    await page.uncheck('.boxplan[data-plan="1"] [data-pf="1|on"]');
    await sleep(800);
    // 风格说明在方案里能改；补充说明放最前面；效果选“平面”（Lee 2026-10-28）
    check('方案里显示模板的风格说明（能改）', /red-and-white/.test(await page.inputValue('#pl0_style')));
    await page.fill('#pl0_style', 'Flat red-and-white poster, big red headline with 3D extrusions and drop shadows, red pills.');
    await page.fill('#pl0_note', '不要立体效果');
    await page.click('[data-look="flat"]');
    await page.waitForSelector('[data-look="flat"].on');
    // 背景（Lee 2026-10-28）：跟参考图 / 纯色 / 上下渐变 / 简洁 / 自己写
    check('方案里有背景设置，默认跟参考图', (await page.inputValue('#pl0_bgMode')) === '' && (await page.locator('#pl0_bgMode option').count()) === 5);
    await page.selectOption('#pl0_bgMode', 'custom');
    await page.waitForSelector('#pl0_bgText');
    await page.fill('#pl0_bgText', '浅灰色，不要条纹');
    await sleep(800);
    await page.screenshot({ path: path.join(out, '6-boxplan.png'), fullPage: true });
    const na = ai.asked.length;
    await page.click('[data-act="generate"]');
    await page.waitForFunction(() => document.querySelectorAll('.pendbox .mcard[data-iid]').length === 1);
    await page.waitForFunction(() => !document.querySelector('.pendbox .tag.blue'), null, { timeout: 60000 });
    const g = ai.asked.slice(na).find((a) => /LAYOUT SKETCH/.test(a.prompt));
    check('出图（模板）：发草图 + 模板的参考图 + 风格，字一字不差，不准改', g && g.files.join(',') === '草图.png,模板参考图.jpg' && /大标题：「远程装库」/.test(g.prompt) && /新卖点：「赠送可视化工具」/.test(g.prompt) && /MySQL 海豚 logo/.test(g.prompt) && /copy ONLY its color scheme/.test(g.prompt) && /do not fix, rephrase/.test(g.prompt) && /red-and-white/.test(g.prompt), JSON.stringify(g && g.files));
    check('文字主图的卡片：标“文字版”、有 AI 标签和时间', /文字版/.test(await page.textContent('.pendbox .mcard[data-iid] b')) && (await page.locator('.pendbox .tag.aisite').count()) === 1);
    check('出图：背景自己写的放在前面，参考图不学背景', g && /BACKGROUND \(overrides the reference image and the style text; the shop's words, may be Chinese\): 浅灰色，不要条纹/.test(g.prompt) && /NOT its background/.test(g.prompt));
    check('出图：补充说明放最前面（优先级最高），选了“平面”就去掉风格说明里的立体句子、加上平面要求', g && /TOP PRIORITY — the shop's own requirements.*不要立体效果/.test(g.prompt) && g.prompt.indexOf('不要立体效果') < g.prompt.indexOf('LAYOUT SKETCH') && /FLAT DESIGN/.test(g.prompt) && /Style: Flat red-and-white poster, red pills\./.test(g.prompt) && !/copy its VISUAL STYLE/.test(g.prompt), g && g.prompt.split('\n').find((l) => l.startsWith('- Style')));
    await page.selectOption('#judgeSite', 'deepseek');
    const nj = doubao.length;
    await page.click('.pendbox .mcard[data-iid] [data-act="judge"]');
    await page.waitForSelector('.pendbox .mcard:has-text("文字有问题")', { timeout: 30000 });
    const ja = doubao.slice(nj).find((x) => /图上的字是 AI 画的/.test(x.text));
    check('AI 审核选 DeepSeek：对照框里的字', ja && ja.site === 'deepseek' && /远程装库/.test(ja.text) && /赠送可视化工具/.test(ja.text), JSON.stringify(ja && ja.site));
    await page.selectOption('#judgeSite', 'doubao');
    // AI 根据参考图（自由发挥）
    await page.click('[data-pkind="free"]');
    await page.waitForSelector('#freeStyle');
    check('自由发挥：放参考图，“发送参考图”默认勾上', await page.isChecked('#freeRefs') && (await page.locator('.boxgrid').count()) === 0);
    const fcp = page.waitForEvent('filechooser');
    await page.click('[data-act="posterUpload"]');
    await (await fcp).setFiles({ name: '参考.png', mimeType: 'image/png', buffer: product('#eeeeee') });
    await page.waitForSelector('.mcard.pref');
    await page.selectOption('#freeStyle', 'E');
    await page.waitForFunction(() => document.getElementById('freeStyle').value === 'E');
    await page.selectOption('#freeCount', '2');
    await page.waitForFunction(() => document.querySelector('[data-act="generate"]').textContent.includes('2 张'));
    const nf = ai.asked.length;
    await page.click('[data-act="generate"]');
    await page.waitForFunction(() => document.querySelectorAll('.pendbox .mcard[data-iid]').length === 3);
    await page.waitForFunction(() => !document.querySelector('.pendbox .tag.blue'), null, { timeout: 60000 });
    const fr = ai.asked.slice(nf).filter((a) => /Wanted style/.test(a.prompt));
    check('自由发挥：告诉 AI 风格（选了 E）、要表达的内容、禁止词，参考图一起发', fr.length === 2 && fr.every((a) => /street-promotion/.test(a.prompt) && /远程安装 MySQL/.test(a.prompt) && /秒装/.test(a.prompt) && a.files.join(',') === '参考图1.jpg'));
    await page.uncheck('#freeRefs');
    await sleep(500);
    const nr = ai.asked.length;
    await page.click('.pendbox .mcard[data-iid] [data-act="redraw"] >> nth=0');
    for (let k = 0; k < 100 && !ai.asked.slice(nr).some((a) => /Wanted style/.test(a.prompt)); k++) await sleep(200);
    const fr2 = ai.asked.slice(nr).find((a) => /Wanted style/.test(a.prompt));
    check('不勾“发送参考图”：参考图不发', fr2 && fr2.files.length === 0, JSON.stringify(fr2 && fr2.files));
    await page.waitForFunction(() => !document.querySelector('.pendbox .tag.blue'), null, { timeout: 60000 });
    await page.click('.pendbox [data-act="accept"] >> nth=0');
    await page.waitForSelector('[data-act="dlAll"]');
    const dlp = page.waitForEvent('download');
    await page.click('[data-act="dlAll"]');
    const zp = path.join(out, 'poster.zip');
    await (await dlp).saveAs(zp);
    check('文字主图：采用后可以下载（没有产品图也能打包）', fs.statSync(zp).size > 1000);
    // 删除我的模板
    await page.click('[data-pkind="box"]');
    await page.waitForSelector('.boxc[data-btpl="A-1"] [data-act="btplDel"]');
    check('内置模板不能删，我的模板能删', (await page.locator('.boxc[data-btpl="A"] [data-act="btplDel"]').count()) === 0);
    await page.click('.boxc[data-btpl="A-1"] [data-act="btplDel"]');
    await page.click('#modal [data-ret="yes"]');
    await page.waitForSelector('.boxc[data-btpl="A-1"]', { state: 'detached' });
    check('删除我的模板 A-1', (await api('GET', '/api/meta/posterBoxTpls')).value.map((t) => t.id).join(',') === 'J');
    // 右键编辑模板（Lee 2026-10-28）：删框、挪位置，保存；内置的保存后标“改过”，能恢复原样；也能另存为
    await page.click('.boxc[data-btpl="A"] canvas', { button: 'right' });
    await page.waitForSelector('#teCv');
    check('右键模板：打开编辑，叠着参考图', /编辑模板 A/.test(await page.textContent('#modal')) && await page.isChecked('#teOver') && (await page.getAttribute('.teref', 'src')) === '/main/tpl/ref/A.jpg');
    const tb = await (await page.$('#teCv')).boundingBox();
    await page.mouse.click(tb.x + tb.width * 0.2, tb.y + tb.height * 0.255); // 大标题 b3
    await page.waitForSelector('[data-te="x"]');
    check('点框选中：显示名称和位置', (await page.inputValue('[data-te="role"]')) === '大标题' && (await page.inputValue('[data-te="x"]')) === '3');
    await page.keyboard.press('Delete');
    await page.selectOption('#te_bgMode', 'solid');
    await page.waitForSelector('#teBg input[type="color"]');
    await page.mouse.click(tb.x + tb.width * 0.7, tb.y + tb.height * 0.2); // 产品 logo b4
    const lx = tb.x + tb.width * 0.7, ly = tb.y + tb.height * 0.2;
    await page.mouse.move(lx, ly); await page.mouse.down(); await page.mouse.move(lx - tb.width * 0.1, ly, { steps: 5 }); await page.mouse.up();
    await page.click('#modal [data-ret="save"]');
    await page.waitForSelector('.boxc[data-btpl="A"] .tag:text("改过")');
    let mA = (await api('GET', '/api/meta/posterBoxTpls')).value.find((t) => t.id === 'A');
    check('保存：内置模板 A 存成改过的（少了大标题、logo 往左挪了、背景改纯色），标“改过”', mA && mA.edited && mA.bgMode === 'solid' && mA.builtin && mA.boxes.length === 16 && !mA.boxes.some((b) => b.id === 'b3') && Math.abs(mA.boxes.find((b) => b.id === 'b4').x - 37) <= 0.5 && (await page.locator('.boxc[data-btpl="A"] [data-act="btplDel"]').count()) === 0, JSON.stringify(mA && mA.boxes.find((b) => b.id === 'b4')));
    await page.click('.boxc[data-btpl="A"] canvas', { button: 'right' });
    await page.waitForSelector('#teCv');
    await page.click('#modal [data-te-add="text"]');
    await page.fill('[data-te="role"]', '新标题');
    await page.click('#modal [data-ret="saveas"]');
    await page.waitForSelector('.boxc[data-btpl="A-1"]');
    const mA1 = (await api('GET', '/api/meta/posterBoxTpls')).value.find((t) => t.id === 'A-1');
    check('另存为：新模板 A-1（多了“新标题”框），A 不变', mA1 && mA1.parent === 'A' && mA1.boxes.length === 17 && mA1.boxes.some((b) => b.role === '新标题') && (await api('GET', '/api/meta/posterBoxTpls')).value.find((t) => t.id === 'A').boxes.length === 16);
    await page.click('.boxc[data-btpl="A"] canvas', { button: 'right' });
    await page.waitForSelector('#modal [data-ret="restore"]');
    await page.click('#modal [data-ret="restore"]');
    await page.waitForSelector('.boxc[data-btpl="A"] .tag:text("改过")', { state: 'detached' });
    check('恢复原样：内置模板 A 回到 17 个框', !(await api('GET', '/api/meta/posterBoxTpls')).value.some((t) => t.id === 'A'));
    // 旧项目：用过“文字版主图”的算文字主图
    const old = await api('POST', '/api/main', { name: '旧项目' });
    await api('POST', `/api/main/${old.id}/op`, { op: 'set', fields: { mode: 'poster' } });
    check('实物项目不能改成文字', (await api('GET', `/api/projects/${old.id}`)).project.mode === 'scene');
    await api('DELETE', `/api/projects/${old.id}`);
    await api('DELETE', `/api/projects/${np.id}`);
  }

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
