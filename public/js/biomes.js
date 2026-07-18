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
//            一般建物分七款立面樣式(店面/陽台/帷幕/絲帶窗…)× 擴充色盤
//   水體   — 不鋪地物(水面由 terrain.js 處理)
//   濕地   — 紅樹林 / 蘆葦(僅低海拔成立)
// 預設場地的 mix(venues.js)會對分類加權,做出「單一 80% / 混合」的場地感。
// 兵線走廊保持淨空(寬度 > 4 台機甲並行),主堡與防禦塔周圍同樣清場。
// 植被全部用 InstancedMesh(低多邊形 + 分層樹冠),整張圖數十個 draw call。
// 亂數以戰場中心為種子:同一房間所有玩家看到同一片森林。
//
// 超尺度原則(2026-07-09;2026-07-10 佔地對齊現實比例):士兵顯示高 3.2m ≈ 真人 ×1.8,
// 建物高度與佔地同乘 ×1.8 → 建物:士兵比例與現實一致;神木/巨岩跟著等比放大(×1.35)。
// 立面用程序生成窗格貼圖(賽璐璐「畫上去的窗」)取代單色塊;
// 建物同時輸出碰撞柱(group.userData.blockers)— 限制玩家行動但不封鎖,
// 兵線走廊由淨空網格保證暢通(佔地放大後改用半對角掃走廊),無人機永遠可以飛越屋頂。
// 立體掩體三本柱(2026-07-10):建物 26~170m,神木 / 巨岩隨等比放大可達 ~220m,
// 三者皆登記碰撞柱作障礙與隱蔽;神木與巨岩先於一般植被佔位,小植被/地被自動避開。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ENV, solveTowerSites, WATER, MAPGEO } from './data.js';
import { llToWorld } from './terrain.js';
import { toonMat, toonGradient, envMat, bakeContactAO } from './hazards.js';
import { buildGroundCover } from './ground.js';

const CELL = 10;                 // 淨空網格(m);走廊全寬約 34m > 4×3.5m 機甲
const MAX_VEG = 7000;            // 植被實例上限
const MAX_BUILDINGS = 240;       // 種子建物上限:OSM 圖資 / 程序街區(特殊地標另計 ≤ 60)
const MAX_INFILL = 1200;         // 補間建物上限(立面 InstancedMesh 仍是常數級 10 個)
// 市區補間參數:每個種子沿自身朝向鋪一塊 cols×rows 的街廓網格。
// pitch 36m ≈ 最大佔地(32m)+ 巷弄 ⇒ 大型商辦間僅 4m(< 機甲碰撞直徑 4.6~7.7m)不可穿越
// = 實心掩體;住宅(10~22m)間 14~26m 成街道 = 巷戰路徑。兵線走廊(半寬 17m)恆淨空。
const INFILL = { maxSeeds: 160, pitch: 36, cols: [3, 6], rows: [3, 6], skip: 0.18, gap: 2 };
// 尺度倍率(2026-07-10 改制:步兵 = 真人 1.8m,見 models.js SOLDIER_H)。
// 2026-07-12 佔地改制:建物公稱佔地加大到真實市街量體(住宅 10~22m、商辦 16~32m)——
// 建物佔地:士兵比例對齊現實;神木/巨岩以 giant/mega = 1.35 跟隨佔地等比放大,
// 與建物維持視覺等比(高度公稱值不動,仍是真實公尺)。lm 同步放大:地標量體對齊真實公共建築。
const OVER = { bldH: 1.0, bldXZ: 1.0, bldCap: 170, lm: 1.5, giant: 1.35, mega: 1.35 };
// 植被放大倍率(喬木最誇張,地被小幅)。
// 注意:此表作用在很小的公稱幾何上(針葉樹公稱僅 ~8.7m),放大後的「絕對高度」本就接近真實,
// 故改制不動它 —— 步兵縮到 1.8m 後,樹木相對步兵的比例自動回歸現實。
const VEG_SCALE = {
  bamboo: 1.5, broadleaf: 1.45, birch: 1.4, conifer: 1.5, deadtree: 1.35, mangrove: 1.3,
  conifer2: 1.5, conifer3: 1.45, conifer4: 1.5,
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
  }
  // 防禦塔位置周圍清場:與 sim._spawnStructures 共用 solveTowerSites()(前線塔位是解出來的,
  // MUST NOT 用 TOWER_FRACS 自己重算 —— 那會清錯位置、讓建物長在塔上)
  for (const sites of solveTowerSites(lanesW)) {
    for (const st of sites) {
      for (const side of ['SWARM', 'STEEL']) blockPoint(st[side].x, st[side].z, 30);
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
  // 針葉林幾何多樣化(2026-07-12):三角錐塔之外再添三款輪廓,同林異形
  conifer2:    { parts: [{ g: cyl(0.18, 0.3, 2.4), y: 1.2, c: 0x54402a },       // 老雲杉:不規則簇疊冠
                         { g: ico(2.0), y: 3.4, key: 'conifer', sy: 0.8 },
                         { g: ico(1.6), y: 4.9, px: 0.7, key: 'conifer', sy: 0.75 },
                         { g: ico(1.4), y: 6.1, px: -0.6, key: 'conifer', sy: 0.7 },
                         { g: ico(0.9), y: 7.3, key: 'conifer', sy: 0.8 },
                         { g: cone(0.5, 1.6, 5), y: 7.9, key: 'conifer' }] },   // 突出頂梢
  conifer3:    { parts: [{ g: cyl(0.14, 0.22, 1.2), y: 0.6, c: 0x5d4027 },      // 柱狀絲柏:細長紡錘
                         { g: cone(1.1, 7.6, 6), y: 4.9, key: 'conifer' },
                         { g: cyl(0.9, 1.3, 2.2, 6), y: 2.2, key: 'conifer' },
                         { g: cone(0.5, 2.0, 5), y: 8.6, key: 'conifer' }] },
  conifer4:    { parts: [{ g: cyl(0.24, 0.36, 3.4), y: 1.7, c: 0x66492e },      // 雪松:平展層枝盤
                         { g: cyl(2.6, 3.1, 0.9, 8), y: 3.0, key: 'conifer' },
                         { g: cyl(2.0, 2.5, 0.85, 8), y: 4.6, key: 'conifer' },
                         { g: cyl(1.4, 1.9, 0.8, 8), y: 6.1, key: 'conifer' },
                         { g: cyl(0.7, 1.2, 0.75, 7), y: 7.4, key: 'conifer' },
                         { g: cone(0.5, 1.3, 6), y: 8.0, key: 'conifer' }] },
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
  // 邊界巨岩簇(裸露地邊界帶專用;InstancedMesh 管線,公稱 ~5m × s 1.4~3.4 → 7~17m)
  borderrock:  { parts: [{ g: ico(2.4), y: 1.4, c: 0x8f8878 },
                         { g: ico(1.7), y: 0.9, px: 2.2, sy: 0.75, c: 0x7d786c },
                         { g: ico(1.3), y: 0.7, px: -1.9, pz: 1.1, sy: 0.7, c: 0x968e7c },
                         { g: cone(2.2, 1.8, 7), y: 0.9, pz: -1.6, c: 0x857e70 }] },
};

// ---- 神木(全球實存 >65m 巨樹樹種;綠地超尺度地標植被)----
//   紅杉(海岸紅杉 115m)/ 巨杉(世界爺 95m)/ 杏仁桉(澳洲王桉 100m)/
//   花旗松(100m)/ 西加雲杉(97m)/ 黃柳桉(婆羅洲熱帶巨樹 100m)/ 台灣杉(90m)/
//   亞馬遜天使樹(Dinizia excelsa 88m)
// 同一種神木成群聚落、株高各異(s = 0.75~1.10 → 公稱高的 75%~110%,即真實世界株高區間);
// 每株多零件建模:板根/樹皮絲帶/斜出枝節/多層樹冠(px/pz = 距軸心偏移,
// rx/rz = 枝幹傾角),樹幹登記碰撞柱 = 立體障礙與隱蔽。h/r = 公稱高/幹半徑。
const GIANT_DEFS = {
  redwood:  { h: 110, r: 3.4, parts: [
    { g: cyl(3.4, 5.6, 7, 7), y: 3.5, c: 0x6e4630 },
    { g: cyl(2.4, 3.5, 40, 7), y: 26, c: 0x7a4a32 },
    { g: cyl(1.4, 2.4, 34, 7), y: 63, c: 0x82503a },
    { g: cyl(0.6, 1.4, 22, 6), y: 91, c: 0x82503a },
    { g: cone(2.6, 8, 3), y: 4, px: 4.2, c: 0x5e3c28 },          // 板根鰭(基部放射狀)
    { g: cone(2.4, 7, 3), y: 3.5, px: -2.4, pz: 3.6, c: 0x664130 },
    { g: cone(2.4, 7, 3), y: 3.5, px: -2.4, pz: -3.6, c: 0x5e3c28 },
    { g: cyl(2.65, 2.72, 5, 7), y: 40, c: 0x8f9a6e },            // 地衣環帶(淡黃綠)
    { g: cyl(1.4, 2.2, 6, 4), y: 3, px: 3.2, c: 0x38241a },      // 火疤(基部焦黑鑿痕)
    // 側枝外端一律朝上(rz 符號 = −sign(px);真樹分叉向上,不下垂)
    { g: cyl(0.4, 0.6, 9, 5), y: 56, px: 4.5, rz: -1.25, c: 0x6e4630 },
    { g: cyl(0.4, 0.6, 8, 5), y: 48, px: -4, rz: 1.2, c: 0x6e4630 },
    { g: cone(7, 26, 7), y: 96, c: 0x3f7a46 },                   // 頂冠偏亮 = 受光層次
    { g: cone(9, 20, 7), y: 82, c: 0x33643c },
    { g: cone(10, 16, 7), y: 68, c: 0x2e5c38 },
    { g: ico(5), y: 58, px: 6, sy: 0.8, c: 0x33643c },
    { g: ico(5), y: 51, px: -6, sy: 0.8, c: 0x2e5c38 },
    { g: ico(4), y: 74, px: -8, sy: 0.7, c: 0x4a8a4e },          // 受光亮綠簇
    { g: ico(4.5), y: 62, pz: 6.5, sy: 0.75, c: 0x3b7042 },
  ] },
  sequoia:  { h: 92, r: 5.6, parts: [
    { g: cyl(5.6, 9.2, 9, 8), y: 4.5, c: 0x7d4a2e },
    { g: cyl(4.0, 5.7, 44, 8), y: 30, c: 0x8a552f },
    { g: cyl(2.2, 4.0, 26, 7), y: 65, c: 0x936030 },
    { g: cyl(0.7, 1.0, 13, 5), y: 50, px: 5.5, rz: -1.3, c: 0x7d4a2e },   // 側枝外端朝上
    { g: cyl(0.7, 1.0, 12, 5), y: 58, px: -5.5, rz: 1.3, c: 0x7d4a2e },
    { g: cone(4.5, 9, 3), y: 4.5, px: 6.5, c: 0x6e4226 },        // 板根鰭
    { g: cone(4.2, 8, 3), y: 4, px: -4, pz: 5.5, c: 0x75462a },
    { g: ico(1.9), y: 12, px: 5.4, sy: 0.8, c: 0x6e4226 },       // 樹瘤
    { g: ico(5), y: 88, px: 4, sy: 0.7, c: 0x55904a },           // 頂部受光亮簇
    { g: ico(9), y: 72, sy: 0.8, c: 0x39683a },
    { g: ico(7), y: 82, c: 0x336033 },
    { g: ico(6), y: 66, px: 7.5, c: 0x4a7a3c },                  // 黃綠受光簇
    { g: ico(6), y: 60, px: -7.5, c: 0x336033 },
    { g: ico(5), y: 55, pz: 7, c: 0x39683a },
    { g: cone(5, 10, 6), y: 89, c: 0x336033 },
    { g: cyl(0.24, 0.45, 7, 5), y: 96, c: 0x8a6a4a },            // 突出頂梢枯枝(雷擊痕)
  ] },
  euc:      { h: 98, r: 2.6, parts: [
    { g: cyl(2.2, 3.6, 6, 7), y: 3, c: 0xcfc4b0 },
    { g: cyl(1.6, 2.3, 52, 7), y: 32, c: 0xdbd2c0 },
    { g: cyl(0.9, 1.6, 28, 6), y: 72, c: 0xe3dac8 },
    { g: cyl(0.16, 0.2, 12, 4), y: 20, px: 2.1, c: 0x9a8a76 },   // 剝落樹皮絲帶
    { g: cyl(0.14, 0.18, 10, 4), y: 44, px: -2.0, pz: 0.8, rz: 0.12, c: 0xa89884 },
    { g: cyl(0.15, 0.19, 11, 4), y: 60, px: 1.6, pz: -1.2, rz: -0.1, c: 0xb0a28c },
    { g: ico(3.5), y: 70, px: 6.5, sy: 0.6, c: 0x86985e },       // 低位側簇(銀綠)
    { g: cyl(0.5, 0.9, 18, 5), y: 80, px: 3.5, rz: -0.55, c: 0xcfc4b0 },  // 側枝外端朝上
    { g: cyl(0.5, 0.8, 16, 5), y: 76, px: -3.2, rz: 0.6, c: 0xd6ccba },
    { g: ico(7), y: 90, sy: 0.7, c: 0x5c7a4a },
    { g: ico(5.5), y: 84, px: 8.5, sy: 0.65, c: 0x738a52 },      // 橄欖偏黃簇(桉葉銀綠層次)
    { g: ico(5), y: 80, px: -8, sy: 0.65, c: 0x5c7a4a },
    { g: ico(4.5), y: 83, pz: 7.5, sy: 0.6, c: 0x648250 },
    { g: ico(4), y: 96, c: 0x7a9058 },
  ] },
  dougfir:  { h: 100, r: 2.5, parts: [
    { g: cyl(2.5, 4.0, 6, 7), y: 3, c: 0x5d4027 },
    { g: cyl(1.8, 2.6, 42, 7), y: 27, c: 0x694a2d },
    { g: cyl(2.52, 2.62, 8, 7), y: 13, c: 0x49663a },            // 樹幹苔蘚環帶
    { g: ico(3.2), y: 34, pz: 6, sy: 0.55, c: 0x3a7a52 },
    { g: cone(11, 22, 8), y: 52, c: 0x2f5e40 },
    { g: cone(9, 20, 8), y: 65, c: 0x35684a },
    { g: cone(7, 18, 7), y: 78, c: 0x2f5e40 },
    { g: cone(4.5, 16, 7), y: 90, c: 0x35684a },
    { g: cone(2, 11, 6), y: 99, c: 0x2f5e40 },
    { g: ico(4), y: 46, px: 6, sy: 0.6, c: 0x35684a },
    { g: ico(4), y: 42, px: -6, sy: 0.6, c: 0x2f5e40 },
    { g: cone(1.2, 5, 4), y: 48, px: 7.5, rx: Math.PI, c: 0x7fa06a },   // 枝下垂掛松蘿
    { g: cone(1.0, 4, 4), y: 60, px: -6.5, rx: Math.PI, c: 0x8aa876 },
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
    { g: cone(1.1, 4.5, 4), y: 50, px: 6, rx: Math.PI, c: 0xa8c0a8 },   // 老人鬚地衣(灰綠垂簾)
    { g: cone(0.9, 3.6, 4), y: 62, px: -5.5, rx: Math.PI, c: 0x9db89d },
    { g: ico(3), y: 88, px: 4, sy: 0.6, c: 0x529272 },           // 頂部亮青簇
  ] },
  meranti:  { h: 95, r: 2.5, parts: [
    { g: cone(3.0, 10, 3), y: 5, px: 2.6, c: 0x8a7354 },         // 板根鰭
    { g: cone(3.0, 10, 3), y: 5, px: -1.5, pz: 2.3, c: 0x93805e },
    { g: cone(3.0, 10, 3), y: 5, px: -1.5, pz: -2.3, c: 0x8a7354 },
    { g: cyl(1.5, 2.5, 52, 7), y: 30, c: 0xa08462 },
    { g: cyl(0.9, 1.5, 20, 6), y: 66, c: 0xa89068 },
    { g: cyl(0.5, 0.8, 14, 5), y: 74, px: 4, rz: -1.0, c: 0x93805e },     // 側枝外端朝上
    { g: cyl(0.5, 0.8, 14, 5), y: 76, px: -4, rz: 1.0, c: 0x93805e },
    { g: ico(12), y: 82, sy: 0.55, c: 0x4a8a3e },                // 傘狀突出樹冠(熱帶亮綠)
    { g: ico(8), y: 78, px: 9.5, sy: 0.5, c: 0x57994a },
    { g: ico(8), y: 76, px: -9.5, sy: 0.5, c: 0x4a8a3e },
    { g: ico(7), y: 79, pz: 9, sy: 0.5, c: 0x57994a },
    { g: ico(7), y: 77, pz: -9, sy: 0.5, c: 0x4a8a3e },
    { g: ico(6), y: 88, sy: 0.6, c: 0x8fa054 },                  // 開花期淡黃冠頂
    { g: cyl(0.1, 0.16, 26, 4), y: 40, px: 2.8, rz: 0.06, c: 0x6a7a44 },   // 纏繞藤蔓
    { g: ico(5), y: 92, px: 4, sy: 0.55, c: 0x63a850 },          // 突出主冠的受光新葉
  ] },
  taiwania: { h: 86, r: 2.1, parts: [
    { g: cyl(2.1, 3.4, 5, 7), y: 2.5, c: 0x8a5a38 },             // 紅褐樹皮(台灣杉特徵)
    { g: cyl(1.4, 2.2, 38, 7), y: 24, c: 0x96603a },
    { g: cone(8, 14, 7), y: 45, c: 0x2c6242 },
    { g: cone(6.5, 13, 7), y: 56, c: 0x347050 },
    { g: cone(5, 12, 7), y: 67, c: 0x2c6242 },
    { g: cone(3.2, 11, 6), y: 77, c: 0x347050 },
    { g: cone(1.6, 9, 5), y: 85, c: 0x2c6242 },
    { g: ico(3.5), y: 38, px: 4.5, sy: 0.65, c: 0x347050 },
    { g: ico(3.5), y: 34, px: -4.5, sy: 0.65, c: 0x2c6242 },
    { g: cyl(0.2, 0.35, 6, 4), y: 88, px: 0.8, rz: 0.5, c: 0x9a7a56 },   // 頂梢突出枯枝(基部埋回頂冠內)
    { g: ico(3), y: 50, pz: 5, sy: 0.6, c: 0x3f7a52 },
  ] },
  dinizia:  { h: 88, r: 2.7, parts: [                            // 亞馬遜天使樹(Dinizia excelsa 88m)
    { g: cone(3.4, 11, 3), y: 5.5, px: 2.8, c: 0x7a5a40 },       // 高聳板根
    { g: cone(3.4, 11, 3), y: 5.5, px: -1.6, pz: 2.6, c: 0x846248 },
    { g: cone(3.4, 11, 3), y: 5.5, px: -1.6, pz: -2.6, c: 0x7a5a40 },
    { g: cyl(1.7, 2.7, 48, 7), y: 28, c: 0x96704e },             // 淡紅褐通直巨幹
    { g: cyl(1.0, 1.7, 18, 6), y: 61, c: 0xa07a54 },
    { g: cyl(0.5, 0.9, 15, 5), y: 70, px: 4.5, rz: -1.05, c: 0x846248 },  // 側枝外端朝上
    { g: cyl(0.5, 0.9, 15, 5), y: 72, px: -4.5, rz: 1.05, c: 0x846248 },
    { g: cyl(0.4, 0.7, 12, 5), y: 74, pz: 4, rx: 1.0, c: 0x7a5a40 },
    { g: ico(11), y: 80, sy: 0.5, c: 0x4f8a44 },                 // 傘狀平頂冠(突出主林冠)
    { g: ico(7), y: 77, px: 9, sy: 0.45, c: 0x5c9a50 },
    { g: ico(7), y: 78, px: -9, sy: 0.45, c: 0x468040 },
    { g: ico(6), y: 79, pz: 8.5, sy: 0.45, c: 0x549048 },
    { g: ico(5), y: 85, sy: 0.55, c: 0x86a45c },                 // 頂心黃綠新葉
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
    if (centers.some(([cx, cz]) => Math.hypot(x - cx, z - cz) < 210)) continue;
    const type = species[Math.floor(rnd() * species.length)];
    const def = GIANT_DEFS[type];
    const n = 5 + Math.floor(rnd() * 7);          // 一群 5~11 株
    const cr = 34 + rnd() * 48;                   // 群落半徑(株體放大 → 群落跟著攤開)
    const base = (0.75 + rnd() * 0.35) * OVER.giant;   // 群落基準體格(隨建物佔地等比放大)
    let added = 0;
    const trunks = [];   // 本群樹幹腳印:迴圈後才整圓封鎖(不干擾同群後續植株的群聚)
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2, d = k === 0 ? 0 : 10 + rnd() * cr;
      const gx = x + Math.cos(a) * d, gz = z + Math.sin(a) * d;
      if (blocked.has(cellKey(gx, gz))) continue;
      const gy = terrain.heightAt(gx, gz);
      if (gy < 0.4) continue;
      const s = base * (0.72 + rnd() * 0.63);     // 株高變異:約 63~223m
      (items[type] ??= []).push({
        x: gx, y: gy, z: gz, s,
        ry: rnd() * Math.PI * 2,
        tx: (rnd() - 0.5) * 0.05, tz: (rnd() - 0.5) * 0.05,
      });
      blockers.push({ x: gx, z: gz, y: gy - 1, r: def.r * s + 0.6, h: def.h * s + 1 });
      blocked.add(cellKey(gx, gz));               // 小植被/地被不長進樹幹
      trunks.push([gx, gz, def.r * s + 8]);       // 巨幹半徑可 >10m 網格;+8 淨距 = 樹冠不貼建物牆面
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
    for (const [tx, tz, tr] of trunks) blockArea(blocked, tx, tz, tr);   // 建物/小植被避開整根巨幹
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
//       'shop' 底層店面(彩色遮陽棚 + 亮櫥窗)| 'hband' 整層水平帶窗(現代主義商辦)
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
  if (style === 'hband') {                                               // 整層絲帶窗 + 豎框
    for (let r = 0; r < rows; r++) {
      const y = 12 + r * ch + ch * 0.26, h = ch * 0.5;
      cx.fillStyle = winC; cx.fillRect(3, y, W - 6, h);
      cx.fillStyle = 'rgba(255,255,255,0.35)'; cx.fillRect(3, y, W - 6, h * 0.22);
      cx.fillStyle = 'rgba(255,255,255,0.45)';
      for (let c = 1; c < cols; c++) cx.fillRect(c * cw - 1, y, 2, h);
      if (rnd() < litRatio) { ex.fillStyle = '#ffb45e'; ex.fillRect(3, y, W - 6, h); }
    }
  } else for (let r = 0; r < rows; r++) {
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
// 2026-07-10 擴充二:焦糖/赭石/鼠尾草綠/霧藍/玫瑰灰、深青玻璃/古銅/板岩/暮紫;
// 2026-07-12 擴充三:BOTW 水彩灰泥系 —— 奶油白/陶土橘/苔綠/粉青/杏褐、湖青/藤紫/松石/暖沙)
const PALETTE = {
  residential: [0xc4b8a8, 0xb0a494, 0xccc0b4, 0xa8b0ac, 0xc8b09a, 0xb8ac9c,
                0xc99a7e, 0xb3766a, 0xd6c48e, 0x9db3a4, 0xa9b8c8, 0xd8cfc4,
                0xd9a06a, 0xa77e5f, 0xc5cfa8, 0x8fa6b8, 0xd7b8b0, 0xbfae8e,
                0xe0cba8, 0xc98a5e, 0x9fae8e, 0xb8c4d6, 0xcc9e8a, 0xa89a78],
  commercial:  [0x7a92a4, 0x6a8294, 0x8aa0b0, 0x9aa8b0, 0x708898, 0x84909c,
                0x5f7d8c, 0x7f96b2, 0x6e8a7a, 0x8d95ac, 0x9fb4bd, 0x63707e,
                0x4f7a72, 0x8a7a5f, 0x50606e, 0x7c88a8, 0x9aa899, 0x6a7f95,
                0x486a80, 0x7aa0a8, 0x94a4c0, 0x5f8a80, 0x8f9a78, 0x6a7a9c],
};

// 立面樣式變體:同類建物分七款(窗格節奏/窗色/亮燈率/樣式/屋頂色),
// 街景擺脫「同一張貼圖複製貼上」;v 在建物生成時決定性分配
const FACADES = {
  residential: [
    { key: 'res0', cols: 5, rows: 7, winC: '#3a4046', lit: 0.3,  style: 'shop',    roof: 0x9c8e7c },
    { key: 'res1', cols: 4, rows: 6, winC: '#46525e', lit: 0.22, style: 'balcony', roof: 0x8a6f5a },
    { key: 'res2', cols: 6, rows: 8, winC: '#333b42', lit: 0.36, style: 'plain',   roof: 0x7a8577 },
    { key: 'res3', cols: 3, rows: 5, winC: '#4a3f38', lit: 0.26, style: 'balcony', roof: 0xa2543e },
    { key: 'res4', cols: 5, rows: 6, winC: '#3d4750', lit: 0.32, style: 'shop',    roof: 0x6e7f8a },
    { key: 'res5', cols: 4, rows: 5, winC: '#3f4a3a', lit: 0.28, style: 'plain',   roof: 0xb98455 },
    { key: 'res6', cols: 6, rows: 7, winC: '#52453c', lit: 0.24, style: 'balcony', roof: 0x87795f },
  ],
  commercial: [
    { key: 'com0', cols: 7, rows: 13, winC: '#2e3c4a', lit: 0.55, style: 'plain',   roof: 0x707c88 },
    { key: 'com1', cols: 9, rows: 16, winC: '#243240', lit: 0.68, style: 'curtain', roof: 0x5c6874 },
    { key: 'com2', cols: 6, rows: 11, winC: '#35424e', lit: 0.45, style: 'shop',    roof: 0x86766a },
    { key: 'com3', cols: 5, rows: 14, winC: '#1f3a38', lit: 0.6,  style: 'hband',   roof: 0x4f6a66 },
    { key: 'com4', cols: 8, rows: 12, winC: '#2c3350', lit: 0.5,  style: 'curtain', roof: 0x5a5f7c },
    { key: 'com5', cols: 10, rows: 15, winC: '#1e2e3e', lit: 0.62, style: 'hband',  roof: 0x6a7a6a },
    { key: 'com6', cols: 6, rows: 12, winC: '#2a3a46', lit: 0.4,  style: 'shop',    roof: 0x7c6a58 },
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
// 大霸尖山(酒桶狀霸尖)/ 摩艾石像群 / 馬丘比丘梯田遺跡 / 巨石陣 /
// 百內三塔(花崗岩尖塔群)/ 張家界石柱(石英砂岩方柱)。
// 公稱高即真實比例(×OVER.mega = 1;放置縮放後約 90~160m);col = 近似碰撞柱(× s),
// s = 放置縮放區間。岩面走 envMat + 頂部苔蘚投影(botw_plan 岩石要點)。
function rockMat(color, moss = 0) {
  return envMat(color, { wash: 0.6, cool: 0.5, moss: moss ? { amount: moss } : null });
}
const MEGALITHS = {
  // col.r 一律涵蓋岩體實際外廓(含側肩/山腳錐):低估半徑 = 其他物件沉進崖錐
  elcap: { col: { r: 38, h: 112 }, s: [0.8, 1.4],
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
  uluru: { col: { r: 88, h: 62 }, s: [1.0, 1.7],   // 含東側低伏 hump(px 66 + r31)
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
  augustus: { col: { r: 80, h: 50 }, s: [0.9, 1.6],   // 主脊 sx1.7 → 實際外廓 ~78
    anchor: { topY: 46, topR: 22, side: { y: [8, 34], rx: 76, rz: 47, dome: true } },
    build: (g) => {
    const ridge = new THREE.Mesh(new THREE.SphereGeometry(46, 11, 8), rockMat(0x9a6248, 0.45));
    ridge.scale.set(1.7, 0.95, 1.05); ridge.position.y = 2; g.add(ridge); // 主山脊(帶植被苔蘚)
    const peak = new THREE.Mesh(new THREE.SphereGeometry(24, 9, 7), rockMat(0xa86e50, 0.4));
    peak.scale.set(1.1, 0.9, 0.9); peak.position.set(-30, 26, 0); g.add(peak);
    const toe = new THREE.Mesh(new THREE.SphereGeometry(20, 9, 6), rockMat(0x8f5a42, 0.5));
    toe.scale.set(1.3, 0.6, 1.0); toe.position.set(52, 4, 8); g.add(toe);
  } },
  dabajian: { col: { r: 40, h: 96 }, s: [0.8, 1.5],   // 含 44m 山體基座錐
    anchor: { topY: 97, topR: 12, side: { y: [34, 86], rx: 20, rz: 20, dome: false } },
    build: (g) => {
    // 山體基座拉高:霸尖圓柱(r≈20)起於 y=30,錐體該處半徑 44×(1−30/58)=21 ≥ 柱半徑
    // —— 柱身與山體相接,不是擱在山尖上懸挑
    const base = new THREE.Mesh(cone(44, 58, 9), rockMat(0x7d7466, 0.45));
    base.position.y = 29; g.add(base);                                    // 山體基座
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
  machupicchu: { col: { r: 42, h: 44 }, s: [1.0, 1.7],   // 底層梯田 64×52 半對角
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
  torres: { col: { r: 34, h: 120 }, s: [0.8, 1.4],   // 塔群外緣 px20 + r13
    anchor: { topY: 28, topR: 2.5, side: { y: [26, 90], rx: 24, rz: 15, dome: false } },
    build: (g, rnd) => {
    // 百內三塔:淺色花崗岩塔身 + 暗色角頁岩殘帽,底部共用碎石肩
    for (const [px, h, r] of [[-18, 96, 11], [2, 120, 13], [20, 82, 10]]) {
      const pz = (rnd() - 0.5) * 6;
      const body = new THREE.Mesh(cyl(r * 0.45, r, h, 7), rockMat(0xd0c3ae, 0.12));
      body.position.set(px, h / 2, pz); g.add(body);
      const cap = new THREE.Mesh(cyl(r * 0.28, r * 0.48, h * 0.14, 6), rockMat(0x4e4a48));
      cap.position.set(px, h * 0.98, pz); g.add(cap);
    }
    const shoulder = new THREE.Mesh(cone(30, 30, 8), rockMat(0x8f8474, 0.4));
    shoulder.position.y = 15; g.add(shoulder);
  } },
  karst: { col: { r: 18, h: 104 }, s: [0.8, 1.4],
    anchor: { topY: 100, topR: 7, side: { y: [15, 85], rx: 9, rz: 8, dome: false } },
    build: (g, rnd) => {
    // 張家界石柱:石英砂岩方柱疊層(上收 + 錯位微轉),崖頂綠冠環繞
    let y = 0;
    const w0 = 22;
    for (const [i, hh] of [20, 16, 18, 15, 17, 14].entries()) {
      const f = 1 - i * 0.08;
      const st = new THREE.Mesh(new THREE.BoxGeometry(w0 * f, hh, w0 * 0.85 * f),
        rockMat(i % 2 ? 0x8a7a5e : 0x7a6a50, i % 2 ? 0.12 : 0));
      st.position.y = y + hh / 2; st.rotation.y = (rnd() - 0.5) * 0.24; y += hh; g.add(st);
    }
    for (const a of [0.4, 2.3, 4.4]) {   // 崖頂綠冠(頂緣三簇,中央留給石屋/疊石)
      const crown = new THREE.Mesh(ico(5.5), toonMat(0x3f7a44));
      crown.scale.y = 0.55;
      crown.position.set(Math.cos(a) * 6.5, y + 1.5, Math.sin(a) * 5.5); g.add(crown);
    }
  } },
};

// ---- 巨岩表面特徵:高壓電塔 / 石砌屋 / 疊石堆 / 鳥巢(岩台)/ 峭壁樹·岩菇 ----
// 在岩體 local 座標放置(隨岩體旋轉縮放),特徵自身尺寸 ÷ s 抵銷縮放 →
// 世界尺寸恆定;anchor 描述可放置面:topY/topR 平頂;side = 單一側壁橢圓或
// 「柱群」陣列(每柱 {px,pz,rx,rz,y,topY,dome|taper}),半徑隨高度收縮
// (dome √(1−u²) / taper 線性)⇒ 特徵貼壁不懸空。
// 頂面特徵一律「塞不下就縮小到剛好」:sc = min(想要的, 頂面半徑/自身腳印),
// 縮到下限仍塞不下才放棄;偏移量同步夾在「頂半徑 − 腳印」內。
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
  // 峭壁樹/岩菇:基部 = 「彎曲水管」式圓弧彎頭 —— 等長等徑圓管沿圓弧等角步進、
  // 節間塞關節球蓋接縫;入壁角 bend 依壁面斜率(垂直壁 = 90° 彎頭、斜壁彎得少),
  // 出彎後幹身直立、樹冠/蕈傘恆朝上(向光性)。放置只繞 Y 對齊方位,
  // MUST NOT 整棵外傾 —— 「冠部朝上」是規格,不是姿態變化。
  const cliffPlant = (mush, bend) => {
    const t = new THREE.Group();
    const stemC = mush ? 0xd6cba8 : 0x6b4a30;
    const nSeg = Math.max(2, Math.round(bend / 0.32));   // 每 ~18° 一節:90° 彎頭約 5 節
    const segL = 1.05, pipeR = mush ? 0.42 : 0.36;       // 水管:等徑,不收分
    // 起點沿入壁方向反推埋進壁內,彎出來才像「自岩縫鑽出」
    let jx = -Math.sin(bend) * 0.8, jy = -Math.cos(bend) * 0.8 - 0.1;
    const kneeAt = (x, y) => {
      const knee = new THREE.Mesh(ico(pipeR * 1.04), toonMat(stemC));
      knee.position.set(x, y, 0);
      t.add(knee);
    };
    kneeAt(jx, jy);
    for (let i = 0; i < nSeg; i++) {
      const phi = bend * (1 - (i + 0.5) / nSeg);         // 等角步進 = 圓弧彎頭(+x = 壁外)
      const seg = new THREE.Mesh(cyl(pipeR, pipeR, segL, 6), toonMat(stemC));
      seg.position.set(jx + Math.sin(phi) * segL / 2, jy + Math.cos(phi) * segL / 2, 0);
      seg.rotation.z = -phi;
      t.add(seg);
      jx += Math.sin(phi) * segL; jy += Math.cos(phi) * segL;
      kneeAt(jx, jy);
    }
    if (mush) {   // 岩菇:蕈柄彎附岩壁,蕈傘水平朝上 + 傘底淺色菌褶
      const capC = [0xc25c4a, 0xd8a04a, 0x8a6ab8][Math.floor(rnd() * 3)];
      const cap = new THREE.Mesh(cone(1.6, 1.1, 8), toonMat(capC));
      cap.position.set(jx, jy + 0.72, 0); t.add(cap);
      const gill = new THREE.Mesh(cyl(1.15, 1.3, 0.3, 8), toonMat(0xe8dfc0));
      gill.position.set(jx, jy + 0.15, 0); t.add(gill);
    } else {      // 峭壁松:直立樹幹(接續水管徑,向上收分)+ 疊層樹冠
      const trunk = new THREE.Mesh(cyl(0.22, pipeR, 2.2, 6), toonMat(stemC));
      trunk.position.set(jx, jy + 1.1, 0); t.add(trunk);
      const c1 = new THREE.Mesh(cone(1.9, 3.2, 6), toonMat(0x2f5e40));
      c1.position.set(jx, jy + 3.2, 0); t.add(c1);
      const c2 = new THREE.Mesh(cone(1.3, 2.5, 6), toonMat(0x35684a));
      c2.position.set(jx, jy + 5.1, 0); t.add(c2);
    }
    return t;
  };

  const topWorldY = anchor.topY * s;
  const topRW = anchor.topR * s;   // 頂面半徑(世界公尺;特徵尺寸也是世界公尺,同單位才能比)
  // 腳印夾算:want = 想要的世界尺寸,foot = 該特徵世界腳印半徑(sc=1 時)。
  // 塞不下 → 縮到剛好;縮到 lo 仍塞不下 → 回傳 0 = 放棄。偏移(local)夾在剩餘空間內。
  const fit = (want, foot, lo) => {
    const sc = Math.min(want, topRW / foot);
    return sc >= lo ? sc : 0;
  };
  const margin = (sc, foot) => Math.max(0, anchor.topR - foot * sc / s);
  if (topWorldY > 45 && rnd() < 0.5) {                       // 高壓電塔:夠高的頂才架線
    const sc = fit(0.55 + rnd() * 0.25, 8.5, 0.28);
    if (sc) {
      const pylon = new THREE.Group();
      LANDMARKS.power(pylon);
      const m = margin(sc, 8.5);
      put(pylon, (rnd() - 0.5) * m, anchor.topY - 1, (rnd() - 0.5) * m, sc);
    }
  }
  if (rnd() < 0.7) {                                         // 石砌屋 1~2 間
    const n = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const sc = fit(0.9 + rnd() * 0.5, 3.2, 0.4);
      if (!sc) break;
      const h = stoneHut();
      h.rotation.y = rnd() * Math.PI * 2;
      const m = margin(sc, 3.2);
      put(h, (rnd() - 0.5) * m, anchor.topY - 0.3, (rnd() - 0.5) * m, sc);
    }
  }
  if (rnd() < 0.7) {                                         // 疊石堆
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const sc = fit(1 + rnd() * 0.8, 1.2, 0.45);
      if (!sc) break;
      const m = margin(sc, 1.2);
      put(cairn(), (rnd() - 0.5) * m * 1.6, anchor.topY - 0.2, (rnd() - 0.5) * m * 1.6, sc);
    }
  }
  {   // 鳥巢:先鋪一塊「平坦面朝正上」的岩台,鳥巢放台上(圓頂/窄頂也有水平落腳)
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const sc = fit(1 + rnd() * 0.8, 2.0, 0.4);
      if (!sc) break;
      const grp = new THREE.Group();
      const pad = new THREE.Mesh(cyl(1.5, 1.8, 0.55, 7), rockMat(0x8f8a80));
      pad.position.y = 0.28; grp.add(pad);
      const ne = nest();
      ne.position.y = 0.56; grp.add(ne);
      noOut(grp);
      const a = rnd() * Math.PI * 2;
      const rr = Math.min(anchor.topR * 0.8, margin(sc, 2.0));   // 沿頂緣一圈,但不掉出頂面
      put(grp, Math.cos(a) * rr, anchor.topY - 0.35, Math.sin(a) * rr, sc);
    }
  }
  // 峭壁樹/岩菇:side = 單一側壁或柱群陣列;半徑取「該柱該高度」的收縮值
  const sides = Array.isArray(anchor.side) ? anchor.side : anchor.side ? [anchor.side] : [];
  if (sides.length) {
    const n = 2 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const sd = sides[Math.floor(rnd() * sides.length)];
      const a = rnd() * Math.PI * 2;
      const y = sd.y[0] + rnd() * (sd.y[1] - sd.y[0]);
      const topRef = sd.topY ?? anchor.topY;   // 柱群各柱自帶高度基準
      const u = y / Math.max(1, topRef);
      const f = sd.dome ? Math.sqrt(Math.max(0.08, 1 - u * u))
        : sd.taper != null ? Math.max(0.08, 1 - (1 - sd.taper) * u) : 1;
      const er = (sd.rx * sd.rz) / Math.hypot(sd.rz * Math.cos(a), sd.rx * Math.sin(a));   // 橢圓邊界半徑
      const mush = rnd() < (u < 0.4 ? 0.5 : 0.15);   // 低處背陰長菇,高處長松
      // 入壁彎角依壁面斜率:m = |dr/dy|(壁面每升 1m 內收多少)。
      // 直壁 m=0 → 90° 彎頭;球面肩部/斜壁 m 大 → 淺彎。
      const m = sd.dome ? (er * u) / (Math.max(1, topRef) * Math.max(0.25, Math.sqrt(1 - u * u)))
        : sd.taper != null ? er * (1 - sd.taper) / Math.max(1, topRef) : 0;
      const t = cliffPlant(mush, Math.PI / 2 - Math.atan(m));
      t.rotation.set(0, -a, 0);   // 只轉方位;彎的是水管基部,冠永遠朝上
      put(t, (sd.px || 0) + Math.cos(a) * er * f * 0.99, y, (sd.pz || 0) + Math.sin(a) * er * f * 0.99, 0.8 + rnd() * 0.8);
    }
  }
}

// ---- 合成巨岩:抽組名岩「特徵基因」隨機重組,每顆獨一無二 ----
// 主體(圓頂=烏魯魯系/岩壁=酋長岩系/岩層塔=大霸系/尖峰/天然岩拱/平頂桌山/
// 蘑菇岩群=風化 hoodoo/刃狀岩脊)× 伴生小圓丘 × 崩落岩塊 × 侵蝕溝 × 碎石坡 ×
// 鑿面稜線 × 岩色系(18 色);回傳 col/anchor 供放置與表面特徵。
const ROCK_TONES = [0xb3502e, 0xc9c4b8, 0x9a6248, 0x6f6a62, 0xa8875c, 0x8f8878,
                    0xd8b878, 0xc49a8a, 0x5a6470, 0xd4cdb8, 0x7a6a52, 0x996a3e,
                    0x4a4a52, 0xb87850, 0xd8c890, 0x7a8a92, 0x8a7a88, 0x6a5a44];
function synthMegalith(g, rnd) {
  const base = new THREE.Color(ROCK_TONES[Math.floor(rnd() * ROCK_TONES.length)]);
  const shade = (dl) => base.clone().offsetHSL(0, 0, dl).getHex();
  const moss = rnd() < 0.55 ? 0.2 + rnd() * 0.35 : 0;
  // basalt/granite/marble(2026-07-12):多塊大石拼接 —— 依真實岩石節理各有拼法:
  // 玄武岩 = 柱狀節理(高低參差的六角/方/圓柱束,巨人堤道式);
  // 花崗岩 = 大塊方料錯縫整齊疊置(節理稀疏 → 巨大規則岩塊,tor 岩堆);
  // 大理岩 = 大小互異的渾圓岩塊堆疊互倚(溶蝕圓稜,大塊在下小塊在上)
  const kinds = ['dome', 'slab', 'tower', 'spire', 'arch', 'mesa', 'hoodoo', 'fin',
                 'basalt', 'granite', 'marble'];
  const main = kinds[Math.floor(rnd() * kinds.length)];
  let H = 0, RX = 0, RZ = 0, topR = 6;
  // 側壁錨點逐型定義(貼合主體輪廓;null = 該型側壁放不了樹)。
  // MUST NOT 用最終 RX/RZ 當側壁橢圓:崩落岩塊/伴生圓丘會把包絡撐大,樹就懸在半空。
  let sideDef = null, topYA = null, topRA = null;
  // 鑿面:斜切稜面貼在量體側緣,把圓弧/平板打成手雕硬邊(botw_plan Task 1.1)
  const chisel = (n, rx, rz, hh) => {
    for (let i = 0; i < n; i++) {
      const fw = 8 + rnd() * 12;
      const facet = new THREE.Mesh(new THREE.BoxGeometry(fw, fw * 0.8, fw), rockMat(shade(0.04 + rnd() * 0.06), moss * 0.5));
      const a = rnd() * Math.PI * 2;
      facet.position.set(Math.cos(a) * rx * 0.7, hh * (0.3 + rnd() * 0.4), Math.sin(a) * rz * 0.7);
      facet.rotation.set(rnd() * 0.8, rnd() * Math.PI, rnd() * 0.8);
      g.add(facet);
    }
  };
  if (main === 'dome') {
    const r = 28 + rnd() * 26, sx = 1.1 + rnd() * 0.7, sy = 0.7 + rnd() * 0.55, sz = 0.8 + rnd() * 0.3;
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 11, 8), rockMat(shade(0), moss));
    m.scale.set(sx, sy, sz); m.position.y = 3; g.add(m);
    H = 3 + r * sy; RX = r * sx; RZ = r * sz; topR = Math.min(RX, RZ) * 0.35;
    sideDef = { y: [H * 0.22, H * 0.8], rx: RX, rz: RZ, dome: true };
    chisel(2 + Math.floor(rnd() * 2), RX, RZ, H);
  } else if (main === 'slab') {
    const w = 30 + rnd() * 26, h = 70 + rnd() * 50, d = 16 + rnd() * 12;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rockMat(shade(0), moss));
    m.position.y = h / 2; m.rotation.y = (rnd() - 0.5) * 0.2; g.add(m);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(w * 0.45, h * 0.8, d * 0.8), rockMat(shade(0.04), moss));
    nose.position.set(w * 0.36, h * 0.4, d * 0.2); nose.rotation.y = 0.45; g.add(nose);
    H = h; RX = w * 0.62; RZ = d * 0.8; topR = Math.min(w, d) * 0.32;
    sideDef = { y: [H * 0.25, H * 0.75], rx: w * 0.52, rz: d * 0.56 };   // 貼牆面,不含鼻樑外擴
    chisel(2 + Math.floor(rnd() * 3), RX, RZ, H * 0.8);
  } else if (main === 'tower') {
    const r0 = 17 + rnd() * 8, bh = 24 + rnd() * 14;
    const baseC = new THREE.Mesh(cone(r0 * 2.2, bh, 9), rockMat(shade(0.03), 0.35));
    baseC.position.y = bh / 2; g.add(baseC);
    // 柱基自錐體半高起(該處錐半徑 1.1×r0 ≥ 柱半徑)—— 柱是「從山裡長出來」,
    // 不是擱在山尖上;柱基寬過錐面 = 懸挑,物理不成立(魔鬼塔的崖錐與柱身相接)
    let y = bh * 0.5, r = r0;
    const nL = 5 + Math.floor(rnd() * 3);
    for (let i = 0; i < nL; i++) {
      const band = i % 2 === 1, hh = band ? 3.5 : 9 + rnd() * 5;
      const st = new THREE.Mesh(cyl(r * (band ? 1.06 : 1), r * (band ? 1.06 : 1) + 1, hh, 10),
        rockMat(shade(band ? 0.06 : -0.03), band ? 0.12 : 0));
      st.position.y = y + hh / 2; y += hh; g.add(st);
      if (!band) r *= 0.92;
    }
    H = y; RX = RZ = r0 * 2.0; topR = r * 0.85;   // footprint 含 2.2×r0 山腳崖錐
    sideDef = { y: [bh, H * 0.85], rx: r0 * 1.05, rz: r0 * 1.05, taper: 0.62 };   // 沿岩層上收
  } else if (main === 'arch') {   // 天然岩拱:雙墩 + 頂樑 + 拱背圓丘
    const span = 26 + rnd() * 14, ph = 34 + rnd() * 22, pw = 10 + rnd() * 5;
    const cols = [];
    for (const sgn of [-1, 1]) {
      const pier = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pw * 1.3), rockMat(shade(sgn * 0.03), moss));
      pier.position.set(sgn * span / 2, ph / 2, 0); pier.rotation.y = sgn * 0.15; g.add(pier);
      // 兩座橋墩各自是可附著側壁(內縮吃掉 ±0.15 微轉),樹菇長在墩壁不掛拱洞
      cols.push({ px: sgn * span / 2, pz: 0, rx: pw * 0.46, rz: pw * 0.6, y: [ph * 0.15, ph * 0.8], topY: ph });
    }
    sideDef = cols;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span + pw * 1.6, pw * 0.9, pw * 1.1), rockMat(shade(0.05), moss));
    beam.position.y = ph + pw * 0.45; g.add(beam);
    const hump = new THREE.Mesh(new THREE.SphereGeometry(pw * 0.9, 8, 6), rockMat(shade(0.02), moss));
    hump.scale.set((span + pw) / (pw * 1.8), 0.7, 1); hump.position.y = ph + pw * 0.8; g.add(hump);
    H = ph + pw * 1.3; RX = span / 2 + pw; RZ = pw * 1.4; topR = 3;
  } else if (main === 'mesa') {   // 平頂桌山:裙狀崖錐 + 疊層 + 開闊平頂
    const r0 = 30 + rnd() * 22, h = 40 + rnd() * 26;
    // 崖錐加寬拉高:疊層起點(0.3h)處錐半徑 ≈ 疊層半徑,崖壁與崖錐相接不懸挑
    const skirt = new THREE.Mesh(cone(r0 * 2.2, h * 0.62, 10), rockMat(shade(0.05), 0.3));
    skirt.position.y = h * 0.31; g.add(skirt);
    let y = h * 0.3;
    for (const [f, hh, dl] of [[1.12, h * 0.22, -0.04], [1.04, h * 0.16, 0.05], [1.0, h * 0.32, -0.02]]) {
      const st = new THREE.Mesh(cyl(r0 * f * 0.94, r0 * f, hh, 10), rockMat(shade(dl)));
      st.position.y = y + hh / 2; y += hh; g.add(st);
    }
    H = y; RX = RZ = r0 * 2.0; topR = r0 * 0.8;   // footprint 含 2.2×r0 裙狀崖錐
    sideDef = { y: [H * 0.4, H * 0.9], rx: r0 * 1.1, rz: r0 * 1.1, taper: 0.92 };   // 疊層段近直壁
  } else if (main === 'hoodoo') {   // 風化蘑菇岩群:細腰石柱頂著過寬帽岩
    const n = 2 + Math.floor(rnd() * 3);
    const cols = [];
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, d = i === 0 ? 0 : 14 + rnd() * 20;
      const px = Math.cos(a) * d, pz = Math.sin(a) * d;
      const h = 26 + rnd() * 30, r = 5 + rnd() * 4;
      const neck = new THREE.Mesh(cyl(r * 0.55, r, h, 8), rockMat(shade(0.03)));
      neck.position.set(px, h / 2, pz); g.add(neck);
      const cap = new THREE.Mesh(cyl(r * 1.5, r * 0.9, h * 0.16, 8), rockMat(shade(-0.08), 0.15));
      cap.position.set(px, h * 1.02, pz); g.add(cap);
      // 頂錨綁「中央柱」帽岩頂面(特徵放置以原點為準;掛在群體最高點必懸空)
      if (i === 0) { topYA = h * 1.1; topRA = r * 1.1; }
      // 每根柱各自是一面可附著側壁(頸部上收 55%),樹菇/侵蝕溝貼各柱的壁
      cols.push({ px, pz, rx: r * 0.98, rz: r * 0.98, y: [h * 0.15, h * 0.8], taper: 0.57, topY: h });
      H = Math.max(H, h * 1.1);
      RX = RZ = Math.max(RX, d + r * 1.5);
    }
    sideDef = cols;
    topR = 3;
  } else if (main === 'fin') {   // 刃狀岩脊:一列薄板岩沿走向漸縮、微錯位
    const n = 3 + Math.floor(rnd() * 3);
    const cols = [];
    let px = -(n - 1) * 8;
    for (let i = 0; i < n; i++) {
      const f = 1 - Math.abs(i - (n - 1) / 2) / n;   // 中央最高
      const h = (55 + rnd() * 45) * (0.55 + f * 0.45), w = 12 + rnd() * 6, d = 5 + rnd() * 4;
      const bz = (rnd() - 0.5) * 6;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rockMat(shade((rnd() - 0.5) * 0.1), moss * f));
      blade.position.set(px, h / 2, bz);
      blade.rotation.y = (rnd() - 0.5) * 0.3;
      blade.rotation.z = (rnd() - 0.5) * 0.1;
      g.add(blade);
      // 每片刃岩自成一面側壁(略內縮吃掉微轉/微傾的誤差),樹菇貼刃面長
      cols.push({ px, pz: bz, rx: w * 0.46, rz: d * 0.5, y: [h * 0.15, h * 0.7], topY: h });
      H = Math.max(H, h);
      RX = Math.max(RX, Math.abs(px) + w);
      px += 14 + rnd() * 5;
    }
    sideDef = cols;
    RZ = 12; topR = 4;
    topYA = 0.2; topRA = 4;   // 刃嶺頂是一排參差薄脊,頂面特徵落地放刃間
  } else if (main === 'basalt') {   // 柱狀玄武岩束:高低參差的六角/方/圓柱拼接
    base.set([0x4a4e55, 0x3f4246, 0x565a62, 0x4e4a44][Math.floor(rnd() * 4)]);   // 玄武岩深灰
    const R0 = 16 + rnd() * 10, hMax = 34 + rnd() * 30;
    const nCol = 10 + Math.floor(rnd() * 8);
    for (let i = 0; i < nCol; i++) {
      // 徑向擠壓排列:中央最高、外圈遞減 = 管風琴輪廓(巨人堤道/澎湖柱狀節理)
      const a = rnd() * Math.PI * 2, d = i === 0 ? 0 : Math.sqrt(rnd()) * R0;
      const px = Math.cos(a) * d, pz = Math.sin(a) * d;
      const r = 2.6 + rnd() * 2.2;
      const h = Math.max(8, hMax * (1 - (d / R0) * 0.55) * (0.8 + rnd() * 0.35) * (i === 0 ? 1.1 : 1));
      const t = rnd();
      // 同束柱形一致才像節理:六角為主、偶夾方柱/圓柱段;
      // 柱身向下多長 6m(埋進地基)→ 坡地上外圈柱也確實入土,不懸空
      const geo2 = t < 0.62 ? cyl(r, r * 1.04, h + 6, 6)
        : t < 0.84 ? new THREE.BoxGeometry(r * 1.7, h + 6, r * 1.7)
        : cyl(r, r * 1.04, h + 6, 10);
      // 色差收斂 ±0.02:同束節理是同一次岩漿冷卻,只該有風化深淺
      const col = new THREE.Mesh(geo2, rockMat(shade((rnd() - 0.5) * 0.04), moss * (d / R0) * 0.6));
      col.position.set(px, h / 2 - 3, pz);
      col.rotation.y = rnd() * Math.PI;
      g.add(col);
      // 柱頂斷口:略寬的節理帽蓋(斷面色淺 = 新鮮斷口);中央柱必有 = 頂面特徵落腳點
      if (i === 0 || rnd() < 0.5) {
        const cap = new THREE.Mesh(cyl(r * 1.05, r * 0.95, 1.6, 6), rockMat(shade(0.08)));
        cap.position.set(px, h + 0.8, pz);
        cap.rotation.y = col.rotation.y;
        g.add(cap);
      }
      // 頂錨 = 中央柱帽蓋斷面(特徵放置以群組原點為準,錨在別柱會懸空)
      if (i === 0) { topYA = h + 1.6; topRA = r * 0.9; }
      H = Math.max(H, h + 1.6);
    }
    RX = RZ = R0 + 5; topR = 3;
    sideDef = { y: [H * 0.12, H * 0.6], rx: R0 + 2, rz: R0 + 2, taper: 0.5 };   // 柱束外壁
  } else if (main === 'granite') {   // 花崗岩 tor:大塊方料錯縫整齊疊置
    base.set([0xc9c4b8, 0xbdb2a0, 0xd2cabb, 0xb8b0a4][Math.floor(rnd() * 4)]);   // 淺色花崗岩
    const w0 = 30 + rnd() * 16, d0 = 22 + rnd() * 12;
    const nL = 3 + Math.floor(rnd() * 2);
    let y = -3;   // 底層下沉 3m:坡地上塊底確實入土
    for (let i = 0; i < nL; i++) {
      const f = 1 - i * (0.12 + rnd() * 0.08);      // 逐層內收
      const hh = 12 + rnd() * 9;
      // 每層 1~2 塊並列(錯縫 = 上層縫不對齊下層縫),塊間留 0.8m 節理縫
      const nB = rnd() < 0.5 ? 1 : 2;
      const wL = w0 * f, off0 = (rnd() - 0.5) * 5;
      for (let b2 = 0; b2 < nB; b2++) {
        const wB = nB === 1 ? wL : wL * (0.36 + rnd() * 0.24);
        const px = nB === 1 ? off0 : off0 + (b2 ? 1 : -1) * (wL / 2 - wB / 2) * 1.02;
        // 色差收斂 ±0.015:同一露頭的花崗岩色勻,只留極淡的塊間變化
        const blk = new THREE.Mesh(new THREE.BoxGeometry(wB, hh, d0 * f), rockMat(shade((rnd() - 0.5) * 0.03), i === nL - 1 ? moss : 0));
        blk.position.set(px, y + hh / 2, (rnd() - 0.5) * 2);
        blk.rotation.y = (rnd() - 0.5) * 0.07;      // 整齊拼接:僅極小微轉
        g.add(blk);
      }
      y += hh + 0.5;                                // 層間水平節理縫
    }
    H = y; RX = w0 * 0.62; RZ = d0 * 0.62; topR = Math.min(w0, d0) * 0.3;
    sideDef = { y: [H * 0.15, H * 0.8], rx: w0 * 0.5, rz: d0 * 0.5, taper: 0.72 };
  } else if (main === 'marble') {   // 大理岩堆:大小互異的渾圓岩塊互倚
    base.set([0xd8d3c8, 0xcfc8bc, 0xd4cdc4, 0xc8c4bc][Math.floor(rnd() * 4)]);   // 大理岩灰白
    const R0 = 14 + rnd() * 10;
    const nB = 5 + Math.floor(rnd() * 4);
    let y = 0, rPrev = 0;
    for (let i = 0; i < nB; i++) {
      const r = (12 - i * 1.8) * (0.8 + rnd() * 0.4);   // 大塊在下、小塊在上
      if (r < 3) break;
      // 水平漂移隨層高收斂:頂塊貼近軸心,頂面特徵(錨在原點)才有落腳處
      const drift = Math.max(1.5, (R0 - r) * (1 - i / nB));
      const px = (rnd() - 0.5) * drift, pz = (rnd() - 0.5) * drift;
      // 色差收斂 ±0.02:同一岩體的大理岩塊色近,靠明暗交界讀塊面
      const blk = new THREE.Mesh(ico(r), rockMat(shade((rnd() - 0.5) * 0.04), i < 2 ? moss * 0.6 : 0));
      blk.scale.y = 0.72 + rnd() * 0.2;             // 溶蝕圓稜:壓扁的渾圓塊
      blk.rotation.set(rnd() * 0.5, rnd() * Math.PI, rnd() * 0.5);
      // 上塊坐進下塊間隙(半徑 55% 交疊 = 岩塊互倚,不是懸浮串珠);
      // 底塊心壓到 0.2r:超過半顆入土,坡地上也確實著地
      y = i === 0 ? r * 0.2 : y + rPrev * 0.55 + r * 0.3;
      blk.position.set(px, y, pz);
      g.add(blk);
      rPrev = r;
      H = Math.max(H, y + r * 0.8);
      RX = Math.max(RX, Math.abs(px) + r); RZ = Math.max(RZ, Math.abs(pz) + r);
    }
    topR = 3.5;
    topYA = H * 0.96; topRA = 3;
    sideDef = { y: [H * 0.15, H * 0.7], rx: RX * 0.8, rz: RZ * 0.8, dome: true };
  } else {   // spire 尖峰
    const r0 = 20 + rnd() * 10, h = 80 + rnd() * 45;
    const m = new THREE.Mesh(cone(r0, h, 8), rockMat(shade(0), moss));
    m.position.y = h / 2; g.add(m);
    const m2 = new THREE.Mesh(cone(r0 * 0.6, h * 0.6, 7), rockMat(shade(0.05), moss));
    m2.position.set(r0 * 0.8, h * 0.3, 0); g.add(m2);
    H = h; RX = r0 * 1.5; RZ = r0 * 1.1; topR = 2;
    sideDef = { y: [H * 0.15, H * 0.65], rx: r0, rz: r0, taper: 0.08 };   // 錐面線性收尖
  }
  // 以下崩落岩塊/伴生圓丘只擴 footprint(col);貼壁特徵(側樹/侵蝕溝)
  // 一律走各分支已凍結的 sideDef,MUST NOT 改用撐大後的 RX/RZ(會懸空)
  {   // 崩落岩塊:山腳鑿刻感碎岩(BOTW 手雕硬邊)
    const nB = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < nB; i++) {
      const br = 4 + rnd() * 7, a = rnd() * Math.PI * 2, d = Math.max(RX, RZ) * (0.85 + rnd() * 0.35);
      const bd = new THREE.Mesh(ico(br), rockMat(shade((rnd() - 0.5) * 0.06), moss * 0.6));
      bd.scale.y = 0.6 + rnd() * 0.3;
      bd.rotation.set(rnd() * 0.6, rnd() * Math.PI, rnd() * 0.6);
      // 塊心壓低到 0.1×半徑:過半入土,離群體最遠的崩落塊在坡地上也不懸空
      bd.position.set(Math.cos(a) * d, br * 0.1, Math.sin(a) * d);
      g.add(bd);
      RX = Math.max(RX, Math.abs(Math.cos(a) * d) + br);
      RZ = Math.max(RZ, Math.abs(Math.sin(a) * d) + br);
    }
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
  // 侵蝕溝墨線:貼著側壁錨點放(單壁或柱群逐柱),半徑取「該柱該高度」的收縮值、
  // 溝棒跟著壁面斜率內傾 → 斜壁(尖峰/岩層塔)與柱群(hoodoo/刃嶺/拱墩)都貼壁不懸空
  {
    const ribCols = Array.isArray(sideDef) ? sideDef : sideDef ? [sideDef] : [];
    if (ribCols.length && rnd() < 0.7) {
      const n = 3 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        const cSd = ribCols[Math.floor(rnd() * ribCols.length)];
        const topRef = cSd.topY ?? H;
        const rh = (cSd.y[1] - cSd.y[0]) * (0.45 + rnd() * 0.35);
        const yc = cSd.y[0] + rh / 2 + rnd() * Math.max(0, cSd.y[1] - cSd.y[0] - rh);
        const u = yc / Math.max(1, topRef);
        const f = cSd.dome ? Math.sqrt(Math.max(0.08, 1 - u * u))
          : cSd.taper != null ? Math.max(0.08, 1 - (1 - cSd.taper) * u) : 1;
        const a = rnd() * Math.PI * 2;
        const er = (cSd.rx * cSd.rz) / Math.hypot(cSd.rz * Math.cos(a), cSd.rx * Math.sin(a));
        const rib = new THREE.Mesh(new THREE.BoxGeometry(1.6, rh, 1.3), rockMat(shade(-0.1)));
        const emb = cSd.dome ? 0.92 : 0.98;   // 球面弧度大,埋深一點免得棒端翹出
        rib.position.set((cSd.px || 0) + Math.cos(a) * er * f * emb, yc, (cSd.pz || 0) + Math.sin(a) * er * f * emb);
        rib.rotation.y = -a;
        rib.rotation.x = cSd.dome ? 0.4
          : cSd.taper != null ? Math.atan(cSd.rx * (1 - cSd.taper) / Math.max(1, topRef)) : 0;
        g.add(rib);
      }
    }
  }
  if (rnd() < 0.5) {   // 碎石坡
    const scree = new THREE.Mesh(cone(Math.max(RX, RZ) * 0.8, 10 + rnd() * 8, 9), rockMat(shade(0.06)));
    scree.position.y = 5; scree.scale.z = 0.7; g.add(scree);
  }
  return {
    col: { r: Math.max(RX, RZ) + 4, h: H },
    anchor: { topY: topYA ?? H, topR: topRA ?? topR, side: sideDef },
  };
}

// 山丘頂的「平坦半徑」:自中心逐環外擴,量到「地面比中心低超過 drop」為止。
// 大於此半徑的物件放上去會懸出丘頂(比山丘還大的巨岩)——放置前把腳印縮進來。
function flatRadiusAt(terrain, x, z, rMax, drop = 8) {
  const h0 = terrain.heightAt(x, z);
  for (let rr = 8; rr <= rMax; rr += 6) {
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2 + rr * 0.19;   // 逐環轉相位,免得八方位漏掉窄脊
      if (h0 - terrain.heightAt(x + Math.cos(a) * rr, z + Math.sin(a) * rr) > drop) return Math.max(6, rr - 6);
    }
  }
  return rMax;
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
      s = (0.9 + rnd() * 0.5) * OVER.mega;
    } else {
      const def = MEGALITHS[types[(start + named) % types.length]];
      def.build(g, rnd);
      meta = def;
      s = (def.s[0] + rnd() * (def.s[1] - def.s[0])) * OVER.mega;
    }
    let r = meta.col.r * s;
    // 山丘頂容不下整顆巨岩 → 等比縮到平坦半徑剛好;縮過頭(<45%)不像地標,換點
    const fr = flatRadiusAt(terrain, x, z, r + 6);
    if (fr < r) {
      const shrink = fr / r;
      if (shrink < 0.45) continue;
      s *= shrink;
      r = meta.col.r * s;
    }
    if (x < terrain.minX + r + 24 || x > terrain.maxX - r - 24
      || z < terrain.minZ + r + 24 || z > terrain.maxZ - r - 24) continue;
    let gy = terrain.heightAt(x, z);
    if (gy < 0.4) continue;
    if (!areaFree(blocked, x, z, r + 6)) continue;
    if (placedM.some((p) => Math.hypot(x - p.x, z - p.z) < r + p.r + 70)) continue;
    if (!synth) named++;
    decorateMegalith(g, meta.anchor, rnd, s);
    bakeContactAO(g, 6);   // 接地 AO:巨岩「長」在地上(botw_plan Task 2.2)
    g.scale.setScalar(s);
    // 佔地放大後坡地會露餡:取腳印周圈最低點落底(同建物),寧可陷入山坡不懸空
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2;
      gy = Math.min(gy, terrain.heightAt(x + Math.cos(a) * r * 0.7, z + Math.sin(a) * r * 0.7));
    }
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

/**
 * Overpass `out N` 額度隨 bbox 真實面積縮放(2026-07-17):固定額度對大地圖截斷
 * (依 way id 序,空間上整片缺)、對小地圖浪費 payload/查詢時間。
 * 密度基準以巴黎 L3(~1.18 km²,實測幹道 ~95/小徑 ~1204/建物 ~676 每 km²)加 ~25% 裕度。
 */
function bboxKm2(bbox) {
  const midLat = (bbox.minLat + bbox.maxLat) / 2;
  return (bbox.maxLat - bbox.minLat) * 111.32
       * (bbox.maxLng - bbox.minLng) * 111.32 * Math.cos(midLat * Math.PI / 180);
}
const quotaOf = (km2, perKm2, lo, hi) => Math.max(lo, Math.min(hi, Math.round(km2 * perKm2)));

/** Overpass 圖資(逾時就放棄 → 程序生成備援):建物 + 鐵路/捷運 + 瀑布 */
async function fetchOsmFeatures(bbox) {
  const bb = `${bbox.minLat.toFixed(5)},${bbox.minLng.toFixed(5)},${bbox.maxLat.toFixed(5)},${bbox.maxLng.toFixed(5)}`;
  const nBld = quotaOf(bboxKm2(bbox), 850, 400, 1200);
  const q = `[out:json][timeout:9];`
    + `(way["building"](${bb});node["power"="tower"](${bb}););out center tags ${nBld};`
    + `way["railway"~"^(rail|subway|light_rail|monorail|narrow_gauge|tram)$"](${bb});out geom 60;`
    + `node["railway"="level_crossing"](${bb});out 40;`
    + `node["waterway"="waterfall"](${bb});out 20;`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const resp = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ctrl.signal });
    if (!resp.ok) return null;
    const data = await resp.json();
    const buildings = [], rails = [], falls = [], crossings = [];
    for (const el of data.elements || []) {
      const tags = el.tags || {};
      if (el.type === 'way' && el.geometry && tags.railway) {
        rails.push({ tags, geometry: el.geometry });
      } else if (el.type === 'node' && tags.railway === 'level_crossing') {
        crossings.push({ lat: el.lat, lng: el.lon, tags });
      } else if (el.type === 'node' && tags.waterway === 'waterfall') {
        falls.push({ lat: el.lat, lng: el.lon, tags });
      } else {
        const lat = el.center?.lat ?? el.lat, lng = el.center?.lon ?? el.lon;
        if (Number.isFinite(lat)) buildings.push({ lat, lng, tags });
      }
    }
    return { buildings, rails, falls, crossings };
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
  // 兩級查詢、各自額度(2026-07-17 巴黎道路消失案):單一 `out geom 300` 在密路網市區
  // (巴黎 L3 bbox 實測 1533 條 way)截掉八成道路,且 Overpass 依 id 序輸出 —— 主幹道
  // 一樣被犧牲。車道級與小徑分開給額(隨 bbox 面積縮放),幹道永不被 footway/path 擠掉。
  // 額度放大後 payload ~700KB、Overpass 實測 ~10s(舊 10s abort 必掐死)→ timeout 同步放寬。
  const km2 = bboxKm2(bbox);
  const nMain = quotaOf(km2, 150, 150, 600);
  const nMinor = quotaOf(km2, 1300, 400, 1600);
  const q = `[out:json][timeout:15];`
    + `way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${bb});out geom ${nMain};`
    + `way["highway"~"^(unclassified|residential|living_street|service|track|path|footway|pedestrian)$"](${bb});out geom ${nMinor};`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
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
// 橋面/地下道的最小通行寬度(遊戲公尺):機甲碰撞直徑約 4~5m,兩台並行 + 小兵夾縫仍有餘裕
const PASS_W = 16;
// 地下道(真・下沉,2026-07-15 改版):**不開挖地表**。隧道路面 = 兩端洞口地表高的平直內插道路,
// 上方山體(未改動的原地形,照常鋪地被拼圖)自然高過路面即成「隧道」;洞內加不透明天花板遮住山體底面。
//   CLEAR  路面到天花板的淨空(> 最大機甲 真人1.8×250%≈4.5m + 餘裕)⇒ 天花板夠高、最大機甲通過不卡。
//   HW     隧道路面半寬(> PASS_W/2,雙機並行);ROOF_T 天花板厚度。
//   覆蓋門檻:山體地表 ≥ 路面 + CLEAR + ROOF_T 才算「洞內」(天花板藏得進山體);否則是敞開洞口段。
const TUN = { CLEAR: 8, HW: 9, ROOF_T: 1.0 };
// 高架橋橋面在兩端地面之上的抬升量(公尺):淨空 > 最大機甲(~4.5m)+ 餘裕 ⇒ 機甲從橋下通過不卡;
// 橋面底緣另登記為天花碰撞(game.js),機甲跳不穿橋。
const BRIDGE_RISE = 7.5;
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

// ---- 路面材質塗層:程序生成 canvas 貼圖(柏油骨材/泥土車轍/礫石)----
// 白底 + 淡灰細節 → 與 roadColor 相乘 = 各地貌路色不變,只多「畫上去的路面質感」;
// 世界投影 UV + 鏡射重複,長路無接縫(與 ground.js 底毯同手法)。固定種子 = 全房一致。
const _roadTexCache = new Map();
function roadTex(kind) {
  if (_roadTexCache.has(kind)) return _roadTexCache.get(kind);
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const rnd = mulberry32(0x40AD ^ kind.charCodeAt(0));
  g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, S, S);
  if (kind === 'asphalt') {                        // 柏油:骨材噪點 + 髮絲裂縫 + 瀝青補丁
    for (let i = 0; i < 240; i++) {
      const v = 200 + (rnd() * 55 | 0);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(rnd() * S, rnd() * S, 1.6, 1.6);
    }
    g.strokeStyle = 'rgba(120,120,126,0.5)'; g.lineWidth = 1.4; g.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      let x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += (rnd() - 0.5) * 30; y += (rnd() - 0.5) * 30; g.lineTo(x, y); }
      g.stroke();
    }
    g.fillStyle = 'rgba(190,190,196,0.5)';         // 補丁(重鋪的深色方塊)
    for (let i = 0; i < 3; i++) g.fillRect(rnd() * S, rnd() * S, 24 + rnd() * 30, 16 + rnd() * 22);
  } else if (kind === 'dirt') {                    // 泥土:縱向車轍雙帶 + 土斑
    for (const x0 of [S * 0.3, S * 0.7]) {
      g.fillStyle = 'rgba(150,140,126,0.5)';
      g.fillRect(x0 - 5, 0, 10, S);
      g.fillStyle = 'rgba(255,255,255,0.35)';      // 轍間受光脊
      g.fillRect(x0 + 6, 0, 3, S);
    }
    for (let i = 0; i < 18; i++) {
      g.fillStyle = `rgba(160,150,132,${0.2 + rnd() * 0.25})`;
      g.beginPath(); g.arc(rnd() * S, rnd() * S, 4 + rnd() * 10, 0, 7); g.fill();
    }
  } else {                                         // gravel 礫石:碎石鱗片 + 描邊
    for (let i = 0; i < 130; i++) {
      const x = rnd() * S, y = rnd() * S, r = 2.5 + rnd() * 4;
      const v = 205 + (rnd() * 50 | 0);
      g.fillStyle = `rgb(${v},${v},${v - 6})`;
      g.beginPath(); g.ellipse(x, y, r, r * 0.7, rnd() * 3.2, 0, 7); g.fill();
      if (rnd() < 0.5) { g.strokeStyle = 'rgba(150,146,136,0.6)'; g.lineWidth = 1; g.stroke(); }
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
  _roadTexCache.set(kind, t);
  return t;
}
const ROAD_TEX_OF = { urban: 'asphalt', green: 'dirt', wet: 'dirt', bare: 'gravel' };

// ---- 道路附屬 3D 件(路燈/紅綠燈/行道樹):多零件 InstancedMesh,常數 draw call ----
// part = { g, y, px, pz, c, e? };px/pz 隨實例朝向 ry 旋轉,e = 恆亮燈件
function roadPropMeshes(group, parts, items) {
  if (!items.length) return;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const P = new THREE.Vector3(), S = new THREE.Vector3(), tint = new THREE.Color();
  for (const part of parts) {
    const mat = part.e
      ? toonMat(part.c, { emissive: new THREE.Color(part.e), emissiveIntensity: 0.95 })
      : toonMat(part.c);
    const m = new THREE.InstancedMesh(part.g, mat, items.length);
    items.forEach((it, i) => {
      E.set(0, it.ry, 0);
      Q.setFromEuler(E);
      const s = it.s || 1;
      const px = part.px || 0, pz = part.pz || 0;
      const ca = Math.cos(it.ry), sa = Math.sin(it.ry);
      P.set(it.x + (px * ca + pz * sa) * s, it.y + part.y * s, it.z + (-px * sa + pz * ca) * s);
      S.set(s, s, s);
      M.compose(P, Q, S);
      m.setMatrixAt(i, M);
      if (!part.e) {                               // 燈件保持定色;結構件微抖不像複製貼上
        const j1 = ((i * 2654435761) >>> 0) % 100 / 100;
        tint.setRGB(0.88 + j1 * 0.2, 0.88 + j1 * 0.2, 0.88 + j1 * 0.2);
        m.setColorAt(i, tint);
      }
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.castShadow = false;
    m.frustumCulled = false;
    group.add(m);
  }
}

/**
 * 隧道/橋樑分段合併:同類(tunnel/bridge)且共用端點節點的 way 併成一條完整鏈。
 * OSM 的長隧道/長橋常被切成多段,共用節點深在山體內/河面上 —— 不合併的話,
 * 每半段各自拿「端點地表高」內插路面/橋面,剖面會在結構中段爬回地表(洞內隱形牆、橋面中垂)。
 * 節點鍵取 6 位小數(≈0.11m)= OSM 節點同一性;分岔(同節點 ≥3 條同類 way)不併,保守維持原樣。
 */
function mergeGradeChains(roads) {
  const out = roads.filter((w) => !((w.tags?.tunnel || w.tags?.bridge) && w.geometry?.length >= 2));
  for (const kind of ['tunnel', 'bridge']) {
    // tunnel 優先歸隧道鏈:同時掛兩種 tag 的 way 不會進兩類
    const ways = roads.filter((w) => w.tags?.[kind] && !(kind === 'bridge' && w.tags.tunnel) && w.geometry?.length >= 2);
    const key = (p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
    // 方向連續性:雙孔隧道/雙幅橋常共用洞口節點 —— 只准「順向接續」(夾角 < ~80°)的 way
    // 相併,倒鉤(平行孔折返)不併,否則 U/V 形鏈的路面內插會整段錯掉。
    const dirDot = (a, b, c, d) => {
      const kx = 111320 * Math.cos(a.lat * Math.PI / 180), ky = 110540;
      const v1 = [(b.lon - a.lon) * kx, (b.lat - a.lat) * ky];
      const v2 = [(d.lon - c.lon) * kx, (d.lat - c.lat) * ky];
      const l1 = Math.hypot(...v1) || 1, l2 = Math.hypot(...v2) || 1;
      return (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2);
    };
    const endMap = new Map();   // 節點鍵 -> [{w, end}](end: 0=頭 1=尾)
    for (const w of ways) {
      for (const [k, end] of [[key(w.geometry[0]), 0], [key(w.geometry[w.geometry.length - 1]), 1]]) {
        if (!endMap.has(k)) endMap.set(k, []);
        endMap.get(k).push({ w, end });
      }
    }
    const used = new Set();
    for (const w of ways) {
      if (used.has(w)) continue;
      used.add(w);
      let chain = [...w.geometry];
      for (const fwd of [true, false]) {
        let guard = 0;
        while (guard++ < 60) {
          const endPt = fwd ? chain[chain.length - 1] : chain[0];
          const here = endMap.get(key(endPt)) || [];
          if (here.length !== 2) break;                      // 真洞口/橋台或分岔:停
          const next = here.find((e) => !used.has(e.w));
          if (!next) break;
          const g = [...next.w.geometry];
          if (next.end === (fwd ? 1 : 0)) g.reverse();       // 對準接續方向
          // 順向接續才併:our 出向 vs 對方入向
          const ours = fwd ? [chain[chain.length - 2] || chain[0], endPt] : [chain[1] || chain[0], chain[0]];
          const theirs = fwd ? [g[0], g[1]] : [g[g.length - 1], g[g.length - 2]];
          const dot = fwd ? dirDot(ours[0], ours[1], theirs[0], theirs[1])
            : dirDot(ours[1], ours[0], theirs[1], theirs[0]);
          if (dot < 0.17) break;                             // 倒鉤(平行孔折返)不併
          used.add(next.w);
          if (fwd) chain = chain.concat(g.slice(1));
          else chain = g.slice(0, -1).concat(chain);
        }
      }
      out.push({ tags: { ...w.tags }, geometry: chain });
    }
  }
  return out;
}

/** 世界公尺 → 經緯度(llToWorld 逆運算;兵線跨水補橋的偽 way 用)*/
function worldToLL(x, z, center) {
  const R = 6371000;
  return {
    lat: center.lat + (-z) * MAPGEO.REAL_SCALE / R * 180 / Math.PI,
    lon: center.lng + x * MAPGEO.REAL_SCALE / (R * Math.cos(center.lat * Math.PI / 180)) * 180 / Math.PI,
  };
}

/** 水面判定(高程低於水面 或 衛星影像水色;純色規則不吃場地 mix、不耗共享 rnd)*/
function isWaterPt(terrain, x, z) {
  if (terrain.heightAt(x, z) < WATER.LEVEL + 0.05) return true;
  const c = terrain.sampleColor?.(x, z);
  return !!c && c[2] > c[0] + 14 && c[2] > c[1] + 6;
}

/**
 * 大面積水域自動高架橋(2026-07-15):非橋/非隧道道路的連續泡水段 ≥ WATER.SPAN_MIN_M
 * 即整段升級為高架橋 —— 機體無法下深水(game.js),道路通過大面積水域一定要有橋。
 * 泡水區間向兩岸乾地各外延 WATER.RAMP_M 當引道錨點(deckAt 的 24m 緩坡落在乾地上 = 斜坡出入口,
 * 不是階梯);太短的泡水段(淺灘/窄溝)不蓋橋,照舊涉水。回傳折線陣列,每條掛 .wet 旗標,
 * 邊界頂點前後段共享 = 橋頭與地面路無縫銜接。buildRoads 與 markGradeCorridors 共用(MUST 同一份規則)。
 */
function splitWaterPieces(run, terrain) {
  const n = run.length;
  if (n < 2) { run.wet = false; return [run]; }
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]));
  const wet = run.map(([x, z]) => isWaterPt(terrain, x, z));
  const spans = [];
  for (let i = 0; i < n; i++) {
    if (!wet[i]) continue;
    let j = i;
    while (j + 1 < n && wet[j + 1]) j++;
    if (cum[j] - cum[i] >= WATER.SPAN_MIN_M) spans.push([cum[i], cum[j]]);
    i = j;
  }
  if (!spans.length) { run.wet = false; return [run]; }
  // 引道外延 + 相鄰跨距合併(重疊即併,不留 <RAMP_M 的碎地面段)
  const merged = [];
  for (const [a, b] of spans) {
    const s0 = Math.max(0, a - WATER.RAMP_M), s1 = Math.min(cum[n - 1], b + WATER.RAMP_M);
    const last = merged[merged.length - 1];
    if (last && s0 <= last[1]) last[1] = Math.max(last[1], s1);
    else merged.push([s0, s1]);
  }
  const idxOf = (s) => { let i = 0; while (i < n - 1 && cum[i + 1] <= s) i++; return i; };
  const pieces = [];
  let cursor = 0;
  for (const [s0, s1] of merged) {
    // 夾回 cursor:相鄰跨距的索引取整不可回頭重疊(重疊 = 兩座橋同段 z-fighting)
    const i0 = Math.max(cursor, idxOf(s0));
    const i1 = Math.max(i0 + 1, Math.min(n - 1, idxOf(s1) + 1));
    if (i0 > cursor) { const dry = run.slice(cursor, i0 + 1); dry.wet = false; pieces.push(dry); }
    const wetP = run.slice(i0, i1 + 1);
    wetP.wet = true;
    pieces.push(wetP);
    cursor = i1;
  }
  if (cursor < n - 1) { const dry = run.slice(cursor); dry.wet = false; pieces.push(dry); }
  return pieces.filter((p) => p.length >= 2);
}

/**
 * 立體交通走廊(2026-07-15):隧道與橋樑(含跨水自動橋)的走廊登記,兩個用途:
 *  - blocked 淨空:神木/巨岩/植被/補間建物不得落在 ①隧道敞開/洞口開挖段 ②橋樑走廊(橋下淨空)——
 *    地下道/隧道內只會有道路物件。隧道「覆蓋段」上方是原樣山體地表,照常鋪地物,
 *    MUST NOT 連覆蓋段一起 block(那會把山頂鏟成禿頭)。
 *  - 回傳走廊小段(three 座標)供 main.js 上傳伺服器:sim 據此清除走廊內的第三方障礙/地雷。
 *    kind:'tun'(全段,含覆蓋段 —— 洞內路面不得有障礙)/ 'bridge'(橋面下走廊)。
 * 邊界裁切/細分/拆段 MUST 與 buildRoads 同一套(inb=4 / ROAD_SEG / splitWaterPieces),
 * 否則走廊跟實際結構對不上。不耗共享 rnd(佈局序列不受影響)。
 */
function markGradeCorridors(roads, terrain, center, blocked) {
  const corridors = [];
  const inb = 4;
  for (const way of roads || []) {
    const bridge = !!way.tags?.bridge;
    const tunnel = !!way.tags?.tunnel;
    const hwWay = Math.max(roadWidth(way.tags || {}) / 2, (bridge || tunnel) ? PASS_W / 2 : 0);
    const runs = [];
    let cur = [];
    for (const gpt of way.geometry || []) {
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
      const pieces = (bridge || tunnel) ? [densify(raw, ROAD_SEG)] : splitWaterPieces(densify(raw, ROAD_SEG), terrain);
      for (const run of pieces) {
        if (run.length < 2) continue;
        const wet = run.wet === true;
        if (!bridge && !tunnel && !wet) continue;   // 一般乾地路段不是立體結構
        const hw = (bridge || wet) ? Math.max(hwWay, PASS_W / 2) : hwWay;
        const kind = tunnel ? 'tun' : 'bridge';
        const cum = [0];
        for (let i = 1; i < run.length; i++) cum.push(cum[i - 1] + Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]));
        const total = cum[cum.length - 1] || 1;
        const hA = terrain.heightAt(run[0][0], run[0][1]);
        const hB = terrain.heightAt(run[run.length - 1][0], run[run.length - 1][1]);
        // 走廊小段(12m 粗化,上傳量減半)
        for (let i = 0; i + 1 < run.length; i += 2) {
          const j = Math.min(run.length - 1, i + 2);
          corridors.push({ x1: run[i][0], z1: run[i][1], x2: run[j][0], z2: run[j][1], hw, kind });
        }
        // 淨空格:橋樑全段;隧道只有敞開/洞口段(覆蓋段山頂地物照舊)
        for (let i = 0; i < run.length; i++) {
          const [x, z] = run[i];
          if (kind === 'tun') {
            const floor = hA + (hB - hA) * (cum[i] / total);
            if (terrain.heightAt(x, z) >= floor + TUN.CLEAR + TUN.ROOF_T) continue;   // 覆蓋段
          }
          blockArea(blocked, x, z, hw + 4);
        }
      }
    }
  }
  return corridors;
}

function buildRoads(group, roads, terrain, center, mix, rnd, season) {
  const inb = 4;
  const buckets = new Map();   // `${biome}|${main}` -> { color, pos, nrm, col, uv, idx, base }
  const bucketOf = (biome, main) => {
    const key = `${biome}|${main ? 1 : 0}`;
    let b = buckets.get(key);
    if (!b) {
      b = { color: roadColor(biome, main), tex: ROAD_TEX_OF[biome] || 'asphalt',
            pos: [], nrm: [], col: [], uv: [], idx: [], base: 0 };
      buckets.set(key, b);
    }
    return b;
  };
  // 路面貼地規則:非橋樑截面「各自貼地,但夾在同截面最高點 −0.7m 之上」——
  // 橫坡路段路面切進山壁(路塹感)而不是被地形吞掉;抬升量 0.45 > 地被(0.07~0.18)
  const ROAD_LIFT = 0.45, CLAMP = 0.7;
  // 標線合併幾何(頂點色 = 黃/白):雙黃線/白虛線/路緣邊線/斑馬線全進同一 draw call
  const mark = { pos: [], nrm: [], col: [], idx: [], base: 0 };
  const MARK_Y = [1.0, 0.78, 0.28], MARK_W = [0.95, 0.96, 0.9];   // 標線黃 / 標線白
  // hM = 該截面最高點(標線跟路面吃同一條夾高規則,才不會沉進被抬高的路面下)
  const putMark = (vx, vz, lift2, c, hM = -Infinity) => {
    mark.pos.push(vx, Math.max(terrain.heightAt(vx, vz), hM - CLAMP) + lift2, vz);
    mark.nrm.push(0, 1, 0);
    mark.col.push(...c);
  };
  // 沿折線的縱向實線:偏移 off、寬 w(雙黃線 = 兩次呼叫);hw2 = 路半寬(夾高取樣)
  const emitLine = (run, hw2, lift2, off, w, c) => {
    const nP = run.length, k0 = mark.base;
    for (let i = 0; i < nP; i++) {
      const [x, z] = run[i];
      const a = run[Math.max(0, i - 1)], b2 = run[Math.min(nP - 1, i + 1)];
      let dx = b2[0] - a[0], dz = b2[1] - a[1];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const px = dz, pz = -dx;
      const hM = Math.max(terrain.heightAt(x + px * hw2, z + pz * hw2),
                          terrain.heightAt(x - px * hw2, z - pz * hw2));
      // 頂點序:大偏移在前(與路面quad同向繞行 → 面朝 +y,不會背面剔除消失)
      putMark(x + px * (off + w / 2), z + pz * (off + w / 2), lift2, c, hM);
      putMark(x + px * (off - w / 2), z + pz * (off - w / 2), lift2, c, hM);
    }
    for (let i = 0; i < nP - 1; i++) {
      const k = k0 + i * 2;
      mark.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    mark.base += nP * 2;
  };
  // 高架橋構件:欄杆(直立緞帶幾何)+ 邊梁(box girder 意象,直立緞帶)+ 底板(soffit,橋下抬頭看的橋腹)
  // + 橋墩/橋墩帽(InstancedMesh);地下道門洞(隧道端點)
  const rail = { pos: [], nrm: [], idx: [], base: 0 };
  const girder = { pos: [], nrm: [], idx: [], base: 0 };
  const soffit = { pos: [], nrm: [], idx: [], base: 0 };
  const piers = [], portals = [];
  // 地下道(開挖式)構件:兩側擋土牆(直立緞帶)+ 跨越橫樑(InstancedMesh)+ 天花照明(InstancedMesh)
  const wall = { pos: [], nrm: [], idx: [], base: 0 };
  const beams = [], ceilLamps = [];
  // 橋面碰撞面(main.js → terrain.decks → game.js 表面高度):橋是可以站上去的結構物
  const decks = [];
  const cols = [];   // 結構碰撞柱(橋墩/門洞立柱/翼牆)→ blockers(game.js _collide 推擠,不可重疊)
  const tunnelSegs = [];   // 地下道小段:{路面 fy, 天花 cy, hw} → main.js surfaceAt(洞內站路面)+ 天花碰撞
  const ceilSegs = [];     // 地下道不透明天花板小段(覆蓋段;擋住山體底面)
  // 路口偵測:OSM 共用節點 = 交叉口。arms = 進出交點的路臂數(端點 1、中途 2),
  // ≥3 才是路口;同時記各臂方向(斑馬線垂直路臂、紅綠燈立在轉角)
  const nodeArms = new Map();   // key -> { x, z, arms, hw, dirs: [[dx,dz]…] }
  const lights = [], lamps = [], roadTrees = [];   // 3D 附屬件實例
  // 建路段數上限隨地圖真實面積縮放(2026-07-17):固定 600 是第二層截斷 —— 查詢額度
  // 提高後照樣只畫前 600 段。計數單位是拆段後的 run(≈ way × 1.2~1.5,邊界裁切/跨水拆段),
  // 密度基準對齊 fetchOsmRoads 額度(~1450 way/km²)再給拆段裕度;附屬件(路燈/紅綠燈/
  // 行道樹)另有各自實例上限,不受此值影響。
  const km2R = terrain.worldW * terrain.worldH * MAPGEO.REAL_SCALE * MAPGEO.REAL_SCALE / 1e6;
  const maxRuns = Math.max(600, Math.min(2600, Math.round(km2R * 1800)));
  let built = 0;
  for (const way of roads) {
    const main = MAIN_HW.test(way.tags.highway);
    const arterial = /^(motorway|trunk|primary)$/.test(way.tags.highway);   // 幹道:雙黃實線
    const bridge = !!way.tags.bridge;
    const tunnel = !!way.tags.tunnel;
    // 橋樑/地下道是「可站上去、可穿過去」的結構物(兵線可能就走在上面):
    // 路寬夾到 PASS_W 以上,NPC 與玩家並肩通過不互相卡住(跨水自動橋段在 piece 層再夾一次)。
    const hwWay = Math.max(roadWidth(way.tags) / 2, (bridge || tunnel) ? PASS_W / 2 : 0);
    if (tunnel) {
      // 洞口門洞(額牆):立在山體端 —— 玩家沿地表路走到山腳即進洞。門洞高 = 隧道淨空。
      const gpts = way.geometry;
      if (gpts.length >= 2) {
        for (const [eIdx, nIdx] of [[0, 1], [gpts.length - 1, gpts.length - 2]]) {
          if (portals.length >= 10) break;
          const [ex, ez] = llToWorld(gpts[eIdx].lat, gpts[eIdx].lon, center);
          if (ex < terrain.minX + inb + 8 || ex > terrain.maxX - inb - 8
            || ez < terrain.minZ + inb + 8 || ez > terrain.maxZ - inb - 8) continue;
          const [nx2, nz2] = llToWorld(gpts[nIdx].lat, gpts[nIdx].lon, center);
          const dl = Math.hypot(nx2 - ex, nz2 - ez) || 1;
          const dIn = [(nx2 - ex) / dl, (nz2 - ez) / dl];   // 指向隧道內
          const hE = terrain.heightAt(ex, ez);
          if (hE < 0.4) continue;
          if (terrain.heightAt(ex + dIn[0] * 14, ez + dIn[1] * 14) < hE + 2.2) continue;   // 內側山體確有上升 = 真洞口
          portals.push({ x: ex, z: ez, y: hE, ry: Math.atan2(-dIn[0], -dIn[1]), w: hwWay * 2 + 2, h: TUN.CLEAR + 1 });
        }
      }
    }
    // 路口統計(車行道才算;步道/小徑不設斑馬線紅綠燈;橋/地下道不設)
    if (hwWay >= 2 && !bridge && !tunnel) {
      const n = way.geometry.length;
      for (let i = 0; i < n; i++) {
        const gpt = way.geometry[i];
        const key = `${gpt.lat.toFixed(6)},${gpt.lon.toFixed(6)}`;
        let rec = nodeArms.get(key);
        if (!rec) {
          const [x, z] = llToWorld(gpt.lat, gpt.lon, center);
          rec = { x, z, arms: 0, hw: 0, dirs: [] };
          nodeArms.set(key, rec);
        }
        rec.arms += (i === 0 || i === n - 1) ? 1 : 2;
        rec.hw = Math.max(rec.hw, hwWay);
        for (const j of [i - 1, i + 1]) {          // 各臂方向(指向鄰節點)
          if (j < 0 || j >= n) continue;
          const [ax, az] = llToWorld(way.geometry[j].lat, way.geometry[j].lon, center);
          const dl = Math.hypot(ax - rec.x, az - rec.z) || 1;
          rec.dirs.push([(ax - rec.x) / dl, (az - rec.z) / dl]);
        }
      }
    }
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
      // 大面積水域自動高架橋(2026-07-15):非橋/非隧道 way 先依泡水段拆段(splitWaterPieces),
      // 泡水段以 brg=true 走橋樑管線(橋面/欄杆/邊梁/底板/橋墩/decks 碰撞全套)。
      const pieces = (bridge || tunnel) ? [densify(raw, ROAD_SEG)] : splitWaterPieces(densify(raw, ROAD_SEG), terrain);
      for (const run of pieces) {
      if (run.length < 2) continue;
      const brg = bridge || run.wet === true;
      // 跨水自動橋段夾通行寬(PASS_W):橋是兵線可能走的結構物;乾段維持原路寬
      const hw = brg ? Math.max(hwWay, PASS_W / 2) : hwWay;
      const mid = run[(run.length / 2) | 0];
      let biome = classify(terrain.sampleColor?.(mid[0], mid[1]), terrain.heightAt(mid[0], mid[1]), mix, rnd);
      // 橋樑就是為了跨越水面而存在 —— 橋段中點取樣落在水色上是常態(河/運河正下方),
      // MUST NOT 跳過,否則現實中最常見的跨河橋會整段連同橋面碰撞一起消失。
      // 乾段(splitWaterPieces 已逐點判定無泡水跨距)中點取到水色 = 河岸取樣誤差,
      // 整段丟棄會讓沿河街道憑空消失(2026-07-17 巴黎塞納河岸案)→ 退回城市路面色。
      if (biome === 'water' && !brg) biome = 'urban';
      const b = bucketOf(biome, main);
      const nP = run.length, vbase = b.base;
      const cum = [0];
      for (let i = 1; i < nP; i++) cum.push(cum[i - 1] + Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]));
      const total = cum[nP - 1];
      // 高架橋橋面:兩端地面高的直線內插 + 端點 24m 緩坡爬升淨空 —— 橋面是水平的,
      // 不跟著河谷/窪地起伏;地形突起處仍夾在地表之上(不鑽土)。24m 連續內插 = 出入口
      // 是斜坡不是階梯。跨水橋另夾「水面 + 0.9m」下限:錨點萬一泡水,橋面也不沉入水中。
      const hA = terrain.heightAt(run[0][0], run[0][1]);
      const hB = terrain.heightAt(run[nP - 1][0], run[nP - 1][1]);
      const deckAt = (s, gx, gz) => {
        // 端點緩坡改平滑 S 曲線(smoothstep):斜率在坡底與坡頂皆歸零 → 與地面、水平橋面 C1 連續,
        // 出入口是「連續斜坡」而非硬折角(舊線性版在 s=24 有膝折 = 階梯感)。t=0 逐位元同舊版
        // (坡底抬升 0 = 接地);total≥48 的橋跨中 t=1 峰值仍滿 BRIDGE_RISE(淨空同今日);total<48 的
        // 短橋跨中峰值微幅上抬(淨空不減,安全)。geometry/橋墩/decks 碰撞取同一 deckAt 自動跟隨。
        const t = Math.min(1, s / 24, (total - s) / 24);   // s∈[0,total] 故 t 已夾 [0,1]
        const ramp = t * t * (3 - 2 * t);                  // smoothstep:兩端切線為 0,免三角函式
        const yLine = hA + (hB - hA) * (s / (total || 1)) + BRIDGE_RISE * ramp;
        const floor = run.wet ? WATER.LEVEL + 0.9 : -Infinity;
        return Math.max(yLine, terrain.heightAt(gx, gz) + ROAD_LIFT, floor);
      };
      // 地下道:平直路面(兩端洞口地表高的內插)= 洞內在山體之下、洞口與地表齊平的通行道路
      const tFloorAt = (s) => hA + (hB - hA) * (s / (total || 1));
      for (let i = 0; i < nP; i++) {
        const [x, z] = run[i];
        const a = run[Math.max(0, i - 1)], c = run[Math.min(nP - 1, i + 1)];
        let dx = c[0] - a[0], dz = c[1] - a[1];
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const px = dz, pz = -dx;                 // XZ 垂直向量
        // 截面 4 頂點:外緣暗(墨線)→ 內緣亮,漸層即手繪描邊筆觸。
        // 非橋:各自貼地但夾在截面最高點 −CLAMP 之上(橫坡不吞路);橋:水平橋面
        const offs = [[hw, 1], [hw * 0.64, 0], [-hw * 0.64, 0], [-hw, 1]];
        const hs = offs.map(([off]) => terrain.heightAt(x + px * off, z + pz * off));
        const hMax = Math.max(...hs);
        for (let k = 0; k < 4; k++) {
          const [off, ink] = offs[k];
          const vx = x + px * off, vz = z + pz * off;
          const vy = tunnel ? tFloorAt(cum[i]) + ROAD_LIFT
            : brg ? deckAt(cum[i], x, z)
              : Math.max(hs[k], hMax - CLAMP) + ROAD_LIFT;
          b.pos.push(vx, vy, vz);
          b.nrm.push(0, 1, 0);
          b.uv.push(vx / 9, vz / 9);             // 世界投影 UV:路面質感貼圖(鏡射重複無接縫)
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
      const at = (d) => {
        let i = 1; while (cum[i] < d && i < nP - 1) i++;
        const f = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
        const x = run[i - 1][0] + (run[i][0] - run[i - 1][0]) * f;
        const z = run[i - 1][1] + (run[i][1] - run[i - 1][1]) * f;
        let dx = run[i][0] - run[i - 1][0], dz = run[i][1] - run[i - 1][1];
        const l = Math.hypot(dx, dz) || 1;
        return [x, z, dx / l, dz / l];
      };
      // ---- 橋面碰撞面:每個路面小段登記成可站立平台(game.js 表面高度取樣用)----
      if (brg) {
        for (let i = 0; i < nP - 1; i++) {
          decks.push({
            x1: run[i][0], z1: run[i][1], y1: deckAt(cum[i], run[i][0], run[i][1]),
            x2: run[i + 1][0], z2: run[i + 1][1], y2: deckAt(cum[i + 1], run[i + 1][0], run[i + 1][1]),
            hw,
          });
        }
      }
      // ---- 地下道(真・下沉,2026-07-15):路面在山體之下的平直道路 + 不透明天花板;山體地表原樣保留 ----
      // 天花 = 路面 + CLEAR;山體地表高過天花 + ROOF_T 的段落才「覆蓋」(有牆/天花/樑);敞開段是洞口。
      if (tunnel && total > 8) {
        const ceilOf = (s) => tFloorAt(s) + TUN.CLEAR;
        const coveredI = (i) => terrain.heightAt(run[i][0], run[i][1]) >= ceilOf(cum[i]) + TUN.ROOF_T;
        // 路面 + 天花碰撞:**只在覆蓋段登記**(有天花板的段落才判定「洞內」+ 頭部碰撞;
        // 敞開/洞口段地表已被 carve 到路面高、surfaceAt 走地表即可,不可掛隱形天花)。
        for (let i = 0; i < nP - 1; i++) {
          if (!coveredI(i) || !coveredI(i + 1)) continue;
          tunnelSegs.push({
            x1: run[i][0], z1: run[i][1], fy1: tFloorAt(cum[i]), cy1: ceilOf(cum[i]),
            x2: run[i + 1][0], z2: run[i + 1][1], fy2: tFloorAt(cum[i + 1]), cy2: ceilOf(cum[i + 1]), hw,
          });
        }
        // 兩側牆(路面 → 天花):覆蓋段立起,敞開段(洞口)收成零高不破圖
        for (const side of [1, -1]) {
          const k0 = wall.base;
          for (let i = 0; i < nP; i++) {
            const [x, z] = run[i];
            const a = run[Math.max(0, i - 1)], c = run[Math.min(nP - 1, i + 1)];
            let dx = c[0] - a[0], dz = c[1] - a[1];
            const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
            const vx = x + dz * hw * side, vz = z - dx * hw * side;
            const yF = tFloorAt(cum[i]) - 0.3;
            const yT = coveredI(i) ? ceilOf(cum[i]) + 0.2 : yF + 0.15;
            wall.pos.push(vx, yF, vz, vx, yT, vz);
            wall.nrm.push(-dz * side, 0, dx * side, -dz * side, 0, dx * side);
          }
          for (let i = 0; i < nP - 1; i++) { const k = k0 + i * 2; wall.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
          wall.base += nP * 2;
        }
        // 不透明天花板(擋住上方山體底面 = 不破圖)+ 橫樑 + 天花燈:僅覆蓋段
        for (let i = 0; i < nP - 1; i++) {
          if (!coveredI(i) || !coveredI(i + 1)) continue;
          ceilSegs.push({ x1: run[i][0], z1: run[i][1], cy1: ceilOf(cum[i]), x2: run[i + 1][0], z2: run[i + 1][1], cy2: ceilOf(cum[i + 1]), hw: hw + 0.6 });
        }
        for (let s = 6; s < total - 4 && beams.length < 120; s += 12) {
          const [ex, ez, ddx, ddz] = at(s);
          if (terrain.heightAt(ex, ez) < tFloorAt(s) + TUN.CLEAR + TUN.ROOF_T) continue;
          beams.push({ x: ex, z: ez, y: tFloorAt(s) + TUN.CLEAR - 0.35, ry: Math.atan2(ddx, ddz), w: hw * 2 + 2 });
          if (ceilLamps.length < 120) ceilLamps.push({ x: ex, z: ez, y: tFloorAt(s) + TUN.CLEAR - 0.95, ry: Math.atan2(ddx, ddz) });
        }
      }
      // ---- 高架橋外觀:兩側欄杆(直立緞帶)+ 邊梁(box girder)+ 底板(soffit)+ 等間距橋墩落地(含墩帽)+ 橋燈 ----
      if (brg && total > 10) {
        for (const side of [1, -1]) {
          const k0 = rail.base;
          for (let i = 0; i < nP; i++) {
            const [x, z] = run[i];
            const a = run[Math.max(0, i - 1)], c = run[Math.min(nP - 1, i + 1)];
            let dx = c[0] - a[0], dz = c[1] - a[1];
            const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
            const vx = x + dz * hw * 0.96 * side, vz = z - dx * hw * 0.96 * side;
            const dy = deckAt(cum[i], x, z);
            rail.pos.push(vx, dy + 0.02, vz, vx, dy + 1.1, vz);
            rail.nrm.push(dz * side, 0, -dx * side, dz * side, 0, -dx * side);
          }
          for (let i = 0; i < nP - 1; i++) {
            const k = k0 + i * 2;
            rail.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
          }
          rail.base += nP * 2;
          // 邊梁:貼在橋面外緣正下方的直立緞帶,補足側視結構厚度(box girder 意象)
          const g0 = girder.base;
          for (let i = 0; i < nP; i++) {
            const [x, z] = run[i];
            const a = run[Math.max(0, i - 1)], c = run[Math.min(nP - 1, i + 1)];
            let dx = c[0] - a[0], dz = c[1] - a[1];
            const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
            const vx = x + dz * hw * 0.98 * side, vz = z - dx * hw * 0.98 * side;
            const dy = deckAt(cum[i], x, z);
            // 底緣夾在地表之上(留 0.2m 微埋):引道口/低架段淨空 <1.1m 時邊梁原本會鑽出地面 = 破圖
            const gBot = Math.max(dy - 1.1, terrain.heightAt(vx, vz) - 0.2);
            girder.pos.push(vx, dy - 0.1, vz, vx, gBot, vz);
            girder.nrm.push(dz * side, 0, -dx * side, dz * side, 0, -dx * side);
          }
          for (let i = 0; i < nP - 1; i++) {
            const k = g0 + i * 2;
            girder.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
          }
          girder.base += nP * 2;
        }
        // 橋面底板(soffit,2026-07-15):兩側邊梁底緣之間補滿混凝土底面 ——
        // 從橋下往上看是實體橋腹,不再是空的(路面 quad 單面朝上,背面剔除後橋下透明)。
        {
          const s0 = soffit.base;
          for (let i = 0; i < nP; i++) {
            const [x, z] = run[i];
            const a = run[Math.max(0, i - 1)], c = run[Math.min(nP - 1, i + 1)];
            let dx = c[0] - a[0], dz = c[1] - a[1];
            const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
            const dyB = deckAt(cum[i], x, z) - 1.1;   // 與邊梁底緣同深(封成箱梁)
            // 底板同樣夾在地表之上:低淨空引道段免鑽出地面破圖(兩緣各自貼各自地表 → 橋腹在橋頭平順沒入地面)
            const ex1 = x + dz * hw * 0.98, ez1 = z - dx * hw * 0.98;
            const ex2 = x - dz * hw * 0.98, ez2 = z + dx * hw * 0.98;
            const sy1 = Math.max(dyB, terrain.heightAt(ex1, ez1) - 0.2);
            const sy2 = Math.max(dyB, terrain.heightAt(ex2, ez2) - 0.2);
            soffit.pos.push(ex1, sy1, ez1, ex2, sy2, ez2);
            soffit.nrm.push(0, -1, 0, 0, -1, 0);
          }
          for (let i = 0; i < nP - 1; i++) {
            const k = s0 + i * 2;
            soffit.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
          }
          soffit.base += nP * 2;
        }
        // 跨水段橋墩不再跳過(2026-07-15):墩身自水底升出水面 —— 大面積水域的高架橋有落墩支撐
        for (let s = 12; s < total - 8 && piers.length < 120; s += 24) {
          const [ex, ez, ddx, ddz] = at(s);
          const y0 = terrain.heightAt(ex, ez), y1 = deckAt(s, ex, ez);
          if (y1 - y0 > 1.4) {
            piers.push({ x: ex, z: ez, y0: y0 - 0.5, y1, r: Math.min(1.4, hw * 0.35), ry: Math.atan2(ddx, ddz), w: hw * 1.7 });
          }
        }
        // 橋燈:沿橋面邊緣等間距、左右交錯(與地面路燈同款,燈臂朝橋心)
        if (lamps.length < 380) {
          let side2 = rnd() < 0.5 ? 1 : -1;
          for (let s = 16 + rnd() * 10; s < total - 8 && lamps.length < 380; s += 34) {
            const [ex, ez, ddx, ddz] = at(s);
            const qx = ddz, qz = -ddx, off = hw * 0.96 + 0.5;
            const lx = ex + qx * off * side2, lz = ez + qz * off * side2;
            lamps.push({ x: lx, y: deckAt(s, ex, ez), z: lz, ry: Math.atan2(qz * side2, -qx * side2) });
            side2 = -side2;
          }
        }
      }
      // ---- 交通標線(只畫市區柏油;泥土/礫石路沒有標線;橋面另計,不重畫)----
      if (!brg && biome === 'urban' && hw >= 2) {
        if (main) {
          if (arterial) {                        // 幹道:雙黃實線分向
            emitLine(run, hw, 0.58, 0.33, 0.2, MARK_Y);
            emitLine(run, hw, 0.58, -0.33, 0.2, MARK_Y);
          } else {                               // 次要道:單白虛線
            for (let s = 5; s + 3.2 < total; s += 9.5) {
              const k = mark.base;
              for (const d of [s, s + 3.2]) {
                const [ex, ez, ddx, ddz] = at(d);
                const qx = ddz, qz = -ddx;
                const hM = Math.max(terrain.heightAt(ex + qx * hw, ez + qz * hw),
                                    terrain.heightAt(ex - qx * hw, ez - qz * hw));
                putMark(ex + qx * 0.28, ez + qz * 0.28, 0.58, MARK_W, hM);
                putMark(ex - qx * 0.28, ez - qz * 0.28, 0.58, MARK_W, hM);
              }
              mark.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
              mark.base += 4;
            }
          }
          // 路緣白邊線(車道外側,墨帶內)
          emitLine(run, hw, 0.56, hw * 0.78, 0.18, MARK_W);
          emitLine(run, hw, 0.56, -hw * 0.78, 0.18, MARK_W);
        }
        // ---- 路燈:沿路等間距、左右交錯(燈臂朝路心)----
        if (main && lamps.length < 380) {
          let side = rnd() < 0.5 ? 1 : -1;
          for (let s = 14 + rnd() * 10; s < total - 8 && lamps.length < 380; s += 40) {
            const [ex, ez, ddx, ddz] = at(s);
            const qx = ddz, qz = -ddx, off = hw + 1.2;
            const lx = ex + qx * off * side, lz = ez + qz * off * side;
            if (terrain.heightAt(lx, lz) < 0.4) { side = -side; continue; }
            lamps.push({ x: lx, y: terrain.heightAt(lx, lz), z: lz,
                         ry: Math.atan2(qz * side, -qx * side) });   // 局部 +x 指向路心
            side = -side;
          }
        }
      } else if (!brg && (biome === 'green' || biome === 'wet') && main && hw >= 2.4) {
        // ---- 行道樹:郊區幹道兩側等間距(純視覺,不登記碰撞)----
        for (let s = 10 + rnd() * 8; s < total - 6 && roadTrees.length < 460; s += 26 + rnd() * 8) {
          const [ex, ez, ddx, ddz] = at(s);
          const qx = ddz, qz = -ddx, off = hw + 1.6 + rnd() * 0.8;
          for (const side of [1, -1]) {
            if (rnd() < 0.18) continue;          // 缺株:不像牙籤陣
            const tx = ex + qx * off * side, tz = ez + qz * off * side;
            const ty = terrain.heightAt(tx, tz);
            if (ty < 0.4) continue;
            roadTrees.push({ x: tx, y: ty, z: tz, ry: rnd() * Math.PI * 2, s: 0.8 + rnd() * 0.5 });
          }
        }
      }
      built++;
      if (built >= maxRuns) break;
      }   // pieces(拆段)迴圈
      if (built >= maxRuns) break;
    }
    if (built >= maxRuns) break;
  }

  // ---- 路口:斑馬線 + 紅綠燈(市區、車行路口、彼此至少 70m)----
  const junctions = [];
  for (const rec of nodeArms.values()) {
    if (rec.arms < 3 || junctions.length >= 30) continue;
    if (rec.x < terrain.minX + inb + 10 || rec.x > terrain.maxX - inb - 10
      || rec.z < terrain.minZ + inb + 10 || rec.z > terrain.maxZ - inb - 10) continue;
    const h = terrain.heightAt(rec.x, rec.z);
    if (h < 0.4) continue;
    // 純圖資分類(不吃場地 mix 改寫):斑馬線只該出現在柏油市區
    if (classify(terrain.sampleColor?.(rec.x, rec.z), h, null, rnd) !== 'urban') continue;
    if (junctions.some((j) => Math.hypot(j.x - rec.x, j.z - rec.z) < 70)) continue;
    junctions.push(rec);
    // 相近方向的臂合併(雙向路的一進一出幾乎共線)
    const arms2 = [];
    for (const [dx, dz] of rec.dirs) {
      if (arms2.some(([ax, az]) => ax * dx + az * dz > 0.86)) continue;
      arms2.push([dx, dz]);
      if (arms2.length >= 4) break;
    }
    const zw = rec.hw * 0.9;                       // 斑馬線半寬(略窄於路寬)
    const hJ = terrain.heightAt(rec.x, rec.z);     // 路口中心高:白槓跟路面同一條夾高規則
    for (const [dx, dz] of arms2) {
      const qx = dz, qz = -dx;
      const d0 = rec.hw + 1.8;                     // 條帶起點:離路口中心一個路寬
      // 白槓長軸沿行車方向(3.2m 深)、槓寬 0.5m / 間 0.5m,橫向重複鋪滿路寬
      for (let lo = -zw; lo + 0.5 <= zw + 0.01; lo += 1.0) {
        const kb = mark.base;
        for (const dd of [d0, d0 + 3.2]) {
          const cx2 = rec.x + dx * dd, cz2 = rec.z + dz * dd;
          // 頂點序同 emitLine(大偏移在前)→ 面朝 +y
          putMark(cx2 + qx * (lo + 0.5), cz2 + qz * (lo + 0.5), 0.62, MARK_W, hJ);
          putMark(cx2 + qx * lo, cz2 + qz * lo, 0.62, MARK_W, hJ);
        }
        mark.idx.push(kb, kb + 1, kb + 2, kb + 1, kb + 3, kb + 2);
        mark.base += 4;
      }
    }
    // 紅綠燈:取前兩臂的右側轉角各立一支,燈頭朝路口
    for (const [dx, dz] of arms2.slice(0, 2)) {
      const qx = dz, qz = -dx;
      const lx = rec.x + dx * (rec.hw + 1.6) + qx * (rec.hw + 1.0);
      const lz = rec.z + dz * (rec.hw + 1.6) + qz * (rec.hw + 1.0);
      const ly = terrain.heightAt(lx, lz);
      if (ly < 0.4) continue;
      lights.push({ x: lx, y: ly, z: lz, ry: Math.atan2(qz, -qx) });   // 燈臂 +x 伸回路面上方
    }
  }

  // ---- 路面 Mesh(每「地貌×主次」一個 draw call;柏油/泥土/礫石材質塗層)----
  for (const b of buckets.values()) {
    if (!b.idx.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    geo.setIndex(b.idx);
    const m = new THREE.Mesh(geo, envMat(b.color, {
      map: roadTex(b.tex), vertexColors: true, wash: 0.55, cool: 0.5, rim: 0,
    }));
    m.frustumCulled = false;
    m.renderOrder = 1;
    m.userData.noOutline = true;
    group.add(m);
  }
  // ---- 標線 Mesh(黃/白頂點色,單一 draw call)----
  if (mark.idx.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(mark.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(mark.nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(mark.col, 3));
    geo.setIndex(mark.idx);
    const m = new THREE.Mesh(geo, envMat(0xf2edda, { vertexColors: true, wash: 0.15, cool: 0.3, rim: 0 }));
    m.frustumCulled = false;
    m.renderOrder = 2;
    m.userData.noOutline = true;
    group.add(m);
  }
  // ---- 高架橋欄杆(直立緞帶,雙面)----
  if (rail.idx.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(rail.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(rail.nrm, 3));
    geo.setIndex(rail.idx);
    const m = new THREE.Mesh(geo, envMat(0xaab2b8, { wash: 0.35, cool: 0.45, side: THREE.DoubleSide }));
    m.frustumCulled = false;
    m.userData.noOutline = true;
    group.add(m);
  }
  // ---- 高架橋邊梁(直立緞帶,雙面;貼在橋面外緣下方,補足側視結構厚度)----
  if (girder.idx.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(girder.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(girder.nrm, 3));
    geo.setIndex(girder.idx);
    const m = new THREE.Mesh(geo, envMat(0x5c636a, { wash: 0.3, cool: 0.5, side: THREE.DoubleSide }));
    m.frustumCulled = false;
    m.userData.noOutline = true;
    group.add(m);
  }
  // ---- 高架橋底板(soffit,雙面):從橋下往上看的橋體底面,封住兩側邊梁之間的開口 ----
  if (soffit.idx.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(soffit.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(soffit.nrm, 3));
    geo.setIndex(soffit.idx);
    const m = new THREE.Mesh(geo, envMat(0x565d64, { wash: 0.3, cool: 0.5, side: THREE.DoubleSide }));
    m.frustumCulled = false;
    m.userData.noOutline = true;
    group.add(m);
  }
  // ---- 地下道擋土牆(直立緞帶,雙面)+ 橫樑 ----
  if (wall.idx.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(wall.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(wall.nrm, 3));
    geo.setIndex(wall.idx);
    const m = new THREE.Mesh(geo, envMat(0x8f8b83, { wash: 0.4, cool: 0.4, side: THREE.DoubleSide }));
    m.frustumCulled = false;
    m.userData.noOutline = true;
    group.add(m);
  }
  // ---- 地下道不透明天花板:覆蓋段的頂板(擋住上方山體底面,從洞內抬頭看是天花而非穿幫的山體背面)----
  if (ceilSegs.length) {
    const pos = [], nrm = [], idx = []; let base = 0;
    for (const s of ceilSegs) {
      let dx = s.x2 - s.x1, dz = s.z2 - s.z1; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const px = dz, pz = -dx;
      const c4 = [[s.x1 + px * s.hw, s.cy1, s.z1 + pz * s.hw], [s.x1 - px * s.hw, s.cy1, s.z1 - pz * s.hw],
        [s.x2 + px * s.hw, s.cy2, s.z2 + pz * s.hw], [s.x2 - px * s.hw, s.cy2, s.z2 - pz * s.hw]];
      for (const c of c4) { pos.push(c[0], c[1], c[2]); nrm.push(0, -1, 0); }   // 面朝下(洞內看得到)
      idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      base += 4;
    }
    const cgeo = new THREE.BufferGeometry();
    cgeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    cgeo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    cgeo.setIndex(idx);
    const cm = new THREE.Mesh(cgeo, envMat(0x4a4d47, { wash: 0.3, cool: 0.35, side: THREE.DoubleSide }));
    cm.frustumCulled = false; cm.userData.noOutline = true;
    group.add(cm);
  }
  if (beams.length) {
    const bM = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.7, 1.4),
      envMat(0x9a958c, { wash: 0.35, cool: 0.45 }), beams.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
    const P = new THREE.Vector3(), S = new THREE.Vector3();
    beams.forEach((b, i) => {
      E.set(0, b.ry, 0); Q.setFromEuler(E);
      P.set(b.x, b.y, b.z);
      S.set(b.w, 1, 1);
      M.compose(P, Q, S);
      bM.setMatrixAt(i, M);
    });
    bM.instanceMatrix.needsUpdate = true;
    bM.frustumCulled = false;
    group.add(bM);
  }
  // ---- 地下道天花照明:每支橫樑下掛一具長條燈(常亮 emissive)----
  if (ceilLamps.length) {
    const lM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.14, 1.6),
      toonMat(0xece7d2, { emissive: new THREE.Color(0xffe9a0), emissiveIntensity: 0.9 }), ceilLamps.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
    const P = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1);
    ceilLamps.forEach((l, i) => {
      E.set(0, l.ry, 0); Q.setFromEuler(E);
      P.set(l.x, l.y, l.z);
      M.compose(P, Q, S);
      lM.setMatrixAt(i, M);
    });
    lM.instanceMatrix.needsUpdate = true;
    lM.castShadow = false;
    lM.frustumCulled = false;
    lM.userData.noOutline = true;
    group.add(lM);
  }
  // ---- 高架橋橋墩:橋面到地面的立柱(InstancedMesh)+ 墩頂帽梁;2026-07-15 起登記碰撞柱(cols → blockers)----
  if (piers.length) {
    const pM = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.18, 1, 8),
      envMat(0x9aa0a4, { wash: 0.35, cool: 0.45 }), piers.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
    const P = new THREE.Vector3(), S = new THREE.Vector3();
    piers.forEach((p, i) => {
      P.set(p.x, (p.y0 + p.y1) / 2, p.z);
      S.set(p.r, p.y1 - p.y0, p.r);
      M.compose(P, Q, S);
      pM.setMatrixAt(i, M);
    });
    pM.instanceMatrix.needsUpdate = true;
    pM.castShadow = false;
    pM.frustumCulled = false;
    group.add(pM);
    // 墩頂帽梁:橋墩與橋面之間加寬的橫向承接梁,補足支撐結構感
    const capM = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      envMat(0x8f959a, { wash: 0.35, cool: 0.45 }), piers.length);
    piers.forEach((p, i) => {
      E.set(0, p.ry, 0); Q.setFromEuler(E);
      P.set(p.x, p.y1 - 0.4, p.z);
      S.set(p.w, 0.8, p.r * 2.3);
      M.compose(P, Q, S);
      capM.setMatrixAt(i, M);
    });
    capM.instanceMatrix.needsUpdate = true;
    capM.castShadow = false;
    capM.frustumCulled = false;
    group.add(capM);
  }
  // ---- 隧道門洞:額牆 + 黑洞面 + 兩翼擋土牆(嵌進山壁,面朝來路)----
  for (const p of portals) {
    const g = new THREE.Group();
    const W = Math.max(6, p.w), H2 = Math.max(6.5, p.h || 6.5);   // 門洞高 ≥ 隧道淨空(最大機甲進得去)
    const wallM = envMat(0x9a958c, { wash: 0.4, cool: 0.45 });
    // 門洞是「真的洞」(2026-07-15 隧道有實體內部後改版):額牆 = 兩側立柱 + 頂梁,中央開口
    // (寬 W−1.6、高 H2−1.2)直通隧道路面 —— MUST NOT 退回蓋住路面的黑色實心塞子。
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(W + 3, 3.2, 1.2), wallM);
    lintel.position.y = H2 + 0.4;                        // 底緣 = 開口頂(H2 − 1.2)
    g.add(lintel);
    for (const s of [1, -1]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(2.3, H2 - 1.2, 1.2), wallM);
      pil.position.set(s * (W / 2 + 0.35), (H2 - 1.2) / 2, 0);
      g.add(pil);
    }
    for (const s of [1, -1]) {                             // 翼牆:向來路外八張開的擋土牆
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.0, H2 - 0.8, 6), wallM);
      wing.position.set(s * (W / 2 + 1.8), (H2 - 0.8) / 2 - 0.3, 2.4);
      wing.rotation.y = s * 0.5;
      g.add(wing);
    }
    // 洞口警示條紋(黃黑相間,貼在洞頂上緣):標示通行淨空邊界
    const stripeN = 8, stripeSpan = W - 1.6, stripeW = stripeSpan / stripeN;
    for (let si = 0; si < stripeN; si++) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(stripeW * 0.94, 0.5, 0.15),
        envMat(si % 2 === 0 ? 0xf2c230 : 0x1a1a1a, { wash: 0.2, cool: 0.2 }));
      seg.position.set(-stripeSpan / 2 + stripeW * (si + 0.5), H2 - 1.0, 0.76);
      g.add(seg);
    }
    g.traverse((o) => { if (o.isMesh) o.userData.noOutline = true; });
    g.position.set(p.x, p.y - 0.4, p.z);
    g.rotation.y = p.ry;
    group.add(g);
    // 門洞立柱 + 翼牆 → 碰撞柱:額牆旁邊不能直接走穿,只有中央開口可通行
    const ca = Math.cos(p.ry), sa = Math.sin(p.ry);
    const toW = (ox, oz) => [p.x + ox * ca + oz * sa, p.z - ox * sa + oz * ca];
    for (const s of [1, -1]) {
      const [pxw, pzw] = toW(s * (W / 2 + 0.35), 0);
      cols.push({ x: pxw, z: pzw, y: p.y - 0.6, r: 1.6, h: H2 + 2 });
      const [wxw, wzw] = toW(s * (W / 2 + 1.8), 2.4);
      cols.push({ x: wxw, z: wzw, y: p.y - 0.6, r: 1.7, h: H2 - 0.8 });
    }
  }
  // ---- 3D 附屬件:路燈 / 紅綠燈 / 行道樹(全 InstancedMesh)----
  roadPropMeshes(group, [
    { g: cyl(0.09, 0.13, 5.4, 6), y: 2.7, c: 0x50565e },
    { g: cyl(0.05, 0.07, 1.7, 5).rotateZ(Math.PI / 2), y: 5.32, px: 0.75, c: 0x50565e },
    { g: new THREE.BoxGeometry(0.66, 0.2, 0.32), y: 5.28, px: 1.5, c: 0xe8e2cc, e: 0xffe9a0 },
  ], lamps);
  roadPropMeshes(group, [
    { g: cyl(0.1, 0.14, 5.6, 6), y: 2.8, c: 0x3f464e },
    { g: cyl(0.06, 0.09, 3.0, 5).rotateZ(Math.PI / 2), y: 5.45, px: 1.4, c: 0x3f464e },
    { g: new THREE.BoxGeometry(1.1, 0.42, 0.3), y: 5.0, px: 2.4, c: 0x22262c },       // 橫式三燈箱
    { g: new THREE.BoxGeometry(0.22, 0.22, 0.08), y: 5.0, px: 2.06, pz: 0.16, c: 0x551512, e: 0xff3b30 },
    { g: new THREE.BoxGeometry(0.22, 0.22, 0.08), y: 5.0, px: 2.4, pz: 0.16, c: 0x554512, e: 0xffb200 },
    { g: new THREE.BoxGeometry(0.22, 0.22, 0.08), y: 5.0, px: 2.74, pz: 0.16, c: 0x124a22, e: 0x2ee06a },
  ], lights);
  const leafC = (ENV.seasons[season] || ENV.seasons.summer).foliage;   // 行道樹樹冠吃季節色
  roadPropMeshes(group, [
    { g: cyl(0.14, 0.2, 2.8, 5), y: 1.4, c: 0x6b4a2f },
    { g: ico(1.6).scale(1, 0.85, 1), y: 3.7, c: leafC },
    { g: ico(1.0).scale(1, 0.8, 1), y: 4.9, c: leafC },
  ], roadTrees);
  // 橋墩 → 碰撞柱:機體不能穿過橋墩(視覺已存在,補上物理;柱距 24m,通行綽綽有餘)。
  // 柱頂 MUST 封在橋面「底緣」(y1 − 1.2,與 ceilingAt 的 deck 厚度一致)—— 封到橋面上表面的話,
  // 站在橋上的機體 myBot == 柱頂,_collide 的嚴格不等式不會跳過 → 過橋時每 24m 被隱形柱側推。
  for (const p of piers) cols.push({ x: p.x, z: p.z, y: p.y0, r: p.r + 0.25, h: Math.max(1, p.y1 - 1.2 - p.y0) });
  return { built, decks, tunnels: tunnelSegs, cols };
}

/**
 * 橋面高度查詢:把橋面小段丟進均勻網格,回傳 deckY(x, z) —— 沒有橋面回 null。
 * 多層橋重疊時取最高面(上層橋才是站得住的那一面)。
 */
export function makeDeckIndex(decks) {
  if (!decks?.length) return () => null;
  const CELL = 16;
  const grid = new Map();
  const key = (i, j) => `${i},${j}`;
  decks.forEach((d, n) => {
    const pad = d.hw + 2;
    const i0 = Math.floor((Math.min(d.x1, d.x2) - pad) / CELL), i1 = Math.floor((Math.max(d.x1, d.x2) + pad) / CELL);
    const j0 = Math.floor((Math.min(d.z1, d.z2) - pad) / CELL), j1 = Math.floor((Math.max(d.z1, d.z2) + pad) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = key(i, j);
        let arr = grid.get(k);
        if (!arr) { arr = []; grid.set(k, arr); }
        arr.push(n);
      }
    }
  });
  // margin:**側向**容差(遊戲公尺,垂直於橋段方向)。站立表面查詢帶 margin(讓機體貼近橋緣不掉下
  // 窄橋面 → 上得了橋),天花碰撞查詢用 0(緊貼可見橋面,免橋緣外憑空撞頭)。
  // margin MUST NOT 洩到「縱向」(沿橋段方向):相鄰橋段共用端點會自然接手,只需 LONG_TOL 微容差銜接。
  // 前科(2026-07-18 倫敦案實測):舊版用 hypot(到夾制端點) > hw+margin 判定,margin=3 讓查詢點
  // 縱向溢出到「相鄰較高橋段」的端點 → 斜引道上回報的橋面高度被高估近一整段(~2.5m)→ 上橋台階
  // 超過 DECK_STEP → 爬到一半掉回地面、卡在橋下(=「無法走上去 / 破圖穿越」)。分離側向/縱向即修正。
  const LONG_TOL = 1.0;   // 縱向端點外容差:遠低於橋段長(ROAD_SEG 6m),不會夠到相鄰段端點
  return (x, z, margin = 0) => {
    const arr = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!arr) return null;
    let best = null;
    for (const n of arr) {
      const d = decks[n];
      const ex = d.x2 - d.x1, ez = d.z2 - d.z1;
      const len2 = ex * ex + ez * ez || 1, len = Math.sqrt(len2);
      const tRaw = ((x - d.x1) * ex + (z - d.z1) * ez) / len2;
      // 縱向:超出線段兩端的距離只准 LONG_TOL(margin 不放寬縱向 → 斜引道橋面高度不被高估)
      const over = (tRaw < 0 ? -tRaw : tRaw > 1 ? tRaw - 1 : 0) * len;
      if (over > LONG_TOL) continue;
      // 側向:點到橋段直線的垂距(叉積 / 段長),margin 只放寬這一維(貼橋緣不掉下)
      const lat = Math.abs((x - d.x1) * ez - (z - d.z1) * ex) / len;
      if (lat > d.hw + margin) continue;
      const t = tRaw < 0 ? 0 : tRaw > 1 ? 1 : tRaw;
      const y = d.y1 + (d.y2 - d.y1) * t;
      if (best === null || y > best) best = y;
    }
    return best;
  };
}

/**
 * 地下道查詢:回傳 (x, z) 處的 { floor, ceil }(路面高 / 天花高)—— 不在任何地下道上回 null。
 * game.js/main.js 以「curY < ceil」判定人在洞內(站路面),否則走地表;天花另供頭部碰撞。
 */
export function makeTunnelIndex(tunnels) {
  if (!tunnels?.length) return () => null;
  const CELL = 16;
  const grid = new Map();
  const key = (i, j) => `${i},${j}`;
  tunnels.forEach((d, n) => {
    const pad = d.hw + 2;
    const i0 = Math.floor((Math.min(d.x1, d.x2) - pad) / CELL), i1 = Math.floor((Math.max(d.x1, d.x2) + pad) / CELL);
    const j0 = Math.floor((Math.min(d.z1, d.z2) - pad) / CELL), j1 = Math.floor((Math.max(d.z1, d.z2) + pad) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = key(i, j); let arr = grid.get(k);
      if (!arr) { arr = []; grid.set(k, arr); }
      arr.push(n);
    }
  });
  return (x, z) => {
    const arr = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!arr) return null;
    let best = null;
    for (const n of arr) {
      const d = tunnels[n];
      const ex = d.x2 - d.x1, ez = d.z2 - d.z1;
      const len2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((x - d.x1) * ex + (z - d.z1) * ez) / len2));
      if (Math.hypot(x - (d.x1 + ex * t), z - (d.z1 + ez * t)) > d.hw) continue;
      const floor = d.fy1 + (d.fy2 - d.fy1) * t;
      if (best === null || floor < best.floor) best = { floor, ceil: d.cy1 + (d.cy2 - d.cy1) * t };
    }
    return best;
  };
}

// ---- 鐵路 / 捷運(圖資 way):道碴 + 雙軌 + 行駛中的低多邊形列車 ----
// 高度一致性(2026-07-18):OSM 常把一條連續鐵軌切成「地面 way + `bridge` way」,舊版對整條
// way 套固定 lift(高架 8m / 地面 0.35m)→ 接點瞬間垂直跳 8m,鐵軌看起來斷掉。改為**逐頂點
// lift**:高架段只在「未接續另一段高架」的端點爬升緩坡(RAMP 內插回地面),接續高架處保持全高
// → 地面↔高架平順銜接;橋墩隨爬升自動縮短(過矮者略過)。與道路 BRIDGE_RISE 端點緩坡同理。
const RAIL_ELEV = 8, RAIL_GROUND = 0.35, RAIL_RAMP = 55;
function buildRails(group, rails, terrain, center, dynamics, crossings) {
  // Pass A:圖資 → 世界折線片段(超界即切段),記高架旗標 + 端點地面高
  const raw = [];
  for (const way of rails) {
    if (way.tags.tunnel) continue;   // 隧道段不可見(捷運地下段)
    const elevated = !!way.tags.bridge || way.tags.railway === 'monorail';
    let cur = [];
    for (const gpt of way.geometry) {
      const [x, z] = llToWorld(gpt.lat, gpt.lon, center);
      if (x < terrain.minX + 5 || x > terrain.maxX - 5 || z < terrain.minZ + 5 || z > terrain.maxZ - 5) {
        if (cur.length >= 2) raw.push({ g: cur, elevated, tags: way.tags });
        cur = [];
        continue;
      }
      cur.push({ x, z, gy: terrain.heightAt(x, z) });
    }
    if (cur.length >= 2) raw.push({ g: cur, elevated, tags: way.tags });
    if (raw.length >= 30) break;
  }
  if (!raw.length) return 0;

  // 高架端點連續性:共用端點(相同 OSM 節點 → 相同世界座標)且兩側都高架 = 連續高架,不爬坡
  const ekey = (p) => `${Math.round(p.x * 2)},${Math.round(p.z * 2)}`;   // 0.5m 量化
  const elevCount = new Map();
  for (const r of raw) {
    if (!r.elevated) continue;
    for (const p of [r.g[0], r.g[r.g.length - 1]]) elevCount.set(ekey(p), (elevCount.get(ekey(p)) || 0) + 1);
  }

  // Pass B:逐頂點 lift(高架端點爬升緩坡 → 平順接地面)
  const lines = [];
  for (const r of raw) {
    const g = r.g, nP = g.length;
    const cum = [0];
    for (let i = 1; i < nP; i++) cum.push(cum[i - 1] + Math.hypot(g[i].x - g[i - 1].x, g[i].z - g[i - 1].z));
    const total = cum[nP - 1] || 1;
    let liftAt;
    if (r.elevated) {
      const startJoined = (elevCount.get(ekey(g[0])) || 0) >= 2;         // 起點接續另一段高架
      const endJoined = (elevCount.get(ekey(g[nP - 1])) || 0) >= 2;      // 終點接續另一段高架
      liftAt = (s) => {
        const upIn = startJoined ? 1 : s / RAIL_RAMP;
        const upOut = endJoined ? 1 : (total - s) / RAIL_RAMP;
        const ease = Math.max(0, Math.min(1, upIn, upOut));
        return RAIL_GROUND + (RAIL_ELEV - RAIL_GROUND) * ease;
      };
    } else {
      liftAt = () => RAIL_GROUND;
    }
    const pts = g.map((p, i) => new THREE.Vector3(p.x, p.gy + liftAt(cum[i]), p.z));
    lines.push({ pts, tags: r.tags, elevated: r.elevated });
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

  // 高架橋墩(捷運/橋段):爬升緩坡段橋墩自動變矮,過矮者(< 2.5m)略過不留地面殘樁
  const pierPts = segs.filter(([, , l]) => l.elevated).map(([a]) => a)
    .filter((a) => a.y - terrain.heightAt(a.x, a.z) > 2.5).slice(0, 200);
  if (pierPts.length) {
    const pierM = new THREE.InstancedMesh(unit, toonMat(0x8f9296), pierPts.length);
    pierPts.forEach((a, i) => {
      const gy = terrain.heightAt(a.x, a.z);
      P.set(a.x, (gy + a.y) / 2, a.z);
      S.set(1.6, a.y - gy, 1.6);
      M.compose(P, new THREE.Quaternion(), S);
      pierM.setMatrixAt(i, M);
    });
    pierM.instanceMatrix.needsUpdate = true;
    pierM.frustumCulled = false;
    group.add(pierM);
  }

  // 平交道(圖資 railway=level_crossing 節點):地面鐵軌與道路平面交會處的柵欄警示建模
  if (crossings?.length) buildLevelCrossings(group, crossings, lines, terrain, center);

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

// ---- 平交道(圖資 railway=level_crossing 節點):鐵路與道路平面交會處的柵欄警示 ----
// 只在「地面鐵軌」附近設(高架/隧道段不可能有平交道);方位取最近地面軌切線,道路 ≈ 垂直於軌。
function buildLevelCrossings(group, crossings, lines, terrain, center) {
  const segs = [];
  for (const l of lines) {
    if (l.elevated) continue;
    for (let i = 1; i < l.pts.length; i++) segs.push([l.pts[i - 1], l.pts[i]]);
  }
  if (!segs.length) return 0;
  let built = 0;
  for (const c of crossings) {
    if (built >= 8) break;
    const [x, z] = llToWorld(c.lat, c.lng, center);
    if (x < terrain.minX + 12 || x > terrain.maxX - 12 || z < terrain.minZ + 12 || z > terrain.maxZ - 12) continue;
    // 最近地面鐵軌段 → 軌道切線方向
    let bestD = Infinity, bdx = 0, bdz = 0, bx = 0, bz = 0;
    for (const [a, b] of segs) {
      const ex = b.x - a.x, ez = b.z - a.z, len2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / len2));
      const px = a.x + ex * t, pz = a.z + ez * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < bestD) { bestD = d; bdx = ex; bdz = ez; bx = px; bz = pz; }
    }
    if (bestD > 30) continue;   // 附近無地面鐵軌(可能落在高架/隧道段)→ 略過
    const rl = Math.hypot(bdx, bdz) || 1;
    group.add(makeLevelCrossing(bx, terrain.heightAt(bx, bz), bz, bdx / rl, bdz / rl));
    built++;
  }
  return built;
}

/** 平交道 3D 建模:兩支警示柱(交叉警示牌 + 紅燈箱)+ 抬起狀態的紅白遮斷器(平交道開放,不擋兵線)*/
function makeLevelCrossing(x, gy, z, rdx, rdz) {
  const g = new THREE.Group();
  g.position.set(x, gy, z);
  g.rotation.y = Math.atan2(-rdz, rdx);   // 本地 +X ← 鐵軌方向;道路 ≈ 本地 Z
  const ROADW = 9, TRK = 5.5, red = 0xd23a2e, white = 0xf2f2f2, dark = 0x2b2f33;
  const post = (sx, sz, face, armDir) => {
    const a = new THREE.Group();
    a.position.set(sx, 0, sz);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 4.2, 6), toonMat(dark));
    pole.position.y = 2.1; a.add(pole);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.7), toonMat(0x55595e));
    base.position.y = 0.25; a.add(base);
    // 紅燈箱(面向道路)
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.28), toonMat(dark));
    box.position.set(0, 3.0, face * 0.22); a.add(box);
    for (const lx of [-0.45, 0.45]) {
      const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.2, 12),
        toonMat(0x7a1c17, { emissive: new THREE.Color(0x3a0d0a), emissiveIntensity: 0.4 }));
      lamp.position.set(lx, 3.0, face * 0.37);
      lamp.rotation.y = face > 0 ? 0 : Math.PI;
      a.add(lamp);
    }
    // 交叉警示牌(St. Andrew's cross,面向道路)
    for (const rot of [Math.PI / 4, -Math.PI / 4]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.42, 0.1), toonMat(white));
      bar.position.set(0, 3.75, face * 0.32); bar.rotation.z = rot; a.add(bar);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.14, 0.12), toonMat(red));
      edge.position.set(0, 3.75, face * 0.34); edge.rotation.z = rot; a.add(edge);
    }
    // 遮斷器:抬起狀態(平交道開放,不擋兵線),紅白條紋臂
    const boom = new THREE.Group();
    boom.position.set(0, 2.4, 0);
    boom.rotation.z = armDir * 1.28;   // ~73° 抬起
    const ARM = ROADW * 0.62, seg = 6;
    for (let i = 0; i < seg; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(ARM / seg * 0.96, 0.24, 0.18), toonMat(i % 2 ? white : red));
      s.position.x = armDir * (ARM / seg) * (i + 0.5);
      boom.add(s);
    }
    a.add(boom);
    return a;
  };
  g.add(post(ROADW / 2 + 0.4, TRK, 1, -1));     // +Z 進場側:右肩 +X,臂朝 -X 跨路
  g.add(post(-ROADW / 2 - 0.4, -TRK, -1, 1));   // -Z 進場側:右肩 -X,臂朝 +X 跨路
  return g;
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

// ---- 邊界帶(空氣牆死區)的視覺邊界 ----
// 空氣牆在地形內縮 40m(game.js 夾 pos);邊界帶(內縮 8~34m)玩家永遠到不了。
// 沿四緣依地貌放置邊界物:市區 → 樓群、綠地/濕地 → 神木、裸露地 → 巨岩簇,
// 讓「打不開的邊」看起來是被城市/森林/岩壁圍住,而不是隱形牆。
// 全部走既有管線(generic 建物 / items 植被 InstancedMesh);邊界樓沿管線
// 也會登記碰撞柱 —— 反正在空氣牆外不可達,無礙。
function placeBoundary({ terrain, items, generic, rnd, mix, occ }) {
  const IN0 = 8, IN1 = 34;
  const species = Object.keys(GIANT_DEFS);
  const edges = [
    { x0: terrain.minX, z0: terrain.minZ, dx: 1, dz: 0, len: terrain.worldW },
    { x0: terrain.minX, z0: terrain.maxZ, dx: 1, dz: 0, len: terrain.worldW },
    { x0: terrain.minX, z0: terrain.minZ, dx: 0, dz: 1, len: terrain.worldH },
    { x0: terrain.maxX, z0: terrain.minZ, dx: 0, dz: 1, len: terrain.worldH },
  ];
  let placed = 0;
  for (const e of edges) {
    // 內縮方向:朝地圖中心
    const nx = e.dx ? 0 : (e.x0 === terrain.minX ? 1 : -1);
    const nz = e.dz ? 0 : (e.z0 === terrain.minZ ? 1 : -1);
    for (let d = 14 + rnd() * 20; d < e.len - 14; d += 22 + rnd() * 16) {
      const inset = IN0 + rnd() * (IN1 - IN0);
      const x = e.x0 + e.dx * d + nx * inset;
      const z = e.z0 + e.dz * d + nz * inset;
      const h = terrain.heightAt(x, z);
      if (h < 0.4) continue;   // 水面缺口:水面本身就是邊界
      const avail = occ.room(x, z) - 1;   // 與既有物(含邊界鄰居/邊緣 OSM 樓)的可用半徑
      const biome = classify(terrain.sampleColor?.(x, z), h, mix, rnd);
      if (biome === 'urban') {
        let w = 14 + rnd() * 14, dd = 12 + rnd() * 10;
        const f = Math.min(1, avail / (Math.max(w, dd) / 2));   // 塞不下就縮到剛好
        if (f < 0.45) continue;
        w *= f; dd *= f;
        const commercial = rnd() < 0.5;
        generic.push({
          x, z, w, d: dd,
          h: Math.min(22 + rnd() * 48, OVER.bldCap),
          ry: (e.dz ? Math.PI / 2 : 0) + (rnd() - 0.5) * 0.1,   // 沿邊排列成街牆
          commercial,
          v: Math.floor(rnd() * FACADES[commercial ? 'commercial' : 'residential'].length),
        });
        occ.add(x, z, Math.max(w, dd) / 2);
      } else if (biome === 'bare') {
        let s = 1.4 + rnd() * 2.0;
        s *= Math.min(1, avail / (3.6 * s));   // 腳印 ~3.6×s
        if (s < 0.7) continue;
        (items.borderrock ??= []).push({
          x, y: h - 0.6, z, s,
          ry: rnd() * Math.PI * 2, tx: (rnd() - 0.5) * 0.1, tz: (rnd() - 0.5) * 0.1,
        });
        occ.add(x, z, 3.6 * s);
      } else {   // green / wet → 神木牆
        const sp = species[Math.floor(rnd() * species.length)];
        let s = 0.65 + rnd() * 0.5;
        const rT = GIANT_DEFS[sp].r;
        // 幹腳印 +6:與邊界樓保持淨距,樹冠不貼上建物牆面(樹冠彼此交疊成林無妨)
        s *= Math.min(1, avail / (rT * s + 6));
        if (s < 0.4) continue;
        (items[sp] ??= []).push({
          x, y: h, z, s,
          ry: rnd() * Math.PI * 2, tx: (rnd() - 0.5) * 0.04, tz: (rnd() - 0.5) * 0.04,
        });
        occ.add(x, z, rT * s + 6);
      }
      placed++;
    }
  }
  return placed;
}

// ---- 邊界道路封鎖事件:道路穿出空氣牆處,以車禍/施工/巨坑封路 ----
// 對每條實體道路折線,找「內 → 外」跨越內縮 40m 空氣牆線的交點,
// 在交點內側放事件障礙(沿路面朝向)—— 向玩家解釋「這條路斷了」,
// 而不是開到隱形牆前莫名停下。障礙登記小碰撞柱(它就是封鎖物)。
function buildRoadBlocks(group, roads, terrain, center, blockers, rnd) {
  const INSET = 40;
  const x0 = terrain.minX + INSET, x1 = terrain.maxX - INSET;
  const z0 = terrain.minZ + INSET, z1 = terrain.maxZ - INSET;
  const inside = (p) => p[0] > x0 && p[0] < x1 && p[1] > z0 && p[1] < z1;
  const noOut = (grp) => { grp.traverse((o) => { if (o.isMesh) o.userData.noOutline = true; }); return grp; };
  const placed = [];

  const car = (c, len = 4.4) => {   // 低多邊形轎車(車禍用)
    const cg = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(len, 1.2, 1.9), toonMat(c));
    body.position.y = 0.9; cg.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(len * 0.45, 0.85, 1.7), toonMat(0x2c343c));
    cab.position.set(-len * 0.08, 1.9, 0); cg.add(cab);
    return cg;
  };
  const barrier = () => {   // 工程拒馬:橙白條紋橫板 + 雙腳
    const bg = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.7, 0.2), toonMat(0xd97b29));
    board.position.y = 1.0; bg.add(board);
    for (const sx of [-0.9, 0.3]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.24), toonMat(0xf2ede2));
      stripe.position.set(sx, 1.0, 0); bg.add(stripe);
    }
    for (const sx of [-1.2, 1.2]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.3, 0.7), toonMat(0x6a7278));
      leg.position.set(sx, 0.65, 0); bg.add(leg);
    }
    return bg;
  };
  const cone2 = () => {   // 交通錐(橙 + 白環)
    const gg = new THREE.Group();
    const c1 = new THREE.Mesh(cone(0.34, 0.9, 7), toonMat(0xd9622e));
    c1.position.y = 0.45; gg.add(c1);
    const band = new THREE.Mesh(cyl(0.21, 0.26, 0.18, 7), toonMat(0xf2ede2));
    band.position.y = 0.55; gg.add(band);
    return gg;
  };

  const KINDS = {
    crash: (g, rnd) => {   // 連環車禍:兩車追撞、一車翻覆 + 三角警示
      const c1 = car([0xc0392b, 0x2e6da4, 0xd8cfc4][Math.floor(rnd() * 3)]);
      c1.rotation.y = 0.45; c1.position.set(-2.2, 0, -0.8); g.add(c1);
      const c2 = car(0x9aa2a8, 4.0);
      c2.rotation.set(0.12, -0.5, 0.55);   // 半翻覆騎上前車
      c2.position.set(1.8, 0.35, 0.7); g.add(c2);
      const tri = new THREE.Mesh(cone(0.4, 0.7, 3), toonMat(0xd93a2b));
      tri.position.set(-5.5, 0.35, 0.5); g.add(tri);
      for (let i = 0; i < 4; i++) {   // 撞擊碎片
        const shard = new THREE.Mesh(ico(0.22), toonMat(0x3a4046));
        shard.position.set((rnd() - 0.5) * 6, 0.15, (rnd() - 0.5) * 3);
        g.add(shard);
      }
      return 5;
    },
    work: (g, rnd) => {   // 道路施工:拒馬排 + 交通錐 + 土堆
      for (const px of [-3, 0, 3]) {
        const b = barrier();
        b.position.set(px, 0, (rnd() - 0.5) * 0.8);
        b.rotation.y = Math.PI / 2 + (rnd() - 0.5) * 0.3;   // 橫在路上
        g.add(b);
      }
      for (let i = 0; i < 3; i++) {
        const c = cone2();
        c.position.set(-4 + i * 4 + (rnd() - 0.5), 0, 2.2 + rnd());
        g.add(c);
      }
      const spoil = new THREE.Mesh(ico(1.5), toonMat(0x8a6f52));
      spoil.scale.y = 0.55; spoil.position.set(1.5, 0.5, -2.4); g.add(spoil);
      return 5;
    },
    pit: (g, rnd) => {   // 路面巨坑:黑洞盤 + 崩裂瀝青塊 + 圍欄
      const pr = 4.5 + rnd() * 2.5;
      const hole = new THREE.Mesh(cyl(pr, pr * 0.92, 0.5, 12), toonMat(0x11151a));
      hole.position.y = 0.28; g.add(hole);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2 + rnd();
        const chunk = new THREE.Mesh(ico(0.7 + rnd() * 0.6), toonMat(0x3c4046));
        chunk.scale.y = 0.5;
        chunk.position.set(Math.cos(a) * (pr + 0.8), 0.25, Math.sin(a) * (pr + 0.8));
        g.add(chunk);
      }
      for (const sx of [-1, 1]) {
        const b = barrier();
        b.position.set(sx * (pr + 2), 0, 0);
        b.rotation.y = Math.PI / 2;
        g.add(b);
      }
      return pr + 2;
    },
  };
  const kindKeys = Object.keys(KINDS);

  for (const way of roads) {
    if (placed.length >= 24) break;
    if (!way.tags || way.tags.tunnel) continue;
    if (!/^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)$/.test(way.tags.highway || '')) continue;
    const pts = (way.geometry || []).map((p) => llToWorld(p.lat, p.lon, center));
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (inside(a) === inside(b)) continue;   // 沒有跨越空氣牆線
      // 與內縮框四邊求交,取線段上第一個交點
      const ts = [];
      for (const [va, vb, lim] of [[a[0], b[0], x0], [a[0], b[0], x1]]) {
        if ((va - lim) * (vb - lim) < 0) ts.push((lim - va) / (vb - va));
      }
      for (const [va, vb, lim] of [[a[1], b[1], z0], [a[1], b[1], z1]]) {
        if ((va - lim) * (vb - lim) < 0) ts.push((lim - va) / (vb - va));
      }
      if (!ts.length) continue;
      const t = Math.min(...ts);
      const cx = a[0] + (b[0] - a[0]) * t, cz = a[1] + (b[1] - a[1]) * t;
      // 障礙放交點「內側」6m,玩家撞牆前先看到封路
      const dirIn = inside(a) ? -1 : 1;
      const dl = Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]));
      const dx = (b[0] - a[0]) / dl * dirIn, dz = (b[1] - a[1]) / dl * dirIn;
      const ox = cx + dx * 6, oz = cz + dz * 6;
      if (placed.some((p) => Math.hypot(ox - p[0], oz - p[1]) < 30)) continue;   // 同路口去重
      const gy = terrain.heightAt(ox, oz);
      if (gy < 0.4) continue;
      const g = new THREE.Group();
      const kind = kindKeys[Math.floor(rnd() * kindKeys.length)];
      const or2 = KINDS[kind](g, rnd);
      noOut(g);
      g.position.set(ox, gy - 0.15, oz);
      g.rotation.y = Math.atan2(-dz, dx);   // +x 對齊路向
      group.add(g);
      blockers.push({ x: ox, z: oz, y: gy - 1, r: or2, h: 3 });
      placed.push([ox, oz]);
    }
  }
  return placed.length;
}

// 建物占位網格:補間建物不得與既有建物/地標互穿。
// bucket 邊長 64 > 最大(建物半對角 ~23 + 地標碰撞半徑 ~32 + gap 5),故 3×3 掃描必然涵蓋所有可能重疊者。
function makeOccupancy() {
  const C = 64;
  const g = new Map();
  const add = (x, z, r) => {
    const k = `${Math.floor(x / C)},${Math.floor(z / C)}`;
    let a = g.get(k);
    if (!a) g.set(k, a = []);
    a.push([x, z, r]);
  };
  const free = (x, z, r, gap) => {
    const ci = Math.floor(x / C), cj = Math.floor(z / C);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const a = g.get(`${ci + i},${cj + j}`);
        if (!a) continue;
        for (const [bx, bz, br] of a) if (Math.hypot(x - bx, z - bz) < r + br + gap) return false;
      }
    }
    return true;
  };
  // 此點的「可用半徑」= 到最近既有物邊緣的距離(掃 ±1 桶,上限 C)。
  // 「塞不下就縮到剛好」的量尺:呼叫端把腳印縮到 ≤ room 再放
  const room = (x, z) => {
    let best = C;
    const ci = Math.floor(x / C), cj = Math.floor(z / C);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const a = g.get(`${ci + i},${cj + j}`);
        if (!a) continue;
        for (const [bx, bz, br] of a) best = Math.min(best, Math.hypot(x - bx, z - bz) - br);
      }
    }
    return best;
  };
  return { add, free, room };
}

/**
 * 市區補間:把每個既有建物當「街廓種子」,沿它的朝向鋪一塊 cols×rows 的建物網格,
 * 補回連續街區。REAL_SCALE=0.5(遊戲=2×真實)下 OSM 建物間距約為真實 ×2(遠比舊制 8× 密),
 * 補間量由 occ.free() 自然收斂(擠不下就不補);OSM 覆蓋稀疏的郊區/未測繪街廓仍靠它長出街景:
 *   - 同街廓共用朝向 ⇒ 樓面對齊、巷弄成直線;街廓之間的空隙自然留成街道
 *   - 只從既有建物長出去 ⇒ 郊野維持開闊,不會整張圖長滿樓
 *   - areaFree(blocked) 擋住兵線走廊(半寬 17m)/ 塔位 / 主堡 ⇒ 淨空帶成為街廓夾出的戰略通道
 *   - occ 以「外接圓」保證不穿模;skip 留出空地/中庭破除棋盤感
 * 補出的建物與 OSM 建物走同一條路徑登記 blockers,碰撞/隱蔽一致。
 * rnd 為 mulberry32 且每格消耗固定枚數(檢查一律放在抽樣之後)⇒ 全房間各客戶端結果相同。
 */
function densifyUrban({ generic, blocked, terrain, rnd, inb, occ }) {
  if (!generic.length) return 0;
  // occ 為全建物共用占位網格(OSM/離線/地標已在收錄時登記),此處只續用

  const rint = ([lo, hi]) => lo + Math.floor(rnd() * (hi - lo + 1));
  let added = 0;
  for (const s of generic.slice(0, INFILL.maxSeeds)) {
    if (added >= MAX_INFILL) break;
    const ca = Math.cos(s.ry), sa = Math.sin(s.ry);
    const cols = rint(INFILL.cols), rows = rint(INFILL.rows);
    for (let i = 0; i < cols && added < MAX_INFILL; i++) {
      for (let j = 0; j < rows && added < MAX_INFILL; j++) {
        // 抽樣一律先做完,淘汰與否都消耗等量亂數 ⇒ 序列不因地形/淘汰而漂移
        const commercial = rnd() < 0.28;
        const w = (commercial ? 16 + rnd() * 16 : 10 + rnd() * 12) * OVER.bldXZ;
        const d = (commercial ? 16 + rnd() * 16 : 10 + rnd() * 12) * OVER.bldXZ;
        const h = Math.min((commercial ? 24 + rnd() * 40 : 7 + rnd() * 9) * OVER.bldH, OVER.bldCap);
        const jx = (rnd() - 0.5) * 2.4, jz = (rnd() - 0.5) * 2.4;   // 沿街微抖動
        const ry = s.ry + (rnd() - 0.5) * 0.12;
        const v = Math.floor(rnd() * FACADES[commercial ? 'commercial' : 'residential'].length);
        const vacant = rnd() < INFILL.skip;
        if (vacant) continue;
        const lx = (i - (cols - 1) / 2) * INFILL.pitch + jx;
        const lz = (j - (rows - 1) / 2) * INFILL.pitch + jz;
        const x = s.x + lx * ca + lz * sa;
        const z = s.z - lx * sa + lz * ca;
        if (x < terrain.minX + inb || x > terrain.maxX - inb
          || z < terrain.minZ + inb || z > terrain.maxZ - inb) continue;
        if (terrain.heightAt(x, z) <= 0.4) continue;              // 水面
        // occ 用外接圓(不穿模),blocked 用內縮圓(牆面不侵走廊)— 與 OSM 建物同一套判準
        const r = Math.hypot(w, d) / 2;
        if (!occ.free(x, z, Math.max(w, d) / 2, INFILL.gap)) continue;
        if (!areaFree(blocked, x, z, r * 0.75)) continue;
        occ.add(x, z, Math.max(w, d) / 2);
        generic.push({ x, z, w, d, h, ry, commercial, v });
        added++;
      }
    }
  }
  return added;
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

  // ---- OSM 圖資 + 地下道開挖 + 立體交通走廊(2026-07-15 提前到所有地物散布之前)----
  // 順序是硬約束:①洞口開挖先於植被/神木/建物 → 引道上的地物不再「先種在原地表、開挖後漂浮」;
  // ②隧道敞開段與橋樑走廊先進 blocked → 建物/巨木/巨石等障礙不會生成在地下道/隧道內與橋下淨空。
  // 此區全程不耗共享 rnd(fetch/合併/開挖/走廊皆確定性)⇒ 佈局亂數序列與舊版一致。
  onProgress?.(0.03, '讀取 OSM 圖資(建物/鐵路/道路/瀑布)…');
  let osmData = null, osmRoads = null;
  if (terrain.sampleColor) [osmData, osmRoads] = await Promise.all([fetchOsmFeatures(terrain.bbox), fetchOsmRoads(terrain.bbox)]);
  const osm = osmData?.buildings || null;
  // 隧道/橋樑分段合併(2026-07-15 二修):OSM 常把一條隧道/橋切成多條 way,共用節點
  // 深在山體內/河道上 —— 把「way 端點」當洞口/橋台會讓路面剖面在結構中段爬回地表
  // (Λ 形斷面、覆蓋斷開、接縫殘留岩階 = 洞內隱形牆)。共端點的同類 way MUST 先併成
  // 完整鏈,carveTunnels 與 buildRoads 共用同一份 → 剖面一致、洞口 = 鏈的真端點。
  if (osmRoads?.length) osmRoads = mergeGradeChains(osmRoads);
  // 地下道洞口開挖(真・下沉版):**只開挖敞開段/洞口**,深山段地表保持原樣(照常鋪地被拼圖)。
  // 路面 = 兩端洞口地表高的平直內插;山體自然高過路面即成隧道。
  const tunnelRuns = [];
  if (terrain.carveTunnels && osmRoads?.length) {
    for (const way of osmRoads) {
      if (!way.tags?.tunnel) continue;
      // 邊界裁切 MUST 與 buildRoads 完全相同(inb=4、逐頂點丟棄切段)—— 兩邊的 run 端點一致,
      // 路面剖面才一致。合併後的長鏈常跨出戰場邊界:拿「未裁切全長」內插 floors 會與
      // buildRoads 的 tFloorAt 分家(錨點與跨距都不同)→ 洞口高低差斷層、覆蓋/敞開分類錯位。
      const inb2 = 4;
      const wruns = [];
      let cur2 = [];
      for (const p of way.geometry || []) {
        const [x, z] = llToWorld(p.lat, p.lon, center);
        if (x < terrain.minX + inb2 || x > terrain.maxX - inb2 || z < terrain.minZ + inb2 || z > terrain.maxZ - inb2) {
          if (cur2.length >= 2) wruns.push(cur2);
          cur2 = [];
          continue;
        }
        cur2.push([x, z]);
      }
      if (cur2.length >= 2) wruns.push(cur2);
      for (const pts of wruns) {
        const cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        const tot = cum[cum.length - 1] || 1;
        const hA = terrain.heightAt(pts[0][0], pts[0][1]), hB = terrain.heightAt(pts[pts.length - 1][0], pts[pts.length - 1][1]);
        tunnelRuns.push({ pts, floors: cum.map((s) => hA + (hB - hA) * (s / tot)) });   // 平直路面
      }
    }
    if (tunnelRuns.length) terrain.carveTunnels(tunnelRuns, { clear: TUN.CLEAR, hw: TUN.HW });
  }
  // 道路輸入在此定案(離線備援 = 兵線當主要道路):走廊計算與 buildRoads MUST 吃同一份
  const roadInput = osmRoads?.length
    ? osmRoads
    : cfg.lanes.map((lane) => ({ tags: { highway: 'primary' }, geometry: lane.map(([lat, lng]) => ({ lat, lon: lng })) }));
  // 立體交通走廊:淨空(blocked)+ 上傳伺服器用小段(gradeCorridors);開挖後才算(高度已定案)
  const gradeCorridors = markGradeCorridors(roadInput, terrain, center, blocked);

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
        // 針葉林四款輪廓輪替(塔錐/簇疊/紡錘/層盤),同林異形不再滿山三角錐
        put(['conifer', 'conifer', 'conifer2', 'conifer3', 'conifer4'][(rnd() * 5) | 0], x, z, 0.75 + rnd() * 0.9);
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
  // ---- 圖資建物(OSM 已於開頭抓取;植被網格延後到建物定案之後才建:
  // 先拔掉落在建物腳印內的植被(見下),樹才不會穿屋頂)----
  const generic = [];       // {x,z,w,h,d,ry,commercial}
  const landmarks = [];     // {x,z,type,scale}
  const usedLm = new Set();
  // 全建物共用占位網格(OSM/離線/地標/補間):佔地是隨機抽的、不是 OSM 實測輪廓,
  // 相鄰 OSM 種子放大後會彼此互穿 —— 一律先驗占位再收
  const occ = makeOccupancy();
  // 街道淨空(2026-07-17 巴黎建物騎路案):OSM 建物只有中心點、量體與朝向是程序抽的,
  // 沿街種子與補間網格會直接壓上路面 —— 道路以占位圓帶進 occ,建物系統(種子/補間/邊界物)
  // 經既有 occ.free 檢查自動避讓。占位圓只作用於建物,植被/危險區不查 occ,影響面最小;
  // blocked 的 10m 網格對窄巷太粗(blockPoint 最小 30m 帶會清光沿街建物),不用它。
  // 隧道(覆蓋段上方照常鋪地物)與橋樑(橋下走廊已在 blocked)跳過;離線備援 = 兵線,
  // 走廊已淨空,同樣不需重複。不耗共享 rnd(佈局亂數序列不變)。
  // 同一迴圈順便把道路線段收進桶索引:建物朝向對齊最近道路(nearestRoadAngle)用。
  const roadSegIdx = new Map();   // `${bx},${bz}`(64m 桶)-> [[x1,z1,x2,z2]…]
  const SEG_C = 64;
  const segBucketAdd = (x1, z1, x2, z2) => {
    // 線段掛進兩端桶(段長 ≤ 桶邊即涵蓋);兩端同桶只掛一次
    const k1 = `${Math.floor(x1 / SEG_C)},${Math.floor(z1 / SEG_C)}`;
    const k2 = `${Math.floor(x2 / SEG_C)},${Math.floor(z2 / SEG_C)}`;
    for (const k of (k1 === k2 ? [k1] : [k1, k2])) {
      let a = roadSegIdx.get(k);
      if (!a) roadSegIdx.set(k, a = []);
      a.push([x1, z1, x2, z2]);
    }
  };
  if (osmRoads?.length) {
    for (const way of osmRoads) {
      if (way.tags?.tunnel || way.tags?.bridge) continue;
      const hw = roadWidth(way.tags) / 2;
      let px = null, pz = 0;
      for (const p of way.geometry || []) {
        const [x, z] = llToWorld(p.lat, p.lon, center);
        if (px !== null) {
          const seg = Math.hypot(x - px, z - pz);
          const n = Math.max(1, Math.ceil(seg / Math.max(hw * 1.2, 6)));
          for (let k = 1; k <= n; k++) {
            const sx = px + (x - px) * (k - 1) / n, sz = pz + (z - pz) * (k - 1) / n;
            const ex = px + (x - px) * k / n, ez = pz + (z - pz) * k / n;
            occ.add(ex, ez, hw);
            segBucketAdd(sx, sz, ex, ez);
          }
        } else {
          occ.add(x, z, hw);
        }
        px = x; pz = z;
      }
    }
  }
  /**
   * 最近道路段的沿路朝向(建物局部 x 軸對齊道路方向;查無 → null 由呼叫端 fallback)。
   * toW 轉換下局部 x 軸的世界向量 = (cos ry, −sin ry) ⇒ ry = atan2(−dz, dx)。
   * 掃 ±1 桶(最壞覆蓋 64m)—— 沿街建物離路遠小於此,街廓深處查無就隨機,符合直覺。
   */
  const nearestRoadAngle = (x, z) => {
    const ci = Math.floor(x / SEG_C), cj = Math.floor(z / SEG_C);
    let bd = Infinity, ang = null;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const a = roadSegIdx.get(`${ci + i},${cj + j}`);
        if (!a) continue;
        for (const [x1, z1, x2, z2] of a) {
          const dx = x2 - x1, dz = z2 - z1;
          const l2 = dx * dx + dz * dz;
          if (!l2) continue;
          let t = ((x - x1) * dx + (z - z1) * dz) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t));
          if (d < bd) { bd = d; ang = Math.atan2(-dz, dx); }
        }
      }
    }
    return ang;
  };

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
        // 地標放大後不能只驗中心格:以碰撞半徑掃走廊,牆面才不會侵入兵線
        const cr = (LANDMARK_COL[type]?.r || 10) * OVER.lm;
        // 電塔 ≠ 基地台/天線:輸電鐵塔立於地面開闊帶,橫擔外伸 ±8m —— 占位按
        // 橫擔全寬,建物不得貼近(否則手臂壓上屋頂,像「屋頂長電塔」)
        const or3 = Math.max(cr, type === 'power' ? 9 * OVER.lm : 0);
        if (landmarks.length < 60 && areaFree(blocked, x, z, cr * 0.8) && occ.free(x, z, or3, 1)) {
          landmarks.push({ x, z, type }); usedLm.add(type); occ.add(x, z, or3);
        }
      } else if (generic.length < MAX_BUILDINGS) {
        const commercial = type === 'commercial';
        const w = (commercial ? 16 + rnd() * 16 : 10 + rnd() * 12) * OVER.bldXZ;
        const d = (commercial ? 16 + rnd() * 16 : 10 + rnd() * 12) * OVER.bldXZ;
        // 佔地對齊現實比例後改用半對角掃走廊(單格驗證擋不住大樓牆面)
        if (!areaFree(blocked, x, z, Math.hypot(w, d) / 2 * 0.75)) continue;
        if (!occ.free(x, z, Math.max(w, d) / 2, 1)) continue;   // 不與既收建物互穿
        occ.add(x, z, Math.max(w, d) / 2);
        // 朝向對齊最近道路(2026-07-17):OSM 只給中心點,隨機朝向讓沿街建物歪斜壓路。
        // rnd 先抽(消耗固定枚數,查無路才用)—— 序列不因對齊與否漂移。
        const rndRy = rnd() * Math.PI;
        generic.push({
          x, z, w, d,
          h: buildingHeight(el.tags, type, rnd),
          ry: nearestRoadAngle(x, z) ?? rndRy, commercial,
          v: Math.floor(rnd() * FACADES[commercial ? 'commercial' : 'residential'].length),   // 立面樣式變體
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
      if (i < lmTypes.length && rnd() < 0.8) {
        const cr = Math.max((LANDMARK_COL[lmTypes[i]]?.r || 10) * OVER.lm,
          lmTypes[i] === 'power' ? 9 * OVER.lm : 0);   // 電塔占位按橫擔全寬(同 OSM 路徑)
        if (!occ.free(x, z, cr, 1)) return;
        occ.add(x, z, cr);
        landmarks.push({ x, z, type: lmTypes[i] }); return;
      }
      if (generic.length >= MAX_BUILDINGS) return;
      const commercial = rnd() < 0.25;
      const w = (commercial ? 16 + rnd() * 16 : 10 + rnd() * 12) * OVER.bldXZ;
      const d = (commercial ? 16 + rnd() * 16 : 10 + rnd() * 12) * OVER.bldXZ;
      if (!areaFree(blocked, x, z, Math.hypot(w, d) / 2 * 0.75)) return;
      if (!occ.free(x, z, Math.max(w, d) / 2, 1)) return;
      occ.add(x, z, Math.max(w, d) / 2);
      const rndRy = rnd() * Math.PI;   // 先抽保序列固定;離線無路網時 nearestRoadAngle 恆 null
      generic.push({
        x, z, w, d,
        h: Math.min((commercial ? 24 + rnd() * 40 : 7 + rnd() * 9) * OVER.bldH, OVER.bldCap),
        ry: nearestRoadAngle(x, z) ?? rndRy, commercial,
        v: Math.floor(rnd() * FACADES[commercial ? 'commercial' : 'residential'].length),   // 立面樣式變體
      });
    });
  }

  // 市區補間:把被 8 倍世界撐開的街廓填回連續街區(隱蔽 + 走廊夾出戰略通道)
  if (generic.length) {
    const n = densifyUrban({ generic, blocked, terrain, rnd, inb, occ });
    if (n) onProgress?.(0.68, `補間街廓建物(+${n} 棟)…`);
  }

  // 邊界帶視覺牆:放在補間之後(邊界樓不當補間種子)、植被過濾之前
  onProgress?.(0.69, '築起邊界帶(樓群/神木/巨岩)…');
  const boundaryN = placeBoundary({ terrain, items, generic, rnd, mix, occ });

  // 建物腳印內/貼牆的植被拔除:植被先散布、建物(圖資/補間)後放且互不看對方,
  // 不濾掉就會樹冠穿屋頂、樹卡進牆面。只濾「錨點貼地」的實例 —— 神木上的
  // 鳥巢/樹屋/垂藤錨在樹身高處,不在此列(神木本體已進 blocked,建物不會壓上來)。
  // 判定用「旋轉矩形 + 樹冠半徑外擴」:圓測試(半對角 ×0.8)在長方形建物的
  // 長邊側面留縫、角落外凸,貼牆的樹會漏掉。
  if (generic.length || landmarks.length) {
    const C = 64;   // 桶格 > 最大半對角 ~23(裙樓外擴後 ~32)+ 最大樹冠外擴 ~8,±1 格掃描必然涵蓋
    const rectG = new Map();
    for (const b of generic) {
      const k = `${Math.floor(b.x / C)},${Math.floor(b.z / C)}`;
      let a = rectG.get(k);
      if (!a) rectG.set(k, a = []);
      a.push(b);
    }
    const lmC = landmarks.map((lm) => [lm.x, lm.z, (LANDMARK_COL[lm.type]?.r || 10) * OVER.lm]);
    const hitsBld = (x, z, pad) => {
      const ci = Math.floor(x / C), cj = Math.floor(z / C);
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          const a = rectG.get(`${ci + i},${cj + j}`);
          if (!a) continue;
          for (const b of a) {
            const dx = x - b.x, dz = z - b.z;
            const ca = Math.cos(b.ry), sa = Math.sin(b.ry);
            // 世界 → 建物局部座標(densifyUrban 正轉的逆),含冠半徑外擴的矩形包含判定。
            // 佔地取「可能的最大輪廓」:商辦臨街裙樓 w×1.4 / d×1.28、住宅四坡屋簷 ×1.08
            // (輪廓件在後段 mesh 建置才擲骰決定,過濾當下不知道 → 一律按最大算,寧可多拔)
            const hw = b.w / 2 * (b.commercial ? 1.4 : 1.08);
            const hd = b.d / 2 * (b.commercial ? 1.28 : 1.08);
            if (Math.abs(dx * ca - dz * sa) < hw + pad
              && Math.abs(dx * sa + dz * ca) < hd + pad) return true;
          }
        }
      }
      for (const [lx, lz, lr] of lmC) if (Math.hypot(x - lx, z - lz) < lr + pad) return true;
      return false;
    };
    // 樹冠半徑係數(×實例 s ≈ 冠緣到樹幹的水平距):喬木冠寬大,樹幹離牆面至少
    // 一個冠半徑才不插牆;地被/草類貼牆自然,只留最小淨距
    const CROWN_R = {
      bamboo: 2.2, broadleaf: 3.2, birch: 2.6, conifer: 2.2, deadtree: 2.4, mangrove: 2.8,
      conifer2: 2.4, conifer3: 1.4, conifer4: 3.0,
      shrub: 1.2, silvergrass: 0.9, arrowbamboo: 1.0, succulent: 0.8, reed: 0.8,
    };
    for (const type in items) {
      // 神木不濾:已進 blocked(建物 areaFree 會避開),且登記了碰撞柱,拔掉會留隱形牆
      if (GIANT_DEFS[type]) continue;
      const cr = CROWN_R[type] ?? 1;
      const kept = items[type].filter((it) =>
        Math.abs(it.y - terrain.heightAt(it.x, it.z)) > 4 || !hitsBld(it.x, it.z, cr * it.s));
      placed -= items[type].length - kept.length;
      items[type] = kept;
    }
  }

  onProgress?.(0.7, '建置植被模型(Quaternius CC0)…');
  const nature = await naturePromise;
  for (const type in items) {
    const meshes = nature[type]
      ? buildVegMeshesGlb(nature[type], items[type])
      : buildVegMeshes(type, items[type], season);
    for (const m of meshes) group.add(m);
  }

  // 一般建物:住宅/商辦 × 七款立面樣式 InstancedMesh — 窗格立面貼圖
  // (白底 × 色盤 tint = 同貼圖多種外牆色)取代單一色塊;
  // 夜間亮窗走 emissiveMap(只有畫了燈的窗亮)。
  // 同時登記碰撞柱(blockers):限制玩家行動但不封鎖(走廊已淨空、可飛越屋頂)。
  const roofBoxes = [];    // 屋頂雜項(空調機組/機房):打破光禿平屋頂輪廓
  const roofTanks = [];    // 圓筒水塔
  const roofGables = [];   // 低層住宅四坡斜屋頂(彩色瓦)
  const billboards = [];   // 商辦屋頂廣告看板(彩色 + 夜間發光)
  const antennas = [];     // 高樓天線
  const cornices = [];     // 平屋頂簷口帶(頂緣外挑一圈 = 手繪描邊感的輪廓層)
  const chimneys = [];     // 斜屋頂磚砌煙囪(BOTW 村屋剪影)
  const roofPanels = [];   // 太陽能板陣列(同向斜板一排)
  const roofPads = [];     // 屋頂花園綠地墊
  const roofBushes = [];   // 屋頂灌木/花盆植栽
  const roofTreeList = []; // 屋頂盆栽闊葉樹(盆 + 幹 + 冠)
  const cellMasts = [];    // 行動基地台桅桿
  const cellPanels = [];   // 基地台三向扇區天線
  const wallSigns = [];    // 牆面直式招牌:建物垂直面唯一允許的附著物(垂直長條、微凸牆面)
  const bldStart = group.children.length;   // 碉堡淨空用:此後加入 group 的都是建物 InstancedMesh(供 clearAround 篩選)
  {
    const tint = new THREE.Color();
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
    const P = new THREE.Vector3(), S = new THREE.Vector3();
    for (const commercial of [false, true]) {
      const cat = commercial ? 'commercial' : 'residential';
      // 七款立面樣式各一個 InstancedMesh(共 14 個 draw call,仍是常數級)
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
        const pal = PALETTE[cat];
        // 先攤平成實例清單:主體 + 輪廓件(退縮頂塔/臨街裙樓)同吃立面貼圖與 tint,
        // 高層商辦成「婚禮蛋糕」剪影、街廓出裙樓 — 天際線擺脫單一長方體(botw_plan Task 1.1)
        const inst = [];
        list.forEach((b, i) => {
          // 佔地放大後坡地會露餡:取中心 + 四角最低點落底,寧可陷入山坡不懸空
          const ca = Math.cos(b.ry), sa = Math.sin(b.ry);
          let gy = terrain.heightAt(b.x, b.z);
          for (const [lx, lz] of [[b.w / 2, b.d / 2], [b.w / 2, -b.d / 2], [-b.w / 2, b.d / 2], [-b.w / 2, -b.d / 2]]) {
            gy = Math.min(gy, terrain.heightAt(b.x + lx * ca + lz * sa, b.z - lx * sa + lz * ca));
          }
          const palC = pal[((i * 2654435761) >>> 0) % pal.length];
          inst.push({ x: b.x, y: gy + b.h / 2 - 0.5, z: b.z, ry: b.ry, w: b.w, h: b.h, d: b.d, c: palC });
          // r = 圓柱近似(投影彈道 _blockerHitT 用,A6 刻意保留);hw2/hd2/ry = 真實盒面(_collide/_cameraDeClip
          // 用有向盒,免玩家/鏡頭斜向鑽進盒角破圖 —— 內切圓柱 r=0.8×盒角 < 盒角實體)
          blockers.push({ x: b.x, z: b.z, y: gy - 1, r: Math.hypot(b.w, b.d) / 2 * 0.8, h: b.h + 1, bld: 1, hw2: b.w / 2, hd2: b.d / 2, ry: b.ry });
          // 局部 → 世界(依建物朝向 ry 旋轉)
          const toW = (ox, oz) => [b.x + ox * ca + oz * sa, b.z - ox * sa + oz * ca];
          let crownTop = b.h;   // 天線/告示的落點(退縮頂塔時改放塔頂)
          let crownX = b.x, crownZ = b.z;
          if (commercial && b.h > 55 && rnd() < 0.6) {          // 退縮頂塔(夠高可再疊一階)
            // 頂塔偏心退縮(不再置中)= 婚禮蛋糕改成 BOTW 遺跡式不對稱剪影
            const tw = b.w * 0.62, td = b.d * 0.62, th = b.h * 0.22;
            const ox = (rnd() - 0.5) * (b.w - tw) * 0.8, oz = (rnd() - 0.5) * (b.d - td) * 0.8;
            [crownX, crownZ] = toW(ox, oz);
            inst.push({ x: crownX, y: gy + crownTop + th / 2 - 0.5, z: crownZ, ry: b.ry, w: tw, h: th, d: td, c: palC });
            crownTop += th;
            if (b.h > 100 && rnd() < 0.55) {
              const t2 = th * 0.7;
              inst.push({ x: crownX, y: gy + crownTop + t2 / 2 - 0.5, z: crownZ, ry: b.ry, w: tw * 0.62, h: t2, d: td * 0.62, c: palC });
              crownTop += t2;
            }
          }
          if (commercial && rnd() < 0.4) {                      // 臨街裙樓
            const ph = Math.max(6, b.h * 0.12);
            inst.push({ x: b.x, y: gy + ph / 2 - 0.5, z: b.z, ry: b.ry, w: b.w * 1.4, h: ph, d: b.d * 1.28, c: palC });
          }
          if (!commercial && b.h >= 14 && rnd() < 0.4) {        // 中層住宅:角落梯間塔(佔地內、突出屋頂)
            const tw = Math.min(b.w, b.d) * 0.3;
            const [tx, tz] = toW((b.w / 2 - tw / 2) * (rnd() < 0.5 ? 1 : -1),
                                 (b.d / 2 - tw / 2) * (rnd() < 0.5 ? 1 : -1));
            const th = b.h * (1.1 + rnd() * 0.1);
            inst.push({ x: tx, y: gy + th / 2 - 0.5, z: tz, ry: b.ry, w: tw, h: th, d: tw, c: palC });
          }
          let gable = false;
          if (!commercial && b.h < 30 && rnd() < 0.65) {        // 低層住宅:四坡斜屋頂
            gable = true;
            const rh = 2.5 + rnd() * 3;
            roofGables.push({ x: b.x, z: b.z, y: gy + b.h - 0.5, ry: b.ry, w: b.w, d: b.d, h: rh });
            if (rnd() < 0.55) {                                 // 磚煙囪:根植屋頂平面、貫穿斜屋面冒出
              const [cxw, czw] = toW((rnd() - 0.5) * b.w * 0.3, (rnd() - 0.5) * b.d * 0.2);
              // 從簷口面起算、高過該點屋面(≤0.85rh)→ 永不懸空,也必露頭
              chimneys.push({ x: cxw, z: czw, y: gy + b.h - 0.5, ry: b.ry, w: 0.9 + rnd() * 0.5, h: rh * 0.85 + 1.2 + rnd() * 1.0 });
            }
          } else if (rnd() < 0.5) {                             // 平屋頂:頂緣簷口外挑帶
            cornices.push({ x: b.x, z: b.z, y: gy + b.h - 0.5, ry: b.ry, w: b.w * 1.07, d: b.d * 1.07, c: fd.roof });
          }
          // 屋頂配件(斜屋頂棟跳過):機房/水塔照舊,擴充太陽能板陣列/屋頂花園
          // (綠地墊 + 灌木花盆 + 盆栽闊葉樹)/行動基地台。屋頂是唯一允許的附著面
          // —— 建物垂直牆面 MUST NOT 掛任何配件(樹木/電塔不附牆)
          const rr = rnd();
          if (!gable && rr < 0.9) {
            const ox = (rnd() - 0.5) * b.w * 0.4, oz = (rnd() - 0.5) * b.d * 0.4;
            const [wx, wz] = toW(ox, oz);
            const topY = gy + b.h - 0.5;
            if (rr < 0.2) {
              roofBoxes.push({
                x: wx, z: wz, y: topY, ry: b.ry,
                w: 1.6 + rnd() * b.w * 0.12, h: 1.4 + rnd() * 2.4, d: 1.6 + rnd() * b.d * 0.12,
              });
            } else if (rr < 0.36) {
              roofTanks.push({ x: wx, z: wz, y: topY, r: 1.1 + rnd() * 1.3, h: 2.4 + rnd() * 2.2 });
            } else if (rr < 0.58) {
              // 太陽能板:沿建物軸向一排同向斜板(排長受屋頂寬度夾限)
              const nP = Math.max(1, Math.min(2 + Math.floor(rnd() * 3), Math.floor(b.w * 0.8 / 3.2)));
              for (let p = 0; p < nP; p++) {
                const [px2, pz2] = toW(ox * 0.4 + (p - (nP - 1) / 2) * 3.2, oz);
                roofPanels.push({ x: px2, z: pz2, y: topY, ry: b.ry });
              }
            } else if (rr < 0.72 && Math.min(b.w, b.d) > 11) {
              // 屋頂花園:綠地墊 + 灌木簇 + (六成)一株盆栽闊葉樹
              roofPads.push({ x: wx, z: wz, y: topY, ry: b.ry, w: b.w * 0.45, d: b.d * 0.4 });
              const nB = 2 + Math.floor(rnd() * 2);
              for (let p = 0; p < nB; p++) {
                const [bx2, bz2] = toW(ox + (rnd() - 0.5) * b.w * 0.3, oz + (rnd() - 0.5) * b.d * 0.26);
                roofBushes.push({ x: bx2, z: bz2, y: topY + 0.3, s: 0.7 + rnd() * 0.6 });
              }
              if (rnd() < 0.6) roofTreeList.push({ x: wx, z: wz, y: topY + 0.3, s: 0.9 + rnd() * 0.5 });
            } else if (rr < 0.82) {
              // 行動基地台:桅桿 + 頂端三向扇區天線
              const mh = 4.5 + rnd() * 2.5;
              cellMasts.push({ x: wx, z: wz, y: topY, h: mh });
              for (let p = 0; p < 3; p++) {
                cellPanels.push({ x: wx, z: wz, y: topY + mh - 1.0, ry: b.ry + p * (Math.PI * 2 / 3) });
              }
            } else {
              // 單簇花盆灌木(小屋頂也放得下)
              roofBushes.push({ x: wx, z: wz, y: topY, s: 0.7 + rnd() * 0.6 });
            }
          }
          if (commercial && b.h > 40 && crownTop === b.h && rnd() < 0.5) {   // 頂塔棟看板會插進塔身 → 跳過
            billboards.push({ x: b.x, z: b.z, y: gy + b.h - 0.5, ry: b.ry, w: Math.min(b.w * 0.7, 10), h: 3 + rnd() * 4 });
          }
          if ((commercial || fd.style === 'shop') && b.h > 14 && rnd() < 0.35) {
            // 直式招牌:亞洲街景的垂直長條招牌,掛在牆面微凸 0.4m
            const sh = Math.min(14, b.h * 0.55);
            const sw = 1.6 + rnd() * 0.8;
            const face = Math.floor(rnd() * 4);              // 0:+x 1:−x 2:+z 3:−z
            const alongW = face < 2;
            const off = (rnd() - 0.5) * (alongW ? b.d : b.w) * 0.5;
            const [sx2, sz2] = alongW
              ? toW((face === 0 ? 1 : -1) * (b.w / 2 + 0.4), off)
              : toW(off, (face === 2 ? 1 : -1) * (b.d / 2 + 0.4));
            wallSigns.push({
              x: sx2, z: sz2, y: gy + b.h * 0.55 - 0.5,
              ry: b.ry + (alongW ? 0 : Math.PI / 2),
              w: sw, h: sh,
            });
          }
          if (commercial && b.h > 60 && rnd() < 0.6) {
            antennas.push({ x: crownX, z: crownZ, y: gy + crownTop - 0.5, h: 5 + rnd() * 7 });   // 偏心頂塔時跟著塔頂
          }
        });
        // BoxGeometry 群組順序 +x,-x,+y,-y,+z,-z
        const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), [wall, wall, roof, roof, wall, wall], inst.length);
        inst.forEach((t, i) => {
          E.set(0, t.ry, 0); Q.setFromEuler(E);
          P.set(t.x, t.y, t.z);
          S.set(t.w, t.h, t.d);
          M.compose(P, Q, S);
          m.setMatrixAt(i, M);
          // 色盤之上再疊每實例色相/明度微抖:同色相鄰棟不再完全同色(水彩手感)
          const jh = ((i * 2654435761) >>> 0) % 100 / 100;
          const jl = ((i * 1597334677) >>> 0) % 100 / 100;
          tint.setHex(t.c).offsetHSL((jh - 0.5) * 0.03, 0, (jl - 0.5) * 0.1);
          m.setColorAt(i, tint);
        });
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.frustumCulled = false;
        group.add(m);
      }
    }
    if (cornices.length) {
      // 簷口帶:比主體大一圈的薄板,tint = 該立面款的屋頂色(與屋頂同系 = 頂緣描一筆深色)
      const cm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bmat(0xffffff, { wash: 0.5 }), cornices.length);
      cornices.forEach((c, i) => {
        E.set(0, c.ry, 0); Q.setFromEuler(E);
        P.set(c.x, c.y + 0.45, c.z);
        S.set(c.w, 0.9, c.d);
        M.compose(P, Q, S);
        cm.setMatrixAt(i, M);
        tint.setHex(c.c);
        cm.setColorAt(i, tint);
      });
      cm.instanceMatrix.needsUpdate = true;
      if (cm.instanceColor) cm.instanceColor.needsUpdate = true;
      cm.frustumCulled = false;
      group.add(cm);
    }
    if (chimneys.length) {
      const hm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bmat(0x9a5a44, { wash: 0.5 }), chimneys.length);
      chimneys.forEach((c, i) => {
        E.set(0, c.ry, 0); Q.setFromEuler(E);
        P.set(c.x, c.y + c.h / 2, c.z);
        S.set(c.w, c.h, c.w);
        M.compose(P, Q, S);
        hm.setMatrixAt(i, M);
      });
      hm.instanceMatrix.needsUpdate = true;
      hm.frustumCulled = false;
      group.add(hm);
    }
    if (roofPanels.length) {
      // 斜置光電板(傾角烤進幾何,實例只轉 ry):深藍面板 + 微高光
      const pgeo = new THREE.BoxGeometry(2.8, 0.12, 1.8);
      pgeo.rotateX(-0.3);
      pgeo.translate(0, 0.6, 0);
      const pm2 = new THREE.InstancedMesh(pgeo, bmat(0x27435f), roofPanels.length);
      roofPanels.forEach((p, i) => {
        E.set(0, p.ry, 0); Q.setFromEuler(E);
        P.set(p.x, p.y, p.z); S.set(1, 1, 1);
        M.compose(P, Q, S);
        pm2.setMatrixAt(i, M);
      });
      pm2.instanceMatrix.needsUpdate = true;
      pm2.frustumCulled = false;
      group.add(pm2);
    }
    if (roofPads.length) {
      const gm2 = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.3, 1), toonMat(0x4f7a3c), roofPads.length);
      roofPads.forEach((p, i) => {
        E.set(0, p.ry, 0); Q.setFromEuler(E);
        P.set(p.x, p.y + 0.15, p.z); S.set(p.w, 1, p.d);
        M.compose(P, Q, S);
        gm2.setMatrixAt(i, M);
      });
      gm2.instanceMatrix.needsUpdate = true;
      gm2.frustumCulled = false;
      group.add(gm2);
    }
    if (roofBushes.length) {
      const bm2 = new THREE.InstancedMesh(ico(0.8), toonMat(0x4f8a44), roofBushes.length);
      roofBushes.forEach((p, i) => {
        P.set(p.x, p.y + 0.55 * p.s, p.z); S.set(p.s, p.s * 0.72, p.s);
        M.compose(P, new THREE.Quaternion(), S);
        bm2.setMatrixAt(i, M);
        const j1 = ((i * 2654435761) >>> 0) % 100 / 100;
        tint.setRGB(0.8 + j1 * 0.35, 0.85 + ((i * 1597334677) >>> 0) % 100 / 100 * 0.3, 0.8);
        bm2.setColorAt(i, tint);
      });
      bm2.instanceMatrix.needsUpdate = true;
      if (bm2.instanceColor) bm2.instanceColor.needsUpdate = true;
      bm2.frustumCulled = false;
      group.add(bm2);
    }
    if (roofTreeList.length) {
      // 盆栽闊葉樹:盆 + 幹 + 冠(三個 InstancedMesh)
      const potM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 0.7, 0.6, 7), bmat(0x8a6a52), roofTreeList.length);
      const trkM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.18, 1.8, 5), toonMat(0x6b4a30), roofTreeList.length);
      const cnpM = new THREE.InstancedMesh(ico(1.1), toonMat(0x4f8a44), roofTreeList.length);
      roofTreeList.forEach((p, i) => {
        P.set(p.x, p.y + 0.3 * p.s, p.z); S.set(p.s, p.s, p.s);
        M.compose(P, new THREE.Quaternion(), S); potM.setMatrixAt(i, M);
        P.set(p.x, p.y + 1.4 * p.s, p.z);
        M.compose(P, new THREE.Quaternion(), S); trkM.setMatrixAt(i, M);
        P.set(p.x, p.y + 2.9 * p.s, p.z); S.set(p.s * 1.25, p.s * 0.95, p.s * 1.25);
        M.compose(P, new THREE.Quaternion(), S); cnpM.setMatrixAt(i, M);
      });
      for (const m2 of [potM, trkM, cnpM]) {
        m2.instanceMatrix.needsUpdate = true;
        m2.frustumCulled = false;
        group.add(m2);
      }
    }
    if (cellMasts.length) {
      const mm2 = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.16, 1, 6), toonMat(0xc4ccd2), cellMasts.length);
      cellMasts.forEach((p, i) => {
        P.set(p.x, p.y + p.h / 2, p.z); S.set(1, p.h, 1);
        M.compose(P, new THREE.Quaternion(), S);
        mm2.setMatrixAt(i, M);
      });
      mm2.instanceMatrix.needsUpdate = true;
      mm2.frustumCulled = false;
      group.add(mm2);
    }
    if (cellPanels.length) {
      // 扇區天線:窄立板自桿心外推(偏移烤進幾何,實例只轉 ry)
      const cgeo = new THREE.BoxGeometry(0.5, 1.2, 0.16);
      cgeo.translate(0, 0, 0.5);
      const cm2 = new THREE.InstancedMesh(cgeo, bmat(0xdfe4e8), cellPanels.length);
      cellPanels.forEach((p, i) => {
        E.set(0, p.ry, 0); Q.setFromEuler(E);
        P.set(p.x, p.y, p.z); S.set(1, 1, 1);
        M.compose(P, Q, S);
        cm2.setMatrixAt(i, M);
      });
      cm2.instanceMatrix.needsUpdate = true;
      cm2.frustumCulled = false;
      group.add(cm2);
    }
    if (wallSigns.length) {
      // 直式招牌:厚度烤進幾何(0.55),實例縮放只吃高/寬;彩色 tint + 夜間背光
      const wsM = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.55, 1, 1),
        bmat(0xffffff, { emissive: new THREE.Color(night ? 0xfff2cc : 0x000000), emissiveIntensity: night ? 0.5 : 0 }),
        wallSigns.length,
      );
      const spal = [0xe8734a, 0x4a9ae8, 0xe8c84a, 0x6cc45e, 0xd95e8a, 0x8a6ae8];
      wallSigns.forEach((sgn, i) => {
        E.set(0, sgn.ry, 0); Q.setFromEuler(E);
        P.set(sgn.x, sgn.y, sgn.z);
        S.set(1, sgn.h, sgn.w);
        M.compose(P, Q, S);
        wsM.setMatrixAt(i, M);
        tint.setHex(spal[((i * 40503) >>> 0) % spal.length]);
        wsM.setColorAt(i, tint);
      });
      wsM.instanceMatrix.needsUpdate = true;
      if (wsM.instanceColor) wsM.instanceColor.needsUpdate = true;
      wsM.frustumCulled = false;
      group.add(wsM);
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
    if (roofGables.length) {
      // 單位四角錐(底面 1×1 貼齊屋頂),instance tint 上瓦色
      const geo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4);
      geo.rotateY(Math.PI / 4);
      geo.translate(0, 0.5, 0);
      const gm = new THREE.InstancedMesh(geo, bmat(0xffffff, { wash: 0.5 }), roofGables.length);
      const rpal = [0xa2543e, 0x7d8a70, 0x54636e, 0x8a6f5a, 0x9c8e7c, 0x6e5a48];
      roofGables.forEach((r, i) => {
        E.set(0, r.ry, 0); Q.setFromEuler(E);
        P.set(r.x, r.y, r.z);
        S.set(r.w * 1.08, r.h, r.d * 1.08);
        M.compose(P, Q, S);
        gm.setMatrixAt(i, M);
        tint.setHex(rpal[((i * 40503) >>> 0) % rpal.length]);
        gm.setColorAt(i, tint);
      });
      gm.instanceMatrix.needsUpdate = true;
      if (gm.instanceColor) gm.instanceColor.needsUpdate = true;
      gm.frustumCulled = false;
      group.add(gm);
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
  const bldMeshes = group.children.slice(bldStart);   // 建物實例(不含之後的地標/植被/道路),供 clearAround 篩選
  const landmarkG = [];                               // 地標群組 + 佔地半徑(clearAround 一併隱藏整棟)
  // 特殊地標(超尺度 + 碰撞柱)
  onProgress?.(0.85, '放置地標建物…');
  for (const lm of landmarks) {
    const g = new THREE.Group();
    LANDMARKS[lm.type](g);
    bakeContactAO(g, 3);   // 接地 AO 頂點色:地標與地面接縫處手繪暗角(botw_plan Task 2.2)
    let sc = OVER.lm * (0.9 + rnd() * 0.25);
    // 山丘頂容不下就縮(同巨岩);地標縮太小不像公共建築 → 下限 0.55×
    const lr0 = (LANDMARK_COL[lm.type]?.r || 10) * sc;
    const lfr = flatRadiusAt(terrain, lm.x, lm.z, lr0 + 6, 5);
    if (lfr < lr0) sc *= Math.max(0.55, lfr / lr0);
    g.scale.setScalar(sc);
    // 佔地放大後坡地會露餡:取中心 + 四向最低點落底,寧可陷入山坡不懸空
    const lr = (LANDMARK_COL[lm.type]?.r || 10) * sc * 0.7;
    let gy = terrain.heightAt(lm.x, lm.z);
    for (const [ox, oz] of [[lr, 0], [-lr, 0], [0, lr], [0, -lr]]) {
      gy = Math.min(gy, terrain.heightAt(lm.x + ox, lm.z + oz));
    }
    g.position.set(lm.x, gy - 0.3, lm.z);
    g.rotation.y = rnd() * Math.PI * 2;
    group.add(g);
    landmarkG.push({ g, x: lm.x, z: lm.z, r: (LANDMARK_COL[lm.type]?.r || 10) * sc });   // 碉堡淨空:整棟隱藏用
    const col = LANDMARK_COL[lm.type];
    if (col) blockers.push({ x: lm.x, z: lm.z, y: gy - 1, r: col.r * sc, h: col.h * sc + 1, bld: 1 });
  }

  // ---- 地被覆蓋層:開闊地的賽璐璐地表色塊 + 表面細節(ground.js)----
  // 專用 rnd(同心種子異或常數):不動用共享 rnd 序列,建物/植被佈局不受影響
  onProgress?.(0.88, '鋪設地表覆蓋層…');
  const gseed = (Math.round(center.lat * 1e4) * 31 + Math.round(center.lng * 1e4)) >>> 0;
  const grnd = mulberry32(gseed ^ 0x51AB);
  const ground = buildGroundCover(group, terrain, {
    isBlocked: (x, z) => blocked.has(cellKey(x, z)),
    classifyAt: (x, z) => classify(terrain.sampleColor?.(x, z), terrain.heightAt(x, z), mix, grnd),
    // 底毯與特徵層一律走純色彩分類(mix=null,跳過 55% 場地隨機改寫)→
    // 拼圖類型與衛星圖資相符;classifyAt 僅作 classifyPureAt 缺席時的備援

    classifyPureAt: (x, z) => classify(terrain.sampleColor?.(x, z), terrain.heightAt(x, z), null, grnd),
    blockers, season, seed: gseed, rnd: grnd,
  });

  // ---- 道路(圖資主/次要;離線則以兵線為主要道路備援;roadInput 已於開頭與走廊共用定案)----
  onProgress?.(0.9, '鋪設道路路面…');
  const roadRes = buildRoads(group, roadInput, terrain, center, mix, rnd, season);
  // ---- 兵線跨水補橋(2026-07-15):兵線不在 OSM 路網上(合成側翼/離線弧)時,跨水段一樣
  // MUST 有高架橋 —— 道路(兵線)通過大面積水域一定要建橋。只補「泡水且尚無真橋 deck 覆蓋」
  // 的兵線段(偽 way 只含該泡水段,不重畫乾地路面 = 不與既有街道 z-fight)。
  if (osmRoads?.length && cfg.lanes?.length) {
    const deckIdx = makeDeckIndex(roadRes.decks);
    const wetWays = [];
    for (const lane of cfg.lanes) {
      const pts = densify(lane.map(([lat, lng]) => llToWorld(lat, lng, center)), ROAD_SEG);
      for (const p of splitWaterPieces(pts, terrain)) {
        if (p.wet !== true || p.length < 2) continue;
        const m = p[(p.length / 2) | 0];
        if (deckIdx(m[0], m[1]) != null) continue;   // 真橋已覆蓋,不重蓋
        wetWays.push({ tags: { highway: 'primary' }, geometry: p.map(([x, z]) => worldToLL(x, z, center)) });
      }
    }
    if (wetWays.length) {
      const laneRes = buildRoads(group, wetWays, terrain, center, mix, rnd, season);
      roadRes.decks.push(...laneRes.decks);
      roadRes.cols.push(...laneRes.cols);
      gradeCorridors.push(...markGradeCorridors(wetWays, terrain, center, blocked));
    }
  }
  const roadsBuilt = roadRes.built;
  group.userData.decks = roadRes.decks;   // 橋面(main.js → terrain.decks/deckY → game.js 表面高度)
  group.userData.tunnels = roadRes.tunnels;   // 地下道路面 + 天花(main.js → terrain.tunnelAt/ceilingAt)
  blockers.push(...roadRes.cols);         // 橋墩/門洞立柱:與建物同一條碰撞路徑(玩家不可穿)
  // 道路穿出空氣牆處 → 車禍/施工/巨坑封路事件(合成兵線不出界,自然為 0)
  const roadBlockN = buildRoadBlocks(group, roadInput, terrain, center, blockers, rnd);

  // ---- 鐵路/捷運(含行駛列車)+ 瀑布(動態物件)----
  onProgress?.(0.92, '鋪設鐵路與瀑布…');
  const dynamics = [];
  const railLines = osmData?.rails?.length ? buildRails(group, osmData.rails, terrain, center, dynamics, osmData.crossings) : 0;
  const fallsBuilt = osmData?.falls?.length ? buildWaterfalls(group, osmData.falls, terrain, center, dynamics) : 0;
  if (dynamics.length) {
    group.userData.update = (dt) => { for (const fn of dynamics) fn(dt); };
  }

  onProgress?.(1, '地貌完成');
  group.userData.blockers = blockers;   // 建物碰撞柱(main.js → terrain.blockers → game.js _collide)
  // 立體交通走廊(隧道全段 + 橋樑走廊):main.js 上傳伺服器 → sim 清除走廊內第三方障礙/地雷
  group.userData.gradeCorridors = gradeCorridors;
  group.userData.stats = {
    veg: placed,
    giantTrees,
    megaliths: megalithsBuilt,
    ground: ground.patches,
    groundDetails: ground.details,
    buildings: generic.length + landmarks.length,
    landmarks: landmarks.length,
    roads: roadsBuilt,
    roadBlocks: roadBlockN,
    boundary: boundaryN,
    rails: railLines,
    falls: fallsBuilt,
    osm: !!(osm && osm.length),
  };
  // 碉堡淨空(反應式):碉堡進場時 game.js 呼叫。移除「與碉堡淨空區重疊」的建物(縮 0 隱形)+ 地標(整棟隱藏),
  // 並同步清掉這些建物/地標「自己的」碰撞柱(bld 標記)——植被/巨岩/橋墩(非建物)一律保留機體與碰撞。
  // 視覺與碰撞用同一個「圓重疊」判定(距離 − 半徑 < r)⇒ A6 砲火/碰撞一致:不會出現看得見卻穿得過、
  // 或看不見卻擋彈的物件。回傳是否有動到碰撞柱(供 game.js 決定是否重建 _blockGrid)。
  group.userData.clearAround = (wx, wz, r) => {
    const P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), M = new THREE.Matrix4();
    for (const o of bldMeshes) {
      if (!o.isInstancedMesh) continue;
      let hit = false;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, M); M.decompose(P, Q, S);
        if (S.x === 0) continue;   // 已清過(縮 0)略過
        // 圓重疊:實例佔地半徑 = hypot(寬,深)/2×0.8(與建物碰撞柱 r 同式)
        if (Math.hypot(P.x - wx, P.z - wz) - Math.hypot(S.x, S.z) / 2 * 0.8 < r) { M.makeScale(0, 0, 0); o.setMatrixAt(i, M); hit = true; }
      }
      if (hit) o.instanceMatrix.needsUpdate = true;
    }
    for (const lm of landmarkG) {
      if (!lm.cleared && Math.hypot(lm.x - wx, lm.z - wz) - lm.r < r) { lm.g.visible = false; lm.cleared = true; }
    }
    // 同步清建物/地標碰撞柱(bld=1):in-place splice 讓 terrain.blockers(同一陣列參照)一併生效
    let removed = false;
    const blk = group.userData.blockers;
    for (let i = blk.length - 1; i >= 0; i--) {
      const b = blk[i];
      if (b.bld && Math.hypot(b.x - wx, b.z - wz) - (b.r || 0) < r) { blk.splice(i, 1); removed = true; }
    }
    return removed;
  };
  return group;
}
