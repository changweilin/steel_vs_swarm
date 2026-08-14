// ============ 紙娃娃形狀型錄 + 邊緣鈍化/銳化(dev-only)============
// 使用者第五輪的兩件事:「更換形狀」與「邊緣鈍化銳化」。
//
// ---- 形狀型錄 ----
// 名冊住 doll.js(`SHAPE_KEYS`,零 THREE ⇒ 離線稽核驗得到);本檔只放**幾何實作**,
// 逐款產一顆「填滿單位立方體」的幾何,套用端再依原零件的包圍盒縮放 ——
// 換形狀因此**不會位移**(同一個盒、同一個中心),掛在肢體上的零件不會跳走。
// 積木一律取自 geo.js 的多面體語彙(facet/quadsGeo/weldSmooth),MUST NOT 在這裡自建第二套
// 硬邊化與描邊救援副本(那正是 geo.js 檔頭紀律 ① 在講的事)。
//
// ---- 邊緣鈍化/銳化 ----
// 尺只有一把:`bevel ∈ [−1, +1]`。+1 = 拉普拉斯平滑(角被磨圓、法線轉平滑),
// −1 = 反向拉普拉斯(角被推尖)+ 逐面法線。**兩個方向共用同一支** `bevelGeo`,
// MUST NOT 拆成「圓角器」與「銳化器」兩份實作。
// 位移一律夾在該頂點鄰邊均長的一半內 —— 反向拉普拉斯沒有天生上界,不夾就會把零件炸成星爆
// (而「使用者自己拖成這樣」與「數值爆掉」在畫面上長得一模一樣)。
import * as THREE from 'three';
import { facet, weldSmooth, quadsGeo } from '../../public/js/forge/geo.js';
import { SHAPE_KEYS } from './doll.js';

/** 由「逐段剖面」組帶狀多面體(薄刃/楔形共用;每段 = 逆時針四角) */
function bandsGeo(secs) {
  const quads = [[secs[0][0], secs[0][1], secs[0][2], secs[0][3]]];   // 起端蓋
  for (let i = 0; i + 1 < secs.length; i++) {
    const a = secs[i], b = secs[i + 1];
    quads.push([a[3], a[2], b[2], b[3]], [a[1], a[0], b[0], b[1]],
      [a[2], a[1], b[1], b[2]], [a[0], a[3], b[3], b[0]]);
  }
  const e = secs[secs.length - 1];
  quads.push([e[0], e[3], e[2], e[1]]);                              // 末端蓋
  return quadsGeo(quads);
}
/** 由「逐面多邊形」組硬邊幾何(扇形三角化)—— quadsGeo 只吃四角,楔形的兩片側面是三角。
 *  退化四角(第四點 = 第三點)會產生零面積三角形 ⇒ 法線是零向量,那一片在賽璐璐光下是黑的。 */
function polyGeo(faces) {
  const arr = [];
  for (const f of faces) for (let i = 1; i + 1 < f.length; i++) arr.push(...f[0], ...f[i], ...f[i + 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  return facet(g);
}

/** 矩形剖面(w × t)置於高度 y、沿 z 偏移 zc */
const rectSec = (w, t, y, zc = 0) => [
  [-w / 2, y, zc - t / 2], [w / 2, y, zc - t / 2],
  [w / 2, y, zc + t / 2], [-w / 2, y, zc + t / 2],
];

/** 單位形狀產生器(填滿 1×1×1;makeShape 會再正規化一次,不必自己算得剛好)。
 *  鍵集 MUST === doll.js 的 `SHAPE_KEYS`(稽核逐項比對)。 */
export const SHAPE_GENS = {
  box: () => facet(new THREE.BoxGeometry(1, 1, 1)),
  prism3: () => facet(new THREE.CylinderGeometry(0.5, 0.5, 1, 3)),
  prism5: () => facet(new THREE.CylinderGeometry(0.5, 0.5, 1, 5)),
  prism6: () => facet(new THREE.CylinderGeometry(0.5, 0.5, 1, 6)),
  prism8: () => facet(new THREE.CylinderGeometry(0.5, 0.5, 1, 8)),
  // 楔台:裝甲板與肢殼的主力(tboxF 同型,頂面收窄)
  frustum: () => bandsGeo([rectSec(1, 1, -0.5), rectSec(0.62, 0.62, 0.5)]),
  cyl: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
  cone: () => new THREE.ConeGeometry(0.5, 1, 14),
  sphere: () => new THREE.SphereGeometry(0.5, 16, 12),
  capsule: () => new THREE.CapsuleGeometry(0.34, 0.5, 4, 14),
  // 楔形斜坡(三角柱):底 + 斜面 + 後板 + 兩片三角側面(繞序皆為「自外側看逆時針」)
  wedge: () => polyGeo([
    [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]],   // 底 −y
    [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]],     // 斜面
    [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]],   // 後 −z
    [[0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, -0.5, 0.5]],                        // 右 +x
    [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, -0.5]],                     // 左 −x
  ]),
  // 圓盤:倒角輪緣的旋成體(關節環/推進盤)
  disc: () => new THREE.LatheGeometry([[0.001, -0.5], [0.38, -0.5], [0.5, -0.34],
    [0.5, 0.34], [0.38, 0.5], [0.001, 0.5]].map(([r, y]) => new THREE.Vector2(r, y)), 20),
  // 薄刃:根寬梢窄的三段剖面(羽片/刀刃/槳葉)
  blade: () => bandsGeo([rectSec(1, 0.34, -0.5), rectSec(0.78, 0.2, 0.05, 0.06), rectSec(0.16, 0.06, 0.5, 0.1)]),
  crystal: () => facet(new THREE.OctahedronGeometry(0.5)),
};

/** 型錄鍵集(面板列表由此推導;MUST NOT 在 UI 端另寫一份順序) */
export const shapeKeys = () => SHAPE_KEYS.filter((k) => SHAPE_GENS[k]);

/** 把幾何正規化成「置中且填滿 1×1×1」(退化軸維持原厚度,MUST NOT 除以 0) */
function unitize(geo) {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const c = b.getCenter(new THREE.Vector3());
  const s = b.getSize(new THREE.Vector3());
  geo.translate(-c.x, -c.y, -c.z);
  geo.scale(1 / Math.max(1e-4, s.x), 1 / Math.max(1e-4, s.y), 1 / Math.max(1e-4, s.z));
  return geo;
}

/**
 * 換形狀:產一顆填滿 `size` 這個盒的新幾何(原點 = 盒中心)。
 * 呼叫端負責把它擺回原零件包圍盒的中心 —— 這一支不知道零件在哪,也不該知道。
 */
export function makeShape(kind, size) {
  const gen = SHAPE_GENS[kind];
  if (!gen) return null;
  const geo = unitize(gen());
  geo.scale(Math.max(1e-3, size.x), Math.max(1e-3, size.y), Math.max(1e-3, size.z));
  const og = geo.userData.outlineGeo;
  if (og) {   // 描邊救援副本要跟著同一組變換,否則描邊殼停在單位盒大小
    unitize(og).scale(Math.max(1e-3, size.x), Math.max(1e-3, size.y), Math.max(1e-3, size.z));
  }
  return geo;
}

/**
 * 鏡射複本(黏貼件「貼到另一邊」用):真的把幾何沿 X 翻面 —— 逐三角**改繞序**再重算法線。
 * MUST NOT 用 `scale.x = -1` 代替:那會讓正面被剔除(看到的是零件的內裡),
 * 而改 `side = DoubleSide` 只是把它蓋回去,法線仍朝內 ⇒ 賽璐璐光下整件是暗的。
 */
export function mirrorGeo(src) {
  const g = (src.index ? src.toNonIndexed() : src.clone());
  g.scale(-1, 1, 1);
  const pos = g.attributes.position.array;
  for (let i = 0; i < pos.length; i += 9) {          // 每三角:交換第 2、3 個頂點 = 繞序反轉
    for (let k = 0; k < 3; k++) {
      const a = pos[i + 3 + k];
      pos[i + 3 + k] = pos[i + 6 + k];
      pos[i + 6 + k] = a;
    }
  }
  g.attributes.position.needsUpdate = true;
  g.computeVertexNormals();
  // 描邊救援副本也要鏡射,而且 MUST 重新焊接成平滑法線(鏡射後逐面法線的殼會沿面外推撐裂)
  const og = src.userData.outlineGeo;
  if (og) g.userData.outlineGeo = weldSmooth(mirrorGeo(og));
  return g;
}

/**
 * 邊緣鈍化(t > 0)/ 銳化(t < 0)。回傳**新幾何**(呼叫端負責 dispose 舊的,A25)。
 * t = 0 或幾何拿不到位置 ⇒ 回 null(語意 = 這一格沒有改動,MUST NOT 回一份等值副本:
 * 那會讓「有沒有改過」在下游變成要比對浮點數才知道)。
 */
export function bevelGeo(src, t, passes = 2) {
  if (!t || !src?.attributes?.position) return null;
  const flat = src.index ? src.toNonIndexed() : src;      // weldSmooth 讀的是三角形湯
  const w = weldSmooth(flat);
  const pos = w.attributes.position;
  const idx = w.index.array;
  const n = pos.count;
  const nb = Array.from({ length: n }, () => new Set());
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]];
    nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
  }
  const P = pos.array;
  const k = Math.min(1, Math.abs(t)) * (t > 0 ? 0.5 : 0.34);
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(P);
    for (let i = 0; i < n; i++) {
      const ns = nb[i];
      if (!ns.size) continue;
      let ax = 0, ay = 0, az = 0, elen = 0;
      for (const j of ns) {
        ax += P[j * 3]; ay += P[j * 3 + 1]; az += P[j * 3 + 2];
        elen += Math.hypot(P[j * 3] - P[i * 3], P[j * 3 + 1] - P[i * 3 + 1], P[j * 3 + 2] - P[i * 3 + 2]);
      }
      ax /= ns.size; ay /= ns.size; az /= ns.size;
      elen /= ns.size;
      // 鈍化 = 往鄰居重心靠(角被磨掉);銳化 = 反方向推(角更突出)
      const sgn = t > 0 ? 1 : -1;
      let dx = (ax - P[i * 3]) * k * sgn;
      let dy = (ay - P[i * 3 + 1]) * k * sgn;
      let dz = (az - P[i * 3 + 2]) * k * sgn;
      // 位移上界 = 鄰邊均長的一半:反向拉普拉斯沒有自然上界,不夾就會星爆
      const d = Math.hypot(dx, dy, dz), cap = elen * 0.5;
      if (d > cap && d > 1e-9) { const f = cap / d; dx *= f; dy *= f; dz *= f; }
      next[i * 3] = P[i * 3] + dx;
      next[i * 3 + 1] = P[i * 3 + 1] + dy;
      next[i * 3 + 2] = P[i * 3 + 2] + dz;
    }
    P.set(next);
  }
  pos.needsUpdate = true;
  if (t > 0) {
    // 鈍化:焊接 + 平滑法線本身就是「圓潤」的樣子;描邊殼直接用它自己(已是焊過的)
    w.computeVertexNormals();
    return w;
  }
  // 銳化:回硬邊多面體(逐面法線)+ 描邊救援副本(紀律 ①)
  const out = facet(w.toNonIndexed());
  w.dispose();
  return out;
}
