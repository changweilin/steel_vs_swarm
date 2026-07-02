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

// ---- 地圖幾何(DOTA 規模)----
export const MAPGEO = {
  // 主堡距離目標 ≈ 0.85 × 地圖對角線(> 題目要求的 80%)
  BASE_DIST_FRAC: 0.85,
  MIN_DIST_FRAC: 0.80,
  // 候選主堡搜尋:以 4km 見方(DOTA 約 8km²)為基準 → 兩堡直線距離
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
  // 建築
  tower:   { name: '防禦塔', hp: 1400, dmg: 65, range: 190, rate: 1.0, speed: 0,  sight: 190 },
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
};

export const PHASES = ['lobby', 'room', 'mapselect', 'loading', 'game', 'over'];
