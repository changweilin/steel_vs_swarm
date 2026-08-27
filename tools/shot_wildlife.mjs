// ============ 生態動物群 3D 實機渲染截圖工具 ============
import { chromiumOrNull, serve } from './pw.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = path.resolve(join(ROOT, 'tools', '.shots_wildlife'));
fs.mkdirSync(OUT, { recursive: true });

const chromium = await chromiumOrNull();
if (!chromium) {
  console.log('未安裝 playwright,跳過');
  process.exit(0);
}

const server = await serve(8635);
const SIZE = 800;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(server.url, { waitUntil: 'networkidle' });

const shots = await page.evaluate(async ({ SIZE }) => {
  const THREE = await import('three');
  const { birdParts, fishParts, catParts, dogParts } = await import('/public/js/wildlife.js');
  const { envMat, setCelSun } = await import('/public/js/toon.js');

  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x232730, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  const SUN = new THREE.Vector3(-0.6, 0.55, -0.55).normalize();
  setCelSun(SUN);
  const dir = new THREE.DirectionalLight(0xffffff, 2.2);
  dir.position.copy(SUN).multiplyScalar(30);
  scene.add(dir, new THREE.HemisphereLight(0xdff1ff, 0x2b2f38, 1.2));
  scene.add(new THREE.GridHelper(10, 10, 0x4a5160, 0x333842));

  const geoOf = (rows) => {
    const group = new THREE.Group();
    for (const p of rows) {
      const [t, a, b, c, sg] = p.g;
      const geo = t === 'box' ? new THREE.BoxGeometry(a, b, c)
        : t === 'cyl' ? new THREE.CylinderGeometry(a, b, c, sg || 8)
          : t === 'cone' ? new THREE.ConeGeometry(a, b, sg || 8)
            : new THREE.IcosahedronGeometry(a, 1);
      const mat = envMat(p.c, { vertexColors: false, wash: 0.3, cool: 0.45, rim: 0.2 });
      const mesh = new THREE.Mesh(geo, mat);
      const [px = 0, py = 0, pz = 0] = p.p || [];
      const [rx = 0, ry = 0, rz = 0] = p.r || [];
      mesh.position.set(px, py, pz);
      mesh.rotation.set(rx, ry, rz);
      group.add(mesh);
    }
    return group;
  };

  const species = [
    { name: 'bird', parts: birdParts(), cam: [1.8, 1.2, 2.0], look: [0, 0.2, 0] },
    { name: 'fish', parts: fishParts(), cam: [1.5, 0.8, 1.8], look: [0, 0, 0] },
    { name: 'cat',  parts: catParts(),  cam: [1.2, 0.7, 1.4], look: [0, 0.3, 0] },
    { name: 'dog',  parts: dogParts(),  cam: [1.5, 0.9, 1.7], look: [0, 0.4, 0] },
  ];

  const results = [];
  for (const sp of species) {
    const grp = geoOf(sp.parts);
    scene.add(grp);
    camera.position.set(...sp.cam);
    camera.lookAt(...sp.look);
    renderer.render(scene, camera);
    results.push({ name: sp.name, png: canvas.toDataURL('image/png') });
    scene.remove(grp);
  }
  return results;
}, { SIZE });

for (const s of shots) {
  const buf = Buffer.from(s.png.split(',')[1], 'base64');
  fs.writeFileSync(path.join(OUT, `wildlife_${s.name}.png`), buf);
  console.log(`✓ 截取實機 3D 生態物種模型:${s.name}`);
}

await browser.close();
console.log(`完成! 輸出至:${OUT}`);
