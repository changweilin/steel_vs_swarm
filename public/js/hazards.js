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
import { makeVehicle } from './vehicles.js';

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
      const a = rnd() * Math.PI * 2, d = r * (0.25 + rnd() * 0.6);
      const seg = new THREE.Group();
      const col = jitterColor(0xe8842c, rnd);
      const panel = mesh(seg, box(3.2, 1.1, 0.18), col, 0, 1.0, 0);
      panel.material.emissive = new THREE.Color(0x331803); panel.material.emissiveIntensity = 0.25;
      mesh(seg, box(3.2, 0.22, 0.2), 0xf4f0e6, 0, 1.35, 0);
      for (const s of [-1.4, 1.4]) mesh(seg, cyl(0.06, 0.06, 1.5), 0x8d949a, s, 0.75, 0);
      seg.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
      seg.rotation.y = rnd() * Math.PI;
      g.add(seg);
    }
    for (let i = 0; i < 2 + rnd() * 3; i++) {
      const a = rnd() * Math.PI * 2, d = r * rnd() * 0.8;
      const c = mesh(g, cone(0.28, 0.75, 8), 0xe8552c, Math.cos(a) * d, 0.38, Math.sin(a) * d);
      c.material.emissive = new THREE.Color(0x2a0a02); c.material.emissiveIntensity = 0.3;
    }
    if (rnd() < 0.6) {   // 鷹架一角
      const sc = new THREE.Group();
      for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) mesh(sc, cyl(0.08, 0.08, 3.4), 0xb8a25a, x, 1.7, z);
      mesh(sc, box(2.4, 0.12, 2.4), 0x9c8648, 0, 3.4, 0);
      sc.position.set((rnd() - 0.5) * r, 0, (rnd() - 0.5) * r);
      g.add(sc);
    }
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
        const geo = t === 'box' ? box(ga, gb, gc)
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

  /** 火場:焦土 + 火舌(閃爍動畫)+ 濃煙柱 */
  fire(g, r, rnd) {
    const scorch = mesh(g, cyl(r * 0.85, r * 0.95, 0.14, 12), 0x17130f, 0, 0.07, 0);
    scorch.material.emissive = new THREE.Color(0x1a0800);
    const flames = [];
    const n = 6 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, d = r * rnd() * 0.7;
      const h = 1.6 + rnd() * 2.6;
      const f = mesh(g, cone(0.5 + rnd() * 0.5, h, 6),
        i % 3 === 0 ? 0xffd23c : 0xff7a1f, Math.cos(a) * d, h / 2, Math.sin(a) * d,
        { emissive: new THREE.Color(i % 3 === 0 ? 0xffaa00 : 0xff4400), emissiveIntensity: 1.6, transparent: true, opacity: 0.92 });
      f.userData.h0 = h;
      f.userData.ph = rnd() * Math.PI * 2;
      flames.push(f);
    }
    for (let i = 0; i < 3; i++) {
      mesh(g, ico(0.9 + rnd() * 0.8), 0x2c2c30,
        (rnd() - 0.5) * r, 3.4 + i * 1.7 + rnd(), (rnd() - 0.5) * r,
        { transparent: true, opacity: 0.55 });
    }
    g.userData.flames = flames;   // game.js 逐幀閃爍
  },

  /** 路面塌陷:黑洞 + 傾斜裂板 */
  sinkhole(g, r, rnd) {
    mesh(g, cyl(r * 0.8, r * 0.55, 1.6, 10), 0x0c0e10, 0, -0.75, 0);
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
    mesh(g, cyl(r * 0.75, r * 0.5, 0.5, 12), 0x14161a, 0, -0.22, 0);   // 淺坑
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

  /** 淹水區:半透明水面 + 漣漪圈 + 露出水面的雜物 */
  flood(g, r, rnd) {
    const water = mesh(g, cyl(r, r, 0.22, 18), 0x2e6f95, 0, 0.32, 0,
      { transparent: true, opacity: 0.72, emissive: new THREE.Color(0x0a2433), emissiveIntensity: 0.4 });
    water.userData.water = true;
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r * (0.2 + i * 0.22), r * (0.24 + i * 0.22), 20),
        new THREE.MeshBasicMaterial({ color: 0x9fd4e8, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.46;
      g.add(ring);
    }
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
    const dirA = rnd() * Math.PI * 2;
    for (let i = 0; i < 8 + rnd() * 5; i++) {
      const t = rnd();
      const d = r * (t * 1.2 - 0.2);
      const spread = r * 0.5 * (1 - t * 0.5);
      // 新崩的土石不長苔;鑿刻碎面 + 泥/岩兩色系交錯 = 手繪土石流
      // 落石軸心高度綁自身尺寸(ico 最低頂點 = 0.851r × scale.y):寫成固定 0.4~1.1
      // 會讓小石塊整顆浮在土石流上方
      const size = 0.9 + rnd() * 1.6;
      const rock = rockMesh(g, size, rnd, jitterColor(rnd() < 0.6 ? 0x76604a : 0x7d7f82, rnd, 0.02, 0.12),
        Math.cos(dirA) * d + (rnd() - 0.5) * spread,
        size * (0.28 + rnd() * 0.14),
        Math.sin(dirA) * d + (rnd() - 0.5) * spread, null);
      rock.scale.y = 0.55 + rnd() * 0.3;
      rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    }
    for (let i = 0; i < 3; i++) {   // 被沖倒的樹(軸心 ≈ 幹半徑 → 橫躺觸地,不浮在土石上方)
      const log = mesh(g, cyl(0.14, 0.2, 3 + rnd() * 2), 0x5c452e,
        (rnd() - 0.5) * r * 1.4, 0.18, (rnd() - 0.5) * r * 1.4);
      log.rotation.set(Math.PI / 2 + (rnd() - 0.5) * 0.4, rnd() * 3, 0);
    }
  },

  /** 落石:鑿刻巨石群(可擊毀開路)— 硬邊碎面 + 頂部苔蘚投影 */
  rockfall(g, r, rnd) {
    const moss = { color: 0x63834a, amount: 0.75 };
    for (let i = 0; i < 4 + rnd() * 3; i++) {
      const a = rnd() * Math.PI * 2, d = r * rnd() * 0.75;
      const size = 0.8 + rnd() * (i === 0 ? 2.4 : 1.4);
      const rock = rockMesh(g, size, rnd, jitterColor(0x83878b, rnd, 0.01, 0.14),
        Math.cos(a) * d, size * 0.55, Math.sin(a) * d, moss);
      rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      rock.scale.set(1, 0.75 + rnd() * 0.4, 0.85 + rnd() * 0.3);
    }
  },

  /** 倒木:橫躺樹幹 + 翹起的根盤 + 殘枝 */
  fallentree(g, r, rnd) {
    const dirA = rnd() * Math.PI * 2;
    const len = r * 1.7;
    const trunk = mesh(g, cyl(0.35 + rnd() * 0.2, 0.55 + rnd() * 0.2, len, 7), jitterColor(0x6b4a2f, rnd), 0, 0.6, 0,
      { moss: { color: 0x6a8a4c, amount: 0.7 } });   // 橫躺樹幹朝天側著苔(投影自動貼上緣)
    trunk.rotation.set(Math.PI / 2, 0, dirA);
    // 幹軸單一縫:rotation(π/2, 0, dirA) 的局部 +y 在世界是 (−sin dirA, 0, cos dirA)
    // (three 的 Euler 'XYZ' = Rx·Ry·Rz)。根盤/殘枝/枯葉團一律沿這條軸擺,MUST NOT 各自
    // 手寫 cos(dirA+π/2) / sin(dirA−π/2) —— 後者的 z 分量正負相反(等於沿鏡射軸擺),
    // 只有 cos dirA ≈ 0 時才碰巧對得上,其餘角度整組零件飄在樹幹旁邊
    // (2026-07-27「樹幹與樹根沒接好」同一類病灶,見 A26)。
    const along = (t) => [-Math.sin(dirA) * len * t, Math.cos(dirA) * len * t];
    const [rootX, rootZ] = along(-0.5);              // 根端 = 幹軸的 −y 端(粗的那頭)
    const root = mesh(g, cyl(1.3, 0.4, 0.7, 8), 0x54412e, rootX, 0.9, rootZ);
    root.rotation.set(Math.PI / 2, 0, dirA);
    for (let i = 0; i < 3 + rnd() * 3; i++) {
      const [bx, bz] = along(rnd() - 0.5);
      // 殘枝中心必須落在幹身之內(幹軸 y = 0.6、半徑 0.35~0.75)才不會有半數枝條
      // 隨機轉出去後整根飄在樹幹上方
      const br = mesh(g, cyl(0.06, 0.1, 1 + rnd() * 1.4, 5), 0x5c452e, bx, 0.5 + rnd() * 0.4, bz);
      br.rotation.set(rnd() * 2, rnd() * 3, rnd() * 2);
    }
    if (rnd() < 0.7) {   // 殘留枯葉團
      const [lx, lz] = along(rnd() * 0.4 + 0.1);
      mesh(g, ico(1.2 + rnd() * 0.8), 0x9c8a3c, lx, 1.05, lz).scale.y = 0.7;   // 團心壓在幹身內
    }
  },

  /** 神木:超尺度巨樹 — 板根裙 + 樹瘤 + 多層樹冠 + 注連繩(遮視線的立體掩體) */
  sacredtree(g, r, rnd) {
    const H = 20 + rnd() * 8;                       // 主幹高(含 sc 可達 ~38m,遠超現實同座標樹木)
    const tR = r * 0.42;                            // 主幹半徑(粗壯:視覺佔地貼近碰撞半徑 r)
    // 主幹收分的單一縫:樹皮上的一切(板根/樹瘤/氣根/注連繩/紙垂)都以「該高度的幹半徑」
    // 為錨。MUST NOT 拿基部 tR 當通用半徑 —— 幹身往上收 38%,用基部半徑掛件會越掛越浮。
    const trunkR = (y) => tR * (1 - 0.38 * Math.min(1, Math.max(0, y / H)));
    const bark = jitterColor(0x5e4630, rnd, 0.02, 0.08);
    const mossy = { color: 0x64854a, amount: 0.6 };  // 老樹陰面著苔(朝上面投影)
    const trunk = mesh(g, cyl(tR * 0.62, tR, H, 9), bark, 0, H / 2, 0);
    trunk.rotation.y = rnd() * Math.PI;
    // 板根裙:環繞主幹的放射狀鰭板(內緣埋進幹身、外緣 ≈ 碰撞半徑 r)。
    // 徑向 = `rotation.y = -a`;`-a + π/2` 是**切向** —— 鰭板會變成圍著樹幹的一圈柵欄,
    // 與幹身之間整圈開縫(2026-07-27「神木樹幹與樹根沒接好」的成因,見 A26)。
    const fins = 5 + Math.floor(rnd() * 3);
    for (let i = 0; i < fins; i++) {
      const a = (i / fins) * Math.PI * 2 + rnd() * 0.5;
      const fin = mesh(g, box(tR * 2.0, 3.2 + rnd() * 2.2, 0.55), new THREE.Color(bark).multiplyScalar(0.9),
        Math.cos(a) * tR * 1.4, 1.6, Math.sin(a) * tR * 1.4, { moss: mossy });
      fin.rotation.y = -a;
      fin.rotation.z = (rnd() - 0.5) * 0.15;
    }
    // 根丘:板根外圈的隆起土丘,把「不可通行」的地面範圍畫出來
    for (let i = 0; i < 4; i++) {
      const a = rnd() * Math.PI * 2;
      const mound = mesh(g, ico(0.9 + rnd() * 0.8), new THREE.Color(bark).offsetHSL(0.02, 0, -0.06),
        Math.cos(a) * r * 0.7, 0.35, Math.sin(a) * r * 0.7, { moss: mossy });
      mound.scale.y = 0.45;
      mound.rotation.y = rnd() * 3;
    }
    // 樹瘤 + 垂落氣根(錨半徑取該高度的幹半徑:樹瘤半埋、氣根上端貼皮往下沒入幹身)
    for (let i = 0; i < 4; i++) {
      const a = rnd() * Math.PI * 2, y = H * (0.15 + rnd() * 0.5);
      const kR = trunkR(y);
      mesh(g, ico(0.5 + rnd() * 0.6), new THREE.Color(bark).offsetHSL(0, 0, -0.04),
        Math.cos(a) * kR * 0.85, y, Math.sin(a) * kR * 0.85);
      if (rnd() < 0.6) {
        const vine = mesh(g, cyl(0.05, 0.09, y * 0.7, 5), 0x4e5a38,
          Math.cos(a) * kR, y - y * 0.35, Math.sin(a) * kR);
        vine.rotation.z = (rnd() - 0.5) * 0.2;
      }
    }
    // 注連繩:神木的識別記號(繩環壓進樹皮 + 紙垂綁在繩上)
    // 繩環半徑取「該高度幹半徑的邊心距」(九邊形幹身的平面 = 0.94R):繩身在稜線處沒入、
    // 在平面處露出 = 勒進樹皮的繩子;紙垂則掛在繩心半徑上,與繩身相交才不會飄在旁邊。
    const ropeY = H * 0.22, ropeR = trunkR(ropeY) * 0.94;
    const rope = mesh(g, new THREE.TorusGeometry(ropeR, 0.14, 5, 12), 0xd8c894, 0, ropeY, 0);
    rope.rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      const shide = mesh(g, box(0.22, 0.7, 0.05), 0xf4f0e6,
        Math.cos(a) * ropeR, ropeY - 0.3, Math.sin(a) * ropeR);
      shide.rotation.y = -a + Math.PI / 2;   // 紙面朝外 = 長邊沿切向(與板根的徑向剛好差 90°)
    }
    // 多層樹冠:由大到小疊三~四層(壓扁 ico,每層色相微差 → 手繪層次)
    const layers = 3 + (rnd() < 0.5 ? 1 : 0);
    const canopies = [];
    for (let i = 0; i < layers; i++) {
      const t = i / layers;
      const cr = r * (1.35 - t * 0.75);
      const canopy = mesh(g, ico(cr), jitterColor(0x3e7a36, rnd, 0.05, 0.1),
        (rnd() - 0.5) * r * 0.35, H * (0.82 + t * 0.28), (rnd() - 0.5) * r * 0.35);
      canopy.scale.y = 0.55 + rnd() * 0.15;
      canopy.rotation.y = rnd() * Math.PI;
      canopies.push(canopy);
    }
    // 樹冠法線球化(botw_plan Task 3.2):所有層的法線一律改成
    // 「從樹冠團中心向外」— 整團樹冠像一朵實心雲,cel 明暗帶橫跨
    // 整個冠層,而不是每顆 ico 各自為政的破碎光影
    const cCen = new THREE.Vector3(0, H * 0.95, 0);
    const q = new THREE.Quaternion(), qi = new THREE.Quaternion();
    const cv = new THREE.Vector3();
    for (const cm of canopies) {
      q.setFromEuler(cm.rotation);
      qi.copy(q).invert();
      const p = cm.geometry.attributes.position, n = cm.geometry.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        cv.fromBufferAttribute(p, i).multiply(cm.scale).applyQuaternion(q)
          .add(cm.position).sub(cCen).normalize().applyQuaternion(qi);
        n.setXYZ(i, cv.x, cv.y, cv.z);
      }
      n.needsUpdate = true;
    }
  },

  /** 巨石:比現實高大的獨立巨岩 — 鑿刻主碑岩 + 倚靠斜岩 + 苔蘚投影 + 碎石裙 */
  boulder(g, r, rnd) {
    const H = 9 + rnd() * 5;                        // 主岩高(含 sc 可達 ~19m)
    const rockC = jitterColor(rnd() < 0.5 ? 0x7d8288 : 0x8a8274, rnd, 0.01, 0.1);
    const moss = { color: 0x5e7a44, amount: 0.9 };  // 世界 Y 軸投影:朝上岩面自動長苔(參考圖 cliff-rocks)
    const main = rockMesh(g, r * 0.62, rnd, rockC, 0, H * 0.42, 0, moss);
    main.scale.set(1, H / (r * 0.62) * 0.5, 0.8 + rnd() * 0.3);   // 拉高成碑狀
    main.rotation.y = rnd() * Math.PI;
    // 倚靠的斜岩(兩塊,構成可鑽的視覺縫隙感)
    for (let i = 0; i < 2; i++) {
      const a = rnd() * Math.PI * 2;
      const s = r * (0.3 + rnd() * 0.2);
      const lean = rockMesh(g, s, rnd, new THREE.Color(rockC).offsetHSL(0, 0, (rnd() - 0.5) * 0.08),
        Math.cos(a) * r * 0.65, s * (0.9 + rnd() * 0.6), Math.sin(a) * r * 0.65, moss);
      lean.scale.y = 1.4 + rnd() * 0.8;
      lean.rotation.set((rnd() - 0.5) * 0.7, rnd() * 3, (rnd() - 0.5) * 0.7);
    }
    // 岩面色帶(沉積紋;苔蘚改由投影著生,不再用貼片球)
    const band = mesh(g, cyl(r * 0.55, r * 0.58, 0.8, 9), new THREE.Color(rockC).multiplyScalar(0.82),
      0, H * (0.3 + rnd() * 0.25), 0);
    band.rotation.z = (rnd() - 0.5) * 0.2;
    // 碎石裙
    for (let i = 0; i < 5 + rnd() * 4; i++) {
      const a = rnd() * Math.PI * 2, d = r * (0.6 + rnd() * 0.5);
      const s = 0.5 + rnd() * 1.1;
      const rk = rockMesh(g, s, rnd, new THREE.Color(rockC).offsetHSL(0, 0, (rnd() - 0.5) * 0.1),
        Math.cos(a) * d, s * 0.5, Math.sin(a) * d, rnd() < 0.5 ? moss : null);
      rk.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      rk.scale.y = 0.6 + rnd() * 0.4;
    }
  },

  /** 匿蹤防空陣地:迷彩偽裝網 + 飛彈發射架 + 沙包圈 */
  aasite(g, r, rnd) {
    const R = 5.5;
    // 沙包圈:長邊沿環的切向(`rotation.y = -a + π/2`;寫成 `a` 會是鏡射角 —— 繞一圈
    // 在徑向與切向之間交錯)。第二層壓在下層那袋正上方,MUST NOT 用 y 交錯堆疊
    // (舊版 `0.25 + (i%2)*0.4` 讓半數沙包整袋浮空 0.4m)。
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const bag = mesh(g, box(1.1, 0.5, 0.6), jitterColor(0x9a8c62, rnd, 0.01, 0.08),
        Math.cos(a) * R * 0.85, 0.25, Math.sin(a) * R * 0.85);
      bag.rotation.y = -a + Math.PI / 2;
      if (i % 3 === 0) {
        const up = mesh(g, box(1.0, 0.46, 0.56), jitterColor(0x9a8c62, rnd, 0.01, 0.08),
          Math.cos(a) * R * 0.85, 0.71, Math.sin(a) * R * 0.85);
        up.rotation.y = -a + Math.PI / 2 + 0.25;
      }
    }
    // 發射架:斜置飛彈管 ×3。基座貼地(y = 半高);管與彈頭沿同一條傾倒軸
    // u = (0, cos TILT, sin TILT) 推算 —— 管尾正好落進基座內、彈頭同軸疊在管口,
    // MUST NOT 手寫兩組座標(舊版彈頭偏離管軸 0.4m、管尾懸在基座邊緣外)。
    const rack = new THREE.Group();
    mesh(rack, box(2.4, 0.5, 2.0), 0x4a523e, 0, 0.25, 0);
    const TILT = -0.9, uy = Math.cos(TILT), uz = Math.sin(TILT);
    const cy = 0.25 + 1.7 * uy, cz = 0.6 + 1.7 * uz;      // 管心:管尾埋在基座裡(y 0.25 / z 0.6)
    for (let i = -1; i <= 1; i++) {
      const tube = mesh(rack, cyl(0.22, 0.22, 3.4, 8), 0x39412f, i * 0.6, cy, cz);
      tube.rotation.x = TILT;
      const tip = mesh(rack, cone(0.22, 0.5, 8), 0x8f9a86,
        i * 0.6, cy + 1.89 * uy, cz + 1.89 * uz);         // 1.7 + 0.25 − 0.06:錐底埋進管口
      tip.rotation.x = TILT;
    }
    rack.rotation.y = rnd() * Math.PI * 2;
    g.add(rack);
    // 偽裝網:半透明迷彩帳(低伏,難遠距辨識)。下緣落地、上緣罩住發射架 ——
    // MUST NOT 做成上寬下窄的漏斗(舊版整頂浮在半空 1.7m,四周全是縫)。
    const NET_H = 3.0, NET_LO = R * 1.05, NET_HI = R * 0.42;
    const net = mesh(g, cyl(NET_HI, NET_LO, NET_H, 9), jitterColor(0x5d6b46, rnd, 0.04, 0.08),
      0, NET_H / 2, 0, { transparent: true, opacity: 0.85 });
    for (let i = 0; i < 6; i++) {   // 網上的偽裝色塊(半徑隨帳面收分,貼在網皮上)
      const a = rnd() * Math.PI * 2, hy = 0.5 + rnd() * 1.8;
      const rr = NET_LO + (NET_HI - NET_LO) * (hy / NET_H);   // 圓心落在網皮上 = 色塊跨過網面
      mesh(g, ico(0.55 + rnd() * 0.4), rnd() < 0.5 ? 0x6f7d50 : 0x8a7a4e,
        Math.cos(a) * rr, hy, Math.sin(a) * rr).scale.y = 0.4;
    }
  },

  /** 偵察中繼站:格架天線塔 + 碟形天線 + 發光信標(佔用 3 秒 → 全隊限時無霧視野) */
  relay(g, r, rnd) {
    mesh(g, cyl(2.4, 2.8, 0.7, 8), 0x4a5158, 0, 0.35, 0);                 // 基座
    mesh(g, cyl(0.28, 0.42, 7.5, 6), 0x7a848c, 0, 4.4, 0);                // 天線塔
    for (let i = 0; i < 3; i++) {                                          // 斜撐:上端頂住塔身
      const a = (i / 3) * Math.PI * 2 + rnd();
      const leg = mesh(g, cyl(0.12, 0.12, 4.2, 5), 0x606a72,
        Math.cos(a) * 1.5, 2.0, Math.sin(a) * 1.5);
      // 傾角符號決定上端往哪倒:(−sin a, 0, +cos a) = 上端收向軸心(斜撐該有的樣子);
      // 寫成 (+sin a, 0, −cos a) 上端會朝外開,頂端離塔身 2m 全懸空
      leg.rotation.set(-Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5);
    }
    const dish = mesh(g, cone(1.5, 0.9, 10), 0xb8c4cc, 0, 7.2, 0);         // 碟形天線
    dish.rotation.x = -1.1;
    dish.rotation.y = rnd() * Math.PI * 2;
    mesh(g, ico(0.4), 0x66ffe0, 0, 8.4, 0,                                 // 信標(可佔用提示)
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
function jitterParts(g, dj, r) {
  for (const o of g.children) {
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
 * 建立一個障礙物 / 防空陣地。
 * @param kind HAZARDS 的 key 或 'aasite' / 'relay'
 * @param seed 實體 id(全房間一致的隨機差異化)
 * @param r    影響半徑(m,伺服器 def.r × sc)
 */
export function buildHazard(kind, seed, r = 8) {
  const g = new THREE.Group();
  const rnd = mulberry32((seed * 2654435761) >>> 0);
  (BUILDERS[kind] || BUILDERS.rockfall)(g, r, rnd);
  // 零件級細節抖動(P2-B;2026-08-03):BUILDERS 本來就逐顆抽尺寸/數量/朝向,但**同一顆裡的
  // 各個零件**是逐位元一樣的比例 —— 兩顆落石的每一塊石頭都同一副長寬比。dj 由 seed 推
  // (確定性:全房同一顆障礙長得一樣,§2.3),規則整組沿用植被那一份縫(xform.js)。
  jitterParts(g, ((seed * 2246822519) >>> 0) / 4294967296, r);
  // 接地 AO 頂點色(botw_plan Task 2.2):貼地處偏暗冷 → 物件「長」在地上
  // (神木不加大衰減:板根/樹幹本色深,AO 拉高會整片近黑)
  bakeContactAO(g, 2.4);
  outlinify(g, 0.07);   // 漫畫描邊(透明件:水面/偽裝網/火舌 自動跳過)
  g.userData.kind = kind;
  return g;
}

/**
 * 地雷微凸起:壓扁的多面體,顏色 = 腳下衛星影像色(完全融入環境),
 * 由 game.js 依距離控制 visible / opacity(靠近才看得到)。
 */
export function buildMineBump(rgb) {
  const color = rgb
    ? new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255).offsetHSL(0, 0, 0.03)
    : new THREE.Color(0x5a5f52);
  const m = new THREE.Mesh(ico(0.55), toonMat(color, { transparent: true, opacity: 0 }));
  m.scale.y = 0.18;   // 極輕微突起
  m.visible = false;
  return m;
}

/** 戰場物資:金色補給箱(現金)/ 綠色彈藥箱(補彈)/ 紫色強化艙(詞綴),
 *  game.js 逐幀旋轉+浮動 */
export function buildLoot(isAmmo, isAffix) {
  const g = new THREE.Group();
  if (isAffix) {
    mesh(g, ico(0.9), 0x9a5ce0, 0, 1.1, 0,
      { emissive: new THREE.Color(0x4a1a8a), emissiveIntensity: 1.1 });
    mesh(g, box(1.3, 0.2, 1.3), 0x5a3a8a, 0, 0.4, 0);
  } else if (isAmmo) {
    mesh(g, box(1.3, 0.8, 0.9), 0x4c7a3c, 0, 1.0, 0,
      { emissive: new THREE.Color(0x1c3a12), emissiveIntensity: 0.7 });
    mesh(g, box(1.4, 0.16, 1.0), 0x2f5226, 0, 1.45, 0);
    const b = mesh(g, cyl(0.1, 0.1, 0.5, 6), 0xd8c14a, 0.3, 1.62, 0);
    b.rotation.z = 0.4;
  } else {
    mesh(g, box(1.1, 0.9, 1.1), 0xd8b04a, 0, 1.0, 0,
      { emissive: new THREE.Color(0x8a5c10), emissiveIntensity: 0.8 });
    mesh(g, box(1.2, 0.18, 0.3), 0x8a6a1a, 0, 1.0, 0);
    mesh(g, box(0.3, 0.18, 1.2), 0x8a6a1a, 0, 1.0, 0);
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
  mesh(crate, box(s, s * 0.85, s), 0x5a6b3a, 0, s * 0.5, 0,
    { emissive: new THREE.Color(0x232b16), emissiveIntensity: 0.55 });
  mesh(crate, box(s * 1.05, s * 0.16, s * 0.28), tone, 0, s * 0.5, 0);   // 打包束帶(稀有色)
  mesh(crate, box(s * 0.28, s * 0.16, s * 1.05), tone, 0, s * 0.5, 0);
  // 頂面補給十字
  mesh(crate, box(s * 0.5, s * 0.08, s * 0.14), 0xe8ede4, 0, s * 0.94, 0);
  mesh(crate, box(s * 0.14, s * 0.08, s * 0.5), 0xe8ede4, 0, s * 0.94, 0);
  g.add(crate);
  g.userData.crate = crate;

  // 空投傘(飄降中顯示;落地後 game.js 隱藏 userData.chute,改顯示地面攤開傘)
  const chute = new THREE.Group();
  const cr = 3.0 * sc, chY = 5.4 * sc;
  mesh(chute, cone(cr, 1.9 * sc, 12), tone, 0, chY, 0,
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
  const canopy = mesh(gchute, cone(gr, 0.9 * sc, 14), tone, off, 0.05, 0,
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
