// ============ 場址配置規則(都市計畫 / 樹冠羞避 / 地質排列;唯一縫)============
// 2026-08-03 使用者定案三條,三個地貌各一條:
//   ① **市區**:建築沿道路整齊排列,遵循都市規劃的原則來設計,包含公園、運動場、停車場等公設
//   ② **綠地**:多個神木組成森林,遵循 Crown shyness(樹冠羞避)的規則設置
//   ③ **裸露地**:巨石依地質特性緊密排列,形成壯麗景觀
//
// 三條共通的形狀是「**排列規則**」而不是「畫什麼」:哪裡放得下、放幾個、彼此隔多遠、
// 朝哪個方向 —— 全是純幾何。故整支模組的前半段 **零 THREE**(同 `beacons.js` 的紀律③),
// 落點一律只問一個 `probe(...)` 回呼:規劃器不認得地形、不認得 `blocked`、不認得 `occ`,
// 呼叫端把那些全收在回呼裡。這才是本項能離線稽核的原因(three 走 CDN、A2 不准進
// `package.json` ⇒ 規則若寫成 `new THREE.Mesh(...)` 就只能靠真瀏覽器驗,而規則正是會
// 靜默壞掉的那一半:少了退縮就是街牆歪斜、少了冠緣間隙就是樹冠糊成一團、少了走向就是
// 巨石亂擺 —— 沒有任何錯誤訊息)。
//
// ---- 四條紀律 ----
//   ① **零共享 `rnd()` 消耗**(§2.3;同 `beacons.js`):街廓配置與公設的外觀差異一律由
//      **落點/序號雜湊**決定(`plotSeed`/`frac`),不動 `biomes.js` 那條共享的 mulberry32
//      序列 ⇒ 這一項的存在與否**不會推移**任何一株植被、任何一棟圖資建物的佈局。
//      `frac()` 是「同一枚種子取第 n 個分量」的雜湊,不是亂數序列產生器 —— 需要序列請走
//      `rng.js mulberry32`(全專案唯一縫),MUST NOT 拿這裡的雜湊當 PRNG 用。
//   ② **門朝街的公式只有一份** `roadFaceRy()`:`biomes.js nearestRoadAngle`(圖資建物/補間)
//      與本檔的臨街配置同吃。兩份實作的症狀是「同一條街上,圖資樓與新配置的樓朝向差 180°」。
//   ③ **臨街面對齊的是「建築線」不是「中心線」**:進深逐棟不同,對齊中心 ⇒ 立面前後參差
//      (正是使用者說的「不整齊」);故排距 `ROW_PITCH` 定死、中心 = 建築線 + 自身進深一半。
//   ④ **公設是開放空間,不是實心塊**:草坪/跑道/柏油面 MUST NOT 登記碰撞柱(登記了就是
//      「看得見的空地走不進去」);只有真正有量體的零件(涼亭/看台/燈柱/收費亭/停放車輛)
//      才掛,而且半徑一律由零件表**實算**(`partCollider`,原則 4 / A30:看到多粗 = 撞到多粗)。
import * as THREE from 'three';
import { envMat, toonMat, bakeContactAO } from './toon.js';
import { partExtent, mergeGeos } from './beacons.js';

// ============================================================================
// §A 都市計畫(市區:沿街配置 + 街廓 + 公設)
// ============================================================================

/**
 * 街廓配置參數(遊戲公尺;世界 = 真實 ×2 ⇒ 這裡的數字是真實街廓的兩倍尺度)。
 *
 * 都市規劃的四件事全在這張表上,每一項都對應一個「少了它就會發生的難看」:
 *   SETBACK  建築線退縮 —— 少了它,樓貼著車道邊緣長,街道沒有人行空間
 *   PITCH    臨街單元節奏 —— 少了它,沿街間距忽寬忽窄
 *   ROW_PITCH 排距(進深上限 + 巷弄)—— 少了它,後棟深淺不一,巷弄不成直線
 *   END_PAD  路口留白 —— 少了它,樓長到路口上,轉角視線全被擋死
 */
export const URBAN = {
  SETBACK: 9,          // 建築線退縮:自車道邊緣(hw)量起(m)
  PITCH: 27,           // 臨街單元節奏:相鄰臨街建物中心距(m)
  FRONT_W: [13, 23],   // 面寬(沿街;m)
  DEPTH: [12, 19],     // 進深(垂直街道;m)—— 上限 MUST ≤ ROW_PITCH − ALLEY
  ALLEY: 11,           // 前後棟之間的巷弄淨寬(m)
  ROW_PITCH: 30,       // 排距 = 進深上限 + 巷弄(推導;見 DEPTH/ALLEY 的不變式)
  ROWS: 2,             // 每側排數(臨街棟 + 後棟)
  END_PAD: 16,         // 路口留白:線段兩端各留這麼長不配置(m)
  VACANT: 0.14,        // 空地率:留白破除連續街牆(也是後續公設/植栽的餘裕)
  MAIN_COMM: 0.74,     // 幹道臨街單元的商業比
  SIDE_COMM: 0.16,     // 支道臨街單元的商業比
  BACK_COMM: 0.06,     // 後棟(非臨街)的商業比 —— 商辦臨街、住宅在後,是分區的基本形
  MIN_SEG: 70,         // 太短的路段(路口碎段/彎道細分)不配置(m)
  // 全圖臨街配置上限(棟)。這個數字的天花板不是美觀而是 `LOS.MAX_OCC`(4000):建物一律
  // 登記碰撞柱並上傳伺服器當 LOS 遮蔽,超過就被 `slice(0, MAX_OCC)` 靜默截斷 = 後排建物
  // 在伺服器眼裡不存在(打得穿)。與 MAX_BUILDINGS(240)+ MAX_INFILL(1200)加總留足餘裕。
  MAX: 600,
};

/** 街廓配置的推導不變式:進深上限 + 巷弄 = 排距(手寫兩份就會出現「巷弄被樓吃掉」) */
export const urbanRowPitch = () => URBAN.DEPTH[1] + URBAN.ALLEY;

/**
 * 公設(公園 / 運動場 / 停車場)。
 * `w` 沿街、`d` 進深、`foot` = 外接半徑(規劃期預留空間 = `foot + PAD`)。
 * `flat` = 要求的地表落差上限(m):公園/球場/停車場在現實裡就是整過的平地,
 * 坡地上硬鋪一塊大平板不是「公設」是「浮空板」⇒ 寧缺勿錯(原則 6)。
 */
export const CIVIC = {
  EVERY: 4,     // 每 N 個臨街單元挑 1 個當公設候選
  UNITS: 3,     // 一處公設佔掉的臨街單元數(該側)
  PAD: 6,       // 落點在既有淨空之外還要留的餘裕(m)
  SEP: 200,     // 公設彼此最小間距(m):同一條街不連著三座公園
  MAX: 9,       // 全圖上限
};

export const CIVIC_KINDS = {
  park: { w: 64, d: 44, foot: 39, flat: 3.2 },    // 公園
  pitch: { w: 76, d: 48, foot: 45, flat: 2.4 },   // 運動場(跑道 + 球場)
  lot: { w: 52, d: 36, foot: 32, flat: 2.0 },     // 停車場
};

/** 輪替序:同一張圖三款都出得來(由沿街序號輪,不是抽籤 ⇒ 不會整張圖全是停車場) */
export const CIVIC_ORDER = ['park', 'lot', 'pitch'];

/**
 * 落點/序號 → 確定性種子(零共享亂數消耗;雜湊形狀同 `beacons.js beaconSeed`)。
 * 四個輸入攤成一個整數再雜湊 —— 段序 × 單元序 × 側別 × 排序 唯一決定一塊基地。
 */
export function plotSeed(si, k, side, row) {
  const a = (si * 73856093) ^ (k * 19349663) ^ ((side > 0 ? 1 : 0) * 83492791) ^ (row * 2971215073);
  const h = Math.imul(a | 0, 0x9E3779B1);
  return Math.imul(h ^ (h >>> 15), 0xC2B2AE3D) >>> 0;
}

/**
 * 同一枚種子取第 `salt` 個分量 → [0,1)。
 * **這是雜湊不是亂數序列**:同 (seed, salt) 恆為同值、不同 salt 之間無關聯,
 * 但它沒有序列狀態 ⇒ MUST NOT 拿來取代 `rng.js mulberry32`(§2.3 的抽樣紀律講的是序列)。
 */
export function frac(seed, salt) {
  let h = Math.imul((seed ^ Math.imul(salt + 1, 0x27D4EB2F)) | 0, 0x85EBCA77);
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const lerpRange = ([lo, hi], t) => lo + (hi - lo) * t;

/**
 * 「門朝街」的朝向(**唯一縫**;2026-07-25 使用者需求「建築門口一定對準道路」)。
 *
 * 建物 local +x 沿街道切線(順著道路整齊排列)、local +z = 門/正立面。
 * `u` = 街道單位切向;`side` = 建物落在街道的哪一側(+1 / −1,即法線 `(-uz, ux) × side`)。
 * 面向街道的法線因此是 `(uz, -ux) × side`,three 的 `rotation.y` 使世界 +z =(sin ry, cos ry)
 * 對上它 ⇒ `ry = atan2(uz·side, -ux·side)`。
 *
 * `biomes.js nearestRoadAngle`(圖資建物 / 補間街廓)與本檔的臨街配置 MUST 全吃這一支:
 * 兩份實作差一個負號的症狀是「同一條街上有一半的樓背對著路」,而且只在某些場地現形。
 */
export function roadFaceRy(ux, uz, side) {
  return Math.atan2(uz * side, -ux * side);
}

/**
 * 街廓配置(**唯一縫**;純幾何、零亂數序列、零 THREE ⇒ 離線稽核直接跑得動)。
 *
 * 沿每一條街段等距切出臨街單元,兩側各鋪 `ROWS` 排:
 *   - **建築線對齊**:第 r 排的臨街立面一律落在 `hw + SETBACK + r × ROW_PITCH` 上,
 *     中心 = 建築線 + 自身進深一半 ⇒ 進深不同的樓,**立面仍在同一條線上**(紀律③)
 *   - **路口留白**:兩端各 `END_PAD` 不配置,整排置中 ⇒ 留白對稱
 *   - **公設優先**:每 `CIVIC.EVERY` 個單元挑一個當公設候選,吃掉該側 `CIVIC.UNITS` 個
 *     單元;公設放得下就跳過那幾棟樓(這是「街廓裡先劃公設用地,再劃建築基地」的順序,
 *     反過來做的話公設永遠只能撿建築剩下的畸零地)
 *   - **分區**:幹道臨街 → 商業;支道與後棟 → 住宅(`MAIN_COMM`/`SIDE_COMM`/`BACK_COMM`)
 *
 * @param segs      [{x1,z1,x2,z2,hw,main}] 街道線段(遊戲公尺;hw = 車道半寬)
 * @param probeLot  (x, z, w, d, ry) => boolean —— 這塊建築基地放得下嗎
 * @param probeCivic(x, z, kind, foot) => boolean —— 這處公設用地放得下嗎(含平坦度)
 * @returns { plots: [{x,z,ry,w,d,commercial,row,seed}], civics: [{x,z,ry,kind,seed}] }
 */
export function planBlocks({ segs = [], probeLot, probeCivic, opts = {} }) {
  const o = { ...URBAN, ...opts };
  const c = { ...CIVIC, ...(opts.civic || {}) };
  const plots = [], civics = [];
  for (let si = 0; si < segs.length; si++) {
    if (plots.length >= o.MAX) break;
    const sg = segs[si];
    const dx = sg.x2 - sg.x1, dz = sg.z2 - sg.z1;
    const L = Math.hypot(dx, dz);
    if (L < o.MIN_SEG) continue;                       // 路口碎段/彎道細分段不配置
    const ux = dx / L, uz = dz / L;
    const n = Math.floor((L - o.END_PAD * 2) / o.PITCH) + 1;
    if (n < 1) continue;
    const span = (n - 1) * o.PITCH;
    const t0 = (L - span) / 2;                          // 整排置中 ⇒ 兩端留白對稱
    // ---- 先劃公設用地(該側連續 UNITS 個單元)----
    const taken = new Map();   // `${side}:${k}` -> 1(被公設吃掉的臨街單元)
    for (let k = 0; k < n; k += c.EVERY) {
      if (civics.length >= c.MAX) break;
      const seed = plotSeed(si, k, 1, 9);
      const side = frac(seed, 0) < 0.5 ? 1 : -1;
      const kind = CIVIC_ORDER[(si + Math.floor(k / c.EVERY)) % CIVIC_ORDER.length];
      const def = CIVIC_KINDS[kind];
      // 佔用單元置中在 k 上;超出線段就不擺(邊界外的公設會半截落在路口)
      const k0 = k - Math.floor((c.UNITS - 1) / 2);
      if (k0 < 0 || k0 + c.UNITS > n) continue;
      const tc = t0 + (k0 + (c.UNITS - 1) / 2) * o.PITCH;
      const off = sg.hw + o.SETBACK + def.d / 2;
      const nx = -uz * side, nz = ux * side;
      const cx = sg.x1 + ux * tc + nx * off, cz = sg.z1 + uz * tc + nz * off;
      if (civics.some((p) => Math.hypot(cx - p.x, cz - p.z) < c.SEP)) continue;
      if (!probeCivic(cx, cz, kind, def.foot + c.PAD)) continue;
      civics.push({ x: cx, z: cz, ry: roadFaceRy(ux, uz, side), kind, seed });
      for (let u = 0; u < c.UNITS; u++) taken.set(`${side}:${k0 + u}`, 1);
    }
    // ---- 再劃建築基地 ----
    for (let k = 0; k < n && plots.length < o.MAX; k++) {
      const t = t0 + k * o.PITCH;
      const bx = sg.x1 + ux * t, bz = sg.z1 + uz * t;
      for (const side of [1, -1]) {
        if (taken.has(`${side}:${k}`)) continue;        // 這一格是公設用地
        const nx = -uz * side, nz = ux * side;
        const ry = roadFaceRy(ux, uz, side);
        for (let row = 0; row < o.ROWS && plots.length < o.MAX; row++) {
          const seed = plotSeed(si, k, side, row);
          if (frac(seed, 3) < o.VACANT) continue;       // 空地:破除連續街牆
          const w = lerpRange(o.FRONT_W, frac(seed, 1));
          const d = lerpRange(o.DEPTH, frac(seed, 2));
          const cr = frac(seed, 4);
          const commercial = row === 0
            ? cr < (sg.main ? o.MAIN_COMM : o.SIDE_COMM)
            : cr < o.BACK_COMM;
          // 建築線 = hw + SETBACK + row × ROW_PITCH;中心 = 建築線 + 自身進深一半(紀律③)
          const off = sg.hw + o.SETBACK + row * o.ROW_PITCH + d / 2;
          const x = bx + nx * off, z = bz + nz * off;
          if (!probeLot(x, z, w, d, ry)) continue;
          plots.push({ x, z, ry, w, d, commercial, row, seed });
        }
      }
    }
  }
  return { plots, civics };
}

// ---- 公設零件表(純資料;規格同 `beacons.js KIND_PARTS`,外廓共用 `partExtent`)----
// `col: 1` = 這件有量體、要登記碰撞柱(紀律④);沒有這面旗的一律是可走進去的鋪面/低矮件。
// 座標系:+x 沿街、+z 面向街道(與 `roadFaceRy` 定義的建物朝向同框)。
const _row = (n, f) => Array.from({ length: n }, (_, i) => f(i));

export const CIVIC_PARTS = {
  // 公園:草坪 + 十字步道 + 水池 + 涼亭(有量體)+ 長椅/花圃(低矮,不擋路)
  park: [
    { g: ['box', 62, 0.5, 42], c: 0x5f8a4a, p: [0, -0.25, 0] },              // 草坪
    { g: ['box', 62, 0.56, 4.6], c: 0xbfae90, p: [0, -0.2, -6] },            // 橫向步道
    { g: ['box', 4.6, 0.56, 42], c: 0xbfae90, p: [8, -0.2, 0] },             // 縱向步道
    { g: ['cyl', 7.2, 7.2, 0.62, 12], c: 0x4c7f96, p: [-17, -0.18, 8] },     // 水池
    { g: ['cyl', 7.8, 7.8, 0.4, 12], c: 0x9aa0a6, p: [-17, -0.34, 8] },      // 池緣石
    // 涼亭:六角柱列 + 錐頂(全園唯一有量體的結構)
    ..._row(6, (i) => ({
      g: ['cyl', 0.3, 0.3, 3.6, 6], c: 0x8a6a48,
      p: [19 + Math.cos(i / 6 * Math.PI * 2) * 3.4, 1.8, 9 + Math.sin(i / 6 * Math.PI * 2) * 3.4],
    })),
    { g: ['cyl', 4.4, 4.4, 0.3, 6], c: 0x7a5a3c, p: [19, 3.75, 9], col: 1 },
    { g: ['cone', 4.6, 2.4, 6], c: 0xa8503c, p: [19, 5.1, 9] },
    // 長椅(座面 + 兩腳;0.9m 高,與灌木同級 ⇒ 不掛碰撞)
    ..._row(4, (i) => ({ g: ['box', 3.2, 0.22, 0.9], c: 0x8a6a48, p: [-20 + i * 13, 0.86, -9.4] })),
    ..._row(4, (i) => ({ g: ['box', 3.2, 0.7, 0.16], c: 0x7a5a3c, p: [-20 + i * 13, 1.2, -9.85] })),
    // 花圃
    ..._row(3, (i) => ({ g: ['box', 7, 0.7, 3.2], c: 0xc06a7a, p: [-6 + i * 12, 0.1, 15] })),
    { g: ['cyl', 0.16, 0.2, 5.2, 6], c: 0x585e64, p: [-2, 2.6, -12] },       // 園燈
    { g: ['ico', 0.5], c: 0xffe9b0, p: [-2, 5.4, -12], e: 1 },
  ],
  // 運動場:PU 跑道 + 內場草皮 + 球門 + 看台(有量體)+ 照明燈柱(有量體)
  pitch: [
    { g: ['box', 74, 0.5, 46], c: 0xa8503c, p: [0, -0.25, 0] },              // 跑道鋪面
    { g: ['box', 58, 0.56, 34], c: 0x4f8246, p: [0, -0.2, 0] },              // 內場草皮
    { g: ['box', 58, 0.6, 0.4], c: 0xe8ecef, p: [0, -0.17, 0] },             // 中線
    { g: ['cyl', 5.2, 5.2, 0.6, 16], c: 0xe8ecef, p: [0, -0.18, 0] },        // 中圈
    { g: ['cyl', 4.9, 4.9, 0.62, 16], c: 0x4f8246, p: [0, -0.17, 0] },
    // 球門(細桿,不掛碰撞 —— 掛了就是球門後面那條看不見的牆)
    ..._row(2, (i) => ({ g: ['box', 0.32, 3.4, 0.32], c: 0xe8ecef, p: [(i ? 1 : -1) * 27, 1.7, -3.6] })),
    ..._row(2, (i) => ({ g: ['box', 0.32, 3.4, 0.32], c: 0xe8ecef, p: [(i ? 1 : -1) * 27, 1.7, 3.6] })),
    ..._row(2, (i) => ({ g: ['box', 0.32, 0.32, 7.5], c: 0xe8ecef, p: [(i ? 1 : -1) * 27, 3.4, 0] })),
    // 看台:三階 + 遮棚(整體有量體)
    ..._row(3, (i) => ({ g: ['box', 40, 1.1, 2.8], c: 0xb9bec4, p: [0, 0.55 + i * 1.1, -20 - i * 2.8], col: 1 })),
    ..._row(2, (i) => ({ g: ['cyl', 0.34, 0.34, 7.5, 6], c: 0x8d949c, p: [(i ? 1 : -1) * 17, 3.75, -27] })),
    { g: ['box', 40, 0.4, 9], c: 0x51585f, p: [0, 7.6, -24.5] },             // 遮棚頂
    // 照明燈柱(四角)
    ..._row(4, (i) => ({
      g: ['cyl', 0.42, 0.55, 18, 6], c: 0x8d949c, col: 1,
      p: [(i % 2 ? 1 : -1) * 34, 9, (i < 2 ? 1 : -1) * 21],
    })),
    ..._row(4, (i) => ({
      g: ['box', 3.6, 1.2, 0.5], c: 0xffe9b0, e: 1,
      p: [(i % 2 ? 1 : -1) * 34, 18.4, (i < 2 ? 1 : -1) * 21],
    })),
  ],
  // 停車場:柏油面 + 車格白線 + 收費亭(有量體)+ 停放車輛(有量體)+ 燈桿
  lot: [
    { g: ['box', 50, 0.5, 34], c: 0x3f4348, p: [0, -0.25, 0] },              // 柏油
    { g: ['box', 50, 0.54, 0.3], c: 0xe0e4e8, p: [0, -0.22, 0] },            // 中央通道邊線
    ..._row(10, (i) => ({ g: ['box', 0.3, 0.54, 10.4], c: 0xe0e4e8, p: [-22.5 + i * 5, -0.22, -7.4] })),
    ..._row(10, (i) => ({ g: ['box', 0.3, 0.54, 10.4], c: 0xe0e4e8, p: [-22.5 + i * 5, -0.22, 7.4] })),
    // 停放車輛(車體 + 車頂;各自登記碰撞柱 —— 停車場裡的車是實心的)
    ..._row(5, (i) => ({ g: ['box', 2.2, 1.35, 4.8], c: [0xb4553c, 0x3f6f7a, 0xa8a08c, 0x7d8a4a, 0x51585f][i], p: [-20 + i * 5, 0.68, -7.4], col: 1 })),
    ..._row(5, (i) => ({ g: ['box', 2.0, 0.9, 2.4], c: [0x93412c, 0x335b64, 0x8b8474, 0x67723c, 0x41474d][i], p: [-20 + i * 5, 1.75, -7.8] })),
    ..._row(4, (i) => ({ g: ['box', 2.2, 1.35, 4.8], c: [0x3f6f7a, 0xa8a08c, 0xb4553c, 0x7d8a4a][i], p: [2.5 + i * 5, 0.68, 7.4], col: 1 })),
    ..._row(4, (i) => ({ g: ['box', 2.0, 0.9, 2.4], c: [0x335b64, 0x8b8474, 0x93412c, 0x67723c][i], p: [2.5 + i * 5, 1.75, 7.0] })),
    // 收費亭 + 柵欄 + 燈桿
    { g: ['box', 2.6, 3.0, 2.6], c: 0xd8d2c4, p: [-23, 1.5, 14.5], col: 1 },
    { g: ['box', 3.0, 0.3, 3.0], c: 0x51585f, p: [-23, 3.15, 14.5] },
    { g: ['box', 7.0, 0.24, 0.24], c: 0xd94f3d, p: [-18, 1.5, 14.5] },
    ..._row(2, (i) => ({ g: ['cyl', 0.22, 0.28, 9, 6], c: 0x585e64, p: [(i ? 1 : -1) * 16, 4.5, 0], col: 1 })),
    ..._row(2, (i) => ({ g: ['box', 2.4, 0.45, 0.6], c: 0xffe9b0, e: 1, p: [(i ? 1 : -1) * 16, 9.1, 0] })),
  ],
};

/** 公園的行道樹落點(local;交給 `biomes.js` 走既有植被 InstancedMesh,不另建 mesh) */
export const CIVIC_TREES = {
  park: [[-26, -16, 1.05], [-26, 16, 0.95], [26, -16, 1.0], [26, 16, 1.1],
    [-9, 18, 0.9], [13, -17, 1.0], [0, -18, 0.85]],
  pitch: [[-35, -6, 0.9], [35, 6, 0.95]],
  lot: [[-24, -15, 0.85], [24, 15, 0.9]],
};

/** 一款公設的實算水平外廓(m)= 逐件取最大;稽核以此驗 `CIVIC_KINDS[k].foot` 沒有低報 */
export function civicExtent(kind) {
  return (CIVIC_PARTS[kind] || []).reduce((m, p) => Math.max(m, partExtent(p)), 0);
}

/**
 * 有量體零件 → 碰撞體(local;純幾何)。原則 4 / A30:尺寸一律**實算**,標稱尺寸只用在
 * 規劃期預留空間。
 *
 * **方盒 MUST 回有向盒**(`hw2/hd2/ry`),圓只當 broad-phase 且 MUST 是外接半對角(A30):
 * 看台是 40m × 2.8m 的長條,只登記一顆 r=20 的圓柱就是「球場中央有一片 40m 直徑的隱形圓」
 * —— 撞得到卻看不見,與 A30 那條(看得見卻打不到)是同一族的反面。
 * 圓斷面(cyl/cone/ico)本來就是圓,不帶 hw2。
 */
export function partCollider(part) {
  const [t, a, b, c] = part.g;
  const [px = 0, py = 0, pz = 0] = part.p || [];
  const [, ry = 0] = part.r || [];
  const h = t === 'box' ? b : t === 'cyl' ? c : t === 'cone' ? b : a * 2;
  if (t === 'box') {
    return { px, pz, r: Math.hypot(a, c) / 2, hw2: a / 2, hd2: c / 2, ry, h: py + h / 2 };
  }
  const r = t === 'cyl' ? Math.max(a, b) : a;
  return { px, pz, r, h: py + h / 2 };
}

/** 一款公設要登記的碰撞柱(local);沒有 `col` 旗標的鋪面/低矮件一律不列(紀律④) */
export function civicColliders(kind) {
  return (CIVIC_PARTS[kind] || []).filter((p) => p.col).map(partCollider);
}

// ============================================================================
// §B 樹冠羞避(綠地:多個神木組成森林)
// ============================================================================

/**
 * Crown shyness(樹冠羞避)—— 相鄰喬木的冠緣互不相接,林冠上留下一道道裂隙。
 *
 * 兩個旋鈕就夠了,而且各自有明確語意:
 *   GAP_M  冠緣間隙的固定底(m):兩株再矮也要留這麼多
 *   GAP_F  間隙隨樹高遞增的係數:高樹搖擺幅度大,裂隙也大(這正是羞避的成因)
 * 塞不下就**縮冠**(降體格)而不是直接淘汰 —— 使用者要的是「森林」,一律淘汰會把
 * 群落打成稀疏散株;縮到 `FIT_MIN` 以下才放棄(那已經不是神木了)。
 */
export const CROWN = {
  GAP_M: 3.0,       // 冠緣最小間隙(m)
  GAP_F: 0.06,      // 間隙 ∝ 較矮那株的樹高
  FIT_MIN: 0.62,    // 縮冠下限(佔原體格)
  LEAN: 0.075,      // 遠離鄰冠的傾斜上限(吃既有 tx/tz 欄位)
  LEAN_R: 2.2,      // 傾斜的感應半徑倍率(× 自身冠幅)
};

/** 兩株之間的冠緣間隙(m):由較矮那株的樹高決定(推導,MUST NOT 逐株手寫) */
export function crownGap(hi, hj, o = CROWN) {
  return o.GAP_M + o.GAP_F * Math.min(hi, hj);
}

/**
 * 樹冠羞避的群落配置(**唯一縫**;純幾何、零亂數、零 THREE)。
 *
 * 逐株掃過候選(順序即優先序:呼叫端把群心那株排第一),對每一株求出「不碰到任何
 * 已接受鄰株冠緣」的最大體格,取 `min(原體格, 上限)`:
 *
 *     dist ≥ cr_i·s_i + cr_j·s_j + gap(h_i·s_i, h_j·s_j)
 *
 * gap 依賴 s_i 本身 ⇒ 以**候選原體格**估 gap(保守:實際縮小後 gap 只會更小 ⇒ 不變式
 * 恆成立),再解 s_i。縮到 `FIT_MIN` 以下就丟掉。
 *
 * 另回傳 `lean`(遠離鄰冠的單位向量 × 幅度):羞避的成因就是枝梢感受到鄰株遮蔽而
 * 偏離 —— 樹身微微朝空隙側傾,林相才不是一排直挺挺的柱子。
 *
 * @param cands [{x,z,s,cr,h,...}] cr/h = **體格 1.0 時**的冠幅半徑與樹高(m)
 * @returns [{...cand, s, lean:[tx,tz], shy:boolean}] —— shy = 這株被縮過冠
 */
export function planShyGrove(cands = [], opts = {}) {
  const o = { ...CROWN, ...opts };
  const out = [];
  for (const c of cands) {
    const cr = c.cr || 0, h = c.h || 0;
    let s = c.s;
    for (const p of out) {
      const dist = Math.hypot(c.x - p.x, c.z - p.z);
      const room = dist - p.cr * p.s - crownGap(h * c.s, p.h * p.s, o);
      if (room <= 0) { s = 0; break; }
      if (cr > 0) s = Math.min(s, room / cr);
    }
    if (s < c.s * o.FIT_MIN) continue;
    // 遠離鄰冠:感應半徑內的鄰株各貢獻一個反向單位向量,合成後夾在 LEAN 內
    let lx = 0, lz = 0;
    const rr = Math.max(1e-6, cr * s * o.LEAN_R);
    for (const p of out) {
      const dx = c.x - p.x, dz = c.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d <= 1e-6 || d > rr + p.cr * p.s) continue;
      const wgt = 1 - Math.min(1, d / (rr + p.cr * p.s));
      lx += (dx / d) * wgt; lz += (dz / d) * wgt;
    }
    const lm = Math.hypot(lx, lz);
    const lean = lm > 1e-6
      ? [(lx / lm) * o.LEAN * Math.min(1, lm), (lz / lm) * o.LEAN * Math.min(1, lm)]
      : [0, 0];
    out.push({ ...c, s, lean, shy: s < c.s - 1e-9 });
  }
  return out;
}

// ============================================================================
// §C 地質排列(裸露地:巨石依地質特性緊密排列)
// ============================================================================

/**
 * 岩體露頭的排列規則。
 *
 * 「依地質特性」在這裡是具體的三件事,不是形容詞:
 *   ① **走向(strike)**:層面/節理面與水平面的交線 —— 露頭沿走向成排,而走向在地形上
 *      就是**等高線方向**(傾向 = 最大坡降方向)。故走向由地形梯度推導,MUST NOT 亂抽。
 *   ② **節理間距(joint spacing)**:垂直走向的一組平行裂隙把岩體切成板狀,相鄰排錯位
 *      半個間距(磚砌式錯縫)—— 這是節理岩體最好認的特徵。
 *   ③ **同源同相**:一片露頭出自同一岩層 ⇒ 同一種岩、長軸同向、體格自核心往外遞減
 *      (核心抗風化殘留最多)。
 */
export const ROCKFIELD = {
  ROWS: 3,          // 沿節理方向的排數
  PER_ROW: 3,       // 每排的岩塊數
  ROW_SKEW: 0.5,    // 相鄰排沿走向的錯位(× 走向間距)= 磚砌錯縫
  PACK: 1.18,       // 緊密度:相鄰岩塊中心距 = 標稱直徑 × 此值(> 1 = 不互穿、又不散開)
  JITTER: 0.14,     // 落點抖動(× 間距;確定性雜湊,非亂數)
  RY_JIT: 0.16,     // 長軸方位抖動(rad):同一組節理,不是同一個模子
  FALL: 0.34,       // 體格自核心往外的遞減比(0 = 不遞減)
  GAP_M: 3,         // 同片露頭內,相鄰岩體碰撞柱之間的最小淨距(m)—— 緊密的界線是「不互穿」
  FIELDS: 3,        // 全圖露頭群數上限
  SEP: 420,         // 露頭群彼此最小間距(m)
};

/**
 * 地形梯度 → 走向角(rad;方向向量 =(cosθ, sinθ))。
 * 走向 ⟂ 傾向(最大坡降),故取梯度的法向。梯度趨近零(平地)時走向無意義 ⇒ 回 null,
 * 呼叫端改用落點雜湊給一個定值(原則 6:寧可退化成任意定向,也不要每格跳一個方向)。
 */
export function strikeRad(gx, gz, eps = 1e-4) {
  if (Math.hypot(gx, gz) < eps) return null;
  return Math.atan2(gx, -gz);
}

/**
 * 露頭群配置(**唯一縫**;純幾何、零亂數、零 THREE)。
 *
 * 以 `pitch`(= 標稱岩體直徑 × `PACK`)為格距,沿走向鋪 `PER_ROW` 個、垂直走向鋪 `ROWS` 排,
 * 相鄰排沿走向錯開 `ROW_SKEW × pitch`。回傳序**由核心往外**(呼叫端逐一驗淨空/水域/平坦度,
 * 先放進去的是最該保住的那幾顆)。
 *
 * @param cx,cz  露頭群中心
 * @param strike 走向角(rad)
 * @param pitch  格距(m)= 標稱岩體直徑 × PACK
 * @param seed   落點種子(外觀/抖動;零共享亂數)
 * @returns [{x,z,ry,sf,ord}] —— sf = 體格係數(核心 1.0 → 外緣 1−FALL)
 */
export function planRockField({ cx, cz, strike, pitch, seed = 1, opts = {} }) {
  const o = { ...ROCKFIELD, ...opts };
  const ca = Math.cos(strike), sa = Math.sin(strike);
  const cells = [];
  const r0 = (o.ROWS - 1) / 2, c0 = (o.PER_ROW - 1) / 2;
  for (let r = 0; r < o.ROWS; r++) {
    // 錯縫的相位 MUST 以**中央排**為基準(`Math.floor(r0)`),不是以 r=0 為基準:
    // 排數為奇數時 r0 是整數,拿 `r % 2` 當相位會讓中央排被錯開半格 ⇒ 露頭群的正中央
    // 沒有岩塊、體格係數也永遠取不到 1(核心最大的設計當場失效,而畫面上只是「中間空空的」)。
    const skew = (((r - Math.floor(r0)) % 2) + 2) % 2 === 1 ? o.ROW_SKEW : 0;
    for (let k = 0; k < o.PER_ROW; k++) {
      const u = (k - c0 + skew) * pitch;                       // 沿走向
      const v = (r - r0) * pitch;                              // 垂直走向(節理間距)
      cells.push({ u, v, d: Math.hypot(u, v) });
    }
  }
  cells.sort((a, b) => a.d - b.d || a.u - b.u || a.v - b.v);    // 由核心往外(同距者定序,確定性)
  const far = Math.max(1e-6, cells[cells.length - 1].d);
  return cells.map((c, i) => {
    const s2 = plotSeed(seed & 0xffff, i, 1, 3);
    const ju = (frac(s2, 1) - 0.5) * 2 * o.JITTER * pitch;
    const jv = (frac(s2, 2) - 0.5) * 2 * o.JITTER * pitch;
    const u = c.u + ju, v = c.v + jv;
    return {
      x: cx + ca * u - sa * v,
      z: cz + sa * u + ca * v,
      ry: strike + (frac(s2, 3) - 0.5) * 2 * o.RY_JIT,          // 長軸同向(同一組節理)
      sf: 1 - o.FALL * (c.d / far),                             // 核心大、外緣小
      ord: i,
    };
  });
}

// ---- 建構(以下才需要 THREE)----
const _geo = (spec) => {
  const [t, a, b, c] = spec;
  if (t === 'box') return new THREE.BoxGeometry(a, b, c);
  if (t === 'cyl') return new THREE.CylinderGeometry(a, b, c, spec[4] || 6);
  if (t === 'cone') return new THREE.ConeGeometry(a, b, spec[3] || 6);
  return new THREE.IcosahedronGeometry(a, 0);
};

/**
 * 建一處公設。零件依顏色分桶合併(同 `beacons.js buildBeacon`:一處公設 3~6 個 draw call,
 * 逐塊一個 mesh 的話光是停車場的車格白線就 20 個)。
 * 反轉外殼描邊刻意不掛 —— 世界的線由 `postfx.js` 的螢幕空間勾線 pass 蓋全場。
 */
export function buildCivic(kind) {
  const g = new THREE.Group();
  const parts = CIVIC_PARTS[kind] || CIVIC_PARTS.park;
  const buckets = new Map();
  for (const p of parts) {
    const key = `${p.c}|${p.e ? 1 : 0}`;
    const geo = _geo(p.g);
    const m = new THREE.Matrix4();
    const [px = 0, py = 0, pz = 0] = p.p || [];
    const [rx = 0, ry = 0, rz = 0] = p.r || [];
    m.compose(
      new THREE.Vector3(px, py, pz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(1, 1, 1),
    );
    geo.applyMatrix4(m);
    if (!buckets.has(key)) buckets.set(key, { c: p.c, e: !!p.e, geos: [] });
    buckets.get(key).geos.push(geo);
  }
  for (const b of buckets.values()) {
    const merged = mergeGeos(b.geos);
    const mat = b.e
      ? toonMat(b.c, { emissive: b.c, emissiveIntensity: 1.0 })
      : envMat(b.c, { wash: 0.5, cool: 0.4, rim: 0 });
    g.add(new THREE.Mesh(merged, mat));
  }
  bakeContactAO(g, 2.6);
  g.userData.civic = kind;
  return g;
}
