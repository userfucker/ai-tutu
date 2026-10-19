// 详情页工作室端到端测试：加载插件 + 模拟 Gemini 页面，把 7 步走一遍。
// 用法：node tests/studio/e2e.mjs [截图目录]
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const ext = path.resolve(here, '../../extension');
const outDir = process.argv[2] || path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });
const mock = fs.readFileSync(path.join(here, 'mock-gemini.html'), 'utf8');
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok: !!ok, info }); console.log(`${ok ? '✓' : '✗'} ${name}${info ? '  ' + info : ''}`); };

const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium', headless: true, viewport: { width: 1400, height: 900 }, acceptDownloads: true,
  // 防止测试误连真的 Gemini：没被拦截的请求一律解析失败
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP gemini.google.com ~NOTFOUND, MAP *.google.com ~NOTFOUND'],
});
await ctx.route('https://gemini.google.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: mock }));
let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
const extId = sw.url().split('/')[2];
const errors = [];
ctx.on('page', (pg) => {
  pg.on('pageerror', (e) => errors.push(`${pg.url().slice(0, 60)}: ${e.message} @ ${(e.stack || '').split('\n').slice(1, 3).join(' ')}`));
  pg.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(`${pg.url().slice(0, 60)} console: ${m.text()}`); });
});

// 先用测试浏览器打开（模拟的）Gemini 页面：插件自己新开的窗口拦截不到，工作室会找到这个页面并移到单独窗口
const gemini = await ctx.newPage();
await gemini.goto('https://gemini.google.com/app');
const page = await ctx.newPage();
await page.goto(`chrome-extension://${extId}/studio/studio.html`);
await page.waitForSelector('text=我的项目');
await page.evaluate(() => { ST.AI.testGap = 0; });
await page.screenshot({ path: path.join(outDir, '01-home.png') });
check('首页打开', await page.isVisible('text=新建项目'));

// ---------- ① 新建项目
await page.click('button:has-text("新建项目")');
await page.waitForSelector('text=① 新建项目');
await page.fill('#fName', '男士双肩包');
await page.click('[data-also="amazon-a"]');
await page.click('[data-lang="en"]');
await page.click('[data-lang="ar"]');
await page.click('[data-tone="luxury"]');
await page.screenshot({ path: path.join(outDir, '02-setup.png'), fullPage: true });
let proj = await page.evaluate(() => ({ pf: APP.project.platforms, langs: APP.project.langs, tone: APP.project.tone, name: APP.project.name }));
check('新建项目：平台/语言/风格', proj.pf.includes('amazon-a') && proj.langs.join() === 'en,ar' && proj.tone === 'luxury' && proj.name === '男士双肩包', JSON.stringify(proj));

// ---------- ② 素材
await page.click('[data-go="assets"]');
const mk = async (name, fn) => {
  const b64 = await page.evaluate(fn);
  const f = path.join(outDir, name);
  fs.writeFileSync(f, Buffer.from(b64, 'base64'));
  return f;
};
const white = await mk('white.png', () => { const c = document.createElement('canvas'); c.width = 600; c.height = 800; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 800); g.fillStyle = '#333'; g.fillRect(150, 100, 300, 600); g.fillStyle = '#c33'; g.fillRect(250, 300, 100, 60); return c.toDataURL('image/png').split(',')[1]; });
const detail = await mk('detail.png', () => { const c = document.createElement('canvas'); c.width = 500; c.height = 500; const g = c.getContext('2d'); g.fillStyle = '#8a6'; g.fillRect(0, 0, 500, 500); g.fillStyle = '#fff'; g.fillRect(100, 220, 300, 60); return c.toDataURL('image/png').split(',')[1]; });
const spec = await mk('spec.png', () => { const c = document.createElement('canvas'); c.width = 600; c.height = 600; const g = c.getContext('2d'); g.fillStyle = '#ddd'; g.fillRect(0, 0, 600, 600); g.fillStyle = '#777'; g.fillRect(180, 120, 240, 360); return c.toDataURL('image/png').split(',')[1]; });
await page.setInputFiles('#assetInput', [white, detail, spec]);
await page.waitForSelector('.asset >> nth=2');
const tags = await page.$$eval('.asset select[data-k=tag]', (l) => l.map((s) => s.value));
check('上传 3 张图，白底图自动标成白底主图', tags.length === 3 && tags[0] === 'white', tags.join(','));
await page.selectOption('.asset >> nth=1 >> select[data-k=tag]', 'detail');
await page.fill('.asset >> nth=1 >> input[data-k=note]', '加厚拉链');
await page.selectOption('.asset >> nth=2 >> select[data-k=tag]', 'spec');
await page.waitForSelector('.asset >> nth=2 >> input[data-k=group]');
await page.fill('.asset >> nth=2 >> input[data-k=group]', '灰色');
await page.click('button:has-text("全部抠图")');
// 白底图直接去白底；规格图（灰底）交给 AI（模拟 Gemini 出白底图）
await page.waitForFunction(() => APP.project.assets.filter((a) => a.cut).length >= 2, null, { timeout: 90000 });
const cuts = await page.evaluate(() => APP.project.assets.map((a) => ({ tag: a.tag, cut: !!a.cut, white: !!a.white, box: a.cutBox && [Math.round(a.cutBox.w), Math.round(a.cutBox.h)] })));
check('全部抠图：白底直接去白底、灰底走 AI', cuts[0].cut && !cuts[0].white && cuts[2].cut && cuts[2].white, JSON.stringify(cuts));
check('白底图抠图后的产品外框接近 300×600', cuts[0].box && Math.abs(cuts[0].box[0] - 300) < 30 && Math.abs(cuts[0].box[1] - 600) < 40, JSON.stringify(cuts[0].box));
const aiPages = ctx.pages().filter((p) => p.url().includes('gemini.google.com'));
check('找到 Gemini 页面并移到单独窗口', aiPages.length === 1 && (await page.evaluate(async () => { const t = (await chrome.tabs.query({ url: 'https://gemini.google.com/*' }))[0]; const me = await chrome.windows.getCurrent(); return t && t.windowId !== me.id; })));
await page.screenshot({ path: path.join(outDir, '03-assets.png'), fullPage: true });

// 修边：擦掉一块
await page.click('.asset >> nth=0 >> button:has-text("修边")');
await page.waitForSelector('#tCanvas');
const cb = await page.locator('#tCanvas').boundingBox();
await page.mouse.move(cb.x + cb.width * 0.5, cb.y + cb.height * 0.3);
await page.mouse.down();
await page.mouse.move(cb.x + cb.width * 0.5, cb.y + cb.height * 0.5, { steps: 8 });
await page.mouse.up();
await page.click('#modal [data-ret="save"]');
await page.waitForSelector('text=修边已保存');
check('修边保存', true);

// ---------- ③ 产品信息
await page.click('[data-go="info"]');
await page.fill('[data-info="name"]', '男士商务双肩包');
await page.fill('[data-info="material"]', '防泼水牛津布');
await page.fill('[data-info="weight"]', '0.9 kg');
await page.fill('[data-dim="l"]', '15');
await page.fill('[data-dim="w"]', '30');
await page.fill('[data-dim="h"]', '45');
await page.click('button:has-text("把上面的材质")');
await page.click('button:has-text("自己加")');
await page.fill('[data-ptext] >> nth=0', '15.6寸电脑独立仓');
await page.click('button:has-text("AI 再想几个")');
await page.waitForFunction(() => APP.project.points.length >= 4, null, { timeout: 60000 });
await page.fill('#revRaw', '评价：肩带有点勒\n评价：下雨也不湿');
await page.click('button:has-text("AI 总结")');
await page.waitForFunction(() => APP.project.reviews.concerns.length >= 1, null, { timeout: 60000 });
// 勾选 AI 建议的卖点
await page.evaluate(() => { APP.project.points.forEach((p) => (p.on = true)); APP.render(); });
await page.click('button:has-text("AI 润色勾选的")');
await page.waitForFunction(() => APP.project.points.some((p) => /润色后/.test(p.text)), null, { timeout: 60000 });
const info = await page.evaluate(() => ({ params: APP.project.info.params, n: APP.project.points.length, c: APP.project.reviews.concerns.length }));
check('产品信息：参数表、卖点、评价总结、润色', info.params.length === 3 && info.n >= 5 && info.c === 2, JSON.stringify(info));
await page.screenshot({ path: path.join(outDir, '04-info.png'), fullPage: true });

// ---------- ④ 参考详情图
await page.click('[data-go="ref"]');
const refImg = await mk('ref.png', () => { const c = document.createElement('canvas'); c.width = 750; c.height = 3000; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 750, 3000); const cols = ['#e8d', '#8ce', '#ec8', '#9d9']; cols.forEach((col, i) => { g.fillStyle = col; g.fillRect(0, i * 750 + 20, 750, 700); }); return c.toDataURL('image/png').split(',')[1]; });
await page.setInputFiles('#refInput', [refImg]);
await page.waitForFunction(() => APP.project.ref && document.querySelectorAll('.seg').length, null, { timeout: 30000 }).catch(async () => { console.log('ref 调试', errors, await page.evaluate(() => JSON.stringify(APP.project.ref))); });
const cutsN = await page.$$eval('.cut', (l) => l.length);
check('参考图自动切屏（4 段 → 3 条切线）', cutsN === 3, `切线 ${cutsN}`);
await page.click('button:has-text("AI 分析每一屏")');
await page.waitForFunction(() => APP.project.ref.analysis.length === 4, null, { timeout: 60000 });
check('AI 分析参考图', true);
await page.screenshot({ path: path.join(outDir, '05-ref.png'), fullPage: true });

// ---------- ⑤ 提纲
await page.click('button:has-text("按参考图列提纲")');
await page.waitForFunction(() => APP.project.screens.length === 8 && !APP.outlineBusy, null, { timeout: 60000 });
const sc = await page.evaluate(() => APP.project.screens.map((s) => s.tpl + ':' + (s.slots.main ? 'M' : '') + s.items.map((i) => (i.asset ? 'a' : '-')).join('')));
check('AI 列提纲：8 屏，自动配图', sc.length === 8 && sc[0].startsWith('hero:M'), sc.join(' '));
await page.screenshot({ path: path.join(outDir, '06-outline.png'), fullPage: true });
// 改一个标题、撤销
await page.fill('input[data-path="text:title"] >> nth=0', '改过的标题');
await page.locator('input[data-path="text:title"] >> nth=0').blur();
await page.waitForTimeout(200);
const t1 = await page.evaluate(() => APP.project.screens[0].text.title['zh-CN']);
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
const t2 = await page.evaluate(() => APP.project.screens[0].text.title['zh-CN']);
check('提纲改字 + 撤销', t1 === '改过的标题' && t2 === '通勤出差一包装下', `${t1} → ${t2}`);

// ---------- ⑥ 生成和编辑
await page.click('[data-go="edit"]');
await page.waitForSelector('#edCanvas');
await page.click('button:has-text("生成全部背景")');
await page.waitForFunction(() => APP.project.screens.filter((s) => s.bg.mode === 'ai').every((s) => s.bg.key), null, { timeout: 120000 });
const bgs = await page.evaluate(() => ({ n: APP.project.screens.filter((s) => s.bg.key).length, style: !!APP.project.style.styleRef }));
check('生成全部背景 + 风格参考', bgs.n >= 2 && bgs.style, JSON.stringify(bgs));
// 第二张以后的背景带了风格参考图
const files = await aiPages[0].evaluate(() => window.__mock.files);
check('后面的背景发了风格参考图', files.some((f) => f.includes('风格参考.jpg')), JSON.stringify(files.slice(-3)));
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(outDir, '07-edit.png') });

// 拖动标题
const before = await page.evaluate(() => APP.ed.last.boxes.find((b) => b.id === 'title'));
const box = await page.locator('#edCanvas').boundingBox();
const s = box.width / 1000;
await page.mouse.move(box.x + (before.x + before.w / 2) * s, box.y + (before.y + before.h / 2) * s);
await page.mouse.down();
await page.mouse.move(box.x + (before.x + before.w / 2) * s + 40, box.y + (before.y + before.h / 2) * s + 30, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(300);
const ov = await page.evaluate(() => APP.project.screens[0].ov.title);
check('拖动标题', ov && ov.dy > 0, JSON.stringify(ov));
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
check('拖动后撤销', !(await page.evaluate(() => APP.project.screens[0].ov.title)));

// 右边改字
await page.mouse.click(box.x + (before.x + before.w / 2) * s, box.y + (before.y + before.h / 2) * s);
await page.waitForSelector('#txtVal');
await page.fill('#txtVal', '最好的双肩包');
await page.waitForTimeout(300);
check('右边改字 + 实时违禁词提示', await page.isVisible('text=违禁词“最”'));
await page.fill('#txtVal', '通勤出差一包装下');
await page.locator('#txtVal').blur();

// 翻译
await page.click('button:has-text("翻译（缺")');
await page.waitForFunction(() => Object.keys(ST.missingTexts(APP.project, 'en')).length === 0 && Object.keys(ST.missingTexts(APP.project, 'ar')).length === 0, null, { timeout: 120000 });
check('翻译成英语和阿拉伯语', true);
await page.click('[data-elang="ar"]');
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(outDir, '08-edit-ar.png') });
await page.click('[data-elang="en"]');
await page.click('[data-epf="amazon-a"]');
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(outDir, '09-edit-amazon.png') });
const land = await page.evaluate(() => [APP.ed.last.canvas.width, APP.ed.last.canvas.height]);
check('切到亚马逊 A+ 横版', Math.abs(land[0] / land[1] - 970 / 600) < 0.02, land.join('×'));
await page.click('button:has-text("整页预览")');
await page.waitForFunction(() => document.querySelectorAll('.preview img').length === APP.project.screens.length, null, { timeout: 30000 });
await page.screenshot({ path: path.join(outDir, '10-preview.png'), fullPage: true });
check('整页预览', true);
await page.click('button:has-text("整页预览")');
await page.click('[data-elang="zh-CN"]');
await page.click('[data-epf="taobao-m"]');

// 存成我的模板
await page.click('button:has-text("存成我的模板")');
await page.fill('#askInput', '双肩包排版');
await page.click('#modal [data-ret="ok"]');
await page.waitForFunction(() => APP.mytpls.length === 1);
check('存成我的模板', true);

// ---------- ⑦ 检查和导出
await page.click('[data-go="export"]');
await page.click('button:has-text("开始检查")');
await page.waitForFunction(() => APP.ex.issues && !APP.ex.checking, null, { timeout: 120000 });
const issues = await page.evaluate(() => APP.ex.issues.map((i) => i.type + ':' + i.lang + ':' + (i.msg || '').slice(0, 20)));
check('检查出违禁词（最快发货）', issues.some((i) => i.startsWith('banned:zh-CN') && i.includes('最')), issues.filter((i) => i.startsWith('banned')).join(' | '));
await page.screenshot({ path: path.join(outDir, '11-check.png'), fullPage: true });
await page.click('[data-xo="backup"]');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), page.click('button:has-text("导出 zip")')]);
const zipPath = path.join(outDir, 'export.zip');
await dl.saveAs(zipPath);
const names = await page.evaluate(async (b64) => { const blob = ST.b64ToBlob(b64, 'application/zip'); return (await ST.readZip(blob)).map((f) => f.name + ':' + f.blob.size); }, fs.readFileSync(zipPath).toString('base64'));
check('导出 zip：3 语言 × 2 平台的长图', names.filter((n) => /长图/.test(n)).length === 6, `${names.length} 个文件`);
check('导出 zip：切片和文案', names.some((n) => /切片\/01\.jpg/.test(n)) && names.some((n) => /文案\.txt/.test(n)));
check('导出 zip：项目备份', names.some((n) => /项目备份/.test(n)));
fs.writeFileSync(path.join(outDir, 'export-list.txt'), names.join('\n'));
// 长图拿出来看一眼
const longB64 = await page.evaluate(async (b64) => {
  const files = await ST.readZip(ST.b64ToBlob(b64, 'application/zip'));
  const f = files.find((x) => /淘宝.*简体中文\/长图/.test(x.name));
  return ST.blobToB64(f.blob);
}, fs.readFileSync(zipPath).toString('base64'));
fs.writeFileSync(path.join(outDir, '12-long-zh.jpg'), Buffer.from(longB64, 'base64'));

// ---------- 首页：复制成新产品 + 导入备份
await page.click('[data-act="home"]');
await page.waitForSelector('.proj');
await page.click('.proj >> nth=0 >> button:has-text("复制成新产品")');
await page.fill('#askInput', '女士双肩包');
await page.click('#modal [data-ret="ok"]');
await page.waitForSelector('text=② 素材');
const copy = await page.evaluate(() => ({ n: APP.project.screens.length, bg: APP.project.screens.filter((s) => s.bg.key).length, assets: APP.project.assets.length, t: APP.project.screens[0].text }));
check('复制成新产品：排版和背景保留，素材文案清空', copy.n === 8 && copy.bg >= 2 && copy.assets === 0 && !copy.t.title, JSON.stringify(copy).slice(0, 120));
await page.click('[data-act="home"]');
await page.setInputFiles('#importInput', names.find((n) => /项目备份/.test(n)) ? await (async () => {
  const p = path.join(outDir, 'backup.aitutu.zip');
  const b64 = await page.evaluate(async (zb64) => { const files = await ST.readZip(ST.b64ToBlob(zb64, 'application/zip')); const f = files.find((x) => /项目备份/.test(x.name)); return ST.blobToB64(f.blob); }, fs.readFileSync(zipPath).toString('base64'));
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
})() : []);
await page.waitForSelector('text=（导入）');
const imported = await page.evaluate(async () => { const l = await ST.db.listProjects(); const p = l.find((x) => /导入/.test(x.name)); const r = await ST.renderScreen(p, p.screens[0], { platform: ST.platformOf(p, p.platform), lang: p.lang, pxWidth: 300 }); return { n: p.screens.length, issues: r.issues.map((i) => i.type) }; });
check('导入项目备份，图片都在', imported.n === 8 && !imported.issues.includes('nobg') && !imported.issues.includes('noimg'), JSON.stringify(imported));
await page.screenshot({ path: path.join(outDir, '13-home.png'), fullPage: true });

// ---------- 面板上的“做详情页”按钮
const gp = aiPages[0];
await gp.bringToFront();
const host = gp.locator('#aitutu-panel-host');
await host.locator('#fileInput').setInputFiles(white);
await host.locator('.thumb').first().waitFor();
await host.locator('#studioBtn').click();
await page.waitForFunction(() => APP.project && APP.project.assets.length === 1 && APP.step !== 'home', null, { timeout: 20000 });
check('面板“做详情页”把图带进工作室', true);

check('页面没有报错', !errors.length, errors.slice(0, 5).join(' || '));
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 1));
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} 通过`);
await ctx.close();
process.exit(bad.length ? 1 : 0);
