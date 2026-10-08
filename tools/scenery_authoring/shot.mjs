import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromiumOrNull, chromePath, serve } from '../pw.mjs';
import { ROOT, readSrc } from '../audit_src.mjs';

const chromium = await chromiumOrNull();
assert(chromium, 'Scenery review requires an existing Playwright runtime');
const environmentReview = process.argv.includes('--environment');
const iceVariants = process.argv.includes('--ice-variants');
const icebergVariants = process.argv.includes('--iceberg-variants');
const geologyVariants = process.argv.includes('--geology-variants');
const naturalVariants = process.argv.includes('--natural-variants');
const variants = iceVariants || icebergVariants || geologyVariants || naturalVariants;
const compare = process.argv.includes('--compare');
assert(!compare || environmentReview, '--compare requires --environment');
assert([iceVariants, icebergVariants, geologyVariants, naturalVariants].filter(Boolean).length <= 1, 'Choose one variant family');
assert(!variants || (!environmentReview && !compare), 'Variants are a separate review mode');
const directory = path.join(ROOT, 'out/scenery_review', naturalVariants ? 'natural-variants' : geologyVariants ? 'geology-variants' : icebergVariants ? 'iceberg-variants' : iceVariants ? 'ice-variants' : environmentReview ? 'environment' : '');
await mkdir(directory, { recursive: true });
const server = await serve();
let browser;
try {
  browser = await chromium.launch({ executablePath: chromePath(), headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1540, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (/THREE.WebGLProgram: Shader Error|BufferGeometryUtils.*failed|ERROR: 0:/.test(message.text())) errors.push(message.text());
  });
  const local = process.env.THREE_MODULE || path.join(ROOT, 'out/forest_review/three.module.js');
  await page.route('**/three@0.160.0/build/three.module.js', async route => route.fulfill({
    contentType: 'text/javascript', body: await readFile(local, 'utf8') }));
  await page.route('**/three@0.160.0/examples/jsm/**', async route => route.fulfill({
    contentType: 'text/javascript', body: await readFile(path.join(path.dirname(local),
      route.request().url().split('/examples/jsm/')[1].split('?')[0].replaceAll('/', '_')), 'utf8') }));
  for (const file of ['review.html', 'review.js']) await page.route('**/tools/scenery_authoring/' + file + '*',
    route => route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : 'text/html',
      body: readSrc('tools', 'scenery_authoring', file) }));
  if (compare) await page.route('**/tools/scenery_authoring/environment-before.json', async route => route.fulfill({
    contentType: 'application/json', body: await readFile(path.join(directory, '../environment-before.json'), 'utf8') }));
  const query = naturalVariants ? '?natural-variants' : geologyVariants ? '?geology-variants' : icebergVariants ? '?iceberg-variants' : iceVariants ? '?ice-variants' : environmentReview ? '?environment' + (compare ? '&compare' : '') : '';
  await page.goto(new URL('tools/scenery_authoring/review.html' + query, server.url).href);
  await page.waitForFunction('window.__sceneryReview', null, { timeout: 60000 });
  const result = await page.evaluate(() => window.__sceneryReview);
  assert.ifError(result.error); assert.deepEqual(errors, []);
  await writeFile(path.join(directory, 'review.json'), JSON.stringify({ models: result.models }));
  await page.screenshot({ path: path.join(directory, 'game-models.png'), fullPage: true });
  console.log(JSON.stringify({ models: result.report.length, report: result.report }));
} finally { await browser?.close(); server.close(); }
