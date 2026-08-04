// ============ 對進戰模型(offline,純 Node,無依賴)============
// 使用者定案的戰力平衡原則(2026-07-27):
//   「平衡性調整/戰力平衡策略須考量**攻擊距離**,還有**高度差**;
//     測試時要考慮**從遠處移動到進入射程**,平均**不同高度差**的勝率。」
//
// 舊有 `npm run bal` ①/④ 是「近距平台、無距離衰減、同高度」的靜態站樁模型 —— 射程與高度差
// 對結果完全沒有作用,於是「射程長 1/8 的機種」與「同射程機種」在稽核裡長得一模一樣。
// 本檔補上那兩個維度,是 ⑤ 對進戰不變式的唯一模型縫(`tools/balance.mjs` 匯入使用,
// MUST NOT 在別處另寫第二份對局模型)。
//
// ---- 情境(三階段;攻擊距離與機動同時作用)----
// 1v1、雙方 Lv1(與 ① 同基準:無升級/招式/機種絕招/掩體/補給)。
// ①**接近期**:起始距離 = 雙方最長有效射程 × D_START_F(開場雙方都打不到),以「雙方移速和」
//   相互接近到「較遠的那個偏好交戰距離」。射程較長的一方在這段路上單方面輸出 —— 這就是攻擊距離的價值。
// ②**拉鋸期**:雙方的**偏好交戰距離** = 讓自己「輸出 ÷ 對方輸出」最大的距離(打得到而對方打不到最好;
//   扇形/短射程武器則想貼身)。偏好較近的一方前壓、偏好較遠的一方後撤 ⇒ 淨接近速度 = 兩者移速差
//   (**跑不贏就貼不上**,機動在此換成戰術價值)。後撤方最多讓出 KITE_M 公尺就抵到走廊邊(脫離兵線
//   掩護)必須站住 —— **刻意不模擬無限風箏**:兵線/塔位不允許一方無止境後撤,否則「又快又遠」的組合
//   在模型裡永遠不敗,測不出可用的結論。
// ③**定點期**:距離收斂後互轟到一方倒下。
// **高度差**:dh(A 視線高程 − B)自 −DH_MAX_F 到 +DH_MAX_F 個砲塔高、步長 DH_STEP_F 掃描,
//   逐點打完一場,取平均勝率 —— 對稱掃描 ⇒ 兩造機會均等,勝率偏離 50% 純粹來自戰力差。
//   高度差效果一律經 data.js 的 ALTITUDE/altScale(較高方 +射程 / +閃避、攻擊爆擊↓、受擊爆擊↑)。
//
// ---- 與 server/sim.js 的對齊 ----
// 傷害鏈逐項對齊 heroHit():dmgFalloff(實際距離)→ vsMult → 爆擊(_rollCrit 的期望值)→
// 閃避(_dodges,輕武器直射限定)→ 護盾先扣(不吃護甲)→ 裝甲吃 armorMul(armor, pen)。
// 差別只有「擲骰改期望值」(稽核要確定性,MUST NOT 用 Math.random —— 見全域 A4)與
// 「彈夾/裝填攤平成持續 DPS」(與 bal ①/④ 同一個簡化)。
import { CHARACTERS, UNITS, GAME, VITALS, ALTITUDE, EVASION, altScale, altTier,
  armorMul, vsMult, heroWeapon, charKind, heroArmor, heroMobility, evasionMinSpeed, chargeF,
  dmgFalloff, heavyMpCost, shieldSplit } from '../public/js/data.js';

export const DUEL = {
  DT: 0.05,           // 步進(秒)
  MAX_T: 180,         // 單場上限(秒);超時以剩餘 EHP 比例判勝
  D_START_F: 1.25,    // 起始距離 = 雙方最長有效射程 × 此值(開場雙方都在射程外)
  DH_MAX_F: 3,        // 高度差掃描上限(× 砲塔高;altScale 於此封頂)
  DH_STEP_F: 0.5,     // 高度差掃描步長(× 砲塔高)⇒ 13 個取樣點,涵蓋整段 s∈[0,1] 斜坡
  PREF_STEP_M: 2,     // 偏好交戰距離的掃描解析度(公尺)
  // 後撤方能讓出的地面(公尺)= 兵線走廊半寬:再退就離開走廊與兵線掩護,只能站住。
  // 取 GAME.LANE_SAFE_M 而非另立魔術數字 —— 情境常數也要有遊戲內語意。
  KITE_M: GAME.LANE_SAFE_M,
};

/** 高度差掃描點(公尺,對稱含 0);T = 一個砲塔高 = altScale 的一階高度 */
export function dhSweep() {
  const T = altTier(), out = [];
  for (let k = -DUEL.DH_MAX_F; k <= DUEL.DH_MAX_F + 1e-9; k += DUEL.DH_STEP_F) out.push(k * T);
  return out;
}

/** 較高方射程乘數(對齊 sim._altRange:只有較高的一方拉遠射程) */
const altRangeF = (dh) => (dh > 0 ? 1 + ALTITUDE.RANGE * altScale(dh) : 1);

/** 爆擊期望倍率(對齊 sim._rollCrit + _altCrit:爆率 ×rate、爆傷**加成部分** ×dmg) */
function critF(def, dh) {
  if (!def.crit) return 1;
  const s = altScale(dh);
  let rate = 1, dmgF = 1;
  if (s > 0) {
    if (dh > 0) { rate = 1 - ALTITUDE.ATK_CRIT_RATE * s; dmgF = 1 - ALTITUDE.ATK_CRIT_DMG * s; }
    else { rate = 1 + ALTITUDE.RCV_CRIT_RATE * s; dmgF = 1 + ALTITUDE.RCV_CRIT_DMG * s; }
  }
  const p = Math.max(0, Math.min(1, def.crit * rate));
  return 1 + p * ((def.critX || VITALS.CRIT_X) - 1) * dmgF;
}

/** 閃避期望存活率(對齊 sim._dodges:輕武器直射限定;移動中 + 有效機動 > 門檻;飛行加成;較高方 +DODGE) */
function dodgeP(target, dh) {
  if (target.mob <= evasionMinSpeed()) return 0;   // 重甲慢速機體站著吃彈
  let p = EVASION.GROUND + (target.flying ? EVASION.AIR_BONUS : 0);
  if (dh > 0) p += ALTITUDE.DODGE * altScale(dh);     // 目標比射手高
  return Math.max(0, Math.min(1, p));
}

/** 建一名對局者(Lv1 基準,與 bal ① 同一組解析縫) */
export function fighter(ch, lvl = 1) {
  const kind = charKind(ch), u = UNITS[kind], m = CHARACTERS[ch].mods || {};
  const flying = kind === 'drone';                    // 無人機恆飛行;變形者以地面型入場(高度維度交給 dh 掃描)
  const slots = [];
  for (const id of ['light', 'heavy']) {
    const w = heroWeapon(ch, id, lvl, true);
    if (!w) continue;
    const cycle = w.mag / (w.rate || 3) + w.reload;   // 彈夾週期(含裝填)攤平成持續火力
    slots.push({ def: w, rps: w.mag / cycle, mp: id === 'heavy' ? heavyMpCost(w) : 0 });
  }
  return {
    ch, kind, side: CHARACTERS[ch].side, flying,
    sh0: Math.round(u.shield * (m.sp ?? 1)), ar0: Math.round(u.hp * (m.hp ?? 1)),
    armor: heroArmor(ch),
    mp0: u.mp * (m.mp ?? 1), mpRegen: u.mpRegen * chargeF(0),   // 充能 Lv0(未升級)
    mob: heroMobility(kind, m, flying),
    slots,
  };
}

/**
 * 打一場對進戰。dh = A 相對 B 的視線高程差(公尺,可正可負)。
 * 回傳 { win, t, leftA, leftB, freeA, freeB } —— free* = 該方在「單方面射程優勢期」(自己打得到、
 * 對方還進不了場)打掉對手的 EHP 比例(護甲減免後的實際損失;射程壓制強度指標)。
 */
export function duel(A, B, dh = 0) {
  const st = (F) => ({ f: F, sh: F.sh0, ar: F.ar0, mp: F.mp0, ehp0: F.sh0 + F.ar0 });
  const a = st(A), b = st(B);
  const rF = { a: altRangeF(dh), b: altRangeF(-dh) };            // 較高方 +射程
  const cF = { a: dh, b: -dh };                                  // 各自視角的高度差(爆擊/閃避用)
  // 有效射程(含高度差加成)
  const eff = (S, side) => S.f.slots.map((s) => s.def.range * rF[side]);
  const effA = eff(a, 'a'), effB = eff(b, 'b');

  /**
   * 護盾軸(vsSp/vsHp/spPierce)在「整條 EHP 打完」尺度上的等效倍率 —— **只供偏好距離的啟發式**。
   * 實際交火走 apply() 的逐層拆分(那才是與 sim._damage 對齊的那一份)。
   * 沿用 dpsAt 既有的簡化(護甲減免一律套在全額上),此處只補上分層造成的總量差。
   */
  const shieldEqF = (def, F) => {
    const tot = F.sh0 + F.ar0;
    if (tot <= 0) return 1;
    const { toSp, toHp } = shieldSplit(def, tot, F.sh0);
    return (toSp + toHp) / tot;
  };
  // 距離 dist 上「S 對 T」的每秒傷害(已含射程閘/衰減/克制/爆擊/閃避;電力未計,偏好距離只看火力形狀)
  const dpsAt = (S, T, effR, side, dist) => {
    let v = 0;
    S.f.slots.forEach((s, i) => {
      if (dist > effR[i]) return;
      const dodge = s.def.id === 'light' ? dodgeP(T.f, -cF[side]) : 0;
      v += s.def.dmg * vsMult(s.def, T.f.kind) * shieldEqF(s.def, T.f)
        * dmgFalloff(s.def, dist) * critF(s.def, cF[side]) * (1 - dodge) * s.rps
        * armorMul(T.f.armor, s.def.pen);                        // 交換比要看「打進去的」傷害
    });
    return v;
  };
  /** 偏好交戰距離 = 讓「自身輸出 ÷ 對方輸出」最大的距離(對方打不到時取自身輸出最高的那點) */
  const prefer = (S, T, effR, oppR, side, oppSide) => {
    const max = Math.max(...effR);
    let best = 0, bestScore = -1;
    for (let dist = DUEL.PREF_STEP_M; dist <= max + 1e-9; dist += DUEL.PREF_STEP_M) {
      const mine = dpsAt(S, T, effR, side, dist);
      if (mine <= 0) continue;
      const theirs = dpsAt(T, S, oppR, oppSide, dist);
      const score = mine / Math.max(theirs, 1e-6);
      if (score > bestScore + 1e-9) { bestScore = score; best = dist; }
    }
    return best || max;
  };
  const prefA = prefer(a, b, effA, effB, 'a', 'b');
  const prefB = prefer(b, a, effB, effA, 'b', 'a');
  const dNear = Math.min(prefA, prefB), dFar = Math.max(prefA, prefB);
  // 拉鋸:偏好近的一方前壓、偏好遠的一方後撤 ⇒ 淨接近速度 = 移速差(跑不贏就貼不上)
  const pushMob = prefA <= prefB ? A.mob : B.mob;
  const backMob = prefA <= prefB ? B.mob : A.mob;
  let retreatLeft = DUEL.KITE_M;                                  // 後撤方還能讓出的地面(公尺)
  let d = Math.max(...effA, ...effB) * DUEL.D_START_F;
  const close = A.mob + B.mob;                                    // 接近期:雙方同時前進

  // 雙層拆分走 shieldSplit(與 sim._damage 同一支;含反護盾/穿盾/反裝甲三型)→ 裝甲層吃 armorMul
  const apply = (T, dmg, pen, def) => {
    const { toSp, toHp } = shieldSplit(def, dmg, Math.max(0, T.sh));
    T.sh -= toSp;
    T.ar -= toHp * armorMul(T.f.armor, pen);
  };
  // 逐槽位分開結算(pen 不同 ⇒ 不能先加總再套 armorMul)
  const strike = (S, T, effR, side, dist, dt) => {
    const before = T.sh + T.ar;
    let mpUse = 0;
    S.f.slots.forEach((s, i) => {
      if (dist > effR[i]) return;
      if (s.def.id === 'heavy' && S.mp < s.mp) return;
      const dodge = s.def.id === 'light' ? dodgeP(T.f, -cF[side]) : 0;
      const dmg = s.def.dmg * vsMult(s.def, T.f.kind)
        * dmgFalloff(s.def, dist) * critF(s.def, cF[side]) * (1 - dodge) * s.rps * dt;
      apply(T, dmg, s.def.pen, s.def);
      if (s.def.id === 'heavy') mpUse += s.mp * s.rps * dt;
    });
    S.mp = Math.min(S.f.mp0, S.mp - mpUse + S.f.mpRegen * dt);
    return before - (T.sh + T.ar);                                 // 實際 EHP 損失(護甲減免後)
  };

  let t = 0, freeA = 0, freeB = 0;
  const inR = (effR, dist) => effR.some((r) => dist <= r);
  while (t < DUEL.MAX_T && a.sh + a.ar > 0 && b.sh + b.ar > 0) {
    const dt = DUEL.DT;
    const aFires = inR(effA, d), bFires = inR(effB, d);
    const dA = strike(a, b, effA, 'a', d, dt);
    const dB = strike(b, a, effB, 'b', d, dt);
    if (aFires && !bFires) freeA += dA;                          // 單方面射程優勢期
    if (bFires && !aFires) freeB += dB;
    if (d > dFar) {
      d = Math.max(dFar, d - close * dt);                        // ①接近期:雙方同時前進
    } else if (d > dNear) {                                      // ②拉鋸期:前壓 vs 後撤
      const back = retreatLeft > 0 ? Math.min(backMob, retreatLeft / dt) : 0;
      retreatLeft = Math.max(0, retreatLeft - back * dt);
      d = Math.max(dNear, d - Math.max(0, pushMob - back) * dt);
    }                                                            // ③定點期:d 已收斂
    t += dt;
  }
  const leftA = (a.sh + a.ar) / a.ehp0, leftB = (b.sh + b.ar) / b.ehp0;
  const win = leftA <= 0 && leftB <= 0 ? 0.5 : leftA <= 0 ? 0 : leftB <= 0 ? 1
    : leftA === leftB ? 0.5 : (leftA > leftB ? 1 : 0);
  return { win, t, leftA, leftB, freeA: freeA / b.ehp0, freeB: freeB / a.ehp0 };
}

/** A 對 B 在整段高度差掃描上的平均勝率 + 最大單方面射程壓制量 */
export function duelSweep(A, B, sweep = dhSweep()) {
  let win = 0, free = 0, freeAgainst = 0;
  for (const dh of sweep) {
    const r = duel(A, B, dh);
    win += r.win; free = Math.max(free, r.freeA); freeAgainst = Math.max(freeAgainst, r.freeB);
  }
  return { win: win / sweep.length, free, freeAgainst };
}

/** 全角色對全角色(排除自我對局)的勝率矩陣;回傳 { fighters, rate[ch][ch2], avg[ch] } */
export function duelMatrix(chs = Object.keys(CHARACTERS)) {
  const F = Object.fromEntries(chs.map((c) => [c, fighter(c)]));
  const sweep = dhSweep();
  const rate = {}, free = {};
  for (const a of chs) {
    rate[a] = {}; free[a] = {};
    for (const b of chs) {
      if (a === b) continue;
      const r = duelSweep(F[a], F[b], sweep);
      rate[a][b] = r.win; free[a][b] = r.free;
    }
  }
  const avg = Object.fromEntries(chs.map((a) => {
    const v = Object.values(rate[a]);
    return [a, v.reduce((s, x) => s + x, 0) / v.length];
  }));
  return { F, rate, free, avg, sweep };
}

/** 逐高度差分層的陣營勝率(SWARM 視角):驗「高地優勢不會讓某陣營通吃」 */
export function sideRateByDh(chs = Object.keys(CHARACTERS)) {
  const F = Object.fromEntries(chs.map((c) => [c, fighter(c)]));
  const sw = chs.filter((c) => charKind(c) === 'drone');
  const st = chs.filter((c) => charKind(c) === 'robot');
  return dhSweep().map((dh) => {
    let win = 0, n = 0;
    for (const a of sw) for (const b of st) { win += duel(F[a], F[b], dh).win; n++; }
    return { dh, rate: win / n };
  });
}
