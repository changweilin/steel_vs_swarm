// 變形過程截圖(㋓ 真瀏覽器;2026-08-15 逐零件變形上線後的視覺閉環)
// 前置:伺服器在執行中;Playwright 借用 mapping_elf 的安裝。
// 用法:SVS_URL=http://localhost:8642 node tools/shot_morph.mjs [--ids t11,s03|all] [--size 480]
//       --fold   同時輸出 `?morph=0` 的對照組(2026-08-14 的根節點收摺)
//
// 每台輸出一條**膠片**(m = 0 / 0.25 / 0.5 / 0.75 / 1 橫向拼接)+ 一行讀數:
//   對應 / soft / 單態獨有 / 對應零件在兩態的最大位移 / **換樹落差**(同一顆零件在兩棵樹的
//   世界位置差;帶內 MUST 恆為 0 —— 那就是「換樹看不出來」的量化指標)。
//
// 為什麼要截圖:離線稽核(audit_morph_rig)驗得到規則與數學,驗不到「看起來像不像在變形」——
// 零件對應錯一組的症狀是某塊裝甲橫飛過機體,而每一條斷言照樣全綠(落差仍是 0:兩棵樹**一致地**錯)。
import { chromium } from 'file:///C:/Users/user/Documents/app/mapping_elf/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('--out', 'tools/.shots'));
const IDS = arg('--ids', 'all');
const SIZE = parseInt(arg('--size', '480'), 10);
const FOLD = process.argv.includes('--fold');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: SIZE * 5, height: SIZE } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
const base = process.env.SVS_URL || 'http://localhost:8620';
await page.goto(FOLD ? `${base}/?morph=0` : base, { waitUntil: 'networkidle' });

const report = await page.evaluate(async ({ idsArg, SIZE }) => {
  const THREE = await import('three');
  const { makeUnit } = await import('/public/js/models.js');
  const { stepLocomotion } = await import('/public/js/locomotion.js');
  const { CHARACTERS, charKind } = await import('/public/js/data.js');
  const { updateCelLight, setCelSun } = await import('/public/js/toon.js');

  const STOPS = [0, 0.25, 0.5, 0.75, 1];
  const ids = (idsArg === 'all' ? Object.keys(CHARACTERS) : idsArg.split(','))
    .filter((id) => charKind(id) === 'morph');

  const canvas = document.createElement('canvas');
  canvas.width = SIZE * STOPS.length; canvas.height = SIZE;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(SIZE * STOPS.length, SIZE, false);
  renderer.setClearColor(0x2a2e36, 1);
  renderer.setScissorTest(true);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
  const SUN = new THREE.Vector3(0.4, 0.8, 0.4);
  setCelSun(SUN);
  scene.add(new THREE.DirectionalLight(0xffffff, 2.1).translateOnAxis(SUN.clone().normalize(), 50),
    new THREE.HemisphereLight(0xdff1ff, 0x2b2f38, 1.1));
  scene.add(new THREE.GridHelper(30, 30, 0x4a5160, 0x3a4050));

  const box3 = (obj) => {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3(), tmp = new THREE.Box3();
    obj.traverse((o) => {
      if (!o.isMesh || o.userData.isOutline || !o.visible) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
    });
    return box;
  };
  const wp = (n) => n.getWorldPosition(new THREE.Vector3());
  const out = [];

  for (const ch of ids) {
    const { group } = makeUnit('hero:morph', CHARACTERS[ch].side, { ring: false, ch });
    scene.add(group);
    const M = group.userData.morph;
    const P = M?.plan || null;
    const ent = { id: ch, mesh: group, heroY: 0, loco: null };

    // 取景:兩態的聯集(剪影差很大 ⇒ 只框地面型會讓飛行型滿出畫面)
    const vis = [M.gg.visible, M.ag.visible];
    M.gg.visible = true; M.ag.visible = true;
    const box = box3(group);
    M.gg.visible = vis[0]; M.ag.visible = vis[1];
    const c = box.getCenter(new THREE.Vector3()), r = box.getBoundingSphere(new THREE.Sphere()).radius;

    // 對應零件在兩態的最大位移(這一台變形時零件真的走了多遠)
    let travel = 0;
    if (P) { group.updateMatrixWorld(true); for (let i = 0; i < P.g.pairs.length; i++) travel = Math.max(travel, wp(P.g.pairs[i].n).distanceTo(wp(P.a.pairs[i].n))); }

    let seam = 0, si = 0, t = 0;
    ent.heroY = 5;
    for (let f = 0; f < 900 && si < STOPS.length; f++) {
      if (f) { t += 1 / 60; stepLocomotion(ent, 1 / 60, t, 0, 0, 0); }
      if (M.m < STOPS[si] - 0.004) continue;
      group.updateMatrixWorld(true);
      // 落差只量**收斂帶內**(|m−0.5| ≤ 0.5−HALF):帶外只有一棵樹看得見,兩棵樹差多少不影響畫面;
      // 帶內才是「換樹那一幀接不接得上」,而換樹恰好落在帶正中央。
      if (P && Math.abs(M.m - 0.5) <= 0.2) {
        for (let i = 0; i < P.g.pairs.length; i++) seam = Math.max(seam, wp(P.g.pairs[i].n).distanceTo(wp(P.a.pairs[i].n)));
      }
      // 逐格畫進膠片(同一個相機軌道,只有進度不同)
      const a = Math.PI * 0.22;
      camera.position.set(c.x + Math.sin(a) * r * 2.5, c.y + r * 0.55, c.z + Math.cos(a) * r * 2.5);
      camera.lookAt(c);
      camera.aspect = 1;
      camera.updateProjectionMatrix();
      updateCelLight(camera);
      renderer.setViewport(si * SIZE, 0, SIZE, SIZE);
      renderer.setScissor(si * SIZE, 0, SIZE, SIZE);
      renderer.render(scene, camera);
      si++;
      if (si >= STOPS.length) break;
      if (STOPS[si] >= 1) { ent.heroY = 5; }
    }
    out.push({ ch, png: canvas.toDataURL('image/png'), plan: P ? P.n : null,
      travel: +travel.toFixed(2), seam: +seam.toFixed(4), stops: si });
    scene.remove(group);
  }
  return out;
}, { idsArg: IDS, SIZE });
await browser.close();

for (const r of report) {
  const f = path.join(OUT, `morph_${r.ch}${FOLD ? '_fold' : ''}.png`);
  fs.writeFileSync(f, Buffer.from(r.png.split(',')[1], 'base64'));
  const n = r.plan;
  console.log(`${r.ch}  ${n ? `對應 ${n.pair}(soft ${n.soft})/ 地面獨有 ${n.gOnly} / 飛行獨有 ${n.aOnly}` : '(無運動表:退回根節點收摺)'}`
    + `  位移 ${r.travel}m  換樹落差 ${r.seam}m  → ${path.relative(process.cwd(), f)}`);
}
