// ============ 零件 × 實例 變換數學(純函式,零依賴)============
// 植被/神木是「宣告式零件表 + 每株實例變換」組裝的:零件自帶 px/pz(距軸心偏移)、
// y(高度)、rx/rz(枝幹傾角)、sy(縱向壓縮);實例自帶 x/y/z(落點)、s(體格)、
// ry(朝向)、tx/tz(每株站姿微傾斜)、dj(細節種子,見下)。
//
// 單一縫(§2.1):渲染端 biomes.js `buildVegMeshes` 與離線稽核 tools/audit_object_joints.mjs
// **共用這一支**,零件接合的正確性才驗得到真品。
//
// 契約:實例的朝向與微傾斜 MUST 當「剛體」整株套用 —— 先把零件擺到植株局部座標,
// 再整株旋轉。**MUST NOT** 把 ry/tx/tz 併進零件自己的歐拉角:
//   ① three 的 Euler 'XYZ' = Rx·Ry·Rz,把 ry 夾在中間 ⇒ 任何 rx ≠ 0 的零件
//      (枝梢雙叉、垂掛松蘿、蜂窩)方向會隨植株朝向被攪亂,而位移只吃水平旋轉
//      ⇒ 枝叉指到別的地方,接合處開縫。
//   ② 微傾斜若逐零件「繞自身中心」轉,零件中心不動 ⇒ 不是整株傾斜,而是
//      樹幹分段互相剪切錯位(接合面出現階差)。
// 接合完成度必須與 ry/tx/tz 無關,這是本檔存在的唯一理由。

/** three 的 Euler order 'XYZ'(R = Rx·Ry·Rz)→ 四元數 [x,y,z,w] */
export function quatFromEuler(x, y, z) {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

/** 四元數相乘(a 後乘 b:等效旋轉矩陣 Ra·Rb) */
export function quatMul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** 四元數旋轉向量 */
export function quatApply(q, v) {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

// ---- 細節抖動(2026-07-29「自然物件別太對稱、太整齊」)----
// dj = 每株細節種子(0~1,佈點時抽定;undefined/0 = 不抖,輸出與舊制逐位元一致)。
// 只動兩個**不影響接合**的自由度:
//   ① jr:水平半徑**只增不減**(縮放錨定零件中心,y 與 px/pz 偏移、縱向尺寸皆不動)——
//      增肥只會把零件埋得更深,MUST NOT 改成雙向抖(縮小會拉開「名義上剛好貼合」的
//      接合:桉樹貼幹葉簇/苔蘚簇一縮就 FLOAT,audit_object_joints 紅過)。
//      樹冠/葉簇(有 key)+0~18%、結構件(幹/枝)+0~8%(演出半徑仍收在權威
//      碰撞柱的餘裕內,原則 4);零件可帶 j 倍率(如 borderrock 岩塊 j:2)放大振幅。
//   ② spin:繞零件**自身擠出軸**自轉(後乘四元數 = 局部軸,端點不動)——
//      疊錐的面稜逐層錯開、ico 簇換剪影,同型兩株不再同一張剪影。
//      **只給軸心零件(px/pz = 0)**:偏移件(貼幹葉簇/苔簇)的貼合靠特定朝向的
//      頂點,自轉會把「剛好貼上」轉開(euc 貼幹簇 FLOAT 過,稽核紅字為證)。
// MUST NOT 抖 y / px / pz / 縱向縮放(會拉開疊接縫);抖動只由(零件識別, dj)決定,
// 與 ry/tx/tz 無關(A27 接合完成度不變式)。整數雜湊(不走 Math.sin)= 跨引擎逐位元一致。
function hash01(i, j) {
  let h = (Math.imul(i | 0, 0x9E3779B1) ^ Math.imul(j | 0, 0x85EBCA77)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0xC2B2AE3D);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * 零件識別(量化的擺位鍵):同株各零件不同、同零件跨實例相同 ⇒ 差異全部來自 dj。
 * **單一縫**:植被的宣告式零件表(`vegPartXform`)與障礙/地標的程序生成子樹
 * (`hazards.js` / `biomes.js` 的 Object3D 子節點)同吃這一支 —— 兩邊各算一次鍵的話,
 * 「同一顆物件的同一個零件」在兩條路徑上會抖出不同的值,而畫面上完全看不出來。
 */
export function partId(y, px, pz) {
  return Math.round((y || 0) * 8) * 131 + Math.round((px || 0) * 8) * 373 + Math.round((pz || 0) * 8) * 769;
}

/**
 * 細節抖動的兩個自由度(見檔頭「細節抖動」段的完整理由)。
 * @param pid   partId 的輸出
 * @param dj    實例細節種子(0~1;0/undefined = 不抖,輸出逐位元同舊制)
 * @param amp   半徑增幅上界(只增不減)
 * @param axial 這個零件是否**軸心件**(px = pz = 0);只有軸心件准自轉
 * @returns { jr 水平半徑倍率 ≥ 1, spin 繞自身擠出軸的自轉弧度 }
 */
export function partJitter(pid, dj, amp, axial) {
  if (!dj) return { jr: 1, spin: 0 };
  const di = (dj * 8191) | 0;
  return {
    jr: 1 + hash01(pid, di) * amp,                                    // 只增不減(見檔頭)
    spin: axial ? (hash01(pid ^ 0x5bd1e99, di) - 0.5) * Math.PI * 2 : 0,   // 僅軸心零件(見檔頭)
  };
}

/**
 * 零件 × 實例 → 世界變換。
 * @param part { g, y, px, pz, rx, rz, sy, key?, j? }
 * @param it   { x, y, z, s, ry, tx, tz, dj? }
 * @returns { pos:[x,y,z], quat:[x,y,z,w], scl:[x,y,z] }
 */
export function vegPartXform(part, it) {
  const s = it.s ?? 1;
  // 實例剛體旋轉:朝向 ry 外層、站姿微傾斜內層(繞植株腳底)
  const qi = quatMul(quatFromEuler(0, it.ry || 0, 0), quatFromEuler(it.tx || 0, 0, it.tz || 0));
  const off = quatApply(qi, [(part.px || 0) * s, (part.y || 0) * s, (part.pz || 0) * s]);
  // 零件識別 = 量化的擺位鍵(同株各零件不同、同零件跨實例同鍵 → 差異全來自 dj);
  // 抖動的兩個自由度與規則住 partJitter(障礙/地標的程序生成子樹同吃那一支)
  const { jr, spin } = partJitter(
    partId(part.y, part.px, part.pz), it.dj,
    (part.key ? 0.18 : 0.08) * (part.j || 1),
    !(part.px || part.pz),
  );
  let quat = quatMul(qi, quatFromEuler(part.rx || 0, part.ry || 0, part.rz || 0));
  if (spin) quat = quatMul(quat, quatFromEuler(0, spin, 0));   // 後乘 = 繞自身軸,端點不動
  return {
    pos: [it.x + off[0], it.y + off[1], it.z + off[2]],
    quat,
    scl: [s * jr, s * (part.sy || 1), s * jr],
  };
}
