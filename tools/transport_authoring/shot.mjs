import { readFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromiumOrNull, chromePath } from '../pw.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const chromium=await chromiumOrNull();
if(!chromium)throw new Error('Playwright is required for the transport visual check');
const server=spawn(process.execPath,[fileURLToPath(new URL('../story_book.mjs',import.meta.url)),'--port','8654'],{cwd:root,stdio:'ignore',windowsHide:true});
let browser;
try {
  const url='http://localhost:8654/tools/transport_authoring/review.html';
  let ready=false;
  for(let i=0;i<60;i++) {
    try {ready=(await fetch(url)).ok;}catch{}
    if(ready)break;
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  if(!ready)throw new Error('Transport review server did not start');
  browser=await chromium.launch({executablePath:chromePath(),args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1540,height:1000}});
  await page.route('**/three@0.160.0/build/three.module.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:readFileSync(new URL('../../out/forest_review/three.module.js',import.meta.url),'utf8')}));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction('window.__transportReview',null,{timeout:30000});
  const result=await page.evaluate(()=>window.__transportReview);
  if(result.error||errors.length)throw new Error(result.error||errors.join('\n'));
  mkdirSync(new URL('../../out/transport_review/',import.meta.url),{recursive:true});
  await page.screenshot({path:fileURLToPath(new URL('../../out/transport_review/game-models.png',import.meta.url)),fullPage:true});
  console.log(JSON.stringify(result));
}finally {await browser?.close();server.kill();}
