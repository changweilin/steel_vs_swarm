// Exact authored exports: provenance, rigid animation, runtime bindings, recoil and GPU teardown.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { readSrc } from './audit_src.mjs';
import { chromiumOrNull, chromePath } from './pw.mjs';
import { serve } from './mech_prompt_review.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const contract = JSON.parse(readSrc('tools', 'mech_authoring', 'factions.json'));
const shared = JSON.parse(readSrc('tools', 'mech_authoring', contract.inherit));
const ids = Object.keys(contract.assets), identities = {};
// Export identities hash raw bytes; readSrc owns all parsed source text and normalizes CRLF.
const sourceFiles = { contract: 'tools/mech_authoring/factions.json', builder: 'tools/mech_authoring/build.py',
  catalog: 'tools/mech_authoring/faction_recipe.py', design: 'docs/faction-authoring.md', palette: 'public/js/factionModelStyle.js' };
const sources = Object.fromEntries(await Promise.all(Object.entries(sourceFiles)
  .map(async ([key, file]) => [key, hash(await readFile(file))])));
const runtimeFiles = ['public/js/forge/referenceAsset.js', 'public/js/forge/factionAsset.js',
  'public/js/forge/factionAssets.js', 'public/js/npcModels.js', 'public/js/buildingUnitModels.js',
  'public/js/unitRig.js', 'public/js/unitMotion.js', 'tools/mech_authoring/faction_review.js', 'tools/mech_authoring/faction_review.html'];
const runtimeSources = Object.fromEntries(await Promise.all(runtimeFiles.map(async file => [file, hash(await readFile(file))])));
for (const id of ids) {
  const { default: asset } = await import(`../public/js/forge/factionAssets/${id}.js`);
  for (const [key, value] of Object.entries(sources)) assert.equal(asset.source[key], value, `${id}: stale ${key}`);
  const bytes = await readFile(`public/assets/models/factions/${id}.glb`);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, `${id}: invalid GLB header`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${id}: truncated GLB`);
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const clips = gltf.animations.map(clip => clip.name);
  for (const clip of ['idle', 'run', 'aim', 'light', 'heavy', 'deploy']) assert(clips.includes(clip), `${id}: missing ${clip}`);
  const report = JSON.parse(await readFile(`out/faction_reference/${id}/validation.json`, 'utf8'));
  assert.equal(hash(bytes), report.hashes.glb, `${id}: stale GLB evidence`);
  assert.equal(hash(await readFile(`public/js/forge/factionAssets/${id}.js`)), report.hashes.runtime, `${id}: stale runtime evidence`);
  assert.equal(hash(await readFile(`out/faction_reference/${id}/${id}.blend`)), report.hashes.blend, `${id}: stale Blender evidence`);
  identities[id] = { ...report.hashes, clips };
}
const chromium = await chromiumOrNull();
assert(chromium, 'Authored faction validation requires the existing Playwright runtime');
const server = serve(0, { threeModule: process.env.THREE_MODULE || path.resolve('out/forest_review/three.module.js') });
await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: chromePath(),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/Shader Error|ERROR: 0:/.test(message.text())) errors.push(message.text()); });
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  const localThree = process.env.THREE_MODULE || path.resolve('out/forest_review/three.module.js');
  await page.route('**/three@0.160.0/build/three.module.js', async route => route.fulfill({
    contentType: 'text/javascript', body: await readFile(localThree, 'utf8') }));
  await page.route('**/three@0.160.0/examples/jsm/**', async route => route.fulfill({
    contentType: 'text/javascript', body: await readFile(path.join(path.dirname(localThree),
      route.request().url().split('/examples/jsm/')[1].replaceAll('/', '_')), 'utf8') }));
  await page.route('**/main.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto(`${url}/public/index.html`, { waitUntil: 'domcontentloaded' });
  const metrics = await page.evaluate(async ({ ids, limits }) => {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const { makeUnit, measureBox } = await import('/public/js/models.js');
    const { buildFactionAsset } = await import('/public/js/forge/factionAsset.js');
    const { FACTION_ASSETS } = await import('/public/js/forge/factionAssets.js');
    const { buildBaseBattery } = await import('/public/js/buildingUnitModels.js');
    const { CHARACTERS, charKind } = await import('/public/js/data.js');
    const { stepCombatFx, stepLocomotion } = await import('/public/js/locomotion.js');
    const { fireUnitMotion, stepUnitMotion, stepVehicleMotion, stepUnitSpinners } = await import('/public/js/unitMotion.js');
    const { applySceneDamage, releaseMobileDamage } = await import('/public/js/sceneDamage.js');
    const { disposeTree } = await import('/public/js/toon.js');
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    const near = (a, b) => Math.abs(a - b) < 1e-7;
    const finite = (root, label) => {
      root.updateMatrixWorld(true);
      root.traverse(node => check(node.matrixWorld.elements.every(Number.isFinite), `${label}: invalid transform`));
    };
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(500, 400);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1.25, .01, 1000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x526070, 2));
    const result = [];
    for (const id of ids) {
      const [prefix, role] = id.split('_'), side = prefix.toUpperCase();
      const independent = await new GLTFLoader().loadAsync(`/public/assets/models/factions/${id}.glb`);
      check(independent.animations.length === 6, `${id}: GLB clips lost`);
      const mixer = new THREE.AnimationMixer(independent.scene);
      for (const clip of independent.animations) {
        check(clip.tracks.length > 0 && clip.tracks.every(track => [...track.values].every(Number.isFinite)), `${id}: invalid animation tracks`);
        mixer.stopAllAction(); mixer.clipAction(clip).play(); mixer.setTime(.2); finite(independent.scene, id);
      }
      mixer.stopAllAction(); mixer.uncacheRoot(independent.scene); disposeTree(independent.scene);
      const kind = ['turret', 'battery'].includes(role) ? null : role === 'base' ? `base:${side}`
        : ['tower', 'bunker'].includes(role) ? role : `creep:${role}`;
      const root = kind ? makeUnit(kind, side, { ring: false }).group : buildFactionAsset(role, side);
      const rig = root.userData.rig;
      check(rig, `${id}: registry lost rig`);
      check(root.getObjectByName(FACTION_ASSETS[id].joints[0][0]), `${id}: old builder still active`);
      if (role === 'base') {
        const battery = buildBaseBattery(side, measureBox(root).max.y); root.add(battery); rig.attacks = battery.userData.attacks;
      }
      const ent = { id: 19, mesh: root, kind: role, dimH: measureBox(root).getSize(new THREE.Vector3()).y };
      for (const fps of [30, 60, 144]) {
        for (let frame = 0; frame < fps; frame++) {
          const px = root.position.x, pz = root.position.z;
          if (!['static'].includes(rig.kind)) root.position.z += 4 / fps;
          ent.fireFx = { t0: 0, slot: 'light' };
          stepCombatFx(ent, frame / fps, 1 / fps); stepUnitSpinners(root.userData.spin, 1 / fps);
          stepLocomotion(ent, 1 / fps, frame / fps, px, pz, root.rotation.y); finite(root, `${id}/${fps}`);
        }
      }
      for (const attack of rig.attacks) {
        stepUnitMotion(rig, 10);
        const muzzle = attack.muzzles[0], rest = muzzle.getWorldPosition(new THREE.Vector3());
        fireUnitMotion(rig, muzzle, 10); stepUnitMotion(rig, 10.035);
        check(near(attack.node.position.z, -attack.travel), `${id}: no recoil`);
        check(muzzle.getWorldPosition(new THREE.Vector3()).distanceTo(rest) > .01, `${id}: detached muzzle`);
        for (const other of rig.attacks) if (other !== attack) check(other.node.position.z === 0, `${id}: wrong barrel recoils`);
        stepUnitMotion(rig, 11);
        check(attack.node.position.z === 0 && attack.node.rotation.x === 0, `${id}: recovery drifts`);
        check(muzzle.getWorldPosition(new THREE.Vector3()).distanceTo(rest) < 1e-7, `${id}: muzzle recovery drifts`);
        attack.firedAt = -Infinity;
      }
      if (rig.wheels) {
        check(rig.suspension.length === rig.wheels.length, `${id}: suspension lost`);
        stepVehicleMotion(rig, {}, .1, 2, 4, 4, .2);
        check(rig.wheels.some(wheel => wheel.m.rotation.x !== 0), `${id}: no wheel drive`);
        if (rig.kind === 'tracked') check(rig.tracks.length === 2, `${id}: missing tracks`);
      }
      if (kind?.startsWith('creep:')) {
        const vertices = [];
        root.traverse(node => { if (node.isMesh) vertices.push([node.geometry, [...node.geometry.attributes.position.array]]); });
        applySceneDamage(ent, 2); applySceneDamage(ent, 0); releaseMobileDamage(ent);
        for (const [geometry, positions] of vertices) check(positions.every((v, i) => v === geometry.attributes.position.array[i]), `${id}: damage mutated articulated mesh`);
      }
      let meshes = 0, triangles = 0;
      root.traverse(node => {
        if (!node.isMesh || node.userData.isOutline || node.userData.presentationEffect) return;
        meshes++; triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3 * (node.isInstancedMesh ? node.count : 1);
      });
      check(meshes <= 160 && triangles <= 60000, `${id}: destination budget exceeded`);
      check(FACTION_ASSETS[id].meshes.length <= limits.meshesPerUnit, `${id}: authored mesh budget exceeded`);
      const bounds = measureBox(root), center = bounds.getCenter(new THREE.Vector3());
      const distance = bounds.getSize(new THREE.Vector3()).length() * 1.6;
      camera.position.copy(center).add(new THREE.Vector3(distance * .6, distance * .3, distance)); camera.lookAt(center);
      scene.add(root); renderer.render(scene, camera); scene.remove(root); disposeTree(root);
      result.push({ id, meshes, triangles, joints: FACTION_ASSETS[id].joints.length });
    }
    const counts = [];
    for (const kind of ['drone', 'robot', 'morph']) {
      const id = Object.keys(CHARACTERS).find(id => charKind(id) === kind);
      const root = makeUnit(`hero:${kind}`, CHARACTERS[id].side, { ring: false, ch: id }).group;
      check(root.userData.rig.shield, `${id}: shared loader lost hero shield`);
      const ent = { id: 1, mesh: root, df: 1, sp: 100 };
      for (let i = 0; i < 30; i++) {
        stepCombatFx(ent, i / 60, 1 / 60); stepLocomotion(ent, 1 / 60, i / 60, 0, 0, 0); finite(root, id);
      }
      disposeTree(root);
    }
    for (let i = 0; i < 6; i++) {
      const root = makeUnit('creep:soldier', 'SWARM', { ring: false }).group;
      scene.add(root); renderer.render(scene, camera); scene.remove(root); disposeTree(root); renderer.render(scene, camera);
      counts.push(renderer.info.memory.geometries);
    }
    check(counts.slice(1).every(count => count === counts[0]), 'Repeated teardown leaks geometry');
    renderer.dispose();
    return result;
  }, { ids, limits: shared.limits });
  await page.route('**/faction-studio', route => route.fulfill({ contentType: 'text/html',
    body: readSrc('tools', 'mech_authoring', 'faction_review.html') }));
  await page.route('**/faction_review.js', route => route.fulfill({ contentType: 'text/javascript',
    body: readSrc('tools', 'mech_authoring', 'faction_review.js') }));
  await page.goto(`${url}/faction-studio`);
  await page.waitForFunction(() => window.__factionReview);
  await page.evaluate(() => window.__factionReview.setPaused(true));
  const roles = await page.evaluate(() => window.__factionReview.roles);
  for (const role of roles) {
    for (const motion of ['idle', 'run', 'aim', 'fire']) {
      await page.evaluate(({ role, motion }) => {
        const review = window.__factionReview; review.select(role, motion);
        for (let i = 0; i < 45; i++) review.tick(1 / 60);
        for (const stage of review.stages) stage.root.traverse(node => {
          if (!node.matrixWorld.elements.every(Number.isFinite)) throw new Error(`${role}/${motion}: invalid preview pose`);
        });
      }, { role, motion });
      if (['run', 'fire'].includes(motion)) await page.locator('main').screenshot({ path: `out/faction_reference/live-${role}-${motion}.png` });
    }
    for (const view of ['front', 'back', 'night', 'silhouette']) {
      await page.evaluate(({ role, view }) => { window.__factionReview.select(role, 'idle', view); window.__factionReview.tick(); }, { role, view });
      await page.locator('main').screenshot({ path: `out/faction_reference/live-${role}-${view}.png` });
    }
  }
  await page.evaluate(() => { window.__factionReview.select('soldier'); window.__factionReview.tick(); });
  await page.screenshot({ path: 'out/faction_reference/live-studio.png', fullPage: true });
  assert.deepEqual(errors, []);
  await mkdir('out/faction_reference', { recursive: true });
  await writeFile('out/faction_reference/runtime-validation.json', JSON.stringify({ sources, runtimeSources, identities, metrics,
    gates: { provenance: 'pass', export: 'pass', runtime: 'pass', deformation: 'pass', teardown: 'pass',
      visual: 'pending_image_inspection', user_signoff: contract.review.signoff } }, null, 2));
  console.log('Authored factions passed:', JSON.stringify(metrics));
} finally {
  await browser?.close(); server.close();
}
