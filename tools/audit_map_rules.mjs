// ============ 預設地圖規則稽核:砲塔/主堡射程重疊(規則 #4)============
// 需求(2026-07-19 定奪,per-lane):
//   前線敵我雙砲塔維持重疊 80%(爭中線,固有);
//   後塔↔「己方主堡」「同兵線前塔」的射程重疊率 ≤ 80%(距離 ≥ SEP);任兩塔位不得物理疊塔(≥ STACK)。
//   **相鄰兵線**(|Δli|=1)同陣營雙砲塔點(前/後皆算)射程重疊率 ≤ 80%(距離 ≥ SEP);非相鄰兵線只防疊塔。
// 跨兵線在共用主堡/中線的聚攏(後塔群、前塔群)屬 DOTA 拓樸固有,只列 info。solveTowerSites 不捨後塔(塔數不變),
// 短兵線做不到 ≤80% 時取重疊最小的合法位 ⇒ 殘餘 > 80% 會被列為「殘餘」(靠放大地圖/REAL_SCALE 消除)。
// exit 1 僅在物理疊塔(真缺陷)。用法:node tools/audit_map_rules.mjs
import { VENUE_LANES } from '../public/js/venueLanes.js';
import { UNITS, GAME, MAPGEO, solveTowerSites } from '../public/js/data.js';

const R = UNITS.tower.range, SEP = R * GAME.TOWER_SEP_F, OFF = GAME.TOWER_SIDE_OFF;
const BASE_R = Math.max(UNITS.base.range, UNITS.base.guns.range);
const STACK = 2 * OFF + 10;
const overlapPct = (d, ra, rb) => Math.max(0, (ra + rb - d) / Math.min(ra, rb)) * 100;

const EARTH = 6371000, SC = 1 / MAPGEO.REAL_SCALE;
const llToM = (lat, lng, c) => [
  (lng - c.lng) * Math.PI / 180 * EARTH * Math.cos(c.lat * Math.PI / 180) * SC,
  (lat - c.lat) * Math.PI / 180 * EARTH * SC,
];
const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const minTD = (A, B) => { let m = Infinity; for (const a of A.pts) for (const b of B.pts) m = Math.min(m, d2(a, b)); return m; };

let stackFails = 0, residualPairs = 0, venuesResidual = 0;
const rows = [];

for (const [venue, byL] of Object.entries(VENUE_LANES)) {
  for (const [L, entry] of Object.entries(byL)) {
    if (!entry?.lanes || !entry.bases) continue;
    const A = entry.bases[0], B = entry.bases[1];
    const c = { lat: (A[0] + B[0]) / 2, lng: (A[1] + B[1]) / 2 };
    const lanes = entry.lanes.map((line) => line.map(([lat, lng]) => llToM(lat, lng, c)));
    const sites = solveTowerSites(lanes);

    const structs = [];
    const baseXY = { SWARM: llToM(A[0], A[1], c), STEEL: llToM(B[0], B[1], c) };
    for (const side of ['SWARM', 'STEEL']) structs.push({ side, role: 'base', li: -1, r: BASE_R, pts: [{ x: baseXY[side][0], z: baseXY[side][1] }] });
    for (let li = 0; li < sites.length; li++) {
      sites[li].forEach((st, idx) => {
        const role = idx === sites[li].length - 1 ? 'front' : 'rear';
        for (const side of ['SWARM', 'STEEL']) {
          const p = st[side];
          structs.push({ side, role, li, r: R, pts: [-1, 1].map((s) => ({ x: p.x + p.nx * OFF * s, z: p.z + p.nz * OFF * s })) });
        }
      });
    }

    let worstRB = 0, worstRF = 0, worstAdj = 0, minStack = Infinity, resid = 0, oppFront = 0;
    for (let i = 0; i < structs.length; i++) for (let j = i + 1; j < structs.length; j++) {
      const a = structs[i], b = structs[j];
      if (a.li === b.li && a.role === b.role && a.side === b.side) continue;   // 同塔位左右塔
      const d = minTD(a, b), pct = overlapPct(d, a.r, b.r);
      const rear = a.role === 'rear' ? a : b.role === 'rear' ? b : null;
      const other = rear === a ? b : a;
      // 受規則約束:後塔↔己方主堡 / 後塔↔同兵線己方前塔
      if (rear && other.role === 'base' && rear.side === other.side) {
        worstRB = Math.max(worstRB, pct); if (pct > 80 + 1) { resid++; }
      } else if (rear && other.role === 'front' && rear.side === other.side && rear.li === other.li) {
        worstRF = Math.max(worstRF, pct); if (pct > 80 + 1) { resid++; }
      }
      // 相鄰兵線(|Δli|=1)同陣營塔對(前/後皆算):射程重疊率 ≤ 80%
      if (a.role !== 'base' && b.role !== 'base' && a.side === b.side && Math.abs(a.li - b.li) === 1) {
        worstAdj = Math.max(worstAdj, pct); if (pct > 80 + 1) { resid++; }
      }
      if (a.role === 'front' && b.role === 'front' && a.side !== b.side && a.li === b.li) oppFront = Math.max(oppFront, pct);
      if (a.role !== 'base' && b.role !== 'base') minStack = Math.min(minStack, d);
    }
    if (minStack < STACK - 1) stackFails++;
    residualPairs += resid; if (resid) venuesResidual++;
    rows.push({ venue, L, worstRB, worstRF, worstAdj, oppFront, minStack, resid, stackBad: minStack < STACK - 1 });
  }
}

console.log(`規則 #4 稽核(per-lane)— SEP(≤80% 門檻)=${Math.round(SEP)}m,疊塔門檻 <${STACK}m,R=${R}m\n`);
console.log('場地        L  敵我前塔  後↔堡  後↔前  相鄰線  最近塔距  殘餘>80%');
console.log('─'.repeat(82));
for (const r of rows) {
  const flag = r.stackBad ? '❌疊塔' : r.resid ? '⚠️殘餘' : '✅';
  console.log(
    `${r.venue.padEnd(12)}${r.L}  ${`${Math.round(r.oppFront)}%`.padStart(6)}  ${`${Math.round(r.worstRB)}%`.padStart(5)}` +
    `  ${`${Math.round(r.worstRF)}%`.padStart(5)}  ${`${Math.round(r.worstAdj)}%`.padStart(5)}  ${`${Math.round(r.minStack)}m`.padStart(7)}   ${String(r.resid).padStart(4)}  ${flag}`);
}
console.log('─'.repeat(82));
console.log(`\n總結:場地×L = ${rows.length};物理疊塔失敗 ${stackFails}(MUST 0);` +
  `殘餘 >80% 對 ${residualPairs}(分布 ${venuesResidual} 個場地×L,靠放大地圖消除)`);
process.exit(stackFails ? 1 : 0);
