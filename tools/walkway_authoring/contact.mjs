import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../audit_src.mjs';
import { chromiumOrNull, chromePath } from '../pw.mjs';

const out = path.join(ROOT,'out/walkway_review');
const cases = [['urban-sidewalks','OSM sidewalks · brick / concrete · tactile strip and shoulder furniture'],
  ['park-path','Park path · wooden paving · fitted handrails and mapped picnic furniture'],
  ['forest-trail','Forest trail · ground paving · sparse benches and trail markers'],
  ['facilities','Facility library · 10 contextual types · metre-space placement envelopes']];
const cards = await Promise.all(cases.map(async ([key,label]) => {
  const png = await readFile(path.join(out,key+'-blender.png'));
  return `<figure><img src="data:image/png;base64,${png.toString('base64')}"><figcaption>${label}</figcaption></figure>`;
}));
const chromium = await chromiumOrNull(); assert(chromium,'Contact sheet requires the existing Playwright runtime');
const browser = await chromium.launch({headless:true,executablePath:chromePath()});
try {
  const page = await browser.newPage({viewport:{width:1800,height:1200},deviceScaleFactor:1});
  await page.setContent(`<style>body{margin:0;padding:24px;background:#19282c;color:#e0e9df;font:20px Arial}h1{margin:0 0 8px;font-size:32px}p{margin:0 0 20px;color:#a4b9b0;font-size:17px}main{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;background:#2a3b3d}img{width:100%;display:block}figcaption{padding:14px}</style>
    <h1>Steel vs. Swarm · pedestrian surfaces and facilities</h1><p>Blender renders of production geometry · 15 surface families · 12 authored members · synthetic evidence fixtures</p><main>${cards.join('')}</main>`);
  await page.evaluate(()=>Promise.all(Array.from(document.images,image=>image.decode())));
  await page.screenshot({path:path.join(out,'walkways-blender.png'),fullPage:true});
  console.log(path.join(out,'walkways-blender.png'));
} finally { await browser.close(); }
