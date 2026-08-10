// 地標零件庫視覺閉環(2026-08-05;P2c 首批 rock 零件的截圖稽核)
// 同一顆 seed 的地標拍兩張:fallback(不載零件庫 = 舊畫面)vs lib(載入 rock.glb),
// 疊 beaconCollider 實測圓柱(青色線框)—— 「看到多粗 = 撞到多粗」肉眼可驗(A30)。
// 前置:伺服器執行中;Playwright 借用 mapping_elf 的安裝(同 shot_units.mjs)。
// 用法:node tools/shot_beacons.mjs [--url http://localhost:8666] [--kind cairn] [--seeds 3,7]
import { chromium } from 'file:///C:/Users/user/Documents/app/mapping_elf/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('--out', 'tools/.shots/beacons'));
const URL = arg('--url', 'http://localhost:8666');
const KIND = arg('--kind', 'cairn');
const SEEDS = arg('--seeds', '3,7').split(',').map(Number);
const SIZE = 720;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });

for (const useLib of [false, true]) {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  const shots = await page.evaluate(async ({ useLib, KIND, SEEDS, SIZE }) => {
    const THREE = await import('three');
    const { buildBeacon, beaconCollider } = await import('/public/js/beacons.js');
    const { loadPartLibs } = await import('/public/js/partlib.js');
    const { setCelSun } = await import('/public/js/toon.js');
    if (useLib) await loadPartLibs();          // false = 保險絲路徑,證明降級 = 舊畫面

    const canvas = document.createElement('canvas');
    canvas.width = SIZE; canvas.height = SIZE;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(SIZE, SIZE, false);
    renderer.setClearColor(0x2a2e36, 1);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
    const SUN = new THREE.Vector3(-0.5, 0.45, -0.75).normalize();  // 側後鍵光:暗面要在畫面上
    setCelSun(SUN);
    const dir = new THREE.DirectionalLight(0xffffff, 2.1);
    dir.position.copy(SUN).multiplyScalar(50);
    scene.add(dir, new THREE.HemisphereLight(0xdff1ff, 0x2b2f38, 1.1));
    scene.add(new THREE.GridHelper(30, 30, 0x4a5160, 0x3a4050));

    const out = [];
    for (const seed of SEEDS) {
      const g = buildBeacon(KIND, seed);
      scene.add(g);
      const col = beaconCollider(g);
      const wire = new THREE.Mesh(
        new THREE.CylinderGeometry(col.r, col.r, col.h, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x2ee6d6, wireframe: true, transparent: true, opacity: 0.5 }),
      );
      wire.position.y = col.h / 2;
      scene.add(wire);
      // 全身 + 兵線距離兩張。**取景 MUST 由量到的碰撞柱推導**(`col.r`/`col.h`),
      // MUST NOT 寫死距離:舊版的 9m / 22m 是照 `cairn`(13m)調的,套到 mast(29m)與
      // pylon(35m)只框得到基座 —— 那兩款**從來沒有一張圖看得到碟/橫擔**,而每一行讀數
      // 都正常(同零件對照台 §5 那條「取景框要量台上真的建出來的那一團幾何」)。
      const fit = (m) => Math.max(col.h, col.r * 2) * m / (2 * Math.tan(camera.fov * Math.PI / 360));
      for (const [tag, d, lookY] of [['full', fit(1.15), col.h * 0.5], ['lane', Math.max(22, fit(1.9)), col.h * 0.42]]) {
        camera.position.set(d * 0.82, col.h * 0.62, d * 0.57);
        camera.lookAt(0, lookY, 0);
        renderer.render(scene, camera);
        out.push({ name: `${KIND}_s${seed}_${tag}_${useLib ? 'lib' : 'fallback'}`, png: canvas.toDataURL('image/png'), r: col.r.toFixed(2), h: col.h.toFixed(2) });
      }
      scene.remove(g, wire);
    }
    return out;
  }, { useLib, KIND, SEEDS, SIZE });
  for (const s of shots) {
    fs.writeFileSync(path.join(OUT, `${s.name}.png`), Buffer.from(s.png.split(',')[1], 'base64'));
    console.log(`${s.name}.png  collider r=${s.r} h=${s.h}`);
  }
  await page.close();
}
await browser.close();
console.log('OUT:', OUT);
