// ============ 世界文字視覺閉環(截圖 + 圖集 + 著色器驗證)============
// 用法:node tools/shot_signs.mjs [--venue shibuya] [--out tools/.shots/signs]
// 前置:playwright(全域安裝即可;找不到就明確跳過,不擋 CI)。伺服器沒開會自己起一個。
//
// 為什麼非得進真瀏覽器:這個系統有三件事**只有渲染出來才看得見** ——
//   ① 招牌上的字有沒有寫下去、有沒有被壓成糊帶、有沒有上下顛倒(圖集 PNG 一眼可見)
//   ② **缺字偵測**只有在真的有字型的環境才成立(離線稽核裡 `canRenderText` 恆為 false)
//   ③ 九種語域的版面實際排出來長什麼樣 —— 版面是 canvas 指令,離線只驗得到「有沒有寫」
// 離線稽核(`audit_world_text` Ⅴ / `audit_vernacular`)驗的是字與裝箱算術,這支是它的
// 視覺對照組。
import fs from 'node:fs';
import path from 'node:path';
import { chromiumOrNull, chromePath, serve, skipNoPlaywright } from './pw.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const VENUE = arg('--venue', 'shibuya');
const OUT = path.resolve(arg('--out', 'tools/.shots/signs'));

const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('世界文字截圖');
fs.mkdirSync(OUT, { recursive: true });

const srv = await serve(8632);
const browser = await chromium.launch({
  executablePath: chromePath(),
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 300)); });
await page.goto(srv.url, { waitUntil: 'domcontentloaded' });

const res = await page.evaluate(async (venueId) => {
  const THREE = await import('three');
  const WT = await import('/public/js/worldtext.js');
  const { signCopy, SIGN_CLASSES } = await import('/public/js/vernacular.js');
  const { VENUE_TEXT } = await import('/public/js/venueText.js');
  const { mulberry32 } = await import('/public/js/rng.js');
  const { setCelSun, updateCelLight } = await import('/public/js/toon.js');

  const corpus = VENUE_TEXT[venueId];
  if (!corpus) return { error: `找不到場地語料:${venueId}` };

  // 九種語域各排一列:四種構件名牌(單行)+ 五種語料庫招牌(三層文字)
  const structural = [
    ['stone', '燕子口隧道'], ['stone', 'ひばり橋'], ['enamel', '象山'],
    ['guide', '3 圓山'], ['lightbox', '青空商店'],
  ];
  const rnd = mulberry32(20260803), used = new Set();
  const rows = [];
  for (const cls of Object.keys(SIGN_CLASSES)) {
    const copies = [];
    for (let i = 0; i < 6; i++) { const cp = signCopy(cls, corpus, rnd, used); if (cp) copies.push(cp); }
    if (copies.length) rows.push({ style: cls, copies });
  }
  rows.unshift({ style: 'plain-mix', copies: structural.map(([, t]) => ({ t })), styles: structural.map(([s]) => s) });

  const W = 960, H = 540;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.debug.checkShaderErrors = true;
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x3a4048, 1);
  const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 400);
  const SUN = new THREE.Vector3(0.4, 0.85, 0.55);
  setCelSun(SUN);

  const frames = {}, listing = {};
  let sheetPng = null, dropped = 0;
  for (const row of rows) {
    const scene = new THREE.Scene();
    const dl = new THREE.DirectionalLight(0xffffff, 2.0);
    dl.position.copy(SUN).multiplyScalar(60);
    scene.add(dl, new THREE.HemisphereLight(0xdff1ff, 0x2b2f38, 1.1));
    const sheet = new WT.SignSheet(false);
    const n = row.copies.length;
    const style0 = row.styles ? row.styles[0] : row.style;
    const h = 1.6, pitch = h * WT.signAspect(style0) + 0.6;
    row.copies.forEach((copy, i) => {
      const st = row.styles ? row.styles[i] : row.style;
      sheet.add({ copy, x: (i - (n - 1) / 2) * pitch, y: 0, z: 0, ry: 0, h, style: st, both: false });
    });
    const mesh = sheet.build();
    if (!mesh) continue;
    scene.add(mesh);
    dropped += mesh.userData.signDropped;
    if (!sheetPng) sheetPng = mesh.material.map.image.toDataURL('image/png');
    // 鏡頭距離由這一列自己的排面尺寸推導(寬與高各算一次取遠者),不手寫
    const spanW = n * pitch, fovY = camera.fov * Math.PI / 180;
    const dist = Math.max(h / 2 / Math.tan(fovY / 2), spanW / 2 / Math.tan(fovY / 2) / camera.aspect) * 1.15;
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    updateCelLight(camera);
    renderer.render(scene, camera);
    frames[row.style] = canvas.toDataURL('image/png');
    listing[row.style] = row.copies.map((c, i) => [row.styles ? row.styles[i] : row.style, c.t, c.s, c.en, c.kind]);
    // 每一列拍完就把 atlas 的 PNG 存起來(最後一列的 sheet 只保留一張當代表)
    if (row.style === 'wallsign') sheetPng = mesh.material.map.image.toDataURL('image/png');
  }
  return { frames, listing, sheetPng, dropped, programs: renderer.info.programs.length };
}, VENUE);

if (res.error) { console.log('✗', res.error); await browser.close(); srv.close(); process.exit(1); }

const save = (name, dataUrl) => {
  fs.writeFileSync(path.join(OUT, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
};
for (const [cls, url] of Object.entries(res.frames)) save(`sign3d_${cls}.png`, url);
if (res.sheetPng) save('atlas.png', res.sheetPng);

console.log(`場地 ${VENUE}・語域 ${Object.keys(res.frames).length} 種・著色器程式 ${res.programs}・裝不下 ${res.dropped}`);
for (const [cls, list] of Object.entries(res.listing)) {
  console.log(`\n[${cls}]`);
  for (const [st, t, s, en, kind] of list) {
    console.log(`  ${String(kind || st).padEnd(10)} ${t}${s ? '  /  ' + s : ''}${en ? '  /  ' + en : ''}`);
  }
}
console.log(`\n輸出 → ${OUT}`);
if (errs.length) {
  console.log('\n✗ 瀏覽器錯誤(著色器編不過就會在這裡):');
  for (const e of errs.slice(0, 12)) console.log('  ' + e);
}
await browser.close();
srv.close();
process.exit(errs.length || res.dropped ? 1 : 0);
