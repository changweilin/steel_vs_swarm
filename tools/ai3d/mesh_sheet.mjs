#!/usr/bin/env node
/**
 * SF3D 產出 contact sheet(§5e「batch + contact sheet 是標準挑選流程」的正式版;
 * 之前的渲染腳本留在 scratchpad,本輪第三次用到 ⇒ 依當時備註升格為正式工具)。
 *
 * 把 SF3D 輸出目錄的 <i>/mesh.glb 逐顆渲染成 3/4 視角縮圖,拼成幾張大圖 + 印 index → 來源檔
 * 對照表(index = 產生時 glob 的字典序;每格附 tris)。人眼複核就看這幾張 —— `mesh_stats`
 * 的 fill 只篩得掉薄殼,篩不掉「內容錯誤」(館藏版畫/立體鏡雙聯卡/有人入鏡),
 * 那一步不可省(§5h 一輪擋下六顆)。
 *
 * 用法:node tools/ai3d/mesh_sheet.mjs <sf3d out dir> [--out DIR] [--cols 8] [--cell 190]
 */
import fs from 'node:fs';
import path from 'node:path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumOrNull, chromePath, serve, skipNoPlaywright } from '../pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE));
const SRC = process.argv[2];
if (!SRC || !fs.existsSync(SRC)) { console.error('用法:node tools/ai3d/mesh_sheet.mjs <sf3d out dir>'); process.exit(1); }
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('--out', join(SRC, '.sheet')));
const COLS = +arg('--cols', 8);
const CELL = +arg('--cell', 190);
const PORT = +arg('--port', 8646);

// 兩種版面(同 mesh_stats):SF3D `<i>/mesh.glb`、T2-spz 扁平 `<名字>.glb`。
// index 仍是「產生時的字典序」,只是名字改成檔名 —— 對照表印的就是它。
const srcItems = fs.readdirSync(SRC)
  .flatMap((d) => (/^\d+$/.test(d) && fs.existsSync(join(SRC, d, 'mesh.glb')))
    ? [{ label: d, path: join(SRC, d, 'mesh.glb') }]
    : d.toLowerCase().endsWith('.glb') ? [{ label: d.slice(0, -4), path: join(SRC, d) }] : [])
  .sort((a, b) => (/^\d+$/.test(a.label) && /^\d+$/.test(b.label)
    ? +a.label - +b.label : a.label < b.label ? -1 : 1));
if (!srcItems.length) { console.error('找不到 <i>/mesh.glb 或扁平的 *.glb'); process.exit(1); }

const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('contact sheet');
fs.mkdirSync(OUT, { recursive: true });

const srv = await serve(PORT);
const browser = await chromium.launch({
  executablePath: chromePath(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: CELL, height: CELL } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)));
const THREE_CDN = 'https://unpkg.com/three@0.160.0/build/three.module.js';
const threeLocal = [process.env.THREE_DIR, join(ROOT, 'node_modules', 'three')]
  .filter(Boolean).find((d) => fs.existsSync(join(d, 'build', 'three.module.js')));
if (threeLocal) {
  await page.route('**/three@0.160.0/build/three.module.js',
    (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(join(threeLocal, 'build', 'three.module.js'), 'utf8') }));
  await page.route('**/three@0.160.0/examples/jsm/**', (r) => {
    const rel = r.request().url().split('/examples/jsm/')[1].split('?')[0];
    const f = join(threeLocal, 'examples', 'jsm', rel);
    return fs.existsSync(f)
      ? r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f, 'utf8') })
      : r.abort();
  });
}
const PROBE = `${srv.url}public/__mesh_sheet.html`;
await page.route(PROBE, (r) => r.fulfill({
  status: 200, contentType: 'text/html; charset=utf-8',
  body: `<!DOCTYPE html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"${THREE_CDN}","three/addons/":"https://unpkg.com/three@0.160.0/examples/jsm/"}}</script>
<style>html,body{margin:0;background:#20242a}canvas{display:block}</style></head>
<body><canvas id="c" width="${CELL}" height="${CELL}"></canvas></body></html>`,
}));
await page.goto(PROBE, { waitUntil: 'domcontentloaded' });
await page.evaluate(async ({ cell }) => {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(cell, cell, false);
  const loader = new GLTFLoader();
  window.__shoot = async (b64) => {
    const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    const gltf = await new Promise((res, rej) => loader.parse(buf, '', res, rej));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x20242a);
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(2, 3, 1.6); scene.add(key);
    const obj = gltf.scene;
    obj.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, flatShading: true }); });
    scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const d = Math.max(s.x, s.y, s.z) * 1.35 + 1e-6;
    const cam = new THREE.PerspectiveCamera(40, 1, 0.01, d * 10);
    cam.position.set(c.x + d, c.y + d * 0.62, c.z + d * 0.85);
    cam.lookAt(c);
    renderer.render(scene, cam);
    const png = canvas.toDataURL('image/png');
    obj.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    return png;
  };
}, { cell: CELL });

const tiles = [];
for (const [n, it] of srcItems.entries()) {
  const b64 = fs.readFileSync(it.path).toString("base64");
  try {
    const png = await page.evaluate((b) => window.__shoot(b), b64);
    tiles.push({ i: /^\d+$/.test(it.label) ? +it.label : n, label: it.label, png });
  } catch (e) { console.log(`  ✗ ${it.label}:${String(e).slice(0, 120)}`); }
}

// 拼版(Node 端 canvas 不可用 ⇒ 就在頁裡拼)
const ROWS = Math.ceil(tiles.length / COLS);
const sheet = await page.evaluate(async ({ tiles2, cols, rows, cell }) => {
  const cv = document.createElement('canvas');
  cv.width = cols * cell; cv.height = rows * (cell + 18);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#14171c'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.font = 'bold 13px monospace';
  for (let k = 0; k < tiles2.length; k++) {
    const img = new Image();
    await new Promise((res) => { img.onload = res; img.src = tiles2[k].png; });
    const x = (k % cols) * cell, y = Math.floor(k / cols) * (cell + 18);
    ctx.drawImage(img, x, y);
    ctx.fillStyle = '#ffd75e';
    ctx.fillText(String(tiles2[k].i), x + 6, y + cell + 13);
  }
  return cv.toDataURL('image/png');
}, { tiles2: tiles, cols: COLS, rows: ROWS, cell: CELL });
fs.writeFileSync(join(OUT, 'sheet.png'), Buffer.from(sheet.split(',')[1], 'base64'));
console.log(`${tiles.length} 顆 → ${join(OUT, 'sheet.png')}`);
await browser.close();
srv.close();
