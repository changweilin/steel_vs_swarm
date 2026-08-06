#!/usr/bin/env node
/**
 * 照片 contact sheet(人眼複核的第一站)。
 *
 * §5j 的方法結論,這一輪第二次用到 ⇒ 依「reused 就 promote」升格為正式工具
 * (同 mesh_sheet.mjs 的來歷):**人眼那一步 MUST 先看照片,再看網格**。
 * 理由是量測過的:只看 `mesh_stats` 的 fill + 網格 contact sheet 挑出來的五顆
 * 全部語意錯誤(藍色 CGI 地形算圖 / 彩繪石雕 / 19 世紀明信片),而那些候選的授權、
 * 解析度、fill 統統合格 —— 錯誤發生在照片,卻要花完 GPU 時間才看得到。
 * 先看照片可以在 matte/SF3D **之前**就把它們刷掉。
 *
 * 每格印:index(= 字典序,與 matte/SF3D 的批次序同一把尺)、零件名、檔名、像素尺寸。
 *
 * 用法:node tools/ai3d/photo_sheet.mjs <photos 目錄> [--out DIR] [--cols 6] [--cell 300]
 *   例:node tools/ai3d/photo_sheet.mjs <資料家>/tools/ai3d/photos/tree --cols 6
 */
import fs from 'node:fs';
import path from 'node:path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumOrNull, chromePath, skipNoPlaywright } from '../pw.mjs';

const SRC = process.argv[2];
if (!SRC || !fs.existsSync(SRC)) {
  console.error('用法:node tools/ai3d/photo_sheet.mjs <photos 目錄>'); process.exit(1);
}
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('--out', join(SRC, '.sheet')));
const COLS = +arg('--cols', 6);
const CELL = +arg('--cell', 300);
const PER = +arg('--per', 24);                       // 每張大圖幾格

// 逐層收集(photos/<family>/<part>/<id>.<ext>);排序 = 字典序,與 matte 的 rglob 同序
const IMG = /\.(jpe?g|png|webp)$/i;
const files = [];
const walk = (d, rel = '') => {
  for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(d, e.name);
    if (e.name.startsWith('.')) continue;            // 自己的輸出目錄 .sheet 也在 SRC 底下:
    if (e.isDirectory()) walk(p, rel ? `${rel}/${e.name}` : e.name);   // 不濾就會把上一輪的
                                                     // contact sheet 當成照片再收一次(index 全部位移)
    else if (IMG.test(e.name)) files.push({ file: p, part: rel || '.', name: e.name });
  }
};
walk(SRC);
if (!files.length) { console.error(`${SRC} 裡沒有影像`); process.exit(1); }

const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('照片 contact sheet');

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: COLS * CELL, height: 200 } });

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sheets = [];
for (let s = 0; s * PER < files.length; s++) {
  const batch = files.slice(s * PER, (s + 1) * PER);
  const cells = batch.map((f, i) => {
    const idx = s * PER + i;
    // 相對路徑:HTML 落在 OUT(照片目錄底下的 .sheet),頁面用 file:// **導航**進去 ——
    // `setContent` 給的是 opaque origin,file:// 子資源會被 Chromium 一律擋掉,
    // 而擋掉的樣子是**每一格都空白**(沒有錯誤訊息,看起來像照片全壞了)。
    return `<div class="c"><img src="${esc(path.relative(OUT, f.file).replace(/\\/g, '/'))}">
      <div class="t"><b>#${idx}</b> ${esc(f.part)}<br>${esc(f.name.slice(0, 34))}</div></div>`;
  }).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#151719;font:11px/1.35 system-ui,sans-serif;color:#e6e6e6}
    .g{display:grid;grid-template-columns:repeat(${COLS},${CELL}px)}
    .c{width:${CELL}px;height:${CELL + 34}px;box-sizing:border-box;border:1px solid #2b2f33;overflow:hidden}
    img{width:${CELL}px;height:${CELL}px;object-fit:contain;background:#0c0d0e;display:block}
    .t{padding:2px 4px;white-space:nowrap;overflow:hidden}
    b{color:#7fd1ff}
  </style></head><body><div class="g">${cells}</div></body></html>`;
  const htmlPath = join(OUT, `sheet_${String(s).padStart(2, '0')}.html`);
  fs.writeFileSync(htmlPath, html);
  await page.goto(`file:///${path.resolve(htmlPath).replace(/\\/g, '/')}`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all([...document.images].map((im) => (im.complete
    ? null : new Promise((r) => { im.onload = im.onerror = r; })))));
  const el = await page.$('.g');
  const out = join(OUT, `sheet_${String(s).padStart(2, '0')}.png`);
  await el.screenshot({ path: out });
  sheets.push(out);
}
await browser.close();

console.log(`照片 ${files.length} 張 → ${sheets.length} 張 contact sheet`);
for (const s of sheets) console.log(`  ${s}`);
console.log('\nindex 對照(= matte/SF3D 的批次序):');
files.forEach((f, i) => console.log(`  #${String(i).padStart(3)}  ${f.part.padEnd(18)} ${f.name}`));
