// ============ 語意化地標(P2-C;唯一縫)============
// `docs/visual_upgrade_plan.md` 的 P2-C 原文只有兩句話:「現行散布是密度驅動的。挑 3~5 個
// 每場玩家都會經過的點(出主堡、第一座塔、洞口、橋頭),各擺一件認得出來的東西。」
// 它被延後的理由不是做不出來,而是**沒辦法在寫的地方驗**:往兵線裡放東西,正是 V-B
// 泛洪稽核存在的目的,而那支要 Overpass + 高程磚,沙箱連不出去。
//
// 2026-08-03 使用者定案把這個死結拆掉了:**「放在兵線 / 重生點 / 建築單位旁邊,在周遭
// 可以看見即可」** —— 地標不進走廊,只要從走廊上看得見。於是「會不會擋住兵線」這個問題
// 不再需要靠稽核回答,而是**由構造保證**:落點一律要通過 `areaFree(blocked, …)`,而
// `blocked` 裡本來就已經有兵線走廊(半寬 17m)、塔位(30m)、主堡(70m)、橋樑走廊與
// 隧道敞開段 —— 與建物/巨岩/神木吃的是同一道閘,只是多留一圈 `PAD` 餘裕。
//
// ---- 四條紀律 ----
//   ① **零共享 `rnd()` 消耗**(§2.3):錨點由兵線/主堡/塔位的幾何推導、落點由確定性搜尋
//      決定、外觀差異由**落點雜湊**餵一條自己的 `mulberry32`(同 `buildHazard` 以 seed 起
//      亂數的作法)。抽一枚共享亂數就會把後面每一株植被、每一棟建物的序列整條推移,
//      而那只表現成「整張圖的佈局變了」,沒有任何錯誤訊息。
//   ② **演出半徑收在權威碰撞柱內**(原則 4 / A30):碰撞柱半徑不是估的,是把整件量完
//      (`beaconCollider`)才登記 —— 看到多粗 = 撞到多粗 = 打到多粗。零件表另有標稱
//      `foot`,稽核逐件驗「實際外廓 ≤ foot」,而規劃期預留的空間是 `foot + PAD`
//      ⇒ 量出來的碰撞柱必定落在預留範圍內。
//   ③ **零件表是純資料**(下方 `KIND_PARTS`:`['box'|'cyl'|'cone'|'ico', …]` + 位移/旋轉)。
//      這不是為了好看 —— 是為了讓外廓可以**在 Node 端算得出來**:three 走 CDN、A2 不准進
//      `package.json` ⇒ 若零件直接寫成 `new THREE.Mesh(...)`,稽核就只能改用真瀏覽器,
//      而 P2-C 卡住的原因正是「驗不動」。純資料表把這一項變成沙箱跑得動的稽核。
//   ④ **不掛反轉外殼描邊**:一座電塔十幾個零件 = 十幾個額外 draw call,而世界的線本來就
//      由 `postfx.js` 的螢幕空間勾線 pass 蓋全場(計畫書 P0-C 的後續項「勾線上線後修剪
//      重複的外殼」是同一條)。同理零件依材質色合併成 1~3 個 mesh,不是逐塊一個 draw call。
//
// 純表現層?**不完全是,而且刻意誠實**:這些是實心結構物,登記碰撞柱與 LOS 遮蔽(與建物/
// 巨岩同一條路徑)。做成穿得過去的裝飾才是「看得見卻打不到」(A30 家族)。代價由 `PAD`
// 與 `SEP` 兩個餘裕承擔,並且**與既有散布物同一道閘**,不是新開的例外。
import * as THREE from 'three';
import { toonMat, envMat, bakeContactAO } from './toon.js';
import { mulberry32 } from './rng.js';

// ---- 規劃參數 ----
// NEAR/FAR 是「centre 到 centre」的搜尋帶:近端沒有意義上的下限(真正的下限由 `blocked`
// 給 —— 兵線 17m / 塔位 30m / 主堡 70m,各自再加 foot + PAD),FAR 則要**大於主堡那圈**
// (70 + foot + PAD ≈ 88)才可能替重生點找到位置,否則重生點永遠掛不上地標。
export const BEACON = {
  NEAR: 12,      // 搜尋起點(m):防退化,實際近端由 blocked 決定
  FAR: 200,      // 搜尋終點(m):再遠就不是「旁邊」了,寧可不擺(原則 6)
  STEP: 10,      // 徑向步進(m):由近而遠,先找到的就是最貼近錨點的那個
  RAYS: 10,      // 方位取樣數(左右交錯)
  SPREAD: 0.42,  // 每往外一輪偏離側向的角度(rad;≈24°)
  PAD: 12,       // 落點在既有淨空之外還要留的餘裕(m)—— 比建物更保守
  SEP: 110,      // 地標彼此最小間距(m):避免兩件擠在同一個路口
  MAX: 12,       // 全場上限
};

// ---- 型錄 ----
// `foot` = 標稱水平外廓(m),同時是規劃期預留空間的依據與稽核的上界;`h` 只供說明。
// 高度是刻意分級的:錨點的淨空圈越大,地標就被推得越遠 ⇒ 越遠的越高,才維持「看得見」。
//   重生點(主堡淨空 70m ⇒ 落在 ~90m 外)→ 通訊塔 28m
//   建築單位(塔位淨空 30m ⇒ 落在 ~50m 外)→ 水塔 22m
//   兵線(走廊淨空 17m ⇒ 落在 ~37m 外)   → 電塔 34m / 貨櫃堆 10m / 敖包 12m
// `foot` MUST 貼著零件表的實算外廓(`kindExtent`;稽核雙向釘住 —— 低報 = A30,虛胖 =
// 地標被無謂地推遠而使用者要的是「旁邊」)。改零件表 MUST 重跑稽核校對這一欄。
export const BEACON_KINDS = {
  pylon: { foot: 8.0, h: 35 },   // 高壓電塔
  mast: { foot: 3.8, h: 29 },    // 通訊天線塔
  tank: { foot: 5.2, h: 23 },    // 水塔
  depot: { foot: 6.0, h: 10 },   // 貨櫃堆
  cairn: { foot: 2.6, h: 13 },   // 敖包/疊石堆 + 旗桿
};

// 錨點類別 → 型錄。兵線那一類有三款輪替(由落點雜湊挑),其餘一對一。
const KIND_BY_ANCHOR = { base: 'mast', tower: 'tank' };
const LANE_KINDS = ['pylon', 'depot', 'cairn'];

// ---- 零件表(純資料;見紀律③)----
// 幾何:['box', w, h, d] / ['cyl', r1, r2, h, seg] / ['cone', r, h, seg] / ['ico', r]
// p = 位移 [x, y, z](y = 該件中心離地高);r = 歐拉角 [rx, ry, rz](省略 = 0);
// c = 顏色;`e` = 自發光(頂燈/航障燈,不吃接地 AO)。
// 座標系:+Z = 面向錨點的那一面(擺放時以 `ry` 轉過去)⇒ 梯子/微波碟/門面朝著路。
const KIND_PARTS = {
  // 高壓電塔:四根外張腳 → 腰身收束 → 塔身 → 兩層橫擔 + 礙子串。
  // 腳不用傾斜件表現外張,改成「下段粗、上段細的兩節」—— 傾斜件的外廓要用 3D 半對角算,
  // 白白吃掉 foot 的餘裕,而畫面上分辨不出來。
  pylon: [
    ...[[-2.9, -2.9], [2.9, -2.9], [-2.9, 2.9], [2.9, 2.9]].map(([x, z]) => (
      { g: ['cyl', 0.42, 0.52, 13, 4], c: 0x8d949c, p: [x, 6.5, z] })),
    ...[[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]].map(([x, z]) => (
      { g: ['cyl', 0.3, 0.42, 11, 4], c: 0x939aa2, p: [x, 18.5, z] })),
    { g: ['box', 6.4, 0.34, 0.34], c: 0x7f868e, p: [0, 6.6, -2.9] },
    { g: ['box', 6.4, 0.34, 0.34], c: 0x7f868e, p: [0, 6.6, 2.9] },
    { g: ['box', 0.34, 0.34, 6.4], c: 0x7f868e, p: [-2.9, 12.4, 0] },
    { g: ['box', 0.34, 0.34, 6.4], c: 0x7f868e, p: [2.9, 12.4, 0] },
    { g: ['box', 4.2, 0.3, 4.2], c: 0x7f868e, p: [0, 13.1, 0] },
    { g: ['cyl', 0.26, 0.34, 6, 4], c: 0x939aa2, p: [0, 27, 0] },
    { g: ['box', 15.2, 0.5, 0.5], c: 0x8d949c, p: [0, 24.6, 0] },
    { g: ['box', 11, 0.45, 0.45], c: 0x8d949c, p: [0, 29.4, 0] },
    ...[-7, -3.6, 3.6, 7].map((x) => ({ g: ['cyl', 0.16, 0.16, 1.5, 5], c: 0xcfd6dc, p: [x, 23.6, 0] })),
    ...[-5.1, 5.1].map((x) => ({ g: ['cyl', 0.16, 0.16, 1.3, 5], c: 0xcfd6dc, p: [x, 28.5, 0] })),
    { g: ['ico', 0.55], c: 0xff5a48, p: [0, 30.6, 0], e: 1 },
  ],
  // 通訊天線塔:三腳格構 + 兩面微波碟 + 頂端鞭狀天線。碟面朝 +Z(面向錨點)。
  mast: [
    ...[0, 1, 2].map((k) => {
      const a = k / 3 * Math.PI * 2;
      return { g: ['cyl', 0.26, 0.34, 24, 4], c: 0x9aa1a8, p: [Math.cos(a) * 1.7, 12, Math.sin(a) * 1.7] };
    }),
    ...[4.5, 10.5, 16.5, 22].map((y) => ({ g: ['cyl', 1.85, 1.85, 0.26, 3], c: 0x848b93, p: [0, y, 0] })),
    { g: ['cyl', 1.5, 1.5, 0.45, 10], c: 0xe4e8ea, p: [0, 19.4, 2.1], r: [Math.PI / 2, 0, 0] },
    { g: ['cyl', 1.1, 1.1, 0.4, 10], c: 0xe4e8ea, p: [0, 14.2, -1.9], r: [Math.PI / 2, 0, 0] },
    { g: ['box', 1.4, 2.2, 1.2], c: 0xb9c0c6, p: [0, 1.6, 2.4] },   // 基座機房
    { g: ['cyl', 0.09, 0.14, 7, 5], c: 0xcfd6dc, p: [0, 27.5, 0] },
    { g: ['ico', 0.42], c: 0xff5a48, p: [0, 28.6, 0], e: 1 },
  ],
  // 水塔:四根支腿 + 桶身 + 錐頂 + 側梯(梯子朝 +Z)。
  tank: [
    ...[[-3.2, -3.2], [3.2, -3.2], [-3.2, 3.2], [3.2, 3.2]].map(([x, z]) => (
      { g: ['cyl', 0.3, 0.4, 13, 5], c: 0x8a8f8a, p: [x, 6.5, z] })),
    { g: ['box', 6.8, 0.3, 0.3], c: 0x7c817c, p: [0, 7.4, -3.2] },
    { g: ['box', 6.8, 0.3, 0.3], c: 0x7c817c, p: [0, 7.4, 3.2] },
    { g: ['cyl', 4.2, 4.2, 6.4, 10], c: 0xb6a892, p: [0, 16.2, 0] },
    { g: ['cyl', 4.35, 4.35, 0.5, 10], c: 0x8d7f6c, p: [0, 13.4, 0] },
    { g: ['cone', 4.45, 2.4, 10], c: 0x7a5f4b, p: [0, 20.6, 0] },
    { g: ['cyl', 0.18, 0.18, 1.6, 5], c: 0xcfd6dc, p: [0, 22.4, 0] },
    { g: ['box', 0.7, 15, 0.12], c: 0x6f746f, p: [0, 9.5, 4.5] },   // 側梯
  ],
  // 貨櫃堆:交錯堆疊的貨櫃 + 油桶 + 棧板。矮但佔地大,只用在近距離的兵線錨點。
  depot: [
    { g: ['box', 6.1, 2.6, 2.5], c: 0xb4553c, p: [0, 1.3, -1.5] },
    { g: ['box', 6.1, 2.6, 2.5], c: 0x3f6f7a, p: [0.5, 1.3, 1.5] },
    { g: ['box', 6.1, 2.6, 2.5], c: 0x7d8a4a, p: [-0.6, 3.9, -0.4] },
    { g: ['box', 6.1, 2.6, 2.5], c: 0xa8a08c, p: [0.3, 6.5, 0.2] },
    { g: ['box', 6.3, 0.16, 2.7], c: 0x2f3438, p: [0.3, 7.85, 0.2] },
    ...[[-4.2, -2.6], [-3.6, -1.1], [-4.4, 0.4]].map(([x, z], i) => (
      { g: ['cyl', 0.62, 0.62, 1.7, 8], c: i === 1 ? 0xc2913a : 0x4a5a66, p: [x, 0.85, z] })),
    { g: ['box', 2.6, 0.22, 1.6], c: 0x6b5a42, p: [4.0, 0.11, 1.8] },
    { g: ['box', 2.6, 0.22, 1.6], c: 0x6b5a42, p: [4.0, 0.33, 1.8] },
  ],
  // 敖包/疊石堆 + 旗桿:路旁的人跡標記。矮,但旗桿把可見高度撐起來。
  cairn: [
    { g: ['ico', 1.5], c: 0x8f8a80, p: [0, 0.9, 0] },
    { g: ['ico', 1.15], c: 0x9a958a, p: [0.25, 2.3, -0.15] },
    { g: ['ico', 0.85], c: 0x857f75, p: [-0.2, 3.3, 0.2] },
    { g: ['ico', 0.6], c: 0x9a958a, p: [0.1, 4.1, 0] },
    { g: ['cyl', 0.13, 0.16, 9, 6], c: 0x6b5a42, p: [0, 8.2, 0] },
    ...[8.4, 9.6, 10.8].map((y, i) => (
      { g: ['box', 1.9, 0.6, 0.06], c: [0xc8503f, 0xd8a34a, 0x3f7fa8][i], p: [1.05, y, 0] })),
    ...[[1.9, 0], [-1.5, 1.3], [-1.2, -1.6]].map(([x, z]) => (
      { g: ['ico', 0.45], c: 0x7d786e, p: [x, 0.3, z] })),
  ],
};

/**
 * 零件的**水平外廓**(離群組軸心的最遠水平距離,m)—— 純幾何,無 three。
 *
 * 圓形斷面(cyl/cone/ico)的最遠點必定在「位移方向」上 ⇒ `|p| + r` 是**精確**值。
 * 方盒不是:一個 6.8m 寬的橫桁擺在 z = −3.2,用 `|p| + 半對角` 會算成 6.6m,而它真正的
 * 角點只到 4.7m —— 那 1.9m 的虛胖會讓每一件地標被無謂地往外推(使用者要的是「旁邊」)。
 * 故方盒逐角點算,只有**傾斜件**(rx/rz ≠ 0,縱向尺寸會轉進水平面)才退回 3D 半對角。
 * 偏差方向仍一律朝「算大」—— 算小 = 演出頂出碰撞柱 = 看得見卻打不到(A30)。
 */
export function partExtent(part) {
  const [t, a, b, c] = part.g;
  const [px = 0, , pz = 0] = part.p || [];
  const [rx = 0, ry = 0, rz = 0] = part.r || [];
  const tilted = rx !== 0 || rz !== 0;
  if (t === 'box' && !tilted) {
    const hw = a / 2, hd = c / 2, cs = Math.cos(ry), sn = Math.sin(ry);
    let m = 0;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const lx = hw * sx, lz = hd * sz;
      m = Math.max(m, Math.hypot(px + lx * cs + lz * sn, pz - lx * sn + lz * cs));
    }
    return m;
  }
  let rad;
  if (t === 'box') rad = Math.hypot(a, b, c) / 2;
  else if (t === 'cyl') rad = tilted ? Math.hypot(Math.max(a, b), c / 2) : Math.max(a, b);
  else if (t === 'cone') rad = tilted ? Math.hypot(a, b / 2) : a;
  else rad = a;   // ico
  return Math.hypot(px, pz) + rad;
}

/** 一整款地標的標稱水平外廓(m)= 逐件取最大。稽核以此驗 `BEACON_KINDS[k].foot` 沒有低報 */
export function kindExtent(kind) {
  return (KIND_PARTS[kind] || []).reduce((m, p) => Math.max(m, partExtent(p)), 0);
}

/** 落點 → 確定性種子(零共享亂數消耗;同 `biomes.js djAt` 的雜湊形狀) */
export function beaconSeed(x, z) {
  const h = (Math.imul(Math.round(x * 8) | 0, 0x9E3779B1) ^ Math.imul(Math.round(z * 8) | 0, 0x85EBCA77)) | 0;
  return Math.imul(h ^ (h >>> 15), 0xC2B2AE3D) >>> 0;
}

/**
 * 錨點推導(唯一縫)—— 使用者定案的三類:**兵線 / 重生點 / 建築單位**。
 * 三類都由既有幾何推導,一次 fetch 都不用加:
 *   base  重生點 = 雙方主堡(玩家每場開局與每次重生都從這裡出發)
 *   tower 建築單位 = `solveTowerSites()` 解出來的塔位(敵我各一,前線那一組排在最前)
 *   lane  兵線沿線等距取樣(洞口/橋頭天生落在這條線上)
 * `tx/tz` = 該錨點的兵線切向(單位向量):落點搜尋由**側向**開始張開 ⇒ 地標落在路邊,
 * 而不是落在推進方向的正前方(那會擋視野也擋不到路)。
 *
 * @param lanesW    兵線折線(遊戲公尺;index 0 = SWARM 端、末端 = STEEL 端)
 * @param basesW    [{ side, x, z }]
 * @param towerSites `solveTowerSites(lanesW)` 的回傳
 */
export function beaconAnchors({ lanesW = [], basesW = [], towerSites = [], laneFracs = [0.3, 0.5, 0.7] }) {
  const out = [];
  const tangentAt = (lane, x, z) => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < lane.length; i++) {
      const d = (lane[i][0] - x) ** 2 + (lane[i][1] - z) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    const a = lane[Math.max(0, bi - 1)], b = lane[Math.min(lane.length - 1, bi + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const m = Math.hypot(dx, dz) || 1;
    return [dx / m, dz / m];
  };
  // ① 重生點:切向取「主堡 → 最近兵線點」的反向,側向因此橫跨出擊方向
  for (const b of basesW) {
    const lane = lanesW[0] || [];
    const [tx, tz] = lane.length ? tangentAt(lane, b.x, b.z) : [1, 0];
    out.push({ kind: 'base', x: b.x, z: b.z, tx, tz, tag: b.side });
  }
  // ② 建築單位(砲塔位):`solveTowerSites` 的序末項 = 前線那一組,故整條反序 ⇒ 前線優先
  for (let li = 0; li < towerSites.length; li++) {
    const lane = lanesW[li] || lanesW[0] || [];
    const sites = [...(towerSites[li] || [])].reverse();
    for (let si = 0; si < sites.length; si++) {
      for (const side of ['SWARM', 'STEEL']) {
        const p = sites[si][side];
        if (!p) continue;
        const [tx, tz] = lane.length ? tangentAt(lane, p.x, p.z) : [1, 0];
        out.push({ kind: 'tower', x: p.x, z: p.z, tx, tz, tag: `${side}${li}.${si}` });
      }
    }
  }
  // ③ 兵線沿線等距取樣
  for (let li = 0; li < lanesW.length; li++) {
    const lane = lanesW[li];
    if (!lane || lane.length < 2) continue;
    const cum = [0];
    for (let i = 1; i < lane.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(lane[i][0] - lane[i - 1][0], lane[i][1] - lane[i - 1][1]));
    }
    const total = cum[cum.length - 1];
    for (const f of laneFracs) {
      const d = total * f;
      let i = 1;
      while (i < cum.length - 1 && cum[i] < d) i++;
      const t = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
      const x = lane[i - 1][0] + (lane[i][0] - lane[i - 1][0]) * t;
      const z = lane[i - 1][1] + (lane[i][1] - lane[i - 1][1]) * t;
      out.push({ kind: 'lane', x, z, ...(() => {
        const [tx, tz] = tangentAt(lane, x, z);
        return { tx, tz };
      })(), tag: `L${li}@${f}` });
    }
  }
  return out;
}

/** 錨點 → 型錄鍵(兵線那一類三款輪替,由落點雜湊挑 ⇒ 同一張圖恆定) */
export function beaconKindFor(anchor, x, z) {
  if (KIND_BY_ANCHOR[anchor.kind]) return KIND_BY_ANCHOR[anchor.kind];
  return LANE_KINDS[beaconSeed(x ?? anchor.x, z ?? anchor.z) % LANE_KINDS.length];
}

/**
 * 落點規劃(唯一縫;純幾何、零亂數、零 THREE ⇒ 離線稽核直接跑得動)。
 *
 * 由近而遠、左右交錯地找第一個放得下的位置:
 *   - **徑向在外層迴圈** ⇒ 先找到的必定是最貼近錨點的那一圈(使用者要的「旁邊」)
 *   - **方位由側向 ±90° 起算**、每輪往前後各張開 `SPREAD` ⇒ 落在路邊而不是路的正前方
 *   - 通過與否一律問 `probe(x, z, foot + PAD)` —— 呼叫端把「淨空 / 乾地 / 界內 / 夠平」
 *     全部收在這一個回呼裡。**規劃器不認得地形也不認得 blocked**,這是它能離線驗的原因。
 *
 * @param anchors `beaconAnchors()` 的回傳
 * @param probe   (x, z, r) => boolean —— 這個腳印放得下嗎
 * @returns [{ x, z, ry, d, kind, from, tag }]
 */
export function planBeaconSites(anchors, probe, opts = {}) {
  const o = { ...BEACON, ...opts };
  const out = [];
  for (const an of anchors) {
    if (out.length >= o.MAX) break;
    const base = Math.atan2(an.tz, an.tx);
    const angs = [];
    for (let j = 0; j * 2 < o.RAYS; j++) {
      for (const s of [1, -1]) angs.push(base + s * (Math.PI / 2 + j * o.SPREAD));
    }
    let hit = null;
    for (let d = o.NEAR; d <= o.FAR && !hit; d += o.STEP) {
      for (const a of angs) {
        const x = an.x + Math.cos(a) * d, z = an.z + Math.sin(a) * d;
        const kind = beaconKindFor(an, x, z);
        const foot = (BEACON_KINDS[kind] || BEACON_KINDS.cairn).foot;
        if (d < foot) continue;
        if (out.some((p) => Math.hypot(x - p.x, z - p.z) < o.SEP)) continue;
        if (!probe(x, z, foot + o.PAD)) continue;
        // 面向錨點(three 的 rotation.y:local +Z 轉向 (dx,dz) ⇒ atan2(dx, dz))
        hit = { x, z, ry: Math.atan2(an.x - x, an.z - z), d, kind, from: an.kind, tag: an.tag };
        break;
      }
    }
    if (hit) out.push(hit);
  }
  return out;
}

// ---- 建構(以下才需要 THREE)----
const _geo = (spec) => {
  const [t, a, b, c] = spec;
  if (t === 'box') return new THREE.BoxGeometry(a, b, c);
  if (t === 'cyl') return new THREE.CylinderGeometry(a, b, c, spec[4] || 6);
  if (t === 'cone') return new THREE.ConeGeometry(a, b, spec[3] || 6);
  return new THREE.IcosahedronGeometry(a, 0);
};
const _box = new THREE.Box3();

/**
 * 建一件地標。零件依**顏色**分桶,每桶烤成一個 mesh ⇒ 一件地標只有 1~3 個 draw call
 * (逐塊一個 mesh 的話,一座電塔就是十幾個 —— 本渲染器是 draw call 瓶頸)。
 * 合併走頂點烘焙(逐件套上自己的位移/旋轉後併進同一份屬性),不引入新的 addon。
 */
export function buildBeacon(kind, seed = 1) {
  const g = new THREE.Group();
  const parts = KIND_PARTS[kind] || KIND_PARTS.cairn;
  const rnd = mulberry32((seed * 2654435761) >>> 0);
  // 同款不同座:整件在容許範圍內微幅改高瘦比(確定性,由 seed 決定)。
  // **只動縱向**:水平一動就要重驗 foot,而縱向對碰撞柱半徑沒有影響(原則 4 的便宜行事處)。
  const stretch = 0.9 + rnd() * 0.25;
  const buckets = new Map();
  for (const p of parts) {
    const key = `${p.c}|${p.e ? 1 : 0}`;
    const geo = _geo(p.g);
    const m = new THREE.Matrix4();
    const [px = 0, py = 0, pz = 0] = p.p || [];
    const [rx = 0, ry = 0, rz = 0] = p.r || [];
    m.compose(
      new THREE.Vector3(px, py * stretch, pz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      // 傾斜件不拉伸:縱向被轉進水平面了,拉伸會把水平外廓一起撐大(頂出 foot = A30)
      new THREE.Vector3(1, (rx || rz) ? 1 : stretch, 1),
    );
    geo.applyMatrix4(m);
    if (!buckets.has(key)) buckets.set(key, { c: p.c, e: !!p.e, geos: [] });
    buckets.get(key).geos.push(geo);
  }
  for (const b of buckets.values()) {
    const merged = _mergePositions(b.geos);
    const mat = b.e
      ? toonMat(b.c, { emissive: b.c, emissiveIntensity: 1.1 })
      : envMat(b.c, { wash: 0.55, cool: 0.45 });
    g.add(new THREE.Mesh(merged, mat));
  }
  // 接地 AO:地標「長」在地上(botw_plan Task 2.2;自發光件由 bakeContactAO 自動跳過)
  bakeContactAO(g, 3.2);
  // 反轉外殼描邊刻意不掛 —— 世界的線由 postfx 的螢幕空間勾線負責(見檔頭紀律④)
  g.userData.beacon = kind;
  return g;
}

/** 合併一組已套好變換的幾何(只保留 position/normal;本模組的零件不用 uv) */
function _mergePositions(geos) {
  let nv = 0, ni = 0;
  for (const gm of geos) {
    nv += gm.attributes.position.count;
    ni += gm.index ? gm.index.count : gm.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
  const idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const gm of geos) {
    const p = gm.attributes.position, n = gm.attributes.normal;
    pos.set(p.array.subarray(0, p.count * 3), vo * 3);
    if (n) nor.set(n.array.subarray(0, n.count * 3), vo * 3);
    if (gm.index) for (let i = 0; i < gm.index.count; i++) idx[io++] = gm.index.array[i] + vo;
    else for (let i = 0; i < p.count; i++) idx[io++] = i + vo;
    vo += p.count;
    gm.dispose();   // A25:合併後的暫時幾何不留在 GPU
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/**
 * **量出來的**碰撞柱(原則 4 / A30):看到多粗 = 撞到多粗。
 * 標稱 `foot` 只用在規劃期預留空間;真正登記的半徑一律取這一支的實測值,
 * 而實測值 ≤ foot(稽核逐款釘住)⇒ 必定落在規劃期預留的 `foot + PAD` 內。
 */
export function beaconCollider(g) {
  _box.setFromObject(g);
  return {
    r: Math.max(Math.abs(_box.min.x), Math.abs(_box.max.x), Math.abs(_box.min.z), Math.abs(_box.max.z)),
    h: _box.max.y,
  };
}
