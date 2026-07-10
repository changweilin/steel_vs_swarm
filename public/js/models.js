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
  'hero:robot':   null,                                          // 執法者機甲:程序生成人型機甲(doc/image/robot 賽璐璐重構;GLB 可經 MODEL_MANIFEST_EXTRA 蓋回)
  'hero:drone':   null,                                          // 無人機:程式生成 FPV 四旋翼(doc/image/drone 賽璐璐重構)
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

// 單位顯示高度(公尺;fitToHeight 自動縮放)
const TARGET_H = {
  // decoy:fitToHeight 量的是「高度」— 餌機高 ≈ 0.99 / 長 ≈ 2.2,取 1.4 得機身長約 3.1m
  'hero:robot': 6, 'hero:drone': 3, 'hero:morph': 6, 'hero:beast': 5, decoy: 1.4,
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
  const carbon = 0x22262b, carbonLt = 0x343b42, shell = 0x2b3036;
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
 * 飛行生物型無人機(form:'avian'):鳥/蜂剪影 + 拍翼樞軸(mobility_plan Task 2.2 延伸)。
 * 仍是無人機(機械感細節:艙蓋/感測眼/航行燈),但升力來自撲翼 —
 * locomotion.js stepAerial 依速度驅動拍翼頻率/振幅,外翼相位延遲(follow-through)。
 * creature: 'wasp'(雙對半透明蟲翼+螫尾)| 'raptor' | 'falcon' | 'swallow'(燕尾)。
 */
const AVIAN = {
  wasp:    { span: 1.5, pairs: 2, tail: 'stinger', body: 1.15 },
  raptor:  { span: 2.5, pairs: 1, tail: 'fan',     body: 1.0 },
  falcon:  { span: 2.2, pairs: 1, tail: 'fan',     body: 0.9 },
  swallow: { span: 2.6, pairs: 1, tail: 'fork',    body: 0.8 },
};
function buildAvianDrone(side, vis) {
  const g = new THREE.Group();
  const accent = new THREE.Color(vis?.hue ?? SIDES[side].color);
  const P = AVIAN[vis?.creature] || AVIAN.raptor;
  const dark = 0x2a2e33, mid = 0x3a4148;
  // 壓坡/拍翼都掛 tilt 樞軸下(同 buildDrone 慣例:根節點只管定位/描邊)
  const tilt = new THREE.Group();
  tilt.position.y = 1.3;
  g.add(tilt);
  const bs = P.body;
  // 胸腹(流線機身):壓扁球體;背脊裝甲板
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.62 * bs, 12, 9), mat(dark, { metalness: 0.6 }));
  body.scale.set(1, 0.82, 1.7);
  tilt.add(body);
  const spineArm = new THREE.Mesh(new THREE.BoxGeometry(0.5 * bs, 0.14, 1.3 * bs), mat(mid));
  spineArm.position.y = 0.42 * bs;
  tilt.add(spineArm);
  // 頭 + 喙(感測器眼 = 主色,左紅右綠航行燈保留姿態辨識)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34 * bs, 10, 8), mat(mid, { metalness: 0.5 }));
  head.position.set(0, 0.28 * bs, 1.05 * bs);
  tilt.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.16 * bs, 0.55 * bs, 6), mat(0x14171a, { metalness: 0.8 }));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.24 * bs, 1.45 * bs);
  tilt.add(beak);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09 * bs, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.4 }));
    eye.position.set(sx * 0.2 * bs, 0.36 * bs, 1.2 * bs);
    tilt.add(eye);
  }
  bx(tilt, 0.08, 0.05, 0.2, -0.55 * bs, 0.1, 0.4, 0xff5544, { emissive: 0xff3322, emissiveIntensity: 1.6 });
  bx(tilt, 0.08, 0.05, 0.2, 0.55 * bs, 0.1, 0.4, 0x55ff88, { emissive: 0x22ff66, emissiveIntensity: 1.6 });
  // 頜下武器艙(仍是武裝無人機)
  const gun = cyl(tilt, 0.06, 0.08, 0.9, 8, 0, -0.32 * bs, 0.8, 0x111418, { metalness: 0.8 });
  gun.rotation.x = Math.PI / 2;
  // 翼:內翼樞軸 + 外翼樞軸(拍翼由 locomotion stepAerial 驅動)
  const wings = [];
  const insect = P.pairs > 1;
  const wingMatOpts = insect
    ? { transparent: true, opacity: 0.55, emissive: accent, emissiveIntensity: 0.25 }
    : { metalness: 0.4 };
  const mkWing = (sgn, z0) => {
    const w = new THREE.Group();
    w.position.set(sgn * 0.45 * bs, 0.2 * bs, z0);
    tilt.add(w);
    const inner = new THREE.Mesh(new THREE.BoxGeometry(P.span * 0.55, 0.06, 0.7 * bs), mat(insect ? 0x9adfff : mid, wingMatOpts));
    inner.position.set(sgn * P.span * 0.28, 0, -0.08);
    w.add(inner);
    const outer = new THREE.Group();
    outer.position.set(sgn * P.span * 0.55, 0, 0);
    w.add(outer);
    const tipPanel = new THREE.Mesh(new THREE.BoxGeometry(P.span * 0.5, 0.05, 0.5 * bs), mat(insect ? 0x9adfff : dim(mid, 0.85), wingMatOpts));
    tipPanel.position.set(sgn * P.span * 0.25, 0, -0.12);
    outer.add(tipPanel);
    if (!insect) {
      // 翼尖分叉羽片(鳥類剪影)+ 主色識別羽
      for (let i = 0; i < 3; i++) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(P.span * 0.22, 0.04, 0.14 * bs), mat(i === 1 ? accent : 0x23262a));
        f.position.set(sgn * P.span * (0.5 + i * 0.04), 0, -0.4 * bs + i * 0.16 * bs);
        f.rotation.y = sgn * -0.18 * (i - 1);
        outer.add(f);
      }
    }
    wings.push({ w, outer, sgn });
  };
  for (const sgn of [-1, 1]) {
    mkWing(sgn, 0.25 * bs);
    if (insect) mkWing(sgn, -0.35 * bs);
  }
  // 尾:扇尾 / 燕尾 / 螫針(蜂)
  if (P.tail === 'stinger') {
    const st = new THREE.Mesh(new THREE.ConeGeometry(0.2 * bs, 0.9 * bs, 6), mat(accent, { emissive: accent, emissiveIntensity: 0.5 }));
    st.rotation.x = -Math.PI / 2;
    st.position.set(0, -0.05, -1.25 * bs);
    tilt.add(st);
    for (let i = 0; i < 2; i++) bx(tilt, 0.7 * bs, 0.06, 0.16, 0, 0.05 + i * 0.12, -0.8 * bs - i * 0.1, 0x14171a);
  } else if (P.tail === 'fork') {
    for (const sx of [-1, 1]) {
      const f = bx(tilt, 0.16 * bs, 0.05, 1.1 * bs, sx * 0.2 * bs, 0, -1.35 * bs, mid);
      f.rotation.y = sx * 0.22;
    }
  } else {
    for (let i = -1; i <= 1; i++) {
      const f = bx(tilt, 0.22 * bs, 0.05, 0.95 * bs, i * 0.22 * bs, 0, -1.3 * bs, i === 0 ? accent : mid);
      f.rotation.y = i * 0.28;
    }
  }
  g.userData.rig = { kind: 'aerial', tilt, tiltY0: 1.3, bob: 0.1, top: 30, wings };
  return g;
}

/**
 * 獸型機甲(form:'beast'):四足步態骨架(mobility_plan Task 2.2)。
 * rig 樞軸:四髖(legFL/FR/HL/HR)+ 脊椎(spine→chest→neck 波傳導)+ 雙節尾(配重)。
 * creature: 'bear'(壯碩)| 'wolf'(修長長尾)| 'panther'(低伏)| 'rhino'(重甲+鼻角)。
 */
const BEAST = {
  bear:    { bulk: 1.25, hipY: 2.0, tailLen: 0.7, ear: 0.16, snoutL: 0.6 },
  wolf:    { bulk: 0.95, hipY: 2.0, tailLen: 1.6, ear: 0.22, snoutL: 0.95 },
  panther: { bulk: 0.85, hipY: 1.7, tailLen: 1.9, ear: 0.14, snoutL: 0.75 },
  rhino:   { bulk: 1.45, hipY: 2.1, tailLen: 0.5, ear: 0,    snoutL: 0.55, horn: true },
};
function buildBeastMech(side, vis) {
  const g = new THREE.Group();
  const accent = new THREE.Color(vis?.hue ?? SIDES[side].color);
  const P = BEAST[vis?.creature] || BEAST.wolf;
  const B = P.bulk, hipY = P.hipY;
  const hull = 0x3c444d, hullDk = 0x333b43, plate = 0x46505b;
  // 脊椎樞軸(浮沉/入彎傾斜/波傳導的根)
  const spine = new THREE.Group();
  spine.position.y = hipY;
  g.add(spine);
  bx(spine, 1.5 * B, 1.2 * B, 2.2, 0, 0.05, -0.9, hullDk, { metalness: 0.6 });   // 後軀
  bx(spine, 1.3 * B, 0.2, 2.0, 0, 0.68 * B, -0.9, dim(plate, 0.9));              // 背甲(後)
  // 胸(次級樞軸:波傳導第二節)
  const chest = new THREE.Group();
  chest.position.set(0, 0.1, 0.55);
  spine.add(chest);
  bx(chest, 1.7 * B, 1.45 * B, 2.0, 0, 0.1, 0.55, hull, { metalness: 0.6 });     // 前胸
  bx(chest, 1.5 * B, 0.22, 1.7, 0, 0.85 * B, 0.5, plate);                        // 背甲(前)
  bx(chest, 1.72 * B, 0.16, 0.5, 0, 0.35 * B, 1.5, accent,
    { emissive: accent, emissiveIntensity: 0.9 });                               // 胸前識別燈條
  // 頸(第三節)+ 頭
  const neck = new THREE.Group();
  neck.position.set(0, 0.55 * B, 1.55);
  chest.add(neck);
  bx(neck, 0.7 * B, 0.6 * B, 0.9, 0, 0.18, 0.3, hullDk);
  const head = new THREE.Group();
  head.position.set(0, 0.45 * B, 0.8);
  neck.add(head);
  bx(head, 0.85 * B, 0.65 * B, 0.9, 0, 0, 0.2, plate, { metalness: 0.6 });       // 顱殼
  bx(head, 0.5 * B, 0.4 * B, P.snoutL, 0, -0.12 * B, 0.75 + P.snoutL / 2, hullDk); // 吻部
  bx(head, 0.52 * B, 0.14, 0.3, 0, -0.34 * B, 0.85, 0x23262a);                   // 下顎
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.56 * B, 0.1, 0.06), mat(accent, { emissive: accent, emissiveIntensity: 1.6 }));
  eye.position.set(0, 0.12 * B, 0.68);
  head.add(eye);                                                                 // 單列感測眼(獸瞳)
  if (P.ear) for (const sx of [-1, 1]) {
    const ear = bx(head, 0.14, P.ear * 2.4, 0.1, sx * 0.3 * B, 0.42 * B, 0.1, hullDk);
    ear.rotation.z = sx * -0.2;
  }
  if (P.horn) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.8, 6), mat(0xd8dde2, { metalness: 0.7 }));
    horn.position.set(0, 0.18 * B, 1.1);
    horn.rotation.x = 0.5;
    head.add(horn);
  }
  // 雙節尾(急轉配重 + 行走搖擺;locomotion 驅動)
  const tail = new THREE.Group();
  tail.position.set(0, 0.35 * B, -2.0);
  spine.add(tail);
  bx(tail, 0.26 * B, 0.22 * B, P.tailLen, 0, 0, -P.tailLen / 2, hullDk);
  const tail2 = new THREE.Group();
  tail2.position.set(0, 0, -P.tailLen);
  tail.add(tail2);
  bx(tail2, 0.16 * B, 0.14 * B, P.tailLen * 0.8, 0, 0, -P.tailLen * 0.4, 0x23262a);
  bx(tail2, 0.18 * B, 0.16 * B, 0.2, 0, 0, -P.tailLen * 0.8, accent, { emissive: accent, emissiveIntensity: 0.8 });
  // 四腿:髖樞軸 + 逆關節小腿 + 足爪(腿掛根節點,脊椎浮沉不帶動腳底 → 不滑步)
  const mkLeg = (sx, sz, front) => {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.78 * B, hipY, sz);
    bx(leg, 0.4 * B, 0.55, 0.66, 0, -0.1, 0, plate);                             // 髖甲
    bx(leg, 0.3 * B, hipY * 0.55, 0.42, 0, -hipY * 0.32, front ? 0.06 : -0.08, hull);   // 大腿
    bx(leg, 0.22 * B, hipY * 0.5, 0.3, 0, -hipY * 0.75, front ? -0.08 : 0.1, hullDk);   // 小腿(逆關節)
    bx(leg, 0.34 * B, 0.2, 0.55, 0, -hipY + 0.1, 0.12, 0x23262a);                // 足爪
    g.add(leg);
    return leg;
  };
  const rig = {
    kind: 'quad', spine, chest, neck, head, tail, tail2,
    legFL: mkLeg(-1, 1.05, true), legFR: mkLeg(1, 1.05, true),
    legHL: mkLeg(-1, -1.25, false), legHR: mkLeg(1, -1.25, false),
    hipsY0: hipY, stride: 1.5, bob: 0.09, top: 10,
  };
  g.userData.rig = rig;
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
 * vis.flight = 'jet' 戰機|'uav' 固定翼無人機|'bird' 機械鳥|'dragon' 機械龍
 * vis.ground = 'biped' 人型機器人|'beast' 前肢著地機械獸;vis.bulk 體格倍率。
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
  const beast = vis?.ground === 'beast';
  const B = vis?.bulk || 1;
  const hull = 0x46505b, hullDk = 0x39424b, plate = 0x525d69;
  const parts = [], vents = [], thrusters = [], flapWings = [];
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

  // ---- 軀幹(機身核心):地面直立(獸型前傾蹲伏)↔ 飛行放平(脊椎軸轉為航向軸)----
  const torso = new THREE.Group();
  g.add(torso);
  const cruise = { jet: 1.35, uav: 1.3, bird: 1.12, dragon: 0.95 }[F] ?? 1.3;
  P(torso, { p: [0, beast ? 1.62 : 2.0, 0], r: [beast ? 0.6 : 0, 0, 0] },
    { p: [0, 2.7, 0], r: [cruise, 0, 0] }, 0.3, 0.95);
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

  // ---- 頭(+ 頸):戰機/UAV 飛行時縮入機身,鳥/龍反而前伸(頸部拉出)----
  const head = new THREE.Group();
  torso.add(head);
  const headB = { jet: [[0, 1.38, -0.04], [-0.5, 0, 0]], uav: [[0, 1.38, -0.04], [-0.5, 0, 0]],
    bird: [[0, 1.88, 0.18], [0.3, 0, 0]], dragon: [[0, 2.2, 0.22], [0.35, 0, 0]] }[F];
  P(head, { p: [0, 1.6, 0.06], r: [0, 0, 0] }, { p: headB[0], r: headB[1] }, 0.5, 0.95);
  if (F === 'bird') {
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.3 * B, 10, 8), mat(plate, { metalness: 0.5 }));
    head.add(skull);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.14 * B, 0.5, 6), mat(0x14171a, { metalness: 0.8 }));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, -0.04, 0.42);
    head.add(beak);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.5 }));
      eye.position.set(sx * 0.16 * B, 0.08, 0.22);
      head.add(eye);
    }
    bx(head, 0.26 * B, 0.5, 0.3, 0, -0.4, -0.06, hullDk);                               // 頸筒
  } else if (F === 'dragon') {
    bx(head, 0.46 * B, 0.4, 0.5, 0, 0.05, 0.1, plate, { metalness: 0.6 });              // 顱殼
    bx(head, 0.3 * B, 0.26, 0.5, 0, -0.04, 0.55, hullDk);                               // 吻部
    bx(head, 0.34 * B, 0.09, 0.06, 0, 0.14, 0.36, accent, { emissive: accent, emissiveIntensity: 1.6 });  // 眼列
    for (const sx of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.55, 5), mat(0xd8dde2, { metalness: 0.7 }));
      horn.position.set(sx * 0.18 * B, 0.28, -0.15);
      horn.rotation.x = -2.2;
      head.add(horn);
    }
    bx(head, 0.28 * B, 0.75, 0.32, 0, -0.5, -0.04, hullDk);                             // 長頸(前伸時露出)
  } else {
    bx(head, 0.56 * B, 0.4, 0.52, 0, 0.06, 0, hullDk);                                  // 機甲頭
    bx(head, 0.42 * B, 0.11, 0.08, 0, 0.1, 0.29, accent, { emissive: accent, emissiveIntensity: 1.5 });  // 面罩感測條
    bx(head, 0.2 * B, 0.1, 0.1, 0, -0.12, 0.26, 0x23262a);                              // 下顎
  }

  // ---- 機首錐(戰機/UAV):地面收納於背後(錐尖朝下),飛行滑出鎖上頭部 = 機鼻 ----
  if (F === 'jet' || F === 'uav') {
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
  }

  // ---- 背翼:地面豎折於背後 → 飛行內外兩段展開(Sheet 03)----
  const span = ({ jet: 2.4, uav: 3.2, bird: 2.6, dragon: 2.8 }[F] ?? 2.5) * (0.8 + 0.2 * B);
  const sweep = { jet: 0.5, uav: 0.08, bird: 0.3, dragon: 0.25 }[F] ?? 0.3;
  for (const sgn of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(sgn * 0.5 * B, 1.05, -0.42);
    torso.add(w);
    P(w, { p: null, r: [0.5, 0, sgn * 1.3] }, { p: null, r: [0, sgn * -sweep, 0] }, 0.05, 0.5);
    const outer = new THREE.Group();
    outer.position.set(sgn * span * 0.42, 0, 0);
    w.add(outer);
    P(outer, { p: null, r: [0, 0, sgn * 2.5] }, { p: null, r: [0, 0, sgn * 0.06] }, 0.22, 0.62);
    if (F === 'dragon') {
      // 骨梁 + 半透明膜翼(透明材質:outlinify 自動跳過描邊)
      bx(w, span * 0.45, 0.09, 0.14, sgn * span * 0.21, 0, 0.12, hullDk, { metalness: 0.6 });
      const mem = bx(w, span * 0.42, 0.03, 0.85, sgn * span * 0.2, -0.02, -0.32, accent,
        { transparent: true, opacity: 0.45, emissive: accent, emissiveIntensity: 0.35 });
      mem.rotation.y = sgn * -0.08;
      bx(outer, span * 0.4, 0.08, 0.12, sgn * span * 0.19, 0, 0.1, hullDk, { metalness: 0.6 });
      const mem2 = bx(outer, span * 0.38, 0.03, 0.65, sgn * span * 0.18, -0.02, -0.22, accent,
        { transparent: true, opacity: 0.45, emissive: accent, emissiveIntensity: 0.35 });
      mem2.rotation.y = sgn * -0.14;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.4, 5), mat(0xd8dde2, { metalness: 0.7 }));
      spike.position.set(sgn * span * 0.4, 0, 0.1);
      spike.rotation.z = sgn * -Math.PI / 2;
      outer.add(spike);
      flapWings.push({ w, outer, sgn });
    } else if (F === 'bird') {
      // 覆羽內翼 + 指狀分叉外翼(主色識別羽)
      bx(w, span * 0.45, 0.07, 0.62, sgn * span * 0.21, 0, -0.08, plate, { metalness: 0.4 });
      for (let i = 0; i < 3; i++) {
        const f = bx(outer, span * 0.4, 0.05, 0.16, sgn * span * (0.18 + i * 0.02), 0, 0.12 - i * 0.2,
          i === 1 ? accent : 0x2a2e33);
        f.rotation.y = sgn * -0.14 * i;
      }
      flapWings.push({ w, outer, sgn });
    } else {
      // 戰機後掠翼 / UAV 長直翼(翼尖主色識別)
      bx(w, span * 0.46, 0.08, F === 'uav' ? 0.6 : 0.85, sgn * span * 0.21, 0, -0.1, hull, { metalness: 0.6 });
      bx(outer, span * 0.4, 0.06, F === 'uav' ? 0.45 : 0.6, sgn * span * 0.19, 0, -0.08, plate, { metalness: 0.6 });
      bx(outer, span * 0.16, 0.05, F === 'uav' ? 0.4 : 0.5, sgn * span * 0.4, 0.02, -0.06, accent,
        { emissive: accent, emissiveIntensity: 0.9 });
    }
  }

  // ---- 腿:地面站立(獸型屈膝蹲伏)→ 飛行後收併攏 = 尾部發動機艙(Sheet 01)----
  const mkLeg = (sx) => {
    const leg = new THREE.Group();
    torso.add(leg);
    P(leg, { p: [sx * 0.42 * B, -0.12, 0], r: [beast ? -0.5 : 0, 0, 0] },
      { p: [sx * 0.3 * B, -0.2, -0.05], r: [0.32, 0, 0] }, 0.35, 0.8);
    bx(leg, 0.4 * B, 0.85, 0.5, 0, -0.42, 0.02, hull);                                  // 大腿
    vent(leg, 0.1, 0.28, 0.28, sx * 0.22 * B, -0.3, 0.12);                              // 髖部排氣口
    const shin = new THREE.Group();
    shin.position.set(0, -0.85, 0);
    leg.add(shin);
    P(shin, { p: null, r: [beast ? 0.85 : 0.04, 0, 0] }, { p: null, r: [-0.28, 0, 0] }, 0.4, 0.85);
    bx(shin, 0.3 * B, 0.8, 0.42, 0, -0.4, -0.02, hullDk);                               // 小腿
    bx(shin, 0.36 * B, 0.16, 0.62, 0, -0.82, 0.12, 0x23262a);                           // 足爪
    noz(shin, 0.11, 0.14, 0.26, 0, -0.76, -0.28);                                       // 足底噴口(飛行朝後)
    if (F === 'jet' || F === 'uav') {
      // 垂直安定面:變形末段自足跟展開鎖定(Sheet 05;UAV 斜置 = V 尾)
      const fin = new THREE.Group();
      fin.position.set(0, -0.68, -0.22);
      shin.add(fin);
      P(fin, { p: null, r: [-1.5, 0, 0] }, { p: null, r: [0, 0, F === 'uav' ? sx * 0.55 : 0] }, 0.62, 1);
      bx(fin, 0.06, 0.7, 0.34, 0, -0.35, -0.08, plate, { metalness: 0.6 });
      bx(fin, 0.07, 0.16, 0.3, 0, -0.68, -0.1, accent, { emissive: accent, emissiveIntensity: 0.8 });
    }
    return leg;
  };
  const legL = mkLeg(-1), legR = mkLeg(1);

  // ---- 臂:人型垂放(右臂武器莢艙)/ 獸型前肢著地 → 飛行貼艙收攏(Sheet 04)----
  const mkArm = (sx) => {
    const a = new THREE.Group();
    torso.add(a);
    P(a, { p: [sx * 0.82 * B, 1.08, 0], r: [beast ? -0.85 : 0.04, 0, sx * -0.05] },
      { p: [sx * 0.58 * B, 1.0, -0.06], r: [0.35, 0, sx * 0.18] }, 0.3, 0.72);
    bx(a, 0.34 * B, 0.28, 0.4, 0, 0.06, 0, plate);                                      // 肩甲
    vent(a, 0.1, 0.14, 0.14, sx * 0.18 * B, 0.06, 0.16);                                // 肩關節排氣口
    bx(a, 0.26 * B, beast ? 0.9 : 0.6, 0.32, 0, beast ? -0.48 : -0.34, 0.02, hull);     // 上臂
    const fore = new THREE.Group();
    fore.position.set(0, beast ? -0.95 : -0.66, 0);
    a.add(fore);
    P(fore, { p: null, r: [beast ? -0.2 : -0.12, 0, 0] }, { p: null, r: [0.5, 0, 0] }, 0.32, 0.7);
    bx(fore, 0.24 * B, beast ? 0.95 : 0.6, 0.3, 0, beast ? -0.42 : -0.28, 0.02, hullDk);  // 前臂
    if (beast) {
      for (let i = -1; i <= 1; i++) bx(fore, 0.09 * B, 0.24, 0.12, i * 0.09 * B, beast ? -0.95 : -0.62, 0.1, 0x23262a);  // 爪
    } else {
      bx(fore, 0.2 * B, 0.2, 0.24, 0, -0.66, 0.04, 0x30373f);                           // 拳
    }
    if (sx > 0) {                                                                       // 右臂武器莢艙
      const pod = cyl(fore, 0.09, 0.11, 0.85, 8, 0.03, -0.35, 0.26, 0x14171a, { metalness: 0.85 });
      pod.rotation.x = Math.PI / 2;
    }
    return a;
  };
  const armL = mkArm(-1), armR = mkArm(1);

  // ---- 尾(獸型/鳥/龍):地面下垂配重 → 飛行伸直向後(鳥 = 扇尾展開)----
  if (beast || F === 'bird' || F === 'dragon') {
    const tail = new THREE.Group();
    tail.position.set(0, -0.26, -0.34);
    torso.add(tail);
    P(tail, { p: null, r: [0.85, 0, 0] }, { p: null, r: [0.05, 0, 0] }, 0.15, 0.62);
    if (F === 'bird') {
      // 扇尾:三片尾羽變形末段展開
      for (let i = -1; i <= 1; i++) {
        const f = new THREE.Group();
        tail.add(f);
        P(f, { p: null, r: [0, 0, 0] }, { p: null, r: [0, i * 0.38, 0] }, 0.55, 1);
        bx(f, 0.2 * B, 0.05, 0.95, 0, 0, -0.5, i === 0 ? accent : plate);
      }
    } else {
      bx(tail, 0.22 * B, 0.2, 0.85, 0, 0, -0.42, hullDk);                               // 尾段一
      const t2 = new THREE.Group();
      t2.position.set(0, 0, -0.85);
      tail.add(t2);
      P(t2, { p: null, r: [0.5, 0, 0] }, { p: null, r: [0.02, 0, 0] }, 0.25, 0.7);
      bx(t2, 0.15 * B, 0.14, 0.7, 0, 0, -0.35, 0x23262a);                               // 尾段二
      if (F === 'dragon') {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.45, 5), mat(accent, { emissive: accent, emissiveIntensity: 0.7 }));
        spike.rotation.x = -Math.PI / 2;
        spike.position.set(0, 0, -0.9);
        t2.add(spike);
      } else {
        bx(t2, 0.17 * B, 0.16, 0.16, 0, 0, -0.75, accent, { emissive: accent, emissiveIntensity: 0.8 });
      }
    }
  }

  const pose = makePoser(parts);
  pose(0);   // 以地面姿勢定尺(fitToHeight 以此姿勢貼地)
  g.userData.rig = {
    kind: 'morph', torso, legL, legR, armL, armR, pose, vents, thrusters,
    flapWings: flapWings.length ? flapWings : null, beast,
    stride: beast ? 1.35 : 1.15, swingArm: beast ? 0.95 : 0.4,
    bob: beast ? 0.1 : 0.07, top: 9, topAir: 30,
  };
  return g;
}

/**
 * 執法者人型機甲(hero:robot)— 程序生成(doc/image/robot 參考:
 * 厚重胸廓 + 大墊肩 + 裙甲 + 外擴小腿 + 大腳的動畫機器人比例)。
 * 可動雙足骨架(mobility_plan Task 2.1):髖×2 + 肩×2 + 骨盆重心樞軸,
 * locomotion.js 以實際地速驅動步態;角色差異化 = 主色 + charPod 掛件。
 */
function buildRobotMech(side, vis) {
  const g = new THREE.Group();
  const accent = new THREE.Color(vis?.hue ?? SIDES[side].color);
  const armor = 0x99a3ad, armorDk = 0x77818b, joint = 0x2b3138;
  const hipY = 2.75;
  // 腿:髖樞軸(大腿/膝甲/小腿外擴/踝/大腳)
  const mkLeg = (sx) => {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.52, hipY, 0);
    const ball = cyl(leg, 0.24, 0.24, 0.34, 8, 0, 0.02, 0, joint, { metalness: 0.7 });
    ball.rotation.z = Math.PI / 2;                                          // 髖關節球
    bx(leg, 0.52, 1.15, 0.62, 0, -0.6, 0.02, armor, { metalness: 0.6 });    // 大腿
    bx(leg, 0.56, 0.34, 0.66, 0, -1.22, 0.1, armorDk);                      // 膝甲
    bx(leg, 0.46, 1.05, 0.56, 0, -1.78, -0.02, armor, { metalness: 0.6 });  // 小腿
    bx(leg, 0.5, 0.55, 0.2, 0, -1.85, -0.36, armorDk);                      // 小腿肚裝甲
    bx(leg, 0.3, 0.2, 0.3, 0, -2.4, 0, joint);                              // 踝
    bx(leg, 0.52, 0.25, 0.95, 0, -2.62, 0.14, 0x2b3138);                    // 大腳
    bx(leg, 0.54, 0.14, 0.28, 0, -2.58, 0.52, armorDk);                     // 腳尖甲
    g.add(leg);
    return leg;
  };
  const legL = mkLeg(-1), legR = mkLeg(1);
  // 上半身(骨盆樞軸:浮沉/側移/前傾都在這裡)
  const hips = new THREE.Group();
  hips.position.y = hipY;
  g.add(hips);
  bx(hips, 1.06, 0.55, 0.8, 0, 0.05, 0, joint, { metalness: 0.6 });         // 骨盆
  bx(hips, 0.42, 0.3, 0.14, 0, 0.02, 0.44, accent, { emissive: accent, emissiveIntensity: 0.6 });  // 腹部艙蓋
  for (const sx of [-1, 1]) {
    const skirt = bx(hips, 0.44, 0.6, 0.52, sx * 0.66, -0.12, 0, armor);    // 側裙甲
    skirt.rotation.z = sx * 0.24;
  }
  const fs = bx(hips, 0.62, 0.5, 0.16, 0, -0.14, 0.4, armorDk);             // 前裙甲
  fs.rotation.x = 0.18;
  bx(hips, 1.15, 0.85, 0.95, 0, 0.7, 0, armor, { metalness: 0.6 });         // 腹肋
  bx(hips, 1.5, 1.0, 1.05, 0, 1.5, 0.04, armor, { metalness: 0.6 });        // 胸廓
  for (const sx of [-1, 1]) bx(hips, 0.34, 0.55, 0.16, sx * 0.42, 1.52, 0.52, joint);  // 胸前進氣柵
  bx(hips, 0.5, 0.38, 0.16, 0, 1.52, 0.54, accent, { emissive: accent, emissiveIntensity: 0.9 });  // 駕駛艙(主色)
  // 背包 + 雙噴口(懸浮/衝刺姿態感)
  bx(hips, 0.95, 0.75, 0.4, 0, 1.5, -0.68, armorDk);
  for (const sx of [-1, 1]) {
    const t = cyl(hips, 0.13, 0.17, 0.4, 8, sx * 0.3, 1.1, -0.75, 0x1c1f22,
      { emissive: 0xffa04d, emissiveIntensity: 0.3, metalness: 0.7 });
    t.rotation.x = -0.3;
  }
  // 頭:護目鏡 + 下顎口罩 + V 形天線(動畫機甲識別剪影)
  const head = new THREE.Group();
  head.position.set(0, 2.2, 0.05);
  hips.add(head);
  bx(head, 0.46, 0.42, 0.5, 0, 0.1, 0, armor, { metalness: 0.6 });
  bx(head, 0.34, 0.12, 0.06, 0, 0.14, 0.26, accent, { emissive: accent, emissiveIntensity: 1.6 });  // 護目鏡
  bx(head, 0.14, 0.14, 0.1, 0, -0.06, 0.26, joint);                          // 下顎口罩
  for (const sx of [-1, 1]) {
    bx(head, 0.08, 0.12, 0.32, sx * 0.26, 0.1, 0, armorDk);                  // 側盔
    const fin = bx(head, 0.3, 0.05, 0.04, sx * 0.17, 0.36, 0.2, 0xffd873, { metalness: 0.7 });
    fin.rotation.z = sx * 0.55;                                              // V 形天線
  }
  // 手臂:肩關節樞軸(大墊肩/上臂/外擴前臂/拳)
  const mkArm = (sx) => {
    const a = new THREE.Group();
    a.position.set(sx * 0.98, 1.85, 0);
    hips.add(a);
    bx(a, 0.72, 0.5, 0.74, 0, 0.16, 0, armorDk, { metalness: 0.6 });         // 大墊肩
    bx(a, 0.74, 0.12, 0.76, 0, 0.44, 0, dim(accent, 0.8));                   // 肩頂識別甲
    bx(a, 0.3, 0.6, 0.34, 0, -0.32, 0, joint);                               // 上臂
    bx(a, 0.42, 0.78, 0.46, 0, -0.95, 0.02, armor, { metalness: 0.6 });      // 前臂(外擴)
    bx(a, 0.26, 0.3, 0.3, 0, -1.44, 0.05, 0x30373f);                         // 拳
    return a;
  };
  const armL = mkArm(-1), armR = mkArm(1);
  // 右手光束步槍(槍身/槍管/前握把分件)
  const rifle = bx(armR, 0.16, 0.3, 1.9, 0.1, -1.5, 0.65, 0x1a1d20);
  bx(rifle, 0.08, 0.12, 0.7, 0, 0.05, 1.15, 0x30373f, { metalness: 0.85 });
  bx(rifle, 0.1, 0.3, 0.18, 0, -0.26, 0.35, 0x23262a);
  bx(rifle, 0.1, 0.08, 0.3, 0, 0.2, 0.5, accent, { emissive: accent, emissiveIntensity: 0.8 });
  // 角色掛件(肩點/胸燈已自帶 → trim:false;座標以真實尺寸錨定)
  if (vis?.pod && vis.pod !== 'none') {
    g.add(charPod(vis, 5.4, { sx: 1.35, sy: hipY + 2.0, trim: false }));
  }
  g.userData.rig = {
    kind: 'biped', hips, legL, legR, armL, armR,
    hipsY0: hipY, stride: 2.4, bob: 0.13, sway: 0.09, top: 9, gunArm: true,
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
  const shell = 0xb9c2cb, dark = 0x39424b;
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
  'creep:soldier': (side) => (side === 'SWARM' ? buildSwarmTrooper(side) : buildSoldierFallback(side)),
  'creep:apc': (side) => (side === 'SWARM' ? buildSwarmApc(side) : buildApc(side)),
  'creep:tank': (side) => (side === 'SWARM' ? buildSwarmTank(side) : buildTank(side)),
  'creep:rocketeer': (side) => (side === 'SWARM' ? buildSwarmTrooper(side, { rocket: true }) : buildRocketeerFallback(side)),
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
  // 獸型機甲 / 飛行生物無人機:跳過 GLB,一律程序生成(角色剪影差異化)
  const beast = kind === 'hero:robot' && vis?.form === 'beast';
  const avian = kind === 'hero:drone' && vis?.form === 'avian';
  const entry = !beast && !avian && MODEL_MANIFEST[kind] ? cache[kind] : null;
  const target = beast ? TARGET_H['hero:beast'] : (TARGET_H[kind] || 4);
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
      g.userData.walkRef = kind === 'hero:robot' ? 9 : 6;   // timeScale=1 的參考地速(m/s)
    }
  } else {
    const build = beast ? buildBeastMech
      : avian ? buildAvianDrone
      : (FALLBACK[kind] || FALLBACK['creep:apc']);
    const built = build(side, vis);
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

  if (ring) g.add(teamRing(side, Math.max(2.2, target * 0.55)));
  g.userData.kind = kind;
  g.userData.side = side;
  return { group: g, mixer };
}
