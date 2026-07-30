// ============ 地下道(平地下穿)稽核 ============
// 用途:隧道與地下道是**兩種東西** ——
//   隧道   道路平坦、鑽進突起的地形:深度來自山。舊引擎唯一做得出來的那種。
//   地下道 地形平坦、路面一端往下、穿過去後另一端再上來:深度來自挖。
// 舊制的隧道路面是「兩端洞口地表高的直線內插」⇒ 平地上下沉量恆 0、永遠藏不住天花板
// ⇒ 圖資明明是地下道,遊戲裡只有一條平街(2026-07-28 之前的已知缺口)。
// 改制只換**路面剖面**(`underpassPlan` + `tunFloorAt`),牆/天花/橫樑/照明/門洞/打洞/走廊/
// 伺服器 slab 一律沿用隧道那一整套 —— 本稽核就是驗這兩件事:剖面對不對、沿用有沒有斷。
// 2026-07-29 引道改制(「隧道方法」):出入口只在道路頭尾兩端 ——
//   ① 引道開挖收窄成垂直路塹(run.cut → carveTunnels 過渡帶 hw+CUT_W;山體隧道維持 hw+7):
//      平地上 hw+7 緩斜壁是一圈走得下去的碗 = 從地下道**側面**挖出入口,MUST NOT 回歸;
//   ② 引道登記 open 物理段(tunnelSegs open:true):只服務 surfaceAt 站立捕捉(站精確下沉
//      剖面)與 _updatePlayer 隧道側壁閘(溝底不能爬牆側出);slab 上傳 / _slabHitT 彈道 /
//      ceilingAt 天花 / lev 回報 MUST 濾 !open —— 露天路塹頭上是天空,漏濾 = 伺服器把露天溝
//      當洞內(側牆全擋 LOS、爆風隔絕)= 兩端分家靜默丟包(A18/A30 一族)。
//
//   Ⅰ 剖面與規劃(真的執行 `biomes.js` 的 underpassPlan / tunFloorAt 原文)
//     ① 平坦地形:舊制(直線剖面)覆蓋區間 MUST 為空(= 缺口本身);新制 MUST 建得出洞段
//     ② 下沉量 MUST > CLEAR + ROOF_T(藏得住天花板),且平地上恰為 + MARGIN
//     ③ 兩端引道 MUST 回到地表 —— 「與一般道路對齊」的唯一量法
//     ④ 縱坡 MUST ≤ GRADE_MAX;空間夠時 MUST 收在目標 GRADE 內
//     ⑤ 剖面 MUST 是「降 → 平底 → 升」,平底段 MUST ≥ BOX_MIN 且深度足以藏天花板
//     ⑥ 引道 MUST NOT 伸出圖界
//     ⑦ 放棄條件逐條(人行道 / 太深 / 擠不出引道 / 泡水)—— §4 寧缺勿錯
//     ⑧ **山體隧道不得回歸**:sink 不存在時 tunFloorAt 逐點 = 舊的直線內插公式
//     ⑨ 門洞 slope(打洞/collar 的路面外推)取整段平均 ⇒ 曲線剖面下的偏差 MUST 收斂
//   Ⅱ 構件幾何(執行 `biomes.js` 真正的發射器原文,不另抄公式)
//     引道擋土牆頂 = 基準線 + KERB、緣石帶內外緣與高度、洞段維持舊公式、
//     地下道 MUST NOT 長出明隧道構件(外露頂板/扶壁)、山體隧道 MUST NOT 長出緣石帶
//   Ⅲ 純表現層與單一縫(靜態規則)
//     三個消費端共用 tunFloorAt / way._tun.pts、carveTunnels 吃逐段 hw、
//     緣石帶不進 cols/tunnelSegs/ceilSegs/走廊(伺服器 slab 不得漂移)
//   Ⅳ 開挖補集:引道挖得到、洞段不動;引道剖面 = 垂直路塹(cut 旗標)
//   Ⅴ open 物理段:引道露天路塹(執行發射器原文)+ 消費端閘門(slab/彈道/天花/lev 濾 !open,
//     surfaceAt 站立捕捉與移動側壁閘不濾)
//   Ⅵ 結構隧道資格閘(2026-07-29 澀谷側壁破口案):strucTunnel 單一縫 —— 人行/自行車級
//     (PED_HW)與室內(indoor)tunnel way MUST NOT 進結構管線(不開挖、不成洞、不建牆),
//     攤平成一般小徑;車行(含 building_passage)照舊。carve 入口、dedupeParallelTunnels 候選
//     與場景稽核 MUST 同吃這個閘(去重不閘 = 不合格長 way 壓掉合格隧道,洞與路雙雙蒸發)。
//     前科:澀谷站 indoor footway 閉環被判成山體隧道,敞開補集 hw+7 斜壁開挖 + 髮夾鄰腿
//     走廊互捕,把覆蓋段側壁挖成走得出去的破口(側壁閘「側向地表高差 >2.6m」前提被打破)。
//   Ⅶ 幾何側壁(2026-07-29 澀谷殘餘破口封堵):高度場網格(格距 ~8.2m)把引道垂直路塹
//     雙線性攤成每步 ≤0.6m 的緩坡 ⇒ 單步 surfaceAt 高差閘(g > py0 + 2.6)在洞口內側
//     永不觸發,玩家可側向走出覆蓋段(資格閘修後殘餘 8 破口/5 區的機制)。改制:地下道
//     全長(覆蓋段 + 圍裙 + 引道)的 tunnelSegs 帶擋土牆頂 by(基準線 + KERB,wallTopAt
//     單一縫),makeTunnelIndex.wallCross 幾何判「由內跨出 ±hw 牆線且牆頂高出腳下 > 2.6m」
//     → _updatePlayer 擋下;跨入放行、道路兩端縱向出入放行、山體隧道無 by 恆放行
//     (逐位元不變)。執行 makeTunnelIndex 原文驗行為。
//
// 為什麼用「抽原文」而不是 import:`biomes.js` 的 three 走 CDN importmap,Node 端解析不了;
// 抽出來評估的仍是**真正的程式碼文字**(另抄一份公式就永遠會通過)。
// 跑法:`node tools/audit_underpass.mjs`
// 退出碼:0 = 全綠;1 = 有紅字
//
// **改完 MUST 做反向驗證**:把 underpassPlan 寫回舊制(平坦 tunnel way 一律回 null)、
// 把引道牆頂寫回 `yF + 0.15`、把門洞 slope 寫回瞬時斜率、把 carveTunnels 的 hw 寫回固定值、
// 把 nearOf 寫回一律 `hw + 7`、拿掉 open 段的 `open: true`、拿掉 slab 上傳的 `!d.open` 過濾、
// 拿掉 game.js 任一處 `!tn.open` 閘門、把 carve 入口寫回裸 `tags.tunnel`、把 strucTunnel 的
// PED_HW / indoor 檢查拿掉、把 dedupeParallelTunnels 候選寫回裸 `tags.tunnel`、把 wallTopAt
// 寫成恆 undefined(= 拿掉 by)、拿掉 game.js 的 tunnelWallCross 呼叫、把 wallCross 的
//「內 → 外」判定反向,稽核 MUST 在對應條目紅字。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOS, WATER } from '../public/js/data.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(ROOT, 'public', 'js', 'biomes.js'), 'utf8');
const tsrc = readFileSync(join(ROOT, 'public', 'js', 'terrain.js'), 'utf8');
const msrc = readFileSync(join(ROOT, 'public', 'js', 'main.js'), 'utf8');
const gsrc = readFileSync(join(ROOT, 'public', 'js', 'game.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : (fail++, console.error(`  ✗ ${msg}`)); };

// ---- 常數與函式原文 ----
const pickConst = (name, fb = {}) => {
  const m = new RegExp(`const ${name} = \\{([\\s\\S]*?)\\};`).exec(src);
  if (!m) throw new Error(`biomes.js 找不到 ${name}`);
  const o = Object.fromEntries(m[1].replace(/\/\/.*$/gm, '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => { const [k, v] = s.split(':').map((t) => t.trim()); return [k, k in fb ? fb[k] : +v]; }));
  for (const [k, v] of Object.entries(o)) if (!Number.isFinite(v)) throw new Error(`${name}.${k} 解析失敗`);
  return o;
};
const TUN = pickConst('TUN', { CLEAR: LOS.TUN_CLEAR_M });
const UND = pickConst('UND');
const ROAD_SEG = +/const ROAD_SEG = (\d+)/.exec(src)[1];
const ROAD_LIFT = +/const ROAD_LIFT = ([\d.]+)/.exec(src)[1];
const CUT_W = +(/const CUT_W = ([\d.]+)/.exec(tsrc)?.[1] ?? NaN);   // 地下道路塹過渡帶寬(terrain.js)
const TUN_GAP_CLOSE = +/const TUN_GAP_CLOSE = (\d+)/.exec(src)[1];
const TUN_COV_MIN = +/TUN_COV_MIN = (\d+)/.exec(src)[1];
const evalBlock = (from, fnName, extra = {}) => {
  const P0 = src.indexOf(from);
  const P1 = src.indexOf('\n}', src.indexOf(`function ${fnName}(`)) + 2;
  if (P0 < 0 || P1 <= P0) throw new Error(`找不到 ${fnName} 區塊`);
  const keys = Object.keys(extra);
  return new Function('TUN', ...keys, `${src.slice(P0, P1)}\nreturn ${fnName};`)(TUN, ...keys.map((k) => extra[k]));
};
const tunnelCoverIntervals = evalBlock('function tunnelCoverIntervals(', 'tunnelCoverIntervals',
  { TUN_GAP_CLOSE, TUN_COV_MIN });
const densify = evalBlock('function densify(', 'densify');
// UND / UND_HW / tunFloorAt / underpassPlan 是連續的一段原文
const tunFloorAt = evalBlock('const UND = {', 'tunFloorAt', { ROAD_SEG, WATER, densify, tunnelCoverIntervals });
const underpassPlan = evalBlock('const UND = {', 'underpassPlan', { ROAD_SEG, WATER, densify, tunnelCoverIntervals });

// ---- 測試場地:沿 +X 的一條直路(圖資 tunnel way),周邊平坦 ----
const G = 30;                       // 平地地表高
const WAY = [[0, 0], [60, 0]];      // 圖資上的地下道段(60m,= 台北市民大道那種都會地下道尺度)
const CAR = { highway: 'trunk', lanes: '6' };
const BOX = { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 };
const flat = () => G;
const arc = (p) => { const c = [0]; for (let i = 1; i < p.length; i++) c.push(c[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])); return c; };
const COVER_D = TUN.CLEAR + TUN.ROOF_T;   // 藏得住天花板所需的「地表 − 路面」

// ① 舊制在平地上建不出洞(缺口本身);新制建得出來
{
  const pts = densify(WAY, ROAD_SEG), cum = arc(pts), tot = cum[cum.length - 1];
  const oldFloors = cum.map((s) => tunFloorAt({ hA: G, hB: G }, s, tot));
  ok(tunnelCoverIntervals(pts, cum, oldFloors, flat).length === 0,
    '① 舊制(直線剖面)在平地上 MUST 建不出洞段 —— 這就是 2026-07-28 之前的缺口');
  const up = underpassPlan(WAY, CAR, flat, BOX);
  ok(!!up, '① 新制 MUST 在平地上規劃出地下道');
  ok(up && up.intervals.length > 0, '① 地下道 MUST 有覆蓋段(洞)');
}

const plan = underpassPlan(WAY, CAR, flat, BOX);
if (!plan) { console.error('  ✗ 平地基準案例規劃失敗,後續無法驗'); console.log('\n地下道稽核:中止'); process.exit(1); }

// ② 下沉量
{
  ok(plan.sink > COVER_D, `② 下沉量(${plan.sink.toFixed(2)})MUST > CLEAR + ROOF_T(${COVER_D})—— 否則平地永遠藏不住天花板`);
  ok(Math.abs(plan.sink - (COVER_D + UND.MARGIN)) < 1e-9, '② 平坦地形的下沉量 MUST 恰為 CLEAR + ROOF_T + MARGIN');
  ok(plan.sink <= UND.SINK_MAX, '② 下沉量 MUST 收在 SINK_MAX 內');
}

// ③ 兩端引道回到地表(= 與一般道路對齊:接縫處的路面高與外部一般道路逐點相同)
{
  const f = plan.floors;
  ok(Math.abs(f[0] - G) < 1e-9 && Math.abs(f[f.length - 1] - G) < 1e-9,
    '③ 引道兩端路面 MUST 回到地表高(與一般道路對齊)');
  // 一般道路的路面 = heightAt + ROAD_LIFT;地下道端點的路面 = floor + ROAD_LIFT ⇒ 同高、無台階
  ok(Math.abs((f[0] + ROAD_LIFT) - (G + ROAD_LIFT)) < 1e-9, '③ 接縫 MUST 無台階(兩者都是 + ROAD_LIFT)');
  // smoothstep 兩端切線為 0 ⇒ 接縫不只等高,連坡度都連續(C1)
  const d0 = (f[1] - f[0]) / (plan.cum[1] - plan.cum[0]);
  ok(Math.abs(d0) < 0.02, `③ 引道起點坡度 MUST ≈ 0(C1 連續,實得 ${d0.toFixed(4)})`);
}

// ④ 縱坡
{
  let g = 0;
  for (let i = 1; i < plan.floors.length; i++) {
    g = Math.max(g, Math.abs(plan.floors[i] - plan.floors[i - 1]) / (plan.cum[i] - plan.cum[i - 1]));
  }
  ok(g <= UND.GRADE_MAX + 1e-9, `④ 引道縱坡(${(g * 100).toFixed(1)}%)MUST ≤ GRADE_MAX(${UND.GRADE_MAX * 100}%)`);
  ok(g <= UND.GRADE + 1e-9, `④ 空間充足時縱坡 MUST 收在目標 GRADE(${UND.GRADE * 100}%)內`);
  // 引道長由下沉量與坡度推導,MUST NOT 手寫
  ok(Math.abs(plan.ramp - 1.5 * plan.sink / UND.GRADE) < 1e-9, '④ 引道長 MUST = 1.5 × sink / GRADE(推導值)');
}

// ⑤ 降 → 平底 → 升;平底段就是洞段
{
  const f = plan.floors, n = f.length;
  const lo = Math.min(...f);
  const bottom = f.map((y, i) => (y <= lo + 1e-6 ? i : -1)).filter((i) => i >= 0);
  ok(bottom.length > 0, '⑤ 剖面 MUST 有平底段');
  ok(bottom.every((i, k) => k === 0 || i === bottom[k - 1] + 1), '⑤ 平底段 MUST 連續(不是兩個坑)');
  ok(f.slice(0, bottom[0]).every((y, i) => i === 0 || y <= f[i - 1] + 1e-9), '⑤ 前段 MUST 單調下降');
  ok(f.slice(bottom[bottom.length - 1]).every((y, i, a) => i === 0 || y >= a[i - 1] - 1e-9), '⑤ 後段 MUST 單調上升');
  ok(Math.abs(lo - (G - plan.sink)) < 1e-9, '⑤ 平底 MUST 恰為地表 − 下沉量');
  const covLen = plan.intervals.reduce((a, [s0, s1]) => a + (s1 - s0), 0);
  ok(covLen >= UND.BOX_MIN, `⑤ 洞段長度(${covLen.toFixed(0)}m)MUST ≥ BOX_MIN(${UND.BOX_MIN})`);
  for (const [, , ia, ib] of plan.intervals) {
    ok(f.slice(ia, ib + 1).every((y) => G - y >= COVER_D - 1e-9),
      '⑤ 洞段內 MUST 全程藏得住天花板(地表 − 路面 ≥ CLEAR + ROOF_T)');
  }
  ok(plan.total > (WAY[1][0] - WAY[0][0]), '⑤ 折線 MUST 較圖資 way 長 —— 兩端接出去的就是引道');
  // 洞段 MUST 落在圖資 way 的範圍附近(引道在外、洞在內):OSM 的 tunnel way 畫的就是覆蓋段
  const mid = plan.total / 2;
  ok(plan.intervals.some(([s0, s1]) => s0 < mid && s1 > mid), '⑤ 洞段 MUST 涵蓋圖資 way 的中心');
}

// ⑥ 引道不得伸出圖界
{
  const tight = { minX: -40, maxX: 100, minZ: -1000, maxZ: 1000 };
  const p2 = underpassPlan([[0, 0], [60, 0]], CAR, flat, tight);
  if (p2) {
    ok(p2.pts.every(([x, z]) => x >= tight.minX - 1e-9 && x <= tight.maxX + 1e-9
      && z >= tight.minZ && z <= tight.maxZ), '⑥ 引道 MUST 夾在圖界內');
  } else ok(true, '⑥ 圖界太緊 ⇒ 放棄建地下道(亦合格)');
}

// ⑦ 放棄條件(§4 寧缺勿錯:寧可退回一般道路,不硬塞)
{
  ok(underpassPlan(WAY, { highway: 'footway' }, flat, BOX) === null,
    '⑦ 人行道 MUST NOT 建地下道(為一條步道在廣場上挖 10m 深壕溝)');
  ok(underpassPlan(WAY, { highway: 'path' }, flat, BOX) === null, '⑦ 小徑同理 MUST NOT 建');
  ok(underpassPlan(WAY, { highway: 'primary' }, flat, BOX) !== null, '⑦ 車行道 MUST 建得出來');
  // 中段是深谷 ⇒ 要挖得比 SINK_MAX 還深 ⇒ 放棄
  const valley = (x) => (x > 10 && x < 50 ? G - 12 : G);
  ok(underpassPlan(WAY, CAR, (x) => valley(x), BOX) === null, '⑦ 需要挖到 SINK_MAX 以上 MUST 放棄');
  // 兩端都被圖界卡死 ⇒ 引道擠不出 GRADE_MAX 以內的縱坡 ⇒ 放棄
  ok(underpassPlan(WAY, CAR, flat, { minX: -2, maxX: 62, minZ: -1000, maxZ: 1000 }) === null,
    '⑦ 引道空間不足(縱坡會超過 GRADE_MAX)MUST 放棄');
  // 走廊碰到水:泡水的地下道是水底隧道,不是這裡要做的東西
  ok(underpassPlan(WAY, CAR, (x) => (x > 20 && x < 40 ? WATER.LEVEL : G), BOX) === null,
    '⑦ 走廊碰到水域 MUST 放棄');
}

// ⑧ 山體隧道不得回歸:沒有 sink 的記錄,tunFloorAt 逐點 = 舊的直線內插
{
  const tw = { hA: 12, hB: 40 };
  let same = true;
  for (let s = 0; s <= 200; s += 7) same = same && Math.abs(tunFloorAt(tw, s, 200) - (12 + 28 * (s / 200))) < 1e-12;
  ok(same, '⑧ sink 不存在 ⇒ tunFloorAt MUST 逐位元等於舊的平直內插(山體隧道行為不動)');
  ok(Math.abs(tunFloorAt({ hA: 12, hB: 40, sink: 10, ramp: 50 }, 100, 200, false) - 26) < 1e-12,
    '⑧ sunk=false MUST 回基準線(引道護欄/緣石帶對齊一般路面用)');
}

// ⑨ 門洞 slope:整段平均 vs 洞口瞬時斜率 —— 曲線剖面下前者才不會外推偏掉
{
  const fAt = (s) => tunFloorAt(plan, s, plan.total);
  const [c0] = plan.intervals[0];
  const APRON = 8, s0 = Math.max(0, c0 - APRON);
  const depth = Math.min(plan.intervals[0][1] - s0, 40);
  const avg = (fAt(s0 + depth) - fAt(s0)) / depth;             // 現制
  const inst = fAt(s0 + 1) - fAt(s0);                          // 舊制(瞬時)
  let eAvg = 0, eInst = 0;
  for (let d = 0; d <= depth; d += 0.5) {
    eAvg = Math.max(eAvg, Math.abs(fAt(s0) + avg * d - fAt(s0 + d)));
    eInst = Math.max(eInst, Math.abs(fAt(s0) + inst * d - fAt(s0 + d)));
  }
  ok(eAvg < 1.5, `⑨ 平均斜率外推的最大偏差(${eAvg.toFixed(2)}m)MUST < 1.5m(打洞/collar 才不會判錯層)`);
  ok(eAvg < eInst, `⑨ 平均斜率 MUST 優於洞口瞬時斜率(舊制偏差 ${eInst.toFixed(2)}m)`);
  // 平直剖面(山體隧道)下兩者 MUST 恆等 ⇒ 這個改動不會動到隧道
  const lin = { hA: 10, hB: 30 };
  const la = (tunFloorAt(lin, 40, 200) - tunFloorAt(lin, 0, 200)) / 40;
  ok(Math.abs(la - (tunFloorAt(lin, 1, 200) - tunFloorAt(lin, 0, 200))) < 1e-12,
    '⑨ 平直剖面下平均 = 瞬時(山體隧道的門洞參數逐位元不變)');
}

// ---- Ⅱ 構件幾何(執行 biomes.js 真正的發射器原文)----
// 2026-07-30 柱列改制後,體檢 preamble(floorsV/covV/galP)搬到碰撞段迴圈之前(tunnelSegs 要吃
// gal 註記)—— 抽**兩段**連續原文縫合,跳過中間的 tunnelSegs/ceilSegs 迴圈(碰撞幾何,由本檔
// Ⅲ~Ⅶ 的靜態規則與 slab 濾網斷言顧)。
const B0 = src.indexOf('        const floorsV = cum.map((s) => tFloorAt(s));');
const B0e = src.indexOf('        for (let i = 0; i < nP - 1; i++) {', B0);
const C0 = src.indexOf('        // facade 落地基準', B0);
const B1 = src.indexOf('        // 橫樑 + 天花燈', C0);
if (B0 < 0 || B0e <= B0 || C0 <= B0e || B1 <= C0) throw new Error('找不到構件區塊');
const EMIT = src.slice(B0, B0e) + src.slice(C0, B1);
// 只擋「區塊被搬走/改名」(抽錯原文的話後面全部白驗);行為本身的回歸交給下面逐條 ok(),
// 這樣把程式碼寫回舊版時看到的是具名紅字,而不是一句抽取失敗。
if (!EMIT.includes('const galBase =')) throw new Error('抽出的構件區塊缺少 galBase(結構已變?)');
const tunnelWallProfile = evalBlock('const TUN_WALL_SAMP', 'tunnelWallProfile');
const emit = new Function('TUN', 'UND', 'tunnelWallProfile', 'run', 'nP', 'cum', 'hw', 'tFloorAt', 'tBaseAt',
  'covS', 'terrain', 'ceilOf', 'under', 'wall', 'galCols', 'galRoof', 'cope',
  `${EMIT}\nreturn { galP, galMask, floorsV, covV };`);
const HW = 9;
/**
 * 以規劃好的地下道剖面跑一次發射器。
 * heightAt 預設模擬**開挖後**地形:引道段路廊被壓到路面高(carveTunnels 的行為),
 * 洞段地表原樣 —— 這正是「引道轉換帶會讓明隧道體檢誤判」的現場。
 */
function build(under = true, heightAt = null) {
  const run = plan.pts, cum = plan.cum, nP = run.length;
  const fAt = (s) => tunFloorAt(plan, s, plan.total);
  const bAt = (s) => tunFloorAt(plan, s, plan.total, false);
  const covS = (s) => plan.intervals.some(([a, b]) => s >= a - 0.01 && s <= b + 0.01);
  const carved = (x) => {                       // 開挖後地表:引道走廊 = 路面,洞段 = 原地表
    let bs = Infinity, bf = G;
    for (let i = 0; i < nP; i++) {
      const d = Math.abs(x - run[i][0]);
      if (d < bs) { bs = d; bf = plan.floors[i]; }
    }
    return covS(bs === Infinity ? 0 : x) ? G : Math.min(G, bf);
  };
  const wall = { pos: [], nrm: [], idx: [], base: 0 }, galCols = [];
  const galRoof = { pos: [], nrm: [], idx: [], base: 0 };
  const cope = { pos: [], nrm: [], idx: [], base: 0 };
  const out = emit(TUN, UND, tunnelWallProfile, run, nP, cum, HW, fAt, bAt, covS,
    { heightAt: heightAt || ((x) => carved(x)) }, (s) => fAt(s) + TUN.CLEAR, under, wall, galCols, galRoof, cope);
  return { ...out, wall, galCols, galRoof, cope, run, cum, fAt, bAt, covS, nP };
}

// Ⅱ-a 地下道:引道擋土牆頂到「基準線 + KERB」、牆底在路面之下;洞段維持舊公式
{
  const b = build(true);
  const v = Array.from({ length: b.wall.pos.length / 3 }, (_, k) =>
    [b.wall.pos[k * 3], b.wall.pos[k * 3 + 1], b.wall.pos[k * 3 + 2]]);
  ok(v.length === b.nP * 4, 'Ⅱ-a 牆頂點數 MUST = 兩側 × 每頂點 2 枚');
  let okOpen = true, okCov = true, nOpen = 0;
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < b.nP; i++) {
      const k = (side * b.nP + i) * 2;
      const yF = v[k][1], yT = v[k + 1][1];
      const cov = b.covV[i];
      if (Math.abs(yF - (b.fAt(b.cum[i]) - 0.3)) > 1e-9) okOpen = false;
      if (cov) okCov = okCov && Math.abs(yT - (b.fAt(b.cum[i]) + TUN.CLEAR + 0.2)) < 1e-9;
      else { nOpen++; okOpen = okOpen && Math.abs(yT - (b.bAt(b.cum[i]) + UND.KERB)) < 1e-9; }
    }
  }
  ok(nOpen > 0, 'Ⅱ-a 測資 MUST 含引道段');
  ok(okOpen, 'Ⅱ-a 引道擋土牆 MUST 自路面下 0.3 頂到「基準線 + KERB」(舊制的 yF+0.15 = 沒有牆)');
  ok(okCov, 'Ⅱ-a 洞段牆頂 MUST 維持舊公式(天花 + 0.2)');
  ok(v.every((p) => Math.abs(Math.abs(p[2]) - HW) < 1e-9), 'Ⅱ-a 牆面 MUST 貼在 ±hw');
  ok(b.galRoof.idx.length === 0 && b.galCols.length === 0,
    'Ⅱ-a 地下道 MUST NOT 長出明隧道構件(外露頂板/柱列)—— 它的頂是沒被開挖的原地表');
  ok(b.galP.every((prof) => prof.every((g) => !g.open)), 'Ⅱ-a 地下道 MUST 全程 open=false');
  ok(b.run.slice(0, -1).every((_, i) => b.galMask(i) === 0),
    'Ⅱ-a 地下道 gal 遮罩 MUST 全 0(伺服器不得把引道側當可穿柱間)');
}

// Ⅱ-b 緣石帶(邊緣修飾):只鋪引道段、內緣貼牆、外緣蓋過開挖斜壁、與一般路面同高
{
  const b = build(true);
  const v = Array.from({ length: b.cope.pos.length / 3 }, (_, k) =>
    [b.cope.pos[k * 3], b.cope.pos[k * 3 + 1], b.cope.pos[k * 3 + 2]]);
  ok(v.length > 0, 'Ⅱ-b 引道段 MUST 鋪緣石帶');
  const lat = v.map((p) => Math.abs(p[2]));
  ok(lat.every((d) => Math.abs(d - HW) < 1e-9 || Math.abs(d - (HW + UND.COPE)) < 1e-9),
    'Ⅱ-b 緣石帶 MUST 自牆線(hw)鋪到 hw + COPE');
  ok(Number.isFinite(CUT_W) && UND.COPE >= CUT_W + 1,
    `Ⅱ-b COPE(${UND.COPE})MUST ≥ CUT_W + 1(${CUT_W + 1})—— 蓋過垂直路塹過渡帶(hw+CUT_W)與地形網格拉伸殘坡`);
  ok(v.every((p) => Math.abs(p[1] - (b.bAt(Math.abs(p[0] - b.run[0][0])) + 0.06)) < 2),
    'Ⅱ-b 緣石帶高度 MUST 貼著基準線(與一般路面對齊)');
  // 逐段檢查:洞段(兩端都覆蓋)MUST NOT 鋪
  const covXs = [];
  for (let i = 0; i + 1 < b.nP; i++) if (b.covV[i] && b.covV[i + 1]) covXs.push((b.run[i][0] + b.run[i + 1][0]) / 2);
  ok(covXs.length > 0, 'Ⅱ-b 測資 MUST 含洞段');
  ok(!v.some((p) => covXs.some((cx) => Math.abs(p[0] - cx) < 1e-9)),
    'Ⅱ-b 洞段 MUST NOT 鋪緣石帶(頂上是原地表,鋪了就是地面上憑空一條水泥帶)');
  ok(b.cope.idx.length === (v.length / 4) * 6, 'Ⅱ-b 緣石帶索引 MUST 與四頂點小段對齊');
}

// Ⅱ-c 山體隧道(under=false)MUST NOT 長出緣石帶 —— 舊行為不得回歸
{
  const b = build(false, () => G + 60);   // 四面都是山 = 深埋隧道
  ok(b.cope.idx.length === 0, 'Ⅱ-c 山體隧道 MUST NOT 鋪緣石帶');
  const v = Array.from({ length: b.wall.pos.length / 3 }, (_, k) => b.wall.pos[k * 3 + 1]);
  ok(v.every((y, k) => {
    const i = (k >> 1) % b.nP, yF = b.fAt(b.cum[i]) - 0.3;
    // 舊公式:牆底 = 路面 − 0.3;牆頂 = 覆蓋段 → 天花 + 0.2、敞開段 → 收成零高(yF + 0.15)
    const want = k % 2 ? (b.covV[i] ? b.fAt(b.cum[i]) + TUN.CLEAR + 0.2 : yF + 0.15) : yF;
    return Math.abs(y - want) < 1e-9;
  }), 'Ⅱ-c 山體隧道牆 MUST 維持舊公式(含敞開段收成零高)');
}

// Ⅱ-d 明隧道誤判防線:開挖後的引道碗緣讓側向地表低於頂板頂面,under=false 會判成明隧道,
//     under=true MUST NOT —— 這是「平地上憑空長出外露頂板」的病灶
{
  const dug = (x, z) => (Math.abs(z) > HW + 1 && Math.abs(z) < HW + 30 ? G - 6 : G);
  ok(build(false, dug).galRoof.idx.length > 0, 'Ⅱ-d 對照組:same 地形 under=false MUST 判成明隧道');
  ok(build(true, dug).galRoof.idx.length === 0, 'Ⅱ-d 地下道 MUST NOT 因引道碗緣長出明隧道構件');
}

// ---- Ⅳ 開挖補集:引道真的挖得到、洞段真的不動 ----
// carveTunnels 的判準是「原地表 < 路面 + clear + 1」,覆蓋判準是「原地表 ≥ 路面 + CLEAR + ROOF_T」
// —— ROOF_T = 1 ⇒ 兩者恰好互補。這一段驗的就是這個互補關係在下沉剖面上仍然成立:
// 送去開挖的敞開補集(= 兩條引道)MUST 全程挖得到,覆蓋段 MUST 一格都不動(不然平地會被鏟出天窗)。
{
  const n = plan.pts.length;
  const bounds = [0, ...plan.intervals.flatMap(([, , ia, ib]) => [ia, ib]), n - 1];
  const runs = [];
  for (let k = 0; k + 1 < bounds.length; k += 2) {
    const a = bounds[k], b = bounds[k + 1];
    if (b - a >= 1) runs.push([a, b]);
  }
  ok(runs.length === 2, `Ⅳ 敞開補集 MUST 是兩條引道(實得 ${runs.length})`);
  ok(runs.every(([a, b]) => b - a >= 3), 'Ⅳ 每條引道 MUST 有足夠頂點(不是一格殘段)');
  const covIdx = new Set();
  for (const [, , ia, ib] of plan.intervals) for (let i = ia; i <= ib; i++) covIdx.add(i);
  let dig = true, keep = true, nDig = 0;
  for (const [a, b] of runs) {
    for (let i = a; i <= b; i++) {
      if (covIdx.has(i)) continue;                 // 與洞段共用的端點不算(引道與洞在那裡交界)
      nDig++;
      dig = dig && G < plan.floors[i] + TUN.CLEAR + 1;
    }
  }
  for (const i of covIdx) keep = keep && !(G < plan.floors[i] + TUN.CLEAR + 1);
  ok(nDig > 10, 'Ⅳ 測資 MUST 有足夠引道頂點');
  ok(dig, 'Ⅳ 引道 MUST 全程符合開挖判準(挖不到就沒有下沉車道,只有一條浮在地面的路)');
  ok(keep, 'Ⅳ 洞段 MUST 一格都不開挖(挖了就是把平地鏟出天窗、頂上那條橫向道路跟著塌)');
  ok(Math.abs(TUN.ROOF_T - 1) < 1e-9,
    'Ⅳ ROOF_T MUST = 1 —— 開挖判準(路面 + clear + 1)與覆蓋判準(路面 + CLEAR + ROOF_T)靠它互補');
  // 引道改制(2026-07-29):開挖剖面 = 垂直路塹 —— 出入口只在道路兩端,側面不可進出
  ok(/tunnelRuns\.push\(\{ pts: [^\n]*hw: hwWay, cut: !!rec\.sink \}\)/.test(src),
    'Ⅳ 地下道開挖 run MUST 帶 cut 旗標(引道垂直路塹;山體隧道 run 不帶)');
  ok(/const nearOf = \(r\) => \(r\.hw \?\? hw\) \+ \(r\.cut \? CUT_W : 7\);/.test(tsrc),
    'Ⅳ carveTunnels MUST 依 cut 收窄過渡帶,山體隧道維持 hw+7(逐位元不變)');
  ok(Number.isFinite(CUT_W) && CUT_W < 7,
    `Ⅳ CUT_W(${CUT_W})MUST < 7 —— 寫回 7 = 平地上又挖出一圈走得下去的碗(從側面挖出入口)`);
}

// ---- Ⅲ 純表現層與單一縫(靜態規則)----
{
  const S0 = src.indexOf('      if (strc && total > 8) {');
  const S1 = src.indexOf('      // ---- 高架橋外觀', S0);
  const STRC = src.slice(S0, S1);
  // 剖面單一縫:三個消費端(carve 指派 / buildRoads / markGradeCorridors)都 MUST 走 tunFloorAt
  ok(/const tFloorAt = \(s\) => tunFloorAt\(tw, s, total\);/.test(src),
    'Ⅲ buildRoads 的路面 MUST 走 tunFloorAt 單一縫');
  ok(/const floor = tunFloorAt\(tw, cum\[i\], total\);/.test(src),
    'Ⅲ markGradeCorridors 的走廊淨空 MUST 走 tunFloorAt 單一縫');
  ok(/floors = cum\.map\(\(s\) => tunFloorAt\(rec, s, tot\)\)/.test(src),
    'Ⅲ 開挖階段的路面 MUST 走 tunFloorAt 單一縫');
  // 舊制那兩份手寫剖面(buildRoads 的 tFloorAt、markGradeCorridors 的 floor)MUST 都不在了。
  // 高架橋的 deckAt 不在此列 —— 那是另一種結構(橋面 = 內插 + BRIDGE_RISE),與隧道剖面無關。
  ok(!/const tFloorAt = \(s\) => hA/.test(src) && !/const floor = hA \+ \(hB - hA\)/.test(src),
    'Ⅲ MUST NOT 有第二份手寫的平直剖面公式(分家 = 牆與路面錯層)');
  // 幾何單一縫:地下道的折線含引道延伸段,消費端 MUST 吃 way._tun 存的那一份
  ok(/const pieces = strc \? \[tw\.pts\]/.test(src.slice(src.indexOf('function markGradeCorridors'))),
    'Ⅲ markGradeCorridors MUST 吃 way._tun.pts(重算 densify(raw) 會少掉引道)');
  ok((src.match(/const pieces = strc \? \[tw\.pts\]/g) || []).length === 2,
    'Ⅲ buildRoads 與 markGradeCorridors MUST 都吃 way._tun.pts');
  // 通行寬單一縫 + 開挖剖面吃逐段 hw
  ok(/const strucHw = \(tags\) => Math\.max\(roadWidth\(tags\) \/ 2, PASS_W \/ 2\);/.test(src),
    'Ⅲ 結構通行半寬 MUST 只有 strucHw 一份');
  ok((src.match(/strucHw\(/g) || []).length >= 3, 'Ⅲ buildRoads / markGradeCorridors / carve 指派 MUST 共用 strucHw');
  ok(/hw: hwWay/.test(src), 'Ⅲ 開挖 run MUST 帶自己的通行寬');
  ok(/const fullOf = \(r\) => \(r\.hw \?\? hw\) \+ 1;/.test(tsrc) && /const nearOf = \(r\) => \(r\.hw \?\? hw\) \+ \(r\.cut \? CUT_W : 7\);/.test(tsrc),
    'Ⅲ carveTunnels MUST 逐段吃 r.hw(固定值會讓寬路的路面兩緣埋進沒開挖到的斜坡)');
  // 純表現層:緣石帶/引道牆 MUST NOT 動碰撞/天花/走廊/通行寬
  const copeAt = STRC.indexOf('cope.pos.push(');
  ok(copeAt > 0, 'Ⅲ 緣石帶 MUST 在結構區塊內');
  ok(!/cols\.push/.test(STRC.slice(copeAt - 900, copeAt + 900)),
    'Ⅲ 緣石帶 MUST NOT 登記碰撞柱(它鋪在牆外的地表上)');
  // 覆蓋段碰撞/天花:幾何欄位(fy/cy/hw)與山體隧道**逐字**同一條公式(無 under/open 分支);
  // 幾何側壁牆頂 by 只准經 wallTopAt 單一縫(山體隧道 = undefined ⇒ 逐位元不變)——
  // 伺服器 slab(main.js 過濾 !open 後只投影 x/z/hw 上傳)與隧道同一套語意;
  // gal(2026-07-30 明隧道柱列)只是註記欄(地下道經 galP 歸零恆 0),幾何行 MUST 原樣。
  // 行尾容忍(\r?\n):Windows autocrlf 工作樹是 CRLF,\n 字面量 includes 必假陽性紅
  ok(/tunnelSegs\.push\(\{\r?\n {14}x1, z1, fy1: tFloorAt\(o0\) \+ ROAD_LIFT, cy1: ceilOf\(o0\),\r?\n {14}x2, z2, fy2: tFloorAt\(o1\) \+ ROAD_LIFT, cy2: ceilOf\(o1\), hw,\r?\n {14}by1: wallTopAt\(o0\), by2: wallTopAt\(o1\),\r?\n {14}gal: galMask\(i\),[^\n]*\r?\n {12}\}\);/.test(STRC),
    'Ⅲ 覆蓋段 tunnelSegs MUST 維持與隧道逐字共用的幾何公式(fy/cy/hw 無 under/open 分支;by 只經 wallTopAt;gal 只是註記)');
  ok(/const wallTopAt = under \? \(s\) => tBaseAt\(s\) \+ UND\.KERB : \(\) => undefined;/.test(STRC),
    'Ⅲ 牆頂 wallTopAt MUST 是唯一縫:地下道 = 基準線 + KERB(與引道擋土牆同一條線),山體隧道 = undefined');
  ok((STRC.match(/ceilSegs\.push/g) || []).length === 1 && !/ceilSegs\.push[^\n]*(open|under)/.test(STRC),
    'Ⅲ ceilSegs(不透明天花)MUST 只有覆蓋段一份、不吃地下道分支');
  ok(!/hw = [^\n]*under/.test(STRC), 'Ⅲ 通行寬 hw MUST NOT 隨地下道改變(伺服器 slab / 規則 #5 不得漂移)');
  ok(/const under = strc && !!tw\.sink;/.test(src), 'Ⅲ 地下道判定 MUST 只看剖面有沒有下沉量(單一旗標)');
  ok(/const yT = !covV\[i\] \? \(under \? tBaseAt\(cum\[i\]\) \+ UND\.KERB : yF \+ 0\.15\)/.test(STRC),
    'Ⅲ 引道牆頂 MUST 分兩路:地下道頂到基準線 + KERB、山體隧道維持收成零高');
  ok(/return under \? prof\.map\(\(g\) => \(\{ \.\.\.g, open: false \}\)\) : prof;/.test(STRC),
    'Ⅲ 地下道 MUST 一律非明隧道(引道轉換帶的碗緣會讓體檢誤判成明隧道)');
  ok(/if \(under\) \{/.test(STRC.slice(STRC.indexOf('cope.pos.push(') - 1200, STRC.indexOf('cope.pos.push('))),
    'Ⅲ 緣石帶 MUST 只鋪地下道(山體隧道的引道兩側是原生山壁)');
  // ⑨ 驗的是公式,這條驗**發射端真的用了**那條公式(否則稽核綠、遊戲照樣拿瞬時斜率外推)
  ok(/slope: sIn === s \? 0 : \(tFloorAt\(sIn\) - tFloorAt\(s\)\) \/ Math\.abs\(sIn - s\)/.test(STRC),
    'Ⅲ 門洞 slope MUST 取整段走廊平均(洞口瞬時斜率在曲線剖面上會外推偏掉)');
  // 只有車行道
  ok(/const UND_HW = /.test(src) && /UND_HW\.test\(tags\?\.highway/.test(src),
    'Ⅲ 地下道 MUST 只建在車行道(人行地下道現實中是窄樓梯通道)');
  ok(!/footway|path/.test(/const UND_HW = [^\n]*/.exec(src)[0]),
    'Ⅲ UND_HW MUST NOT 含步道分級');
  ok(UND.MARGIN > 0, 'Ⅲ MARGIN MUST > 0(地表微起伏時洞段才不會被判斷開)');
  ok(UND.GRADE_MAX > UND.GRADE, 'Ⅲ GRADE_MAX MUST > 目標 GRADE');
}

// ---- Ⅴ open 物理段:引道露天路塹(執行 biomes.js 發射器原文)+ 消費端閘門 ----
{
  const O0 = src.indexOf('        // ---- 地下道引道 open 物理段');
  const O1 = src.indexOf('        // facade 落地基準', O0);
  if (O0 < 0 || O1 <= O0) throw new Error('找不到 open 段區塊(結構已變?)');
  const OPEN = src.slice(O0, O1);
  // 行為:以平地基準案例跑一次發射器 —— open 段恰鋪滿圍裙外敞開補集、公式與覆蓋段同一條
  const run = plan.pts, cum = plan.cum, nP = run.length, total = plan.total;
  const fAt = (s) => tunFloorAt(plan, s, plan.total);
  const cAt = (s) => fAt(s) + TUN.CLEAR;
  const APRON = 8;
  const ivx = plan.intervals.map(([c0, c1]) => [c0 >= 4 ? Math.max(0, c0 - APRON) : c0,
                                                c1 <= total - 4 ? Math.min(total, c1 + APRON) : c1]);
  const at = (d) => {
    let i = 1; while (cum[i] < d && i < nP - 1) i++;
    const f = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [run[i - 1][0] + (run[i][0] - run[i - 1][0]) * f, run[i - 1][1] + (run[i][1] - run[i - 1][1]) * f];
  };
  const bAt = (s) => tunFloorAt(plan, s, plan.total, false);
  const wallTop = (s) => bAt(s) + UND.KERB;   // 原文 wallTopAt 的 under 分支(Ⅲ 已鎖定其唯一縫)
  const mk = (under) => {
    const tunnelSegs = [];
    new Function('under', 'ivx', 'cum', 'nP', 'total', 'at', 'tFloorAt', 'ceilOf', 'hw', 'ROAD_LIFT', 'wallTopAt', 'tunnelSegs', OPEN)(
      under, ivx, cum, nP, total, at, fAt, cAt, HW, ROAD_LIFT, under ? wallTop : () => undefined, tunnelSegs);
    return tunnelSegs;
  };
  ok(mk(false).length === 0, 'Ⅴ 山體隧道(under=false)MUST NOT 登記 open 段(敞開段是原生山谷地形,照舊踩 heightAt)');
  const segs = mk(true);
  ok(segs.length > 0 && segs.every((s) => s.open === true && s.hw === HW),
    'Ⅴ 引道段 MUST 全帶 open:true 且通行寬 hw 不變');
  ok(segs.every((s) => Number.isFinite(s.by1) && Number.isFinite(s.by2)),
    'Ⅴ open 段 MUST 帶擋土牆頂 by(幾何側壁 wallCross 的資料源;拿掉 = 引道路塹側壁再開洞)');
  const segLen = segs.reduce((a, s) => a + Math.hypot(s.x2 - s.x1, s.z2 - s.z1), 0);
  const covLen = ivx.reduce((a, [c0, c1]) => a + (c1 - c0), 0);
  ok(Math.abs(segLen - (total - covLen)) < 3,
    `Ⅴ open 段總長(${segLen.toFixed(1)}m)MUST ≈ 圍裙外敞開補集(${(total - covLen).toFixed(1)}m)—— 少了 = 引道站不上下沉剖面`);
  // 測試場地沿 +X ⇒ 弧長 = x 位移,可逐段回推驗公式
  const sOf = (x) => x - run[0][0];
  ok(segs.every((s) => Math.abs(s.fy1 - (fAt(sOf(s.x1)) + ROAD_LIFT)) < 1e-6
    && Math.abs(s.cy1 - cAt(sOf(s.x1))) < 1e-6),
    'Ⅴ open 段 MUST 吃 tunFloorAt / ceilOf 同一條公式(路面 + ROAD_LIFT、天花 + CLEAR)');
  ok(segs.every((s) => !ivx.some(([c0, c1]) => sOf(s.x1) > c0 + 0.5 && sOf(s.x1) < c1 - 0.5)),
    'Ⅴ open 段 MUST NOT 疊進覆蓋段內部(覆蓋段的 slab/天花語意不得被 open 汙染)');
  // 消費端閘門:makeTunnelIndex 單一縫傳遞;站立捕捉/側壁閘吃、slab 上傳/彈道/天花/lev 濾
  ok(/best = \{ floor, ceil: d\.cy1 \+ \(d\.cy2 - d\.cy1\) \* t, open: !!d\.open \}/.test(src),
    'Ⅴ makeTunnelIndex MUST 傳遞 open 旗標(消費端唯一資訊源)');
  ok(/tunnels\.filter\(\(d\) => !d\.open\)\.map/.test(msrc),
    'Ⅴ main.js slab 上傳 MUST 過濾 open 段 —— 露天路塹上傳成 ty=2 = 伺服器把溝底當洞內(兩端分家靜默丟包)');
  ok(/if \(tn && !tn\.open && curY < tn\.ceil\) c = tn\.ceil;/.test(msrc),
    'Ⅴ ceilingAt MUST 濾 open(露天段頭上是天空,不是隱形蓋)');
  ok(/if \(tn && curY < tn\.ceil\) return tn\.floor;/.test(msrc),
    'Ⅴ surfaceAt MUST NOT 濾 open —— 站立捕捉正是 open 段的存在理由(站精確下沉剖面)');
  ok(/if \(tn && !tn\.open && yHi !== yLo/.test(gsrc),
    'Ⅴ _slabHitT MUST 濾 open(露天段不擋彈道 —— 看得到就打得到)');
  ok(/const inTun = !!\(btn && !btn\.open && p\.y < btn\.ceil\);/.test(gsrc)
    && /lev: inTun \? 2 : 0/.test(gsrc),
    'Ⅴ 爆點 lev MUST 濾 open(露天溝裡的爆風不吃隧道隔絕)');
  ok(/const gy = inTun \? btn\.floor : this\.terrain\.heightAt\(p\.x, p\.z\);/.test(gsrc),
    'Ⅴ 爆點離地基準 MUST 在洞內改取隧道路面 —— 覆蓋段山體未開挖,heightAt 會把爆點抬到山頂');
  ok(/const inTun = !!\(tn && !tn\.open && this\.pos\.y < tn\.ceil\);/.test(gsrc),
    'Ⅴ pos 回報 lev MUST 濾 open(露天溝單位不是 lev=2 的洞內鬼影)');
  ok(/const inTun0 = !!\(tn0 && py0 < tn0\.ceil\);/.test(gsrc),
    'Ⅴ 移動側壁閘 MUST NOT 濾 open —— 溝底不能爬牆側出,出入口只在道路頭尾兩端');
}

// ---- Ⅵ 結構隧道資格閘(執行 biomes.js 原文;2026-07-29 澀谷側壁破口案)----
{
  const m = /const strucTunnel = \(tags\) =>[\s\S]*?;\r?\n/.exec(src);
  ok(!!m, 'Ⅵ biomes.js MUST 有 strucTunnel 資格閘(單一縫)');
  if (m) {
    const PED_HW = new Function(`return ${/const PED_HW = (\/[^\n]+\/);/.exec(src)[1]};`)();
    const strucTunnel = new Function('PED_HW', `${m[0]}return strucTunnel;`)(PED_HW);
    ok(strucTunnel({ tunnel: 'yes', highway: 'primary' }) === true,
      'Ⅵ 戶外車行 tunnel MUST 過資格閘(山體隧道/地下道行為不變)');
    ok(strucTunnel({ tunnel: 'building_passage', highway: 'unclassified' }) === true,
      'Ⅵ 車行 building_passage MUST 過(市民大道地下道族不受影響)');
    ok(strucTunnel({ tunnel: 'yes', highway: 'footway' }) === false,
      'Ⅵ 人行 tunnel MUST NOT 成洞 —— 澀谷站地下街閉環曾把覆蓋段側壁挖成可走破口');
    ok(strucTunnel({ tunnel: 'yes', highway: 'steps' }) === false
      && strucTunnel({ tunnel: 'yes', highway: 'cycleway' }) === false,
      'Ⅵ 階梯/自行車道 tunnel MUST NOT 成洞(PED_HW 全家族)');
    ok(strucTunnel({ tunnel: 'yes', highway: 'primary', indoor: 'yes' }) === false,
      'Ⅵ indoor tunnel MUST NOT 成洞(室內通道不是地形結構)');
    ok(strucTunnel({ tunnel: 'yes', highway: 'primary', indoor: 'no' }) === true,
      'Ⅵ indoor=no MUST 不誤傷');
    ok(strucTunnel({ highway: 'footway' }) === false, 'Ⅵ 非 tunnel way 恆 false');
    // 平行雙孔去重 MUST 同吃資格閘(執行原文 + 合成資料):不合格 way 不參與去重,
    // MUST NOT 以「長者優先」壓掉合格隧道(前科:澀谷 footway 閉環把玉川通り trunk 整條剔除
    // ⇒ 資格閘上線後洞與路雙雙蒸發);合格×合格的平行去重行為維持不變。
    const dedupeParallelTunnels = evalBlock('const bridgeHw', 'dedupeParallelTunnels', {
      densify, ROAD_SEG, strucTunnel,
      llToWorld: (lat, lon) => [lon, lat], roadWidth: () => 8, PASS_W: 16,
    });
    const mkWay = (highway, x1) => ({ tags: { highway, tunnel: 'yes' },
      geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: x1 }] });
    ok(dedupeParallelTunnels([mkWay('trunk', 90), mkWay('footway', 106)], {}).length === 2,
      'Ⅵ 較長的不合格 footway MUST NOT 壓掉合格 trunk 隧道(兩者皆保留:trunk 成洞、footway 攤平)');
    ok(dedupeParallelTunnels([mkWay('primary', 100), mkWay('primary', 80)], {}).length === 1,
      'Ⅵ 合格×合格平行雙孔去重 MUST 維持長者優先(原行為不變)');
    ok(dedupeParallelTunnels([mkWay('footway', 100), mkWay('footway', 80)], {}).length === 2,
      'Ⅵ 不合格×不合格 MUST 皆保留(攤平成小徑後不再是雙孔,無去重必要)');
  }
  // 消費端接線:carve 入口(way._tun 唯一結構開關)與場景稽核 MUST 走同一個閘
  const CARVE = src.slice(src.indexOf('const tunnelRuns = [];'), src.indexOf('terrain.carveTunnels(tunnelRuns'));
  ok(CARVE.length > 0 && /if \(!strucTunnel\(way\.tags\)\) continue;/.test(CARVE),
    'Ⅵ carve 入口(way._tun 唯一寫入迴圈)MUST 用 strucTunnel(way.tags) 閘住,不得退回裸 tags.tunnel');
  const ssrc = readFileSync(join(ROOT, 'tools', 'audit_lane_scenarios.mjs'), 'utf8');
  ok((ssrc.match(/strucTunnel\(w(ay)?\.tags\)/g) || []).length >= 4,
    'Ⅵ 場景稽核 MUST 同步吃 strucTunnel(①/⑦ 判定與候選診斷同源,否則稽核比執行期多洞)');
}

// ---- Ⅶ 幾何側壁(執行 makeTunnelIndex 原文):洞口內側側向走出破口 MUST 封死 ----
{
  // 靜態接線:唯一縫與消費端
  ok(/const WALL_STEP = 2\.6;/.test(src) && /if \(inTun0 && g > py0 \+ 2\.6\) return false;/.test(gsrc),
    'Ⅶ WALL_STEP MUST = 2.6 —— 與 game.js 單步側壁閘同一門檻(兩把尺 = 判定分家)');
  ok(/q\.wallCross = \(x0, z0, x1, z1, y\) =>/.test(src) && /if \(d\.by1 == null\) continue;/.test(src),
    'Ⅶ makeTunnelIndex MUST 附 wallCross 幾何判定,且山體隧道(無 by)MUST 恆放行');
  ok(/if \(w0 > d\.hw \|\| w1 <= d\.hw\) continue;/.test(src),
    'Ⅶ wallCross MUST 只攔「由內跨出」牆線(跨入 = 從地表跳/落進路塹,照舊放行)');
  ok(/if \(s < -0\.5 \|\| s > len \+ 0\.5\) continue;/.test(src),
    'Ⅶ wallCross MUST 縱向夾制在段內(鏈真端點 = 道路頭尾兩端出入口)');
  ok(/terrain\.tunnelWallCross = tunnelAt\.wallCross \|\| null;/.test(msrc),
    'Ⅶ main.js MUST 把 wallCross 接上 terrain.tunnelWallCross(唯一縫傳遞)');
  ok(/if \(this\.terrain\.tunnelWallCross\?\.\(px0, pz0, cx, cz, py0\)\) return false;/.test(gsrc),
    'Ⅶ game.js passable MUST 呼叫 tunnelWallCross(位移前 → 候選點、腳下高 py0)');
  ok(msrc.includes('.map((d) => [rd(d.x1), rd(-d.z1), rd(d.x2), rd(-d.z2), rd(d.hw), 2, d.gal || 0])'),
    'Ⅶ slab 上傳 MUST 只投影 x/z/hw + gal 註記(by 是客戶端移動物理,不出海 = 伺服器語意零漂移;gal 由 audit_open_tunnel Ⅳ 驗語意)');
  // 行為:以平地基準案例建 tunnels(覆蓋段 + 圍裙 + open 引道,by 走 Ⅲ 鎖定的 wallTopAt 公式)
  const M0 = src.indexOf('export function makeTunnelIndex');
  const M1 = src.indexOf('\n}', M0) + 2;
  if (M0 < 0 || M1 <= M0) throw new Error('找不到 makeTunnelIndex(結構已變?)');
  const mkIndex = new Function(`${src.slice(M0, M1).replace('export function', 'function')}\nreturn makeTunnelIndex;`)();
  const run = plan.pts, cum = plan.cum, nP = run.length, total = plan.total;
  const fAt = (s) => tunFloorAt(plan, s, plan.total);
  const bAt = (s) => tunFloorAt(plan, s, plan.total, false);
  const wallTop = (s) => bAt(s) + UND.KERB;
  const APRON = 8;
  const ivx = plan.intervals.map(([c0, c1]) => [c0 >= 4 ? Math.max(0, c0 - APRON) : c0,
                                                c1 <= total - 4 ? Math.min(total, c1 + APRON) : c1]);
  const at = (d) => {
    let i = 1; while (cum[i] < d && i < nP - 1) i++;
    const f = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [run[i - 1][0] + (run[i][0] - run[i - 1][0]) * f, run[i - 1][1] + (run[i][1] - run[i - 1][1]) * f];
  };
  const HW7 = 9;
  const mkSegs = (withBy) => {
    const segs = [];
    const push = (c0, c1, open) => {
      for (let d = c0; d < c1 - 0.4; d += 6) {
        const d2 = Math.min(c1, d + 6);
        const [x1, z1] = at(d), [x2, z2] = at(d2);
        segs.push({ x1, z1, x2, z2, fy1: fAt(d) + ROAD_LIFT, fy2: fAt(d2) + ROAD_LIFT,
          cy1: fAt(d) + TUN.CLEAR, cy2: fAt(d2) + TUN.CLEAR, hw: HW7, open,
          by1: withBy ? wallTop(d) : undefined, by2: withBy ? wallTop(d2) : undefined });
      }
    };
    for (const [c0, c1] of ivx) push(c0, c1, false);
    let sPrev = 0;
    for (const [c0, c1] of ivx) { if (c0 - sPrev > 0.4) push(sPrev, c0, true); sPrev = Math.max(sPrev, c1); }
    if (total - sPrev > 0.4) push(sPrev, total, true);
    return segs;
  };
  const q = mkIndex(mkSegs(true));
  // 測試場地沿 +X(z = 0 為軸):側向跨出 = z 由 hw 內跨到 hw 外
  const xAt = (s) => run[0][0] + s;
  const [c0] = plan.intervals[0];
  const c1 = plan.intervals[0][1];
  const sCore = (c0 + c1) / 2, sApron = Math.max(0, c0 - 4);
  let sTrench = null, sShallow = null;
  for (let s = 0; s < c0 - APRON; s += 1) {
    if (sTrench === null && G - fAt(s) > 4) sTrench = s;
    if (G - fAt(s) < 2 && G - fAt(s) > 0.2) sShallow = s;   // 取最靠洞口的淺段(仍在引道上)
  }
  ok(sTrench !== null && sShallow !== null, 'Ⅶ 測資 MUST 含深路塹段與淺引道段');
  const out = (s) => q.wallCross(xAt(s), HW7 - 0.2, xAt(s), HW7 + 0.3, fAt(s) + ROAD_LIFT);
  ok(out(sCore) === true, 'Ⅶ 覆蓋段核心側向跨出 MUST 擋(洞內只能沿路面走到洞口)');
  ok(out(sApron) === true, 'Ⅶ 圍裙段側向跨出 MUST 擋(澀谷殘餘破口就在洞口內側 1~7m)');
  ok(sTrench === null || out(sTrench) === true, 'Ⅶ 深路塹(open 引道)側向跨出 MUST 擋(溝底不能爬牆側出)');
  ok(sShallow === null || out(sShallow) === false,
    'Ⅶ 淺引道(牆頂 − 腳下 ≤ 可跨步高)側向跨出 MUST 放行(緣石可跨,不設隱形牆)');
  ok(q.wallCross(xAt(sCore), HW7 + 0.3, xAt(sCore), HW7 - 0.2, G) === false,
    'Ⅶ 由外向內跨入 MUST 放行(可從地表跳/落進路塹,單向物理)');
  ok(q.wallCross(xAt(sCore), HW7 - 0.2, xAt(sCore), HW7 + 0.3, G) === false,
    'Ⅶ 站在地表高跨越牆線 MUST 放行(頂上那條橫向道路照走 —— y + 2.6 ≥ 牆頂)');
  {
    let blocked = false;
    for (let s = sCore; s <= total + 4; s += 0.5) {
      if (q.wallCross(xAt(s), 0, xAt(s + 0.5), 0, fAt(Math.min(s + 0.5, total)) + ROAD_LIFT)) blocked = true;
    }
    ok(!blocked, 'Ⅶ 沿道路縱向走到頭(含跨出道路端)MUST 全程放行 —— 出入口只在道路頭尾兩端');
  }
  const qM = mkIndex(mkSegs(false));
  ok(qM.wallCross(xAt(sCore), HW7 - 0.2, xAt(sCore), HW7 + 0.3, fAt(sCore) + ROAD_LIFT) === false,
    'Ⅶ 山體隧道(無 by)同幾何跨出 MUST 放行(幾何側壁只作用地下道,山體行為逐位元不變)');
  // 破口機制回歸重演:網格把 9~10m 垂直路塹攤成每步 0.55m 的緩坡 ⇒ 舊制(單步高差閘)
  // 逐步走出 MUST 成立(= 破口存在的證據),新制 wallCross 在第一步跨線 MUST 擋下。
  {
    const s0 = c0 + 2;                     // 洞口內側 2m(覆蓋段核心,同破口現場)
    let py = fAt(s0) + ROAD_LIFT, escaped = true;
    for (let k = 1; k <= 60; k++) {
      const zK = 0.5 * k;
      const g = zK <= HW7 ? fAt(s0) + ROAD_LIFT : Math.min(G, py + 0.55);   // 攤緩坡:單步恆 +0.55
      if (g > py + 2.6) { escaped = false; break; }                         // 舊制唯一防線
      py = g;
    }
    ok(escaped, 'Ⅶ 重演:攤緩坡上舊制(單步高差)MUST 走得出去 —— 這就是殘餘破口的機制');
    ok(q.wallCross(xAt(s0), HW7 - 0.25, xAt(s0), HW7 + 0.25, fAt(s0) + ROAD_LIFT) === true,
      'Ⅶ 重演:同一條走線的第一步跨線,新制 wallCross MUST 擋下(破口歸零)');
  }
}

console.log(`\n地下道稽核:${pass} 綠 / ${fail} 紅`);
process.exit(fail ? 1 : 0);
