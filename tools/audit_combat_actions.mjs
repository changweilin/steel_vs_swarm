// Combat presentation: complete roster, joint attachments, shield clearance, transported shot ownership,
// independent GLB loading, finite event clocks and disposal. Existing project resource limits stay binding.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromiumOrNull, chromePath, writeReview as writeFile } from './pw.mjs';
import { serve } from './mech_prompt_review.mjs';
import { CHARACTERS, heroWeapon, fanArcHalf, fanSubs } from '../public/js/data.js';
import { COMBAT_ASSETS } from '../public/js/forge/combatAssets.js';
import { characterCombatStyle } from '../public/js/characterStyle.js';
import { readSrc, grabMethod } from './audit_src.mjs';
import { combatIntent } from './mech_authoring/combat_intent.mjs';

const output = 'out/combat_reference';
const ids = Object.keys(CHARACTERS), slots = ['light', 'heavy', 'def', 'atk'];
const contract = JSON.parse(await readFile('tools/mech_authoring/assets.json', 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const codeHash = sha(await readFile('tools/mech_authoring/combat.py'));
const builderHash = sha(await readFile('tools/mech_authoring/build.py'));
const intents = JSON.parse(JSON.stringify(combatIntent(await readFile('docs/art_gen.md', 'utf8'))));
const identities = {};
const integration = {};
for (const file of ['game.js', 'vfx.js', 'unitMotion.js', 'locomotion.js', 'charPreview.js', 'castfx.js',
  'characterStyle.js', 'models.js', 'forge/referenceAsset.js', 'forge/combatAsset.js', 'forge/combatCast.js', 'forge/combatKeys.js', 'castparticles.js']) {
  integration[file] = sha(await readFile(`public/js/${file}`));
}
assert.deepEqual(Object.keys(COMBAT_ASSETS).sort(), ids.slice().sort(), 'Incomplete combat roster');
assert.equal(new Set(ids.map(id => characterCombatStyle(id).shieldForm)).size, ids.length, 'Repeated shield identity');
for (const id of ids) {
  const asset = COMBAT_ASSETS[id], style = characterCombatStyle(id);
  assert.equal(asset.source.combat, codeHash, `${id}: stale combat recipe`);
  assert.equal(asset.source.builder, builderHash, `${id}: stale builder`);
  assert.deepEqual(asset.combat.intent, intents[id], `${id}: stale art or authority measures`);
  for (const key of ['color', 'accent', 'frame', 'shieldForm', 'variant']) assert.equal(asset.combat.intent[key], style[key], `${id}: stale ${key}`);
  assert.deepEqual(Object.keys(asset.combat.clips), slots);
  for (const clip of Object.values(asset.combat.clips)) {
    assert(clip.duration > 0 && Number.isFinite(clip.duration));
    for (const track of clip.tracks) {
      assert(track.keys.length >= 2 && track.keys.flat().every(Number.isFinite));
      assert(track.keys.every(([time], i) => i === 0 || time > track.keys[i - 1][0]), `${id}: unordered samples`);
    }
  }
  for (const slot of ['light', 'heavy']) {
    const def = heroWeapon(id, slot);
    if (!def.fan) continue;
    const ownership = asset.combat.fans[slot], half = fanArcHalf(def), span = half * 2 / fanSubs(def);
    assert.equal(ownership.count, fanSubs(def), `${id}/${slot}: wrong sub-cone count`);
    for (const part of asset.meshes.filter(mesh => mesh.parent === `fx_${slot}_ion`)) {
      const owners = ownership.vertexBins[part.material];
      assert.equal(owners.length, part.positions.length / 3, `${id}/${slot}: lost sub-cone ownership`);
      for (let i = 0; i < part.indices.length; i += 3) {
        const bin = owners[part.indices[i]];
        assert(Number.isInteger(bin) && bin >= 0 && bin < ownership.count, `${id}/${slot}: invalid sub-cone`);
        assert(part.indices.slice(i, i + 3).every(vertex => owners[vertex] === bin), `${id}/${slot}: triangle bridges sub-cones`);
      }
      for (let i = 0; i < owners.length; i++) {
        const [x, , z] = part.positions.slice(i * 3, i * 3 + 3);
        const lo = -half + owners[i] * span, hi = lo + span;
        // Float32 evaluation and five-decimal export can move shared edges; runtime projects them back into their owned bins.
        assert(x * Math.cos(lo) - z * Math.sin(lo) >= -.0002 &&
          x * Math.cos(hi) - z * Math.sin(hi) <= .0002, `${id}/${slot}: exported geometry crosses its sub-cone`);
      }
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
    const { CHARACTERS, heroWeapon, heroAbility, fanArcHalf, fanSubs, fanBinOf, fanBinRangeF } = await import('/public/js/data.js');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const { stepCombatFx, stepLocomotion } = await import('/public/js/locomotion.js');
    const { stepAuthoredCombat } = await import('/public/js/forge/combatAsset.js');
    const { disposeTree } = await import('/public/js/toon.js');
    const { projectileMesh, stepProjectileFx, makeShieldMaterial, SHIELD_PRESENTATION_EXPAND, gundamBeam, ionBreath, fanDischarge } = await import('/public/js/vfx.js');
    const { spawnCastFx } = await import('/public/js/castfx.js');
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
    const fieldSheets = Array.from({ length: 4 }, () => {
      const canvas = document.createElement('canvas'); canvas.width = 1800; canvas.height = 8 * 264;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#111c29'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      return { canvas, ctx };
    });
    const fanSlots = ids.flatMap(id => ['light', 'heavy'].filter(slot => heroWeapon(id, slot).fan));
    const fanSheet = document.createElement('canvas');
    fanSheet.width = 1200; fanSheet.height = Math.ceil(fanSlots.length / 3) * 344;
    const fanContext = fanSheet.getContext('2d');
    fanContext.fillStyle = '#111c29'; fanContext.fillRect(0, 0, fanSheet.width, fanSheet.height);
    const measures = {}, patterns = new Set(), fanBounds = [];
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
        if (def.fan) {
          const from = new T.Vector3(1, 2, 3), direction = new T.Vector3(.2, .3, 1).normalize();
          const inverse = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), direction).invert();
          const half = fanArcHalf(def), count = fanSubs(def), span = half * 2 / count;
          let maximumBinOvershootRadians = 0;
          for (const range of [def.range, def.range * 1.3]) for (const blocked of [false, true]) {
            const effects = [], limit = range * .45;
            const clip = (a, b) => ({ to: b.distanceTo(a) > limit ? a.clone().add(b.clone().sub(a).setLength(limit)) : b });
            check(fanDischarge(scene, effects, from, direction, def, { range, clip: blocked ? clip : undefined }), `${id}: authored fan omitted`);
            const fan = effects[0].obj;
            for (const fraction of [1, .5, 0]) {
              effects[0].fade(fan, fraction); fan.updateWorldMatrix(true, true);
              fan.traverse(mesh => {
                if (!mesh.isMesh) return;
                const positions = mesh.geometry.attributes.position, vertex = new T.Vector3();
                const owners = mesh.geometry.userData.fanBins, indices = mesh.geometry.index;
                check(owners?.length === positions.count, `${id}/${slot}: runtime lost sub-cone ownership`);
                for (let i = 0; i < indices.count; i += 3) {
                  const bin = owners[indices.getX(i)];
                  check(owners[indices.getX(i + 1)] === bin && owners[indices.getX(i + 2)] === bin,
                    `${id}/${slot}: runtime triangle bridges sub-cones`);
                }
                for (let i = 0; i < positions.count; i++) {
                  vertex.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).sub(from).applyQuaternion(inverse);
                  const distance = vertex.length();
                  if (distance < .001) continue;
                  const phi = Math.atan2(vertex.x, vertex.z), owner = owners[i];
                  const lo = -half + owner * span, hi = lo + span;
                  maximumBinOvershootRadians = Math.max(maximumBinOvershootRadians, lo - phi, phi - hi);
                  // These convex half-spaces constrain whole triangles, including their interiors.
                  const tolerance = distance * .000001;
                  check(vertex.x * Math.cos(lo) - vertex.z * Math.sin(lo) >= -tolerance &&
                    vertex.x * Math.cos(hi) - vertex.z * Math.sin(hi) <= tolerance,
                    `${id}/${slot}: sub-cone ${owner} overlaps its neighbour`);
                  const angle = Math.acos(Math.min(1, vertex.z / distance));
                  const bin = fanBinOf(def, phi);
                  check(angle <= fanArcHalf(def) + .0005, `${id}/${slot}: fan widens beyond damage cone (${angle}, ${vertex.toArray()}, f=${fraction}, blocked=${blocked})`);
                  check(distance <= range * fanBinRangeF(def, bin) + .005, `${id}: fan exceeds per-bin spherical reach`);
                  if (blocked) check(distance <= limit + .001, `${id}: fan penetrates obstacle`);
                }
              });
            }
            scene.remove(fan); disposeTree(fan);
          }
          fanBounds.push({ id, slot, subCones: count, testCases: 12, maximumBinOvershootRadians });
          const effects = [];
          fanDischarge(scene, effects, new T.Vector3(), new T.Vector3(0, 0, 1), def);
          const fan = effects[0].obj, box = new T.Box3().setFromObject(fan), center = box.getCenter(new T.Vector3());
          const radius = box.getSize(new T.Vector3()).length() * .5;
          camera.up.set(0, 0, -1);
          camera.position.copy(center).add(new T.Vector3(0, 1, .12).normalize().multiplyScalar(radius * 3.2));
          camera.lookAt(center); renderer.setSize(400, 320); renderer.render(scene, camera);
          const panel = fanBounds.length - 1, x = panel % 3 * 400, y = Math.floor(panel / 3) * 344;
          fanContext.drawImage(renderer.domElement, x, y);
          fanContext.fillStyle = '#d9ecff'; fanContext.font = '15px monospace';
          fanContext.fillText(`${id} ${slot}: ${count} bins, ${def.range}m + center reach`, x + 8, y + 337);
          camera.up.set(0, 1, 0);
          renderer.setSize(300, 240); scene.remove(fan); disposeTree(fan);
        } else if (def.type === 'beam' || def.type === 'plasma') {
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
      for (const slot of ['def', 'atk']) for (const radius of [.5, 7, 220, heroAbility(id, slot).r || 4]) {
        const effects = [], at = new T.Vector3(4, 0, 3), a = heroAbility(id, slot);
        spawnCastFx(scene, effects, { ch: id, slot, fx: a.fx, at, r: radius, dur: a.dur, scale: 20 });
        const field = effects.find(effect => effect.obj.userData.authoredCast);
        check(field?.obj.userData.authoredCast.radius === radius, `${id}/${slot}: field ignores event radius`);
        for (const fraction of [1, .92, .7, .4, 0]) {
          field.fade(field.obj, fraction); field.obj.updateWorldMatrix(true, true);
          field.obj.traverse(mesh => {
            if (!mesh.isMesh) return;
            const positions = mesh.geometry.attributes.position, vertex = new T.Vector3();
            for (let i = 0; i < positions.count; i++) {
              vertex.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
              check(vertex.distanceTo(at) <= radius * 1.0001, `${id}/${slot}: animated field exceeds settled radius`);
            }
          });
          const beat = [.92, .7, .4].indexOf(fraction);
          if (radius === (a.r || 4) && beat >= 0) {
            camera.far = Math.max(1000, radius * 5); camera.updateProjectionMatrix();
            camera.position.copy(at).add(new T.Vector3(.65, .5, 1).normalize().multiplyScalar(radius * 3.2));
            camera.lookAt(at); renderer.render(scene, camera);
            const sheet = fieldSheets[Math.floor(index / 8)], row = index % 8, col = (slot === 'def' ? 0 : 3) + beat;
            sheet.ctx.drawImage(renderer.domElement, col * 300, row * 264);
            sheet.ctx.fillStyle = '#d9ecff'; sheet.ctx.font = '15px monospace';
            sheet.ctx.fillText(`${id} ${slot} ${['tell', 'release', 'contact'][beat]} r=${radius}m`, col * 300 + 8, row * 264 + 257);
          }
        }
        for (const effect of effects) { scene.remove(effect.obj); effect.dispose ? effect.dispose() : disposeTree(effect.obj); }
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
    return { measures, fanBounds, uniquePatterns: patterns.size, peakCalls,
      fanSheet: fanSheet.toDataURL('image/png'),
      sheets: sheets.map(sheet => sheet.canvas.toDataURL('image/png')),
      fieldSheets: fieldSheets.map(sheet => sheet.canvas.toDataURL('image/png')) };
  }, { ids, slots, limits: contract.limits, shieldFactory });
  assert.deepEqual(errors, [], 'Browser or shader errors');
  for (let i = 0; i < result.sheets.length; i++) await writeFile(`${output}/actions-${i + 1}.png`, Buffer.from(result.sheets[i].split(',')[1], 'base64'));
  for (let i = 0; i < result.fieldSheets.length; i++) await writeFile(`${output}/fields-${i + 1}.png`, Buffer.from(result.fieldSheets[i].split(',')[1], 'base64'));
  await writeFile(`${output}/fans.png`, Buffer.from(result.fanSheet.split(',')[1], 'base64'));
  delete result.fanSheet;
  delete result.sheets;
  delete result.fieldSheets;
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
