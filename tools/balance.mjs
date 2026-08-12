// ============ 平衡稽核(離線,純 Node,無依賴):`npm run bal` ============
// CLAUDE.md 的不變式,改平衡數值後 MUST 重跑(③ 已退場,編號不重排):
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
// ③ **已退場**(2026-08-11 使用者定案「移除此標準」):舊的「10 分鐘升滿」把八軌總價釘死在
//    賞金收入上。八軌自本日起是**雙閘**(金錢 + 戰鬥分數,見 data.ECON.UPG_STEPS)——
//    升滿的時間不再只由錢決定,拿收入預算去除總價已經量不到原本要量的東西。
//    數字仍印出來當參考,但不判定、不計入 fail。**編號不重排**(④~⑦ 保留原號):
//    CLAUDE.md §5 矩陣與各工具註解逐處引用這些序號。
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
//    c 高度差中性(2026-08-12 使用者定案「**先調整同機體在不同高度勝率相近**,後續再回來調整
//      三種機體之間」⇒ 判定面換成控制變因的鏡像對局):
//        c1 同機體鏡像:同一台機體自己打自己、只有一方站高處,逐高度差量勝率與剩餘 EHP 差
//        c2 跨機體:舊的「全角色兩兩、A 站高處」平均 —— 保留為參考與防退化欄杆(理由見該段)
//    d 角色離群:非豁免角色的平均勝率 ∈ [CH_LO, CH_HI];豁免一律具名附理由(見 DUEL_EXEMPT)
//    e 射程壓制上限:接近期單方面挨打的損失 ≤ 對手初始 EHP 的 FREE_MAX
//       —— 射程差可以換到先手,但不該在對手還沒進場前就分出勝負。
//
// ⑥ 招式配置 ← 武器射程剖面(2026-07-27 使用者定案:「扇形武器優先配置拉敵人 / 快速進場退場 /
//    匿蹤暗殺等、控場或走位的大小招」)。扇形武器沒有近距平台、實用交戰帶最短,拿到站樁型套件
//    (承傷減免 / 治療 / 召喚 / 攔截)等於貼不上就一項都兌現不了。雙扇形 MUST 兩招都是貼身套件、
//    單扇形 MUST 至少一招,另驗「優先配置」的密度(扇形人均 ≥ 非扇形人均 ×2)。
import { CHARACTERS, UNITS, WEAPONS, GAME, SQUAD, ECON, ALTITUDE, altScale, chargeF, upgradePrice,
  armorMul, vsMult, heroWeapon, heroAbility, charKind, heroArmor, rangeCap, EVASION, evadable, evadeExpF, weaponDps,
  shieldSplit, dmgFalloff, waveComp, aoeClass, AOE_NAME, blastFalloff, TARGET_R,
  AREA_WEAPONS, towerPairSepM, soloBlastRmax, TOWER_SITE_N, ultDelivered, SELF_ULT,
  HIGH_SUP } from '../public/js/data.js';
import { fighter, chassisFighter, neutralArmor, duel, duelSweep, dhSweep, DUEL } from './duel.mjs';
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

// ---------- ③ 已退場(2026-08-11 使用者定案「移除此標準」;編號不重排,理由見檔頭)----------
// 現況仍印出來當**參考數字**(不判定、不計入 fail):八軌升滿現在是「錢 + 戰鬥分數」兩道閘,
// 單看錢的比值已經不是升滿速度的代理指標。
{
  const KILL_R = 0.30, ASSIST_R = 0.40, HORIZON = 600, TRAVEL = 60;   // TRAVEL:波次行軍+交戰折讓
  let t = 0, waves = 0;
  for (; t <= HORIZON - TRAVEL;) { waves++; t += waveInterval(); }   // 2026-07-30:出兵間隔固定
  const waveBounty = waveComp().reduce((s, k) => s + ECON.BOUNTY[k], 0);
  const income = ECON.START + (KILL_R + ASSIST_R * ECON.ASSIST.F) * waves * waveBounty;
  const totalCost = Object.values(ECON.UPGRADES)
    .reduce((s, u) => { for (let l = 0; l < u.max; l++) s += upgradePrice(u, l); return s; }, 0);
  console.log(`\n③ 經濟參考(已退場,不判定)— 八軌雙閘:金錢 + 戰鬥分數\n`);
  console.log(`   ⓘ ${waves} 波 × 波賞金 $${waveBounty} × 有效分成 ${(KILL_R + ASSIST_R * ECON.ASSIST.F).toFixed(2)}`
    + ` + 開局 $${ECON.START} = 10 分鐘收入 $${Math.round(income)};八軌總價 $${totalCost}`
    + `(階梯 ${ECON.UPG_STEPS.map((st) => `$${st.price}/${st.score}分`).join(' → ')},比 ${(totalCost / income * 100).toFixed(1)}%)`);
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

  // ---- c 高度差中性 ----
  // 2026-08-12 使用者定案:「**先調整同機體在不同高度勝率相近**,後續再回來調整三種機體之間」
  // ⇒ 判定面是 **c1 同機體鏡像對局**(唯一變因就是高度差),跨機體那一份降為參考(c2)。
  //
  // **為什麼換儀器**(這不是把標準改鬆,是原本那一把量不到它宣稱要量的東西):
  //   舊 c 拿「全角色兩兩對局、A 站高處」平均。那個平均被**對局本身的強弱差**主導 —— 強角色站高處
  //   照樣贏、弱角色站高處照樣輸,高度只翻得動接近平手的那幾組。實測對照:高地壓制上線前它讀 48.9%
  //   (「中性」),而同一份數值下同機體鏡像對局的較高方勝率是 **100 / 94 / 84 / 77%**(逐 s 階)——
  //   高地其實壓倒性有利,舊 c 完全沒看見。
  // **鏡像對局同時量兩個東西**:①勝率(0/1 的正負號檢定:雙方一模一樣 ⇒ 任何淨優勢都會贏下整場)
  //   ②**剩餘 EHP 差**(連續量,看得出「贏多少」)。只看勝率會在知更鳥邊緣抖動,只看 EHP 差看不出
  //   誰真的死掉 —— 兩個一起判。
  const MIRROR_TOL = 0.08, MIRROR_MG = 0.05;   // 逐 dh:勝率 50±8pp、剩餘 EHP 差 ≤ 5pp
  const hiDh = sweep.filter((x) => x > 0);
  const mir = hiDh.map((dh) => {
    const r = chs.map((c) => duel(F[c], F[c], dh));
    return { dh, s: altScale(dh), win: mean(r.map((x) => x.win)), mg: mean(r.map((x) => x.leftA - x.leftB)) };
  });
  const okM = mir.every((r) => Math.abs(r.win - 0.5) <= MIRROR_TOL && Math.abs(r.mg) <= MIRROR_MG);
  if (!okM) fail++;
  console.log(`${okM ? '✅' : '❌'} c1 高度差中性(同機體鏡像)逐高度差 較高方勝率 / 剩餘 EHP 差`
    + `(目標 50±${MIRROR_TOL * 100}pp、|EHP 差| ≤ ${MIRROR_MG * 100}pp)`);
  console.log(`   ${mir.map((r) => `${r.dh}m(s=${r.s.toFixed(2)}) ${(r.win * 100).toFixed(0)}%/${r.mg >= 0 ? '+' : ''}${(r.mg * 100).toFixed(1)}`).join('  ')}`);
  console.log(`   ⓘ 高地報酬 +${(ALT_R * 100).toFixed(0)}% 射程 / +${(ALT_D * 100).toFixed(0)}% 閃避`
    + `;代價 = 高地壓制(被擊中後 ${HIGH_SUP.DUR_S}s:命中 −${(HIGH_SUP.HIT * 100).toFixed(0)}%`
    + ` / 閃避 −${(HIGH_SUP.DODGE * 100).toFixed(0)}% / 移速 −${(HIGH_SUP.SPEED * 100).toFixed(0)}%,封頂值;`
    + `門檻階 ${(HIGH_SUP.FLOOR * 100).toFixed(0)}% —— 報酬有截距,代價就要有,見 data.js highSupF)`);

  // c2 跨機體(參考;**使用者定案「後續再回來」** ⇒ 防退化欄杆而非驗收線,同 ⑤f / ⑦c 的處理)。
  // 它現在低於 50% 是高地壓制的**設計推論**而不是實作錯誤:壓制在「正在挨打的那一方」身上續期
  // ⇒ 誰居於下風誰被壓得越久。同機體對局雙方對稱(c1 判得到),跨機體對局則會放大既有的強弱差。
  const CROSS_LO = 0.40;
  let hw = 0, hn = 0;
  for (const dh of hiDh) for (const a of chs) for (const b of chs) {
    if (a === b) continue;
    hw += duel(F[a], F[b], dh).win; hn++;
  }
  const high = hw / hn;
  const okH = high >= CROSS_LO && high <= 1 - CROSS_LO;
  if (!okH) fail++;
  console.log(`${okH ? '✅' : '❌'} c2 高度差中性(跨機體,參考)較高方 ${(high * 100).toFixed(1)}%`
    + `(目標 50±${HIGH_TOL * 100}pp;現行守門線 ${(CROSS_LO * 100).toFixed(0)}% = 防退化欄杆`
    + ` —— 使用者定案先修 c1,跨機體留待下一輪)`);

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

  // ---- f 機種底盤對稱(同輕重武器組合,只換底盤)----
  // 使用者定案(2026-08-12):「三種機體使用不同武器類型交叉對戰,**同輕重武器組合時**,三種機體
  // (機甲、變形者、無人機)平均不同高度差之間的交叉戰鬥測試,勝率要接近。」
  // b 與 f 量的不是同一件事,**兩條都要**:b 是「這個機種的角色們強不強」(武器與 mods 跟底盤綁在
  // 一起 ⇒ 弱底盤可以靠強武器補回來,現況正是如此);f 把武器控制住,只換底盤 ⇒ 勝率差只剩底盤的
  // 四個軸 —— 耐久(UNITS[kind].hp/shield)、機動(speed/fly)、飛行閃避(EVASION.AIR_BONUS)、
  // 射程上限(rangeCap ← UNITS[kind].sight)。模型縫 = duel.mjs 的 chassisFighter(三條紀律見該處)。
  //
  // **現況達不到 50±5pp,守門線是防退化欄杆而非驗收線**(同 ⑦c 的處理,MUST NOT 當成「調鬆就過了」讀):
  //   實測 robot/morph 50.0%(兩者在本模型的底盤逐位元相同 ⇒ 這一格是結構保證,動了 UNITS.morph
  //   的耐久/視野/移速就會當場紅字)、robot/drone 與 morph/drone 皆 41.6%(無人機側 58.4%)。
  //   逐軸拆解(改制前 39.9% 的那一版量的):飛行閃避 ≈ 4pp、射程上限(sight 270 vs 240 ⇒ 解析射程
  //   +12.5%)≈ 5pp,而且**兩者相乘不相加**(同時拿掉 = 14.2pp);其餘由耐久 84%(723 vs 860)吃回約 5pp。
  //   2026-08-12 的高地壓制(HIGH_SUP)買回 1.7pp —— 壓制折的正是無人機吃最重的那一份(閃避)。
  //   **買不到更多是因為 ⑤c**:壓制最有效的那一軸(命中率)同時也是讓「較高方」掉最快的那一軸,
  //   而 ⑤c 要求高地維持勝負中性 ⇒ HIT 只吃得起 0.04(逐軸實測見 data.js HIGH_SUP 檔頭)。
  // **已排除的兩條路,MUST NOT 再繞回去**:
  //   ① 調 RANGE_BUDGET.K 買不回來 —— K 0.15 → 0.40 只把 39.9% 推到 40.0%(+12.5% 射程只換到
  //      −4.6% 火力,而 dmgFalloff 的平台/衰減段都是射程的比例)。這與 RANGE_BUDGET 檔頭的結論一致。
  //   ② 壓無人機耐久要 ×0.85 才打平(見下方 ⓘ),那會當場推倒 ①(HP_F 是清波剩餘率的校準錨)。
  // ⇒ 真正的旋鈕是**機種射程上限**(`UNITS[kind].sight`)與**飛行閃避**(`EVASION.AIR_BONUS`),
  //   兩者都牽動迷霧/索敵/#INC-104 高空射擊與 ①④⑤⑦ 全部,**MUST 另案由使用者定案**。
  const CHASSIS_MAX = 0.62;                       // 防退化欄杆(現值 60.1%)
  const KINDS3 = ['robot', 'morph', 'drone'];
  const CH_F = Object.fromEntries(KINDS3.map((k) => [k, chs.map((c) => chassisFighter(c, k))]));
  // 合成角色 MUST NOT 留在名冊上:漏刪 = 之後每一個 `Object.keys(CHARACTERS)` 迴圈都多一台,
  // 而它的症狀是「平衡數字整批微動」,沒有任何錯誤訊息。
  if (Object.keys(CHARACTERS).length !== chs.length) { fail++; console.log('❌ f 合成角色外洩'); }
  const all = chs.map((_, i) => i);
  const pairWin = (x, y, idx) => mean(idx.map((i) => duelSweep(CH_F[x][i], CH_F[y][i], sweep).win));
  console.log(`\n   f 機種底盤對稱 — 同一份輕重武器組合裝上三個底盤(mods 中性、有效護甲 ${neutralArmor().toFixed(1)} 逐位元相同)`);
  for (const k of KINDS3) {
    const f = CH_F[k][0];
    console.log(`   ⓘ ${k.padEnd(6)} EHP ${f.sh0 + f.ar0}(盾 ${f.sh0}/甲 ${f.ar0}) 機動 ${f.mob.toFixed(2)}`
      + ` 飛行 ${f.flying ? '是' : '否'} 射程上限 輕 ${rangeCap(k, 'light').toFixed(0)}m / 重 ${rangeCap(k, 'heavy').toFixed(0)}m`);
  }
  let worst = null;
  for (const [x, y] of [['robot', 'morph'], ['robot', 'drone'], ['morph', 'drone']]) {
    const v = pairWin(x, y, all);
    const okC = v <= CHASSIS_MAX && v >= 1 - CHASSIS_MAX;
    if (!okC) fail++;
    if (!worst || Math.abs(v - 0.5) > Math.abs(worst.v - 0.5)) worst = { x, y, v };
    // 逐重武器類型(使用者「使用不同武器類型交叉對戰」):底盤差會不會被某一類武器放大
    const byCls = ['blast', 'line', 'fan'].map((g) => {
      const idx = all.filter((i) => aoeClass(heroWeapon(chs[i], 'heavy', 1, true)) === g);
      return idx.length ? `${AOE_NAME[g]} ${(pairWin(x, y, idx) * 100).toFixed(1)}%` : null;
    }).filter(Boolean);
    console.log(`${okC ? '✅' : '❌'} f 機種底盤  ${x.padEnd(5)} vs ${y.padEnd(5)} ${(v * 100).toFixed(1)}%`
      + `(目標 50±${KIND_TOL * 100}pp;現行守門線 ${(CHASSIS_MAX * 100).toFixed(0)}% = 防退化欄杆)`
      + `  [${byCls.join(' / ')}]`);
  }
  // ⓘ 耐久當量:把勝率差換成一個可以談的數字 —— 落後那一側要把對手的底盤耐久乘上多少才打平。
  //    ×1 = 已經平衡;越小代表對方底盤越吃香(現值 0.80 = 無人機底盤多了約兩成耐久當量)。
  if (Math.abs(worst.v - 0.5) > 0.01) {
    let lo = 0.5, hi = 1.5;
    for (let it = 0; it < 6; it++) {
      const f = (lo + hi) / 2;
      const w = mean(all.map((i) => {
        const t = CH_F[worst.y][i];
        return duelSweep(CH_F[worst.x][i], { ...t, sh0: t.sh0 * f, ar0: t.ar0 * f }, sweep).win;
      }));
      if (w > 0.5) lo = f; else hi = f;          // f 越大 ⇒ y 越硬 ⇒ x 勝率越低
    }
    console.log(`   ⓘ f 耐久當量  ${worst.y} 底盤耐久 ×${((lo + hi) / 2).toFixed(2)} 才與 ${worst.x} 打平`
      + `(×1 = 已平衡;這是「差多少」的可談數字,不是建議值 —— HP_F 是 ① 的校準錨)`);
  }
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

  // ---- f 長按 = 大招(2026-08-06 使用者定案:一般模式 → 小招 / 狙擊模式 → 大招)----
  // 機種絕招整組退場之後,「三招同預算 ⇒ 實得也該等值」這條**沒有東西可量了**(那三招不存在)。
  // 長按自此分成兩組,而兩組的**量測面刻意不同**(硬塞進同一個平均就是舊制失效的原因:
  // 效果型 payload 的 EHP 恆為 0,混進去會被讀成「這一招不會交付」,而它其實每一發都到了):
  //   f1 **載具組**(23 台)—— 量「送出去的份額有幾份真的飛到」。這個量對每一種 payload
  //      都成立,而且正是三種載具形式唯一分得出高下的地方(kami 魚貫 / 轟炸機逐批 / 飛彈全有或全無)。
  //   f2 **自身型組**(9 台)—— 量補償兌現的 EHP 當量(多打出的 + 少挨的 + 補回來的)。
  const KINDS = ['drone', 'robot', 'morph'];
  const FORM_NAME = { drone: '自殺機群', robot: '極音速飛彈', morph: '集束轟炸機' };
  const SPREAD_MAX = 1.8;

  // —— f1 載具交付率 ——
  const conv = Object.fromEntries(KINDS.map((k) => {
    const v = of(k).filter((c) => ultDelivered(c)).map((c) => abil[c]);
    const n = v.reduce((s, x) => s + x.carN, 0), hit = v.reduce((s, x) => s + x.carHit, 0);
    return [k, { n, hit, rate: n ? hit / n : 0 }];
  }));
  const cLo = Math.min(...KINDS.map((k) => conv[k].rate)), cHi = Math.max(...KINDS.map((k) => conv[k].rate));
  const okF1 = cLo > 0 && cHi / cLo <= SPREAD_MAX;
  if (!okF1) fail++;
  for (const k of KINDS) {
    console.log(`   ⓘ f 載具交付  ${FORM_NAME[k].padEnd(6)}(${k})${(conv[k].rate * 100).toFixed(1)}%`
      + `(${conv[k].n} 份送出 / ${conv[k].hit} 份抵達)`);
  }
  console.log(`${okF1 ? '✅' : '❌'} f 載具交付  三種形式交付率 ${(cHi / cLo).toFixed(2)}×`
    + `(同 CD ⇒ 交付同量級 MUST ≤ ${SPREAD_MAX}×,且 MUST 全數 > 0)`
    + `;生存性 = ${TOWER_SITE_N} 座塔的前線基準(飛彈另計一波兵)`);
  // 帶**傷害** payload 的載具實得(舊 ⑦f 的直接類比):點遞送不追擊 ⇒ 移動中的機體幾乎吃不到。
  // 這一行**刻意只印不擋**:它量的是「使用者定案的點遞送對移動目標有多難命中」,那是設計取捨,
  // 不是退化;要不要收緊是 KAMI.N / 追不追蹤那一層的決定(見交付說明)。
  {
    const v = chs.filter((c) => ultDelivered(c) && CHARACTERS[c].ult.fx === 'strike').map((c) => abil[c]);
    const n = v.reduce((s, x) => s + x.n, 0);
    const eff2 = v.reduce((s, x) => s + x.hero + x.tower, 0), cr = v.reduce((s, x) => s + x.creep, 0);
    const nom = v.reduce((s, x) => s + x.carNom, 0);
    console.log(`   ⓘ f 載具實得  strike payload 對機體+砲塔 ${n ? (eff2 / n).toFixed(1) : 0} EHP/次`
      + `(名目 ${n ? (nom / n).toFixed(0) : 0};清兵另 ${n ? (cr / n).toFixed(0) : 0} EHP/次不計)`);
  }

  // —— f2 自身型補償兌現 ——
  // **本模型看不到的價值逐項列在 lanesim 的長按章節檔頭**(匿蹤不可鎖定 / 無霧視野 / 定位 /
  // 大跳躍 / 原地復活 / 解除異常)⇒ 那幾台的數字是**下界**,不是它們真正的強度。
  // 故這一條只擋「完全沒有作用」(> 0),**不設離群比** —— 對量不到的東西設離群比就是假精確。
  const selfChs = chs.filter((c) => !ultDelivered(c));
  const perCast = (c) => {
    const a = abil[c];
    return a.ultN ? (a.dealtEff + a.prevented + a.healed) / a.ultN : 0;
  };
  const okF2 = selfChs.every((c) => perCast(c) > 0);
  if (!okF2) fail++;
  console.log(`   ⓘ f 自身型補償  ${selfChs.map((c) => `${c} ${perCast(c).toFixed(0)}`).join(' / ')} EHP/次`);
  // 輔助機損失率(2026-08-07 起自身型也是載具制):**印出來不擋** —— 這一欄量的是「改制的代價
  // 在模型裡有沒有現形」。恆為 0 = 輔助機根本沒被打過(那 ⑦f 的自身型欄就仍是舊制的瞬發值);
  // 太高則是耐久校準過脆。本模型的選敵是**最近優先**,而輔助機貼著主機 ⇒ 多數時候火力仍落在
  // 主機身上,故這個比例是實戰的**下界**(真人會刻意點掉補給機)。
  {
    const sN = selfChs.reduce((s, c) => s + abil[c].carN, 0);
    const sL = selfChs.reduce((s, c) => s + abil[c].supLost, 0);
    console.log(`   ⓘ f 輔助機損失  ${sN} 架派出 / ${sL} 架被擊落(${sN ? (100 * sL / sN).toFixed(1) : 0}%`
      + `;選敵最近優先 ⇒ 這是下界)—— 耐久見 data.js ULT_SUPPORT`);
  }
  console.log(`${okF2 ? '✅' : '❌'} f 自身型補償  ${selfChs.length} 台的長按 MUST 全數 > 0`
    + `(視野/匿蹤/復活等本模型不計價 ⇒ 這些是下界;係數見 data.js SELF_ULT.REALIZED_F = ${SELF_ULT.REALIZED_F})`);

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
