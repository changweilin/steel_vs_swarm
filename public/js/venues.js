// ============ 預設場地(世界地標 / 風景區)+ 我的最愛 ============
// 每個場地 = 錨點座標 + 地貌組成 mix(供 biomes.js 分類加權)
//   + bearing(對點方位角,朝內陸/地形有趣的方向):
//   單一型:主要地貌 ≥ 80%;混合型:多種地貌各佔一定比例。
// mix 鍵對應 data.js 的 BIOMES:green 綠地 / bare 裸露地 / urban 市區 / water 水體 / wet 濕地。
// 預設場地的路線/圖資「預先算好」:venueConfig() 以確定性幾何直接產出
// 完整 battleConfig(合成兵線),不需要 OSRM 掃描即可開房;
// 想用真實道路兵線,仍可在地圖上手動點選錨點走掃描流程。
// 「我的最愛」存整份 battleConfig(含兵線),選了即用、不必重新搜尋。
import { MAPGEO, lanesFor, targetDistFor, laneSeparationAudit } from './data.js';
import { VENUE_LANES } from './venueLanes.js';

/**
 * 1v1(L1)兵線立體場景標記(2026-07-28 使用者需求:七種場景各要有一張預設地圖可測)。
 * 鍵 = 場景代號,值 = 中文短名(**MUST NOT 進鈕面**,只走 title 提示 —— 見 A20 鈕面不加補述)。
 * 標記 MUST 由 `node tools/audit_lane_scenarios.mjs` 實測產生/複驗,不得手寫臆測:
 * 該工具吃與執行期同源的兵線/路網/高程,標記與實測不符即紅字。
 */
export const SCEN_LABEL = {
  // 隧道與地下道是兩種東西:隧道 = 道路平坦鑽進山體(深度來自山);
  // 地下道 = 平地上路面下沉再上來(深度來自挖)。現行引擎只生成前者,
  // 故 underpass 沒有任何場地會標到它(稽核列為已知缺口,見 tools/audit_lane_scenarios.mjs)。
  tunnel: '山體隧道',
  underpass: '地下道',
  bridge: '高架橋',
  gallery: '明隧道',
  crossing: '平交道',
  underBridge: '穿越橋下',
  overTunnel: '穿越洞頂',
  highGround: '側翼高地',
};

/** 場地提示文字(地貌 + 1v1 兵線場景):大廳與開房兩處場地清單共用同一份,MUST NOT 各寫一套 */
export function venueTip(v) {
  const BIO = { green: '綠地', bare: '裸露', urban: '市區', water: '水體', wet: '濕地' };
  const bio = `地貌:${Object.entries(v.mix).map(([k, f]) => `${BIO[k]} ${Math.round(f * 100)}%`).join('・')}`;
  const sc = (v.scen || []).map((k) => SCEN_LABEL[k]).filter(Boolean);
  return sc.length ? `${bio}\n1v1 兵線:${sc.join('・')}` : bio;
}

// ll = 兵線起點(SWARM 主堡)。**必須是有導航路網的道路節點**:兵線一律取自現實道路
// (見 venueLanes.js),路網不足的自然景點一律把錨點移到鄰近的聚落/園區道路,
// 地貌 mix 不變(視覺仍是森林/沙漠/濕地)。改 ll MUST 重跑 scratchpad/bake3.mjs。
// bearing 只在該場地某個 L 沒有預算資料、退回 synthLane 時才用得到。
// scen = 該場地 **1v1 兵線**實測走得到的立體場景(見 SCEN_LABEL;由場景稽核工具產生)。
export const VENUES = [
  // ---- 市區單一(≥80%)----
  { id: 'taipei101',  name: '台北・101 信義計畫區',   country: '🇹🇼', type: '市區', ll: [25.034009, 121.563871], bearing: 190, mix: { urban: 0.85, green: 0.1, water: 0.05 }, scen: ['underBridge', 'highGround'] },
  { id: 'shibuya',    name: '東京・澀谷十字路口',     country: '🇯🇵', type: '市區', ll: [35.659538, 139.700442], bearing: 280, mix: { urban: 0.9, green: 0.1 }, scen: ['underBridge', 'overTunnel'] },
  { id: 'manhattan',  name: '紐約・曼哈頓中城',       country: '🇺🇸', type: '市區', ll: [40.754938, -73.984047], bearing: 30,  mix: { urban: 0.85, green: 0.15 } },
  { id: 'paris',      name: '巴黎・艾菲爾鐵塔',       country: '🇫🇷', type: '市區', ll: [48.859026, 2.293461],   bearing: 95,  mix: { urban: 0.8, green: 0.15, water: 0.05 } },
  { id: 'seoul',      name: '首爾・江南',             country: '🇰🇷', type: '市區', ll: [37.497891, 127.027621], bearing: 150, mix: { urban: 0.9, green: 0.1 } },

  // ---- 綠地單一(≥80%)----
  { id: 'yangmingshan', name: '陽明山國家公園',       country: '🇹🇼', type: '綠地', ll: [25.118243, 121.530123], bearing: 100, mix: { green: 0.85, bare: 0.15 }, scen: ['highGround'] },   // 天母(南麓路網)
  { id: 'aokigahara',  name: '富士山麓・青木原樹海',  country: '🇯🇵', type: '綠地', ll: [35.497619, 138.754966], bearing: 260, mix: { green: 0.9, bare: 0.1 } },      // 河口湖町
  { id: 'blackforest', name: '德國・黑森林',          country: '🇩🇪', type: '綠地', ll: [48.466999, 8.411523],   bearing: 10,  mix: { green: 0.9, bare: 0.1 }, scen: ['crossing'] },      // Freudenstadt
  { id: 'yosemite',    name: '優勝美地・谷地',        country: '🇺🇸', type: '綠地', ll: [37.748470, -119.588441], bearing: 85, mix: { green: 0.8, bare: 0.15, water: 0.05 } },   // 谷底環道(L3 無解 → synth)

  // ---- 裸露地單一(≥80%)----
  { id: 'giza',       name: '開羅・吉薩金字塔群',     country: '🇪🇬', type: '裸露地', ll: [29.986967, 31.142024],  bearing: 210, mix: { bare: 0.85, urban: 0.15 }, scen: ['underBridge', 'highGround'] },   // Nazlet El-Semman
  { id: 'uluru',      name: '澳洲・烏魯魯巨岩',       country: '🇦🇺', type: '裸露地', ll: [-25.240662, 130.989010], bearing: 80, mix: { bare: 0.95, green: 0.05 } },   // Yulara(L3 無解 → synth)
  { id: 'phoenix',    name: '鳳凰城・索諾拉沙漠',     country: '🇺🇸', type: '裸露地', ll: [33.495000, -112.170000], bearing: 30, mix: { bare: 0.7, urban: 0.3 } },      // 西鳳凰城沙漠格柵
  { id: 'hehuanshan', name: '合歡山・箭竹草原',       country: '🇹🇼', type: '裸露地', ll: [23.965067, 120.967128], bearing: 25, mix: { bare: 0.8, green: 0.2 } },      // 埔里鎮

  // ---- 水體 / 濕地為主 ----
  { id: 'venice',     name: '威尼斯・潟湖水都',       country: '🇮🇹', type: '水體', ll: [45.484986, 12.234699],  bearing: 300, mix: { water: 0.45, urban: 0.4, wet: 0.15 } },   // Mestre(本島無車道)
  { id: 'iguazu',     name: '伊瓜蘇大瀑布',           country: '🇦🇷', type: '水體', ll: [-25.598749, -54.573988], bearing: 250, mix: { water: 0.4, green: 0.5, wet: 0.1 } },    // Puerto Iguazú
  { id: 'tamsui',     name: '淡水河口・紅樹林濕地',   country: '🇹🇼', type: '濕地', ll: [25.168155, 121.444729], bearing: 140, mix: { wet: 0.5, water: 0.3, green: 0.2 } },     // 淡水市區(L3 無解 → synth)
  { id: 'okavango',   name: '波札那・奧卡萬戈三角洲', country: '🇧🇼', type: '濕地', ll: [-19.983022, 23.416720], bearing: 45,  mix: { wet: 0.6, water: 0.25, green: 0.15 } },   // Maun

  // ---- 混合型 ----
  { id: 'rio',        name: '里約・基督山海岸',       country: '🇧🇷', type: '混合', ll: [-22.969255, -43.184768], bearing: 245, mix: { urban: 0.4, green: 0.35, water: 0.25 }, scen: ['highGround'] },
  { id: 'jinlong',    name: '台北・內湖金龍隧道',     country: '🇹🇼', type: '混合', ll: [25.083800, 121.584600], bearing: 56,  mix: { urban: 0.6, green: 0.35, water: 0.05 }, scen: ['tunnel', 'gallery', 'highGround'] },   // 金龍路 ↔ 金湖路,兵線穿金龍隧道(山體隧道手動測試場)
  // ② 地下道的測試場地(2026-07-28):市民大道沿線車行地下道群 —— L1 bbox 內圖資有 8 條
  // tunnel way,是掃到最密的一區。**注意**:平地地下道現行引擎不生成(路面沉不下去,
  // 見 docs/lane_scenarios.md),故不標 scen;引擎支援下沉剖面後這張圖即成立。
  { id: 'civicblvd',  name: '台北・市民大道',         country: '🇹🇼', type: '市區', ll: [25.047000, 121.518000], bearing: 80,  mix: { urban: 0.9, green: 0.1 } },
  // ④ 明隧道的指定測試場地(2026-07-29 廣域探測選定):台8線燕子口—錐麓段,三段短隧道
  // 幾乎整條是明隧道(側向是立霧溪峽谷,土牆藏不住結構),彼此相距 ~400m,L1 兵線連穿多座。
  // scen 標記待烘焙 + 場景掃描實測後補(標記 MUST 由實測產生)。
  { id: 'taroko',     name: '太魯閣・燕子口',         country: '🇹🇼', type: '混合', ll: [24.171200, 121.556000], bearing: 262, mix: { green: 0.5, bare: 0.4, water: 0.1 } },
  { id: 'barcelona',  name: '巴塞隆納・地中海濱',     country: '🇪🇸', type: '混合', ll: [41.390000, 2.162000],   bearing: 135, mix: { urban: 0.55, water: 0.25, green: 0.2 } },   // Eixample 格柵
  { id: 'london',     name: '倫敦・泰晤士河畔',       country: '🇬🇧', type: '混合', ll: [51.500641, -0.124862],  bearing: 85,  mix: { urban: 0.6, water: 0.2, green: 0.2 }, scen: ['underBridge'] },
  { id: 'kyoto',      name: '京都・嵐山竹林寺町',     country: '🇯🇵', type: '混合', ll: [35.010032, 135.710095], bearing: 90,  mix: { green: 0.5, urban: 0.35, water: 0.15 } },   // 右京區街廓
];

// ---- 預先計算場地設定(確定性幾何,零網路,即選即用)----
const R_EARTH = 6371000;

/** 兩點真實距離 (m);equirectangular,1km 內誤差可忽略 */
function distMeters(a, b) {
  const x = (b[1] - a[1]) * Math.PI / 180 * R_EARTH * Math.cos(a[0] * Math.PI / 180);
  const z = (b[0] - a[0]) * Math.PI / 180 * R_EARTH;
  return Math.hypot(x, z);
}

// baked 兵線(lat/lng)是否合「互不接觸/交叉」規則:轉遊戲公尺跑 data.js 唯一結算縫。
// 非合規(尺度版本更迭殘留 / 手改)視同無 baked → venueConfig 退回 synthLane(server 亦會拒非合規)。
const SC_GAME = 1 / MAPGEO.REAL_SCALE;
function bakedLanesSeparated(entry) {
  const o = entry.bases[0], cosO = Math.cos(o[0] * Math.PI / 180);
  const game = entry.lanes.map((l) => l.map(([la, ln]) => [
    (ln - o[1]) * Math.PI / 180 * R_EARTH * cosO * SC_GAME,
    (la - o[0]) * Math.PI / 180 * R_EARTH * SC_GAME,
  ]));
  return laneSeparationAudit(game).ok;
}

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
 * 由場地產出完整 battleConfig(免掃描、離線可用)。
 * 兵線一律取 venueLanes.js 預算好的**真實道路路線**(Overpass 路網 + 邊不相交最短路徑),
 * 每個頂點都是 OSM 道路節點 ⇒ NPC 引導路線與現實導航路線完全相符;
 * 主堡座標即該路線兩端的道路節點,兵線端點因此精確落在主堡上。
 *
 * 沒有預算資料的場地(路網不足)才退回 synthLane 合成弧 —— 這是離線/無圖資的最後防線,
 * MUST NOT 移除(見 CLAUDE.md「外部 API 皆會限流或掛掉」)。
 * 幾何:真實邊長 0.3+0.1L km,兩堡距離 = 邊長 × 0.85 × √2。
 */
export function venueConfig(venue, teamSize) {
  const L = lanesFor(teamSize);
  const D = targetDistFor(L);                   // 遊戲世界距離
  const realD = D * MAPGEO.REAL_SCALE;          // 真實地理距離(縮小 → 地形/道路更密)
  const sizeM = D / (MAPGEO.BASE_DIST_FRAC * Math.SQRT2);   // 遊戲世界邊長

  const bakedRaw = VENUE_LANES[venue.id]?.[L];
  const baked = bakedRaw && bakedLanesSeparated(bakedRaw) ? bakedRaw : null;
  let A, B, lanes, maxOverlap, synthetic;
  if (baked) {
    [A, B] = baked.bases.map((p) => [...p]);
    lanes = baked.lanes.map((l) => l.map((p) => [...p]));
    maxOverlap = baked.maxOverlap;
    synthetic = false;
  } else {
    A = [...venue.ll];
    B = destPoint(A, venue.bearing ?? 0, realD);
    const sides = L === 1 ? [0] : L === 2 ? [1, -1] : [1, 0, -1];
    lanes = sides.map((s) => synthLane(A, B, s));
    maxOverlap = 0.06;           // 三線同相位側擺、主脊間距 0.3×D,僅端點交會
    synthetic = true;
  }
  // distM 用實際兩堡距離(預算路線的端點吸附到道路節點,與理想值有數十公尺差)
  const distGame = distMeters(A, B) / MAPGEO.REAL_SCALE;
  return {
    center: { lat: (A[0] + B[0]) / 2, lng: (A[1] + B[1]) / 2 },
    bases: { SWARM: A, STEEL: B },
    lanes,
    laneCount: L,
    sizeM, diagM: sizeM * Math.SQRT2, distM: distGame,   // 全為遊戲世界公尺
    geoScaleVer: MAPGEO.GEO_SCALE_VER,
    maxOverlap,
    synthetic, precomputed: true,
    venue: { id: venue.id, name: venue.name, mix: venue.mix },
    placeName: venue.name,
  };
}

/**
 * 尺度追溯:把舊尺度(geoScaleVer 不符)的最愛 cfg 遷移到目前尺度。
 *  - 已知預設場地 → 直接以新尺度 venueConfig 重算(最精確,且拿得到新的真實道路兵線)。
 *  - 自訂地圖 → 真實座標朝中心等比收縮,使兩堡真實距離對上新尺度的 realDistFor(L);
 *    遊戲世界幾何(邊長/對角/兩堡距離比例)因此完全符合新公式。
 *    收縮比由「新舊實際距離」推導,**MUST NOT** 寫死倍率:ver3→ver4 動的是 REAL_SCALE,
 *    ver4→ver5 動的是邊長公式,寫死 0.5 只對前者成立。
 *    代價:收縮後的自訂兵線不再精確貼合現實道路(預設場地不受影響,它們是重算的)。
 */
export function migrateFavCfg(fav) {
  const cfg = fav.cfg;
  if (!cfg) return cfg;
  if (cfg.geoScaleVer === MAPGEO.GEO_SCALE_VER) return cfg;
  if (cfg.venue?.id) {
    const v = VENUES.find((x) => x.id === cfg.venue.id);
    if (v) return venueConfig(v, fav.teamSize);
  }
  const L = lanesFor(fav.teamSize);
  const D = targetDistFor(L);
  const realNow = D * MAPGEO.REAL_SCALE;
  const realOld = distMeters(cfg.bases.SWARM, cfg.bases.STEEL);
  const s = realOld > 1 ? realNow / realOld : 1;
  const c = cfg.center;
  const sc = ([lat, lng]) => [c.lat + (lat - c.lat) * s, c.lng + (lng - c.lng) * s];
  const sizeM = D / (MAPGEO.BASE_DIST_FRAC * Math.SQRT2);
  return {
    ...cfg,
    bases: { SWARM: sc(cfg.bases.SWARM), STEEL: sc(cfg.bases.STEEL) },
    lanes: cfg.lanes.map((lane) => lane.map(sc)),
    laneCount: L,
    sizeM, diagM: sizeM * Math.SQRT2, distM: D,
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
