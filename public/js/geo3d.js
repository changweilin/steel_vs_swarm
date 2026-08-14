// ============ 程序生成幾何積木(全專案唯一縫)============
// 2026-08-14 新版機體建模整合:同一組積木本來有**兩份實作** —— `models.js` 的
// `mat`/`bx`/`cyl`/`dim`/`rbz`/`feather`/`jetFlame`/`segLimb`(未匯出的內部函式),
// 與機體鍛造台 `geo.js` 的 `matF`/`bxF`/`cylF`/`dimF`/`segLimbF`/`jetF`(逐字鏡射的副本,
// 當年為了讓原型台跑得起來而抄的)。新建模進遊戲之後那份副本就是**服役中的第二份實作**,
// 本檔把它收成一份(forge.js 檔頭列的第一筆欠帳)。
//
// 三條紀律:
//   ① 本檔**只 import three 與 toon.js**(leaf 模組)—— models.js / mecha/geo.js / 機體台
//      的舊版對照都 import 它,任何反向 import 都會做出循環。
//   ② 材質一律走 `mat()` → `toonMat`(A14:賽璐璐 ramp 暗階 ≥102,MUST NOT 自建 Material)。
//   ③ 名字**不加後綴**:`matF`/`bxF`… 那一套是副本時期的別名,`mecha/geo.js` 只做別名
//      re-export 讓 40 支逐機檔一行不改,新程式碼一律用本檔的原名。
import * as THREE from 'three';
import { toonMat } from './toon.js';

export function mat(color, opts = {}) {
  // 賽璐璐:PBR 參數不適用 toon;高金屬度 → 漫畫硬邊高光帶(celMetal)
  const { metalness, roughness, ...rest } = opts;
  return toonMat(color, { ...rest, celMetal: (metalness ?? 0) >= 0.5 });
}

/** 描邊寬度:隨單位尺寸走,遠看近看都 ≈ 2~3px 漫畫勾線 */
export const outlineW = (target) => Math.min(0.45, Math.max(0.05, target * 0.016));

/** 同色系明暗分版(賽璐璐面板分割:大色塊裡切出深淺層次) */
export const dim = (c, f) => new THREE.Color(c).multiplyScalar(f);

// ---------- 基本件(盒 / 圓柱 / 球 / 錐 / 環,自動掛進父層) ----------
export function bx(parent, w, h, d, x, y, z, color, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
export function cyl(parent, rt, rb, h, seg, x, y, z, color, opts) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color, opts));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
export function sph(parent, r, x, y, z, color, opts) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), mat(color, opts));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
export function cone(parent, r, h, seg, x, y, z, color, opts) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat(color, opts));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
export function torus(parent, R, r, x, y, z, color, opts, arc = Math.PI * 2) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(R, r, 6, 12, arc), mat(color, opts));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/**
 * 圓角量體(沿 z 長軸的橫置膠囊):w 寬(x)、h 高(y)、d 長(z)——
 * 仿生軀幹/鞘翅用「圓角矩形」取代方盒(2026-07-12 圓角化)。
 * 縮放在 mesh 局部軸(膠囊沿 y)先套、再轉橫:局部 x→世界 x、z→世界 y、y→世界 z(長軸不縮)。
 */
export function rbz(parent, w, h, d, x, y, z, color, opts) {
  const r = Math.min(w, h) / 2;
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, d - 2 * r), 4, 10), mat(color, opts));
  m.rotation.x = Math.PI / 2;
  m.scale.set(w / (2 * r), 1, h / (2 * r));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/**
 * 羽毛形羽片(圓角長葉幾何,壓扁;羽根錨在原點、沿翼展 ±x 伸出)。
 * 佈羽方向參照悟空光翼的放射扇(2026-07-12):羽根聚在翼根/腕點,
 * 羽尖向外「後」方張開、掠角 sw 逐片遞增 —— 不再是層疊的長方形板。
 * sgn = 翼側(+1 右 / −1 左);sw 以「純外向」為 0、往 −z(後方)增加。
 */
export function feather(parent, len, wd, x, y, z, sw, sgn, color, opts) {
  const geo = new THREE.CapsuleGeometry(wd / 2, Math.max(0.01, len - wd), 3, 8);
  geo.rotateZ(-Math.PI / 2);        // 沿 +x(翼展方向)
  geo.translate(len / 2, 0, 0);     // 羽根錨在原點(掠角繞根旋轉)
  geo.scale(1, 0.14, 1);            // 壓扁成羽片
  const m = new THREE.Mesh(geo, mat(color, opts));
  m.position.set(x, y, z);
  m.rotation.y = sgn > 0 ? sw : Math.PI - sw;
  parent.add(m);
  return m;
}

/**
 * 噴射尾焰(內焰白熾 + 外焰主色,沿局部 −y 噴出;呼叫端旋轉群組對準噴口軸向)。
 * 透明 → outlinify 自動跳過描邊(另掛 `noOutline` 明說,不靠透明度這個副作用);
 * 顯隱/長度/亮度由 locomotion 依速度驅動(rig.jets 登記 { g, m1, m2 }),靜止/地面完全熄火。
 */
export function jetFlame(parent, r, len, x, y, z, accent) {
  const grp = new THREE.Group();
  grp.position.set(x, y, z);
  parent.add(grp);
  const mk = (rr, ll, c, op, ei) => {
    const c2 = new THREE.Mesh(new THREE.ConeGeometry(rr, ll, 8),
      mat(c, { transparent: true, opacity: op, emissive: c, emissiveIntensity: ei }));
    c2.rotation.x = Math.PI;        // 錐尖朝 −y(噴流方向)
    c2.position.y = -ll / 2;
    c2.userData.noOutline = true;
    grp.add(c2);
    return c2;
  };
  const outer = mk(r, len, accent, 0.5, 2.2);
  const inner = mk(r * 0.5, len * 0.62, 0xfff1cf, 0.85, 2.8);
  grp.visible = false;                // 熄火起步(由 locomotion 點燃)
  return { g: grp, m1: outer.material, m2: inner.material };
}

/**
 * 分節肢:根樞軸 + 逐節子樞軸(肢體幾何朝 −y)。
 * 符號慣例:+x 旋轉 = 末端後移 ⇒ 膝後折為正、肘前折為負、踝取反號。
 * chain 收集 [{ g, base, k, d }](locomotion.js flexChain 消費)。
 */
export function segLimb(parent, pos, segs, chain) {
  const root = new THREE.Group();
  root.position.set(pos[0], pos[1], pos[2]);
  parent.add(root);
  let cur = root;
  segs.forEach((s, i) => {
    if (i > 0) {
      const j = new THREE.Group();
      const pv = s.piv;
      j.position.set(pv ? pv[0] : 0, pv ? pv[1] : -segs[i - 1].len, pv ? pv[2] : 0);
      j.rotation.x = s.base || 0;
      cur.add(j);
      chain.push({ g: j, base: s.base || 0, k: s.k || 0, d: s.d || 0 });
      cur = j;
    }
    s.draw(cur);
  });
  return root;
}
