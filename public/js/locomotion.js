// ============ 程序化移動骨架動畫(doc/mobility_plan.html 執行)============
// 原則:所有動作由「實際位移」驅動,不用固定速率的關鍵幀循環 —
//  雙足(Task 2.1):步頻與地面位移嚴格耦合(腳不滑地)、重心側移到支撐腿、
//                   速度前傾(anticipation)、手臂反相擺動(overlapping action)
//  輪/履帶(Task 1.2):輪轉速 = 線速度 / 輪半徑(消除滑行感)、
//                   轉彎離心側傾、煞車點頭/加速後蹲
//  飛行(Task 1.1):朝橫移方向壓坡(≤15°)、機鼻隨前速下壓、懸停正弦浮沉
// 所有目標值都經指數阻尼(非線性緩動)進骨架,不出現機械式瞬跳。
// 純客戶端視覺:不動伺服器權威狀態;rig 由 models.js 各建模函式提供。

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (c, t, k, dt) => c + (t - c) * Math.min(1, k * dt);
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** 以實體 id 生成穩定相位差(不用 Math.random:重連/多端步伐錯開方式一致) */
function phaseOf(id) {
  let h = 2166136261;
  const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 628) / 100;
}

/**
 * 每幀驅動一個單位的骨架(game.js _updateEnts 呼叫)。
 * @param ent  客戶端實體(mesh.userData.rig / .walk 由 models.js 提供)
 * @param px,pz,pyaw 本幀位移前的位置與朝向(速度/角速度差分用)
 */
export function stepLocomotion(ent, dt, now, px, pz, pyaw) {
  if (dt < 0.004) return;   // hitstop / 極小步:骨架凍結
  const mesh = ent.mesh;
  const rig = mesh.userData.rig;
  const walk = mesh.userData.walk;
  if (!rig && !walk) return;
  let L = ent.loco;
  if (!L) {
    L = ent.loco = {
      vx: 0, vz: 0, speed: 0, accel: 0,
      roll: 0, pitch: 0, amp: 0, lean: 0, ts: 0,
      ph: phaseOf(ent.id),
    };
  }
  // 世界速度(位移差分再阻尼平滑:8Hz 快照插值的鋸齒不進骨架)
  L.vx = damp(L.vx, (mesh.position.x - px) / dt, 6, dt);
  L.vz = damp(L.vz, (mesh.position.z - pz) / dt, 6, dt);
  const speed = Math.hypot(L.vx, L.vz);
  L.accel = damp(L.accel, (speed - L.speed) / dt, 5, dt);
  L.speed = speed;
  const yaw = mesh.rotation.y;
  const yawRate = wrapA(yaw - pyaw) / dt;
  // 機體座標系分量(models.js 模型一律面朝 +z;right = 局部 +x)
  const vFwd = L.vx * Math.sin(yaw) + L.vz * Math.cos(yaw);
  const vLat = L.vx * Math.cos(yaw) - L.vz * Math.sin(yaw);

  // GLB 骨骼動畫(Quaternius 步行 clip):播放速率跟實際地速耦合,
  // 靜止歸零 — 原本恆速播放會原地滑步,違反 mobility_plan 的貼地原則。
  if (walk) {
    const ref = mesh.userData.walkRef || 6;
    const want = speed < 0.25 ? 0 : clamp(speed / ref, 0.35, 2.2);
    L.ts = damp(L.ts, want, 8, dt);
    walk.timeScale = L.ts;
  }
  if (!rig) return;
  if (rig.kind === 'biped') stepBiped(L, rig, dt, now, speed);
  else if (rig.kind === 'aerial') stepAerial(L, rig, dt, now, vFwd, vLat);
  else stepVehicle(L, rig, dt, now, speed, vFwd, yawRate);
}

/** 雙足步態:步頻耦合位移 + 重心側移 + 前傾 + 手臂反相(Task 2.1) */
function stepBiped(L, rig, dt, now, speed) {
  const strideW = (rig.stride || 0.9) * (rig.s || 1);   // 一步的世界長度
  L.ph += speed * dt * Math.PI / Math.max(0.2, strideW);
  L.amp = damp(L.amp, clamp(speed / (rig.top || 8), 0, 1.2), 6, dt);
  const a = L.amp;
  const sw = Math.sin(L.ph);
  const legA = 0.62 * a;
  rig.legL.rotation.x = sw * legA;
  rig.legR.rotation.x = -sw * legA;
  // 手臂與腿反相(follow-through);持械手擺幅收斂,槍口保持穩定
  rig.armL.rotation.x = -sw * legA * 0.75;
  rig.armR.rotation.x = sw * legA * (rig.gunArm ? 0.25 : 0.75);
  const hips = rig.hips;
  // 骨盆:每步兩次浮沉(雙支撐最高、單支撐最低)+ 重心側移到支撐腿
  hips.position.y = rig.hipsY0 - (0.5 - 0.5 * Math.cos(L.ph * 2)) * (rig.bob || 0.06) * a
    + (a < 0.05 ? Math.sin(now * 1.7 + L.ph) * 0.012 : 0);   // 靜止時的呼吸微沉浮
  hips.position.x = sw * (rig.sway || 0.05) * a;
  hips.rotation.z = -sw * 0.07 * a;
  hips.rotation.y = -sw * 0.1 * a;    // 骨盆對轉(自然扭腰)
  // 前傾:速度越快越前壓;加減速再疊預備/回穩傾角
  L.lean = damp(L.lean, 0.22 * a + clamp(L.accel * 0.015, -0.1, 0.15), 5, dt);
  hips.rotation.x = L.lean;
}

/** 輪/履帶載具:輪速耦合 + 離心側傾 + 煞車點頭(Task 1.2) */
function stepVehicle(L, rig, dt, now, speed, vFwd, yawRate) {
  const s = rig.s || 1;
  for (const w of rig.wheels) w.m.rotation.x += vFwd / Math.max(0.05, w.r * s) * dt;
  const tracked = rig.kind === 'tracked';
  // 右轉(yawRate>0)離心力把車體甩向左(局部 +x 抬升 = rotation.z 正)
  const roll = clamp(yawRate * vFwd * (tracked ? 0.004 : 0.009), -0.1, 0.1);
  // 減速(accel<0)→ 車鼻下沉(rotation.x 正 = +z 端下壓);加速 → 後蹲
  const pitch = clamp(-L.accel * (tracked ? 0.014 : 0.01), -0.09, 0.13);
  L.roll = damp(L.roll, roll, 4, dt);
  L.pitch = damp(L.pitch, pitch, 4, dt);
  rig.hull.rotation.z = L.roll;
  rig.hull.rotation.x = L.pitch;
  // 行駛細碎顛簸(懸吊咬地感;幅度極小,靜止歸零)
  const jig = clamp(speed / (rig.top || 10), 0, 1);
  rig.hull.position.y = (rig.hullY0 || 0) + Math.sin(now * 12.5 + L.ph * 7) * 0.012 * jig;
}

/** 飛行載具:壓坡入彎 ≤15° + 前傾 + 懸停浮沉(Task 1.1) */
function stepAerial(L, rig, dt, now, vFwd, vLat) {
  const top = rig.top || 20;
  // 向右橫移(vLat>0)→ 右側(局部 +x)下壓 = rotation.z 負
  L.roll = damp(L.roll, clamp(-vLat / top, -1, 1) * 0.26, 4.5, dt);
  L.pitch = damp(L.pitch, clamp(vFwd / top, -1, 1) * 0.2 + clamp(L.accel * 0.006, -0.07, 0.07), 4.5, dt);
  rig.tilt.rotation.z = L.roll;
  rig.tilt.rotation.x = L.pitch;
  rig.tilt.position.y = (rig.tiltY0 || 0) + Math.sin(now * 2.2 + L.ph) * (rig.bob || 0.08);
}
