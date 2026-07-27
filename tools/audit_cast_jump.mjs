// 全角色施法/跳躍稽核(CLAUDE.md §4;動 stepCastPose/stepJumpPose/CAST_SIG 後 MUST 跑)
// 前置:伺服器在 8620 執行中(node server/server.js);Playwright 借用 mapping_elf 的安裝
// 用法:node tools/audit_cast_jump.mjs
// ① 32 角 × castFx(skill/ult × 全向/定向)跑到自清、無 NaN
// ② heroY 拋物線兩輪:落地衝擊 landK MUST 觸發(非 aerial)
// ③ morph 1.69m tap 小跳 MUST NOT 觸發變形(L.morph 保持 ~0)
// ④ 差分洩漏:同角色對照組(從未施法)逐節點比對旋轉 —— 任何未每幀重賦的通道洩漏都會現形
// ⑤ 靜止後包圍盒高度回歸基線 ±20%(aerial 免驗)
import { chromium } from 'file:///C:/Users/user/Documents/app/mapping_elf/node_modules/playwright/index.mjs';

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto('http://localhost:8620', { waitUntil: 'networkidle' });

const report = await page.evaluate(async () => {
  const THREE = await import('three');
  const { makeUnit } = await import('/public/js/models.js');
  const { stepLocomotion } = await import('/public/js/locomotion.js');
  const { CHARACTERS, charKind } = await import('/public/js/data.js');

  const box = new THREE.Box3();
  const out = [];
  const hasNaN = (root) => {
    let bad = null;
    root.traverse((o) => {
      if (bad) return;
      const p = o.position, q = o.quaternion, s = o.scale;
      if (![p.x, p.y, p.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z].every(Number.isFinite)) bad = o.name || o.type;
    });
    return bad;
  };
  const bboxH = (mesh) => { box.setFromObject(mesh); return box.max.y - box.min.y; };
  const flat = (root) => { const a = []; root.traverse((o) => a.push(o)); return a; };

  for (const [id, ch] of Object.entries(CHARACTERS)) {
    const kind = charKind(id);
    const r = { id, kind, ok: true, issues: [] };
    try {
      const side = ch.side === 'MERC' ? 'STEEL' : ch.side;
      const { group: meshA } = makeUnit('hero:' + kind, side, { ring: true, ch: id });
      const { group: meshB } = makeUnit('hero:' + kind, side, { ring: true, ch: id });  // 對照組:永不施法/跳躍
      const rig = meshA.userData.rig;
      r.rigKind = rig?.kind || null;
      r.castSig = rig?.castSig ? `${rig.castSig.omni}/${rig.castSig.dir}` : '(預設)';
      const A = { mesh: meshA, heroY: 0 };
      const B = { mesh: meshB, heroY: 0 };
      let t = 100;
      const dt = 1 / 60;
      const step = () => {
        t += dt;
        stepLocomotion(A, dt, t, meshA.position.x, meshA.position.z, meshA.rotation.y);
        stepLocomotion(B, dt, t, meshB.position.x, meshB.position.z, meshB.rotation.y);
      };
      for (let i = 0; i < 90; i++) step();
      const base = bboxH(meshA);

      // ① 施法四組合
      for (const slot of ['skill', 'ult']) {
        for (const dir of [null, { x: 0, z: -1 }]) {
          A.castFx = { t0: t, slot, dir };
          let frames = 0;
          while (A.castFx && frames < 200) { step(); frames++; }
          if (A.castFx) { r.ok = false; r.issues.push(`castFx 未自清(${slot}/${dir ? '定向' : '全向'})`); A.castFx = null; }
          const nan = hasNaN(meshA);
          if (nan) { r.ok = false; r.issues.push(`施法 NaN @${nan}(${slot}/${dir ? '定向' : '全向'})`); }
        }
      }

      // ② 跳躍兩輪(morph 頂點壓 1.0m):非 aerial 的落地衝擊 MUST 觸發
      const apex = kind === 'morph' ? 1.0 : 2.2;
      const T = 0.9;
      let landMax = 0;
      for (let cyc = 0; cyc < 2; cyc++) {
        for (let i = 0; i <= Math.round(T / dt); i++) {
          A.heroY = Math.max(0, apex * Math.sin((Math.PI * i * dt) / T));
          step();
          landMax = Math.max(landMax, A.loco?.landK || 0);
        }
        A.heroY = 0;
        for (let i = 0; i < 30; i++) { step(); landMax = Math.max(landMax, A.loco?.landK || 0); }
      }
      if (hasNaN(meshA)) { r.ok = false; r.issues.push('跳躍 NaN'); }
      r.landMax = +landMax.toFixed(2);
      if (rig?.kind !== 'aerial' && landMax < 0.1) { r.ok = false; r.issues.push(`落地衝擊未觸發(landK max=${landMax.toFixed(3)})`); }

      // ③ morph:1.69m tap 小跳不得觸發變形
      if (kind === 'morph') {
        let morphMax = 0;
        for (let i = 0; i <= Math.round(T / dt); i++) {
          A.heroY = Math.max(0, 1.69 * Math.sin((Math.PI * i * dt) / T));
          step();
          morphMax = Math.max(morphMax, A.loco?.morph || 0);
        }
        A.heroY = 0;
        r.morphMax = +morphMax.toFixed(3);
        if (morphMax > 0.05) { r.ok = false; r.issues.push(`tap 小跳誤觸變形(L.morph max=${morphMax.toFixed(2)})`); }
      }

      // ④ 靜止收斂後:差分洩漏 + 包圍盒回歸
      for (let i = 0; i < 150; i++) step();
      const fa = flat(meshA), fb = flat(meshB);
      if (fa.length !== fb.length) { r.issues.push(`對照組結構不一致(${fa.length}/${fb.length}),跳過差分`); }
      else {
        for (let i = 0; i < fa.length; i++) {
          const da = Math.abs(fa[i].rotation.x - fb[i].rotation.x)
            + Math.abs(fa[i].rotation.y - fb[i].rotation.y)
            + Math.abs(fa[i].rotation.z - fb[i].rotation.z)
            + Math.abs(fa[i].position.y - fb[i].position.y);
          if (da > 6e-3) { r.ok = false; r.issues.push(`通道洩漏 @${fa[i].name || fa[i].type}#${i} Δ=${da.toFixed(4)}`); }
        }
      }
      const after = bboxH(meshA);
      r.base = +base.toFixed(3); r.after = +after.toFixed(3);
      if (rig?.kind !== 'aerial' && Math.abs(after - base) / base > 0.2) {
        r.ok = false; r.issues.push(`包圍盒高度未回歸:${base.toFixed(2)} → ${after.toFixed(2)}`);
      }
    } catch (e) {
      r.ok = false; r.issues.push('例外:' + e.message);
    }
    out.push(r);
  }
  return out;
});

let fail = 0;
for (const r of report) {
  if (r.ok) console.log(`✅ ${r.id} (${r.kind}/${r.rigKind}) sig=${r.castSig} land=${r.landMax}${r.morphMax != null ? ' morphTap=' + r.morphMax : ''} h ${r.base}→${r.after}`);
  else { fail++; console.log(`❌ ${r.id} (${r.kind}/${r.rigKind}) ${r.issues.slice(0, 6).join(' | ')}`); }
}
console.log(`\n${report.length - fail}/${report.length} 通過`);
await browser.close();
process.exit(fail ? 1 : 0);
