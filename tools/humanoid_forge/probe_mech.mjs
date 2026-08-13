// ============ 機體結構探針(dev-only;headless)============
// 「截圖上看不到那顆零件」有兩種原因:①它沒被建出來 ②它被建在畫面外/被遮住。
// 只看圖分不出來 —— 本支直接問場景:網格數、包圍盒、rig 通道齊不齊。
//
//   node tools/humanoid_forge/probe_mech.mjs --port 8636 [--id t06@flight] [--all]
//
// 前提:dev server 已在該埠跑著(node tools/humanoid_forge.mjs --port 8636)。
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
let chromium;
try {
  chromium = req('playwright').chromium;
} catch {
  chromium = req('C:/Users/user/AppData/Roaming/npm/node_modules/playwright').chromium;
}

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const port = Number(arg('port', '8636'));
const only = arg('id', null);
const all = process.argv.includes('--all');

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error(`✗ 頁面例外:${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') console.error(`✗ console:${m.text()}`); });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('!!window.__forge && !!window.__shot', null, { timeout: 20000 });

  const rows = await page.evaluate(async ({ only, all }) => {
    const F = window.__forge, THREE = window.__scene.THREE;
    const ids = all ? F.specs() : [only || F.specs()[0]];
    const out = [];
    for (const id of ids) {
      F.setSpec(id);
      F.joints(false);
      F.step(2);
      const rig = F.rig();
      const root = rig.tilt ? rig.tilt.parent : (rig.hips?.parent || rig.spine?.parent);
      let meshes = 0, tris = 0;
      const box = new THREE.Box3();
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (!o.isMesh || o.userData.isOutline || o.name === 'outline') return;
        meshes++;
        const g = o.geometry;
        if (g?.index) tris += g.index.count / 3;
        else if (g?.attributes?.position) tris += g.attributes.position.count / 3;
        box.expandByObject(o);
      });
      const sz = box.getSize(new THREE.Vector3()), ct = box.getCenter(new THREE.Vector3());
      out.push({
        id, meshes, tris: Math.round(tris),
        size: [sz.x, sz.y, sz.z].map((v) => +v.toFixed(2)),
        centre: [ct.x, ct.y, ct.z].map((v) => +v.toFixed(2)),
        rig: {
          kind: rig.kind,
          wings: rig.wings?.length || 0, jets: rig.jets?.length || 0,
          rotors: (F.ent()?.unit?.spin || window.__scene.scene && 0) || 0,
          tailSegs: rig.tailSegs?.length || 0,
          muzL: !!rig.muzzles?.light?.n, muzH: !!rig.muzzles?.heavy?.n,
          wpnL: !!rig.wpn?.light, wpnH: !!rig.wpn?.heavy,
          weap: rig.weap, moveSig: !!rig.moveSig, castSig: !!rig.castSig,
        },
      });
    }
    return out;
  }, { only, all });

  for (const r of rows) {
    const g = r.rig;
    console.log(`${r.id.padEnd(14)} mesh ${String(r.meshes).padStart(3)}  tri ${String(r.tris).padStart(6)}  `
      + `size ${r.size.join('×')}  centre ${r.centre.join(',')}  `
      + `[${g.kind} wing ${g.wings} jet ${g.jets} tail ${g.tailSegs} `
      + `muz ${g.muzL ? 'L' : '-'}${g.muzH ? 'H' : '-'} wpn ${g.wpnL ? 'L' : '-'}${g.wpnH ? 'H' : '-'}]`
      + (r.meshes > 250 ? '  ⚠ 網格數超過 250' : ''));
  }
} finally {
  await browser.close();
}
