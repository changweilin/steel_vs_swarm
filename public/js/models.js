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
import { toonify, outlinify } from './toon.js';
import { heroPalette, paintUnit } from './paint.js';
// 程序生成幾何積木(全專案唯一縫;本檔與 mecha/geo.js、機體台舊版對照同吃一份)
import { mat, outlineW, dim, bx, cyl, rbz } from './geo3d.js';
// 英雄機體建構器(2026-08-14 新版建模全面替換舊版):逐機零件檔住 forge/mechs/,
// 鷹架住 forge/forge.js —— 遊戲本體與機體台從此吃**同一棵**零件樹。
import { forgeMech, forgeMorphUnit, specOf } from './forge/forge.js';
import { entryKey } from './forge/roster.js';

// 單位 → GLB 檔(Quaternius,CC0 1.0;None = 直接用程式生成)
// ⚠ **英雄機體不在這張表裡**(2026-08-14 新版建模全面替換舊版):hero:robot / hero:drone /
// hero:morph 一律由 `public/js/forge/` 的逐機零件檔鍛造,既不查 GLB 也不吃
// `MODEL_MANIFEST_EXTRA` —— 那張表能蓋掉英雄外觀的話,「新版全面替換」就成了「預設值」。
export const MODEL_MANIFEST = Object.assign({
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
  // MUST 連**祖先**一起更新:量的對象可能是子樹(變形者只量地面型那一棵),
  // 而 `updateMatrixWorld` 假設父層 matrixWorld 已是最新 —— 剛改過父層 scale 的那一次
  // 會拿到上一幀的父矩陣,量出來的盒子少了那個縮放(貼地偏移因此差一截)。
  obj.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  obj.traverse((o) => {
    // 反轉外殼描邊(toon.outlinify)沿法線外推,量進來會讓整台機體矮 2×描邊寬 ——
    // 舊制描邊排在 fitToHeight **之後**所以碰不到;新版建模的鷹架自己收尾就描完了。
    if (o.userData.isOutline) return;
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

/** 等比縮放讓包圍盒高度 = target、底部貼地(y=0),置中 x/z。
 *  `ref` = 量哪一棵(預設就是 obj 自己)—— 變形者兩棵樹並存,MUST 只量**地面型**那一棵:
 *  飛行型是張開的翼面/機身,連它一起量會讓地面型站姿整台縮水,而兩張截圖分開看都正常。
 *  (兩態同尺度是建構期的保證:mechs/*_flight.js 的 height 直接引用地面檔那一個數字。) */
export function fitToHeight(obj, target, ref = obj) {
  const box = measureBox(ref);
  const size = box.getSize(new THREE.Vector3());
  const s = target / (size.y || 1);
  obj.scale.setScalar(s);
  const box2 = measureBox(ref);
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

// ---------- 程序生成幾何積木:唯一縫住 `geo3d.js`(本檔頂部 import)----------
// 2026-08-14:mat / outlineW / dim / bx / cyl / rbz / feather / jetFlame / segLimb 原本
// 是本檔的內部函式,而機體鍛造台為了跑得起來抄了一份鏡射(geo.js 的 matF/bxF/…)。
// 新版建模進遊戲之後那份副本就是服役中的第二份實作 ⇒ 整組移進 `geo3d.js`,兩邊同吃一份。
// 本檔只剩 NPC/載具/建築在用那幾支;羽片 / 尾焰 / 分節肢的呼叫端隨舊版英雄建模退役。

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

/**
 * 機甲角色掛件(共用骨架上的專屬差異化):
 * vis.pod = 'antenna'|'cannon'|'dish'|'shield'|'rack'|'blade'|'twin'|'none';
 * 預設加胸前主色識別燈條。座標以 fitToHeight 後的機體(高 target、腳底 y=0)為準;
 * anchor 可覆寫肩點/燈條位置(程序生成人型機甲自帶胸燈,傳 trim:false)。
 */
/**
 * 集束轟炸機(內部識別字仍是 decoy):變形者外掛的可分離子機(投彈機 / 偵察機 / 誘餌)。
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

/**
 * 極音速飛彈(2026-08-01;機甲長按招式的彈體)。
 * 與集束轟炸機同一具彈體幾何(**刻意共用** buildDecoy —— 兩者都是「彈體 + 錐形彈頭 + 四片尾翼」,
 * 各寫一份就是第二份實作),差異只有尾端多一段熾亮推進焰。
 * **尺寸不在這裡放大**:makeUnit 一律 fitToHeight 到 `TARGET_H.hyper`(= decoy × HYPER.MODEL_F),
 * 而命中量體 `TARGET_R.hyper` 吃同一個 MODEL_F ⇒ 看到多大就是打到多大(§「兩端同量體」)。
 * 推進焰的 y 向半徑 MUST 小於彈體(含尾翼)的 y 向半高 —— fitToHeight 以**高度**定尺,
 * 焰口一撐高就會把整枚飛彈等比縮小(同 tank 天線的前科)。
 */
function buildHyperMissile(side, vis = null) {
  const g = new THREE.Group();
  g.add(buildDecoy(side, vis));
  const accent = new THREE.Color(vis?.hue ?? SIDES[side]?.color ?? 0xffffff);
  // 推進焰:錐形(圓柱預設軸 +y ⇒ 轉 −90° 躺成 −z 尾向),自發光不描邊
  const flame = cyl(g, 0.04, 0.22, 1.4, 8, 0, 0, -1.55, accent,
    { emissive: accent, emissiveIntensity: 2.2 });
  flame.rotation.x = -Math.PI / 2;
  flame.userData.noOutline = true;
  // 螺旋航跡由伺服器逐 tick 給位置/朝向 ⇒ 這裡**不掛** userData.spin(自轉會與回報的 ry 打架)
  return g;
}

/** 變形者肩上的集束轟炸機掛點(組合/分離動畫的錨點;game.js 以 userData.decoyPod 控制顯隱與縮放) */
function decoyPod(side, vis, target) {
  const pod = buildDecoy(side, vis);
  pod.scale.setScalar(target * 0.42 / pod.userData.decoyLen);
  pod.position.set(-target * 0.3, target * 0.72, -target * 0.06);
  return pod;
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

// 2026-08-14:**英雄不在這張表裡**。新版建模全面替換舊版之後,hero:drone / hero:robot /
// hero:morph 一律走 `forgeHero()`(public/js/forge/),舊的七支建構器整組退役到
// `tools/humanoid_forge/legacy/`,只在機體台當對照組 —— 這張表留著 hero 那三列的話,
// forge 查無規格時會**靜默退回舊建模**,而畫面上只表現成「這台機體長得跟別人不一樣」。
const FALLBACK = {
  decoy: (side, vis) => buildDecoy(side, vis),
  hyper: (side, vis) => buildHyperMissile(side, vis),
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
//   載騎射 s06·頭足 s07·重役獸 m06;蜂鳥 s01·鷹隼 m04·夜梟 m08·翼龍 t07…)。
// 2026-08-02 機體混編:本表**綁機體不綁角色** —— 機體換陣營時,整組性格值連同註解一起跟著搬。
const MOVE_SIG = {
  // 蜂群:無人機 7(飛行欄)/ 機甲 3(地面欄)/ 變形機甲 2(兩欄)
  s01: { hover: 0.60, hoverF: 2.4, hoverA: 0.45, surge: 0.40, flare: 0.55, bank: 0.35 },  // 蜜蜂/蜂鳥活翼懸停·指揮節點
  s02: { hover: 0.35, hoverF: 0.6, hoverA: 0.12, surge: 0.25, flare: 0.40, bank: 0.30 },  // 重載六旋翼:笨重穩定
  s03: { poise: 0.80, idleF: 1.30, idleA: 0.50, launch: 0.84, spool: 0.16, brake: 0.40, settle: 0.90, hover: 0.22, hoverF: 0.75, hoverA: 0.65, surge: 0.38, flare: 0.75, bank: 0.52 },  // 迅猛龍蹲伏匿蹤 ⟷ 始祖鳥撲翼滑翔
  s04: { hover: 0.55, hoverF: 1.4, hoverA: 0.12, surge: 0.76, flare: 0,    bank: 0.90 },  // A6M 零式:纏鬥高滾轉(定翼 flare=0)
  s05: { hover: 0.90, hoverF: 3.0, hoverA: 0.12, surge: 1.00, flare: 0.50, bank: 1.00 },  // FPV 競速:極限俐落(機械 hoverA≈0)
  s06: { poise: 0.97, idleF: 0.58, idleA: 0.35, launch: 0.48, spool: 0.55, brake: 0.55, settle: 0.70 },  // 半人馬:載騎射擊台、扣扳機絕對靜止
  s07: { poise: 0.08, idleF: 0.70, idleA: 1.72, launch: 0.05, spool: 0.14, brake: 0.05, settle: 1.65 },  // 頭足類:永遠蠕動、波幅黏滯衰減如流體
  s08: { hover: 0.05, hoverF: 0.5, hoverA: 0.06, surge: 0.10, flare: 0.25, bank: 0.10 },  // 共軸運補:近凍結溫柔懸停
  s09: { poise: 0.18, idleF: 1.62, idleA: 0.90, launch: 0.96, spool: 0.14, brake: 0.62, settle: 0.42 },  // 袋鼠:跟腱儲能彈射、跑酷釘樁落停
  s10: { poise: 0.62, idleF: 0.48, idleA: 1.60, launch: 0.05, spool: 0.90, brake: 0.10, settle: 2.25, hover: 0.15, hoverF: 0.5, hoverA: 0.25, surge: 0.05, flare: 0.05, bank: 0.05 },  // 機械巨象護衛 ⟷ 浮空飛鯨
  s11: { hover: 0.08, hoverF: 0.6, hoverA: 0.05, surge: 0.15, flare: 0,    bank: 0.25 },  // ScanEagle 長航時:極省滑翔(定翼 flare=0)
  s12: { hover: 0.50, hoverF: 1.6, hoverA: 0.05, surge: 0.80, flare: 0,    bank: 0.92 },  // 鴨翼長航偵察機:高攻角急轉仍守得住星象視軸(定翼 flare=0)
  // 鋼鐵:機甲 7(地面欄)/ 無人機 3(飛行欄)/ 變形機甲 2(兩欄)
  t01: { poise: 0.86, idleF: 0.42, idleA: 1.90, launch: 0.10, spool: 0.95, brake: 0.10, settle: 2.20 },  // 過裝甲巨人:大力士錨定、柴油慢起轉
  t02: { poise: 0.08, idleF: 2.45, idleA: 0.95, launch: 0.93, spool: 0.05, brake: 0.95, settle: 0.38 },  // 神經同步機:擊劍球步、爆發弓步、瞬回位
  t03: { poise: 0.25, idleF: 0.78, idleA: 1.50, launch: 0.60, spool: 0.52, brake: 0.52, settle: 0.60 },  // 大猩猩:低伏鬥牛式體重前撲
  t04: { poise: 0.68, idleF: 1.65, idleA: 0.58, launch: 0.92, spool: 0.10, brake: 0.98, settle: 0.45 },  // 獵犬:蟄伏爆發、插地急停快於起步
  t05: { poise: 0.50, idleF: 1.42, idleA: 0.60, launch: 0.16, spool: 0.18, brake: 0.22, settle: 1.55 },  // 鴕鳥:即時起步、肌腱吸震水平滑止
  t06: { poise: 0.38, idleF: 1.92, idleA: 1.05, launch: 0.94, spool: 0.08, brake: 0.60, settle: 0.42, hover: 0.30, hoverF: 0.7, hoverA: 0.15, surge: 0.70, flare: 0.85, bank: 0.62 },  // 悟空掌行跑酷 ⟷ 光翼雲行
  t07: { hover: 0.12, hoverF: 0.7, hoverA: 0.35, surge: 0.40, flare: 0.82, bank: 0.50 },  // 翼龍膜翼滑翔·狙擊感測(死穩滯空)
  t08: { hover: 0.35, hoverF: 0.6, hoverA: 1.10, surge: 0.35, flare: 0.70, bank: 0.45 },  // 機械龍翱翔:重尾大膜翼慢拍
  t09: { hover: 0.20, hoverF: 1.1, hoverA: 0.10, surge: 0.90, flare: 0,    bank: 0.32 },  // 三角翼渦噴:高速直衝(定翼 flare=0)
  t10: { poise: 0.58, idleF: 0.82, idleA: 1.05, launch: 0.20, spool: 0.58, brake: 0.52, settle: 1.05 },  // 持盾兵:方陣架步推進、落盾定樁
  t11: { poise: 0.42, idleF: 0.68, idleA: 1.40, launch: 0.08, spool: 0.80, brake: 0.18, settle: 1.70, hover: 0.30, hoverF: 0.7, hoverA: 0.10, surge: 0.55, flare: 0.20, bank: 0.60 },  // 負重工前傾寬站 ⟷ 傾轉旋翼母艦
  t12: { poise: 0.20, idleF: 0.70, idleA: 0.85, launch: 0.15, spool: 0.40, brake: 0.30, settle: 1.40 },  // 巨兵哨兵:好奇緩擺頭巡視、謹慎試探
  // 傭兵:變形機甲 4(兩欄)/ 無人機 2(飛行欄)/ 機甲 2(地面欄)
  m01: { poise: 0.85, idleF: 0.90, idleA: 0.40, launch: 0.90, spool: 0.10, brake: 0.70, settle: 0.40, hover: 0.55, hoverF: 1.8, hoverA: 0.12, surge: 0.85, flare: 0.45, bank: 0.70 },  // 吸血鬼決鬥站姿 ⟷ 敏捷三旋翼
  m02: { poise: 0.70, idleF: 0.48, idleA: 1.62, launch: 0.14, spool: 0.85, brake: 0.20, settle: 1.90 },  // 暴龍:老獵手潛步、質量長滑抬尾配平
  m03: { hover: 0.30, hoverF: 1.0, hoverA: 0.12, surge: 0.35, flare: 0,    bank: 0.55 },  // 雙尾桁運補:穩定盤旋(定翼 flare=0)
  m04: { hover: 0.55, hoverF: 1.6, hoverA: 0.60, surge: 0.92, flare: 0.90, bank: 0.85 },  // 鷹隼:迎風懸停+石擊+拉起 flare
  m05: { poise: 0.82, idleF: 0.85, idleA: 0.42, launch: 0.86, spool: 0.22, brake: 0.32, settle: 1.20, hover: 0.24, hoverF: 0.9, hoverA: 0.05, surge: 0.95, flare: 0,    bank: 0.72 },  // 狼人趾行潛步 ⟷ 噴射戰機(flare=0)
  m06: { poise: 0.48, idleF: 0.48, idleA: 1.85, launch: 0.10, spool: 0.88, brake: 0.10, settle: 2.10 },  // 劍龍:深沉體側搖擺、巨慣性長滑
  m07: { poise: 0.80, idleF: 1.10, idleA: 0.65, launch: 0.16, spool: 0.40, brake: 0.52, settle: 0.60, hover: 0.42, hoverF: 0.7, hoverA: 1.35, surge: 0.15, flare: 0.60, bank: 0.20 },  // 犀金龜 tripod 陣地 ⟷ 鞘翅笨拙嗡飛
  m08: { poise: 0.95, idleF: 0.60, idleA: 0.30, launch: 0.95, spool: 0.05, brake: 0.50, settle: 0.35, hover: 0.10, hoverF: 0.5, hoverA: 0.90, surge: 0.25, flare: 0.92, bank: 0.42 },  // 夜豹凍結-爆發 ⟷ 夜梟消音撲翼
};

// ── 施法動作性格 CAST_SIG(2026-07-16;locomotion.js stepCastPose 消費)────────────────
// 每角色一組 {omni 全向, dir 定向}:全向 = 自身/團隊/範圍招式(吼叫 roar/跺腳·人立 stomp/
// 跳舞 dance/旋轉·桶滾 spin/甩尾 tailwhip/捶胸 beat/展翼 flare);定向 = 指向敵人的
// strike/dash/遠端 emp(揮舞武器 swing/刺拳·撲咬 jab/踢腿 kick/俯衝突刺 lunge)。
// 依機體生物/機種原型指定;未登記者 stepCastPose 依 rig.kind 給預設。純視覺,不涉 sim。
const CAST_SIG = {
  // 蜂群(擬態獸展翼 / 旋翼定翼勝利桶滾 / 獸型機甲的踏擊與觸手)
  s01: { omni: 'flare', dir: 'lunge' },  // 蜂后:震翅威嚇
  s02: { omni: 'spin', dir: 'lunge' },  // 重載六旋翼:勝利桶滾
  s03: { omni: 'roar', dir: 'kick' },  // 迅猛龍:嘶鳴 + 鐮爪踢
  s04: { omni: 'spin', dir: 'lunge' },  // 零式:橫滾特技
  s05: { omni: 'spin', dir: 'lunge' },  // 競速 FPV:花式滾轉
  s06: { omni: 'stomp', dir: 'jab' },  // 人馬:人立刨蹄 + 前蹄踏擊
  s07: { omni: 'dance', dir: 'swing' },  // 克蘇魯:觸手共舞 + 觸手鞭
  s08: { omni: 'spin', dir: 'lunge' },  // 共軸運補:桶滾
  s09: { omni: 'stomp', dir: 'kick' },  // 袋鼠:跺腳警報 + 正蹬
  s10: { omni: 'roar', dir: 'swing' },  // 巨象:昂鼻長鳴 + 象鼻橫掃
  s11: { omni: 'spin', dir: 'lunge' },  // 長航時定翼:桶滾
  s12: { omni: 'spin', dir: 'lunge' },  // 鴨翼長航偵察機:桶滾
  // 鋼鐵(人形原型的斧砲刺槍盾擊 / 獸型的吼撲 / 擬態翼無人機展翼)
  t01: { omni: 'stomp', dir: 'swing' },  // 巴斯通:重踏 + 揮斧
  t02: { omni: 'spin', dir: 'jab' },  // 熾天使:迴身 + 刺槍
  t03: { omni: 'beat', dir: 'swing' },  // 猩猩:捶胸 + 巨臂橫掃
  t04: { omni: 'roar', dir: 'jab' },  // 獵犬:嚎叫 + 前撲咬
  t05: { omni: 'dance', dir: 'kick' },  // 鴕鳥:求偶舞 + 飛踢
  t06: { omni: 'dance', dir: 'swing' },  // 悟空:猴舞 + 如意棒掄劈
  t07: { omni: 'flare', dir: 'lunge' },  // 翼龍:張膜翼
  t08: { omni: 'flare', dir: 'lunge' },  // 機械龍:展翼咆哮
  t09: { omni: 'spin', dir: 'lunge' },  // 三角翼:高速桶滾
  t10: { omni: 'stomp', dir: 'jab' },  // 神盾:落盾定樁 + 盾擊
  t11: { omni: 'stomp', dir: 'jab' },  // 亞特拉斯:重踏 + 直拳
  t12: { omni: 'dance', dir: 'jab' },  // 巨兵:園丁機器人搖擺 + 圓臂直拳
  // 傭兵(變形者以地面型演出;無人機/機甲依機體原型)
  m01: { omni: 'spin', dir: 'swing' },  // 吸血鬼:披風迴旋 + 爪擊
  m02: { omni: 'roar', dir: 'jab' },  // 暴龍:咆哮 + 俯衝咬殺
  m03: { omni: 'spin', dir: 'lunge' },  // 雙尾桁運補:桶滾
  m04: { omni: 'flare', dir: 'lunge' },  // 獵鷹:揚翼宣告
  m05: { omni: 'roar', dir: 'swing' },  // 狼人:仰天長嚎 + 爪擊
  m06: { omni: 'tailwhip', dir: 'tailwhip' },  // 劍龍:一切交給尾錘
  m07: { omni: 'stomp', dir: 'swing' },  // 犀金龜:六足定樁 + 犀角上挑
  m08: { omni: 'tailwhip', dir: 'jab' },  // 夜豹:豹尾抽甩 + 撲擊
};

/**
 * 英雄機體 → 新版建模零件樹(2026-08-14 全面替換舊版)。
 *
 * 名冊鍵是 `forge/roster.js` 的 `entryKey()` —— 一般機體 = 角色 id、變形者 = `id@型態`。
 * **這裡 MUST NOT 出現第二套鍵字串規則**(拼錯的下場是那一格查無規格,而畫面上只表現成
 * 「這台機體變回通用備援模型」,沒有任何錯誤訊息)。
 *
 * 查無規格 ⇒ 回 null 交還給既有的備援鏈(原則 6:降級不例外)。
 * @returns { group, rig, rigAir?, fit } | null
 */
function forgeHero(heroKind, ch, side) {
  if (heroKind === 'morph') {
    const G = specOf(entryKey(ch, 'ground')), A = specOf(entryKey(ch, 'flight'));
    if (!G || !A) return null;
    return forgeMorphUnit(G, A);
  }
  const spec = specOf(entryKey(ch, null));
  if (!spec) return null;
  const u = forgeMech(spec);
  return { group: u.group, rig: u.rig, fit: u.group };
}

/**
 * 建立一個單位 mesh。回傳 { group, mixer? }。
 * kind: 'hero:drone' | 'hero:robot' | 'creep:soldier' | 'creep:apc' | 'creep:tank' | 'tower' | 'base:SWARM' | 'base:STEEL'
 * opts.ch:英雄角色 id — 依 CHARACTERS[ch].visual 生成專屬機體(主色/機架/掛件)。
 */
export function makeUnit(kind, side, { ring = true, ch = null } = {}) {
  const vis = ch && CHARACTERS[ch] ? CHARACTERS[ch].visual : null;
  // 英雄體型綁角色護甲(heroTargetH 內含獸型矮化);其餘查表
  const heroKind = kind.startsWith('hero:') ? kind.slice(5) : null;
  const target = heroKind ? heroTargetH(heroKind, ch) : (TARGET_H[kind] || 4);
  // 2026-08-14:**英雄機體一律走 forge**(新版建模全面替換舊版)—— GLB 覆蓋
  // (MODEL_MANIFEST_EXTRA)與舊程序建構器都不再參與 hero 分支;舊建模只留在機體台。
  const forged = heroKind && ch ? forgeHero(heroKind, ch, side) : null;
  const entry = !forged && MODEL_MANIFEST[kind] ? cache[kind] : null;
  const g = new THREE.Group();
  let mixer = null;

  if (forged) {
    const built = forged.group;
    // 塗裝與描邊由鷹架收尾自己做完了(finishRig:paintUnit → outlinify),這裡 MUST NOT 再來一次:
    //   ・重畫塗裝 = 徽記疊兩層;・重描 = 兩層反轉外殼(遠看線變兩倍粗)。
    // 描邊寬度仍然對:鷹架以建模基準高 H 算 outlineW(H),而 fitToHeight 等比縮 s = target/H
    //   ⇒ 世界寬度 = 0.016·H·(target/H) = 0.016·target,與 outlineW(target) 逐位元相同。
    fitToHeight(built, target, forged.fit || built);
    g.add(built);
    if (built.userData.spin) g.userData.spin = built.userData.spin;
    if (built.userData.morph) g.userData.morph = built.userData.morph;
    const rig = built.userData.rig;
    if (rig) {
      // 程序骨架:記錄 fitToHeight 縮放供步幅/輪半徑換算世界尺度(兩態各記各的)
      rig.s = built.scale.x;
      if (forged.rigAir) forged.rigAir.s = built.scale.x;
      g.userData.rig = rig;
      g.userData.rigAir = forged.rigAir || null;   // 變形者飛行型(FPV 座艙的飛行武裝取這一份)
      for (const r of [rig, forged.rigAir]) if (r?.muzzles) attachMuzzleFlames(r);
    }
  } else if (entry) {
    const model = SkeletonUtils.clone(entry.scene);
    toonify(model);   // GLB 也重新渲染成賽璐璐(保留貼圖/顏色)
    fitToHeight(model, target);
    outlinify(model, outlineW(target));   // 反轉外殼漫畫描邊(骨骼動畫共用骨架)
    // skinned mesh 的包圍球以綁定姿勢計算,經縮放+動畫後會被視錐剔除
    // 導致模型「消失」,一律關閉 frustum culling
    model.traverse((o) => { if (o.isSkinnedMesh || o.isMesh) o.frustumCulled = false; });
    g.add(model);
    // 步行 clip:交給 locomotion.js 以實際地速調 timeScale(靜止不原地滑步)
    const clip = kind === 'creep:soldier' ? pickWalkClip(entry.animations) : null;
    if (clip) {
      mixer = new THREE.AnimationMixer(model);
      const action = mixer.clipAction(clip);
      action.time = Math.random() * clip.duration;   // 錯開步伐
      action.play();
      g.userData.walk = action;
      // timeScale=1 的參考地速(m/s):步幅正比於身高,故 walkRef 必須隨 target 縮放,
      // 否則體型一改就原地滑步(係數 = 舊制 walkRef ÷ 舊制身高)
      g.userData.walkRef = target * (6 / 3.2);
    }
  } else {
    const build = FALLBACK[kind] || FALLBACK['creep:apc'];
    const built = build(side, vis, ch);
    // 角色性格花紋(paint.js):MUST 在 fitToHeight/outlinify 之前 —— 靜止姿勢矩陣才是
    // 花紋的錨(縮放後仍成立:矩陣取的是「相對 built 根」的局部變換);描邊外殼不吃塗裝。
    if (vis) paintUnit(built, vis, side, 'light');
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
  // 變形者有**兩棵樹兩份 rig**,三張表都要套到兩邊 —— 只套地面型的話,一起飛就換回
  // 逐機檔裡那組「建模台預覽用」的預設值,而畫面上只表現成「飛起來之後手感不太一樣」。
  const rigs = [g.userData.rig, g.userData.rigAir].filter(Boolean);
  if (rigs.length && ch && CHARACTERS[ch]) {
    const cw = CHARACTERS[ch];
    const kickAmp = {
      light: recoilTier(cw.light, 'light').kick / 1.2,
      heavy: recoilTier(cw.heavy, 'heavy').kick / 3.2,
    };
    for (const r of rigs) r.kickAmp = kickAmp;
  }

  // 運動性格(moveSig):四相位(靜止/加速/(奔跑或飛行)/減速)依真實運動員/軍種/生物飛行原型差異化;
  // 純客戶端視覺,locomotion.js 各步態 handler 讀取。keyed by 角色 id ⇒ 未登記者(NPC)行為完全不變。
  // 唯一真相是本檔這兩張表(逐機檔 mechs/*.js 那兩格只是機體台的預覽預設值)。
  for (const r of rigs) {
    if (ch && MOVE_SIG[ch]) r.moveSig = MOVE_SIG[ch];
    if (ch && CAST_SIG[ch]) r.castSig = CAST_SIG[ch];
  }

  // 變形者:肩上的餌機掛點(狙擊長按右鍵分離發射;顯隱/組合動畫見 game.js _updateDecoyPod)。
  // 2026-07-18:機甲(hero:robot)移除餌機(改重砲模式),不再掛餌機模組。
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
