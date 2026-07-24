// 神木四季稽核(2026-07-24)—— 驗每種神木都有春/夏/秋/冬版本(樹冠隨季疊色、樹幹不動)。
// 從 /js/biomes.js 抽 GIANT_DEFS + SEASON_GIANT_TINT,套用與 seasonColor 相同的 'gleaf' 自動標記
// (綠色主導 = 樹冠 → 疊 tint;紅褐樹幹不動),每種樹一列 × 四季四欄(front 正視)。
// 前置:伺服器 8620 執行中;Playwright 借 mapping_elf。用法:node tools/shot_seasons.mjs [--out DIR]
import { chromium } from 'file:///C:/Users/user/Documents/app/mapping_elf/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('--out', 'tools/.shots_giants'));
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto('http://localhost:8620', { waitUntil: 'networkidle' });

const report = await page.evaluate(async () => {
  const THREE = await import('three');
  const src = await (await fetch('/js/biomes.js')).text();
  const cyl = (r1, r2, h, n = 5) => new THREE.CylinderGeometry(r1, r2, h, n);
  const cone = (r, h, n = 5) => new THREE.ConeGeometry(r, h, n);
  const ico = (r) => new THREE.IcosahedronGeometry(r, 0);
  const GIANT_DEFS = new Function('cyl', 'cone', 'ico', 'Math',
    src.match(/const GIANT_DEFS = \{[\s\S]*?\n\};/)[0].replace('const GIANT_DEFS =', 'return'))(cyl, cone, ico, Math);
  // 抽 SEASON_GIANT_TINT(避免手抄漂移)
  const tm = src.match(/const SEASON_GIANT_TINT = (\{[^}]*\});/);
  const TINT = new Function('return ' + tm[1])();
  const mulHex = (a, b) => ((((a >> 16 & 255) * (b >> 16 & 255) / 255) | 0) << 16)
    | ((((a >> 8 & 255) * (b >> 8 & 255) / 255) | 0) << 8) | (((a & 255) * (b & 255) / 255) | 0);
  // 與 biomes.js 相同的自動標記規則:綠主導 = 樹冠(gleaf)
  const isLeaf = (c) => { const r = c >> 16 & 255, g = c >> 8 & 255, b = c & 255; return g > r && g >= b; };
  const partColor = (p, season) => (p.c != null && isLeaf(p.c)) ? mulHex(p.c, TINT[season]) : (p.c ?? 0x777777);

  const partMatrix = (part) => {
    const Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(part.rx || 0, 0, part.rz || 0));
    const P = new THREE.Vector3(part.px || 0, part.y, part.pz || 0);
    const S = new THREE.Vector3(1, part.sy || 1, 1);
    return new THREE.Matrix4().compose(P, Q, S);
  };

  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  const NAME = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
  const species = Object.keys(GIANT_DEFS);
  const W = 240, H = 420;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(W * 4, H, false);
  renderer.setClearColor(0x2a2e36, 1);
  renderer.setScissorTest(true);
  const scene = new THREE.Scene();
  scene.add(new THREE.DirectionalLight(0xffffff, 2.0).translateX(30).translateY(80).translateZ(60),
            new THREE.AmbientLight(0xffffff, 0.85));

  const canvas2d = document.createElement('canvas');
  canvas2d.width = W * 4; canvas2d.height = species.length * (H + 22) + 4;
  const ctx = canvas2d.getContext('2d');
  ctx.fillStyle = '#1c1f26'; ctx.fillRect(0, 0, canvas2d.width, canvas2d.height);

  species.forEach((sp, row) => {
    const def = GIANT_DEFS[sp];
    const top = def.h * 1.1 + 4, bot = -4, midY = (top + bot) / 2, halfH = (top - bot) / 2, halfW = halfH * (W / H);
    SEASONS.forEach((season, i) => {
      const group = new THREE.Group();
      for (const part of def.parts) {
        const mesh = new THREE.Mesh(part.g, new THREE.MeshLambertMaterial({ color: partColor(part, season) }));
        mesh.applyMatrix4(partMatrix(part));
        group.add(mesh);
      }
      scene.add(group);
      const cam = new THREE.OrthographicCamera(-halfW, halfW, midY + halfH, midY - halfH, 0.1, 600);
      cam.position.set(0, midY, 260); cam.lookAt(0, midY, 0);
      renderer.setViewport(i * W, 0, W, H);
      renderer.setScissor(i * W, 0, W, H);
      renderer.render(scene, cam);
      scene.remove(group);
    });
    const y0 = row * (H + 22);
    ctx.drawImage(renderer.domElement, 0, y0 + 20);
    ctx.fillStyle = '#dde3ec'; ctx.font = '13px monospace';
    ctx.fillText(`${sp}  h=${def.h}   [ ${SEASONS.map((s) => NAME[s]).join(' | ')} ]`, 8, y0 + 14);
  });
  return { png: canvas2d.toDataURL('image/png'), species, tint: TINT };
});

if (report.error) { console.log('ERROR:', report.error); process.exit(1); }
fs.writeFileSync(path.join(OUT, 'seasons.png'), Buffer.from(report.png.split(',')[1], 'base64'));
console.log('species:', report.species.join(', '));
console.log('SEASON_GIANT_TINT:', report.tint);
console.log('PNG →', path.join(OUT, 'seasons.png'));
await browser.close();
