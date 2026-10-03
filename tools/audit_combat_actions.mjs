// Combat presentation: complete roster, joint attachments, shield clearance, transported shot ownership,
// independent GLB loading, finite event clocks and disposal. Existing project resource limits stay binding.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromiumOrNull, chromePath, writeReview as writeFile } from './pw.mjs';
import { serve } from './mech_prompt_review.mjs';
import { CHARACTERS } from '../public/js/data.js';
import { COMBAT_ASSETS } from '../public/js/forge/combatAssets.js';
import { characterCombatStyle } from '../public/js/characterStyle.js';
import { readSrc, grabMethod } from './audit_src.mjs';

const output = 'out/combat_reference';
const ids = Object.keys(CHARACTERS), slots = ['light', 'heavy', 'def', 'atk'];
const contract = JSON.parse(await readFile('tools/mech_authoring/assets.json', 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const codeHash = sha(await readFile('tools/mech_authoring/combat.py'));
const builderHash = sha(await readFile('tools/mech_authoring/build.py'));
const identities = {};
const integration = {};
for (const file of ['game.js', 'vfx.js', 'unitMotion.js', 'locomotion.js', 'charPreview.js', 'castfx.js',
  'characterStyle.js', 'models.js', 'forge/referenceAsset.js', 'forge/combatAsset.js']) {
  integration[file] = sha(await readFile(`public/js/${file}`));
}
assert.deepEqual(Object.keys(COMBAT_ASSETS).sort(), ids.slice().sort(), 'Incomplete combat roster');
assert.equal(new Set(ids.map(id => characterCombatStyle(id).shieldForm)).size, ids.length, 'Repeated shield identity');
for (const id of ids) {
  const asset = COMBAT_ASSETS[id], style = characterCombatStyle(id);
  assert.equal(asset.source.combat, codeHash, `${id}: stale combat recipe`);
  assert.equal(asset.source.builder, builderHash, `${id}: stale builder`);
  for (const key of ['color', 'accent', 'frame', 'shieldForm', 'variant']) assert.equal(asset.combat.intent[key], style[key], `${id}: stale ${key}`);
  assert.deepEqual(Object.keys(asset.combat.clips), slots);
  for (const clip of Object.values(asset.combat.clips)) {
    assert(clip.duration > 0 && Number.isFinite(clip.duration));
    for (const track of clip.tracks) {
      assert(track.keys.length >= 2 && track.keys.flat().every(Number.isFinite));
      assert(track.keys.every(([time], i) => i === 0 || time > track.keys[i - 1][0]), `${id}: unordered samples`);
    }
  }
  const bytes = await readFile(`public/assets/models/combat/${id}.glb`);
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  for (const slot of slots) assert(gltf.animations.some(clip => clip.name === slot), `${id}: absent GLB ${slot}`);
  for (const [joint] of asset.joints) assert(gltf.nodes.some(node => node.name === joint), `${id}: absent GLB ${joint}`);
  const triangles = gltf.meshes.reduce((n, mesh) => n + mesh.primitives.reduce((sum, primitive) => sum + gltf.accessors[primitive.indices].count / 3, 0), 0);
  assert(triangles <= contract.limits.trianglesPerUnit, `${id}: GLB triangle budget ${triangles}`);
  assert(gltf.meshes.length <= contract.limits.meshesPerUnit, `${id}: GLB mesh budget`);
  identities[id] = { runtime: sha(await readFile(`public/js/forge/combatAssets/${id}.js`)), glb: sha(bytes), triangles, meshes: gltf.meshes.length };
}

const chromium = await chromiumOrNull();
assert(chromium, 'Combat verification requires the installed Playwright runtime');
await mkdir(output, { recursive: true });
const server = serve(0);
await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.goto(`http://127.0.0.1:${server.address().port}/?mech=t10`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__MECH_REVIEW?.preview?.unit);
  const shieldFactory = grabMethod(readSrc('public', 'js', 'game.js'), '_createFrontShieldMesh');
  const result = await page.evaluate(async ({ ids, slots, limits, shieldFactory }) => {
    const T = await import('three');
    const { forgeMech, forgeMorphUnit, specOf } = await import('/public/js/forge/forge.js');
    const { CHARACTERS, heroWeapon } = await import('/public/js/data.js');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const { stepCombatFx, stepLocomotion } = await import('/public/js/locomotion.js');
    const { stepAuthoredCombat } = await import('/public/js/forge/combatAsset.js');
    const { disposeTree } = await import('/public/js/toon.js');
    const { projectileMesh, stepProjectileFx, makeShieldMaterial, SHIELD_PRESENTATION_EXPAND, gundamBeam, ionBreath } = await import('/public/js/vfx.js');
    const { characterShieldTexture } = await import('/public/js/castfx.js');
    const { characterCombatStyle } = await import('/public/js/characterStyle.js');
    const createShield = new Function('THREE', 'makeShieldMaterial', 'characterCombatStyle', 'characterShieldTexture',
      `return ({${shieldFactory}})._createFrontShieldMesh`)(T, makeShieldMaterial, characterCombatStyle, characterShieldTexture);
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    const scene = new T.Scene(); scene.background = new T.Color(0x111c29);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(300, 240);
    scene.add(new T.HemisphereLight(0xffffff, 0x385577, 2.4));
    const key = new T.DirectionalLight(0xffffff, 3); key.position.set(8, 12, 10); scene.add(key);
    const camera = new T.PerspectiveCamera(42, 300 / 240, .05, 1000);
    const sheets = Array.from({ length: 4 }, () => {
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 8 * 264;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#111c29'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      return { canvas, ctx };
    });
    const measures = {}, patterns = new Set();
    let peakCalls = 0;
    const finite = unit => unit.traverse(node => check([...node.position, ...node.scale, ...node.quaternion].every(Number.isFinite), `${unit.name}: nonfinite transform`));
    const bodyBox = (unit, rig) => {
      unit.updateWorldMatrix(true, true);
      const box = new T.Box3(), inverse = unit.matrixWorld.clone().invert();
      unit.traverse(node => {
        if (!node.isMesh || node.userData.presentationEffect || node.userData.isOutline || node.userData.teamRing || node.parent?.name === 'barrier') return;
        let owner = node; while (owner) { if (!owner.visible) return; owner = owner.parent; }
        node.geometry.computeBoundingBox();
        box.union(node.geometry.boundingBox.clone().applyMatrix4(inverse.clone().multiply(node.matrixWorld)));
      });
      const guard = rig.combat.guard;
      const center = guard.getWorldPosition(new T.Vector3()).applyMatrix4(inverse);
      check(center.z > box.max.z + .01, `${unit.name}: shield intersects body (${center.z} <= ${box.max.z})`);
      return box;
    };
    for (let index = 0; index < ids.length; index++) {
      const id = ids[index];
      const fpsShield = createShield.call({ ch: id }), style = characterCombatStyle(id);
      const uniforms = fpsShield.userData.mat.uniforms;
      check(uniforms.uColor.value.getHex() === style.color && uniforms.uAccent.value.getHex() === style.accent, `${id}: first-person palette mismatch`);
      check(uniforms.uPattern.value === characterShieldTexture(id) && uniforms.uHasPattern.value === 1, `${id}: first-person pattern missing`);
      fpsShield.rotation.y = Math.PI;
      fpsShield.updateWorldMatrix(true, true);
      check(fpsShield.children[0].getWorldPosition(new T.Vector3()).z < 0, `${id}: first-person shield is behind camera`);
      disposeTree(fpsShield);
      const pattern = characterShieldTexture(id).image;
      const pixels = pattern.getContext('2d').getImageData(0, 0, pattern.width, pattern.height).data;
      let signature = 2166136261; for (const value of pixels) signature = Math.imul(signature ^ value, 16777619);
      patterns.add(signature >>> 0);
      const forms = CHARACTERS[id].kind === 'morph' ? ['ground', 'flight'] : ['ground'];
      const measurements = [];
      for (const form of forms) {
        const key = CHARACTERS[id].kind === 'morph' ? `${id}@${form}` : id;
        const built = forgeMech(specOf(key)), unit = built.group, rig = built.rig;
        scene.add(unit);
        const ent = { id, mesh: unit, hero: true, sp: 1, df: true, heroY: form === 'flight' ? 12 : 0 };
        let now = 0;
        const step = (dt, speed = 0) => {
          const before = unit.position.clone(); unit.position.z += dt * speed; now += dt;
          stepCombatFx(ent, now, dt); stepLocomotion(ent, dt, now, before.x, before.z, 0);
          finite(unit);
        };
        for (const fps of [30, 60, 144]) for (let i = 0; i < fps; i++) { step(1 / fps, 4); bodyBox(unit, rig); }
        check(rig.combat.guard.visible, `${id}/${form}: missing defense shield`);
        ent.df = 2; step(1 / 60);
        check(Math.abs(rig.combat.guard.scale.x / rig.combat.guard.scale.y - SHIELD_PRESENTATION_EXPAND) < 1e-8, `${id}: shield expansion omitted`);
        ent.df = false;
        for (let i = 0; i < 60; i++) step(1 / 60);
        for (const slot of slots) {
          ent.fireFx = null; ent.castFx = null; ent.heavyFx = null;
          const event = { slot, t0: now };
          if (slot === 'light' || slot === 'heavy') ent.fireFx = event;
          else ent.castFx = event;
          const duration = rig.combat.clips[slot].duration;
          for (let i = 0; i < 12; i++) step(duration / 30);
          check(rig.combat.joints.some(([name]) => name !== 'fx_guard' && rig.combat.nodes.get(name).visible), `${id}/${slot}: no attached effects`);
          if (slot === 'def') { check(rig.combat.guard.visible, `${id}: defense cast has no shield`); bodyBox(unit, rig); }
          for (const name of rig.combat.transported) check(!rig.combat.nodes.get(name).visible, `${id}: duplicate transported projectile`);
          if (form === 'ground') {
            unit.updateWorldMatrix(true, true);
            const box = new T.Box3().setFromObject(unit), center = box.getCenter(new T.Vector3()), radius = box.getSize(new T.Vector3()).length() * .5;
            camera.position.copy(center).add(new T.Vector3(.65, .32, 1).normalize().multiplyScalar(Math.max(4, radius * 2.9)));
            camera.lookAt(center); renderer.render(scene, camera); peakCalls = Math.max(peakCalls, renderer.info.render.calls);
            const sheet = sheets[Math.floor(index / 8)], row = index % 8, col = slots.indexOf(slot);
            sheet.ctx.drawImage(renderer.domElement, col * 300, row * 264);
            sheet.ctx.fillStyle = '#d9ecff'; sheet.ctx.font = '15px monospace'; sheet.ctx.fillText(`${id}  ${slot}  ${rig.combat.intent.shieldForm}`, col * 300 + 8, row * 264 + 257);
          }
          for (let i = 0; i < 45; i++) step(duration / 30);
        }
        const baseline = rig.combat.guard.position.clone();
        stepAuthoredCombat(rig, ent, NaN); check(rig.combat.guard.position.equals(baseline), 'Invalid clock changed shield');
        ent.dead = true; step(1 / 60);
        check(!rig.combat.guard.visible, `${id}: dead shield persists`);
        check(rig.combat.joints.every(([name]) => !rig.combat.nodes.get(name).visible), `${id}: dead effects persist`);
        let meshes = 0, triangles = 0;
        unit.traverse(node => { if (node.isMesh && !node.userData.isOutline) { meshes++; triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3; } });
        check(meshes <= limits.meshesPerUnit && triangles <= limits.trianglesPerUnit, `${id}: runtime budget ${meshes}/${triangles}`);
        measurements.push({ form, meshes, triangles });
        scene.remove(unit); disposeTree(unit);
      }
      for (const slot of ['light', 'heavy']) {
        const def = heroWeapon(id, slot);
        if (def.type === 'beam' || def.type === 'plasma') {
          const effects = [], from = new T.Vector3(1, 2, 3), to = new T.Vector3(8, 7, 17);
          const emit = def.type === 'beam' ? gundamBeam : ionBreath;
          emit(scene, effects, from, to, style.color, { r: .8, ttl: .5, def });
          const energy = effects.find(effect => effect.obj.userData.authoredDischarge);
          check(energy?.obj.userData.authoredDischarge.ch === id, `${id}: energy discharge omitted Blender geometry`);
          energy.obj.updateWorldMatrix(true, true);
          const direction = to.clone().sub(from).normalize(), length = from.distanceTo(to), vertex = new T.Vector3();
          energy.obj.traverse(mesh => {
            if (!mesh.isMesh) return;
            const positions = mesh.geometry.attributes.position;
            for (let i = 0; i < positions.count; i++) {
              vertex.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).sub(from);
              const distance = vertex.dot(direction);
              check(distance >= -1e-5 && distance <= length + 1e-5, `${id}: discharge escapes clipped endpoints`);
              check(vertex.addScaledVector(direction, -distance).length() <= .80001, `${id}: discharge inflates radius`);
            }
          });
          for (const effect of effects) {
            for (const f of [1, .5, 0]) { effect.fade?.(effect.obj, f, .1); finite(effect.obj); }
            scene.remove(effect.obj); effect.dispose ? effect.dispose() : disposeTree(effect.obj);
          }
        } else {
          const shot = projectileMesh(def, { heavy: slot === 'heavy' });
          check(shot.userData.authoredProjectile?.ch === id, `${id}: shipped shot omitted Blender projectile`);
          for (const time of [0, .1, .5, 1]) { stepProjectileFx(shot, time, 300); finite(shot); }
          disposeTree(shot);
        }
      }
      if (CHARACTERS[id].kind === 'morph') {
        const unit = forgeMorphUnit(specOf(`${id}@ground`), specOf(`${id}@flight`)).group;
        const morph = unit.userData.morph, ent = { mesh: unit, hero: true, df: 2, sp: 1 };
        let now = 0;
        for (const height of [0, 12, 0]) for (let frame = 0; frame < 90; frame++) {
          const dt = 1 / 60; now += dt;
          ent.heroY = height;
          if (frame === 30) ent.castFx = { slot: 'atk', t0: now };
          stepCombatFx(ent, now, dt); stepLocomotion(ent, dt, now, 0, 0, 0);
          finite(unit);
          for (const [root, rig] of [[morph.gg, morph.ground], [morph.ag, morph.air]]) {
            bodyBox(root, rig);
            check(Math.abs(rig.combat.guard.scale.x / rig.combat.guard.scale.y - SHIELD_PRESENTATION_EXPAND) < 1e-8, `${id}: expansion changes during morph`);
          }
        }
        disposeTree(unit);
      }
      const loaded = await new GLTFLoader().loadAsync(`/public/assets/models/combat/${id}.glb`);
      const mixer = new T.AnimationMixer(loaded.scene);
      for (const slot of slots) { const action = mixer.clipAction(loaded.animations.find(clip => clip.name === slot)); action.play(); mixer.update(.3); finite(loaded.scene); action.stop(); }
      mixer.uncacheRoot(loaded.scene); disposeTree(loaded.scene);
      measures[id] = measurements;
    }
    check(patterns.size === ids.length, 'Shield textures are repeated');
    for (let i = 0; i < 4; i++) renderer.render(scene, camera);
    const resident = renderer.info.memory.geometries;
    for (let i = 0; i < 8; i++) { const unit = forgeMech(specOf('t10')).group; scene.add(unit); renderer.render(scene, camera); scene.remove(unit); disposeTree(unit); }
    renderer.render(scene, camera);
    check(renderer.info.memory.geometries === resident, 'Combat geometry leaked on repeated teardown');
    renderer.dispose();
    return { measures, uniquePatterns: patterns.size, peakCalls, sheets: sheets.map(sheet => sheet.canvas.toDataURL('image/png')) };
  }, { ids, slots, limits: contract.limits, shieldFactory });
  assert.deepEqual(errors, [], 'Browser or shader errors');
  for (let i = 0; i < result.sheets.length; i++) await writeFile(`${output}/actions-${i + 1}.png`, Buffer.from(result.sheets[i].split(',')[1], 'base64'));
  delete result.sheets;
  await writeFile(`${output}/runtime-validation.json`, JSON.stringify({ identities, integration, ...result, browserErrors: errors }, null, 2));
  for (const id of ids) {
    const path = `${output}/${id}/validation.json`, report = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(report.hashes.runtime, identities[id].runtime, `${id}: runtime review hash drift`);
    assert.equal(report.hashes.glb, identities[id].glb, `${id}: GLB review hash drift`);
    report.gates.export = 'pass'; report.gates.destination = 'pass'; report.gates.motion = 'pass';
    report.reviewEvidence = { runtime: '../runtime-validation.json', source: '../source-validation.json',
      attachments: `../actions-${Math.floor(ids.indexOf(id) / 8) + 1}.png` };
    await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(`Combat presentation verified: ${ids.length} mechs, ${result.uniquePatterns} shield textures, four actions, both morph forms, independent GLBs and teardown`);
} finally { await browser.close(); server.close(); }
