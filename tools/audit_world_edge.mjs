// ============ 世界邊界(障礙環型錄 + 最小緩衝裙) 稽核 ============
// 用途:改 `data.js` 的 `WORLD_EDGE`/`edgeWallInsetM`/`heroTallestH`/`edgeWallHM`/`edgeWallDeepM`/
// `edgeBufferM`、`edgewall.js` 的型錄與規劃器、`biomes.js` 的 `buildEdgeWall`、`placeBoundary`
// 的帶寬、`buildRoadBlocks` 的內縮、散布內縮 `inb`、`terrain.js` 的外緣裙或 `game.js` 的邊界
// 夾制之後跑。舊 `buildBufferProps` / `buildBackdrop` 只留相容 helper，正式建圖不得呼叫。
//
// 使用者定案兩輪:
//   2026-08-10「邊界加入不可越過的障礙,會再延伸可視距離但不可進入的緩衝空間」
//   2026-08-11「邊界牆使用城牆/連排民房/河堤/海堤/軍工級路障/土石流/懸崖峭壁/山崩地/消波塊/
//              倒塌神木/倒塌摩天樓/倒塌高架橋或跨海大橋/停駛的列車/連排大貨車/連排貨輪等等,
//              地貌切換或太長的時候,會隨機更換符合地貌與水陸域的牆。邊界延伸不可進入的緩衝
//              空間也要貼地貌拼圖,並加入少許 3D 物件。視線邊界的空氣牆貼上假山/假海/假森林/
//              假城市(視陸域或水域而定)。」
//              追加:「也要考量坡度,太陡的時候只使用懸崖峭壁/土石流/山崩這類自然景觀,
//              中等坡度可以再加上倒木/長城」
//   2026-08-30「依水域/裸露地/綠地/市區/沼澤加入大型設施；風機轉速正比風量，浮動物隨浪起伏」
//   2026-08-31「緩衝大幅縮減到只容納障礙；舊外圈假景收入障礙；起伏處大幅提高自然障礙機率；
//              假山與懸崖共用四季變化」
//
// 拆成可量測的不變式,本稽核逐條釘死:
//   Ⅰ 推導不手寫 —— 環高下界 ← 最高機體全高、深型厚度 ← 基準厚、緩衝深度 ← 最深障礙。
//   Ⅱ 「不可越過」是**結構保證**不是校準 —— 以**真品原文**的 `buildEdgeWall` 跑合成地形,
//       驗環上**沒有縫**(相鄰段的區間互相咬住,聯集覆蓋整條邊),而且**逐款厚度不同也照樣成立**
//       (內面恆貼夾制線,厚度往圖界方向長)。
//   Ⅲ 演出 ⊆ 碰撞盒 —— 以帶真矩陣運算的 THREE 樁跑真品原文,把**每一顆零件**的世界 AABB
//       逐件比對登記的有向盒(A30 / 原則 4:看到多粗 = 撞到多粗 = 打到多粗);縱向尤其 ——
//       視覺高過碰撞盒的話,從上方斜射進緩衝空間的彈道會穿過看得見的船樓而伺服器毫無所悉。
//       環頂刻意不可站立(掛 bld/std 就變成「跳上牆沿著邊界跑」)。
//   Ⅳ 單一縫 + 順序 —— 內縮量只有 `edgeWallInsetM()` 一份;環 MUST 是 `blockers` 的第一批
//       (`main.js` 的 occ 上傳是 `slice(0, LOS.MAX_OCC)`,排尾端會被密集市區擠掉)。
//   Ⅴ 緩衝空間 —— 深度推導、與地形逐點水密、共用地形材質、**地貌拼圖走鏡射平鋪**、
//       外推高度對外只有 `bufferHeightAt` 一份。
//   Ⅵ 純表現層 —— 裙 / 布景 / 背景都不進 blockers/occ/heights,伺服器一無所知(原則 4)。
//   Ⅶ 型錄與切分 —— 15 款齊全、水陸域分流、**坡度分級**(陡 = 只有自然景觀 / 中 = 再加倒木與
//       長城 / 緩 = 全部;門檻錨在 `SLOPE.EASE_DEG` 與 `BLOCK_DEG`)、每一款收得進自己宣告的
//       盒子、內面蓋得滿、「地貌 / 水陸域 / 坡度級改變 或 太長」的切分規則都真的會切、
//       短 run 併回去時取**較陡**的那一級、零共享亂數、決定性。
//   Ⅷ 緩衝布景與視線邊界背景 —— 只擺在地形範圍之外、四種背景各對應陸/水域、高度吃
//       `objHeightMax()` 同一個天花板、零共享亂數、決定性、**逐零件落地不懸空**(2026-08-12)。
//   Ⅸ 邊界山脈雪線高度與山頂積雪接合 —— MOUNTAIN_SNOWLINE 四季階梯、夏季無雪、冬季覆雪最大、
//       雪錐斜率嚴格等比貼合山稜、頂點重合、無外擴懸空(2026-08-29)。
//
// 跑法:`node tools/audit_world_edge.mjs`(不需伺服器/瀏覽器/網路)
//       反向驗證:`--break-lap`          段長重疊係數 < 1 ⇒ 環上出現縫 ⇒ Ⅱ 紅
//                 `--break-buffer`       緩衝深度砍半 ⇒ 外緣落進地平線之內 ⇒ Ⅰ・Ⅴ 紅
//                 `--break-fit`          往型錄塞一件頂出盒子的零件 ⇒ Ⅲ・Ⅶ 紅
//                 `--break-face`         把貼著內面的實體零件抽掉 ⇒ Ⅶ 紅(撞得到卻看得穿)
//                 `--break-run`          拿掉「太長就換一款」那一條 ⇒ Ⅶ 紅
//                 `--break-slope`        把每一款都改成三級都站得住 ⇒ Ⅶ 紅(崖面上會擺出貨櫃車)
//                 `--break-land`         關掉逐零件落地 ⇒ Ⅷ 紅(斜坡上整段布景/背景浮在半空)
//                 `--break-boxh`         盒高改回逐款一個值 ⇒ Ⅲ 紅(素牆頂上撞得到卻看不見)
//                 `--break-snow-summer`  夏季出現覆雪 ⇒ Ⅸ 紅(夏天無雪契約破壞)
//                 `--break-snow-slope`   雪錐斜率失真外突 ⇒ Ⅸ 紅(山頂雪錐外擴懸空)
//                 `--break-wet`          拔掉沼澤分類 ⇒ Ⅶ 紅(wet 型錄成為死資料)
//                 `--break-motion`       風機轉速拔掉風量倍率 ⇒ Ⅶ 紅
//                 `--break-facility-support` 往陸域光電塞回整段底座 ⇒ Ⅶ 紅
//                 `--break-redraw`       抽掉本輪邊界重繪辨識零件 ⇒ Ⅶ 紅
//                 `--break-facility-gap`  把非連續大型設施的透明縫補滿 ⇒ Ⅶ 紅
//                 `--break-facility-mix`  關掉同類設施逐節穿插 ⇒ Ⅶ 紅
//                 `--break-shared-catalog` 抽掉獨立物件分類 ⇒ Ⅶ 紅
//                 `--break-glass`         抽掉建築玻璃與透明批次 ⇒ Ⅲ・Ⅶ 紅
// 讀原文走 `audit_src.mjs` 單一縫(含換行正規化 —— 逐行剝註解在 CRLF 工作區會靜默失效)。
import { readSrc, grabFn, grabBlock } from './audit_src.mjs';
import {
  WORLD_EDGE, edgeWallInsetM, heroTallestH, edgeWallHM, edgeWallDeepM, edgeBufferM, mapArg,
  objHeightMax, curveHorizonM, curveMaxEdgeM, CHARACTERS, charKind, heroTargetH, xzToLL, WATER,
  SLOPE, slopeDeg,
} from '../public/js/data.js';
import * as EW from '../public/js/edgewall.js';

const BREAK_FIT = process.argv.includes('--break-fit');
const BREAK_FACE = process.argv.includes('--break-face');
const BREAK_RUN = process.argv.includes('--break-run');
const BREAK_BOXH = process.argv.includes('--break-boxh');
const BREAK_LAND = process.argv.includes('--break-land');   // 逐零件落地關掉 ⇒ 斜坡上整段浮起來
const BREAK_SNOW_SUMMER = process.argv.includes('--break-snow-summer');
const BREAK_SNOW_SLOPE = process.argv.includes('--break-snow-slope');
const BREAK_WET = process.argv.includes('--break-wet');
const BREAK_MOTION = process.argv.includes('--break-motion');
const BREAK_FACILITY_SUPPORT = process.argv.includes('--break-facility-support');
const BREAK_REDRAW = process.argv.includes('--break-redraw');
const BREAK_FACILITY_GAP = process.argv.includes('--break-facility-gap');
const BREAK_FACILITY_MIX = process.argv.includes('--break-facility-mix');
const BREAK_SHARED_CATALOG = process.argv.includes('--break-shared-catalog');
const BREAK_GLASS = process.argv.includes('--break-glass');
if (BREAK_SNOW_SUMMER) EW.MOUNTAIN_SNOWLINE.summer = 0.5;
if (process.argv.includes('--break-rock-season')) {
  for (const s of Object.keys(EW.ROCK_SEASON_TINT)) EW.ROCK_SEASON_TINT[s] = 0xffffff;
}
if (process.argv.includes('--break-bias')) {
  for (const k of ['cliff', 'rockery', 'giantforest', 'fallentree']) EW.WALL_KINDS[k].slopeBias = {};
}
// 坡度分級失效:把每一款都改成「三級都站得住」⇒ 崖面上會擺出貨櫃車 / 連排民房
if (process.argv.includes('--break-slope')) {
  for (const k of Object.values(EW.WALL_KINDS)) k.slope = 'steep';
}
if (process.argv.includes('--break-lap')) WORLD_EDGE.SEG_LAP_F = 0.8;
if (process.argv.includes('--break-buffer')) WORLD_EDGE.BUFFER_F *= 0.5;
if (BREAK_RUN) EW.EDGE_WALL.RUN_MAX_M = 1e9;

// 反向驗證的注入點:一律包在 `wallParts` / `backdropParts` **外面**(型錄本身不動)⇒ 斷言的期望值不隨
// `--break-*` 改變(㋑:期望值跟著 break 走的話,break 永遠是綠的)
const wallParts = (kind, o) => {
  let parts = EW.wallParts(kind, o);
  if (BREAK_FIT) parts.push({ g: ['box', o.len * 1.4, 2, 2], c: 0x999999, p: [0, 1, 0] });
  if (BREAK_FACILITY_SUPPORT && kind === 'solarfield') {
    parts.push({ g: ['box', o.len, 2, o.depth], c: 0x777777, p: [0, 1, 0] });
  }
  if (BREAK_REDRAW) {
    const removed = {
      cliff: ['rock-strata', 'embedded-boulder', 'embedded-deadwood'],
      landslide: ['soil-ridge', 'landslide-rock', 'landslide-deadwood', 'dust'],
      debris: ['debris-rock', 'debris-deadwood'],
      mine: ['mine-bench', 'ore-pile', 'mine-machine-arm', 'dust'],
      oilfield: ['derrick-leg', 'oil-machine', 'smoke'],
      deeprig: ['pontoon', 'offshore-derrick-leg', 'offshore-oil-machine', 'smoke'],
      strandedship: ['bow', 'stern', 'keel', 'bridge', 'bridge-window', 'funnel', 'mast', 'lifeboat'],
      factory: ['chimney', 'smoke'],
      powerplant: ['chimney', 'smoke', 'cooling-tower'],
    };
    if (kind === 'tetrapod') parts = parts.filter((p) => p.role !== 'breakwater-core' || p.layer === 0);
    else if (removed[kind]) parts = parts.filter((p) => !removed[kind].includes(p.role));
  }
  if (BREAK_FACILITY_GAP && EW.WALL_KINDS[kind]?.separated) {
    parts.push({
      g: ['box', o.len, Math.min(o.h, edgeWallHM()), EW.EDGE_WALL.FACE_T * 0.5], c: 0x777777,
      p: [0, Math.min(o.h, edgeWallHM()) / 2, o.depth / 2 - EW.EDGE_WALL.FACE_T * 0.25], role: 'forbidden-gap-fill',
    });
  }
  if (BREAK_FACE) return parts.filter((p) => EW.partBox(p).z1 < o.depth / 2 - EW.EDGE_WALL.FACE_T);
  if (BREAK_GLASS) parts = parts.map(({ mat, ...part }) => part);
  return parts;
};
const planWallKinds = (run, segs, prevKind = null) => (
  BREAK_FACILITY_MIX
    ? Array.from({ length: run.i1 - run.i0 }, () => run.kind)
    : EW.planWallKinds(run, segs, prevKind));

const backdropParts = (kind, o) => {
  const parts = EW.backdropParts(kind, o);
  if (BREAK_SNOW_SLOPE && kind === 'mountain') {
    for (const p of parts) {
      if (p.c === 0xd8dee4 && p.g?.[0] === 'cone') {
        p.g[1] = p.g[1] * 2.5; // 破壞雪錐半徑使其外突
      }
    }
  }
  return parts;
};

const dataSrc = readSrc('public', 'js', 'data.js');
const gameSrc = readSrc('public', 'js', 'game.js');
const bioSrc = readSrc('public', 'js', 'biomes.js');
const terrSrc = readSrc('public', 'js', 'terrain.js');
const ewSrc = readSrc('public', 'js', 'edgewall.js');
const toonSrc = readSrc('public', 'js', 'toon.js');
const simSrc = readSrc('server', 'sim.js');

const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
/** 只數執行原文,且跳過 import 區塊(import 也提得到同一個名字) */
const codeOf = (s) => strip(s).split("from './data.js';").slice(-1)[0];
const gameCode = codeOf(gameSrc), bioCode = codeOf(bioSrc), terrCode = codeOf(terrSrc);

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const count = (s, re) => (s.match(re) || []).length;
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

// ---- 真品原文的 `buildEdgeWall` / `buildBufferProps` / `buildBackdrop`(住在 import three 的
//      檔案裡,Node 端 import 不了整支;抄一份擺位公式進稽核則永遠會通過)----
// THREE 樁帶**真的 4×4 矩陣運算**:幾何只記 AABB 的八個角,`applyMatrix4` 逐角轉換 ⇒ 每一顆
// 零件的**世界 AABB** 算得出來,Ⅲ 才驗得到「演出真的收在碰撞盒裡」而不是只驗字串。
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  // 逐零件落地要拿「這顆零件在世界的水平位置」—— 走的是**同一個矩陣**(不是另寫一份 sin/cos)
  applyMatrix4(m) { const [x, y, z] = m.apply([this.x, this.y, this.z]); return this.set(x, y, z); }
}
class Eul { constructor() { this.set(0, 0, 0); } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
class Quat {
  constructor() { this.x = 0; this.y = 0; this.z = 0; this.w = 1; }
  setFromEuler(e) {   // three 的 Euler 預設序 'XYZ'
    const c1 = Math.cos(e.x / 2), c2 = Math.cos(e.y / 2), c3 = Math.cos(e.z / 2);
    const s1 = Math.sin(e.x / 2), s2 = Math.sin(e.y / 2), s3 = Math.sin(e.z / 2);
    this.x = s1 * c2 * c3 + c1 * s2 * s3;
    this.y = c1 * s2 * c3 - s1 * c2 * s3;
    this.z = c1 * c2 * s3 + s1 * s2 * c3;
    this.w = c1 * c2 * c3 - s1 * s2 * s3;
    return this;
  }
}
class Mat4 {
  constructor() { this.e = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  compose(p, q, s) {   // 逐行照抄 three 的 Matrix4.compose(column-major)
    const te = this.e;
    const x = q.x, y = q.y, z = q.z, w = q.w;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    te[0] = (1 - (yy + zz)) * s.x; te[1] = (xy + wz) * s.x; te[2] = (xz - wy) * s.x; te[3] = 0;
    te[4] = (xy - wz) * s.y; te[5] = (1 - (xx + zz)) * s.y; te[6] = (yz + wx) * s.y; te[7] = 0;
    te[8] = (xz + wy) * s.z; te[9] = (yz - wx) * s.z; te[10] = (1 - (xx + yy)) * s.z; te[11] = 0;
    te[12] = p.x; te[13] = p.y; te[14] = p.z; te[15] = 1;
    return this;
  }
  apply(v) {
    const e = this.e;
    return [e[0] * v[0] + e[4] * v[1] + e[8] * v[2] + e[12],
      e[1] * v[0] + e[5] * v[1] + e[9] * v[2] + e[13],
      e[2] * v[0] + e[6] * v[1] + e[10] * v[2] + e[14]];
  }
}
class Geo {
  constructor(hx, hy, hz) {
    this.pts = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) this.pts.push([sx * hx, sy * hy, sz * hz]);
  }
  applyMatrix4(m) { this.pts = this.pts.map((p) => m.apply(p)); return this; }
  box() {
    const f = (i, fn) => fn(...this.pts.map((p) => p[i]));
    return { x0: f(0, Math.min), x1: f(0, Math.max), y0: f(1, Math.min), y1: f(1, Math.max), z0: f(2, Math.min), z1: f(2, Math.max) };
  }
}
const emitted = [];   // 每一次 flush 的零件世界 AABB(Ⅲ / Ⅷ 共用)
const THREE_STUB = {
  Matrix4: Mat4, Quaternion: Quat, Euler: Eul, Vector3: V3,
  BoxGeometry: class extends Geo { constructor(a, b, c) { super(a / 2, b / 2, c / 2); } },
  CylinderGeometry: class extends Geo { constructor(a, b, c) { super(Math.max(a, b), c / 2, Math.max(a, b)); } },
  ConeGeometry: class extends Geo { constructor(a, b) { super(a, b / 2, a); } },
  IcosahedronGeometry: class extends Geo { constructor(a) { super(a, a, a); } },
  Mesh: class { constructor(g, m) { this.g = g; this.m = m; } },
};
const mergeGeosStub = (geos, cols) => {
  emitted.push(...geos.map((g) => g.box()));
  return { geos: geos.length, cols: cols ? cols.length : 0 };
};

const classifyImg = new Function(`${grabFn(bioSrc, 'classifyImg')} return classifyImg;`)();
const terrainEnvCode0 = new Function('WATER', `${grabFn(bioSrc, 'terrainEnvCode')} return terrainEnvCode;`)(WATER);
const terrainEnvCode = BREAK_WET ? ((terrain, x, z) => terrainEnvCode0(terrain, x, z) === 2 ? 0 : terrainEnvCode0(terrain, x, z)) : terrainEnvCode0;
// `--break-boxh`:把「盒高逐段實測」改回「逐款一個值」⇒ 素牆那幾節的頂上多出一截撞得到卻
// 看不見的空氣。替換 MUST 當場驗有沒有生效(㋑:字面替換在 CRLF 工作區會是無聲 no-op)
let wallSrc = grabFn(bioSrc, 'buildEdgeWall');
if (BREAK_BOXH) {
  const before = wallSrc;
  wallSrc = wallSrc.replace(/const kh = Math[.]max\(WH, top\);/, 'const kh = Math.max(WH, kh0);');
  if (wallSrc === before) { console.log('x --break-boxh 的字面替換沒有生效(原文改了?)'); process.exit(1); }
}
let HELPERS = bioSrc.slice(bioSrc.indexOf('const PLINTH_C = '), bioSrc.indexOf('// ---- 緩衝空間的 3D 物件'));
// `--break-land`:把「逐零件落地」關掉 ⇒ 整段布景/背景回到「拿段心一個高度擺全部零件」,
// 坡上那一端浮在半空、坡下那一端埋進土裡
if (BREAK_LAND) {
  const before = HELPERS;
  HELPERS = HELPERS.replace(/if \(groundY\) \{/, 'if (false) {');
  if (HELPERS === before) { console.log('x --break-land 的字面替換沒有生效(原文改了?)'); process.exit(1); }
}
// `over` = 覆寫注入的規劃器/零件表(Ⅷ 的逐零件落地量測靠它把「這一顆零件是誰的第幾件」錄下來,
// 而不是在稽核裡抄一份擺位公式)
const mkWall = (extra = '', over = {}) => new Function(
  'THREE', 'envMat', 'mergeGeos', 'WORLD_EDGE', 'edgeWallInsetM', 'edgeWallHM', 'WATER',
  'SLOPE', 'slopeDeg', 'wallSlopeTier',
  'classifyImg', 'terrainEnvCode', 'planWallRuns', 'planWallKinds', 'WALL_KINDS', 'wallParts', 'wallVariant', 'edgeSeed',
  'planBufferProps', 'propParts', 'planBackdrop', 'backdropParts', 'BACKDROP_KINDS',
  'EDGE_WALL', 'edgeBufferM', 'objHeightMax', 'lowPower', 'partBox',
  `${HELPERS}\n${wallSrc}\n${grabFn(bioSrc, 'buildBufferProps')}\n${grabFn(bioSrc, 'buildBackdrop')}\n${extra}
   return { buildEdgeWall, buildBufferProps, buildBackdrop };`,
)(THREE_STUB, (c, o) => ({ c, o }), mergeGeosStub, WORLD_EDGE, edgeWallInsetM, edgeWallHM, WATER,
  SLOPE, slopeDeg, EW.wallSlopeTier,
  classifyImg, terrainEnvCode, EW.planWallRuns, planWallKinds, EW.WALL_KINDS, wallParts, EW.wallVariant, EW.edgeSeed,
  over.planBufferProps || EW.planBufferProps, over.propParts || EW.propParts,
  over.planBackdrop || EW.planBackdrop, over.backdropParts || EW.backdropParts, EW.BACKDROP_KINDS,
  EW.EDGE_WALL, edgeBufferM, objHeightMax, false, EW.partBox);
const B = mkWall();

// 合成地形:起伏 + 一片水域 + **中等坡與陡崖各一段**(段身取樣的 lo/hi 要真的不同,平地驗不到
// 「不懸空也不被吃掉」;沒有水域就驗不到水陸域分流;沒有陡坡就驗不到坡度分級 —— 三件事各要
// 一塊地。坡度用推導的門檻造:`SLOPE.EASE_DEG`(16°)與 `BLOCK_DEG`(32°)一改,這裡跟著走)
const TAN_MID = Math.tan(((SLOPE.EASE_DEG + SLOPE.BLOCK_DEG) / 2) * Math.PI / 180);
const TAN_STEEP = Math.tan(((SLOPE.BLOCK_DEG + 90) / 2) * Math.PI / 180);
const T = {
  minX: -500, maxX: 500, minZ: -400, maxZ: 400, worldW: 1000, worldH: 800,
  waterY: 2,
  heightAt: (x, z) => {
    if (z < -260) return -4;                                          // 水域
    if (z < -180) return 3;                                           // 沼澤(水面上 SWAMP_BAND 內)
    const base = 30 + Math.sin(x / 37) * 9 + Math.cos(z / 53) * 7;
    if (x > 250) return base + (x - 250) * TAN_STEEP;                 // 陡崖
    if (x > 60) return base + (x - 60) * TAN_MID;                     // 中等坡
    return base;
  },
  sampleColor: (x, z) => (z < -260 ? [60, 90, 160] : (z < -180 ? [82, 96, 78] : (x < 0 ? [120, 120, 120] : [150, 120, 80]))),
  bufferHeightAt: (x, z) => 20 + Math.sin(x / 90) * 6 + Math.cos(z / 110) * 5,
  // 裙實際鋪的深度:2026-08-13 起 terrain 對外交出這一個數(迷你地圖縮到 1/3),
  // 緩衝布景 / 視線背景 / 地貌底毯一律讀它,MUST NOT 各自再呼叫 edgeBufferM()
  bufferM: edgeBufferM(),
};
const group = { add: () => {} };
const blockers = [];
emitted.length = 0;
const segs = B.buildEdgeWall({ group, terrain: T, blockers });
const wallEmitted = emitted.slice();
const IN = edgeWallInsetM();
// 動態件不進靜態合批；用 edgewall.partBox 的完整運動包絡轉成世界 AABB，與靜態件一起驗 A30。
const motionEmitted = [];
for (const s of segs) {
  const c = Math.cos(s.fry), sn = Math.sin(s.fry);
  for (const p of s.motion || []) {
    const b = EW.partBox(p), pts = [];
    for (const x of [b.x0, b.x1]) for (const z of [b.z0, b.z1]) {
      pts.push([s.x + c * x + sn * z, s.z - sn * x + c * z]);
    }
    motionEmitted.push({
      x0: Math.min(...pts.map((q) => q[0])), x1: Math.max(...pts.map((q) => q[0])),
      y0: s.ground + b.y0, y1: s.ground + b.y1,
      z0: Math.min(...pts.map((q) => q[1])), z1: Math.max(...pts.map((q) => q[1])),
    });
  }
}
const visualEmitted = [...wallEmitted, ...motionEmitted];

// ============ Ⅰ 推導不手寫 ============
console.log('\nⅠ 推導不手寫(環高 ← 機體 / 厚度 ← 基準厚 / 緩衝 ← 地平線)');
{
  // 稽核端**獨立重算**最高機體,不呼叫被測的那一支去驗它自己
  let mx = 0;
  for (const ch of Object.keys(CHARACTERS)) mx = Math.max(mx, heroTargetH(charKind(ch), ch));
  t(`最高機體全高 ${mx.toFixed(2)}m 與 heroTallestH() 一致`, near(heroTallestH(), mx));
  t(`環高下界 ${edgeWallHM().toFixed(2)}m = 最高機體 × ${WORLD_EDGE.WALL_H_F}(夾在物件上限之內)`,
    near(edgeWallHM(), Math.min(objHeightMax(), mx * WORLD_EDGE.WALL_H_F)));
  t('環高下界 > 每一台機體的全高(沒有任何機體看得到自己越過它)', edgeWallHM() > mx);
  t(`環高下界 ${edgeWallHM().toFixed(1)}m ≤ 物件高度上限 ${objHeightMax()}m(與建物/地標同一個天花板)`,
    edgeWallHM() <= objHeightMax());
  t(`深型厚度 ${edgeWallDeepM()}m = 基準厚 ${WORLD_EDGE.WALL_T} × ${WORLD_EDGE.WALL_T_F}`,
    near(edgeWallDeepM(), WORLD_EDGE.WALL_T * WORLD_EDGE.WALL_T_F));
  // 型錄與 data.js 的**雙向**釘住:低報 = 邊界樓群長進船身,虛胖 = 邊界帶被無謂地擠掉
  const deepest = Math.max(...Object.values(EW.WALL_KINDS).map((k) => k.depth));
  t(`型錄裡最深的一款 ${deepest}m === edgeWallDeepM()(雙向釘住,不是各寫各的)`, near(deepest, edgeWallDeepM()));
  t('每一款都比夾制線薄(厚度整個落在圖界之內)', deepest < edgeWallInsetM());
  t(`緩衝深度 ${edgeBufferM().toFixed(1)}m = 最深障礙 ${edgeWallDeepM().toFixed(1)}m × ${WORLD_EDGE.BUFFER_F}`,
    near(edgeBufferM(), edgeWallDeepM() * WORLD_EDGE.BUFFER_F));
  t('緩衝只留邊界障礙所需空間，且已大幅小於地平線距離',
    edgeBufferM() >= edgeWallDeepM() && edgeBufferM() < curveHorizonM() * 0.1,
    `（緩衝 ${edgeBufferM().toFixed(1)}m / 地平線 ${curveHorizonM().toFixed(1)}m）`);
  const defs = ['edgeWallInsetM', 'edgeWallHM', 'edgeWallDeepM', 'edgeBufferM', 'heroTallestH'];
  for (const d of defs) {
    const m = new RegExp(`export const ${d} = [\\s\\S]*?;\\n`).exec(dataSrc);
    t(`${d}() 的定義式內無公尺數字面值(全部轉呼既有的尺)`,
      !!m && !/[^.\w]\d{2,}(\.\d+)?[^\w]/.test(m[0].replace(/WALL_M: ?\d+/, '')));
  }
}

// ============ Ⅱ 「不可越過」是結構保證(執行真品原文)============
console.log('\nⅡ 不可越過 = 環上沒有縫(真品 buildEdgeWall + 合成地形)');
{
  t(`四條邊都鋪滿(${segs.length} 段;perimeter/SEG_M ≈ ${Math.round(2 * (T.worldW + T.worldH) / WORLD_EDGE.SEG_M)})`,
    segs.length >= 2 * (T.worldW + T.worldH) / WORLD_EDGE.SEG_M - 4);
  // 逐邊做區間聯集:沿邊軸的 [d−half, d+half] MUST 首尾相連地覆蓋整條邊。
  // **逐款厚度不同 ⇒ 同一條邊上的段心 z 不再是同一個值**,故分邊改認「哪一側」而不是段心座標。
  const sideOf = (s) => (s.ry === 0
    ? `x@${s.z < 0 ? 'min' : 'max'}`
    : `z@${s.x < 0 ? 'min' : 'max'}`);
  const byEdge = new Map();
  for (const s of segs) {
    const key = sideOf(s);
    (byEdge.get(key) || byEdge.set(key, []).get(key)).push(s);
  }
  t('恰四條邊', byEdge.size === 4, `（實得 ${byEdge.size}）`);
  let holes = 0, minLap = Infinity, covered = true;
  for (const [key, list] of byEdge) {
    const along = key[0] === 'x' ? 'x' : 'z';
    const lo = along === 'x' ? T.minX : T.minZ, hi = along === 'x' ? T.maxX : T.maxZ;
    const iv = list.map((s) => [(along === 'x' ? s.x : s.z) - s.hw2, (along === 'x' ? s.x : s.z) + s.hw2])
      .sort((a, b) => a[0] - b[0]);
    if (iv[0][0] > lo + 1e-6 || iv[iv.length - 1][1] < hi - 1e-6) covered = false;
    for (let i = 1; i < iv.length; i++) {
      const lap = iv[i - 1][1] - iv[i][0];
      minLap = Math.min(minLap, lap);
      if (lap <= 0) holes++;
    }
  }
  t('環的兩端都蓋到圖界(四個角由 X 邊與 Z 邊互相跨過封死)', covered);
  t(`相鄰段互相咬住、零縫隙(最小重疊 ${minLap.toFixed(2)}m)`, holes === 0 && minLap > 0,
    `（${holes} 處有縫；SEG_LAP_F=${WORLD_EDGE.SEG_LAP_F}）`);
  t('重疊來自 SEG_LAP_F > 1 而不是碰巧(係數本身就是那個保證)', WORLD_EDGE.SEG_LAP_F > 1);
  // 內緣恰在夾制線上 ⇒ 地面機體恆先撞到環,game.js 那兩行永遠用不到(**厚度逐款不同也一樣**)
  let onLine = true, outward = true, depths = new Set();
  for (const s of segs) {
    const inner = s.ry === 0
      ? (s.z < 0 ? s.z + s.hd2 - T.minZ : T.maxZ - (s.z - s.hd2))
      : (s.x < 0 ? s.x + s.hd2 - T.minX : T.maxX - (s.x - s.hd2));
    if (!near(inner, IN, 1e-6)) onLine = false;
    if (inner - s.hd2 * 2 < 0) outward = false;   // 環體整個在夾制線之外
    depths.add((s.hd2 * 2).toFixed(2));
  }
  t(`每一段的內緣恰好落在夾制線(內縮 ${IN}m)上 —— 逐款厚度不同也成立`, onLine);
  t('環體整個位在夾制線之外(飛行機體停在夾制線上時不會卡進環裡)', outward);
  t(`同一圈上真的出現多種厚度(${[...depths].sort((a, b) => a - b).join(' / ')} m)`, depths.size >= 2);
  // 地形起伏:底埋進去、頂高出去。
  // 取樣點 MUST 回到**內面那條線**(= 夾制線)—— 段心自從厚度逐款不同之後就退在後面
  // 半個厚度上,拿段心取樣會在起伏地形上量到另一個高度,而斷言看起來只是紅了兩條。
  let baseOk = true, topOk = true;
  for (const s of segs) {
    const fx = s.ry === 0 ? s.x : (s.x < 0 ? T.minX + IN : T.maxX - IN);
    const fz = s.ry === 0 ? (s.z < 0 ? T.minZ + IN : T.maxZ - IN) : s.z;
    let lo = Infinity, hi = -Infinity;
    for (let k = -2; k <= 2; k++) {
      const o = k / 2 * s.hw2;
      const h = T.heightAt(s.ry === 0 ? fx + o : fx, s.ry === 0 ? fz : fz + o);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    if (s.y >= lo) baseOk = false;
    if (s.y + s.h < hi + edgeWallHM() - 1e-6) topOk = false;
  }
  t('斜坡上不懸空(底面埋在該段最低的地形之下)', baseOk);
  t(`頂面恆高出該段最高的地形 ≥ ${edgeWallHM().toFixed(1)}m(環高下界)`, topOk);
  const src = grabFn(bioSrc, 'buildEdgeWall');
  t('零共享 rnd 消耗(§2.3:插在任何位置都不推移植被佈局)',
    !/\brnd\s*\(/.test(strip(src)) && !/Math\.random/.test(strip(src)));
  t('水／沼選型走 terrainEnvCode、乾地才走 classifyImg(純分類、零亂數；wet 不再是死資料)',
    /terrainEnvCode\(terrain, px, pz\)/.test(strip(src)) && /classifyImg\(/.test(strip(src))
    && !/[^g]\bclassify\(/.test(strip(src)));
  emitted.length = 0;
  const again = B.buildEdgeWall({ group, terrain: T, blockers: [] });
  t('決定性:同一份輸入跑兩次逐位元相同', JSON.stringify(segs) === JSON.stringify(again));
  t('決定性:連演出的零件也逐位元相同(款式/色差/擺位全由座標雜湊決定)',
    JSON.stringify(emitted) === JSON.stringify(wallEmitted));
}

// ============ Ⅲ 演出 ⊆ 碰撞盒 ============
console.log('\nⅢ 演出 ⊆ 碰撞盒(A30 / 原則 4)');
{
  t(`碰撞柱數 = 段數(${blockers.length})`, blockers.length === segs.length);
  t('每一根都是有向盒(hw2/hd2/ry)且廣相 r = 外接半對角',
    blockers.every((b) => b.hw2 > 0 && b.hd2 > 0 && b.ry != null
      && near(b.r, Math.hypot(b.hw2, b.hd2))));
  t('環頂刻意不可站立(無 bld / std ⇒ 不進 makeBlockerTopIndex)',
    blockers.every((b) => !b.bld && !b.std));
  t('不可攀爬(無 cl ⇒ climb.js 不會把梯子架到邊界牆上)', blockers.every((b) => !b.cl));
  t('ry 只取 0 / π/2(對稱盒在這兩個角度上「繞 +ry 還是 −ry」逐位元同判 ⇒ A30 的正負號坑天生不存在)',
    blockers.every((b) => near(b.ry, 0) || near(b.ry, Math.PI / 2)));
  // 逐顆零件的**世界 AABB** MUST 收在某一根碰撞柱裡(ry ∈ {0, π/2} ⇒ 盒判退化成逐軸比對)
  const inBox = (bx, b) => {
    const e = 1e-6;
    if (bx.y0 < b.y - e || bx.y1 > b.y + b.h + e) return false;
    const [hx, hz] = near(b.ry, 0) ? [b.hw2, b.hd2] : [b.hd2, b.hw2];
    return bx.x0 >= b.x - hx - e && bx.x1 <= b.x + hx + e
      && bx.z0 >= b.z - hz - e && bx.z1 <= b.z + hz + e;
  };
  let out = 0, worst = null;
  for (const bx of visualEmitted) {
    if (blockers.some((b) => inBox(bx, b))) continue;
    out++;
    if (!worst) {
      const cx = (bx.x0 + bx.x1) / 2, cz = (bx.z0 + bx.z1) / 2;
      let ni = 0, nd = Infinity;
      for (let i = 0; i < blockers.length; i++) {
        const d = Math.hypot(cx - blockers[i].x, cz - blockers[i].z);
        if (d < nd) { nd = d; ni = i; }
      }
      worst = { ...bx, kind: segs[ni]?.kind || '?' };
    }
  }
  t(`每一顆零件及完整運動包絡都收在碰撞柱之內(${visualEmitted.length} 件,頂出 ${out} 件)`, out === 0,
    worst ? `（例:${worst.kind} x ${worst.x0.toFixed(1)}~${worst.x1.toFixed(1)} y ${worst.y0.toFixed(1)}~${worst.y1.toFixed(1)} z ${worst.z0.toFixed(1)}~${worst.z1.toFixed(1)}）` : '');
  // 地下埋深補片:只填段底到地表的不可見落差，不得抬高或承托障礙物本體。
  const floors = new Map();
  for (const b of blockers) floors.set(`${b.x.toFixed(2)},${b.z.toFixed(2)}`, b);
  let plinthOk = true;
  for (const b of blockers) {
    const bottom = visualEmitted.filter((bx) => inBox(bx, b)).reduce((m, bx) => Math.min(m, bx.y0), Infinity);
    if (bottom > b.y + 0.05) plinthOk = false;
  }
  t('每一段的地下埋深補片只補地形起伏，障礙物本體仍由地面／水面長出', plinthOk);
  // **盒高逐段實測**:城牆的城樓 14m / 素牆 9m 是同一款的不同節 —— 拿型錄宣告的最高值當
  // 每一節的盒高,素牆那幾節的頂上就多出一截撞得到卻看不見的空氣(A30 家族的反面)。
  // 下界仍是環高(`edgeWallHM`):比它矮的款照樣頂到那條線,「沒有機體看得過去」不動。
  let airGap = 0, worstGap = null;
  for (const s of segs) {
    const top = visualEmitted.filter((bx) => inBox(bx, s)).reduce((m, bx) => Math.max(m, bx.y1), -Infinity);
    const want = Math.max(s.ground + edgeWallHM(), top);
    if (Math.abs((s.y + s.h) - want) > 1e-6) {
      airGap++;
      if (!worstGap) worstGap = `${EW.WALL_KINDS[s.kind].label} 盒頂 ${(s.y + s.h).toFixed(2)} vs 該段實測 ${want.toFixed(2)}`;
    }
  }
  t('每一段的盒高 = 該段零件的實測頂(下界 = 環高)⇒ 頂上沒有一截撞得到卻看不見的空氣',
    airGap === 0, `（${airGap} 段;例:${worstGap}）`);
  const city = EW.WALL_KINDS.citywall, cityH = Math.max(edgeWallHM(), city.h);
  const cityTops = new Set(Array.from({ length: 80 }, (_, i) => Math.max(...wallParts('citywall', {
    len: WORLD_EDGE.SEG_M * WORLD_EDGE.SEG_LAP_F, depth: city.depth, h: cityH, seed: i + 1,
  }).map((p) => EW.partBox(p).y1)).toFixed(2)));
  t(`同一款的節可以有不同盒高(城牆 80 種子出現 ${cityTops.size} 種高度 —— 素牆 / 箭樓 / 砲台 / 城樓)`, cityTops.size >= 4);
  const glassBatchSrc = BREAK_GLASS ? bioCode.replaceAll("p.mat === 'glass'", 'false') : bioCode;
  t('演出依不透明／玻璃各自合批，而不是逐件 mesh（整圈最多兩個靜態 draw call）',
    /mergeGeos\(partBatch\.geos, partBatch\.cols\)/.test(glassBatchSrc)
    && /p\.mat === 'glass'/.test(glassBatchSrc)
    && /transparent: true/.test(glassBatchSrc) && /depthWrite: false/.test(glassBatchSrc));
}

// ============ Ⅳ 單一縫 + blockers 順序 ============
console.log('\nⅣ 單一縫與順序');
{
  t('`edgeWallInsetM` 在 data.js 恰一份定義', count(strip(dataSrc), /export const edgeWallInsetM/g) === 1);
  t('`edgeWallDeepM` 在 data.js 恰一份定義', count(strip(dataSrc), /export const edgeWallDeepM/g) === 1);
  t('game.js 的邊界夾制吃 edgeWallInsetM()(不再手寫 40)',
    /edgeWallInsetM\(\)/.test(gameCode)
    && !/terrain\.minX \+ 40|terrain\.maxX - 40/.test(gameCode));
  t('夾制恰兩行(x / z 各一)且共用同一個 eIn',
    count(gameCode, /Math\.max\(this\.terrain\.min[XZ] \+ eIn/g) === 2);
  t('biomes.js 的封路內縮吃同一支(舊制手寫 `const INSET = 40` 已退場)',
    /const INSET = edgeWallInsetM\(\)/.test(bioCode) && !/const INSET = 40/.test(bioCode));
  t('地物散布內縮吃同一支(舊制 `const inb = 30` 已退場 —— 那個值讓落點抽得進環體)',
    /const inb = edgeWallInsetM\(\)/.test(bioCode) && !/const inb = 30/.test(bioCode));
  t('邊界帶的內緣讓開**最深的那一款**(IN1 = 內縮 − edgeWallDeepM();沿用 WALL_T 會讓樓群長進船身)',
    /IN1 = edgeWallInsetM\(\) - edgeWallDeepM\(\)/.test(bioCode)
    && !/IN1 = edgeWallInsetM\(\) - WORLD_EDGE\.WALL_T/.test(bioCode) && !/IN1 = 34/.test(bioCode));
  t('`buildEdgeWall` 一份實作、一個呼叫點',
    count(bioCode, /function buildEdgeWall/g) === 1
    && count(bioCode, /const edgeSegs = buildEdgeWall\(/g) === 1);
  t('型錄與切分規則只住 edgewall.js(biomes.js 不得再寫第二份地貌 → 款式的對照表)',
    !/WALL_KINDS\s*=/.test(bioCode) && /from '\.\/edgewall\.js'/.test(bioSrc));
  // 順序:環 MUST 是 blockers 的第一批(main.js 的 occ 上傳會 slice 掉尾端)。
  // 比對的一律是**呼叫點**(`= fn(`)而不是 `fn(` —— 後者會先命中函式定義本身,而定義的位置
  // 與執行順序無關,那樣寫的稽核只是在量原始碼的排版。
  const iWall = bioCode.indexOf('const edgeSegs = buildEdgeWall(');
  const others = ['= placeMegaliths({', '= placeGiantGroves({', '= placeBeacons({', 'blockers.push(...roadRes.cols)'];
  t('環排在其餘每一個 blockers 生產者之前(occ 上傳 slice(0, LOS.MAX_OCC) 不會把它切掉)',
    iWall > 0 && others.every((k) => bioCode.indexOf(k) > iWall),
    `（${others.filter((k) => bioCode.indexOf(k) <= iWall).join(' / ')}）`);
  t('環同時登記進占位網格(邊界帶的樓群/神木經 occ.room 自動縮到環外)',
    /for \(const s of edgeSegs\) occ\.add\(/.test(bioCode));
  t(`段數遠低於 LOS.MAX_OCC(${segs.length} 段 ⇒ 上傳預算幾乎不受影響)`, segs.length < 400);
}

// ============ Ⅴ 緩衝空間(外緣裙)============
console.log('\nⅤ 緩衝空間:延伸可視距離、不可進入、貼地貌拼圖');
{
  t('terrain.js 自 data.js import edgeBufferM(不是自己算一份深度)',
    /edgeBufferM/.test(terrSrc.split('\n').find((l) => l.includes("from './data.js'")) || ''));
  t('裙的深度吃 edgeBufferM(mapArg(cfg))、外帶細度吃 curveMaxEdgeM()(與水面同一把尺)',
    /const B = edgeBufferM\(mapArg\(cfg\)\), OUT = Math\.max\(1, Math\.ceil\(B \/ curveMaxEdgeM\(\)\)\)/.test(terrCode));
  // 深度只准有一個數:裙自己算完之後對外交出 `bufferM`,消費端(緩衝布景 / 視線背景 /
  // 地貌底毯)一律讀它 —— 它們各自再呼叫一次 edgeBufferM() 就是四份可能不同步的深度,
  // 而漏傳 mini 的那一份會把物件擺到裙外的虛空裡(2026-08-13 迷你地圖)
  t('深度對外只交出實際用的那一個數 bufferM(biomes / ground MUST NOT 再自己呼叫 edgeBufferM)',
    /bufferM = B;/.test(terrCode) && /bufferM,/.test(terrCode)
    && !/edgeBufferM/.test(bioCode) && !/edgeBufferM/.test(codeOf(readSrc('public', 'js', 'ground.js'))));
  t('裙的內緣取地形自己的格距 N−1(粗格會在起伏地形上裂出幾公尺的縫)',
    /for \(let k = 1; k <= N - 1; k\+\+\) a\.push\(lo \+ \(\(hi - lo\) \* k\) \/ \(N - 1\)\)/.test(terrCode));
  t('內域的格留給真地形(只鋪「地形範圍之外」那一圈)',
    /if \(i >= OUT && i < OUT \+ N - 1 && j >= OUT && j < OUT \+ N - 1\) continue;/.test(terrCode));
  t('高度是地形自己的坡度外推 + 夾回全圖 [minH, maxH](不憑空造山)',
    /Math\.min\(maxH, Math\.max\(minH, h0 \+ g \* DEC \* \(1 - Math\.exp\(-d \/ DEC\)\)\)\)/.test(terrCode));
  t('接縫連續:d = 0 直接回 heightAt(邊點)= 地形自己那一顆頂點', /if \(d < 1e-6\) return h0;/.test(terrCode));
  t('與地形**共用材質**(影像路徑靠 UV 取邊界內的像素、無影像路徑走同一支 paintTerrainTones)',
    /new THREE\.Mesh\(sgeo, mat\)/.test(terrCode)
    && /paintTerrainTones\(sgeo, spos, \{ minX, maxX, minZ, maxZ \}, center\)/.test(terrCode));
  t('外環水面共用既有水盤的材質(沿海場地的海面一路連到地平線)',
    /new THREE\.Mesh\(wgeo, waterMat\)/.test(terrCode) && /waterMat = water\.material/.test(terrCode));
  t('沒有新增第四份 envMat(cel 管線稽核以「地形兩條路徑 + 水面共三處」釘住這個計數)',
    count(terrCode, /envMat\(/g) === 3);
  t('內域水面仍是既有那一片(PlaneGeometry 那一行沒動 ⇒ 世界曲面稽核不受影響)',
    /new THREE\.PlaneGeometry\(worldW, worldH, wSeg\(worldW\), wSeg\(worldH\)\)/.test(terrCode));
  // 地貌拼圖(2026-08-11):UV 由夾制改鏡射平鋪
  t('地貌拼圖:影像 UV 走**鏡射平鋪**(舊制的 clampX/clampZ 夾制會把邊界像素往外拉成掃把痕)',
    /xzToLL\(mirror\(x, minX, maxX\), mirror\(z, minZ, maxZ\), center\)/.test(terrCode)
    && !/xzToLL\(clampX\(x\), clampZ\(z\), center\)/.test(terrCode));
  t('鏡射是三角波(週期 2×跨距)⇒ 圖界上是恆等 ⇒ 接縫逐點同色',
    /return lo \+ \(t <= span \? t : 2 \* span - t\);/.test(terrCode));
  // 外推高度的對外單一縫
  t('`bufferHeightAt` 對外露出且恰為裙自己那份 outerH(緩衝布景/背景靠它落地)',
    /bufferHeightAt = outerH;/.test(terrCode) && /bufferHeightAt,/.test(terrCode));
  t('緩衝高度只對外保留一份；遊戲建圖不再發射圖界外的無碰撞布景',
    !bioCode.includes('const bufferProps =') && !bioCode.includes('const backdropSegs ='));
  // 鏡射本身的數學(執行真品原文的那一小段)
  const mirrorSrc = /const mirror = \(v, lo, hi\) => \{[\s\S]*?\n    \};/.exec(terrCode);
  t('鏡射函式抽得出來', !!mirrorSrc);
  if (mirrorSrc) {
    const mirror = new Function(`${mirrorSrc[0]} return mirror;`)();
    const lo = -500, hi = 500;
    t('鏡射:圖內恆等、圖界連續、往外週期反射,且恆落在 [lo, hi] 內',
      near(mirror(0, lo, hi), 0) && near(mirror(hi, lo, hi), hi)
      && near(mirror(hi + 120, lo, hi), hi - 120) && near(mirror(lo - 120, lo, hi), lo + 120)
      && [-3000, -1234, 0, 777, 4321].every((v) => mirror(v, lo, hi) >= lo - 1e-9 && mirror(v, lo, hi) <= hi + 1e-9));
  }
}

// ---- Ⅴ-b 行為直測:執行**真品原文**的裙區塊(合成起伏地形 × 兩條材質路徑)----
// 只驗字串的話,一個 `ReferenceError` 會讓整張圖的地形建構當場失敗,而每一條原文斷言照樣全綠。
console.log('\nⅤ-b 外緣裙行為直測(執行 terrain.js 原文)');
{
  const blk = terrSrc.slice(terrSrc.indexOf('  {\n    const B = edgeBufferM('), terrSrc.indexOf('  // ---- 地形射線'));
  class BA { constructor(a, i) { this.array = a; this.itemSize = i; } }
  const meshes = [];
  const TH = {
    BufferGeometry: class { constructor() { this.att = {}; } setAttribute(k, v) { this.att[k] = v; } setIndex(i) { this.idx = i; } computeVertexNormals() {} },
    BufferAttribute: BA,
    Mesh: class { constructor(g, m) { this.g = g; this.m = m; meshes.push(this); } },
  };
  const N = 193, mnX = -500, mxX = 500, mnZ = -400, mxZ = 400, mnH = 0, mxH = 120;
  const hAt = (x, z) => 40 + Math.sin(x / 60) * 20 + Math.cos(z / 80) * 15;
  let outer = null;
  const run = (imagery) => {
    meshes.length = 0;
    // 沙箱的自由變數清單 MUST 跟著 terrain.js 走:裙的 uvOf 自 2026-08-10 起改吃 `xzToLL`
    // (地圖主方位的逆旋轉)、2026-08-11 起多一個對外的 `bufferHeightAt` —— 漏掉就是
    // ReferenceError,而那正是這一段存在的理由
    const sandbox = new Function('THREE', 'cfg', 'mapArg', 'edgeBufferM', 'curveMaxEdgeM', 'minX', 'maxX', 'minZ', 'maxZ', 'N', 'minH', 'maxH',
      'heightAt', 'imagery', 'bbox', 'lon2tx', 'lat2ty', 'paintTerrainTones', 'center', 'mat', 'group', 'waterY', 'waterMat', 'xzToLL',
      `let bufferHeightAt = null, bufferM = 0;\n${blk}\nreturn bufferHeightAt;`);
    outer = sandbox(
      TH, {}, mapArg, edgeBufferM, curveMaxEdgeM, mnX, mxX, mnZ, mxZ, N, mnH, mxH, hAt, imagery,
      { minLng: 0, maxLng: 1, minLat: 0, maxLat: 1 }, (l) => l, (l) => l,
      (g, p) => { g.att.color = new BA(new Float32Array(p.length), 3); }, { lat: 25, lng: 121 }, {}, { add() {} }, 2, {}, xzToLL);
    return meshes;
  };
  let err = null, plain = null, sat = null;
  try { plain = run(null).slice(); sat = run({ z: 16, tx0: 0, ty0: 0, canvas: { width: 2048, height: 2048 } }).slice(); }
  catch (e) { err = e; }
  t(`裙的原文執行不炸(兩條材質路徑各跑一次)${err ? ` —— ${err.message}` : ''}`, !err);
  if (!err) {
    const g = plain[0].g, pos = g.att.position.array;
    let finite = true, inBand = true, seam = 0;
    for (let k = 0; k < pos.length; k += 3) {
      const x = pos[k], y = pos[k + 1], z = pos[k + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) finite = false;
      if (y < mnH - 1e-6 || y > mxH + 1e-6) inBand = false;
      if (x >= mnX - 1e-9 && x <= mxX + 1e-9 && z >= mnZ - 1e-9 && z <= mxZ + 1e-9) {
        seam = Math.max(seam, Math.abs(y - hAt(x, z)));   // 內緣頂點 MUST 與地形同高
      }
    }
    t('每一顆頂點都是有限值', finite);
    t('高度夾在全圖的 [minH, maxH](不憑空長出比這張圖更高的山)', inBand);
    t(`與地形的接縫逐點對齊(最大落差 ${seam.toExponential(1)}m ≪ 岸線容差)`, seam < 1e-4);
    t(`只鋪環狀那一圈(${pos.length / 3} 顆頂點 / ${g.idx.length / 3} 三角形 —— 內域一顆都沒建)`,
      pos.length / 3 < 12000 && g.idx.length / 3 > 1000);
    t('無影像路徑走 paintTerrainTones 取得頂點色(與地形同一支 ⇒ 顏色接得上)', !!g.att.color);
    t('影像路徑不需要頂點色、但一定要有 UV(否則整片採到同一個 texel)',
      !sat[0].g.att.color && !!sat[0].g.att.uv);
    t('有水域時另鋪外環水面(沿海場地的海面一路連到地平線)', plain.length === 2);
    t('裙真的把 bufferHeightAt 交出去了(緩衝布景靠它落地;沒交出去 = 那兩支整批跳過而畫面空白)',
      typeof outer === 'function' && Number.isFinite(outer(mxX + 300, mzOrZero())));
  }
  function mzOrZero() { return 0; }
}

// ============ Ⅵ 純表現層 ============
console.log('\nⅥ 純表現層(伺服器對這一整套一無所知)');
{
  // 裙的區塊 = 從它自己的標題到下一個區塊的標題(其餘稽核以同樣的標題切 terrain.js 的
  // 開挖/射線/打洞三段 —— 裙**刻意**擺在那三段之外,不然它會被連帶抽進那些沙箱裡執行)
  // 切片一律在**未剝註解**的原文上做(`codeOf` 會把 `// ----` 標題整行拿掉 ⇒ 在它上面
  // 找標題必然 indexOf = −1,slice 悄悄變成「從這裡到檔尾」,而斷言看起來只是紅了一條)
  const skirt = strip(terrSrc.slice(terrSrc.indexOf('const B = edgeBufferM('), terrSrc.indexOf('  // ---- 地形射線')));
  t('裙的區塊不碰 blockers / occ / heights(不進權威幾何、不改高度場)',
    skirt.length > 200 && !/blockers|\bocc\b|heights\[/.test(skirt));
  t('裙不影響 terrain 的對外範圍(minX..maxX 仍是可玩區;小地圖/高程網格/兵線稽核同框)',
    !/minX = |maxX = |minZ = |maxZ = /.test(skirt));
  t('伺服器原文完全不涉世界邊界(位置夾制本就是客戶端物理,同 FLIGHT 全族)',
    !/WORLD_EDGE|edgeWallInsetM|edgeBufferM|buildEdgeWall|edgewall/.test(strip(simSrc)));
  t('環的碰撞柱走既有的 blockers 路徑(不新增第二條上傳管道)',
    !/edgeSegs/.test(strip(readSrc('public', 'js', 'main.js'))));
  const props = strip(grabFn(bioSrc, 'buildBufferProps')), back = strip(grabFn(bioSrc, 'buildBackdrop'));
  t('舊緩衝布景與背景建構器不再被正式建圖路徑呼叫',
    !bioCode.includes('const bufferProps =') && !bioCode.includes('const backdropSegs ='));
  t('兩者零共享 rnd 消耗(§2.3:插在建構流程任何位置都不推移植被佈局)',
    !/\brnd\s*\(/.test(props) && !/\brnd\s*\(/.test(back)
    && !/Math\.random/.test(props) && !/Math\.random/.test(back));
  t('edgewall.js 全檔無 Math.random(A4)', !/Math\.random/.test(strip(ewSrc)));
  t('edgewall.js 零 THREE(這才是型錄與規劃器能離線驗的原因)', !/\bTHREE\b/.test(strip(ewSrc)));
  t("edgewall.js 只 import rng.js + vehicles.js(亂數 / 載具型錄兩條唯一縫)",
    (strip(ewSrc).match(/^import .*$/gm) || []).length === 2
    && /from '\.\/rng\.js'/.test(ewSrc) && /from '\.\/vehicles\.js'/.test(ewSrc));
}

// ============ Ⅶ 型錄與切分規則 ============
console.log('\nⅦ 邊界牆型錄與切分規則(使用者 2026-08-11 定案)');
{
  const categorizedKinds = BREAK_SHARED_CATALOG
    ? Object.keys(EW.BOUNDARY_OBJECT_CATEGORIES).filter((kind) => kind !== 'powerplant')
    : Object.keys(EW.BOUNDARY_OBJECT_CATEGORIES);
  const allKinds = Object.keys(EW.WALL_KINDS);
  t('每一款舊邊界障礙物皆歸入具名物件分類', categorizedKinds.length === allKinds.length
    && allKinds.every((kind) => typeof EW.boundaryObjectMeta(kind)?.category === 'string'));
  t('獨立物件與長構造完整互斥分流',
    EW.STANDALONE_BOUNDARY_KINDS.length + EW.BOUNDARY_ONLY_KINDS.length === allKinds.length
    && allKinds.every((kind) => EW.STANDALONE_BOUNDARY_KINDS.includes(kind) !== EW.BOUNDARY_ONLY_KINDS.includes(kind))
    && ['citywall', 'levee', 'seawall', 'tetrapod', 'wetpods'].every((kind) => EW.BOUNDARY_ONLY_KINDS.includes(kind))
    && ['powerplant', 'mine', 'fallentree', 'skyscrapers', 'edgehamlet'].every((kind) => EW.STANDALONE_BOUNDARY_KINDS.includes(kind)));
  const standaloneSample = EW.standaloneBoundaryParts('powerplant', { len: 30, seed: 19 });
  t('獨立背景出口直接委派 wallParts，長構造無法流入一般背景',
    JSON.stringify(standaloneSample) === JSON.stringify(EW.wallParts('powerplant', {
      len: 30, depth: EW.WALL_KINDS.powerplant.depth, h: EW.WALL_KINDS.powerplant.h,
      seed: 19, variant: EW.wallVariant('powerplant', 19), season: 'summer',
    })) && (() => { try { EW.standaloneBoundaryParts('citywall'); return false; } catch { return true; } })());
  const glazedKinds = ['rowhouse', 'skyfall', 'edgehamlet', 'greenhouse', 'factory',
    'powerplant', 'incinerator', 'skyscrapers', 'ship', 'strandedship'];
  t('原邊界建築均具玻璃牆／窗帶材質語意', glazedKinds.every((kind) => {
    const def = EW.WALL_KINDS[kind];
    return wallParts(kind, { len: 30, depth: def.depth, h: def.h, seed: 11 }).some((part) => part.mat === 'glass');
  }));
  const kinds = Object.keys(EW.WALL_KINDS);
  t(`型錄 ${kinds.length} 款(使用者點名 15 種:城牆/連排民房/河堤/海堤/軍工級路障/土石流/懸崖峭壁/山崩地/消波塊/倒塌神木/倒塌摩天樓/倒塌高架橋/停駛的列車/連排大貨車/連排貨輪)`,
    kinds.length >= 15);
  t('每一款都有中文名(型錄是給人看的,缺名字表示有人偷加了一款沒設計過的)',
    kinds.every((k) => typeof EW.WALL_KINDS[k].label === 'string' && EW.WALL_KINDS[k].label.length >= 2));
  const land = kinds.filter((k) => EW.WALL_KINDS[k].dom === 'land');
  const water = kinds.filter((k) => EW.WALL_KINDS[k].dom === 'water');
  t(`水陸域分流(陸域 ${land.length} 款 / 水域 ${water.length} 款;各至少三款才換得起來)`,
    land.length >= 3 && water.length >= 3 && land.length + water.length === kinds.length);
  for (const b of ['urban', 'green', 'bare', 'wet']) {
    t(`陸域地貌「${b}」至少兩款候選(只有一款 = 換了也是同一面牆)`,
      EW.wallCandidates(b, false).length >= 2);
  }
  t('水域候選全是水域款(海堤/消波塊/貨輪 —— 城牆站在水裡是這一族最明顯的破綻)',
    EW.wallCandidates('water', true).every((k) => EW.WALL_KINDS[k].dom === 'water'));
  const requested = {
    water: ['windsea', 'floatsolar', 'searanch', 'deeprig', 'tetrapod'],
    bare: ['windland', 'solarfield', 'mine', 'oilfield'],
    green: ['windland', 'ranch', 'greenhouse'],
    urban: ['factory', 'powerplant', 'incinerator', 'skyscrapers'],
    wet: ['oysterracks', 'strandedship', 'wetpods'],
  };
  for (const [bio, want] of Object.entries(requested)) {
    const got = EW.wallCandidates(bio, bio === 'water');
    t(`新增地貌型錄 ${bio}: ${want.map((k) => EW.WALL_KINDS[k]?.label || k).join(' / ')}`,
      want.every((k) => got.includes(k)));
  }
  t('合成地形真的產生沼澤段，且只會挑 wet 型錄(不是只驗一張永遠選不到的表)',
    segs.some((s) => s.biome === 'wet')
    && segs.filter((s) => s.biome === 'wet').every((s) => EW.WALL_KINDS[s.kind].bio.includes('wet')));
  t('地貌認不出來也一定挑得到一款(原則 6:降級不例外)',
    EW.wallCandidates('???', false).length > 0 && EW.wallCandidates('???', true).length > 0);
  // 每一款:收得進盒子(三軸)+ 宣告的 depth/h 與實算雙向吻合 + 內面蓋得滿
  const len = WORLD_EDGE.SEG_M * WORLD_EDGE.SEG_LAP_F, band = edgeWallHM();
  let fitBad = [], fillBad = [], faceBad = [];
  for (const k of kinds) {
    const d = EW.WALL_KINDS[k];
    const H = Math.max(band, d.h);
    let ox = -Infinity, oy = -Infinity, oz = -Infinity, dep = 0, top = 0, cov = 1;
    for (let s = 1; s <= 40; s++) {
      const parts = wallParts(k, { len, depth: d.depth, h: H, seed: s });
      const f = EW.wallFit(parts, len, d.depth, H);
      ox = Math.max(ox, f.ox); oy = Math.max(oy, f.oy); oz = Math.max(oz, f.oz);
      dep = Math.max(dep, f.depth); top = Math.max(top, f.h);
      cov = Math.min(cov, EW.wallFaceCover(parts, len, d.depth, Math.min(H, d.faceH || band)));
    }
    if (ox > 1e-9 || oy > 1e-9 || oz > 1e-9) fitBad.push(`${k}(x+${ox.toFixed(2)} y+${oy.toFixed(2)} z+${oz.toFixed(2)})`);
    if (Math.abs(dep - d.depth) > EW.EDGE_WALL.FILL_TOL || Math.abs(top - H) > EW.EDGE_WALL.FILL_TOL) {
      fillBad.push(`${k}(厚 ${dep.toFixed(1)}/${d.depth}、高 ${top.toFixed(1)}/${H.toFixed(1)})`);
    }
    if (cov < EW.EDGE_WALL.FACE_COVER) faceBad.push(`${k} ${(cov * 100).toFixed(0)}%`);
    if (d.h <= heroTallestH()) fillBad.push(`${k} 比最高機體還矮`);
  }
  t('每一款的零件表都收得進「段長 × depth × 高」的盒子(三軸;縱向 = 從上方斜射的彈道)',
    fitBad.length === 0, `（${fitBad.join(' / ')}）`);
  t(`宣告的 depth/h 與零件實算雙向吻合(±${EW.EDGE_WALL.FILL_TOL}m;低報 = A30,虛胖 = 盒子裡有空的)`,
    fillBad.length === 0, `（${fillBad.join(' / ')}）`);
  t(`每一款的內面都由障礙物本體蓋滿到其實際阻擋高度(一般款 ${band.toFixed(1)}m；低矮設施依 faceH；覆蓋率 ≥ ${EW.EDGE_WALL.FACE_COVER})`,
    faceBad.length === 0, `（${faceBad.join(' / ')}）`);
  t('擱淺鯨魚已從邊界型錄完整移除', !('whale' in EW.WALL_KINDS) && !/kind === ['"]whale['"]/.test(ewSrc));
  const facilities = kinds.filter((k) => EW.WALL_KINDS[k].family);
  const supportBad = [];
  for (const k of facilities) {
    const d = EW.WALL_KINDS[k], H = Math.max(band, d.h);
    for (let s = 1; s <= 20; s++) {
      const support = wallParts(k, { len, depth: d.depth, h: H, seed: s }).find((p) => {
        if (p.role === 'hull' || p.g?.[0] !== 'box') return false;
        const b = EW.partBox(p);
        return p.g[1] >= len * 0.9 && p.g[3] >= d.depth * 0.8 && b.y0 <= 0.05 && p.g[2] >= 1;
      });
      if (support) { supportBad.push(`${k}@${s}`); break; }
    }
  }
  t('陸海大型設施皆由障礙物本體落地／落水：不得另加整段底座或圍牆',
    supportBad.length === 0
    && !/\b(?:facilityBase|marineFrame)\b/.test(strip(ewSrc)), `（${supportBad.join(' / ')}）`);
  const lowFace = facilities.filter((k) => EW.WALL_KINDS[k].faceH != null);
  t('低矮阻擋帶只給太陽能設施，且 faceH 足以覆蓋人形單位（不得任意縮短以規避覆蓋率）',
    lowFace.length === 2
    && lowFace.every((k) => EW.WALL_KINDS[k].family === 'solar'
      && EW.WALL_KINDS[k].faceH >= 1.7 && EW.WALL_KINDS[k].faceH < band));
  const separated = kinds.filter((k) => EW.WALL_KINDS[k].separated);
  const gapBad = [], variantBad = [];
  for (const k of separated) {
    const d = EW.WALL_KINDS[k], H = Math.max(band, d.h);
    const fingerprints = new Set();
    for (let variant = 0; variant < d.variants; variant++) {
      const parts = wallParts(k, { len, depth: d.depth, h: H, seed: 17, variant });
      const cover = EW.wallFaceCover(parts, len, d.depth, band);
      if (cover >= 0.96) gapBad.push(`${k}#${variant} ${(cover * 100).toFixed(0)}%`);
      fingerprints.add(JSON.stringify(parts));
    }
    if (d.variants < 3 || fingerprints.size !== d.variants) variantBad.push(k);
  }
  t('非陣列大型設施保留可見透明縫（空氣牆仍連續，物件內面覆蓋率 < 96%）',
    separated.length >= 5 && gapBad.length === 0, `（${gapBad.join(' / ')}）`);
  t('工業建築／摩天樓／擱淺船各有至少三種不同構型，不以同一件連續複製',
    variantBad.length === 0, `（${variantBad.join(' / ')}）`);
  const mixSegs = Array.from({ length: 12 }, (_, i) => ({
    x: -600 + i * len, z: -300, len, biome: 'urban', water: false, tier: 'flat',
  }));
  const mixChecks = Object.entries(EW.WALL_MIX_GROUPS).map(([group, pool]) => {
    const seq = planWallKinds({ i0: 0, i1: mixSegs.length, kind: pool[0], biome: 'urban', water: false, tier: 'flat' }, mixSegs);
    return { group, pool, seq };
  });
  t('同類混排名冊分成工業與住商兩組；逐節只在組內穿插且相鄰不重複',
    mixChecks.length === 2 && mixChecks.every(({ pool, seq }) => (
      new Set(seq).size >= 2 && seq.every((k) => pool.includes(k))
      && seq.every((k, i) => i === 0 || seq[i - 1] !== k))));
  t('真正建牆路徑有消費逐節混排與構型輪替（不是只有離線型錄會算）',
    /planWallKinds\(r, row, prevKind\)/.test(bioCode)
    && /wallVariant\(kind, seed, kind === prevKind \? prevVariant : -1\)/.test(bioCode));
  const partsOf = (k, seed = 9) => {
    const d = EW.WALL_KINDS[k];
    return wallParts(k, { len, depth: d.depth, h: Math.max(band, d.h), seed });
  };
  t('海上風機使用自身固定樁基與塔架直接入水',
    EW.WALL_KINDS.windsea.mount === 'fixed'
    && partsOf('windsea').some((p) => p.role === 'monopile')
    && partsOf('windsea').some((p) => p.role === 'mooring'));
  t('浮動光電具模組、浮筒、獨立逆變器浮台與繫泊浮標',
    EW.WALL_KINDS.floatsolar.mount === 'float'
    && ['float', 'inverter-float', 'mooring'].every((role) => partsOf('floatsolar').some((p) => p.role === role)));
  t('海上牧場同時讀得出大型箱網／圍網、貝類長線、維修浮台與繫泊系統',
    EW.WALL_KINDS.searanch.mount === 'float'
    && ['cage-collar', 'longline-buoy', 'service-float', 'mooring'].every((role) => partsOf('searanch').some((p) => p.role === role)));
  t('深海油井以浮筒平台直接繫泊於海域，不坐在連續海堤基座上',
    EW.WALL_KINDS.deeprig.mount === 'float'
    && partsOf('deeprig').some((p) => p.role === 'pontoon')
    && partsOf('deeprig').some((p) => p.role === 'mooring'));
  const windRows = ['windsea', 'windland'].flatMap((k) => {
    const d = EW.WALL_KINDS[k]; return wallParts(k, { len, depth: d.depth, h: d.h, seed: 7 });
  });
  const floatingRows = ['floatsolar', 'searanch', 'deeprig'].flatMap((k) => {
    const d = EW.WALL_KINDS[k]; return wallParts(k, { len, depth: d.depth, h: d.h, seed: 9 });
  });
  t('兩種風機陣列都把葉片標成 rotor 剛體樞軸(塔身仍留在靜態合批)',
    windRows.some((p) => p.motion?.kind === 'rotor') && windRows.some((p) => !p.motion));
  t('浮動太陽能／海上牧場／深海油井都具 float 剛體包絡',
    ['floatsolar', 'searanch', 'deeprig'].every((k) => {
      const d = EW.WALL_KINDS[k];
      return wallParts(k, { len, depth: d.depth, h: d.h, seed: 9 }).some((p) => p.motion?.kind === 'float');
    }));
  let motionSrc = strip(grabFn(bioSrc, 'buildEdgeMotion'));
  if (BREAK_MOTION) motionSrc = motionSrc.replace('EDGE_MOTION.ROTOR_RAD_S * wind', 'EDGE_MOTION.ROTOR_RAD_S');
  t('風機角速度 = EDGE_MOTION.ROTOR_RAD_S × 即時風量(正比，不另寫第二份天氣表)',
    /EDGE_MOTION\.ROTOR_RAD_S \* wind/.test(motionSrc) && /wind = celWindAmount\(\)/.test(motionSrc)
    && /export function celWindAmount\(\)/.test(toonSrc));
  t('浮動設施吃 celWindTime + celWaveAmount，並掛進既有 dynamics 桶',
    /t = celWindTime\(\)/.test(motionSrc) && /wave = celWaveAmount\(\)/.test(motionSrc)
    && /dynamics\.push\(/.test(motionSrc) && /buildEdgeMotion\(\{ group, segs: edgeSegs, dynamics \}\)/.test(bioCode));
  const roles = (kind) => partsOf(kind).map((p) => p.role).filter(Boolean);
  const cliffParts = partsOf('cliff');
  const cliffAngles = cliffParts.filter((p) => p.role === 'rock-strata').map((p) => p.slopeDeg);
  t('懸崖是 60~90° 的非垂直分層岩壁，具嵌入巨石與斜下枯木',
    EW.WALL_KINDS.cliff.faceDeg?.[0] === 60 && EW.WALL_KINDS.cliff.faceDeg?.[1] === 90
    && cliffAngles.length >= 6 && cliffAngles.every((a) => a >= 60 && a < 90)
    && roles('cliff').includes('embedded-boulder')
    && cliffParts.some((p) => p.role === 'embedded-deadwood' && p.slopeDown));
  t('土石流與山崩地都有高密度石塊／枯木；山崩地另具起伏土脊與揚塵',
    roles('debris').filter((r) => r === 'debris-rock').length >= 8
    && roles('debris').filter((r) => r === 'debris-deadwood').length >= 4
    && roles('landslide').includes('soil-ridge')
    && roles('landslide').filter((r) => r === 'landslide-rock').length >= 6
    && roles('landslide').filter((r) => r === 'landslide-deadwood').length >= 3
    && partsOf('landslide').some((p) => p.role === 'dust' && p.motion?.kind === 'dust'));
  t('礦場具起伏採掘台階、礦堆、至少兩組作業機具與揚塵',
    ['mine-bench', 'ore-pile', 'mine-machine-arm', 'mine-machine-bucket', 'dust'].every((r) => roles('mine').includes(r))
    && new Set(partsOf('mine').filter((p) => p.motion?.kind === 'machine').map((p) => p.motion.id)).size >= 2);
  t('陸上油田具多座鑽塔／抽油機與煙塵；海上油井具完整浮台、雙鑽塔、機具與煙塵',
    roles('oilfield').filter((r) => r === 'derrick-leg').length >= 4
    && partsOf('oilfield').some((p) => p.motion?.kind === 'machine')
    && partsOf('oilfield').some((p) => p.motion?.kind === 'smoke')
    && ['platform-deck', 'pontoon', 'platform-leg', 'platform-control', 'offshore-derrick-leg', 'offshore-oil-machine', 'smoke']
      .every((r) => roles('deeprig').includes(r))
    && roles('deeprig').filter((r) => r === 'offshore-derrick-leg').length >= 4);
  const podLayers = partsOf('tetrapod').filter((p) => p.role === 'breakwater-core' && p.layer >= 0);
  const podCounts = [0, 1, 2, 3].map((layer) => podLayers.filter((p) => p.layer === layer).length);
  t('消波塊由下而上逐層減少，形成金字塔式堆疊',
    podCounts.every((n) => n > 0) && podCounts.every((n, i) => i === 0 || podCounts[i - 1] > n),
    `（各層 ${podCounts.join(' > ')}）`);
  t('擱淺船具船殼、龍骨、尖艏、方艉、甲板、駕駛台、煙囪、桅桿與救生艇，不再是貨櫃底座',
    ['hull', 'keel', 'bow', 'stern', 'deck', 'bridge', 'bridge-window', 'funnel', 'mast', 'lifeboat']
      .every((r) => roles('strandedship').includes(r))
    && !roles('strandedship').some((r) => r.startsWith('container')));
  t('工廠與電廠的煙囪都有動態煙塵，電廠另具冷卻塔',
    ['factory', 'powerplant'].every((k) => roles(k).includes('chimney')
      && partsOf(k).some((p) => p.role === 'smoke' && p.motion?.kind === 'smoke'))
    && roles('powerplant').includes('cooling-tower'));
  t('採掘機具與煙塵共用既有 dynamics 與 celWindTime，不建立第二份動畫時鐘',
    /mot\.kind === 'machine'/.test(motionSrc) && /mot\.kind === 'smoke' \|\| mot\.kind === 'dust'/.test(motionSrc)
    && /EDGE_MOTION\.MACHINE_FREQ/.test(motionSrc) && /EDGE_MOTION\.PLUME_FREQ/.test(motionSrc)
    && /EDGE_MOTION\.PLUME_DRIFT_M \* wind/.test(motionSrc));
  // 切分規則:①地貌/水陸域改變 ②太長 ③短 run 併回去 ④相鄰不同款 ⑤決定性
  const mk = (n, biome, water) => Array.from({ length: n }, (_, i) => (
    { x: -800 + i * len, z: -500, len, biome, water }));
  const changed = EW.planWallRuns([...mk(6, 'urban', false), ...mk(6, 'green', false)].map((s, i) => (
    { ...s, x: -800 + i * len })));
  t('切分①:地貌一換就切(市區 6 節 + 綠地 6 節 ⇒ 至少兩段,且不跨界)',
    changed.length >= 2 && changed.every((r) => r.i1 <= 6 || r.i0 >= 6));
  const long = EW.planWallRuns(mk(40, 'urban', false));
  t(`切分②:太長就換一款(40 節同地貌 ⇒ 每段 ≤ RUN_MAX_M(${EW.EDGE_WALL.RUN_MAX_M}m)+ 一節)`,
    long.length > 1 && long.every((r) => r.len <= EW.EDGE_WALL.RUN_MAX_M + len + 1e-6),
    `（實得 ${long.length} 段,最長 ${Math.max(...long.map((r) => r.len)).toFixed(0)}m）`);
  const noisy = [...mk(6, 'urban', false)];
  noisy[3].biome = 'bare';   // 衛星色抖動:單節雜訊
  const merged = EW.planWallRuns(noisy.map((s, i) => ({ ...s, x: -800 + i * len })));
  t('切分③:短於 RUN_MIN_SEG 的 run 併回去(不然一條邊會碎成城牆/民房/城牆的雜訊)',
    merged.every((r) => r.i1 - r.i0 >= EW.EDGE_WALL.RUN_MIN_SEG));
  t('切分④:相鄰兩段不同款(同款接同款 = 一段更長的同款牆,正是「太長就換」要避免的)',
    long.every((r, i) => i === 0 || long[i - 1].kind !== r.kind));
  const wetDry = EW.planWallRuns([...mk(1, 'water', true), ...mk(6, 'urban', false)].map((s, i) => (
    { ...s, x: -800 + i * len })));
  t('切分⑤:水陸域不同的 run 不准被併掉(海堤併進城牆 = 牆站在水裡)',
    wetDry.every((r) => r.water === (r.i0 === 0)));
  t('切分⑥:決定性(同一份輸入跑兩次逐位元相同)',
    JSON.stringify(EW.planWallRuns(mk(40, 'urban', false))) === JSON.stringify(long));
  t('切分⑦:配款只吃座標雜湊(規劃器內零 Math.random、零共享 rnd)',
    !/Math\.random|\brnd\s*\(/.test(strip(grabFn(ewSrc, 'planWallRuns'))));
  // ---- 坡度分級(2026-08-11 使用者追加:「太陡的時候只使用懸崖峭壁/土石流/山崩這類自然
  //      景觀,中等坡度可以再加上倒木/長城」)----
  const NATURAL = ['cliff', 'rockery', 'landslide', 'debris'];
  const MID_EXTRA = ['fallentree', 'giantforest', 'citywall'];
  const rank = (t2) => EW.SLOPE_TIERS.indexOf(t2);
  t(`分級恰三級(${EW.SLOPE_TIERS.join(' < ')})且每一款都宣告了 slope`,
    EW.SLOPE_TIERS.length === 3 && kinds.every((k) => EW.SLOPE_TIERS.includes(EW.WALL_KINDS[k].slope)));
  t('門檻推導不手寫:`wallSlopeTier` 的定義式內沒有任何度數字面值(由呼叫端注入 SLOPE)',
    !/\d{2,}/.test(/export const wallSlopeTier = [\s\S]*?;\n/.exec(ewSrc)?.[0] || '999'));
  t(`門檻錨在既有的兩條線(平緩帶 ${SLOPE.EASE_DEG}° / 阻擋角 ${SLOPE.BLOCK_DEG}°)`,
    EW.wallSlopeTier(SLOPE.EASE_DEG - 0.1, SLOPE.EASE_DEG, SLOPE.BLOCK_DEG) === 'flat'
    && EW.wallSlopeTier(SLOPE.EASE_DEG + 0.1, SLOPE.EASE_DEG, SLOPE.BLOCK_DEG) === 'mid'
    && EW.wallSlopeTier(SLOPE.BLOCK_DEG + 0.1, SLOPE.EASE_DEG, SLOPE.BLOCK_DEG) === 'steep');
  t('biomes.js 的取樣真的把 SLOPE 那兩條線傳進去(自己寫死度數 = 改了移動只有一半跟著走)',
    /wallSlopeTier\(deg, SLOPE\.EASE_DEG, SLOPE\.BLOCK_DEG\)/.test(bioCode));
  t('坡度量的是**裸地形**(同 §2.1 地形坡度移動;拿站立面量會被鋪面/橋面洗掉)',
    /deg = Math\.max\(deg, Math\.abs\(slopeDeg\(/.test(bioCode) && !/deckAt|surfaceAt/.test(grabFn(bioSrc, 'buildEdgeWall')));
  for (const b of ['urban', 'green', 'bare', 'wet']) {
    const st = EW.wallCandidates(b, false, 'steep');
    t(`陡坡(> ${SLOPE.BLOCK_DEG}°)的「${b}」只給自然景觀(${st.map((k) => EW.WALL_KINDS[k].label).join('、')})`,
      st.length > 0 && st.every((k) => NATURAL.includes(k)));
    const mid = EW.wallCandidates(b, false, 'mid');
    t(`中等坡的「${b}」= 自然景觀 + 倒木/長城(${mid.map((k) => EW.WALL_KINDS[k].label).join('、')})`,
      mid.length > 0 && mid.every((k) => NATURAL.includes(k) || MID_EXTRA.includes(k)));
  }
  t('緩坡才給得出人造線形物(列車/貨車/民房/高架橋 —— 那些只有修得起路的坡立得住)',
    ['train', 'trucks', 'rowhouse', 'viaduct', 'skyfall', 'barricade', 'levee']
      .every((k) => EW.WALL_KINDS[k].slope === 'flat'));
  t('自然三款在三級都合法(擺在緩坡上不突兀;反過來把貨櫃車擺上崖面才是穿幫)',
    NATURAL.every((k) => EW.WALL_KINDS[k].slope === 'steep')
    && ['flat', 'mid', 'steep'].every((tr) => EW.wallCandidates('bare', false, tr).some((k) => NATURAL.includes(k))));
  const steepPool = EW.wallCandidates('bare', false, 'steep');
  const midPool = EW.wallCandidates('green', false, 'mid');
  const favored = (pool, kinds2) => pool.filter((k) => kinds2.includes(k)).length / pool.length;
  t('海拔起伏處大幅加權假山／懸崖／巨木林／大倒木(候選權重 ≥ 70%)',
    favored(steepPool, ['rockery', 'cliff']) >= 0.7
    && favored(midPool, ['rockery', 'cliff', 'giantforest', 'fallentree']) >= 0.7);
  t('陡的市區配不到符合地貌的自然景觀時,退回「這一級全部合法的款」而不是退回平地款',
    EW.wallCandidates('urban', false, 'steep').every((k) => rank(EW.WALL_KINDS[k].slope) >= rank('steep')));
  // 切分:坡度級改變也要切;短 run 併回去時 MUST 取**較陡**的那一級
  const slopeSegs = [...mk(4, 'green', false), ...mk(4, 'green', false)]
    .map((s, i) => ({ ...s, x: -800 + i * len, tier: i < 4 ? 'flat' : 'steep' }));
  const sr = EW.planWallRuns(slopeSegs);
  t('切分⑧:坡度級一換就切(緩 4 節 + 陡 4 節 ⇒ 至少兩段,且不跨界)',
    sr.length >= 2 && sr.every((r) => r.i1 <= 4 || r.i0 >= 4)
    && sr.every((r) => r.i0 >= 4 || rank(EW.WALL_KINDS[r.kind].slope) >= rank('flat')));
  t('切分⑨:陡的那一段真的只給自然景觀', sr.filter((r) => r.tier === 'steep').every((r) => NATURAL.includes(r.kind)));
  const oneSteep = mk(6, 'green', false).map((s, i) => ({ ...s, x: -800 + i * len, tier: i === 3 ? 'steep' : 'flat' }));
  const osr = EW.planWallRuns(oneSteep);
  t('切分⑩:一節崖面併進緩坡 run 時**整段升級成陡**(取較緩 = 一列貨櫃車橫跨那道崖,而每一條斷言照樣綠)',
    osr.every((r) => (r.i0 <= 3 && r.i1 > 3 ? r.tier === 'steep' && NATURAL.includes(r.kind) : true)));
  const wetFlat = mk(4, 'water', true).map((s, i) => ({ ...s, x: -800 + i * len, tier: 'steep' }));
  t('切分⑪:水域段的坡度級一律 flat(水面恆是平的;水底的坡與站在水面上的東西無關)',
    EW.planWallRuns(wetFlat).every((r) => r.tier === 'flat' && EW.WALL_KINDS[r.kind].dom === 'water'));
  // ---- 城牆的構造(2026-08-11 使用者追加:「城牆也加上城門/城樓/砲台等結構(不會攻擊)」)----
  {
    const d = EW.WALL_KINDS.citywall, H = Math.max(band, d.h);
    const tops = new Map();
    for (let sd = 1; sd <= 80; sd++) {
      const parts = wallParts('citywall', { len, depth: d.depth, h: H, seed: sd });
      const top = +Math.max(...parts.map((p) => EW.partBox(p).y1)).toFixed(2);
      if (!tops.has(top)) tops.set(top, { seed: sd, parts, n: 0 });
      tops.get(top).n++;
    }
    t(`城牆逐節有四種構造(素牆 / 箭樓 / 砲台 / 城門+城樓)⇒ 實測高度 ${[...tops.keys()].sort((a, b) => a - b).join(' / ')}m`,
      tops.size >= 4);
    const hi2 = Math.max(...tops.keys()), lo2 = Math.min(...tops.keys());
    t(`最高的那一種(城樓 ${hi2}m)= 型錄宣告的 ${H}m,最矮的(素牆 ${lo2}m)明顯較低 ⇒ 逐段盒高才有意義`,
      Math.abs(hi2 - H) <= EW.EDGE_WALL.FILL_TOL && hi2 - lo2 > band * 0.3);
    // 城門 MUST 是**關著的**:開一個真的洞在邊界上就是「看得穿卻走不過」
    const gate = tops.get(hi2);
    t(`城門那一節的內面照樣蓋滿(${(EW.wallFaceCover(gate.parts, len, d.depth, band) * 100).toFixed(0)}% ≥ ${EW.EDGE_WALL.FACE_COVER * 100}%)—— 門是關著的,不是一個洞`,
      EW.wallFaceCover(gate.parts, len, d.depth, band) >= EW.EDGE_WALL.FACE_COVER);
    // 「不會攻擊」是**構造保證**:整支 buildEdgeWall 只碰 group / blockers,砲只是幾何
    const wsrc = strip(grabFn(bioSrc, 'buildEdgeWall'));
    t('城門/砲台/城樓是幾何不是實體:buildEdgeWall 不碰任何單位、擺件或逐幀清單(「不會攻擊」不需要一個設定值)',
      !/\bitems\b|\bgeneric\b|\bcamps\b|\bdynamics\b|\bUNITS\b|\btowerSites\b|\bents\b/.test(wsrc));
    t('砲台那一節也一樣掛不上攻擊:碰撞柱與素牆同一條路徑(無 bld / std / cl)',
      blockers.every((b) => !b.bld && !b.std && !b.cl));
  }
  // 真的跑出多種款式(合成地形涵蓋市區/裸露地/水域三種)
  const used = new Set(segs.map((s) => s.kind));
  t(`合成地形上真的換了款(${[...used].map((k) => EW.WALL_KINDS[k].label).join('、')})`, used.size >= 3);
  t('水域段一定是水域款(合成地形的 z < −260 是一片水)',
    segs.filter((s) => s.water).length > 0
    && segs.filter((s) => s.water).every((s) => EW.WALL_KINDS[s.kind].dom === 'water'));
  t('水域段的落地基準抬到水面(否則海堤/貨輪整艘沉在水面下)',
    segs.filter((s) => s.water).every((s) => s.ground >= T.waterY - 1e-9));
  // 行為直測:合成地形上真的量到了三級坡,而且**每一段的款式都站得住它腳下那一級**
  const byTier = {};
  for (const s of segs) (byTier[s.tier] ??= []).push(s);
  t(`合成地形上三級坡都出現了(${EW.SLOPE_TIERS.map((k) => `${k} ${(byTier[k] || []).length} 段`).join(' / ')})`,
    EW.SLOPE_TIERS.every((k) => (byTier[k] || []).length > 0));
  const badTier = segs.filter((s) => rank(EW.WALL_KINDS[s.kind].slope) < rank(s.tier));
  t('每一段的款式都站得住它腳下那一級坡(這一條紅 = 有貨櫃車掛在崖面上)', badTier.length === 0,
    `（${badTier.slice(0, 3).map((s) => `${EW.WALL_KINDS[s.kind].label}@${s.tier}`).join(' / ')}）`);
  t(`陡坡段一律是自然景觀(${(byTier.steep || []).length} 段)`,
    (byTier.steep || []).every((s) => NATURAL.includes(s.kind)));
  t('中等坡段只出現自然景觀 / 倒木 / 長城',
    (byTier.mid || []).every((s) => NATURAL.includes(s.kind) || MID_EXTRA.includes(s.kind)));
}

// ============ Ⅷ 緩衝布景 + 視線邊界背景 ============
console.log('\nⅧ 假山／巨木林／假城／島礁收入權威邊界障礙環');
if (false) {
  emitted.length = 0;
  const nProps = B.buildBufferProps({ group, terrain: T });
  const propBoxes = emitted.slice();
  emitted.length = 0;
  const nBack = B.buildBackdrop({ group, terrain: T });
  const backBoxes = emitted.slice();
  t(`緩衝空間擺出「少許」3D 物件(${nProps} 件 / 深度 ${edgeBufferM().toFixed(0)}m 的一圈)`, nProps > 10 && nProps < 600);
  const inField = propBoxes.filter((b) => b.x0 > T.minX && b.x1 < T.maxX && b.z0 > T.minZ && b.z1 < T.maxZ);
  t('沒有任何一件落進地形範圍之內(內域是真地形的地盤,擺進去會跟真植被互穿)', inField.length === 0,
    `（${inField.length} 件）`);
  const buf = edgeBufferM();
  const outside = propBoxes.filter((b) => b.x0 < T.minX - buf - 60 || b.x1 > T.maxX + buf + 60
    || b.z0 < T.minZ - buf - 60 || b.z1 > T.maxZ + buf + 60);
  t('也沒有任何一件落到裙之外(擺在沒有地的地方 = 浮在虛空)', outside.length === 0, `（${outside.length} 件）`);
  t('四種緩衝物件各對應一種地貌(林塊 / 岩塊 / 聚落 / 礁岩)',
    Object.keys(EW.PROP_KINDS).length === 4
    && ['green', 'bare', 'urban', 'water'].every((b) => EW.PROP_KINDS[EW.propKindFor(b)].bio.includes(b)));
  t(`視線邊界背景鋪滿一圈(${nBack} 段)`, nBack > 8);
  t('四種背景 = 假山 / 假森林 / 假城市 / 假海(視陸域或水域而定)',
    ['mountain', 'forest', 'city', 'sea'].every((k) => EW.BACKDROP_KINDS[k])
    && EW.backdropKindFor('water') === 'sea' && EW.backdropKindFor('urban') === 'city'
    && EW.backdropKindFor('green') === 'forest' && EW.backdropKindFor('bare') === 'mountain');
  const hiF = Math.max(...Object.values(EW.BACKDROP_KINDS).map((k) => k.hF));
  t(`背景高度吃 objHeightMax()(${objHeightMax()}m)同一個天花板 ⇒ 永遠構不到世界天花板`, hiF <= 1 + 1e-9);
  // 高度**逐款在自己的局部座標裡**量(世界座標的 y 還含著裙的起伏,兩者混在一起量不到東西)
  let hiBad = [], lowBad = [], fillBad2 = [];
  for (const k of Object.keys(EW.BACKDROP_KINDS)) {
    const h = objHeightMax() * EW.BACKDROP_KINDS[k].hF;
    let top = -Infinity, bot = Infinity;
    for (let s = 1; s <= 40; s++) {
      for (const p of EW.backdropParts(k, { len: EW.EDGE_WALL.BACK_SEG_M, h, seed: s })) {
        const b = EW.partBox(p);
        top = Math.max(top, b.y1); bot = Math.min(bot, b.y0);
      }
    }
    if (top > h + 1e-6) hiBad.push(`${k} ${top.toFixed(0)}/${h.toFixed(0)}`);
    if (bot < -1e-6) lowBad.push(`${k} ${bot.toFixed(1)}`);
    if (top < h - 1) fillBad2.push(`${k} ${top.toFixed(0)}/${h.toFixed(0)}`);
  }
  t(`每一款背景的實際高度都收在自己宣告的高度內(≤ ${objHeightMax()}m 天花板)`, hiBad.length === 0, `（${hiBad.join(' / ')}）`);
  t('背景不長在地面以下(裙上看過去不會露出半截埋著的山)', lowBad.length === 0, `（${lowBad.join(' / ')}）`);
  t('宣告的高度真的用滿(hF 虛胖 = 天際線比設計的矮一截)', fillBad2.length === 0, `（${fillBad2.join(' / ')}）`);
  const backOut = backBoxes.filter((b) => b.x1 > T.minX && b.x0 < T.maxX && b.z1 > T.minZ && b.z0 < T.maxZ);
  t('背景整圈都在地形範圍之外(擋在可玩區裡就是一堵看得見打不到的假山)', backOut.length === 0);
  const backDist = Math.min(...backBoxes.map((b) => Math.max(
    T.minX - b.x1, b.x0 - T.maxX, T.minZ - b.z1, b.z0 - T.maxZ)));
  t(`背景落在緩衝深度的 ${EW.EDGE_WALL.BACK_INSET_F} 上(離圖界 ${backDist.toFixed(0)}m,腳下仍有裙)`,
    backDist > buf * 0.5 && backDist < buf);
  // 決定性
  emitted.length = 0;
  B.buildBufferProps({ group, terrain: T });
  t('緩衝布景決定性(跨客戶端逐位元一致 —— 靠座標雜湊,不是亂數序列)',
    JSON.stringify(emitted) === JSON.stringify(propBoxes));
  emitted.length = 0;
  B.buildBackdrop({ group, terrain: T });
  t('視線邊界背景決定性', JSON.stringify(emitted) === JSON.stringify(backBoxes));
  // 取不到裙的高度就整批跳過(原則 6:降級不例外,寧缺勿錯)
  t('拿不到 bufferHeightAt 就一件都不擺(寧缺勿錯,不憑空猜高度)',
    B.buildBufferProps({ group, terrain: { ...T, bufferHeightAt: null } }) === 0
    && B.buildBackdrop({ group, terrain: { ...T, bufferHeightAt: null } }) === 0);

  // ---- 逐零件落地:斜坡上不懸空、也不埋進去(2026-08-11 使用者定案「視線邊界的假山/假海/
  //      假森林/假城市也要在地形上放置好,在斜坡不要懸空」)----
  // 量法:給裙一個**有明顯坡度的平面**,逐顆零件把「世界 AABB 的底」與「它自己腳下的裙高度
  // + 它在局部座標裡的離地高」對照。逐零件落地 ⇒ 逐顆恰好吻合(±LAND_TOL);拿段心一個高度
  // 擺整段 ⇒ 一段 150m 的背景在 0.22 的坡上兩端差到 ±16m(`--break-land` 就是那個壞版本)。
  // 對應關係不靠稽核抄一份擺位公式:注入的規劃器/零件表把「這一顆是誰的第幾件」錄下來,
  // 而 `mergeGeos` 收到的順序就是 `emitWallParts` 推進批次的順序。
  {
    const TILT = { ...T, bufferHeightAt: (x, z) => 18 + (x - T.minX) * 0.22 + (z - T.minZ) * 0.14 };
    const LAND_TOL = 1e-6;
    const run = (which) => {
      let plan = [], n = 0;
      const rec = [];
      const take = (ps, sc, kind) => { for (const p of ps) rec.push({ p, sc, kind }); return ps; };
      const RB = mkWall('', {
        planBufferProps: (o) => (plan = EW.planBufferProps(o)),
        propParts: (k, s) => take(EW.propParts(k, s), plan[n]?.s ?? 1, plan[n++]?.kind),
        planBackdrop: (o) => (plan = EW.planBackdrop(o)),
        backdropParts: (k, o) => take(EW.backdropParts(k, o), 1, plan[n++]?.kind),
      });
      emitted.length = 0;
      (which === 'props' ? RB.buildBufferProps : RB.buildBackdrop)({ group, terrain: TILT });
      return { rec, boxes: emitted.slice() };
    };
    for (const [which, label] of [['props', '緩衝空間的 3D 物件'], ['back', '視線邊界背景']]) {
      const { rec, boxes } = run(which);
      // 水域款的落地基準刻意是海平面(礁岩露出水面 / 假海坐在海面上),不吃裙的坡度
      const AQ = new Set(['islet', 'sea']);
      let n = 0, worst = 0, worstK = '';
      for (let k = 0; k < Math.min(rec.length, boxes.length); k++) {
        if (AQ.has(rec[k].kind) || rec[k].p.r) continue;
        const b = boxes[k];
        const g = TILT.bufferHeightAt((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
        const d = Math.abs(b.y0 - (g + EW.partBox(rec[k].p).y0 * rec[k].sc));
        if (d > worst) { worst = d; worstK = rec[k].kind; }
        n++;
      }
      t(`${label}:零件數與批次逐一對應(${rec.length} 件)`, rec.length > 0 && rec.length === boxes.length);
      t(`${label}:逐零件坐在自己腳下那一點的裙上(${n} 件實測,最大偏差 ${worst.toFixed(3)}m ≤ ${LAND_TOL})`,
        n > 0 && worst <= LAND_TOL, `（最差 ${worstK}）`);
    }
  }
}
{
  const merged = {
    rockery: ['bare', false], giantforest: ['green', false],
    edgehamlet: ['urban', false], isletbarrier: ['water', true],
  };
  t('舊圖界外四類布景皆有對應的權威邊界障礙款',
    Object.entries(merged).every(([k, [bio, water]]) => EW.WALL_KINDS[k]
      && EW.wallCandidates(bio, water).includes(k)));
  t('四類新款的演出均由同一個有向碰撞盒承接',
    Object.keys(merged).every((k) => EW.WALL_KINDS[k].depth <= edgeWallDeepM()));
  t('正式建圖路徑不再發射純背景的 buildBufferProps / buildBackdrop',
    !bioCode.includes('const bufferProps =') && !bioCode.includes('const backdropSegs ='));
  t('緩衝裙深度介於最深障礙與其 1.5 倍之間',
    edgeBufferM() >= edgeWallDeepM() && edgeBufferM() <= edgeWallDeepM() * 1.5);
}

// ============ Ⅸ 邊界山脈雪線高度與山頂積雪接合 ============
console.log('\nⅨ 邊界山脈雪線高度與山頂積雪接合(四季變化 + 斜率貼合)');
{
  t('假山與懸崖共用完整四季色階',
    ['spring', 'summer', 'autumn', 'winter'].every((s) => typeof EW.ROCK_SEASON_TINT?.[s] === 'number'));
  for (const kind of ['rockery', 'cliff']) {
    const d = EW.WALL_KINDS[kind];
    const variants = ['spring', 'summer', 'autumn', 'winter'].map((season) => JSON.stringify(
      wallParts(kind, { len: WORLD_EDGE.SEG_M * WORLD_EDGE.SEG_LAP_F, depth: d.depth, h: d.h, seed: 17, season })));
    t(`${EW.WALL_KINDS[kind].label}四季幾何不動、岩色四種皆不同`, new Set(variants).size === 4);
  }
  t('MOUNTAIN_SNOWLINE 定義完整四季雪線(spring/summer/autumn/winter)',
    EW.MOUNTAIN_SNOWLINE && ['spring', 'summer', 'autumn', 'winter'].every((s) => typeof EW.MOUNTAIN_SNOWLINE[s] === 'number'));
  t('夏季雪線在天際線之上(summer ≥ 1.0 ⇒ 夏天無雪)',
    EW.MOUNTAIN_SNOWLINE.summer >= 1.0);
  t('四季雪線階梯符合常理(winter < spring < autumn < summer)',
    EW.MOUNTAIN_SNOWLINE.winter < EW.MOUNTAIN_SNOWLINE.spring
    && EW.MOUNTAIN_SNOWLINE.spring <= EW.MOUNTAIN_SNOWLINE.autumn
    && EW.MOUNTAIN_SNOWLINE.autumn < EW.MOUNTAIN_SNOWLINE.summer);

  const H = objHeightMax();
  const len = EW.EDGE_WALL.BACK_SEG_M;

  // 1. 夏季實測：0 個雪錐
  let summerSnowCount = 0;
  for (let s = 1; s <= 30; s++) {
    const parts = backdropParts('mountain', { len, h: H, seed: s, season: 'summer' });
    const snows = parts.filter((p) => p.c === 0xd8dee4);
    summerSnowCount += snows.length;
  }
  t(`夏季無雪(實測 30 個種子共 ${summerSnowCount} 個雪錐 === 0)`, summerSnowCount === 0);

  // 2. 冬季/春季/秋季實測階梯
  let winterSnowCount = 0, springSnowCount = 0, autumnSnowCount = 0;
  for (let s = 1; s <= 30; s++) {
    winterSnowCount += backdropParts('mountain', { len, h: H, seed: s, season: 'winter' }).filter((p) => p.c === 0xd8dee4).length;
    springSnowCount += backdropParts('mountain', { len, h: H, seed: s, season: 'spring' }).filter((p) => p.c === 0xd8dee4).length;
    autumnSnowCount += backdropParts('mountain', { len, h: H, seed: s, season: 'autumn' }).filter((p) => p.c === 0xd8dee4).length;
  }
  t(`冬季覆雪最多、春季次之、秋季初雪(冬 ${winterSnowCount} ≥ 春 ${springSnowCount} ≥ 秋 ${autumnSnowCount} > 夏 0)`,
    winterSnowCount >= springSnowCount && springSnowCount >= autumnSnowCount && autumnSnowCount > 0);

  // 3. 斜率與頂點貼合測試
  let slopeMisaligned = 0, apexMisaligned = 0, flareOut = 0;
  for (let s = 1; s <= 40; s++) {
    const parts = backdropParts('mountain', { len, h: H, seed: s, season: 'winter' });
    // 找出山稜錐體與其對應的雪錐（同 x 座標）
    const mtnCones = parts.filter((p) => p.p?.[2] < 0 && p.c !== 0xd8dee4 && p.g?.[0] === 'cone');
    const snowCones = parts.filter((p) => p.c === 0xd8dee4 && p.g?.[0] === 'cone');
    for (const sc of snowCones) {
      const mc = mtnCones.find((m) => Math.abs(m.p[0] - sc.p[0]) < 1e-3);
      if (!mc) { slopeMisaligned++; continue; }
      const mH = mc.g[2], mR = mc.g[1];
      const sH = sc.g[2], sR = sc.g[1];
      const mApex = mc.p[1] + mH / 2;
      const sApex = sc.p[1] + sH / 2;
      // 頂點必須完全對齊山頂
      if (Math.abs(mApex - sApex) > 1e-4) apexMisaligned++;
      // 雪錐斜率 (sR / sH) 必須與山稜斜率 (mR / mH) 等比貼合（容許 1% 微幅擴張防止 z-fighting，上限 1.025）
      const mSlope = mR / mH;
      const sSlope = sR / sH;
      const ratio = sSlope / mSlope;
      if (ratio < 0.99 || ratio > 1.025) slopeMisaligned++;
      // 底面半徑不得外突擴散
      if (sR > mR * (sH / mH) * 1.025) flareOut++;
    }
  }
  t('雪錐頂點與山頂完全重合(0 處偏移)', apexMisaligned === 0, `（實得 ${apexMisaligned} 處）`);
  t('雪錐斜率嚴格等比貼合山稜(1.00 ~ 1.025×, 0 處不吻合)', slopeMisaligned === 0, `（實得 ${slopeMisaligned} 處）`);
  t('雪冠無外擴懸空/飛碟狀突出(0 處外突)', flareOut === 0, `（實得 ${flareOut} 處）`);
}

for (const [f, m] of [['--break-lap', '段長重疊係數 < 1,Ⅱ MUST 紅字'],
  ['--break-buffer', '緩衝深度砍半,Ⅰ・Ⅴ MUST 紅字'],
  ['--break-fit', '型錄多一件頂出盒子的零件,Ⅲ・Ⅶ MUST 紅字'],
  ['--break-face', '抽掉貼著內面的實體零件,Ⅶ MUST 紅字'],
  ['--break-run', '拿掉「太長就換一款」,Ⅶ MUST 紅字'],
  ['--break-boxh', '盒高改回逐款一個值,Ⅲ MUST 紅字(素牆頂上的空氣)'],
  ['--break-slope', '每一款都改成三級都站得住,Ⅶ MUST 紅字(崖面上的貨櫃車)'],
  ['--break-bias', '抽掉起伏帶自然障礙加權,Ⅶ MUST 紅字'],
  ['--break-rock-season', '假山與懸崖四季同色,Ⅸ MUST 紅字'],
  ['--break-facility-support', '陸域光電塞回整段底座,Ⅶ MUST 紅字'],
  ['--break-redraw', '抽掉本輪邊界重繪辨識零件,Ⅶ MUST 紅字'],
  ['--break-facility-gap', '補滿非連續大型設施間的透明縫,Ⅶ MUST 紅字'],
  ['--break-facility-mix', '關掉同類設施逐節混排,Ⅶ MUST 紅字'],
  ['--break-shared-catalog', '抽掉獨立物件分類,Ⅶ MUST 紅字'],
  ['--break-glass', '抽掉建築玻璃與透明批次,Ⅲ・Ⅶ MUST 紅字'],
  ['--break-snow-summer', '夏季出現覆雪,Ⅸ MUST 紅字(夏天無雪契約破壞)'],
  ['--break-snow-slope', '雪錐斜率失真外突,Ⅸ MUST 紅字(山頂雪錐外擴懸空)']]) {
  if (process.argv.includes(f)) console.log(`\n（${f}:${m}）`);
}
console.log(`\n${fail === 0 ? '🎉' : '❌'} 世界邊界稽核:${pass} 通過 / ${fail} 失敗`);
process.exit(fail === 0 ? 0 : 1);
