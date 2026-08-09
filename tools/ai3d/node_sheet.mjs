#!/usr/bin/env node
/**
 * 零件庫節點的**四面**黏土對照表(鏡像貼補這一輪的人眼驗收)。
 *
 * 為什麼要有這一支:§5ac-e 的教訓是「我從來沒有看過這顆節點的背面」——
 * `mesh_sheet.mjs` 吃的是 SF3D 的逐圖輸出目錄、一顆一格、固定 3/4 機位,
 * 而這一輪要問的問題正好是**另一面長什麼樣**、以及**改前改後差在哪**。
 * 於是這一支吃的是**已出貨的零件庫 GLB**:一列一顆節點,一格一個偏航角,
 * 給 `--ref` 就上下兩列(舊 / 新)並排。
 *
 * 偏航是**繞著模型轉相機**(不是轉模型)⇒ 與 `normalize_parts.py` 的 `ry` 無關,
 * 不會重蹈「ry 是 no-op 而四視角其實是同一張」那個坑(§5ac-e)。
 *
 * 用法:
 *   node tools/ai3d/node_sheet.mjs --glb public/assets/models/parts/rock.glb
 *   node tools/ai3d/node_sheet.mjs --glb new.glb --ref old.glb --nodes mega_a,tower_a
 *   （--views 4 / --cell 190 / --out DIR）
 */
import fs from 'node:fs';
import path from 'node:path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumOrNull, chromePath, serve, skipNoPlaywright } from '../pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const GLB = arg('--glb');
const REF = arg('--ref', null);
const ONLY = (arg('--nodes', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const VIEWS = +arg('--views', 4);
const CELL = +arg('--cell', 190);
const PORT = +arg('--port', 8647);
// 預設落在已 gitignore 的 `tools/ai3d/out/`(出圖隨時可重拍,勿入版控)
const OUT = path.resolve(arg('--out', join(ROOT, 'tools', 'ai3d', 'out', 'node_sheet')));
if (!GLB || !fs.existsSync(GLB)) { console.error('用法:node tools/ai3d/node_sheet.mjs --glb <parts glb> [--ref <glb>]'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const chromium = await chromiumOrNull();
if (!chromium) { skipNoPlaywright('node_sheet'); process.exit(0); }
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
const PROBE = `${srv.url}public/__node_sheet.html`;
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
  window.__load = async (b64) => {
    const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    window.__gltf = await new Promise((res, rej) => loader.parse(buf, '', res, rej));
    const names = [];
    window.__gltf.scene.traverse((o) => { if (o.isMesh && o.name) names.push(o.name); });
    return names;
  };
  // 相機繞著模型轉(不動模型)—— 這一格看的就是那一面
  window.__shoot = (name, yawDeg) => {
    let src = null;
    window.__gltf.scene.traverse((o) => { if (o.isMesh && o.name === name) src = o; });
    if (!src) throw new Error(`找不到節點 ${name}`);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x20242a);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const obj = new THREE.Mesh(src.geometry, new THREE.MeshStandardMaterial({ color: 0xb9c0c8 }));
    scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const d = Math.max(s.x, s.y, s.z) * 1.5 + 1e-6;
    const a = yawDeg * Math.PI / 180;
    const cam = new THREE.PerspectiveCamera(40, 1, 0.01, d * 10);
    cam.position.set(c.x + Math.sin(a) * d, c.y + d * 0.42, c.z + Math.cos(a) * d);
    cam.lookAt(c);
    // 鍵光跟著相機轉:固定光源會讓背面那幾格全黑,而「背面是不是空的」正是要看的東西
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(Math.sin(a + 0.7) * d, d * 0.9, Math.cos(a + 0.7) * d);
    scene.add(key);
    renderer.render(scene, cam);
    const png = canvas.toDataURL('image/png');
    obj.material.dispose();
    return png;
  };
}, { cell: CELL });

const b64 = (p) => fs.readFileSync(p).toString('base64');
const shootAll = async (file, names) => {
  const got = await page.evaluate((b) => window.__load(b), b64(file));
  const rows = [];
  for (const n of names.filter((x) => got.includes(x))) {
    const cells = [];
    for (let v = 0; v < VIEWS; v++) cells.push(await page.evaluate(([nm, y]) => window.__shoot(nm, y), [n, v * 360 / VIEWS]));
    rows.push({ name: n, cells });
  }
  return rows;
};

const allNames = await page.evaluate((b) => window.__load(b), b64(GLB));
const names = (ONLY.length ? ONLY : allNames).filter((n) => allNames.includes(n));
const now = await shootAll(GLB, names);
const ref = REF ? await shootAll(REF, names) : [];

const LAB = 18;
const sheet = await page.evaluate(async ({ now2, ref2, views, cell, lab }) => {
  const pairs = [];
  for (const r of now2) {
    const old = ref2.find((x) => x.name === r.name);
    if (old) pairs.push({ name: `${r.name} 舊`, cells: old.cells });
    pairs.push({ name: `${r.name}${old ? ' 新' : ''}`, cells: r.cells });
  }
  const cv = document.createElement('canvas');
  cv.width = views * cell + 130;
  cv.height = pairs.length * (cell + lab);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#14171c'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.font = 'bold 14px monospace';
  for (let k = 0; k < pairs.length; k++) {
    const y = k * (cell + lab);
    for (let v = 0; v < pairs[k].cells.length; v++) {
      const img = new Image();
      await new Promise((res) => { img.onload = res; img.src = pairs[k].cells[v]; });
      ctx.drawImage(img, 130 + v * cell, y);
    }
    ctx.fillStyle = pairs[k].name.endsWith('舊') ? '#9aa4b0' : '#ffd75e';
    ctx.fillText(pairs[k].name, 8, y + cell / 2);
  }
  ctx.fillStyle = '#8892a0';
  return cv.toDataURL('image/png');
}, { now2: now, ref2: ref, views: VIEWS, cell: CELL, lab: LAB });

const dst = join(OUT, `${path.basename(GLB, '.glb')}_sheet.png`);
fs.writeFileSync(dst, Buffer.from(sheet.split(',')[1], 'base64'));
console.log(`${names.length} 顆 × ${VIEWS} 面${REF ? '(含舊版對照)' : ''} → ${dst}`);
await browser.close();
srv.close();
