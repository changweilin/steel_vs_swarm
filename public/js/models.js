// ============ 3D 單位模型(Quaternius CC0 優先,程式生成備援)============
// 設計沿用 ai_tycoon board3d.js 的 MODEL_MANIFEST 機制:
// 每種單位先嘗試載入 assets/models/quaternius/ 下的 GLB,
// 載入失敗自動退回 Three.js 程式生成的低多邊形版本,不開天窗。
// 想換模型:丟新 .glb 進資料夾、改下面 manifest 一行即可。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { SIDES } from './data.js';

// 單位 → GLB 檔(Quaternius,CC0 1.0;None = 直接用程式生成)
export const MODEL_MANIFEST = Object.assign({
  'hero:robot':   'assets/models/quaternius/pawn-mech.glb',     // 執法者機甲
  'hero:drone':   null,                                          // 無人機:程式生成四旋翼
  'creep:soldier': 'assets/models/quaternius/pawn-casual.glb',  // 人類步兵
  'creep:apc':    null,                                          // 裝甲車:程式生成
  'creep:tank':   null,                                          // 坦克:程式生成
  'tower':        'assets/models/quaternius/silo.glb',          // 防禦塔
  'base:SWARM':   'assets/models/quaternius/dome.glb',          // 蜂群主堡(穹頂)
  'base:STEEL':   'assets/models/quaternius/structure.glb',     // 鋼鐵主堡(工業塔)
}, (typeof window !== 'undefined' && window.MODEL_MANIFEST_EXTRA) || {});

// 單位顯示高度(公尺;fitToHeight 自動縮放)
const TARGET_H = {
  'hero:robot': 6, 'hero:drone': 3,
  'creep:soldier': 3.2, 'creep:apc': 4.5, 'creep:tank': 5,
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
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.35, ...opts });
}

// ---------- 程式生成備援模型 ----------
/** 四旋翼武裝無人機(蜂群英雄) */
function buildDrone(side) {
  const g = new THREE.Group();
  const accent = new THREE.Color(SIDES[side].color);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.6), mat(0x22262b, { metalness: 0.6 }));
  body.position.y = 1.2;
  g.add(body);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), mat(accent, { emissive: accent, emissiveIntensity: 0.6 }));
  dome.position.y = 1.5;
  g.add(dome);
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.2, 8), mat(0x111418, { metalness: 0.8 }));
  gun.rotation.x = Math.PI / 2;
  gun.position.set(0, 1.0, 0.9);
  g.add(gun);
  const props = [];
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.18), mat(0x3a4148));
    arm.position.set(sx * 1.0, 1.35, sz * 1.0);
    arm.rotation.y = Math.atan2(sz, sx);
    g.add(arm);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.22, 8), mat(0x14171a));
    hub.position.set(sx * 1.55, 1.42, sz * 1.55);
    g.add(hub);
    const prop = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.14), mat(0x9aa4ad, { transparent: true, opacity: 0.85 }));
    prop.position.set(sx * 1.55, 1.55, sz * 1.55);
    g.add(prop);
    props.push(prop);
  }
  g.userData.spin = props; // 每幀旋轉
  return g;
}

/** 輪式裝甲運兵車 */
function buildApc(side) {
  const g = new THREE.Group();
  const accent = new THREE.Color(SIDES[side].colorDim);
  const hull = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.3, 5.2), mat(0x4a5347));
  hull.position.y = 1.5;
  g.add(hull);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 1.2), mat(0x3f4840));
  nose.position.set(0, 1.25, 2.9);
  nose.rotation.x = 0.3;
  g.add(nose);
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 0.7, 8), mat(accent));
  turret.position.y = 2.5;
  g.add(turret);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.2, 8), mat(0x14171a));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 2.55, 1.4);
  g.add(barrel);
  for (let i = 0; i < 4; i++) {
    for (const s of [-1, 1]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 12), mat(0x191c1f));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(s * 1.42, 0.55, -1.8 + i * 1.25);
      g.add(wheel);
    }
  }
  return g;
}

/** 主戰坦克 */
function buildTank(side) {
  const g = new THREE.Group();
  const accent = new THREE.Color(SIDES[side].colorDim);
  const hull = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.2, 6.4), mat(0x4c5245));
  hull.position.y = 1.35;
  g.add(hull);
  for (const s of [-1, 1]) {
    const track = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 6.8), mat(0x23262a));
    track.position.set(s * 1.85, 0.85, 0);
    g.add(track);
  }
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.45, 0.95, 10), mat(accent));
  turret.position.set(0, 2.4, -0.4);
  g.add(turret);
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 4.6, 10), mat(0x14171a, { metalness: 0.8 }));
  gun.rotation.x = Math.PI / 2;
  gun.position.set(0, 2.45, 2.0);
  g.add(gun);
  return g;
}

/** 備援步兵(GLB 失敗時) */
function buildSoldierFallback() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.15, 4, 8), mat(0x5a6148));
  body.position.y = 1.35;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), mat(0xc9a481));
  head.position.y = 2.35;
  g.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x3d4436));
  helmet.position.y = 2.42;
  g.add(helmet);
  const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 1.15), mat(0x1a1d20));
  rifle.position.set(0.32, 1.6, 0.35);
  g.add(rifle);
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

const FALLBACK = {
  'hero:drone': (side) => buildDrone(side),
  'hero:robot': (side) => buildDrone(side), // mech GLB 失敗時暫用無人機骨架換色
  'creep:soldier': () => buildSoldierFallback(),
  'creep:apc': (side) => buildApc(side),
  'creep:tank': (side) => buildTank(side),
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
 */
export function makeUnit(kind, side, { ring = true } = {}) {
  const entry = MODEL_MANIFEST[kind] ? cache[kind] : null;
  const target = TARGET_H[kind] || 4;
  const g = new THREE.Group();
  let mixer = null;

  if (entry) {
    const model = SkeletonUtils.clone(entry.scene);
    fitToHeight(model, target);
    // skinned mesh 的包圍球以綁定姿勢計算,經縮放+動畫後會被視錐剔除
    // 導致模型「消失」,一律關閉 frustum culling
    model.traverse((o) => { if (o.isSkinnedMesh || o.isMesh) o.frustumCulled = false; });
    g.add(model);
    const clip = kind === 'creep:soldier' ? pickWalkClip(entry.animations) : null;
    if (clip) {
      mixer = new THREE.AnimationMixer(model);
      const action = mixer.clipAction(clip);
      action.time = Math.random() * clip.duration;   // 錯開步伐
      action.play();
    }
  } else {
    const built = (FALLBACK[kind] || FALLBACK['creep:apc'])(side);
    fitToHeight(built, target);
    g.add(built);
    if (built.userData.spin) g.userData.spin = built.userData.spin;
  }

  if (ring) g.add(teamRing(side, Math.max(2.2, target * 0.55)));
  g.userData.kind = kind;
  g.userData.side = side;
  return { group: g, mixer };
}
