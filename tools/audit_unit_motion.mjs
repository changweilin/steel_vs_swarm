// Production rigs: finite gait, isolated barrel selection, exact rest recovery,
// frame-rate-independent recoil, muzzle inheritance and building aim integration.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromiumOrNull, chromePath, serve, skipNoPlaywright } from './pw.mjs';
import { readSrc, grabMethod } from './audit_src.mjs';

const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('單位骨架運動瀏覽器量測');
const server = await serve();
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: chromePath(),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (process.env.THREE_MODULE) {
    const body = await readFile(process.env.THREE_MODULE, 'utf8');
    await page.route('**/three@0.160.0/build/three.module.js', r => r.fulfill({ contentType: 'text/javascript', body }));
    await page.route('**/three@0.160.0/examples/jsm/**', async r => {
      const name = r.request().url().split('/examples/jsm/')[1].replaceAll('/', '_');
      const body = await readFile(path.join(path.dirname(process.env.THREE_MODULE), name), 'utf8');
      await r.fulfill({ contentType: 'text/javascript', body });
    });
  }
  await page.route('**/main.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  const game = readSrc('public', 'js', 'game.js');
  const result = await page.evaluate(async methods => {
    const THREE = await import('three');
    const { makeUnit } = await import('/public/js/models.js');
    const { buildNpcModel, NPC_MODEL_KINDS } = await import('/public/js/npcModels.js');
    const { SUMMON_BUILDERS } = await import('/public/js/summonModels.js');
    const { buildBaseBattery } = await import('/public/js/buildingUnitModels.js');
    const { CIVILIANS, TARGET_H, UNITS, lerpFPS } = await import('/public/js/data.js');
    const { stepCombatFx, stepLocomotion } = await import('/public/js/locomotion.js');
    const { fireUnitMotion, stepUnitMotion, stepUnitSpinners, stepVehicleMotion } = await import('/public/js/unitMotion.js');
    const { disposeTree, setCelSun, updateCelLight } = await import('/public/js/toon.js');
    const check = (v, m) => { if (!v) throw Error(m); };
    const near = (a, b) => Math.abs(a - b) < 1e-8;
    const finite = (mesh, label) => {
      mesh.updateMatrixWorld(true);
      mesh.traverse(n => check(n.matrixWorld.elements.every(Number.isFinite), `${label}: non-finite ${n.name}`));
    };
    let models = 0, shots = 0;
    const cases = [];
    for (const side of ['SWARM', 'STEEL', 'GUER', 'MILI']) {
      for (const kind of NPC_MODEL_KINDS) cases.push({ kind, side });
    }
    for (const kind of Object.keys(SUMMON_BUILDERS)) cases.push({ kind, side: 'STEEL' });
    for (const side of ['SWARM', 'STEEL']) cases.push({ kind: 'tower', side }, { kind: `base:${side}`, side });
    for (const row of cases) {
      const mesh = makeUnit(row.kind, row.side, { ring: false }).group;
      const rig = mesh.userData.rig;
      check(rig, `${row.kind}: missing rig`);
      if (row.kind === 'tower') {
        const box = new THREE.Box3().setFromObject(mesh);
        check(Math.abs(box.max.y - box.min.y - TARGET_H.tower) < 0.5, 'tower height no longer fitted');
        const turret = mesh.userData.turret;
        const muzzle = mesh.userData.turretMuzzles[0].getWorldPosition(new THREE.Vector3());
        check(muzzle.y > turret.getWorldPosition(new THREE.Vector3()).y, 'tower head buried');
      }
      if (row.kind.startsWith('base:')) {
        const battery = buildBaseBattery(row.side);
        mesh.add(battery);
        rig.attacks = battery.userData.attacks;
      }
      if (rig.kind === 'biped') {
        check(rig.head, `${row.kind}: missing articulated head`);
        check(rig.legChainL?.length === 2 && rig.legChainR?.length === 2, `${row.kind}: knees/ankles`);
        check(rig.armChainL?.length && rig.armChainR?.length, `${row.kind}: elbows`);
      }
      if (rig.wheels?.length) {
        check(rig.suspension?.length === rig.wheels.length, `${row.kind}: missing suspension`);
        const wheel = rig.wheels[0].m, rest = wheel.rotation.x;
        stepVehicleMotion(rig, {}, .1, 1, 4, NaN, 0);
        check(wheel.rotation.x === rest, 'invalid velocity changed wheel pose');
        stepVehicleMotion(rig, {}, .1, 1, 4, 4, 0);
        check(wheel.rotation.x !== rest, `${row.kind}: wheel does not roll`);
        stepVehicleMotion(rig, {}, .1, 1, 4, -4, 0);
        check(near(wheel.rotation.x, rest), `${row.kind}: reversing wheel drifts`);
        stepVehicleMotion(rig, {}, .1, 1, 0, 0, .5);
        if (rig.kind === 'tracked') {
          check(rig.tracks?.length === 2, `${row.kind}: missing tread assemblies`);
          check(rig.tracks[0].travel * rig.tracks[1].travel < 0, `${row.kind}: differential turn`);
          for (const t of rig.tracks) check(t.mesh.instanceMatrix.array.every(Number.isFinite), 'invalid tread matrices');
        } else check(rig.suspension.some(a => a.mount.rotation.y !== 0), `${row.kind}: missing front steering`);
      }
      for (const m of rig.mechanisms || []) {
        stepUnitMotion(rig, 0);
        const before = m.node[m.channel][m.axis];
        stepUnitMotion(rig, 3);
        check(before !== m.node[m.channel][m.axis], `${row.kind}: static mechanism`);
      }
      if (!['civ', 'bunker'].includes(row.kind)) check(rig.attacks?.length, `${row.kind}: missing attack assembly`);
      for (const fps of [30, 60, 144]) {
        const ent = { id: 19, mesh, heroY: 0, flies: rig.kind === 'aerial' };
        for (let frame = 0; frame < fps; frame++) {
          const now = frame / fps, px = mesh.position.x, pz = mesh.position.z;
          mesh.position.z += 6 / fps;
          ent.fireFx = { t0: 0, slot: 'heavy' };
          stepCombatFx(ent, now, 1 / fps);
          stepUnitSpinners(mesh.userData.spin, 1 / fps);
          stepLocomotion(ent, 1 / fps, now, px, pz, mesh.rotation.y);
          finite(mesh, `${row.kind}/${fps}`);
        }
        if (rig.kind === 'biped') check(Math.abs(rig.legChainL[0].g.rotation.x) > 0.001, 'knee does not flex');
      }
      for (const a of rig.attacks || []) {
        stepUnitMotion(rig, 10);
        const muzzle = a.muzzles[0];
        const before = muzzle.getWorldPosition(new THREE.Vector3());
        fireUnitMotion(rig, muzzle, 10);
        stepUnitMotion(rig, 10.035);
        check(near(a.node.position.z, -a.travel), `${row.kind}: no barrel travel`);
        check(muzzle.getWorldPosition(new THREE.Vector3()).distanceTo(before) > 0.01, 'detached muzzle');
        for (const other of rig.attacks) if (other !== a) check(other.node.position.z === 0, 'wrong barrel fired');
        stepUnitMotion(rig, 10.8);
        check(a.node.position.z === 0 && a.node.rotation.x === 0, 'recoil never returns to rest');
        for (const m of a.cycle || []) check(m.node[m.channel][m.axis] === m.rest, 'breech never returns to rest');
        check(muzzle.getWorldPosition(new THREE.Vector3()).distanceTo(before) < 1e-8, 'rest drift');
        a.firedAt = -Infinity;
        shots++;
      }
      finite(mesh, row.kind);
      disposeTree(mesh);
      models++;
    }
    for (let profile = 0; profile < CIVILIANS.length; profile++) {
      const mesh = buildNpcModel('civ', 'STEEL', { profile });
      stepLocomotion({ id: profile, mesh }, 1 / 60, 1, 0, -0.1, 0);
      finite(mesh, `civilian ${profile}`);
      disposeTree(mesh);
    }
    const battery = buildBaseBattery('STEEL');
    const rig = { kind: 'static', attacks: battery.userData.attacks };
    const [a, b] = rig.attacks;
    fireUnitMotion(rig, a.muzzles[0], 1);
    fireUnitMotion(rig, b.muzzles[0], 1);
    stepUnitMotion(rig, 1.035);
    check(a.node.position.z < 0 && b.node.position.z < 0, 'same-tick salvo lost');
    const outputs = [];
    for (const fps of [30, 60, 144]) {
      fireUnitMotion(rig, a.muzzles[0], 2);
      for (let i = 0; i < fps / 2; i++) stepUnitMotion(rig, 2 + i / fps);
      stepUnitMotion(rig, 2.25);
      outputs.push(a.node.position.z);
    }
    check(outputs.every(v => near(v, outputs[0])), 'FPS-dependent recoil');
    const spinner = new THREE.Group(); spinner.userData.spinAxis = 'z';
    stepVehicleMotion({ kind: 'wheeled' }, {}, .1, 1, 4, 4, 0);
    stepUnitSpinners([spinner], 0.25);
    check(spinner.rotation.z === 10 && spinner.rotation.y === 0, 'launcher spins away from its bore');
    spinner.userData.spinRate = -20;
    stepUnitSpinners([spinner], .5);
    check(spinner.rotation.z === 0, 'counter-rotation rate ignored');
    fireUnitMotion(rig, {}, 3);
    check(a.firedAt === 2, 'unknown muzzle fired a weapon');
    stepUnitMotion(rig, 9);
    check(rig.attacks.every(a => a.node.position.z === 0), 'LOD gap leaves stale recoil');
    const _TMP_A = new THREE.Vector3();
    const aimBase = new Function('THREE', 'lerpFPS', '_TMP_A', `return ({${methods.aim}})._aimBaseGuns;`)(THREE, lerpFPS, _TMP_A);
    const ent = { guns: battery, gunPivots: battery.userData.pivots,
      _gunAim: [{ x: 80, y: 40, z: 120, until: 8 }, { x: -80, y: -20, z: 120, until: 8 }] };
    aimBase(ent, 1, 3);
    check(ent.gunPivots[0].rotation.y > 0 && ent.gunPivots[1].rotation.y < 0, 'independent yaw');
    check(ent.gunPivots[0].userData.pitch.rotation.x < 0 && ent.gunPivots[1].userData.pitch.rotation.x > 0, 'independent pitch');
    aimBase(ent, 10, 20);
    check(ent.gunPivots.every(p => near(p.userData.pitch.rotation.x, -0.14)), 'base rest pitch');
    disposeTree(battery);
    const tower = makeUnit('tower', 'SWARM', { ring: false }).group;
    tower.position.set(50, 24, -30);
    const turret = tower.userData.turret;
    const height = turret.getWorldPosition(_TMP_A).y;
    const aimTower = new Function('THREE', 'lerpFPS', '_TMP_A', 'UNITS', `return ({${methods.tower}})._aimTurret;`)(THREE, lerpFPS, _TMP_A, UNITS);
    aimTower({ mesh: tower, _aimAt: { x: 50, z: 100, y: height - 2, until: 10 } }, 1, 5);
    check(near(turret.userData.pitch.rotation.x, 0), 'tower ignores fitted parent height');
    disposeTree(tower);
    const base = makeUnit('base:STEEL', 'STEEL', { ring: false }).group;
    const bodyRig = base.userData.rig;
    const addBase = new Function('THREE', 'buildBaseBattery', 'llToWorld', `return ({${methods.addBase}})._addBaseGuns;`)(THREE, buildBaseBattery, () => [0, 0]);
    const baseEnt = { mesh: base }, scene = new THREE.Scene();
    addBase.call({ cfg: {}, scene }, baseEnt, { s: 'STEEL', x: 0, z: 0 });
    check(base.userData.rig === bodyRig && bodyRig.mechanisms.length > 0, 'battery discarded body mechanisms');
    disposeTree(baseEnt.guns); disposeTree(base);

    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;background:#ddd8ce;color:#242931;font:16px sans-serif';
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setSize(390, 270);
    setCelSun(new THREE.Vector3(0.4, 0.8, 0.4));
    for (const kind of ['creep:soldier', 'creep:rocketeer', 'creep:tank', 'creep:heli', 'summon:veteran_squad', 'tower', 'base:STEEL']) {
      const line = document.createElement('div'); line.style.cssText = 'display:flex;gap:6px;padding:8px'; document.body.append(line);
      for (const pose of ['idle', 'move', 'fire']) {
        const side = kind === 'tower' ? 'SWARM' : 'STEEL';
        const mesh = makeUnit(kind, side, { ring: false }).group, rig = mesh.userData.rig;
        if (kind.startsWith('base:')) {
          const body = new THREE.Box3().setFromObject(mesh);
          const battery = buildBaseBattery(side, body.max.y - body.min.y);
          mesh.add(battery); rig.attacks = battery.userData.attacks;
        }
        const scene = new THREE.Scene(); scene.background = new THREE.Color(0xddd8ce); scene.add(mesh);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x6c7180, 2.2));
        const sun = new THREE.DirectionalLight(0xffffff, 2.6); sun.position.set(20, 40, 30); scene.add(sun);
        const box = new THREE.Box3().setFromObject(mesh), size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3()), radius = size.length() / 2;
        const camera = new THREE.PerspectiveCamera(40, 390 / 270, 0.1, 2000);
        camera.position.copy(center).add(new THREE.Vector3(radius * 1.8, radius * 0.8, radius * 2.8)); camera.lookAt(center);
        const ent = { id: 7, mesh };
        for (let f = 0; f < 60; f++) {
          const now = f / 60;
          if (pose === 'fire') ent.fireFx = { t0: 0.8, slot: 'light' };
          stepCombatFx(ent, now, 1 / 60);
          stepLocomotion(ent, 1 / 60, now, 0, pose === 'move' ? -0.13 : 0, 0);
        }
        if (pose === 'fire' && rig.attacks?.length) {
          fireUnitMotion(rig, rig.attacks[0].muzzles[0], 1);
          stepUnitMotion(rig, 1.035);
        }
        updateCelLight(camera); renderer.render(scene, camera);
        const cell = document.createElement('div'), label = document.createElement('div'), img = document.createElement('img');
        label.textContent = `${kind} / ${pose}`; img.src = renderer.domElement.toDataURL();
        cell.append(label, img); line.append(cell);
        disposeTree(mesh);
      }
    }
    renderer.dispose();
    return { models, civilianProfiles: CIVILIANS.length, attackAssemblies: shots, frameRates: [30, 60, 144] };
  }, { aim: grabMethod(game, '_aimBaseGuns'), tower: grabMethod(game, '_aimTurret'), addBase: grabMethod(game, '_addBaseGuns') });
  assert.deepEqual(errors, []);
  await mkdir('tools/.shots', { recursive: true });
  await page.screenshot({ path: 'tools/.shots/unit-motion.png', fullPage: true });
  console.log('Unit motion passed:', result);
} finally {
  await browser?.close();
  server.close();
}
