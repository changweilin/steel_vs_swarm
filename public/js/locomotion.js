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
// 加速/減速強度正規化基準(m/s²):L.accel 是原始加速度(硬起步可達 10~40),
// 一律先除以它夾到 0..1 當「強度」,launch/brake/flare 脈衝才不會被原始量級放大成十幾度的暴衝。
const ACC_REF = 9;
const accUp = (L) => clamp(L.accel / ACC_REF, 0, 1);    // 加速強度 0..1
const accDn = (L) => clamp(-L.accel / ACC_REF, 0, 1);   // 減速強度 0..1

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
  if (rig.kind === 'biped') stepBiped(L, rig, dt, now, speed, yawRate);
  else if (rig.kind === 'aerial') stepAerial(L, rig, dt, now, vFwd, vLat, yawRate);
  else if (rig.kind === 'quad') stepQuad(L, rig, dt, now, speed, yawRate);
  else if (rig.kind === 'morph') stepMorph(L, rig, dt, now, ent, vFwd, vLat, speed, yawRate);
  else stepVehicle(L, rig, dt, now, speed, vFwd, yawRate);
}

/**
 * 分節屈曲(mobility_plan「hierarchy delay」= 動力鏈 follow-through)—— 奔跑的關節不是
 * 「擺動折、支撐鎖直」兩段開關(那看起來上下肢像焊死的木棍),而是雙相都在動:
 *  擺動相(−cos > 0 的半週期):大屈曲收腿過障,幅度 ×1.15(奔跑收腿比走路深);
 *  支撐相:載荷彈簧壓縮(cos² 的窄脈衝)—— 膝/踝在觸地瞬間吃重下沉再回彈,
 *  這是跑步與走路最大的視覺差(walk 支撐腿近乎打直、run 支撐腿是壓縮的彈簧)。
 *  hold = 常屈量(奔跑中的手肘恆屈 90° 前後泵動,不會甩直;由呼叫端以振幅比例傳入)。
 * 每節自己的相位延遲 d 讓力由近端傳向遠端。
 * 符號見 models.js segLimb:膝 k 為正(後折)、肘為負(前折)、踝取反號(擺動抬腳背)。
 */
function flexChain(chain, ph, a, idle = 0, t = 0, load = 0.45, hold = 0) {
  for (let i = 0; i < chain.length; i++) {
    const j = chain[i];
    const sw = Math.max(0, -Math.cos(ph - j.d));   // 擺動相:收腿
    const st = Math.max(0, Math.cos(ph - j.d));    // 支撐相:載荷壓縮(st² = 觸地窄脈衝)
    // 遠端節擺幅逐節放大(鞭式 follow-through):腕/掌、踝/趾是延遲最久、甩得最開的末節,
    // 手掌腳掌絕不跟前臂小腿鎖成一塊
    const whip = 1 + i * 0.25;
    // 靜止時的液壓微顫:每節仍以自己的相位延遲呼吸(振幅 ≈ 步態的 6%)——
    // 站著的機體關節完全凍結會像模型展示台,不像通電中的機具。
    // 擺動 1.3× + 支撐 st²·load:上下肢在整個週期沒有任何一段是「鎖死的固定角」
    j.g.rotation.x = j.base + j.k * ((sw * 1.3 + st * st * load) * a * whip + hold
      + 0.06 * idle * Math.sin(t * 1.6 - j.d * 1.5));
  }
}

/** 靜止度:速度趨零 → 1(給呼吸/微顫用;與步態振幅 a 互補) */
const idleOf = (a) => clamp(1 - a / 0.06, 0, 1);

// ── 開火/蓄力戰鬥動畫(third-person;game.js 戰場與 charPreview 展示台共用同一條)──
// stepCombatFx 由 ent.fireFx(tracer/plasma 開火事件)與 ent.heavyFx(heavyCharge/heavyFire)
// 推導本幀 rig 驅動場,各 step 函式再把它揉進步態:
//   rig._aim   0..1 開火保持:開火後 AIM_HOLD_S 內維持標準射擊姿勢(槍口朝前;移動中開火也舉槍)
//   rig._kickL/_kickR 後座脈衝:每發疊加、指數衰減 —— 依 rig.weap 的持手分邊(雙槍各自後座)
//   rig._chg  −1..+1 蓄力/擊發:蓄力緩升 0→+1、擊發瞬間 −1(方向與蓄力相反)再阻尼歸零。
//     同一條線性項 rot += chg×幅 依 rig.hvy 正負表達兩種原型:托槍下壓蓄力→槍口上跳(brace),
//     或拳砲後拉蓄力→直拳前突(punch)。
// 並直接驅動 rig.heavy.{glow,pivot}(蓄力增亮/展開;擊發 glow 強閃、pivot 反向過衝 = 與蓄力相反)
// 與 rig.lightGlow(輕武器槍口識別燈的擊發閃光)。純視覺,不涉 sim。
const AIM_HOLD_S = 1.5;               // 最後一發後維持射擊姿勢的秒數
const HEAVY_CHARGE_ASSUME_S = 1.05;   // third-person 蓄力進度的假定時長(戰術轉播,毋須逐角色精確)
const HEAVY_FIRE_HOLD_S = 0.12;       // 擊發尖峰保持
const FX_K = 10;                      // 彈簧阻尼:目標值突變也不瞬跳

export function stepCombatFx(ent, now, dt) {
  const rig = ent.mesh?.userData?.rig;
  if (!rig || dt <= 0) return;
  const C = ent.cfx || (ent.cfx = { aim: 0, kL: 0, kR: 0, kB: 0, chg: 0, lg: 0, fireT: -1, aimUntil: -1 });
  // 開火事件邊緣觸發(以 t0 去重):一次後座脈衝 + 展開射姿保持窗
  const fx = ent.fireFx;
  if (fx && fx.t0 !== C.fireT) {
    C.fireT = fx.t0;
    C.aimUntil = Math.max(C.aimUntil, fx.t0 + AIM_HOLD_S);
    // 幅度接 RECOIL 三級分級(makeUnit 依 data.js recoilTier 換算成 rig.kickAmp 倍率)
    const amp = (fx.slot === 'heavy' ? 1.0 : 0.45) * ((rig.kickAmp || S0)[fx.slot] ?? 1);
    const side = (rig.weap || S0)[fx.slot] || 'R';   // 'L'|'R'|'B' 持手;'N' = 機載(機身後座)
    if (side === 'L' || side === 'B') C.kL = Math.min(1.3, C.kL + amp);
    if (side === 'R' || side === 'B') C.kR = Math.min(1.3, C.kR + amp);
    if (side === 'N') C.kB = Math.min(1.3, (C.kB || 0) + amp);   // 機載武器:後座打進機身(各步態消費 _kickB)
    if (fx.slot !== 'heavy') C.lg = 1;
  }
  // 蓄力/擊發:蓄力沿假定時長線性升到 +1(緩、看得見的預備),擊發瞬間目標翻到 −1(急、反向)
  const hf = ent.heavyFx;
  let chgT = 0, glowT = 0;
  if (hf) {
    const el = now - hf.t0;
    if (hf.phase === 'charge') {
      chgT = Math.min(1, el / HEAVY_CHARGE_ASSUME_S);
      glowT = chgT;
      C.aimUntil = Math.max(C.aimUntil, now + 0.4);   // 蓄力中就進射姿
    } else if (el <= HEAVY_FIRE_HOLD_S) { chgT = -1; glowT = 2; }
    else ent.heavyFx = null;   // 尖峰過後交還阻尼衰減
  }
  const k = 1 - Math.exp(-FX_K * dt);
  C.chg += (chgT - C.chg) * k;
  C.aim = damp(C.aim, now < C.aimUntil ? 1 : 0, now < C.aimUntil ? 9 : 3.5, dt);
  C.kL = damp(C.kL, 0, 7, dt);
  C.kR = damp(C.kR, 0, 7, dt);
  C.kB = damp(C.kB || 0, 0, 7, dt);
  C.lg = damp(C.lg, 0, 10, dt);
  rig._aim = C.aim; rig._kickL = C.kL; rig._kickR = C.kR; rig._kickB = C.kB; rig._chg = C.chg;
  // 重武器掛點:蓄力 glow 增亮 / pivot 朝 deploy 展開;擊發 glow 強閃、pivot 以 −0.85 反向過衝
  // (蓄力怎麼展開,擊發就怎麼反向甩回 = 「蓄力動畫與開火相反」的通則,全機種共用)
  if (rig.heavy) {
    for (const gd of rig.heavy.glow) {
      const tgt = gd.base * (glowT <= 1 ? 1 + glowT * 1.6 : 2.6 + (glowT - 1) * 3);
      const m0 = gd.mesh.material;
      m0.emissiveIntensity += (tgt - m0.emissiveIntensity) * k;
    }
    const f = C.chg >= 0 ? C.chg : C.chg * 0.85;
    for (const pd of rig.heavy.pivot) {
      for (const ax of ['x', 'y', 'z']) {
        const tgt = pd.rest[ax] + (pd.deploy[ax] - pd.rest[ax]) * f;
        pd.obj.rotation[ax] += (tgt - pd.obj.rotation[ax]) * k;
      }
    }
  }
  // 輕武器槍口識別燈:擊發強閃後快速回穩(base 為靜置亮度)
  if (rig.lightGlow) for (const gd of rig.lightGlow)
    gd.mesh.material.emissiveIntensity = gd.base + C.lg * 3.2;
  // 第三人稱槍口焰(makeUnit 掛在槍口錨上的焰球):輕武器隨擊發閃(lg)、
  // 重武器隨擊發保持窗(glowT=2)即刻點亮 + chg 反向釋放窗延燒 —— 跟著武器節點走,
  // 曳光才會從槍管出來(只看 chg 會晚兩三幀,擊發幀就要有焰)
  if (rig.flames) {
    const hk = glowT > 1 ? 1 : C.chg < -0.18 ? -C.chg : 0;
    // 熄滅幀 scale 歸位 0.01:隱形球不撐大 Box3 量測與命中 raycast(Raycaster 不看 visible)
    for (const f of rig.flames.light) {
      f.visible = C.lg > 0.22;
      if (f.visible) { const s = 0.7 + C.lg * 0.9 + Math.sin(now * 87) * 0.16; f.scale.set(s, s, s); }
      else f.scale.setScalar(0.01);
    }
    for (const f of rig.flames.heavy) {
      f.visible = hk > 0;
      if (f.visible) { const s = 0.7 + hk * 1.1 + Math.sin(now * 63) * 0.18; f.scale.set(s, s, s); }
      else f.scale.setScalar(0.01);
    }
  }
}

/** 手持武器俯仰(rig.gunR/gunL = { g, rest, aim }):aimF 混成「行軍持槍(rest,槍口朝前下)→
 *  據槍(aim,槍口水平朝前)」,疊後座上跳(−kick)與蓄力反向(+chg×hv.gun:蓄力下壓、擊發上跳)。
 *  aim 角由 models.js 依「1.57 − 手臂射姿總俯仰」解算 —— 據槍時槍口 MUST 朝前,不是朝天。 */
function gunPitch(gp, aimF, kick, chg, hv) {
  if (!gp) return;
  gp.g.rotation.x = gp.rest + (gp.aim - gp.rest) * aimF - kick * 0.14 + chg * (hv.gun ?? 0.05) * aimF;
}

// ── 運動性格 moveSig(models.js MOVE_SIG 依角色 id 掛在 rig 上)──────────────────
// 把「靜止/加速/減速」三相位依真實運動員/軍種/生物飛行原型差異化(奔跑/飛行穩態早已差異化,不動)。
// 每個旋鈕的預設值 = 現行通用行為 ⇒ 沒有 moveSig 的單位(NPC、未登記角色)完全不受影響。
//   地面:idleF/idleA 靜止微動的節拍/幅倍率;freeze 趨向凍結(狙擊台)、restless 額外躁動(哨兵/擊劍);
//         launch 爆發起步脈衝、spool 前傾遲滯(柴油機起轉)、brake 插地壓頭煞停、settle 回穩阻尼倍率。
//   飛行:hover 懸停站位抖動、hoverA 懸停浮沉幅倍率、hoverF 節拍倍率;
//         surge 暴衝俐落度、flare 揚翼張爪煞停(定翼/噴射恆 0)、bank 入彎壓坡積極度。
const S0 = {};
const gsig = (rig) => {
  const s = rig.moveSig || S0;
  // poise 與 idleA 是兩條獨立軸:重裝巨人「腳步不換(高 poise)卻胸腔深呼吸(高 idleA)」——不可混為一談。
  const poise = s.poise ?? 0.5;
  const freeze = Math.max(0, poise - 0.5) * 2, restless = Math.max(0, 0.5 - poise) * 2;
  return {
    iF: s.idleF ?? 1,
    idleK: (1 - 0.9 * freeze) * (1 + 1.2 * restless),   // 重心交換/擺頭巡視的活躍度(狙擊近凍、哨兵/擊劍躁動)
    breathK: s.idleA ?? 1,                               // 呼吸/液壓微顫的深淺(重裝深沉、狙擊淺)
    launch: s.launch ?? 0, spool: s.spool ?? 0, brake: s.brake ?? 0,
    settle: s.settle ?? 1,
  };
};
const fsig = (rig) => {
  const s = rig.moveSig || S0;
  return {
    hover: s.hover ?? 0, hoverF: s.hoverF ?? 1, hoverA: s.hoverA ?? 1,
    surge: s.surge ?? 0, flare: s.flare ?? 0, bank: s.bank ?? 1,
  };
};

/**
 * 凝視穩定(所有會走路的機種共用):頭/頸反轉抵銷骨盆 + 胸腔的旋轉 —— 軀幹再怎麼起伏扭轉,
 * 頭維持水平前視。真獸/真人跑步時頭幾乎不晃(前庭反射),頭跟著軀幹一起甩才是壞掉的布娃娃。
 * 抵銷率 < 1(留一點殘留晃動 = 有慣性的機械頭,不是陀螺儀);靜止時疊上緩慢的警戒掃視。
 * @param acc [x,y,z] 上游(骨盆+胸腔+脊椎…)的累計旋轉
 */
function stabilizeHead(rig, acc, idle, now, k = 0.85, scanK = 1) {
  const neck = rig.neck, head = rig.head;
  if (!head) return;
  // 頸先吃掉一半(頸是柔軟的緩衝段),剩下的由頭補完 —— 兩段分攤比單段硬轉自然
  const kn = neck ? 0.45 : 0;
  if (neck) {
    neck.rotation.x = -acc[0] * k * kn;
    neck.rotation.y = -acc[1] * k * kn;
    neck.rotation.z = -acc[2] * k * kn;
  }
  head.rotation.x = -acc[0] * k * (1 - kn);
  head.rotation.y = -acc[1] * k * (1 - kn) + idle * Math.sin(now * 0.5) * 0.28 * scanK;   // 靜止:緩慢掃視(scanK 依性格:哨兵頻掃、狙擊近凍)
  head.rotation.z = -acc[2] * k * (1 - kn);
}

/**
 * 頭部畫弧補償(四足獸專用):脊椎/胸的俯仰角 θ 落在長度 L 的頸力臂上 → 頭部產生 ≈ L·θ 的
 * 上下位移(小角度近似)。把這段從頸的高度扣回去,頭就不再隨每一步畫大弧。
 * 只補償「旋轉造成的」那一段,彈跳另外補 —— 兩者來源不同,混在一起調不動。
 */
function headArc(rig, k, spinePitch = rig.spine.rotation.x) {
  return ((spinePitch + rig.chest.rotation.x) * (rig.headArm || 0)
    + rig.neck.rotation.x * (rig.headArmN || 0)) * k;
}

/**
 * 腿與骨盆同層(非骨盆子節點)的雙足機種:骨盆的縱向位移(跳奔/袋鼠跳的騰空)必須帶著腿一起升降,
 * 否則身體躍起、雙腿留在原地 = 分離。腿的靜姿高度只抓一次(loco 快取),之後套用骨盆相對 hipsY0 的位移。
 * 腿本是骨盆子節點者自動跟隨,直接跳過。
 */
function syncLegsToHips(L, rig, hips) {
  if (!rig.legL || rig.legL.parent === rig.hips) return;
  if (L.legYL == null) { L.legYL = rig.legL.position.y; L.legYR = rig.legR.position.y; }
  const dy = hips.position.y - rig.hipsY0;
  rig.legL.position.y = L.legYL + dy;
  rig.legR.position.y = L.legYR + dy;
}

/**
 * 多節尾配重(mobility_plan Task 2.2):急轉時整條尾甩向轉向反側(角動量守恆的視覺化),
 * 尾梢逐節延遲 = 鞭;行進間再疊一道與步頻同調的擺動。基礎姿勢住幾何,這裡直接寫 rotation。
 */
function whipTail(segs, L, dt, a, idle, now, yawRate, base = 0) {
  L.tail = damp(L.tail ?? 0, clamp(-yawRate * 0.3, -0.55, 0.55), 3.5, dt);
  segs.forEach((t, i) => {
    const d = i * 0.6;                       // 逐節相位延遲(由根往梢傳的波)
    const lag = 1 + i * 0.35;                // 尾梢甩幅大於尾根
    t.rotation.y = L.tail * lag + Math.sin(L.ph - d) * 0.1 * a;
    t.rotation.x = (i === 0 ? base : 0)
      + Math.sin(L.ph * 2 - d) * 0.07 * a + idle * Math.sin(now * 1.1 - d) * 0.03;
  });
}

/** 多節蠕動波(觸手/軟肢):正負皆可(不是只朝一邊折的關節),節節延遲 = 由根往梢傳的波 */
function undulate(chain, ph, amp) {
  for (const j of chain) j.g.rotation.x = j.base + j.k * Math.sin(ph - j.d) * amp;
}

/**
 * 觸手步行肢(章魚腿):支撐相是推進的行進波;擺動相(離地的那半週期)不再只是波的延續 ——
 * 整條觸手抬離地面、根節上抬、梢節回勾成 S 形,梢端再疊快速小顫 = 「搜索/蓄勢待發」的觸手,
 * 落地前才伸直探地。未觸地的觸手看起來是活著在找東西,不是一段均勻的正弦。
 */
function softLeg(chain, ph, amp, now, quest) {
  const sw = Math.max(0, -Math.cos(ph));           // 擺動相(離地)
  const n = chain.length || 1;
  for (let i = 0; i < n; i++) {
    const j = chain[i];
    const t = i / Math.max(1, n - 1);
    j.g.rotation.x = j.base + j.k * (Math.sin(ph - j.d) * amp
      - sw * quest * Math.cos(t * Math.PI) * 2.4    // S 形蓄勢:根節上抬、梢節回勾
      + sw * quest * Math.sin(now * 6 - j.d * 2.2) * 1.1 * t);   // 梢節快顫(探索)
  }
}

/**
 * 持武觸手的警戒動態(眼鏡蛇預備式):整條收成蓄勢的 S 形(根節後仰、梢節前勾),
 * 蓄勢量各觸手錯拍緩慢起伏(像在挑目標),其上疊慢速搜索掃擺 + 梢節快顫 + 隨步伐的微擺。
 * 末節不進 chain(武器要穩),所以怎麼甩槍口都不亂。
 */
function tentGuard(chain, now, k, ph, a) {
  const cock = 0.55 + 0.3 * Math.sin(now * 0.4 + k * 1.7);   // 蓄勢量(各觸手錯拍)
  const n = chain.length || 1;
  for (let i = 0; i < n; i++) {
    const j = chain[i];
    const t = i / Math.max(1, n - 1);
    j.g.rotation.x = j.base
      - Math.cos(t * Math.PI) * 0.4 * cock                    // S 形:根後仰、梢前勾
      + Math.sin(now * 0.9 - j.d + k * 2.1) * 0.12            // 慢速搜索掃擺
      + Math.sin(now * 7 - j.d * 3) * 0.06 * t * t            // 梢節快顫(蓄勢待發)
      + Math.sin(ph - j.d) * 0.12 * a;                        // 行進時隨步伐微擺
  }
}

/** 雙足步態:步頻耦合位移 + 重心側移 + 前傾 + 手臂反相 + 膝/肘分節 + 胸腔對轉 + 凝視穩定 + 尾配重。
 *  短腿機種(rig.bound,猩猩)高速漸變為「後腿併蹬、雙臂前撐」的跳奔 —— 步頻不再上飆,
 *  改拉大騰空與跨距(短腿硬刷步頻 = 整具機體高頻顫抖,這正是要消滅的);
 *  袋鼠(rig.hop)整套改走 stepHop 跳躍步態。 */
function stepBiped(L, rig, dt, now, speed, yawRate) {
  if (rig.hop) return stepHop(L, rig, dt, now, speed, yawRate);
  const strideW = (rig.stride || 0.9) * (rig.s || 1);   // 一步的世界長度
  L.ph += speed * dt * Math.PI / Math.max(0.2, strideW);
  L.amp = damp(L.amp, clamp(speed / (rig.top || 8), 0, 1.2), 6, dt);
  const a = L.amp;
  const idle = idleOf(a);
  const sg = gsig(rig);
  // 加速爆發脈衝(launch:短跑/擊劍/彈跳者先沉再彈射)+ 減速插地(brake:急停運動員壓低重心拋錨);
  // 皆由 |L.accel| 驅動、以 settle 阻尼快落 —— 重裝 launch/brake≈0,改吃 spool 的前傾遲滯
  L.srg = damp(L.srg ?? 0, accUp(L) * sg.launch, 10 * sg.settle, dt);
  L.brk = damp(L.brk ?? 0, accDn(L) * sg.brake, 9 * sg.settle, dt);
  // 跳奔混成度:0 = 交替步,1 = 雙腿同相併蹬;左右相位差 π→0 連續縮短,步態不瞬跳
  const bnd = (rig.bound || 0) * clamp((a - 0.55) / 0.4, 0, 1);
  const phL = L.ph, phR = L.ph + Math.PI * (1 - bnd);
  const sw = Math.sin(L.ph);
  // 奔跑度:速度過半後跨距/收腿全面放大 —— 走路與奔跑是兩種姿態,不是同一組角度放大音量。
  // 擺幅係數配合拉大的 stride(大步幅 = 低步頻):寧可一步跨遠,不要高頻小碎步的整機顫抖
  const runF = clamp((a - 0.5) / 0.5, 0, 1);
  const legA = 0.62 * a * (1 + 0.45 * runF);
  const legB = rig.legBase || 0, armB = rig.armBase || 0;   // 原型站姿(拱背/負重機體的靜態屈角)
  // 靜止待機:雙腿以極慢的反相重心交換微擺(左右換腳站),不是完全定格;
  // idleK 依性格縮放(狙擊台近凍結、哨兵/擊劍手躁動放大),iF 調節拍
  const stand = idle * sg.idleK * Math.sin(now * 0.9 * sg.iF + L.ph) * 0.03;
  rig.legL.rotation.x = legB + Math.sin(phL) * legA + stand;
  rig.legR.rotation.x = legB + Math.sin(phR) * legA - stand;
  // 手臂與腿反相(follow-through);跳奔時雙臂轉為同相前撐(前肢落在後腿併蹬的半拍後 =
  // 四足跳奔的節奏);持械手平時擺幅收斂穩住槍口,跳奔時它就是前腳,也得撐地
  const oAL = Math.PI, oAR = Math.PI * bnd;
  if (rig.tuckArms) {
    // 前肢收起蓄勢(迅猛龍/鴕鳥翼):不隨步伐甩大臂,收在體前 —— 奔跑越快收得越緊,
    // 只留與步頻同調的微幅開合與待機顫動 = 隨時能出爪/展翼的預備式
    const tk = armB - 0.2 * a;
    rig.armL.rotation.x = tk + Math.sin(L.ph * 2) * 0.035 * a + idle * Math.sin(now * 1.3) * 0.02;
    rig.armR.rotation.x = tk + Math.sin(L.ph * 2 + 0.5) * 0.035 * a + idle * Math.sin(now * 1.3 + 0.6) * 0.02;
  } else if (rig.tinyArms) {
    // 退化短前臂(暴龍):奔跑中幾乎不參與步態,只做抓握狀微顫,MUST NOT 套用一般雙足
    // 對側擺臂公式(那是給會前後甩動的手臂用的,暴龍的短前臂始終深屈在胸前)
    rig.armL.rotation.x = armB + Math.sin(L.ph * 2) * 0.05 * a + idle * Math.sin(now * 1.3) * 0.02;
    rig.armR.rotation.x = armB + Math.sin(L.ph * 2 + 0.5) * 0.05 * a + idle * Math.sin(now * 1.3 + 0.6) * 0.02;
  } else {
    // 指節/掌行(rig.knuckle,猩猩):前肢就是前腳 —— 擺幅與腿同級、對角相位真的撐地
    const kn = rig.knuckle ? 1.0 : 0.75;
    rig.armL.rotation.x = armB + Math.sin(L.ph + oAL) * legA * (kn + bnd * 0.3)
      + idle * Math.sin(now * 1.3) * 0.025;
    rig.armR.rotation.x = armB + Math.sin(L.ph + oAR) * legA
      * (rig.gunArm ? 0.25 + bnd * 0.55 : kn + bnd * 0.3)
      + idle * Math.sin(now * 1.3 + 0.6) * (rig.gunArm ? 0.008 : 0.025);   // 持械手待機也穩住槍口
  }
  // 膝→踝、肘→腕:分節鏈(有掛才跑;舊的單節機體照舊只擺髖/肩)
  if (rig.legChainL) {
    // 腿:擺動收腿 + 支撐彈簧(flexChain 內建);奔跑時整體再放大
    const la = a * (1 + 0.25 * runF);
    flexChain(rig.legChainL, phL, la, idle, now);
    flexChain(rig.legChainR, phR, la, idle, now + 1.9);
    if (rig.tuckArms) {
      // 收起的前肢:肘/腕鎖在深屈蓄勢角(hold ∝ 速度),只留待機微顫 —— 不是凍結
      flexChain(rig.armChainL, L.ph, a * 0.1, idle, now + 0.7, 0.1, 0.35 * a);
      flexChain(rig.armChainR, L.ph + 0.4, a * 0.1, idle, now + 2.6, 0.1, 0.35 * a);
    } else if (rig.tinyArms) {
      // 退化短前臂(暴龍):肘/腕只做微幅抓握顫動,不做人形的恆屈泵動或大幅擺盪
      flexChain(rig.armChainL, L.ph, a * 0.15, idle, now + 0.7, 0.15, 0.15 * a);
      flexChain(rig.armChainR, L.ph + 0.4, a * 0.15, idle, now + 2.6, 0.15, 0.15 * a);
    } else if (rig.knuckle) {
      // 指節行走的前肢是承重腿:支撐相吃載荷彈簧(load 同腿),不做人形的恆屈泵動
      flexChain(rig.armChainL, L.ph + oAL, a * 1.05, idle, now + 0.7, 0.4, 0.12 * runF);
      flexChain(rig.armChainR, L.ph + oAR, a * 1.05, idle, now + 2.6, 0.4, 0.12 * runF);
    } else {
      // 臂:奔跑的手肘是「恆屈 + 前後泵動」,不是甩直的鐘擺(hold 隨奔跑度增加);
      // 持械側 hold 收斂(端槍的手肘本來就鎖著托槍)
      flexChain(rig.armChainL, L.ph + oAL, a, idle, now + 0.7, 0.15, 0.5 * runF);
      flexChain(rig.armChainR, L.ph + oAR, a * (rig.gunArm ? 0.45 + bnd * 0.55 : 1),
        idle * (rig.gunArm ? 0.3 : 1), now + 2.6, 0.15, (rig.gunArm ? 0.2 : 0.5) * runF);
    }
  }
  // 手持武器射擊姿勢(雙手托一把 / 雙槍 / 單手槍,由 aimPose 欄位有無決定):
  // 靜止(交戰)或開火保持(rig._aim)= 標準射擊姿勢 —— 移動中開火也舉槍,步態擺臂讓位;
  // 未開火的移動 = 交還步態擺臂(行軍持槍)。連續混成 → 停下/開火自然舉槍、起步自然放下。
  const aimF = Math.min(1, idle + (rig._aim || 0));
  if (rig.aimPose) {
    const ap = rig.aimPose;
    rig.armR.rotation.x += (ap.rShoulderX - rig.armR.rotation.x) * aimF;
    if (rig.armChainR && rig.armChainR[0])
      rig.armChainR[0].g.rotation.x += (ap.rElbowX - rig.armChainR[0].g.rotation.x) * aimF;
    if (ap.lShoulderX != null) {   // 單手槍機種不給左臂欄位 → 左臂交還步態(自由)
      rig.armL.rotation.x += (ap.lShoulderX - rig.armL.rotation.x) * aimF;
      rig.armL.rotation.y = (ap.lShoulderY || 0) * aimF;   // 左臂朝中線內收扶護木(移動時歸零)
      if (rig.armChainL && rig.armChainL[0])
        rig.armChainL[0].g.rotation.x += (ap.lElbowX - rig.armChainL[0].g.rotation.x) * aimF;
    }
  }
  // 後座/蓄力(登記 rig.weap 的持武機種):後座 = 持械肩上抬 + 肘回折(左右手各自吃自己的脈衝);
  // 蓄力/擊發走 rig.hvy 的帶符號幅度(brace 正值 = 蓄力托壓/擊發上跳;punch 正值 = 蓄力後拉/擊發前突)
  const kL = rig._kickL || 0, kR = rig._kickR || 0, chg = rig._chg || 0, hv = rig.hvy || S0;
  if (rig.weap) {
    rig.armR.rotation.x += -kR * 0.15 + chg * (hv.armR || 0);
    rig.armL.rotation.x += -kL * 0.15 + chg * (hv.armL || 0);
    if (rig.armChainR && rig.armChainR[0]) rig.armChainR[0].g.rotation.x -= kR * 0.1;
    if (rig.armChainL && rig.armChainL[0]) rig.armChainL[0].g.rotation.x -= kL * 0.1;
  }
  gunPitch(rig.gunR, aimF, kR, chg, hv);
  gunPitch(rig.gunL, aimF, kL, chg, hv);
  const hips = rig.hips;
  // 骨盆:交替步一週期兩次浮沉(雙支撐最高、單支撐最低)+ 重心側移到支撐腿;
  // 跳奔漸變為「一跳一大浮沉」的騰空拋物線,側移/扭腰同步歸零(併蹬沒有左右換腳)。
  // grounded running(鴕鳥/迅猛龍):沒有騰空相的跑 —— 速度越快浮沉反而收斂,
  // 上下起伏被長腿的屈伸吃掉,軀幹像懸浮著平移(鴕鳥的招牌)
  const bobF = rig.grounded ? 1 - 0.55 * runF : 1;
  hips.position.y = rig.hipsY0 - (0.5 - 0.5 * Math.cos(L.ph * 2)) * (rig.bob || 0.06) * a * (1 - bnd) * bobF
    + Math.sin(L.ph) * (rig.bob || 0.06) * 2.2 * a * bnd
    + idle * sg.breathK * Math.sin(now * 1.7 * sg.iF + L.ph) * 0.012   // 靜止呼吸微沉浮(性格化:狼/豹極淺、重裝深沉)
    - L.srg * 0.03 - L.brk * 0.025;   // 爆發起步下蹲驅離 / 急停壓低重心插地
  hips.position.x = sw * (rig.sway || 0.05) * a * (1 - bnd);
  hips.rotation.z = -sw * 0.07 * a * (1 - bnd);
  hips.rotation.y = -sw * 0.1 * a * (1 - bnd);    // 骨盆對轉(自然扭腰)
  // 前傾:速度越快越前壓;加減速再疊預備/回穩傾角;跳奔再多壓一段(衝刺的撲身)。
  // leanF 依體軸而定(人形 1.0;水平體軸的獸型 0.3~0.5 —— 牠們用抬尾配平,不是把頭壓向地面)
  L.lean = damp(L.lean, (0.22 * a + bnd * 0.14 + clamp(L.accel * 0.015, -0.1, 0.15)) * (rig.leanF ?? 1),
    5 * (1 - 0.6 * sg.spool), dt);   // spool:重裝前傾遲滯(慢阻尼 = 柴油機起轉,傾角落後於速度)
  // launch 撲身前衝 / brake 後仰拋錨煞停:× leanF —— 直立機甲全幅俯衝,水平體軸獸型(鴕鳥/暴龍)
  // 幾乎不再壓脊(牠們本來就近水平,再前傾就變臉朝地);垂直下蹲(hips.position.y)照舊保留給所有機種
  hips.rotation.x = L.lean + (L.srg * 0.07 - L.brk * 0.08) * (rig.leanF ?? 1);
  // 胸腔:與骨盆對轉(走路時肩線與髖線反向扭 = 上下半身的角動量互抵)+ 呼吸擴張
  const chest = rig.chest;
  if (chest) {
    chest.rotation.y = -hips.rotation.y * 0.9;
    chest.rotation.z = -hips.rotation.z * 0.55;
    // + 蓄力/擊發的軀幹搖(brace:蓄力前傾抵肩、擊發後仰)與後座震(每發胸腔往後震一下);
    //   機載武器(weap 'N':嘴砲/背砲/腕砲)的後座走 _kickB,同樣打進胸腔;
    //   進 stabilizeHead 的 acc → 頭補償 85%,殘留 15% = 開火的衝擊感
    chest.rotation.x = 0.06 * a + idle * sg.breathK * Math.sin(now * 1.5 * sg.iF) * 0.02
      + chg * (hv.chest || 0) - (Math.max(kL, kR) + (rig._kickB || 0)) * 0.06;
  }
  // 頭把骨盆的縱向彈跳吸掉一半(頸/頭自己往回撐)⇒ 頭的上下位移收斂,不隨每一步上下彈
  if (rig.headY0 != null) rig.head.position.y = rig.headY0 + (rig.hipsY0 - hips.position.y) * 0.5;
  // 頭/頸:反轉抵銷骨盆 + 胸腔 ⇒ 跑起來軀幹在扭,頭卻穩穩鎖住前方;再疊入彎凝視(看向轉向)
  stabilizeHead(rig, [
    hips.rotation.x + (chest ? chest.rotation.x : 0),
    hips.rotation.y + (chest ? chest.rotation.y : 0),
    hips.rotation.z + (chest ? chest.rotation.z : 0),
  ], idle, now, 0.85, sg.idleK);   // scanK = idleK:哨兵頻掃視、狙擊台近凍結
  L.gaze = damp(L.gaze ?? 0, clamp(yawRate * 0.28, -0.45, 0.45), 3, dt);
  if (rig.head) rig.head.rotation.y += L.gaze;   // 無頭 rig 的簡易單位(如步兵)跳過凝視
  if (rig.tailSegs) {
    whipTail(rig.tailSegs, L, dt, a, idle, now, yawRate);
    // 抬尾配平:速度越快尾根抬得越高(暴龍/鴕鳥/袋鼠的重尾就是前傾的反向配重)
    rig.tailSegs[0].rotation.x += (rig.tailUp || 0) * a;
  }
}

/**
 * 袋鼠跳(rig.hop):雙腿同相蹲伸、騰空拋物線、體軸前傾近水平、重尾反相甩動配平(第三條腿)。
 * 週期定義:ph = 0 蹬離(腿全伸向後、身體開始上升)→ π 落地(腿收向前準備觸地)→
 * 2π 回到蹬離 —— 騰空佔 sin > 0 的半週期、觸地壓縮佔 sin < 0 的半週期。
 * 步頻 = 位移 / 單跳距離(stride = 一跳的世界長度):腿短照樣高速 —— 拉大騰空,不狂刷步頻。
 */
function stepHop(L, rig, dt, now, speed, yawRate) {
  const hopW = (rig.stride || 2.4) * (rig.s || 1);
  L.ph += speed * dt * Math.PI * 2 / Math.max(0.3, hopW);
  L.amp = damp(L.amp, clamp(speed / (rig.top || 10), 0, 1.15), 6, dt);
  const a = L.amp;
  const idle = idleOf(a);
  const sg = gsig(rig);
  L.srg = damp(L.srg ?? 0, accUp(L) * sg.launch, 10 * sg.settle, dt);
  L.brk = damp(L.brk ?? 0, accDn(L) * sg.brake, 9 * sg.settle, dt);
  const air = Math.max(0, Math.sin(L.ph));       // 騰空(身體升起;觸地半週期 air=0 = 停在基準線,腳貼地)
  const legB = rig.legBase || 0, armB = rig.armBase || 0;
  // 雙腿同相:蹬離時全伸向後(cos=+1)、騰空前收準備落地(cos→−1);
  // 左右留 4% 振幅差 = 活體的不對稱,不是兩根同步的活塞
  const drive = Math.cos(L.ph) * 0.55 * a;
  const stand = idle * Math.sin(now * 0.9) * 0.03;
  rig.legL.rotation.x = legB + drive + stand;
  rig.legR.rotation.x = legB + drive * 0.96 - stand;
  if (rig.legChainL) {
    // 分節:落地前收腿深屈(脛/蹠摺起吸震)、觸地蹬伸打直;flexChain 峰值恰在 ph ≈ π(觸地)
    flexChain(rig.legChainL, L.ph, a * 1.15, idle, now);
    flexChain(rig.legChainR, L.ph + 0.12, a * 1.15, idle, now + 1.9);
    // 拳砲雙臂收在胸前的拳擊架式:只隨跳動微幅開合,不甩大臂
    flexChain(rig.armChainL, L.ph, a * 0.2, idle * 0.3, now + 0.7);
    flexChain(rig.armChainR, L.ph, a * 0.2, idle * 0.3, now + 2.6);
  }
  rig.armL.rotation.x = armB + air * 0.12 * a + idle * Math.sin(now * 1.3) * 0.02;
  rig.armR.rotation.x = armB + air * 0.12 * a + idle * Math.sin(now * 1.3 + 0.6) * 0.008;
  // 拳砲戰鬥動畫(袋鼠 punch 原型,hv.armR 為正):蓄力 = 右拳向後收滿(chg→+1 的大幅後拉蓄勢),
  // 擊發 = chg 瞬間翻負 → 直拳全幅前突;輕武器(左腕槍)開火 = 左臂小幅後座
  const kL = rig._kickL || 0, kR = rig._kickR || 0, chg = rig._chg || 0, hv = rig.hvy || S0;
  if (rig.weap) {
    rig.armR.rotation.x += -kR * 0.15 + chg * (hv.armR || 0);
    rig.armL.rotation.x += -kL * 0.15 + chg * (hv.armL || 0);
  }
  const hips = rig.hips;
  // 一跳一沉浮:騰空拋物線 + 觸地壓縮(不是交替步的一週期兩浮沉);無左右側移/扭腰
  // 只向上騰空、不讓骨盆沉到基準線以下 —— 腿隨骨盆升降(syncLegsToHips),骨盆一旦下沉就會把腳帶穿地面;
  // 蓄力/壓縮改由腿部屈曲(flexChain 在觸地相自然收腿)表現,不靠骨盆下沉
  hips.position.y = rig.hipsY0 + air * (rig.hopH || 0.5) * a
    + idle * sg.breathK * Math.sin(now * 1.7 * sg.iF) * 0.012;
  hips.position.x = 0;
  syncLegsToHips(L, rig, hips);   // 袋鼠跳:雙腿隨骨盆騰空,不留在地面
  hips.rotation.z = 0;
  hips.rotation.y = 0;
  // 體軸前傾近水平(hopLean):速度越快壓得越平,靜止時回到直立;
  // 再疊每跳的俯仰律動 —— 蹬離時揚起、落地前俯衝(拋物線的切線方向)
  L.lean = damp(L.lean, (rig.hopLean || 0.85) * a + clamp(L.accel * 0.012, -0.08, 0.12),
    5 * (1 - 0.6 * sg.spool), dt);
  hips.rotation.x = L.lean + Math.cos(L.ph + 0.5) * 0.1 * a + (L.srg * 0.06 - L.brk * 0.07) * (rig.leanF ?? 0.5);   // 袋鼠近水平體軸:俯衝量收斂
  const chest = rig.chest;
  if (chest) {
    chest.rotation.y = 0;
    chest.rotation.z = 0;
    // 拳砲的軀幹配合(hv.chest 為負 = punch 原型):蓄力微後仰蓄勢、擊發前傾灌拳(follow-through)
    chest.rotation.x = 0.05 * a + idle * sg.breathK * Math.sin(now * 1.5 * sg.iF) * 0.02
      + chg * (hv.chest || 0) - Math.max(kL, kR) * 0.05;
  }
  if (rig.headY0 != null) rig.head.position.y = rig.headY0 + Math.max(0, rig.hipsY0 - hips.position.y) * 0.5;
  // 體軸壓平了,頭照樣抬起鎖平前方(袋鼠跳起來頭是穩的)+ 入彎凝視
  stabilizeHead(rig, [
    hips.rotation.x + (chest ? chest.rotation.x : 0), 0, 0,
  ], idle, now, 0.9, sg.idleK);
  L.gaze = damp(L.gaze ?? 0, clamp(yawRate * 0.28, -0.45, 0.45), 3, dt);
  if (rig.head) rig.head.rotation.y += L.gaze;   // 同 stepBiped:無頭 rig 跳過凝視
  // 尾 = 第三條腿的水平配重桿:體軸前傾(hips.rotation.x)已把尾根整段抬到近水平後伸,
  // 這裡「只」疊每跳的前後擺(騰空尾壓下、蹬離尾抬起 = 角動量互抵),逐節相位延遲成鞭。
  // MUST NOT 再加持續上翹偏置(舊的 (rig.tailUp||0.2) 逐節累積 → 尾巴整條捲上天,使用者指正)
  if (rig.tailSegs) {
    whipTail(rig.tailSegs, L, dt, a, idle, now, yawRate);
    // 尾巴是「近水平的配重桿」:體軸壓成 ~49° 前傾俯衝時,尾若僵硬跟著鼓上去就成了「上翹」——
    // 尾根反向抵銷大部分體軸前傾 → 尾維持後伸近水平(真袋鼠尾在奔跳時幾乎與地面平行);
    // 只疊小幅上下配重擺(逐節 ×3 會累積,故壓小),尾梢略放大保留鞭感
    rig.tailSegs.forEach((t, i) => {
      const counter = i === 0 ? -hips.rotation.x * 0.7 : 0;
      t.rotation.x += counter - Math.sin(L.ph - i * 0.55) * (0.1 + i * 0.03) * a;
    });
  }
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
function stepAerial(L, rig, dt, now, vFwd, vLat, yawRate) {
  const top = rig.top || 20;
  const fs = fsig(rig);
  const spd = Math.hypot(vFwd, vLat);
  // surge:暴衝俐落度 → 加快壓坡/俯仰的阻尼響應(競速/噴射急甩、長航偵察/重載遲鈍);bank:入彎壓坡積極度
  const airK = 4.5 * (1 + fs.surge);
  // 向右橫移(vLat>0)→ 右側(局部 +x)下壓 = rotation.z 負
  L.roll = damp(L.roll, clamp(-vLat / top, -1, 1) * 0.26 * fs.bank, airK, dt);
  // 前傾只屬於旋翼/撲翼(靠傾轉產生前向推力);定翼機(rig.level)推力來自引擎,
  // 巡航機身保持水平 —— MUST NOT 跟著速度低頭(壓坡入彎照舊)
  L.pitch = damp(L.pitch, rig.level ? 0
    : clamp(vFwd / top, -1, 1) * 0.2 + clamp(L.accel * 0.006, -0.07, 0.07), airK, dt);
  // flare:減速時揚翼張爪煞停、機鼻上仰(鷹/翼龍/龍/蜂);定翼(rig.level)spec flare 恆 0 ⇒ 不揚頭(MUST)
  L.flr = damp(L.flr ?? 0, accDn(L) * fs.flare, 6, dt);
  rig.tilt.rotation.z = L.roll;
  rig.tilt.rotation.x = L.pitch - L.flr * 0.14;
  // 懸停站位抖動(hover:蜂/競速高頻定點修正、長航偵察/共軸運補死穩);浮沉幅 ∝ hoverA(活翼大、機械旋翼/定翼≈0)
  const hovK = clamp(1 - spd / 3, 0, 1) * fs.hover;
  rig.tilt.rotation.x += Math.sin(now * 7 * fs.hoverF) * 0.014 * hovK;
  rig.tilt.rotation.z += Math.sin(now * 6.1 * fs.hoverF + 1.1) * 0.016 * hovK;
  rig.tilt.position.y = (rig.tiltY0 || 0) + Math.sin(now * 2.2 * fs.hoverF + L.ph) * (rig.bob || 0.08) * fs.hoverA;
  // 機載武器開火反應(stepCombatFx 驅動場):每發後座機鼻上仰脈衝、蓄力機鼻微壓沉住
  // (擊發瞬間 chg 翻負 = 與蓄力反向的上揚釋放)—— 幅度小,飛行姿態穩定為主
  const aKick = rig._kickB || 0, aChg = rig._chg || 0;
  if (aKick > 0.01 || Math.abs(aChg) > 0.01) {
    rig.tilt.rotation.x += -aKick * 0.05 + aChg * (rig.hvy?.chest ?? 0.03);
    if (aChg > 0) rig.tilt.position.y -= aChg * 0.05;   // 蓄力微沉(壓向目標的預備)
  }
  // 噴射尾焰(定翼 jet 機種):推力 ∝ 速度 —— 焰長/亮度隨速度拉長增亮 + 高頻抖焰,
  // 懸停/慢速幾乎熄火(噴射機的推力視覺全在尾焰)
  if (rig.jets) {
    const k = clamp(Math.hypot(vFwd, vLat) / (rig.top || 30), 0, 1);
    rig.jets.forEach((j, i) => {
      j.g.visible = k > 0.03;
      const flick = 1 + Math.sin(now * 31 + i * 2.1 + L.ph) * 0.1;
      j.g.scale.set(1, (0.35 + 1.5 * k) * flick, 1);
      j.m1.opacity = (0.2 + 0.4 * k) * flick;
      j.m2.opacity = 0.4 + 0.5 * k;
      j.m1.emissiveIntensity = 1.2 + 2.2 * k;
    });
  }
  if (rig.wings) {
    const k = clamp(Math.hypot(vFwd, vLat) / top, 0, 1);
    if (rig.insect) {
      // 昆蟲震翅:頻率遠高於鳥類(懸停時也全速振,不靠前進速度產生升力),
      // 行程平面近水平 —— 上下拍幅小,主運動是「前後掃掠 + 每半衝程翼面翻轉」的 8 字軌跡;
      // 後翅相位落後前翅(蜂類前後翅耦合但非同相)。
      L.flap = (L.flap || 0) + dt * (30 + k * 16);
      const amp = 0.3 + k * 0.12 + L.flr * 0.3;   // flare:進場杯翼倒拍(蜂)
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
      const amp = 0.24 + k * 0.34 + L.flr * 0.5;   // flare:拉起收翼杯狀煞停(鷹/翼龍/龍)
      for (const { w, outer, sgn } of rig.wings) {
        w.rotation.z = sgn * Math.sin(L.flap + L.ph) * amp;
        outer.rotation.z = sgn * Math.sin(L.flap + L.ph - 0.7) * amp * 1.5;
      }
    }
  }
  // 長重尾配重舵面(僅少數重尾機種掛 rig.tailSegs,如機械龍):whipTail 依轉向角速度甩向
  // 反側 + 逐節延遲,同地面/變形單位共用的機制 —— 飛行單位沒有步態振幅,改用巡航速度
  // 佔頂速的比例當 whipTail 的 a
  if (rig.tailSegs) {
    const aT = clamp(Math.hypot(vFwd, vLat) / (rig.top || 30), 0, 1);
    whipTail(rig.tailSegs, L, dt, aT, idleOf(aT), now, yawRate);
  }
}

/** 四足獸型:各生物專屬步態(rig.gait)+ 脊椎波傳導 + 尾巴配重(Task 2.2)。
 *  'trot'(犬/馬):對角腿同相,高速趨近 gallop 縱向彈跳;
 *  'walk'(劍龍等重型獸):側步序列四拍慢步 LH→LF→RH→RF,永遠三腳著地、不騰空,
 *    加速表現在步幅與體側搖擺(rig.rollSway),不在彈跳 —— 大象/劍龍不會小跑;
 *  'crawl'(章魚):四觸手輪替的行進波,一波接一波把身體拖著走(軟體動物沒有小跑),
 *    外套膜隨波緩慢蛇擺。 */
function stepQuad(L, rig, dt, now, speed, yawRate) {
  const strideW = (rig.stride || 1.4) * (rig.s || 1);
  L.ph += speed * dt * Math.PI / Math.max(0.25, strideW);   // 步頻嚴格耦合位移(不滑步)
  L.amp = damp(L.amp, clamp(speed / (rig.top || 10), 0, 1.15), 6, dt);
  const a = L.amp;
  const G = rig.gait || 'trot';
  const ROT = rig.gallopType === 'rotary';
  let phFL, phFR, phHL, phHR, gallop = 0;
  if (G === 'walk') {
    // 側步序列(lateral sequence):同側後腳先動、前腳跟進,左右各差半週期。
    // Speedwalk(大象/劍龍):加速永遠停在這個序列上 —— 步幅與體側搖擺放大,不換小跑
    phHL = L.ph; phFL = L.ph - Math.PI * 0.5;
    phHR = L.ph + Math.PI; phFR = L.ph + Math.PI * 0.5;
  } else if (G === 'crawl') {
    // 觸手輪:FL → HR → FR → HL 逐一推進(相鄰觸手相位各差 1/4 週期)
    phFL = L.ph; phHR = L.ph - Math.PI * 0.5;
    phFR = L.ph + Math.PI; phHL = L.ph + Math.PI * 0.5;
  } else {
    // trot → gallop:門檻壓低(速度 1/3 就開始換步態)。落腳序依生物原型分化(rig.gallopType):
    //  'transverse' 橫向襲步(馬/人馬):LH→RH→LF→RF 同側順序 —— 前後成對、擺程平緩,
    //    是能扛住騎乘平台的奔馳(人馬的上身要端槍);
    //  'rotary' 迴旋襲步(犬/豹):LH→RH→RF→LF 繞圈序 —— 收攏+伸展兩段騰空、脊椎屈伸最劇。
    // 相位自對角小跑「連續內插」到落腳表(偏移取與小跑相鄰的等價角,不繞遠路、不瞬跳)
    gallop = clamp((a - 0.35) / 0.35, 0, 1) * (rig.gallop ?? 1);
    const T = [0, -Math.PI, -Math.PI, 0];                       // 對角小跑 [FL, FR, HL, HR]
    const GO = ROT ? [0.6 * Math.PI, -Math.PI, -2 * Math.PI, -0.4 * Math.PI]
      : [-Math.PI, -1.4 * Math.PI, -2 * Math.PI, -0.4 * Math.PI];   // −2π × 落腳時刻
    phFL = L.ph + T[0] + (GO[0] - T[0]) * gallop;
    phFR = L.ph + T[1] + (GO[1] - T[1]) * gallop;
    phHL = L.ph + T[2] + (GO[2] - T[2]) * gallop;
    phHR = L.ph + T[3] + (GO[3] - T[3]) * gallop;
  }
  // 跨距:奔馳時前後肢伸展幅再放大 35%(gallop 的騰空伸展 = 大步距的來源)
  const legA = 0.66 * a * (1 + 0.35 * gallop) * (rig.legAmp ?? 1);
  const idle = idleOf(a);
  const sg = gsig(rig);
  // 加速前撲驅離(launch:獵犬/獵豹起跑後軀下沉爆發)+ 急停插前腳(brake:追擊-急停射擊平台);
  // idK = 待機微顫增益(半人馬狙擊台近凍結、章魚躁動不安)
  L.srg = damp(L.srg ?? 0, accUp(L) * sg.launch, 10 * sg.settle, dt);
  L.brk = damp(L.brk ?? 0, accDn(L) * sg.brake, 9 * sg.settle, dt);
  const idK = idle * sg.breathK, iF = sg.iF;   // 靜止腿部液壓微顫的深淺(idleA:重役獸深、狙擊台淺)
  // 髖/肩(第 0 節)待機微顫:即使該節沒有 chain(如觸手腿的肩基座),完全靜止時仍要有液壓微顫,
  // 不能只靠子節點(如 softLeg 的 j1-j4)動、根節本身凍結
  rig.legFL.rotation.x = Math.sin(phFL) * legA + idK * Math.sin(now * 1.6 * iF) * 0.025;
  rig.legFR.rotation.x = Math.sin(phFR) * legA + idK * Math.sin(now * 1.6 * iF + 1.5) * 0.025;
  rig.legHL.rotation.x = Math.sin(phHL) * legA * 0.9 + idK * Math.sin(now * 1.6 * iF + 3.0) * 0.025;
  rig.legHR.rotation.x = Math.sin(phHR) * legA * 0.9 + idK * Math.sin(now * 1.6 * iF + 4.5) * 0.025;
  if (rig.chFL) {
    if (rig.soft) {
      // 章魚觸手腿:支撐相是推進的行進波,擺動相整條抬起收成搜索/蓄勢的 S 形(softLeg);
      // 靜止時波仍以慢速自行爬行(軟體動物永遠在蠕動)
      const amp = 2.2 * a + 0.55 * idle;
      const drift = now * 0.7 * idle;   // 靜止時的自主蠕動波
      const quest = 0.5 * a;            // 離地探索量(隨速度:爬得越快,擺動相收得越高)
      softLeg(rig.chFL, phFL + drift, amp, now, quest);
      softLeg(rig.chFR, phFR + drift + 0.5, amp, now + 1.3, quest);
      softLeg(rig.chHL, phHL + drift + 1.0, amp, now + 2.6, quest);
      softLeg(rig.chHR, phHR + drift + 1.5, amp, now + 3.9, quest);
    } else {
      // 膝/跗/蹄的分節屈曲:擺動收腿 + 支撐彈簧壓縮(flexChain 雙相),
      // 奔馳時屈曲再放大 —— 大腿小腿/前臂後臂各自運動,不鎖成一根
      const ca = a * (1 + 0.3 * gallop);
      flexChain(rig.chFL, phFL, ca, idle, now);
      flexChain(rig.chFR, phFR, ca, idle, now + 1.4);
      flexChain(rig.chHL, phHL, ca, idle, now + 2.8);
      flexChain(rig.chHR, phHR, ca, idle, now + 4.2);
    }
  }
  // 持武觸手:未觸地的觸手不做均勻蠕動 —— 收成蓄勢 S 形、慢速搜索掃擺、梢節快顫
  // (tentGuard),靜止也在動 = 隨時要出手的東西
  if (rig.tents) rig.tents.forEach((t, i) => tentGuard(t, now, i, L.ph, a));
  // 入彎傾斜(先算:頭/尾/騎士都要抵銷它,晚一幀補償會看得出來)
  L.roll = damp(L.roll, clamp(yawRate * 0.22, -0.5, 0.5), 3.5, dt);
  // 側步慢步的體側搖擺:重心逐拍搖向支撐側(大象/劍龍的招牌搖晃,walk 專屬)
  const sway = (rig.rollSway || 0) * Math.sin(L.ph + Math.PI * 0.25) * a;
  rig.spine.rotation.z = -L.roll * 0.14 + sway;
  rig.spine.position.x = sway * 1.4;
  // 脊椎波:動力由後髖生成向前傳導(腰 → 胸 → 頸 逐節相位延遲),鞭式屈伸;
  // trot 一週期兩拍、walk/crawl 一週期一拍(慢而深的長浪)
  const wave = G === 'trot' ? L.ph * 2 : L.ph;
  // 奔馳時脊椎屈伸放大:rotary(犬/豹)的拱背-伸展是 gallop 的引擎,幅度最大;
  // transverse(馬)平緩得多;騎乘型再收斂 —— 馬背要載人端槍
  // 迴旋襲步脊椎屈伸最劇(拱背-伸展是 gallop 的引擎;犬/豹 ROT 幅度最大),橫向襲步(馬)平緩,
  // 騎乘型(人馬)再收斂但仍要看得出馬身起伏 —— 頭與槍口的穩定改由「靈活長頸/上身分節逐段吸收」保證,
  // 不再靠壓低脊椎俯仰來迴避(見下方 rider 分節鏈與非騎乘的頸主動反屈)
  const pAmp = (rig.pitchAmp ?? 0.05) * (1 + gallop * (rig.rider ? 0.55 : ROT ? 0.9 : 0.7));
  // 加速俯仰改走阻尼(spool:重型獸傾角落後於速度=柴油機起轉)+ 爆發前撲 / 急停後坐插腳
  L.qacc = damp(L.qacc ?? 0, clamp(L.accel * 0.012, -0.08, 0.1), 5 * (1 - 0.6 * sg.spool), dt);
  // 四足脊椎近水平:起步/煞停幾乎不改脊背俯仰(靠步幅、後肢驅動與垂直起伏,不把頭壓向地面);
  // 拱背-伸展仍由步態(sin(wave)·pAmp)與奔馳 gallop 主導 —— 不再疊加大幅的爆發/煞停俯衝
  const gaitPitch = Math.sin(wave) * pAmp * a;   // 純步態俯仰(頭部畫弧補償只吃這一項,不吃加減速前傾)
  rig.spine.rotation.x = gaitPitch + L.qacc + (L.srg - L.brk) * 0.02;
  rig.chest.rotation.x = Math.sin(wave - 0.7) * pAmp * a;
  // 機載武器開火反應(背砲/嘴砲/觸手莢,非騎乘):每發後座胸腔下沉後送、蓄力反向前壓抵住
  // —— 加在 chest 上,下方長頸主動反屈與頭部補償自動吃進去,射擊中頭仍鎖平
  if (!rig.rider) {
    const qHv = rig.hvy || S0;
    rig.chest.rotation.x += (rig._chg || 0) * (qHv.chest || 0)
      - Math.max(rig._kickL || 0, rig._kickR || 0, rig._kickB || 0) * 0.05;
  }
  // 章魚:外套膜隨行進波緩慢蛇擺(左右蠕行),靜止時也以極慢的幅度游動
  rig.spine.rotation.y = G === 'crawl' ? Math.sin(L.ph * 0.5) * 0.12 * a + idle * Math.sin(now * 0.6) * 0.04 : 0;
  // 縱向彈跳(gallop 越明顯;walk/crawl 幾乎貼地)+ 靜止呼吸微沉浮
  const bob = (0.5 - 0.5 * Math.cos(wave)) * (rig.bob || 0.08) * a * (1 + gallop * 0.8);
  rig.spine.position.y = rig.hipsY0 - bob + idK * Math.sin(now * 1.4 * iF + L.ph) * 0.02
    - L.srg * 0.03 - L.brk * 0.03;   // 爆發起跑蓄力 / 急停壓低重心
  if (rig.rider) {
    // 人馬:騎士骨盆「黏死」馬背(position 不動)。穩定改由「上身分節鏈逐段反向吸收」——
    // 腰(neck)→ 胸(humChest)→ 頸(humNeck)各吃一段馬軀的俯仰/滾轉,每節都看得出給彈=靈活,
    // 累計把槍口與頭鎖平;頭最後反轉抵銷殘量 = 視線絕對靜止(扣扳機那一刻)。
    // 騎士隨馬一起沉浮是真實騎乘感 —— 不做位移反抵銷(headArc 是水平長頸力臂補償,套直立人身上會亂晃)。
    const hp = rig.spine.rotation.x + rig.chest.rotation.x;   // 馬軀俯仰
    const hr = rig.spine.rotation.z;                          // 馬軀滾轉
    // 腰彎:反吃 40% + 隨步態相位的微幅給彈(奔馳越明顯給得越多)
    rig.neck.rotation.x = -hp * 0.4 + Math.sin(wave - 0.6) * 0.03 * a;
    rig.neck.rotation.z = -hr * 0.5;
    rig.neck.position.y = rig.neckY0;
    rig.neck.position.x = 0;
    // 胸再吸 40%(+ 呼吸微擺)、頸吸 15%:力由腰往上逐節遞減散開 = 分節都在動。
    // 開火戰鬥動畫(騎士雙手據槍):蓄力 = 上身前傾抵肩(brace)、擊發 = 反向後仰 + 每發後座震;
    // 加在 humChest 上 → 下方 acc 累計自動把它算進頭部補償,狙擊手的視線在後座中仍近乎鎖死
    const rkL = rig._kickL || 0, rkR = rig._kickR || 0;
    const rKick = Math.max(rkL, rkR), rChg = rig._chg || 0, rHv = rig.hvy || S0;
    if (rig.humChest) {
      rig.humChest.rotation.x = -hp * 0.4 + Math.sin(wave - 1.3) * 0.022 * a
        + idle * sg.breathK * Math.sin(now * 1.5) * 0.015
        + rChg * (rHv.chest || 0) - rKick * 0.06;
      rig.humChest.rotation.z = -hr * 0.3;
    }
    if (rig.humNeck) {
      rig.humNeck.rotation.x = -hp * 0.15;
      rig.humNeck.rotation.z = -hr * 0.12;
    }
    // 頭:反轉抵銷腰+胸+頸的累計殘量 → 頭鎖平;留 ~5% 殘留晃動 = 有慣性的機械頭(非陀螺儀)
    const accX = hp + rig.neck.rotation.x + (rig.humChest ? rig.humChest.rotation.x : 0)
      + (rig.humNeck ? rig.humNeck.rotation.x : 0);
    const accZ = hr + rig.neck.rotation.z + (rig.humChest ? rig.humChest.rotation.z : 0)
      + (rig.humNeck ? rig.humNeck.rotation.z : 0);
    rig.head.rotation.x = -accX * 0.95;
    rig.head.rotation.z = -accZ * 0.9;
    rig.head.rotation.y = idle * sg.idleK * Math.sin(now * 0.5) * 0.28;   // 靜止緩慢掃視(基底,下方再疊入彎凝視)
    // 持槍雙臂:鎖死當穩定射擊台(角度不隨步態擺動)是刻意設計,疊遠小於腿部的待機液壓微顫;
    // 開火時雙臂隨槍後座(肩微抬 + 蓄力反向項)—— 槍身本體的後座由 rig.heavy.pivot 負責
    if (rig.armSh) {
      rig.armSh.forEach((sh, i) => {
        const el = rig.armEl[i], b = rig.armBase[i];
        sh.rotation.x = b.shX + idle * 0.02 * Math.sin(now * 1.6 - i * 1.8)
          + rChg * (rHv.armR || 0) - rKick * 0.08;
        sh.rotation.z = b.shZ + idle * 0.015 * Math.sin(now * 1.6 - i * 1.8 + 1.2);
        el.rotation.x = b.elX + idle * 0.025 * Math.sin(now * 1.6 - i * 1.8 + 0.6);
      });
    }
    // 騎槍俯仰(rig.gunR):行軍槍口微揚 ↔ 交戰(靜止/開火保持)據槍水平;
    // 後座上跳與蓄力反向同 stepBiped 的 gunPitch 一條式 —— 槍身動、騎士穩定台不動
    gunPitch(rig.gunR, Math.min(1, idle + (rig._aim || 0)), rKick, rChg, rHv);
  } else {
    // 非騎乘(獵犬/劍龍/克蘇魯):靈活長頸「主動反屈」吃掉大半脊椎俯仰(拱背再劇也把頭撐平),
    // 殘量交給頭;位移補償只吃步態俯仰的畫弧(加減速前傾不進補償,否則起跑頸被拋出),
    // 夾幅放寬到 ±0.28 讓迴旋襲步的大拱背也補得動,但仍夾住 → 頸不會從肩上撐脫(分離)
    // 靈活長頸主動反屈:吃掉大半脊椎俯仰(拱背再劇也把頭撐平)—— 迴旋襲步長頸穩定的關鍵。
    // 係數 1.8 是「頭鎖平」的火候(獵犬實測頭部垂直位移 0.87→0.36m、頭俯仰 <2°、脊椎拱背仍 ±12.5°);
    // 小俯仰機種(劍龍/克蘇魯)乘上各自的小 spinePitch = 小幅反屈,行為幾乎不變
    const spinePitch = rig.spine.rotation.x + rig.chest.rotation.x;
    rig.neck.rotation.x = -spinePitch * 1.8 + Math.sin(wave - 1.4) * 0.05 * a;
    rig.neck.position.y = rig.neckY0 + bob * 0.55 + clamp(headArc(rig, 0.9, gaitPitch), -0.28, 0.28);
    // 頭:反轉抵銷「脊椎波 + 胸 + 頸」的累計旋轉 ⇒ 身體在跑,頭卻鎖平(獵食者的視線穩定)
    stabilizeHead({ head: rig.head }, [
      rig.spine.rotation.x + rig.chest.rotation.x + rig.neck.rotation.x,
      rig.spine.rotation.y,
      rig.spine.rotation.z + rig.neck.rotation.z,
    ], idle, now, 0.95, sg.idleK);
  }
  L.gaze = damp(L.gaze ?? 0, clamp(yawRate * 0.28, -0.45, 0.45), 3, dt);
  rig.head.rotation.y += L.gaze;   // 入彎凝視:獵食者先看向要去的地方
  // 尾:急轉甩向轉向反側(配重)+ 逐節延遲的鞭;高速時尾根抬起配平前傾
  whipTail(rig.tailSegs, L, dt, a, idle, now, yawRate, 0.12);
  rig.tailSegs[0].rotation.x += (rig.tailUp || 0.12) * a;
}

/**
 * 變形機甲(transformer_plan):型態由伺服器回報高度推導(heroY > 門檻 = 飛行型),
 * 阻尼漸變出 0(地面)→1(飛行)的型態參數 m —
 * rig.pose(m)(models.js)以各部件自己的分段時窗 smoothstep 到位
 * (翼先展 → 腿後收 → 機首鎖上的 Macross 式序列);這裡在姿勢之上疊加動態:
 * 地面步態(人型雙足 / 獸型前肢著地小跑)、飛行壓坡巡航、鳥/龍拍翼、
 * 推進器發光 ∝ m、關節排氣口熱散逸 ∝ 變形活動度(Task 3.1)。
 */
function stepMorph(L, rig, dt, now, ent, vFwd, vLat, speed, yawRate) {
  const want = (ent.heroY || 0) > 1.2 ? 1 : 0;
  const prev = L.morph ?? want;
  L.morph = damp(prev, want, 2.6, dt);
  const m = L.morph;
  // 變形活動度(|dm/dt| 平滑):進行中排氣口增亮,完成後自然歸零
  L.act = damp(L.act || 0, clamp(Math.abs(m - prev) / dt * 4, 0, 1), 5, dt);
  rig.pose(m);   // 分段姿勢插值(基底;以下全部疊加其上)
  // 體軸「直立度」uprightK:由目前姿勢的軀幹前傾推得(貓/龍/猴掌行近水平 → 趨 0.15;
  // 吸血鬼/亞特拉斯直立 → 趨 1)。起步撲身/煞停後仰的「俯衝」只給直立體軸 —— 已經近水平的獸型
  // 再往前壓就變臉朝地,牠們的加減速改由步幅、垂直起伏與脊椎波表現。
  const uprightK = clamp(1 - Math.abs(rig.torso.rotation.x) / 0.9, 0.15, 1);
  // 地面步態:步頻耦合位移(不滑步)。四肢相位表 rig.qphase = [後左, 後右, 前左, 前右]
  // 依生物原型指定:預設對角小跑 [0, π, π, 0];巨象走側步序列(同側前腳落後後腳 1/4 週期,
  // 永遠三腳著地的重型慢步);昆蟲/貓科各以 flexF 調屈曲剛性(甲蟲硬肢、豹科彈簧腿)
  const strideW = (rig.stride || 1.15) * (rig.s || 1);
  L.ph += speed * dt * Math.PI / Math.max(0.2, strideW);
  L.amp = damp(L.amp, clamp(speed / (rig.top || 9), 0, 1.1) * (1 - m), 6, dt);
  const a = L.amp;
  const sg = gsig(rig), fs = fsig(rig);
  // 地面爆發/急停(gated by 1−m)+ 飛行揚翼煞停(gated by m)脈衝,以 |L.accel| 驅動、settle 阻尼快落
  L.srg = damp(L.srg ?? 0, accUp(L) * sg.launch * (1 - m), 10 * sg.settle, dt);
  L.brk = damp(L.brk ?? 0, accDn(L) * sg.brake * (1 - m), 9 * sg.settle, dt);
  L.flr = damp(L.flr ?? 0, accDn(L) * fs.flare * m, 7, dt);
  const qp0 = rig.qphase || [0, Math.PI, Math.PI, 0];
  // 迴旋襲步(rig.gallopType='rotary',夜豹):高速時相位自對角小跑連續內插到
  // LH→RH→RF→LF 的落腳表(同 stepQuad 的 rotary;qphase 序 = [後左, 後右, 前左, 前右])
  let qp = qp0, galF = 0;
  if (rig.gallopType === 'rotary') {
    galF = clamp((a - 0.35) / 0.35, 0, 1);
    const GO = [0, 1.6 * Math.PI, 0.6 * Math.PI, Math.PI];   // −2π × 落腳時刻的相鄰等價角
    qp = qp0.map((v, i) => v + (GO[i] - v) * galF);
  }
  const swA = 0.6 * a * (1 + 0.3 * galF);   // 奔馳伸展相:跨距放大
  rig.legL.rotation.x += Math.sin(L.ph + qp[0]) * swA;
  rig.legR.rotation.x += Math.sin(L.ph + qp[1]) * swA;
  if (rig.tuck) {
    // 前肢收起蓄勢(迅猛龍):grounded running —— 雙腿在跑,前爪收在胸前不擺大臂,
    // 只隨步頻微幅開合(左右錯半拍 = 活的,不是焊死的)
    rig.armL.rotation.x += -0.15 * a + Math.sin(L.ph * 2) * 0.05 * a;
    rig.armR.rotation.x += -0.15 * a + Math.sin(L.ph * 2 + 0.5) * 0.05 * a;
  } else {
    // 掌行(rig.palmi,猿猴):前肢是真的承重前腳,雙側全幅擺動(不再半幅)
    const armF = (rig.beast || rig.palmi) ? 1 : 0.5;
    rig.armL.rotation.x += Math.sin(L.ph + qp[2]) * swA * (rig.swingArm || 0.4);
    rig.armR.rotation.x += Math.sin(L.ph + qp[3]) * swA * (rig.swingArm || 0.4) * armF;
  }
  // 中足對(犀金龜 tripod 的第三組):與對側前後足同組擺動 —— 任一時刻恆三足觸地;
  // 脛節在擺動相反相微屈(昆蟲硬肢的小折),支撐相回靜姿角撐地。
  // idle 尚未在此宣告(見下方 601 行),就地算一份同款待機微顫,避免中足在完全靜止時是
  // 三對足裡唯一沒有液壓微顫的一對;跗節(midTarsi)若有獨立關節,也跟著擺動抬離/踩地
  if (rig.midLegs) {
    const mp = [Math.PI, 0];
    const midIdle = idleOf(a) * (1 - m) * sg.breathK;
    rig.midLegs.forEach((ml, i) => {
      ml.rotation.x += Math.sin(L.ph + mp[i]) * swA * 0.8 + midIdle * Math.sin(now * 1.6 - i * 1.8) * 0.025;
      rig.midKnees[i].rotation.x = 0.55 + Math.max(0, -Math.cos(L.ph + mp[i])) * 0.35 * a
        + midIdle * Math.sin(now * 1.6 - i * 1.8 + 0.6) * 0.02;
      if (rig.midTarsi) rig.midTarsi[i].rotation.x = Math.max(0, -Math.cos(L.ph + mp[i])) * 0.22 * a
        + midIdle * Math.sin(now * 1.6 - i * 1.8 + 1.2) * 0.15;
    });
  }
  // 分節屈曲疊在 pose 之上(擺動相才折,支撐相打直):膝 → 踝(延遲)→ 肘(反相)。
  // 獸型的 Z 形腿本身已屈,屈曲量減半;L.amp 已含 (1−m) ⇒ 飛行型態自動歸零
  const idle = idleOf(a) * (1 - m);   // 待機微顫只在地面型(飛行型的肢是收攏的機構,不呼吸)
  // 雙相屈曲(同 flexChain 的奔跑設計):fx 擺動收腿(×1.15)、st 支撐彈簧壓縮(cos² 窄脈衝)
  // —— 大腿/小腿、前臂/後臂雙相都在動,不再「擺動折、支撐鎖直」像焊死的木棍
  const fx = (ph) => Math.max(0, -Math.cos(ph)) * 1.15;
  const st = (ph) => { const c = Math.cos(ph); return c > 0 ? c * c : 0; };
  const runF = clamp((a - 0.5) / 0.5, 0, 1);   // 奔跑度:過半速全面放大屈曲
  // 每節自己的相位延遲 = 力由近端傳向遠端(髖→膝→踝 / 肩→肘→腕);
  // br() 疊上靜止時的液壓微顫,站著也不是一具定格模型
  const br = (d, k) => idle * sg.breathK * Math.sin(now * 1.6 * sg.iF - d) * k;
  // 屈曲剛性:象柱腿/甲蟲硬肢 < 1、豹/迅猛龍彈簧腿 > 1;奔跑再 +30%
  const kF = (rig.flexF ?? 1) * (1 + 0.3 * runF);
  const kA = (rig.beast ? 0.34 : 0.6) * kF;
  rig.kneeL.rotation.x += (fx(L.ph + qp[0]) + st(L.ph + qp[0]) * 0.35) * kA * a + br(0, 0.03);
  rig.kneeR.rotation.x += (fx(L.ph + qp[1]) + st(L.ph + qp[1]) * 0.35) * kA * a + br(1.8, 0.03);
  // 踝:擺動抬掌 + 觸地載荷下沉再蹬伸回彈(腳掌不跟小腿鎖成一塊)
  rig.ankleL.rotation.x -= (fx(L.ph + qp[0] - 0.5) + st(L.ph + qp[0] - 0.5) * 0.45) * 0.4 * kF * a + br(0.6, 0.02);
  rig.ankleR.rotation.x -= (fx(L.ph + qp[1] - 0.5) + st(L.ph + qp[1] - 0.5) * 0.45) * 0.4 * kF * a + br(2.4, 0.02);
  const eA = 0.4 * (rig.swingArm || 0.4) * kF;
  const armFull = rig.beast || rig.palmi;   // 前肢承重(獸型前腳 / 猿猴掌行):雙側全幅
  if (rig.tuck) {
    // 收起的前爪:肘/腕鎖在深屈蓄勢角(∝ 速度),疊快速小顫 = 蓄勢待發,不是凍結的道具
    rig.elbowL.rotation.x -= 0.3 * a + Math.sin(now * 7) * 0.03 * a + br(1.2, 0.025);
    rig.elbowR.rotation.x -= 0.3 * a + Math.sin(now * 7 + 1.1) * 0.03 * a + br(3.0, 0.025);
    rig.wristL.rotation.x += 0.18 * a + Math.sin(now * 7 + 0.5) * 0.025 * a + br(1.8, 0.02);
    rig.wristR.rotation.x += 0.18 * a + Math.sin(now * 7 + 1.6) * 0.025 * a + br(3.6, 0.02);
  } else {
    // 肘:奔跑時人形手肘恆屈泵動(hold ∝ runF),不甩直;承重前肢照腿的雙相跑
    const eHold = armFull ? 0 : 0.3 * runF * a;
    rig.elbowL.rotation.x -= (fx(L.ph + qp[2] - 0.4) + st(L.ph + qp[2] - 0.4) * 0.25) * eA * a + eHold + br(1.2, 0.025);
    rig.elbowR.rotation.x -= (fx(L.ph + qp[3] - 0.4) + st(L.ph + qp[3] - 0.4) * 0.25) * eA * a * (armFull ? 1 : 0.5)
      + eHold * 0.6 + br(3.0, 0.025);
    // 腕/前掌:延遲最久的末節(follow-through 的尾巴),幅度加大 —— 擺動相收掌
    // (獸型 = 趾行的收爪、猿猴 = 掌行的貼地翻掌、人形 = 手腕自然回勾)、
    // 觸地相載荷回折,絕不焊死在前臂上
    const wA = (armFull ? 0.34 : 0.22) * kF;
    rig.wristL.rotation.x += (fx(L.ph + qp[2] - 0.9) + st(L.ph + qp[2] - 0.9) * 0.3) * wA * a + br(1.8, 0.02);
    rig.wristR.rotation.x += (fx(L.ph + qp[3] - 0.9) + st(L.ph + qp[3] - 0.9) * 0.3) * wA * a * (armFull ? 1 : 0.5) + br(3.6, 0.02);
  }
  // 手持武器射擊姿勢(rig.aimM 的人形地面型傭兵):靜止或開火保持 = 肩/肘/腕混成到據槍角
  // (雙槍 = 兩臂都給欄位;單手 = 只給右臂),槍口朝前由 gunPitch 解算;後座各手獨立。
  // 全部 ×(1−m) —— 飛行型態手臂是收攏的機構,MUST NOT 把射姿帶上天
  const cKL = rig._kickL || 0, cKR = rig._kickR || 0;
  const cChg = (rig._chg || 0) * (1 - m), cHv = rig.hvy || S0;
  if (rig.aimM) {
    const aimF = clamp(idle + (rig._aim || 0) * (1 - m), 0, 1);
    const A = rig.aimM;
    const toAim = (g, t) => { if (g && t != null) g.rotation.x += (t - g.rotation.x) * aimF; };
    toAim(rig.armR, A.shR); toAim(rig.elbowR, A.elR); toAim(rig.wristR, A.wrR);
    toAim(rig.armL, A.shL); toAim(rig.elbowL, A.elL); toAim(rig.wristL, A.wrL);
    rig.armR.rotation.x += (-cKR * 0.15 + cChg * (cHv.armR || 0)) * (1 - m);
    rig.armL.rotation.x += (-cKL * 0.15 + cChg * (cHv.armL || 0)) * (1 - m);
    gunPitch(rig.gunR, aimF, cKR * (1 - m), cChg, cHv);
    gunPitch(rig.gunL, aimF, cKL * (1 - m), cChg, cHv);
  }
  // 多節尾(猿猴長尾 / 獸型尾):逐節相位延遲的鞭式擺動 + 急轉時甩向轉向反側 = 配重。
  // 全部疊在 pose(m) 之上(飛行型態 a→0、L.tail 也阻尼歸零 ⇒ 尾自動拉直成尾桁)。
  // idle 微顫(比照 whipTail locomotion.js:141)不可省略:靜止時尾巴仍要有液壓微顫,
  // 不能因為只吃 a/L.tail(兩者靜止皆歸零)就整節凍結
  if (rig.tailSegs) {
    L.tail = damp(L.tail ?? 0, clamp(-yawRate * 0.3, -0.5, 0.5) * (1 - m), 3.5, dt);
    rig.tailSegs.forEach((t, i) => {
      t.rotation.y += L.tail * (1 + i * 0.35) + Math.sin(L.ph - i * 0.5) * 0.14 * a;
      t.rotation.x += Math.sin(L.ph * 2 - i * 0.6) * 0.05 * a + idle * Math.sin(now * 1.1 - i * 0.6) * 0.03;
    });
  }
  // 象鼻(肌肉靜水骨骼):幾乎無時無刻不在動,靜止時嗅聞/警戒式擺動 + 移動時隨步頻甩動,
  // 不像其餘部位可以只靠 pose(m) 的地面/飛行兩個固定姿勢就交代過去
  if (rig.trunk) {
    rig.trunk.rotation.y += idle * Math.sin(now * 0.7) * 0.08 + Math.sin(L.ph * 0.5) * 0.04 * a;
    rig.trunk.rotation.z += idle * Math.sin(now * 0.5 + 1.5) * 0.05;
    if (rig.trunkTip) {
      rig.trunkTip.rotation.y += idle * Math.sin(now * 0.9 - 0.6) * 0.12 + Math.sin(L.ph * 0.5 - 0.4) * 0.08 * a;
      rig.trunkTip.rotation.x += idle * Math.sin(now * 1.1 - 1.2) * 0.06;
    }
  }
  // 軀幹動態:地面前傾/加減速預備、飛行壓坡入彎 + 巡航俯仰、懸停浮沉
  const topAir = rig.topAir || 30;
  // surge:飛行暴衝俐落度 → 加快壓坡/俯仰的阻尼響應(穿越/噴射急甩、飛鯨/重載遲鈍);bank:入彎壓坡積極度
  const airK = 4 * (1 + fs.surge * m);
  L.roll = damp(L.roll, clamp(-vLat / topAir, -1, 1) * 0.3 * m * fs.bank, airK, dt);
  // 地面加速前傾的暫態(clamp 那項)對獸型(水平體軸)收斂 —— 否則貓/龍奔跑起步會臉朝地;
  // 0.16·amp 的穩態奔跑姿與飛行俯仰不動
  L.pitch = damp(L.pitch,
    m * clamp(vFwd / topAir, -1, 1) * 0.2
    + (1 - m) * (0.16 * L.amp + clamp(L.accel * 0.015, -0.1, 0.15) * uprightK),
    airK * (1 - 0.55 * sg.spool * (1 - m)), dt);   // spool:地面重型前傾遲滯(傾角先於速度=柴油機起轉)
  // 迴旋襲步的拱背-伸展脈動(獵豹引擎)疊在阻尼俯仰之上;放大幅度 → 脊背收攏相拱起、伸展相打直,
  // 驅動四肢的圓周襲步(拱背才是 gallop 的引擎);+ 地面爆發前撲/急停後坐、飛行揚翼(flare)煞停
  const archPulse = Math.sin(L.ph) * 0.22 * galF * a;
  // 開火軀幹搖:蓄力抵肩/擊發反向 + 每發後座震(手持 _kickL/R 與機載 _kickB 都打進軀幹);
  // 存成 cbt → 下方頭部補償一併反吃,開火中頭仍鎖平(僅留殘量 = 衝擊感)
  const cbt = (cChg * (cHv.chest || 0)
    - (Math.max(cKL, cKR) + (rig._kickB || 0)) * 0.05) * (1 - m);
  rig.torso.rotation.x += L.pitch + archPulse
    + (L.srg * 0.07 - L.brk * 0.08) * uprightK - L.flr * 0.06    // 俯衝 × uprightK(水平體軸收斂);flare 屬飛行不縮
    + cbt;
  // 悟空懸停直立(rig.hoverUp = cruise):飛行「靜止」時機體立回直立、光翼垂展身後;
  // 開始移動才連續前傾壓平到近水平的巡航姿態。頭本來以 0.15−cruise 補償前傾,
  // 直立時一併回正,否則會仰天
  if (rig.hoverUp) {
    const spd = Math.hypot(vFwd, vLat);
    L.hov = damp(L.hov ?? 0, m * (1 - clamp(spd / 6, 0, 1)), 3, dt);
    rig.torso.rotation.x -= (rig.hoverUp - 0.12) * L.hov;
    if (rig.head) rig.head.rotation.x += (rig.hoverUp - 0.3) * L.hov;
    // 懸停光翼上揚:機體立直後翼束改朝上後方全幅展開(孔雀開屏),移動時滑回後掠
    if (rig.lightWingRoots) for (const r of rig.lightWingRoots) r.rotation.x += 1.55 * L.hov;
  }
  // 地面體側搖擺(rig.rollSway,巨象側步的重心逐拍換邊;a 已含 1−m ⇒ 飛行自動歸零)
  rig.torso.rotation.z = L.roll + (rig.rollSway || 0) * Math.sin(L.ph) * a;
  // 頭:抵銷軀幹的動態俯仰/側傾(地面步行時鎖平視線;飛行時讓位給 pose —— 機首本來就該跟著航向)
  if (rig.head) {
    // 拱背在水平獸軀上把頭甩出大弧(獵豹頭部垂直位移 0.72m):獸軀已放平 ⇒ 頭局部 −z ≈ 世界垂直,
    // 沿它反向平移抵銷弧高 → 頭鎖平(垂直位移收斂到 0.19m)。archPulse 僅迴旋襲步(galF)非零 ⇒ 其餘機種不受影響
    rig.head.position.z += archPulse * -2;
    const k = (1 - m) * 0.8;
    // 頭反向吸收阻尼俯仰 + 拱背脈動 + 開火軀幹搖(cbt 反吃 85%)→ 視線鎖平
    // (靈活頸的效果:身體拱背奔馳/後座震動,頭卻不晃)
    rig.head.rotation.x -= L.pitch * k + archPulse * 0.92 + cbt * 0.85;
    rig.head.rotation.z -= L.roll * k;
    L.gaze = damp(L.gaze ?? 0, clamp(yawRate * 0.28, -0.45, 0.45), 3, dt);
    rig.head.rotation.y += idle * sg.idleK * Math.sin(now * 0.5) * 0.25    // 靜止:緩慢警戒掃視(idleK 依性格:哨兵頻掃、狙擊近凍)
      + L.gaze * (1 - m);                                                   // 地面入彎凝視(飛行讓位給航向)
  }
  // 地面步態的縱向彈跳 + 飛行浮沉。浮沉只給「活的」擬態獸型(拍翼會產生升力脈動);
  // 定翼/旋翼是機械飛行器 —— 巡航時機體穩定,MUST NOT 讓它跟著上下呼吸(airBob = 0)。
  // grounded running(rig.grounded,如迅猛龍):沒有騰空相的跑 —— 速度越快浮沉反而收斂
  // (被長腿屈伸吸收),同 stepBiped:255 的 bobF,MUST NOT 讓彈跳隨速度單調放大
  const bobF = rig.grounded ? 1 - 0.55 * runF : 1;
  // 懸停站位抖動(hover:蜂/穿越高頻定點修正、長航/飛鯨死穩)—— 純姿態旋轉、不動 position.y ⇒ 不違「機械飛行不呼吸」
  const hovK = m * clamp(1 - Math.hypot(vFwd, vLat) / 3, 0, 1) * fs.hover;
  rig.torso.rotation.x += Math.sin(now * 6.5 * fs.hoverF) * 0.012 * hovK;
  rig.torso.rotation.z += Math.sin(now * 5.7 * fs.hoverF + 1.1) * 0.014 * hovK;
  rig.torso.position.y += -(0.5 - 0.5 * Math.cos(L.ph * 2)) * (rig.bob || 0.07) * L.amp * bobF
    + m * Math.sin(now * 2.4 * fs.hoverF + L.ph) * 0.12 * (rig.airBob ?? 1) * fs.hoverA   // 浮沉幅 ∝ hoverA(擬態獸大、機械≈0)
    - L.srg * 0.03 - L.brk * 0.03;   // 地面爆發起步/急停壓低重心
  // 拍翼(鳥/龍):翼展開後才拍;頻率隨速度、外翼相位延遲(follow-through)
  if (rig.flapWings && m > 0.45) {
    const k = clamp(Math.hypot(vFwd, vLat) / topAir, 0, 1);
    L.flap = (L.flap || 0) + dt * (2.6 + k * 8) * (rig.flapF || 1);
    const amp = (0.2 + k * 0.3 + L.flr * 0.4) * m;   // flare:減速時杯翼倒拍煞停(始祖鳥/夜梟/龍/翼龍)
    for (const { w, outer, sgn } of rig.flapWings) {
      w.rotation.z += sgn * Math.sin(L.flap + L.ph) * amp;
      outer.rotation.z += sgn * Math.sin(L.flap + L.ph - 0.7) * amp * 1.4;
    }
  }
  // 噴射尾焰(jet 雙發機艙):推力 ∝ 型態 × 速度 —— 地面/變形前段完全熄火,
  // 巡航焰長/亮度隨速度拉伸 + 高頻抖焰
  if (rig.jets) {
    const k = clamp(Math.hypot(vFwd, vLat) / topAir, 0, 1);
    rig.jets.forEach((j, i) => {
      j.g.visible = m > 0.5;
      const flick = 1 + Math.sin(now * 31 + i * 2.1) * 0.1;
      j.g.scale.set(1, (0.3 + 1.4 * k) * m * flick, 1);
      j.m1.opacity = m * (0.2 + 0.4 * k) * flick;
      j.m2.opacity = m * (0.4 + 0.5 * k);
      j.m1.emissiveIntensity = 1.2 + 2.4 * k;
    });
  }
  // 悟空光之翼:焰刃「不揮動」—— 只隨型態展開(pose)與速度增輝拉長。
  // 懸停直立時光翼就已經是全幅的大翼(基礎 ×3),移動巡航再拉長增烈
  // (合計 ×2 的長航跡);地面完全熄滅只剩翼根機構
  if (rig.lightWings) {
    const k = clamp(Math.hypot(vFwd, vLat) / topAir, 0, 1);
    rig.lightWings.forEach((b, i) => {
      b.visible = m > 0.06;
      const flick = 1 + Math.sin(now * 24 + i * 1.7) * 0.07;
      b.scale.y = m * (1.5 + 2.1 * k) * flick + 0.01;
      b.material.opacity = m * (0.42 + 0.3 * k);
      b.material.emissiveIntensity = m * (1.8 + 2.4 * k);
    });
  }
  // 旋翼轉速 ∝ 推力(地面完全靜止 — 收攏槳葉/手持圓盾不自轉;變形中緩轉起旋);
  // dir 正逆槳互抵扭矩、f = 尾旋翼加速比
  if (rig.rotors) for (const r of rig.rotors)
    r.g.rotation.y += dt * r.dir * (m * 26 + L.act * 10) * (r.f || 1);
  // 推進器 ∝ 飛行推力;排氣口 ∝ 變形熱散逸(transformer_plan Task 3.1)
  for (const t of rig.thrusters) t.material.emissiveIntensity = 0.25 + m * 2.2 + L.act * 1.2;
  for (const v of rig.vents) v.material.emissiveIntensity = 0.15 + L.act * 2.6;
}
