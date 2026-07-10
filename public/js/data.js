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
// 兩堡「遊戲世界」距離 = 1500m × L × 尺寸倍率(以 medium 正規化;medium@L1 邊長 = 1.25km)
export const targetDistFor = (L, sizeKey = 'medium') =>
  MAPGEO.DIST_M_PER_LANE * L * ((MAPGEO.SIZE_MULT[sizeKey] ?? MAPGEO.SIZE_MULT.medium) / MAPGEO.SIZE_MULT.medium);
export const SIZE_KEYS = ['large', 'medium', 'small'];

// ---- 地圖幾何(緊湊節奏)----
export const MAPGEO = {
  // 主堡距離目標 ≈ 0.85 × 地圖對角線(> 題目要求的 80%)
  BASE_DIST_FRAC: 0.85,
  MIN_DIST_FRAC: 0.80,
  // 節奏簡化:兩堡距離 1500m × L(1 線 medium 遊戲邊長錨定 = 1.25km,見 SIZE_MULT)
  DIST_M_PER_LANE: 1500,
  TARGET_DIST_M: 3000,
  // 地圖尺寸(大/中/小):遊戲世界邊長倍率 = 邊長 km(1 線錨點:large 1.5 / medium 1.25 / small 1.0 km)。
  // sizeM = D/(BASE_DIST_FRAC×√2);medium@L1 = 1500/1.202 ≈ 1250m ⇒ 1.25km,大小依比例。
  SIZE_MULT: { large: 1.5, medium: 1.25, small: 1.0 },
  // 真實↔遊戲世界比例尺:真實地理距離 = 遊戲距離 × REAL_SCALE。
  // 改制:現實範圍再縮小 2 倍(0.5→0.25)→ 同一塊遊戲空間僅對應更小的真實範圍,地形/道路更密;
  // 因 llToWorld/llToMeters 同步 ×(1/REAL_SCALE),遊戲世界公尺與武器射程「完全不變」。
  REAL_SCALE: 0.25,
  // 尺度版本:改動比例尺 / 尺寸模型時 +1,用於偵測過期的「我的最愛」並重算(見 venues.js)
  GEO_SCALE_VER: 3,
  // 兵線選路坡度上限:真實道路沿線坡度超過此角度即淘汰(僅作用於真實 OSRM 路線)。
  // 註:30° ≈ 58% grade,真實道路幾乎不會達標 → 此濾網現實中極少觸發;
  //     若要濾「陡但仍常見」的路,改成 ~17(≈30% grade)。
  MAX_ROAD_GRADE_DEG: 30,
  // 三條兵線側向偏移(佔兩堡距離比例)
  LANE_OFFSET_FRAC: 0.30,
  // 路徑重合判定格 (m) 與允許重合率(1 - 80% 不重合)
  OVERLAP_CELL_M: 120,
  MAX_OVERLAP: 0.20,
  CANDIDATE_BEARINGS: 12,
  MAX_CANDIDATES: 4,
  // 路徑戰術指標(Diablo DRLG 思想:走廊要彎、要有轉角,拒絕一眼看穿的直線)——
  // 彎曲度 = 路長/兩端直線距;轉角 = 等距取樣後轉向 ≥ TURN_MIN_DEG 的取樣點
  // (轉角 = 伏擊點/掩體錨點/視線遮斷,伺服器障礙佈設與客戶端選路評分共用)。
  TACTICS: {
    SEG_M: 60,             // 轉角偵測等距取樣段長(重取樣,避免 OSRM 密集頂點灌水)
    TURN_MIN_DEG: 28,      // 視為戰術轉角的最小轉向角
    MIN_SINUOSITY: 1.12,   // 彎曲度低於此 = 太直,評分重扣(soft gate,仍可選)
    SINUOSITY_CAP: 1.9,    // 過度繞路不再加分(單程太久拖慢節奏)
    TURNS_PER_KM_CAP: 3,   // 轉角密度加分上限
    W_SINU: 0.45, W_TURN: 0.35, W_SEP: 0.20,   // 綜合評分權重:彎曲/轉角/兵線分離
  },
};

/**
 * 折線戰術幾何(公尺平面 [x,z] 陣列):彎曲度 + 轉角沿線距離清單。
 * 客戶端選路評分(mapSelect)與伺服器障礙佈設(sim._laneTurns)共用同一份判定。
 */
export function laneTacticsXZ(pts) {
  const T = MAPGEO.TACTICS;
  if (!pts || pts.length < 2) return { total: 0, straight: 1, sinuosity: 1, turns: [], turnsPerKm: 0 };
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const total = cum[cum.length - 1];
  const straight = Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) || 1;
  const at = (d) => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const f = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
  };
  const turns = [];
  const minRad = T.TURN_MIN_DEG * Math.PI / 180;
  let prevHead = null;
  for (let d = T.SEG_M; d <= total; d += T.SEG_M) {
    const p0 = at(d - T.SEG_M), p1 = at(d);
    const head = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    if (prevHead != null) {
      let dh = Math.abs(head - prevHead);
      if (dh > Math.PI) dh = Math.PI * 2 - dh;
      if (dh >= minRad) turns.push(d - T.SEG_M);
    }
    prevHead = head;
  }
  return { total, straight, sinuosity: total / straight, turns, turnsPerKm: turns.length / (total / 1000 || 1) };
}

/** 0~1 路徑戰術評分:太直重扣、過度繞路不加分、兵線越分離越好 */
export function tacticalScore(sinuosity, turnsPerKm, maxOverlap) {
  const T = MAPGEO.TACTICS;
  let sSinu = Math.max(0, Math.min(1, (sinuosity - 1) / (T.SINUOSITY_CAP - 1)));
  if (sinuosity < T.MIN_SINUOSITY) sSinu *= 0.35;
  const sTurn = Math.min(1, (turnsPerKm || 0) / T.TURNS_PER_KM_CAP);
  const sSep = 1 - Math.min(1, (maxOverlap || 0) / MAPGEO.MAX_OVERLAP);
  return T.W_SINU * sSinu + T.W_TURN * sTurn + T.W_SEP * sSep;
}

// ---- 目標類型(武器克制查表:單位種類 → 類別)----
export const TARGET_CLASS = {
  soldier: 'flesh', apc: 'armor', tank: 'armor', rocketeer: 'flesh', howitzer: 'armor', heli: 'air',
  robot: 'armor', drone: 'air', morph: 'armor', tower: 'building', base: 'building',
  // 中立可擊毀物(防空陣地 / 障礙物)吃反建築加成:攻城武器開路特別快
  aasite: 'building', construction: 'building', wreck: 'building',
  rockfall: 'building', fallentree: 'building',
};
export const CLASS_NAME = { flesh: '肉體', armor: '裝甲', air: '飛行', building: '建築' };

// ---- NPC 熱兵器(小兵/塔用;vs = 對目標類型加成,pen = 破甲值)----
// 英雄武器改住 CHARACTERS(每名角色專屬輕/重武器);bomb = 無人機自帶重型炸彈
// (F 鍵原地引爆或高速撞擊引爆,座機同歸於盡 → 無人機重生無冷卻)。
export const WEAPONS = {
  rgun:   { name: '重型機槍',   dmg: 26,  rate: 4.5, range: 220, mag: 48, reload: 2.2, pen: 0,  vs: { flesh: 1.3, armor: 1.0, air: 0.8, building: 0.6 } },
  rocket: { name: '肩射火箭',   dmg: 130, r: 20, rate: 1 / 6, range: 320, mag: 3, reload: 8, pen: 10, needAim: true, vs: { flesh: 1.0, armor: 1.5, air: 0.5, building: 1.3 } },
  bomb:   { name: '重型炸彈',   dmg: 240, r: 22, pen: 8, vs: { flesh: 1.5, armor: 1.2, air: 0.5, building: 1.5 } },
  siege:  { name: '攻城榴彈砲', dmg: 90,  rate: 1.2, range: 260, mag: 6,  reload: 3.5, pen: 14, needAim: true, vs: { flesh: 0.8, armor: 1.2, air: 0.4, building: 2.2 } },
};
export const vsMult = (wd, kind) => wd.vs?.[TARGET_CLASS[kind]] ?? 1;

// ---- 戰鬥核心公式(FPS × DOTA)----
// HEROIC:玩家(英雄)持有的武器 vs NPC 同型武器 → 射程 +20%、威力 +50%。
// VITALS:雙層 HP — 第一層護盾(非戰鬥 OOC_S 秒後自然回復,不吃護甲減免)、
//         第二層裝甲 HP(只能回主堡 / 治療招式回復,吃護甲值減免)。
// 護甲減免(DOTA 曲線):實效護甲 a = max(0, 護甲 − 破甲),減免 = a / (a + AR_K)。
// 爆擊(FPS):武器 crit 機率 × critX 倍率(未定義用 CRIT_X),僅直擊武器,AoE 不爆。
export const HEROIC = { range: 1.2, dmg: 1.5 };
// SQUAD:蜂群玩家同時操控 N 架無人機(主視野一架 + 僚機)。
// 單機 HP/傷害 = 機甲的 1/3,三機齊射 ≈ 一台機甲;死一架就少 1/3 戰力。
// 傷害折算住在 heroWeapon()(與 HEROIC 同一個縫),別在 sim/game 二次乘算。
// MORPH:傭兵變形機甲(單機;HP/火力與機甲完全相同)。
// 飛行型態「觸地」→ 變形為地面型;地面型態「蓄力跳躍」(按住 Space 蓄力後放開)→ 彈射升空變形為飛行型。
// 變形是客戶端物理(位置本就客戶端回報),伺服器一律以回報高度 y 判定型態:
// y≈0 = 地面型(會踩地雷)、y ≥ GAME.AA_MIN_ALT = 空中目標(吃塔 SAM / 防空伏擊)。
export const MORPH = {
  CHARGE_S: 1.1,     // 蓄力至滿所需秒數(蓄力中重心下沉 = 起跳預備動作)
  JUMP_MIN: 0.45,    // 低於此蓄力比例 = 普通小跳(不變形)
  JUMP_V: 30,        // 滿蓄力彈射初速(m/s;實際 = JUMP_V × 蓄力比例)
  LAND_M: 0.5,       // 飛行型離地 ≤ 此距離 → 觸地變形回地面型
  CROUCH_M: 1.4,     // 滿蓄力時機體下蹲幅度(公尺;FPV 鏡頭同步下沉)
  GROUND_Y: 2,       // 伺服器:y ≤ 此值視為地面型(踩雷判定)
};
export const SQUAD = {
  N: 3,
  DMG: 1 / 3,
  FORM_SIDE: 15,      // 僚機編隊橫向偏移(公尺)
  FORM_BACK: 10,      // 僚機編隊後方偏移
  REGROUP_M: 70,      // 離主視野超過此距離 → 先沿標準兵線路線歸隊
  REJOIN_F: 0.6,      // 縮短到 REGROUP_M × 此比例 → 解除歸隊、直接編隊
  LANE_SNAP_M: 25,    // 沿線推進的到位判定
  LANE_STEP_M: 80,    // 每次沿線推進的前瞻距離
  REGROUP_ALT: 30,    // 歸隊巡航高度(< AA_MIN_ALT,不被防空鎖定)
  REGROUP_MUL: 1.3,   // 歸隊加速
  DASH_MUL: 1.7,      // 自爆衝刺加速
  DASH_BOOM_M: 4,     // 衝刺引爆距離
  LOCK_TTL: 2.5,      // 準星鎖定有效秒數(過期即失去自爆衝刺目標)
};
export const VITALS = {
  OOC_S: 5,            // 脫戰秒數(這段時間沒受擊,護盾開始回復)
  SP_REGEN_PS: 0.20,   // 護盾每秒回復上限比例
  AR_K: 120,           // 護甲減免曲線常數
  CRIT_X: 1.6,         // 預設爆擊倍率
};
export const BALLISTIC = { G: 9.81 };   // 彈道重力(真實值;武器 mv = 初速 m/s)
export const armorMul = (ar, pen = 0) => {
  const a = Math.max(0, (ar || 0) - (pen || 0));
  return 1 - a / (a + VITALS.AR_K);
};

// ---- 招式養成(擊殺數解鎖 + 金錢購買;輕/重武器 Lv1 自帶,小招/大招要先解鎖)----
// kills/cost[i] = 升到 Lv(i+1) 的門檻;擊殺數 kn:小兵 1、坦克/直升機 2、塔 3、英雄 4。
export const PROG = {
  light: { name: '輕武器', kills: [0, 6, 15],  cost: [0, 250, 550] },
  heavy: { name: '重武器', kills: [0, 9, 20],  cost: [0, 300, 650] },
  skill: { name: '小招',   kills: [2, 12, 25], cost: [150, 400, 800] },
  ult:   { name: '大招',   kills: [6, 18, 32], cost: [400, 800, 1400] },
};
export const KILL_SCORE = { drone: 4, robot: 4, morph: 4, tower: 3, tank: 2, heli: 2 };
export const killScore = (kind) => KILL_SCORE[kind] ?? 1;

// 三階數值取值:陣列 = [Lv1, Lv2, Lv3];純量 = 各階相同
export const tierVal = (v, lvl = 1) =>
  Array.isArray(v) ? v[Math.max(0, Math.min(v.length - 1, lvl - 1))] : v;

/**
 * 解析角色武器(slot: 'light'|'heavy')在 lvl 階的實戰數值。
 * heroic=true 套用玩家英雄倍率(射程 ×1.2、傷害 ×1.5);false = NPC 基準值。
 * 重武器以 mag×reload 實作 CD:每發打完自動進入 cd 秒冷卻(HUD 顯示為冷卻)。
 * 無人機是三機小隊(SQUAD.N),單機傷害折成 1/3 — 這裡是唯一的折算點。
 */
export function heroWeapon(ch, slot, lvl = 1, heroic = true) {
  const w = CHARACTERS[ch]?.[slot];
  if (!w) return null;
  const t = (v) => tierVal(v, lvl);
  const squad = charKind(ch) === 'drone' ? SQUAD.DMG : 1;
  return {
    id: slot, name: w.name, rw: w.rw, type: w.type, mv: w.mv,
    dmg: t(w.dmg) * (heroic ? HEROIC.dmg : 1) * squad,
    range: w.range * (heroic ? HEROIC.range : 1),
    rate: w.rate ?? 3,
    mag: t(w.mag ?? 1),
    reload: t(w.cd ?? w.reload ?? 2),
    r: t(w.r), pen: t(w.pen ?? 0), crit: t(w.crit ?? 0), critX: w.critX ?? VITALS.CRIT_X,
    emp: t(w.emp ?? 0),
    needAim: slot === 'heavy' || !!w.needAim,
    vs: w.vs || {},
  };
}

/** 解析角色招式(slot: 'skill'|'ult')在 lvl 階的實戰數值 */
export function heroAbility(ch, slot, lvl = 1) {
  const a = CHARACTERS[ch]?.[slot];
  if (!a) return null;
  const t = (v) => tierVal(v, lvl);
  return {
    id: slot, name: a.name, fx: a.fx, desc: a.desc,
    cd: t(a.cd), mp: t(a.mp), dur: t(a.dur ?? 0), r: t(a.r ?? 0),
    dmg: t(a.dmg ?? 0), heal: t(a.heal ?? 0), count: t(a.count ?? 1),
    range: t(a.range ?? 0), imp: t(a.imp ?? 0), scatter: t(a.scatter ?? 0),
    unit: a.unit, target: a.target || 'self', sp: !!a.sp, vision: t(a.vision ?? 0),
    mul: a.mul ? Object.fromEntries(Object.entries(a.mul).map(([k, v]) => [k, t(v)])) : null,
    vs: a.vs || {},
    pen: t(a.pen ?? 0),
  };
}

/** 角色機體種類(不需要 side:傭兵自帶 kind,陣營角色由 side 決定)— heroWeapon 的折算依據 */
export const charKind = (ch) =>
  CHARACTERS[ch]?.kind || (CHARACTERS[ch]?.side === 'SWARM' ? 'drone' : 'robot');

// 陣營可選角色池:專屬角色 + 傭兵(side:'MERC',雙陣營皆可受雇)
export const charsOf = (side) => Object.keys(CHARACTERS)
  .filter((id) => CHARACTERS[id].side === side || CHARACTERS[id].side === 'MERC');

/** 角色機體種類:傭兵 kind 綁角色(無人機/機甲不隨陣營);陣營角色沿用 SIDES 預設 */
export const heroKindOf = (ch, side) => CHARACTERS[ch]?.kind || SIDES[side].hero;

// ---- 角色圖鑑(24 名陣營角色 + 8 名傭兵;劇情設定見 docs/characters.md)----
// 每名角色 = 專屬機體(蜂群=無人機、鋼鐵=機甲;傭兵 kind 自帶)+ 輕武器 + 重武器(CD)+ 小招 + 大招。
// 武器參考現實原型(rw 註明原型與初速);傷害/射程為 NPC 基準值,
// 玩家英雄實戰值 = 基準 × HEROIC(射程 1.2 / 威力 1.5),一律走 heroWeapon() 解析。
// mods:hp/sp/mp/speed 為倍率,armor 為護甲值(裝甲層減免用)。
// visual:程序生成機體外觀參數(hue 主色;無人機 frame/body、機甲 pod 掛件;
//         form:'beast'=獸型機甲、'avian'=飛行生物型無人機(creature 指定剪影);
//         傭兵 morph 用 flight(飛行型:jet 戰機/uav 固定翼無人機/bird 機械鳥/dragon 機械龍)
//         + ground(地面型:biped 人型機器人/beast 前肢著地機械獸)+ bulk 體格倍率 — 純外觀,不動數值)。
// fx 一覽:buff(增益)/ heal(維修)/ strike(打擊)/ summon(召喚)/ emp(癱瘓)
//          / vision(視野)/ stealth(匿蹤)/ dash(突進)/ intercept(攔截飛彈)。
export const CHARACTERS = {
  // ================= 蜂群陣營(無人機)=================
  s01: {
    side: 'SWARM', name: '卡特琳娜・薛甫琴科', code: '蜂后', machine: '「第聶伯總譜」指揮型六旋翼',
    visual: { hue: 0xffd257, frame: 'hexa', body: 'box', form: 'avian', creature: 'wasp' },
    mods: { hp: 1.0, sp: 1.15, mp: 1.15, speed: 0.95, armor: 6 },
    light: { name: '雙聯 5.56 機槍艙', rw: 'FN Minimi・初速 915m/s', type: 'gun', mv: 915,
      dmg: [12, 15, 18], rate: 10, mag: [40, 50, 60], reload: 2.0, range: 190, crit: 0.06,
      vs: { flesh: 1.2, armor: 0.6, air: 1.3, building: 0.5 } },
    heavy: { name: '70mm 火箭巢', rw: 'Hydra 70・初速 700m/s', type: 'launcher', mv: 700,
      dmg: [100, 135, 170], r: [12, 14, 16], cd: [8, 7, 6], range: 300, pen: 6,
      vs: { flesh: 1.1, armor: 1.4, air: 0.5, building: 1.2 } },
    skill: { name: '蜂群協奏', fx: 'buff', target: 'team', r: 180, mul: { dmg: [1.2, 1.28, 1.35] },
      dur: [6, 8, 10], cd: 20, mp: [35, 40, 45], desc: '指揮頻道開啟:半徑內友軍火力提升' },
    ult: { name: '總譜:終樂章', fx: 'summon', unit: 'heli', count: [2, 3, 4],
      cd: [80, 70, 60], mp: [80, 90, 100], desc: '呼叫攻擊直升機編隊沿最近兵線壓上' },
  },
  s02: {
    side: 'SWARM', name: '塔拉斯・邦達爾', code: '鐵匠', machine: '「鐵匠鋪」重載運翼機',
    visual: { hue: 0xc98a3d, frame: 'quad', body: 'slab' },
    mods: { hp: 1.2, sp: 0.9, mp: 0.9, speed: 0.85, armor: 12 },
    light: { name: '12.7 重機艙', rw: 'DShK・初速 850m/s', type: 'gun', mv: 850,
      dmg: [20, 25, 31], rate: 5, mag: [30, 36, 42], reload: 2.4, range: 200, crit: 0.05, pen: 6,
      vs: { flesh: 1.2, armor: 1.1, air: 0.9, building: 0.7 } },
    heavy: { name: '溫壓火箭', rw: 'TBG-7V・初速 120m/s', type: 'launcher', mv: 120,
      dmg: [150, 200, 250], r: [15, 17, 19], cd: [9, 8, 7], range: 260, pen: 15,
      vs: { flesh: 1.4, armor: 1.3, air: 0.4, building: 2.0 } },
    skill: { name: '野戰搶修', fx: 'heal', target: 'self', heal: [180, 260, 340],
      cd: [24, 21, 18], mp: [35, 40, 45], desc: '焊槍出手:立即修復自身裝甲' },
    ult: { name: '蜂巢再鑄', fx: 'heal', target: 'team', r: 200, heal: [220, 300, 380], sp: true,
      cd: [80, 70, 60], mp: [85, 95, 105], desc: '半徑內友軍裝甲大修,護盾同步充滿' },
  },
  s03: {
    side: 'SWARM', name: '林芷晴', code: 'Silicon', machine: '「跳頻蜂」電戰無人機',
    visual: { hue: 0x9ef2e6, frame: 'quad', body: 'wedge' },
    mods: { hp: 0.9, sp: 1.25, mp: 1.3, speed: 1.0, armor: 4 },
    light: { name: '5.8 機槍艙', rw: 'QJB-95 派生・初速 930m/s', type: 'gun', mv: 930,
      dmg: [13, 16, 20], rate: 9, mag: [36, 44, 52], reload: 1.9, range: 190, crit: 0.06,
      vs: { flesh: 1.2, armor: 0.7, air: 1.3, building: 0.5 } },
    heavy: { name: '高功率微波炮', rw: 'HPM 定向能・光速', type: 'beam',
      dmg: [70, 95, 120], cd: [6, 5.5, 5], range: 280, emp: [0.8, 1.0, 1.2],
      vs: { flesh: 0.7, armor: 0.8, air: 2.0, building: 0.4 } },
    skill: { name: '定向干擾', fx: 'emp', r: 120, dur: [2.5, 3, 3.5], range: 260,
      cd: [18, 16, 14], mp: [40, 45, 50], desc: '指定區域敵軍武器離線(建築免疫)' },
    ult: { name: '全頻壓制', fx: 'emp', r: 260, dur: [4, 5, 6],
      cd: [70, 62, 54], mp: [90, 100, 110], desc: '以自身為中心的大範圍電子壓制' },
  },
  s04: {
    side: 'SWARM', name: '樫村蒼真', code: 'Kashi', machine: '「鐵鍬」突擊四旋翼',
    visual: { hue: 0x8fd14f, frame: 'quad', body: 'box' },
    mods: { hp: 1.1, sp: 1.0, mp: 0.95, speed: 1.05, armor: 8 },
    light: { name: '戰鬥霰彈莢艙', rw: 'Benelli M4・初速 400m/s', type: 'gun', mv: 400,
      dmg: [34, 42, 52], rate: 2.2, mag: [7, 8, 10], reload: 2.6, range: 170, crit: 0.10, critX: 1.5,
      vs: { flesh: 1.6, armor: 0.5, air: 1.2, building: 0.4 } },
    heavy: { name: '榴彈拋射器', rw: 'M203・初速 76m/s', type: 'launcher', mv: 76,
      dmg: [110, 150, 190], r: [10, 12, 14], cd: [6, 5, 4], range: 240, pen: 8,
      vs: { flesh: 1.5, armor: 1.0, air: 0.5, building: 1.2 } },
    skill: { name: '突進機動', fx: 'dash', imp: [28, 34, 40],
      cd: [12, 10, 8], mp: [25, 30, 35], desc: '沿視線方向爆發加速(教官の鐵鍬距離)' },
    ult: { name: '白刃時刻', fx: 'buff', target: 'self', mul: { dmg: [1.4, 1.5, 1.6], dmgTaken: [0.85, 0.8, 0.75] },
      dur: [8, 10, 12], cd: [70, 60, 50], mp: [75, 85, 95], desc: '近接教官進入戰鬥反射狀態' },
  },
  s05: {
    side: 'SWARM', name: '河瑟琪', code: 'Overclock', machine: '「超頻」競速 FPV',
    visual: { hue: 0xff6fb0, frame: 'quad', body: 'wedge' },
    mods: { hp: 0.85, sp: 1.1, mp: 1.1, speed: 1.2, armor: 3 },
    light: { name: '微型旋轉機砲', rw: 'M134 7.62 縮裝・初速 840m/s', type: 'gun', mv: 840,
      dmg: [9, 11, 14], rate: [14, 16, 18], mag: [70, 90, 110], reload: 2.8, range: 180, crit: 0.05,
      vs: { flesh: 1.2, armor: 0.6, air: 1.4, building: 0.4 } },
    heavy: { name: '巡飛彈釋放器', rw: 'Lancet 縮裝・巡飛 90m/s', type: 'launcher', mv: 90,
      dmg: [160, 210, 260], r: [13, 15, 17], cd: [10, 9, 8], range: 320, pen: 12,
      vs: { flesh: 1.0, armor: 1.6, air: 0.6, building: 1.1 } },
    skill: { name: '超頻', fx: 'buff', target: 'self', mul: { dmg: [1.1, 1.15, 1.2], reload: [0.65, 0.6, 0.55] },
      dur: [6, 7, 8], cd: [18, 16, 14], mp: [30, 35, 40], desc: 'APM 全開:填彈大幅加速、火力小幅提升' },
    ult: { name: '蜂群風暴', fx: 'strike', count: [6, 8, 10], dmg: [70, 90, 110], r: 10, scatter: 30,
      range: 320, pen: 8, cd: [70, 62, 54], mp: [85, 95, 105], vs: { armor: 1.3, building: 1.1 },
      desc: '呼叫 FPV 蜂群對指定區域飽和俯衝' },
  },
  s06: {
    side: 'SWARM', name: '瑪雅・柯爾曼', code: '悼歌', machine: '「輓歌」攔截者',
    visual: { hue: 0xb9c7ff, frame: 'coax', body: 'sphere', form: 'avian', creature: 'raptor' },
    mods: { hp: 1.0, sp: 1.2, mp: 1.1, speed: 1.0, armor: 6 },
    light: { name: '精準標記步槍艙', rw: 'M110 SASS 7.62・初速 850m/s', type: 'gun', mv: 850,
      dmg: [24, 30, 37], rate: 3, mag: [15, 18, 21], reload: 2.2, range: 230, crit: 0.15, critX: 1.8,
      vs: { flesh: 1.2, armor: 0.8, air: 1.5, building: 0.5 } },
    heavy: { name: '微型攔截彈', rw: 'AIM-9X 縮裝・初速 1000m/s', type: 'gun', mv: 1000,
      dmg: [90, 120, 150], cd: [7, 6, 5], range: 340, pen: 6,
      vs: { flesh: 0.6, armor: 0.6, air: 2.5, building: 0.3 } },
    skill: { name: '攔截領域', fx: 'intercept', r: [150, 190, 230],
      cd: [16, 14, 12], mp: [30, 35, 40], desc: '擊落半徑內所有來襲飛彈(擋下的,不是打掉的)' },
    ult: { name: '空白布章', fx: 'buff', target: 'team', r: 220, mul: { dmgTaken: [0.6, 0.5, 0.4] },
      dur: [6, 7, 8], cd: [75, 65, 55], mp: [85, 95, 105], desc: '護航誓約:半徑內友軍承傷大減' },
  },
  s07: {
    side: 'SWARM', name: '埃坦・沙哈', code: '鐵數學', machine: '「證明完畢」防空平台',
    visual: { hue: 0x7fd8ff, frame: 'hexa', body: 'slab' },
    mods: { hp: 1.05, sp: 1.1, mp: 1.1, speed: 0.9, armor: 8 },
    light: { name: '25mm 空爆機砲', rw: 'XM25 派生・初速 760m/s', type: 'gun', mv: 760,
      dmg: [16, 20, 25], rate: 6, mag: [24, 30, 36], reload: 2.3, range: 210, crit: 0.06,
      vs: { flesh: 1.3, armor: 0.7, air: 1.6, building: 0.5 } },
    heavy: { name: '攔截飛彈連射', rw: 'Tamir 縮裝・初速 850m/s', type: 'launcher', mv: 850,
      dmg: [120, 160, 200], r: [12, 14, 16], cd: [8, 7, 6], range: 340, pen: 6,
      vs: { flesh: 0.8, armor: 0.9, air: 2.2, building: 0.8 } },
    skill: { name: '分配演算法', fx: 'intercept', r: [170, 210, 250],
      cd: [15, 13, 11], mp: [30, 35, 40], desc: '一道證明完畢:清空半徑內來襲飛彈' },
    ult: { name: '飽和反擊', fx: 'strike', count: [5, 7, 9], dmg: [80, 100, 125], r: 11, scatter: 35,
      range: 340, pen: 6, cd: [72, 64, 56], mp: [85, 95, 105], vs: { air: 1.5, armor: 1.1 },
      desc: '攔截網反向齊射:對指定空域/地面飽和打擊' },
  },
  s08: {
    side: 'SWARM', name: '佐菲亞・馬列克', code: '聖燭', machine: '「聖燭」醫療運補機',
    visual: { hue: 0xe8f0f4, frame: 'quad', body: 'sphere' },
    mods: { hp: 1.0, sp: 1.15, mp: 1.25, speed: 1.0, armor: 5 },
    light: { name: '護航機槍艙', rw: 'PKM 7.62・初速 825m/s', type: 'gun', mv: 825,
      dmg: [15, 19, 23], rate: 7, mag: [36, 44, 52], reload: 2.1, range: 190, crit: 0.06,
      vs: { flesh: 1.3, armor: 0.7, air: 1.1, building: 0.5 } },
    heavy: { name: '僚機狙擊莢艙', rw: 'M2010 .300WM・初速 880m/s', type: 'gun', mv: 880,
      dmg: [130, 170, 215], cd: [7, 6, 5], range: 360, crit: 0.25, critX: 2.0, pen: 10,
      vs: { flesh: 1.4, armor: 0.8, air: 1.4, building: 0.4 } },
    skill: { name: '血漿空投', fx: 'heal', target: 'team', r: 140, heal: [150, 210, 270],
      cd: [20, 18, 16], mp: [40, 45, 50], desc: '空中血庫開倉:半徑內友軍裝甲回復' },
    ult: { name: '修道院鐘聲', fx: 'heal', target: 'team', r: 240, heal: [280, 380, 480], sp: true,
      cd: [85, 75, 65], mp: [90, 100, 110], desc: '大範圍野戰醫療:裝甲大量回復、護盾充滿' },
  },
  s09: {
    side: 'SWARM', name: '艾德蒙・惠特洛克', code: '獵場主', machine: '「獵場看守人」雙管獵鷹',
    visual: { hue: 0x5a8a4a, frame: 'coax', body: 'box', form: 'avian', creature: 'falcon' },
    mods: { hp: 1.05, sp: 1.0, mp: 1.0, speed: 1.0, armor: 8 },
    light: { name: '雙管防空霰彈', rw: 'Purdey 12 鉛徑改・初速 420m/s', type: 'gun', mv: 420,
      dmg: [30, 38, 47], rate: 2.6, mag: [8, 10, 12], reload: 2.4, range: 170, crit: 0.10, critX: 1.5,
      vs: { flesh: 1.3, armor: 0.4, air: 2.0, building: 0.3 } },
    heavy: { name: '獵狐飛彈', rw: 'Starstreak 縮裝・初速 300m/s', type: 'launcher', mv: 300,
      dmg: [130, 170, 215], r: [13, 15, 17], cd: [8, 7, 6], range: 320, pen: 10,
      vs: { flesh: 0.9, armor: 1.2, air: 1.8, building: 0.8 } },
    skill: { name: '好球!', fx: 'buff', target: 'self', mul: { dmg: [1.3, 1.4, 1.5] },
      dur: 6, cd: [18, 16, 14], mp: [30, 35, 40], desc: '紳士的狩獵節奏:短時間火力全開' },
    ult: { name: '獵場封鎖', fx: 'strike', count: [8, 10, 12], dmg: [60, 75, 90], r: 9, scatter: 40,
      range: 300, cd: [70, 62, 54], mp: [80, 90, 100], vs: { air: 2.0, flesh: 1.2 },
      desc: '防空霰彈彈幕封鎖指定空域' },
  },
  s10: {
    side: 'SWARM', name: '卡佳・塔姆', code: '白噪音', machine: '「靜電」訊號機',
    visual: { hue: 0xd7b8ff, frame: 'quad', body: 'frame' },
    mods: { hp: 0.9, sp: 1.2, mp: 1.3, speed: 1.05, armor: 3 },
    light: { name: '消音衝鋒槍艙', rw: 'MP5SD 9mm・初速 285m/s', type: 'gun', mv: 285,
      dmg: [14, 17, 21], rate: 9, mag: [30, 36, 42], reload: 1.8, range: 170, crit: 0.08,
      vs: { flesh: 1.4, armor: 0.5, air: 1.1, building: 0.4 } },
    heavy: { name: '訊號矛', rw: 'EMP 狙擊彈・初速 900m/s', type: 'gun', mv: 900,
      dmg: [80, 105, 130], cd: [7, 6, 5], range: 340, emp: [1.5, 2, 2.5],
      vs: { flesh: 0.8, armor: 1.0, air: 1.8, building: 0.5 } },
    skill: { name: '頻譜側錄', fx: 'vision', vision: [6, 8, 10],
      cd: [26, 23, 20], mp: [35, 40, 45], desc: '破解敵方遙測:全隊限時無霧視野' },
    ult: { name: '拒絕服務', fx: 'emp', r: 300, dur: [4, 5, 6],
      cd: [75, 65, 55], mp: [90, 100, 110], desc: '大範圍鏈路壓制,聽起來就很假' },
  },
  s11: {
    side: 'SWARM', name: '維爾納・哈特曼', code: '鐘匠', machine: '「錶芯」精密工作機',
    visual: { hue: 0xd8c690, frame: 'hexa', body: 'frame' },
    mods: { hp: 1.0, sp: 1.05, mp: 1.05, speed: 0.95, armor: 8 },
    light: { name: '精密點放步槍', rw: 'HK417・初速 790m/s', type: 'gun', mv: 790,
      dmg: [22, 27, 33], rate: 3.5, mag: [20, 24, 28], reload: 2.1, range: 220, crit: 0.12, critX: 1.8, pen: 6,
      vs: { flesh: 1.1, armor: 1.3, air: 1.0, building: 0.6 } },
    heavy: { name: '關節破壞者', rw: '實驗性 EM 磁軌・初速 2000m/s', type: 'gun', mv: 2000,
      dmg: [170, 220, 275], cd: [9, 8, 7], range: 380, crit: 0.15, critX: 2.0, pen: [25, 30, 35],
      vs: { flesh: 0.8, armor: 2.2, air: 1.2, building: 0.7 } },
    skill: { name: '弱點解析', fx: 'buff', target: 'self', mul: { dmg: [1.35, 1.45, 1.55] },
      dur: [5, 6, 7], cd: [18, 16, 14], mp: [35, 40, 45], desc: '我造了那個膝蓋:短時間傷害大增' },
    ult: { name: '大修', fx: 'heal', target: 'self', heal: [400, 550, 700], sp: true,
      cd: [80, 70, 60], mp: [80, 90, 100], desc: '鐘錶匠的手:自身裝甲大修、護盾充滿' },
  },
  s12: {
    side: 'SWARM', name: '埃米爾・賽伊托夫', code: '歸鄉', machine: '「星圖」偵察機',
    visual: { hue: 0x9db8d8, frame: 'wing', body: 'wedge', form: 'avian', creature: 'swallow' },
    mods: { hp: 0.9, sp: 1.1, mp: 1.15, speed: 1.15, armor: 4 },
    light: { name: '偵察卡賓艙', rw: 'AKS-74U・初速 735m/s', type: 'gun', mv: 735,
      dmg: [14, 17, 21], rate: 8, mag: [30, 36, 42], reload: 1.9, range: 180, crit: 0.08,
      vs: { flesh: 1.3, armor: 0.6, air: 1.1, building: 0.4 } },
    heavy: { name: '標定打擊', rw: '呼叫 122mm 火箭彈著・落速 200m/s', type: 'launcher', mv: 200,
      dmg: [140, 180, 225], r: [14, 16, 18], cd: [9, 8, 7], range: 340, pen: 10,
      vs: { flesh: 1.1, armor: 1.1, air: 0.4, building: 1.5 } },
    skill: { name: '薰衣草斗篷', fx: 'stealth', dur: [4, 5, 6],
      cd: [20, 18, 16], mp: [35, 40, 45], desc: '從敵方感測網上消失(開火即現形)' },
    ult: { name: '滿天星座', fx: 'vision', vision: [10, 13, 16],
      cd: [70, 62, 54], mp: [80, 90, 100], desc: '衛星會被打下來,星星不會:全隊長時間無霧' },
  },

  // ================= 鋼鐵陣營(機甲)=================
  t01: {
    side: 'STEEL', name: '瓦列里・格羅莫夫', code: '冬將軍', machine: '「莫洛茲」指揮型重機甲',
    visual: { hue: 0xd6e4ef, pod: 'antenna' },
    mods: { hp: 1.15, sp: 1.0, mp: 1.1, speed: 0.9, armor: 22 },
    light: { name: '12.7 同軸重機槍', rw: 'Kord・初速 860m/s', type: 'gun', mv: 860,
      dmg: [22, 27, 33], rate: 4.5, mag: [40, 48, 56], reload: 2.4, range: 200, pen: 4,
      vs: { flesh: 1.3, armor: 1.0, air: 0.8, building: 0.6 } },
    heavy: { name: '152mm 榴彈砲', rw: '2A65 縮裝・初速 650m/s', type: 'launcher', mv: 650,
      dmg: [180, 240, 300], r: [16, 18, 20], cd: [10, 9, 8], range: 340, pen: 14,
      vs: { flesh: 1.1, armor: 1.3, air: 0.3, building: 1.8 } },
    skill: { name: '冬將軍號令', fx: 'buff', target: 'team', r: 200, mul: { dmg: [1.2, 1.3, 1.4] },
      dur: [6, 8, 10], cd: [22, 20, 18], mp: [35, 40, 45], desc: '我不再送沒有裝甲的孩子上戰場' },
    ult: { name: '雪崩齊射', fx: 'strike', count: [6, 8, 10], dmg: [90, 115, 140], r: 12, scatter: 40,
      range: 340, pen: 10, cd: [80, 70, 60], mp: [90, 100, 110], vs: { building: 1.4, armor: 1.2 },
      desc: '全營砲兵向指定座標行進間齊射' },
  },
  t02: {
    side: 'STEEL', name: '薇拉・佐洛塔列娃', code: '編號七', machine: '「加拉泰亞-7」神經同步機',
    visual: { hue: 0xcfd8ff, pod: 'blade' },
    mods: { hp: 0.9, sp: 1.3, mp: 1.2, speed: 1.15, armor: 14 },
    light: { name: '高斯衝鋒槍', rw: '實驗性 EM・初速 1100m/s', type: 'gun', mv: 1100,
      dmg: [15, 19, 23], rate: 8, mag: [32, 40, 48], reload: 1.9, range: 200, crit: 0.08,
      vs: { flesh: 1.2, armor: 0.9, air: 1.1, building: 0.5 } },
    heavy: { name: '同步狙擊砲', rw: 'EM 加速穿甲彈・初速 1500m/s', type: 'gun', mv: 1500,
      dmg: [150, 195, 245], cd: [8, 7, 6], range: 360, crit: 0.15, critX: 2.0, pen: [18, 22, 26],
      vs: { flesh: 1.0, armor: 1.8, air: 1.2, building: 0.6 } },
    skill: { name: '相位突進', fx: 'dash', imp: [26, 32, 38],
      cd: [12, 10, 8], mp: [25, 30, 35], desc: '同步率暴走:機體瞬間位移' },
    ult: { name: '同步率 100%', fx: 'buff', target: 'self',
      mul: { dmg: [1.35, 1.45, 1.55], dmgTaken: [0.75, 0.7, 0.65], reload: [0.75, 0.7, 0.65] },
      dur: [8, 10, 12], cd: [80, 70, 60], mp: [85, 95, 105], desc: '她與機體之間再沒有介面延遲' },
  },
  t03: {
    side: 'STEEL', name: '阿爾喬姆・薩維利耶夫', code: '大鍋', machine: '「大鍋」突擊機甲',
    visual: { hue: 0xe08a4a, pod: 'shield', form: 'beast', creature: 'bear' },
    mods: { hp: 1.3, sp: 0.85, mp: 0.9, speed: 0.95, armor: 26 },
    light: { name: '全自動霰彈', rw: 'Saiga-12 彈鼓・初速 400m/s', type: 'gun', mv: 400,
      dmg: [36, 45, 56], rate: 2.4, mag: [8, 10, 12], reload: 2.6, range: 170, crit: 0.10, critX: 1.5,
      vs: { flesh: 1.6, armor: 0.6, air: 0.9, building: 0.5 } },
    heavy: { name: '溫壓噴射', rw: 'TOS-1 縮裝・初速 150m/s', type: 'launcher', mv: 150,
      dmg: [170, 225, 280], r: [16, 18, 20], cd: [9, 8, 7], range: 240, pen: 12,
      vs: { flesh: 1.6, armor: 1.1, air: 0.3, building: 1.4 } },
    skill: { name: '鑄鐵鍋盾', fx: 'buff', target: 'self', mul: { dmgTaken: [0.55, 0.5, 0.45] },
      dur: [4, 5, 6], cd: [16, 14, 12], mp: [30, 35, 40], desc: '左臂鑄鐵鍋架起:承傷大減' },
    ult: { name: '開鍋!', fx: 'buff', target: 'self', mul: { dmg: [1.45, 1.55, 1.65], reload: [0.8, 0.75, 0.7] },
      dur: [8, 10, 12], cd: [75, 65, 55], mp: [80, 90, 100], desc: '懲戒營主廚火力全開' },
  },
  t04: {
    side: 'STEEL', name: '娜傑日達・奧爾洛娃', code: '灰雁', machine: '「灰雁」獵殺型',
    visual: { hue: 0x8a97a5, pod: 'rack', form: 'beast', creature: 'wolf' },
    mods: { hp: 0.95, sp: 1.1, mp: 1.1, speed: 1.1, armor: 16 },
    light: { name: '消音 DMR', rw: 'VSS Vintorez 9×39・初速 295m/s', type: 'gun', mv: 295,
      dmg: [24, 30, 37], rate: 3.2, mag: [20, 24, 28], reload: 2.0, range: 210, crit: 0.15, critX: 1.8,
      vs: { flesh: 1.4, armor: 0.8, air: 1.0, building: 0.5 } },
    heavy: { name: '14.5 反器材砲', rw: 'KPV・初速 1000m/s', type: 'gun', mv: 1000,
      dmg: [180, 235, 290], cd: [9, 8, 7], range: 380, crit: 0.20, critX: 2.0, pen: [20, 25, 30],
      vs: { flesh: 1.2, armor: 2.0, air: 1.5, building: 0.6 } },
    skill: { name: '灰色迷彩', fx: 'stealth', dur: [4, 5, 6],
      cd: [20, 18, 16], mp: [35, 40, 45], desc: '從所有感測器上消失(開火即現形)' },
    ult: { name: '獵殺名單', fx: 'buff', target: 'self', mul: { dmg: [1.3, 1.4, 1.5] }, vision: [8, 10, 12],
      dur: [8, 10, 12], cd: [75, 65, 55], mp: [85, 95, 105], desc: '名單下一行:全圖視野 + 火力提升' },
  },
  t05: {
    side: 'STEEL', name: '沈鶴鳴', code: '鶴', machine: '「仿生鶴」原型機',
    visual: { hue: 0xf2f2f2, pod: 'dish' },
    mods: { hp: 1.0, sp: 1.1, mp: 1.15, speed: 1.05, armor: 18 },
    light: { name: '5.8 車載機槍', rw: 'QJZ-89・初速 870m/s', type: 'gun', mv: 870,
      dmg: [16, 20, 25], rate: 7, mag: [36, 44, 52], reload: 2.1, range: 200, crit: 0.06,
      vs: { flesh: 1.3, armor: 0.8, air: 1.0, building: 0.5 } },
    heavy: { name: '膝上導彈', rw: '紅箭-12・初速 140m/s', type: 'launcher', mv: 140,
      dmg: [160, 210, 260], r: [13, 15, 17], cd: [9, 8, 7], range: 320, pen: [16, 20, 24],
      vs: { flesh: 0.9, armor: 1.8, air: 0.5, building: 1.1 } },
    skill: { name: '結構自檢', fx: 'heal', target: 'self', heal: [200, 280, 360],
      cd: [22, 19, 16], mp: [35, 40, 45], desc: '仿生關節自我修復(掉漆的才是我的)' },
    ult: { name: '量產線', fx: 'summon', unit: 'tank', count: [1, 2, 3],
      cd: [90, 80, 70], mp: [90, 100, 110], desc: '瀋陽重工加班:主戰坦克沿最近兵線出廠' },
  },
  t06: {
    side: 'STEEL', name: '陸小川', code: '小川', machine: '「輕功」高機動機甲',
    visual: { hue: 0xffb84d, pod: 'none' },
    mods: { hp: 0.95, sp: 1.05, mp: 1.0, speed: 1.2, armor: 14 },
    light: { name: '5.8 突擊步槍', rw: 'QBZ-191・初速 930m/s', type: 'gun', mv: 930,
      dmg: [13, 16, 20], rate: 9, mag: [34, 42, 50], reload: 1.8, range: 190, crit: 0.08,
      vs: { flesh: 1.3, armor: 0.7, air: 1.0, building: 0.5 } },
    heavy: { name: '鐵拳火箭', rw: 'PF-98・初速 250m/s', type: 'launcher', mv: 250,
      dmg: [140, 185, 230], r: [13, 15, 17], cd: [7, 6, 5], range: 300, pen: 14,
      vs: { flesh: 1.0, armor: 1.6, air: 0.4, building: 1.2 } },
    skill: { name: '麻辣走位', fx: 'dash', imp: [28, 34, 40],
      cd: [11, 9, 7], mp: [25, 30, 35], desc: '模擬器省冠軍的走位,機體像長在他身上' },
    ult: { name: '主角時刻', fx: 'buff', target: 'self', mul: { dmg: [1.4, 1.5, 1.6], dmgTaken: [0.8, 0.75, 0.7] },
      dur: [8, 10, 12], cd: [70, 60, 50], mp: [80, 90, 100], desc: '儲物櫃漫畫的主角上場了' },
  },
  t07: {
    side: 'STEEL', name: '李正赫', code: '無聲', machine: '「無聲」狙擊型',
    visual: { hue: 0x6d7a68, pod: 'rack', form: 'beast', creature: 'panther' },
    mods: { hp: 0.9, sp: 1.0, mp: 1.05, speed: 1.05, armor: 14 },
    light: { name: '消音卡賓', rw: '88 式縮裝・初速 720m/s', type: 'gun', mv: 720,
      dmg: [15, 19, 23], rate: 6, mag: [30, 36, 42], reload: 2.0, range: 190, crit: 0.10,
      vs: { flesh: 1.3, armor: 0.7, air: 1.0, building: 0.4 } },
    heavy: { name: '白頭山反器材', rw: '14.5mm 栓動・初速 1000m/s', type: 'gun', mv: 1000,
      dmg: [200, 260, 325], cd: [10, 9, 8], range: 400, crit: 0.25, critX: 2.2, pen: [18, 24, 30],
      vs: { flesh: 2.0, armor: 1.6, air: 1.2, building: 0.5 } },
    skill: { name: '靜默潛行', fx: 'stealth', dur: [5, 6, 7],
      cd: [20, 18, 16], mp: [35, 40, 45], desc: '動作省到一毫米都不多(開火即現形)' },
    ult: { name: '零點五度', fx: 'strike', count: 1, dmg: [400, 520, 650], r: 6,
      range: 400, pen: 20, cd: [70, 62, 54], mp: [80, 90, 100], vs: { flesh: 1.5, armor: 1.2 },
      desc: '一發,只需要一發' },
  },
  t08: {
    side: 'STEEL', name: '韓雪', code: '電波歌姬', machine: '「詠嘆調」電戰機甲',
    visual: { hue: 0xffc7dd, pod: 'dish' },
    mods: { hp: 0.9, sp: 1.25, mp: 1.3, speed: 1.0, armor: 12 },
    light: { name: '同軸機槍', rw: 'PKT・初速 825m/s', type: 'gun', mv: 825,
      dmg: [15, 19, 23], rate: 7, mag: [36, 44, 52], reload: 2.1, range: 190, crit: 0.06,
      vs: { flesh: 1.3, armor: 0.7, air: 1.0, building: 0.5 } },
    heavy: { name: '諧振波炮', rw: '定向聲電複合・光速', type: 'beam',
      dmg: [75, 100, 125], cd: [6, 5.5, 5], range: 300, emp: [1.0, 1.5, 2.0],
      vs: { flesh: 0.9, armor: 0.8, air: 1.8, building: 0.4 } },
    skill: { name: '搖籃曲', fx: 'emp', r: 140, dur: [2.5, 3, 3.5], range: 260,
      cd: [18, 16, 14], mp: [40, 45, 50], desc: '把你頻道撕碎的搖籃曲(區域武器離線)' },
    ult: { name: '詠嘆調', fx: 'emp', r: 280, dur: [4, 5, 6],
      cd: [72, 64, 56], mp: [90, 100, 110], desc: '絕對音感的全頻壓制' },
  },
  t09: {
    side: 'STEEL', name: '達留什・法拉赫扎德', code: '詩人', machine: '「悲歌」巡飛彈平台',
    visual: { hue: 0xc9b7e8, pod: 'rack' },
    mods: { hp: 1.05, sp: 1.0, mp: 1.15, speed: 0.9, armor: 16 },
    light: { name: '防衛機槍', rw: 'MG3 7.62・初速 820m/s', type: 'gun', mv: 820,
      dmg: [14, 18, 22], rate: 8, mag: [40, 48, 56], reload: 2.2, range: 190, crit: 0.06,
      vs: { flesh: 1.3, armor: 0.7, air: 1.0, building: 0.5 } },
    heavy: { name: '見證者巡飛彈', rw: 'Shahed 縮裝・巡飛 100m/s', type: 'launcher', mv: 100,
      dmg: [170, 225, 280], r: [15, 17, 19], cd: [10, 9, 8], range: 360, pen: 10,
      vs: { flesh: 1.1, armor: 1.3, air: 0.3, building: 1.6 } },
    skill: { name: '哀悼詩', fx: 'summon', unit: 'rocketeer', count: [2, 3, 4],
      cd: [26, 23, 20], mp: [40, 45, 50], desc: '為敵我雙方各寫一行:火箭兵支援' },
    ult: { name: '巡飛彈之雨', fx: 'strike', count: [7, 9, 11], dmg: [85, 105, 130], r: 11, scatter: 45,
      range: 360, pen: 8, cd: [80, 70, 60], mp: [90, 100, 110], vs: { building: 1.3, armor: 1.2 },
      desc: '讓戰爭打不完的東西,一次下完' },
  },
  t10: {
    side: 'STEEL', name: '蕾拉・侯賽尼', code: '軌跡', machine: '「軌跡」攔截機甲',
    visual: { hue: 0x7fe8c9, pod: 'twin' },
    mods: { hp: 1.0, sp: 1.15, mp: 1.2, speed: 1.0, armor: 16 },
    light: { name: '30mm 速射砲', rw: '2A42 縮裝・初速 960m/s', type: 'gun', mv: 960,
      dmg: [18, 22, 27], rate: 5.5, mag: [28, 34, 40], reload: 2.3, range: 210, pen: 6,
      vs: { flesh: 1.1, armor: 1.0, air: 1.5, building: 0.5 } },
    heavy: { name: '攔截者飛彈', rw: '9M330 縮裝・初速 800m/s', type: 'launcher', mv: 800,
      dmg: [120, 155, 195], r: [11, 13, 15], cd: [7, 6, 5], range: 340, pen: 6,
      vs: { flesh: 0.7, armor: 0.7, air: 2.4, building: 0.4 } },
    skill: { name: '彈道預解', fx: 'intercept', r: [160, 200, 240],
      cd: [15, 13, 11], mp: [30, 35, 40], desc: '攔截永遠該比打擊便宜:清空來襲飛彈' },
    ult: { name: '不可攔截區', fx: 'buff', target: 'team', r: 220, mul: { dmgTaken: [0.55, 0.45, 0.35] },
      dur: [6, 7, 8], cd: [80, 70, 60], mp: [90, 100, 110], desc: '頭巾內襯的那頁詩:友軍承傷大減' },
  },
  t11: {
    side: 'STEEL', name: '拉斐爾・富恩特斯', code: '老雪茄', machine: '「老兵」戰術指導機',
    visual: { hue: 0x8a9a5a, pod: 'antenna', form: 'beast', creature: 'rhino' },
    mods: { hp: 1.2, sp: 0.9, mp: 1.0, speed: 0.9, armor: 24 },
    light: { name: '車載重機槍', rw: 'DShKM・初速 850m/s', type: 'gun', mv: 850,
      dmg: [20, 25, 31], rate: 4.8, mag: [34, 40, 48], reload: 2.3, range: 200, pen: 4,
      vs: { flesh: 1.3, armor: 1.0, air: 0.8, building: 0.6 } },
    heavy: { name: '無後座砲', rw: 'SPG-9・初速 435m/s', type: 'launcher', mv: 435,
      dmg: [150, 195, 245], r: [13, 15, 17], cd: [8, 7, 6], range: 320, pen: 12,
      vs: { flesh: 1.0, armor: 1.5, air: 0.4, building: 1.3 } },
    skill: { name: '老兵的叮嚀', fx: 'buff', target: 'team', r: 160, mul: { dmgTaken: [0.7, 0.65, 0.6] },
      dur: [4, 5, 6], cd: [20, 18, 16], mp: [35, 40, 45], desc: '罐頭哪裡最薄,他都教過:友軍承傷降低' },
    ult: { name: '安哥拉支援', fx: 'summon', unit: 'squad', count: [4, 6, 8],
      cd: [85, 75, 65], mp: [85, 95, 105], desc: '老戰友聽得懂的黑話:步兵班沿最近兵線投入' },
  },
  t12: {
    side: 'STEEL', name: '阿列霞・卡爾波維奇', code: '螢火', machine: '「螢火」訊號掃描機',
    visual: { hue: 0xb8ffb0, pod: 'antenna' },
    mods: { hp: 0.9, sp: 1.15, mp: 1.3, speed: 1.05, armor: 12 },
    light: { name: '防衛衝鋒槍', rw: 'PP-19 9mm・初速 340m/s', type: 'gun', mv: 340,
      dmg: [13, 16, 20], rate: 10, mag: [40, 50, 60], reload: 1.8, range: 170, crit: 0.08,
      vs: { flesh: 1.3, armor: 0.5, air: 1.0, building: 0.4 } },
    heavy: { name: '標定脈衝砲', rw: 'EM 標定彈・初速 2500m/s', type: 'beam',
      dmg: [90, 120, 150], cd: [7, 6, 5], range: 340, emp: [0.8, 1.0, 1.2],
      vs: { flesh: 0.8, armor: 1.0, air: 1.6, building: 0.5 } },
    skill: { name: '螢火掃描', fx: 'vision', vision: [5, 7, 9],
      cd: [24, 21, 18], mp: [35, 40, 45], desc: '在頻譜裡找蜂群的心跳:全隊限時無霧' },
    ult: { name: '那也是一個人', fx: 'emp', r: 240, dur: [3, 4, 5], vision: [4, 5, 6],
      cd: [75, 65, 55], mp: [90, 100, 110], desc: '標記過的訊號全數靜默,並回傳位置' },
  },

  // ================= 傭兵(side:'MERC',雙陣營皆可受雇)=================
  // 傭兵一律駕駛「變形機甲」(kind:'morph'):HP/火力與機甲相同,
  // 飛行型觸地變形為地面型、地面型蓄力跳躍彈射變形為飛行型(見 MORPH/UNITS.morph)。
  // 無論受雇於蜂群或鋼鐵,機體/武器/招式/特長完全相同。
  m01: {
    side: 'MERC', kind: 'morph', name: '德揚・科瓦奇', code: '渡鴉', machine: '「渡鴉」可變式突襲機甲',
    visual: { hue: 0xd94f4f, pod: 'rack', flight: 'bird', ground: 'biped', bulk: 1.0 },
    mods: { hp: 1.0, sp: 1.05, mp: 1.0, speed: 1.1, armor: 7 },
    light: { name: '7.62 六管速射艙', rw: 'M134 Minigun・初速 850m/s', type: 'gun', mv: 850,
      dmg: [11, 14, 17], rate: 12, mag: [60, 75, 90], reload: 2.4, range: 185, crit: 0.05,
      vs: { flesh: 1.3, armor: 0.6, air: 1.3, building: 0.4 } },
    heavy: { name: '地獄火反裝甲彈', rw: 'AGM-114 縮裝・初速 450m/s', type: 'launcher', mv: 450,
      dmg: [150, 195, 245], r: [12, 14, 16], cd: [9, 8, 7], range: 320, pen: [14, 18, 22],
      vs: { flesh: 0.9, armor: 1.7, air: 0.5, building: 1.1 } },
    skill: { name: '違約金條款', fx: 'dash', imp: [27, 33, 39],
      cd: [12, 10, 8], mp: [25, 30, 35], desc: '哪邊付錢都一樣快:沿視線爆發脫離' },
    ult: { name: '加班費三倍', fx: 'buff', target: 'self', mul: { dmg: [1.35, 1.45, 1.55], reload: [0.8, 0.75, 0.7] },
      dur: [8, 10, 12], cd: [75, 65, 55], mp: [80, 90, 100], desc: '合約外時段:火力與填彈全面超載' },
  },
  m02: {
    side: 'MERC', kind: 'morph', name: '巴澤爾・奧坎', code: '磐石', machine: '「磐石」重型可變機甲',
    visual: { hue: 0x9aa3ad, pod: 'shield', flight: 'jet', ground: 'beast', bulk: 1.3 },
    mods: { hp: 1.25, sp: 0.9, mp: 0.95, speed: 0.9, armor: 24 },
    light: { name: '7.62 通用機槍', rw: 'FN MAG・初速 840m/s', type: 'gun', mv: 840,
      dmg: [16, 20, 25], rate: 7, mag: [40, 48, 56], reload: 2.2, range: 195, crit: 0.05,
      vs: { flesh: 1.3, armor: 0.8, air: 0.9, building: 0.5 } },
    heavy: { name: '105mm 低壓砲', rw: 'M68 縮裝・初速 500m/s', type: 'launcher', mv: 500,
      dmg: [170, 220, 275], r: [14, 16, 18], cd: [9, 8, 7], range: 320, pen: 12,
      vs: { flesh: 1.0, armor: 1.4, air: 0.3, building: 1.6 } },
    skill: { name: '掩體協議', fx: 'buff', target: 'self', mul: { dmgTaken: [0.6, 0.55, 0.5] },
      dur: [4, 5, 6], cd: [16, 14, 12], mp: [30, 35, 40], desc: '雇主的貨要緊:承傷大減' },
    ult: { name: '押運合約', fx: 'buff', target: 'team', r: 200, mul: { dmgTaken: [0.7, 0.62, 0.55] },
      dur: [6, 8, 10], cd: [80, 70, 60], mp: [85, 95, 105], desc: '這一單保到底:半徑內友軍承傷降低' },
  },
  m03: {
    side: 'MERC', kind: 'morph', name: '伊內絲・杜阿爾特', code: '帳房', machine: '「帳房」後勤可變機甲',
    visual: { hue: 0x59c9a5, pod: 'dish', flight: 'uav', ground: 'biped', bulk: 0.95 },
    mods: { hp: 0.95, sp: 1.15, mp: 1.2, speed: 1.0, armor: 5 },
    light: { name: '護衛衝鋒槍艙', rw: 'UMP45・初速 285m/s', type: 'gun', mv: 285,
      dmg: [15, 19, 23], rate: 8, mag: [30, 36, 42], reload: 1.9, range: 175, crit: 0.07,
      vs: { flesh: 1.4, armor: 0.5, air: 1.1, building: 0.4 } },
    heavy: { name: '空投截擊彈', rw: 'APKWS 導引・初速 700m/s', type: 'launcher', mv: 700,
      dmg: [120, 160, 200], r: [11, 13, 15], cd: [8, 7, 6], range: 300, pen: 8,
      vs: { flesh: 1.1, armor: 1.2, air: 1.2, building: 1.0 } },
    skill: { name: '戰地保單', fx: 'heal', target: 'team', r: 150, heal: [140, 200, 260],
      cd: [20, 18, 16], mp: [40, 45, 50], desc: '先修好再收錢:半徑內友軍裝甲回復' },
    ult: { name: '年度結算', fx: 'heal', target: 'team', r: 220, heal: [260, 350, 440], sp: true,
      cd: [85, 75, 65], mp: [90, 100, 110], desc: '大帳一次結清:裝甲大修、護盾充滿' },
  },
  m04: {
    side: 'MERC', kind: 'morph', name: '奧莉薇亞・松', code: '霧行者', machine: '「霧行者」偵獵可變機甲',
    visual: { hue: 0xb59ce8, pod: 'antenna', flight: 'bird', ground: 'beast', bulk: 0.85 },
    mods: { hp: 0.9, sp: 1.1, mp: 1.15, speed: 1.1, armor: 13 },
    light: { name: '消音戰鬥步槍', rw: 'HK G28・初速 780m/s', type: 'gun', mv: 780,
      dmg: [21, 26, 32], rate: 3.6, mag: [20, 24, 28], reload: 2.0, range: 215, crit: 0.14, critX: 1.8,
      vs: { flesh: 1.3, armor: 0.8, air: 1.1, building: 0.5 } },
    heavy: { name: '游騎反器材砲', rw: 'NTW-20・初速 900m/s', type: 'gun', mv: 900,
      dmg: [175, 230, 285], cd: [9, 8, 7], range: 380, crit: 0.18, critX: 2.0, pen: [18, 23, 28],
      vs: { flesh: 1.2, armor: 1.9, air: 1.3, building: 0.5 } },
    skill: { name: '匿名發包', fx: 'stealth', dur: [4, 5, 6],
      cd: [20, 18, 16], mp: [35, 40, 45], desc: '合約不留名:從感測網上消失(開火即現形)' },
    ult: { name: '全境盡職調查', fx: 'vision', vision: [9, 12, 15],
      cd: [72, 64, 56], mp: [85, 95, 105], desc: '受雇前先查清楚:全隊限時無霧視野' },
  },
  m05: {
    side: 'MERC', kind: 'morph', name: '瑪爾塔・韋恩', code: '清算', machine: '「清算日」電戰可變機甲',
    visual: { hue: 0xe0a13a, pod: 'antenna', flight: 'jet', ground: 'biped', bulk: 1.05 },
    mods: { hp: 1.1, sp: 1.0, mp: 1.15, speed: 0.95, armor: 16 },
    light: { name: '12.7 電磁機砲', rw: 'GAU-19・初速 900m/s', type: 'gun', mv: 900,
      dmg: [19, 24, 30], rate: 6, mag: [36, 44, 52], reload: 2.4, range: 200, crit: 0.06,
      vs: { flesh: 1.2, armor: 1.0, air: 0.9, building: 0.6 } },
    heavy: { name: '高爆穿甲榴彈', rw: 'PG-7VR 縮裝・初速 300m/s', type: 'launcher', mv: 300,
      dmg: [160, 205, 255], r: [13, 15, 17], cd: [9, 8, 7], range: 310, pen: [12, 15, 18],
      vs: { flesh: 1.0, armor: 1.5, air: 0.4, building: 1.4 } },
    skill: { name: '斷路協議', fx: 'emp', r: 130, dur: [2.5, 3, 3.5], range: 250,
      cd: [18, 16, 14], mp: [40, 45, 50], desc: '欠債不還就斷電:指定區域敵軍武器離線' },
    ult: { name: '連本帶利', fx: 'strike', count: [6, 8, 10], dmg: [80, 100, 125], r: 11, scatter: 38,
      range: 330, pen: 10, cd: [78, 68, 58], mp: [88, 98, 108], vs: { armor: 1.3, building: 1.2 },
      desc: '逾期利滾利:對指定座標飽和清算打擊' },
  },
  m06: {
    side: 'MERC', kind: 'morph', name: '圖里奧・費雷拉', code: '外包', machine: '「外包」母艦式可變機甲',
    visual: { hue: 0xf0c24a, pod: 'rack', flight: 'uav', ground: 'biped', bulk: 1.15 },
    mods: { hp: 1.0, sp: 1.1, mp: 1.25, speed: 1.0, armor: 6 },
    light: { name: '雙聯掛載機槍', rw: 'PKP 縮裝・初速 825m/s', type: 'gun', mv: 825,
      dmg: [13, 16, 20], rate: 9, mag: [45, 54, 63], reload: 2.2, range: 180, crit: 0.05,
      vs: { flesh: 1.3, armor: 0.6, air: 1.2, building: 0.5 } },
    heavy: { name: '集束子母彈', rw: 'CBU 縮裝・初速 400m/s', type: 'launcher', mv: 400,
      dmg: [130, 170, 215], r: [16, 18, 20], cd: [10, 9, 8], range: 300, pen: 6,
      vs: { flesh: 1.4, armor: 0.9, air: 0.5, building: 1.2 } },
    skill: { name: '轉分包', fx: 'summon', unit: 'rocketeer', count: [2, 3, 4],
      cd: [26, 23, 20], mp: [40, 45, 50], desc: '臨時轉包:火箭兵沿最近兵線加入' },
    ult: { name: '旺季擴編', fx: 'summon', unit: 'heli', count: [1, 2, 3],
      cd: [85, 75, 65], mp: [90, 100, 110], desc: '訂單爆量:攻擊直升機編隊壓上' },
  },
  m07: {
    side: 'MERC', kind: 'morph', name: '約蘭妲・里奧斯', code: '保全', machine: '「保全」區域拒止可變機甲',
    visual: { hue: 0x5fa8d3, pod: 'shield', flight: 'dragon', ground: 'beast', bulk: 1.25 },
    mods: { hp: 1.15, sp: 1.05, mp: 1.1, speed: 0.9, armor: 20 },
    light: { name: '雙 35 快砲', rw: 'Oerlikon 縮裝・初速 1100m/s', type: 'gun', mv: 1100,
      dmg: [18, 23, 28], rate: 6.5, mag: [32, 40, 48], reload: 2.6, range: 210, crit: 0.05,
      vs: { flesh: 1.0, armor: 0.9, air: 1.6, building: 0.5 } },
    heavy: { name: '近迫防禦彈幕', rw: 'Phalanx 縮裝・初速 1100m/s', type: 'gun', mv: 1100,
      dmg: [150, 195, 245], cd: [8, 7, 6], range: 340, pen: [10, 13, 16],
      vs: { flesh: 0.9, armor: 1.2, air: 2.0, building: 0.4 } },
    skill: { name: '拒止穹頂', fx: 'intercept', r: [160, 200, 240],
      cd: [16, 14, 12], mp: [30, 35, 40], desc: '一手交錢一手交貨:清空半徑內來襲飛彈' },
    ult: { name: '全域布防', fx: 'strike', count: [7, 9, 11], dmg: [65, 80, 100], r: 9, scatter: 40,
      range: 320, cd: [74, 66, 58], mp: [85, 95, 105], vs: { air: 2.0, flesh: 1.2 },
      desc: '把整片天空劃進責任區:防空彈幕封鎖' },
  },
  m08: {
    side: 'MERC', kind: 'morph', name: '芮娜・沃斯', code: '尾款', machine: '「尾款」隱形狙擊可變機甲',
    visual: { hue: 0x8f7fd0, pod: 'blade', flight: 'dragon', ground: 'biped', bulk: 0.85 },
    mods: { hp: 0.85, sp: 1.1, mp: 1.15, speed: 1.15, armor: 5 },
    light: { name: '消音精準艙', rw: 'VSS 縮裝・初速 295m/s', type: 'gun', mv: 295,
      dmg: [24, 30, 37], rate: 3.2, mag: [18, 22, 26], reload: 2.0, range: 200, crit: 0.16, critX: 1.9,
      vs: { flesh: 1.4, armor: 0.6, air: 1.0, building: 0.4 } },
    heavy: { name: '反器材長槍', rw: 'AMR 縮裝・初速 900m/s', type: 'gun', mv: 900,
      dmg: [190, 250, 315], cd: [10, 9, 8], range: 390, crit: 0.2, critX: 2.0, pen: [18, 23, 28],
      vs: { flesh: 1.3, armor: 1.7, air: 1.2, building: 0.5 } },
    skill: { name: '預付訂金', fx: 'dash', imp: [28, 34, 40],
      cd: [12, 10, 8], mp: [25, 30, 35], desc: '訂金到帳就位:沿視線瞬間位移' },
    ult: { name: '查無此人', fx: 'stealth', dur: [4, 5, 6],
      cd: [70, 62, 54], mp: [80, 90, 100], desc: '尾款結清便人間蒸發(開火即現形)' },
  },
};

// ---- 經濟(擊殺得錢 → 隨處升級 / 回主堡買熱兵器)----
export const ECON = {
  START: 200,
  INCOME_PER_S: 2,
  // 擊殺賞金:高價值單位報酬越高(missile = 擊落防空飛彈)
  BOUNTY: {
    soldier: 15, apc: 35, tank: 80, tower: 200, drone: 150, robot: 150, morph: 150, missile: 15, aasite: 40,
    rocketeer: 30, howitzer: 45, heli: 60,
  },
  UPGRADES: {
    dmg:  { name: '火力強化', desc: '所有武器傷害 +12%', max: 5, step: 0.12, base: 150, inc: 100 },
    hull: { name: '裝甲強化', desc: '座機血量上限 +12%', max: 5, step: 0.12, base: 150, inc: 100 },
  },
};
export const upgradePrice = (u, lvl) => u.base + u.inc * lvl;

// ---- 單位數值(armor = 護甲值,吃 armorMul 減免;英雄另有 shield/mp 基準)----
export const UNITS = {
  // 小兵(雙方都是人類部隊:士兵 / 裝甲車 / 坦克)
  soldier:   { name: '步槍兵', hp: 90,  armor: 0,  dmg: 10, range: 60,  rate: 1.0, speed: 8, sight: 150, bounty: 1, wid: 'rgun' },
  rocketeer: { name: '火箭兵', hp: 100, armor: 0,  dmg: 60, range: 130, rate: 0.4, speed: 7, sight: 160, bounty: 3, wid: 'rocket' },
  howitzer:  { name: '榴彈兵', hp: 130, armor: 6,  dmg: 70, range: 220, rate: 0.3, speed: 5, sight: 220, bounty: 4, wid: 'siege' },
  heli:      { name: '攻擊直升機', hp: 260, armor: 4, dmg: 35, range: 140, rate: 0.8, speed: 16, sight: 220, bounty: 6, wid: 'rgun' },
  // 舊兵種資料保留(不再於一般波次生成,供召喚/測試沿用)
  apc:     { name: '裝甲車', hp: 320,  armor: 10, dmg: 22, range: 100, rate: 0.9, speed: 11, sight: 170, bounty: 2, wid: 'rgun' },
  tank:    { name: '主戰坦克', hp: 750, armor: 22, dmg: 55, range: 150, rate: 0.6, speed: 9,  sight: 200, bounty: 4, wid: 'siege' },
  // 建築(防禦塔兼防空:對高空無人機發射追蹤飛彈;飛彈本身可被擊毀)
  tower:   { name: '防禦塔', hp: 1000, armor: 24, dmg: 65, range: 190, rate: 1.0, speed: 0,  sight: 190,
             sam: { name: '防空飛彈', dmg: 130, range: 240, cd: 4, speed: 120, hp: 40, pen: 8 } },
  base:    { name: '主堡',   hp: 3000, armor: 25, dmg: 90, range: 230, rate: 1.2, speed: 0,  sight: 230 },
  // 英雄基準(實戰值 × CHARACTERS[ch].mods):護盾 shield 非戰鬥自然回復、
  // 裝甲 hp 只能回主堡 / 治療招式回復;mp = 電力(施放小招/大招消耗)。
  // 無人機 = 三機小隊(SQUAD.N):單機 hp/shield = 機甲的 1/3,傷害折算在 heroWeapon()。
  // 每一架各自重生、各自吃冷卻(與機甲同表)。
  drone: {
    name: '獵蜂無人機', hp: 214, shield: 74, mp: 100, mpRegen: 4,
    speed: 42, vspeed: 22, fov: 100, zoomFov: 55, sight: 300,
    bomb: 'bomb',                        // F 鍵原地引爆 / 高速撞擊引爆(自毀);僚機衝刺自爆
    regen: 12,
    respawn: { base: 8, perDeath: 2 },   // 重生需冷卻,越死越久(單機獨立計數)
  },
  robot: {
    name: '執法者機甲', hp: 640, shield: 220, mp: 100, mpRegen: 4,
    speed: 21, jump: 9, fov: 72, zoomFov: 35, sight: 220,
    regen: 18,
    respawn: { base: 8, perDeath: 2 },   // 重生需冷卻,越死越久
  },
};
// 傭兵變形機甲:HP/護盾/電力/回復/重生一律與機甲相同(spread 保證不漂移),
// 差異只有移動能力(地面 + 蓄力跳變形飛行)與視野;傷害不吃 SQUAD 折算(charKind ≠ drone)。
UNITS.morph = {
  ...UNITS.robot,
  name: '變形機甲',
  fly: 36, vspeed: 20,                  // 飛行型態:巡航 / 垂直速度(略慢於無人機)
  fov: 76, fovAir: 96, zoomFov: 38, sight: 240,
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
  TOWER_FRACS: [0.22, 0.40],  // 防禦塔在兵線上的位置(距己方主堡比例)
  // 塔位橫向偏移(公尺):每個塔位在兵線左右各一座,砲塔不擋路、交叉火力涵蓋走廊
  TOWER_SIDE_OFF: 15,
  CREEP_AGGRO_HERO_BIAS: 0.7, // 小兵優先打小兵/建築,英雄目標權重
  HERO_HEAL_RADIUS: 160,      // 主堡補血半徑(也是軍械庫購物範圍)
  BASE_ARMOR_NEED_CREEP: 0.35,// 沒有己方小兵在場時打主堡的傷害折減
  AA_MIN_ALT: 40,             // 兵線走廊上:防空飛彈只鎖定離地 ≥ 40m 的無人機(低飛吃塔砲)
  LANE_SAFE_M: 45,            // 正規路線走廊半寬;出了走廊 = 非正規路線(地雷 / 防空伏擊)
  // 地雷(非正規路線,只有地面機甲會踩;顏色融入地表,靠近才看得到極輕微突起)
  // CUT_BIAS/CUT_R:偏向佈在兵線轉角外圍的「切彎捷徑」帶 — 抄直線省時間 = 承擔雷區風險
  MINES: { PER_LANE: 25, TRIGGER_R: 4, DMG: 170, R: 10, PEN: 10, LANE_CLEAR: 40, BASE_CLEAR: 150,
           SEE_M: 30, CLEAR_M: 14,     // 客戶端:SEE_M 內開始浮現,CLEAR_M 內完全可見
           CUT_BIAS: 0.5, CUT_R: 70 },
  // 匿蹤防空伏擊(非正規路線的無人機):命中直接擊墜;飛彈可被擊毀。
  // 觸發需要射程內有存活的匿蹤防空陣地(aasite)——拔掉陣地 = 打出安全空域。
  // DMG 620:雙層 HP 後仍須一發穿透護盾+裝甲直接擊墜(維持「命中即墜」設計)。
  AA_AMBUSH: { CHANCE_PER_S: 0.22, CD_S: 7, DMG: 620, SPEED: 130, HP: 40, PEN: 20 },
};

// ---- 地形呈現(解析度 + 主要道路外海拔放大)----
// GRID_N/ELEV_ZOOM 純渲染;AMP_* 會改 heightAt(單位貼地)故列為平衡值住這裡。
export const TERRAIN = {
  GRID_N: 193,        // 地形頂點解析度(129→193;純幾何,便宜)
  ELEV_ZOOM: 13,      // 高程磚 zoom(真實範圍已縮半,可提高一級;磚數仍在 buildTerrain 守衛內)
  AMP: 0.9,           // 主要道路(兵線)以外:相對全場均值的海拔偏差放大係數
  AMP_R0: 45,         // 距兵線 ≤ R0(= LANE_SAFE_M 走廊):完全不放大,保留真實可行駛
  AMP_R1: 260,        // 距兵線 ≥ R1:完全放大
};

// ---- 危險區:非圖資障礙物(Diablo 核心思想:迷宮式隨機佈局 + 隨機物品掉落)----
// 生成在空白區 / 非主要路徑與主要路徑邊緣:限制行動但不完全封鎖——
// 阻擋型障礙以「短牆 + 保證縫隙」佈局(FIELD.HAZ_GAP),同時提供隱蔽與戰略通道;
// 有 hp 的可擊毀(= 自行開路),掉落隨機物資。分布依場地地貌 mix(biome)加權。
// r: 影響半徑(m,乘實例 sc);block: 阻擋地面單位;slow: 地面速度倍率;
// dot: 每秒灼傷(y < maxY 才吃);salvage: 擊毀後掉物資機率;
// hgt: 碰撞高度(m,未填 = 6)— 神木/巨石比現實更高大,低飛也撞得到。
export const HAZARDS = {
  construction: { name: '施工圍籬',   biome: 'urban', r: 8,   block: true, hp: 240, salvage: 0.6 },
  wreck:        { name: '車禍殘骸',   biome: 'urban', r: 5.5, block: true, hp: 180, salvage: 0.7 },
  fire:         { name: '火場',       biome: 'urban', r: 12,  dot: 30, maxY: 24 },
  sinkhole:     { name: '路面塌陷',   biome: 'urban', r: 7,   block: true },
  pothole:      { name: '坑洞',       biome: 'urban', r: 4,   slow: 0.55 },
  flood:        { name: '淹水區',     biome: 'wet',   r: 20,  slow: 0.45 },
  landslide:    { name: '坍方土石流', biome: 'bare',  r: 13,  block: true },
  rockfall:     { name: '落石',       biome: 'bare',  r: 6.5, block: true, hp: 300, salvage: 0.65 },
  fallentree:   { name: '倒木',       biome: 'green', r: 7,   block: true, hp: 130, salvage: 0.5 },
  // 超尺度地標型障礙(比現實高大):遮視線 + 立體掩體;高 HP → TC 掉落更高階
  sacredtree:   { name: '神木',       biome: 'green', r: 9,   block: true, hp: 520, salvage: 0.75, hgt: 26 },
  boulder:      { name: '巨石',       biome: 'bare',  r: 8,   block: true, hp: 420, salvage: 0.7,  hgt: 13 },
};

// ---- 危險區生成參數(伺服器 sim._seedField)----
export const FIELD = {
  HAZ_PER_LANE: 24,      // 障礙物目標數 / 兵線(神木/巨石加入後整體加密;HAZ_GAP 仍保證縫隙)
  HAZ_LANE_MIN: 20,      // 距兵線中心線最小距離(走廊半寬 14m + 邊緣帶,不擋正規路線)
  HAZ_LANE_MAX: 300,     // 最遠分布(涵蓋空白區)
  HAZ_EDGE_BIAS: 1.8,    // 越靠走廊邊緣越密(rnd^bias):主要路徑邊緣的戰略隱蔽
  HAZ_GAP: 30,           // 「牆段」彼此最小間距 = 保證通行縫隙(> 4 台機甲並行)
  HAZ_BASE_CLEAR: 170,   // 主堡淨空
  CLUSTER_MAX: 3,        // 同型障礙連成短牆(Diablo 迷宮牆 + 門的手感)
  TURN_BIAS: 0.55,       // 障礙/防空陣地錨定在兵線轉角的比例(Diablo:轉角 = 房間/伏擊點)
  TURN_R: 90,            // 轉角錨定的沿線散布半徑(m)
  MID_BIAS: 0.5,         // 難度梯度(D1 越深越難):均勻散布中此比例改用三角分布向兵線中段聚攏
  AA_SITES_PER_LANE: 3,  // 匿蹤防空陣地 / 兵線
  AA_SITE: { name: '匿蹤防空陣地', hp: 120, range: 260, laneMin: 60, laneMax: 240, spacing: 130 },
  // 偵察中繼站(D1 神龕思想:非正規路線上的一次性正向誘因)——
  // 停留 CHANNEL_S 秒佔用 → 全隊 VISION_S 秒無霧視野;先到先得,用過即毀。
  RELAY: { name: '偵察中繼站', PER_LANE: 1, R: 14, CHANNEL_S: 3, VISION_S: 18,
           laneMin: 70, laneMax: 220, dLo: 0.38, dHi: 0.62 },
  CONNECT_CELL_M: 24,    // 連通性 flood-fill 網格(DevilutionX DRLG 思想:生成後驗證兩堡互通)
};

// ---- 戰場物資(Diablo 式隨機掉落:擊毀障礙物有機率掉,靠近拾取)----
// TIERS 依序 = 普通 → 稀有;TC(TreasureClass,D2 思想)= 越硬的障礙掉越高階:
// 擲骰時加上 (障礙 maxHp / HP_REF) × SHIFT 的稀有度偏移,拆牆變成投資報酬計算。
export const LOOT = {
  PICK_R: 8, MAX_Y: 25, TTL_S: 90,
  TIERS: [
    { p: 0.48, min: 15, max: 40 },    // 普通:小額現金
    { p: 0.25, min: 45, max: 95 },    // 高級:大額現金
    { p: 0.15, ammo: true },          // 稀有:全武器彈藥即刻補滿
    { p: 0.12, affix: true },         // 傳奇:隨機詞綴強化(限時 buff)
  ],
  TC: { HP_REF: 300, SHIFT: 0.35 },
};

// ---- 詞綴強化(D2 prefix/suffix 思想:拾取後限時生效,全部伺服器結算)----
// reload/dmgTaken = 乘數;killHeal = 擊殺回復上限血量比例;bounty = 賞金乘數。
export const AFFIXES = {
  tempered: { name: '淬火軍械', desc: '填彈時間 −35%',        dur: 45, reload: 0.65 },
  hardened: { name: '複合裝甲', desc: '受到傷害 −25%',        dur: 30, dmgTaken: 0.75 },
  vampiric: { name: '汲能核心', desc: '擊殺回復 15% 上限血量', dur: 45, killHeal: 0.15 },
  bounty:   { name: '懸賞頻道', desc: '擊殺賞金 +50%',        dur: 45, bounty: 1.5 },
};

// ---- 電腦玩家(單人練習 / 補位)----
export const BOT_NAMES = ['天網-01', '刺針-02', '寒鴉-03', '掠奪者-04', '哨兵-05', '幽靈-06', '雷霆-07', '毒蛛-08'];
export const isBotId = (id) => typeof id === 'string' && id.startsWith('b');

// ---- 電腦玩家難度(整房一個難度,房主於房間設定)----
// aimErr:每發輕/重武器「射偏」機率(命中結算前擲骰,越高越常打空 → 瞄準越差)。
// heavy:是否使用重武器;ability:是否施放招式。新手只用輕武器,低難度不用招式。
// 消費(sim.buy)亦依此裁剪:不用招式者不解鎖招式,把錢投在武器/強化。
export const BOT_DIFF = {
  novice: { key: 'novice', name: '新手', aimErr: 0.55, heavy: false, ability: false },
  low:    { key: 'low',    name: '低',   aimErr: 0.35, heavy: true,  ability: false },
  medium: { key: 'medium', name: '中',   aimErr: 0.15, heavy: true,  ability: true },
  high:   { key: 'high',   name: '高',   aimErr: 0.0,  heavy: true,  ability: true },
};
export const BOT_DIFF_KEYS = ['novice', 'low', 'medium', 'high'];
export const DEFAULT_BOT_DIFF = 'medium';
export const botDiffOf = (key) => BOT_DIFF[key] || BOT_DIFF[DEFAULT_BOT_DIFF];

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
