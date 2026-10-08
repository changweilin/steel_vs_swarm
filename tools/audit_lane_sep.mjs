// ============ Default map rule audit: lanes MUST NOT touch or cross ============
// Requirement (decided 2026-07-20): for any two lanes within the same L, after excluding the shared
// fan-out near the two main bases,
//   mid-section nearest distance MUST be at least LANE_MIN_SEP_M (shared nodes or near-touch count as contact), and 2D MUST NOT intersect (including bridge and tunnel grade separation, all banned).
// Adjudication lives in laneSeparationAudit() in data.js (shared by the bake hard gate, mapSelect, server recheck, and this audit).
// exit 1 means any venue x L violates (touch or cross). Usage: node tools/audit_lane_sep.mjs
import { VENUE_LANES } from '../public/js/venueLanes.js';
import { MAPGEO, laneSeparationAudit } from '../public/js/data.js';

const EARTH = 6371000, SC = 1 / MAPGEO.REAL_SCALE;
const SEP = MAPGEO.LANE_MIN_SEP_M, SEP_REAL = SEP * MAPGEO.REAL_SCALE;
const llToGame = (lat, lng, o) => [
  (lng - o[1]) * Math.PI / 180 * EARTH * Math.cos(o[0] * Math.PI / 180) * SC,
  (lat - o[0]) * Math.PI / 180 * EARTH * SC,
];

let fails = 0, multi = 0;
const rows = [];
for (const [venue, byL] of Object.entries(VENUE_LANES)) {
  for (const [L, entry] of Object.entries(byL)) {
    if (!entry?.lanes || !entry.bases) continue;
    if (entry.lanes.length < 2) continue;               // L1 has no neighbor lane, skip
    multi++;
    const o = entry.bases[0];
    const game = entry.lanes.map((line) => line.map(([lat, lng]) => llToGame(lat, lng, o)));
    const a = laneSeparationAudit(game);
    if (!a.ok) fails++;
    rows.push({ venue, L, ...a });
  }
}

console.log(`規則:兵線互不接觸/交叉 — 中段最近距離門檻 = ${SEP} 遊戲公尺(= ${Math.round(SEP_REAL)}m 真實)、豁免扇出帶 ±${MAPGEO.LANE_SEP_SKIP_FRAC}\n`);
console.log('場地        L  中段最近距(遊戲m)  2D交叉數  結果');
console.log('─'.repeat(58));
for (const r of rows) {
  const gap = r.minGap === Infinity ? '  ∞' : Math.round(r.minGap);
  console.log(`${r.venue.padEnd(12)}${r.L}  ${String(gap).padStart(12)}  ${String(r.crosses).padStart(8)}   ${r.ok ? '✅' : '❌接觸/交叉'}`);
}
console.log('─'.repeat(58));
console.log(`\n總結:多兵線 venue×L = ${multi};違規(接觸或交叉) ${fails}(MUST 0)`);
process.exit(fails ? 1 : 0);
