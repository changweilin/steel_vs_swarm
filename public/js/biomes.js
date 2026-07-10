// ============ 地貌系統:五類地被 + 圖資建物 + 兵線淨空 ============
// 依衛星影像逐點分類五種地貌,鋪設對應的 3D 地物:
//   綠地   — 竹林(大小不一的群落)/ 闊葉林 / 針葉林(高海拔)
//            + 神木群落:全球實存 >65m 巨樹樹種,同種群聚、株高各異(GIANT_DEFS),
//              樹身掛鳥巢/樹屋/附生植物/垂藤(GIANT_DECO)
//   裸露地 — 芒草 / 箭竹 / 灌木 / 多肉植物
//            + 巨岩地標:世界名岩取材(酋長岩/烏魯魯/大霸尖山…,MEGALITHS)
//              與特徵基因合成岩(synthMegalith);岩上有電塔/石屋/疊石/鳥巢/斷崖樹
//   市區   — 依 OSM 圖資設置建物(住宅/商辦/醫院/學校/車站/寺廟/教堂/
//            清真寺/博物館/電塔/工廠),離線時退回程序生成街區;
//            一般建物分三款立面樣式(店面/陽台/玻璃帷幕)× 擴充色盤
//   水體   — 不鋪地物(水面由 terrain.js 處理)
//   濕地   — 紅樹林 / 蘆葦(僅低海拔成立)
// 預設場地的 mix(venues.js)會對分類加權,做出「單一 80% / 混合」的場地感。
// 兵線走廊保持淨空(寬度 > 4 台機甲並行),主堡與防禦塔周圍同樣清場。
// 植被全部用 InstancedMesh(低多邊形 + 分層樹冠),整張圖數十個 draw call。
// 亂數以戰場中心為種子:同一房間所有玩家看到同一片森林。
//
// 超尺度原則(2026-07-09):圖資建物比現實更高大(高度 ×1.8、佔地 ×1.25),
// 立面用程序生成窗格貼圖(賽璐璐「畫上去的窗」)取代單色塊;
// 建物同時輸出碰撞柱(group.userData.blockers)— 限制玩家行動但不封鎖,
// 兵線走廊由淨空網格保證暢通,無人機永遠可以飛越屋頂。
// 立體掩體三本柱(2026-07-10):建物 / 神木 / 巨岩高度範圍互相對齊(約 26~165m),
// 三者皆登記碰撞柱作障礙與隱蔽;神木與巨岩先於一般植被佔位,小植被/地被自動避開。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ENV, GAME } from './data.js';
import { llToWorld } from './terrain.js';
import { toonMat, toonGradient, envMat, bakeContactAO } from './hazards.js';
import { buildGroundCover } from './ground.js';

const CELL = 10;                 // 淨空網格(m);走廊全寬約 34m > 4×3.5m 機甲
const MAX_VEG = 7000;            // 植被實例上限
const MAX_BUILDINGS = 240;       // 建物上限(特殊地標另計 ≤ 60)
// 超尺度倍率:圖資建物 / 地標 / 植被都比現實高大(氣勢 + 立體掩體)
const OVER = { bldH: 1.8, bldXZ: 1.25, bldCap: 170, lm: 1.6 };
// 植被放大倍率(喬木最誇張,地被小幅)
const VEG_SCALE = {
  bamboo: 1.5, broadleaf: 1.45, birch: 1.4, conifer: 1.5, deadtree: 1.35, mangrove: 1.3,
  shrub: 1.2, silvergrass: 1.15, arrowbamboo: 1.2, succulent: 1.15, reed: 1.1,
};
const OVERPASS = 'https://overpass-api.de/api/interpreter';

// ---- 決定性亂數(mulberry32):全房間共享同一片地貌 ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 淨空網格 ----
function cellKey(x, z) { return `${Math.round(x / CELL)},${Math.round(z / CELL)}`; }

// 大型地物 footprint 淨空:巨岩/神木群半徑可達數十公尺,逐格掃整個圓盤
function areaFree(blocked, x, z, r) {
  const n = Math.ceil(r / CELL);
  const cx = Math.round(x / CELL), cz = Math.round(z / CELL);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      if (i * i + j * j <= n * n + n && blocked.has(`${cx + i},${cz + j}`)) return false;
    }
  }
  return true;
}
function blockArea(blocked, x, z, r) {
  const n = Math.ceil(r / CELL);
  const cx = Math.round(x / CELL), cz = Math.round(z / CELL);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      if (i * i + j * j <= n * n + n) blocked.add(`${cx + i},${cz + j}`);
    }
  }
}

function buildClearance(cfg, center) {
  const blocked = new Set();
  const blockPoint = (x, z, r = CELL) => {
    const n = Math.ceil(r / CELL);
    const cx = Math.round(x / CELL), cz = Math.round(z / CELL);
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        if (i * i + j * j <= n * n + n) blocked.add(`${cx + i},${cz + j}`);
      }
    }
  };
  const lanesW = cfg.lanes.map((lane) => lane.map(([lat, lng]) => llToWorld(lat, lng, center)));
  for (const lane of lanesW) {
    for (let i = 1; i < lane.length; i++) {
      const [x1, z1] = lane[i - 1], [x2, z2] = lane[i];
      const seg = Math.hypot(x2 - x1, z2 - z1);
      const n = Math.max(1, Math.ceil(seg / 5));
      for (let k = 0; k <= n; k++) {
        blockPoint(x1 + (x2 - x1) * k / n, z1 + (z2 - z1) * k / n, 17);   // 走廊半寬 17m(建物佔地放大後仍不侵走廊)
      }
    }
    // 防禦塔位置(與 sim.js 同一算法)周圍清場
    const cum = [0];
    for (let i = 1; i < lane.length; i++) cum.push(cum[i - 1] + Math.hypot(lane[i][0] - lane[i - 1][0], lane[i][1] - lane[i - 1][1]));
    const total = cum[cum.length - 1];
    for (const frac of GAME.TOWER_FRACS) {
      for (const d of [total * frac, total * (1 - frac)]) {
        let i = 1; while (cum[i] < d && i < cum.length - 1) i++;
        const f = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
        blockPoint(lane[i - 1][0] + (lane[i][0] - lane[i - 1][0]) * f,
                   lane[i - 1][1] + (lane[i][1] - lane[i - 1][1]) * f, 30);
      }
    }
  }
  for (const side of ['SWARM', 'STEEL']) {
    const [x, z] = llToWorld(cfg.bases[side][0], cfg.bases[side][1], center);
    blockPoint(x, z, 70);
  }
  return blocked;
}

// ---- 地貌分類(影像顏色 + 高程 + 場地 mix 加權)----
function weightedPick(mix, rnd) {
  let sum = 0;
  for (const k in mix) sum += mix[k];
  let r = rnd() * sum;
  for (const k in mix) { r -= mix[k]; if (r <= 0) return k; }
  return null;
}

function classify(rgb, h, mix, rnd) {
  let c = null;
  if (rgb) {
    const [r, g, b] = rgb;
    if (b > r + 14 && b > g + 6) c = 'water';
    else if (g > r + 10 && g > b + 12) c = 'green';
    else {
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      if (sat < 24) c = 'urban';             // 低飽和灰 → 人工地貌
      else if (r > b + 12) c = 'bare';       // 棕黃 → 裸露地
      else c = 'green';
    }
  }
  if (mix && rnd() < 0.55) c = weightedPick(mix, rnd) || c;   // 場地類型加權
  if (!c) c = h > 400 ? 'bare' : 'green';                     // 無影像時粗略猜
  if (c === 'wet' && h > 8) c = 'green';                      // 濕地只在低海拔
  return c;
}

// ---- 植被幾何(低多邊形;key='foliage'/'conifer'/'grass' 依季節換色)----
const cyl = (r1, r2, h, n = 5) => new THREE.CylinderGeometry(r1, r2, h, n);
const cone = (r, h, n = 5) => new THREE.ConeGeometry(r, h, n);
const ico = (r) => new THREE.IcosahedronGeometry(r, 0);

// 每型多零件 = 分層樹冠/主幹/枝節,擺脫「一根柱 + 一顆球」的扁平輪廓;
// 每個 part 一個 InstancedMesh(draw call),整批仍是常數級
const VEG_DEFS = {
  bamboo:      { parts: [{ g: cyl(0.10, 0.14, 6.5), y: 3.25, c: 0x8fae4e },
                         { g: cone(1.1, 2.4), y: 7.4, key: 'foliage' },
                         { g: cone(0.8, 1.6), y: 5.6, key: 'foliage', sy: 0.9 }] },
  broadleaf:   { parts: [{ g: cyl(0.22, 0.40, 3.2), y: 1.6, c: 0x6b4a2f },
                         { g: cyl(0.10, 0.14, 2.2, 5), y: 3.6, c: 0x5f452c },   // 分枝
                         { g: ico(2.7), y: 5.0, key: 'foliage', sy: 0.75 },
                         { g: ico(1.7), y: 6.6, key: 'foliage', sy: 0.7 }] },   // 疊層樹冠
  birch:       { parts: [{ g: cyl(0.16, 0.22, 3.8), y: 1.9, c: 0xe8e4dc },
                         { g: ico(2.0), y: 4.9, key: 'foliage', sy: 0.85 },
                         { g: ico(1.2), y: 6.3, key: 'foliage', sy: 0.8 }] },
  deadtree:    { parts: [{ g: cyl(0.14, 0.30, 4.4), y: 2.2, c: 0x6a5a48 },
                         { g: cyl(0.06, 0.1, 2.2, 5), y: 4.6, c: 0x5c4e40 },
                         { g: cyl(0.05, 0.08, 1.6, 4), y: 3.6, c: 0x5c4e40 }] },
  conifer:     { parts: [{ g: cyl(0.20, 0.32, 2.0), y: 1.0, c: 0x5d4027 },
                         { g: cone(2.3, 3.4, 7), y: 3.2, key: 'conifer' },      // 三層塔狀樹冠
                         { g: cone(1.8, 3.0, 7), y: 5.4, key: 'conifer' },
                         { g: cone(1.2, 2.6, 7), y: 7.4, key: 'conifer' }] },
  silvergrass: { parts: [{ g: cone(0.85, 1.5), y: 0.75, key: 'grass' },
                         { g: cone(0.4, 1.4, 5), y: 1.5, c: 0xd8cfa8 }] },      // 抽穗的芒花
  arrowbamboo: { parts: [{ g: cone(0.9, 2.3), y: 1.15, c: 0x5c7a3a },
                         { g: cone(0.5, 1.5), y: 2.2, c: 0x6b8a44 }] },
  shrub:       { parts: [{ g: ico(0.9), y: 0.8, key: 'foliage', sy: 0.8 },
                         { g: ico(0.6), y: 1.3, key: 'foliage', sy: 0.75 }] },
  succulent:   { parts: [{ g: cyl(0.5, 0.7, 0.9, 6), y: 0.45, c: 0x7a9c74 },
                         { g: cyl(0.28, 0.4, 0.7, 6), y: 1.1, c: 0x8cae82 }] },
  mangrove:    { parts: [{ g: cyl(0.25, 0.5, 1.8), y: 0.9, c: 0x54412e },
                         { g: cyl(0.08, 0.12, 1.4, 4), y: 0.6, c: 0x4a3826 },   // 支柱根
                         { g: ico(2.0), y: 2.7, key: 'foliage', sy: 0.6 }] },
  reed:        { parts: [{ g: cone(0.35, 1.9, 4), y: 0.95, c: 0xa9b06a }] },
};

// ---- 神木(全球實存 >65m 巨樹樹種;綠地超尺度地標植被)----
//   紅杉(海岸紅杉 115m)/ 巨杉(世界爺 95m)/ 杏仁桉(澳洲王桉 100m)/
//   花旗松(100m)/ 西加雲杉(97m)/ 黃柳桉(婆羅洲熱帶巨樹 100m)/ 台灣杉(90m)
// 同一種神木成群聚落、株高各異(s 0.54~1.5 → 約 46~165m,對齊超尺度建物);
// 每株多零件建模:板根/樹皮絲帶/斜出枝節/多層樹冠(px/pz = 距軸心偏移,
// rx/rz = 枝幹傾角),樹幹登記碰撞柱 = 立體障礙與隱蔽。h/r = 公稱高/幹半徑。
const GIANT_DEFS = {
  redwood:  { h: 110, r: 3.4, parts: [
    { g: cyl(3.4, 5.6, 7, 7), y: 3.5, c: 0x6e4630 },
    { g: cyl(2.4, 3.5, 40, 7), y: 26, c: 0x7a4a32 },
    { g: cyl(1.4, 2.4, 34, 7), y: 63, c: 0x82503a },
    { g: cyl(0.6, 1.4, 22, 6), y: 91, c: 0x82503a },
    { g: cyl(0.4, 0.6, 9, 5), y: 56, px: 4.5, rz: 1.25, c: 0x6e4630 },
    { g: cyl(0.4, 0.6, 8, 5), y: 48, px: -4, rz: -1.2, c: 0x6e4630 },
    { g: cone(7, 26, 7), y: 96, c: 0x2e5c38 },
    { g: cone(9, 20, 7), y: 82, c: 0x33643c },
    { g: cone(10, 16, 7), y: 68, c: 0x2e5c38 },
    { g: ico(5), y: 58, px: 6, sy: 0.8, c: 0x33643c },
    { g: ico(5), y: 51, px: -6, sy: 0.8, c: 0x2e5c38 },
  ] },
  sequoia:  { h: 92, r: 5.6, parts: [
    { g: cyl(5.6, 9.2, 9, 8), y: 4.5, c: 0x7d4a2e },
    { g: cyl(4.0, 5.7, 44, 8), y: 30, c: 0x8a552f },
    { g: cyl(2.2, 4.0, 26, 7), y: 65, c: 0x936030 },
    { g: cyl(0.7, 1.0, 13, 5), y: 50, px: 5.5, rz: 1.3, c: 0x7d4a2e },
    { g: cyl(0.7, 1.0, 12, 5), y: 58, px: -5.5, rz: -1.3, c: 0x7d4a2e },
    { g: ico(9), y: 72, sy: 0.8, c: 0x39683a },
    { g: ico(7), y: 82, c: 0x336033 },
    { g: ico(6), y: 66, px: 7.5, c: 0x39683a },
    { g: ico(6), y: 60, px: -7.5, c: 0x336033 },
    { g: ico(5), y: 55, pz: 7, c: 0x39683a },
    { g: cone(5, 10, 6), y: 89, c: 0x336033 },
  ] },
  euc:      { h: 98, r: 2.6, parts: [
    { g: cyl(2.2, 3.6, 6, 7), y: 3, c: 0xcfc4b0 },
    { g: cyl(1.6, 2.3, 52, 7), y: 32, c: 0xdbd2c0 },
    { g: cyl(0.9, 1.6, 28, 6), y: 72, c: 0xe3dac8 },
    { g: cyl(0.16, 0.2, 12, 4), y: 20, px: 2.1, c: 0x9a8a76 },   // 剝落樹皮絲帶
    { g: cyl(0.5, 0.9, 18, 5), y: 80, px: 3.5, rz: 0.55, c: 0xcfc4b0 },
    { g: cyl(0.5, 0.8, 16, 5), y: 76, px: -3.2, rz: -0.6, c: 0xd6ccba },
    { g: ico(7), y: 90, sy: 0.7, c: 0x5c7a4a },
    { g: ico(5.5), y: 84, px: 8.5, sy: 0.65, c: 0x648250 },
    { g: ico(5), y: 80, px: -8, sy: 0.65, c: 0x5c7a4a },
    { g: ico(4.5), y: 83, pz: 7.5, sy: 0.6, c: 0x648250 },
    { g: ico(4), y: 96, c: 0x648250 },
  ] },
  dougfir:  { h: 100, r: 2.5, parts: [
    { g: cyl(2.5, 4.0, 6, 7), y: 3, c: 0x5d4027 },
    { g: cyl(1.8, 2.6, 42, 7), y: 27, c: 0x694a2d },
    { g: cone(11, 22, 8), y: 52, c: 0x2f5e40 },
    { g: cone(9, 20, 8), y: 65, c: 0x35684a },
    { g: cone(7, 18, 7), y: 78, c: 0x2f5e40 },
    { g: cone(4.5, 16, 7), y: 90, c: 0x35684a },
    { g: cone(2, 11, 6), y: 99, c: 0x2f5e40 },
    { g: ico(4), y: 46, px: 6, sy: 0.6, c: 0x35684a },
    { g: ico(4), y: 42, px: -6, sy: 0.6, c: 0x2f5e40 },
  ] },
  sitka:    { h: 96, r: 2.3, parts: [
    { g: cyl(2.3, 3.7, 5, 7), y: 2.5, c: 0x59452f },
    { g: cyl(1.6, 2.4, 44, 7), y: 27, c: 0x64503a },
    { g: cone(9, 20, 7), y: 54, c: 0x3d6a5e },
    { g: cone(7.5, 18, 7), y: 66, c: 0x467567 },
    { g: cone(6, 16, 7), y: 78, c: 0x3d6a5e },
    { g: cone(3.5, 15, 6), y: 89, c: 0x467567 },
    { g: ico(3.8), y: 46, px: 5.5, sy: 0.55, c: 0x3d6a5e },
    { g: ico(3.8), y: 41, px: -5.5, sy: 0.55, c: 0x467567 },
    { g: ico(3.2), y: 44, pz: 5.5, sy: 0.55, c: 0x3d6a5e },
  ] },
  meranti:  { h: 95, r: 2.5, parts: [
    { g: cone(3.0, 10, 3), y: 5, px: 2.6, c: 0x8a7354 },         // 板根鰭
    { g: cone(3.0, 10, 3), y: 5, px: -1.5, pz: 2.3, c: 0x93805e },
    { g: cone(3.0, 10, 3), y: 5, px: -1.5, pz: -2.3, c: 0x8a7354 },
    { g: cyl(1.5, 2.5, 52, 7), y: 30, c: 0xa08462 },
    { g: cyl(0.9, 1.5, 20, 6), y: 66, c: 0xa89068 },
    { g: cyl(0.5, 0.8, 14, 5), y: 74, px: 4, rz: 1.0, c: 0x93805e },
    { g: cyl(0.5, 0.8, 14, 5), y: 76, px: -4, rz: -1.0, c: 0x93805e },
    { g: ico(12), y: 82, sy: 0.55, c: 0x3f7a3a },                // 傘狀突出樹冠
    { g: ico(8), y: 78, px: 9.5, sy: 0.5, c: 0x468545 },
    { g: ico(8), y: 76, px: -9.5, sy: 0.5, c: 0x3f7a3a },
    { g: ico(7), y: 79, pz: 9, sy: 0.5, c: 0x468545 },
    { g: ico(7), y: 77, pz: -9, sy: 0.5, c: 0x3f7a3a },
    { g: ico(6), y: 88, sy: 0.6, c: 0x468545 },
  ] },
  taiwania: { h: 86, r: 2.1, parts: [
    { g: cyl(2.1, 3.4, 5, 7), y: 2.5, c: 0x6b4a30 },
    { g: cyl(1.4, 2.2, 38, 7), y: 24, c: 0x775434 },
    { g: cone(8, 14, 7), y: 45, c: 0x2c6242 },
    { g: cone(6.5, 13, 7), y: 56, c: 0x347050 },
    { g: cone(5, 12, 7), y: 67, c: 0x2c6242 },
    { g: cone(3.2, 11, 6), y: 77, c: 0x347050 },
    { g: cone(1.6, 9, 5), y: 85, c: 0x2c6242 },
    { g: ico(3.5), y: 38, px: 4.5, sy: 0.65, c: 0x347050 },
    { g: ico(3.5), y: 34, px: -4.5, sy: 0.65, c: 0x2c6242 },
  ] },
};

// ---- 巨木表面特徵(鳥巢/樹屋/附生植物/垂藤):與植被同管線 InstancedMesh ----
// 放置時把「樹幹半徑 + 掛載高度」烤進實例座標(item.x/y/z),零件只做小幅局部偏移;
// item.s ≈ 1 與樹齡脫鉤 → 特徵在任何體格的巨木上世界尺寸恆定。
const GIANT_DECO = {
  gnest:     { parts: [{ g: new THREE.TorusGeometry(0.85, 0.3, 5, 8), y: 0.15, rx: Math.PI / 2, c: 0x6a5138 },
                       { g: ico(0.2), y: 0.26, px: 0.25, c: 0xf2ead6 },
                       { g: ico(0.2), y: 0.26, px: -0.2, pz: 0.2, c: 0xf6efdc },
                       { g: cone(0.28, 0.75, 4), y: 0.62, pz: -0.35, c: 0x4a586a }] },       // 停棲的鳥
  treehouse: { parts: [{ g: new THREE.BoxGeometry(3.6, 0.4, 3.6), y: 0, c: 0x7a5a3c },       // 平台
                       { g: new THREE.BoxGeometry(2.2, 1.9, 2.0), y: 1.15, c: 0x8a6a48 },    // 小屋
                       { g: cone(2.0, 1.4, 4), y: 2.8, c: 0x6e4a38 },                        // 屋頂
                       { g: new THREE.BoxGeometry(0.9, 1.2, 0.12), y: 1.0, pz: 1.05, c: 0x3e3226 },   // 門
                       { g: new THREE.BoxGeometry(0.5, 4.5, 0.14), y: -2.4, pz: 1.5, c: 0x6a4e34 },   // 垂降木梯
                       { g: cyl(0.14, 0.6, 1.4, 4), y: -0.9, px: 1.2, c: 0x6a4e34 },         // 斜撐
                       { g: cyl(0.14, 0.6, 1.4, 4), y: -0.9, px: -1.2, c: 0x6a4e34 }] },
  epiphyte:  { parts: [{ g: ico(0.95), y: 0, sy: 0.5, c: 0x4f7a3c },                         // 鳥巢蕨簇
                       { g: ico(0.55), y: 0.1, px: 0.6, sy: 0.55, c: 0x5c8a46 },
                       { g: cone(0.5, 1.6, 5), y: -0.9, rx: Math.PI, c: 0x567a40 }] },       // 垂根
  vine:      { parts: [{ g: cyl(0.07, 0.14, 7, 4), y: -3.5, c: 0x567a40 },                   // 垂掛藤蔓
                       { g: ico(0.4), y: -7, sy: 0.6, c: 0x4f7a3c },
                       { g: ico(0.3), y: -4.6, px: 0.3, sy: 0.6, c: 0x5c8a46 }] },
};

/** 綠地神木群落:同一樹種成群、株高各異;樹幹登記碰撞柱(障礙 + 隱蔽) */
function placeGiantGroves({ terrain, blocked, blockers, items, rnd, sites }) {
  const species = Object.keys(GIANT_DEFS);
  const centers = [];
  let trees = 0;
  for (const [x, z] of sites) {
    if (centers.length >= 6) break;
    if (centers.some(([cx, cz]) => Math.hypot(x - cx, z - cz) < 170)) continue;
    const type = species[Math.floor(rnd() * species.length)];
    const def = GIANT_DEFS[type];
    const n = 5 + Math.floor(rnd() * 7);          // 一群 5~11 株
    const cr = 30 + rnd() * 40;                   // 群落半徑
    const base = 0.75 + rnd() * 0.35;             // 群落基準體格
    let added = 0;
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2, d = k === 0 ? 0 : 8 + rnd() * cr;
      const gx = x + Math.cos(a) * d, gz = z + Math.sin(a) * d;
      if (blocked.has(cellKey(gx, gz))) continue;
      const gy = terrain.heightAt(gx, gz);
      if (gy < 0.4) continue;
      const s = base * (0.72 + rnd() * 0.63);     // 株高變異:約 46~165m
      (items[type] ??= []).push({
        x: gx, y: gy, z: gz, s,
        ry: rnd() * Math.PI * 2,
        tx: (rnd() - 0.5) * 0.05, tz: (rnd() - 0.5) * 0.05,
      });
      blockers.push({ x: gx, z: gz, y: gy - 1, r: def.r * s + 0.6, h: def.h * s + 1 });
      blocked.add(cellKey(gx, gz));               // 小植被/地被不長進樹幹
      // 巨木表面特徵:掛在樹幹側面(幹半徑隨高度收窄),世界尺寸與樹齡脫鉤
      const trunkR = (yy) => def.r * s * (1 - 0.72 * yy / (def.h * s));
      const hang = (dtype, frac, ds) => {
        const ha = rnd() * Math.PI * 2;
        const hy = def.h * s * frac;
        const rr = trunkR(hy) + 0.3;
        (items[dtype] ??= []).push({
          x: gx + Math.cos(ha) * rr, y: gy + hy, z: gz + Math.sin(ha) * rr,
          s: ds, ry: rnd() * Math.PI * 2,
        });
      };
      // 掛載高度停在樹冠底緣以下(各樹種冠層約自 40% 樹高起),特徵才不被樹冠吞掉
      if (rnd() < 0.4) hang('gnest', 0.28 + rnd() * 0.14, 0.9 + rnd() * 0.7);
      if (rnd() < 0.2) hang('treehouse', 0.16 + rnd() * 0.14, 0.9 + rnd() * 0.4);
      const nEp = Math.floor(rnd() * 3);
      for (let e = 0; e < nEp; e++) hang('epiphyte', 0.12 + rnd() * 0.28, 0.8 + rnd() * 0.8);
      if (rnd() < 0.5) hang('vine', 0.38 + rnd() * 0.12, 0.8 + rnd() * 0.6);
      added++; trees++;
    }
    if (added) centers.push([x, z]);
  }
  return trees;
}

// ---- Quaternius Ultimate Stylized Nature(CC0)植被插槽 ----
// 下載自 quaternius.com(gltf + bin + 貼圖,法線圖已剝除);
// 載入失敗自動退回上面 VEG_DEFS 的程序生成版本,不開天窗。
const NATURE_DIR = 'assets/models/quaternius/nature/';
// h = 基準高(m):GLB 植被同步吃超尺度(比現實高大;put() 的 VEG_SCALE 已含在 s)
const NATURE_MANIFEST = {
  broadleaf:   { files: ['MapleTree_1.gltf', 'MapleTree_2.gltf', 'MapleTree_3.gltf'], h: 8 },
  birch:       { files: ['BirchTree_1.gltf', 'BirchTree_2.gltf'], h: 8.5 },
  shrub:       { files: ['Bush.gltf', 'Bush_Large.gltf', 'Bush_Small_Flowers.gltf'], h: 1.8 },
  silvergrass: { files: ['Grass_Large.gltf', 'Grass_Small.gltf'], h: 1.2 },
  deadtree:    { files: ['DeadTree_1.gltf', 'DeadTree_2.gltf'], h: 6.5 },
};
// 葉片的季節色偏(乘在貼圖上;樹幹不動)
const SEASON_LEAF_TINT = { spring: 0xd9ffd0, summer: 0xffffff, autumn: 0xffab5e, winter: 0xc9d6da };

/** gltf → 正規化零件(高度=1、底部貼地),材質轉 toon 並保留貼圖 */
function extractNatureParts(gltf, season) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const h = Math.max(0.01, box.max.y - box.min.y);
  const norm = new THREE.Matrix4()
    .makeScale(1 / h, 1 / h, 1 / h)
    .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(norm, o.matrixWorld));
    const src = Array.isArray(o.material) ? o.material[0] : o.material;
    const mat = new THREE.MeshToonMaterial({
      color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
      map: src.map || null,
      gradientMap: toonGradient(),
    });
    if (src.map) { mat.alphaTest = 0.5; mat.side = THREE.DoubleSide; }   // 葉片鏤空貼圖
    if (/leaves|grass|flower|bush/i.test(`${src.name} ${o.name} ${src.map?.name || ''}`)) {
      mat.color.multiply(new THREE.Color(SEASON_LEAF_TINT[season] ?? 0xffffff));
    }
    parts.push({ geo, mat });
  });
  return parts;
}

/** 併發載入 manifest 植被模型;個別失敗只是該類型退回程序生成 */
async function loadNatureModels(season) {
  const loader = new GLTFLoader();
  const out = {};
  await Promise.all(Object.entries(NATURE_MANIFEST).map(async ([type, def]) => {
    const slots = new Array(def.files.length).fill(null);   // 保持檔案順序:全房間變體分配一致
    await Promise.all(def.files.map(async (f, i) => {
      try {
        const gltf = await loader.loadAsync(NATURE_DIR + f);
        const parts = extractNatureParts(gltf, season);
        if (parts.length) slots[i] = { parts };
      } catch (e) {
        console.warn(`植被模型載入失敗(退回程序生成):${f}`, e.message);
      }
    }));
    const variants = slots.filter(Boolean);
    if (variants.length) out[type] = { variants, h: def.h };
  }));
  return out;
}

/** GLB 植被 → InstancedMesh(變體以 i % n 決定性分配;實例色/傾斜差異化同程序生成版) */
function buildVegMeshesGlb(entry, items) {
  const meshes = [];
  const groups = entry.variants.map(() => []);
  items.forEach((it, i) => groups[i % entry.variants.length].push([it, i]));
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const P = new THREE.Vector3(), S = new THREE.Vector3();
  const tint = new THREE.Color();
  groups.forEach((list, vi) => {
    if (!list.length) return;
    for (const part of entry.variants[vi].parts) {
      const m = new THREE.InstancedMesh(part.geo, part.mat, list.length);
      list.forEach(([it, gi], k) => {
        E.set(it.tx || 0, it.ry, it.tz || 0);
        Q.setFromEuler(E);
        P.set(it.x, it.y, it.z);
        const sc = it.s * entry.h;
        S.set(sc, sc, sc);
        M.compose(P, Q, S);
        m.setMatrixAt(k, M);
        const j1 = ((gi * 2654435761) >>> 0) % 100 / 100;
        const j2 = ((gi * 1597334677) >>> 0) % 100 / 100;
        const j3 = ((gi * 3812015801) >>> 0) % 100 / 100;
        tint.setRGB(0.82 + j1 * 0.32, 0.82 + j2 * 0.32, 0.82 + j3 * 0.32);
        m.setColorAt(k, tint);
      });
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.castShadow = false;
      m.frustumCulled = false;
      meshes.push(m);
    }
  });
  return meshes;
}

function seasonColor(key, fixed, season) {
  const s = ENV.seasons[season] || ENV.seasons.summer;
  if (key === 'foliage') return s.foliage;
  if (key === 'grass') return s.grass;
  if (key === 'conifer') return season === 'winter' ? 0x8fa89a : 0x2f6b34;
  return fixed ?? 0x777777;
}

/** 把某類植被的所有實例組成 InstancedMesh(每 part 一個 draw call) */
function buildVegMeshes(type, items, season) {
  const def = VEG_DEFS[type] || GIANT_DEFS[type] || GIANT_DECO[type];
  const meshes = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const P = new THREE.Vector3(), S = new THREE.Vector3();
  const tint = new THREE.Color();
  for (const part of def.parts) {
    // 日漫賽璐璐渲染(4 階 toon 漸層,取代寫實 PBR)
    const mat = toonMat(seasonColor(part.key, part.c, season));
    const m = new THREE.InstancedMesh(part.g, mat, items.length);
    items.forEach((it, i) => {
      // 微傾斜(每棵站姿不同)+ 零件自身傾角(神木枝幹斜出)
      E.set((it.tx || 0) + (part.rx || 0), it.ry, (it.tz || 0) + (part.rz || 0));
      Q.setFromEuler(E);
      // 零件距軸心偏移(px/pz)隨整棵樹的朝向 ry 旋轉
      const px = part.px || 0, pz = part.pz || 0;
      const ca = Math.cos(it.ry), sa = Math.sin(it.ry);
      P.set(it.x + (px * ca + pz * sa) * it.s, it.y + part.y * it.s, it.z + (-px * sa + pz * ca) * it.s);
      S.set(it.s, it.s * (part.sy || 1), it.s);
      M.compose(P, Q, S);
      m.setMatrixAt(i, M);
      // 每實例隨機差異化:RGB 各自抖動 = 明度 + 色相同時變化,不像複製貼上
      const j1 = ((i * 2654435761) >>> 0) % 100 / 100;
      const j2 = ((i * 1597334677) >>> 0) % 100 / 100;
      const j3 = ((i * 3812015801) >>> 0) % 100 / 100;
      tint.setRGB(0.82 + j1 * 0.32, 0.82 + j2 * 0.32, 0.82 + j3 * 0.32);
      m.setColorAt(i, tint);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.castShadow = false;
    m.frustumCulled = false;   // 實例散佈全圖,包圍球不可靠
    meshes.push(m);
  }
  return meshes;
}

// ---- 建物(特殊地標 = 小 Group;住宅/商辦 = InstancedMesh)----
function bmat(color, opts = {}) {
  // 建物走環境賽璐璐:低頻水彩 wash 打破大立面單色 + 冷藍陰影(botw_plan Task 2.1/3.1)
  return envMat(color, { wash: 0.4, cool: 0.45, ...opts });
}
function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bmat(color));
  m.position.set(x, y + h / 2, z);
  return m;
}

// ---- 立面窗格貼圖(賽璐璐「畫上去的窗」;取代單一色塊)----
// 底色畫白 → 與材質 color / setColorAt 相乘 = 同貼圖多種外牆色。
// emissiveMap 只畫「亮著的窗」,夜間配 emissive 暖光 = 萬家燈火。
// 固定種子:全房間(乃至每次載入)同一張貼圖,不吃共享 rnd 的呼叫序。
const _facadeCache = new Map();
// style:'plain' 標準窗格 | 'curtain' 玻璃帷幕(整格寬窗)| 'balcony' 每層陽台帶 |
//       'shop' 底層店面(彩色遮陽棚 + 亮櫥窗)
function facadeTex(key, cols, rows, winC, litRatio, style = 'plain') {
  if (_facadeCache.has(key)) return _facadeCache.get(key);
  const W = 128, H = 256;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d');
  const em = document.createElement('canvas'); em.width = W; em.height = H;
  const ex = em.getContext('2d');
  cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, W, H);
  cx.fillStyle = 'rgba(0,0,0,0.18)'; cx.fillRect(0, H - 14, W, 14);      // 底層基座暗帶
  ex.fillStyle = '#000000'; ex.fillRect(0, 0, W, H);
  const rnd = mulberry32(0xFACADE ^ (cols * 131 + rows * 7));
  const cw = W / cols, ch = (H - 26) / rows;                             // 頂部留女兒牆帶
  // 窗格幾何依樣式:[x偏,y偏,寬,高](格內比例);帷幕窗近乎滿格
  const [ox, oy, fw, fh] = style === 'curtain' ? [0.07, 0.2, 0.86, 0.62] : [0.24, 0.28, 0.52, 0.48];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw + cw * ox, y = 12 + r * ch + ch * oy;
      const w = cw * fw, h = ch * fh;
      cx.fillStyle = winC; cx.fillRect(x, y, w, h);
      cx.fillStyle = 'rgba(255,255,255,0.35)'; cx.fillRect(x, y, w, h * 0.2);   // 窗玻璃高光帶
      if (rnd() < litRatio) { ex.fillStyle = '#ffb45e'; ex.fillRect(x, y, w, h); }
    }
    if (style === 'balcony') {                                           // 每層窗下的陽台欄板帶
      const by = 12 + r * ch + ch * (oy + fh);
      cx.fillStyle = 'rgba(0,0,0,0.14)'; cx.fillRect(cw * 0.06, by, W - cw * 0.12, ch * 0.16);
      cx.fillStyle = 'rgba(255,255,255,0.3)'; cx.fillRect(cw * 0.06, by, W - cw * 0.12, 1.5);
    }
  }
  if (style === 'shop') {                                                // 底層店面:遮陽棚 + 櫥窗
    const awn = ['#c25c4a', '#3f7a8c', '#c7a13d', '#5c8a52'];
    for (let c = 0; c < cols; c++) {
      const x = c * cw + cw * 0.12;
      cx.fillStyle = awn[Math.floor(rnd() * awn.length)];
      cx.fillRect(x, H - 34, cw * 0.76, 8);
      cx.fillStyle = '#2c343c'; cx.fillRect(x + cw * 0.06, H - 25, cw * 0.64, 11);
      if (rnd() < 0.7) { ex.fillStyle = '#ffd9a0'; ex.fillRect(x + cw * 0.06, H - 25, cw * 0.64, 11); }
    }
  }
  const mk = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;   // 硬邊窗格 = 漫畫筆觸
    return t;
  };
  const out = { map: mk(cv), emissiveMap: mk(em) };
  _facadeCache.set(key, out);
  return out;
}

// 一般建物外牆色盤(setColorAt 相乘;暖灰住宅 vs 冷色玻璃帷幕,
// 2026-07-10 擴充:磚紅/陶土/奶油黃/灰綠/粉藍/米白、青玻璃/藍紫/綠玻璃/石墨)
const PALETTE = {
  residential: [0xc4b8a8, 0xb0a494, 0xccc0b4, 0xa8b0ac, 0xc8b09a, 0xb8ac9c,
                0xc99a7e, 0xb3766a, 0xd6c48e, 0x9db3a4, 0xa9b8c8, 0xd8cfc4],
  commercial:  [0x7a92a4, 0x6a8294, 0x8aa0b0, 0x9aa8b0, 0x708898, 0x84909c,
                0x5f7d8c, 0x7f96b2, 0x6e8a7a, 0x8d95ac, 0x9fb4bd, 0x63707e],
};

// 立面樣式變體:同類建物分三款(窗格節奏/窗色/亮燈率/樣式/屋頂色),
// 街景擺脫「同一張貼圖複製貼上」;v 在建物生成時決定性分配
const FACADES = {
  residential: [
    { key: 'res0', cols: 5, rows: 7, winC: '#3a4046', lit: 0.3,  style: 'shop',    roof: 0x9c8e7c },
    { key: 'res1', cols: 4, rows: 6, winC: '#46525e', lit: 0.22, style: 'balcony', roof: 0x8a6f5a },
    { key: 'res2', cols: 6, rows: 8, winC: '#333b42', lit: 0.36, style: 'plain',   roof: 0x7a8577 },
  ],
  commercial: [
    { key: 'com0', cols: 7, rows: 13, winC: '#2e3c4a', lit: 0.55, style: 'plain',   roof: 0x707c88 },
    { key: 'com1', cols: 9, rows: 16, winC: '#243240', lit: 0.68, style: 'curtain', roof: 0x5c6874 },
    { key: 'com2', cols: 6, rows: 11, winC: '#35424e', lit: 0.45, style: 'shop',    roof: 0x86766a },
  ],
};

// 地標近似碰撞柱(未縮放;放置時 × lm scale)
const LANDMARK_COL = {
  hospital: { r: 11, h: 22 }, school: { r: 13, h: 11 }, station: { r: 14, h: 13 },
  temple: { r: 8, h: 13 }, church: { r: 9, h: 19 }, mosque: { r: 10, h: 14 },
  museum: { r: 12, h: 12 }, power: { r: 2.6, h: 42 }, factory: { r: 13, h: 12 },
};

const LANDMARKS = {
  hospital: (g) => {
    const f = facadeTex('hosp', 6, 6, '#46525c', 0.3);
    const main = box(16, 18, 12, 0xe8e4dc); main.material.map = f.map; g.add(main);
    g.add(box(10, 10, 10, 0xdcd8cc, 12, 0, 2));                 // 側翼
    g.add(box(6, 3, 3, 0xcfc8b8, 0, 0, 7));                     // 急診入口雨庇
    g.add(box(1.6, 5, 0.6, 0xd93a2b, 0, 18.2, 6.0));            // 紅十字(直)
    g.add(box(5, 1.6, 0.6, 0xd93a2b, 0, 19.9, 6.0));            //        (橫)
    const pad = new THREE.Mesh(cyl(4.5, 4.5, 0.5, 12), bmat(0x5a6068));
    pad.position.set(0, 18.4, -1); g.add(pad);                  // 屋頂直升機坪
    const hMark = new THREE.Mesh(cyl(2.6, 2.6, 0.2, 12), bmat(0xe8e4dc));
    hMark.position.set(0, 18.7, -1); g.add(hMark);
  },
  school: (g) => {
    const f = facadeTex('school', 8, 3, '#4a5058', 0.2);
    const main = box(22, 9, 8, 0xd9c9a8); main.material.map = f.map; g.add(main);
    const wing = box(8, 9, 8, 0xd9c9a8, 10, 0, 8); wing.material.map = f.map; g.add(wing);
    g.add(box(23, 1, 9, 0xb89a78, 0, 9, 0));                    // 屋簷
    const clock = new THREE.Mesh(cyl(1.1, 1.1, 0.4, 12), bmat(0xf4f0e6));
    clock.rotation.x = Math.PI / 2; clock.position.set(0, 7, 4.2); g.add(clock);
    const pole = new THREE.Mesh(cyl(0.12, 0.12, 12, 6), bmat(0x9aa2a8));
    pole.position.set(-8, 6, 8); g.add(pole);
    g.add(box(1.4, 0.9, 0.06, 0xd93a2b, -7.2, 11, 8));          // 旗
    for (const s of [-1, 1]) g.add(box(1, 2.6, 1, 0xb0a898, s * 4, 0, 9));   // 校門柱
  },
  station: (g) => {
    const f = facadeTex('station', 9, 2, '#3c4854', 0.45);
    const main = box(26, 7, 12, 0xb8bfc4); main.material.map = f.map; g.add(main);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 26, 10, 1, false, 0, Math.PI), bmat(0x6f8a99));
    roof.rotation.z = Math.PI / 2; roof.position.y = 7; g.add(roof);
    const clock = new THREE.Mesh(cyl(1.3, 1.3, 0.4, 12), bmat(0xf4f0e6));
    clock.rotation.x = Math.PI / 2; clock.position.set(0, 9.5, 6.1); g.add(clock);
    g.add(box(20, 0.4, 6, 0x8a9298, 0, 4.6, 10));               // 月台雨棚
    for (const sx of [-8, 0, 8]) g.add(box(0.4, 4.6, 0.4, 0x6a7278, sx, 0, 12));
    g.add(box(5, 3.4, 0.5, 0x2e3840, 0, 0, 6.1));               // 大門
  },
  temple: (g) => {
    g.add(box(13, 1.2, 11, 0xb0a494));                          // 石台基
    g.add(box(12, 6, 10, 0xc9563a, 0, 1.2, 0));
    for (const [sx, sz] of [[-5, 4.4], [5, 4.4], [-5, -4.4], [5, -4.4]]) {
      const col = new THREE.Mesh(cyl(0.4, 0.4, 6, 8), bmat(0x8a3324));
      col.position.set(sx, 4.2, sz); g.add(col);                // 廊柱
    }
    const r1 = new THREE.Mesh(cone(9.5, 3.4, 4), bmat(0x2e5a46)); r1.position.y = 8.9; r1.rotation.y = Math.PI / 4; g.add(r1);
    const r2 = new THREE.Mesh(cone(6.5, 2.8, 4), bmat(0x2e5a46)); r2.position.y = 12.2; r2.rotation.y = Math.PI / 4; g.add(r2);
    g.add(box(1.4, 0.8, 0.8, 0xc7a13d, 0, 13.6, 0));            // 脊飾
    for (const s of [-1, 1]) {                                  // 燈籠(夜裡也亮)
      const lan = new THREE.Mesh(cyl(0.5, 0.6, 1.0, 8),
        bmat(0xe8a03c, { emissive: new THREE.Color(0x8a4a10), emissiveIntensity: 0.8 }));
      lan.position.set(s * 4, 3.4, 5.6); g.add(lan);
    }
  },
  church: (g) => {
    const f = facadeTex('church', 3, 3, '#4e5a66', 0.15);
    const nave = box(10, 9, 16, 0xd8d2c4); nave.material.map = f.map; g.add(nave);
    for (const s of [-1, 1]) for (const z of [-3, 3]) g.add(box(1.2, 6, 1.6, 0xc8c2b4, s * 5.2, 0, z));   // 扶壁
    const gable = new THREE.Mesh(cone(7.2, 4, 4), bmat(0x8a6a4a));
    gable.rotation.y = Math.PI / 4; gable.scale.x = 0.72; gable.position.set(0, 11, 0); g.add(gable);     // 斜屋頂
    g.add(box(4.5, 17, 4.5, 0xd8d2c4, 0, 0, -8));               // 鐘塔
    const spire = new THREE.Mesh(cone(3.4, 5, 4), bmat(0x6a7a88));
    spire.rotation.y = Math.PI / 4; spire.position.set(0, 19.4, -8); g.add(spire);
    const rose = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.3, 6, 12),
      bmat(0x4a6a9a, { emissive: new THREE.Color(0x1a3a6a), emissiveIntensity: 0.5 }));
    rose.position.set(0, 6.5, 8.1); g.add(rose);                // 玫瑰窗
    g.add(box(0.5, 3, 0.5, 0xc7a13d, 0, 21.8, -8));             // 十字架
    g.add(box(1.8, 0.5, 0.5, 0xc7a13d, 0, 23.4, -8));
    g.add(box(2.6, 4, 0.4, 0x5a4a3a, 0, 0, 8.1));               // 木門
  },
  mosque: (g) => {
    const f = facadeTex('mosque', 5, 2, '#5a6a6a', 0.2);
    const main = box(14, 8, 14, 0xe6ded0); main.material.map = f.map; g.add(main);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(5.4, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), bmat(0x3f8f7a));
    dome.position.y = 8; g.add(dome);
    const crest = new THREE.Mesh(cyl(0.12, 0.12, 1.8, 6), bmat(0xc7a13d));
    crest.position.y = 14; g.add(crest);                        // 新月桿
    for (const [sx, sz] of [[9.5, 9.5], [-9.5, 9.5]]) {         // 對稱雙宣禮塔
      const mn = new THREE.Mesh(cyl(0.9, 1.1, 18, 8), bmat(0xe6ded0)); mn.position.set(sx, 9, sz); g.add(mn);
      const gal = new THREE.Mesh(cyl(1.4, 1.4, 0.6, 8), bmat(0xd8cfc0)); gal.position.set(sx, 15.5, sz); g.add(gal);
      const mt = new THREE.Mesh(cone(1.3, 2.6, 8), bmat(0x3f8f7a)); mt.position.set(sx, 19.3, sz); g.add(mt);
    }
    for (const s of [-1, 1]) {                                  // 側頂小圓頂
      const sd = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), bmat(0x3f8f7a));
      sd.position.set(s * 5.2, 8, -5); g.add(sd);
    }
    g.add(box(3.4, 5, 0.5, 0x8a7a5a, 0, 0, 7.1));               // 拱門(方形近似)
  },
  museum: (g) => {
    g.add(box(22, 1.4, 16, 0xb8b0a0));                          // 台階基座
    g.add(box(20, 8, 14, 0xcfc8b8, 0, 1.4, 0));
    for (let i = -2; i <= 2; i++) {
      const col = new THREE.Mesh(cyl(0.55, 0.55, 7, 8), bmat(0xe3dccb));
      col.position.set(i * 3.6, 4.9, 7.6); g.add(col);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.4), bmat(0xe3dccb));
      cap.position.set(i * 3.6, 8.6, 7.6); g.add(cap);          // 柱頭
    }
    const ped = new THREE.Mesh(cone(11, 3, 3), bmat(0xd8d1c0));
    ped.rotation.y = Math.PI / 2; ped.scale.z = 0.45; ped.position.y = 10.8; g.add(ped);
    g.add(box(3, 5, 0.6, 0xd93a5e, 8.5, 3.2, 7.4));             // 特展直幅
    g.add(box(3, 5, 0.6, 0x3a6ad9, -8.5, 3.2, 7.4));
  },
  power: (g) => {
    const tower = new THREE.Mesh(cyl(0.9, 3.4, 42, 4), bmat(0x8e979e, { wireframe: true }));
    tower.position.y = 21; g.add(tower);
    g.add(box(16, 0.7, 0.7, 0x8e979e, 0, 34, 0));
    g.add(box(11, 0.7, 0.7, 0x8e979e, 0, 38, 0));
    for (const [sx, y] of [[-7, 33], [7, 33], [-4.8, 37], [4.8, 37]]) {   // 礙子串
      const ins = new THREE.Mesh(cyl(0.22, 0.22, 1.6, 6), bmat(0x3a4046));
      ins.position.set(sx, y, 0); g.add(ins);
    }
    const beacon = new THREE.Mesh(ico(0.5), bmat(0xd93a2b, { emissive: new THREE.Color(0x8a1408), emissiveIntensity: 1.4 }));
    beacon.position.y = 42.6; g.add(beacon);                    // 航空警示燈
  },
  factory: (g) => {
    const f = facadeTex('factory', 7, 2, '#3e464e', 0.25);
    const main = box(24, 9, 14, 0x9aa0a4); main.material.map = f.map; g.add(main);
    for (let i = -1; i <= 1; i++) {                             // 鋸齒天窗屋頂
      const saw = new THREE.Mesh(cone(4.2, 3, 4), bmat(0x7c8388));
      saw.rotation.y = Math.PI / 4; saw.scale.z = 1.6; saw.position.set(i * 8, 10.4, 0); g.add(saw);
    }
    const ch1 = new THREE.Mesh(cyl(1.1, 1.4, 16, 8), bmat(0x7c8388)); ch1.position.set(-8, 8, -4); g.add(ch1);
    g.add(box(3.4, 1.2, 3.4, 0xd93a2b, -8, 15.2, -4));          // 煙囪警示環
    const ch2 = new THREE.Mesh(cyl(0.9, 1.2, 12, 8), bmat(0x7c8388)); ch2.position.set(-4.5, 6, -4); g.add(ch2);
    const tank = new THREE.Mesh(cyl(2.6, 2.6, 6, 10), bmat(0xb8bfc4)); tank.position.set(10, 3, -9); g.add(tank);
    const pipe = new THREE.Mesh(cyl(0.3, 0.3, 8, 6), bmat(0x6a7278));
    pipe.rotation.z = Math.PI / 2; pipe.position.set(6, 5.5, -8); g.add(pipe);   // 連通管線
    g.add(box(6, 5, 0.6, 0x4a5058, 4, 0, 7.1));                 // 捲門
  },
};

// ---- 巨岩地標(裸露地;取材世界知名岩體/巨石遺跡)----
// 酋長岩(優勝美地花崗岩壁)/ 烏魯魯(艾爾斯岩)/ 奧古斯都山(單體岩山)/
// 大霸尖山(酒桶狀霸尖)/ 摩艾石像群 / 馬丘比丘梯田遺跡 / 巨石陣。
// 高度範圍對齊超尺度建物(約 26~160m);col = 近似碰撞柱(× s),
// s = 放置縮放區間。岩面走 envMat + 頂部苔蘚投影(botw_plan 岩石要點)。
function rockMat(color, moss = 0) {
  return envMat(color, { wash: 0.6, cool: 0.5, moss: moss ? { amount: moss } : null });
}
const MEGALITHS = {
  elcap: { col: { r: 34, h: 112 }, s: [0.8, 1.4],
    anchor: { topY: 112, topR: 15, side: { y: [30, 95], rx: 28, rz: 17, dome: false } },
    build: (g, rnd) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(52, 112, 30), rockMat(0xc9c4b8, 0.3));
    wall.position.y = 56; wall.rotation.y = 0.06; g.add(wall);            // 主岩壁
    const nose = new THREE.Mesh(new THREE.BoxGeometry(24, 96, 22), rockMat(0xbdb6a8, 0.25));
    nose.position.set(20, 48, 8); nose.rotation.y = 0.5; g.add(nose);     // 鼻樑稜線
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(26, 64, 24), rockMat(0xd2ccbe, 0.35));
    shoulder.position.set(-24, 32, 4); shoulder.rotation.y = -0.35; g.add(shoulder);
    for (let i = 0; i < 4; i++) {                                         // 垂直岩溝墨線
      const streak = new THREE.Mesh(new THREE.BoxGeometry(1.6, 70 + rnd() * 30, 1.2), rockMat(0x8f8a7e));
      streak.position.set(-16 + i * 10 + rnd() * 4, 52, 14.9); g.add(streak);
    }
    const scree = new THREE.Mesh(cone(30, 14, 9), rockMat(0xb5ac9a));
    scree.position.y = 5; scree.scale.z = 0.7; g.add(scree);              // 山腳碎石坡
  } },
  uluru: { col: { r: 62, h: 62 }, s: [1.0, 1.7],
    anchor: { topY: 60, topR: 24, side: { y: [12, 42], rx: 74, rz: 44, dome: true } },
    build: (g, rnd) => {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 12, 8), rockMat(0xb3502e));
    dome.scale.set(1.5, 1.15, 0.9); dome.position.y = 4; g.add(dome);     // 長條圓頂單體岩
    const hump = new THREE.Mesh(new THREE.SphereGeometry(26, 10, 7), rockMat(0xc25c33));
    hump.scale.set(1.2, 0.55, 0.9); hump.position.set(66, 8, 6); g.add(hump);
    for (let i = 0; i < 5; i++) {                                         // 平行侵蝕縱溝
      const rib = new THREE.Mesh(new THREE.BoxGeometry(1.8, 30 + rnd() * 10, 1.4), rockMat(0x8f3c22));
      rib.position.set(-40 + i * 18, 22, 38 + rnd() * 3); rib.rotation.x = 0.55; g.add(rib);
    }
  } },
  augustus: { col: { r: 58, h: 50 }, s: [0.9, 1.6],
    anchor: { topY: 46, topR: 22, side: { y: [8, 34], rx: 76, rz: 47, dome: true } },
    build: (g) => {
    const ridge = new THREE.Mesh(new THREE.SphereGeometry(46, 11, 8), rockMat(0x9a6248, 0.45));
    ridge.scale.set(1.7, 0.95, 1.05); ridge.position.y = 2; g.add(ridge); // 主山脊(帶植被苔蘚)
    const peak = new THREE.Mesh(new THREE.SphereGeometry(24, 9, 7), rockMat(0xa86e50, 0.4));
    peak.scale.set(1.1, 0.9, 0.9); peak.position.set(-30, 26, 0); g.add(peak);
    const toe = new THREE.Mesh(new THREE.SphereGeometry(20, 9, 6), rockMat(0x8f5a42, 0.5));
    toe.scale.set(1.3, 0.6, 1.0); toe.position.set(52, 4, 8); g.add(toe);
  } },
  dabajian: { col: { r: 26, h: 96 }, s: [0.8, 1.5],
    anchor: { topY: 97, topR: 12, side: { y: [34, 86], rx: 20, rz: 20, dome: false } },
    build: (g) => {
    const base = new THREE.Mesh(cone(44, 34, 9), rockMat(0x7d7466, 0.45));
    base.position.y = 17; g.add(base);                                    // 山體基座
    let y = 30;
    for (const [r, hh, cc] of [[20, 14, 0x6f6a62], [21, 4, 0x8a8274], [18.5, 13, 0x6f6a62],
                               [19.5, 4, 0x8a8274], [17, 12, 0x67625a], [18, 4, 0x8a8274],
                               [15.5, 11, 0x6f6a62]]) {
      const stratum = new THREE.Mesh(cyl(r, r + 1.2, hh, 10), rockMat(cc, cc === 0x8a8274 ? 0.15 : 0));
      stratum.position.y = y + hh / 2; y += hh; g.add(stratum);           // 水平岩層(酒桶紋)
    }
    const cap = new THREE.Mesh(cyl(13, 15.5, 5, 10), rockMat(0x7d7466, 0.5));
    cap.position.y = y + 2.5; g.add(cap);                                 // 平坦霸頂
  } },
  moai: { col: { r: 16, h: 34 }, s: [1.0, 1.9],
    anchor: { topY: 3.4, topR: 13, side: null },
    build: (g, rnd) => {
    g.add(box(34, 3.4, 10, 0x7f7868));                                    // 阿胡祭壇石台
    for (let i = 0; i < 4; i++) {
      const s = 0.85 + rnd() * 0.3;
      const m = new THREE.Group();
      const body = new THREE.Mesh(cyl(3.2, 4.2, 14, 7), rockMat(0x8f8878));
      body.position.y = 7; m.add(body);
      const head = new THREE.Mesh(new THREE.BoxGeometry(5.2, 9, 4.6), rockMat(0x968e7c));
      head.position.y = 18.5; m.add(head);
      const nose = new THREE.Mesh(new THREE.BoxGeometry(1.4, 4.5, 1.2), rockMat(0x8a8270));
      nose.position.set(0, 18, 2.6); m.add(nose);                         // 長鼻
      const brow = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.2, 1.4), rockMat(0x7f7868));
      brow.position.set(0, 21.5, 2.2); m.add(brow);                       // 眉脊
      if (rnd() < 0.5) {
        const pukao = new THREE.Mesh(cyl(2.6, 3.0, 3, 8), rockMat(0x9a4a3a));
        pukao.position.y = 24.5; m.add(pukao);                            // 紅色普卡奧髮髻
      }
      m.scale.setScalar(s);
      m.position.set(-12 + i * 8, 3.4, 0);
      m.rotation.y = (rnd() - 0.5) * 0.2;
      g.add(m);
    }
  } },
  machupicchu: { col: { r: 34, h: 44 }, s: [1.0, 1.7],
    anchor: { topY: 35, topR: 11, side: { y: [5, 30], rx: 33, rz: 27, dome: true } },
    build: (g) => {
    let y = 0;
    for (const [w, d] of [[64, 52], [54, 44], [44, 36], [34, 28], [25, 20]]) {
      const tier = new THREE.Mesh(new THREE.BoxGeometry(w, 7, d), rockMat(0x8d8672, 0.55));
      tier.position.y = y + 3.5; g.add(tier);                             // 梯田層(頂面苔蘚投影=草坪)
      y += 7;
    }
    for (let i = 0; i < 3; i++) {                                         // 山頂石屋(疊石牆 + 茅草頂)
      const hx = -8 + i * 8, hz = (i - 1) * 5;
      const hut = new THREE.Mesh(new THREE.BoxGeometry(6, 4.5, 5), rockMat(0x9c9480));
      hut.position.set(hx, y + 2.25, hz); g.add(hut);
      const thatch = new THREE.Mesh(cone(4.4, 3.2, 4), rockMat(0xa9945e));
      thatch.rotation.y = Math.PI / 4; thatch.scale.z = 0.8;
      thatch.position.set(hx, y + 6.1, hz); g.add(thatch);
    }
    const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 5, 18), rockMat(0x968e7a));
    wall.position.set(11, y + 2.5, 0); g.add(wall);                       // 太陽神殿弧牆(直牆近似)
  } },
  stonehenge: { col: { r: 24, h: 27 }, s: [1.1, 2.0],
    anchor: { topY: 0.2, topR: 12, side: null },   // 特徵落在石圈內地面
    build: (g) => {
    for (let i = 0; i < 10; i++) {                                        // 外環立石 + 楣石
      const a = i / 10 * Math.PI * 2, r0 = 19;
      const post = new THREE.Mesh(new THREE.BoxGeometry(4.6, 17, 3), rockMat(0x9b968a, 0.3));
      post.position.set(Math.cos(a) * r0, 8.5, Math.sin(a) * r0);
      post.rotation.y = -a + Math.PI / 2;
      g.add(post);
      if (i % 2 === 0) {
        const am = a + Math.PI / 10;
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(13, 2.8, 3.4), rockMat(0x8f8a7c, 0.4));
        lintel.position.set(Math.cos(am) * r0, 18.4, Math.sin(am) * r0);
        lintel.rotation.y = -am + Math.PI / 2;
        g.add(lintel);
      }
    }
    for (const s of [-1, 1]) {                                            // 內圈大三石塔
      const post = new THREE.Mesh(new THREE.BoxGeometry(4.8, 24, 3.4), rockMat(0xa39e90, 0.25));
      post.position.set(s * 4.5, 12, 0); g.add(post);
    }
    const bigLintel = new THREE.Mesh(new THREE.BoxGeometry(15, 3.2, 4), rockMat(0x9b968a, 0.35));
    bigLintel.position.y = 25.6; g.add(bigLintel);
    const altar = new THREE.Mesh(new THREE.BoxGeometry(6, 1.6, 3), rockMat(0x7f7a6e));
    altar.position.y = 0.8; g.add(altar);
  } },
};

// ---- 巨岩表面特徵:高壓電塔 / 石砌屋 / 疊石堆 / 鳥巢 / 斷崖側樹 ----
// 在岩體 local 座標放置(隨岩體旋轉縮放),特徵自身尺寸 ÷ s 抵銷縮放 →
// 世界尺寸恆定;anchor 描述可放置面(topY/topR 平頂、side 側壁橢圓,
// dome 型側壁半徑隨高度以 √(1-u²) 收縮,樹才貼壁不懸空)。
function decorateMegalith(g, anchor, rnd, s) {
  if (!anchor) return;
  const k = 1 / s;
  const put = (obj, x, y, z, sc = 1) => {
    obj.scale.multiplyScalar(sc * k);
    obj.position.set(x, y, z);
    g.add(obj);
  };
  // 小型特徵不描邊:一顆岩體可掛十餘件,省下反轉殼 draw call
  const noOut = (grp) => { grp.traverse((o) => { if (o.isMesh) o.userData.noOutline = true; }); return grp; };
  const nest = () => {   // 鳥巢:枝條環 + 蛋 + 停棲的鳥
    const n = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.3, 5, 8), toonMat(0x6a5138));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.15; n.add(ring);
    for (let e = 0; e < 3; e++) {
      const egg = new THREE.Mesh(ico(0.2), toonMat(0xf2ead6));
      egg.position.set((rnd() - 0.5) * 0.6, 0.22, (rnd() - 0.5) * 0.6);
      n.add(egg);
    }
    if (rnd() < 0.5) {
      const bird = new THREE.Mesh(cone(0.3, 0.8, 4), toonMat(0x4a586a));
      bird.position.set(0.7, 0.5, 0); bird.rotation.z = -0.4; n.add(bird);
    }
    return noOut(n);
  };
  const stoneHut = () => {   // 石砌屋:石牆 + 石板頂 + 煙囪 + 木門
    const hg = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 3, 3.4), rockMat(0x9c9480));
    body.position.y = 1.5; hg.add(body);
    const roof = new THREE.Mesh(cone(3.3, 2.4, 4), rockMat(0x6e5a44));
    roof.rotation.y = Math.PI / 4; roof.scale.z = 0.8; roof.position.y = 4.2; hg.add(roof);
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.7, 0.7), rockMat(0x8a8274));
    chimney.position.set(1.2, 4.5, 0.6); hg.add(chimney);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.8, 0.2), toonMat(0x4a3a2a));
    door.position.set(0, 0.9, 1.75); hg.add(door);
    return hg;
  };
  const cairn = () => {   // 疊石堆(登頂紀念)
    const cg = new THREE.Group();
    let y = 0;
    for (const r of [0.9, 0.68, 0.48, 0.3]) {
      const st = new THREE.Mesh(ico(r), rockMat(0x8f8a80));
      st.scale.y = 0.7; y += r * 0.72; st.position.y = y; y += r * 0.42;
      cg.add(st);
    }
    return noOut(cg);
  };
  const cliffTree = () => {   // 斷崖側樹:自岩縫斜出的針葉小樹
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(cyl(0.28, 0.5, 5, 5), toonMat(0x6b4a30));
    trunk.position.y = 2.5; t.add(trunk);
    const c1 = new THREE.Mesh(cone(1.9, 3.4, 6), toonMat(0x2f5e40));
    c1.position.y = 5.6; t.add(c1);
    const c2 = new THREE.Mesh(cone(1.3, 2.6, 6), toonMat(0x35684a));
    c2.position.y = 7.6; t.add(c2);
    return t;
  };

  const topWorldY = anchor.topY * s;
  if (anchor.topR >= 8 && topWorldY > 45 && rnd() < 0.5) {   // 高壓電塔:夠高的平頂才架線
    const pylon = new THREE.Group();
    LANDMARKS.power(pylon);
    put(pylon, (rnd() - 0.5) * anchor.topR * 0.4, anchor.topY - 1, (rnd() - 0.5) * anchor.topR * 0.4, 0.55 + rnd() * 0.25);
  }
  if (anchor.topR >= 5 && rnd() < 0.7) {                     // 石砌屋 1~2 間
    const n = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const h = stoneHut();
      h.rotation.y = rnd() * Math.PI * 2;
      put(h, (rnd() - 0.5) * anchor.topR, anchor.topY - 0.3, (rnd() - 0.5) * anchor.topR, 0.9 + rnd() * 0.5);
    }
  }
  if (rnd() < 0.7) {                                         // 疊石堆
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      put(cairn(), (rnd() - 0.5) * anchor.topR * 1.2, anchor.topY - 0.2, (rnd() - 0.5) * anchor.topR * 1.2, 1 + rnd() * 0.8);
    }
  }
  {                                                          // 鳥巢(頂緣)
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      put(nest(), Math.cos(a) * anchor.topR * 0.8, anchor.topY - 0.1, Math.sin(a) * anchor.topR * 0.8, 1 + rnd() * 0.8);
    }
  }
  if (anchor.side) {                                         // 斷崖側邊長樹
    const sd = anchor.side;
    const n = 2 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const y = sd.y[0] + rnd() * (sd.y[1] - sd.y[0]);
      const f = sd.dome ? Math.sqrt(Math.max(0.08, 1 - (y / Math.max(1, anchor.topY)) ** 2)) : 1;
      const er = (sd.rx * sd.rz) / Math.hypot(sd.rz * Math.cos(a), sd.rx * Math.sin(a));   // 橢圓邊界半徑
      const t = cliffTree();
      t.rotation.set(0, -a, -(0.9 + rnd() * 0.5));   // XYZ 序:先 Z 傾斜再 Y 轉向方位 → 朝壁外斜出
      put(t, Math.cos(a) * er * f * 0.99, y, Math.sin(a) * er * f * 0.99, 0.8 + rnd() * 0.8);
    }
  }
}

// ---- 合成巨岩:抽組名岩「特徵基因」隨機重組,每顆獨一無二 ----
// 主體(圓頂=烏魯魯系/岩壁=酋長岩系/岩層塔=大霸系/尖峰)× 伴生小圓丘 ×
// 侵蝕溝 × 碎石坡 × 岩色系;回傳 col/anchor 供放置檢查與表面特徵。
const ROCK_TONES = [0xb3502e, 0xc9c4b8, 0x9a6248, 0x6f6a62, 0xa8875c, 0x8f8878];
function synthMegalith(g, rnd) {
  const base = new THREE.Color(ROCK_TONES[Math.floor(rnd() * ROCK_TONES.length)]);
  const shade = (dl) => base.clone().offsetHSL(0, 0, dl).getHex();
  const moss = rnd() < 0.55 ? 0.2 + rnd() * 0.35 : 0;
  const kinds = ['dome', 'slab', 'tower', 'spire'];
  const main = kinds[Math.floor(rnd() * kinds.length)];
  let H = 0, RX = 0, RZ = 0, topR = 6, dome = false;
  if (main === 'dome') {
    const r = 28 + rnd() * 26, sx = 1.1 + rnd() * 0.7, sy = 0.7 + rnd() * 0.55, sz = 0.8 + rnd() * 0.3;
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 11, 8), rockMat(shade(0), moss));
    m.scale.set(sx, sy, sz); m.position.y = 3; g.add(m);
    H = 3 + r * sy; RX = r * sx; RZ = r * sz; topR = Math.min(RX, RZ) * 0.35; dome = true;
  } else if (main === 'slab') {
    const w = 30 + rnd() * 26, h = 70 + rnd() * 50, d = 16 + rnd() * 12;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rockMat(shade(0), moss));
    m.position.y = h / 2; m.rotation.y = (rnd() - 0.5) * 0.2; g.add(m);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(w * 0.45, h * 0.8, d * 0.8), rockMat(shade(0.04), moss));
    nose.position.set(w * 0.36, h * 0.4, d * 0.2); nose.rotation.y = 0.45; g.add(nose);
    H = h; RX = w * 0.62; RZ = d * 0.8; topR = Math.min(w, d) * 0.32;
  } else if (main === 'tower') {
    const r0 = 17 + rnd() * 8, bh = 24 + rnd() * 14;
    const baseC = new THREE.Mesh(cone(r0 * 2.2, bh, 9), rockMat(shade(0.03), 0.35));
    baseC.position.y = bh / 2; g.add(baseC);
    let y = bh * 0.85, r = r0;
    const nL = 5 + Math.floor(rnd() * 3);
    for (let i = 0; i < nL; i++) {
      const band = i % 2 === 1, hh = band ? 3.5 : 9 + rnd() * 5;
      const st = new THREE.Mesh(cyl(r * (band ? 1.06 : 1), r * (band ? 1.06 : 1) + 1, hh, 10),
        rockMat(shade(band ? 0.06 : -0.03), band ? 0.12 : 0));
      st.position.y = y + hh / 2; y += hh; g.add(st);
      if (!band) r *= 0.92;
    }
    H = y; RX = RZ = r0 * 1.1; topR = r * 0.85;
  } else {   // spire 尖峰
    const r0 = 20 + rnd() * 10, h = 80 + rnd() * 45;
    const m = new THREE.Mesh(cone(r0, h, 8), rockMat(shade(0), moss));
    m.position.y = h / 2; g.add(m);
    const m2 = new THREE.Mesh(cone(r0 * 0.6, h * 0.6, 7), rockMat(shade(0.05), moss));
    m2.position.set(r0 * 0.8, h * 0.3, 0); g.add(m2);
    H = h; RX = r0 * 1.5; RZ = r0 * 1.1; topR = 3;
  }
  const nSub = Math.floor(rnd() * 3);   // 伴生小圓丘
  for (let i = 0; i < nSub; i++) {
    const r = 10 + rnd() * 14, a = rnd() * Math.PI * 2, d = Math.max(RX, RZ) * (0.9 + rnd() * 0.3);
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 9, 7), rockMat(shade((rnd() - 0.5) * 0.08), moss * 0.8));
    m.scale.set(1.2, 0.6 + rnd() * 0.3, 1);
    m.position.set(Math.cos(a) * d, 4, Math.sin(a) * d);
    g.add(m);
    RX = Math.max(RX, Math.abs(Math.cos(a) * d) + r * 1.2);
    RZ = Math.max(RZ, Math.abs(Math.sin(a) * d) + r);
  }
  if (rnd() < 0.6) {   // 侵蝕溝墨線
    const n = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(1.6, H * (0.3 + rnd() * 0.4), 1.3), rockMat(shade(-0.1)));
      const a = rnd() * Math.PI * 2, f = dome ? 0.8 : 0.96;
      rib.position.set(Math.cos(a) * RX * f, H * (0.25 + rnd() * 0.3), Math.sin(a) * RZ * f);
      rib.rotation.y = -a;
      rib.rotation.x = dome ? 0.4 : 0;
      g.add(rib);
    }
  }
  if (rnd() < 0.5) {   // 碎石坡
    const scree = new THREE.Mesh(cone(Math.max(RX, RZ) * 0.8, 10 + rnd() * 8, 9), rockMat(shade(0.06)));
    scree.position.y = 5; scree.scale.z = 0.7; g.add(scree);
  }
  return {
    col: { r: Math.max(RX, RZ) + 4, h: H },
    anchor: { topY: H, topR, side: { y: [H * 0.22, H * 0.8], rx: RX, rz: RZ, dome } },
  };
}

/** 裸露地巨岩地標:名岩輪替 + 合成巨岩;footprint 整圓淨空後放置,登記碰撞柱 */
function placeMegaliths({ group, terrain, blocked, blockers, rnd, sites }) {
  const types = Object.keys(MEGALITHS);
  const start = Math.floor(rnd() * types.length);   // 每張圖不同起點,依序輪替求多樣
  const placedM = [];
  let named = 0;
  for (const [x, z] of sites) {
    if (placedM.length >= 12) break;
    // 約四成抽合成巨岩(先建再驗:淘汰只是丟棄未進場景的 Group,rnd 序全房一致)
    const synth = rnd() < 0.4;
    const g = new THREE.Group();
    let meta, s;
    if (synth) {
      meta = synthMegalith(g, rnd);
      s = 0.9 + rnd() * 0.5;
    } else {
      const def = MEGALITHS[types[(start + named) % types.length]];
      def.build(g, rnd);
      meta = def;
      s = def.s[0] + rnd() * (def.s[1] - def.s[0]);
    }
    const r = meta.col.r * s;
    if (x < terrain.minX + r + 24 || x > terrain.maxX - r - 24
      || z < terrain.minZ + r + 24 || z > terrain.maxZ - r - 24) continue;
    const gy = terrain.heightAt(x, z);
    if (gy < 0.4) continue;
    if (!areaFree(blocked, x, z, r + 6)) continue;
    if (placedM.some((p) => Math.hypot(x - p.x, z - p.z) < r + p.r + 70)) continue;
    if (!synth) named++;
    decorateMegalith(g, meta.anchor, rnd, s);
    bakeContactAO(g, 6);   // 接地 AO:巨岩「長」在地上(botw_plan Task 2.2)
    g.scale.setScalar(s);
    g.position.set(x, gy - 1.5, z);
    g.rotation.y = rnd() * Math.PI * 2;
    group.add(g);
    blockArea(blocked, x, z, r);   // 植被/地被/建物自動避開整個岩體
    blockers.push({ x, z, y: gy - 2, r: r * 0.85, h: meta.col.h * s + 2 });
    placedM.push({ x, z, r });
  }
  return placedM.length;
}

/** OSM tags → 建物類型 */
function buildingType(tags) {
  const b = tags.building, a = tags.amenity;
  if (a === 'hospital' || b === 'hospital') return 'hospital';
  if (a === 'school' || a === 'university' || a === 'college' || b === 'school' || b === 'university') return 'school';
  if (b === 'train_station' || tags.railway === 'station' || a === 'bus_station') return 'station';
  if (a === 'place_of_worship') {
    const r = tags.religion;
    if (r === 'muslim') return 'mosque';
    if (r === 'christian') return 'church';
    return 'temple';
  }
  if (tags.tourism === 'museum' || b === 'museum') return 'museum';
  if (tags.power === 'tower') return 'power';
  if (b === 'industrial' || b === 'factory' || b === 'warehouse') return 'factory';
  if (b === 'commercial' || b === 'office' || b === 'retail' || b === 'hotel' || b === 'apartments' && (+tags['building:levels'] || 0) >= 10) return 'commercial';
  return 'residential';
}

function buildingHeight(tags, type, rnd) {
  const real = parseFloat(tags.height) || (+tags['building:levels'] || 0) * 3.2;
  const h = real > 3 ? Math.min(real, 120) : (type === 'commercial' ? 24 + rnd() * 40 : 7 + rnd() * 9);
  return Math.min(h * OVER.bldH, OVER.bldCap);   // 超尺度:比現實同座標建物更高大
}

/** Overpass 圖資(10 秒沒回就放棄 → 程序生成備援):建物 + 鐵路/捷運 + 瀑布 */
async function fetchOsmFeatures(bbox) {
  const bb = `${bbox.minLat.toFixed(5)},${bbox.minLng.toFixed(5)},${bbox.maxLat.toFixed(5)},${bbox.maxLng.toFixed(5)}`;
  const q = `[out:json][timeout:9];`
    + `(way["building"](${bb});node["power"="tower"](${bb}););out center tags 600;`
    + `way["railway"~"^(rail|subway|light_rail|monorail|narrow_gauge|tram)$"](${bb});out geom 60;`
    + `node["waterway"="waterfall"](${bb});out 20;`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const resp = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ctrl.signal });
    if (!resp.ok) return null;
    const data = await resp.json();
    const buildings = [], rails = [], falls = [];
    for (const el of data.elements || []) {
      const tags = el.tags || {};
      if (el.type === 'way' && el.geometry && tags.railway) {
        rails.push({ tags, geometry: el.geometry });
      } else if (el.type === 'node' && tags.waterway === 'waterfall') {
        falls.push({ lat: el.lat, lng: el.lon, tags });
      } else {
        const lat = el.center?.lat ?? el.lat, lng = el.center?.lon ?? el.lon;
        if (Number.isFinite(lat)) buildings.push({ lat, lng, tags });
      }
    }
    return { buildings, rails, falls };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 道路路網(獨立 Overpass 查詢):與建物/鐵路分開,避免道路查詢過重或逾時時
 * 連帶拖垮既有的建物/鐵路渲染。失敗回 null → buildBiomes 退回以兵線為主要道路。
 */
async function fetchOsmRoads(bbox) {
  const bb = `${bbox.minLat.toFixed(5)},${bbox.minLng.toFixed(5)},${bbox.maxLat.toFixed(5)},${bbox.maxLng.toFixed(5)}`;
  const q = `[out:json][timeout:9];`
    + `way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track|path|footway|pedestrian)$"](${bb});out geom 300;`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const resp = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ctrl.signal });
    if (!resp.ok) return null;
    const data = await resp.json();
    const roads = [];
    for (const el of data.elements || []) {
      if (el.type === 'way' && el.geometry && el.tags?.highway) roads.push({ tags: el.tags, geometry: el.geometry });
    }
    return roads.length ? roads : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- 道路(圖資 way):有寬度的賽璐璐路面,主/次分級 + 依地貌變色 ----
const ROAD_W = {
  motorway: 12, trunk: 11, primary: 10, secondary: 8, tertiary: 7,
  unclassified: 5, residential: 5.5, living_street: 5, service: 4,
  pedestrian: 4, track: 3.5, footway: 2.4, path: 2.2,
};
const MAIN_HW = /^(motorway|trunk|primary|secondary|tertiary)$/;
function roadWidth(tags) {
  const base = ROAD_W[tags.highway] || 4;
  const lanes = parseInt(tags.lanes, 10) || 0;
  return lanes ? Math.max(base, lanes * 3.2) : base;   // 寬度依圖資車道數
}
// 路面顏色(cel-shaded):城市柏油 / 綠地泥土 / 裸露地礫石;主/次略有深淺
function roadColor(biome, main) {
  if (biome === 'urban') return main ? 0x3a3f45 : 0x4a4640;
  if (biome === 'green') return main ? 0x6f5b3e : 0x77603f;
  if (biome === 'bare') return main ? 0x8c7c5a : 0x94855f;
  if (biome === 'wet') return main ? 0x5c5a48 : 0x6a6350;
  return main ? 0x44484d : 0x50493f;
}

/**
 * 把圖資道路(或離線備援的兵線)畫成貼地賽璐璐路面。
 * 純視覺:掛在 biomes group,不進射擊 raycast、不描邊。
 * 依地貌 + 主/次分色批次合併(每色一個 Mesh),寬度取自圖資車道數。
 * 賽璐璐精修(botw_plan):4 頂點截面 — 路緣 18% 為頂點色「手繪墨線帶」;
 * 市區主幹道加虛線中線;材質帶低頻水彩 wash 打破長路面單色。
 */
const ROAD_SEG = 6;   // 路面貼地取樣間距(公尺)
/** 折線細分:每段長度不超過 seg,回傳新折線(端點保留) */
function densify(pts, seg) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / seg));
    for (let k = 1; k <= n; k++) out.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
  }
  return out;
}

function buildRoads(group, roads, terrain, center, mix, rnd) {
  const inb = 4;
  const buckets = new Map();   // color -> { pos, nrm, col, idx, base }
  const bucketOf = (color) => {
    let b = buckets.get(color);
    if (!b) { b = { pos: [], nrm: [], col: [], idx: [], base: 0 }; buckets.set(color, b); }
    return b;
  };
  const dash = { pos: [], nrm: [], idx: [], base: 0 };   // 虛線中線(市區主幹道)
  let built = 0;
  for (const way of roads) {
    if (way.tags.tunnel) continue;             // 隧道段不畫
    const main = MAIN_HW.test(way.tags.highway);
    const hw = roadWidth(way.tags) / 2;
    const lift = way.tags.bridge ? 3 : 0.3;
    // 世界折線(超出邊界即切段)
    const runs = [];
    let cur = [];
    for (const gpt of way.geometry) {
      const [x, z] = llToWorld(gpt.lat, gpt.lon, center);
      if (x < terrain.minX + inb || x > terrain.maxX - inb || z < terrain.minZ + inb || z > terrain.maxZ - inb) {
        if (cur.length >= 2) runs.push(cur);
        cur = [];
        continue;
      }
      cur.push([x, z]);
    }
    if (cur.length >= 2) runs.push(cur);
    for (const raw of runs) {
      // 圖資節點間距可達數十公尺,直接連線會讓路面弦切進丘陵裡(整段沉到地表下)。
      // 先細分成 ≤ ROAD_SEG 的小段,每個新頂點各自貼地。
      const run = densify(raw, ROAD_SEG);
      const mid = run[(run.length / 2) | 0];
      const biome = classify(terrain.sampleColor?.(mid[0], mid[1]), terrain.heightAt(mid[0], mid[1]), mix, rnd);
      if (biome === 'water') continue;
      const b = bucketOf(roadColor(biome, main));
      const nP = run.length, vbase = b.base;
      for (let i = 0; i < nP; i++) {
        const [x, z] = run[i];
        const a = run[Math.max(0, i - 1)], c = run[Math.min(nP - 1, i + 1)];
        let dx = c[0] - a[0], dz = c[1] - a[1];
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const px = dz, pz = -dx;                 // XZ 垂直向量
        // 截面 4 頂點:外緣暗(墨線)→ 內緣亮,漸層即手繪描邊筆觸
        for (const [off, ink] of [[hw, 1], [hw * 0.64, 0], [-hw * 0.64, 0], [-hw, 1]]) {
          const vx = x + px * off, vz = z + pz * off;
          b.pos.push(vx, terrain.heightAt(vx, vz) + lift, vz);
          b.nrm.push(0, 1, 0);
          if (ink) b.col.push(0.52, 0.52, 0.58);   // 邊墨帶微偏冷
          else b.col.push(1, 1, 1);
        }
      }
      for (let i = 0; i < nP - 1; i++) {
        const k = vbase + i * 4;
        for (const o of [0, 1, 2]) {
          b.idx.push(k + o, k + o + 1, k + o + 4, k + o + 1, k + o + 5, k + o + 4);
        }
      }
      b.base += nP * 4;
      // 虛線中線:只畫市區柏油主幹道(泥土/礫石路沒有標線)
      if (main && biome === 'urban') {
        const cum = [0];
        for (let i = 1; i < nP; i++) cum.push(cum[i - 1] + Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]));
        const total = cum[nP - 1];
        for (let s = 5; s + 3.2 < total; s += 9.5) {
          const pts = [s, s + 3.2].map((d) => {
            let i = 1; while (cum[i] < d && i < nP - 1) i++;
            const f = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
            return [run[i - 1][0] + (run[i][0] - run[i - 1][0]) * f, run[i - 1][1] + (run[i][1] - run[i - 1][1]) * f];
          });
          let ddx = pts[1][0] - pts[0][0], ddz = pts[1][1] - pts[0][1];
          const dl = Math.hypot(ddx, ddz) || 1; ddx /= dl; ddz /= dl;
          const qx = ddz, qz = -ddx, wq = 0.3;
          const k = dash.base;
          for (const [ex, ez] of pts) {
            for (const sgn of [1, -1]) {
              const vx = ex + qx * wq * sgn, vz = ez + qz * wq * sgn;
              dash.pos.push(vx, terrain.heightAt(vx, vz) + lift + 0.06, vz);
              dash.nrm.push(0, 1, 0);
            }
          }
          dash.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
          dash.base += 4;
        }
      }
      built++;
      if (built >= 600) break;
    }
    if (built >= 600) break;
  }
  for (const [color, b] of buckets) {
    if (!b.idx.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    geo.setIndex(b.idx);
    const m = new THREE.Mesh(geo, envMat(color, { vertexColors: true, wash: 0.55, cool: 0.5 }));
    m.frustumCulled = false;
    m.renderOrder = 1;
    m.userData.noOutline = true;
    group.add(m);
  }
  if (dash.idx.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(dash.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(dash.nrm, 3));
    geo.setIndex(dash.idx);
    const m = new THREE.Mesh(geo, envMat(0xe8e2d0, { wash: 0.15, cool: 0.3 }));
    m.frustumCulled = false;
    m.renderOrder = 2;
    m.userData.noOutline = true;
    group.add(m);
  }
  return built;
}

// ---- 鐵路 / 捷運(圖資 way):道碴 + 雙軌 + 行駛中的低多邊形列車 ----
function buildRails(group, rails, terrain, center, dynamics) {
  const lines = [];
  for (const way of rails) {
    if (way.tags.tunnel) continue;   // 隧道段不可見(捷運地下段)
    const elevated = !!way.tags.bridge || way.tags.railway === 'monorail';
    const lift = elevated ? 8 : 0.35;
    const pts = [];
    for (const gpt of way.geometry) {
      const [x, z] = llToWorld(gpt.lat, gpt.lon, center);
      if (x < terrain.minX + 5 || x > terrain.maxX - 5 || z < terrain.minZ + 5 || z > terrain.maxZ - 5) {
        if (pts.length >= 2) { lines.push({ pts: [...pts], tags: way.tags, elevated, lift }); }
        pts.length = 0;
        continue;
      }
      pts.push(new THREE.Vector3(x, terrain.heightAt(x, z) + lift, z));
    }
    if (pts.length >= 2) lines.push({ pts, tags: way.tags, elevated, lift });
    if (lines.length >= 30) break;
  }
  if (!lines.length) return 0;

  // 軌道:每線段 1 個道碴床 + 2 條鋼軌(InstancedMesh,整批 3 個 draw call)
  let segs = [];
  for (const l of lines) {
    for (let i = 1; i < l.pts.length && segs.length < 900; i++) segs.push([l.pts[i - 1], l.pts[i], l]);
  }
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const bedM = new THREE.InstancedMesh(unit, toonMat(0x5a5348), segs.length);
  const railM = new THREE.InstancedMesh(unit, toonMat(0x3a3f45), segs.length * 2);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), side = new THREE.Vector3();
  segs.forEach(([a, b], i) => {
    dir.subVectors(b, a);
    const len = dir.length();
    dir.normalize();
    Q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    side.crossVectors(dir, up).normalize();
    P.addVectors(a, b).multiplyScalar(0.5);
    S.set(3.4, 0.5, len + 0.4);
    M.compose(P, Q, S);
    bedM.setMatrixAt(i, M);
    for (const s of [-1, 1]) {
      const rp = P.clone().addScaledVector(side, s * 0.8);
      rp.y += 0.32;
      S.set(0.2, 0.24, len + 0.4);
      M.compose(rp, Q, S);
      railM.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), M);
    }
  });
  bedM.instanceMatrix.needsUpdate = railM.instanceMatrix.needsUpdate = true;
  bedM.frustumCulled = railM.frustumCulled = false;
  group.add(bedM, railM);

  // 高架橋墩(捷運/橋段)
  const piers = segs.filter(([, , l]) => l.elevated);
  if (piers.length) {
    const pierM = new THREE.InstancedMesh(unit, toonMat(0x8f9296), Math.min(piers.length, 200));
    piers.slice(0, 200).forEach(([a], i) => {
      const gy = terrain.heightAt(a.x, a.z);
      P.set(a.x, (gy + a.y) / 2, a.z);
      S.set(1.6, Math.max(1, a.y - gy), 1.6);
      M.compose(P, new THREE.Quaternion(), S);
      pierM.setMatrixAt(i, M);
    });
    pierM.instanceMatrix.needsUpdate = true;
    pierM.frustumCulled = false;
    group.add(pierM);
  }

  // 列車:最長兩條路線各跑一列(捷運=銀藍、鐵路=橘白),往返行駛
  const byLen = lines.map((l) => {
    let d = 0;
    for (let i = 1; i < l.pts.length; i++) d += l.pts[i].distanceTo(l.pts[i - 1]);
    return { ...l, total: d };
  }).filter((l) => l.total > 300).sort((a, b) => b.total - a.total);
  for (const line of byLen.slice(0, 2)) {
    const metro = /subway|light_rail|monorail|tram/.test(line.tags.railway);
    const train = makeTrain(metro);
    group.add(train);
    dynamics.push(trainDriver(train, line, metro ? 22 : 17));
  }
  return lines.length;
}

/** 低多邊形列車(車頭 + 2 節車廂) */
function makeTrain(metro) {
  const g = new THREE.Group();
  const body = metro ? 0xdfe5ea : 0xe8873c;
  const stripe = metro ? 0x2a6fa8 : 0xf4f0e6;
  for (let c = 0; c < 3; c++) {
    const car = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(3.0, 3.4, 13.4), toonMat(body));
    m.position.y = 2.4;
    car.add(m);
    const st = new THREE.Mesh(new THREE.BoxGeometry(3.05, 0.7, 13.4), toonMat(stripe));
    st.position.y = 1.7;
    car.add(st);
    const win = new THREE.Mesh(new THREE.BoxGeometry(3.06, 0.9, 11.5),
      toonMat(0x27313a, { emissive: new THREE.Color(0x36434f), emissiveIntensity: 0.5 }));
    win.position.y = 3.1;
    car.add(win);
    if (c === 0) {   // 車頭斜鼻
      const nose = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.6, 2.2), toonMat(body));
      nose.position.set(0, 2.0, -7.6);
      nose.rotation.x = 0.35;
      car.add(nose);
    }
    car.position.z = c * 14.4;
    g.add(car);
  }
  return g;
}

/** 列車駕駛:沿折線等速前進,端點折返(回傳 dt 更新器) */
function trainDriver(train, line, speed) {
  const cum = [0];
  for (let i = 1; i < line.pts.length; i++) cum.push(cum[i - 1] + line.pts[i].distanceTo(line.pts[i - 1]));
  let s = Math.random() * line.total, dirn = 1;
  const at = (d) => {
    const dd = Math.max(0, Math.min(line.total, d));
    let i = 1;
    while (cum[i] < dd && i < cum.length - 1) i++;
    const f = (dd - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return new THREE.Vector3().lerpVectors(line.pts[i - 1], line.pts[i], f);
  };
  return (dt) => {
    s += speed * dirn * dt;
    if (s > line.total || s < 0) { dirn *= -1; s = Math.max(0, Math.min(line.total, s)); }
    const p = at(s);
    const ahead = at(s + dirn * 8);
    train.position.copy(p);
    if (ahead.distanceToSquared(p) > 0.5) train.lookAt(ahead);
  };
}

// ---- 瀑布(圖資節點):水簾 + 底部水潭 + 湧動泡沫 ----
function buildWaterfalls(group, falls, terrain, center, dynamics) {
  let built = 0;
  for (const f of falls.slice(0, 6)) {
    const [x, z] = llToWorld(f.lat, f.lng, center);
    if (x < terrain.minX + 20 || x > terrain.maxX - 20 || z < terrain.minZ + 20 || z > terrain.maxZ - 20) continue;
    // 找落差方向:採樣 8 方位高程,水從最高側流向最低側
    let hi = { h: -Infinity }, lo = { h: Infinity };
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2;
      const h = terrain.heightAt(x + Math.cos(a) * 18, z + Math.sin(a) * 18);
      if (h > hi.h) hi = { h, a };
      if (h < lo.h) lo = { h, a };
    }
    const drop = Math.max(6, hi.h - lo.h);
    const g = new THREE.Group();
    g.position.set(x, lo.h, z);
    g.rotation.y = -lo.a;
    // 水簾(兩層錯開的半透明白幕)
    const sheets = [];
    for (const [w, off, op] of [[7, 0, 0.85], [5, 0.8, 0.55]]) {
      const sheet = new THREE.Mesh(
        new THREE.PlaneGeometry(w, drop),
        new THREE.MeshToonMaterial({
          color: 0xeaf6fb, gradientMap: toonGradient(), transparent: true, opacity: op, side: THREE.DoubleSide,
        }),
      );
      sheet.position.set(0, drop / 2, -off);
      g.add(sheet);
      sheets.push(sheet);
    }
    // 頂緣溢流 + 底部水潭 + 泡沫
    const lip = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.8, 2.4), toonMat(0xd8eef6, { transparent: true, opacity: 0.9 }));
    lip.position.set(0, drop, -0.6);
    g.add(lip);
    const pool = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.5, 0.5, 14),
      toonMat(0x9fd4e8, { transparent: true, opacity: 0.7 }));
    pool.position.y = 0.25;
    g.add(pool);
    const foam = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.2, 1.1, 12),
      toonMat(0xffffff, { transparent: true, opacity: 0.8 }));
    foam.position.y = 0.7;
    g.add(foam);
    group.add(g);
    built++;
    // 動態:水簾上下捲動錯覺(縮放脈動)+ 泡沫呼吸
    let t = Math.random() * 10;
    dynamics.push((dt) => {
      t += dt;
      sheets.forEach((s, i) => {
        s.material.opacity = (i === 0 ? 0.85 : 0.55) + Math.sin(t * (3 + i)) * 0.1;
        s.scale.x = 1 + Math.sin(t * 2.4 + i) * 0.05;
      });
      foam.scale.setScalar(1 + Math.sin(t * 3.2) * 0.12);
    });
  }
  return built;
}

/**
 * 建立整張圖的地物。回傳 THREE.Group(加進 terrain.group 同層即可)。
 * cfg 需含 lanes/bases/center/env/venue;terrain 來自 buildTerrain()。
 */
export async function buildBiomes(cfg, terrain, onProgress) {
  const center = cfg.center;
  const season = cfg.env?.season || 'summer';
  const night = cfg.env?.time === 'night';
  const mix = cfg.venue?.mix || null;
  const rnd = mulberry32(
    (Math.round(center.lat * 1e4) * 31 + Math.round(center.lng * 1e4)) ^ ((cfg.teamSize || 5) << 20),
  );
  const group = new THREE.Group();
  group.name = 'biomes';

  onProgress?.(0.02, '規劃兵線淨空走廊…');
  const naturePromise = loadNatureModels(season);   // Quaternius 植被:與散佈並行載入
  const blocked = buildClearance(cfg, center);
  const inb = 30;   // 邊界內縮
  const rx = () => terrain.minX + inb + rnd() * (terrain.worldW - inb * 2);
  const rz = () => terrain.minZ + inb + rnd() * (terrain.worldH - inb * 2);

  // ---- 散佈植被 ----
  const areaKm2 = terrain.worldW * terrain.worldH / 1e6;
  const vegTarget = Math.max(800, Math.min(MAX_VEG, Math.round(areaKm2 * 560)));   // 密度加高(仍全 instanced)
  const items = {};   // type -> [{x,y,z,s,ry}]
  const urbanPts = [];
  let placed = 0;
  const put = (type, x, z, s) => {
    items[type] ??= [];
    items[type].push({
      x, y: terrain.heightAt(x, z), z, s: s * (VEG_SCALE[type] || 1),   // 超尺度植被
      ry: rnd() * Math.PI * 2,
      tx: (rnd() - 0.5) * 0.09, tz: (rnd() - 0.5) * 0.09,   // 站姿微傾斜(每棵不同)
    });
    placed++;
  };

  // ---- 神木群落 + 巨岩地標:先於一般植被佔位(小植被/地被/建物自動避開)----
  onProgress?.(0.04, '安置神木群落與巨岩地標…');
  const blockers = [];   // 建物/神木/巨岩碰撞柱(main.js → terrain.blockers → game.js _collide)
  const greenSites = [], bareSites = [];
  for (let a = 0; a < 1400 && (greenSites.length < 20 || bareSites.length < 28); a++) {
    const x = rx(), z = rz();
    const h = terrain.heightAt(x, z);
    if (h < 0.4 || blocked.has(cellKey(x, z))) continue;
    const b = classify(terrain.sampleColor?.(x, z), h, mix, rnd);
    if (b === 'green' && greenSites.length < 20) greenSites.push([x, z]);
    else if (b === 'bare' && bareSites.length < 28) bareSites.push([x, z]);
  }
  const megalithsBuilt = placeMegaliths({ group, terrain, blocked, blockers, rnd, sites: bareSites });
  const giantTrees = placeGiantGroves({ terrain, blocked, blockers, items, rnd, sites: greenSites });

  const attempts = vegTarget * 3;
  for (let a = 0; a < attempts && placed < vegTarget; a++) {
    if ((a & 1023) === 0) onProgress?.(0.05 + (a / attempts) * 0.30, '鋪設植被地貌…');
    const x = rx(), z = rz();
    if (blocked.has(cellKey(x, z))) continue;
    const h = terrain.heightAt(x, z);
    if (h < 0.4) {   // 水體:偶爾在水邊補蘆葦
      if (rnd() < 0.06) put('reed', x, z, 0.8 + rnd() * 0.6);
      continue;
    }
    const biome = classify(terrain.sampleColor?.(x, z), h, mix, rnd);
    if (biome === 'water') continue;
    if (biome === 'urban') {
      if (urbanPts.length < 500) urbanPts.push([x, z]);
      continue;
    }
    if (biome === 'green') {
      const relH = (h - terrain.minH) / Math.max(1, terrain.maxH - terrain.minH);
      const r = rnd();
      if (r < 0.25) {
        // 竹林:大小不一的群落
        const n = 6 + Math.floor(rnd() * 12);
        const cr = 5 + rnd() * 14;
        for (let k = 0; k < n && placed < vegTarget; k++) {
          const bx = x + (rnd() - 0.5) * cr * 2, bz = z + (rnd() - 0.5) * cr * 2;
          if (blocked.has(cellKey(bx, bz)) || terrain.heightAt(bx, bz) < 0.4) continue;
          put('bamboo', bx, bz, 0.8 + rnd() * 0.7);
        }
      } else if (relH > 0.55 || r < 0.55) {
        put('conifer', x, z, 0.75 + rnd() * 0.9);
      } else {
        put(rnd() < 0.3 ? 'birch' : 'broadleaf', x, z, 0.75 + rnd() * 0.9);
      }
    } else if (biome === 'bare') {
      const r = rnd();
      if (r < 0.38) put('silvergrass', x, z, 0.8 + rnd() * 1.0);
      else if (r < 0.58) put('arrowbamboo', x, z, 0.8 + rnd() * 0.8);
      else if (r < 0.78) put('shrub', x, z, 0.7 + rnd() * 0.9);
      else if (r < 0.88) put('deadtree', x, z, 0.7 + rnd() * 0.7);
      else put('succulent', x, z, 0.7 + rnd() * 0.8);
    } else if (biome === 'wet') {
      if (rnd() < 0.45) put('mangrove', x, z, 0.8 + rnd() * 0.7);
      else put('reed', x, z, 0.8 + rnd() * 0.8);
    }
  }
  onProgress?.(0.38, '建置植被模型(Quaternius CC0)…');
  const nature = await naturePromise;
  for (const type in items) {
    const meshes = nature[type]
      ? buildVegMeshesGlb(nature[type], items[type])
      : buildVegMeshes(type, items[type], season);
    for (const m of meshes) group.add(m);
  }

  // ---- 圖資(建物 + 鐵路 + 瀑布)----
  onProgress?.(0.42, '讀取 OSM 圖資(建物/鐵路/道路/瀑布)…');
  let osmData = null, osmRoads = null;
  if (terrain.sampleColor) [osmData, osmRoads] = await Promise.all([fetchOsmFeatures(terrain.bbox), fetchOsmRoads(terrain.bbox)]);
  const osm = osmData?.buildings || null;

  const generic = [];       // {x,z,w,h,d,ry,commercial}
  const landmarks = [];     // {x,z,type,scale}
  const usedLm = new Set();

  const tryPlace = (x, z) =>
    !blocked.has(cellKey(x, z))
    && x > terrain.minX + inb && x < terrain.maxX - inb
    && z > terrain.minZ + inb && z < terrain.maxZ - inb
    && terrain.heightAt(x, z) > 0.4;

  if (osm && osm.length) {
    onProgress?.(0.6, `建置圖資建物(${osm.length} 筆)…`);
    // 特殊地標優先,一般建物均勻抽樣到上限
    osm.sort((p, q) => (buildingType(q.tags) !== 'residential') - (buildingType(p.tags) !== 'residential'));
    for (const el of osm) {
      const [x, z] = llToWorld(el.lat, el.lng, center);
      if (!tryPlace(x, z)) continue;
      const type = buildingType(el.tags);
      if (LANDMARKS[type]) {
        if (landmarks.length < 60) { landmarks.push({ x, z, type }); usedLm.add(type); }
      } else if (generic.length < MAX_BUILDINGS) {
        const commercial = type === 'commercial';
        const h = buildingHeight(el.tags, type, rnd);
        generic.push({
          x, z,
          w: (8 + rnd() * (commercial ? 12 : 7)) * OVER.bldXZ,
          d: (8 + rnd() * (commercial ? 12 : 7)) * OVER.bldXZ,
          h, ry: rnd() * Math.PI, commercial,
          v: Math.floor(rnd() * 3),   // 立面樣式變體
        });
      }
    }
  }
  // 備援:離線 / 圖資空白但影像判定有市區 → 程序生成街區
  if (!landmarks.length && !generic.length && urbanPts.length > 8) {
    onProgress?.(0.6, '離線模式:程序生成市區…');
    const lmTypes = Object.keys(LANDMARKS);
    urbanPts.forEach(([x, z], i) => {
      if (!tryPlace(x, z)) return;
      if (i < lmTypes.length && rnd() < 0.8) { landmarks.push({ x, z, type: lmTypes[i] }); return; }
      if (generic.length >= MAX_BUILDINGS) return;
      const commercial = rnd() < 0.25;
      generic.push({
        x, z, w: (8 + rnd() * 8) * OVER.bldXZ, d: (8 + rnd() * 8) * OVER.bldXZ,
        h: Math.min((commercial ? 24 + rnd() * 40 : 7 + rnd() * 9) * OVER.bldH, OVER.bldCap),
        ry: rnd() * Math.PI, commercial,
        v: Math.floor(rnd() * 3),   // 立面樣式變體
      });
    });
  }

  // 一般建物:住宅/商辦 × 三款立面樣式 = 六個 InstancedMesh — 窗格立面貼圖
  // (白底 × 色盤 tint = 同貼圖多種外牆色)取代單一色塊;
  // 夜間亮窗走 emissiveMap(只有畫了燈的窗亮)。
  // 同時登記碰撞柱(blockers):限制玩家行動但不封鎖(走廊已淨空、可飛越屋頂)。
  const roofBoxes = [];    // 屋頂雜項(空調機組/機房):打破光禿平屋頂輪廓
  const roofTanks = [];    // 圓筒水塔
  const billboards = [];   // 商辦屋頂廣告看板(彩色 + 夜間發光)
  const antennas = [];     // 高樓天線
  {
    const tint = new THREE.Color();
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
    const P = new THREE.Vector3(), S = new THREE.Vector3();
    for (const commercial of [false, true]) {
      const cat = commercial ? 'commercial' : 'residential';
      // 三款立面樣式各一個 InstancedMesh(共 6 個 draw call,仍是常數級)
      for (let v = 0; v < FACADES[cat].length; v++) {
        const list = generic.filter((b) => b.commercial === commercial && (b.v ?? 0) === v);
        if (!list.length) continue;
        const fd = FACADES[cat][v];
        const f = facadeTex(fd.key, fd.cols, fd.rows, fd.winC, fd.lit, fd.style);
        const wall = bmat(0xffffff, {
          map: f.map,
          emissiveMap: f.emissiveMap,
          emissive: new THREE.Color(night ? 0xffb45e : 0x000000),
          emissiveIntensity: night ? (commercial ? 0.9 : 0.55) : 0,
        });
        // 屋頂/底面用素色材質(色塊分離):窗格貼圖只留在四面牆,
        // 屋頂不再出現「躺平的窗」;instance tint 兩材質同吃 → 每棟仍有色差
        const roof = bmat(fd.roof, { wash: 0.5 });
        // BoxGeometry 群組順序 +x,-x,+y,-y,+z,-z
        const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), [wall, wall, roof, roof, wall, wall], list.length);
        const pal = PALETTE[cat];
        list.forEach((b, i) => {
          E.set(0, b.ry, 0); Q.setFromEuler(E);
          const gy = terrain.heightAt(b.x, b.z);
          P.set(b.x, gy + b.h / 2 - 0.5, b.z);
          S.set(b.w, b.h, b.d);
          M.compose(P, Q, S);
          m.setMatrixAt(i, M);
          tint.setHex(pal[((i * 2654435761) >>> 0) % pal.length]);
          m.setColorAt(i, tint);
          blockers.push({ x: b.x, z: b.z, y: gy - 1, r: Math.hypot(b.w, b.d) / 2 * 0.8, h: b.h + 1 });
          // 屋頂雜項:空調機組或圓筒水塔(局部座標 → 依 ry 旋回世界)
          const rr = rnd();
          if (rr < 0.72) {
            const ox = (rnd() - 0.5) * b.w * 0.45, oz = (rnd() - 0.5) * b.d * 0.45;
            const ca = Math.cos(b.ry), sa = Math.sin(b.ry);
            const wx = b.x + ox * ca + oz * sa, wz = b.z - ox * sa + oz * ca;
            if (rr < 0.42) {
              roofBoxes.push({
                x: wx, z: wz, y: gy + b.h - 0.5, ry: b.ry,
                w: 1.6 + rnd() * b.w * 0.12, h: 1.4 + rnd() * 2.4, d: 1.6 + rnd() * b.d * 0.12,
              });
            } else {
              roofTanks.push({ x: wx, z: wz, y: gy + b.h - 0.5, r: 1.1 + rnd() * 1.3, h: 2.4 + rnd() * 2.2 });
            }
          }
          if (commercial && b.h > 40 && rnd() < 0.5) {
            billboards.push({ x: b.x, z: b.z, y: gy + b.h - 0.5, ry: b.ry, w: Math.min(b.w * 0.7, 10), h: 3 + rnd() * 4 });
          }
          if (commercial && b.h > 60 && rnd() < 0.6) {
            antennas.push({ x: b.x, z: b.z, y: gy + b.h - 0.5, h: 5 + rnd() * 7 });
          }
        });
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.frustumCulled = false;
        group.add(m);
      }
    }
    if (roofBoxes.length) {
      const rm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bmat(0x8a9096), roofBoxes.length);
      roofBoxes.forEach((b, i) => {
        E.set(0, b.ry, 0); Q.setFromEuler(E);
        P.set(b.x, b.y + b.h / 2, b.z);
        S.set(b.w, b.h, b.d);
        M.compose(P, Q, S);
        rm.setMatrixAt(i, M);
      });
      rm.instanceMatrix.needsUpdate = true;
      rm.frustumCulled = false;
      group.add(rm);
    }
    if (roofTanks.length) {
      const tm = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8), bmat(0xb0b8be), roofTanks.length);
      roofTanks.forEach((t, i) => {
        P.set(t.x, t.y + t.h / 2, t.z);
        S.set(t.r, t.h, t.r);
        M.compose(P, new THREE.Quaternion(), S);
        tm.setMatrixAt(i, M);
      });
      tm.instanceMatrix.needsUpdate = true;
      tm.frustumCulled = false;
      group.add(tm);
    }
    if (billboards.length) {
      // 看板底色靠 instance tint 上彩;夜間白光背光(emissive 不吃 tint,壓低強度保留色感)
      const bbM = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 0.25),
        bmat(0xffffff, { emissive: new THREE.Color(night ? 0xfff2cc : 0x000000), emissiveIntensity: night ? 0.45 : 0 }),
        billboards.length,
      );
      const bpal = [0xe8734a, 0x4a9ae8, 0xe8c84a, 0x6cc45e, 0xd95e8a, 0x8a6ae8];
      billboards.forEach((bb, i) => {
        E.set(0, bb.ry, 0); Q.setFromEuler(E);
        P.set(bb.x, bb.y + bb.h / 2 + 0.6, bb.z);
        S.set(bb.w, bb.h, 1);
        M.compose(P, Q, S);
        bbM.setMatrixAt(i, M);
        tint.setHex(bpal[((i * 40503) >>> 0) % bpal.length]);
        bbM.setColorAt(i, tint);
      });
      bbM.instanceMatrix.needsUpdate = true;
      if (bbM.instanceColor) bbM.instanceColor.needsUpdate = true;
      bbM.frustumCulled = false;
      group.add(bbM);
    }
    if (antennas.length) {
      const am = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.12, 0.28, 1, 6),
        toonMat(0xc4ccd2, { emissive: new THREE.Color(0x8a1408), emissiveIntensity: night ? 1.2 : 0.15 }),
        antennas.length,
      );
      antennas.forEach((a, i) => {
        P.set(a.x, a.y + a.h / 2, a.z);
        S.set(1, a.h, 1);
        M.compose(P, new THREE.Quaternion(), S);
        am.setMatrixAt(i, M);
      });
      am.instanceMatrix.needsUpdate = true;
      am.frustumCulled = false;
      group.add(am);
    }
  }
  // 特殊地標(超尺度 + 碰撞柱)
  onProgress?.(0.85, '放置地標建物…');
  for (const lm of landmarks) {
    const g = new THREE.Group();
    LANDMARKS[lm.type](g);
    bakeContactAO(g, 3);   // 接地 AO 頂點色:地標與地面接縫處手繪暗角(botw_plan Task 2.2)
    const sc = OVER.lm * (0.9 + rnd() * 0.25);
    g.scale.setScalar(sc);
    const gy = terrain.heightAt(lm.x, lm.z);
    g.position.set(lm.x, gy - 0.3, lm.z);
    g.rotation.y = rnd() * Math.PI * 2;
    group.add(g);
    const col = LANDMARK_COL[lm.type];
    if (col) blockers.push({ x: lm.x, z: lm.z, y: gy - 1, r: col.r * sc, h: col.h * sc + 1 });
  }

  // ---- 地被覆蓋層:開闊地的賽璐璐地表色塊 + 表面細節(ground.js)----
  // 專用 rnd(同心種子異或常數):不動用共享 rnd 序列,建物/植被佈局不受影響
  onProgress?.(0.88, '鋪設地表覆蓋層…');
  const gseed = (Math.round(center.lat * 1e4) * 31 + Math.round(center.lng * 1e4)) >>> 0;
  const grnd = mulberry32(gseed ^ 0x51AB);
  const ground = buildGroundCover(group, terrain, {
    isBlocked: (x, z) => blocked.has(cellKey(x, z)),
    classifyAt: (x, z) => classify(terrain.sampleColor?.(x, z), terrain.heightAt(x, z), mix, grnd),
    // 底毯逐格取樣要空間連貫:純色彩分類(mix=null,跳過 55% 場地隨機改寫)
    classifyPureAt: (x, z) => classify(terrain.sampleColor?.(x, z), terrain.heightAt(x, z), null, grnd),
    blockers, season, seed: gseed, rnd: grnd,
  });

  // ---- 道路(圖資主/次要;離線則以兵線為主要道路備援)----
  onProgress?.(0.9, '鋪設道路路面…');
  const roadInput = osmRoads?.length
    ? osmRoads
    : cfg.lanes.map((lane) => ({ tags: { highway: 'primary' }, geometry: lane.map(([lat, lng]) => ({ lat, lon: lng })) }));
  const roadsBuilt = buildRoads(group, roadInput, terrain, center, mix, rnd);

  // ---- 鐵路/捷運(含行駛列車)+ 瀑布(動態物件)----
  onProgress?.(0.92, '鋪設鐵路與瀑布…');
  const dynamics = [];
  const railLines = osmData?.rails?.length ? buildRails(group, osmData.rails, terrain, center, dynamics) : 0;
  const fallsBuilt = osmData?.falls?.length ? buildWaterfalls(group, osmData.falls, terrain, center, dynamics) : 0;
  if (dynamics.length) {
    group.userData.update = (dt) => { for (const fn of dynamics) fn(dt); };
  }

  onProgress?.(1, '地貌完成');
  group.userData.blockers = blockers;   // 建物碰撞柱(main.js → terrain.blockers → game.js _collide)
  group.userData.stats = {
    veg: placed,
    giantTrees,
    megaliths: megalithsBuilt,
    ground: ground.patches,
    groundDetails: ground.details,
    buildings: generic.length + landmarks.length,
    landmarks: landmarks.length,
    roads: roadsBuilt,
    rails: railLines,
    falls: fallsBuilt,
    osm: !!(osm && osm.length),
  };
  return group;
}
