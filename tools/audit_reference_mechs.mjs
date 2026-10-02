// Reference candidates: real registry, exact exports, reversible shield posture and GPU ownership.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { chromiumOrNull, chromePath } from './pw.mjs';
import { serve } from './mech_prompt_review.mjs';
import { charKind } from '../public/js/data.js';

const outputOption = process.argv.indexOf('--output');
const root = path.resolve(outputOption < 0 ? 'out/mech_reference' : process.argv[outputOption + 1]);
const contract = JSON.parse(await readFile('tools/mech_authoring/assets.json', 'utf8'));
const ids = Object.keys(contract.assets);
assert.equal(ids.length, 24, 'Scope must contain exactly twelve mechs and twelve drones');
assert.equal(ids.filter(id => charKind(id) === 'robot').length, 12, 'Incomplete mech scope');
assert.equal(ids.filter(id => charKind(id) === 'drone').length, 12, 'Incomplete drone scope');
assert(ids.every(id => charKind(id) !== 'morph'), 'Morphers must remain excluded');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identities = {};
const requiredCounts = {
  s02: ['Open industrial rotor duct', 6], s04: ['Upper and underside red roundel', 4],
  s05: ['Open rotor blade', 8], s08: ['Propeller motor hub', 2],
  m04: ['Exactly four feather missiles', 4], m06: ['Eight pentagonal launch backplates', 8],
};
const sourceHash = {
  contract: hash(await readFile('tools/mech_authoring/assets.json')),
  builder: hash(await readFile('tools/mech_authoring/build.py')),
  catalog: hash(await readFile('tools/mech_authoring/catalog.py')),
};
for (const id of ids) {
  const { default: asset } = await import(`../public/js/forge/assets/${id}.js`);
  for (const [key, expected] of Object.entries(sourceHash)) assert.equal(asset.source[key], expected, `${id}: stale ${key}`);
  const imageFile = path.resolve('tools/mech_authoring', contract.assets[id].inputs.image);
  assert.equal(asset.source.image, hash(await readFile(imageFile)), `${id}: stale reference image`);
  if (requiredCounts[id]) {
    const [prefix, count] = requiredCounts[id];
    assert.equal(asset.meshes.flatMap(mesh => mesh.parts).filter(name => name.startsWith(prefix)).length, count, `${id}: prompt-critical ${prefix} count`);
  }
  const bytes = await readFile(`public/assets/models/reference/${id}.glb`);
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const clips = gltf.animations?.map(clip => clip.name) || [];
  for (const clip of ['idle', 'run', 'light', 'heavy', 'skill', 'ult', 'shield_deploy', 'shield_retract']) {
    assert(clips.includes(clip), `${id}: missing exported ${clip}`);
  }
  identities[id] = { glb: hash(bytes), runtime: hash(await readFile(`public/js/forge/assets/${id}.js`)), clips };
}
const chromium = await chromiumOrNull();
assert(chromium, 'Reference validation requires an existing Playwright runtime');
await mkdir(root, { recursive: true });
const server = serve(0);
await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: chromePath(),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1640, height: 1060 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.goto(`${url}/?mech=${ids[0]}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__MECH_REVIEW?.preview?.unit);
  const metrics = await page.evaluate(async ({ ids, limits }) => {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const { makeUnit, heroTargetH } = await import('/public/js/models.js');
    const { charKind, CHARACTERS } = await import('/public/js/data.js');
    const { specOf, forgeMech } = await import('/public/js/forge/forge.js');
    const { stepCombatFx, stepLocomotion } = await import('/public/js/locomotion.js');
    const { stepReferenceMotion } = await import('/public/js/unitMotion.js');
    const { disposeTree } = await import('/public/js/toon.js');
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    const finite = (unit, label) => {
      unit.updateMatrixWorld(true);
      unit.traverse(node => check(node.matrixWorld.elements.every(Number.isFinite), `${label}: non-finite ${node.name}`));
    };
    const result = {};
    for (const id of ids) {
      const kind = charKind(id);
      const unit = makeUnit(`hero:${kind}`, CHARACTERS[id].side, { ring: false, ch: id }).group;
      const rig = unit.userData.rig;
      check(rig?.referenceMotion && rig.shield, `${id}: registry bypasses authored asset`);
      if (id === 't10') {
        check(rig.armR.position.x < 0 && rig.armL.position.x > 0, 't10: anatomical arms mirrored');
        check(rig.wpn.heavy.ref.position.x > 0, 't10: launcher must occupy anatomical left shoulder');
        check(rig.shield.arm.shoulder === rig.armL, 't10: shield attached to gun arm');
      }
      if (id === 't01') {
        check(unit.getObjectByName('gun').parent.name === 'wrist_l', 't01: light gun must occupy anatomical left');
        check(unit.getObjectByName('heavy').parent.name === 'wrist_r', 't01: axe cannon must occupy anatomical right');
      }
      if (['t07', 't08', 'm04'].includes(id)) {
        check(!unit.userData.spin.length && rig.wings.length === 2, `${id}: winged anatomy gained rotors`);
      }
      if (id === 's07') check(rig.tents.length === 4 && ['chFL', 'chFR', 'chHL', 'chHR'].every(key => rig[key].length === 4), 's07: eight distinct tentacle chains lost');
      if (rig.kind === 'quad') check(['legFL', 'legFR', 'legHL', 'legHR'].every(key => rig[key]?.isBone), `${id}: four load-bearing legs lost`);
      check(Math.abs(new THREE.Box3().setFromObject(unit).getSize(new THREE.Vector3()).y - heroTargetH(kind, id)) < .15, `${id}: authority height changed`);
      const ent = { id, mesh: unit, df: false, sp: 1, heroY: 0 };
      let now = 0;
      const step = (dt, speed = 0) => {
        now += dt;
        stepCombatFx(ent, now, dt);
        stepLocomotion(ent, dt, now, 0, -speed * dt, unit.rotation.y);
        finite(unit, id);
      };
      for (let i = 0; i < 100; i++) step(1 / 60, i < 50 ? 7 : 0);
      if (rig.chFL?.length === 3) {
        const distal = ['chFL', 'chFR', 'chHL', 'chHR'].map(key => ({ node: rig[key][2].g, min: Infinity, max: -Infinity }));
        for (let i = 0; i < 160; i++) {
          step(1 / 60, rig.top * .65);
          for (const joint of distal) {
            joint.min = Math.min(joint.min, joint.node.rotation.x);
            joint.max = Math.max(joint.max, joint.node.rotation.x);
          }
        }
        check(distal.every(j => j.max - j.min > .01), `${id}: distal metapodial joint remains rigid`);
        check(rig.chFL[0].k < 0 && rig.chHL[0].k > 0, `${id}: elbow and stifle bend identically`);
      }
      const recoil = rig.referenceMotion.fire[0];
      ent.fireFx = { t0: now, slot: 'light' };
      step(1 / 60, 5);
      check(recoil.node.position.z < recoil.rest, `${id}: no barrel recoil`);
      const localMuzzle = rig.muzzles.light.n.getWorldPosition(new THREE.Vector3());
      unit.position.x += 4;
      check(Math.abs(rig.muzzles.light.n.getWorldPosition(new THREE.Vector3()).x - localMuzzle.x - 4) < 1e-5, `${id}: detached muzzle`);
      unit.position.x = 0;
      ent.heavyFx = { t0: now, phase: 'charge' };
      for (let i = 0; i < 50; i++) step(1 / 60, 5);
      check(rig.referenceMotion.charge.some(track => Math.abs(track.node[track.channel][track.axis] - track.rest) > .1), `${id}: no charge mechanism`);
      ent.heavyFx = { t0: now, phase: 'fire' };
      ent.fireFx = { t0: now, slot: 'heavy' };
      step(1 / 60, 5);
      for (const slot of ['def', 'atk']) {
        ent.castFx = { t0: now, slot, dir: slot === 'atk' };
        for (let i = 0; i < 30; i++) step(1 / 60, 5);
        check(rig.referenceMotion.cast.some(track => Math.abs(track.node[track.channel][track.axis] - track.rest) > .01), `${id}: no ${slot} cast mechanism`);
      }
      ent.df = true;
      for (let i = 0; i < 90; i++) step(1 / 60, 5);
      check(rig.shield.phase === 1 && rig.shield.barrier.visible, `${id}: shield fails to deploy while moving`);
      const before = rig.shield.hinges[0].node.rotation[rig.shield.hinges[0].axis];
      ent.df = false;
      step(1 / 60, 5);
      check(Math.abs(before - rig.shield.hinges[0].node.rotation[rig.shield.hinges[0].axis]) < .1, `${id}: retract snaps`);
      for (let i = 0; i < 90; i++) step(1 / 60);
      check(rig.shield.phase === 0 && !rig.shield.barrier.visible, `${id}: shield fails to retract`);
      ent.df = true; ent.sp = 0;
      for (let i = 0; i < 60; i++) step(1 / 60);
      check(rig.shield.phase === 0, `${id}: depleted shield deploys`);
      ent.sp = 1; ent.dead = true;
      step(1 / 60);
      check(rig.shield.phase === 0, `${id}: dead shield deploys`);
      ent.dead = false;
      rig.shield.phase = 0;
      stepReferenceMotion(rig, ent, .2, now);
      const interrupted = rig.shield.phase;
      ent.df = false;
      stepReferenceMotion(rig, ent, .1, now);
      check(rig.shield.phase < interrupted && rig.shield.phase > 0, `${id}: interrupted retract snaps`);
      ent.df = true;
      stepReferenceMotion(rig, ent, .1, now);
      check(Math.abs(rig.shield.phase - interrupted) < 1e-8, `${id}: reversed deployment drifts`);
      const phases = [];
      for (const fps of [30, 60, 144]) {
        rig.shield.phase = 0;
        for (let i = 0; i < fps / 2; i++) stepReferenceMotion(rig, ent, 1 / fps, now);
        phases.push(rig.shield.phase);
      }
      check(Math.max(...phases) - Math.min(...phases) < 1e-8, `${id}: FPS-dependent shield`);
      const phase = rig.shield.phase;
      stepReferenceMotion(rig, ent, NaN, now);
      stepReferenceMotion(rig, ent, -1, now);
      check(rig.shield.phase === phase, `${id}: invalid time changes shield`);
      ent.df = false;
      for (let i = 0; i < 90; i++) step(1 / 60);
      let meshes = 0, triangles = 0;
      unit.traverse(node => {
        if (!node.isMesh || node.userData.isOutline) return;
        meshes++; triangles += (node.geometry.index?.count || node.geometry.attributes.position.count) / 3;
      });
      check(meshes <= limits.meshesPerUnit && triangles <= limits.trianglesPerUnit, `${id}: resource budget exceeded`);
      const copy = forgeMech(specOf(id));
      check(copy.group.getObjectByName('gun_recoil').geometry === undefined, `${id}: joint is fused to mesh`);
      const firstMesh = root => {
        let found;
        root.traverse(node => { if (!found && node.isMesh && !node.userData.isOutline) found = node; });
        return found;
      };
      const owned = firstMesh(unit.getObjectByName('gun_recoil'));
      const copied = firstMesh(copy.group.getObjectByName('gun_recoil'));
      check(owned.geometry !== copied.geometry && owned.material !== copied.material, `${id}: independent units share disposable GPU resources`);
      const loaded = await new GLTFLoader().loadAsync(`/public/assets/models/reference/${id}.glb`);
      check(loaded.animations.length >= 8 && loaded.scene.getObjectByName('barrier'), `${id}: independent GLB load loses rig/clips`);
      const mixer = new THREE.AnimationMixer(loaded.scene);
      for (const clip of loaded.animations) {
        mixer.stopAllAction();
        mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1).play();
        mixer.setTime(clip.duration * .5);
        finite(loaded.scene, `${id}/${clip.name}`);
        if (clip.name === 'shield_deploy') {
          check(loaded.scene.getObjectByName('barrier').scale.x > .1, `${id}: exported shield clip is frozen`);
        }
        if (id === 't10' && clip.name === 'light') {
          const gun = loaded.scene.getObjectByName('gun');
          const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(gun.getWorldQuaternion(new THREE.Quaternion()));
          check(Math.abs(direction.y) < .05 && direction.z > .95, 't10: exported fire pose loses gun-axis compensation');
        }
      }
      mixer.stopAllAction(); mixer.uncacheRoot(loaded.scene);
      finite(loaded.scene, `${id}/GLB`);
      disposeTree(loaded.scene); disposeTree(copy.group); disposeTree(unit);
      result[id] = { meshes, triangles, fps: [30, 60, 144], shieldPhases: phases, glbClips: loaded.animations.map(clip => clip.name) };
    }
    return result;
  }, { ids, limits: contract.limits });
  for (const id of (process.argv.includes('--no-capture') ? [] : ids)) {
    await page.evaluate(id => {
      window.__MECH_REVIEW.selectMech(id);
      const preview = window.__MECH_REVIEW.preview;
      preview.spinScale = 0; preview.yaw = .7; preview.pitch = .34;
    }, id);
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(root, `${id}-bench.png`) });
    await page.locator('#btnShieldDeploy').click();
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => window.__MECH_REVIEW.preview.unit.userData.rig.shield.phase), 1);
    await page.screenshot({ path: path.join(root, `${id}-shield.png`) });
    await page.locator('#btnRig').click();
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(root, `${id}-rig.png`) });
    await page.locator('#btnShieldRetract').click();
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => window.__MECH_REVIEW.preview.unit.userData.rig.shield.phase), 0);
    for (const button of ['#btnActionLight', '#btnActionAttack', '#btnActionSkill', '#btnActionUlt']) {
      await page.locator(button).click();
      await page.waitForTimeout(100);
    }
  }
  assert.deepEqual(errors, []);
  const report = { identities, metrics, gates: { runtime: 'pass', export: 'pass', motion: 'pass', controls: 'pass',
    visual: 'pending_image_inspection', user_signoff: 'pending_user_review' } };
  await writeFile(path.join(root, 'runtime-validation.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
