// Unit hardpoints, muzzle alignment, combat stance, and recoil audit.
// Prerequisite: server running on port 8620 (node server/server.js). Playwright sourced from mapping_elf.
// Usage: node tools/audit_muzzle.mjs
// 1. 32 hero ground forms: rig.wpn light/heavy breech-to-muzzle vector (ref frame fwd axis) MUST face forward
//    (dot(+z) >= 0.8; exceptions: aegis shoulder VLS points up by design, monkey tail gun verified via heavy combat stance).
// 2. monkey tail gun: heavy weapon combat stance (_aimH) MUST pivot muzzle forward (dot(+z) >= 0.6).
// 3. Morph aerial forms (m -> 1): light/heavy muzzles MUST align with flight path (dot(+z) >= 0.75).
// 4. Muzzle anchor MUST sit at weapon front (muz projection along fire axis >= ref origin) with flame anchor (rig.flames).
// 5. Firing recoil: after fireFx injection, at least one of _kickL / _kickR / _kickB MUST > 0.02 (verified for light and heavy).
// 6. Combat stance: units with gunR/gunL MUST converge weapon rotation.x to aim angle +-0.25 when stationary in combat.
// 7. NPC: 4-faction infantry/rocketeer/howitzer + vehicles (turret pitch node) + helicopters (alternating twin muzzles + gunTilt).
// 8. Mobile fire: during ground run / flight transit, light and heavy fire axes MUST remain facing forward (dot(+z) >= 0.9).
// 9. Elephant / stegosaurus / centaur: root, second, and metapodial/phalangeal joints MUST all achieve > 0.03 rad stroke.
// 10. Biped / quadruped units: trunk COM oscillation MUST synchronize with full stride cycle (symmetric = 2, gallop/bound = 1).
// 11. Mobile fire transition: aim raise weight MUST converge continuously from 0 to 1 without instant snapping on first frame.
import { chromium } from 'file:///C:/Users/user/Documents/app/mapping_elf/node_modules/playwright/index.mjs';

// Port overridable via SVS_URL: workspaces sharing port 8620 risk hitting stale checkouts silently.
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto((process.env.SVS_URL || 'http://localhost:8620'), { waitUntil: 'networkidle' });

const report = await page.evaluate(async () => {
  const THREE = await import('three');
  const { makeUnit } = await import('/public/js/models.js');
  const { stepLocomotion, stepCombatFx } = await import('/public/js/locomotion.js');
  const { CHARACTERS, charKind } = await import('/public/js/data.js');

  const Z = new THREE.Vector3(0, 0, 1);
  const out = [];
  // Transform ref frame forward axis ('z'/'-z'/'y'/'-y'/'x'/'-x') into world direction vector.
  const wpnDir = (set) => {
    const ax = set.fwd || 'z';
    const s = ax.startsWith('-') ? -1 : 1;
    const k = ax.replace('-', '');
    const v = new THREE.Vector3(k === 'x' ? s : 0, k === 'y' ? s : 0, k === 'z' ? s : 0);
    const o = set.ref.getWorldPosition(new THREE.Vector3());
    return set.ref.localToWorld(v).sub(o).normalize();
  };
  const settle = (ent, mesh, frames, fire = null) => {
    let t = 100;
    const dt = 1 / 60;
    for (let i = 0; i < frames; i++) {
      t += dt;
      if (fire) ent.fireFx = { t0: t - 0.05, slot: fire };   // Continuous engagement: refresh t0 every frame to simulate burst fire.
      stepCombatFx(ent, t, dt);
      stepLocomotion(ent, dt, t, mesh.position.x, mesh.position.z, mesh.rotation.y);
    }
    return t;
  };
  const moveFire = (ent, mesh, frames, fire, speed) => {
    let t = 200;
    const dt = 1 / 60;
    const aim = [];
    for (let i = 0; i < frames; i++) {
      const px = mesh.position.x, pz = mesh.position.z, pyaw = mesh.rotation.y;
      mesh.position.z += speed * dt;
      t += dt;
      ent.fireFx = { t0: t - 0.05, slot: fire };
      stepCombatFx(ent, t, dt);
      stepLocomotion(ent, dt, t, px, pz, pyaw);
      aim.push(mesh.userData.rig?._fireAim || 0);
    }
    mesh.updateMatrixWorld(true);
    return { t, aim };
  };
  const oscillations = (vals) => {
    const lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 0.005) return { count: 0, range: hi - lo };
    const mid = (lo + hi) * 0.5;
    let count = 0;
    for (let i = 0; i < vals.length; i++) {
      const prev = vals[(i + vals.length - 1) % vals.length];
      if (prev <= mid && vals[i] > mid) count++;
    }
    return { count, range: hi - lo };
  };
  const motionCycle = (ent, mesh, speed) => {
    const dt = 1 / 60;
    let t = 400;
    ent.cfx = null; ent.fireFx = null; ent.heavyFx = null;
    const tick = () => {
      const px = mesh.position.x, pz = mesh.position.z, pyaw = mesh.rotation.y;
      mesh.position.z += speed * dt;
      t += dt;
      stepCombatFx(ent, t, dt);
      stepLocomotion(ent, dt, t, px, pz, pyaw);
    };
    for (let i = 0; i < 240; i++) tick();
    const rig = mesh.userData.rig;
    const ph0 = ent.loco.ph;
    const body = [], pitch = [];
    for (let i = 0; i < 1200 && ent.loco.ph - ph0 < Math.PI * 2; i++) {
      tick();
      const active = mesh.userData.rig;
      body.push(active.kind === 'quad' ? active.spine.position.y : active.hips.position.y);
      if (active.kind === 'quad') pitch.push(active.spine.rotation.x);
    }
    const asymmetric = rig.kind === 'biped'
      ? !!(rig.hop || rig.bound)
      : rig.gait === 'trot';
    return {
      gait: rig.hop ? 'hop' : rig.bound ? 'bound' : (rig.gait || rig.kind),
      expected: asymmetric ? 1 : 2,
      body: oscillations(body),
      pitch: pitch.length ? oscillations(pitch) : null,
    };
  };
  const limbMotion = (ent, mesh, frames, speed) => {
    const rig = mesh.userData.rig;
    const limbs = [
      ['FL', rig.legFL, rig.chFL], ['FR', rig.legFR, rig.chFR],
      ['HL', rig.legHL, rig.chHL], ['HR', rig.legHR, rig.chHR],
    ];
    const rows = limbs.map(([name, root, chain]) => {
      const nodes = [root, ...(chain || []).slice(0, 2).map((j) => j.g)];
      return { name, nodes, lo: nodes.map(() => Infinity), hi: nodes.map(() => -Infinity) };
    });
    let t = 300;
    const dt = 1 / 60;
    ent.fireFx = null; ent.heavyFx = null;
    for (let i = 0; i < frames; i++) {
      const px = mesh.position.x, pz = mesh.position.z, pyaw = mesh.rotation.y;
      mesh.position.z += speed * dt;
      t += dt;
      stepCombatFx(ent, t, dt);
      stepLocomotion(ent, dt, t, px, pz, pyaw);
      for (const row of rows) row.nodes.forEach((n, j) => {
        if (!n) return;
        row.lo[j] = Math.min(row.lo[j], n.rotation.x);
        row.hi[j] = Math.max(row.hi[j], n.rotation.x);
      });
    }
    return rows.map((row) => ({ name: row.name,
      ranges: row.nodes.map((n, j) => n ? row.hi[j] - row.lo[j] : -1) }));
  };

  // -- 1. 32 Heroes --
  for (const [id, ch] of Object.entries(CHARACTERS)) {
    const kind = charKind(id);
    const r = { id, kind, issues: [] };
    try {
      const side = ch.side === 'MERC' ? 'STEEL' : ch.side;
      const { group: mesh } = makeUnit('hero:' + kind, side, { ring: false, ch: id });
      mesh.updateMatrixWorld(true);
      const rig = mesh.userData.rig;
      if (!rig) { r.issues.push('無 rig'); out.push(r); continue; }
      const vis = ch.visual || {};
      const ent = { mesh, heroY: 0 };
      settle(ent, mesh, 90);
      mesh.updateMatrixWorld(true);
      // 4. Muzzle flash sphere
      if (rig.muzzles && !rig.flames) r.issues.push('muzzles 有登記但無 rig.flames(焰球未掛)');
      // 1 & 4. Ground form wpn orientation and muzzle placement
      for (const slot of ['light', 'heavy']) {
        const set = rig.wpn?.[slot];
        if (!set?.ref || !set?.muz) { r.issues.push(`wpn.${slot} 缺登記`); continue; }
        const dir = wpnDir(set);
        const dz = dir.dot(Z);
        const vlsUp = slot === 'heavy' && vis.proto === 'aegis';          // Shoulder VLS points upward by design.
        const tailGun = slot === 'heavy' && vis.ground === 'monkey';      // Tail gun verified in combat stance below.
        const punch = slot === 'heavy' && vis.creature === 'roo';         // Fist cannon verified during thrust phase below.
        if (!vlsUp && !tailGun && !punch && dz < 0.8) r.issues.push(`地面 ${slot} 槍口朝向 dot(+z)=${dz.toFixed(2)} < 0.8`);
        const o = set.ref.getWorldPosition(new THREE.Vector3());
        const proj = set.muz.getWorldPosition(new THREE.Vector3()).sub(o).dot(dir);
        if (!vlsUp && !tailGun && proj < -0.05) r.issues.push(`${slot} 槍口不在武器前端(投影 ${proj.toFixed(2)})`);
      }
      // 8. Ground run-and-gun: static pose may allow VLS / tail gun / punch gun, but mobile fire must enter forward attack stance.
      for (const slot of ['light', 'heavy']) {
        ent.cfx = null; ent.fireFx = null; ent.heavyFx = null;
        const trace = moveFire(ent, mesh, 120, slot, Math.max(6, (rig.top || 12) * 0.72));
        const movingRig = mesh.userData.rig;
        const set = movingRig?.wpn?.[slot];
        if (!set?.ref) continue;
        if (!(trace.aim[0] > 0 && trace.aim[0] < 0.35 && trace.aim.at(-1) > 0.95))
          r.issues.push(`奔跑射擊 ${slot} 舉槍權重未平滑收斂(${trace.aim[0].toFixed(2)}→${trace.aim.at(-1).toFixed(2)})`);
        const dz = wpnDir(set).dot(Z);
        const motion = movingRig.kind === 'aerial' ? '飛行射擊' : '奔跑射擊';
        if (dz < 0.9) r.issues.push(`${motion} ${slot} 槍口未朝正前(dot=${dz.toFixed(2)})`);
      }
      // 9. Direct verification for s03 / m06 (columnar limbs) and s06 (unguligrade) to prevent regressions hidden by shared curves.
      if (id === 's03' || id === 'm06' || id === 's06') {
        const rows = limbMotion(ent, mesh, 180, Math.max(6, (rig.top || 12) * 0.72));
        r.limbMotion = rows;
        for (const row of rows) {
          if (row.ranges.length < 3 || row.ranges.some((v) => v < 0.03))
            r.issues.push(`${row.name} 根/第二/掌蹠節卡死(行程 ${row.ranges.map((v) => v.toFixed(3)).join('/')})`);
        }
      }
      // Punch cannon forward thrust (roo): charge thrusts fist forward and locks; muzzle MUST point forward on fire.
      // Evaluates full charge-to-fire sequence for peak dot product; injecting fire directly skips thrust phase.
      if (vis.creature === 'roo' && rig.wpn?.heavy?.ref) {
        let t = settle(ent, mesh, 30);
        const dt = 1 / 60;
        let best = -1;
        const run = (n) => {
          for (let i = 0; i < n; i++) {
            t += dt;
            stepCombatFx(ent, t, dt);
            stepLocomotion(ent, dt, t, mesh.position.x, mesh.position.z, mesh.rotation.y);
            mesh.updateMatrixWorld(true);
            best = Math.max(best, wpnDir(rig.wpn.heavy).dot(Z));
          }
        };
        ent.heavyFx = { phase: 'charge', t0: t };
        run(70);
        ent.heavyFx = { phase: 'fire', t0: t };
        run(10);
        if (best < 0.85) r.issues.push(`roo 拳砲蓄力/擊發未前突(峰值 dot=${best.toFixed(2)})`);
        ent.heavyFx = null; ent.cfx = null;
      }
      // 6. Aim angle convergence
      for (const [nm, gp] of [['gunR', rig.gunR], ['gunL', rig.gunL]]) {
        if (!gp?.g) continue;
        const d = Math.abs(gp.g.rotation.x - gp.aim);
        if (d > 0.25) r.issues.push(`${nm} 交戰未收斂到據槍角(Δ${d.toFixed(2)})`);
      }
      // 5. Recoil
      for (const slot of ['light', 'heavy']) {
        ent.cfx = null;
        settle(ent, mesh, 6, slot);
        const k = Math.max(rig._kickL || 0, rig._kickR || 0, rig._kickB || 0);
        if (k < 0.02) r.issues.push(`${slot} 開火無後座(kick=${k.toFixed(3)})`);
      }
      // 2. Monkey tail gun combat forward rotation
      if (vis.ground === 'monkey') {
        ent.cfx = null; ent.heavyFx = null;
        settle(ent, mesh, 150, 'heavy');
        mesh.updateMatrixWorld(true);
        const dz = wpnDir(rig.wpn.heavy).dot(Z);
        if (dz < 0.6) r.issues.push(`monkey 尾砲重武器交戰未轉前(dot=${dz.toFixed(2)})`);
        ent.heavyFx = null;
      }
      // 10. Per-rig stride cycle: execute one complete stride and count dynamic trunk COM oscillations directly.
      if (rig.kind === 'biped' || rig.kind === 'quad') {
        const cycle = motionCycle(ent, mesh, Math.max(6, (rig.top || 12) * 0.72));
        r.motionCycle = cycle;
        if (cycle.body.count !== cycle.expected)
          r.issues.push(`${cycle.gait} 軀幹起伏 ${cycle.body.count} 次/stride，應為 ${cycle.expected}`);
        if (rig.kind === 'quad' && cycle.pitch.count !== cycle.expected)
          r.issues.push(`${cycle.gait} 軀幹俯仰 ${cycle.pitch.count} 次/stride，應為 ${cycle.expected}`);
      }
      // 3. Morph aerial forms: measured during active firing (monkey hovers vertically by design; sustained fire flattens into cruise towards target).
      if (kind === 'morph') {
        ent.cfx = null; ent.fireFx = null;
        ent.heroY = 60;
        settle(ent, mesh, 300);   // L.morph damp 2.6: converges to 1 within 5s.
        settle(ent, mesh, 90, 'light');
        mesh.updateMatrixWorld(true);
        // Measurement MUST target the aerial rig (rigAir); the top-level rig reference points to ground form.
        // Aerial flight morphs translate part transforms dynamically; sampling the ground rig yields invalid intermediate values.
        const rigA = mesh.userData.rigAir || mesh.userData.rig;
        for (const slot of ['light', 'heavy']) {
          const set = rigA.wpn?.[slot];
          if (!set?.ref) continue;
          const dz = wpnDir(set).dot(Z);
          if (dz < 0.75) r.issues.push(`飛行 ${slot} 槍口未朝航向(dot=${dz.toFixed(2)})`);
        }
        for (const slot of ['light', 'heavy']) {
          ent.cfx = null; ent.fireFx = null; ent.heavyFx = null;
          const airRig = mesh.userData.rigAir || mesh.userData.rig;
          const trace = moveFire(ent, mesh, 120, slot, Math.max(14, (airRig.top || 24) * 0.72));
          const set = (mesh.userData.rigAir || mesh.userData.rig)?.wpn?.[slot];
          if (!set?.ref) continue;
          if (!(trace.aim[0] > 0 && trace.aim[0] < 0.35 && trace.aim.at(-1) > 0.95))
            r.issues.push(`飛行射擊 ${slot} 舉槍權重未平滑收斂(${trace.aim[0].toFixed(2)}→${trace.aim.at(-1).toFixed(2)})`);
          const dz = wpnDir(set).dot(Z);
          if (dz < 0.9) r.issues.push(`飛行射擊 ${slot} 槍口未朝正前(dot=${dz.toFixed(2)})`);
        }
      }
    } catch (e) { r.issues.push('例外:' + e.message); }
    out.push(r);
  }

  // -- 7. NPC --
  const npc = [];
  for (const side of ['SWARM', 'STEEL', 'GUER', 'MILI']) {
    // Third-party factions (GUER/MILI) lack APCs (simulation spawns soldier/rocketeer/howitzer/tank/heli only).
    const kinds = ['creep:soldier', 'creep:rocketeer', 'creep:howitzer', 'creep:tank', 'creep:heli',
      ...(side === 'SWARM' || side === 'STEEL' ? ['creep:apc'] : [])];
    for (const kind of kinds) {
      const r = { id: `${side}:${kind}`, issues: [] };
      try {
        const { group: mesh } = makeUnit(kind, side, { ring: false });
        mesh.updateMatrixWorld(true);
        const rig = mesh.userData.rig;
        if (!rig) { r.issues.push('無 rig'); npc.push(r); continue; }
        const ent = { mesh, heroY: 0 };
        settle(ent, mesh, 90, 'light');
        mesh.updateMatrixWorld(true);
        // Muzzle anchor placed forward of unit mesh origin.
        const mz = rig.muzzles?.light;
        if (!mz?.n) r.issues.push('缺 muzzles.light');
        else {
          const p = mz.n.getWorldPosition(new THREE.Vector3());
          const fwdZ = p.z - mesh.position.z;
          const isHeli = kind === 'creep:heli';
          if (!isHeli && fwdZ < 0.2) r.issues.push(`槍口不在機體前方(z 偏移 ${fwdZ.toFixed(2)})`);
        }
        if (rig.muzzles && !rig.flames) r.issues.push('焰球未掛');
        // Recoil
        const k = Math.max(rig._kickL || 0, rig._kickR || 0, rig._kickB || 0);
        if (k < 0.02) r.issues.push(`開火無後座(kick=${k.toFixed(3)})`);
        // Combat stance: handheld weapon requires aimPose; shoulder rocket launcher requires raised arm support.
        if ((kind === 'creep:soldier' || kind === 'creep:howitzer' || kind === 'creep:rocketeer') && !rig.aimPose)
          r.issues.push('步兵缺 aimPose(戰鬥姿勢)');
        // Vehicles: turret + pitch node.
        if (kind === 'creep:apc' || kind === 'creep:tank') {
          const tur = mesh.userData.turret;
          if (!tur) r.issues.push('缺 userData.turret');
          else if (!tur.userData?.pitch) r.issues.push('砲塔缺 pitch 節點');
        }
        // Helicopters: alternating dual muzzles or gunTilt (swarm jaw cannon is single-barrel, verifying gunTilt only).
        if (kind === 'creep:heli') {
          if (!mesh.userData.gunTilt) r.issues.push('直升機缺 gunTilt(共軛俯仰)');
          const tm = mesh.userData.turretMuzzles;
          if (side !== 'SWARM' && (!tm || tm.length < 2)) r.issues.push('直升機缺雙槍口輪替登記');
        }
      } catch (e) { r.issues.push('例外:' + e.message); }
      npc.push(r);
    }
  }
  return { heroes: out, npc };
});

let bad = 0;
for (const r of report.heroes) {
  if (r.issues.length) { bad++; console.log(`❌ ${r.id}(${r.kind}):`); for (const i of r.issues) console.log('   -', i); }
  if (r.limbMotion) console.log(`  ${r.id} 四肢根/第二/掌蹠節行程: `
    + r.limbMotion.map((x) => `${x.name} ${x.ranges.map((v) => v.toFixed(3)).join('/')}`).join(' | '));
  if (r.motionCycle) console.log(`  ${r.id} ${r.motionCycle.gait} stride: `
    + `COM ${r.motionCycle.body.count}/${r.motionCycle.expected} (行程 ${r.motionCycle.body.range.toFixed(3)})`
    + (r.motionCycle.pitch ? ` | 軀幹俯仰 ${r.motionCycle.pitch.count}/${r.motionCycle.expected} (行程 ${r.motionCycle.pitch.range.toFixed(3)})` : ''));
}
console.log(`英雄:${report.heroes.length - bad}/${report.heroes.length} 通過`);
let badN = 0;
for (const r of report.npc) {
  if (r.issues.length) { badN++; console.log(`❌ ${r.id}:`); for (const i of r.issues) console.log('   -', i); }
}
console.log(`NPC:${report.npc.length - badN}/${report.npc.length} 通過`);
await browser.close();
process.exit(bad + badN > 0 ? 1 : 0);
