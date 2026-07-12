// ============ 3D 單位模型(Quaternius CC0 優先,程式生成備援)============
// 設計沿用 ai_tycoon board3d.js 的 MODEL_MANIFEST 機制:
// 每種單位先嘗試載入 assets/models/quaternius/ 下的 GLB,
// 載入失敗自動退回 Three.js 程式生成的低多邊形版本,不開天窗。
// 想換模型:丟新 .glb 進資料夾、改下面 manifest 一行即可。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { SIDES, CHARACTERS } from './data.js';
import { toonMat, toonify, outlinify } from './toon.js';
import { heroPalette, paintUnit } from './paint.js';

// 單位 → GLB 檔(Quaternius,CC0 1.0;None = 直接用程式生成)
export const MODEL_MANIFEST = Object.assign({
  'hero:robot':   null,                                          // 機甲:程序生成 人形/雙足獸/四足獸(doc/image/robot+beast 賽璐璐重構;GLB 可經 MODEL_MANIFEST_EXTRA 蓋回)
  'hero:drone':   null,                                          // 無人機:程序生成 旋翼/定翼/擬態翼(doc/image/drone+fly 賽璐璐重構)
  'hero:morph':   null,                                          // 傭兵變形機甲:程式生成(雙型態)
  'creep:soldier': null,                                         // 機槍步兵:程式生成(pawn-casual GLB 徒手,無法滿足「步兵手持機槍」)
  'creep:apc':    null,                                          // 裝甲車:程式生成
  'creep:tank':   null,                                          // 坦克:程式生成
  'creep:rocketeer': null,                                        // 火箭兵:程式生成
  'creep:howitzer':  null,                                        // 榴彈兵:程式生成
  'creep:heli':      null,                                        // 攻擊直升機:程式生成
  'tower':        null,                                          // 防禦塔:程式生成(賽璐璐重繪)
  'base:SWARM':   'assets/models/quaternius/dome.glb',          // 蜂群主堡(穹頂)
  'base:STEEL':   'assets/models/quaternius/structure.glb',     // 鋼鐵主堡(工業塔)
}, (typeof window !== 'undefined' && window.MODEL_MANIFEST_EXTRA) || {});

// ---- 尺度基準(2026-07-10 改制)----
// 步兵 = 真人身高 SOLDIER_H,是全遊戲唯一的「身高單位」。人員/載具/建物一律用真實世界
// 公稱尺寸,不再有超尺度倍率(舊制步兵 3.2m,建物/植被便得靠 biomes.js OVER ×1.8 補回比例)。
export const SOLDIER_H = 1.8;

// 機體尺寸(2026-07-12 改制,相對真人身高):
//   機甲 / 變形機甲(不分型態)= 150%~250%、無人機 = 75%~150%。
// 倍率仍隨 mods.armor 在該機種護甲區間內線性內插:
// 高防禦 = 更巨大 = 剪影更大 = 更容易被命中(命中是客戶端對 mesh raycast,體型直接生效)。
const HERO_SIZE = {
  robot: { armor: [12, 26], mul: [1.5, 2.5] },
  morph: { armor: [5, 24], mul: [1.5, 2.5] },
  drone: { armor: [3, 12], mul: [0.75, 1.5] },
};
const BEAST_H_F = 0.78;   // 獸型四足:同噸位的站姿較矮(體長換來的)—— 但不得跌破機種下限
// 變形機甲的人形地面型(vis.ground):其餘值一律四足獸型
export const MORPH_HUMANOID = new Set(['biped', 'wolf', 'vampire', 'monkey', 'atlas']);

/** 英雄機體顯示高度(公尺):依角色護甲值在機種區間內插 */
export function heroTargetH(kind, ch) {
  const S = HERO_SIZE[kind];
  if (!S) return SOLDIER_H * 4;
  const c = CHARACTERS[ch];
  const armor = c?.mods?.armor;
  const t = armor == null ? 0.5 : clamp01((armor - S.armor[0]) / (S.armor[1] - S.armor[0]));
  const h = SOLDIER_H * (S.mul[0] + (S.mul[1] - S.mul[0]) * t);
  // 獸型矮化:機甲看 visual.form;變形機甲看 visual.ground(非人形即四足獸,體長換高度)。
  // 矮化後 MUST 夾回機種區間下限 —— 機甲/變形機甲不分型態都要 ≥ 150% 真人身高。
  const quad = c?.visual?.form === 'beast'
    || (c?.visual?.ground && !MORPH_HUMANOID.has(c.visual.ground));
  return quad ? Math.max(SOLDIER_H * S.mul[0], h * BEAST_H_F) : h;
}

// 非英雄單位顯示高度(公尺;fitToHeight 自動縮放)。人員/載具 = 真實世界尺寸;
// 塔/主堡是虛構工事,維持既有的地標級量體。
const TARGET_H = {
  // decoy:fitToHeight 量的是「高度」— 餌機高 ≈ 0.99 / 長 ≈ 2.2,取 1.4 得機身長約 3.1m
  decoy: 1.4,
  'creep:soldier': SOLDIER_H, 'creep:rocketeer': SOLDIER_H, 'creep:howitzer': SOLDIER_H * 1.05,
  'creep:apc': 2.7, 'creep:tank': 2.8, 'creep:heli': 3.9,
  tower: 26, 'base:SWARM': 42, 'base:STEEL': 46,
};

const loader = new GLTFLoader();
const cache = {};   // key -> { scene, animations } 或 null(載入失敗)

function loadGlb(url) {
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
}

/** 預載 manifest 內所有模型(容錯:個別失敗只是退回程式生成) */
export async function preloadModels(onProgress) {
  const keys = Object.keys(MODEL_MANIFEST).filter((k) => MODEL_MANIFEST[k]);
  let done = 0;
  await Promise.all(keys.map(async (k) => {
    try {
      const gltf = await loadGlb(MODEL_MANIFEST[k]);
      cache[k] = { scene: gltf.scene, animations: gltf.animations || [] };
    } catch (e) {
      console.warn(`模型載入失敗,改用程式生成:${k}`, e.message);
      cache[k] = null;
    }
    onProgress?.(++done / keys.length);
  }));
}

/**
 * 量測包圍盒:skinned mesh 要用 computeBoundingBox()(r151+ 會套用骨骼變換),
 * 直接 Box3.setFromObject 會量到未變形的原始幾何,縮放/定位全錯。
 */
function measureBox(obj) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  obj.traverse((o) => {
    if (o.isSkinnedMesh) {
      o.computeBoundingBox();
      tmp.copy(o.boundingBox).applyMatrix4(o.matrixWorld);
      box.union(tmp);
    } else if (o.isMesh) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      box.union(tmp);
    }
  });
  return box;
}

/** 等比縮放讓包圍盒高度 = target、底部貼地(y=0),置中 x/z */
function fitToHeight(obj, target) {
  const box = measureBox(obj);
  const size = box.getSize(new THREE.Vector3());
  const s = target / (size.y || 1);
  obj.scale.setScalar(s);
  const box2 = measureBox(obj);
  const c = box2.getCenter(new THREE.Vector3());
  obj.position.x -= c.x;
  obj.position.z -= c.z;
  obj.position.y -= box2.min.y;
  return obj;
}

/** 陣營光環(單位腳下的識別圈) */
function teamRing(side, radius) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.75, radius, 24),
    new THREE.MeshBasicMaterial({
      color: SIDES[side].color, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.25;
  return ring;
}

function mat(color, opts = {}) {
  // 賽璐璐:PBR 參數不適用 toon;高金屬度 → 漫畫硬邊高光帶(celMetal)
  const { metalness, roughness, ...rest } = opts;
  return toonMat(color, { ...rest, celMetal: (metalness ?? 0) >= 0.5 });
}

/** 描邊寬度:隨單位尺寸走,遠看近看都 ≈ 2~3px 漫畫勾線 */
const outlineW = (target) => Math.min(0.45, Math.max(0.05, target * 0.016));

// ---------- 程式生成模型積木(盒 / 圓柱,自動掛進父層) ----------
function bx(parent, w, h, d, x, y, z, color, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function cyl(parent, rt, rb, h, seg, x, y, z, color, opts) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color, opts));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
/** 同色系明暗分版(賽璐璐面板分割:大色塊裡切出深淺層次) */
const dim = (c, f) => new THREE.Color(c).multiplyScalar(f);

/**
 * 圓角量體(沿 z 長軸的橫置膠囊):w 寬(x)、h 高(y)、d 長(z)——
 * 仿生軀幹/鞘翅用「圓角矩形」取代方盒(2026-07-12 圓角化)。
 * 縮放在 mesh 局部軸(膠囊沿 y)先套、再轉橫:局部 x→世界 x、z→世界 y、y→世界 z(長軸不縮)。
 */
function rbz(parent, w, h, d, x, y, z, color, opts) {
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
function feather(parent, len, wd, x, y, z, sw, sgn, color, opts) {
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
 * 透明 → outlinify 自動跳過描邊;顯隱/長度/亮度由 locomotion 依速度驅動
 * (rig.jets 登記 { g, m1, m2 }),靜止/地面完全熄火。
 */
function jetFlame(parent, r, len, x, y, z, accent) {
  const grp = new THREE.Group();
  grp.position.set(x, y, z);
  parent.add(grp);
  const mk = (rr, ll, c, op, ei) => {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(rr, ll, 8),
      mat(c, { transparent: true, opacity: op, emissive: c, emissiveIntensity: ei }));
    cone.rotation.x = Math.PI;        // 錐尖朝 −y(噴流方向)
    cone.position.y = -ll / 2;
    grp.add(cone);
    return cone;
  };
  const outer = mk(r, len, accent, 0.5, 2.2);
  const inner = mk(r * 0.5, len * 0.62, 0xfff1cf, 0.85, 2.8);
  grp.visible = false;                // 熄火起步(由 locomotion 點燃)
  return { g: grp, m1: outer.material, m2: inner.material };
}

// ---------- 程式生成備援模型 ----------
/**
 * 武裝無人機(蜂群英雄)——角色專屬機體:
 * vis = CHARACTERS[ch].visual = { hue 主色, frame 'quad'|'hexa'|'coax'|'wing', body 'box'|'wedge'|'sphere'|'slab'|'frame' }。
 * 未指定角色(觀戰/舊路徑)退回預設四旋翼。
 */
function buildDrone(side, vis = null) {
  const g = new THREE.Group();
  const accent = new THREE.Color(vis?.hue ?? SIDES[side].color);
  // 機體色版由角色主色推導(paint.js;深色碳纖基調)—— 舊制的固定灰黑機身已廢除
  const PAL = heroPalette(vis, side, 'dark');
  const carbon = PAL.dark, carbonLt = PAL.main, shell = PAL.mid;
  // 壓坡樞軸(locomotion.js Task 1.1):所有部件直接掛 tilt 下,
  // 橫移壓坡 / 前傾 / 懸停浮沉都轉這個群組,不動根節點(定位/描邊不受影響)
  const tilt = new THREE.Group();
  tilt.position.y = 1.3;
  g.add(tilt);
  const props = [];
  // 中央疊層機架(doc/image/drone FPV 參考):上下碳板 + 立柱,電池背在頂板上
  bx(tilt, 1.5, 0.09, 1.95, 0, -0.32, 0.05, carbon, { metalness: 0.6 });   // 下碳板
  bx(tilt, 1.28, 0.07, 1.6, 0, 0.12, 0, carbon, { metalness: 0.6 });      // 上碳板
  for (const [sx, sz] of [[-0.5, -0.6], [0.5, -0.6], [-0.5, 0.6], [0.5, 0.6]])
    cyl(tilt, 0.045, 0.045, 0.44, 6, sx, -0.1, sz, 0x14171a);             // 鋁柱
  // 電子艙(角色剪影差異化:box/wedge/sphere/slab/frame)
  const bodyKind = vis?.body || 'box';
  if (bodyKind === 'wedge') {
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.72, 1.8, 4), mat(shell, { metalness: 0.6 }));
    nose.rotation.x = Math.PI / 2;
    nose.rotation.y = Math.PI / 4;
    nose.position.set(0, -0.08, 0.35);
    tilt.add(nose);
  } else if (bodyKind === 'sphere') {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 9), mat(shell, { metalness: 0.5 }));
    ball.scale.y = 0.72;
    ball.position.y = -0.08;
    tilt.add(ball);
  } else if (bodyKind === 'slab') {
    bx(tilt, 1.85, 0.34, 1.45, 0, -0.1, 0, shell, { metalness: 0.6 });
  } else if (bodyKind === 'frame') {
    // 鏤空競速架:只有側軌,看得到立柱
    for (const sx of [-1, 1]) bx(tilt, 0.1, 0.3, 1.75, sx * 0.62, -0.1, 0.02, carbonLt);
  } else {
    bx(tilt, 1.12, 0.36, 1.5, 0, -0.1, 0, shell, { metalness: 0.6 });
  }
  // 頂置電池(主色綁帶 ×2 = 遠距識別)
  bx(tilt, 0.72, 0.3, 1.3, 0, 0.32, -0.12, 0x1d2126, { metalness: 0.5 });
  for (const z of [-0.6, 0.3]) bx(tilt, 0.78, 0.32, 0.12, 0, 0.32, z, dim(accent, 0.85));
  // FPV 鏡頭(前傾 20° 主色鏡片 = 姿態錨點)+ 尾部 VTX 天線
  const cam = bx(tilt, 0.4, 0.34, 0.24, 0, 0.1, 0.85, shell);
  cam.rotation.x = -0.35;
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.3 }));
  lens.position.set(0, 0.16, 0.99);
  tilt.add(lens);
  const whip = cyl(tilt, 0.02, 0.025, 0.75, 5, 0, 0.42, -0.92, 0x14171a);
  whip.rotation.x = 0.7;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), mat(accent, { emissive: accent, emissiveIntensity: 1.2 }));
  tip.position.set(0, 0.68, -1.18);
  tilt.add(tip);
  // 機腹武器艙(武裝無人機)
  const gun = cyl(tilt, 0.08, 0.1, 1.2, 8, 0, -0.42, 0.55, 0x111418, { metalness: 0.8 });
  gun.rotation.x = Math.PI / 2;
  // 航行燈(左紅右綠):壓坡/俯仰時方位一目了然
  bx(tilt, 0.1, 0.06, 0.22, -0.78, -0.02, 0.1, 0xff5544, { emissive: 0xff3322, emissiveIntensity: 1.6 });
  bx(tilt, 0.1, 0.06, 0.22, 0.78, -0.02, 0.1, 0x55ff88, { emissive: 0x22ff66, emissiveIntensity: 1.6 });
  // 起落橇(FPV 機腹雙短橇)
  for (const sx of [-1, 1]) bx(tilt, 0.09, 0.24, 1.1, sx * 0.55, -0.48, 0, 0x1c1f22);
  // 機臂 + 外轉子馬達 + 三葉槳(quad 四軸 / hexa 六軸 / coax 同軸雙槳 / wing 固定翼混合)
  const addRotor = (x, z, big = 1) => {
    const arm = bx(tilt, Math.hypot(x, z) * 1.05 + 0.3, 0.1, 0.2, x * 0.55, -0.14, z * 0.55, carbonLt, { metalness: 0.6 });
    arm.rotation.y = Math.atan2(-z, x);   // 機臂沿徑向
    cyl(tilt, 0.13, 0.16, 0.2, 8, x, -0.04, z, 0x14171a, { metalness: 0.8 });  // 外轉子馬達鐘
    cyl(tilt, 0.14, 0.14, 0.05, 8, x, 0.09, z, dim(accent, 0.9));              // 馬達頂環(主色)
    const prop = new THREE.Group();
    prop.position.set(x, 0.17, z);
    tilt.add(prop);
    for (let i = 0; i < 3; i++) {   // 三葉槳(繞 y 自轉;賽璐璐殘影靠 game.js spinners)
      const a = i * Math.PI * 2 / 3;
      const blade = bx(prop, 0.8 * big, 0.03, 0.14, Math.cos(a) * 0.38 * big, 0, -Math.sin(a) * 0.38 * big,
        0x9aa4ad, { transparent: true, opacity: 0.8 });
      blade.rotation.y = a;
    }
    props.push(prop);
  };
  const frame = vis?.frame || 'quad';
  if (frame === 'hexa') {
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 + Math.PI / 6;
      addRotor(Math.cos(a) * 1.55, Math.sin(a) * 1.55, 0.85);
    }
  } else if (frame === 'coax') {
    // 同軸雙槳:上下反轉雙層(視覺上仍各自繞 y 轉)
    const mast = cyl(tilt, 0.1, 0.12, 0.9, 8, 0, 0.55, 0, 0x14171a);
    mast.rotation.x = 0;
    for (const y of [0.35, 0.7]) {
      const prop = new THREE.Group();
      prop.position.y = y;
      tilt.add(prop);
      for (const sx of [-1, 1]) bx(prop, 1.5, 0.05, 0.18, sx * 0.78, 0, 0, 0x9aa4ad, { transparent: true, opacity: 0.8 });
      props.push(prop);
    }
  } else if (frame === 'wing') {
    const wing = bx(tilt, 3.4, 0.08, 0.78, 0, 0.06, -0.1, carbonLt, { metalness: 0.6 });
    for (const sx of [-1, 1]) {
      bx(wing, 0.5, 0.06, 0.4, sx * 1.62, 0.02, -0.28, dim(accent, 0.85)).rotation.y = sx * -0.3;  // 翼尖識別
      addRotor(sx * 1.3, -0.5, 0.8);
    }
  } else {
    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) addRotor(sx * 1.5, sz * 1.5);
  }
  g.userData.spin = props; // 每幀旋轉
  g.userData.rig = { kind: 'aerial', tilt, tiltY0: 1.3, bob: 0.06, top: 30 };
  return g;
}

/**
 * 定翼無人機(form:'fixed')— 軍用定翼 UAV 剪影(doc/image/drone 灰色偵察機參考)。
 * vis.wing = 'twinboom' 雙尾桁|'vtail' V 尾推進|'canard' 鴨式|'delta' 三角飛翼
 *          |'zero' 零式(A6M:星型引擎牽引槳 + 橢圓低單翼 + 氣泡艙罩 + 單垂尾)。
 * 動力必須與現實原型一致:jet 機種(鴨式電戰機/三角隱形飛翼)畫尾噴口、不畫槳;
 * 其餘掛螺旋槳並進 userData.spin。升力/壓坡由 locomotion stepAerial 演出。
 */
const FIXED = {
  twinboom: { span: 3.6 },
  vtail:    { span: 3.2 },
  canard:   { span: 2.9, jet: true },
  delta:    { span: 2.7, jet: true },
  zero:     { span: 3.5 },
};
function buildFixedWing(side, vis) {
  const g = new THREE.Group();
  const accent = new THREE.Color(vis?.hue ?? SIDES[side].color);
  const W = FIXED[vis?.wing] ? vis.wing : 'twinboom';
  const span = FIXED[W].span;
  const PAL = heroPalette(vis, side, 'dark');
  const shell = PAL.main, dark = PAL.mid, lite = PAL.lite;
  const tilt = new THREE.Group();
  tilt.position.y = 1.3;
  g.add(tilt);
  const props = [];
  // 螺旋槳:holder 定槳盤朝向(+z 前 / -z 後推),槳繞局部 y 自轉 → game.js spinners 通用
  const mkProp = (z, blades, len) => {
    const holder = new THREE.Group();
    holder.position.set(0, 0.02, z);
    holder.rotation.x = Math.PI / 2;
    tilt.add(holder);
    cyl(holder, 0.07, 0.09, 0.18, 8, 0, 0, 0, 0x14171a, { metalness: 0.8 });
    const prop = new THREE.Group();
    prop.position.y = 0.12;
    holder.add(prop);
    for (let i = 0; i < blades; i++) {
      const b = bx(prop, len, 0.03, 0.11, 0, 0, 0, 0x9aa4ad, { transparent: true, opacity: 0.8 });
      b.rotation.y = i * Math.PI / blades;
    }
    props.push(prop);
  };
  // 噴射尾噴口(jet 機種取代螺旋槳:尾錐 + 主色尾焰環 + 移動時的噴射尾焰)
  const jets = [];
  const mkJet = (z, r = 0.22) => {
    const noz = cyl(tilt, r, r * 0.82, 0.5, 10, 0, 0, z, 0x1c1f22, { metalness: 0.8 });
    noz.rotation.x = Math.PI / 2;
    const ring = cyl(tilt, r * 0.72, r * 0.72, 0.08, 10, 0, 0, z - 0.26, accent, { emissive: accent, emissiveIntensity: 1.6 });
    ring.rotation.x = Math.PI / 2;
    const fl = jetFlame(tilt, r * 0.66, 1.5, 0, 0, z - 0.3, accent);
    fl.g.rotation.x = Math.PI / 2;    // 焰流局部 −y → 世界 −z(向後噴)
    jets.push(fl);
  };
  // 機身(流線莢艙)+ 背部識別艙蓋 + 下顎感測球 + 腹掛武器艙 + 通訊鞭天線
  const fus = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.9, 4, 10), mat(shell, { metalness: 0.6 }));
  fus.rotation.x = Math.PI / 2;
  fus.position.z = 0.1;
  tilt.add(fus);
  bx(tilt, 0.3, 0.1, 0.7, 0, 0.3, 0.55, accent, { emissive: accent, emissiveIntensity: 0.6 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mat(0x1c2126, { metalness: 0.6 }));
  ball.position.set(0, -0.3, 0.95);
  tilt.add(ball);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.5 }));
  lens.position.set(0, -0.35, 1.06);
  tilt.add(lens);
  const gun = cyl(tilt, 0.07, 0.09, 1.1, 8, 0, -0.34, 0.1, 0x111418, { metalness: 0.85 });
  gun.rotation.x = Math.PI / 2;
  const whip = cyl(tilt, 0.015, 0.02, 0.5, 5, 0, 0.4, -0.6, 0x14171a);
  whip.rotation.x = 0.5;
  // 翼尖航行燈(左紅右綠:壓坡時姿態一目了然)
  const wingY = 0.16;
  const tipLight = (x, z, y = wingY + 0.04) => {
    bx(tilt, 0.16, 0.05, 0.18, -x, y, z, 0xff5544, { emissive: 0xff3322, emissiveIntensity: 1.6 });
    bx(tilt, 0.16, 0.05, 0.18, x, y, z, 0x55ff88, { emissive: 0x22ff66, emissiveIntensity: 1.6 });
  };
  if (W === 'twinboom') {
    // 高直翼 + 雙尾桁 + 端板雙垂尾;機鼻牽引槳
    bx(tilt, span, 0.07, 0.55, 0, wingY, 0.15, lite, { metalness: 0.5 });
    for (const sx of [-1, 1]) {
      bx(tilt, 0.5, 0.06, 0.42, sx * (span / 2 - 0.25), wingY + 0.02, 0.12, dim(accent, 0.85));
      bx(tilt, 0.09, 0.09, 2.1, sx * 0.62, wingY, -0.95, dark, { metalness: 0.6 });   // 尾桁
      bx(tilt, 0.07, 0.62, 0.42, sx * 0.62, wingY + 0.3, -1.95, lite);                // 垂尾
      bx(tilt, 0.08, 0.14, 0.3, sx * 0.62, wingY + 0.62, -1.98, accent, { emissive: accent, emissiveIntensity: 0.8 });
    }
    bx(tilt, 1.24, 0.06, 0.4, 0, wingY + 0.5, -1.95, lite);                           // 水平尾
    mkProp(1.45, 2, 0.95);
    tipLight(span / 2 - 0.1, 0.15);
  } else if (W === 'vtail') {
    // 中直翼 + V 尾;尾推槳
    bx(tilt, span, 0.07, 0.6, 0, wingY, 0.3, lite, { metalness: 0.5 });
    bx(tilt, 0.16, 0.14, 1.3, 0, 0, -0.85, dark, { metalness: 0.6 });                 // 尾桁
    for (const sx of [-1, 1]) {
      bx(tilt, 0.5, 0.06, 0.44, sx * (span / 2 - 0.25), wingY + 0.02, 0.26, dim(accent, 0.85));
      const fin = bx(tilt, 0.6, 0.06, 0.42, sx * 0.28, 0.34, -1.1, lite);
      fin.rotation.z = sx * 0.8;                                                      // V 尾
      bx(fin, 0.18, 0.08, 0.44, sx * 0.24, 0.02, 0, accent, { emissive: accent, emissiveIntensity: 0.8 });
    }
    mkProp(-1.5, 2, 0.85);
    tipLight(span / 2 - 0.1, 0.3);
  } else if (W === 'canard') {
    // 鴨式:機鼻前翼 + 後置後掠主翼 + 單垂尾;電戰機噴射動力(無槳)
    for (const sx of [-1, 1]) {
      const mw = bx(tilt, span / 2, 0.07, 0.6, sx * span / 4, wingY, -0.45, lite, { metalness: 0.5 });
      mw.rotation.y = sx * 0.35;                                                      // 後掠
      bx(mw, 0.45, 0.06, 0.46, sx * (span / 4 - 0.2), 0.02, 0, dim(accent, 0.85));
      bx(tilt, 0.3, 0.26, 0.5, sx * 0.42, -0.16, -0.5, dark, { metalness: 0.7 });     // 側進氣口
    }
    bx(tilt, 1.15, 0.05, 0.3, 0, 0.05, 1.05, lite);                                   // 前翼
    bx(tilt, 0.07, 0.6, 0.5, 0, 0.42, -1.0, lite);                                    // 垂尾
    bx(tilt, 0.08, 0.16, 0.34, 0, 0.72, -1.05, accent, { emissive: accent, emissiveIntensity: 0.8 });
    mkJet(-1.35);
    tipLight(span / 2 * 0.94, -0.9, wingY + 0.06);
  } else if (W === 'zero') {
    // 零式(A6M):星型引擎整流罩 + 三葉牽引槳 + 橢圓低單翼 + 氣泡艙罩 + 單垂尾/水平尾
    const cowl = cyl(tilt, 0.42, 0.36, 0.55, 12, 0, -0.02, 1.2, dark, { metalness: 0.75 });
    cowl.rotation.x = Math.PI / 2;
    cyl(cowl, 0.3, 0.3, 0.6, 12, 0, 0, 0, 0x14171a);                                  // 進氣環內壁
    for (const sx of [-1, 1]) {
      // 橢圓低單翼:內翼厚弦 + 外翼收分上反(翼端主色識別帶)
      const inner = bx(tilt, span * 0.3, 0.09, 0.95, sx * span * 0.16, -0.16, 0.1, lite, { metalness: 0.5 });
      const outer = bx(tilt, span * 0.22, 0.07, 0.62, sx * span * 0.4, -0.1, 0.02, lite, { metalness: 0.5 });
      outer.rotation.z = sx * -0.12;                                                   // 上反角
      outer.rotation.y = sx * 0.12;                                                    // 前緣微後掠(橢圓翼收分)
      bx(outer, span * 0.1, 0.06, 0.5, sx * span * 0.08, 0.02, -0.02, dim(accent, 0.85));
      // 翼內 20mm 機砲(零式的九九式二號:砲管突出前緣)
      const c = cyl(tilt, 0.045, 0.05, 0.7, 6, sx * span * 0.24, -0.14, 0.55, 0x111418, { metalness: 0.85 });
      c.rotation.x = Math.PI / 2;
      bx(inner, 0.3, 0.1, 0.36, sx * span * 0.06, -0.14, -0.1, 0x23262a);             // 主輪整流罩
    }
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), mat(accent, { transparent: true, opacity: 0.55, emissive: accent, emissiveIntensity: 0.5 }));
    canopy.scale.set(0.8, 0.7, 1.9);
    canopy.position.set(0, 0.28, 0.15);
    tilt.add(canopy);
    bx(tilt, 0.07, 0.68, 0.7, 0, 0.42, -1.35, lite);                                  // 垂尾
    bx(tilt, 0.1, 0.2, 0.34, 0, 0.78, -1.4, accent, { emissive: accent, emissiveIntensity: 0.9 });
    bx(tilt, 1.5, 0.05, 0.45, 0, 0.06, -1.4, lite, { metalness: 0.5 });               // 水平尾
    bx(tilt, 0.12, 0.16, 0.24, 0, -0.1, -1.55, 0x23262a);                             // 尾輪
    mkProp(1.55, 3, 1.2);
    tipLight(span * 0.48, 0.02, -0.06);
  } else {
    // 三角飛翼:大後掠翼 + 翼端垂直小翼;隱形偵察機噴射動力(無槳,背部進氣)
    for (const sx of [-1, 1]) {
      const w1 = bx(tilt, span / 2, 0.07, 1.5, sx * span / 4, wingY, -0.3, lite, { metalness: 0.5 });
      w1.rotation.y = sx * 0.5;                                                       // 後掠
      bx(w1, span / 4, 0.06, 0.62, sx * span / 8, 0.02, -0.3, dim(accent, 0.85));
      bx(w1, 0.06, 0.42, 0.5, sx * (span / 2 - 0.06), 0.2, -0.45, dark);              // 端板小翼
    }
    bx(tilt, 0.5, 0.16, 0.6, 0, 0.3, -0.35, dark, { metalness: 0.7 });                // 背部進氣口
    mkJet(-1.25, 0.2);
    tipLight(span / 2 * 0.85, -1.0, wingY + 0.3);
  }
  g.userData.spin = props;
  g.userData.rig = { kind: 'aerial', tilt, tiltY0: 1.3, bob: 0.05, top: 30,
    level: 1,                            // 定翼機:巡航機身水平,不隨前速前傾(旋翼機才傾轉)
    jets: jets.length ? jets : null };   // 噴射尾焰(canard/delta):速度驅動長度/亮度
  return g;
}

/**
 * 擬態翼無人機(form:'avian')— 生物擬態剪影 + 拍翼樞軸(doc/image/fly
 * 機械鳥/機械龍參考;mobility_plan Task 2.2 延伸)。仍是無人機(感測眼/
 * 航行燈/機械關節),攻擊機構隨生物形態多樣化:
 * creature: 'bee' 蜜蜂(雙對蟲翼,尾部螫針 = 砲管)
 *         | 'eagle' 機械鷹(羽刃翼 + 翼下羽毛飛彈掛架,頦下雙管)
 *         | 'ptero' 翼龍(膜翼,吊掛雙爪各抓一具槍莢)
 *         | 'dragon' 機械龍(膜翼,張口露出口腔飛彈巢)。
 * locomotion stepAerial 依速度驅動拍翼頻率/振幅,外翼相位延遲(follow-through)。
 */
const AVIAN = {
  bee:    { span: 2.6, pairs: 2, body: 1.15 },
  eagle:  { span: 2.6, pairs: 1, body: 1.0 },
  ptero:  { span: 2.9, pairs: 1, body: 0.9 },
  dragon: { span: 4.8, pairs: 1, body: 1.05 },   // 巨翼:翼展遠大於體長 = 飛龍剪影
};
function buildAvianDrone(side, vis) {
  const g = new THREE.Group();
  const accent = new THREE.Color(vis?.hue ?? SIDES[side].color);
  const C = AVIAN[vis?.creature] ? vis.creature : 'eagle';
  const P = AVIAN[C];
  const PAL = heroPalette(vis, side, 'dark');
  const dark = PAL.mid, mid = PAL.main, plate = PAL.lite;
  // 壓坡/拍翼都掛 tilt 樞軸下(同 buildDrone 慣例:根節點只管定位/描邊)
  const tilt = new THREE.Group();
  tilt.position.y = 1.3;
  g.add(tilt);
  const bs = P.body;
  const wings = [];
  // 胸腹(流線機身)+ 背脊裝甲 + 航行燈(左紅右綠)
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.6 * bs, 12, 9), mat(dark, { metalness: 0.6 }));
  body.scale.set(1, 0.8, 1.6);
  tilt.add(body);
  bx(tilt, 0.46 * bs, 0.12, 1.1 * bs, 0, 0.4 * bs, -0.1, plate);
  bx(tilt, 0.08, 0.05, 0.2, -0.5 * bs, 0.08, 0.35, 0xff5544, { emissive: 0xff3322, emissiveIntensity: 1.6 });
  bx(tilt, 0.08, 0.05, 0.2, 0.5 * bs, 0.08, 0.35, 0x55ff88, { emissive: 0x22ff66, emissiveIntensity: 1.6 });
  // ---- 翼:內翼 w + 外翼 outer 樞軸(拍翼由 locomotion stepAerial 驅動)----
  const membrane = { transparent: true, opacity: 0.5, emissive: accent, emissiveIntensity: 0.3 };
  const mkWing = (sgn, z0, pair = 0) => {
    const w = new THREE.Group();
    w.position.set(sgn * 0.42 * bs, 0.22 * bs, z0);
    tilt.add(w);
    const outer = new THREE.Group();
    outer.position.set(sgn * P.span * 0.52, 0, 0);
    w.add(outer);
    if (C === 'bee') {
      // 昆蟲膜翅:整片橢圓翅面(不是分節的長方形),前翅大、後翅小(pair 1);
      // 前緣翅脈加粗 = 翅膀的骨架,高透明翅面 = 高頻震翅的殘影
      const chord = (pair ? 0.36 : 0.5) * bs, wl = P.span * (pair ? 0.62 : 0.85);   // 細長橢圓(長 ≈ 弦 ×4)
      const film = { transparent: true, opacity: 0.55, emissive: 0x9adfff, emissiveIntensity: 0.4 };
      const el = cyl(w, 0.5, 0.5, 0.02, 22, sgn * wl * 0.5, 0, 0, 0x9adfff, film);   // 圓盤 → 縮放成橢圓翅
      el.scale.set(wl, 1, chord);
      const vein = cyl(w, 0.03, 0.045, wl, 6, sgn * wl * 0.5, 0.02, chord * 0.34, 0xd8e8f2, { metalness: 0.4 });
      vein.rotation.z = Math.PI / 2;                                                  // 前緣翅脈(沿翼展)
    } else if (C === 'eagle') {
      // 機械鷹羽翼(2026-07-12 羽化):佈羽參照悟空光翼的放射扇 —— 覆羽扇聚在翼根、
      // 初級飛羽扇聚在腕點,羽尖向外後方張開、掠角逐片遞增;每片是羽毛形圓角羽片
      bx(w, P.span * 0.42, 0.07, 0.28 * bs, sgn * P.span * 0.21, 0.02, 0.02, plate, { metalness: 0.4 });  // 翼骨前緣
      for (let i = 0; i < 4; i++)   // 覆羽扇(翼根:短羽、掠角小 → 大)
        feather(w, P.span * (0.34 - i * 0.03), 0.2 * bs, sgn * 0.06, -0.02 - i * 0.015, -0.05 - i * 0.05,
          0.3 + i * 0.24, sgn, i === 1 ? dim(accent, 0.8) : dim(plate, 0.9), { metalness: 0.35 });
      for (let i = 0; i < 3; i++) {   // 翼下羽毛飛彈掛架(羽片即彈體,彈尖主色)照舊
        const fm = new THREE.Group();
        fm.position.set(sgn * P.span * (0.14 + i * 0.12), -0.12, -0.05 - i * 0.06);
        w.add(fm);
        bx(fm, 0.07, 0.06, 0.62, 0, 0, 0, 0x23262a, { metalness: 0.6 });
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.2, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.2 }));
        tip.rotation.x = Math.PI / 2;
        tip.position.z = 0.4;
        fm.add(tip);
      }
      for (let i = 0; i < 5; i++)   // 初級飛羽扇(腕點:長羽、掠角大 = 翼尖指狀分岔)
        feather(outer, P.span * (0.46 - i * 0.04), 0.16 * bs, 0, i * 0.015, -0.04 - i * 0.03,
          0.2 + i * 0.24, sgn, i === 1 ? accent : 0x2a2e33, { metalness: 0.3 });
    } else {
      // 膜翼(ptero/dragon):骨梁 + 半透明翼膜(透明材質:outlinify 自動跳過)+ 翼指尖爪
      const chord = C === 'dragon' ? 2.0 : 0.95;    // 飛龍:寬弦巨翼
      bx(w, P.span * 0.52, 0.09, 0.13, sgn * P.span * 0.26, 0.02, 0.16, dark, { metalness: 0.6 });
      bx(w, P.span * 0.5, 0.03, chord * bs, sgn * P.span * 0.26, -0.02, -chord * 0.34 * bs, accent, membrane);
      bx(outer, P.span * 0.44, 0.08, 0.11, sgn * P.span * 0.22, 0.02, 0.14, dark, { metalness: 0.6 });
      const mem2 = bx(outer, P.span * 0.42, 0.03, chord * 0.74 * bs, sgn * P.span * 0.21, -0.02, -chord * 0.21 * bs, accent, membrane);
      mem2.rotation.y = sgn * -0.1;
      if (C === 'dragon') {   // 翼指骨梁(撐開寬弦翼膜的三根指骨)
        for (let i = 0; i < 3; i++) {
          const rib = bx(outer, P.span * 0.4, 0.05, 0.07, sgn * P.span * 0.2, 0, -0.2 - i * 0.45 * bs, dark, { metalness: 0.6 });
          rib.rotation.y = sgn * (0.18 + i * 0.16);
        }
      }
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.4, 5), mat(0xd8dde2, { metalness: 0.7 }));
      spike.position.set(sgn * P.span * 0.45, 0, 0.14);
      spike.rotation.z = sgn * -Math.PI / 2;
      outer.add(spike);
    }
    wings.push({ w, outer, sgn, pair });
  };
  for (const sgn of [-1, 1]) {
    mkWing(sgn, 0.2 * bs);
    if (P.pairs > 1) mkWing(sgn, -0.35 * bs, 1);
  }
  // ---- 生物形態(頭/尾/武裝)----
  let tailSegs = null;   // 僅重尾機種(機械龍)登記,供 stepAerial 甩尾配重驅動
  if (C === 'bee') {
    // 頭:大複眼 ×2 + 觸角;節腹琥珀環紋;螫針 = 砲管(尾部後向武器)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.36 * bs, 10, 8), mat(mid, { metalness: 0.5 }));
    head.position.set(0, 0.14 * bs, 0.95 * bs);
    tilt.add(head);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.17 * bs, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.2 }));
      eye.scale.set(0.7, 1, 0.8);
      eye.position.set(sx * 0.24 * bs, 0.2 * bs, 1.06 * bs);
      tilt.add(eye);
      const ant = cyl(tilt, 0.015, 0.02, 0.5, 5, sx * 0.12 * bs, 0.42 * bs, 1.15 * bs, 0x14171a);
      ant.rotation.x = -0.8;
      ant.rotation.z = sx * 0.3;
    }
    const abd = new THREE.Mesh(new THREE.SphereGeometry(0.52 * bs, 12, 9), mat(dark, { metalness: 0.5 }));
    abd.scale.set(1, 0.9, 1.5);
    abd.position.set(0, -0.05, -1.0 * bs);
    tilt.add(abd);
    for (let i = 0; i < 2; i++) {
      const ring = cyl(tilt, 0.44 * bs - i * 0.1, 0.44 * bs - i * 0.1, 0.1, 12, 0, -0.05, -(1.0 + i * 0.38) * bs, accent, { emissive: accent, emissiveIntensity: 0.7 });
      ring.rotation.x = Math.PI / 2;
    }
    const sting = new THREE.Mesh(new THREE.ConeGeometry(0.16 * bs, 0.6 * bs, 8), mat(0x1c1f23, { metalness: 0.8 }));
    sting.rotation.x = -Math.PI / 2;   // 錐尖朝後
    sting.position.set(0, -0.08, -1.75 * bs);
    tilt.add(sting);
    const barrel = cyl(tilt, 0.05, 0.05, 0.5, 6, 0, -0.08, -2.0 * bs, 0x111418, { metalness: 0.85 });
    barrel.rotation.x = Math.PI / 2;
    const muz = cyl(tilt, 0.07, 0.07, 0.06, 6, 0, -0.08, -2.24 * bs, accent, { emissive: accent, emissiveIntensity: 1.3 });
    muz.rotation.x = Math.PI / 2;
  } else if (C === 'eagle') {
    // 鉤喙猛禽頭 + 頦下雙管 + 折收雙爪 + 扇尾
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3 * bs, 10, 8), mat(plate, { metalness: 0.5 }));
    head.position.set(0, 0.3 * bs, 1.0 * bs);
    tilt.add(head);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.13 * bs, 0.45 * bs, 6), mat(0xd8b23c, { metalness: 0.6 }));
    beak.rotation.x = Math.PI / 2 + 0.25;   // 鉤喙微下勾
    beak.position.set(0, 0.24 * bs, 1.3 * bs);
    tilt.add(beak);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08 * bs, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.5 }));
      eye.position.set(sx * 0.17 * bs, 0.38 * bs, 1.12 * bs);
      tilt.add(eye);
      const b = cyl(tilt, 0.045, 0.055, 0.7, 6, sx * 0.09 * bs, -0.3 * bs, 0.85 * bs, 0x111418, { metalness: 0.85 });
      b.rotation.x = Math.PI / 2;
      // 強力雙爪:羽腿(粗大腿)+ 鱗甲蹠骨 + 三趾前爪 + 後趾(hallux),爪尖內勾成鉗
      const thigh = cyl(tilt, 0.13 * bs, 0.16 * bs, 0.4, 8, sx * 0.24 * bs, -0.34 * bs, 0.28, plate, { metalness: 0.4 });
      thigh.rotation.x = 0.45;
      const foot = new THREE.Group();
      foot.position.set(sx * 0.26 * bs, -0.6 * bs, 0.4);
      tilt.add(foot);
      cyl(foot, 0.07 * bs, 0.1 * bs, 0.34, 6, 0, 0.12, -0.04, 0x30373f, { metalness: 0.7 });   // 蹠骨(鱗甲)
      const talon = (tx, tz, ry) => {
        const t = new THREE.Group();
        t.position.set(tx, -0.06, tz);
        t.rotation.y = ry;
        foot.add(t);
        bx(t, 0.07 * bs, 0.07 * bs, 0.3, 0, 0, 0.14, 0x3a424a, { metalness: 0.7 });            // 趾節
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.05 * bs, 0.34, 6), mat(0xe8ecef, { metalness: 0.8 }));
        claw.position.set(0, -0.11, 0.32);
        claw.rotation.x = 2.3;                                                                  // 爪尖內勾(抓握)
        t.add(claw);
      };
      talon(0, 0.06, 0);
      talon(sx * 0.12 * bs, 0.02, sx * 0.6);
      talon(sx * -0.1 * bs, 0.02, sx * -0.5);
      talon(0, -0.14, Math.PI);                                                                 // 後趾:反向合鉗
    }
    for (let i = -1; i <= 1; i++) {
      const f = bx(tilt, 0.2 * bs, 0.05, 0.95 * bs, i * 0.2 * bs, 0, -1.25 * bs, i === 0 ? accent : mid);
      f.rotation.y = i * 0.26;
    }
  } else if (C === 'ptero') {
    // 後掠頭冠 + 長喙;吊掛雙爪各抓一具槍莢(爪握槍砲)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34 * bs, 0.3 * bs, 0.6 * bs), mat(plate, { metalness: 0.5 }));
    head.position.set(0, 0.34 * bs, 1.05 * bs);
    tilt.add(head);
    const crest = new THREE.Mesh(new THREE.ConeGeometry(0.12 * bs, 0.85 * bs, 5), mat(accent, { emissive: accent, emissiveIntensity: 0.5 }));
    crest.rotation.x = -Math.PI / 2 - 0.35;   // 朝後上
    crest.position.set(0, 0.55 * bs, 0.72 * bs);
    tilt.add(crest);
    // 長喙(翼龍剪影主軸:上下顎皆細長,喙長 ≈ 顱長 ×3,尖端收成針)
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.11 * bs, 2.0 * bs, 6), mat(0x14171a, { metalness: 0.8 }));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.3 * bs, 2.3 * bs);
    tilt.add(beak);
    const jaw = new THREE.Mesh(new THREE.ConeGeometry(0.07 * bs, 1.8 * bs, 5), mat(0x23262a, { metalness: 0.7 }));
    jaw.rotation.x = Math.PI / 2 - 0.06;   // 下顎微張
    jaw.position.set(0, 0.16 * bs, 2.2 * bs);
    tilt.add(jaw);
    const nib = new THREE.Mesh(new THREE.ConeGeometry(0.035 * bs, 0.5 * bs, 5), mat(accent, { emissive: accent, emissiveIntensity: 1.1 }));
    nib.rotation.x = Math.PI / 2;
    nib.position.set(0, 0.3 * bs, 3.5 * bs);   // 針狀喙尖(主色 = 遠距識別)
    tilt.add(nib);
    bx(tilt, 0.3 * bs, 0.07, 0.06, 0, 0.42 * bs, 1.32 * bs, accent, { emissive: accent, emissiveIntensity: 1.5 });
    for (const sx of [-1, 1]) {
      const leg = cyl(tilt, 0.06, 0.07, 0.55, 6, sx * 0.28 * bs, -0.42 * bs, -0.15, 0x2a2e33, { metalness: 0.6 });
      leg.rotation.x = 0.25;
      const pod = cyl(tilt, 0.09, 0.1, 1.1, 8, sx * 0.28 * bs, -0.72 * bs, 0.1, 0x111418, { metalness: 0.85 });
      pod.rotation.x = Math.PI / 2;
      const muz = cyl(tilt, 0.11, 0.11, 0.06, 8, sx * 0.28 * bs, -0.72 * bs, 0.68, accent, { emissive: accent, emissiveIntensity: 1.2 });
      muz.rotation.x = Math.PI / 2;
      for (const a of [-1, 0, 1]) {   // 三指握爪扣住槍莢
        const claw = bx(tilt, 0.05, 0.3, 0.07, sx * 0.28 * bs + a * 0.11, -0.58 * bs, 0.1, 0x30373f);
        claw.rotation.z = a * 0.55;
      }
    }
    bx(tilt, 0.12 * bs, 0.08, 0.9 * bs, 0, 0.02, -1.15 * bs, mid);   // 短尾桁
    const dart = new THREE.Mesh(new THREE.ConeGeometry(0.1 * bs, 0.3 * bs, 4), mat(accent));
    dart.rotation.x = -Math.PI / 2;
    dart.position.set(0, 0.02, -1.68 * bs);
    tilt.add(dart);
  } else {
    // 機械龍:長頸雙角;張口 = 上顎/下顎間露出口腔飛彈巢(口射飛彈)
    const neck = bx(tilt, 0.28 * bs, 0.6 * bs, 0.34 * bs, 0, 0.42 * bs, 0.85 * bs, dark);
    neck.rotation.x = 0.5;
    const head = new THREE.Group();
    head.position.set(0, 0.72 * bs, 1.15 * bs);
    tilt.add(head);
    bx(head, 0.42 * bs, 0.3 * bs, 0.5 * bs, 0, 0.1 * bs, 0.1, plate, { metalness: 0.6 });   // 顱殼
    bx(head, 0.3 * bs, 0.16 * bs, 0.55 * bs, 0, 0.06 * bs, 0.55 * bs, mid);                 // 上顎
    const jaw = bx(head, 0.26 * bs, 0.09 * bs, 0.5 * bs, 0, -0.2 * bs, 0.42 * bs, dark);
    jaw.rotation.x = 0.5;                                                                    // 下顎張開
    bx(head, 0.32 * bs, 0.08, 0.06, 0, 0.22 * bs, 0.34 * bs, accent, { emissive: accent, emissiveIntensity: 1.6 });  // 眼列
    for (const sx of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06 * bs, 0.5 * bs, 5), mat(0xd8dde2, { metalness: 0.7 }));
      horn.position.set(sx * 0.15 * bs, 0.28 * bs, -0.1);
      horn.rotation.x = -2.3;
      head.add(horn);
    }
    // 口腔飛彈巢:2×2 管口(彈尖主色發光)+ 喉部充能光
    for (const [ox, oy] of [[-0.07, 0.02], [0.07, 0.02], [-0.07, -0.08], [0.07, -0.08]]) {
      const cell = cyl(head, 0.045 * bs, 0.045 * bs, 0.3, 6, ox * bs, oy * bs, 0.5 * bs, 0x111418, { metalness: 0.8 });
      cell.rotation.x = Math.PI / 2;
      const tip = cyl(head, 0.03 * bs, 0.03 * bs, 0.05, 6, ox * bs, oy * bs, 0.66 * bs, accent, { emissive: accent, emissiveIntensity: 1.6 });
      tip.rotation.x = Math.PI / 2;
    }
    bx(head, 0.18 * bs, 0.1 * bs, 0.12, 0, -0.08 * bs, 0.18 * bs, accent, { emissive: accent, emissiveIntensity: 1.0 });
    for (let i = 0; i < 3; i++) {   // 背棘列
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.07 * bs, 0.26 * bs, 4), mat(0xd8dde2, { metalness: 0.6 }));
      sp.position.set(0, 0.5 * bs, 0.15 - i * 0.45 * bs);
      tilt.add(sp);
    }
    // 長重尾(飛龍配重舵面):四節逐節掛接成鏈(root→tip,各節局部 z span 為 [0,-len]),
    // 節與節之間留 0.05 重疊(沿用原視覺比例),whipTail(stepAerial)依轉向角速度甩動配重 ——
    // MUST NOT 退回裸 Mesh 直掛 tilt(那樣就沒有樞軸可供逐節驅動)
    const tSegLen = [1.3, 1.2, 1.1, 0.9], tSegWH = [[0.58, 0.52], [0.45, 0.4], [0.32, 0.28], [0.2, 0.18]];
    tailSegs = [];
    let tNode = tilt;
    for (let i = 0; i < tSegLen.length; i++) {
      const len = tSegLen[i] * bs, [w, h] = tSegWH[i];
      const seg = new THREE.Group();
      seg.position.set(0, 0.02 * i, i === 0 ? -0.7 * bs : -tSegLen[i - 1] * bs + 0.05 * bs);
      tNode.add(seg);
      tailSegs.push(seg);
      bx(seg, w * bs, h * bs, len, 0, 0, -len / 2, i % 2 ? 0x23262a : dark);
      tNode = seg;
    }
    for (const fz of [-0.1, -1.0]) {   // 尾鰭(舵面,掛在第三節,隨尾梢一起甩,不再是與尾巴脫節的靜態掛件)
      const fin = bx(tailSegs[2], 0.06, 0.5 * bs, 0.6 * bs, 0, 0.3 * bs, fz * bs, dark, { metalness: 0.6 });
      fin.rotation.x = -0.25;
    }
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12 * bs, 0.7 * bs, 5), mat(accent, { emissive: accent, emissiveIntensity: 0.8 }));
    spike.rotation.x = -Math.PI / 2;
    spike.position.set(0, 0.08 * bs, -1.2 * bs);
    tailSegs[3].add(spike);
  }
  // insect:昆蟲高頻震翅(前後掃掠 + 翼面翻轉),與鳥類上下揮翅是兩套動力學(locomotion stepAerial)
  g.userData.rig = { kind: 'aerial', tilt, tiltY0: 1.3, bob: 0.1, top: 30, wings, insect: C === 'bee', tailSegs };
  return g;
}

/**
 * 四足獸型機甲(form:'beast'):四足步態骨架(mobility_plan Task 2.2)。
 * rig 樞軸:四髖(legFL/FR/HL/HR)+ 脊椎(spine→chest→neck 波傳導)+ 雙節尾(配重)。
 * 武裝內建於生物構造(doc/image/beast Zoids 式參考):
 * creature: 'hound' 機械獵犬(背揹長管反器材砲)
 *         | 'centaur' 人馬(四足底盤 + 人形上身雙手持長槍)
 *         | 'stego' 劍龍(背鰭 = 四聯裝飛彈鰭,尾錘尖刺)
 *         | 'cthulhu' 克蘇魯(四觸手步行 + 四觸手持武,複眼群+面鬚)。
 */
// gait = locomotion stepQuad 的步態類型:犬/馬對角小跑(高速趨 gallop)、
// 劍龍側步序列慢步(rollSway 體側搖擺、pitchAmp 壓低 = 重型獸不彈跳)、
// 章魚觸手輪行進波(legAmp 收斂肩擺,推進主力在觸手節的波)
// stride 一律取大(奔跑步距;步頻 = 速度/步距,距離拉大 = 步頻降 = 從容的大步奔馳,
// 不是高頻碎步);top 壓低 = 實戰速度就跑滿奔跑振幅(以奔跑姿態為主,走路只是起步過渡)
// gallopType:trot 高速換的襲步落腳序 —— 'rotary' 迴旋襲步(犬/豹:LH→RH→RF→LF,
// 拱背-伸展兩段騰空)/ 'transverse' 橫向襲步(馬/人馬:LH→RH→LF→RF,
// 擺程平緩、能扛住上身的射擊平台);walk = Speedwalk(大象/劍龍:加速不換步態,
// 永遠三腳著地,速度感全在步幅與體側搖擺)
const BEAST = {
  hound:   { bulk: 0.95, hipY: 2.0, tailLen: 1.5, stride: 2.6, legX: 0.78, fz: 1.05, hz: -1.25,
             gait: 'trot', gallopType: 'rotary', bob: 0.1, top: 7 },
  centaur: { bulk: 1.0,  hipY: 2.2, tailLen: 1.0, stride: 2.8, legX: 0.6,  fz: 1.0,  hz: -1.2,
             gait: 'trot', gallopType: 'transverse', bob: 0.09, top: 7 },
  stego:   { bulk: 1.45, hipY: 1.9, tailLen: 1.7, stride: 2.3, legX: 0.95, fz: 1.2,  hz: -1.6,
             gait: 'walk', bob: 0.05, rollSway: 0.11, pitchAmp: 0.03, top: 8 },
  cthulhu: { bulk: 1.15, hipY: 2.1, tailLen: 1.4, stride: 1.7, legX: 0.8,  fz: 0.8,  hz: -1.1,
             gait: 'crawl', bob: 0.05, legAmp: 0.8, pitchAmp: 0.04, top: 7, soft: 1 },
};
function buildBeastMech(side, vis) {
  const g = new THREE.Group();
  const accent = new THREE.Color(vis?.hue ?? SIDES[side].color);
  const C = BEAST[vis?.creature] ? vis.creature : 'hound';
  const P = BEAST[C];
  const B = P.bulk, hipY = P.hipY;
  const PAL = heroPalette(vis, side, 'dark');
  const hull = PAL.main, hullDk = PAL.mid, plate = PAL.lite;
  // 脊椎樞軸(浮沉/入彎傾斜/波傳導的根)→ 胸 → 頸 → 頭;尾雙節
  const spine = new THREE.Group();
  spine.position.y = hipY;
  g.add(spine);
  const chest = new THREE.Group();
  chest.position.set(0, 0.1, 0.55);
  spine.add(chest);
  const neck = new THREE.Group();
  const head = new THREE.Group();
  const tail = new THREE.Group();
  spine.add(tail);
  const tail2 = new THREE.Group();
  tail2.position.set(0, 0, -P.tailLen);
  tail.add(tail2);

  // 四腿(腿掛根節點:脊椎浮沉不帶動腳底 → 不滑步);腿型隨生物構造,
  // 一律分節(髖 → 膝 → 踝/蹄):前肢肘朝後折、後肢跗關節朝前折(S = ∓1)= 真獸的 Z 形腿;
  // 觸手腿則是五節多關節,以逐節相位延遲跑一道行進波(locomotion flexChain / undulate)
  const legChains = [], tents = [];
  const mkLeg = (sx, sz, front) => {
    const chain = [];
    legChains.push(chain);
    const S = front ? 1 : -1;
    const pos = [sx * P.legX * B, hipY, sz];
    let leg;
    if (C === 'cthulhu') {
      // 多關節觸手腿(與持武觸手同構:章魚 / 八爪博士式機械臂)——
      // 五節逐段收分,先外弓再內捲下探,節間關節環主色發光;末端三爪吸盤扣地
      const segs = [0.34, 0.3, 0.27, 0.24, 0.2];   // 節長(× hipY)
      leg = new THREE.Group();
      leg.position.set(pos[0], pos[1], pos[2]);
      g.add(leg);
      let node = leg, prev = 0;
      for (let i = 0; i < segs.length; i++) {
        const j = new THREE.Group();
        j.position.set(0, -prev, 0);
        node.add(j);
        // 外弓 → 內捲(觸手的多關節曲線,不是直柱);前腳向前撇、後腳向後撇
        j.rotation.z = sx * (i === 0 ? 0.55 : -0.3);
        j.rotation.x = (front ? 0.16 : -0.16) * (i === 0 ? 1 : -0.6);
        chain.push({ g: j, base: j.rotation.x, k: 0.16 * S, d: i * 0.55 });   // 行進波(節節延遲)
        const len = hipY * segs[i];
        const rt = (0.3 - i * 0.045) * B, rb = (0.34 - i * 0.045) * B;
        cyl(j, rt, rb, len, 8, 0, -len / 2, 0, i % 2 ? hullDk : hull, { metalness: 0.5 });
        cyl(j, rb * 1.1, rb * 1.1, 0.09, 8, 0, -0.03, 0, accent, { emissive: accent, emissiveIntensity: 0.6 });  // 關節環
        for (let k = 0; k < 3; k++)   // 腹面吸盤列
          cyl(j, rt * 0.3, rt * 0.3, 0.05, 6, 0, -len * (0.25 + k * 0.25), rb * 0.85, 0x23262a).rotation.x = Math.PI / 2;
        node = j;
        prev = len;
      }
      for (let i = 0; i < 3; i++) {   // 觸手末端三爪(扣地)
        const a = i * Math.PI * 2 / 3;
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.05 * B, 0.3, 5), mat(0xd8dde2, { metalness: 0.7 }));
        claw.position.set(Math.cos(a) * 0.12 * B, -prev - 0.06, Math.sin(a) * 0.12 * B);
        claw.rotation.x = Math.PI;   // 錐尖朝下
        claw.rotation.z = Math.cos(a) * 0.4;
        node.add(claw);
      }
      chain.shift();   // 第一節是肩基座(由 stepQuad 直接擺動),不進屈曲鏈
    } else if (C === 'stego') {
      // 象柱腿:粗壯直柱 + 蹠墊 + 足環(承重腿:關節幾乎不折,只在擺動時微屈)
      leg = segLimb(g, pos, [
        { len: hipY * 0.45, draw: (l) => {
          bx(l, 0.46 * B, 0.5, 0.6, 0, -0.15, 0, plate);
          cyl(l, 0.24 * B, 0.26 * B, hipY * 0.5, 8, 0, -hipY * 0.24, 0, hull);
        } },
        { len: hipY * 0.28, base: S * 0.12, k: S * 0.3, d: 0.16, draw: (l) => {
          cyl(l, 0.2 * B, 0.24 * B, hipY * 0.32, 8, 0, -hipY * 0.15, 0, hull);
        } },
        { len: hipY * 0.12, base: -S * 0.1, k: -S * 0.24, d: 0.45, draw: (l) => {
          cyl(l, 0.24 * B, 0.28 * B, hipY * 0.14, 8, 0, -hipY * 0.07, 0, hullDk);  // 蹠節(踝)
        } },
        { len: 0, base: 0, k: S * 0.16, d: 0.66, draw: (l) => {
          cyl(l, 0.3 * B, 0.32 * B, 0.25, 8, 0, -0.1, 0, 0x23262a);              // 足環(蹄墊)
        } },
      ], chain);
    } else if (C === 'centaur') {
      // 馬腿:修長股 → 管骨 → 球節(繫部)→ 蹄。奔馳時管骨大幅回折,
      // 球節是馬腿的彈簧關節(落地反折吸震、蹬離回彈)—— 少了它,蹄就是焊在管骨上的木塊
      leg = segLimb(g, pos, [
        { len: hipY * 0.45, draw: (l) => {
          bx(l, 0.36 * B, 0.5, 0.55, 0, -0.12, 0, plate);
          cyl(l, 0.12 * B, 0.14 * B, hipY * 0.5, 8, 0, -hipY * 0.24, front ? 0.04 : -0.06, hull);   // 圓柱股
        } },
        { len: hipY * 0.3, base: S * 0.34, k: S * 0.5, d: 0.15, draw: (l) => {
          cyl(l, 0.07 * B, 0.09 * B, hipY * 0.38, 8, 0, -hipY * 0.18, front ? -0.04 : 0.08, hullDk); // 圓柱管骨
        } },
        { len: hipY * 0.12, base: -S * 0.3, k: -S * 0.4, d: 0.42, draw: (l) => {
          cyl(l, 0.1 * B, 0.12 * B, hipY * 0.14, 8, 0, -hipY * 0.07, 0.02, hull);   // 繫部(球節)
        } },
        { len: 0, base: S * 0.12, k: S * 0.3, d: 0.64, draw: (l) => {
          cyl(l, 0.14 * B, 0.16 * B, 0.24, 8, 0, -0.1, 0.02, 0x23262a);          // 蹄
        } },
      ], chain);
    } else {
      // 犬腿:髖甲 → 逆關節小腿 → 蹠骨(掌節)→ 足爪(前肢肘後折、後肢跗前折)。
      // 犬是趾行動物:蹠骨是抬離地面的第三節,蹬離時它先發力、腳趾最後離地。
      // 身體圓角化 ⇒ 四肢圓柱化(髖甲板/足爪墊保留)
      leg = segLimb(g, pos, [
        { len: hipY * 0.5, draw: (l) => {
          bx(l, 0.4 * B, 0.55, 0.66, 0, -0.1, 0, plate);
          cyl(l, 0.15 * B, 0.19 * B, hipY * 0.52, 8, 0, -hipY * 0.28, front ? 0.06 : -0.08, hull);
        } },
        { len: hipY * 0.3, base: S * 0.45, k: S * 0.55, d: 0.15, draw: (l) => {
          cyl(l, 0.1 * B, 0.13 * B, hipY * 0.36, 8, 0, -hipY * 0.18, front ? -0.08 : 0.1, hullDk);
        } },
        { len: hipY * 0.12, base: -S * 0.4, k: -S * 0.45, d: 0.42, draw: (l) => {
          cyl(l, 0.08 * B, 0.09 * B, hipY * 0.16, 8, 0, -hipY * 0.08, 0.02, hull);   // 蹠骨(掌節)
        } },
        { len: 0, base: S * 0.16, k: S * 0.3, d: 0.64, draw: (l) => {
          bx(l, 0.34 * B, 0.2, 0.55, 0, -0.1, 0.12, 0x23262a);                   // 足爪
        } },
      ], chain);
    }
    return leg;
  };

  let armSh = null, armEl = null, armBase = null;   // 人馬持槍雙臂(僅 C==='centaur' 賦值)
  if (C === 'hound') {
    // ---- 機械獵犬:修長犬軀(圓角矩形量體 —— 真獸沒有直角)+ 立耳吻部;背揹反器材長砲 ----
    rbz(spine, 1.4 * B, 1.1 * B, 2.3, 0, 0.05, -0.9, hullDk, { metalness: 0.6 });
    bx(spine, 1.2 * B, 0.2, 1.9, 0, 0.62 * B, -0.9, dim(plate, 0.9));
    rbz(chest, 1.6 * B, 1.35 * B, 2.1, 0, 0.1, 0.5, hull, { metalness: 0.6 });
    // 胸腹平面接合:脊椎波讓前後兩段相對俯仰,圓角端對圓角端會張口 ——
    // 接縫以「平端」關節環覆蓋(跟著胸段動,蓋住縫;接合處不圓角)
    const hcol = cyl(chest, 0.56 * B, 0.56 * B, 0.62, 14, 0, 0.02, -0.5, dim(hull, 0.82), { metalness: 0.6 });
    hcol.rotation.x = Math.PI / 2;
    hcol.scale.x = 1.25;
    bx(chest, 1.62 * B, 0.16, 0.5, 0, 0.32 * B, 1.4, accent, { emissive: accent, emissiveIntensity: 0.9 });
    neck.position.set(0, 0.55 * B, 1.45);
    chest.add(neck);
    bx(neck, 0.65 * B, 0.55 * B, 0.8, 0, 0.15, 0.25, hullDk);
    head.position.set(0, 0.42 * B, 0.7);
    neck.add(head);
    bx(head, 0.8 * B, 0.6 * B, 0.85, 0, 0, 0.2, plate, { metalness: 0.6 });
    bx(head, 0.46 * B, 0.36 * B, 0.9, 0, -0.12 * B, 0.9, hullDk);                  // 吻部
    bx(head, 0.48 * B, 0.13, 0.28, 0, -0.32 * B, 0.85, 0x23262a);                  // 下顎
    bx(head, 0.52 * B, 0.1, 0.06, 0, 0.12 * B, 0.64, accent, { emissive: accent, emissiveIntensity: 1.6 });
    for (const sx of [-1, 1]) {
      const ear = bx(head, 0.14, 0.5, 0.1, sx * 0.28 * B, 0.42 * B, 0.05, hullDk);
      ear.rotation.z = sx * -0.2;
    }
    // 背架 + 長砲管(朝 +z)+ 觀瞄鏡 + 彈藥箱
    bx(spine, 0.5 * B, 0.4, 1.2, 0.25 * B, 0.95 * B, -0.5, 0x2b3138, { metalness: 0.6 });
    const barrel = cyl(spine, 0.09, 0.12, 3.6, 8, 0.25 * B, 1.15 * B, 0.9, 0x14171a, { metalness: 0.85 });
    barrel.rotation.x = Math.PI / 2;
    cyl(barrel, 0.14, 0.14, 0.3, 8, 0, 1.7, 0, 0x0d0f11);                          // 砲口制退器
    bx(spine, 0.2, 0.16, 0.5, 0.25 * B, 1.42 * B, -0.3, 0x1c2126);                 // 觀瞄鏡體
    bx(spine, 0.12, 0.08, 0.14, 0.25 * B, 1.42 * B, 0.0, accent, { emissive: accent, emissiveIntensity: 1.2 });
    bx(spine, 0.5 * B, 0.35, 0.7, -0.35 * B, 0.85 * B, -1.1, hullDk);              // 彈藥箱
    bx(spine, 0.52 * B, 0.1, 0.72, -0.35 * B, 1.06 * B, -1.1, dim(accent, 0.8));
    // 犬尾:多節圓柱串接(節身收分 + 節間關節環)
    tail.position.set(0, 0.35 * B, -1.95);
    cyl(tail, 0.12 * B, 0.1 * B, P.tailLen, 8, 0, 0, -P.tailLen / 2, hullDk).rotation.x = Math.PI / 2;
    cyl(tail, 0.13 * B, 0.13 * B, 0.09, 8, 0, 0, -P.tailLen, 0x23262a, { metalness: 0.8 }).rotation.x = Math.PI / 2;
    cyl(tail2, 0.08 * B, 0.06 * B, P.tailLen * 0.8, 8, 0, 0, -P.tailLen * 0.4, 0x23262a).rotation.x = Math.PI / 2;
    cyl(tail2, 0.09 * B, 0.09 * B, 0.16, 8, 0, 0, -P.tailLen * 0.8, accent, { emissive: accent, emissiveIntensity: 0.8 })
      .rotation.x = Math.PI / 2;
  } else if (C === 'centaur') {
    // ---- 人馬:馬軀四足底盤(圓角矩形量體)+ 人形上身(neck 樞軸 = 腰)雙手持長槍 ----
    rbz(spine, 1.35 * B, 1.05 * B, 2.2, 0, 0.05, -0.85, hullDk, { metalness: 0.6 });
    bx(spine, 1.15 * B, 0.18, 1.8, 0, 0.6 * B, -0.85, dim(plate, 0.9));
    rbz(chest, 1.5 * B, 1.2 * B, 1.9, 0, 0.05, 0.35, hull, { metalness: 0.6 });
    // 胸腹平面接合環(見獵犬):蓋住脊椎波張開的圓角接縫 —— 馬軀移動不再前後分離
    const ccol = cyl(chest, 0.52 * B, 0.52 * B, 0.62, 14, 0, 0.0, -0.45, dim(hull, 0.82), { metalness: 0.6 });
    ccol.rotation.x = Math.PI / 2;
    ccol.scale.x = 1.28;
    neck.position.set(0, 0.75 * B, 0.95);
    chest.add(neck);
    bx(neck, 0.85 * B, 0.5, 0.6, 0, 0.2, 0, hullDk);                               // 腰
    bx(neck, 1.05 * B, 0.9, 0.7, 0, 0.85, 0, hull, { metalness: 0.6 });            // 胸廓
    bx(neck, 0.5 * B, 0.3, 0.14, 0, 0.95, 0.4, accent, { emissive: accent, emissiveIntensity: 0.9 });
    // 長槍端在胸前(槍口朝 +z):據槍射姿 —— 上身跟著 rider 穩定,槍口恆指前方
    const rifle = bx(neck, 0.14, 0.24, 3.2, 0.15 * B, 0.55, 0.75, 0x14171a, { metalness: 0.85 });
    bx(rifle, 0.07, 0.1, 0.9, 0, 0.04, 1.85, 0x30373f, { metalness: 0.85 });
    bx(rifle, 0.09, 0.26, 0.3, 0, -0.2, -1.5, 0x23262a);                           // 槍托
    bx(rifle, 0.08, 0.07, 0.3, 0, 0.22, 0.2, accent, { emissive: accent, emissiveIntensity: 0.8 });
    // 持槍雙臂(不再是垂臂):肩樞軸 → 上臂前伸下壓 → 前臂折向槍身 ——
    // 右手扣握把(槍身後段)、左手前伸托護木;雙手把長槍鎖死在胸前的備射姿勢。
    // sh/el 存進 armSh/armEl + 記下建構時的基準角(armBase),讓 stepQuad 能疊加待機微顫
    // 而不打散「鎖死當穩定射擊台」的姿勢 —— MUST NOT 只是建好姿勢就丟著不再驅動
    armSh = []; armEl = []; armBase = [];
    for (const sx of [-1, 1]) {
      bx(neck, 0.5, 0.35, 0.6, sx * 0.75 * B, 1.2, 0, plate);                      // 墊肩
      const sh = new THREE.Group();
      sh.position.set(sx * 0.72 * B, 1.05, 0.12);
      neck.add(sh);
      sh.rotation.x = sx > 0 ? -0.55 : -1.05;      // 上臂前伸(左手伸得更遠去托護木)
      sh.rotation.z = sx * -0.35;                  // 內收向槍身
      bx(sh, 0.22, 0.7, 0.26, 0, -0.32, 0, hullDk);                                // 上臂
      const el = new THREE.Group();
      el.position.set(0, -0.66, 0);
      sh.add(el);
      el.rotation.x = sx > 0 ? -0.9 : -0.35;       // 肘前折扣向槍身
      el.rotation.z = sx * 0.22;
      bx(el, 0.18, 0.55, 0.2, 0, -0.26, 0.02, 0x30373f);                           // 前臂
      bx(el, 0.16, 0.18, 0.24, 0, -0.55, 0.04, 0x23262a);                          // 手(握把/護木)
      armSh.push(sh); armEl.push(el);
      armBase.push({ shX: sh.rotation.x, shZ: sh.rotation.z, elX: el.rotation.x, elZ: el.rotation.z });
    }
    head.position.set(0, 1.5, 0.05);
    neck.add(head);
    bx(head, 0.42 * B, 0.4, 0.46, 0, 0.1, 0, plate, { metalness: 0.6 });
    bx(head, 0.32 * B, 0.1, 0.06, 0, 0.12, 0.25, accent, { emissive: accent, emissiveIntensity: 1.6 });
    // 馬尾散熱索:多節圓柱串接(下垂的粗-細兩節 + 關節環)
    tail.position.set(0, 0.4 * B, -1.8);
    const t1 = cyl(tail, 0.11 * B, 0.09 * B, P.tailLen, 8, 0, -0.2, -P.tailLen / 2, hullDk);
    t1.rotation.x = Math.PI / 2 + 0.25;
    cyl(tail2, 0.09 * B, 0.09 * B, 0.08, 8, 0, -0.32, -0.02, 0x30373f, { metalness: 0.8 })
      .rotation.x = Math.PI / 2 + 0.35;                                            // 節間關節環
    const t2c = cyl(tail2, 0.07 * B, 0.05 * B, P.tailLen * 0.6, 8, 0, -0.42, -P.tailLen * 0.28, 0x23262a);
    t2c.rotation.x = Math.PI / 2 + 0.35;
  } else if (C === 'stego') {
    // ---- 劍龍:拱背軀體(圓角矩形量體)+ 交錯背鰭列;四片大鰭 = 四聯裝飛彈鰭 ----
    rbz(spine, 1.9 * B, 1.3 * B, 2.6, 0, 0.1, -1.0, hullDk, { metalness: 0.6 });
    rbz(chest, 2.1 * B, 1.5 * B, 2.4, 0, 0.25, 0.5, hull, { metalness: 0.6 });
    bx(chest, 1.7 * B, 0.2, 1.9, 0, 1.05 * B, 0.5, dim(plate, 0.9));
    // 胸腹平面接合環(見獵犬):側步搖擺 + 脊椎波下前後量體不張口
    const scol = cyl(chest, 0.7 * B, 0.7 * B, 0.72, 14, 0, 0.12, -0.62, dim(hull, 0.82), { metalness: 0.6 });
    scol.rotation.x = Math.PI / 2;
    scol.scale.x = 1.42;
    const finAt = (parent, y, z, h, big, sx) => {
      const f = new THREE.Group();
      f.position.set(sx * 0.26 * B, y, z);
      parent.add(f);
      const pl = bx(f, 0.14, h, h * 0.85, 0, h * 0.42, 0, big ? plate : hullDk, { metalness: 0.5 });
      pl.rotation.x = Math.PI / 4;                                                 // 菱形鰭(側視)
      if (big) {
        for (let i = 0; i < 4; i++) {   // 前緣四聯裝管口(彈尖主色)
          const cy = h * (0.28 + i * 0.14), cz = h * (0.5 - i * 0.14);
          const cell = cyl(f, 0.065, 0.065, 0.24, 6, 0, cy, cz, 0x111418, { metalness: 0.8 });
          cell.rotation.x = Math.PI / 2;
          const tip = cyl(f, 0.045, 0.045, 0.06, 6, 0, cy, cz + 0.15, accent, { emissive: accent, emissiveIntensity: 1.5 });
          tip.rotation.x = Math.PI / 2;
        }
      } else {
        bx(f, 0.15, 0.2, 0.14, 0, h * 0.82, 0, accent, { emissive: accent, emissiveIntensity: 0.7 });
      }
    };
    finAt(chest, 1.05 * B, 1.25, 0.9, false, -1);
    finAt(chest, 1.1 * B, 0.62, 1.3, true, 1);
    finAt(chest, 1.12 * B, -0.05, 1.45, true, -1);
    finAt(spine, 0.72 * B, -0.6, 1.35, true, 1);
    finAt(spine, 0.68 * B, -1.25, 1.15, true, -1);
    finAt(spine, 0.6 * B, -1.85, 0.85, false, 1);
    // 長頸低伸:胸廓 → 頸以三節逐段收分(不再是一截突兀的短方塊),頭部拉長成喙吻
    neck.position.set(0, -0.05, 1.5);
    chest.add(neck);
    for (let i = 0; i < 3; i++) {   // 頸節:寬度/高度自胸廓連續收分,節間微下傾
      const t = i / 2;
      const seg = bx(neck, (0.95 - 0.4 * t) * B, (0.8 - 0.34 * t) * B, 0.55, 0, -0.06 * i, 0.1 + i * 0.5, i ? hullDk : hull, { metalness: 0.6 });
      seg.rotation.x = 0.06;
    }
    head.position.set(0, -0.18, 1.35);
    neck.add(head);
    bx(head, 0.52 * B, 0.42 * B, 0.75, 0, 0, 0.2, plate, { metalness: 0.6 });        // 顱殼(拉長)
    bx(head, 0.4 * B, 0.3 * B, 0.7, 0, -0.04 * B, 0.85, hullDk);                     // 長吻
    const beakS = new THREE.Mesh(new THREE.ConeGeometry(0.17 * B, 0.6, 6), mat(0xd8d4c8, { metalness: 0.6 }));
    beakS.rotation.x = Math.PI / 2;
    beakS.position.set(0, -0.08 * B, 1.42);                                          // 角質喙尖
    head.add(beakS);
    bx(head, 0.24 * B, 0.14 * B, 0.5, 0, -0.2 * B, 0.85, 0x23262a);                  // 下顎
    bx(head, 0.44 * B, 0.09, 0.06, 0, 0.1 * B, 0.5, accent, { emissive: accent, emissiveIntensity: 1.6 });
    // 重尾:多節圓柱串接,自臀部連續收分(根粗梢細),再接尾錘尖刺(thagomizer)
    tail.position.set(0, 0.34 * B, -2.05);
    for (let i = 0; i < 3; i++) {   // 尾根三節:圓柱節身 + 節間關節環
      const r0 = (0.3 - 0.075 * i) * B, r1 = (0.3 - 0.075 * (i + 1)) * B;
      const seg = cyl(tail, r0, r1, P.tailLen / 3 + 0.04,
        10, 0, -0.04 * i, -(i + 0.5) * P.tailLen / 3, i ? hullDk : hull, { metalness: 0.6 });
      seg.rotation.x = Math.PI / 2;
      seg.scale.y = 0.88;   // 微扁(獸尾橫剖不是正圓)
      cyl(tail, r1 * 1.12, r1 * 1.12, 0.08, 10, 0, -0.04 * i, -(i + 1) * P.tailLen / 3, 0x23262a, { metalness: 0.8 })
        .rotation.x = Math.PI / 2;
    }
    for (let i = 0; i < 3; i++) {   // 尾梢三節:續收分到尖端
      const r0 = (0.15 - 0.035 * i) * B, r1 = (0.15 - 0.035 * (i + 1)) * B;
      cyl(tail2, r0, r1, P.tailLen * 0.26,
        8, 0, -0.03 * i, -(i + 0.4) * P.tailLen * 0.26, i < 2 ? hullDk : 0x23262a)
        .rotation.x = Math.PI / 2;
    }
    for (const [sx, sz] of [[-1, -0.5], [1, -0.5], [-1, -0.75], [1, -0.75]]) {
      const spk = new THREE.Mesh(new THREE.ConeGeometry(0.09 * B, 0.7, 5), mat(0xd8dde2, { metalness: 0.7 }));
      spk.position.set(sx * 0.2 * B, 0.1, sz * P.tailLen);
      spk.rotation.z = sx * -1.2;
      tail2.add(spk);
    }
  } else {
    // ---- 克蘇魯:外套膜軀體 + 複眼群/面鬚;四持武觸手(雙槍莢/刃鰭/感測球)----
    const mantle = new THREE.Mesh(new THREE.SphereGeometry(1.05 * B, 14, 10), mat(hull, { metalness: 0.5 }));
    mantle.scale.set(1, 0.95, 1.25);
    mantle.position.set(0, 0.35, -0.3);
    spine.add(mantle);
    bx(spine, 1.3 * B, 0.18, 1.6, 0, 1.25 * B, -0.3, dim(plate, 0.9));
    bx(chest, 1.6 * B, 1.1 * B, 1.4, 0, 0.3, 0.3, hull, { metalness: 0.55 });
    bx(chest, 1.2 * B, 0.16, 0.4, 0, 0.05, 1.0, accent, { emissive: accent, emissiveIntensity: 0.9 });
    neck.position.set(0, 0.35, 0.75);
    chest.add(neck);
    head.position.set(0, 0.15 * B, 0.45);
    neck.add(head);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.62 * B, 12, 9), mat(plate, { metalness: 0.5 }));
    dome.scale.set(1, 0.9, 1);
    head.add(dome);
    for (let i = -2; i <= 2; i++) {   // 弧列複眼群(中央大眼)
      const eye = new THREE.Mesh(new THREE.SphereGeometry((i === 0 ? 0.11 : 0.07) * B, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.6 }));
      eye.position.set(Math.sin(i * 0.5) * 0.48 * B, 0.2 * B, Math.cos(i * 0.5) * 0.5 * B);
      head.add(eye);
    }
    for (let i = -2; i <= 2; i++) {   // 面鬚觸手
      const b1 = cyl(head, 0.05 * B, 0.08 * B, 0.55, 6, i * 0.16 * B, -0.4 * B, 0.42 * B, hullDk);
      b1.rotation.x = 0.35 - Math.abs(i) * 0.08;
      const b2 = cyl(head, 0.03 * B, 0.05 * B, 0.4, 6, i * 0.18 * B, -0.72 * B, 0.55 * B, 0x23262a);
      b2.rotation.x = 0.6;
    }
    // 四持武觸手(四爪步行已由 mkLeg 提供;此為上部四爪持武)——
    // 與觸手腿同一套五節多關節結構:先外舉抬起,再逐節向前捲,末節掛武器
    const wArm = (sx, sz, ry, tipKind) => {
      const a = new THREE.Group();
      a.position.set(sx * 0.85 * B, 0.85 * B, sz);
      a.rotation.y = ry;
      chest.add(a);
      const segs = [0.8, 0.72, 0.62, 0.52, 0.42];
      const chain = [];
      tents.push(chain);
      let node = a, prev = 0;
      for (let i = 0; i < segs.length; i++) {
        const j = new THREE.Group();
        j.position.set(0, -prev, 0);
        node.add(j);
        j.rotation.z = i === 0 ? sx * 2.3 : -sx * 0.34;   // 先外舉(節段朝上外)→ 逐節回捲
        j.rotation.x = i === 0 ? 0 : 0.3;                 // 逐節前捲(章魚/八爪博士式曲線)
        // 節節相位延遲 → 由根往梢跑的蠕動波(locomotion undulate);末節不動,武器才穩得住
        if (i < segs.length - 1) chain.push({ g: j, base: j.rotation.x, k: 0.13, d: i * 0.6 });
        const len = segs[i] * B, rt = (0.14 - i * 0.018) * B, rb = (0.17 - i * 0.018) * B;
        cyl(j, rt, rb, len, 8, 0, -len / 2, 0, i % 2 ? hullDk : hull, { metalness: 0.5 });
        cyl(j, rb * 1.12, rb * 1.12, 0.07, 8, 0, -0.02, 0, accent, { emissive: accent, emissiveIntensity: 0.6 });  // 關節環
        for (let k = 0; k < 3; k++)   // 腹面吸盤列
          cyl(j, rt * 0.32, rt * 0.32, 0.04, 6, 0, -len * (0.25 + k * 0.25), rb * 0.85, 0x23262a).rotation.x = Math.PI / 2;
        node = j;
        prev = len;
      }
      const tipP = new THREE.Group();
      tipP.position.set(0, -prev - 0.1, 0);
      tipP.rotation.x = -Math.PI / 2 + 0.35;   // 末節把武器轉成朝前(觸手握持角)
      node.add(tipP);
      if (tipKind === 'gun') {
        const pod = cyl(tipP, 0.09, 0.11, 1.0, 8, 0, 0, 0.2, 0x111418, { metalness: 0.85 });
        pod.rotation.x = Math.PI / 2;
        const muz = cyl(tipP, 0.12, 0.12, 0.06, 8, 0, 0, 0.74, accent, { emissive: accent, emissiveIntensity: 1.2 });
        muz.rotation.x = Math.PI / 2;
      } else if (tipKind === 'blade') {
        const bl = bx(tipP, 0.06, 0.6, 0.36, 0, 0.22, 0.05, 0xd8dde2, { metalness: 0.8 });
        bl.rotation.x = -0.3;
      } else {
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.5 }));
        tipP.add(orb);
      }
    };
    wArm(-1, 0.55, 0, 'gun');
    wArm(1, 0.55, 0, 'gun');
    wArm(-1, -0.25, -0.5, 'blade');
    wArm(1, -0.25, 0.5, 'orb');
    // 後觸手(尾:急轉配重)
    tail.position.set(0, 0.5 * B, -1.5);
    const t1 = cyl(tail, 0.14 * B, 0.2 * B, P.tailLen, 7, 0, 0, -P.tailLen / 2, hullDk);
    t1.rotation.x = Math.PI / 2;
    const t2m = cyl(tail2, 0.08 * B, 0.13 * B, P.tailLen * 0.75, 7, 0, 0.12, -P.tailLen * 0.36, 0x23262a);
    t2m.rotation.x = Math.PI / 2 - 0.35;
  }

  // 建腿的順序 = legChains 的順序(FL, FR, HL, HR)
  const legFL = mkLeg(-1, P.fz, true), legFR = mkLeg(1, P.fz, true);
  const legHL = mkLeg(-1, P.hz, false), legHR = mkLeg(1, P.hz, false);
  const rig = {
    kind: 'quad', spine, chest, neck, head, tail, tail2,
    tailSegs: [tail, tail2],              // 尾 = 多節鞭:whipTail 逐節延遲 + 急轉配重
    neckY0: neck.position.y,              // 頸的靜姿高度:跑動時反向吸收脊椎彈跳 → 頭不亂晃
    // 頭離脊椎樞軸的水平力臂:脊椎波只有 ±0.05 rad,但長頸把它放大成頭部好幾十公分的上下畫弧
    // (獵犬/劍龍實測 0.57m,是軀幹自身起伏的 4 倍)⇒ 頸必須按力臂反向補償,不能只補彈跳
    headArm: chest.position.z + neck.position.z + head.position.z,
    headArmN: head.position.z,
    // 人馬的「頸」其實是人形上半身 —— 它不做脊椎波,而是像騎士一樣反向吸收馬軀的起伏
    rider: C === 'centaur',
    legFL, legFR, legHL, legHR,
    chFL: legChains[0], chFR: legChains[1], chHL: legChains[2], chHR: legChains[3],
    tents: tents.length ? tents : null,   // 持武觸手(克蘇魯):恆時緩慢蠕動的多節波
    armSh, armEl, armBase,   // 人馬持槍雙臂(僅 centaur 非 null;stepQuad rider 分支疊加待機微顫)
    hipsY0: hipY, stride: P.stride, top: P.top ?? 10,
    // 各生物專屬步態參數(見 BEAST 表):側步/小跑/觸手輪 + 體側搖擺/彈跳/俯仰幅;
    // soft = 觸手腿(整條走 undulate 全波,不是關節腿的屈曲)
    gait: P.gait, gallopType: P.gallopType, bob: P.bob ?? 0.09, rollSway: P.rollSway,
    pitchAmp: P.pitchAmp, legAmp: P.legAmp, soft: P.soft,
  };
  g.userData.rig = rig;
  return g;
}

/**
 * 雙足獸型機甲(form:'biped'):可動雙足骨架(rig 'biped' 合約同 buildRobotMech,
 * locomotion stepBiped 驅動步態/重心側移/前傾)。武裝內建於生物構造:
 * creature: 'gorilla' 猩猩(巨臂武裝:右前臂旋轉機砲、左前臂鑄鐵鍋盾)
 *         | 'ostrich' 鴕鳥/仿生鶴(半開翼內藏飛彈管、膝部導彈莢)
 *         | 'trex' 暴龍(巨顎藏無後座砲,重尾配重)
 *         | 'roo' 袋鼠(強健雙腿 + 著地平衡尾,前臂拳砲)。
 */
// lean = 加速前傾倍率;tailUp = 高速時的尾部抬升(角動量配平)。
// 體軸「直立」的機種(人形/猩猩)靠前傾加速;體軸「水平」的機種(暴龍/鴕鳥/袋鼠)
// 體幹已經是水平的,再套人形的前傾量就變成頭朝地俯衝 —— 牠們是把尾巴抬起來配平,不是把頭壓下去。
// bound = 短腿機種的高速跳奔混成(猩猩:雙腿併蹬、雙臂前撐的拳步疾馳 —— 短腿靠跨步/騰空
// 衝刺,不靠狂刷步頻);hop = 袋鼠跳(stride = 單跳世界長度,hopLean 體軸壓平至近水平,
// hopH 騰空拋物線高度,鋸齒俯仰與反相重尾都在 locomotion stepHop)。
// knuckle = 指節行走(猩猩):前肢是真的承重前腳 —— 臂長到指節觸地、擺幅與腿同級、
// 支撐相吃載荷彈簧(locomotion stepBiped);grounded + tuckArms = grounded running
// (鴕鳥/迅猛龍):沒有騰空相的跑,速度越快軀幹浮沉越收斂,前肢收起蓄勢不擺動。
// 袋鼠 stride = 單跳世界長度:一跳跨大步(5.6),寧可拉大騰空也不刷跳頻(高頻晃動的根源)。
const BIPED = {
  gorilla: { hipY: 2.0, stride: 2.6, bob: 0.12, sway: 0.1,  top: 7,  lean: 0.9,  tailUp: 0,
             bound: 1, knuckle: 1, armBase: 0.14 },
  ostrich: { hipY: 3.0, stride: 3.8, bob: 0.1,  sway: 0.06, top: 7,  lean: 0.35, tailUp: 0.16,
             grounded: 1, tuckArms: 1 },
  trex:    { hipY: 2.5, stride: 3.4, bob: 0.12, sway: 0.08, top: 7,  lean: 0.3,  tailUp: 0.3,
             tinyArms: 1 },
  roo:     { hipY: 2.2, stride: 5.6, bob: 0.15, sway: 0.07, top: 7,  lean: 0.5,  tailUp: 0.22,
             hop: 1, hopLean: 0.85, hopH: 0.75 },
};
function buildBipedBeast(side, vis) {
  const g = new THREE.Group();
  const accent = new THREE.Color(vis?.hue ?? SIDES[side].color);
  const C = BIPED[vis?.creature] ? vis.creature : 'gorilla';
  const P = BIPED[C];
  const hipY = P.hipY;
  const PAL = heroPalette(vis, side, 'light');
  const hull = PAL.main, hullDk = PAL.mid, plate = PAL.lite, joint = PAL.deep;
  const hips = new THREE.Group();
  hips.position.y = hipY;
  g.add(hips);
  // 脊椎:hips(骨盆)→ chest(胸腔:對轉/前傾/呼吸)→ neck(頸)→ head(頭:反轉抵銷 = 凝視穩定)。
  // 尾 tailSegs 逐節延遲甩動(急轉時甩向轉向反側 = 配重),節數依生物構造
  const chest = new THREE.Group();
  hips.add(chest);
  const neck = new THREE.Group();
  chest.add(neck);
  const head = new THREE.Group();
  neck.add(head);
  const tailSegs = [];
  // 尾節:沿 −z 串接,每節自己一個樞軸群組(逐節延遲 = 鞭式跟隨)
  const mkTail = (parent, pos, lens) => {
    let cur = parent;
    lens.forEach(([len, y, z], i) => {
      const t = new THREE.Group();
      t.position.set(0, i === 0 ? pos[1] : y, i === 0 ? pos[2] : z);
      cur.add(t);
      tailSegs.push(t);
      cur = t;
    });
    return tailSegs;
  };
  // 分節骨架(segLimb + locomotion flexChain):四台各自照原型的關節構造 —
  // 猩猩蹠行短粗腿 / 鴕鳥逆關節三節長腿 / 暴龍 Z 形趾行腿 / 袋鼠強力後腿長蹠
  const legChainL = [], legChainR = [], armChainL = [], armChainR = [];
  const cl = (sx) => (sx < 0 ? legChainL : legChainR);
  const ca = (sx) => (sx < 0 ? armChainL : armChainR);
  let legL, legR, armL, armR;

  if (C === 'gorilla') {
    // ---- 猩猩:聳背厚胸 + 巨臂武裝(右旋轉機砲 / 左鑄鐵鍋盾);短粗腿(蹠行,膝微屈)----
    const mkLeg = (sx) => segLimb(g, [sx * 0.62, hipY, 0], [
      { len: 1.0, draw: (l) => cyl(l, 0.28, 0.33, 1.0, 10, 0, -0.5, 0.02, hull, { metalness: 0.6 }) },
      { len: 0.75, base: 0.1, k: 0.5, d: 0.15, draw: (l) => cyl(l, 0.24, 0.28, 0.9, 10, 0, -0.35, -0.02, hullDk) },
      { len: 0, base: -0.06, k: -0.28, d: 0.5, draw: (l) => bx(l, 0.6, 0.3, 0.95, 0, -0.16, 0.1, 0x23262a) },
    ], cl(sx));
    legL = mkLeg(-1); legR = mkLeg(1);
    bx(hips, 1.3, 0.6, 0.9, 0, 0.1, 0, joint, { metalness: 0.6 });                 // 骨盆
    // 胸腹平面接合環:胸腔對轉/前傾時,圓角胸廓底不與骨盆張口(平端覆蓋)
    const gcol = cyl(chest, 0.5, 0.5, 0.55, 14, 0, 0.5, 0.05, dim(hull, 0.85), { metalness: 0.6 });
    gcol.scale.x = 1.5;
    // 圓角厚胸(橫置膠囊:猩猩的桶狀胸廓,長軸 = 肩寬)
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.65, 0.8, 4, 12), mat(hull, { metalness: 0.6 }));
    torso.position.set(0, 1.0, 0.1);
    torso.rotation.set(0.22, 0, Math.PI / 2);                                      // 前傾聳背 + 橫置
    chest.add(torso);
    bx(chest, 2.3, 0.35, 1.1, 0, 1.62, -0.15, plate);                              // 肩背甲
    bx(chest, 0.8, 0.3, 0.14, 0, 0.85, 0.72, accent, { emissive: accent, emissiveIntensity: 0.9 });
    // 低伏頭(猩猩沒有頸:頭直接沉在肩之間 → neck 只是個短樞軸)
    neck.position.set(0, 1.6, 0.4);
    bx(head, 0.62, 0.5, 0.6, 0, 0.15, 0.15, plate, { metalness: 0.6 });            // 顱
    bx(head, 0.66, 0.16, 0.2, 0, 0.38, 0.28, hullDk);                              // 眉甲
    bx(head, 0.46, 0.12, 0.06, 0, 0.22, 0.46, accent, { emissive: accent, emissiveIntensity: 1.6 });
    // 巨臂:肩球 → 上臂 → 肘(武裝前臂)→ 腕(拳 / 砲口組)。
    // 指節行走(knuckle walk)是「真的」:臂長設計到指節觸地(肩高 3.45 ≈ 上臂 1.55 +
    // 前臂 1.82 + 拳)—— 前肢是承重前腳,擺動/載荷全由 stepBiped 的 knuckle 分支驅動
    const mkArm = (sx) => segLimb(chest, [sx * 1.35, 1.45, 0.1], [
      { len: 1.55, draw: (a) => {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), mat(plate, { metalness: 0.6 }));
        ball.position.y = 0.1;
        a.add(ball);
        cyl(a, 0.3, 0.34, 1.5, 10, 0, -0.78, 0.05, hull, { metalness: 0.6 });      // 巨上臂圓柱(拉長觸地)
      } },
      { len: 1.55, base: -0.14, k: -0.45, d: 0.32, draw: (a) => {
        if (sx > 0) {
          cyl(a, 0.42, 0.46, 1.55, 10, 0, -0.74, 0.05, hullDk, { metalness: 0.7 }); // 右:彈鼓前臂
        } else {
          cyl(a, 0.26, 0.3, 1.5, 10, 0, -0.7, 0.02, hullDk, { metalness: 0.6 });   // 左:圓柱前臂
          const pot = cyl(a, 0.85, 0.85, 0.22, 14, -0.5, -0.6, 0.05, 0x2b3138, { metalness: 0.7 });
          pot.rotation.z = Math.PI / 2;                                             // 鑄鐵鍋盾
          cyl(pot, 0.6, 0.6, 0.26, 14, 0, 0, 0, 0x363e46, { metalness: 0.6 });
          cyl(pot, 0.78, 0.78, 0.06, 14, 0, -0.12, 0, accent, { emissive: accent, emissiveIntensity: 0.7 });
        }
      } },
      { len: 0, base: 0.1, k: 0.26, d: 0.62, draw: (a) => {
        if (sx > 0) {
          // 右腕 = 三管砲口組(腕一折,砲口跟著俯仰)
          for (const aa of [0, 2.1, 4.2])
            cyl(a, 0.07, 0.07, 0.6, 6, Math.cos(aa) * 0.18, -0.12, 0.05 + Math.sin(aa) * 0.18, 0x111418, { metalness: 0.85 });
          cyl(a, 0.3, 0.3, 0.1, 10, 0, 0.01, 0.05, accent, { emissive: accent, emissiveIntensity: 0.9 });
        } else {
          bx(a, 0.4, 0.35, 0.5, 0, 0.08, 0.05, 0x30373f);                          // 左腕 = 拳(拳步著地面)
          for (let i = -1; i <= 1; i++)
            bx(a, 0.1, 0.36, 0.16, i * 0.12, -0.2, 0.18, 0x23262a);                // 指節柱(拳步的觸地點)
        }
      } },
    ], ca(sx));
    armL = mkArm(-1); armR = mkArm(1);
  } else if (C === 'ostrich') {
    // ---- 鴕鳥/仿生鶴:逆關節三節長腿(股 → 長脛 → 蹠節 → 二趾足)+ 半開翼內藏飛彈管 ----
    const mkLeg = (sx) => segLimb(g, [sx * 0.42, hipY, 0], [
      { len: 1.3, draw: (l) => {
        cyl(l, 0.12, 0.14, 1.3, 8, 0, -0.6, 0.1, hull);                            // 圓柱股節
        const podK = bx(l, 0.24, 0.32, 0.24, 0, -1.2, 0.22, hullDk);               // 膝部導彈莢
        for (const oy of [-0.07, 0.07]) {
          const c = cyl(podK, 0.05, 0.05, 0.1, 6, 0, oy, 0.14, accent, { emissive: accent, emissiveIntensity: 1.2 });
          c.rotation.x = Math.PI / 2;
        }
      } },
      // 逆關節:脛節向後折(base 正)、蹠節再向前回折(base 負)= 鳥類的 Z 形腿
      { len: 1.5, base: 0.45, k: 0.62, d: 0.14, draw: (l) => {
        const knee = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), mat(joint, { metalness: 0.7 }));
        knee.position.set(0, 0, -0.05);
        l.add(knee);
        cyl(l, 0.07, 0.09, 1.5, 8, 0, -0.75, -0.12, hullDk);                       // 圓柱長脛
      } },
      { len: 0.55, base: -0.5, k: -0.55, d: 0.36, draw: (l) => {
        cyl(l, 0.06, 0.075, 0.6, 8, 0, -0.28, 0.06, hull);                         // 圓柱蹠節(跗蹠骨)
      } },
      { len: 0, base: 0.12, k: 0.3, d: 0.55, draw: (l) => {
        bx(l, 0.3, 0.16, 0.7, 0, -0.06, 0.18, 0x23262a);                           // 二趾足
        const toe = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 5), mat(0xd8dde2, { metalness: 0.7 }));
        toe.rotation.x = Math.PI / 2;
        toe.position.set(0, -0.06, 0.62);
        l.add(toe);
      } },
    ], cl(sx));
    legL = mkLeg(-1); legR = mkLeg(1);
    bx(hips, 0.9, 0.45, 0.7, 0, 0.05, 0, joint);
    const bodyM = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 9), mat(hull, { metalness: 0.55 }));
    bodyM.scale.set(0.85, 0.75, 1.15);
    bodyM.position.set(0, 0.55, 0);
    chest.add(bodyM);
    // 尾羽扇 = 尾(單節,奔跑時隨體軸微擺配平)
    mkTail(chest, [0, 0.62, -0.7], [[0]]);
    for (let i = -1; i <= 1; i++) {
      const f = bx(tailSegs[0], 0.28, 0.06, 0.85, i * 0.24, 0, -0.3, i === 0 ? accent : plate);
      f.rotation.x = -0.5;
      f.rotation.y = i * 0.3;
    }
    // 長頸雙節:鳥的頸是 S 形彈簧,奔跑時頸在動、頭卻幾乎不動(凝視穩定的極致原型)
    neck.position.set(0, 0.8, 0.42);
    const n1 = bx(neck, 0.22, 0.9, 0.26, 0, 0.45, 0.13, hullDk);
    n1.rotation.x = 0.25;
    const neck2 = new THREE.Group();
    neck2.position.set(0, 0.9, 0.22);
    neck.add(neck2);
    bx(neck2, 0.18, 0.85, 0.2, 0, 0.25, 0.08, hull);
    head.position.set(0, 0.72, 0.14);
    neck2.add(head);                                                                // 頭掛在頸第二節上
    bx(head, 0.34, 0.3, 0.5, 0, 0, 0, plate, { metalness: 0.6 });                  // 小頭
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.5, 6), mat(0xd8b23c, { metalness: 0.6 }));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, -0.02, 0.42);
    head.add(beak);
    bx(head, 0.28, 0.08, 0.06, 0, 0.08, 0.24, accent, { emissive: accent, emissiveIntensity: 1.6 });
    bx(head, 0.1, 0.3, 0.2, 0, 0.24, -0.18, accent);                               // 頂冠
    // 翼 = 臂:肩節(覆羽板 + 飛彈管)→ 腕節(初級飛羽),擺動時腕節延遲跟隨 = 半開翼的抖動
    const mkArm = (sx) => segLimb(chest, [sx * 0.68, 0.75, 0.15], [
      { len: 0.72, draw: (a) => {
        const wing = bx(a, 0.14, 0.75, 1.5, sx * 0.05, -0.35, -0.25, plate, { metalness: 0.5 });
        wing.rotation.z = sx * 0.18;
        const covert = bx(a, 0.1, 0.5, 1.3, sx * 0.18, -0.3, -0.2, dim(plate, 0.85));
        covert.rotation.z = sx * 0.35;
        for (let i = 0; i < 3; i++) {
          const c = cyl(a, 0.06, 0.06, 0.2, 6, sx * -0.02, -0.58, 0.3 - i * 0.42, 0x111418, { metalness: 0.8 });
          c.rotation.x = Math.PI / 2;
          const t = cyl(a, 0.04, 0.04, 0.05, 6, sx * -0.02, -0.58, 0.43 - i * 0.42, accent, { emissive: accent, emissiveIntensity: 1.3 });
          t.rotation.x = Math.PI / 2;
        }
      } },
      { len: 0.5, base: -0.25, k: -0.5, d: 0.4, draw: (a) => {
        const sec = bx(a, 0.1, 0.55, 1.05, sx * 0.1, -0.24, -0.28, dim(plate, 0.8));
        sec.rotation.z = sx * 0.26;                                                // 腕節(次級飛羽)
      } },
      // 翼手節(鳥翼的第三段:掌骨/初級飛羽)—— 腕再延遲一拍 = 半開翼收放的鞭式末端
      { len: 0, base: -0.2, k: -0.45, d: 0.62, draw: (a) => {
        for (let i = -1; i <= 1; i++) {
          const f = bx(a, 0.07, 0.5, 0.8, sx * 0.12, -0.24, -0.35 + i * 0.16, i === 0 ? dim(accent, 0.8) : hullDk);
          f.rotation.z = sx * 0.3;
          f.rotation.y = sx * i * 0.12;                                            // 指狀初級飛羽
        }
      } },
    ], ca(sx));
    armL = mkArm(-1); armR = mkArm(1);
  } else if (C === 'trex') {
    // ---- 暴龍:水平體軸 + 巨顎藏無後座砲;Z 形趾行腿、小短臂,重尾配重 ----
    const mkLeg = (sx) => segLimb(g, [sx * 0.72, hipY, 0], [
      { len: 1.1, draw: (l) => cyl(l, 0.29, 0.34, 1.15, 10, 0, -0.5, 0.1, hull, { metalness: 0.6 }) },
      { len: 0.95, base: 0.4, k: 0.6, d: 0.15, draw: (l) => cyl(l, 0.2, 0.24, 1.0, 9, 0, -0.42, -0.1, hullDk) },
      { len: 0, base: -0.42, k: -0.5, d: 0.45, draw: (l) => {
        bx(l, 0.55, 0.28, 1.0, 0, -0.3, 0.2, 0x23262a);                            // 三趾足
        for (let i = -1; i <= 1; i++) {
          const claw = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.32, 5), mat(0xd8dde2, { metalness: 0.7 }));
          claw.rotation.x = Math.PI / 2;
          claw.position.set(i * 0.2, -0.33, 0.78);
          l.add(claw);
        }
      } },
    ], cl(sx));
    legL = mkLeg(-1); legR = mkLeg(1);
    bx(hips, 1.15, 0.85, 1.1, 0, 0.15, 0, joint, { metalness: 0.6 });              // 骨盆
    const chestT = rbz(chest, 1.3, 1.05, 1.7, 0, 0.5, 1.05, hull, { metalness: 0.6 });  // 圓角胸軀
    chestT.rotation.x = Math.PI / 2 + 0.12;
    // 胸腹平面接合環:胸段對轉時圓角端不與骨盆張口
    const tcol = cyl(chest, 0.48, 0.48, 0.55, 12, 0, 0.42, 0.35, dim(hull, 0.82), { metalness: 0.6 });
    tcol.rotation.x = Math.PI / 2;
    tcol.scale.x = 1.2;
    for (let i = 0; i < 4; i++) {                                                  // 背甲鱗列
      const sc = bx(chest, 0.28, 0.22, 0.34, 0, 1.06 - i * 0.04, 1.3 - i * 0.75, hullDk);
      sc.rotation.x = 0.3;
    }
    // 頸(短而粗)→ 頭:奔跑時軀幹起伏,頭要維持水平前視(捕食者的凝視穩定)
    neck.position.set(0, 0.8, 1.5);
    head.position.set(0, 0.15, 0.4);
    bx(head, 0.85, 0.6, 1.0, 0, 0.15, 0.3, plate, { metalness: 0.6 });             // 顱殼
    bx(head, 0.6, 0.34, 0.9, 0, -0.05, 0.85, hullDk);                              // 上顎
    for (let i = 0; i < 4; i++) {                                                  // 上齒列
      const th = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 4), mat(0xe8ecef));
      th.rotation.x = Math.PI;
      th.position.set((i - 1.5) * 0.14, -0.26, 1.1);
      head.add(th);
    }
    const jaw = bx(head, 0.5, 0.2, 0.95, 0, -0.52, 0.62, 0x23262a);
    jaw.rotation.x = 0.42;                                                         // 下顎張開
    const gunT = cyl(head, 0.09, 0.11, 1.6, 8, 0, -0.12, 1.2, 0x111418, { metalness: 0.85 });
    gunT.rotation.x = Math.PI / 2;                                                 // 口腔無後座砲
    const muzT = cyl(head, 0.13, 0.13, 0.07, 8, 0, -0.12, 2.0, accent, { emissive: accent, emissiveIntensity: 1.3 });
    muzT.rotation.x = Math.PI / 2;
    bx(head, 0.3, 0.14, 0.2, 0, -0.3, 0.5, accent, { emissive: accent, emissiveIntensity: 1.0 });   // 喉部充能
    bx(head, 0.6, 0.1, 0.08, 0, 0.34, 0.78, accent, { emissive: accent, emissiveIntensity: 1.6 });  // 眼列
    // 小短臂:上臂 → 肘(前臂)→ 腕(二爪),永遠深屈在胸前(暴龍的招牌姿勢);
    // 腕的擺幅刻意極小 —— 短臂在奔跑時只是抓握狀微顫,不甩動
    const mkArm = (sx) => segLimb(chest, [sx * 0.62, 0.35, 1.55], [
      { len: 0.4, draw: (a) => cyl(a, 0.075, 0.09, 0.4, 8, 0, -0.18, 0.05, hull) },
      { len: 0.3, base: -0.85, k: -0.4, d: 0.3, draw: (a) => cyl(a, 0.055, 0.065, 0.3, 8, 0, -0.14, 0.02, hullDk) },
      { len: 0, base: -0.2, k: -0.18, d: 0.6, draw: (a) => {
        bx(a, 0.11, 0.12, 0.12, 0, -0.05, 0.03, joint);                                     // 腕
        for (const o of [-0.05, 0.06]) bx(a, 0.05, 0.14, 0.08, o, -0.16, 0.06, 0x30373f);   // 二爪
      } },
    ], ca(sx));
    armL = mkArm(-1); armR = mkArm(1);
    // 巨尾三節(配重):多節圓柱串接的活平衡桿 —— 急轉時甩向轉向反側,逐節延遲跟隨
    mkTail(hips, [0, 0.3, -0.4], [[0], [0, -0.05, -1.2], [0, -0.07, -1.0]]);
    const tl1 = cyl(tailSegs[0], 0.42, 0.32, 1.4, 10, 0, 0, -0.7, hull);
    tl1.rotation.x = Math.PI / 2 - 0.08;
    tl1.scale.x = 1.15;                                                            // 微扁寬(接臀)
    cyl(tailSegs[1], 0.34, 0.34, 0.1, 10, 0, 0, -0.05, 0x23262a, { metalness: 0.8 }).rotation.x = Math.PI / 2;
    cyl(tailSegs[1], 0.3, 0.2, 1.3, 9, 0, 0, -0.7, hullDk).rotation.x = Math.PI / 2;
    cyl(tailSegs[2], 0.21, 0.21, 0.09, 9, 0, 0, -0.04, 0x30373f, { metalness: 0.8 }).rotation.x = Math.PI / 2;
    cyl(tailSegs[2], 0.17, 0.09, 1.1, 8, 0, 0, -0.55, 0x23262a).rotation.x = Math.PI / 2;
    cyl(tailSegs[2], 0.12, 0.12, 0.18, 8, 0, 0, -1.15, accent, { emissive: accent, emissiveIntensity: 0.8 })
      .rotation.x = Math.PI / 2;
  } else {
    // ---- 袋鼠:大後腿(股 → 脛 → 長蹠 → 趾)+ 著地平衡尾 + 拳砲前臂(拳擊架式)----
    const mkLeg = (sx) => segLimb(g, [sx * 0.55, hipY, 0], [
      { len: 0.95, draw: (l) => {
        const haunch = cyl(l, 0.26, 0.3, 1.0, 10, 0, -0.4, 0.05, hull, { metalness: 0.6 });
        haunch.rotation.x = -0.2;                                                  // 蓄力的粗股(橢圓柱)
        haunch.scale.z = 1.7;
      } },
      { len: 0.8, base: 0.6, k: 0.72, d: 0.14, draw: (l) => cyl(l, 0.11, 0.13, 0.95, 8, 0, -0.4, -0.1, hullDk) },
      { len: 0, base: -0.62, k: -0.6, d: 0.4, draw: (l) => {
        bx(l, 0.3, 0.18, 1.15, 0, -0.08, 0.35, 0x23262a);                          // 長蹠(著地面)
        bx(l, 0.32, 0.1, 0.3, 0, -0.06, 0.9, dim(accent, 0.8));                    // 足尖識別
      } },
    ], cl(sx));
    legL = mkLeg(-1); legR = mkLeg(1);
    bx(hips, 1.0, 0.55, 0.85, 0, 0.1, 0, joint, { metalness: 0.6 });
    // 圓角胸軀(直立膠囊:袋鼠的圓潤上身)
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 0.2, 4, 10), mat(hull, { metalness: 0.6 }));
    torso.scale.set(1.05, 1, 0.85);
    torso.position.set(0, 0.85, 0.15);
    torso.rotation.x = 0.3;
    chest.add(torso);
    // 胸腹平面接合環:跳躍大前傾時,圓角胸底不與骨盆張口(平端覆蓋,跟著胸段動)
    const rcol = cyl(chest, 0.4, 0.44, 0.6, 12, 0, 0.35, 0.08, dim(hull, 0.85), { metalness: 0.6 });
    rcol.scale.x = 1.2;
    bx(chest, 0.6, 0.5, 0.16, 0, 0.55, 0.55, hullDk);                              // 育袋艙蓋
    bx(chest, 0.34, 0.12, 0.06, 0, 0.6, 0.66, accent, { emissive: accent, emissiveIntensity: 1.0 });
    neck.position.set(0, 1.35, 0.35);                                              // 短頸
    bx(head, 0.4, 0.36, 0.5, 0, 0.27, 0.07, plate, { metalness: 0.6 });            // 頭
    bx(head, 0.26, 0.2, 0.28, 0, 0.19, 0.37, hullDk);                              // 吻部
    bx(head, 0.32, 0.09, 0.06, 0, 0.35, 0.31, accent, { emissive: accent, emissiveIntensity: 1.6 });
    for (const sx of [-1, 1]) {                                                    // 長耳
      const ear = bx(head, 0.1, 0.55, 0.16, sx * 0.16, 0.7, -0.03, hull);
      ear.rotation.z = sx * -0.15;
    }
    // 拳擊架式:肘恆深屈把拳砲收在胸前,擺動時只小幅開合(不甩大臂);
    // 腕節 = 拳砲本體 —— 前臂是平舉的(幾何沿 +z),樞軸因此要用 piv 落在前臂末端而非 −y
    const mkArm = (sx) => segLimb(chest, [sx * 0.6, 1.15, 0.3], [
      { len: 0.45, draw: (a) => cyl(a, 0.1, 0.11, 0.5, 8, 0, -0.2, 0.05, hull) },
      { len: 0, base: -0.95, k: -0.35, d: 0.3,
        draw: (a) => cyl(a, 0.11, 0.11, 0.6, 8, 0, -0.08, 0.28, hullDk).rotation.x = Math.PI / 2 },  // 前臂平舉(圓柱沿 z)
      { piv: [0, -0.08, 0.6], base: 0, k: 0.22, d: 0.6, len: 0, draw: (a) => {
        bx(a, 0.26, 0.28, 0.2, 0, 0, 0.02, joint);                                 // 腕(拳砲基座)
        for (const oy of [-0.05, 0.05]) {
          const b = cyl(a, 0.04, 0.04, 0.3, 6, 0, oy, 0.2, 0x111418, { metalness: 0.85 });
          b.rotation.x = Math.PI / 2;                                              // 雙管拳砲
        }
        const muz = cyl(a, 0.06, 0.06, 0.05, 6, 0, 0, 0.38, accent, { emissive: accent, emissiveIntensity: 1.2 });
        muz.rotation.x = Math.PI / 2;
      } },
    ], ca(sx));
    armL = mkArm(-1); armR = mkArm(1);
    // 著地平衡尾(三節圓柱串接):袋鼠跳躍時尾是第三條腿 —— 前擺蓄力、落地尾梢先觸地卸力
    mkTail(hips, [0, -0.1, -0.3], [[0], [0, -0.65, -1.15], [0, -0.6, -0.75]]);
    const t1 = cyl(tailSegs[0], 0.27, 0.22, 1.5, 10, 0, 0, -0.7, hull);
    t1.rotation.x = Math.PI / 2 - 0.35;
    cyl(tailSegs[1], 0.23, 0.23, 0.1, 10, 0, 0, -0.06, 0x30373f, { metalness: 0.8 }).rotation.x = Math.PI / 2 - 0.55;
    const t2 = cyl(tailSegs[1], 0.2, 0.16, 1.4, 9, 0, 0, -0.7, hullDk);
    t2.rotation.x = Math.PI / 2 - 0.55;
    const pad = cyl(tailSegs[2], 0.18, 0.14, 0.42, 8, 0, 0, -0.2, 0x23262a);        // 尾端著地墊
    pad.rotation.x = Math.PI / 2;
    cyl(tailSegs[2], 0.15, 0.15, 0.16, 8, 0, 0.04, -0.42, accent, { emissive: accent, emissiveIntensity: 0.8 })
      .rotation.x = Math.PI / 2;
  }

  g.userData.rig = {
    kind: 'biped', hips, chest, neck, head, legL, legR, armL, armR,
    legChainL, legChainR, armChainL, armChainR,
    tailSegs: tailSegs.length ? tailSegs : null,
    hipsY0: hipY, headY0: head.position.y, stride: P.stride, bob: P.bob, sway: P.sway,
    // 指節行走的前肢是前腳:gunArm 收斂會讓右前腳不擺 —— 猩猩不吃持械手穩定
    top: P.top, gunArm: !P.knuckle, leanF: P.lean, tailUp: P.tailUp, armBase: P.armBase || 0,
    bound: P.bound, hop: P.hop, hopLean: P.hopLean, hopH: P.hopH,   // 跳奔/袋鼠跳(見 BIPED 表)
    knuckle: P.knuckle, grounded: P.grounded, tuckArms: P.tuckArms, // 指節行走/貼地跑(見 BIPED 表)
    tinyArms: P.tinyArms,   // 退化短前臂(暴龍):只做抓握狀微顫,不套用一般雙足擺臂公式
  };
  return g;
}

// ---------- 傭兵變形機甲(雙型態分段姿勢系統)----------
const clamp01 = (t) => Math.max(0, Math.min(1, t));
/**
 * 分段姿勢插值器(doc/transformer_plan.html Task 2.1):
 * 每個部件掛 { a 地面姿勢, b 飛行姿勢, s0..s1 變形時窗 },以 smoothstep
 * 非線性緩動在自己的時窗內滑動到位 — 不同部件時窗錯開 = Macross 式
 * 「翼先展 → 腿後收 → 機首鎖上」多段序列,徹底消除剛性瞬跳。
 */
function makePoser(parts) {
  return (m) => {
    for (const p of parts) {
      const t = clamp01((m - p.s0) / (p.s1 - p.s0));
      const e = t * t * (3 - 2 * t);   // smoothstep(貝茲緩動)
      p.t = e;
      if (p.a.p) p.g.position.set(
        p.a.p[0] + (p.b.p[0] - p.a.p[0]) * e,
        p.a.p[1] + (p.b.p[1] - p.a.p[1]) * e,
        p.a.p[2] + (p.b.p[2] - p.a.p[2]) * e);
      if (p.a.r) p.g.rotation.set(
        p.a.r[0] + (p.b.r[0] - p.a.r[0]) * e,
        p.a.r[1] + (p.b.r[1] - p.a.r[1]) * e,
        p.a.r[2] + (p.b.r[2] - p.a.r[2]) * e);
    }
  };
}

/**
 * 傭兵變形機甲(hero:morph)— 飛行/地面剪影顯著不同的雙型態程序模型。
 * 兩類等比例(4/4),原型迴避無人機/機器人陣營既有生物(蜂/翼龍/飛龍/鷹/猩猩/暴龍/獵犬…):
 *  A 類 定翼/旋翼 ↔ 人形雙足:vis.flight = 'jet' 鴨翼戰機(腿收攏成中置雙發機艙、
 *       骨盆後緣展開後掠雙垂尾)|'uav' 長直翼無人機(腿外張成雙尾桁、桁端大型 V 尾)
 *       |'heli' 單旋翼突擊直升機(尾桁自背後展開)|'tilt' 傾轉旋翼母艦
 *       (地面 = 旋翼盤收在雙拳側邊作圓盾;飛行 = 手臂展開成雙翼、槳盤傾轉至翼端水平)。
 *  B 類 擬態翼 ↔ 四足獸:'levi' 利維坦飛鯨 ↔ vis.ground:'elephant' 機械巨象(象鼻收平=船首撞角)
 *       |'archo' 始祖鳥 ↔ 'raptor' 迅猛龍|'beetle' 犀金龜(盾狀鞘翅外開讓出膜翅)
 *       |'owl' 夜梟(鋸齒消音羽)↔ 'panther' 夜豹。vis.bulk 體格倍率。
 * 四足獸地面型 = 真獸類水平體軸(不是前傾的人形):軀幹放平(θg 接近 cruise)、
 * 前肢(肩部)/後腿(骨盆)各以 −θg 反轉垂放成四腳(QUAD 表逐獸調步姿)、
 * 頭部反轉抬起前視、翼沿背脊向後收折(鳥類收翼式)。
 * 四足獸變形序列(地面→飛行,分段時窗錯開):尾拉直配平(0.08)→ 鞘翅外開
 * (0.15,僅犀金龜)→ 前腳離地收攏貼腹(0.2)→ 體軸調至巡航俯仰(0.25)→
 * 主翼後掠展開(0.35)→ 外翼腕節展開(0.5)→ 後腿蹬離收成尾艙(0.5)→
 * 頭頸前伸鎖定 + 尾羽扇/水平尾鰭展開(0.55~1)。
 * 空氣動力學鐵則(mobility_plan):飛行型態所有升力面(定翼翼面/旋翼槳盤/擬態翼面/
 * 水平尾鰭)一律以 −cruise 反向補償軀幹俯仰 → 貼平地面,只留微小攻角 AOA;
 * MUST NOT 讓翼面跟著機身立起來(舊實作的根因缺陷)。
 * 變形機構(參考 doc/mech_trans_0x 可變戰機分解圖):脊椎軸 = 航向軸 —
 * 軀幹前傾放平成機身、機首錐自背部滑出鎖上縮入的頭部(Sheet 02)、
 * 背翼內外兩段展開(Sheet 03)、雙腿後收併攏成尾部發動機艙(Sheet 01)、
 * 手臂貼艙(Sheet 04)、垂直安定面最後自足跟展開鎖定(Sheet 05)。
 * 型態參數 0(地面)→1(飛行)由 locomotion stepMorph 依伺服器回報高度
 * heroY 推導 — 遠端玩家/bot 的變形不需要額外網路訊息;變形進行中
 * 關節排氣口增亮(Phase 3 熱散逸),完成震波由 game.js _morphLaunch/_morphLand 演出。
 */
function buildMorphMech(side, vis) {
  const g = new THREE.Group();
  const accent = new THREE.Color(vis?.hue ?? SIDES[side].color);
  const F = vis?.flight || 'jet';
  const G = vis?.ground || 'biped';
  const beast = !MORPH_HUMANOID.has(G);
  const FIXED = F === 'jet' || F === 'uav';
  const B = vis?.bulk || 1;
  const PAL = heroPalette(vis, side, 'dark');
  const hull = PAL.main, hullDk = PAL.mid, plate = PAL.lite;
  const parts = [], vents = [], thrusters = [], flapWings = [], rotors = [], jets = [];
  const P = (grp, a, b, s0, s1) => { const p = { g: grp, a, b, s0, s1, t: 0 }; parts.push(p); return p; };
  const vent = (parent, w, h, d, x, y, z) => {
    const v = bx(parent, w, h, d, x, y, z, 0x1c2126, { emissive: 0xff8a3c, emissiveIntensity: 0.15 });
    vents.push(v);
    return v;
  };
  const noz = (parent, rt, rb, h, x, y, z) => {
    const t = cyl(parent, rt, rb, h, 8, x, y, z, 0x1c1f22, { emissive: 0xffa04d, emissiveIntensity: 0.25, metalness: 0.7 });
    thrusters.push(t);
    return t;
  };

  // 悟空(G='monkey')飛行不變形成飛機:機體本身就是飛行型 —— 展開光之翼(不揮動的
  // 噴焰翼)、雙腿併攏、體軸壓平近水平、尾巴蠍式前捲把端點巨砲轉向正前方(命運鋼彈式)
  const WUKONG = G === 'monkey';
  // ---- 軀幹(機身核心):地面站姿(各獸型自己的蹲伏角)↔ 飛行放平(脊椎軸轉為航向軸)----
  // cruise = 飛行俯仰角;升力面/尾鰭以 −cruise 反轉抵銷(僅留 AOA 攻角)= 翼面恆平行地面
  const cruise = WUKONG ? 1.5
    : { jet: 1.35, uav: 1.3, heli: 1.42, tilt: 1.38, levi: 1.32, archo: 1.15, beetle: 0.92, owl: 1.18 }[F] ?? 1.3;
  const AOA = 0.08;
  // 四足獸步姿表 [軀幹高, 體軸俯仰θg, 後腿前傾, 小腿後折, 腿外撇, 前肢前傾, 前肘回折, 上臂長, 前臂長,
  //               後踝(跗節)角, 前腕(掌節)角]:巨象柱狀直腿(關節近乎打直)、
  // 夜豹 Z 形屈腿掠行(跗節深折 = 趾行)、犀金龜低伏外撇(昆蟲步姿);
  // 迅猛龍是「雙足」獸:前肢不落地 —— 小短臂深屈收在胸前蓄勢(grounded running,
  // 雙腿跑、前爪隨時出手),臂長也照獸類縮短
  const QUAD = {
    elephant: [2.05, 1.2, 0.06, 0.08, 0, 0.05, 0.02, 0.85, 0.85, -0.06, -0.04],
    raptor: [1.9, 1.25, 0.5, 0.85, 0, -0.65, -1.7, 0.5, 0.55, -0.55, 0.35],
    beetle: [1.5, 1.45, 0.35, 0.6, 0.45, 0.25, 0.35, 0.78, 0.82, -0.42, -0.32],   // 體軸平行地面
    panther: [1.9, 1.3, 0.45, 0.8, 0, 0.15, 0.28, 0.75, 0.8, -0.5, -0.28],
  }[G];
  // 人形地面型站姿表(同索引語意,再多 [9] 踝角 / [10] 站距):四台人形傭兵各有自己的體態,
  // MUST NOT 退回單一站姿。狼人趾行深屈、吸血鬼挺立(披風即機翼)、負重型前傾寬站(雙肩貨運掛架)、
  // 猿猴(齊天大聖)= 掌行四足(palmigrade):體軸深前傾、長臂垂直落地、手掌平貼地面
  const HUM = {
    biped: [2.0, 0, 0, 0.04, 0, 0.04, -0.12, 0.6, 0.6, 0, 0.42],
    wolf: [2.12, 0.26, -0.3, 0.66, 0, 0.3, -0.55, 0.7, 0.74, -0.42, 0.46],
    vampire: [2.14, -0.05, 0.02, 0.06, 0, -0.08, -0.3, 0.64, 0.64, -0.02, 0.4],
    monkey: [1.62, 0.72, -0.62, 0.72, 0, -0.6, -0.18, 1.42, 1.5, -0.12, 0.5],
    atlas: [2.02, 0.16, 0.06, 0.14, 0, 0.2, -0.35, 0.66, 0.66, -0.08, 0.5],
  }[G] || [2.0, 0, 0, 0.04, 0, 0.04, -0.12, 0.6, 0.6, 0, 0.42];
  const stance = QUAD ? [QUAD[0], QUAD[1]] : [HUM[0], HUM[1]];
  const torso = new THREE.Group();
  g.add(torso);
  P(torso, { p: [0, stance[0], 0], r: [stance[1], 0, 0] },
    { p: [0, 2.7, 0], r: [cruise, 0, 0] }, beast ? 0.25 : 0.3, beast ? 0.9 : 0.95);
  bx(torso, 1.1 * B, 0.5, 0.85, 0, 0.02, 0, hullDk);                                   // 骨盆
  bx(torso, 1.45 * B, 1.0, 0.95, 0, 0.82, 0.03, hull, { metalness: 0.6 });             // 胸艙
  bx(torso, 1.0 * B, 0.14, 0.1, 0, 0.95, 0.52, accent, { emissive: accent, emissiveIntensity: 1.1 });  // 胸前識別燈
  bx(torso, 0.62 * B, 0.4, 0.24, 0, 1.3, 0.36, dim(hull, 0.85));                       // 領口/艙蓋
  for (const sx of [-1, 1]) bx(torso, 0.18, 0.55, 0.5, sx * 0.62 * B, 0.82, 0.26, dim(hull, 0.8));  // 進氣口
  vent(torso, 0.5 * B, 0.12, 0.1, 0, 0.32, 0.44);                                      // 腰部排氣口
  // 背部推進器(飛行主推;地面朝下 = VTOL 懸停感)
  bx(torso, 0.9 * B, 0.7, 0.35, 0, 0.75, -0.6, hullDk);                                // 背包
  for (const sx of [-1, 1]) {
    const t = noz(torso, 0.15, 0.19, 0.5, sx * 0.32 * B, 0.35, -0.62);
    t.rotation.x = 0.4;
  }
  // 四足獸背脊識別條(地面 = 獸背、飛行 = 機背頂面;胸燈放平後朝腹面看不見)
  if (beast) bx(torso, 0.16 * B, 0.9, 0.05, 0, 0.7, -0.79, accent, { emissive: accent, emissiveIntensity: 0.9 });
  // 圓角獸軀(迅猛龍/夜豹,2026-07-12 圓角化):掠食者的流線胸腹 —— 單一圓角膠囊
  // 蓋住方正胸艙(單一量體無胸腹接縫,不需平面接合環)
  if (G === 'raptor' || G === 'panther') {
    const bod = new THREE.Mesh(new THREE.CapsuleGeometry(0.6 * B, 0.75, 4, 12), mat(hull, { metalness: 0.55 }));
    bod.scale.set(1.22, 1, 0.85);   // 完整罩住方正胸艙(寬 1.46B、深 1.02)—— 圓臀融進尾根
    bod.position.set(0, 0.62, 0);
    torso.add(bod);
  }

  // ---- 頭(+ 頸):航空器類(定翼/旋翼)飛行時縮入機身;擬態獸類前伸迎風。
  // 四足獸的頭一律以 −pitch 反轉:地面抬頭前視(0.25 − θg)、飛行吻部沿航向軸(0.15 − cruise)----
  const head = new THREE.Group();
  torso.add(head);
  let trunk = null, trunkTip = null;   // 機械巨象象鼻(僅 F==='levi' 賦值),供 stepMorph 逐幀驅動
  // 悟空的頭飛行時不縮入機身:抬頭鎖定前方(超人式飛行,臉朝航向)
  const headF = WUKONG ? [0, 1.62, 0.02]
    : { levi: [0, 2.0, 0.08], archo: [0, 1.95, 0.04], beetle: [0, 1.72, 0.08], owl: [0, 1.9, 0.06] }[F];
  P(head,
    beast ? { p: [0, 1.66, -0.2], r: [0.25 - stance[1], 0, 0] } : { p: [0, 1.6, 0.06], r: [0, 0, 0] },
    headF ? { p: headF, r: [0.15 - cruise, 0, 0] } : { p: [0, 1.38, -0.04], r: [-0.5, 0, 0] },
    0.55, 0.95);
  if (F === 'levi') {
    // 巨象顱 ↔ 利維坦船首:碩大流線顱(鯨式圓弧額隆,不是方塊)+ 象牙 + 象鼻
    // (地面下垂 → 飛行收平 = 船首撞角)。耳甲不在頭上 —— 它就是胸鰭(見升力面段)。
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.52 * B, 14, 10), mat(plate, { metalness: 0.6 }));
    skull.scale.set(1.05, 0.92, 1.55);                                                  // 前後拉長的流線顱
    skull.position.set(0, 0.06, 0.14);
    head.add(skull);
    const melon = new THREE.Mesh(new THREE.SphereGeometry(0.36 * B, 12, 9), mat(dim(plate, 1.05), { metalness: 0.6 }));
    melon.scale.set(0.95, 0.8, 1.15);
    melon.position.set(0, 0.26, 0.42);                                                  // 額隆(圓弧破風面)
    head.add(melon);
    bx(head, 0.5 * B, 0.09, 0.07, 0, 0.14, 0.52, accent, { emissive: accent, emissiveIntensity: 1.4 });  // 眼列
    for (const sx of [-1, 1]) {
      const jowl = new THREE.Mesh(new THREE.SphereGeometry(0.26 * B, 10, 8), mat(hull, { metalness: 0.55 }));
      jowl.scale.set(0.7, 0.9, 1.5);
      jowl.position.set(sx * 0.34 * B, -0.14, 0.24);                                    // 頰部收束(頭→頸的流線過渡)
      head.add(jowl);
      const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.85, 6), mat(0xe8e4d8, { metalness: 0.6 }));
      tusk.position.set(sx * 0.26 * B, -0.3, 0.5);
      tusk.rotation.x = 1.35;
      head.add(tusk);
    }
    trunk = new THREE.Group();
    trunk.position.set(0, -0.12, 0.34);
    head.add(trunk);
    P(trunk, { p: null, r: [1.35, 0, 0] }, { p: null, r: [0.12, 0, 0] }, 0.45, 0.9);
    bx(trunk, 0.2 * B, 0.2, 0.7, 0, 0, 0.32, hullDk);                                   // 象鼻根段
    trunkTip = new THREE.Group();
    trunkTip.position.set(0, 0, 0.64);
    trunk.add(trunkTip);
    P(trunkTip, { p: null, r: [0.7, 0, 0] }, { p: null, r: [0.05, 0, 0] }, 0.5, 0.95);
    bx(trunkTip, 0.15 * B, 0.15, 0.55, 0, 0, 0.26, 0x2a2e33);                           // 象鼻端段
  } else if (F === 'archo') {
    // 迅猛龍顱 ↔ 始祖鳥:楔形吻 + 齒列 + 後掠羽冠
    bx(head, 0.4 * B, 0.34, 0.4, 0, 0.06, 0, plate, { metalness: 0.5 });                // 顱殼
    bx(head, 0.26 * B, 0.2, 0.55, 0, -0.02, 0.42, hullDk);                              // 楔形吻
    bx(head, 0.28 * B, 0.05, 0.42, 0, -0.11, 0.42, 0xe8e4d8);                           // 齒列
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.5 }));
      eye.position.set(sx * 0.17 * B, 0.12, 0.18);
      head.add(eye);
    }
    for (let i = 0; i < 3; i++) {
      const f = bx(head, 0.05, 0.08, 0.42, 0, 0.2 + i * 0.05, -0.26 - i * 0.05, i === 1 ? accent : 0x2a2e33);  // 羽冠
      f.rotation.x = -0.5 - i * 0.22;
    }
    bx(head, 0.24 * B, 0.5, 0.3, 0, -0.36, -0.08, hullDk);                              // 頸筒
  } else if (F === 'beetle') {
    // 犀金龜:小顱 + Y 形犀角(地面衝角 / 飛行破風桅)
    bx(head, 0.36 * B, 0.3, 0.36, 0, 0.02, 0.04, plate, { metalness: 0.6 });            // 顱殼
    bx(head, 0.3 * B, 0.08, 0.06, 0, 0.06, 0.24, accent, { emissive: accent, emissiveIntensity: 1.5 });  // 複眼列
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.09 * B, 1.05, 6), mat(0x2a2e33, { metalness: 0.7 }));
    horn.position.set(0, 0.44, 0.32);
    horn.rotation.x = 0.9;
    head.add(horn);
    bx(head, 0.36 * B, 0.06, 0.16, 0, 0.84, 0.62, 0x2a2e33, { metalness: 0.7 });        // 角端分叉
  } else if (F === 'owl') {
    // 夜豹顱 ↔ 夜梟面盤:圓吻 + 立耳 + 面盤環 + 大眼
    bx(head, 0.46 * B, 0.36, 0.42, 0, 0.05, 0, plate, { metalness: 0.5 });              // 顱殼
    bx(head, 0.26 * B, 0.16, 0.2, 0, -0.06, 0.28, hullDk);                              // 圓吻
    const disc = cyl(head, 0.3 * B, 0.3 * B, 0.05, 12, 0, 0.08, 0.16, dim(plate, 0.75));
    disc.rotation.x = Math.PI / 2;                                                       // 面盤(貼臉淺盤)
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.6 }));
      eye.position.set(sx * 0.14 * B, 0.12, 0.24);
      head.add(eye);
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.28, 5), mat(hullDk, { metalness: 0.5 }));
      ear.position.set(sx * 0.18 * B, 0.32, -0.05);
      ear.rotation.x = -0.35;
      head.add(ear);
    }
  } else {
    bx(head, 0.56 * B, 0.4, 0.52, 0, 0.06, 0, hullDk);                                  // 機甲頭
    bx(head, 0.42 * B, 0.11, 0.08, 0, 0.1, 0.29, accent, { emissive: accent, emissiveIntensity: 1.5 });  // 面罩感測條
    bx(head, 0.2 * B, 0.1, 0.1, 0, -0.12, 0.26, 0x23262a);                              // 下顎
  }

  // ---- 機首錐(戰機/UAV):地面收納於背後(錐尖朝下),飛行滑出鎖上頭部 = 機鼻。
  // 悟空不用機鼻 —— 牠飛行時就是牠自己 ----
  if (FIXED && !WUKONG) {
    const nose = new THREE.Group();
    torso.add(nose);
    P(nose, { p: [0, 0.9, -0.72], r: [-2.45, 0, 0] }, { p: [0, 1.72, 0.04], r: [0, 0, 0] }, 0.45, 0.95);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.42 * B, 1.6, F === 'jet' ? 4 : 8),
      mat(hull, { metalness: 0.6 }));
    if (F === 'jet') cone.rotation.y = Math.PI / 4;
    cone.position.y = 0.8;
    nose.add(cone);
    const canopy = bx(nose, 0.3 * B, 0.12, 0.5, 0, 0.35, 0.24, accent, { emissive: accent, emissiveIntensity: 0.7 });
    canopy.rotation.x = 0.15;                                                            // 座艙罩識別
  } else if (F === 'heli') {
    const chin = cyl(torso, 0.13, 0.13, 0.32, 8, 0, 0.3, 0.52, 0x14171a, { metalness: 0.85 });
    chin.rotation.x = Math.PI / 2;                                                       // 機首感測/機砲塔
  }

  // ---- 升力面:地面豎折於背後 → 飛行內外兩段展開(Sheet 03)。
  // 翼根飛行姿勢 r.x = AOA − cruise:反向補償軀幹俯仰 → 翼面恆接近平行地面(真實機翼設計)----
  const span = ({ jet: 2.4, uav: 3.2, heli: 1.5, tilt: 0, levi: 3.6, archo: 2.6, beetle: 2.3, owl: 2.8 }[F] ?? 2.5) * (0.8 + 0.2 * B);
  const sweep = { jet: 0.5, uav: 0.08, heli: 0, levi: 0.28, archo: 0.3, beetle: 0.12, owl: 0.22 }[F] ?? 0.25;
  // tilt 的翼 = 手臂本體(見 mkArm);heli(渡鴉)無翼 —— 升力全由三旋翼提供;
  // 悟空無硬翼 —— 升力/推力全由背後展開的光之翼(噴焰翼,見下)提供
  if (F !== 'tilt' && F !== 'heli' && !WUKONG) for (const sgn of [-1, 1]) {
    const w = new THREE.Group();
    // 利維坦:升力面就是象耳 —— 樞軸前移到頭後(耳根),地面垂折成大象耳、飛行展開成胸鰭
    const LEVI = F === 'levi';
    w.position.set(sgn * 0.5 * B, LEVI ? 1.35 : 1.05, LEVI ? 0.15 : -0.42);
    torso.add(w);
    // 人形:翼豎折於背後;四足獸:翼以 −θg 放平 + 向後掠收貼背脊(鳥類收翼式),
    // 變形 = 前腳收完(0.35 起)才後掠展開,外翼腕節(0.5 起)最後張到位
    // 象耳的地面姿勢:r.x = −θg 抵銷軀幹俯仰、r.z = ∓90° 把翼展軸轉成鉛直
    // → 耳面垂掛於頭側、扇面朝外(世界座標下真的是「垂下來的大象耳朵」)
    P(w, LEVI ? { p: null, r: [0.05 - stance[1], 0, -sgn * 1.45] }
      : beast ? { p: null, r: [0.2 - stance[1], sgn * 1.15, 0] } : { p: null, r: [0.5, 0, sgn * 1.3] },
      { p: null, r: [AOA - cruise, sgn * -sweep, 0] }, beast ? 0.35 : 0.05, beast ? 0.75 : 0.5);
    const outer = new THREE.Group();
    outer.position.set(sgn * span * 0.42, 0, 0);
    w.add(outer);
    // 象耳地面時外半段往回折(耳廓對折)→ 垂掛長度砍半,不會拖到地上;展開後即完整胸鰭
    P(outer, LEVI ? { p: null, r: [0, 0, -sgn * 2.4] } : beast ? { p: null, r: [0, sgn * 2.3, 0] } : { p: null, r: [0, 0, sgn * 2.5] },
      { p: null, r: [0, 0, sgn * 0.06] }, beast ? 0.5 : 0.22, beast ? 0.9 : 0.62);
    if (LEVI) {
      // 象耳 → 利維坦胸鰭:寬弦扇形耳面(前緣厚、後緣薄)+ 圓端外鰭 + 耳廓/鰭緣主色鑲邊
      bx(w, span * 0.45, 0.1, 1.35, sgn * span * 0.21, 0, -0.15, hull, { metalness: 0.55 });
      bx(w, span * 0.44, 0.05, 0.35, sgn * span * 0.21, -0.03, -0.9, dim(hull, 0.85));  // 耳後緣薄膜(垂折時的耳垂)
      bx(w, span * 0.4, 0.06, 0.2, sgn * span * 0.19, 0.04, 0.55, accent, { emissive: accent, emissiveIntensity: 0.7 });  // 前緣識別
      bx(outer, span * 0.42, 0.08, 1.0, sgn * span * 0.2, 0, -0.12, plate, { metalness: 0.55 });
      bx(outer, span * 0.16, 0.06, 0.66, sgn * span * 0.43, 0, -0.08, dim(plate, 0.8));  // 圓端鰭梢
      bx(outer, span * 0.4, 0.05, 0.12, sgn * span * 0.2, 0.03, -0.62, accent, { emissive: accent, emissiveIntensity: 0.5 });  // 鰭緣鑲邊
      flapWings.push({ w, outer, sgn });
    } else if (F === 'archo') {
      // 始祖鳥羽翼(2026-07-12 羽化):放射扇佈羽(參照悟空光翼的火光方向),
      // 覆羽扇聚翼根、初級飛羽扇聚腕點,羽尖向外後方張開;每片是羽毛形圓角羽片
      bx(w, span * 0.4, 0.06, 0.22, sgn * span * 0.2, 0.01, 0.06, plate, { metalness: 0.4 });   // 翼骨前緣
      for (let i = 0; i < 3; i++)
        feather(w, span * (0.3 - i * 0.03), 0.15, sgn * 0.04, -0.01 - i * 0.012, -0.02 - i * 0.05,
          0.3 + i * 0.24, sgn, i === 1 ? dim(accent, 0.8) : 0x2a2e33, { metalness: 0.35 });
      for (let i = 0; i < 4; i++)
        feather(outer, span * (0.42 - i * 0.04), 0.13, 0, i * 0.012, -0.02 - i * 0.03,
          0.2 + i * 0.26, sgn, i === 1 ? accent : 0x2a2e33, { metalness: 0.3 });
      flapWings.push({ w, outer, sgn });
    } else if (F === 'owl') {
      // 夜梟羽翼(2026-07-12 羽化):寬圓消音羽的放射扇 —— 羽片寬、深淺交錯
      // (鋸齒消音的錯層),同樣自翼根/腕點向外後方張開
      bx(w, span * 0.4, 0.06, 0.24, sgn * span * 0.2, 0.01, 0.05, plate, { metalness: 0.35 });  // 翼骨前緣
      for (let i = 0; i < 3; i++)
        feather(w, span * (0.32 - i * 0.03), 0.24, sgn * 0.04, -0.01 - i * 0.012, -0.04 - i * 0.06,
          0.32 + i * 0.22, sgn, i % 2 ? dim(plate, 0.72) : dim(plate, 0.95), { metalness: 0.3 });
      for (let i = 0; i < 5; i++)
        feather(outer, span * (0.4 - i * 0.03), 0.2, 0, i * 0.012, -0.03 - i * 0.03,
          0.22 + i * 0.22, sgn, i === 2 ? accent : i % 2 ? 0x2a2e33 : dim(plate, 0.8), { metalness: 0.3 });
      flapWings.push({ w, outer, sgn });
    } else if (F === 'beetle') {
      // 犀金龜膜翅(半透明:outlinify 自動跳過描邊);鞘翅=盾甲另在背部(見下)
      bx(w, span * 0.45, 0.05, 0.1, sgn * span * 0.21, 0.01, 0.28, hullDk, { metalness: 0.6 });  // 前緣翅脈
      bx(w, span * 0.45, 0.03, 0.8, sgn * span * 0.21, 0, -0.14, accent,
        { transparent: true, opacity: 0.4, emissive: accent, emissiveIntensity: 0.35 });
      bx(outer, span * 0.4, 0.03, 0.6, sgn * span * 0.19, 0, -0.12, accent,
        { transparent: true, opacity: 0.4, emissive: accent, emissiveIntensity: 0.35 });
      flapWings.push({ w, outer, sgn });
    } else {
      // 戰機後掠翼 / UAV 長直翼(翼尖主色識別)
      bx(w, span * 0.46, 0.08, F === 'uav' ? 0.6 : 0.85, sgn * span * 0.21, 0, -0.1, hull, { metalness: 0.6 });
      bx(outer, span * 0.4, 0.06, F === 'uav' ? 0.45 : 0.6, sgn * span * 0.19, 0, -0.08, plate, { metalness: 0.6 });
      bx(outer, span * 0.16, 0.05, F === 'uav' ? 0.4 : 0.5, sgn * span * 0.4, 0.02, -0.06, accent,
        { emissive: accent, emissiveIntensity: 0.9 });
    }
  }

  // ---- 腹鰭(利維坦):腹面 = 軀幹局部 +z(飛行時 torso 以 cruise 放平 → +z 朝下)。
  // 地面收貼腹甲(象腹的護板)→ 飛行外張下探成縱向穩定鰭 ----
  if (F === 'levi') for (const sgn of [-1, 1]) {
    const vf = new THREE.Group();
    vf.position.set(sgn * 0.38 * B, 0.3, 0.42);
    torso.add(vf);
    P(vf, { p: null, r: [0, 0, sgn * 1.5] }, { p: null, r: [0.15, sgn * -0.3, sgn * -0.45] }, 0.4, 0.9);
    bx(vf, 0.95 * B, 0.07, 0.62, sgn * 0.45 * B, 0, 0.02, plate, { metalness: 0.5 });
    bx(vf, 0.34 * B, 0.05, 0.4, sgn * 0.92 * B, 0.01, -0.02, dim(plate, 0.8));          // 鰭梢
    bx(vf, 0.8 * B, 0.05, 0.1, sgn * 0.42 * B, 0.03, 0.3, accent, { emissive: accent, emissiveIntensity: 0.6 });  // 前緣識別
  }

  // ---- 鞘翅(犀金龜):地面閉合成背盾 → 變形最先外開上掀讓出膜翅(盾牌→翅罩)。
  // 2026-07-12 圓角化:腹部/鞘翅全改「圓角矩形」膠囊 —— 甲蟲的身軀沒有直角;
  // 體軸放平(stance θg=1.45)後,性格花紋的 triplanar 投影自然跟著平行地面 ----
  if (F === 'beetle') {
    const abd = new THREE.Mesh(new THREE.CapsuleGeometry(0.6 * B, 1.15, 4, 12), mat(hull, { metalness: 0.55 }));
    abd.scale.set(1, 1, 0.75);
    abd.position.set(0, 0.6, -0.04);
    torso.add(abd);                                                                       // 圓角腹部(蓋住方正胸艙)
    for (const sgn of [-1, 1]) {
      const ely = new THREE.Group();
      ely.position.set(sgn * 0.1 * B, 1.3, -0.52);
      torso.add(ely);
      P(ely, { p: null, r: [0, 0, sgn * 0.08] }, { p: null, r: [-0.5, sgn * 0.7, sgn * 1.5] }, 0.15, 0.5);
      const sh = new THREE.Mesh(new THREE.CapsuleGeometry(0.31 * B, 0.9, 4, 10), mat(plate, { metalness: 0.65 }));
      sh.scale.set(1, 1, 0.24);
      sh.position.set(sgn * 0.28 * B, -0.68, 0);
      ely.add(sh);                                                                        // 圓角盾狀鞘翅
      bx(ely, 0.5 * B, 0.12, 0.14, sgn * 0.28 * B, -1.34, 0.01, accent, { emissive: accent, emissiveIntensity: 0.8 });  // 甲緣識別
    }
  }

  // ---- 旋翼:通用旋翼組(桅 + 槳轂 + 摺疊槳葉)。地面槳葉扇形收攏、飛行等角展開;
  // gr / fr = 桅的地面/飛行姿勢(飛行一律反向補償上游俯仰 → 槳盤恆平行地面)----
  const mkRotor = (parent, pos, gr, fr, n, rad, dir, s0, f = 1) => {
    const root = new THREE.Group();
    root.position.set(pos[0], pos[1], pos[2]);
    parent.add(root);
    P(root, { p: null, r: gr }, { p: null, r: fr }, s0, s0 + 0.3);
    cyl(root, 0.1, 0.13, 0.42, 8, 0, 0.16, 0, hullDk, { metalness: 0.7 });               // 旋翼桅
    const spinner = new THREE.Group();
    spinner.position.set(0, 0.42, 0);
    root.add(spinner);
    cyl(spinner, 0.16, 0.16, 0.14, 8, 0, 0, 0, 0x1c2126, { metalness: 0.8 });            // 槳轂
    for (let i = 0; i < n; i++) {
      const bl = new THREE.Group();
      spinner.add(bl);
      // 地面:槳葉扇形收攏指向同一側(貼著桅收納);飛行:等角展開成槳盤
      P(bl, { p: null, r: [0, -Math.PI / 2 + (i - (n - 1) / 2) * 0.22, 0] },
        { p: null, r: [0, (Math.PI * 2 * i) / n, 0] }, s0 + 0.18, 1);
      bx(bl, rad, 0.05, 0.17, rad / 2 + 0.12, 0, 0, hullDk, { metalness: 0.6 });
      bx(bl, rad * 0.18, 0.06, 0.18, rad * 0.94, 0.01, 0, accent, { emissive: accent, emissiveIntensity: 0.9 });  // 槳尖識別
    }
    rotors.push({ g: spinner, dir, f });
    return root;
  };
  if (F === 'heli') {
    // 渡鴉三旋翼(2026-07-11 重構):披風翼/短翼掛架/尾桁全數移除 ——
    // 升力 = 機首桅旋翼(Y 字前端)+ 雙腿末端旋翼(mkLeg 的 heli 分支,Y 字兩後臂)。
    // 地面型態:機首桅向後折收貼背(槳葉收攏),與腿旋翼一起「收起」;
    // 飛行型態:軀幹放平(cruise)、桅反轉指天(−cruise)→ 槳盤水平、恰在機首前上方
    mkRotor(torso, [0, 1.75, -0.45], [-1.2, 0, 0], [-cruise, 0, 0],
      3, 1.0 * (0.9 + 0.1 * B), 1, 0.5);
  }

  // ---- 腿:地面站立(獸型屈膝蹲伏)→ 飛行後收併攏 = 尾部發動機艙(Sheet 01)----
  const mkLeg = (sx) => {
    const leg = new THREE.Group();
    let ankle = null;
    torso.add(leg);
    // 四足獸後腿:−θg 反轉垂放 + 前傾(掠行蓄力)、犀金龜再外撇;變形末段(0.5 起)蹬離收攏。
    // 飛行腿部依機種分化:悟空雙腿併攏繃直(超人式飛行);uav 外張打直 = 雙尾桁;
    // jet 內收貼攏 = 中置雙發機艙;heli(渡鴉)雙腿向後外撇打直 = Y 字旋翼臂;其餘後收貼艙
    const legF = WUKONG ? { p: [sx * 0.14 * B, -0.18, -0.02], r: [0.08, 0, 0] }
      : F === 'uav' ? { p: [sx * 0.55 * B, -0.18, -0.05], r: [0.05, 0, 0] }
      : F === 'jet' ? { p: [sx * 0.16 * B, -0.18, -0.02], r: [0.12, 0, 0] }
      : F === 'heli' ? { p: [sx * 0.5 * B, -0.16, -0.05], r: [0.05, 0, sx * 0.55] }
      : { p: [sx * 0.3 * B, -0.2, -0.05], r: [0.32, 0, 0] };
    P(leg, QUAD ? { p: [sx * 0.42 * B, -0.12, 0.18], r: [-stance[1] - QUAD[2], 0, sx * QUAD[4]] }
      : { p: [sx * HUM[10] * B, -0.12, 0], r: [HUM[2], 0, 0] },
      legF, beast ? 0.5 : 0.35, beast ? 0.9 : 0.8);
    // 身體圓角化的機種(甲蟲/迅猛龍/夜豹)四肢一律圓柱化(CYLG = 粗細倍率)
    const CYLG = { beetle: 1, raptor: 1.35, panther: 1.35 }[G];
    if (CYLG) cyl(leg, 0.13 * B * CYLG, 0.17 * B * CYLG, 0.85, 8, 0, -0.42, 0.02, hull); // 圓柱股節
    else bx(leg, 0.4 * B, 0.85, 0.5, 0, -0.42, 0.02, hull);                             // 大腿
    vent(leg, 0.1, 0.28, 0.28, sx * 0.22 * B, -0.3, 0.12);                              // 髖部排氣口
    const shin = new THREE.Group();
    shin.position.set(0, -0.85, 0);
    leg.add(shin);
    P(shin, { p: null, r: [QUAD ? QUAD[3] : HUM[3], 0, 0] },
      // 定翼:小腿打直 = 尾桁/機艙軸線;heli:打直 = 旋翼臂(Y 字後臂要是直的)
      { p: null, r: [(FIXED || F === 'heli') ? -0.02 : -0.28, 0, 0] },
      beast ? 0.55 : 0.4, beast ? 0.92 : 0.85);
    if (CYLG) cyl(shin, 0.1 * B * CYLG, 0.13 * B * CYLG, 0.8, 8, 0, -0.4, -0.02, hullDk);  // 圓柱脛節
    else bx(shin, 0.3 * B, 0.8, 0.42, 0, -0.4, -0.02, hullDk);                          // 小腿
    // 踝(跗節)分節 —— 全型態一律有,不再把腳掌焊死在小腿上:
    // 人形趾行(狼人/猿猴)踝深屈踩趾、吸血鬼/負重型踩平;四足獸的跗節角走 QUAD[9]
    // (象柱腿近乎打直、迅猛龍/夜豹深折 = 趾行掠食者)。飛行一律腳尖繃直收進機艙。
    ankle = new THREE.Group();
    ankle.position.set(0, -0.82, 0);
    shin.add(ankle);
    // heli 飛行腳尖打直(足掌收成旋翼臂末端整流罩,槳盤在其上方);其餘腳尖繃直 0.3
    P(ankle, { p: null, r: [QUAD ? QUAD[9] : HUM[9], 0, 0] },
      { p: null, r: [F === 'heli' ? 0.02 : 0.3, 0, 0] }, 0.45, 0.9);
    if (G === 'elephant') {
      cyl(ankle, 0.24 * B, 0.28 * B, 0.24, 10, 0, -0.02, 0.04, 0x23262a);               // 柱狀象足
      for (let i = -1; i <= 1; i++) bx(ankle, 0.1 * B, 0.14, 0.1, i * 0.12 * B, -0.08, 0.18, 0xd8d4c8);  // 趾甲
    } else if (G === 'raptor') {
      bx(ankle, 0.28 * B, 0.14, 0.66, 0, 0, 0.16, 0x23262a);                            // 長距足
      const sickle = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.34, 5), mat(0xd8d4c8, { metalness: 0.6 }));
      sickle.position.set(sx * 0.1 * B, 0.1, 0.32);
      sickle.rotation.x = 2.4;                                                          // 鐮刀趾爪(上勾)
      ankle.add(sickle);
    } else if (G === 'panther') {
      bx(ankle, 0.32 * B, 0.18, 0.5, 0, 0.01, 0.1, 0x23262a);                           // 肉墊掌
      bx(ankle, 0.3 * B, 0.08, 0.1, 0, -0.04, 0.36, dim(0x23262a, 1.6));                // 趾列
    } else if (G === 'beetle') {
      const tarsus = new THREE.Mesh(new THREE.ConeGeometry(0.1 * B, 0.42, 6), mat(0x23262a, { metalness: 0.6 }));
      tarsus.position.set(0, -0.14, 0.05);
      tarsus.rotation.x = Math.PI;                                                       // 尖錐跗節
      ankle.add(tarsus);
    } else {
      bx(ankle, 0.36 * B, 0.16, 0.62, 0, -0.02, 0.12, 0x23262a);                        // 足掌
      if (G === 'wolf' || G === 'monkey')
        for (let i = -1; i <= 1; i++)
          bx(ankle, 0.1 * B, 0.1, 0.3, i * 0.11 * B, -0.04, 0.46, 0xd8d4c8);            // 趾爪
    }
    noz(shin, 0.11, 0.14, 0.26, 0, -0.76, -0.28);                                       // 足底噴口(飛行朝後)
    if (F === 'heli') {
      // 渡鴉腿旋翼(Y 字兩後臂端點):地面桅微後傾、槳葉收攏貼小腿後方(= 收起);
      // 飛行桅反轉指天(−(cruise+0.03) 補償 cruise + 腿/小腿殘餘俯仰;腿的外撇是繞
      // 腿根局部 z 軸,實測不歪桅,不需再補側傾)、槳葉展開。
      // 左右反向旋轉互抵扭矩(dir = −sx),與機首旋翼合成三旋翼
      mkRotor(shin, [0, -0.72, -0.18], [-0.55, 0, 0],
        [-(cruise + 0.03), 0, 0], 3, 0.85 * (0.9 + 0.1 * B), -sx, 0.55);
    }
    if (F === 'jet') {
      // 戰機雙發機艙 = 小腿:巡航主推 —— 移動時噴出尾焰(locomotion 依速度驅動)
      jets.push(jetFlame(shin, 0.15 * B, 1.4, 0, -0.92, -0.28, accent));
    }
    if (F === 'uav' && !WUKONG) {
      // 大型 V 尾(雙尾桁桁端):地面貼平小腿收折 → 變形末段翻起外傾鎖定(Sheet 05)
      const fin = new THREE.Group();
      fin.position.set(0, -0.68, -0.2);
      shin.add(fin);
      P(fin, { p: null, r: [-1.5, 0, 0] }, { p: null, r: [1.57, 0, sx * 0.6] }, 0.62, 1);
      bx(fin, 0.07, 1.05, 0.5, 0, -0.5, -0.05, plate, { metalness: 0.6 });
      bx(fin, 0.08, 0.24, 0.46, 0, -1.12, -0.05, accent, { emissive: accent, emissiveIntensity: 0.9 });  // 尾梢識別
    }
    return { leg, shin, ankle };
  };
  const LL = mkLeg(-1), LR = mkLeg(1);
  const legL = LL.leg, legR = LR.leg;

  // ---- 戰機後掠雙垂尾(骨盆後緣,與 UAV 雙尾桁 V 尾做剪影區隔):
  // 地面收折成下背裙甲 → 變形末段立起、外傾 0.35 鎖定(Sheet 05)----
  if (F === 'jet') for (const sx of [-1, 1]) {
    const fin = new THREE.Group();
    fin.position.set(sx * 0.3 * B, -0.28, -0.4);
    torso.add(fin);
    P(fin, { p: null, r: [-1.5, 0, 0] }, { p: null, r: [0.1, -sx * 0.35, 0] }, 0.6, 1);
    const panel = bx(fin, 0.06, 0.55, 1.05, 0, -0.14, -0.5, plate, { metalness: 0.6 });
    panel.rotation.x = 0.3;                                                              // 後掠
    const tip = bx(fin, 0.07, 0.3, 0.4, 0, -0.44, -0.95, accent, { emissive: accent, emissiveIntensity: 0.9 });
    tip.rotation.x = 0.3;                                                                // 尾梢識別
  }

  // ---- 臂:人型垂放(右臂武器莢艙)/ 獸型前肢著地 → 飛行貼艙收攏(Sheet 04)----
  // 前肢:人形 = 手臂;四足獸 = 前腳(肩點內縮到體側、−θg 反轉垂放,
  // 臂長縮短與後腿配平 = 四腳同時觸地),變形最先(0.2 起)離地收攏貼腹。
  // tilt(傾轉旋翼):手臂就是主翼 — 飛行以 Rz(±1.52) 水平展開、AOA − cruise 反轉
  // 補償俯仰 = 翼面平行地面;拳側旋翼盤(地面 = 圓盾)傾轉至翼端槳盤朝上。
  const TILT = F === 'tilt';
  const limb = QUAD ? [1.0, QUAD[7], QUAD[8]] : TILT ? [1.08, 0.78, 0.78] : [1.08, HUM[7], HUM[8]];
  const mkArm = (sx) => {
    const a = new THREE.Group();
    torso.add(a);
    P(a, QUAD ? { p: [sx * 0.6 * B, limb[0], 0.24], r: [-stance[1] - QUAD[5], 0, sx * QUAD[4] * 0.8] }
      : { p: [sx * 0.82 * B, limb[0], 0], r: [HUM[5], 0, sx * -0.05] },
      TILT ? { p: [sx * 0.75 * B, 1.05, -0.08], r: [AOA - cruise, 0, sx * 1.52] }
        : { p: [sx * 0.58 * B, 1.0, -0.06], r: [0.35, 0, sx * 0.18] },
      beast ? 0.2 : TILT ? 0.35 : 0.3, beast ? 0.55 : TILT ? 0.8 : 0.72);
    bx(a, 0.34 * B, 0.28, 0.4, 0, 0.06, 0, plate);                                      // 肩甲
    vent(a, 0.1, 0.14, 0.14, sx * 0.18 * B, 0.06, 0.16);                                // 肩關節排氣口
    // 身體圓角化機種的前肢同樣圓柱化(tilt 除外 —— 手臂就是主翼,翼面必須是板)
    const CYLG = { beetle: 1, raptor: 1.2, panther: 1.3 }[G];
    if (CYLG && !TILT) cyl(a, 0.1 * B * CYLG, 0.13 * B * CYLG, limb[1], 8, 0, -limb[1] / 2 - 0.03, 0.02, hull);  // 圓柱前股
    else bx(a, 0.26 * B, limb[1], 0.32, 0, -limb[1] / 2 - 0.03, 0.02, hull);            // 上臂
    const fore = new THREE.Group();
    fore.position.set(0, -limb[1] - 0.05, 0);
    a.add(fore);
    P(fore, { p: null, r: [QUAD ? QUAD[6] : HUM[6], 0, 0] },
      { p: null, r: [TILT ? 0 : 0.5, 0, 0] },   // tilt:前臂打直延伸翼展
      beast ? 0.22 : TILT ? 0.38 : 0.32, beast ? 0.58 : TILT ? 0.82 : 0.7);
    if (CYLG && !TILT) cyl(fore, 0.08 * B * CYLG, 0.11 * B * CYLG, limb[2], 8, 0, -limb[2] / 2, 0.02, hullDk);  // 圓柱前脛
    else bx(fore, 0.24 * B, limb[2], 0.3, 0, -limb[2] / 2, 0.02, hullDk);               // 前臂
    if (TILT) {
      // 臂外側翼面板(地面 = 臂甲;展開後 = 主翼弦面)+ 前緣識別條
      bx(a, 0.06, limb[1] + 0.2, 0.62, sx * 0.2 * B, -limb[1] / 2, 0.04, hull, { metalness: 0.6 });
      bx(fore, 0.06, limb[2] + 0.15, 0.55, sx * 0.18 * B, -limb[2] / 2, 0.04, plate, { metalness: 0.6 });
      bx(fore, 0.05, limb[2], 0.09, sx * 0.19 * B, -limb[2] / 2, 0.34, accent, { emissive: accent, emissiveIntensity: 0.8 });
      // 拳側旋翼盤:盾面/輪緣/徑肋整盤都掛在 spinner 上 — 地面是圓盾、飛行整盤旋轉
      const rG = new THREE.Group();
      rG.position.set(sx * 0.1 * B, -limb[2] - 0.12, 0.02);
      fore.add(rG);
      P(rG, { p: null, r: [1.57, 0, 0] }, { p: null, r: [0, 0, sx * -1.57] }, 0.55, 0.95);
      const spinner = new THREE.Group();
      rG.add(spinner);
      cyl(spinner, 0.54, 0.54, 0.07, 18, 0, 0, 0, plate, { metalness: 0.6 });           // 盾面(=槳盤)
      cyl(spinner, 0.6, 0.6, 0.04, 18, 0, -0.04, 0, accent, { emissive: accent, emissiveIntensity: 0.8 });  // 輪緣識別
      cyl(spinner, 0.16, 0.22, 0.14, 8, 0, 0.08, 0, 0x1c2126, { metalness: 0.8 });      // 盾心槳轂
      for (let i = 0; i < 4; i++) {
        const bl = new THREE.Group();
        bl.rotation.y = (Math.PI / 2) * i;
        spinner.add(bl);
        bx(bl, 0.78, 0.05, 0.13, 0.39, 0.06, 0, hullDk, { metalness: 0.6 });            // 徑肋(=槳葉,梢端外露)
      }
      rotors.push({ g: spinner, dir: -sx });                                            // 左右反轉互抵扭矩
    }
    // 腕(掌節)分節 —— 人形是手掌、四足獸是前掌;過去焊死在前臂上,現在是真關節:
    // 地面依體態定靜姿角(獸型趾行前掌回折 QUAD[10]、狼人/猿猴抓握微張),飛行一律收平貼艙。
    const hand = new THREE.Group();
    hand.position.set(0, -limb[2] - 0.04, 0);
    fore.add(hand);
    // 猿猴 = 掌行(palmigrade):腕角抵銷上游前傾 → 手掌世界座標下平貼地面
    const handG = QUAD ? QUAD[10] : G === 'monkey' ? 0.06 : G === 'wolf' ? 0.18 : 0.05;
    P(hand, { p: null, r: [handG, 0, 0] }, { p: null, r: [TILT ? 0 : -0.35, 0, 0] },
      beast ? 0.24 : 0.34, beast ? 0.6 : 0.75);
    if (G === 'elephant') {
      cyl(hand, 0.2 * B, 0.24 * B, 0.2, 10, 0, -0.04, 0.04, 0x23262a);                  // 柱狀前足
    } else if (G === 'beetle') {
      const tarsus = new THREE.Mesh(new THREE.ConeGeometry(0.09 * B, 0.36, 6), mat(0x23262a, { metalness: 0.6 }));
      tarsus.position.set(0, -0.1, 0.06);
      tarsus.rotation.x = Math.PI;
      hand.add(tarsus);                                                                  // 尖錐跗節
    } else if (beast) {
      for (let i = -1; i <= 1; i++) bx(hand, 0.09 * B, 0.24, 0.12, i * 0.09 * B, -0.01, 0.1, 0x23262a);  // 爪
    } else if (G === 'monkey') {
      // 掌行的手:平攤的掌面(觸地承重)+ 前伸指列 + 內側拇指 —— 不是握起來的拳
      bx(hand, 0.3 * B, 0.1, 0.4, 0, -0.05, 0.1, 0x30373f);                              // 掌面
      for (let i = -1; i <= 1; i++)
        bx(hand, 0.08 * B, 0.08, 0.26, i * 0.1 * B, -0.06, 0.4, 0xd8d4c8, { metalness: 0.6 });  // 指列
      bx(hand, 0.08 * B, 0.08, 0.2, sx * -0.17 * B, -0.06, 0.12, 0xd8d4c8, { metalness: 0.6 }); // 拇指(內側)
    } else {
      bx(hand, 0.2 * B, 0.2, 0.24, 0, -0.02, 0.04, 0x30373f);                            // 拳
      // 狼人:拳外再張三指利爪
      if (G === 'wolf')
        for (let i = -1; i <= 1; i++) {
          const cl = bx(hand, 0.07 * B, 0.28, 0.12,
            i * 0.09 * B, -0.24, 0.1, 0xd8d4c8, { metalness: 0.6 });
          cl.rotation.z = i * 0.12;
        }
    }
    if (sx > 0) {                                                                       // 右臂武器莢艙
      const pod = cyl(fore, 0.09, 0.11, 0.85, 8, 0.03, -0.35, 0.26, 0x14171a, { metalness: 0.85 });
      pod.rotation.x = Math.PI / 2;
    }
    return { arm: a, fore, hand };
  };
  const AL = mkArm(-1), AR = mkArm(1);
  const armL = AL.arm, armR = AR.arm;

  // ---- 中足對(犀金龜是三對足的昆蟲):圓柱肢(股-脛-跗),地面全數觸地,
  // 與前後足構成 tripod 步態(stepMorph:任一時刻恆有三足著地);
  // 變形時與前腳同窗收攏貼腹 ----
  let midLegs = null, midKnees = null, midTarsi = null;
  if (G === 'beetle') {
    midLegs = []; midKnees = []; midTarsi = [];
    for (const sx of [-1, 1]) {
      const ml = new THREE.Group();
      torso.add(ml);
      P(ml, { p: [sx * 0.5 * B, 0.45, 0.2], r: [-stance[1] - 0.28, 0, sx * 0.55] },
        { p: [sx * 0.32 * B, 0.45, -0.05], r: [0.25, 0, sx * 0.12] }, 0.22, 0.6);
      cyl(ml, 0.12 * B, 0.16 * B, 0.8, 8, 0, -0.38, 0.02, hull);                        // 中股節
      const knee = new THREE.Group();
      knee.position.y = -0.78;
      knee.rotation.x = 0.55;
      ml.add(knee);
      cyl(knee, 0.09 * B, 0.12 * B, 0.75, 8, 0, -0.36, 0, hullDk);                      // 中脛節
      // 跗節(獨立關節,MUST NOT 焊死在脛節上 —— 對照前後足的 ankle 皆為可獨立旋轉的 Group)
      const tarsusJ = new THREE.Group();
      tarsusJ.position.set(0, -0.88, 0.04);
      knee.add(tarsusJ);
      const tar = new THREE.Mesh(new THREE.ConeGeometry(0.09 * B, 0.4, 6), mat(0x23262a, { metalness: 0.6 }));
      tar.rotation.x = Math.PI;
      tarsusJ.add(tar);                                                                 // 尖錐跗節(觸地)
      midLegs.push(ml); midKnees.push(knee); midTarsi.push(tarsusJ);
    }
  }

  // ---- 人形地面型的專屬特徵(四台傭兵各自的體態識別;純外觀,不動 sim 數值)----
  if (G === 'wolf') {
    // 狼人:頸背鬃刺列(蓄勢的立毛)+ 肩尖獠刺 —— 配合趾行深屈站姿的掠食者剪影
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(new THREE.ConeGeometry(0.09 * B, 0.42 - i * 0.05, 5),
        mat(i === 2 ? accent : 0x2a2e33, { metalness: 0.6 }));
      s.position.set(0, 1.35 - i * 0.16, -0.5 - i * 0.06);
      s.rotation.x = -0.6 - i * 0.12;
      torso.add(s);
    }
    for (const sx of [-1, 1]) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.11 * B, 0.6, 5), mat(plate, { metalness: 0.7 }));
      sp.position.set(sx * 0.9 * B, 1.32, -0.1);
      sp.rotation.z = sx * 0.5;
      torso.add(sp);                                                                    // 肩尖獠刺
    }
  } else if (G === 'vampire') {
    // 吸血鬼(渡鴉):高豎立領 + 背脊整流罩 —— 2026-07-11 起披風雙翼移除,
    // 升力全數改由三旋翼提供(機首桅 + 雙腿末端;Y 字構型見 mkRotor / mkLeg 的 heli 分支)
    for (const sx of [-1, 1]) {
      const col = bx(torso, 0.16, 0.9, 0.5, sx * 0.42 * B, 1.5, -0.28, plate, { metalness: 0.6 });
      col.rotation.z = sx * 0.3;                                                         // 立領
    }
    bx(torso, 0.7 * B, 1.1, 0.14, 0, 0.5, -0.62, hullDk, { metalness: 0.5 });            // 背脊整流罩(收納機首桅)
    bx(torso, 0.5 * B, 0.12, 0.15, 0, 1.1, -0.63, accent, { emissive: accent, emissiveIntensity: 0.8 });
  } else if (G === 'atlas') {
    // 負重型:雙肩貨運掛架(轉包的貨都吊在上面)+ 腰際配重塊 = 前傾負重站姿的來源
    for (const sx of [-1, 1]) {
      const py = bx(torso, 0.5 * B, 0.5, 1.5, sx * 0.95 * B, 1.35, -0.35, plate, { metalness: 0.65 });
      py.rotation.z = sx * -0.12;                                                        // 掛載臂
      bx(torso, 0.34 * B, 0.7, 0.34, sx * 1.0 * B, 0.95, -0.8, hullDk);                  // 貨櫃鎖扣
      bx(torso, 0.3 * B, 0.12, 0.3, sx * 1.0 * B, 0.62, -0.8, accent,
        { emissive: accent, emissiveIntensity: 0.9 });                                   // 掛點識別燈
    }
  } else if (G === 'monkey') {
    // 齊天大聖(悟空):額上金箍(緊箍圈:貫穿頭殼的薄金環)+ 斜背如意金箍棒
    // (黑鐵棒身、兩端金箍;斜置收在背後 —— 直立長棒會撐大包圍盒把機體縮小)
    const gold = 0xe8b33a;
    cyl(head, 0.36 * B, 0.36 * B, 0.07, 14, 0, 0.2, 0, gold,
      { metalness: 0.85, emissive: gold, emissiveIntensity: 0.35 });                     // 金箍
    const staff = new THREE.Group();
    staff.position.set(-0.4 * B, 0.95, -0.62);
    staff.rotation.set(-0.15, 0, 0.72);                                                  // 斜背(貼著背板,不垂到腿間)
    torso.add(staff);
    cyl(staff, 0.07, 0.07, 2.4, 8, 0, 0, 0, 0x1a1d20, { metalness: 0.8 });               // 鐵棒身
    for (const oy of [-1.1, 1.1])
      cyl(staff, 0.09, 0.09, 0.26, 8, 0, oy, 0, gold,
        { metalness: 0.85, emissive: gold, emissiveIntensity: 0.5 });                    // 兩端金箍
  }

  // ---- 悟空光之翼(命運鋼彈 Spec II + 宙斯裝備式):背後兩束「不揮動」的噴焰翼 ——
  // 地面垂收熄滅、飛行外展成固定張角的焰刃扇;焰刃是透明發光件(不吃塗裝、不描邊),
  // 長度/亮度由 locomotion 依速度驅動(越快越長越烈)----
  let lightWings = null;
  const lightWingRoots = [];
  if (WUKONG) {
    lightWings = [];
    for (const sx of [-1, 1]) {
      const root = new THREE.Group();
      root.position.set(sx * 0.34 * B, 1.3, -0.52);
      torso.add(root);
      lightWingRoots.push(root);
      // 地面:翼束垂收背後;飛行:向側後「上」方展開(世界座標上揚 —— 軀幹已壓平 1.5,
      // 翼根再 +0.5 ⇒ 焰刃方向 ≈ 上後 45°的固定張角,絕不拍動)
      P(root, { p: null, r: [-0.55, 0, sx * 0.12] }, { p: null, r: [0.5, sx * -0.25, sx * 0.55] }, 0.45, 0.85);
      bx(root, 0.24 * B, 0.5, 0.28, 0, 0.05, 0, hullDk, { metalness: 0.7 });   // 翼根機構
      bx(root, 0.26 * B, 0.12, 0.3, 0, 0.34, 0, accent, { emissive: accent, emissiveIntensity: 0.9 });
      for (let i = 0; i < 4; i++) {
        const len = 2.5 - i * 0.32;
        const geo = new THREE.ConeGeometry(0.18 * B * (1 - i * 0.12), len, 6);
        geo.rotateX(Math.PI);            // 錐尖朝 −y(焰流向後)
        geo.translate(0, -len / 2, 0);   // 底面錨在翼根原點:scale.y 拉長時焰刃自根部向外長
        const bl = new THREE.Mesh(geo,
          mat(accent, { transparent: true, opacity: 0.4, emissive: accent, emissiveIntensity: 1.4 }));
        bl.rotation.z = sx * (0.18 + i * 0.26);   // 扇形展開(外側焰刃張角遞增)
        bl.rotation.x = -0.08 * i;
        bl.visible = false;                       // 地面熄滅(locomotion 依型態 m 點燃)
        root.add(bl);
        lightWings.push(bl);
      }
    }
  }

  // ---- 猿猴的第五肢:多節圓柱串接的機械長尾(地面逐節上捲配重、砲口朝天蓄勢 →
  // 飛行蠍式前捲過頂,端點「巨砲」轉向正前方備射:1.5(軀)−0.84(根)+4×0.62(節)= π)。
  // 節與節之間的變形時窗遞延(0.1 → 0.5),捲/展都是由根往梢傳的波,不是整根瞬跳 ----
  const tailSegs = [];
  if (G === 'monkey') {
    let cur = torso;
    for (let i = 0; i < 5; i++) {
      const t = new THREE.Group();
      t.position.set(0, i === 0 ? -0.2 : 0, i === 0 ? -0.42 : -0.62);
      cur.add(t);
      P(t, { p: null, r: [(i === 0 ? -stance[1] + 0.1 : 0.42), 0, 0] },
        { p: null, r: [i === 0 ? -0.84 : 0.62, 0, 0] }, 0.1 + i * 0.08, 0.6 + i * 0.08);
      const w = 0.13 - i * 0.015;
      const seg = cyl(t, w * B, (w + 0.02) * B, 0.6, 8, 0, 0, -0.31, i % 2 ? hullDk : plate, { metalness: 0.6 });
      seg.rotation.x = Math.PI / 2;                                                     // 圓柱節身(沿 z)
      cyl(t, (w + 0.035) * B, (w + 0.035) * B, 0.1, 8, 0, 0, -0.6, 0x23262a, { metalness: 0.8 })
        .rotation.x = Math.PI / 2;                                                      // 節間關節環
      tailSegs.push(t);
      cur = t;
    }
    // 尾端巨砲(宙斯裝備):砲身沿尾梢 −z —— 地面上捲時砲口朝天蓄勢,
    // 飛行尾巴前捲過頂後砲口即指向正前方
    const tip = tailSegs[4];
    cyl(tip, 0.16 * B, 0.19 * B, 1.0, 8, 0, 0, -0.95, 0x1a1d20, { metalness: 0.85 })
      .rotation.x = Math.PI / 2;                                                        // 砲身
    cyl(tip, 0.21 * B, 0.21 * B, 0.2, 8, 0, 0, -0.62, hullDk, { metalness: 0.7 })
      .rotation.x = Math.PI / 2;                                                        // 砲尾機匣
    cyl(tip, 0.13 * B, 0.13 * B, 0.1, 8, 0, 0, -1.44, accent, { emissive: accent, emissiveIntensity: 1.6 })
      .rotation.x = Math.PI / 2;                                                        // 砲口充能環
  }

  // ---- 尾(四足獸配重,mobility_plan Task 2.2):幾何沿 −Z 打造(站姿自然朝後)。
  // 地面 r.x = −stance − 0.3(微垂朝後);飛行 r.x = −cruise + ε(反轉補償軀幹俯仰
  // → 尾沿航向軸向後流線,水平尾鰭/尾羽面因此恆平行地面)----
  if (beast) {
    const tail = new THREE.Group();
    tail.position.set(0, -0.26, -0.34);
    torso.add(tail);
    // 地面尾垂角:巨象是短垂尾(尾鰭折收後仍有長度,不垂會變成一根水平長矛)
    P(tail, { p: null, r: [-stance[1] - (G === 'elephant' ? 1.15 : 0.3), 0, 0] },
      { p: null, r: [0.06 - cruise, 0, 0] }, 0.08, 0.45);
    tailSegs.push(tail);   // 獸型尾也進 tailSegs → stepMorph 的鞭式甩動/配重一視同仁
    if (G === 'raptor') {
      // 迅猛龍平衡棒尾 → 始祖鳥羽軸尾:多節圓柱串接,末端尾羽扇變形末段展開
      cyl(tail, 0.1 * B, 0.08 * B, 0.9, 8, 0, 0, -0.45, hullDk).rotation.x = Math.PI / 2;   // 尾段一
      const t2 = new THREE.Group();
      t2.position.set(0, 0, -0.9);
      tail.add(t2);
      P(t2, { p: null, r: [0.3, 0, 0] }, { p: null, r: [0, 0, 0] }, 0.15, 0.55);
      tailSegs.push(t2);
      cyl(t2, 0.085 * B, 0.085 * B, 0.07, 8, 0, 0, -0.02, 0x30373f, { metalness: 0.8 })
        .rotation.x = Math.PI / 2;                                                       // 節間關節環
      cyl(t2, 0.07 * B, 0.05 * B, 0.6, 8, 0, 0, -0.3, 0x23262a).rotation.x = Math.PI / 2; // 尾段二
      for (let i = -1; i <= 1; i++) {
        const f = new THREE.Group();
        f.position.set(0, 0, -0.55);
        t2.add(f);
        P(f, { p: null, r: [0, 0, 0] }, { p: null, r: [0, i * 0.34, 0] }, 0.55, 1);
        bx(f, 0.18 * B, 0.04, 0.7, 0, 0, -0.35, i === 0 ? accent : plate);              // 尾羽
      }
    } else if (G === 'elephant') {
      // 象尾 → 利維坦尾柄 + 大型水平尾鰭(fluke):鰭葉地面沿尾垂折收攏(= 象尾毛束),
      // 飛行末段外翻成寬大水平鰭面(尾鰭變形是這型最明顯的剪影差)
      cyl(tail, 0.15 * B, 0.12 * B, 0.75, 9, 0, 0, -0.38, hullDk).rotation.x = Math.PI / 2;  // 尾柄(圓柱粗根)
      const t2 = new THREE.Group();
      t2.position.set(0, 0, -0.75);
      tail.add(t2);
      P(t2, { p: null, r: [0.4, 0, 0] }, { p: null, r: [-0.04, 0, 0] }, 0.15, 0.55);
      tailSegs.push(t2);
      cyl(t2, 0.13 * B, 0.13 * B, 0.08, 9, 0, 0, -0.02, 0x30373f, { metalness: 0.8 })
        .rotation.x = Math.PI / 2;                                                       // 節間關節環
      cyl(t2, 0.11 * B, 0.09 * B, 0.55, 8, 0, 0, -0.28, 0x23262a).rotation.x = Math.PI / 2; // 尾柄末段
      for (const sx of [-1, 1]) {
        const fl = new THREE.Group();
        fl.position.set(0, 0, -0.5);
        t2.add(fl);
        P(fl, { p: null, r: [0, sx * 1.55, 0] }, { p: null, r: [0, sx * 0.4, 0] }, 0.6, 1);   // 地面:鰭葉沿尾軸後折成尾毛束
        bx(fl, 1.0 * B, 0.06, 0.62, sx * 0.5 * B, 0, -0.16, plate, { metalness: 0.5 });  // 鰭葉
        bx(fl, 0.34 * B, 0.05, 0.34, sx * 1.0 * B, 0, -0.3, dim(plate, 0.8));           // 鰭尖後掠
        bx(fl, 0.9 * B, 0.05, 0.1, sx * 0.46 * B, 0.02, 0.12, accent, { emissive: accent, emissiveIntensity: 0.7 });
      }
      bx(t2, 0.16 * B, 0.08, 0.22, 0, 0, -0.6, accent, { emissive: accent, emissiveIntensity: 0.8 });
    } else if (G === 'panther') {
      // 夜豹長鞭尾(急轉配重):兩節圓柱串接 + 發光尾梢環
      cyl(tail, 0.06 * B, 0.05 * B, 0.8, 8, 0, 0, -0.4, hullDk).rotation.x = Math.PI / 2;
      const t2 = new THREE.Group();
      t2.position.set(0, 0, -0.8);
      tail.add(t2);
      P(t2, { p: null, r: [0.55, 0, 0] }, { p: null, r: [0.02, 0, 0] }, 0.15, 0.55);
      tailSegs.push(t2);
      cyl(t2, 0.045 * B, 0.04 * B, 0.65, 8, 0, 0, -0.32, 0x23262a).rotation.x = Math.PI / 2;
      cyl(t2, 0.055 * B, 0.055 * B, 0.16, 8, 0, 0, -0.7, accent, { emissive: accent, emissiveIntensity: 0.9 })
        .rotation.x = Math.PI / 2;                                                       // 尾梢識別環
      // 夜梟短扇尾(飛行專屬子結構,比照 raptor 分支手法):貓科細鞭尾與貓頭鷹寬扇尾剪影
      // 完全不同,地面型收折貼合鞭尾(P() 起始角),飛行時展開成扇形 —— MUST NOT 讓 owl
      // 飛行時仍拖著一條沒有變身的豹尾
      for (let i = -2; i <= 2; i++) {
        const f = new THREE.Group();
        f.position.set(0, 0, -0.55);
        t2.add(f);
        P(f, { p: null, r: [0, 0, 0] }, { p: null, r: [0, i * 0.22, 0] }, 0.55, 1);
        bx(f, 0.16 * B, 0.04, 0.42, 0, 0, -0.21, i === 0 ? accent : (i % 2 ? dim(plate, 0.85) : plate));  // 扇尾羽
      }
    } else {
      // 犀金龜短腹端(圓柱)
      cyl(tail, 0.15 * B, 0.12 * B, 0.5, 8, 0, 0, -0.25, hullDk).rotation.x = Math.PI / 2;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.14 * B, 0.35, 6), mat(0x2a2e33, { metalness: 0.6 }));
      tip.rotation.x = -Math.PI / 2;
      tip.position.set(0, 0, -0.6);
      tail.add(tip);
    }
  }

  const pose = makePoser(parts);
  pose(0);   // 以地面姿勢定尺(fitToHeight 以此姿勢貼地)
  // 步態參數 [步幅, 前肢擺幅, 彈跳, 屈曲剛性 flexF, 四肢相位表 qphase, 體側搖擺 rollSway]:
  // 巨象走側步序列 Speedwalk(同側前腳落後後腳 1/4 週期,LAT;加速不換步態)+ 體側搖擺
  // + 柱腿幾乎不折;夜豹彈簧腿大擺幅(高速換 rotary 襲步);迅猛龍 grounded running
  // (雙腿大跨距、彈跳收斂、前爪收起);甲蟲低伏硬肢碎彈跳歸零;步幅全面拉大 ——
  // 短腿機種靠步幅衝刺,步頻刷太高 = 整具機體高頻顫抖;其餘對角小跑(qphase 預設)
  const LAT = [0, Math.PI, -Math.PI / 2, Math.PI / 2];   // 側步序列:前肢落後同側後肢 1/4 週期
  const TRI = [0, Math.PI, 0, Math.PI];   // tripod(昆蟲):同側前後足同組、中足反相 = 恆三足觸地
  const gait = { biped: [2.2, 0.4, 0.07], elephant: [2.3, 0.95, 0.04, 0.5, LAT, 0.09],
    raptor: [2.6, 0.9, 0.06, 1.15], beetle: [1.7, 0.9, 0.03, 0.55, TRI], panther: [2.6, 1.0, 0.11, 1.1],
    wolf: [2.8, 0.85, 0.1], vampire: [2.3, 0.35, 0.05, 0.8], monkey: [2.3, 1.0, 0.12, 1.1],
    atlas: [2.0, 0.45, 0.05, 0.7],
  }[G] ?? [2.2, 0.4, 0.07];
  g.userData.rig = {
    kind: 'morph', torso, head, legL, legR, armL, armR, pose, vents, thrusters,
    flapWings: flapWings.length ? flapWings : null,
    rotors: rotors.length ? rotors : null, beast,
    // 分節關節(locomotion stepMorph 在 pose() 之上疊加屈曲):
    // 髖/肩 → 膝/肘 → 踝/腕,四足獸與人形一律四節俱全(2026-07-11 起獸型也有踝與前掌)
    kneeL: LL.shin, kneeR: LR.shin, ankleL: LL.ankle, ankleR: LR.ankle,
    elbowL: AL.fore, elbowR: AR.fore, wristL: AL.hand, wristR: AR.hand,
    tailSegs: tailSegs.length ? tailSegs : null,
    // 拍翼頻率倍率:利維坦緩拍巡游、犀金龜高頻振翅、夜梟緩而無聲
    flapF: { levi: 0.45, archo: 1, beetle: 2.6, owl: 0.7 }[F] ?? 1,
    // 飛行浮沉幅度:機械飛行型(定翼 jet/uav、旋翼 heli/tilt)= 0 —— 飛機/直升機巡航時
    // 機體是穩定的,靠氣動面與旋翼盤配平,不會跟著呼吸上下起伏;會浮沉的是「活的」擬態獸型
    airBob: { jet: 0, uav: 0, heli: 0, tilt: 0 }[F] ?? 1,
    stride: gait[0], swingArm: gait[1], bob: gait[2], flexF: gait[3],
    qphase: gait[4], rollSway: gait[5], top: 7, topAir: 30,
    // 步態原型分化(locomotion stepMorph):夜豹高速換迴旋襲步;迅猛龍前爪收起蓄勢
    // (grounded running,彈跳隨速度收斂,同 stepBiped 的 rig.grounded 語意);
    // 猿猴掌行 —— 前肢是承重前腳,雙側全幅擺動
    gallopType: G === 'panther' ? 'rotary' : null,
    tuck: G === 'raptor' ? 1 : 0, palmi: G === 'monkey' ? 1 : 0,
    grounded: G === 'raptor' ? 1 : 0,
    jets: jets.length ? jets : null,             // 噴射尾焰(jet 雙發機艙):速度驅動
    lightWings,                                  // 悟空光之翼焰刃:∝ 型態 m × 速度
    hoverUp: WUKONG ? cruise : 0,                // 悟空懸停直立:飛行靜止立回直立,移動才前傾壓平
    lightWingRoots: lightWingRoots.length ? lightWingRoots : null,   // 懸停時翼束上揚(孔雀開屏)
    midLegs, midKnees, midTarsi,                 // 犀金龜中足對(tripod 第三組)
    trunk, trunkTip,                             // 機械巨象象鼻(僅 elephant 非 null)
  };
  return g;
}

/**
 * 分節肢(mobility_plan Task 2.1 動力鏈):root(髖/肩)→ 每節自己的樞軸群組(膝/踝、肘/腕)。
 * 第 2 節起登記進 chain,locomotion.js 以「遞增相位延遲」驅動 → 力自近端傳向遠端
 * (torso ➔ shoulder ➔ forearm 的 follow-through),整條肢不再是一根僵直木棍。
 * segs[i] = { len 本節長度(= 下一個樞軸的下移量), base 靜姿角(站立時的屈曲),
 *             k 擺動屈曲權重, d 相位延遲, draw(g) 掛幾何,
 *             piv 樞軸位置覆寫 [x,y,z](預設 [0,−前一節 len,0])—— 深屈的肢節
 *             (袋鼠平舉的拳砲前臂)幾何是沿 +z 長出去的,腕樞軸就 MUST 落在 z 上,
 *             不是在 −y;不給 piv 會把手掌接到前臂的側面 }
 * 符號慣例(與既有 rig 一致):肢體幾何朝 −y,+x 旋轉 = 末端後移 ⇒
 * 膝後折為正、肘前折為負、踝取反號(擺動抬腳時壓腳尖、支撐時踩平)。
 */
function segLimb(parent, pos, segs, chain) {
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

/**
 * 人型機甲(hero:robot,vis.proto 四種原型 — 剪影/比例/裝備/站姿全部不同,
 * MUST NOT 再退回「同一具機體換色換掛件」):
 *  bastion  過裝甲重拳:圓弧巨肩、前臂粗於上臂、頭沉在雙肩之間、短粗腿大腳;
 *           右手長戟 —— 戟刃內就是 152mm 砲口(隱藏原型:反浩克級外掛重裝甲)
 *  seraph   倒三角上胸(EVA 式):整片上胸是尖端朝下的三角 —— 底邊即肩線、
 *           兩個上端點就是雙肩(肩上再立 binder 莢);細長四肢、外露肌腱缸、單角單眼;
 *           右手磁軌長槍(隱藏原型:EVA 式神經同步人造人)
 *  aegis    塔盾攔截機:左臂方形塔盾、右前臂速射砲、雙肩垂直發射彈艙(隱藏原型:方陣持盾兵 × 彈炮合一)
 *  colossus 巨兵:身軀/頭全是圓角矩形(壓扁膠囊),四肢由圓角矩形板沿長邊節節疊拼
 *           (蜈蚣體節感,髖-膝-踝-趾 / 肩-肘-腕-指,節間外露關節軸)、雙圓眼、
 *           眉心脈衝砲(致敬原型:天空之城的園丁機器人)
 * 骨架:骨盆重心樞軸 + 分節肢 chain;locomotion.js stepBiped 以實際地速驅動;
 * 步幅一律拉大(大步低頻)—— 高步頻小碎步 = 整機高頻顫抖,MUST NOT 靠刷步頻補速度。
 */
function buildRobotMech(side, vis) {
  const g = new THREE.Group();
  const accent = new THREE.Color(vis?.hue ?? SIDES[side].color);
  const PAL = heroPalette(vis, side, 'light');
  const armor = PAL.main, armorDk = PAL.mid, joint = PAL.deep, dark = PAL.dark;
  const PR = ['bastion', 'seraph', 'aegis', 'colossus'].includes(vis?.proto) ? vis.proto : 'bastion';
  const legChainL = [], legChainR = [], armChainL = [], armChainR = [];
  // 脊椎三節:hips(骨盆:重心浮沉/側移;腿掛在 g 上,不受它帶動 → 不滑步)
  //        → chest(胸腔:對轉、前傾、呼吸 —— 骨盆以上的一切都掛這裡)
  //        → head(頭:每幀反轉抵銷胸腔/骨盆的旋轉 = 凝視穩定)
  const hips = new THREE.Group();
  g.add(hips);
  const chest = new THREE.Group();
  hips.add(chest);
  const head = new THREE.Group();
  chest.add(head);
  let hipY, legL, legR, armL, armR, gait;

  if (PR === 'bastion') {
    // ---- 過裝甲重拳:所有量體堆在外層裝甲上,關節是縮在裡面的細軸 ----
    hipY = 2.35;
    gait = { stride: 3.2, bob: 0.16, sway: 0.11, top: 7, armBase: 0.12 };
    const mkLeg = (sx) => segLimb(g, [sx * 0.66, hipY, 0], [
      { len: 1.05, draw: (l) => {
        const ball = cyl(l, 0.3, 0.3, 0.42, 8, 0, 0.02, 0, joint, { metalness: 0.7 });
        ball.rotation.z = Math.PI / 2;                                            // 髖球
        bx(l, 0.82, 1.0, 0.9, 0, -0.55, 0.02, armor, { metalness: 0.6 });         // 巨腿甲
        bx(l, 0.3, 0.5, 0.24, sx * 0.48, -0.55, -0.16, armorDk);                  // 側推進莢
      } },
      { len: 0.98, base: 0.05, k: 0.6, d: 0.15, draw: (l) => {
        bx(l, 0.86, 0.36, 0.94, 0, -0.05, 0.08, armorDk);                         // 膝蓋大蓋甲
        bx(l, 0.74, 0.92, 0.82, 0, -0.6, -0.04, armor, { metalness: 0.6 });       // 小腿(外擴)
        bx(l, 0.5, 0.4, 0.22, 0, -0.66, -0.46, armorDk);                          // 腿肚配重
      } },
      { len: 0, base: 0.02, k: -0.3, d: 0.55, draw: (l) => {
        bx(l, 0.76, 0.32, 1.3, 0, -0.18, 0.2, joint);                             // 巨足
        bx(l, 0.78, 0.16, 0.36, 0, -0.12, 0.84, armorDk);                         // 腳尖甲
      } },
    ], sx < 0 ? legChainL : legChainR);
    legL = mkLeg(-1); legR = mkLeg(1);
    hips.position.y = hipY;
    bx(hips, 1.3, 0.6, 1.0, 0, 0.05, 0, joint, { metalness: 0.6 });               // 骨盆
    for (const sx of [-1, 1]) {
      const skirt = bx(hips, 0.6, 0.8, 0.7, sx * 0.85, -0.16, 0, armor);          // 大裙甲
      skirt.rotation.z = sx * 0.2;
    }
    bx(chest, 1.9, 1.5, 1.5, 0, 1.1, 0, armor, { metalness: 0.6 });               // 桶狀胸廓
    bx(chest, 0.9, 0.5, 0.2, 0, 1.15, 0.78, accent, { emissive: accent, emissiveIntensity: 1.2 });  // 胸口反應爐
    bx(chest, 1.4, 0.9, 0.6, 0, 1.75, -0.7, armorDk);                             // 背部散熱堆
    // 圓弧巨肩(球體 = 動畫感的過裝甲肩)
    const mkArm = (sx) => segLimb(chest, [sx * 1.2, 1.38, 0], [
      { len: 0.72, draw: (a) => {
        const pad = new THREE.Mesh(new THREE.SphereGeometry(0.68, 12, 9), mat(armor, { metalness: 0.6 }));
        pad.scale.set(1.0, 0.85, 1.05);
        pad.position.set(sx * 0.18, 0.18, 0);
        a.add(pad);
        bx(a, 0.62, 0.14, 0.78, sx * 0.18, 0.6, 0, dim(accent, 0.85));            // 肩頂識別甲
        bx(a, 0.34, 0.7, 0.38, 0, -0.32, 0, joint);                               // 細上臂軸
      } },
      { len: 1.0, base: -0.15, k: -0.42, d: 0.35, draw: (a) => {
        bx(a, 0.68, 1.0, 0.78, 0, -0.5, 0.02, armor, { metalness: 0.6 });         // 巨前臂(粗於上臂)
        bx(a, 0.2, 0.7, 0.4, sx * 0.42, -0.5, -0.1, armorDk);                     // 前臂外掛甲
      } },
      { len: 0, base: 0, k: 0.2, d: 0.7, draw: (a) => {
        bx(a, 0.5, 0.44, 0.5, 0, -0.24, 0.04, dark);                              // 巨拳
        if (sx > 0) {
          // 長戟:柄 + 戟刃(刃根內就是砲口)+ 反刃配重 —— 拿在右拳上
          const hal = new THREE.Group();
          hal.position.set(sx * 0.36, -0.2, 0.4);
          // 前傾扛戟(不是直立):戟刃因此落在肩「前」而非肩後 —— 直立會被巨肩整個擋住;
          // 斜置同時讓戟尖不超過機體頂(fitToHeight 量整體包圍盒,配件竄高會把機體本身縮小)
          hal.rotation.set(0.5, 0, sx * 0.42);   // +x = 戟頭朝前傾(負號會倒向背後被肩甲吃掉);z 外撇讓開胸口
          a.add(hal);
          cyl(hal, 0.12, 0.14, 3.2, 8, 0, 0.6, 0, 0x1a1d20, { metalness: 0.8 });  // 戟柄
          bx(hal, 0.22, 1.5, 1.15, sx * 0.14, 1.85, 0.34, armorDk, { metalness: 0.7 });  // 戟刃(側向大斧面)
          bx(hal, 0.16, 0.6, 0.55, sx * 0.16, 1.3, 0.72, dim(accent, 0.9));        // 刃緣識別
          const bore = cyl(hal, 0.18, 0.21, 1.4, 8, 0, 2.25, 0.04, 0x14171a, { metalness: 0.85 });
          bore.rotation.x = 0.05;                                                  // 刃根砲膛(152mm)
          cyl(hal, 0.2, 0.2, 0.14, 8, 0, 2.92, 0.06, accent, { emissive: accent, emissiveIntensity: 1.1 });
          bx(hal, 0.18, 0.7, 0.4, sx * 0.14, 1.55, -0.42, dark);                   // 反刃(鉤)
        }
      } },
    ], sx < 0 ? armChainL : armChainR);
    armL = mkArm(-1); armR = mkArm(1);
    // 頭:低伏在雙肩之間的小頭(過裝甲比例的識別特徵),但仍探出肩線
    head.position.set(0, 2.15, 0.12);
    bx(head, 0.52, 0.46, 0.56, 0, 0.06, 0, armorDk, { metalness: 0.6 });
    bx(head, 0.42, 0.12, 0.08, 0, 0.1, 0.31, accent, { emissive: accent, emissiveIntensity: 1.6 });
    bx(head, 0.64, 0.2, 0.32, 0, 0.32, 0.02, armor);                              // 頭頂護甲條
    // 指揮天線陣(總指揮機的識別:內建在背部散熱堆上,不用 charPod 掛件)
    for (const sx of [-1, 1]) {
      const ant = bx(chest, 0.06, 0.85, 0.06, sx * 0.5, 2.3, -0.85, 0x23262a, { metalness: 0.8 });
      ant.rotation.z = sx * 0.18;
      bx(chest, 0.13, 0.13, 0.13, sx * 0.62, 2.74, -0.85, accent, { emissive: accent, emissiveIntensity: 1.2 });
    }

  } else if (PR === 'seraph') {
    // ---- 倒三角上胸:寬肩窄腰、細長四肢、關節外露肌腱缸(生體感) ----
    hipY = 2.9;
    gait = { stride: 4.0, bob: 0.1, sway: 0.07, top: 8, armBase: 0.05 };
    const sinew = (p, h, x, y, z) => cyl(p, 0.11, 0.11, h, 8, x, y, z, 0x23262a, { metalness: 0.8 });
    const mkLeg = (sx) => segLimb(g, [sx * 0.42, hipY, 0], [
      { len: 1.35, draw: (l) => {
        sinew(l, 1.5, 0, -0.7, 0);                                                // 外露肌腱缸
        bx(l, 0.36, 1.2, 0.42, 0, -0.62, 0.04, armor, { metalness: 0.7 });        // 細長大腿
        bx(l, 0.14, 0.9, 0.16, sx * 0.22, -0.7, -0.08, armorDk);                  // 側肋條
      } },
      { len: 1.35, base: 0.12, k: 0.75, d: 0.15, draw: (l) => {
        bx(l, 0.42, 0.3, 0.5, 0, -0.02, 0.12, dim(accent, 0.7));                  // 尖膝甲
        sinew(l, 1.4, 0, -0.66, -0.04);
        bx(l, 0.3, 1.15, 0.36, 0, -0.66, 0.02, armor, { metalness: 0.7 });        // 細長小腿
        bx(l, 0.16, 0.7, 0.3, sx * 0.2, -0.9, -0.16, armorDk);                    // 腿肚推進鰭
      } },
      { len: 0, base: 0.04, k: -0.34, d: 0.55, draw: (l) => {
        bx(l, 0.34, 0.2, 0.9, 0, -0.12, 0.16, joint);                             // 窄長足
        bx(l, 0.36, 0.12, 0.26, 0, -0.08, 0.62, dim(accent, 0.6));
      } },
    ], sx < 0 ? legChainL : legChainR);
    legL = mkLeg(-1); legR = mkLeg(1);
    hips.position.y = hipY;
    bx(hips, 0.8, 0.4, 0.6, 0, 0.02, 0, joint, { metalness: 0.7 });               // 細骨盆
    sinew(chest, 0.9, 0, 0.5, 0);                                                 // 窄腰(脊柱外露:骨盆↔胸腔的活動段)
    // 倒三角上胸(EVA 式):一整塊「底邊在上、尖端朝下」的三角柱 —— 底邊就是肩線,
    // 底邊兩端點就是雙肩、直接承接雙臂;自肩線向下收斂到腰只剩尖端(微截平接脊柱)。
    bx(chest, 0.42, 1.0, 0.7, 0, 0.95, 0.0, armor, { metalness: 0.7 });           // 窄腰心柱(接三角尖端)
    const tri = new THREE.Shape();
    tri.moveTo(-1.32, 2.42);
    tri.lineTo(1.32, 2.42);                                                       // 底邊(上緣)= 肩線
    tri.lineTo(0.17, 0.7);                                                        // 收斂到腰(尖端微截平)
    tri.lineTo(-0.17, 0.7);
    const pec = new THREE.Mesh(new THREE.ExtrudeGeometry(tri,
      { depth: 0.78, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 1 }),
      mat(armor, { metalness: 0.7 }));
    pec.position.z = -0.4;
    chest.add(pec);
    bx(chest, 2.42, 0.1, 0.06, 0, 2.3, 0.46, dim(accent, 0.8));                   // 肩線識別稜(底邊描線)
    for (const sx of [-1, 1]) {
      const edge = bx(chest, 0.09, 1.85, 0.06, sx * 0.72, 1.55, 0.47, armorDk);
      edge.rotation.z = sx * 0.58;                                                // 斜邊描線(倒三角輪廓)
    }
    // 高聳肩甲莢(EVA 的肩部 binder):立在三角形兩個上端點的正上方
    for (const sx of [-1, 1]) {
      bx(chest, 0.36, 1.0, 1.0, sx * 1.26, 2.72, -0.04, armor, { metalness: 0.7 });
      bx(chest, 0.38, 0.16, 1.02, sx * 1.26, 3.02, -0.04, dim(accent, 0.85));     // 莢頂識別條
    }
    bx(chest, 0.44, 0.44, 0.24, 0, 1.62, 0.52, accent, { emissive: accent, emissiveIntensity: 1.3 });  // 核心
    bx(chest, 0.7, 0.6, 0.5, 0, 2.1, -0.55, armorDk);                             // 背部連接埠
    // 雙肩 = 倒三角的兩個上端點(肩線橫樑末端)
    const mkArm = (sx) => segLimb(chest, [sx * 1.25, 2.28, 0], [
      { len: 1.1, draw: (a) => {
        bx(a, 0.5, 0.5, 0.56, 0, 0.1, 0, armorDk, { metalness: 0.7 });            // 窄肩座
        sinew(a, 1.2, 0, -0.55, 0);
        bx(a, 0.28, 0.95, 0.32, 0, -0.5, 0.02, armor, { metalness: 0.7 });        // 細上臂
      } },
      { len: 0.95, base: -0.2, k: -0.6, d: 0.3, draw: (a) => {
        bx(a, 0.32, 0.24, 0.36, 0, -0.02, 0, joint);                              // 肘關節
        sinew(a, 1.0, 0, -0.5, 0);
        bx(a, 0.24, 0.85, 0.28, 0, -0.48, 0.02, armor, { metalness: 0.7 });       // 細前臂
      } },
      { len: 0, base: 0, k: 0.24, d: 0.6, draw: (a) => {
        bx(a, 0.24, 0.28, 0.3, 0, -0.14, 0.02, dark);                             // 掌
        if (sx > 0) {
          // 磁軌長槍:雙軌 + 中間充能核心(重武器 = 同步狙擊砲)
          const lance = new THREE.Group();
          lance.position.set(sx * 0.1, -0.16, 0.2);
          lance.rotation.x = 1.52;                                                 // 平舉朝前
          a.add(lance);
          for (const o of [-0.13, 0.13])
            cyl(lance, 0.07, 0.07, 4.4, 6, o, 2.0, 0, 0x1a1d20, { metalness: 0.85 });   // 雙軌
          cyl(lance, 0.05, 0.05, 3.6, 6, 0, 1.9, 0, accent, { emissive: accent, emissiveIntensity: 1.4 });  // 軌間電漿
          bx(lance, 0.42, 0.7, 0.34, 0, 0.4, 0, armorDk, { metalness: 0.7 });     // 後膛
          const tip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7, 6), mat(dim(accent, 1.1), { metalness: 0.8 }));
          tip.position.set(0, 4.3, 0);
          lance.add(tip);                                                          // 槍尖
        }
      } },
    ], sx < 0 ? armChainL : armChainR);
    armL = mkArm(-1); armR = mkArm(1);
    // 頭:單角 + 單眼掃描條(細長頸,自肩線橫樑中央探出 —— EVA 的小頭窄臉)
    head.position.set(0, 2.72, 0.06);
    sinew(head, 0.5, 0, -0.28, 0);
    bx(head, 0.42, 0.46, 0.5, 0, 0.1, 0, armor, { metalness: 0.7 });
    bx(head, 0.36, 0.1, 0.08, 0, 0.08, 0.26, accent, { emissive: accent, emissiveIntensity: 1.8 });
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.9, 5), mat(dim(accent, 0.9), { metalness: 0.8 }));
    horn.position.set(0, 0.5, 0.1);
    horn.rotation.x = -0.25;
    head.add(horn);                                                                // 額角

  } else if (PR === 'aegis') {
    // ---- 塔盾攔截機:左臂方盾、右前臂速射砲、雙肩垂直發射彈艙(防禦姿態) ----
    hipY = 2.6;
    gait = { stride: 3.4, bob: 0.12, sway: 0.08, top: 8, armBase: 0.1 };
    const mkLeg = (sx) => segLimb(g, [sx * 0.56, hipY, 0], [
      { len: 1.15, draw: (l) => {
        const ball = cyl(l, 0.26, 0.26, 0.36, 8, 0, 0.02, 0, joint, { metalness: 0.7 });
        ball.rotation.z = Math.PI / 2;
        bx(l, 0.56, 1.1, 0.62, 0, -0.58, 0.02, armor, { metalness: 0.6 });        // 大腿
        bx(l, 0.24, 0.7, 0.5, sx * 0.38, -0.55, 0, armorDk);                      // 側裝甲板
      } },
      { len: 1.1, base: 0.06, k: 0.55, d: 0.15, draw: (l) => {
        bx(l, 0.6, 0.32, 0.66, 0, -0.04, 0.1, armorDk);                           // 膝甲
        bx(l, 0.5, 1.0, 0.58, 0, -0.6, -0.02, armor, { metalness: 0.6 });         // 小腿
        for (const oy of [-0.35, -0.75])                                          // 腿側攔截彈匣
          cyl(l, 0.07, 0.07, 0.4, 6, sx * 0.3, oy, -0.24, 0x14171a, { metalness: 0.8 }).rotation.x = Math.PI / 2;
      } },
      { len: 0, base: 0.03, k: -0.28, d: 0.5, draw: (l) => {
        bx(l, 0.58, 0.28, 1.05, 0, -0.16, 0.16, joint);                           // 穩定大腳(寬基座)
        bx(l, 0.62, 0.14, 0.3, 0, -0.1, 0.66, armorDk);
      } },
    ], sx < 0 ? legChainL : legChainR);
    legL = mkLeg(-1); legR = mkLeg(1);
    hips.position.y = hipY;
    bx(hips, 1.1, 0.55, 0.85, 0, 0.05, 0, joint, { metalness: 0.6 });             // 骨盆
    const fs = bx(hips, 0.7, 0.55, 0.18, 0, -0.16, 0.44, armorDk);
    fs.rotation.x = 0.16;                                                          // 前裙甲
    bx(chest, 1.5, 1.25, 1.05, 0, 1.15, 0.02, armor, { metalness: 0.6 });         // 胸廓
    bx(chest, 0.55, 0.4, 0.16, 0, 1.3, 0.56, accent, { emissive: accent, emissiveIntensity: 1.1 });
    // 雙肩垂直發射彈艙(攔截彈 VLS:每側 2×3 發射管口朝上)
    for (const sx of [-1, 1]) {
      const vls = bx(chest, 0.66, 0.62, 0.78, sx * 1.0, 1.85, -0.1, armorDk, { metalness: 0.65 });
      for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++)
        cyl(vls, 0.09, 0.09, 0.1, 6, (i - 0.5) * 0.28, 0.33, (j - 1) * 0.24, accent,
          { emissive: accent, emissiveIntensity: 1.0 });                           // 發射管口
    }
    const mkArm = (sx) => segLimb(chest, [sx * 0.98, 1.7, 0], [
      { len: 0.78, draw: (a) => {
        bx(a, 0.62, 0.48, 0.66, 0, 0.1, 0, armorDk, { metalness: 0.6 });          // 肩甲
        bx(a, 0.3, 0.6, 0.34, 0, -0.36, 0, joint);                                // 上臂
      } },
      { len: 0.9, base: -0.35, k: -0.5, d: 0.32, draw: (a) => {
        bx(a, 0.42, 0.85, 0.46, 0, -0.42, 0.02, armor, { metalness: 0.6 });       // 前臂
        if (sx > 0) {
          // 右前臂 = 30mm 速射砲(砲身沿前臂前伸)
          const gun = cyl(a, 0.13, 0.15, 1.9, 8, 0, -0.5, 0.7, 0x1a1d20, { metalness: 0.85 });
          gun.rotation.x = Math.PI / 2;
          cyl(a, 0.16, 0.16, 0.12, 8, 0, -0.5, 1.66, accent, { emissive: accent, emissiveIntensity: 1.0 })
            .rotation.x = Math.PI / 2;
          bx(a, 0.3, 0.34, 0.4, 0, -0.2, -0.32, armorDk);                          // 供彈箱
        } else {
          // 左前臂 = 方形塔盾(盾面外掛;邊框 + 主色十字肋)
          const sh = new THREE.Group();
          sh.position.set(sx * 0.42, -0.5, 0.24);
          sh.rotation.z = sx * 0.06;
          a.add(sh);
          bx(sh, 0.22, 2.9, 1.9, 0, 0, 0, armor, { metalness: 0.6 });              // 盾面
          bx(sh, 0.1, 3.0, 0.24, sx * 0.14, 0, 0.9, armorDk);                      // 盾緣
          bx(sh, 0.1, 3.0, 0.24, sx * 0.14, 0, -0.9, armorDk);
          bx(sh, 0.12, 2.5, 0.2, sx * 0.16, 0, 0, accent, { emissive: accent, emissiveIntensity: 0.8 });  // 縱肋
          bx(sh, 0.12, 0.2, 1.5, sx * 0.16, 0.5, 0, accent, { emissive: accent, emissiveIntensity: 0.8 }); // 橫肋
        }
      } },
      { len: 0, base: 0, k: 0.2, d: 0.62, draw: (a) => {
        bx(a, 0.3, 0.32, 0.34, 0, -0.16, 0.04, dark);                              // 拳
      } },
    ], sx < 0 ? armChainL : armChainR);
    armL = mkArm(-1); armR = mkArm(1);
    // 頭:雙感測窗 + 側耳雷達
    head.position.set(0, 2.15, 0.06);
    bx(head, 0.5, 0.42, 0.52, 0, 0.08, 0, armorDk, { metalness: 0.6 });
    for (const sx of [-1, 1]) {
      bx(head, 0.14, 0.12, 0.08, sx * 0.13, 0.1, 0.28, accent, { emissive: accent, emissiveIntensity: 1.6 });
      const ear = cyl(head, 0.14, 0.14, 0.06, 10, sx * 0.3, 0.12, -0.02, dim(accent, 0.7));
      ear.rotation.z = Math.PI / 2;                                                // 側耳追蹤雷達
    }

  } else {
    // ---- 巨兵(致敬原型:天空之城的園丁機器人):身軀與頭全是「圓角矩形」——
    // 膠囊壓扁成的圓角板;四肢由圓角矩形板沿長邊一節節疊拼(蜈蚣的體節感),
    // 節與節之間露出關節軸環 = 每一節都看得出能動(靈活關節)。
    // 背上不再揹武器 —— 標定脈衝砲就是眉心那道光(它安靜,直到不得不開火)。
    hipY = 2.75;
    gait = { stride: 4.2, bob: 0.09, sway: 0.05, top: 8, armBase: 0.18, legBase: 0.04 };
    // 圓角矩形板:膠囊(半徑 = w/2)拉長、沿厚度方向壓扁 —— w 寬(x)、h 長(y)、d 厚(z)
    const rslab = (p, w, h, d, x, y, z, c, opts) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(w / 2, Math.max(0.01, h - w), 4, 10),
        mat(c, { metalness: 0.55, ...(opts || {}) }));
      m.scale.set(1, 1, d / w);
      m.position.set(x, y, z);
      p.add(m);
      return m;
    };
    // 蜈蚣節肢:一段肢 = 兩片圓角板沿長邊疊拼(下片被上片壓住一截)+ 節端外露關節軸
    const seg2 = (l, w, len, d, c1, c2) => {
      rslab(l, w, len * 0.66, d, 0, -len * 0.26, 0, c1);
      rslab(l, w * 0.9, len * 0.6, d * 0.92, 0, -len * 0.72, 0.03, c2);
      cyl(l, w * 0.32, w * 0.32, 0.14, 10, 0, -len - 0.01, 0, joint, { metalness: 0.8 })
        .rotation.z = Math.PI / 2;                                                 // 節間關節軸環
    };
    const mkLeg = (sx) => segLimb(g, [sx * 0.52, hipY, 0], [
      { len: 1.15, draw: (l) => seg2(l, 0.62, 1.15, 0.5, armor, armorDk) },        // 股節
      { len: 1.1, base: 0.22, k: 0.72, d: 0.16, draw: (l) => seg2(l, 0.54, 1.1, 0.44, armor, armorDk) },   // 脛節
      { len: 0.85, base: -0.34, k: 0.42, d: 0.34, draw: (l) => seg2(l, 0.46, 0.85, 0.4, armorDk, armor) }, // 蹠節
      { len: 0, base: 0.18, k: -0.34, d: 0.55, draw: (l) => {
        rslab(l, 0.5, 0.95, 0.2, 0, -0.08, 0.26, joint).rotation.x = Math.PI / 2;  // 圓角足掌(平貼地)
        for (let i = -1; i <= 1; i++)
          rslab(l, 0.14, 0.36, 0.12, i * 0.17, -0.08, 0.76, dark).rotation.x = Math.PI / 2;  // 三趾
      } },
    ], sx < 0 ? legChainL : legChainR);
    legL = mkLeg(-1); legR = mkLeg(1);
    hips.position.y = hipY;
    rslab(hips, 0.66, 1.15, 0.6, 0, 0.02, 0, joint, { metalness: 0.7 })
      .rotation.z = Math.PI / 2;                                                    // 圓角骨盆(橫置)
    const body = rslab(chest, 1.5, 2.3, 0.95, 0, 1.28, -0.06, armor);               // 圓角矩形身軀
    body.rotation.x = -0.1;                                                          // 微拱背
    rslab(chest, 1.08, 1.6, 0.92, 0, 1.32, 0.1, dim(armor, 1.08));                  // 前胸圓角板
    for (let i = 0; i < 3; i++)                                                      // 胸口紋章(縱列光點)
      cyl(chest, 0.07, 0.07, 0.1, 8, 0, 1.88 - i * 0.34, 0.58, accent, { emissive: accent, emissiveIntensity: 1.2 })
        .rotation.x = Math.PI / 2;
    const mkArm = (sx) => segLimb(chest, [sx * 0.92, 2.0, -0.05], [
      { len: 1.2, draw: (a) => {
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.44, 12, 9), mat(armor, { metalness: 0.6 }));
        dome.scale.set(1, 0.8, 1);
        dome.position.y = 0.1;
        a.add(dome);                                                                 // 圓肩甲
        seg2(a, 0.5, 1.2, 0.42, armor, armorDk);                                     // 上臂節
      } },
      { len: 1.15, base: -0.26, k: -0.55, d: 0.3, draw: (a) => seg2(a, 0.44, 1.15, 0.38, armor, armorDk) },  // 前臂節
      { len: 0.75, base: -0.22, k: -0.36, d: 0.48, draw: (a) => seg2(a, 0.38, 0.75, 0.32, armorDk, armor) }, // 腕節
      { len: 0, base: -0.08, k: -0.26, d: 0.66, draw: (a) => {
        for (let i = -1; i <= 1; i++) {
          const fg = rslab(a, 0.13, 0.56, 0.16, i * 0.14, -0.28, 0.03, dark);
          fg.rotation.z = i * 0.1;                                                   // 三指(圓角長指)
        }
        if (sx > 0) cyl(a, 0.08, 0.08, 0.14, 8, 0, -0.3, 0.16, accent,
          { emissive: accent, emissiveIntensity: 1.0 }).rotation.x = Math.PI / 2;    // 右掌心測向器
      } },
    ], sx < 0 ? armChainL : armChainR);
    armL = mkArm(-1); armR = mkArm(1);
    // 圓角矩形頭 + 雙圓眼(訊號掃描機的「臉」終於有了眼睛 —— 它看著你,不出聲)
    head.position.set(0, 2.62, 0.06);
    cyl(head, 0.15, 0.19, 0.55, 8, 0, -0.26, -0.04, joint, { metalness: 0.75 });     // 頸柱
    rslab(head, 0.74, 1.0, 0.64, 0, 0.3, 0, armor).rotation.x = 0.06;                // 圓角頭殼
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), mat(accent, { emissive: accent, emissiveIntensity: 1.8 }));
      eye.position.set(sx * 0.17, 0.34, 0.31);
      head.add(eye);                                                                 // 雙圓眼
    }
    cyl(head, 0.06, 0.06, 0.09, 8, 0, 0.64, 0.26, accent, { emissive: accent, emissiveIntensity: 1.4 })
      .rotation.x = Math.PI / 2;                                                     // 眉心脈衝砲口(標定脈衝砲)
    for (const sx of [-1, 1]) {
      const ant = bx(head, 0.05, 0.6, 0.05, sx * 0.2, 0.9, -0.14, armorDk);
      ant.rotation.z = sx * 0.3;                                                     // 測向天線對(掃描機的本業)
    }
  }

  // 角色掛件(胸燈已自帶 → trim:false;座標以真實尺寸錨定)
  if (vis?.pod && vis.pod !== 'none') {
    g.add(charPod(vis, 5.4, { sx: 1.35, sy: hipY + 2.0, trim: false }));
  }
  g.userData.rig = {
    kind: 'biped', hips, chest, head, legL, legR, armL, armR,
    legChainL, legChainR, armChainL, armChainR,
    hipsY0: hipY, headY0: head.position.y, gunArm: true,
    stride: gait.stride, bob: gait.bob, sway: gait.sway, top: gait.top,
    legBase: gait.legBase || 0, armBase: gait.armBase || 0,
  };
  return g;
}

/**
 * 機甲角色掛件(共用骨架上的專屬差異化):
 * vis.pod = 'antenna'|'cannon'|'dish'|'shield'|'rack'|'blade'|'twin'|'none';
 * 預設加胸前主色識別燈條。座標以 fitToHeight 後的機體(高 target、腳底 y=0)為準;
 * anchor 可覆寫肩點/燈條位置(程序生成人型機甲自帶胸燈,傳 trim:false)。
 */
/**
 * 餌機:機甲外掛的可分離子機(誘導導彈 / 偵察機 / 誘餌)。
 * 機首朝 +z(與機甲模型同慣例;game.js 一律以 ry + π 套用朝向)。
 * 尺寸以 len ≈ 2.2 為基準,掛在機甲肩上時整組縮放。
 */
function buildDecoy(side, vis = null) {
  const g = new THREE.Group();
  const accent = new THREE.Color(vis?.hue ?? SIDES[side]?.color ?? 0xffffff);
  const PAL = heroPalette(vis, side, 'light');   // 餌機沿用主機甲的角色色版
  const shell = PAL.lite, dark = PAL.dark;
  // 彈體 + 錐形彈頭(圓柱預設軸為 +y,轉 90° 讓它躺成 +z 朝向)
  const body = cyl(g, 0.24, 0.28, 1.5, 10, 0, 0, 0, shell, { metalness: 0.6 });
  body.rotation.x = Math.PI / 2;
  const nose = cyl(g, 0.02, 0.24, 0.55, 10, 0, 0, 1.0, dark, { metalness: 0.7 });
  nose.rotation.x = Math.PI / 2;
  // 感測球(偵察機之眼)+ 尾焰口
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8),
    mat(accent, { emissive: accent, emissiveIntensity: 1.6 }));
  eye.position.set(0, 0.16, 0.72);
  g.add(eye);
  cyl(g, 0.18, 0.14, 0.18, 8, 0, 0, -0.82, dark).rotation.x = Math.PI / 2;
  // 四片尾翼(繞彈體軸每 90° 一片)
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const fin = bx(g, 0.05, 0.55, 0.42, Math.sin(a) * 0.22, Math.cos(a) * 0.22, -0.6, shell, { metalness: 0.5 });
    fin.rotation.z = a;
  }
  const trim = bx(g, 0.06, 0.06, 0.9, 0, 0.27, 0.05, accent, { emissive: accent, emissiveIntensity: 1.2 });
  trim.userData.noOutline = true;
  g.userData.decoyLen = 2.2;
  return g;
}

/** 機甲肩上的餌機掛點(組合/分離動畫的錨點;game.js 以 userData.decoyPod 控制顯隱與縮放) */
function decoyPod(side, vis, target) {
  const pod = buildDecoy(side, vis);
  pod.scale.setScalar(target * 0.42 / pod.userData.decoyLen);
  pod.position.set(-target * 0.3, target * 0.72, -target * 0.06);
  return pod;
}

function charPod(vis, target, anchor = null) {
  const A = {
    sx: target * 0.22, sy: target * 0.78, trim: true,
    trimY: target * 0.62, trimZ: target * 0.14, ...(anchor || {}),
  };
  const g = new THREE.Group();
  const accent = new THREE.Color(vis?.hue ?? 0xffffff);
  if (A.trim) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(target * 0.22, target * 0.035, target * 0.03),
      mat(accent, { emissive: accent, emissiveIntensity: 1.1 }));
    trim.position.set(0, A.trimY, A.trimZ);
    g.add(trim);
  }
  const sy = A.sy, sx = A.sx;   // 右肩基準
  const dark = 0x39424b;
  const pod = vis?.pod || 'none';
  if (pod === 'antenna') {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, target * 0.5, 6), mat(dark));
    mast.position.set(sx, sy + target * 0.2, 0);
    g.add(mast);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.4 }));
    tip.position.set(sx, sy + target * 0.45, 0);
    g.add(tip);
  } else if (pod === 'cannon') {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, target * 0.55, 8), mat(0x2b3239, { metalness: 0.8 }));
    tube.rotation.x = Math.PI / 2;
    tube.position.set(sx, sy, -target * 0.05);
    g.add(tube);
  } else if (pod === 'dish') {
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(target * 0.12, target * 0.04, 0.08, 10), mat(0xaab4bd));
    dish.rotation.z = Math.PI / 3;
    dish.position.set(sx, sy + target * 0.08, 0);
    g.add(dish);
  } else if (pod === 'shield') {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.12, target * 0.34, target * 0.26), mat(dark, { metalness: 0.6 }));
    plate.position.set(-sx - 0.15, sy - target * 0.18, 0);
    g.add(plate);
  } else if (pod === 'rack') {
    const rack = new THREE.Mesh(new THREE.BoxGeometry(target * 0.14, target * 0.12, target * 0.2), mat(dark));
    rack.position.set(sx, sy + target * 0.04, 0);
    g.add(rack);
    for (const [oy, oz] of [[-0.03, -0.05], [-0.03, 0.05], [0.03, -0.05], [0.03, 0.05]]) {
      const cell = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, target * 0.16, 6), mat(0x14171a));
      cell.rotation.x = Math.PI / 2;
      cell.position.set(sx, sy + target * 0.04 + oy * target, oz * target);
      g.add(cell);
    }
  } else if (pod === 'blade') {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, target * 0.36, target * 0.14), mat(dark, { metalness: 0.7 }));
    fin.rotation.z = -0.35;
    fin.position.set(sx, sy + target * 0.12, -target * 0.04);
    g.add(fin);
  } else if (pod === 'twin') {
    for (const oz of [-0.06, 0.06]) {
      const t2 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, target * 0.4, 8), mat(0x2b3239, { metalness: 0.8 }));
      t2.rotation.x = Math.PI / 2;
      t2.position.set(sx, sy, oz * target);
      g.add(t2);
    }
  }
  return g;
}

/**
 * 輪式裝甲運兵車 — 車體掛懸吊樞軸(hull),locomotion.js 驅動
 * 離心側傾/煞車點頭;輪子留在根節點保持著地,轉速 = 線速度(Task 1.2)。
 * 色塊:主艙/頂甲/側裙三層明暗 + 陣營識別條 + 頭燈/觀察窗發光細節。
 */
function buildApc(side) {
  const g = new THREE.Group();
  const dimA = new THREE.Color(SIDES[side].colorDim);
  const hull = new THREE.Group();
  g.add(hull);
  bx(hull, 2.6, 1.3, 5.2, 0, 1.5, 0, 0x4a5347);                          // 主裝甲艙
  const nose = bx(hull, 2.6, 0.9, 1.2, 0, 1.25, 2.9, 0x3f4840);          // 斜鼻
  nose.rotation.x = 0.3;
  bx(hull, 2.3, 0.22, 4.2, 0, 2.24, -0.3, 0x424b40);                     // 頂甲板
  bx(hull, 0.62, 0.14, 0.9, 0.7, 2.4, -1.4, 0x39413a);                   // 艙口蓋
  for (const s of [-1, 1]) {
    bx(hull, 0.14, 0.6, 4.6, s * 1.38, 1.1, 0.2, 0x3b4239);              // 側裙板
    bx(hull, 0.16, 0.14, 4.2, s * 1.39, 1.52, 0.2, dimA);                // 陣營識別條
    bx(hull, 0.12, 0.12, 0.12, s * 1.0, 1.4, 3.2, 0xffe9b0,
      { emissive: 0xffd27a, emissiveIntensity: 1.3 });                   // 頭燈
  }
  bx(hull, 1.5, 0.14, 0.08, 0, 1.92, 2.55, 0x141a20,
    { emissive: 0x9adfff, emissiveIntensity: 0.6 });                     // 駕駛觀察窗
  const pipe = cyl(hull, 0.09, 0.09, 0.7, 6, -1.15, 2.1, -2.5, 0x2c3033, { metalness: 0.6 });
  pipe.rotation.x = 0.5;                                                 // 排氣管
  cyl(hull, 0.02, 0.03, 1.4, 5, 1.15, 3.0, -2.3, 0x23262a);              // 通訊天線
  cyl(hull, 0.7, 0.9, 0.7, 8, 0, 2.7, 0.3, dimA);                        // 砲塔
  const barrel = cyl(hull, 0.09, 0.09, 2.2, 8, 0, 2.75, 1.7, 0x14171a, { metalness: 0.8 });
  barrel.rotation.x = Math.PI / 2;
  cyl(barrel, 0.13, 0.13, 0.28, 8, 0, 1.05, 0, 0x0d0f11);                // 砲口制退器
  const wheels = [];
  for (let i = 0; i < 4; i++) {
    for (const s of [-1, 1]) {
      const w = cyl(g, 0.55, 0.55, 0.4, 12, s * 1.42, 0.55, -1.8 + i * 1.25, 0x191c1f);
      w.rotation.z = Math.PI / 2;
      cyl(w, 0.2, 0.2, 0.42, 8, 0, 0, 0, 0x2c3033);                      // 輪轂(轉動可見)
      wheels.push({ m: w, r: 0.55 });
    }
  }
  g.userData.rig = { kind: 'wheeled', hull, hullY0: 0, wheels, top: 11 };
  return g;
}

/**
 * 主戰坦克(2026-07-10 重繪)— 舊版路輪整圈藏在履帶箱裡、側裙 + 過大砲塔
 * 蓋住車身,側視只剩一塊黑。重繪重點:
 *  · 履帶總成外露:路輪比履帶帶「寬」(輪面凸出可見)、前惰輪/後主動輪
 *    抬高撐出環帶輪廓,上下履帶帶 + 前後斜段圍出履帶剪影
 *  · 車身墊高:主車身高於履帶頂線,側視三層(履帶/車身/砲塔)分明
 *  · 砲塔縮小前置,不再壓過車身;全部輪組進 rig.wheels(轉速 = 線速度)
 */
function buildTank(side) {
  const g = new THREE.Group();
  const accent = new THREE.Color(SIDES[side].colorDim);
  const body = 0x57604b, bodyDk = 0x49523f, deck = 0x525b46, band = 0x2f343a;
  const hull = new THREE.Group();
  g.add(hull);
  // 車體(底面 1.5 > 履帶頂帶 1.48:側視大色塊不被履帶吃掉)
  bx(hull, 2.5, 1.05, 6.2, 0, 2.0, 0, body);                             // 主車身
  const glacis = bx(hull, 2.5, 0.95, 1.6, 0, 1.85, 3.25, bodyDk);        // 前斜甲
  glacis.rotation.x = 0.5;
  bx(hull, 2.4, 0.18, 2.6, 0, 2.6, -1.7, deck);                          // 引擎甲板
  bx(hull, 1.5, 0.12, 1.3, 0, 2.72, -2.0, 0x394037);                     // 散熱柵
  bx(hull, 2.3, 0.5, 0.6, 0, 2.2, -3.3, bodyDk);                         // 車尾艙
  for (const s of [-1, 1]) {
    // 履帶環帶剪影:上帶/著地帶 + 前後斜段(繞惰輪/主動輪)
    bx(hull, 0.72, 0.32, 5.6, s * 1.7, 1.32, 0, band);                   // 上履帶帶
    bx(hull, 0.72, 0.3, 5.9, s * 1.7, 0.24, 0, band);                    // 著地帶
    const f = bx(hull, 0.72, 0.3, 1.4, s * 1.7, 0.78, 3.05, band);       // 前斜段
    f.rotation.x = -0.72;
    const r = bx(hull, 0.72, 0.3, 1.4, s * 1.7, 0.78, -3.05, band);      // 後斜段
    r.rotation.x = 0.72;
    bx(hull, 1.05, 0.14, 6.6, s * 1.7, 1.56, 0.15, deck);                // 擋泥板
    bx(hull, 1.07, 0.1, 5.4, s * 1.7, 1.66, 0.15, accent);               // 陣營識別條
  }
  // 輪組:輪寬 1.0 > 帶寬 0.72 → 輪面凸出履帶帶外,轉動清晰可見
  const wheels = [];
  const roadWheel = (s, z, r, y) => {
    const w = cyl(hull, r, r, 1.0, 12, s * 1.7, y, z, 0x22262b);
    w.rotation.z = Math.PI / 2;
    cyl(w, r * 0.45, r * 0.45, 1.04, 8, 0, 0, 0, 0x3a4046);              // 輪轂
    wheels.push({ m: w, r });
  };
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) roadWheel(s, -2.35 + i * 0.94, 0.5, 0.55);  // 六路輪
    roadWheel(s, 3.15, 0.42, 0.95);                                      // 前惰輪(高位)
    roadWheel(s, -3.15, 0.42, 0.95);                                     // 後主動輪(高位)
  }
  // 砲塔總成(縮小前置)
  const turret = new THREE.Group();
  turret.position.set(0, 2.55, 0.55);
  hull.add(turret);
  cyl(turret, 0.95, 1.25, 0.8, 8, 0, 0.35, 0, body);                     // 塔體
  bx(turret, 1.1, 0.5, 0.8, 0, 0.35, 0.85, bodyDk);                      // 防盾
  bx(turret, 0.65, 0.18, 0.65, -0.35, 0.83, -0.2, 0x394037);             // 車長艙蓋
  bx(turret, 0.28, 0.22, 0.28, 0.55, 0.85, 0.25, 0x141a20,
    { emissive: 0x9adfff, emissiveIntensity: 0.7 });                     // 觀瞄鏡
  bx(turret, 1.7, 0.45, 0.7, 0, 0.28, -1.05, 0x3a4136);                  // 尾艙置物架
  cyl(turret, 0.02, 0.03, 1.3, 5, -0.7, 1.35, -0.6, 0x23262a);           // 天線
  const gun = cyl(turret, 0.13, 0.16, 4.4, 10, 0, 0.42, 2.9, 0x14171a, { metalness: 0.8 });
  gun.rotation.x = Math.PI / 2;
  cyl(gun, 0.19, 0.19, 0.5, 8, 0, 0.8, 0, 0x1e2226);                     // 排煙器
  cyl(gun, 0.21, 0.21, 0.35, 8, 0, 2.05, 0, 0x0d0f11);                   // 砲口制退器
  g.userData.rig = { kind: 'tracked', hull, hullY0: 0, wheels, top: 9 };
  g.userData.turret = turret;   // 砲塔獨立追蹤目標(game.js _aimVehicleTurret)
  return g;
}

/**
 * 可動步兵骨架(mobility_plan Task 2.1):
 * 髖×2 + 肩×2 四個關節樞軸 + 骨盆(hips)重心樞軸;locomotion.js 以實際地速驅動
 * 步頻(不滑步)、重心側移支撐腿、速度前傾、手臂反相擺動。
 * 色塊:迷彩服/防彈背心/護具三層明暗 + 陣營識別(胸燈/護目鏡/頭盔條)。
 */
function buildTrooper(side, p) {
  const g = new THREE.Group();
  const accent = new THREE.Color(SIDES[side].color);
  const hipY = 1.3;
  // 腿:髖關節樞軸(大腿/護膝/小腿/戰鬥靴)
  const mkLeg = (sx) => {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.22, hipY, 0);
    bx(leg, 0.26, 0.56, 0.3, 0, -0.3, 0, p.fatigue);
    bx(leg, 0.28, 0.14, 0.32, 0, -0.58, 0.04, p.pad);
    bx(leg, 0.2, 0.52, 0.24, 0, -0.86, 0, dim(p.fatigue, 0.85));
    bx(leg, 0.24, 0.16, 0.44, 0, -1.16, 0.06, 0x23262a);
    g.add(leg);
    return leg;
  };
  const legL = mkLeg(-1), legR = mkLeg(1);
  // 上半身(骨盆樞軸:浮沉/側移/前傾都在這裡)
  const hips = new THREE.Group();
  hips.position.y = hipY;
  g.add(hips);
  bx(hips, 0.56, 0.26, 0.36, 0, 0.1, 0, 0x2f342b);                       // 腰帶
  for (const sx of [-1, 1]) bx(hips, 0.14, 0.18, 0.1, sx * 0.18, 0.08, 0.2, 0x23262a);  // 彈匣袋
  bx(hips, 0.6, 0.62, 0.4, 0, 0.58, 0, p.fatigue);                       // 軀幹
  bx(hips, 0.66, 0.48, 0.46, 0, 0.62, 0.02, p.vest);                     // 防彈背心
  bx(hips, 0.2, 0.1, 0.06, 0, 0.74, 0.27, accent,
    { emissive: accent, emissiveIntensity: 0.9 });                       // 敵我識別燈
  bx(hips, 0.46, 0.46, 0.22, 0, 0.62, -0.34, dim(p.vest, 0.82));         // 背包
  for (const sx of [-1, 1]) bx(hips, 0.26, 0.14, 0.34, sx * 0.44, 0.92, 0, p.pad);      // 肩甲
  // 手臂:肩關節樞軸(上臂/前臂/手套)
  const mkArm = (sx) => {
    const a = new THREE.Group();
    a.position.set(sx * 0.47, 0.88, 0);
    bx(a, 0.17, 0.44, 0.22, 0, -0.22, 0, p.fatigue);
    bx(a, 0.15, 0.4, 0.19, 0, -0.62, 0.06, dim(p.fatigue, 0.9));
    bx(a, 0.14, 0.14, 0.18, 0, -0.88, 0.1, 0x8a6f52);
    hips.add(a);
    return a;
  };
  const armL = mkArm(-1), armR = mkArm(1);
  // 頭/鋼盔/護目鏡(主色發光:賽璐璐識別點)+ 盔頂陣營條
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), mat(0xc9a481));
  head.position.set(0, 1.18, 0.02);
  hips.add(head);
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.29, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(p.helmet));
  helmet.position.set(0, 1.2, 0);
  hips.add(helmet);
  bx(hips, 0.1, 0.05, 0.5, 0, 1.42, 0, dim(SIDES[side].color, 0.75));
  bx(hips, 0.36, 0.1, 0.08, 0, 1.2, 0.25, accent, { emissive: accent, emissiveIntensity: 1.2 });
  // 武器
  if (p.weapon === 'tube') {
    // 肩扛火箭筒(前彈頭 / 後噴口分色)
    const tube = cyl(hips, 0.15, 0.15, 1.9, 8, 0.34, 1.06, -0.1, 0x1c1f22, { metalness: 0.7 });
    tube.rotation.x = Math.PI / 2 - 0.28;   // 筒口朝前上
    cyl(tube, 0.16, 0.11, 0.3, 8, 0, 1.05, 0, dim(SIDES[side].color, 0.8));
    cyl(tube, 0.17, 0.17, 0.14, 8, 0, -0.98, 0, 0x2c3033);
  } else {
    // 通用機槍(槍身/長槍管/彈鏈盒/提把/收折兩腳架)掛右手
    const mg = bx(armR, 0.1, 0.18, 1.5, 0.03, -0.82, 0.5, 0x1a1d20);
    bx(mg, 0.05, 0.08, 0.75, 0, 0.04, 1.05, 0x30373f, { metalness: 0.85 });   // 長槍管
    const fl = cyl(mg, 0.055, 0.04, 0.16, 6, 0, 0.04, 1.48, 0x0d0f11);        // 消焰器
    fl.rotation.x = Math.PI / 2;
    bx(mg, 0.05, 0.07, 0.4, 0, 0.15, 0.25, 0x23262a);                         // 提把/照門
    bx(mg, 0.2, 0.26, 0.3, -0.14, -0.12, 0.2, 0x2e332c);                      // 彈鏈盒(左掛)
    bx(mg, 0.07, 0.24, 0.12, 0, -0.18, -0.15, 0x23262a);                      // 握把
    for (const sx of [-1, 1]) {                                               // 兩腳架(沿槍管收折)
      const bp = bx(mg, 0.03, 0.42, 0.03, sx * 0.06, -0.1, 0.85, 0x23262a);
      bp.rotation.x = 1.25;
    }
  }
  g.userData.rig = {
    kind: 'biped', hips, legL, legR, armL, armR,
    hipsY0: hipY, stride: 0.95, bob: 0.07, sway: 0.06, top: 8, gunArm: true,
  };
  return g;
}

/** 鋼鐵機槍步兵 — 可動骨架 + 手持通用機槍 */
function buildSoldierFallback(side) {
  return buildTrooper(side, {
    fatigue: 0x5a6148, vest: 0x3a4034, pad: 0x474e3c, helmet: 0x3d4436, weapon: 'mg',
  });
}

/** 備援火箭兵(重護具 + 肩扛長管) */
function buildRocketeerFallback(side) {
  return buildTrooper(side, {
    fatigue: 0x4a5138, vest: 0x343a2c, pad: 0x3e4534, helmet: 0x33392c, weapon: 'tube',
  });
}

/** 備援榴彈兵(牽引式榴彈砲):整體掛搖晃樞軸,行進時有慣性起伏 */
function buildHowitzerFallback(side) {
  const g = new THREE.Group();
  const accent = new THREE.Color(SIDES[side].colorDim);
  const hull = new THREE.Group();
  g.add(hull);
  cyl(hull, 1.1, 1.3, 0.6, 8, 0, 0.3, 0, 0x3a3f34);                      // 底盤
  for (const [sx, sz] of [[-0.9, -1.6], [0.9, -1.6]]) {
    bx(hull, 0.18, 0.18, 2.2, sx, 0.3, sz, 0x2c302a);                    // 駐鋤架
  }
  cyl(hull, 0.5, 0.6, 0.7, 8, 0, 0.95, 0, accent);                       // 砲架
  bx(hull, 1.7, 0.9, 0.12, 0, 1.35, 0.65, 0x353b30);                     // 防盾板
  bx(hull, 0.5, 0.35, 0.8, 0.95, 0.55, 0.4, 0x2f342b);                   // 彈藥箱
  bx(hull, 0.52, 0.08, 0.82, 0.95, 0.76, 0.4, accent);                   // 彈藥箱識別蓋
  const barrel = cyl(hull, 0.16, 0.22, 3.4, 8, 0, 1.5, -0.8, 0x16191c, { metalness: 0.7 });
  barrel.rotation.x = -0.55;
  cyl(barrel, 0.24, 0.24, 0.4, 8, 0, 1.55, 0, 0x0d0f11);                 // 砲口制退器
  g.userData.rig = { kind: 'tracked', hull, hullY0: 0, wheels: [], top: 5 };
  return g;
}

/** 備援攻擊直升機(機身+尾桁+主旋翼,userData.spin 供每幀轉動)。機首朝 +z(全機體慣例,見 game.js _updateEnts) */
function buildHeliFallback(side) {
  const g = new THREE.Group();
  const accent = new THREE.Color(SIDES[side].color);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 1.6, 4, 8), mat(0x3a4038));
  body.rotation.x = Math.PI / 2;   // 機身長軸沿 +z
  body.position.y = 1.6;
  g.add(body);
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), mat(accent, { emissive: accent, emissiveIntensity: 0.4 }));
  cockpit.position.set(0, 1.6, 1.15);   // 座艙在機首 +z
  g.add(cockpit);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, 2.6, 8), mat(0x2c322a));
  tail.rotation.x = Math.PI / 2;
  tail.position.set(0, 1.75, -2.2);     // 尾桁在後 -z
  g.add(tail);
  const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.12), mat(0x9aa4ad, { transparent: true, opacity: 0.85 }));
  tailRotor.position.set(0, 1.75, -3.4);
  g.add(tailRotor);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 8), mat(0x14171a));
  hub.position.y = 2.35;
  g.add(hub);
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.05, 0.16), mat(0x9aa4ad, { transparent: true, opacity: 0.85 }));
  rotor.position.y = 2.42;
  g.add(rotor);
  for (const skidX of [-0.9, 0.9]) {
    const skid = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 2.6), mat(0x1c1f22));
    skid.position.set(skidX, 0.55, 0);   // 起落橇沿 +z 前後向
    g.add(skid);
  }
  // 短翼 + 火箭莢艙 + 尾翼識別條(攻擊直升機剪影)
  bx(g, 2.4, 0.1, 0.55, 0, 1.5, -0.3, 0x333a30);   // 短翼左右展開(x 向)
  for (const s of [-1, 1]) {
    const pod = cyl(g, 0.18, 0.18, 0.9, 8, s * 1.05, 1.42, -0.3, 0x2c3033);
    pod.rotation.x = Math.PI / 2;                   // 火箭莢艙筒口朝 +z
    cyl(pod, 0.14, 0.14, 0.06, 8, 0, 0.46, 0, 0xffb27a, { emissive: 0xff8844, emissiveIntensity: 0.6 });
  }
  bx(g, 0.08, 0.7, 0.5, 0, 2.1, -3.2, 0x2c322a);   // 垂直尾翼(x 薄、z 長)
  bx(g, 0.1, 0.16, 0.52, 0, 2.3, -3.2, accent);
  // 壓坡樞軸(locomotion.js):巡航壓坡 / 入彎側傾 / 浮沉整機一起動
  const tilt = new THREE.Group();
  tilt.position.y = 1.6;
  for (const k of [...g.children]) { k.position.y -= 1.6; tilt.add(k); }
  g.add(tilt);
  g.userData.spin = [rotor, tailRotor];
  g.userData.rig = { kind: 'aerial', tilt, tiltY0: 1.6, bob: 0.05, top: 16 };
  return g;
}

// ---------- 蜂群陣營專屬 NPC(2026-07-10 陣營差異化重塑)----------
// 設計原則(doc/mobility_plan.html):
//  · 剪影差異化:鋼鐵 = 履帶/輪式軍武寫實系;蜂群 = 懸浮/旋翼/機器人科技系,
//    遠距一眼分敵我(不只靠陣營色)
//  · 骨架全部走 locomotion.js 既有 rig 合約(biped/quad/wheeled/tracked/aerial),
//    步態/側傾/壓坡動力學零新增程式
//  · 賽璐璐大色塊 + 同色系明暗分版 + 琥珀發光識別(複眼/蜂腹環紋/蜂室燈)
const SW_SHELL = 0x34383f, SW_DK = 0x282c31, SW_PLATE = 0x41464e, SW_JOINT = 0x1c1f23;

/**
 * 蜂群戰鬥機器人步兵(soldier / rocketeer 共用雙足骨架):
 * 逆關節鳥腿 + 蜂腹環紋 + 單眼複合感測條;soldier 右手鼓式彈鼓機槍,
 * rocketeer 改右肩四聯裝火箭莢艙(對應 wid:'rocket')。
 */
function buildSwarmTrooper(side, { rocket = false } = {}) {
  const g = new THREE.Group();
  const accent = new THREE.Color(SIDES[side].color);
  const hipY = 1.45;
  // 逆關節鳥腿:大腿前傾 / 小腿後折 / 趾爪足
  const mkLeg = (sx) => {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.26, hipY, 0);
    const ax = cyl(leg, 0.1, 0.1, 0.22, 6, 0, 0, 0, SW_JOINT, { metalness: 0.7 });
    ax.rotation.z = Math.PI / 2;                                          // 髖軸
    const th = bx(leg, 0.17, 0.62, 0.24, 0, -0.3, 0.09, SW_PLATE, { metalness: 0.6 });
    th.rotation.x = -0.3;                                                 // 大腿
    const sh = bx(leg, 0.12, 0.6, 0.16, 0, -0.85, -0.04, SW_SHELL);
    sh.rotation.x = 0.45;                                                 // 小腿(逆關節)
    bx(leg, 0.16, 0.12, 0.42, 0, -1.36, 0.12, SW_DK);                     // 趾爪足
    g.add(leg);
    return leg;
  };
  const legL = mkLeg(-1), legR = mkLeg(1);
  const hips = new THREE.Group();
  hips.position.y = hipY;
  g.add(hips);
  bx(hips, 0.5, 0.24, 0.34, 0, 0.04, 0, SW_JOINT);                        // 骨盆
  // 蜂腹(後伸節腹):琥珀×碳黑環紋 = 蜂群識別
  bx(hips, 0.34, 0.32, 0.55, 0, -0.05, -0.42, SW_DK);
  bx(hips, 0.36, 0.1, 0.5, 0, -0.05, -0.44, accent, { emissive: accent, emissiveIntensity: 0.6 });
  bx(hips, 0.26, 0.22, 0.3, 0, -0.08, -0.78, SW_DK);
  // 軀幹:胸殼 + 前胸甲 + 識別燈 + 背部散熱包
  bx(hips, 0.56, 0.62, 0.4, 0, 0.55, 0.02, SW_SHELL, { metalness: 0.6 });
  bx(hips, 0.6, 0.42, 0.44, 0, 0.62, 0.04, SW_PLATE);
  bx(hips, 0.24, 0.1, 0.06, 0, 0.72, 0.28, accent, { emissive: accent, emissiveIntensity: 1.0 });
  bx(hips, 0.42, 0.5, 0.22, 0, 0.6, -0.32, SW_DK);
  for (const sx of [-1, 1]) bx(hips, 0.24, 0.16, 0.3, sx * 0.42, 0.92, 0, SW_PLATE);  // 肩甲
  // 手臂:肩關節樞軸
  const mkArm = (sx) => {
    const a = new THREE.Group();
    a.position.set(sx * 0.46, 0.88, 0);
    bx(a, 0.15, 0.44, 0.2, 0, -0.22, 0, SW_SHELL);
    bx(a, 0.13, 0.4, 0.17, 0, -0.62, 0.05, SW_DK);
    hips.add(a);
    return a;
  };
  const armL = mkArm(-1), armR = mkArm(1);
  // 頭:單眼複合感測條 + 雙天線(蜂觸角)
  bx(hips, 0.3, 0.28, 0.34, 0, 1.2, 0.04, SW_SHELL, { metalness: 0.6 });
  bx(hips, 0.26, 0.08, 0.06, 0, 1.22, 0.24, accent, { emissive: accent, emissiveIntensity: 1.6 });
  for (const sx of [-1, 1]) {
    const ant = cyl(hips, 0.015, 0.02, 0.4, 5, sx * 0.1, 1.5, 0.1, 0x14171a);
    ant.rotation.x = -0.5;
  }
  // 武器
  if (rocket) {
    // 右肩四聯裝火箭莢艙(琥珀管口)
    const pod = bx(hips, 0.32, 0.36, 0.72, 0.44, 1.1, -0.02, SW_DK, { metalness: 0.6 });
    for (const [oy, ox] of [[-0.08, -0.07], [-0.08, 0.07], [0.08, -0.07], [0.08, 0.07]]) {
      const tube = cyl(pod, 0.055, 0.055, 0.16, 6, ox, oy, 0.34, 0x14171a);
      tube.rotation.x = Math.PI / 2;
      const rim = cyl(pod, 0.06, 0.06, 0.03, 6, ox, oy, 0.42, accent, { emissive: accent, emissiveIntensity: 0.9 });
      rim.rotation.x = Math.PI / 2;
    }
  } else {
    // 鼓式彈鼓機槍掛右手(短護木 + 琥珀砲口環)
    const mg = bx(armR, 0.1, 0.16, 1.2, 0.02, -0.78, 0.42, 0x15181c);
    bx(mg, 0.05, 0.07, 0.55, 0, 0.03, 0.8, 0x30373f, { metalness: 0.85 });    // 槍管
    const drum = cyl(mg, 0.13, 0.13, 0.14, 8, 0, -0.16, 0.02, SW_DK);         // 彈鼓
    drum.rotation.z = Math.PI / 2;
    const muz = cyl(mg, 0.05, 0.05, 0.05, 6, 0, 0.03, 1.08, accent, { emissive: accent, emissiveIntensity: 1.0 });
    muz.rotation.x = Math.PI / 2;
  }
  g.userData.rig = {
    kind: 'biped', hips, legL, legR, armL, armR,
    hipsY0: hipY, stride: 0.95, bob: 0.07, sway: 0.06, top: 8, gunArm: true,
  };
  return g;
}

/**
 * 蜂群懸浮運兵艇(apc)— 無輪地效滑行平台:氣墊裙 + 四角向量噴口。
 * rig 走 wheeled(側傾/點頭係數較大 = 懸浮漂移感),wheels 留空。
 */
function buildSwarmApc(side) {
  const g = new THREE.Group();
  const accent = new THREE.Color(SIDES[side].color);
  const hull = new THREE.Group();
  g.add(hull);
  bx(hull, 2.5, 0.9, 4.6, 0, 1.3, -0.2, SW_SHELL, { metalness: 0.6 });   // 主艙
  const nose = bx(hull, 2.3, 0.7, 1.4, 0, 1.2, 2.35, SW_DK);             // 楔形艏
  nose.rotation.x = 0.35;
  bx(hull, 2.2, 0.18, 3.6, 0, 1.85, -0.4, SW_PLATE);                     // 頂甲
  bx(hull, 0.7, 0.12, 0.9, 0.6, 1.98, -1.3, SW_DK);                      // 艙口蓋
  bx(hull, 1.5, 0.12, 0.08, 0, 1.62, 2.62, accent,
    { emissive: accent, emissiveIntensity: 0.7 });                       // 蜂眼駕駛窗
  for (const s of [-1, 1]) {
    const skirt = bx(hull, 0.5, 0.55, 4.6, s * 1.5, 0.72, -0.1, SW_DK);  // 氣墊裙(外擴)
    skirt.rotation.z = s * 0.35;
    bx(hull, 0.14, 0.1, 3.8, s * 1.6, 1.15, -0.1, accent,
      { emissive: accent, emissiveIntensity: 0.9 });                     // 舷側識別光條
  }
  // 四角向量噴口(底面琥珀光 = 懸浮感)
  for (const [sx, sz] of [[-1, 1.5], [1, 1.5], [-1, -1.9], [1, -1.9]]) {
    const pod = cyl(hull, 0.32, 0.4, 0.5, 8, sx * 1.1, 0.55, sz, SW_JOINT, { metalness: 0.7 });
    cyl(pod, 0.26, 0.26, 0.08, 8, 0, -0.28, 0, accent, { emissive: accent, emissiveIntensity: 1.1 });
  }
  // 遙控槍塔 + 天線
  cyl(hull, 0.45, 0.55, 0.4, 6, 0, 2.12, 0.5, SW_PLATE);
  const barrel = cyl(hull, 0.06, 0.07, 1.6, 6, 0, 2.2, 1.5, 0x111418, { metalness: 0.8 });
  barrel.rotation.x = Math.PI / 2;
  cyl(hull, 0.02, 0.03, 1.2, 5, -1.0, 2.4, -2.0, 0x23262a);
  g.userData.rig = { kind: 'wheeled', hull, hullY0: 0, wheels: [], top: 11 };
  return g;
}

/**
 * 蜂群四足步行砲台(tank)— 甲蟲式四足走獸 + 背載磁軌砲。
 * rig 走 quad(stepQuad:對角步態/脊椎波/尾配重),與獸型機甲同合約;
 * 腿掛根節點(脊椎浮沉不帶動腳底 → 不滑步)。
 */
function buildSwarmTank(side) {
  const g = new THREE.Group();
  const accent = new THREE.Color(SIDES[side].color);
  const hipY = 2.1;
  const spine = new THREE.Group();
  spine.position.y = hipY;
  g.add(spine);
  // 後段蜂腹甲殼(琥珀環紋)
  bx(spine, 2.2, 1.2, 2.0, 0, 0, -1.5, SW_SHELL, { metalness: 0.6 });
  bx(spine, 2.3, 0.16, 1.8, 0, 0.66, -1.5, SW_PLATE);
  for (let i = 0; i < 2; i++)
    bx(spine, 2.26, 0.18, 0.26, 0, -0.1, -1.0 - i * 0.75, accent,
      { emissive: accent, emissiveIntensity: 0.5 });                     // 腹部環紋
  // 前段主甲殼(胸樞軸:脊椎波第二節)
  const chest = new THREE.Group();
  chest.position.set(0, 0.05, 0.2);
  spine.add(chest);
  bx(chest, 2.5, 1.4, 2.6, 0, 0.1, 0.8, SW_PLATE, { metalness: 0.6 });
  bx(chest, 2.3, 0.2, 2.2, 0, 0.88, 0.8, SW_SHELL);                      // 背甲
  // 背載磁軌砲(朝 +z;導軌 + 充能環)
  const gun = cyl(chest, 0.15, 0.19, 4.6, 8, 0, 1.05, 2.6, 0x14171a, { metalness: 0.8 });
  gun.rotation.x = Math.PI / 2;
  for (const s of [-1, 1]) bx(gun, 0.08, 3.8, 0.16, s * 0.24, -0.2, 0, SW_DK, { metalness: 0.7 });
  cyl(gun, 0.24, 0.24, 0.4, 6, 0, 2.1, 0, 0x0d0f11);                     // 砲口
  cyl(gun, 0.21, 0.21, 0.16, 6, 0, 1.55, 0, accent, { emissive: accent, emissiveIntensity: 0.9 });
  // 頸/頭(複眼感測;stepQuad 靜止警戒掃描)
  const neck = new THREE.Group();
  neck.position.set(0, -0.15, 2.1);
  chest.add(neck);
  bx(neck, 0.5, 0.4, 0.5, 0, 0, 0.1, SW_DK);
  const head = new THREE.Group();
  head.position.set(0, 0, 0.4);
  neck.add(head);
  bx(head, 0.7, 0.5, 0.6, 0, 0, 0.2, SW_SHELL, { metalness: 0.6 });
  bx(head, 0.56, 0.12, 0.08, 0, 0.06, 0.52, accent, { emissive: accent, emissiveIntensity: 1.6 });
  for (const sx of [-1, 1]) {
    const ant = cyl(head, 0.02, 0.03, 0.7, 5, sx * 0.22, 0.5, 0.3, 0x14171a);
    ant.rotation.x = -0.6;                                               // 蜂觸角
  }
  // 尾(散熱鰭配重;stepQuad 急轉甩尾)
  const tail = new THREE.Group();
  tail.position.set(0, 0.15, -2.5);
  spine.add(tail);
  bx(tail, 0.3, 0.5, 0.8, 0, 0, -0.4, SW_DK);
  const tail2 = new THREE.Group();
  tail2.position.set(0, 0, -0.8);
  tail.add(tail2);
  bx(tail2, 0.2, 0.36, 0.6, 0, 0, -0.3, SW_JOINT);
  bx(tail2, 0.22, 0.2, 0.16, 0, 0, -0.62, accent, { emissive: accent, emissiveIntensity: 0.8 });
  // 四足:髖樞軸 + 逆關節 + 足墊
  const mkLeg = (sx, sz, front) => {
    const leg = new THREE.Group();
    leg.position.set(sx * 1.3, hipY, sz);
    bx(leg, 0.5, 0.5, 0.6, 0, 0, 0, SW_PLATE, { metalness: 0.6 });       // 髖甲
    const th = bx(leg, 0.3, 1.3, 0.45, 0, -0.55, front ? 0.15 : -0.15, SW_SHELL);
    th.rotation.x = front ? -0.25 : 0.25;
    const sh = bx(leg, 0.2, 1.2, 0.3, 0, -1.5, front ? -0.15 : 0.15, SW_DK);
    sh.rotation.x = front ? 0.3 : -0.3;
    bx(leg, 0.34, 0.18, 0.5, 0, -2.02, 0.05, SW_JOINT);                  // 足墊
    g.add(leg);
    return leg;
  };
  g.userData.rig = {
    kind: 'quad', spine, chest, neck, head, tail, tail2,
    legFL: mkLeg(-1, 1.1, true), legFR: mkLeg(1, 1.1, true),
    legHL: mkLeg(-1, -1.5, false), legHR: mkLeg(1, -1.5, false),
    hipsY0: hipY, stride: 1.6, bob: 0.08, top: 9,
  };
  return g;
}

/**
 * 蜂群懸浮砲台(howitzer)— 六角浮游平台 + 高仰角磁軌榴砲;
 * rig 走 tracked(小側傾/大點頭 = 重平台慣性),wheels 留空。
 */
function buildSwarmHowitzer(side) {
  const g = new THREE.Group();
  const accent = new THREE.Color(SIDES[side].color);
  const hull = new THREE.Group();
  g.add(hull);
  cyl(hull, 1.5, 1.8, 0.6, 6, 0, 0.75, 0, SW_SHELL);                     // 六角平台
  cyl(hull, 1.52, 1.52, 0.1, 6, 0, 1.1, 0, accent, { emissive: accent, emissiveIntensity: 0.6 });  // 平台識別環
  // 三向量噴口(底面琥珀光 = 懸浮)
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3 + Math.PI / 2;
    const pod = cyl(hull, 0.26, 0.34, 0.4, 6, Math.cos(a) * 1.0, 0.32, Math.sin(a) * 1.0, SW_JOINT, { metalness: 0.7 });
    cyl(pod, 0.22, 0.22, 0.06, 6, 0, -0.22, 0, accent, { emissive: accent, emissiveIntensity: 1.1 });
  }
  // 後穩定鰭 ×2
  for (const s of [-1, 1]) {
    const fin = bx(hull, 0.12, 0.9, 1.1, s * 0.8, 1.4, -1.25, SW_DK);
    fin.rotation.x = -0.35;
  }
  // 磁軌榴砲(仰角 ~33°:雙導軌 + 砲口充能環)
  cyl(hull, 0.55, 0.7, 0.7, 6, 0, 1.4, 0, SW_PLATE);                     // 砲架
  const barrel = cyl(hull, 0.1, 0.14, 3.6, 8, 0, 1.95, -0.85, 0x14171a, { metalness: 0.8 });
  barrel.rotation.x = -0.58;
  for (const s of [-1, 1]) bx(barrel, 0.06, 3.2, 0.14, s * 0.17, 0.1, 0, SW_DK, { metalness: 0.7 });
  cyl(barrel, 0.17, 0.17, 0.18, 6, 0, 1.6, 0, accent, { emissive: accent, emissiveIntensity: 1.0 });
  // 側掛彈藥蜂室 ×3
  for (let i = 0; i < 3; i++) {
    const cell = cyl(hull, 0.17, 0.17, 0.5, 6, 0.95, 1.05, 0.55 - i * 0.42, SW_DK);
    cell.rotation.z = Math.PI / 2;
  }
  cyl(hull, 0.02, 0.03, 1.1, 5, -0.9, 1.9, 0.6, 0x23262a);               // 感測桅杆
  g.userData.rig = { kind: 'tracked', hull, hullY0: 0, wheels: [], top: 5 };
  return g;
}

/**
 * 蜂群六旋翼砲艇(heli)— 沒有主旋翼/尾桁的巨型六軸,剪影與鋼鐵直升機
 * 徹底區隔;userData.spin 供每幀轉槳,rig 走 aerial(壓坡/浮沉)。
 */
function buildSwarmHeli(side) {
  const g = new THREE.Group();
  const accent = new THREE.Color(SIDES[side].color);
  const tilt = new THREE.Group();
  tilt.position.y = 1.7;
  g.add(tilt);
  bx(tilt, 1.3, 1.0, 2.8, 0, 0, 0, SW_SHELL, { metalness: 0.6 });        // 裝甲莢艙機身
  const canopy = bx(tilt, 0.9, 0.5, 0.7, 0, 0.15, 1.45, accent, { emissive: accent, emissiveIntensity: 0.7 });
  canopy.rotation.x = 0.25;                                              // 蜂眼座艙
  bx(tilt, 1.4, 0.16, 2.2, 0, 0.55, -0.2, SW_PLATE);                     // 背甲
  const chin = cyl(tilt, 0.08, 0.1, 1.0, 8, 0, -0.55, 1.2, 0x111418, { metalness: 0.8 });
  chin.rotation.x = Math.PI / 2;                                         // 頜下機砲
  // 短翼火箭莢艙
  bx(tilt, 2.6, 0.1, 0.5, 0, -0.15, -0.2, SW_DK);
  for (const s of [-1, 1]) {
    const pod = cyl(tilt, 0.2, 0.2, 0.8, 6, s * 1.15, -0.32, -0.2, SW_JOINT);
    pod.rotation.x = Math.PI / 2;
    cyl(pod, 0.16, 0.16, 0.06, 6, 0, 0.42, 0, accent, { emissive: accent, emissiveIntensity: 0.7 });
  }
  // 尾感測桁 + 識別燈
  bx(tilt, 0.2, 0.24, 1.4, 0, 0.1, -2.0, SW_DK);
  bx(tilt, 0.24, 0.3, 0.2, 0, 0.2, -2.75, accent, { emissive: accent, emissiveIntensity: 1.2 });
  // 六軸旋翼環(蜂群剪影核心)
  const props = [];
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3 + Math.PI / 6;
    const x = Math.cos(a) * 1.9, z = Math.sin(a) * 1.9;
    const arm = bx(tilt, 2.0, 0.09, 0.16, x * 0.5, 0.3, z * 0.5, SW_PLATE, { metalness: 0.6 });
    arm.rotation.y = Math.atan2(-z, x);
    cyl(tilt, 0.14, 0.17, 0.22, 8, x, 0.42, z, SW_JOINT, { metalness: 0.8 });
    cyl(tilt, 0.15, 0.15, 0.05, 8, x, 0.55, z, accent);                  // 馬達頂環
    const prop = new THREE.Group();
    prop.position.set(x, 0.62, z);
    tilt.add(prop);
    for (const sx of [-1, 1])
      bx(prop, 1.3, 0.04, 0.15, sx * 0.66, 0, 0, 0x9aa4ad, { transparent: true, opacity: 0.75 });
    props.push(prop);
  }
  // 起落架 ×4
  for (const [sx, sz] of [[-0.6, 0.9], [0.6, 0.9], [-0.6, -0.9], [0.6, -0.9]])
    bx(tilt, 0.1, 0.5, 0.1, sx, -0.75, sz, SW_JOINT);
  g.userData.spin = props;
  g.userData.rig = { kind: 'aerial', tilt, tiltY0: 1.7, bob: 0.06, top: 16 };
  return g;
}

/**
 * 蜂群防禦塔(蜂巢塔)— 六角疊節收分 + 蜂室發光格 + 無人機棲架。
 * 垂直硬約束同 buildTowerFallback:座圈頂面 / 全高 必須 = 0.92
 * (makeUnit 把砲塔頭掛在 target*0.92),否則砲塔浮空或陷柱。
 */
function buildSwarmTower(side) {
  const g = new THREE.Group();
  const accent = new THREE.Color(SIDES[side].color);
  const TOP = 18.75, RING = TOP * 0.92;
  // 六角基墩兩階
  cyl(g, 5.2, 6.0, 1.5, 6, 0, 0.75, 0, 0x3f444b).rotation.y = Math.PI / 6;
  cyl(g, 4.2, 5.0, 2.0, 6, 0, 2.5, 0, 0x4a5058).rotation.y = Math.PI / 6;
  // 塔身三節收分(交錯轉 30° = 蜂巢積木感)
  const segs = [
    { rt: 3.0, rb: 3.6, h: 4.2, y: 5.6 },
    { rt: 2.5, rb: 3.0, h: 4.0, y: 9.7 },
    { rt: 2.1, rb: 2.5, h: 3.6, y: 13.5 },
  ];
  segs.forEach((s, i) => {
    const seg = cyl(g, s.rt, s.rb, s.h, 6, 0, s.y, 0, i % 2 ? 0x3a3f46 : 0x434951);
    seg.rotation.y = i % 2 ? 0 : Math.PI / 6;
  });
  // 蜂室發光格:六面 × 四列,確定性挑格點亮(不用 Math.random)
  const rows = [[5.2, 3.35], [7.8, 3.02], [10.4, 2.72], [13.0, 2.42]];
  for (let f = 0; f < 6; f++) {
    const fg = new THREE.Group();
    fg.rotation.y = f * Math.PI / 3;
    g.add(fg);
    for (let k = 0; k < rows.length; k++) {
      const [y, r] = rows[k];
      const lit = (f + k) % 3 === 0;
      const cell = cyl(fg, 0.5, 0.5, 0.5, 6, 0, y, r, lit ? accent : 0x2c3138,
        lit ? { emissive: accent, emissiveIntensity: 1.0 } : {});
      cell.rotation.x = Math.PI / 2;
    }
  }
  // 頂部座圈(頂面 = RING)+ 環繞警示燈
  cyl(g, 3.0, 2.4, 1.6, 6, 0, RING - 1.05, 0, 0x4a5058);
  cyl(g, 3.4, 3.4, 0.5, 6, 0, RING - 0.25, 0, 0x545b64);
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    bx(g, 0.32, 0.32, 0.32, Math.sin(a) * 3.2, RING - 0.25, Math.cos(a) * 3.2, accent,
      { emissive: accent, emissiveIntensity: 1.2 });
  }
  // 感測尖塔(全模型最高點 = TOP)+ 正面複眼(+z 朝兵線)
  cyl(g, 0.08, 0.2, 3.4, 5, 1.8, TOP - 1.7, -1.2, 0x2c3138);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), mat(accent, { emissive: accent, emissiveIntensity: 1.3 }));
  eye.position.set(0, RING - 1.6, 2.6);
  g.add(eye);
  // 無人機棲架(懸臂桁架 ×2:剪影不對稱重點)
  for (const s of [-1, 1]) {
    const perch = bx(g, 2.6, 0.18, 0.9, s * 3.2, 12.4 + s * 0.7, -0.4, 0x3a3f46);
    perch.rotation.z = s * 0.12;
    bx(g, 0.5, 0.3, 0.5, s * 4.2, 12.6 + s * 0.7, -0.4, accent, { emissive: accent, emissiveIntensity: 0.7 });
  }
  return g;
}

/**
 * 蜂群塔頭:六聯裝蜂巢飛彈莢艙(與鋼鐵雙管砲塔剪影區隔)。
 * 合約同 buildTowerTurret:yaw 樞軸 → userData.pitch 俯仰樞軸,砲口沿 +z。
 */
function buildSwarmTowerTurret(side) {
  const accent = new THREE.Color(SIDES[side].color);
  const yaw = new THREE.Group();
  cyl(yaw, 1.4, 1.8, 0.9, 6, 0, 0.45, 0, 0x494f58, { metalness: 0.7 });  // 承載環
  const pitch = new THREE.Group();
  pitch.position.set(0, 1.05, 0.3);
  yaw.add(pitch);
  bx(pitch, 3.2, 1.4, 2.4, 0, 0, 0.4, 0x3f444b, { metalness: 0.6 });     // 莢艙本體
  for (const sx of [-1.0, 0, 1.0]) {
    for (const sy of [-0.35, 0.35]) {
      const tube = cyl(pitch, 0.3, 0.3, 0.4, 6, sx, sy, 1.55, 0x14171a);
      tube.rotation.x = Math.PI / 2;
      const rim = cyl(pitch, 0.34, 0.34, 0.08, 6, sx, sy, 1.74, accent, { emissive: accent, emissiveIntensity: 1.0 });
      rim.rotation.x = Math.PI / 2;
    }
  }
  const sensor = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.3 }));
  sensor.position.set(0, 0.95, 0.9);
  pitch.add(sensor);
  yaw.userData.pitch = pitch;
  outlinify(yaw, 0.1);
  return yaw;
}

/** 備援塔 / 主堡 */
/**
 * 防禦塔基座(賽璐璐重繪):六角混凝土墩 → 稜角扶壁 → 裝甲柱 → 肩環 → 感測桅杆。
 * 頭部砲塔由 buildTowerTurret 掛在 target*0.92,此處只做「機庫感」的固定結構:
 * 大色塊 + 同色系明暗分版 + 陣營光條,正面(+z)朝兵線。
 */
function buildTowerFallback(side) {
  const g = new THREE.Group();
  const accent = new THREE.Color(SIDES[side].color);

  // 垂直佈局硬約束:makeUnit 先 fitToHeight(整體高 = target)才把砲塔掛在 target*0.92,
  // 所以「座圈唇緣頂面 / 全高」必須剛好 = 0.92(17.25 / 18.75),否則砲塔會浮空或陷進柱子。
  const TOP = 18.75, RING = TOP * 0.92;   // 天線頂 / 座圈頂

  // 六角基墩:兩階,下階外擴(手繪剪影靠俐落的收分)
  const plinth = cyl(g, 5.0, 5.8, 1.6, 6, 0, 0.8, 0, 0x5b656e);
  plinth.rotation.y = Math.PI / 6;
  const podium = cyl(g, 4.0, 4.8, 2.2, 6, 0, 2.6, 0, 0x6d7883);
  podium.rotation.y = Math.PI / 6;

  // 四向稜角扶壁:斜切塊撐住主柱,腳邊留一圈陰影帶
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const but = bx(g, 1.5, 5.2, 2.6, Math.sin(a) * 3.1, 4.0, Math.cos(a) * 3.1, 0x59636d);
    but.rotation.y = a;
    but.rotation.x = 0.12;
  }

  // 主裝甲柱:八角收分 + 兩側裝甲板 + 散熱柵
  const shaft = cyl(g, 2.0, 3.0, 11.4, 8, 0, 7.8, 0, 0x77828e);
  shaft.rotation.y = Math.PI / 8;
  for (const s of [-1, 1]) {
    bx(g, 0.5, 7.6, 2.9, s * 2.35, 7.8, 0, 0x616b76);      // 側裝甲板
    bx(g, 0.18, 5.0, 0.5, s * 2.62, 7.8, 0, accent,
      { emissive: accent, emissiveIntensity: 0.55 });                  // 陣營光條
    for (let k = 0; k < 3; k++) bx(g, 0.62, 0.3, 2.2, s * 2.2, 4.3 + k * 0.9, 0, 0x454e57);  // 散熱柵
  }
  bx(g, 3.4, 0.8, 3.4, 0, 3.6, 0, 0x5a646e);                          // 柱腳護環
  bx(g, 2.2, 1.4, 0.8, 0, 5.2, 2.0, 0x454e57);                        // 正面維修艙門(+z 朝兵線)

  // 肩環:承載砲塔的旋轉座圈
  const collar = cyl(g, 3.6, 2.6, 2.9, 8, 0, RING - 1.75, 0, 0x525c66);
  collar.rotation.y = Math.PI / 8;
  cyl(g, 3.9, 3.9, 0.5, 8, 0, RING - 0.25, 0, 0x6d7883);   // 座圈唇緣(頂面 = RING)
  for (let i = 0; i < 6; i++) {                                        // 環繞警示燈
    const a = i * Math.PI / 3;
    bx(g, 0.34, 0.34, 0.34, Math.sin(a) * 3.7, RING - 0.25, Math.cos(a) * 3.7, accent,
      { emissive: accent, emissiveIntensity: 1.1 });
  }

  // 彈藥莢艙 + 感測桅杆(剪影上的不對稱重點)
  for (const s of [-1, 1]) {
    const pod = bx(g, 1.3, 3.2, 1.8, s * 3.4, 12.2, -0.6, 0x59636d);
    pod.rotation.z = s * 0.16;
  }
  cyl(g, 0.12, 0.16, 3.0, 5, -2.7, TOP - 1.5, -1.6, 0x3a4149);        // 天線(全模型最高點)
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.0, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x5a646e));
  dish.position.set(2.6, 15.6, -1.4);
  dish.rotation.set(-0.9, 0, 0.3);
  g.add(dish);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.75, 10, 8), mat(accent, { emissive: accent, emissiveIntensity: 1.2 }));
  eye.position.set(0, RING - 1.4, 2.4);
  g.add(eye);
  return g;
}
function buildBaseFallback(side) {
  const g = new THREE.Group();
  const accent = new THREE.Color(SIDES[side].color);
  const podium = new THREE.Mesh(new THREE.CylinderGeometry(16, 20, 6, 10), mat(0x3c444c));
  podium.position.y = 3;
  g.add(podium);
  const core = side === 'SWARM'
    ? new THREE.Mesh(new THREE.SphereGeometry(11, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x2a2416))
    : new THREE.Mesh(new THREE.BoxGeometry(16, 22, 16), mat(0x2a3038));
  core.position.y = side === 'SWARM' ? 6 : 17;
  g.add(core);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(2.4, 10, 8), mat(accent, { emissive: accent, emissiveIntensity: 1 }));
  beacon.position.y = side === 'SWARM' ? 19 : 30;
  g.add(beacon);
  return g;
}

/**
 * 防禦塔程序砲塔頭(計畫 Task 2.2:procedural aiming)。
 * 結構:yaw 樞軸 → pitch 樞軸 → 雙管砲;game.js 每幀平滑轉向目標,
 * 俯仰限制 -30°~+60°(機械關節極限)。砲管沿 +z,pitch.rotation.x 負值抬升。
 */
function buildTowerTurret(side) {
  if (side === 'SWARM') return buildSwarmTowerTurret(side);   // 陣營差異化:蜂群 = 飛彈莢艙
  const accent = new THREE.Color(SIDES[side].color);
  const yaw = new THREE.Group();
  const head = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.7, 4.0), mat(0x4a545e, { metalness: 0.7 }));
  head.position.y = 0.4;
  yaw.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.7, 0.9, 8), mat(0x5c6670));
  cap.position.y = 1.5;
  yaw.add(cap);
  const pitch = new THREE.Group();
  pitch.position.set(0, 0.55, 1.1);
  for (const sx of [-0.55, 0.55]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 4.6, 8), mat(0x14171a, { metalness: 0.9 }));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(sx, 0, 2.0);
    pitch.add(barrel);
    const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.5, 8), mat(0x0d0f11));
    brake.rotation.x = Math.PI / 2;
    brake.position.set(sx, 0, 4.1);
    pitch.add(brake);
  }
  const sensor = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.2 }));
  sensor.position.set(0, 0.9, 1.6);
  pitch.add(sensor);
  yaw.add(pitch);
  yaw.userData.pitch = pitch;
  outlinify(yaw, 0.1);
  return yaw;
}

const FALLBACK = {
  'hero:drone': (side, vis) => buildDrone(side, vis),
  'hero:robot': (side, vis) => buildRobotMech(side, vis),
  'hero:morph': (side, vis) => buildMorphMech(side, vis),
  decoy: (side, vis) => buildDecoy(side, vis),
  // NPC/塔陣營差異化:鋼鐵 = 履帶/輪式軍武;蜂群 = 懸浮/旋翼/機器人重塑版
  // 人類步兵外觀雙方對調:蜂群 = 人類部隊、鋼鐵 = 機器人部隊(2026-07-11)
  'creep:soldier': (side) => (side === 'SWARM' ? buildSoldierFallback(side) : buildSwarmTrooper(side)),
  'creep:apc': (side) => (side === 'SWARM' ? buildSwarmApc(side) : buildApc(side)),
  'creep:tank': (side) => (side === 'SWARM' ? buildSwarmTank(side) : buildTank(side)),
  'creep:rocketeer': (side) => (side === 'SWARM' ? buildRocketeerFallback(side) : buildSwarmTrooper(side, { rocket: true })),
  'creep:howitzer': (side) => (side === 'SWARM' ? buildSwarmHowitzer(side) : buildHowitzerFallback(side)),
  'creep:heli': (side) => (side === 'SWARM' ? buildSwarmHeli(side) : buildHeliFallback(side)),
  tower: (side) => (side === 'SWARM' ? buildSwarmTower(side) : buildTowerFallback(side)),
  'base:SWARM': () => buildBaseFallback('SWARM'),
  'base:STEEL': () => buildBaseFallback('STEEL'),
};

/** 找 walk / run 動畫,讓小兵走路(Quaternius 動畫角色) */
function pickWalkClip(anims) {
  if (!anims?.length) return null;
  return anims.find((c) => /\|Walk$/.test(c.name))
    || anims.find((c) => /walk/i.test(c.name))
    || anims.find((c) => /\|Run$/.test(c.name))
    || null;
}

/**
 * 建立一個單位 mesh。回傳 { group, mixer? }。
 * kind: 'hero:drone' | 'hero:robot' | 'creep:soldier' | 'creep:apc' | 'creep:tank' | 'tower' | 'base:SWARM' | 'base:STEEL'
 * opts.ch:英雄角色 id — 依 CHARACTERS[ch].visual 生成專屬機體(主色/機架/掛件)。
 */
export function makeUnit(kind, side, { ring = true, ch = null } = {}) {
  const vis = ch && CHARACTERS[ch] ? CHARACTERS[ch].visual : null;
  // 獸型機甲(四足/雙足)/ 擬態翼/定翼無人機:跳過 GLB,一律程序生成(角色剪影差異化)
  const beast = kind === 'hero:robot' && vis?.form === 'beast';
  const biped = kind === 'hero:robot' && vis?.form === 'biped';
  const avian = kind === 'hero:drone' && vis?.form === 'avian';
  const fixedW = kind === 'hero:drone' && vis?.form === 'fixed';
  const entry = !beast && !biped && !avian && !fixedW && MODEL_MANIFEST[kind] ? cache[kind] : null;
  // 英雄體型綁角色護甲(heroTargetH 內含獸型矮化);其餘查表
  const heroKind = kind.startsWith('hero:') ? kind.slice(5) : null;
  const target = heroKind ? heroTargetH(heroKind, ch) : (TARGET_H[kind] || 4);
  const g = new THREE.Group();
  let mixer = null;

  if (entry) {
    const model = SkeletonUtils.clone(entry.scene);
    toonify(model);   // GLB 也重新渲染成賽璐璐(保留貼圖/顏色)
    fitToHeight(model, target);
    outlinify(model, outlineW(target));   // 反轉外殼漫畫描邊(骨骼動畫共用骨架)
    // skinned mesh 的包圍球以綁定姿勢計算,經縮放+動畫後會被視錐剔除
    // 導致模型「消失」,一律關閉 frustum culling
    model.traverse((o) => { if (o.isSkinnedMesh || o.isMesh) o.frustumCulled = false; });
    g.add(model);
    // 機甲角色差異化:共用 GLB 骨架 + 專屬掛件/識別燈條
    if (vis && kind === 'hero:robot') {
      const pod = charPod(vis, target);
      outlinify(pod, outlineW(target));
      g.add(pod);
    }
    // 步行 clip:交給 locomotion.js 以實際地速調 timeScale(靜止不原地滑步)
    const clip = (kind === 'creep:soldier' || kind === 'hero:robot')
      ? pickWalkClip(entry.animations) : null;
    if (clip) {
      mixer = new THREE.AnimationMixer(model);
      const action = mixer.clipAction(clip);
      action.time = Math.random() * clip.duration;   // 錯開步伐
      action.play();
      g.userData.walk = action;
      // timeScale=1 的參考地速(m/s):步幅正比於身高,故 walkRef 必須隨 target 縮放,
      // 否則體型一改就原地滑步(係數 = 舊制 walkRef ÷ 舊制身高)
      g.userData.walkRef = target * (kind === 'hero:robot' ? 9 / 6 : 6 / 3.2);
    }
  } else {
    const build = beast ? buildBeastMech
      : biped ? buildBipedBeast
      : avian ? buildAvianDrone
      : fixedW ? buildFixedWing
      : (FALLBACK[kind] || FALLBACK['creep:apc']);
    const built = build(side, vis);
    // 角色性格花紋(paint.js):MUST 在 fitToHeight/outlinify 之前 —— 靜止姿勢矩陣才是
    // 花紋的錨(縮放後仍成立:矩陣取的是「相對 built 根」的局部變換);描邊外殼不吃塗裝。
    if (vis) paintUnit(built, vis, side, beast || kind === 'hero:drone' || kind === 'hero:morph' ? 'dark' : 'light');
    fitToHeight(built, target);
    outlinify(built, outlineW(target));
    g.add(built);
    if (built.userData.spin) g.userData.spin = built.userData.spin;
    // 車載砲塔(坦克):提上外層 group,game.js _aimVehicleTurret 才找得到
    if (built.userData.turret) g.userData.turret = built.userData.turret;
    // 程序骨架(locomotion.js):記錄 fitToHeight 縮放供步幅/輪半徑換算世界尺度
    if (built.userData.rig) {
      built.userData.rig.s = built.scale.x;
      g.userData.rig = built.userData.rig;
    }
  }

  // 機甲:肩上的餌機掛點(F 分離發射;顯隱/組合動畫見 game.js _updateDecoyPod)
  if (kind === 'hero:robot' || kind === 'hero:morph') {
    const pod = decoyPod(side, vis, target);
    outlinify(pod, outlineW(target));
    g.add(pod);
    g.userData.decoyPod = pod;
  }

  // 防禦塔:頂部加程序砲塔頭(每幀追蹤目標;見 game.js _aimTurret)
  if (kind === 'tower') {
    const turret = buildTowerTurret(side);
    turret.position.y = target * 0.92;
    g.add(turret);
    g.userData.turret = turret;
  }

  if (ring) g.add(teamRing(side, Math.max(1.1, target * 0.55)));
  g.userData.kind = kind;
  g.userData.side = side;
  return { group: g, mixer };
}
