// ============ Default map rule audit: tower and base range overlap (rule 4) ============
// Requirement (decided 2026-07-19, per lane):
//   Front-line enemy towers keep 80 percent overlap (contesting midline, inherent);
//   Rear tower to own base and to same-lane front tower overlap at most 80 percent (distance at least SEP); no two tower spots may physically stack (at least STACK).
//   Adjacent lanes (lane delta 1) same-side tower pairs (front and rear both count) overlap at most 80 percent (distance at least SEP); non-adjacent lanes only guard stacking.
// Adjudication lives in towerLayoutAudit() in data.js (shared by custom map scan, server validation, and bake).
// When a short lane cannot reach 80 percent or less, solveTowerSites takes the legal spot with least overlap, and residual above 80 percent is listed as residual (cleared by enlarging the map or REAL_SCALE).
// exit 1 only on physical stacking (true defect). Usage: node tools/audit_map_rules.mjs
import { VENUE_LANES } from '../public/js/venueLanes.js';
// Which scale each key uses and which map kinds to verify: the single seam lives in venues.js (judging the string prefix here
// would be a second implementation, with the symptom of validating the mini lane with a full-battlefield tower chain and a row of false reds).
import { VENUE_LANE_KEYS, venueLaneModes } from '../public/js/venues.js';
import { UNITS, GAME, MAPGEO, towerLayoutAudit } from '../public/js/data.js';

const R = UNITS.tower.range, SEP = R * GAME.TOWER_SEP_F, OFF = GAME.TOWER_SIDE_OFF;
const STACK = 2 * OFF + 10;
const EARTH = 6371000, SC = 1 / MAPGEO.REAL_SCALE;
const llToM = (lat, lng, c) => [
  (lng - c.lng) * Math.PI / 180 * EARTH * Math.cos(c.lat * Math.PI / 180) * SC,
  (lat - c.lat) * Math.PI / 180 * EARTH * SC,
];

let stackFails = 0, residualPairs = 0, venuesResidual = 0;
const rows = [];

for (const [venue, byL] of Object.entries(VENUE_LANES)) {
  for (const { key, mapA } of VENUE_LANE_KEYS) {
    const entry = byL[key];
    if (!entry?.lanes || !entry.bases) continue;
    const A = entry.bases[0], B = entry.bases[1];
    const c = { lat: (A[0] + B[0]) / 2, lng: (A[1] + B[1]) / 2 };
    const lanes = entry.lanes.map((line) => line.map(([lat, lng]) => llToM(lat, lng, c)));
    // The scaled-down entry must serve both mini and story sides, so verify each mode and report the worst one
    // (a full battlefield is always a single mode, hence bit-identical to the old system).
    let a = null;
    for (const m of venueLaneModes(mapA)) {
      const r = towerLayoutAudit(lanes, m);
      if (!a || r.stackBad > a.stackBad || r.residual > a.residual) a = r;
    }
    if (a.stackBad) stackFails++;
    residualPairs += a.residual; if (a.residual) venuesResidual++;
    rows.push({ venue, L: key, ...a });
  }
}

console.log(`規則 #4 稽核(per-lane)— SEP(≤80% 門檻)=${Math.round(SEP)}m,疊塔門檻 <${STACK}m,R=${R}m\n`);
console.log('場地        L  敵我前塔  後↔堡  後↔前  相鄰線  最近塔距  殘餘>80%');
console.log('─'.repeat(82));
for (const r of rows) {
  const flag = r.stackBad ? '❌疊塔' : r.residual ? '⚠️殘餘' : '✅';
  console.log(
    `${r.venue.padEnd(12)}${String(r.L).padEnd(3)}${`${Math.round(r.oppFront)}%`.padStart(6)}  ${`${Math.round(r.worstRB)}%`.padStart(5)}` +
    `  ${`${Math.round(r.worstRF)}%`.padStart(5)}  ${`${Math.round(r.worstAdj)}%`.padStart(5)}  ${`${Math.round(r.minStack)}m`.padStart(7)}   ${String(r.residual).padStart(4)}  ${flag}`);
}
console.log('─'.repeat(82));
console.log(`\n總結:場地×L = ${rows.length};物理疊塔失敗 ${stackFails}(MUST 0);` +
  `殘餘 >80% 對 ${residualPairs}(分布 ${venuesResidual} 個場地×L,靠放大地圖消除)`);
process.exit(stackFails ? 1 : 0);
