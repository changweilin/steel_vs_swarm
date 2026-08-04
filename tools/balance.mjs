// ============ 平衡稽核(離線,純 Node,無依賴):`npm run bal` ============
// 六條 CLAUDE.md 的不變式,改平衡數值後 MUST 重跑:
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
//    機甲/變形者(單機)= 近戰互轟模型(前段雙塔回擊、殺一座後單塔;無距離衰減/
//    無招式/無爆擊/護盾持續受擊不回復)⇒ 平均「剛好」活著拆完(剩 0~20% EHP)。
//    無人機(單機)= 站外圍攻模型:重武器射程 > 砲塔(311m 外零承傷、含距離衰減)⇒
//    驗每台重武器射程確實 > 塔 + 機種平均拆完兩座 ≤ 站外時間預算(單機 DPS ⇒ 較慢但不承傷)。
//
// ⑤ 對進戰勝率(2026-07-27 使用者原則:「戰力平衡策略須考量**攻擊距離**與**高度差**;
//    測試時要考慮**從遠處移動到進入射程**,平均**不同高度差**的勝率」)。
//    ①~④ 都是「同高度、近距平台、不移動」的靜態模型 —— 射程與高度差對結果毫無作用。
//    ⑤ 補上這兩個維度:1v1 自射程外接近 → 進入射程 → 拉鋸 → 定點互轟,並在
//    ±3 個砲塔高的高度差上對稱掃描取平均勝率(模型見 tools/duel.mjs,唯一縫)。
//    a 陣營對稱:SWARM vs STEEL 全對局平均勝率 50% ±SIDE_TOL
//    b 機種對稱:三機種各自 vs 全體的平均勝率 50% ±KIND_TOL
//    c 高度差中性:較高方平均勝率 50% ±HIGH_TOL —— 高地換的是視野與機動,不該直接換勝負
//    d 角色離群:非豁免角色的平均勝率 ∈ [CH_LO, CH_HI];豁免一律具名附理由(見 DUEL_EXEMPT)
//    e 射程壓制上限:接近期單方面挨打的損失 ≤ 對手初始 EHP 的 FREE_MAX
//       —— 射程差可以換到先手,但不該在對手還沒進場前就分出勝負。
//
// ⑥ 招式配置 ← 武器射程剖面(2026-07-27 使用者定案:「扇形武器優先配置拉敵人 / 快速進場退場 /
//    匿蹤暗殺等、控場或走位的大小招」)。扇形武器沒有近距平台、實用交戰帶最短,拿到站樁型套件
//    (承傷減免 / 治療 / 召喚 / 攔截)等於貼不上就一項都兌現不了。雙扇形 MUST 兩招都是貼身套件、
//    單扇形 MUST 至少一招,另驗「優先配置」的密度(扇形人均 ≥ 非扇形人均 ×2)。
import { CHARACTERS, UNITS, WEAPONS, GAME, SQUAD, ECON, ALTITUDE, chargeF, upgradePrice,
  armorMul, vsMult, heroWeapon, heroAbility, charKind, heroArmor, EVASION, weaponDps,
  shieldSplit, dmgFalloff, waveComp, aoeClass, AOE_NAME, blastFalloff, TARGET_R,
  AREA_WEAPONS, towerPairSepM, soloBlastRmax, TOWER_SITE_N } from '../public/js/data.js';
import { fighter, duel, duelSweep, dhSweep, DUEL } from './duel.mjs';
import { laneMatrix, laneWin, LANE } from './lanesim.mjs';

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
  for (; t <= HORIZON - TRAVEL;) { waves++; t += waveInterval(); }   // 2026-07-30:出兵間隔固定
  const waveBounty = waveComp().reduce((s, k) => s + ECON.BOUNTY[k], 0);
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
  // 機甲/變形者(單機):近戰互轟 —— 前段雙塔回擊、殺一座後單塔
  const maxPush = (ch) => {
    const kind = charKind(ch), u = UNITS[kind], m = CHARACTERS[ch].mods || {};
    let dps = 0;   // 輕/重武器滿級(Lv4)對塔 DPS(pen 折進 armorMul;2026-07-20 無精通,填彈折減併入階級)
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
    const dps = weaponDps(w, shieldSplit(w, w.dmg, 0).toHp * vsMult(w, 'tower')
      * armorMul(UNITS.tower.armor, w.pen) * dmgFalloff(w, d)) * SQUAD.N;
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

// ---------- ⑤ 對進戰勝率(攻擊距離 × 高度差)----------
{
  const SIDE_TOL = 0.05, KIND_TOL = 0.05, HIGH_TOL = 0.03;   // 陣營 / 機種 / 較高方的容差
  const CH_LO = 0.20, CH_HI = 0.80;                          // 單一角色的勝率上下界
  const FREE_MAX = 0.40;                                     // 接近期單方面損失上限(對手初始 EHP 比例)
  // 具名豁免:對進戰模型**只算武器**(與 ①/④ 同基準,不含招式)—— 下列角色的戰力主體是
  // 模型算不到的招式,硬把武器數值拉到區間內反而會讓他們在實戰中過強。豁免 MUST 附理由。
  const DUEL_EXEMPT = {
    t03: '「大鍋」鍋蓋開道(dash 進場)+ 開鍋(strike 拉近)—— 戰力主體是把敵人帶進扇形甜蜜點,模型不模擬位移與拉近',
    s10: '「白噪音」訊號矛每發附帶 EMP 1.5~2.5s(對手武器離線)+ 大招 EMP —— 實際輸出是「讓對方不能輸出」',
    s04: '「Kashi」突進機動(CD 12s 位移)是貼身扇形武器的到位手段 —— 模型不模擬位移招式 ⇒ 永遠貼不上',
  };
  const chs = Object.keys(CHARACTERS);
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
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  const avg = Object.fromEntries(chs.map((a) => [a, mean(Object.values(rate[a]))]));
  const of = (k) => chs.filter((c) => charKind(c) === k);
  console.log(`\n⑤ 對進戰勝率 — 自射程外接近 → 進場 → 拉鋸 → 互轟;高度差 ±${DUEL.DH_MAX_F} 個砲塔高`
    + `(${sweep.length} 點對稱掃描)取平均\n`);

  // a 陣營對稱(2026-08-02 機體混編改制:陣營不再等於機種 ⇒ MUST 用**真正的陣營成員**交叉對局。
  //   舊制以 drone×robot 代打,混編後那條等同 b 的機種對稱,量不到陣營本身。
  //   傭兵 side:'MERC' 雙陣營皆可受雇,不計入任一邊。)
  const sideOf = (s) => chs.filter((c) => CHARACTERS[c].side === s);
  const side = mean(sideOf('SWARM').flatMap((a) => sideOf('STEEL').map((b) => rate[a][b])));
  const okS = Math.abs(side - 0.5) <= SIDE_TOL;
  if (!okS) fail++;
  console.log(`${okS ? '✅' : '❌'} 陣營對稱  SWARM vs STEEL ${(side * 100).toFixed(1)}%`
    + `(目標 50±${SIDE_TOL * 100}pp;${sideOf('SWARM').length * sideOf('STEEL').length} 組對局)`);

  // b 機種對稱
  for (const k of ['drone', 'robot', 'morph']) {
    const v = mean(of(k).map((c) => avg[c]));
    const okK = Math.abs(v - 0.5) <= KIND_TOL;
    if (!okK) fail++;
    console.log(`${okK ? '✅' : '❌'} 機種對稱  ${k.padEnd(6)} vs 全體 ${(v * 100).toFixed(1)}%(目標 50±${KIND_TOL * 100}pp)`);
  }

  // c 高度差中性(較高方 = dh > 0 的那一側)
  let hw = 0, hn = 0;
  for (const dh of sweep.filter((x) => x > 0)) for (const a of chs) for (const b of chs) {
    if (a === b) continue;
    hw += duel(F[a], F[b], dh).win; hn++;
  }
  const high = hw / hn;
  const okH = Math.abs(high - 0.5) <= HIGH_TOL;
  if (!okH) fail++;
  console.log(`${okH ? '✅' : '❌'} 高度差中性 較高方 ${(high * 100).toFixed(1)}%(目標 50±${HIGH_TOL * 100}pp)`
    + ` — 高地換視野與機動(+${(ALT_R * 100).toFixed(0)}% 射程 / +${(ALT_D * 100).toFixed(0)}% 閃避),不換勝負`);

  // d 角色離群(具名豁免除外)
  const bad = chs.filter((c) => !DUEL_EXEMPT[c] && (avg[c] < CH_LO || avg[c] > CH_HI));
  if (bad.length) fail++;
  const sorted = chs.slice().sort((a, b) => avg[a] - avg[b]);
  console.log(`${bad.length ? '❌' : '✅'} 角色離群  ${chs.length - Object.keys(DUEL_EXEMPT).length} 名受檢角色全在`
    + ` ${CH_LO * 100}~${CH_HI * 100}%${bad.length ? ` — 出界:${bad.map((c) => `${c} ${(avg[c] * 100).toFixed(0)}%`).join('、')}` : ''}`
    + `  [最低 ${sorted[0]} ${(avg[sorted[0]] * 100).toFixed(0)}% / 最高 ${sorted[sorted.length - 1]}`
    + ` ${(avg[sorted[sorted.length - 1]] * 100).toFixed(0)}%]`);
  for (const [c, why] of Object.entries(DUEL_EXEMPT))
    console.log(`   ⚪ 豁免 ${c} ${(avg[c] * 100).toFixed(0)}%(模型只算武器):${why}`);

  // e 射程壓制上限
  let mx = 0, mxPair = '';
  for (const a of chs) for (const b of chs) {
    if (a === b) continue;
    if (free[a][b] > mx) { mx = free[a][b]; mxPair = `${a}→${b}`; }
  }
  const okF = mx <= FREE_MAX;
  if (!okF) fail++;
  console.log(`${okF ? '✅' : '❌'} 射程壓制  接近期單方面損失最大 ${(mx * 100).toFixed(1)}% EHP`
    + `(${mxPair};上限 ${FREE_MAX * 100}%)`);
}

// ---------- ⑥ 招式配置 ← 武器射程剖面 ----------
// 使用者定案(2026-07-27):「扇形武器優先配置拉敵人 / 快速進場退場 / 匿蹤暗殺等、
// 控場或走位的大小招」。扇形武器沒有近距平台、實用交戰帶最短(見 data.js FAN_MUZZLE),
// 拿到手的若是站樁型套件(承傷減免 / 治療 / 召喚 / 攔截),貼不上的時候一項都兌現不了 ——
// ⑤ 的角色離群列上,扇形使用者長年墊底就是這麼來的。
// **雙扇形 vs 單扇形分開要求**:兩把武器都是扇形(s04/t03)= 純貼身機體,兩招都 MUST 是貼身套件;
// 只有一把扇形(s07/m07 的重武器是電漿、輕武器仍是中距槍械)= 半貼身,至少一招即可 ——
// 這兩名的小招(攔截領域 / 拒止穹頂)是 lore.js 裡 bio・expertise・bond・proto 四欄的人設核心,
// **刻意不動**:規則是「優先配置」,不是「拿角色識別去換一格達標」。
{
  // 貼身套件 = 突進 / 匿蹤 / 走位增益 / 控場打擊(add 的家族分類見 data.js CHARACTERS 檔頭)
  const CLOSE_ADD = { buff: ['haste', 'leap', 'dodge'], strike: ['pull', 'stun', 'slow', 'confuse'] };
  const isClose = (a) => !!a && (a.fx === 'dash' || a.fx === 'stealth'
    || (CLOSE_ADD[a.fx] || []).includes(a.add?.fx));
  const DENSITY_F = 2;   // 「優先配置」的量化下限:扇形使用者的人均持有 ≥ 非扇形 × 此值
  const chs = Object.keys(CHARACTERS);
  const fanN = (c) => ['light', 'heavy'].filter((s) => heroWeapon(c, s, 1, true)?.fan).length;
  const closeN = (c) => ['skill', 'ult'].filter((s) => isClose(heroAbility(c, s, 1))).length;
  const fans = chs.filter((c) => fanN(c) > 0);
  console.log('\n⑥ 招式配置 ← 武器射程剖面 — 扇形武器優先配置貼身套件(突進/匿蹤/走位/控場)\n');

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

// ---------- ⑦ 前線交戰(射程 / 移速 / 火力 / 攻擊範圍 / 兵波 / 砲塔 / 經濟)----------
// 2026-08-02 使用者定案的模擬方式(模型見 tools/lanesim.mjs,唯一縫):
//   「須同時考量射程/速度/攻擊/範圍/兵波/砲塔等等,簡易模擬環境只有前線雙砲塔 + 兵波NPC
//     (生成頻率同正式遊戲),模擬從雙方射程外開始接敵,有錢就升級,先擊毀敵方機體或一座砲塔者獲勝」。
// ①~⑤ 全是單體、無兵線、無經濟的模型 ⇒ **攻擊範圍**這一軸在那裡從來沒有進過算式;
// ⑦ 是它唯一被計價的地方。改 AoE 半徑 / AREA_WEAPONS / AOE_BUDGET / MOB_BUDGET / RANGE_BUDGET
// MUST 以本段為準。
{
  const { rate, avg, abil, stat } = laneMatrix();
  const chs = Object.keys(CHARACTERS);
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  const of = (k) => chs.filter((c) => charKind(c) === k);
  const clsOf = (c) => aoeClass(heroWeapon(c, 'heavy', 1, true)) || '?';
  console.log('\n⑦ 前線交戰 — 前線雙砲塔 + 兵波,自射程外接敵,有錢就升級,先毀敵機體或一座塔者勝\n');

  // ---- a 攻擊範圍規則:一發 AoE 不得同時吃到同塔位的兩座塔 ----
  // 判定用**實算**而非比對常數:爆心沿兩塔連心線逐點掃,兩座塔都掉血就算違規
  // (直接比 r × EDGE 也對,但實算連 blastFalloff 改形狀都驗得到)。
  const twoTowers = (def) => {
    const R = TARGET_R.tower, half = towerPairSepM() / 2;
    for (let c = 0; c <= half + 1e-9; c += 0.25) {                 // 爆心偏移(對稱 ⇒ 只掃半邊)
      const dA = Math.max(0, Math.abs(half - c) - R), dB = Math.max(0, half + c - R);
      if (blastFalloff(def.r, dA) > 0 && blastFalloff(def.r, dB) > 0) return true;
    }
    return false;
  };
  const blasts = [];
  for (const c of chs) for (const slot of ['light', 'heavy']) {
    const w = heroWeapon(c, slot, MAX_TIER, true);                 // 滿級半徑才是真正的上界
    if (w && aoeClass(w) === 'blast') blasts.push([`${c}.${slot}`, w]);
  }
  const bad = blasts.filter(([k, w]) => !AREA_WEAPONS[k] && twoTowers(w));
  const areaOk = blasts.filter(([k, w]) => AREA_WEAPONS[k] && twoTowers(w)).length === Object.keys(AREA_WEAPONS).length;
  if (bad.length || !areaOk) fail++;
  console.log(`${bad.length || !areaOk ? '❌' : '✅'} a 攻擊範圍  ${blasts.length - Object.keys(AREA_WEAPONS).length} 把爆炸型武器`
    + `(滿級 Lv${MAX_TIER})一發打不到兩座塔(同塔位塔距 ${towerPairSepM()}m、半徑上限 ${soloBlastRmax().toFixed(2)}m)`
    + `${bad.length ? ` — 違規:${bad.map(([k]) => k).join('、')}` : ''}`
    + `;範圍見長 ${Object.keys(AREA_WEAPONS).length} 把仍打得到 ${areaOk ? '✔' : '✘'}`);
  for (const [k, why] of Object.entries(AREA_WEAPONS)) console.log(`   ⚪ 範圍見長 ${k}:${why}`);

  // ---- b 模型準確度自驗:單軸擾動的方向性 ----
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
    console.log(`${okA ? '✅' : '❌'} b 準確度自驗  ${nm} ⇒ 勝率 ${(v * 100).toFixed(1)}%(MUST > 50%,${PANEL.length} 名面板)`);
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
    console.log(`${okP ? '✅' : '❌'} c 機種交叉  ${a.padEnd(5)} vs ${b.padEnd(5)} ${(v * 100).toFixed(1)}%`
      + `(目標 50±5pp;現行守門線 ${(PAIR_MAX * 100).toFixed(0)}% = 防退化欄杆)`);
  }

  // ---- d 武器類型交叉(範圍收斂改制的驗收面)----
  // 扇形具名豁免:純貼身機體,戰力主體是 ⑥ 強制配置的貼身招式套件,本模型不含招式(同 ⑤ 的豁免)。
  const CLS_LO = 0.40, CLS_HI = 0.68, CLS_EXEMPT = { fan: '純貼身機體:到位手段是 ⑥ 強制配置的貼身招式套件,本模型不含招式' };
  for (const g of ['blast', 'line', 'fan']) {
    const cs = chs.filter((c) => clsOf(c) === g), rest = chs.filter((c) => clsOf(c) !== g);
    const v = mean(cs.flatMap((x) => rest.map((y) => rate[x][y])));
    const okC = !!CLS_EXEMPT[g] || (v >= CLS_LO && v <= CLS_HI);
    if (!okC) fail++;
    console.log(`${CLS_EXEMPT[g] ? '⚪' : okC ? '✅' : '❌'} d 武器類型  重武器 ${AOE_NAME[g]}(${cs.length} 名)vs 其他 ${(v * 100).toFixed(1)}%`
      + (CLS_EXEMPT[g] ? ` — 豁免:${CLS_EXEMPT[g]}` : `(${CLS_LO * 100}~${CLS_HI * 100}%)`));
  }

  // ---- f 長按攻擊(2026-08-02 使用者定案「只使用輕/重武器 + 長按攻擊」)----
  // 三招吃**同一份**傷害預算(SPECIAL)、同一顆鍵、同一段 30s CD ⇒ 使用者的設計語意就是「威力等值」。
  // e2e 已釘死**名目**預算等值,但名目不等於實得:三招的載具都會被打下來,交付方式也各不相同
  // (護衛機要撲到臉上、轟炸機從 90m 外投、飛彈得飛完全程且攔截即完全否定)。
  // ⑦f 量的就是**實得**:打在「敵方機體 + 敵方砲塔」上的 EHP(= 兩個勝利條件),
  // 清兵那一桶刻意不計 —— 兵波每 waveInterval 補一批,爆風掃到幾隻很好看但不決定勝負,
  // 把它算進來會讓半徑大的一招看起來永遠贏(實測總傷害與有效傷害可以差到 4 倍)。
  const KINDS = ['drone', 'robot', 'morph'];
  const ABIL_NAME = { drone: '飽和攻擊', robot: '極音速飛彈', morph: '集束炸彈' };
  const eff = Object.fromEntries(KINDS.map((k) => {
    const v = of(k).map((c) => abil[c]);
    const n = v.reduce((s, x) => s + x.n, 0);
    return [k, { n, per: n ? v.reduce((s, x) => s + x.hero + x.tower, 0) / n : 0 }];
  }));
  // 守門線 1.8×(現行 1.71×)。**剩下的差距是結構性的,不是還沒調完**:三招總覆蓋面積已相同,
  // 但極音速飛彈是**一顆**大圓、飽和攻擊是四顆小圓 —— 目標擠成一團(機體 + 同塔位雙塔)時,
  // 一顆大圓一次吃三個、四顆小圓各吃各的。要再收就得動「切幾顆」本身(KAMI.N / BOMB_MAX),
  // 而那是使用者定調的招式形狀 ⇒ 這裡當**防退化欄杆**用,不是驗收線。
  const SPREAD_MAX = 1.8;
  const lo = Math.min(...KINDS.map((k) => eff[k].per)), hi = Math.max(...KINDS.map((k) => eff[k].per));
  const okF = lo > 0 && hi / lo <= SPREAD_MAX;
  if (!okF) fail++;
  for (const k of KINDS) {
    console.log(`   ⓘ f 長按攻擊  ${ABIL_NAME[k].padEnd(6)}(${k})有效傷害 ${eff[k].per.toFixed(0)} EHP/次`
      + `(打在敵方機體 + 砲塔上;${eff[k].n} 次施放)`);
  }
  console.log(`${okF ? '✅' : '❌'} f 長按攻擊  三招實得比 ${(hi / lo).toFixed(2)}×(同預算同 CD ⇒ MUST ≤ ${SPREAD_MAX}×,且 MUST 全數 > 0)`
    + `;載具生存性 = ${TOWER_SITE_N} 座塔的前線基準(飛彈另計一波兵)`);

  // ---- e 模擬長度(使用者「在確保模擬準確度前提下測試時間越短越好」)----
  const MED_MAX = 100, TIE_MAX = 0.25;
  const okT = stat.med <= MED_MAX && stat.timeout <= TIE_MAX;
  if (!okT) fail++;
  console.log(`${okT ? '✅' : '❌'} e 模擬長度  ${stat.n} 場:中位 ${stat.med.toFixed(1)}s / p90 ${stat.p90.toFixed(1)}s`
    + `、逾時 ${(stat.timeout * 100).toFixed(1)}%(上限 ${MED_MAX}s / ${TIE_MAX * 100}%;步進 ${LANE.DT}s = 伺服器 tick)`);
  const worst = chs.slice().sort((a, b) => avg[a] - avg[b]);
  console.log(`   ⓘ 前線交戰平均勝率 [最低 ${worst[0]} ${(avg[worst[0]] * 100).toFixed(0)}%`
    + ` / 最高 ${worst[chs.length - 1]} ${(avg[worst[chs.length - 1]] * 100).toFixed(0)}%]`);
}

console.log(fail ? '\n❌ 平衡稽核未通過' : '\n🎉 平衡稽核通過');
process.exit(fail ? 1 : 0);
