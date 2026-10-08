// Browser review executes shipped builders; intercepted local sources require no geographic service or added dependency.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../audit_src.mjs';
import { chromiumOrNull, chromePath } from '../pw.mjs';

const out = path.join(ROOT,'out/walkway_review'); await mkdir(path.join(out,'textures'),{recursive:true});
const chromium = await chromiumOrNull(); assert(chromium,'Walkway review requires the existing Playwright runtime');
const browser = await chromium.launch({ headless:true,executablePath:chromePath(),
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({viewport:{width:1500,height:1000}}), errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{ if (/Shader Error|ERROR: 0:/.test(message.text())) errors.push(message.text()); });
  const local = process.env.THREE_MODULE || path.join(ROOT,'out/forest_review/three.module.js');
  await page.route('**/three@0.160.0/build/three.module.js',route=>route.fulfill({contentType:'text/javascript',path:local}));
  await page.route('**/three@0.160.0/examples/jsm/**',route=>route.fulfill({contentType:'text/javascript',
    path:path.join(path.dirname(local),route.request().url().split('/examples/jsm/')[1].replaceAll('/','_'))}));
  await page.route('http://walkway.test/**', async route => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname), file = path.resolve(ROOT,'.'+pathname);
    assert(file.startsWith(ROOT+path.sep) && (pathname.startsWith('/public/') || pathname.startsWith('/tools/walkway_authoring/')));
    await route.fulfill({contentType:pathname.endsWith('.js')?'text/javascript':'text/html',body:await readFile(file)});
  });
  await page.goto('http://walkway.test/tools/walkway_authoring/review.html');
  await page.waitForFunction(()=>window.__walkwayReview||window.__walkwayError,{},{timeout:180000});
  const result = await page.evaluate(()=>({result:window.__walkwayReview,error:window.__walkwayError}));
  assert(!result.error,result.error); assert.deepEqual(errors,[]);
  const {models,shots,checks,textures,memory} = result.result;
  for (const shot of shots) await writeFile(path.join(out,shot.key+'-runtime.png'),Buffer.from(shot.src.split(',')[1],'base64'));
  for (const [key,src] of Object.entries(textures)) await writeFile(path.join(out,'textures',key+'.png'),Buffer.from(src.split(',')[1],'base64'));
  await writeFile(path.join(out,'review.json'),JSON.stringify({models}));
  await writeFile(path.join(out,'checks.json'),JSON.stringify({checks,memory},null,2));
  await page.screenshot({path:path.join(out,'walkway-runtime.png'),fullPage:true});
  assert(memory.every(row=>row.geometries===memory[0].geometries&&row.textures===memory[0].textures),'Walkway resources leaked between scenes');
  console.log(`PASS walkway rendering: ${models.length} production cases, shader compilation, replay, low-power prefixes and GPU teardown`);
  console.log(path.join(out,'walkway-runtime.png'));
} finally { await browser.close(); }
