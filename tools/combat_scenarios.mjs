// ============ 機體平衡性測試五大戰鬥情境模擬引擎: tools/combat_scenarios.mjs ============
// 依據使用者需求重新設計之五大戰鬥情境:
//
// 1. 戰鬥情境 1_遠戰:
//    - 雙方從彼此武器招式射程外開始 (d0 > max(Ra, Rb) * 1.35)。
//    - 拉近距離戰鬥。
//    - 場中設有建築障礙物: 直射武器 100% 阻擋; 爆炸武器依爆炸半徑動態計算波及率與猜中機率。
//    - 短射程者透過連續建築迂迴繞路拉近距離，直線推進速度折減 (變慢)。
//    - 長射程者在射程內拉開距離 (kiting, 最多讓出 KITE_M 避免無限風箏)；短射程者運用掩體與位移技能拉近。
//
// 2. 戰鬥情境 2_近戰:
//    - 雙方從彼此武器招式射程內開始 (d0 <= min(Ra, Rb))。
//    - 後續根據射程決定拉近拉遠，脫離射程後動態轉換成遠戰模式。
//    - 近距離拋物線/重型曲射 (lob) 武器具備盲區與仰角限制。
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
//    - 逐 tick 視野判定，高視野/飛行者享先手機會。
//    - 血量劣勢者後撤脫離視野，隨後因為已知位置，動態轉換為遠戰拉鋸模式。
//
// 5. 戰鬥情境 5_無雙:
//    - 依遊戲出兵距離放置 4 波小兵部隊 (waveComp())。
//    - 快被擊倒時主動後撤脫離戰鬥，等待 4 秒回滿護盾後再重新切入進攻。
//    - 比誰最快全部擊殺 (測量 TTK 與存活率)。
//
// 特殊機動與無敵機制:
// - 機甲 (robot): 可透過大跳躍 (High Leap) 瞬間拉近距離並暫時消除與高空飛行單位的高度落差。
// - 無人機 / 變形者 (drone / morph): 可透過飛行翻滾閃避 / 變形進入短暫無敵幀 (I-Frames, 0.35s)。
//
// 通用規範:
// - 飛行單位佔據高處開始 (y = 39m)，地面單位在平地上 (y = 0)。
// - 變形者 (morph) 輪流測試地面模式 (50%) 與飛行模式 (50%)。
// - 全部沒有升級 (Lv1) 與 全部升級滿 (Lv4) 輪流測試。
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
  DT: 0.125,        // 伺服器 tick (8Hz)
  MAX_T: 180,       // 單場最大時限 (秒)
  FLY_Y: 39,        // 飛行單位高度 (公尺, 3 個砲塔高)
  KITE_M: 200,      // 長射程風箏後退距離預算上限 (公尺)
};

/** 建立單一 Fighter 資料結構 */
export function createFighter(ch, lvl = 1, morphMode = 'ground') {
  const kind = charKind(ch);
  const isDrone = kind === 'drone';
  const flying = isDrone || (kind === 'morph' && morphMode === 'flight');
  const y = flying ? SCENARIO.FLY_Y : 0;

  const u = UNITS[kind];
  const m = CHARACTERS[ch].mods || {};

  const arBonus = ECON.UPGRADES.ar.step * (lvl - 1);
  const spBonus = ECON.UPGRADES.sp.step * (lvl - 1);
  const hpBonus = ECON.UPGRADES.hp.step * (lvl - 1);

  const armor = heroArmor(ch) + arBonus;
  let sh0 = (u.shield + spBonus) * (m.sp ?? 1);
  let ar0 = (u.hp + hpBonus) * (m.hp ?? 1);

  if (isDrone) {
    sh0 *= SQUAD.N;
    ar0 *= SQUAD.N;
  }

  const mp0 = (u.mp || 90) * (m.mp ?? 1);
  const mpRegen = (u.mpRegen || 2) * chargeF(lvl);
  const mob = heroMobility(kind, m, flying);

  const slots = [];
  for (const slotId of ['light', 'heavy']) {
    const w = heroWeapon(ch, slotId, lvl, true);
    if (!w) continue;
    slots.push({
      id: slotId,
      def: w,
      dps: w.dmg * w.rate,
      mp: slotId === 'heavy' ? heavyMpCost(w) : 0,
      rps: w.rate / (1 + (w.mag > 1 ? w.reload / w.mag : w.reload)),
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

/** 傷害扣減單一縫: 吃 shieldSplit 與 armorMul，具備無敵幀判定 */
function applyDamage(targetState, dmg, pen, def) {
  if (targetState.invulUntil > targetState.tNow) return; // 無敵幀豁免全部傷害
  const { toSp, toHp } = shieldSplit(def, dmg, Math.max(0, targetState.sh));
  targetState.sh -= toSp;
  targetState.ar -= toHp * armorMul(targetState.f.armor, pen);
}

/** 掩體防護結算: 非爆炸 100% 阻擋，爆炸武器依半徑動態計算波及率與猜中機率 */
function evalCoverDamage(h, inCover) {
  if (!inCover) return h.dmg;
  const def = h.def;
  // 非爆炸型武器 (直射實體彈、光束、穿甲彈等): 建築掩體 100% 阻擋
  const wCls = aoeClass ? aoeClass(def) : (def.aoe || 'single');
  const isBlast = wCls === 'blast' || (def.r && def.r > 0) || def.type === 'missile' || def.type === 'launcher';
  if (!isBlast) {
    return 0; // 掩體 100% 阻擋
  }

  // 爆炸型武器: 依爆炸半徑動態計算波及率與猜中機率
  const blastR = def.r || (def.type === 'launcher' ? 5 : (def.type === 'missile' ? 4 : 3));
  if (blastR <= 2) return 0; // 微型爆風無法繞過掩體死角

  // 猜中機率: 隨爆風半徑擴大而提升 (半徑 3m ~ 12m 對應 20% ~ 75%)
  const guessChance = Math.min(0.75, Math.max(0.20, (blastR - 2) / 10));
  // 掩體後爆風邊緣衰減折損 (20% ~ 50% 實得傷害)
  const splashRatio = 0.20 + 0.30 * Math.min(1, blastR / 8);

  return h.dmg * guessChance * splashRatio;
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
  let buffDmgMul = S.leapUntil > S.tNow ? 1.12 : 1;
  for (const ab of S.abCooldowns) {
    if (ab.activeDur > 0 && ab.def.mul?.dmg) {
      const mul = Array.isArray(ab.def.mul.dmg) ? ab.def.mul.dmg[0] : ab.def.mul.dmg;
      buffDmgMul *= mul;
    }
  }

  // 高度計算: shooterY - targetY (>0 表示射擊者居高臨下)
  // 機甲大跳躍期間 (leapUntil > t)，拉平與飛行單位的高度差 (dh = 0)
  const shooterY = S.f.flying ? SCENARIO.FLY_Y : (S.leapUntil > S.tNow ? SCENARIO.FLY_Y : 0);
  const targetY = T.f.flying ? SCENARIO.FLY_Y : (T.leapUntil > T.tNow ? SCENARIO.FLY_Y : 0);
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

    // 近距離 (dist < 25m) 拋物線重型曲射 (lob) 盲區限制
    if (dist < 25 && s.def.trajClass === 'lob') {
      cF *= 0.6;
    }

    const dmg = s.def.dmg * vsMult(s.def, T.f.kind)
      * dmgFalloff(s.def, dist) * cF * hitF * s.rps * buffDmgMul * dt;

    if (dmg > 0) {
      hits.push({ dmg, pen: s.def.pen, def: s.def, isHeavy: s.id === 'heavy' });
    }
    if (s.id === 'heavy') mpUse += s.mp * s.rps * dt;
  }

  // 召喚物支援火力
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
    leapUntil: -1,
    leapCd: 0,
    invulUntil: -1,
    evadeCd: 0,
    tNow: 0,
    abCooldowns: f.abilities.map((a) => ({ ...a, cdLeft: 0, activeDur: 0 })),
    retreatLeft: kiteBudget,
    isRetreating: false,
    outOfCombatTimer: 0,
  };
}

function tickAbilities(S, dt) {
  if (S.leapCd > 0) S.leapCd -= dt;
  if (S.evadeCd > 0) S.evadeCd -= dt;
  for (const ab of S.abCooldowns) {
    if (ab.cdLeft > 0) ab.cdLeft -= dt;
    if (ab.activeDur > 0) ab.activeDur -= dt;
  }
}

/** 機甲大跳躍: 瞬間拉近距離並暫時消除高度差 (跳到高空平面) */
function tryMechHighLeap(S, T, dist) {
  if (S.f.kind !== 'robot') return 0;
  if (S.leapCd <= 0 && S.mp >= 20) {
    const needClose = dist > sRangeMin(S.f) + 15;
    const targetFlying = T.f.flying && S.tNow > S.leapUntil;
    if (needClose || targetFlying) {
      S.leapCd = 12;
      S.mp -= 20;
      S.leapUntil = S.tNow + 1.6; // 1.2s 躍起高度拉平
      return 32; // 瞬間縮短 26m
    }
  }
  return 0;
}

/** 無人機 / 變形者 飛行翻滾閃避與變形無敵幀 (I-Frames) */
function tryFlightInvul(S, incomingThreat) {
  if (!S.f.flying) return false;
  if (S.evadeCd <= 0 && S.mp >= 15 && incomingThreat) {
    S.evadeCd = 14;
    S.mp -= 15;
    S.invulUntil = S.tNow + 0.25; // 0.35s 無敵幀
    return true;
  }
  return false;
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
  const obs1 = d0 * 0.35;
  const obs2 = d0 * 0.70;
  const obsW = 20;

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

    // 掩體判定: 射程短者在被長射程壓制時，經過場中地物掩體
    let inCoverA = false, inCoverB = false;
    const nearObs = Math.abs(dist - obs1) < obsW || Math.abs(dist - obs2) < obsW;
    if (nearObs) {
      if (bCanHit && !aCanHit) inCoverA = true;
      else if (aCanHit && !bCanHit) inCoverB = true;
    }

    // 施放主動戰鬥技能 (傷害、治療、增益、召喚)
    castCombatAbilities(a, b, dist, dt);
    castCombatAbilities(b, a, dist, dt);

    // 機甲大跳躍嘗試拉近/消除高度差
    const leapDistA = tryMechHighLeap(a, b, dist);
    if (leapDistA > 0) dist = Math.max(10, dist - leapDistA);
    const leapDistB = tryMechHighLeap(b, a, dist);
    if (leapDistB > 0) dist = Math.max(10, dist - leapDistB);

    // 計算打擊 (同步結算)
    const strikeA = calcStrikeDamage(a, b, dist, dt, cDhA, false);
    const strikeB = calcStrikeDamage(b, a, dist, dt, -cDhA, false);

    a.mp = Math.min(a.f.mp0, a.mp - strikeA.mpUse + a.f.mpRegen * dt);
    b.mp = Math.min(b.f.mp0, b.mp - strikeB.mpUse + b.f.mpRegen * dt);

    // 檢測即將承受之重火力威脅，觸發無人機/變形者飛行無敵幀 (I-Frames)
    if (strikeA.hits.some((h) => h.isHeavy)) tryFlightInvul(b, true);
    if (strikeB.hits.some((h) => h.isHeavy)) tryFlightInvul(a, true);

    let heavyHitB = false;
    const dealtB = strikeA.hits.reduce((acc, h) => {
      const prev = b.sh + b.ar;
      const effectiveDmg = evalCoverDamage(h, inCoverB);
      applyDamage(b, effectiveDmg, h.pen, h.def);
      if (h.isHeavy && effectiveDmg > 0) heavyHitB = true;
      return acc + (prev - (b.sh + b.ar));
    }, 0);

    let heavyHitA = false;
    const dealtA = strikeB.hits.reduce((acc, h) => {
      const prev = a.sh + a.ar;
      const effectiveDmg = evalCoverDamage(h, inCoverA);
      applyDamage(a, effectiveDmg, h.pen, h.def);
      if (h.isHeavy && effectiveDmg > 0) heavyHitA = true;
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

    // 機動推進: 迂迴繞路減速 (直線上減速 35%)
    const spdA = inCoverA ? effectiveSpeed(a) * 0.65 : effectiveSpeed(a);
    const spdB = inCoverB ? effectiveSpeed(b) * 0.65 : effectiveSpeed(b);

    const longRangeA = rMaxA > rMaxB;
    const longRangeB = rMaxB > rMaxA;

    if (dist > Math.max(rMaxA, rMaxB)) {
      // 雙方自射程外拉近
      dist = Math.max(Math.max(rMaxA, rMaxB) * 0.95, dist - (spdA + spdB) * dt);
    } else if (dist > Math.min(rMaxA, rMaxB)) {
      // 處於長射程優勢帶: 長射程方保持風箏，短射程方推進
      if (longRangeA) {
        const prefA = Math.min(rMaxA * 0.96, rMaxB + 8);
        const shiftB = tryMobilityAbility(b, dist, true, dt);
        dist -= shiftB;
        if (dist < prefA && a.retreatLeft > 0) {
          const ret = Math.min(spdA, a.retreatLeft / dt);
          dist += ret * dt;
          a.retreatLeft -= ret * dt;
        } else {
          dist = Math.max(rMaxB * 0.9, dist - spdB * dt);
        }
      } else if (longRangeB) {
        const prefB = Math.min(rMaxB * 0.96, rMaxA + 8);
        const shiftA = tryMobilityAbility(a, dist, true, dt);
        dist -= shiftA;
        if (dist < prefB && b.retreatLeft > 0) {
          const ret = Math.min(spdB, b.retreatLeft / dt);
          dist += ret * dt;
          b.retreatLeft -= ret * dt;
        } else {
          dist = Math.max(rMaxA * 0.9, dist - spdA * dt);
        }
      }
    } else {
      // 雙方皆在彼此射程內: 短射程方逼近至最舒適射程
      if (longRangeA) {
        const shiftB = tryMobilityAbility(b, dist, true, dt);
        dist -= shiftB;
        dist = Math.max(15, dist - spdB * 0.5 * dt);
      } else if (longRangeB) {
        const shiftA = tryMobilityAbility(a, dist, true, dt);
        dist -= shiftA;
        dist = Math.max(15, dist - spdA * 0.5 * dt);
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
// 戰鬥情境 2: 近戰 (近距離開局，動態拉扯，脫離射程後轉換成遠戰模式)
// =========================================================================
export function simulateScenario2_Melee(A, B) {
  const a = initState(A, 220);
  const b = initState(B, 220);
  const cDhA = A.y - B.y;

  const rMaxA = sRangeMax(A);
  const rMaxB = sRangeMax(B);

  // 起始近距離 (小於等於雙方最小射程)
  let dist = Math.min(sRangeMin(A), sRangeMin(B), 28);

  let t = 0;
  const dt = SCENARIO.DT;
  let isRangedMode = false;

  while (t < SCENARIO.MAX_T && a.sh + a.ar > 0 && b.sh + b.ar > 0) {
    a.tNow = t;
    b.tNow = t;
    if (t >= a.supUntil) a.sup = 0;
    if (t >= b.supUntil) b.sup = 0;
    tickAbilities(a, dt);
    tickAbilities(b, dt);

    const aCanHit = dist <= rMaxA;
    const bCanHit = dist <= rMaxB;

    // 若拉開距離超過短射程方射程，轉換成遠戰模式 (利用掩體推進)
    if (!isRangedMode && (dist > Math.min(rMaxA, rMaxB) + 12)) {
      isRangedMode = true;
    } else if (isRangedMode && (dist <= Math.min(rMaxA, rMaxB))) {
      isRangedMode = false;
    }

    let inCoverA = false, inCoverB = false;
    if (isRangedMode) {
      if (bCanHit && !aCanHit) inCoverA = true;
      else if (aCanHit && !bCanHit) inCoverB = true;
    }

    // 施放主動戰鬥技能
    castCombatAbilities(a, b, dist, dt);
    castCombatAbilities(b, a, dist, dt);

    // 機甲大跳躍嘗試拉近
    const leapA = tryMechHighLeap(a, b, dist);
    if (leapA > 0) dist = Math.max(10, dist - leapA);
    const leapB = tryMechHighLeap(b, a, dist);
    if (leapB > 0) dist = Math.max(10, dist - leapB);

    const strikeA = calcStrikeDamage(a, b, dist, dt, cDhA, false);
    const strikeB = calcStrikeDamage(b, a, dist, dt, -cDhA, false);

    a.mp = Math.min(a.f.mp0, a.mp - strikeA.mpUse + a.f.mpRegen * dt);
    b.mp = Math.min(b.f.mp0, b.mp - strikeB.mpUse + b.f.mpRegen * dt);

    if (strikeA.hits.some((h) => h.isHeavy)) tryFlightInvul(b, true);
    if (strikeB.hits.some((h) => h.isHeavy)) tryFlightInvul(a, true);

    let heavyHitB = false;
    const dealtB = strikeA.hits.reduce((acc, h) => {
      const prev = b.sh + b.ar;
      const effDmg = evalCoverDamage(h, inCoverB);
      applyDamage(b, effDmg, h.pen, h.def);
      if (h.isHeavy && effDmg > 0) heavyHitB = true;
      return acc + (prev - (b.sh + b.ar));
    }, 0);

    let heavyHitA = false;
    const dealtA = strikeB.hits.reduce((acc, h) => {
      const prev = a.sh + a.ar;
      const effDmg = evalCoverDamage(h, inCoverA);
      applyDamage(a, effDmg, h.pen, h.def);
      if (h.isHeavy && effDmg > 0) heavyHitA = true;
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

    // 動態拉鋸走位: 長射程方試圖後撤風箏，短射程方貼身追擊
    const spdA = inCoverA ? effectiveSpeed(a) * 0.65 : effectiveSpeed(a);
    const spdB = inCoverB ? effectiveSpeed(b) * 0.65 : effectiveSpeed(b);

    if (rMaxA > rMaxB + 10) {
      // A 射程佔優，試圖拉開
      const shiftA = tryMobilityAbility(a, dist, false, dt);
      dist -= shiftA;
      if (a.retreatLeft > 0) {
        const ret = Math.min(spdA, a.retreatLeft / dt);
        dist += (ret - spdB) * dt;
        a.retreatLeft -= ret * dt;
      } else {
        dist = Math.max(15, dist - spdB * 0.5 * dt);
      }
    } else if (rMaxB > rMaxA + 10) {
      // B 射程佔優，試圖拉開
      const shiftB = tryMobilityAbility(b, dist, false, dt);
      dist -= shiftB;
      if (b.retreatLeft > 0) {
        const ret = Math.min(spdB, b.retreatLeft / dt);
        dist += (ret - spdA) * dt;
        b.retreatLeft -= ret * dt;
      } else {
        dist = Math.max(15, dist - spdA * 0.5 * dt);
      }
    } else {
      // 射程相近: 貼身纏鬥
      dist = Math.max(12, dist + (Math.sin(t * 1.5) * 4) * dt);
    }

    t += dt;
  }

  const win = decideWinner(a, b);
  const leftA = Math.max(0, (a.sh + a.ar) / a.ehp0);
  const leftB = Math.max(0, (b.sh + b.ar) / b.ehp0);
  return { win, t, leftA, leftB, scenario: 2 };
}

// =========================================================================
// 戰鬥情境 3: 守塔 (Tower defense, mini map, no retreating past tower)
// =========================================================================
export function simulateScenario3_Tower(A, B) {
  const a = initState(A, 0);
  const b = initState(B, 0);
  const cDhA = A.y - B.y;

  const Dsep = 186; // 砲塔間距
  const tRange = 155; // 砲塔射程
  const tDps = 68; // 砲塔 DPS

  let posA = -Dsep / 2 + 25; // A 在己方塔前 25m
  let posB = Dsep / 2 - 25;  // B 在己方塔前 25m

  const towerPosA = -Dsep / 2;
  const towerPosB = Dsep / 2;

  let towerHpA = 1800;
  let towerHpB = 1800;

  let t = 0;
  const dt = SCENARIO.DT;

  while (t < SCENARIO.MAX_T && a.sh + a.ar > 0 && b.sh + b.ar > 0 && towerHpA > 0 && towerHpB > 0) {
    a.tNow = t;
    b.tNow = t;
    if (t >= a.supUntil) a.sup = 0;
    if (t >= b.supUntil) b.sup = 0;
    tickAbilities(a, dt);
    tickAbilities(b, dt);

    const dist = Math.abs(posA - posB);

    castCombatAbilities(a, b, dist, dt);
    castCombatAbilities(b, a, dist, dt);

    const leapA = tryMechHighLeap(a, b, dist);
    if (leapA > 0) posA = Math.min(towerPosB - 5, posA + leapA);
    const leapB = tryMechHighLeap(b, a, dist);
    if (leapB > 0) posB = Math.max(towerPosA + 5, posB - leapB);

    const strikeA = calcStrikeDamage(a, b, dist, dt, cDhA, false);
    const strikeB = calcStrikeDamage(b, a, dist, dt, -cDhA, false);

    a.mp = Math.min(a.f.mp0, a.mp - strikeA.mpUse + a.f.mpRegen * dt);
    b.mp = Math.min(b.f.mp0, b.mp - strikeB.mpUse + b.f.mpRegen * dt);

    if (strikeA.hits.some((h) => h.isHeavy)) tryFlightInvul(b, true);
    if (strikeB.hits.some((h) => h.isHeavy)) tryFlightInvul(a, true);

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

    // 砲塔火力支援: 當敵機進入塔射程時開火
    const distToTowerA = Math.abs(posB - towerPosA);
    if (distToTowerA <= tRange) {
      applyDamage(b, tDps * dt, 12, { id: 'tower', vs: { armor: 1.0, air: 1.0 } });
    }
    const distToTowerB = Math.abs(posA - towerPosB);
    if (distToTowerB <= tRange) {
      applyDamage(a, tDps * dt, 12, { id: 'tower', vs: { armor: 1.0, air: 1.0 } });
    }

    // 機體對防禦塔造成的火力 (攻堅)
    for (const slot of A.slots) {
      if (distToTowerB <= slot.range) {
        towerHpB -= slot.def.dmg * slot.rps * vsMult(slot.def, 'tower') * dt * 0.35;
      }
    }
    for (const slot of B.slots) {
      if (distToTowerA <= slot.range) {
        towerHpA -= slot.def.dmg * slot.rps * vsMult(slot.def, 'tower') * dt * 0.35;
      }
    }

    // 走位限制: 機體不可退過己方防禦塔後面 (硬限制邊界)
    const spdA = effectiveSpeed(a);
    const spdB = effectiveSpeed(b);

    const rMaxA = sRangeMax(A);
    const rMaxB = sRangeMax(B);

    if (rMaxA > rMaxB + 10) {
      posA = Math.max(towerPosA, posA - spdA * 0.3 * dt);
      posB = Math.max(posA + 15, posB - spdB * dt);
    } else if (rMaxB > rMaxA + 10) {
      posB = Math.min(towerPosB, posB + spdB * 0.3 * dt);
      posA = Math.min(posB - 15, posA + spdA * dt);
    } else {
      posA = Math.min(-5, posA + spdA * 0.2 * dt);
      posB = Math.max(5, posB - spdB * 0.2 * dt);
    }

    posA = Math.max(towerPosA, Math.min(towerPosB - 5, posA));
    posB = Math.max(towerPosA + 5, Math.min(towerPosB, posB));

    t += dt;
  }

  let win = 0.5;
  const aDead = a.sh + a.ar <= 0 || towerHpA <= 0;
  const bDead = b.sh + b.ar <= 0 || towerHpB <= 0;
  if (aDead && !bDead) win = 0;
  else if (!aDead && bDead) win = 1;
  else win = decideWinner(a, b);

  const leftA = Math.max(0, (a.sh + a.ar) / a.ehp0);
  const leftB = Math.max(0, (b.sh + b.ar) / b.ehp0);
  return { win, t, leftA, leftB, scenario: 3 };
}

// =========================================================================
// 戰鬥情境 4: 迷霧 (Fog of war, sight border, ambush & kite transition)
// =========================================================================
export function simulateScenario4_Fog(A, B) {
  const a = initState(A, 220);
  const b = initState(B, 220);
  const cDhA = A.y - B.y;

  let dist = 340;

  let t = 0;
  const dt = SCENARIO.DT;
  let isRangedTransition = false;

  while (t < SCENARIO.MAX_T && a.sh + a.ar > 0 && b.sh + b.ar > 0) {
    a.tNow = t;
    b.tNow = t;
    if (t >= a.supUntil) a.sup = 0;
    if (t >= b.supUntil) b.sup = 0;
    tickAbilities(a, dt);
    tickAbilities(b, dt);

    // 視野判定: 若轉換為遠戰模式，雙方已知方位，LOS 依掩體遮蔽
    let aSeesB = false, bSeesA = false;
    let inCoverA = false, inCoverB = false;

    if (isRangedTransition) {
      aSeesB = true;
      bSeesA = true;
      const nearObs = (Math.sin(t * 0.9) > 0.3);
      if (nearObs) {
        if (sRangeMax(B) > sRangeMax(A)) inCoverA = true;
        else if (sRangeMax(A) > sRangeMax(B)) inCoverB = true;
      }
    } else {
      const inBuildingCluster = dist > 120 && dist < 240;
      const losBlockedToGround = inBuildingCluster && (Math.sin(t * 0.8) > -0.3);
      const losBlockedToAir = inBuildingCluster && (Math.sin(t * 0.8 + 2.0) > 0.6);

      aSeesB = dist <= A.sight && (B.flying ? !losBlockedToGround : !losBlockedToAir);
      bSeesA = dist <= B.sight && (A.flying ? !losBlockedToGround : !losBlockedToAir);

      // 血量劣勢後撤判定: 轉換為已知位置的遠戰拉鋸模式
      const leftFracA = (a.sh + a.ar) / a.ehp0;
      const leftFracB = (b.sh + b.ar) / b.ehp0;
      if (leftFracA < 0.45 && leftFracA < leftFracB - 0.15) {
        isRangedTransition = true;
      } else if (leftFracB < 0.45 && leftFracB < leftFracA - 0.15) {
        isRangedTransition = true;
      }
    }

    if (aSeesB) castCombatAbilities(a, b, dist, dt);
    if (bSeesA) castCombatAbilities(b, a, dist, dt);

    const leapA = tryMechHighLeap(a, b, dist);
    if (leapA > 0) dist = Math.max(10, dist - leapA);
    const leapB = tryMechHighLeap(b, a, dist);
    if (leapB > 0) dist = Math.max(10, dist - leapB);

    const strikeA = aSeesB ? calcStrikeDamage(a, b, dist, dt, cDhA, false) : { mpUse: 0, hits: [] };
    const strikeB = bSeesA ? calcStrikeDamage(b, a, dist, dt, -cDhA, false) : { mpUse: 0, hits: [] };

    a.mp = Math.min(a.f.mp0, a.mp - strikeA.mpUse + a.f.mpRegen * dt);
    b.mp = Math.min(b.f.mp0, b.mp - strikeB.mpUse + b.f.mpRegen * dt);

    if (strikeA.hits.some((h) => h.isHeavy)) tryFlightInvul(b, true);
    if (strikeB.hits.some((h) => h.isHeavy)) tryFlightInvul(a, true);

    let heavyHitB = false;
    const dealtB = strikeA.hits.reduce((acc, h) => {
      const prev = b.sh + b.ar;
      const effDmg = evalCoverDamage(h, inCoverB);
      applyDamage(b, effDmg, h.pen, h.def);
      if (h.isHeavy && effDmg > 0) heavyHitB = true;
      return acc + (prev - (b.sh + b.ar));
    }, 0);

    let heavyHitA = false;
    const dealtA = strikeB.hits.reduce((acc, h) => {
      const prev = a.sh + a.ar;
      const effDmg = evalCoverDamage(h, inCoverA);
      applyDamage(a, effDmg, h.pen, h.def);
      if (h.isHeavy && effDmg > 0) heavyHitA = true;
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

    const spdA = inCoverA ? effectiveSpeed(a) * 0.65 : effectiveSpeed(a);
    const spdB = inCoverB ? effectiveSpeed(b) * 0.65 : effectiveSpeed(b);

    const rMaxA = sRangeMax(A);
    const rMaxB = sRangeMax(B);

    if (!aSeesB && !bSeesA) {
      dist = Math.max(50, dist - (spdA + spdB) * dt);
    } else if (aSeesB && !bSeesA) {
      dist = Math.max(rMaxA * 0.9, dist - (spdA - spdB * 0.3) * dt);
    } else if (!aSeesB && bSeesA) {
      dist = Math.max(rMaxB * 0.9, dist - (spdB - spdA * 0.3) * dt);
    } else {
      if (rMaxA > rMaxB) {
        dist = Math.max(rMaxB + 8, dist + (spdA * 0.2 - spdB) * dt);
      } else {
        dist = Math.max(rMaxA + 8, dist + (spdB * 0.2 - spdA) * dt);
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
// 戰鬥情境 5: 無雙 (Musou, 4 minion waves, tactical shield retreat & TTK)
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

    // 兵波向前推進
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
    const closestFoe = aliveFoes[0];

    // 護盾見底 (<= 15%) 觸發戰術後撤等護盾回滿
    if (a.sh <= a.f.sh0 * 0.15 && a.sh + a.ar > 0 && !a.isRetreating) {
      a.isRetreating = true;
      a.outOfCombatTimer = 0;
    }

    if (a.isRetreating) {
      // 後撤拉開與小兵距離
      const spd = effectiveSpeed(a);
      for (const foe of aliveFoes) {
        foe.dist += spd * dt;
      }
      // 脫離所有小兵射程 (> 125m) 開始累積脫戰計時
      if (closestFoe.dist > 125) {
        a.outOfCombatTimer += dt;
        if (a.outOfCombatTimer >= 4.0) {
          // 4 秒後護盾回滿，重返戰場進攻
          a.sh = a.f.sh0;
          a.isRetreating = false;
          a.outOfCombatTimer = 0;
        }
      }
    } else {
      // 正常進攻階段: 鎖定目標全力輸出
      for (const slot of A.slots) {
        if (closestFoe.dist > slot.range) continue;
        const w = slot.def;
        const wCls = aoeClass ? aoeClass(w) : 'single';

        if (wCls === 'blast') {
          for (const foe of aliveFoes) {
            const dDiff = Math.abs(foe.dist - closestFoe.dist);
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
          const sDmg = w.dmg * vsMult(w, closestFoe.kind) * slot.rps * dt;
          closestFoe.hp -= sDmg * armorMul(closestFoe.armor, w.pen);
        }
      }
    }

    // 小兵向機體射擊 (若機體進入其射程)
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
    if (Math.abs(m5A.ttk - m5B.ttk) < 0.5) win5 = 0.5;
    else win5 = m5A.ttk < m5B.ttk ? 1 : 0;
  } else {
    win5 = m5A.leftEhp > m5B.leftEhp ? 1 : (m5A.leftEhp < m5B.leftEhp ? 0 : 0.5);
  }

  const scenarios = [r1.win, r2.win, r3.win, r4.win, win5];
  const win = scenarios.reduce((s, w) => s + w, 0) / scenarios.length;

  return {
    win,
    scenarios,
    r1,
    r2,
    r3,
    r4,
    r5: { win: win5, ttkA: m5A.ttk, ttkB: m5B.ttk },
  };
}
