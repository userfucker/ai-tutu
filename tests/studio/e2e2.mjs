// 详情页工作室第二组测试：设置（品牌、平台尺寸）、淘宝 zip 导入、我的模板、AI 重写、上传背景、批量处理。
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const ext = path.resolve(here, '../../extension');
const outDir = process.argv[2] || path.join(here, 'out2');
fs.mkdirSync(outDir, { recursive: true });
const mock = fs.readFileSync(path.join(here, 'mock-gemini.html'), 'utf8');
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok: !!ok, info }); console.log(`${ok ? '✓' : '✗'} ${name}${info ? '  ' + info : ''}`); };
const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium', headless: true, viewport: { width: 1400, height: 900 }, acceptDownloads: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP gemini.google.com ~NOTFOUND, MAP *.google.com ~NOTFOUND'],
});
await ctx.route('https://gemini.google.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: mock }));
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
const extId = sw.url().split('/')[2];
const errors = [];
ctx.on('page', (pg) => pg.on('pageerror', (e) => errors.push(`${e.message} @ ${(e.stack || '').split('\n').slice(1, 3).join(' ')}`)));
const gemini = await ctx.newPage();
await gemini.goto('https://gemini.google.com/app');
const page = await ctx.newPage();
await page.goto(`chrome-extension://${extId}/studio/studio.html`);
await page.waitForSelector('text=我的项目');
await page.evaluate(() => { ST.AI.testGap = 0; });

// ---------- 设置：品牌 + 平台尺寸
await page.click('[data-act="settings"]');
await page.click('#setTabs [data-tab="brand"]');
await page.click('[data-addbrand]');
await page.waitForSelector('[data-bid] input[data-k="name"]');
await page.fill('[data-bid] input[data-k="name"]', '测试品牌');
const logo = path.join(outDir, 'logo.png');
fs.writeFileSync(logo, Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 60; const g = c.getContext('2d'); g.fillStyle = '#c00'; g.fillRect(0, 0, 200, 60); return c.toDataURL('image/png').split(',')[1]; }), 'base64'));
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-bid] [data-logo]')]);
await fc.setFiles(logo);
await page.waitForFunction(() => APP.brands[0] && APP.brands[0].logo);
await page.click('#setTabs [data-tab="pf"]');
await page.fill('tr[data-pf="jd"] input[data-k="w"]', '990');
await page.click('#modal [data-ret="save"]');
await page.waitForTimeout(300);
const st = await page.evaluate(() => ({ brands: APP.brands.length, name: APP.brands[0].name, jd: ST.platformOf(null, 'jd').w }));
check('设置：加品牌（带 logo）、改京东宽度', st.brands === 1 && st.name === '测试品牌' && st.jd === 990, JSON.stringify(st));

// ---------- 新项目 + 淘宝 zip 导入
await page.click('button:has-text("新建项目")');
await page.selectOption('#fBrand', { label: '测试品牌' });
await page.click('[data-go="assets"]');
const zipFile = path.join(outDir, 'taobao.zip');
const zb64 = await page.evaluate(async () => {
  const img = async (col, w = 400, h = 400) => { const c = ST.canvas(w, h); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = col; g.fillRect(w * 0.3, h * 0.2, w * 0.4, h * 0.6); return ST.toBlob(c, 'image/jpeg'); };
  const data = { item: { title: '测试保温杯 500ml 不锈钢', params: [{ name: '材质', value: '316不锈钢' }, { name: '容量', value: '500ml' }], skuProps: [{ name: '颜色', values: [{ name: '白色' }, { name: '黑色' }] }] },
    rates: { list: [{ content: '保温效果很好' }, { content: '有点重', appendContent: '用久了习惯' }] }, qa: { list: [{ title: '能装开水吗', answers: [{ content: '可以' }] }] } };
  const root = '测试保温杯_123/';
  const files = [
    { name: root + 'data.json', blob: new Blob([JSON.stringify(data)], { type: 'application/json' }) },
    { name: root + '主图/01.jpg', blob: await img('#36c') }, { name: root + '主图/02.jpg', blob: await img('#3a6') },
    { name: root + 'SKU图/01_白色.jpg', blob: await img('#ddd') }, { name: root + 'SKU图/02_黑色.jpg', blob: await img('#222') },
    { name: root + '详情图/01.jpg', blob: await img('#e8d', 750, 900) }, { name: root + '详情图/02.jpg', blob: await img('#8ce', 750, 900) },
  ];
  return ST.blobToB64(await ST.makeZip(files));
});
fs.writeFileSync(zipFile, Buffer.from(zb64, 'base64'));
await page.setInputFiles('#tbInput', zipFile);
await page.waitForSelector('#modal [data-g="main"]');
await page.check('#modal [data-g="desc:详情图"]');
await page.click('#modal [data-ret="ok"]');
await page.waitForFunction(() => APP.project.assets.length === 4 && APP.project.ref, null, { timeout: 30000 });
const imp = await page.evaluate(() => ({ assets: APP.project.assets.map((a) => a.tag + (a.group ? ':' + a.group : '')), name: APP.project.info.name, params: APP.project.info.params.length, colors: APP.project.info.colors, rev: APP.project.reviews.raw.split('\n').length, ref: APP.project.ref.h }));
check('淘宝 zip 导入：主图、SKU 图（规格名）、信息、评价、参考详情图', imp.assets.filter((t) => t.startsWith('spec:')).length === 2 && imp.assets.includes('spec:白色') && imp.name.startsWith('测试保温杯') && imp.params === 2 && imp.rev === 3 && imp.ref > 1000, JSON.stringify(imp));

// ---------- 用我的模板（先在别的数据里塞一个模板）
await page.evaluate(async () => {
  APP.mytpls.push({ id: 't1', name: '测试模板', created: Date.now(), tone: 'pro', platform: 'taobao-m', screens: [
    { tpl: 'hero', purpose: '首屏', ov: { title: { dy: 20 } }, shadow: { dir: 'bl', op: 0.5 }, items: 2, icons: [], bg: { mode: 'ai', prompt: 'blue studio', color: '', key: '' } },
    { tpl: 'features3', purpose: '卖点', ov: {}, shadow: {}, items: 3, icons: ['shield', 'bolt', 'leaf'], bg: { mode: 'color', prompt: '', color: '#eef3fa', key: '' } },
    { tpl: 'service', purpose: '保障', ov: {}, shadow: {}, items: 2, icons: ['truck', 'headset'], bg: { mode: 'color', prompt: '', color: '', key: '' } },
  ] });
  await ST.db.setMeta('mytpls', APP.mytpls);
});
await page.click('[data-go="outline"]');
await page.click('button:has-text("用我的模板")');
await page.click('#modal [data-ret="ai:t1"]');
await page.waitForFunction(() => APP.project.screens.length === 3 && !APP.outlineBusy, null, { timeout: 60000 });
const mt = await page.evaluate(() => APP.project.screens.map((s) => ({ tpl: s.tpl, title: s.text.title && s.text.title['zh-CN'], ov: s.ov.title, color: s.bg.color, icons: s.items.map((i) => i.icon).join(',') })));
check('用我的模板 + AI 写文案：结构、调整、图标用模板的，文字用 AI 的', mt[0].tpl === 'hero' && mt[0].title && mt[0].ov && mt[0].ov.dy === 20 && mt[1].color === '#eef3fa' && mt[1].icons === 'shield,bolt,leaf', JSON.stringify(mt));

// ---------- 编辑：AI 重写、上传背景、logo 显示
await page.click('[data-go="edit"]');
await page.waitForSelector('#edCanvas');
await page.click('button:has-text("AI 重写这屏文案")');
await page.waitForFunction(() => /（新）/.test(APP.project.screens[0].text.title['zh-CN']), null, { timeout: 60000 });
check('AI 重写这屏文案', true);
const boxes = await page.evaluate(() => APP.ed.last.boxes.map((b) => b.id));
check('首屏有品牌 logo', boxes.includes('logo'), boxes.join(','));
await page.selectOption('#bgMode', 'upload');
await page.waitForSelector('button:has-text("选择背景图")');
await page.setInputFiles('#bgInput', logo);
await page.waitForFunction(() => APP.project.screens[0].bg.mode === 'upload' && APP.project.screens[0].bg.key);
check('上传自己的背景图', true);
// 加一屏、复制、删除、上下移动
await page.selectOption('#edAddTpl', 'compare');
await page.click('button:has-text("＋ 加一屏")');
await page.click('button:has-text("复制这屏")');
const n1 = await page.evaluate(() => APP.project.screens.map((s) => s.tpl).join(','));
await page.click('[data-act="moveScreen"][data-d="-1"]');
const n2 = await page.evaluate(() => APP.project.screens.map((s) => s.tpl).join(','));
check('编辑页加一屏 / 复制 / 移动', n1 === 'hero,compare,compare,features3,service' && n2 === 'hero,compare,compare,features3,service', `${n1} → ${n2}`);
await page.screenshot({ path: path.join(outDir, 'edit.png') });

// ---------- 首页批量：两个项目都生成背景
await page.click('[data-act="home"]');
await page.waitForSelector('.proj');
await page.evaluate(async () => {
  // 第二个项目：复制成新产品，再塞一张素材和默认提纲
  const list = await ST.db.listProjects();
  const p2 = await APP.cloneLayout(list[0], '批量测试');
  const c = ST.canvas(300, 300); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 300, 300); g.fillStyle = '#933'; g.fillRect(100, 60, 100, 180);
  const key = `${p2.id}:a1-orig`; await ST.saveImage(key, await ST.toBlob(c));
  p2.assets.push({ id: 'a1', name: 'x.png', tag: 'white', note: '', group: '', key, w: 300, h: 300 });
  p2.screens.forEach((s) => { s.bg.key = ''; if (s.tpl === 'hero') s.bg.mode = 'ai'; });
  await ST.db.putProject(p2);
  APP.homeSel = new Set([p2.id]);
  APP.render();
});
await page.waitForSelector('button:has-text("依次生成缺的背景")');
await page.click('button:has-text("依次生成缺的背景")');
await page.click('#modal [data-ret="yes"]');
await page.waitForSelector('text=批量处理结束', { timeout: 120000 });
const b = await page.evaluate(async () => { const p = (await ST.db.listProjects()).find((x) => x.name === '批量测试'); return { bg: p.screens.filter((s) => s.bg.mode === 'ai' && s.bg.key).length, miss: p.langs.length }; });
check('首页批量：生成缺的背景', b.bg === 1, JSON.stringify(b));

check('页面没有报错', !errors.length, errors.slice(0, 4).join(' || '));
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} 通过`);
await ctx.close();
process.exit(bad.length ? 1 : 0);
