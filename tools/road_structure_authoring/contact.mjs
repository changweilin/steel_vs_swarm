import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromiumOrNull, chromePath } from '../pw.mjs';
import { ROOT } from '../audit_src.mjs';

const directory = path.join(ROOT, 'out/road_structure_review');
const { models } = JSON.parse(await readFile(path.join(directory, 'review.json'), 'utf8'));
const rows = models.map(model => ({ key: model.key + '-blender', label: model.label }));
rows.push({ key: 'underpass-detail', label: 'Underpass · interior and exit grade' },
  { key: 'gallery-detail', label: 'Open tunnel · column-side passage' });
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const cards = await Promise.all(rows.map(async row => {
  const png = await readFile(path.join(directory, row.key + '.png'));
  return `<figure><img src="data:image/png;base64,${png.toString('base64')}"><figcaption>${escape(row.label)}</figcaption></figure>`;
}));
const chromium = await chromiumOrNull();
assert(chromium, 'Road contact sheet requires the existing Playwright runtime');
const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 1 });
  await page.setContent(`<style>
    *{box-sizing:border-box}body{margin:0;padding:24px;background:#182226;color:#e9efea;font:18px Arial}
    h1{margin:0 0 8px;font-size:32px}p{margin:0 0 24px;color:#a6bbb5;font-size:16px}
    main{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}figure{margin:0;background:#293738}
    img{display:block;width:100%}figcaption{padding:12px;font-size:17px}
  </style><h1>Steel vs. Swarm · Road structures</h1>
  <p>Blender renders of production meshes · synthetic terrain · buried structures shown with sectioned ground</p>
  <main>${cards.join('')}</main>`);
  await page.evaluate(() => Promise.all(Array.from(document.images, image => image.decode())));
  await page.screenshot({ path: path.join(directory, 'blender-review.png'), fullPage: true });
} finally { await browser.close(); }
console.log(path.join(directory, 'blender-review.png'));
