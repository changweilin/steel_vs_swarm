// ============ 平衡稽核(離線,純 Node,無依賴):`npm run bal` ============
// 四條 CLAUDE.md 的不變式,改平衡數值後 MUST 重跑:
//
// ① 一波 NPC = 玩家 60% EHP
//    一波 = 同線同側 WAVE_SOLDIERS 步槍兵 + WAVE_EXTRAS(火箭兵/榴彈兵/坦克/攻擊直升機)。
//    情境:玩家單挑整波、雙方全在有效射程內(近距平台,無距離衰減)持續開火、
//    玩家只有 Lv1 輕武器 + 重武器照 CD、無升級/招式/掩體 ⇒ 清完波後應剩 ~40% EHP。
//    (無人機為單機:EHP = 機甲平均 ×80%、傷害同機甲;恆飛行 → 對直射武器有 EVASION 閃避)
//
// ② 最前線敵我砲塔:射程重疊 TOWER_OVERLAP(0.8)且互不在對方射程內(d = 1.2R > R)。
//    對全部預設場地 × 1/2/3 線實際起一份 BattleSim,量最近的一對敵我塔。
//
// ③ 10 分鐘升滿(2026-07-20 面向經濟):單一兵線 30% 擊殺 + 40% 助攻(×ASSIST.F)
//    的 10 分鐘賞金收入 + 開局資金 ≈ 八軌全滿總價(8 軌 × 各 max 級 × 固定單價,±10%;無擊殺門檻)。
//
// ④ 滿級單推同塔位雙塔:八軌全滿的玩家攻擊一組塔位。
//    機甲/變形機甲(單機)= 近戰互轟模型(前段雙塔回擊、殺一座後單塔;無距離衰減/
//    無招式/無爆擊/護盾持續受擊不回復)⇒ 平均「剛好」活著拆完(剩 0~20% EHP)。
//    無人機(單機)= 站外圍攻模型:重武器射程 > 砲塔(311m 外零承傷、含距離衰減)⇒
//    驗每台重武器射程確實 > 塔 + 機種平均拆完兩座 ≤ 站外時間預算(單機 DPS ⇒ 較慢但不承傷)。
import { CHARACTERS, UNITS, WEAPONS, GAME, SQUAD, ECON, chargeF, upgradePrice,
  armorMul, vsMult, heroWeapon, charKind, heroArmor, EVASION, grenadeBuildingMul, dmgFalloff } from '../public/js/data.js';

const MAX_TIER = 1 + ECON.UPGRADES.lw.max;   // 戰鬥面向滿級階(開場 Lv1 + 升 max 次)= Lv4
import { VENUES, venueConfig } from '../public/js/venues.js';
import { BattleSim, waveInterval } from '../server/sim.js';

const TARGET_LEFT = 0.40;          // 戰後應剩餘的 EHP 比例
const WAVE = [...Array(GAME.WAVE_SOLDIERS).fill('soldier'), ...GAME.WAVE_EXTRAS];   // 編制唯一真相住 data.js

/** 角色某槽位對某目標的持續 DPS(含換彈:輕/重武器一律 mag 發 / reload 秒;2026-07-18 重武器改彈夾 2~5 + 裝填 6~15s) */
const slotDps = (ch, slot, tk) => {
  const w = heroWeapon(ch, slot, 1, true);
  if (!w) return 0;
  const cycle = w.mag / (w.rate || 3) + w.reload;
  return w.dmg * vsMult(w, tk) * armorMul(UNITS[tk].armor, w.pen) * w.mag / cycle;
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
  // 無人機恆飛行 → 移動中,對「直射(無爆風)」武器有 EVASION 閃避(比照 sim _dodges 觸發條件);
  // 這是蜂群的正規求生機制(單機 80% EHP 的補償)。機甲仍以「站樁不閃」的最壞情況估。
  const flying = kind === 'drone';
  let ar = Math.round(u.hp * (m.hp ?? 1)) * n;
  let sh = Math.round(u.shield * (m.sp ?? 1)) * n;
  const ehp0 = ar + sh;
  const foes = WAVE.map((k) => {
    const wd = WEAPONS[UNITS[k].wid];
    const ev = flying && wd && !wd.r ? EVASION.GROUND + EVASION.AIR_BONUS : 0;
    return { hp: UNITS[k].hp, dps: heroDps(ch, k),
      dmg: UNITS[k].dmg * UNITS[k].rate * (1 - ev), pen: wd?.pen || 0 };
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
console.log(`① 一波 NPC(${WAVE.join('+')})vs 單一玩家 — 目標:戰後剩 ${(TARGET_LEFT * 100).toFixed(0)}% EHP\n`);
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

const R = UNITS.tower.range, WANT = R * GAME.TOWER_SEP_F;
console.log(`\n② 最前線敵我砲塔 — 目標:塔距 ${WANT.toFixed(0)}m(射程 ${R}m、重疊 ${(GAME.TOWER_OVERLAP * 100).toFixed(0)}%、d > R 不對射)\n`);
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
  + `(重疊 ${(ovLo * 100).toFixed(1)}~${(ovHi * 100).toFixed(1)}%)、對射組數 ${dual}`);

// ---------- ③ 10 分鐘升滿(單線 30% 擊殺 / 40% 助攻)----------
{
  const KILL_R = 0.30, ASSIST_R = 0.40, HORIZON = 600, TRAVEL = 60;   // TRAVEL:波次行軍+交戰折讓
  let t = 0, waves = 0;
  for (let n = 1; t <= HORIZON - TRAVEL; n++) { waves++; t += waveInterval(n); }
  const comp = [...Array(GAME.WAVE_SOLDIERS).fill('soldier'), ...GAME.WAVE_EXTRAS];
  const waveBounty = comp.reduce((s, k) => s + ECON.BOUNTY[k], 0);
  const income = ECON.START + (KILL_R + ASSIST_R * ECON.ASSIST.F) * waves * waveBounty;
  // 八軌全滿 = 8 軌各級階梯單價 upgradePrice(u,lvl) 之和(2026-07-20;無擊殺門檻,隨等級遞增)
  const totalCost = Object.values(ECON.UPGRADES)
    .reduce((s, u) => { for (let l = 0; l < u.max; l++) s += upgradePrice(u, l); return s; }, 0);
  const ratio = totalCost / income;
  const okE = ratio >= 0.9 && ratio <= 1.1;
  if (!okE) fail++;
  console.log(`\n③ 10 分鐘升滿 — 目標:八軌總價 ≈ 收入預算(±10%)\n`);
  console.log(`${okE ? '✅' : '❌'} ${waves} 波 × 波賞金 $${waveBounty} × 有效分成 ${(KILL_R + ASSIST_R * ECON.ASSIST.F).toFixed(2)}`
    + ` + 開局 $${ECON.START} = 預算 $${Math.round(income)};八軌總價 $${totalCost}`
    + `(階梯 $${ECON.UPG_BASE}+$${ECON.UPG_INC}×lvl、第三階固定 $${ECON.UPG_L3},比 ${(ratio * 100).toFixed(1)}%)`);
}

// ---------- ④ 滿級單推同塔位雙塔 ----------
{
  const U = ECON.UPGRADES;
  // 無人機站外攻堅:機種平均拆完兩座的時間預算。2026-07-20 面向改制取消武器精通(reload ×0.6)後,
  // 純量填彈的重武器在滿級(Lv4 品質但無填彈折減)持續 DPS 較舊制低 ~15% → 預算 180→200s;
  // 這是「站外龜拆」模型的平均值(防空/反甲特化 vs.building≤0.5 的機種本就拆得慢,設計容許)。
  const STANDOFF_BUDGET_S = 200;
  // 機甲/變形機甲(單機):近戰互轟 —— 前段雙塔回擊、殺一座後單塔
  const maxPush = (ch) => {
    const kind = charKind(ch), u = UNITS[kind], m = CHARACTERS[ch].mods || {};
    let dps = 0;   // 輕/重武器滿級(Lv4)對塔 DPS(pen 折進 armorMul;2026-07-20 無精通,填彈折減併入階級)
    for (const slot of ['light', 'heavy']) {
      const w = heroWeapon(ch, slot, MAX_TIER, true);
      if (!w) continue;
      const cycle = w.mag / (w.rate || 3) + w.reload;
      dps += w.dmg * vsMult(w, 'tower') * grenadeBuildingMul(w, 'tower')
        * armorMul(UNITS.tower.armor, w.pen) * w.mag / cycle;
    }
    const armor = (m.armor ?? 0) + U.ar.step * U.ar.max;
    let hull = Math.round(u.hp * (m.hp ?? 1)) * (1 + U.hp.step * U.hp.max);
    let sh = Math.round(u.shield * (m.sp ?? 1)) * (1 + U.sp.step * U.sp.max);
    const cap0 = sh + hull;
    const T1 = UNITS.tower.hp / dps;             // 拆一座塔的時間
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
  // 無人機(單機):站外圍攻 —— 塔射程外一步(零承傷、> SAM 240 亦不吃防空),
  // 重武器 × 距離衰減;fan 電漿在射程末端貼 FAN_FLOOR = 刻意「碰得到、拆得慢」
  const standoff = (ch) => {
    const d = UNITS.tower.range + 1;
    const w = heroWeapon(ch, 'heavy', MAX_TIER, true);
    const cycle = w.mag / (w.rate || 3) + w.reload;
    const dps = w.dmg * vsMult(w, 'tower') * grenadeBuildingMul(w, 'tower')
      * armorMul(UNITS.tower.armor, w.pen) * dmgFalloff(w, d) * w.mag / cycle * SQUAD.N;
    return { reach: w.range > d, t2: 2 * UNITS.tower.hp / dps };
  };
  console.log(`\n④ 滿級單推同塔位雙塔 — 機甲/變形:近戰互轟剩 0~20% EHP;無人機:站外攻堅 ≤ ${STANDOFF_BUDGET_S}s\n`);
  for (const k of ['robot', 'morph']) {
    const g = Object.keys(CHARACTERS).filter((ch) => charKind(ch) === k).map((ch) => ({ ch, ...maxPush(ch) }));
    const avg = g.reduce((s, r) => s + r.left, 0) / g.length;
    const okP = avg > 0 && avg <= 0.20;
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
  // 滿級電力經濟:充能滿級回充 ≥ 重武器持續耗電率(HEAVY_MP_PER_CD),攻堅不斷火
  const sustain = UNITS.robot.mpRegen * chargeF(U.ch.max) >= ECON.HEAVY_MP_PER_CD;
  if (!sustain) fail++;
  console.log(`${sustain ? '✅' : '❌'} 滿級電力:回充 ${(UNITS.robot.mpRegen * chargeF(U.ch.max)).toFixed(1)}/s`
    + ` ≥ 重武器持續耗電 ${ECON.HEAVY_MP_PER_CD}/s(攻堅不斷火)`);
}

console.log(fail ? '\n❌ 平衡稽核未通過' : '\n🎉 平衡稽核通過');
process.exit(fail ? 1 : 0);
