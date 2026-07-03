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
// 地圖邊長正比 L(兩堡 1000m × L),1/2/3 線目標場均 5/8/10 分鐘。
export const TEAM = { MIN: 1, MAX: 5, DEFAULT: 5 };
export const lanesFor = (n) => Math.ceil(n / 2);
export const targetDistFor = (L) => MAPGEO.DIST_M_PER_LANE * L;

// ---- 地圖幾何(緊湊節奏)----
export const MAPGEO = {
  // 主堡距離目標 ≈ 0.85 × 地圖對角線(> 題目要求的 80%)
  BASE_DIST_FRAC: 0.85,
  MIN_DIST_FRAC: 0.80,
  // 節奏簡化:兩堡距離 1000m × L(1/2/3 線 ≈ 5/8/10 分鐘一場)
  DIST_M_PER_LANE: 1000,
  TARGET_DIST_M: 3000,
  // 三條兵線側向偏移(佔兩堡距離比例)
  LANE_OFFSET_FRAC: 0.30,
  // 路徑重合判定格 (m) 與允許重合率(1 - 80% 不重合)
  OVERLAP_CELL_M: 120,
  MAX_OVERLAP: 0.20,
  CANDIDATE_BEARINGS: 12,
  MAX_CANDIDATES: 4,
};

// ---- 目標類型(武器克制查表:單位種類 → 類別)----
export const TARGET_CLASS = {
  soldier: 'flesh', apc: 'armor', tank: 'armor',
  robot: 'armor', drone: 'air', tower: 'building', base: 'building',
};
export const CLASS_NAME = { flesh: '肉體', armor: '裝甲', air: '飛行', building: '建築' };

// ---- 熱兵器(全部有彈夾,打空要填彈;vs = 對目標類型加成)----
// 自帶:dgun/rgun(主武器)、rocket(機甲右鍵)、bomb(無人機自帶重型炸彈,
//        右鍵原地引爆或高速撞擊引爆,座機同歸於盡 → 無人機重生無冷卻)。
// 有 price 的才會在主堡軍械庫上架(額外武器:機甲 2 槽、無人機 1 槽)。
export const WEAPONS = {
  dgun:   { name: '蜂刺機槍',   dmg: 16,  rate: 7,   range: 420, mag: 24, reload: 1.8, vs: { flesh: 1.2, armor: 0.7, air: 1.3, building: 0.5 } },
  rgun:   { name: '重型機槍',   dmg: 26,  rate: 4.5, range: 380, mag: 48, reload: 2.2, vs: { flesh: 1.3, armor: 1.0, air: 0.8, building: 0.6 } },
  rocket: { name: '肩射火箭',   dmg: 130, r: 20, rate: 1 / 6, range: 600, mag: 3, reload: 8, vs: { flesh: 1.0, armor: 1.5, air: 0.5, building: 1.3 } },
  bomb:   { name: '重型炸彈',   dmg: 240, r: 22, vs: { flesh: 1.5, armor: 1.2, air: 0.5, building: 1.5 } },
  railgun: { name: '磁軌狙擊砲', dmg: 110, rate: 0.9, range: 700, mag: 4,  reload: 3.0, price: 400, tag: '反裝甲', vs: { flesh: 1.0, armor: 2.0, air: 1.4, building: 0.8 } },
  flak:    { name: '防空霰彈砲', dmg: 50,  rate: 2.5, range: 280, mag: 8,  reload: 2.5, price: 300, tag: '反飛行', vs: { flesh: 1.3, armor: 0.5, air: 2.5, building: 0.3 } },
  siege:   { name: '攻城榴彈砲', dmg: 90,  rate: 1.2, range: 430, mag: 6,  reload: 3.5, price: 400, tag: '反建築', vs: { flesh: 0.8, armor: 1.2, air: 0.4, building: 2.2 } },
  ripper:  { name: '鏈鋸速射砲', dmg: 10,  rate: 12,  range: 230, mag: 60, reload: 2.2, price: 250, tag: '反人員', vs: { flesh: 2.2, armor: 0.5, air: 1.2, building: 0.3 } },
};
export const vsMult = (wd, kind) => wd.vs?.[TARGET_CLASS[kind]] ?? 1;

// ---- 經濟(擊殺得錢 → 隨處升級 / 回主堡買熱兵器)----
export const ECON = {
  START: 200,
  INCOME_PER_S: 2,
  // 擊殺賞金:高價值單位報酬越高(missile = 擊落防空飛彈)
  BOUNTY: { soldier: 15, apc: 35, tank: 80, tower: 200, drone: 150, robot: 150, missile: 15 },
  UPGRADES: {
    dmg:  { name: '火力強化', desc: '所有武器傷害 +12%', max: 5, step: 0.12, base: 150, inc: 100 },
    hull: { name: '裝甲強化', desc: '座機血量上限 +12%', max: 5, step: 0.12, base: 150, inc: 100 },
  },
};
export const upgradePrice = (u, lvl) => u.base + u.inc * lvl;

// ---- 單位數值 ----
export const UNITS = {
  // 小兵(雙方都是人類部隊:士兵 / 裝甲車 / 坦克)
  soldier: { name: '步兵',   hp: 90,   dmg: 10, range: 60,  rate: 1.0, speed: 8,  sight: 150, bounty: 1 },
  apc:     { name: '裝甲車', hp: 320,  dmg: 22, range: 100, rate: 0.9, speed: 11, sight: 170, bounty: 2 },
  tank:    { name: '主戰坦克', hp: 750, dmg: 55, range: 150, rate: 0.6, speed: 9,  sight: 200, bounty: 4 },
  // 建築(防禦塔兼防空:對高空無人機發射追蹤飛彈;飛彈本身可被擊毀)
  tower:   { name: '防禦塔', hp: 1000, dmg: 65, range: 190, rate: 1.0, speed: 0,  sight: 190,
             sam: { name: '防空飛彈', dmg: 130, range: 240, cd: 4, speed: 120, hp: 40 } },
  base:    { name: '主堡',   hp: 3000, dmg: 90, range: 230, rate: 1.2, speed: 0,  sight: 230 },
  // 英雄:機甲 HP/彈藥 = 無人機 2 倍;無人機速度 = 機甲 2 倍、視野廣(fov)
  drone: {
    name: '獵蜂無人機', hp: 320, speed: 42, vspeed: 22, fov: 100,
    loadout: ['dgun'], slots: 1,        // 自帶機槍 + 可加購 1 件熱兵器
    bomb: 'bomb',                        // 右鍵原地引爆 / 高速撞擊引爆(自毀)
    regen: 12,
    respawn: { base: 0, perDeath: 0 },   // 無冷卻重生
  },
  robot: {
    name: '執法者機甲', hp: 640, speed: 21, jump: 9, fov: 72,
    loadout: ['rgun'], slots: 2,         // 自帶重機槍 + 可加購 2 件熱兵器
    burst: 'rocket',                     // 右鍵肩射火箭(有彈數)
    regen: 18,
    respawn: { base: 8, perDeath: 2 },   // 重生需冷卻,越死越久
  },
};

// ---- 對局節奏(緊湊化:1/2/3 線目標 5/8/10 分鐘一場)----
export const GAME = {
  TICK_MS: 125,               // 伺服器模擬 8Hz
  SNAP_MS: 125,               // 快照廣播 8Hz
  WAVE_INTERVAL_S: 22,        // 兵線波次間隔
  FIRST_WAVE_DELAY_S: 6,
  WAVE_SOLDIERS: 4,
  WAVE_APC: 1,
  TANK_EVERY_WAVE: 3,         // 每第 3 波加派 1 輛坦克
  TOWER_FRACS: [0.24, 0.42],  // 防禦塔在兵線上的位置(距己方主堡比例)
  CREEP_AGGRO_HERO_BIAS: 0.7, // 小兵優先打小兵/建築,英雄目標權重
  HERO_HEAL_RADIUS: 160,      // 主堡補血半徑(也是軍械庫購物範圍)
  BASE_ARMOR_NEED_CREEP: 0.35,// 沒有己方小兵在場時打主堡的傷害折減
  AA_MIN_ALT: 40,             // 兵線走廊上:防空飛彈只鎖定離地 ≥ 40m 的無人機(低飛吃塔砲)
  LANE_SAFE_M: 45,            // 正規路線走廊半寬;出了走廊 = 非正規路線(地雷 / 防空伏擊)
  // 地雷(非正規路線,只有地面機甲會踩;隱蔽不可見)
  MINES: { PER_LANE: 25, TRIGGER_R: 4, DMG: 170, R: 10, LANE_CLEAR: 40, BASE_CLEAR: 150 },
  // 匿蹤防空伏擊(非正規路線的無人機):命中直接擊墜;飛彈可被擊毀
  AA_AMBUSH: { CHANCE_PER_S: 0.22, CD_S: 7, DMG: 400, SPEED: 130, SPAWN_DIST: 160, HP: 40 },
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
