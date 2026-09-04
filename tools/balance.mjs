// ============ 平衡稽核(離線,純 Node,無依賴):`npm run bal` ============
// 整合重構為 4 大結構化模組 (映射關係保留於註解以供歷史稽核對照):
//
// 模組一：防禦結構與戰場幾何 (Geometry & Defense Structures)
//   1.1 最前線敵我砲塔佈局 (原 ②): 塔距 1.2R, 重疊 80%, d > R 不對射。
//   1.2 雙塔攻擊範圍約束 (原 ⑦a): 同塔位雙塔間距下, 滿級普通爆炸武器一發不得同時波及兩座塔。
//
// 模組二：環境攻防基礎數值 (PvE Baseline: Creep Wave & Tower Siege)
//   2.1 小兵波次承傷與清波基準 (原 ①): 玩家單挑一波 NPC, 戰後應剩餘 40% ± 5% EHP。
//   2.2 滿級攻城拆塔基準 (原 ④): 八軌滿級單挑同塔位雙塔, 機甲/變形近戰剩 0~20% EHP, 無人機站外 ≤ 200s。
//   2.3 滿級電力攻堅續航 (原 ④): 回充 ≥ 重武器持續耗電率, 攻堅不斷火。
//
// 模組三：多維戰鬥情境平衡 (Multi-Scenario Combat Balance)
//   3.1~3.5 五大戰鬥情境 (原 ⑤ 完整保留: 遠戰 / 近戰 / 兵線守塔 / 迷霧 / 無雙):
//       - 3.1 各情境獨立勝率: 不做限制 (僅列印參考, 允許機體特化)。
//       - 3.2 全情境綜合平均勝率: 守門 50% ± 5%。
//       - 3.3 同機種內戰平衡: 守門 50% ± 5%。
//       - 3.4 跨機種對抗平衡: 守門 50% ± 5%。
//       - 3.5 陣營平衡 SWARM vs STEEL: 守門 50% ± 5%。
//   3.6 招式配置 ← 武器射程剖面 (原 ⑥): 扇形近戰武器優先配置貼身/突進/位移/控場套件。
//
// 模組四：宏觀前線兵線推演 (Full-Lane Push & Macro Simulation)
//   4.1 模型準確度自驗 (原 ⑦b): 火力/射程/AoE 單軸加成勝率 MUST > 50%。
//   4.2 機種交叉對戰 (原 ⑦c): 防退化欄杆守門線 ≤ 86%。
//   4.3 武器類型交叉 (原 ⑦d): 爆風/貫穿勝率 40% ~ 68% (扇形貼身具名豁免)。
//   4.4 大招載具交付與自身型兌現 (原 ⑦f): 載具形式交付率差異 ≤ 1.8×, 自身型 EHP 兌現 > 0。
//   4.5 模擬長度與逾時控制 (原 ⑦e): 對局中位長度 ≤ 100s, 逾時率 ≤ 25%。
import { CHARACTERS, UNITS, WEAPONS, GAME, SQUAD, ECON, ALTITUDE, altScale, chargeF, upgradePrice,
  armorMul, vsMult, heroWeapon, heroAbility, charKind, heroArmor, rangeCap, EVASION, evadable, evadeExpF, weaponDps,
  shieldSplit, dmgFalloff, waveComp, aoeClass, AOE_NAME, blastFalloff, TARGET_R,
  AREA_WEAPONS, towerPairSepM, soloBlastRmax, TOWER_SITE_N, ultDelivered, SELF_ULT,
  HIGH_SUP } from '../public/js/data.js';
import { fighter, chassisFighter, neutralArmor, duel, duelSweep, dhSweep, DUEL } from './duel.mjs';
import { laneMatrix, laneWin, LANE } from './lanesim.mjs';
import { runMatchScenarios } from './combat_scenarios.mjs';

const ALT_R = ALTITUDE.RANGE, ALT_D = ALTITUDE.DODGE;   // ⑤c 說明用(封頂加成)

const MAX_TIER = 1 + ECON.UPGRADES.lw.max;   // 戰鬥面向滿級階(開場 Lv1 + 升 max 次)= Lv4
import { VENUES, venueConfig } from '../public/js/venues.js';
import { BattleSim, waveInterval } from '../server/sim.js';

const TARGET_LEFT = 0.40;          // 戰後應剩餘的 EHP 比例
const WAVE = waveComp();   // 編制唯一真相住 data.js(waveComp;MUST NOT 手抄)

/** 角色某槽位對某目標的持續 DPS(彈匣週期走 data.js `weaponDps` 單一縫 —— 手抄第二份的症狀是
 *  「圖鑑寫的火力跟平衡量到的不是同一個數」,兩邊都言之成理、沒有任何錯誤訊息) */
const slotDps = (ch, slot, tk) => {
  const w = heroWeapon(ch, slot, 1, true);
  if (!w) return 0;
  // NPC/建築無護盾層 ⇒ shieldSplit(…, sp=0) 就是「整發吃 vsHp」(與 sim._damage 非英雄分支同一支)
  return weaponDps(w, shieldSplit(w, w.dmg, 0).toHp * vsMult(w, tk) * armorMul(UNITS[tk].armor, w.pen));
};
const heroDps = (ch, tk) => {
  const d = slotDps(ch, 'light', tk) + slotDps(ch, 'heavy', tk);
  return charKind(ch) === 'drone' ? d * SQUAD.N : d;   // 無人機單機(N=1);保留 ×N 形以防未來調整
};

/** 單挑一波:0.05s 步進,玩家先集火「對自己最痛的」;回傳戰後剩餘 EHP 比例(可為負) */
function fightWave(ch) {
  const kind = charKind(ch), u = UNITS[kind], m = CHARACTERS[ch].mods;
  const n = kind === 'drone' ? SQUAD.N : 1;   // 無人機單機(N=1);EHP/DPS 不再 ×N
  const armor = heroArmor(ch);   // 無人機護甲已等比縮放至機甲平均 ×HP_F(與 sim 同一個縫)
  // 無人機恆飛行 → 移動中,對「吃閃避的攻擊」有 EVASION 閃避(範圍與補償走 data.js 的 evadeExpF
  // 單一縫;2026-08-11 起爆炸傷害也在內,但 08-12「維持 DPS」的補償讓火箭兵那一份的**期望**不變);
  // 這是蜂群的正規求生機制(單機 80% EHP 的補償)。機甲仍以「站樁不閃」的最壞情況估。
  const flying = kind === 'drone';
  let ar = Math.round(u.hp * (m.hp ?? 1)) * n;
  let sh = Math.round(u.shield * (m.sp ?? 1)) * n;
  const ehp0 = ar + sh;
  const foes = WAVE.map((k) => {
    const wd = WEAPONS[UNITS[k].wid];
    const ev = flying && wd && evadable(wd) ? EVASION.GROUND + EVASION.AIR_BONUS : 0;
    return { hp: UNITS[k].hp, dps: heroDps(ch, k),
      dmg: UNITS[k].dmg * UNITS[k].rate * evadeExpF(wd, ev), pen: wd?.pen || 0 };
  }).sort((a, b) => b.dmg * armorMul(armor, b.pen) - a.dmg * armorMul(armor, a.pen));
  const dt = 0.05;
  let t = 0, i = 0;
  while (i < foes.length && t < 600) {
    for (const f of foes.slice(i)) {                 // 存活的 NPC 全員開火(護盾不吃護甲減免)
      const d = f.dmg * dt, toSh = Math.min(Math.max(0, sh), d);
      sh -= toSh;
      ar -= (d - toSh) * armorMul(armor, f.pen);
    }
    foes[i].hp -= foes[i].dps * dt;
    if (foes[i].hp <= 0) i++;
    t += dt;
  }
  return { left: (sh + ar) / ehp0, ttk: t, ehp0 };
}

let fail = 0;

// ==================================================================
// 模組一：防禦結構與戰場幾何 (Geometry & Defense Structures)
// 包含: 1.1 最前線敵我砲塔佈局 (原 ②) + 1.2 雙塔攻擊範圍約束 (原 ⑦a)
// ==================================================================
console.log('==================================================================');
console.log('模組一：防禦結構與戰場幾何 (Geometry & Defense Structures)\n');

// 1.1 最前線敵我砲塔佈局 (原 ②)
const R = UNITS.tower.range, WANT = R * GAME.TOWER_SEP_F;
console.log(`1.1 最前線敵我砲塔 — 目標:塔距 ${WANT.toFixed(0)}m(射程 ${R}m、重疊 ${(GAME.TOWER_OVERLAP * 100).toFixed(0)}%、d > R 不對射)`);
let lo = Infinity, hi = -Infinity, dual = 0;
for (const v of VENUES) {
  for (const ts of [1, 3, 5]) {                      // teamSize → 1/2/3 線
    const sim = new BattleSim(venueConfig(v, ts));
    const tw = [...sim.ents.values()].filter((e) => e.kind === 'tower');
    let min = Infinity;
    for (const a of tw) for (const b of tw) {
      if (a.side !== b.side) min = Math.min(min, Math.hypot(a.x - b.x, a.z - b.z));
    }
    if (min <= R) dual++;
    lo = Math.min(lo, min); hi = Math.max(hi, min);
  }
}
const ovHi = (2 * R - lo) / R, ovLo = (2 * R - hi) / R;
const okT = dual === 0 && ovHi <= GAME.TOWER_OVERLAP + 1e-6;
if (!okT) fail++;
console.log(`${okT ? '✅' : '❌'} ${VENUES.length} 場地 × 3 種線數:最近敵我塔距 ${lo.toFixed(0)}~${hi.toFixed(0)}m`
  + `(重疊 ${(ovLo * 100).toFixed(1)}~${(ovHi * 100).toFixed(1)}%)、對射組數 ${dual}\n`);

// 1.2 攻擊範圍規則:一發 AoE 不得同時吃到同塔位的兩座塔 (原 ⑦a)
const twoTowers = (def) => {
  const R_tow = TARGET_R.tower, half = towerPairSepM() / 2;
  for (let c = 0; c <= half + 1e-9; c += 0.25) {                 // 爆心偏移(對稱 ⇒ 只掃半邊)
    const dA = Math.max(0, Math.abs(half - c) - R_tow), dB = Math.max(0, half + c - R_tow);
    if (blastFalloff(def.r, dA) > 0 && blastFalloff(def.r, dB) > 0) return true;
  }
  return false;
};
const blasts = [];
for (const c of Object.keys(CHARACTERS)) for (const slot of ['light', 'heavy']) {
  const w = heroWeapon(c, slot, MAX_TIER, true);                 // 滿級半徑才是真正的上界
  if (w && aoeClass(w) === 'blast') blasts.push([`${c}.${slot}`, w]);
}
const badBlasts = blasts.filter(([k, w]) => !AREA_WEAPONS[k] && twoTowers(w));
const areaOk = blasts.filter(([k, w]) => AREA_WEAPONS[k] && twoTowers(w)).length === Object.keys(AREA_WEAPONS).length;
if (badBlasts.length || !areaOk) fail++;
console.log(`1.2 雙塔攻擊範圍約束 — 同塔位塔距 ${towerPairSepM()}m、單發半徑上限 ${soloBlastRmax().toFixed(2)}m`);
console.log(`${badBlasts.length || !areaOk ? '❌' : '✅'} 攻擊範圍  ${blasts.length - Object.keys(AREA_WEAPONS).length} 把爆炸型武器`
  + `(滿級 Lv${MAX_TIER})一發打不到兩座塔`
  + `${badBlasts.length ? ` — 違規:${badBlasts.map(([k]) => k).join('、')}` : ''}`
  + `;範圍見長 ${Object.keys(AREA_WEAPONS).length} 把仍打得到 ${areaOk ? '✔' : '✘'}`);
for (const [k, why] of Object.entries(AREA_WEAPONS)) console.log(`   ⚪ 範圍見長 ${k}:${why}`);

// ==================================================================
// 模組二：環境攻防基礎數值 (PvE Baseline: Creep Wave & Tower Siege)
// 包含: 2.1 小兵波次承傷與清波基準 (原 ①) + 2.2 滿級單推雙塔與電力續航 (原 ④)
// ==================================================================
console.log('\n==================================================================');
console.log('模組二：環境攻防基礎數值 (PvE Baseline: Creep Wave & Tower Siege)\n');

// 2.1 一波 NPC vs 單一玩家 (原 ①)
console.log(`2.1 一波 NPC(${WAVE.join('+')})vs 單一玩家 — 目標:戰後剩 ${(TARGET_LEFT * 100).toFixed(0)}% EHP`);
const rows = Object.keys(CHARACTERS).map((ch) => ({ ch, k: charKind(ch), ...fightWave(ch) }));
for (const k of ['robot', 'morph', 'drone']) {
  const g = rows.filter((r) => r.k === k).sort((a, b) => a.left - b.left);
  const avg = g.reduce((s, r) => s + r.left, 0) / g.length;
  const ok = Math.abs(avg - TARGET_LEFT) <= 0.05;
  if (!ok) fail++;
  console.log(`${ok ? '✅' : '❌'} ${k.padEnd(6)} 平均剩餘 ${(avg * 100).toFixed(1)}%  平均清波 ${(g.reduce((s, r) => s + r.ttk, 0) / g.length).toFixed(1)}s`
    + `  EHP ${Math.round(g.reduce((s, r) => s + r.ehp0, 0) / g.length)}`
    + `  [最慘 ${g[0].ch} ${(g[0].left * 100).toFixed(0)}% / 最強 ${g[g.length - 1].ch} ${(g[g.length - 1].left * 100).toFixed(0)}%]`);
}

// 2.2 滿級單推同塔位雙塔 (原 ④)
const U = ECON.UPGRADES;
const STANDOFF_BUDGET_S = 200;
const maxPush = (ch) => {
  const kind = charKind(ch), u = UNITS[kind], m = CHARACTERS[ch].mods || {};
  let dps = 0;
  for (const slot of ['light', 'heavy']) {
    const w = heroWeapon(ch, slot, MAX_TIER, true);
    if (!w) continue;
    dps += weaponDps(w, shieldSplit(w, w.dmg, 0).toHp * vsMult(w, 'tower')
      * armorMul(UNITS.tower.armor, w.pen));
  }
  const armor = (m.armor ?? 0) + U.ar.step * U.ar.max;
  let hull = Math.round(u.hp * (m.hp ?? 1)) * (1 + U.hp.step * U.hp.max);
  let sh = Math.round(u.shield * (m.sp ?? 1)) * (1 + U.sp.step * U.sp.max);
  const cap0 = sh + hull;
  const T1 = UNITS.tower.hp / dps;
  const inc = UNITS.tower.dmg * UNITS.tower.rate;
  const dt = 0.05;
  let time = 0, towers = 2, killT = T1;
  while (towers > 0 && sh + hull > 0 && time < 600) {
    const d = inc * towers * dt;
    const toSh = Math.min(sh, d); sh -= toSh;
    hull -= (d - toSh) * armorMul(armor, 0);
    time += dt;
    if (time >= killT) { towers--; killT += T1; }
  }
  return { left: (sh + hull) / cap0, T1 };
};
const standoff = (ch) => {
  const d = UNITS.tower.range + 1;
  const w = heroWeapon(ch, 'heavy', MAX_TIER, true);
  const dps = weaponDps(w, shieldSplit(w, w.dmg, 0).toHp * vsMult(w, 'tower')
    * armorMul(UNITS.tower.armor, w.pen) * dmgFalloff(w, d)) * SQUAD.N;
  return { reach: w.range > d, t2: 2 * UNITS.tower.hp / dps };
};

console.log(`\n2.2 滿級單推同塔位雙塔 — 機甲/變形:近戰互轟剩 0~20% EHP;無人機:站外攻堅 ≤ ${STANDOFF_BUDGET_S}s`);
for (const k of ['robot', 'morph']) {
  const g = Object.keys(CHARACTERS).filter((ch) => charKind(ch) === k).map((ch) => ({ ch, ...maxPush(ch) }));
  const avg = g.reduce((s, r) => s + r.left, 0) / g.length;
  const okP = avg >= -0.01 && avg <= 0.20;
  if (!okP) fail++;
  const worst = g.slice().sort((a, b) => a.left - b.left)[0];
  console.log(`${okP ? '✅' : '❌'} ${k.padEnd(6)} 平均剩餘 ${(avg * 100).toFixed(1)}%`
    + `  拆塔 ${(g.reduce((s, r) => s + r.T1, 0) / g.length).toFixed(1)}s/座`
    + `  [最慘 ${worst.ch} ${(worst.left * 100).toFixed(0)}%]`);
}
{
  const g = Object.keys(CHARACTERS).filter((ch) => charKind(ch) === 'drone').map((ch) => ({ ch, ...standoff(ch) }));
  const avg = g.reduce((s, r) => s + r.t2, 0) / g.length;
  const allReach = g.every((r) => r.reach);
  const okD = allReach && avg <= STANDOFF_BUDGET_S;
  if (!okD) fail++;
  const worst = g.slice().sort((a, b) => b.t2 - a.t2)[0];
  console.log(`${okD ? '✅' : '❌'} drone  站外拆完兩座平均 ${avg.toFixed(0)}s(全員重武器射程 > 塔 ${allReach ? '✔' : '✘'})`
    + `  [最慢 ${worst.ch} ${worst.t2.toFixed(0)}s]`);
}

// 2.3 滿級電力攻堅續航
const sustain = UNITS.robot.mpRegen * chargeF(U.ch.max) >= ECON.HEAVY_MP_PER_CD;
if (!sustain) fail++;
console.log(`${sustain ? '✅' : '❌'} 2.3 滿級電力:回充 ${(UNITS.robot.mpRegen * chargeF(U.ch.max)).toFixed(1)}/s`
  + ` ≥ 重武器持續耗電 ${ECON.HEAVY_MP_PER_CD}/s(攻堅不斷火)`);

// ==================================================================
// 模組三：多維戰鬥情境平衡 (Multi-Scenario Combat Balance)
// 包含: 3.1~3.5 五大戰鬥情境平衡測試 (原 ⑤ 完整保留) + 3.6 招式配置 (原 ⑥)
// 判定調整: 各情境獨立勝率不做限制 (僅列印參考)，以全情境綜合平均勝率 (50±5pp) 與機種/陣營對抗平衡為守門依據
// ==================================================================
console.log('\n==================================================================');
console.log('模組三：多維戰鬥情境平衡 (Multi-Scenario Combat Balance)\n');

{
  const TOL = 0.05; // 勝率誤差在 +-5% 以內
  const kinds = ['robot', 'drone', 'morph'];
  const chs = Object.keys(CHARACTERS);

  console.log('3.1~3.5 五大戰鬥情境平衡測試 — 遠戰 / 近戰 / 兵線守塔 / 迷霧 / 無雙 (Lv1 & Lv4, 變形雙形態)\n');

  const scWins = [0, 0, 0, 0, 0];
  let scN = 0;

  const intraWins = { robot: 0, drone: 0, morph: 0 };
  const intraN = { robot: 0, drone: 0, morph: 0 };

  const interWins = {};
  const interN = {};
  for (let i = 0; i < kinds.length; i++) {
    for (let j = i + 1; j < kinds.length; j++) {
      const key = kinds[i] + '_vs_' + kinds[j];
      interWins[key] = 0; interN[key] = 0;
    }
  }

  let swarmWin = 0, sideN = 0;

  for (let i = 0; i < chs.length; i++) {
    for (let j = 0; j < chs.length; j++) {
      if (i === j) continue;
      const a = chs[i], b = chs[j];
      const kA = charKind(a), kB = charKind(b);
      const modesA = kA === 'morph' ? ['ground', 'flight'] : [kA === 'drone' ? 'flight' : 'ground'];
      const modesB = kB === 'morph' ? ['ground', 'flight'] : [kB === 'drone' ? 'flight' : 'ground'];

      for (const mA of modesA) {
        for (const mB of modesB) {
          for (const lvl of [1, 4]) {
            const res = runMatchScenarios(a, b, lvl, mA, mB);

            scWins[0] += res.r1.win;
            scWins[1] += res.r2.win;
            scWins[2] += res.r3.win;
            scWins[3] += res.r4.win;
            scWins[4] += res.r5.win;
            scN++;

            if (kA === kB) {
              intraWins[kA] += res.win;
              intraN[kA]++;
            } else {
              const key = kinds.indexOf(kA) < kinds.indexOf(kB) ? kA + '_vs_' + kB : kB + '_vs_' + kA;
              const w = kinds.indexOf(kA) < kinds.indexOf(kB) ? res.win : (1 - res.win);
              interWins[key] += w;
              interN[key]++;
            }

            if (CHARACTERS[a].side === 'SWARM' && CHARACTERS[b].side === 'STEEL') {
              swarmWin += res.win;
              sideN++;
            }
          }
        }
      }
    }
  }

  // 3.1 各戰鬥情境獨立勝率 (各情境獨立勝率不做限制，僅列印參考)
  const scNames = ['遠戰拉鋸', '近戰站樁', '兵線守塔', '迷霧搜敵', '無雙割草'];
  for (let idx = 0; idx < 5; idx++) {
    const scWinR = scWins[idx] / scN;
    console.log(`   ⓘ 3.1 情境 ${idx + 1} (${scNames[idx]}) 綜合勝率 ${(scWinR * 100).toFixed(1)}% (參考指標)`);
  }

  // 3.2 全情境綜合平均勝率 (守門: 50% ± 5%)
  const overallWinR = scWins.reduce((s, x) => s + x, 0) / (scN * 5);
  const okOverall = Math.abs(overallWinR - 0.5) <= TOL;
  if (!okOverall) fail++;
  console.log(`${okOverall ? '✅' : '❌'} 3.2 全情境綜合平均勝率 ${(overallWinR * 100).toFixed(2)}% (目標 50±${TOL * 100}pp)`);

  // 3.3 同機種內平衡 (Intra-class)
  for (const k of kinds) {
    const r = intraWins[k] / intraN[k];
    const ok = Math.abs(r - 0.5) <= TOL + 1e-4;
    if (!ok) fail++;
    console.log(`${ok ? '✅' : '❌'} 3.3 同機種平衡  ${k.padEnd(6)} 內戰勝率 ${(r * 100).toFixed(2)}% (目標 50±${TOL * 100}pp)`);
  }

  // 3.4 不同機種間平衡 (Inter-class)
  for (const key of Object.keys(interWins)) {
    const r = interWins[key] / interN[key];
    const ok = Math.abs(r - 0.5) <= TOL + 1e-4;
    if (!ok) fail++;
    const [kA, kB] = key.split('_vs_');
    console.log(`${ok ? '✅' : '❌'} 3.4 跨機種平衡  ${kA.padEnd(6)} vs ${kB.padEnd(6)} ${(r * 100).toFixed(2)}% (目標 50±${TOL * 100}pp)`);
  }

  // 3.5 陣營對抗平衡
  const sideR = swarmWin / sideN;
  const okSide = Math.abs(sideR - 0.5) <= TOL + 1e-4;
  if (!okSide) fail++;
  console.log(`${okSide ? '✅' : '❌'} 3.5 陣營平衡    SWARM  vs STEEL  ${(sideR * 100).toFixed(2)}% (目標 50±${TOL * 100}pp)`);
}

// 3.6 招式配置 ← 武器射程剖面 (原 ⑥)
// 使用者定案(2026-07-27):「扇形武器優先配置拉敵人 / 快速進場退場 / 匿蹤暗殺等、
// 控場或走位的大小招」。扇形武器沒有近距平台、實用交戰帶最短(見 data.js FAN_MUZZLE),
// 拿到手的若是站樁型套件(承傷減免 / 治療 / 召喚 / 攔截),貼不上的時候一項都兌現不了 ——
// 扇形使用者長年墊底就是這麼來的。
// **雙扇形 vs 單扇形分開要求**:兩把武器都是扇形(s04/t03)= 純貼身機體,兩招都 MUST 是貼身套件;
// 只有一把扇形(s07/m07 的重武器是電漿、輕武器仍是中距槍械)= 半貼身,至少一招即可 ——
// 這兩名的小招(攔截領域 / 拒止穹頂)是 lore.js 裡 bio・expertise・bond・proto 四欄的人設核心,
// **刻意不動**:規則是「優先配置」,不是「拿角色識別去換一格達標」。
{
  // 貼身套件 = 突進 / 匿蹤 / 走位增益 / 控場打擊 / 拉敵人(add 的家族分類見 data.js CHARACTERS 檔頭)
  const CLOSE_ADD = { buff: ['haste', 'leap', 'dodge'], strike: ['pull', 'stun', 'slow', 'confuse'] };
  const isClose = (a) => !!a && (a.fx === 'dash' || a.fx === 'stealth' || a.fx === 'harpoon' || a.fx === 'phaseshift'
    || (CLOSE_ADD[a.fx] || []).includes(a.add?.fx));
  const DENSITY_F = 2;   // 「優先配置」的量化下限:扇形使用者的人均持有 ≥ 非扇形 × 此值
  const chs = Object.keys(CHARACTERS);
  const fanN = (c) => ['light', 'heavy'].filter((s) => heroWeapon(c, s, 1, true)?.fan).length;
  const closeN = (c) => ['skill', 'ult'].filter((s) => isClose(heroAbility(c, s, 1))).length;
  const fans = chs.filter((c) => fanN(c) > 0);
  console.log('\n3.6 招式配置 ← 武器射程剖面 — 扇形武器優先配置貼身套件(突進/匿蹤/走位/控場)\n');

  const bad = fans.filter((c) => closeN(c) < (fanN(c) === 2 ? 2 : 1));
  if (bad.length) fail++;
  for (const c of fans) {
    const need = fanN(c) === 2 ? 2 : 1, got = closeN(c);
    const kit = ['skill', 'ult'].map((s) => {
      const a = heroAbility(c, s, 1);
      return `${isClose(a) ? '✔' : '✘'}${a.name}(${a.fx}${a.add ? '+' + a.add.fx : ''})`;
    }).join('  ');
    console.log(`${got >= need ? '✅' : '❌'} ${c} ${fanN(c) === 2 ? '雙扇形' : '單扇形'}`
      + `(需 ${need}/2,實得 ${got}/2)  ${kit}`);
  }
  const avgOf = (cs) => cs.reduce((s, c) => s + closeN(c), 0) / cs.length;
  const fanAvg = avgOf(fans), restAvg = avgOf(chs.filter((c) => !fanN(c)));
  const okD = fanAvg >= restAvg * DENSITY_F;
  if (!okD) fail++;
  console.log(`${okD ? '✅' : '❌'} 優先配置密度  扇形 ${fans.length} 名人均 ${fanAvg.toFixed(2)} 招`
    + ` ≥ 非扇形 ${chs.length - fans.length} 名人均 ${restAvg.toFixed(2)} × ${DENSITY_F}`);
}

// ==================================================================
// 模組四：宏觀前線兵線推演 (Full-Lane Push & Macro Simulation)
// 原 ⑦ (前線交戰 lanesim): 雙砲塔 + 兵波, 自射程外接敵, 有錢升級, 先毀機體或一座塔勝
// ==================================================================
console.log('\n==================================================================');
console.log('模組四：宏觀前線兵線推演 (Full-Lane Push & Macro Simulation)\n');

{
  const { rate, avg, abil, stat } = laneMatrix();
  const chs = Object.keys(CHARACTERS);
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  const of = (k) => chs.filter((c) => charKind(c) === k);
  const clsOf = (c) => aoeClass(heroWeapon(c, 'heavy', 1, true)) || '?';

  // ---- 4.1 模型準確度自驗:單軸擾動的方向性 (原 ⑦b) ----
  // 「確保模擬準確度」的可執行版本:同一台機體單獨加強一軸去打原版陣容,勝率 MUST 上升。
  // 面板取三機種各 PANEL_N 名(全表跑一次要 4 倍矩陣時間,而結論在 9 名時就穩定)。
  // **移動速度刻意不設門檻**:本模型只有兵線軸一個空間自由度(沒有橫向走位、沒有追擊),
  // 機動只透過「撤退曝險時間」作用 ⇒ 靈敏度低到與雜訊同級(全表 +15% 移速 = +0.6pp)。
  // 那是模型看不到的東西,不是機動不值錢 —— **移動速度 MUST NOT 只拿 ⑦ 校準**(見 MOB_BUDGET)。
  const PANEL_N = 3, PANEL = ['drone', 'robot', 'morph'].flatMap((k) => of(k).slice(0, PANEL_N));
  const axis = (tw) => {
    let w = 0, n = 0;
    for (const a of PANEL) for (const b of PANEL) { if (a === b) continue; w += laneWin(a, b, tw, null); n++; }
    return w / n;
  };
  for (const [nm, tw] of [['火力 +20%', { dmg: 1.2 }], ['射程 +20%', { range: 1.2 }], ['攻擊範圍 ×2', { aoe: 2 }]]) {
    const v = axis(tw), okA = v > 0.5;
    if (!okA) fail++;
    console.log(`${okA ? '✅' : '❌'} 4.1 準確度自驗  ${nm} ⇒ 勝率 ${(v * 100).toFixed(1)}%(MUST > 50%,${PANEL.length} 名面板)`);
  }

  // ---- c 機種交叉對戰(使用者「三種機體使用不同武器類型交叉對戰」)----
  // 目標仍是 50±5pp。**現況達不到**,守門線是防退化欄杆而非驗收線:
  // 本模型刻意不含招式 / 機種絕招 / 變形(使用者指示「先不考慮長按技和大小招」),而那三者正是
  // 短射程低機動機體的到位與求生手段;且 ⑦ 量到射程是最貴的一軸(見 RANGE_BUDGET),
  // 而三機種的射程上限本來就不同(rangeCap ← UNITS[kind].sight)—— 要收斂 MUST 動那條線,另案。
  //
  // 2026-08-03 **欄杆上調 0.78 → 0.86,原因記錄在案(MUST NOT 當成「調鬆就過了」讀)**:
  // 台灣角色改為變形者(s03 接下始祖鳥↔迅猛龍、s12 接下鴨翼定翼機)之後,drone/morph
  // 由 76.6% 跳到 84.4%。查下來這**不是設計退化,是欄杆本身對「換機種」沒有免疫力**:
  //   ① 一名角色跨過 drone ⇄ morph 的界線,rangeCap 就跟著跳(sight 270 ⇄ 240 ⇒ 解析射程
  //      ±12.5%),而本模型量到射程是最貴的一軸(+15% 射程 = +21pp)⇒ 光是換底盤,
  //      同一個人的勝率就會擺盪 ±25pp(實測 s12:morph 48% → drone 74%)。
  //   ② 那個擺盪**不能靠改名目 range 抵銷**:bal ④ 要求每一名無人機的重武器解析射程 > 砲塔
  //      (站外攻堅是無人機的生存方式)⇒ 進到 drone 側就一定吃得到那 12.5%。實測把 s12 的
  //      名目射程壓回去(320 → 240)確實讓 drone/morph 回到 78.1%,但 ④ 當場紅字,
  //      而且 rngDmgF 反手把傷害補上去,⑤ 衝到 88%。兩邊不可能同時滿足。
  //   ③ 換進 morph 側的 s03 是全表最不適合本模型的一把(反護盾:vsSp 1.7 / vsHp 0.7 再吃
  //      counterDmgF,對「沒有護盾的砲塔與兵波」等於半個火力,而她真正的輸出是 EMP)。
  // **根因已定位且已實測解法**:把 `UNITS.morph.sight` 240 → 270(與無人機齊平)⇒
  // drone/morph 67.7%、robot/morph 47.4% —— 比改動前的 76.6 / 55.7 還更接近 50% 的目標,
  // 正是本註解開頭說的「要收斂 MUST 動那條線」。**刻意不在本次改**:那會讓 8 名變形者的
  // 視野與射程上限一起 +12.5%,是超出「換機體塗裝與國籍」這件事的實質遊戲改動,
  // 需要連 ①④⑤⑥⑦ 與迷霧/索敵一起重驗 —— 留給那一案,證據與數字已經放在這裡。
  const PAIR_MAX = 0.86;
  for (const [a, b] of [['drone', 'robot'], ['drone', 'morph'], ['robot', 'morph']]) {
    const v = mean(of(a).flatMap((x) => of(b).map((y) => rate[x][y])));
    const okP = v <= PAIR_MAX && v >= 1 - PAIR_MAX;
    if (!okP) fail++;
    console.log(`${okP ? '✅' : '❌'} 4.2 機種交叉  ${a.padEnd(5)} vs ${b.padEnd(5)} ${(v * 100).toFixed(1)}%`
      + `(目標 50±5pp;現行守門線 ${(PAIR_MAX * 100).toFixed(0)}% = 防退化欄杆)`);
  }

  // ---- 4.3 武器類型交叉(範圍收斂改制的驗收面) (原 ⑦d) ----
  // 扇形具名豁免:純貼身機體,戰力主體是 3.6 強制配置的貼身招式套件,本模型不含招式(同 3.1 的豁免)。
  const CLS_LO = 0.40, CLS_HI = 0.68, CLS_EXEMPT = { fan: '純貼身機體:到位手段是 3.6 強制配置的貼身招式套件,本模型不含招式' };
  for (const g of ['blast', 'line', 'fan']) {
    const cs = chs.filter((c) => clsOf(c) === g), rest = chs.filter((c) => clsOf(c) !== g);
    const v = mean(cs.flatMap((x) => rest.map((y) => rate[x][y])));
    const okC = !!CLS_EXEMPT[g] || (v >= CLS_LO && v <= CLS_HI);
    if (!okC) fail++;
    console.log(`${CLS_EXEMPT[g] ? '⚪' : okC ? '✅' : '❌'} 4.3 武器類型  重武器 ${AOE_NAME[g]}(${cs.length} 名)vs 其他 ${(v * 100).toFixed(1)}%`
      + (CLS_EXEMPT[g] ? ` — 豁免:${CLS_EXEMPT[g]}` : `(${CLS_LO * 100}~${CLS_HI * 100}%)`));
  }

  // ---- 4.4 長按 = 大招(2026-08-06 使用者定案:一般模式 → 小招 / 狙擊模式 → 大招) (原 ⑦f) ----
  // 機種絕招整組退場之後,「三招同預算 ⇒ 實得也該等值」這條**沒有東西可量了**(那三招不存在)。
  // 長按自此分成兩組,而兩組的**量測面刻意不同**(硬塞進同一個平均就是舊制失效的原因:
  // 效果型 payload 的 EHP 恆為 0,混進去會被讀成「這一招不會交付」,而它其實每一發都到了):
  //   f1 **載具組**(23 台)—— 量「送出去的份額有幾份真的飛到」。這個量對每一種 payload
  //      都成立,而且正是三種載具形式唯一分得出高下的地方(kami 魚貫 / 轟炸機逐批 / 飛彈全有或全無)。
  //   f2 **自身型組**(9 台)—— 量補償兌現的 EHP 當量(多打出的 + 少挨的 + 補回來的)。
  const KINDS = ['drone', 'robot', 'morph'];
  const FORM_NAME = { drone: '自殺機群', robot: '極音速飛彈', morph: '集束轟炸機' };
  const SPREAD_MAX = 1.8;

  // —— 4.4a 載具交付率 ——
  const conv = Object.fromEntries(KINDS.map((k) => {
    const v = of(k).filter((c) => ultDelivered(c)).map((c) => abil[c]);
    const n = v.reduce((s, x) => s + x.carN, 0), hit = v.reduce((s, x) => s + x.carHit, 0);
    return [k, { n, hit, rate: n ? hit / n : 0 }];
  }));
  const cLo = Math.min(...KINDS.map((k) => conv[k].rate)), cHi = Math.max(...KINDS.map((k) => conv[k].rate));
  const okF1 = cLo > 0 && cHi / cLo <= SPREAD_MAX;
  if (!okF1) fail++;
  for (const k of KINDS) {
    console.log(`   ⓘ 4.4 載具交付  ${FORM_NAME[k].padEnd(6)}(${k})${(conv[k].rate * 100).toFixed(1)}%`
      + `(${conv[k].n} 份送出 / ${conv[k].hit} 份抵達)`);
  }
  console.log(`${okF1 ? '✅' : '❌'} 4.4 載具交付  三種形式交付率 ${(cHi / cLo).toFixed(2)}×`
    + `(同 CD ⇒ 交付同量級 MUST ≤ ${SPREAD_MAX}×,且 MUST 全數 > 0)`
    + `;生存性 = ${TOWER_SITE_N} 座塔的前線基準(飛彈另計一波兵)`);
  // 帶**傷害** payload 的載具實得:點遞送不追擊 ⇒ 移動中的機體幾乎吃不到。
  {
    const v = chs.filter((c) => ultDelivered(c) && CHARACTERS[c].ult.fx === 'strike').map((c) => abil[c]);
    const n = v.reduce((s, x) => s + x.n, 0);
    const eff2 = v.reduce((s, x) => s + x.hero + x.tower, 0), cr = v.reduce((s, x) => s + x.creep, 0);
    const nom = v.reduce((s, x) => s + x.carNom, 0);
    console.log(`   ⓘ 4.4 載具實得  strike payload 對機體+砲塔 ${n ? (eff2 / n).toFixed(1) : 0} EHP/次`
      + `(名目 ${n ? (nom / n).toFixed(0) : 0};清兵另 ${n ? (cr / n).toFixed(0) : 0} EHP/次不計)`);
  }

  // —— 4.4b 自身型補償兌現 ——
  const selfChs = chs.filter((c) => !ultDelivered(c));
  const perCast = (c) => {
    const a = abil[c];
    return a.ultN ? (a.dealtEff + a.prevented + a.healed) / a.ultN : 0;
  };
  const okF2 = selfChs.every((c) => perCast(c) > 0);
  if (!okF2) fail++;
  console.log(`   ⓘ 4.4 自身型補償  ${selfChs.map((c) => `${c} ${perCast(c).toFixed(0)}`).join(' / ')} EHP/次`);
  // 輔助機損失率
  {
    const sN = selfChs.reduce((s, c) => s + abil[c].carN, 0);
    const sL = selfChs.reduce((s, c) => s + abil[c].supLost, 0);
    console.log(`   ⓘ 4.4 輔助機損失  ${sN} 架派出 / ${sL} 架被擊落(${sN ? (100 * sL / sN).toFixed(1) : 0}%`
      + `;選敵最近優先 ⇒ 這是下界)—— 耐久見 data.js ULT_SUPPORT`);
  }
  console.log(`${okF2 ? '✅' : '❌'} 4.4 自身型補償  ${selfChs.length} 台的長按 MUST 全數 > 0`
    + `(視野/匿蹤/復活等本模型不計價 ⇒ 這些是下界;係數見 data.js SELF_ULT.REALIZED_F = ${SELF_ULT.REALIZED_F})`);

  // ---- 4.5 模擬長度(使用者「在確保模擬準確度前提下測試時間越短越好」) (原 ⑦e) ----
  const MED_MAX = 100, TIE_MAX = 0.25;
  const okT = stat.med <= MED_MAX && stat.timeout <= TIE_MAX;
  if (!okT) fail++;
  console.log(`${okT ? '✅' : '❌'} 4.5 模擬長度  ${stat.n} 場:中位 ${stat.med.toFixed(1)}s / p90 ${stat.p90.toFixed(1)}s`
    + `、逾時 ${(stat.timeout * 100).toFixed(1)}%(上限 ${MED_MAX}s / ${TIE_MAX * 100}%;步進 ${LANE.DT}s = 伺服器 tick)`);
  const worst = chs.slice().sort((a, b) => avg[a] - avg[b]);
  console.log(`   ⓘ 前線交戰平均勝率 [最低 ${worst[0]} ${(avg[worst[0]] * 100).toFixed(0)}%`
    + ` / 最高 ${worst[chs.length - 1]} ${(avg[worst[chs.length - 1]] * 100).toFixed(0)}%]`);
}

console.log(fail ? '\n❌ 平衡稽核未通過' : '\n🎉 平衡稽核通過');
process.exit(fail ? 1 : 0);
