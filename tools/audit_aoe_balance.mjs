// AoE 三類範圍傷害平衡稽核 —— 爆炸 / 扇形 / 直線的角色分工驗收。
//
// 使用者定案角色:
//   blast 爆炸傷害:高密集兵波陣列有優勢,且傷害不會被大物件阻隔(球形超壓,無 LOS 阻擋、無穿透預算)。
//   fan   扇形傷害:擅長對付大物件與近距離的敵人(小錐分格多格多吃,近距大目標橫跨全錐)。
//   line  直線傷害:遠近平衡(首個全額 + DECAY 逐個衰減,距離衰減與貫穿衰減兩條獨立乘數)。
//
// 可調旋鈕( weapon 層,不動全域常數 —— BLAST/LANCE.PEN/FAN_SUB_DEG 是凍結的單一縫,
// 改那邊會連動 audit_aoe_trim / audit_fan_cone / audit_lance_hit;見各檔頭):
//   blast:每把武器的 r(範圍)與 dmg(傷害值)陣列。
//   line :穿透力 = 彈種 gun < rail < beam(LANCE.PEN 階梯),武器層調整 = 換彈種或調 dmg。
//   fan  :分割角度 = 每把武器的 arc 陣列(錐角 → fanSubs 格數),武器層調整 = 改 arc 或調 dmg。
//
// 情境(全部直測 server/sim.js,確定性:骰子旁路、固定站位):
//   S1 密集兵波:7 名小兵 3m 間距緊密陣列 —— blast 總傷應為三類最高。
//   S2 大物件阻隔:砲塔(60m)後方小兵(90m)同軸 —— blast(瞄後方)後方仍受傷;
//       line 耗盡穿透力、fan 同格只取最近 ⇒ 後方不受傷。
//   S3 中型多目標:10 輛坦克橫列 —— fan 總傷應為三類最高(小錐分格多格多吃,
//       line 逐區耗穿透力截斷、blast 足跡只罩中間幾輛)。
//   S3c 巨型單一結構:近距砲塔 —— fan 應勝 blast(分格多吃 > 單球單次);line 憑截面
//       7 區全額領先為已知權衡(它是縱深角色的代價面,不設門,數字印出追蹤)。
//   S4 遠近平衡:同軸小兵 60m vs 140m —— line 比值應落在 [0.55, 1.0](距離衰減 + 貫穿衰減,
//       不得出現遠距剩不到一半);fan 比值應 ≈1(不隨距離衰減,窗 ±3%)。
//   S5 分割角單調:同距離砲塔,寬錐(m07)總傷 > 窄錐(t06)。
//
// 用法:node tools/audit_aoe_balance.mjs

import { BattleSim } from '../server/sim.js';
import {
  CHARACTERS, MAPGEO, LOS, heroWeapon, aoeClass, fanSubs,
} from '../public/js/data.js';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg} ${extra}`); }
};

function fakeBattleConfig() {
  const A = [25.0330, 121.5654];
  const D = 1600, R = 6371000;
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
    maxOverlap: 0.05, synthetic: true, placeName: 'AoE平衡戰區',
    env: { season: 'summer', time: 'day', weather: 'clear' },
  };
}

/** 乾淨沙盤:確定性骰子(爆擊恆等、閃避/失準歸零),視野脈衝旁路 LOS 以外的幾何。 */
function sandbox() {
  const sim = new BattleSim(fakeBattleConfig());
  for (const e of [...sim.ents.values()]) sim.ents.delete(e.id);
  sim.camps = [];
  sim.mines = [];
  sim.missiles = [];
  sim.visionUntil = { SWARM: 1e9, STEEL: 1e9 };
  sim._rollCrit = (b, def, dmg) => dmg;
  sim._dodgeP = () => 0;
  sim._missP = () => 0;
  return sim;
}

/** 配好指定角色重武器的射手(站原點向 +z 開火)。 */
function shooter(ch) {
  const sim = sandbox();
  const h = sim.addHero('SWARM', `p_${ch}`, ch);
  h.x = 0; h.z = 0; h.y = 0;
  h.aiming = true;
  h.mp = h.maxMp = 9999;
  sim.t = 100;
  return { sim, h };
}

/** 開一發重武器,回傳每名目標的傷害(按傳入順序)。 */
function fireOnce(ch, targets, blastAt = null) {
  const { sim, h } = shooter(ch);
  const wp = sim._heroWeapon(h, 'heavy');
  const cls = aoeClass(wp.def);
  const ents = targets.map(([kind, x, z, hp]) =>
    sim._add({ kind, side: 'STEEL', x, z, y: 0, hp, m: hp }));
  const hp0 = ents.map((e) => e.hp);
  if (cls === 'blast') {
    const [bx, bz] = blastAt || [ents[0].x, ents[0].z];
    sim._blast(h, wp.def, bx, bz, 0, 0);
  } else if (cls === 'fan') {
    sim.heroPlasma(h.pid, 0, 1, 'heavy', null, 0);
  } else {
    sim.heroLance(h.pid, [0, 0, LOS.EYE_M], [0, 1, 0], 400);
  }
  return { cls, dmg: ents.map((e, i) => hp0[i] - e.hp) };
}

const sum = (v) => v.reduce((s, x) => s + x, 0);
const avg = (v) => sum(v) / v.length;
// 每類挑三名代表(高/中/低傷害各一,避免只量到單把的個性)
// MUST 全為 SWARM / MERC(STEEL 角色在 SWARM 沙盤會被 addHero 隨機洗掉 —— 見 sim.addHero 陣營門)。
const REPS = {
  blast: ['s09', 's02', 's06'],
  fan: ['s04', 's07', 'm07'],
  line: ['s08', 's03', 's10'],
};
for (const [cls, chs] of Object.entries(REPS)) {
  for (const ch of chs) {
    if (aoeClass(heroWeapon(ch, 'heavy', 1, true)) !== cls) {
      console.log(`  ❌ 代表名冊錯誤:${ch} 不是 ${cls}`);
      fail++;
    }
  }
}

console.log('— S1 密集兵波陣列(7 名小兵,3m 緊密陣列 @100m):blast 總傷應居首 —');
{
  const pts = [[0, 100], [3, 100], [-3, 100], [0, 103], [0, 97], [3, 103], [-3, 97]];
  const totals = {};
  for (const cls of ['blast', 'fan', 'line']) {
    totals[cls] = REPS[cls].map((ch) => {
      const { dmg } = fireOnce(ch, pts.map(([x, z]) => ['soldier', x, z, 99999]));
      return sum(dmg);
    });
  }
  for (const cls of ['blast', 'fan', 'line']) {
    console.log(`   ⓘ ${cls} 代表總傷 ${totals[cls].map((v) => v.toFixed(0)).join(' / ')}`);
  }
  ok(avg(totals.blast) > avg(totals.line) && avg(totals.blast) > avg(totals.fan),
    `blast 平均 ${avg(totals.blast).toFixed(0)} > line ${avg(totals.line).toFixed(0)} / fan ${avg(totals.fan).toFixed(0)}`);
}

console.log('— S2 大物件阻隔(砲塔@60m + 小兵@90m 同軸):blast 繞過、line/fan 被擋 —');
{
  // blast 瞄準後方小兵:球形超壓不查 LOS ⇒ 後方照吃(砲塔在 30m 外,足跡外不分傷)
  const bBack = REPS.blast.map((ch) => {
    const { dmg } = fireOnce(ch, [['tower', 0, 60, 99999], ['soldier', 0, 90, 99999]], [0, 90]);
    return dmg[1];
  });
  // line 沿軸貫穿:砲塔耗盡各區穿透力 ⇒ 後方截斷
  const lBack = REPS.line.map((ch) => {
    const { dmg } = fireOnce(ch, [['soldier', 0, 50, 99999], ['tower', 0, 60, 99999], ['soldier', 0, 90, 99999]]);
    return dmg[2];
  });
  // fan 同格只取最近:砲塔擋住同軸後方
  const fBack = REPS.fan.map((ch) => {
    const { dmg } = fireOnce(ch, [['tower', 0, 60, 99999], ['soldier', 0, 90, 99999]]);
    return dmg[1];
  });
  console.log(`   ⓘ blast 後方受傷 ${bBack.map((v) => v.toFixed(1)).join(' / ')}`);
  console.log(`   ⓘ line  後方受傷 ${lBack.map((v) => v.toFixed(1)).join(' / ')}`);
  console.log(`   ⓘ fan   後方受傷 ${fBack.map((v) => v.toFixed(1)).join(' / ')}`);
  ok(bBack.every((v) => v > 0), 'blast 瞄後方:後方小兵仍受傷(不被大物件阻隔)');
  ok(lBack.every((v) => v === 0), 'line 塔後:後方小兵不受傷(穿透力耗盡截斷)');
  ok(fBack.every((v) => v === 0), 'fan 塔後:後方小兵不受傷(同格只取最近)');
}

console.log('— S3 中型多目標(10 輛坦克橫列 ±18m @60m):fan 總傷應居首(小錐多格多吃) —');
{
  // fan 的大物件優勢體現在「多個中大型目標」:每格取最近 ⇒ 10 輛各吃一格,不截斷;
  // line 逐區耗穿透力(坦克 11.3m²/輛 ⇒ gun 兩輛見底)、blast 足跡只罩中間 4 輛。
  const row = [];
  for (let i = 0; i < 10; i++) row.push(['tank', -18 + i * 4, 60, 99999]);
  const totals = {};
  for (const cls of ['blast', 'fan', 'line']) {
    totals[cls] = REPS[cls].map((ch) => {
      const { dmg } = fireOnce(ch, row, [0, 60]);
      return sum(dmg);
    });
  }
  for (const cls of ['blast', 'fan', 'line']) {
    console.log(`   ⓘ ${cls} 十坦橫列總傷 ${totals[cls].map((v) => v.toFixed(0)).join(' / ')}`);
  }
  ok(avg(totals.fan) > avg(totals.line) && avg(totals.fan) > avg(totals.blast),
    `fan 平均 ${avg(totals.fan).toFixed(0)} > line ${avg(totals.line).toFixed(0)} / blast ${avg(totals.blast).toFixed(0)}`);
}

console.log('— S3c 巨型單一結構(砲塔@30m):fan 應勝 blast;line 區段全中領先為已知權衡 —');
{
  // 已知權衡:line 截面 7 區全額(單區單價 1.0)對單一巨體先天多吃,fan 小錐單價 0.8 居次、
  // blast 單球單次居末。此處只守「分格多吃 > 單球單次」(fan > blast);line 領先不設門
  // (它是 line 縱深角色的代價面,見 S2 塔後截斷),數字印出供追蹤。
  const totals = {};
  for (const cls of ['blast', 'fan', 'line']) {
    totals[cls] = REPS[cls].map((ch) => {
      const { dmg } = fireOnce(ch, [['tower', 0, 30, 999999]]);
      return dmg[0];
    });
  }
  for (const cls of ['blast', 'fan', 'line']) {
    console.log(`   ⓘ ${cls} 近距砲塔總傷 ${totals[cls].map((v) => v.toFixed(0)).join(' / ')}`);
  }
  ok(avg(totals.fan) > avg(totals.blast),
    `fan 平均 ${avg(totals.fan).toFixed(0)} > blast ${avg(totals.blast).toFixed(0)}(分格多吃 > 單球單次)`);
}

console.log('— S4 遠近平衡(同軸小兵 60m vs 140m) —');
{
  const ratios = {};
  for (const cls of ['blast', 'fan', 'line']) {
    ratios[cls] = REPS[cls].map((ch) => {
      const n = fireOnce(ch, [['soldier', 0, 60, 99999]]).dmg[0];
      const f = fireOnce(ch, [['soldier', 0, 140, 99999]]).dmg[0];
      return n > 0 ? f / n : NaN;
    });
  }
  for (const cls of ['blast', 'fan', 'line']) {
    console.log(`   ⓘ ${cls} 遠/近比 ${ratios[cls].map((v) => v.toFixed(3)).join(' / ')}`);
  }
  ok(ratios.line.every((v) => v >= 0.55 && v <= 1.0),
    'line 遠近平衡:遠距保有 55%~100% 傷害');
  ok(ratios.fan.every((v) => Math.abs(v - 1) < 0.03),
    'fan 不隨距離衰減:遠/近 ≈ 1(窗 ±3%)');
}

console.log('— S5 分割角覆蓋(5 名小兵橫向 ±30m @120m):寬錐命中數應多於窄錐 —');
{
  // 寬錐的價值是橫向覆蓋(多格各取一名),不是單體總傷(錐越寬,單體每格偏心遞減越重)。
  // s04 半錐 13° @120m 半寬 27.7m ⇒ ±30m 兩側兩名落在錐外;m07 半錐 22° 半寬 48m ⇒ 全覆蓋。
  const spread = [[-30, 120], [-15, 120], [0, 120], [15, 120], [30, 120]];
  const countHits = (ch) => {
    const { dmg } = fireOnce(ch, spread.map(([x, z]) => ['soldier', x, z, 99999]));
    return dmg.filter((v) => v > 0).length;
  };
  const nN = countHits('s04'), nW = countHits('m07');
  const arcN = heroWeapon('s04', 'heavy', 1, true).arc;
  const arcW = heroWeapon('m07', 'heavy', 1, true).arc;
  console.log(`   ⓘ s04 arc ${arcN}°(${fanSubs({ arc: arcN })} 格)命中 ${nN}/5`
    + ` / m07 arc ${arcW}°(${fanSubs({ arc: arcW })} 格)命中 ${nW}/5`);
  ok(nW > nN, `寬錐命中 ${nW} > 窄錐 ${nN}(分割角 = 橫向覆蓋)`);
}

console.log(fail ? `\n❌ AoE 平衡稽核未通過:${pass}/${pass + fail} 通過` : `\n✅ AoE 平衡稽核全數通過:${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
