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
  if (rig.kind === 'biped') stepBiped(L, rig, dt, now, speed, yawRate);
  else if (rig.kind === 'aerial') stepAerial(L, rig, dt, now, vFwd, vLat);
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
function flexChain(chain, ph, a, idle = 0, t = 0, load = 0.35, hold = 0) {
  for (let i = 0; i < chain.length; i++) {
    const j = chain[i];
    const sw = Math.max(0, -Math.cos(ph - j.d));   // 擺動相:收腿
    const st = Math.max(0, Math.cos(ph - j.d));    // 支撐相:載荷壓縮(st² = 觸地窄脈衝)
    // 遠端節擺幅逐節放大(鞭式 follow-through):腕/掌、踝/趾是延遲最久、甩得最開的末節,
    // 手掌腳掌絕不跟前臂小腿鎖成一塊
    const whip = 1 + i * 0.22;
    // 靜止時的液壓微顫:每節仍以自己的相位延遲呼吸(振幅 ≈ 步態的 6%)——
    // 站著的機體關節完全凍結會像模型展示台,不像通電中的機具。
    j.g.rotation.x = j.base + j.k * ((sw * 1.15 + st * st * load) * a * whip + hold
      + 0.06 * idle * Math.sin(t * 1.6 - j.d * 1.5));
  }
}

/** 靜止度:速度趨零 → 1(給呼吸/微顫用;與步態振幅 a 互補) */
const idleOf = (a) => clamp(1 - a / 0.06, 0, 1);

/**
 * 凝視穩定(所有會走路的機種共用):頭/頸反轉抵銷骨盆 + 胸腔的旋轉 —— 軀幹再怎麼起伏扭轉,
 * 頭維持水平前視。真獸/真人跑步時頭幾乎不晃(前庭反射),頭跟著軀幹一起甩才是壞掉的布娃娃。
 * 抵銷率 < 1(留一點殘留晃動 = 有慣性的機械頭,不是陀螺儀);靜止時疊上緩慢的警戒掃視。
 * @param acc [x,y,z] 上游(骨盆+胸腔+脊椎…)的累計旋轉
 */
function stabilizeHead(rig, acc, idle, now, k = 0.85) {
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
  head.rotation.y = -acc[1] * k * (1 - kn) + idle * Math.sin(now * 0.5) * 0.28;   // 靜止:緩慢掃視
  head.rotation.z = -acc[2] * k * (1 - kn);
}

/**
 * 頭部畫弧補償(四足獸專用):脊椎/胸的俯仰角 θ 落在長度 L 的頸力臂上 → 頭部產生 ≈ L·θ 的
 * 上下位移(小角度近似)。把這段從頸的高度扣回去,頭就不再隨每一步畫大弧。
 * 只補償「旋轉造成的」那一段,彈跳另外補 —— 兩者來源不同,混在一起調不動。
 */
function headArc(rig, k) {
  return ((rig.spine.rotation.x + rig.chest.rotation.x) * (rig.headArm || 0)
    + rig.neck.rotation.x * (rig.headArmN || 0)) * k;
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
  // 跳奔混成度:0 = 交替步,1 = 雙腿同相併蹬;左右相位差 π→0 連續縮短,步態不瞬跳
  const bnd = (rig.bound || 0) * clamp((a - 0.55) / 0.4, 0, 1);
  const phL = L.ph, phR = L.ph + Math.PI * (1 - bnd);
  const sw = Math.sin(L.ph);
  // 奔跑度:速度過半後跨距/收腿全面放大 —— 走路與奔跑是兩種姿態,不是同一組角度放大音量
  const runF = clamp((a - 0.5) / 0.5, 0, 1);
  const legA = 0.62 * a * (1 + 0.3 * runF);
  const legB = rig.legBase || 0, armB = rig.armBase || 0;   // 原型站姿(拱背/負重機體的靜態屈角)
  // 靜止待機:雙腿以極慢的反相重心交換微擺(左右換腳站),不是完全定格
  const stand = idle * Math.sin(now * 0.9 + L.ph) * 0.03;
  rig.legL.rotation.x = legB + Math.sin(phL) * legA + stand;
  rig.legR.rotation.x = legB + Math.sin(phR) * legA - stand;
  // 手臂與腿反相(follow-through);跳奔時雙臂轉為同相前撐(前肢落在後腿併蹬的半拍後 =
  // 四足跳奔的節奏);持械手平時擺幅收斂穩住槍口,跳奔時它就是前腳,也得撐地
  const oAL = Math.PI, oAR = Math.PI * bnd;
  rig.armL.rotation.x = armB + Math.sin(L.ph + oAL) * legA * (0.75 + bnd * 0.3)
    + idle * Math.sin(now * 1.3) * 0.025;
  rig.armR.rotation.x = armB + Math.sin(L.ph + oAR) * legA * (rig.gunArm ? 0.25 + bnd * 0.55 : 0.75 + bnd * 0.3)
    + idle * Math.sin(now * 1.3 + 0.6) * (rig.gunArm ? 0.008 : 0.025);   // 持械手待機也穩住槍口
  // 膝→踝、肘→腕:分節鏈(有掛才跑;舊的單節機體照舊只擺髖/肩)
  if (rig.legChainL) {
    // 腿:擺動收腿 + 支撐彈簧(flexChain 內建);奔跑時整體再放大
    const la = a * (1 + 0.25 * runF);
    flexChain(rig.legChainL, phL, la, idle, now);
    flexChain(rig.legChainR, phR, la, idle, now + 1.9);
    // 臂:奔跑的手肘是「恆屈 + 前後泵動」,不是甩直的鐘擺(hold 隨奔跑度增加);
    // 持械側 hold 收斂(端槍的手肘本來就鎖著托槍)
    flexChain(rig.armChainL, L.ph + oAL, a, idle, now + 0.7, 0.15, 0.5 * runF);
    flexChain(rig.armChainR, L.ph + oAR, a * (rig.gunArm ? 0.45 + bnd * 0.55 : 1),
      idle * (rig.gunArm ? 0.3 : 1), now + 2.6, 0.15, (rig.gunArm ? 0.2 : 0.5) * runF);
  }
  const hips = rig.hips;
  // 骨盆:交替步一週期兩次浮沉(雙支撐最高、單支撐最低)+ 重心側移到支撐腿;
  // 跳奔漸變為「一跳一大浮沉」的騰空拋物線,側移/扭腰同步歸零(併蹬沒有左右換腳)
  hips.position.y = rig.hipsY0 - (0.5 - 0.5 * Math.cos(L.ph * 2)) * (rig.bob || 0.06) * a * (1 - bnd)
    + Math.sin(L.ph) * (rig.bob || 0.06) * 2.2 * a * bnd
    + idle * Math.sin(now * 1.7 + L.ph) * 0.012;   // 靜止時的呼吸微沉浮(隨速度連續淡出)
  hips.position.x = sw * (rig.sway || 0.05) * a * (1 - bnd);
  hips.rotation.z = -sw * 0.07 * a * (1 - bnd);
  hips.rotation.y = -sw * 0.1 * a * (1 - bnd);    // 骨盆對轉(自然扭腰)
  // 前傾:速度越快越前壓;加減速再疊預備/回穩傾角;跳奔再多壓一段(衝刺的撲身)。
  // leanF 依體軸而定(人形 1.0;水平體軸的獸型 0.3~0.5 —— 牠們用抬尾配平,不是把頭壓向地面)
  L.lean = damp(L.lean, (0.22 * a + bnd * 0.14 + clamp(L.accel * 0.015, -0.1, 0.15)) * (rig.leanF ?? 1), 5, dt);
  hips.rotation.x = L.lean;
  // 胸腔:與骨盆對轉(走路時肩線與髖線反向扭 = 上下半身的角動量互抵)+ 呼吸擴張
  const chest = rig.chest;
  if (chest) {
    chest.rotation.y = -hips.rotation.y * 0.9;
    chest.rotation.z = -hips.rotation.z * 0.55;
    chest.rotation.x = 0.06 * a + idle * Math.sin(now * 1.5) * 0.02;
  }
  // 頭把骨盆的縱向彈跳吸掉一半(頸/頭自己往回撐)⇒ 頭的上下位移收斂,不隨每一步上下彈
  if (rig.headY0 != null) rig.head.position.y = rig.headY0 + (rig.hipsY0 - hips.position.y) * 0.5;
  // 頭/頸:反轉抵銷骨盆 + 胸腔 ⇒ 跑起來軀幹在扭,頭卻穩穩鎖住前方;再疊入彎凝視(看向轉向)
  stabilizeHead(rig, [
    hips.rotation.x + (chest ? chest.rotation.x : 0),
    hips.rotation.y + (chest ? chest.rotation.y : 0),
    hips.rotation.z + (chest ? chest.rotation.z : 0),
  ], idle, now);
  L.gaze = damp(L.gaze ?? 0, clamp(yawRate * 0.28, -0.45, 0.45), 3, dt);
  rig.head.rotation.y += L.gaze;
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
  const air = Math.max(0, Math.sin(L.ph));       // 騰空(身體升起)
  const crouch = Math.max(0, -Math.sin(L.ph));   // 觸地(壓縮蓄力)
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
  const hips = rig.hips;
  // 一跳一沉浮:騰空拋物線 + 觸地壓縮(不是交替步的一週期兩浮沉);無左右側移/扭腰
  hips.position.y = rig.hipsY0 + (air * (rig.hopH || 0.5) - crouch * 0.3) * a
    + idle * Math.sin(now * 1.7) * 0.012;
  hips.position.x = 0;
  hips.rotation.z = 0;
  hips.rotation.y = 0;
  // 體軸前傾近水平(hopLean):速度越快壓得越平,靜止時回到直立;
  // 再疊每跳的俯仰律動 —— 蹬離時揚起、落地前俯衝(拋物線的切線方向)
  L.lean = damp(L.lean, (rig.hopLean || 0.85) * a + clamp(L.accel * 0.012, -0.08, 0.12), 5, dt);
  hips.rotation.x = L.lean + Math.cos(L.ph + 0.5) * 0.1 * a;
  const chest = rig.chest;
  if (chest) {
    chest.rotation.y = 0;
    chest.rotation.z = 0;
    chest.rotation.x = 0.05 * a + idle * Math.sin(now * 1.5) * 0.02;
  }
  if (rig.headY0 != null) rig.head.position.y = rig.headY0 + Math.max(0, rig.hipsY0 - hips.position.y) * 0.5;
  // 體軸壓平了,頭照樣抬起鎖平前方(袋鼠跳起來頭是穩的)+ 入彎凝視
  stabilizeHead(rig, [
    hips.rotation.x + (chest ? chest.rotation.x : 0), 0, 0,
  ], idle, now, 0.9);
  L.gaze = damp(L.gaze ?? 0, clamp(yawRate * 0.28, -0.45, 0.45), 3, dt);
  rig.head.rotation.y += L.gaze;
  // 尾 = 第三條腿:與體軸反相上下甩(騰空尾壓下、蹬離尾抬起 = 角動量互抵),
  // 逐節相位延遲成鞭;急轉照樣橫甩配重(whipTail)
  if (rig.tailSegs) {
    whipTail(rig.tailSegs, L, dt, a, idle, now, yawRate);
    rig.tailSegs.forEach((t, i) => {
      t.rotation.x += ((rig.tailUp || 0.2) - Math.sin(L.ph - i * 0.55) * 0.3) * a;
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
  let phFL, phFR, phHL, phHR, gallop = 0;
  if (G === 'walk') {
    // 側步序列(lateral sequence):同側後腳先動、前腳跟進,左右各差半週期
    phHL = L.ph; phFL = L.ph - Math.PI * 0.5;
    phHR = L.ph + Math.PI; phFR = L.ph + Math.PI * 0.5;
  } else if (G === 'crawl') {
    // 觸手輪:FL → HR → FR → HL 逐一推進(相鄰觸手相位各差 1/4 週期)
    phFL = L.ph; phHR = L.ph - Math.PI * 0.5;
    phFR = L.ph + Math.PI; phHL = L.ph + Math.PI * 0.5;
  } else {
    // trot → gallop:門檻壓低(速度 1/3 就開始換步態)—— 犬/馬/豹以奔馳姿態為主,
    // 走路只是起步的過渡;高速時後腿相位拉近前腿 → 縱向彈跳 + 前後肢分離的伸展相
    gallop = clamp((a - 0.35) / 0.35, 0, 1) * (rig.gallop ?? 1);
    const off = Math.PI * 0.5 * gallop;
    phFL = L.ph; phFR = L.ph + Math.PI; phHL = L.ph + Math.PI + off; phHR = L.ph + off;
  }
  // 跨距:奔馳時前後肢伸展幅再放大 35%(gallop 的騰空伸展 = 大步距的來源)
  const legA = 0.66 * a * (1 + 0.35 * gallop) * (rig.legAmp ?? 1);
  rig.legFL.rotation.x = Math.sin(phFL) * legA;
  rig.legFR.rotation.x = Math.sin(phFR) * legA;
  rig.legHL.rotation.x = Math.sin(phHL) * legA * 0.9;
  rig.legHR.rotation.x = Math.sin(phHR) * legA * 0.9;
  const idle = idleOf(a);
  if (rig.chFL) {
    if (rig.soft) {
      // 章魚觸手腿:不是「擺動折、支撐直」的關節腿 —— 整條是正負皆折的行進波
      // (undulate),波幅隨速度、靜止時波仍以慢速自行爬行(軟體動物永遠在蠕動)
      const amp = 2.2 * a + 0.55 * idle;
      const drift = now * 0.7 * idle;   // 靜止時的自主蠕動波
      undulate(rig.chFL, phFL + drift, amp);
      undulate(rig.chFR, phFR + drift + 0.5, amp);
      undulate(rig.chHL, phHL + drift + 1.0, amp);
      undulate(rig.chHR, phHR + drift + 1.5, amp);
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
  // 持武觸手:與步態無關的恆時蠕動(靜止也在動 = 活的東西),速度越快擺越大
  if (rig.tents) for (const t of rig.tents) undulate(t, now * 1.5 + L.ph * 0.5, 0.5 + 0.5 * a);
  // 入彎傾斜(先算:頭/尾/騎士都要抵銷它,晚一幀補償會看得出來)
  L.roll = damp(L.roll, clamp(yawRate * 0.22, -0.5, 0.5), 3.5, dt);
  // 側步慢步的體側搖擺:重心逐拍搖向支撐側(大象/劍龍的招牌搖晃,walk 專屬)
  const sway = (rig.rollSway || 0) * Math.sin(L.ph + Math.PI * 0.25) * a;
  rig.spine.rotation.z = -L.roll * 0.14 + sway;
  rig.spine.position.x = sway * 1.4;
  // 脊椎波:動力由後髖生成向前傳導(腰 → 胸 → 頸 逐節相位延遲),鞭式屈伸;
  // trot 一週期兩拍、walk/crawl 一週期一拍(慢而深的長浪)
  const wave = G === 'trot' ? L.ph * 2 : L.ph;
  // 奔馳時脊椎屈伸放大(獵豹式拱背-伸展是 gallop 的引擎;騎乘型收斂 —— 馬背要載人)
  const pAmp = (rig.pitchAmp ?? 0.05) * (1 + gallop * (rig.rider ? 0.3 : 0.9));
  rig.spine.rotation.x = Math.sin(wave) * pAmp * a + clamp(L.accel * 0.012, -0.08, 0.1);
  rig.chest.rotation.x = Math.sin(wave - 0.7) * pAmp * a;
  // 章魚:外套膜隨行進波緩慢蛇擺(左右蠕行),靜止時也以極慢的幅度游動
  rig.spine.rotation.y = G === 'crawl' ? Math.sin(L.ph * 0.5) * 0.12 * a + idle * Math.sin(now * 0.6) * 0.04 : 0;
  // 縱向彈跳(gallop 越明顯;walk/crawl 幾乎貼地)+ 靜止呼吸微沉浮
  const bob = (0.5 - 0.5 * Math.cos(wave)) * (rig.bob || 0.08) * a * (1 + gallop * 0.8);
  rig.spine.position.y = rig.hipsY0 - bob + idle * Math.sin(now * 1.4 + L.ph) * 0.02;
  if (rig.rider) {
    // 人馬:騎士的骨盆「黏死」在馬背上 —— position 一律不動(先前用位移反向抵銷,
    // 馬身下沉、騎士留在原地,兩者在腰際裂開;headArc 是給水平長頸用的力臂補償,
    // 套在垂直的人身上變成前後亂晃的來源 —— 都拆掉)。
    // 穩定全靠「腰部反向旋轉」:即時抵銷馬軀的俯仰/滾轉,胸口與槍口鎖平;
    // 騎士跟著馬一起沉浮是真實騎乘感,不是缺陷。
    rig.neck.rotation.x = -(rig.spine.rotation.x + rig.chest.rotation.x) * 0.92
      + Math.sin(wave - 1.4) * 0.01 * a;
    rig.neck.rotation.z = -rig.spine.rotation.z * 0.9;
    rig.neck.position.y = rig.neckY0;
    rig.neck.position.x = 0;
  } else {
    rig.neck.rotation.x = Math.sin(wave - 1.4) * 0.07 * a;
    // 頸吸收「脊椎彈跳 + 脊椎/胸俯仰在長頸力臂上放大出來的畫弧」⇒ 頭近乎平移前進
    rig.neck.position.y = rig.neckY0 + bob * 0.55 + headArc(rig, 0.85);
  }
  // 頭:反轉抵銷「脊椎波 + 胸 + 頸」的累計旋轉 ⇒ 身體在跑,頭卻鎖平(獵食者的視線穩定)
  stabilizeHead({ head: rig.head }, [
    rig.spine.rotation.x + rig.chest.rotation.x + rig.neck.rotation.x,
    rig.spine.rotation.y,
    rig.spine.rotation.z + rig.neck.rotation.z,
  ], idle, now, 0.95);
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
  // 地面步態:步頻耦合位移(不滑步)。四肢相位表 rig.qphase = [後左, 後右, 前左, 前右]
  // 依生物原型指定:預設對角小跑 [0, π, π, 0];巨象走側步序列(同側前腳落後後腳 1/4 週期,
  // 永遠三腳著地的重型慢步);昆蟲/貓科各以 flexF 調屈曲剛性(甲蟲硬肢、豹科彈簧腿)
  const strideW = (rig.stride || 1.15) * (rig.s || 1);
  L.ph += speed * dt * Math.PI / Math.max(0.2, strideW);
  L.amp = damp(L.amp, clamp(speed / (rig.top || 9), 0, 1.1) * (1 - m), 6, dt);
  const qp = rig.qphase || [0, Math.PI, Math.PI, 0];
  const swA = 0.6 * L.amp;
  rig.legL.rotation.x += Math.sin(L.ph + qp[0]) * swA;
  rig.legR.rotation.x += Math.sin(L.ph + qp[1]) * swA;
  rig.armL.rotation.x += Math.sin(L.ph + qp[2]) * swA * (rig.swingArm || 0.4);
  rig.armR.rotation.x += Math.sin(L.ph + qp[3]) * swA * (rig.swingArm || 0.4) * (rig.beast ? 1 : 0.5);
  // 分節屈曲疊在 pose 之上(擺動相才折,支撐相打直):膝 → 踝(延遲)→ 肘(反相)。
  // 獸型的 Z 形腿本身已屈,屈曲量減半;L.amp 已含 (1−m) ⇒ 飛行型態自動歸零
  const a = L.amp;
  const idle = idleOf(a) * (1 - m);   // 待機微顫只在地面型(飛行型的肢是收攏的機構,不呼吸)
  // 雙相屈曲(同 flexChain 的奔跑設計):fx 擺動收腿(×1.15)、st 支撐彈簧壓縮(cos² 窄脈衝)
  // —— 大腿/小腿、前臂/後臂雙相都在動,不再「擺動折、支撐鎖直」像焊死的木棍
  const fx = (ph) => Math.max(0, -Math.cos(ph)) * 1.15;
  const st = (ph) => { const c = Math.cos(ph); return c > 0 ? c * c : 0; };
  const runF = clamp((a - 0.5) / 0.5, 0, 1);   // 奔跑度:過半速全面放大屈曲
  // 每節自己的相位延遲 = 力由近端傳向遠端(髖→膝→踝 / 肩→肘→腕);
  // br() 疊上靜止時的液壓微顫,站著也不是一具定格模型
  const br = (d, k) => idle * Math.sin(now * 1.6 - d) * k;
  // 屈曲剛性:象柱腿/甲蟲硬肢 < 1、豹/迅猛龍彈簧腿 > 1;奔跑再 +30%
  const kF = (rig.flexF ?? 1) * (1 + 0.3 * runF);
  const kA = (rig.beast ? 0.34 : 0.6) * kF;
  rig.kneeL.rotation.x += (fx(L.ph + qp[0]) + st(L.ph + qp[0]) * 0.35) * kA * a + br(0, 0.03);
  rig.kneeR.rotation.x += (fx(L.ph + qp[1]) + st(L.ph + qp[1]) * 0.35) * kA * a + br(1.8, 0.03);
  // 踝:擺動抬掌 + 觸地載荷下沉再蹬伸回彈(腳掌不跟小腿鎖成一塊)
  rig.ankleL.rotation.x -= (fx(L.ph + qp[0] - 0.5) + st(L.ph + qp[0] - 0.5) * 0.45) * 0.4 * kF * a + br(0.6, 0.02);
  rig.ankleR.rotation.x -= (fx(L.ph + qp[1] - 0.5) + st(L.ph + qp[1] - 0.5) * 0.45) * 0.4 * kF * a + br(2.4, 0.02);
  const eA = 0.4 * (rig.swingArm || 0.4) * kF;
  // 肘:奔跑時人形手肘恆屈泵動(hold ∝ runF),不甩直;獸型前膝照腿的雙相跑
  const eHold = rig.beast ? 0 : 0.3 * runF * a;
  rig.elbowL.rotation.x -= (fx(L.ph + qp[2] - 0.4) + st(L.ph + qp[2] - 0.4) * 0.25) * eA * a + eHold + br(1.2, 0.025);
  rig.elbowR.rotation.x -= (fx(L.ph + qp[3] - 0.4) + st(L.ph + qp[3] - 0.4) * 0.25) * eA * a * (rig.beast ? 1 : 0.5)
    + eHold * 0.6 + br(3.0, 0.025);
  // 腕/前掌:延遲最久的末節(follow-through 的尾巴),幅度加大 —— 擺動相收掌
  // (獸型 = 趾行的收爪、人形 = 手腕自然回勾)、觸地相載荷回折,絕不焊死在前臂上
  const wA = (rig.beast ? 0.34 : 0.22) * kF;
  rig.wristL.rotation.x += (fx(L.ph + qp[2] - 0.9) + st(L.ph + qp[2] - 0.9) * 0.3) * wA * a + br(1.8, 0.02);
  rig.wristR.rotation.x += (fx(L.ph + qp[3] - 0.9) + st(L.ph + qp[3] - 0.9) * 0.3) * wA * a * (rig.beast ? 1 : 0.5) + br(3.6, 0.02);
  // 多節尾(猿猴長尾 / 獸型尾):逐節相位延遲的鞭式擺動 + 急轉時甩向轉向反側 = 配重。
  // 全部疊在 pose(m) 之上(飛行型態 a→0、L.tail 也阻尼歸零 ⇒ 尾自動拉直成尾桁)
  if (rig.tailSegs) {
    L.tail = damp(L.tail ?? 0, clamp(-yawRate * 0.3, -0.5, 0.5) * (1 - m), 3.5, dt);
    rig.tailSegs.forEach((t, i) => {
      t.rotation.y += L.tail * (1 + i * 0.35) + Math.sin(L.ph - i * 0.5) * 0.14 * a;
      t.rotation.x += Math.sin(L.ph * 2 - i * 0.6) * 0.05 * a;
    });
  }
  // 軀幹動態:地面前傾/加減速預備、飛行壓坡入彎 + 巡航俯仰、懸停浮沉
  const topAir = rig.topAir || 30;
  L.roll = damp(L.roll, clamp(-vLat / topAir, -1, 1) * 0.3 * m, 4, dt);
  L.pitch = damp(L.pitch,
    m * clamp(vFwd / topAir, -1, 1) * 0.2
    + (1 - m) * (0.16 * L.amp + clamp(L.accel * 0.015, -0.1, 0.15)), 4, dt);
  rig.torso.rotation.x += L.pitch;
  // 地面體側搖擺(rig.rollSway,巨象側步的重心逐拍換邊;a 已含 1−m ⇒ 飛行自動歸零)
  rig.torso.rotation.z = L.roll + (rig.rollSway || 0) * Math.sin(L.ph) * a;
  // 頭:抵銷軀幹的動態俯仰/側傾(地面步行時鎖平視線;飛行時讓位給 pose —— 機首本來就該跟著航向)
  if (rig.head) {
    const k = (1 - m) * 0.8;
    rig.head.rotation.x -= L.pitch * k;
    rig.head.rotation.z -= L.roll * k;
    L.gaze = damp(L.gaze ?? 0, clamp(yawRate * 0.28, -0.45, 0.45), 3, dt);
    rig.head.rotation.y += idle * Math.sin(now * 0.5) * 0.25    // 靜止:緩慢警戒掃視
      + L.gaze * (1 - m);                                       // 地面入彎凝視(飛行讓位給航向)
  }
  // 地面步態的縱向彈跳 + 飛行浮沉。浮沉只給「活的」擬態獸型(拍翼會產生升力脈動);
  // 定翼/旋翼是機械飛行器 —— 巡航時機體穩定,MUST NOT 讓它跟著上下呼吸(airBob = 0)
  rig.torso.position.y += -(0.5 - 0.5 * Math.cos(L.ph * 2)) * (rig.bob || 0.07) * L.amp
    + m * Math.sin(now * 2.4 + L.ph) * 0.12 * (rig.airBob ?? 1);
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
