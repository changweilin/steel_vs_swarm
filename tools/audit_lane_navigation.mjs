// tools/audit_lane_navigation.mjs
// Offline lane navigation audit for 3 topological and geometric constraints:
//   Rule 1: "Entry and exit to elevated bridges / tunnels / underpasses MUST pass through designated portals; side-entry forbidden" -> laneStructEntryAudit (graph theory).
//   Rule 2: "Acute turns approaching 180 deg are forbidden" -> laneUTurnAudit (geometry).
//   Rule 3: "Cumulative yaw deviation relative to A->B chord vector MUST remain within bounds (clockwise/counter-clockwise cancel)" -> laneTurnAccumAudit (geometry).
// Evaluates production logic from public/js/data.js (shared by bake_venue_lanes.mjs and mapSelect.js).
// Includes negative verification: intentionally relaxed or degraded logic MUST fail corresponding audit assertions.
// Usage: node tools/audit_lane_navigation.mjs
import { MAPGEO, laneUTurnAudit, laneTurnAccumAudit, laneStructEntryAudit } from '../public/js/data.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗', name); } };
const section = (t) => console.log('\n' + t);
const D2R = Math.PI / 180;

// ============ Rule 2. U-Turn Audit (laneUTurnAudit) ============
// Two segments of length `leg` (m), second segment rotated `turnDeg` relative to +x; turn angle = angle between heading vectors.
const bent = (turnDeg, leg = 120) => [[0, 0], [leg, 0], [leg + leg * Math.cos(turnDeg * D2R), leg * Math.sin(turnDeg * D2R)]];

section('規則② 不可接近 180° 迴轉(門檻 ' + MAPGEO.UTURN_MAX_DEG + '°)');
ok('直線不判迴轉', laneUTurnAudit([[0, 0], [600, 0]]).ok && laneUTurnAudit([[0, 0], [600, 0]]).maxDeg < 1);
ok('平緩兩點(< 3 頂點防呆)恆合法', laneUTurnAudit([[0, 0], [10, 0]]).ok);
ok('90° 轉角合法', laneUTurnAudit(bent(90)).ok);
ok('148° 大彎(門檻下)合法', laneUTurnAudit(bent(148)).ok);
ok('152° (門檻上)判迴轉', !laneUTurnAudit(bent(152)).ok);
ok('178° 幾近掉頭判迴轉', !laneUTurnAudit(bent(178)).ok);
// Heading measurement accuracy: bent(t).maxDeg ~= t around the cutoff threshold.
ok('轉角量測 = 幾何轉角(±0.5°)', Math.abs(laneUTurnAudit(bent(150)).maxDeg - 150) < 0.5);
// Out-and-back reversal over multiple vertices (including short connecting segment): MUST trigger U-turn failure.
ok('出去再折回(reversal)判迴轉', !laneUTurnAudit([[0, 0], [180, 0], [180, 4], [0, 4]]).ok);
// Resampling anti-aliasing: staircase micro-segments (per-vertex 90 deg turns progressing macroscopically at 45 deg) MUST NOT trigger false U-turn.
const stair = [[0, 0]];
for (let i = 0; i < 20; i++) { const b = stair[stair.length - 1]; stair.push([b[0] + 20, b[1]], [b[0] + 20, b[1] + 20]); }
ok('階梯狀短邊(宏觀前進)不誤判', laneUTurnAudit(stair).ok);

// Negative verification: relaxing threshold to 180 deg allows 152 deg / 178 deg turns to pass, proving threshold enforcement.
section('規則② 反向驗證(門檻若鬆到 180° ⇒ 對照組不再判迴轉)');
const loose = (pts) => laneUTurnAudit(pts).maxDeg < 180;   // Re-evaluate with 180 deg threshold.
ok('對照組:152° 在 180° 門檻下漏放(證明 150 門檻有作用)', loose(bent(152)) && !laneUTurnAudit(bent(152)).ok);
ok('對照組:178° 在 180° 門檻下漏放', loose(bent(178)) && !laneUTurnAudit(bent(178)).ok);

// ============ Rule 3. Cumulative Yaw Deviation Audit (laneTurnAccumAudit) ============
// byHeads(headings): unfolds polyline from absolute headings; segment length = 120m (multiple of SEG_M,
// placing turns exactly on sampling boundaries without angle dilution). Chord axis = start-to-end vector.
const byHeads = (hs, leg = 120) => {
  const pts = [[0, 0]];
  let x = 0, y = 0;
  for (const h of hs) { x += leg * Math.cos(h * D2R); y += leg * Math.sin(h * D2R); pts.push([x, y]); }
  return pts;
};

const LIM = MAPGEO.TURN_ACCUM_MAX_DEG;
section('規則③ 主軸偏航累積 ±' + LIM + '°(順逆時針可抵消,基準 = A→B 主軸)');
ok('門檻 MUST < 180°(≥180 = 允許完全背對主軸)', LIM < 180);
ok('直線零偏航', laneTurnAccumAudit([[0, 0], [600, 0]]).ok && laneTurnAccumAudit([[0, 0], [600, 0]]).maxAbsDeg < 1);
ok('平緩兩點(< 3 頂點防呆)恆合法', laneTurnAccumAudit([[0, 0], [10, 0]]).ok);
// Reference axis validation: L-shaped right turn has 45 deg chord axis, each leg deviating +-45 deg. Using departure heading as baseline would erroneously yield 90 deg.
ok('L 型直角轉:偏航 = ±45°(證明基準是主軸,±0.5°)',
  laneTurnAccumAudit(byHeads([0, 90])).ok && Math.abs(laneTurnAccumAudit(byHeads([0, 90])).maxAbsDeg - 45) < 0.5);
// Severe zig-zag +-80 deg relative to chord is valid; departure heading baseline would treat segment 0 as 0 and falsely fail on segment 1 at 160 deg.
const zig80 = byHeads([80, -80, 80, -80, 80, -80]);
ok('大幅之字 ±80°(順逆抵消 + 主軸置中)合法', laneTurnAccumAudit(zig80).ok);
ok('出堡段即背對主軸(170° 接駁)判出界 —— 首取樣段一樣受檢',
  !laneTurnAccumAudit(byHeads([170, 0, 0, 0, 0, 0])).ok);
// Mid-route reverse loop: individual turn angles (90/80/80/90) stay under Rule 2 limit, but yaw reaches ~159 deg.
// Confirms independence of rules and proves accumulation catches gentle loops. Control group (-120 deg detour, peak ~116 deg) passes.
const detour = byHeads([0, 0, 0, 0, 0, 0, -90, -170, -90, 0, 0, 0, 0, 0, 0]);
ok('中途反向繞行(單點皆低於規則②門檻)由本規則攔下',
  laneUTurnAudit(detour).ok && !laneTurnAccumAudit(detour).ok);
ok('中途淺繞行(−120° 未過門檻)合法',
  laneTurnAccumAudit(byHeads([0, 0, 0, 0, 0, 0, -90, -120, -90, 0, 0, 0, 0, 0, 0])).ok);
// Complete loop: yaw does not wrap; a full 360 deg turn exceeds limits even if start and end align with chord.
ok('繞圈(0→90→180→270→0)判出界', !laneTurnAccumAudit(byHeads([0, 90, 180, 270, 0])).ok);
// Rule independence: -70 deg followed by +155 deg sharp turn -- peak yaw (~83 deg) passes Rule 3, caught by Rule 2.
// Neither rule can substitute for the other. (Avoid exact 150 deg to prevent 1e-14 floating point boundary issues).
ok('−70° 後 +155° 掉頭:規則③放行、規則②攔(互相獨立)',
  laneTurnAccumAudit(byHeads([0, -70, 85])).ok && !laneUTurnAudit(byHeads([0, -70, 85])).ok);
// Resampling anti-aliasing: alternating +-90 deg staircase steps progressing at 45 deg along chord MUST NOT fail.
ok('階梯狀短邊(宏觀沿主軸前進)不誤判', laneTurnAccumAudit(stair).ok);

// Negative verification A: departure heading baseline erroneously fails severe zig-zags (+80 treated as 0, second leg at -160).
// Proves implementation correctly aligns against start-to-end chord vector.
section('規則③ 反向驗證(壞版對照組 ⇒ 稽核紅字)');
const headingRef = (pts) => {                                // Flawed variant: relative to initial segment heading.
  const segs = [];
  for (let i = 1; i < pts.length; i++) segs.push(Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]));
  let acc = 0, peak = 0;
  for (let i = 1; i < segs.length; i++) {
    let dh = segs[i] - segs[i - 1];
    if (dh > Math.PI) dh -= Math.PI * 2; else if (dh < -Math.PI) dh += Math.PI * 2;
    acc += dh;
    if (Math.abs(acc) > peak) peak = Math.abs(acc);
  }
  return peak * 180 / Math.PI;
};
ok('對照組:大幅之字在「出發航向基準」壞版下誤殺(證明基準 = 主軸)',
  headingRef(zig80) > LIM && laneTurnAccumAudit(zig80).ok);
// Negative verification B: relaxing threshold to 360 deg leaks reverse spawns and loops, proving threshold enforcement.
const loose3 = (pts) => laneTurnAccumAudit(pts).maxAbsDeg <= 360;   // Manual re-evaluation with 360 deg threshold.
ok('對照組:出堡反向 + 繞圈在 360° 門檻下漏放(證明 ' + LIM + ' 門檻有作用)',
  loose3(byHeads([170, 0, 0, 0, 0, 0])) && !laneTurnAccumAudit(byHeads([170, 0, 0, 0, 0, 0])).ok
  && loose3(byHeads([0, 90, 180, 270, 0])) && !laneTurnAccumAudit(byHeads([0, 90, 180, 270, 0])).ok);

// ============ Rule 1. Bridge/Tunnel Portal Ingress/Egress Audit (laneStructEntryAudit) ============
// struc[k] = segment k (nodes k-1 -> k) is structure edge; portal[i] = node i is structure way endpoint.
section('規則① 橋/隧只能從出入口(結構 way 端點)進出');
// A. Pure overland: no structural segments; always valid.
ok('全陸域路徑合法', laneStructEntryAudit([false, false, false, false], [false, false, false, false]).ok);
// B. Ingress via portal, egress via portal: valid.
//   Node: 0 (land) -> 1 (portal in) -> 2 (tunnel interior) -> 3 (portal out) -> 4 (land).
ok('portal 進 + portal 出 合法',
  laneStructEntryAudit([false, false, true, true, false], [false, true, false, true, false]).ok);
// C. Side entry onto bridge at non-portal interior node: invalid.
ok('側邊上橋(進入節點非 portal)判違規',
  !laneStructEntryAudit([false, false, true, true, false], [false, false, false, true, false]).ok);
// D. Side exit off bridge at non-portal interior node: invalid.
ok('側邊下橋(離開節點非 portal)判違規',
  !laneStructEntryAudit([false, false, true, true, false], [false, true, false, false, false]).ok);
// E. Structure begins at lane origin (base = natural portal): entrance exempt, exit checked.
//   Node: 0 (origin, structure) -> 1 (interior) -> 2 (portal out) -> 3 (land).
ok('結構貼兵線起點:起點豁免(出口在 portal ⇒ 合法)',
  laneStructEntryAudit([false, true, true, false], [false, false, true, false]).ok);
ok('結構貼兵線起點:出口仍非 portal ⇒ 違規',
  !laneStructEntryAudit([false, true, true, false], [false, false, false, false]).ok);
// F. Structure ends at lane destination (enemy base): exit exempt, entrance checked.
//   Node: 0 (land) -> 1 (portal in) -> 2 (interior) -> 3 (destination).
ok('結構貼兵線終點:終點豁免(入口在 portal ⇒ 合法)',
  laneStructEntryAudit([false, false, true, true], [false, true, false, false]).ok);
ok('結構貼兵線終點:入口仍非 portal ⇒ 違規',
  !laneStructEntryAudit([false, false, true, true], [false, false, false, false]).ok);
// Reports first offending node index (case C entry node = 1).
ok('回報首個違規節點索引',
  laneStructEntryAudit([false, false, true, true, false], [false, false, false, true, false]).at === 1);

// Negative verification: treating all nodes as portals disables portal gating and admits side cuts C/D.
section('規則① 反向驗證(所有節點皆 portal ⇒ 側切案漏放)');
const allPortal = (n) => new Array(n).fill(true);
ok('對照組:C 案在「全 portal」下漏放(證明 portal 檢查有作用)',
  laneStructEntryAudit([false, false, true, true, false], allPortal(5)).ok
  && !laneStructEntryAudit([false, false, true, true, false], [false, false, false, true, false]).ok);
ok('對照組:D 案在「全 portal」下漏放',
  laneStructEntryAudit([false, false, true, true, false], allPortal(5)).ok
  && !laneStructEntryAudit([false, false, true, true, false], [false, true, false, false, false]).ok);

console.log(`\n${fail ? '❌' : '✅'} lane-navigation: ${pass} 通過, ${fail} 失敗`);
process.exit(fail ? 1 : 0);
