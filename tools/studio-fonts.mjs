// 详情页工作室：从 @fontsource 包里挑出要用的字体（只要 woff2、常规 400 + 粗体 700），生成 extension/studio/fonts/。
// 用法：node tools/studio-fonts.mjs <放 @fontsource 解压包的目录>（每个包解压到 <目录>/<包名>/package）
// 字体都是 SIL Open Font License 1.1，可以免费商用、可以随插件分发。
import fs from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
if (!src) { console.error('用法：node tools/studio-fonts.mjs <目录>'); process.exit(1); }
const out = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../extension/studio/fonts');
const PACKS = [
  ['noto-sans', [400, 700]],
  ['noto-sans-sc', [400, 700]],
  ['noto-sans-tc', [400, 700]],
  ['noto-sans-jp', [400, 700]],
  ['noto-sans-kr', [400, 700]],
  ['noto-sans-arabic', [400, 700]],
  ['noto-sans-thai', [400, 700]],
  ['noto-serif', [700]],
  ['noto-serif-sc', [700]],
];
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'files'), { recursive: true });
let css = '/* 详情页工作室字体（自动生成：tools/studio-fonts.mjs）。SIL Open Font License 1.1，见 LICENSE-OFL.txt */\n';
let bytes = 0, count = 0;
for (const [pack, weights] of PACKS) {
  const dir = path.join(src, pack, 'package');
  for (const w of weights) {
    const text = fs.readFileSync(path.join(dir, `${w}.css`), 'utf8');
    for (const block of text.match(/@font-face\s*{[^}]*}/g) || []) {
      const m = /url\(\.\/files\/([^)]+?\.woff2)\)/.exec(block);
      if (!m) continue;
      const file = m[1];
      fs.copyFileSync(path.join(dir, 'files', file), path.join(out, 'files', file));
      bytes += fs.statSync(path.join(out, 'files', file)).size;
      count++;
      css += block.replace(/src:[^;]+;/, `src: url(./files/${file}) format('woff2');`).replace(/font-display:\s*swap;/, 'font-display: block;') + '\n';
    }
  }
}
fs.writeFileSync(path.join(out, 'fonts.css'), css);
fs.copyFileSync(path.join(src, 'noto-sans-sc', 'package', 'LICENSE'), path.join(out, 'LICENSE-OFL.txt'));
console.log(`字体文件 ${count} 个，共 ${(bytes / 1048576).toFixed(1)} MB → ${out}`);
