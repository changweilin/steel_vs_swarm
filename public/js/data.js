// ============ 無人戰略:鋼鐵與蜂群 — 共用遊戲常數 ============
// 伺服器(server/sim.js)與前端(game.js)共用同一份數值,
// 模式沿用 ai_tycoon:server 直接 import '../public/js/data.js'。

// ---- 陣營 ----
export const SIDES = {
  SWARM: {
    id: 'SWARM',
    name: '蜂群兵團',
    en: 'THE SWARM',
    hero: 'drone',
    heroName: '獵蜂無人機',
    color: '#ffb300',      // 琥珀警示黃
    colorDim: '#8a6a10',
    desc: '操作武裝無人機。速度快、機動高、血量薄;垂直機動掌握制空權。',
  },
  STEEL: {
    id: 'STEEL',
    name: '鋼鐵軍團',
    en: 'STEEL LEGION',
    hero: 'robot',
    heroName: '執法者機甲',
    color: '#4fc3f7',      // 鋼鐵冷藍
    colorDim: '#1a5c78',
    desc: '駕駛雙足重型機甲。裝甲厚、火力猛、抗打擊;地面推進碾碎一切。',
  },
};
export const OTHER_SIDE = { SWARM: 'STEEL', STEEL: 'SWARM' };

// ---- 隊伍規模 ----
// 每陣營 N 人(1~5),總人數 2N;兵線 L = ⌈N/2⌉(1v1=1 線 … 5v5=3 線);
// 地圖邊長正比 L,基準為 5v5(L=3,兩堡 4800m)。
export const TEAM = { MIN: 1, MAX: 5, DEFAULT: 5 };
export const lanesFor = (n) => Math.ceil(n / 2);
export const targetDistFor = (L) => MAPGEO.DIST_M_PER_LANE * L;

// ---- 地圖幾何(DOTA 規模)----
export const MAPGEO = {
  // 主堡距離目標 ≈ 0.85 × 地圖對角線(> 題目要求的 80%)
  BASE_DIST_FRAC: 0.85,
  MIN_DIST_FRAC: 0.80,
  // 候選主堡搜尋:5v5(3 線)以 4km 見方(DOTA 約 8km²)為基準 → 兩堡 4800m;
  // 兩堡距離依線數等比:1600m × L
  DIST_M_PER_LANE: 1600,
  TARGET_DIST_M: 4800,
  // 三條兵線側向偏移(佔兩堡距離比例)
  LANE_OFFSET_FRAC: 0.30,
  // 路徑重合判定格 (m) 與允許重合率(1 - 80% 不重合)
  OVERLAP_CELL_M: 120,
  MAX_OVERLAP: 0.20,
  CANDIDATE_BEARINGS: 12,
  MAX_CANDIDATES: 4,
};

// ---- 單位數值 ----
export const UNITS = {
  // 小兵(雙方都是人類部隊:士兵 / 裝甲車 / 坦克)
  soldier: { name: '步兵',   hp: 90,   dmg: 10, range: 60,  rate: 1.0, speed: 7,  sight: 150, bounty: 1 },
  apc:     { name: '裝甲車', hp: 320,  dmg: 22, range: 100, rate: 0.9, speed: 10, sight: 170, bounty: 2 },
  tank:    { name: '主戰坦克', hp: 750, dmg: 55, range: 150, rate: 0.6, speed: 8,  sight: 200, bounty: 4 },
  // 建築(防禦塔兼防空:對高空無人機發射追蹤飛彈)
  tower:   { name: '防禦塔', hp: 1400, dmg: 65, range: 190, rate: 1.0, speed: 0,  sight: 190,
             sam: { name: '防空飛彈', dmg: 45, range: 360, cd: 4, speed: 120 } },
  base:    { name: '主堡',   hp: 4500, dmg: 90, range: 230, rate: 1.2, speed: 0,  sight: 230 },
  // 英雄
  drone: {
    name: '獵蜂無人機', hp: 320, speed: 46, vspeed: 22,
    gun:   { dmg: 16, rate: 7,  range: 420 },   // 機砲
    burst: { dmg: 90, r: 26, cd: 6, name: '空投炸彈' }, // 右鍵
    regen: 12,
  },
  robot: {
    name: '執法者機甲', hp: 700, speed: 21, jump: 9,
    gun:   { dmg: 26, rate: 4.5, range: 380 },  // 重機槍
    burst: { dmg: 130, r: 20, cd: 6, name: '肩射火箭' }, // 右鍵
    regen: 18,
  },
};

// ---- 對局節奏 ----
export const GAME = {
  TICK_MS: 125,               // 伺服器模擬 8Hz
  SNAP_MS: 125,               // 快照廣播 8Hz
  WAVE_INTERVAL_S: 26,        // 兵線波次間隔
  FIRST_WAVE_DELAY_S: 8,
  WAVE_SOLDIERS: 4,
  WAVE_APC: 1,
  TANK_EVERY_WAVE: 3,         // 每第 3 波加派 1 輛坦克
  TOWER_FRACS: [0.24, 0.42],  // 防禦塔在兵線上的位置(距己方主堡比例)
  RESPAWN_BASE_S: 8,
  RESPAWN_PER_DEATH_S: 2,
  CREEP_AGGRO_HERO_BIAS: 0.7, // 小兵優先打小兵/建築,英雄目標權重
  HERO_HEAL_RADIUS: 160,      // 主堡補血半徑
  BASE_ARMOR_NEED_CREEP: 0.35,// 沒有己方小兵在場時打主堡的傷害折減
  AA_MIN_ALT: 40,             // 防空飛彈只鎖定離地 ≥ 40m 的無人機(低飛吃塔砲)
};

// ---- 電腦玩家(單人練習 / 補位)----
export const BOT_NAMES = ['天網-01', '刺針-02', '寒鴉-03', '掠奪者-04', '哨兵-05', '幽靈-06', '雷霆-07', '毒蛛-08'];
export const isBotId = (id) => typeof id === 'string' && id.startsWith('b');

// ---- 環境:季節 / 日夜 / 天氣(建房時選,預設隨機)----
export const ENV = {
  seasons: {
    spring: { name: '春', foliage: 0x6fbf58, grass: 0x7cb85a, accent: 0xe8a0c8 },
    summer: { name: '夏', foliage: 0x3e8f3a, grass: 0x5a9e46, accent: 0xffe08a },
    autumn: { name: '秋', foliage: 0xc9762b, grass: 0xa9924f, accent: 0xd94f2b },
    winter: { name: '冬', foliage: 0x9fb3ad, grass: 0x9aa08d, accent: 0xe8f0f4 },
  },
  times: {
    day:   { name: '白天' },
    dusk:  { name: '黃昏' },
    night: { name: '夜晚' },
  },
  weathers: {
    clear:  { name: '晴朗' },
    cloudy: { name: '陰天' },
    rain:   { name: '降雨' },
    snow:   { name: '降雪' },
    fog:    { name: '濃霧' },
  },
};

/** env = { season, time, weather };'random'/缺值 → 抽一個具體值 */
export function resolveEnv(env = {}) {
  const pick = (obj, v) => (v && obj[v]) ? v : Object.keys(obj)[Math.floor(Math.random() * Object.keys(obj).length)];
  return {
    season: pick(ENV.seasons, env.season),
    time: pick(ENV.times, env.time),
    weather: pick(ENV.weathers, env.weather),
  };
}

// ---- 地貌類型(場地 mix 與地被分類共用鍵)----
export const BIOMES = {
  green: { name: '綠地', desc: '竹林/闊葉林/針葉林' },
  bare:  { name: '裸露地', desc: '芒草/箭竹/灌木/多肉' },
  urban: { name: '市區', desc: '依圖資建物' },
  water: { name: '水體', desc: '河/湖/瀑' },
  wet:   { name: '濕地', desc: '潮間帶/沼澤' },
};

export const PHASES = ['lobby', 'room', 'loading', 'game', 'over'];
