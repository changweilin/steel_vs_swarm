#!/usr/bin/env node
/**
 * 背景物件多槽組裝三視角：葉冠、建築窗帶、小客車與重型車各取原始目標 + 決定性變體。
 * 用法：node tools/shot_background_objects.mjs [--out tools/.shots/background-object-slots.png]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromiumOrNull, chromePath, skipNoPlaywright } from './pw.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REVIEW_MARK = '<title>背景物件多槽組裝檢查</title>';

const arg = (key, fallback) => {
  const index = process.argv.indexOf(key);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const out = path.resolve(arg('--out', 'tools/.shots/background-object-slots.png'));
const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('背景物件多槽三視角');
fs.mkdirSync(path.dirname(out), { recursive: true });

async function isReview(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(800) });
    return response.ok && (await response.text()).includes(REVIEW_MARK);
  } catch { return false; }
}

async function serveReview(port) {
  let nextPort = port;
  if (await isReview(`http://localhost:${nextPort}/tools/background_review/index.html`)) {
    return { url: `http://localhost:${nextPort}/`, close: () => {} };
  }
  for (let i = 0; i < 20; i++) {
    const occupied = await fetch(`http://localhost:${nextPort}/`, { signal: AbortSignal.timeout(400) })
      .then(() => true).catch(() => false);
    if (!occupied) break;
    nextPort++;
  }
  const processHandle = spawn(process.execPath,
    [path.join(ROOT, 'tools', 'parts_review.mjs'), '--port', String(nextPort)],
    { stdio: 'ignore', cwd: ROOT });
  const url = `http://localhost:${nextPort}/`;
  for (let i = 0; i < 60; i++) {
    if (await isReview(`${url}tools/background_review/index.html`)) {
      return { url, close: () => processHandle.kill() };
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  processHandle.kill();
  throw new Error(`背景物件檢視伺服器起不來：${url}`);
}

const server = await serveReview(8653);
const browser = await chromium.launch({
  executablePath: chromePath(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1160, height: 1900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
const threeModule = process.env.THREE_MODULE;
if (threeModule && fs.existsSync(threeModule)) {
  await page.route('**/three@0.160.0/build/three.module.js', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: fs.readFileSync(threeModule, 'utf8'),
  }));
}
await page.goto(`${server.url}tools/background_review/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__backgroundReview?.ready || window.__backgroundReview?.error', null,
  { timeout: 20_000 });
const report = await page.evaluate(() => window.__backgroundReview);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
server.close();
for (const error of [...errors, ...(report.error ? [report.error] : [])]) console.error(`瀏覽器：${error}`);
console.log(`背景多槽三視角：${report.rows?.length || 0} 列 × 3 視角，截圖 ${out}`);
for (const row of report.rows || []) {
  console.log(`  ${row.label}: ${row.parts} parts, ${row.size.map((value) => value.toFixed(3)).join(' × ')}`);
}
if (errors.length || report.error) process.exit(1);
