// ============ 預設場地(世界地標 / 風景區)+ 我的最愛 ============
// 每個場地 = 錨點座標 + 地貌組成 mix(供 biomes.js 分類加權)
//   + bearing(對點方位角,朝內陸/地形有趣的方向):
//   單一型:主要地貌 ≥ 80%;混合型:多種地貌各佔一定比例。
// mix 鍵對應 data.js 的 BIOMES:green 綠地 / bare 裸露地 / urban 市區 / water 水體 / wet 濕地。
// 預設場地的路線/圖資「預先算好」:venueConfig() 以確定性幾何直接產出
// 完整 battleConfig(合成兵線),不需要 OSRM 掃描即可開房;
// 想用真實道路兵線,仍可在地圖上手動點選錨點走掃描流程。
// 「我的最愛」存整份 battleConfig(含兵線),選了即用、不必重新搜尋。
import { MAPGEO, lanesFor, laneCountFor, mapPlan, targetDistFor, laneSeparationAudit, laneTacticsXZ, altTier, laneSubsetFor, geoLanesFor } from './data.js';
import { VENUE_LANES } from './venueLanes.js';
import { VENUE_GRID } from './venueGrid.js';

/**
 * 1v1(L1)兵線立體場景標記(2026-07-28 使用者需求:九種場景各要有一張預設地圖可測)。
 * 鍵 = 場景代號,值 = 中文短名(**MUST NOT 進鈕面**,只走懸浮提示 —— 見 A20 鈕面不加補述)。
 * 標記 MUST 由 `node tools/audit_lane_scenarios.mjs` 實測產生/複驗,不得手寫臆測:
 * 該工具吃與執行期同源的兵線/路網/高程,標記與實測不符即紅字。
 */
export const SCEN_LABEL = {
  // 隧道與地下道是兩種東西:隧道 = 道路平坦鑽進山體(深度來自山);
  // 地下道 = 平地上路面下沉再上來(深度來自挖,2026-07-28 起引擎以 underpassPlan 生成)。
  // 明隧道(gallery)是隧道的側向變體:覆蓋段的**一側在地形之外**(tunnelWallProfile 判 open),
  // 該側改成外露頂板 + 落地矮牆 + 連續柱列 —— 貫穿地形(兩側都在地形內)的一律仍是隧道。
  tunnel: '山體隧道',
  underpass: '地下道',
  // 高架橋分兩種(2026-08-02 使用者定案「地下道 / 陸上高架橋 / 水上高架橋」各要有預設地圖):
  // 橋下是陸地 vs 橋下是水域,打起來完全不同 —— 前者橋墩之間可穿行、掉下去照樣能打,
  // 後者橋面是唯一通路、掉下去進水(WATER 減速/滅頂)。判定縫是稽核的 `spansWater()`,
  // MUST NOT 由場地名稱或 mix 的 water 比例臆測。
  bridge: '陸上高架橋',
  waterBridge: '水上高架橋',
  gallery: '明隧道',
  crossing: '平交道',
  underBridge: '穿越橋下',
  overTunnel: '穿越洞頂',
  highGround: '側翼高地',
};

/**
 * 地形起伏分級(2026-08-02 使用者需求「選擇地圖時追加地形說明」)。
 * 尺規只有一把 = `altTier()`(一座砲塔高,也是 ⑧ 側翼高地與高度差加成的門檻)⇒
 * 分級門檻一律寫成它的倍數,**MUST NOT 手寫公尺數**(砲塔一改高度,分級自己跟著走)。
 * 消費端 MUST 走 `reliefTier()`,MUST NOT 自己比大小。
 */
export const RELIEF_TIERS = [
  { f: 1, name: '平坦' },    // 側翼抬不到一座砲塔高 = 沒有可佔領的高地
  { f: 3, name: '起伏' },
  { f: 8, name: '高地' },
  { f: Infinity, name: '峻嶺' },
];

/** 側翼峰值(遊戲高度框公尺)→ 起伏分級;沒有實測值回 null(寧缺勿錯,原則 6) */
export function reliefTier(m) {
  if (!Number.isFinite(m)) return null;
  const T = altTier();
  return RELIEF_TIERS.find((t) => m < t.f * T) || RELIEF_TIERS[RELIEF_TIERS.length - 1];
}

/**
 * 場地路線摘要:**全部由 `venueConfig()` + `data.js laneTacticsXZ()` 推導**,
 * MUST NOT 在 venues.js 手寫任何長度/彎曲度(那是烘焙兵線的性質,手寫必然與重烤後分家)。
 * 彎曲度/轉角吃的是與 bake、mapSelect 選路評分同一支戰術幾何縫。
 */
export function venueRoute(v, teamSize) {
  const cfg = venueConfig(v, teamSize);
  const o = cfg.bases.SWARM;
  const st = cfg.lanes.map((l) => laneTacticsXZ(laneToGameXZ(l, o)));
  const avg = (f) => (st.length ? st.reduce((s, t) => s + f(t), 0) / st.length : 0);
  return {
    real: !cfg.synthetic,                       // 真實道路兵線 vs 離線合成弧
    laneCount: cfg.laneCount,
    distM: cfg.distM,                           // 兩堡距離(遊戲公尺)
    lenM: avg((t) => t.total),                  // 單線平均長度(遊戲公尺)
    sinuosity: avg((t) => t.sinuosity),
    turns: Math.round(avg((t) => t.turns.length)),
    scen: (v.scen || []).map((k) => SCEN_LABEL[k]).filter(Boolean),
  };
}

const BIO_NAME = { green: '綠地', bare: '裸露', urban: '市區', water: '水體', wet: '濕地' };

/** 地貌組成一行(路線/地形說明與舊提示共用同一份字典) */
const bioText = (mix) => Object.entries(mix)
  .map(([k, f]) => `${BIO_NAME[k]} ${Math.round(f * 100)}%`).join('・');

/**
 * 場地提示文字(2026-08-02 使用者需求「選擇地圖時,追加地圖路線、地形說明」)。
 * 兩行:**路線**(兵線來源/長度/彎曲度/轉角/途經的立體場景)+ **地形**(地貌組成/起伏)。
 * 大廳與開房兩處場地清單、選定後的狀態列共用同一份 —— MUST NOT 各寫一套。
 * 掛法走 `tip.js attachTip`,MUST NOT 退回 `title=`(觸控沒有 hover,原生 tooltip 永不出現)。
 */
export function venueTip(v, teamSize) {
  const r = venueRoute(v, teamSize);
  const route = `路線:${r.real ? '真實道路' : '離線合成'}兵線 ${r.laneCount} 條`
    + ` ・ 兩堡 ${(r.distM / 1000).toFixed(2)} km ・ 單線 ${Math.round(r.lenM)} m`
    + ` ・ 彎曲度 ${r.sinuosity.toFixed(2)} ・ 戰術轉角 ${r.turns} 個`
    + (r.scen.length ? `\n　　途經:${r.scen.join('・')}` : '');
  const tier = reliefTier(v.relief);
  const vdef = VARIANT_DEFS.find((d) => d.key === v.variant);
  const reqText = v.scenReq === 'tunnel' ? '需:地下道/隧道/明隧道'
    : v.scenReq === 'bridge' ? '需:高架橋' : null;
  const terrain = `地形:${v.type}${vdef ? `・${vdef.name}` : ''}${v.story ? '・劇情戰役' : ''} ・ ${bioText(v.mix)}`
    + (vdef && v.variant !== 'plain' ? ` ・ ${vdef.slope}` : '')
    + (tier ? ` ・ 起伏:${tier.name}(側翼峰值 +${Math.round(v.relief)} m)` : '')
    + (reqText && !(r.scen.length) ? ` ・ ${reqText}` : '');
  return `${route}\n${terrain}`;
}

/** 選定後狀態列用的單行版(同一份摘要,只是攤平成一行) */
export function venueBrief(v, teamSize) {
  return venueTip(v, teamSize).replace(/\n　　/g, ' ・ ').replace(/\n/g, ' ｜ ');
}

// ============ 預設地圖體系:3 主地形 × 6 變化 = 18(劇情戰役另計)============
// 主地形(base):市區 / 綠地 / 裸露地。變化(variant):
//   原貌:主地形 75% ・ 輕度多元:主 60% 其餘均分 + 坡度小變化 + 至少一條道路有地下道/隧道/明隧道
//   多元混合:主 40% 其餘均分 + 坡度中等變化 + 至少一條兵線有地下道/隧道/明隧道
//   起伏地形:主 60% + 坡度劇烈變化 + 至少一條兵線有地下道/隧道/明隧道
//   混合沼澤:主 40% + 沼澤(wet)40% + 至少一條兵線有高架橋
//   混合水域:主 40% + 水域(water)30% + 沼澤(wet)10% + 至少一條兵線有高架橋
// mix 一律由 mixFor() 推導,MUST NOT 手寫百分比(手寫的第二份比例遲早與定義分家)。
// scenReq = 該變化的結構需求(tunnel = 地下道/隧道/明隧道家族;bridge = 高架橋):
//   意向宣告,烘焙實測(scen)跟上後由稽核複驗;缺實測時 venueTip 照實顯示已有 scen,不臆測。
export const VENUE_BASES = ['市區', '綠地', '裸露地'];
export const VARIANT_DEFS = [
  { key: 'plain',  name: '原貌',     mainF: 0.75, rough: 0, scenReq: null,     slope: '—' },
  { key: 'light',  name: '輕度多元', mainF: 0.60, rough: 1, scenReq: 'tunnel', slope: '坡度小變化' },
  { key: 'mixed',  name: '多元混合', mainF: 0.40, rough: 2, scenReq: 'tunnel', slope: '坡度中等變化' },
  { key: 'rugged', name: '起伏地形', mainF: 0.60, rough: 3, scenReq: 'tunnel', slope: '坡度劇烈變化' },
  { key: 'swamp',  name: '混合沼澤', mainF: 0.40, rough: 1, scenReq: 'bridge', slope: '坡度小變化' },
  { key: 'water',  name: '混合水域', mainF: 0.40, rough: 1, scenReq: 'bridge', slope: '坡度小變化' },
];
/** 變化 → 地形起伏放大倍率(乘在 TERRAIN.AMP 上;見 terrain.js)。推導不手寫。 */
export const variantAmpF = (key) => ({ plain: 0.4, light: 0.7, mixed: 1.0, rugged: 1.6, swamp: 0.8, water: 0.8 }[key] ?? 1);
const BASE_KEY = { '市區': 'urban', '綠地': 'green', '裸露地': 'bare' };
/**
 * 主地形 + 變化 → 地貌 mix(唯一縫)。其餘比例均分,沼澤/水域變化的 wet/water 先锁定,
 * 剩餘再均分;四捨五入尾差補在第一個剩餘鍵 ⇒ 總和恆為 1。
 */
export function mixFor(base, variant) {
  const main = BASE_KEY[base];
  const mix = { urban: 0, green: 0, bare: 0, water: 0, wet: 0 };
  const rnd4 = (v) => Math.round(v * 1e4) / 1e4;
  if (variant === 'swamp') {
    mix[main] = 0.4; mix.wet = 0.4;
    const rest = Object.keys(mix).filter((k) => !mix[k]);
    rest.forEach((k, i) => { mix[k] = rnd4(i < rest.length - 1 ? 0.2 / rest.length : 0.2 - (0.2 / rest.length) * (rest.length - 1)); });
    mix[rest[0]] = rnd4(mix[rest[0]] + (1 - Object.values(mix).reduce((s, v) => s + v, 0)));
    return mix;
  }
  if (variant === 'water') {
    mix[main] = 0.4; mix.water = 0.3; mix.wet = 0.1;
    const rest = Object.keys(mix).filter((k) => !mix[k]);
    rest.forEach((k) => { mix[k] = 0.1; });
    return mix;
  }
  const def = VARIANT_DEFS.find((d) => d.key === variant) || VARIANT_DEFS[0];
  mix[main] = def.mainF;
  const rest = Object.keys(mix).filter((k) => k !== main);
  rest.forEach((k, i) => { mix[k] = rnd4(i < rest.length - 1 ? (1 - def.mainF) / rest.length : 1 - def.mainF - ((1 - def.mainF) / rest.length) * (rest.length - 1)); });
  mix[rest[0]] = rnd4(mix[rest[0]] + (1 - Object.values(mix).reduce((s, v) => s + v, 0)));
  return mix;
}
/** 預設 18 張是否含劇情戰役地圖(恆否):劇情戰役走 story:true 分類,不佔 3×6 名額。 */
export const PRESET_VENUES = (list) => (list || VENUES).filter((v) => !v.story);
export const STORY_VENUES = (list) => (list || VENUES).filter((v) => v.story);

// ll = 兵線起點(SWARM 主堡)。**必須是有導航路網的道路節點**:兵線一律取自現實道路
// (見 venueLanes.js),路網不足的自然景點一律把錨點移到鄰近的聚落/園區道路,
// 地貌 mix 不變(視覺仍是森林/沙漠/濕地)。改 ll MUST 重跑 scratchpad/bake3.mjs。
// bearing 只在該場地某個 L 沒有預算資料、退回 synthLane 時才用得到。
// scen = 該場地 **1v1 兵線**實測走得到的立體場景(見 SCEN_LABEL;由場景稽核工具產生)。
// relief = 同一支稽核實測的**側翼峰值**(遊戲高度框公尺,扣掉橋/洞段),供 reliefTier() 分級;
//          與 scen 同樣 MUST 由實測產生,漏標/多標/對不上實測一律紅字。
// base/variant/ampF/scenReq = 3×6 體系分類(見上方);story = 劇情戰役地圖(另計分類,不佔名額)。
// type 恆 = base(鈕面顏色與分組錨點),mix 由 mixFor 推導。
const V = (o) => ({ scen: [], relief: 2, ...o, mix: mixFor(o.base, o.variant), ampF: variantAmpF(o.variant), scenReq: (VARIANT_DEFS.find((d) => d.key === o.variant) || {}).scenReq ?? null });
export const VENUES = [
  // ---- 市區 ×6----
  V({ id: 'berlin',    name: '柏林・普倫茨勞山',     country: '🇩🇪', base: '市區', variant: 'plain',  type: '市區', ll: [52.538038, 13.415268], bearing: 70, scen: [], relief: 2 }),
  V({ id: 'madrid',    name: '馬德里・卡斯提亞大道', country: '🇪🇸', base: '市區', variant: 'light',  type: '市區', ll: [40.437794, -3.685632], bearing: 245, scen: ['overTunnel'], relief: 11 }),
  V({ id: 'roppongi',  name: '東京・六本木',         country: '🇯🇵', base: '市區', variant: 'mixed',  type: '市區', ll: [35.661630, 139.728510], bearing: 200, relief: 13 }),
  V({ id: 'seoul',     name: '首爾・江南',           country: '🇰🇷', base: '市區', variant: 'rugged', type: '市區', ll: [37.497891, 127.027621], bearing: 150, relief: 22 }),
  V({ id: 'neworleans', name: '紐奧良・龐恰特雷恩湖濱', country: '🇺🇸', base: '市區', variant: 'swamp', type: '市區', ll: [30.023000, -90.082000], bearing: 80, scen: ['bridge'], relief: 2 }),
  V({ id: 'rotterdam', name: '鹿特丹・伊拉斯謨大橋', country: '🇳🇱', base: '市區', variant: 'water',  type: '市區', ll: [51.909000, 4.486000],   bearing: 135, scen: ['bridge'], relief: 3 }),
  // ---- 綠地 ×6----
  V({ id: 'matamata',   name: '紐西蘭・哈比屯綠丘草原', country: '🇳🇿', base: '綠地', variant: 'plain',  type: '綠地', ll: [-37.872000, 175.683000], bearing: 260, relief: 12 }),
  V({ id: 'interlaken', name: '瑞士・因特拉肯山谷', country: '🇨🇭', base: '綠地', variant: 'light',  type: '綠地', ll: [46.686000, 7.863000], bearing: 100, scen: ['highGround'], relief: 25 }),
  V({ id: 'kyoto',        name: '京都・嵐山竹林寺町', country: '🇯🇵', base: '綠地', variant: 'mixed',  type: '綠地', ll: [35.010032, 135.710095], bearing: 90, relief: 8 }),
  V({ id: 'taroko',       name: '太魯閣・燕子口',     country: '🇹🇼', base: '綠地', variant: 'rugged', type: '綠地', ll: [24.171200, 121.556000], bearing: 262, scen: ['tunnel', 'underpass', 'gallery', 'highGround'], relief: 371 }),
  V({ id: 'mekong',       name: '越南・湄公河三角洲水鄉', country: '🇻🇳', base: '綠地', variant: 'swamp',  type: '綠地', ll: [10.355000, 106.350000], bearing: 140, scen: ['bridge'], relief: 2 }),
  V({ id: 'bergen',       name: '挪威・卑爾根峽灣',   country: '🇳🇴', base: '綠地', variant: 'water',  type: '綠地', ll: [60.400000, 5.225000], bearing: 250, scen: ['bridge'], relief: 35 }),
  // ---- 裸露地 ×6----
  V({ id: 'phoenix',    name: '鳳凰城・索諾拉沙漠', country: '🇺🇸', base: '裸露地', variant: 'plain',  type: '裸露地', ll: [33.495000, -112.170000], bearing: 30, relief: 2 }),
  V({ id: 'cappadocia', name: '土耳其・卡帕多奇亞岩原', country: '🇹🇷', base: '裸露地', variant: 'light',  type: '裸露地', ll: [38.643000, 34.829000], bearing: 25, scen: ['tunnel'], relief: 15 }),
  V({ id: 'uluru',      name: '澳洲・烏魯魯巨岩',   country: '🇦🇺', base: '裸露地', variant: 'mixed',  type: '裸露地', ll: [-25.240662, 130.989010], bearing: 80, relief: 13 }),
  V({ id: 'todra',      name: '摩洛哥・托德拉大峽谷', country: '🇲🇦', base: '裸露地', variant: 'rugged', type: '裸露地', ll: [31.550000, -5.600000], bearing: 56, scen: ['tunnel', 'highGround'], relief: 45 }),
  V({ id: 'dubai',      name: '杜拜・火烈鳥濕地保護區', country: '🇦🇪', base: '裸露地', variant: 'swamp', type: '裸露地', ll: [25.195000, 55.325000], bearing: 45, scen: ['bridge'], relief: 4 }),
  V({ id: 'walvisbay',  name: '納米比亞・鯨灣港沙漠海濱', country: '🇳🇦', base: '裸露地', variant: 'water',  type: '裸露地', ll: [-22.958000, 14.505000], bearing: 300, scen: ['bridge'], relief: 3 }),
  // ---- 劇情戰役(另計分類,不佔 3×6 名額;story.js 六章 venueId 錨定此六張)----
  { id: 'taipei101',  name: '台北・101 信義計畫區', country: '🇹🇼', type: '市區', story: true, ll: [25.034009, 121.563871], bearing: 190, mix: { urban: 0.85, green: 0.1, water: 0.05 }, scen: ['underBridge', 'highGround'], relief: 34 },
  { id: 'shibuya',    name: '東京・澀谷十字路口',   country: '🇯🇵', type: '市區', story: true, ll: [35.659538, 139.700442], bearing: 280, mix: { urban: 0.9, green: 0.1 }, scen: ['underBridge'], relief: 14 },
  { id: 'giza',       name: '開羅・吉薩金字塔群',   country: '🇪🇬', type: '裸露地', story: true, ll: [29.986967, 31.142024],  bearing: 210, mix: { bare: 0.85, urban: 0.15 }, scen: ['underBridge', 'highGround'], relief: 36 },
  { id: 'blackforest', name: '德國・黑森林',        country: '🇩🇪', type: '綠地', story: true, ll: [48.466999, 8.411523],   bearing: 10,  mix: { green: 0.9, bare: 0.1 }, scen: ['crossing'], relief: 26 },
  { id: 'manhattan',  name: '紐約・曼哈頓中城',     country: '🇺🇸', type: '市區', story: true, ll: [40.754938, -73.984047], bearing: 30,  mix: { urban: 0.85, green: 0.15 }, relief: 2 },
  { id: 'crimea',     name: '克里米亞・塞瓦斯托波爾', country: '🇺🇦', type: '混合', story: true, ll: [44.617200, 33.524300], bearing: 205, mix: { urban: 0.7, water: 0.2, green: 0.1 }, scen: ['highGround'], relief: 32 },
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

/**
 * 兵線 lat/lng → 遊戲公尺 [x, z](原點取 SWARM 主堡;與 bake / audit 同一組換算)。
 * 分離度複驗與路線摘要共用這一支 —— 兩份換算遲早差一個 cos(lat)。
 */
function laneToGameXZ(lane, o) {
  const cosO = Math.cos(o[0] * Math.PI / 180);
  return lane.map(([la, ln]) => [
    (ln - o[1]) * Math.PI / 180 * R_EARTH * cosO * SC_GAME,
    (la - o[0]) * Math.PI / 180 * R_EARTH * SC_GAME,
  ]);
}

function bakedLanesSeparated(entry) {
  return laneSeparationAudit(entry.lanes.map((l) => laneToGameXZ(l, entry.bases[0]))).ok;
}

/**
 * 兩側翼的弧長等距中線(混合母體的中路備選):兩線各重取樣為固定 K 點後逐點平均。
 * 構造上落在兩側翼正中間 —— 側翼中段間距 ≥ 80m 處,中線離任一側翼恆 ≥ 40m;
 *  pinched 處由分離稽核把關,不通過就換下一備選。固定 K ⇒ 確定性,同輸入同輸出。
 * 中線本身不是真實道路(合成中路亦然),但它與兩側翼共享同一對主堡端點。
 */
function midlineOf(top, bot) {
  const K = 32;
  const cumOf = (pts) => {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + distMeters(pts[i - 1], pts[i]));
    return cum;
  };
  const at = (pts, cum, total, d) => {
    d = Math.max(0, Math.min(total, d));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const f = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
  };
  const ct = cumOf(top), cb = cumOf(bot);
  const tt = ct[ct.length - 1] || 1, tb = cb[cb.length - 1] || 1;
  const out = [];
  for (let k = 0; k <= K; k++) {
    const [a1, o1] = at(top, ct, tt, tt * k / K);
    const [a2, o2] = at(bot, cb, tb, tb * k / K);
    out.push([(a1 + a2) / 2, (o1 + o2) / 2]);
  }
  return out;
}

/**
 * 烘焙兵線表的鍵(`venueLanes.js` 與 `tools/bake_venue_lanes.mjs` 的**唯一縫**)。
 *
 * 完整戰場的鍵就是兵線數(`1` / `2` / `3`);劇情戰役另有一組 `m1`
 * —— **同一條真實道路在兩種情境下不是同一條線**:劇情的塔位分配不同(守方兩階、攻方零階),
 * 路網上「走得通、又剛好這麼長、又排得出合規砲塔」的路徑完全不同。舊制是拿完整版的
 * L1 兩端對稱剪短(`trimLaneTo`),那條線的每一段仍是真實道路,但它從來沒有被任何規則驗過:
 * 剪掉的是頭尾,留下的中段是**別人挑出來的路線的中間** ——「這一段撐不撐得起兩階砲塔」
 * 「有沒有 180° 迴轉」「主軸偏航累積多少」在剪短之後一條都沒有重新成立。這一組鍵就是把
 * 那些規則在**劇情尺度上重跑一次**的產物。
 *
 * 烘焙時劇情兩側的砲塔規則是**一起**驗的(見 bake 的 KEY_MODES)。
 * 型態省略 ⇒ 回 L ⇒ 逐位元同舊制。
 */
export const venueLaneKey = (L, mapA) => (mapPlan(mapA).mode === 'full' ? L : 'm' + L);
/**
 * 表裡有哪些鍵(順序 = 烘焙與寫檔順序)。產生端(bake)、消費端(venueConfig)與稽核
 * (audit_map_rules)同吃這一份 —— 手寫第二份清單的症狀是「烤了卻沒人讀」
 * 或「拿完整戰場的塔位去驗劇情的兵線」,兩種都不會有錯誤訊息。
 * 縮小尺度恆為單兵線(劇情戰役由 `STORY_MAP.LANES` 定 ⇒ `lanesFor` 恆 1)。
 */
export const VENUE_LANE_KEYS = [
  { key: venueLaneKey(1, false), L: 1, mapA: false },
  { key: venueLaneKey(2, false), L: 2, mapA: false },
  { key: venueLaneKey(3, false), L: 3, mapA: false },
  { key: venueLaneKey(1, true), L: 1, mapA: true },
];
/**
 * 這個鍵的兵線要服務哪些地圖型態 —— **砲塔規則一次驗全部**。
 * 縮小尺度的那一條要撐得起劇情戰役(守方兩階、攻方零階),
 * 而劇情的守方可能是任一邊(章節陣營 + `rollSideSwap` 各擲一次)⇒ 全部型態驗過才算合規。
 * 少驗一種的症狀是「換個章節就疊塔」,而烘焙報告與既有稽核照樣全綠。
 */
export const venueLaneModes = (mapA) => (mapA ? [true, 'SWARM', 'STEEL'] : [false]);

/**
 * 兵線兩端**對稱剪短**到指定的兩端直線距離(真實公尺)—— 縮小尺度的縮圖手法(唯一縫)。
 *
 * 為什麼是「剪短」而不是「把座標朝中心等比縮小」:烘焙兵線的每一段都是真實道路,剪短之後
 * 剩下的仍然逐點落在同一條路上 ⇒「兵線 MUST 與現實導航路線相符」原封不動;等比縮小則是把
 * 整條路線平移離開它自己的道路(那是 `migrateFavCfg` 對**自訂**地圖已知且刻意付出的代價,
 * 沒有理由讓預設場地也吃)。
 * 付出的代價只有一個:剪短後的端點(= 兩座主堡)落在路段中間而不是 OSM 節點上。位置仍在
 * 道路中心線上,只是不保證是圖資裡的一顆頂點。
 *
 * 解法是**對稱二分搜尋**沿線內縮量 t:`d(t) = |at(t) − at(total−t)|` 隨 t 遞減(真實道路
 * 偶有回頭段,不保證嚴格,但二分在單調段上收斂、非單調時仍落在容差內)。MUST NOT 改成
 * 「按比例取中間 60% 的沿線長度」—— 那量的是**沿線**距離,而兩堡距離與地圖邊長綁的是
 * **直線**距離(蜿蜒的路剪掉一半沿線長,直線距離可能只掉兩成)。
 * 已經比目標還短的兵線原樣回傳(降級不例外)。
 */
export function trimLaneTo(pts, targetM) {
  if (!pts || pts.length < 2 || !(targetM > 0)) return pts;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + distMeters(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  const at = (d) => {
    d = Math.max(0, Math.min(total, d));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const f = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
  };
  if (distMeters(at(0), at(total)) <= targetM) return pts.map((p) => [...p]);
  let lo = 0, hi = total / 2;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (distMeters(at(mid), at(total - mid)) > targetM) lo = mid; else hi = mid;
  }
  const t = (lo + hi) / 2;
  const out = [at(t)];
  for (let i = 0; i < pts.length; i++) if (cum[i] > t && cum[i] < total - t) out.push([...pts[i]]);
  out.push(at(total - t));
  return out;
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
 * salt = 確定性備選流(salt=0 恆為舊制輸出):混合母體拿真實側翼配合成中路時,
 * 若主位流與側翼互穿,依 salt 遞增換一組同構擺動,直到分離稽核通過。
 */
export function synthLane(a, b, side, salt = 0) {
  const cosLat = Math.cos(a[0] * Math.PI / 180);
  const vx = (b[1] - a[1]) * Math.PI / 180 * R_EARTH * cosLat;
  const vz = (b[0] - a[0]) * Math.PI / 180 * R_EARTH;
  const d = Math.hypot(vx, vz) || 1;
  const px = -vz / d, pz = vx / d;                       // 垂直單位向量(公尺系)
  // 種子不含 side:全部兵線共用同一組側擺相位(同進同退),
  // 線間距離恆為主脊間距(0.3×D×sin),側擺不會互相吃掉分離度。
  // 種子含 salt:同一 (a,b,side) 不同 salt 是不同構的同模擺動,salt=0 逐位元同舊制。
  const rnd = mulberry32(
    ((Math.round(a[0] * 1e4) * 31 + Math.round(a[1] * 1e4) * 17
      + Math.round(b[0] * 1e4) * 7 + Math.round(b[1] * 1e4) * 3
      + Math.imul(salt | 0, 0x9E3779B9)) >>> 0),
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
 * 幾何:母體框架固定三線尺度(真實邊長 0.36km,兩堡距離 = 邊長 × 0.85 × √2);
 * 烘焙尺度較小的場地(僅有 L1/L2 烘焙),框架由實際兩堡距離反推(兩堡恆為對角線 85%)。
 *
 * 第三參數 = 地圖型態(見 data.js `mapPlan`;省略 = 標準戰場、劇情戰役 = 防守方 side):
 * 尺度整組乘 `mapScaleF` ⇒ 邊長 / 兩堡距離 / 重合網格一起縮。劇情戰役**有自己的
 * 一組烘焙兵線**(鍵見 `venueLaneKey` 的 `m1`):同一張圖在不同兩堡距離下,路網上
 * 走得通又合規的路徑不是同一條。烤不到的場地才退回「完整版路線兩端對稱剪短」(`trimLaneTo`)。
 * 合成弧那條路天生吃 realD,零改動。
 * 劇情戰役另外**恆為單兵線**(`laneCountFor`)—— 3v3 / 5v5 一律只取 L1 那條烘焙路線,
 * MUST NOT 拿 lanesFor(teamSize) 去查表(查到的是兩三條線,而兵線數是 STORY_MAP.LANES 定的)。
 *
 * 標準戰役**同一張圖**(2026-09-25 使用者定案):框架恆為三線母體,與人數無關 ——
 * `D/sizeM` 一律取母體尺度(`geoLanesFor`),L1 取母體中路、L2 取母體左右兩路
 * (下標見 data.js `laneSubsetFor`),L3 全開。母體來源三階:①合規 L3 烘焙 →
 * ②合規 L2 烘焙配合成中路(須再過分離稽核,不過就往下掉) → ③合成弧母體。
 * 框架(主堡/尺寸)因此不隨人數漂移;`laneIds` 記母體下標(渲染色號用),
 * `motherLanes` 存整份母體(換人數重派子集用,不進戰鬥結算)。
 */
export function venueConfig(venue, teamSize, mapA = false) {
  const plan = mapPlan(mapA);
  const L = laneCountFor(teamSize, mapA);
  if (plan.mode !== 'full') return venueStoryConfig(venue, L, mapA, plan);
  const G = geoLanesFor(teamSize, mapA);   // 標準戰場恆為母體,與人數無關
  const D = targetDistFor(G, mapA);             // 遊戲世界距離(母體框架,與人數無關)
  const realD = D * MAPGEO.REAL_SCALE;          // 真實地理距離(縮小 → 地形/道路更密)
  const sizeM = D / (MAPGEO.BASE_DIST_FRAC * Math.SQRT2);   // 遊戲世界邊長(母體框架)

  // 三線母體:[上, 中, 下],兩端即兩座主堡
  const baked3 = VENUE_LANES[venue.id]?.[3];
  let A, B, mother, maxOverlap, synthetic, frameFromBases = false;
  if (baked3 && bakedLanesSeparated(baked3)) {
    mother = baked3.lanes.map((l) => l.map((p) => [...p]));
    [A, B] = baked3.bases.map((p) => [...p]);
    maxOverlap = baked3.maxOverlap;
    synthetic = false;
  } else {
    // 混合母體:真實側翼/中路能留就留,缺的那條由中線或合成弧補,過分離稽核才收。
    // 中路備選序:側翼中線(構造等距) → 合成弧逐 salt(同構不同擺);側翼備選:兩翼同 salt。
    const baked2 = VENUE_LANES[venue.id]?.[2];
    if (!mother && baked2 && bakedLanesSeparated(baked2)) {
      const [A2, B2] = baked2.bases.map((p) => [...p]);
      const top = baked2.lanes[0].map((p) => [...p]), bot = baked2.lanes[1].map((p) => [...p]);
      const mids = [midlineOf(top, bot)];
      for (let salt = 0; salt < 8; salt++) mids.push(synthLane(A2, B2, 0, salt));
      for (const mid of mids) {
        if (bakedLanesSeparated({ lanes: [top, mid, bot], bases: [A2, B2] })) {
          [A, B] = [A2, B2];
          mother = [top, mid.map((p) => [...p]), bot];
          maxOverlap = baked2.maxOverlap;
          synthetic = false;
          frameFromBases = true;   // 烘焙尺度主堡配母體公式邊長會跌破兩堡 80% 門檻 ⇒ 邊長由實際兩堡距離反推
          break;
        }
      }
    }
    const baked1 = VENUE_LANES[venue.id]?.[1];
    if (!mother && baked1 && bakedLanesSeparated(baked1)) {
      const [A1, B1] = baked1.bases.map((p) => [...p]);
      const mid = baked1.lanes[0].map((p) => [...p]);
      for (let salt = 0; salt < 8 && !mother; salt++) {
        const cand = [synthLane(A1, B1, 1, salt), mid, synthLane(A1, B1, -1, salt)];
        if (bakedLanesSeparated({ lanes: cand, bases: [A1, B1] })) {
          [A, B] = [A1, B1];
          mother = cand;
          maxOverlap = baked1.maxOverlap;
          synthetic = false;
          frameFromBases = true;
        }
      }
    }
    if (!mother) {
      A = [...venue.ll];
      B = destPoint(A, venue.bearing ?? 0, realD);
      mother = [1, 0, -1].map((s) => synthLane(A, B, s));
      maxOverlap = 0.06;           // 三線同相位側擺、主脊間距 0.3×D,僅端點交會
      synthetic = true;
    }
  }
  const sub = laneSubsetFor(L);
  const lanes = sub.map((i) => mother[i].map((p) => [...p]));
  // distM 用實際兩堡距離(預算路線的端點吸附到道路節點,與理想值有數十公尺差)
  const distGame = distMeters(A, B) / MAPGEO.REAL_SCALE;
  const sizeMUse = frameFromBases ? distGame / (MAPGEO.BASE_DIST_FRAC * Math.SQRT2) : sizeM;
  return {
    // rot = 地圖主方位(弧度):把整張地圖轉這麼多度,該場地的大馬路就對齊世界軸
    // (2026-08-10 使用者定案)。離線烘焙的表沒有這個場地 ⇒ 0 = 不旋轉 = 逐位元同舊制。
    // **旋轉是投影的一部分**(見 data.js llToXZ),隨 battleConfig 廣播全房 ⇒ 兩端同一個世界。
    center: { lat: (A[0] + B[0]) / 2, lng: (A[1] + B[1]) / 2, rot: (VENUE_GRID[venue.id] || 0) * Math.PI / 180 },
    bases: { SWARM: A, STEEL: B },
    lanes,
    laneCount: L,
    laneIds: [...sub],
    motherLanes: mother.map((l) => l.map((p) => [...p])),
    sizeM: sizeMUse, diagM: sizeMUse * Math.SQRT2, distM: distGame,   // 全為遊戲世界公尺
    geoScaleVer: MAPGEO.GEO_SCALE_VER,
    maxOverlap,
    synthetic, precomputed: true,
    // `country`(旗幟 emoji)MUST 帶進 battleConfig:兩個消費端都在建圖期,而那時只拿得到
    // cfg —— ①在地文字語域的備援(`biomes.js` 的 `localeOf(cfg.venue?.country)`,**這一行
    // 2026-08-13 之前一直讀到 undefined**:VENUES 有這一欄而 venueConfig 沒帶下來);
    // ②國旗物件的「地圖國」那 30%(flags.js 的 FLAG_MIX)。自訂地圖沒有這一欄 ⇒ 兩者各自降級。
    venue: { id: venue.id, name: venue.name, mix: venue.mix, country: venue.country, base: venue.base || null, variant: venue.variant || null, ampF: venue.ampF ?? 1 },
    placeName: venue.name,
    // 劇情戰役:防守方(BOSS 方)陣營 id。同樣 MUST 隨 battleConfig 廣播 —— 塔位是非對稱的,
    // 少一台知道就少一台把敵方的兩座塔建在同一個地方。一般對戰恆 null ⇒ 一切推導同舊制。
    defSide: plan.def,
  };
}

/**
 * 劇情戰役專用(單線,不進三線母體):烘焙 m1 → 完整版路線剪短 → 合成弧。
 * 縮小尺度恆為單兵線(`laneCountFor`),MUST NOT 拿 lanesFor(teamSize) 去查表。
 */
function venueStoryConfig(venue, L, mapA, plan) {
  const D = targetDistFor(L, mapA);             // 遊戲世界距離
  const realD = D * MAPGEO.REAL_SCALE;          // 真實地理距離(縮小 → 地形/道路更密)
  const sizeM = D / (MAPGEO.BASE_DIST_FRAC * Math.SQRT2);   // 遊戲世界邊長

  // 三階降級(寧缺勿錯,原則 6):①這個尺度自己的烘焙路線 → ②完整版路線剪短 → ③合成弧。
  // ② 只在 ① 缺席時才走 —— 它是 2026-08-13~14 的過渡路徑,留著是因為新烤一張圖需要外網,
  // 而「沒烤到的場地整張不能玩」比「路線沒被規則重驗過」更糟。
  const ownRaw = VENUE_LANES[venue.id]?.[venueLaneKey(L, mapA)] || (L === 1 ? VENUE_LANES[venue.id]?.m1 : null);
  const bakedRaw = (ownRaw && bakedLanesSeparated(ownRaw)) ? ownRaw : VENUE_LANES[venue.id]?.[L];
  const baked = bakedRaw && bakedLanesSeparated(bakedRaw) ? bakedRaw : null;
  let A, B, lanes, maxOverlap, synthetic;
  if (baked) {
    lanes = baked.lanes.map((l) => l.map((p) => [...p]));
    if (plan.mode !== 'full' && baked !== ownRaw) {
      // ②:縮小尺度但只有完整版路線可用 ⇒ 兩端對稱剪短,兩端就是兩座主堡。
      // 多兵線時剪短會把共享端點拆成 L 組不同的主堡座標,故**只在單兵線時做**,其餘退回原樣。
      if (lanes.length === 1) lanes = [trimLaneTo(lanes[0], realD)];
      [A, B] = [[...lanes[0][0]], [...lanes[0][lanes[0].length - 1]]];
    } else {
      // ①(或完整戰場):烘焙時的兩堡就是這條路線的兩端,一格都不必動。
      [A, B] = baked.bases.map((p) => [...p]);
    }
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
    // rot = 地圖主方位(弧度):把整張地圖轉這麼多度,該場地的大馬路就對齊世界軸
    // (2026-08-10 使用者定案)。離線烘焙的表沒有這個場地 ⇒ 0 = 不旋轉 = 逐位元同舊制。
    // **旋轉是投影的一部分**(見 data.js llToXZ),隨 battleConfig 廣播全房 ⇒ 兩端同一個世界。
    center: { lat: (A[0] + B[0]) / 2, lng: (A[1] + B[1]) / 2, rot: (VENUE_GRID[venue.id] || 0) * Math.PI / 180 },
    bases: { SWARM: A, STEEL: B },
    lanes,
    laneCount: L,
    laneIds: lanes.map((_, i) => i),   // 劇情單線無母體,下標即自身
    sizeM, diagM: sizeM * Math.SQRT2, distM: distGame,   // 全為遊戲世界公尺
    geoScaleVer: MAPGEO.GEO_SCALE_VER,
    maxOverlap,
    synthetic, precomputed: true,
    // `country`(旗幟 emoji)MUST 帶進 battleConfig:兩個消費端都在建圖期,而那時只拿得到
    // cfg —— ①在地文字語域的備援(`biomes.js` 的 `localeOf(cfg.venue?.country)`,**這一行
    // 2026-08-13 之前一直讀到 undefined**:VENUES 有這一欄而 venueConfig 沒帶下來);
    // ②國旗物件的「地圖國」那 30%(flags.js 的 FLAG_MIX)。自訂地圖沒有這一欄 ⇒ 兩者各自降級。
    venue: { id: venue.id, name: venue.name, mix: venue.mix, country: venue.country, base: venue.base || null, variant: venue.variant || null, ampF: venue.ampF ?? 1 },
    placeName: venue.name,
    // 劇情戰役:防守方(BOSS 方)陣營 id。同樣 MUST 隨 battleConfig 廣播 —— 塔位是非對稱的,
    // 少一台知道就少一台把敵方的兩座塔建在同一個地方。一般對戰恆 null ⇒ 一切推導同舊制。
    defSide: plan.def,
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
  // 地圖只剩一種:舊最愛的 mini 旗標不再解讀,一律按標準戰場重算(幾何逐位元相同)。
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
