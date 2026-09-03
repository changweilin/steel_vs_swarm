// ============ 機體平衡性測試五大戰鬥情境模擬引擎: tools/combat_scenarios.mjs ============
// 依據使用者需求重新設計之五大戰鬥情境:
//
// 1. 戰鬥情境 1_遠戰:
//    - 雙方從彼此武器招式射程外開始 (d0 > max(Ra, Rb) * 1.35)。
//    - 拉近距離戰鬥。
//    - 場中設有建築障礙物，射程不足/被拉開距離時尋找掩體破壞 LOS。
//    - 長射程者在射程內拉開距離 (kiting, 最多讓出 KITE_M 避免無限風箏)；短射程者運用掩體與位移技能拉近。
//
// 2. 戰鬥情境 2_近戰:
//    - 雙方從彼此武器招式射程內開始 (d0 <= min(Ra, Rb))。
//    - 站立不動對射 (不進行走位)，純粹考驗站樁 DPS、護盾/裝甲承傷、攻速與武器穿甲。
//
// 3. 戰鬥情境 3_守塔:
//    - 迷你地圖戰鬥，雙方各有一座前線砲塔 (x = ∓Dsep / 2)。
//    - 不可退到砲塔後面 (邊界硬限制)。
//    - 砲塔對進入射程之敵機開火。具備站外攻堅射程者可在塔外削弱敵塔。
//    - 先擊殺對手或摧毀敵方砲塔者獲勝。
//
// 4. 戰鬥情境 4_迷霧:
//    - 雙方在狙擊視野外搜敵 (d0 > 320m)。
//    - 有迷霧 (依 sight 判定) 與建築物件遮蔽視線。
//    - 逐 tick 視野判定，高視野/飛行者享先手機會，短射程者利用建築轉角脫鎖埋伏。
//
// 5. 戰鬥情境 5_無雙:
//    - 依遊戲出兵距離放置 4 波小兵部隊 (waveComp())。
//    - 比誰最快全部擊殺 (測量 TTK 與存活率)。
//
// 通用規範:
// - 飛行單位佔據高處開始 (y = 39m)，地面單位在平地上 (y = 0)。
// - 變形者 (morph) 輪流測試地面模式 (50%) 與飛行模式 (50%)。
// - 全部沒有升級 (Lv1) 與 全部升級滿 (Lv4) 輪流測試。
// - 射程較短者盡可能拉近距離，被拉開距離時找掩體；較遠者在射程範圍內拉開距離。
// - 有移動技能招式 (dash, leap, haste, pull) 盡可能用招式控制距離。
// - 飛行機體受擊時觸發失衡負面效果 (FLIGHT.UNBAL_*) 與高地壓制 (HIGH_SUP)。
// - 平衡性測試勝率誤差在 +-5% 以內 (45% ~ 55%)。

import {
  CHARACTERS, UNITS, GAME, VITALS, ALTITUDE, EVASION, SQUAD, FLIGHT, ECON,
  evadeExpF, altScale, altTier, armorMul, vsMult, heroWeapon, heroAbility,
  charKind, heroArmor, heroMobility, evasionMinSpeed, chargeF, dmgFalloff,
  heavyMpCost, shieldSplit, HIGH_SUP, highSupF, highSupDodgeF, highSupSpeedF,
  highSupMissP, unbalMissP, waveComp, waveMarchSpeed, waveSpacingM,
  tierVal, TARGET_R, aoeClass, blastFalloff, fanFalloff,
} from '../public/js/data.js';

export const SCENARIO = {
  DT: 0.1,             // 步進秒數 (伺服器 tick 級別,兼顧速度與精度)
  MAX_T: 180,          // 單場時間上限 (秒)
  FLY_Y: 39,           // 飛行初始高程 (1.5 個砲塔高, 涵蓋 altScale 常用高地帶)
  ALT_TIER: 26,        // 砲塔高度基準
  KITE_M: GAME.LANE_SAFE_M || 45, // 風箏後撤上限距離 (公尺)
};

const MAX_TIER = 1 + (ECON.UPGRADES?.lw?.max ?? 3); // 滿級階 (Lv4)

/**
 * 建立一名受測對局者。
 * @param {string} ch 角色 ID (如 's01', 't01')
 * @param {number} lvl 等級 (1: 無升級, 4: 滿級)
 * @param {'ground'|'flight'} [morphMode='ground'] 變形者模式
 */
export function createFighter(ch, lvl = 1, morphMode = 'ground') {
  const kind = charKind(ch);
  const u = UNITS[kind];
  const m = CHARACTERS[ch].mods || {};
  const isDrone = kind === 'drone';
  const isMorph = kind === 'morph';

  const flying = isDrone || (isMorph && morphMode === 'flight');
  const y = flying ? SCENARIO.FLY_Y : 0;

  const isMax = lvl >= MAX_TIER;
  const U = ECON.UPGRADES;
  const hpUpg = isMax && U?.hp ? 1 + U.hp.step * U.hp.max : 1;
  const spUpg = isMax && U?.sp ? 1 + U.sp.step * U.sp.max : 1;
  const arBonus = isMax && U?.ar ? U.ar.step * U.ar.max : 0;
  const chLvl = isMax && U?.ch ? U.ch.max : 0;

  const n = isDrone ? SQUAD.N : 1;
  let ar0 = Math.round(u.hp * (m.hp ?? 1) * hpUpg) * n;
  let sh0 = Math.round(u.shield * (m.sp ?? 1) * spUpg) * n;
  let armor = heroArmor(ch) + arBonus;

  let mp0 = u.mp * (m.mp ?? 1);
  let mpRegen = (u.mpRegen ?? 4) * chargeF(chLvl);

  let mob = heroMobility(kind, m, flying);

  const slots = [];
  for (const id of ['light', 'heavy']) {
    const w = heroWeapon(ch, id, lvl, true);
    if (!w) continue;
    const cycle = (w.mag / (w.rate || 3)) + (w.reload || 2);
    slots.push({
      id,
      def: w,
      rps: w.mag / cycle,
      mp: id === 'heavy' ? heavyMpCost(w) : 0,
      range: w.range,
      mag: w.mag,
      rate: w.rate,
      reload: w.reload,
    });
  }

  const abilities = [];
  for (const slot of ['skill', 'ult']) {
    const a = heroAbility(ch, slot, lvl);
    if (a) {
      abilities.push({
        slot,
        def: a,
        cd: a.cd || 15,
        mp: a.mp || 30,
        range: a.range || 0,
        imp: a.imp || 0,
        dur: a.dur || 0,
        isDash: a.fx === 'dash',
        isLeap: a.add?.fx === 'leap',
        isHaste: a.add?.fx === 'haste',
        isPull: a.add?.fx === 'pull',
        isDmg: (a.dmg || 0) > 0,
      });
    }
  }

  const maxRange = Math.max(...slots.map((s) => s.range), 50);
  const sight = u.sight || 240;

  return {
    ch,
    kind,
    side: CHARACTERS[ch].side,
    flying,
    y,
    lvl,
    morphMode,
    sh0,
    ar0,
    ehp0: sh0 + ar0,
    armor,
    mp0,
    mpRegen,
    mob,
    slots,
    abilities,
    maxRange,
    sight,
  };
}

/** 爆擊期望倍率 */
function calcCritF(def, dh) {
  if (!def.crit) return 1;
  const s = altScale(dh);
  let rate = 1, dmgF = 1;
  if (s > 0) {
    if (dh > 0) {
      rate = 1 - ALTITUDE.ATK_CRIT_RATE * s;
      dmgF = 1 - ALTITUDE.ATK_CRIT_DMG * s;
    } else {
      rate = 1 + ALTITUDE.RCV_CRIT_RATE * s;
      dmgF = 1 + ALTITUDE.RCV_CRIT_DMG * s;
    }
  }
  const p = Math.max(0, Math.min(1, def.crit * rate));
  return 1 + p * ((def.critX || VITALS.CRIT_X) - 1) * dmgF;
}

/** 閃避機率 */
function calcDodgeP(targetFighter, targetState, dh) {
  if (targetFighter.mob <= evasionMinSpeed()) return 0;
  let p = EVASION.GROUND + (targetFighter.flying ? EVASION.AIR_BONUS : 0);
  if (dh > 0) p += ALTITUDE.DODGE * altScale(dh);
  return Math.max(0, Math.min(EVASION.P_MAX, p)) * highSupDodgeF(targetState.sup || 0);
}

/** 傷害扣減單一縫: 吃 shieldSplit 與 armorMul */
function applyDamage(targetState, dmg, pen, def) {
  const { toSp, toHp } = shieldSplit(def, dmg, Math.max(0, targetState.sh));
  targetState.sh -= toSp;
  targetState.ar -= toHp * armorMul(targetState.f.armor, pen);
}

/** 計算攻擊傷害輸出 (不立刻扣血，支援同步結算) */
function calcStrikeDamage(shooterState, targetState, dist, dt, cDh, losBlocked = false) {
  if (losBlocked) return { mpUse: 0, hits: [] };
  if (shooterState.sh + shooterState.ar <= 0 || targetState.sh + targetState.ar <= 0) {
    return { mpUse: 0, hits: [] };
  }

  const S = shooterState;
  const T = targetState;
  let mpUse = 0;
  const hits = [];

  const isUnbal = S.unbalUntil > S.tNow;
  const unbalCritMul = isUnbal ? FLIGHT.UNBAL_CRIT_MUL : 1;

  // 增益傷害倍率
  let buffDmgMul = 1;
  for (const ab of S.abCooldowns) {
    if (ab.activeDur > 0 && ab.def.mul?.dmg) {
      const mul = Array.isArray(ab.def.mul.dmg) ? ab.def.mul.dmg[0] : ab.def.mul.dmg;
      buffDmgMul *= mul;
    }
  }

  // 高度計算: shooterY - targetY (>0 表示射擊者居高臨下)
  const shooterY = S.f.flying ? SCENARIO.FLY_Y : 0;
  const targetY = T.f.flying ? SCENARIO.FLY_Y : 0;
  const dh = targetY - shooterY;

  for (const s of S.f.slots) {
    if (dist > s.range) continue;
    if (s.id === 'heavy' && S.mp < s.mp) continue;

    const baseMiss = calcDodgeP(T.f, T, dh);
    const supHit = 1 - highSupMissP(0, S.sup || 0);
    const unbalHit = isUnbal ? FLIGHT.UNBAL_ACC_MUL : 1;
    const hitF = evadeExpF(s.def, baseMiss) * supHit * unbalHit;

    let cF = calcCritF(s.def, dh);
    if (isUnbal) cF = 1 + (cF - 1) * unbalCritMul;

    const dmg = s.def.dmg * vsMult(s.def, T.f.kind)
      * dmgFalloff(s.def, dist) * cF * hitF * s.rps * buffDmgMul * dt;

    if (dmg > 0) {
      hits.push({ dmg, pen: s.def.pen, def: s.def, isHeavy: s.id === 'heavy' });
    }
    if (s.id === 'heavy') mpUse += s.mp * s.rps * dt;
  }

  // 召喚物支援火力 (如 s01 召喚武裝直升機)
  for (const ab of S.abCooldowns) {
    if (ab.activeDur > 0 && ab.def.fx === 'summon') {
      const uKey = ab.def.unit || 'heli';
      const u = UNITS[uKey];
      if (u) {
        const count = Array.isArray(ab.def.count) ? ab.def.count[0] : (ab.def.count || 2);
        const sDmg = (u.dmg || 20) * (u.rate || 0.8) * count * vsMult(u, T.f.kind) * dt;
        hits.push({ dmg: sDmg, pen: u.armor || 6, def: u, isHeavy: false });
      }
    }
  }

  return { mpUse, hits };
}

/** 施放戰鬥主動技能 (傷害、治療、增益、召喚) */
function castCombatAbilities(S, T, dist, dt) {
  for (const ab of S.abCooldowns) {
    if (ab.cdLeft <= 0 && S.mp >= ab.mp) {
      const aDef = ab.def;
      const abRange = ab.range || sRangeMax(S.f);

      if (ab.isDmg && dist <= abRange) {
        ab.cdLeft = ab.cd;
        S.mp -= ab.mp;
        const count = Array.isArray(aDef.count) ? aDef.count[0] : (aDef.count || 1);
        const dmgPerHit = (Array.isArray(aDef.dmg) ? aDef.dmg[0] : (aDef.dmg || 0)) * vsMult(aDef, T.f.kind);
        const totalDmg = dmgPerHit * count;
        if (totalDmg > 0) {
          applyDamage(T, totalDmg, aDef.pen || 0, aDef);
          if (T.f.flying) T.unbalUntil = S.tNow + FLIGHT.UNBAL_S;
        }
      } else if (aDef.fx === 'heal') {
        ab.cdLeft = ab.cd;
        S.mp -= ab.mp;
        const healVal = Array.isArray(aDef.heal) ? aDef.heal[0] : (aDef.heal || 150);
        if (aDef.sp) S.sh = Math.min(S.f.sh0, S.sh + healVal);
        else S.ar = Math.min(S.f.ar0, S.ar + healVal);
      } else if (aDef.fx === 'buff') {
        ab.cdLeft = ab.cd;
        S.mp -= ab.mp;
        ab.activeDur = Array.isArray(aDef.dur) ? aDef.dur[0] : (aDef.dur || 6);
      } else if (aDef.fx === 'summon') {
        ab.cdLeft = ab.cd;
        S.mp -= ab.mp;
        ab.activeDur = 10;
      }
    }
  }
}

function sRangeMax(f) {
  return Math.max(...f.slots.map((s) => s.range), 50);
}

function sRangeMin(f) {
  return Math.min(...f.slots.map((s) => s.range), 50);
}

function initState(f, kiteBudget = SCENARIO.KITE_M) {
  return {
    f,
    sh: f.sh0,
    ar: f.ar0,
    ehp0: f.ehp0,
    mp: f.mp0,
    x: 0,
    sup: 0,
    supUntil: -1,
    unbalUntil: -1,
    tNow: 0,
    abCooldowns: f.abilities.map((a) => ({ ...a, cdLeft: 0, activeDur: 0 })),
    retreatLeft: kiteBudget,
  };
}

function tickAbilities(S, dt) {
  for (const ab of S.abCooldowns) {
    if (ab.cdLeft > 0) ab.cdLeft -= dt;
    if (ab.activeDur > 0) ab.activeDur -= dt;
  }
}

function tryMobilityAbility(S, targetDist, wantCloser, dt) {
  for (const ab of S.abCooldowns) {
    if (ab.cdLeft <= 0 && S.mp >= ab.mp) {
      if (wantCloser && (ab.isDash || ab.isLeap)) {
        ab.cdLeft = ab.cd;
        S.mp -= ab.mp;
        return ab.imp || 30;
      }
      if (!wantCloser && ab.isDash) {
        ab.cdLeft = ab.cd;
        S.mp -= ab.mp;
        return -(ab.imp || 30);
      }
      if (ab.isHaste && ab.activeDur <= 0) {
        ab.cdLeft = ab.cd;
        ab.activeDur = ab.dur || 6;
        S.mp -= ab.mp;
      }
      if (wantCloser && ab.isPull && targetDist <= (ab.range || 150)) {
        ab.cdLeft = ab.cd;
        S.mp -= ab.mp;
        return (ab.imp || 25);
      }
    }
  }
  return 0;
}

function effectiveSpeed(S) {
  let spd = S.f.mob * highSupSpeedF(S.sup);
  const hasteAb = S.abCooldowns.find((a) => a.isHaste && a.activeDur > 0);
  if (hasteAb) spd *= 1.3;
  return spd;
}

function decideWinner(a, b) {
  const leftA = Math.max(0, (a.sh + a.ar) / a.ehp0);
  const leftB = Math.max(0, (b.sh + b.ar) / b.ehp0);
  if (leftA <= 0 && leftB <= 0) return 0.5;
  if (leftA <= 0) return 0;
  if (leftB <= 0) return 1;
  const diff = leftA - leftB;
  if (Math.abs(diff) < 1e-4) return 0.5;
  return diff > 0 ? 1 : 0;
}

// =========================================================================
// 戰鬥情境 1: 遠戰 (Ranged approach + Obstacles / Cover)
// =========================================================================
export function simulateScenario1_Ranged(A, B) {
  const a = initState(A, 250);
  const b = initState(B, 250);
  const cDhA = A.y - B.y;

  const rMaxA = sRangeMax(A);
  const rMaxB = sRangeMax(B);
  let dist = Math.max(rMaxA, rMaxB) * 1.35;

  const d0 = dist;
  const obs1 = d0 * 0.4;
  const obs2 = d0 * 0.7;
  const obsW = 16;

  let t = 0;
  const dt = SCENARIO.DT;

  while (t < SCENARIO.MAX_T && a.sh + a.ar > 0 && b.sh + b.ar > 0) {
    a.tNow = t;
    b.tNow = t;
    if (t >= a.supUntil) a.sup = 0;
    if (t >= b.supUntil) b.sup = 0;
    tickAbilities(a, dt);
    tickAbilities(b, dt);

    const aCanHit = dist <= rMaxA;
    const bCanHit = dist <= rMaxB;

    // 掩體判定: 射程短者在被長射程壓制時，經過場中地物掩體獲得減免防護
    let coverProtA = 0, coverProtB = 0;
    const nearObs = Math.abs(dist - obs1) < obsW || Math.abs(dist - obs2) < obsW;
    if (nearObs) {
      if (bCanHit && !aCanHit) coverProtA = 0.6; // A 受掩體保護
      else if (aCanHit && !bCanHit) coverProtB = 0.6; // B 受掩體保護
    }

    // 施放主動戰鬥技能 (傷害、治療、增益、召喚)
    castCombatAbilities(a, b, dist, dt);
    castCombatAbilities(b, a, dist, dt);

    // 計算打擊 (同步結算)
    const strikeA = calcStrikeDamage(a, b, dist, dt, cDhA, false);
    const strikeB = calcStrikeDamage(b, a, dist, dt, -cDhA, false);

    a.mp = Math.min(a.f.mp0, a.mp - strikeA.mpUse + a.f.mpRegen * dt);
    b.mp = Math.min(b.f.mp0, b.mp - strikeB.mpUse + b.f.mpRegen * dt);

    let heavyHitB = false;
    const dealtB = strikeA.hits.reduce((acc, h) => {
      const prev = b.sh + b.ar;
      const prot = (h.def.guide || h.def.trajClass === 'lob') ? 0 : coverProtB;
      applyDamage(b, h.dmg * (1 - prot), h.pen, h.def);
      if (h.isHeavy) heavyHitB = true;
      return acc + (prev - (b.sh + b.ar));
    }, 0);

    let heavyHitA = false;
    const dealtA = strikeB.hits.reduce((acc, h) => {
      const prev = a.sh + a.ar;
      const prot = (h.def.guide || h.def.trajClass === 'lob') ? 0 : coverProtA;
      applyDamage(a, h.dmg * (1 - prot), h.pen, h.def);
      if (h.isHeavy) heavyHitA = true;
      return acc + (prev - (a.sh + a.ar));
    }, 0);

    if (dealtB > 0) {
      if (cDhA > 0) { const f = highSupF(cDhA); if (f > 0) { b.sup = Math.max(b.sup, f); b.supUntil = t + HIGH_SUP.DUR_S; } }
      if (b.f.flying && heavyHitB) b.unbalUntil = t + FLIGHT.UNBAL_S;
    }
    if (dealtA > 0) {
      if (-cDhA > 0) { const f = highSupF(-cDhA); if (f > 0) { a.sup = Math.max(a.sup, f); a.supUntil = t + HIGH_SUP.DUR_S; } }
      if (a.f.flying && heavyHitA) a.unbalUntil = t + FLIGHT.UNBAL_S;
    }

    // 機動與風箏拉鋸 (長射程者在自身射程內拉開距離，短射程者盡可能拉近距離)
    const longRangeA = rMaxA > rMaxB;
    const longRangeB = rMaxB > rMaxA;

    const spdA = effectiveSpeed(a);
    const spdB = effectiveSpeed(b);

    if (dist > Math.max(rMaxA, rMaxB)) {
      // 雙方自射程外拉近
      dist = Math.max(Math.max(rMaxA, rMaxB) * 0.95, dist - (spdA + spdB) * dt);
    } else if (dist > Math.min(rMaxA, rMaxB)) {
      // 處於長射程優勢帶: 長射程方保持在優勢射程 (超越敵方射程帶) 風箏開火
      if (longRangeA) {
        const prefA = Math.min(rMaxA * 0.96, rMaxB + 8);
        const shiftB = tryMobilityAbility(b, dist, true, dt);
        dist -= shiftB;
        if (dist < prefA && a.retreatLeft > 0) {
          const ret = Math.min(spdA, a.retreatLeft / dt);
          a.retreatLeft = Math.max(0, a.retreatLeft - ret * dt);
          dist = Math.min(rMaxA * 0.98, dist + (ret - spdB) * dt);
        } else if (dist > prefA) {
          dist = Math.max(prefA, dist - spdB * dt);
        }
      } else if (longRangeB) {
        const prefB = Math.min(rMaxB * 0.96, rMaxA + 8);
        const shiftA = tryMobilityAbility(a, dist, true, dt);
        dist -= shiftA;
        if (dist < prefB && b.retreatLeft > 0) {
          const ret = Math.min(spdB, b.retreatLeft / dt);
          b.retreatLeft = Math.max(0, b.retreatLeft - ret * dt);
          dist = Math.min(rMaxB * 0.98, dist + (ret - spdA) * dt);
        } else if (dist > prefB) {
          dist = Math.max(prefB, dist - spdA * dt);
        }
      } else {
        dist = Math.max(20, dist - (spdA + spdB) * 0.5 * dt);
      }
    } else {
      // 雙方皆在射程內: 短射程方持續壓迫，長射程方若有後撤餘額則微拉距離
      if (longRangeA && a.retreatLeft > 0) {
        const ret = Math.min(spdA * 0.5, a.retreatLeft / dt);
        a.retreatLeft = Math.max(0, a.retreatLeft - ret * dt);
        dist = Math.min(rMaxA, dist + (ret - spdB * 0.5) * dt);
      } else if (longRangeB && b.retreatLeft > 0) {
        const ret = Math.min(spdB * 0.5, b.retreatLeft / dt);
        b.retreatLeft = Math.max(0, b.retreatLeft - ret * dt);
        dist = Math.min(rMaxB, dist + (ret - spdA * 0.5) * dt);
      } else {
        dist = Math.max(15, dist - (spdA + spdB) * 0.2 * dt);
      }
    }

    t += dt;
  }

  const win = decideWinner(a, b);
  const leftA = Math.max(0, (a.sh + a.ar) / a.ehp0);
  const leftB = Math.max(0, (b.sh + b.ar) / b.ehp0);
  return { win, t, leftA, leftB, scenario: 1 };
}

// =========================================================================
// 戰鬥情境 2: 近戰 (Close stand-and-shoot, no movement)
// =========================================================================
export function simulateScenario2_Melee(A, B) {
  const a = initState(A, 0);
  const b = initState(B, 0);
  const cDhA = A.y - B.y;

  const dist = Math.min(sRangeMin(A), sRangeMin(B), 30);

  let t = 0;
  const dt = SCENARIO.DT;

  while (t < SCENARIO.MAX_T && a.sh + a.ar > 0 && b.sh + b.ar > 0) {
    a.tNow = t;
    b.tNow = t;
    if (t >= a.supUntil) a.sup = 0;
    if (t >= b.supUntil) b.sup = 0;
    tickAbilities(a, dt);
    tickAbilities(b, dt);

    // 施放主動戰鬥技能
    castCombatAbilities(a, b, dist, dt);
    castCombatAbilities(b, a, dist, dt);

    const strikeA = calcStrikeDamage(a, b, dist, dt, cDhA, false);
    const strikeB = calcStrikeDamage(b, a, dist, dt, -cDhA, false);

    a.mp = Math.min(a.f.mp0, a.mp - strikeA.mpUse + a.f.mpRegen * dt);
    b.mp = Math.min(b.f.mp0, b.mp - strikeB.mpUse + b.f.mpRegen * dt);

    let heavyHitB = false;
    const dealtB = strikeA.hits.reduce((acc, h) => {
      const prev = b.sh + b.ar;
      applyDamage(b, h.dmg, h.pen, h.def);
      if (h.isHeavy) heavyHitB = true;
      return acc + (prev - (b.sh + b.ar));
    }, 0);

    let heavyHitA = false;
    const dealtA = strikeB.hits.reduce((acc, h) => {
      const prev = a.sh + a.ar;
      applyDamage(a, h.dmg, h.pen, h.def);
      if (h.isHeavy) heavyHitA = true;
      return acc + (prev - (a.sh + a.ar));
    }, 0);

    if (dealtB > 0) {
      if (cDhA > 0) { const f = highSupF(cDhA); if (f > 0) { b.sup = Math.max(b.sup, f); b.supUntil = t + HIGH_SUP.DUR_S; } }
      if (b.f.flying && heavyHitB) b.unbalUntil = t + FLIGHT.UNBAL_S;
    }
    if (dealtA > 0) {
      if (-cDhA > 0) { const f = highSupF(-cDhA); if (f > 0) { a.sup = Math.max(a.sup, f); a.supUntil = t + HIGH_SUP.DUR_S; } }
      if (a.f.flying && heavyHitA) a.unbalUntil = t + FLIGHT.UNBAL_S;
    }

    t += dt;
  }

  const win = decideWinner(a, b);
  const leftA = Math.max(0, (a.sh + a.ar) / a.ehp0);
  const leftB = Math.max(0, (b.sh + b.ar) / b.ehp0);
  return { win, t, leftA, leftB, scenario: 2 };
}

// =========================================================================
// 戰鬥情境 3: 守塔 (Tower defense, mini map, no retreat behind turret)
// =========================================================================
export function simulateScenario3_Tower(A, B) {
  const a = initState(A);
  const b = initState(B);
  const cDhA = A.y - B.y;

  const towerSep = UNITS.tower.range * (GAME.TOWER_SEP_F || 1.2);
  const towerHp = UNITS.tower.hp;
  const towerArmor = UNITS.tower.armor;
  const towerDmg = UNITS.tower.dmg;
  const towerRate = UNITS.tower.rate;
  const towerRange = UNITS.tower.range;

  let towerHpA = towerHp;
  let towerHpB = towerHp;

  const towerPosA = -towerSep / 2;
  const towerPosB = towerSep / 2;

  // 初始位置: 塔前方 25m
  a.x = towerPosA + 25;
  b.x = towerPosB - 25;

  let t = 0;
  const dt = SCENARIO.DT;

  while (t < SCENARIO.MAX_T && a.sh + a.ar > 0 && b.sh + b.ar > 0 && towerHpA > 0 && towerHpB > 0) {
    a.tNow = t;
    b.tNow = t;
    if (t >= a.supUntil) a.sup = 0;
    if (t >= b.supUntil) b.sup = 0;
    tickAbilities(a, dt);
    tickAbilities(b, dt);

    const distAB = Math.abs(b.x - a.x);
    const distToTowerB = Math.abs(towerPosB - a.x);
    const distToTowerA = Math.abs(b.x - towerPosA);

    // 施放主動戰鬥技能
    castCombatAbilities(a, b, distAB, dt);
    castCombatAbilities(b, a, distAB, dt);

    const strikeA = calcStrikeDamage(a, b, distAB, dt, cDhA, false);
    const strikeB = calcStrikeDamage(b, a, distAB, dt, -cDhA, false);

    a.mp = Math.min(a.f.mp0, a.mp - strikeA.mpUse + a.f.mpRegen * dt);
    b.mp = Math.min(b.f.mp0, b.mp - strikeB.mpUse + b.f.mpRegen * dt);

    let heavyHitB = false;
    const dealtB = strikeA.hits.reduce((acc, h) => {
      const prev = b.sh + b.ar;
      applyDamage(b, h.dmg, h.pen, h.def);
      if (h.isHeavy) heavyHitB = true;
      return acc + (prev - (b.sh + b.ar));
    }, 0);

    let heavyHitA = false;
    const dealtA = strikeB.hits.reduce((acc, h) => {
      const prev = a.sh + a.ar;
      applyDamage(a, h.dmg, h.pen, h.def);
      if (h.isHeavy) heavyHitA = true;
      return acc + (prev - (a.sh + a.ar));
    }, 0);

    if (dealtB > 0) {
      if (cDhA > 0) { const f = highSupF(cDhA); if (f > 0) { b.sup = Math.max(b.sup, f); b.supUntil = t + HIGH_SUP.DUR_S; } }
      if (b.f.flying && heavyHitB) b.unbalUntil = t + FLIGHT.UNBAL_S;
    }
    if (dealtA > 0) {
      if (-cDhA > 0) { const f = highSupF(-cDhA); if (f > 0) { a.sup = Math.max(a.sup, f); a.supUntil = t + HIGH_SUP.DUR_S; } }
      if (a.f.flying && heavyHitA) a.unbalUntil = t + FLIGHT.UNBAL_S;
    }

    // 攻打防禦塔 (若在射程內)
    if (distToTowerB <= sRangeMax(A)) {
      const dps = A.slots.reduce((s, slot) => {
        if (distToTowerB > slot.range) return s;
        return s + slot.def.dmg * vsMult(slot.def, 'tower') * armorMul(towerArmor, slot.def.pen) * slot.rps;
      }, 0);
      towerHpB -= dps * dt;
    }

    if (distToTowerA <= sRangeMax(B)) {
      const dps = B.slots.reduce((s, slot) => {
        if (distToTowerA > slot.range) return s;
        return s + slot.def.dmg * vsMult(slot.def, 'tower') * armorMul(towerArmor, slot.def.pen) * slot.rps;
      }, 0);
      towerHpA -= dps * dt;
    }

    // 防禦塔反擊 (只有敵人在砲塔射程內才會被砲塔攻擊)
    if (distToTowerA <= towerRange) {
      applyDamage(b, towerDmg * towerRate * dt, 14, { id: 'tower', vs: { flesh: 1, armor: 1.25, air: 1 } });
    }
    if (distToTowerB <= towerRange) {
      applyDamage(a, towerDmg * towerRate * dt, 14, { id: 'tower', vs: { flesh: 1, armor: 1.25, air: 1 } });
    }

    // 機動推進與守塔退守: 不可退到砲塔後面 (a.x >= towerPosA, b.x <= towerPosB)
    const spdA = effectiveSpeed(a);
    const spdB = effectiveSpeed(b);

    const rMaxA = sRangeMax(A);
    const rMaxB = sRangeMax(B);

    // 若受到近身威脅，長射程守方可依託己方防禦塔退守 (不超過己方防禦塔坐標)
    if (distAB < Math.min(rMaxA, rMaxB) * 0.8) {
      if (rMaxB > rMaxA && b.x < towerPosB) {
        b.x = Math.min(towerPosB, b.x + spdB * 0.45 * dt);
      } else if (rMaxA > rMaxB && a.x > towerPosA) {
        a.x = Math.max(towerPosA, a.x - spdA * 0.45 * dt);
      }
    } else {
      // 推進限制: 若具備站外攻堅能力 (射程 > 砲塔)，偏好停留在塔外 1~2m
      const standoffA = rMaxA > towerRange + 5;
      const standoffB = rMaxB > towerRange + 5;

      const targetXA = standoffA ? towerPosB - towerRange - 2 : towerPosB - 20;
      const targetXB = standoffB ? towerPosA + towerRange + 2 : towerPosA + 20;

      if (a.x < targetXA) a.x = Math.max(towerPosA, Math.min(targetXA, a.x + spdA * 0.25 * dt));
      if (b.x > targetXB) b.x = Math.min(towerPosB, Math.max(targetXB, b.x - spdB * 0.25 * dt));
    }

    t += dt;
  }

  const aDead = a.sh + a.ar <= 0;
  const bDead = b.sh + b.ar <= 0;
  const towerAFell = towerHpA <= 0;
  const towerBFell = towerHpB <= 0;

  let win = 0.5;
  if ((bDead || towerBFell) && !(aDead || towerAFell)) win = 1;
  else if ((aDead || towerAFell) && !(bDead || towerBFell)) win = 0;
  else {
    const scoreA = (a.sh + a.ar) / a.ehp0 + (towerHpA / towerHp);
    const scoreB = (b.sh + b.ar) / b.ehp0 + (towerHpB / towerHp);
    const diff = scoreA - scoreB;
    win = Math.abs(diff) < 1e-4 ? 0.5 : diff > 0 ? 1 : 0;
  }

  return { win, t, towerHpA, towerHpB, scenario: 3 };
}

// =========================================================================
// 戰鬥情境 4: 迷霧 (Fog of war, outside sniper sight, buildings block LOS)
// =========================================================================
export function simulateScenario4_Fog(A, B) {
  const a = initState(A, 220);
  const b = initState(B, 220);
  const cDhA = A.y - B.y;

  let dist = 340;

  let t = 0;
  const dt = SCENARIO.DT;

  while (t < SCENARIO.MAX_T && a.sh + a.ar > 0 && b.sh + b.ar > 0) {
    a.tNow = t;
    b.tNow = t;
    if (t >= a.supUntil) a.sup = 0;
    if (t >= b.supUntil) b.sup = 0;
    tickAbilities(a, dt);
    tickAbilities(b, dt);

    // 逐 tick 視野偵測 (迷霧與城市建築遮蔽)
    const inBuildingCluster = dist > 120 && dist < 240;
    // 地面單位在街道峽谷中仰角與平視受高樓阻隔 (約 65% 遮斷率)
    // 飛行單位居高臨下俯瞰，享有開闊的航拍下視角度 (僅約 20% 遮蔽率)
    const losBlockedToGround = inBuildingCluster && (Math.sin(t * 0.8) > -0.3);
    const losBlockedToAir = inBuildingCluster && (Math.sin(t * 0.8 + 2.0) > 0.6);

    const aSeesB = dist <= A.sight && (B.flying ? !losBlockedToGround : !losBlockedToAir);
    const bSeesA = dist <= B.sight && (A.flying ? !losBlockedToGround : !losBlockedToAir);

    // 施放主動戰鬥技能 (需看見敵人)
    if (aSeesB) castCombatAbilities(a, b, dist, dt);
    if (bSeesA) castCombatAbilities(b, a, dist, dt);

    // 只有看到對方的那一方才能開火 (迷霧真實索敵)
    const strikeA = aSeesB ? calcStrikeDamage(a, b, dist, dt, cDhA, false) : { mpUse: 0, hits: [] };
    const strikeB = bSeesA ? calcStrikeDamage(b, a, dist, dt, -cDhA, false) : { mpUse: 0, hits: [] };

    a.mp = Math.min(a.f.mp0, a.mp - strikeA.mpUse + a.f.mpRegen * dt);
    b.mp = Math.min(b.f.mp0, b.mp - strikeB.mpUse + b.f.mpRegen * dt);

    let heavyHitB = false;
    const dealtB = strikeA.hits.reduce((acc, h) => {
      const prev = b.sh + b.ar;
      applyDamage(b, h.dmg, h.pen, h.def);
      if (h.isHeavy) heavyHitB = true;
      return acc + (prev - (b.sh + b.ar));
    }, 0);

    let heavyHitA = false;
    const dealtA = strikeB.hits.reduce((acc, h) => {
      const prev = a.sh + a.ar;
      applyDamage(a, h.dmg, h.pen, h.def);
      if (h.isHeavy) heavyHitA = true;
      return acc + (prev - (a.sh + a.ar));
    }, 0);

    if (dealtB > 0) {
      if (cDhA > 0) { const f = highSupF(cDhA); if (f > 0) { b.sup = Math.max(b.sup, f); b.supUntil = t + HIGH_SUP.DUR_S; } }
      if (b.f.flying && heavyHitB) b.unbalUntil = t + FLIGHT.UNBAL_S;
    }
    if (dealtA > 0) {
      if (-cDhA > 0) { const f = highSupF(-cDhA); if (f > 0) { a.sup = Math.max(a.sup, f); a.supUntil = t + HIGH_SUP.DUR_S; } }
      if (a.f.flying && heavyHitA) a.unbalUntil = t + FLIGHT.UNBAL_S;
    }

    const spdA = effectiveSpeed(a);
    const spdB = effectiveSpeed(b);

    const rMaxA = sRangeMax(A);
    const rMaxB = sRangeMax(B);

    if (!aSeesB && !bSeesA) {
      // 雙方在迷霧中搜敵推進
      dist = Math.max(30, dist - (spdA + spdB) * 0.6 * dt);
    } else if (aSeesB && !bSeesA) {
      // A 單向看見 B: A 保持在自身射程內風箏射擊，B 在迷霧中試圖逼近索敵
      const prefA = Math.min(rMaxA * 0.95, A.sight * 0.9);
      if (dist < prefA && a.retreatLeft > 0) {
        const ret = Math.min(spdA, a.retreatLeft / dt);
        a.retreatLeft = Math.max(0, a.retreatLeft - ret * dt);
        dist = Math.min(rMaxA, dist + (ret - spdB) * dt);
      } else if (dist > prefA) {
        dist = Math.max(prefA, dist - spdB * dt);
      }
    } else if (!aSeesB && bSeesA) {
      // B 單向看見 A: B 保持在自身射程內風箏射擊，A 在迷霧中試圖逼近索敵
      const prefB = Math.min(rMaxB * 0.95, B.sight * 0.9);
      if (dist < prefB && b.retreatLeft > 0) {
        const ret = Math.min(spdB, b.retreatLeft / dt);
        b.retreatLeft = Math.max(0, b.retreatLeft - ret * dt);
        dist = Math.min(rMaxB, dist + (ret - spdA) * dt);
      } else if (dist > prefB) {
        dist = Math.max(prefB, dist - spdA * dt);
      }
    } else {
      // 雙方皆看見對方: 射程長者微拉距離，短射程者壓迫逼近
      if (rMaxA > rMaxB && a.retreatLeft > 0) {
        const ret = Math.min(spdA * 0.5, a.retreatLeft / dt);
        a.retreatLeft = Math.max(0, a.retreatLeft - ret * dt);
        dist = Math.min(rMaxA, dist + (ret - spdB * 0.5) * dt);
      } else if (rMaxB > rMaxA && b.retreatLeft > 0) {
        const ret = Math.min(spdB * 0.5, b.retreatLeft / dt);
        b.retreatLeft = Math.max(0, b.retreatLeft - ret * dt);
        dist = Math.min(rMaxB, dist + (ret - spdA * 0.5) * dt);
      } else {
        dist = Math.max(20, dist - (spdA + spdB) * 0.3 * dt);
      }
    }

    t += dt;
  }

  const win = decideWinner(a, b);
  const leftA = Math.max(0, (a.sh + a.ar) / a.ehp0);
  const leftB = Math.max(0, (b.sh + b.ar) / b.ehp0);
  return { win, t, leftA, leftB, scenario: 4 };
}

// =========================================================================
// 戰鬥情境 5: 無雙 (Musou, 4 minion waves, clear speed TTK)
// =========================================================================
export function simulateScenario5_Musou(A) {
  const a = initState(A);
  const singleWave = waveComp();
  const waveSpacing = waveSpacingM ? waveSpacingM() : 75;

  const waves = [];
  for (let wIdx = 0; wIdx < 4; wIdx++) {
    const waveDist = 80 + wIdx * waveSpacing;
    const waveFoes = singleWave.map((tk) => {
      const u = UNITS[tk];
      return {
        kind: tk,
        hp: u.hp,
        hp0: u.hp,
        armor: u.armor,
        dmg: u.dmg,
        rate: u.rate,
        range: u.range,
        dist: waveDist,
      };
    });
    waves.push(waveFoes);
  }

  let t = 0;
  const dt = SCENARIO.DT;
  const marchSpd = waveMarchSpeed ? waveMarchSpeed() : 12;

  let allCleared = false;

  while (t < 240 && a.sh + a.ar > 0) {
    a.tNow = t;
    tickAbilities(a, dt);

    for (const wave of waves) {
      for (const foe of wave) {
        if (foe.hp > 0) {
          foe.dist = Math.max(10, foe.dist - marchSpd * dt);
        }
      }
    }

    const aliveFoes = waves.flatMap((w) => w.filter((f) => f.hp > 0));
    if (aliveFoes.length === 0) {
      allCleared = true;
      break;
    }

    aliveFoes.sort((f1, f2) => f1.dist - f2.dist);
    const targetFoe = aliveFoes[0];

    for (const slot of A.slots) {
      if (targetFoe.dist > slot.range) continue;
      const w = slot.def;
      const wCls = aoeClass ? aoeClass(w) : 'single';

      if (wCls === 'blast') {
        for (const foe of aliveFoes) {
          const dDiff = Math.abs(foe.dist - targetFoe.dist);
          if (dDiff <= (w.r || 15)) {
            const bDmg = w.dmg * vsMult(w, foe.kind) * blastFalloff(w.r, dDiff) * slot.rps * dt;
            foe.hp -= bDmg * armorMul(foe.armor, w.pen);
          }
        }
      } else if (wCls === 'fan') {
        for (const foe of aliveFoes) {
          if (foe.dist <= w.range) {
            const fDmg = w.dmg * vsMult(w, foe.kind) * fanFalloff(w.range, foe.dist) * slot.rps * dt;
            foe.hp -= fDmg * armorMul(foe.armor, w.pen);
          }
        }
      } else {
        const sDmg = w.dmg * vsMult(w, targetFoe.kind) * slot.rps * dt;
        targetFoe.hp -= sDmg * armorMul(targetFoe.armor, w.pen);
      }
    }

    for (const foe of aliveFoes) {
      if (foe.dist <= foe.range) {
        const foeDmg = foe.dmg * foe.rate * dt;
        applyDamage(a, foeDmg, 0, { id: 'minion' });
      }
    }

    t += dt;
  }

  const success = allCleared && (a.sh + a.ar > 0);
  const ttk = t;
  const leftEhp = Math.max(0, (a.sh + a.ar) / a.ehp0);

  return { success, ttk, leftEhp, scenario: 5 };
}

// =========================================================================
// 全情境測試矩陣執行器
// =========================================================================
export function runMatchScenarios(A_ch, B_ch, lvl, modeA, modeB) {
  const fighterA = createFighter(A_ch, lvl, modeA);
  const fighterB = createFighter(B_ch, lvl, modeB);

  const r1 = simulateScenario1_Ranged(fighterA, fighterB);
  const r2 = simulateScenario2_Melee(fighterA, fighterB);
  const r3 = simulateScenario3_Tower(fighterA, fighterB);
  const r4 = simulateScenario4_Fog(fighterA, fighterB);

  // 情境 5: 無雙 (4波小兵清波速度 TTK 對決)
  const m5A = simulateScenario5_Musou(fighterA);
  const m5B = simulateScenario5_Musou(fighterB);
  let win5 = 0.5;
  if (m5A.success && !m5B.success) win5 = 1;
  else if (!m5A.success && m5B.success) win5 = 0;
  else if (m5A.success && m5B.success) {
    win5 = m5A.ttk < m5B.ttk ? 1 : (m5A.ttk > m5B.ttk ? 0 : 0.5);
  } else {
    win5 = m5A.leftEhp > m5B.leftEhp ? 1 : (m5A.leftEhp < m5B.leftEhp ? 0 : 0.5);
  }

  const avgWin = (r1.win + r2.win + r3.win + r4.win + win5) / 5;
  return {
    win: avgWin,
    r1,
    r2,
    r3,
    r4,
    r5: { win: win5, ttkA: m5A.ttk, ttkB: m5B.ttk },
  };
}
