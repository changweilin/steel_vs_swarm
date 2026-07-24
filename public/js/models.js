// ============ 3D 單位模型(Quaternius CC0 優先,程式生成備援)============
// 設計沿用 ai_tycoon board3d.js 的 MODEL_MANIFEST 機制:
// 每種單位先嘗試載入 assets/models/quaternius/ 下的 GLB,
// 載入失敗自動退回 Three.js 程式生成的低多邊形版本,不開天窗。
// 想換模型:丟新 .glb 進資料夾、改下面 manifest 一行即可。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {
  SIDES, CHARACTERS, recoilTier, THIRD, isThirdSide, sideInfo, CIVILIANS,
  SOLDIER_H, MORPH_HUMANOID, heroTargetH, TARGET_H,
} from './data.js';
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

// ---- 尺度基準 / 機體高度 ----
// 2026-07-23 起實體高度住 `data.js`(SOLDIER_H / HERO_SIZE / heroTargetH / TARGET_H):
// 伺服器 `_blast`/`_lanceHits` 的命中量體(打到哪個部位就在那裡結算)與這裡的顯示高度
// **MUST 是同一把尺** —— 渲染縮放與命中判定分家 = 看得到打不到。本檔只做 re-export,
// 既有 `import { SOLDIER_H, heroTargetH, MORPH_HUMANOID } from './models.js'` 呼叫端不動。
export { SOLDIER_H, heroTargetH, MORPH_HUMANOID };

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

/** 陣營光環(單位腳下的識別圈);sideInfo:第三方(GUER/MILI)也有識別色 */
function teamRing(side, radius) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.75, radius, 24),
    new THREE.MeshBasicMaterial({
      color: sideInfo(side).color, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.25;
  ring.userData.teamRing = true;   // 貼地識別圈:量「機體本體」尺寸時要排除(否則塔的光暈/血條吃到 r≈14 的圈)
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

// ---------- 武器元件工具(gunKit,2026-07-16 起)----------
// rig.wpn(2026-07-22 FPV 武裝同源):FPV 座艙複製第三人稱武裝的唯一來源。
// { light|heavy: { nodes:[Object3D...], ref:Object3D, muz:Object3D|null, fwd:'z'|'-z'|'y'|'-y'|'x'|'-x' } | null }
// nodes = 該武器「外觀完整」的節點集(MUST NOT 含機體軀幹/頭/翼/尾本體);
// ref   = 表達 nodes 相對排列的參考框:單根武器 = 該武器群組根自身(此時 nodes=[root]、fwd 為武器局部軸);
//         散件武器 = 其共同軀幹節點(head/chest/tilt…,消費端以 ref.matrixWorld⁻¹×node.matrixWorld 烘相對變換);
// muz   = 槍口節點(通常 = rig.muzzles 同一節點);
// fwd   = 在 ref 框架中「槍尾→槍口」的軸向。
// 輕重同一具(同型雙模)= light 與 heavy 指向同一組 nodes/ref,只有 muz 不同。
/**
 * 依武器 type 建「機匣 + 供彈 + 槍管 + 制退/聚焦」俱全的莢艙武器
 * (無人機腹掛/翼掛、爪莢、背載小塔共用;獨立機種的手持/嘴砲仍各自建模)。
 * 幾何一律沿局部 +z 朝前(呼叫端旋轉/擺位群組決定掛向);供彈結構與槍管同軸是硬規則。
 * export(2026-07-22):FPV 座艙在 rig.wpn 缺登記時的退路 builder(game.js 消費)。
 * @param w 武器定義(data.js CHARACTERS[ch].light|heavy;查無時退回 {type:'gun'})
 * @returns { g 群組, muz 槍口節點(rig.muzzles 錨/槍口燈本體), glows 蓄力發光件 [{mesh,base}] }
 */
export function podWeapon(parent, w, accent, PAL, { L = 1.0, R = 0.08, x = 0, y = 0, z = 0 } = {}) {
  const ty = w?.type || 'gun';
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  const dark = 0x14171a, steel = 0x1c2126, glows = [];
  // 槍管(cyl 長軸 +y → 轉成 +z 朝前);能量/發射器型不走細管,各自成形
  const tube = (rr, ll, zz, col = dark, opts = { metalness: 0.85 }) => {
    const b = cyl(g, rr, rr * 1.08, ll, 8, 0, 0, 0, col, opts);
    b.rotation.x = Math.PI / 2;
    b.position.z = zz;
    return b;
  };
  const ring = (rr, zz, col, opts) => {
    const c = cyl(g, rr, rr, 0.06, 8, 0, 0, 0, col, opts);
    c.rotation.x = Math.PI / 2;
    c.position.z = zz;
    return c;
  };
  let muz = null;
  if (ty === 'launcher') {
    // 火箭/榴彈莢:短粗發射管;大口徑(R ≥ 0.12)= 單管火箭(彈頭外露),
    // 小口徑 = 七管蜂巢火箭巢(管口彈尖可見 = 彈藥與砲膛同軸)
    if (R >= 0.12) {
      tube(R, L, 0, steel, { metalness: 0.7 });
      const warhead = new THREE.Mesh(new THREE.SphereGeometry(R * 1.35, 8, 6),
        mat(dim(accent, 0.8), { metalness: 0.4 }));
      warhead.scale.z = 1.5;
      warhead.position.z = L / 2 + R * 0.9;   // 溫壓彈頭外露(RPG 式)
      g.add(warhead);
      muz = ring(R * 1.1, L / 2 + R * 1.9, accent, { emissive: accent, emissiveIntensity: 0.5 });
    } else {
      tube(R * 2.6, L, 0, steel, { metalness: 0.7 });                     // 巢殼
      for (let i = 0; i < 7; i++) {                                       // 七管 + 管口火箭彈尖
        const th = i / 6 * Math.PI * 2, rr = i === 6 ? 0 : R * 1.5;
        const t = cyl(g, R * 0.62, R * 0.62, L + 0.04, 6,
          i === 6 ? 0 : Math.cos(th) * rr, i === 6 ? 0 : Math.sin(th) * rr, 0, dark);
        t.rotation.x = Math.PI / 2;
        const tip = new THREE.Mesh(new THREE.ConeGeometry(R * 0.5, R * 1.2, 6),
          mat(accent, { emissive: accent, emissiveIntensity: 0.6 }));
        tip.rotation.x = Math.PI / 2;
        tip.position.set(t.position.x, t.position.y, L / 2 + R * 0.5);
        g.add(tip);
        if (i === 6) muz = tip;
        glows.push({ mesh: tip, base: 0.6 });
      }
    }
  } else if (ty === 'missile') {
    // 飛彈掛架:導軌 + 雙彈(彈體 + 十字尾翼 + 導引頭發光)—— 彈藥本體外掛可見
    bx(g, R * 1.2, R * 1.2, L, 0, R * 1.6, 0, PAL.mid, { metalness: 0.6 });   // 導軌梁
    for (const sx of [-1, 1]) {
      const m = cyl(g, R * 0.85, R * 0.85, L * 0.92, 8, sx * R * 1.35, 0, 0, PAL.lite, { metalness: 0.5 });
      m.rotation.x = Math.PI / 2;
      for (let i = 0; i < 2; i++) {   // 十字尾翼(對稱盒兩片斜置即成 X)
        const fin = bx(g, R * 0.14, R * 1.6, R * 1.6, sx * R * 1.35, 0, -L * 0.42, PAL.dark);
        fin.rotation.z = Math.PI / 4 + i * Math.PI / 2;
      }
      const nose = new THREE.Mesh(new THREE.ConeGeometry(R * 0.85, R * 2.2, 8),
        mat(dim(accent, 0.9), { emissive: accent, emissiveIntensity: 0.7 }));
      nose.rotation.x = Math.PI / 2;
      nose.position.set(sx * R * 1.35, 0, L * 0.46 + R * 1.1);
      g.add(nose);
      glows.push({ mesh: nose, base: 0.7 });
      if (sx > 0) muz = nose;
    }
  } else if (ty === 'beam') {
    // 定向能:發射器筒 + 聚焦環 ×2 + 透鏡光核(能量武器無供彈,靠散熱鰭示能)
    tube(R * 1.5, L * 0.7, -L * 0.15, steel, { metalness: 0.8 });
    for (const zz of [L * 0.16, L * 0.34]) ring(R * 1.9, zz, PAL.dark, { metalness: 0.7 });
    for (let i = 0; i < 4; i++) {   // 尾部散熱鰭
      const fin = bx(g, R * 0.3, R * 2.6, L * 0.34, 0, 0, -L * 0.38, PAL.dark, { metalness: 0.7 });
      fin.rotation.z = i * Math.PI / 4;
    }
    muz = new THREE.Mesh(new THREE.SphereGeometry(R * 0.95, 8, 6),
      mat(accent, { emissive: accent, emissiveIntensity: 0.9 }));
    muz.position.z = L * 0.48;
    g.add(muz);
    glows.push({ mesh: muz, base: 0.9 });
  } else if (ty === 'plasma') {
    // 電漿噴射:喇叭噴口 + 磁約束環(發光)+ 燃料罐 —— 罐體即「彈藥」,沿管軸後掛
    tube(R * 1.1, L * 0.75, -L * 0.05, steel, { metalness: 0.75 });
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.9, R * 1.1, L * 0.3, 8, 1, true),
      mat(dark, { metalness: 0.85 }));
    noz.rotation.x = Math.PI / 2;
    noz.position.z = L * 0.42;
    g.add(noz);
    const core = ring(R * 1.15, L * 0.34, accent, { emissive: accent, emissiveIntensity: 1.0 });
    glows.push({ mesh: core, base: 1.0 });
    muz = core;
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(R * 1.3, L * 0.3, 4, 8),
      mat(dim(accent, 0.75), { emissive: accent, emissiveIntensity: 0.4 }));
    tank.rotation.x = Math.PI / 2;
    tank.position.set(0, -R * 2.2, -L * 0.2);
    g.add(tank);
    glows.push({ mesh: tank, base: 0.4 });
  } else if (ty === 'rail') {
    // 電磁軌道:細長加速管 + 線圈環 ×3(發光,蓄力增亮)+ 導線束 —— 線圈即供能結構
    bx(g, R * 3.2, R * 3.2, L * 0.36, 0, 0, -L * 0.3, PAL.mid, { metalness: 0.7 });   // 機匣(電容組)
    tube(R * 0.7, L, 0);
    for (const zz of [-L * 0.1, L * 0.12, L * 0.34]) {
      const c = ring(R * 1.6, zz, accent, { emissive: accent, emissiveIntensity: 0.7 });
      glows.push({ mesh: c, base: 0.7 });
    }
    bx(g, R * 0.5, R * 0.5, L * 0.7, 0, -R * 1.7, -L * 0.05, 0x23262a, { metalness: 0.8 });   // 導線束
    muz = ring(R * 0.95, L / 2 + 0.04, accent, { emissive: accent, emissiveIntensity: 0.8 });
  } else {
    // 動能槍(gun):機匣 + 槍管(散熱環)+ 制退器 + 側掛彈鏈箱(與槍管同軸供彈);
    // fan(散彈)= 並列雙管 + 較寬的平板制退
    const fan = !!w?.fan;
    bx(g, R * 3.4, R * 3.4, L * 0.4, 0, 0, -L * 0.28, PAL.mid, { metalness: 0.7 });   // 機匣
    if (fan) {
      for (const sx of [-1, 1]) {
        const b = cyl(g, R * 0.8, R * 0.85, L * 0.95, 8, sx * R * 0.95, 0, L * 0.06, dark, { metalness: 0.85 });
        b.rotation.x = Math.PI / 2;
      }
      bx(g, R * 4.2, R * 1.6, R * 1.2, 0, 0, L * 0.56, 0x0d0f11, { metalness: 0.85 });   // 平板制退
    } else {
      tube(R, L, L * 0.05);
      for (const zz of [L * 0.14, L * 0.3, L * 0.46]) ring(R * 1.35, zz, 0x23262a, { metalness: 0.78 });   // 散熱環
      cyl(g, R * 1.4, R * 1.4, R * 2.4, 8, 0, 0, L * 0.6, 0x0d0f11, { metalness: 0.85 })
        .rotation.x = Math.PI / 2;                                                       // 制退器
    }
    bx(g, R * 2.2, R * 2.8, L * 0.34, R * 3.0, 0, -L * 0.2, PAL.dark, { metalness: 0.6 });    // 彈鏈箱(側掛)
    bx(g, R * 2.3, R * 0.6, L * 0.36, R * 3.0, R * 1.7, -L * 0.2, dim(accent, 0.8));          // 彈箱蓋識別
    bx(g, R * 1.6, R * 0.5, R * 1.6, R * 1.6, 0, -L * 0.12, 0x23262a, { metalness: 0.7 });    // 彈鏈橋
    muz = ring(R * 1.05, L * 0.62 + R * 1.3, accent, { emissive: accent, emissiveIntensity: 0.7 });
  }
  return { g, muz, glows };
}

/**
 * 第三人稱槍口焰(makeUnit 統一掛;stepCombatFx 中央驅動 visible/scale):
 * 焰球徑向對稱 → 不依賴槍口節點的軸向,任何 builder 的錨都掛得上。
 * 輕武器焰掛在每一盞 lightGlow 槍口燈上;重武器焰掛在 rig.muzzles.heavy 錨上。
 */
function attachMuzzleFlames(rig) {
  const flames = { light: [], heavy: [] };
  const mkFlame = (node, r) => {
    const f = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false }));
    f.userData.noOutline = true;
    f.userData.noPaint = true;
    f.visible = false;
    f.scale.setScalar(0.01);   // 待機縮到近零:Box3 量測(血條/鎖定光暈基準)不被隱形焰球撐大
    node.add(f);
    return f;
  };
  const lr = (rig.muzzles?.light?.r ?? 0.08);
  if (rig.lightGlow) for (const gd of rig.lightGlow) flames.light.push(mkFlame(gd.mesh, lr * 3.4));
  const hm = rig.muzzles?.heavy;
  if (hm?.n) flames.heavy.push(mkFlame(hm.n, (hm.r || 0.12) * 3.0));
  if (flames.light.length || flames.heavy.length) rig.flames = flames;
}

// ---------- 程式生成備援模型 ----------
/**
 * 武裝無人機(蜂群英雄)——角色專屬機體:
 * vis = CHARACTERS[ch].visual = { hue 主色, frame 'quad'|'hexa'|'coax'|'wing', body 'box'|'wedge'|'sphere'|'slab'|'frame' }。
 * 未指定角色(觀戰/舊路徑)退回預設四旋翼。
 * 機腹武器(2026-07-16 起):依角色輕/重武器型別分裝雙莢(podWeapon)—— 左莢輕、右莢重。
 */
function buildDrone(side, vis = null, ch = null) {
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
    // 楔形艙側進氣柵(貼合楔面收斂角,微凸分割線):「馬達壽命以場計」= 暴力風冷的速度機殼標配
    for (const sx of [-1, 1]) {
      const gr = bx(tilt, 0.02, 0.12, 0.4, sx * 0.36, -0.06, 0.15, PAL.deep, { metalness: 0.7 });
      gr.rotation.y = -sx * 0.22;   // 前緣內收跟楔面同角(反號會前緣外翹)
    }
    // FC/4-in-1 ESC 疊層(架在楔尾、兩層碳板間的 6S 電力室)+ 狀態呼吸燈:
    // 穿越機的機架就是為了露出這疊板而存在 —— 「電調超規壓榨」的本體
    bx(tilt, 0.5, 0.06, 0.28, 0, -0.2, -0.66, 0x1d2126, { metalness: 0.5 });
    bx(tilt, 0.42, 0.05, 0.24, 0, -0.12, -0.66, 0x14171a, { metalness: 0.6 });
    bx(tilt, 0.05, 0.03, 0.02, 0.12, -0.08, -0.6, accent, { emissive: accent, emissiveIntensity: 1.8 });
  } else if (bodyKind === 'sphere') {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 9), mat(shell, { metalness: 0.5 }));
    ball.scale.y = 0.72;
    ball.position.y = -0.08;
    tilt.add(ball);
    // 機腹恆溫血漿艙:圓角保溫莢 + 箍帶 + 艙尾恆溫指示燈 —— 底艙是「給血漿的」視覺主角
    // (莢頂沒入球腹生根;底面貼齊起落橇底線,MUST NOT 更低)
    rbz(tilt, 0.4, 0.34, 0.95, 0, -0.43, -0.35, PAL.lite, { metalness: 0.4 });
    for (const z of [-0.58, -0.12]) bx(tilt, 0.42, 0.34, 0.05, 0, -0.43, z, PAL.mid, { metalness: 0.6 });
    bx(tilt, 0.3, 0.04, 0.03, 0, -0.28, -0.84, accent, { emissive: accent, emissiveIntensity: 1.4 });
    // 綠十字醫療燈(固定色識別燈,比照航行燈慣例):豎片 + 橫片正交成十字,
    // 穿透夜霧一眼可辨「這是醫療機」—— 章程明定醫療機不武裝,十字燈就是宣告
    for (const sx of [-1, 1]) {
      bx(tilt, 0.02, 0.26, 0.08, sx * 0.22, -0.43, -0.6, 0x39d98a, { emissive: 0x2fd07f, emissiveIntensity: 1.8 });
      bx(tilt, 0.02, 0.08, 0.26, sx * 0.22, -0.43, -0.6, 0x39d98a, { emissive: 0x2fd07f, emissiveIntensity: 1.8 });
    }
    // CASEVAC 絞車:絞盤(鼓軸橫置,盤頂生根下碳板)+ 垂纜 + J 形吊鉤(鉤底收在橇底之上)
    const dr = cyl(tilt, 0.09, 0.09, 0.22, 8, 0, -0.36, 0.62, 0x1a1d20, { metalness: 0.85 });
    dr.rotation.z = Math.PI / 2;
    cyl(tilt, 0.014, 0.014, 0.16, 5, 0, -0.48, 0.62, 0x14171a);
    bx(tilt, 0.03, 0.06, 0.03, 0, -0.56, 0.62, PAL.deep, { metalness: 0.7 });
    bx(tilt, 0.03, 0.03, 0.08, 0, -0.58, 0.65, PAL.deep, { metalness: 0.7 });
    // 絞車導纜架(立柱生根絞盤、導纜滾輪橫置柱底):軍規吊掛必有導纜架,否則側風割纜
    for (const sx of [-1, 1]) bx(tilt, 0.025, 0.14, 0.025, sx * 0.09, -0.47, 0.66, 0x1a1d20, { metalness: 0.7 });
    const fl = cyl(tilt, 0.02, 0.02, 0.16, 6, 0, -0.53, 0.66, PAL.deep, { metalness: 0.8 });
    fl.rotation.z = Math.PI / 2;
    // 球身醫療徽記圓盤(白底 + 綠十字,貼在球腹最寬點 = 兩層碳板間的可見帶正中):
    // Zipline 語彙的白天識別 —— 燈只管夜間,「漆上去的十字」才是章程宣告;
    // 盤面 MUST 凸出球面最寬處(0.62),否則側視整片被球弧吞掉;noPaint = 不吃 flag 花紋
    for (const sx of [-1, 1]) {
      const rg = new THREE.Group();
      rg.position.set(sx * 0.585, -0.08, 0);
      rg.rotation.z = -sx * Math.PI / 2;   // 局部 +y 指向球外側
      tilt.add(rg);
      const disc = cyl(rg, 0.19, 0.19, 0.06, 16, 0, 0.01, 0, 0xf2f5f7);
      const cr1 = bx(rg, 0.3, 0.03, 0.09, 0, 0.05, 0, 0x39d98a);
      const cr2 = bx(rg, 0.09, 0.03, 0.3, 0, 0.05, 0, 0x39d98a);
      for (const m of [disc, cr1, cr2]) m.userData.noPaint = true;
    }
    // 恆溫艙冷排鰭(右側單側 = 改裝件;內緣沒入艙壁):「恆溫是給血漿的」要有制冷機構外露才可信
    for (let i = 0; i < 3; i++)
      bx(tilt, 0.08, 0.015, 0.16, 0.235, -0.34 - i * 0.06, -0.45, PAL.mid, { metalness: 0.7 });
    // 球尾排氣柵(逐排隨球面內收、微凸艙面):冷排的排風路徑,把「恆溫」機能閉環
    bx(tilt, 0.24, 0.025, 0.03, 0, -0.06, -0.635, PAL.deep, { metalness: 0.7 });
    bx(tilt, 0.24, 0.025, 0.03, 0, -0.14, -0.63, PAL.deep, { metalness: 0.7 });
    bx(tilt, 0.24, 0.025, 0.03, 0, -0.22, -0.605, PAL.deep, { metalness: 0.7 });
    // 血袋投放尾門(開在恆溫指示燈正下方,貼合膠囊尾蓋弧度)+ 門把:血袋從尾門投放的 Zipline 語彙
    const bdoor = bx(tilt, 0.14, 0.14, 0.02, 0, -0.38, -0.82, dim(accent, 0.85));
    bdoor.rotation.x = 0.35;   // 正號上緣前傾貼尾蓋(負號會上緣懸空)
    const bknob = bx(tilt, 0.05, 0.015, 0.02, 0, -0.33, -0.82, PAL.deep);
    bknob.rotation.x = 0.35;
    // 機頂醫療頻閃燈(與腹側綠十字同色的固定識別燈,不掛 glows):醫療機頂綠閃 = 對空「勿擊」宣告
    const mstrobe = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), mat(0x39d98a, { emissive: 0x2fd07f, emissiveIntensity: 1.8 }));
    mstrobe.position.set(0, 0.475, 0.3);   // 半沉電池綁帶頂,收在下層槳掃掠面之下
    tilt.add(mstrobe);
    // 著陸探照燈(殼根沒入球腹、照向前下方吊點):夜間 CASEVAC 吊掛要照明
    const lampH = cyl(tilt, 0.05, 0.06, 0.07, 8, -0.16, -0.38, 0.46, PAL.deep, { metalness: 0.7 });
    lampH.rotation.x = -1.1;
    const lampF = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), mat(0xfff4d6, { emissive: 0xfff4d6, emissiveIntensity: 1.6 }));
    lampF.position.set(-0.16, -0.41, 0.49);
    tilt.add(lampF);
  } else if (bodyKind === 'slab') {
    bx(tilt, 1.85, 0.34, 1.45, 0, -0.1, 0, shell, { metalness: 0.6 });
    // 車庫搶修痕跡:三塊補丁板微斜貼裝(手工補焊感,「墜地後還能修」的視覺證據)
    const p1 = bx(tilt, 0.34, 0.03, 0.42, -0.55, 0.08, 0.3, PAL.lite);
    p1.rotation.y = 0.1;
    const p2 = bx(tilt, 0.4, 0.03, 0.3, 0.5, 0.08, -0.42, PAL.mid);
    p2.rotation.y = -0.15;
    const p3 = bx(tilt, 0.03, 0.2, 0.36, 0.93, -0.08, 0.15, dim(accent, 0.7));
    p3.rotation.y = 0.12;
    // 側裝甲焊補板(左右各一)+ 上緣焊道:頂面補丁補完側面 —— 焊道與焊縫環同色 = 同一把焊槍
    const p4 = bx(tilt, 0.03, 0.22, 0.4, -0.94, -0.1, 0.3, PAL.lite);
    p4.rotation.y = -0.08;
    const w4 = bx(tilt, 0.025, 0.035, 0.42, -0.945, 0.02, 0.3, dim(accent, 0.6));
    w4.rotation.y = -0.08;
    const p5 = bx(tilt, 0.03, 0.2, 0.36, 0.94, -0.12, -0.45, PAL.mid);
    p5.rotation.y = 0.1;
    const w5 = bx(tilt, 0.025, 0.035, 0.38, 0.945, 0.02, -0.45, dim(accent, 0.6));
    w5.rotation.y = 0.1;
    // 機腹前緣夜襲熱像雲台(下視球艙,不是 FPV 姿態鏡頭)
    cyl(tilt, 0.05, 0.05, 0.12, 6, 0, -0.32, 0.62, 0x14171a);   // 吊柱
    const gb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), mat(PAL.deep, { metalness: 0.5 }));
    gb.position.set(0, -0.42, 0.62);
    tilt.add(gb);
    const ir = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.1 }));
    ir.position.set(0, -0.46, 0.72);
    tilt.add(ir);
    // 熱像雲台防撞籠:斜柱頂端沒入機腹生根、柱底前伸接保險桿護住鏡頭 —— 墜過的機才會給雲台加籠
    for (const sx of [-1, 1]) {
      const gpost = bx(tilt, 0.03, 0.35, 0.03, sx * 0.19, -0.405, 0.72, 0x1c1f22);
      gpost.rotation.x = -0.605;   // 頂沒入 slab 底、底外傾接桿(正號會頂懸空)
    }
    bx(tilt, 0.4, 0.03, 0.03, 0, -0.53, 0.82, 0x1c1f22);   // 前保險桿(閃開 ir 鏡與武器莢)
  } else if (bodyKind === 'frame') {
    // 鏤空競速架:只有側軌,看得到立柱
    for (const sx of [-1, 1]) bx(tilt, 0.1, 0.3, 1.75, sx * 0.62, -0.1, 0.02, carbonLt);
  } else {
    bx(tilt, 1.12, 0.36, 1.5, 0, -0.1, 0, shell, { metalness: 0.6 });
  }
  // 頂置電池(主色綁帶 ×2 = 遠距識別;重載六旋翼 = 雙電池並列 + 外露粗電纜,電池就是視覺量體)
  if (vis?.frame === 'hexa') {
    for (const sx of [-1, 1]) bx(tilt, 0.5, 0.3, 1.3, sx * 0.34, 0.32, -0.12, 0x1d2126, { metalness: 0.5 });
    for (const z of [-0.6, 0.3]) bx(tilt, 1.28, 0.32, 0.12, 0, 0.32, z, dim(accent, 0.85));   // 綁帶加寬包住雙包外緣
    const cb = cyl(tilt, 0.035, 0.035, 0.6, 6, 0.34, 0.18, 0.5, 0x14171a);   // 粗電纜:右電池前緣斜落機身
    cb.rotation.x = -0.9;   // 頂端沒入電池前段、底端沒入碳板(正號會懸空)
    // 雙電池並聯線 + XT90 對接頭:兩包各自出線在中央溝槽對接 —— 「雙電池並列」要有電氣收尾才成立
    const jl = cyl(tilt, 0.03, 0.03, 0.5, 6, 0, 0.42, -0.15, 0x14171a);   // 兩端沒入電池內壁;落在兩綁帶之間
    jl.rotation.z = Math.PI / 2;
    bx(tilt, 0.09, 0.06, 0.07, 0, 0.45, -0.15, dim(accent, 0.9));         // XT90 騎在線上
    // 夜襲防撞頻閃燈(固定白閃識別燈,比照航行燈慣例不掛 glows):夜間任務機的唯一對空識別
    bx(tilt, 0.06, 0.04, 0.06, -0.34, 0.49, -0.7, 0xfff4d6, { emissive: 0xffffff, emissiveIntensity: 2.0 });
    // 第二短天線(控制/圖傳雙鏈路 = 雙天線剪影):根沒入電池後段、尾向斜出,不與長鞭同點
    const ant2 = cyl(tilt, 0.025, 0.03, 0.45, 5, 0.28, 0.36, -0.62, 0x14171a);
    ant2.rotation.x = -0.55;   // 負號向後仰(正號會前傾撞綁帶)
    ant2.rotation.z = -0.35;
  } else {
    bx(tilt, 0.72, 0.3, 1.3, 0, 0.32, -0.12, 0x1d2126, { metalness: 0.5 });
    for (const z of [-0.6, 0.3]) bx(tilt, 0.78, 0.32, 0.12, 0, 0.32, z, dim(accent, 0.85));
  }
  // 飛手文化(競速架):電池左側擊墜噴漆刻痕(五道豎痕、第五道斜劃 = 正字記法)+ XT60 電源辮線
  if (bodyKind === 'wedge') {
    for (let i = 0; i < 5; i++) {
      const notch = bx(tilt, 0.02, 0.18, 0.05, -0.40, 0.32, -0.55 + i * 0.2, dim(accent, 1.1));
      if (i === 4) notch.rotation.x = 0.5;
    }
    const xt = cyl(tilt, 0.03, 0.03, 0.28, 6, 0.2, 0.36, -0.72, 0x14171a);   // 電源辮線向後下垂
    xt.rotation.x = 1.2;
    bx(tilt, 0.08, 0.06, 0.09, 0.2, 0.3, -0.86, dim(accent, 0.9));           // XT60 接頭
    // VTX 圖傳盒 + 雙層散熱鰭 + 同軸線接向鞭根:「圖傳超規壓榨延遲」的視覺證據 = 超大散熱鰭,
    // 三根天線終於有生根的盒子(x 偏左避開 XT60 辮線)
    bx(tilt, 0.2, 0.12, 0.26, -0.14, 0.32, -0.82, 0x1d2126, { metalness: 0.6 });
    bx(tilt, 0.22, 0.015, 0.2, -0.14, 0.388, -0.84, 0x14171a, { metalness: 0.8 });
    bx(tilt, 0.22, 0.015, 0.2, -0.14, 0.418, -0.84, 0x14171a, { metalness: 0.8 });
    const coax2 = cyl(tilt, 0.015, 0.015, 0.2, 5, -0.07, 0.415, -0.9, 0x14171a);
    coax2.rotation.z = -0.85;   // 一端貼盒頂、一端跨到鞭天線根
    coax2.rotation.x = -0.95;
    // 頂置 HD 運動相機(仰角刻意淺於 FPV 鏡頭 = 巡航拍攝角):電競文化每場拍集錦,綁電池頂是行規
    const gopro = bx(tilt, 0.18, 0.13, 0.16, 0, 0.55, 0.42, PAL.dark, { metalness: 0.4 });
    gopro.rotation.x = -0.25;
    const glens = cyl(tilt, 0.045, 0.045, 0.03, 8, 0, 0.555, 0.505, PAL.deep, { metalness: 0.6 });
    glens.rotation.x = Math.PI / 2;
    const geye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 5), mat(accent, { emissive: accent, emissiveIntensity: 1.2 }));
    geye.position.set(0, 0.555, 0.52);
    tilt.add(geye);
    bx(tilt, 0.2, 0.03, 0.06, 0, 0.62, 0.42, dim(accent, 0.85));   // 相機綁帶(與電池綁帶同語彙)
  }
  // FPV 鏡頭(前傾 20° 主色鏡片 = 姿態錨點)+ 尾部 VTX 天線
  const cam = bx(tilt, 0.4, 0.34, 0.24, 0, 0.1, 0.85, shell);
  cam.rotation.x = bodyKind === 'wedge' ? -0.62 : -0.35;   // 競速架 35° 大仰角:巡航機身前壓、鏡頭才朝前
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.3 }));
  lens.position.set(0, bodyKind === 'wedge' ? 0.22 : 0.16, bodyKind === 'wedge' ? 0.94 : 0.99);
  tilt.add(lens);
  const whip = cyl(tilt, 0.02, 0.025, 0.75, 5, 0, 0.42, -0.92, 0x14171a);
  whip.rotation.x = 0.7;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), mat(accent, { emissive: accent, emissiveIntensity: 1.2 }));
  tip.position.set(0, 0.68, -1.18);
  tilt.add(tip);
  // 競速機尾部 V 字雙 VTX 天線(棒棒糖頭,向後外斜張;居中單鞭保留)
  if (bodyKind === 'wedge') for (const sx of [-1, 1]) {
    const va = cyl(tilt, 0.02, 0.025, 0.6, 5, sx * 0.12, 0.42, -0.92, 0x14171a);
    va.rotation.x = -0.7;   // 桿頂向後外斜張,與棒棒糖頭貼合
    va.rotation.z = -sx * 0.55;
    const lolli = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 5), mat(accent, { emissive: accent, emissiveIntensity: 1.2 }));
    lolli.position.set(sx * 0.28, 0.62, -1.08);   // 頭貼齊桿端
    tilt.add(lolli);
  }
  // 機腹武器艙(2026-07-16 改版):依角色輕/重武器型別分裝雙莢 —— 左莢輕武器、右莢重武器
  // (異型 = 兩具分開;查無角色 = 通用機槍/火箭退路)。機匣/彈鏈箱/線圈/彈尖由 podWeapon
  // 依 type 生成,供彈結構與槍管同軸;莢體收在起落橇底線以上(fitToHeight 包圍盒不撐高)。
  const CW = (ch && CHARACTERS[ch]) || null;
  const lp = podWeapon(tilt, CW?.light || { type: 'gun' }, accent, PAL,
    { L: 1.05, R: 0.075, x: -0.34, y: -0.4, z: 0.35 });
  const hp = podWeapon(tilt, CW?.heavy || { type: 'launcher' }, accent, PAL,
    { L: 1.15, R: (CW?.heavy?.type || 'launcher') === 'launcher' ? 0.13 : 0.085, x: 0.34, y: -0.34, z: 0.25 });
  // 蓄力 = 重莢整具微上仰展開、擊發反向過衝(stepCombatFx 中央驅動);發光件依型別(彈尖/線圈/磁環)
  const heavyRig = {
    glow: hp.glows.length ? hp.glows : [{ mesh: hp.muz, base: 0.5 }],
    pivot: [{ obj: hp.g, rest: { x: 0, y: 0, z: 0 }, deploy: { x: -0.12, y: 0, z: 0 } }],
  };
  // 競速尾燈 LED 條(賽規識別燈:隊色高亮橫貫尾部,遠距一眼認出「那台粉紅的」)
  if (bodyKind === 'wedge') bx(tilt, 0.66, 0.06, 0.05, 0, 0.1, -0.84, accent, { emissive: accent, emissiveIntensity: 2.2 });
  // 航行燈(左紅右綠):壓坡/俯仰時方位一目了然
  bx(tilt, 0.1, 0.06, 0.22, -0.78, -0.02, 0.1, 0xff5544, { emissive: 0xff3322, emissiveIntensity: 1.6 });
  bx(tilt, 0.1, 0.06, 0.22, 0.78, -0.02, 0.1, 0x55ff88, { emissive: 0x22ff66, emissiveIntensity: 1.6 });
  // 農噴機式高蹺長腳(重載六旋翼):四根外八斜撐生根下碳板底緣,
  // 機腹淨空留給貨架/彈架 —— 落地時整機像蹲在四根長腿上
  if (vis?.frame === 'hexa') {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = cyl(tilt, 0.045, 0.055, 1.05, 6, sx * 0.72, -0.85, sz * 0.62, 0x1c1f22);
      leg.rotation.z = sx * 0.18;    // 腳頂內收生根板底、腳底外八(反號會頂懸空底內縮)
      leg.rotation.x = -sz * 0.12;
    }
    for (const sx of [-1, 1]) bx(tilt, 0.06, 0.05, 1.5, sx * 0.82, -1.35, 0, 0x1c1f22);   // 接地橫管(與外八腳底咬合)
  }
  // 起落橇(FPV 機腹雙短橇;六旋翼機保留當貨架吊軌)
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
      addRotor(Math.cos(a) * 1.85, Math.sin(a) * 1.85, 1.05);
      // 粗臂套管 + 焊縫環:圓管沿徑向包住薄碳臂 —— 重載機的臂粗到不合空氣力學,
      // 外端收在馬達鐘軸心;焊縫環箍在套管中點 = 車庫搶修的痕跡
      const ax = Math.cos(a) * 1.85, az = Math.sin(a) * 1.85;
      const boom = cyl(tilt, 0.085, 0.105, 1.9, 6, ax * 0.5, -0.14, az * 0.5, carbonLt, { metalness: 0.6 });
      boom.rotation.set(0, Math.atan2(-az, ax), Math.PI / 2);
      const weld = cyl(tilt, 0.11, 0.11, 0.05, 6, ax * 0.5, -0.14, az * 0.5, dim(accent, 0.6));
      weld.rotation.copy(boom.rotation);
      // 沿臂外露線束(只做對角兩臂 = 手工不對稱):ESC 盒騎在套管上、三相線貼頂、束帶 ×2 綁死
      // —— 野戰拼裝機的電調與線材從不藏進殼內
      if (i === 0 || i === 3) {
        const esc = bx(tilt, 0.2, 0.06, 0.12, ax * 0.63, -0.03, az * 0.63, 0x1d2126, { metalness: 0.5 });
        esc.rotation.y = Math.atan2(-az, ax);   // 長軸沿臂,盒底沉入套管頂面
        const wire = cyl(tilt, 0.022, 0.022, 1.0, 5, ax * 0.7, -0.04, az * 0.7, 0x14171a);
        wire.rotation.set(0, Math.atan2(-az, ax), Math.PI / 2);   // 外端收在馬達鐘前、內端沒入機身
        for (const f of [0.72, 0.88]) {   // 束帶箍住套管+線束,避開臂中點焊縫環
          const zip = cyl(tilt, 0.125, 0.125, 0.035, 6, ax * f, -0.14, az * f, 0x14171a);
          zip.rotation.copy(boom.rotation);
        }
      }
    }
    // 可拆貨架:縱軌以吊架立柱生根 slab 底板、橫檔連接兩軌;軌下懸掛迫擊砲彈
    // (彈體尾翼外露 = 夜襲轟炸機的招牌掛載;x=0 置中,不碰 x±0.34 的武器雙莢)
    for (const sx of [-1, 1]) {
      bx(tilt, 0.06, 0.06, 1.5, sx * 0.13, -0.62, -0.05, PAL.dark, { metalness: 0.6 });   // 縱軌(收在武器雙莢內緣之內)
      for (const z of [-0.55, 0.45]) bx(tilt, 0.05, 0.4, 0.05, sx * 0.13, -0.45, z, 0x1c1f22);   // 吊架立柱
    }
    for (const z of [-0.6, 0, 0.6]) bx(tilt, 0.62, 0.05, 0.06, 0, -0.62, z, PAL.mid);     // 橫檔
    // 貨架斜拉筋:後對自縱軌外張斜上抵下碳板底緣、前對沿 x=±0.13 縱平面前拉(閃開武器莢與彈頭)
    // —— 農噴貨架是「栓上去的」,斜拉筋是可拆件的結構語言,也解掉細立柱吊重彈的懸空感
    for (const sx of [-1, 1]) {
      const rbrace = cyl(tilt, 0.018, 0.018, 0.42, 5, sx * 0.29, -0.49, -0.685, 0x1c1f22);
      rbrace.rotation.z = -sx * 0.93;
      rbrace.rotation.x = -0.28;   // 前後傾角兩側同號(鏡像只在 z 旋),鏡像 x 旋會外甩懸空
      const fbrace = cyl(tilt, 0.018, 0.018, 0.39, 5, sx * 0.13, -0.49, 0.7, 0x1c1f22);
      fbrace.rotation.x = 0.87;    // 正號頂端前傾抵碳板(負號會後仰懸空)
    }
    for (const z of [-0.35, 0.35]) {
      bx(tilt, 0.04, 0.14, 0.04, 0, -0.72, z, PAL.dark);                                  // 吊耳
      const c = cyl(tilt, 0.09, 0.11, 0.5, 8, 0, -0.85, z, PAL.lite, { metalness: 0.5 }); // 彈體
      c.rotation.x = Math.PI / 2;                                                         // 彈軸沿 z
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 8), mat(dim(accent, 0.8)));
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, -0.85, z + 0.33);                                              // 彈鼻
      tilt.add(nose);
      for (let i = 0; i < 4; i++) {
        const fin = bx(tilt, 0.02, 0.14, 0.16, 0, -0.85, z - 0.3, PAL.dark);
        fin.rotation.z = i * Math.PI / 4;                                                 // 十字尾翼
      }
    }
  } else if (frame === 'coax') {
    // 同軸雙槳:上下反轉雙層(視覺上仍各自繞 y 轉)
    const mast = cyl(tilt, 0.1, 0.12, 0.9, 8, 0, 0.55, 0, 0x14171a);
    mast.rotation.x = 0;
    // 傾斜盤 + 槳距連桿(架在兩層槳之間 —— 共軸機的機構識別全靠外露的旋翼頭)
    cyl(tilt, 0.16, 0.16, 0.06, 8, 0, 0.68, 0, PAL.dark, { metalness: 0.8 });
    for (const sx of [-1, 1]) {
      const link = cyl(tilt, 0.018, 0.018, 0.16, 5, sx * 0.13, 0.76, 0.03, 0x23262a);
      link.rotation.z = -sx * 0.2;   // 盤緣斜上接上層旋翼頭
    }
    // 下層傾斜盤 + 連桿(2026-07-22 整修):下層槳也要變距 —— 只有上層有機構會被行家一眼看穿;
    // 兩層槳同步上移(0.35/0.7 → 0.55/0.85),修掉舊制下層槳掃進電池箱體的穿模
    cyl(tilt, 0.15, 0.15, 0.05, 8, 0, 0.49, 0, PAL.dark, { metalness: 0.8 });
    for (const sx of [-1, 1]) {
      const link = cyl(tilt, 0.018, 0.018, 0.08, 5, sx * 0.11, 0.525, 0.03, 0x23262a);
      link.rotation.z = -sx * 0.25;   // 環緣斜上指向下層旋翼頭
    }
    for (const y of [0.55, 0.85]) {
      const prop = new THREE.Group();
      prop.position.y = y;
      tilt.add(prop);
      for (let i = 0; i < 3; i++) {   // 三葉寬槳(重載運補語彙,不是競速兩葉窄板)
        const a = i * Math.PI * 2 / 3;
        const blade = bx(prop, 1.05, 0.04, 0.24, Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5,
          0x9aa4ad, { transparent: true, opacity: 0.8 });
        blade.rotation.y = a;
      }
      cyl(prop, 0.14, 0.14, 0.09, 8, 0, 0.01, 0, 0x1a1d20, { metalness: 0.85 });   // 旋翼頭轂(隨層自轉)
      props.push(prop);
    }
  } else if (frame === 'wing') {
    const wing = bx(tilt, 3.4, 0.08, 0.78, 0, 0.06, -0.1, carbonLt, { metalness: 0.6 });
    for (const sx of [-1, 1]) {
      bx(wing, 0.5, 0.06, 0.4, sx * 1.62, 0.02, -0.28, dim(accent, 0.85)).rotation.y = sx * -0.3;  // 翼尖識別
      addRotor(sx * 1.3, -0.5, 0.8);
    }
  } else {
    // 競速 true-X:收緊軸距放大槳身比(小架大槳);觀戰 fallback 維持 1.5
    const rq = bodyKind === 'wedge' ? 1.32 : 1.5;
    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      addRotor(sx * rq, sz * rq);
      // 臂底隊色 LED 條(純識別燈,MUST NOT 掛 glows):競速賽規靠隊色判讀,
      // 夜賽底光是「那台粉紅的」招牌 —— 壓坡時四臂軌跡一眼可讀
      if (bodyKind === 'wedge') {
        const led = bx(tilt, 1.05, 0.02, 0.06, sx * 0.73, -0.2, sz * 0.73, accent, { emissive: accent, emissiveIntensity: 2.0 });
        led.rotation.y = Math.atan2(-sz * rq, sx * rq);   // 與臂同向,頂面貼臂底
      }
    }
  }
  g.userData.spin = props; // 每幀旋轉
  g.userData.rig = { kind: 'aerial', tilt, tiltY0: 1.3, bob: 0.06, top: 30, heavy: heavyRig,
    // 機載武器:後座走 _kickB 打進機身(stepAerial 機鼻上仰脈衝、蓄力反向微壓)
    weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.05 },
    lightGlow: [{ mesh: lp.muz, base: lp.muz.material.emissiveIntensity }],
    muzzles: { light: { n: lp.muz, r: 0.075 }, heavy: { n: hp.muz, r: 0.12 } },
    // rig.wpn:左莢輕/右莢重皆 podWeapon 單根(幾何一律沿局部 +z 朝前,muz z>0)
    wpn: { light: { nodes: [lp.g], ref: lp.g, muz: lp.muz, fwd: 'z' },
      heavy: { nodes: [hp.g], ref: hp.g, muz: hp.muz, fwd: 'z' } } };
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
function buildFixedWing(side, vis, ch = null) {
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
  const whip = cyl(tilt, 0.015, 0.02, 0.5, 5, 0, 0.4, -0.6, 0x14171a);
  whip.rotation.x = 0.5;
  // 翼尖航行燈(左紅右綠:壓坡時姿態一目了然)
  const wingY = 0.16;
  const tipLight = (x, z, y = wingY + 0.04) => {
    bx(tilt, 0.16, 0.05, 0.18, -x, y, z, 0xff5544, { emissive: 0xff3322, emissiveIntensity: 1.6 });
    bx(tilt, 0.16, 0.05, 0.18, x, y, z, 0x55ff88, { emissive: 0x22ff66, emissiveIntensity: 1.6 });
  };
  if (W === 'twinboom') {
    // 高直翼 + 雙尾桁 + 端板雙垂尾;尾部推進槳(RQ-7 式:槳在艙尾、鼻子留給感測器)
    bx(tilt, span, 0.07, 0.55, 0, wingY, 0.15, lite, { metalness: 0.5 });
    for (const sx of [-1, 1]) {
      bx(tilt, 0.5, 0.06, 0.42, sx * (span / 2 - 0.25), wingY + 0.02, 0.12, dim(accent, 0.85));
      bx(tilt, 0.09, 0.09, 2.1, sx * 0.62, wingY, -0.95, dark, { metalness: 0.6 });   // 尾桁
      bx(tilt, 0.16, 0.13, 0.5, sx * 0.62, wingY, 0.05, dark, { metalness: 0.6 });    // 翼桁接合整流罩
      bx(tilt, 0.07, 0.62, 0.42, sx * 0.62, wingY + 0.3, -1.95, lite);                // 垂尾
      bx(tilt, 0.08, 0.14, 0.3, sx * 0.62, wingY + 0.62, -1.98, accent, { emissive: accent, emissiveIntensity: 0.8 });
      // 尾桁接管節環 —— frame 機體的可拆桁架關節表達
      const bring = cyl(tilt, 0.07, 0.07, 0.06, 6, sx * 0.62, wingY, -0.55, PAL.deep, { metalness: 0.7 });
      bring.rotation.x = Math.PI / 2;
      // 副翼伺服鼓包 —— RQ-7 翼下伺服整流罩,實機辨識點
      bx(tilt, 0.1, 0.05, 0.2, sx * 0.85, 0.115, 0.0, dim(accent, 0.7), { metalness: 0.5 });
    }
    bx(tilt, 1.24, 0.06, 0.4, 0, wingY + 0.5, -1.95, lite);                           // 水平尾
    // 尾桁間偶極天線陣 —— 空腔就是為了掛這排耳朵(橫桿兩端沒入尾桁內側面生根)
    bx(tilt, 1.2, 0.035, 0.035, 0, wingY, -1.62, PAL.dark, { metalness: 0.6 });
    for (const xx of [-0.38, 0, 0.38])
      bx(tilt, 0.025, 0.2, 0.07, xx, wingY - 0.13, -1.62, accent, { emissive: accent, emissiveIntensity: 0.5 });
    // 對數週期第二排 —— 振子由前到後遞減長度,單排不成陣、兩排才是 SIGINT 的頻譜語彙
    bx(tilt, 1.2, 0.035, 0.035, 0, wingY, -1.25, PAL.dark, { metalness: 0.6 });
    for (const xx of [-0.38, 0, 0.38])
      bx(tilt, 0.025, 0.28, 0.07, xx, 0.01, -1.25, accent, { emissive: accent, emissiveIntensity: 0.5 });
    mkProp(-1.40, 2, 0.9);
    // 馬達尾錐整流罩:前端沒入機尾帽、後端銜接槳轂 = 推進槳生根
    const fair = cyl(tilt, 0.24, 0.1, 0.32, 10, 0, 0.02, -1.1, dark, { metalness: 0.6 });
    fair.rotation.x = Math.PI / 2;
    // 機腹 canoe 訊號情報整流罩
    const cn = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.7, 4, 8), mat(PAL.dark, { metalness: 0.6 }));
    cn.rotation.x = Math.PI / 2;
    cn.position.set(0, -0.31, -0.15);
    tilt.add(cn);
    bx(tilt, 0.02, 0.03, 0.5, 0.09, -0.31, -0.15, accent, { emissive: accent, emissiveIntensity: 0.7 });
    // canoe 腹鰭測向刀天線 —— SIGINT canoe 從不孤立,成對測向
    bx(tilt, 0.02, 0.09, 0.14, 0, -0.40, 0.05, PAL.dark, { metalness: 0.6 }).rotation.x = -0.3;
    bx(tilt, 0.02, 0.09, 0.14, 0, -0.40, -0.35, PAL.dark, { metalness: 0.6 }).rotation.x = 0.3;
    // SATCOM 蘑菇頂 —— RQ-7 背部上行鏈路鼓包,「訊號機」的天眼
    const sat = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), mat(PAL.lite, { metalness: 0.4 }));
    sat.scale.set(1, 0.5, 1);
    sat.position.set(0, 0.35, 0.4);
    tilt.add(sat);
    // 背脊桁條板 —— 素膠囊切出 razorback 面板分割,兌現 body 'frame'
    bx(tilt, 0.26, 0.05, 0.85, 0, 0.30, -0.15, PAL.lite, { metalness: 0.5 });
    // 引擎冷卻進氣+排氣短管 —— 推進槳前的引擎要呼吸(車庫機務感)
    bx(tilt, 0.14, 0.08, 0.24, 0, 0.30, -0.7, PAL.dark, { metalness: 0.6 });
    bx(tilt, 0.1, 0.05, 0.03, 0, 0.30, -0.57, 0x14171a);
    const exh = cyl(tilt, 0.025, 0.03, 0.2, 6, 0.2, -0.12, -0.82, 0x14171a, { metalness: 0.8 });
    exh.rotation.x = Math.PI / 2 - 0.25;
    // 機鼻測向刀片天線 —— SIGINT 機的觸角(斜後傾,基座沒入機鼻蒙皮)
    for (const sx of [-1, 1]) bx(tilt, 0.018, 0.15, 0.2, sx * 0.12, 0.3, 0.7, PAL.dark, { metalness: 0.6 }).rotation.x = -0.5;
    tipLight(span / 2 - 0.1, 0.15);
  } else if (W === 'vtail') {
    // 後掠中翼 + 翼尖上折小翼 + V 尾;尾推槳(ScanEagle 剪影)
    for (const sx of [-1, 1]) {
      const wg = bx(tilt, span / 2, 0.07, 0.55, sx * span / 4, wingY, 0.3, lite, { metalness: 0.5 });
      wg.rotation.y = sx * 0.22;                                                      // 後掠
      bx(wg, 0.5, 0.06, 0.44, sx * 0.55, 0.02, -0.04, dim(accent, 0.85));             // 識別帶(隨翼後掠)
      bx(wg, 0.05, 0.26, 0.3, sx * (span / 4 - 0.04), 0.12, -0.05, dark, { metalness: 0.6 });   // 翼尖上折小翼
      // 副翼傳動:扭力桿+搖臂盤+寶石軸 —— 與 V 尾 rod/rk/scr 同語彙,把錶芯輪系鋪滿全機
      const trod = cyl(wg, 0.012, 0.012, 0.5, 5, -sx * 0.2, -0.05, -0.1, 0x23262a, { metalness: 0.85 });
      trod.rotation.z = Math.PI / 2;
      cyl(wg, 0.045, 0.045, 0.03, 8, sx * 0.1, -0.05, -0.12, PAL.deep, { metalness: 0.85 });
      const jw = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 5), mat(accent, { emissive: accent, emissiveIntensity: 0.6 }));
      jw.position.set(sx * 0.1, -0.07, -0.12);
      wg.add(jw);
      // 天鉤回收鉤 —— ScanEagle 無跑道、翼尖掛繩回收,原型第一識別
      bx(wg, 0.03, 0.05, 0.16, sx * (span / 4 - 0.04), 0.27, 0.1, PAL.deep, { metalness: 0.8 });
      bx(wg, 0.03, 0.04, 0.05, sx * (span / 4 - 0.04), 0.23, 0.19, PAL.deep);
      // 錶背觀察窗 —— 鐘匠的透明錶背蓋:表圈+八稜齒輪盤(純識別發光,不進 glows)
      const bez = cyl(tilt, 0.095, 0.095, 0.03, 12, sx * 0.285, 0.04, 0.35, PAL.deep, { metalness: 0.85 });
      bez.rotation.z = Math.PI / 2;
      const dial = cyl(tilt, 0.06, 0.06, 0.035, 8, sx * 0.30, 0.04, 0.35, dim(accent, 0.8), { metalness: 0.8, emissive: accent, emissiveIntensity: 0.35 });
      dial.rotation.z = Math.PI / 2;
    }
    // 擺輪飛輪 —— 錶芯輪系半沉機背外露,精密儀器感的主視覺
    const bal = cyl(tilt, 0.11, 0.11, 0.05, 12, 0, 0.26, -0.45, PAL.deep, { metalness: 0.85 });
    bal.rotation.z = Math.PI / 2;
    const rim = cyl(tilt, 0.122, 0.122, 0.02, 12, 0, 0.26, -0.45, dim(accent, 0.75), { metalness: 0.8 });
    rim.rotation.z = Math.PI / 2;
    bx(tilt, 0.16, 0.14, 1.3, 0, 0, -0.85, dark, { metalness: 0.6 });                 // 尾桁
    // 拆翼快拆軸 —— 鐘匠的關節環與軸端蓋(橫貫翼根前緣,軸頂微凸翼面)
    const hg = cyl(tilt, 0.055, 0.055, 0.5, 8, 0, wingY + 0.03, 0.42, PAL.deep, { metalness: 0.85 });
    hg.rotation.z = Math.PI / 2;
    for (const sx of [-1, 1]) {
      const cap = cyl(tilt, 0.07, 0.07, 0.03, 8, sx * 0.26, wingY + 0.03, 0.42, PAL.deep, { metalness: 0.85 });
      cap.rotation.z = Math.PI / 2;
    }
    for (const sx of [-1, 1]) {
      const fin = bx(tilt, 0.6, 0.06, 0.42, sx * 0.28, 0.34, -1.1, lite);
      fin.rotation.z = sx * 0.8;                                                      // V 尾
      // V 尾舵面推桿與搖臂 —— 外露的錶芯傳動(桿上端貼 fin 根、下端沒入尾桁)
      const rod = cyl(tilt, 0.012, 0.012, 0.52, 5, sx * 0.16, 0.18, -0.97, 0x23262a, { metalness: 0.85 });
      rod.rotation.x = -0.5;
      rod.rotation.z = -sx * 0.35;   // 上端貼搖臂圓盤、下端沒入尾桁(Rz 先作用,正號會兩端懸空)
      const rk = cyl(tilt, 0.05, 0.05, 0.03, 8, sx * 0.26, 0.32, -1.08, PAL.deep, { metalness: 0.85 });
      rk.rotation.z = Math.PI / 2;
      const scr = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5), mat(accent, { emissive: accent, emissiveIntensity: 0.6 }));
      scr.position.set(sx * 0.28, 0.32, -1.08);
      tilt.add(scr);
      bx(fin, 0.18, 0.08, 0.44, sx * 0.24, 0.02, 0, accent, { emissive: accent, emissiveIntensity: 0.8 });
      // V 尾關節防塵罩 —— 包住 fin 根與尾桁接合、蓋掉推桿下端消失點(精密機構怕塵)
      bx(tilt, 0.14, 0.12, 0.18, sx * 0.1, 0.12, -1.1, PAL.dark, { metalness: 0.4 }).rotation.z = sx * 0.8;
    }
    // ScanEagle 鼻端慣性穩定光電轉塔 —— 轉塔就是鼻尖
    const eo = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), mat(PAL.dark, { metalness: 0.6 }));
    eo.position.set(0, -0.02, 1.32);
    tilt.add(eo);
    const cam = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.2 }));
    cam.position.set(0, -0.02, 1.46);
    tilt.add(cam);
    const rc = cyl(tilt, 0.16, 0.16, 0.05, 10, 0, -0.02, 1.2, PAL.deep, { metalness: 0.8 });
    rc.rotation.x = Math.PI / 2;                                                      // 轉塔座環
    mkProp(-1.5, 2, 0.85);
    tipLight(span / 2 - 0.16, 0.12, wingY + 0.06);
  } else if (W === 'canard') {
    // 鴨式:機鼻前翼 + 後置後掠主翼 + 單垂尾;電戰機噴射動力(無槳)
    for (const sx of [-1, 1]) {
      const mw = bx(tilt, span / 2, 0.07, 0.6, sx * span / 4, wingY, -0.45, lite, { metalness: 0.5 });
      mw.rotation.y = sx * 0.35;                                                      // 後掠
      // 筒射摺疊翼鉸線 —— Harop 是筒射遊蕩彈,翼中段的摺疊鉸線是原型第一識別
      bx(mw, 0.05, 0.085, 0.62, sx * 0.15, 0, 0, PAL.deep, { metalness: 0.8 });
      const hng = cyl(mw, 0.035, 0.035, 0.07, 6, sx * 0.15, 0, 0.31, PAL.deep, { metalness: 0.8 });
      hng.rotation.x = Math.PI / 2;                                                   // 鉸鏈筒凸在前緣
      bx(mw, 0.05, 0.34, 0.44, sx * (span / 4 - 0.04), -0.15, -0.06, dark, { metalness: 0.6 });   // Harop 式翼尖下折小翼
      // 翼尖電戰吊艙 —— 急轉時維持指向的耳朵(前端 accent 端帽 = 干擾波束指向器)
      const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.34, 4, 8), mat(PAL.dark, { metalness: 0.7 }));
      pod.rotation.x = Math.PI / 2;
      pod.position.set(sx * (span / 4 - 0.05), 0.02, 0.1);
      mw.add(pod);
      const emit = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 0.8 }));
      emit.position.set(sx * (span / 4 - 0.05), 0.02, 0.34);
      mw.add(emit);
      // 干擾線圈環 ×2 —— 電戰吊艙外箍的螺旋天線,壓制波束的機能細節
      for (const zz of [0.02, 0.22]) {
        const coil = cyl(mw, 0.075, 0.075, 0.02, 8, sx * (span / 4 - 0.05), 0.02, zz, dim(accent, 0.7), { metalness: 0.7 });
        coil.rotation.x = Math.PI / 2;
      }
      bx(mw, 0.45, 0.06, 0.46, sx * (span / 4 - 0.2), 0.02, 0, dim(accent, 0.85));
      bx(tilt, 0.3, 0.26, 0.5, sx * 0.42, -0.16, -0.5, dark, { metalness: 0.7 });     // 側進氣口
      // 進氣唇緣(暗色開口)+ 附面層分離板 —— 實心盒讀成會呼吸的進氣道
      bx(tilt, 0.24, 0.2, 0.05, sx * 0.42, -0.16, -0.245, 0x14171a, { metalness: 0.85 });
      bx(tilt, 0.02, 0.26, 0.3, sx * 0.25, -0.16, -0.4, PAL.deep, { metalness: 0.7 });
      // 楔形頰板 chine —— 兌現 body 'wedge':Harop 稜線機鼻剪影
      bx(tilt, 0.5, 0.06, 0.9, sx * 0.26, -0.04, 0.75, shell, { metalness: 0.6 }).rotation.y = sx * 0.18;
      // LERX —— 鴨翼與主翼側視連成一體的前緣延伸(貼機身蒙皮外側)
      bx(tilt, 0.07, 0.035, 1.15, sx * 0.3, 0.16, 0.35, lite, { metalness: 0.5 }).rotation.y = sx * 0.1;
    }
    // 腹側收發分置刀天線 —— 「全頻壓制」與背脊三片刀天線成上下對(機尾收分處貼腹)
    bx(tilt, 0.018, 0.14, 0.18, 0, -0.245, -0.7, PAL.dark, { metalness: 0.6 }).rotation.x = 0.6;
    bx(tilt, 0.018, 0.14, 0.18, 0, -0.20, -1.0, PAL.dark, { metalness: 0.6 }).rotation.x = 0.6;
    // 鴨翼在鼻尖左右分離、帶上反(Harop 佈局;內緣沒入機身生根)
    for (const sx of [-1, 1]) {
      const cnr = bx(tilt, 0.52, 0.04, 0.28, sx * 0.42, 0.06, 1.05, lite, { metalness: 0.5 });
      cnr.rotation.z = sx * 0.18;
      cnr.rotation.y = sx * 0.22;
    }
    // 電戰刀片天線陣 —— 背脊斜置三片,基座沒入機背蒙皮
    for (const zz of [0.55, 0.15, -0.25]) bx(tilt, 0.02, 0.18, 0.26, 0, 0.34, zz, PAL.dark, { metalness: 0.6 }).rotation.x = -0.55;
    bx(tilt, 0.07, 0.6, 0.5, 0, 0.42, -1.0, lite);                                    // 垂尾
    // 方向舵分板 —— 比垂尾微寬的獨立舵面,一整塊板切出層次
    bx(tilt, 0.078, 0.5, 0.18, 0, 0.4, -1.17, dim(lite, 0.82), { metalness: 0.5 });
    bx(tilt, 0.08, 0.16, 0.34, 0, 0.72, -1.05, accent, { emissive: accent, emissiveIntensity: 0.8 });
    mkJet(-1.35);
    // 噴口花瓣裙 —— 外擴讀成可調噴口,jet 機種的推力視覺補完
    const skt = cyl(tilt, 0.19, 0.23, 0.12, 10, 0, 0, -1.52, 0x14171a, { metalness: 0.85 });
    skt.rotation.x = Math.PI / 2;
    tipLight(span / 2 * 0.94, -0.9, wingY + 0.06);
  } else if (W === 'zero') {
    // 零式(A6M):星型引擎整流罩 + 三葉牽引槳 + 橢圓低單翼 + 氣泡艙罩 + 單垂尾/水平尾
    const cowl = cyl(tilt, 0.42, 0.36, 0.55, 12, 0, -0.02, 1.2, dark, { metalness: 0.75 });
    cowl.rotation.x = Math.PI / 2;
    cyl(cowl, 0.3, 0.3, 0.6, 12, 0, 0, 0, 0x14171a);                                  // 進氣環內壁
    // 栄星型引擎正面 —— 牽引槳機第一眼是進氣環裡的七具放射氣缸(確定性迴圈)
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2;
      const cylr = cyl(tilt, 0.05, 0.05, 0.16, 6, Math.cos(a) * 0.19, -0.02 + Math.sin(a) * 0.19, 1.32, 0x1c2126, { metalness: 0.8 });
      cylr.rotation.z = a + Math.PI / 2;                                              // 長軸轉成放射向
    }
    const gbox = cyl(tilt, 0.1, 0.13, 0.1, 8, 0, -0.02, 1.44, 0x23262a, { metalness: 0.8 });
    gbox.rotation.x = Math.PI / 2;                                                    // 減速器機匣環(填唇口與槳轂之間)
    // 汽化器上唇進氣口 —— A6M2 的招牌識別
    bx(tilt, 0.16, 0.07, 0.28, 0, 0.40, 1.12, PAL.mid, { metalness: 0.6 });
    bx(tilt, 0.12, 0.04, 0.03, 0, 0.41, 1.26, 0x14171a);
    // 栄引擎排氣短管(整流罩後緣下側,斜向後下)
    for (const sx of [-1, 1]) {
      const ex = cyl(tilt, 0.035, 0.04, 0.22, 6, sx * 0.36, -0.14, 0.92, 0x14171a, { metalness: 0.8 });
      ex.rotation.x = Math.PI / 2;
      ex.rotation.z = sx * 0.25;
    }
    for (const sx of [-1, 1]) {
      // 橢圓低單翼:內翼厚弦 + 外翼收分上反(翼端主色識別帶)
      const inner = bx(tilt, span * 0.3, 0.09, 0.95, sx * span * 0.16, -0.16, 0.1, lite, { metalness: 0.5 });
      inner.userData.hinomaru = true;   // 標記機翼面 → paint.js paintWingRoundel 於頂/底各蓋一枚紅日(雙翼正反面)
      const outer = bx(tilt, span * 0.22, 0.07, 0.62, sx * span * 0.4, -0.1, 0.02, lite, { metalness: 0.5 });
      outer.rotation.z = sx * -0.12;                                                   // 上反角
      outer.rotation.y = sx * 0.12;                                                    // 前緣微後掠(橢圓翼收分)
      bx(outer, span * 0.1, 0.06, 0.5, sx * span * 0.08, 0.02, -0.02, dim(accent, 0.85));
      // 翼內 20mm 機砲已拆除(2026-07-22 規則 5:無功能裝飾砲管不留 —— 功能武裝在翼下莢艙)
      bx(inner, 0.3, 0.1, 0.36, sx * span * 0.06, -0.14, -0.1, 0x23262a);             // 主輪整流罩
      // 襟翼分板 —— 內翼後緣下方微凸,讀成放下的開縫襟翼
      bx(tilt, 0.6, 0.035, 0.2, sx * 0.5, -0.21, -0.3, dim(lite, 0.82), { metalness: 0.5 });
      if (sx < 0) {   // 左翼單根皮托管(掛 outer 隨上反後掠;前端凸出前緣 = 標準翼前緣皮托)
        const pt = cyl(outer, 0.012, 0.012, 0.4, 5, -0.25, 0, 0.33, PAL.deep, { metalness: 0.8 });
        pt.rotation.x = Math.PI / 2;
      }
    }
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), mat(accent, { transparent: true, opacity: 0.55, emissive: accent, emissiveIntensity: 0.5 }));
    canopy.scale.set(0.8, 0.7, 1.9);
    canopy.position.set(0, 0.28, 0.15);
    tilt.add(canopy);
    // 零式溫室艙罩框條 —— 三道框讀出年代(逐框貼艙罩頂弧;透明件不描邊,框條自己就是輪廓)
    bx(tilt, 0.3, 0.025, 0.03, 0, 0.42, -0.25, PAL.deep, { metalness: 0.6 });
    bx(tilt, 0.3, 0.025, 0.03, 0, 0.475, 0.15, PAL.deep, { metalness: 0.6 });
    bx(tilt, 0.3, 0.025, 0.03, 0, 0.435, 0.5, PAL.deep, { metalness: 0.6 });
    // 零式細尾收分 —— 前端接膠囊尾帽、收到尾尖,垂尾/水平尾生根其上
    const tp = cyl(tilt, 0.24, 0.05, 0.75, 10, 0, 0.02, -1.4, shell, { metalness: 0.6 });
    tp.rotation.x = Math.PI / 2;
    bx(tilt, 0.07, 0.68, 0.7, 0, 0.42, -1.35, lite);                                  // 垂尾
    // 方向舵分板+調整片 —— 一整塊垂尾切出舵面層次,accent 調整片兼識別
    bx(tilt, 0.078, 0.6, 0.22, 0, 0.4, -1.61, dim(lite, 0.85), { metalness: 0.5 });
    bx(tilt, 0.082, 0.14, 0.06, 0, 0.22, -1.66, dim(accent, 0.85));
    bx(tilt, 0.1, 0.2, 0.34, 0, 0.78, -1.4, accent, { emissive: accent, emissiveIntensity: 0.9 });
    bx(tilt, 1.5, 0.05, 0.45, 0, 0.06, -1.4, lite, { metalness: 0.5 });               // 水平尾
    bx(tilt, 0.12, 0.16, 0.24, 0, -0.1, -1.55, 0x23262a);                             // 尾輪
    // 著艦鉤 —— 「艦戰」身分的唯一硬證據(前端沒入尾錐腹面、鉤尖朝後下)
    const ahk = cyl(tilt, 0.018, 0.018, 0.42, 5, 0, -0.14, -1.35, PAL.deep, { metalness: 0.8 });
    ahk.rotation.x = Math.PI / 2 - 0.35;
    bx(tilt, 0.03, 0.06, 0.04, 0, -0.23, -1.56, PAL.deep);                            // 鉤爪
    // 機腹落下增槽 —— 零式長航程的標誌掛載(中線掛帶 ×2)
    const tk = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.55, 4, 8), mat(PAL.lite, { metalness: 0.5 }));
    tk.rotation.x = Math.PI / 2;
    tk.position.set(0, -0.4, 0.15);
    tilt.add(tk);
    bx(tilt, 0.22, 0.03, 0.04, 0, -0.32, 0.0, PAL.dark, { metalness: 0.5 });
    bx(tilt, 0.22, 0.03, 0.04, 0, -0.32, 0.3, PAL.dark, { metalness: 0.5 });
    mkProp(1.55, 3, 1.2);
    // 零式轂蓋 —— 牽引槳機的第一眼尖端(底座壓在槳盤上,槳根沒入轂蓋)
    const spn = cyl(tilt, 0.03, 0.15, 0.3, 10, 0, 0.02, 1.82, PAL.deep, { metalness: 0.85 });
    spn.rotation.x = Math.PI / 2;
    tipLight(span * 0.48, 0.02, -0.06);
  } else {
    // 三角飛翼:大後掠翼 + 翼端垂直小翼;隱形偵察機噴射動力(無槳,背部進氣)
    for (const sx of [-1, 1]) {
      const w1 = bx(tilt, span / 2, 0.07, 1.5, sx * span / 4, wingY, -0.3, lite, { metalness: 0.5 });
      w1.rotation.y = sx * 0.5;                                                       // 後掠
      // LERX —— 三角翼與機身融成一體的前緣延伸(前端伸向機鼻側)
      bx(tilt, 0.07, 0.04, 1.0, sx * 0.3, wingY, 0.65, lite, { metalness: 0.5 }).rotation.y = sx * 0.16;
      bx(w1, span / 4, 0.06, 0.62, sx * span / 8, 0.02, -0.3, dim(accent, 0.85));
      // 端板小翼:w1 局部半寬 = span/4,x 用 span/4 基準才落在翼尖(span/2 會懸空一倍翼展)
      bx(w1, 0.06, 0.42, 0.5, sx * (span / 4 - 0.03), 0.2, -0.45, dark);              // 端板小翼
      // 靜電放電刷 —— 三角翼後緣的 static wick,高速機標配(凸出後緣的細刺)
      const wick = cyl(w1, 0.008, 0.008, 0.14, 4, sx * 0.52, 0, -0.72, PAL.deep, { metalness: 0.7 });
      wick.rotation.x = Math.PI / 2;
    }
    bx(tilt, 0.5, 0.16, 0.6, 0, 0.3, -0.35, dark, { metalness: 0.7 });                // 背部進氣口
    bx(tilt, 0.44, 0.12, 0.05, 0, 0.30, -0.06, 0x14171a, { metalness: 0.85 });        // 進氣嘴(暗色開口=會呼吸)
    // dorsal duct 隆線:背部進氣道沿機背延伸接進尾噴口
    bx(tilt, 0.3, 0.13, 0.85, 0, 0.28, -0.85, dark, { metalness: 0.7 });
    // RATO 起飛助推器 —— Tu-141 拖車筒射+固態助推的起飛儀式(掛帶包覆、噴口朝後下,非槍管)
    const rato = cyl(tilt, 0.085, 0.1, 0.55, 8, 0, -0.33, -1.05, PAL.dark, { metalness: 0.6 });
    rato.rotation.x = Math.PI / 2 - 0.12;
    const rnoz = cyl(tilt, 0.05, 0.085, 0.1, 8, 0, -0.365, -1.36, 0x14171a, { metalness: 0.85 });
    rnoz.rotation.x = Math.PI / 2 - 0.12;
    bx(tilt, 0.24, 0.03, 0.06, 0, -0.26, -0.95, PAL.deep, { metalness: 0.6 });        // 掛帶
    // 回收傘艙門 —— 傘降回收;代號「歸鄉」,每次任務結束都要回家的那扇門
    bx(tilt, 0.26, 0.02, 0.44, 0, -0.285, -0.5, dim(shell, 0.88), { metalness: 0.5 });
    bx(tilt, 0.08, 0.015, 0.08, 0, -0.297, -0.5, dim(accent, 0.8));                   // 開傘標記
    // Tu-141 大後掠中央垂尾(根部沒入隆線生根)+ 尾頂識別燈
    const vf = bx(tilt, 0.05, 0.46, 0.62, 0, 0.38, -1.0, lite, { metalness: 0.5 });
    vf.rotation.x = -0.42;                                                            // 頂端向 -z 後掠
    bx(tilt, 0.07, 0.12, 0.26, 0, 0.56, -1.16, accent, { emissive: accent, emissiveIntensity: 0.8 });
    // Tu-141 尖錐鼻 —— 高速偵察機的第一眼(底座沒入膠囊前帽)
    const nc = cyl(tilt, 0.02, 0.26, 0.55, 10, 0, 0, 1.5, shell, { metalness: 0.6 });
    nc.rotation.x = Math.PI / 2;
    // 星光導航儀上視窗 —— SR-71 astrotracker 同款(半球朝天 = 抬頭看星星)
    const dm = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), mat(accent, { transparent: true, opacity: 0.5, emissive: accent, emissiveIntensity: 0.7 }));
    dm.position.set(0, 0.36, 0.55);
    tilt.add(dm);
    cyl(tilt, 0.105, 0.105, 0.04, 10, 0, 0.35, 0.55, PAL.deep, { metalness: 0.8 });   // 觀測窗座環
    // 星敏遮光罩 —— astrotracker 白天觀星靠遮光筒,「抬頭看星星」的機構化(罩口與球頂齊平)
    cyl(tilt, 0.1, 0.12, 0.09, 10, 0, 0.40, 0.55, PAL.deep, { metalness: 0.8 });
    // 背鰭刀天線 —— 高速偵察機背脊的資料鏈(基座沒入機背蒙皮,落在星圖板與進氣嘴之間)
    bx(tilt, 0.018, 0.11, 0.2, 0, 0.37, 0.08, PAL.dark, { metalness: 0.6 }).rotation.x = -0.45;
    mkJet(-1.25, 0.2);
    // 噴口花瓣裙 —— 與 s03 同語彙的可調噴口(收在焰環之前)
    const skirt = cyl(tilt, 0.17, 0.21, 0.12, 10, 0, 0, -1.42, 0x14171a, { metalness: 0.85 });
    skirt.rotation.x = Math.PI / 2;
    // 星圖蝕刻識別板 —— 微光星座板,夜戰遠觀即識(貼背脊艙蓋頂)
    bx(tilt, 0.26, 0.02, 0.3, 0, 0.36, 0.32, dim(accent, 0.6), { emissive: accent, emissiveIntensity: 0.25 });
    // 翼尖燈落回翼尖頂面(已反算 w1 後掠 0.5:世界 (±0.99,−0.85) = w1 局部 (0.54,−0.33))
    tipLight(0.99, -0.85, 0.215);
  }
  // 武裝(2026-07-16 改版):翼下硬點左右分裝 —— 左莢輕武器、右莢重武器(異型雙莢 + 掛架);
  // 輕重同型(s03 相控陣 beam×beam)= 機腹單一發射器,外圈陣列環為重模式(一具切換兩模)。
  // 莢體貼翼下、收在機體底線附近 —— fitToHeight 包圍盒不明顯撐高。
  const CW = (ch && CHARACTERS[ch]) || null;
  const LWD = CW?.light || { type: 'gun' }, HWD = CW?.heavy || { type: 'gun' };
  let lp, hp, hGlow, hMuz;
  if (CW && LWD.type === HWD.type) {
    lp = hp = podWeapon(tilt, HWD, accent, PAL, { L: 1.2, R: 0.09, x: 0, y: -0.34, z: 0.3 });
    // 重模式 = 發射器外圈相控陣列環(蓄力增亮;與輕模式透鏡同一具)
    const arr = cyl(hp.g, 0.24, 0.24, 0.07, 10, 0, 0, 0, accent, { emissive: accent, emissiveIntensity: 0.5 });
    arr.rotation.x = Math.PI / 2;
    arr.position.z = 0.42;
    hGlow = [...hp.glows, { mesh: arr, base: 0.5 }];
    hMuz = arr;
  } else {
    const pylX = span * 0.26, pylY = W === 'zero' ? -0.26 : wingY - 0.14;
    lp = podWeapon(tilt, LWD, accent, PAL, { L: 0.9, R: 0.055, x: -pylX, y: pylY, z: 0.25 });
    hp = podWeapon(tilt, HWD, accent, PAL,
      { L: 1.05, R: HWD.type === 'launcher' ? 0.1 : 0.065, x: pylX, y: pylY, z: 0.2 });
    for (const sx of [-1, 1])   // 掛架(pylon):莢體連回翼面
      bx(tilt, 0.05, Math.max(0.1, wingY - pylY), 0.26, sx * pylX, (wingY + pylY) / 2, 0.22, PAL.dark, { metalness: 0.6 });
    hGlow = hp.glows.length ? hp.glows : [{ mesh: hp.muz, base: 0.5 }];
    hMuz = hp.muz;
  }
  const heavyRig = {
    glow: hGlow,
    pivot: [{ obj: hp.g, rest: { x: 0, y: 0, z: 0 }, deploy: { x: -0.1, y: 0, z: 0 } }],
  };
  // rig.wpn:皆 podWeapon 單根(幾何一律沿局部 +z 朝前,muz z>0)。
  // 同型(lp===hp 機腹單莢一具雙模)= 同一組 nodes/ref,只有 muz 不同(輕 = 透鏡、重 = 陣列環);
  // 異型 = 左翼莢輕 / 右翼莢重,各自 ref=自身根
  const wpnL = { nodes: [lp.g], ref: lp.g, muz: lp.muz, fwd: 'z' };
  const wpnH = { nodes: lp === hp ? wpnL.nodes : [hp.g], ref: hp.g, muz: hMuz, fwd: 'z' };
  g.userData.spin = props;
  g.userData.rig = { kind: 'aerial', tilt, tiltY0: 1.3, bob: 0.05, top: 30,
    level: 1,                            // 定翼機:巡航機身水平,不隨前速前傾(旋翼機才傾轉)
    jets: jets.length ? jets : null,     // 噴射尾焰(canard/delta):速度驅動長度/亮度
    heavy: heavyRig,
    weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.04 },   // 機載:後座走 _kickB(stepAerial)
    lightGlow: [{ mesh: lp.muz, base: lp.muz.material.emissiveIntensity }],
    muzzles: { light: { n: lp.muz, r: 0.06 }, heavy: { n: hMuz, r: 0.1 } },
    wpn: { light: wpnL, heavy: wpnH } };   // rig.wpn:FPV 武裝同源(契約見 podWeapon 上方)
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
function buildAvianDrone(side, vis, ch = null) {
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
  const eagleTips = [];   // 翼下羽毛飛彈掛架彈尖(重武器:獵狐飛彈,launcher)
  const eagleFms = [];    // 翼下飛彈掛架群組 ×6(rig.wpn 節點集:掛架 + 彈尖整組)
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
      for (let i = 0; i < 3; i++)   // 次級飛羽列(內翼後緣:補滿覆羽與初級飛羽之間的翼面)
        feather(w, P.span * (0.26 - i * 0.02), 0.17 * bs, sgn * 0.1, -0.035, -0.16 - i * 0.06,
          0.6 + i * 0.22, sgn, dim(mid, 0.95), { metalness: 0.3 });
      for (let i = 0; i < 3; i++) {   // 翼下羽毛飛彈掛架(羽片即彈體,彈尖主色)照舊
        const fm = new THREE.Group();
        fm.position.set(sgn * P.span * (0.14 + i * 0.12), -0.12, -0.05 - i * 0.06);
        w.add(fm);
        bx(fm, 0.07, 0.06, 0.62, 0, 0, 0, 0x23262a, { metalness: 0.6 });
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.2, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.2 }));
        tip.rotation.x = Math.PI / 2;
        tip.position.z = 0.4;
        fm.add(tip);
        eagleTips.push(tip);
        eagleFms.push(fm);
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
        // 翼摺液壓缸:兩端同在 w 節點內 = 隨拍翼整體動不拉伸(單端錨原則);
        // 外端貼內翼骨梁頂、內端浮空當活塞頭
        const ram = cyl(w, 0.033, 0.033, 0.5, 6, sgn * 0.44, 0.10, 0.16, PAL.dark, { metalness: 0.8 });
        ram.rotation.z = sgn * 1.35;
        // 翼梢編隊燈(掛 outer 隨外翼甩;純識別燈,不進 glows)
        bx(outer, 0.06, 0.02, 0.12, sgn * 1.9, 0.06, 0.14, accent, { emissive: accent, emissiveIntensity: 1.0 });
      }
      if (C === 'ptero') {   // 翼膜指骨肋(比照 dragon 翼指骨梁):大片翼膜的張力可讀;掛 w/outer 隨拍翼
        const r1 = bx(w, P.span * 0.4, 0.035, 0.05, sgn * P.span * 0.2, 0, -0.33, dark, { metalness: 0.6 });
        r1.rotation.y = sgn * 0.28;
        const r2 = bx(outer, P.span * 0.32, 0.03, 0.045, sgn * P.span * 0.16, 0, -0.28, dark, { metalness: 0.6 });
        r2.rotation.y = sgn * 0.30;
      }
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.4, 5), mat(0xd8dde2, { metalness: 0.7 }));
      spike.position.set(sgn * P.span * 0.45, 0, 0.14);
      spike.rotation.z = sgn * -Math.PI / 2;
      outer.add(spike);
      if (C === 'ptero') for (const dz of [0.1, 0.0, -0.1]) {   // 腕點三指小爪(翼龍腕爪,爪尖朝前下,隨外翼拍動)
        const c2 = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.22, 5), mat(0xd8dde2, { metalness: 0.7 }));
        c2.position.set(sgn * 0.05, -0.02, 0.14 + dz);
        c2.rotation.x = 1.25;
        outer.add(c2);
      }
    }
    wings.push({ w, outer, sgn, pair });
  };
  for (const sgn of [-1, 1]) {
    mkWing(sgn, 0.2 * bs);
    if (P.pairs > 1) mkWing(sgn, -0.35 * bs, 1);
  }
  // ---- 生物形態(頭/尾/武裝)----
  let tailSegs = null;   // 僅重尾機種(機械龍)登記,供 stepAerial 甩尾配重驅動
  let heavyRig = { glow: [], pivot: [] };   // 重武器掛點(依生物分支填入)
  // 輕武器欄位(2026-07-16 起,依生物分支填入):輕/重異型 = 兩具分開的武裝結構
  let lightGlow = null, lMuz = null, hMuz = null;
  let wpnL = null, wpnH = null;   // rig.wpn(FPV 武裝同源;依生物分支填入,契約見 podWeapon 上方)
  if (C === 'bee') {
    // 頭:大複眼 ×2 + 觸角;節腹琥珀環紋;螫針 = 砲管(尾部後向武器)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.36 * bs, 10, 8), mat(mid, { metalness: 0.5 }));
    head.position.set(0, 0.14 * bs, 0.95 * bs);
    tilt.add(head);
    // 頭頂三顆單眼(ocelli)三角排列 = 蜂后冠冕,與雙複眼構成五眼
    for (const [ox, oy, oz] of [[0, 0.5, 1.0], [-0.1, 0.46, 1.05], [0.1, 0.46, 1.05]]) {
      const oc = new THREE.Mesh(new THREE.SphereGeometry(0.045 * bs, 6, 5), mat(accent, { emissive: accent, emissiveIntensity: 1.4 }));
      oc.position.set(ox * bs, oy * bs, oz * bs);
      tilt.add(oc);
    }
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.17 * bs, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.2 }));
      eye.scale.set(0.7, 1, 0.8);
      eye.position.set(sx * 0.24 * bs, 0.2 * bs, 1.06 * bs);
      tilt.add(eye);
      // 中繼鞭天線(觸角加粗成通訊桅)+ 末端資料燈(貼旋轉後的天線實際末端)
      const ant = cyl(tilt, 0.025, 0.032, 0.5, 5, sx * 0.12 * bs, 0.42 * bs, 1.15 * bs, 0x14171a);
      ant.rotation.x = -0.8;
      ant.rotation.z = sx * 0.3;
      const dl = new THREE.Mesh(new THREE.SphereGeometry(0.04 * bs, 6, 5), mat(accent, { emissive: accent, emissiveIntensity: 1.2 }));
      dl.position.set(0, 0.27, 0);   // 掛天線子節點吃旋轉:燈球恆貼細端(cyl 置中、半長 0.25)
      ant.add(dl);
    }
    // 背脊後掠相控陣板 + 縱列資料鏈燈:載重全換成中繼天線與算力的通訊載荷
    const arr = bx(tilt, 0.3 * bs, 0.05, 0.5 * bs, 0, 0.42 * bs, -0.35 * bs, PAL.dark, { metalness: 0.6 });
    arr.rotation.x = 0.35;
    for (let i = 0; i < 4; i++) bx(arr, 0.06 * bs, 0.02, 0.07 * bs, 0, 0.035, (i - 1.5) * 0.11 * bs, accent, { emissive: accent, emissiveIntensity: 1.0 });
    const abd = new THREE.Mesh(new THREE.SphereGeometry(0.52 * bs, 12, 9), mat(dark, { metalness: 0.5 }));
    abd.scale.set(0.95, 0.8, 1.9);   // 蜂后修長錐腹:腹長佔全身一半、尾端收錐(queen 與 worker 一眼之別)
    abd.position.set(0, -0.06, -1.12 * bs);
    tilt.add(abd);
    // 蜂腰(petiole):胸腹兩個圓量體之間的平端關節環,上下露出法蘭 = 可見的縊縮
    const waist = cyl(tilt, 0.42 * bs, 0.42 * bs, 0.14, 12, 0, -0.03, -0.68 * bs, 0x23262a, { metalness: 0.7 });
    waist.rotation.x = Math.PI / 2;
    for (let i = 0; i < 4; i++) {   // 節腹環帶:四節琥珀警戒紋逐節收分,貼錐腹剖面一路排到尾尖
      const rr = [0.45, 0.43, 0.36, 0.17][i] * bs;
      const ring = cyl(tilt, rr, rr, 0.1, 12, 0, -0.05, -(1.1 + i * 0.32) * bs, accent, { emissive: accent, emissiveIntensity: 0.7 });
      ring.rotation.x = Math.PI / 2;
    }
    // 螫針(純解剖剪影,非武器):錐尖朝後收在尾端 —— 火箭巢 2026-07-22 依「槍口朝攻擊方向」
    // 規則移駐腹下前向莢,螫針只留蜂后的尾部識別
    const sting = new THREE.Mesh(new THREE.ConeGeometry(0.16 * bs, 0.6 * bs, 8), mat(0x1c1f23, { metalness: 0.8 }));
    sting.rotation.x = -Math.PI / 2;   // 錐尖朝後
    sting.position.set(0, -0.08, -2.1 * bs);
    tilt.add(sting);
    // 重武器(70mm 導引火箭巢,launcher):整巢吊掛蜂腰下方、管口朝前(+z)——
    // 位置 MUST 低於錐腹/蜂腰曲面之外(y −0.62bs;−0.46 會半埋進腹面,管口貼弧面看起來歪),
    // 掛架短柱生根蜂腰(生根規則);管口火箭彈尖可見(彈藥與發射管同軸),擊發齊閃;
    // 蓄力 = 整巢上仰展開、擊發反向
    const nest = new THREE.Group();
    nest.position.set(0, -0.62 * bs, -0.5 * bs);
    tilt.add(nest);
    bx(tilt, 0.1 * bs, 0.22, 0.26, 0, -0.42 * bs, -0.5 * bs, 0x23262a, { metalness: 0.75 });  // 吊掛短柱(生根蜂腰腹面)
    const barrel = cyl(nest, 0.05, 0.05, 0.5, 6, 0, 0, 0, 0x111418, { metalness: 0.85 });
    barrel.rotation.x = Math.PI / 2;   // 螫針中管(沿 +z 朝前)
    cyl(nest, 0.1, 0.1, 0.14, 8, 0, 0, -0.24, 0x23262a, { metalness: 0.75 })
      .rotation.x = Math.PI / 2;       // 巢尾供彈環匣(與管同軸)
    const muz = cyl(nest, 0.07, 0.07, 0.06, 6, 0, 0, 0.27, accent, { emissive: accent, emissiveIntensity: 1.3 });
    muz.rotation.x = Math.PI / 2;
    const nestTips = [{ mesh: muz, base: 1.3 }];
    for (let i = 0; i < 6; i++) {
      const th = i / 6 * Math.PI * 2, nx = Math.cos(th) * 0.12, ny = Math.sin(th) * 0.12;
      const t = cyl(nest, 0.03, 0.03, 0.42, 6, nx, ny, 0, 0x111418, { metalness: 0.8 });
      t.rotation.x = Math.PI / 2;      // 環列六管(沿 +z)
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.09, 6),
        mat(accent, { emissive: accent, emissiveIntensity: 0.8 }));
      tip.rotation.x = Math.PI / 2;    // 彈尖朝前(發射方向)
      tip.position.set(nx, ny, 0.24);
      nest.add(tip);
      nestTips.push({ mesh: tip, base: 0.8 });
    }
    heavyRig = {
      glow: nestTips,
      pivot: [{ obj: nest, rest: { x: 0, y: 0, z: 0 }, deploy: { x: -0.12, y: 0, z: 0 } }],
    };
    hMuz = { n: muz, r: 0.09 };   // 前向巢口:曳光起點 = 槍口(fxOnly 已除役)
    // rig.wpn heavy:整巢單根 nest → ref=nest;巢口 muz 在 nest 局部 z=+0.27、環匣 −0.24 ⇒ fwd 'z'
    wpnH = { nodes: [nest], ref: nest, muz, fwd: 'z' };
    // 三對摺收蟲足(飛行收姿):基節近水平向外、脛節近水平後摺貼腹 —— 蜂不是無足飛彈
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
      const cx = cyl(tilt, 0.026, 0.032, 0.24, 5, sx * 0.26 * bs, -0.16 * bs, (0.5 - 0.35 * i) * bs, 0x14171a);
      cx.rotation.z = sx * 1.15;
      const tb = cyl(tilt, 0.02, 0.024, 0.3, 5, sx * 0.4 * bs, -0.24 * bs, (0.44 - 0.35 * i) * bs, 0x14171a);
      tb.rotation.z = sx * 0.25;
      tb.rotation.x = 1.15;
    }
    // 輕武器(雙聯 5.56 機槍艙):頦下前向雙管莢 + 彈鏈箱 —— 與後向火箭巢分開(異型雙武裝)
    const beeLN = [];   // rig.wpn 節點集:頦下雙聯機槍莢散件(掛 tilt)
    beeLN.push(bx(tilt, 0.26 * bs, 0.15 * bs, 0.42, 0, -0.24 * bs, 0.72 * bs, 0x23262a, { metalness: 0.7 }));      // 機匣
    beeLN.push(bx(tilt, 0.14 * bs, 0.12 * bs, 0.3, 0.2 * bs, -0.2 * bs, 0.6 * bs, PAL.dark, { metalness: 0.6 }));  // 彈鏈箱(側掛)
    beeLN.push(bx(tilt, 0.15 * bs, 0.03 * bs, 0.31, 0.2 * bs, -0.13 * bs, 0.6 * bs, dim(accent, 0.8)));            // 彈箱蓋識別
    lightGlow = [];
    for (const sx of [-1, 1]) {
      const b = cyl(tilt, 0.028, 0.032, 0.52, 6, sx * 0.07 * bs, -0.24 * bs, 1.05 * bs, 0x111418, { metalness: 0.85 });
      b.rotation.x = Math.PI / 2;
      const m2 = cyl(tilt, 0.042, 0.042, 0.05, 6, sx * 0.07 * bs, -0.24 * bs, 1.33 * bs, accent,
        { emissive: accent, emissiveIntensity: 0.8 });
      m2.rotation.x = Math.PI / 2;
      lightGlow.push({ mesh: m2, base: 0.8 });
      if (sx > 0) lMuz = { n: m2, r: 0.06 };
      beeLN.push(b, m2);
    }
    // rig.wpn light:散件掛 tilt → ref=tilt;槍口環 m2 在 tilt z=+1.33bs、機匣 +0.72bs ⇒ 槍口在 +z 端
    wpnL = { nodes: beeLN, ref: tilt, muz: lMuz.n, fwd: 'z' };
    // ---- 蜂后指揮節點載荷(2026-07-22):位階與中繼硬體 —— 冠環/SATCOM/算力/供能管線可讀化 ----
    // 冠環:斜戴半沒入頭球、穿過三單眼構成冠冕 = 皇冠級位階識別(純識別燈,不進 glows)
    const crown = cyl(tilt, 0.115 * bs, 0.115 * bs, 0.025, 12, 0, 0.475 * bs, 1.02 * bs, accent,
      { emissive: accent, emissiveIntensity: 0.35, metalness: 0.6 });
    crown.rotation.x = -0.55;
    // 翅基動力鉸座 ×4:外推至胸球表面,透明翅膜根部沒入鉸座 = 蜻蜓式翅根致動器
    // (翅本體 w 三軸每幀被 stepAerial 全覆寫,鉸座 MUST 建在 tilt 上,不掛 w)
    for (const sgn of [-1, 1]) {
      cyl(tilt, 0.078 * bs, 0.078 * bs, 0.1, 8, sgn * 0.52 * bs, 0.22 * bs, 0.2 * bs, PAL.deep, { metalness: 0.8 })
        .rotation.z = Math.PI / 2;
      cyl(tilt, 0.078 * bs, 0.078 * bs, 0.1, 8, sgn * 0.495 * bs, 0.22 * bs, -0.35 * bs, PAL.deep, { metalness: 0.8 })
        .rotation.z = Math.PI / 2;
    }
    // 胸背刀型天線 ×2(MANET 中繼):後掠,座落背脊裝甲頂面
    for (const sx of [-1, 1]) {
      const blade = bx(tilt, 0.02, 0.1, 0.14, sx * 0.14 * bs, 0.5 * bs, 0.2 * bs, PAL.dark, { metalness: 0.5 });
      blade.rotation.x = -0.15;
    }
    // 算力莢(載重 = 算力):半埋錐腹頂面前段,散熱鰭 ×3 + 狀態燈(識別燈,不進 glows)
    bx(tilt, 0.24 * bs, 0.09 * bs, 0.3 * bs, 0, 0.35 * bs, -0.78 * bs, PAL.dark, { metalness: 0.6 });
    for (const fx of [-0.07, 0, 0.07])
      bx(tilt, 0.018, 0.05, 0.26 * bs, fx * bs, 0.42 * bs, -0.78 * bs, PAL.deep, { metalness: 0.7 });
    bx(tilt, 0.03, 0.02, 0.02, 0.08 * bs, 0.36 * bs, -0.64 * bs, accent, { emissive: accent, emissiveIntensity: 0.9 });
    // SATCOM 半球罩:下半埋入第一、二節腹環之間的腹背面
    const sat = new THREE.Mesh(new THREE.SphereGeometry(0.08 * bs, 10, 8), mat(PAL.lite, { metalness: 0.3 }));
    sat.position.set(0, 0.35 * bs, -1.26 * bs);
    tilt.add(sat);
    // 蜂腰供能管 ×2 + 接線盒 ×2:前端埋背脊裝甲下、後端下傾收進腹面
    // (胸腹雙球皆 tilt 靜態子節點,剛性跨接安全 —— 蜂腰不是活動關節)
    for (const sx of [-1, 1]) {
      const duct = cyl(tilt, 0.02, 0.02, 0.62, 6, sx * 0.12 * bs, 0.40 * bs, -0.60 * bs, PAL.deep, { metalness: 0.8 });
      duct.rotation.x = Math.PI / 2 - 0.08;
      bx(tilt, 0.06, 0.06, 0.06, sx * 0.12 * bs, 0.37 * bs, -0.88 * bs, PAL.deep, { metalness: 0.7 });
    }
    // 螫針節環 ×2:環徑略大於該剖面錐徑 = 伸縮節套視覺,不增針長
    for (const [rr, rz] of [[0.07, -2.17], [0.048, -2.26]])
      cyl(tilt, rr * bs, rr * bs, 0.04, 8, 0, -0.07 * bs, rz * bs, PAL.deep, { metalness: 0.85 })
        .rotation.x = Math.PI / 2;
    // 腹面設備托盤(Matrice 腹艙):上緣沒入胸球底,避開頦下機槍與火箭巢吊掛短柱
    bx(tilt, 0.3 * bs, 0.05, 0.5 * bs, 0, -0.49 * bs, 0.05 * bs, PAL.dark, { metalness: 0.6 });
    // 右舷編號徽板:比照 ptero 空白布章(塗裝管線跳過 = 留白徽記位)
    const beeBadge = bx(tilt, 0.02, 0.09 * bs, 0.14 * bs, 0.57 * bs, 0.04 * bs, 0.3 * bs, dim(accent, 0.55));
    beeBadge.userData.noPaint = true;
  } else if (C === 'eagle') {
    // 鉤喙猛禽頭 + 頦下雙管 + 折收雙爪 + 扇尾
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3 * bs, 10, 8), mat(plate, { metalness: 0.5 }));
    head.position.set(0, 0.3 * bs, 1.0 * bs);
    tilt.add(head);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.13 * bs, 0.45 * bs, 6), mat(0xd8b23c, { metalness: 0.6 }));
    beak.rotation.x = Math.PI / 2 + 0.25;   // 鉤喙微下勾
    beak.position.set(0, 0.24 * bs, 1.3 * bs);
    tilt.add(beak);
    // 頸羽領巾(mantle):自頸背後掠覆肩、羽尖輕貼背面 —— 銜接頭與軀幹的紳士圍巾
    for (const sgn of [-1, 1]) for (let i = 0; i < 2; i++)
      feather(tilt, 0.42 * bs, 0.15 * bs, sgn * 0.12 * bs, (0.42 - i * 0.05) * bs, 0.78 * bs,
        1.15 + i * 0.25, sgn, i ? dim(plate, 0.9) : dim(accent, 0.8), { metalness: 0.35 });
    const eagleLN = [];   // rig.wpn 節點集:頦下雙管霰彈散件(雙膛 + 機匣/鉸鏈,掛 tilt)
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08 * bs, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.5 }));
      eye.position.set(sx * 0.17 * bs, 0.38 * bs, 1.12 * bs);
      tilt.add(eye);
      // 猛禽眉脊(supraorbital ridge):貼頭球面、外緣前傾壓住眼 = 鷹的怒視
      const brow = bx(tilt, 0.17 * bs, 0.045 * bs, 0.2 * bs, sx * 0.17 * bs, 0.52 * bs, 1.12 * bs, plate, { metalness: 0.5 });
      brow.rotation.z = sx * -0.22;
      brow.rotation.x = -0.2;
      const b = cyl(tilt, 0.045, 0.055, 0.7, 6, sx * 0.09 * bs, -0.3 * bs, 0.85 * bs, 0x111418, { metalness: 0.85 });
      b.rotation.x = Math.PI / 2;
      // 頦下雙管防空霰彈(輕武器):槍口燈 + 並列雙膛(Purdey 雙管獵槍的機械化)
      const bm = cyl(tilt, 0.06, 0.06, 0.05, 6, sx * 0.09 * bs, -0.3 * bs, 1.22 * bs, accent,
        { emissive: accent, emissiveIntensity: 0.8 });
      bm.rotation.x = Math.PI / 2;
      (lightGlow || (lightGlow = [])).push({ mesh: bm, base: 0.8 });
      if (sx > 0) lMuz = { n: bm, r: 0.07 };
      eagleLN.push(b, bm);
      // 強力雙爪:羽腿(粗大腿)+ 鱗甲蹠骨 + 三趾前爪 + 後趾(hallux),爪尖內勾成鉗
      const thigh = cyl(tilt, 0.13 * bs, 0.16 * bs, 0.4, 8, sx * 0.24 * bs, -0.34 * bs, 0.28, plate, { metalness: 0.4 });
      thigh.rotation.x = 0.45;
      const foot = new THREE.Group();
      foot.position.set(sx * 0.26 * bs, -0.6 * bs, 0.4);
      tilt.add(foot);
      cyl(foot, 0.07 * bs, 0.1 * bs, 0.34, 6, 0, 0.12, -0.04, 0x30373f, { metalness: 0.7 });   // 蹠骨(鱗甲)
      cyl(foot, 0.10, 0.11, 0.09, 8, 0, 0.22, -0.04, dim(plate, 0.9), { metalness: 0.3 });     // 腿羽環(羽褲收口:羽腿與金屬蹠骨的獸/機質感過渡)
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
      // 跗蹠液壓缸:上端埋大腿外下緣、下端埋蹠骨頂(thigh/foot 皆 tilt 靜態子節點,可實跨)
      const tarsusRam = cyl(tilt, 0.018, 0.018, 0.24, 6, sx * 0.31, -0.46, 0.33, PAL.deep, { metalness: 0.85 });
      tarsusRam.rotation.x = -0.5;
      tarsusRam.rotation.z = sx * -0.12;
      // 獵鷹頰紋板(malar stripe):貼頭球面斜置 = 隼科面部識別,補頭部裸球的分版
      const malar = bx(tilt, 0.025, 0.12, 0.05, sx * 0.22, 0.21, 1.19, PAL.deep, { metalness: 0.4 });
      malar.rotation.y = sx * -0.6;
      malar.rotation.z = sx * 0.2;
      // 胸前彈帶(紳士備彈):半埋胸球前表面的外掛霰彈 —— 彈藥可見比照 podWeapon missile 範式,非假槍管;
      // 深一階色 + 多露 0.03 才不會糊進同色胸甲
      for (const [ex, ez] of [[0.10, 0.94], [0.22, 0.89]])
        cyl(tilt, 0.028, 0.028, 0.1, 6, sx * ex, -0.06, ez, dim(accent, 0.62), { metalness: 0.7 })
          .rotation.x = Math.PI / 2;
    }
    for (let i = -2; i <= 2; i++)   // 扇尾:羽片放射扇(羽根聚尾根、中央尾羽主色;尾不撲動,直掛 tilt 不進 wings)
      feather(tilt, (0.95 - Math.abs(i) * 0.07) * bs, 0.2 * bs, 0, 0.012 * Math.abs(i), -0.72 * bs,
        Math.PI / 2 + i * 0.16, 1, i === 0 ? accent : mid, { metalness: 0.3 });
    // 雙管霰彈的機匣/彈藥箱(胸腹下,供彈與雙膛同線)
    eagleLN.push(bx(tilt, 0.3 * bs, 0.16 * bs, 0.4, 0, -0.34 * bs, 0.5 * bs, 0x23262a, { metalness: 0.7 }));
    // Purdey 並列雙管工藝:槍管間肋條 + 折開式鉸鏈(橫軸 = 中折點,橫跨雙膛)+ 機匣雕花識別帶
    eagleLN.push(bx(tilt, 0.03, 0.04, 0.5, 0, -0.27 * bs, 0.9 * bs, 0x111418, { metalness: 0.8 }));
    const hinge = cyl(tilt, 0.045 * bs, 0.045 * bs, 0.3 * bs, 8, 0, -0.31 * bs, 0.62 * bs, 0x30373f, { metalness: 0.85 });
    hinge.rotation.z = Math.PI / 2;
    eagleLN.push(hinge);
    eagleLN.push(bx(tilt, 0.31 * bs, 0.04 * bs, 0.08, 0, -0.3 * bs, 0.68 * bs, dim(accent, 0.75)));
    eagleLN.push(bx(tilt, 0.22 * bs, 0.05 * bs, 0.3, 0, -0.25 * bs, 0.42 * bs, dim(accent, 0.8)));   // 彈艙蓋識別
    // Purdey 紳士獵槍補件(2026-07-22):護木/頂桿/準星珠 —— 木件與瞄具,非槍管,不涉 muzzles
    bx(tilt, 0.16, 0.05, 0.42, 0, -0.375, 0.95, dim(accent, 0.45), { metalness: 0.1 });   // 胡桃木前護木(低金屬度深色 = 木件,accent 衍生不硬編木色)
    bx(tilt, 0.026, 0.018, 0.11, 0, -0.248, 0.44, PAL.deep, { metalness: 0.8 });          // 開閂頂桿(中折槍的簽名操作件)
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5), mat(dim(accent, 0.95), { metalness: 0.8 }));
    bead.position.set(0, -0.262, 1.13);   // 槍管間肋條前端準星珠
    tilt.add(bead);
    // 背部摺收共軸槳轂(coax 血統):滑翔獵手 = 槳收起,四葉全指後貼脊
    cyl(tilt, 0.065, 0.065, 0.06, 8, 0, 0.49, -0.08, PAL.deep, { metalness: 0.8 });
    for (const [by, ry] of [[0.535, 0.08], [0.558, 0.2]]) for (const sx of [-1, 1]) {
      const bl = bx(tilt, 0.05, 0.013, 0.5, sx * -0.022, by, -0.32, PAL.deep, { metalness: 0.7 });
      bl.rotation.y = sx * ry;
    }
    // 盾形家徽板:flag 花紋之上保留純色徽記(比照 ptero 布章 noPaint 範式)
    const armorial = bx(tilt, 0.12, 0.012, 0.16, 0.14, 0.465, -0.45, dim(accent, 0.7));
    armorial.userData.noPaint = true;
    // rig.wpn light:散件掛 tilt → ref=tilt;槍口環 bm 在 tilt z=+1.22bs、機匣 +0.5bs ⇒ 槍口在 +z 端
    wpnL = { nodes: eagleLN, ref: tilt, muz: lMuz.n, fwd: 'z' };
    // 重武器(獵狐飛彈,launcher):翼下羽毛飛彈掛架(6 枚)擊發齊閃
    heavyRig = { glow: eagleTips.map((mesh) => ({ mesh, base: 1.2 })), pivot: [] };
    hMuz = eagleTips.length ? { n: eagleTips[0], r: 0.08 } : null;
    // rig.wpn heavy:fm ×6 掛在拍翼群組 w 內 → ref=tilt(消費端經 matrixWorld 烘回 tilt 框);
    // 彈尖 tip 在 fm 局部 z=+0.4(fm/w 無靜態旋轉)⇒ 槍口在 +z 端
    wpnH = eagleFms.length ? { nodes: eagleFms, ref: tilt, muz: eagleTips[0], fwd: 'z' } : null;
  } else if (C === 'ptero') {
    // 後掠頭冠 + 長喙;吊掛雙爪各抓一具槍莢(爪握槍砲)
    // 胸骨撞擊龍骨:腹面縱貫刃脊 —— 全機唯一的武裝是它自己(撞擊攔截的結構補強)
    const keel = bx(tilt, 0.05 * bs, 0.14 * bs, 0.85 * bs, 0, -0.45 * bs, 0.3 * bs, PAL.lite, { metalness: 0.75 });
    keel.rotation.x = 0.08;
    // 左體側空白小布章(塗裝管線永遠跳過 = 那塊留白的布)
    const patch = bx(tilt, 0.02, 0.1 * bs, 0.14 * bs, -0.57 * bs, 0.05 * bs, 0.3 * bs, PAL.lite);
    patch.userData.noPaint = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34 * bs, 0.3 * bs, 0.6 * bs), mat(plate, { metalness: 0.5 }));
    head.position.set(0, 0.34 * bs, 1.05 * bs);
    tilt.add(head);
    const crest = new THREE.Mesh(new THREE.ConeGeometry(0.13 * bs, 1.05 * bs, 5), mat(accent, { emissive: accent, emissiveIntensity: 0.5 }));
    crest.scale.set(0.3, 1, 1);               // 橫向壓扁成刀 —— Pteranodon 的冠是扁刀,不是圓錐
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
    // 頜下萬向感測轉塔(MTS-B):吊軛 + 轉塔球 + 前下視鏡頭 —— 這具機體是眼睛,不是槍
    bx(tilt, 0.07 * bs, 0.16 * bs, 0.07 * bs, 0, -0.26 * bs, 0.8 * bs, 0x2a2e33, { metalness: 0.7 });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.16 * bs, 10, 8), mat(PAL.dark, { metalness: 0.6 }));
    orb.position.set(0, -0.4 * bs, 0.8 * bs);
    tilt.add(orb);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.06 * bs, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.5 }));
    lens.position.set(0, -0.43 * bs, 0.94 * bs);
    tilt.add(lens);
    // 吊掛雙爪各抓一具莢 —— 輕/重異型分工(2026-07-16):右爪 = 精準軌道步槍莢(rail,
    // 線圈環發光)、左爪 = 微型攔截彈莢(missile,雙彈外掛 + 導引頭發光)
    const pteroHvyGlow = [], pteroHvyPivot = [];
    for (const sx of [-1, 1]) {
      const leg = cyl(tilt, 0.06, 0.07, 0.55, 6, sx * 0.28 * bs, -0.42 * bs, -0.15, 0x2a2e33, { metalness: 0.6 });
      leg.rotation.x = 0.25;
      const pod = new THREE.Group();
      pod.position.set(sx * 0.28 * bs, -0.72 * bs, 0.1);
      tilt.add(pod);
      if (sx > 0) {
        // 右爪軌道步槍:電容機匣 + 細長加速管 + 線圈環 ×3 + 槍口環
        bx(pod, 0.2, 0.2, 0.5, 0, 0, -0.3, PAL.mid, { metalness: 0.7 });
        const b = cyl(pod, 0.05, 0.055, 1.15, 8, 0, 0, 0.15, 0x111418, { metalness: 0.85 });
        b.rotation.x = Math.PI / 2;
        for (const zz of [-0.05, 0.2, 0.45]) {
          const c = cyl(pod, 0.1, 0.1, 0.06, 8, 0, 0, zz, accent, { emissive: accent, emissiveIntensity: 0.7 });
          c.rotation.x = Math.PI / 2;
        }
        const m2 = cyl(pod, 0.07, 0.07, 0.06, 8, 0, 0, 0.75, accent, { emissive: accent, emissiveIntensity: 0.9 });
        m2.rotation.x = Math.PI / 2;
        lightGlow = [{ mesh: m2, base: 0.9 }];
        lMuz = { n: m2, r: 0.08 };
        // rig.wpn light:右爪軌道步槍莢單根 → ref=pod 自身;槍口環 m2 在 pod 局部 z=+0.75 ⇒ fwd +z
        wpnL = { nodes: [pod], ref: pod, muz: m2, fwd: 'z' };
      } else {
        // 左爪攔截彈莢:導軌 + 雙彈(彈體/十字尾翼/導引頭)—— 彈藥外掛可見
        bx(pod, 0.1, 0.12, 1.0, 0, 0.1, 0, PAL.mid, { metalness: 0.6 });
        for (const mx of [-0.09, 0.09]) {
          const m3 = cyl(pod, 0.055, 0.055, 0.85, 8, mx, -0.04, 0, PAL.lite, { metalness: 0.5 });
          m3.rotation.x = Math.PI / 2;
          for (let i = 0; i < 2; i++) {
            const fin = bx(pod, 0.015, 0.16, 0.16, mx, -0.04, -0.38, PAL.dark);
            fin.rotation.z = Math.PI / 4 + i * Math.PI / 2;
          }
          const nose = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.14, 8),
            mat(dim(accent, 0.9), { emissive: accent, emissiveIntensity: 0.8 }));
          nose.rotation.x = Math.PI / 2;
          nose.position.set(mx, -0.04, 0.49);
          pod.add(nose);
          pteroHvyGlow.push({ mesh: nose, base: 0.8 });
          hMuz = { n: nose, r: 0.08 };
        }
        pteroHvyPivot.push({ obj: pod, rest: { x: 0, y: 0, z: 0 }, deploy: { x: -0.15, y: 0, z: 0 } });
        // rig.wpn heavy:左爪攔截彈莢單根 → ref=pod 自身;導引頭 nose 在 pod 局部 z=+0.49 ⇒ fwd +z
        wpnH = { nodes: [pod], ref: pod, muz: hMuz.n, fwd: 'z' };
      }
      for (const a of [-1, 0, 1]) {   // 三指握爪扣住莢體
        const claw = bx(tilt, 0.05, 0.3, 0.07, sx * 0.28 * bs + a * 0.11, -0.58 * bs, 0.1, 0x30373f);
        claw.rotation.z = a * 0.55;
      }
    }
    // 重武器(微型攔截彈,missile):左爪莢 —— 蓄力莢體上仰展開、擊發反向,導引頭增亮
    heavyRig = { glow: pteroHvyGlow, pivot: pteroHvyPivot };
    bx(tilt, 0.12 * bs, 0.08, 0.9 * bs, 0, 0.02, -1.15 * bs, mid);   // 短尾桁
    // 尾股膜(uropatagium):橫跨雙腿根與尾桁之間的半透膜 —— 下半身不再是兩根裸柱
    bx(tilt, 0.52 * bs, 0.025, 0.6 * bs, 0, -0.08, -0.75 * bs, accent, membrane);
    const dart = new THREE.Mesh(new THREE.ConeGeometry(0.1 * bs, 0.3 * bs, 4), mat(accent));
    dart.rotation.x = -Math.PI / 2;
    dart.position.set(0, 0.02, -1.68 * bs);
    tilt.add(dart);
    // ---- MQ-9 / coax 雙血統補件(2026-07-22):攔截機的旋翼痕跡與長航感測語彙 ----
    // 喙背撞擊補強脊:『唯一武裝是它自己』的結構語彙(硬化脊非槍管,不涉 muzzles)
    const anvil = bx(tilt, 0.045, 0.06, 1.1, 0, 0.385 * bs, 2.0 * bs, PAL.deep, { metalness: 0.85 });
    anvil.rotation.x = 0.03;   // 隨錐面收分微下傾
    // 顱側頰板 ×2 + 冠頂板:裸方盒 → 內構 + 外裝甲板的雙層感
    for (const sx of [-1, 1])
      bx(tilt, 0.02, 0.2 * bs, 0.4 * bs, sx * 0.18 * bs, 0.34 * bs, 1.0 * bs, dim(plate, 0.85), { metalness: 0.5 });
    bx(tilt, 0.3 * bs, 0.02, 0.44 * bs, 0, 0.5 * bs, 1.03 * bs, dim(plate, 0.9), { metalness: 0.5 });
    // 側視 SAR 天線板 ×2(MQ-9 感測線):微凸出機身球側面,位於左舷布章下方
    for (const sx of [-1, 1])
      bx(tilt, 0.02, 0.15 * bs, 0.55 * bs, sx * 0.58 * bs, -0.155 * bs, 0.055 * bs, PAL.dark, { metalness: 0.6 });
    // 背部摺收共軸旋翼組(coax 血統):滑翔省電 = 槳收起,四葉全指後貼脊
    cyl(tilt, 0.075, 0.075, 0.05, 8, 0, 0.49 * bs, -0.13 * bs, PAL.deep, { metalness: 0.8 });
    for (const [by, ry] of [[0.52, 0.08], [0.545, 0.2]]) for (const sx of [-1, 1]) {
      const bl = bx(tilt, 0.05, 0.014, 0.55, sx * -0.022, by * bs, -0.44 * bs, PAL.deep, { metalness: 0.7 });
      bl.rotation.y = sx * ry;
    }
    // MQ-9 式 V 尾 + 腹鰭:根部沒入尾桁,已驗清開尾股膜與尾鏢
    for (const sx of [-1, 1]) {
      const vt = bx(tilt, 0.02, 0.26, 0.34, sx * 0.06, 0.10, -1.28 * bs, plate, { metalness: 0.5 });
      vt.rotation.z = sx * -0.5;   // 根部沒入桁頂角、尖端上外張
    }
    bx(tilt, 0.02, 0.12, 0.26, 0, -0.06, -1.36 * bs, plate, { metalness: 0.5 });
    // 感測轉塔方位環(MTS-B 迴旋機構):套在轉塔球上極
    cyl(tilt, 0.155, 0.155, 0.035, 12, 0, -0.30 * bs, 0.8 * bs, PAL.deep, { metalness: 0.8 });
    // 爪莢抓握液壓缸 ×2:單端錨貼腿中段 + 斜置(左莢是 heavy pivot,MUST NOT 觸莢體)
    for (const sx of [-1, 1]) {
      const ram = cyl(tilt, 0.018, 0.018, 0.3, 6, sx * 0.28 * bs, -0.51 * bs, -0.08, PAL.deep, { metalness: 0.85 });
      ram.rotation.x = -0.62;
    }
    // GPS 圓餅天線(背脊裝甲板前段)
    cyl(tilt, 0.055, 0.055, 0.03, 10, 0, 0.487 * bs, 0.28 * bs, PAL.lite, { metalness: 0.3 });
  } else {
    // 機械龍:長頸雙角;張口 = 上顎/下顎間露出口腔飛彈巢(口射飛彈)
    // 機械龍蛇頸:三節收分圓柱串接 + 節間平端關節環(軸向沿軀體→頭連線,末節正好接上頭群組)
    for (let i = 0; i < 3; i++) {
      const seg = cyl(tilt, (0.17 - i * 0.02) * bs, (0.19 - i * 0.02) * bs, 0.3 * bs, 8,
        0, (0.4 + 0.13 * i) * bs, (0.7 + 0.18 * i) * bs, i % 2 ? 0x23262a : dark, { metalness: 0.6 });
      seg.rotation.x = 0.95;
      if (i) {
        const jr = cyl(tilt, (0.2 - i * 0.02) * bs, (0.2 - i * 0.02) * bs, 0.05, 8,
          0, (0.335 + 0.13 * i) * bs, (0.61 + 0.18 * i) * bs, PAL.dark, { metalness: 0.75 });
        jr.rotation.x = 0.95;
      }
    }
    const head = new THREE.Group();
    head.position.set(0, 0.72 * bs, 1.15 * bs);
    tilt.add(head);
    bx(head, 0.42 * bs, 0.3 * bs, 0.5 * bs, 0, 0.1 * bs, 0.1, plate, { metalness: 0.6 });   // 顱殼
    bx(head, 0.3 * bs, 0.16 * bs, 0.55 * bs, 0, 0.06 * bs, 0.55 * bs, mid);                 // 上顎
    const jaw = bx(head, 0.26 * bs, 0.09 * bs, 0.5 * bs, 0, -0.2 * bs, 0.42 * bs, dark);
    jaw.rotation.x = 0.5;                                                                    // 下顎張開
    for (const sx of [-1, 1]) {   // 頰側 VLS 開閂艙門:張口齊射時蓋板外翻,內側艙燈條(鐵穹發射箱的簽名)
      const door = bx(head, 0.025 * bs, 0.15 * bs, 0.4 * bs, sx * 0.18 * bs, 0, 0.52 * bs, plate, { metalness: 0.6 });
      door.rotation.y = sx * 0.6;
      bx(door, 0.01, 0.1 * bs, 0.3 * bs, sx * -0.02 * bs, 0, 0, accent, { emissive: accent, emissiveIntensity: 0.6 });
    }
    bx(head, 0.32 * bs, 0.08, 0.06, 0, 0.22 * bs, 0.34 * bs, accent, { emissive: accent, emissiveIntensity: 1.6 });  // 眼列
    for (const sx of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06 * bs, 0.5 * bs, 5), mat(0xd8dde2, { metalness: 0.7 }));
      horn.position.set(sx * 0.15 * bs, 0.28 * bs, -0.1);
      horn.rotation.x = -2.3;
      head.add(horn);
    }
    // 供彈鏈可讀化(2026-07-22):彈艙在胸、經喉上膛 —— 環艙 → 喉管 → 口腔巢連成一條線
    const feedRing = cyl(tilt, 0.24 * bs, 0.24 * bs, 0.15, 10, 0, 0.345 * bs, 0.59 * bs, PAL.dark, { metalness: 0.7 });
    feedRing.rotation.x = 0.95;   // 與蛇頸同軸的頸基環座(攔截彈出胸處)
    const feedDuct = cyl(tilt, 0.055, 0.055, 0.7, 8, 0, 0.42 * bs, 0.975 * bs, PAL.deep, { metalness: 0.8 });
    feedDuct.rotation.x = 0.95;   // 沿頸腹面半埋入頸節,兩端分別沒入胸球前上面與顱底
    for (const sx of [-1, 1]) {   // 顎鉸鏈盤:與頰側 VLS 開閂艙門同一套「開閂機械」語彙
      const hj = cyl(head, 0.05 * bs, 0.05 * bs, 0.035, 8, sx * 0.14 * bs, -0.15 * bs, 0.18 * bs, PAL.deep, { metalness: 0.85 });
      hj.rotation.z = Math.PI / 2;
    }
    bx(head, 0.34 * bs, 0.05 * bs, 0.09 * bs, 0, 0.26 * bs, 0.36 * bs, PAL.dark, { metalness: 0.6 });   // 眉甲板(半埋顱殼頂,壓出怒視陰影)
    // 胸前相控陣雷達板(鐵穹之眼):板面朝前上 = 對空搜索角,嵌進胸球前緣生根;2×2 偶數陣元
    const radar = bx(tilt, 0.55 * bs, 0.42 * bs, 0.07, 0, 0.05 * bs, 0.86 * bs, PAL.dark, { metalness: 0.7 });
    radar.rotation.x = -0.4;
    for (const [ax, ay] of [[-0.12, 0.1], [0.12, 0.1], [-0.12, -0.08], [0.12, -0.08]])
      bx(radar, 0.09 * bs, 0.09 * bs, 0.02, ax * bs, ay * bs, 0.045, accent, { emissive: accent, emissiveIntensity: 0.8 });
    // 口腔飛彈巢:2×2 管口(彈尖主色發光)+ 喉部充能光
    const dragonTips = [];
    const dragonHN = [];   // rig.wpn 節點集:口腔飛彈巢散件(管身 + 彈尖 + 喉部充能,掛 head)
    for (const [ox, oy] of [[-0.07, 0.02], [0.07, 0.02], [-0.07, -0.08], [0.07, -0.08]]) {
      const cell = cyl(head, 0.045 * bs, 0.045 * bs, 0.3, 6, ox * bs, oy * bs, 0.5 * bs, 0x111418, { metalness: 0.8 });
      cell.rotation.x = Math.PI / 2;
      const tip = cyl(head, 0.03 * bs, 0.03 * bs, 0.05, 6, ox * bs, oy * bs, 0.66 * bs, accent, { emissive: accent, emissiveIntensity: 1.6 });
      tip.rotation.x = Math.PI / 2;
      dragonTips.push(tip);
      dragonHN.push(cell, tip);
    }
    const throatGlow = bx(head, 0.18 * bs, 0.1 * bs, 0.12, 0, -0.08 * bs, 0.18 * bs, accent, { emissive: accent, emissiveIntensity: 1.0 });
    dragonHN.push(throatGlow);
    // 口腔巢十字分隔肋(鐵穹發射箱矩陣格框):貼四管壁;彈數仍 2×2 偶數,雙發齊射節奏不動
    bx(head, 0.018, 0.21 * bs, 0.25 * bs, 0, -0.03 * bs, 0.48 * bs, 0x111418, { metalness: 0.8 });
    bx(head, 0.19 * bs, 0.018, 0.25 * bs, 0, -0.03 * bs, 0.48 * bs, 0x111418, { metalness: 0.8 });
    // 背脊散熱格柵 ×2 + 熱燒燈條 ×2(plasma 示能):燈條進 heavyRig.glow ——
    // 蓄力時背脊隨喉部一起燒紅、擊發強閃(吃現成 stepCombatFx 驅動);
    // 後段格柵貼合向尾收低的球面 → y 取低一階,不照抄前段高度
    const dorsalStrips = [];
    for (const [gz, gy, sy] of [[-0.08, 0.48, 0.50], [-0.55, 0.42, 0.44]]) {
      bx(tilt, 0.15 * bs, 0.025, 0.26 * bs, 0, gy * bs, gz * bs, PAL.deep, { metalness: 0.7 });
      dorsalStrips.push(bx(tilt, 0.11 * bs, 0.012, 0.2 * bs, 0, sy * bs, gz * bs, accent, { emissive: accent, emissiveIntensity: 0.5 }));
    }
    // 重武器(防空散射矩陣,plasma):口腔飛彈巢 + 喉部充能光共同構成噴發前兆
    heavyRig = { glow: [...dragonTips.map((mesh) => ({ mesh, base: 1.6 })), { mesh: throatGlow, base: 1.0 },
      ...dorsalStrips.map((mesh) => ({ mesh, base: 0.5 }))], pivot: [] };
    hMuz = { n: throatGlow, r: 0.12 };
    // rig.wpn heavy:散件掛 head → ref=head;彈尖 tip 在 head z=+0.66bs、管身 +0.5bs ⇒ 槍口在 +z 端
    wpnH = { nodes: dragonHN, ref: head, muz: throatGlow, fwd: 'z' };
    // 輕武器(25mm 空爆機砲):頦下單管 + 同軸彈鼓(掛在頭群組下,隨頭轉向)—— 與口腔電漿巢分開
    const dChin = cyl(head, 0.05 * bs, 0.058 * bs, 0.75 * bs, 6, 0, -0.34 * bs, 0.3 * bs, 0x111418, { metalness: 0.85 });
    dChin.rotation.x = Math.PI / 2;
    const dDrum = cyl(head, 0.1 * bs, 0.1 * bs, 0.16 * bs, 8, 0, -0.34 * bs, -0.02 * bs, PAL.dark, { metalness: 0.65 });
    dDrum.rotation.x = Math.PI / 2;   // 彈鼓與砲管同軸(供彈直上膛)
    const dFeed = bx(head, 0.06 * bs, 0.06 * bs, 0.1 * bs, 0.08 * bs, -0.28 * bs, 0.08 * bs, 0x23262a, { metalness: 0.7 });   // 供彈橋
    const dMuz = cyl(head, 0.065 * bs, 0.065 * bs, 0.05, 6, 0, -0.34 * bs, 0.7 * bs, accent,
      { emissive: accent, emissiveIntensity: 0.8 });
    dMuz.rotation.x = Math.PI / 2;
    lightGlow = [{ mesh: dMuz, base: 0.8 }];
    lMuz = { n: dMuz, r: 0.07 };
    // rig.wpn light:散件掛 head → ref=head;槍口環 dMuz 在 head z=+0.7bs、彈鼓 −0.02bs ⇒ 槍口在 +z 端
    wpnL = { nodes: [dChin, dDrum, dFeed, dMuz], ref: head, muz: dMuz, fwd: 'z' };
    // 摺收後肢(wyvern 飛航收姿):大腿前傾、脛骨後摺貼腹、三趾爪朝前 —— 飛龍不是無腿的飛彈卡車
    for (const sx of [-1, 1]) {
      const th = cyl(tilt, 0.08 * bs, 0.1 * bs, 0.42 * bs, 7, sx * 0.34 * bs, -0.26 * bs, -0.2 * bs, mid, { metalness: 0.6 });
      th.rotation.x = 1.15;
      const sh = cyl(tilt, 0.055 * bs, 0.07 * bs, 0.4 * bs, 6, sx * 0.36 * bs, -0.42 * bs, 0, 0x23262a, { metalness: 0.7 });
      sh.rotation.x = -1.25;
      for (const a of [-1, 0, 1]) {
        const cl = new THREE.Mesh(new THREE.ConeGeometry(0.03 * bs, 0.18 * bs, 5), mat(0xd8dde2, { metalness: 0.75 }));
        cl.position.set(sx * 0.36 * bs + a * 0.06 * bs, -0.46 * bs, 0.22 * bs);
        cl.rotation.x = Math.PI / 2;
        tilt.add(cl);
      }
    }
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
      // 尾棘(掛節內 = 隨 whipTail 甩動):逐節收小,與軀幹背棘連成一列直到尾梢
      const ts = new THREE.Mesh(new THREE.ConeGeometry(0.06 * bs * (1 - i * 0.15), 0.24 * bs, 4), mat(0xd8dde2, { metalness: 0.6 }));
      ts.position.set(0, h * bs * 0.5, -len * 0.5);
      seg.add(ts);
      tNode = seg;
    }
    for (let i = 1; i < 4; i++) {   // 尾節關節環:掛進各節根部重疊帶 —— whipTail 甩尾時遮住節間裸縫(機械龍的脊椎軸承)
      const tr = [0.30, 0.22, 0.155][i - 1];
      const jring = cyl(tailSegs[i], tr, tr, 0.06, 10, 0, 0, 0.03, PAL.deep, { metalness: 0.75 });
      jring.rotation.x = Math.PI / 2;
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
  g.userData.rig = { kind: 'aerial', tilt, tiltY0: 1.3, bob: 0.1, top: 30, wings, insect: C === 'bee', tailSegs, heavy: heavyRig,
    // 機載武器:後座走 _kickB(stepAerial 機身反應);槍口燈/錨依生物分支登記
    weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.05 },
    lightGlow, muzzles: { light: lMuz, heavy: hMuz },
    wpn: { light: wpnL, heavy: wpnH } };   // rig.wpn:FPV 武裝同源(契約見 podWeapon 上方)
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
             gait: 'trot', gallopType: 'rotary', bob: 0.1, pitchAmp: 0.1, top: 7 },
  centaur: { bulk: 1.0,  hipY: 2.2, tailLen: 1.5, stride: 2.8, legX: 0.6,  fz: 1.0,  hz: -1.2,
             gait: 'trot', gallopType: 'transverse', bob: 0.09, pitchAmp: 0.08, top: 7 },
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
  let heavyRig = { glow: [], pivot: [] };   // 重武器掛點(依生物分支填入,見各 branch 尾端)
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
          // 膝關節防塵環:套在樞軸原點、隨屈曲同轉,蓋住第一/二節接縫(象柱腿的裸接補件)
          cyl(l, 0.22 * B, 0.24 * B, 0.12, 8, 0, 0, 0, PAL.deep, { metalness: 0.7 });
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
          // 管骨液壓阻尼(「扣扳機那一刻絕對靜止」的機構本體):單端錨+斜置近似,MUST NOT 動 stepper
          const dpr = cyl(l, 0.022 * B, 0.022 * B, hipY * 0.26, 6, 0, -hipY * 0.10, front ? -0.10 : 0.12, PAL.deep, { metalness: 0.9 });
          dpr.rotation.x = front ? 0.32 : -0.32;
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
          // 髖部致動器轂:四足機器狗的招牌外露圓盤馬達(側向軸)+ 中心蓋燈貼齊轂外面
          const hub = cyl(l, 0.2 * B, 0.2 * B, 0.14, 12, sx * 0.18 * B, 0, 0, PAL.deep, { metalness: 0.85 });
          hub.rotation.z = Math.PI / 2;
          const cap = cyl(l, 0.08 * B, 0.08 * B, 0.03, 10, sx * 0.26 * B, 0, 0, accent, { emissive: accent, emissiveIntensity: 0.8 });
          cap.rotation.z = Math.PI / 2;
          cyl(l, 0.15 * B, 0.19 * B, hipY * 0.52, 8, 0, -hipY * 0.28, front ? 0.06 : -0.08, hull);
        } },
        { len: hipY * 0.3, base: S * 0.45, k: S * 0.55, d: 0.15, draw: (l) => {
          cyl(l, 0.1 * B, 0.13 * B, hipY * 0.36, 8, 0, -hipY * 0.18, front ? -0.08 : 0.1, hullDk);
          // 膝部致動器轂:掛在第二節樞軸原點,隨屈曲一起轉、盤面外露不脫節
          const kn = cyl(l, 0.13 * B, 0.13 * B, 0.11, 12, sx * 0.12 * B, 0, 0, 0x23262a, { metalness: 0.85 });
          kn.rotation.z = Math.PI / 2;
          // 膝液壓缸:單端錨在小腿節 + 斜置近似指向大腿(雙端錨會被 flexChain 拉伸 —— MUST NOT 為它動 stepper)
          const hyd = cyl(l, 0.028, 0.028, hipY * 0.30, 6, sx * 0.04, -hipY * 0.10, front ? -0.13 : 0.15, PAL.deep, { metalness: 0.9 });
          hyd.rotation.x = front ? 0.42 : -0.42;
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
  let humChest = null, humNeck = null;              // 人馬上身分節(腰 neck → 胸 humChest → 頸 humNeck → 頭)
  let quadWeap = null, quadHvy = null, quadLGlow = null;   // 戰鬥動畫欄位(centaur 手持;其餘機載 'N')
  let quadGunR = null;                              // 騎槍俯仰(僅 centaur:行軍微揚 ↔ 據槍水平)
  let quadMuzL = null, quadMuzH = null;             // 槍口錨(rig.muzzles:曳光起點/槍口焰)
  let quadWpnL = null, quadWpnH = null;             // rig.wpn(FPV 武裝同源;契約見 podWeapon 上方)
  if (C === 'hound') {
    // ---- 機械獵犬:修長犬軀(圓角矩形量體 —— 真獸沒有直角)+ 立耳吻部;背揹反器材長砲 ----
    rbz(spine, 1.4 * B, 1.1 * B, 2.3, 0, 0.05, -0.9, hullDk, { metalness: 0.6 });
    bx(spine, 1.2 * B, 0.2, 1.9, 0, 0.62 * B, -0.9, dim(plate, 0.9));
    rbz(chest, 1.6 * B, 1.35 * B, 2.1, 0, 0.1, 0.5, hull, { metalness: 0.6 });
    // 側面平板掛載軌 + 等距凸耳(模組化軍用平台語彙;收在前腿髖甲擺程之外)
    for (const sx of [-1, 1]) {
      bx(chest, 0.07, 0.34 * B, 0.62, sx * 0.8 * B, 0.12, -0.36, PAL.deep, { metalness: 0.7 });
      for (const zz of [-0.58, -0.36, -0.14]) bx(chest, 0.1, 0.1 * B, 0.12, sx * 0.83 * B, 0.12, zz, 0x23262a, { metalness: 0.8 });
    }
    // 前防撞感測保險桿(Vision 60 前莢語彙):胸廓是膠囊、前端收圓,桿位沿曲面內縮到 z=1.30
    // 才咬得住殼(規格 z=1.52 在膠囊上是懸空);兩枚避障感測燈疊在桿上緣 = 獵殺機的「看路」硬體
    bx(chest, 1.05 * B, 0.14, 0.10, 0, -0.40 * B, 1.30, PAL.deep, { metalness: 0.7 });
    for (const sx of [-1, 1]) {
      const sl = cyl(chest, 0.045 * B, 0.045 * B, 0.03, 8, sx * 0.35 * B, -0.30 * B, 1.36, accent, { emissive: accent, emissiveIntensity: 0.9 });
      sl.rotation.x = Math.PI / 2;   // 純識別燈(不掛 glows)
    }
    // 肩甲斜板(Zoids 肩罩):底緣埋進胸殼、頂緣外傾成擋泥板 —— 前腿髖甲(x0.55~0.93)內側,不進擺程
    for (const sx of [-1, 1]) {
      const sp = bx(chest, 0.07, 0.45, 0.8, sx * 0.62 * B, 0.55 * B, 0.30, dim(plate, 0.92), { metalness: 0.6 });
      sp.rotation.z = sx * -0.45;
    }
    // 腹掛電池/酬載模組:吊在胸腹曲面正下方(z 前移到 0.35 讓後端貼殼不懸空)+ 前緣狀態燈
    bx(chest, 0.85 * B, 0.24 * B, 1.0, 0, -0.66 * B, 0.35, PAL.dark, { metalness: 0.55 });
    bx(chest, 0.08, 0.05, 0.05, 0.28 * B, -0.66 * B, 0.72, accent, { emissive: accent, emissiveIntensity: 0.7 });
    // 胸腹平面接合:脊椎波讓前後兩段相對俯仰,圓角端對圓角端會張口 ——
    // 接縫以「平端」關節環覆蓋(跟著胸段動,蓋住縫;接合處不圓角)
    const hcol = cyl(chest, 0.56 * B, 0.56 * B, 0.62, 14, 0, 0.02, -0.5, dim(hull, 0.82), { metalness: 0.6 });
    hcol.rotation.x = Math.PI / 2;
    hcol.scale.x = 1.25;
    bx(chest, 1.62 * B, 0.16, 0.5, 0, 0.32 * B, 1.4, accent, { emissive: accent, emissiveIntensity: 0.9 });
    neck.position.set(0, 0.55 * B, 1.45);
    chest.add(neck);
    // 頸關節防塵環:掛頸樞軸 → stepQuad 反屈頸 ±0.28 rad 時隨頸同動,恆蓋住胸頸縫
    const nring = cyl(neck, 0.30 * B, 0.33 * B, 0.22, 10, 0, 0.12, -0.18, dim(hull, 0.75), { metalness: 0.5 });
    nring.rotation.x = Math.PI / 2;
    bx(neck, 0.65 * B, 0.55 * B, 0.8, 0, 0.15, 0.25, hullDk);
    head.position.set(0, 0.42 * B, 0.7);
    neck.add(head);
    bx(head, 0.8 * B, 0.6 * B, 0.85, 0, 0, 0.2, plate, { metalness: 0.6 });
    bx(head, 0.46 * B, 0.36 * B, 0.9, 0, -0.12 * B, 0.9, hullDk);                  // 吻部
    bx(head, 0.48 * B, 0.13, 0.28, 0, -0.32 * B, 0.85, 0x23262a);                  // 下顎
    bx(head, 0.52 * B, 0.1, 0.06, 0, 0.12 * B, 0.64, accent, { emissive: accent, emissiveIntensity: 1.6 });
    // 立體雙目相機:鏡體半埋顱殼、物鏡凸出面部前緣(狩獵機的注視感)
    for (const sx of [-1, 1]) {
      const cam = cyl(head, 0.055 * B, 0.055 * B, 0.12, 8, sx * 0.16 * B, 0.24 * B, 0.6, 0x111418, { metalness: 0.8 });
      cam.rotation.x = Math.PI / 2;
      const lens = cyl(head, 0.035 * B, 0.035 * B, 0.02, 8, sx * 0.16 * B, 0.24 * B, 0.68, accent, { emissive: accent, emissiveIntensity: 1.2 });
      lens.rotation.x = Math.PI / 2;
    }
    for (const sx of [-1, 1]) {
      const ear = bx(head, 0.14, 0.5, 0.1, sx * 0.28 * B, 0.42 * B, 0.05, hullDk);
      ear.rotation.z = sx * -0.2;
    }
    // 背架 + 長砲管(朝 +z)+ 觀瞄鏡 + 彈藥箱。輕/重同型(gun×gun)= 一管雙模(2026-07-16):
    // 輕 = 消音 DMR 段(整體式消音套筒,VSS 語彙)、重 = 14.5 反器材長管段(制退器);
    // 對照 centaur 騎槍的消音段/長管段 —— 同一具發射器切換兩種模式
    bx(spine, 0.5 * B, 0.4, 1.2, 0.25 * B, 0.95 * B, -0.5, 0x2b3138, { metalness: 0.6 });
    const barrel = cyl(spine, 0.09, 0.12, 3.6, 8, 0.25 * B, 1.15 * B, 0.9, 0x14171a, { metalness: 0.85 });
    barrel.rotation.x = Math.PI / 2;
    // 砲管熱護套 + 瓦斯塊:掛 barrel 子件(隨 heavyRig.pivot 後座同動)—— 補掉裸管段的空窗;
    // barrel 局部 −z = 世界上方(rotation.x=π/2 之後),瓦斯塊故意放 −z 讓它立在管背
    cyl(barrel, 0.135, 0.135, 0.7, 8, 0, -0.35, 0, PAL.deep, { metalness: 0.7 });
    bx(barrel, 0.07, 0.12, 0.07, 0, 0.02, -0.10, PAL.deep, { metalness: 0.8 });
    cyl(barrel, 0.16, 0.16, 0.85, 10, 0, 0.55, 0, 0x23262a, { metalness: 0.75 });   // 消音套筒(輕模式)
    const houndLMuz = cyl(barrel, 0.17, 0.17, 0.06, 10, 0, 1.0, 0, accent,
      { emissive: accent, emissiveIntensity: 0.6 });                               // 消音段口識別環(輕武器擊發閃光)
    cyl(barrel, 0.14, 0.14, 0.3, 8, 0, 1.7, 0, 0x0d0f11);                          // 砲口制退器(重模式)
    const houndMuz = cyl(barrel, 0.15, 0.15, 0.05, 8, 0, 1.87, 0, accent, { emissive: accent, emissiveIntensity: 0.3 });  // 重武器膛口(擊發發光)
    // 重武器(14.5 反器材砲,gun):既有背載長砲本體,擊發時整管後座
    heavyRig = {
      glow: [{ mesh: houndMuz, base: 0.3 }],
      pivot: [{ obj: barrel, rest: { x: Math.PI / 2, y: 0, z: 0 }, deploy: { x: Math.PI / 2 - 0.12, y: 0, z: 0 } }],
    };
    quadWeap = { light: 'N', heavy: 'N' };   // 背載機載:後座走 _kickB(stepQuad 胸腔反應)
    quadHvy = { chest: 0.05 };
    quadLGlow = [{ mesh: houndLMuz, base: 0.6 }];
    quadMuzL = { n: houndLMuz, r: 0.15 };
    quadMuzH = { n: houndMuz, r: 0.15 };
    // rig.wpn:同型一管雙模 → 同一組 nodes/ref,只有 muz 不同。消音套筒/制退器/兩模膛口皆
    // barrel 子節點自然涵蓋;膛口在 barrel 局部 +y 端(houndLMuz y=1.0、houndMuz y=1.87)⇒ fwd 'y'
    const houndNodes = [barrel];
    quadWpnL = { nodes: houndNodes, ref: barrel, muz: houndLMuz, fwd: 'y' };
    quadWpnH = { nodes: houndNodes, ref: barrel, muz: houndMuz, fwd: 'y' };
    bx(spine, 0.2, 0.16, 0.5, 0.25 * B, 1.42 * B, -0.3, 0x1c2126);                 // 觀瞄鏡體
    bx(spine, 0.12, 0.08, 0.14, 0.25 * B, 1.42 * B, 0.0, accent, { emissive: accent, emissiveIntensity: 1.2 });
    bx(spine, 0.5 * B, 0.35, 0.7, -0.35 * B, 0.85 * B, -1.1, hullDk);              // 彈藥箱
    bx(spine, 0.52 * B, 0.1, 0.72, -0.35 * B, 1.06 * B, -1.1, dim(accent, 0.8));
    // 肩掛雙管飛彈莢已拆除(2026-07-22 規則 5:無功能裝飾砲管不留 —— 功能武裝 = 背載長砲雙模)
    bx(spine, 0.45 * B, 0.14, 0.4, -0.05 * B, 1.0 * B, -0.85, 0x23262a, { metalness: 0.7 });   // 供彈橋(彈箱 → 砲膛)
    // 後臀散熱百葉:斜臥在背板後緣的排氣片列(y 貼板頂 —— 規格 y0.74B 在此高度懸空,壓回板面)
    for (const sx of [-1, 1]) for (const xx of [0.30, 0.48]) {
      const lv = bx(spine, 0.05, 0.06, 0.45, sx * xx * B, 0.70 * B, -1.62, PAL.deep, { metalness: 0.7 });
      lv.rotation.x = -0.25;
    }
    // 尾部航行燈:半埋臀部膠囊曲面(規格 z−2.0 已在殼外,內縮到 −1.75 曲面上);純識別燈
    for (const sx of [-1, 1])
      bx(spine, 0.06, 0.06, 0.04, sx * 0.55 * B, 0.28 * B, -1.75, accent, { emissive: accent, emissiveIntensity: 0.8 });
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
    // 鞍掛備彈箱(pannier 外掛):箱體懸在後腿髖甲外側,以頂帶跨回背脊生根(四足馱運語彙)
    for (const sx of [-1, 1]) {
      bx(spine, 0.2 * B, 0.42 * B, 0.9, sx * 0.9 * B, 0.16 * B, -0.6, PAL.dark, { metalness: 0.6 });
      bx(spine, 0.21 * B, 0.08, 0.92, sx * 0.9 * B, 0.4 * B, -0.6, dim(accent, 0.8));
      bx(spine, 0.44 * B, 0.06, 0.4, sx * 0.62 * B, 0.38 * B, -0.6, 0x23262a, { metalness: 0.7 });
    }
    bx(spine, 1.15 * B, 0.18, 1.8, 0, 0.6 * B, -0.85, dim(plate, 0.9));
    // 馬臀航行燈:半埋臀部膠囊側面(規格 z−1.85 的截面已收窄到殼外,內縮到 −1.6 側腰);純識別燈
    for (const sx of [-1, 1])
      bx(spine, 0.05, 0.05, 0.04, sx * 0.57 * B, 0.28, -1.6, accent, { emissive: accent, emissiveIntensity: 0.6 });
    rbz(chest, 1.5 * B, 1.2 * B, 1.9, 0, 0.05, 0.35, hull, { metalness: 0.6 });
    // 胸腹平面接合環(見獵犬):蓋住脊椎波張開的圓角接縫 —— 馬軀移動不再前後分離
    const ccol = cyl(chest, 0.52 * B, 0.52 * B, 0.62, 14, 0, 0.0, -0.45, dim(hull, 0.82), { metalness: 0.6 });
    ccol.rotation.x = Math.PI / 2;
    ccol.scale.x = 1.28;
    // 人形上身分節鏈(騎士脊柱):腰 neck(樞軸=馬背骨盆)→ 胸 humChest → 頸 humNeck → 頭。
    // 每節在 locomotion rider 分支逐段反向吸收馬軀起伏(每節都給一點=靈活),累計鎖平槍口與頭。
    // 腰是根樞軸:只掛「腰塊」,胸/臂/槍/頭全部改掛下游節點,這樣腰一彎、上身整段跟著給。
    neck.position.set(0, 0.75 * B, 0.95);
    chest.add(neck);
    // 腰部迴轉環(浮動槍架的迴轉基座):環本體靜掛馬背蓋住腰樞軸縫,腰彎在環內轉動
    cyl(chest, 0.40, 0.40, 0.09, 14, 0, 0.66, 0.95, PAL.deep, { metalness: 0.8 });
    cyl(chest, 0.41, 0.41, 0.03, 14, 0, 0.71, 0.95, dim(accent, 0.7));             // 上緣識別環
    bx(neck, 0.85 * B, 0.5, 0.6, 0, 0.2, 0, hullDk);                               // 腰
    // 備用彈匣袋 ×2:腰塊前面兩側(陀螺艙 x±0.2 之外)—— 狙擊手的滿彈側掛
    for (const sx of [-1, 1]) bx(neck, 0.16, 0.24, 0.08, sx * 0.34, 0.22, 0.33, PAL.dark, { metalness: 0.5 });
    // 陀螺穩定艙:腰前橫置慣性基準單元(圓筒殼 + 主色狀態環)—— 上身鎖平的「基準」本體
    const gyro = cyl(neck, 0.2 * B, 0.2 * B, 0.34, 12, 0, 0.16, 0.36, 0x1c2126, { metalness: 0.85 });
    gyro.rotation.x = Math.PI / 2;
    const gring = cyl(neck, 0.21 * B, 0.21 * B, 0.05, 12, 0, 0.16, 0.36, accent, { emissive: accent, emissiveIntensity: 0.7 });
    gring.rotation.x = Math.PI / 2;
    // 胸腔樞軸(擱在腰上方 0.62):獨立分節,腰彎後胸再吸一段
    humChest = new THREE.Group();
    humChest.position.set(0, 0.62, 0);
    neck.add(humChest);
    bx(humChest, 1.05 * B, 0.9, 0.7, 0, 0.23, 0, hull, { metalness: 0.6 });        // 胸廓
    bx(humChest, 0.5 * B, 0.3, 0.14, 0, 0.33, 0.4, accent, { emissive: accent, emissiveIntensity: 0.9 });
    // 騎士胸甲前板(底緣 y0.10 高於槍身頂 0.05,不撞 rifle)+ 腹部折箱分節板:
    // 錨在 humChest 側、下端懸掛蓋過腰塊頂 —— humChest 反向吸收馬軀起伏時如伸縮腹甲
    bx(humChest, 0.70 * B, 0.50, 0.07, 0, 0.35, 0.38, dim(plate, 0.95), { metalness: 0.6 });
    bx(humChest, 0.80 * B, 0.14, 0.06, 0, -0.30, 0.32, PAL.mid);
    bx(humChest, 0.72 * B, 0.13, 0.06, 0, -0.44, 0.30, PAL.dark);
    // 測風桅+風向標(狙擊手的環境感測):左肩後細桅,頂 y≈0.89 低於頭頂 1.26 不推 bbox
    cyl(humChest, 0.015, 0.015, 0.50, 5, -0.52 * B, 0.62, -0.26, PAL.deep, { metalness: 0.8 });
    bx(humChest, 0.16, 0.02, 0.03, -0.52 * B, 0.88, -0.26, PAL.deep);
    // 長槍端在胸前(槍口朝 +z):據槍射姿 —— 上身跟著 rider 分節穩定,槍口恆指前方。
    // 輕/重同型(gun×gun)→ 雙手持同一把,切換兩種模式:輕 = 消音卡賓段(整體式消音管),
    // 重 = 反器材長管段(制退器 + 栓動大威力)。瞄準鏡/彈匣/前握把/摺疊腳架強化辨識。
    const rifle = bx(humChest, 0.14, 0.24, 3.2, 0.15 * B, -0.07, 0.75, 0x14171a, { metalness: 0.85 });
    // 浮動槍架:環抱式陀螺穩定環(rifle 子節點,隨槍身俯仰一起走)+ 胸前球窩座對位
    const yoke = cyl(rifle, 0.26, 0.26, 0.1, 12, 0, 0, -0.2, 0x2b3138, { metalness: 0.8 });
    yoke.rotation.x = Math.PI / 2;
    bx(humChest, 0.3, 0.24, 0.3, 0.15 * B, -0.12, 0.55, 0x23262a, { metalness: 0.7 });
    const supp = cyl(rifle, 0.1, 0.1, 0.85, 10, 0, 0.05, 1.0, 0x23262a, { metalness: 0.75 });
    supp.rotation.x = Math.PI / 2;                                                 // 整體式消音管(VSS 語彙 = 輕模式)
    const centaurLGlow = cyl(rifle, 0.11, 0.11, 0.07, 10, 0, 0.05, 1.44, accent,
      { emissive: accent, emissiveIntensity: 0.6 });
    centaurLGlow.rotation.x = Math.PI / 2;                                         // 消音管口識別環(輕模式槍口 = 擊發閃光)
    bx(rifle, 0.07, 0.1, 1.0, 0, 0.04, 1.95, 0x30373f, { metalness: 0.85 });       // 反器材長管(重模式)
    bx(rifle, 0.12, 0.14, 0.3, 0, 0.04, 2.55, 0x0d0f11, { metalness: 0.85 });      // 箭形制退器
    const centaurHMuz = cyl(rifle, 0.075, 0.075, 0.05, 8, 0, 0.04, 2.74, accent,
      { emissive: accent, emissiveIntensity: 0.6 });
    centaurHMuz.rotation.x = Math.PI / 2;                                          // 重模式膛口(擊發強閃)
    bx(rifle, 0.09, 0.26, 0.3, 0, -0.2, -1.5, 0x23262a);                           // 槍托
    bx(rifle, 0.08, 0.1, 0.5, 0, 0.14, -1.2, 0x2b3138);                            // 貼腮墊
    bx(rifle, 0.08, 0.3, 0.14, 0, -0.26, 0.35, 0x23262a, { metalness: 0.7 });      // 彈匣(下插)
    bx(rifle, 0.07, 0.2, 0.1, 0, -0.22, 1.2, 0x2b3138);                            // 前握把(左手扶位)
    for (const ox of [-0.08, 0.08]) {                                              // 摺疊兩腳架(收攏貼管)
      const leg = bx(rifle, 0.03, 0.03, 0.55, ox, -0.14, 1.75, 0x30373f, { metalness: 0.8 });
      leg.rotation.x = -0.12;
    }
    // 瞄準鏡:鏡筒 + 物鏡發光(既有小識別塊升級)
    const scopeT = cyl(rifle, 0.06, 0.06, 0.55, 8, 0, 0.24, 0.15, 0x0e1114, { metalness: 0.8 });
    scopeT.rotation.x = Math.PI / 2;
    const centaurSight = cyl(rifle, 0.065, 0.065, 0.05, 8, 0, 0.24, 0.44, accent,
      { emissive: accent, emissiveIntensity: 0.8 });
    centaurSight.rotation.x = Math.PI / 2;                                         // 物鏡(重武器蓄力發光)
    // 雷射測距儀:rifle 子件(自動進 rig.wpn nodes → FPV 同源),緊貼瞄準鏡右側
    bx(rifle, 0.07, 0.07, 0.16, 0.10, 0.20, 0.05, PAL.deep, { metalness: 0.8 });
    const lrf = cyl(rifle, 0.03, 0.03, 0.02, 8, 0.10, 0.20, 0.14, accent, { emissive: accent, emissiveIntensity: 0.8 });
    lrf.rotation.x = Math.PI / 2;                                                  // 測距物鏡(純識別燈)
    // 重武器(白頭山反器材,gun):騎槍本體即重武器載體。槍身俯仰改由 gunR(gunPitch)
    // 每幀驅動 —— 行軍槍口微揚 ↔ 據槍水平、蓄力下壓抵肩(hv.gun)、擊發反向上跳;
    // pivot MUST 留空(gunPitch 是 rotation.x 的唯一寫入者,同 morph 手持規則)
    heavyRig = { glow: [{ mesh: centaurSight, base: 0.8 }, { mesh: centaurHMuz, base: 0.6 }], pivot: [] };
    quadGunR = { g: rifle, rest: -0.16, aim: 0 };   // +z 槍管:負 x = 槍口上揚(行軍),0 = 據槍水平
    quadWeap = { light: 'B', heavy: 'B' };
    quadHvy = { armR: 0.06, armL: 0.06, chest: 0.05, gun: 0.07 };   // brace:蓄力抵肩下壓、擊發後仰上跳
    quadLGlow = [{ mesh: centaurLGlow, base: 0.6 }];
    quadMuzL = { n: centaurLGlow, r: 0.11 };
    quadMuzH = { n: centaurHMuz, r: 0.09 };
    // rig.wpn:同型雙手長槍(一把雙模)→ 同一組 nodes/ref;消音管/長管/兩模膛口/瞄具皆
    // rifle 子節點;膛口在 rifle 局部 +z 端(centaurLGlow z=1.44、centaurHMuz z=2.74)⇒ fwd 'z'
    const centaurNodes = [rifle];
    quadWpnL = { nodes: centaurNodes, ref: rifle, muz: centaurLGlow, fwd: 'z' };
    quadWpnH = { nodes: centaurNodes, ref: rifle, muz: centaurHMuz, fwd: 'z' };
    // 持槍雙臂(不再是垂臂):肩樞軸 → 上臂前伸下壓 → 前臂折向槍身 ——
    // 右手扣握把(槍身後段)、左手前伸托護木;雙手把長槍鎖死在胸前的備射姿勢。
    // sh/el 存進 armSh/armEl + 記下建構時的基準角(armBase),讓 stepQuad 能疊加待機微顫
    // 而不打散「鎖死當穩定射擊台」的姿勢 —— MUST NOT 只是建好姿勢就丟著不再驅動
    armSh = []; armEl = []; armBase = [];
    for (const sx of [-1, 1]) {
      bx(humChest, 0.5, 0.35, 0.6, sx * 0.75 * B, 0.58, 0, plate);                 // 墊肩
      // 雙層墊肩頂板:外低內高的斜頂甲(y0.80 在臂擺程之上,肩樞軸 y0.43 不受影響)
      const pt = bx(humChest, 0.55, 0.07, 0.65, sx * 0.75 * B, 0.80, 0.02, dim(plate, 0.9), { metalness: 0.6 });
      pt.rotation.z = -sx * 0.15;
      const sh = new THREE.Group();
      sh.position.set(sx * 0.72 * B, 0.43, 0.12);
      humChest.add(sh);
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
    // 頸樞軸(短柱)+ 頭:頸再吸一小段,頭最後鎖平 = 視線絕對靜止
    humNeck = new THREE.Group();
    humNeck.position.set(0, 0.8, 0.0);
    humChest.add(humNeck);
    cyl(humNeck, 0.14 * B, 0.17 * B, 0.3, 8, 0, -0.02, 0, hullDk, { metalness: 0.6 });  // 頸柱
    head.position.set(0, 0.16, 0.05);
    humNeck.add(head);
    bx(head, 0.42 * B, 0.4, 0.46, 0, 0.1, 0, plate, { metalness: 0.6 });
    // 單筒觀測鏡(右眼):狙擊手的不對稱單眼,疊在面罩之上
    const ocu = cyl(head, 0.09 * B, 0.09 * B, 0.18, 10, 0.12 * B, 0.12, 0.26, 0x0e1114, { metalness: 0.8 });
    ocu.rotation.x = Math.PI / 2;
    const obj = cyl(head, 0.06 * B, 0.06 * B, 0.03, 10, 0.12 * B, 0.12, 0.36, accent, { emissive: accent, emissiveIntensity: 1.2 });
    obj.rotation.x = Math.PI / 2;
    bx(head, 0.32 * B, 0.1, 0.06, 0, 0.12, 0.25, accent, { emissive: accent, emissiveIntensity: 1.6 });
    // 馬尾散熱索:自臀部平順收分的流線長尾(粗根 → 細梢),柔和向後下方飄墜(不再是兩截突兀粗管)
    tail.position.set(0, 0.45 * B, -1.75);
    for (let i = 0; i < 3; i++) {   // 尾根三小節:連續收分的圓柱(流線)
      const r0 = (0.1 - 0.024 * i) * B, r1 = (0.1 - 0.024 * (i + 1)) * B;
      const seg = cyl(tail, r0, r1, P.tailLen / 3 + 0.03, 8, 0, -0.05 * i, -(i + 0.5) * P.tailLen / 3, i ? hullDk : hull, { metalness: 0.5 });
      seg.rotation.x = Math.PI / 2 + 0.2;
    }
    for (let i = 0; i < 2; i++) {   // 尾梢兩小節:續收到細尖(飄尾)
      const r0 = (0.028 - 0.01 * i) * B, r1 = (0.028 - 0.01 * (i + 1)) * B;
      const seg = cyl(tail2, r0, r1, P.tailLen * 0.3, 8, 0, -0.04 * i, -(i + 0.4) * P.tailLen * 0.3, i ? 0x23262a : 0x30373f);
      seg.rotation.x = Math.PI / 2 + 0.3;
    }
  } else if (C === 'stego') {
    // ---- 劍龍:拱背軀體(圓角矩形量體)+ 交錯背鰭列;四片大鰭 = 四聯裝飛彈鰭 ----
    rbz(spine, 1.9 * B, 1.3 * B, 2.6, 0, 0.1, -1.0, hullDk, { metalness: 0.6 });
    rbz(chest, 2.1 * B, 1.5 * B, 2.4, 0, 0.25, 0.5, hull, { metalness: 0.6 });
    // 側裙裝甲 + 主色緣條(發射箱車底盤語彙;收在前後腿間的淨空帶)
    for (const sx of [-1, 1]) {
      bx(chest, 0.08, 0.5 * B, 0.9, sx * 1.06 * B, -0.5 * B, -0.25, PAL.dark, { metalness: 0.55 });
      bx(chest, 0.1, 0.08, 0.9, sx * 1.08 * B, -0.26 * B, -0.25, dim(accent, 0.7));
    }
    // 前拖鉤 ×2(發射箱卡車底盤語彙):胸殼是膠囊、前端收圓 —— 規格 z1.62 已在殼外,
    // 內縮到 z1.3 讓鉤頂咬進殼底、鉤體垂出下緣;前腿在 x±0.95B(fz 1.2)不進擺程
    for (const sx of [-1, 1])
      bx(chest, 0.10 * B, 0.12 * B, 0.16, sx * 0.40 * B, -0.42 * B, 1.3, PAL.deep, { metalness: 0.8 });
    // 前緣航行燈 ×2:半埋前肩曲面(規格 x0.75B/z1.68 已在膠囊殼外,內縮到曲面上);純識別燈
    for (const sx of [-1, 1])
      bx(chest, 0.06, 0.06, 0.04, sx * 0.62 * B, -0.15 * B, 1.35, accent, { emissive: accent, emissiveIntensity: 0.8 });
    // 排氣煙囪(左肩,與右肩 MG3 塔對稱配重;是排氣管不是槍管 —— 不進 muzzles/wpn):
    // 基部沉進肩殼(y0.78B;規格 y1.05B 在曲面上懸空)、頂蓋壓簷
    cyl(chest, 0.055 * B, 0.06 * B, 0.55, 8, -0.60 * B, 0.78 * B, 1.15, PAL.dark, { metalness: 0.7 });
    bx(chest, 0.14, 0.05, 0.14, -0.60 * B, 0.78 * B + 0.30, 1.15, PAL.deep, { metalness: 0.7 });
    // (原背上水平背甲板已移除:純裝飾、非掛點,使用者指示 —— 背鰭本身即發射軌)
    // 胸腹平面接合環(見獵犬):側步搖擺 + 脊椎波下前後量體不張口
    const scol = cyl(chest, 0.7 * B, 0.7 * B, 0.72, 14, 0, 0.12, -0.62, dim(hull, 0.82), { metalness: 0.6 });
    scol.rotation.x = Math.PI / 2;
    scol.scale.x = 1.42;
    // 背鰭 = 正菱形板,靠「下沉鰭板本體到背脊裡」接合(不另接方塊):正方板(h×h)繞自身幾何中心
    // 旋 45° = 側視正菱形,板心抬到半對角 ⇒ 下尖端落在 f 原點;把 f 原點壓到背面「以下」,菱形下半
    // 就實實埋進圓角背裡 —— 露出的上半仍是完整菱形,底部與軀體連成一塊、不浮空。
    const finAt = (parent, y, z, h, big, sx) => {
      const f = new THREE.Group();
      f.position.set(sx * 0.2 * B, y, z);
      parent.add(f);
      const diag = 0.72 * h;   // 正方板旋 45° 後,中心 → 上/下尖端的距離
      const pl = bx(f, 0.13, h, h, 0, diag, 0, big ? plate : hullDk, { metalness: 0.5 });
      pl.rotation.x = Math.PI / 4;                                                 // 繞板中心 → 正菱形(尖端朝上下)
      if (big) {   // 洩焰導流板:發射鰭基部後方斜板(f 子節點,隨鰭展開一起走)
        const defl = bx(f, 0.45, 0.28, 0.05, 0, diag - h * 0.28, -0.14, PAL.deep, { metalness: 0.7 });
        defl.rotation.x = -0.5;
        // 發射軌背板(Shahed 發射箱的滑軌框):垂直軌條貼鰭 +z 面、四聯裝管口自軌條穿出 ——
        // 側視立刻讀出「骨板上鎖著發射軌」;掛 f 群組隨 heavyRig.pivot 展開同動(finAt 單一縫,四鰭自動一致)
        bx(f, 0.20, h * 1.05, 0.05, 0, diag, 0.085, PAL.deep, { metalness: 0.7 });
      }
      const tips = [];
      if (big) {
        for (let i = 0; i < 4; i++) {   // 前緣四聯裝管口(彈尖主色):沿鰭高由下往上,微凸於前面(+z)
          const cy = diag + (i - 1.5) * h * 0.32;
          const cell = cyl(f, 0.058, 0.058, 0.22, 6, 0, cy, 0.13, 0x111418, { metalness: 0.8 });
          cell.rotation.x = Math.PI / 2;
          const tip = cyl(f, 0.04, 0.04, 0.06, 6, 0, cy, 0.26, accent, { emissive: accent, emissiveIntensity: 1.5 });
          tip.rotation.x = Math.PI / 2;
          tips.push(tip);
          for (const sw of [-1, 1]) {   // 彈尖後掠小翼:管口露出的是三角翼巡飛彈鼻,不是火箭圓管
            const wl = bx(f, 0.2, 0.02, 0.09, sw * 0.12, cy, 0.18, dim(accent, 0.7));
            wl.rotation.y = sw * 0.6;
          }
        }
      } else {
        bx(f, 0.15, 0.2, 0.14, 0, diag + h * 0.55, 0, accent, { emissive: accent, emissiveIntensity: 0.7 });
      }
      return { f, tips };
    };
    // 原點壓到背面之下(胸背頂 ≈1.34、脊背頂 ≈1.04),菱形下半沉入軀體 ⇒ 露出上半 + 底部咬進背脊
    finAt(chest, 0.62 * B, 1.2, 0.85, false, -1);
    const finA = finAt(chest, 0.66 * B, 0.6, 1.2, true, 1);
    // 背脊輸彈軌:縱貫中線的裝填軌(半埋胸背裝甲,串起前段發射鰭基部)+ 兩座塊
    bx(chest, 0.16 * B, 0.12, 2.3, 0, 0.92 * B, 0.3, 0x23262a, { metalness: 0.75 });
    for (const zz of [-0.5, 1.0]) bx(chest, 0.22 * B, 0.16, 0.22, 0, 0.86 * B, zz, 0x2b3138, { metalness: 0.7 });
    const finB = finAt(chest, 0.68 * B, -0.05, 1.32, true, -1);
    const finC = finAt(spine, 0.4 * B, -0.6, 1.25, true, 1);
    const finD = finAt(spine, 0.36 * B, -1.2, 1.05, true, -1);
    finAt(spine, 0.3 * B, -1.8, 0.8, false, 1);
    // 重武器(見證者巡飛彈,missile):四聯裝背鰭本來就是為飛彈設計的,原地轉為功能性掛點
    const stegoTips = [...finA.tips, ...finB.tips, ...finC.tips, ...finD.tips];
    heavyRig = {
      glow: stegoTips.map((mesh) => ({ mesh, base: 1.5 })),
      pivot: [finA, finB, finC, finD].map(({ f }) => ({
        obj: f, rest: { x: f.rotation.x, y: f.rotation.y, z: f.rotation.z },
        deploy: { x: f.rotation.x, y: f.rotation.y, z: f.rotation.z - 0.35 },
      })),
    };
    // 輕武器(防衛機槍 MG3,gun):右前肩背載小塔 —— 機匣 + 槍管(散熱環)+ 彈鏈箱(2026-07-16 補齊);
    // 塔座直接生根在胸背裝甲上(背載武器 MUST 連回軀體,不浮空)
    const stegoLN = [];   // rig.wpn 節點集:MG3 小塔散件(掛 chest)
    stegoLN.push(bx(chest, 0.4 * B, 0.3, 0.55, 0.62 * B, 0.62 * B, 1.05, 0x2b3138, { metalness: 0.6 }));      // 塔座
    stegoLN.push(bx(chest, 0.3 * B, 0.24, 0.5, 0.62 * B, 0.85 * B, 1.05, 0x23262a, { metalness: 0.7 }));      // 機匣
    const sBarrel = cyl(chest, 0.05, 0.055, 1.1, 6, 0.62 * B, 0.85 * B, 1.85, 0x111418, { metalness: 0.85 });
    sBarrel.rotation.x = Math.PI / 2;
    stegoLN.push(sBarrel);
    for (const zz of [1.6, 1.9, 2.2]) {                                                          // 散熱套筒環
      const hr = cyl(chest, 0.07, 0.07, 0.06, 6, 0.62 * B, 0.85 * B, zz, 0x30373f, { metalness: 0.78 });
      hr.rotation.x = Math.PI / 2;
      stegoLN.push(hr);
    }
    const stegoLMuz = cyl(chest, 0.065, 0.065, 0.05, 6, 0.62 * B, 0.85 * B, 2.42, accent,
      { emissive: accent, emissiveIntensity: 0.7 });
    stegoLMuz.rotation.x = Math.PI / 2;                                                          // 槍口識別環(擊發閃光)
    stegoLN.push(stegoLMuz);
    stegoLN.push(bx(chest, 0.24 * B, 0.26, 0.4, 0.34 * B, 0.8 * B, 1.0, hullDk, { metalness: 0.6 }));          // 彈鏈箱(內側掛)
    stegoLN.push(bx(chest, 0.25 * B, 0.08, 0.42, 0.34 * B, 0.95 * B, 1.0, dim(accent, 0.8)));                  // 彈箱蓋識別
    // MG3 防盾半板 ×2:槍管兩側各一片、中央留槍管缺口;push 進 stegoLN(rig.wpn.light → FPV 同源)
    for (const sx of [-1, 1])
      stegoLN.push(bx(chest, 0.15 * B, 0.30, 0.05, 0.62 * B + sx * 0.13 * B, 0.85 * B, 1.36, PAL.mid, { metalness: 0.6 }));
    quadWeap = { light: 'N', heavy: 'N' };
    quadHvy = { chest: 0.04 };
    quadLGlow = [{ mesh: stegoLMuz, base: 0.7 }];
    quadMuzL = { n: stegoLMuz, r: 0.07 };
    quadMuzH = stegoTips.length ? { n: stegoTips[0], r: 0.06 } : null;
    // rig.wpn light:散件掛 chest → ref=chest;槍口環在 chest z=+2.42、機匣 +1.05 ⇒ 槍口在 +z 端
    quadWpnL = { nodes: stegoLN, ref: chest, muz: stegoLMuz, fwd: 'z' };
    // rig.wpn heavy:四片發射鰭 f 散件 —— finA/finB 掛 chest、finC/finD 掛 spine,
    // 實際共同父節點 = spine(chest 是 spine 子節點)→ ref=spine;彈尖 tip 在 f 局部
    // z=+0.26、管身 +0.13(f/chest 皆無靜態旋轉)⇒ 槍口在 +z 端
    quadWpnH = { nodes: [finA.f, finB.f, finC.f, finD.f], ref: spine, muz: stegoTips[0], fwd: 'z' };
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
    // 頭部光電感測眼 ×2:顱殼前緣 —— 巡飛彈平台的「看目標」硬體(現況只有眉光帶無眼);純識別燈
    for (const sx of [-1, 1]) {
      const se = cyl(head, 0.05 * B, 0.05 * B, 0.04, 8, sx * 0.20 * B, 0.06 * B, 0.58, accent, { emissive: accent, emissiveIntensity: 1.2 });
      se.rotation.x = Math.PI / 2;
    }
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
    // 尾錘質量塊:橫置粗短圓柱蓋住收尖 + 箍環(後排尖刺自錘體兩側伸出 = 錘,不只是刺)
    const club = cyl(tail2, 0.2 * B, 0.16 * B, 0.5, 10, 0, -0.02, -P.tailLen * 0.72, hullDk, { metalness: 0.7 });
    club.rotation.x = Math.PI / 2;
    const cring = cyl(tail2, 0.21 * B, 0.21 * B, 0.07, 10, 0, -0.02, -P.tailLen * 0.72, 0x23262a, { metalness: 0.85 });
    cring.rotation.x = Math.PI / 2;
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
    // 外套膜分節肋環(平端環):殼體節理,環面微凸出球殼剖面
    for (const zz of [-0.75, 0.15]) {
      const rib = cyl(spine, 1.04 * B, 1.04 * B, 0.09, 16, 0, 0.35, zz, dim(hull, 0.82), { metalness: 0.6 });
      rib.rotation.x = Math.PI / 2;
      rib.scale.z = 0.95;   // rotation.x 後局部 z 映到世界 y:對齊外套膜的 y 壓扁
    }
    bx(spine, 1.3 * B, 0.18, 1.6, 0, 1.25 * B, -0.3, dim(plate, 0.9));
    // 外套膜後坡刀形天線 ×4(Krasukha 桅杆的低剖面化 —— 高桅會被 fitToHeight 縮機體,MUST NOT 立高桅):
    // 底端埋進膜殼、頂端後掠出坡面;外側對比內側低一階、離背板遠一點(避免頂端縮進板影裡)
    for (const sx of [-1, 1]) {
      const k1 = bx(spine, 0.035, 0.42, 0.14, sx * 0.33 * B, 0.95 * B, -1.25, PAL.deep, { metalness: 0.7 });
      k1.rotation.x = -0.55;
      const k2 = bx(spine, 0.035, 0.36, 0.12, sx * 0.50 * B, 0.88 * B, -1.35, PAL.deep, { metalness: 0.7 });
      k2.rotation.x = -0.55;
    }
    // 饋線導管 ×2(碟天線 → 胸部的供能管語彙):沿膜殼後坡斜貼(水平管會懸空,傾角跟坡走),
    // 前端沒入背板下緣、後端指向 dishG 基座
    for (const sx of [-1, 1]) {
      const fd = cyl(spine, 0.035, 0.035, 0.9, 6, sx * 0.09, 1.24, -1.1, PAL.deep, { metalness: 0.6 });
      fd.rotation.x = Math.PI / 2 - 0.45;
    }
    // 碟形干擾天線:外套膜後坡基座(近平仰角)+ 三支撐桿 + 饋源燈,全件低於背板頂
    const dishG = new THREE.Group();
    dishG.position.set(0, 0.75 * B, -1.7);
    dishG.rotation.x = -0.35;
    spine.add(dishG);
    cyl(dishG, 0.5 * B, 0.12 * B, 0.12, 14, 0, 0.06, 0, PAL.deep, { metalness: 0.7 });
    for (let i = 0; i < 3; i++) {
      const st = cyl(dishG, 0.015, 0.015, 0.3, 5, Math.cos(i * 2.09) * 0.24 * B, 0.18, Math.sin(i * 2.09) * 0.24 * B, 0x30373f, { metalness: 0.8 });
      st.rotation.z = Math.cos(i * 2.09) * 0.5;
      st.rotation.x = -Math.sin(i * 2.09) * 0.5;
    }
    cyl(dishG, 0.05 * B, 0.05 * B, 0.06, 8, 0, 0.3, 0, accent, { emissive: accent, emissiveIntensity: 1.2 });
    bx(dishG, 0.30, 0.18, 0.24, 0, -0.10, 0.10, PAL.dark, { metalness: 0.7 });   // 碟背俯仰驅動座(隨碟同傾,碟不再懸浮)
    // 背板頂面內嵌 3×2 相控陣瓦片(貼平不增高,低剖面天線陣)
    for (let ix = -1; ix <= 1; ix++) for (const sz of [-0.55, 0.15])
      bx(spine, 0.32 * B, 0.05, 0.5, ix * 0.4 * B, 1.31 * B, sz - 0.3, dim(accent, 0.6), { emissive: accent, emissiveIntensity: 0.5 });
    bx(chest, 1.6 * B, 1.1 * B, 1.4, 0, 0.3, 0.3, hull, { metalness: 0.55 });
    bx(chest, 1.2 * B, 0.16, 0.4, 0, 0.05, 1.0, accent, { emissive: accent, emissiveIntensity: 0.9 });
    // 胸前聲波發射盤 ×2(「電波歌姬」的揚聲器識別):正面才讀得到的電戰語彙;振膜為純識別燈
    for (const sx of [-1, 1]) {
      const spk = cyl(chest, 0.15 * B, 0.15 * B, 0.05, 12, sx * 0.42 * B, 0.55, 1.02, PAL.deep, { metalness: 0.7 });
      spk.rotation.x = Math.PI / 2;
      const mem = cyl(chest, 0.055 * B, 0.055 * B, 0.02, 10, sx * 0.42 * B, 0.55, 1.06, accent, { emissive: accent, emissiveIntensity: 1.0 });
      mem.rotation.x = Math.PI / 2;
    }
    // 持武觸手根部球窩罩 ×4:靜掛胸箱、觸手在罩內轉動(章魚博士式肩球窩)——
    // MUST NOT 掛 j0(會跟著 tentGuard 擺);位置 = wArm 根群組 a 的四個生根點
    for (const [sx, sz] of [[-1, 0.55], [1, 0.55], [-1, -0.25], [1, -0.25]]) {
      const sock = new THREE.Mesh(new THREE.SphereGeometry(0.20 * B, 10, 8), mat(PAL.mid, { metalness: 0.6 }));
      sock.position.set(sx * 0.85 * B, 0.85 * B, sz);
      sock.scale.set(1, 0.8, 1);
      chest.add(sock);
    }
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
    for (let i = -3; i <= 3; i++) {   // 第二排七顆小眼:密集眼群的壓迫感(落在面鬚之上、首排之下)
      const e2 = new THREE.Mesh(new THREE.SphereGeometry(0.045 * B, 6, 5), mat(accent, { emissive: accent, emissiveIntensity: 1.2 }));
      e2.position.set(Math.sin(i * 0.42) * 0.59 * B, 0.02 * B, Math.cos(i * 0.42) * 0.61 * B);
      head.add(e2);
    }
    for (let i = -2; i <= 2; i++) {   // 面鬚觸手
      const b1 = cyl(head, 0.05 * B, 0.08 * B, 0.55, 6, i * 0.16 * B, -0.4 * B, 0.42 * B, hullDk);
      b1.rotation.x = 0.35 - Math.abs(i) * 0.08;
      const b2 = cyl(head, 0.03 * B, 0.05 * B, 0.4, 6, i * 0.18 * B, -0.72 * B, 0.55 * B, 0x23262a);
      b2.rotation.x = 0.6;
      if (Math.abs(i) <= 1) {   // 中央三根鬚尖生物光(克蘇魯面鬚末梢;純識別燈)——位置 = b2 傾角 0.6 的下端
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.028 * B, 6, 5), mat(accent, { emissive: accent, emissiveIntensity: 1.2 }));
        tip.position.set(i * 0.18 * B, -1.0, 0.52);
        head.add(tip);
      }
    }
    // 四持武觸手(四爪步行已由 mkLeg 提供;此為上部四爪持武)——
    // 與觸手腿同一套五節多關節結構。2026-07-22 使用者指示「觸手朝前、持武器向前射擊」:
    // 弓弧改走矢狀面 —— 根節上舉前傾(lift)、逐節前捲(curl)收斂到近水平前指,
    // 末節武器以「世界對齊」反解(見 tipP)保證槍口恆朝機體正前
    const wArm = (sx, sz, ry, tipKind, lift, curl) => {
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
        j.rotation.z = i === 0 ? sx * 0.35 : -sx * 0.1;   // 微幅外展 → 逐節收回(近矢狀面)
        j.rotation.x = i === 0 ? lift : curl;             // 根節上舉前傾 → 逐節前捲(章魚/八爪博士式曲線)
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
      node.add(tipP);
      // 武器世界對齊(單一保證縫):把末節的累積旋轉整段反解,tipP 局部軸 = 機體軸
      // (武器幾何沿 +z ⇒ 槍口恆朝機體正前、+y 恆朝上)—— 上游弓弧角再怎麼調都不會歪槍口;
      // 蠕動波(undulate)只在 base 附近 ±0.13 rad 擺動,槍口方向維持前向
      g.updateMatrixWorld(true);
      tipP.quaternion.copy(node.getWorldQuaternion(new THREE.Quaternion()).invert());
      let glowMesh = null;
      if (tipKind === 'gun') {
        // 共鳴脈衝發射器(beam):機匣電容 + 發射筒 + 聚焦環 ×2 + 透鏡光核(輕武器本體)
        bx(tipP, 0.24, 0.24, 0.36, 0, 0, -0.16, 0x1c2126, { metalness: 0.75 });
        const pod = cyl(tipP, 0.09, 0.11, 1.0, 8, 0, 0, 0.2, 0x111418, { metalness: 0.85 });
        pod.rotation.x = Math.PI / 2;
        for (const zz of [0.32, 0.54]) {
          const fr = cyl(tipP, 0.14, 0.14, 0.05, 8, 0, 0, zz, 0x30373f, { metalness: 0.8 });
          fr.rotation.x = Math.PI / 2;
        }
        glowMesh = cyl(tipP, 0.12, 0.12, 0.06, 8, 0, 0, 0.74, accent, { emissive: accent, emissiveIntensity: 1.2 });
        glowMesh.rotation.x = Math.PI / 2;
        // 透鏡側 V 形偶極天線鬚:每根持械觸手是獨立干擾波束的發射器讀感
        for (const sx2 of [-1, 1]) {
          const dp = bx(tipP, 0.02, 0.02, 0.3, sx2 * 0.16, 0, 0.5, 0x30373f, { metalness: 0.8 });
          dp.rotation.y = sx2 * 0.5;
        }
      } else if (tipKind === 'blade') {
        const bl = bx(tipP, 0.06, 0.6, 0.36, 0, 0.22, 0.05, 0xd8dde2, { metalness: 0.8 });
        bl.rotation.x = -0.3;
      } else {
        glowMesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.5 }));
        tipP.add(glowMesh);
      }
      return { tipP, glowMesh };
    };
    // 前排雙槍莢低弧前指、後排刃/orb 高弧越過前排 —— 四觸手全數前傾(曲率錯開不打架)
    const tGunL = wArm(-1, 0.55, 0, 'gun', -2.0, 0.11);
    const tGunR = wArm(1, 0.55, 0, 'gun', -2.0, 0.11);
    wArm(-1, -0.25, -0.12, 'blade', -2.25, 0.175);
    const tOrb = wArm(1, -0.25, 0.12, 'orb', -2.25, 0.175);
    // 輕/重同型(beam×beam)= 同一組共鳴發射器兩種模式:輕 = 雙槍莢透鏡脈衝(lightGlow 擊發閃)、
    // 重 = orb 諧振球放大器(蓄力增亮 + 整條觸手前探;擊發反向收回)—— glow 不再錯掛 heavy(2026-07-16 修正)
    heavyRig = {
      glow: [{ mesh: tOrb.glowMesh, base: 1.5 }],
      pivot: [{
        obj: tOrb.tipP,
        rest: { x: tOrb.tipP.rotation.x, y: tOrb.tipP.rotation.y, z: tOrb.tipP.rotation.z },
        deploy: { x: tOrb.tipP.rotation.x - 0.3, y: tOrb.tipP.rotation.y, z: tOrb.tipP.rotation.z },
      }],
    };
    quadWeap = { light: 'N', heavy: 'N' };   // 觸手持械:後座走 _kickB(外套膜/胸腔反應)
    quadHvy = { chest: 0.04 };
    quadLGlow = [{ mesh: tGunL.glowMesh, base: 1.2 }, { mesh: tGunR.glowMesh, base: 1.2 }];
    quadMuzL = { n: tGunR.glowMesh, r: 0.12 };
    quadMuzH = { n: tOrb.glowMesh, r: 0.16 };
    // rig.wpn:三具 tipP 分掛三條觸手、橫跨整個體寬 —— 若整組登記,FPV 定尺會把聯集
    // 縮到一排小點(2026-07-22 稽核 frac=1.00 打回)。座艙的觸手只握一具 ⇒ 輕=右槍莢單根、
    // 重=orb 諧振器單根,各自 ref=自身 tipP(透鏡 glowMesh 在 tipP 局部 z=+0.74 ⇒ fwd 'z')
    quadWpnL = { nodes: [tGunR.tipP], ref: tGunR.tipP, muz: tGunR.glowMesh, fwd: 'z' };
    quadWpnH = { nodes: [tOrb.tipP], ref: tOrb.tipP, muz: tOrb.glowMesh, fwd: 'z' };
    // 尾已移除(使用者指示):克蘇魯不再拖曳後觸手尾。tail/tail2 群組留空,
    // stepQuad 的 whipTail 空轉 → 無任何視覺輸出(不必動 rig 合約與空值守衛)
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
    weap: quadWeap, hvy: quadHvy, lightGlow: quadLGlow,   // 開火後座/蓄力反向/槍口閃光(全生物分支)
    gunR: quadGunR,          // 騎槍俯仰(僅 centaur:stepQuad rider 的 gunPitch 消費)
    muzzles: { light: quadMuzL, heavy: quadMuzH },   // 槍口錨:曳光起點/槍口焰(makeUnit 掛焰)
    wpn: { light: quadWpnL, heavy: quadWpnH },       // rig.wpn:FPV 武裝同源(契約見 podWeapon 上方)
    humChest, humNeck,       // 人馬上身分節樞軸(僅 centaur 非 null):腰→胸→頸逐節反向吸收馬軀起伏
    hipsY0: hipY, stride: P.stride, top: P.top ?? 10,
    // 各生物專屬步態參數(見 BEAST 表):側步/小跑/觸手輪 + 體側搖擺/彈跳/俯仰幅;
    // soft = 觸手腿(整條走 undulate 全波,不是關節腿的屈曲)
    gait: P.gait, gallopType: P.gallopType, bob: P.bob ?? 0.09, rollSway: P.rollSway,
    pitchAmp: P.pitchAmp, legAmp: P.legAmp, soft: P.soft,
    heavy: heavyRig,
  };
  g.userData.rig = rig;
  return g;
}

/**
 * 雙足獸型機甲(form:'biped'):可動雙足骨架(rig 'biped' 合約同 buildRobotMech,
 * locomotion stepBiped 驅動步態/重心側移/前傾)。武裝內建於生物構造:
 * creature: 'gorilla' 猩猩(雙肩分扛:右肩三管霰彈/左肩電漿噴口;左前臂鑄鐵鍋盾)
 *         | 'ostrich' 鴕鳥/仿生鶴(右翼藏飛彈管、左翼藏線圈步槍)
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
  let heavyRig = { glow: [], pivot: [] };   // 重武器掛點(依生物分支填入)
  let bpWeap = null, bpHvy = null, bpLGlow = null;   // 戰鬥動畫欄位(roo/trex 手持;其餘機載 'N')
  let bpMuzL = null, bpMuzH = null;                  // 槍口錨(rig.muzzles:曳光起點/槍口焰)
  let bpGunR = null, bpGunL = null, bpAim = null;    // 手持/肩扛武器俯仰(gunPitch)+ 射擊姿勢(aimPose)
  let bpWpnL = null, bpWpnH = null;                  // rig.wpn(FPV 武裝同源;契約見 podWeapon 上方)

  if (C === 'gorilla') {
    // ---- 猩猩:聳背厚胸 + 巨臂武裝(右旋轉機砲 / 左鑄鐵鍋盾);短粗腿(蹠行,膝微屈)----
    const mkLeg = (sx) => segLimb(g, [sx * 0.62, hipY, 0], [
      { len: 1.0, draw: (l) => {
        cyl(l, 0.28, 0.33, 1.0, 10, 0, -0.5, 0.02, hull, { metalness: 0.6 });
        // 大腿液壓缸(把上臂液壓破碎缸的拆除機具語彙延伸到承重腿):單端錨大腿節內斜置,
        // MUST NOT 跨膝關節(兩端各錨會被步態拉伸)
        cyl(l, 0.05, 0.05, 0.5, 6, 0, -0.3, 0.34, 0x2b3138, { metalness: 0.85 }).rotation.x = -0.18;
        cyl(l, 0.025, 0.025, 0.4, 6, 0, -0.72, 0.42, 0xd8dde2, { metalness: 0.9 }).rotation.x = -0.18;
      } },
      { len: 0.75, base: 0.1, k: 0.5, d: 0.15, draw: (l) => {
        cyl(l, 0.24, 0.28, 0.9, 10, 0, -0.35, -0.02, hullDk);
        bx(l, 0.36, 0.55, 0.08, 0, -0.35, 0.28, hullDk, { metalness: 0.6 });       // 挖掘機脛前護板
        cyl(l, 0.31, 0.31, 0.09, 10, 0, -0.62, -0.02, 0x23262a, { metalness: 0.8 });   // 踝束環(與右前臂束環呼應的關節防塵環)
      } },
      { len: 0, base: -0.06, k: -0.28, d: 0.5, draw: (l) => {
        bx(l, 0.6, 0.3, 0.95, 0, -0.16, 0.1, 0x23262a);
        bx(l, 0.56, 0.12, 0.2, 0, -0.1, 0.6, hullDk, { metalness: 0.6 });          // 前掌趾甲板(推土鏟前緣,與指節柱觸地語彙對稱)
      } },
    ], cl(sx));
    legL = mkLeg(-1); legR = mkLeg(1);
    bx(hips, 1.3, 0.6, 0.9, 0, 0.1, 0, joint, { metalness: 0.6 });                 // 骨盆
    // 骨盆裝甲裙(低重心工程機具的胯部防護):寬 0.56 收在雙腿內緣之間,腿前後擺不掃到
    const skF = bx(hips, 0.56, 0.4, 0.08, 0, -0.28, 0.48, hullDk, { metalness: 0.6 });
    skF.rotation.x = 0.3;
    const skB = bx(hips, 0.56, 0.4, 0.08, 0, -0.28, -0.48, dim(hullDk, 0.85), { metalness: 0.6 });
    skB.rotation.x = -0.3;
    // 胸腹平面接合環:胸腔對轉/前傾時,圓角胸廓底不與骨盆張口(平端覆蓋)
    const gcol = cyl(chest, 0.5, 0.5, 0.55, 14, 0, 0.5, 0.05, dim(hull, 0.85), { metalness: 0.6 });
    gcol.scale.x = 1.5;
    // 圓角厚胸(橫置膠囊:猩猩的桶狀胸廓,長軸 = 肩寬)
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.65, 0.8, 4, 12), mat(hull, { metalness: 0.6 }));
    torso.position.set(0, 1.0, 0.1);
    torso.rotation.set(0.22, 0, Math.PI / 2);                                      // 前傾聳背 + 橫置
    chest.add(torso);
    bx(chest, 2.3, 0.35, 1.1, 0, 1.62, -0.15, plate);                              // 肩背甲
    bx(chest, 1.7, 0.16, 0.85, 0, 1.8, -0.32, dim(plate, 1.25));                   // 銀背亮鞍(同色系提亮的背部分區)
    for (let i = 0; i < 3; i++)                                                    // 散熱排氣柵(肩背甲後緣三條)
      bx(chest, 0.5, 0.07, 0.05, 0, 1.72 - i * 0.1, -0.74, i === 1 ? accent : 0x1a1d20,
        i === 1 ? { emissive: accent, emissiveIntensity: 0.6 } : { metalness: 0.7 });
    bx(chest, 0.8, 0.3, 0.14, 0, 0.85, 0.72, accent, { emissive: accent, emissiveIntensity: 0.9 });
    // 上胸鉚接橫甲板(俄式重工厚胸甲):板面四角鉚釘
    bx(chest, 1.5, 0.45, 0.12, 0, 1.32, 0.7, PAL.mid, { metalness: 0.6 });
    for (const s2 of [-1, 1]) for (const sy of [-1, 1])
      cyl(chest, 0.035, 0.035, 0.04, 6, s2 * 0.6, 1.32 + sy * 0.14, 0.77, 0xd8dde2, { metalness: 0.9 })
        .rotation.x = Math.PI / 2;
    // 焊補丁甲板 ×2(「自己焊的」敘事:不同明度補板 = 戰地修補痕)—— 避開反應爐燈與鉚接橫甲板
    bx(chest, 0.36, 0.28, 0.05, -0.52, 0.98, 0.74, dim(hull, 0.88), { metalness: 0.6 }).rotation.y = -0.2;
    const wp2 = bx(chest, 0.3, 0.22, 0.05, 0.55, 0.68, 0.68, dim(hull, 0.8), { metalness: 0.6 });
    wp2.rotation.x = -0.45;
    wp2.rotation.y = 0.25;
    // 側面吊裝扶手(俄式戰車側裙吊耳:步兵搭乘語彙)
    for (const s2 of [-1, 1])
      bx(chest, 0.05, 0.06, 0.6, s2 * 1.185, 1.66, -0.2, 0x2b3138, { metalness: 0.8 });
    // 柴油排氣煙囪 ×2(向後上斜,與散熱柵同區呼應的重工柴油機語彙)
    for (const s2 of [-1, 1])
      cyl(chest, 0.09, 0.11, 0.45, 8, s2 * 0.45, 2.0, -0.5, 0x1c2126, { metalness: 0.8 }).rotation.x = -0.4;
    // 肩球帽甲(鑄造帽緣 = Gundam 式面板分割,打破純球剪影):球心在臂樞軸旁 → 球面旋轉不變,chest 錨不漂移
    for (const s2 of [-1, 1])
      cyl(chest, 0.3, 0.52, 0.22, 12, s2 * 1.35, 2.05, 0.1, hullDk, { metalness: 0.6 });
    // 低伏頭(猩猩沒有頸:頭直接沉在肩之間 → neck 只是個短樞軸)
    neck.position.set(0, 1.6, 0.4);
    bx(head, 0.62, 0.5, 0.6, 0, 0.15, 0.15, plate, { metalness: 0.6 });            // 顱
    bx(head, 0.66, 0.16, 0.2, 0, 0.38, 0.28, hullDk);                              // 眉甲
    const crest = bx(head, 0.1, 0.14, 0.46, 0, 0.44, 0.02, hullDk, { metalness: 0.6 });   // 矢狀嵴(後傾窄立板 = 大猩猩顱形剪影)
    crest.rotation.x = -0.12;
    bx(head, 0.46, 0.12, 0.06, 0, 0.22, 0.46, accent, { emissive: accent, emissiveIntensity: 1.6 });
    // 下顎吻甲 + 護柵(大猩猩吻部剪影 + 拳擊護齒):head 被凝視穩定驅動,子件恆隨動無穿模
    bx(head, 0.5, 0.2, 0.16, 0, -0.04, 0.44, hullDk, { metalness: 0.6 });
    for (const s2 of [-1, 1])
      cyl(head, 0.02, 0.02, 0.16, 6, s2 * 0.1, -0.04, 0.53, 0xd8dde2, { metalness: 0.85 });
    // 巨臂:肩球 → 上臂 → 肘(武裝前臂)→ 腕(拳 / 砲口組)。
    // 指節行走(knuckle walk)是「真的」:臂長設計到指節觸地(肩高 3.45 ≈ 上臂 1.55 +
    // 前臂 1.82 + 拳)—— 前肢是承重前腳,擺動/載荷全由 stepBiped 的 knuckle 分支驅動
    const mkArm = (sx) => segLimb(chest, [sx * 1.35, 1.45, 0.1], [
      { len: 1.55, draw: (a) => {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), mat(plate, { metalness: 0.6 }));
        ball.position.y = 0.1;
        a.add(ball);
        cyl(a, 0.3, 0.34, 1.5, 10, 0, -0.78, 0.05, hull, { metalness: 0.6 });      // 巨上臂圓柱(拉長觸地)
        // 液壓破碎缸 + 活塞桿(工程拆除臂機構):斜貼上臂兩側、下端指向肘 —— 收在上臂節內不跨肘關節
        for (const s2 of [-1, 1]) {
          cyl(a, 0.07, 0.07, 0.75, 6, s2 * 0.3, -0.55, 0.2, 0x2b3138, { metalness: 0.85 }).rotation.x = 0.14;
          cyl(a, 0.032, 0.032, 0.55, 6, s2 * 0.3, -1.15, 0.24, 0xd8dde2, { metalness: 0.9 }).rotation.x = 0.14;
        }
      } },
      { len: 1.55, base: -0.14, k: -0.45, d: 0.32, draw: (a) => {
        if (sx > 0) {
          // 右前臂(2026-07-17 起與武器脫鉤:武器改扛右肩,前臂回歸承重前腳)——
          // 巨圓柱前臂 + 關節束環;舊彈鼓前臂/燃料罐/熔核導管隨武器一併移駐肩架
          cyl(a, 0.3, 0.34, 1.5, 10, 0, -0.74, 0.05, hullDk, { metalness: 0.65 });
          for (const oy of [-0.4, -1.05])
            cyl(a, 0.37, 0.37, 0.06, 10, 0, oy, 0.05, 0x23262a, { metalness: 0.8 });   // 束環
        } else {
          cyl(a, 0.26, 0.3, 1.5, 10, 0, -0.7, 0.02, hullDk, { metalness: 0.6 });   // 左:圓柱前臂
          const pot = cyl(a, 0.85, 0.85, 0.22, 14, -0.5, -0.6, 0.05, 0x2b3138, { metalness: 0.7 });
          pot.rotation.z = Math.PI / 2;                                             // 鑄鐵鍋盾
          cyl(pot, 0.6, 0.6, 0.26, 14, 0, 0, 0, 0x363e46, { metalness: 0.6 });
          for (let i = 0; i < 6; i++) {                                             // 鍋面分格反應磚(自焊 ERA,塊間留縫、貼圓周切線)
            const th = i / 6 * Math.PI * 2;
            bx(pot, 0.26, 0.06, 0.2, Math.cos(th) * 0.55, -0.14, Math.sin(th) * 0.55, 0x30373f, { metalness: 0.6 }).rotation.y = -th;
          }
          cyl(pot, 0.78, 0.78, 0.06, 14, 0, -0.12, 0, accent, { emissive: accent, emissiveIntensity: 0.7 });
          cyl(pot, 0.2, 0.24, 0.08, 10, 0, -0.2, 0, 0x2b3138, { metalness: 0.8 });    // 鍋心凸緣(盾牌 boss:強化「鍋=盾」中心構圖)
        }
      } },
      { len: 0, base: 0.1, k: 0.26, d: 0.62, draw: (a) => {
        // 雙腕一律 = 拳(拳步著地面):2026-07-17 起武器改扛右肩,右腕武裝拆除 ——
        // 指節行走的手是前腳,不長武器(舊三管/電漿噴口 = 武器長在腳上,已移除)
        bx(a, 0.4, 0.35, 0.5, 0, 0.08, 0.05, 0x30373f);                            // 拳
        for (let i = -1; i <= 1; i++)
          bx(a, 0.1, 0.36, 0.16, i * 0.12, -0.2, 0.18, 0x23262a);                  // 指節柱(拳步的觸地點)
      } },
    ], ca(sx));
    armL = mkArm(-1); armR = mkArm(1);
    // ── 雙肩分扛武器(2026-07-22 使用者指示「輕/重分扛左右肩」):右肩三管旋轉霰彈(輕)、
    // 左肩電漿噴口(重)—— 各自獨立肩座,支柱生根肩背甲、彈鼓/燃料罐與槍管同軸(供彈同軸規則),
    // 槍身沿 +z 朝前,gunPitch 各驅動俯仰(行軍微下壓 ↔ 交戰水平),後座走 _kickB + 槍口上跳 ──
    const sgR = new THREE.Group();
    sgR.position.set(0.85, 1.98, 0.05);
    chest.add(sgR);
    const sgL = new THREE.Group();
    sgL.position.set(-0.85, 1.98, 0.05);
    chest.add(sgL);
    for (const sx of [-1, 1])
      bx(chest, 0.26, 0.42, 0.32, sx * 0.85, 1.72, -0.08, 0x2b3138, { metalness: 0.7 });  // 肩架支柱(生根肩背甲)
    // 右肩(輕):機匣 + 彈鼓 + 外環三管旋轉霰彈
    bx(sgR, 0.42, 0.36, 0.72, 0, 0, -0.32, 0x23262a, { metalness: 0.75 });         // 霰彈機匣
    const gDrum = cyl(sgR, 0.24, 0.24, 0.3, 10, 0, 0, -0.84, hullDk, { metalness: 0.7 });
    gDrum.rotation.x = Math.PI / 2;                                                // 彈鼓(鼓軸∥槍管 = 供彈同軸)
    cyl(sgR, 0.26, 0.26, 0.05, 10, 0, 0, -0.76, 0x111418, { metalness: 0.8 })
      .rotation.x = Math.PI / 2;                                                   // 彈鼓分度環
    for (const aa of [0, 2.1, 4.2]) {
      const b3 = cyl(sgR, 0.06, 0.06, 0.9, 6, Math.cos(aa) * 0.15, Math.sin(aa) * 0.15, 0.4,
        0x111418, { metalness: 0.85 });
      b3.rotation.x = Math.PI / 2;                                                 // 外環三管旋轉霰彈(輕)
    }
    const gLm = cyl(sgR, 0.2, 0.2, 0.06, 10, 0, 0, 0.86, accent,
      { emissive: accent, emissiveIntensity: 0.7 });
    gLm.rotation.x = Math.PI / 2;                                                  // 三管口識別環(輕武器擊發閃光)
    // 左肩(重):機匣 + 電漿噴口 + 燃料罐
    bx(sgL, 0.38, 0.34, 0.66, 0, 0, -0.28, 0x23262a, { metalness: 0.75 });         // 電漿機匣
    const gNoz = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.4, 8, 1, true),
      mat(0x1c2126, { metalness: 0.85 }));
    gNoz.rotation.x = -Math.PI / 2;
    gNoz.position.set(0, 0, 0.6);
    sgL.add(gNoz);                                                                 // 電漿噴口(重,朝前)
    const gCore = cyl(sgL, 0.09, 0.09, 0.06, 8, 0, 0, 0.82, accent,
      { emissive: accent, emissiveIntensity: 1.0 });
    gCore.rotation.x = Math.PI / 2;                                                // 磁約束光核(蓄力增亮)
    const gTank = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.4, 4, 8),
      mat(dim(accent, 0.75), { emissive: accent, emissiveIntensity: 0.4 }));
    gTank.rotation.x = Math.PI / 2;
    gTank.position.set(0, 0, -0.62);
    sgL.add(gTank);                                                                // 電漿燃料罐(沿噴軸後掛 = 供能同軸)
    heavyRig = { glow: [{ mesh: gCore, base: 1.0 }, { mesh: gTank, base: 0.4 }], pivot: [] };
    bpLGlow = [{ mesh: gLm, base: 0.7 }];
    bpMuzL = { n: gLm, r: 0.2 };
    bpMuzH = { n: gCore, r: 0.12 };
    bpGunR = { g: sgR, rest: 0.12, aim: 0 };  // 肩扛砲俯仰:chest 子層鏈上無其他俯仰 ⇒ rest 微下壓、aim 水平
    bpGunL = { g: sgL, rest: 0.12, aim: 0 };  // 左肩重砲同 gunPitch 規則(後座各走 _kickB × 0.8 槍口上跳)
    // rig.wpn:異型雙掛(右肩輕 / 左肩重)—— 各自單根肩座 ref,槍口皆在局部 +z 端
    // (gLm z=0.86、gCore z=0.82,機匣 −0.32/−0.28)⇒ fwd 'z'
    bpWpnL = { nodes: [sgR], ref: sgR, muz: gLm, fwd: 'z' };
    bpWpnH = { nodes: [sgL], ref: sgL, muz: gCore, fwd: 'z' };
    // 指節行走:手是前腳,不入手持列(文件明載)—— 後座走 _kickB 打進胸腔 + 肩砲槍口上跳
    bpWeap = { light: 'N', heavy: 'N' };
    bpHvy = { chest: 0.06, gun: 0.08 };
  } else if (C === 'ostrich') {
    // ---- 鴕鳥/仿生鶴:逆關節三節長腿(股 → 長脛 → 蹠節 → 二趾足)+ 半開翼內藏飛彈管 ----
    const mkLeg = (sx) => segLimb(g, [sx * 0.42, hipY, 0], [
      { len: 1.3, draw: (l) => {
        cyl(l, 0.12, 0.14, 1.3, 8, 0, -0.6, 0.1, hull);                            // 圓柱股節
        // Cassie 股殼(反曲腿機器人的招牌寬扁整流殼):外側縱貼 —— 細管腿撐不起原型
        bx(l, 0.07, 1.05, 0.4, sx * 0.16, -0.6, 0.1, plate, { metalness: 0.5 }).rotation.z = sx * 0.05;
        // 膝部導彈莢已拆除(2026-07-22 規則 5:無功能裝飾砲管不留)—— 改素面膝護板
        bx(l, 0.24, 0.3, 0.16, 0, -1.2, 0.18, hullDk);                             // 膝護板
      } },
      // 逆關節:脛節向後折(base 正)、蹠節再向前回折(base 負)= 鳥類的 Z 形腿
      { len: 1.5, base: 0.45, k: 0.62, d: 0.14, draw: (l) => {
        const knee = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), mat(joint, { metalness: 0.7 }));
        knee.position.set(0, 0, -0.05);
        l.add(knee);
        cyl(l, 0.07, 0.09, 1.5, 8, 0, -0.75, -0.12, hullDk);                       // 圓柱長脛
        // 脛節後緣外露儲能腱(反曲腿的彈性肌腱):拉桿 + 上下端關節套,收在脛節內不跨關節
        cyl(l, 0.028, 0.028, 1.25, 6, 0, -0.72, -0.26, 0xd8dde2, { metalness: 0.9 });
        cyl(l, 0.05, 0.05, 0.07, 6, 0, -0.12, -0.26, 0x23262a, { metalness: 0.8 });
        cyl(l, 0.05, 0.05, 0.07, 6, 0, -1.32, -0.26, 0x23262a, { metalness: 0.8 });
      } },
      { len: 0.55, base: -0.5, k: -0.55, d: 0.36, draw: (l) => {
        cyl(l, 0.06, 0.075, 0.6, 8, 0, -0.28, 0.06, hull);                         // 圓柱蹠節(跗蹠骨)
        // 蹠節後側跟腱桿 + 頂端套環:與脛腱上下呼應,儲能路徑由膝一路讀到踝
        cyl(l, 0.022, 0.022, 0.5, 6, 0, -0.26, -0.12, 0xd8dde2, { metalness: 0.9 });
        cyl(l, 0.045, 0.045, 0.06, 6, 0, -0.04, -0.12, 0x23262a, { metalness: 0.8 });
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
    // 髖動力鼓(Cassie 三軸馬達鼓 = 裸髖關節的正解):掛 g 與腿樞軸同框不滑動 ——
    // 股頂只轉不移,鼓殼恆罩住;hips 有 bob 位移故 MUST NOT 掛 hips
    for (const s2 of [-1, 1])
      cyl(g, 0.2, 0.2, 0.12, 10, s2 * 0.5, hipY, 0, hullDk, { metalness: 0.7 }).rotation.z = Math.PI / 2;
    bx(hips, 0.9, 0.45, 0.7, 0, 0.05, 0, joint);
    const bodyM = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 9), mat(hull, { metalness: 0.55 }));
    bodyM.scale.set(0.85, 0.75, 1.15);
    bodyM.position.set(0, 0.55, 0);
    chest.add(bodyM);
    // 尾羽扇 = 尾(單節,奔跑時隨體軸微擺配平)
    mkTail(chest, [0, 0.62, -0.7], [[0]]);
    for (let i = -1; i <= 1; i++) {
      // 尾羽扇 = feather 放射扇:羽根聚尾樞軸、羽尖向後張扇(掠角逐片向兩側收、sgn 分左右鏡射)
      const f = feather(tailSegs[0], 0.95, 0.24, 0, 0, -0.2, 1.57 - Math.abs(i) * 0.35, i < 0 ? -1 : 1, i === 0 ? accent : plate);
      f.rotation.x = -0.5;                                                         // 下垂
    }
    // 長頸雙節:鳥的頸是 S 形彈簧,奔跑時頸在動、頭卻幾乎不動(凝視穩定的極致原型)
    neck.position.set(0, 0.8, 0.42);
    const n1 = bx(neck, 0.22, 0.9, 0.26, 0, 0.45, 0.13, hullDk);
    n1.rotation.x = 0.25;
    const neck2 = new THREE.Group();
    neck2.position.set(0, 0.9, 0.22);
    neck.add(neck2);
    bx(neck2, 0.18, 0.85, 0.2, 0, 0.25, 0.08, hull);
    // 頸背纜線導管(長頸感測頭的供電/資料束 = 鳥頸「食道」機械化):分兩節各自節內錨定,
    // 隨 S 頸各節擺動不拉伸
    cyl(neck, 0.03, 0.03, 0.85, 6, 0, 0.45, -0.03, 0x23262a, { metalness: 0.7 }).rotation.x = 0.25;
    cyl(neck2, 0.026, 0.026, 0.75, 6, 0, 0.25, -0.05, 0x23262a, { metalness: 0.7 });
    head.position.set(0, 0.72, 0.14);
    neck2.add(head);                                                                // 頭掛在頸第二節上
    bx(head, 0.34, 0.3, 0.5, 0, 0, 0, plate, { metalness: 0.6 });                  // 小頭
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.5, 6), mat(0xd8b23c, { metalness: 0.6 }));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, -0.02, 0.42);
    head.add(beak);
    bx(head, 0.28, 0.08, 0.06, 0, 0.08, 0.24, accent, { emissive: accent, emissiveIntensity: 1.6 });
    bx(head, 0.1, 0.3, 0.2, 0, 0.24, -0.18, accent);                               // 頂冠
    // 頭頂光達感測筒(自駕試驗車 lidar puck:頭部即感測塔;head 有凝視穩定,子件隨動)
    cyl(head, 0.07, 0.07, 0.06, 8, 0, 0.19, 0.05, 0x1c2126, { metalness: 0.7 });
    cyl(head, 0.05, 0.05, 0.02, 8, 0, 0.225, 0.05, dim(accent, 0.9), { emissive: accent, emissiveIntensity: 0.5 });
    // 翼 = 臂:肩節(覆羽板 + 翼藏武裝)→ 腕節(初級飛羽),擺動時腕節延遲跟隨 = 半開翼的抖動。
    // 武裝左右對應(2026-07-17 使用者指示):右翼藏飛彈管(重武器:原型脈衝雷射矛,beam)、
    // 左翼藏線圈步槍(輕武器,rail)—— 輕武器「藏在另一邊的翅膀」與重武器鏡像對應,
    // 舊背載線圈步槍已拆除(槍口一律朝前 +z,收在覆羽板之下)
    const ostrichTips = [];   // 右翼飛彈管口(重)
    let ostrichLW = null;     // 左翼線圈槍口(輕)
    const ostrichHN = [], ostrichLN = [];   // rig.wpn 節點集:右翼飛彈管散件 / 左翼線圈步槍散件
    const mkArm = (sx) => segLimb(chest, [sx * 0.68, 0.75, 0.15], [
      { len: 0.72, draw: (a) => {
        const wing = bx(a, 0.14, 0.75, 1.5, sx * 0.05, -0.35, -0.25, plate, { metalness: 0.5 });
        wing.rotation.z = sx * 0.18;
        const covert = bx(a, 0.1, 0.5, 1.3, sx * 0.18, -0.3, -0.2, dim(plate, 0.85));
        covert.rotation.z = sx * 0.35;
        if (sx > 0) {
          for (let i = 0; i < 3; i++) {
            const c = cyl(a, 0.06, 0.06, 0.2, 6, sx * -0.02, -0.58, 0.3 - i * 0.42, 0x111418, { metalness: 0.8 });
            c.rotation.x = Math.PI / 2;
            const t = cyl(a, 0.04, 0.04, 0.05, 6, sx * -0.02, -0.58, 0.43 - i * 0.42, accent, { emissive: accent, emissiveIntensity: 1.3 });
            t.rotation.x = Math.PI / 2;
            ostrichTips.push(t);
            ostrichHN.push(c, t);
          }
        } else {
          // 左翼線圈步槍:電容機匣 + 加速管 + 線圈環 ×2 + 槍口環,位置與右翼飛彈管鏡像
          ostrichLN.push(bx(a, 0.16, 0.22, 0.42, sx * -0.02, -0.5, -0.28, hullDk, { metalness: 0.7 }));   // 電容機匣
          const ob = cyl(a, 0.035, 0.042, 1.05, 6, sx * -0.02, -0.58, 0.3, 0x111418, { metalness: 0.85 });
          ob.rotation.x = Math.PI / 2;                                                    // 加速管
          ostrichLN.push(ob);
          for (const zz of [0.12, 0.48]) {                                                // 加速線圈環
            const cr = cyl(a, 0.07, 0.07, 0.05, 8, sx * -0.02, -0.58, zz, accent, { emissive: accent, emissiveIntensity: 0.6 });
            cr.rotation.x = Math.PI / 2;
            ostrichLN.push(cr);
          }
          ostrichLW = cyl(a, 0.055, 0.055, 0.05, 8, sx * -0.02, -0.58, 0.85, accent,
            { emissive: accent, emissiveIntensity: 0.8 });
          ostrichLW.rotation.x = Math.PI / 2;                                             // 槍口環(擊發閃光)
          ostrichLN.push(ostrichLW);
        }
      } },
      { len: 0.5, base: -0.25, k: -0.5, d: 0.4, draw: (a) => {
        for (const sw of [1.0, 1.3]) {                                             // 腕節次級飛羽(feather 放射扇,掠角遞增)
          const f = feather(a, 0.85, 0.24, sx * 0.08, -0.2, -0.2, sw, sx, dim(plate, 0.8));
          f.rotation.z = -sx * 0.45;
        }
      } },
      // 翼手節(鳥翼的第三段:掌骨/初級飛羽)—— 腕再延遲一拍 = 半開翼收放的鞭式末端
      { len: 0, base: -0.2, k: -0.45, d: 0.62, draw: (a) => {
        for (let i = -1; i <= 1; i++) {
          // 指狀初級飛羽(feather 放射扇):羽根聚腕點、掠角逐片遞增 = 尖端自外前向正後掃
          const f = feather(a, 1.0, 0.2, sx * 0.1, -0.26, -0.28, 0.85 + (i + 1) * 0.28, sx, i === 0 ? dim(accent, 0.8) : hullDk);
          f.rotation.z = -sx * 0.55;                                               // 翼扇垂放
        }
      } },
    ], ca(sx));
    armL = mkArm(-1); armR = mkArm(1);
    heavyRig = { glow: ostrichTips.map((mesh) => ({ mesh, base: 1.3 })), pivot: [] };
    // 左肩相位陣列雷達碟(電戰鳥的不對稱背部酬載;感測器非武器,保留在背):
    // 支柱底端埋進體殼生根 → 旋轉座 → 斜仰碟盤 + 盤心饋源(掛碟盤子節點,隨傾角恆居中盤面)
    bx(chest, 0.16, 0.4, 0.2, -0.32, 1.0, -0.12, 0x2b3138, { metalness: 0.7 });    // 支柱
    bx(chest, 0.14, 0.14, 0.14, -0.32, 1.22, -0.12, hullDk, { metalness: 0.7 });   // 旋轉座
    const dish = cyl(chest, 0.48, 0.48, 0.05, 16, -0.36, 1.28, -0.14, plate, { metalness: 0.6 });
    dish.rotation.z = 0.42;
    dish.rotation.x = -0.3;                                                        // 斜仰朝前上
    cyl(dish, 0.1, 0.1, 0.08, 8, 0, 0.05, 0, accent, { emissive: accent, emissiveIntensity: 0.8 });   // 盤心饋源
    // 相位陣列升級(素圓盤讀不出「相位陣列」):同心環 + 外緣加強圈 + 背面十字桁架肋 +
    // 盤緣障礙警示燈(航行燈慣例固定紅,純識別不掛 glows)—— 全掛 dish 子節點,隨傾角恆共面
    cyl(dish, 0.36, 0.36, 0.02, 16, 0, 0.045, 0, dim(plate, 0.9), { metalness: 0.6 });
    cyl(dish, 0.5, 0.5, 0.03, 16, 0, -0.01, 0, hullDk, { metalness: 0.6 });
    for (const ry of [0, Math.PI / 2])
      bx(dish, 0.08, 0.04, 0.86, 0, -0.045, 0, 0x2b3138, { metalness: 0.7 }).rotation.y = ry;
    bx(dish, 0.06, 0.04, 0.06, 0.44, 0.03, 0, 0xff5544, { emissive: 0xff3322, emissiveIntensity: 1.6 });
    // 試車台敘事:背部檢修艙門(天天拆開修,右背與左肩雷達碟對稱配重)+
    // 右舷飛測標定棋盤格(攝影測量標記:深色格對角排列,白機身自身為亮格)
    bx(chest, 0.34, 0.05, 0.46, 0.33, 1.06, -0.12, dim(hull, 0.9), { metalness: 0.5 }).rotation.z = -0.4;
    bx(chest, 0.05, 0.13, 0.13, 0.7, 0.72, 0.28, 0x111418);
    bx(chest, 0.05, 0.13, 0.13, 0.72, 0.585, 0.145, 0x111418);
    bpWeap = { light: 'N', heavy: 'N' };   // 翼藏皆機載:後座走 _kickB
    bpHvy = { chest: 0.04 };
    bpLGlow = ostrichLW ? [{ mesh: ostrichLW, base: 0.8 }] : null;
    bpMuzL = ostrichLW ? { n: ostrichLW, r: 0.06 } : null;
    bpMuzH = ostrichTips.length ? { n: ostrichTips[0], r: 0.05 } : null;
    // rig.wpn:兩翼武裝皆散件、掛在 segLimb 翼臂節內 → ref=chest(消費端經 matrixWorld 烘回);
    // 左翼槍口環在翼節 z=+0.85、機匣 −0.28 ⇒ +z;右翼彈尖 t 在管身 c 前方 +0.13(z=0.43 vs 0.3)⇒ +z
    // (翼臂第一節無靜態 base 旋轉,+z 即 chest 前向)
    bpWpnL = ostrichLN.length ? { nodes: ostrichLN, ref: chest, muz: ostrichLW, fwd: 'z' } : null;
    bpWpnH = ostrichHN.length ? { nodes: ostrichHN, ref: chest, muz: ostrichTips[0] || null, fwd: 'z' } : null;
  } else if (C === 'trex') {
    // ---- 暴龍:水平體軸 + 巨顎藏無後座砲;Z 形趾行腿、小短臂,重尾配重 ----
    const mkLeg = (sx) => segLimb(g, [sx * 0.72, hipY, 0], [
      { len: 1.1, draw: (l) => {
        cyl(l, 0.29, 0.34, 1.15, 10, 0, -0.5, 0.1, hull, { metalness: 0.6 });
        // 巨股鼓甲(暴龍全身最大肌群;鑄造圓弧量體同時就是 T-72 鑄造砲塔語彙):
        // 橢圓鼓包住素股柱,底不及膝
        const th2 = cyl(l, 0.36, 0.4, 0.95, 10, 0, -0.38, 0.1, hull, { metalness: 0.6 });
        th2.scale.z = 1.45;
        th2.rotation.x = -0.12;
      } },
      { len: 0.95, base: 0.4, k: 0.6, d: 0.15, draw: (l) => cyl(l, 0.2, 0.24, 1.0, 9, 0, -0.42, -0.1, hullDk) },
      { len: 0, base: -0.42, k: -0.5, d: 0.45, draw: (l) => {
        bx(l, 0.55, 0.28, 1.0, 0, -0.3, 0.2, 0x23262a);                            // 三趾足
        bx(l, 0.42, 0.2, 0.12, 0, -0.02, 0.32, PAL.mid, { metalness: 0.6 }).rotation.x = 0.4;   // 踝前斜甲(趾行腿防塵,蓋掉素足接縫)
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
    // 車長指揮塔(cupola,原樣搬上背脊、偏右讓開中線背鰭):基座 → 塔體 → 頂蓋 + 環列觀察鏡 + 半開艙蓋
    cyl(chest, 0.3, 0.36, 0.16, 10, 0.5, 0.86, 0.78, hullDk, { metalness: 0.7 });   // 基座
    cyl(chest, 0.24, 0.28, 0.26, 10, 0.5, 1.06, 0.78, PAL.mid, { metalness: 0.7 }); // 塔體
    cyl(chest, 0.27, 0.24, 0.07, 10, 0.5, 1.22, 0.78, PAL.dark, { metalness: 0.7 }); // 頂蓋
    for (let i = 0; i < 6; i++) {                                                  // 環列觀察鏡
      const th = i / 6 * Math.PI * 2;
      bx(chest, 0.07, 0.045, 0.03, 0.5 + Math.cos(th) * 0.25, 1.1, 0.78 + Math.sin(th) * 0.25,
        accent, { emissive: accent, emissiveIntensity: 0.7 }).rotation.y = -th;
    }
    const hatch = bx(chest, 0.2, 0.03, 0.2, 0.68, 1.28, 0.78, PAL.mid);
    hatch.rotation.z = 0.6;                                                        // 艙蓋半開
    // 胸軀兩側裙分格反應磚(鑄造圓軀外的分格側裙):微斜貼圓角胸壁,塊間留縫 = 分格感
    for (const s2 of [-1, 1]) for (let i = 0; i < 3; i++)
      bx(chest, 0.07, 0.2, 0.28, s2 * 0.66, 0.42, 1.05 - i * 0.34, PAL.mid, { metalness: 0.6 })
        .rotation.y = s2 * 0.12;
    // 前胸備用履帶排(T-72 前裝甲掛履帶板 = 獸的護胸甲):貼胸膠囊下前緣,隨弧外傾
    for (let i = 0; i < 3; i++)
      bx(chest, 0.22, 0.1, 0.3, (i - 1) * 0.26, 0.1, 1.5, 0x23262a, { metalness: 0.7 }).rotation.x = 0.35;
    // 指揮塔 IR 探照燈(T-72 Luna:指揮塔「原樣搬上去」就該連燈一起搬;純識別不掛 glows)
    bx(chest, 0.08, 0.04, 0.04, 0.75, 1.16, 0.78, 0x2b3138, { metalness: 0.8 });
    bx(chest, 0.15, 0.15, 0.12, 0.86, 1.16, 0.78, PAL.dark, { metalness: 0.7 });
    cyl(chest, 0.055, 0.055, 0.02, 8, 0.86, 1.16, 0.85, dim(accent, 0.9), { emissive: accent, emissiveIntensity: 0.5 })
      .rotation.x = Math.PI / 2;
    // 潛渡通氣管收納(OPVT 平時捆在砲塔後:收納姿態沿右舷肩線,不增高)+ 管口環
    cyl(chest, 0.05, 0.05, 1.1, 6, 0.66, 0.62, 1.0, dim(PAL.mid, 0.9), { metalness: 0.6 }).rotation.x = Math.PI / 2;
    cyl(chest, 0.06, 0.06, 0.05, 6, 0.66, 0.62, 1.52, 0x111418, { metalness: 0.8 }).rotation.x = Math.PI / 2;
    // 左舷排氣百葉(T-72 排氣口在左側翼板 —— 位置忠實,一塊深色百葉即成)
    bx(chest, 0.06, 0.18, 0.46, -0.66, 0.62, 0.75, 0x1a1d20, { metalness: 0.7 }).rotation.y = -0.12;
    // 胸腹平面接合環:胸段對轉時圓角端不與骨盆張口
    const tcol = cyl(chest, 0.48, 0.48, 0.55, 12, 0, 0.42, 0.35, dim(hull, 0.82), { metalness: 0.6 });
    tcol.rotation.x = Math.PI / 2;
    tcol.scale.x = 1.2;
    // 背鰭列(小菱形板):沿脊背由肩到腰一排,比劍龍小一號 —— 正方板繞自身中心旋 45° = 正菱形,
    // 下尖端落在群組原點、原點壓到背面之下 ⇒ 菱形下半沉入背脊、露出上半與軀體連成一塊(不另接方塊)
    for (let i = 0; i < 5; i++) {
      const fh = 0.34 - i * 0.035;
      const f = new THREE.Group();
      f.position.set(0, 0.86 - i * 0.05, 1.2 - i * 0.62);
      chest.add(f);
      const dg = 0.72 * fh;
      const pl = bx(f, 0.09, fh, fh, 0, dg, 0, i % 2 ? plate : hullDk, { metalness: 0.5 });
      pl.rotation.x = Math.PI / 4;
      if (i === 1 || i === 3) bx(f, 0.1, 0.11, 0.08, 0, dg + fh * 0.5, 0, accent, { emissive: accent, emissiveIntensity: 0.9 });
    }
    // 頸(短而粗)→ 頭:奔跑時軀幹起伏,頭要維持水平前視(捕食者的凝視穩定)
    neck.position.set(0, 0.8, 1.5);
    head.position.set(0, 0.15, 0.4);
    bx(head, 0.85, 0.6, 1.0, 0, 0.15, 0.3, plate, { metalness: 0.6 });             // 顱殼
    // 半卵形鑄造頰甲:方盒顱殼包進圓弧鑄造量體(不遮眼列、不壓頰側彈鏈箱)
    for (const s2 of [-1, 1]) {
      const ch2 = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), mat(hull, { metalness: 0.6 }));
      ch2.scale.set(0.5, 0.8, 1.1);
      ch2.position.set(s2 * 0.44, 0.12, 0.25);
      head.add(ch2);
    }
    bx(head, 0.6, 0.34, 0.9, 0, -0.05, 0.85, hullDk);                              // 上顎
    for (let i = 0; i < 4; i++) {                                                  // 上齒列
      const th = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 4), mat(0xe8ecef));
      th.rotation.x = Math.PI;
      th.position.set((i - 1.5) * 0.14, -0.26, 1.1);
      head.add(th);
    }
    const jaw = bx(head, 0.5, 0.2, 0.95, 0, -0.52, 0.62, 0x23262a);
    jaw.rotation.x = 0.42;                                                         // 下顎張開
    for (let i = 0; i < 3; i++) {                                                  // 下齒列(掛 jaw 子節點隨張顎角度:上下齒相對才有咬合壓迫感)
      const dt = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.13, 4), mat(0xe8ecef));
      dt.position.set((i - 1) * 0.13, 0.11, 0.32);
      jaw.add(dt);
    }
    const gunT = cyl(head, 0.09, 0.11, 1.6, 8, 0, -0.12, 1.2, 0x111418, { metalness: 0.85 });
    gunT.rotation.x = Math.PI / 2;                                                 // 口腔無後座砲(重武器:無後座砲,launcher)
    // 砲管熱護套(T-72 分段護套 + 中間束帶 = 坦克砲第一特徵;包覆既有真砲管,不動槍口):
    // 掛 gunT 子節點 —— 隨 heavyRig.pivot 俯仰、FPV 武裝同源同步;cyl 軸沿 gunT 局部 y = 砲軸免旋轉
    cyl(gunT, 0.135, 0.135, 0.5, 8, 0, 0.15, 0, PAL.mid, { metalness: 0.6 });
    cyl(gunT, 0.135, 0.135, 0.5, 8, 0, -0.35, 0, PAL.mid, { metalness: 0.6 });
    cyl(gunT, 0.15, 0.15, 0.05, 8, 0, -0.08, 0, 0x111418, { metalness: 0.8 });
    const muzT = cyl(head, 0.13, 0.13, 0.07, 8, 0, -0.12, 2.0, accent, { emissive: accent, emissiveIntensity: 1.3 });
    muzT.rotation.x = Math.PI / 2;
    // 文氏尾噴(無後座砲識別特徵):頭後方喇叭開口 —— 後噴抵銷後座力
    const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.15, 0.5, 8, 1, true),
      mat(0x1c2126, { metalness: 0.8 }));
    vent.rotation.x = Math.PI / 2;
    vent.position.set(0, 0.0, -0.35);
    head.add(vent);
    heavyRig = {
      glow: [{ mesh: muzT, base: 1.3 }],
      pivot: [{ obj: gunT, rest: { x: Math.PI / 2, y: 0, z: 0 }, deploy: { x: Math.PI / 2 + 0.12, y: 0, z: 0 } }],
    };
    // 輕武器(車載重機槍 DShKM,gun):2026-07-17 移到右手(舊顎下雙管/頰側彈鏈箱已拆除,
    // 見小短臂 mkArm 的 sx>0 分支)—— 與口腔無後座砲分開(異型:手持輕 + 嘴砲重)
    bpWeap = { light: 'R', heavy: 'N' };   // 輕武器手持(右)、嘴砲機載:後座走 _kickB
    bpHvy = { chest: 0.06 };
    bpMuzH = { n: muzT, r: 0.13 };
    // rig.wpn heavy:口腔無後座砲散件(砲管/膛口/文氏尾噴)皆掛 head → ref=head;
    // 膛口 muzT 在 head z=+2.0、砲管 +1.2、尾噴 −0.35 ⇒ 槍口在 +z 端
    bpWpnH = { nodes: [gunT, muzT, vent], ref: head, muz: muzT, fwd: 'z' };
    bx(head, 0.3, 0.14, 0.2, 0, -0.3, 0.5, accent, { emissive: accent, emissiveIntensity: 1.0 });   // 喉部充能
    bx(head, 0.6, 0.1, 0.08, 0, 0.34, 0.78, accent, { emissive: accent, emissiveIntensity: 1.6 });  // 眼列
    bx(head, 0.7, 0.12, 0.16, 0, 0.44, 0.72, hullDk, { metalness: 0.6 }).rotation.x = 0.15;   // 鑄造眉拱(眶上脊 = 鑄造裝甲的觀瞄簷)
    for (const s2 of [-1, 1])                                                      // 鼻孔排氣(暴龍鼻孔 = 引擎進排氣口,生物機械雙關)
      cyl(head, 0.035, 0.035, 0.07, 6, s2 * 0.13, 0.14, 1.05, 0x1c2126, { metalness: 0.7 });
    // 小短臂:上臂 → 肘(前臂)→ 腕(二爪),永遠深屈在胸前(暴龍的招牌姿勢);
    // 腕的擺幅刻意極小 —— 短臂在奔跑時只是抓握狀微顫,不甩動
    const mkArm = (sx) => segLimb(chest, [sx * 0.62, 0.35, 1.55], [
      { len: 0.4, draw: (a) => cyl(a, 0.075, 0.09, 0.4, 8, 0, -0.18, 0.05, hull) },
      { len: 0.3, base: -0.85, k: -0.4, d: 0.3, draw: (a) => cyl(a, 0.055, 0.065, 0.3, 8, 0, -0.14, 0.02, hullDk) },
      { len: 0, base: -0.2, k: -0.18, d: 0.6, draw: (a) => {
        bx(a, 0.11, 0.12, 0.12, 0, -0.05, 0.03, joint);                                     // 腕
        if (sx > 0) {
          // 右手手持 DShKM 雙管(輕武器,2026-07-17 自顎下移到手上):槍身沿 +z、
          // gunPitch 驅動俯仰 —— 行軍微下壓 ↔ 據槍水平(aimPose 抬臂前伸 = 戰鬥姿勢);
          // 彈鏈箱側掛槍身(供彈與雙管同軸),槍口識別環 = 擊發閃光/曳光起點
          const tg = new THREE.Group();
          tg.position.set(0, -0.12, 0.08);
          tg.rotation.x = 1.2;
          a.add(tg);
          bx(tg, 0.16, 0.14, 0.36, 0, 0.02, -0.04, 0x1a1d20, { metalness: 0.75 });          // 機匣
          for (const ox of [-0.05, 0.05]) {
            const b2 = cyl(tg, 0.028, 0.032, 0.72, 6, ox, 0.02, 0.42, 0x111418, { metalness: 0.85 });
            b2.rotation.x = Math.PI / 2;                                                    // 同軸雙管
          }
          const trexLMuz = cyl(tg, 0.08, 0.08, 0.05, 8, 0, 0.02, 0.8, accent,
            { emissive: accent, emissiveIntensity: 0.8 });
          trexLMuz.rotation.x = Math.PI / 2;                                                // 雙管口識別環
          bx(tg, 0.1, 0.16, 0.22, -0.14, -0.03, -0.02, hullDk, { metalness: 0.6 });         // 彈鏈箱(左側掛,與雙管同軸)
          bx(tg, 0.11, 0.05, 0.24, -0.14, 0.07, -0.02, dim(accent, 0.8));                   // 彈箱蓋識別
          bx(tg, 0.06, 0.12, 0.08, 0, -0.11, -0.14, 0x23262a);                              // 握把
          // rest/aim 由手臂鏈靜姿角解算(肩 0 + 肘 −0.85 + 腕 −0.2 = −1.05;aimPose −0.35−0.6−0.2 = −1.15)
          // 槍身沿 +z ⇒ 槍口水平 = 鏈角總和 + 槍角 = 0:rest 1.2(行軍微下壓)、aim 1.15(據槍水平)
          bpGunR = { g: tg, rest: 1.2, aim: 1.15 };
          bpLGlow = [{ mesh: trexLMuz, base: 0.8 }];
          bpMuzL = { n: trexLMuz, r: 0.08 };
          // rig.wpn light:右手 DShKM 單根 tg(機匣/雙管/彈鏈箱/握把皆其子節點)→ ref=tg;
          // 雙管口識別環 trexLMuz 在 tg 局部 z=+0.8、機匣 −0.04 ⇒ fwd 'z'
          bpWpnL = { nodes: [tg], ref: tg, muz: trexLMuz, fwd: 'z' };
        } else {
          for (const o of [-0.05, 0.06]) bx(a, 0.05, 0.14, 0.08, o, -0.16, 0.06, 0x30373f); // 二爪(左手保留)
          // 腕背後掠鞭天線(短前肢兼指揮天線):基座球 + 鞭桿(上後外三向掠出,讓開胸前緣)+ 桿梢燈
          const ab = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), mat(joint, { metalness: 0.7 }));
          ab.position.set(0, -0.04, 0);
          a.add(ab);
          const whip = cyl(a, 0.008, 0.016, 0.55, 4, 0, 0.12, -0.26, 0x23262a, { metalness: 0.8 });
          whip.rotation.x = -0.9;
          whip.rotation.z = -sx * 0.4;
          cyl(whip, 0.02, 0.02, 0.04, 6, 0, 0.29, 0, accent, { emissive: accent, emissiveIntensity: 1.2 });   // 桿梢燈(子節點恆在桿端)
        }
      } },
    ], ca(sx));
    armL = mkArm(-1); armR = mkArm(1);
    // 戰鬥姿勢(aimPose):交戰/開火時右短臂抬起前伸據槍(槍口朝前),移動交還步態微顫
    bpAim = { rShoulderX: -0.35, rElbowX: -0.6 };
    // 巨尾三節(配重):多節圓柱串接的活平衡桿 —— 急轉時甩向轉向反側,逐節延遲跟隨
    mkTail(hips, [0, 0.3, -0.4], [[0], [0, -0.05, -1.2], [0, -0.07, -1.0]]);
    const tl1 = cyl(tailSegs[0], 0.42, 0.32, 1.4, 10, 0, 0, -0.7, hull);
    tl1.rotation.x = Math.PI / 2 - 0.08;
    tl1.scale.x = 1.15;                                                            // 微扁寬(接臀)
    // 尾基兩側外掛圓筒燃料桶(掛尾基節 = 隨甩尾晃動的外掛雜物):桶身沿尾軸 + 束環 ×2
    for (const s2 of [-1, 1]) {
      cyl(tailSegs[0], 0.11, 0.11, 0.8, 8, s2 * 0.44, 0.1, -0.55, PAL.dark, { metalness: 0.6 })
        .rotation.x = Math.PI / 2;
      for (const zz of [-0.3, -0.8])
        cyl(tailSegs[0], 0.125, 0.125, 0.03, 8, s2 * 0.44, 0.1, zz, 0x23262a, { metalness: 0.8 })
          .rotation.x = Math.PI / 2;
    }
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
        // 大腿減重沖壓肋(輕量化外骨骼:同色系暗版分色在 cel 上讀成「開了孔的殼」,
        // 不加真孔不加 poly)—— 兩條傾角相對 = 沖壓 V 形
        bx(l, 0.05, 0.72, 0.14, sx * 0.29, -0.42, 0.28, dim(hull, 0.88)).rotation.x = -0.35;
        bx(l, 0.05, 0.6, 0.14, sx * 0.29, -0.45, -0.12, dim(hull, 0.8)).rotation.x = 0.3;
        // 髖後氣壓避震(彈跳機器人的落地緩衝行程,與脛後儲能簧串成完整儲能敘事):
        // 單端錨大腿節內斜置,MUST NOT 跨髖/膝關節
        cyl(l, 0.045, 0.045, 0.55, 6, sx * 0.12, -0.3, -0.42, 0x2b3138, { metalness: 0.85 }).rotation.x = 0.3;
        cyl(l, 0.022, 0.022, 0.35, 6, sx * 0.12, -0.68, -0.55, 0xd8dde2, { metalness: 0.9 }).rotation.x = 0.3;
      } },
      { len: 0.8, base: 0.6, k: 0.72, d: 0.14, draw: (l) => {
        cyl(l, 0.11, 0.13, 0.95, 8, 0, -0.4, -0.1, hullDk);                        // 細脛圓柱
        // 脛後外露儲能彈簧(跟腱儲能的機構本體):芯桿 + 簧圈,同節群組隨脛屈伸 —— 蹲伸壓縮方向正確
        cyl(l, 0.028, 0.028, 0.8, 6, 0, -0.38, -0.24, 0xd8dde2, { metalness: 0.9 });
        for (let i = 0; i < 4; i++)
          cyl(l, 0.06, 0.06, 0.028, 8, 0, -0.14 - i * 0.17, -0.24, 0x23262a, { metalness: 0.8 });
      } },
      { len: 0, base: -0.62, k: -0.6, d: 0.4, draw: (l) => {
        bx(l, 0.3, 0.18, 1.15, 0, -0.08, 0.35, 0x23262a);                          // 長蹠(著地面)
        // 踝後跟腱:自蹠跟斜向後上指向脛 + 根部套環 —— 與脛簧串成由膝到蹠的完整儲能路徑
        const hb = cyl(l, 0.022, 0.022, 0.45, 6, 0, 0.1, -0.16, 0xd8dde2, { metalness: 0.9 });
        hb.rotation.x = 0.55;
        cyl(l, 0.04, 0.04, 0.05, 6, 0, -0.02, -0.24, 0x23262a, { metalness: 0.8 });
        bx(l, 0.32, 0.1, 0.3, 0, -0.06, 0.9, dim(accent, 0.8));                    // 足尖識別
        bx(l, 0.03, 0.14, 0.85, sx * 0.18, -0.05, 0.35, dim(hull, 0.9));           // 長蹠外側刃板(刀鋒義肢 C 形板暗示,底緣高於觸地面)
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
    // 分節腹甲(拳擊手的分節腹肌 = 可屈曲腹甲):沿膠囊弧逐片外傾,把素膠囊切出橫向面板線
    bx(chest, 0.56, 0.1, 0.07, 0, 0.26, 0.52, dim(hull, 0.9)).rotation.x = 0.2;
    bx(chest, 0.5, 0.1, 0.07, 0, 0.12, 0.48, dim(hull, 0.82)).rotation.x = 0.3;
    // 育袋艙蓋快拆鎖扣 ×2(彈藥/工具艙:輕量機體一切可拆的機能主義)
    for (const s2 of [-1, 1])
      bx(chest, 0.08, 0.06, 0.05, s2 * 0.18, 0.34, 0.62, 0x23262a, { metalness: 0.7 });
    // 拳擊聳肩護墊(收下顎聳肩的肩線):蓋住裸肩樞軸,強化格鬥剪影 —— 臂樞軸近旁不滑移
    for (const s2 of [-1, 1]) {
      const pad2 = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), mat(hullDk, { metalness: 0.6 }));
      pad2.scale.set(1.15, 0.75, 1.15);
      pad2.position.set(s2 * 0.63, 1.3, 0.3);
      chest.add(pad2);
    }
    neck.position.set(0, 1.35, 0.35);                                              // 短頸
    // 頸基護頸環:拳擊手護頸(吸收直拳反作用),平端環蓋住圓角胸頂與頭之間的裸接縫
    cyl(chest, 0.2, 0.23, 0.13, 10, 0, 1.28, 0.3, hullDk, { metalness: 0.6 });
    bx(head, 0.4, 0.36, 0.5, 0, 0.27, 0.07, plate, { metalness: 0.6 });            // 頭
    bx(head, 0.26, 0.2, 0.28, 0, 0.19, 0.37, hullDk);                              // 吻部
    for (let i = 0; i < 3; i++)                                                    // 拳擊護顎柵(三根細柱護住吻部下緣)
      cyl(head, 0.018, 0.018, 0.16, 6, (i - 1) * 0.08, 0.07, 0.4, 0xd8dde2, { metalness: 0.85 });
    bx(head, 0.32, 0.09, 0.06, 0, 0.35, 0.31, accent, { emissive: accent, emissiveIntensity: 1.6 });
    bx(head, 0.44, 0.1, 0.1, 0, 0.47, 0.28, hullDk, { metalness: 0.6 });           // 拳擊頭盔眉拱(與護顎柵上下呼應成整套護具)
    for (const sx of [-1, 1]) {                                                    // 長耳
      const ear = bx(head, 0.1, 0.55, 0.16, sx * 0.16, 0.7, -0.03, hull);
      ear.rotation.z = sx * -0.15;
      bx(ear, 0.06, 0.38, 0.03, 0, 0.04, 0.085, dim(accent, 0.45));                // 內耳廓分色(耳兼收訊天線的暗示:內襯=天線面)
    }
    // 拳擊架式:肘恆深屈把拳砲收在胸前,擺動時只小幅開合(不甩大臂);
    // 腕節 = 拳砲本體 —— 前臂是平舉的(幾何沿 +z),樞軸因此要用 piv 落在前臂末端而非 −y
    const mkArm = (sx) => segLimb(chest, [sx * 0.6, 1.15, 0.3], [
      { len: 0.45, draw: (a) => cyl(a, 0.1, 0.11, 0.5, 8, 0, -0.2, 0.05, hull) },
      { len: 0, base: -0.95, k: -0.35, d: 0.3, draw: (a) => {
        cyl(a, 0.11, 0.11, 0.6, 8, 0, -0.08, 0.28, hullDk).rotation.x = Math.PI / 2;   // 前臂平舉(圓柱沿 z)
        // 前臂上側直拳儲能拉簧(與拳砲同軸沿 z)+ 中段簧環:punch 蓄力後收/擊發前突的可見行程
        const dr = cyl(a, 0.02, 0.02, 0.5, 6, 0, 0.05, 0.28, 0xd8dde2, { metalness: 0.9 });
        dr.rotation.x = Math.PI / 2;
        const dc = cyl(a, 0.045, 0.045, 0.03, 8, 0, 0.05, 0.28, 0x23262a, { metalness: 0.8 });
        dc.rotation.x = Math.PI / 2;
      } },
      { piv: [0, -0.08, 0.6], base: 0, k: 0.22, d: 0.6, len: 0, draw: (a) => {
        bx(a, 0.26, 0.28, 0.2, 0, 0, 0.02, joint);                                 // 腕(拳砲基座)
        // 輕/重異型 = 一手一具:左腕 = 5.8 突擊步槍雙管(下插彈匣供彈);
        // 右腕 = 熔核直拳砲(plasma:拳面裝甲 + 磁約束光核 + 熔核導管,貼身直擊)
        if (sx > 0) {
          const fistP = bx(a, 0.32, 0.34, 0.16, 0, 0, 0.16, 0x30373f, { metalness: 0.8 });   // 拳面裝甲
          const core = cyl(a, 0.1, 0.1, 0.07, 8, 0, 0, 0.27, accent, { emissive: accent, emissiveIntensity: 1.2 });
          core.rotation.x = Math.PI / 2;                                           // 磁約束光核(蓄力增亮/擊發強閃)
          const cd1 = bx(a, 0.06, 0.05, 0.34, -0.12, 0.12, 0.0, dim(accent, 0.7),
            { emissive: accent, emissiveIntensity: 0.5 });                          // 熔核導管 ×2
          const cd2 = bx(a, 0.06, 0.05, 0.34, 0.12, 0.12, 0.0, dim(accent, 0.7),
            { emissive: accent, emissiveIntensity: 0.5 });
          heavyRig = {
            glow: [{ mesh: core, base: 1.2 }, { mesh: cd1, base: 0.5 }, { mesh: cd2, base: 0.5 }],
            pivot: [],   // 直拳動態全由 punch 原型(hv.armR 大幅)表現,拳砲不另掛 pivot
          };
          bpMuzH = { n: core, r: 0.12 };
          // rig.wpn heavy:熔核直拳砲散件(拳面裝甲/光核/雙導管)直掛腕節 a → ref=該腕節;
          // 光核 core 在腕節 z=+0.27、拳面 +0.16、導管 0.0 ⇒ 拳面/槍口在 +z 端
          bpWpnH = { nodes: [fistP, core, cd1, cd2], ref: a, muz: core, fwd: 'z' };
        } else {
          // 左腕雙管步槍艙(2026-07-17 槍口朝前化):拳擊架式的前臂上抬(肘 −0.95),
          // 雙管改掛可俯仰槍架 lg —— gunPitch 以 +0.95 抵銷手臂鏈上抬 ⇒ 據槍/行軍槍口
          // 皆水平朝前(腕上迴旋槍座),拳擊護架的剪影不變
          const lg = new THREE.Group();
          lg.position.set(0, 0.02, 0.1);
          lg.rotation.x = 0.95;
          a.add(lg);
          for (const oy of [-0.05, 0.05]) {
            const b = cyl(lg, 0.04, 0.04, 0.3, 6, 0, oy, 0.14, 0x111418, { metalness: 0.85 });
            b.rotation.x = Math.PI / 2;                                            // 雙管步槍艙
          }
          const muz = cyl(lg, 0.06, 0.06, 0.05, 6, 0, 0, 0.32, accent, { emissive: accent, emissiveIntensity: 1.2 });
          muz.rotation.x = Math.PI / 2;
          bx(lg, 0.09, 0.22, 0.13, 0, -0.2, 0.02, 0x23262a, { metalness: 0.7 });   // 下插彈匣(與雙管同軸供彈)
          bx(lg, 0.1, 0.06, 0.14, 0, -0.32, 0.02, dim(accent, 0.8));               // 彈匣底板識別
          bpGunL = { g: lg, rest: 1.0, aim: 0.95 };
          bpLGlow = [{ mesh: muz, base: 1.2 }];   // 左腕槍口(輕武器擊發閃光)
          bpMuzL = { n: muz, r: 0.07 };
          // rig.wpn light:左腕雙管步槍艙單根 lg(雙管/彈匣皆其子節點)→ ref=lg;
          // 槍口環 muz 在 lg 局部 z=+0.32、彈匣 +0.02 ⇒ fwd 'z'
          bpWpnL = { nodes: [lg], ref: lg, muz, fwd: 'z' };
        }
      } },
    ], ca(sx));
    armL = mkArm(-1); armR = mkArm(1);
    // 拳砲戰鬥動畫(punch 原型):蓄力 = 右拳大幅後收蓄勢(chg→+1)、擊發 = 直拳全幅前突(chg 翻 −1);
    // 胸腔取負值 = 蓄力後仰蓄勢、擊發前傾灌拳(follow-through)—— 與 brace 托槍機種方向相反
    bpWeap = { light: 'L', heavy: 'R' };
    bpHvy = { armR: 0.8, armL: 0.15, chest: -0.12 };
    // 著地平衡尾(三節圓柱串接):袋鼠跳躍時尾是第三條腿 —— 前擺蓄力、落地尾梢先觸地卸力
    mkTail(hips, [0, -0.1, -0.3], [[0], [0, -0.65, -1.15], [0, -0.6, -0.75]]);
    const t1 = cyl(tailSegs[0], 0.27, 0.22, 1.5, 10, 0, 0, -0.7, hull);
    t1.rotation.x = Math.PI / 2 - 0.35;
    // 尾根氣簧(「第三條腿」著地尾的緩衝機構):與尾軸同傾沿上緣斜貼,掛尾根節 = 隨甩尾不拉伸
    cyl(tailSegs[0], 0.03, 0.03, 0.6, 6, 0, 0.39, -0.47, 0x2b3138, { metalness: 0.85 }).rotation.x = Math.PI / 2 - 0.35;
    cyl(tailSegs[0], 0.015, 0.015, 0.4, 6, 0, 0.22, -0.94, 0xd8dde2, { metalness: 0.9 }).rotation.x = Math.PI / 2 - 0.35;
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
    heavy: heavyRig,
    weap: bpWeap, hvy: bpHvy, lightGlow: bpLGlow,   // 戰鬥動畫(roo/trex 手持;gorilla 肩扛;其餘機載 'N')
    gunR: bpGunR, gunL: bpGunL, aimPose: bpAim,     // 武器俯仰(gunPitch)+ 戰鬥姿勢(stepBiped aimPose)
    muzzles: { light: bpMuzL, heavy: bpMuzH },      // 槍口錨:曳光起點/槍口焰(makeUnit 掛焰)
    wpn: { light: bpWpnL, heavy: bpWpnH },          // rig.wpn:FPV 武裝同源(契約見 podWeapon 上方)
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
  let heavyRig = { glow: [], pivot: [] };   // 重武器掛點(右臂莢艙泛用;monkey 另補尾砲)
  // 手持武器人形(輕/重異型 → 雙槍):右手輕武器、左手重武器;raptor(2026-07-22)同規則
  // = 右手輕狙 / 左手重狙分持;atlas 武裝在肩架(掛載,非手持;飛行轉到背部)、
  // monkey 掌行(手是前腳)輕武器扛肩(飛行轉到背部)。MUST 與 stepMorph 的 aimM 消費對齊。
  // HOLDGUN(手持機種)飛行型態:雙臂朝航向前伸、槍口朝前射擊(2026-07-17 使用者指示)
  const HANDGUN = G === 'vampire' || G === 'wolf';
  const HOLDGUN = HANDGUN || G === 'raptor';
  let morphGunR = null, morphGunL = null, morphLMuz = null, atlasLGlow = null;
  let morphLGlow = null;                        // 輕武器槍口燈列(獸型/多燈機種覆寫)
  let morphMuzL = null, morphMuzH = null;       // 槍口錨(rig.muzzles:曳光起點/槍口焰)
  let morphWpnL = null, morphWpnH = null;       // rig.wpn(FPV 武裝同源;契約見 podWeapon 上方)
  let morphTailPose = null, morphTailComp = 0;  // 尾砲瞄準前捲(monkey):尾鏈子集 poser + 地面殘餘仰角補償
  let morphTrunkAim = null;                     // 象鼻交戰抬鼻角(levi):[鼻根, 鼻端] 據槍角
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
    raptor: [1.9, 1.25, 0.5, 0.85, 0, -0.65, -1.7, 0.36, 0.4, -0.55, 0.35],   // 前肢短臂(真實馳龍比例:臂 ≈ 腿半長,收在胸前)
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
  // 氣墊登陸艇裙圍(利維坦):腹部下緣四面外傾圍裙板 —— 飛行放平後即朝下的氣墊裙
  if (F === 'levi') {
    const sf = bx(torso, 0.7 * B, 0.35, 0.09, 0, -0.22, 0.5, PAL.deep, { metalness: 0.4 });
    sf.rotation.x = -0.16;                                                              // 前板(收在雙前腿之間,下緣外翻向 +z)
    const sb2 = bx(torso, 1.2 * B, 0.35, 0.09, 0, -0.22, -0.5, PAL.deep, { metalness: 0.4 });
    sb2.rotation.x = 0.16;                                                              // 後板(下緣外翻向 −z)
    for (const sx of [-1, 1]) {
      const ss = bx(torso, 0.09, 0.35, 0.95, sx * 0.78 * B, -0.22, 0, PAL.deep, { metalness: 0.4 });
      ss.rotation.z = sx * 0.16;                                                        // 側板(貼膠囊側腹垂下)
      // 充氣滾邊:氣墊裙下緣的充氣圓管 —— 一條滾邊立刻讀出 hovercraft
      rbz(torso, 0.08, 0.08, 1.0, sx * 0.8 * B, -0.42, 0, PAL.deep, { metalness: 0.4 });
      for (const oz of [-0.28, 0.28]) {
        const rib = bx(torso, 0.03, 0.32, 0.07, sx * 0.82 * B, -0.24, oz, PAL.dark, { metalness: 0.4 });
        rib.rotation.z = sx * 0.16;                                                     // 裙圍分節肋(氣墊裙是分節縫製的)
      }
    }
    // 艉部推進導風扇(靜態槳板,比照 jet 翼下 ALQ-99 前例 —— MUST NOT 進 rotors):
    // 氣墊艇的第一識別;地面藏在象臀後下方、飛行放平後恰好朝後 = 推進器
    cyl(torso, 0.34 * B, 0.34 * B, 0.12, 12, 0, -0.55, -0.5, PAL.deep, { metalness: 0.6 });   // 外框環
    cyl(torso, 0.29 * B, 0.29 * B, 0.05, 12, 0, -0.56, -0.5, 0x1c2126, { metalness: 0.7 });   // 內凹盤
    cyl(torso, 0.06, 0.06, 0.1, 8, 0, -0.52, -0.5, 0x23262a);                                 // 轂
    for (const ry of [0, 1.05]) {
      const bl = bx(torso, 0.52, 0.045, 0.07, 0, -0.54, -0.5, 0x2a2e33, { metalness: 0.7 });
      bl.rotation.y = ry;                                                                     // 靜態槳板(交叉成輻條感)
    }
  }
  bx(torso, 1.45 * B, 1.0, 0.95, 0, 0.82, 0.03, hull, { metalness: 0.6 });             // 胸艙
  bx(torso, 1.0 * B, 0.14, 0.1, 0, 0.95, 0.52, accent, { emissive: accent, emissiveIntensity: 1.1 });  // 胸前識別燈
  if (G === 'vampire') {
    // 貴族胸飾:菱形胸針 + V 形領巾兩斜板(凸出領口艙蓋前面;與胸前識別燈不同高度)
    const br = bx(torso, 0.16, 0.16, 0.07, 0, 1.16, 0.53, accent, { emissive: accent, emissiveIntensity: 1.3 });
    br.rotation.z = Math.PI / 4;
    for (const sx of [-1, 1]) {
      const cv = bx(torso, 0.3 * B, 0.09, 0.06, sx * 0.17 * B, 1.3, 0.5, dim(hull, 0.7));
      cv.rotation.z = sx * -0.5;
    }
    // 禮服雙排釦:吸血鬼貴族 = 雙排釦大衣的正面識別(釦面朝前;
    // 高度全數收在腰部排氣口與胸前識別燈之間,不與兩者打架)
    for (const sx of [-1, 1]) for (const by of [0.48, 0.62, 0.76]) {
      const btn = cyl(torso, 0.03, 0.03, 0.04, 6, sx * 0.14 * B, by, 0.51, dim(accent, 0.9), { metalness: 0.7 });
      btn.rotation.x = Math.PI / 2;
    }
  }
  bx(torso, 0.62 * B, 0.4, 0.24, 0, 1.3, 0.36, dim(hull, 0.85));                       // 領口/艙蓋
  for (const sx of [-1, 1]) bx(torso, 0.18, 0.55, 0.5, sx * 0.62 * B, 0.82, 0.26, dim(hull, 0.8));  // 進氣口
  vent(torso, 0.5 * B, 0.12, 0.1, 0, 0.32, 0.44);                                      // 腰部排氣口
  // 背部推進器(飛行主推;地面朝下 = VTOL 懸停感)
  bx(torso, 0.9 * B, 0.7, 0.35, 0, 0.75, -0.6, hullDk);                                // 背包
  // 搶修械爪(悟空的戰場搶修車機構表徵):摺收貼背包右側(如意棒斜背在左),整組收在背包高度內
  if (WUKONG) {
    const rep = new THREE.Group();
    rep.position.set(0.52 * B, 0.9, -0.66);
    rep.rotation.set(-0.5, 0, 0.35);
    torso.add(rep);
    bx(rep, 0.07, 0.42, 0.07, 0, -0.18, 0, 0x2b3138, { metalness: 0.75 });              // 臂節
    cyl(rep, 0.06, 0.06, 0.08, 8, 0, -0.42, 0, 0x23262a, { metalness: 0.8 });           // 腕座
    for (let i = -1; i <= 1; i++) {
      const fg = bx(rep, 0.03, 0.16, 0.04, i * 0.05, -0.54, 0.02, 0xd8d4c8, { metalness: 0.6 });
      fg.rotation.x = 0.4;                                                              // 三指
    }
  }
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
    // 機身 chine 稜線:F-117/YF-23 的匿蹤第一特徵 —— 把頭部剪面語言接回素膠囊機身;
    // 半沉入膠囊 = 生根,匿蹤原則不發光。m08(camo 同語系)位置壓低 = 貓科低伏
    if (G === 'raptor') for (const sx of [-1, 1]) {
      const ch = bx(torso, 0.05, 0.4, 1.15, sx * 0.74 * B, 0.62, 0, dim(hull, 0.85), { metalness: 0.55 });
      ch.rotation.z = sx * 0.6;
    }
    if (G === 'panther') for (const sx of [-1, 1]) {
      const ch = bx(torso, 0.05, 0.4, 1.1, sx * 0.66 * B, 0.5, -0.05, dim(hull, 0.85), { metalness: 0.5 });
      ch.rotation.z = sx * 0.65;
      // 肩胛甲板(Horizon 獸機語彙):素膠囊出現「肌群分版」;靜掛 torso,前肢在其下方擺動
      const sc = bx(torso, 0.05, 0.4, 0.55, sx * 0.68 * B, 0.95, 0.25, dim(hull, 0.9), { metalness: 0.5 });
      sc.rotation.z = sx * 0.3;
    }
  }
  // 圓角鯨腹(利維坦/巨象):單一膠囊罩住方正胸艙 —— 飛鯨沒有直角;
  // 辨識交由背脊識別條承擔(在膠囊背面之外仍外露),背砲砲架沒入膠囊面內 = 生根不斷
  if (F === 'levi') {
    const bod = new THREE.Mesh(new THREE.CapsuleGeometry(0.62 * B, 1.0, 4, 12), mat(hull, { metalness: 0.55 }));
    bod.scale.set(1.25, 1, 0.85);
    bod.position.set(0, 0.55, 0);
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
  // 夜豹地面頭位前移(局部 +y ≈ 世界前方)讓出可見的頸長 —— 其餘獸型維持原位
  P(head,
    beast ? { p: [0, G === 'panther' ? 1.86 : 1.66, -0.2], r: [0.25 - stance[1], 0, 0] } : { p: [0, 1.6, 0.06], r: [0, 0, 0] },
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
      // 象牙加固環:與牙同軸箍在牙根 —— 機械象牙是「鎖上去的工件」,金屬箍交代安裝方式
      const tring = cyl(head, 0.085, 0.085, 0.06, 8, sx * 0.26 * B, -0.36, 0.2, PAL.deep, { metalness: 0.7 });
      tring.rotation.x = 1.35;
    }
    trunk = new THREE.Group();
    trunk.position.set(0, -0.12, 0.34);
    head.add(trunk);
    P(trunk, { p: null, r: [1.35, 0, 0] }, { p: null, r: [0.12, 0, 0] }, 0.45, 0.9);
    const t1 = cyl(trunk, 0.11 * B, 0.13 * B, 0.68, 9, 0, 0, 0.32, hullDk, { metalness: 0.55 });
    t1.rotation.x = Math.PI / 2;                                                        // 象鼻根段(圓柱節,節身收分)
    cyl(trunk, 0.14 * B, 0.14 * B, 0.09, 9, 0, 0, 0.64, 0x23262a, { metalness: 0.8 })
      .rotation.x = Math.PI / 2;                                                        // 節間關節環(trunkTip 樞軸接點)
    trunkTip = new THREE.Group();
    trunkTip.position.set(0, 0, 0.64);
    trunk.add(trunkTip);
    P(trunkTip, { p: null, r: [0.7, 0, 0] }, { p: null, r: [0.05, 0, 0] }, 0.5, 0.95);
    const t2 = cyl(trunkTip, 0.08 * B, 0.11 * B, 0.5, 9, 0, 0, 0.26, 0x2a2e33, { metalness: 0.7 });
    t2.rotation.x = Math.PI / 2;                                                        // 象鼻端段(圓柱節)
    const ram = new THREE.Mesh(new THREE.ConeGeometry(0.12 * B, 0.26, 8), mat(0x2a2e33, { metalness: 0.85 }));
    ram.rotation.x = Math.PI / 2;
    ram.position.set(0, 0, 0.56);
    trunkTip.add(ram);                                                                  // 破城錘頭(飛行收平 = 船首撞角;鼻端槍口 z 0.82 仍凸出錘尖)
    cyl(trunkTip, 0.1 * B, 0.1 * B, 0.05, 8, 0, 0, 0.4, accent, { emissive: accent, emissiveIntensity: 0.7 })
      .rotation.x = Math.PI / 2;                                                        // 錘底識別環(供彈環匣與錘頭之間,不箍槍口段)
  } else if (F === 'archo') {
    // 迅猛龍顱 ↔ 始祖鳥:楔形吻 + 齒列 + 後掠羽冠
    bx(head, 0.4 * B, 0.34, 0.4, 0, 0.06, 0, plate, { metalness: 0.5 });                // 顱殼
    bx(head, 0.26 * B, 0.2, 0.55, 0, -0.02, 0.42, hullDk);                              // 楔形吻
    bx(head, 0.07 * B, 0.05, 0.5, 0, 0.09, 0.42, dim(hullDk, 0.85), { metalness: 0.6 });  // 鼻樑稜脊(匿蹤多面體吻)
    for (const sx of [-1, 1]) {
      const fp = bx(head, 0.05, 0.16, 0.48, sx * 0.13 * B, 0.02, 0.42, dim(hullDk, 0.92), { metalness: 0.6 });
      fp.rotation.z = sx * 0.55;                                                        // 兩側斜切面板(F-117 式剪面)
    }
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
    const nk = cyl(head, 0.12 * B, 0.16 * B, 0.58, 10, 0, -0.38, -0.1, hullDk, { metalness: 0.55 });
    nk.rotation.x = -0.22;                                                              // 頸筒(圓柱,根粗梢細)
    const nr = cyl(head, 0.17 * B, 0.17 * B, 0.08, 10, 0, -0.64, -0.16, 0x23262a, { metalness: 0.7 });
    nr.rotation.x = -0.22;                                                              // 頸根關節環(貼肩)
    // 頜下 EO 感測窗(F-35 EOTS 語彙):匿蹤偵獵機「安靜地看」的視覺錨,吻尖正下方(不發光)
    bx(head, 0.08 * B, 0.04, 0.1, 0, -0.16, 0.6, 0x0e1114, { metalness: 0.3 });
    // 頸側短羽:頭→肩的羽毛過渡,補頸筒的裸露接縫(隨 head 補償運動,片短不掃肩)
    for (const sx of [-1, 1])
      feather(head, 0.26, 0.07, sx * 0.1 * B, -0.32, -0.2, 1.4, sx, dim(plate, 0.7), { metalness: 0.3 });
  } else if (F === 'beetle') {
    // 犀金龜:小顱 + Y 形犀角(地面衝角 / 飛行破風桅)
    bx(head, 0.36 * B, 0.3, 0.36, 0, 0.02, 0.04, plate, { metalness: 0.6 });            // 顱殼
    bx(head, 0.3 * B, 0.08, 0.06, 0, 0.06, 0.24, accent, { emissive: accent, emissiveIntensity: 1.5 });  // 複眼列
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.09 * B, 1.05, 6), mat(0x2a2e33, { metalness: 0.7 }));
    horn.position.set(0, 0.44, 0.32);
    horn.rotation.x = 0.9;
    head.add(horn);
    // 犀角基座裝甲:角根加粗一圈,剪影從「天線」變「衝角」;也交代角是鎖上去的工件
    const hbase = cyl(head, 0.12 * B, 0.15 * B, 0.18, 8, 0, 0.3, 0.17, PAL.deep, { metalness: 0.6 });
    hbase.rotation.x = 0.9;
    // 雙 35 搖架側板:快砲要有俯仰搖架 —— 側板把「槍浮在頭上」變「砲裝在座圈上」;
    // 掛 head 本體(非 wpn 節點 ⇒ FPV 不複製:它是機體側機構不是武器),與槍管留淨距
    for (const sx of [-1, 1])
      bx(head, 0.04, 0.16, 0.44, sx * 0.27 * B, 0.12, 0.18, PAL.deep, { metalness: 0.7 });
    bx(head, 0.36 * B, 0.06, 0.16, 0, 0.84, 0.62, 0x2a2e33, { metalness: 0.7 });        // 角端分叉
    bx(head, 0.06, 0.32, 0.16, 0, 0.84, 0.62, 0x2a2e33, { metalness: 0.7 });            // 角端豎刃(與橫刃交叉成十字分叉)
    const hs = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), mat(accent, { emissive: accent, emissiveIntensity: 1.0 }));
    hs.position.set(0, 0.84, 0.62);
    head.add(hs);                                                                        // 分叉中心測距感測點
    // 前胸背板短角(掛 torso 不掛 head —— 真獨角仙的胸角長在前胸背板,不隨頭動);
    // -0.3 已含體軸放平補償(θg 1.45)→ 世界座標指前上,與頭上長角構成雙角剪影
    const phorn = new THREE.Mesh(new THREE.ConeGeometry(0.07 * B, 0.5, 6), mat(0x2a2e33, { metalness: 0.7 }));
    phorn.position.set(0, 1.3, 0.44);
    phorn.rotation.x = -0.3;
    torso.add(phorn);
  } else if (F === 'owl') {
    // 夜豹顱 ↔ 夜梟面盤:圓吻 + 立耳 + 面盤環 + 大眼
    bx(head, 0.46 * B, 0.36, 0.42, 0, 0.05, 0, plate, { metalness: 0.5 });              // 顱殼
    bx(head, 0.26 * B, 0.16, 0.2, 0, -0.06, 0.28, hullDk);                              // 圓吻
    const disc = cyl(head, 0.3 * B, 0.3 * B, 0.05, 12, 0, 0.08, 0.16, dim(plate, 0.75));
    disc.rotation.x = Math.PI / 2;                                                       // 面盤(貼臉淺盤)
    const ruff = cyl(head, 0.33 * B, 0.33 * B, 0.03, 14, 0, 0.08, 0.13, dim(plate, 0.62));
    ruff.rotation.x = Math.PI / 2;                                                       // 面盤羽緣(ruff):外圈深色一環把「梟臉」對比拉滿
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.6 }));
      eye.position.set(sx * 0.14 * B, 0.12, 0.24);
      head.add(eye);
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.28, 5), mat(hullDk, { metalness: 0.5 }));
      ear.position.set(sx * 0.18 * B, 0.32, -0.05);
      ear.rotation.x = -0.35;
      head.add(ear);
    }
    // 頸(圓柱):夜豹本無頸,補上 —— 自顱底向後下方伸向肩部,銜接頭與軀幹(頭已 −1.05 前傾 ⇒
    // 局部 −y 指向身體;根粗梢細,尾端關節環貼合肩部)
    const nk = cyl(head, 0.15 * B, 0.21 * B, 0.86, 10, 0, -0.44, -0.16, hullDk, { metalness: 0.55 });
    nk.rotation.x = -0.3;
    cyl(head, 0.22 * B, 0.22 * B, 0.09, 10, 0, -0.85, -0.34, 0x23262a, { metalness: 0.7 }).rotation.x = -0.3;  // 頸根關節環
    // 頸背疊瓦鱗甲:梟的頸羽↔豹的頸背肌 —— 疊瓦板蓋住頸筒與頭殼的接縫(匿蹤不發光)
    for (let i = 0; i < 3; i++) {
      const scale = bx(head, (0.3 - i * 0.03) * B, 0.16, 0.05, 0, -0.25 - i * 0.2, -0.1 - i * 0.06,
        dim(plate, i === 1 ? 0.7 : 0.9));
      scale.rotation.x = -0.3;                                                           // 貼頸背斜度
    }
  } else {
    bx(head, 0.56 * B, 0.4, 0.52, 0, 0.06, 0, hullDk);                                  // 機甲頭
    bx(head, 0.42 * B, 0.11, 0.08, 0, 0.1, 0.29, accent, { emissive: accent, emissiveIntensity: 1.5 });  // 面罩感測條
    bx(head, 0.2 * B, 0.1, 0.1, 0, -0.12, 0.26, 0x23262a);                              // 下顎
    if (G === 'wolf') {
      // 狼人頭部輪廓:長口鼻狼吻 + 鼻端 + 上齒列 + 後掠雙立耳(耳短且後掠 ——
      // 飛行縮頭時要收得進機首錐滑出路徑)
      bx(head, 0.24 * B, 0.2, 0.44, 0, -0.04, 0.5, hull, { metalness: 0.5 });            // 狼吻
      bx(head, 0.14 * B, 0.1, 0.1, 0, 0.0, 0.74, 0x23262a);                              // 鼻端
      bx(head, 0.2 * B, 0.04, 0.3, 0, -0.14, 0.52, 0xd8d4c8, { metalness: 0.6 });        // 上齒列
      bx(head, 0.18 * B, 0.04, 0.26, 0, -0.19, 0.5, 0xd8d4c8, { metalness: 0.6 });       // 下齒列(上下錯開 0.05 = 咬合縫,張嘴獠牙的錯覺)
      // 眉稜甲:狼人臉的兇相由眉稜決定 —— 面罩條是「機器人臉」,怒眉才是「狼臉」
      for (const sx of [-1, 1]) {
        const brow = bx(head, 0.18 * B, 0.05, 0.14, sx * 0.14 * B, 0.2, 0.26, plate, { metalness: 0.6 });
        brow.rotation.x = -0.2;
        brow.rotation.z = sx * -0.15;                                                    // 內高外低
      }
      for (const sx of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 5), mat(plate, { metalness: 0.5 }));
        ear.position.set(sx * 0.2 * B, 0.3, -0.06);
        ear.rotation.x = -0.5;
        head.add(ear);                                                                    // 後掠立耳
      }
    }
    if (G === 'vampire') {
      // 德古拉頭部輪廓:額心尖突(widow's peak)+ 兩側後掠鬢角板(貼頭殼外側面)
      const wp = bx(head, 0.1 * B, 0.22, 0.06, 0, 0.17, 0.24, plate, { metalness: 0.6 });
      wp.rotation.x = -0.3;
      for (const sx of [-1, 1]) {
        const sb = bx(head, 0.06, 0.3, 0.3, sx * 0.29 * B, 0.05, -0.1, plate, { metalness: 0.6 });
        sb.rotation.x = -0.35;
      }
      // 單片眼鏡:圈住右眼段的環面 = 吸血鬼伯爵臉部的一筆剪影(純識別燈,不進 glows)
      const mono = cyl(head, 0.1, 0.1, 0.035, 10, 0.14 * B, 0.1, 0.31, accent, { emissive: accent, emissiveIntensity: 0.4 });
      mono.rotation.x = Math.PI / 2;
    }
  }

  // ---- 四足獸地面型武裝(2026-07-16;掛點對齊 GUN_MOUNT:elephant/raptor/beetle = mouth、
  // panther = back)。輕/重同型 = 一管雙模(對照 hound/centaur 語彙)、異型 = 兩具分開;
  // 供彈結構與槍管同軸。獸型不再共用右臂泛用莢(那是把武器長在前腳上)----
  if (beast) {
    if (F === 'levi') {
      // 輕武器(FN MAG 通用機槍,gun):象鼻端管 —— 鼻端嘴砲,隨象鼻逐幀擺動;供彈環匣沿鼻軸
      const tg = cyl(trunkTip, 0.05, 0.056, 0.55, 6, 0, -0.05, 0.52, 0x111418, { metalness: 0.85 });
      tg.rotation.x = Math.PI / 2;
      const eFeed = cyl(trunkTip, 0.085, 0.085, 0.2, 8, 0, -0.05, 0.28, 0x23262a, { metalness: 0.7 });  // 供彈環匣
      eFeed.rotation.x = Math.PI / 2;
      const eMuz = cyl(trunkTip, 0.07, 0.07, 0.05, 6, 0, -0.05, 0.82, accent, { emissive: accent, emissiveIntensity: 0.8 });
      eMuz.rotation.x = Math.PI / 2;
      morphLGlow = [{ mesh: eMuz, base: 0.8 }];
      morphMuzL = { n: eMuz, r: 0.08 };
      // rig.wpn light:象鼻端散件(管身/供彈環匣/槍口環)掛 trunkTip → ref=trunkTip;
      // 槍口環 eMuz 在 trunkTip z=+0.82、環匣 +0.28 ⇒ 槍口在 +z 端
      morphWpnL = { nodes: [tg, eFeed, eMuz], ref: trunkTip, muz: eMuz, fwd: 'z' };
      // 象鼻交戰抬鼻(2026-07-22 規則 1):行軍鼻管下垂 → 靜止/開火保持抬到水平朝前。
      // 地面累積俯仰 = torso θg + head (0.25−θg) = 0.25 恆定 ⇒ 鼻根/鼻端合計 −0.25 抵銷
      // (stepMorph 以 aimF×(1−m) 混成;飛行由 pose 收平 = 船首撞角,不吃這組)
      morphTrunkAim = [-0.15, -0.1];
      // 重武器(重型線圈加農砲,rail;charge 1.8s 最長蓄力):背載大線圈砲 —— 砲架生根背脊、
      // 線圈環蓄力增亮、蓄力砲身上仰瞄準/擊發反向坐底(戰艦主砲式跨頭前伸)
      const cc = new THREE.Group();
      cc.position.set(0, 0.15, -0.6 * B);
      cc.rotation.x = 0.28;   // 補償巨象地面站姿的體軸殘餘上仰(~21°)→ 砲管近水平前指
      torso.add(cc);
      bx(cc, 0.5 * B, 0.55, 0.36, 0, 0.1, 0.16, 0x2b3138, { metalness: 0.7 });   // 砲架(生根背脊)
      bx(cc, 0.42 * B, 0.9, 0.46, 0, 0.55, 0.02, hullDk, { metalness: 0.7 });    // 電容機匣
      cyl(cc, 0.11, 0.13, 2.2, 10, 0, 1.85, 0, 0x1a1d20, { metalness: 0.85 });   // 加速砲身(+y 前向)
      const eCoils = [];
      for (const oy of [1.15, 1.8, 2.45]) {
        const c = cyl(cc, 0.2, 0.2, 0.09, 10, 0, oy, 0, accent, { emissive: accent, emissiveIntensity: 0.6 });
        eCoils.push({ mesh: c, base: 0.6 });
      }
      const eHMuz = cyl(cc, 0.14, 0.14, 0.06, 10, 0, 2.98, 0, accent, { emissive: accent, emissiveIntensity: 0.7 });
      heavyRig = {
        glow: [...eCoils, { mesh: eHMuz, base: 0.7 }],
        pivot: [{ obj: cc, rest: { x: 0.28, y: 0, z: 0 }, deploy: { x: 0.16, y: 0, z: 0 } }],
      };
      morphMuzH = { n: eHMuz, r: 0.15 };
      // rig.wpn heavy:背載線圈砲單根 cc(砲架/機匣/線圈/膛口皆其子節點)→ ref=cc;
      // 膛口 eHMuz 在 cc 局部 y=+2.98、機匣 +0.55(加速砲身 +y 前向)⇒ fwd 'y'
      morphWpnH = { nodes: [cc], ref: cc, muz: eHMuz, fwd: 'y' };
    } else if (F === 'archo') {
      // 迅猛龍雙模狙擊(輕/重同型 gun×gun):2026-07-17 自嘴砲移到雙手 ——
      // 雙手托一把切換兩模式(同型 = 雙手一把的文件規則),建模住 mkArm 的 raptor 分支
    } else if (F === 'beetle') {
      // 輕武器(雙 35 快砲,gun):犀角兩側並列雙管 + 共構機匣(頸背彈鏈供彈)
      morphLGlow = [];
      const beetleLN = [];   // rig.wpn 節點集:雙 35 快砲散件(掛 head)
      for (const s2 of [-1, 1]) {
        const b35 = cyl(head, 0.05, 0.055, 0.85, 6, s2 * 0.2 * B, 0.12, 0.45, 0x111418, { metalness: 0.85 });
        b35.rotation.x = Math.PI / 2;
        const m35 = cyl(head, 0.07, 0.07, 0.05, 6, s2 * 0.2 * B, 0.12, 0.9, accent, { emissive: accent, emissiveIntensity: 0.8 });
        m35.rotation.x = Math.PI / 2;
        morphLGlow.push({ mesh: m35, base: 0.8 });
        if (s2 > 0) morphMuzL = { n: m35, r: 0.08 };
        beetleLN.push(b35, m35);
      }
      beetleLN.push(bx(head, 0.52 * B, 0.16, 0.3, 0, 0.12, 0.04, 0x23262a, { metalness: 0.7 }));        // 共構機匣
      beetleLN.push(bx(head, 0.22 * B, 0.12, 0.22, 0, 0.06, -0.2, hullDk, { metalness: 0.6 }));         // 彈鏈供彈匣(頸背)
      // rig.wpn light:散件掛 head → ref=head;槍口環 m35 在 head z=+0.9、機匣 +0.04 ⇒ 槍口在 +z 端(已驗證)
      morphWpnL = { nodes: beetleLN, ref: head, muz: morphMuzL.n, fwd: 'z' };
      // 重武器(區域拒止電漿陣列,plasma;GUN_MOUNT 強制 mouth):顎下三噴口陣 + 磁約束光核 + 燃料罐
      const bCores = [];
      const beetleHN = [];   // rig.wpn 節點集:電漿三噴口陣散件(掛 head)
      for (const ox of [-0.12, 0, 0.12]) {
        const bNoz = cyl(head, 0.045, 0.06, 0.3, 8, ox * B, -0.16, 0.3, 0x1c2126, { metalness: 0.8 });
        bNoz.rotation.x = Math.PI / 2;
        const core = cyl(head, 0.05, 0.05, 0.05, 8, ox * B, -0.16, 0.48, accent, { emissive: accent, emissiveIntensity: 1.0 });
        core.rotation.x = Math.PI / 2;
        bCores.push({ mesh: core, base: 1.0 });
        beetleHN.push(bNoz, core);
      }
      const bTank = new THREE.Mesh(new THREE.CapsuleGeometry(0.1 * B, 0.3, 4, 8),
        mat(dim(accent, 0.75), { emissive: accent, emissiveIntensity: 0.4 }));
      bTank.rotation.x = Math.PI / 2;
      bTank.position.set(0, -0.3, 0.0);
      head.add(bTank);                                                                    // 燃料罐(沿噴軸後掛)
      beetleHN.push(bTank);
      heavyRig = { glow: [...bCores, { mesh: bTank, base: 0.4 }], pivot: [] };
      morphMuzH = { n: bCores[1].mesh, r: 0.1 };
      // rig.wpn heavy:散件掛 head → ref=head;光核 core 在 head z=+0.48、噴口 +0.3、燃料罐 0.0
      // ⇒ 噴發方向在 +z 端(已驗證)
      morphWpnH = { nodes: beetleHN, ref: head, muz: bCores[1].mesh, fwd: 'z' };
    } else {
      // owl/panther:背載消音狙擊(輕/重同型 gun×gun = 一管雙模)—— 低伏槍架貼背
      // (夜豹匍匐剪影):消音精準段(VSS)+ 反器材長管段(AMR)+ 瞄準鏡;
      // 支柱生根背脊,蓄力槍身上仰瞄準/擊發反向後坐
      const pg = new THREE.Group();
      pg.position.set(0.16 * B, 0.5, -0.5 * B);
      torso.add(pg);
      bx(pg, 0.16, 0.3, 0.24, 0, -0.05, 0.12, 0x2b3138, { metalness: 0.7 });   // 支柱(生根背脊)
      bx(pg, 0.2, 0.7, 0.26, 0, 0.35, 0, 0x23262a, { metalness: 0.75 });       // 機匣(沿 +y 前向)
      bx(pg, 0.12, 0.3, 0.16, 0, 0.05, -0.18, 0x2b3138, { metalness: 0.7 });   // 彈匣(後下插)
      cyl(pg, 0.045, 0.05, 1.3, 6, 0, 1.3, 0, 0x111418, { metalness: 0.85 });  // 槍管
      cyl(pg, 0.08, 0.08, 0.5, 8, 0, 1.0, 0, 0x30373f, { metalness: 0.75 });   // 消音套筒(輕模式)
      const pLMuz = cyl(pg, 0.085, 0.085, 0.05, 8, 0, 1.28, 0, accent, { emissive: accent, emissiveIntensity: 0.7 });
      cyl(pg, 0.07, 0.07, 0.3, 8, 0, 1.93, 0, 0x14171a, { metalness: 0.8 });   // 加長消音筒(重模式:套住長管末段,止於 2.08 讓槍口燈環外露)
      cyl(pg, 0.075, 0.075, 0.04, 8, 0, 2.08, 0, 0x23262a, { metalness: 0.8 });  // 筒口端面環
      const pHMuz = cyl(pg, 0.055, 0.055, 0.04, 6, 0, 2.12, 0, accent, { emissive: accent, emissiveIntensity: 0.7 });
      cyl(pg, 0.05, 0.05, 0.4, 8, 0, 0.5, -0.16, 0x0e1114, { metalness: 0.8 });  // 瞄準鏡筒(背側)
      heavyRig = {
        glow: [{ mesh: pHMuz, base: 0.7 }],
        pivot: [{ obj: pg, rest: { x: 0, y: 0, z: 0 }, deploy: { x: -0.08, y: 0, z: 0 } }],
      };
      morphLGlow = [{ mesh: pLMuz, base: 0.7 }];
      morphMuzL = { n: pLMuz, r: 0.09 };
      morphMuzH = { n: pHMuz, r: 0.07 };
      // rig.wpn:同型一管雙模單根 pg(機匣沿 +y 前向)→ 同一組 nodes/ref,只有 muz 不同;
      // 兩模膛口在 pg 局部 +y 端(pLMuz y=1.28、pHMuz y=2.12,機匣 +0.35)⇒ fwd 'y'
      const pgNodes = [pg];
      morphWpnL = { nodes: pgNodes, ref: pg, muz: pLMuz, fwd: 'y' };
      morphWpnH = { nodes: pgNodes, ref: pg, muz: pHMuz, fwd: 'y' };
    }
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
      // 翼端三指翼爪(始祖鳥腕爪):錨在腕點前緣、隨腕節收展 —— 收翼時折回貼背不刺出剪影
      for (let i = -1; i <= 1; i++) {
        const cw = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.16, 5), mat(0xd8d4c8, { metalness: 0.6 }));
        cw.position.set(sgn * span * 0.08, 0.02, 0.12 + i * 0.05);
        cw.rotation.set(1.35, sgn * (0.25 + i * 0.18), 0);
        outer.add(cw);
      }
      flapWings.push({ w, outer, sgn });
    } else if (F === 'owl') {
      // 夜梟羽翼(2026-07-12 羽化):寬圓消音羽的放射扇 —— 羽片寬、深淺交錯
      // (鋸齒消音的錯層),同樣自翼根/腕點向外後方張開
      bx(w, span * 0.4, 0.06, 0.24, sgn * span * 0.2, 0.01, 0.05, plate, { metalness: 0.35 });  // 翼骨前緣
      for (let k = 0; k < 5; k++) {                                                     // 內翼前緣鋸齒梳(夜梟無聲飛行的第一機構,尖齒朝前)
        const st = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.09, 3), mat(dim(plate, 0.7), { metalness: 0.3 }));
        st.position.set(sgn * span * (0.06 + k * 0.085), 0.02, 0.18);
        st.rotation.x = Math.PI / 2;
        w.add(st);
      }
      for (let i = 0; i < 3; i++)
        feather(w, span * (0.32 - i * 0.03), 0.24, sgn * 0.04, -0.01 - i * 0.012, -0.04 - i * 0.06,
          0.32 + i * 0.22, sgn, i % 2 ? dim(plate, 0.72) : dim(plate, 0.95), { metalness: 0.3 });
      for (let i = 0; i < 5; i++)
        feather(outer, span * (0.4 - i * 0.03), 0.2, 0, i * 0.012, -0.03 - i * 0.03,
          0.22 + i * 0.22, sgn, i === 2 ? accent : i % 2 ? 0x2a2e33 : dim(plate, 0.8), { metalness: 0.3 });
      for (let k = 0; k < 4; k++) {                                                     // 外翼前緣鋸齒(沿首羽掠線佈齒 —— 放射扇的前緣是斜線)
        const st = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.08, 3), mat(dim(plate, 0.7), { metalness: 0.3 }));
        st.position.set(sgn * span * (0.05 + k * 0.08), 0.02, -0.03 - span * (0.05 + k * 0.08) * 0.22);
        st.rotation.x = Math.PI / 2;
        outer.add(st);
      }
      for (let k = 0; k < 3; k++)                                                       // 後緣絨羽毛邊(消音第三筆:小羽片自翼根後緣近乎純後向張出)
        feather(w, span * 0.1, 0.05, sgn * span * (0.1 + k * 0.1), -0.02, -0.16, 1.25 + k * 0.08, sgn, dim(plate, 0.6), { metalness: 0.1 });
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
      if (F === 'jet') {
        // 翼尖 ALQ-218 接收莢:細長圓筒莢艙 + 前後尖錐收口 —— 電戰機的翼端識別
        const p218 = cyl(outer, 0.07, 0.07, 0.6, 8, sgn * span * 0.44, -0.02, -0.06, PAL.dark, { metalness: 0.7 });
        p218.rotation.x = Math.PI / 2;                                                    // 莢體沿 z
        const pcF = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 8), mat(0x23262a, { metalness: 0.7 }));
        pcF.position.set(sgn * span * 0.44, -0.02, 0.32);
        pcF.rotation.x = Math.PI / 2;
        outer.add(pcF);                                                                   // 前尖錐
        const pcB = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 8), mat(0x23262a, { metalness: 0.7 }));
        pcB.position.set(sgn * span * 0.44, -0.02, -0.44);
        pcB.rotation.x = -Math.PI / 2;
        outer.add(pcB);                                                                   // 後尖錐
        const r218 = cyl(outer, 0.075, 0.075, 0.04, 8, sgn * span * 0.44, -0.02, 0.1, accent, { emissive: accent, emissiveIntensity: 0.6 });
        r218.rotation.x = Math.PI / 2;                                                    // 莢中段識別環
        // 翼下 ALQ-99 干擾吊艙:腹鰭式吊艙 + 前端衝壓空氣渦輪(靜態槳板,純裝飾幾何 ——
        // MUST NOT push 進 rotors:定翼機無旋翼,進了就會被 locomotion 轉起來)
        const jam = cyl(w, 0.09, 0.09, 0.72, 8, sgn * span * 0.18, -0.13, -0.08, hullDk, { metalness: 0.6 });
        jam.rotation.x = Math.PI / 2;                                                     // 吊艙本體
        const rat = cyl(w, 0.045, 0.045, 0.06, 6, sgn * span * 0.18, -0.13, 0.32, 0x23262a, { metalness: 0.8 });
        rat.rotation.x = Math.PI / 2;                                                     // 衝壓渦輪轂
        for (let k = 0; k < 3; k++) {
          const bl = bx(w, 0.02, 0.13, 0.03, sgn * span * 0.18, -0.13, 0.35, 0x2a2e33, { metalness: 0.7 });
          bl.rotation.z = k * 2.094;                                                      // 三片靜態槳板
        }
        const jr = cyl(w, 0.095, 0.095, 0.04, 8, sgn * span * 0.18, -0.13, -0.42, accent, { emissive: accent, emissiveIntensity: 0.6 });
        jr.rotation.x = Math.PI / 2;                                                      // 吊艙尾端識別環
      }
    }
  }

  // ---- 腹鰭(利維坦):腹面 = 軀幹局部 +z(飛行時 torso 以 cruise 放平 → +z 朝下)。
  // 地面收貼腹甲(象腹的護板)→ 飛行外張下探成縱向穩定鰭 ----
  if (F === 'levi') for (const sgn of [-1, 1]) {
    const vf = new THREE.Group();
    vf.position.set(sgn * 0.38 * B, 0.3, 0.6);   // 錨點貼鯨腹膠囊腹面(地面收貼的腹鰭不被膠囊吞沒)
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
    // Skyguard 射控雷達(前胸背板中線,鞘翅根之前):區域防空陣地必有的「眼」。
    // 2026-07-22 放大 28% 並整組移到腹殼圓頂「上」表面(局部 −z = 世界上)——
    // 原座標整組埋在腹殼膠囊裡看不見,撐不起「防空陣地」
    const rmast = cyl(torso, 0.15 * B, 0.2 * B, 0.2, 10, 0, 1.38, -0.42, PAL.dark, { metalness: 0.7 });
    rmast.rotation.x = -1.25;                                                             // 雷達座(≈ 世界豎直,根部生根圓頂)
    const dish = cyl(torso, 0.23 * B, 0.23 * B, 0.04, 12, 0, 1.47, -0.6, plate, { metalness: 0.6 });
    dish.rotation.x = -0.5;                                                               // 淺盤(經 θg 放平後盤面世界朝前上)
    const dc = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), mat(accent, { emissive: accent, emissiveIntensity: 1.2 }));
    dc.position.set(0, 1.52, -0.63);
    torso.add(dc);                                                                        // 盤心饋源點
    // IFF 敵我識別天線列:雷達旁的天線排是真實 Skyguard 陣地配置
    // (短桿,MUST NOT 加長撐 bbox;根部沉入殼面、梢端低於背脊識別條)
    for (let k = 0; k < 3; k++) {
      const iff = cyl(torso, 0.012, 0.012, 0.24, 4, -(0.24 + k * 0.06) * B, 1.36 - k * 0.06, -0.42, PAL.deep, { metalness: 0.7 });
      iff.rotation.x = -1.25;                                                             // ≈ 世界豎直
    }
    // 鞘翅小盾片(scutellum):鞘翅基部的三角小盾是甲蟲背面解剖的必備件;
    // 固定件不隨 ely 動 = 正確(真蟲小盾片不動);貼圓頂上表面微凸出
    const scu = bx(torso, 0.16 * B, 0.14, 0.05, 0, 1.35, -0.575, PAL.deep, { metalness: 0.5 });
    scu.rotation.z = Math.PI / 4;
    // 彈艙門板:雙 35 的供彈在頸背 —— 艙門分割線交代彈鏈從哪來
    // (移到頭後前圓頂兩翼:背側被鞘翅整片蓋住,只有這裡露得出艙門)
    for (const sx of [-1, 1]) {
      const door = bx(torso, 0.16 * B, 0.34, 0.025, sx * 0.22 * B, 1.5, -0.48, dim(hull, 0.8), { metalness: 0.5 });
      door.rotation.y = sx * 0.35;                                                        // 貼圓頂弧面外傾
    }
    for (const sgn of [-1, 1]) {
      const ely = new THREE.Group();
      ely.position.set(sgn * 0.1 * B, 1.3, -0.52);
      torso.add(ely);
      P(ely, { p: null, r: [0, 0, sgn * 0.08] }, { p: null, r: [-0.5, sgn * 0.7, sgn * 1.5] }, 0.15, 0.5);
      const sh = new THREE.Mesh(new THREE.CapsuleGeometry(0.31 * B, 0.9, 4, 10), mat(plate, { metalness: 0.65 }));
      sh.scale.set(1, 1, 0.24);
      sh.position.set(sgn * 0.28 * B, -0.68, 0);
      ely.add(sh);                                                                        // 圓角盾狀鞘翅
      for (let k = 0; k < 3; k++)                                                         // 鞘翅縱溝(甲蟲翅鞘的縱向刻紋,隨鞘翅開闔)
        bx(ely, 0.03, 1.05, 0.02, sgn * (0.14 + k * 0.11) * B, -0.66, 0.1, dim(plate, 0.78), { metalness: 0.6 });
      // 鞘翅中縫條:閉合時左右兩條沿背中線脊夾出鞘翅縫(elytral suture)= 甲蟲識別第一線條;
      // 掛 ely 隨 P poser 開閉。騎在鞘翅「上」面內緣(ely 局部 −z = 世界上;+z 是腹側看不見)
      bx(ely, 0.03, 1.05, 0.035, sgn * 0.12, -0.66, -0.11, PAL.deep, { metalness: 0.5 });
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
    const mastRoot = mkRotor(torso, [0, 1.75, -0.45], [-1.2, 0, 0], [-cruise, 0, 0],
      3, 1.0 * (0.9 + 0.1 * B), 1, 0.5);
    // 桅頂防撞燈(航空慣例白;純識別燈不進 glows/rotors,低於槳轂底不被槳葉掃到)
    bx(mastRoot, 0.05, 0.05, 0.05, 0, 0.22, 0.1, 0xf5f2e8, { emissive: 0xf5f2e8, emissiveIntensity: 1.0 });
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
    // 身體圓角化的機種(甲蟲/迅猛龍/夜豹/巨象)四肢一律圓柱化(CYLG = 粗細倍率;
    // 巨象是 AT-AT 式柱狀直腿 —— 粗圓柱配近打直的關節)
    const CYLG = { beetle: 1, raptor: 1.35, panther: 1.35, elephant: 1.7 }[G];
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
    // —— 家族專屬腿部機能件(掛股/脛節點隨步態動;皆非 wpn 節點)——
    if (G === 'elephant') {
      // 後腿膝液壓缸(AT-AT 式柱腿的重機液壓;單端錨 + 斜置 —— 膝每幀屈伸,雙錨會被拉伸):
      // 缸體錨股節、亮色桿芯錨脛節,屈膝時缸/芯自然錯動;膝縫再套防塵罩環
      const hyd = cyl(leg, 0.05, 0.05, 0.55, 6, 0, -0.5, -0.34, 0x30373f, { metalness: 0.85 });
      hyd.rotation.x = 0.3;
      const rod = cyl(shin, 0.03, 0.03, 0.35, 6, 0, -0.12, -0.3, 0xd8d4c8, { metalness: 0.9 });
      rod.rotation.x = 0.28;
      cyl(shin, 0.19 * B, 0.21 * B, 0.18, 10, 0, 0.03, 0, PAL.deep, { metalness: 0.35 });   // 膝防塵罩環
    } else if (G === 'raptor') {
      // 脛節鱗甲板:馳龍跗蹠的角質鱗片 = 疊瓦裝甲(Horizon 獸機腿甲語彙),隨膝屈伸
      const s1 = bx(shin, 0.16 * B, 0.3, 0.05, 0, -0.25, 0.2, dim(hullDk, 0.9), { metalness: 0.5 });
      s1.rotation.x = -0.08;
      const s2 = bx(shin, 0.14 * B, 0.26, 0.05, 0, -0.55, 0.18, dim(hullDk, 0.75), { metalness: 0.5 });
      s2.rotation.x = -0.08;
    } else if (G === 'wolf') {
      // 跟腱桿:趾行「跟骨懸空」全靠跟腱 —— 亮色桿芯把後距突的力學交代完整
      // (單端錨 shin;踝每幀 ±0.4 屈伸,雙錨會被拉伸,下端懸空近踝即可)
      const ten = cyl(shin, 0.028, 0.028, 0.5, 6, 0, -0.55, -0.3, 0xd8d4c8, { metalness: 0.9 });
      ten.rotation.x = -0.12;
    } else if (G === 'panther') {
      // 髖部甲板:豹後腿發力肌群的甲板化(掛股節隨步態擺動不穿模;匿蹤不發光)
      bx(leg, 0.05, 0.55, 0.45, sx * 0.2 * B, -0.35, 0.08, dim(hull, 0.8), { metalness: 0.5 });
    }
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
      for (const ox of [-1, 1]) {                                                        // 脛端距刺(昆蟲後足的掘地距,錐尖朝後下)
        const spur = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.16, 4), mat(0x2a2e33, { metalness: 0.6 }));
        spur.position.set(ox * 0.07 * B, 0.04, -0.08);
        spur.rotation.x = -2.8;
        ankle.add(spur);
      }
    } else {
      bx(ankle, 0.36 * B, 0.16, 0.62, 0, -0.02, 0.12, 0x23262a);                        // 足掌
      if (G === 'vampire') {
        // 尖頭鞋錐:錐尖沿 +z 前伸,錐底最低點與足掌底面齊平(不低過腳底)
        const toe = new THREE.Mesh(new THREE.ConeGeometry(0.09 * B, 0.3, 6), mat(0x23262a, { metalness: 0.7 }));
        toe.rotation.x = Math.PI / 2;
        toe.position.set(0, -0.01, 0.52);
        ankle.add(toe);
      }
      if (G === 'wolf' || G === 'monkey')
        for (let i = -1; i <= 1; i++)
          bx(ankle, 0.1 * B, 0.1, 0.3, i * 0.11 * B, -0.04, 0.46, 0xd8d4c8);            // 趾爪
      if (G === 'wolf') {
        // 後距突(dewclaw):自踝後緣朝後方鉤出 —— 趾行「跟骨懸空」的視覺錨;
        // 錐尖最低點高於足掌底,不動 fitToHeight 貼地歸零
        const dew = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 5), mat(0x2a2e33, { metalness: 0.6 }));
        dew.position.set(0, 0.12, -0.2);
        dew.rotation.x = -2.6;
        ankle.add(dew);
        cyl(ankle, 0.1 * B, 0.11 * B, 0.1, 8, 0, 0.06, 0, 0x23262a, { metalness: 0.4 });  // 踝防塵罩(蓋住脛/踝接縫,隨踝屈伸)
      }
    }
    noz(shin, 0.11, 0.14, 0.26, 0, -0.76, -0.28);                                       // 足底噴口(飛行朝後)
    if (F === 'heli') {
      // 渡鴉腿旋翼(Y 字兩後臂端點):地面桅微後傾、槳葉收攏貼小腿後方(= 收起);
      // 飛行桅反轉指天(−(cruise+0.03) 補償 cruise + 腿/小腿殘餘俯仰;腿的外撇是繞
      // 腿根局部 z 軸,實測不歪桅,不需再補側傾)、槳葉展開。
      // 左右反向旋轉互抵扭矩(dir = −sx),與機首旋翼合成三旋翼
      mkRotor(shin, [0, -0.72, -0.18], [-0.55, 0, 0],
        [-(cruise + 0.03), 0, 0], 3, 0.85 * (0.9 + 0.1 * B), -sx, 0.55);
      // 旋翼臂航行燈(航空慣例硬編色:左紅右綠)—— 三旋翼的航空器身份在地面收攏時仍可辨;
      // 純識別燈,不進 glows/rotors
      const nc = sx < 0 ? 0xff3b30 : 0x35d07a;
      bx(shin, 0.05, 0.05, 0.05, sx * 0.17 * B, -0.7, -0.15, nc, { emissive: nc, emissiveIntensity: 1.2 });
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
      // 手持武器機種(HOLDGUN)飛行:雙臂沿體軸朝航向前伸(超人式)—— 鏈角總和 = −π/2 − cruise
      // ⇒ 臂軸(−y)指向世界正前;槍角由 stepMorph 以 gp.air(π)補完 ⇒ 槍口朝前射擊
      TILT ? { p: [sx * 0.75 * B, 1.05, -0.08], r: [AOA - cruise, 0, sx * 1.52] }
        : HOLDGUN ? { p: [sx * 0.42 * B, 1.15, 0.12], r: [-Math.PI / 2 - cruise, 0, sx * 0.08] }
          : { p: [sx * 0.58 * B, 1.0, -0.06], r: [0.35, 0, sx * 0.18] },
      beast ? 0.2 : TILT ? 0.35 : 0.3, beast ? 0.55 : TILT ? 0.8 : 0.72);
    bx(a, 0.34 * B, 0.28, 0.4, 0, 0.06, 0, plate);                                      // 肩甲
    vent(a, 0.1, 0.14, 0.14, sx * 0.18 * B, 0.06, 0.16);                                // 肩關節排氣口
    // 身體圓角化機種的前肢同樣圓柱化(tilt 除外 —— 手臂就是主翼,翼面必須是板)
    const CYLG = { beetle: 1, raptor: 1.2, panther: 1.3, elephant: 1.6 }[G];
    if (CYLG && !TILT) cyl(a, 0.1 * B * CYLG, 0.13 * B * CYLG, limb[1], 8, 0, -limb[1] / 2 - 0.03, 0.02, hull);  // 圓柱前股
    else bx(a, 0.26 * B, limb[1], 0.32, 0, -limb[1] / 2 - 0.03, 0.02, hull);            // 上臂
    const fore = new THREE.Group();
    fore.position.set(0, -limb[1] - 0.05, 0);
    a.add(fore);
    P(fore, { p: null, r: [QUAD ? QUAD[6] : HUM[6], 0, 0] },
      { p: null, r: [(TILT || HOLDGUN) ? 0 : 0.5, 0, 0] },   // tilt:前臂打直延伸翼展;手持:打直前伸據槍
      beast ? 0.22 : TILT ? 0.38 : 0.32, beast ? 0.58 : TILT ? 0.82 : 0.7);
    if (CYLG && !TILT) cyl(fore, 0.08 * B * CYLG, 0.11 * B * CYLG, limb[2], 8, 0, -limb[2] / 2, 0.02, hullDk);  // 圓柱前脛
    else bx(fore, 0.24 * B, limb[2], 0.3, 0, -limb[2] / 2, 0.02, hullDk);               // 前臂
    // —— 家族專屬臂部細節(掛肩/前臂節點隨臂動;皆非 wpn 節點,不進 FPV)——
    if (G === 'vampire') {
      // 軍禮服肩章 + 反折亮色袖口:貴族軍官的第二/三筆(與既有肩甲同節點 = 隨臂動不穿模)
      bx(a, 0.38 * B, 0.05, 0.44, 0, 0.225, 0, PAL.lite, { metalness: 0.6 });            // 肩章板
      bx(a, 0.38 * B, 0.04, 0.06, 0, 0.2, 0.22, dim(accent, 0.85));                      // 肩章前緣飾條
      bx(fore, 0.3 * B, 0.14, 0.36, 0, -0.5, 0.02, PAL.lite, { metalness: 0.5 });        // 禮服袖口(低於手掌,不碰手持武器)
    } else if (G === 'elephant') {
      // 前肢肘/腕防塵罩環:工程機具關節必有的橡膠罩,四腳同構的關節語彙一致
      cyl(fore, 0.17 * B, 0.19 * B, 0.16, 10, 0, 0.03, 0.02, PAL.deep, { metalness: 0.35 });
      cyl(fore, 0.15 * B, 0.17 * B, 0.12, 10, 0, -0.82, 0.02, PAL.deep, { metalness: 0.35 });
    } else if (G === 'monkey') {
      // 長臂液壓缸(掌行承重的機能交代;單端錨 —— 肘每幀屈伸,雙錨會被拉伸):
      // 缸體錨上臂、亮色桿芯錨前臂,掛外側避開軀幹
      const hyd = cyl(a, 0.04, 0.04, 0.8, 6, sx * 0.15 * B, -0.7, -0.12, 0x30373f, { metalness: 0.85 });
      hyd.rotation.x = 0.12;
      const rod = cyl(fore, 0.025, 0.025, 0.4, 6, sx * 0.13 * B, -0.25, -0.1, 0xd8d4c8, { metalness: 0.9 });
      rod.rotation.x = 0.1;
    } else if (G === 'raptor') {
      // 前臂飛羽扇:真實馳龍前臂的飛羽,「始祖鳥↔迅猛龍」兩型態共用的一筆;
      // 羽根錨前臂外側、羽尖向外後方(沿翼羽既有佈羽方向),收臂蓄勢姿不插軀幹
      feather(fore, 0.3, 0.07, sx * 0.06 * B, -0.18, -0.14, 1.35, sx, 0x2a2e33, { metalness: 0.3 });
      feather(fore, 0.26, 0.06, sx * 0.06 * B, -0.3, -0.16, 1.5, sx, dim(plate, 0.75), { metalness: 0.3 });
    } else if (G === 'panther') {
      // 前肢護腿墊:潛行步態的緩衝墊 =「安靜」的機能表達(匿蹤原則:不發光)
      bx(fore, 0.04, 0.5, 0.3, sx * 0.14 * B, -0.4, 0.02, dim(hullDk, 0.9), { metalness: 0.4 });
    }
    if (TILT) {
      // 臂外側翼面板(地面 = 臂甲;展開後 = 主翼弦面)+ 前緣識別條
      bx(a, 0.06, limb[1] + 0.2, 0.62, sx * 0.2 * B, -limb[1] / 2, 0.04, hull, { metalness: 0.6 });
      bx(fore, 0.06, limb[2] + 0.15, 0.55, sx * 0.18 * B, -limb[2] / 2, 0.04, plate, { metalness: 0.6 });
      bx(fore, 0.05, limb[2], 0.09, sx * 0.19 * B, -limb[2] / 2, 0.34, accent, { emissive: accent, emissiveIntensity: 0.8 });
      // 臂內側液壓撐桿(工業機具的外露機構;內側 = -sx 避開外側翼面):
      // 缸體掛上臂、亮色桿芯掛前臂 —— 屈肘時缸與芯自然錯動
      cyl(a, 0.045, 0.045, limb[1] * 0.7, 6, -sx * 0.15 * B, -limb[1] / 2, -0.12, 0x30373f, { metalness: 0.85 });   // 缸體
      cyl(fore, 0.028, 0.028, 0.32, 6, -sx * 0.13 * B, -0.12, -0.1, 0xd8d4c8, { metalness: 0.9 });                  // 亮色桿芯
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
    P(hand, { p: null, r: [handG, 0, 0] }, { p: null, r: [(TILT || HOLDGUN) ? 0 : -0.35, 0, 0] },
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
      bx(hand, 0.26 * B, 0.05, 0.28, 0, 0.02, 0.08, PAL.lite, { metalness: 0.5 });       // 掌背護甲(指背著地的耐磨甲片,猩猩式前腳標配)
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
    // 手持武器人形(vampire/wolf:輕/重異型 → 雙槍,一手一把)不再用泛用前臂莢艙 ——
    // 武器掛在手掌群組下(隨 pose(m) 收攏:飛行型自然折臂收槍貼艙),俯仰由 gunPitch 驅動
    if (HANDGUN) {
      // 行軍持槍 rest 依站姿定:狼人趾行深屈 → 手位貼近地面,槍管前下傾會戳破腳底
      // (fitToHeight 以最低點歸零 = 整機浮空)⇒ 狼人 rest 拉到近水平;吸血鬼挺立照舊前下傾
      const restP = G === 'wolf' ? 1.62 : 1.35;
      if (sx > 0) {
        // ── 右手輕武器:依角色原型建模(渡鴉 M134 六管速射 / 清算日 GAU-19 電磁旋管)──
        const gg = new THREE.Group();
        gg.position.set(0, -0.12, 0.12);
        gg.rotation.x = restP;                                                          // rest:行軍持槍
        hand.add(gg);
        // aim = 1.57 − aimM 總俯仰(−1.45)→ 槍口水平;air = π:飛行雙臂前伸(鏈角 −π/2)
        // 時槍身翻沿臂軸 ⇒ 槍口朝航向正前(stepMorph gunM 以型態 m 混成)
        morphGunR = { g: gg, rest: restP, aim: 3.02, air: Math.PI };
        bx(gg, 0.24, 0.5, 0.28, 0, 0.02, 0, 0x23262a, { metalness: 0.75 });             // 機匣
        bx(gg, 0.12, 0.24, 0.2, 0, -0.2, -0.2, 0x14171a);                               // 握把
        if (G === 'vampire') {
          // M134 六管速射:環列六管 + 前後束環 + 旋轉軸轂 + 側掛供彈鏈
          for (let i = 0; i < 6; i++) {
            const th = i / 6 * Math.PI * 2;
            cyl(gg, 0.035, 0.035, 1.0, 6, Math.cos(th) * 0.085, 0.8, Math.sin(th) * 0.085,
              0x14171a, { metalness: 0.85 });
          }
          for (const oy of [0.5, 1.15])                                                 // 束管環
            cyl(gg, 0.13, 0.13, 0.07, 10, 0, oy, 0, 0x30373f, { metalness: 0.8 });
          cyl(gg, 0.1, 0.12, 0.22, 10, 0, 0.32, 0, 0x1c2126, { metalness: 0.85 });      // 旋轉軸轂
          bx(gg, 0.1, 0.4, 0.16, sx * 0.16, 0.05, 0.1, 0x2b3138, { metalness: 0.7 });   // 供彈鏈匣
          morphLMuz = cyl(gg, 0.12, 0.12, 0.06, 10, 0, 1.34, 0, accent,
            { emissive: accent, emissiveIntensity: 0.7 });                               // 槍口環(擊發閃光)
        } else {
          // GAU-19 電磁化三管旋砲(rail):三管 + 線圈環 ×2(發光)+ 導線束
          for (let i = 0; i < 3; i++) {
            const th = i / 3 * Math.PI * 2;
            cyl(gg, 0.045, 0.045, 1.05, 6, Math.cos(th) * 0.07, 0.82, Math.sin(th) * 0.07,
              0x14171a, { metalness: 0.85 });
          }
          for (const oy of [0.55, 1.0])                                                 // 加速線圈環(蓄能識別)
            cyl(gg, 0.13, 0.13, 0.09, 10, 0, oy, 0, dim(accent, 0.7),
              { emissive: accent, emissiveIntensity: 0.5 });
          bx(gg, 0.08, 0.5, 0.08, sx * 0.14, 0.15, -0.08, 0x23262a, { metalness: 0.8 }); // 導線束
          morphLMuz = cyl(gg, 0.11, 0.11, 0.06, 10, 0, 1.4, 0, accent,
            { emissive: accent, emissiveIntensity: 0.7 });
        }
        // rig.wpn light:右手速射砲單根 gg(管束/軸轂/供彈匣皆其子節點)→ ref=gg;
        // 槍口環 morphLMuz 在 gg 局部 y=+1.34(M134)/+1.4(GAU-19),機匣 +0.02 ⇒ fwd 'y'(已驗證局部 +y)
        morphWpnL = { nodes: [gg], ref: gg, muz: morphLMuz, fwd: 'y' };
      } else {
        // ── 左手重武器(雙槍的另一手):渡鴉地獄火雙聯管 / 清算日追債者四聯彈匣箱 ──
        const gg = new THREE.Group();
        gg.position.set(0, -0.12, 0.12);
        gg.rotation.x = restP;
        hand.add(gg);
        morphGunL = { g: gg, rest: restP, aim: 3.02, air: Math.PI };
        const cells = [];
        if (G === 'vampire') {
          // 地獄火雙聯發射管(半主動雷射導引):上下雙管 + 管口導引窗 + 掛軌
          bx(gg, 0.26, 0.9, 0.3, 0, 0.35, 0, 0x23262a, { metalness: 0.7 });              // 發射器框
          for (const oz of [-0.09, 0.09]) {
            cyl(gg, 0.09, 0.09, 0.95, 8, 0, 0.38, oz, 0x14171a, { metalness: 0.8 });     // 發射管
            cells.push(cyl(gg, 0.08, 0.08, 0.05, 8, 0, 0.88, oz, accent,
              { emissive: accent, emissiveIntensity: 0.9 }));                             // 管口(蓄力/擊發發光)
          }
          bx(gg, 0.1, 0.7, 0.06, 0, 0.3, 0.2, 0x30373f, { metalness: 0.8 });             // 掛軌
          bx(gg, 0.12, 0.22, 0.18, 0, -0.18, -0.18, 0x14171a);                           // 握把
        } else {
          // 追債者 2×2 聯裝彈箱(射後鎖定):方箱 + 四膛口 + 頂部鎖定感測條
          bx(gg, 0.34, 0.8, 0.36, 0, 0.32, 0, 0x23262a, { metalness: 0.7 });             // 彈箱
          for (const ox of [-0.08, 0.08]) for (const oz of [-0.08, 0.08]) {
            cells.push(cyl(gg, 0.06, 0.06, 0.06, 8, ox, 0.74, oz, accent,
              { emissive: accent, emissiveIntensity: 0.9 }));                             // 四膛口
          }
          bx(gg, 0.3, 0.1, 0.05, 0, 0.5, 0.21, dim(accent, 0.85));                       // 鎖定感測條
          bx(gg, 0.12, 0.22, 0.18, 0, -0.18, -0.18, 0x14171a);                           // 握把
        }
        // pivot 留空:gg.rotation.x 由 gunPitch 每幀賦值(據槍/後座/蓄力反向都在那條),
        // 再掛 pivot 會互相覆寫 —— 武器俯仰的唯一寫入者是 gunPitch
        heavyRig = { glow: cells.map((mesh) => ({ mesh, base: 0.9 })), pivot: [] };
        morphMuzH = { n: cells[0], r: 0.1 };
        // rig.wpn heavy:左手發射器單根 gg → ref=gg;管口/膛口 cells 在 gg 局部 y=+0.88(地獄火)
        // /+0.74(追債者),發射器框 +0.35 ⇒ fwd 'y'(已驗證局部 +y)
        morphWpnH = { nodes: [gg], ref: gg, muz: cells[0], fwd: 'y' };
      }
    } else if (G === 'raptor') {
      // 迅猛龍左右手分持雙槍(2026-07-22 使用者指示「輕/重左右手分開拿」;07-17 雙手托一把已拆):
      // 右手 = G28 消音步槍(輕)、左手 = NTW-20 反器材長狙(重)—— 槍身沿 +y,
      // gunPitch 各自解算槍口朝前;aimM 雙臂對稱據槍;飛行雙臂前伸槍口朝航向(gp.air)
      const gg = new THREE.Group();
      gg.position.set(0, -0.1, 0.12);
      gg.rotation.x = 2.39;
      hand.add(gg);
      // rest:行軍鏈角總和 −0.7(θg 1.25 −0.6 −1.7 +0.35)⇒ 2.39 = 槍口前下傾;
      // aim:aimM 鏈角 0.1(1.25 −0.75 −0.5 +0.1,雙臂同角)⇒ 1.47 = 槍口水平;air = π(飛行前伸)
      if (sx > 0) {
        // ── 右手輕武器:G28 消音步槍 ──
        morphGunR = { g: gg, rest: 2.39, aim: 1.47, air: Math.PI };
        bx(gg, 0.16, 0.55, 0.2, 0, 0.06, -0.02, 0x23262a, { metalness: 0.75 });      // 機匣
        bx(gg, 0.1, 0.26, 0.13, 0, -0.12, -0.16, 0x14171a);                          // 彈匣(後下插,與槍膛同軸)
        bx(gg, 0.09, 0.16, 0.1, 0, -0.2, 0.06, 0x14171a);                            // 握把
        cyl(gg, 0.034, 0.038, 0.75, 6, 0, 0.68, 0, 0x111418, { metalness: 0.85 });   // 步槍段槍管
        cyl(gg, 0.06, 0.06, 0.3, 8, 0, 0.6, 0, 0x30373f, { metalness: 0.75 });       // 消音套筒
        const rLMuz = cyl(gg, 0.065, 0.065, 0.04, 8, 0, 0.8, 0, accent, { emissive: accent, emissiveIntensity: 0.7 });
        bx(gg, 0.05, 0.3, 0.05, 0, 0.26, -0.14, 0x0e1114, { metalness: 0.8 });       // 瞄準鏡筒(槍身背側)
        morphLGlow = [{ mesh: rLMuz, base: 0.7 }];
        morphMuzL = { n: rLMuz, r: 0.07 };
        // rig.wpn light:右手步槍單根 gg → ref=gg;膛口 rLMuz 在局部 y=+0.8、機匣 +0.06 ⇒ fwd 'y'
        morphWpnL = { nodes: [gg], ref: gg, muz: rLMuz, fwd: 'y' };
      } else {
        // ── 左手重武器:NTW-20 反器材長狙 ──
        morphGunL = { g: gg, rest: 2.39, aim: 1.47, air: Math.PI };
        bx(gg, 0.18, 0.6, 0.22, 0, 0.08, -0.02, 0x23262a, { metalness: 0.75 });      // 機匣(長狙加大)
        bx(gg, 0.11, 0.3, 0.14, 0, -0.14, -0.16, 0x14171a);                          // 彈匣(後下插,與槍膛同軸)
        bx(gg, 0.09, 0.16, 0.1, 0, -0.22, 0.06, 0x14171a);                           // 握把
        cyl(gg, 0.03, 0.04, 1.0, 6, 0, 0.86, 0, 0x111418, { metalness: 0.85 });      // 反器材長管
        bx(gg, 0.1, 0.14, 0.09, 0, 1.42, 0, 0x0d0f11, { metalness: 0.85 });          // 制退器
        const rHMuz = cyl(gg, 0.05, 0.05, 0.04, 6, 0, 1.52, 0, accent, { emissive: accent, emissiveIntensity: 0.7 });
        bx(gg, 0.05, 0.4, 0.05, 0, 0.34, -0.15, 0x0e1114, { metalness: 0.8 });       // 長倍率瞄準鏡筒
        heavyRig = { glow: [{ mesh: rHMuz, base: 0.7 }], pivot: [] };
        morphMuzH = { n: rHMuz, r: 0.06 };
        // rig.wpn heavy:左手長狙單根 gg → ref=gg;膛口 rHMuz 在局部 y=+1.52、機匣 +0.08 ⇒ fwd 'y'
        morphWpnH = { nodes: [gg], ref: gg, muz: rHMuz, fwd: 'y' };
      }
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
      cyl(knee, 0.1 * B, 0.1 * B, 0.08, 8, 0, -0.02, 0, 0x23262a, { metalness: 0.7 });  // 中足膝關節環(前後足都有,補中足對的裸接縫;隨 midKnees 屈伸)
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
      if (i !== 2) {
        // 鬃刺 = 電戰天線陣:錐尖發光天線端(i===2 那根本體已是 accent,跳過;
        // 球是 s 的子節點,跟著錐體既有 rotation 走)
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), mat(accent, { emissive: accent, emissiveIntensity: 1.2 }));
        tip.position.set(0, (0.42 - i * 0.05) / 2, 0);
        s.add(tip);
      }
      torso.add(s);
    }
    for (const sx of [-1, 1]) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.11 * B, 0.6, 5), mat(plate, { metalness: 0.7 }));
      sp.position.set(sx * 0.9 * B, 1.32, -0.1);
      sp.rotation.z = sx * 0.5;
      torso.add(sp);                                                                    // 肩尖獠刺
    }
    // 胸毛疊瓦板:狼人胸口蓬毛的賽璐璐解 = 大塊疊瓦(下緣外挑成瓦),不堆微 greeble;
    // 頂片低於胸前識別燈、側緣讓開進氣口
    const furs = [[0.72, 0.5, 0.52, dim(PAL.lite, 0.7)], [0.54, 0.66, 0.545, dim(PAL.lite, 0.85)], [0.38, 0.8, 0.57, PAL.lite]];
    for (const [fw, fy, fz, fc] of furs) {
      const fur = bx(torso, fw * B, 0.16, 0.05, 0, fy, fz, fc, { metalness: 0.4 });
      fur.rotation.x = -0.15;
    }
    // 電戰散熱鰭列:干擾吊艙機是發熱大戶 —— 背包側面格柵鰭(Growler 的機能主義)
    for (const sx of [-1, 1]) for (const oz of [-0.52, -0.68])
      bx(torso, 0.03, 0.55, 0.09, sx * 0.49 * B, 0.75, oz, PAL.deep, { metalness: 0.6 });
  } else if (G === 'vampire') {
    // 吸血鬼(渡鴉):高豎立領 + 背脊整流罩 —— 2026-07-11 起披風雙翼移除,
    // 升力全數改由三旋翼提供(機首桅 + 雙腿末端;Y 字構型見 mkRotor / mkLeg 的 heli 分支)
    for (const sx of [-1, 1]) {
      const col = bx(torso, 0.18, 1.0, 0.55, sx * 0.4 * B, 1.42, -0.3, plate, { metalness: 0.6 });
      col.rotation.z = sx * 0.2;                                                         // 高豎立領(左右領片)
      col.rotation.x = -0.08;
      // 立領內襯:德古拉立領「外黑內紅」的貴族記號 —— 縮短縮窄貼領片內側面,同角不越緣
      const lin = bx(torso, 0.04, 0.9, 0.5, sx * 0.33 * B, 1.44, -0.28, dim(accent, 0.7));
      lin.rotation.z = sx * 0.2;
      lin.rotation.x = -0.08;
    }
    const bk = bx(torso, 0.46 * B, 0.75, 0.13, 0, 1.5, -0.48, plate, { metalness: 0.6 });
    bk.rotation.x = -0.18;                                                               // 中央後領片(三片環抱後頸)
    bx(torso, 0.7 * B, 1.1, 0.14, 0, 0.5, -0.62, hullDk, { metalness: 0.5 });            // 背脊整流罩(收納機首桅)
    bx(torso, 0.5 * B, 0.12, 0.15, 0, 1.1, -0.63, accent, { emissive: accent, emissiveIntensity: 0.8 });
    // 桅收納卡榫:機首桅摺收「有機構在扣住」的機能感(整流罩頂緣兩側)
    for (const sx of [-1, 1])
      bx(torso, 0.09, 0.1, 0.16, sx * 0.2 * B, 1.06, -0.6, PAL.deep, { metalness: 0.7 });
    // 收攏的披風下擺:骨盆背面三片靜態裙板(落地即斗篷收起;飛行放平後成尾下整流)
    for (const sx of [-1, 1]) {
      const cp = bx(torso, 0.34 * B, 0.95, 0.08, sx * 0.28 * B, -0.55, -0.48, PAL.mid, { metalness: 0.5 });
      cp.rotation.x = -0.12;
      cp.rotation.z = sx * 0.08;
    }
    const cloak = bx(torso, 0.3 * B, 1.05, 0.08, 0, -0.6, -0.54, dim(PAL.mid, 0.85));
    cloak.rotation.x = -0.14;                                                            // 中央長片
    // 披風緣飾:主色滾邊收尾整個背面剪影(貼中央長片下緣、同傾角)
    const hem = bx(torso, 0.3 * B, 0.08, 0.04, 0, -1.08, -0.575, dim(accent, 0.6));
    hem.rotation.x = -0.14;
  } else if (G === 'atlas') {
    // 負重型:雙肩貨運掛架(轉包的貨都吊在上面)+ 腰際配重塊 = 前傾負重站姿的來源。
    // 武裝全數「掛載」在貨運架下(機體名就叫外包母艦 —— 手不持槍,手持圓盾=旋翼盤):
    // 右架 = 雙聯掛載機槍(輕),左架 = 集束子母彈布撒器(重,蓄力上仰瞄準/擊發反向下沉)
    // 腰際配重塊:前傾寬站不會摔的配重(x ±0.42B 避開 ±0.95B 掛載臂與中線背包)
    for (const sx of [-1, 1]) {
      bx(torso, 0.34 * B, 0.5, 0.3, sx * 0.42 * B, -0.02, -0.5, hullDk, { metalness: 0.6 });     // 配重塊
      bx(torso, 0.3 * B, 0.08, 0.26, sx * 0.42 * B, 0.25, -0.5, dim(accent, 0.85));              // 頂面警示條
      cyl(torso, 0.05, 0.05, 0.05, 6, sx * 0.42 * B, -0.3, -0.5, 0x23262a, { metalness: 0.8 });  // 下緣吊環
    }
    // 防滾籠:駕駛位頂上的外露工業框架(Power Loader 語彙;柱根生根胸艙頂、頂樑低於頭頂)
    for (const sx of [-1, 1]) {
      const pil = bx(torso, 0.08, 0.55, 0.08, sx * 0.4 * B, 1.5, 0.3, plate, { metalness: 0.7 });
      pil.rotation.x = 0.25;                                                             // 籠柱
    }
    bx(torso, 0.86 * B, 0.08, 0.1, 0, 1.76, 0.18, plate, { metalness: 0.7 });            // 頂樑
    bx(torso, 0.3 * B, 0.05, 0.08, 0, 1.72, 0.24, accent, { emissive: accent, emissiveIntensity: 0.8 });  // 頂樑工作燈
    // 頂樑工地探照燈:與中央工作燈成一排 = 工地照明桁架(純識別燈不進 glows)
    for (const sx of [-1, 1])
      bx(torso, 0.09, 0.07, 0.07, sx * 0.36 * B, 1.79, 0.24, accent, { emissive: accent, emissiveIntensity: 0.6 });
    // 背馱貨箱堆:母艦 = 永遠載著別人的貨 —— 中背雙蜂群巢之間的空位再馱兩箱(低於防滾籠頂樑)
    bx(torso, 0.36 * B, 0.3, 0.3, 0, 1.27, -0.6, PAL.mid);                               // 箱一
    bx(torso, 0.26 * B, 0.24, 0.26, 0.05 * B, 1.54, -0.58, dim(PAL.mid, 0.8));           // 箱二(略偏 = 隨手堆的貨)
    bx(torso, 0.05, 0.62, 0.34, 0, 1.4, -0.6, PAL.deep, { metalness: 0.5 });             // 綁帶
    for (const sx of [-1, 1]) {
      const py = bx(torso, 0.5 * B, 0.5, 1.5, sx * 0.95 * B, 1.35, -0.35, plate, { metalness: 0.65 });
      py.rotation.z = sx * -0.12;                                                        // 掛載臂
      bx(torso, 0.34 * B, 0.7, 0.34, sx * 1.0 * B, 0.62, -0.8, hullDk);                  // 瓦楞貨櫃(頂 0.97 與掛載臂底 1.10 留出懸空間隙)
      bx(torso, 0.3 * B, 0.12, 0.3, sx * 1.0 * B, 0.2, -0.8, accent,
        { emissive: accent, emissiveIntensity: 0.9 });                                   // 掛點識別燈(貨櫃底緣)
      for (let k = -1; k <= 1; k++)                                                      // 瓦楞肋三條
        bx(torso, 0.37 * B, 0.62, 0.03, sx * 1.0 * B, 0.62, -0.8 + k * 0.11, dim(hull, 0.75), { metalness: 0.5 });
      for (const oz of [-0.92, -0.68])                                                   // 前後雙吊桿(貨櫃頂 → 臂底,跨過懸空間隙 = 吊掛不是焊死)
        cyl(torso, 0.025, 0.025, 0.32, 6, sx * 1.0 * B, 1.06, oz, 0x2a2e33, { metalness: 0.85 });
      for (const ox of [-1, 1])                                                          // 貨櫃門鎖桿:垂直鎖桿 = 集裝箱第一識別,兩根就讀出「標箱」
        bx(torso, 0.025, 0.64, 0.025, sx * 1.0 * B + ox * 0.06 * B, 0.62, -0.985, PAL.deep, { metalness: 0.7 });
      for (const cz of [-0.9, -0.35, 0.2]) {                                             // 掛載臂繫留栓(cleat):碼頭吊臂邊緣的纜繩掛點,與臂同傾貼面
        const cleat = bx(torso, 0.04, 0.08, 0.16, sx * 1.19 * B, 1.32, cz, PAL.deep, { metalness: 0.7 });
        cleat.rotation.z = sx * -0.12;
      }
      const warn = bx(torso, 0.44 * B, 0.42, 0.03, sx * 0.95 * B, 1.35, 0.42, dim(accent, 0.8));
      warn.rotation.z = sx * -0.12;                                                      // 臂端警示條(graffiti 塗裝疊上去 = 被貼過標語的碼頭設備)
      bx(torso, 0.2 * B, 0.02, 0.14, sx * 0.95 * B, 1.565, -1.24, dim(accent, 0.85));    // 蜂群巢編號牌(發射管陣列的艙位編號)
      // 蜂群發射巢(掛載臂尾端延伸;summon 的視覺載體 —— 發射演出走既有 summon fx,不掛 glow/rig)
      bx(torso, 0.4 * B, 0.4, 0.32, sx * 0.95 * B, 1.35, -1.22, 0x23262a, { metalness: 0.7 });   // 巢殼
      for (const ox of [-0.09, 0.09]) for (const oy of [-0.09, 0.09]) {
        const cell = cyl(torso, 0.055, 0.055, 0.05, 8, sx * 0.95 * B + ox * B, 1.35 + oy, -1.39, accent, { emissive: accent, emissiveIntensity: 0.7 });
        cell.rotation.x = Math.PI / 2;                                                   // 2×2 發射管口朝後
      }
      if (sx > 0) {
        // 右架雙聯機槍莢:並列雙管 + 雙彈匣 + 槍口識別燈 ×2。
        // 肩扛/掛載武器飛行規則(2026-07-17):變形時整莢轉到背部、以 −cruise 反轉補償
        // 軀幹俯仰 ⇒ 槍口恆朝移動/攻擊方向(航向正前)
        const mg = new THREE.Group();
        torso.add(mg);
        P(mg, { p: [sx * 0.95 * B, 1.02, 0.3], r: [0, 0, 0] },
          { p: [sx * 0.5 * B, 0.72, -0.85], r: [-cruise, 0, 0] }, 0.5, 0.95);
        bx(mg, 0.36, 0.26, 0.7, 0, 0, -0.1, 0x23262a, { metalness: 0.75 });              // 共構機匣
        atlasLGlow = [];
        for (const ox of [-0.1, 0.1]) {
          cyl(mg, 0.05, 0.05, 0.85, 6, ox, 0, 0.6, 0x14171a, { metalness: 0.85 })
            .rotation.x = Math.PI / 2;                                                   // 雙管
          const mz = cyl(mg, 0.07, 0.07, 0.05, 6, ox, 0, 1.04, accent,
            { emissive: accent, emissiveIntensity: 0.7 });
          mz.rotation.x = Math.PI / 2;
          atlasLGlow.push({ mesh: mz, base: 0.7 });                                      // 槍口燈(擊發閃光)
          bx(mg, 0.08, 0.3, 0.2, ox, -0.26, -0.05, 0x2b3138, { metalness: 0.7 });        // 彈匣
        }
        // rig.wpn light:右架雙聯機槍莢單根 mg(機匣/雙管/彈匣皆其子節點)→ ref=mg;
        // 槍口燈 mz 在 mg 局部 z=+1.04、雙管 +0.6、機匣 −0.1 ⇒ fwd 'z'
        morphWpnL = { nodes: [mg], ref: mg, muz: atlasLGlow[0].mesh, fwd: 'z' };
      } else {
        // 左架集束布撒器:方箱 + 2×3 布撒膛口(發光)+ 俯仰樞軸(蓄力上仰、擊發反向)。
        // 外層 dispP 走變形時窗(飛行轉到背部朝前)、內層 disp 留給 heavy.pivot ——
        // pivot 與 poser 各寫各的節點,互不覆寫
        const dispP = new THREE.Group();
        torso.add(dispP);
        P(dispP, { p: [sx * 0.95 * B, 1.02, 0.25], r: [0, 0, 0] },
          { p: [sx * 0.5 * B, 0.72, -0.85], r: [-cruise, 0, 0] }, 0.5, 0.95);
        const disp = new THREE.Group();
        dispP.add(disp);
        bx(disp, 0.5, 0.4, 0.8, 0, 0, -0.05, 0x23262a, { metalness: 0.7 });              // 布撒箱
        bx(disp, 0.46, 0.1, 0.7, 0, 0.24, -0.05, dim(accent, 0.8));                      // 頂蓋識別
        const cells = [];
        for (const ox of [-0.13, 0.13]) for (const oy of [-0.1, 0, 0.1]) {
          const c = cyl(disp, 0.05, 0.05, 0.05, 8, ox, oy, 0.38, accent,
            { emissive: accent, emissiveIntensity: 0.8 });
          c.rotation.x = Math.PI / 2;
          cells.push(c);                                                                  // 布撒膛口
        }
        heavyRig = {
          glow: cells.map((mesh) => ({ mesh, base: 0.8 })),
          pivot: [{ obj: disp, rest: { x: 0, y: 0, z: 0 }, deploy: { x: -0.18, y: 0, z: 0 } }],
        };
        morphMuzH = { n: cells[0], r: 0.07 };
        // rig.wpn heavy:外觀完整根 = 內層 disp(布撒箱/頂蓋/膛口全在其子樹;外層 dispP 只是
        // 變形時窗的空 poser 節點)→ ref=disp;膛口 cells 在 disp 局部 z=+0.38、箱體 −0.05 ⇒ fwd 'z'
        morphWpnH = { nodes: [disp], ref: disp, muz: cells[0], fwd: 'z' };
      }
    }
  } else if (G === 'monkey') {
    // 齊天大聖(悟空):額上金箍(緊箍圈:貫穿頭殼的薄金環)+ 斜背如意金箍棒
    // (黑鐵棒身、兩端金箍;斜置收在背後 —— 直立長棒會撐大包圍盒把機體縮小)
    const gold = 0xe8b33a;
    cyl(head, 0.36 * B, 0.36 * B, 0.07, 14, 0, 0.2, 0, gold,
      { metalness: 0.85, emissive: gold, emissiveIntensity: 0.35 });                     // 金箍
    // 猴耳廓:圓耳是猴臉剪影缺的最後一筆(金箍環帶下方,圓盤面朝外)
    for (const sx of [-1, 1]) {
      const ear = cyl(head, 0.09, 0.09, 0.035, 10, sx * 0.3 * B, 0.05, -0.02, PAL.lite, { metalness: 0.5 });
      ear.rotation.z = Math.PI / 2;
    }
    // 猴面:短圓吻(雷公嘴,圓角量體蓋過方下顎)+ 火眼金睛雙金眼(凸出面罩條之上/之前)
    rbz(head, 0.3 * B, 0.2, 0.28, 0, -0.08, 0.34, plate, { metalness: 0.5 });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), mat(gold, { emissive: gold, emissiveIntensity: 1.6 }));
      eye.position.set(sx * 0.15 * B, 0.16, 0.3);
      head.add(eye);
    }
    // 紫金冠雙翎:自金箍環帶內側長出、沿體軸向外後方平掠(feather 放射語彙,不撐高包圍盒)
    for (const sx of [-1, 1])
      feather(head, 0.55, 0.09, sx * 0.26 * B, 0.22, -0.08, 1.25, sx, gold,
        { metalness: 0.85, emissive: gold, emissiveIntensity: 0.35 });
    // 如意棒脈衝雷射(輕武器,beam;2026-07-17 使用者指示「輕武器扛在肩上」)——
    // 舊「斜背裝飾棒 + 右前臂雷射莢」合而為一:地面扛右肩、砲口水平朝前(−stance 抵銷掌行
    // 前傾);飛行走肩扛武器規則 = 轉到背部、−cruise 補償俯仰 ⇒ 砲口恆朝航向。
    // 黑鐵棒身 + 兩端金箍,前端金箍內圈 = 槍口環(擊發閃光/曳光起點);電容匣供能同軸兼肩墊
    const staffG = new THREE.Group();
    torso.add(staffG);
    P(staffG, { p: [0.42 * B, 1.34, 0.12], r: [-stance[1], 0, 0] },
      { p: [0, 1.05, -0.52], r: [-cruise, 0, 0] }, 0.35, 0.85);
    cyl(staffG, 0.07, 0.07, 2.4, 8, 0, 0, -0.1, 0x1a1d20, { metalness: 0.8 })
      .rotation.x = Math.PI / 2;                                                         // 鐵棒身(沿 +z 朝前)
    bx(staffG, 0.14, 0.2, 0.32, 0, -0.17, -0.35, 0x23262a, { metalness: 0.7 });          // 電容匣(供能同軸,兼肩架墊)
    for (const zz of [-1.24, 0.98])
      cyl(staffG, 0.09, 0.09, 0.26, 8, 0, 0, zz, gold,
        { metalness: 0.85, emissive: gold, emissiveIntensity: 0.5 }).rotation.x = Math.PI / 2;   // 兩端金箍
    const staffMuz = cyl(staffG, 0.1, 0.1, 0.07, 8, 0, 0, 1.14, accent,
      { emissive: accent, emissiveIntensity: 0.9 });
    staffMuz.rotation.x = Math.PI / 2;                                                   // 槍口環(前端金箍內圈)
    morphLGlow = [{ mesh: staffMuz, base: 0.9 }];
    morphMuzL = { n: staffMuz, r: 0.1 };
    // rig.wpn light:如意棒單根 staffG(棒身/金箍/電容匣皆其子節點)→ ref=staffG;
    // 槍口環 staffMuz 在 staffG 局部 z=+1.14(棒身沿 +z 朝前、電容匣 −0.35)⇒ fwd 'z'
    morphWpnL = { nodes: [staffG], ref: staffG, muz: staffMuz, fwd: 'z' };
    // 虎皮裙腰甲:前腰片(下緣外撇讓開掌行深前傾的大腿)+ 腰帶識別
    const sk = bx(torso, 0.5 * B, 0.34, 0.09, 0, -0.24, 0.42, dim(gold, 0.7), { metalness: 0.5 });
    sk.rotation.x = -0.45;
    bx(torso, 0.9 * B, 0.1, 0.06, 0, -0.06, 0.46, accent, { emissive: accent, emissiveIntensity: 0.8 });
    // 虎皮裙側片:正面一片不成「裙」,側包兩片補齊(外撇角讓開步態)
    for (const sx of [-1, 1]) {
      const sk2 = bx(torso, 0.2 * B, 0.28, 0.07, sx * 0.48 * B, -0.22, 0.3, dim(gold, 0.7), { metalness: 0.5 });
      sk2.rotation.x = -0.35;
      sk2.rotation.y = sx * 0.55;
    }
    // 搶修工具匣(左側,與右側械爪成對 =「左工具右手臂」的維修工位;強化戰場搶修車身份)
    bx(torso, 0.2 * B, 0.34, 0.16, -0.52 * B, 0.85, -0.62, PAL.mid, { metalness: 0.5 });     // 工具匣
    bx(torso, 0.21 * B, 0.06, 0.02, -0.52 * B, 0.95, -0.53, dim(accent, 0.85));              // 匣面警示條
    cyl(torso, 0.05, 0.05, 0.24, 8, -0.42 * B, 0.95, -0.7, dim(accent, 0.7), { metalness: 0.6 });  // 焊炬瓶(外移避開光翼根機構盒)
    // 帳房側掛袋:隨身帳冊/零件袋吊在腰際 —— 後勤/貨運身份的碼頭工人語彙
    bx(torso, 0.16 * B, 0.22, 0.1, -0.6 * B, 0.28, -0.08, PAL.deep, { metalness: 0.3 });     // 袋體
    bx(torso, 0.17 * B, 0.07, 0.02, -0.6 * B, 0.36, -0.02, dim(gold, 0.7));                  // 袋蓋
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
  if (G === 'wolf') {
    // 狼尾配重(werewolf 剪影的收尾筆畫):三節圓柱串接,節身收分 + 節間關節環;
    // 尾梢不發光 —— 電戰機不自曝。每節都有 P poser 條目(每幀重賦,whipTail 疊加不累積)
    let cur = torso;
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Group();
      t.position.set(0, i === 0 ? -0.16 : 0, i === 0 ? -0.44 : -0.5);
      cur.add(t);
      P(t, { p: null, r: [i === 0 ? -stance[1] - 0.55 : 0.3, 0, 0] },
        { p: null, r: [i === 0 ? 0.06 - cruise : 0.04, 0, 0] }, 0.1 + i * 0.1, 0.5 + i * 0.1);
      const w2 = 0.07 - i * 0.012;
      const seg = cyl(t, w2 * B, (w2 + 0.015) * B, 0.5, 8, 0, 0, -0.26, i % 2 ? hullDk : hull, { metalness: 0.55 });
      seg.rotation.x = Math.PI / 2;                                                     // 圓柱節身(沿 z)
      const ring = cyl(t, (w2 + 0.03) * B, (w2 + 0.03) * B, 0.08, 8, 0, 0, -0.5, 0x23262a, { metalness: 0.8 });
      ring.rotation.x = Math.PI / 2;                                                    // 節間關節環
      tailSegs.push(t);
      cur = t;
    }
    // 尾梢毛簇:狼尾收尾的毛簇剪影(錐尖向後下,隨 whipTail 甩動);電戰不自曝故不發光
    for (const [ox, tc] of [[-0.03, 0x2a2e33], [0.03, dim(hull, 0.8)]]) {
      const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.22, 5), mat(tc, { metalness: 0.4 }));
      tuft.position.set(ox, 0.02, -0.58);
      tuft.rotation.x = -1.9;
      cur.add(tuft);
    }
  }
  if (G === 'monkey') {
    const tailParts = [];
    let cur = torso;
    for (let i = 0; i < 5; i++) {
      const t = new THREE.Group();
      t.position.set(0, i === 0 ? -0.2 : 0, i === 0 ? -0.42 : -0.62);
      cur.add(t);
      tailParts.push(P(t, { p: null, r: [(i === 0 ? -stance[1] + 0.1 : 0.42), 0, 0] },
        { p: null, r: [i === 0 ? -0.84 : 0.62, 0, 0] }, 0.1 + i * 0.08, 0.6 + i * 0.08));
      const w = 0.13 - i * 0.015;
      const seg = cyl(t, w * B, (w + 0.02) * B, 0.6, 8, 0, 0, -0.31, i % 2 ? hullDk : plate, { metalness: 0.6 });
      seg.rotation.x = Math.PI / 2;                                                     // 圓柱節身(沿 z)
      cyl(t, (w + 0.035) * B, (w + 0.035) * B, 0.1, 8, 0, 0, -0.6, 0x23262a, { metalness: 0.8 })
        .rotation.x = Math.PI / 2;                                                      // 節間關節環
      tailSegs.push(t);
      cur = t;
    }
    // 尾端巨砲(宙斯裝備):砲身沿尾梢 −z —— 行軍時尾上捲砲口朝天蓄勢;
    // 重武器交戰(rig._aimH)或飛行時尾巴蠍式前捲過頂,砲口指向正前方 = 攻擊方向
    // (tailPose 子集 poser + tailAimComp 地面殘餘仰角補償,stepMorph 消費)
    const tip = tailSegs[4];
    const tailGun = cyl(tip, 0.16 * B, 0.19 * B, 1.0, 8, 0, 0, -0.95, 0x1a1d20, { metalness: 0.85 });
    tailGun.rotation.x = Math.PI / 2;                                                    // 砲身
    const tailBreech = cyl(tip, 0.21 * B, 0.21 * B, 0.2, 8, 0, 0, -0.62, hullDk, { metalness: 0.7 });
    tailBreech.rotation.x = Math.PI / 2;                                                 // 砲尾機匣
    const tailRing = cyl(tip, 0.13 * B, 0.13 * B, 0.1, 8, 0, 0, -1.44, accent, { emissive: accent, emissiveIntensity: 1.6 });
    tailRing.rotation.x = Math.PI / 2;                                                   // 砲口充能環
    heavyRig = {
      glow: [...heavyRig.glow, { mesh: tailRing, base: 1.6 }],
      pivot: [...heavyRig.pivot, { obj: tailGun, rest: { x: Math.PI / 2, y: 0, z: 0 }, deploy: { x: Math.PI / 2 + 0.15, y: 0, z: 0 } }],
    };
    morphMuzH = { n: tailRing, r: 0.15 };
    // rig.wpn heavy:尾梢巨砲散件(砲身/砲尾機匣/充能環)共同父節點 = 尾梢節 tip
    // (tailRing 掛 tip 不掛 tailGun)→ ref=tip;充能環 z=−1.44、機匣 −0.62 ⇒ 槍口在 −z 端
    morphWpnH = { nodes: [tailGun, tailBreech, tailRing], ref: tip, muz: tailRing, fwd: '-z' };
    // 尾砲瞄準:尾鏈五節的子集 poser —— stepMorph 以 max(型態 m, 重武器交戰 _aimH) 前捲;
    // 地面 torso 站姿(stance)比巡航(cruise)直挺,砲口水平差 = cruise − stance 由末節補回
    morphTailPose = makePoser(tailParts);
    morphTailComp = cruise - stance[1];
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
      // 始祖鳥人字尾:羽片沿整條尾軸左右成對排列(靜態掛節上,隨 whipTail 甩動;暗階交錯,匿蹤不發光)
      for (const s2 of [-1, 1]) for (let i = 0; i < 2; i++)
        feather(tail, 0.3 - i * 0.05, 0.09, s2 * 0.05, 0.02, -0.3 - i * 0.28, 1.2, s2,
          i % 2 ? 0x2a2e33 : dim(plate, 0.78), { metalness: 0.3 });
      const t2 = new THREE.Group();
      t2.position.set(0, 0, -0.9);
      tail.add(t2);
      P(t2, { p: null, r: [0.3, 0, 0] }, { p: null, r: [0, 0, 0] }, 0.15, 0.55);
      tailSegs.push(t2);
      cyl(t2, 0.085 * B, 0.085 * B, 0.07, 8, 0, 0, -0.02, 0x30373f, { metalness: 0.8 })
        .rotation.x = Math.PI / 2;                                                       // 節間關節環
      cyl(t2, 0.07 * B, 0.05 * B, 0.6, 8, 0, 0, -0.3, 0x23262a).rotation.x = Math.PI / 2; // 尾段二
      for (const s2 of [-1, 1])
        feather(t2, 0.26, 0.08, s2 * 0.04, 0.02, -0.22, 1.22, s2, dim(plate, 0.7), { metalness: 0.3 });  // 尾段二成對側羽
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
      // 尾根消音套環:鞭尾根部的線束防磨套,把尾與臀的接縫收乾淨(隨尾根甩動)
      cyl(tail, 0.075 * B, 0.075 * B, 0.12, 8, 0, 0, -0.06, PAL.deep, { metalness: 0.4 }).rotation.x = Math.PI / 2;
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
    tailPose: morphTailPose, tailAimComp: morphTailComp,   // 尾砲瞄準前捲(僅 monkey 非 null)
    trunkAim: morphTrunkAim,                     // 象鼻交戰抬鼻(僅 levi 非 null)
    heavy: heavyRig,
    // 手持武器戰鬥動畫(stepMorph 消費):aimM = 地面型據槍角(肩/肘/腕絕對角,雙槍給雙臂;
    // raptor = 左右手各持一把,雙臂對稱據槍);gunR/gunL 武器俯仰(行軍 rest ↔ 據槍水平 aim ↔
    // 飛行 air 前指);weap 持手分邊;hvy 蓄力/擊發帶符號幅度
    aimM: HANDGUN
      ? { shR: -0.75, shL: -0.75, elR: -0.6, elL: -0.6, wrR: -0.1, wrL: -0.1 }
      // raptor 據槍 = 馳龍收臂式:肩少抬、肘深屈 → 雙槍收在胸前(鏈角總和仍 0.1 ⇒ aim 1.47 不變)
      : G === 'raptor'
        ? { shR: -0.55, shL: -0.55, elR: -0.85, elL: -0.85, wrR: 0.25, wrL: 0.25 }
        : null,
    gunR: morphGunR, gunL: morphGunL,
    // 非手持機種一律 'N' = 機載後座(_kickB 打進軀幹;獸型嘴砲/背砲、atlas 肩架、monkey 肩扛棒砲/尾砲)
    weap: HANDGUN || G === 'raptor' ? { light: 'R', heavy: 'L' } : { light: 'N', heavy: 'N' },
    hvy: HANDGUN ? { armR: 0.15, armL: 0.25, chest: 0.06, gun: 0.06 }
      : G === 'raptor' ? { armR: 0.12, armL: 0.22, chest: 0.05, gun: 0.06 } : { chest: 0.05 },
    lightGlow: morphLGlow
      || (morphLMuz ? [{ mesh: morphLMuz, base: morphLMuz.material.emissiveIntensity }] : atlasLGlow),
    // 槍口錨(曳光起點/槍口焰):手持雙槍 = 右手輕/左手重;飛行型態錨照用 ——
    // 手持機種雙臂前伸、肩扛機種轉背部,槍口在飛行中一樣朝航向(game._entMuzzle 不退訊息座標)
    muzzles: {
      light: morphMuzL || (morphLMuz ? { n: morphLMuz, r: 0.12 }
        : atlasLGlow?.length ? { n: atlasLGlow[0].mesh, r: 0.08 } : null),
      heavy: morphMuzH,
    },
    wpn: { light: morphWpnL, heavy: morphWpnH },   // rig.wpn:FPV 武裝同源(契約見 podWeapon 上方)
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
 *           右手斧砲 —— 152mm 榴彈砲管 + 轉輪彈倉 + 前段側掛大斧刃(隱藏原型:反浩克級外掛重裝甲)
 *  seraph   倒三角上胸(EVA 式):整片上胸是尖端朝下的三角 —— 底邊即肩線、
 *           兩個上端點就是雙肩(肩上再立 binder 莢);細長四肢(加長)、外露肌腱缸、單角單眼;
 *           右手同步狙擊砲 —— 比機體略高的反器材長狙 + 前端刺槍(隱藏原型:EVA 式神經同步人造人)
 *  bastion/seraph 均為手持長兵器:rig.aimPose 讓 locomotion 於「靜止=交戰」時雙手托槍(標準射擊姿勢)、移動時單手持
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
  // 重武器掛點(依 proto 分支填入):glow = 蓄力/擊發發光驅動,pivot = 蓄力/擊發姿態驅動(rest→deploy)
  let heavyRig = { glow: [], pivot: [] };
  // 手持武器射擊姿勢(locomotion 依「靜止度 + 開火保持」把手臂混成標準射擊姿勢):
  // —— 停止(交戰)或開火中 = 據槍(雙手托一把 / 雙槍 / 單手槍,由欄位有無決定),
  //    移動未開火 = 交還步態擺臂(行軍持槍)。角度慣例:肩/肘 rotation.x,
  //    負 x = 手臂朝機體正面(+z)抬起;lShoulderY 正 = 左臂朝中線內收扶護木;
  //    不給左臂欄位 = 單手槍,左臂交還步態(自由)。
  let aimPose = null;
  // 手持武器戰鬥動畫欄位(locomotion stepCombatFx / gunPitch 消費):
  //   weap  = { light:'L'|'R'|'B'|'N', heavy:… } 輕/重武器持手(後座脈衝分邊;'N' = 機載無臂後座)
  //   hvy   = { armR, armL, chest, gun } 蓄力/擊發帶符號幅度(brace 正 = 蓄力托壓/擊發上跳)
  //   gunR/gunL = { g, rest, aim } 武器俯仰群組:行軍持槍角 rest ↔ 據槍水平角 aim
  //     (aim MUST = 1.57 − 手臂射姿總俯仰 —— 據槍時槍口朝前,不是朝天)
  //   lightGlow = [{ mesh, base }] 輕武器槍口識別燈(開火閃光)
  let weap = null, hvy = null, gunR = null, gunL = null, lightGlow = null;
  let muzzles = null;   // 槍口錨 { light:{n,r}, heavy:{n,r} }:曳光起點/槍口焰(makeUnit 掛焰)
  let wpnL = null, wpnH = null;   // rig.wpn(FPV 武裝同源;依 proto 分支填入,契約見 podWeapon 上方)

  if (PR === 'bastion') {
    // ---- 過裝甲重拳:所有量體堆在外層裝甲上,關節是縮在裡面的細軸 ----
    hipY = 2.35;
    gait = { stride: 3.2, bob: 0.16, sway: 0.11, top: 7, armBase: 0.12 };
    const mkLeg = (sx) => segLimb(g, [sx * 0.66, hipY, 0], [
      { len: 1.05, draw: (l) => {
        const ball = cyl(l, 0.3, 0.3, 0.42, 8, 0, 0.02, 0, joint, { metalness: 0.7 });
        ball.rotation.z = Math.PI / 2;                                            // 髖球
        bx(l, 0.82, 1.0, 0.9, 0, -0.55, 0.02, armor, { metalness: 0.6 });         // 巨腿甲
        const hyd = cyl(l, 0.09, 0.09, 0.85, 8, sx * 0.24, -0.5, 0.5, 0x23262a, { metalness: 0.85 });
        hyd.rotation.x = 0.14;                                                    // 大腿正面外露液壓缸
        cyl(l, 0.13, 0.13, 0.1, 8, sx * 0.24, -0.06, 0.44, joint, { metalness: 0.8 });  // 缸頭關節環
        bx(l, 0.3, 0.5, 0.24, sx * 0.48, -0.55, -0.16, armorDk);                  // 側推進莢
      } },
      { len: 0.98, base: 0.05, k: 0.6, d: 0.15, draw: (l) => {
        bx(l, 0.86, 0.36, 0.94, 0, -0.05, 0.08, armorDk);                         // 膝蓋大蓋甲
        for (const ox of [-0.2, 0.2])                                             // 膝後雙活塞桿(隨膝樞軸整組屈伸)
          cyl(l, 0.06, 0.06, 0.78, 6, ox, -0.4, -0.42, 0x23262a, { metalness: 0.85 }).rotation.x = -0.18;
        bx(l, 0.74, 0.92, 0.82, 0, -0.6, -0.04, armor, { metalness: 0.6 });       // 小腿(外擴)
        bx(l, 0.5, 0.4, 0.22, 0, -0.66, -0.46, armorDk);                          // 腿肚配重
        bx(l, 0.6, 0.28, 0.46, 0, -1.0, 0.14, armorDk);                           // 踝部防塵護罩(淺罩;足擺幅小,不被腳背頂穿)
      } },
      { len: 0, base: 0.02, k: -0.3, d: 0.55, draw: (l) => {
        bx(l, 0.76, 0.32, 1.3, 0, -0.18, 0.2, joint);                             // 巨足
        bx(l, 0.78, 0.16, 0.36, 0, -0.12, 0.84, armorDk);                         // 腳尖甲
        bx(l, 0.5, 0.22, 0.2, 0, -0.14, -0.5, armorDk);                           // 腳跟配重板(前尖後跟的戰靴剪影)
      } },
    ], sx < 0 ? legChainL : legChainR);
    legL = mkLeg(-1); legR = mkLeg(1);
    hips.position.y = hipY;
    bx(hips, 1.3, 0.6, 1.0, 0, 0.05, 0, joint, { metalness: 0.6 });               // 骨盆
    bx(hips, 0.9, 0.4, 0.12, 0, -0.05, 0.55, armorDk);                            // 車首下裝甲(補正面空蕩的胯部;淺板避開大腿前掃)
    bx(hips, 0.18, 0.14, 0.1, 0, -0.26, 0.52, joint, { metalness: 0.7 });         // 牽引鉤(戰車車體語彙)
    for (const sx of [-1, 1]) {
      const skirt = bx(hips, 0.6, 0.8, 0.7, sx * 0.85, -0.16, 0, armor);          // 大裙甲
      skirt.rotation.z = sx * 0.2;
      for (const oy of [-0.18, 0.18])                                             // 裙甲 ERA 反應塊(掛 skirt 隨傾角走,零對位成本)
        bx(skirt, 0.1, 0.3, 0.5, sx * 0.31, oy, 0, armorDk, { metalness: 0.6 });
    }
    bx(chest, 1.9, 1.5, 1.5, 0, 1.1, 0, armor, { metalness: 0.6 });               // 桶狀胸廓
    // 乘員艙蛋形凸甲:胸腹正面隆起的蛋,層層疊甲把駕駛艙包成一顆蛋
    const egg = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 9), mat(armor, { metalness: 0.6 }));
    egg.scale.set(1.2, 1.05, 0.75);
    egg.position.set(0, 1.0, 0.6);
    chest.add(egg);
    // T-14 乘員艙語彙:蛋殼不是一體成型 —— 分模線 + 頂部周視潛望鏡,把光蛋讀成「可打開的裝甲艙」
    const seam = cyl(chest, 0.60, 0.60, 0.05, 14, 0, 1.32, 0.60, joint, { metalness: 0.7 });
    seam.scale.set(1.25, 1, 0.78);                                                // 艙蓋分模線(橢圓環半嵌蛋殼截面)
    bx(chest, 0.14, 0.09, 0.16, 0, 1.52, 0.80, joint, { metalness: 0.6 });        // 車長周視潛望鏡(乘員艙唯一對外的眼睛)
    for (const sx of [-1, 1])
      bx(chest, 0.12, 0.08, 0.14, sx * 0.2, 1.48, 0.85, joint, { metalness: 0.6 });  // 乘員潛望鏡對(蛋頂前坡)
    for (const sx of [-1, 1])                                                     // 左右護頸圍甲(填滿肩谷,頭沉在雙肩之間)
      bx(chest, 0.34, 0.42, 0.66, sx * 0.6, 1.92, 0.06, armorDk, { metalness: 0.6 });
    // 圓形反應爐(嵌在乘員艙蛋甲正面):外圈金屬環框 + 圓盤發光核
    const ring = cyl(chest, 0.46, 0.46, 0.14, 14, 0, 1.15, 0.98, armorDk, { metalness: 0.7 });
    ring.rotation.x = Math.PI / 2;
    const core = cyl(chest, 0.32, 0.32, 0.18, 14, 0, 1.15, 1.04, accent, { emissive: accent, emissiveIntensity: 1.5 });
    core.rotation.x = Math.PI / 2;
    bx(chest, 1.4, 0.9, 0.6, 0, 1.75, -0.7, armorDk);                             // 背部散熱堆
    for (let i = 0; i < 4; i++)                                                   // 直立散熱柵(縱柵貼散熱堆背面)
      bx(chest, 0.2, 0.86, 0.1, -0.51 + i * 0.34, 1.75, -1.04, dark, { metalness: 0.7 });
    for (const sx of [-1, 1]) {                                                   // 排氣管(柴油重機甲的背面識別;管口朝後下,非槍管)
      const ex = cyl(chest, 0.09, 0.09, 0.5, 8, sx * 0.58, 1.35, -0.95, dark, { metalness: 0.7 });
      ex.rotation.x = 0.35;
    }
    // 圓弧巨肩(球體 = 動畫感的過裝甲肩)
    let bastionMuzzle = null;   // 右手斧砲的膛口(重武器擊發強閃),手部建構時填入
    let bastionLMuz = null;     // 左手重機槍槍口識別燈(輕武器擊發閃光)
    const mkArm = (sx) => segLimb(chest, [sx * 1.2, 1.38, 0], [
      { len: 0.72, draw: (a) => {
        const pad = new THREE.Mesh(new THREE.SphereGeometry(0.68, 12, 9), mat(armor, { metalness: 0.6 }));
        pad.scale.set(1.0, 0.85, 1.05);
        pad.position.set(sx * 0.18, 0.18, 0);
        a.add(pad);
        bx(a, 0.62, 0.14, 0.78, sx * 0.18, 0.6, 0, dim(accent, 0.85));            // 肩頂識別甲
        bx(a, 0.52, 0.3, 0.1, sx * 0.18, -0.18, 0.62, armorDk, { metalness: 0.6 });  // 肩甲前緣下垂護簷(層疊肩,不是單顆光球)
        bx(a, 0.34, 0.7, 0.38, 0, -0.32, 0, joint);                               // 細上臂軸
      } },
      { len: 1.0, base: -0.15, k: -0.42, d: 0.35, draw: (a) => {
        bx(a, 0.68, 1.0, 0.78, 0, -0.5, 0.02, armor, { metalness: 0.6 });         // 巨前臂(粗於上臂)
        bx(a, 0.2, 0.7, 0.4, sx * 0.42, -0.5, -0.1, armorDk);                     // 前臂外掛甲
        const fhyd = cyl(a, 0.06, 0.06, 0.6, 6, -sx * 0.2, -0.35, 0.44, 0x23262a, { metalness: 0.85 });
        fhyd.rotation.x = -0.3;                                                   // 前臂外露液壓缸(單端錨+斜置,不跨肘樞軸)
        cyl(a, 0.09, 0.09, 0.08, 8, -sx * 0.2, -0.08, 0.36, joint, { metalness: 0.8 });  // 缸頭環
      } },
      { len: 0, base: 0, k: 0.2, d: 0.7, draw: (a) => {
        bx(a, 0.5, 0.44, 0.5, 0, -0.24, 0.04, dark);                              // 巨拳
        if (sx > 0) {
          // ── 斧砲(結合斧頭 + 152mm 榴彈砲):粗短榴彈砲管 + 轉輪彈倉 + 前段側掛大斧刃 ──
          // gl-local +y = 前方;俯仰由 locomotion gunPitch 動態驅動(行軍上揚 ↔ 據槍水平)。
          const gl = new THREE.Group();
          gl.position.set(sx * 0.3, -0.26, 0.36);
          gl.rotation.set(1.36, 0, sx * 0.14);   // rest:行軍持砲略上揚,微外撇避開胸口
          a.add(gl);
          gunR = { g: gl, rest: 1.36, aim: 2.87 };   // aim = 1.57 − (rShoulderX + rElbowX) → 據槍砲口水平朝前
          bx(gl, 0.56, 0.78, 0.56, 0, 0.12, 0, armorDk, { metalness: 0.7 });       // 後膛托(握把段)
          bx(gl, 0.2, 0.34, 0.3, 0, -0.28, -0.3, dark, { metalness: 0.7 });        // 手槍握把 + 護圈
          bx(gl, 0.05, 0.2, 0.26, 0, -0.14, -0.46, 0x14171a);
          // 轉輪彈倉(榴彈鼓):鼓軸與膛室 MUST 與砲管同軸(gl-local +y = 砲口方向)——
          // 左輪手槍的轉輪繞砲軸分度,膛室輪轉到位即對正砲膛(2026-07-16 軸向修正)
          cyl(gl, 0.44, 0.44, 0.5, 10, 0, 0.72, 0.12, armor, { metalness: 0.65 });
          for (let i = 0; i < 6; i++) {                                             // 鼓上榴彈膛(∥ 砲管)
            const th = i / 6 * Math.PI * 2;
            cyl(gl, 0.07, 0.07, 0.52, 6, Math.cos(th) * 0.28, 0.72, 0.12 + Math.sin(th) * 0.28, 0x14171a);
          }
          cyl(gl, 0.24, 0.28, 2.5, 10, 0, 1.9, 0, 0x1a1d20, { metalness: 0.82 });  // 榴彈砲主管(粗短)
          for (const oy of [1.1, 1.7])                                              // 砲管加強環
            cyl(gl, 0.31, 0.31, 0.12, 10, 0, oy, 0, armorDk, { metalness: 0.75 });
          for (const ox of [-0.3, 0.3])                                             // 駐退復進機(雙筒)
            cyl(gl, 0.09, 0.09, 1.3, 6, ox, 1.0, -0.12, 0x23262a, { metalness: 0.8 });
          cyl(gl, 0.34, 0.34, 0.5, 10, 0, 3.05, 0, 0x0d0f11, { metalness: 0.85 }); // 槍口制退器
          bastionMuzzle = cyl(gl, 0.3, 0.3, 0.16, 10, 0, 3.32, 0, accent,
            { emissive: accent, emissiveIntensity: 0.3 });                          // 膛口(擊發強閃)
          // 大斧刃:寬弧斧面沿砲管前段側掛(斧頭特徵),斧背反刃配重
          const axe = new THREE.Group();
          axe.position.set(sx * 0.28, 2.25, 0.02);
          gl.add(axe);
          bx(axe, 0.16, 1.7, 1.5, sx * 0.34, 0, 0.28, armorDk, { metalness: 0.72 });   // 斧刃主面
          for (const oy of [-1, 1]) {                                                  // 月牙收弧端板(上下端向斧背斜收 → 刃緣外凸弧)
            const tip = bx(axe, 0.15, 0.6, 1.05, sx * 0.34, oy * 0.98, 0.06, armorDk, { metalness: 0.72 });
            tip.rotation.x = -oy * 0.5;
          }
          bx(axe, 0.1, 2.3, 0.58, sx * 0.52, 0, 0.72, dim(accent, 0.95));              // 斧刃前緣識別(月牙輪廓亮線)
          bx(axe, 0.14, 0.9, 0.5, sx * 0.3, 0, -0.5, dark, { metalness: 0.7 });        // 斧背反刃(鉤)
          // rig.wpn heavy:右手斧砲單根 gl(轉輪彈倉/砲管/斧刃皆其子節點)→ ref=gl;
          // 膛口 bastionMuzzle 在 gl 局部 y=+3.32、後膛托 +0.12(gl-local +y = 前方)⇒ fwd 'y'
          wpnH = { nodes: [gl], ref: gl, muz: bastionMuzzle, fwd: 'y' };
        } else {
          // ── 左手 12.7 同軸重機槍(Kord 式,輕武器):輕/重異型 → 雙槍 —— 左手輕武器與
          // 右手斧砲成對舉槍(dual-wield 射姿);散熱套筒 + 彈鏈箱 + 提把 + 制退器。
          const gl = new THREE.Group();
          gl.position.set(sx * 0.3, -0.26, 0.36);
          gl.rotation.set(1.36, 0, sx * 0.14);
          a.add(gl);
          gunL = { g: gl, rest: 1.36, aim: 2.87 };
          bx(gl, 0.34, 0.62, 0.4, 0, 0.1, 0, armorDk, { metalness: 0.7 });          // 機匣
          bx(gl, 0.16, 0.3, 0.26, 0, -0.24, -0.26, dark, { metalness: 0.7 });       // 握把
          cyl(gl, 0.13, 0.13, 1.7, 8, 0, 1.25, 0, 0x1a1d20, { metalness: 0.82 });   // 槍管
          for (const oy of [0.7, 1.0, 1.3, 1.6])                                    // 散熱套筒環(Kord 識別)
            cyl(gl, 0.17, 0.17, 0.09, 8, 0, oy, 0, 0x23262a, { metalness: 0.78 });
          bx(gl, 0.3, 0.34, 0.06, 0, 2.2, 0, 0x0d0f11, { metalness: 0.85 });        // 平板制退器(橫翼)
          bastionLMuz = cyl(gl, 0.1, 0.1, 0.1, 8, 0, 2.28, 0, accent,
            { emissive: accent, emissiveIntensity: 0.8 });                           // 槍口識別燈(擊發閃光)
          bx(gl, 0.4, 0.5, 0.34, sx * 0.32, 0.16, 0.02, armor, { metalness: 0.6 }); // 彈鏈箱(外側掛)
          bx(gl, 0.34, 0.1, 0.3, sx * 0.32, 0.44, 0.02, dim(accent, 0.8));          // 彈箱蓋識別
          bx(gl, 0.08, 0.5, 0.12, 0, 0.35, -0.3, 0x23262a, { metalness: 0.7 });     // 提把
          // rig.wpn light:左手 Kord 單根 gl(機匣/槍管/彈鏈箱皆其子節點)→ ref=gl;
          // 槍口燈 bastionLMuz 在 gl 局部 y=+2.28、機匣 +0.1(gl-local +y = 前方)⇒ fwd 'y'
          wpnL = { nodes: [gl], ref: gl, muz: bastionLMuz, fwd: 'y' };
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
    // 重武器(152mm 榴彈砲)已整合進右手斧砲 —— 擊發表現靠膛口強閃 + 據槍射姿 + 蓄力反向後座,
    // 不再另掛背部砲管(避免斧砲 + 背砲兩門榴彈砲的冗餘)。
    heavyRig = { glow: [{ mesh: bastionMuzzle, base: 0.3 }], pivot: [] };
    // 雙槍射姿(輕 gun × 重 launcher 異型 → 一手一把):左右對稱平舉 —— 左手重機槍、右手斧砲
    // 同時指向正面;槍口朝前由 gunR/gunL 的 aim 角解算(1.57 − 1.30 → 2.87)。
    aimPose = { rShoulderX: -0.78, rElbowX: -0.52, lShoulderX: -0.78, lShoulderY: 0, lElbowX: -0.52 };
    weap = { light: 'L', heavy: 'R' };
    hvy = { armR: 0.22, armL: 0.1, chest: 0.07, gun: 0.06 };   // brace:擊發砲口上跳、胸腔後仰
    lightGlow = [{ mesh: bastionLMuz, base: 0.8 }];
    muzzles = { light: { n: bastionLMuz, r: 0.1 }, heavy: { n: bastionMuzzle, r: 0.3 } };

  } else if (PR === 'seraph') {
    // ---- 倒三角上胸:寬肩窄腰、細長四肢、關節外露肌腱缸(生體感) ----
    hipY = 2.9;
    gait = { stride: 4.0, bob: 0.1, sway: 0.07, top: 8, armBase: 0.05 };
    // 雙件式肌腱缸:缸體收在上段,下段外露亮色活塞桿(生體 × 機構的縫合感)
    const sinew = (p, h, x, y, z) => {
      cyl(p, 0.11, 0.11, h * 0.62, 8, x, y + h * 0.16, z, 0x23262a, { metalness: 0.8 });
      cyl(p, 0.05, 0.05, h * 0.92, 6, x, y - h * 0.06, z, PAL.lite, { metalness: 0.9 });
    };
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
        bx(l, 0.1, 0.9, 0.08, 0, -0.66, 0.24, PAL.lite, { metalness: 0.9 });      // 脛前亮刃(硬邊高光稜線,細腿遠距仍有銳利直線)
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
    for (const sx of [-1, 1])                                                     // 窄腰側肋(EVA 細腰是一節節肋甲,不是一根方柱)
      bx(chest, 0.07, 0.75, 0.55, sx * 0.25, 0.95, 0.02, armorDk);
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
    // 高聳肩甲莢(EVA 的肩部 binder):立在三角形兩個上端點的正上方 ——
    // 兼作重武器(同步狙擊砲)蓄力展示器:蓄力時莢頂識別條發光轉強、雙莢向外展開如展翼。
    const binderTrims = [], binderPivots = [];
    for (const sx of [-1, 1]) {
      const piv = new THREE.Group();
      piv.position.set(sx * 1.26, 2.72, -0.04);
      chest.add(piv);
      bx(piv, 0.3, 1.45, 0.9, 0, 0.18, 0, armor, { metalness: 0.7 });             // 高聳縱長薄板(pylon 剪影)
      const trim = bx(piv, 0.32, 0.16, 0.92, 0, 0.78, 0, dim(accent, 0.85),
        { emissive: accent, emissiveIntensity: 0.9 });                            // 莢頂識別條(蓄力發光)
      binderTrims.push(trim);
      // binder 細節 MUST 掛 piv 才會跟著蓄力展翼(掛 chest 會在 deploy 時脫隊)
      bx(piv, 0.05, 1.0, 0.7, sx * 0.19, 0.1, 0, armorDk);                        // 外側凹槽板(武器艙的面板分割,不是一片光板)
      bx(piv, 0.32, 0.28, 0.94, 0, -0.58, 0, joint);                              // 底部收束楔(包住底緣配重,立板不再像紙片)
      bx(piv, 0.24, 0.06, 0.05, 0, 0.42, 0.47, dark, { metalness: 0.7 });         // 前面通風暗槽(與莢頂發光條對比)
      binderPivots.push({ obj: piv, rest: { x: 0, y: 0, z: 0 }, deploy: { x: 0, y: sx * 0.5, z: 0 } });
    }
    cyl(chest, 0.34, 0.34, 0.05, 12, 0, 1.62, 0.5, joint, { metalness: 0.7 })
      .rotation.x = Math.PI / 2;                                                  // 核心金屬座環(發光核不直接長在裝甲上)
    bx(chest, 0.44, 0.44, 0.24, 0, 1.62, 0.52, accent, { emissive: accent, emissiveIntensity: 1.3 });  // 核心
    for (const yy of [1.7, 1.35, 1.0])                                            // 脊椎神經插栓列(連接埠下方;腦機介面的本業在背面)
      cyl(chest, 0.1, 0.1, 0.12, 8, 0, yy, -0.5, joint, { metalness: 0.8 }).rotation.x = Math.PI / 2;
    bx(chest, 0.7, 0.6, 0.5, 0, 2.1, -0.55, armorDk);                             // 背部連接埠
    const usok = cyl(chest, 0.17, 0.17, 0.16, 10, 0, 2.1, -0.86, 0x14171a, { metalness: 0.85 });
    usok.rotation.x = Math.PI / 2;                                                // 臍帶纜圓形插座(電源臍帶的接口)
    const uring = cyl(chest, 0.22, 0.22, 0.06, 10, 0, 2.1, -0.82, dim(accent, 0.8), { emissive: accent, emissiveIntensity: 0.5 });
    uring.rotation.x = Math.PI / 2;                                               // 插座外圈識別環
    let lanceCore = null;   // 同步狙擊砲的軌間電漿(重武器蓄力發光,右臂建構時填入)
    let lanceSub = null;    // 下掛高斯衝鋒模組的副槍口(輕武器模式擊發閃光)
    let lanceHMuz = null;   // 主砲膛口(重模式擊發強閃/槍口焰錨)
    // 雙肩 = 倒三角的兩個上端點(肩線橫樑末端)。手臂加長(使用者指示):細長四肢再拉長,
    // 上臂/前臂各 +0.35,好讓雙手托住比機體略高的長狙擊砲(標準射擊姿勢)。
    const mkArm = (sx) => segLimb(chest, [sx * 1.25, 2.28, 0], [
      { len: 1.45, draw: (a) => {
        bx(a, 0.5, 0.5, 0.56, 0, 0.1, 0, armorDk, { metalness: 0.7 });            // 窄肩座
        sinew(a, 1.55, 0, -0.72, 0);
        bx(a, 0.28, 1.3, 0.32, 0, -0.68, 0.02, armor, { metalness: 0.7 });        // 細長上臂(加長)
      } },
      { len: 1.3, base: -0.2, k: -0.6, d: 0.3, draw: (a) => {
        bx(a, 0.32, 0.24, 0.36, 0, -0.02, 0, joint);                              // 肘關節
        sinew(a, 1.35, 0, -0.66, 0);
        bx(a, 0.24, 1.2, 0.28, 0, -0.64, 0.02, armor, { metalness: 0.7 });        // 細長前臂(加長)
        bx(a, 0.3, 0.28, 0.34, 0, -1.12, 0.02, armorDk, { metalness: 0.7 });      // 腕部收束護腕(肌腱缸自此入鞘;不越腕樞軸)
      } },
      { len: 0, base: 0, k: 0.24, d: 0.6, draw: (a) => {
        bx(a, 0.24, 0.28, 0.3, 0, -0.14, 0.02, dark);                             // 掌
        if (sx > 0) {
          // ── 同步狙擊砲(反器材長狙):比機體略高的加速砲身 + 前端刺槍(bayonet)──
          // 輕/重同型(rail×rail)→ 雙手托同一把,切換兩種模式:重 = 主砲身蓄力極速直擊,
          // 輕 = 下掛高斯衝鋒模組(短線圈速射)。lance-local +y = 前方;
          // 俯仰由 gunPitch 動態驅動(行軍上揚 ↔ 據槍水平)。
          const lance = new THREE.Group();
          lance.position.set(sx * 0.14, -0.2, 0.22);
          lance.rotation.x = 1.52;                                                 // rest:行軍持槍
          a.add(lance);
          gunR = { g: lance, rest: 1.52, aim: 2.74 };   // aim = 1.57 − (−0.62 − 0.55) → 據槍砲口水平
          bx(lance, 0.5, 0.9, 0.42, 0, 0.15, 0, armorDk, { metalness: 0.72 });    // 後膛托(握把段)
          bx(lance, 0.14, 0.4, 0.3, 0, 0.05, 0.34, dark, { metalness: 0.7 });     // 主握把(扳機組)
          bx(lance, 0.4, 0.24, 0.1, 0, -0.35, 0.05, armor, { metalness: 0.7 });   // 槍托肩墊
          // 下掛高斯衝鋒模組(輕武器模式):短線圈套筒 ×3 + 彈匣 + 前握把 + 副槍口(擊發閃光)。
          // lance-local +z = 據槍時的正下方(rotation.x 帶著整把轉,模組恆在主砲身下側)
          for (let i = 0; i < 3; i++)
            cyl(lance, 0.11, 0.11, 0.16, 8, 0, 1.05 + i * 0.28, 0.3, 0x23262a, { metalness: 0.8 });  // 線圈套筒
          cyl(lance, 0.07, 0.07, 1.1, 6, 0, 1.3, 0.3, 0x14171a, { metalness: 0.85 });   // 副槍管
          lanceSub = cyl(lance, 0.08, 0.08, 0.08, 6, 0, 1.88, 0.3, accent,
            { emissive: accent, emissiveIntensity: 0.7 });                          // 副槍口識別燈
          bx(lance, 0.1, 0.34, 0.24, 0, 0.72, 0.42, dark, { metalness: 0.7 });     // 彈匣(下插)
          bx(lance, 0.09, 0.2, 0.3, 0, 2.3, 0.28, 0x23262a, { metalness: 0.7 });   // 前握把(左手扶位)
          cyl(lance, 0.17, 0.2, 5.6, 10, 0, 3.0, 0, 0x1a1d20, { metalness: 0.85 });  // 主砲身(加長)
          for (const o of [-0.17, 0.17])
            cyl(lance, 0.07, 0.07, 5.2, 6, o, 3.0, 0.02, 0x14171a, { metalness: 0.85 });  // 雙軌加速器
          lanceCore = cyl(lance, 0.06, 0.06, 4.8, 6, 0, 2.9, 0, accent, { emissive: accent, emissiveIntensity: 1.4 });  // 軌間電漿芯
          const scope = cyl(lance, 0.12, 0.12, 1.1, 8, 0, 1.5, -0.34, 0x0e1114, { metalness: 0.8 });
          scope.rotation.x = Math.PI / 2;                                          // 光學瞄準鏡(砲身上方)
          cyl(lance, 0.13, 0.13, 0.08, 8, 0, 1.5, -0.9, accent, { emissive: accent, emissiveIntensity: 1.2 }).rotation.x = Math.PI / 2;  // 物鏡發光
          cyl(lance, 0.26, 0.26, 0.5, 10, 0, 5.5, 0, 0x0d0f11, { metalness: 0.85 });  // 槍口制退器
          lanceHMuz = cyl(lance, 0.21, 0.21, 0.08, 10, 0, 5.79, 0, accent,
            { emissive: accent, emissiveIntensity: 0.6 });                          // 主砲膛口(重模式擊發強閃)
          // 前端刺槍(bayonet):細長雙刃刺,自砲口再向前伸出
          const bayo = new THREE.Mesh(new THREE.ConeGeometry(0.13, 1.5, 4), mat(dim(accent, 1.15), { metalness: 0.85 }));
          bayo.position.set(0, 6.35, 0);
          lance.add(bayo);
          bx(lance, 0.05, 0.9, 0.34, 0, 5.95, 0, dim(accent, 0.9), { metalness: 0.8 });  // 刺槍側刃
          // rig.wpn:同型雙手一把(rail×rail)單根 lance → 同一組 nodes/ref,只有 muz 不同;
          // 副槍口 lanceSub 在 lance 局部 y=+1.88、主砲膛口 lanceHMuz y=+5.79、後膛托 +0.15
          // (lance-local +y = 前方)⇒ fwd 'y'
          const lanceNodes = [lance];
          wpnL = { nodes: lanceNodes, ref: lance, muz: lanceSub, fwd: 'y' };
          wpnH = { nodes: lanceNodes, ref: lance, muz: lanceHMuz, fwd: 'y' };
        }
      } },
    ], sx < 0 ? armChainL : armChainR);
    armL = mkArm(-1); armR = mkArm(1);
    // 重武器(同步狙擊砲)= 手持長槍本體(蓄力時軌間電漿轉亮)+ binder 莢艙(蓄力展翼)
    heavyRig = {
      glow: [
        { mesh: lanceCore, base: 1.4 },
        { mesh: lanceHMuz, base: 0.6 },
        { mesh: binderTrims[0], base: 0.9 },
        { mesh: binderTrims[1], base: 0.9 },
      ],
      pivot: binderPivots,
    };
    muzzles = { light: { n: lanceSub, r: 0.09 }, heavy: { n: lanceHMuz, r: 0.21 } };
    // 雙手托長狙姿(標準射擊):右肩抬起端平砲身、左臂前伸內收扶前握把;
    // 據槍時砲身由 gunPitch 轉到水平(槍口朝前),左手角度配合水平砲身的前握把位置
    aimPose = { rShoulderX: -0.62, rElbowX: -0.55, lShoulderX: -0.9, lShoulderY: 0.55, lElbowX: -0.55 };
    weap = { light: 'B', heavy: 'B' };   // 同一把雙手持:輕/重開火雙臂一起後座
    hvy = { armR: 0.14, armL: 0.14, chest: 0.06, gun: 0.06 };   // brace:蓄力抵肩下壓、擊發上跳後仰
    lightGlow = [{ mesh: lanceSub, base: 0.7 }];
    // 頭:單角 + 單眼掃描條(細長頸,自肩線橫樑中央探出 —— EVA 的小頭窄臉)
    head.position.set(0, 2.72, 0.06);
    sinew(head, 0.5, 0, -0.28, 0);
    bx(head, 0.42, 0.46, 0.5, 0, 0.1, 0, armor, { metalness: 0.7 });
    const jaw = bx(head, 0.28, 0.18, 0.34, 0, -0.08, 0.32, armorDk, { metalness: 0.7 });
    jaw.rotation.x = 0.12;                                                        // 前伸顎部楔形(獸形臉的下顎)
    bx(head, 0.26, 0.04, 0.3, 0, -0.16, 0.32, dark);                              // 咬合線
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 9),
      mat(accent, { emissive: accent, emissiveIntensity: 2.0 }));
    eye.position.set(0, 0.12, 0.27);
    head.add(eye);                                                                // 單圓獨眼
    bx(head, 0.3, 0.06, 0.1, 0, 0.26, 0.25, armorDk);                             // 壓眉稜(獨眼上方的兇相)
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.9, 5), mat(dim(accent, 0.9), { metalness: 0.8 }));
    horn.position.set(0, 0.5, 0.1);
    horn.rotation.x = -0.25;
    head.add(horn);                                                                // 額角
    for (const sx of [-1, 1])                                                      // 頰側甲(單眼窄臉的面板分割)
      bx(head, 0.1, 0.2, 0.3, sx * 0.24, 0.06, 0.08, armorDk, { metalness: 0.7 });
    bx(head, 0.3, 0.06, 0.05, 0, 0.2, -0.27, dim(accent, 0.8),
      { emissive: accent, emissiveIntensity: 0.6 });                               // 後腦識別條(靜態識別燈,MUST NOT 掛 glows)

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
        bx(l, 0.42, 0.8, 0.08, 0, -0.58, 0.33, armorDk);                          // 脛前護甲(盾線步兵的護脛)
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
    const radar = bx(chest, 0.92, 0.56, 0.08, 0, 1.66, 0.44, armorDk, { metalness: 0.7 });
    radar.rotation.x = -0.35;                                                      // 胸上相控陣雷達板(斜仰對空)
    for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++)                        // 陣面收發單元
      bx(chest, 0.1, 0.1, 0.04, (j - 1) * 0.26, 1.58 + i * 0.2, 0.49 + i * 0.07,
        dim(accent, 0.85), { emissive: accent, emissiveIntensity: 0.6 });
    for (const sx of [-1, 1])                                                      // 胸側 IFF 識別燈(防空最怕誤擊友軍;靜態,不掛 glows)
      bx(chest, 0.08, 0.08, 0.06, sx * 0.62, 1.0, 0.56, dim(accent, 0.9), { emissive: accent, emissiveIntensity: 0.8 });
    // Pantsir 彈炮合一 = 雙雷達:胸前相控陣(搜索)+ 背部追蹤雷達盤 —— 背視角的臉;
    // 陣面板是靜態識別發光,MUST NOT 掛 heavyRig.glow(擊發脈動只屬於 VLS 管口)
    const trad = cyl(chest, 0.34, 0.34, 0.08, 12, 0, 1.62, -0.64, armorDk, { metalness: 0.7 });
    trad.rotation.x = 1.05;                                                        // 追蹤雷達盤(對空面朝後上)
    const tf = bx(chest, 0.42, 0.32, 0.03, 0, 1.65, -0.68, dim(accent, 0.85), { emissive: accent, emissiveIntensity: 0.5 });
    tf.rotation.x = 1.05;                                                          // 追蹤陣面板
    // 雙肩垂直發射彈艙(攔截彈 VLS:每側 2×3 發射管口朝上)—— 造型與重武器(攔截者飛彈)天生一致,
    // 原地轉為功能性掛點:發射管口在擊發瞬間齊閃,不需另掛新量體。
    const vlsCells = [];
    const vlsBoxes = [];   // rig.wpn 節點集:雙肩 VLS 箱 ×2(筒身/管口皆其子節點)
    for (const sx of [-1, 1]) {
      const vls = bx(chest, 0.66, 0.62, 0.78, sx * 1.0, 1.85, -0.1, armorDk, { metalness: 0.65 });
      vlsBoxes.push(vls);
      for (const oz of [-0.2, 0.2])                                                // 側掛再裝填彈筒(攔截彈永遠不夠用;不高出箱頂、無發光管口)
        cyl(vls, 0.08, 0.08, 0.5, 8, sx * 0.41, 0, oz, dark, { metalness: 0.75 });
      for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) {
        cyl(vls, 0.1, 0.1, 0.44, 6, (i - 0.5) * 0.28, 0.16, (j - 1) * 0.24, 0x14171a, { metalness: 0.8 });   // 外露發射筒身(半埋箱體、筒口朝天)
        vlsCells.push(cyl(vls, 0.09, 0.09, 0.1, 6, (i - 0.5) * 0.28, 0.42, (j - 1) * 0.24, accent,
          { emissive: accent, emissiveIntensity: 1.0 }));                          // 發射管口
      }
    }
    heavyRig = { glow: vlsCells.map((mesh) => ({ mesh, base: 1.0 })), pivot: [] };
    // rig.wpn heavy:雙肩 VLS 散件(vls 箱 ×2,十二管 cells 皆在其子樹內)掛 chest → ref=chest;
    // 管口朝上(+y)是 VLS 的本體特徵 —— fwd 刻意登記 'z'(機體前向)保持直立,FPV 原樣呈現朝上的 VLS
    wpnH = { nodes: vlsBoxes, ref: chest, muz: vlsCells[0], fwd: 'z' };
    let aegisMuz = null;   // 右前臂速射砲砲口(輕武器擊發閃光),手臂建構時填入
    const mkArm = (sx) => segLimb(chest, [sx * 0.98, 1.7, 0], [
      { len: 0.78, draw: (a) => {
        bx(a, 0.62, 0.48, 0.66, 0, 0.1, 0, armorDk, { metalness: 0.6 });          // 肩甲
        if (sx < 0) {                                                             // 持盾側外掛肩側裙甲(不對稱防禦剪影)
          const guard = bx(a, 0.2, 0.7, 0.7, sx * 0.42, -0.1, 0.1, armor, { metalness: 0.6 });
          guard.rotation.z = sx * 0.12;
          bx(a, 0.06, 0.6, 0.14, sx * 0.53, -0.1, 0.38, dim(accent, 0.85));       // 裙甲前緣識別稜
        }
        bx(a, 0.3, 0.6, 0.34, 0, -0.36, 0, joint);                                // 上臂
      } },
      { len: 0.9, base: -0.35, k: -0.5, d: 0.32, draw: (a) => {
        bx(a, 0.42, 0.85, 0.46, 0, -0.42, 0.02, armor, { metalness: 0.6 });       // 前臂
        if (sx > 0) {
          // 右前臂 = 30mm 速射砲(2A42 式):砲身掛在俯仰群組上 —— 舉臂射姿時 gunPitch
          // 反向補償手臂俯仰,砲口恆水平朝前;護筒 + 制退器 + 供彈滑槽強化辨識
          const gg = new THREE.Group();
          gg.position.set(0, -0.5, 0.15);
          a.add(gg);
          gunR = { g: gg, rest: 0.25, aim: 0.85 };   // +z 砲管:rest/aim = 抵銷臂俯仰(−0.25 / −0.85)
          for (const ox of [-0.1, 0.1]) {                                           // 雙聯裝速射砲管(並列成對)
            const b = cyl(gg, 0.095, 0.11, 1.9, 8, ox, 0, 0.55, 0x1a1d20, { metalness: 0.85 });
            b.rotation.x = Math.PI / 2;
          }
          cyl(gg, 0.22, 0.22, 0.7, 8, 0, 0, 0.35, armorDk, { metalness: 0.7 })
            .rotation.x = Math.PI / 2;                                              // 砲身護筒(罩住雙管根部)
          bx(gg, 0.42, 0.2, 0.3, 0, 0, 1.42, 0x0d0f11, { metalness: 0.85 });        // 平板多孔制退器(蓋住雙管口)
          aegisMuz = cyl(gg, 0.16, 0.16, 0.12, 8, 0, 0, 1.6, accent,
            { emissive: accent, emissiveIntensity: 1.0 });
          aegisMuz.rotation.x = Math.PI / 2;                                        // 砲口識別燈(擊發閃光)
          bx(gg, 0.14, 0.1, 0.6, 0, 0.16, -0.1, 0x23262a, { metalness: 0.7 });     // 供彈滑槽(連向供彈箱)
          bx(a, 0.3, 0.34, 0.4, 0, -0.2, -0.32, armorDk);                          // 供彈箱
          // rig.wpn light:右前臂速射砲單根 gg(雙管/護筒/制退器皆其子節點)→ ref=gg;
          // 砲口燈 aegisMuz 在 gg 局部 z=+1.6、雙管 +0.55(+z 砲管)⇒ fwd 'z'(已驗證)
          wpnL = { nodes: [gg], ref: gg, muz: aegisMuz, fwd: 'z' };
        } else {
          // 左前臂 = 方形塔盾(盾面外掛;邊框 + 主色十字肋)
          const sh = new THREE.Group();
          sh.position.set(sx * 0.42, -0.5, 0.24);
          sh.rotation.z = sx * 0.06;
          a.add(sh);
          bx(sh, 0.22, 2.9, 1.9, 0, 0, 0, armor, { metalness: 0.6 });              // 盾面
          for (const oz of [-0.6, 0.6])                                            // 盾底雙接地齒(立地駐鋤)
            bx(sh, 0.18, 0.34, 0.22, 0, -1.6, oz, dark, { metalness: 0.7 });
          const brim = bx(sh, 0.3, 0.16, 1.96, sx * 0.06, 1.5, 0, armorDk, { metalness: 0.6 });
          brim.rotation.z = sx * 0.3;                                              // 盾頂外翻簷(盾上緣向外側翻)
          bx(sh, 0.1, 3.0, 0.24, sx * 0.14, 0, 0.9, armorDk);                      // 盾緣
          bx(sh, 0.1, 3.0, 0.24, sx * 0.14, 0, -0.9, armorDk);
          bx(sh, 0.12, 2.5, 0.2, sx * 0.16, 0, 0, accent, { emissive: accent, emissiveIntensity: 0.8 });  // 縱肋
          bx(sh, 0.12, 0.2, 1.5, sx * 0.16, 0.5, 0, accent, { emissive: accent, emissiveIntensity: 0.8 }); // 橫肋
          bx(sh, 0.06, 1.7, 1.2, sx * 0.13, 0.25, 0, armorDk, { metalness: 0.6 }); // 附加裝甲層(複合雙層盾面;薄於發光肋 → 十字肋仍凸出)
          bx(sh, 0.06, 0.2, 0.66, sx * 0.17, 0.95, 0.3, dark, { metalness: 0.3 }); // 觀察窗(持盾兵躲在盾後看世界的那道縫)
          for (const oy of [-1.22, 1.22]) for (const oz of [-0.72, 0.72])          // 盾角防撞塊(立地駐鋤砸出來的耐用感)
            bx(sh, 0.1, 0.28, 0.28, sx * 0.15, oy, oz, joint, { metalness: 0.7 });
        }
      } },
      { len: 0, base: 0, k: 0.2, d: 0.62, draw: (a) => {
        bx(a, 0.3, 0.32, 0.34, 0, -0.16, 0.04, dark);                              // 拳
      } },
    ], sx < 0 ? armChainL : armChainR);
    armL = mkArm(-1); armR = mkArm(1);
    // 攔截機射姿(前臂固定砲,非手持 → 只舉右砲臂;左臂欄位不給 = 塔盾照常守位/擺動):
    // 舉臂幅度刻意小(−0.5),砲口水平交給 gunPitch 的 rest/aim 反向補償
    aimPose = { rShoulderX: -0.5, rElbowX: -0.35 };
    weap = { light: 'R', heavy: 'N' };   // 重武器 = 雙肩 VLS(機載後座走 _kickB)
    hvy = { chest: 0.05 };               // 攔截彈齊射:胸腔輕微後仰
    lightGlow = [{ mesh: aegisMuz, base: 1.0 }];
    muzzles = { light: { n: aegisMuz, r: 0.16 }, heavy: { n: vlsCells[0], r: 0.09 } };
    // 頭:雙感測窗 + 側耳雷達
    head.position.set(0, 2.15, 0.06);
    bx(head, 0.5, 0.42, 0.52, 0, 0.08, 0, armorDk, { metalness: 0.6 });
    bx(head, 0.44, 0.08, 0.14, 0, 0.24, 0.22, armorDk);                            // 前額遮光簷(一直在對空看的射手帽簷;零增高)
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
    for (const sx of [-1, 1])                                                       // 髖關節橫軸環(半埋骨盆端;bob 相對位移 ≤0.09 由半埋吸收)
      cyl(hips, 0.17, 0.17, 0.26, 10, sx * 0.55, 0, 0, joint, { metalness: 0.8 }).rotation.z = Math.PI / 2;
    cyl(hips, 0.52, 0.52, 0.2, 12, 0, 0.28, -0.04, joint, { metalness: 0.8 });      // 胸腹平端關節環(墊住骨盆↔身軀圓角接縫不張口)
    const body = rslab(chest, 1.5, 2.3, 0.95, 0, 1.28, -0.06, armor);               // 圓角矩形身軀
    body.rotation.x = -0.1;                                                          // 微拱背
    rslab(chest, 0.7, 1.2, 0.9, 0, 0.35, -0.02, armorDk).rotation.z = Math.PI / 2;  // 腹部第二節板(橫置:體節語彙自四肢貫通到軀幹)
    rslab(chest, 1.08, 1.6, 0.92, 0, 1.32, 0.1, dim(armor, 1.08));                  // 前胸圓角板
    for (const sx of [-1, 1])                                                        // 肩關節橫軸環:stepBiped 擺臂軸(rotation.x)有了看得見的軸
      cyl(chest, 0.16, 0.16, 0.3, 10, sx * 0.62, 2.0, -0.05, joint, { metalness: 0.8 }).rotation.z = Math.PI / 2;
    cyl(chest, 0.24, 0.24, 0.09, 12, 0, 2.44, 0.02, joint, { metalness: 0.75 });     // 頸基座環(頭是武器塔,塔要有座圈;內徑留頸轉餘裕)
    for (const sx of [-1, 1])                                                       // 胸前縱肋線(胸甲分割,夾著中央紋章縱列)
      rslab(chest, 0.09, 1.24, 0.08, sx * 0.38, 1.3, 0.58, armorDk);
    rslab(chest, 0.52, 1.3, 0.05, 0, 1.54, 0.57, dim(armor, 0.94));                 // 紋章艙蓋框(同色暗半階的面板分割;光點鑲進蓋框)
    for (let i = 0; i < 3; i++)                                                      // 胸口紋章(縱列光點)
      cyl(chest, 0.07, 0.07, 0.1, 8, 0, 1.88 - i * 0.34, 0.58, accent, { emissive: accent, emissiveIntensity: 1.2 })
        .rotation.x = Math.PI / 2;
    let colMuz = null;   // 右手掃描脈衝槍槍口光核(輕武器擊發閃光),手臂建構時填入
    const mkArm = (sx) => segLimb(chest, [sx * 0.92, 2.0, -0.05], [
      { len: 1.2, draw: (a) => {
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.44, 12, 9), mat(armor, { metalness: 0.6 }));
        dome.scale.set(1, 0.8, 1);
        dome.position.y = 0.1;
        a.add(dome);                                                                 // 圓肩甲
        seg2(a, 0.5, 1.2, 0.42, armor, armorDk);                                     // 上臂節
        const op = rslab(a, 0.36, 0.9, 0.1, sx * 0.3, -0.55, 0.02, armorDk);
        op.rotation.y = Math.PI / 2;                                                 // 上臂外側圓角護板(體節疊拼補側向第二層次)
      } },
      { len: 1.35, base: -0.26, k: -0.55, d: 0.3, draw: (a) => seg2(a, 0.44, 1.35, 0.38, armor, armorDk) },  // 前臂節(長臂垂地:自然下垂指尖過膝)
      { len: 0.92, base: -0.22, k: -0.36, d: 0.48, draw: (a) => {
        seg2(a, 0.38, 0.92, 0.32, armorDk, armor);                                   // 腕節
        if (sx < 0) {
          // 左腕 RF 測向環(右腕持槍 → 不對稱 = 機能分工):舉臂「聽」頻譜的道具;
          // 細識別環是靜態 emissive,MUST NOT 進 glows —— 發光戰鬥語彙只屬於眉心與槍口
          cyl(a, 0.26, 0.26, 0.09, 12, 0, -0.55, 0.02, joint, { metalness: 0.8 });
          cyl(a, 0.27, 0.27, 0.03, 12, 0, -0.49, 0.02, dim(accent, 0.85), { emissive: accent, emissiveIntensity: 0.6 });
        }
      } },
      { len: 0, base: -0.08, k: -0.26, d: 0.66, draw: (a) => {
        for (let i = -1; i <= 1; i++) {
          const fg = rslab(a, 0.13, 0.56, 0.16, i * 0.14, -0.28, 0.03, dark);
          fg.rotation.z = i * 0.1;                                                   // 三指(圓角長指)
        }
        if (sx > 0) {
          cyl(a, 0.08, 0.08, 0.14, 8, 0, -0.3, 0.16, accent,
            { emissive: accent, emissiveIntensity: 1.0 }).rotation.x = Math.PI / 2;  // 右掌心測向器
          // ── 右手掃描脈衝槍(輕武器,單手持):圓角矩形機匣(與巨兵語彙一致)+ 圓柱射束器
          // + 聚焦環 ×2 + 槍口光核 —— 重武器仍是眉心標定脈衝砲(機體固定,不入手)
          const gg = new THREE.Group();
          gg.position.set(0, -0.34, 0.14);
          gg.rotation.x = 1.4;                                                       // rest:行軍持槍
          a.add(gg);
          gunR = { g: gg, rest: 1.4, aim: 3.02 };   // aim = 1.57 − (−0.8 − 0.35 − 0.22 − 0.08)
          rslab(gg, 0.3, 0.8, 0.26, 0, 0.3, 0, armor).rotation.x = Math.PI / 2;      // 圓角機匣(橫置)
          rslab(gg, 0.16, 0.34, 0.16, 0, -0.1, -0.2, armorDk).rotation.x = Math.PI / 2;  // 握把
          cyl(gg, 0.09, 0.11, 0.9, 10, 0, 0.95, 0, 0x1a1d20, { metalness: 0.8 });    // 射束器管
          for (const oy of [0.75, 1.1])
            cyl(gg, 0.15, 0.15, 0.08, 10, 0, oy, 0, joint, { metalness: 0.8 });      // 聚焦環
          colMuz = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8),
            mat(accent, { emissive: accent, emissiveIntensity: 1.0 }));
          colMuz.position.set(0, 1.44, 0);
          gg.add(colMuz);                                                             // 槍口光核(擊發閃光)
          rslab(gg, 0.1, 0.3, 0.1, 0, 0.55, -0.2, dim(accent, 0.8));                  // 頂部圓角照門
          // rig.wpn light:右手掃描脈衝槍單根 gg(機匣/射束管/聚焦環皆其子節點)→ ref=gg;
          // 槍口光核 colMuz 在 gg 局部 y=+1.44、射束管 +0.95、機匣 +0.3(手持局部 +y = 前方)⇒ fwd 'y'
          wpnL = { nodes: [gg], ref: gg, muz: colMuz, fwd: 'y' };
        }
      } },
    ], sx < 0 ? armChainL : armChainR);
    armL = mkArm(-1); armR = mkArm(1);
    // 圓角矩形頭 + 雙圓眼(訊號掃描機的「臉」終於有了眼睛 —— 它看著你,不出聲)
    head.position.set(0, 2.62, 0.06);
    cyl(head, 0.15, 0.19, 0.55, 8, 0, -0.26, -0.04, joint, { metalness: 0.75 });     // 頸柱
    rslab(head, 0.74, 1.0, 0.64, 0, 0.3, 0, armor).rotation.x = 0.06;                // 圓角頭殼
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), mat(accent, { emissive: accent, emissiveIntensity: 1.8 }));
      eye.position.set(sx * 0.19, 0.34, 0.3);
      head.add(eye);                                                                 // 雙圓大眼(佔臉近半,溫和地看著你)
      const rim = cyl(head, 0.17, 0.17, 0.05, 12, sx * 0.19, 0.34, 0.3, joint, { metalness: 0.75 });
      rim.rotation.x = Math.PI / 2;                                                  // 細眼眶環
    }
    const browCannon = cyl(head, 0.06, 0.06, 0.09, 8, 0, 0.64, 0.26, accent, { emissive: accent, emissiveIntensity: 1.4 });
    browCannon.rotation.x = Math.PI / 2;                                             // 眉心脈衝砲口(標定脈衝砲)
    for (const sx of [-1, 1]) {
      const ant = bx(head, 0.05, 0.6, 0.05, sx * 0.2, 0.9, -0.14, armorDk);
      ant.rotation.z = sx * 0.3;                                                     // 測向天線對(掃描機的本業)
      cyl(head, 0.13, 0.13, 0.06, 12, sx * 0.39, 0.32, 0.02, joint, { metalness: 0.75 })
        .rotation.z = Math.PI / 2;                                                   // 頭側耳盤(Laputa 的圓耳 = 收音孔:先聽見)
    }
    // 重武器(標定脈衝砲):不新增背部/肩部掛件(設計意圖:巨兵背後乾淨)——
    // 蓄力/擊發全靠眉心射口本身的發光強度變化表現。
    heavyRig = { glow: [{ mesh: browCannon, base: 1.4 }], pivot: [] };
    // rig.wpn heavy:眉心脈衝砲口單件(掛 head)→ ref=head;browCannon 在 head z=+0.26(額前緣,
    // cyl rotation.x=π/2 管軸沿 z)、發射方向即頭部前向 ⇒ fwd 'z'(已驗證)
    wpnH = { nodes: [browCannon], ref: head, muz: browCannon, fwd: 'z' };
    // 單手槍射姿(輕武器手持、重武器機體固定 → 只舉右臂;左臂自由交還步態)
    aimPose = { rShoulderX: -0.8, rElbowX: -0.35 };
    weap = { light: 'R', heavy: 'N' };
    hvy = { chest: 0.04 };   // 眉心砲擊發:軀幹輕微後仰
    lightGlow = [{ mesh: colMuz, base: 1.0 }];
    muzzles = { light: { n: colMuz, r: 0.09 }, heavy: { n: browCannon, r: 0.08 } };
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
    heavy: heavyRig, aimPose,
    weap, hvy, gunR, gunL, lightGlow,   // 手持武器戰鬥動畫(見上方欄位說明)
    muzzles,                            // 槍口錨:曳光起點/槍口焰(makeUnit 掛焰)
    wpn: { light: wpnL, heavy: wpnH },  // rig.wpn:FPV 武裝同源(契約見 podWeapon 上方)
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
  // 遙控槍塔(2026-07-22 規則 1:塔座可轉 yaw、砲管可俯仰 —— 不再焊死在車頂):
  // turret 追瞄目標(game.js _aimVehicleTurret)、pitch 節點解算對目標仰角
  const turret = new THREE.Group();
  turret.position.set(0, 2.7, 0.3);
  hull.add(turret);
  cyl(turret, 0.7, 0.9, 0.7, 8, 0, 0, 0, dimA);                          // 砲塔座
  const apcPit = new THREE.Group();
  apcPit.position.set(0, 0.05, 0.35);
  turret.add(apcPit);
  turret.userData.pitch = apcPit;
  const barrel = cyl(apcPit, 0.09, 0.09, 2.2, 8, 0, 0, 1.05, 0x14171a, { metalness: 0.8 });
  barrel.rotation.x = Math.PI / 2;
  cyl(barrel, 0.13, 0.13, 0.28, 8, 0, 1.05, 0, 0x0d0f11);                // 砲口制退器
  const apcMuz = cyl(barrel, 0.11, 0.11, 0.05, 8, 0, 1.22, 0, dimA, { emissive: dimA, emissiveIntensity: 0.7 });
  const wheels = [];
  for (let i = 0; i < 4; i++) {
    for (const s of [-1, 1]) {
      const w = cyl(g, 0.55, 0.55, 0.4, 12, s * 1.42, 0.55, -1.8 + i * 1.25, 0x191c1f);
      w.rotation.z = Math.PI / 2;
      cyl(w, 0.2, 0.2, 0.42, 8, 0, 0, 0, 0x2c3033);                      // 輪轂(轉動可見)
      wheels.push({ m: w, r: 0.55 });
    }
  }
  g.userData.rig = { kind: 'wheeled', hull, hullY0: 0, wheels, top: 11,
    weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0 },
    kickAmp: { light: 1.6 },   // 車載機砲後座分級(NPC 無 recoilTier,建模端直給)
    lightGlow: [{ mesh: apcMuz, base: 0.7 }],
    muzzles: { light: { n: apcMuz, r: 0.12 }, heavy: null } };
  g.userData.turret = turret;   // 槍塔獨立追蹤目標(game.js _aimVehicleTurret;pitch 見 turret.userData)
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
  const body = 0x57604b, bodyDk = 0x49523f, deck = 0x525b46, band = 0x464d55;   // 履帶帶調亮:賽璐璐暗部不再與側裙糊成一團黑,履帶剪影清楚
  const hull = new THREE.Group();
  g.add(hull);
  // 車體(底面 1.5 > 履帶頂帶 1.48:側視大色塊不被履帶吃掉)
  bx(hull, 2.5, 1.05, 6.2, 0, 2.0, 0, body);                             // 主車身
  const glacis = bx(hull, 2.5, 0.95, 1.6, 0, 1.85, 3.25, bodyDk);        // 前斜甲
  glacis.rotation.x = 0.5;
  bx(hull, 2.4, 0.18, 2.6, 0, 2.6, -1.7, deck);                          // 引擎甲板
  bx(hull, 1.5, 0.12, 1.3, 0, 2.72, -2.0, 0x394037);                     // 散熱柵
  bx(hull, 2.3, 0.5, 0.6, 0, 2.2, -3.3, bodyDk);                         // 車尾艙
  // 車頭大燈(白)/ 車尾燈(紅):不靠移動也能一眼判斷正面,弭平砲塔轉向造成的方向錯覺
  for (const s of [-1, 1]) {
    bx(hull, 0.22, 0.2, 0.12, s * 1.05, 1.7, 3.98, 0xfff3d6,
      { emissive: 0xffdd88, emissiveIntensity: 1.1 });                   // 頭燈
    bx(hull, 0.2, 0.16, 0.08, s * 0.95, 2.15, -3.62, 0x7a1e1e,
      { emissive: 0xff3030, emissiveIntensity: 0.9 });                   // 尾燈
  }
  for (const s of [-1, 1]) {
    // 履帶環帶剪影:上帶/著地帶 + 前後斜段(繞惰輪/主動輪)
    bx(hull, 0.72, 0.32, 5.6, s * 1.7, 1.32, 0, band);                   // 上履帶帶
    bx(hull, 0.72, 0.3, 5.9, s * 1.7, 0.24, 0, band);                    // 著地帶
    const f = bx(hull, 0.72, 0.3, 1.4, s * 1.7, 0.78, 3.05, band);       // 前斜段
    f.rotation.x = -0.72;
    const r = bx(hull, 0.72, 0.3, 1.4, s * 1.7, 0.78, -3.05, band);      // 後斜段
    r.rotation.x = 0.72;
    // 側裙甲:封住上/著地履帶帶之間的空隙(舊版中段鏤空會透出背景,像車身缺了一塊)
    bx(hull, 0.6, 1.1, 6.2, s * 1.7, 0.94, 0, bodyDk);                   // 側裙甲(封閉履帶側面空隙)
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
  cyl(turret, 0.02, 0.03, 0.4, 5, -0.7, 0.5, -0.6, 0x23262a);            // 天線(壓進砲塔頂高內:MUST NOT 超過塔體頂 —— fitToHeight 量整體包圍盒,天線一竄高就把車體/履帶等比縮小)
  // 主砲俯仰節點(2026-07-22 規則 1:攻城砲彈道是拋物線,砲管仰角由 game.js
  // _arcTracer/_aimVehicleTurret 解算 —— 不再焊死水平);樞軸在防盾耳軸
  const tkPit = new THREE.Group();
  tkPit.position.set(0, 0.42, 0.85);
  turret.add(tkPit);
  turret.userData.pitch = tkPit;
  const gun = cyl(tkPit, 0.13, 0.16, 4.4, 10, 0, 0, 2.05, 0x14171a, { metalness: 0.8 });
  gun.rotation.x = Math.PI / 2;
  cyl(gun, 0.19, 0.19, 0.5, 8, 0, 0.8, 0, 0x1e2226);                     // 排煙器
  cyl(gun, 0.21, 0.21, 0.35, 8, 0, 2.05, 0, 0x0d0f11);                   // 砲口制退器
  const tkMuz = cyl(gun, 0.17, 0.17, 0.06, 8, 0, 2.26, 0, accent, { emissive: accent, emissiveIntensity: 0.7 });
  // 主砲砲口環(擊發閃光/曳光起點;隨砲塔轉向恆朝攻擊方向)+ 機載後座(stepVehicle 車體後仰)
  g.userData.rig = { kind: 'tracked', hull, hullY0: 0, wheels, top: 9,
    weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0 },
    kickAmp: { light: 2.2 },   // 主砲後座分級(NPC 無 recoilTier,建模端直給)
    lightGlow: [{ mesh: tkMuz, base: 0.7 }],
    muzzles: { light: { n: tkMuz, r: 0.22 }, heavy: null } };
  g.userData.turret = turret;   // 砲塔獨立追蹤目標(game.js _aimVehicleTurret;pitch 見 turret.userData)
  return g;
}

// ---------- 步兵手持武器積木(2026-07-17 重設計;人類/機器人/第三方步兵共用)----------
/**
 * 肩射式火箭筒:發射管 + 錐形戰鬥部(前)+ 喇叭噴口(後)+ 握把/瞄具/肩墊。
 * +z = 筒口朝向;呼叫端架上右肩(hips 子層)並給前仰角。accent = 陣營識別環。
 */
function shoulderTube(accent) {
  const t = new THREE.Group();
  const barrel = cyl(t, 0.085, 0.085, 1.6, 8, 0, 0, 0, 0x22261f, { metalness: 0.6 });
  barrel.rotation.x = Math.PI / 2;                                       // 發射管沿 +z
  const mid = cyl(t, 0.095, 0.095, 0.22, 8, 0, 0, 0.42, accent, { emissive: accent, emissiveIntensity: 0.7 });
  mid.rotation.x = Math.PI / 2;                                          // 陣營識別環
  const wh = cyl(t, 0.05, 0.14, 0.4, 8, 0, 0, 1.0, 0x3a4232);
  wh.rotation.x = Math.PI / 2;                                           // 錐形戰鬥部(基座寬於發射管 = 超口徑彈)
  const tip = cyl(t, 0.01, 0.05, 0.16, 8, 0, 0, 1.26, 0x2c3033);
  tip.rotation.x = Math.PI / 2;                                          // 引信尖
  const noz = cyl(t, 0.09, 0.15, 0.28, 8, 0, 0, -0.9, 0x1c1f22);
  noz.rotation.x = Math.PI / 2;                                          // 尾部喇叭噴口(後噴無後座)
  bx(t, 0.05, 0.18, 0.07, 0, -0.17, 0.22, 0x23262a);                     // 前握把
  bx(t, 0.05, 0.15, 0.07, 0, -0.16, -0.12, 0x23262a);                    // 扳機握把
  bx(t, 0.07, 0.09, 0.18, -0.1, 0.12, 0.06, 0x14171a);                   // 光學瞄具(左上)
  bx(t, 0.12, 0.05, 0.3, 0, -0.12, -0.45, 0x2e332c);                     // 肩墊
  const muz = cyl(t, 0.09, 0.09, 0.04, 8, 0, 0, 0.81, accent, { emissive: accent, emissiveIntensity: 0.7 });
  muz.rotation.x = Math.PI / 2;                                          // 筒口環(擊發閃光/曳光起點)
  t.userData.muz = muz;
  return t;
}

/**
 * 手持榴彈槍(榴彈兵步兵化):短粗砲管 + 六膛轉輪彈巢 + 前握把 + 摺疊肩托。
 * +z = 槍口;呼叫端掛右手(armR 子層)。accent = 砲口識別環。
 */
function handGL(accent) {
  const t = new THREE.Group();
  bx(t, 0.09, 0.15, 0.5, 0, 0, -0.1, 0x1a1d20);                          // 機匣
  const drum = cyl(t, 0.15, 0.15, 0.2, 10, 0, 0, 0.18, 0x2e332c);
  drum.rotation.x = Math.PI / 2;                                         // 轉輪彈巢(鼓軸∥砲管,見 §2 供彈同軸規則)
  for (let k = 0; k < 6; k++) {                                          // 六膛室(口部露頭)
    const a = k * Math.PI / 3;
    cyl(drum, 0.04, 0.04, 0.22, 6, Math.cos(a) * 0.09, 0, Math.sin(a) * 0.09, 0x14171a);
  }
  const gb = cyl(t, 0.07, 0.07, 0.45, 8, 0, 0, 0.5, 0x30373f, { metalness: 0.8 });
  gb.rotation.x = Math.PI / 2;                                           // 短粗砲管(40mm 級口徑感)
  const muz = cyl(t, 0.085, 0.085, 0.08, 8, 0, 0, 0.72, accent, { emissive: accent, emissiveIntensity: 0.9 });
  muz.rotation.x = Math.PI / 2;                                          // 砲口識別環
  bx(t, 0.05, 0.14, 0.06, 0, -0.15, 0.32, 0x23262a);                     // 前握把
  bx(t, 0.05, 0.12, 0.07, 0, -0.13, -0.28, 0x23262a);                    // 手槍握把
  bx(t, 0.04, 0.06, 0.3, 0, 0.03, -0.5, 0x2e332c);                       // 摺疊肩托
  bx(t, 0.05, 0.05, 0.12, 0, 0.11, 0.02, 0x14171a);                      // 照門
  t.userData.muz = muz;                                                  // 槍口環(擊發閃光/曳光起點)
  return t;
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
  // 武器(2026-07-17 戰鬥姿勢化):一律登記 gunR(gunPitch 俯仰:行軍 rest ↔ 交戰 aim)、
  // 槍口環(擊發閃光 + 曳光起點 rig.muzzles)與後座欄位 —— NPC 與英雄同一套 stepCombatFx。
  // 手持武器另給 aimPose:交戰時抬臂據槍(右手持槍、左手扶護木),不再垂手行軍姿開火
  let tGun = null, tMuz = null, tAim = null, tWeap = null, tHvy = null;
  const accentC = new THREE.Color(SIDES[side].color);
  if (p.weapon === 'tube') {
    // 肩射式火箭筒(shoulderTube 共用積木):架右肩、行軍筒口微仰 ↔ 交戰放平朝目標
    const tube = shoulderTube(accentC);
    tube.position.set(0.34, 1.05, 0);
    tube.rotation.x = -0.24;
    hips.add(tube);
    tGun = { g: tube, rest: -0.24, aim: -0.06 };
    tMuz = tube.userData.muz;
    // 戰鬥姿勢(2026-07-22 規則 2):交戰雙臂上抬扶筒(右手扣扳機握把、左手跨胸扶前握把),
    // 不再垂手行軍姿開火 —— 筒身仍架肩(機載俯仰),但射手要「持著」它
    tAim = { rShoulderX: -0.7, lShoulderX: -0.85, lShoulderY: 0.55 };
    tWeap = { light: 'N', heavy: 'N' };            // 肩扛機載:後座走 _kickB(+ 筒口上跳)
    tHvy = { chest: 0.05, gun: 0.1 };
  } else if (p.weapon === 'gl') {
    // 手持榴彈槍(handGL 共用積木):右手托持;拋物線武器 —— 交戰砲管上仰,
    // 仰角由 game.js 依實際彈道弧線逐發解算(gunR.aim = comp − 仰角),與曳光拋物線一致
    const gl = handGL(accentC);
    gl.position.set(0.03, -0.8, 0.3);
    armR.add(gl);
    tGun = { g: gl, rest: 0.08, aim: 0.05, comp: 0.55 };   // aim 預設 = comp − 0.5(≈29° 仰角)
    tMuz = gl.userData.muz;
    tAim = { rShoulderX: -0.55, lShoulderX: -0.5, lShoulderY: 0.45 };
    tWeap = { light: 'R', heavy: 'R' };
    tHvy = { chest: 0.04 };
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
    const muz = cyl(mg, 0.065, 0.065, 0.04, 8, 0, 0.04, 1.58, accentC, { emissive: accentC, emissiveIntensity: 0.7 });
    muz.rotation.x = Math.PI / 2;                                             // 槍口環
    tGun = { g: mg, rest: 0.06, aim: 0.55 };   // 據槍:抵銷抬臂 −0.55 → 槍口回水平朝前
    tMuz = muz;
    tAim = { rShoulderX: -0.55, lShoulderX: -0.5, lShoulderY: 0.45 };
    tWeap = { light: 'R', heavy: 'R' };
    tHvy = { chest: 0.04 };
  }
  g.userData.rig = {
    kind: 'biped', hips, legL, legR, armL, armR,
    hipsY0: hipY, stride: 0.95, bob: 0.07, sway: 0.06, top: 8, gunArm: true,
    gunR: tGun, aimPose: tAim, weap: tWeap, hvy: tHvy,
    lightGlow: tMuz ? [{ mesh: tMuz, base: 0.7 }] : null,
    muzzles: { light: tMuz ? { n: tMuz, r: 0.09 } : null, heavy: null },
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

/** 榴彈兵(2026-07-17 步兵化重設計)— 可動骨架 + 手持轉輪榴彈槍(不再是牽引砲車) */
function buildGrenadierFallback(side) {
  return buildTrooper(side, {
    fatigue: 0x565e42, vest: 0x363c2e, pad: 0x424a38, helmet: 0x363d30, weapon: 'gl',
  });
}

/**
 * 平民/間諜(2026-07-18;非戰鬥人員)— 可動人形骨架,無武裝、無敵我識別燈。
 * 外觀依 CIVILIANS[prof]:職業以「帽子/包包顏色」區分(MUST NOT 用雙方陣營標誌色);
 * 其餘配件一律中性色。陣營僅靠貼地 teamRing / 頭頂箭頭辨識(game.js _civMark)——
 * 間諜與平民外觀完全相同,唯一破綻是移動速度(伺服器 civSpeed)。
 * rig 為「biped 減去所有戰鬥欄位」:自然擺臂(無 gunArm)、無槍口焰(無 muzzles)。
 */
function buildCivilian(side, prof) {
  const c = CIVILIANS[(prof | 0) % CIVILIANS.length] || CIVILIANS[0];
  const female = c.g === 'F';
  const g = new THREE.Group();
  const hipY = 1.28;
  // 依職業做確定性外觀變化(同職業恆定;不同職業膚色/髮色/髮型/鬍各異 —— 避免千人一面)
  const pIdx = prof | 0;
  const hp = (arr, salt) => arr[(pIdx * 7 + salt) % arr.length];
  const SKIN = [0xf0c8a4, 0xe4b189, 0xd8a072, 0xc48a5c, 0xb07a4e, 0x9c6a42];
  const HAIRC = [0x1a1512, 0x27201c, 0x352720, 0x4a3527, 0x6a4a30, 0x9aa0a6];  // 黑→棕→灰白
  const MHAIR = ['short', 'sidepart', 'buzz', 'short', 'sidepart', 'curly'];
  const FHAIR = ['bun', 'pony', 'bob', 'long', 'long', 'bun'];
  const FACIAL = ['none', 'beard', 'stache', 'none', 'goatee', 'none'];
  const skin = hp(SKIN, female ? 3 : 1);
  const hairCol = hp(HAIRC, female ? 5 : 2);
  const hairStyle = female ? hp(FHAIR, 1) : hp(MHAIR, 0);
  const facial = female ? 'none' : hp(FACIAL, 4);
  const cloth = female ? 0x6a6f7a : 0x565c66;    // 便服襯衫底色(職業罩衫蓋在其上;中性,不吃陣營色)
  const pants = female ? 0x3c4048 : 0x33373f;
  const shoulder = female ? 0.5 : 0.58;
  const torsoD = female ? 0.32 : 0.38;
  // 腿:髖關節樞軸(便褲/小腿/鞋)
  const mkLeg = (sx) => {
    const leg = new THREE.Group();
    leg.position.set(sx * (female ? 0.16 : 0.19), hipY, 0);
    bx(leg, 0.22, 0.58, 0.26, 0, -0.32, 0, pants);
    bx(leg, 0.18, 0.5, 0.22, 0, -0.86, 0, dim(pants, 0.9));
    bx(leg, 0.2, 0.12, 0.38, 0, -1.18, 0.05, 0x2a2622);   // 鞋
    g.add(leg);
    return leg;
  };
  const legL = mkLeg(-1), legR = mkLeg(1);
  // 骨盆/軀幹(女性肩窄 + 裙腰)
  const hips = new THREE.Group();
  hips.position.y = hipY;
  g.add(hips);
  bx(hips, shoulder * 0.9, 0.24, 0.34, 0, 0.1, 0, dim(pants, 1.05));               // 腰
  bx(hips, shoulder, 0.6, torsoD, 0, 0.56, 0, cloth);                             // 上身便服(底層襯衫)
  if (female) bx(hips, shoulder * 1.04, 0.22, 0.36, 0, 0.28, 0, dim(cloth, 1.08));  // 裙擺/腰線
  // 手臂:肩關節樞軸(便服上臂 + 裸前臂),自然擺動 —— rig 不設 gunArm
  const mkArm = (sx) => {
    const a = new THREE.Group();
    a.position.set(sx * (shoulder * 0.8), 0.84, 0);
    bx(a, 0.14, 0.42, 0.18, 0, -0.22, 0, cloth);
    bx(a, 0.12, 0.36, 0.15, 0, -0.58, 0.04, skin);
    hips.add(a);
    return a;
  };
  const armL = mkArm(-1), armR = mkArm(1);
  // 頸 + 頭 + 五官 + 髮型(2026-07-18 補臉:避免無臉/光頭,並依職業變化膚色/髮色/髮型/鬍)
  cyl(hips, 0.09, 0.11, 0.18, 8, 0, 0.92, 0.02, dim(skin, 0.95));   // 頸(補住頭與軀幹的縫)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 11), mat(skin));
  head.position.set(0, 1.16, 0.02);
  hips.add(head);
  const sphere = (r, x, y, z, col) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 7), mat(col));
    s.position.set(x, y, z); hips.add(s); return s;
  };
  // 五官(朝 +z;頭球心 y1.16 前表面 z≈0.24)
  const fz = 0.2;
  for (const sx of [-1, 1]) {
    bx(hips, 0.075, 0.055, 0.03, sx * 0.082, 1.185, fz, 0xf4f1ea);          // 眼白
    bx(hips, 0.036, 0.045, 0.03, sx * 0.09, 1.182, fz + 0.01, 0x241d18);    // 瞳
    const brow = bx(hips, 0.095, 0.022, 0.03, sx * 0.086, 1.24, fz - 0.005, hairCol);
    brow.rotation.z = sx * 0.08;                                            // 眉(略挑)
    bx(hips, 0.03, 0.08, 0.05, sx * 0.205, 1.15, 0.03, dim(skin, 0.96));    // 耳
  }
  bx(hips, 0.05, 0.1, 0.07, 0, 1.13, fz + 0.02, dim(skin, 0.93));           // 鼻
  bx(hips, 0.09, 0.024, 0.03, 0, 1.072, fz + 0.018, 0x8a4b46);             // 嘴
  // 髮:頭皮罩(上半球,朝前留臉) + 後腦 + 額際 + 分型
  const scalp = new THREE.Mesh(
    new THREE.SphereGeometry(0.234, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.6), mat(hairCol));
  scalp.position.set(0, 1.165, 0.005); hips.add(scalp);
  bx(hips, 0.3, 0.22, 0.16, 0, 1.13, -0.12, hairCol);                       // 後腦髮
  if (hairStyle !== 'buzz') bx(hips, 0.36, 0.07, 0.12, 0, 1.275, 0.13, dim(hairCol, 1.03));  // 低瀏海
  if (hairStyle === 'sidepart') { const p = bx(hips, 0.2, 0.09, 0.16, 0.06, 1.3, 0.14, hairCol); p.rotation.z = 0.16; }
  else if (hairStyle === 'curly') for (const [x, y, z] of [[0.16, 1.32, 0.06], [-0.16, 1.32, 0.06], [0, 1.37, -0.02], [0.2, 1.24, -0.06], [-0.2, 1.24, -0.06]]) sphere(0.1, x, y, z, hairCol);
  else if (hairStyle === 'bun') sphere(0.13, 0, 1.35, -0.15, hairCol);
  else if (hairStyle === 'pony') { bx(hips, 0.13, 0.16, 0.14, 0, 1.26, -0.18, hairCol); bx(hips, 0.11, 0.46, 0.12, 0, 0.98, -0.2, hairCol); }
  else if (hairStyle === 'bob') { bx(hips, 0.42, 0.32, 0.3, 0, 1.08, -0.01, hairCol); for (const sx of [-1, 1]) bx(hips, 0.11, 0.34, 0.14, sx * 0.22, 1.06, 0.05, hairCol); }
  else if (hairStyle === 'long') { bx(hips, 0.34, 0.42, 0.26, 0, 1.02, -0.1, hairCol); for (const sx of [-1, 1]) bx(hips, 0.13, 0.52, 0.13, sx * 0.19, 0.9, 0.02, hairCol); }
  // 鬍(部分男性)
  if (facial === 'beard') { bx(hips, 0.26, 0.16, 0.16, 0, 1.055, 0.13, hairCol); bx(hips, 0.11, 0.03, 0.04, 0, 1.108, fz + 0.02, hairCol); }
  else if (facial === 'stache') bx(hips, 0.12, 0.03, 0.04, 0, 1.108, fz + 0.02, hairCol);
  else if (facial === 'goatee') { bx(hips, 0.1, 0.11, 0.09, 0, 1.03, 0.14, hairCol); bx(hips, 0.11, 0.03, 0.04, 0, 1.108, fz + 0.02, hairCol); }

  // ---------- 職業服裝差異化(2026-07-18)----------
  // 每種職業有專屬剪影(頭飾 + 罩衫 + 招牌配件);罩衫掛 hips(隨軀幹)、手持物/手套掛 armL/armR
  // (隨擺臂),膠靴掛腿(隨步態)。一律中性/職業色 —— MUST NOT 用陣營標誌色(琥珀/冷藍)。
  const torsoW = shoulder + 0.06, frontZ = torsoD / 2;
  // — 頭飾 —
  const hardHat = (col) => {                                   // 安全帽:圓頂 + 全周簷 + 頂脊
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(col));
    dome.position.set(0, 1.24, 0); hips.add(dome);
    bx(hips, 0.46, 0.05, 0.5, 0, 1.22, 0.02, dim(col, 0.9));
    bx(hips, 0.08, 0.12, 0.5, 0, 1.32, 0.02, dim(col, 1.05));
  };
  const roundCap = (col) => {                                  // 貼頭圓帽(手術帽/護士帽):完整罩住頭髮 + 帽箍
    const d = new THREE.Mesh(                                   // 與頭髮同心且略大 → 不與頭皮髮 z-fight(避免斑駁腦紋)
      new THREE.SphereGeometry(0.252, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.66), mat(col));
    d.position.set(0, 1.165, 0.005); hips.add(d);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.236, 0.028, 8, 20), mat(dim(col, 0.88)));
    band.position.set(0, 1.14, 0.005); band.rotation.x = Math.PI / 2; hips.add(band);
  };
  const toque = () => {                                        // 高廚帽:筒身 + 蓬頂
    cyl(hips, 0.2, 0.22, 0.34, 10, 0, 1.36, 0, 0xf4f4f0);
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), mat(0xf7f7f2));
    puff.position.set(0, 1.56, 0); puff.scale.set(1, 0.72, 1); hips.add(puff);
  };
  const strawHat = (col) => {                                  // 寬草帽:寬簷抬到額上(不擋眼)+ 盆型帽頂
    cyl(hips, 0.56, 0.58, 0.06, 16, 0, 1.29, 0.0, col);
    cyl(hips, 0.27, 0.31, 0.2, 16, 0, 1.37, 0.0, dim(col, 1.04));
  };
  const peakCap = (col) => {                                   // 制服帽:圓頂 + 前簷 + 帽章帶
    const d = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(col));
    d.position.set(0, 1.22, 0); hips.add(d);
    bx(hips, 0.36, 0.04, 0.2, 0, 1.16, 0.26, dim(col, 0.85));
    bx(hips, 0.34, 0.05, 0.06, 0, 1.24, 0.02, dim(col, 1.1));
  };
  const visor = (col) => {                                     // 遮陽帽:頭帶 + 前簷
    bx(hips, 0.42, 0.08, 0.28, 0, 1.2, 0.0, col);
    bx(hips, 0.38, 0.04, 0.22, 0, 1.18, 0.24, dim(col, 0.8));
  };
  const glasses = () => {                                      // 眼鏡
    for (const sx of [-1, 1]) bx(hips, 0.12, 0.1, 0.03, sx * 0.09, 1.15, 0.2, 0x1a1c20);
    bx(hips, 0.08, 0.03, 0.03, 0, 1.15, 0.2, 0x1a1c20);
  };
  // — 罩衫 —
  const jacket = (col, sleeve = true) => {                     // 過胸罩衫(西裝/制服/外套上身 + 袖)
    bx(hips, torsoW + 0.02, 0.64, torsoD + 0.06, 0, 0.55, 0.02, col);
    if (sleeve) for (const a of [armL, armR]) bx(a, 0.17, 0.46, 0.22, 0, -0.2, 0, col);
  };
  const coat = (col) => {                                      // 長袍/白袍:上身 + 過腰下擺 + 前開襟 + 袖
    jacket(col);
    bx(hips, torsoW - 0.02, 0.62, torsoD + 0.02, 0, -0.06, 0.0, col);
    bx(hips, 0.05, 0.62, frontZ + 0.06, 0, 0.5, frontZ + 0.02, dim(col, 0.8));
  };
  const vest = (col, stripe = false) => {                      // 無袖背心 + 開襟(可選反光帶)
    bx(hips, torsoW, 0.56, torsoD + 0.06, 0, 0.56, 0.03, col);
    bx(hips, 0.06, 0.54, frontZ + 0.05, 0, 0.56, frontZ + 0.02, dim(col, 0.7));
    if (stripe) for (const yy of [0.66, 0.46]) bx(hips, torsoW + 0.01, 0.06, torsoD + 0.07, 0, yy, 0.02, 0xdfe6ea);
  };
  const knitVest = (col) => {                                  // 針織背心(無袖,露出襯衫)
    bx(hips, torsoW, 0.54, torsoD + 0.05, 0, 0.54, 0.02, col);
    bx(hips, 0.14, 0.5, frontZ + 0.05, 0, 0.56, frontZ + 0.01, 0xecedf0);
  };
  const suit = (col) => {                                      // 西裝:上身 + 袖 + 白襯衫 V 開 + 翻領
    jacket(col);
    bx(hips, 0.16, 0.5, frontZ + 0.05, 0, 0.56, frontZ + 0.01, 0xecedf0);
    for (const sx of [-1, 1]) {
      const l = bx(hips, 0.12, 0.3, 0.05, sx * 0.1, 0.72, frontZ + 0.02, dim(col, 0.85));
      l.rotation.z = sx * 0.5;
    }
  };
  const tie = (col) => {                                       // 領帶:領結 + 帶身
    bx(hips, 0.08, 0.08, 0.05, 0, 0.78, frontZ + 0.03, col);
    bx(hips, 0.09, 0.34, 0.04, 0, 0.58, frontZ + 0.03, col);
  };
  const apron = (col) => {                                     // 圍裙:胸兜 + 下裙 + 肩帶
    bx(hips, shoulder * 0.78, 0.48, 0.05, 0, 0.5, frontZ + 0.02, col);
    bx(hips, shoulder * 0.92, 0.5, 0.05, 0, 0.02, frontZ + 0.01, col);
    for (const sx of [-1, 1]) {
      const s = bx(hips, 0.05, 0.4, 0.05, sx * 0.14, 0.72, 0.14, dim(col, 0.85));
      s.rotation.x = 0.1;
    }
  };
  const overalls = (col) => {                                  // 吊帶褲:胸兜 + 吊帶 + 腰 + 銅釦
    bx(hips, shoulder * 0.7, 0.42, 0.06, 0, 0.42, frontZ + 0.02, col);
    for (const sx of [-1, 1]) {
      const s = bx(hips, 0.07, 0.5, 0.06, sx * 0.16, 0.66, 0.13, col);
      s.rotation.x = -0.05;
    }
    bx(hips, torsoW, 0.18, torsoD + 0.06, 0, 0.1, 0, dim(col, 0.9));
    for (const sx of [-1, 1]) bx(hips, 0.07, 0.07, 0.06, sx * 0.14, 0.44, frontZ + 0.05, 0xc79a3a);
  };
  // — 配件 —
  const toolBelt = (col) => {                                  // 工具腰帶 + 三個工具袋
    bx(hips, torsoW, 0.12, torsoD + 0.08, 0, 0.16, 0.02, dim(col, 0.9));
    for (const sx of [-1, 0, 1]) bx(hips, 0.14, 0.18, 0.12, sx * 0.22, 0.12, frontZ - 0.02, col);
  };
  const gloves = (col) => { for (const a of [armL, armR]) bx(a, 0.14, 0.2, 0.17, 0, -0.68, 0.03, col); };
  const stetho = () => {                                       // 聽診器:頸掛雙管 + 導管 + 聽診頭
    for (const sx of [-1, 1]) {
      const s = bx(hips, 0.04, 0.4, 0.04, sx * 0.12, 0.82, 0.14, 0x2a2f36);
      s.rotation.z = sx * -0.2; s.rotation.x = 0.2;
    }
    bx(hips, 0.03, 0.34, 0.03, 0.1, 0.5, frontZ + 0.02, 0x2a2f36);
    cyl(hips, 0.07, 0.07, 0.04, 10, 0.1, 0.34, frontZ + 0.03, 0xb8bdc4);
  };
  const cameraNeck = () => {                                   // 頸掛相機:雙背帶 + 機身 + 鏡頭
    for (const sx of [-1, 1]) bx(hips, 0.04, 0.42, 0.04, sx * 0.14, 0.8, 0.12, 0x23262a);
    bx(hips, 0.26, 0.16, 0.12, 0, 0.5, frontZ + 0.04, 0x1a1c20);
    cyl(hips, 0.06, 0.07, 0.1, 12, 0, 0.5, frontZ + 0.12, 0x0e0f12).rotation.x = Math.PI / 2;
  };
  const headphones = () => {                                   // 頭戴耳機:頭梁半環 + 雙耳罩
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.03, 6, 16, Math.PI), mat(0x1c1f24));
    band.position.set(0, 1.24, 0); hips.add(band);
    for (const sx of [-1, 1]) {
      const cup = cyl(hips, 0.08, 0.08, 0.08, 10, sx * 0.23, 1.14, 0.02, 0x2a2f36);
      cup.rotation.z = Math.PI / 2;
    }
  };
  const backpack = (col) => {                                  // 後背包:主體 + 雙肩帶
    bx(hips, 0.4, 0.5, 0.2, 0, 0.56, -0.28, col);
    for (const sx of [-1, 1]) bx(hips, 0.06, 0.5, 0.06, sx * 0.2, 0.6, 0.14, dim(col, 0.8));
  };
  const satchel = (col) => {                                   // 斜背郵袋:背帶 + 袋身 + 袋蓋
    const strap = bx(hips, 0.08, 0.7, 0.05, 0, 0.56, 0.14, dim(col, 0.7));
    strap.rotation.z = 0.6;
    bx(hips, 0.3, 0.32, 0.18, -0.36, 0.3, 0.02, col);
    bx(hips, 0.3, 0.1, 0.19, -0.36, 0.42, 0.02, dim(col, 0.85));
  };
  const lanyard = (col) => {                                   // 識別證吊繩
    for (const sx of [-1, 1]) {
      const s = bx(hips, 0.03, 0.4, 0.03, sx * 0.1, 0.82, 0.14, col);
      s.rotation.z = sx * -0.14;
    }
    bx(hips, 0.12, 0.16, 0.03, 0, 0.5, frontZ + 0.02, 0xf0f0f0);
  };
  const scarf = (col) => {                                     // 圍巾/領巾
    bx(hips, shoulder * 0.72, 0.14, torsoD + 0.06, 0, 0.78, 0.04, col);
    bx(hips, 0.1, 0.3, 0.05, 0.12, 0.62, frontZ + 0.02, dim(col, 0.9));
  };
  const cross = (col, x, y) => {                               // 醫療十字標記
    bx(hips, 0.12, 0.04, 0.03, x, y, frontZ + 0.01, col);
    bx(hips, 0.04, 0.12, 0.03, x, y, frontZ + 0.01, col);
  };
  const bootsOver = (col) => { for (const lg of [legL, legR]) bx(lg, 0.24, 0.32, 0.42, 0, -1.06, 0.05, col); };
  const inHand = (arm, build) => {                             // 手持物(掛手部,隨擺臂)
    const gp = new THREE.Group();
    gp.position.set(0, -0.82, 0.1); arm.add(gp); build(gp);
  };

  const outfits = {
    // 男性 10
    '醫師': () => {
      coat(0xf1f2ef); stetho(); glasses();
      cyl(hips, 0.09, 0.09, 0.02, 12, 0, 1.26, 0.19, 0xd7dde0);     // 額鏡
      bx(hips, 0.16, 0.05, 0.04, 0, 1.3, 0.14, 0x2a2f36);
    },
    '工程師': () => {
      hardHat(0xe8621f); vest(0x5f6a4a, true); toolBelt(0x3a3d33);
      inHand(armL, (gp) => { bx(gp, 0.24, 0.03, 0.3, 0, 0, 0.1, 0x2f3a2c); bx(gp, 0.18, 0.02, 0.24, 0, 0.02, 0.1, 0xf0f0ea); });
    },
    '商人': () => {
      suit(0x33373f); tie(0x6b2f2f);
      inHand(armR, (gp) => { bx(gp, 0.32, 0.24, 0.12, 0, -0.06, 0.05, 0x3b2a1c); bx(gp, 0.1, 0.06, 0.03, 0, 0.08, 0.05, 0x22160e); });
    },
    '廚師': () => {
      toque(); jacket(0xf4f4f0); apron(0xe4e4dc); scarf(0x9a2f2f);
      for (const sx of [-1, 1]) for (const yy of [0.72, 0.56, 0.4]) bx(hips, 0.04, 0.05, 0.03, sx * 0.1, yy, frontZ + 0.03, 0x2a2f36);  // 雙排釦
    },
    '電工': () => {
      hardHat(0xc0362f); vest(0x2b3550); toolBelt(0x23262a); gloves(0xe8621f);
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 6, 14), mat(0x2a2f36));
      coil.position.set(-0.3, 0.72, 0.02); coil.rotation.y = 0.6; hips.add(coil);
    },
    '教師': () => {
      knitVest(0x4a4e86); tie(0x6f3f7a); glasses();
      inHand(armR, (gp) => { bx(gp, 0.24, 0.08, 0.3, 0, -0.02, 0.1, 0x6f3f7a); bx(gp, 0.22, 0.06, 0.28, 0, -0.02, 0.1, 0xf0ead6); });
    },
    '農夫': () => {
      strawHat(0xcbb26a); overalls(0x3c5a72); bootsOver(0x4a3a26);
      bx(hips, shoulder * 0.7, 0.1, torsoD + 0.04, 0, 0.8, 0.04, 0x6b7f4a);  // 頸巾
    },
    '記者': () => {
      peakCap(0x3a4150); vest(0x4a4e52); cameraNeck(); lanyard(0x2b3038);
      for (const sx of [-1, 1]) for (const yy of [0.62, 0.44]) bx(hips, 0.14, 0.14, 0.1, sx * 0.2, yy, frontZ + 0.02, dim(0x4a4e52, 0.85));  // 採訪口袋
    },
    '郵差': () => { peakCap(0x2f4a5c); jacket(0x2f4a5c); satchel(0x2f6b45); },
    '建築工': () => {
      hardHat(0xdfe2e6); vest(0xe0531f, true); gloves(0x6b6b6b); toolBelt(0x3a3d33); bootsOver(0x2a2622);
    },
    // 女性 10
    '護理師': () => {
      roundCap(0xdfe7ea); vest(0xc67d92); apron(0xf0f0ec); cross(0xc0362f, 0, 0.66);
    },
    '藥師': () => {
      coat(0xeef0ee); glasses();
      bx(hips, 0.28, 0.28, 0.16, -0.34, 0.32, 0.02, 0x2f7d55); cross(0x2f9e6a, -0.34, 0.34);  // 藥袋 + 綠十字
    },
    '銀行員': () => {
      suit(0x3a4250); lanyard(0x2b3038);
      inHand(armL, (gp) => bx(gp, 0.22, 0.08, 0.28, 0, -0.02, 0.08, 0x243040));
    },
    '程式設計師': () => {
      jacket(0x5a6270); headphones(); backpack(0x3a2f5a); glasses();
      bx(hips, 0.34, 0.16, 0.3, 0, 0.92, -0.06, 0x4c5360);                 // 兜帽(垂後頸)
      bx(hips, 0.18, 0.5, frontZ + 0.06, 0, 0.5, frontZ + 0.02, 0x4c5360);  // 連帽衫前口袋
    },
    '會計師': () => {
      knitVest(0x4a4470); glasses();
      inHand(armR, (gp) => { bx(gp, 0.22, 0.06, 0.28, 0, -0.02, 0.08, 0x2a2f45); bx(gp, 0.14, 0.04, 0.18, 0, 0.02, 0.14, 0x9aa0a6); });
    },
    '律師': () => {
      suit(0x2a2f38); tie(0x2a2f38);
      inHand(armL, (gp) => bx(gp, 0.26, 0.05, 0.34, 0, 0, 0.1, 0x5c2a34));  // 卷宗
    },
    '獸醫': () => {
      roundCap(0xe6ddc9); vest(0x3f7d5f); gloves(0xcfe0d6);
      bx(hips, 0.3, 0.3, 0.18, -0.34, 0.3, 0.02, 0xcf4d4a); cross(0xf0f0ec, -0.34, 0.32);  // 診療包 + 白十字
    },
    '技師': () => {
      peakCap(0x455060); jacket(0xbf4f2f); toolBelt(0x2a2d33);
      for (const lg of [legL, legR]) bx(lg, 0.2, 0.56, 0.24, 0, -0.32, 0, 0xbf4f2f);  // 連身工作服褲管
    },
    '攤販': () => {
      visor(0xcf6a34); apron(0x7a5330);
      bx(hips, shoulder * 0.5, 0.14, 0.06, 0, 0.1, frontZ + 0.03, dim(0x7a5330, 0.85));  // 圍裙口袋
      inHand(armR, (gp) => { bx(gp, 0.4, 0.05, 0.3, 0, -0.05, 0.18, 0x8a6a3a); for (const sx of [-1, 1]) bx(gp, 0.05, 0.12, 0.05, sx * 0.16, 0.03, 0.18, 0x6a4f28); });  // 托盤
    },
    '心理師': () => {
      jacket(0x8a6aa8); scarf(0xdcc7e4); glasses();
      bx(hips, 0.14, 0.56, frontZ + 0.05, 0, 0.54, frontZ + 0.01, 0xecedf0);  // 開襟內襯
      inHand(armL, (gp) => { bx(gp, 0.24, 0.03, 0.3, 0, 0, 0.1, 0x6a4f8a); bx(gp, 0.18, 0.02, 0.24, 0, 0.02, 0.1, 0xf4f4f0); });  // 記事夾板
    },
    __def: () => {   // 備援:舊版帽 + 側背包(職業色)
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(c.hat));
      cap.position.set(0, 1.24, 0); hips.add(cap);
      bx(hips, 0.34, 0.05, 0.18, 0, 1.24, 0.2, dim(c.hat, 0.85));
      const strap = bx(hips, 0.08, 0.62, 0.06, 0.16, 0.56, 0.18, dim(c.bag, 0.7));
      strap.rotation.z = 0.5;
      bx(hips, 0.26, 0.28, 0.16, -0.34, 0.36, 0.02, c.bag);
    },
  };
  (outfits[c.name] || outfits.__def)();

  g.userData.rig = {
    kind: 'biped', hips, legL, legR, armL, armR,
    hipsY0: hipY, stride: 0.82, bob: 0.06, sway: 0.06, top: 7,
  };
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
  // 2026-07-22 規則 1:短翼連莢艙掛共軛俯仰槍架(對地射擊筒口下壓;game.js _aimGunTilt)
  const podPiv = new THREE.Group();
  podPiv.position.set(0, 1.46, -0.3);
  g.add(podPiv);
  bx(podPiv, 2.4, 0.1, 0.55, 0, 0.04, 0, 0x333a30);   // 短翼左右展開(x 向)
  const podMuz = [];
  for (const s of [-1, 1]) {
    const pod = cyl(podPiv, 0.18, 0.18, 0.9, 8, s * 1.05, -0.04, 0, 0x2c3033);
    pod.rotation.x = Math.PI / 2;                   // 火箭莢艙筒口朝 +z
    podMuz.push(cyl(pod, 0.14, 0.14, 0.06, 8, 0, 0.46, 0, 0xffb27a, { emissive: 0xff8844, emissiveIntensity: 0.6 }));
  }
  g.userData.gunTilt = podPiv;   // 共軛俯仰(game.js _aimGunTilt)
  bx(g, 0.08, 0.7, 0.5, 0, 2.1, -3.2, 0x2c322a);   // 垂直尾翼(x 薄、z 長)
  bx(g, 0.1, 0.16, 0.52, 0, 2.3, -3.2, accent);
  // 壓坡樞軸(locomotion.js):巡航壓坡 / 入彎側傾 / 浮沉整機一起動
  const tilt = new THREE.Group();
  tilt.position.y = 1.6;
  for (const k of [...g.children]) { k.position.y -= 1.6; tilt.add(k); }
  g.add(tilt);
  g.userData.spin = [rotor, tailRotor];
  // 莢艙口 = 槍口錨(擊發雙莢齊閃 + 曳光左右輪替);機載後座 → stepAerial 機鼻上仰脈衝
  g.userData.rig = { kind: 'aerial', tilt, tiltY0: 1.6, bob: 0.05, top: 16,
    weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.03 },
    lightGlow: podMuz.map((mesh) => ({ mesh, base: 0.6 })),
    muzzles: { light: { n: podMuz[1], r: 0.15 }, heavy: null } };
  g.userData.turretMuzzles = podMuz;   // 曳光起點左右輪替(game.js _npcMuzzle)
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
 * 蜂群戰鬥機器人步兵(soldier / rocketeer / howitzer 共用雙足骨架):
 * 逆關節鳥腿 + 蜂腹環紋 + 單眼複合感測條;soldier 右手鼓式彈鼓機槍,
 * rocket 架右肩肩射式火箭筒(2026-07-17 重設計,對應 wid:'rocket'),
 * gl 右手轉輪榴彈槍(2026-07-17 榴彈兵步兵化)。
 */
function buildSwarmTrooper(side, { rocket = false, gl = false } = {}) {
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
  // 武器(2026-07-17 戰鬥姿勢化:同 buildTrooper —— gunR 俯仰/aimPose 據槍/槍口環/後座)
  let tGun = null, tMuz = null, tAim = null, tWeap = null, tHvy = null;
  if (rocket) {
    // 肩射式火箭筒(shoulderTube 共用積木):架右肩、行軍微仰 ↔ 交戰放平朝目標
    const tube = shoulderTube(accent);
    tube.position.set(0.4, 1.02, -0.05);
    tube.rotation.x = -0.22;
    hips.add(tube);
    tGun = { g: tube, rest: -0.22, aim: -0.06 };
    tMuz = tube.userData.muz;
    // 戰鬥姿勢(2026-07-22 規則 2):交戰雙臂上抬扶筒,同 buildTrooper 'tube'
    tAim = { rShoulderX: -0.7, lShoulderX: -0.85, lShoulderY: 0.55 };
    tWeap = { light: 'N', heavy: 'N' };
    tHvy = { chest: 0.05, gun: 0.1 };
  } else if (gl) {
    // 手持轉輪榴彈槍(handGL 共用積木):右手托持;拋物線仰角由 game.js 逐發解算
    const g2 = handGL(accent);
    g2.position.set(0.02, -0.76, 0.28);
    armR.add(g2);
    tGun = { g: g2, rest: 0.08, aim: 0.05, comp: 0.55 };
    tMuz = g2.userData.muz;
    tAim = { rShoulderX: -0.55, lShoulderX: -0.5, lShoulderY: 0.45 };
    tWeap = { light: 'R', heavy: 'R' };
    tHvy = { chest: 0.04 };
  } else {
    // 鼓式彈鼓機槍掛右手(短護木 + 琥珀砲口環)
    const mg = bx(armR, 0.1, 0.16, 1.2, 0.02, -0.78, 0.42, 0x15181c);
    bx(mg, 0.05, 0.07, 0.55, 0, 0.03, 0.8, 0x30373f, { metalness: 0.85 });    // 槍管
    const drum = cyl(mg, 0.13, 0.13, 0.14, 8, 0, -0.16, 0.02, SW_DK);         // 彈鼓
    drum.rotation.z = Math.PI / 2;
    const muz = cyl(mg, 0.05, 0.05, 0.05, 6, 0, 0.03, 1.08, accent, { emissive: accent, emissiveIntensity: 1.0 });
    muz.rotation.x = Math.PI / 2;
    tGun = { g: mg, rest: 0.06, aim: 0.55 };
    tMuz = muz;
    tAim = { rShoulderX: -0.55, lShoulderX: -0.5, lShoulderY: 0.45 };
    tWeap = { light: 'R', heavy: 'R' };
    tHvy = { chest: 0.04 };
  }
  g.userData.rig = {
    kind: 'biped', hips, legL, legR, armL, armR,
    hipsY0: hipY, stride: 0.95, bob: 0.07, sway: 0.06, top: 8, gunArm: true,
    gunR: tGun, aimPose: tAim, weap: tWeap, hvy: tHvy,
    lightGlow: tMuz ? [{ mesh: tMuz, base: 0.8 }] : null,
    muzzles: { light: tMuz ? { n: tMuz, r: 0.08 } : null, heavy: null },
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
  // 遙控槍塔 + 天線(2026-07-22 規則 1:塔座 yaw + 砲管俯仰節點,不再焊死)
  const turret = new THREE.Group();
  turret.position.set(0, 2.12, 0.5);
  hull.add(turret);
  cyl(turret, 0.45, 0.55, 0.4, 6, 0, 0, 0, SW_PLATE);                    // 塔座
  const saPit = new THREE.Group();
  saPit.position.set(0, 0.08, 0.35);
  turret.add(saPit);
  turret.userData.pitch = saPit;
  const barrel = cyl(saPit, 0.06, 0.07, 1.6, 6, 0, 0, 0.65, 0x111418, { metalness: 0.8 });
  barrel.rotation.x = Math.PI / 2;
  const saMuz = cyl(barrel, 0.08, 0.08, 0.05, 6, 0, 0.85, 0, accent, { emissive: accent, emissiveIntensity: 0.7 });
  cyl(hull, 0.02, 0.03, 1.2, 5, -1.0, 2.4, -2.0, 0x23262a);
  g.userData.rig = { kind: 'wheeled', hull, hullY0: 0, wheels: [], top: 11,
    weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0 },
    kickAmp: { light: 1.6 },
    lightGlow: [{ mesh: saMuz, base: 0.7 }],
    muzzles: { light: { n: saMuz, r: 0.1 }, heavy: null } };
  g.userData.turret = turret;   // 槍塔獨立追蹤目標(game.js _aimVehicleTurret)
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
  // 本體專用略亮甲殼色(比其餘蜂群小兵高一階明度):四足步行砲台體型大、常整台逆光,
  // 沿用小兵那組暗灰在城市場景下會糊成一片黑影,看不出車身分件與朝向。
  const SHELL = 0x474c56, DK = 0x363b43, PLATE = 0x5a616c, JOINT = 0x282c33;
  const hipY = 2.1;
  const spine = new THREE.Group();
  spine.position.y = hipY;
  g.add(spine);
  // 後段蜂腹甲殼(琥珀環紋)
  bx(spine, 2.2, 1.2, 2.0, 0, 0, -1.5, SHELL, { metalness: 0.6 });
  bx(spine, 2.3, 0.16, 1.8, 0, 0.66, -1.5, PLATE);
  for (let i = 0; i < 2; i++)
    bx(spine, 2.26, 0.18, 0.26, 0, -0.1, -1.0 - i * 0.75, accent,
      { emissive: accent, emissiveIntensity: 0.5 });                     // 腹部環紋
  // 尾端警示燈(暗紅,呼應鋼鐵坦克尾燈邏輯):逆光/背對時仍能一眼認出「這端是後面」
  bx(spine, 0.5, 0.16, 0.1, 0, 0.15, -2.52, 0x7a1e1e,
    { emissive: 0xff3030, emissiveIntensity: 0.8 });                     // 尾燈
  // 前段主甲殼(胸樞軸:脊椎波第二節)
  const chest = new THREE.Group();
  chest.position.set(0, 0.05, 0.2);
  spine.add(chest);
  bx(chest, 2.5, 1.4, 2.6, 0, 0.1, 0.8, PLATE, { metalness: 0.6 });
  bx(chest, 2.3, 0.2, 2.2, 0, 0.88, 0.8, SHELL);                         // 背甲
  // 背載磁軌砲(朝 +z;導軌 + 充能環)—— 2026-07-22 規則 1:砲架 yaw + 俯仰節點
  // (game.js _aimVehicleTurret 追瞄;攻城彈道拋物線仰角由 _arcTracer 解算),不再焊死背甲
  const stTur = new THREE.Group();
  stTur.position.set(0, 1.05, 0.4);
  chest.add(stTur);
  cyl(stTur, 0.3, 0.42, 0.35, 8, 0, -0.22, 0, JOINT, { metalness: 0.7 });  // 砲架座圈
  const stPit = new THREE.Group();
  stTur.add(stPit);
  stTur.userData.pitch = stPit;
  const gun = cyl(stPit, 0.15, 0.19, 4.6, 8, 0, 0, 2.2, 0x14171a, { metalness: 0.8 });
  gun.rotation.x = Math.PI / 2;
  for (const s of [-1, 1]) bx(gun, 0.08, 3.8, 0.16, s * 0.24, -0.2, 0, DK, { metalness: 0.7 });
  cyl(gun, 0.24, 0.24, 0.4, 6, 0, 2.1, 0, 0x0d0f11);                     // 砲口
  cyl(gun, 0.21, 0.21, 0.16, 6, 0, 1.55, 0, accent, { emissive: accent, emissiveIntensity: 0.9 });
  const stMuz = cyl(gun, 0.19, 0.19, 0.07, 6, 0, 2.34, 0, accent, { emissive: accent, emissiveIntensity: 0.8 });
  // 砲口環(擊發閃光/曳光起點);後座走 _kickB → stepQuad 胸腔下沉
  // 頸/頭(複眼感測;stepQuad 靜止警戒掃描)
  const neck = new THREE.Group();
  neck.position.set(0, -0.15, 2.1);
  chest.add(neck);
  bx(neck, 0.5, 0.4, 0.5, 0, 0, 0.1, DK);
  const head = new THREE.Group();
  head.position.set(0, 0, 0.4);
  neck.add(head);
  bx(head, 0.7, 0.5, 0.6, 0, 0, 0.2, SHELL, { metalness: 0.6 });
  // 複眼:加大 + 左右分片,任何角度都至少露出一片,不靠移動也能判斷正面
  for (const sx of [-1, 1])
    bx(head, 0.26, 0.2, 0.1, sx * 0.16, 0.06, 0.54, accent, { emissive: accent, emissiveIntensity: 1.8 });
  for (const sx of [-1, 1]) {
    const ant = cyl(head, 0.02, 0.03, 0.7, 5, sx * 0.22, 0.5, 0.3, 0x14171a);
    ant.rotation.x = -0.6;                                               // 蜂觸角
  }
  // 尾(散熱鰭配重;stepQuad 急轉甩尾)
  const tail = new THREE.Group();
  tail.position.set(0, 0.15, -2.5);
  spine.add(tail);
  bx(tail, 0.3, 0.5, 0.8, 0, 0, -0.4, DK);
  const tail2 = new THREE.Group();
  tail2.position.set(0, 0, -0.8);
  tail.add(tail2);
  bx(tail2, 0.2, 0.36, 0.6, 0, 0, -0.3, JOINT);
  bx(tail2, 0.22, 0.2, 0.16, 0, 0, -0.62, accent, { emissive: accent, emissiveIntensity: 0.8 });
  // 四足:髖樞軸 + 逆關節 + 足墊
  const mkLeg = (sx, sz, front) => {
    const leg = new THREE.Group();
    leg.position.set(sx * 1.3, hipY, sz);
    bx(leg, 0.5, 0.5, 0.6, 0, 0, 0, PLATE, { metalness: 0.6 });          // 髖甲
    const th = bx(leg, 0.3, 1.3, 0.45, 0, -0.55, front ? 0.15 : -0.15, SHELL);
    th.rotation.x = front ? -0.25 : 0.25;
    const sh = bx(leg, 0.2, 1.2, 0.3, 0, -1.5, front ? -0.15 : 0.15, DK);
    sh.rotation.x = front ? 0.3 : -0.3;
    bx(leg, 0.34, 0.18, 0.5, 0, -2.02, 0.05, JOINT);                     // 足墊
    g.add(leg);
    return leg;
  };
  g.userData.rig = {
    kind: 'quad', spine, chest, neck, head,
    tailSegs: [tail, tail2],   // stepQuad 契約:尾 = 多節鞭(2026-07-17 坦克重返波次時補登,缺了會炸 whipTail)
    neckY0: neck.position.y,   // 頸的靜姿高度(stepQuad 每幀以它為基準補償)
    legFL: mkLeg(-1, 1.1, true), legFR: mkLeg(1, 1.1, true),
    legHL: mkLeg(-1, -1.5, false), legHR: mkLeg(1, -1.5, false),
    hipsY0: hipY, stride: 1.6, bob: 0.08, top: 9,
    weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.05 },   // 背砲機載:後座 _kickB → 胸腔下沉
    kickAmp: { light: 2.2 },
    lightGlow: [{ mesh: stMuz, base: 0.8 }],
    muzzles: { light: { n: stMuz, r: 0.24 }, heavy: null },
  };
  g.userData.turret = stTur;   // 背砲獨立追蹤目標(game.js _aimVehicleTurret)
  return g;
}

// ---------- 第三方軍隊(2026-07-17;游擊隊 GUER / 武裝民兵 MILI,見 data.js THIRD)----------
// 設計原則:剪影與雙陣營都不同 —— 鋼鐵 = 制式機器人部隊、蜂群 = 正規人類軍;
// 第三方 = 非正規武裝:無鋼盔(頭巾/扁帽)、捲袖露膚、木質槍托、舊式載具外掛沙包/柵欄裝甲,
// 識別色走 THIRD.SIDES(游擊隊 = 叢林綠、民兵 = 鏽橙),賽璐璐大色塊語彙不變。
const REBEL_COLS = {
  GUER: { cloth: 0x55603c, cloth2: 0x465032, dark: 0x333b28, skin: 0xc09a72, wood: 0x6e4f30, hull: 0x50583e },
  MILI: { cloth: 0x5d5248, cloth2: 0x4d443c, dark: 0x38322c, skin: 0xb98d66, wood: 0x5e452c, hull: 0x5a5044 },
};
const rebelAccent = (side) => new THREE.Color(THIRD.SIDES[side]?.color || '#9aa39b');

/**
 * 第三方步兵(游擊隊/武裝民兵共用可動骨架;rig 合約同 buildTrooper):
 * weapon: 'rifle' 木托突擊步槍 / 'rpg' 肩射式火箭筒 / 'gl' 手持轉輪榴彈槍。
 */
function buildRebelTrooper(side, weapon) {
  const g = new THREE.Group();
  const C = REBEL_COLS[side] || REBEL_COLS.GUER;
  const accent = rebelAccent(side);
  const hipY = 1.3;
  const mkLeg = (sx) => {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.21, hipY, 0);
    bx(leg, 0.26, 0.56, 0.29, 0, -0.3, 0, C.cloth);                      // 寬鬆野戰褲
    bx(leg, 0.2, 0.5, 0.23, 0, -0.86, 0, dim(C.cloth, 0.85));
    bx(leg, 0.23, 0.16, 0.42, 0, -1.16, 0.05, C.dark);                   // 舊軍靴
    g.add(leg);
    return leg;
  };
  const legL = mkLeg(-1), legR = mkLeg(1);
  const hips = new THREE.Group();
  hips.position.y = hipY;
  g.add(hips);
  bx(hips, 0.52, 0.22, 0.32, 0, 0.08, 0, C.dark);                        // 工作腰帶
  bx(hips, 0.18, 0.16, 0.12, 0.17, 0.04, 0.17, C.cloth2);                // 雜物腰包
  bx(hips, 0.58, 0.62, 0.36, 0, 0.58, 0, C.cloth);                       // 軀幹(無防彈背心 = 非正規)
  const sash = bx(hips, 0.16, 0.72, 0.4, 0, 0.58, 0.01, C.dark);         // 彈鏈斜背帶
  sash.rotation.z = 0.6;
  for (const k of [-0.22, 0, 0.22]) {
    bx(sash, 0.06, 0.08, 0.42, 0, k, 0.01, 0xb8a468);                    // 彈鏈彈殼列
  }
  // 頭 + 頭巾(游擊隊)/扁帽(民兵)—— 刻意無鋼盔,剪影與正規軍分家
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 10, 8), mat(C.skin));
  head.position.set(0, 1.16, 0.02);
  hips.add(head);
  if (side === 'GUER') {
    cyl(hips, 0.245, 0.255, 0.1, 10, 0, 1.29, 0.02, accent);             // 頭巾纏帶
    bx(hips, 0.08, 0.05, 0.22, -0.16, 1.24, -0.18, accent);              // 頭巾尾
    const net = bx(hips, 0.5, 0.1, 0.4, 0.08, 0.94, -0.04, C.cloth2);    // 肩披偽裝網
    net.rotation.z = -0.14;
  } else {
    cyl(hips, 0.26, 0.27, 0.09, 10, 0, 1.32, 0, C.cloth2);               // 扁帽
    bx(hips, 0.2, 0.04, 0.16, 0, 1.3, 0.26, C.cloth2);                   // 帽簷
    bx(hips, 0.1, 0.06, 0.04, 0, 1.33, 0.2, accent, { emissive: accent, emissiveIntensity: 0.8 });  // 帽徽
  }
  // 手臂:上臂著衣、前臂捲袖露膚(非正規識別剪影)
  const mkArm = (sx) => {
    const a = new THREE.Group();
    a.position.set(sx * 0.45, 0.88, 0);
    bx(a, 0.16, 0.42, 0.21, 0, -0.21, 0, C.cloth);
    bx(a, 0.13, 0.38, 0.17, 0, -0.6, 0.05, C.skin);
    bx(a, 0.13, 0.12, 0.16, 0, -0.84, 0.08, C.skin);
    hips.add(a);
    return a;
  };
  const armL = mkArm(-1), armR = mkArm(1);
  bx(armL, 0.2, 0.11, 0.24, 0, -0.1, 0, accent, { emissive: accent, emissiveIntensity: 0.6 });   // 識別臂章
  // 武器(2026-07-17 戰鬥姿勢化:同 buildTrooper —— gunR 俯仰/aimPose 據槍/槍口環/後座)
  let tGun = null, tMuz = null, tAim = null, tWeap = null, tHvy = null;
  if (weapon === 'rpg') {
    const tube = shoulderTube(accent);
    tube.position.set(0.34, 1.04, 0);
    tube.rotation.x = -0.24;
    hips.add(tube);
    tGun = { g: tube, rest: -0.24, aim: -0.06 };
    tMuz = tube.userData.muz;
    // 戰鬥姿勢(2026-07-22 規則 2):交戰雙臂上抬扶筒,同 buildTrooper 'tube'
    tAim = { rShoulderX: -0.7, lShoulderX: -0.85, lShoulderY: 0.55 };
    tWeap = { light: 'N', heavy: 'N' };
    tHvy = { chest: 0.05, gun: 0.1 };
  } else if (weapon === 'gl') {
    const gl = handGL(accent);
    gl.position.set(0.03, -0.78, 0.3);
    armR.add(gl);
    tGun = { g: gl, rest: 0.08, aim: 0.05, comp: 0.55 };
    tMuz = gl.userData.muz;
    tAim = { rShoulderX: -0.55, lShoulderX: -0.5, lShoulderY: 0.45 };
    tWeap = { light: 'R', heavy: 'R' };
    tHvy = { chest: 0.04 };
  } else {
    // 木托突擊步槍(弧形彈匣)掛右手
    const ak = bx(armR, 0.08, 0.14, 1.0, 0.02, -0.78, 0.34, 0x22262a);
    bx(ak, 0.07, 0.11, 0.3, 0, 0.01, 0.28, C.wood);                      // 木護木
    bx(ak, 0.045, 0.055, 0.5, 0, 0.03, 0.72, 0x30373f, { metalness: 0.85 });  // 槍管
    const akMuz = cyl(ak, 0.045, 0.045, 0.06, 6, 0, 0.03, 1.0, accent, { emissive: accent, emissiveIntensity: 0.6 });
    akMuz.rotation.x = Math.PI / 2;                                      // 槍口環(擊發閃光)
    const mag = bx(ak, 0.05, 0.26, 0.11, 0, -0.17, 0.12, C.wood);        // 弧形彈匣
    mag.rotation.x = 0.4;
    bx(ak, 0.06, 0.11, 0.36, 0, -0.03, -0.62, C.wood);                   // 木槍托
    bx(ak, 0.05, 0.1, 0.06, 0, -0.13, -0.18, 0x23262a);                  // 握把
    tGun = { g: ak, rest: 0.06, aim: 0.55 };
    tMuz = akMuz;
    tAim = { rShoulderX: -0.55, lShoulderX: -0.5, lShoulderY: 0.45 };
    tWeap = { light: 'R', heavy: 'R' };
    tHvy = { chest: 0.04 };
  }
  g.userData.rig = {
    kind: 'biped', hips, legL, legR, armL, armR,
    hipsY0: hipY, stride: 0.95, bob: 0.07, sway: 0.06, top: 8, gunArm: true,
    gunR: tGun, aimPose: tAim, weap: tWeap, hvy: tHvy,
    lightGlow: tMuz ? [{ mesh: tMuz, base: 0.6 }] : null,
    muzzles: { light: tMuz ? { n: tMuz, r: 0.08 } : null, heavy: null },
  };
  return g;
}

/**
 * 游擊隊舊式坦克:鑄造圓砲塔 + 外露路輪(無側裙)+ 沙包/柵欄裝甲/外掛油桶 ——
 * 與鋼鐵現代 MBT、蜂群四足砲台剪影三方分家。rig 走 tracked(輪留根節點著地)。
 */
function buildRebelTank(side) {
  const g = new THREE.Group();
  const C = REBEL_COLS[side] || REBEL_COLS.GUER;
  const accent = rebelAccent(side);
  const hullC = C.hull, hullD = dim(C.hull, 0.82);
  const hull = new THREE.Group();
  g.add(hull);
  bx(hull, 2.4, 0.9, 5.2, 0, 1.55, 0, hullC);                            // 主車身(短促舊式)
  const glacis = bx(hull, 2.4, 0.8, 1.3, 0, 1.45, 2.7, hullD);           // 前斜甲
  glacis.rotation.x = 0.55;
  bx(hull, 2.2, 0.16, 2.2, 0, 2.08, -1.6, hullD);                        // 引擎甲板
  // 沙包堆(前甲野戰補強)
  for (const [sx, sy, sz] of [[-0.6, 1.98, 2.35], [0, 2.04, 2.45], [0.6, 1.98, 2.35], [-0.3, 1.86, 2.7], [0.3, 1.86, 2.7]]) {
    rbz(hull, 0.52, 0.26, 0.68, sx, sy, sz, 0x8a7a58);
  }
  // 外掛油桶 ×2(車尾)
  for (const s of [-1, 1]) {
    const drum = cyl(hull, 0.26, 0.26, 0.8, 10, s * 0.55, 2.15, -2.8, C.dark);
    drum.rotation.x = Math.PI / 2;
  }
  // 柵欄裝甲(側面條板;鏤空 = 反成形裝藥的貧窮人智慧)
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) bx(hull, 0.06, 0.5, 0.14, s * 1.58, 1.6, -1.7 + k * 1.15, C.dark);
    bx(hull, 0.06, 0.08, 4.6, s * 1.58, 1.86, 0, C.dark);                // 上橫桿
    bx(hull, 0.06, 0.08, 4.6, s * 1.58, 1.36, 0, C.dark);                // 下橫桿
    bx(hull, 0.6, 0.16, 5.4, s * 1.25, 1.12, 0, 0x2a2e33);               // 履帶上帶
  }
  // 外露路輪(無側裙 = 舊式底盤剪影;輪在根節點,rig.wheels 吃線速度)
  const wheels = [];
  const roadWheel = (s, z, r, y) => {
    const w = cyl(g, r, r, 0.5, 12, s * 1.25, y, z, 0x1e2226);
    w.rotation.z = Math.PI / 2;
    cyl(w, r * 0.45, r * 0.45, 0.54, 8, 0, 0, 0, 0x3a4046);              // 輪轂
    wheels.push({ m: w, r });
  };
  for (const s of [-1, 1]) {
    for (let i = 0; i < 5; i++) roadWheel(s, -1.9 + i * 0.95, 0.52, 0.55);
    roadWheel(s, 2.6, 0.4, 0.9);                                         // 前惰輪
    roadWheel(s, -2.6, 0.4, 0.9);                                        // 後主動輪
  }
  // 鑄造圓砲塔(半球壓扁)前置
  const turret = new THREE.Group();
  turret.position.set(0, 2.16, 0.4);
  hull.add(turret);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.02, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(hullD));
  dome.scale.set(1, 0.72, 1.12);
  turret.add(dome);
  bx(turret, 0.5, 0.12, 0.5, -0.3, 0.72, -0.15, C.dark);                 // 艙蓋
  // 主砲俯仰節點(2026-07-22 規則 1:拋物線攻城彈道的仰角由 game.js 解算,不再焊死水平)
  const rtPit = new THREE.Group();
  rtPit.position.set(0, 0.3, 0.55);
  turret.add(rtPit);
  turret.userData.pitch = rtPit;
  const gun = cyl(rtPit, 0.11, 0.14, 3.5, 10, 0, 0, 1.75, 0x14171a, { metalness: 0.8 });
  gun.rotation.x = Math.PI / 2;                                          // 主砲
  cyl(gun, 0.16, 0.16, 0.3, 8, 0, 1.65, 0, 0x0d0f11);                    // 砲口
  const rtMuz = cyl(gun, 0.14, 0.14, 0.05, 8, 0, 1.83, 0, accent, { emissive: accent, emissiveIntensity: 0.6 });
  cyl(turret, 0.02, 0.02, 0.9, 5, -0.5, 0.85, -0.55, 0x23262a);          // 旗桿
  bx(turret, 0.02, 0.24, 0.36, -0.5, 1.2, -0.72, accent, { emissive: accent, emissiveIntensity: 0.8 });  // 陣營識別旗
  // 砲口環(擊發閃光/曳光起點)+ 機載後座(stepVehicle 車體後仰)
  g.userData.rig = { kind: 'tracked', hull, hullY0: 0, wheels, top: 9,
    weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0 },
    kickAmp: { light: 2.2 },
    lightGlow: [{ mesh: rtMuz, base: 0.6 }],
    muzzles: { light: { n: rtMuz, r: 0.18 }, heavy: null } };
  g.userData.turret = turret;                                            // 砲塔獨立追蹤目標
  return g;
}

/**
 * 武裝民兵輕型直升機:泡形座艙 + 桁架尾桁 + 側掛雙機槍(門射手改裝)——
 * 與鋼鐵攻擊直升機、蜂群六旋翼砲艇剪影三方分家。rig 走 aerial + spin 轉槳。
 */
function buildRebelHeli(side) {
  const g = new THREE.Group();
  const C = REBEL_COLS[side] || REBEL_COLS.GUER;
  const accent = rebelAccent(side);
  const bodyC = C.hull;
  const tilt = new THREE.Group();
  tilt.position.y = 1.5;
  g.add(tilt);
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 10),
    mat(0x1c2830, { emissive: 0x9adfff, emissiveIntensity: 0.25 }));
  bubble.position.set(0, 0.15, 0.95);
  bubble.scale.set(0.95, 0.9, 1.05);
  tilt.add(bubble);                                                      // 泡形座艙(民用改裝感)
  bx(tilt, 1.0, 0.8, 1.5, 0, 0.05, -0.1, bodyC);                         // 短機身艙
  bx(tilt, 0.9, 0.1, 0.9, 0, 0.52, 0, dim(bodyC, 0.85));                 // 艙頂板
  // 桁架尾桁(鏤空斜撐 = 輕型機剪影核心)
  for (const s of [-1, 1]) {
    bx(tilt, 0.05, 0.05, 2.4, s * 0.14, 0.32, -1.6, C.dark);             // 上桁
    const low = bx(tilt, 0.05, 0.05, 2.35, s * 0.14, -0.02, -1.55, C.dark);
    low.rotation.x = 0.13;                                               // 下桁(收斂)
  }
  for (let k = 0; k < 4; k++) {
    const brace = bx(tilt, 0.04, 0.32, 0.04, 0, 0.14, -0.75 - k * 0.55, C.dark);
    brace.rotation.x = k % 2 ? 0.55 : -0.55;                             // 斜撐交錯
  }
  bx(tilt, 0.05, 0.5, 0.3, 0, 0.3, -2.85, bodyC);                        // 垂直尾翼
  bx(tilt, 0.06, 0.14, 0.32, 0, 0.55, -2.85, accent, { emissive: accent, emissiveIntensity: 0.9 });
  const tailRotor = bx(tilt, 0.04, 0.8, 0.1, 0.1, 0.25, -2.95, 0x9aa4ad, { transparent: true, opacity: 0.85 });
  cyl(tilt, 0.1, 0.12, 0.35, 8, 0, 0.75, 0.1, 0x14171a);                 // 主軸
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.04, 0.16),
    mat(0x9aa4ad, { transparent: true, opacity: 0.8 }));
  rotor.position.set(0, 0.95, 0.1);
  tilt.add(rotor);                                                       // 主旋翼
  // 側掛機槍 ×2(門射手改裝)—— 2026-07-22 規則 1:共軛俯仰槍架(對地射擊槍管下壓,
  // 不再焊死水平;game.js _aimGunTilt 依攻擊目標仰角驅動)
  const rhPiv = new THREE.Group();
  rhPiv.position.set(0, -0.12, 0.3);
  tilt.add(rhPiv);
  const rhMuz = [];
  for (const s of [-1, 1]) {
    const mg = cyl(rhPiv, 0.05, 0.05, 0.9, 6, s * 0.56, 0, 0.2, 0x14171a, { metalness: 0.8 });
    mg.rotation.x = Math.PI / 2;
    rhMuz.push(cyl(mg, 0.06, 0.06, 0.04, 6, 0, 0.5, 0, accent, { emissive: accent, emissiveIntensity: 0.6 }));
    bx(rhPiv, 0.1, 0.14, 0.2, s * 0.56, 0, -0.18, C.dark);               // 槍架
  }
  g.userData.gunTilt = rhPiv;   // 共軛俯仰(game.js _aimGunTilt)
  // 起落橇
  for (const s of [-1, 1]) {
    bx(tilt, 0.08, 0.08, 2.2, s * 0.7, -0.85, 0.1, C.dark);
    for (const z of [-0.5, 0.7]) {
      const strut = bx(tilt, 0.06, 0.5, 0.06, s * 0.7, -0.6, z, C.dark);
      strut.rotation.z = s * 0.3;
    }
  }
  bx(tilt, 0.9, 0.08, 0.5, 0, -0.36, 0.2, accent, { emissive: accent, emissiveIntensity: 0.7 });  // 機腹識別條
  g.userData.spin = [rotor, tailRotor];
  // 側掛機槍口 = 槍口錨(雙槍齊閃 + 曳光左右輪替);機載後座 → stepAerial 機鼻上仰脈衝
  g.userData.rig = { kind: 'aerial', tilt, tiltY0: 1.5, bob: 0.07, top: 16,
    weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.03 },
    lightGlow: rhMuz.map((mesh) => ({ mesh, base: 0.6 })),
    muzzles: { light: { n: rhMuz[1], r: 0.08 }, heavy: null } };
  g.userData.turretMuzzles = rhMuz;   // 曳光起點左右輪替(game.js _npcMuzzle)
  return g;
}

/**
 * 第三方碉堡:八角混凝土工事 + 四向射孔 + 頂圈沙包胸牆 + 陣營旗 ——
 * 駐守 3 名步槍兵的家(sim 駐守機制見 THIRD);無 rig(靜態建築)。
 */
function buildBunker(side) {
  const g = new THREE.Group();
  const accent = rebelAccent(side);
  const conc = side === 'GUER' ? 0x6a705c : 0x6f675c;                    // 混凝土(帶陣營土色)
  const dark = dim(conc, 0.72);
  cyl(g, 3.4, 3.9, 0.8, 8, 0, 0.4, 0, dark).rotation.y = Math.PI / 8;    // 基座
  cyl(g, 2.6, 3.3, 2.2, 8, 0, 1.9, 0, conc).rotation.y = Math.PI / 8;    // 八角主體
  for (let k = 0; k < 4; k++) {                                          // 四向水平射孔(黑縫)
    const a = k * Math.PI / 2;
    const slit = bx(g, 1.4, 0.22, 0.3, 0, 2.2, 0, 0x0a0c0e);
    slit.position.set(Math.sin(a) * 2.55, 2.2, Math.cos(a) * 2.55);
    slit.rotation.y = a;
  }
  cyl(g, 2.9, 2.7, 0.5, 8, 0, 3.25, 0, dark).rotation.y = Math.PI / 8;   // 頂蓋
  for (let k = 0; k < 8; k++) {                                          // 頂圈沙包胸牆
    const a = k * Math.PI / 4;
    const bag = rbz(g, 0.7, 0.3, 0.5, Math.sin(a) * 2.25, 3.6, Math.cos(a) * 2.25, 0x8a7a58);
    bag.rotation.y = a;
  }
  bx(g, 1.0, 1.4, 0.5, 0, 0.9, 2.95, 0x14171a);                          // 正面門洞(步槍兵進出口)
  bx(g, 1.3, 0.24, 0.55, 0, 1.72, 2.95, dark);                           // 門楣
  cyl(g, 0.04, 0.05, 1.7, 5, -1.4, 4.2, -1.0, 0x23262a);                 // 通訊桿
  bx(g, 0.03, 0.5, 0.8, -1.4, 4.85, -1.42, accent, { emissive: accent, emissiveIntensity: 0.8 });  // 陣營旗
  for (let k = 0; k < 4; k++) {                                          // 識別燈(斜角四座)
    const a = k * Math.PI / 2 + Math.PI / 4;
    bx(g, 0.2, 0.2, 0.2, Math.sin(a) * 2.75, 3.0, Math.cos(a) * 2.75, accent, { emissive: accent, emissiveIntensity: 1.0 });
  }
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
  // 頜下機砲(2026-07-22 規則 1:共軛俯仰槍架 —— 對地射擊砲管下壓;game.js _aimGunTilt)
  const chinPiv = new THREE.Group();
  chinPiv.position.set(0, -0.55, 0.9);
  tilt.add(chinPiv);
  const chin = cyl(chinPiv, 0.08, 0.1, 1.0, 8, 0, 0, 0.3, 0x111418, { metalness: 0.8 });
  chin.rotation.x = Math.PI / 2;                                         // 頜下機砲
  const chinMuz = cyl(chin, 0.09, 0.09, 0.05, 8, 0, 0.55, 0, accent, { emissive: accent, emissiveIntensity: 0.8 });
  g.userData.gunTilt = chinPiv;
  // 短翼(火箭莢艙已拆除,2026-07-22 規則 5:零接線的裝飾莢口不留 —— 功能武裝 = 頜下機砲);
  // 翼端改掛航行燈識別
  bx(tilt, 2.6, 0.1, 0.5, 0, -0.15, -0.2, SW_DK);
  for (const s of [-1, 1])
    bx(tilt, 0.14, 0.08, 0.3, s * 1.2, -0.12, -0.2, accent, { emissive: accent, emissiveIntensity: 0.9 });
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
  // 頜下機砲口 = 槍口錨;機載後座 → stepAerial 機鼻上仰脈衝
  g.userData.rig = { kind: 'aerial', tilt, tiltY0: 1.7, bob: 0.06, top: 16,
    weap: { light: 'N', heavy: 'N' }, hvy: { chest: 0.03 },
    lightGlow: [{ mesh: chinMuz, base: 0.8 }],
    muzzles: { light: { n: chinMuz, r: 0.1 }, heavy: null } };
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
  const swMuz = [];
  for (const sx of [-1.0, 0, 1.0]) {
    for (const sy of [-0.35, 0.35]) {
      const tube = cyl(pitch, 0.3, 0.3, 0.4, 6, sx, sy, 1.55, 0x14171a);
      tube.rotation.x = Math.PI / 2;
      const rim = cyl(pitch, 0.34, 0.34, 0.08, 6, sx, sy, 1.74, accent, { emissive: accent, emissiveIntensity: 1.0 });
      rim.rotation.x = Math.PI / 2;
      swMuz.push(rim);   // 管口環:曳光起點/開火閃(shot 事件逐管輪替)
    }
  }
  const sensor = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.3 }));
  sensor.position.set(0, 0.95, 0.9);
  pitch.add(sensor);
  yaw.userData.pitch = pitch;
  yaw.userData.muzzles = swMuz;
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
  const twMuz = [];
  for (const sx of [-0.55, 0.55]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 4.6, 8), mat(0x14171a, { metalness: 0.9 }));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(sx, 0, 2.0);
    pitch.add(barrel);
    const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.5, 8), mat(0x0d0f11));
    brake.rotation.x = Math.PI / 2;
    brake.position.set(sx, 0, 4.1);
    pitch.add(brake);
    const mz = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.08, 8),
      mat(accent, { emissive: accent, emissiveIntensity: 0.7 }));
    mz.rotation.x = Math.PI / 2;
    mz.position.set(sx, 0, 4.4);
    pitch.add(mz);
    twMuz.push(mz);   // 砲口環:曳光起點/開火閃(game.js shot 事件雙管輪替)
  }
  const sensor = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), mat(accent, { emissive: accent, emissiveIntensity: 1.2 }));
  sensor.position.set(0, 0.9, 1.6);
  pitch.add(sensor);
  yaw.add(pitch);
  yaw.userData.pitch = pitch;
  yaw.userData.muzzles = twMuz;
  outlinify(yaw, 0.1);
  return yaw;
}

const FALLBACK = {
  // 英雄 builder MUST 透傳 ch(角色武器型別決定莢艙/雙槍建模;吃掉 ch = 全退回通用莢)
  'hero:drone': (side, vis, ch) => buildDrone(side, vis, ch),
  'hero:robot': (side, vis, ch) => buildRobotMech(side, vis, ch),
  'hero:morph': (side, vis, ch) => buildMorphMech(side, vis, ch),
  decoy: (side, vis) => buildDecoy(side, vis),
  // NPC/塔陣營差異化:鋼鐵 = 履帶/輪式軍武;蜂群 = 懸浮/旋翼/機器人重塑版
  // 人類步兵外觀雙方對調:蜂群 = 人類部隊、鋼鐵 = 機器人部隊(2026-07-11)
  // 第三方(GUER/MILI,2026-07-17):非正規武裝專屬建模,剪影與雙陣營都不同
  // 榴彈兵(2026-07-17 步兵化):雙陣營一律「步兵 + 手持榴彈槍」,不再是砲車/浮游平台
  'creep:soldier': (side) => (isThirdSide(side) ? buildRebelTrooper(side, 'rifle')
    : side === 'SWARM' ? buildSoldierFallback(side) : buildSwarmTrooper(side)),
  'creep:apc': (side) => (side === 'SWARM' ? buildSwarmApc(side) : buildApc(side)),
  'creep:tank': (side) => (isThirdSide(side) ? buildRebelTank(side)
    : side === 'SWARM' ? buildSwarmTank(side) : buildTank(side)),
  'creep:rocketeer': (side) => (isThirdSide(side) ? buildRebelTrooper(side, 'rpg')
    : side === 'SWARM' ? buildRocketeerFallback(side) : buildSwarmTrooper(side, { rocket: true })),
  'creep:howitzer': (side) => (isThirdSide(side) ? buildRebelTrooper(side, 'gl')
    : side === 'SWARM' ? buildGrenadierFallback(side) : buildSwarmTrooper(side, { gl: true })),
  'creep:heli': (side) => (isThirdSide(side) ? buildRebelHeli(side)
    : side === 'SWARM' ? buildSwarmHeli(side) : buildHeliFallback(side)),
  bunker: (side) => buildBunker(side),
  // 平民/間諜(ch = 職業 index;陣營靠 side 決定 teamRing,外觀共用不分間諜)
  civ: (side, vis, ch) => buildCivilian(side, ch | 0),
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

// ── 運動性格 MOVE_SIG(依角色 id;locomotion.js gsig/fsig 讀取,makeUnit 掛到 rig.moveSig)──────
// 把「靜止/加速/(奔跑或飛行)/減速」四相位依真實運動員/軍種/生物飛行原型差異化(奔跑/飛行穩態早已差異化)。
//   地面欄:poise 靜止定性(0躁動↔1狙擊凍結)· idleF/idleA 微動節拍/幅 · launch 爆發起步 ·
//           spool 前傾遲滯(柴油機起轉)· brake 插地壓頭煞停 · settle 回穩阻尼倍率。
//   飛行欄:hover 懸停站位抖動 · hoverF/hoverA 浮沉節拍/幅(機械型≈0、活翼大)· surge 暴衝俐落 ·
//           flare 揚翼張爪煞停(定翼/噴射恆 0)· bank 入彎壓坡積極度。
// 數值出自運動生物力學/飛行動力學設計規格(大力士 t01·擊劍 t02·盾牆 t10·哨兵 t12;獵犬 t04·
//   載騎射 t07·頭足 t08·重役獸 t09;蜂鳥 s01·鷹隼 s09·夜梟 m08·翼龍 s06…)。
const MOVE_SIG = {
  // 蜂群無人機(飛行)
  s01: { hover: 0.60, hoverF: 2.4, hoverA: 0.45, surge: 0.40, flare: 0.55, bank: 0.35 },  // 蜜蜂/蜂鳥活翼懸停·指揮節點
  s02: { hover: 0.35, hoverF: 0.6, hoverA: 0.12, surge: 0.25, flare: 0.40, bank: 0.30 },  // 重載六旋翼:笨重穩定
  s03: { hover: 0.50, hoverF: 1.6, hoverA: 0.05, surge: 0.80, flare: 0,    bank: 0.92 },  // 鴨翼噴射遊蕩彈:高攻角急轉(定翼 flare=0)
  s04: { hover: 0.55, hoverF: 1.4, hoverA: 0.12, surge: 0.76, flare: 0,    bank: 0.90 },  // A6M 零式:纏鬥高滾轉(定翼 flare=0)
  s05: { hover: 0.90, hoverF: 3.0, hoverA: 0.12, surge: 1.00, flare: 0.50, bank: 1.00 },  // FPV 競速:極限俐落(機械 hoverA≈0)
  s06: { hover: 0.12, hoverF: 0.7, hoverA: 0.35, surge: 0.40, flare: 0.82, bank: 0.50 },  // 翼龍膜翼滑翔·攔截感測(死穩滯空)
  s07: { hover: 0.35, hoverF: 0.6, hoverA: 1.10, surge: 0.35, flare: 0.70, bank: 0.45 },  // 機械龍翱翔:重尾大膜翼慢拍
  s08: { hover: 0.05, hoverF: 0.5, hoverA: 0.06, surge: 0.10, flare: 0.25, bank: 0.10 },  // 共軸運補:近凍結溫柔懸停
  s09: { hover: 0.55, hoverF: 1.6, hoverA: 0.60, surge: 0.92, flare: 0.90, bank: 0.85 },  // 鷹隼:迎風懸停+石擊+拉起 flare
  s10: { hover: 0.30, hoverF: 1.0, hoverA: 0.12, surge: 0.35, flare: 0,    bank: 0.55 },  // 雙尾桁偵察:穩定盤旋(定翼 flare=0)
  s11: { hover: 0.08, hoverF: 0.6, hoverA: 0.05, surge: 0.15, flare: 0,    bank: 0.25 },  // ScanEagle 長航時:極省滑翔(定翼 flare=0)
  s12: { hover: 0.20, hoverF: 1.1, hoverA: 0.10, surge: 0.90, flare: 0,    bank: 0.32 },  // 三角翼渦噴:高速直衝(定翼 flare=0)
  // 鋼鐵機甲(地面)
  t01: { poise: 0.86, idleF: 0.42, idleA: 1.90, launch: 0.10, spool: 0.95, brake: 0.10, settle: 2.20 },  // 過裝甲巨人:大力士錨定、柴油慢起轉
  t02: { poise: 0.08, idleF: 2.45, idleA: 0.95, launch: 0.93, spool: 0.05, brake: 0.95, settle: 0.38 },  // 神經同步機:擊劍球步、爆發弓步、瞬回位
  t03: { poise: 0.25, idleF: 0.78, idleA: 1.50, launch: 0.60, spool: 0.52, brake: 0.52, settle: 0.60 },  // 大猩猩:低伏鬥牛式體重前撲
  t04: { poise: 0.68, idleF: 1.65, idleA: 0.58, launch: 0.92, spool: 0.10, brake: 0.98, settle: 0.45 },  // 獵犬:蟄伏爆發、插地急停快於起步
  t05: { poise: 0.50, idleF: 1.42, idleA: 0.60, launch: 0.16, spool: 0.18, brake: 0.22, settle: 1.55 },  // 鴕鳥:即時起步、肌腱吸震水平滑止
  t06: { poise: 0.18, idleF: 1.62, idleA: 0.90, launch: 0.96, spool: 0.14, brake: 0.62, settle: 0.42 },  // 袋鼠:跟腱儲能彈射、跑酷釘樁落停
  t07: { poise: 0.97, idleF: 0.58, idleA: 0.35, launch: 0.48, spool: 0.55, brake: 0.55, settle: 0.70 },  // 半人馬:載騎射擊台、扣扳機絕對靜止
  t08: { poise: 0.08, idleF: 0.70, idleA: 1.72, launch: 0.05, spool: 0.14, brake: 0.05, settle: 1.65 },  // 頭足類:永遠蠕動、波幅黏滯衰減如流體
  t09: { poise: 0.48, idleF: 0.48, idleA: 1.85, launch: 0.10, spool: 0.88, brake: 0.10, settle: 2.10 },  // 劍龍:深沉體側搖擺、巨慣性長滑
  t10: { poise: 0.58, idleF: 0.82, idleA: 1.05, launch: 0.20, spool: 0.58, brake: 0.52, settle: 1.05 },  // 持盾兵:方陣架步推進、落盾定樁
  t11: { poise: 0.70, idleF: 0.48, idleA: 1.62, launch: 0.14, spool: 0.85, brake: 0.20, settle: 1.90 },  // 暴龍:老獵手潛步、質量長滑抬尾配平
  t12: { poise: 0.20, idleF: 0.70, idleA: 0.85, launch: 0.15, spool: 0.40, brake: 0.30, settle: 1.40 },  // 巨兵哨兵:好奇緩擺頭巡視、謹慎試探
  // 傭兵變形機甲(地面 + 飛行)
  m01: { poise: 0.85, idleF: 0.90, idleA: 0.40, launch: 0.90, spool: 0.10, brake: 0.70, settle: 0.40, hover: 0.55, hoverF: 1.8, hoverA: 0.12, surge: 0.85, flare: 0.45, bank: 0.70 },  // 吸血鬼決鬥站姿 ⟷ 敏捷三旋翼
  m02: { poise: 0.62, idleF: 0.48, idleA: 1.60, launch: 0.05, spool: 0.90, brake: 0.10, settle: 2.25, hover: 0.15, hoverF: 0.5, hoverA: 0.25, surge: 0.05, flare: 0.05, bank: 0.05 },  // 機械巨象護衛 ⟷ 浮空飛船
  m03: { poise: 0.38, idleF: 1.92, idleA: 1.05, launch: 0.94, spool: 0.08, brake: 0.60, settle: 0.42, hover: 0.30, hoverF: 0.7, hoverA: 0.15, surge: 0.70, flare: 0.85, bank: 0.62 },  // 悟空掌行跑酷 ⟷ 光翼雲行
  m04: { poise: 0.80, idleF: 1.30, idleA: 0.50, launch: 0.84, spool: 0.16, brake: 0.40, settle: 0.90, hover: 0.22, hoverF: 0.75, hoverA: 0.65, surge: 0.38, flare: 0.75, bank: 0.52 },  // 迅猛龍蹲伏匿蹤 ⟷ 始祖鳥撲翼滑翔
  m05: { poise: 0.82, idleF: 0.85, idleA: 0.42, launch: 0.86, spool: 0.22, brake: 0.32, settle: 1.20, hover: 0.24, hoverF: 0.9, hoverA: 0.05, surge: 0.95, flare: 0,    bank: 0.72 },  // 狼人趾行潛步 ⟷ 噴射戰機(flare=0)
  m06: { poise: 0.42, idleF: 0.68, idleA: 1.40, launch: 0.08, spool: 0.80, brake: 0.18, settle: 1.70, hover: 0.30, hoverF: 0.7, hoverA: 0.10, surge: 0.55, flare: 0.20, bank: 0.60 },  // 負重工前傾寬站 ⟷ 傾轉旋翼母艦
  m07: { poise: 0.80, idleF: 1.10, idleA: 0.65, launch: 0.16, spool: 0.40, brake: 0.52, settle: 0.60, hover: 0.42, hoverF: 0.7, hoverA: 1.35, surge: 0.15, flare: 0.60, bank: 0.20 },  // 犀金龜 tripod 陣地 ⟷ 鞘翅笨拙嗡飛
  m08: { poise: 0.95, idleF: 0.60, idleA: 0.30, launch: 0.95, spool: 0.05, brake: 0.50, settle: 0.35, hover: 0.10, hoverF: 0.5, hoverA: 0.90, surge: 0.25, flare: 0.92, bank: 0.42 },  // 夜豹凍結-爆發 ⟷ 夜梟消音撲翼
};

// ── 施法動作性格 CAST_SIG(2026-07-16;locomotion.js stepCastPose 消費)────────────────
// 每角色一組 {omni 全向, dir 定向}:全向 = 自身/團隊/範圍招式(吼叫 roar/跺腳·人立 stomp/
// 跳舞 dance/旋轉·桶滾 spin/甩尾 tailwhip/捶胸 beat/展翼 flare);定向 = 指向敵人的
// strike/dash/遠端 emp(揮舞武器 swing/刺拳·撲咬 jab/踢腿 kick/俯衝突刺 lunge)。
// 依機體生物/機種原型指定;未登記者 stepCastPose 依 rig.kind 給預設。純視覺,不涉 sim。
const CAST_SIG = {
  // 蜂群無人機:擬態獸展翼、旋翼/定翼勝利桶滾;定向一律俯衝突刺
  s01: { omni: 'flare', dir: 'lunge' },   // 蜂后:震翅威嚇
  s02: { omni: 'spin', dir: 'lunge' },
  s03: { omni: 'spin', dir: 'lunge' },
  s04: { omni: 'spin', dir: 'lunge' },    // 零式:橫滾特技
  s05: { omni: 'spin', dir: 'lunge' },    // 競速 FPV:花式滾轉
  s06: { omni: 'flare', dir: 'lunge' },   // 翼龍:張膜翼
  s07: { omni: 'flare', dir: 'lunge' },   // 機械龍:展翼咆哮
  s08: { omni: 'spin', dir: 'lunge' },
  s09: { omni: 'flare', dir: 'lunge' },   // 獵鷹:揚翼宣告
  s10: { omni: 'spin', dir: 'lunge' },
  s11: { omni: 'spin', dir: 'lunge' },
  s12: { omni: 'spin', dir: 'lunge' },
  // 鋼鐵機甲:依原型 —— 斧砲揮劈/刺槍突刺/獸吼/踢擊/甩尾/捶胸/盾擊
  t01: { omni: 'stomp', dir: 'swing' },   // 巴斯通:重踏 + 揮斧
  t02: { omni: 'spin', dir: 'jab' },      // 熾天使:迴身 + 刺槍
  t03: { omni: 'beat', dir: 'swing' },    // 猩猩:捶胸 + 巨臂橫掃
  t04: { omni: 'roar', dir: 'jab' },      // 獵犬:嚎叫 + 前撲咬
  t05: { omni: 'dance', dir: 'kick' },    // 鴕鳥:求偶舞 + 飛踢
  t06: { omni: 'stomp', dir: 'kick' },    // 袋鼠:跺腳警報 + 正蹬
  t07: { omni: 'stomp', dir: 'jab' },     // 人馬:人立刨蹄 + 前蹄踏擊
  t08: { omni: 'dance', dir: 'swing' },   // 克蘇魯:觸手共舞 + 觸手鞭
  t09: { omni: 'tailwhip', dir: 'tailwhip' },   // 劍龍:一切交給尾錘
  t10: { omni: 'stomp', dir: 'jab' },     // 神盾:落盾定樁 + 盾擊
  t11: { omni: 'roar', dir: 'jab' },      // 暴龍:咆哮 + 俯衝咬殺
  t12: { omni: 'dance', dir: 'jab' },     // 巨兵:園丁機器人搖擺 + 圓臂直拳
  // 傭兵變形機甲(地面型演出;飛行型自動收斂成軀幹級動作)
  m01: { omni: 'spin', dir: 'swing' },    // 吸血鬼:披風迴旋 + 爪擊
  m02: { omni: 'roar', dir: 'swing' },    // 巨象:昂鼻長鳴 + 象鼻橫掃
  m03: { omni: 'dance', dir: 'swing' },   // 悟空:猴舞 + 如意棒掄劈
  m04: { omni: 'roar', dir: 'kick' },     // 迅猛龍:嘶鳴 + 鐮爪踢
  m05: { omni: 'roar', dir: 'swing' },    // 狼人:仰天長嚎 + 爪擊
  m06: { omni: 'stomp', dir: 'jab' },     // 亞特拉斯:重踏 + 直拳
  m07: { omni: 'stomp', dir: 'swing' },   // 犀金龜:六足定樁 + 犀角上挑
  m08: { omni: 'tailwhip', dir: 'jab' },  // 夜豹:豹尾抽甩 + 撲擊
};

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
    const built = build(side, vis, ch);
    // 角色性格花紋(paint.js):MUST 在 fitToHeight/outlinify 之前 —— 靜止姿勢矩陣才是
    // 花紋的錨(縮放後仍成立:矩陣取的是「相對 built 根」的局部變換);描邊外殼不吃塗裝。
    if (vis) paintUnit(built, vis, side, beast || kind === 'hero:drone' || kind === 'hero:morph' ? 'dark' : 'light');
    fitToHeight(built, target);
    outlinify(built, outlineW(target));
    g.add(built);
    if (built.userData.spin) g.userData.spin = built.userData.spin;
    // 車載砲塔(坦克):提上外層 group,game.js _aimVehicleTurret 才找得到
    if (built.userData.turret) g.userData.turret = built.userData.turret;
    // 多槍口輪替(直升機雙莢)/ 共軛俯仰槍架(直升機對地壓槍):同樣提上外層
    // (game.js _npcMuzzle / _aimGunTilt 只讀外層 userData)
    if (built.userData.turretMuzzles) g.userData.turretMuzzles = built.userData.turretMuzzles;
    if (built.userData.gunTilt) g.userData.gunTilt = built.userData.gunTilt;
    // 程序骨架(locomotion.js):記錄 fitToHeight 縮放供步幅/輪半徑換算世界尺度
    if (built.userData.rig) {
      built.userData.rig.s = built.scale.x;
      g.userData.rig = built.userData.rig;
      // 第三人稱槍口焰:掛在 rig 槍口錨/槍口燈上(stepCombatFx 中央驅動)——
      // 焰球徑向對稱不挑軸向;transparent + noOutline/noPaint,不吃塗裝不描邊
      if (built.userData.rig.muzzles) attachMuzzleFlames(built.userData.rig);
    }
  }

  // 後座幅度接 RECOIL 三級分級(唯一真相 data.js recoilTier;stepCombatFx 以 kickAmp 倍率消費):
  // 以 med 檔(light 1.2 / heavy 3.2)為 1 倍基準 —— 低後座武器輕踢、反器材/超電磁重踹
  if (g.userData.rig && ch && CHARACTERS[ch]) {
    const cw = CHARACTERS[ch];
    g.userData.rig.kickAmp = {
      light: recoilTier(cw.light, 'light').kick / 1.2,
      heavy: recoilTier(cw.heavy, 'heavy').kick / 3.2,
    };
  }

  // 運動性格(moveSig):四相位(靜止/加速/(奔跑或飛行)/減速)依真實運動員/軍種/生物飛行原型差異化;
  // 純客戶端視覺,locomotion.js 各步態 handler 讀取。keyed by 角色 id ⇒ 未登記者(NPC)行為完全不變。
  if (ch && g.userData.rig && MOVE_SIG[ch]) g.userData.rig.moveSig = MOVE_SIG[ch];
  // 施法動作性格(castSig):全向/定向施法動作原型(locomotion.js stepCastPose 消費)
  if (ch && g.userData.rig && CAST_SIG[ch]) g.userData.rig.castSig = CAST_SIG[ch];

  // 變形機甲:肩上的餌機掛點(狙擊長按右鍵分離發射;顯隱/組合動畫見 game.js _updateDecoyPod)。
  // 2026-07-18:非變形機甲(hero:robot)移除餌機(改重砲模式),不再掛餌機模組。
  if (kind === 'hero:morph') {
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
    // 砲口節點(shot 事件曳光起點/開火閃;鋼鐵雙管/蜂群六管輪替)
    g.userData.turretMuzzles = turret.userData.muzzles || null;
  }

  if (ring) g.add(teamRing(side, Math.max(1.1, target * 0.55)));
  g.userData.kind = kind;
  g.userData.side = side;
  return { group: g, mixer };
}
