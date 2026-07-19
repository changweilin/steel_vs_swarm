// ============ 預設地圖規則稽核:砲塔/主堡射程重疊(規則 #4)============
// 需求(2026-07-19 定奪,per-lane):
//   前線敵我雙砲塔維持重疊 80%(爭中線,固有);
//   後塔↔「己方主堡」「同兵線前塔」的射程重疊率 ≤ 80%(距離 ≥ SEP);任兩塔位不得物理疊塔(≥ STACK)。
//   **相鄰兵線**(|Δli|=1)同陣營雙砲塔點(前/後皆算)射程重疊率 ≤ 80%(距離 ≥ SEP);非相鄰兵線只防疊塔。
// 判定邏輯集中在 data.js 的 towerLayoutAudit()(自訂地圖掃描 / 伺服器驗證 / 烘焙共用同一支)。
// 短兵線做不到 ≤80% 時 solveTowerSites 取重疊最小的合法位 ⇒ 殘餘 > 80% 會被列為「殘餘」(靠放大地圖/REAL_SCALE 消除)。
// exit 1 僅在物理疊塔(真缺陷)。用法:node tools/audit_map_rules.mjs
import { VENUE_LANES } from '../public/js/venueLanes.js';
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
  for (const [L, entry] of Object.entries(byL)) {
    if (!entry?.lanes || !entry.bases) continue;
    const A = entry.bases[0], B = entry.bases[1];
    const c = { lat: (A[0] + B[0]) / 2, lng: (A[1] + B[1]) / 2 };
    const lanes = entry.lanes.map((line) => line.map(([lat, lng]) => llToM(lat, lng, c)));
    const a = towerLayoutAudit(lanes);
    if (a.stackBad) stackFails++;
    residualPairs += a.residual; if (a.residual) venuesResidual++;
    rows.push({ venue, L, ...a });
  }
}

console.log(`規則 #4 稽核(per-lane)— SEP(≤80% 門檻)=${Math.round(SEP)}m,疊塔門檻 <${STACK}m,R=${R}m\n`);
console.log('場地        L  敵我前塔  後↔堡  後↔前  相鄰線  最近塔距  殘餘>80%');
console.log('─'.repeat(82));
for (const r of rows) {
  const flag = r.stackBad ? '❌疊塔' : r.residual ? '⚠️殘餘' : '✅';
  console.log(
    `${r.venue.padEnd(12)}${r.L}  ${`${Math.round(r.oppFront)}%`.padStart(6)}  ${`${Math.round(r.worstRB)}%`.padStart(5)}` +
    `  ${`${Math.round(r.worstRF)}%`.padStart(5)}  ${`${Math.round(r.worstAdj)}%`.padStart(5)}  ${`${Math.round(r.minStack)}m`.padStart(7)}   ${String(r.residual).padStart(4)}  ${flag}`);
}
console.log('─'.repeat(82));
console.log(`\n總結:場地×L = ${rows.length};物理疊塔失敗 ${stackFails}(MUST 0);` +
  `殘餘 >80% 對 ${residualPairs}(分布 ${venuesResidual} 個場地×L,靠放大地圖消除)`);
process.exit(stackFails ? 1 : 0);
