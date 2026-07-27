// 神木 GIANT_DEFS 三視角拼接稽核(2026-07-23;神木零件組裝的視覺閉環工具)
// 每種樹出 front/side/top 正交三視圖 PNG + 枝根接點解析檢查(根端到幹軸距離 vs 錨體半徑,
// 抓「沒接到」FLOAT 與「接過頭」OVERSHOOT)。GIANT_DEFS 直接從 /js/biomes.js 原始碼抽取,不手抄。
// 注意:解析檢查只認「軸心零件」(無 px/pz)當錨體 —— 錨在側枝梢/側簇上的零件會誤報 FLOAT,
// 以三視圖目視為準(截圖才是最終裁決)。
// 前置:伺服器 8620 執行中(node server/server.js);Playwright 借 mapping_elf 安裝。
// 用法:node tools/shot_giants.mjs [--out DIR]
import { chromium } from 'file:///C:/Users/user/Documents/app/mapping_elf/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('--out', 'tools/.shots_giants'));
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 980 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto('http://localhost:8620', { waitUntil: 'networkidle' });

const report = await page.evaluate(async () => {
  const THREE = await import('three');

  // ---- 從真實原始碼抽 GIANT_DEFS(避免手抄漂移)----
  const src = await (await fetch('/public/js/biomes.js')).text();
  const m = src.match(/const GIANT_DEFS = \{[\s\S]*?\n\};/);
  if (!m) return { error: '抽不到 GIANT_DEFS' };
  const cyl = (r1, r2, h, n = 5) => ({ kind: 'cyl', r1, r2, h, g: new THREE.CylinderGeometry(r1, r2, h, n) });
  const cone = (r, h, n = 5) => ({ kind: 'cone', r, h, g: new THREE.ConeGeometry(r, h, n) });
  const ico = (r) => ({ kind: 'ico', r, g: new THREE.IcosahedronGeometry(r, 0) });
  const GIANT_DEFS = new Function('cyl', 'cone', 'ico', 'Math',
    m[0].replace(/\{ g: /g, '{ g: ').replace('const GIANT_DEFS =', 'return') )(cyl, cone, ico, Math);

  // ---- buildVegMeshes 同款實例變換(it = 標準株:s=1, ry=0, 無微傾)----
  const partMatrix = (part) => {
    const E = new THREE.Euler(part.rx || 0, 0, part.rz || 0);
    const Q = new THREE.Quaternion().setFromEuler(E);
    const P = new THREE.Vector3(part.px || 0, part.y, part.pz || 0);
    const S = new THREE.Vector3(1, part.sy || 1, 1);
    return new THREE.Matrix4().compose(P, Q, S);
  };

  // ---- 解析檢查:軸心零件(無 px/pz)組成「錨體」半徑剖面 R(y);偏移零件的根端必須埋入 ----
  const audit = {};
  for (const [sp, def] of Object.entries(GIANT_DEFS)) {
    const axial = [], off = [];
    for (const part of def.parts) ((part.px || part.pz) ? off : axial).push(part);
    // R(y) = 所有軸心零件在高度 y 的最大半徑(cyl/cone 線性內插、ico 球截面;含 sy 縮放)
    const RofY = (y) => {
      let R = 0;
      for (const p of axial) {
        const sy = p.sy || 1, s = p.g;
        if (s.kind === 'cyl' || s.kind === 'cone') {
          const h2 = (s.h / 2) * sy, lo = p.y - h2, hi = p.y + h2;
          if (y < lo || y > hi) continue;
          const t = (y - lo) / (hi - lo);
          const rBot = s.kind === 'cyl' ? s.r2 : s.r, rTop = s.kind === 'cyl' ? s.r1 : 0;
          R = Math.max(R, rBot + (rTop - rBot) * t);
        } else {
          const dy = (y - p.y) / (p.sy || 1);
          if (Math.abs(dy) < s.r) R = Math.max(R, Math.sqrt(s.r * s.r - dy * dy));
        }
      }
      return R;
    };
    const rows = [];
    off.forEach((part, idx) => {
      const M = partMatrix(part), s = part.g;
      const V = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M);
      let ends;   // [端點, 該端自身半徑]
      if (s.kind === 'cyl') ends = [[V(0, -s.h / 2, 0), s.r2], [V(0, s.h / 2, 0), s.r1]];
      else if (s.kind === 'cone') ends = [[V(0, -s.h / 2, 0), s.r], [V(0, s.h / 2, 0), 0.01]];
      else ends = [[V(0, 0, 0), s.r]];   // ico 簇:圓心 vs 錨體
      // 根端 = 埋入量最大的端(penetration = R(y) − 到軸距離)
      let best = null;
      for (const [pt, er] of ends) {
        const d = Math.hypot(pt.x, pt.z), R = RofY(pt.y);
        const pen = R - d;
        if (!best || pen > best.pen) best = { pt, er, d, R, pen };
      }
      const gap = -best.pen - best.er;   // 根端表面到錨體表面的縫(>0 = 懸空)
      // 穿頭:根端越過幹軸、跑到外向方向的反側且突出錨體表面
      const tip = ends.length > 1 ? ends.find(([pt]) => pt !== best.pt)[0] : best.pt;
      const ux = tip.x - best.pt.x, uz = tip.z - best.pt.z, ul = Math.hypot(ux, uz) || 1;
      const proj = (best.pt.x * ux + best.pt.z * uz) / ul;   // 根端在外向方向上的位置(<0 = 越過軸心)
      const overshoot = proj < 0 && best.d > best.R + 0.05;
      rows.push({
        i: idx, kind: s.kind, y: part.y, px: part.px || 0, pz: part.pz || 0,
        rx: +(part.rx || 0).toFixed(2), rz: +(part.rz || 0).toFixed(2),
        rootY: +best.pt.y.toFixed(1), rootDist: +best.d.toFixed(2), anchorR: +best.R.toFixed(2),
        gap: +gap.toFixed(2),
        flag: gap > 0.05 ? 'FLOAT' : overshoot ? 'OVERSHOOT' : 'ok',
      });
    });
    audit[sp] = rows;
  }

  // ---- 三視角正交渲染(front +Z / side +X / top +Y)----
  const W = 300, H = 880, TOP = 300;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(W * 3, H, false);
  renderer.setClearColor(0x2a2e36, 1);
  renderer.setScissorTest(true);
  const scene = new THREE.Scene();
  scene.add(new THREE.DirectionalLight(0xffffff, 2.0).translateX(30).translateY(80).translateZ(50),
            new THREE.AmbientLight(0xffffff, 0.8));
  const grid = new THREE.GridHelper(44, 22, 0x4a5160, 0x3a4050);
  scene.add(grid);

  const shots = {};
  const canvas2d = document.createElement('canvas');
  canvas2d.width = W * 3; canvas2d.height = H + 24;
  const ctx = canvas2d.getContext('2d');

  for (const [sp, def] of Object.entries(GIANT_DEFS)) {
    const group = new THREE.Group();
    for (const part of def.parts) {
      const mesh = new THREE.Mesh(part.g.g, new THREE.MeshLambertMaterial({ color: part.c }));
      mesh.applyMatrix4(partMatrix(part));
      group.add(mesh);
    }
    scene.add(group);
    const halfW = 22, top = def.h * 1.12 + 6, bot = -4;
    const midY = (top + bot) / 2, halfH = (top - bot) / 2;
    const views = [
      { name: 'front', cam: [0, midY, 200], up: [0, 1, 0], look: [0, midY, 0], hw: halfW, hh: halfH },
      { name: 'side', cam: [200, midY, 0], up: [0, 1, 0], look: [0, midY, 0], hw: halfW, hh: halfH },
      { name: 'top', cam: [0, 250, 0], up: [0, 0, -1], look: [0, 0, 0], hw: halfW, hh: halfW },
    ];
    views.forEach((v, i) => {
      const cam = new THREE.OrthographicCamera(-v.hw, v.hw, v.hh, -v.hh, 0.1, 600);
      cam.position.set(...v.cam); cam.up.set(...v.up); cam.lookAt(...v.look);
      const vh = v.name === 'top' ? TOP : H;
      renderer.setViewport(i * W, H - vh, W, vh);
      renderer.setScissor(i * W, H - vh, W, vh);
      renderer.render(scene, cam);
    });
    scene.remove(group);
    ctx.fillStyle = '#1c1f26'; ctx.fillRect(0, 0, canvas2d.width, canvas2d.height);
    ctx.drawImage(renderer.domElement, 0, 24);
    ctx.fillStyle = '#dde3ec'; ctx.font = '14px monospace';
    ctx.fillText(`${sp}  h=${def.h} r=${def.r}   [front | side | top]`, 8, 16);
    shots[sp] = canvas2d.toDataURL('image/png');
  }
  return { audit, shots };
});

if (report.error) { console.log('ERROR:', report.error); process.exit(1); }
for (const [sp, url] of Object.entries(report.shots)) {
  fs.writeFileSync(path.join(OUT, `${sp}.png`), Buffer.from(url.split(',')[1], 'base64'));
}
console.log('接點解析檢查(gap>0 = 根端表面懸空公尺數;OVERSHOOT = 穿過幹軸突出反側):');
for (const [sp, rows] of Object.entries(report.audit)) {
  console.log(`\n== ${sp} ==`);
  for (const r of rows) {
    console.log(`  ${r.flag.padEnd(9)} ${r.kind.padEnd(4)} y=${String(r.y).padStart(4)} px=${String(r.px).padStart(5)} pz=${String(r.pz).padStart(5)} rx=${r.rx} rz=${r.rz} | 根端y=${r.rootY} 距軸=${r.rootDist} 錨半徑=${r.anchorR} gap=${r.gap}`);
  }
}
console.log('\nPNG →', OUT);
await browser.close();
