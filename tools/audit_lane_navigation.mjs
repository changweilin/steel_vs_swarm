// tools/audit_lane_navigation.mjs
// 兵線導航三規則離線稽核:
//   規則①「一旦進入高架橋/隧道/地下道,只能從出入口進出,不可從側邊出入」→ laneStructEntryAudit(圖論,2026-07-28)
//   規則②「不可接近 180 度迴轉」                                        → laneUTurnAudit(幾何,2026-07-28)
//   規則③「主軸偏航累積不可超過範圍(順逆時針轉向可抵消,基準 = A→B 主軸)」→ laneTurnAccumAudit(幾何,2026-07-29)
// 執行 data.js 真正的判定原文(bake_venue_lanes.mjs / mapSelect.js 生成期共用同一支)。
// 含反向驗證:把規則故意鬆掉/寫壞的那一版餵進去,稽核 MUST 在對應條目紅字。
// 用法:node tools/audit_lane_navigation.mjs
import { MAPGEO, laneUTurnAudit, laneTurnAccumAudit, laneStructEntryAudit } from '../public/js/data.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗', name); } };
const section = (t) => console.log('\n' + t);
const D2R = Math.PI / 180;

// ============ 規則② 迴轉(laneUTurnAudit) ============
// 兩段各 leg 公尺、第二段相對第一段(+x)轉 turnDeg;轉角 = 兩段航向夾角。
const bent = (turnDeg, leg = 120) => [[0, 0], [leg, 0], [leg + leg * Math.cos(turnDeg * D2R), leg * Math.sin(turnDeg * D2R)]];

section('規則② 不可接近 180° 迴轉(門檻 ' + MAPGEO.UTURN_MAX_DEG + '°)');
ok('直線不判迴轉', laneUTurnAudit([[0, 0], [600, 0]]).ok && laneUTurnAudit([[0, 0], [600, 0]]).maxDeg < 1);
ok('平緩兩點(< 3 頂點防呆)恆合法', laneUTurnAudit([[0, 0], [10, 0]]).ok);
ok('90° 轉角合法', laneUTurnAudit(bent(90)).ok);
ok('148° 大彎(門檻下)合法', laneUTurnAudit(bent(148)).ok);
ok('152° (門檻上)判迴轉', !laneUTurnAudit(bent(152)).ok);
ok('178° 幾近掉頭判迴轉', !laneUTurnAudit(bent(178)).ok);
// 角度量測正確性:bent(t) 的 maxDeg ≈ t(門檻恰卡在此刻度上)
ok('轉角量測 = 幾何轉角(±0.5°)', Math.abs(laneUTurnAudit(bent(150)).maxDeg - 150) < 0.5);
// 出去再折回(多頂點反轉,含一段短邊):MUST 判迴轉
ok('出去再折回(reversal)判迴轉', !laneUTurnAudit([[0, 0], [180, 0], [180, 4], [0, 4]]).ok);
// 重取樣防鋸齒:階梯狀短邊(逐頂點 90° 轉,但宏觀朝 45° 前進)MUST NOT 誤判成迴轉
const stair = [[0, 0]];
for (let i = 0; i < 20; i++) { const b = stair[stair.length - 1]; stair.push([b[0] + 20, b[1]], [b[0] + 20, b[1] + 20]); }
ok('階梯狀短邊(宏觀前進)不誤判', laneUTurnAudit(stair).ok);

// 反向驗證:若門檻放寬到 180°,152°/178° 就不再判迴轉 —— 證明門檻正是攔截點。
section('規則② 反向驗證(門檻若鬆到 180° ⇒ 對照組不再判迴轉)');
const loose = (pts) => laneUTurnAudit(pts).maxDeg < 180;   // 手動用 180° 門檻重判
ok('對照組:152° 在 180° 門檻下漏放(證明 150 門檻有作用)', loose(bent(152)) && !laneUTurnAudit(bent(152)).ok);
ok('對照組:178° 在 180° 門檻下漏放', loose(bent(178)) && !laneUTurnAudit(bent(178)).ok);

// ============ 規則③ 主軸偏航累積(laneTurnAccumAudit) ============
// byHeads(度陣列):依「逐段絕對航向」展開折線,每段 leg = 120(SEG_M 整數倍,轉角恰落在
// 取樣邊界 ⇒ 航向量測無跨角稀釋);主軸 = 首點 → 末點方位,由航向組合自然決定。
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
// 基準正確性:L 型直角轉的主軸 = 對角線 45°,兩段各偏 ±45° —— 若誤用「出發航向」基準會量到 90°
ok('L 型直角轉:偏航 = ±45°(證明基準是主軸,±0.5°)',
  laneTurnAccumAudit(byHeads([0, 90])).ok && Math.abs(laneTurnAccumAudit(byHeads([0, 90])).maxAbsDeg - 45) < 0.5);
// 大幅之字 ±80°(相對主軸)合法 —— 舊「出發航向」基準會把首段航向當 0,量到 160° 誤殺
const zig80 = byHeads([80, -80, 80, -80, 80, -80]);
ok('大幅之字 ±80°(順逆抵消 + 主軸置中)合法', laneTurnAccumAudit(zig80).ok);
ok('出堡段即背對主軸(170° 接駁)判出界 —— 首取樣段一樣受檢',
  !laneTurnAccumAudit(byHeads([170, 0, 0, 0, 0, 0])).ok);
// 中途長段反向繞行:單點轉角 90/80/80/90 皆低於規則②門檻(規則②放行),偏航卻達 ~159° ——
// 證明兩規則獨立、且累積制攔得住「無單點大轉角的繞行」。對照組 −120° 淺繞行(峰值 ~116°)合法。
const detour = byHeads([0, 0, 0, 0, 0, 0, -90, -170, -90, 0, 0, 0, 0, 0, 0]);
ok('中途反向繞行(單點皆低於規則②門檻)由本規則攔下',
  laneUTurnAudit(detour).ok && !laneTurnAccumAudit(detour).ok);
ok('中途淺繞行(−120° 未過門檻)合法',
  laneTurnAccumAudit(byHeads([0, 0, 0, 0, 0, 0, -90, -120, -90, 0, 0, 0, 0, 0, 0])).ok);
// 繞圈:偏航不回捲,轉滿一圈累積 360° 必然出界(即使首尾都順著主軸)
ok('繞圈(0→90→180→270→0)判出界', !laneTurnAccumAudit(byHeads([0, 90, 180, 270, 0])).ok);
// 兩規則獨立(另一向):−70° 後 +155° 單點掉頭 —— 偏航峰值 ~83° 在範圍內(本規則放行),
// 由規則②攔 ⇒ 規則③ MUST NOT 被當成規則②的替代品而移除任一方。
// (不用恰好 150°:atan2 量測有 1e-14 級浮點誤差,會卡在規則②的嚴格 < 門檻上。)
ok('−70° 後 +155° 掉頭:規則③放行、規則②攔(互相獨立)',
  laneTurnAccumAudit(byHeads([0, -70, 85])).ok && !laneUTurnAudit(byHeads([0, -70, 85])).ok);
// 重取樣防鋸齒:階梯狀短邊逐頂點 ±90° 交錯,宏觀沿主軸 45° 前進,MUST NOT 誤判出界
ok('階梯狀短邊(宏觀沿主軸前進)不誤判', laneTurnAccumAudit(stair).ok);

// 反向驗證 A:若把基準誤寫回「出發航向」(初值 0,不對齊主軸),大幅之字對照組會被誤殺
// (首段 +80 被當 0,第二段量到 −160 出界)—— 證明真正的實作是對齊主軸後才累積。
section('規則③ 反向驗證(壞版對照組 ⇒ 稽核紅字)');
const headingRef = (pts) => {                                // 壞版:相對出發航向,初值 0
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
// 反向驗證 B:若門檻鬆到 360°,出堡反向案與繞圈案通通漏放 —— 證明現行門檻正是攔截點。
const loose3 = (pts) => laneTurnAccumAudit(pts).maxAbsDeg <= 360;   // 手動用 360° 門檻重判
ok('對照組:出堡反向 + 繞圈在 360° 門檻下漏放(證明 ' + LIM + ' 門檻有作用)',
  loose3(byHeads([170, 0, 0, 0, 0, 0])) && !laneTurnAccumAudit(byHeads([170, 0, 0, 0, 0, 0])).ok
  && loose3(byHeads([0, 90, 180, 270, 0])) && !laneTurnAccumAudit(byHeads([0, 90, 180, 270, 0])).ok);

// ============ 規則① 橋/隧只能從出入口進出(laneStructEntryAudit) ============
// struc[k] = 段 k(節點 k−1→k)是否結構邊;portal[i] = 節點 i 是否結構 way 端點。
section('規則① 橋/隧只能從出入口(結構 way 端點)進出');
// A 全陸域:無結構段 ⇒ 恆合法
ok('全陸域路徑合法', laneStructEntryAudit([false, false, false, false], [false, false, false, false]).ok);
// B 由 portal 進、由 portal 出:合法
//   節點 0(陸)─1(portal 進)─2(洞內)─3(portal 出)─4(陸)
ok('portal 進 + portal 出 合法',
  laneStructEntryAudit([false, false, true, true, false], [false, true, false, true, false]).ok);
// C 由「非 portal」中間節點側切上橋:違規
ok('側邊上橋(進入節點非 portal)判違規',
  !laneStructEntryAudit([false, false, true, true, false], [false, false, false, true, false]).ok);
// D 由「非 portal」中間節點側切下橋:違規
ok('側邊下橋(離開節點非 portal)判違規',
  !laneStructEntryAudit([false, false, true, true, false], [false, true, false, false, false]).ok);
// E 結構段緊貼兵線起點(主堡 = 天然出入口):進入端豁免,只查離開端
//   節點 0(起點,結構)─1(洞內)─2(portal 出)─3(陸)
ok('結構貼兵線起點:起點豁免(出口在 portal ⇒ 合法)',
  laneStructEntryAudit([false, true, true, false], [false, false, true, false]).ok);
ok('結構貼兵線起點:出口仍非 portal ⇒ 違規',
  !laneStructEntryAudit([false, true, true, false], [false, false, false, false]).ok);
// F 結構段緊貼兵線終點(主堡):離開端豁免,只查進入端
//   節點 0(陸)─1(portal 進)─2(洞內)─3(終點)
ok('結構貼兵線終點:終點豁免(入口在 portal ⇒ 合法)',
  laneStructEntryAudit([false, false, true, true], [false, true, false, false]).ok);
ok('結構貼兵線終點:入口仍非 portal ⇒ 違規',
  !laneStructEntryAudit([false, false, true, true], [false, false, false, false]).ok);
// 首個違規節點索引正確(C 案進入節點 = 1)
ok('回報首個違規節點索引',
  laneStructEntryAudit([false, false, true, true, false], [false, false, false, true, false]).at === 1);

// 反向驗證:把所有節點都當成 portal(= 拿掉「出入口」約束)⇒ 側切案 C/D 通通放行,
// 證明真正攔下側邊出入的就是 portal 檢查。
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
