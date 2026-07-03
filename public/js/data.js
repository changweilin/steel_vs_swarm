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
  soldier: 'flesh', apc: 'armor', tank: 'armor', rocketeer: 'flesh', howitzer: 'armor', heli: 'air',
  robot: 'armor', drone: 'air', tower: 'building', base: 'building',
  // 中立可擊毀物(防空陣地 / 障礙物)吃反建築加成:攻城武器開路特別快
  aasite: 'building', construction: 'building', wreck: 'building',
  rockfall: 'building', fallentree: 'building',
};
export const CLASS_NAME = { flesh: '肉體', armor: '裝甲', air: '飛行', building: '建築' };

// ---- 熱兵器(全部有彈夾,打空要填彈;vs = 對目標類型加成)----
// 自帶:dgun/rgun(主武器)、rocket(機甲右鍵)、bomb(無人機自帶重型炸彈,
//        右鍵原地引爆或高速撞擊引爆,座機同歸於盡 → 無人機重生無冷卻)。
// 有 price 的才會在主堡軍械庫上架(額外武器:機甲 2 槽、無人機 1 槽)。
export const WEAPONS = {
  dgun:   { name: '蜂刺機槍',   dmg: 16,  rate: 7,   range: 420, mag: 24, reload: 1.8, vs: { flesh: 1.2, armor: 0.7, air: 1.3, building: 0.5 } },
  rgun:   { name: '重型機槍',   dmg: 26,  rate: 4.5, range: 380, mag: 48, reload: 2.2, vs: { flesh: 1.3, armor: 1.0, air: 0.8, building: 0.6 } },
  rocket: { name: '肩射火箭',   dmg: 130, r: 20, rate: 1 / 6, range: 600, mag: 3, reload: 8, needAim: true, vs: { flesh: 1.0, armor: 1.5, air: 0.5, building: 1.3 } },
  bomb:   { name: '重型炸彈',   dmg: 240, r: 22, vs: { flesh: 1.5, armor: 1.2, air: 0.5, building: 1.5 } },
  railgun: { name: '磁軌狙擊砲', dmg: 110, rate: 0.9, range: 700, mag: 4,  reload: 3.0, price: 400, tag: '反裝甲', needAim: true, vs: { flesh: 1.0, armor: 2.0, air: 1.4, building: 0.8 } },
  flak:    { name: '防空霰彈砲', dmg: 50,  rate: 2.5, range: 280, mag: 8,  reload: 2.5, price: 300, tag: '反飛行', vs: { flesh: 1.3, armor: 0.5, air: 2.5, building: 0.3 } },
  siege:   { name: '攻城榴彈砲', dmg: 90,  rate: 1.2, range: 430, mag: 6,  reload: 3.5, price: 400, tag: '反建築', needAim: true, vs: { flesh: 0.8, armor: 1.2, air: 0.4, building: 2.2 } },
  ripper:  { name: '鏈鋸速射砲', dmg: 10,  rate: 12,  range: 230, mag: 60, reload: 2.2, price: 250, tag: '反人員', vs: { flesh: 2.2, armor: 0.5, air: 1.2, building: 0.3 } },
};
export const vsMult = (wd, kind) => wd.vs?.[TARGET_CLASS[kind]] ?? 1;

// ---- 經濟(擊殺得錢 → 隨處升級 / 回主堡買熱兵器)----
export const ECON = {
  START: 200,
  INCOME_PER_S: 2,
  // 擊殺賞金:高價值單位報酬越高(missile = 擊落防空飛彈)
  BOUNTY: {
    soldier: 15, apc: 35, tank: 80, tower: 200, drone: 150, robot: 150, missile: 15, aasite: 40,
    rocketeer: 30, howitzer: 45, heli: 60,
  },
  UPGRADES: {
    dmg:  { name: '火力強化', desc: '所有武器傷害 +12%', max: 5, step: 0.12, base: 150, inc: 100 },
    hull: { name: '裝甲強化', desc: '座機血量上限 +12%', max: 5, step: 0.12, base: 150, inc: 100 },
  },
};
export const upgradePrice = (u, lvl) => u.base + u.inc * lvl;

// ---- 單位數值 ----
export const UNITS = {
  // 小兵(雙方都是人類部隊:士兵 / 裝甲車 / 坦克)
  soldier:   { name: '步槍兵', hp: 90,  dmg: 10, range: 60,  rate: 1.0, speed: 8, sight: 150, bounty: 1, wid: 'rgun' },
  rocketeer: { name: '火箭兵', hp: 100, dmg: 60, range: 130, rate: 0.4, speed: 7, sight: 160, bounty: 3, wid: 'rocket' },
  howitzer:  { name: '榴彈兵', hp: 130, dmg: 70, range: 220, rate: 0.3, speed: 5, sight: 220, bounty: 4, wid: 'siege' },
  heli:      { name: '攻擊直升機', hp: 260, dmg: 35, range: 140, rate: 0.8, speed: 16, sight: 220, bounty: 6, wid: 'rgun' },
  // 舊兵種資料保留(不再於一般波次生成,供其他機制/測試沿用)
  apc:     { name: '裝甲車', hp: 320,  dmg: 22, range: 100, rate: 0.9, speed: 11, sight: 170, bounty: 2, wid: 'rgun' },
  tank:    { name: '主戰坦克', hp: 750, dmg: 55, range: 150, rate: 0.6, speed: 9,  sight: 200, bounty: 4, wid: 'siege' },
  // 建築(防禦塔兼防空:對高空無人機發射追蹤飛彈;飛彈本身可被擊毀)
  tower:   { name: '防禦塔', hp: 1000, dmg: 65, range: 190, rate: 1.0, speed: 0,  sight: 190,
             sam: { name: '防空飛彈', dmg: 130, range: 240, cd: 4, speed: 120, hp: 40 } },
  base:    { name: '主堡',   hp: 3000, dmg: 90, range: 230, rate: 1.2, speed: 0,  sight: 230 },
  // 英雄:機甲 HP/彈藥 = 無人機 2 倍;無人機速度 = 機甲 2 倍、視野廣(fov)
  drone: {
    name: '獵蜂無人機', hp: 320, speed: 42, vspeed: 22, fov: 100, zoomFov: 55, sight: 300,
    loadout: ['dgun'], slots: 1,        // 自帶機槍 + 可加購 1 件熱兵器
    bomb: 'bomb',                        // F 鍵原地引爆 / 高速撞擊引爆(自毀)
    regen: 12,
    respawn: { base: 0, perDeath: 0 },   // 無冷卻重生
  },
  robot: {
    name: '執法者機甲', hp: 640, speed: 21, jump: 9, fov: 72, zoomFov: 35, sight: 220,
    loadout: ['rgun'], slots: 2,         // 自帶重機槍 + 可加購 2 件熱兵器
    burst: 'rocket',                     // 按住右鍵瞄準、左鍵發射肩射火箭(有彈數)
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
  WAVE_SOLDIERS: 3,           // 每波每兵線步槍兵數(另加固定 1 火箭兵/1 榴彈兵/1 攻擊直升機)
  HELI_ALT: 26,               // 攻擊直升機巡航高度(公尺;純視覺+高空降權判定用)
  AIM_SIGHT_MULT: 1.6,        // 瞄準模式視野加成(狙擊模式看得更遠)
  TOWER_FRACS: [0.24, 0.42],  // 防禦塔在兵線上的位置(距己方主堡比例)
  CREEP_AGGRO_HERO_BIAS: 0.7, // 小兵優先打小兵/建築,英雄目標權重
  HERO_HEAL_RADIUS: 160,      // 主堡補血半徑(也是軍械庫購物範圍)
  BASE_ARMOR_NEED_CREEP: 0.35,// 沒有己方小兵在場時打主堡的傷害折減
  AA_MIN_ALT: 40,             // 兵線走廊上:防空飛彈只鎖定離地 ≥ 40m 的無人機(低飛吃塔砲)
  LANE_SAFE_M: 45,            // 正規路線走廊半寬;出了走廊 = 非正規路線(地雷 / 防空伏擊)
  // 地雷(非正規路線,只有地面機甲會踩;顏色融入地表,靠近才看得到極輕微突起)
  MINES: { PER_LANE: 25, TRIGGER_R: 4, DMG: 170, R: 10, LANE_CLEAR: 40, BASE_CLEAR: 150,
           SEE_M: 30, CLEAR_M: 14 },   // 客戶端:SEE_M 內開始浮現,CLEAR_M 內完全可見
  // 匿蹤防空伏擊(非正規路線的無人機):命中直接擊墜;飛彈可被擊毀。
  // 觸發需要射程內有存活的匿蹤防空陣地(aasite)——拔掉陣地 = 打出安全空域。
  AA_AMBUSH: { CHANCE_PER_S: 0.22, CD_S: 7, DMG: 400, SPEED: 130, HP: 40 },
};

// ---- 危險區:非圖資障礙物(Diablo 核心思想:迷宮式隨機佈局 + 隨機物品掉落)----
// 生成在空白區 / 非主要路徑與主要路徑邊緣:限制行動但不完全封鎖——
// 阻擋型障礙以「短牆 + 保證縫隙」佈局(FIELD.HAZ_GAP),同時提供隱蔽與戰略通道;
// 有 hp 的可擊毀(= 自行開路),掉落隨機物資。分布依場地地貌 mix(biome)加權。
// r: 影響半徑(m,乘實例 sc);block: 阻擋地面單位;slow: 地面速度倍率;
// dot: 每秒灼傷(y < maxY 才吃);salvage: 擊毀後掉物資機率。
export const HAZARDS = {
  construction: { name: '施工圍籬',   biome: 'urban', r: 8,   block: true, hp: 240, salvage: 0.6 },
  wreck:        { name: '車禍殘骸',   biome: 'urban', r: 5.5, block: true, hp: 180, salvage: 0.7 },
  fire:         { name: '火場',       biome: 'urban', r: 12,  dot: 30, maxY: 24 },
  sinkhole:     { name: '路面塌陷',   biome: 'urban', r: 7,   block: true },
  flood:        { name: '淹水區',     biome: 'wet',   r: 20,  slow: 0.45 },
  landslide:    { name: '坍方土石流', biome: 'bare',  r: 13,  block: true },
  rockfall:     { name: '落石',       biome: 'bare',  r: 6.5, block: true, hp: 300, salvage: 0.65 },
  fallentree:   { name: '倒木',       biome: 'green', r: 7,   block: true, hp: 130, salvage: 0.5 },
};

// ---- 危險區生成參數(伺服器 sim._seedField)----
export const FIELD = {
  HAZ_PER_LANE: 16,      // 障礙物目標數 / 兵線
  HAZ_LANE_MIN: 20,      // 距兵線中心線最小距離(走廊半寬 14m + 邊緣帶,不擋正規路線)
  HAZ_LANE_MAX: 300,     // 最遠分布(涵蓋空白區)
  HAZ_EDGE_BIAS: 1.8,    // 越靠走廊邊緣越密(rnd^bias):主要路徑邊緣的戰略隱蔽
  HAZ_GAP: 30,           // 「牆段」彼此最小間距 = 保證通行縫隙(> 4 台機甲並行)
  HAZ_BASE_CLEAR: 170,   // 主堡淨空
  CLUSTER_MAX: 3,        // 同型障礙連成短牆(Diablo 迷宮牆 + 門的手感)
  AA_SITES_PER_LANE: 3,  // 匿蹤防空陣地 / 兵線
  AA_SITE: { name: '匿蹤防空陣地', hp: 120, range: 260, laneMin: 60, laneMax: 240, spacing: 130 },
};

// ---- 戰場物資(Diablo 式隨機掉落:擊毀障礙物有機率掉,靠近拾取)----
export const LOOT = {
  PICK_R: 8, MAX_Y: 25, TTL_S: 90,
  TIERS: [
    { p: 0.55, min: 15, max: 40 },    // 普通:小額現金
    { p: 0.30, min: 45, max: 95 },    // 高級:大額現金
    { p: 0.15, ammo: true },          // 稀有:全武器彈藥即刻補滿
  ],
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
