// ============ 攀爬路線(長梯 / 攀岩抓點 / 垂降技術繩)—— 唯一真相縫 ============
// 需求(2026-07-28):隨機挑選約三成的**建築 / 巨石 / 神木**,對應加上一條連通「地面 ↔ 頂端」
// 的攀爬路線,讓地面機種爬上爬下、上到頂端立足射擊。地面端 MUST 落在無障礙的那一側。
//
// **為什麼是獨立一支**:路線同時被三個消費端讀 ——
//   ① `biomes.js` 生成期(規劃 + 建 3D 幾何)
//   ② `game.js` 執行期(攀爬狀態機:抓握半徑 / 上下速度 / 登頂落腳點)
//   ③ `tools/audit_climb.mjs` 離線稽核(直接執行本檔原文驗幾何)
// 三端 MUST 共用同一份規劃結果與同一組常數;**MUST NOT** 在擺位端或移動端各自再算一次表面點、
// 法線或頂面高(那正是 A26「擺位方向與旋轉方向不同調」與「兩份平衡數值」那類病灶的形狀)。
//
// **與既有系統的接縫**:
//   - 候選集 = `blockers` 裡帶 `bld`(建物/地標)或 `std`(神木/巨岩)旗標者 —— 與
//     `biomes.js makeBlockerTopIndex()`「頂面可站立」**同一組判準**。頂面高 `y1` 也一律取
//     `b.y + b.h`(= blockerTopAt 的回傳值)⇒ 爬到頂剛好等於 `main.js surfaceAt` 認得的站立面,
//     MUST NOT 另外量一次屋頂高(差 0.1m 就是「爬到頂卻站不住,直接掉下去」)。
//   - 攀爬軸 MUST 落在結構碰撞體**之外** `OFF` 公尺:`game.js _collide` 的推擠半徑上限 =
//     最大機體高 × SELF_F.groundR = (SOLDIER_H × 2.5) × 0.317 ≈ 1.43m,`OFF` 大於它 ⇒ 攀爬途中
//     機體本來就不與碰撞盒重疊,**不需要**在 _collide 開任何豁免洞(開了就等於在牆裡走路)。
//   - 確定性(A4):抽樣與方位起相位一律走傳入的 `rnd`(mulberry32),**每個候選固定消耗 2 枚**、
//     淘汰檢查一律排在抽樣**之後** —— 否則佈局序列會跨客戶端分歧。
//
// 純表現層 + 客戶端移動:伺服器不參與(位置本就客戶端權威),故 `npm run bal` / e2e 天然不受影響。

import * as THREE from 'three';
import { markShared, envMat } from './toon.js';
import { SOLDIER_H, HERO_SIZE } from './data.js';

/** 最大機體碰撞半徑(公尺):機種身高上界 × game.js SELF_F.groundR —— OFF 的下界由它推導,MUST NOT 手寫 */
const MAX_BODY_R = SOLDIER_H * Math.max(...Object.values(HERO_SIZE).map((s) => s.mul[1])) * 0.317;

export const CLIMB = {
  SHARE: 0.3,        // 抽中比例(使用者需求「約 3 成」)
  MIN_H: 9,          // 低於此不掛路線:蓄力跳頂點就上得去,擺個梯子只是雜訊
  MAX_H: 120,        // 高於此不掛路線:單一出入口的垂直通道爬太久 = 站著給人打(神木可達 220m)
  OFF: MAX_BODY_R + 0.4,   // 攀爬軸離結構表面(MUST > MAX_BODY_R,否則爬到一半被 _collide 推開)
  GRAB_R: 3.2,       // 抓握半徑(水平):走進來 + 有朝向路線的推杆量 = 掛上
  GRAB_UP: 4.0,      // 頂端上緣容差:自屋頂邊緣走出去(或被擊退落下)仍抓得到
  SPD: 12,           // 攀爬速度(m/s);推杆量 |f| 線性折算,受控場 _ccMoveF 影響
  KICK: 7,           // 脫手跳離的向外初速(m/s)
  CLEAR_R: 6,        // 地面端無障礙淨空半徑:此半徑內不得有別的碰撞體
  STEP: 3.0,         // 地面端最大高差(相對結構基座地表):斜坡上的那一側不算「無障礙」
  AZ: 16,            // 側向候選方位數(22.5° 一格)
  TOP_STEP: 2.2,     // 登頂後往結構內側踏進的距離(踏上頂面,不停在邊緣)
  RUNG: 0.62,        // 長梯踏桿間距
  HOLD: 1.15,        // 攀岩抓點間距
  KNOT: 1.6,         // 技術繩繩結間距
};

/** 結構型別 → 攀爬設施(使用者列舉的三種,對應真實世界的做法) */
export const CLIMB_KIND = { bld: 'ladder', rock: 'holds', tree: 'rope' };
export const CLIMB_LABEL = { ladder: '長梯', holds: '攀岩抓點', rope: '垂降技術繩' };

// ---------------------------------------------------------------------------
// 幾何工具:結構表面點 + 向外法線(圓柱 / 有向盒各一條,與 _collide / _cameraDeClip 同式)
// ---------------------------------------------------------------------------

/**
 * 自結構中心沿方位角 `a` 射出,求「表面交點 + 該面的向外法線 + 沿法線的半徑」。
 * 有向盒(建物 hw2/hd2/ry)走 slab 求出射參數並取決定面的法線;其餘(神木/巨岩)走圓柱。
 * 回傳 { fx, fz, nx, nz, rad }。
 */
export function surfacePoint(b, a) {
  const dx = Math.cos(a), dz = Math.sin(a);
  if (b.hw2 == null) {
    return { fx: b.x + dx * b.r, fz: b.z + dz * b.r, nx: dx, nz: dz, rad: b.r };
  }
  const cs = Math.cos(b.ry), sn = Math.sin(b.ry);
  const ux = dx * cs + dz * sn, uz = -dx * sn + dz * cs;      // world→local(繞 −ry)
  const tx = Math.abs(ux) < 1e-9 ? Infinity : b.hw2 / Math.abs(ux);
  const tz = Math.abs(uz) < 1e-9 ? Infinity : b.hd2 / Math.abs(uz);
  const t = Math.min(tx, tz);
  // 決定面的 local 法線(較小的出射參數那一軸);再轉回世界(繞 +ry)
  const lnx = tx <= tz ? Math.sign(ux) : 0, lnz = tx <= tz ? 0 : Math.sign(uz);
  return {
    fx: b.x + dx * t, fz: b.z + dz * t,
    nx: lnx * cs - lnz * sn, nz: lnx * sn + lnz * cs,
    rad: t,
  };
}

/** 候選結構?= 頂面可站立的大型障礙(與 makeBlockerTopIndex 同一組旗標)且高度落在窗口內 */
export function climbCandidate(b) {
  if (!b || (!b.bld && !b.std)) return false;
  return b.h >= CLIMB.MIN_H && b.h <= CLIMB.MAX_H;
}

// ---------------------------------------------------------------------------
// 路線規劃
// ---------------------------------------------------------------------------

/**
 * 規劃攀爬路線。純幾何 + 一支確定性 rnd,無 THREE 依賴 ⇒ 稽核可直接執行本函式原文。
 *
 * @param blockers  全部碰撞柱(建物/神木/巨岩/橋墩…;候選由 climbCandidate 篩)
 * @param heightAt  (x,z) → 地表高
 * @param envCodeAt (x,z) → 0 乾 / 1 水 / 2 沼(地面端 MUST 是乾地)
 * @param bounds    { minX, maxX, minZ, maxZ }
 * @param rnd       mulberry32(確定性;每個候選固定消耗 2 枚)
 * @returns 路線陣列 [{ b, kind, x, z, nx, nz, fx, fz, y0, y1, tx, tz }]
 */
export function planClimbRoutes({ blockers, heightAt, envCodeAt, bounds, rnd }) {
  const list = blockers || [];
  // 障礙查詢網格:候選 × 16 方位逐一問「附近有沒有別的碰撞體」,線性掃全表會是 O(n²)
  const CELL = 32, grid = new Map();
  for (const b of list) {
    const rr = (b.hw2 != null ? Math.hypot(b.hw2, b.hd2) : b.r) + CLIMB.CLEAR_R;
    const i0 = Math.floor((b.x - rr) / CELL), i1 = Math.floor((b.x + rr) / CELL);
    const j0 = Math.floor((b.z - rr) / CELL), j1 = Math.floor((b.z + rr) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = i * 65536 + j;
        let arr = grid.get(k); if (!arr) grid.set(k, arr = []); arr.push(b);
      }
    }
  }
  /** (x,z) 到「其他碰撞體」表面的最短距離(自己不算);全空回 Infinity */
  const clearance = (x, z, self, yLo, yHi) => {
    const arr = grid.get(Math.floor(x / CELL) * 65536 + Math.floor(z / CELL));
    if (!arr) return Infinity;
    let best = Infinity;
    for (const o of arr) {
      if (o === self) continue;
      if (o.y + o.h < yLo || o.y > yHi) continue;          // 垂直不重疊 = 不擋這條通道
      let d;
      if (o.hw2 != null) {
        const cs = Math.cos(o.ry), sn = Math.sin(o.ry);
        const rx = x - o.x, rz = z - o.z;
        const lx = Math.abs(rx * cs + rz * sn) - o.hw2, lz = Math.abs(-rx * sn + rz * cs) - o.hd2;
        d = Math.hypot(Math.max(0, lx), Math.max(0, lz)) + Math.min(0, Math.max(lx, lz));
      } else d = Math.hypot(x - o.x, z - o.z) - o.r;
      if (d < best) best = d;
    }
    return best;
  };

  const routes = [];
  for (const b of list) {
    // 抽樣紀律(A4/§2.3):**先抽固定 2 枚**(抽中與否、方位起相位),淘汰檢查一律排在抽樣之後
    const pick = rnd();
    const phase = rnd() * Math.PI * 2;
    if (!climbCandidate(b)) continue;
    if (pick >= CLIMB.SHARE) continue;

    const baseY = heightAt(b.x, b.z);
    const y1 = b.y + b.h;                     // = makeBlockerTopIndex 的頂面高(唯一縫)
    let best = null;
    for (let k = 0; k < CLIMB.AZ; k++) {
      const a = phase + k / CLIMB.AZ * Math.PI * 2;
      const sp = surfacePoint(b, a);
      const x = sp.fx + sp.nx * CLIMB.OFF, z = sp.fz + sp.nz * CLIMB.OFF;
      if (x < bounds.minX + 45 || x > bounds.maxX - 45 || z < bounds.minZ + 45 || z > bounds.maxZ - 45) continue;
      const gy = heightAt(x, z);
      if (Math.abs(gy - baseY) > CLIMB.STEP) continue;              // 斜坡側:落腳點與基座差太多
      if (envCodeAt(x, z) !== 0) continue;                          // 水域/沼澤不是「無障礙」
      const cl = clearance(x, z, b, gy, y1);
      if (cl < CLIMB.CLEAR_R) continue;                             // 被別的建物/巨岩/橋墩擋住
      // 取淨空最大的那一側(嚴格大於 ⇒ 同分時取先掃到的,序列確定)
      if (!best || cl > best.cl) best = { ...sp, x, z, gy, cl };
    }
    if (!best) continue;                                            // 四面都有障礙 → 寧缺勿錯,不掛路線

    // 登頂落腳點:自表面點往結構內側踏進(夾在該方向半徑的 80% 內,細瘦結構不會踏過頭)
    const step = Math.min(CLIMB.TOP_STEP, best.rad * 0.8);
    routes.push({
      b,
      kind: CLIMB_KIND[b.cl] || 'ladder',
      x: best.x, z: best.z,                   // 攀爬軸(結構表面外 OFF)
      nx: best.nx, nz: best.nz,               // 向外法線
      fx: best.fx, fz: best.fz,               // 結構表面附著點
      y0: best.gy,                            // 地面端
      y1,                                     // 頂端(= surfaceAt 認得的站立面)
      tx: best.fx - best.nx * step,           // 登頂落腳點(結構內側)
      tz: best.fz - best.nz * step,
    });
  }
  return routes;
}

// ---------------------------------------------------------------------------
// 執行期查詢索引
// ---------------------------------------------------------------------------

/**
 * (x, z, y) → 可抓握的路線 | null。水平在 GRAB_R 內、垂直落在 [y0 − 1, y1 + GRAB_UP] 內即命中;
 * 同格多條取水平最近。**不含「推杆朝向路線」的意圖判定** —— 那是輸入層的事,住 game.js。
 */
export function makeClimbIndex(routes) {
  const list = routes || [];
  if (!list.length) return () => null;
  const CELL = 32, grid = new Map();
  for (const r of list) {
    const i0 = Math.floor((r.x - CLIMB.GRAB_R) / CELL), i1 = Math.floor((r.x + CLIMB.GRAB_R) / CELL);
    const j0 = Math.floor((r.z - CLIMB.GRAB_R) / CELL), j1 = Math.floor((r.z + CLIMB.GRAB_R) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = i * 65536 + j;
        let arr = grid.get(k); if (!arr) grid.set(k, arr = []); arr.push(r);
      }
    }
  }
  return (x, z, y) => {
    const arr = grid.get(Math.floor(x / CELL) * 65536 + Math.floor(z / CELL));
    if (!arr) return null;
    let best = null, bd = CLIMB.GRAB_R;
    for (const r of arr) {
      if (y < r.y0 - 1 || y > r.y1 + CLIMB.GRAB_UP) continue;
      const d = Math.hypot(x - r.x, z - r.z);
      if (d <= bd) { bd = d; best = r; }
    }
    return best;
  };
}

// ---------------------------------------------------------------------------
// 3D 幾何(純表現層)
// ---------------------------------------------------------------------------
// A25:高頻/大量物件一律「單位幾何 + scale」+ InstancedMesh,共用幾何一律 markShared()
// (整場共用的那份被 disposeTree 放掉 ⇒ 所有借用者變空白)。三種設施各 2~3 個 draw call。

const UNIT = {};
const unitBox = () => (UNIT.box ??= markShared(new THREE.BoxGeometry(1, 1, 1)));
const unitCyl = () => (UNIT.cyl ??= markShared(new THREE.CylinderGeometry(0.5, 0.5, 1, 6)));
const unitIco = () => (UNIT.ico ??= markShared(new THREE.IcosahedronGeometry(0.5, 0)));

const MAT = {
  ladder: () => envMat(0x8d9299, { wash: 0.3, cool: 0.5 }),   // 鍍鋅鋼梯
  holds:  () => envMat(0xd8622f, { wash: 0.35, cool: 0.3 }),  // 岩場抓點(橘色樹脂)
  rope:   () => envMat(0xd9cf9a, { wash: 0.4, cool: 0.35 }),  // 米色編織繩
  anchor: () => envMat(0x6f757c, { wash: 0.3, cool: 0.5 }),   // 固定件(繩錨 / 梯腳)
};

/**
 * 建攀爬設施幾何。每條路線沿「攀爬軸」自 y0 立到 y1,朝向由該路線的向外法線 `nx/nz` 推 ——
 * A26:擺位方向與旋轉方向 MUST 同調,設施一律 `ry = atan2(nx, nz)`(local +z 指向法線外側),
 * **MUST NOT** 在此另算一次中央差分法線。回傳 THREE.Group(空路線回 null)。
 */
export function buildClimbMeshes(routes) {
  const list = routes || [];
  if (!list.length) return null;
  const g = new THREE.Group();
  g.name = 'climbRoutes';

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const P = new THREE.Vector3(), S = new THREE.Vector3();
  const put = (bucket, x, y, z, ry, sx, sy, sz) => {
    E.set(0, ry, 0); Q.setFromEuler(E); P.set(x, y, z); S.set(sx, sy, sz);
    bucket.push(M.clone().compose(P, Q, S));
  };
  const rails = [], rungs = [], holds = [], ropes = [], anchors = [];

  for (const r of list) {
    const ry = Math.atan2(r.nx, r.nz);          // local +z = 向外法線(擺位與旋轉同調)
    const H = Math.max(1, r.y1 - r.y0);
    const midY = (r.y0 + r.y1) / 2;
    // 設施貼在結構表面外緣一點點(軸在表面外 OFF,設施本體貼牆 → 玩家爬在設施「外側」)
    const sx = r.fx + r.nx * 0.35, sz = r.fz + r.nz * 0.35;
    if (r.kind === 'ladder') {
      for (const s of [-1, 1]) {                // 兩根立桅
        put(rails, sx + -r.nz * s * 0.42, midY, sz + r.nx * s * 0.42, ry, 0.12, H, 0.12);
      }
      const n = Math.min(320, Math.floor(H / CLIMB.RUNG));
      for (let i = 1; i <= n; i++) put(rungs, sx, r.y0 + i * CLIMB.RUNG, sz, ry, 0.92, 0.09, 0.09);
      put(anchors, sx + r.nx * 0.18, r.y1 + 0.55, sz + r.nz * 0.18, ry, 1.1, 1.1, 0.14);   // 頂端護框
    } else if (r.kind === 'holds') {
      const n = Math.min(200, Math.floor(H / CLIMB.HOLD));
      for (let i = 1; i <= n; i++) {            // 左右交錯的抓點(攀岩路線的手點/腳點)
        const s = i % 2 ? 1 : -1;
        put(holds, sx + -r.nz * s * 0.34, r.y0 + i * CLIMB.HOLD, sz + r.nx * s * 0.34, ry, 0.5, 0.34, 0.5);
      }
      put(anchors, sx, r.y1 + 0.45, sz, ry, 0.8, 0.5, 0.35);                                // 頂端確保站
    } else {
      put(ropes, sx, midY, sz, ry, 0.16, H, 0.16);                                          // 主繩
      const n = Math.min(120, Math.floor(H / CLIMB.KNOT));
      for (let i = 1; i <= n; i++) put(anchors, sx, r.y0 + i * CLIMB.KNOT, sz, ry, 0.3, 0.16, 0.3);  // 繩結
      put(anchors, sx + r.nx * 0.3, r.y1 + 0.4, sz + r.nz * 0.3, ry, 0.7, 0.28, 1.0);       // 頂端繩錨
    }
  }

  // 材質每型別各一份(rails/rungs 共用鋼梯那一份;每建一次戰場一組,隨 disposeTree 回收)
  const mats = { ladder: MAT.ladder(), holds: MAT.holds(), rope: MAT.rope(), anchor: MAT.anchor() };
  const add = (mtx, geo, mat) => {
    if (!mtx.length) return;
    const im = new THREE.InstancedMesh(geo, mat, mtx.length);
    mtx.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;      // 逐路線散布全圖,單一 bbox 剔除會整批消失
    im.userData.noOutline = true;  // 細桿描邊會糊成一團
    g.add(im);
  };
  add(rails, unitBox(), mats.ladder);
  add(rungs, unitBox(), mats.ladder);
  add(holds, unitIco(), mats.holds);
  add(ropes, unitCyl(), mats.rope);
  add(anchors, unitBox(), mats.anchor);
  return g;
}
