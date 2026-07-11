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
  else if (rig.kind === 'quad') stepQuad(L, rig, dt, now, speed, yawRate);
  else if (rig.kind === 'morph') stepMorph(L, rig, dt, now, ent, vFwd, vLat, speed);
  else stepVehicle(L, rig, dt, now, speed, vFwd, yawRate);
}

/**
 * 分節屈曲(mobility_plan「hierarchy delay」= 動力鏈 follow-through):
 * 只有擺動相(該肢正把末端往前送 ⇒ −cos < 0 的那半週期)才屈曲,支撐相回到靜姿角打直 ——
 * 這是「腳不滑地、膝不反折」的來源;每節自己的相位延遲 d 讓力由近端傳向遠端。
 * 符號見 models.js segLimb:膝 k 為正(後折)、肘為負(前折)、踝取反號(擺動抬腳背)。
 */
function flexChain(chain, ph, a) {
  for (const j of chain) {
    const f = Math.max(0, -Math.cos(ph - j.d));
    j.g.rotation.x = j.base + j.k * f * a;
  }
}

/** 多節蠕動波(觸手/軟肢):正負皆可(不是只朝一邊折的關節),節節延遲 = 由根往梢傳的波 */
function undulate(chain, ph, amp) {
  for (const j of chain) j.g.rotation.x = j.base + j.k * Math.sin(ph - j.d) * amp;
}

/** 雙足步態:步頻耦合位移 + 重心側移 + 前傾 + 手臂反相 + 膝/肘分節(Task 2.1) */
function stepBiped(L, rig, dt, now, speed) {
  const strideW = (rig.stride || 0.9) * (rig.s || 1);   // 一步的世界長度
  L.ph += speed * dt * Math.PI / Math.max(0.2, strideW);
  L.amp = damp(L.amp, clamp(speed / (rig.top || 8), 0, 1.2), 6, dt);
  const a = L.amp;
  const sw = Math.sin(L.ph);
  const legA = 0.62 * a;
  const legB = rig.legBase || 0, armB = rig.armBase || 0;   // 原型站姿(拱背/負重機體的靜態屈角)
  rig.legL.rotation.x = legB + sw * legA;
  rig.legR.rotation.x = legB - sw * legA;
  // 手臂與腿反相(follow-through);持械手擺幅收斂,槍口保持穩定
  rig.armL.rotation.x = armB - sw * legA * 0.75;
  rig.armR.rotation.x = armB + sw * legA * (rig.gunArm ? 0.25 : 0.75);
  // 膝→踝、肘→腕:分節鏈(有掛才跑;舊的單節機體照舊只擺髖/肩)
  if (rig.legChainL) {
    flexChain(rig.legChainL, L.ph, a);
    flexChain(rig.legChainR, L.ph + Math.PI, a);
    flexChain(rig.armChainL, L.ph + Math.PI, a);
    flexChain(rig.armChainR, L.ph, a * (rig.gunArm ? 0.45 : 1));   // 持械側手肘幾乎不甩
  }
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

/** 飛行載具:壓坡入彎 ≤15° + 前傾 + 懸停浮沉(Task 1.1);rig.wings = 撲翼(飛行生物型) */
function stepAerial(L, rig, dt, now, vFwd, vLat) {
  const top = rig.top || 20;
  // 向右橫移(vLat>0)→ 右側(局部 +x)下壓 = rotation.z 負
  L.roll = damp(L.roll, clamp(-vLat / top, -1, 1) * 0.26, 4.5, dt);
  L.pitch = damp(L.pitch, clamp(vFwd / top, -1, 1) * 0.2 + clamp(L.accel * 0.006, -0.07, 0.07), 4.5, dt);
  rig.tilt.rotation.z = L.roll;
  rig.tilt.rotation.x = L.pitch;
  rig.tilt.position.y = (rig.tiltY0 || 0) + Math.sin(now * 2.2 + L.ph) * (rig.bob || 0.08);
  if (rig.wings) {
    const k = clamp(Math.hypot(vFwd, vLat) / top, 0, 1);
    if (rig.insect) {
      // 昆蟲震翅:頻率遠高於鳥類(懸停時也全速振,不靠前進速度產生升力),
      // 行程平面近水平 —— 上下拍幅小,主運動是「前後掃掠 + 每半衝程翼面翻轉」的 8 字軌跡;
      // 後翅相位落後前翅(蜂類前後翅耦合但非同相)。
      L.flap = (L.flap || 0) + dt * (30 + k * 16);
      const amp = 0.3 + k * 0.12;
      for (const { w, outer, sgn, pair } of rig.wings) {
        const ph = L.flap - (pair ? 0.5 : 0);
        w.rotation.z = sgn * Math.sin(ph) * amp;            // 拍(小幅)
        w.rotation.y = sgn * Math.cos(ph) * 0.55;           // 掃(主運動:前後掃掠)
        w.rotation.x = Math.cos(ph) * 0.8;                  // 翻(衝程換向時翼面反轉迎角)
        outer.rotation.z = sgn * Math.sin(ph - 0.35) * amp * 0.8;
      }
    } else {
      // 鳥類撲翼:頻率/振幅隨速度提升(懸停慢拍、巡航快拍);外翼相位延遲 = 鞭式 follow-through
      L.flap = (L.flap || 0) + dt * (3.2 + k * 9);
      const amp = 0.24 + k * 0.34;
      for (const { w, outer, sgn } of rig.wings) {
        w.rotation.z = sgn * Math.sin(L.flap + L.ph) * amp;
        outer.rotation.z = sgn * Math.sin(L.flap + L.ph - 0.7) * amp * 1.5;
      }
    }
  }
}

/** 四足獸型:對角步態 + 脊椎波傳導 + 尾巴配重(Task 2.2) */
function stepQuad(L, rig, dt, now, speed, yawRate) {
  const strideW = (rig.stride || 1.4) * (rig.s || 1);
  L.ph += speed * dt * Math.PI / Math.max(0.25, strideW);   // 步頻嚴格耦合位移(不滑步)
  L.amp = damp(L.amp, clamp(speed / (rig.top || 10), 0, 1.15), 6, dt);
  const a = L.amp;
  // trot:對角腿同相(FL+HR / FR+HL);高速時後腿相位拉近前腿 → 趨近 gallop 的縱向彈跳
  const gallop = clamp((a - 0.6) / 0.4, 0, 1);
  const off = Math.PI * 0.5 * gallop;
  const legA = 0.66 * a;
  const phFL = L.ph, phFR = L.ph + Math.PI, phHL = L.ph + Math.PI + off, phHR = L.ph + off;
  rig.legFL.rotation.x = Math.sin(phFL) * legA;
  rig.legFR.rotation.x = Math.sin(phFR) * legA;
  rig.legHL.rotation.x = Math.sin(phHL) * legA * 0.9;
  rig.legHR.rotation.x = Math.sin(phHR) * legA * 0.9;
  // 膝/跗/蹄的分節屈曲(擺動相收腿、支撐相打直);觸手腿是逐節延遲的行進波
  if (rig.chFL) {
    flexChain(rig.chFL, phFL, a);
    flexChain(rig.chFR, phFR, a);
    flexChain(rig.chHL, phHL, a);
    flexChain(rig.chHR, phHR, a);
  }
  // 持武觸手:與步態無關的恆時蠕動(靜止也在動 = 活的東西),速度越快擺越大
  if (rig.tents) for (const t of rig.tents) undulate(t, now * 1.5 + L.ph * 0.5, 0.5 + 0.5 * a);
  // 脊椎波:動力由後髖生成向前傳導(腰 → 胸 → 頸 逐節相位延遲),鞭式屈伸
  const wave = L.ph * 2;
  rig.spine.rotation.x = Math.sin(wave) * 0.05 * a + clamp(L.accel * 0.012, -0.08, 0.1);
  rig.chest.rotation.x = Math.sin(wave - 0.7) * 0.05 * a;
  rig.neck.rotation.x = Math.sin(wave - 1.4) * 0.07 * a;
  // 縱向彈跳(gallop 越明顯)+ 靜止呼吸微沉浮;頭部靜止時緩慢警戒掃描
  rig.spine.position.y = rig.hipsY0 - (0.5 - 0.5 * Math.cos(wave)) * (rig.bob || 0.08) * a * (1 + gallop * 0.8)
    + (a < 0.05 ? Math.sin(now * 1.4 + L.ph) * 0.02 : 0);
  rig.head.rotation.y = a < 0.05 ? Math.sin(now * 0.6 + L.ph) * 0.3 : 0;
  // 尾巴配重:急轉時甩向轉向反側(counterweight),尾梢延遲跟隨;身體入彎傾斜
  L.roll = damp(L.roll, clamp(yawRate * 0.22, -0.5, 0.5), 3.5, dt);
  rig.tail.rotation.y = -L.roll * 1.1 + Math.sin(L.ph) * 0.14 * a;
  rig.tail2.rotation.y = damp(rig.tail2.rotation.y, rig.tail.rotation.y * 0.8, 5, dt);
  rig.tail.rotation.x = 0.12 + Math.sin(wave - 2.0) * 0.08 * a;
  rig.spine.rotation.z = -L.roll * 0.14;
}

/**
 * 變形機甲(transformer_plan):型態由伺服器回報高度推導(heroY > 門檻 = 飛行型),
 * 阻尼漸變出 0(地面)→1(飛行)的型態參數 m —
 * rig.pose(m)(models.js)以各部件自己的分段時窗 smoothstep 到位
 * (翼先展 → 腿後收 → 機首鎖上的 Macross 式序列);這裡在姿勢之上疊加動態:
 * 地面步態(人型雙足 / 獸型前肢著地小跑)、飛行壓坡巡航、鳥/龍拍翼、
 * 推進器發光 ∝ m、關節排氣口熱散逸 ∝ 變形活動度(Task 3.1)。
 */
function stepMorph(L, rig, dt, now, ent, vFwd, vLat, speed) {
  const want = (ent.heroY || 0) > 1.2 ? 1 : 0;
  const prev = L.morph ?? want;
  L.morph = damp(prev, want, 2.6, dt);
  const m = L.morph;
  // 變形活動度(|dm/dt| 平滑):進行中排氣口增亮,完成後自然歸零
  L.act = damp(L.act || 0, clamp(Math.abs(m - prev) / dt * 4, 0, 1), 5, dt);
  rig.pose(m);   // 分段姿勢插值(基底;以下全部疊加其上)
  // 地面步態:步頻耦合位移(不滑步);獸型前肢 = 對角小跑,人型持械手收斂
  const strideW = (rig.stride || 1.15) * (rig.s || 1);
  L.ph += speed * dt * Math.PI / Math.max(0.2, strideW);
  L.amp = damp(L.amp, clamp(speed / (rig.top || 9), 0, 1.1) * (1 - m), 6, dt);
  const sw = Math.sin(L.ph) * 0.6 * L.amp;
  rig.legL.rotation.x += sw;
  rig.legR.rotation.x += -sw;
  rig.armL.rotation.x += -sw * (rig.swingArm || 0.4);
  rig.armR.rotation.x += sw * (rig.swingArm || 0.4) * (rig.beast ? 1 : 0.5);
  // 分節屈曲疊在 pose 之上(擺動相才折,支撐相打直):膝 → 踝(延遲)→ 肘(反相)。
  // 獸型的 Z 形腿本身已屈,屈曲量減半;L.amp 已含 (1−m) ⇒ 飛行型態自動歸零
  const a = L.amp;
  const fx = (ph) => Math.max(0, -Math.cos(ph));
  const kA = rig.beast ? 0.3 : 0.6;
  rig.kneeL.rotation.x += fx(L.ph) * kA * a;
  rig.kneeR.rotation.x += fx(L.ph + Math.PI) * kA * a;
  if (rig.ankleL) {
    rig.ankleL.rotation.x -= fx(L.ph - 0.5) * 0.3 * a;
    rig.ankleR.rotation.x -= fx(L.ph + Math.PI - 0.5) * 0.3 * a;
  }
  const eA = 0.4 * (rig.swingArm || 0.4);
  rig.elbowL.rotation.x -= fx(L.ph + Math.PI - 0.4) * eA * a;
  rig.elbowR.rotation.x -= fx(L.ph - 0.4) * eA * a * (rig.beast ? 1 : 0.5);
  // 多節長尾(猿猴型):逐節相位延遲的鞭式擺動 = 奔跑配重
  if (rig.tailSegs) rig.tailSegs.forEach((t, i) => {
    t.rotation.y += Math.sin(L.ph - i * 0.5) * 0.14 * a;
    t.rotation.x += Math.sin(L.ph * 2 - i * 0.6) * 0.05 * a;
  });
  // 軀幹動態:地面前傾/加減速預備、飛行壓坡入彎 + 巡航俯仰、懸停浮沉
  const topAir = rig.topAir || 30;
  L.roll = damp(L.roll, clamp(-vLat / topAir, -1, 1) * 0.3 * m, 4, dt);
  L.pitch = damp(L.pitch,
    m * clamp(vFwd / topAir, -1, 1) * 0.2
    + (1 - m) * (0.16 * L.amp + clamp(L.accel * 0.015, -0.1, 0.15)), 4, dt);
  rig.torso.rotation.x += L.pitch;
  rig.torso.rotation.z = L.roll;
  rig.torso.position.y += -(0.5 - 0.5 * Math.cos(L.ph * 2)) * (rig.bob || 0.07) * L.amp
    + m * Math.sin(now * 2.4 + L.ph) * 0.12;   // 飛行懸停浮沉
  // 拍翼(鳥/龍):翼展開後才拍;頻率隨速度、外翼相位延遲(follow-through)
  if (rig.flapWings && m > 0.45) {
    const k = clamp(Math.hypot(vFwd, vLat) / topAir, 0, 1);
    L.flap = (L.flap || 0) + dt * (2.6 + k * 8) * (rig.flapF || 1);
    const amp = (0.2 + k * 0.3) * m;
    for (const { w, outer, sgn } of rig.flapWings) {
      w.rotation.z += sgn * Math.sin(L.flap + L.ph) * amp;
      outer.rotation.z += sgn * Math.sin(L.flap + L.ph - 0.7) * amp * 1.4;
    }
  }
  // 旋翼轉速 ∝ 推力(地面完全靜止 — 收攏槳葉/手持圓盾不自轉;變形中緩轉起旋);
  // dir 正逆槳互抵扭矩、f = 尾旋翼加速比
  if (rig.rotors) for (const r of rig.rotors)
    r.g.rotation.y += dt * r.dir * (m * 26 + L.act * 10) * (r.f || 1);
  // 推進器 ∝ 飛行推力;排氣口 ∝ 變形熱散逸(transformer_plan Task 3.1)
  for (const t of rig.thrusters) t.material.emissiveIntensity = 0.25 + m * 2.2 + L.act * 1.2;
  for (const v of rig.vents) v.material.emissiveIntensity = 0.15 + L.act * 2.6;
}
