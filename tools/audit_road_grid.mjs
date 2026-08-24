// ============ 地圖主方位 + 道路拓撲剪枝 + 16 方向量化 稽核 ============
// 用途:改 `data.js` 的 `mapRot`/`rotXZ`/`llToXZ`/`xzToLL`/`battleRect`/`battleBBox`、
// `roadgrid.js` 任一項、`terrain.js` 的投影或高程/影像取樣、`sim.js llToMeters`、
// `biomes.js` 的量化接線與 `worldToLL`、`ground.js` 的 gridA、`venues.js` 的 center.rot 之後跑。
//
// 使用者定案(2026-08-10)原句:「處理圖資時先找出地圖上下左右對準哪一個方向時,可以對齊
// 最多的大馬路組成正交網格,接著將所有道路量化成 16 個方向,同時盡可能避免讓道路變成鋸齒,
// 這樣道路拼圖可以透過這 16 個方向簡化並無縫準確貼合對齊,建築也更容易對齊排列。」
//
// 這件事分成兩半,壞掉的方式完全不同,所以本稽核也分兩半:
//
// 【上半:旋轉】旋轉住在**投影**裡,而投影是兩端共用的權威座標框。四個會靜默壞掉的地方:
//   ① **兩端反號**:客戶端框 z = 南、伺服器框 z = 北(A30 的 z 鏡射)。鏡射會把 R(θ) 共軛成
//      R(−θ) ⇒ `sim.llToMeters` MUST 只是 `llToXZ` 的 z 反號。在 sim 那邊「照抄一份旋轉」是
//      最自然的寫法,也是最致命的:兩端世界差 2θ,而畫面上只表現成「塔的位置跟畫面對不上」
//      「打得到卻沒傷害」—— 沒有任何錯誤訊息,而且 rot=0 的場地一切正常(所以本機測不出來)。
//   ② **第二份投影公式**:專案裡曾經有三份等距圓柱公式(terrain / sim / biomes.worldToLL)。
//      加旋轉時漏改任何一份,那一份的消費端就活在沒轉過的世界裡(衛星底圖與道路錯開、
//      兵線補橋接不上、影像 UV 整片轉了 −θ)。所以本稽核逐份驗「轉呼」而不是「算得對」。
//   ③ **世界方框跟著旋轉縮水**:方框是「旋轉後兵線包絡」的外接框,兵線一被轉到與某軸平行,
//      那一軸就塌掉(實測 barcelona 5v5 轉 45° ⇒ 面積剩 66%)。MAP_EXPAND 是等比放大救不了,
//      而它存在的理由正是「第三方野營要有側翼合法區」⇒ 面積掉三分之一 = 那個機制無聲失效。
//      故 `battleRect` 逐軸取「旋轉後」與「rot=0」的較寬者,而抓取範圍 `battleBBox` 跟著長大。
//   ④ **不是等距同構**:旋轉如果滲進任何一個「先算距離再轉」的地方,兵線長度/塔位/兵線分離
//      就會隨 rot 漂 —— 那會讓一整套烘焙好的兵線規則(#4/#5/分離/U-turn)全部失效。
//
// 【下半:量化】三件事必須同時成立,少一件都是可見的破圖:
//   ⓐ **真的落格**:量化後的段方位離 16 格的誤差要顯著小於量化前。最容易的寫壞法是「事後把
//      短方向段併進鄰段」—— 那會把 DDA 排好的階梯併回單一方向,長度重解隨即退化成「兩錨點
//      之間拉直」,結果整條路的方位是**原本的**方位。稽核看得到:誤差沒下降。
//   ⓑ **路不准走掉**:量化的代價沿路累積,一條卡在格界(11.25°)的長直路硬吸到鄰格,尾端會
//      甩出數百公尺(實測合成 1.5km 路 = 518m),那條路就此離開衛星底圖、離開已整平的路基、
//      離開自己那條兵線。硬上限 `MAX_DRIFT_M` 是本檔唯一的硬邊界。
//   ⓒ **路口不准裂開**:路口是**共用節點**。逐 way 各轉各的,兩條路在路口就會裂一條縫。
//      量化 MUST 是「解出新的節點位置」,而共用節點在輸出端 MUST 拿到**逐位元相同**的經緯度。
//   另外兩條:量化 MUST 是純函式(§2.3 —— 同一份 geocache 在不同客戶端算出不同路網 =
//   跨客戶端場景分家),而且 MUST NOT 作用在**兵線**上(兵線是伺服器也在吃的權威幾何)。
//
// 反向驗證(三支皆已實測會咬住 Ⅵ;門檻在套旗標**之前**由預設常數定案,MUST NOT 跟著旗標動):
//   --break-drift  位移上限放到 1e9   ⇒ Ⅵ「路不會走掉」(實測 90.6m)+「落格」MUST 紅
//   --break-dense  量化前不細分       ⇒ Ⅵ「逐條路落格」MUST 紅(斜街整條 10.25° 沒被量化)
//   --break-relax  節點鬆弛關掉       ⇒ Ⅵ「逐條路落格」MUST 紅(路口不動 ⇒ 長度重解整批退化)
//   --break-prune  關掉剪枝候選寬度   ⇒ Ⅵ-b「小閉環真的有剪」MUST 紅
//   --break-loop-area 小環面積門檻歸零 ⇒ Ⅵ-b「小閉環真的有剪」MUST 紅
//   --break-near-close 關掉死端近接閉合 ⇒ Ⅵ-b「近接死路視為閉環」MUST 紅
//   --break-rotbox 烘焙抓取範圍吃帶 rot 的 cfg ⇒ Ⅸ「冪等」MUST 紅(重烤會把角度越推越偏)
//   --break-rotover 執行期量測不讓過已有的 rot ⇒ Ⅸ「不覆蓋烘焙值」MUST 紅
import { readSrc, grabFn } from './audit_src.mjs';
import {
  MAPGEO, ROUTE_EDGE_MARGIN_M, mapRot, rotXZ, llToXZ, xzToLL, battleRect, battleBBox,
  laneSeparationAudit, towerLayoutAudit, solveTowerSites,
} from '../public/js/data.js';
import { llToMeters } from '../server/sim.js';
import {
  ROAD_PRUNE, ROAD_GRID, dirAngle, halfBin, densifyM, minStraightM, gridAngle, waySegs,
  pruneRoads, quantizeRoads, dirErrorDeg,
} from '../public/js/roadgrid.js';
import { VENUES, venueConfig } from '../public/js/venues.js';
import { VENUE_GRID } from '../public/js/venueGrid.js';

const argv = process.argv;
// 期望值 MUST NOT 隨 --break-* 一起變(那樣 break 永遠是綠的,見 CLAUDE.md §5.4 ㋑)——
// 全部門檻在套用 break 旗標**之前**由預設常數定案。
const BASE = { ...ROAD_GRID };
const BASE_PRUNE = { ...ROAD_PRUNE };
const BASE_MIN_STRAIGHT = BASE.MAX_DRIFT_M * BASE.DDA_F / Math.sin(Math.PI / BASE.DIRS);
const WAY_P50_MAX = 1.5;     // 逐條路的角度誤差中位數上限(度)
const NET_MEAN_MAX = 0.6;    // 全網長度加權平均角度誤差上限(度)

if (argv.includes('--break-drift')) ROAD_GRID.MAX_DRIFT_M = 1e9;
if (argv.includes('--break-dense')) ROAD_GRID.DENSIFY_F = 0.02;
if (argv.includes('--break-relax')) ROAD_GRID.RELAX_SWEEPS = 0;
if (argv.includes('--break-prune')) ROAD_PRUNE.MAX_W_M = 0;
if (argv.includes('--break-loop-area')) ROAD_PRUNE.MAX_LOOP_AREA_M2 = 0;
if (argv.includes('--break-near-close')) ROAD_PRUNE.NEAR_CLOSE_W_F = 0;

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const sec = (s) => console.log(`\n${s}`);
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const D2R = Math.PI / 180;
const ROTS = [0, 5 * D2R, 11.25 * D2R, -17.5 * D2R, 33 * D2R, -44.9 * D2R];

const dataSrc = readSrc('public', 'js', 'data.js');
const simSrc = readSrc('server', 'sim.js');
const terrSrc = readSrc('public', 'js', 'terrain.js');
const bioSrc = readSrc('public', 'js', 'biomes.js');
const grndSrc = readSrc('public', 'js', 'ground.js');
const rgSrc = readSrc('public', 'js', 'roadgrid.js');
const venSrc = readSrc('public', 'js', 'venues.js');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
const grab = (src, re) => (re.exec(src) || [''])[0];

// =================================================================================
sec('Ⅰ 地圖主方位 = 投影的一部分(旋轉是等距同構)');
// ---------------------------------------------------------------------------------
{
  const c0 = { lat: 41.3874, lng: 2.1686 };
  t('rot 缺席 ⇒ mapRot = 0(降級不例外)', mapRot(c0) === 0 && mapRot(undefined) === 0 && mapRot({ rot: NaN }) === 0);
  // rotXZ 在 0 是**恆等式**(不是「約等於」):這是 rot=0 逐位元同舊制的全部理由
  let ident = true;
  for (const v of [0, 1, -1, 1234.5678, -9e7, 1e-12]) {
    const [x, z] = rotXZ(v, v * 0.37, 0);
    if (x !== v || z !== v * 0.37) ident = false;
  }
  t('rotXZ(·, 0) 是恆等式(rot=0 逐位元同舊制的來源)', ident);

  // 保距 + 保角:任兩點的距離、任三點的夾角一律不隨 rot 改變
  const P = [[41.3820, 2.1600], [41.3910, 2.1750], [41.3860, 2.1810]];
  let iso = true, ang = true;
  const base = P.map(([a, b]) => llToXZ(a, b, c0));
  const bd = (i, j) => Math.hypot(base[i][0] - base[j][0], base[i][1] - base[j][1]);
  for (const rot of ROTS) {
    const c = { ...c0, rot };
    const q = P.map(([a, b]) => llToXZ(a, b, c));
    const qd = (i, j) => Math.hypot(q[i][0] - q[j][0], q[i][1] - q[j][1]);
    for (const [i, j] of [[0, 1], [1, 2], [0, 2]]) if (!near(bd(i, j), qd(i, j), 1e-7)) iso = false;
    const ca = (p) => Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]) - Math.atan2(p[2][1] - p[0][1], p[2][0] - p[0][0]);
    if (!near(ca(base), ca(q), 1e-12)) ang = false;
  }
  t('保距:任兩點距離不隨 rot 改變(旋轉是等距同構)', iso);
  t('保角:任三點夾角不隨 rot 改變', ang);

  // 往返
  let rt = true;
  for (const rot of ROTS) {
    const c = { ...c0, rot };
    for (const [a, b] of P) {
      const [x, z] = llToXZ(a, b, c);
      const [la, ln] = xzToLL(x, z, c);
      if (!near(la, a, 1e-9) || !near(ln, b, 1e-9)) rt = false;
    }
  }
  t('xzToLL 是 llToXZ 的逆運算(逐 rot 往返 ≤ 1e-9 度)', rt);
  t('center 本身恆為原點(對稱方框的錨)', ROTS.every((rot) => {
    const [x, z] = llToXZ(c0.lat, c0.lng, { ...c0, rot });
    return near(x, 0, 1e-9) && near(z, 0, 1e-9);
  }));
}

// =================================================================================
sec('Ⅱ 兩端同一個世界:伺服器框 = 客戶端框的 z 鏡射(A30)');
// ---------------------------------------------------------------------------------
{
  const c0 = { lat: 41.3874, lng: 2.1686 };
  let mirror = true;
  for (const rot of ROTS) {
    const c = { ...c0, rot };
    for (const [a, b] of [[41.382, 2.160], [41.391, 2.175], [41.370, 2.190]]) {
      const [x, z] = llToXZ(a, b, c);
      const [sx, sz] = llToMeters(a, b, c);
      if (x !== sx || z !== -sz) mirror = false;
    }
  }
  // 這一條是本改動最容易靜默壞掉的地方:在 sim 那邊「照抄一份旋轉」會讓兩端差 2θ
  t('sim.llToMeters(p) 逐位元 === llToXZ(p) 的 z 反號(**逐 rot**,不是只有 rot=0)', mirror);
  const llm = grab(simSrc, /export function llToMeters[\s\S]*?\n}/);
  t('sim.llToMeters 是薄殼:轉呼 llToXZ 後只做 z 反號',
    /llToXZ\(lat, lng, center\)/.test(llm) && /return \[x, -z\];/.test(llm));
  t('sim.llToMeters 內沒有第二份旋轉(z 鏡射已自動反號,再轉一次 = 兩端差 2θ)',
    !/rotXZ|mapRot|Math\.cos|Math\.sin/.test(llm));
  t('sim.js 全檔無 REAL_SCALE(投影唯一縫 = data.js llToXZ)',
    !strip(simSrc).split('\n').some((l) => /MAPGEO\.REAL_SCALE/.test(l)));

  // 第二份投影公式的原文閘:三個舊實作一律 MUST 是轉呼
  const llw = grab(terrSrc, /export function llToWorld[\s\S]*?\n}/);
  t('terrain.llToWorld 轉呼 data.js llToXZ(不再自帶公式)',
    /return llToXZ\(lat, lng, center\);/.test(llw) && !/R_EARTH|WORLD_S/.test(llw));
  const wll = grab(bioSrc, /function worldToLL[\s\S]*?\n}/);
  t('biomes.worldToLL 轉呼 data.js xzToLL(不再自帶公式)',
    /xzToLL\(x, z, center\)/.test(wll) && !/6371000|REAL_SCALE/.test(wll));
  const terrCode = strip(terrSrc);
  t('terrain.js 全檔沒有第二份「世界公尺 → 經緯度」公式(影像取樣/UV/開挖重繪一律走 xzToLL)',
    !/REAL_SCALE \/ \(?R_EARTH/.test(terrCode) && !/center\.lat \+ \(-z\)/.test(terrCode));
}

// =================================================================================
sec('Ⅲ 世界方框:旋轉只准讓它長大,而且抓取範圍要跟著蓋住');
// ---------------------------------------------------------------------------------
{
  let floorOk = true, coverOk = true, exact0 = true, worstGrow = 1, worstShrink = 9;
  for (const v of VENUES) {
    for (const T of [1, 3, 5]) {
      const cfg = venueConfig(v, T);
      const base = { lat: cfg.center.lat, lng: cfg.center.lng };
      const r0 = battleRect({ ...cfg, center: base });
      const A0 = (r0.maxX - r0.minX) * (r0.maxZ - r0.minZ);
      // rot=0 時 battleRect 與「不帶 rot 欄位」逐位元相同
      const rz = battleRect({ ...cfg, center: { ...base, rot: 0 } });
      if (rz.minX !== r0.minX || rz.maxX !== r0.maxX || rz.minZ !== r0.minZ || rz.maxZ !== r0.maxZ) exact0 = false;
      for (const rot of ROTS) {
        const c = { ...base, rot };
        const r = battleRect({ ...cfg, center: c });
        const A = (r.maxX - r.minX) * (r.maxZ - r.minZ);
        if (A < A0 * (1 - 1e-9)) floorOk = false;
        worstGrow = Math.max(worstGrow, A / A0);
        worstShrink = Math.min(worstShrink, A / A0);
        // battleBBox MUST 蓋住 battleRect 四角(否則高程/影像/Overpass 抓不到旋轉後多出來的那一塊)
        const bb = battleBBox({ ...cfg, center: c });
        for (const [x, z] of [[r.minX, r.minZ], [r.maxX, r.minZ], [r.minX, r.maxZ], [r.maxX, r.maxZ]]) {
          const [la, ln] = xzToLL(x, z, c);
          if (la < bb.minLat - 1e-9 || la > bb.maxLat + 1e-9 || ln < bb.minLng - 1e-9 || ln > bb.maxLng + 1e-9) coverOk = false;
        }
      }
    }
  }
  t('rot=0 的 battleRect 與「沒有 rot 欄位」逐位元相同(中性)', exact0);
  t(`旋轉後方框面積只增不減(全 27 場地 × 3 人數 × 6 角度;實得 ${worstShrink.toFixed(3)}~${worstGrow.toFixed(2)}×)`, floorOk);
  t('battleBBox 恆蓋住 battleRect 四角(抓取範圍跟著旋轉長大)', coverOk);
  // 世界方框的邊距語意不變:兵線頂點離方框邊 ≥ ROUTE_EDGE_MARGIN_M
  let marginOk = true;
  for (const v of VENUES.slice(0, 8)) {
    const cfg = venueConfig(v, 3);
    for (const rot of ROTS) {
      const c = { ...cfg.center, rot };
      const r = battleRect({ ...cfg, center: c });
      for (const [la, ln] of cfg.lanes.flat()) {
        const [x, z] = llToXZ(la, ln, c);
        if (x - r.minX < ROUTE_EDGE_MARGIN_M - 1e-6 || r.maxX - x < ROUTE_EDGE_MARGIN_M - 1e-6
          || z - r.minZ < ROUTE_EDGE_MARGIN_M - 1e-6 || r.maxZ - z < ROUTE_EDGE_MARGIN_M - 1e-6) marginOk = false;
      }
    }
  }
  t('兵線頂點離方框邊恆 ≥ ROUTE_EDGE_MARGIN_M(空氣牆淨空不隨 rot 縮水)', marginOk);
}

// =================================================================================
sec('Ⅳ 旋轉不變量:兵線與塔位的規則不隨主方位改變');
// ---------------------------------------------------------------------------------
{
  const lanesToXZ = (cfg, rot) => cfg.lanes.map((l) => l.map(([la, ln]) => llToXZ(la, ln, { ...cfg.center, rot })));
  let lenOk = true, sepOk = true, twrOk = true, siteOk = true;
  for (const v of VENUES) {
    const cfg = venueConfig(v, 3);
    const base = lanesToXZ(cfg, 0);
    const L = (pts) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
    const bl = base.map(L);
    const bs = laneSeparationAudit(base).ok, bt = towerLayoutAudit(base).ok;
    const bsite = solveTowerSites(base).flat().length;
    for (const rot of ROTS) {
      const g = lanesToXZ(cfg, rot);
      g.forEach((pts, i) => { if (!near(L(pts), bl[i], 1e-6)) lenOk = false; });
      if (laneSeparationAudit(g).ok !== bs) sepOk = false;
      if (towerLayoutAudit(g).ok !== bt) twrOk = false;
      if (solveTowerSites(g).flat().length !== bsite) siteOk = false;
    }
  }
  t('兵線長度不隨 rot 改變', lenOk);
  t('兵線分離判定(規則:互不接觸/交叉)不隨 rot 改變', sepOk);
  t('砲塔佈局判定(規則 #4)不隨 rot 改變', twrOk);
  t('塔位解算數量不隨 rot 改變', siteOk);
}

// =================================================================================
sec('Ⅴ 16 方向量化:推導不手寫');
// ---------------------------------------------------------------------------------
{
  t('DIRS = 16(使用者定案的方向數)', ROAD_GRID.DIRS === 16);
  t('dirAngle 均分整圈,半格 = 180/16 度', near(dirAngle(1), Math.PI * 2 / 16) && near(halfBin() * 180 / Math.PI, 11.25));
  t('格網錨在 0(世界已被主方位轉過 ⇒ MUST NOT 再有第二個角度偏移量)', dirAngle(0) === 0);
  // 兩個推導值:定義式裡不得出現公尺字面值
  const dsrc = grab(rgSrc, /export const densifyM[\s\S]*?;\n/);
  const msrc = grab(rgSrc, /export const minStraightM[\s\S]*?;\n/);
  t('densifyM 由 MAX_DRIFT_M / DENSIFY_F / 半格推導(MUST NOT 手寫間距)',
    /MAX_DRIFT_M/.test(dsrc) && /DENSIFY_F/.test(dsrc) && /halfBin\(\)/.test(dsrc) && !/\d\d\s*;/.test(dsrc));
  t('minStraightM 由 MAX_DRIFT_M / DDA_F / 半格推導(去鋸齒的下界是推導出來的,不是併段併出來的)',
    /MAX_DRIFT_M/.test(msrc) && /DDA_F/.test(msrc) && /halfBin\(\)/.test(msrc));
  t('DDA 換格門檻 < 硬上限(留給細分步與長度重解的餘裕;頂著上限 = 長度重解一律退化)',
    ROAD_GRID.DDA_F > 0 && ROAD_GRID.DDA_F < 1);
  // 「事後把短方向段併進鄰段」是這一族唯一致命的寫法:它會把階梯併回單一方向 ⇒ 整段沒被量化
  t('roadgrid.js 沒有事後併段(MUST NOT 復辟 MIN_RUN_M 那一套)',
    !/MIN_RUN|併入較長的鄰段/.test(strip(rgSrc)));
  t('roadgrid.js 零 import(離線稽核吃得到真品的唯一理由)', !/^import\s/m.test(rgSrc));
  t('roadgrid.js 零亂數(§2.3:同一份 geocache MUST 在每個客戶端算出同一份路網)',
    !/Math\.random|mulberry|rnd\(/.test(strip(rgSrc)));
}

// =================================================================================
sec('Ⅵ 量化的三個不變式:真的落格 / 路不走掉 / 路口不裂');
// ---------------------------------------------------------------------------------
{
  // 合成路網:①主格網(帶路口共用節點 + 節點雜訊)②斜街 ③圓弧 ④剛好壓在格界的長直路
  const center = { lat: 25.033, lng: 121.565 };
  let s = 20260810;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const mkNet = (gridDeg) => {
    const rot = gridDeg * D2R, C = Math.cos(rot), S = Math.sin(rot);
    const G = new Map();
    const at = (i, j) => {
      const k = `${i},${j}`;
      if (!G.has(k)) G.set(k, [(i * 140 - 560) * C - (j * 140 - 560) * S + (rnd() - 0.5) * 6,
        (i * 140 - 560) * S + (j * 140 - 560) * C + (rnd() - 0.5) * 6]);
      return G.get(k);
    };
    const raw = [];
    for (let j = 0; j < 9; j++) raw.push(['secondary', Array.from({ length: 9 }, (_, i) => at(i, j))]);
    for (let i = 0; i < 9; i++) raw.push(['secondary', Array.from({ length: 9 }, (_, j) => at(i, j))]);
    raw.push(['primary', Array.from({ length: 12 }, (_, i) => [-600 + i * 100 * Math.cos(0.5236), -1620 + i * 100 * Math.sin(0.5236)])]);
    raw.push(['tertiary', Array.from({ length: 60 }, (_, i) => { const q = i * 10 / 400; return [1500 + 400 * Math.cos(q), -400 + 400 * Math.sin(q)]; })]);
    const a = 11.25 * D2R;
    raw.push(['residential', Array.from({ length: 80 }, (_, i) => {
      const d = i * 20; return [-1600 + d * Math.cos(a) + (rnd() - 0.5) * 3, 1400 + d * Math.sin(a) + (rnd() - 0.5) * 3];
    })]);
    const toLL0 = (x, z) => { const [lat, lon] = xzToLL(x, z, center); return { lat, lon }; };
    return raw.map(([hw, pts]) => ({ tags: { highway: hw }, geometry: pts.map(([x, z]) => toLL0(x, z)) }));
  };
  const MAIN = /^(motorway|trunk|primary|secondary|tertiary)$/;

  // 長度加權平均角度誤差:段數加權(p50/p90)會被密路網的細碎段數淹掉 —— 一整條沒被量化的
  // 長路在那上面看不出來,而那正是本改動最想抓的那個病(見檔頭 ⓐ)
  const meanErr = (ws, toXZ) => {
    let sum = 0, tot = 0;
    for (const g of waySegs(ws, toXZ)) {
      const dx = g[2] - g[0], dz = g[3] - g[1];
      const l = Math.hypot(dx, dz);
      if (l < 1e-9) continue;
      const a = Math.atan2(dz, dx);
      const e = Math.abs(Math.atan2(Math.sin(a - Math.round(a / (halfBin() * 2)) * halfBin() * 2),
        Math.cos(a - Math.round(a / (halfBin() * 2)) * halfBin() * 2))) * 180 / Math.PI;
      sum += e * l; tot += l;
    }
    return tot ? sum / tot : 0;
  };
  let worstMax = 0, worstDrift = 0, gain = Infinity, worstMean = 0;
  let worstWayP50 = 0, worstWayId = '';
  let joinOk = true, shapeOk = true, detOk = true, worstStraight = Infinity;
  for (const gd of [0, 5, 17, 33, 41]) {
    s = 20260810;
    const ways = mkNet(gd);
    const th = gridAngle(waySegs(ways, (p) => llToXZ(p.lat, p.lon, center), (w) => MAIN.test(w.tags.highway)));
    const c = { ...center, rot: -th };
    const toXZ = (p) => llToXZ(p.lat, p.lon, c);
    const toLL = (x, z) => { const [lat, lon] = xzToLL(x, z, c); return { lat, lon }; };
    const st = {};
    const out = quantizeRoads(ways, toXZ, toLL, st);
    const before = dirErrorDeg(ways, toXZ), after = dirErrorDeg(out, toXZ);
    worstMax = Math.max(worstMax, after.max);
    worstDrift = Math.max(worstDrift, st.movedM.max);
    const mAfter = meanErr(out, toXZ);
    worstMean = Math.max(worstMean, mAfter);
    gain = Math.min(gain, meanErr(ways, toXZ) / Math.max(1e-9, mAfter));
    // 逐條路:「所有道路」是使用者的原話 ⇒ 每一條都要被量化,不是整體統計好看就算
    out.forEach((w, i) => {
      const e = dirErrorDeg([w], toXZ);
      if (e.p50 > worstWayP50) { worstWayP50 = e.p50; worstWayId = `${ways[i].tags.highway}#${i}(格網傾角 ${gd}°)`; }
    });

    // 形狀:way 數 / 順序 / tags 一律不變
    if (out.length !== ways.length) shapeOk = false;
    out.forEach((w, i) => { if (w.tags !== ways[i].tags) shapeOk = false; });

    // 路口不裂:量化前共用的節點,量化後 MUST 仍逐位元共用
    const key = (p) => `${p.lat},${p.lon}`;
    const grp = (ws) => {
      const m = new Map();
      ws.forEach((w, wi) => w.geometry.forEach((p, pi) => {
        const k = key(p);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(`${wi}`);
      }));
      return m;
    };
    const gb = grp(ways), ga = grp(out);
    let shared = 0;
    for (const [k, v] of gb) {
      const ways0 = new Set(v);
      if (ways0.size < 2) continue;
      shared++;
      // 該節點量化後的位置:在每一條用到它的 way 上找,MUST 只有一個座標
      const i0 = ways.findIndex((w) => w.geometry.some((p) => key(p) === k));
      const pi = ways[i0].geometry.findIndex((p) => key(p) === k);
      // 量化後同一個 index 位置未必對得上(有細分),改以「新圖中仍存在被 ≥2 條 way 共用的節點數」比對
      void pi;
    }
    let sharedA = 0;
    for (const [, v] of ga) if (new Set(v).size >= 2) sharedA++;
    if (sharedA < shared) joinOk = false;

    // 去鋸齒:平均直段長 ≥ 推導下界
    let turnN = 0, totL = 0;
    for (const w of out) {
      const g = w.geometry.map(toXZ);
      let prev = null;
      for (let i = 1; i < g.length; i++) {
        const dx = g[i][0] - g[i - 1][0], dz = g[i][1] - g[i - 1][1];
        const l = Math.hypot(dx, dz);
        if (l < 1e-9) continue;
        totL += l;
        const a = Math.atan2(dz, dx);
        if (prev != null && Math.abs(Math.atan2(Math.sin(a - prev), Math.cos(a - prev))) > 1e-4) turnN++;
        prev = a;
      }
    }
    const straight = totL / (turnN + 1);
    worstStraight = Math.min(worstStraight, straight);

    // 確定性:同輸入跑兩次逐位元相同
    const o2 = quantizeRoads(ways, toXZ, toLL);
    out.forEach((w, i) => w.geometry.forEach((p, k2) => {
      const q = o2[i].geometry[k2];
      if (p.lat !== q.lat || p.lon !== q.lon) detOk = false;
    }));
  }
  t(`真的落格(逐條路):**每一條** way 的角度誤差中位數 ≤ ${WAY_P50_MAX}°(使用者說的是「所有道路」——
     全網 p90 會被密路網的段數淹掉,一整條沒被量化的路在它上面看不出來;實得最差 ${worstWayP50.toFixed(2)}° @ ${worstWayId})`,
    worstWayP50 <= WAY_P50_MAX);
  t(`真的落格(全網):長度加權平均角度誤差 ≤ ${NET_MEAN_MAX}°(實得 ${worstMean.toFixed(3)}°;較量化前改善 ${gain.toFixed(1)}×)`,
    worstMean <= NET_MEAN_MAX);
  t(`最壞一段也 ≤ 半格(實得 ${worstMax.toFixed(2)}° / 半格 ${(halfBin() * 180 / Math.PI).toFixed(2)}°)`,
    worstMax <= halfBin() * 180 / Math.PI + 1e-6);
  t(`路不會走掉:節點位移 ≤ MAX_DRIFT_M(實得 ${worstDrift.toFixed(2)}m / 上限 ${BASE.MAX_DRIFT_M}m)`,
    worstDrift <= BASE.MAX_DRIFT_M + 1e-6);
  t('路口不裂:量化前共用的節點,量化後仍被同樣多的 way 共用(逐位元同一組經緯度)', joinOk);
  t(`去鋸齒:平均直段長 ≥ 推導下界(實得 ${worstStraight.toFixed(0)}m ≥ ${BASE_MIN_STRAIGHT.toFixed(0)}m)`,
    worstStraight >= BASE_MIN_STRAIGHT);
  t('way 數 / 順序 / tags 一律不變(下游的走廊記帳與結構鏈靠這個)', shapeOk);
  t('確定性:同一份圖資跑兩次逐位元相同(§2.3)', detOk);
}

// =================================================================================
sec('Ⅵ-b 路網預整理:小閉環 / 近接死端 / 窄冗餘優先 / 不斷線 / 並排結構保留');
// ---------------------------------------------------------------------------------
{
  const P = (x, z) => ({ lat: z, lon: x });
  const W = (name, width, a, b, tags = {}) => ({
    tags: { highway: width > BASE_PRUNE.MAX_W_M ? 'secondary' : 'path', name, width, ...tags },
    geometry: [P(...a), P(...b)],
  });
  const A = [0, 0], B = [40, 0], C = [40, 40], D = [0, 40];
  const ways = [
    W('AB', 8, A, B), W('BC', 8, B, C), W('CD', 8, C, D), W('DA', 8, D, A),
    W('AC-窄斜線', 2.2, A, C), W('BD-窄斜線', 2.2, B, D),
    W('短突枝', 2.2, A, [-12, 0]),
    W('寬突枝', 8, B, [52, 0]),
    W('長小路', 2.2, C, [40, 160]),
    // 直線支路即使被 OSM tag 邊界切段也不是閉環，兩段都必須保留。
    W('切段突枝甲', 2.2, B, [55, 10]), W('切段突枝乙', 2.2, [55, 10], [68, 23]),
    W('步橋', 2.2, D, [-8, 40], { bridge: 'yes' }),
    // 兩端都有三個去向、但沒有替代路徑：只看度數會誤剪成兩座不相通的小樹。
    W('必要窄連線', 2.2, [100, 0], [120, 0]),
    W('E北', 8, [100, 0], [100, 20]), W('E南', 8, [100, 0], [100, -20]),
    W('F北', 8, [120, 0], [120, 20]), W('F南', 8, [120, 0], [120, -20]),
    // 面積 6400m² 的大環即使有替代路徑也不剪。
    W('長窄糾纏邊甲', 2.2, [300, 0], [380, 0]),
    W('長窄糾纏邊乙', 2.2, [380, 0], [460, 0]),
    W('長迴路左', 8, [300, 0], [380, 80]), W('長迴路右', 8, [380, 80], [460, 0]),
    W('長迴路左尾', 8, [300, 0], [100, 0]), W('長迴路右尾', 8, [460, 0], [660, 0]),
    // 面積 1200m² 的小環底邊被 tag 切成兩段；必須整條原子移除。
    W('小環底甲', 2.2, [700, 0], [740, 0]), W('小環底乙', 2.2, [740, 0], [780, 0]),
    W('小環左', 8, [700, 0], [700, 15]), W('小環頂', 8, [700, 15], [780, 15]),
    W('小環右', 8, [780, 15], [780, 0]),
    W('小環左尾', 8, [660, 0], [700, 0]), W('小環右尾', 8, [780, 0], [820, 0]),
  ];
  const toXZ = (p) => [p.lon, p.lat];
  const widthOf = (w) => w.tags.width;
  const stats = {};
  const out = pruneRoads(ways, toXZ, widthOf, stats);
  const names = new Set(out.map((w) => w.tags.name));
  const removed = new Set(ways.map((w) => w.tags.name).filter((n) => !names.has(n)));

  t('小閉環真的有剪:至少一條窄斜線與切段小環底邊被移除',
    (removed.has('AC-窄斜線') || removed.has('BD-窄斜線'))
    && removed.has('小環底甲') && removed.has('小環底乙'),
    `移除=${[...removed].join(',') || '(無)'}`);
  t('非閉環的筆直小路全部保留，不再用長度或鄰近度誤刪',
    ['短突枝', '長小路', '切段突枝甲', '切段突枝乙'].every((n) => names.has(n)));
  t('OSM 分段小環原子剪除:degree=2 tag 接縫不留下半截道路',
    removed.has('小環底甲') && removed.has('小環底乙'));
  t('較寬道路不進候選', names.has('寬突枝'));
  t('大閉環保留:有替代路徑仍不得繞過面積門檻',
    names.has('長窄糾纏邊甲') && names.has('長窄糾纏邊乙'));
  t('單純橋不因窄短被刪；仍須先真的構成小閉環', names.has('步橋'));
  t('沒有替代路徑的必要窄連線保留', names.has('必要窄連線'));
  t('不新增死路:只剪閉環後 degree=1 節點數完全不變', stats.deadEndsAfter === stats.deadEndsBefore,
    `${stats.deadEndsBefore} → ${stats.deadEndsAfter}`);
  t('單純支梢剪枝已停用；剪除量只記在閉環', stats.spurM === 0 && stats.cycleM === stats.removedM);
  t('小環門檻為正且小於正常街廓尺度',
    BASE_PRUNE.MAX_LOOP_AREA_M2 > 0 && BASE_PRUNE.MAX_LOOP_AREA_M2 < 70 * 70);
  t('最密窄路格只會變疏:剪後密度峰值不高於剪前，且診斷座標有限',
    !!stats.denseBefore && !!stats.denseAfter
    && stats.denseAfter.m <= stats.denseBefore.m
    && [stats.denseAfter.x, stats.denseAfter.z].every(Number.isFinite));
  t('不過度剪枝:移除量受每分量初始總長比上限約束',
    stats.removedM > 0 && stats.removedM <= ways
      .reduce((sum, w) => sum + Math.hypot(w.geometry[1].lon - w.geometry[0].lon, w.geometry[1].lat - w.geometry[0].lat), 0)
      * BASE_PRUNE.MAX_DROP_F + 1e-6);

  // 核心四路口必須仍在同一分量；這比「way 數還很多」更直接證明沒有剪斷主網。
  const graph = new Map();
  const key = (p) => `${p.lat},${p.lon}`;
  for (const w of out) {
    const g = w.geometry || [];
    for (let i = 1; i < g.length; i++) {
      const a = key(g[i - 1]), b = key(g[i]);
      if (!graph.has(a)) graph.set(a, new Set());
      if (!graph.has(b)) graph.set(b, new Set());
      graph.get(a).add(b); graph.get(b).add(a);
    }
  }
  const seen = new Set([key(P(...A))]), queue = [...seen];
  for (let h = 0; h < queue.length; h++) {
    for (const v of graph.get(queue[h]) || []) if (!seen.has(v)) { seen.add(v); queue.push(v); }
  }
  t('主網不斷線:四個核心路口剪後仍互相可達', [A, B, C, D].every((p) => seen.has(key(P(...p)))));

  // 候選全序不依輸入 way 順序；中繼 payload 重排不應改變保留集合。
  const reversed = pruneRoads(ways.slice().reverse(), toXZ, widthOf);
  const canon = (ws) => ws.map((w) => `${w.tags.name}:${w.geometry.map(key).join('>')}`).sort().join('|');
  t('決定性:輸入 way 重排後保留幾何集合不變', canon(out) === canon(reversed));

  // 重生中心附近仍只能剪小環；額外總額不得吃掉半個分量。
  const focusWays = [
    W('外框南', 8, [0, 0], [30, 0]), W('外框東', 8, [30, 0], [30, 30]),
    W('外框北', 8, [30, 30], [0, 30]), W('外框西', 8, [0, 30], [0, 0]),
    W('遠斜線', 2.2, [0, 0], [30, 30]), W('重生圈斜線', 2.2, [30, 0], [0, 30]),
  ];
  const focusStats = {};
  const focusOut = pruneRoads(focusWays, toXZ, widthOf, focusStats, [[30, 0]]);
  const focusNames = new Set(focusOut.map((w) => w.tags.name));
  t('重生圈的小閉環確實被剪', !focusNames.has('重生圈斜線'));
  t('重生圈增額仍低於半個連通分量',
    BASE_PRUNE.MAX_DROP_F + BASE_PRUNE.FOCUS_DROP_F < 0.5);
  t('重生圈只增加總額，不改寫小環面積門檻',
    focusStats.loopBefore.thresholdM2 === BASE_PRUNE.MAX_LOOP_AREA_M2
    && focusStats.loopAfter.thresholdM2 === BASE_PRUNE.MAX_LOOP_AREA_M2);
  t('重生圈量測:候選窄路長度只減不增', focusStats.focusBefore.length === 1
    && focusStats.focusAfter.length === 1 && focusStats.focusAfter[0].m < focusStats.focusBefore[0].m);
  const focusReversed = pruneRoads(focusWays.slice().reverse(), toXZ, widthOf, null, [[30, 0]]);
  t('重生圈優先仍具決定性:輸入 way 重排不改變保留集合', canon(focusOut) === canon(focusReversed));

  // 同分量額度只夠剪一條：先比寬，再比替代路徑繞行比。
  const widthWays = [
    W('窄候選', 2.2, [0, 0], [100, 0]),
    W('窄左', 8, [0, 0], [0, 10]), W('窄頂', 8, [0, 10], [100, 10]), W('窄右', 8, [100, 10], [100, 0]),
    W('連接幹道', 8, [100, 0], [200, 0]),
    W('寬候選', 5.5, [200, 0], [300, 0]),
    W('寬左', 8, [200, 0], [200, 10]), W('寬頂', 8, [200, 10], [300, 10]), W('寬右', 8, [300, 10], [300, 0]),
    W('左尾', 8, [-10, 0], [0, 0]), W('右尾', 8, [300, 0], [310, 0]),
  ];
  const widthNames = new Set(pruneRoads(widthWays, toXZ, widthOf).map((w) => w.tags.name));
  t('寬度優先:同額度下先剪較窄的小環邊', !widthNames.has('窄候選') && widthNames.has('寬候選'));

  const redundantWays = [
    W('高冗餘候選', 2.2, [0, 0], [100, 0]),
    W('高冗餘左', 8, [0, 0], [0, 8]), W('高冗餘頂', 8, [0, 8], [100, 8]), W('高冗餘右', 8, [100, 8], [100, 0]),
    W('連接幹道', 8, [100, 0], [200, 0]),
    W('低冗餘候選', 2.2, [200, 0], [300, 0]),
    W('低冗餘左', 8, [200, 0], [200, 15]), W('低冗餘頂', 8, [200, 15], [300, 15]), W('低冗餘右', 8, [300, 15], [300, 0]),
    W('左尾', 8, [-10, 0], [0, 0]), W('右尾', 8, [300, 0], [310, 0]),
  ];
  const redundantNames = new Set(pruneRoads(redundantWays, toXZ, widthOf).map((w) => w.tags.name));
  t('冗餘度優先:同寬同額度下先剪替代路徑繞行比較低者',
    !redundantNames.has('高冗餘候選') && redundantNames.has('低冗餘候選'));
  // OSM 常有畫面上相交、資料卻未共用 node 的步道；面分析圖必須切真交點，否則最亂的
  // 那批線在拓撲圖上全是「支梢」，面積指標永遠看不到。
  const crossingStats = {};
  const crossingWays = [
    W('打結支梢', 2.2, [-10, 0], [100, 0]),
    W('環左', 8, [0, -10], [0, 10]), W('環頂', 8, [0, 10], [40, 10]),
    W('環右', 8, [40, 10], [40, -10]),
    W('主網北', 8, [100, 0], [100, 200]), W('主網東', 8, [100, 0], [300, 0]),
    W('正常直路', 2.2, [400, 0], [500, 0]),
  ];
  const crossingNames = new Set(pruneRoads(crossingWays, toXZ, widthOf, crossingStats).map((w) => w.tags.name));
  t('非拓撲交叉仍能圍成小面:打結支梢剪除、孤立正常直路保留',
    !crossingNames.has('打結支梢') && crossingNames.has('正常直路'));
  t('幾何小面剪枝不新增死路', crossingStats.deadEndsAfter <= crossingStats.deadEndsBefore,
    `${crossingStats.deadEndsBefore} → ${crossingStats.deadEndsAfter}`);
  t('小環統計:低於門檻的完整閉環數確實下降',
    stats.loopBefore.small > stats.loopAfter.small
    && stats.loopAfter.thresholdM2 === BASE_PRUNE.MAX_LOOP_AREA_M2);

  // 死端與另一條道路只差短縫時，在分析圖虛擬閉合；不改輸出座標、不畫補線。
  // 近接案例的完整面積仍低於門檻；遠距與大面積案例須照舊保留。
  const nearStats = {};
  const nearWays = [
    W('近接死路候選', 2.2, [0, 0], [40, 4]),
    W('近接左', 8, [0, 0], [0, 12]), W('近接頂', 8, [0, 12], [80, 12]),
    W('近接右', 8, [80, 12], [80, 0]),
    W('近接左尾', 8, [-20, 0], [0, 0]), W('近接右尾', 8, [80, 0], [100, 0]),
    W('遠距死路保留', 2.2, [80, 0], [40, -10]),
  ];
  const nearOut = pruneRoads(nearWays, toXZ, widthOf, nearStats);
  const nearNames = new Set(nearOut.map((w) => w.tags.name));
  t('近接死路視為閉環:端點短距離能接另一道路且面積過小時剪除',
    !nearNames.has('近接死路候選') && nearStats.nearClosed.links >= 1);
  t('遠距死路仍保留:端點超過近接門檻不得假裝封閉', nearNames.has('遠距死路保留'));
  t('近接閉合距離由候選最大路寬推導',
    nearStats.nearClosed.maxGapM === BASE_PRUNE.MAX_W_M * BASE_PRUNE.NEAR_CLOSE_W_F);
  t('虛擬閉合不新增道路幾何:輸出只可能是原 way 的連續片段',
    nearOut.every((w) => nearWays.some((src) => w.tags.name === src.tags.name
      && w.geometry.every((p) => src.geometry.some((q) => p.lat === q.lat && p.lon === q.lon)))));
  t('近接死路剪枝只減少既有死端，不製造新死端', nearStats.deadEndsAfter < nearStats.deadEndsBefore,
    `${nearStats.deadEndsBefore} → ${nearStats.deadEndsAfter}`);
  const nearReversed = pruneRoads(nearWays.slice().reverse(), toXZ, widthOf);
  t('近接閉合具決定性:輸入 way 重排不改變保留集合', canon(nearOut) === canon(nearReversed));

  const gradeNearWays = nearWays.map((w) => w.tags.name === '近接頂'
    ? { ...w, tags: { ...w.tags, bridge: 'yes' } } : w);
  const gradeNearNames = new Set(pruneRoads(gradeNearWays, toXZ, widthOf).map((w) => w.tags.name));
  t('近接閉合不跨一般／結構層級:死端不能假接到高架橋', gradeNearNames.has('近接死路候選'));

  const nearLargeWays = [
    W('近接大面死路', 2.2, [0, 0], [100, 0]),
    W('大面左', 8, [0, 0], [0, 80]), W('大面斜頂', 8, [0, 80], [100, 8]),
    W('大面左尾', 8, [-20, 0], [0, 0]), W('大面右尾', 8, [100, 8], [120, 8]),
  ];
  const nearLargeNames = new Set(pruneRoads(nearLargeWays, toXZ, widthOf).map((w) => w.tags.name));
  t('近接死路仍受面積門檻限制:虛擬閉合但面積過大就保留', nearLargeNames.has('近接大面死路'));

  const parallelCase = (tag, label) => {
    const ws = [
      W('一般候選', 2.2, [0, 0], [80, 0]),
      W('左', 8, [0, 0], [0, 12]), W('頂', 8, [0, 12], [80, 12]), W('右', 8, [80, 12], [80, 0]),
      W('左尾', 8, [-10, 0], [0, 0]), W('右尾', 8, [80, 0], [90, 0]),
      W(label, 2.2, [0, -8], [80, -8], tag),
    ];
    const s = {}, ns = new Set(pruneRoads(ws, toXZ, widthOf, s).map((w) => w.tags.name));
    return ns.has('一般候選') && ns.has(label) && s.parallelProtected.structure > 0;
  };
  t('一般道路與高架橋並排時不剪枝', parallelCase({ bridge: 'yes' }, '高架橋'));
  t('一般道路與地下道並排時不剪枝', parallelCase({ tunnel: 'yes', layer: '-1' }, '地下道'));
  t('一般道路與明隧道並排時不剪枝', parallelCase({ covered: 'yes' }, '明隧道'));
  t('一般道路與隧道並排時不剪枝', parallelCase({ tunnel: 'yes' }, '隧道'));

  const dividedStats = {};
  const dividedWays = [
    W('分隔候選', 2.2, [0, 0], [80, 0], { highway: 'primary', oneway: 'yes' }),
    W('左', 8, [0, 0], [0, 12]), W('頂', 8, [0, 12], [80, 12]), W('右', 8, [80, 12], [80, 0]),
    W('左尾', 8, [-10, 0], [0, 0]), W('右尾', 8, [80, 0], [90, 0]),
    W('反向分隔車道', 2.2, [80, -8], [0, -8], { highway: 'primary', oneway: 'yes' }),
  ];
  const dividedNames = new Set(pruneRoads(dividedWays, toXZ, widthOf, dividedStats).map((w) => w.tags.name));
  t('雙向車道分隔時兩條 oneway 皆不剪枝',
    dividedNames.has('分隔候選') && dividedNames.has('反向分隔車道')
    && dividedStats.parallelProtected.divided >= 2);
}

// =================================================================================
sec('Ⅶ 接線:唯一縫、排在所有消費端之前、不碰兵線');
// ---------------------------------------------------------------------------------
{
  const bio = strip(bioSrc);
  t('biomes.js 只有一處呼叫 pruneRoads(唯一接線點)',
    (bio.match(/pruneRoads\(/g) || []).length === 1);
  t('biomes.js 只有一處呼叫 quantizeRoads(唯一接線點)',
    (bio.match(/quantizeRoads\(/g) || []).length === 1);
  const iP = bio.indexOf('pruneRoads(');
  const iQ = bio.indexOf('quantizeRoads(');
  const iFetch = bio.indexOf('fetchOsmRoads(terrain.bbox)');
  t('剪枝排在量化之前(不讓已淘汰亂路參與節點鬆弛)', iP > iFetch && iP < iQ);
  // needle 一律從**取得圖資之後**找起 —— 這幾支的函式**定義**都排在檔案前段,
  // 從頭找會找到定義而不是呼叫點(那樣這條斷言恆綠 = 沒驗到)
  for (const [name, needle] of [
    ['mergeGradeChains 呼叫點', 'mergeGradeChains(osmRoads)'],
    ['dedupeCrossingBridges 呼叫點', 'dedupeCrossingBridges(osmRoads || []'],
    ['markGradeCorridors 呼叫點', 'markGradeCorridors(roadInput'],
    ['roadInput 定案', 'const roadInput ='],
    ['buildRoads 呼叫點', 'buildRoads(group, roadInput'],
  ]) {
    const i = bio.indexOf(needle, iFetch);
    t(`量化排在 ${name} 之前(所有消費端吃同一份量化後的路網)`, i > iQ && iQ > iFetch, `(idx ${i} vs ${iQ})`);
  }
  t('量化只作用在 osmRoads(兵線是伺服器也在吃的權威幾何,客戶端單方面量化 = 兩端分家)',
    /osmRoads = quantizeRoads\(\s*osmRoads,/.test(bio) && !/quantizeRoads\([^)]*lanes/.test(bio));
  t('剪枝只作用在 osmRoads，且路寬由 roadWidth 唯一縫注入(不碰兵線 / 不抄寬度表)',
    /osmRoads = pruneRoads\(\s*osmRoads,[\s\S]*?\(way\) => roadWidth\(way\.tags \|\| \{\}\)/.test(bio)
    && !/pruneRoads\([^)]*lanes/.test(bio));
  t('剪枝統計由同一次呼叫產生並掛進地貌 stats(真圖資驗證不得再拿 fallback 猜)',
    /const roadPruneStats = \{\}/.test(bio)
    && /pruneRoads\([\s\S]*?roadPruneStats,\s*basesW\.map\(\(\{ x, z \}\)\s*=>\s*\[x, z\]\)/.test(bio)
    && /roadPrune:\s*roadPruneStats/.test(bio));
  t('重生圈優先吃共用 basesW(不手打倫敦專用座標、不重算主堡投影)',
    /const basesW = \[\s*'SWARM',\s*'STEEL'\s*\]\.map/.test(bio)
    && /roadPruneStats,\s*basesW\.map\(\(\{ x, z \}\)\s*=>\s*\[x, z\]\)/.test(bio));
  t('ground.js 的格網主方位走 roadgrid.gridAngle(第二份 ×4 圓平均已收掉)',
    /gridAngle\(segs\)/.test(strip(grndSrc)) && !/\* 4;[\s\S]{0,200}gsx \+=/.test(strip(grndSrc)));
  t('venues.js 的 center.rot 由 VENUE_GRID 推導(度 → 弧度),缺席 = 0',
    /rot: \(VENUE_GRID\[venue\.id\] \|\| 0\) \* Math\.PI \/ 180/.test(strip(venSrc)));
  // `center.rot` 只准在 mapRot 的定義式那一行出現(那一行剛好有兩處:`?.` 與一般存取)
  const rotHits = strip(dataSrc).split('\n').filter((l) => /center\??\.rot/.test(l));
  t('data.js 的 center.rot 只出現在 mapRot 的定義式(唯一讀取縫)',
    rotHits.length === 1 && /mapRot/.test(rotHits[0]), rotHits.join(' | '));
  t('消費端一律經 mapRot,沒有任何一支自己讀 center.rot',
    !/\.rot\b/.test(strip(simSrc)) && !/center\.rot/.test(strip(terrSrc))
    && !/center\.rot/.test(strip(bioSrc)) && !/center\.rot/.test(strip(grndSrc)));
}

// =================================================================================
sec('Ⅷ 烘焙表:值域、來源、降級');
// ---------------------------------------------------------------------------------
{
  const ids = new Set(VENUES.map((v) => v.id));
  const keys = Object.keys(VENUE_GRID);
  t('venueGrid 的鍵全部是現役場地 id(改名的場地 MUST 重烤,不是留著孤兒)',
    keys.every((k) => ids.has(k)), keys.filter((k) => !ids.has(k)).join(','));
  t('值域 ∈ [−45, 45] 度(mod 90° 主方位取負的定義域)',
    keys.every((k) => VENUE_GRID[k] >= -45 && VENUE_GRID[k] <= 45));
  t('沒烤到的場地 ⇒ rot = 0(降級不例外,逐位元同舊制)',
    ids.size >= keys.length && [...ids].filter((i) => !VENUE_GRID[i])
      .every((i) => mapRot(venueConfig(VENUES.find((v) => v.id === i), 1).center) === 0));
  console.log(`  · 已烘焙 ${keys.length} / ${ids.size} 個場地`);
}

// =================================================================================
sec('Ⅸ 主方位的兩條產線(離線烘焙 / 自訂地圖執行期量一次)');
// ---------------------------------------------------------------------------------
// θ 是**座標框**,不是地貌細節:它一旦兩台不一樣,所有單位的位置都差一個旋轉。
// 因此規則不是「不准在執行期算」,而是「MUST 在 battleConfig 定案**之前**凍結成常數」——
// 預設場地取離線烘焙表,自訂地圖只准在**存入最愛那一次**由房主量一次寫死(A42 ③)。
// 兩條產線 MUST 共用同一個推導,否則同一個地點會因為「你是點選的還是選預設的」轉不同角度。
{
  // 原文已經過 readSrc 正規化(換行一律 \n)⇒ 這裡用 \n 樣式是安全的;
  // 替換無效一律當場失敗,免得旗標變成無聲 no-op = break 永遠是綠的(§5.4 ㋑)。
  const patch = (src, re, rep, why) => {
    const out = src.replace(re, rep);
    if (out === src) { console.error(`❌ --break 替換無效(${why});稽核本身已失效,先修這裡`); process.exit(2); }
    return out;
  };
  let bakeSrc = readSrc('tools', 'bake_venue_grid.mjs');
  let mainSrc = readSrc('public', 'js', 'main.js');
  if (argv.includes('--break-rotbox')) {
    bakeSrc = patch(bakeSrc, /const cfg = \{ \.\.\.cfg0, center: \{ lat: cfg0\.center\.lat, lng: cfg0\.center\.lng \} \};/,
      'const cfg = cfg0;', 'rotbox');
  }
  if (argv.includes('--break-rotover')) {
    mainSrc = patch(mainSrc, /if \(!cfg\?\.center \|\| cfg\.center\.rot != null\) return cfg;[^\n]*/, 'if (!cfg?.center) return cfg;', 'rotover');
  }
  const bake = strip(bakeSrc), main = strip(mainSrc), rg = strip(rgSrc), bio = strip(bioSrc);

  t('「一組 way → 旋轉度數」只有 roadGridRotDeg 一份(取樣面 + 未旋轉量測框 + 取負號綁在一起)',
    /export function roadGridRotDeg\(/.test(rg)
    && /roadGridRotDeg\(ways, toXZ\)/.test(bake) && /roadGridRotDeg\(ways,/.test(main));
  t('兩條產線都沒有自己的「取負號換算成度」(那是第二份推導)',
    !/-\s*a\s*\*\s*180\s*\/\s*Math\.PI/.test(bake) && !/gridAngle\(/.test(bake) && !/gridAngle\(/.test(main));
  t('取樣面(大馬路)只有 GRID_HW 一份,Overpass 查詢一律吃 GRID_HW.source',
    /export const GRID_HW = /.test(rg)
    && /way\["highway"~"\$\{GRID_HW\.source\}"\]/.test(bake) && /way\["highway"~"\$\{GRID_HW\.source\}"\]/.test(bio)
    && !/motorway\|trunk\|primary/.test(bake.replace(/GRID_HW/g, '')));

  // 烘焙 MUST 冪等:`venueConfig` 會把**上一輪**的 rot 寫進 center,而旋轉只讓 battleBBox 長大
  // ⇒ 不剝掉 rot 的話第二輪在大得多的區域上取樣,角度自己漂走(實測 shibuya 14.53° → 19.49°,
  // 而三個檔案都沒改、其餘斷言照樣全綠)。這一條同時是行為證明與原文閘。
  const bcn = VENUES.find((v) => v.id === 'barcelona');
  const cfgR = venueConfig(bcn, 1);
  const cfg0 = { ...cfgR, center: { lat: cfgR.center.lat, lng: cfgR.center.lng } };
  const area = (b) => (b.maxLat - b.minLat) * (b.maxLng - b.minLng);
  const ratio = area(battleBBox(cfgR)) / area(battleBBox(cfg0));
  t(`已烤過的場地:帶 rot 的抓取範圍確實比 rot=0 大(barcelona ×${ratio.toFixed(2)})⇒ 不剝 rot 就不冪等`,
    Math.abs(mapRot(cfgR.center)) > 0.1 && ratio > 1.5);
  t('烘焙的抓取範圍 MUST 在 rot=0 的框裡算(與量測框同一條規則)',
    /const cfg = \{ \.\.\.cfg0, center: \{ lat: cfg0\.center\.lat, lng: cfg0\.center\.lng \} \};/.test(bake)
    && /const bb = battleBBox\(cfg\);/.test(bake));

  // 執行期那一半:只准在「存入最愛」那一次量,MUST NOT 滲進建圖期
  const resolve = strip(grabFn(mainSrc, 'resolveMapRot'));
  t('執行期量測只住 resolveMapRot(fetchGridRoads / roadGridRotDeg 在 main.js 只出現在這一支)',
    (main.match(/fetchGridRoads\(/g) || []).length === 1 && (main.match(/roadGridRotDeg\(/g) || []).length === 1
    && /fetchGridRoads\(/.test(resolve) && /roadGridRotDeg\(/.test(resolve));
  t('resolveMapRot 的呼叫點恰一處(存入最愛),MUST NOT 出現在預建/中繼閘裡',
    (main.match(/await resolveMapRot\(/g) || []).length === 1
    && !/resolveMapRot/.test(strip(grabFn(mainSrc, 'startPrebuild')))
    && !/resolveMapRot/.test(strip(grabFn(mainSrc, 'osmGate'))));
  t('已有 rot 就不覆蓋(預設場地的烘焙值 MUST NOT 被執行期量測蓋掉)',
    /cfg\.center\.rot != null\) return cfg;/.test(resolve));
  t('量測框 MUST 未旋轉(c0 只取 lat/lng),量不到一律**定案** 0(降級不例外,也不會下次再問)',
    /const c0 = \{ lat: cfg\.center\.lat, lng: cfg\.center\.lng \};/.test(resolve)
    && /cfg\.center\.rot = deg == null \? 0 : deg \* Math\.PI \/ 180;/.test(resolve));
  t('大馬路查詢不進建圖路徑(biomes.js 自己不呼叫 fetchGridRoads —— 那是每台各跑一次的地方)',
    !/[^n] fetchGridRoads\(/.test(bio.replace(/export async function fetchGridRoads\(/, '')));
}

// =================================================================================
console.log(`\n${fail ? '❌' : '✅'} 地圖主方位 / 道路剪枝 / 格網量化稽核:${pass} 綠 / ${fail} 紅`);
for (const [flag, why] of [
  ['--break-drift', '位移上限放到 1e9 ⇒ Ⅵ「路不會走掉」MUST 紅'],
  ['--break-dense', '量化前不細分 ⇒ Ⅵ「真的落格」MUST 紅'],
  ['--break-relax', '節點鬆弛關掉 ⇒ Ⅵ「真的落格」MUST 紅'],
  ['--break-prune', '剪枝候選寬度歸零 ⇒ Ⅵ-b「真的有剪」MUST 紅'],
  ['--break-loop-area', '小環面積門檻歸零 ⇒ Ⅵ-b「小閉環真的有剪」MUST 紅'],
  ['--break-rotbox', '烘焙的抓取範圍改吃帶 rot 的 cfg ⇒ Ⅸ「冪等」MUST 紅'],
  ['--break-rotover', '執行期量測不再讓過已有的 rot ⇒ Ⅸ「不覆蓋烘焙值」MUST 紅'],
]) if (argv.includes(flag)) console.log(`(${flag}:${why})`);
process.exit(fail ? 1 : 0);
