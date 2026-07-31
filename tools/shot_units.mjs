// 機體外觀截圖稽核(2026-07-22;機體 3D 重構的視覺閉環工具)
// 前置:伺服器在 8620 執行中(node server/server.js);Playwright 借用 mapping_elf 的安裝
// 用法:node tools/shot_units.mjs [--ids s01,t03|all] [--out DIR] [--size 640]
//   每台機體輸出:front(前 3/4)/ side(正側)/ back(後 3/4)三視角;
//   變形者(morph)另補 fly(飛行型 pose(1) 前 3/4)。
//   同時回報 build 例外 / mesh 數 / 包圍盒 —— 兼作「模型可建性」快速稽核。
// 渲染管線與展示台(charPreview.js)同源:同光照、同 cel 光向、同 locomotion 收斂。
import { chromium } from 'file:///C:/Users/user/Documents/app/mapping_elf/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const OUT = path.resolve(arg('--out', 'tools/.shots'));
const IDS = arg('--ids', 'all');
const SIZE = parseInt(arg('--size', '640'), 10);
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto('http://localhost:8620', { waitUntil: 'networkidle' });

const report = await page.evaluate(async ({ idsArg, SIZE }) => {
  const THREE = await import('three');
  const { makeUnit, heroTargetH } = await import('/public/js/models.js');
  const { stepLocomotion, stepCombatFx } = await import('/public/js/locomotion.js');
  const { CHARACTERS, charKind } = await import('/public/js/data.js');
  const { updateCelLight, setCelSun } = await import('/public/js/toon.js');

  const ids = idsArg === 'all' ? Object.keys(CHARACTERS) : idsArg.split(',');
  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x2a2e36, 1);   // 中性深灰:亮部/暗部/描邊都看得清

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
  const SUN = new THREE.Vector3(0.4, 0.8, 0.4);
  setCelSun(SUN);
  const dir = new THREE.DirectionalLight(0xffffff, 2.1);
  dir.position.copy(SUN).multiplyScalar(50);
  scene.add(dir, new THREE.HemisphereLight(0xdff1ff, 0x2b2f38, 1.1));
  // 地面參考網格(浮空/沉地一眼可見)
  const grid = new THREE.GridHelper(30, 30, 0x4a5160, 0x3a4050);
  scene.add(grid);

  const measure = (obj) => {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3(), tmp = new THREE.Box3();
    obj.traverse((o) => {
      if (o.userData.teamRing) return;
      if (o.isSkinnedMesh) {
        o.computeBoundingBox();
        tmp.copy(o.boundingBox).applyMatrix4(o.matrixWorld);
        box.union(tmp);
      } else if (o.isMesh) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        box.union(tmp);
      }
    });
    return box;
  };

  const out = [];
  for (const id of ids) {
    const ch = CHARACTERS[id];
    if (!ch) { out.push({ id, error: '查無角色' }); continue; }
    const kind = charKind(id);
    const rec = { id, kind, shots: {}, meshes: 0 };
    let mesh = null;
    try {
      const side = ch.side === 'MERC' ? 'STEEL' : ch.side;
      const built = makeUnit('hero:' + kind, side, { ring: false, ch: id });
      mesh = built.group;
      scene.add(mesh);
      mesh.updateMatrixWorld(true);
      let n = 0;
      mesh.traverse((o) => { if (o.isMesh && !o.userData.isOutline) n++; });
      rec.meshes = n;

      const rig = mesh.userData.rig;
      const ent = { mesh, heroY: 0 };
      // 收斂到靜止戰鬥姿勢(與 audit_muzzle 同法)
      let t = 100; const dt = 1 / 60;
      for (let i = 0; i < 90; i++) {
        t += dt;
        stepCombatFx(ent, t, dt);
        stepLocomotion(ent, dt, t, mesh.position.x, mesh.position.z, mesh.rotation.y);
      }
      mesh.updateMatrixWorld(true);

      const box = measure(mesh);
      const size = box.getSize(new THREE.Vector3());
      const c = box.getCenter(new THREE.Vector3());
      rec.bbox = { w: +size.x.toFixed(2), h: +size.y.toFixed(2), d: +size.z.toFixed(2), minY: +box.min.y.toFixed(2) };
      const fitR = Math.max(1, size.length() / 2);
      const dist = fitR / Math.tan((38 / 2) * Math.PI / 180) * 1.15;

      const shoot = (yaw, pitch, name) => {
        camera.position.set(
          c.x + Math.sin(yaw) * Math.cos(pitch) * dist,
          c.y + Math.sin(pitch) * dist,
          c.z + Math.cos(yaw) * Math.cos(pitch) * dist,
        );
        camera.lookAt(c);
        camera.updateMatrixWorld(true);
        updateCelLight(camera);
        renderer.render(scene, camera);
        rec.shots[name] = canvas.toDataURL('image/png');
      };
      // 機體面朝 +z(models.js 約定);camera z = cos(yaw)·dist ⇒ yaw≈0.18π 在 +z 側 = 前 3/4
      shoot(Math.PI * 0.18, 0.2, 'front');
      shoot(Math.PI * 0.5, 0.12, 'side');
      shoot(Math.PI * 0.82, 0.25, 'back');
      if (rig?.kind === 'morph' && rig.pose) {
        // 真飛行姿:與 audit_muzzle ③ 同法 —— heroY 拉高讓 locomotion 自己收斂到 m=1
        // (直接 pose(1) 會在下一幀被 stepLocomotion 依地面狀態拉回地面姿)
        ent.heroY = 60;
        for (let i = 0; i < 300; i++) {   // L.morph damp 2.6 → 5s 內收斂到 1
          t += dt;
          stepCombatFx(ent, t, dt);
          stepLocomotion(ent, dt, t, mesh.position.x, mesh.position.z, mesh.rotation.y);
        }
        mesh.updateMatrixWorld(true);
        const fb = measure(mesh);
        const fc = fb.getCenter(new THREE.Vector3());
        const fr = Math.max(1, fb.getSize(new THREE.Vector3()).length() / 2);
        const fd = fr / Math.tan((38 / 2) * Math.PI / 180) * 1.15;
        camera.position.set(fc.x + Math.sin(Math.PI * 0.18) * fd * 0.96, fc.y + 0.35 * fd, fc.z + Math.cos(Math.PI * 0.18) * fd * 0.96);
        camera.lookAt(fc);
        camera.updateMatrixWorld(true);
        updateCelLight(camera);
        renderer.render(scene, camera);
        rec.shots.fly = canvas.toDataURL('image/png');
        rig.pose(0);
      }
    } catch (e) {
      rec.error = e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n');
    }
    if (mesh) scene.remove(mesh);
    out.push(rec);
  }
  return out;
}, { idsArg: IDS, SIZE });

let fail = 0;
for (const r of report) {
  if (r.error) { fail++; console.log(`✗ ${r.id} BUILD FAIL: ${r.error}`); continue; }
  for (const [name, dataUrl] of Object.entries(r.shots)) {
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    fs.writeFileSync(path.join(OUT, `${r.id}_${name}.png`), buf);
  }
  delete r.shots;
  console.log(`✓ ${r.id} (${r.kind}) meshes=${r.meshes} bbox=${r.bbox.w}×${r.bbox.h}×${r.bbox.d} minY=${r.bbox.minY}`);
}
console.log(`\n輸出:${OUT};${report.length - fail}/${report.length} 建模成功`);
await browser.close();
process.exit(fail ? 1 : 0);
