// 全機體武裝掛點/槍口/戰鬥姿勢/後座稽核(CLAUDE.md §5「武裝掛點/槍口」列;2026-07-22 重建)
// 前置:伺服器在 8620 執行中(node server/server.js);Playwright 借用 mapping_elf 的安裝
// 用法:node tools/audit_muzzle.mjs
// ① 32 英雄地面型:rig.wpn 輕/重的「槍尾→槍口」方向(ref 框架 fwd 軸)MUST 朝機體正前
//    (dot(+z) ≥ 0.8;例外:aegis 雙肩 VLS 朝上 = 本體特徵、monkey 尾砲須進重武器交戰檢查)
// ② monkey 尾砲:地面重武器交戰(_aimH)後砲口 MUST 轉前(dot(+z) ≥ 0.6)
// ③ 變形機甲飛行型(m→1):輕/重槍口 MUST 朝航向(dot(+z) ≥ 0.75)
// ④ 槍口位置 MUST 在武器前端(muz 沿射向投影 ≥ ref 原點)且掛焰(rig.flames)
// ⑤ 開火後座:fireFx 注入後 _kickL/_kickR/_kickB 任一 MUST > 0.02(輕重各驗)
// ⑥ 戰鬥姿勢:有 gunR/gunL 的機體,靜止(交戰)時槍身 rotation.x MUST 收斂到 aim 角 ±0.25
// ⑦ NPC:四陣營小兵/火箭/榴彈 + 車輛(砲塔 pitch 節點)+ 直升機(雙槍口輪替 + gunTilt)
import { chromium } from 'file:///C:/Users/user/Documents/app/mapping_elf/node_modules/playwright/index.mjs';

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto('http://localhost:8620', { waitUntil: 'networkidle' });

const report = await page.evaluate(async () => {
  const THREE = await import('three');
  const { makeUnit } = await import('/public/js/models.js');
  const { stepLocomotion, stepCombatFx } = await import('/public/js/locomotion.js');
  const { CHARACTERS, charKind } = await import('/public/js/data.js');

  const Z = new THREE.Vector3(0, 0, 1);
  const out = [];
  // ref 框架 fwd 軸('z'/'-z'/'y'/'-y'/'x'/'-x')→ 世界方向
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
      if (fire) ent.fireFx = { t0: t - 0.05, slot: fire };   // 交戰保持(每幀刷新 t0 = 連射)
      stepCombatFx(ent, t, dt);
      stepLocomotion(ent, dt, t, mesh.position.x, mesh.position.z, mesh.rotation.y);
    }
    return t;
  };

  // ── ① 32 英雄 ──
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
      // ④ 焰球
      if (rig.muzzles && !rig.flames) r.issues.push('muzzles 有登記但無 rig.flames(焰球未掛)');
      // ①④ 地面型 wpn 朝向與槍口位置
      for (const slot of ['light', 'heavy']) {
        const set = rig.wpn?.[slot];
        if (!set?.ref || !set?.muz) { r.issues.push(`wpn.${slot} 缺登記`); continue; }
        const dir = wpnDir(set);
        const dz = dir.dot(Z);
        const vlsUp = slot === 'heavy' && vis.proto === 'aegis';          // 雙肩 VLS 朝上 = 本體特徵
        const tailGun = slot === 'heavy' && vis.ground === 'monkey';      // 尾砲另驗交戰姿態(下)
        const punch = slot === 'heavy' && vis.creature === 'roo';         // 拳砲另驗擊發前突(下)
        if (!vlsUp && !tailGun && !punch && dz < 0.8) r.issues.push(`地面 ${slot} 槍口朝向 dot(+z)=${dz.toFixed(2)} < 0.8`);
        const o = set.ref.getWorldPosition(new THREE.Vector3());
        const proj = set.muz.getWorldPosition(new THREE.Vector3()).sub(o).dot(dir);
        if (!vlsUp && !tailGun && proj < -0.05) r.issues.push(`${slot} 槍口不在武器前端(投影 ${proj.toFixed(2)})`);
      }
      // 拳砲擊發前突(roo):蓄力把拳前伸鎖定 → 擊發瞬間拳口 MUST 前指
      // (走完整蓄力→擊發序列,取全程峰值;無蓄力直接注入 fire 量不到前伸相)
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
      // ⑥ 據槍角收斂
      for (const [nm, gp] of [['gunR', rig.gunR], ['gunL', rig.gunL]]) {
        if (!gp?.g) continue;
        const d = Math.abs(gp.g.rotation.x - gp.aim);
        if (d > 0.25) r.issues.push(`${nm} 交戰未收斂到據槍角(Δ${d.toFixed(2)})`);
      }
      // ⑤ 後座
      for (const slot of ['light', 'heavy']) {
        ent.cfx = null;
        settle(ent, mesh, 6, slot);
        const k = Math.max(rig._kickL || 0, rig._kickR || 0, rig._kickB || 0);
        if (k < 0.02) r.issues.push(`${slot} 開火無後座(kick=${k.toFixed(3)})`);
      }
      // ② monkey 尾砲交戰轉前
      if (vis.ground === 'monkey') {
        ent.cfx = null; ent.heavyFx = null;
        settle(ent, mesh, 150, 'heavy');
        mesh.updateMatrixWorld(true);
        const dz = wpnDir(rig.wpn.heavy).dot(Z);
        if (dz < 0.6) r.issues.push(`monkey 尾砲重武器交戰未轉前(dot=${dz.toFixed(2)})`);
        ent.heavyFx = null;
      }
      // ③ 變形機甲飛行型:開火中量測(悟空懸停直立是 by design,開火保持會壓平回巡航
      //    → 槍口朝攻擊方向;其餘機種開不開火皆已對齊)
      if (kind === 'morph') {
        ent.cfx = null; ent.fireFx = null;
        ent.heroY = 60;
        settle(ent, mesh, 300);   // L.morph damp 2.6 → 5s 內收斂到 1
        settle(ent, mesh, 90, 'light');
        mesh.updateMatrixWorld(true);
        for (const slot of ['light', 'heavy']) {
          const set = rig.wpn?.[slot];
          if (!set?.ref) continue;
          const dz = wpnDir(set).dot(Z);
          if (dz < 0.75) r.issues.push(`飛行 ${slot} 槍口未朝航向(dot=${dz.toFixed(2)})`);
        }
      }
    } catch (e) { r.issues.push('例外:' + e.message); }
    out.push(r);
  }

  // ── ⑦ NPC ──
  const npc = [];
  for (const side of ['SWARM', 'STEEL', 'GUER', 'MILI']) {
    // 第三方(GUER/MILI)編制無 APC(sim 只出 soldier/rocketeer/howitzer/tank/heli)
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
        // 槍口錨 + 在機體前方
        const mz = rig.muzzles?.light;
        if (!mz?.n) r.issues.push('缺 muzzles.light');
        else {
          const p = mz.n.getWorldPosition(new THREE.Vector3());
          const fwdZ = p.z - mesh.position.z;
          const isHeli = kind === 'creep:heli';
          if (!isHeli && fwdZ < 0.2) r.issues.push(`槍口不在機體前方(z 偏移 ${fwdZ.toFixed(2)})`);
        }
        if (rig.muzzles && !rig.flames) r.issues.push('焰球未掛');
        // 後座
        const k = Math.max(rig._kickL || 0, rig._kickR || 0, rig._kickB || 0);
        if (k < 0.02) r.issues.push(`開火無後座(kick=${k.toFixed(3)})`);
        // 戰鬥姿勢:手持(weap R)須有 aimPose;肩扛火箭筒也要抬臂扶筒(2026-07-22 規則 2)
        if ((kind === 'creep:soldier' || kind === 'creep:howitzer' || kind === 'creep:rocketeer') && !rig.aimPose)
          r.issues.push('步兵缺 aimPose(戰鬥姿勢)');
        // 車輛:砲塔 + pitch 節點
        if (kind === 'creep:apc' || kind === 'creep:tank') {
          const tur = mesh.userData.turret;
          if (!tur) r.issues.push('缺 userData.turret');
          else if (!tur.userData?.pitch) r.issues.push('砲塔缺 pitch 節點');
        }
        // 直升機:雙槍口輪替或 gunTilt(蜂群頜砲單口 → 只驗 gunTilt)
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
}
console.log(`英雄:${report.heroes.length - bad}/${report.heroes.length} 通過`);
let badN = 0;
for (const r of report.npc) {
  if (r.issues.length) { badN++; console.log(`❌ ${r.id}:`); for (const i of r.issues) console.log('   -', i); }
}
console.log(`NPC:${report.npc.length - badN}/${report.npc.length} 通過`);
await browser.close();
process.exit(bad + badN > 0 ? 1 : 0);
