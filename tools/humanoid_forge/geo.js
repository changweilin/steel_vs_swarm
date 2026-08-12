// ============ 多面體零件語彙(dev-only;人形鍛造台共用幾何庫)============
// 2026-08-12 使用者指示:「所有機體不要只使用簡單的立方體,參考各機體的 2D 圖像,針對
// 身體/四肢/頭部/翅膀/羽毛/尾巴/觸手等不同生物部位,設計各自的多面體或多邊形來組合,
// 特別是羽毛/尾巴/觸手需採用多零件組合;武器也一樣的邏輯」。
// 本檔 = 那句話的「字母表」:楔台/稜柱/旋成體/薄刃鰭片/羽扇/節鏈/纜束 —— 每一個都是
// 「一顆幾何」以上的**零件語彙**,逐機檔案(mechs/*.js)只准用這裡的字母拼字,
// MUST NOT 在逐機檔內自己 new BufferGeometry(第二份實作)。
//
// 三條紀律:
//   ① 硬邊多面體(非索引、逐面法線)MUST 附 userData.outlineGeo 焊接平滑副本 ——
//      toon.js outlinify 的反轉外殼沿法線外推,per-face 法線會把描邊撐裂(toon.js:926)。
//   ② 零 Math.random(§2.3):羽扇/節鏈的片間差異一律決定性遞變(索引函數)。
//   ③ 材質一律走 matF → toonMat(A14);本檔只 import three 與 /public/js/toon.js。
import * as THREE from 'three';
import { toonMat } from '/public/js/toon.js';

// ---- 材質與常用色(models.js 內部積木的鏡射;正式整合前的已知欠帳,見 forge.js 檔頭)----
export function matF(color, opts = {}) {
  const { metalness, roughness, ...rest } = opts;
  return toonMat(color, { ...rest, celMetal: (metalness ?? 0) >= 0.5 });
}
export const dimF = (c, f) => new THREE.Color(c).multiplyScalar(f);
export const IRON = 0x23262a, GUNMETAL = 0x1a1d20, COAL = 0x14171a, INK = 0x0d0f11;
export const BONE = 0xd8d4c8, BRASS = 0xe8b33a;
export const outlineWF = (target) => Math.min(0.45, Math.max(0.05, target * 0.016));

// ---- 基本件(小零件仍可用;大件請優先用下方多面體語彙)----
export function bxF(parent, w, h, d, x, y, z, color, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matF(color, opts));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
export function cylF(parent, rt, rb, h, seg, x, y, z, color, opts) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), matF(color, opts));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
export function sphF(parent, r, x, y, z, color, opts) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), matF(color, opts));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
export function coneF(parent, r, h, seg, x, y, z, color, opts) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), matF(color, opts));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
export function torusF(parent, R, r, x, y, z, color, opts, arc = Math.PI * 2) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(R, r, 6, 12, arc), matF(color, opts));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** 分節肢:鏡射 models.js segLimb(:5076)。符號慣例同源 —— 肢體幾何朝 −y,
 *  +x 旋轉 = 末端後移 ⇒ 膝後折為正、肘前折為負、踝取反號。 */
export function segLimbF(parent, pos, segs, chain) {
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

// ---- 關節機構語彙(逐機互異的「字母」;自 forge.js 移入)---------------------
/** t01/t11/t06:外露液壓缸(單端錨、斜置、不跨樞軸)+ 缸頭關節環;core 給亮桿芯 */
export function hydCyl(p, r, len, x, y, z, tiltX, core = null) {
  const c = cylF(p, r, r, len, 6, x, y, z, IRON, { metalness: 0.85 });
  c.rotation.x = tiltX;
  cylF(p, r * 1.5, r * 1.5, r * 1.2, 8, x, y + len * 0.55, z, 0x3a4048, { metalness: 0.8 });
  if (core) {
    const k = cylF(p, r * 0.55, r * 0.55, len * 0.5, 6, x, y - len * 0.45, z, core, { metalness: 0.9 });
    k.rotation.x = tiltX;
  }
  return c;
}
/** t02:雙件式肌腱缸(上段深色缸體 + 下段外露亮活塞桿)—— 生體 × 機構的縫合感 */
export function sinew(p, h, x, y, z, lite) {
  cylF(p, 0.11, 0.11, h * 0.62, 8, x, y + h * 0.16, z, IRON, { metalness: 0.8 });
  cylF(p, 0.05, 0.05, h * 0.92, 6, x, y - h * 0.06, z, lite, { metalness: 0.9 });
}
/** t12:蜈蚣體節 —— 兩片圓角感的疊板(下片窄薄前移壓出疊層陰影)+ 節末外露軸環 */
export function seg2(p, w, len, d, y, main, sub) {
  bxF(p, w, len, d, 0, y - len / 2, 0, main, { metalness: 0.55 });
  bxF(p, w * 0.9, len * 0.94, d * 0.92, 0, y - len / 2 - len * 0.03, 0.03, sub, { metalness: 0.55 });
  const ax = cylF(p, w * 0.32, w * 0.32, w * 0.28, 10, 0, y - len, 0, COAL, { metalness: 0.85 });
  ax.rotation.z = Math.PI / 2;
}

// ══════════ 多面體語彙 ══════════

/** 位置焊接(容差 1e-4)→ 索引幾何 + 平滑法線:描邊外殼專用副本。 */
export function weldSmooth(geo) {
  const pos = geo.attributes.position;
  const map = new Map();
  const verts = [];
  const idx = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let j = map.get(key);
    if (j == null) {
      j = verts.length / 3;
      verts.push(x, y, z);
      map.set(key, j);
    }
    idx.push(j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 硬邊化:非索引 + 逐面法線(多面體的「面」),並掛描邊救援副本(紀律 ①)。 */
export function facet(geo) {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  flat.computeVertexNormals();
  flat.userData.outlineGeo = weldSmooth(flat);
  return flat;
}
const mesh = (parent, geo, x, y, z, color, opts) => {
  const m = new THREE.Mesh(geo, matF(color, opts));
  if (geo.userData.outlineGeo) m.userData.outlineGeo = geo.userData.outlineGeo;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
};

/** 由「逐面四角」清單組非索引幾何(內部:tbox/fin 共用)。每 quad = [a,b,c,d] 逆時針。 */
export function quadsGeo(quads) {
  const arr = [];
  for (const [a, b, c, d] of quads) arr.push(...a, ...b, ...c, ...a, ...c, ...d);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  return facet(g);
}

/**
 * 楔台(tapered box / frustum)—— 裝甲板與肢殼的主力,取代「簡單的立方體」。
 * 底面 w0×d0、頂面 w1×d1、高 h,頂面可平移 (sx, sz) 做斜切/後掠;原點在幾何中心。
 * spec = { w0, d0, w1, d1, h, sx = 0, sz = 0 }
 */
export function tboxF(parent, spec, x, y, z, color, opts) {
  const { w0, d0, h, sx = 0, sz = 0 } = spec;
  const w1 = spec.w1 ?? w0, d1 = spec.d1 ?? d0;
  const b = [
    [-w0 / 2, -h / 2, -d0 / 2], [w0 / 2, -h / 2, -d0 / 2],
    [w0 / 2, -h / 2, d0 / 2], [-w0 / 2, -h / 2, d0 / 2],
  ];
  const t = [
    [sx - w1 / 2, h / 2, sz - d1 / 2], [sx + w1 / 2, h / 2, sz - d1 / 2],
    [sx + w1 / 2, h / 2, sz + d1 / 2], [sx - w1 / 2, h / 2, sz + d1 / 2],
  ];
  const geo = quadsGeo([
    [t[0], t[3], t[2], t[1]],   // 頂 +y
    [b[0], b[1], b[2], b[3]],   // 底 −y
    [b[3], b[2], t[2], t[3]],   // 前 +z
    [b[1], b[0], t[0], t[1]],   // 後 −z
    [b[2], b[1], t[1], t[2]],   // 右 +x
    [b[0], b[3], t[3], t[0]],   // 左 −x
  ]);
  return mesh(parent, geo, x, y, z, color, opts);
}

/**
 * 稜柱(extruded polygon)—— 胸廓剖面/盾形/月牙刃/領翼/楔形頭殼的主力。
 * pts = XY 平面上的多邊形頂點([[x,y],...] 逆時針),沿 Z 擠出 depth(置中)。
 * opts.bevel = { t, s } 選用斜切邊。
 */
export function prismF(parent, pts, depth, x, y, z, color, opts = {}) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  const bevel = opts.bevel;
  const { bevel: _b, ...matOpts } = opts;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: !!bevel,
    bevelThickness: bevel?.t ?? 0, bevelSize: bevel?.s ?? 0, bevelSegments: 1,
  });
  geo.translate(0, 0, -depth / 2);
  const flat = facet(geo);
  // 斜切邊的擠出體:bevel 產生的近重合頂點焊出來的平滑殼會在正面畫出雜亂描邊線
  // (2026-08-12 t12 實測)—— 這種形狀輪廓本就圓滑,描邊殼直接用原幾何即可。
  if (bevel) delete flat.userData.outlineGeo;
  return mesh(parent, flat, x, y, z, color, matOpts);
}

/**
 * 旋成體(lathe)—— 球肩圓頂/波紋鼓/砲口/關節環的主力。
 * profile = [[r, y], ...] 由下而上繞 Y 旋轉;seg 徑向段數(預設 10,低模面數紀律)。
 */
export function latheF(parent, profile, seg, x, y, z, color, opts) {
  const geo = new THREE.LatheGeometry(profile.map(([r, py]) => new THREE.Vector2(Math.max(0.0001, r), py)), seg || 10);
  geo.computeVertexNormals();          // 旋成體維持平滑(圓頂/鼓身);描邊不需救援副本
  return mesh(parent, geo, x, y, z, color, opts);
}

/**
 * 薄刃鰭片(單片羽毛/刀刃/尖刺/槳葉)—— 沿 +Y 伸長,原點在根部(呼叫端當羽軸樞轉)。
 * spec = { len, w0, w1, t, sweep = 0, camber = 0 }
 *   w0 根寬 → w1 梢寬(x 向);t 根厚(往梢自動收薄);sweep 梢端沿 +z 後掠;camber 中段拱起。
 * 三段剖面(根/中/梢)= 有稜有面的「多邊形」羽片,不是一片薄板。
 */
export function finF(parent, spec, x, y, z, color, opts) {
  const { len, w0, w1, t, sweep = 0, camber = 0 } = spec;
  const sec = (ty) => {
    const w = w0 + (w1 - w0) * ty;
    const th = t * (1 - 0.7 * ty);
    const zc = sweep * ty + camber * Math.sin(Math.PI * ty);
    return [
      [-w / 2, ty * len, zc - th / 2], [w / 2, ty * len, zc - th / 2],
      [w / 2, ty * len, zc + th / 2], [-w / 2, ty * len, zc + th / 2],
    ];
  };
  const s0 = sec(0), s1 = sec(0.55), s2 = sec(1);
  const band = (a, b) => [
    [a[3], a[2], b[2], b[3]],   // 前 +z
    [a[1], a[0], b[0], b[1]],   // 後 −z
    [a[2], a[1], b[1], b[2]],   // 右 +x
    [a[0], a[3], b[3], b[0]],   // 左 −x
  ];
  const geo = quadsGeo([
    [s0[0], s0[1], s0[2], s0[3]],                 // 根蓋 −y
    ...band(s0, s1), ...band(s1, s2),
    [s2[0], s2[3], s2[2], s2[1]],                 // 梢蓋(收薄後近稜線)
  ]);
  return mesh(parent, geo, x, y, z, color, opts);
}

/**
 * 羽扇(多零件組合)—— 翅膀/鬃毛/尾羽/火焰翎的主力:一片羽毛 = 一顆零件,
 * n 片沿樞軸扇形排列,長度自中央往兩側決定性遞減(§2.3:零亂數)。
 * spec = { n, arc, len, edgeF = 0.55, gap = 0.012, fin: { w0, w1, t, sweep, camber } }
 *   排列面 = 樞軸 Group 的局部 XY 平面(逐片繞 Z 轉 ±arc/2);呼叫端旋轉 Group 定向。
 * 回傳 { g(樞軸), fins[] }。
 */
export function fanF(parent, spec, x, y, z, color, opts) {
  const { n, arc, len, edgeF = 0.55, gap = 0.012, fin } = spec;
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  const fins = [];
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : i / (n - 1) - 0.5;              // −0.5 ~ +0.5
    const f = finF(g, { ...fin, len: len * (1 - (1 - edgeF) * Math.abs(u) * 2) },
      0, 0, (i - (n - 1) / 2) * gap, color, opts);          // 逐片 z 錯位防 z-fighting
    f.rotation.z = -arc * u;
    fins.push(f);
  }
  return { g, fins };
}

/**
 * 節鏈(多零件尾巴/觸手/鞭)—— 每節 = 樞軸 Group + 收分節身 + 節間關節環,
 * 節身沿 −Z(尾巴慣例,同 t06/m05;rig.tailSegs 直接吃回傳的 segs)。
 * ⚠ rot0/rotD 只在**靜態展示**成立:segs 一旦掛進 rig.tailSegs,locomotion whipTail
 * 每幀直接覆寫節樞軸 rotation.x/y(segs[0] 只留 base、其餘 ≈0)—— 垂掛/上捲的基礎姿勢
 * MUST 放在 chainF 之上的**靜態中介 Group**,或把曲線寫進節身幾何(2026-08-12 仿生批次
 * 四台實測同一個坑:s06/s09/m02 走中介 Group、s09 尾另走位置編碼手排)。
 * rig.tents 不受此限(tentGuard 寫入含 j.base ⇒ 基礎角保留)。
 * spec = { n, x, y, z, len0, len1, r0, r1, rot0 = 0.5, rotD = -0.05,
 *          ring = true, ringColor = IRON, seg = 8, drawSeg? }
 *   drawSeg(group, i, { r, len }):逐節加料(鱗片/毛簇/發光環)的掛點。
 * 回傳 { segs[], tip(末節 Group), lenOf(i) }。
 */
export function chainF(parent, spec, color, opts) {
  const { n, x = 0, y = 0, z = 0, len0, len1, r0, r1,
    rot0 = 0.5, rotD = -0.05, ring = true, ringColor = IRON, seg = 8, drawSeg } = spec;
  const segs = [];
  let cur = parent, px = x, py = y, pz = z, prevLen = 0;
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : i / (n - 1);
    const r = r0 + (r1 - r0) * u;
    const len = len0 + (len1 - len0) * u;
    const t = new THREE.Group();
    t.position.set(px, py, i === 0 ? pz : -prevLen);
    t.rotation.x = rot0 + i * rotD;
    cur.add(t);
    const body = cylF(t, r, r * 0.82, len, seg, 0, 0, -len / 2, color, opts);
    body.rotation.x = Math.PI / 2;
    if (ring) {
      const j = cylF(t, r * 1.18, r * 1.18, r * 0.5, seg, 0, 0, -0.02, ringColor, { metalness: 0.8 });
      j.rotation.x = Math.PI / 2;
    }
    if (drawSeg) drawSeg(t, i, { r, len });
    segs.push(t);
    cur = t; px = 0; py = 0; prevLen = len;
  }
  return { segs, tip: segs[n - 1], tipZ: -(len0 + (len1 - len0)) };
}

// ══════════ 航空語彙(2026-08-12 第四輪:機體台擴充到航空機體)══════════
// 三個字母服務「飛機/無人機這類有現實機體原型」的那一頁:翼面 / 旋翼 / 尾焰。
// 與生物語彙同一條紀律 —— 逐機檔只准用字母拼字,MUST NOT 自己 new BufferGeometry。

/**
 * 翼面(有翼型剖面的梯形機翼)—— 沿 +X 伸出,原點在翼根前後緣中點。
 * 「一片薄板」是這一類機體最容易畫錯的地方:真機翼有**弦長收分 + 後掠 + 上反 + 扭轉**,
 * 剖面是拱形不是矩形。逐段三剖面(根/中/梢)拼出多面體,側視看得到翼型厚度。
 * spec = { span, c0, c1, t, sweep = 0, dihedral = 0, twist = 0 }
 *   c0 根弦 → c1 梢弦(沿 Z;+z = 前緣);t 根厚(往梢自動收薄);
 *   sweep 梢端後移量(−z 方向為正);dihedral 梢端上抬量;twist 梢端洗流扭轉(弧度)。
 */
export function wingF(parent, spec, x, y, z, color, opts) {
  const { span, c0, c1, t, sweep = 0, dihedral = 0, twist = 0 } = spec;
  // 翼型剖面(6 邊形:前緣尖 → 上表面拱起 → 後緣尖 → 下表面近平)
  const sec = (u) => {
    const c = c0 + (c1 - c0) * u;
    const th = t * (1 - 0.55 * u);
    const tw = twist * u;
    const pts = [[0.5, 0], [1 / 6, 0.5], [-1 / 3, 0.35], [-0.5, 0], [-1 / 3, -0.2], [1 / 6, -0.3]];
    return pts.map(([cz, cy]) => {
      const pz = cz * c, py = cy * th;
      // 扭轉繞翼展軸(+X):剖面在 ZY 平面內轉 tw
      return [u * span, py * Math.cos(tw) - pz * Math.sin(tw) + dihedral * u,
        pz * Math.cos(tw) + py * Math.sin(tw)];
    });
  };
  const s0 = sec(0), s1 = sec(0.5), s2 = sec(1);
  const band = (a, b) => a.map((_, i) => {
    const j = (i + 1) % a.length;
    return [a[i], a[j], b[j], b[i]];
  });
  const cap = (s, flip) => (flip
    ? [[s[0], s[1], s[2], s[3]], [s[3], s[4], s[5], s[0]]]
    : [[s[3], s[2], s[1], s[0]], [s[0], s[5], s[4], s[3]]]);
  return mesh(parent, quadsGeo([...cap(s0, false), ...band(s0, s1), ...band(s1, s2), ...cap(s2, true)]),
    x, y, z, color, opts);
}

/**
 * 旋翼(多零件:定向臂座 + 自轉槳盤 + n 片收分槳葉)—— 旋翼機的視覺主角。
 * spec = { r, blades = 2, pitch = 0.12, hub = r*0.14, thick = 0.03, tilt = [x,z] }
 *   tilt = 臂座朝向(傾轉旋翼/尾旋翼給非零值);pitch = 槳距(逐片繞自身長軸)。
 * 回傳 { holder(定向), prop(自轉;呼叫端推進 rotation.y), blades[] } ——
 * 自轉由**呼叫端**每幀推進(戰場走 game.js spinners 吃 userData.spin,展示台同一份名冊)。
 */
export function rotorF(parent, spec, x, y, z, color, opts) {
  const { r, blades = 2, pitch = 0.12, hub, thick = 0.03, tilt } = spec;
  const hr = hub ?? r * 0.14;
  const holder = new THREE.Group();
  holder.position.set(x, y, z);
  if (tilt) { holder.rotation.x = tilt[0] || 0; holder.rotation.z = tilt[1] || 0; }
  parent.add(holder);
  cylF(holder, hr * 0.85, hr, hr * 1.6, 8, 0, 0, 0, COAL, { metalness: 0.85 });   // 馬達
  const prop = new THREE.Group();
  prop.position.y = hr * 1.1;
  holder.add(prop);
  latheF(prop, [[0, 0], [hr * 0.9, 0.01], [hr * 0.75, hr * 0.5], [0, hr * 0.62]], 8, 0, 0, 0, GUNMETAL, { metalness: 0.9 });
  const out = [];
  for (let i = 0; i < blades; i++) {
    // 逐葉一個方位 Group,槳葉自身只往 +x 長 —— **MUST NOT 在同一顆網格上同時寫
    // rotation.y 與極座標 position**:那兩者的 z 號相反(rotation.y 把 +x 送到
    // (cos, 0, −sin),而 (cos, 0, +sin) 是另一個方向)⇒ 槳葉會離開槳轂浮在旁邊,
    // 而在正面視角剛好看不出來(2026-08-12 s04 實測)。
    const arm = new THREE.Group();
    arm.rotation.y = i * Math.PI * 2 / blades;
    prop.add(arm);
    const b = tboxF(arm, { w0: r * 0.94, d0: r * 0.2, w1: r * 0.94, d1: r * 0.1, h: thick, sz: -r * 0.05 },
      r * 0.5, 0, 0, color, opts);
    b.rotation.x = pitch;              // 槳距(攻角)
    out.push(b);
  }
  return { holder, prop, blades: out };
}

/**
 * 機載武器莢(旋翼/定翼/撲翼機共用)—— 莢殼(收分楔台)+ 收分砲管 + 膛口制退器 + 槍口燈。
 * 幾何一律沿局部 **+z 朝前**(rig.wpn 的 `fwd:'z'` 契約;FPV 座艙複製時方向才對得上)。
 * spec = { len, r, accent, muzR = r*0.55, brake = true }
 * 回傳 { g, muz } —— muz 是**發光網格**(lightGlowM/heavyGlowM 直接吃它的 material)。
 */
export function gunPodF(parent, spec, x, y, z, color, opts) {
  const { len, r, accent, muzR = r * 0.55, brake = true } = spec;
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  const sh = tboxF(g, { w0: r * 2.0, d0: r * 2.0, w1: r * 1.35, d1: r * 1.15, h: len * 0.52 },
    0, 0, -len * 0.18, color, opts);
  sh.rotation.x = Math.PI / 2;
  const bl = cylF(g, muzR * 0.82, muzR, len * 0.6, 8, 0, 0, len * 0.28, GUNMETAL, { metalness: 0.85 });
  bl.rotation.x = Math.PI / 2;
  if (brake) {
    const bk = cylF(g, muzR * 1.55, muzR * 1.55, r * 0.42, 8, 0, 0, len * 0.5, COAL, { metalness: 0.9 });
    bk.rotation.x = Math.PI / 2;
  }
  const muz = cylF(g, muzR * 0.9, muzR * 0.9, 0.03, 8, 0, 0, len * 0.58, accent,
    { emissive: accent, emissiveIntensity: 1.4 });
  muz.rotation.x = Math.PI / 2;
  return { g, muz };
}

/**
 * 噴射尾焰 —— 逐字鏡射 models.js jetFlame(:175)的**回傳契約** `{ g, m1, m2 }`,
 * locomotion.js stepAerial 直接吃(推力 ∝ 速度:焰長/亮度/抖動)。
 * 錐尖朝局部 −y;呼叫端轉 rotation.x = π/2 讓噴流指向機尾(−z)。
 */
export function jetF(parent, r, len, x, y, z, accent) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  const mk = (rr, ll, c, op, ei) => {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(rr, ll, 8),
      matF(c, { transparent: true, opacity: op, emissive: c, emissiveIntensity: ei }));
    cone.rotation.x = Math.PI;
    cone.position.y = -ll / 2;
    cone.userData.noOutline = true;
    g.add(cone);
    return cone;
  };
  const outer = mk(r, len, accent, 0.5, 2.2);
  const inner = mk(r * 0.5, len * 0.62, 0xfff1cf, 0.85, 2.8);
  g.visible = false;                   // 熄火起步(由 locomotion 點燃)
  return { g, m1: outer.material, m2: inner.material };
}

/**
 * 纜束(外露肌腱/管線,多零件)—— p0 → p1 之間 k 條細管微散開 + 下垂;
 * 生體感來自「每條各自成件」而不是一根粗管。零亂數:散開角 = 索引均分。
 * spec = { p0: [x,y,z], p1: [x,y,z], k, r, sag = 0.06, spread = 0.03 }
 */
export function cablesF(parent, spec, color, opts) {
  const { p0, p1, k, r, sag = 0.06, spread = 0.03 } = spec;
  const out = [];
  const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1);
  for (let i = 0; i < k; i++) {
    const th = (i / k) * Math.PI * 2;
    const off = new THREE.Vector3(Math.cos(th) * spread, 0, Math.sin(th) * spread);
    const mid = a.clone().lerp(b, 0.5).add(off).add(new THREE.Vector3(0, -sag, 0));
    const curve = new THREE.QuadraticBezierCurve3(a.clone().add(off), mid, b.clone().add(off));
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 6, r, 5), matF(color, opts));
    parent.add(m);
    out.push(m);
  }
  return out;
}
