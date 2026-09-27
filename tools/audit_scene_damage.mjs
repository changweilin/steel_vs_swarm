// Exercise shipped scene damage on every destructible kind, including direct jumps and restored snapshots.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromiumOrNull, chromePath, serve } from './pw.mjs';
import { readSrc, grabMethod } from './audit_src.mjs';

const chromium = await chromiumOrNull();
assert.ok(chromium, 'Playwright is required for geometry and visual verification');
const server = await serve();
const browser = await chromium.launch({ headless: true, executablePath: chromePath() });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 2500 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  if (process.env.THREE_MODULE) {
    const source = await readFile(process.env.THREE_MODULE, 'utf8');
    await page.route('**/three@0.160.0/build/three.module.js', (route) => route.fulfill({ contentType: 'text/javascript', body: source }));
  }
  await page.route('**/main.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  const report = await page.evaluate(async (collapseSource) => {
    const THREE = await import('three');
    const { buildHazard } = await import('/public/js/hazards.js');
    const { SCENE_STRUCT } = await import('/public/js/data.js');
    const { applySceneDamage, sceneDamageStage, sceneDamageProfile, sceneDamageBurst } = await import('/public/js/sceneDamage.js');
    const { makeDamageFx } = await import('/public/js/vfx.js');
    const { disposeTree, setCelSun, updateCelLight } = await import('/public/js/toon.js');
    setCelSun(new THREE.Vector3(0.4, 0.8, 0.4));
    const check = (value, message) => { if (!value) throw new Error(message); };
    for (const [hp, max, stage] of [[100,100,0],[50.01,100,0],[50,100,1],[25.01,100,1],[25,100,2],[0,100,3],[-1,100,3],[NaN,100,0],[1,0,0]]) {
      check(sceneDamageStage(hp,max) === stage, `threshold ${hp}/${max}`);
    }
    check(sceneDamageStage(1, 100, true) === 3, 'collapsed snapshot overrides rubble HP');
    check(!sceneDamageProfile('flood') && !sceneDamageProfile('relay'), 'invulnerable states omitted');
    const collapse = new Function('applySceneDamage', 'disposeTree', 'THREE', 'SCENE_STRUCT', 'sceneDamageBurst',
      `return function ${collapseSource}`)(applySceneDamage, disposeTree, THREE, SCENE_STRUCT, sceneDamageBurst);
    const make = (kind) => {
      const mesh = buildHazard(kind, 42, 8);
      const box = new THREE.Box3().setFromObject(mesh);
      return { id: 42, kind, mesh, dimR: Math.max(1, (box.max.x-box.min.x)/2, (box.max.z-box.min.z)/2),
        dimH: Math.max(1, box.max.y-box.min.y), dimTop: box.max.y, colR: 8, colH: 6 };
    };
    const signature = (ent) => {
      const arrays = [];
      ent.mesh.traverse((o) => { if (o.isMesh && o.geometry?.attributes.position) arrays.push(...o.geometry.attributes.position.array); });
      check(arrays.every(Number.isFinite), `${ent.kind}: finite geometry`);
      return JSON.stringify(arrays);
    };
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;background:#e7e1d5;font:16px sans-serif;color:#292b30';
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(280, 210);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const kinds = [...Object.keys(SCENE_STRUCT.TYPE), 'aasite'];
    for (const kind of kinds) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;padding:8px';
      document.body.append(row);
      const live = make(kind), initial = signature(live);
      applySceneDamage(live, 0);
      // A HUD added after spawn must not enter the deformation cache.
      const hud = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
      live.mesh.add(hud);
      const hudPositions = JSON.stringify([...hud.geometry.attributes.position.array]);
      applySceneDamage(live, 1);
      check(JSON.stringify([...hud.geometry.attributes.position.array]) === hudPositions, 'HUD stays pristine');
      live.mesh.remove(hud); disposeTree(hud);
      check(signature(live) !== initial, `${kind}: light damage changes silhouette`);
      applySceneDamage(live, 2);
      const heavy = signature(live), direct = make(kind);
      applySceneDamage(direct, 2);
      check(signature(direct) === heavy, `${kind}: direct and sequential stages agree`);
      applySceneDamage(live, 2);
      check(signature(live) === heavy, `${kind}: repeated snapshot is idempotent`);
      const bursts = [[], []], burstScene = new THREE.Scene();
      for (const effects of bursts) {
        sceneDamageBurst(burstScene, effects, live, 2);
        for (const effect of effects) effect.fade?.(effect.obj, 0.8, 0.1);
      }
      check(JSON.stringify(bursts[0][0].obj.children.map((o) => o.position.toArray())) ===
        JSON.stringify(bursts[1][0].obj.children.map((o) => o.position.toArray())), 'debris is deterministic');
      for (const effects of bursts) for (const effect of effects) {
        burstScene.remove(effect.obj); if (effect.dispose) effect.dispose(); else disposeTree(effect.obj);
      }
      applySceneDamage(live, 0);
      const restored = JSON.parse(signature(live)), original = JSON.parse(initial);
      check(restored.every((v,i) => Math.abs(v-original[i]) < 0.00001), `${kind}: repair restores shape`);
      disposeTree(live.mesh); disposeTree(direct.mesh);
      for (let stage = 0; stage <= 3; stage++) {
        const ent = make(kind);
        applySceneDamage(ent, stage);
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xe7e1d5);
        scene.add(ent.mesh, new THREE.HemisphereLight(0xffffff, 0x625d54, 0.8));
        const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(20,40,30); scene.add(sun);
        if (stage === 1 || stage === 2) {
          const fx = makeDamageFx({ r: ent.dimR, h: ent.dimH, top: ent.dimTop, fire: sceneDamageProfile(kind).fire, surfaceCracks: false });
          fx.userData.setStage(stage); fx.userData.update(0.016, 1);
          ent.mesh.add(fx);
        }
        if (stage === 3) {
          const ctx = { scene, effects: [], damaged: new Set() };
          collapse.call(ctx, ent, false);
          check(ctx.effects.length > 0, 'collapse animates');
          const count = ctx.effects.length;
          collapse.call(ctx, ent, false);
          check(ctx.effects.length === count, 'collapse deduplicates');
          for (const effect of ctx.effects) { effect.dispose?.(); scene.remove(effect.obj); if (!effect.dispose) disposeTree(effect.obj); }
          check(Math.abs(ent.mesh.scale.y - 0.35) < 1e-8, 'culled animation settles final pose');
          const restored = make(kind), quiet = { scene, effects: [], damaged: new Set() };
          collapse.call(quiet, restored, true);
          check(quiet.effects.length === 0 && restored.mesh.scale.y === ent.mesh.scale.y, 'restored rubble is instant and quiet');
          disposeTree(restored.mesh);
        }
        const camera = new THREE.PerspectiveCamera(35, 280/210, 0.1, 500);
        const extent = Math.max(ent.dimR * 2, ent.dimH);
        camera.position.set(extent*1.25, extent*0.95, extent*1.6);
        camera.lookAt(0, ent.dimH*0.35, 0);
        camera.updateMatrixWorld();
        updateCelLight(camera);
        renderer.render(scene, camera);
        const cell = document.createElement('div');
        cell.innerHTML = `<div>${kind} — ${[100,50,25,0][stage]}%</div>`;
        const img = document.createElement('img'); img.src = renderer.domElement.toDataURL(); cell.append(img); row.append(cell);
        disposeTree(ent.mesh);
      }
    }
    renderer.dispose();
    return { kinds: kinds.length, appearances: kinds.length * 4 };
  }, grabMethod(readSrc('public', 'js', 'game.js'), '_applyCollapse'));
  await mkdir('tools/.shots', { recursive: true });
  await page.screenshot({ path: 'tools/.shots/scene-damage.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  await server.close();
}
