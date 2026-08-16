// ============ 載具 / 擺件型錄(唯一縫)============
// 2026-08-16 序 10(③-1 SPEC 列 + ③-2 真凹處 + ③-3 可視角)。
//
// 病灶(落地前實測):同一台「車」有**四份**互不相同的手寫副本 —— `hazards.js BUILDERS.wreck`
// (唯一有輪子的那一份)、`biomes.js car()`(封路車禍)、`siteplan.js CIVIC_PARTS.lot`
// (唯一登記碰撞柱的那一份)、`ground.js DETAIL_DEFS.carwreck`;同一個「貨櫃」有四份
// (`beacons.depot` 6.1m / `edgewall.ship` ~5.8m / `edgewall.trucks` 貨車廂 / `ground.container`
// 2.7m);「列車」有兩份(`biomes.makeTrain` / `edgewall.train`)。尺寸從 1.71m 到 6.1m,
// 其中三份車連輪子都沒有 —— 那不是「風格差異」,那是四個人各畫了一次(原則 2 的反面)。
//
// 本檔把它收斂成**同一個形狀的第二支型錄**(第一支是 `edgewall.js`:零 import 型錄 +
// `wallParts` 生成器 + `partBox`/`wallFit`/`wallFaceCover` 三支離線量尺),而不是另發明一套。
//
// ---- 六條紀律(每一條壞掉都沒有錯誤訊息)----
//  ① **零 import、零 THREE**:零件是 `['box', w,h,d]` 這種**描述子**(同 `edgewall.js` 紀律①、
//     `beacons.js` 紀律③、`siteplan.js CIVIC_PARTS` 的格式)。這才是「這一台車收不收得進
//     宿主宣告的盒子」離線量得到的原因 —— 寫成 `new THREE.Mesh(...)` 就只能靠真瀏覽器看,
//     而那正是會靜默壞掉的一半(車輪半埋、車體頂出停車格、鏡子穿出碰撞盒)。
//     ⚠ 連 `rng.js` 都不 import:`makeVehicle` 是**純函式**(零亂數),同款不同台的差異
//     一律由呼叫端把顏色/尺寸/塌陷度**傳進來**(呼叫端自己有座標雜湊或區域序列)。
//  ② **宿主宣告盒子,型錄宣告形狀**:`makeVehicle(kind, { fit })` 的 `fit` 與
//     `wallParts(kind, { len, depth, h })` 是同一條紀律 —— 停車格 4.8×2.2、`WALL_KINDS.train`
//     的 depth 3.4、`BEACON_KINDS.depot.foot` 6.0 都是**既有的碰撞契約**,型錄 MUST 讓開;
//     反過來,那些數字 MUST NOT 在型錄裡再寫一次(兩份遲早分家)。省略 `fit` = 用真實公稱尺寸。
//  ③ **輪拱 / 保險桿 / 燈 / 車牌 / 接縫 / 後照鏡一律由 SPEC 的十一個數推導**,
//     MUST NOT 逐款手寫 —— 手寫值與型錄脫鉤之後,改一次 `R` 就是「輪子浮在輪拱外面」,
//     而每一條既有斷言照樣全綠(`audit_vehicle_spec` Ⅰ/Ⅱ 就是為這一條寫的)。
//  ④ **正面朝向的約定只有一條**:沿 **+x authored、鼻頭在 +x**、原點在足跡中心的**地面**
//     (y = 0 = 輪子觸地面)⇒ `ry` 就是車頭朝向。反過來寫的症狀是「一整排停車場的車
//     全部倒著停」,而每一條既有斷言照樣全綠。
//  ⑤ **深度往外堆,不往內挖**(③-2):`makeRecess` 回傳的是**加法**零件(楣樑 / 兩側側返 /
//     檻),量體本身一格不動 ⇒ 任何一片零件的最小 z 恆 ≥ 量體前緣。往內挖的症狀是
//     「面板整片消失」(寫在實心面後面),不報錯。
//  ⑥ **可視角是幾何不是感覺**(③-3):凹處要「看得進去」,`atan(H/D)` MUST ≥ 站在自己
//     碰撞半徑外緣時的俯角。淺而深的凹槽(0.17 高 × 0.135 深 = 38°)在站立高度上
//     **看不到底**,做了等於沒做。
//
// ---- 與 `edgewall.partBox` 的關係(MUST 讀)----
// 本檔的 `partAABB()` 與 `edgewall.js partBox()` 算的是同一件事(零件在局部座標的 AABB)。
// 現況是**知情的暫時兩份**:`edgewall.js` 由 `audit_world_edge.mjs:572` 釘死「只 import
// rng.js 一支」⇒ 在那一條放寬成「rng.js + vehicles.js」之前,edgewall 不能轉呼本檔。
// 兩份之間的防線 = `audit_vehicle_spec` Ⅻ **逐案例數值交叉比對**(刀與尺不同源)。
// 接上 edgewall 的那一輪 MUST 把 `edgewall.partBox` 改成
// `import { partAABB as partBox } from './vehicles.js'; export { partBox };`(同 hazards.js
// 對 `mulberry32` 的 idiom:純轉出不建立本地繫結 ⇒ MUST 是 import + export 兩行)。

// ---- 推導常數(**不是**逐款美術值:改一格就是全型錄一起動)----
export const VEHICLE = {
  FILL_TOL: 0.18,     // 零件 ⊆ 宣告 L×W×H 的**下界**容差:實測外廓 ≥ (1 − FILL_TOL) × 宣告
  //                     (宣告虛胖 = 停車格白線畫得比車大一圈 / 碰撞盒比看得見的車寬)
  TIRE_WF: 0.62,      // 胎寬 = R × 這個數
  WHEEL_SEG: 8,       // 輪子的圓柱分段(與舊制 hazards 的 cyl(.,.,.,8) 同值)
  ARCH_F: 1.28,       // 輪拱外緣半徑 = R × 這個數
  GROOVE_WF: 0.97,    // 腰線 / 貨櫃浪板肋是**內凹的溝**不是外貼的條:寬 = W × 這個數。
  //                     外貼(> 1)就是「看得見的那一片在碰撞盒外面」(A30 家族),
  //                     而車身那一件正是唯一帶 col 的那一件 ⇒ 車身 MUST 佔滿宣告寬。
  CAB_WF: 0.92,       // 車艙寬 = W × 這個數(車艙恆窄於車身 ⇒ 側面看得到肩線)
  GLASS_F: 0.86,      // 車窗佔車艙長的比例
  GLASS_HF: 0.62,     // 車窗佔車艙高的比例
  BELT_T: 0.06,       // 腰線飾條厚
  BUMP_T: 0.22,       // 保險桿厚(沿 x)
  BUMP_HF: 0.42,      // 保險桿高 = (waist − sill) × 這個數
  BUMP_WF: 0.98,      // 保險桿寬 = W × 這個數
  LIGHT_W: 0.34,      // 燈寬(沿 z)
  LIGHT_H: 0.20,
  LIGHT_ZF: 0.34,     // 燈心離中線 = W × 這個數
  PLATE_W: 0.52,
  PLATE_H: 0.14,
  MIR_L: 0.16,        // 後照鏡(沿 x)
  MIR_W: 0.22,        // 後照鏡(沿 z;**恆在 W 之內** ⇒ 宣告寬含後照鏡,同真實車規)
  MIR_H: 0.12,
  RIB_PITCH: 0.32,    // 貨櫃浪板肋條節距(m)
  RIB_T: 0.05,
  TIRE_C: 0x1c1f22,
  GLASS_C: 0x27313a,
  CHROME_C: 0x9aa2a8,
  LAMP_F: 0xf2e6c0,
  LAMP_R: 0xc4432f,
  CAB_DARK: 0.85,     // 車艙色 = 車身色 × 這個數(**推導**:同一台車一定同一批漆)
};

// ---- SPEC 型錄(**真實公稱尺寸**,§2.5)----
// 十一個欄位就是全部:`L/W/H` 外廓、`R` 輪半徑、`axle` 軸位(沿 x 的世界公尺)、
// `sill/waist/roof` 三條水平線、`cab` 車艙前後界、`rakeF/rakeR` 前後斜切比、
// `side` 側面接縫帶(離地高度區間)、`extra` 語彙。其餘一切**推導**(紀律③)。
//   `R = 0`  ⇒ 沒有輪子(貨櫃);`cab[0] === cab[1]` ⇒ 沒有車艙(方正貨體)。
export const VEHICLE_SPEC = {
  // 轎車:唯一有輪子的那一份手寫副本(`hazards.wreck`)是本列的基準值 —— R 0.34、軸距 2.7
  sedan: {
    L: 4.80, W: 1.90, H: 1.45, R: 0.34,
    axle: [-1.35, 1.35], sill: 0.42, waist: 0.95, roof: 1.45,
    cab: [-1.05, 0.72], rakeF: 0.34, rakeR: 0.20, side: [0.48, 0.90],
    extra: ['mirror'],
  },
  // 貨車:車頭在 +x、貨箱在後(`edgewall.trucks` 那一份的收斂目標)
  truck: {
    L: 12.00, W: 2.55, H: 4.00, R: 0.52,
    axle: [-3.40, 4.30], sill: 1.02, waist: 1.34, roof: 4.00,
    cab: [3.10, 5.90], rakeF: 0.10, rakeR: 0.00, side: [1.10, 1.30],
    extra: ['mirror', 'boxbody'],
  },
  // 鐵路車廂:轉向架 + 車頂空調 + 集電弓(`biomes.makeTrain` 與 `edgewall.train` 的收斂目標)
  railcar: {
    L: 20.00, W: 2.95, H: 3.85, R: 0.43,
    axle: [-6.50, 6.50], sill: 1.02, waist: 1.95, roof: 3.35,
    cab: [-9.60, 9.60], rakeF: 0.06, rakeR: 0.06, side: [1.60, 2.60],
    extra: ['bogie', 'panto'],
  },
  // 20ft ISO 貨櫃:6.058 × 2.438 × 2.591(真實公稱)
  container20: {
    L: 6.058, W: 2.438, H: 2.591, R: 0,
    axle: [], sill: 0, waist: 2.591, roof: 2.591,
    cab: [0, 0], rakeF: 0, rakeR: 0, side: [0.20, 2.39],
    extra: ['boxbody', 'corrugate'],
  },
  // 40ft ISO 貨櫃:12.192 × 2.438 × 2.591
  container40: {
    L: 12.192, W: 2.438, H: 2.591, R: 0,
    axle: [], sill: 0, waist: 2.591, roof: 2.591,
    cab: [0, 0], rakeF: 0, rakeR: 0, side: [0.20, 2.39],
    extra: ['boxbody', 'corrugate'],
  },
};

/** 型錄鍵(推導,MUST NOT 在消費端手寫名冊)*/
export function vehicleKinds() { return Object.keys(VEHICLE_SPEC); }

// ---- 顏色算術(零 import ⇒ 自己來;逐分量乘,不是 HSL)----
const mulHex = (c, f) => {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
};

/**
 * 依 `fit` 把一列 SPEC 等比縮進宿主宣告的盒子(紀律②)。
 * 三軸各自縮放 —— 停車格是 4.8 × 2.2(比真車寬),硬要等比就會變短一截。
 */
function fitSpec(s, fit) {
  if (!fit) return s;
  const fx = fit.L ? fit.L / s.L : 1;
  const fy = fit.H ? fit.H / s.H : 1;
  const fz = fit.W ? fit.W / s.W : 1;
  const rf = Math.min(fy, fz);      // 輪子是圓的:半徑只能跟著較嚴的那一軸,否則輪子頂出盒子
  return {
    ...s,
    L: s.L * fx, W: s.W * fz, H: s.H * fy, R: s.R * rf,
    axle: s.axle.map((v) => v * fx),
    sill: s.sill * fy, waist: s.waist * fy, roof: s.roof * fy,
    cab: s.cab.map((v) => v * fx),
    side: s.side.map((v) => v * fy),
  };
}

/**
 * 生成一台載具的**零件描述子**(紀律③:除了 SPEC 的十一個數,一個尺寸都不准手寫)。
 *
 * @param {string} kind      `VEHICLE_SPEC` 的鍵
 * @param {object} opts
 *   `fit`   {L,W,H} 宿主宣告的盒子(省略 = 真實公稱尺寸)
 *   `lod`   0 = 車身 + 車艙 / 1 = + 輪子與保險桿 / 2 = 全部(預設 2)
 *   `paint` 車身色(省略 = 型錄預設灰)
 *   `cabC`  車艙色(省略 = 由 `paint` **推導** × `VEHICLE.CAB_DARK`)
 *   `crush` 1 = 完好、< 1 = 車頂塌陷比(車禍殘骸;純幾何,零亂數)
 *   `at`    [x,y,z] 擺放點(車輪觸地面 = at[1])
 *   `ry`    車頭朝向(弧度;紀律④ ⇒ 0 = 鼻頭指 +x)
 *   `col`/`vc`/`opt`/`sf` 直接帶進**車身**那一件(`siteplan.CIVIC_PARTS` 的四個語意通道;
 *       `col` 只給車身 —— 給每一件就是「一台車九根碰撞柱」,給不到就是走得進去的實心車)
 * @returns 零件描述子陣列(格式同 `CIVIC_PARTS` / `KIND_PARTS` / `edgewall.PARTS`)
 */
export function makeVehicle(kind, opts = {}) {
  const base = VEHICLE_SPEC[kind] || VEHICLE_SPEC.sedan;
  const s = fitSpec(base, opts.fit);
  const lod = opts.lod ?? 2;
  const crush = opts.crush ?? 1;
  const paint = opts.paint ?? 0x9aa0a6;
  const cabC = opts.cabC ?? mulHex(paint, VEHICLE.CAB_DARK);
  const V = VEHICLE;
  const rows = [];
  const bodyH = Math.max(0.02, s.waist - s.sill);
  const cabL = s.cab[1] - s.cab[0];
  const cabH = Math.max(0, s.roof - s.waist) * crush;
  const hasCab = cabL > 1e-6 && cabH > 1e-6;
  const noseX = s.L / 2, tailX = -s.L / 2;

  // ① 車身(唯一帶 col 的那一件:碰撞盒 = 看得見的量體)
  rows.push({
    g: ['box', s.L, bodyH, s.W], c: paint, p: [0, s.sill + bodyH / 2, 0],
    ...(opts.col ? { col: opts.col } : {}), ...(opts.vc ? { vc: opts.vc } : {}),
    ...(opts.opt ? { opt: opts.opt } : {}), ...(opts.sf ? { sf: opts.sf } : {}),
  });
  // ② 前後斜切(引擎蓋 / 行李廂):`rake` 是比例,楔形長度與傾角一起由它推導
  //    —— rake = 0 ⇒ 這一件不生(方正貨體、貨櫃)
  for (const [rake, sx] of [[s.rakeF, 1], [s.rakeR, -1]]) {
    if (rake <= 1e-6) continue;
    const wl = s.L * rake * 0.5;                 // 楔形長
    const wt = bodyH * 0.5;                      // 楔形厚
    const tilt = sx * rake * 0.5;
    // 轉過之後的半長(|R| 的第一列)—— 用它把楔形往內縮到恰好貼齊鼻頭,
    // 而不是「先擺好再祈禱沒頂出去」(頂出去 = 看得見的車頭打不到)
    const hxr = Math.abs(Math.cos(tilt)) * wl / 2 + Math.abs(Math.sin(tilt)) * wt / 2;
    rows.push({
      g: ['box', wl, wt, s.W * V.GROOVE_WF], c: paint,
      p: [sx * (s.L / 2 - hxr), s.waist + wt * 0.18, 0],
      r: [0, 0, tilt],
    });
  }
  // ③ 車艙 + 車窗(塌陷比只壓車艙 ⇒ `crush` 不動車身,車禍殘骸與完好車同一份幾何)
  if (hasCab) {
    // 車艙也帶 `col`:碰撞柱是**一疊**不是一顆(同 A46 ① 的整棟量體剖面)——
    // 只登記車身那一顆的話,車頂那一截是「看得見卻撞不到」的空氣。
    rows.push({
      g: ['box', cabL, cabH, s.W * V.CAB_WF], c: cabC,
      p: [(s.cab[0] + s.cab[1]) / 2, s.waist + cabH / 2, 0],
      ...(opts.col ? { col: opts.col } : {}), ...(opts.vc ? { vc: opts.vc } : {}),
    });
    if (lod >= 2) rows.push({
      g: ['box', cabL * V.GLASS_F, cabH * V.GLASS_HF, s.W * V.CAB_WF * 1.004], c: V.GLASS_C,
      p: [(s.cab[0] + s.cab[1]) / 2, s.waist + cabH * (1 - V.GLASS_HF / 2) - cabH * 0.06, 0],
    });
  }
  // ④ 輪子 + 輪拱:軸心 y === R(觸地是構造保證,不是擺出來的)
  const tireW = s.R * V.TIRE_WF;
  const wz = s.W / 2 - tireW / 2;
  const axles = s.R > 0 ? (s.extra.includes('bogie')
    // 轉向架:一座兩軸,軸距由輪半徑推導(真實轉向架軸距 ≈ 5.8 × 輪半徑)
    ? s.axle.flatMap((a) => [a - s.R * 2.9, a + s.R * 2.9])
    : s.axle) : [];
  // 輪軸沿 **z**(車頭在 +x ⇒ 輪軸垂直於行進方向)⇒ 圓柱繞 **x** 躺平,MUST NOT 繞 z:
  // 繞 z 躺平的話輪軸落在車身長軸上 = 輪子側著滾,而畫面上要轉到某個角度才看得出來。
  if (lod >= 1) for (const ax of axles) for (const sz of [-1, 1]) {
    rows.push({
      g: ['cyl', s.R, s.R, tireW, V.WHEEL_SEG], c: V.TIRE_C,
      p: [ax, s.R, sz * wz], r: [Math.PI / 2, 0, 0],
    });
  }
  // 輪拱:半徑 / 寬 / 高全部由 R 推導,而**橫向位置由自己的寬反推**貼齊車身外緣
  //(沿用輪心的 z 會讓拱比輪子寬那一截頂出宣告盒 = 看得見卻撞不到)
  const archW = tireW * 1.22;
  if (lod >= 2) for (const ax of axles) for (const sz of [-1, 1]) {
    rows.push({
      g: ['box', s.R * V.ARCH_F * 2, Math.max(0.04, s.R * 0.14), archW], c: mulHex(paint, 0.72),
      p: [ax, Math.min(s.waist, s.R * V.ARCH_F), sz * (s.W / 2 - archW / 2)],
    });
  }
  // ⑤ 保險桿 / 燈 / 車牌 / 後照鏡 / 腰線(全部由 sill/waist/side/cab 推導)
  if (lod >= 1 && s.R > 0) for (const sx of [1, -1]) {
    rows.push({
      g: ['box', V.BUMP_T, bodyH * V.BUMP_HF, s.W * V.BUMP_WF], c: mulHex(paint, 0.62),
      p: [sx * (s.L / 2 - V.BUMP_T / 2), s.sill + bodyH * V.BUMP_HF / 2, 0],
    });
  }
  if (lod >= 2 && s.R > 0) {
    for (const sx of [1, -1]) for (const sz of [-1, 1]) {
      rows.push({
        g: ['box', V.BUMP_T * 0.7, V.LIGHT_H, V.LIGHT_W], c: sx > 0 ? V.LAMP_F : V.LAMP_R,
        p: [sx * (s.L / 2 - V.BUMP_T * 0.35), s.waist - V.LIGHT_H, sz * s.W * V.LIGHT_ZF], e: 1,
      });
    }
    for (const sx of [1, -1]) {
      rows.push({
        g: ['box', V.BUMP_T * 0.5, V.PLATE_H, V.PLATE_W], c: 0xe6e2d8,
        p: [sx * (s.L / 2 - V.BUMP_T * 0.25), s.sill + bodyH * 0.32, 0],
      });
    }
  }
  if (lod >= 2) {
    // 側面接縫帶(`side` 那兩個數就是它的上下界)
    const bandH = Math.max(0.02, s.side[1] - s.side[0]);
    rows.push({
      g: ['box', s.L * 0.99, V.BELT_T, s.W * V.GROOVE_WF], c: mulHex(paint, 0.55),
      p: [0, s.side[0] + bandH * 0.5, 0],
    });
    if (hasCab && s.extra.includes('mirror')) for (const sz of [-1, 1]) {
      rows.push({
        g: ['box', V.MIR_L, V.MIR_H, V.MIR_W], c: mulHex(paint, 0.7),
        p: [s.cab[1], s.waist + cabH * 0.62, sz * (s.W / 2 - V.MIR_W / 2)],
      });
    }
  }
  // ⑥ extra 語彙(不是第二張表:每一款只是「這個語彙的幾何由哪幾個數推導」)
  if (s.extra.includes('corrugate') && lod >= 2) {
    const n = Math.max(2, Math.round(s.L / V.RIB_PITCH));
    for (let i = 0; i < n; i++) {
      const x = -s.L / 2 + (i + 0.5) * (s.L / n);
      rows.push({
        g: ['box', V.RIB_T, s.H * 0.92, s.W * V.GROOVE_WF], c: mulHex(paint, 0.78),
        p: [x, s.H * 0.5, 0],
      });
    }
    // 端門(貨櫃的門一律在 −x 那一端 ⇒ 鼻頭約定對貨櫃也成立)
    rows.push({
      g: ['box', V.RIB_T * 1.6, s.H * 0.94, s.W * 0.96], c: mulHex(paint, 0.66),
      p: [tailX + V.RIB_T, s.H * 0.5, 0],
    });
  }
  if (s.extra.includes('panto') && lod >= 2) {
    rows.push({ g: ['box', s.L * 0.10, 0.30, s.W * 0.52], c: V.CHROME_C, p: [s.L * 0.30, s.roof + 0.15, 0] });
    rows.push({ g: ['box', s.L * 0.02, 0.06, s.W * 0.70], c: V.CHROME_C, p: [s.L * 0.30, s.roof + 0.33, 0] });
    // 車頂空調(沿 x 兩座)
    for (const sx of [-1, 1]) {
      rows.push({ g: ['box', s.L * 0.14, 0.24, s.W * 0.60], c: mulHex(paint, 0.9), p: [sx * s.L * 0.22, s.roof + 0.12, 0] });
    }
  }
  if (s.extra.includes('boxbody') && lod >= 1 && hasCab) {
    // 貨箱與車頭之間的擋風導流罩(由 cab 與 roof 推導)
    rows.push({
      g: ['box', s.L * 0.05, (s.roof - s.waist) * 0.34, s.W * V.CAB_WF * 0.96], c: mulHex(paint, 0.92),
      p: [s.cab[0] - s.L * 0.025, s.roof - (s.roof - s.waist) * 0.17, 0],
    });
  }
  if (s.extra.includes('port')) rows.push(...makeRecess({
    W: s.W * 0.5, H: Math.min(s.H * 0.62, s.waist), D: RECESS.MIN_D,
    at: [noseX, s.sill, 0], c: mulHex(paint, 0.5),
  }));
  return opts.at || opts.ry ? placeParts(rows, opts.at, opts.ry) : rows;
}

// ---- 剛體擺放:Euler 的合成 MUST 走矩陣,MUST NOT 寫 `ry0 + ry` ----
// A26/A27 那一族最貴的一個坑:three 的 Euler 'XYZ' 是 `Rx·Ry·Rz`,而整株轉向要的是
// **左乘** `Ry(θ)·R0`。只有在 `rx0 === 0` 時兩者才恰好等於「ry 那一格相加」;
// 一旦零件自己帶了 `rx`(輪子躺平就是),相加會讓輪軸**不隨車頭轉**(θ = 45° 時
// 車身斜著、輪子還朝正前方),而所有既有斷言照樣全綠 —— 那正是「差正負號 / 差 90°」。
const _rotMul = (r0, th) => {
  const [x, y, z] = r0;
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y);
  const e = Math.cos(z), f = Math.sin(z);
  // R0 = Rx·Ry·Rz(three 的 'XYZ';列 = m1*, m2*, m3*)
  const m = [
    [c * e, -c * f, d],
    [a * f + b * e * d, a * e - b * f * d, -b * c],
    [b * f - a * e * d, b * e + a * f * d, a * c],
  ];
  // 左乘 three 的 Ry(θ) = [[cs,0,sn],[0,1,0],[-sn,0,cs]]
  const cs = Math.cos(th), sn = Math.sin(th);
  const n = [
    [cs * m[0][0] + sn * m[2][0], cs * m[0][1] + sn * m[2][1], cs * m[0][2] + sn * m[2][2]],
    [m[1][0], m[1][1], m[1][2]],
    [-sn * m[0][0] + cs * m[2][0], -sn * m[0][1] + cs * m[2][1], -sn * m[0][2] + cs * m[2][2]],
  ];
  // 再抽回 XYZ Euler(逐字同 three 的 Euler.setFromRotationMatrix)
  const cl = Math.max(-1, Math.min(1, n[0][2]));
  const ry1 = Math.asin(cl);
  if (Math.abs(n[0][2]) < 0.9999999) {
    return [Math.atan2(-n[1][2], n[2][2]), ry1, Math.atan2(-n[0][1], n[0][0])];
  }
  return [Math.atan2(n[2][1], n[1][1]), ry1, 0];
};

/**
 * 把一組零件整株擺到 `at` / 轉 `ry`(**剛體**:位置與朝向一起轉,同 A27 的紀律)。
 * 旋轉與 three 的 `Ry(θ)` 逐字同號:(x,z) → (x·cos + z·sin, −x·sin + z·cos) ⇒
 * 鼻頭 +x 轉到 (cos θ, 0, −sin θ),與 `mesh.rotation.y = θ` 的結果逐位元相同。
 */
export function placeParts(rows, at = [0, 0, 0], ry = 0) {
  const [ax = 0, ay = 0, az = 0] = at || [];
  const cs = Math.cos(ry), sn = Math.sin(ry);
  return rows.map((p) => {
    const [px = 0, py = 0, pz = 0] = p.p || [];
    const r0 = p.r || [0, 0, 0];
    const nx = px * cs + pz * sn, nz = -px * sn + pz * cs;
    const out = { ...p, p: [ax + nx, ay + py, az + nz] };
    if (r0[0] || r0[1] || r0[2] || ry) out.r = ry ? _rotMul(r0, ry) : [r0[0] || 0, r0[1] || 0, r0[2] || 0];
    return out;
  });
}

// ---- 三支離線量尺(純幾何;對應 `edgewall.js` 的 partBox / wallFit / wallFaceCover)----

const _absR = (rx, ry, rz) => {
  const cx = Math.cos(rx), sx = Math.abs(Math.sin(rx));
  const cy = Math.cos(ry), sy = Math.abs(Math.sin(ry));
  const cz = Math.cos(rz), sz = Math.abs(Math.sin(rz));
  const ax = Math.abs(cx), ay = Math.abs(cy), az = Math.abs(cz);
  return [
    [ay * az, ay * sz, sy],
    [sx * sy * az + ax * sz, Math.abs(sx * sy * sz) + ax * az, sx * ay],
    [Math.abs(ax * sy * az) + sx * sz, ax * sy * sz + sx * az, ax * ay],
  ];
};

/**
 * 零件在**局部座標**的 AABB:{ x0,x1, y0,y1, z0,z1 }。純幾何、無 three。
 * ⚠ 與 `edgewall.js partBox` 是同一條規則的兩份實作(見檔頭「與 edgewall.partBox 的關係」)
 *   —— `audit_vehicle_spec` Ⅻ 逐案例數值交叉比對兩支,直到 edgewall 轉呼本支為止。
 */
export function partAABB(part) {
  const [t, a, b, c] = part.g;
  let hx, hy, hz;
  if (t === 'box') { hx = a / 2; hy = b / 2; hz = c / 2; }
  else if (t === 'cyl') { hx = Math.max(a, b); hy = c / 2; hz = Math.max(a, b); }
  else if (t === 'cone') { hx = a; hy = b / 2; hz = a; }
  else { hx = hy = hz = a; }
  const [px = 0, py = 0, pz = 0] = part.p || [];
  const [rx = 0, ry = 0, rz = 0] = part.r || [];
  if (rx || ry || rz) {
    const M = _absR(rx, ry, rz);
    const h = [hx, hy, hz];
    const o = M.map((row) => row[0] * h[0] + row[1] * h[1] + row[2] * h[2]);
    [hx, hy, hz] = o;
  }
  return { x0: px - hx, x1: px + hx, y0: py - hy, y1: py + hy, z0: pz - hz, z1: pz + hz };
}

/** 一組零件的合成 AABB */
export function partsAABB(rows) {
  const o = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const p of rows) {
    const b = partAABB(p);
    o.x0 = Math.min(o.x0, b.x0); o.x1 = Math.max(o.x1, b.x1);
    o.y0 = Math.min(o.y0, b.y0); o.y1 = Math.max(o.y1, b.y1);
    o.z0 = Math.min(o.z0, b.z0); o.z1 = Math.max(o.z1, b.z1);
  }
  return o;
}

/** 一款(或一組零件)的實測外廓 {L, W, H} + AABB */
export function vehicleBox(kind, opts = {}) {
  const rows = Array.isArray(kind) ? kind : makeVehicle(kind, opts);
  const b = partsAABB(rows);
  return { ...b, L: b.x1 - b.x0, W: b.z1 - b.z0, H: b.y1 - b.y0 };
}

/**
 * 零件表收不收得進宣告的 `L × W × H`(同 `edgewall.wallFit` 的三軸雙向夾)。
 * `ox/oy/oz` = 三軸各自頂出去多少(m;≤ 0 = 沒頂出);`fill` = 三軸各自的填充率。
 * 兩個方向都要:**頂出**是「看得見的東西打不到 / 撞不到」(A30 家族);
 * **虛胖**是「宣告的格子比車大一圈」—— 停車格白線與碰撞盒都吃那個宣告值。
 */
export function vehicleFit(kind, opts = {}) {
  const rows = Array.isArray(kind) ? kind : makeVehicle(kind, opts);
  const s = fitSpec(VEHICLE_SPEC[Array.isArray(kind) ? (opts.kind || 'sedan') : kind] || VEHICLE_SPEC.sedan, opts.fit);
  const b = partsAABB(rows);
  const ox = Math.max(b.x1 - s.L / 2, -s.L / 2 - b.x0);
  const oy = Math.max(b.y1 - s.H, -b.y0);
  const oz = Math.max(b.z1 - s.W / 2, -s.W / 2 - b.z0);
  const fill = [(b.x1 - b.x0) / s.L, (b.y1 - b.y0) / s.H, (b.z1 - b.z0) / s.W];
  return {
    fit: ox <= 1e-9 && oy <= 1e-9 && oz <= 1e-9,
    full: fill.every((f) => f >= 1 - VEHICLE.FILL_TOL - 1e-9),
    ox, oy, oz, fill, decl: { L: s.L, W: s.W, H: s.H },
  };
}

// ============================================================================
// ③-2 真凹處(往外堆,不往內挖)
// ============================================================================
export const RECESS = {
  MIN_D: 0.35,        // 最淺的凹處(m):再淺就只是一條陰影線,而它要付一顆 draw call
  JAMB_F: 0.13,       // 側返寬 = 開口寬 × 這個數
  LINTEL_F: 0.17,     // 楣樑高 = 開口高 × 這個數
  SILL_F: 0.07,       // 檻高 = 開口高 × 這個數
  BACK_T: 0.08,       // 背板厚
};

/**
 * 一處**加法**凹處(紀律⑤):楣樑 + 兩側側返 + 檻 + 背板,全部長在量體前緣 **+z** 那一側。
 * 量體本身一格不動 ⇒ 任何一片零件的最小 z 恆 ≥ 0(= 量體前緣),`audit_vehicle_spec` Ⅹ 釘住。
 *
 * @param {object} o  `W/H` 開口寬高、`D` 凹深、`at` 開口中心(貼在量體前緣上)、`ry`、`c`/`cIn` 顏色
 */
export function makeRecess({ W, H, D, at = [0, 0, 0], ry = 0, c = 0x8d949c, cIn = null }) {
  const d = Math.max(RECESS.MIN_D, D);
  const jw = W * RECESS.JAMB_F, lh = H * RECESS.LINTEL_F, sh = H * RECESS.SILL_F;
  const back = cIn ?? mulHex(c, 0.62);
  const rows = [
    // 背板:凹處的底(貼在量體前緣上 ⇒ z 恆 ≥ 0)
    { g: ['box', W, H, RECESS.BACK_T], c: back, p: [0, H / 2, RECESS.BACK_T / 2] },
    // 楣樑(上)+ 檻(下):往外堆到 z = d
    { g: ['box', W + jw * 2, lh, d], c, p: [0, H - lh / 2, d / 2] },
    { g: ['box', W + jw * 2, sh, d], c, p: [0, sh / 2, d / 2] },
    // 兩側側返
    ...[-1, 1].map((sx) => ({
      g: ['box', jw, H, d], c, p: [sx * (W / 2 + jw / 2), H / 2, d / 2],
    })),
  ];
  return placeParts(rows, at, ry);
}

/** 一組凹處零件離量體前緣最近的那一片(MUST ≥ 0;< 0 = 寫在實心面後面 = 整片消失) */
export function recessMinZ(rows) { return partsAABB(rows).z0; }

// ============================================================================
// ③-3 可視角(凹處看不看得進去)
// ============================================================================

/**
 * 站立視線高(m)。**注入不寫死**(同 `edgewall.js` 的坡度門檻由呼叫端注入):
 * 呼叫端給「現役所有機體的全高」與「眼高佔全高的比例」,本支只做取小與相乘。
 *
 * ⚠ 與 `data.js curveEyeM()` 的關係:那一支**帶著一個引數順序缺陷**
 * (寫 `heroTargetH(ch, lv)` 而簽章是 `heroTargetH(kind, ch)` ⇒ 每一輪都走
 * `SOLDIER_H * 4` = 7.2,實得 4.0824 而正解 0.76545,差 5.33×),而
 * `tools/audit_world_curve.mjs` **抄了同一份錯誤呼叫**所以那道閘量不到任何東西。
 * 修它 = 13 張定場照全變 ⇒ 屬另一輪的改動,本支刻意另立而 **MUST NOT** 轉呼它。
 */
export function standEyeM(heights, eyeF) {
  let h = Infinity;
  for (const v of heights) if (Number.isFinite(v) && v > 0) h = Math.min(h, v);
  return Number.isFinite(h) ? h * eyeF : 0;
}

/** 凹處自己的張角(rad):開口高 H、凹深 D */
export function vehicleSight(H, D) { return Math.atan2(H, Math.max(1e-6, D)); }

/**
 * 站在 `standM`(自己的碰撞半徑)外緣、眼高 `eyeM` 時,看得進凹處多深(m)。
 * 眼高 ≤ 開口高 ⇒ 整條看得穿(回 Infinity)。
 */
export function sightDepth(H, D, eyeM, standM) {
  if (eyeM <= H) return Infinity;
  return (H * Math.max(1e-6, standM)) / (eyeM - H);
}

/** 這個凹處在站立高度上看不看得到底 */
export function sightOk(H, D, eyeM, standM) { return sightDepth(H, D, eyeM, standM) >= D - 1e-9; }
