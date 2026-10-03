// Exact authored bytes through the shipped registry, morph solver and defense presentation.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { chromiumOrNull, chromePath, captureReview, writeReview as writeFile } from './pw.mjs';
import { serve } from './mech_prompt_review.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const contract = JSON.parse(await readFile('tools/mech_authoring/morphers.json', 'utf8'));
const shared = JSON.parse(await readFile('tools/mech_authoring/assets.json', 'utf8'));
const outputRoot = path.resolve('out/morph_reference');
const selected = process.argv.indexOf('--asset');
const ids = selected < 0 ? Object.keys(contract.assets) : process.argv[selected + 1].split(',');
const results = {};
for (const id of ids) {
assert(contract.assets[id], `Unknown morpher: ${id}`);
const spec = contract.assets[id];
const output = path.join(outputRoot, id);
const { default: asset } = await import(`../public/js/forge/assets/${id}.js`);
const owners = { contract: 'morphers.json', builder: 'build.py', catalog: 'morph_recipe.py',
  sharedContract: 'assets.json', sharedCatalog: 'catalog.py' };
for (const [key, file] of Object.entries(owners)) {
  assert.equal(asset.source[key], sha(await readFile(`tools/mech_authoring/${file}`)), `Stale ${key}`);
}
assert.equal(asset.source.image, sha(await readFile(path.resolve('tools/mech_authoring', spec.inputs.image))));
const { default: ground } = await import(`../public/js/forge/mechs/${id}.js`);
const { default: flight } = await import(`../public/js/forge/mechs/${id}_flight.js`);
assert.equal(ground.asset, flight.asset, 'Forms must consume the same geometry owner');
assert.equal(ground.height, flight.height);
const glb = await readFile(`public/assets/models/reference/${id}.glb`);
const gltf = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
assert(spec.acceptance.requiredClips.every(name => gltf.animations.some(clip => clip.name === name)));
const chromium = await chromiumOrNull();
assert(chromium, 'An existing Playwright runtime is required');
await mkdir(output, { recursive: true });
const server = serve(0);
await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: chromePath(),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1640, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.goto(`${url}/?mech=${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__MECH_REVIEW?.preview?.unit?.userData.morph);
  await page.evaluate(() => {
    const preview = window.__MECH_REVIEW.preview;
    preview.spinScale = 0; preview.yaw = .7; preview.pitch = .28;
  });
  const measurements = await page.evaluate(async ({ limits, id, spec }) => {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const { forgeMorphUnit, specOf } = await import('/public/js/forge/forge.js');
    const { makeUnit, heroTargetH } = await import('/public/js/models.js');
    const { stepLocomotion, stepCombatFx } = await import('/public/js/locomotion.js');
    const { stepReferenceMotion, stepUnitSpinners } = await import('/public/js/unitMotion.js');
    const { disposeTree } = await import('/public/js/toon.js');
    const { lerpFPS } = await import('/public/js/data.js');
    const check = (ok, why) => { if (!ok) throw new Error(why); };
    const model = forgeMorphUnit(specOf(`${id}@ground`), specOf(`${id}@flight`));
    const unit = model.group, morph = unit.userData.morph;
    check(morph.plan.n.gOnly === 0 && morph.plan.n.aOnly === 0 && morph.plan.n.soft === 0, 'Unpaired or replaced components');
    check(!morph.plan.g.fade.length && !morph.plan.a.fade.length, 'Parts must not disappear during transformation');
    const inventory = root => {
      const entries = [];
      root.traverse(n => { if (n.isMesh && !n.userData.isOutline && !n.userData.presentationEffect) entries.push(n); });
      return entries;
    };
    const gm = inventory(morph.gg), am = inventory(morph.ag);
    check(gm.length === am.length, 'Different part inventory');
    let triangles = 0, effectTriangles = 0, effectMeshes = 0;
    morph.ag.traverse(n => { if (n.isMesh && n.userData.presentationEffect) {
      effectMeshes++; effectTriangles += n.geometry.index.count / 3;
    } });
    for (let i = 0; i < gm.length; i++) {
      check(gm[i].name === am[i].name && JSON.stringify(gm[i].geometry.attributes.position.array)
        === JSON.stringify(am[i].geometry.attributes.position.array), 'Geometry changed between forms');
      check(gm[i].geometry !== am[i].geometry && gm[i].material !== am[i].material, 'Disposable resources shared between trees');
      triangles += gm[i].geometry.index.count / 3;
    }
    check(triangles + effectTriangles <= limits.trianglesPerUnit && gm.length + effectMeshes <= limits.meshesPerUnit, 'Visible form exceeds resource contract');
    const parts = gm.flatMap(mesh => mesh.userData.authoredParts);
    const count = prefix => parts.filter(name => name.startsWith(prefix)).length;
    check(count('Rigid closing belly hatch') === 0, 'Detached ventral planes returned');
    if (id === 's10' || id === 'm08') {
      check(count('Fanned primary feather') === spec.parameters.featherCount * 2
        && count('Overlapping secondary feather') === 16 && count('Layered shoulder covert') === 10,
        'Incomplete humeral/secondary/primary feather inventory');
      check(count('Continuous primary feather root web') === 0
        && count('Scapular wing root board') === 0, 'Obsolete interior feather wing boards retained');
      for (const side of ['l', 'r']) {
        const manus = morph.ag.getObjectByName('outer_' + side), ulna = morph.ag.getObjectByName('ulna_' + side);
        check(manus.parent === ulna && ulna.parent === morph.ag.getObjectByName('flap_' + side),
          'Bird wing must have humerus, ulna and manus');
        const key = side === 'l' ? 'FL' : 'FR';
        check(spec.acceptance.foreclawsCarryWeapons
          ? morph.ag.getObjectByName('leg_' + key).parent.name === 'chest'
          : morph.ag.getObjectByName('leg_' + key).parent.parent === ulna.parent,
          'Flying forelimb lost its authored anatomical attachment');
      }
      const chest = morph.gg.getObjectByName('chest');
      morph.gg.updateMatrixWorld(true);
      for (const side of ['l', 'r']) {
        const wing = morph.gg.getObjectByName('wing_' + side);
        wing.traverse(node => {
          if (!node.isMesh) return;
          if (!node.userData.authoredParts?.some(part => /^(Fanned primary feather|Overlapping secondary feather|Layered shoulder covert)/.test(part))) return;
          let owner = node.parent;
          while (owner && owner !== wing && !owner.name.startsWith('leg_')) owner = owner.parent;
          if (owner?.name.startsWith('leg_')) return;
          const positions = node.geometry.attributes.position;
          for (let i = 0; i < positions.count; i++) {
            const point = chest.worldToLocal(node.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, i)));
            check(Math.abs(point.x) < 1, 'Folded wing protrudes across the back');
            check(Math.abs(point.y - .32) < .24, 'Folded wing hangs below the back');
          }
        });
      }
    }
    if (id === 'm01') {
      check(count('Right gatling open barrel') === 6 && count('Left twin missile launch cell') === 2, 'Vampire weapon inventory');
      check(morph.gg.getObjectByName('gun').parent.name === 'wrist_r'
        && morph.gg.getObjectByName('heavy').parent.name === 'wrist_l', 'Anatomical weapon sides changed');
    }
    if (id === 'm07') check(count('Shared heavy protective elytron') === 2
      && count('Transparent insect propulsion membrane') === 4 && count('Twin 35mm anti-aircraft open barrel') === 2
      && morph.air.wings.length === 2, 'Beetle must have one articulated hindwing pair beneath paired elytra');
    if (id === 'm08') check(count('Symmetric shoulder anti-materiel sniper receiver') === 2, 'Symmetric sniper pair');
    if (id === 'm05') check(count('Right triple electromagnetic barrel') === 3
      && count('Shared flying squirrel patagium cell') >= 20 && count('Folded patagium fist blade') === 2
      && morph.ground.tailSegs.length === 5
      && ['l', 'r'].every(side => morph.gg.getObjectByName('wing_' + side).parent.name === 'elbow_' + side),
      'Wolf must retain elbow-folded patagium, paired fist blades and a balanced tail');
    if (id === 't11') check(morph.gg.getObjectByName('gun').parent.name === 'wing_r'
      && morph.gg.getObjectByName('heavy').parent.name === 'wing_l', 'Weapons must stay on shoulder trays');
    if (id === 't11') {
      check(count('Solid retractable rotor shield petal') === 48, 'Solid twin shield covers lost');
      for (const tree of [morph.gg, morph.ag]) {
        tree.updateMatrixWorld(true);
        for (const side of ['l', 'r']) {
          const hinge = tree.getObjectByName('rotor_hinge_' + side);
          const covers = [];
          hinge.traverse(n => { if (n.isMesh && n.userData.authoredParts?.some(p => p.startsWith('Solid retractable rotor shield petal'))) covers.push(n); });
          for (const radius of [.1, .45, .8]) for (let i = 0; i < 16; i++) {
            const angle = (i + .5) * Math.PI / 8;
            const from = hinge.localToWorld(new THREE.Vector3(radius * Math.cos(angle), radius * Math.sin(angle), 2));
            const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(hinge.getWorldQuaternion(new THREE.Quaternion()));
            const hits = new THREE.Raycaster(from, direction).intersectObjects(covers, false);
            check(tree === morph.gg ? hits.length > 0 : radius > .1 || hits.length === 0, 'Rotor shield does not close/open');
          }
          if (tree === morph.ag) {
            const heights = covers.flatMap(mesh => {
              const p = mesh.geometry.attributes.position, values = [];
              for (let i = 0; i < p.count; i++) values.push(hinge.worldToLocal(mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(p, i))).z);
              return values;
            });
            check(Math.max(...heights) - Math.min(...heights) < .041, 'Flying rotor shield petals are not coplanar');
            const wing = tree.getObjectByName('wing_' + side);
            for (const name of ['shoulder_', 'elbow_', 'wrist_']) {
              const point = wing.worldToLocal(tree.getObjectByName(name + side).getWorldPosition(new THREE.Vector3()));
              check(Math.abs(point.y - .06) < .001
                && Math.abs(point.z - (.75 - Math.abs(point.x) * 2.03 / 3.45)) < .001, 'Atlas arm separates from leading slat');
            }
          }
        }
      }
    }
    const ent = { id, mesh: unit, heroY: 0, df: false, sp: 1 };
    let now = 0, maxSeamError = 0;
    const finite = () => {
      unit.updateMatrixWorld(true);
      unit.traverse(n => check(n.matrixWorld.elements.every(Number.isFinite), `Nonfinite ${n.name}`));
    };
    const step = (dt = 1 / 60, speed = 0) => {
      now += dt;
      stepUnitSpinners(unit.userData.spin || [], dt);
      stepCombatFx(ent, now, dt);
      stepLocomotion(ent, dt, now, 0, -speed * dt, unit.rotation.y);
      finite();
    };
    const sample = (t, defending = false) => {
      ent.df = defending;
      ent.heroY = t >= .5 ? 5 : 0;
      const k = lerpFPS(2.6, 1 / 60), want = t >= .5 ? 1 : 0;
      morph.m = (t - want * k) / (1 - k);
      step();
      for (let i = 0; i < morph.plan.g.pairs.length; i++) {
        const g = morph.plan.g.pairs[i].n, a = morph.plan.a.pairs[i].n;
        const delta = Math.max(...g.matrixWorld.elements.map((v, j) => Math.abs(v - a.matrixWorld.elements[j])));
        maxSeamError = Math.max(maxSeamError, delta);
        check(delta < 1e-5, `Rig-swap seam: ${id}/${g.name} ${delta}; t=${t}, shield=${defending}, aim=${unit.userData.rig._fireAim}`);
        check(g.scale.toArray().every(v => Math.abs(v - 1) < 1e-7), `Rigid part scale changed: ${g.name}`);
      }
    };
    const samples = [.05, .25, .49, .5, .51, .75, .95];
    for (const t of [...samples, ...samples.toReversed()]) sample(t);
    ent.df = true;
    for (let i = 0; i < 50; i++) step();
    for (const t of [...samples, ...samples.toReversed()]) sample(t, true);
    ent.df = false;
    ent.fireFx = { t0: now, slot: 'heavy' };
    for (let i = 0; i < 30; i++) step();
    for (const t of [...samples, ...samples.toReversed()]) sample(t);
    ent.fireFx = null;
    for (let i = 0; i < 120; i++) step();
    check(morph.ground.shield.phase === morph.air.shield.phase, 'Shield clock restarted at swap');
    const formResults = [];
    for (const flight of [false, true]) {
      ent.heroY = flight ? 5 : 0; morph.m = flight ? 1 : 0;
      ent.df = false;
      for (let i = 0; i < 90; i++) step(1 / 60, 6);
      const rig = unit.userData.rig;
      if (!flight && spec.parameters.legAnatomy) {
        const chains = spec.kind === 'quad' ? ['chFL', 'chFR', 'chHL', 'chHR'] : ['legChainL', 'legChainR'];
        const distal = chains.map(key => {
          check(rig[key].length === 3, 'Missing articulated metacarpal/metatarsal link');
          return { node: rig[key][2].g, min: Infinity, max: -Infinity };
        });
        for (let i = 0; i < 160; i++) {
          step(1 / 60, rig.top * .65);
          for (const joint of distal) {
            joint.min = Math.min(joint.min, joint.node.rotation.x);
            joint.max = Math.max(joint.max, joint.node.rotation.x);
          }
        }
        check(distal.every(j => j.max - j.min > 1e-4), 'Distal animal joint is locked to its parent');
      }
      if (!flight && rig.insectLegs) {
        check(rig.insectLegs.length === 6, 'Incomplete insect leg inventory');
        for (let i = 0; i < 80; i++) {
          step(1 / 60, rig.top * .65);
          const legs = Object.fromEntries(rig.insectLegs.map(leg => [leg.key, leg]));
          check(Math.abs(legs.FL.root.rotation.y - legs.HL.root.rotation.y) < 1e-6
            && Math.abs(legs.ML.root.rotation.y + legs.FR.root.rotation.y) < 1e-6, 'Broken alternating tripod phase');
          check(rig.insectLegs.every(leg => Math.abs(leg.root.rotation.x) < 1e-6
            && leg.chain.every(j => j.axis === 'z')), 'Sprawled insect leg uses mammal flexion axes');
        }
      }
      if (!flight && id === 's10') check(rig.tailSegs.every(n => Math.abs(n.rotation.x) < .04), 'Raptor counterbalance tail droops');
      if (!flight && id === 'm05') check(morph.gg.getObjectByName('hunch').rotation.x > .3, 'Wolf attack stance lost during locomotion');
      check(rig.kind === (flight ? 'aerial' : spec.kind), 'Wrong locomotion rig');
      if (id === 's10') {
        const active = flight ? morph.ag : morph.gg;
        for (const [slot,key] of [['light','FR'],['heavy','FL']]) {
          check(rig.wpn[slot].ref.parent === active.getObjectByName('toe_' + key), 'Raptor weapon must remain hand held');
          const arm = active.getObjectByName('leg_' + key);
          check(arm.parent.name === 'chest', 'Raptor grasping arm moved away from the chest');
        }
      }
      if (flight && id === 't11') {
        check(unit.userData.spin.length === 2, 'Twin tilt rotors lost');
        const node = unit.userData.spin[0], before = node.rotation.z;
        step(); check(Math.abs(node.rotation.z - before) > .1, 'Tilt rotor does not rotate');
      }
      if (flight && id === 't06') {
        check(rig.jets.length === 2 && rig.jets.every(j => j.g.visible), 'Jet propulsion/cloud lost');
        const jet = rig.jets[0], before = jet.g.scale.y;
        for (let i = 0; i < 20; i++) step(1 / 60, 15);
        check(Math.abs(jet.g.scale.y - before) > .05, 'Jet length does not respond to movement');
      }
      ent.fireFx = { t0: now, slot: 'light' }; step(1 / 60, 6);
      check(rig.referenceMotion.fire[0].node.position.z < 0, 'No moving-fire recoil');
      for (const slot of ['light', 'heavy']) {
        ent.heavyFx = null;
        ent.fireFx = { t0: now, slot };
        for (let i = 0; i < 45; i++) step();
        const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(rig.wpn[slot].ref.getWorldQuaternion(new THREE.Quaternion()));
        check(direction.z > .9999, `Firing axis ${slot}/${flight}: ${direction.toArray()}`);
      }
      ent.heavyFx = { t0: now, phase: 'charge' };
      for (let i = 0; i < 35; i++) step(1 / 60, 6);
      check(rig.referenceMotion.charge.some(t => Math.abs(t.node[t.channel][t.axis] - t.rest) > .1), 'No charge action');
      for (const slot of ['def', 'atk']) {
        ent.castFx = { t0: now, slot, dir: slot === 'atk' };
        for (let i = 0; i < 20; i++) step(1 / 60, 6);
        check(rig.referenceMotion.cast.some(t => Math.abs(t.node[t.channel][t.axis] - t.rest) > .01), 'No cast action');
      }
      ent.df = true;
      for (let i = 0; i < 90; i++) step(1 / 60, 6);
      check(rig.shield.phase === 1 && rig.shield.barrier.visible, 'No shield deployment');
      ent.df = false; step();
      check(rig.shield.phase > 0 && rig.shield.phase < 1, 'Shield retraction snaps');
      for (let i = 0; i < 90; i++) step();
      check(rig.shield.phase === 0 && !rig.shield.barrier.visible, 'No shield retraction');
      const phases = [];
      for (const fps of [30, 60, 144]) {
        rig.shield.phase = 0; ent.df = true;
        for (let i = 0; i < fps / 2; i++) stepReferenceMotion(rig, ent, 1 / fps, now);
        phases.push(rig.shield.phase);
      }
      check(Math.max(...phases) - Math.min(...phases) < 1e-8, 'Shield depends on frame rate');
      const before = rig.shield.phase;
      for (const dt of [NaN, -1, Infinity]) stepReferenceMotion(rig, ent, dt, now);
      check(rig.shield.phase === before, 'Invalid clock changes shield');
      ent.sp = 0; for (let i = 0; i < 90; i++) step();
      check(rig.shield.phase === 0, 'Depleted shield deploys');
      ent.sp = 1; ent.dead = true; for (let i = 0; i < 90; i++) step();
      check(rig.shield.phase === 0, 'Dead shield deploys');
      ent.dead = false; ent.df = false;
      formResults.push({ form: flight ? 'flight' : 'ground', shieldPhases: phases });
    }
    const shipped = makeUnit('hero:morph', 'STEEL', { ch: id, ring: false }).group;
    check(shipped.userData.morph?.ground.referenceMotion, 'Shipped registry bypasses authored sample');
    const visible = shipped.userData.morph.gg;
    check(Math.abs(new THREE.Box3().setFromObject(visible).getSize(new THREE.Vector3()).y - heroTargetH('morph', id)) < .15, 'Gameplay height changed');
    const loaded = await new GLTFLoader().loadAsync(`/public/assets/models/reference/${id}.glb`);
    const mixer = new THREE.AnimationMixer(loaded.scene);
    for (const clip of loaded.animations) {
      mixer.stopAllAction();
      const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true; action.play(); mixer.setTime(clip.duration * .5);
      loaded.scene.updateMatrixWorld(true);
      loaded.scene.traverse(n => check(n.matrixWorld.elements.every(Number.isFinite), `Export clip ${clip.name}`));
      if (clip.name.endsWith('shield_deploy')) check(loaded.scene.getObjectByName('barrier').scale.x > .1, 'Frozen exported shield');
      if (clip.name === 'to_flight') {
        mixer.setTime(clip.duration);
        for (const [name, pose] of Object.entries(spec.forms.flight.transforms)) {
          const node = loaded.scene.getObjectByName(name);
          if (pose.position) check(node.position.distanceTo(new THREE.Vector3(...pose.position)) < .001, `Frozen exported stowage: ${name}`);
        }
      }
    }
    const clips = loaded.animations.map(clip => clip.name);
    disposeTree(loaded.scene); disposeTree(shipped); disposeTree(unit);
    return { trianglesPerVisibleForm: triangles, effectTriangles, effectMeshes, retainedTriangles: triangles * 2 + effectTriangles, meshesPerVisibleForm: gm.length,
      pairs: morph.plan.n, maxSeamError, samples, forms: formResults, clips };
  }, { limits: shared.limits, id, spec });
  await captureReview(page, path.join(output, 'ground-bench.png'));
  await page.locator('#btnShieldDeploy').click();
  await page.waitForFunction(() => window.__MECH_REVIEW.preview.unit.userData.rig.shield.phase === 1);
  await captureReview(page, path.join(output, 'ground-shield.png'));
  await page.locator('#btnMorphToggle').click();
  await page.waitForFunction(() => window.__MECH_REVIEW.preview.morphM > .9995);
  await captureReview(page, path.join(output, 'flight-shield.png'));
  await page.locator('#btnShieldRetract').click();
  await page.waitForFunction(() => window.__MECH_REVIEW.preview.unit.userData.rig.shield.phase === 0);
  await captureReview(page, path.join(output, 'flight-bench.png'));
  await page.locator('#btnRig').click();
  await captureReview(page, path.join(output, 'flight-rig.png'));
  assert.deepEqual(errors, []);
  const report = { source: asset.source, hashes: { runtime: sha(await readFile(`public/js/forge/assets/${id}.js`)), glb: sha(glb) },
    measurements, gates: { structure: 'pass', same_parts: 'pass', same_geometry: 'pass', same_scale: 'pass',
      morph_continuity: 'pass', locomotion_combat_shield: 'pass', export_load: 'pass', registry: 'pass', controls: 'pass',
      appearance: 'pending_visual_review', flight_belly: 'pending_visual_review', user_signoff: 'pending_user_review' } };
  await writeFile(path.join(output, 'runtime-validation.json'), JSON.stringify(report, null, 2) + '\n');
  const buildFile = path.join(output, 'validation.json');
  const build = JSON.parse(await readFile(buildFile, 'utf8'));
  const source = JSON.parse(await readFile(path.join(output, 'source-validation.json'), 'utf8'));
  assert.equal(build.hashes.glb, report.hashes.glb);
  assert.equal(build.hashes.runtime, report.hashes.runtime);
  assert.equal(build.hashes.blend, source.blend);
  assert.equal(source.flight_belly, spec.acceptance.flightBellyClosed ? 'pass' : 'exposed_patagium_struts');
  build.gates.export = 'pass';
  build.gates.destination = 'pass';
  build.gates.flight_belly = source.flight_belly;
  build.validation_refs = { runtime: 'runtime-validation.json', source: 'source-validation.json',
    rebuild: '../rebuild-validation.json' };
  await writeFile(buildFile, JSON.stringify(build, null, 2) + '\n');
  results[id] = report;
  console.log(`${id}: ${measurements.trianglesPerVisibleForm} triangles, ${measurements.meshesPerVisibleForm} meshes, ${measurements.clips.length} clips, seam ${measurements.maxSeamError}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
}
if (selected >= 0) for (const id of Object.keys(contract.assets)) {
  if (results[id]) continue;
  const file = path.join(outputRoot, id, 'runtime-validation.json');
  const prior = JSON.parse(await readFile(file, 'utf8'));
  if (prior.hashes.runtime === sha(await readFile(`public/js/forge/assets/${id}.js`))
    && prior.hashes.glb === sha(await readFile(`public/assets/models/reference/${id}.glb`))) results[id] = prior;
}
await writeFile(path.join(outputRoot, 'runtime-validation.json'), JSON.stringify(results, null, 2) + '\n');
