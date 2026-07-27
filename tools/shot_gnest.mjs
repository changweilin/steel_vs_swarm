// 神木枝載特徵 三視角接點稽核(2026-07-24)—— 驗「巢/山蘇/蟻窩/蜂窩/藤枝 生近水平側枝、不貼主幹、
// 枝根埋入樹皮;蜂窩垂吊」。從 /js/biomes.js 原始碼抽 bough() + GIANT_DECO,套用 hang(faceOut) +
// buildVegMeshes 的實際擺放數學,連一段主幹圓柱渲 front(+Z)/side(+X)/top(+Y),各型一列疊成總表。
// 單視角必漏,三軸才是最終裁決。前置:伺服器 8620 執行中;Playwright 借 mapping_elf。
// 用法:node tools/shot_gnest.mjs [--out DIR]
import { chromium } from 'file:///C:/Users/user/Documents/app/mapping_elf/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('--out', 'tools/.shots_giants'));
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto('http://localhost:8620', { waitUntil: 'networkidle' });

const TYPES = ['gnest', 'epiphyte', 'antnest', 'beehive', 'branch', 'vinebranch'];

const report = await page.evaluate(async (TYPES) => {
  const THREE = await import('three');
  const src = await (await fetch('/public/js/biomes.js')).text();
  const cyl = (r1, r2, h, n = 5) => new THREE.CylinderGeometry(r1, r2, h, n);
  const cone = (r, h, n = 5) => new THREE.ConeGeometry(r, h, n);
  const ico = (r) => new THREE.IcosahedronGeometry(r, 0);

  // ---- 從真實原始碼抽 bough() + GIANT_DECO(避免手抄漂移)----
  const bm = src.match(/const bough = \(\) => \[[\s\S]*?\n\];/);
  const dm = src.match(/const GIANT_DECO = \{[\s\S]*?\n\};/);
  if (!bm || !dm) return { error: `抽不到 bough(${!!bm}) / GIANT_DECO(${!!dm})` };
  const GIANT_DECO = new Function('cyl', 'cone', 'ico', 'THREE', 'Math',
    `${bm[0]}\n${dm[0]}\n return GIANT_DECO;`)(cyl, cone, ico, THREE, Math);

  // ---- 情境:meranti 巨幹 s=1.35、frac=0.33、it.s=1.3、ha=0(徑向 +x)、faceOut ry=-ha=0 ----
  const defR = 2.5, defH = 95, treeS = 1.35, frac = 0.33;
  const hy = defH * treeS * frac;
  const trunkR = defR * treeS * (1 - 0.72 * hy / (defH * treeS));
  const it = { x: trunkR, y: 0, z: 0, s: 1.3, ry: 0 };   // 錨在樹皮面(faceOut rr=trunkR)

  const partMesh = (part) => {   // buildVegMeshes 同款單實例變換
    const Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(part.rx || 0, it.ry, part.rz || 0));
    const px = part.px || 0, pz = part.pz || 0, ca = Math.cos(it.ry), sa = Math.sin(it.ry);
    const P = new THREE.Vector3(it.x + (px * ca + pz * sa) * it.s, it.y + part.y * it.s, it.z + (-px * sa + pz * ca) * it.s);
    const S = new THREE.Vector3(it.s, it.s * (part.sy || 1), it.s);
    const mesh = new THREE.Mesh(part.g, new THREE.MeshLambertMaterial({ color: part.c }));
    mesh.applyMatrix4(new THREE.Matrix4().compose(P, Q, S));
    return mesh;
  };

  const scene = new THREE.Scene();
  scene.add(new THREE.DirectionalLight(0xffffff, 2.0).translateX(40).translateY(50).translateZ(60),
            new THREE.AmbientLight(0xffffff, 0.85));
  const trunk = new THREE.Mesh(cyl(trunkR * 0.94, trunkR, 9, 16),
    new THREE.MeshLambertMaterial({ color: 0x6b4f34, transparent: true, opacity: 0.5 }));

  const W = 300, H = 300;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(W * 4, H, false);
  renderer.setClearColor(0x2a2e36, 1);
  renderer.setScissorTest(true);

  const canvas2d = document.createElement('canvas');
  canvas2d.width = W * 4; canvas2d.height = TYPES.length * (H + 22) + 4;
  const ctx = canvas2d.getContext('2d');
  ctx.fillStyle = '#1c1f26'; ctx.fillRect(0, 0, canvas2d.width, canvas2d.height);

  TYPES.forEach((ty, row) => {
    const deco = new THREE.Group();
    for (const part of GIANT_DECO[ty].parts) deco.add(partMesh(part));
    // 取景框:只框 deco 零件(不含巨幹,否則被幹撐爆),再連幹一起渲
    const box = new THREE.Box3().setFromObject(deco);
    const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    scene.add(trunk, deco);
    const pad = 0.6;
    const views = [
      { n: 'front(+Z)', cam: [c.x, c.y, 60], up: [0, 1, 0], look: [c.x, c.y, 0], hw: sz.x / 2 + pad, hh: sz.y / 2 + pad },
      { n: 'side(+X)', cam: [60, c.y, c.z], up: [0, 1, 0], look: [0, c.y, c.z], hw: sz.z / 2 + pad, hh: sz.y / 2 + pad },
      { n: 'top(+Y)', cam: [c.x, 60, c.z], up: [0, 0, -1], look: [c.x, 0, c.z], hw: sz.x / 2 + pad, hh: sz.z / 2 + pad },
      { n: 'under(-Y)', cam: [c.x, -60, c.z], up: [0, 0, 1], look: [c.x, 0, c.z], hw: sz.x / 2 + pad, hh: sz.z / 2 + pad },
    ];
    views.forEach((v, i) => {
      const m = Math.max(v.hw, v.hh);   // 等比方框,避免變形
      const cam = new THREE.OrthographicCamera(-m, m, m, -m, 0.1, 200);
      cam.position.set(...v.cam); cam.up.set(...v.up); cam.lookAt(...v.look);
      renderer.setViewport(i * W, 0, W, H);
      renderer.setScissor(i * W, 0, W, H);
      renderer.render(scene, cam);
    });
    scene.remove(trunk, deco);
    const y0 = row * (H + 22);
    ctx.drawImage(renderer.domElement, 0, y0 + 20);
    ctx.fillStyle = '#dde3ec'; ctx.font = '13px monospace';
    ctx.fillText(`${ty}  (${GIANT_DECO[ty].parts.length} parts)  [ front | side | top | under ]  trunkR=${trunkR.toFixed(2)}`, 8, y0 + 14);
  });

  // ---- 蜂窩底部特寫(正下方仰視,緊框 comb):確認六角網格 ----
  const hive = new THREE.Group();
  for (const part of GIANT_DECO.beehive.parts) hive.add(partMesh(part));
  scene.add(hive);
  const CW = 520;
  renderer.setSize(CW, CW, false);
  const cx = it.x + 1.35 * it.s, cy = -1.72 * it.s, m = 0.62 * it.s;
  const cam = new THREE.OrthographicCamera(-m, m, m, -m, 0.1, 200);
  cam.position.set(cx, -60, 0); cam.up.set(0, 0, 1); cam.lookAt(cx, cy, 0);
  renderer.setViewport(0, 0, CW, CW); renderer.setScissor(0, 0, CW, CW);
  renderer.render(scene, cam);
  const combCv = document.createElement('canvas'); combCv.width = CW; combCv.height = CW + 22;
  const cctx = combCv.getContext('2d');
  cctx.fillStyle = '#1c1f26'; cctx.fillRect(0, 0, CW, CW + 22);
  cctx.drawImage(renderer.domElement, 0, 22);
  cctx.fillStyle = '#dde3ec'; cctx.font = '13px monospace';
  cctx.fillText('beehive comb — bottom-up (−Y↑) close-up  → 六角網格', 8, 15);

  return { png: canvas2d.toDataURL('image/png'), comb: combCv.toDataURL('image/png'), trunkR: +trunkR.toFixed(2) };
}, TYPES);

if (report.error) { console.log('ERROR:', report.error); process.exit(1); }
fs.writeFileSync(path.join(OUT, 'gnest.png'), Buffer.from(report.png.split(',')[1], 'base64'));
fs.writeFileSync(path.join(OUT, 'beehive_comb.png'), Buffer.from(report.comb.split(',')[1], 'base64'));
console.log('trunkR =', report.trunkR, '\nPNG →', path.join(OUT, 'gnest.png'), '\n     →', path.join(OUT, 'beehive_comb.png'));
await browser.close();
