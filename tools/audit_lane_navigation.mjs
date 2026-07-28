// tools/audit_lane_navigation.mjs
// 兵線導航兩規則離線稽核(2026-07-28 使用者需求):
//   規則①「一旦進入高架橋/隧道/地下道,只能從出入口進出,不可從側邊出入」→ laneStructEntryAudit(圖論)
//   規則②「不可接近 180 度迴轉」                                        → laneUTurnAudit(幾何)
// 執行 data.js 真正的判定原文(bake_venue_lanes.mjs / mapSelect.js 生成期共用同一支)。
// 含反向驗證:把規則故意鬆掉的那一版餵進去,稽核 MUST 在對應條目紅字。
// 用法:node tools/audit_lane_navigation.mjs
import { MAPGEO, laneUTurnAudit, laneStructEntryAudit } from '../public/js/data.js';

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
