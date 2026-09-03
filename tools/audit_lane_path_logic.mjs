// ============ 兵線路徑平衡離線稽核 ============
// 驗證 VENUE_LANES 所有 L2/L3 條目符合以下結構規則(2026-09-02 使用者需求):
//   兵線=2:① 左右兩條長度誤差 ≤ 10%
//           ② 兩條路線重合度 ≤ 5%
//   兵線=3:① 左右兩條長度誤差 ≤ 10%
//           ② 外側長度 ≤ 中間長度 × 1.50(外側比中間長不超過 50%)
//           ③ 三條路線兩兩重合度 ≤ 5%
//
// 判定縫:data.js `lanePathBalanceAudit()`(bake 後稽核共用同一支)。
// 含反向驗證(--break-len / --break-outer / --break-overlap):
//   把對應門檻收緊到 0,確認稽核在對照組上紅字攔截。
//
// 用法:node tools/audit_lane_path_logic.mjs
//      node tools/audit_lane_path_logic.mjs --break-len
//      node tools/audit_lane_path_logic.mjs --break-outer
//      node tools/audit_lane_path_logic.mjs --break-overlap
// 退出碼:0 = 全通過;1 = 有違規

import { MAPGEO, lanePathBalanceAudit } from '../public/js/data.js';
import { VENUE_LANES } from '../public/js/venueLanes.js';

const ARGS = new Set(process.argv.slice(2));
const BREAK_LEN = ARGS.has('--break-len');
const BREAK_OUTER = ARGS.has('--break-outer');
const BREAK_OVERLAP = ARGS.has('--break-overlap');
const BREAK_ANY = BREAK_LEN || BREAK_OUTER || BREAK_OVERLAP;

// ---- 座標換算(同 audit_lane_sep.mjs)----
// llToGame: 大地座標 [lat,lng] → 遊戲公尺 [x,z](以 bases[0] 為原點)
const EARTH = 6371000, SC = 1 / MAPGEO.REAL_SCALE;
const llToGame = (lat, lng, o) => [
  (lng - o[1]) * Math.PI / 180 * EARTH * Math.cos(o[0] * Math.PI / 180) * SC,
  (lat - o[0]) * Math.PI / 180 * EARTH * SC,
];

// ---- 反向驗證:臨時覆蓋門檻後呼叫 lanePathBalanceAudit ----
// 修改 MAPGEO 常數後呼叫,驗證後需復原(避免污染後續測試)。
function auditWithOverride(lanes, L, overrides) {
  const saved = {};
  for (const [k, v] of Object.entries(overrides)) { saved[k] = MAPGEO[k]; MAPGEO[k] = v; }
  const r = lanePathBalanceAudit(lanes, L);
  for (const [k, v] of Object.entries(saved)) MAPGEO[k] = v;
  return r;
}

// ============ 主掃描 ============
let fails = 0, multi = 0;
const rows = [];

for (const [venue, byL] of Object.entries(VENUE_LANES)) {
  for (const [Lkey, entry] of Object.entries(byL)) {
    const L = parseInt(Lkey);
    if (isNaN(L) || L < 2 || !entry?.lanes || entry.lanes.length < 2) continue;
    multi++;
    const o = entry.bases[0];
    const game = entry.lanes.map((line) => line.map(([lat, lng]) => llToGame(lat, lng, o)));

    let result;
    if (BREAK_LEN) {
      // 反向驗證:把長度誤差門檻收緊到 0 ⇒ 幾乎所有場地都應紅字
      result = auditWithOverride(game, L, { LANE_BALANCE_LEN_TOL: 0 });
    } else if (BREAK_OUTER) {
      // 反向驗證:把外側/中間比門檻收緊到 1.0 ⇒ L3 幾乎全違規(外側鮮少比中間短)
      result = auditWithOverride(game, L, { LANE_BALANCE_OUTER_MAX: L === 3 ? 1.0 : 1.50 });
    } else if (BREAK_OVERLAP) {
      // 反向驗證:把重合度門檻收緊到 0 ⇒ 幾乎所有場地都應紅字(兩條線必然共用主堡格)
      result = auditWithOverride(game, L, { LANE_BALANCE_OV_MAX: 0 });
    } else {
      result = lanePathBalanceAudit(game, L);
    }

    if (!result.ok) fails++;
    rows.push({ venue, L, ...result });
  }
}

// ---- 印出結果表格 ----
const LEN_TOL = MAPGEO.LANE_BALANCE_LEN_TOL;
const OV_MAX = MAPGEO.LANE_BALANCE_OV_MAX;
const OUT_MAX = MAPGEO.LANE_BALANCE_OUTER_MAX;

const title = BREAK_LEN ? '【反向驗證:長度誤差門檻=0】' :
              BREAK_OUTER ? '【反向驗證:外側/中間比門檻=1.0(L3)】' :
              BREAK_OVERLAP ? '【反向驗證:重合度門檻=0】' : '';

console.log(`\n兵線路徑平衡稽核 ${title}`);
console.log(`規則:L2 ① 左右誤差≤${(LEN_TOL*100).toFixed(0)}% ② 重合≤${(OV_MAX*100).toFixed(0)}%`);
console.log(`     L3 ① 左右誤差≤${(LEN_TOL*100).toFixed(0)}% ② 外側≤中間×${OUT_MAX.toFixed(2)} ③ 重合≤${(OV_MAX*100).toFixed(0)}%\n`);

const H_VENUE = 13, H_L = 3, H_ERR = 10, H_RATIO = 9, H_OV = 10;
console.log(
  '場地'.padEnd(H_VENUE) +
  'L'.padStart(H_L) +
  '左右誤差'.padStart(H_ERR) +
  '外側/中'.padStart(H_RATIO) +
  '最大重合'.padStart(H_OV) +
  '  結果',
);
console.log('-'.repeat(H_VENUE + H_L + H_ERR + H_RATIO + H_OV + 8));

for (const r of rows) {
  const err = `${(r.lenErr * 100).toFixed(1)}%`;
  const ratio = r.outerRatio !== null ? `${r.outerRatio.toFixed(2)}x` : '-';
  const ov = `${(r.maxOverlap * 100).toFixed(1)}%`;
  const mark = r.ok ? 'OK' : `NG: ${r.violations.join(' / ')}`;
  console.log(
    r.venue.padEnd(H_VENUE) +
    String(r.L).padStart(H_L) +
    err.padStart(H_ERR) +
    ratio.padStart(H_RATIO) +
    ov.padStart(H_OV) +
    `  ${mark}`,
  );
}

console.log('-'.repeat(H_VENUE + H_L + H_ERR + H_RATIO + H_OV + 8));
console.log(`\n掃描 ${multi} 個 venue*L;違規 ${fails}(MUST 0)\n`);

// ============ 內建單元測試(非反向驗證模式才跑)============
if (!BREAK_ANY) {
  let tPass = 0, tFail = 0;
  const ok = (name, cond) => { if (cond) tPass++; else { tFail++; console.log(`  X FAIL: ${name}`); } };
  const section = (t) => console.log('\n' + t);

  // ---- 準備最小測試用折線 ----
  const mkLane = (x0, z0, x1, z1) => [[x0, z0], [(x0+x1)/2, (z0+z1)/2], [x1, z1]];
  const laneA    = mkLane(0, -50, 1000, -50);
  const laneB    = mkLane(0,  50, 1000,  50);
  const laneShort = mkLane(0, -50, 800, -50);  // 800 vs 1000 → 誤差 20%
  const laneDup  = mkLane(0, -50, 1000, -50);

  const mkL3 = (outerLen, midLen) => [
    mkLane(0, -80, outerLen, -80),
    mkLane(0,   0, midLen,    0),
    mkLane(0,  80, outerLen,  80),
  ];

  section('正向:L2 等長平行線(應全通過)');
  ok('lenErr~0', lanePathBalanceAudit([laneA, laneB], 2).lenErr < 0.01);
  ok('maxOverlap~0', lanePathBalanceAudit([laneA, laneB], 2).maxOverlap < 0.01);
  ok('ok=true', lanePathBalanceAudit([laneA, laneB], 2).ok);

  section('規則①:左右長度誤差 > 10% 判違規');
  const r20 = lanePathBalanceAudit([laneShort, laneB], 2);
  ok('誤差20% => ok=false', !r20.ok);
  ok('lenErr~0.20', Math.abs(r20.lenErr - 0.20) < 0.01);
  const laneNear = mkLane(0, -50, 905, -50);  // 905 vs 1000 → 9.5%
  const rNear = lanePathBalanceAudit([laneNear, laneB], 2);
  ok('誤差9.5% 無長度違規', !rNear.violations.some(v => v.includes('誤差')));

  section('規則③:重合度 > 5% 判違規');
  const rDup = lanePathBalanceAudit([laneA, laneDup], 2);
  ok('完全重疊 => ok=false', !rDup.ok);
  ok('maxOverlap~1', rDup.maxOverlap > 0.95);

  section('L3 規則②:外側/中間比');
  const r3ok  = lanePathBalanceAudit(mkL3(1400, 1000), 3);
  const r3bad = lanePathBalanceAudit(mkL3(1600, 1000), 3);
  ok('外側1.40x 無外側違規', !r3ok.violations.some(v => v.includes('外側')));
  ok('外側1.60x 有外側違規', r3bad.violations.some(v => v.includes('外側')));
  ok('outerRatio~1.40', r3ok.outerRatio !== null && Math.abs(r3ok.outerRatio - 1.40) < 0.02);
  ok('outerRatio~1.60', r3bad.outerRatio !== null && Math.abs(r3bad.outerRatio - 1.60) < 0.02);

  section('邊界值:恰好在門檻上不超標');
  const laneEx = mkLane(0, -50, 900, -50);  // 900 vs 1000 → 10%
  ok('誤差=10% 不超標', !lanePathBalanceAudit([laneEx, laneB], 2).violations.some(v => v.includes('誤差')));
  ok('外側=1.50x 不超標', !lanePathBalanceAudit(mkL3(1500, 1000), 3).violations.some(v => v.includes('外側')));

  section('反向驗證:門檻收緊確認紅字攔截');
  const rBL   = auditWithOverride([laneShort, laneB], 2, { LANE_BALANCE_LEN_TOL: 0 });
  ok('門檻=0 時誤差20%違規', !rBL.ok);
  const rBO   = auditWithOverride([laneA, laneDup], 2, { LANE_BALANCE_OV_MAX: 0 });
  ok('重合門檻=0 時重疊違規', !rBO.ok);
  const rBOut = auditWithOverride(mkL3(1100, 1000), 3, { LANE_BALANCE_OUTER_MAX: 1.0 });
  ok('外側比門檻=1.0 時1.10x違規', !rBOut.ok);
  // 確認舊門檻復原:等長線在正常門檻下仍 ok
  ok('門檻復原:等長線 ok', lanePathBalanceAudit([laneA, laneB], 2).ok);

  console.log(`\n${tFail ? 'FAIL' : 'PASS'} 單元測試:${tPass} 通過,${tFail} 失敗`);
  if (tFail) fails = Math.max(fails, 1);
}

process.exit(fails ? 1 : 0);