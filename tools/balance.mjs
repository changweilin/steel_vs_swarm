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
//    機甲/變形機甲(單機)= 近戰互轟模型(前段雙塔回擊、殺一座後單塔;無距離衰減/
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
  armorMul, vsMult, heroWeapon, heroAbility, charKind, heroArmor, EVASION,
  grenadeBuildingMul, dmgFalloff } from '../public/js/data.js';
import { fighter, duel, duelSweep, dhSweep, DUEL } from './duel.mjs';

const ALT_R = ALTITUDE.RANGE, ALT_D = ALTITUDE.DODGE;   // ⑤c 說明用(封頂加成)

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

  // a 陣營對稱
  const side = mean(of('drone').flatMap((a) => of('robot').map((b) => rate[a][b])));
  const okS = Math.abs(side - 0.5) <= SIDE_TOL;
  if (!okS) fail++;
  console.log(`${okS ? '✅' : '❌'} 陣營對稱  SWARM vs STEEL ${(side * 100).toFixed(1)}%`
    + `(目標 50±${SIDE_TOL * 100}pp;${of('drone').length * of('robot').length} 組對局)`);

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

console.log(fail ? '\n❌ 平衡稽核未通過' : '\n🎉 平衡稽核通過');
process.exit(fail ? 1 : 0);
