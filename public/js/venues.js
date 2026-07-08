// ============ 預設場地(世界地標 / 風景區)+ 我的最愛 ============
// 每個場地 = 錨點座標 + 地貌組成 mix(供 biomes.js 分類加權)
//   + bearing(對點方位角,朝內陸/地形有趣的方向):
//   單一型:主要地貌 ≥ 80%;混合型:多種地貌各佔一定比例。
// mix 鍵對應 data.js 的 BIOMES:green 綠地 / bare 裸露地 / urban 市區 / water 水體 / wet 濕地。
// 預設場地的路線/圖資「預先算好」:venueConfig() 以確定性幾何直接產出
// 完整 battleConfig(合成兵線),不需要 OSRM 掃描即可開房;
// 想用真實道路兵線,仍可在地圖上手動點選錨點走掃描流程。
// 「我的最愛」存整份 battleConfig(含兵線),選了即用、不必重新搜尋。
import { MAPGEO, lanesFor, targetDistFor } from './data.js';

export const VENUES = [
  // ---- 市區單一(≥80%)----
  { id: 'taipei101',  name: '台北・101 信義計畫區',   country: '🇹🇼', type: '市區', ll: [25.0339, 121.5645], bearing: 190, mix: { urban: 0.85, green: 0.1, water: 0.05 } },
  { id: 'shibuya',    name: '東京・澀谷十字路口',     country: '🇯🇵', type: '市區', ll: [35.6595, 139.7005], bearing: 280, mix: { urban: 0.9, green: 0.1 } },
  { id: 'manhattan',  name: '紐約・曼哈頓中城',       country: '🇺🇸', type: '市區', ll: [40.7549, -73.9840], bearing: 30,  mix: { urban: 0.85, green: 0.15 } },
  { id: 'paris',      name: '巴黎・艾菲爾鐵塔',       country: '🇫🇷', type: '市區', ll: [48.8584, 2.2945],   bearing: 95,  mix: { urban: 0.8, green: 0.15, water: 0.05 } },
  { id: 'seoul',      name: '首爾・江南',             country: '🇰🇷', type: '市區', ll: [37.4979, 127.0276], bearing: 150, mix: { urban: 0.9, green: 0.1 } },

  // ---- 綠地單一(≥80%)----
  { id: 'yangmingshan', name: '陽明山國家公園',       country: '🇹🇼', type: '綠地', ll: [25.1550, 121.5600], bearing: 100, mix: { green: 0.85, bare: 0.15 } },
  { id: 'aokigahara',  name: '富士山麓・青木原樹海',  country: '🇯🇵', type: '綠地', ll: [35.4700, 138.6200], bearing: 260, mix: { green: 0.9, bare: 0.1 } },
  { id: 'blackforest', name: '德國・黑森林',          country: '🇩🇪', type: '綠地', ll: [48.2700, 8.1700],   bearing: 10,  mix: { green: 0.9, bare: 0.1 } },
  { id: 'yosemite',    name: '優勝美地・谷地',        country: '🇺🇸', type: '綠地', ll: [37.7456, -119.5936], bearing: 85, mix: { green: 0.8, bare: 0.15, water: 0.05 } },

  // ---- 裸露地單一(≥80%)----
  { id: 'giza',       name: '開羅・吉薩金字塔群',     country: '🇪🇬', type: '裸露地', ll: [29.9773, 31.1325],  bearing: 210, mix: { bare: 0.85, urban: 0.15 } },
  { id: 'uluru',      name: '澳洲・烏魯魯巨岩',       country: '🇦🇺', type: '裸露地', ll: [-25.3444, 131.0369], bearing: 80, mix: { bare: 0.95, green: 0.05 } },
  { id: 'atacama',    name: '智利・阿塔卡馬月亮谷',   country: '🇨🇱', type: '裸露地', ll: [-22.9087, -68.3053], bearing: 350, mix: { bare: 1 } },
  { id: 'hehuanshan', name: '合歡山・箭竹草原',       country: '🇹🇼', type: '裸露地', ll: [24.1408, 121.2716], bearing: 25, mix: { bare: 0.8, green: 0.2 } },

  // ---- 水體 / 濕地為主 ----
  { id: 'venice',     name: '威尼斯・潟湖水都',       country: '🇮🇹', type: '水體', ll: [45.4408, 12.3155],  bearing: 300, mix: { water: 0.45, urban: 0.4, wet: 0.15 } },
  { id: 'iguazu',     name: '伊瓜蘇大瀑布',           country: '🇦🇷', type: '水體', ll: [-25.6953, -54.4367], bearing: 250, mix: { water: 0.4, green: 0.5, wet: 0.1 } },
  { id: 'tamsui',     name: '淡水河口・紅樹林濕地',   country: '🇹🇼', type: '濕地', ll: [25.1550, 121.4590], bearing: 140, mix: { wet: 0.5, water: 0.3, green: 0.2 } },
  { id: 'okavango',   name: '波札那・奧卡萬戈三角洲', country: '🇧🇼', type: '濕地', ll: [-19.2800, 22.9000], bearing: 45,  mix: { wet: 0.6, water: 0.25, green: 0.15 } },

  // ---- 混合型 ----
  { id: 'rio',        name: '里約・基督山海岸',       country: '🇧🇷', type: '混合', ll: [-22.9519, -43.2105], bearing: 245, mix: { urban: 0.4, green: 0.35, water: 0.25 } },
  { id: 'sydney',     name: '雪梨・歌劇院港灣',       country: '🇦🇺', type: '混合', ll: [-33.8568, 151.2153], bearing: 265, mix: { urban: 0.5, water: 0.35, green: 0.15 } },
  { id: 'london',     name: '倫敦・泰晤士河畔',       country: '🇬🇧', type: '混合', ll: [51.5007, -0.1246],  bearing: 85,  mix: { urban: 0.6, water: 0.2, green: 0.2 } },
  { id: 'kyoto',      name: '京都・嵐山竹林寺町',     country: '🇯🇵', type: '混合', ll: [35.0094, 135.6722], bearing: 90,  mix: { green: 0.5, urban: 0.35, water: 0.15 } },
];

// ---- 預先計算場地設定(確定性幾何,零網路,即選即用)----
const R_EARTH = 6371000;

function destPoint([lat, lng], bearingDeg, d) {
  const br = bearingDeg * Math.PI / 180;
  return [
    lat + d * Math.cos(br) / R_EARTH * 180 / Math.PI,
    lng + d * Math.sin(br) / (R_EARTH * Math.cos(lat * Math.PI / 180)) * 180 / Math.PI,
  ];
}

// ---- 決定性亂數(與 biomes.js 同款 mulberry32)----
// 種子取自端點座標 + 線別:同一組 (a,b,side) 永遠生成同一條兵線,
// 預設場地維持「預先算好、即選即用」的可重現性(最愛/重連皆一致)。
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 合成兵線(預設場地 / OSRM 離線備援;side: -1/0/+1 = 下/中/上)。
 * Diablo DRLG 思想:不再是一眼看穿的單一貝茲弧,而是「側移主脊 + 交錯側擺
 * via 點」再 Chaikin 平滑的戰術折線 — 保證非直線、有真實轉角
 * (轉角 = 伺服器障礙/防空/地雷的伏擊錨點),端點精確落在兩堡。
 * 三條線共用同一組交錯相位 → 同進同退,維持兵線分離度。
 */
export function synthLane(a, b, side) {
  const cosLat = Math.cos(a[0] * Math.PI / 180);
  const vx = (b[1] - a[1]) * Math.PI / 180 * R_EARTH * cosLat;
  const vz = (b[0] - a[0]) * Math.PI / 180 * R_EARTH;
  const d = Math.hypot(vx, vz) || 1;
  const px = -vz / d, pz = vx / d;                       // 垂直單位向量(公尺系)
  // 種子不含 side:全部兵線共用同一組側擺相位(同進同退),
  // 線間距離恆為主脊間距(0.3×D×sin),側擺不會互相吃掉分離度
  const rnd = mulberry32(
    (Math.round(a[0] * 1e4) * 31 + Math.round(a[1] * 1e4) * 17
     + Math.round(b[0] * 1e4) * 7 + Math.round(b[1] * 1e4) * 3) >>> 0,
  );
  const latOf = (t, lateral) => [
    a[0] + (b[0] - a[0]) * t + lateral * pz / R_EARTH * 180 / Math.PI,
    a[1] + (b[1] - a[1]) * t + lateral * px / (R_EARTH * cosLat) * 180 / Math.PI,
  ];
  // via 間距固定 ~400m 遊戲公尺、側擺振幅與間距成比例:轉角銳度跨地圖尺寸一致,
  // 平滑後仍保留 ≥ TACTICS.TURN_MIN_DEG 的真實轉角(障礙/地雷的伏擊錨點)。
  // d 是「真實」距離,除以 REAL_SCALE 換算成遊戲公尺以固定遊戲空間的轉角密度。
  const N = Math.max(3, Math.round(d / (400 * MAPGEO.REAL_SCALE)));
  const spacing = d / (N + 1);
  const ctrl = [[...a]];
  for (let i = 1; i <= N; i++) {
    const t = i / (N + 1);
    // 主脊:側翼線的固定側移(sin 拱形,端點歸零);交錯側擺製造轉角
    const spine = d * MAPGEO.LANE_OFFSET_FRAC * side * Math.sin(Math.PI * t);
    const wiggle = (i % 2 ? 1 : -1) * spacing * (0.32 + rnd() * 0.16);
    ctrl.push(latOf(t, spine + wiggle));
  }
  ctrl.push([...b]);
  // Chaikin 平滑 ×1:去掉尖刺但保留戰術轉角;端點不動
  const pts = [ctrl[0]];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const [x1, y1] = ctrl[i], [x2, y2] = ctrl[i + 1];
    pts.push([x1 * 0.75 + x2 * 0.25, y1 * 0.75 + y2 * 0.25]);
    pts.push([x1 * 0.25 + x2 * 0.75, y1 * 0.25 + y2 * 0.75]);
  }
  pts.push(ctrl[ctrl.length - 1]);
  return pts;
}

/**
 * 由場地錨點 + 方位角直接產出完整 battleConfig(免掃描、離線可用)。
 * 幾何與 mapSelect 相同:兩堡距離 1600m × L,地圖邊長由距離反推。
 */
export function venueConfig(venue, teamSize, sizeKey = 'medium') {
  const L = lanesFor(teamSize);
  const D = targetDistFor(L, sizeKey);          // 遊戲世界距離
  const realD = D * MAPGEO.REAL_SCALE;          // 真實地理距離(縮小 → 地形/道路更密)
  const A = [...venue.ll];
  const B = destPoint(A, venue.bearing ?? 0, realD);
  const sides = L === 1 ? [0] : L === 2 ? [1, -1] : [1, 0, -1];
  const lanes = sides.map((s) => synthLane(A, B, s));
  const sizeM = D / (MAPGEO.BASE_DIST_FRAC * Math.SQRT2);   // 遊戲世界邊長
  return {
    center: { lat: (A[0] + B[0]) / 2, lng: (A[1] + B[1]) / 2 },
    bases: { SWARM: A, STEEL: B },
    lanes,
    laneCount: L,
    sizeM, diagM: sizeM * Math.SQRT2, distM: D,   // 全為遊戲世界公尺
    sizeKey, geoScaleVer: MAPGEO.GEO_SCALE_VER,
    maxOverlap: 0.06,            // 三線同相位側擺、主脊間距 0.3×D,僅端點交會,遠低於 20% 門檻
    synthetic: true, precomputed: true,
    venue: { id: venue.id, name: venue.name, mix: venue.mix },
    placeName: venue.name,
  };
}

/**
 * 尺度追溯:把舊尺度(geoScaleVer 不符)的最愛 cfg 遷移到目前尺度。
 *  - 已知預設場地 → 直接以新尺度 venueConfig 重算(最精確)。
 *  - 自訂地圖 → 真實座標朝中心收縮 REAL_SCALE:遊戲世界幾何不變(仍是同一張圖),
 *    但與新的 llToWorld/battleBBox 地形取樣一致,不致基座落在地形外。
 */
export function migrateFavCfg(fav) {
  const cfg = fav.cfg;
  if (!cfg) return cfg;
  if (cfg.geoScaleVer === MAPGEO.GEO_SCALE_VER) return cfg;
  if (cfg.venue?.id) {
    const v = VENUES.find((x) => x.id === cfg.venue.id);
    if (v) return venueConfig(v, fav.teamSize, cfg.sizeKey || 'medium');
  }
  const c = cfg.center, s = MAPGEO.REAL_SCALE;
  const sc = ([lat, lng]) => [c.lat + (lat - c.lat) * s, c.lng + (lng - c.lng) * s];
  return {
    ...cfg,
    bases: { SWARM: sc(cfg.bases.SWARM), STEEL: sc(cfg.bases.STEEL) },
    lanes: cfg.lanes.map((lane) => lane.map(sc)),
    sizeKey: cfg.sizeKey || 'medium',
    geoScaleVer: MAPGEO.GEO_SCALE_VER,
  };
}

// ---- 我的最愛(localStorage,存完整 battleConfig)----
const FAV_KEY = 'svs_favorites';

export function loadFavorites() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch { return []; }
}

/** 存一筆最愛:{ name, teamSize, cfg };同名覆蓋,最多 12 筆 */
export function saveFavorite(name, teamSize, cfg) {
  const favs = loadFavorites().filter((f) => f.name !== name);
  favs.unshift({ name, teamSize, cfg, savedAt: Date.now() });
  localStorage.setItem(FAV_KEY, JSON.stringify(favs.slice(0, 12)));
  return loadFavorites();
}

export function removeFavorite(name) {
  localStorage.setItem(FAV_KEY, JSON.stringify(loadFavorites().filter((f) => f.name !== name)));
  return loadFavorites();
}
