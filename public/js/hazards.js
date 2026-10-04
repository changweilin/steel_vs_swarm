// ============ 危險區客戶端:障礙物 / 防空陣地 / 地雷 / 物資 3D 模型 ============
// 全部程序生成低多邊形 + 日漫賽璐璐(cel)toon 材質(2.5D 視覺)。
// 每個實例以「實體 id 當種子」做隨機差異化(mulberry32):
// 同一障礙全房間玩家看到同一個樣子,但沒有兩個障礙長得一樣。
// 地雷:顏色取自腳下衛星影像(融入環境),靠近才浮現的極輕微突起。
import * as THREE from 'three';

// ---- 決定性亂數:唯一縫已抽到 rng.js(該檔零 import ⇒ 離線稽核在 Node 端跑得同一條序列)----
// MUST 是「import + export」兩行:`export { x } from './y.js'` 是純轉出,**不建立本地繫結** ——
// 本檔 `buildHazard` 自己要用 mulberry32,寫成轉出就是靜默的 ReferenceError(語法合法、
// 載入模組不報錯,直到第一個障礙進快照才在 _spawnEnt 炸開;而 `_applySnap` 在 `_snapQueue`
// 清空**之前**拋出 ⇒ 同一份快照每幀重試每幀再炸 = 整條 rAF 幀迴圈永久停擺、機體完全不受操控)。
import { mulberry32 } from './rng.js';
export { mulberry32 };

// ---- 賽璐璐核心已抽到 toon.js(3 階 ramp / 描邊 / 硬邊高光),此處 re-export 保持相容 ----
import { toonGradient, toonMat, toonify, outlinify, envMat, bakeContactAO } from './toon.js';
export { toonGradient, toonMat, toonify, envMat, bakeContactAO };

// ---- 零件級細節抖動的規則(單一縫;植被的 vegPartXform 同吃這兩支)----
import { partId, partJitter } from './xform.js';

// ---- 載具 / 擺件型錄(唯一縫;該檔零 import、零 THREE ⇒ 離線稽核吃得到同一份)----
import { makeSceneVehicleParts as makeVehicle } from './vehicleCatalog.js';
import { runtimeMeshDataGeometry } from './runtimePartModel.js';
import { mergeGeos } from './beacons.js';
import { flameGeometry, smokeGeometry, brokenGroundGeometry } from './sceneDisasterGeometry.js';
import { HAZARDS } from './data.js';
import { addSceneGeometry, forestSceneGeometry, vesselSceneGeometry, furnitureSceneGeometry, scenePartGeometry, geologySceneGeometry } from './scenePropModels.js';

// ---- 幾何速記 ----
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r1, r2, h, n = 6) => new THREE.CylinderGeometry(r1, r2, h, n);
const cone = (r, h, n = 6) => new THREE.ConeGeometry(r, h, n);
const ico = (r) => new THREE.IcosahedronGeometry(r, 0);

function mesh(g, geo, color, x = 0, y = 0, z = 0, opts = {}) {
  // 障礙物一律走環境賽璐璐(低頻水彩 wash + 冷藍陰影;botw_plan Task 2.1/3.1)
  const m = new THREE.Mesh(geo, envMat(color, { wash: 0.45, cool: 0.5, ...opts }));
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

/**
 * 鑿刻岩幾何(botw_plan Task 1.1):細分 ico + 決定性頂點位移
 * (同座標頂點同位移 → 水密不裂),非索引 per-face 法線 = 硬邊鑿刻面,
 * 手工雕鑿輪廓而非圓滑有機球。回傳附帶平滑球面法線副本(outline)
 * 給 inverted-hull 描邊用 — 面法線外推外殼會沿硬邊裂開。
 */
function chiselRock(r, rnd) {
  const geo = new THREE.IcosahedronGeometry(r, 1);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${Math.round(v.x / r * 64)},${Math.round(v.y / r * 64)},${Math.round(v.z / r * 64)}`;
    let s = seen.get(key);
    if (s === undefined) { s = 0.74 + rnd() * 0.5; seen.set(key, s); }
    pos.setXYZ(i, v.x * s, v.y * s, v.z * s);
  }
  geo.computeVertexNormals();   // 非索引幾何 → 每面獨立法線(硬邊)
  const outline = geo.clone();
  const on = outline.attributes.normal, op = outline.attributes.position;
  for (let i = 0; i < op.count; i++) {
    v.fromBufferAttribute(op, i).normalize();
    on.setXYZ(i, v.x, v.y, v.z);
  }
  return { geo, outline };
}

/** 鑿刻岩 mesh 速記:掛描邊幾何 + 苔蘚投影選項 */
function rockMesh(g, size, rnd, color, x, y, z, moss) {
  const { geo, outline } = chiselRock(size, rnd);
  const m = mesh(g, geo, color, x, y, z, moss ? { moss } : {});
  m.userData.outlineGeo = outline;
  return m;
}

/** 色相/明度小抖動:同型障礙每個都不一樣 */
function jitterColor(hex, rnd, h = 0.03, l = 0.12) {
  const c = new THREE.Color(hex);
  c.offsetHSL((rnd() - 0.5) * h * 2, (rnd() - 0.5) * 0.08, (rnd() - 0.5) * l * 2);
  return c;
}

// ================= 障礙物建構器(r = 影響半徑,已含實例 sc)=================
const BUILDERS = {
  /** 施工圍籬:橘白拒馬 + 三角錐 + 鷹架桿 */
  construction(g, r, rnd) {
    const n = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, d = r * (.2 + rnd() * .4);
      const barrier = addSceneGeometry(g, furnitureSceneGeometry('barrier'), 'construction-barrier');
      barrier.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
      barrier.rotation.y = a + Math.PI / 2;
    }
    for (let i = 0; i < 4; i++) {
      const a = rnd() * Math.PI * 2, d = r * (.35 + rnd() * .3);
      const cone = addSceneGeometry(g, furnitureSceneGeometry('cone'), 'traffic-cone');
      cone.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    }
    const scaffold = addSceneGeometry(g, furnitureSceneGeometry('scaffold'), 'scaffold');
    scaffold.position.set(-r * .2, 0, r * .2);
  },

  /** 車禍殘骸:2~3 台撞毀車輛(翻覆/斜插),烤漆隨機 */
  wreck(g, r, rnd) {
    const n = 2 + (rnd() < 0.4 ? 1 : 0);
    const paints = [0xb8412f, 0x3f6fa8, 0xcac4b8, 0x4a5a48, 0xd8b04a];
    for (let i = 0; i < n; i++) {
      const car = new THREE.Group();
      const paint = jitterColor(paints[Math.floor(rnd() * paints.length)], rnd);
      // 台台不同(2026-07-29):車身尺寸逐台抽、車頂塌陷程度各異(底緣貼車身頂,塌多低多少)
      // 2026-08-16 序 10:形狀改吃 `vehicles.js` 的**唯一縫**,本支只決定「這一台多大、
      // 什麼漆、塌多少、擺在哪」—— 舊制那一份手寫車體(唯一有輪子的那一份)正是
      // SPEC `sedan` 的基準值來源(R 0.34、四輪觸地),故收斂後外觀同級而尺寸有型錄背書。
      // **rnd 消耗枚數逐枚不變**(這一支跑的是逐障礙的區域序列,改了就是同一顆種子長出
      // 另一批障礙 —— 而 `audit_object_joints` 的樁件正是照著這個枚數在對)。
      const bw = 1.7 + rnd() * 0.3, bh = 0.8 + rnd() * 0.15, bl = 3.5 + rnd() * 0.8;
      const crush = 0.55 + rnd() * 0.4;                                   // 1 = 完好車頂、0.55 = 塌剩一半
      const dive = (rnd() - 0.5) * 0.3;                                   // 車鼻插進地面的俯仰
      const roll = (rnd() - 0.5) * 0.16;                                  // 塌得一邊高一邊低
      for (const p of makeVehicle('sedan', { fit: { L: bl, W: bw, H: bh + 0.65 }, crush, paint })) {
        const [t, ga, gb, gc, sg] = p.g;
        const geo = t === 'mesh' ? runtimeMeshDataGeometry(ga) : t === 'box' ? box(ga, gb, gc)
          : t === 'cyl' ? cyl(ga, gb, gc, sg || 6)
            : t === 'cone' ? cone(ga, gb, sg || 6) : ico(ga);
        const [px = 0, py = 0, pz = 0] = p.p || [];
        const m = mesh(car, geo, p.c, px, py, pz);
        const [rx = 0, ry = 0, rz = 0] = p.r || [];
        if (rx || ry || rz) m.rotation.set(rx, ry, rz);
      }
      const a = rnd() * Math.PI * 2, d = i === 0 ? 0 : r * (0.4 + rnd() * 0.5);
      car.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
      // 損毀姿態:翻肚 / 俯仰 / 側傾。`dive`/`roll` 是舊制掛在車艙上的那兩枚亂數 ——
      // 車艙的塌陷改由 `makeVehicle` 的 `crush` 統一給,兩枚就改記在整台車的姿態上
      // (枚數不變 ⇒ 同一顆種子之後的每一件散落物落點逐位元不動)
      car.rotation.set(
        (rnd() < 0.3 ? Math.PI : (rnd() - 0.5) * 0.3) + dive,   // 三成翻肚
        rnd() * Math.PI * 2,
        (rnd() - 0.5) * 0.5 + roll,
      );
      if (car.rotation.x > 2) car.position.y = 1.3;
      g.add(car);
    }
    // 脫落的輪胎:掉在殘骸群旁平躺(軸朝上、胎厚一半著地)
    const nT = 1 + (rnd() < 0.5 ? 1 : 0);
    for (let i = 0; i < nT; i++) {
      const a = rnd() * Math.PI * 2, d = r * (0.3 + rnd() * 0.6);
      mesh(g, cyl(0.34, 0.34, 0.25, 8), 0x1c1f22, Math.cos(a) * d, 0.13, Math.sin(a) * d)
        .rotation.y = rnd() * Math.PI;
    }
    // 散落碎片
    for (let i = 0; i < 5; i++) {
      mesh(g, box(0.3 + rnd() * 0.4, 0.08, 0.3 + rnd() * 0.3), 0x51565b,
        (rnd() - 0.5) * r * 1.6, 0.05, (rnd() - 0.5) * r * 1.6).rotation.y = rnd() * 3;
    }
  },

  /** 路邊停放車:完好私家車(直立四輪接地,可被擊毀 → 燒成殘骸;形狀走 vehicles.js 唯一縫) */
  car(g, r, rnd) {
    const seed = Math.floor(rnd() * 1e9);
    const body = new THREE.Group();
    // makeVehicle 在稽核沙盒內是 vehicles.js 真品、在遊戲內是 vehicleParts 適配層,
    // 兩者同形({g,p,c,r})⇒ 此處寫法與 wreck 的逐台迴圈同一支,不可另起爐灶。
    for (const p of makeVehicle('sedan', { fit: { L: 4.4, W: 1.9, H: 1.55 }, paint: seed })) {
      const [t, ga, gb, gc, sg] = p.g;
      const geo = t === 'mesh' ? runtimeMeshDataGeometry(ga) : t === 'box' ? box(ga, gb, gc)
        : t === 'cyl' ? cyl(ga, gb, gc, sg || 6)
          : t === 'cone' ? cone(ga, gb, sg || 6) : ico(ga);
      const [px = 0, py = 0, pz = 0] = p.p || [];
      const m = mesh(body, geo, p.c, px, py, pz);
      const [rx = 0, ry = 0, rz = 0] = p.r || [];
      if (rx || ry || rz) m.rotation.set(rx, ry, rz);
    }
    body.rotation.y = rnd() * Math.PI * 2;
    g.add(body);
  },

  /** 擱淺船:鏽蝕船殼坐灘 + 艦橋 + 貨櫃(可被擊毀 → 短暫火災;全部件相接,無懸空) */
  ship(g, r, rnd) {
    addSceneGeometry(g, vesselSceneGeometry(Math.floor(rnd() * 0x100000000),
      [r * 1.65, HAZARDS.ship.hgt, r * .6]), 'stranded-ship');
  },

  /** 火場:焦土 + 火舌(閃爍動畫)+ 濃煙柱 */
  fire(g, r, rnd) {
    const scorch = mesh(g, cyl(r * 0.85, r * 0.95, 0.14, 12), 0x17130f, 0, 0.07, 0);
    scorch.material.emissive = new THREE.Color(0x1a0800);
    const flames = [];
    const n = 6 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, d = r * rnd() * 0.7;
      const h = 1.6 + rnd() * 2.6;
      const f = mesh(g, flameGeometry(0.5 + rnd() * 0.5, h),
        i % 3 === 0 ? 0xffd23c : 0xff7a1f, Math.cos(a) * d, h / 2, Math.sin(a) * d,
        { emissive: new THREE.Color(i % 3 === 0 ? 0xffaa00 : 0xff4400), emissiveIntensity: 1.6, transparent: true, opacity: 0.92 });
      f.userData.h0 = h;
      f.userData.ph = rnd() * Math.PI * 2;
      flames.push(f);
    }
    for (let i = 0; i < 3; i++) {
      mesh(g, smokeGeometry(0.9 + rnd() * 0.8), 0x2c2c30,
        (rnd() - 0.5) * r, 3.4 + i * 1.7 + rnd(), (rnd() - 0.5) * r,
        { transparent: true, opacity: 0.55 });
    }
    g.userData.flames = flames;   // game.js 逐幀閃爍
  },

  /** 森林大火:大範圍焦土 + 高聳火柱 + 厚黑煙（比城市火場更高更密） */
  forestfire(g, r, rnd) {
    const scorch = mesh(g, cyl(r * 0.9, r * 1.0, 0.16, 14), 0x100c09, 0, 0.08, 0);
    scorch.material.emissive = new THREE.Color(0x1a0800);
    mesh(g, cyl(r * 0.45, r * 0.55, 0.10, 10), 0x0a0806, 0, 0.12, 0);   // 中心焦核
    const flames = [];
    const n = 10 + Math.floor(rnd() * 6);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, d = r * rnd() * 0.82;
      const h = 2.8 + rnd() * 5.2;   // 森林火焰更高
      const f = mesh(g, flameGeometry(0.7 + rnd() * 0.8, h),
        i % 3 === 0 ? 0xffd23c : 0xff6a1f, Math.cos(a) * d, h / 2, Math.sin(a) * d,
        { emissive: new THREE.Color(i % 3 === 0 ? 0xffaa00 : 0xff3300), emissiveIntensity: 1.8, transparent: true, opacity: 0.88 });
      f.userData.h0 = h; f.userData.ph = rnd() * Math.PI * 2;
      flames.push(f);
    }
    for (let i = 0; i < 4; i++) {   // 更厚的黑煙柱
      mesh(g, smokeGeometry(1.2 + rnd() * 1.2), 0x1c1c20,
        (rnd() - 0.5) * r, 5.0 + i * 2.4 + rnd(), (rnd() - 0.5) * r,
        { transparent: true, opacity: 0.6 });
    }
    g.userData.flames = flames;
  },

  /** 草原大火:低矮橫向蔓延火線 + 大面積燒焦地表 */
  grassfire(g, r, rnd) {
    const scorch = mesh(g, cyl(r * 0.88, r * 1.0, 0.12, 16), 0x14100a, 0, 0.06, 0);
    scorch.material.emissive = new THREE.Color(0x1a0800);
    const flames = [];
    const n = 14 + Math.floor(rnd() * 8);   // 低矮但密集的火舌
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, d = r * (0.2 + rnd() * 0.75);
      const h = 0.6 + rnd() * 1.4;   // 草原火焰低矮
      const f = mesh(g, flameGeometry(0.35 + rnd() * 0.45, h),
        i % 4 === 0 ? 0xffe050 : 0xff8820, Math.cos(a) * d, h / 2, Math.sin(a) * d,
        { emissive: new THREE.Color(i % 4 === 0 ? 0xffcc00 : 0xff5500), emissiveIntensity: 1.5, transparent: true, opacity: 0.9 });
      f.userData.h0 = h; f.userData.ph = rnd() * Math.PI * 2;
      flames.push(f);
    }
    for (let i = 0; i < 2; i++) {   // 薄煙（草原火煙少）
      mesh(g, smokeGeometry(0.7 + rnd() * 0.6), 0x3a3840,
        (rnd() - 0.5) * r * 0.8, 2.0 + i * 1.4 + rnd(), (rnd() - 0.5) * r * 0.8,
        { transparent: true, opacity: 0.42 });
    }
    g.userData.flames = flames;
  },

  /** 工廠大火:廠房金屬骨架殘骸 + 濃烈橘紅火焰 + 滾滾黑煙 */
  factoryfire(g, r, rnd) {
    mesh(g, cyl(r * 0.82, r * 0.92, 0.18, 10), 0x110e0b, 0, 0.09, 0)
      .material.emissive = new THREE.Color(0x200a00);
    for (let i = 0; i < 3; i++) {   // 廠房金屬骨架殘骸
      const a = rnd() * Math.PI * 2, d = r * (0.3 + rnd() * 0.5);
      const strut = mesh(g, box(0.28 + rnd() * 0.36, 3.0 + rnd() * 3.0, 0.22), 0x3a3028,
        Math.cos(a) * d, 1.5, Math.sin(a) * d);
      strut.rotation.set((rnd() - 0.5) * 0.4, rnd() * Math.PI, 0);
    }
    const flames = [];
    const n = 8 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, d = r * rnd() * 0.75;
      const h = 2.2 + rnd() * 4.0;
      const f = mesh(g, flameGeometry(0.6 + rnd() * 0.7, h),
        i % 2 === 0 ? 0xff4a10 : 0xffa020, Math.cos(a) * d, h / 2, Math.sin(a) * d,
        { emissive: new THREE.Color(i % 2 === 0 ? 0xff2200 : 0xff8800), emissiveIntensity: 2.0, transparent: true, opacity: 0.94 });
      f.userData.h0 = h; f.userData.ph = rnd() * Math.PI * 2;
      flames.push(f);
    }
    for (let i = 0; i < 5; i++) {   // 濃厚黑煙（工廠特色）
      mesh(g, smokeGeometry(1.4 + rnd() * 1.6), 0x111115,
        (rnd() - 0.5) * r * 0.9, 4.0 + i * 3.0 + rnd(), (rnd() - 0.5) * r * 0.9,
        { transparent: true, opacity: 0.7 });
    }
    g.userData.flames = flames;
  },

  /** 路面塌陷:黑洞 + 傾斜裂板 */
  sinkhole(g, r, rnd) {
    mesh(g, brokenGroundGeometry(r, 1.6), 0x262726, 0, .04, 0);
    const rim = 5 + Math.floor(rnd() * 4);
    for (let i = 0; i < rim; i++) {
      const a = (i / rim) * Math.PI * 2 + rnd() * 0.5;
      const slab = mesh(g, box(1.6 + rnd() * 1.4, 0.28, 1.2 + rnd()), jitterColor(0x8b8e90, rnd, 0.01, 0.1),
        Math.cos(a) * r * 0.8, 0.1, Math.sin(a) * r * 0.8);
      slab.rotation.set((rnd() - 0.5) * 0.9, a, (rnd() - 0.3) * 0.5);
    }
    if (rnd() < 0.5) {   // 半截掉進去的路燈(傾角/高度取「下端一定沉到地平面以下」的組合)
      const pole = mesh(g, cyl(0.07, 0.09, 4.5), 0x6d757c, r * 0.3, 0.9, 0);
      pole.rotation.z = 0.7 + rnd() * 0.4;
    }
  },

  /** 坑洞:路面破損的淺坑 + 底部積水 + 邊緣碎裂柏油塊(減速,不阻擋) */
  pothole(g, r, rnd) {
    mesh(g, brokenGroundGeometry(r * .85, .45), 0x24282a, 0, .04, 0);   // 淺坑
    const water = mesh(g, cyl(r * 0.55, r * 0.55, 0.1, 12), 0x243033, 0, -0.05, 0,
      { transparent: true, opacity: 0.7 });
    water.userData.water = true;                                       // 底部積水(反光/漣漪)
    const n = 4 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.6;
      const chunk = mesh(g, box(0.7 + rnd() * 0.8, 0.18, 0.6 + rnd() * 0.7),
        jitterColor(0x3a3f45, rnd, 0.01, 0.08), Math.cos(a) * r * 0.7, 0.06, Math.sin(a) * r * 0.7);
      chunk.rotation.set((rnd() - 0.5) * 0.5, a, (rnd() - 0.5) * 0.4);
    }
  },

  /** 淹水區:半透明水面 + 露出水面的雜物 */
  flood(g, r, rnd) {
    const water = mesh(g, brokenGroundGeometry(r, .1), 0x2e6f95, 0, .42, 0,
      { transparent: true, opacity: 0.72, emissive: new THREE.Color(0x0a2433), emissiveIntensity: 0.4 });
    water.userData.water = true;
    for (let i = 0; i < 2 + rnd() * 3; i++) {   // 水面露頭的箱子/輪胎
      const a = rnd() * Math.PI * 2, d = r * rnd() * 0.7;
      if (rnd() < 0.5) mesh(g, box(0.8, 0.5, 0.8), 0x9c8658, Math.cos(a) * d, 0.5, Math.sin(a) * d).rotation.y = rnd() * 3;
      else {
        const t = mesh(g, cyl(0.45, 0.45, 0.3, 10), 0x22262a, Math.cos(a) * d, 0.42, Math.sin(a) * d);
        t.rotation.x = Math.PI / 2 * rnd();
      }
    }
  },

  /** 坍方 / 土石流:泥石流舌狀堆 + 大石 */
  landslide(g, r, rnd) {
    addSceneGeometry(g, geologySceneGeometry('moraine', Math.floor(rnd() * 0x100000000),
      [r * 1.8, 6, r * 1.35]), 'landslide');
  },

  /** 落石:鑿刻巨石群(可擊毀開路)— 硬邊碎面 + 頂部苔蘚投影 */
  rockfall(g, r, rnd) {
    addSceneGeometry(g, geologySceneGeometry('tor', Math.floor(rnd() * 0x100000000),
      [r * 1.8, 6, r * 1.4]), 'rockfall');
  },

  /** 倒木:橫躺樹幹 + 翹起的根盤 + 殘枝 */
  fallentree(g, r, rnd) {
    addSceneGeometry(g, forestSceneGeometry('fallenLog', Math.floor(rnd() * 0x100000000),
      [r * 1.8, 3.2, r * .7]), 'fallen-tree');
  },

  /** 神木:超尺度巨樹 — 板根裙 + 樹瘤 + 多層樹冠 + 注連繩(遮視線的立體掩體) */
  sacredtree(g, r, rnd) {
    addSceneGeometry(g, forestSceneGeometry('banyan', Math.floor(rnd() * 0x100000000),
      [r * 2, HAZARDS.sacredtree.hgt, r * 2]), 'sacred-tree');
  },

  /** 巨石:比現實高大的獨立巨岩 — 鑿刻主碑岩 + 倚靠斜岩 + 苔蘚投影 + 碎石裙 */
  boulder(g, r, rnd) {
    addSceneGeometry(g, geologySceneGeometry('granite', Math.floor(rnd() * 0x100000000),
      [r * 1.8, HAZARDS.boulder.hgt, r * 1.4]), 'boulder');
  },

  /** 匿蹤防空陣地:迷彩偽裝網 + 飛彈發射架 + 沙包圈 */
  aasite(g, r, rnd) {
    addSceneGeometry(g, furnitureSceneGeometry('aasite'), 'air-defence-site');
  },

  /** 偵察中繼站:格架天線塔 + 碟形天線 + 發光信標(佔用 3 秒 → 全隊限時無霧視野) */
  relay(g, r, rnd) {
    addSceneGeometry(g, furnitureSceneGeometry('relay'), 'relay-station');
    mesh(g, cyl(.18, .18, .25, 12), 0x66ffe0, 0, 8.04, 0,
      { emissive: new THREE.Color(0x1f8a70), emissiveIntensity: 1.6 });
  },
};

// ---- 零件級細節抖動(P2-B;2026-08-03)----
// 規則與振幅上界的**唯一縫 = xform.js `partJitter`**(植被那一套):
//   ① `jr` 水平半徑**只增不減** —— 縮小會拉開「名義上剛好貼合」的接合(audit_object_joints 紅過);
//   ② `spin` **只給軸心件**(px = pz = 0):偏移件的貼合靠特定朝向的頂點,自轉會把它轉開;
//   ③ MUST NOT 動 y / px / pz / 縱向縮放。
// 振幅刻意比植被小(8% → `PART_JIT`):障礙物的碰撞是**一根 def.r 的圓柱**,而 BUILDERS 的
// 零件本來就散到 0.8~0.9 r —— 演出半徑一旦頂出那根圓柱就是「看得見卻穿得過」(原則 4 / A30 家族)。
// 上界由 `audit_object_joints.mjs` 逐 kind 實測(抖動後的最大水平外廓 MUST 仍收在 r 內),
// MUST NOT 憑感覺調大。
const PART_JIT = 0.06;
const _jbox = new THREE.Box3();
function fitSceneAssemblies(group, radius) {
  const assemblies=group.children.filter(mesh=>mesh.userData.sceneAssembly), point=new THREE.Vector3();
  let extent=0;
  for(const mesh of assemblies) {
    mesh.updateMatrix();
    const positions=mesh.geometry.attributes.position;
    for(let i=0;i<positions.count;i++) {
      point.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrix);
      extent=Math.max(extent,Math.hypot(point.x,point.z));
    }
  }
  if(extent<=radius)return;
  const scale=radius/extent;
  for(const mesh of assemblies) {
    mesh.scale.x*=scale;mesh.scale.z*=scale;
    mesh.position.x*=scale;mesh.position.z*=scale;
  }
}
function jitterParts(g, dj, r) {
  for (const o of g.children) {
    if (o.userData.sceneAssembly) continue;
    const { jr, spin } = partJitter(
      partId(o.position.y, o.position.x, o.position.z), dj, PART_JIT,
      o.position.x === 0 && o.position.z === 0,
    );
    if (jr === 1 && !spin) continue;
    // **演出半徑 MUST 收在權威碰撞柱內**(原則 4;超出去 = 看得見卻打不到,A30 家族)。
    // 這裡是**量出來**的不是估的:抖完直接量這一件的水平外廓(群組尚未進場景 ⇒ 子節點的
    // 世界矩陣就是群組局部座標),頂出 r 就把這一件退回原樣。
    // 逐件退回而不是整顆放棄 —— 近軸的零件本來就頂不到,沒有理由陪葬(原則 6)。
    const sx = o.scale.x, sz = o.scale.z;
    o.scale.x *= jr; o.scale.z *= jr;
    if (spin) o.rotateY(spin);   // rotateY = 繞**自身**軸後乘,擠出軸的兩端不動
    _jbox.setFromObject(o);
    const ext = Math.max(Math.abs(_jbox.min.x), Math.abs(_jbox.max.x),
      Math.abs(_jbox.min.z), Math.abs(_jbox.max.z));
    if (ext > r) { o.scale.x = sx; o.scale.z = sz; if (spin) o.rotateY(-spin); }
  }
}

/**
 * 靜態不透明零件依材質合併。鑿刻岩的平滑 `outlineGeo`、逐幀火舌與水面維持獨立；
 * 前者是現役反轉外殼描邊唯一需要的幾何，後兩者各有自己的執行期狀態。
 */
function batchHazardParts(g) {
  g.updateMatrixWorld(true);
  const buckets = new Map();
  g.traverse((o) => {
    if (!o.isMesh || o.material.transparent || o.userData.outlineGeo
      || Object.keys(o.userData).some(key => key !== 'sceneAssembly')) return;
    const m = o.material;
    const key = [m.type, m.color?.getHex(), m.emissive?.getHex(), m.emissiveIntensity,
      m.opacity, m.side, m.vertexColors, JSON.stringify(m.userData.celOpts || {})].join('|');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(o);
  });
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const keep = meshes[0].material;
    const geos = meshes.map((o) => o.geometry.clone().applyMatrix4(o.matrixWorld));
    const merged = new THREE.Mesh(mergeGeos(geos, keep.vertexColors ? geos.map(() => null) : null), keep);
    for (const o of meshes) {
      o.parent.remove(o);
      o.geometry.dispose();
      if (o.material !== keep) o.material.dispose();
    }
    g.add(merged);
  }
}

/**
 * 建立一個障礙物 / 防空陣地。
 * @param kind HAZARDS 的 key 或 'aasite' / 'relay'
 * @param seed 實體 id(全房間一致的隨機差異化)
 * @param r    影響半徑(m,伺服器 def.r × sc)
 */
export function buildHazard(kind, seed, r = 8) {
  const g = new THREE.Group();
  const rnd = mulberry32((seed * 2654435761) >>> 0);
  (BUILDERS[kind] || BUILDERS.rockfall)(g, r, rnd);
  fitSceneAssemblies(g, r);
  // 零件級細節抖動(P2-B;2026-08-03):BUILDERS 本來就逐顆抽尺寸/數量/朝向,但**同一顆裡的
  // 各個零件**是逐位元一樣的比例 —— 兩顆落石的每一塊石頭都同一副長寬比。dj 由 seed 推
  // (確定性:全房同一顆障礙長得一樣,§2.3),規則整組沿用植被那一份縫(xform.js)。
  jitterParts(g, ((seed * 2246822519) >>> 0) / 4294967296, r);
  batchHazardParts(g);
  // 接地 AO 頂點色(botw_plan Task 2.2):貼地處偏暗冷 → 物件「長」在地上
  // (神木不加大衰減:板根/樹幹本色深,AO 拉高會整片近黑)
  bakeContactAO(g, 2.4);
  outlinify(g, 0.07);   // 漫畫描邊(透明件:水面/偽裝網/火舌 自動跳過)
  g.userData.kind = kind;
  if (g.userData.flames) {
    const flames = new Set(g.userData.flames);
    g.userData.smoke = [];
    g.traverse(node => {
      if (!node.isMesh || !node.material.transparent) return;
      node.userData.fireOrigin = node.position.clone();
      node.userData.fireScale = node.scale.clone();
      node.userData.fireOpacity = node.material.opacity;
      if (!flames.has(node)) g.userData.smoke.push(node);
    });
    for (const flame of flames) {
      const core = new THREE.Mesh(flame.geometry, toonMat(0xffefaf, { emissive: 0xffb840,
        emissiveIntensity: 2, transparent: true, opacity: .9, depthWrite: false }));
      core.scale.set(.48, .72, .48);
      core.position.y = -flame.userData.h0 * .12;
      flame.add(core);
      flame.material.depthWrite = false;
    }
  }
  return g;
}

export function stepFireVisual(group, now, strength, dynamics) {
  const wind = Math.max(0, Math.min(1, (dynamics?.wind || 0) / 100));
  const direction = dynamics?.windDir || [1, 0];
  for (const flame of group.userData.flames || []) {
    flame.visible = strength > 0;
    if (!flame.visible) continue;
    const u = flame.userData, flicker = .82 + .18 * Math.sin(now * 8 + u.ph) + .1 * Math.sin(now * 19 + u.ph * 2);
    const height = flicker * Math.sqrt(strength);
    flame.scale.set(u.fireScale.x / Math.sqrt(flicker), u.fireScale.y * height, u.fireScale.z / Math.sqrt(flicker));
    flame.position.copy(u.fireOrigin);
    flame.position.y += u.h0 * (height - 1) / 2;
    flame.rotation.z = -direction[0] * wind * .32;
    flame.rotation.x = direction[1] * wind * .32;
    flame.material.opacity = u.fireOpacity * Math.min(1, strength * 2);
  }
  for (let i = 0; i < (group.userData.smoke?.length || 0); i++) {
    const smoke = group.userData.smoke[i], u = smoke.userData;
    smoke.visible = strength > 0;
    if (!smoke.visible) continue;
    const life = (now * .16 + i * .31) % 1;
    smoke.position.copy(u.fireOrigin);
    smoke.position.x += direction[0] * wind * life * 7;
    smoke.position.z += direction[1] * wind * life * 7;
    smoke.position.y += life * 6;
    smoke.scale.copy(u.fireScale).multiplyScalar(.65 + life * .9);
    smoke.material.opacity = u.fireOpacity * Math.sin(life * Math.PI) * Math.min(1, strength);
    smoke.material.depthWrite = false;
  }
}

/**
 * 地雷微凸起:壓扁的多面體,顏色 = 腳下衛星影像色(完全融入環境),
 * 由 game.js 依距離控制 visible / opacity(靠近才看得到)。
 */
export function buildMineBump(rgb) {
  const color = rgb
    ? new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255).offsetHSL(0, 0, 0.03)
    : new THREE.Color(0x5a5f52);
  const m = new THREE.Mesh(scenePartGeometry({ g: ['lathe', [[0,0],[.42,0],[.5,.12],[.38,.4],[.16,.49],[0,.49]], 16] }), toonMat(color, { transparent: true, opacity: 0 }));
  m.scale.y = 0.18;   // 極輕微突起
  m.visible = false;
  return m;
}

/** 戰場物資:金色補給箱(現金)/ 綠色彈藥箱(補彈)/ 紫色強化艙(詞綴),
 *  game.js 逐幀旋轉+浮動 */
export function buildLoot(isAmmo, isAffix) {
  const g = new THREE.Group();
  const body = addSceneGeometry(g, furnitureSceneGeometry('crate'), 'supply-case');
  body.position.y = .4;
  body.material.color.setHex(isAffix ? 0xb897dd : isAmmo ? 0xb8d39e : 0xf3d899);
  if (isAffix) mesh(g, ico(.45), 0xb47bdf, 0, 1.95, 0,
    { emissive: new THREE.Color(0x632c9d), emissiveIntensity: 1.1 });
  else if (isAmmo) for(const x of [-.22,0,.22]) {
    mesh(g, cyl(.065,.065,.35,8), 0xc7ac62, x,1.86,0);
    mesh(g, cone(.065,.13,8), 0xe0c18a, x,2.09,0);
  }
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(1.0, 1.3, 18),
    new THREE.MeshBasicMaterial({ color: isAffix ? 0xc08aff : isAmmo ? 0x7ce07c : 0xffd76a, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.15;
  g.add(halo);
  outlinify(g, 0.05);
  g.userData.loot = true;
  return g;
}

// ---- 空投物資補給箱(降落傘 + 軍用木箱;箱型 S/M/L 決定尺寸與稀有色)----
// 稀有色也塗上傘布 ⇒ 遠遠看見金傘 = 大箱,值得搶。獎勵開箱才揭曉,箱體本身不透露內容。
const AIRDROP_TONE = {   // S 銅 / M 銀 / L 金:越大越亮眼
  S: 0xb0763a, M: 0xc9ced6, L: 0xffd24a,
};
export function buildAirdrop(sizeKey = 'S') {
  const sc = sizeKey === 'L' ? 1.7 : sizeKey === 'M' ? 1.35 : 1.0;
  const tone = AIRDROP_TONE[sizeKey] || AIRDROP_TONE.S;
  const toneC = new THREE.Color(tone);
  const g = new THREE.Group();

  // 木箱(bob 動畫的主體;game.js 以 userData.crate 驅動起伏)—— 2026-07-17 加大更醒目
  const crate = new THREE.Group();
  const s = 1.75 * sc;
  addSceneGeometry(crate, furnitureSceneGeometry('crate', [s, s * .93, s]), 'airdrop-case');
  // 頂面補給十字
  mesh(crate, box(s * 0.5, s * 0.08, s * 0.14), 0xe8ede4, 0, s * 0.94, 0);
  mesh(crate, box(s * 0.14, s * 0.08, s * 0.5), 0xe8ede4, 0, s * 0.94, 0);
  g.add(crate);
  g.userData.crate = crate;

  // 空投傘(飄降中顯示;落地後 game.js 隱藏 userData.chute,改顯示地面攤開傘)
  const chute = new THREE.Group();
  const cr = 3.0 * sc, chY = 5.4 * sc;
  mesh(chute, scenePartGeometry({g:['lathe', [[0,1.9*sc],[.8*cr,1.25*sc],[cr,0],[cr*.98,-.04*sc],[.79*cr,1.2*sc],[0,1.86*sc]], 24]}), tone, 0, chY - .9 * sc, 0,
    { emissive: toneC, emissiveIntensity: 0.35 });
  mesh(chute, cyl(cr, cr * 0.55, 0.28 * sc, 12), 0xd7dbe2, 0, chY - 0.9 * sc, 0);
  for (let i = 0; i < 4; i++) {   // 吊索:傘緣 → 箱角
    const a = i * Math.PI / 2 + Math.PI / 4;
    const rimX = Math.cos(a) * cr * 0.7, rimZ = Math.sin(a) * cr * 0.7;
    const boxX = Math.cos(a) * s * 0.5, boxZ = Math.sin(a) * s * 0.5;
    const ln = new THREE.Mesh(cyl(0.05, 0.05, chY - 1.1 * sc, 4),
      new THREE.MeshBasicMaterial({ color: 0xcfd4db }));
    ln.position.set((rimX + boxX) / 2, (chY - 0.9 * sc + s) / 2, (rimZ + boxZ) / 2);
    ln.lookAt(boxX, s, boxZ);
    ln.rotateX(Math.PI / 2);
    chute.add(ln);
  }
  g.add(chute);
  g.userData.chute = chute;

  // 落地攤開的降落傘:攤在箱子旁地面的傘布(壓扁淺穹頂 = 傘幅切面)+ 散落吊索(落地後顯示)
  const gchute = new THREE.Group();
  const gr = 3.4 * sc, off = s * 0.5 + gr * 0.72;               // 傘布中心 = 箱側邊外
  const canopy = mesh(gchute, scenePartGeometry({g:['lathe', [[0,.9*sc],[gr*.6,.65*sc],[gr,.05*sc],[0,0]],24]}), tone, off, 0.05, 0,
    { emissive: toneC, emissiveIntensity: 0.26 });
  canopy.scale.y = 0.3;                                          // 壓扁 = 攤在地面的傘布
  mesh(gchute, cyl(gr * 0.16, gr * 0.16, 0.12 * sc, 10), 0xd7dbe2, off, 0.28 * sc, 0);  // 傘頂氣孔帽
  for (let i = 0; i < 4; i++) {   // 吊索:箱角 → 攤開的傘緣(散落感)
    const a = i * Math.PI / 2 + Math.PI / 4;
    const boxX = Math.cos(a) * s * 0.5, boxZ = Math.sin(a) * s * 0.5;
    const rimX = off + Math.cos(a) * gr * 0.82, rimZ = Math.sin(a) * gr * 0.82;
    const ln = new THREE.Mesh(cyl(0.05, 0.05, Math.hypot(rimX - boxX, rimZ - boxZ), 4),
      new THREE.MeshBasicMaterial({ color: 0xcfd4db }));
    ln.position.set((rimX + boxX) / 2, 0.16, (rimZ + boxZ) / 2);
    ln.lookAt(rimX, 0.16, rimZ);
    ln.rotateX(Math.PI / 2);
    gchute.add(ln);
  }
  gchute.visible = false;
  g.add(gchute);
  g.userData.groundChute = gchute;

  // 醒目提示(落地後顯示):地面光環 + additive 光柱信標(遠處也看得到)
  const halo = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.9 * sc, 2.8 * sc, 24),
    new THREE.MeshBasicMaterial({ color: tone, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.14;
  ring.userData.noOutline = true;
  halo.add(ring);
  const beamH = 24 * sc;
  const beam = new THREE.Mesh(
    cyl(1.6 * sc, 0.7 * sc, beamH, 12),
    new THREE.MeshBasicMaterial({
      color: tone, transparent: true, opacity: 0.17, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  beam.position.y = beamH / 2;
  beam.userData.noOutline = true;
  halo.add(beam);
  halo.userData.noOutline = true;
  g.add(halo);
  g.userData.halo = halo;

  outlinify(g, 0.05);
  g.userData.airdrop = true;
  return g;
}
