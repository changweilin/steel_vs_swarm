// ============ 危險區客戶端:障礙物 / 防空陣地 / 地雷 / 物資 3D 模型 ============
// 全部程序生成低多邊形 + 日漫賽璐璐(cel)toon 材質(2.5D 視覺)。
// 每個實例以「實體 id 當種子」做隨機差異化(mulberry32):
// 同一障礙全房間玩家看到同一個樣子,但沒有兩個障礙長得一樣。
// 地雷:顏色取自腳下衛星影像(融入環境),靠近才浮現的極輕微突起。
import * as THREE from 'three';

// ---- 決定性亂數(與 biomes.js 同款 mulberry32)----
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 賽璐璐核心已抽到 toon.js(3 階 ramp / 描邊 / 硬邊高光),此處 re-export 保持相容 ----
import { toonGradient, toonMat, toonify, outlinify } from './toon.js';
export { toonGradient, toonMat, toonify };

// ---- 幾何速記 ----
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r1, r2, h, n = 6) => new THREE.CylinderGeometry(r1, r2, h, n);
const cone = (r, h, n = 6) => new THREE.ConeGeometry(r, h, n);
const ico = (r) => new THREE.IcosahedronGeometry(r, 0);

function mesh(g, geo, color, x = 0, y = 0, z = 0, opts = {}) {
  const m = new THREE.Mesh(geo, toonMat(color, opts));
  m.position.set(x, y, z);
  g.add(m);
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
      mesh(car, box(1.8, 0.85, 3.9), paint, 0, 0.85, 0);
      mesh(car, box(1.6, 0.62, 1.9), new THREE.Color(paint).multiplyScalar(0.85), 0, 1.55, -0.25);
      for (const [sx, sz] of [[-1, -1.3], [-1, 1.3], [1, -1.3], [1, 1.3]]) {
        const w = mesh(car, cyl(0.34, 0.34, 0.25, 8), 0x1c1f22, sx * 0.95, 0.42, sz);
        w.rotation.z = Math.PI / 2;
      }
      const a = rnd() * Math.PI * 2, d = i === 0 ? 0 : r * (0.4 + rnd() * 0.5);
      car.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
      car.rotation.set(
        rnd() < 0.3 ? Math.PI : (rnd() - 0.5) * 0.3,   // 三成翻肚
        rnd() * Math.PI * 2,
        (rnd() - 0.5) * 0.5,
      );
      if (car.rotation.x > 2) car.position.y = 1.3;
      g.add(car);
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
    if (rnd() < 0.5) {   // 半截掉進去的路燈
      const pole = mesh(g, cyl(0.07, 0.09, 4.5), 0x6d757c, r * 0.3, 1.2, 0);
      pole.rotation.z = 0.9 + rnd() * 0.4;
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
      const rock = mesh(g, ico(0.9 + rnd() * 1.6), jitterColor(rnd() < 0.6 ? 0x76604a : 0x7d7f82, rnd, 0.02, 0.12),
        Math.cos(dirA) * d + (rnd() - 0.5) * spread,
        0.4 + rnd() * 0.7,
        Math.sin(dirA) * d + (rnd() - 0.5) * spread);
      rock.scale.y = 0.55 + rnd() * 0.3;
      rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    }
    for (let i = 0; i < 3; i++) {   // 被沖倒的樹
      const log = mesh(g, cyl(0.14, 0.2, 3 + rnd() * 2), 0x5c452e,
        (rnd() - 0.5) * r * 1.4, 0.35, (rnd() - 0.5) * r * 1.4);
      log.rotation.set(Math.PI / 2 + (rnd() - 0.5) * 0.4, rnd() * 3, 0);
    }
  },

  /** 落石:巨石群(可擊毀開路) */
  rockfall(g, r, rnd) {
    for (let i = 0; i < 4 + rnd() * 3; i++) {
      const a = rnd() * Math.PI * 2, d = r * rnd() * 0.75;
      const size = 0.8 + rnd() * (i === 0 ? 2.4 : 1.4);
      const rock = mesh(g, ico(size), jitterColor(0x83878b, rnd, 0.01, 0.14),
        Math.cos(a) * d, size * 0.55, Math.sin(a) * d);
      rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      rock.scale.set(1, 0.75 + rnd() * 0.4, 0.85 + rnd() * 0.3);
    }
  },

  /** 倒木:橫躺樹幹 + 翹起的根盤 + 殘枝 */
  fallentree(g, r, rnd) {
    const dirA = rnd() * Math.PI * 2;
    const len = r * 1.7;
    const trunk = mesh(g, cyl(0.35 + rnd() * 0.2, 0.55 + rnd() * 0.2, len, 7), jitterColor(0x6b4a2f, rnd), 0, 0.6, 0);
    trunk.rotation.set(Math.PI / 2, 0, dirA);
    const rootX = Math.cos(dirA + Math.PI / 2) * len * 0.5, rootZ = Math.sin(dirA - Math.PI / 2) * len * 0.5;
    const root = mesh(g, cyl(1.3, 0.4, 0.7, 8), 0x54412e, -rootX, 0.9, -rootZ);
    root.rotation.set(Math.PI / 2, 0, dirA);
    for (let i = 0; i < 3 + rnd() * 3; i++) {
      const t = rnd() - 0.5;
      const br = mesh(g, cyl(0.06, 0.1, 1 + rnd() * 1.4, 5), 0x5c452e,
        Math.cos(dirA + Math.PI / 2) * len * t, 0.8 + rnd() * 0.5, Math.sin(dirA - Math.PI / 2) * len * t);
      br.rotation.set(rnd() * 2, rnd() * 3, rnd() * 2);
    }
    if (rnd() < 0.7) {   // 殘留枯葉團
      const t = rnd() * 0.4 + 0.1;
      mesh(g, ico(1.2 + rnd() * 0.8), 0x9c8a3c,
        Math.cos(dirA + Math.PI / 2) * len * t, 1.3, Math.sin(dirA - Math.PI / 2) * len * t).scale.y = 0.7;
    }
  },

  /** 匿蹤防空陣地:迷彩偽裝網 + 飛彈發射架 + 沙包圈 */
  aasite(g, r, rnd) {
    const R = 5.5;
    // 沙包圈
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const bag = mesh(g, box(1.1, 0.5, 0.6), jitterColor(0x9a8c62, rnd, 0.01, 0.08),
        Math.cos(a) * R * 0.85, 0.25 + (i % 2) * 0.4, Math.sin(a) * R * 0.85);
      bag.rotation.y = a;
    }
    // 發射架:斜置飛彈管 ×3
    const rack = new THREE.Group();
    mesh(rack, box(2.4, 0.5, 2.0), 0x4a523e, 0, 0.55, 0);
    for (let i = -1; i <= 1; i++) {
      const tube = mesh(rack, cyl(0.22, 0.22, 3.4, 8), 0x39412f, i * 0.6, 1.6, 0);
      tube.rotation.x = -0.9;
      const tip = mesh(rack, cone(0.22, 0.5, 8), 0x8f9a86, i * 0.6, 2.95, -1.06);
      tip.rotation.x = -0.9;
    }
    rack.rotation.y = rnd() * Math.PI * 2;
    g.add(rack);
    // 偽裝網:半透明迷彩傘(低伏,難遠距辨識)
    const net = mesh(g, cyl(R * 1.05, R * 0.55, 1.6, 9), jitterColor(0x5d6b46, rnd, 0.04, 0.08),
      0, 2.2, 0, { transparent: true, opacity: 0.85 });
    net.scale.y = 0.65;
    for (let i = 0; i < 6; i++) {   // 網上的偽裝色塊
      const a = rnd() * Math.PI * 2;
      mesh(g, ico(0.55 + rnd() * 0.4), rnd() < 0.5 ? 0x6f7d50 : 0x8a7a4e,
        Math.cos(a) * R * 0.7, 2.6 + rnd() * 0.4, Math.sin(a) * R * 0.7).scale.y = 0.4;
    }
  },

  /** 偵察中繼站:格架天線塔 + 碟形天線 + 發光信標(佔用 3 秒 → 全隊限時無霧視野) */
  relay(g, r, rnd) {
    mesh(g, cyl(2.4, 2.8, 0.7, 8), 0x4a5158, 0, 0.35, 0);                 // 基座
    mesh(g, cyl(0.28, 0.42, 7.5, 6), 0x7a848c, 0, 4.4, 0);                // 天線塔
    for (let i = 0; i < 3; i++) {                                          // 斜撐
      const a = (i / 3) * Math.PI * 2 + rnd();
      const leg = mesh(g, cyl(0.12, 0.12, 4.2, 5), 0x606a72,
        Math.cos(a) * 1.5, 2.0, Math.sin(a) * 1.5);
      leg.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45);
    }
    const dish = mesh(g, cone(1.5, 0.9, 10), 0xb8c4cc, 0, 7.2, 0);         // 碟形天線
    dish.rotation.x = -1.1;
    dish.rotation.y = rnd() * Math.PI * 2;
    mesh(g, ico(0.4), 0x66ffe0, 0, 8.4, 0,                                 // 信標(可佔用提示)
      { emissive: new THREE.Color(0x1f8a70), emissiveIntensity: 1.6 });
  },
};

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
