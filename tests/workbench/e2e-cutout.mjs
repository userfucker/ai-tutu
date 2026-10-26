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
  check('打开工作台默认是抠白底图，右上角是“新建项目”（没有“打开”）', await page.isVisible('[data-new="cutout"]') && !(await page.locator('a:text("打开抠白底图")').count()));
  await page.click('[data-new="cutout"]');
  await page.fill('#npName', '钱包');
  await page.click('#modal [data-ret="ok"]');
  await page.waitForURL(/\/cutout\/#p=/);
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
  await page.mouse.move(st.x + st.width / 2, st.y + st.height / 2);
  await page.mouse.wheel(0, -300); await sleep(200);
  const zv = await page.textContent('#ceZoomV');
  await page.click('#ceDark');
  check('编辑框：滚轮放大、深色底', zv !== '100%' && await page.evaluate(() => document.getElementById('ceStage').classList.contains('dark')), zv);
  await page.click('#ceDark'); await page.click('#ceZoomFit');
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
  check('PNG 产品图：透明格子底 + PNG 角标', (await page.locator('.thumb.png .fmt').count()) === 2);
  await page.click('[data-act="darkThumbs"]'); await sleep(300);
  check('产品图“深色底”开关', (await page.locator('.thumbs.darkthumbs').count()) === 1 && (await page.locator('.job img.checker.dk').count()) === 2);
  await page.click('[data-act="darkThumbs"]'); await sleep(300);
  check('缩略图打 ✓；结果有尺寸（800×800）', (await page.locator('.thumb.done').count()) === 2 && p.jobs.every((j) => j.w === 800 && j.h === 800 && j.outKey));
  const lib = (await api('GET', '/api/library')).items;
  // （假 AI 两次给的是同一张图，素材中心同一组里一样的图只存一份）
  check('做好的白底图自动放进素材中心（白底图），原图也在', lib.filter((x) => x.tag === '白底图' && x.source === 'cutout').length >= 1 && p.jobs.every((j) => j.libId) && lib.filter((x) => x.tag === '原图' && x.source === 'cutout').length === 2);
  await page.screenshot({ path: path.join(out, '2-done.png'), fullPage: true });

  // 看大图：滚轮缩放、拖动、PNG 深色底
  await page.click('.job img[data-view="out"] >> nth=0');
  await page.waitForSelector('#vwLayer .vwimg');
  await page.waitForFunction(() => document.querySelector('#vwLayer .vwimg').naturalWidth > 0);
  const tf0 = await page.$eval('#vwLayer .vwimg', (e) => e.style.transform);
  await page.mouse.move(700, 400);
  await page.mouse.wheel(0, -300);
  await sleep(200);
  const tf1 = await page.$eval('#vwLayer .vwimg', (e) => e.style.transform);
  check('点结果图看大图，滚轮可以放大', tf0 !== tf1 && /scale\(/.test(tf1), `${tf0} → ${tf1}`);
  const cur = await page.$eval('#vwLayer .vwimg', (e) => getComputedStyle(e).cursor);
  await page.mouse.down(); await page.mouse.move(600, 350, { steps: 4 }); await page.mouse.up();
  check('鼠标是抓手，可以拖动', cur === 'grab' && (await page.$eval('#vwLayer .vwimg', (e) => e.style.transform)) !== tf1, cur);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('vwLayer'));

  // 重做
  const n0 = asks.length;
  await page.click('.job >> nth=0 >> [data-act="redo"]');
  await page.waitForFunction(() => document.querySelectorAll('.job .tag.ok').length === 2 && !document.querySelector('.job .tag.blue'), null, { timeout: 60000 });
  await sleep(500);
  check('重做：重新交给 AI（用这张上次的要求）', ai.asked.filter((a) => /a refined e-commerce product photo/.test(a.prompt)).length === n0 + 1 && /黑色皮质钱包/.test(ai.asked[ai.asked.length - 1].prompt));

  // 打 × 的不做；做过的（✓）点“开始这一批”照样再做
  await page.click('.thumb >> nth=0 >> .sk');
  await page.waitForSelector('.thumb.skip');
  const j0 = (await proj()).jobs, nj = j0.length, na = ai.asked.length;
  await page.click('[data-act="start"]');
  await page.waitForFunction((n) => document.querySelectorAll('.job').length === n + 1 && !document.querySelector('.job .tag.blue'), nj, { timeout: 60000 });
  await sleep(500);
  const pj = await proj();
  check('打 × 的不做，做过的照样再做（不提示“都做过了”）', pj.jobs.length === nj + 1 && pj.jobs.find((j) => !j0.some((x) => x.id === j.id)).fileId === pj.files[1].id && ai.asked.length === na + 1);
  await page.click('.thumb >> nth=0 >> .sk');
  await page.waitForFunction(() => !document.querySelector('.thumb.skip'));
  check('再点 × 就取消', !(await proj()).files[0].skip);

  // 去白边（钢笔）：PNG 产品图 → 选区删除 → 撤销 / 重做 → 一键去白边 → 另存成新产品图（在原图后面）
  await page.hover('.thumb >> nth=0');
  await page.click('.thumb >> nth=0 >> .pe');
  await page.waitForSelector('#peLayer #peCv');
  await sleep(300);
  check('去白边：边缘默认“硬”，强度默认 0（范围 0~20），保存 / 另存还没改时是灰的', (await page.inputValue('#peEdge')) === 'hard' && (await page.inputValue('#peStr')) === '0' && (await page.getAttribute('#peStr', 'max')) === '20' && await page.isDisabled('#peSave') && await page.isDisabled('#peSaveAs'));
  check('去白边：默认深色底', await page.evaluate(() => document.getElementById('peStage').classList.contains('dark')));
  const cb = await (await page.$('#peCv')).boundingBox();
  const P2 = (fx, fy) => [cb.x + cb.width * fx, cb.y + cb.height * fy];
  await page.mouse.click(...P2(0.3, 0.3));
  await page.mouse.click(...P2(0.7, 0.3));
  // 按住拖动拉出弧线
  await page.mouse.move(...P2(0.7, 0.7)); await page.mouse.down(); await page.mouse.move(...P2(0.75, 0.8), { steps: 4 }); await page.mouse.up();
  await page.mouse.click(...P2(0.5, 0.9));
  // 右键删掉最后一个锚点，退格再删一个，再补回来
  await page.mouse.click(...P2(0.5, 0.9), { button: 'right' });
  let st2 = await page.evaluate(() => ({ n: document.getElementById('peLayer')._pe.pts.length, h: !!document.getElementById('peLayer')._pe.pts[2].h }));
  check('钢笔：点一下加锚点、拖动出弧线、右键删锚点', st2.n === 3 && st2.h, JSON.stringify(st2));
  // 不在锚点上右键：删最近加的那个
  await page.mouse.click(...P2(0.9, 0.9));
  await page.mouse.click(...P2(0.1, 0.95), { button: 'right' });
  check('不在锚点上右键：删掉最近加的锚点', await page.evaluate(() => document.getElementById('peLayer')._pe.pts.length) === 3);
  await page.keyboard.press('Backspace');
  check('退格删最后一个点', await page.evaluate(() => document.getElementById('peLayer')._pe.pts.length) === 2);
  await page.mouse.click(...P2(0.7, 0.7));
  await page.mouse.click(...P2(0.3, 0.7));
  await page.mouse.click(...P2(0.3, 0.3)); // 点回第一个点：闭合
  check('点回第一个点闭合，出现蚂蚁线', await page.evaluate(() => document.getElementById('peLayer')._pe.closed) && (await page.locator('#peSvg .ants2').count()) === 1);
  await page.mouse.move(...P2(0.5, 0.5));
  await page.mouse.wheel(0, -600); await sleep(300);
  const ln = await page.evaluate(() => { const svg = document.getElementById('peSvg'), z = parseFloat(document.getElementById('peZoomV').textContent); return { z, scale: svg.getScreenCTM().a, inZoom: !!svg.closest('#peWrap'), w: getComputedStyle(svg.querySelector('.ants2')).strokeWidth }; });
  check('放大以后钢笔线还是 1 像素', ln.z > 200 && ln.scale === 1 && !ln.inZoom && ln.w === '1px', JSON.stringify(ln));
  await page.screenshot({ path: path.join(out, '3-pen-zoom.png') });
  await page.click('#peFit');
  await page.screenshot({ path: path.join(out, '3-pen.png') });
  await page.keyboard.press('Delete');
  check('Delete：选区变透明（可以撤销）', await page.evaluate(() => document.getElementById('peLayer')._pe.undo) === 1);
  const alphaAt = (fx, fy) => page.evaluate(([fx, fy]) => { const c = document.getElementById('peCv'); return c.getContext('2d').getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data[3]; }, [fx, fy]);
  const a1 = await alphaAt(0.5, 0.5);
  await page.keyboard.press('Control+z');
  const a2 = await alphaAt(0.5, 0.5);
  await page.keyboard.press('Control+y');
  check('撤销 / 重做（Ctrl+Z / Ctrl+Y）', a1 === 0 && a2 === 255 && (await alphaAt(0.5, 0.5)) === 0, `${a1} ${a2}`);
  await page.click('#peWhiteBtn');
  await page.fill('#peStr', '8'); await page.dispatchEvent('#peStr', 'input');
  await sleep(400);
  await page.click('#peWhiteOk');
  check('一键去白边：确定后可以撤销', await page.evaluate(() => document.getElementById('peLayer')._pe.undo) === 2);
  const dlp = page.waitForEvent('download');
  await page.click('#peDl');
  const dlf = await dlp;
  const dlPath = path.join(out, 'pe-download.png');
  await dlf.saveAs(dlPath);
  const dlBuf = fs.readFileSync(dlPath);
  check('去白边“下载”：把现在这张图存成 PNG', dlBuf[0] === 0x89 && dlBuf[1] === 0x50 && dlBuf.length > 1000, String(dlBuf.length));
  await page.click('#peSaveAs');
  await page.waitForFunction(() => !document.getElementById('peLayer'));
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 3);
  p = await proj();
  check('另存成新产品图，在原图后面，名字带“-去白边”', /-去白边\.png$/.test(p.files[1].name) && p.files[1].type === 'image/png', p.files.map((f) => f.name).join(','));
  await sleep(500);
  check('去白边的图也放进素材中心（白底图）', (await api('GET', '/api/library')).items.some((x) => /-去白边\.png$/.test(x.name) && x.tag === '白底图'));
  const dw = await page.evaluate(() => {
    // 透明底上一个红方块，外面一圈 3 像素白边，方块里面有一块白色（不挨着透明处）
    const W = 40, im = new ImageData(W, W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, inR = x >= 10 && x < 30 && y >= 10 && y < 30, inW = x >= 7 && x < 33 && y >= 7 && y < 33, hole = x >= 17 && x < 23 && y >= 17 && y < 23;
      if (hole) im.data.set([255, 255, 255, 255], i); else if (inR) im.data.set([200, 30, 30, 255], i); else if (inW) im.data.set([250, 250, 250, 255], i);
    }
    const o = PNGEDIT.deWhite(im, 5).data, a = (x, y) => o[(y * W + x) * 4 + 3];
    const z = PNGEDIT.deWhite(im, 0).data;
    return { ring: a(8, 20), red: a(12, 20), hole: a(20, 20), zero: z[(20 * W + 8) * 4 + 3] };
  });
  const pi = await page.evaluate(async () => {
    // 透明 PNG（中间一个红方块）交给 AI 之前：铺白底（框选过也不会变黑）
    const c = document.createElement('canvas'); c.width = c.height = 100;
    const g = c.getContext('2d'); g.fillStyle = '#c81e1e'; g.fillRect(30, 30, 40, 40);
    const dataUrl = c.toDataURL('image/png');
    const corner = async (f) => { const r = await prepareInput(f, { single: true }); const im = new Image(); im.src = r.dataUrl; await im.decode(); const k = document.createElement('canvas'); k.width = im.naturalWidth; k.height = im.naturalHeight; const kg = k.getContext('2d'); kg.drawImage(im, 0, 0); return [...kg.getImageData(2, 2, 1, 1).data]; };
    const base = { dataUrl, base64: dataUrl.split(',')[1], w: 100, h: 100, size: 1000, name: 'a.png', parts: [], colors: [] };
    return { plain: await corner(base), crop: await corner({ ...base, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } }) };
  });
  check('透明 PNG 交给 AI 前铺白底（框选过的也不变黑）', pi.plain[0] > 240 && pi.plain[3] === 255 && pi.crop[0] > 240 && pi.crop[1] > 240, JSON.stringify(pi));
  check('一键去白边：去掉贴着透明处的白边，产品里面的白色不动', dw.ring === 0 && dw.red === 255 && dw.hole === 255 && dw.zero === 255, JSON.stringify(dw));

  // 结果去白边另存：加一条新结果，在原来那条后面
  {
    const pid = p.id, j0 = p.jobs[0];
    await page.evaluate(async (k) => { const c = document.createElement('canvas'); c.width = c.height = 20; const b = await new Promise((r) => c.toBlob(r, 'image/png')); await fetch('/api/blobs/' + encodeURIComponent(k), { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: b }); }, pid + ':e1-edit');
    await api('POST', `/api/cutout/${pid}/op`, { op: 'addEdited', jid: j0.id, key: pid + ':e1-edit', name: 'x-去白边.png', w: 20, h: 20 });
    const pj2 = await proj();
    check('结果去白边：另存成新结果，在原来那条后面', pj2.jobs[1].outKey === pid + ':e1-edit' && pj2.jobs[1].status === 'done' && pj2.jobs[1].inKey && pj2.jobs[1].inKey !== j0.inKey);
    await page.waitForFunction(() => document.querySelectorAll('.job [data-act="peJob"]').length === 1);
    check('结果的“去白边”：平时不显示，鼠标移到做好的图上才出现蓝色按钮', !(await page.isVisible('.job [data-act="peJob"]')));
    await page.hover('.job .outwrap:has([data-act="peJob"])');
    await page.click('.job [data-act="peJob"]');
    await page.waitForSelector('#peLayer #peCv');
    await sleep(300);
    const jb = await (await page.$('#peCv')).boundingBox();
    for (const [fx, fy] of [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.1, 0.1]]) await page.mouse.click(jb.x + jb.width * fx, jb.y + jb.height * fy);
    await page.click('#peDel');
    check('结果去白边：只能“保存”，“另存为新图”是灰的', !(await page.isDisabled('#peSave')) && await page.isDisabled('#peSaveAs'));
    await page.click('#peSave');
    await page.waitForFunction(() => !document.getElementById('peLayer'));
    await sleep(600);
    const pj3 = await proj();
    check('结果去白边“保存”：替换这条结果的图，不多出结果', pj3.jobs.length === pj2.jobs.length && pj3.jobs[1].outKey !== pid + ':e1-edit');
    await api('POST', `/api/cutout/${pid}/op`, { op: 'delJobs', jids: [pj2.jobs[1].id] });
  }
  await page.click(`.thumb >> nth=1 >> [data-delfile]`);
  await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 2);
  // 产品图去白边“保存”：替换原图，张数不变
  const k0 = (await proj()).files[1].curKey;
  await page.hover('.thumb >> nth=1');
  await page.click('.thumb >> nth=1 >> .pe');
  await page.waitForSelector('#peLayer #peCv');
  await sleep(300);
  const fb = await (await page.$('#peCv')).boundingBox();
  for (const [fx, fy] of [[0.05, 0.05], [0.2, 0.05], [0.2, 0.2], [0.05, 0.05]]) await page.mouse.click(fb.x + fb.width * fx, fb.y + fb.height * fy);
  await page.click('#peDel');
  await page.click('#peSave');
  await page.waitForFunction(() => !document.getElementById('peLayer'));
  await sleep(600);
  p = await proj();
  check('产品图去白边“保存”：替换原图，张数不变', p.files.length === 2 && p.files[1].curKey !== k0 && p.files[1].key === p.files[1].curKey);

  // 模式切换
  await page.click('[data-mode="refine"]');
  await page.waitForSelector('[data-s="refineBg"]');
  check('切到图片精修：比例跟原图、背景可以选原图 / 白底 / 自定义', (await page.inputValue('[data-s="ratio"]')) === 'auto' && (await page.isDisabled('[data-s="ratio"]')));
  check('图片精修：输出格式一直是三种（JPG / PNG / PNG 透明底）', (await page.locator('[data-s="format"] option').count()) === 3);
  await page.selectOption('[data-s="format"]', 'png-alpha');
  await page.waitForFunction(() => document.querySelector('[data-s="refineBg"]').value === 'white');
  check('选 PNG 透明底：背景自动变白底图', true);
  await page.selectOption('[data-s="refineBg"]', 'original');
  await page.waitForFunction(() => document.querySelector('[data-s="format"]').value !== 'png-alpha');
  check('背景选原图背景：格式跟原图（这张原图是不透明的 PNG → PNG）', (await page.inputValue('[data-s="format"]')) === 'png' && (await page.locator('[data-s="format"] option').count()) === 3, await page.inputValue('[data-s="format"]'));
  await page.click('[data-mode="white"]');

  // 选中做主图
  await page.check('#selAll');
  await page.click('[data-act="toMain"]');
  await page.fill('#lsName', '钱包');
  await page.click('#libLayer [data-ret="ok"]');
  await page.waitForSelector('#libLayer:has-text("已经放进")');
  await page.click('#libLayer [data-ret=""]');
  const mains = (await api('GET', '/api/projects?kind=main')).list;
  check('选中的白底图“做主图”：新建主图项目，三张都放进去', mains.length === 1 && /^主图-钱包\d\d-\d\d-2$/.test(mains[0].name) && (await api('GET', `/api/projects/${mains[0].id}`)).project.products.length === 3, JSON.stringify(mains.map((x) => x.name)));
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
