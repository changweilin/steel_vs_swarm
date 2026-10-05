// 扇形小錐分格(aoeClass 'fan')命中判定稽核 —— 離線直測 sim.heroPlasma。
//
// 2026-09-27 使用者需求:
//   ① 錐按方位角切成 fanSubs 個小錐形區塊,每區塊只命中最近的一名敵人;
//   ② 量體橫跨多格的大目標在多格各吃一次(單一敵人多次傷害);
//   ③ 傷害不隨距離變化(只剩偏心遞減 offAxisFalloff)。
//
// 用法:node tools/audit_fan_cone.mjs

import { readSrc } from './audit_src.mjs';
import { BattleSim } from '../server/sim.js';
import {
  CHARACTERS, heroWeapon, fanSubs, offAxisFalloff, MAPGEO, LOS, hitR,
  TARGET_R, TARGET_CLASS, fanBuildingMaxHits,
} from '../public/js/data.js';

let failed = false;
const log = (...a) => console.log(...a);
const assert = (cond, msg) => {
  if (cond) log(`  ✅ ${msg}`);
  else { failed = true; log(`  ❌ ${msg}`); }
};

// 合成戰場設定(同 audit_lance_hit 的 fakeBattleConfig;單線、台北 101 附近)
function fakeBattleConfig(L = 1) {
  const A = [25.0330, 121.5654];
  const D = 1600 * L, R = 6371000;
  const realD = D * MAPGEO.REAL_SCALE;
  const dLat = realD / R * 180 / Math.PI;
  const B = [A[0] + dLat, A[1]];
  const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const pts = [];
  for (let t = 0; t <= 1.001; t += 0.05) {
    const u = 1 - t;
    pts.push([u * u * A[0] + 2 * u * t * mid[0] + t * t * B[0], u * u * A[1] + 2 * u * t * mid[1] + t * t * B[1]]);
  }
  const sizeM = D / (0.85 * Math.SQRT2);
  return {
    center: { lat: mid[0], lng: mid[1] },
    bases: { SWARM: A, STEEL: B },
    lanes: [pts],
    sizeM, diagM: sizeM * Math.SQRT2, distM: D,
    geoScaleVer: MAPGEO.GEO_SCALE_VER,
    maxOverlap: 0.05, synthetic: true, placeName: '扇形稽核戰區',
    env: { season: 'summer', time: 'day', weather: 'clear' },
  };
}

/** 乾淨的測試沙盤:清掉野營/小兵/塔,只留下我們自己放的目標(避免流彈干擾斷言) */
function sandbox() {
  const sim = new BattleSim(fakeBattleConfig(1));
  for (const e of [...sim.ents.values()]) sim.ents.delete(e.id);
  sim.camps = [];
  sim.mines = [];
  sim.missiles = [];
  // 迷霧旁路:本稽核只驗幾何,視野/LOS 另有既有測試把關
  sim.visionUntil = { SWARM: 1e9, STEEL: 1e9 };
  return sim;
}

/** 配好扇形重武器的射手(s04 紅蓮業火,arc Lv1 = 13° → 4 格);每量測一座新沙盤 */
function fanShooter(tag) {
  const sim = sandbox();
  const h = sim.addHero('SWARM', tag, 's04');
  h.x = 0; h.z = 0; h.y = 0;
  h.aiming = true;               // 重武器需瞄準模式才能開火
  h.mp = h.maxMp = 9999;         // 電力門檻(_gateFire)不是本稽核的受測對象
  sim.t = 100;                   // 射速閘以「距上次開火」判定,t=0 會被 fireAt 預設值擋掉
  return { sim, h };
}

const ARC = heroWeapon('s04', 'heavy', 1, true).arc;   // Lv1 錐角(度)

log('— 扇形小錐分格(sim.heroPlasma)—');

// ---------- ① 分格基本盤 ----------
{
  assert(CHARACTERS.s04 && heroWeapon('s04', 'heavy', 1, true)?.fan,
    '測試素材:s04 重武器是扇形(紅蓮業火)');
  assert(ARC === 13, `測試前提:s04 Lv1 錐角 ${ARC}°(不是 13° 的話下面格數全錯)`);
  assert(fanSubs({ arc: ARC }) === 11, `13° 錐切 ${fanSubs({ arc: ARC })} 格(SUB_DEG 2.4° 推導)`);
}

// ---------- ② 同一小錐只取最近 ----------
{
  const { sim } = fanShooter('p_c1');
  const near = sim._add({ kind: 'soldier', side: 'STEEL', x: 0, z: 60, y: 0, hp: 99999, m: 99999 });
  const far = sim._add({ kind: 'soldier', side: 'STEEL', x: 0, z: 100, y: 0, hp: 99999, m: 99999 });
  sim.heroPlasma('p_c1', 0, 1, 'heavy', null, 0);
  assert(near.hp < 99999 && far.hp === 99999,
    '同軸前後兩名:最近的掉血,同格後方的吃不到(不再順帶)');
}

// ---------- ③ 傷害不隨距離變化 ----------
{
  const mk = (z, tag) => {
    const { sim } = fanShooter(tag);
    const t = sim._add({ kind: 'soldier', side: 'STEEL', x: 0, z, y: 0, hp: 99999, m: 99999 });
    sim.heroPlasma(tag, 0, 1, 'heavy', null, 0);
    return 99999 - t.hp;
  };
  const dNear = mk(60, 'p_c2a'), dFar = mk(140, 'p_c2b');
  // 距離衰減已移除:殘差只剩眼高/頭頂 0.2m 的次度級幾何(60m 偏 0.19°、140m 偏 0.08°),
  // 舊 fanFalloff 在這兩點會差 2.1 倍 —— 2% 窗足以區分新舊制。
  assert(dNear > 0 && Math.abs(dNear - dFar) / dNear < 0.02,
    `同軸 60m 與 140m 傷害相等(${dNear.toFixed(1)} vs ${dFar.toFixed(1)},差 ${(Math.abs(dNear - dFar) / dNear * 100).toFixed(2)}%)`);
}

// ---------- ④ 大目標橫跨多格 → 多次傷害(非建築多格多吃、建築受但書截斷) ----------
{
  TARGET_R['creep:boss'] = 7;
  TARGET_CLASS['boss'] = 'armor';
  const mk = (z, tag) => {
    const { sim } = fanShooter(tag);
    const t = sim._add({ kind: 'boss', side: 'STEEL', x: 0, z, y: 0, hp: 999999, m: 999999 });
    sim.heroPlasma(tag, 0, 1, 'heavy', null, 0);
    return 999999 - t.hp;
  };
  const dClose = mk(30, 'p_c3a'), dFar = mk(150, 'p_c3b');
  // 30m:量體張角 13.1° ≈ 半錐 ⇒ 11 格全中;150m:張角 2.7° ⇒ 只中中央 3 格 ⇒ 11/3 倍
  // (奇數格 + 中央格以軸為心 —— 小目標在軸上只中一格,見 data.js fanSubs/fanBinOf)。
  const ratio = dClose / dFar;
  assert(dClose > 0 && dFar > 0 && Math.abs(ratio - 11 / 3) < 0.02,
    `非建築大型目標(r=7)近距吃 11 格、遠距吃 3 格 ⇒ 總傷 ×${ratio.toFixed(3)}(期望 ${(11 / 3).toFixed(3)})`);

  // 建築物但書: 即使量體跨 11 格, 也受 fanBuildingMaxHits 截斷(依最高級 Lv4 期望值推導)
  const wpDef = heroWeapon('s04', 'heavy', 1, true);
  const maxB = fanBuildingMaxHits(wpDef);
  const { sim: simB } = fanShooter('p_c3bld');
  const tb = simB._add({ kind: 'tower', side: 'STEEL', x: 0, z: 30, y: 0, hp: 999999, m: 999999 });
  simB.heroPlasma('p_c3bld', 0, 1, 'heavy', null, 0);
  const dmgB = 999999 - tb.hp;
  assert(maxB === 1 && dmgB > 0 && dmgB < dClose * 0.15,
    `建築物(砲塔@30m)受但書截斷上限 ${maxB} 發(傷害 ${dmgB.toFixed(1)} 遠低於無上限 11 格 ${dClose.toFixed(1)})`);
}

// ---------- ⑤ 偏心遞減保留(角度的,不是距離的) ----------
{
  const { sim } = fanShooter('p_c4');
  const half = ARC * Math.PI / 180;
  const x = 100 * Math.tan(half * 0.9);   // 同距離 100m、偏離錐軸 90% 半寬
  const c = sim._add({ kind: 'soldier', side: 'STEEL', x: 0, z: 100, y: 0, hp: 99999, m: 99999 });
  const e = sim._add({ kind: 'soldier', side: 'STEEL', x, z: 100, y: 0, hp: 99999, m: 99999 });
  sim.heroPlasma('p_c4', 0, 1, 'heavy', null, 0);
  const dc = 99999 - c.hp, de = 99999 - e.hp;
  const exp = offAxisFalloff(0.9);
  assert(dc > 0 && de > 0, '正對錐軸與錐緣 90% 兩發位置都命中(各在自己的格裡)');
  assert(Math.abs(de / dc - exp) < 0.02,
    `偏心遞減仍在:錐緣傷害 ×${(de / dc).toFixed(3)}(期望 ${exp.toFixed(3)})`);
}

// ---------- ⑦ 每個小錐各自吃武器同一道射程 ----------
{
  const R = heroWeapon('s04', 'heavy', 1, true).range;
  TARGET_R['creep:boss'] = 7;
  TARGET_CLASS['boss'] = 'armor';
  const dmgAt = (x, z, tag, kind = 'soldier') => {
    const { sim } = fanShooter(tag);
    const t = sim._add({ kind, side: 'STEEL', x, z, y: 0, hp: 999999, m: 999999 });
    sim.heroPlasma(tag, 0, 1, 'heavy', null, 0);
    return 999999 - t.hp;
  };
  const edgeXZ = (f) => {
    const r = f * R, a = ARC * Math.PI / 180 * 0.9;   // 徑向等距:同一個徑向距離下比軸上/錐緣
    return [r * Math.sin(a), r * Math.cos(a)];
  };
  const [ex0, ez0] = edgeXZ(0.99), [ex1, ez1] = edgeXZ(1.05);
  assert(dmgAt(0, R * 0.99, 'p_c7a') > 0 && dmgAt(ex0, ez0, 'p_c7b') > 0,
    '射程內小目標:軸上與錐緣格都命中(逐格不縮射程)');
  assert(dmgAt(0, R * 1.05, 'p_c7c') === 0 && dmgAt(ex1, ez1, 'p_c7d') === 0,
    '超射程小目標:軸上與錐緣格都不掉血');
  // 大目標中心超射程、表面在內(R-1):中央格命中、邊緣格楔內增量超射程逐格剔除
  const dClose = dmgAt(0, 30, 'p_c7e', 'boss');
  const dEdge = dmgAt(0, R - 1 + 7, 'p_c7f', 'boss');
  assert(dEdge > dClose * 0.15 && dEdge < dClose * 0.5,
    `射程邊緣大目標(r=7,表面 R-1):只中中央格(${dEdge.toFixed(1)} 介於全錐 ${dClose.toFixed(1)} 的 15%~50%)`);
}

// ---------- ⑥ 單一縫 ----------
{
  const src = readSrc('public', 'js', 'data.js')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert((src.match(/export const fanSubs\s*=/g) || []).length === 1,
    '原文:fanSubs 只有一處定義(格數推導只有這一個縫)');
  assert((src.match(/export const FAN_SUB_DEG\s*=/g) || []).length === 1,
    '原文:FAN_SUB_DEG 只有一處定義');
  assert((src.match(/export const fanBinHitD\s*=/g) || []).length === 1,
    '原文:fanBinHitD 只有一處定義(楔-圓盤相交只有這一個縫)');
}

log(failed ? '\n❌ 扇形小錐分格稽核未通過' : '\n✅ 扇形小錐分格稽核全數通過');
process.exit(failed ? 1 : 0);
