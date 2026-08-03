// ============ 在地文字招牌視覺閉環(截圖 + 著色器編譯驗證)============
// 用法:node tools/shot_signs.mjs [--venue shibuya] [--out tools/.shots/signs]
// 前置:playwright(全域安裝即可;找不到就明確跳過,不擋 CI)。伺服器沒開會自己起一個。
//
// 為什麼非得進真瀏覽器:這個系統有兩件事**只有渲染出來才看得見**——
//   ① 招牌上的字有沒有寫下去、有沒有被壓成糊帶、有沒有上下顛倒(圖集 PNG 一眼可見)
//   ② `toon.js` 的 CEL_ATLAS 逐實例 UV 補丁**編不編得過**。編不過的症狀是那批 mesh
//      整批不畫,three 只在 console 印一次 —— 畫面上看起來像「這張圖沒有招牌」。
// 兩者離線稽核都驗不到(audit_vernacular 驗的是字與 UV 算術),故本支是它的視覺對照組。
import fs from 'node:fs';
import path from 'node:path';
import { chromiumOrNull, chromePath, serve, skipNoPlaywright } from './pw.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const VENUE = arg('--venue', 'shibuya');
const OUT = path.resolve(arg('--out', 'tools/.shots/signs'));

const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('招牌截圖');
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
  const { signAtlas, signMaterial, applySignAtlas, signAspect } = await import('/public/js/signage.js');
  const { VENUE_TEXT } = await import('/public/js/venueText.js');
  const { mulberry32 } = await import('/public/js/rng.js');
  const { setCelSun, updateCelLight } = await import('/public/js/toon.js');

  const corpus = VENUE_TEXT[venueId];
  if (!corpus) return { error: `找不到場地語料:${venueId}` };
  const classes = ['wallsign', 'billboard', 'roadsign', 'notice', 'scenic'];
  const rnd = mulberry32(20260803), used = new Set();
  const atlases = {}, sheets = {}, copies = {};
  for (const cls of classes) {
    const at = signAtlas(cls, 6, { corpus, rnd, used });
    if (!at) continue;
    atlases[cls] = at;
    sheets[cls] = at.tex.image.toDataURL('image/png');
    copies[cls] = at.copies.map((c) => [c.t, c.s, c.en, c.kind]);
  }

  // ---- 3D:**每類各一張**,逐實例 UV 應該讓同一個 InstancedMesh 的 6 塊寫不同的字 ----
  // 五類的牌面高度差到 13 倍(直式招牌 20 單位 vs 路標 1.25),擠在同一張圖裡一定互相
  // 遮擋而且鏡頭框不住 —— 分開拍、鏡頭依該類自己的尺寸推導。
  const W = 960, H = 540;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.debug.checkShaderErrors = true;
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x3a4048, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 400);
  const SUN = new THREE.Vector3(0.4, 0.85, 0.55);
  setCelSun(SUN);
  const dl = new THREE.DirectionalLight(0xffffff, 2.0);
  dl.position.copy(SUN).multiplyScalar(60);
  scene.add(dl, new THREE.HemisphereLight(0xdff1ff, 0x2b2f38, 1.1));

  const frames = {};
  for (const cls of classes) {
    const at = atlases[cls];
    if (!at) continue;
    const n = at.cells;
    const w = 4, h = w / signAspect(cls);
    const geo = new THREE.BoxGeometry(w, h, 0.16);
    applySignAtlas(geo, n, at);
    const side = new THREE.MeshBasicMaterial({ color: 0xbdb8b0 });
    const face = signMaterial(at, false);
    const m = new THREE.InstancedMesh(geo, [side, side, side, side, face, face], n);
    const M = new THREE.Matrix4();
    const pitch = w + 0.6;
    for (let i = 0; i < n; i++) {
      M.makeTranslation((i - (n - 1) / 2) * pitch, 0, 0);
      m.setMatrixAt(i, M);
      m.setColorAt(i, new THREE.Color(0xffffff));
    }
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor.needsUpdate = true;
    scene.add(m);
    // 鏡頭距離由這一類自己的排面尺寸推導(寬與高各算一次取遠者),不手寫
    const spanW = n * pitch, spanH = h;
    const fovY = camera.fov * Math.PI / 180;
    const dist = Math.max(spanH / 2 / Math.tan(fovY / 2), spanW / 2 / Math.tan(fovY / 2) / camera.aspect) * 1.12;
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    updateCelLight(camera);
    renderer.render(scene, camera);
    frames[cls] = canvas.toDataURL('image/png');
    scene.remove(m);
  }
  return { sheets, copies, frames, programs: renderer.info.programs.length };
}, VENUE);

if (res.error) { console.log('✗', res.error); await browser.close(); srv.close(); process.exit(1); }

const save = (name, dataUrl) => {
  fs.writeFileSync(path.join(OUT, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
};
for (const [cls, url] of Object.entries(res.sheets)) save(`atlas_${cls}.png`, url);
for (const [cls, url] of Object.entries(res.frames)) save(`sign3d_${cls}.png`, url);

console.log(`場地 ${VENUE}・圖集 ${Object.keys(res.sheets).length} 張・著色器程式 ${res.programs}`);
for (const [cls, list] of Object.entries(res.copies)) {
  console.log(`\n[${cls}]`);
  for (const [t, s, en, kind] of list) console.log(`  ${kind.padEnd(8)} ${t}${s ? '  /  ' + s : ''}${en ? '  /  ' + en : ''}`);
}
console.log(`\n輸出 → ${OUT}`);
if (errs.length) {
  console.log('\n✗ 瀏覽器錯誤(著色器編不過就會在這裡):');
  for (const e of errs.slice(0, 12)) console.log('  ' + e);
}
await browser.close();
srv.close();
process.exit(errs.length ? 1 : 0);
