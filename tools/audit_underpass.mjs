// ============ 地下道(平地下穿)稽核 ============
// 用途:隧道與地下道是**兩種東西** ——
//   隧道   道路平坦、鑽進突起的地形:深度來自山。舊引擎唯一做得出來的那種。
//   地下道 地形平坦、路面一端往下、穿過去後另一端再上來:深度來自挖。
// 舊制的隧道路面是「兩端洞口地表高的直線內插」⇒ 平地上下沉量恆 0、永遠藏不住天花板
// ⇒ 圖資明明是地下道,遊戲裡只有一條平街(2026-07-28 之前的已知缺口)。
// 改制只換**路面剖面**(`underpassPlan` + `tunFloorAt`),牆/天花/橫樑/照明/門洞/打洞/走廊/
// 伺服器 slab 一律沿用隧道那一整套 —— 本稽核就是驗這兩件事:剖面對不對、沿用有沒有斷。
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
//
// 為什麼用「抽原文」而不是 import:`biomes.js` 的 three 走 CDN importmap,Node 端解析不了;
// 抽出來評估的仍是**真正的程式碼文字**(另抄一份公式就永遠會通過)。
// 跑法:`node tools/audit_underpass.mjs`
// 退出碼:0 = 全綠;1 = 有紅字
//
// **改完 MUST 做反向驗證**:把 underpassPlan 寫回舊制(平坦 tunnel way 一律回 null)、
// 把引道牆頂寫回 `yF + 0.15`、把門洞 slope 寫回瞬時斜率、把 carveTunnels 的 hw 寫回固定值,
// 稽核 MUST 在對應條目紅字。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOS, WATER } from '../public/js/data.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(ROOT, 'public', 'js', 'biomes.js'), 'utf8');
const tsrc = readFileSync(join(ROOT, 'public', 'js', 'terrain.js'), 'utf8');

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
const B0 = src.indexOf('        const floorsV = cum.map((s) => tFloorAt(s));');
const B1 = src.indexOf('        // 橫樑 + 天花燈', B0);
if (B0 < 0 || B1 <= B0) throw new Error('找不到構件區塊');
const EMIT = src.slice(B0, B1);
// 只擋「區塊被搬走/改名」(抽錯原文的話後面全部白驗);行為本身的回歸交給下面逐條 ok(),
// 這樣把程式碼寫回舊版時看到的是具名紅字,而不是一句抽取失敗。
if (!EMIT.includes('const galBase =')) throw new Error('抽出的構件區塊缺少 galBase(結構已變?)');
const tunnelWallProfile = evalBlock('const TUN_WALL_SAMP', 'tunnelWallProfile');
const emit = new Function('TUN', 'UND', 'tunnelWallProfile', 'run', 'nP', 'cum', 'hw', 'tFloorAt', 'tBaseAt',
  'covS', 'terrain', 'ceilOf', 'under', 'wall', 'buts', 'galRoof', 'cope',
  `${EMIT}\nreturn { galP, floorsV, covV };`);
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
  const wall = { pos: [], nrm: [], idx: [], base: 0 }, buts = [];
  const galRoof = { pos: [], nrm: [], idx: [], base: 0 };
  const cope = { pos: [], nrm: [], idx: [], base: 0 };
  const out = emit(TUN, UND, tunnelWallProfile, run, nP, cum, HW, fAt, bAt, covS,
    { heightAt: heightAt || ((x) => carved(x)) }, (s) => fAt(s) + TUN.CLEAR, under, wall, buts, galRoof, cope);
  return { ...out, wall, buts, galRoof, cope, run, cum, fAt, bAt, covS, nP };
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
  ok(b.galRoof.idx.length === 0 && b.buts.length === 0,
    'Ⅱ-a 地下道 MUST NOT 長出明隧道構件(外露頂板/扶壁)—— 它的頂是沒被開挖的原地表');
  ok(b.galP.every((prof) => prof.every((g) => !g.open)), 'Ⅱ-a 地下道 MUST 全程 open=false');
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
  ok(UND.COPE >= 7, `Ⅱ-b COPE(${UND.COPE})MUST ≥ 7 —— carveTunnels 的開挖斜壁外緣就在 hw+7,窄了會露出土溝`);
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
  ok(/const fullOf = \(r\) => \(r\.hw \?\? hw\) \+ 1;/.test(tsrc) && /const nearOf = \(r\) => \(r\.hw \?\? hw\) \+ 7;/.test(tsrc),
    'Ⅲ carveTunnels MUST 逐段吃 r.hw(固定值會讓寬路的路面兩緣埋進沒開挖到的斜坡)');
  // 純表現層:緣石帶/引道牆 MUST NOT 動碰撞/天花/走廊/通行寬
  const copeAt = STRC.indexOf('cope.pos.push(');
  ok(copeAt > 0, 'Ⅲ 緣石帶 MUST 在結構區塊內');
  ok(!/cols\.push/.test(STRC.slice(copeAt - 900, copeAt + 900)),
    'Ⅲ 緣石帶 MUST NOT 登記碰撞柱(它鋪在牆外的地表上)');
  for (const name of ['tunnelSegs', 'ceilSegs']) {
    const i0 = STRC.indexOf(`${name}.push`);
    ok(i0 > 0 && !/\bunder\b|cope/.test(STRC.slice(i0, i0 + 400)),
      `Ⅲ ${name}(碰撞/天花)MUST NOT 吃地下道分支 —— 伺服器 slab 與隧道同一套語意`);
  }
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

console.log(`\n地下道稽核:${pass} 綠 / ${fail} 紅`);
process.exit(fail ? 1 : 0);
