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
// 地圖大小「綁定人數」:真實世界邊長 = 0.3 + 0.1×L km(L1/L2/L3 = 0.4/0.5/0.6 km),
// 不再有大/中/小尺寸選項。
export const TEAM = { MIN: 1, MAX: 5, DEFAULT: 5 };
export const lanesFor = (n) => Math.ceil(n / 2);
// 地圖「真實世界」邊長 (m)
export const realSideMFor = (L) => (MAPGEO.REAL_SIDE_BASE_KM + MAPGEO.REAL_SIDE_PER_LANE_KM * L) * 1000;
// 地圖「遊戲世界」邊長 (m) = 真實 ÷ REAL_SCALE;兩堡目標距離 = 邊長 × 0.85 × √2
export const sideMFor = (L) => realSideMFor(L) / MAPGEO.REAL_SCALE;
export const targetDistFor = (L) => sideMFor(L) * MAPGEO.BASE_DIST_FRAC * Math.SQRT2;
// 兩堡「真實世界」距離 (m)
export const realDistFor = (L) => targetDistFor(L) * MAPGEO.REAL_SCALE;
/** 重合率判定網格邊長 (m,真實世界):與兩堡真實距離等比,見 MAPGEO.OVERLAP_CELL_FRAC */
export const overlapCellM = (L) =>
  Math.max(MAPGEO.OVERLAP_CELL_MIN_M, realDistFor(L) * MAPGEO.OVERLAP_CELL_FRAC);

// ---- 地圖幾何(緊湊節奏)----
export const MAPGEO = {
  // 主堡距離目標 ≈ 0.85 × 地圖對角線(> 題目要求的 80%)
  BASE_DIST_FRAC: 0.85,
  MIN_DIST_FRAC: 0.80,
  // 地圖真實世界邊長 = BASE + PER_LANE × L (km) = 0.3 + 0.1×L(L1/L2/L3 = 0.4/0.5/0.6 km)。
  // 大小只綁人數。兩堡真實距離 = 邊長 × 0.85 × √2 = 0.48/0.60/0.72 km,
  // 全部落在市區導航路網走得出來的尺度內(兵線 MUST 與現實導航路線相符,見 venues.js LANES)。
  REAL_SIDE_BASE_KM: 0.3,
  REAL_SIDE_PER_LANE_KM: 0.1,
  // 真實↔遊戲世界比例尺:真實地理距離 = 遊戲距離 × REAL_SCALE。
  // 改制 2026-07-10(三):REAL_SCALE 0.5 —— 遊戲世界 = 真實世界 ×2(遊戲空間放大兩倍)。
  //   沿革:0.125(放大 8×,街廓成荒野)→ 1(1:1,戰場太緊湊、武器相對射程過長)
  //         → 0.5(1:2:兵線走廊拉開一倍,武器/視野的「遊戲公尺」值不動 ⇒ 相對射程減半)。
  // 為何動 REAL_SCALE 而非放大真實邊長:realDistFor 與 REAL_SCALE 無關(公式裡相消),
  //   ⇒ OSM 查詢半徑不變、venueLanes.js 的真實道路兵線原封不動有效,重烤純離線(見 venues.js)。
  //   放大真實邊長則需以 2× 半徑重抓 Overpass(改選不同的真實道路),非必要且依賴網路。
  // 武器射程/移動速度/視野等遊戲公尺數值不隨尺度改動(見 #INC-104)。
  REAL_SCALE: 0.5,
  // 尺度版本:改動比例尺 / 尺寸模型時 +1,用於偵測過期的「我的最愛」並重算(見 venues.js)
  // ver5:邊長公式改 0.3 + 0.1×L,且預設場地兵線改用真實 OSRM 導航路線
  // ver6:REAL_SCALE 0.125 → 1(遊戲世界 = 真實世界 1:1)
  // ver7:REAL_SCALE 1 → 0.5(遊戲空間放大 2×,真實道路兵線不變)
  GEO_SCALE_VER: 7,
  // 兵線選路坡度上限:真實道路沿線坡度超過此角度即淘汰(僅作用於真實 OSRM 路線)。
  // 16° ≈ 29% grade,會濾掉「陡但仍存在」的山路。
  MAX_ROAD_GRADE_DEG: 16,
  // 三條兵線側向偏移(佔兩堡距離比例)
  LANE_OFFSET_FRAC: 0.30,
  // 路徑重合判定格與允許重合率(1 - 80% 不重合)。**規則本身不變**:任兩條兵線重合率 < MAX_OVERLAP。
  // 判定網格是「量測解析度」,MUST 隨地圖尺度等比縮放(舊制 120m 是照 L3 兩堡真實距離 1082m 校準的)。
  //
  // FRAC 的下限公式(2026-07-10 實測導出):三條兵線必然共用「含 A 的格」與「含 B 的格」,
  // 而每條線約佔 N = 1.2/FRAC 格 ⇒ 重合率下限 = 2/N = 2×FRAC/1.2,**與地圖大小無關**。
  //   FRAC 0.111(照舊制等比)→ 下限 0.185,離門檻 0.20 僅 0.015 餘裕 → 六大城市只有 3 個
  //                             能湊出三條真實道路兵線,且兩個正好卡在 0.200。
  //   FRAC 0.060            → 下限 0.100,六城市 6/6 通過(現值)。
  // 0.06 另有物理意義:L3 格寬 43m 真實 = 346 遊戲公尺 > 英雄武器射程上限(~300),
  // 即「不同格 = 互相打不到 = 真的是不同兵線」。調小 MAX_OVERLAP 或調大 FRAC 前 MUST 重跑 bake2/3。
  OVERLAP_CELL_FRAC: 0.06,         // L1/L2/L3 → 29/36/43m
  OVERLAP_CELL_MIN_M: 24,
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

// ---- 戰場涵蓋範圍(地形 bbox)----
// 兵線/主堡與地圖邊界(空氣牆)之間的保證淨空(遊戲公尺)。真實道路兵線會蜿蜒到
// 對稱方框之外,若只給百分比 pad,最外側兵線頂點會貼著內縮 40m 的空氣牆(玩家沿線飛就撞牆)。
export const ROUTE_EDGE_MARGIN_M = 160;

/**
 * 依戰場設定算出地形涵蓋範圍(路線包絡外擴 ∪ 對稱方框,再 pad 5%)。
 * 幾何真相只有一份:客戶端地形(terrain.js buildTerrain)與伺服器中立物散布
 * (sim.js 障礙/防空/中繼站的越界判定)共用 —— 伺服器沒有地形網格,
 * 但用同一個 bbox 就能保證中立物不落在地形外(HAZ_LANE_MAX 300 > 邊距 160)。
 */
export function battleBBox(cfg) {
  const R_EARTH = 6371000;
  const d2r = (d) => d * Math.PI / 180;
  // 1) 路線包絡(主堡 + 全兵線頂點),外擴 ROUTE_EDGE_MARGIN_M(換算真實公尺 → 度)
  const mReal = ROUTE_EDGE_MARGIN_M * MAPGEO.REAL_SCALE;
  const mLat = mReal / R_EARTH * 180 / Math.PI;
  const mLng = mReal / (R_EARTH * Math.cos(d2r(cfg.center.lat))) * 180 / Math.PI;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [la, ln] of [cfg.bases.SWARM, cfg.bases.STEEL, ...cfg.lanes.flat()]) {
    if (la < minLat) minLat = la;
    if (la > maxLat) maxLat = la;
    if (ln < minLng) minLng = ln;
    if (ln > maxLng) maxLng = ln;
  }
  minLat -= mLat; maxLat += mLat; minLng -= mLng; maxLng += mLng;

  // 2) 與對稱方框(center ± 半邊長)取聯集,保證即使兵線很短也維持基本地圖尺寸
  const half = cfg.sizeM / 2 * MAPGEO.REAL_SCALE;   // 遊戲邊長 → 真實半徑
  const dLat = half / R_EARTH * 180 / Math.PI;
  const dLng = half / (R_EARTH * Math.cos(d2r(cfg.center.lat))) * 180 / Math.PI;
  minLat = Math.min(minLat, cfg.center.lat - dLat);
  maxLat = Math.max(maxLat, cfg.center.lat + dLat);
  minLng = Math.min(minLng, cfg.center.lng - dLng);
  maxLng = Math.max(maxLng, cfg.center.lng + dLng);

  const padLat = (maxLat - minLat) * 0.05, padLng = (maxLng - minLng) * 0.05;
  return { minLat: minLat - padLat, maxLat: maxLat + padLat, minLng: minLng - padLng, maxLng: maxLng + padLng };
}

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
  robot: 'armor', drone: 'air', morph: 'armor', decoy: 'air', tower: 'building', base: 'building',
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
// 單機 HP/傷害 = 機甲的 1/N 再 ×BUFF(2026-07-10:單機強化 +50%)→ 三機齊射 ≈ 1.5 台機甲。
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
  // 單機強化倍率(HP / 傷害);UNITS.drone.hp/shield 與 DMG 都由它推導。
  // 1.05(2026-07-13,舊值 1.5):三機隊單挑一波 NPC 後也剩 ~40% EHP(與機甲同標準)。
  // 損血比例 ∝ 1/BUFF²(EHP 與 DPS 同時 ×BUFF ⇒ 清波時間 ÷BUFF、承傷 ÷BUFF²)——
  // 1.5 時三機隊只掉 ~30%,遠比機甲耐打。⇒ 三機齊射 ≈ 一台機甲、三機總 EHP ≈ 一台機甲。
  BUFF: 1.05,
  DMG: 1.05 / 3,      // = BUFF / N
  FORM_SIDE: 15,      // 僚機編隊橫向偏移(公尺)
  FORM_BACK: 10,      // 僚機編隊後方偏移
  REGROUP_M: 70,      // 離主視野超過此距離 → 先沿標準兵線路線歸隊
  REJOIN_F: 0.6,      // 縮短到 REGROUP_M × 此比例 → 解除歸隊、直接編隊
  LANE_SNAP_M: 25,    // 沿線推進的到位判定
  LANE_STEP_M: 80,    // 每次沿線推進的前瞻距離
  REGROUP_ALT: 30,    // 歸隊巡航高度(< AA_MIN_ALT,不被防空鎖定)
  REGROUP_MUL: 1.3,   // 歸隊加速
  DASH_MUL: 3,        // 自爆衝刺加速(三倍速撲擊)
  DASH_BOOM_M: 4,     // 衝刺引爆距離
};

// ---- 準星鎖定(全機種通用;2026-07-10 起不再只是無人機自爆衝刺的目標)----
// 客戶端把「射程內 + 準星對準」的敵方單位回報伺服器;伺服器複驗距離後廣播 lock 事件:
//   施放者 → 目標身上浮現光暈;目標本人 → HUD 被鎖定警告。
// 無人機另外沿用它當自爆衝刺目標。
export const LOCK = { TTL: 2.5, WARN_S: 1.6 };

// ---- 餌機(機甲外掛的可分離子機;對應無人機的 F 鍵自爆)----
// 平時組合在主機甲掛點上。F 分離發射,航向鎖定發射瞬間的機首朝向 —— 玩家無法操舵。
// 準星有鎖定目標(LOCK.TTL 內)才會追蹤,否則直飛到燃料耗盡自爆。
// 飛行中經 PiP 小視窗回傳畫面與視野;超過 LINK_M 即失聯(斷訊、不再回傳視野),
// 機體仍直飛到 TTL_S 自爆。可被擊落 —— 這就是「餌」:替主機甲吸走火力。
export const DECOY = {
  HP_F: 0.25,       // 生命值 = 主機甲裝甲上限的 1/4
  SPEED: 62,
  TURN: 2.0,        // 追蹤時每秒最大轉向(弧度);無鎖定時完全不轉向
  ALT: 8,           // 發射後相對主機甲的爬升高度
  LINK_M: 340,      // 失聯距離
  TTL_S: 14,
  CD_S: 24,         // 冷卻(自發射瞬間起算;歸零 = 掛點重新組合出一架)
  BOOM_M: 6,        // 追蹤命中的近炸引信半徑
  SIGHT: 200,       // 偵察視野(僅連線中回傳)
  DMG: 260, R: 20, PEN: 10,
  vs: { flesh: 1.4, armor: 1.3, air: 0.6, building: 1.2 },
};
/** 餌機自爆的爆風定義(交給 sim._blast;與 WEAPONS 同形) */
export const decoyBlast = () => ({ dmg: DECOY.DMG, r: DECOY.R, pen: DECOY.PEN, vs: DECOY.vs });
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

// ---- 武器物理衰減(2026-07-11:傷害隨距離按各機制的真實物理衰減,sim 結算時套用)----
// 動能彈(gun/rail):空阻使彈速指數衰減 v(d)=v0·e^(−d/L),動能 ∝ v² ⇒ 傷害 ×e^(−2Δd/L);
//   特徵距離 L = 初速 × KIN_L(超音速彈存速好、次音速掉得快;磁軌彈超高速幾乎不衰減)。
// 能量束(beam/plasma):大氣吸收/散射(Beer–Lambert)⇒ ×e^(−Δd/EXT);電漿封包復合消散最快。
// 化學能戰鬥部(launcher/missile):炸藥威力與航程無關 → 不吃飛行距離衰減,只吃爆風超壓衰減。
// PLATEAU:近距平台(射程比例)內不衰減 — 有效射程內存速/光強充足;FLOOR = 射程末端平衡保底。
export const FALLOFF = {
  PLATEAU: 0.35,
  KIN_L: 0.8,                        // 動能特徵距離(公尺)= mv × 此值
  EXT: { beam: 600, plasma: 150 },   // 消光特徵距離(公尺,晴空)
  FLOOR: { gun: 0.5, rail: 0.75, beam: 0.6, plasma: 0.35 },
};
/** 距離傷害倍率(d = 射手→目標 3D 距離);未列型別(戰鬥部等)恆為 1 */
export function dmgFalloff(def, d) {
  if (def.fan) return fanFalloff(def.range || 0, d);   // 扇形武器(散彈/電漿)專屬曲線:越近越高
  const floor = FALLOFF.FLOOR[def.type];
  if (!floor) return 1;
  const dd = d - (def.range || 0) * FALLOFF.PLATEAU;
  if (dd <= 0) return 1;
  const kinetic = def.type === 'gun' || def.type === 'rail';
  const L = kinetic ? (def.mv || 600) * FALLOFF.KIN_L : FALLOFF.EXT[def.type];
  return Math.max(floor, Math.exp(-(kinetic ? 2 : 1) * dd / L));
}
// 扇形武器(散彈槍 / 電漿):無近距平台 —— 槍口傷害最高,隨距離線性遞減到射程末端的 FAN_FLOOR。
// 這正是「射程偏短、越近傷害越高」的手感(使用者指示);射程本就短(近戰武器)。
export const FAN_FLOOR = 0.25;
export function fanFalloff(range, d) {
  if (!range) return 1;
  return Math.max(FAN_FLOOR, 1 - d / range);
}
/** 爆風超壓衰減:核心(≤0.5r)全傷,外圍隨距離急降、1.8r 歸零(取代舊二段式 1/0.4) */
export function blastFalloff(r, d) {
  if (d <= r * 0.5) return 1;
  if (d >= r * 1.8) return 0;
  return ((r * 1.8 - d) / (r * 1.3)) ** 0.75;
}

// ---- 後座力機制(2026-07-14:輕/重武器各三階,依武器原型分派)----
// 純客戶端手感:game.js 依「當前手上武器」的 def.recoil 套用位移懲罰 + 準星上踢 + 開火節奏。
// 伺服器不涉入(位移本就客戶端回報,防作弊仍走 heroHit 射程/迷霧驗證)⇒ bal/e2e 不受影響。
//   move   移動中射擊的位移懲罰:'free' 不受影響 / 'slow' 減速 / 'stop' 開火即停 / 'back' 後退
//   climb  每發準星上踢量(rad,累加到 recoil.p,開火停止後快速回穩)
//   kick   槍身後坐 + 鏡頭 trauma 震動倍率
//   slowF  move:'slow' 時保留的速度比例
//   back   每發沿槍口反向的擊退速度(m/s)
//   burst  N 連射後強制回穩(0 = 無;扇形武器不吃 —— 見 game.js)
//   settle burst 觸發後的回穩秒數(此間不能擊發,與換彈匣機制分離)
//   steady 開火前須「停下 + 穩定」的秒數(高後座重武器:狙擊 / 超電磁炮 / 導引飛彈)
// AIR_F:飛行機體(無人機 / 變形機飛行型)的位移懲罰折扣 —— 使用者指示「空中減半」,
//   整個蜂群陣營靠飛行機動,套滿地面懲罰會過度削弱空戰體驗。
export const RECOIL = {
  AIR_F: 0.5,
  light: {
    low:  { move: 'free', climb: 0.006, kick: 0.8, slowF: 1,   back: 0, burst: 0, settle: 0,    steady: 0 },
    med:  { move: 'slow', climb: 0.013, kick: 1.2, slowF: 0.5, back: 0, burst: 4, settle: 0.45, steady: 0 },
    high: { move: 'stop', climb: 0.020, kick: 1.6, slowF: 0,   back: 3, burst: 0, settle: 0,    steady: 0 },
  },
  heavy: {
    low:  { move: 'stop', climb: 0.022, kick: 2.4, slowF: 0,   back: 0, burst: 0, settle: 0, steady: 0 },
    med:  { move: 'back', climb: 0.032, kick: 3.2, slowF: 0.3, back: 9, burst: 0, settle: 0, steady: 0 },
    high: { move: 'stop', climb: 0.044, kick: 4.5, slowF: 0,   back: 0, burst: 0, settle: 0, steady: 1.4 },
  },
};
/**
 * 解析武器後座力分級(回傳 RECOIL[slot] 的 profile 物件)。
 * 顯式 w.recoil('low'|'med'|'high')優先;否則依 type / 命名關鍵字 / 射速推導預設分級。
 * 輕武器:光束・磁軌 = low;散彈(fan) = med;機槍/機砲/速射/高射速 = high;其餘步槍/卡賓 = med。
 * 重武器:電漿/扇形・定向能 = low(開火即停);榴彈/火箭(launcher) = med(後退);
 *         磁軌狙・超電磁・導引飛彈・反器材重砲 = high(須停穩)。
 */
export function recoilTier(w, slot, fan = !!w.fan || w.type === 'plasma') {
  const R = RECOIL[slot];
  if (w.recoil && R[w.recoil]) return R[w.recoil];
  const nm = w.name || '', ty = w.type, rate = tierVal(w.rate ?? 3, 1);
  let tier;
  if (slot === 'light') {
    if (ty === 'beam' || ty === 'rail') tier = 'low';
    else if (fan) tier = 'med';
    else if (/機槍|機砲|重機|速射|快砲|六管|通用機|轉輪|加農/.test(nm) || rate >= 7) tier = 'high';
    else tier = 'med';
  } else if (ty === 'plasma' || fan || ty === 'beam') tier = 'low';
  else if (ty === 'launcher') tier = 'med';
  else tier = 'high';   // rail 磁軌狙 / 超電磁、missile 導引飛彈、gun 反器材重砲
  return R[tier];
}
// 後座力分級的中文標籤(武器說明用):由 profile 反查階名。
const RECOIL_LABEL = { low: '低', med: '中', high: '高' };
export function recoilName(w, slot, fan = !!w.fan || w.type === 'plasma') {
  const R = RECOIL[slot], prof = recoilTier(w, slot, fan);
  for (const t of ['low', 'med', 'high']) if (R[t] === prof) return RECOIL_LABEL[t];
  return '中';
}

// 榴彈 / 火箭(launcher)對建築的額外傷害加成(使用者指示「榴彈類武器對建築物傷害強化」)。
// 疊在武器自身 vs.building 之上,只在 launcher 型命中建築(塔/主堡/障礙)時生效 ——
// 攻城武器拆建築更快,但對兵員/裝甲/空中目標不變。套用點唯一:sim._heroDmg()。
export const GRENADE = { BUILDING_MUL: 1.4 };
export const grenadeBuildingMul = (def, kind) =>
  def && def.type === 'launcher' && TARGET_CLASS[kind] === 'building' ? GRENADE.BUILDING_MUL : 1;

// ---- 招式養成(擊殺數解鎖 + 金錢購買;輕/重武器 Lv1 自帶,小招/大招要先解鎖)----
// kills/cost[i] = 升到 Lv(i+1) 的門檻;擊殺數 kn:小兵 1、坦克/直升機 2、塔 3、英雄 4。
export const PROG = {
  light: { name: '輕武器', kills: [0, 6, 15],  cost: [0, 250, 550] },
  heavy: { name: '重武器', kills: [0, 9, 20],  cost: [0, 300, 650] },
  skill: { name: '小招',   kills: [2, 12, 25], cost: [150, 400, 800] },
  ult:   { name: '大招',   kills: [6, 18, 32], cost: [400, 800, 1400] },
};
export const KILL_SCORE = { drone: 4, robot: 4, morph: 4, tower: 3, tank: 2, heli: 2 };
// 電腦玩家(bot;含駕駛傭兵變形機甲的 bot)只算 3 分 — 刷 bot 解招式比打真人便宜,但沒那麼便宜。
export const BOT_KILL_SCORE = 3;
export const killScore = (kind) => KILL_SCORE[kind] ?? 1;

// 三階數值取值:陣列 = [Lv1, Lv2, Lv3];純量 = 各階相同
export const tierVal = (v, lvl = 1) =>
  Array.isArray(v) ? v[Math.max(0, Math.min(v.length - 1, lvl - 1))] : v;

/**
 * 玩家可操作機體的射程上限 = 視野 × RANGE_SIGHT_F(恆 < 視野:打不到看不到的東西)。
 * 重武器一律需開狙擊視角(needAim),瞄準時視野 ×AIM_SIGHT_MULT → 上限跟著放大。
 * 伺服器 _visibleTo 本來就會作廢「看不見的目標」的命中回報,這裡只是讓數值誠實。
 */
export function rangeCap(kind, slot) {
  const sight = UNITS[kind]?.sight;
  if (!sight) return Infinity;
  return sight * (slot === 'heavy' ? GAME.AIM_SIGHT_MULT : 1) * GAME.RANGE_SIGHT_F;
}

/**
 * 解析角色武器(slot: 'light'|'heavy')在 lvl 階的實戰數值。
 * heroic=true 套用玩家英雄倍率(射程 ×1.2、傷害 ×1.5)並夾住 rangeCap;false = NPC 基準值。
 * 重武器以 mag×reload 實作 CD:每發打完自動進入 cd 秒冷卻(HUD 顯示為冷卻)。
 * 無人機是三機小隊(SQUAD.N),單機傷害折成 SQUAD.DMG — 這裡是唯一的折算點。
 */
export function heroWeapon(ch, slot, lvl = 1, heroic = true) {
  const w = CHARACTERS[ch]?.[slot];
  if (!w) return null;
  const t = (v) => tierVal(v, lvl);
  const kind = charKind(ch);
  const squad = kind === 'drone' ? SQUAD.DMG : 1;
  return {
    id: slot, name: w.name, rw: w.rw, type: w.type, mv: w.mv,
    dmg: t(w.dmg) * (heroic ? HEROIC.dmg : 1) * squad,
    range: heroic ? Math.min(w.range * HEROIC.range, rangeCap(kind, slot)) : w.range,
    rate: t(w.rate ?? 3),   // rate 也可三階(s05 旋轉機砲);漏過 tierVal 會把陣列外洩給 UI/射速限制
    mag: t(w.mag ?? 1),
    reload: t(w.cd ?? w.reload ?? 2),
    r: t(w.r), pen: t(w.pen ?? 0), crit: t(w.crit ?? 0), critX: w.critX ?? VITALS.CRIT_X,
    emp: t(w.emp ?? 0),
    charge: t(w.charge ?? 0), guide: !!w.guide, arc: t(w.arc ?? 0),
    fan: !!w.fan || w.type === 'plasma',   // 扇形武器(散彈 / 電漿):錐狀判定 + 越近越高衰減
    recoil: recoilTier(w, slot === 'heavy' ? 'heavy' : 'light', !!w.fan || w.type === 'plasma'),
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
// visual:程序生成機體外觀參數(hue 主色;無人機 frame/body(座艙沿用)、機甲 pod 掛件;
//         2026-07-10 外觀改制(doc/image 賽璐璐重構,兩陣營各三型等比例):
//         無人機 = 旋翼(無 form;frame quad/hexa/coax)/ 定翼(form:'fixed',wing 指定
//                   twinboom/vtail/canard/delta/zero 剪影;canard/delta 為噴射動力,
//                   其餘掛螺旋槳 — 現實原型沒有槳的機種一律不畫槳)/ 擬態翼(form:'avian',creature:
//                   bee 尾針砲・eagle 羽毛飛彈・ptero 爪抓槍莢・dragon 張口飛彈巢);
//         機甲   = 人形(無 form,但 MUST 指定 proto 原型 — 四台的比例/裝備/站姿全不同:
//                   bastion 過裝甲巨肩 + 長戟(戟刃即 152mm 砲口)・seraph EVA 式倒三角上胸
//                   (兩個上端點即雙肩)+ 磁軌長槍・aegis 方形塔盾 + 肩部垂直發射彈艙・
//                   colossus「巨兵」圓角矩形身軀 + 蜈蚣節肢 + 眉心脈衝砲;
//                   2026-07-11 重構,MUST NOT 退回「同一具機體換色換掛件」)/ 雙足獸
//                   (form:'biped',creature: gorilla 巨臂武裝・ostrich 翼藏飛彈・trex 巨顎藏砲・
//                   roo 強腿重尾)/ 四足獸(form:'beast',creature: hound 揹負重武・centaur 人馬持槍・
//                   stego 背鰭四聯飛彈・cthulhu 四爪步行四爪持武);
//         傭兵 morph 用 flight(飛行型:jet 戰機/uav 固定翼/heli 直升機/tilt 傾轉旋翼/
//         levi・archo・beetle・owl 擬態翼)+ ground(地面型:人形四體態 wolf 狼人趾行/
//         vampire 吸血鬼挺立(披風即機翼)/monkey 猿猴蹲伏(多節長尾)/atlas 負重前傾(雙肩掛架);
//         四足獸 elephant/raptor/beetle/panther)+ bulk 體格倍率 — 純外觀,不動數值)。
//         paint(2026-07-11 塗裝改制):機體裝甲色版一律由 hue 推導(paint.js heroPalette),
//         再依角色性格印上程序花紋 — minimal 制式極簡 / camo 迷彩 / graffiti 街頭塗鴉 /
//         tattoo 線描刺青 / totem 民族圖騰 / flag 旗幟徽記。花紋以「靜止姿勢的機體局部座標」
//         三平面投影(paint.js paintUnit),鎖在裝甲板上不隨關節游移。
// fx 一覽:buff(增益)/ heal(維修)/ strike(打擊)/ summon(召喚)/ emp(癱瘓)
//          / vision(視野)/ stealth(匿蹤)/ dash(突進)/ intercept(攔截飛彈)。
// 武器 type 一覽(2026-07-11 機制多元化;傷害距離衰減見 dmgFalloff):
//   gun      動能彈:彈道學拋物線,動能隨空阻衰減
//   rail     磁軌炮:按住開火蓄力 charge 秒 → 極速直擊(幾乎無衰減、高破甲);提前放開不耗彈
//   launcher 火箭/榴彈:AoE 戰鬥部;guide:1 = 狙擊視角雷射導引(彈體追準星修正航向)
//   missile  飛彈:發射時有準星鎖定 → 自動追蹤該目標近炸;無鎖定 = 直飛(AoE 戰鬥部)
//   beam     定向能:光速直擊無下墜,穩定輸出;吃大氣消光;emp 附帶 = 電磁癱瘓控場
//   plasma   電漿:扇形 arc(半角度°)大面積,範圍內敵人全數命中(伺服器結算),消散快、射程短
// 扇形武器(fan:電漿 / 散彈 shotgun):dmgFalloff 走 fanFalloff(越近越高)、sim.heroPlasma 錐判定。
// 輕武器類型(2026-07-13 多元化;2026-07-14 開放散彈):launcher/missile 在 heroBurst、
//   plasma/fan 在 heroPlasma —— heroPlasma 已收 slot 參數,故「散彈輕武器(fan:true)」可經
//   {t:'plasma', slot:'light'} 走同一條錐判定(唯一破例;launcher/missile 仍只准重武器)。
//   非扇形輕武器(gun/rail/beam)照走 heroHit(slot 無關);rail 用在輕武器時 MUST NOT 帶 charge
//   (每次擊發都蓄力會讓速射步槍打不動,charge 只留給重武器的「蓄力後極速直擊」)。
export const CHARACTERS = {
  // ================= 蜂群陣營(無人機)=================
  s01: {
    side: 'SWARM', name: '卡特琳娜・薛甫琴科', code: '蜂后', machine: '「第聶伯總譜」指揮型六旋翼',
    visual: { hue: 0xffd257, frame: 'hexa', body: 'box', form: 'avian', creature: 'bee', paint: 'minimal' },
    mods: { hp: 1.0, sp: 1.15, mp: 1.15, speed: 0.95, armor: 6 },
    light: { name: '雙聯 5.56 機槍艙', rw: 'FN Minimi・初速 915m/s', type: 'gun', mv: 915,
      dmg: [12, 15, 18], rate: 10, mag: [40, 50, 60], reload: 2.0, range: 190, crit: 0.06,
      vs: { flesh: 1.2, armor: 0.6, air: 1.3, building: 0.5 } },
    heavy: { name: '70mm 導引火箭巢', rw: 'Hydra 70 + APKWS 雷射導引・初速 700m/s', type: 'launcher', mv: 700, guide: 1,
      dmg: [100, 135, 170], r: [12, 14, 16], cd: [8, 7, 6], range: 300, pen: 6,
      vs: { flesh: 1.1, armor: 1.4, air: 0.5, building: 1.2 } },
    skill: { name: '蜂群協奏', fx: 'buff', target: 'team', r: 180, mul: { dmg: [1.2, 1.28, 1.35] },
      dur: [6, 8, 10], cd: 20, mp: [35, 40, 45], desc: '指揮頻道開啟:半徑內友軍火力提升' },
    ult: { name: '總譜:終樂章', fx: 'summon', unit: 'heli', count: [2, 3, 4],
      cd: [80, 70, 60], mp: [80, 90, 100], desc: '呼叫攻擊直升機編隊沿最近兵線壓上' },
  },
  s02: {
    side: 'SWARM', name: '塔拉斯・邦達爾', code: '鐵匠', machine: '「鐵匠鋪」重載運翼機',
    visual: { hue: 0xc98a3d, frame: 'hexa', body: 'slab', paint: 'graffiti' },
    mods: { hp: 1.2, sp: 0.9, mp: 0.9, speed: 0.85, armor: 12 },
    light: { name: '12.7 重機艙', rw: 'DShK・初速 850m/s', type: 'gun', mv: 850,
      dmg: [20, 25, 31], rate: 5, mag: [30, 36, 42], reload: 2.4, range: 200, crit: 0.05, pen: 6,
      vs: { flesh: 1.2, armor: 1.1, air: 0.9, building: 0.7 } },
    // range 275(2026-07-14):解析後 = min(275×1.2, cap) = 330m —— 全機種「最短的重武器」,
    // 剛好越過砲塔射程 310m 約 20m(使用者指示:重武器可在砲塔射程外拆塔,最短者僅稍遠一點點)。
    // 電漿扇形重武器(180~210m)是刻意的近戰例外,不在此列。
    heavy: { name: '溫壓火箭', rw: 'TBG-7V・初速 120m/s', type: 'launcher', mv: 120,
      dmg: [150, 200, 250], r: [15, 17, 19], cd: [9, 8, 7], range: 275, pen: 15,
      vs: { flesh: 1.4, armor: 1.3, air: 0.4, building: 2.0 } },
    skill: { name: '野戰搶修', fx: 'heal', target: 'self', heal: [180, 260, 340],
      cd: [24, 21, 18], mp: [35, 40, 45], desc: '焊槍出手:立即修復自身裝甲' },
    ult: { name: '蜂巢再鑄', fx: 'heal', target: 'team', r: 200, heal: [220, 300, 380], sp: true,
      cd: [80, 70, 60], mp: [85, 95, 105], desc: '半徑內友軍裝甲大修,護盾同步充滿' },
  },
  s03: {
    side: 'SWARM', name: '林芷晴', code: 'Silicon', machine: '「跳頻蜂」電戰無人機',
    visual: { hue: 0x9ef2e6, frame: 'wing', body: 'wedge', form: 'fixed', wing: 'canard', paint: 'tattoo' },
    mods: { hp: 0.9, sp: 1.25, mp: 1.3, speed: 1.0, armor: 4 },
    light: { name: '相位脈衝步槍艙', rw: '低功率相控陣雷射・光速直擊', type: 'beam',
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
    side: 'SWARM', name: '樫村蒼真', code: 'Kashi', machine: '「鐵鍬」零式突擊翼',
    visual: { hue: 0x8fd14f, body: 'box', form: 'fixed', wing: 'zero', paint: 'flag' },
    mods: { hp: 1.1, sp: 1.0, mp: 0.95, speed: 1.05, armor: 8 },
    light: { name: '戰鬥霰彈莢艙', rw: 'Benelli M4・初速 400m/s', type: 'gun', mv: 400, fan: true, arc: [16, 14, 12],
      dmg: [34, 42, 52], rate: 2.2, mag: [7, 8, 10], reload: 2.6, range: 170, crit: 0.10, critX: 1.5,
      vs: { flesh: 1.6, armor: 0.5, air: 1.2, building: 0.4 } },
    heavy: { name: '電漿噴湧砲', rw: '磁化電漿投射・扇形噴焰', type: 'plasma', arc: [13, 15, 17],
      dmg: [110, 150, 190], cd: [6, 5, 4], range: 264, pen: 8,
      vs: { flesh: 1.5, armor: 1.0, air: 0.5, building: 1.2 } },
    skill: { name: '突進機動', fx: 'dash', imp: [28, 34, 40],
      cd: [12, 10, 8], mp: [25, 30, 35], desc: '沿視線方向爆發加速(教官の鐵鍬距離)' },
    ult: { name: '白刃時刻', fx: 'buff', target: 'self', mul: { dmg: [1.4, 1.5, 1.6], dmgTaken: [0.85, 0.8, 0.75] },
      dur: [8, 10, 12], cd: [70, 60, 50], mp: [75, 85, 95], desc: '近接教官進入戰鬥反射狀態' },
  },
  s05: {
    side: 'SWARM', name: '河瑟琪', code: 'Overclock', machine: '「超頻」競速 FPV',
    visual: { hue: 0xff6fb0, frame: 'quad', body: 'wedge', paint: 'graffiti' },
    mods: { hp: 0.85, sp: 1.1, mp: 1.1, speed: 1.2, armor: 3 },
    light: { name: '微型軌道轉輪砲', rw: '實驗性線性感應馬達・初速 1400m/s', type: 'rail', mv: 1400,
      dmg: [9, 11, 14], rate: [14, 16, 18], mag: [70, 90, 110], reload: 2.8, range: 180, crit: 0.05,
      vs: { flesh: 1.2, armor: 0.6, air: 1.4, building: 0.4 } },
    heavy: { name: '巡飛彈釋放器', rw: 'Lancet 縮裝・巡飛 90m/s', type: 'missile', mv: 90,
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
    visual: { hue: 0xb9c7ff, frame: 'coax', body: 'sphere', form: 'avian', creature: 'ptero', paint: 'minimal' },
    mods: { hp: 1.0, sp: 1.2, mp: 1.1, speed: 1.0, armor: 6 },
    light: { name: '精準軌道步槍艙', rw: '實驗性磁軌步槍・初速 1600m/s', type: 'rail', mv: 1600,
      dmg: [24, 30, 37], rate: 3, mag: [15, 18, 21], reload: 2.2, range: 230, crit: 0.15, critX: 1.8,
      vs: { flesh: 1.2, armor: 0.8, air: 1.5, building: 0.5 } },
    heavy: { name: '微型攔截彈', rw: 'AIM-9X 縮裝・初速 1000m/s', type: 'missile', mv: 1000,
      dmg: [90, 120, 150], r: [6, 7, 8], cd: [7, 6, 5], range: 340, pen: 6,
      vs: { flesh: 0.6, armor: 0.6, air: 2.5, building: 0.3 } },
    skill: { name: '攔截領域', fx: 'intercept', r: [150, 190, 230],
      cd: [16, 14, 12], mp: [30, 35, 40], desc: '擊落半徑內所有來襲飛彈(擋下的,不是打掉的)' },
    ult: { name: '空白布章', fx: 'buff', target: 'team', r: 220, mul: { dmgTaken: [0.6, 0.5, 0.4] },
      dur: [6, 7, 8], cd: [75, 65, 55], mp: [85, 95, 105], desc: '護航誓約:半徑內友軍承傷大減' },
  },
  s07: {
    side: 'SWARM', name: '埃坦・沙哈', code: '鐵數學', machine: '「證明完畢」防空平台',
    visual: { hue: 0x7fd8ff, frame: 'hexa', body: 'slab', form: 'avian', creature: 'dragon', paint: 'totem' },
    mods: { hp: 1.05, sp: 1.1, mp: 1.1, speed: 0.9, armor: 8 },
    light: { name: '25mm 空爆機砲', rw: 'XM25 派生・初速 760m/s', type: 'gun', mv: 760,
      dmg: [16, 20, 25], rate: 6, mag: [24, 30, 36], reload: 2.3, range: 210, crit: 0.06,
      vs: { flesh: 1.3, armor: 0.7, air: 1.6, building: 0.5 } },
    heavy: { name: '防空散射矩陣', rw: '磁化電漿・扇形防空散布', type: 'plasma', arc: [20, 23, 26],
      dmg: [90, 120, 150], cd: [7, 6, 5], range: 264, pen: 4,
      vs: { flesh: 0.9, armor: 0.6, air: 2.0, building: 0.4 } },
    skill: { name: '分配演算法', fx: 'intercept', r: [170, 210, 250],
      cd: [15, 13, 11], mp: [30, 35, 40], desc: '一道證明完畢:清空半徑內來襲飛彈' },
    ult: { name: '飽和反擊', fx: 'strike', count: [5, 7, 9], dmg: [80, 100, 125], r: 11, scatter: 35,
      range: 340, pen: 6, cd: [72, 64, 56], mp: [85, 95, 105], vs: { air: 1.5, armor: 1.1 },
      desc: '攔截網反向齊射:對指定空域/地面飽和打擊' },
  },
  s08: {
    side: 'SWARM', name: '佐菲亞・馬列克', code: '聖燭', machine: '「聖燭」醫療運補機',
    visual: { hue: 0xe8f0f4, frame: 'coax', body: 'sphere', paint: 'flag' },
    mods: { hp: 1.0, sp: 1.15, mp: 1.25, speed: 1.0, armor: 5 },
    light: { name: '護航機槍艙', rw: 'PKM 7.62・初速 825m/s', type: 'gun', mv: 825,
      dmg: [15, 19, 23], rate: 7, mag: [36, 44, 52], reload: 2.1, range: 190, crit: 0.06,
      vs: { flesh: 1.3, armor: 0.7, air: 1.1, building: 0.5 } },
    heavy: { name: '同步軌道狙擊砲', rw: '實驗性電磁狙擊系統・初速 2200m/s', type: 'rail', mv: 2200, charge: [2.0, 1.7, 1.4],
      dmg: [130, 170, 215], cd: [7, 6, 5], range: 360, crit: 0.25, critX: 2.0, pen: [16, 20, 24],
      vs: { flesh: 1.4, armor: 0.8, air: 1.4, building: 0.4 } },
    skill: { name: '血漿空投', fx: 'heal', target: 'team', r: 140, heal: [150, 210, 270],
      cd: [20, 18, 16], mp: [40, 45, 50], desc: '空中血庫開倉:半徑內友軍裝甲回復' },
    ult: { name: '修道院鐘聲', fx: 'heal', target: 'team', r: 240, heal: [280, 380, 480], sp: true,
      cd: [85, 75, 65], mp: [90, 100, 110], desc: '大範圍野戰醫療:裝甲大量回復、護盾充滿' },
  },
  s09: {
    side: 'SWARM', name: '艾德蒙・惠特洛克', code: '獵場主', machine: '「獵場看守人」雙管獵鷹',
    visual: { hue: 0x5a8a4a, frame: 'coax', body: 'box', form: 'avian', creature: 'eagle', paint: 'flag' },
    mods: { hp: 1.05, sp: 1.0, mp: 1.0, speed: 1.0, armor: 8 },
    light: { name: '雙管防空霰彈', rw: 'Purdey 12 鉛徑改・初速 420m/s', type: 'gun', mv: 420, fan: true, arc: [18, 16, 14],
      dmg: [30, 38, 47], rate: 2.6, mag: [8, 10, 12], reload: 2.4, range: 170, crit: 0.10, critX: 1.5,
      vs: { flesh: 1.3, armor: 0.4, air: 2.0, building: 0.3 } },
    heavy: { name: '獵狐飛彈', rw: 'Starstreak 縮裝・雷射波束導引・初速 300m/s', type: 'launcher', mv: 300, guide: 1,
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
    visual: { hue: 0xd7b8ff, frame: 'wing', body: 'frame', form: 'fixed', wing: 'twinboom', paint: 'minimal' },
    mods: { hp: 0.9, sp: 1.2, mp: 1.3, speed: 1.05, armor: 3 },
    light: { name: '低功率脈衝雷射槍艙', rw: '抑制型雷射訊號步槍・光速直擊', type: 'beam',
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
    visual: { hue: 0xd8c690, frame: 'wing', body: 'frame', form: 'fixed', wing: 'vtail', paint: 'minimal' },
    mods: { hp: 1.0, sp: 1.05, mp: 1.05, speed: 0.95, armor: 8 },
    light: { name: '精密聚焦雷射步槍', rw: '低散射固態雷射・光速直擊', type: 'beam',
      dmg: [22, 27, 33], rate: 3.5, mag: [20, 24, 28], reload: 2.1, range: 220, crit: 0.12, critX: 1.8, pen: 6,
      vs: { flesh: 1.1, armor: 1.3, air: 1.0, building: 0.6 } },
    heavy: { name: '關節破壞者', rw: '實驗性 EM 磁軌・初速 2000m/s', type: 'rail', mv: 2000, charge: [1.5, 1.3, 1.1],
      dmg: [170, 220, 275], cd: [9, 8, 7], range: 380, crit: 0.15, critX: 2.0, pen: [25, 30, 35],
      vs: { flesh: 0.8, armor: 2.2, air: 1.2, building: 0.7 } },
    skill: { name: '弱點解析', fx: 'buff', target: 'self', mul: { dmg: [1.35, 1.45, 1.55] },
      dur: [5, 6, 7], cd: [18, 16, 14], mp: [35, 40, 45], desc: '我造了那個膝蓋:短時間傷害大增' },
    ult: { name: '大修', fx: 'heal', target: 'self', heal: [400, 550, 700], sp: true,
      cd: [80, 70, 60], mp: [80, 90, 100], desc: '鐘錶匠的手:自身裝甲大修、護盾充滿' },
  },
  s12: {
    side: 'SWARM', name: '埃米爾・賽伊托夫', code: '歸鄉', machine: '「星圖」偵察機',
    visual: { hue: 0x9db8d8, frame: 'wing', body: 'wedge', form: 'fixed', wing: 'delta', paint: 'totem' },
    mods: { hp: 0.9, sp: 1.1, mp: 1.15, speed: 1.15, armor: 4 },
    light: { name: '偵察卡賓艙', rw: 'AKS-74U・初速 735m/s', type: 'gun', mv: 735,
      dmg: [14, 17, 21], rate: 8, mag: [30, 36, 42], reload: 1.9, range: 180, crit: 0.08,
      vs: { flesh: 1.3, armor: 0.6, air: 1.1, building: 0.4 } },
    heavy: { name: '衛星測距雷射砲', rw: '高能雷射測距一體・光速直擊', type: 'beam',
      dmg: [130, 170, 215], cd: [7, 6, 5], range: 320, pen: [10, 13, 16],
      vs: { flesh: 0.8, armor: 1.1, air: 0.5, building: 1.2 } },
    skill: { name: '薰衣草斗篷', fx: 'stealth', dur: [4, 5, 6],
      cd: [20, 18, 16], mp: [35, 40, 45], desc: '從敵方感測網上消失(開火即現形)' },
    ult: { name: '滿天星座', fx: 'vision', vision: [10, 13, 16],
      cd: [70, 62, 54], mp: [80, 90, 100], desc: '衛星會被打下來,星星不會:全隊長時間無霧' },
  },

  // ================= 鋼鐵陣營(機甲)=================
  t01: {
    side: 'STEEL', name: '瓦列里・格羅莫夫', code: '冬將軍', machine: '「莫洛茲」指揮型重機甲',
    visual: { hue: 0xd6e4ef, pod: 'none', proto: 'bastion', paint: 'flag' },
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
    visual: { hue: 0xcfd8ff, pod: 'none', proto: 'seraph', paint: 'minimal' },
    mods: { hp: 0.9, sp: 1.3, mp: 1.2, speed: 1.15, armor: 14 },
    light: { name: '高斯衝鋒槍', rw: '實驗性 EM 線圈・初速 1100m/s', type: 'rail', mv: 1100,
      dmg: [15, 19, 23], rate: 8, mag: [32, 40, 48], reload: 1.9, range: 200, crit: 0.08,
      vs: { flesh: 1.2, armor: 0.9, air: 1.1, building: 0.5 } },
    heavy: { name: '同步狙擊砲', rw: 'EM 加速穿甲彈・初速 1500m/s', type: 'rail', mv: 1500, charge: [1.2, 1.05, 0.9],
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
    visual: { hue: 0xe08a4a, pod: 'shield', form: 'biped', creature: 'gorilla', paint: 'graffiti' },
    mods: { hp: 1.3, sp: 0.85, mp: 0.9, speed: 0.95, armor: 26 },
    light: { name: '全自動霰彈', rw: 'Saiga-12 彈鼓・初速 400m/s', type: 'gun', mv: 400, fan: true, arc: [17, 15, 13],
      dmg: [36, 45, 56], rate: 2.4, mag: [8, 10, 12], reload: 2.6, range: 170, crit: 0.10, critX: 1.5,
      vs: { flesh: 1.6, armor: 0.6, air: 0.9, building: 0.5 } },
    heavy: { name: '電漿噴焰', rw: '磁化電漿投射・扇形噴焰', type: 'plasma', arc: [15, 17, 19],
      dmg: [170, 225, 280], cd: [9, 8, 7], range: 264, pen: 12,
      vs: { flesh: 1.6, armor: 1.1, air: 0.3, building: 1.4 } },
    skill: { name: '鑄鐵鍋盾', fx: 'buff', target: 'self', mul: { dmgTaken: [0.55, 0.5, 0.45] },
      dur: [4, 5, 6], cd: [16, 14, 12], mp: [30, 35, 40], desc: '左臂鑄鐵鍋架起:承傷大減' },
    ult: { name: '開鍋!', fx: 'buff', target: 'self', mul: { dmg: [1.45, 1.55, 1.65], reload: [0.8, 0.75, 0.7] },
      dur: [8, 10, 12], cd: [75, 65, 55], mp: [80, 90, 100], desc: '懲戒營主廚火力全開' },
  },
  t04: {
    side: 'STEEL', name: '娜傑日達・奧爾洛娃', code: '灰雁', machine: '「灰雁」獵殺型',
    visual: { hue: 0x8a97a5, pod: 'rack', form: 'beast', creature: 'hound', paint: 'camo' },
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
    visual: { hue: 0xf2f2f2, pod: 'dish', form: 'biped', creature: 'ostrich', paint: 'minimal' },
    mods: { hp: 1.0, sp: 1.1, mp: 1.15, speed: 1.05, armor: 18 },
    light: { name: '原型軌道步槍', rw: '實驗性線圈砲・初速 1500m/s', type: 'rail', mv: 1500,
      dmg: [16, 20, 25], rate: 7, mag: [36, 44, 52], reload: 2.1, range: 200, crit: 0.06,
      vs: { flesh: 1.3, armor: 0.8, air: 1.0, building: 0.5 } },
    heavy: { name: '原型脈衝雷射矛', rw: '仿生關節整合雷射・光速直擊', type: 'beam',
      dmg: [140, 185, 230], cd: [7, 6, 5], range: 300, pen: [18, 22, 26],
      vs: { flesh: 0.8, armor: 1.7, air: 0.6, building: 0.6 } },
    skill: { name: '結構自檢', fx: 'heal', target: 'self', heal: [200, 280, 360],
      cd: [22, 19, 16], mp: [35, 40, 45], desc: '仿生關節自我修復(掉漆的才是我的)' },
    ult: { name: '量產線', fx: 'summon', unit: 'tank', count: [1, 2, 3],
      cd: [90, 80, 70], mp: [90, 100, 110], desc: '瀋陽重工加班:主戰坦克沿最近兵線出廠' },
  },
  t06: {
    side: 'STEEL', name: '陸小川', code: '小川', machine: '「輕功」高機動機甲',
    visual: { hue: 0xffb84d, pod: 'none', form: 'biped', creature: 'roo', paint: 'graffiti' },
    mods: { hp: 0.95, sp: 1.05, mp: 1.0, speed: 1.2, armor: 14 },
    light: { name: '5.8 突擊步槍', rw: 'QBZ-191・初速 930m/s', type: 'gun', mv: 930,
      dmg: [13, 16, 20], rate: 9, mag: [34, 42, 50], reload: 1.8, range: 190, crit: 0.08,
      vs: { flesh: 1.3, armor: 0.7, air: 1.0, building: 0.5 } },
    heavy: { name: '熔核直拳砲', rw: '磁化電漿聚爆・貼身直擊', type: 'plasma', arc: [10, 12, 14],
      dmg: [130, 170, 215], cd: [6, 5, 4], range: 264, pen: 10,
      vs: { flesh: 1.1, armor: 1.4, air: 0.3, building: 0.8 } },
    skill: { name: '麻辣走位', fx: 'dash', imp: [28, 34, 40],
      cd: [11, 9, 7], mp: [25, 30, 35], desc: '模擬器省冠軍的走位,機體像長在他身上' },
    ult: { name: '主角時刻', fx: 'buff', target: 'self', mul: { dmg: [1.4, 1.5, 1.6], dmgTaken: [0.8, 0.75, 0.7] },
      dur: [8, 10, 12], cd: [70, 60, 50], mp: [80, 90, 100], desc: '儲物櫃漫畫的主角上場了' },
  },
  t07: {
    side: 'STEEL', name: '李正赫', code: '無聲', machine: '「無聲」狙擊型',
    visual: { hue: 0x6d7a68, pod: 'rack', form: 'beast', creature: 'centaur', paint: 'camo' },
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
    visual: { hue: 0xffc7dd, pod: 'dish', form: 'beast', creature: 'cthulhu', paint: 'tattoo' },
    mods: { hp: 0.9, sp: 1.25, mp: 1.3, speed: 1.0, armor: 12 },
    light: { name: '共鳴脈衝步槍', rw: '聲電複合雷射・光速直擊', type: 'beam',
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
    visual: { hue: 0xc9b7e8, pod: 'rack', form: 'beast', creature: 'stego', paint: 'totem' },
    mods: { hp: 1.05, sp: 1.0, mp: 1.15, speed: 0.9, armor: 16 },
    light: { name: '防衛機槍', rw: 'MG3 7.62・初速 820m/s', type: 'gun', mv: 820,
      dmg: [14, 18, 22], rate: 8, mag: [40, 48, 56], reload: 2.2, range: 190, crit: 0.06,
      vs: { flesh: 1.3, armor: 0.7, air: 1.0, building: 0.5 } },
    heavy: { name: '見證者巡飛彈', rw: 'Shahed 縮裝・巡飛 100m/s', type: 'missile', mv: 100,
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
    visual: { hue: 0x7fe8c9, pod: 'none', proto: 'aegis', paint: 'tattoo' },
    mods: { hp: 1.0, sp: 1.15, mp: 1.2, speed: 1.0, armor: 16 },
    light: { name: '30mm 速射砲', rw: '2A42 縮裝・初速 960m/s', type: 'gun', mv: 960,
      dmg: [18, 22, 27], rate: 5.5, mag: [28, 34, 40], reload: 2.3, range: 210, pen: 6,
      vs: { flesh: 1.1, armor: 1.0, air: 1.5, building: 0.5 } },
    heavy: { name: '攔截者飛彈', rw: '9M330 縮裝・初速 800m/s', type: 'missile', mv: 800,
      dmg: [120, 155, 195], r: [11, 13, 15], cd: [7, 6, 5], range: 340, pen: 6,
      vs: { flesh: 0.7, armor: 0.7, air: 2.4, building: 0.4 } },
    skill: { name: '彈道預解', fx: 'intercept', r: [160, 200, 240],
      cd: [15, 13, 11], mp: [30, 35, 40], desc: '攔截永遠該比打擊便宜:清空來襲飛彈' },
    ult: { name: '不可攔截區', fx: 'buff', target: 'team', r: 220, mul: { dmgTaken: [0.55, 0.45, 0.35] },
      dur: [6, 7, 8], cd: [80, 70, 60], mp: [90, 100, 110], desc: '頭巾內襯的那頁詩:友軍承傷大減' },
  },
  t11: {
    side: 'STEEL', name: '拉斐爾・富恩特斯', code: '老雪茄', machine: '「老兵」戰術指導機',
    visual: { hue: 0x8a9a5a, pod: 'antenna', form: 'biped', creature: 'trex', paint: 'camo' },
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
    side: 'STEEL', name: '阿列霞・卡爾波維奇', code: '螢火', machine: '「巨兵」訊號掃描機',
    visual: { hue: 0xb8ffb0, pod: 'none', proto: 'colossus', paint: 'tattoo' },
    mods: { hp: 0.9, sp: 1.15, mp: 1.3, speed: 1.05, armor: 12 },
    light: { name: '掃描脈衝槍', rw: '低功率相位雷射・光速直擊', type: 'beam',
      dmg: [13, 16, 20], rate: 10, mag: [40, 50, 60], reload: 1.8, range: 170, crit: 0.08,
      vs: { flesh: 1.3, armor: 0.5, air: 1.0, building: 0.4 } },
    heavy: { name: '標定脈衝砲', rw: 'EM 標定彈・初速 2500m/s', type: 'rail', mv: 2500, charge: [1.2, 1.05, 0.9],
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
  // 型態兩類等比例(4/4,原型迴避兩陣營既有生物:蜂/翼龍/飛龍/鷹/猩猩/鴕鳥/袋鼠/暴龍/獵犬/人馬/克蘇魯/劍龍):
  //  A 類 定翼/旋翼 ↔ 人形(地面型各有體態,不再共用一套站姿):
//       m01 heli↔vampire(挺立高領・三旋翼:機首桅 + 雙腿末端,飛行雙腿與機身呈 Y 字)、
//       m03 uav↔monkey(悟空:掌行猴姿;飛行「不」變形成飛機 —— 展開不揮動的光之翼、
//           體軸壓平雙腿併攏、多節尾蠍式前捲讓尾端巨砲朝前備射)、
//       m05 jet↔wolf(趾行深屈・鬃刺肩尖)、m06 tilt↔atlas(負重前傾・雙肩掛架;手持圓盾=傾轉旋翼盤)
  //  B 類 擬態翼 ↔ 四足獸:m02 levi↔elephant、m04 archo↔raptor、m07 beetle、m08 owl↔panther
  m01: {
    side: 'MERC', kind: 'morph', name: '德揚・科瓦奇', code: '渡鴉', machine: '「渡鴉」可變式突襲機甲',
    visual: { hue: 0xd94f4f, pod: 'rack', flight: 'heli', ground: 'vampire', bulk: 1.0, paint: 'minimal' },
    mods: { hp: 1.0, sp: 1.05, mp: 1.0, speed: 1.1, armor: 7 },
    light: { name: '7.62 六管速射艙', rw: 'M134 Minigun・初速 850m/s', type: 'gun', mv: 850,
      dmg: [11, 14, 17], rate: 12, mag: [60, 75, 90], reload: 2.4, range: 185, crit: 0.05,
      vs: { flesh: 1.3, armor: 0.6, air: 1.3, building: 0.4 } },
    heavy: { name: '地獄火反裝甲彈', rw: 'AGM-114 縮裝・鎖定追蹤・初速 450m/s', type: 'missile', mv: 450,
      dmg: [150, 195, 245], r: [12, 14, 16], cd: [9, 8, 7], range: 320, pen: [14, 18, 22],
      vs: { flesh: 0.9, armor: 1.7, air: 0.5, building: 1.1 } },
    skill: { name: '違約金條款', fx: 'dash', imp: [27, 33, 39],
      cd: [12, 10, 8], mp: [25, 30, 35], desc: '哪邊付錢都一樣快:沿視線爆發脫離' },
    ult: { name: '加班費三倍', fx: 'buff', target: 'self', mul: { dmg: [1.35, 1.45, 1.55], reload: [0.8, 0.75, 0.7] },
      dur: [8, 10, 12], cd: [75, 65, 55], mp: [80, 90, 100], desc: '合約外時段:火力與填彈全面超載' },
  },
  m02: {
    side: 'MERC', kind: 'morph', name: '巴澤爾・奧坎', code: '磐石', machine: '「磐石」重型可變機甲',
    visual: { hue: 0x9aa3ad, pod: 'shield', flight: 'levi', ground: 'elephant', bulk: 1.3, paint: 'totem' },
    mods: { hp: 1.25, sp: 0.9, mp: 0.95, speed: 0.9, armor: 24 },
    light: { name: '7.62 通用機槍', rw: 'FN MAG・初速 840m/s', type: 'gun', mv: 840,
      dmg: [16, 20, 25], rate: 7, mag: [40, 48, 56], reload: 2.2, range: 195, crit: 0.05,
      vs: { flesh: 1.3, armor: 0.8, air: 0.9, building: 0.5 } },
    heavy: { name: '重型線圈加農砲', rw: '大口徑線性馬達砲・初速 1800m/s', type: 'rail', mv: 1800, charge: [1.8, 1.5, 1.3],
      dmg: [160, 210, 260], cd: [9, 8, 7], range: 360, crit: 0.1, critX: 1.8, pen: [20, 25, 30],
      vs: { flesh: 0.9, armor: 1.7, air: 0.4, building: 1.0 } },
    skill: { name: '掩體協議', fx: 'buff', target: 'self', mul: { dmgTaken: [0.6, 0.55, 0.5] },
      dur: [4, 5, 6], cd: [16, 14, 12], mp: [30, 35, 40], desc: '雇主的貨要緊:承傷大減' },
    ult: { name: '押運合約', fx: 'buff', target: 'team', r: 200, mul: { dmgTaken: [0.7, 0.62, 0.55] },
      dur: [6, 8, 10], cd: [80, 70, 60], mp: [85, 95, 105], desc: '這一單保到底:半徑內友軍承傷降低' },
  },
  m03: {
    side: 'MERC', kind: 'morph', name: '伊內絲・杜阿爾特', code: '帳房', machine: '「帳房」後勤可變機甲',
    visual: { hue: 0x59c9a5, pod: 'dish', flight: 'uav', ground: 'monkey', bulk: 0.95, paint: 'minimal' },
    mods: { hp: 0.95, sp: 1.15, mp: 1.2, speed: 1.0, armor: 5 },
    light: { name: '護衛脈衝雷射艙', rw: '低功率防禦雷射・光速直擊', type: 'beam',
      dmg: [15, 19, 23], rate: 8, mag: [30, 36, 42], reload: 1.9, range: 175, crit: 0.07,
      vs: { flesh: 1.4, armor: 0.5, air: 1.1, building: 0.4 } },
    heavy: { name: '空投截擊彈', rw: 'APKWS 雷射導引・初速 700m/s', type: 'launcher', mv: 700, guide: 1,
      dmg: [120, 160, 200], r: [11, 13, 15], cd: [8, 7, 6], range: 300, pen: 8,
      vs: { flesh: 1.1, armor: 1.2, air: 1.2, building: 1.0 } },
    skill: { name: '戰地保單', fx: 'heal', target: 'team', r: 150, heal: [140, 200, 260],
      cd: [20, 18, 16], mp: [40, 45, 50], desc: '先修好再收錢:半徑內友軍裝甲回復' },
    ult: { name: '年度結算', fx: 'heal', target: 'team', r: 220, heal: [260, 350, 440], sp: true,
      cd: [85, 75, 65], mp: [90, 100, 110], desc: '大帳一次結清:裝甲大修、護盾充滿' },
  },
  m04: {
    side: 'MERC', kind: 'morph', name: '奧莉薇亞・松', code: '霧行者', machine: '「霧行者」偵獵可變機甲',
    visual: { hue: 0xb59ce8, pod: 'antenna', flight: 'archo', ground: 'raptor', bulk: 0.85, paint: 'camo' },
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
    visual: { hue: 0xe0a13a, pod: 'antenna', flight: 'jet', ground: 'wolf', bulk: 1.05, paint: 'tattoo' },
    mods: { hp: 1.1, sp: 1.0, mp: 1.15, speed: 0.95, armor: 16 },
    light: { name: '12.7 電磁機砲', rw: 'GAU-19 線圈化改裝・初速 1300m/s', type: 'rail', mv: 1300,
      dmg: [19, 24, 30], rate: 6, mag: [36, 44, 52], reload: 2.4, range: 200, crit: 0.06,
      vs: { flesh: 1.2, armor: 1.0, air: 0.9, building: 0.6 } },
    heavy: { name: '追債者制導彈', rw: '射後鎖定制導彈・初速 400m/s', type: 'missile', mv: 400,
      dmg: [150, 195, 245], r: [13, 15, 17], cd: [9, 8, 7], range: 330, pen: [12, 15, 18],
      vs: { flesh: 1.0, armor: 1.5, air: 0.5, building: 1.2 } },
    skill: { name: '斷路協議', fx: 'emp', r: 130, dur: [2.5, 3, 3.5], range: 250,
      cd: [18, 16, 14], mp: [40, 45, 50], desc: '欠債不還就斷電:指定區域敵軍武器離線' },
    ult: { name: '連本帶利', fx: 'strike', count: [6, 8, 10], dmg: [80, 100, 125], r: 11, scatter: 38,
      range: 330, pen: 10, cd: [78, 68, 58], mp: [88, 98, 108], vs: { armor: 1.3, building: 1.2 },
      desc: '逾期利滾利:對指定座標飽和清算打擊' },
  },
  m06: {
    side: 'MERC', kind: 'morph', name: '圖里奧・費雷拉', code: '外包', machine: '「外包」母艦式可變機甲',
    visual: { hue: 0xf0c24a, pod: 'rack', flight: 'tilt', ground: 'atlas', bulk: 1.15, paint: 'graffiti' },
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
    visual: { hue: 0x5fa8d3, pod: 'shield', flight: 'beetle', ground: 'beetle', bulk: 1.25, paint: 'totem' },
    mods: { hp: 1.15, sp: 1.05, mp: 1.1, speed: 0.9, armor: 20 },
    light: { name: '雙 35 快砲', rw: 'Oerlikon 縮裝・初速 1100m/s', type: 'gun', mv: 1100,
      dmg: [18, 23, 28], rate: 6.5, mag: [32, 40, 48], reload: 2.6, range: 210, crit: 0.05,
      vs: { flesh: 1.0, armor: 0.9, air: 1.6, building: 0.5 } },
    heavy: { name: '區域拒止電漿陣列', rw: '近迫電漿散射・扇形攔截', type: 'plasma', arc: [22, 25, 28],
      dmg: [110, 145, 180], cd: [6, 5, 4], range: 264, pen: 8,
      vs: { flesh: 0.8, armor: 1.0, air: 2.2, building: 0.3 } },
    skill: { name: '拒止穹頂', fx: 'intercept', r: [160, 200, 240],
      cd: [16, 14, 12], mp: [30, 35, 40], desc: '一手交錢一手交貨:清空半徑內來襲飛彈' },
    ult: { name: '全域布防', fx: 'strike', count: [7, 9, 11], dmg: [65, 80, 100], r: 9, scatter: 40,
      range: 320, cd: [74, 66, 58], mp: [85, 95, 105], vs: { air: 2.0, flesh: 1.2 },
      desc: '把整片天空劃進責任區:防空彈幕封鎖' },
  },
  m08: {
    side: 'MERC', kind: 'morph', name: '芮娜・沃斯', code: '尾款', machine: '「尾款」隱形狙擊可變機甲',
    visual: { hue: 0x8f7fd0, pod: 'blade', flight: 'owl', ground: 'panther', bulk: 0.85, paint: 'camo' },
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
    soldier: 15, apc: 35, tank: 80, tower: 200, drone: 150, robot: 150, morph: 150, missile: 15, aasite: 40, decoy: 25,
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
  // 射程一律 < 防禦塔(2026-07-12 起,見 UNITS.tower):沒有「安全圍攻位」,推塔要靠人數/血量硬吃塔火。
  // hp/armor/dmg 大幅上調(2026-07-12「拉近 NPC 與玩家戰力」):小兵不再是英雄的移動經驗值 ——
  // 步槍兵 EHP 320、火箭兵一發 95,三隻步槍兵齊射就足以逼退半血機甲。
  // 2026-07-13「一波 NPC = 玩家 60% EHP」校準:單挑同線一波(3 步槍兵 + 火箭兵 + 榴彈兵 + 直升機)
  // 全員在射程內持續開火、玩家只用 Lv1 輕武器 + 重武器 CD ⇒ 清完波後平均剩 ~40% EHP。
  // 由此反推(舊值 ×0.5 傷害 / ×0.6 HP;armor 不動)—— 改任一項 MUST 重跑 `npm run bal`。
  // 移動速度校準(2026-07-13):一波平均 ≈ robot.speed(21)× 75% ≈ 15.8,兵團像推進的軍隊而非爬行。
  soldier:   { name: '步槍兵', hp: 180, armor: 8,  dmg: 8,  range: 150, rate: 1.0, speed: 16, sight: 150, bounty: 1, wid: 'rgun' },
  rocketeer: { name: '火箭兵', hp: 230, armor: 12, dmg: 48, range: 180, rate: 0.4, speed: 15, sight: 190, bounty: 3, wid: 'rocket' },
  howitzer:  { name: '榴彈兵', hp: 280, armor: 18, dmg: 55, range: 220, rate: 0.3, speed: 12, sight: 220, bounty: 4, wid: 'siege' },
  heli:      { name: '攻擊直升機', hp: 420, armor: 14, dmg: 28, range: 175, rate: 0.8, speed: 20, sight: 220, bounty: 6, wid: 'rgun' },
  // 舊兵種資料保留(不再於一般波次生成,供召喚/測試沿用)
  apc:     { name: '裝甲車', hp: 320,  armor: 10, dmg: 22, range: 100, rate: 0.9, speed: 11, sight: 170, bounty: 2, wid: 'rgun' },
  tank:    { name: '主戰坦克', hp: 750, armor: 22, dmg: 55, range: 150, rate: 0.6, speed: 9,  sight: 200, bounty: 4, wid: 'siege' },
  // 建築(防禦塔兼防空:對高空無人機發射追蹤飛彈;飛彈本身可被擊毀)
  // range 310(2026-07-12):**恆大於所有玩家輕武器(最大 270 = drone sight 300 × RANGE_SIGHT_F)
  // 與所有 NPC(最大 220 = 榴彈兵)**,且 > 輕武器射程 + 同塔位左右塔間距(2×TOWER_SIDE_OFF)
  // ⇒ 打其中一座塔,必定同時吃到另一座的覆蓋火力。改 sight/RANGE_SIGHT_F/TOWER_SIDE_OFF
  // MUST 重驗這條不等式(sim._spawnStructures 的塔距守衛也吃 range)。
  // hp/armor(2026-07-12):兩位機甲玩家(lvl1,無人干擾)集火單塔 ≈ 13~14s 拆掉,
  // 期間兩座塔的回擊 ≈ 1.8 × 機甲 EHP(981)⇒ 剛好擊殺一位、把另一位壓到 ~20%。
  // 推導:towerHp = 1.8 × heroEHP × heroDPS / towerDPS。改任一邊 MUST 重算(tools 的 _bal 推導)。
  tower:   { name: '防禦塔', hp: 1800, armor: 30, dmg: 65, range: 310, rate: 1.0, speed: 0,  sight: 310,
             sam: { name: '防空飛彈', dmg: 130, range: 240, cd: 4, speed: 120, hp: 40, pen: 8 } },
  base:    { name: '主堡',   hp: 3000, armor: 25, dmg: 90, range: 230, rate: 1.2, speed: 0,  sight: 230 },
  // 英雄基準(實戰值 × CHARACTERS[ch].mods):護盾 shield 非戰鬥自然回復、
  // 裝甲 hp 只能回主堡 / 治療招式回復;mp = 電力(施放小招/大招消耗)。
  // 無人機 = 三機小隊(SQUAD.N):單機 hp/shield 由 SQUAD.BUFF 於 UNITS 之後 derive
  // (= 機甲 ÷ N × BUFF;MUST NOT 手寫,寫死就會與 SQUAD.DMG 漂移),傷害折算在 heroWeapon()。
  // 每一架各自重生、各自吃冷卻(與機甲同表)。
  drone: {
    name: '獵蜂無人機', hp: 0, shield: 0, mp: 100, mpRegen: 4,
    // fov/zoomFov 與機甲一致(2026-07-12):FPV 視覺大小感受度雙陣營必須相同,
    // 廣角會把同距離目標畫小(舊 100/55 = 無人機看 NPC 比機甲小一號)。
    speed: 42, vspeed: 22, fov: 68, zoomFov: 35, sight: 300,
    bomb: 'bomb',                        // F 鍵原地引爆 / 高速撞擊引爆(自毀);僚機衝刺自爆
    regen: 12,
    respawn: { base: 8, perDeath: 2 },   // 重生需冷卻,越死越久(單機獨立計數)
  },
  robot: {
    // sight 240(原 220):輕武器射程被 rangeCap 夾到 sight×0.9,220 會把全機甲輕武器砍到
    // 198m(#INC-104 的 y=250 高空射擊測試要求 ×1.25 > 250)。240 = 與變形機甲齊平。
    // fov 68:自然人眼的舒適垂直視角 = 全機種 FPV 基準(2026-07-12 起無人機/變形機甲一律對齊,
    // 雙陣營同距離目標的視覺大小才一致;差異化只靠座艙造型與視點高度)
    name: '執法者機甲', hp: 640, shield: 220, mp: 100, mpRegen: 4,
    speed: 21, jump: 9, fov: 68, zoomFov: 35, sight: 240,
    regen: 18,
    respawn: { base: 8, perDeath: 2 },   // 重生需冷卻,越死越久
  },
  // 餌機:機甲的外掛子機(F 分離發射)。hp 於生成時覆寫為主機甲上限 × DECOY.HP_F;
  // speed:0 = 不進 sim 主迴圈的推線邏輯(位置由 _tickDecoys 管),但仍是敵方小兵/塔的合法目標。
  decoy: { name: '餌機', hp: 160, armor: 0, speed: 0, sight: DECOY.SIGHT },
};
// 三機小隊單機生存值的唯一推導處(見 SQUAD.BUFF):三架合計 = 機甲 × BUFF
UNITS.drone.hp = Math.round(UNITS.robot.hp / SQUAD.N * SQUAD.BUFF);
UNITS.drone.shield = Math.round(UNITS.robot.shield / SQUAD.N * SQUAD.BUFF);
// 傭兵變形機甲:HP/護盾/電力/回復/重生一律與機甲相同(spread 保證不漂移),
// 差異只有移動能力(地面 + 蓄力跳變形飛行)與視野;傷害不吃 SQUAD 折算(charKind ≠ drone)。
UNITS.morph = {
  ...UNITS.robot,
  name: '變形機甲',
  fly: 36, vspeed: 20,                  // 飛行型態:巡航 / 垂直速度(略慢於無人機)
  fov: 68, fovAir: 68, zoomFov: 35, sight: 240,   // 全型態 = 人眼視角(FPV 視覺大小雙陣營一致,飛行不再放寬)
};
// 主堡加裝兩門大砲:射程/傷害/射速一律 derive 自砲塔(MUST NOT 手抄),獨立於主堡本體火砲。
UNITS.base.guns = { n: 2, range: UNITS.tower.range, dmg: UNITS.tower.dmg, rate: UNITS.tower.rate };

// ---- 對局節奏(緊湊化:1/2/3 線目標 5/8/10 分鐘一場)----
export const GAME = {
  TICK_MS: 125,               // 伺服器模擬 8Hz
  SNAP_MS: 125,               // 快照廣播 8Hz
  // 波次節奏:前期慢(對線期長,英雄有時間補刀/囤錢),中後期逐波加速到 MIN_S
  WAVE_PACE: { START_S: 34, MIN_S: 14, RAMP_FROM: 4, RAMP_TO: 14 },
  FIRST_WAVE_DELAY_S: 0,      // 開局即出第一波(從主堡出發),不再空等對線
  WAVE_SPAWN_OFF_M: 34,       // 波次生成點離己方主堡的沿線距離:落在主路線上、出主堡外(base R 22)
  WAVE_COHESION_M: 26,        // 同波僚兵最大脫節距離:領先者原地等最慢的(交戰中除外)
  WAVE_SOLDIERS: 3,           // 每波每兵線步槍兵數(另加固定 1 火箭兵/1 榴彈兵/1 攻擊直升機)
  HELI_ALT: 26,               // 攻擊直升機巡航高度(公尺;純視覺+高空降權判定用)
  AIM_SIGHT_MULT: 1.6,        // 瞄準模式視野加成(狙擊模式看得更遠)
  // 玩家可操作機體的射程上限比例:射程 = min(基準×HEROIC, sight×(重武器再×AIM_SIGHT_MULT)×此值)。
  // 恆 < 1 ⇒ 射程一定小於視野;見 rangeCap()。
  RANGE_SIGHT_F: 0.9,
  // 防禦塔在兵線上的位置(距己方主堡比例)。**最前線那一組是解出來的,不是寫死的**:
  // 0.30 只是後備/起始提示,實際 frac 由 solveTowerSites() 沿兵線搜到「敵我最近兩塔
  // 直線距離 = tower.range × TOWER_SEP_F」為止(兵線可能 90° 急彎 ⇒ 沿線距離遠 ≠ 直線距離遠)。
  TOWER_FRACS: [0.16, 0.30],
  // 最前線敵我塔的射程重疊率(2026-07-13):兩座塔的攻擊距離(半徑 R)沿連心線重疊 2R − d。
  // 要求「重疊 80% 的射程」⇒ 2R − d = 0.8R ⇒ d = 1.2R = TOWER_SEP_F × R。
  // d = 1.2R > R ⇒ 同時滿足「不在彼此射程內」(塔不對射,但戰場中線必被雙方火力交疊)。
  TOWER_OVERLAP: 0.8,
  TOWER_SEP_F: 0,             // 於下方 derive = 2 − TOWER_OVERLAP(MUST NOT 手寫)
  TOWER_MIN_FRAC: 0.09,       // 塔位沿線搜尋下限(不得退進主堡懷裡)
  TOWER_MAX_FRAC: 0.45,       // 塔位沿線搜尋上限(不得越過戰場中線)
  // 塔位橫向偏移(公尺):每個塔位在兵線左右各一座,砲塔不擋路、交叉火力涵蓋走廊
  TOWER_SIDE_OFF: 15,
  // 直射武器的鎖定天花板(公尺):高過此高度的飛行單位塔砲/小兵打不到(交給 SAM)。
  // MUST 與 range 脫鉤 —— 綁 range×0.9 的話,塔射程一拉高就會把 #INC-104 的 y=250 高空機也鎖住。
  GUN_CEIL_M: 170,
  CREEP_AGGRO_HERO_BIAS: 0.7, // 小兵優先打小兵/建築,英雄目標權重
  HERO_HEAL_RADIUS: 160,      // 主堡補血半徑(也是軍械庫購物範圍)
  // 出生/重生點:主堡朝敵方向外推距離。> 主堡護盾半徑 30 + 模型半徑 ~23,
  // 剛好落在堡外、遠在補血半徑內(舊值 100 是 8× 超尺度世界時代校的,重生跑回堡太遠)
  HERO_SPAWN_OFF: 45,
  // 出生/重生點橫向偏移(公尺):沿兵線推出主堡後只微偏到路旁(更靠近兵線,一出生就正對兵線箭頭)——
  // 不擋在路中央,又貼著兵線走廊(< 半寬 LANE_SAFE_M 45)。
  HERO_SPAWN_SIDE: 8,
  BASE_ARMOR_NEED_CREEP: 0.35,// 沒有己方小兵在場時打主堡的傷害折減
  AA_MIN_ALT: 40,             // 兵線走廊上:防空飛彈只鎖定離地 ≥ 40m 的無人機(低飛吃塔砲)
  LANE_SAFE_M: 45,            // 正規路線走廊半寬(僚機歸隊/地形不放大的走廊)
  // 第三方打擊(地雷 / 匿蹤防空伏擊)的「非正規路線」判定半徑(2026-07-12):
  // **稍微偏離主要路線不該被打到** ⇒ 觸發與佈設淨空一律用這個(遠大於走廊半寬 45),
  // 且雷區/陣地另外避開主堡、重生點與砲塔。MUST NOT 改回用 LANE_SAFE_M 當伏擊閘門。
  AMBUSH_M: 110,
  // 第三方打擊總量(2026-07-12 二修):**地雷與匿蹤防空的「打擊面積」相等,且總量大幅下修**。
  //   每線每種的打擊面積 = THREAT_AREA_PER_LANE(m²)——
  //   地雷:PER_LANE × π×R²(由面積反推顆數);防空:AA_SITES_PER_LANE × π×range²(由面積反推射程)。
  //   兩者一律在下方 derive(**MUST NOT** 手寫 MINES.PER_LANE / AA_SITE.range,會破壞等面積約束)。
  // 舊制實際面積:地雷 7.9k/線、防空 637k/線(陣地射程 260)⇒ 天差地遠且防空幾乎覆蓋全場。
  THREAT_AREA_PER_LANE: 20000,
  THREAT_CD_S: 180,           // 同一機體被第三方打擊(踩雷 / 被伏擊)後的冷卻:3 分鐘,兩者共用
  THREAT_MISSILES_MAX: 1,     // 同時在空中的第三方伏擊飛彈上限(全場 1 發)
  // 地雷(非正規路線,只有地面機甲會踩;顏色融入地表,靠近才看得到極輕微突起)
  // CUT_BIAS/CUT_R:偏向佈在兵線轉角外圍的「切彎捷徑」帶 — 抄直線省時間 = 承擔雷區風險
  MINES: { PER_LANE: 0, TRIGGER_R: 4, DMG: 170, R: 10, PEN: 10,
           LANE_CLEAR: 115,            // > AMBUSH_M:走廊 + 緩衝帶內絕不佈雷(含雷體半徑 R)
           BASE_CLEAR: 260,            // > 主堡補血半徑 160 + 重生點外推 45 + 緩衝
           TOWER_CLEAR: 90,            // 砲塔周邊淨空(塔下不佈雷)
           SEE_M: 30, CLEAR_M: 14,     // 客戶端:SEE_M 內開始浮現,CLEAR_M 內完全可見
           CUT_BIAS: 0.5, CUT_R: 70 },
  // 匿蹤防空伏擊(非正規路線的無人機):命中直接擊墜;飛彈可被擊毀。
  // 觸發需要射程內有存活的匿蹤防空陣地(aasite)——拔掉陣地 = 打出安全空域。
  // DMG 620:雙層 HP 後仍須一發穿透護盾+裝甲直接擊墜(維持「命中即墜」設計)。
  AA_AMBUSH: { CHANCE_PER_S: 0.22, DMG: 620, SPEED: 130, HP: 40, PEN: 20 },
};
// ---- 閃避(2026-07-14)----
// 有效機動(移速)> MOBILITY_MIN 的機體,在「移動中」對「輕武器直射」有機率完全閃開;
// 飛行單位額外加成(蜂群靠機動求生)。純伺服器結算(命中本就 server-authoritative,
// 客戶端只回報命中)。**只在移動中生效** ⇒ bal 的靜止對射清波情境不受影響(仍是站樁 DPS)。
export const EVASION = {
  MOBILITY_MIN: 20,   // 有效移速(m/s)> 此值才具閃避 —— 重甲慢速機體站著吃彈
  MOVING_SPD: 3,      // 判定「移動中」的最低瞬時速度(m/s)
  GROUND: 0.20,       // 地面移動:閃避率
  AIR_BONUS: 0.15,    // 飛行單位(無人機 / 變形機飛行型)額外加成
};
// 機體有效機動 = 機種基準移速(飛行取 fly)× 角色 speed 修正
export const heroMobility = (kind, mods, flying = false) => {
  const u = UNITS[kind];
  if (!u) return 0;
  return (flying ? (u.fly ?? u.speed) : u.speed) * (mods?.speed ?? 1);
};

// 等面積約束的唯一推導處(見 GAME.THREAT_AREA_PER_LANE)
GAME.MINES.PER_LANE = Math.round(GAME.THREAT_AREA_PER_LANE / (Math.PI * GAME.MINES.R ** 2));
// 塔距 = 射程重疊率的唯一推導處(見 GAME.TOWER_OVERLAP)
GAME.TOWER_SEP_F = 2 - GAME.TOWER_OVERLAP;

/**
 * 塔位求解(sim._spawnStructures 與 biomes 淨空共用的唯一的縫)。
 * lanes: [[x,z], …][] — 兵線折線(世界公尺;index 0 = SWARM 主堡端)。
 * 回傳 lanes.map(sites[]),每個 site = { frac, SWARM:{x,z,nx,nz}, STEEL:{…} };
 * 實際砲塔 = site 沿法線 ±TOWER_SIDE_OFF 各一座。
 *
 * 規則(2026-07-13):**最前線那一組**沿兵線前後搜到「敵我最近兩塔直線距離 ≈ R×TOWER_SEP_F」
 * (= 射程重疊 TOWER_OVERLAP、且 > R 故不對射);後方塔組維持「只往己方主堡收」的舊守衛。
 * MUST 用直線距離判定 —— 兵線 90° 急彎時沿線距離會騙過去。
 */
export function solveTowerSites(lanes) {
  const R = UNITS.tower.range, SEP = R * GAME.TOWER_SEP_F, OFF = GAME.TOWER_SIDE_OFF;
  const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const geom = (pts) => {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1];
    const at = (d) => {
      d = Math.max(0, Math.min(total, d));
      let i = 1;
      while (i < cum.length - 1 && cum[i] < d) i++;
      const f = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
    };
    return { total, at };
  };
  const placed = [];   // 已定案的砲塔(跨兵線也要守距離){ side, x, z }
  const out = [];
  for (const pts of lanes) {
    const { total, at } = geom(pts);
    const site = (side, frac) => {
      const d = side === 'SWARM' ? total * frac : total * (1 - frac);
      const [x, z] = at(d);
      const [ax, az] = at(d - 1), [bx, bz] = at(d + 1);
      const len = Math.hypot(bx - ax, bz - az) || 1;
      return { x, z, nx: (bz - az) / len, nz: -(bx - ax) / len };
    };
    const towers = (p) => [-1, 1].map((s) => ({ x: p.x + p.nx * OFF * s, z: p.z + p.nz * OFF * s }));
    // 這個 frac 下,敵我最近兩塔的直線距離(含跨兵線已定案的塔)
    const minGap = (pS, pT) => {
      const S = towers(pS), T = towers(pT);
      let m = Infinity;
      for (const a of S) for (const b of T) m = Math.min(m, d2(a, b));
      for (const q of placed) {
        const mine = q.side === 'STEEL' ? S : T;
        for (const a of mine) m = Math.min(m, d2(a, q));
      }
      return m;
    };
    const sites = [];
    for (let j = 0; j < GAME.TOWER_FRACS.length; j++) {
      const frac0 = GAME.TOWER_FRACS[j];
      const front = j === GAME.TOWER_FRACS.length - 1;
      let best = null;
      if (front) {
        // 前線:全區間掃描,取「≥ SEP 且最貼近 SEP」的 frac ⇒ 重疊率剛好 TOWER_OVERLAP
        let bestGap = Infinity;
        for (let f = GAME.TOWER_MIN_FRAC; f <= GAME.TOWER_MAX_FRAC + 1e-9; f += 0.002) {
          const pS = site('SWARM', f), pT = site('STEEL', f);
          const gap = minGap(pS, pT);
          if (gap >= SEP && gap < bestGap) { best = { f, pS, pT }; bestGap = gap; }
        }
      } else {
        // 後方:從 frac0 往己方主堡收,第一個滿足距離的即定案(維持原設計的沿線位置)
        for (let f = frac0; f >= GAME.TOWER_MIN_FRAC - 1e-9; f -= 0.002) {
          const pS = site('SWARM', f), pT = site('STEEL', f);
          if (minGap(pS, pT) < SEP) continue;
          best = { f, pS, pT };
          break;
        }
      }
      if (!best) {           // 兵線太短:退到下限(接受重疊超標,總比塔疊在一起好)
        const f = GAME.TOWER_MIN_FRAC;
        best = { f, pS: site('SWARM', f), pT: site('STEEL', f) };
      }
      for (const [side, p] of [['SWARM', best.pS], ['STEEL', best.pT]]) {
        for (const t of towers(p)) placed.push({ side, x: t.x, z: t.z });
      }
      sites.push({ frac: best.f, SWARM: best.pS, STEEL: best.pT });
    }
    out.push(sites);
  }
  return out;
}

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
  AA_SITES_PER_LANE: 2,  // 匿蹤防空陣地 / 兵線
  // range 由等面積約束推導(見下方);laneMin 130 > GAME.AMBUSH_M(110):陣地不蹲在走廊邊緣
  AA_SITE: { name: '匿蹤防空陣地', hp: 120, range: 0, laneMin: 130, laneMax: 300, spacing: 130,
             baseClear: 260, towerClear: 90 },
  // 偵察中繼站(D1 神龕思想:非正規路線上的一次性正向誘因)——
  // 停留 CHANNEL_S 秒佔用 → 全隊 VISION_S 秒無霧視野;先到先得,用過即毀。
  RELAY: { name: '偵察中繼站', PER_LANE: 1, R: 14, CHANNEL_S: 3, VISION_S: 18,
           laneMin: 70, laneMax: 220, dLo: 0.38, dHi: 0.62 },
  CONNECT_CELL_M: 24,    // 連通性 flood-fill 網格(DevilutionX DRLG 思想:生成後驗證兩堡互通)
};
// 等面積約束的唯一推導處:防空陣地的射程 = 「每線打擊面積 ÷ 陣地數」的等效圓半徑
// ⇒ 每線防空打擊面積 = 每線地雷打擊面積(見 GAME.THREAT_AREA_PER_LANE)
FIELD.AA_SITE.range = Math.round(
  Math.sqrt(GAME.THREAT_AREA_PER_LANE / (Math.PI * FIELD.AA_SITES_PER_LANE)));

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
