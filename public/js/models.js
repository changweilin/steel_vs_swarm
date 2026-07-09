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

// 單位 → GLB 檔(Quaternius,CC0 1.0;None = 直接用程式生成)
export const MODEL_MANIFEST = Object.assign({
  'hero:robot':   'assets/models/quaternius/pawn-mech.glb',     // 執法者機甲
  'hero:drone':   null,                                          // 無人機:程式生成四旋翼
  'creep:soldier': 'assets/models/quaternius/pawn-casual.glb',  // 步槍兵
  'creep:apc':    null,                                          // 裝甲車:程式生成
  'creep:tank':   null,                                          // 坦克:程式生成
  'creep:rocketeer': null,                                        // 火箭兵:程式生成
  'creep:howitzer':  null,                                        // 榴彈兵:程式生成
  'creep:heli':      null,                                        // 攻擊直升機:程式生成
  'tower':        'assets/models/quaternius/silo.glb',          // 防禦塔
  'base:SWARM':   'assets/models/quaternius/dome.glb',          // 蜂群主堡(穹頂)
  'base:STEEL':   'assets/models/quaternius/structure.glb',     // 鋼鐵主堡(工業塔)
}, (typeof window !== 'undefined' && window.MODEL_MANIFEST_EXTRA) || {});

// 單位顯示高度(公尺;fitToHeight 自動縮放)
const TARGET_H = {
  'hero:robot': 6, 'hero:drone': 3,
  'creep:soldier': 3.2, 'creep:apc': 4.5, 'creep:tank': 5,
  'creep:rocketeer': 3.4, 'creep:howitzer': 4, 'creep:heli': 4.2,
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

// ---------- 程式生成備援模型 ----------
/**
 * 武裝無人機(蜂群英雄)——角色專屬機體:
 * vis = CHARACTERS[ch].visual = { hue 主色, frame 'quad'|'hexa'|'coax'|'wing', body 'box'|'wedge'|'sphere'|'slab'|'frame' }。
 * 未指定角色(觀戰/舊路徑)退回預設四旋翼。
 */
function buildDrone(side, vis = null) {
  const g = new THREE.Group();
  const accent = new THREE.Color(vis?.hue ?? SIDES[side].color);
  // 機身(依角色差異化剪影)
  const bodyKind = vis?.body || 'box';
  let body;
  if (bodyKind === 'wedge') {
    body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.95, 2.0, 4), mat(0x22262b, { metalness: 0.6 }));
    body.rotation.x = Math.PI / 2;
    body.rotation.y = Math.PI / 4;
  } else if (bodyKind === 'sphere') {
    body = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 9), mat(0x272b31, { metalness: 0.5 }));
  } else if (bodyKind === 'slab') {
    body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 1.5), mat(0x2a2e33, { metalness: 0.6 }));
  } else if (bodyKind === 'frame') {
    body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.26, 1.4), mat(0x22262b, { metalness: 0.6 }));
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 1.7), mat(0x3a4148));
      rail.position.set(sx * 0.65, 0.06, 0);
      body.add(rail);
    }
  } else {
    body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.6), mat(0x22262b, { metalness: 0.6 }));
  }
  body.position.y = 1.2;
  g.add(body);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), mat(accent, { emissive: accent, emissiveIntensity: 0.6 }));
  dome.position.y = 1.55;
  g.add(dome);
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.2, 8), mat(0x111418, { metalness: 0.8 }));
  gun.rotation.x = Math.PI / 2;
  gun.position.set(0, 1.0, 0.9);
  g.add(gun);
  // 機架與旋翼(quad 四軸 / hexa 六軸 / coax 同軸雙槳 / wing 固定翼混合)
  const props = [];
  const addRotor = (x, z, big = 1) => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(x, z) * 1.05 + 0.4, 0.12, 0.18), mat(0x3a4148));
    arm.position.set(x * 0.62, 1.35, z * 0.62);
    arm.rotation.y = Math.atan2(-z, x);   // 機臂沿徑向
    g.add(arm);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.22, 8), mat(0x14171a));
    hub.position.set(x, 1.42, z);
    g.add(hub);
    const prop = new THREE.Mesh(new THREE.BoxGeometry(1.5 * big, 0.04, 0.14), mat(0x9aa4ad, { transparent: true, opacity: 0.85 }));
    prop.position.set(x, 1.55, z);
    g.add(prop);
    props.push(prop);
  };
  const frame = vis?.frame || 'quad';
  if (frame === 'hexa') {
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 + Math.PI / 6;
      addRotor(Math.cos(a) * 1.55, Math.sin(a) * 1.55, 0.85);
    }
  } else if (frame === 'coax') {
    for (const y of [1.55, 1.85]) {
      const prop = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.05, 0.2), mat(0x9aa4ad, { transparent: true, opacity: 0.85 }));
      prop.position.y = y;
      g.add(prop);
      props.push(prop);
    }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.8, 8), mat(0x14171a));
    mast.position.y = 1.6;
    g.add(mast);
  } else if (frame === 'wing') {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.08, 0.75), mat(0x3a4148));
    wing.position.y = 1.35;
    g.add(wing);
    for (const sx of [-1, 1]) addRotor(sx * 1.3, -0.5, 0.8);
  } else {
    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) addRotor(sx * 1.55, sz * 1.55);
  }
  // 姿態視覺錨點:航行燈(左紅右綠)+ 雲台攝影機 — 壓坡/俯仰時方位一目了然
  bx(g, 0.1, 0.06, 0.22, -0.85, 1.28, 0, 0xff5544, { emissive: 0xff3322, emissiveIntensity: 1.6 });
  bx(g, 0.1, 0.06, 0.22, 0.85, 1.28, 0, 0x55ff88, { emissive: 0x22ff66, emissiveIntensity: 1.6 });
  cyl(g, 0.12, 0.12, 0.2, 8, 0, 0.86, 0.55, 0x23262a);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.2 }));
  lens.position.set(0, 0.78, 0.62);
  g.add(lens);
  // 壓坡樞軸(locomotion.js Task 1.1):整機掛在機身重心高度的 tilt 下,
  // 橫移壓坡 / 前傾 / 懸停浮沉都轉這個群組,不動根節點(定位/描邊不受影響)
  const tilt = new THREE.Group();
  tilt.position.y = 1.3;
  for (const k of [...g.children]) { k.position.y -= 1.3; tilt.add(k); }
  g.add(tilt);
  g.userData.spin = props; // 每幀旋轉
  g.userData.rig = { kind: 'aerial', tilt, tiltY0: 1.3, bob: 0.06, top: 30 };
  return g;
}

/**
 * 機甲角色掛件(GLB 共用骨架上的專屬差異化):
 * vis.pod = 'antenna'|'cannon'|'dish'|'shield'|'rack'|'blade'|'twin'|'none';
 * 一律加胸前主色識別燈條。座標以 fitToHeight 後的機體(高 target、腳底 y=0)為準。
 */
function charPod(vis, target) {
  const g = new THREE.Group();
  const accent = new THREE.Color(vis?.hue ?? 0xffffff);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(target * 0.22, target * 0.035, target * 0.03),
    mat(accent, { emissive: accent, emissiveIntensity: 1.1 }));
  trim.position.set(0, target * 0.62, target * 0.14);
  g.add(trim);
  const sy = target * 0.78, sx = target * 0.22;   // 右肩基準
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
 * 主戰坦克 — 全車(含履帶)掛懸吊樞軸,轉彎側傾/煞車點頭幅度小、慣性大;
 * 外露路輪轉速 = 線速度(消除滑行感)。砲塔總成:艙蓋/尾艙置物/觀瞄鏡/排煙器。
 */
function buildTank(side) {
  const g = new THREE.Group();
  const accent = new THREE.Color(SIDES[side].colorDim);
  const hull = new THREE.Group();
  g.add(hull);
  bx(hull, 3.4, 1.2, 6.4, 0, 1.35, 0, 0x4c5245);                         // 車體
  const glacis = bx(hull, 3.2, 0.7, 1.3, 0, 1.7, 3.0, 0x434a3e);         // 前斜甲
  glacis.rotation.x = 0.42;
  bx(hull, 3.0, 0.2, 5.4, 0, 2.0, -0.3, 0x454c40);                       // 引擎甲板
  bx(hull, 1.4, 0.24, 1.2, 0, 2.06, -2.2, 0x394037);                     // 引擎散熱柵
  for (const s of [-1, 1]) {
    bx(hull, 0.9, 1.1, 6.8, s * 1.85, 0.85, 0, 0x23262a);                // 履帶
    bx(hull, 0.96, 0.28, 6.2, s * 1.85, 1.52, 0, 0x3a4136);              // 履帶上護板
    bx(hull, 0.98, 0.12, 5.6, s * 1.85, 1.72, 0, accent);                // 陣營識別條
  }
  // 外露路輪(下半可見;locomotion 依半徑換算轉速)
  const wheels = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const w = cyl(hull, 0.42, 0.42, 0.95, 10, s * 1.85, 0.5, -2.4 + i * 1.2, 0x14171a);
      w.rotation.z = Math.PI / 2;
      cyl(w, 0.16, 0.16, 0.98, 8, 0, 0, 0, 0x2c3033);                    // 輪轂
      wheels.push({ m: w, r: 0.42 });
    }
  }
  // 砲塔總成
  const turret = new THREE.Group();
  turret.position.set(0, 2.4, -0.4);
  hull.add(turret);
  cyl(turret, 1.15, 1.45, 0.95, 10, 0, 0, 0, accent);
  bx(turret, 0.7, 0.16, 0.7, 0.45, 0.56, -0.3, 0x394037);                // 車長艙蓋
  bx(turret, 1.6, 0.5, 0.6, 0, 0.1, -1.3, 0x3a4136);                     // 尾艙置物架
  bx(turret, 0.3, 0.22, 0.3, 0.75, 0.6, 0.4, 0x141a20,
    { emissive: 0x9adfff, emissiveIntensity: 0.7 });                     // 觀瞄鏡
  cyl(turret, 0.02, 0.03, 1.3, 5, -0.8, 0.95, -0.5, 0x23262a);           // 天線
  const gun = cyl(turret, 0.14, 0.17, 4.6, 10, 0, 0.05, 2.4, 0x14171a, { metalness: 0.8 });
  gun.rotation.x = Math.PI / 2;
  cyl(gun, 0.2, 0.2, 0.5, 8, 0, 0.9, 0, 0x1e2226);                       // 排煙器
  cyl(gun, 0.22, 0.22, 0.35, 8, 0, 2.2, 0, 0x0d0f11);                    // 砲口制退器
  g.userData.rig = { kind: 'tracked', hull, hullY0: 0, wheels, top: 9 };
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
    // 突擊步槍(槍身/槍管/彈匣分件)掛右手
    const rifle = bx(armR, 0.09, 0.16, 1.05, 0.03, -0.82, 0.4, 0x1a1d20);
    bx(rifle, 0.045, 0.07, 0.4, 0, 0.02, 0.65, 0x30373f, { metalness: 0.85 });
    bx(rifle, 0.07, 0.22, 0.12, 0, -0.16, 0.1, 0x23262a);
  }
  g.userData.rig = {
    kind: 'biped', hips, legL, legR, armL, armR,
    hipsY0: hipY, stride: 0.95, bob: 0.07, sway: 0.06, top: 8, gunArm: true,
  };
  return g;
}

/** 備援步兵(GLB 失敗時)— 可動骨架 */
function buildSoldierFallback(side) {
  return buildTrooper(side, {
    fatigue: 0x5a6148, vest: 0x3a4034, pad: 0x474e3c, helmet: 0x3d4436, weapon: 'rifle',
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

/** 備援攻擊直升機(機身+尾桁+主旋翼,userData.spin 供每幀轉動) */
function buildHeliFallback(side) {
  const g = new THREE.Group();
  const accent = new THREE.Color(SIDES[side].color);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 1.6, 4, 8), mat(0x3a4038));
  body.rotation.z = Math.PI / 2;
  body.position.y = 1.6;
  g.add(body);
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), mat(accent, { emissive: accent, emissiveIntensity: 0.4 }));
  cockpit.position.set(1.15, 1.6, 0);
  g.add(cockpit);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, 2.6, 8), mat(0x2c322a));
  tail.rotation.z = Math.PI / 2;
  tail.position.set(-2.2, 1.75, 0);
  g.add(tail);
  const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.12), mat(0x9aa4ad, { transparent: true, opacity: 0.85 }));
  tailRotor.position.set(-3.4, 1.75, 0);
  g.add(tailRotor);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 8), mat(0x14171a));
  hub.position.y = 2.35;
  g.add(hub);
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.05, 0.16), mat(0x9aa4ad, { transparent: true, opacity: 0.85 }));
  rotor.position.y = 2.42;
  g.add(rotor);
  for (const skidX of [-0.9, 0.9]) {
    const skid = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 2.6), mat(0x1c1f22));
    skid.position.set(skidX, 0.55, 0);
    g.add(skid);
  }
  // 短翼 + 火箭莢艙 + 尾翼識別條(攻擊直升機剪影)
  bx(g, 2.4, 0.1, 0.55, 0, 1.5, -0.3, 0x333a30);
  for (const s of [-1, 1]) {
    const pod = cyl(g, 0.18, 0.18, 0.9, 8, s * 1.05, 1.42, -0.3, 0x2c3033);
    pod.rotation.x = Math.PI / 2;
    cyl(pod, 0.14, 0.14, 0.06, 8, 0, 0.46, 0, 0xffb27a, { emissive: 0xff8844, emissiveIntensity: 0.6 });
  }
  bx(g, 0.08, 0.7, 0.5, -3.2, 2.1, 0, 0x2c322a);
  bx(g, 0.1, 0.16, 0.52, -3.2, 2.3, 0, accent);
  // 壓坡樞軸(locomotion.js):巡航壓坡 / 入彎側傾 / 浮沉整機一起動
  const tilt = new THREE.Group();
  tilt.position.y = 1.6;
  for (const k of [...g.children]) { k.position.y -= 1.6; tilt.add(k); }
  g.add(tilt);
  g.userData.spin = [rotor, tailRotor];
  g.userData.rig = { kind: 'aerial', tilt, tiltY0: 1.6, bob: 0.05, top: 16 };
  return g;
}

/** 備援塔 / 主堡 */
function buildTowerFallback(side) {
  const g = new THREE.Group();
  const accent = new THREE.Color(SIDES[side].color);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 16, 8), mat(0x4b555f));
  shaft.position.y = 8;
  g.add(shaft);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(3, 2.2, 3.4, 8), mat(0x333a41));
  head.position.y = 17.5;
  g.add(head);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), mat(accent, { emissive: accent, emissiveIntensity: 0.9 }));
  eye.position.y = 18;
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
  const accent = new THREE.Color(SIDES[side].color);
  const yaw = new THREE.Group();
  const head = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.7, 4.0), mat(0x2b3239, { metalness: 0.7 }));
  head.position.y = 0.4;
  yaw.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.7, 0.9, 8), mat(0x39424b));
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
  'hero:robot': (side, vis) => buildDrone(side, vis), // mech GLB 失敗時暫用無人機骨架換色
  'creep:soldier': (side) => buildSoldierFallback(side),
  'creep:apc': (side) => buildApc(side),
  'creep:tank': (side) => buildTank(side),
  'creep:rocketeer': (side) => buildRocketeerFallback(side),
  'creep:howitzer': (side) => buildHowitzerFallback(side),
  'creep:heli': (side) => buildHeliFallback(side),
  tower: (side) => buildTowerFallback(side),
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
  const entry = MODEL_MANIFEST[kind] ? cache[kind] : null;
  const target = TARGET_H[kind] || 4;
  const g = new THREE.Group();
  let mixer = null;
  const vis = ch && CHARACTERS[ch] ? CHARACTERS[ch].visual : null;

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
      g.userData.walkRef = kind === 'hero:robot' ? 9 : 6;   // timeScale=1 的參考地速(m/s)
    }
  } else {
    const built = (FALLBACK[kind] || FALLBACK['creep:apc'])(side, vis);
    fitToHeight(built, target);
    outlinify(built, outlineW(target));
    g.add(built);
    if (built.userData.spin) g.userData.spin = built.userData.spin;
    // 程序骨架(locomotion.js):記錄 fitToHeight 縮放供步幅/輪半徑換算世界尺度
    if (built.userData.rig) {
      built.userData.rig.s = built.scale.x;
      g.userData.rig = built.userData.rig;
    }
  }

  // 防禦塔:頂部加程序砲塔頭(每幀追蹤目標;見 game.js _aimTurret)
  if (kind === 'tower') {
    const turret = buildTowerTurret(side);
    turret.position.y = target * 0.92;
    g.add(turret);
    g.userData.turret = turret;
  }

  if (ring) g.add(teamRing(side, Math.max(2.2, target * 0.55)));
  g.userData.kind = kind;
  g.userData.side = side;
  return { group: g, mixer };
}
