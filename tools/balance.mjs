// ============ 平衡稽核(離線,純 Node,無依賴):`npm run bal` ============
// 兩條 CLAUDE.md 的不變式,改平衡數值後 MUST 重跑:
//
// ① 一波 NPC = 玩家 60% EHP
//    一波 = 同線同側 WAVE_SOLDIERS 步槍兵 + 火箭兵 + 榴彈兵 + 攻擊直升機。
//    情境:玩家單挑整波、雙方全在有效射程內(近距平台,無距離衰減)持續開火、
//    玩家只有 Lv1 輕武器 + 重武器照 CD、無升級/招式/掩體 ⇒ 清完波後應剩 ~40% EHP。
//    (無人機三機隊靠 _echo 齊射同一目標,EHP/DPS 皆 = 單機 × SQUAD.N)
//
// ② 最前線敵我砲塔:射程重疊 TOWER_OVERLAP(0.8)且互不在對方射程內(d = 1.2R > R)。
//    對全部預設場地 × 1/2/3 線實際起一份 BattleSim,量最近的一對敵我塔。
import { CHARACTERS, UNITS, WEAPONS, GAME, SQUAD, armorMul, vsMult, heroWeapon, charKind } from '../public/js/data.js';
import { VENUES, venueConfig } from '../public/js/venues.js';
import { BattleSim } from '../server/sim.js';

const TARGET_LEFT = 0.40;          // 戰後應剩餘的 EHP 比例
const WAVE = [...Array(GAME.WAVE_SOLDIERS).fill('soldier'), 'rocketeer', 'howitzer', 'heli'];

/** 角色某槽位對某目標的持續 DPS(含換彈 / CD;重武器 = mag 1 + reload = cd) */
const slotDps = (ch, slot, tk) => {
  const w = heroWeapon(ch, slot, 1, true);
  if (!w) return 0;
  const cycle = w.mag / (w.rate || 3) + w.reload;
  return w.dmg * vsMult(w, tk) * armorMul(UNITS[tk].armor, w.pen) * w.mag / cycle;
};
const heroDps = (ch, tk) => {
  const d = slotDps(ch, 'light', tk) + slotDps(ch, 'heavy', tk);
  return charKind(ch) === 'drone' ? d * SQUAD.N : d;   // _echo:三機齊射同一目標
};

/** 單挑一波:0.05s 步進,玩家先集火「對自己最痛的」;回傳戰後剩餘 EHP 比例(可為負) */
function fightWave(ch) {
  const kind = charKind(ch), u = UNITS[kind], m = CHARACTERS[ch].mods;
  const n = kind === 'drone' ? SQUAD.N : 1;
  const armor = m.armor ?? 0;
  let ar = Math.round(u.hp * (m.hp ?? 1)) * n;
  let sh = Math.round(u.shield * (m.sp ?? 1)) * n;
  const ehp0 = ar + sh;
  const foes = WAVE.map((k) => ({
    hp: UNITS[k].hp, dps: heroDps(ch, k),
    dmg: UNITS[k].dmg * UNITS[k].rate, pen: WEAPONS[UNITS[k].wid]?.pen || 0,
  })).sort((a, b) => b.dmg * armorMul(armor, b.pen) - a.dmg * armorMul(armor, a.pen));
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

console.log(fail ? '\n❌ 平衡稽核未通過' : '\n🎉 平衡稽核通過');
process.exit(fail ? 1 : 0);
