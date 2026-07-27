// ============ 零件 × 實例 變換數學(純函式,零依賴)============
// 植被/神木是「宣告式零件表 + 每株實例變換」組裝的:零件自帶 px/pz(距軸心偏移)、
// y(高度)、rx/rz(枝幹傾角)、sy(縱向壓縮);實例自帶 x/y/z(落點)、s(體格)、
// ry(朝向)、tx/tz(每株站姿微傾斜)。
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

/**
 * 零件 × 實例 → 世界變換。
 * @param part { g, y, px, pz, rx, rz, sy }
 * @param it   { x, y, z, s, ry, tx, tz }
 * @returns { pos:[x,y,z], quat:[x,y,z,w], scl:[x,y,z] }
 */
export function vegPartXform(part, it) {
  const s = it.s ?? 1;
  // 實例剛體旋轉:朝向 ry 外層、站姿微傾斜內層(繞植株腳底)
  const qi = quatMul(quatFromEuler(0, it.ry || 0, 0), quatFromEuler(it.tx || 0, 0, it.tz || 0));
  const off = quatApply(qi, [(part.px || 0) * s, (part.y || 0) * s, (part.pz || 0) * s]);
  return {
    pos: [it.x + off[0], it.y + off[1], it.z + off[2]],
    quat: quatMul(qi, quatFromEuler(part.rx || 0, part.ry || 0, part.rz || 0)),
    scl: [s, s * (part.sy || 1), s],
  };
}
