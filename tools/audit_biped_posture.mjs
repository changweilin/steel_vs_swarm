// Authored biped arms must swing in travel, brace while firing, and retain hand-mounted disks.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumOrNull, chromePath, writeReview as writeFile } from './pw.mjs';
import { serve } from './mech_prompt_review.mjs';

const contracts = await Promise.all(['assets', 'morphers'].map(async name =>
  JSON.parse(await readFile(`tools/mech_authoring/${name}.json`, 'utf8'))));
const bipeds = Object.values(Object.assign({}, ...contracts.map(c => c.assets))).filter(a => a.kind === 'biped'
  && !a.rig.groundWings && !a.rig.tinyArms && !a.rig.knuckle);
const option = process.argv.indexOf('--asset');
const ids = option < 0 ? bipeds.map(a => a.id) : process.argv[option + 1].split(',');
assert(ids.every(id => bipeds.some(a => a.id === id)), 'Unknown biped');
const server = serve(0);
await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
let browser;
try {
  const chromium = await chromiumOrNull();
  assert(chromium, 'An existing Playwright runtime is required');
  browser = await chromium.launch({ headless: true, executablePath: chromePath(),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.goto(`http://127.0.0.1:${server.address().port}/?mech=t11`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__MECH_REVIEW?.preview?.unit);
  const results = await page.evaluate(async ids => {
    const THREE = await import('three');
    const { forgeMech, forgeMorphUnit, specOf } = await import('/public/js/forge/forge.js');
    const { stepLocomotion } = await import('/public/js/locomotion.js');
    const { disposeTree } = await import('/public/js/toon.js');
    const results = {};
    const check = (ok, why) => { if (!ok) throw new Error(why); };
    const range = values => Math.max(...values) - Math.min(...values);
    const quat = () => new THREE.Quaternion();
    const point = () => new THREE.Vector3();
    for (const id of ids) {
      results[id] = [];
      for (const fps of [30, 60, 144]) {
        const isMorph = ['m01', 't06', 't11', 'm05'].includes(id);
        const model = isMorph ? forgeMorphUnit(specOf(`${id}@ground`), specOf(`${id}@flight`)) : forgeMech(specOf(id));
        const unit = model.group, morph = unit.userData.morph;
        const tree = morph ? morph.gg : unit;
        const rig = morph ? morph.ground : unit.userData.rig;
        const gripMounts = new Map((rig.heldWeapons || []).map(held => {
          const node = tree.getObjectByName(held.node);
          return [node, node.quaternion.clone()];
        }));
        const ent = { id, mesh: unit, heroY: 0, df: false, sp: 1 };
        const dt = 1 / fps;
        let now = 0;
        const mounted = () => {
          if (id !== 't11') return;
          for (const root of [morph.gg, morph.ag]) for (const [side, sign] of [['l', 1], ['r', -1]]) {
            const wrist = root.getObjectByName(`wrist_${side}`), hinge = root.getObjectByName(`rotor_hinge_${side}`);
            const expected = wrist.localToWorld(new THREE.Vector3(sign * .18, -.08, .04));
            check(expected.distanceTo(hinge.getWorldPosition(point())) < 1e-5, 't11: disk left the hand back');
            check(hinge.getWorldPosition(point()).distanceTo(root.getObjectByName(`rotor_${side}`).getWorldPosition(point())) < 1e-5,
              't11: shield and rotor have different centers');
          }
        };
        const step = speed => {
          now += dt;
          stepLocomotion(ent, dt, now, unit.position.x, unit.position.z - speed * dt, unit.rotation.y);
          unit.updateMatrixWorld(true);
          mounted();
          if (id === 't11' && morph.m < 1e-6) {
            const head = tree.getObjectByName('head').getWorldQuaternion(quat());
            const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(head);
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(head);
            // Allow the existing idle scan while guarding against a sideways or downward face.
            check(forward.z > .9 && up.y > .97,
              `t11: ground head does not face forward upright ${JSON.stringify({ forward: forward.toArray(), up: up.toArray(), now, df: ent.df, aim: rig._fireAim })}`);
          }
        };
        const speed = rig.top * .8;
        for (let i = 0; i < fps * 2; i++) step(speed);
        const arms = [[], []], elbows = [[], []];
        for (let i = 0; i < fps * 2; i++) {
          step(speed);
          arms[0].push(rig.armL.rotation.x); arms[1].push(rig.armR.rotation.x);
          elbows[0].push(rig.armChainL[0].g.rotation.x); elbows[1].push(rig.armChainR[0].g.rotation.x);
          if (id === 't11') for (const side of ['l', 'r']) {
            const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(tree.getObjectByName(`rotor_hinge_${side}`).quaternion);
            check(Math.abs(normal.x) > .99999, 't11: running disk faces forward');
          }
        }
        check(arms.every(a => range(a) > .15), `${id}: a running shoulder is frozen`);
        check(elbows.every(a => range(a) > .1), `${id}: a running elbow is frozen`);
        rig._fireAim = rig._aim = 1;
        const firing = [[], []];
        for (let i = 0; i < fps; i++) {
          step(speed);
          for (const [index, side] of ['L', 'R'].entries()) {
            const wrist = rig[`armChain${side}`][1].g, elbow = rig[`armChain${side}`][0].g;
            const forward = wrist.getWorldPosition(point()).sub(elbow.getWorldPosition(point())).normalize();
            firing[index].push(Math.atan2(forward.y, forward.z));
            check(forward.z > .6, `${id}: ${side} firing forearm points away from the target`);
            for (const weapon of Object.values(rig.wpn)) {
              if (weapon.aimJoint !== wrist) continue;
              const barrel = point().set(0,0,1).applyQuaternion(weapon.ref.getWorldQuaternion(new THREE.Quaternion()));
              check(barrel.dot(forward) > .9, `${id}: barrel diverges from the holding forearm`);
              let mount = weapon.ref;
              while (mount.parent && mount.parent !== wrist) mount = mount.parent;
              check(mount.parent === wrist && gripMounts.has(mount), `${id}: weapon left its grasping hand`);
              check(mount.quaternion.angleTo(gripMounts.get(mount)) < 1e-5, `${id}: gun mount changed inside the grip`);
            }
          }
        }
        check(firing.every(a => range(a) < .08), `${id}: firing arms keep swinging`);
        rig._fireAim = rig._aim = 0;
        ent.df = true;
        for (let i = 0; i < fps * 3; i++) step(0);
        let defense = null;
        if (id === 't11') {
          const hinge = tree.getObjectByName('rotor_hinge_l'), barrier = rig.shield.barrier;
          const center = unit.worldToLocal(hinge.getWorldPosition(point()));
          const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(hinge.getWorldQuaternion(quat()));
          const shieldNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(barrier.getWorldQuaternion(quat()));
          const projected = unit.worldToLocal(barrier.getWorldPosition(point()));
          defense = { center: center.toArray(), projectedCenter: projected.toArray(), alignment: Math.abs(normal.dot(shieldNormal)) };
          check(Math.abs(center.x - projected.x) < .03 && Math.abs(center.y - projected.y) < .03,
            `t11: defense disk is off center ${JSON.stringify(defense)}`);
          check(defense.alignment > .9995, 't11: defense disk is not parallel to the projection');
          rig._fireAim = rig._aim = 1;
          for (let i = 0; i < fps; i++) step(0);
          check(Math.abs(new THREE.Vector3(0, 0, 1).applyQuaternion(hinge.quaternion).x) > .99999,
            't11: firing retains the centered defense disk');
          rig._fireAim = rig._aim = 0;
          for (let i = 0; i < fps * 2; i++) step(speed);
          check(Math.abs(new THREE.Vector3(0, 0, 1).applyQuaternion(hinge.quaternion).x) > .99999,
            't11: moving defense disk does not return to the arm outside');
          ent.df = false;
          ent.heroY = 5;
          for (let i = 0; i < fps * 3; i++) step(0);
          ent.heroY = 0;
          for (let i = 0; i < fps * 3; i++) step(0);
        }
        results[id].push({ fps, shoulderRanges: arms.map(range), elbowRanges: elbows.map(range),
          firingRanges: firing.map(range), defense });
        disposeTree(unit);
      }
    }
    return results;
  }, ids);
  await writeFile('out/morph_reference/refinement/biped-posture-validation.json', JSON.stringify(results, null, 2) + '\n');
  console.log(`BIPED_POSTURE_PASS bipeds=${ids.length} fps=30,60,144`);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
