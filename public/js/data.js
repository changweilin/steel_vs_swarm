// ============ 無人戰略:鋼鐵與蜂群 — 共用遊戲常數 ============
// 伺服器(server/sim.js)與前端(game.js)共用同一份數值,
// 模式沿用 ai_tycoon:server 直接 import '../public/js/data.js'。
import { BOT_POLICY } from './botPolicy.js';   // 電腦玩家學習策略(工具產出;見檔尾 BOT_LEARN 區塊)

// ---- 陣營 ----
export const SIDES = {
  SWARM: {
    id: 'SWARM',
    name: '蜂群兵團',
    en: 'THE SWARM',
    // hero = 該陣營的**主力機種**(也是 heroKindOf 查不到角色時的退路);
    // 2026-08-02 混編改制後陣營不再只有單一機種,角色機種一律以 CHARACTERS[ch].kind 為準。
    hero: 'drone',
    heroName: '獵蜂無人機',
    color: '#ffb300',      // 琥珀警示黃
    colorDim: '#8a6a10',
    desc: '以無人機為主力(7 無人機 / 3 機甲 / 2 變形機甲)。速度快、機動高、血量薄;垂直機動掌握制空權。',
  },
  STEEL: {
    id: 'STEEL',
    name: '鋼鐵軍團',
    en: 'STEEL LEGION',
    hero: 'robot',
    heroName: '執法者機甲',
    color: '#4fc3f7',      // 鋼鐵冷藍
    colorDim: '#1a5c78',
    desc: '以重型機甲為主力(7 機甲 / 3 無人機 / 2 變形機甲)。裝甲厚、火力猛、抗打擊;地面推進碾碎一切。',
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
  // 地圖外擴倍率(2026-07-17):battleBBox 繞中心等比放大,**兵線/主堡/塔位一律不動**。
  // 目的:第三方野營的佈營硬約束(離每座砲塔 ≥ 射程×CLEAR_F=388m)在真實地圖尺寸
  //   (L1 兩堡遊戲距離 ≈962m)下,舊 5% pad 幾乎無側翼合法區 → L1 完全不生成野營。
  //   放大側翼淨空(不動兵線 ⇒ 不需重烤 venueLanes、不需 +GEO_SCALE_VER:battleBBox 為
  //   執行期由 config 推導,「我的最愛」存的是 lanes/sizeM/bases 而非 bbox,不受影響)。
  MAP_EXPAND: 1.33,
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
  // 兵線「往主堡折返」上限:沿 A→B 主軸投影,累加所有進度倒退的段長 ÷ 兩堡直線距離。
  // > 此值 = 路線繞回頭路折返主堡過多(側翼 via-point 偶會把路徑吸回起點),生成階段淘汰。
  // 與 MAX_OVERLAP 同性質(生成時硬門檻,伺服器不複驗;見 laneBacktrackFrac)。
  MAX_BACKTRACK: 0.20,
  // 兵線「接近 180° 迴轉」上限(度,2026-07-28 使用者需求):沿主軸重取樣後,任一處局部
  // 航向反轉 ≥ 此角度 = 掉頭迴轉 → 生成期硬門檻淘汰(側翼 via / REUSE 重罰偶會逼出「上橋
  // 再折回」式掉頭)。與 laneTacticsXZ 同一組取樣語彙(TACTICS.SEG_M 步長,避免 OSRM 密集
  // 頂點鋸齒誤判)。結算縫 = laneUTurnAudit();bake 硬門檻、mapSelect 複驗共用同一支。
  UTURN_MAX_DEG: 150,
  // 兵線「主軸偏航累積」範圍(度,2026-07-29 使用者需求「轉彎角度累積不可超過範圍之外,
  // 順逆時針轉向可抵消」;同日改制:量測基準由「出發航向」改為「A→B 主軸」,門檻收緊至
  // 150):以「首段航向 − 主軸」的帶號夾角為初值,沿線帶號轉向角逐段累加(左轉正/右轉負
  // 互相抵消,**不回捲**:繞整圈累積過 360° 而非歸零),任一時刻 |偏航| MUST ≤ 此值 ——
  // 語意:全程航向偏離主堡連線方向不得超過 150°(距完全反向 180° 留 30° 餘裕),出堡/
  // 抵達的接駁段一樣受檢;繞圈因不回捲必然出界。與 UTURN_MAX_DEG 互相獨立(單點大掉頭
  // vs 累積偏航,兩者皆有對方攔不到的案型)。
  // 150 的校準(2026-07-29 拿 venueLanes 95 條真實道路兵線實測,相對主軸量測):偏航峰值
  // P50≈126°、P75≈148°,150 保留約 3/4 既有真實路線(23/95 條超標、18/54 venue×L 需重烤)。
  // 門檻 MUST < 180(≥180 = 允許完全背對主軸,語意破產);再調整前 MUST 重跑分布實測。
  // 結算縫 = laneTurnAccumAudit();bake 硬門檻、mapSelect 複驗共用同一支。
  TURN_ACCUM_MAX_DEG: 150,
  // 兵線互不接觸/交叉(規則,2026-07-20 定奪:全禁,含立體交叉)。同一 L 內任兩條兵線,排除
  // 兩座主堡的共享扇出段(沿 A→B 主軸進度落在 [SKIP,1−SKIP] 之外者豁免——三線由同一主堡扇出
  // 必於此帶收斂)後,中段最近距離 MUST ≥ LANE_MIN_SEP_M 且 2D 不得相交。橋/隧立體交叉亦禁:
  // 伺服器/烘焙無高程,一律保守把「2D 相交」視為接觸(全禁)。結算縫 = laneSeparationAudit(),
  // bake 硬門檻、mapSelect / server validateBattleConfig 複驗、audit_lane_sep 稽核共用同一支。
  // LANE_MIN_SEP_M 為**遊戲公尺**(與 towerLayoutAudit 同框);40 遊戲公尺 = 20m 真實世界(REAL_SCALE 0.5)。
  // SKIP 校準:synthLane 中段最近間距 ~114 遊戲公尺(> 40 甚多)⇒ 降級一定合規。
  LANE_MIN_SEP_M: 40,
  LANE_SEP_SKIP_FRAC: 0.15,
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

// ============ 地圖主方位(2026-08-10 使用者定案)============
// 使用者原句:「處理圖資時先找出地圖上下左右對準哪一個方向時,可以對齊最多的大馬路
// 組成正交網格」。⇒ 旋轉是**投影的一部分**:經緯度 → 世界公尺的最後一步整份轉
// `center.rot` 弧度,地形/兵線/主堡/圖資/建物/中立物全部一起轉。
//
// 為什麼可以這樣做而不動任何戰鬥判定:旋轉是**等距同構** —— 距離、夾角、面積、
// 兵線分離、砲塔佈局、重合率一律逐位元不變(它們全是旋轉不變量),變的只有「北在哪」。
// 角度來源 = `venueGrid.js` 的離線烘焙(大馬路長度加權的 mod 90° 主方位取負);
// 拿不到(自訂地圖 / 舊的最愛 / 離線)→ 0 = 不旋轉 = 逐位元同舊制(原則 6 降級不例外)。
//
// ⚠ **兩端旋轉方向相反,這是本縫唯一會靜默壞掉的地方**:客戶端框 z = 南、伺服器框
//   z = 北(A30「sim 座標 z 鏡射」)。z 鏡射把 R(θ) 共軛成 R(−θ) ⇒ `sim.llToMeters`
//   MUST 是本檔 `llToXZ` 的 **z 反號**,MUST NOT 在 sim 自己再寫一次旋轉 —— 寫成同號的話
//   兩端世界差 2θ,而畫面上只表現成「打得到卻沒傷害 / 塔的位置跟畫面對不上」(A30 家族)。
const R_EARTH_M = 6371000;
/** 地圖主方位(rad)。全專案唯一讀取縫;缺席一律 0。 */
export const mapRot = (center) => (Number.isFinite(center?.rot) ? center.rot : 0);
/** 平面旋轉。a = 0 是**恆等式**(x*1−z*0 === x、x*0+z*1 === z,IEEE754 逐位元)。 */
export function rotXZ(x, z, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c - z * s, x * s + z * c];
}
/**
 * 經緯度 → 世界公尺(**客戶端框**:x 東、z 南)。
 * 全專案唯一的經緯度投影實作:`terrain.llToWorld` 與 `sim.llToMeters`(z 反號)MUST 轉呼這一支。
 */
export function llToXZ(lat, lng, center) {
  const s = 1 / MAPGEO.REAL_SCALE;
  const x = (lng - center.lng) * Math.PI / 180 * R_EARTH_M * Math.cos(center.lat * Math.PI / 180) * s;
  const zN = (lat - center.lat) * Math.PI / 180 * R_EARTH_M * s;
  return rotXZ(x, -zN, mapRot(center));
}
/** 世界公尺(客戶端框)→ 經緯度,`llToXZ` 的逆運算。回 `[lat, lng]`。 */
export function xzToLL(x, z, center) {
  const [ux, uz] = rotXZ(x, z, -mapRot(center));
  return [
    center.lat + (-uz) * MAPGEO.REAL_SCALE / R_EARTH_M * 180 / Math.PI,
    center.lng + ux * MAPGEO.REAL_SCALE / (R_EARTH_M * Math.cos(center.lat * Math.PI / 180)) * 180 / Math.PI,
  ];
}

/**
 * 戰場**世界方框**(遊戲公尺,客戶端框):路線包絡外擴 ∪ 對稱方框,再繞中心放大 MAP_EXPAND。
 * 幾何真相只有一份:客戶端地形(terrain.js buildTerrain 的 minX/maxX/minZ/maxZ)與伺服器
 * 中立物散布(sim.js 障礙/防空/中繼站的越界判定,z 反號)共用 —— 伺服器沒有地形網格,
 * 但用同一個方框就能保證中立物不落在地形外(HAZ_LANE_MAX 300 > 邊距 160)。
 *
 * 這一份**恆為世界軸對齊**(地形網格/邊界障礙環/小地圖都是軸對齊的)。
 *
 * ⚠ **旋轉只准讓方框長大,MUST NOT 讓它縮小**:包絡是「旋轉後的兵線」的外接框,而兵線一旦
 *   被轉到與某一軸平行,那一軸的包絡就會塌掉(實測 barcelona 5v5 轉 45° ⇒ 面積剩 66%)。
 *   MAP_EXPAND 是等比放大,救不了扁掉的那一軸 —— 而它存在的理由正是「第三方野營要有側翼
 *   合法區(離每座砲塔 ≥ 388m)」,面積掉三分之一就是那個機制無聲失效。
 *   故逐軸取「旋轉後包絡」與「rot=0 包絡」的較寬者。rot=0 時兩者同一組數,補正恆為 0(逐位元)。
 */
export function battleRect(cfg) {
  const c = cfg.center;
  const envAt = (rot) => {
    const cr = { lat: c.lat, lng: c.lng, rot };
    // 1) 路線包絡(主堡 + 全兵線頂點),外擴 ROUTE_EDGE_MARGIN_M(本來就是遊戲公尺)
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [la, ln] of [cfg.bases.SWARM, cfg.bases.STEEL, ...cfg.lanes.flat()]) {
      const [x, z] = llToXZ(la, ln, cr);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    minX -= ROUTE_EDGE_MARGIN_M; maxX += ROUTE_EDGE_MARGIN_M;
    minZ -= ROUTE_EDGE_MARGIN_M; maxZ += ROUTE_EDGE_MARGIN_M;
    // 2) 與對稱方框(原點 ± 半邊長;llToXZ(center) 恆為 [0,0])取聯集,兵線很短也維持基本尺寸
    const half = cfg.sizeM / 2;
    minX = Math.min(minX, -half); maxX = Math.max(maxX, half);
    minZ = Math.min(minZ, -half); maxZ = Math.max(maxZ, half);
    // 3) 繞方框中心等比放大 MAP_EXPAND(兵線不動;為第三方野營留側翼合法區)
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const hx = (maxX - minX) / 2 * MAPGEO.MAP_EXPAND, hz = (maxZ - minZ) / 2 * MAPGEO.MAP_EXPAND;
    return { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz };
  };
  const r = envAt(mapRot(c));
  const b = envAt(0);   // 尺寸地板(= 舊制的方框大小)
  const dx = Math.max(0, ((b.maxX - b.minX) - (r.maxX - r.minX)) / 2);
  const dz = Math.max(0, ((b.maxZ - b.minZ) - (r.maxZ - r.minZ)) / 2);
  return { minX: r.minX - dx, maxX: r.maxX + dx, minZ: r.minZ - dz, maxZ: r.maxZ + dz };
}

/**
 * 戰場**資料抓取範圍**(經緯度 AABB)= `battleRect` 四角的經緯外接框。
 * 高程磚 / 衛星影像 / Overpass 三條 fetch 與 geocache 鍵一律吃這一份 ⇒ 地圖主方位一旋轉,
 * 抓取範圍自動擴到覆蓋旋轉後的世界方框(最壞 45° 時邊長 ×√2)。
 * rot = 0 時與舊制同一個框(差異只有一次投影往返的浮點尾差,遠小於 geoKey 的 1e-5 度分度)。
 */
export function battleBBox(cfg) {
  const r = battleRect(cfg);
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [x, z] of [[r.minX, r.minZ], [r.maxX, r.minZ], [r.minX, r.maxZ], [r.maxX, r.maxZ]]) {
    const [la, ln] = xzToLL(x, z, cfg.center);
    if (la < minLat) minLat = la;
    if (la > maxLat) maxLat = la;
    if (ln < minLng) minLng = ln;
    if (ln > maxLng) maxLng = ln;
  }
  return { minLat, maxLat, minLng, maxLng };
}

/**
 * 折線戰術幾何(公尺平面 [x,z] 陣列):彎曲度 + 轉角沿線距離清單。
 * 客戶端選路評分(mapSelect)與伺服器障礙佈設(sim._laneTurns)共用同一份判定。
 */
export function laneTacticsXZ(pts) {
  const T = MAPGEO.TACTICS;
  if (!pts || pts.length < 2) return { total: 0, straight: 1, sinuosity: 1, turns: [], turnsPerKm: 0 };
  const { total, heads } = laneHeads(pts);
  const straight = Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) || 1;
  const turns = [];
  const minRad = T.TURN_MIN_DEG * Math.PI / 180;
  for (let j = 1; j < heads.length; j++) {
    let dh = Math.abs(heads[j].head - heads[j - 1].head);
    if (dh > Math.PI) dh = Math.PI * 2 - dh;
    if (dh >= minRad) turns.push(heads[j].d);
  }
  return { total, straight, sinuosity: total / straight, turns, turnsPerKm: turns.length / (total / 1000 || 1) };
}

/**
 * 等距重取樣航向序列(TACTICS.SEG_M 步長)—— laneTacticsXZ / laneUTurnAudit /
 * laneTurnAccumAudit 三個消費端共用的唯一實作。**MUST 走重取樣**:OSRM/圖資的密集折線,
 * 相鄰微段夾角是量測雜訊而非宏觀航向,逐頂點量會誤判(規則 2026-07-28 同一組取樣語彙)。
 * 回傳 { total, heads:[{ d, head }] }:heads[j] = 第 j 個取樣段(沿線 [d, d+SEG_M])的
 * 航向(rad);d = 段起點沿線距離。尾端不足一步的殘段不取樣(刻意,與舊制逐位元一致)。
 */
function laneHeads(pts) {
  const seg = MAPGEO.TACTICS.SEG_M;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  const at = (d) => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const f = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
  };
  const heads = [];
  for (let d = seg; d <= total; d += seg) {
    const p0 = at(d - seg), p1 = at(d);
    heads.push({ d: d - seg, head: Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) });
  }
  return { total, heads };
}

/**
 * 兵線「往主堡折返」比例:沿兩堡連線(A=pts[0]→B=末點)主軸投影,累加所有「進度倒退」
 * 的段長,除以兩堡直線距離。單調向前的路線 → 0;繞回頭路折返主堡越多 → 越大。
 * pts:[[x,z], …] 同一尺度即可(比例無單位);用於 MAPGEO.MAX_BACKTRACK 生成門檻。
 */
export function laneBacktrackFrac(pts) {
  if (!pts || pts.length < 3) return 0;
  const a = pts[0], b = pts[pts.length - 1];
  const vx = b[0] - a[0], vz = b[1] - a[1];
  const straight = Math.hypot(vx, vz) || 1;
  const ux = vx / straight, uz = vz / straight;
  let back = 0, prev = 0;                                   // prev = 上一點沿主軸的進度(公尺)
  for (let i = 1; i < pts.length; i++) {
    const s = (pts[i][0] - a[0]) * ux + (pts[i][1] - a[1]) * uz;
    if (s < prev) back += prev - s;                         // 沿主軸倒退 = 往主堡折返
    prev = s;
  }
  return back / straight;
}

/**
 * 兵線「接近 180° 迴轉」偵測(公尺平面 [x,z] 陣列,2026-07-28 使用者需求「不可接近 180 度迴轉」)。
 * 沿折線以 TACTICS.SEG_M 等距重取樣(laneHeads),取相鄰兩段航向的反轉角(0~180°)最大值;
 * ≥ MAPGEO.UTURN_MAX_DEG = 掉頭迴轉。pts 同一尺度即可(角度無單位)。
 * 回傳 { ok, maxDeg, at }(at = 迴轉處沿線距離,無則 -1)。
 */
export function laneUTurnAudit(pts) {
  if (!pts || pts.length < 3) return { ok: true, maxDeg: 0, at: -1 };
  const { heads } = laneHeads(pts);
  let maxDeg = 0, atMax = -1;
  for (let j = 1; j < heads.length; j++) {
    let dh = Math.abs(heads[j].head - heads[j - 1].head);
    if (dh > Math.PI) dh = Math.PI * 2 - dh;                 // 取 0~π 的較小夾角
    const deg = dh * 180 / Math.PI;
    if (deg > maxDeg) { maxDeg = deg; atMax = heads[j].d; }
  }
  return { ok: maxDeg < MAPGEO.UTURN_MAX_DEG, maxDeg, at: atMax };
}

/**
 * 兵線「主軸偏航累積」稽核(公尺平面 [x,z] 陣列,2026-07-29 使用者需求
 * 「轉彎的角度累積起來不可超過範圍之外,順逆時針轉向可抵消」;量測基準 = A→B 主軸,
 * 範圍 = ±MAPGEO.TURN_ACCUM_MAX_DEG,校準依據見該常數註解)。
 * 主軸 = pts[0] → 末點方位。以「首取樣段航向 − 主軸」的帶號夾角為初值,沿
 * TACTICS.SEG_M 等距重取樣序列(laneHeads)逐段累加帶號轉角(正規化到 (−π, π];
 * 左轉正/右轉負,順逆時針互相抵消,**不回捲** —— 繞整圈累積過 360° 而非歸零)。
 * 任一時刻 |偏航| 超出門檻 = 出界淘汰;出堡/抵達接駁段(首尾取樣段)一樣受檢。
 * 恰好落在門檻上 MUST 算範圍**內**合法 ⇒ 門檻比較含微小浮點餘裕。
 * 回傳 { ok, maxAbsDeg, at }(at = 偏航峰值處沿線距離,無則 -1)。
 */
export function laneTurnAccumAudit(pts) {
  if (!pts || pts.length < 3) return { ok: true, maxAbsDeg: 0, at: -1 };
  const { heads } = laneHeads(pts);
  if (!heads.length) return { ok: true, maxAbsDeg: 0, at: -1 };
  const axis = Math.atan2(pts[pts.length - 1][1] - pts[0][1], pts[pts.length - 1][0] - pts[0][0]);
  const norm = (a) => (a > Math.PI ? a - Math.PI * 2 : (a < -Math.PI ? a + Math.PI * 2 : a));
  let acc = norm(heads[0].head - axis);
  let maxAbs = Math.abs(acc) * 180 / Math.PI, atMax = heads[0].d;
  for (let j = 1; j < heads.length; j++) {
    acc += norm(heads[j].head - heads[j - 1].head);
    const a = Math.abs(acc) * 180 / Math.PI;
    if (a > maxAbs) { maxAbs = a; atMax = heads[j].d; }
  }
  return { ok: maxAbs <= MAPGEO.TURN_ACCUM_MAX_DEG + 1e-9, maxAbsDeg: maxAbs, at: atMax };
}

/**
 * 兵線「橋/隧只能從出入口進出」稽核(生成期圖論,2026-07-28 使用者需求
 * 「一旦進入高架橋/隧道/地下道,只能從出入口進出,不可從側邊出入」)。
 * 輸入為沿兵線**節點路徑**的兩組布林(bake 由 OSM 圖建立、與節點索引對齊):
 *   struc[k] = 第 k 段(節點 k−1 → k)是否為橋/隧結構邊(k = 1..m;struc[0] 佔位不用);
 *   portal[i] = 節點 i 是否為某結構 way 的端點(= 真實匝道/洞口,唯一合法出入口)。
 * 規則:任一結構連續段的**進入 / 離開節點 MUST 是 portal**(或兵線兩端主堡 = 天然出入口),
 *   不得由結構 way 中間節點側切上/下橋。地下道在圖資上即 tunnel way,與隧道同一組結構旗標。
 * **只有離線 bake 的 OSM 圖有逐邊結構旗標**;mapSelect 走 OSRM 真實道路路徑,拓樸上本就
 *   只能從匝道/洞口進出,天然守此規則(故不在 mapSelect 複驗)。
 * 回傳 { ok, at }(at = 首個違規節點索引,無則 −1)。
 */
export function laneStructEntryAudit(struc, portal) {
  const m = struc.length - 1;                                // 節點 0..m;段 k 連 節點 k−1→k
  for (let k = 1; k <= m; k++) {
    if (!struc[k]) continue;
    const prevS = k > 1 && struc[k - 1];
    const nextS = k < m && struc[k + 1];
    // 進入結構段(前一段非結構)⇒ 進入節點 full[k−1] MUST 是 portal(k−1 = 0 = 兵線起點,豁免)
    if (!prevS && k - 1 > 0 && !portal[k - 1]) return { ok: false, at: k - 1 };
    // 離開結構段(後一段非結構)⇒ 離開節點 full[k] MUST 是 portal(k = m = 兵線終點,豁免)
    if (!nextS && k < m && !portal[k]) return { ok: false, at: k };
  }
  return { ok: true, at: -1 };
}

/**
 * 兵線互不接觸/交叉稽核(規則,2026-07-20:全禁,含立體交叉)。
 * lanes:[[ [x,z],… ],…] 遊戲公尺(與 towerLayoutAudit 同框;A=lanes[0][0]、B=lanes[0] 末點)。
 *   ① 最近距離(接觸):排除兩座主堡的共享扇出段(進度 t∈[SKIP,1−SKIP] 之外豁免——
 *      三線由同一主堡收斂到共享端點不可避免地貼近),中段最近距離 MUST ≥ MAPGEO.LANE_MIN_SEP_M。
 *   ② 交叉:**全線不套豁免**(端點接觸不算,由 segX 端點守衛排除)。收斂到共享堡是「接觸」可容許,
 *      但兩線「換邊」= 交叉,即使在近堡處也是真交叉,MUST 0。橋/隧立體交叉亦禁(無高程,保守視為接觸)。
 * 回傳 { ok, minGap, crosses }。單/零兵線恆 ok(L1 無鄰線)。
 * 折線最近距離取「雙向 vertex→segment」最小值即精確(不相交時最近點必落在某端點對段上)。
 */
export function laneSeparationAudit(lanes) {
  if (!lanes || lanes.length < 2) return { ok: true, minGap: Infinity, crosses: 0 };
  const SEP = MAPGEO.LANE_MIN_SEP_M, SK = MAPGEO.LANE_SEP_SKIP_FRAC;
  const A = lanes[0][0], B = lanes[0][lanes[0].length - 1];
  const vx = B[0] - A[0], vz = B[1] - A[1], straight = Math.hypot(vx, vz) || 1;
  const ux = vx / straight, uz = vz / straight;
  const prog = (p) => ((p[0] - A[0]) * ux + (p[1] - A[1]) * uz) / straight;
  const mid = (t) => t >= SK && t <= 1 - SK;
  const ptSeg = (px, py, ax, ay, bx, by) => {
    const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1;
    let t = ((px - ax) * ex + (py - ay) * ey) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (ax + ex * t), py - (ay + ey * t));
  };
  const segX = (a, b, c, d) => {          // 兩段真相交回交點,否則 null(端點接觸不算)
    const r1 = b[0] - a[0], r2 = b[1] - a[1], s1 = d[0] - c[0], s2 = d[1] - c[1];
    const den = r1 * s2 - r2 * s1; if (!den) return null;
    const t = ((c[0] - a[0]) * s2 - (c[1] - a[1]) * s1) / den;
    const u = ((c[0] - a[0]) * r2 - (c[1] - a[1]) * r1) / den;
    return (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) ? [a[0] + t * r1, a[1] + t * r2] : null;
  };
  let minGap = Infinity, crosses = 0;
  for (let i = 0; i < lanes.length; i++) {
    for (let j = i + 1; j < lanes.length; j++) {
      const P = lanes[i], Q = lanes[j];
      const scan = (vs, segs) => {
        for (const v of vs) {
          if (!mid(prog(v))) continue;
          for (let s = 1; s < segs.length; s++) {
            if (!mid(prog(segs[s - 1])) && !mid(prog(segs[s]))) continue;   // 兩端點皆在豁免帶 → 跳過
            const d = ptSeg(v[0], v[1], segs[s - 1][0], segs[s - 1][1], segs[s][0], segs[s][1]);
            if (d < minGap) minGap = d;
          }
        }
      };
      scan(P, Q); scan(Q, P);
      for (let a = 1; a < P.length; a++) {
        for (let b = 1; b < Q.length; b++) {
          if (segX(P[a - 1], P[a], Q[b - 1], Q[b])) crosses++;   // 交叉不套豁免帶(近堡換邊亦禁)
        }
      }
    }
  }
  return { ok: crosses === 0 && minGap >= SEP, minGap, crosses };
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
// howitzer 2026-07-17 改制:榴彈兵是「手持榴彈槍的步兵」(flesh),不再是牽引砲車(armor)。
export const TARGET_CLASS = {
  soldier: 'flesh', apc: 'armor', tank: 'armor', rocketeer: 'flesh', howitzer: 'flesh', heli: 'air',
  robot: 'armor', drone: 'air', morph: 'armor', decoy: 'air', tower: 'building', base: 'building',
  kami: 'air', hyper: 'air',   // 機種絕招的可擊落載具(飽和攻擊護衛機 / 極音速飛彈)—— 對空武器該吃得到加成
  bunker: 'building',   // 第三方碉堡(見 THIRD)
  civilian: 'flesh',    // 平民/間諜(非戰鬥人員;永不被 NPC 鎖定,見 CIVILIAN)
  // 中立可擊毀物(防空陣地 / 障礙物)吃反建築加成:攻城武器開路特別快
  aasite: 'building', construction: 'building', wreck: 'building',
  rockfall: 'building', fallentree: 'building',
};
export const CLASS_NAME = { flesh: '肉體', armor: '裝甲', air: '飛行', building: '建築' };

// ---- NPC 熱兵器(小兵/塔用;vs = 對目標類型加成,pen = 破甲值)----
// 英雄武器改住 CHARACTERS(每名角色專屬輕/重武器);bomb = 無人機自帶重型炸彈
// (F 鍵自殺攻擊機引爆或高速撞擊引爆,座機同歸於盡 → 無人機重生無冷卻)。
// bomb.dmg 為階級陣列(2026-07-18 起):傷害吃無人機輕武器階級(lw 面向 → abil.light 1~4),
// 由 sim._bombDef() 以 tierVal 解析(Lv4 外推)。Lv1 = 原值 240(不變),升階才增威(自殺攻擊隨武器等級成長)。
// ---- 全際「reach」比例尺(2026-07-19 規則 #4)----
// 使用者定案:地圖/尺寸不動,改「全單位射程 / 視野 / 移速」統一減半 ⇒ 相對塔射程縮半,
// 兵線塞得下兩個 ≤80% 重疊的塔環(塔射程 310→155 ⇒ SEP 372→186 < 兵線 906~1442)。
// **只縮「reach / 感知 / 移動 / 制空高度門檻」**;不動實體尺寸(SOLDIER_H)、AoE/障礙半徑、地圖佈局距離、比率(HEROIC/RANGE_SIGHT_F)。
// 套用縫:heroWeapon/heroAbility(英雄武器招式射程)+ 下方 UNITS/WEAPONS/GAME/ALTITUDE/EVASION 統一縮放塊。
// **可一鍵還原**:改回 1 即回到原尺度(記得同步 e2e #INC-104 高度常數)。移速減半 ⇒ 對戰時長約 ×2(節奏刻意拉長)。
export const COMBAT_SCALE = 0.5;

export const WEAPONS = {
  rgun:   { name: '重型機槍',   dmg: 26,  rate: 4.5, range: 220, mag: 48, reload: 2.2, pen: 0,  vs: { flesh: 1.3, armor: 1.0, air: 0.8, building: 0.6 } },
  // rocket vs.air 1.2(2026-07-17 火箭筒對空化):肩射火箭筒是合格的防空武器,
  // 火箭兵優先鎖定空中目標(vs 進 _acquireTarget 的目標偏好;NPC 傷害本身不吃 vs)。
  rocket: { name: '肩射火箭',   dmg: 130, r: 20, rate: 1 / 6, range: 320, mag: 3, reload: 8, pen: 10, needAim: true, vs: { flesh: 1.0, armor: 1.5, air: 1.2, building: 1.3 } },
  // bomb 只留「彈體規格」(半徑/破甲/vs);**傷害刻意不住這裡** —— 飽和攻擊與另兩招
  // (集束炸彈/極音速飛彈)共用機種絕招傷害預算,由 kamiBlast()/selfBoomBlast() 推導(見 SPECIAL)。
  bomb:   { name: '重型炸彈',   r: 22, pen: 8, vs: { flesh: 1.5, armor: 1.2, air: 0.5, building: 1.5 } },
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
// ---- 高度差空戰修正(2026-07-25 使用者需求;取代舊「無人機制空 ±傷害/射程」)----
// 判定「雙方視線點的絕對高程差」dh —— 地形 / 跳躍 / 飛行造成的高差**全部**計入(英雄由客戶端回報
// 絕對視線高程 ay;塔/主堡取砲位視線高 LOS.TOWER_EYE_M;小兵取離地小視線高)。
// **沒有高度差(|dh| ≤ 1 個砲塔高)= 無任何加成** ⇒ 同高對射與 npm run bal 的靜態 1v1 完全不受影響。
// 效果**全部落在「較高的一方」**(高地換視野與機動,不換爆發):
//   +射程 / +閃避率;但「攻擊時」爆率/爆傷↓、「受到攻擊時」爆率/爆傷↑。
// 強度係數 s 隨 |dh| 由「1 個砲塔高」線性升到「3 個砲塔高(TIERS)」封頂;砲塔高 = TARGET_H.tower(推導不手寫)。
// 封頂效果:+25% 射程、+10% 閃避、攻擊爆率 ×0.90、攻擊爆傷加成 ×0.90、受擊爆率 ×1.2、受擊爆傷加成 +10%。
// 爆擊只作用於直擊武器(heroHit/heroLance _rollCrit);招式不吃高度差、也不吃爆擊(AoE 不爆)。
// **閃避例外**(2026-08-11 使用者定案「所有攻擊招式也加入閃避機制」):招式與一切爆風的傷害
// 走 sim._blast,由該處逐目標擲 `_dodges` —— 範圍見 `evadable()` 這個唯一縫。
export const ALTITUDE = {
  TIERS: 3,             // |dh| 達「3 個砲塔高」時效果封頂(門檻在 1 個砲塔高)
  RANGE: 0.25,         // 較高方 +射程(封頂)
  DODGE: 0.10,         // 較高方 +閃避率(封頂)
  // 爆擊代價四項於 2026-07-27 整組 ×0.7 重新校準(原 0.5/0.5/1.0/0.5)——
  // 對進戰模型(`npm run bal` ⑤)量到舊值讓「較高方勝率」只有 48.3%:+25% 射程只在接近期兌現、
  // +10% 閃避只擋輕武器直射,兩者合計買不回「攻擊爆擊砍半 + 受擊爆率翻倍」的代價 ⇒ **搶高地是淨虧損**,
  // 與設計意圖(高地換視野與機動、不換爆發 ⇒ 期望勝負應為**中性**)相反。整組等比縮放保留原本的效果形狀。
  //
  // **2026-08-12 再次整組 ×0.286(0.35/0.35/0.7/0.35 → 0.10/0.10/0.20/0.10)**:高地壓制(見 HIGH_SUP)
  // 上線之後,高度差這一軸同時掛著**兩份**代價 —— 一份無條件(本組爆擊修正)、一份有條件(被打到才發生)。
  // 兩份疊起來讓 ⑤c「較高方勝率」掉到 36.7%,遠低於 50±3pp 的中性目標。使用者這一輪定案的是**有條件**
  // 那一份 ⇒ 無條件這一份縮到 1/5,把預算讓給它(形狀仍整組等比,`altScale` 那條斜坡一格未動)。
  // **這一組就是 ⑤c 的校準旋鈕**(2026-07-27 那一次也是動它);改 HIGH_SUP 任一值 MUST 回頭重跑 ⑤c。
  ATK_CRIT_RATE: 0.10, // 較高方攻擊時:爆率 ×(1 − 此值·s)  → 封頂 ×0.90
  ATK_CRIT_DMG: 0.10,  // 較高方攻擊時:爆傷加成 ×(1 − 此值·s)→ 封頂 ×0.90
  RCV_CRIT_RATE: 0.20, // 較高方受擊時:爆率 ×(1 + 此值·s)  → 封頂 ×1.2
  RCV_CRIT_DMG: 0.10,  // 較高方受擊時:爆傷加成 ×(1 + 此值·s)→ 封頂 +10%
};
/** 觸發門檻/一階高度 = 一個砲塔高(公尺,實體高不吃 COMBAT_SCALE);推導不手寫 */
export const altTier = () => TARGET_H.tower;
/** 高度差強度係數 s ∈ [0,1]:|dh| 由 1 個砲塔高線性升到 TIERS 個砲塔高封頂;未達門檻 = 0(無加成) */
export const altScale = (dh) => {
  const T = altTier(), a = Math.abs(dh || 0);
  return Math.max(0, Math.min(1, (a - T) / (T * (ALTITUDE.TIERS - 1))));
};
/**
 * 高度制空射程加成的**上限**(推導不手寫)。用在「閘門的另一端拿不到目標實體」的場合 ——
 * 榴彈/飛彈的落點是一個**點**,伺服器算不出 `dh`(_sightY 要兩個實體)⇒ 只能取機制上限當誠實界,
 * 否則客戶端合法地以 `1 + ALTITUDE.RANGE` 拉遠射程打出去的那一發,會在伺服器被判超程靜默丟棄。
 */
export const altRangeMax = () => 1 + ALTITUDE.RANGE;
/** 高度差的**機制上限**(公尺;推導不手寫 = `altScale` 封頂處的 TIERS 個砲塔高)。
 *  同樣用在「拿不到目標實體、只能取封頂當誠實界」的場合(見 `flightCapS` 的俯射餘裕)。 */
export const altDhMax = () => altTier() * ALTITUDE.TIERS;
/**
 * 高度差「射程」乘數的**唯一縫**(伺服器 `sim._altRange` 與客戶端 `game._altRangeTo` 同吃):
 * 較高的一方 +射程(封頂 +`ALTITUDE.RANGE`),同高/較低 = 1。兩端 MUST NOT 各寫一份曲線。
 *
 * `dh` MUST 是**同一個高程參考框**下的兩個視線點高程差。跨框相減是 2026-08-01 使用者回報
 * 「攻擊範圍異常:沒有射程光暈的敵人也打得到」的病根 —— 英雄回報的 `ay` 是**絕對**高程
 * (含地形海拔;真實場地動輒數百公尺),而伺服器沒有地形、NPC/塔一律以「離地高 + 基準 0」
 * 表示 ⇒ 兩者相減等於拿海拔當高度差,`altScale` 直接封頂 = 英雄對**所有** NPC 恆 +25% 射程,
 * 而客戶端射程光暈量的是本地地形(恆 ≈1)⇒ 光暈與實際結算分家(見 sim._altDh)。
 */
export const altRangeF = (dh) => (dh > 0 ? 1 + ALTITUDE.RANGE * altScale(dh) : 1);
// ---- 射程閘門的網路寬容(2026-07-30 收成單一縫)----
// 伺服器複驗客戶端回報(命中/落點/射線)時放給網路延遲與彈道飛行時間的倍率。**唯一縫**:
// sim.js 的每一道射程閘門 MUST 吃這一個值,MUST NOT 各處手寫倍率 —— 逐處手寫的下場是
// heroBurst 曾經只給 1.15(其餘全是 1.25 且另乘 _altRange),高地上合法的榴彈落點落在
// (1.15, 1.25 × altRangeMax] 這段窗口裡被「驗證後靜默丟棄」= 使用者回報的
// 「光暈亮著、砲彈在敵人身上炸開,傷害卻是 0」(A30 靜默丟包家族)。
export const RANGE_TOL = 1.25;
// SQUAD:蜂群玩家 = 單架無人機(2026-07-17 起;舊制為 N 架小隊,現 N=1)。
// 生存值(HP/護盾/護甲)= 機甲平均的 HP_F(80%);傷害 = 機甲全額(DMG=1,單機不折)。
// 傷害折算仍住在 heroWeapon()(與 HEROIC 同一個縫),別在 sim/game 二次乘算。
// MORPH:傭兵變形者(單機;HP/火力與機甲完全相同)。
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
  CD: 15,            // 變形起飛(蓄力彈射)冷卻(秒;客戶端閘門,與 IFRAME.CD 對齊 —— CD 中放開只普通小跳)
};
// ---- 騰空/空中狀態(2026-07-23;跳躍脫離地面效果的唯一縫)----
// GRAV:地面機體跳躍重力(game.js 物理與下方頂點推導共用,MUST NOT 各寫一份 24)。
// OFF_GROUND:離地 ε(與 game.js onGround 同一個門檻)。
// 兩條高度線,語意不同 MUST NOT 混用:
//   ①offGround(y):**離地** —— 跳躍/蓄力跳躍騰空期間不吃地面傷害(火場/水域/沼澤),
//     客戶端 _envAt 據此回報 wet=0、伺服器 _tickHazards 據此跳過火場灼傷。
//   ②airUnitY(kind):**空中狀態** = 該機種「一般跳躍」的頂點高 jumpApex(UNITS[kind].jump)——
//     蓄力跳躍高過此線的區間視同空中單位(不踩地雷)。普通小跳的解析頂點**恰好等於此線**、
//     逐幀積分實測再低一截(robot:門檻 0.4219 vs 實測 0.38~0.40)⇒ 小跳永遠跳不過雷區、
//     只有蓄力跳過得去(刻意)。MUST NOT 手寫門檻數字,改 UNITS[].jump / COMBAT_SCALE / GRAV 即同步;
//     也 MUST NOT 為了「讓小跳也能跳過」把門檻調低 —— 那條線就是拿來分辨兩種跳躍的。
// 適用機種僅地面機甲(robot/morph);飛行機種另有各自的高度規則(AA_MIN_ALT / fire.maxY),不走這條。
export const AIR = { GRAV: 24, OFF_GROUND: 0.05, KINDS: new Set(['robot', 'morph']) };
/** 初速 v 的跳躍頂點高(公尺) */
export const jumpApex = (v) => (v * v) / (2 * AIR.GRAV);
/** 該機種「一般跳躍」頂點 = 空中狀態門檻(蓄力跳躍超過此高度即視同空中單位) */
export const airUnitY = (kind) => jumpApex(UNITS[kind]?.jump || 0);
/** 地面機甲是否騰空(離地即成立;y = 回報的離站立表面高) */
export const offGround = (kind, y) => AIR.KINDS.has(kind) && (y || 0) > AIR.OFF_GROUND;
/** 地面機甲是否進入空中狀態(蓄力跳躍高過一般跳躍頂點) */
export const airUnit = (kind, y) => AIR.KINDS.has(kind) && (y || 0) > airUnitY(kind);

// ---- 機甲蓄力跳躍(2026-07-16;kind:'robot' 限定 —— morph 的長按 Space 已被變形彈射佔用)----
// 長按 Space 蓄力 → 放開彈射高跳,騰空吃低重力係數 GRAV_F(月面/太空漫步的滯空感);
// 蓄力不足 = 普通小跳。純客戶端物理(位置本就客戶端回報);y 判定規則不變 ——
// 滿蓄頂點 ≈ V²/(2×AIR.GRAV×GRAV_F) ≈ 27m < GAME.AA_MIN_ALT(40),單靠蓄力跳不進 SAM 空域;
// 疊加跳躍增益(leap)越過 40m 時照吃塔 SAM(刻意風險)。
export const CJUMP = {
  CHARGE_S: 0.9,     // 蓄滿秒數
  MIN: 0.35,         // 低於此蓄力比例 = 普通小跳
  V: 24,             // 滿蓄力垂直初速(m/s;實際 = V × 蓄力比例)
  FWD_F: 1.0,        // 前向彈射初速 = 機體移速 × 此比 × 蓄力比例(最大距離 ∝ 機體速度;2026-07-20 使用者需求)
  // 蓄力跳「水平移動速度」倍率(2026-07-30 使用者需求「蓄力跳躍的水平移動速度提升 100%」= ×2)。
  // 唯一縫,兩個消費端同吃 ⇒ 整段蓄力跳的水平速度一致加倍,MUST NOT 只改其中一處:
  //   ①起跳的前向彈射初速(_chargeJump 的 fwd)—— 不然只有滑行變快、彈射距離沒變;
  //   ②騰空期間(_lowG)的操縱移速 —— 不然只有起跳那一瞬變快、空中推杆仍是地面速度。
  // 只作用於水平:垂直初速 V / 低重力 GRAV_F 不動 ⇒ 滯空時間不變、跳躍高度不變
  // (滿蓄頂點仍 < GAME.AA_MIN_ALT,不會靠蓄力跳自己飛進 SAM 空域),變的只有跳得多遠/多快。
  AIR_SPD_F: 2.0,
  GRAV_F: 0.45,      // 蓄力跳騰空重力係數(< 1 = 太空漫步)
  CROUCH_M: 1.1,     // 蓄力下蹲幅度(公尺;FPV 鏡頭同步下沉)
  CD: 15,            // 蓄力跳躍冷卻(秒;客戶端閘門,與無敵幀 IFRAME.CD 對齊 —— CD 中放開只普通小跳)
};
// ---- 飛行動力學(2026-07-30 使用者需求;飛行機體 = 無人機 + 飛行型態的變形者)----
// 兩條規則共用這一個縫,MUST NOT 在 game.js / HUD 各自手寫係數:
//  ①**受擊掉高**:飛行機體挨打會掉高度,掉的公尺數**正比於該次傷害**。校準錨(使用者定調)=
//    「打完護盾 + 裝甲」掉 SINK_TOWERS 個砲塔高 ⇒ 每點傷害掉幾公尺是**推導值**(airSinkM):
//    分母 = `SQUAD.DRONE_AVG_HP`(飛行機體平均總血量,既有推導縫)、一階高度 = `TARGET_H.tower`
//    (砲塔高,與 altTier() 同一把尺)—— MUST NOT 手寫 52 或每點傷害的公尺數。
//    使用者說的是「**平均**打完護+HP」⇒ 係數是**全飛行機體共用的一個定值**,不是逐機體按自身
//    血量上限換算(那會讓護盾/裝甲升級順便買到抗擊落,是另一條設計);校準錨動了整組自動跟著動。
//    掉高是**位移**不是速度:同一份傷害無論分幾發打完,掉的總高度相同(SINK_S 只管「掉多快才
//    像被打趴」的展開節奏,MUST NOT 拿它縮放總量)。
//  ②**爬升動力**:往上飛消耗專屬動力條(與電力分開的第二條資源;水平/下降/懸停不吃)。
//    滿動力全速爬升可持續 DRAIN_S 秒(使用者定調 5s)⇒ 耗速 = 上限 ÷ DRAIN_S(liftDrainPS,
//    推導不手寫);上限與回復**正比於電力**(liftMax ← 電力上限、liftRegen ← 電力回速 × 充能軌)。
//    動力見底 = **爬不上去**(不是變慢)—— 與 slopeBlocked 同語意:玩家要分得出「上不去」。
// 位置本就客戶端權威(見 sim.heroPos)⇒ 這兩條與蓄力跳/攀爬同層,住客戶端物理;驅動它們的量
// (受擊傷害、電力上限/回速)仍是伺服器權威快照,MUST NOT 在客戶端自算。
// 適用對象刻意只有**玩家操控的飛行機體**:NPC 直升機/集束轟炸機/護衛機/極音速飛彈走的是伺服器腳本航線(定高飛行),
// 掉高會讓它們陷進地形、動力條也無電力可正比 —— MUST NOT 為了「一致」把規則套過去。
export const FLIGHT = {
  SINK_TOWERS: 2,    // 受擊掉高校準:掉光「平均護盾 + 裝甲」= 掉幾個砲塔高
  SINK_S: 0.5,       // 一次掉高的展開秒數(純手感節奏;總掉幅由 airSinkM 決定)
  DRAIN_S: 5,        // 滿動力全速爬升可持續秒數
  MAX_F: 1.0,        // 動力上限 = 電力上限 × 此比(正比於電力;現值 = 電力上限本身)
  // 變形者(飛行型態)的飛行動力上限校準(2026-08-02 使用者定案「變形者的飛行動力減少 1/3」):
  // 只降變形者的動力**上限**,耗速 `liftDrainPS` 由上限推導 ⇒ 滿動力仍撐 DRAIN_S 秒(節奏不變、
  // 續航變短);無人機不吃此係數(MUST NOT 套用到 isDrone)。
  MORPH_F: 2 / 3,
  // 動力回復 = 電力回速(mpRegen × chargeF(充能軌))× 此比 ⇒ **充能軌 = 飛行續航軌**:
  // 滿充能約 2 × DRAIN_S(≈10s)回滿、充能 Lv0 約 5 × DRAIN_S(≈25s)—— 爬升是有代價的機動,
  // 回充比耗盡慢是刻意的(不然動力條等於不存在)。
  REGEN_F: 2.5,
  LOW_F: 0.15,       // HUD 低動力警示門檻(佔上限比例)
  // 無人機離地下限(=貼地懸停高):飛行中不貼地的下限、以及**重生落地高**共用同一個值(2026-08-03
  // 使用者定案「重生時應該貼地起飛,靠滿動力自己爬升,而不是一出生就懸在半空」)——
  // 重生 MUST NOT 直接把高度設到巡航高度(那樣動力滿格就沒有意義),而是落在這個離地下限,
  // 逼玩家/bot 真的耗用剛補滿的爬升動力才能爬上巡航高度。伺服器(_respawn)與客戶端
  // (_spawnAt/飛行下限鉗制)MUST 吃同一個值,MUST NOT 各自手寫 2.5。
  HOVER_M: 2.5,
};
/** 受擊掉高(公尺):該次傷害造成的下降量 —— 推導不手寫 */
export const airSinkM = (dmg) =>
  Math.max(0, dmg || 0) / SQUAD.DRONE_AVG_HP * FLIGHT.SINK_TOWERS * TARGET_H.tower;
/** 爬升動力上限(正比於電力上限;變形者額外乘 MORPH_F) */
export const liftMax = (maxMp, isMorph) =>
  Math.max(0, maxMp || 0) * FLIGHT.MAX_F * (isMorph ? FLIGHT.MORPH_F : 1);
/** 爬升動力回復(每秒;正比於電力回速 —— 同吃「充能」軌等級) */
export const liftRegen = (mpRegen, chLvl) => Math.max(0, mpRegen || 0) * chargeF(chLvl) * FLIGHT.REGEN_F;
/** 全速爬升的動力耗速(每秒;= 動力上限 ÷ DRAIN_S,推導不手寫) */
export const liftDrainPS = (maxMp, isMorph) => liftMax(maxMp, isMorph) / FLIGHT.DRAIN_S;
// ---- 無敵幀(2026-07-16;起跳離地 1 秒無敵)----
// 客戶端在「起跳離地當下」送 {t:'iframe'},伺服器 sim.heroIframe 驗 CD 後結算(_damage 免傷、控場免疫)。
// 時長與 CD 都夾在伺服器 —— 客戶端只能決定「何時用」,不能延長。三機動能力共用此縫:
//   機甲蓄力跳躍(CJUMP)/ 傭兵升空變形(MORPH)= 15s CD;蜂群無人機完美迴避 = DRONE_CD 30s。
// 完美迴避(2026-07-21):無人機在戰鬥狀態(近 COMBAT_S 秒內攻擊或被攻擊)按空白鍵飛行 →
//   向上飛的同時 1s 無敵,30s CD。觸發時點由客戶端(位置本就客戶端權威),CD/免傷伺服器把關。
export const IFRAME = { DUR: 1.0, CD: 15, DRONE_CD: 30, COMBAT_S: 5 };
export const SQUAD = {
  N: 1,               // 單架無人機(2026-07-17 起:由三機小隊改為單機)
  HP_F: 0.8,          // 生存值 = 機甲平均的 80%(HP/護盾/護甲;見 UNITS.drone 推導 + heroArmor())
  DMG: 1,             // 單機傷害 = 機甲全額(不再折算;heroWeapon() 唯一套用點,三機時代 = 1/3)
  ARMOR_F: 1,         // 無人機護甲等比縮放係數(UNITS 之後 derive:令無人機平均 armor = 機甲平均 ×HP_F)
  DRONE_AVG_HP: 0,    // 初始無人機平均總血量(護盾+裝甲;UNITS 之後 derive)→ 防空伏擊傷害 = 此值 /3
  // ── 飽和攻擊(2026-08-01 使用者需求;原「自爆攻擊」)──
  //  「長按右鍵」觸發:四架 1/2 體型、外觀同主機的自殺攻擊機**在觸發當下才生成**,以主機 3 倍速
  //  撲擊,各造成機種絕招預算 1/N 的重型炸彈爆風;敵方導引飛彈會被衝出的護衛機吸走砲火
  //  (見 sim._tickKamis / _tickMissiles)。
  //  **2026-08-06 使用者定案「自殺攻擊機拿掉常駐模組,攻擊時再出現」**:舊制在觸發前另有四架
  //  純客戶端的貼身護衛機外觀(不在 sim ⇒ 不可鎖定/受傷),整組退場 —— 連同它的 ㄑ 字編隊
  //  (`ESCORT`/`escortSlot`/`escortLagBase`/`escortLagK`/`escortDrift`、`game._buildDroneEscorts`/
  //  `_updateEscorts`、`tools/audit_escort_form.mjs`)。**MUST NOT 復辟**:那批模型是「看得見卻
  //  打不到」的擺件(原則 4 的反面),而衝出後的 kami 本來就是 sim 實體、客戶端照樣渲染得出來
  //  ⇒ 使用者要的「攻擊時再出現」不需要任何新機制。CD 期間也就沒有東西需要顯隱判定了。
  //  **N 2 → 4「攻擊力減半、數量加倍」是同一件事**:每架 = 預算 / N ⇒ N 加倍即每架減半,
  //  整份預算(= 三招等值)逐位元不變。MUST NOT 另外手寫折半係數(那會把總預算也砍半)。
  KAMI: {
    N: 4, SHOT_DOWN: 2, SIZE_F: 1 / 2, SPEED_MUL: 3, CD_S: 30,
    // HP 不再吃主機血量比例(HP_F 已移除):改由「一座砲塔擊落 SHOT_DOWN 架、其餘成功自爆」
    // 反解(見 kamiHp)⇒ 使用者定調的「只有一座砲塔時可以成功自爆 2 架」是**推導值**,MUST NOT 手寫。
    // 傷害不再手寫折半係數:每架 = 機種絕招預算 / N(見 kamiBlast);N 架打完 = 一份完整預算。
    DEATH_F: 0.5,     // 被擊毀時原地引爆(2026-07-22 使用者需求):傷害與半徑各取正常撲擊爆風的 50%
    SPREAD: 0.55,     // 衝出時前方左右散開角(弧度,≈32°)
    FWD: 8, SIDE: 5,  // 衝出生成點:前置 / 側置偏移(公尺)
    TURN: 3.2,        // 追蹤限轉率(弧度/秒;比集束轟炸機敏捷)
    BOOM_M: 5,        // 近炸引信半徑
    TTL_S: 8,         // 無目標時直飛自毀秒數
    ACQ_R: 260,       // 無鎖定時自動索敵半徑
  },
  // 以下為三機小隊時代的編隊/歸隊常數;N=1 後 _tickSquads 無僚機可跑,保留以維持路徑相容。
  FORM_SIDE: 15, FORM_BACK: 10, REGROUP_M: 70, REJOIN_F: 0.6,
  LANE_SNAP_M: 25, LANE_STEP_M: 80, REGROUP_ALT: 30, REGROUP_MUL: 1.3,
  DASH_MUL: 3, DASH_BOOM_M: 4,
};

// ---- 準星鎖定(全機種通用;2026-07-10 起不再只是無人機自爆衝刺的目標)----
// 客戶端把「射程內 + 準星對準」的敵方單位回報伺服器;伺服器複驗距離後廣播 lock 事件:
//   施放者 → 目標身上浮現光暈;目標本人 → HUD 被鎖定警告。
// 無人機另外沿用它當自爆衝刺目標。
export const LOCK = { TTL: 2.5, WARN_S: 1.6 };

// ---- 狙擊鏡可視圓(CSS `--scope-r` 的唯一真相;2026-08-02 抽成單一縫)----
// 狙擊模式(`body.aiming`)的黑邊遮罩(style.css `.scope-vig`)只留中央一個正圓看得見,
// 火場滯留會把圓縮小(main.js `envFog`)。**「狙擊模式看得見誰」一律以這個圓為準** ——
// 視野鎖定的取景同吃這一份(遮罩黑掉的地方 MUST NOT 鎖得到)。
// style.css 裡的 40vmin 只是 CSS 變數未設定時的回退值,MUST NOT 當第二份真相改。
export const SCOPE = { R_VMIN: 40, FOG_R_VMIN: 18 };
/** 目前的鏡圈半徑(vmin);`fog` = 火場霧化濃度 0~1(0 = 無霧)。縮圈曲線 MUST NOT 手寫第二份 */
export const scopeRvmin = (fog = 0) =>
  SCOPE.R_VMIN - Math.max(0, Math.min(1, fog || 0)) * (SCOPE.R_VMIN - SCOPE.FOG_R_VMIN);

// ---- 景深模糊(2026-08-09 使用者需求「加入遠的物件隨距離景深模糊的效果」)----
// **純表現層**(與 SCOPE / VIEW_LOCK / RECOIL 同層:伺服器完全不知道它的存在 ⇒ 不涉 A1),
// 而且**是加成本不是省成本**的 —— 它是後製管線多出來的一個全螢幕 pass,採用的理由是畫面
// 不是效能(2026-08-09 已向使用者說明後定案)。住 data.js 而不住 postfx.js 的理由同 SCOPE:
// 離線稽核 MUST 能 import **真品**驗下面那條不變式,而 postfx.js 依賴 three(沙箱無 CDN)。
//
// **兩個轉折點推導不手寫**,係數就是使用者 2026-08-09 提的那兩圈:起糊 = 1.5×、全糊 = 2×。
//
// **錨改了,而那是量出來的**:使用者原話是「狙擊模式可視範圍」的倍數,但 `COMBAT_SCALE`
// 把 sight 與武器射程一起砍半、**地圖邊長沒有跟著砍**(REAL_SCALE 是另一條路)⇒ 現役的
// 狙擊可視只有 192~216m,而**最遠交戰距離 304m 比它還遠**(重武器射程上限吃的是
// `sight × AIM_SIGHT_MULT × RANGE_SIGHT_F`,再乘高度制空與防作弊容差)。照原話取
// 1.5 × 216 = 324m 的話,起糊點就落在交戰距離**裡面** —— 糊掉打得到的目標不再是表現層
// 改動而是玩法改動(原則 4),而畫面上只表現成「這場好像比較難瞄」。
//
// 故錨在 `combatReachM()`:**「打得到的東西恆為全清晰」因此是結構保證而不是校準**——
// 起糊點 = 交戰上界 × 1.5,射程/視野/塔怎麼調都自己跟著走。錨也 MUST NOT 取相機 far
// 平面(= 地圖邊長 × 2):那隨隊制變(L1/L2/L3 邊長 800/1000/1200),同一把武器在大地圖上
// 就要更遠才開始糊,而「多遠算遠」是戰鬥尺度的性質不是地圖尺寸的性質。
//
// 全糊那一圈刻意就是使用者原本要「不顯示」的那一圈:日後真做距離剔除時,物件消失的邊界
// **已經在全糊帶裡** ⇒ 憑空消失的那一下被模糊蓋住。兩件事對得起來不是巧合,是同一組數字。
export const DOF = {
  NEAR_F: 1.5,     // 起糊 = 交戰距離上界 × 此值。**1.0 以下即侵入交戰距離**(稽核 Ⅵ-b 守門)
  FAR_F: 2.0,      // 全糊
  // 最大模糊半徑 = **螢幕高度的比例**,不是像素。寫成像素的話高解析度螢幕上相對變窄、
  // 而 RES_GOV 一降階又相對變寬(同一根拉桿在不同裝置上是不同的效果)。
  MAX_R: 0.005,
  TAPS: 8,         // 圓盤取樣數(低功耗折半;分布與展開全在 postfx.js)
};
let _reachM = 0;
/**
 * 全場最遠交戰距離(m)= 「這個距離上還可能發生傷害或需要瞄準」的上界。**推導不手寫** ——
 * 取樣面 MUST 涵蓋每一條會讓玩家想看清楚遠處的路徑,漏一條就是那一種目標被糊掉:
 *   ① 砲塔射程(它會先開火,而你得看得到是誰在打你);
 *   ② 32 角 × 兩槽位 × 四階的解析後射程,再乘**高度制空放寬**與**防作弊容差**
 *      —— 伺服器真的會收下那個距離的回報(`RANGE_TOL`),那就是誠實的上界;
 *   ③ 32 角 × 兩槽位 × 四階的招式施放距離;
 *   ④ 大招載具的最長航程(`hyperMaxArcM`)—— 它是可鎖定可擊落的實體,全程都該看得見。
 * 快取:靜態資料的純函式,而呼叫點在開場與換座機(每局個位數次)。
 */
export const combatReachM = () => {
  if (_reachM) return _reachM;
  let m = UNITS.tower?.range || 0;
  const wF = altRangeMax() * RANGE_TOL;
  for (const ch of Object.keys(CHARACTERS)) {
    for (const slot of ['light', 'heavy']) {
      for (let lv = 1; lv <= 4; lv++) {
        m = Math.max(m, (heroWeapon(ch, slot, lv, true)?.range || 0) * wF);
      }
    }
    for (const slot of ['skill', 'ult']) {
      for (let lv = 1; lv <= 4; lv++) m = Math.max(m, heroAbility(ch, slot, lv, true)?.range || 0);
    }
  }
  _reachM = Math.max(m, hyperMaxArcM());
  return _reachM;
};
/** 開始模糊的距離(m)。MUST NOT 手寫 —— 改射程 / 視野 / 塔,兩個轉折點自己跟著走 */
export const dofNearM = () => combatReachM() * DOF.NEAR_F;
/** 完全模糊的距離(m) */
export const dofFarM = () => combatReachM() * DOF.FAR_F;
/**
 * 景深強度隨進鏡程度(2026-08-09 使用者補充「遠景景深模糊**只有在狙擊模式**」)。
 * 0 = 一般視角(這一 pass 整個退出鏈)、1 = 完全進鏡。
 *
 * **輸入是當下的 `camera.fov` 而不是 `aiming` 布林**,理由是單一曲線:右鍵拉近本來就已經
 * 有一條緩動(`game._updatePlayer` 的 `fov += (want − fov) × min(1, dt × 10)`),照布林做
 * 硬切就是進鏡瞬間「啪」地糊掉;而自己再跑一條淡入淡出 = **第二條時間曲線**,兩者遲早不
 * 同步,症狀只是「模糊比鏡頭慢半拍」,沒有任何錯誤訊息。由 fov 反解 ⇒ 兩者**結構上**是
 * 同一條曲線,連緩動係數都不必共用。
 *
 * `span ≤ 0`(zoomFov 未設 / 與 baseFov 相同 / 觀戰滾輪把 fov 拉到帶外)一律回 0 =
 * 不糊(原則 6 寧缺勿錯:偏差朝「看得清楚」)。
 */
export const dofAimBlend = (fov, baseFov, zoomFov) => {
  const span = baseFov - zoomFov;
  if (!(span > 0)) return 0;
  return Math.max(0, Math.min(1, (baseFov - fov) / span));
};

// ---- 世界曲面(2026-08-09 使用者需求「地圖改成曲面…曲率半徑可以『有遠方機體先看到上半部』
// 的效果,但鄰近局部感受又是平的」)----
// **純表現層**(與 DOF / SCOPE / RECOIL 同層:伺服器完全不知道它的存在 ⇒ 不涉 A1)。住 data.js
// 而不住 toon.js 的理由同 DOF:離線稽核 MUST 能 import **真品**驗下面那條不變式,而 toon.js
// 依賴 three(沙箱無 CDN)。
//
// **做法 = 使用者原話的第二句**:地形/物件/接觸點/碰撞/彈道**全部照舊在平面空間算與擺**,
// 曲面只發生在**頂點著色器**的最後一步(`toon.js installWorldCurve`)—— 世界座標往下沉
// `curveDropM(離相機的水平距離)`。JS 這一側一行判定都沒有改,所以「平面算完再轉曲面」不是
// 約定而是**結構保證**:曲面根本沒有第二份實作可以跟平面那份分家。
//
// **拐點 `curveKneeM()` 是這整套的樞紐,而它不是美術參數是安全參數**。沉降量是相機到該點的
// 水平距離的函式 ⇒ 目標在畫面上會比它的平面座標低 `drop/d` 弧度,而準星是**平面**射線
// (`_resolveAim` / `_reachable` / `_shotVictims` / `heroLance` 全鏈都是)⇒ 只要交戰距離之內
// 有沉降,玩家把準星壓在**看到的**敵人身上時,平面射線就從它上方過去 = 「看得到打不到」,
// 而且伺服器那一端完全正常、沒有任何錯誤訊息(原則 4 / A30 家族)。實測那個角度不是小數點
// 後的東西:純球面(拐點 0)在最遠交戰距離上是 0.77°,而一台機體在該距離只張 1.3°。
// 故拐點 = `combatReachM()`:**打得到的東西恆為零沉降**,曲面只作用在打不到的距離上 ⇒
//   ① 準星與命中逐位元同改制前(整個 FPV / 座艙 / 特效 / 展示台 / 樣品場景一併),
//   ② 「鄰近局部感受是平的」不是校準出來的,是**這一條的推論**。
// 這與 DOF 的「打得到的東西恆為全清晰」是同一句話的兩半,錨也是同一個 —— 打得到的距離之內
// 既不糊也不沉,出了那一圈才開始糊、才開始沉。`KNEE_F = 0` 即退回**純球面**(連腳邊都彎),
// 代價就是上面那 0.77°;稽核 Ⅱ 以 `--break-knee` 釘住這一條。
//
// **地平線 = 起糊那一圈**(`curveHorizonM() = dofNearM()`):看不清的那一圈同時也是沉下去的
// 那一圈,兩件事對得起來不是巧合,是同一組數字(同 DOF 檔頭「全糊那一圈刻意就是使用者原本
// 要不顯示的那一圈」)。曲率半徑由它**反解**(見 `curveR`),MUST NOT 手寫公尺數。
export const CURVE = {
  // 拐點 = 交戰距離上界 × 此值。**1.0 以下即侵入交戰距離**(稽核 Ⅱ 守門);0 = 純球面
  KNEE_F: 1.0,
  // 允許的**弦高**(m):一條直邊橫跨 L 公尺時,線性內插與真曲面差 L²/(4R)。世界上絕大多數
  // 幾何早就細於這個尺度(地形格 8.3m ⇒ 1.2mm),這個值只服務「一整片鋪成兩個三角形」的
  // 那幾塊 —— 現役唯一消費端是水面,而它要對齊的是岸線。
  // **尺就取岸線容差 `WATER.SHORE`**:那是全專案已經定案的「水面與地形貼到這個距離就算同一
  // 個面」,曲面這一層沒有理由自己另訂一把更鬆的。稽核 Ⅴ 釘住 `SAG_M ≤ WATER.SHORE`
  // (`--break-edge` 反向驗證)—— 放寬它的症狀是水面從遠處的地形裡整片浮出來,而所有讀數
  // 都正常。
  SAG_M: 0.05,
};
let _curveEye = 0;
/**
 * 錨定地平線用的**參考視點高**(m)= 全場最矮機體視點高的**下界**。
 *
 * FPV 視點比例住 `game.js VIEW_SHAPE`(依機體形狀 0.62~0.88),查不到才回退 `SELF_F.eye`
 * (0.567)—— 也就是說 `SELF_F.eye` 是那張表的**地板**,拿它當比例得到的一定不高於任何一台
 * 機體的真實視點。偏差方向朝「地平線更近」而不是「更遠」,與 `curveKneeM` 的保證無關
 * (那一條由拐點本身給,與視點高完全無關)。稽核 Ⅰ 以 game.js **原文**釘住這個地板關係。
 */
export const curveEyeM = () => {
  if (_curveEye) return _curveEye;
  let h = Infinity;
  for (const ch of Object.keys(CHARACTERS)) {
    for (let lv = 1; lv <= 4; lv++) h = Math.min(h, heroTargetH(ch, lv));
  }
  _curveEye = h * SELF_F.eye;
  return _curveEye;
};
/** 拐點(m):這個距離以內**完全不彎**。MUST NOT 手寫 —— 改射程/視野/塔,它自己跟著走 */
export const curveKneeM = () => combatReachM() * CURVE.KNEE_F;
/** 地平線(m)= 起糊那一圈。地表在這裡達到視線仰角的極大值,更遠的地面從此被它擋住 */
export const curveHorizonM = () => dofNearM();
/**
 * 曲率半徑(m)。**反解不手寫**:沉降 `drop(d) = (d − D0)² / 2R`(d > D0)之下,眼高 h 的
 * 地表仰角 `−(h + drop(d))/d` 在 `d = √(D0² + 2Rh)` 取極大 —— 那就是地平線。令它等於
 * `curveHorizonM()` 即得 `R = (H² − D0²) / 2h`。改任一個錨(塔射程 / 武器射程 / 機體高)
 * 三個量一起走,MUST NOT 回頭手改半徑。
 */
export const curveR = () => {
  const D0 = curveKneeM(), H = curveHorizonM();
  return Math.max(1, (H * H - D0 * D0) / (2 * curveEyeM()));
};
/**
 * 水平距離 d(m,量到**相機**)處的沉降量(m)。拐點以內恆 0(見上方拐點那一段)。
 * 這是全專案唯一一份曲面公式的 **JS 面**;GLSL 面由 `toon.js` 以同樣兩個常數展開,
 * 稽核 Ⅳ 以原文釘住兩者取的是同一支函式(MUST NOT 在著色器裡手寫公尺數)。
 */
export const curveDropM = (d) => {
  const u = d - curveKneeM();
  return u <= 0 ? 0 : (u * u) / (2 * curveR());
};
/**
 * 一條直邊最長容許多少公尺(超過就要細分,否則弦高看得出來)。
 * 弦高 = L²/(4R) ⇒ L = √(4R × SAG_M)。消費端目前只有水面(整片鋪兩個三角形)。
 */
export const curveMaxEdgeM = () => Math.sqrt(4 * curveR() * CURVE.SAG_M);

// ---- 視野鎖定(2026-08-01 使用者需求:虛擬搖桿加入「按住鎖定目標」= 觸控 ZR)----
// **純客戶端視角輔助**(與 RECOIL / BALLISTIC 同層,伺服器完全不參與 ⇒ 不涉 A1):按住期間每幀把
// **基準視角**(yaw/pitch)朝鎖定的敵方單位收斂,放開即恢復自由視角。權威側看到的仍只有
// 本來就會送的視角回報(pos.ry)與既有的 `lock` 回報 —— 沒有任何新的權威狀態。
//
// **2026-08-02 改制(使用者定案)**:「按 ZR 時會輪流切換前方視野內看見的所有敵人,狙擊模式時
// 以狙擊鏡視野為主」⇒ 兩件事一起變:
//   ① 取景從「準星錐」換成**玩家真的看得見的那一塊** —— 一般模式 = 畫面矩形、狙擊模式 = 上面
//      `SCOPE` 那個正圓遮罩之內。狙擊鏡的 FOV(`UNITS[kind].zoomFov`)本來就吃進相機投影,
//      MUST NOT 為了狙擊模式另寫一份角度縮放(那會與畫面上看到的分家)。
//   ② 每**按一次**輪替到名冊裡的下一個(按住 = 持續貼著當前那個),名冊順序 = 畫面由左至右。
// 兩種取景一律換算成**正規化偏離度**(0 = 準星正中央、1 = 取景邊界、>1 = 看不見),
// 下面兩個門檻因此兩種取景共用同一把尺。
//
// **後座力刻意不抵銷**(使用者指定「還是會有後座力」):相機角 = 基準角 + `recoil`(合成住
// game.js `_updatePlayer`),鎖定只拉基準角 ⇒ 每一發的上踢照樣看得見、也照樣要等回穩。
// 若改成「鎖定時直接把相機朝向設成指向目標」,後座力就會被無聲吃掉 —— MUST NOT。
//
// 追瞄用「逼近係數 EASE 與角速度上限 W 取小者」:純比例逼近在遠距目標會瞬移式吸附(暈),
// 純角速度上限則貼臉時抖動;兩者取小 = 遠處快、貼近柔。DROP > EDGE 是遲滯 —— 取得只認畫面內,
// 脫鎖放寬到畫面外一截(目標貼著邊緣跑動時不會一直忽鎖忽脫)。
export const VIEW_LOCK = {
  EDGE: 1.0,    // 取得目標的取景邊界(正規化偏離度;1 = 畫面邊緣 / 鏡圈邊)
  DROP: 1.25,   // 已鎖目標超出此邊界才放掉(遲滯)
  W: 5.0,       // 追瞄角速度上限(rad/s)
  EASE: 9.0,    // 逼近係數(1/s)
};
/**
 * 這一幀要把視角朝目標轉多少(rad;`d` = 尚差的角度,正負即方向)。**唯一縫** ——
 * yaw 與 pitch 兩軸、以及稽核的行為直測全吃這一支,game.js MUST NOT 手寫 W/EASE。
 * 逼近項 `d × EASE × dt` 與角速度上限 `W × dt` 取小者(見 VIEW_LOCK 註解)。
 */
export const viewLockStep = (d, dt) => {
  const cap = VIEW_LOCK.W * dt;
  return Math.max(-cap, Math.min(cap, d * Math.min(1, VIEW_LOCK.EASE * dt)));
};

// ---- 觀戰視角(2026-08-02 使用者需求:「上帝視角加入下降操作」+「玩家視角可切換
//      第一人稱 / 第三人稱跟隨視角 / 第三人稱自由視角,運鏡時避免太晃」)----
// **純客戶端視角工具**:不送任何訊息、不改任何權威狀態(與 VIEW_LOCK 同性質 ⇒ A1 不涉)。
// 住 data.js 而不住 game.js 的理由與 VIEW_LOCK / SCOPE 一致:離線稽核 MUST 能 import **真品**
// 做行為直測,而 game.js 依賴 three(沙箱無 CDN)⇒ 常數與純數學收在這裡,game.js 只當消費端。
export const SPEC_CAM = {
  // 視角循環的**唯一真相**:鍵盤 F 與觸控十字鍵左吃同一份序,說明文字與播報名稱亦由此推導。
  // god = 自由飛行(無跟隨目標);其餘三種都跟著某位玩家。
  VIEWS: ['god', 'fpv', 'tps', 'orbit'],
  NAMES: { god: '上帝視角', fpv: '第一人稱', tps: '第三人稱跟隨', orbit: '第三人稱自由' },
  FOV_MIN: 12, FOV_MAX: 100, FOV_STEP: 1.12,   // 滾輪一格 = 乘/除一次(等比 ⇒ 遠近端手感一致)
  FLY_M: 2.5,          // 跟隨目標離地高於此 = 飛行型態(視點改取機鼻,同 heroView)
  // 上帝視角自由飛行:水平吃 _moveAxis、垂直吃升/降鍵(Space / C・Ctrl)。
  // FLOOR_M = 下降的地板餘裕:降到站立面上方這麼高就停住 —— 鑽進地形底下只會看到黑畫面,
  // 「降不下去」比「掉進山肚子裡」好(原則 6 寧缺勿錯)。
  MOVE_MPS: 120, BOOST_F: 3, FLOOR_M: 2,
  // 第三人稱運鏡:距離與注視點一律以**該機體實高**(heroTargetH)為尺 —— 26m 的重機甲
  // 與 5m 的小無人機共用固定距離必然一頭太遠一頭穿模。MIN_DIST 是小機體的下限。
  // 相機的**抬高不另設常數**:注視點固定 = 機體頂高 × AIM_F,抬高完全由俯仰推導
  // (`camY = aimY − sin(pitch)·dist`)⇒ 觀戰者往下看多少,相機就抬多高,不會兩份參數打架。
  DIST_F: 6.5, AIM_F: 1.0, MIN_DIST: 12,
  // 平滑係數(1/s;越大越跟手)。**運鏡不晃的全部本錢在這三個值 + camSmoothF 的幀率無關性**:
  // 快照 8Hz、機體位置每幀插值、伺服器 ry 量化到 0.01 rad ⇒ 直接把相機貼上去就是逐幀抖。
  // 第一人稱要跟手(玩家轉頭觀戰者就該跟著轉)⇒ FPV_YAW_K 明顯大於第三人稱的 YAW_K。
  POS_K: 6, YAW_K: 4, FPV_YAW_K: 12,
  SNAP_M: 40,          // 錨點與目標差距超過此值 = 換人/重生瞬移 ⇒ 直接貼上去(平滑會拉出一條長鏡頭)
  TPS_PITCH: -0.18, ORBIT_PITCH: -0.25,  // 進入該模式時的預設俯仰(之後仍由觀戰者自己看)
  // **剛體貼合的視角**(2026-08-02 使用者定案「第一人稱視角和第三人稱跟隨視角應該要跟著機體」)。
  // 位置平滑是給「觀戰者自己在看」的鏡頭用的;第一人稱與第三人稱跟隨是**掛在機體上**的鏡頭 ——
  // 機體位置本來就已經逐幀插值過(`_updateEnts` 的 8Hz → 每幀逼近),再套一次 POS_K 就是**雙重平滑**:
  // 穩態落後 = 速度 ÷ POS_K(40m/s 的無人機 ≈ 6.7m)⇒ 第一人稱看到自己的機體一路跑在前面、
  // 第三人稱跟隨的機體被推到畫面邊緣。剛體貼合不會抖(來源已經是平滑過的插值位置),
  // 偏航仍走 `camAngleStep` 平滑(ry 量化到 0.01 rad,那一份是真的會一格一格跳)。
  LOCK_VIEWS: ['fpv', 'tps'],
};
/** 這個視角是不是「掛在機體上」(位置剛體貼合,不再套 POS_K 平滑)。兩個消費端共用這一份判定 */
export const specViewLocked = (view) => SPEC_CAM.LOCK_VIEWS.includes(view);
/** 視角循環的下一個(唯一實作;鍵盤與觸控共用)。未知值一律回到序首,降級不例外 */
export const specViewNext = (id) => {
  const i = SPEC_CAM.VIEWS.indexOf(id);
  return SPEC_CAM.VIEWS[(i < 0 ? 0 : i + 1) % SPEC_CAM.VIEWS.length];
};
/**
 * 指數平滑的**幀率無關**權重:`1 − e^(−k·dt)`。相機平滑的唯一縫 ——
 * MUST NOT 退回逐幀固定係數(`x += (t − x) * 0.1`):同一段運鏡在 30fps 與 120fps
 * 會收斂出不同的跟隨延遲,高幀率反而更黏、低幀率反而更晃(正是「太晃」的來源)。
 */
export const camSmoothF = (k, dt) => 1 - Math.exp(-Math.max(0, k) * Math.max(0, dt));
/** 角度差正規化到 [−π, π):跨 ±π 的偏航 MUST 走最短路徑,否則機體轉過背面時相機會繞一整圈。
 *  正負 π 兩端等價(轉一樣多、方向相反)⇒ 端點落在哪一邊不影響運鏡,只影響剛好 180° 的旋向 */
export const wrapPi = (a) => {
  let d = (a + Math.PI) % (Math.PI * 2);
  if (d < 0) d += Math.PI * 2;
  return d - Math.PI;
};
/** 這一幀的偏航平滑結果(rad)。兩個消費端(第一人稱視線 / 第三人稱跟隨)MUST 同吃這一支 */
export const camAngleStep = (cur, tgt, k, dt) => cur + wrapPi(tgt - cur) * camSmoothF(k, dt);

// ---- 集束炸彈(變形者專屬可分離子機;2026-08-01 更名,原「轟炸餌機」)----
// 「其他性質跟餌機相同」(使用者定調)⇒ 載具(可分離子機)整套沿用:分離發射,航向鎖定發射瞬間的
// 機首朝向(玩家無法操舵)、準星有鎖定目標(LOCK.TTL 內)才追蹤、飛行中經 PiP 小視窗回傳畫面與視野、
// 超過 LINK_M 失聯(斷訊、不再回傳視野,機體仍直飛到 TTL_S 自爆)、可被擊落替主機吸走火力。
// 改的只有**投彈**那一段(見 BOMB_*):彈數 6、逐顆個別瞄準、投擲軌跡同榴彈。
// 內部識別字 decoy/DECOY 刻意不改(entity kind / 事件名 / 稽核與 e2e 全綁在上面);
// 面向玩家的名稱一律「集束炸彈 / 集束轟炸機」(UNITS.decoy.name 與 help.js 是唯一文案來源)。
export const DECOY = {
  SPEED: 62,
  TURN: 2.0,        // 追蹤時每秒最大轉向(弧度);無鎖定時完全不轉向
  ALT: 8,           // 發射後相對主機甲的爬升高度
  LINK_M: 340,      // 失聯距離
  TTL_S: 14,
  CD_S: 30,         // 冷卻(自發射瞬間起算;歸零 = 掛點重新組合出一架)
  BOOM_M: 6,        // 追蹤命中的近炸引信半徑
  SIGHT: 200,       // 偵察視野(僅連線中回傳)
  // 撞擊/投彈的**傷害不住這裡**(2026-07-27):與另兩招共用機種絕招傷害預算,
  // 由 decoyBlast()/decoyBombBlast() 推導(見 SPECIAL);此處只留彈體規格(半徑/破甲/vs)。
  PEN: 10,
  vs: { flesh: 1.4, armor: 1.3, air: 0.6, building: 1.2 },
  // 集束投彈(2026-08-01 改制):敵人進 BOMB_R 才開始丟,間隔 BOMB_GAP 秒、單次任務最多 BOMB_MAX 枚。
  // 單枚 = 直擊爆風(預算的非撞擊部分均分)+ 依機體類型附加狀態(見 DECOY_BOMB / MORPH_BOMB)。
  // 三項使用者定調:①BOMB_MAX 6;②**逐顆個別瞄準**(範圍內多目標時輪流分配,見 sim._decoyBombTargets)
  // —— 舊制是「炸在自己腳下」,多目標時後幾顆全落在同一團;③投擲軌跡同榴彈(客戶端拋物線,見
  // game._spawnDecoyBomb 的 to 落點解;伺服器仍在事件當下結算,拋物線純表現層)。
  // 爆風半徑不住這裡:三招共用面積計價(見 specialBlastR)—— 舊 R / BOMB_BLAST_R 已退場
  BOMB_R: 90, BOMB_MAX: 6, BOMB_GAP: 0.7, BOMB_PEN: 6,
  // 一座砲塔火力下投得完 DROP_N 顆(墜毀補投的那一顆不算)—— HP 反解錨點,見 decoyHp()。
  DROP_N: 5,
};
// ---- 集束投彈:依機體類型的效果(復用 sim 既有 bleed/slow/EMP/stun,無新狀態欄位)----
// fire/poison 走 bleed 逐體 DoT(owner 記功)、freeze 走 slow 減速、thunder 走 EMP(武器離線)+ stun 麻痺。
export const DECOY_BOMB = {
  fire:    { name: '燃燒彈', color: 0xff6a2a, dot: 22, dur: 4 },              // 灼燒 DoT
  freeze:  { name: '凍結彈', color: 0x8fd8ff, slow: 0.35, dur: 3 },          // 重減速(近凍結)
  poison:  { name: '毒霧彈', color: 0x8fe36a, dot: 15, dur: 5, slow: 0.7 },  // 毒 DoT + 微減速
  thunder: { name: '雷爆彈', color: 0xffe14f, emp: 2.0, stun: 0.6 },         // 武器離線 + 短暫麻痺
};
/** 變形者角色 → 集束炸彈類型(四類各兩台,依機體/性格配置) */
export const MORPH_BOMB = {
  m01: 'thunder', m02: 'freeze', m03: 'fire',   m04: 'poison',
  m05: 'thunder', m06: 'fire',   m07: 'freeze', m08: 'poison',
};
export const morphBomb = (ch) => DECOY_BOMB[MORPH_BOMB[ch] || 'fire'];
// ---- 極音速飛彈(2026-08-01 使用者需求;機甲專屬,取代舊「重砲模式/巨砲」)----
// 長按右鍵發射一枚**射後不理**的極音速飛彈,兩相位(2026-08-02 使用者定案彈道):
//   「前半段拋物線飛向高空,初始角度 45 度,後半段再以極快速度向下螺旋飛向目標」。
//   相位一 **彈道爬升**:以 LAUNCH_DEG(45°)出膛,沿真實拋物線飛向目標上空(見 hyperArcY);
//   相位二 **極音速螺旋俯衝**:在頂點改由 hyperDiveSpd() 繞軸螺旋撲下(落點 = 發射瞬間的目標地點;
//           只有通過下面那條**終端追擊**判定的那一發,才改追鎖定實體的即時位置。
//           無鎖定 = 打正前方 hyperRange() 的地面點)。
// 「射後不理」= 發射後玩家完全不需再瞄準/維持鎖定,飛彈自己飛完全程(對齊 trajClass 'fnf' 語意)。
//
// **終端追擊有射程(2026-08-05 使用者定案)**:「前 2/3 的軌跡是飛往發射時目標的初始地點,
//   後 1/3 軌跡時如果目標還在特定範圍(砲塔射程的 1/2)才會以螺旋軌跡繼續追擊目標,
//   如果目標已遠離特定範圍則保持原軌跡」。三件事各自有落點:
//   ①**「前 2/3 / 後 1/3」不是新的相位邊界,而是既有兩相位的推導比例**(見 hyperTerminalF):
//     爬升弧長與俯衝段(頂點高)都正比於交戰距離 ⇒ 比例與距離無關、只由發射角決定,
//     45° 恰好切在 69.7% / 30.3%。故追擊判定就掛在**既有的頂點切換點**上,MUST NOT 另立
//     一個「走完 2/3 就轉彎」的第三相位 —— 那會把頂點從目標正上方挪走(拋物線當場不成立)。
//   ②**判定只做一次**(頂點那一刻,見 sim._tickHypers 的 m.chase):俯衝不到 1 秒,而追擊與否
//     的兩個落點相距可達 hyperTrackR() ⇒ 逐 tick 重判會讓彈道在最後零點幾秒**整條折斷**,
//     兩端(伺服器推進 / 客戶端插值)也就對不上同一條航跡。
//   ③爬升段因此**完全不讀目標的即時位置**:落點 tx/tz 就是發射瞬間烤死的那一點(原軌跡終點)。
//     放棄追擊 = 什麼都不做,就沿著它打下去(螺旋仍在 —— 那是俯衝段本身的演出,見 SPIRAL_R)。
//
// **彈道幾何全是推導,MUST NOT 手寫**(45° 這一個角度定死了其餘每一個量):
//   一條發射角 θ 的彈道,其**上升段**在水平走完 x 時的高度 = x·tanθ·(1 − x/(2·X)),
//   頂點在水平 X 處、頂點高 = X·tanθ/2。本招把 X 取成「到目標的水平距離」⇒ 頂點恰在**目標正上方**,
//   後半段因此是真正的「向下」俯衝(而不是滑翔),且爬升段的水平分速恆為 CLIMB_SPD·cosθ。
//   頂點高隨交戰距離自然變化(遠 = 爬得高),最遠射程那一發 = hyperApex():
//   MUST 仍高過直射鎖定天花板 GAME.GUN_CEIL_M(e2e / audit_flight_power 釘住)——
//   「飛向高空」是這一招的本體,調 LAUNCH_DEG / RANGE_F 會同時動到它。
//   舊制 APEX_F(頂點 = GUN_CEIL_M × 常數、爬升段**垂直**上升)已退場,MUST NOT 復辟:
//   垂直爬升的頂點與發射點同一個水平位置 ⇒ 「初始角度 45 度」無處可放。
//
// **飛彈是實體、可被攻擊**(sim ent kind 'hyper',敵方小兵/塔的合法目標)⇒ 它的 HP 是平衡旋鈕:
//   使用者定調「持續攻擊剛好不會被打爆」⇒ HP 由**最長飛行時間**反解(見 hyperHp),MUST NOT 手寫。
//   最長 = 最遠射程那一發(爬升 + 頂點垂直落下),故任何距離都撐得過同一組火力。
//   基準是**它飛越的整條前線**(一組塔位 + 一波兵,見 overflySurviveHp)—— 只有這一招的用途是
//   「站在塔的射程外拆塔」⇒ 航路必然從敵方兵波頭上過去,拿只算塔的尺反解就少算了一半火力。
//   改彈道 = 改曝險窗 ⇒ hyperFlightS 一動,HP 自己跟著漂(這正是推導的用意)。
// **火力改制(2026-08-06 使用者定案)**:「極音速飛彈攻擊力太高了,常常被一轟就爆,
//   同等於 2.5 架自爆無人機的傷害」。舊制是「單一戰鬥部吃**整份**預算」(= 4 架自爆無人機)
//   ⇒ 一發把人轟掉是設計的直接後果(Lv4 705 vs 最脆的無人機 EHP 728)。
//   傷害改為 預算 × `hyperShare()`(= KAMI_EQ / KAMI.N;Lv1 300 → 188、Lv4 705 → 441)——
//   **推導不手寫**:改 `KAMI.N` 它自己跟著走、「2.5 架份」這句話恆成立;手寫 0.625 會在 N 一改
//   就與使用者的話分家。
// **只動火力,範圍不動**(同日使用者定案「範圍改回舊制」):爆風半徑仍取 `specialBlastR(1)`
//   ⇒ 上面「三招總覆蓋面積相同」那條不變式逐位元不受影響。MUST NOT 「順手」把半徑也乘上
//   `√hyperShare()`(那是使用者沒有要求的第二次削弱,而且會讓這一招同時失去點殺與面壓制兩頭)。
//   中途試過的 `hyperBlastR()` / `HYPER.BLAST_R_F`(半徑 = 砲塔射程 2/5 = 62m)**已退場、
//   MUST NOT 復辟**:半徑一放大就蓋得住同塔位雙塔(塔距 30m),bal ⑦f 的實得傷害反而由
//   155 升到 197 EHP/次(範圍不動版 102)—— 火力砍了、交付總量卻更高,與使用者的訴求相反。
// 舊制 BARRAGE(傾洩重武器彈夾的巨砲)整組移除:BARRAGE / barrageShots / barrageDur /
//   LANCE.BARRAGE_F / SHAKE.BARRAGE* / sim._barragingDmg 與各射程閘的 RANGE_F 分支全數不再存在。
//   **MUST NOT 復辟**:重武器射擊路徑上不該再有任何「這一發免彈夾/免射速閘」的旁路 ——
//   那是舊巨砲留下的洞,新招是獨立實體,與重武器彈夾完全脫鉤。
export const HYPER = {
  // 尺度紀律:飛彈的位置由伺服器每 tick 推進 ⇒ 速度/高度/射程全是**遊戲空間**(已吃 COMBAT_SCALE)。
  //   射程與高度因此 MUST 由已縮好的量推導,MUST NOT 手寫真實世界公尺(那會大出一倍)。
  LAUNCH_DEG: 45,    // **初始角度**(度;2026-08-02 使用者定案)—— 拋物線的形狀與頂點高全由它推導
  RANGE_F: 1.2,      // 最大接戰距離 = 砲塔射程 × 此值 ⇒ 機甲的攻塔手段:站在塔的射程外也打得到
  TRACK_R_F: 0.5,    // **終端追擊半徑** = 砲塔射程 × 此值(2026-08-05 使用者定案「砲塔射程的 1/2」)
  CLIMB_SPD: 70,     // **出膛速度**(m/s;沿 45° 發射向量,非垂直分速)—— 這一段是刻意留給敵方的攔截窗
  DIVE_F: 3.5,       // 俯衝速度 = 出膛速度 × 此值(「極音速」的唯一定義處)
  SPIN_RPS: 2.4,     // 螺旋落下的每秒圈數(伺服器位置與客戶端演出同吃一份 ⇒ 兩端同步)
  SPIRAL_R: 9,       // 螺旋半徑(公尺;繞著彈道軸的偏擺,實體尺寸不吃 COMBAT_SCALE)
  MODEL_F: 2.2,      // 彈體尺寸 = 集束轟炸機的幾倍(models.js 共用同一具彈體幾何放大;命中量體同吃 ⇒ 看到多大 = 打到多大)
  KAMI_EQ: 2.5,      // **戰鬥部傷害 = 幾架自爆無人機**(2026-08-06 使用者定案;見 hyperShare)
  BLAST_R: 26,       // 戰鬥部爆風半徑(公尺)。**同時是三招爆風的面積基準**(share = 1;見 specialBlastR)
  PEN: 12,           // 破甲值
  CD_S: 30,          // 獨立冷卻(三招同一段 CD)
  vs: { flesh: 1.2, armor: 1.5, air: 0.5, building: 1.6 },
};
/** 發射角(弧度;彈道唯一的自由參數) */
export const hyperLaunchRad = () => HYPER.LAUNCH_DEG * Math.PI / 180;
/** 最大接戰距離(公尺;無鎖定時的正前方落點距離,也是 HP 反解的最長一發) */
export const hyperRange = () => UNITS.tower.range * HYPER.RANGE_F;
/**
 * **戰鬥部佔一份機種絕招預算的比例**(2026-08-06 使用者定案「同等於 2.5 架自爆無人機的傷害」)。
 * 推導不手寫:一架自爆無人機 = 預算 / `KAMI.N` ⇒ 2.5 架份 = `KAMI_EQ / KAMI.N`。
 * 改 `KAMI.N` 時這個比例自己跟著走,使用者那句話恆成立(手寫 0.625 則會當場分家)。
 */
export const hyperShare = () => HYPER.KAMI_EQ / Math.max(1, SQUAD.KAMI.N);
/**
 * 水平距離 d 的一發,其**頂點高度**(公尺)= d·tan(θ)/2。
 * 預設取最遠射程 ⇒ `hyperApex()` = 這一招爬得最高的那一發(MUST > GAME.GUN_CEIL_M)。
 */
export const hyperApex = (d = hyperRange()) => d * Math.tan(hyperLaunchRad()) / 2;
/** 爬升段的**水平**分速(m/s)= 出膛速度的水平分量;爬升全程等速(拋物線只有垂直項在變) */
export const hyperClimbVx = () => HYPER.CLIMB_SPD * Math.cos(hyperLaunchRad());
/** 水平距離 d 的一發,爬到頂點要幾秒(= 水平走完 d ÷ 水平分速) */
export const hyperClimbS = (d) => Math.max(0, d) / hyperClimbVx();
/**
 * **拋物線的唯一縫**:水平進度 f ∈ [0,1](= 已走水平距離 ÷ d)時的離地高度(公尺)。
 * y = apex·f·(2 − f) —— 由「發射角 θ、頂點在 f = 1」反解;f = 0 處的切線斜率
 * dy/dx = 2·apex/d = tanθ ⇒ **出膛角恆為 LAUNCH_DEG**(這就是使用者要的「初始角度 45 度」)。
 * 伺服器彈道與任何演出/稽核 MUST 全吃這一支,MUST NOT 各寫一份多項式。
 */
export const hyperArcY = (d, f) => {
  const g = Math.max(0, Math.min(1, f));
  return hyperApex(d) * g * (2 - g);
};
/** 俯衝速度(m/s;推導不手寫) */
export const hyperDiveSpd = () => HYPER.CLIMB_SPD * HYPER.DIVE_F;
/**
 * **終端追擊半徑**(公尺;推導不手寫)= 砲塔射程 × TRACK_R_F。
 * 頂點(= 後 1/3 的起點)那一刻,目標離**發射瞬間的落點**超過它 ⇒ 放棄追擊、沿原軌跡打下去。
 * 消費端只有 `sim._tickHypers` 的那一次判定與 `tools/lanesim.mjs` 的同一條規則。
 */
export const hyperTrackR = () => UNITS.tower.range * HYPER.TRACK_R_F;
/**
 * 爬升段(拋物線)的**弧長**(公尺)。k = tanθ ⇒ ∫₀¹√(1+k²(1−v)²)·d dv
 *   = d·[√(1+k²)/2 + asinh(k)/(2k)] —— 閉式解,MUST NOT 改成數值積分或手寫係數。
 */
export const hyperClimbLen = (d = hyperRange()) => {
  const k = Math.tan(hyperLaunchRad());
  return d * (Math.sqrt(1 + k * k) / 2 + Math.asinh(k) / (2 * k));
};
/**
 * **「後 1/3」的推導證明**:俯衝段(原軌跡 = 自頂點垂直落下)佔整條航跡長度的比例。
 * 爬升弧長與頂點高都正比於交戰距離 d ⇒ **比例與 d 無關,只由發射角決定**;
 * θ = 45° ⇒ 0.303 ≈ 1/3,使用者那句「前 2/3 / 後 1/3」因此描述的正是既有的兩相位切換點。
 * 追擊判定掛在那個點上,MUST NOT 手寫 2/3 當作新的相位邊界(改 LAUNCH_DEG 這個比例會自己走,
 * 稽核 `audit_flight_power.mjs` Ⅱ 釘住它仍落在「1/3 帶」內)。
 */
export const hyperTerminalF = (d = hyperRange()) => {
  const dive = hyperApex(d);
  return dive / (hyperClimbLen(d) + dive);
};
/**
 * **最長**飛行時間(秒)= 最遠一發的彈道爬升 + 自頂點垂直落下;
 * HP 反解(hyperHp)吃它,MUST NOT 手寫。頂點在目標正上方 ⇒ 俯衝段就是頂點高本身。
 * **基準刻意取「原軌跡」而非追擊斜距**(2026-08-05):終端追擊最遠會再偏 hyperTrackR(),
 * 斜距 hypot(apex, trackR) 讓曝險窗長 2.8% ⇒ HP 881 → 905,而 bal ⑦f 實測那 2.7% 落在
 * 「這一發被打下來沒有」的門檻上,三招實得傷害比從 1.65× 跳到 **1.93×**(> 1.8× 出界:
 * 158 → 183 EHP/次)。追擊是「打得到人」的加分,MUST NOT 連生存性也一起加成;
 * 偏差方向因此朝「飛彈比較容易被攔下來」(原則 6),MUST NOT 改吃斜距。
 *
 * 2026-08-07(使用者定案「大招改為從最近的砲塔或主堡召喚」):最長的那一發自此**多了一段
 * 發射腿** —— 航程 = 代表發射腿 + 這一形式最遠的一次遞送距離(`hyperMaxArcM`)。飛彈全程在高空
 * 飛越整條前線(所以它吃的是 `overflyDps` 而不是只算塔位),那一段是**真的多挨打**;
 * 不跟著改的話 HP 就不再滿足「最長一發剛好打不爆」,而症狀只是「這一招好像被打下來的次數變多了」。
 * (另兩種形式刻意**不動**:它們的曝險窗量的是「進入敵方前線塔位射程 → 抵達」那一段,
 *  而發射點往自家後方退不會改變那一段的長度 —— 見 kamiExposureS / decoyExposureS 的檔頭。)
 */
export const hyperFlightS = (d = hyperRange()) =>
  hyperClimbS(d) + hyperApex(d) / hyperDiveSpd();
/** 極音速飛彈形式的**最長航程**(公尺)= 代表發射腿 + 最遠遞送距離(推導不手寫)。
 *  現役機甲 carrier 大招未標 range ⇒ heroAbility 補上的正是 `hyperRange()`(稽核釘住這個等式)。 */
export const hyperMaxArcM = () => ultLaunchLegM() + hyperRange();


// ---- 機種絕招傷害(2026-07-27 使用者需求;三招共用同一份傷害預算 = 唯一縫)----
// 三招 = 無人機「飽和攻擊」(護衛自殺機 / 主機自毀撞擊)、變形者「集束炸彈」、機甲「極音速飛彈」;
// 三者共用同一顆鍵(長按右鍵 / 觸控 ZR,見 game.js _fireHoldAbility)與同一段 30s CD,威力理應等值。
// 一次絕招的**總傷害預算** = BASE ×(1 + PER_LVL ×(綜合等級 − 1)),
//   綜合等級 = (輕武器階 + 重武器階) / 2 —— 絕招是機體整套武裝的爆發,兩條武器軌都算數,
//   故等級可為 x.5 的**分數階** ⇒ MUST NOT 丟進 tierVal(三階數組只吃整數階,分數會回傳 undefined)。
// 三招各自把同一份預算切給自己的投射數(2026-08-01 改制後):
//   飽和攻擊 = KAMI.N(4)架均分(主機自毀撞擊 = 一架機體吃整份);
//   集束炸彈 = 撞擊自爆 DECOY_IMPACT,其餘均分給 DECOY.BOMB_MAX(6)顆投彈;
//   極音速飛彈 = 單一戰鬥部,**只領 `hyperShare()`**(2026-08-06 使用者定案「同等於 2.5 架
//     自爆無人機的傷害」;見 HYPER 檔頭)—— 三招等值那條不變式因此只剩前兩招,而它換到的是
//     一個直徑等於砲塔射程 4/5 的爆風。**MUST NOT 把它悄悄調回整份**(那正是「一轟就爆」的成因)。
// DECOY_IMPACT 0.6 → 0.25(2026-08-01):新制的集束轟炸機 HP 是「一座砲塔火力下投得完 5+1 顆」
//   反解的 ⇒ 設計上它**預期會被打下來**(撞擊自爆多半兌現不了)。把預算重心從撞擊移到炸彈,
//   實得傷害才對得上另兩招;撞擊那份改為「活著撞到目標」的額外報酬。
// BASE 300、PER_LVL 0.45 ⇒ 綜合 Lv4 = ×2.35。**MUST NOT** 在 sim/game/HUD 另寫任一招的傷害常數。
export const SPECIAL = {
  BASE: 300,          // 綜合 Lv1 一次絕招的總傷害預算(三招同額)
  PER_LVL: 0.45,      // 每 +1 綜合等級的線性成長(綜合 Lv4 = ×2.35)
  DECOY_IMPACT: 0.25, // 集束炸彈:撞擊自爆佔預算的比例(其餘均分給投彈)
};
/** 輕/重武器綜合等級(= 兩軌平均,可為 x.5 分數階;缺值以 Lv1 計) */
export const specialTier = (abil) => ((abil?.light || 1) + (abil?.heavy || 1)) / 2;
/** 綜合等級成長倍率(線性) */
export const specialMul = (abil) => 1 + SPECIAL.PER_LVL * (specialTier(abil) - 1);
/** 一次機種絕招的總傷害預算 */
export const specialBudget = (abil) => SPECIAL.BASE * specialMul(abil);
// ---- 爆風半徑也是**預算**(2026-08-02 由 bal ⑦f 的長按攻擊量測定案)----
// 三招的傷害預算逐位元等值,但爆風半徑過去是各招各寫的常數 ⇒ 總覆蓋面積差到 3 倍
// (實測:飽和攻擊 4×r22 = 19.7k m²、集束炸彈 6×r14 + 1×r20 = 16.0k m²、極音速飛彈 1×r26 = 6.9k m²)。
// 「把同一份預算切成越多顆、總面積就越大」等於**切分本身可以憑空生出攻擊範圍** ——
// 這正是武器那邊已經立過的規矩(A35「攻擊範圍要計價」/ AOE_BUDGET)在絕招上的同一條:
//   **半徑 ∝ √(該彈頭分到的預算比例)** ⇒ 總覆蓋面積與切幾顆無關,單位面積的傷害密度相同。
// 基準 = 單一戰鬥部的 `HYPER.BLAST_R`(share = 1 ⇒ 逐位元不動)。
// MUST NOT 逐招手寫半徑(舊 `DECOY.R` / `DECOY.BOMB_BLAST_R` 已退場,MUST NOT 復辟);
// 改 `KAMI.N` / `BOMB_MAX` / `DECOY_IMPACT` 時半徑自己跟著收放,總面積恆定。
// **半徑與傷害在 2026-08-06 起是兩件事**:極音速飛彈的戰鬥部只領 `hyperShare()`(2.5 架自爆
//   無人機份),但爆風**仍取 share = 1 的基準** ⇒ 三招總覆蓋面積仍逐位元相同,差的只有火力。
//   MUST NOT 「順手」把它的半徑也乘上 `√hyperShare()`(那是使用者沒有要求的第二次削弱,
//   而且會讓這一招同時失去點殺與面壓制兩頭)。
export const specialBlastR = (share) => HYPER.BLAST_R * Math.sqrt(Math.max(0, share));
/** 飽和攻擊:單架護衛自殺機的爆風(N 架均分預算;半徑吃面積計價,破甲/vs 沿用重型炸彈規格) */
export const kamiBlast = (abil) => ({
  ...WEAPONS.bomb, dmg: Math.round(specialBudget(abil) / SQUAD.KAMI.N),
  r: specialBlastR(1 / SQUAD.KAMI.N),
});
/** 飽和攻擊:主機自毀撞擊引爆(單一機體 = 整份預算 ⇒ 半徑同基準) */
export const selfBoomBlast = (abil) => ({
  ...WEAPONS.bomb, dmg: Math.round(specialBudget(abil)), r: specialBlastR(1),
});
/** 集束炸彈:載具撞擊自爆的爆風 */
export const decoyBlast = (abil) => ({
  dmg: Math.round(specialBudget(abil) * SPECIAL.DECOY_IMPACT),
  r: specialBlastR(SPECIAL.DECOY_IMPACT), pen: DECOY.PEN, vs: DECOY.vs,
});
/** 集束炸彈:單顆投彈的爆風(預算的非撞擊部分均分 BOMB_MAX 顆) */
export const decoyBombBlast = (abil) => ({
  dmg: Math.round(specialBudget(abil) * (1 - SPECIAL.DECOY_IMPACT) / DECOY.BOMB_MAX),
  r: specialBlastR((1 - SPECIAL.DECOY_IMPACT) / DECOY.BOMB_MAX), pen: DECOY.BOMB_PEN, vs: DECOY.vs,
});
/**
 * 極音速飛彈:單一戰鬥部。傷害 = 預算 × `hyperShare()`(2026-08-06 使用者定案 = 2.5 架自爆無人機份,
 * 推導不手寫);**爆風半徑仍是 share = 1 的基準**(2026-08-06 使用者定案「範圍改回舊制」)
 * ⇒ 三招總覆蓋面積逐位元相同,只有火力不同。
 */
export const hyperBlast = (abil) => ({
  dmg: Math.round(specialBudget(abil) * hyperShare()), r: specialBlastR(1), pen: HYPER.PEN, vs: HYPER.vs,
});

// ---- 機種絕招「載具 HP」校準(2026-08-01 使用者定調;三招共用同一把尺 = 唯一縫)----
// 使用者把三招的生存性一律以「**一座砲塔**持續射擊」表述:
//   飽和攻擊  → 只有一座砲塔時可以成功自爆 2 架(4 架中被擊落 KAMI.SHOT_DOWN 架);
//   極音速飛彈 → 只有一座砲塔持續攻擊剛好**不會**被打爆;
//   集束炸彈  → 剛好投得出 5+1 顆(投完第 DROP_N 顆即被擊落,墜毀再補投 1 顆)。
// 三條全是「撐幾秒」⇒ 收成同一組推導:曝險秒數 × 一座砲塔的每秒傷害。MUST NOT 手寫任一個 HP。
// 三種載具一律 **armor 0 / 護盾 0**(見 sim 生成處):校準要精確,EHP 就不能隨主機角色/升級漂移。
// 砲塔無 wid ⇒ pen 0(見 sim 主迴圈的 `wd?.pen || 0`),故基準 DPS = dmg × rate,不吃 armorMul。
export const towerDps = () => UNITS.tower.dmg * UNITS.tower.rate;
/** 「一座砲塔連續射擊 sec 秒剛好打不爆」的 HP(打完至少剩 1 滴) */
export const towerSurviveHp = (sec) => Math.floor(towerDps() * Math.max(0, sec)) + 1;
/**
 * 「一座砲塔連續射擊 sec 秒剛好被打爆」的 HP。
 * **向下取整**(不是四捨五入):要保證「sec 秒內死得掉」,HP 就 MUST ≤ 這段時間的傷害量 ——
 * 進位那半滴會讓載具多活一瞬,剛好把最後一次擊落/最後一顆投彈推到窗外(整條校準差一)。
 */
export const towerKillHp = (sec) => Math.max(1, Math.floor(towerDps() * Math.max(0, sec)));
// ---- 校準基準 = **前線一組塔位**,不是一座孤塔(2026-08-02 由 bal ⑦ 的長按攻擊量測定案)----
// 使用者 2026-08-01 把三招的生存性都以「一座砲塔」表述,三個 HP 也照著反解;但前線塔位的
// 幾何從來就是**同塔位雙塔**(② 的塔距不變式 / ④ 的「單推同塔位雙塔」/ lanesim 的場景),
// 載具真正要穿越的火力是**兩座**。差這個 2 倍的後果在 bal ⑦f 量得清清楚楚(2026-08-02 實測,
// 有效傷害 = 打在敵方機體與砲塔上的部分,佔 Lv1 預算 300 的比例):
//   飽和攻擊 3.8%(需 2.46s approach,兩座塔下只撐 0.61s ⇒ 四架全在半路被打下來,
//                  半威力殉爆炸在空地上)/ 極音速飛彈 **0.0%**(需 4.14s,只撐 2.07s,
//                  而攔截 = 完全否定 ⇒ 這一招在有塔的前線**從未兌現過**)/ 集束炸彈 35.5%
//                  (它從 BOMB_R 90m 外就開始投,不必活到目標頭上 ⇒ 只有它幾乎不受影響)。
// 也就是說:舊基準不是「難度偏高」,而是讓兩招在正式對局的前線**結構性歸零**,
// 且歸零的方式完全看不出來(玩家只覺得「絕招好像沒什麼用」)。
// 修法**不動使用者定調的三句話**,只把尺換成前線真正的火力:
//   飽和攻擊 → 前線一組塔位剛好擊落 SHOT_DOWN 架;極音速飛彈 → 前線一組塔位剛好打不爆;
//   集束炸彈 → 前線一組塔位火力下剛好投得完 5+1 顆。
// 三招 MUST 共用這一把尺(只調其中一招 = 又一次把三招的相對強弱寫死成手感),
// 且 MUST 仍是推導:砲塔數值一動,三個 HP 自己跟著漂。
export const TOWER_SITE_N = 2;   // 一個塔位的砲塔數(左右各一,見 GAME.TOWER_SIDE_OFF / towerPairSepM)
/** 前線一組塔位的基準 DPS(校準三招載具生存性的唯一一把尺) */
export const frontDps = () => towerDps() * TOWER_SITE_N;
/** 「撐得住前線一組塔位 sec 秒」的 HP */
export const frontSurviveHp = (sec) => towerSurviveHp(sec * TOWER_SITE_N);
/** 「前線一組塔位 sec 秒內剛好打得爆」的 HP */
export const frontKillHp = (sec) => towerKillHp(sec * TOWER_SITE_N);
/**
 * 一波 NPC 的總火力(推導:編制 waveComp() × 各兵種 dmg × rate;MUST NOT 手寫)。
 * 只有「**飛越**整條前線」的載具要一起算它 —— 見 overflySurviveHp。
 */
export const waveDps = () => waveComp().reduce((s, k) => s + UNITS[k].dmg * UNITS[k].rate, 0);
/**
 * 「撐得住**飛越整條前線**(一組塔位 + 一波兵)sec 秒」的 HP。
 * 極音速飛彈專用:另兩招都在自家這一側交付(護衛機自機體衝出撲近敵、轟炸機自 BOMB_R 外投彈),
 * 只有飛彈的設計用途是「站在塔的射程外拆塔」(hyperRange > tower.range)⇒ 它的航路**必然**
 * 從敵方兵波頭上飛過去。拿只算塔的尺去反解,少算的正是它一定會挨的那一半火力
 * (2026-08-02 bal ⑦f 實測:只算塔位時有效傷害仍只有預算的 4.1% —— 因為攔截 = 完全否定,
 *  它沒有另兩招那種「被打下來還剩一半」的緩衝,差一點點就是差全部)。
 */
export const overflyDps = () => frontDps() + waveDps();
export const overflySurviveHp = (sec) => Math.floor(overflyDps() * Math.max(0, sec)) + 1;
/**
 * 飽和攻擊:單架護衛自殺機的 HP。
 * 曝險窗 = 從進入砲塔射程到撲上砲塔(以撲擊速度飛完 tower.range);塔位一次只打一架 ⇒
 * 要「剛好擊落 SHOT_DOWN 架」,每架就得剛好撐滿 曝險窗 / SHOT_DOWN 秒(基準 = 前線一組塔位)。
 * 其餘 N − SHOT_DOWN 架成功自爆(N=4、SHOT_DOWN=2 ⇒ 使用者要的「成功自爆 2 架」)。
 */
/**
 * 第 i 架護衛自殺機的橫向站位 s ∈ [−1, 1](均勻散開)——「衝出散開角 / 生成側偏移」兩個消費端的
 * **唯一縫**(2026-08-06 常駐外觀移除後,客戶端貼身站位那一個消費端一併退場)。
 * 改 KAMI.N 散開自己跟著走,MUST NOT 在任一端寫 `i === 0 ? -1 : 1`
 * (那是 N=2 時代的式子,N=4 會把三架全擠到右側)。
 */
export const kamiSide = (i) => {
  const n = Math.max(1, SQUAD.KAMI.N);
  return n === 1 ? 0 : (i - (n - 1) / 2) / ((n - 1) / 2);
};
/**
 * 2026-08-07(大招改從最近的砲塔/主堡發射)**刻意不動**:曝險窗量的是「進入前線塔位射程 →
 * 抵達」那一段,而它只由**落點**決定 —— 發射點往自家後方退,多出來的那一段飛在敵方塔位射程之外
 * (自家前線塔距敵方前線塔 = tower.range × TOWER_SEP_F > tower.range)⇒ 這把尺逐位元不變。
 * (極音速飛彈是具名例外:它全程在高空飛越整條前線,見 hyperFlightS。)
 */
export const kamiExposureS = () => UNITS.tower.range / (UNITS.drone.speed * SQUAD.KAMI.SPEED_MUL);
export const kamiHp = () => frontKillHp(kamiExposureS() / SQUAD.KAMI.SHOT_DOWN);

/**
 * 極音速飛彈:HP = 撐得住**最長**一次飛行(hyperFlightS:45° 拋射爬升 + 頂點垂直落下)的
 * **前線一組塔位**火力。取最長 ⇒ 任何交戰距離都「剛好不會被打爆」;再多一把槍(小兵/敵方機體/
 * 第二個塔位)就打得下來,而且攔截成功 = 完全否定(這是它的弱點)。
 */
export const hyperHp = () => overflySurviveHp(hyperFlightS(hyperMaxArcM()));
/**
 * 集束炸彈:載具 HP = 在**前線一組塔位**火力下撐到投完第 DROP_N 顆就被擊落
 * (墜毀補投第 DROP_N+1 顆 ⇒ 使用者要的「5+1」)。
 * 曝險窗 = 進入砲塔射程 → 進入投彈範圍 BOMB_R 的接近時間
 *        + 投出 DROP_N 顆所需的 (DROP_N−1) 個間隔
 *        + **半個間隔**:第 DROP_N 顆恰在窗末投出,要它「投得出去」窗就得再多撐一點;
 *          半個間隔既保證第 DROP_N 顆出得去,又保證撐不到第 DROP_N+1 顆(推導不手寫餘量)。
 */
export const decoyExposureS = () =>
  Math.max(0, UNITS.tower.range - DECOY.BOMB_R) / DECOY.SPEED
  + (DECOY.DROP_N - 0.5) * DECOY.BOMB_GAP;
export const decoyHp = () => frontKillHp(decoyExposureS());

// ---- 大招載具遞送(2026-08-06 使用者定案「長按招式取代部分機體的大招」)----
// 定案三條:①**區域/指向型大招全轉**載具形式(strike/emp/summon/團隊 heal/團隊 buff);
//   純自身型(自我強化/隱形/視野/自補)維持瞬發不變 —— 自身效果沒有「飛過去」的語意。
//   ②**合併為一招**:轉換角色的長按(與 E 鍵同縫 game._fireHoldAbility → _castAbility('ult'))
//   = 發射「該機種絕招形式」的載具送出大招效果;原純傷害機種絕招對這些角色**退場**
//   (sim.heroKamikaze/heroDecoy/heroHyper 各有 ultDelivered 守衛)。CD 收到 [30,60]s、
//   沿用大招 MP 與升級階梯。③**效果取代傷害**:攻擊型(strike)的傷害就是它的 payload;
//   補血/控場/強化型載具抵達只施放效果、不再附機種絕招爆風 —— 預算不雙重領,
//   「效果強大」的代價是**可被攔截**(載具是 sim 實體,擊落 = 該份否定,同極音速飛彈語意)。
// 形式沿用三機種既有載具(以原先長按招式的形式):無人機 = KAMI.N 架自殺攻擊機、
//   變形者 = 集束轟炸機逐顆投遞、機甲 = 極音速飛彈拋物線 —— 節奏因此天然分成
//   爆發型(單彈頭)/ 間斷型(轟炸機分批)/ 連擊型(四機魚貫),持續型 = 效果本身的 dur。
// **可分預算分批、不可分狀態單載**(ultParts):strike 彈著數 / heal 量 / summon 隻數可均分
//   ⇒ 依機種分批(擊落幾架就少幾份);emp/buff 是一段狀態時窗,分批會疊乘(mods 逐筆相乘)
//   ⇒ 恆單一載具、攔截 = 完全否定。
//
// ---- 2026-08-07 使用者定案(兩句話,兩件事)----
// ①「**小招也改為輔助機型模式,CD 時間 15~30s,從玩家身邊召喚**」
//    ⇒ 載具制自此涵蓋**兩個槽位**:32 名角色 × 小招/大招 = 64 招全部由載具遞送,
//      分類規則仍是同一支 `abilDelivered`(區域/指向型 = 點遞送、自身/personal 型 = 跟隨編隊)。
//      **MUST NOT 把小招一律做成跟隨編隊**:三把 emp 小招(s03/t08/m05)標的是 250m 外的一片區域,
//      改成貼著自己的編隊 = 效果圈當場搬回腳下 = 把那三招的身分刪掉(而且沒有任何錯誤訊息)。
//    CD 帶 [SK_CD_LO, SK_CD_HI] 的映射方式與大招那一輪**同一支** `abilCarrierCd`(嚴格保序)。
// ②「**大招改為從最近的砲塔或主堡召喚**」
//    ⇒ 兩個槽位自此只差**發射點**(`abilOrigin`):小招 = 主機身邊、大招 = 最近的我方砲塔/主堡。
//      這是整個改制的設計主軸:小招是隨身戰術(快 CD、就地生成、幾乎沒有前置),
//      大招是後方戰略資產(慢 CD、要飛過來、整段航程都可以被打下來)。
//      發射點只有 `abilOrigin` 一份,MUST NOT 在 sim / 模型 / 稽核任一端另寫 `slot === 'ult' ? …`。
export const ULT_CARRIER = {
  CD_LO: 30, CD_HI: 60,      // 大招 CD 帶(2026-08-06 使用者定案)
  SK_CD_LO: 15, SK_CD_HI: 30, // 小招 CD 帶(2026-08-07 使用者定案「CD時間15~30s」)
  // 最短飛行腿(公尺):使用者定案「需要飛行時間」——自身/團隊型招式瞄在腳邊時,遞送點仍
  // 推到面前這麼遠,保證每一發都有 ≥0.6s 的攔截窗(最慢載具 DECOY.SPEED 62m/s)。
  // 支援型效果半徑(r 200~300)遠大於此 ⇒ 施放者自己仍在效果圈內,涵蓋不受影響。
  // 2026-08-07 起這也是**小招的發射腿**(「從玩家身邊召喚」= 生成在主機身上,衝出這一段才就位)。
  MIN_LEG: 40,
};
/** 這一招由誰召喚(**發射點的唯一縫**;2026-08-07 使用者定案):
 *  'self' = 主機身邊(小招)/ 'fort' = 最近的我方砲塔或主堡(大招)。 */
export const abilOrigin = (slot) => (slot === 'ult' ? 'fort' : 'self');
/**
 * 大招載具的**代表發射腿**(公尺):施放者站在兵線接觸線上時,離自家前線塔位的距離
 * = 半個塔距(敵我前線塔間距 = tower.range × TOWER_SEP_F,見 invariant ②)。**推導不手寫**。
 * 真正飛的那一段是「當下最近的工事 → 主機」的實距(隨站位變);這一支只服務**校準**——
 * 輔助機隊的耐久(supportHp)要有一個與站位無關的窗長,否則同一招的 HP 會隨玩家站哪裡漂移。
 */
export const ultLaunchLegM = () => UNITS.tower.range * GAME.TOWER_SEP_F / 2;
/** 這一槽位的載具發射腿(公尺):小招 = 主機身邊衝出 MIN_LEG;大招 = 後方工事飛過來(代表值)。 */
export const abilLaunchLegM = (slot) =>
  (abilOrigin(slot) === 'fort' ? ultLaunchLegM() : ULT_CARRIER.MIN_LEG);
/**
 * 這名角色的這一招是不是**點遞送**(**推導判定,MUST NOT 手寫名冊**):
 * 區域/指向型 = strike/emp/summon + 團隊 heal/buff;其餘(自身/personal 型)= 跟隨編隊。
 *
 * `dash` 小招(5 台)因此也歸跟隨編隊,而它在 `_castEffect` 是**空分支**(位移本就客戶端權威)
 * ⇒ 那一架輔助機飛完投放腿就功成身退、什麼都不交付。這是**刻意不開例外**:
 * 「哪些招式不需要載具」一旦寫成名冊就會漂(而漂掉的症狀是「這一招怎麼不用等」),
 * 而多生一架短命的小機沒有任何結算後果 —— 它連伺服器狀態都不碰。
 */
export const abilDelivered = (ch, slot) => {
  const u = CHARACTERS[ch]?.[slot];
  if (!u) return false;
  return u.fx === 'strike' || u.fx === 'emp' || u.fx === 'summon'
    || ((u.fx === 'heal' || u.fx === 'buff') && u.target === 'team');
};
/** 大招的點遞送判定(既有縫;消費端沿用) */
export const ultDelivered = (ch) => abilDelivered(ch, 'ult');
/**
 * 這一招的 cd 要不要被壓進槽位 CD 帶。
 *   小招:**全部**(使用者定案「CD時間15~30s」對 32 台一視同仁);
 *   大招:只有點遞送那 23 台 —— 9 台自身型的 cd 同時是 `selfUltEq` 的分子(補償 ∝ cd),
 *         壓進去等於一個改動同時動兩個平衡面(2026-08-07 前一輪已定案,MUST NOT 順手併進來)。
 */
export const abilCdMapped = (ch, slot) => (slot === 'ult' ? ultDelivered(ch) : !!CHARACTERS[ch]?.[slot]);
/** 該槽位「會被映射的那一群」的原 cd 全距(逐階掃描;memo —— CHARACTERS 之後才叫得動) */
const _abilCdBand = {};
export const abilCdBand = (slot) => {
  if (_abilCdBand[slot]) return _abilCdBand[slot];
  let lo = Infinity, hi = -Infinity;
  for (const [id, c] of Object.entries(CHARACTERS)) {
    if (!abilCdMapped(id, slot)) continue;
    for (let lvl = 1; lvl <= 3; lvl++) {
      const cd = tierVal(c[slot].cd, lvl);
      if (cd < lo) lo = cd;
      if (cd > hi) hi = cd;
    }
  }
  _abilCdBand[slot] = { lo, hi };
  return _abilCdBand[slot];
};
/** 該槽位的目標 CD 帶 */
export const abilCdRange = (slot) => (slot === 'ult'
  ? { lo: ULT_CARRIER.CD_LO, hi: ULT_CARRIER.CD_HI }
  : { lo: ULT_CARRIER.SK_CD_LO, hi: ULT_CARRIER.SK_CD_HI });
/** 舊 cd → 載具制 cd:把該槽位的 cd 全距仿射映射進目標帶。
 *  **嚴格保序**(仿射斜率 > 0)⇒ 誰的招轉得快、改制後仍轉得快;MUST NOT 改成分段表。 */
export const abilCarrierCd = (slot, cd) => {
  const { lo, hi } = abilCdBand(slot);
  const band = abilCdRange(slot);
  const f = hi > lo ? (cd - lo) / (hi - lo) : 0.5;
  return band.lo + f * (band.hi - band.lo);
};
/** 大招的 CD 帶與映射(既有縫;消費端沿用) */
export const ultCdBand = () => abilCdBand('ult');
export const ultCarrierCd = (cd) => abilCarrierCd('ult', cd);
/** 該機種載具形式的分批數(kami 架數 / 轟炸機投彈數 / 飛彈單彈頭)——「形式即機種絕招」的唯一縫。
 *  點遞送(ultParts)與跟隨型輔助機隊(supportN)同吃這一份,MUST NOT 各寫一張機種表。 */
export const kindParts = (kind) =>
  kind === 'drone' ? SQUAD.KAMI.N : kind === 'morph' ? DECOY.BOMB_MAX : 1;
/** 載具遞送的分批數:可分預算(strike/heal/summon)依機種分批,不可分狀態(emp/buff)恆單載。 */
export const ultParts = (kind, fx) => {
  const divisible = fx === 'strike' || fx === 'heal' || fx === 'summon';
  return divisible ? kindParts(kind) : 1;
};

// ---- 自身強化型招式 = 跟隨玩家的輔助機隊(2026-08-07 使用者定案)----
// 2026-08-07 第二輪:這一段自此**兩個槽位共用**(小招也改為輔助機型模式)——
//   所有函式一律吃 `slot`(預設 'ult' = 既有呼叫端逐位元不變),分類仍走 `abilDelivered`。
//   兩個槽位只差**發射點**(`abilOrigin`)與**投放腿**(`abilLaunchLegM`):
//   小招從主機身邊衝出 MIN_LEG、大招從最近的我方砲塔/主堡飛過來(代表腿 = ultLaunchLegM)。
// 使用者兩句話:①「自身強化類的改成**跟隨玩家的輔助機型**進行提供加成」;
//   ②「**某些招式換成多個輔助機型,多機型的狀態可以疊加**」;
//   ③「持續型招式的輔助機型耐久會比瞬發型與間斷型高,**持續時間越久耐久也越高**」。
// 這一輪把最後 9 台(純自身型)也收進載具制:32 台大招自此**全部**經載具遞送,只差形式 ——
//   點遞送(`ultDelivered`,23 台:飛出去、抵達即引爆) vs 跟隨編隊(這一段,9 台:留在身邊供輸)。
// 效果因此不再是「按下去就一定拿到」:輔助機是 sim 實體(可鎖定、可擊落),被打掉幾架就少幾份加成。
//
// **疊加 = 加法不是相乘**(`supportF`):k 架在線 ⇒ 倍率 = 1 + (m − 1) × k/N。
//   逐架各推一筆 mods 會被 `_buffMul` **相乘**((1+(m−1)/N)^N ≠ m)⇒ 全員在線時的效果會比舊制高,
//   而且只在「剛好幾架活著」的瞬間對得上帳 —— 症狀是「這一招有時候特別強」,沒有任何錯誤訊息。
//   核心不變式:**N 架全在線 = 逐位元同舊制的效果值**(k = N ⇒ f = 1 ⇒ 1 + (m−1) = m)。
// **可疊加才分機**(`supportStackable`):二元狀態(匿蹤 / 免疫 / 免裝填)沒有「一半」可言 ⇒ 恆單機,
//   這就是使用者說的「**某些**招式換成多個」——名冊 MUST 由 ult 欄位推導,MUST NOT 手寫。
// **節奏三分**(`selfUltTempo`,同樣推導不手寫):
//   瞬發 burst  = 沒有時窗(s11 大修:一次交付完就結束)—— 服務窗就只有投放腿那 0.6 秒;
//   間斷 pulse  = 有時窗但**逐 tick 入帳**(s12 的 regen:補進去的血不會因為輔助機被打掉而吐回來)
//                 ⇒ 撐不到底仍有交付,只要求撐住 `PULSE_F` 那一段;
//   持續 sustain = 有時窗的**狀態**(傷害/減傷/匿蹤/射程…):撐不到底就是整段沒有 ⇒ 要求撐滿。
// **耐久推導不手寫**(`supportHp`):機隊在**前線一組塔位**的火力下**剛好**在服務窗結束時被清空
//   (同 kamiHp「塔位一次只打一架」的語意)⇒ 每架各撐 服務窗 ÷ 機數 秒。三招載具那把尺原封不動地
//   延伸到第四種形式:砲塔數值一改,四種載具的 HP 一起漂,MUST NOT 手寫任何一個。
//   使用者③兩條因此是**推導出來的結論**而不是另外加的規則:機隊總耐久 ≈ frontDps × 服務窗,
//   而服務窗 = 投放腿 + 節奏係數 × dur ⇒ 持續型 > 間斷型 > 瞬發型、且 dur 越大越硬。
export const ULT_SUPPORT = {
  SLOT_R: 7,      // 編隊半徑(公尺):輔助機環繞主機的站位圈(> 機體碰撞半徑,不擋自己的視線)
  SLOT_ALT: 4.5,  // 編隊離地高(公尺):高過步兵、低過屋頂 —— 打得到也看得到
  TURN_K: 4,      // 編隊收斂係數(1/s):越界就往站位點靠,MUST NOT 硬貼(硬貼 = 打不中的無敵護衛)
  // 間斷型要撐住的窗佔比。**這是設計旋鈕不是推導值**(同 AOE_BUDGET.W / SPEED_COMP.K):
  // 兩個端點 0(瞬發:沒有時窗)與 1(持續:狀態撐不到底就是整段沒有)都是**定義**,
  // 只有中間這一格要校準 —— 校準錨 = bal ⑦f 的自身型組 EHP 當量/次。
  // 語意:間斷型的每一份 tick 一落地就是永久入帳 ⇒ 撐半個窗 = 交付一半,而不是歸零。
  PULSE_F: 0.5,
};
/** 輔助機的飛行速度:與自殺攻擊機同一具小型載具(客戶端也共用 kami 那份縮小渲染)⇒ 同吃那一份速度。
 *  MUST NOT 另寫一個常數 —— 兩份速度會讓「投放腿要飛幾秒」與畫面上飛多快分家。 */
export const supportSpeed = () => UNITS.drone.speed * SQUAD.KAMI.SPEED_MUL;
/** 投放腿(秒)= 該槽位的發射腿 ÷ 飛行速度 ⇒ 每一次施放都有攔截窗(使用者 2026-08-06 定案
 *  「需要飛行時間」)。推導不手寫;大招那一段自 2026-08-07 起是**後方工事 → 主機**的代表距離。 */
export const supportLegS = (slot = 'ult') => abilLaunchLegM(slot) / supportSpeed();
/** 這一招的狀態可不可以「一半」(⇒ 可不可以拆成多架輔助機疊加)。
 *  純二元狀態(匿蹤 / 解除異常 / 免裝填)沒有半份可言 ⇒ 單機;有任何**純量**狀態即可疊加。 */
export const supportStackable = (ch, slot = 'ult') => {
  const a = CHARACTERS[ch]?.[slot];
  if (!a || abilDelivered(ch, slot)) return false;
  if (Object.keys(a.mul || {}).length) return true;
  if (tierVal(a.heal ?? 0, 1) > 0 || tierVal(a.regen ?? 0, 1) > 0) return true;
  const ad = a.add || {};
  return ad.f != null || ad.evade != null;
};
/** 這一招派幾架輔助機(可疊加者依機種分批,同 ultParts 那張機種表;不可疊加恆 1) */
export const supportN = (ch, slot = 'ult') => (supportStackable(ch, slot) ? kindParts(charKind(ch)) : 1);
/** k 架在線時的效果佔比(疊加是**加法**:倍率 = 1 + (m − 1) × f,f = k/N) */
export const supportF = (ch, live, slot = 'ult') => {
  const n = supportN(ch, slot);
  return n > 0 ? Math.max(0, Math.min(1, live / n)) : 0;
};
/** 自身強化型招式的節奏(burst / pulse / sustain);點遞送的那一群回 null。**推導不手寫**。 */
export const abilTempo = (ch, slot) => {
  const a = CHARACTERS[ch]?.[slot];
  if (!a || abilDelivered(ch, slot)) return null;
  if (!(tierVal(a.dur ?? 0, 1) > 0)) return 'burst';   // 沒有時窗 = 一次交付完
  if (tierVal(a.regen ?? 0, 1) > 0) return 'pulse';    // 逐 tick 入帳 = 間斷
  return 'sustain';                                     // 其餘 = 狀態時窗
};
/** 大招的節奏(既有縫;消費端沿用) */
export const selfUltTempo = (ch) => abilTempo(ch, 'ult');
/** 節奏 → 「要撐住效果時窗的多少」(0 / PULSE_F / 1;前後兩個是定義,中間那個是旋鈕) */
export const supportTempoF = (tempo) =>
  tempo === 'sustain' ? 1 : tempo === 'pulse' ? ULT_SUPPORT.PULSE_F : 0;
/** 輔助機隊的服務窗(秒)= 投放腿 + 節奏係數 × 效果時窗 —— 「這一招要機隊撐多久」。
 *  使用者③的兩條(持續 > 瞬發/間斷、dur 越久越硬)就住在這一行,其餘全是它的推論。 */
export const supportServiceS = (ch, lvl = 1, slot = 'ult') => {
  const a = CHARACTERS[ch]?.[slot], tempo = abilTempo(ch, slot);
  if (!a || !tempo) return 0;
  return supportLegS(slot) + supportTempoF(tempo) * tierVal(a.dur ?? 0, lvl);
};
/**
 * 單架輔助機的 HP。反解的是「在**前線一組塔位**的火力下,機隊剛好撐完服務窗」——
 * 但兩段窗的曝險方式不同,**MUST NOT 整段除以機數**:
 *   ・投放腿:N 架**同時**在飛 ⇒ 每一架都各自扛完整的一段(平行曝險,不共享);
 *   ・效果窗:敵人一次點名一架(同 kamiHp「塔位一次只打一架」)⇒ 這一段才由機隊分攤(÷ N)。
 * 整段除以機數的下場:瞬發型(dur = 0)的每架 HP = 投放腿 ÷ N —— s11 實測 **20 點**,
 * 一顆步槍子彈就打掉四分之一份治療,而它在正式對局裡永遠站在自家兵線上(2026-08-07 實測:
 * 稽核場景的機隊在第一個 tick 就被路過的小兵清掉 3 架)。「瞬發型耐久最低」不等於「見光即死」。
 * armor / 護盾恆 0(同三種點遞送載具):校準要精確,EHP 就 MUST NOT 隨主機角色或升級漂移。
 */
export const supportHp = (ch, lvl = 1, slot = 'ult') => {
  const a = CHARACTERS[ch]?.[slot], tempo = abilTempo(ch, slot), n = supportN(ch, slot);
  if (!a || !tempo || n <= 0) return 0;
  return frontKillHp(supportLegS(slot) + supportTempoF(tempo) * tierVal(a.dur ?? 0, lvl) / n);
};
/** 機隊總耐久(使用者③那句話量的就是這個量) */
export const supportFleetHp = (ch, lvl = 1, slot = 'ult') => supportHp(ch, lvl, slot) * supportN(ch, slot);
/** 整數預算(彈著數/召喚隻數)均分到 n 批的第 i 批份額(平衡分配,總和恆 = total)。
 *  sim 生成端與 lanesim/稽核共用 —— MUST NOT 各自 round(各寫一份會湊不回 total)。 */
export const ultPartN = (total, n, i) =>
  Math.round(total * (i + 1) / n) - Math.round(total * i / n);

// ---- 招式啟動手勢(2026-08-06 使用者定案「大招可透過狙擊模式長按右鍵、小招可透過一般模式長按右鍵」)----
// 長按右鍵/長按 R 自此**只做一件事** = 施放招式,由**當下模式**分流:一般 → 小招、狙擊 → 大招。
// `abilHoldSlot(aiming)` 是這條分流的**唯一縫**:客戶端手勢(game._fireHoldAbility)、觸控招式鈕、
// 說明文字與稽核同吃 —— MUST NOT 在任一輸入端另寫 `aiming ? 'ult' : 'skill'`(第二份就是
// 「某顆鈕在狙擊模式下放的是小招」這種只在特定狀態現形的分歧,而且沒有任何錯誤訊息)。
// 短按右鍵仍是切換模式(見 game._rmbUp),兩者以按住時長區分,互不衝突。
export const abilHoldSlot = (aiming) => (aiming ? 'ult' : 'skill');

// ---- 機種絕招退場 + 純自身型大招補償(2026-08-06 使用者定案「機種絕招移除,提高大招效果」)----
// 長按被招式佔走之後,純傷害的機種絕招(飽和攻擊 / 集束炸彈 / 極音速飛彈)**整組退場**:
// 三種載具只剩「大招遞送」這一個身分(ULT_CARRIER),`SPECIAL` 只剩下面這把**補償的尺**。
// 載具化的 23 台本來就把長按換成了大招(2026-08-06 前一輪),不受這一段影響;
// 剩下 9 台純自身型大招沒有載具可換 ⇒ 把被移除的那份預算折進大招本身。
// (2026-08-07:那 9 台改由**跟隨玩家的輔助機隊**供輸,見 ULT_SUPPORT —— 補償的**當量**不受影響
//  〔換的仍是被移除的機種絕招〕,但兌現率從此吃「幾架還活著」,校準錨仍是 bal ⑦f 的自身型組。)
//
// **當量 MUST 推導不手寫**(`selfUltEq`):機種絕招每 `SPECIAL_CD_S` 秒發一份,而在同一段時間裡
// 大招只放得出 `cd / SPECIAL_CD_S` 次 ⇒ 一次大招要帶回這麼多份,否則「移除」就是淨削弱。
// 手寫一個 2 倍係數的下場是:之後改任一角色的 `ult.cd` 或 `SPECIAL.BASE`,補償當場失準,
// 而畫面上只表現成「這幾台好像變弱了」,沒有任何錯誤訊息。
//
// 兌現形式**逐 fx 分派**(`selfUltBoost`),但一律走既有的 mods / heal 通道:
//   ①有傷害窗的 buff 型(s04/t04/t06/m01)⇒ 把當量攤進 `dur` 秒的 `mul.dmg` 增額
//     (Δ = 當量 ÷ (該角色重武器持續 DPS × dur);DPS 走 `weaponDps` 單一縫,MUST NOT 手抄彈匣週期);
//   ②自補型(s11)⇒ 治療量增額 = 當量本身(治療 X 點抵銷 X 點傷害,等價可推導);
//   ③匿蹤(m08)⇒ 收斂成**破隱後 `ALPHA_S` 秒**的傷害倍率(使用者定案「破隱一秒內傷害增加」)——
//     同一份預算換一個更短更硬的窗,倍率因此也是推導值,MUST NOT 手寫 3。
//   ④重新設計的三台(s12 復甦 / t02 超載 / m04 偵搜)⇒ 效果本身就是補償,不再另加乘數
//     (它們的數值是**設計值**,校準錨是 bal ⑤⑦,見各自 ult 欄位的註解)。
// 夾制(MUL_MAX / ALPHA_MAX)只是防呆上限:窗短或 DPS 低的角色不該因為除法而拿到荒謬倍率。
export const SPECIAL_CD_S = SQUAD.KAMI.CD_S;   // 三招同一段 CD(DECOY.CD_S / HYPER.CD_S 同值,稽核釘住)
export const SELF_ULT = {
  ALPHA_S: 1,       // 匿蹤破除後的爆發窗長度(秒;使用者定案「破隱一秒內」)
  MUL_MAX: 1.0,     // 傷害加成**增額**上限(疊在既有 mul.dmg 之上)
  ALPHA_MAX: 3,     // 破隱爆發窗的傷害倍率上限(= 使用者舉的「3 倍」;推導值多半頂到這裡)
  // **實得率**:`SPECIAL.BASE` 是**名目**預算(爆風總傷害),而機種絕招的**實得**(打在英雄與
  // 砲塔上、扣掉被攔截那幾份)只有其中一部分。補償要換的是「玩家真的少拿到多少」,拿名目去換
  // 就是**淨加強**:Lv1 一次大招會塞進 700 點額外傷害、8 秒窗算出來的增額直接頂到夾制上限,
  // 而那台角色本來的 mul.dmg 才 1.35。
  //
  // **自 2026-08-06 起這是凍結的歷史量測,MUST NOT 再宣稱它是當輪量出來的**:
  // 現值 0.35 取自機種絕招**退場前**最後一輪 bal ⑦f 的實測帶下緣(逐招 102~183 EHP/次 ÷ 名目
  // 300 = 0.34~0.61;偏差朝「補得保守」,原則 6)。退場之後那三招在模型裡**不存在**,而最接近
  // 的類比(帶 strike payload 的大招載具)差在**唯一支配這個數字的性質**上 —— 機種絕招自動追蹤
  // 目標,大招載具是「點遞送、不索敵不追擊」(同日使用者定案)⇒ 同一輪 ⑦f 實測它對機體+砲塔
  // 只有 **4.3 EHP/次**(名目 391 ⇒ 實得率 1.1%);清兵那一桶另有 142 EHP/次(全部/名目 37.4%,
  // 與本係數同量級 —— 但那一桶不決定勝負,見 lanesim 檔頭)。拿 1.1% 去重算會把這 9 台的大招
  // 折到近乎歸零,而那量到的是「載具打不中移動中的機體」,不是「機種絕招本來值多少」。
  // ⇒ 要調這個係數,**MUST 改看 bal ⑦f 的「自身型補償」那一行**(逐台 EHP/次)決定。
  REALIZED_F: 0.35,
  REVIVE_INV_S: 1.5,   // 原地復活後的無敵幀(站起來那一瞬不該被同一發爆風再收一次)
};
/** 一次純自身型大招要帶回的機種絕招預算(**實得**傷害當量)。
 *  載具化角色恆 0(長按已經換成大招,不重複補)。 */
export const selfUltEq = (ch, lvl, abil) => {
  const a = CHARACTERS[ch]?.ult;
  if (!a || ultDelivered(ch)) return 0;
  return specialBudget(abil) * SELF_ULT.REALIZED_F * tierVal(a.cd, lvl) / SPECIAL_CD_S;
};
/**
 * 純自身型大招的補償欄位(**單一縫**:伺服器 `_castEffect`、客戶端 HUD 與圖鑑同吃)。
 * 回傳 `{ dmgMul, heal, alphaX }` —— 全為「增額」語意,無補償時三欄皆為中性值
 * (dmgMul 0 / heal 0 / alphaX 1)⇒ 其餘 23 台逐位元不受影響。
 */
export const selfUltBoost = (ch, lvl, abil) => {
  const none = { dmgMul: 0, heal: 0, alphaX: 1 };
  const a = CHARACTERS[ch]?.ult;
  const eq = selfUltEq(ch, lvl, abil);
  if (!a || eq <= 0) return none;
  if (a.fx === 'stealth') {
    // 破隱窗:整份當量壓進 ALPHA_S 秒 ⇒ 倍率 = 1 + 當量 ÷ (窗內基礎輸出)
    const dps = selfUltDps(ch, abil);
    if (dps <= 0) return none;
    return { ...none, alphaX: Math.min(SELF_ULT.ALPHA_MAX, 1 + eq / (dps * SELF_ULT.ALPHA_S)) };
  }
  if (a.fx === 'heal') return { ...none, heal: eq };   // 治療 X 點 = 抵銷 X 點傷害
  if (a.fx === 'buff' && a.mul?.dmg) {
    const dur = tierVal(a.dur, lvl), dps = selfUltDps(ch, abil);
    if (!(dur > 0) || dps <= 0) return none;
    return { ...none, dmgMul: Math.min(SELF_ULT.MUL_MAX, eq / (dps * dur)) };
  }
  return none;   // 重新設計的三台(rally / overdrive / recon):效果本身即補償
};
/** 補償折算用的基準輸出:該角色**重武器**的持續 DPS(彈匣週期走 `weaponDps` 單一縫)。
 *  取重武器是因為大招開窗那幾秒玩家打的就是它;輕武器 DPS 低會把倍率推到夾制上限。 */
export const selfUltDps = (ch, abil) => {
  const w = heroWeapon(ch, 'heavy', abil?.heavy || 1);
  return w ? weaponDps(w) : 0;
};

export const VITALS = {
  OOC_S: 5,            // 脫戰秒數(這段時間沒受擊,護盾開始回復)
  SP_REGEN_PS: 0.20,   // 護盾每秒回復上限比例 = 「充能」滿級規格(實際回速 × chargeF(充能等級),Lv0 = 40%)
  AR_K: 120,           // 護甲減免曲線常數
  CRIT_X: 1.6,         // 預設爆擊倍率(未指定 critX 的基準;heroWeapon 仍以 CRITX_MIN 夾下限)
  // ---- 暴擊下限 + 升級成長(2026-07-25 使用者需求:所有(英雄)武器 crit ≥5% / critX ≥2.0)----
  // 「根據武器類型和升級程度個別調整」:各武器原 crit/critX 保留為**類型基準**(狙擊高、機槍低),
  // 於 heroWeapon() 夾下限後再依階級線性成長 —— 單一縫,MUST NOT 逐武器手寫第 4 階或改 32 角資料。
  // 爆擊仍只作用於直擊武器(heroHit/heroLance _rollCrit);AoE(爆炸/扇形)與招式不爆(見 §req4)。
  CRIT_MIN: 0.05,      // 暴擊率下限
  CRITX_MIN: 2.0,      // 暴擊倍率下限(= 暴擊傷害 +100%)
  CRIT_PER_LVL: 0.01,  // 每升一階暴擊率成長
  CRITX_PER_LVL: 0.05, // 每升一階暴擊倍率成長
};
// G:彈道重力(真實值;武器 mv = 初速 m/s)。LAUNCH_MV:榴彈/火箭(launcher)拋物線武器的初速上限 ——
// 真實 mv(650~700)幾乎打平,降到此值讓拋物線軌跡明顯(2026-07-22 使用者需求;純客戶端視覺,伺服器不模擬彈道)。
// 對空彈射模式(2026-07-23 使用者需求):launcher **準星底下**是飛行類目標
// (TARGET_CLASS 'air':無人機/直升機/集束轟炸機/護衛機/極音速飛彈)即改用高初速 AA_MV —— 拋物線吊射打不到會動的飛行單位,
// 高速平直彈道才有火控意義(射程/傷害不變,只換初速 ⇒ 純客戶端彈道,伺服器仍只驗落點)。
// AA_MV 720(原 340;使用者「再更快更直」):實際初速取 min(武器真實 mv, AA_MV) ——
// 彈射模式 = **全裝藥直射**,砲彈跑該武器的真實初速(152mm 650 / 無後座砲 435 / 集束彈 400),
// 只有真實初速本就慢的溫壓火箭(120)維持慢速。MUST NOT 改成無視 mv 的固定值(超過真實初速)。
// AA_ALT:他人視覺彈體(_spawnVisShell)無法得知對方準星,改以「落點離地高度」推定對空射擊。
// 舊 AA_CONE(8° 準星錐的瞄準輔助)2026-08-10 隨 `game._aaTarget` 一併退場:使用者定案
// 「拋物線準星沒有瞄敵人時就是打地面」—— 錐形輔助是唯一能把落點從準星底下拉走的路徑。MUST NOT 復辟。
// ---- 榴彈火控解(2026-07-23 使用者需求:彈道要隨距離與仰角改變,遵守真實彈道學)----
// 拋物線武器(trajClass 'lob')不再沿準星直射:game.js `_lobAim()` 解「以 LAUNCH_MV 命中準星落點」
// 的拋射角(低伸解;被地形/障礙擋住才換高角度解 = 真實榴彈砲的高角度越頂射擊)⇒ 出膛仰角、
// 弧高、飛行時間全隨目標距離/高差自然改變,而不是一條固定曲線。
// LOB_TOL:積分落點與瞄準點的容差(公尺)—— 超過即「拋物線未對準」:落點環轉警示色、
//   鎖定光暈不亮(使用者規則「射程光暈要在拋物線對準時才亮」)。
// LOB_SUP_MAX:FPV 砲管跟著抬的超高仰角上限(rad,≈51°)—— 只夾視覺,不夾彈道解。
// LOB_CHARGE:裝藥號數(相對全裝藥的初速比)。低伸解被稜線/建物擋住就降一號 —— 初速降低 ⇒
//   命中同一點所需仰角自動抬高、弧線變高,這是真實榴彈砲越過遮蔽物的作法(不是另發明一套曲射)。
//   MUST NOT 改用「高角度解」(同初速的另一個根):現尺度下那是 85° 迫砲彈,飛行 20 秒沒有戰術意義。
// LOB_MIN_F:榴彈類(trajClass 'lob')最小安全射程 = 爆風半徑 × 此係數(2026-07-27 使用者需求)。
//   落點近於此距離 ⇒ 射手落在自身爆風內:改為「無差別」波及(不分敵我 + 自身)並自損。
//   **推導不手寫**:min 射程隨各武器爆風半徑走(見 lobMinRange),此處只放單一係數。
//   1.5 = 邊界(落點 = 1.5r)自損約 33% 爆風傷、越近越高;導引/射後不理武器不吃(已有 ARMING 散布)。
export const BALLISTIC = {
  G: 9.81, LAUNCH_MV: 100, AA_MV: 720, AA_ALT: 10,
  MV_FALLBACK: 600,   // 武器未標砲口初速時的預設(舊制寫死在 game._shotV0)
  LOB_TOL: 3.5, LOB_SUP_MAX: 0.70, LOB_CHARGE: [1, 0.78, 0.6, 0.46], LOB_MIN_F: 1.5,
};
/**
 * 出膛初速(m/s)。**唯一縫**:客戶端 `game._shotV0`(彈道積分/火控/瞄準虛線)與
 * `flightCapS`(伺服器把著彈時刻換算回擊發時刻)同吃 —— 兩邊各寫一份夾制的下場是
 * 拋射武器的飛行時間被算成 `def.mv`(砲口初速 640m/s)而不是實際的吊射初速(100m/s),
 * 差 6 倍 ⇒ 換算回來的擊發時刻整個失準。
 * 拋射武器(launcher)不是照砲口初速直射的:一律夾到吊射 LAUNCH_MV(對空彈射模式 AA_MV);
 * 其餘型別(飛彈/動能/光束)就是自己的砲口初速。
 */
export const shotV0 = (def, aa = false) => {
  const v0 = def?.mv || BALLISTIC.MV_FALLBACK;
  return def?.type === 'launcher' ? Math.min(v0, aa ? BALLISTIC.AA_MV : BALLISTIC.LAUNCH_MV) : v0;
};
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
// ---- 槍口係數 FAN_MUZZLE(2026-07-27;對進戰模型 `npm run bal` ⑤ 校出來的結構性短少)----
// 舊式曲線由 1.0 起跌 ⇒ 扇形武器**在任何距離都不到滿額**,而其他武器在 PLATEAU(35% 射程)內是滿額的;
// 武器基準 dmg 卻是照滿額訂的(bal ① 不套衰減) ⇒ 六把扇形武器的使用者實戰輸出普遍短少四~五成
// (改制前 6 名扇形使用者的對進戰平均勝率 27.4%,雙扇形的 t03 / s04 更只有 5.5% / 3.0% —— 形同廢角)。
// 修法**不動使用者指定的曲線形狀**(仍是無平台的斜線、越近越高),只把斜線抬到
// 「在別人的近距平台邊界 FALLOFF.PLATEAU 上恰好等於滿額」⇒ 比那更近才高於滿額、更遠仍照舊衰減。
// **推導不手寫**:改 FALLOFF.PLATEAU 此值自動跟著走。
// FAN_FLOOR 同時 0.25 → 0.45:扇形武器的**實用交戰帶整段落在射程末端**(交戰距離由雙方輕武器
// 射程決定,而扇形射程本來就短)⇒ 舊保底等於「長期以 25% 傷害作戰」。連帶 bal ④ 最差站外拆塔
// (s07 防空散射矩陣)787s → 437s。
export const FAN_FLOOR = 0.45;
export const FAN_MUZZLE = 1 / (1 - FALLOFF.PLATEAU);
export function fanFalloff(range, d) {
  if (!range) return 1;
  return Math.max(FAN_FLOOR, FAN_MUZZLE * (1 - d / range));
}
// 爆風超壓帶(唯一縫):CORE 倍半徑內全傷、EDGE 倍半徑外歸零、之間依 EXP 次方連續遞減。
// 曲線本身不變(舊式硬寫 0.5 / 1.8 / 1.3 / 0.75,其中 1.3 = 1.8 − 0.5 是**推導值**),
// 收成具名常數是因為「打得到嗎」的判定要取用核心帶(見 blastCoreR):兩處各寫一份魔數 = 分家。
export const BLAST = { CORE: 0.5, EDGE: 1.8, EXP: 0.75 };
/** 爆風核心半徑(公尺):落點落在目標的此半徑內 = 目標吃滿額爆風。射程光暈的「打得到」判據取此值。 */
export const blastCoreR = (def) => (def?.r || 0) * BLAST.CORE;
/** 爆風超壓衰減:核心(≤CORE·r)全傷,外圍隨距離急降、EDGE·r 歸零(取代舊二段式 1/0.4) */
export function blastFalloff(r, d) {
  if (d <= r * BLAST.CORE) return 1;
  if (d >= r * BLAST.EDGE) return 0;
  return ((r * BLAST.EDGE - d) / (r * (BLAST.EDGE - BLAST.CORE))) ** BLAST.EXP;
}

// ---- 偏心傷害遞減(2026-07-29 使用者需求「所有武器範圍攻擊都有偏心傷害遞減」)----
// 三類範圍攻擊(aoeClass)全數「命中量體中心滿額、偏離中心遞減」:
//   blast:既有 blastFalloff(核心 ≤0.5r 全傷 → 1.8r 歸零)本身就是偏心遞減,不另設第二條曲線。
//   fan  :frac = 水平夾角偏離錐軸的比例(0 = 正對錐軸,1 = 錐緣)→ sim.heroPlasma。
//   line :frac = 垂距偏離圓柱軸的比例(0 = 正中,1 = 貼在 R + hitR(t) 邊緣)→ sim.heroLance/_lanceHits。
// fan/line 共用同一條線性曲線,邊緣保底 AOE_EDGE。**正中滿額** ⇒ 對進戰模型(tools/duel.mjs)與
// bal 不變式全數模型化「瞄準正中」的 1v1,天然不動;遞減只作用在錐緣/柱緣「順帶掃到」的偏心目標。
// sim 結算與客戶端 HUD 估算(_lanceFeedback)MUST 共用本縫(§2.1,兩端分家 = 數字對不上)。
export const AOE_EDGE = 0.5;
/** 偏心倍率:frac = 偏離量 / 半寬(夾 [0,1]);正中 1.0,線性遞減到邊緣 AOE_EDGE */
export function offAxisFalloff(frac) {
  return 1 - (1 - AOE_EDGE) * Math.max(0, Math.min(1, frac));
}

// ---- 扇形錐的半角(2026-08-03 使用者回報「部分武器打得到一般單位、但不到建築」)----
// 錐內判定 MUST 量到目標**命中量體的近側表面**,不是量中心 —— 與 `_surfD3`(射程)、
// `_lanceHits` 的 `R + hitR(t)`(貫穿)、`_blast` 的 `dh − hitR`(爆風)同一條規則,
// 扇形是最後一個還在量中心的縫。半徑 7m 的砲塔 / 20m 的主堡貼著臉噴,整個錐子都打在牆上,
// 而**中心**還在 30~70° 之外 ⇒ 舊制一發都不掉血,而同一處的小兵照樣被噴死。
// 三個消費端 MUST 全吃這一支:伺服器 `sim.heroPlasma`(結算)、客戶端 `_shotVictims`
// (範圍光暈名冊)、前線交戰模型 `tools/lanesim.mjs`(bal ⑦ 的攻擊範圍計價)。
/** 錐的標稱半角(rad):偏心遞減 `offAxisFalloff` 的分母(量體不放大傷害,只放大「打不打得到」) */
export const fanArcHalf = (def) => (def?.arc || 15) * Math.PI / 180;
/** 對「距離 d、水平量體 hr」的這個目標,錐的有效半角(rad)= 標稱半角 + 量體張角 */
export const fanConeHalf = (def, d, hr) => fanArcHalf(def) + Math.atan2(Math.max(0, hr || 0), Math.max(1, d));

// ================= 重武器範圍攻擊三分類 + 彈道五分類(2026-07-23 使用者定案)=================
// 使用者規則:「重武器必屬於其中一種範圍攻擊」—— 沒有單體直擊的重武器。
//   blast 爆炸傷害:球形超壓(launcher 榴彈/火箭、missile 飛彈)→ sim._blast + blastFalloff
//   fan   扇形傷害:越近越強、無貫穿(plasma 離子、fan:true 霰彈)→ sim.heroPlasma + fanFalloff
//   line  直線傷害:沿射線的圓柱貫穿(beam 光束、rail 電磁彈射、gun 反器材砲)→ sim.heroLance
// **唯一分類縫 = aoeClass(def)**;sim / game.js / HUD 一律經此判定,MUST NOT 各自比對 def.type
// (第二份 type 比對 = 三分類分家)。輕武器(非扇形)不屬任何一類 —— 仍是單體直擊 heroHit,
// 本規則只約束重武器(def.id === 'heavy')。
/** 重武器範圍攻擊類別:'blast' | 'fan' | 'line';非扇形輕武器回傳 null(單體直擊) */
export function aoeClass(def) {
  if (!def) return null;
  if (def.fan || def.type === 'plasma') return 'fan';            // 扇形(散彈輕武器亦然)
  if (def.id !== 'heavy') return null;                            // 非扇形輕武器 = 單體直擊
  if (def.type === 'launcher' || def.type === 'missile') return 'blast';
  return 'line';                                                  // beam / rail / gun(反器材砲)
}
export const AOE_NAME = { blast: '爆炸傷害', fan: '扇形傷害', line: '直線貫穿' };

// ---- 直線貫穿(line)參數 ----
// R:圓柱半徑(公尺,實體尺寸 ⇒ 與 AoE 半徑同樣不吃 COMBAT_SCALE)。光束最粗(定向能發散)、
//   電磁彈射次之、反器材砲最細(單顆穿甲彈的破壞管道)。
//   2026-07-28 使用者需求「擴大圓柱形的傷害判定範圍」:整組 ×1.5(3.6/2.8/2.2 → 5.4/4.2/3.3),
//   機種間的粗細階梯(beam > rail > gun)維持不變。**演出跟著走**:_lanceVisual 一律取 lanceR(def)
//   ⇒ 看到多粗就是打到多粗(A18 / 「動畫範圍須一致」)。**判定半徑 = R + 目標自身水平量體 hitR(t)**
//   (見 sim._lanceHits)—— 純點判定連 7m 半徑的砲塔都打不中。
//   平衡不動:bal 四不變式只模型化 1v1,首個目標恆為全額 ⇒ 加粗只改「順路掃到幾個」。
// DECAY:每貫穿一名目標,後續目標傷害 ×此值。**首個目標恆為全額** ⇒ 單體 DPS 與舊 heroHit 相同,
//   npm run bal 的四不變式(全部只模型化 1v1)不受影響 —— MUST NOT 改成首發也衰減。
// MAX:單發最多貫穿目標數(防一條線掃穿整條兵線)。
// 2026-08-01:舊 BARRAGE_F(重砲傾洩窗加粗)隨巨砲一併移除 —— 貫穿粗細不再有任何情境倍率,
//   `lanceR(def)` 是**唯一**半徑來源。演出端 MUST NOT 自己乘任何倍率(A18「看到多粗就是打到多粗」)。
export const LANCE = {
  R: { beam: 5.4, rail: 4.2, gun: 3.3 },
  DECAY: 0.75,
  MAX: 6,
  VBAND_F: 2.2,     // 垂直帶寬容 = R × 此值(伺服器無地形高程,射線高度只能近似 —— 見 sim.heroLance)
};
/** 貫穿圓柱半徑(公尺);判定與演出共用同一支 */
export const lanceR = (def) => LANCE.R[def?.type] ?? LANCE.R.gun;

// ---- 彈道五分類(2026-07-23 使用者定案)----
//   lob   低初速拋物線:榴彈/火箭吊射(BALLISTIC.LAUNCH_MV;對空時換 AA_MV 見 _updateAaMode)
//   flat  高初速近似直線:動能彈(gun/rail,mv 900~2500)—— 本質仍是拋物線,只是彈道極平
//   line  完全直線:光速/準光速直擊(beam 光束、plasma 離子)—— 無重力下墜
//   guide 雷射導引:launcher + guide:1,FPV 有導引雷射指向準星目標,彈體騎波修正
//   fnf   射後不理:missile,離架後自行追蹤發射瞬間的鎖定目標
// **唯一分類縫 = trajClass(def)**(與 aoeClass 同框,MUST NOT 在別處重寫 type 判斷)。
export function trajClass(def) {
  if (!def) return null;
  if (def.type === 'beam' || def.type === 'plasma' || def.fan) return 'line';
  if (def.type === 'missile') return 'fnf';
  if (def.guide) return 'guide';
  if (def.type === 'launcher') return 'lob';
  return 'flat';
}
export const TRAJ_NAME = {
  lob: '低初速拋物線', flat: '高初速近似直線', line: '完全直線',
  guide: '雷射導引', fnf: '射後不理',
};
// ---- 導引/射後不理武器的「最短距離」(軌跡修正期)----
// 使用者規則:「後兩者會有最短距離,最短距離內還在軌跡修正期,命中率較低」。
// 離架後 m 公尺內:導引/追蹤尚未接手(引信未解保險 / 導引頭未鎖定),彈體帶初期散布 spread
// (弧度,離架瞬間一次性隨機偏角)⇒ 貼臉開導引彈會打歪,拉開距離才發揮。
// 伺服器不模擬彈道 ⇒ 此為**純客戶端**規則(與 RECOIL / BALLISTIC 同層;伺服器仍只驗落點)。
// m 為遊戲公尺(已是 COMBAT_SCALE 後的尺度,與 def.range 同單位)。
export const ARMING = {
  guide: { m: 45, spread: 0.055 },   // 雷射導引:騎波修正需要一段飛行距離
  fnf:   { m: 60, spread: 0.075 },   // 射後不理:發射後才鎖定 + 引信解保險
};
export const armingOf = (def) => ARMING[trajClass(def)] || null;

// ---- 導引頭的機動上限(2026-07-30 使用者回報「導引/射後不理常常光暈亮著卻沒命中」)----
// 舊制在 `game._updateBullets` 手寫「每秒最大轉角」(追蹤 3.2 / 騎波 2.2 rad/s)。固定**角速度**
// 的毛病是實際能不能修正航向看的是**轉彎半徑** = 初速 ÷ 角速度:初速 1000m/s 的微型攔截彈
// 半徑 312m,比它自己的射程(194m)還大 —— 離架散布(ARMING.spread)注入的橫向偏差在整個射程
// 內都拉不回來,實測導引狀態下滿射程恆差 5m 以上(> 爆風核心帶),光暈亮著卻永遠打不中。
// 改成「角速度 **與** 轉彎半徑雙上限」:`max(基礎角速度, 初速 ÷ R_M)`。慢彈(初速 ≤ R_M × 基礎
// 角速度)半徑本就遠小於 R_M ⇒ 逐位元維持舊值、手感零回歸;只有快到轉不過來的導引頭才被拉高。
// **只放寬不收緊**是刻意的(MUST NOT 改成單純的 `初速 ÷ R_M`,那會讓慢速巡飛彈反而變鈍)。
// R_M 由掃描定案:「能讓全部 8 把導引/射後不理武器在 35%~100% 射程全數落進**爆風核心帶**」的
// **最寬**值(取最寬 = 對既有手感的擾動最小);判定縫 = `audit_weapon_gate.mjs` Ⅵ⑥。
// **這個值綁著爆風核心帶的大小**:2026-08-02「一發不得同時吃到兩座塔」把爆炸型半徑整批收到
// `soloBlastRmax()` 以下,核心帶 6.0m → 1.5m ⇒ 舊值 200m 的導引頭在 50% 射程整整差 4 把武器
// 打不進核心帶(s06/t10/m01/m05)= 光暈亮著卻沒命中(A30 家族)。重掃後定案 60m
// (70m 仍有 2 把回歸)。**改任何爆炸型武器的 r、AREA_WEAPONS 名冊或 soloBlastRmax MUST 重掃 R_M**。
// 伺服器不模擬彈道,bal/duel 不受影響。
export const SEEK = { HOME_W: 3.2, RIDE_W: 2.2, R_M: 60, CHASE_F: 3 };   // CHASE_F:射後不理鎖定後的追擊燃料 = 滿射程飛行時間 × 此值(見 chaseCapS)
/** 導引頭每秒最大轉角(rad/s):基礎角速度與「轉彎半徑不超過 R_M」兩個上限取寬者 */
export const seekTurn = (w, v0) => Math.max(w, (v0 || 0) / SEEK.R_M);

// ---- 榴彈類最小安全射程(2026-07-27 使用者需求;伺服器與客戶端 HUD 共用同一縫)----
// 只約束 trajClass 'lob'(launcher 無導引:溫壓火箭 / 152 榴彈砲 / 無後座砲 / 集束子母彈)——
// 這正是「榴彈類」。導引/射後不理是自導武器(已有 ARMING 軌跡修正期散布),不在此列。
// 落點與射手的距離 < lobMinRange(def) ⇒ 伺服器 _blast 改「無差別」(不分敵我 + 波及自身),
// 自損量由既有 blastFalloff(def.r, 距離)自然導出(越貼近爆心自損越重);≥ 此距離則照常只傷敵。
// **推導不手寫**:= 爆風半徑 def.r × BALLISTIC.LOB_MIN_F(改係數自動跟著走);非 lob 回 0。
export const lobMinRange = (def) => (def && trajClass(def) === 'lob' ? (def.r || 0) * BALLISTIC.LOB_MIN_F : 0);

// ---- 彈頭飛行時間(2026-07-30 使用者回報「導引/射後不理常常光暈亮著卻沒命中」)----
// AoE 彈頭是**著彈**才回報(`sim.heroBurst`),而「擊發資格」(需瞄準 / 裝填 / 射速)是**擊發
// 當下**才成立的狀態 —— 兩者之間隔著整段飛行時間。巡飛彈初速只有 90~100m/s,滿射程要飛 2~3.3
// 秒:那一發合法離架之後,玩家右鍵退出狙擊模式、或彈夾在飛行途中打空進入裝填,伺服器就把已經
// 在天上的彈頭「驗證後靜默丟棄」(A30 靜默丟包家族)。凡是拿**著彈時刻**去驗擊發資格的閘門,
// MUST 用本支把時間軸換算回擊發時刻,MUST NOT 手寫秒數、MUST NOT 自己拿 `shotV0` 除一次。
/**
 * 一發彈頭從**擊發**到**著彈**的飛行時間(秒)。d = 水平距離、dy = 落點相對槍口的高差
 * (往下打為負)。**唯一縫**:`heroBurst` 的擊發時刻回推(back)與 `flightCapS`(寬容窗
 * 上限)同吃。
 *
 * 拋物線(`trajClass` 'lob')自 2026-08-02「對地 45° 拋投」起**初速是反解出來的**
 * (`game._lob45Vel`):v0 = √(g·d²/(d−dy))、45° 的水平分量 = v0/√2
 *   ⇒ T = √2·d / v0 = √(2(d−dy)/g)
 * —— 與 `shotV0`(全裝藥砲口速度)無關,那個值現在只是 45° 解的**上限**(超過就無解退回
 * 裝藥階梯)。舊制拿 `d / shotV0` 當拋射的飛行時間,在現行射程下低估 2.2 倍
 * (172.8m:真實 5.94s vs 舊估 1.73s)⇒ ①收鏡後著彈的榴彈整發被丟、②伺服器的裝填窗比
 * 客戶端晚 4 秒,下一輪只要打得比上一輪近就整輪靜默丟棄(2026-08-03 使用者回報
 * 「榴彈投擲只有遊戲一開始有傷害」)。
 * 其餘彈道(直射 / 導引 / 射後不理)維持等速直線近似,量 3D 斜距。
 */
export const shotFlightS = (def, d, dy = 0) => {
  const h = Math.max(0, d || 0), v = dy || 0;
  return def && trajClass(def) === 'lob'
    ? Math.sqrt(2 * Math.max(0, h - v) / BALLISTIC.G)
    : Math.hypot(h, v) / shotV0(def);
};
// **推導不手寫**:= 在「落點閘門上界」打出去的那一發要飛多久 —— 距離取 impCap 的三個因子
// (range × altRangeMax × RANGE_TOL),高差取伺服器唯一認得的機制上限 `altDhMax()`
// (拿不到目標實體就取封頂當誠實界,與 `altRangeMax` 同一個理由;俯射的拋物線飛得更久,
// 偏差方向一律朝「不擋」= 原則 6)。改射程 / 初速 / 容差 / 彈道類型都自動跟著走。
export const flightCapS = (def) =>
  (def ? shotFlightS(def, def.range * altRangeMax() * RANGE_TOL, -altDhMax()) : 0);

// ---- 射後不理的追擊燃料(2026-08-01 使用者定案)----
// 規則:**鎖定之後持續追擊,不受射程影響 —— 但只能在射程內鎖定**。
// 「能不能鎖定」吃射程(客戶端 `_tickLock` 的 `_effRange` 閘門 + 伺服器 `heroLock` 複驗射程/
// 迷霧/LOS);一旦鎖上,彈頭就一路追到底,射程對彈道**不再有任何約束**(A7 的失鎖規則因此
// 只留給雷射導引與已經失去目標的彈體,見該條)。
// 燃料上限存在的唯一理由是「不讓失控彈體永遠留在場上」,MUST NOT 拿它當射程的替身:
// **推導不手寫** = 滿射程飛行時間 × CHASE_F —— 追擊距離因此恆遠大於任何機體在同一段時間內
// 跑得掉的位移(最快機體 ≈ 20m/s vs 彈頭 90~1000m/s),實務上等同「不受射程影響」。
export const chaseCapS = (def) => flightCapS(def) * SEEK.CHASE_F;

// ---- 擊發位置軌跡的保留窗(2026-08-05 使用者定案)----
// 使用者:「射程半球的計算應該要是由彈藥擊發的那個位置計算,後續機體的移動不影響」。
// 客戶端一向如此(`b.origin = muzzle.clone()`,球心在擊發那一刻就烤死);少掉的那一半在
// 伺服器:AoE 彈頭是**著彈**才回報(`heroBurst`),而落點閘門量的是機體的**當下**位置 ——
// 拋物線榴彈滿射程要飛近 6 秒,那 6 秒裡球心跟著機體跑。⇒ 伺服器必須記得機體走過的路,
// 才回推得出「這一發是從哪裡打出去的」。
// 保留窗 **推導不手寫** = 全體武器裡最長的那個「著彈 → 擊發」回推窗(與 `sim.heroBurst` 的
// `cap` 同一條式:射後不理取 `chaseCapS`、其餘取 `flightCapS`)。手寫秒數的下場是改了射程/
// 初速/彈道類型之後,最遠那一發回推不到擊發位置 ⇒ 靜默退回機體中心 = 病灶原封不動回來,
// 而且沒有任何錯誤訊息。
let _trailS = 0;
export function shotTrailS() {
  if (!_trailS) {
    let m = 0;
    for (const ch of Object.keys(CHARACTERS)) {
      for (const slot of ['light', 'heavy']) {
        const def = heroWeapon(ch, slot, 1, true);
        if (!def) continue;
        m = Math.max(m, trajClass(def) === 'fnf' ? chaseCapS(def) : flightCapS(def));
      }
    }
    _trailS = m;
  }
  return _trailS;
}

// ================= 「打得到嗎」逐彈道判定規則(2026-07-30 使用者回報)=================
// 使用者回報:「榴彈類武器常常出現射程光暈卻沒命中對方」。病灶是**射程光暈只量距離**:
// 距離在射程內就亮,而榴彈真正能不能命中還要看彈道解過不過得去(稜線/建物/射程包絡),
// 直擊武器則要看視線通不通 —— 光暈的語意因此比伺服器實際結算寬,亮著卻打不到。
// 修法是把「光暈亮 = 打得到」寫成**逐彈道類型的判定規則**,而不是在光暈那邊多加幾個 if:
//   path  取得「這一發最後會落在哪」的方式
//         'arc' = 拋物線火控階梯(逐級降裝藥,與 _lobAim 同一份積分)
//         'ray' = 槍口→目標的直線段(被地形/障礙截斷處即落點)
//   hit   落點到目標的判據
//         'blast' = 落點落在爆風核心帶內(blastCoreR + 目標水平量體)⇒ 目標吃滿額爆風。
//                   **刻意不要求視線通**:爆風不吃 LOS(A11 繞射近似),牆邊炸開照樣傷到牆後的人。
//         'clear' = 直線必須整段淨空(伺服器 heroHit/_lanceHits/heroPlasma 都有 _losBlocked 複驗)
//   arm   導引/射後不理的軌跡修正期(ARMING.m 內散布大、命中率低)⇒ 光暈轉警示色而非熄滅
// **唯一分類縫**:消費端(game.js `_reachable`)MUST 經 reachRule() 分派,
// MUST NOT 自己比對 def.type / trajClass 再寫第二份規則表。五個彈道類別 MUST 全數列在此。
// 2026-08-03 改制後這張表的角色是**準星那一發的入口閘**:光暈的名冊已改成「這一發的傷害
// 足跡」(`game._shotVictims`,分類走 `aoeClass`),而足跡成不成立的前提就是準星目標打得到。
// 判據本身逐位元不變,只是消費端從「逐敵人」收斂成「準星那一個」。
export const REACH_RULE = {
  lob:   { path: 'arc', hit: 'blast', arm: false },
  guide: { path: 'ray', hit: 'blast', arm: true },
  fnf:   { path: 'ray', hit: 'blast', arm: true },
  flat:  { path: 'ray', hit: 'clear', arm: false },
  line:  { path: 'ray', hit: 'clear', arm: false },
};
export const reachRule = (def) => REACH_RULE[trajClass(def)] || REACH_RULE.flat;

// ---- 後座力機制(2026-07-14:輕/重武器各三階,依武器原型分派)----
// 純客戶端手感:game.js 依「當前手上武器」的 def.recoil 套用位移懲罰 + 準星上踢 + 開火節奏。
// 伺服器不涉入(位移本就客戶端回報,防作弊仍走 heroHit 射程/迷霧驗證)⇒ bal/e2e 不受影響。
//   climb  每發準星上踢量(rad,累加到 recoil.p,開火停止後快速回穩)
//          ——**同時是「後座量」的唯一尺度**,位移懲罰由它推導(見下方 recoilMoveF)
//   kick   槍身後坐 + 鏡頭 trauma 震動倍率
//   back   每發沿槍口反向的擊退速度(m/s)
//   burst  N 連射後強制回穩(0 = 無;扇形武器不吃 —— 見 game.js)
//   settle burst 觸發後的回穩秒數(此間不能擊發,與換彈匣機制分離)
//   steady 開火前須「停下 + 穩定」的秒數(高後座重武器:狙擊 / 超電磁炮 / 導引飛彈)
// AIR_F:飛行機體(無人機 / 變形機飛行型)的位移懲罰折扣 —— 使用者指示「空中減半」,
//   整個蜂群陣營靠飛行機動,套滿地面懲罰會過度削弱空戰體驗。
// MOVE_K / DECAY / END_RAD:位移懲罰的三個旋鈕,見下方 recoilMoveF 的說明。
export const RECOIL = {
  AIR_F: 0.5,
  MOVE_K: 1,        // 位移懲罰曲線指數(1 = 降幅正比於後座量)
  DECAY: 7,         // 後座回穩速率(recoil.p *= e^(−dt·DECAY);game.js `_updatePlayer` 唯一消費端)
  END_RAD: 0.001,   // 「後座力結束」門檻(rad ≈ 0.057°:準星回到這以內,肉眼與像素都分不出來)
  light: {
    low:  { climb: 0.006, kick: 0.8, back: 0, burst: 0, settle: 0,    steady: 0 },
    med:  { climb: 0.013, kick: 1.2, back: 0, burst: 4, settle: 0.45, steady: 0 },
    high: { climb: 0.020, kick: 1.6, back: 3, burst: 0, settle: 0,    steady: 0 },
  },
  heavy: {
    low:  { climb: 0.022, kick: 2.4, back: 0, burst: 0, settle: 0, steady: 0 },
    med:  { climb: 0.032, kick: 3.2, back: 9, burst: 0, settle: 0, steady: 0 },
    high: { climb: 0.044, kick: 4.5, back: 0, burst: 0, settle: 0, steady: 0 },   // steady 0(2026-07-18):重武器改彈夾連發,取消開火前停穩蓄力
  },
};
// ---- 開火中位移懲罰(2026-08-03 使用者定案)----
// 「後座力越大的武器,射擊中的移動速度下降越多,最大後座力的重武器會將移動速度歸零、
//   直到後座力結束」⇒ 位移懲罰整條**由後座量推導**,舊制手寫的 `move`/`slowF` 兩欄退場。
// 舊表為什麼非改不可:它**不單調** —— 輕高後座(機槍)`slowF: 0` = 開火即停,而後座量比它
//   大一截的重中後座(榴彈/火箭)卻是 `move:'back'` = 位移完全不受影響、重低後座又是全停。
//   「越大降越多」在那張表上根本不成立,而畫面上只表現成「這把槍動不了、那把重砲反而能跑」,
//   沒有任何數字看得出來 —— 這正是逐階手寫的典型下場(同 CLASS_SYM / VS_DEFS 的夾制迴圈)。
// 後座尺度 = 每發準星上踢 `climb`:六階跨槽位嚴格遞增(0.006 → 0.044),是全表唯一單調的
//   後座量,也正是玩家看得見的那個後座(準星踢多高)。`kick`(震動)與 `back`(擊退)是它的
//   表現層夥伴,MUST NOT 拿來當第二把尺 —— 兩把尺遲早排出不同的序。
// 曲線 `1 − (climb / MAX)^MOVE_K`,兩個端點都是**定義**而非校準:
//   climb = 0(無後座)⇒ 不減速;climb = MAX(全表最大 = 重武器高後座階)⇒ **歸零**。
//   MOVE_K = 1 即「降幅正比於後座量」;MUST NOT 改成分段表或逐階手寫(那就是舊制的病回來)。
// 「直到後座力結束」= 懲罰的時間窗就是 `recoil.p` 這個狀態本身(game.js `_recoiling()`):
//   後座回穩是指數衰減(`DECAY`),踢回 `END_RAD` 以內即視為結束 ⇒ 連射自然累積、停火後才
//   逐步解除。MUST NOT 退回舊制那個「到下一發窗口」(`max(0.22, 1/rate) × 1.1`)的計時器 ——
//   那條與後座回穩無關,重武器打完一發早就恢復全速,使用者要的「直到後座力結束」量不到。
// 係數只夾住**移動輸入**;擊退 `back` 走 `this.vel` 不吃這個係數(那是後座本身的位移,
//   不是玩家在走路)。飛行機體另外套 `AIR_F` 折扣(見 game.js `_recoilMoveF`)。
/** 全表最大後座量(= 位移歸零的那一階)——**推導不手寫**,任一階 climb 一改自己跟著走 */
export const RECOIL_CLIMB_MAX = Math.max(
  ...['light', 'heavy'].flatMap((s) => Object.values(RECOIL[s]).map((p) => p.climb)));
/**
 * 開火中位移懲罰係數(1 = 不受影響、0 = 完全不能移動)。
 * @param {{climb?:number}} prof recoilTier() 回傳的 profile(或任何帶 climb 的物件);無 climb = 無後座
 */
export const recoilMoveF = (prof) =>
  Math.max(0, 1 - Math.min(1, Math.max(0, prof?.climb || 0) / RECOIL_CLIMB_MAX) ** RECOIL.MOVE_K);
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
  // rate 一律取**壓縮前**的 rate0(見 FIRE_RATE):後座分級是武器性格,MUST NOT 隨射速壓縮漂移 ——
  // 壓縮後全部輕武器都掉到 7 以下,`rate >= 7` 那一條會整條失效,機槍當場從 high 掉成 med。
  const nm = w.name || '', ty = w.type, rate = tierVal(w.rate0 ?? w.rate ?? RATE_DEF, 1);
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

// ---- 鏡頭震動 trauma(2026-07-23:發射感 + 震波作用範圍)----
// 純客戶端手感(同 RECOIL,伺服器不涉入)⇒ bal/e2e 不受影響。
// trauma 每秒衰減 1.4、以平方驅動噪聲(game.js _updatePlayer),故連發會自然疊成持續轟鳴。
//   FIRE       每發開火的基礎震動(再乘 RECOIL.kick 分級倍率)
//   HEAVY_F    重武器槽的額外倍率:重砲擊發要有頓挫感,輕武器維持原本的細碎抖動
//   KAMI / DECOY / HYPER  三種長按機種招(飽和攻擊 / 集束炸彈 / 極音速飛彈)的發射震動
//   BLAST_F    爆炸震波(鏡頭震動 + 掀飛推力)的作用半徑 = 該武器攻擊半徑 × 此值。
//              MUST NOT 改回「固定下限 + 倍數放大」—— 使用者指示震波不可無限遠傳遞,
//              震波範圍就是該武器的攻擊範圍(爆點核心的推力/震動強度不變,只是邊界收到 r)。
export const SHAKE = {
  FIRE: 0.03, HEAVY_F: 3.0,   // 重武器單發 0.22~0.41(依 kick 2.4~4.5)
  KAMI: 0.6, DECOY: 0.5, HYPER: 0.7,   // 極音速飛彈最重:垂直發射的後燄推力
  BLAST_F: 1,
};

// ---- 建築加乘移除(2026-08-02 使用者定案「移除對建築物加乘的武器」)----
// 舊制有**兩層**對建築加成:①各武器自己的 `vs.building`(0.3~2.2);②`GRENADE.BUILDING_MUL`
// (launcher 型再 ×1.4)。②已整組刪除(MUST NOT 復辟);①改為**只留懲罰不留加乘** ——
// vs.building 一律夾到 ≤1(見 CHARACTERS 之後的 BUILDING_VS_CAP 推導段)。
// 語意:沒有任何武器「特別會拆建築」,但防空/反甲特化機種打建築仍然吃虧(< 1 的值保留)。
// 夾制是**推導**不是逐武器手改(MUST NOT 回頭去改那 60 幾行 vs 表:那正是 32 角一動就漂移的老病)。
export const BUILDING_VS_CAP = 1;

// ---- 護盾 / 裝甲分軌剋制(2026-08-02 使用者需求「武器單位剋制加入…各類型武器」)----
// 舊制:傷害循序過雙層 HP(護盾先扣、溢出吃裝甲 + 護甲減免),而武器對兩層一視同仁 ——
// 剋制軸只有「目標**類別**」(flesh/armor/air/building),沒有「目標**血條層**」這一軸。
// 新制三個旋鈕全部住武器 def,**預設中性**(未標註的武器逐位元同舊制):
//   vsSp     對「護盾層」的傷害倍率(> 1 = 擅長打護盾;0 = 完全打不動護盾,盾全擋)
//   vsHp     對「裝甲 HP 層」的傷害倍率(< 1 = 主 HP 傷害較弱);**對無護盾的 NPC/建築同樣生效**
//            —— 「主 HP 傷害弱」若只對英雄成立,那是隱形的第二套規則
//   spPierce 0~1:這個比例的傷害**無視護盾**直接進 HP 層(仍吃 vsHp 與護甲減免)
// 三個旋鈕組出使用者點名的兩型與其反面:
//   反護盾型  vsSp > 1、vsHp < 1     定向能/微波:燒穿能量護盾,對裝甲板無力
//   穿盾型    spPierce > 0、總傷害低  高速穿甲針:穿過護盾場但動能小,拿掉的是總量不是護盾
//   反裝甲型  vsSp < 1、vsHp > 1     高爆/溫壓:護盾場消化得掉超壓,裝甲板消化不掉
// 三條配置紀律(2026-08-02 使用者定案,全部做成**推導**;違反即由 audit_shield_counter 紅字):
//   ①**穿盾 / 反裝甲只掛在原本吃建築加成的武器上** —— 那批攻城型重武器剛被拿掉 vs.building 的
//     加乘(見上方 BUILDING_VS_CAP),正好用新軸把騰出來的預算還給它們;掛到別把武器上
//     等於「舊的沒還、新的又多發一份」。名冊 = `EX_SIEGE_WEAPONS`。
//   ②**反護盾武器不得再有其他單位加成** —— 護盾軸是「不挑目標」的廣泛加成(每個有護盾的
//     對手都吃得到),再疊類別剋制就是一把武器領兩份預算。夾制見下方 `vsSp > 1 ⇒ vs 全欄 ≤ 1`。
//   ③**加成越多、越廣泛 ⇒ 基礎傷害越低** —— 見 `COUNTER_BUDGET`/`counterDmgF`。
// ①是名冊(資料),②③是夾制與折減(程式),三者都不准用「我記得當初是這樣調的」代替。
export const SHIELD_ROLE_TOL = 0.05;   // 判定「有沒有偏離中性」的死區(HUD 標籤用,見 shieldRoleName)

// ---- 剋制預算:加成越多越廣泛,基礎傷害越低(2026-08-02 使用者定案)----
// 為什麼要分「廣泛 / 挑目標」兩種權重:類別剋制(flesh/armor/air)只在**遇到那一類**時兌現,
// 一場對局裡有一半時間是白紙;護盾軸卻對**每一個有護盾的對手**恆常生效 —— 同樣寫 1.5,
// 兩者不是同樣的價錢。BROAD ≫ NARROW 就是在標這個差價。
// 負載 = BROAD ×(護盾軸超出中性的部分)+ NARROW ×(類別剋制超出 1 的部分);
// 折減 = 1 /(1 + K × 負載)⇒ 負載 0 恰為 ×1、負載越高越低,且永不為負或歸零。
// **只作用在掛了護盾軸旋鈕的武器**(`broad <= 0` 直接回 0):這是新軸的預算,不是把全表重新定價
// —— 其餘 28 名角色的傷害逐位元不變,否則「微調」會變成 32 角全體重新校準。
// 校準一律走 dmg 階梯與這三個係數,MUST NOT 回頭逐武器手改 `vs`(那是 CLASS_SYM 的欄位,
// 手改會被下一次對稱化重新等比放大蓋掉)。
// K 的校準錨 = `npm run bal` ⑤(機種對稱 50±5pp / 角色離群 20~80%):K=0.5 把兩把掛旗標的
// 變形機甲重武器同時砍掉近 26%,morph 整組掉到 44.4% 出界 —— 折減是對的方向,但一次收太多。
export const COUNTER_BUDGET = { BROAD: 1.0, NARROW: 0.35, K: 0.4 };

/** 一把武器的「加成負載」(推導不手寫;沒掛護盾軸 = 0,不進預算) */
export function counterLoad(w) {
  if (!w) return 0;
  const broad = Math.max(0, (w.vsSp ?? 1) - 1) + Math.max(0, (w.vsHp ?? 1) - 1) + (w.spPierce || 0);
  if (broad <= 0) return 0;
  const narrow = Object.values(w.vs || {}).reduce((s, v) => s + Math.max(0, v - 1), 0);
  return COUNTER_BUDGET.BROAD * broad + COUNTER_BUDGET.NARROW * narrow;
}
/** 基礎傷害折減係數(唯一套用點:heroWeapon / heroAbility 的 dmg) */
export const counterDmgF = (w) => 1 / (1 + COUNTER_BUDGET.K * counterLoad(w));

// 2026-08-02 建築加乘移除前,`vs.building > 1` 的**英雄重武器**名冊(夾制後就查不出來了,
// 故在此留檔)。使用者定案:**穿盾 / 反裝甲兩型只准掛在這批武器上** —— 它們剛被拿掉攻城加乘,
// 新軸正好把騰出來的預算還回去;掛到別把武器上 = 舊的沒還、新的又多發一份。
// (反護盾**不受此限**:它走的是「剝掉其他加成 + 壓低基礎傷害」那條路,見上方紀律②③。)
// 名冊改動 MUST 同步 `audit_shield_counter.mjs` Ⅴ —— 那支拿它逐把反查掛法。
export const EX_SIEGE_WEAPONS = [
  's01.heavy', 's02.heavy', 's04.heavy', 's05.heavy', 's12.heavy',
  't01.heavy', 't03.heavy', 't09.heavy', 't11.heavy',
  'm01.heavy', 'm05.heavy', 'm06.heavy',
];

/**
 * 傷害在「護盾層 / 裝甲 HP 層」之間的拆分(**唯一縫**)。
 * 伺服器結算(sim._damage)、客戶端 HUD 估算(game._hitFeedback/_lanceFeedback)、
 * 對進戰模型(tools/duel.mjs)MUST 全部吃這一支,MUST NOT 各自再寫一份分層邏輯。
 *
 * 護盾以「原始傷害預算」計價:`spent` = 這一發有多少預算被護盾吃掉,`toSp` = 折成護盾實際掉的量。
 * MUST NOT 改成「先把溢出的護盾傷害直接倒進 HP」—— 那會讓 vsSp 高的武器打殘盾目標時,
 * 溢出的那一段白賺一次反護盾加成(打空盾的瞬間傷害暴衝)。
 * vsSp = 0 於是自然退化成「護盾完全擋下」(spent = 全部預算、toSp = 0),而不是「無視護盾穿過去」——
 * 想要穿過去請用 spPierce(原則 6:寧缺勿錯,退化方向一律朝「盾有效」)。
 * 中性參數(vsSp = vsHp = 1、spPierce = 0)逐位元還原舊制:toSp = min(sp, dmg)、toHp = dmg − toSp。
 */
export function shieldSplit(wd, dmg, sp) {
  const sMul = wd?.vsSp ?? 1, hMul = wd?.vsHp ?? 1, pf = wd?.spPierce || 0;
  const pierce = dmg * pf;              // 無視護盾的那一份(原始量)
  const budget = dmg - pierce;          // 會撞上護盾層的預算(原始量)
  const shield = Math.max(0, sp || 0);
  const spent = sMul > 0 ? Math.min(budget, shield / sMul) : budget;   // 被護盾吃掉的預算
  return { toSp: spent * sMul, toHp: (pierce + budget - spent) * hMul };
}

/** 武器在護盾軸上的角色標籤(HUD/圖鑑用;由旋鈕**推導**,MUST NOT 另建原型名冊) */
export function shieldRoleName(wd) {
  const s = wd?.vsSp ?? 1, h = wd?.vsHp ?? 1, p = wd?.spPierce || 0, T = SHIELD_ROLE_TOL;
  if (p > T) return '穿盾';
  if (s > 1 + T && h < 1 - T) return '反護盾';
  if (s < 1 - T && h > 1 + T) return '反裝甲';
  if (s > 1 + T) return '削盾';
  if (h > 1 + T) return '破甲';
  return '';
}

// ---- 水域規則(2026-07-15;客戶端物理 + 道路生成共用)----
// LEVEL:海平面水面高(terrain.js 水面盤 y,minH < 0.5 才有水);WADE_M:淺水/涉水判定深度界
// (道路跨水升橋沿用);SLOW:涉水/河面基準減速;SPAN_MIN_M:道路連續泡水段達此長度即自動升級高架橋
// (biomes.js buildRoads);RAMP_M:自動橋段向兩岸乾地各外延的引道長(斜坡出入口)。
// 2026-07-19 水沼可通行改制:深水不再是牆(FULL_D 全滅頂深度、SLOW_MIN 最深減速倍率);
// SHORE/SWAMP_BAND = terrainEnvCode 水/沼分類界;GRID_M = 主機上傳水沼遮罩格粒(伺服器 AI 迴避)。
// (2026-07-22:DECK_COVER 覆蓋率去重已移除 —— 兵線泡水段一律自建全跨補橋、兵線走廊內
//  真橋剔除,兵線橋數不再隨 Overpass 回傳浮動;見 biomes.js dropLaneBridges。)
export const WATER = {
  LEVEL: 0.3, WADE_M: 1.2, SLOW: 0.5, SPAN_MIN_M: 18, RAMP_M: 24,
  FULL_D: 5.0, SLOW_MIN: 0.25, SHORE: 0.05, SWAMP_BAND: 2.2, GRID_M: 20,
};

// ---- 地形環境效果(2026-07-19;水域/沼澤/火場對移動與狀態的影響)----
// 移動減速純客戶端(領機客戶端權威);狀態結算純伺服器(客戶端只回報身處環境 env)。
// SWAMP_SLOW:沼澤進場移動倍率(1/4);滯留越久越陷 → 到 SWAMP_DRAIN_S(扣血起算門檻)線性降到
//   SWAMP_SLOW_MIN(1/8;純客戶端)—— 減速探底與開始扣血同時發生,單一門檻不重複手寫。
// SWAMP_DRAIN_S:扣血起算門檻;SWAMP_DRAIN_PS:每秒扣血 = 火災 dot × SWAMP_DRAIN_FIRE_FRAC(HAZARDS 後推導,勿手寫),
//   走 _damage(護盾先擋、剩餘吃裝甲),但硬地板 1 滴不致死(sim floorHp)。
// WATER_FREEZE_S:水域滯留多久後凍結換彈/招式冷卻;FIRE_FOG_S/_MAX_S:火場滯留視野霧化起訖(純客戶端)。
// WATER_EYE_F / SWAMP_EYE_F:異常狀態的觸發眼位係數(2026-07-23,見 envTrigger)。
export const TERRAIN_FX = {
  SWAMP_SLOW: 1 / 4, SWAMP_SLOW_MIN: 1 / 8,
  SWAMP_DRAIN_S: 3, SWAMP_DRAIN_FIRE_FRAC: 1 / 3, SWAMP_DRAIN_PS: 0,   // PS 由 HAZARDS.fire.dot 推導(見下方回填)
  WATER_FREEZE_S: 3,
  FIRE_FOG_S: 2.5, FIRE_FOG_MAX_S: 8,
  WATER_EYE_F: 1, SWAMP_EYE_F: 1 / 2,
};

/**
 * 地形異常狀態觸發(2026-07-23;唯一縫 —— 客戶端 _envAt 與水下帷幕共用同一把尺)。
 * 舊制「踩到水/沼格子就觸發」會讓 0.3m 淺灘也凍結電子系統,與「眼位沒入水面才變色」的水下帷幕
 * 對不上。新制改以**機體視線(座艙眼位)高度 vs 觸發水平面**判定 —— 看得到水下才算泡水(WYSIWYG):
 *   水域:眼位(footY + eyeH × WATER_EYE_F)低於水面 waterY
 *   沼澤:眼位一半(footY + eyeH × SWAMP_EYE_F)低於沼澤面 = waterY + WATER.SWAMP_BAND
 *         (沼澤帶上緣,與 terrainEnvCode 的分類界同一個數字,MUST NOT 另寫)
 * ⇒ 跳躍/蓄力跳躍把眼位抬離水平面的那段時間,異常狀態自然解除(呼叫端無需另設計時器)。
 * ground = terrainEnvCode 的地表分類(0 乾 / 1 水 / 2 沼);footY = 站立面絕對高;eyeH = 眼位離站立面高。
 */
export function envTrigger(ground, waterY, footY, eyeH) {
  if (!ground || waterY == null) return 0;
  const eyeF = ground === 1 ? TERRAIN_FX.WATER_EYE_F : TERRAIN_FX.SWAMP_EYE_F;
  const planeY = ground === 1 ? waterY : waterY + WATER.SWAMP_BAND;
  return footY + eyeH * eyeF < planeY ? ground : 0;
}

// ---- 地形坡度移動(2026-07-30 使用者需求;地面單位的上坡/下坡唯一縫)----
// 需求原文:「地面單位往某個傾斜度(跟兵線坡度限制有關的 16 度)的地形上坡移動時會減速,
//   速度變化與陡峭度相關,陡到某個程度後就不可以爬上去;反過來,對應的坡度下坡會加速」。
//
// 平緩帶上限 EASE_DEG **就是**兵線坡度限制 `MAPGEO.MAX_ROAD_GRADE_DEG`(16°)——
//   MUST NOT 手寫 16,改兵線限制即連動。設計語意:**推線走廊恆全速**(兵線走的是真實道路,
//   坡度已被 maxLaneGrade 濾在 16° 內),離開兵線去爬野山才付代價 —— 坡度是「離開大路的代價」,
//   不是對正常推進的普遍課稅。
//   餘裕註記:兵線那 16° 量在**真實世界**(mapSelect maxLaneGrade 用真實公尺),而遊戲空間水平
//   放大 1/REAL_SCALE 倍、高程不放大 ⇒ 同一條路在遊戲空間只剩 atan(tan16° × REAL_SCALE) ≈ 8.2°,
//   離平緩帶上限還有近一倍餘裕(稽核 audit_slope_move.mjs Ⅳ 逐條盯住這條不變式)。
// 阻擋角 BLOCK_DEG = EASE_DEG × BLOCK_F(推導,MUST NOT 手寫):超過即「爬不上去」——
//   遊戲空間 32° ≈ 真實世界 57°,亦即只有峭壁擋人,一般山坡照樣爬得上去(只是慢)。
//   垂直通道由攀爬路線(climb.js)提供,MUST NOT 為了「這面牆上不去」去調鬆這個角度。
// 速度倍率在 [EASE_DEG, BLOCK_DEG] 之間線性內插:上坡 1 → UP_MIN_F、下坡 1 → DOWN_MAX_F
//   (更陡的下坡夾在 DOWN_MAX_F —— **下坡永遠不擋**,否則陡坡上的機體會把自己鎖死)。
// PROBE_M:量測移動速度倍率的前瞻距離(公尺)。MUST 與 dt/機體速度無關 —— 拿當幀位移量坡,
//   低幀率量到的坡就會比高幀率陡(高度場雙線性內插在格內是線性的,但跨格會摺),手感隨幀率浮動。
// STRUCT_M:「站在人造鋪面上」的高差門檻(站立面 vs 裸地形)。橋面/隧道路面/屋頂是工程結構,
//   一律不吃坡度效果(與 _envAt 的「橋面/結構物 = 乾」同一條界線)。
export const SLOPE = {
  EASE_DEG: MAPGEO.MAX_ROAD_GRADE_DEG,   // 平緩帶(此角度內恆全速)= 兵線坡度限制
  BLOCK_F: 2,                            // 阻擋角 = 平緩帶 × 此倍率
  UP_MIN_F: 0.35,                        // 上坡到阻擋角前的最低速度倍率
  DOWN_MAX_F: 1.25,                      // 下坡到阻擋角後的最高速度倍率(更陡亦夾在此)
  PROBE_M: 2.5,                          // 速度倍率的前瞻取樣距離
  STRUCT_M: 1.2,                         // 站立面高出/低於裸地形超過此值 = 人造鋪面(不吃坡度)
  SNAP_F: 2,                             // 下坡貼地上界 = 阻擋角 × 此倍率(見 slopeSnapM)
  BLOCK_DEG: 0,                          // 推導回填(見下兩行),MUST NOT 手寫
  SNAP_DEG: 0,                           // 同上
};
SLOPE.BLOCK_DEG = SLOPE.EASE_DEG * SLOPE.BLOCK_F;
// 貼地上界 MUST 寬於阻擋角 —— **下坡從來不擋**,阻擋角只管上坡;拿它當貼地上界,
// 那些走得下去但爬不上來的陡坡(> BLOCK_DEG)就又會回到「邊走邊彈起」的病灶。
SLOPE.SNAP_DEG = Math.min(89, SLOPE.BLOCK_DEG * SLOPE.SNAP_F);

/** 帶號坡度角(度;+ 上坡 / − 下坡)。run 為水平距離(> 0),rise 為高程差。 */
export const slopeDeg = (rise, run) => Math.atan2(rise, run) * 180 / Math.PI;

/**
 * 坡度 → 移動速度倍率(唯一縫;上坡減速 / 下坡加速,平緩帶內恆 1)。
 * deg 為帶號坡度角(slopeDeg 的輸出)。回傳值恆 > 0 —— 「爬不上去」是 slopeBlocked 的事,
 * MUST NOT 用倍率 0 表達(乘 0 只是原地不動,玩家分不出「很慢」與「上不去」,且斜向滑行會失效)。
 */
export function slopeMoveF(deg) {
  const d = deg || 0;
  const over = Math.abs(d) - SLOPE.EASE_DEG;
  if (over <= 0) return 1;
  const k = Math.min(1, over / (SLOPE.BLOCK_DEG - SLOPE.EASE_DEG));
  return 1 + ((d > 0 ? SLOPE.UP_MIN_F : SLOPE.DOWN_MAX_F) - 1) * k;
}

/** 陡到爬不上去(**只擋上坡**:下坡一律放行,否則陡坡上的機體會把自己鎖死) */
export const slopeBlocked = (deg) => (deg || 0) > SLOPE.BLOCK_DEG;

/**
 * 下坡貼地的落差上界(公尺):水平走了 run 公尺,「還算走在坡上」最多讓腳下掉這麼多。
 * 落差在界內 = 機體 MUST 吸回地面(離地量逐幀累積會把下坡走成連續騰空,蓄力當場中斷);
 * 超出 = 斷崖/跳台的單步落差,照舊彈飛。上界推導自 `SLOPE.SNAP_DEG`,
 * MUST NOT 在消費端手寫 tan(...)(第二份實作 = 改了角度只有一半跟著走)。
 */
export const slopeSnapM = (run) => Math.tan(SLOPE.SNAP_DEG * Math.PI / 180) * Math.max(0, run || 0);

// ---- 異常狀態致盲白幕(2026-07-30;純表現層唯一縫)----
// 使用者需求:「閃光彈等異常狀態會使畫面一小段時間變白,之後漸漸淡去」。
// 定位是**座艙光學被閃到的瞬時反應**(感光元件過曝),不是狀態計時器的可視化 ⇒
//   白幕長度固定 = HOLD_S(全白)+ FADE_S(漸淡),MUST NOT 隨狀態剩餘秒數延長 ——
//   狀態本身的效果(禁移動/武器離線/操縱反轉)一律伺服器結算(A1),白幕只吃「上身瞬間」那一下。
// PEAK 逐狀態列出致盲強度(1 = 全白):只有**光學/電子系**異常狀態進表 ——
//   emp 雷爆閃光(閃光彈本體,最亮)> conf 纏擾致盲 > stun 電擊麻痺;
//   物理系(slow 緩速 / bleed 失血 / mark 被標定)MUST NOT 進表:那些不是光學事件,
//   加進來 = 每次中招都白一次,分不出「被閃到」與「被咬到」。
export const CC_FLASH = {
  HOLD_S: 0.3, FADE_S: 1.2,
  PEAK: { emp: 1, conf: 0.85, stun: 0.55 },
};
/** 白幕總長(秒)= 全白段 + 漸淡段;推導不手寫 */
export const ccFlashDur = () => CC_FLASH.HOLD_S + CC_FLASH.FADE_S;
/**
 * 白幕不透明度(0~1):left = 白幕剩餘秒數(由 ccFlashDur() 倒數)、peak = 該狀態致盲強度。
 * 剩餘 > FADE_S 的那段 = 全白(HOLD 段),其後在 FADE_S 內以 smoothstep 淡回清晰。
 */
export function ccFlashAlpha(left, peak) {
  const p = Math.max(0, Math.min(1, peak || 0));
  const t = Math.max(0, Math.min(ccFlashDur(), left || 0));
  if (t >= CC_FLASH.FADE_S) return p;                 // 全白段(HOLD)
  const u = t / CC_FLASH.FADE_S;                      // 1 → 0
  return p * u * u * (3 - 2 * u);                     // smoothstep 漸淡(收尾平順)
}

// ---- 受擊濺血提示(2026-08-02;純表現層唯一縫)----
// 使用者需求:「被攻擊時的畫面要有半透明紅色濺血提示,會視敵人射擊的方向決定濺血位置,
//   傷害越高濺血的血滴越大」。定位是**座艙玻璃上的血漬**(半透明,視野 MUST 仍讀得到)——
//   與 CC_FLASH 同族的純表現層:傷害/方位全部照抄伺服器的 `hurt` 事件(A1),客戶端只做投影與衰減。
// 三件事各有一支曲線,MUST NOT 在消費端手寫:
//   ・位置 bloodScreenUv:攻擊者相對**當下鏡頭**的水平/垂直夾角 → 螢幕 0~1;超過半視角(含背後)
//     夾在畫面邊緣 ⇒ 「從哪邊打來、血就噴在哪一邊」對背後攻擊同樣成立。
//   ・血滴大小 bloodDropR / 數量 bloodDropN:吃的是**這一擊佔自機總量(裝甲+護盾)的比例**而非絕對
//     傷害值 —— 各機種 EHP 差一個量級,拿絕對值當尺會讓輕甲被擦一下就滿版、重甲被打爆卻沒感覺。
//     REF_F = 「一擊打掉這個比例 = 最大血滴」的校準錨。
//   ・淡出 bloodAlpha:HOLD 段維持 → FADE 段 smoothstep 淡掉(與 ccFlashAlpha 同形)。
export const BLOOD = {
  HOLD_S: 0.35, FADE_S: 2.4,      // 停留(全濃)+ 漸淡秒數
  PEAK: 0.62,                     // 峰值不透明度(**半透明**上限;調到 1 = 擋住視野,違反需求)
  REF_F: 0.22,                    // 校準錨:一擊打掉 22% 總量 = 最大血滴
  DROP_MIN: 0.9, DROP_MAX: 4.6,   // 血滴半徑(vmin;主滴尺寸,衛星滴按比例縮)
  N_MIN: 3, N_MAX: 12,            // 每次濺血的血滴數(含主滴)
  SPREAD: 7.5,                    // 衛星滴散布半徑(vmin)
  EDGE: 0.07,                     // 畫面邊緣內縮(避免血斑一半跑到畫面外)
  MAX: 5,                         // 同時存在的血斑上限(超過 = 最舊的先退場)
};
/** 濺血總長(秒)= 停留段 + 漸淡段;推導不手寫 */
export const bloodDur = () => BLOOD.HOLD_S + BLOOD.FADE_S;
/** 濺血不透明度(0~1):left = 剩餘秒數(由 bloodDur() 倒數) */
export function bloodAlpha(left) {
  const t = Math.max(0, Math.min(bloodDur(), left || 0));
  if (t >= BLOOD.FADE_S) return BLOOD.PEAK;             // 停留段
  const u = t / BLOOD.FADE_S;                           // 1 → 0
  return BLOOD.PEAK * u * u * (3 - 2 * u);              // smoothstep 漸淡
}
/** 這一擊的「份量」0~1:dmg = 實際損耗的護盾+裝甲、pool = 自機總量上限(maxHp + maxSp) */
export function bloodFrac(dmg, pool) {
  if (!(dmg > 0) || !(pool > 0)) return 0;
  return Math.min(1, dmg / (pool * BLOOD.REF_F));
}
/** 主血滴半徑(vmin):份量 0 → DROP_MIN、份量 1 → DROP_MAX */
export const bloodDropR = (frac) =>
  BLOOD.DROP_MIN + (BLOOD.DROP_MAX - BLOOD.DROP_MIN) * Math.max(0, Math.min(1, frac || 0));
/** 血滴數(含主滴):份量越高噴得越散 */
export const bloodDropN = (frac) =>
  Math.round(BLOOD.N_MIN + (BLOOD.N_MAX - BLOOD.N_MIN) * Math.max(0, Math.min(1, frac || 0)));
/**
 * 濺血位置(螢幕比例 {u, v},0~1;v 由上往下)。
 * bearing = 攻擊者相對視線的**水平**夾角(0 = 正前、+ = 右、±π = 背後);
 * elev    = **垂直**夾角(+ = 攻擊者在上方;取不到高程時傳 0 = 畫面中線);
 * halfH / halfV = 當下鏡頭的半視角(弧度)—— 狙擊模式縮 FOV 時血斑跟著收攏,不必另寫一份。
 * 超過半視角一律夾在邊緣:背後中彈 = 血噴在左右邊緣,而不是折回畫面中央。
 */
export function bloodScreenUv(bearing, elev, halfH, halfV) {
  const clamp1 = (v) => Math.max(-1, Math.min(1, v));
  const inset = (t) => BLOOD.EDGE + t * (1 - 2 * BLOOD.EDGE);
  const u = inset(0.5 + 0.5 * clamp1(halfH > 0 ? (bearing || 0) / halfH : 0));
  const v = inset(0.5 - 0.5 * clamp1(halfV > 0 ? (elev || 0) / halfV : 0));
  return { u, v };
}

// ---- 障礙物視線遮蔽(2026-07-15;伺服器 sim._losBlocked / 客戶端彈道共用參數)----
// 建物/神木/巨岩等實體障礙擋砲火與視線:塔/NPC/玩家都不能透視。
// EYE_M/TGT_M:射手眼高 / 目標身高取樣(地面單位);TOWER_EYE_M:塔的砲位高(塔身 26m,砲位過半);
// THRU_M:穿越障礙圓柱的弦長門檻(< 門檻 = 貼牆擦邊,不算遮蔽);MAX_OCC:上傳障礙數上限。
// MAX_SLAB:上傳橋面/隧道天花薄板段數上限(#1;橋面 deck 段可達數千,取足量)。
// TUN_CLEAR_M:隧道路面→天花淨空(遊戲公尺)。單一縫:biomes.js 建洞(TUN.CLEAR)與
// sim.js 飛行體所在層推定(_unitLev:飛行高度 ≥ 淨空 ⇒ 必在山體上方,非洞內)共用。
// ---- 地形稜線遮蔽(2026-08-01 使用者需求「直線攻擊與扇形攻擊要避免隔山打牛」)----
// 伺服器本來是**無地形高程**的 2D 平面:`_losBlocked` 只認上傳的障礙柱(occ)與水平薄板
// (slabs),山稜完全不存在。客戶端回報型的攻擊(heroHit / heroBurst / heroLance 的射線)
// 本來就被本端地形截斷過,所以看不出問題;而**伺服器自己選目標**的路徑沒有這道保護:
//   ・`heroPlasma`(扇形):客戶端只送一個射向,錐內選誰中彈全在伺服器 ⇒ 隔山打牛。
//   ・`_lanceHits`(直線貫穿)給 bot 用的那條(botFire 自建射線,未經客戶端地形截斷)。
// 而客戶端的射程光暈對這兩類武器吃的是 `REACH_RULE` 的 `hit:'clear'`(線段整段淨空,含地形)
//   ⇒ 光暈早就說「打不到」,伺服器照樣扣血 = 又一次「光暈 ⇔ 傷害」分家。
// 解法沿用既有契約:房主載圖後把**粗高程網格**隨 `t:'world'` 一起上傳(與 occ/slabs/wet 同一條路),
// 伺服器據此做稜線遮蔽。未上傳(e2e/headless)⇒ 網格不存在 ⇒ 判定 no-op,舊行為逐位元不變。
//   HGT_M      網格格距(公尺)。地形本體是 193² 頂點 ≈ 27.7m/格(L3),取同級即可 —— 再細只是
//              放大傳輸量,山稜的尺度遠大於此。
//   HGT_MAX    每軸格數上限(32 × 256 = 8192m,涵蓋 L3 擴張後的 ~5311m)。
//   RIDGE_M    認定遮蔽的餘裕:粗網格 + 雙線性內插必然與客戶端的 193² 解析射線有出入,
//              **偏差方向 MUST 朝「不擋」**(原則 6 寧缺勿錯)—— 地形要高過射線這麼多才算擋,
//              否則邊界上的合法傷害會被驗證後靜默丟棄(A30 家族),那比偶爾隔山打牛更糟。
//   RIDGE_SKIP_M 兩端各跳過的長度:射手與目標本來就站在地面上,端點附近地表必然貼著射線,
//              不跳過就是「每一發都被自己腳下的地擋住」。
export const LOS = { EYE_M: 2.0, TGT_M: 1.0, TOWER_EYE_M: 14, THRU_M: 3, MAX_OCC: 4000, CELL_M: 64, MAX_SLAB: 6000, TUN_CLEAR_M: 8,
  HGT_M: 32, HGT_MAX: 256, RIDGE_M: 3, RIDGE_SKIP_M: 24 };

// 粗高程網格的字串編碼(**唯一縫**:main.js 烘烤端與 sim.js 解析端同吃這一組)。
// 每格 2 個可列印 ASCII 字元 = 12 bit = 4096 階 × HGT_STEP 公尺相對落差(遠超任何戰區的地形起伏),
// JSON 逐字元 1 byte ⇒ L3 滿版 256² 格約 131KB,與既有的 occ/slabs 上傳同級。
// MUST NOT 改成非 ASCII 單字元編碼:JSON.stringify 會轉成 \uXXXX,反而膨脹成三倍。
export const HGT_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export const HGT_STEP = 1;        // 量化步長(公尺;< RIDGE_M 餘裕 ⇒ 量化誤差吃不進判定)
export const HGT_LEVELS = 4096;   // = 64²(兩個字元)
/** 高程 → 2 字元(相對 minH 量化);超出範圍夾住(遠高於頂 = 照樣擋,遠低於底 = 照樣不擋) */
export const hgtEnc = (h, minH) => {
  const v = Math.max(0, Math.min(HGT_LEVELS - 1, Math.round(((h - minH) / HGT_STEP) || 0)));
  return HGT_CHARS[v >> 6] + HGT_CHARS[v & 63];
};

// ================= 機體實體高度 / 命中量體(2026-07-10 尺度基準;2026-07-23 移入本檔)=================
// 步兵 = 真人身高 SOLDIER_H,是全遊戲唯一的「身高單位」。人員/載具/建物一律用真實世界
// 公稱尺寸,不再有超尺度倍率(舊制步兵 3.2m,建物/植被便得靠 biomes.js OVER ×1.8 補回比例)。
// **住在 data.js 的理由**:這組值同時是「渲染縮放」(models.js fitToHeight)與「伺服器命中量體」
// (sim._blast/_lanceHits 的垂直帶 —— 打到機體哪個部位就在那裡結算)。兩端 MUST 共用同一把尺,
// 各寫一份 = 看得到卻打不到。models.js 只做 re-export,呼叫端不動。
export const SOLDIER_H = 1.8;

// 機體尺寸(2026-07-12 改制,相對真人身高):
//   機甲 / 變形者(不分型態)= 150%~250%、無人機 = 75%~150%。
// 倍率仍隨 mods.armor 在該機種護甲區間內線性內插:
// 高防禦 = 更巨大 = 剪影更大 = 更容易被命中(命中是客戶端對 mesh raycast,體型直接生效)。
export const HERO_SIZE = {
  robot: { armor: [12, 26], mul: [1.5, 2.5] },
  morph: { armor: [5, 24], mul: [1.5, 2.5] },
  drone: { armor: [3, 12], mul: [0.75, 1.5] },
};
const BEAST_H_F = 0.78;   // 獸型四足:同噸位的站姿較矮(體長換來的)—— 但不得跌破機種下限
// 變形者的人形地面型(vis.ground):其餘值一律四足獸型
export const MORPH_HUMANOID = new Set(['biped', 'wolf', 'vampire', 'monkey', 'atlas']);

/** 英雄機體顯示高度(公尺):依角色護甲值在機種區間內插 */
export function heroTargetH(kind, ch) {
  const S = HERO_SIZE[kind];
  if (!S) return SOLDIER_H * 4;
  const c = CHARACTERS[ch];
  const armor = c?.mods?.armor;
  const t = armor == null ? 0.5 : Math.max(0, Math.min(1, (armor - S.armor[0]) / (S.armor[1] - S.armor[0])));
  const h = SOLDIER_H * (S.mul[0] + (S.mul[1] - S.mul[0]) * t);
  // 獸型矮化:機甲看 visual.form;變形者看 visual.ground(非人形即四足獸,體長換高度)。
  // 矮化後 MUST 夾回機種區間下限 —— 機甲/變形者不分型態都要 ≥ 150% 真人身高。
  const quad = c?.visual?.form === 'beast'
    || (c?.visual?.ground && !MORPH_HUMANOID.has(c.visual.ground));
  return quad ? Math.max(SOLDIER_H * S.mul[0], h * BEAST_H_F) : h;
}

// 非英雄單位顯示高度(公尺;models.js fitToHeight 自動縮放)。人員/載具 = 真實世界尺寸;
// 塔/主堡是虛構工事,維持既有的地標級量體。
export const TARGET_H = {
  // decoy:fitToHeight 量的是「高度」— 集束轟炸機高 ≈ 0.99 / 長 ≈ 2.2,取 1.4 得機身長約 3.1m
  decoy: 1.4,
  hyper: 1.4 * HYPER.MODEL_F,   // 極音速飛彈 = 同一具彈體放大 MODEL_F(推導不手寫;models.js 吃同一個係數)
  'creep:soldier': SOLDIER_H, 'creep:rocketeer': SOLDIER_H, 'creep:howitzer': SOLDIER_H * 1.05,
  'creep:apc': 2.7, 'creep:tank': 2.8, 'creep:heli': 3.9,
  tower: 26, 'base:SWARM': 42, 'base:STEEL': 46,
  bunker: 5.2,   // 第三方碉堡(低矮工事;駐守 3 名步槍兵的量體)
  civ: SOLDIER_H,   // 平民/間諜(真人身高)
};

/**
 * 命中量體高度(公尺,站立表面以上):爆風/貫穿判定的「機體垂直帶 = [腳底, 腳底 + hitH]」。
 * 使用者規則(2026-07-23):瞄準物件的哪個部位,就用那個部位的碰撞結果判定命中 ——
 * MUST NOT 只拿單位底部(腳下光圈)當唯一取樣點:26m 高的塔被打中塔頂、10m 機甲被爆頭,
 * 若量到腳底就會落在爆風衰減帶外 = 打中了卻不痛。伺服器 sim._blast / _lanceHits 唯一入口。
 */
export function hitH(e) {
  if (!e) return SOLDIER_H;
  if (e.hero) return heroTargetH(e.kind, e.ch);
  if (e.kind === 'base') return TARGET_H[`base:${e.side}`] ?? 44;
  if (e.civ) return TARGET_H.civ;
  return TARGET_H[`creep:${e.kind}`] ?? TARGET_H[e.kind] ?? SOLDIER_H * 1.6;
}

// ---- 命中量體「水平半徑」(2026-07-28 使用者回報「直線攻擊重武器常常打不到單位,特別是建築」)----
// hitH 是同一把尺的**垂直**版;本組是**水平**版。舊制 _lanceHits 只拿單位的中心「點」比對圓柱,
// 半徑 7m 的砲塔 / 20m 的主堡打在牆面上就離中心 5~18m ⇒ 明明打中了卻整發落空(建築尤其明顯,
// 因為體積最大)。伺服器貫穿判定與客戶端碰撞/本地估算 MUST 共用這一支,各寫一份 = 看得到卻打不到。
// **英雄不手寫**:半徑正比機體實高(HERO_HIT_R × heroTargetH),與體型綁角色護甲的規則同源 ——
// 巨大機甲既難閃也難躲(係數沿用 game.js 舊 heroCollider 的觀感校準值)。
export const HERO_HIT_R = { robot: 0.43, morph: 0.43, drone: 0.80 };
// 非英雄單位/工事的水平半徑(公尺,真實世界公稱尺寸的一半;塔/主堡維持既有碰撞量體)
export const TARGET_R = {
  decoy: 1.1,
  hyper: 1.1 * HYPER.MODEL_F,
  'creep:soldier': 0.6, 'creep:rocketeer': 0.6, 'creep:howitzer': 0.6,
  'creep:apc': 1.6, 'creep:tank': 1.9, 'creep:heli': 3.0,
  tower: 7, 'base:SWARM': 20, 'base:STEEL': 20,
  bunker: 3.4,
  civ: 0.6,
};
/**
 * 命中量體水平半徑(公尺):貫穿圓柱/碰撞圓柱的「機體橫向量體」。
 * 查無者退回 SOLDIER_H × 0.5(人員級量體)—— 寧可小,不要無端放大不明物件。
 */
export function hitR(e) {
  if (!e) return SOLDIER_H * 0.5;
  if (e.hero) return heroTargetH(e.kind, e.ch) * (HERO_HIT_R[e.kind] ?? 0.43);
  if (e.kind === 'base') return TARGET_R[`base:${e.side}`] ?? 20;
  if (e.civ) return TARGET_R.civ;
  return TARGET_R[`creep:${e.kind}`] ?? TARGET_R[e.kind] ?? SOLDIER_H * 0.5;
}

// ---- 世界高度上限(2026-08-08 使用者定案)----
// 使用者兩句:「遊戲最高高度 = max(平均海拔 + 4 倍砲塔高度, 最高海拔 + 2.5 倍砲塔高度)」
// 「所有物件的最高高度限定 N 倍砲塔高度」(2026-08-09 由 2 改為 4,見下方 WORLD_H)。**尺只有一把 = `TARGET_H.tower`**:三個係數全是
// 它的倍數 ⇒ 砲塔量體一改,天花板與物件上限一起跟著漂;把 52 / 104 / 65 手寫進任何消費端,
// 改了塔高之後那三個數字就悄悄與塔脫鉤,而畫面上只表現成「這張圖的樓好像比塔高一點」。
//
// 兩條規則是**同一個設計的兩半**,分開看會漏掉它們的關係:天花板量到地表的餘裕最少是
// `CEIL_PEAK_F × 塔高`(= 2.5 倍,因為任一點的地表 ≤ 最高海拔),而物件上限是 2 倍
// ⇒ **物件恆構不到天花板**(差至少半個塔高)。這個不等式是結構性的,不是校準出來的:
// 只要 `CEIL_PEAK_F > OBJ_F` 就恆成立,稽核 Ⅳ 逐條釘住。反過來說,把 `OBJ_F` 調到
// ≥ `CEIL_PEAK_F` 就會生出「站在山頂的建物頂端已經頂到飛行天花板」那種穿模。
//
// **平均海拔那一項才是平原場地的實際天花板**(高山場地由最高海拔那一項接手):
// 平坦市區 avg ≈ peak ⇒ max(avg+4H, peak+2.5H) = avg + 4H;峽谷場地落差數百公尺 ⇒
// 由 peak + 2.5H 勝出 ⇒ 谷底起飛的機體照樣飛得過稜線(取 max 而不是 min 的理由:
// 天花板 MUST 是**全圖一個值**,谷底那半若吃平均海拔就會被關在山谷裡)。
// 2026-08-09 使用者定案「提高物件高度上限」⇒ 2 → **4 倍砲塔高**(52 → 104m),峰頂項 2.5 → 4.5。
// 為什麼要改:2026-08-08 定的 2× 上限把**建物**壓到 52m,而 `biomes.js` 的「高層商辦」門檻
// 是手寫的 55m(`MASS.MIN_H` 與退縮頂塔 `b.h > 55` / 第二層 `b.h > 100` / 屋頂天線 `b.h > 60`)⇒ 那四條**結構性地
// 永遠不成立**:整棟量體庫節點(`building/mass_a`·`mass_b`,兩輪 img→3D 的產出)一顆都不會
// 被擺出去、天際線的「婚禮蛋糕」剪影整個消失,而 intake / audit_siteplan(含 `--break-mass`
// 反向驗證)/ 對照台孤兒數 **全數綠燈** —— 兩個 PR 各自綠、合起來壞的語意衝突,沒有任何
// 錯誤訊息。守門線補在 `audit_world_height` Ⅲ(吃建物高度的門檻 MUST 在上限之下)。
// **三個係數 MUST 一起看**:①`CEIL_PEAK_F > OBJ_F` 是「物件恆構不到天花板」的**結構保證**
// (不是校準);②`CEIL_AVG_F > CEIL_PEAK_F` 是「取 max 的兩端各自勝出」的前提 —— 地表恆
// ≤ 最高海拔 ⇒ 平均項的係數若不大於峰頂項,平坦市區那一項**永遠贏不了**,規則 ③ 當場退化成
// 單一項。改任一個 MUST 重跑 `audit_world_height`(Ⅰ 的兩端各自勝出 + Ⅱ 的結構不等式)。
export const WORLD_H = {
  OBJ_F: 4,          // 物件最高高度 = 4 × 砲塔高
  CEIL_AVG_F: 6,     // 天花板 = 平均海拔 + 6 × 砲塔高(MUST > CEIL_PEAK_F,見上)
  CEIL_PEAK_F: 4.5,  //     或 = 最高海拔 + 4.5 × 砲塔高,**取大者**(MUST > OBJ_F)
};
/** 世界物件的最高高度(公尺;建物/地標/巨岩/神木/語意化地標共用這一個上限) */
export const objHeightMax = () => TARGET_H.tower * WORLD_H.OBJ_F;
/**
 * 高度是縮放的線性函式 ⇒ 上限一律夾**縮放**而不是事後截掉幾何:
 * 截幾何 = 碰撞柱/淨空/冠幅與看得見的量體分家(原則 4);夾縮放則整株等比縮小,
 * 落底、footprint、攀爬設施、樹冠羞避全部自動跟著對。
 * @param s     原始縮放
 * @param nomH  該物件在 s = 1 時的標稱高度(公尺);≤ 0(不知道)一律原樣放行(原則 6)
 */
export const objScaleCap = (s, nomH) => (nomH > 0 ? Math.min(s, objHeightMax() / nomH) : s);
/**
 * 同一個上限的**分布版**:把整組抽樣等比壓進上限(頂端恰好貼齊,相對變異逐位元保留)。
 *
 * 為什麼需要這一支:硬夾(`objScaleCap`)只認得手上這一株,**抽得到的每一個值都超過上限時
 * 就會全部夾成同一個數字**。神木正是這個情形 —— 公稱高 72~110m、最小縮放 0.73
 * ⇒ 連最矮的一株都超過當時的上限 ⇒ 硬夾之後整片森林**每一株一樣高**,而
 * 「同種群聚、株高各異」是這套群落既有的設計(樹冠羞避的縮冠量也是從株高變異來的)。
 * 等比壓縮則讓「最高的那株恰好貼齊上限」,矮的仍然矮。
 *
 * **仍然只有一條規則**:壓縮率就是把 `objScaleCap` 套在**該處抽得到的最大縮放**上得到的比值
 * ⇒ 上限一改,兩支同步跟著走,MUST NOT 在此另寫一個係數。
 * @param s     這一次抽到的縮放  @param nomH s = 1 時的標稱高度  @param sMax 該處抽得到的最大縮放
 */
export const objScaleFit = (s, nomH, sMax) => (sMax > 0 ? s * (objScaleCap(sMax, nomH) / sMax) : objScaleCap(s, nomH));
/**
 * 遊戲最高高度(**絕對**高程,不是離地高):飛行機體與上帝視角的天花板唯一縫。
 * @param avgH  全圖平均海拔  @param peakH 全圖最高海拔(兩者皆取不到 ⇒ 退回 0 基準)
 */
export const worldCeilY = (avgH, peakH) => Math.max(
  (avgH || 0) + TARGET_H.tower * WORLD_H.CEIL_AVG_F,
  (peakH || 0) + TARGET_H.tower * WORLD_H.CEIL_PEAK_F,
);

// ---- 世界邊界:不可越過的障礙環 + 不可進入的緩衝空間(2026-08-10 使用者定案)----
// 使用者原話:「邊界加入不可越過的障礙,會再延伸可視距離但不可進入的緩衝空間」。
// 兩件事各有各的縫,而它們共用**同一條線** `edgeWallInsetM()`:
//   ①**障礙環**(`biomes.js buildEdgeWall`)= 沿四緣一圈**連續**的實體環,內緣恰好貼在
//     舊制那道空氣牆線上 ⇒ 地面機體是被**看得見的東西**擋下來的,不再是走到某處莫名停住。
//     環體是權威幾何(進 `blockers` ⇒ 客戶端 `_collide` + 伺服器 `occ`/LOS **同一個盒**,
//     A30);段與段**重疊**(`SEG_LAP_F > 1`)⇒「不可越過」是**結構保證**不是校準 ——
//     只要環上沒有縫,任何半徑的機體都穿不過去,不必回頭看最窄的那一台有多寬。
//   ②**緩衝空間**(`terrain.js` 的外緣裙)= 地形範圍**之外**再鋪一圈地,深度
//     `edgeBufferM()`。它不可進入是**既有的**保證(x/z 夾制與高度無關 ⇒ 飛行機體越過環頂
//     也照樣進不去),新增的只有「看得到」。
//
// **深度推導不手寫** = `curveHorizonM()`(世界曲面那一圈地平線)。理由是結構性的:曲面把
// 地表的視角極大值鎖在那個距離上,更遠的地面一律被較近的地面擋住 ⇒ 裙的外緣恰好落在
// 「再往外也看不到」的那一圈 ⇒ **地圖永遠不會露出硬邊**,而視點恆在障礙環之內(離地形邊
// 至少 `WALL_M`)⇒ 還多出那一段餘裕。手寫一個公尺數的下場是改了射程/塔/機體之後地平線
// 自己跑掉,而裙留在原地 —— 症狀是「某些場地站在邊界看得到世界的盡頭」,沒有任何錯誤訊息。
//
// **環高由機體全高推導**(`edgeWallHM`),而且**刻意不追飛行天花板**:物件上限只有
// `objHeightMax()`(4 × 砲塔高),天花板恆在它之上(WORLD_H 檔頭的結構不等式)⇒ 一道
// 「連飛的都翻不過去」的牆在這個專案裡不可能存在,而且真做出來也會把 ② 整個擋掉。
// 飛行那一半的權威一律是 `game.js` 的 x/z 夾制(高度無關),環只負責地面那一半。
// **2026-08-11 使用者定案「邊界牆使用城牆/連排民房/…等等」之後,環厚變成逐款的真實尺寸**
// (`edgewall.js WALL_KINDS[].depth`;貨輪 18m、懸崖 12m、列車 3.4m)。`WALL_T` 從此是**基準厚**,
// 最深的那一款由 `edgeWallDeepM()` 表達 —— 兩者的分工:
//   `WALL_T`        = 型錄還沒挑到之前的預設/基準(也是薄型式的量級)
//   `edgeWallDeepM` = **邊界帶要讓開多少**(`placeBoundary` 的 IN1 吃它)
// 稽核以「型錄裡最深的一款 === `edgeWallDeepM()`」雙向釘住:低報 = 邊界樓群長進船身,
// 虛胖 = 邊界帶被無謂地擠掉。內緣一律貼夾制線,厚度往圖界方向長 ⇒ 「沿邊沒有縫」不受影響。
export const WORLD_EDGE = {
  WALL_M: 40,        // 障礙環**內緣**的內縮量(公尺;= 舊制空氣牆線,夾制吃同一支)
  WALL_T: 6,         // 基準環厚(公尺):薄型式的量級,全在夾制線之外
  WALL_T_F: 3,       // 最深型式 = 基準厚 × 此比(現值 18m = 小型沿海貨輪的船寬)
  WALL_H_F: 1.6,     // 環高**下界** = 最高機體全高 × 此比(> 1 ⇒ 沒有任何機體看得到自己越過它)
  SEG_M: 24,         // 單段長度(公尺)= 一根碰撞柱;perimeter/SEG_M ≈ 200 段 ≪ LOS.MAX_OCC
  SEG_LAP_F: 1.06,   // 段長重疊係數(> 1 ⇒ 相鄰段互相咬住,環上結構性地沒有縫)
  BUFFER_F: 1,       // 緩衝深度 = 地平線距離 × 此比(MUST ≥ 1,見上)
};
/** 障礙環內緣 = 不可進入界線的內縮量(公尺)。`game.js` 的 x/z 夾制與環體佈置同吃這一支 */
export const edgeWallInsetM = () => WORLD_EDGE.WALL_M;
let _tallestH = 0;
/** 全場最高機體全高(公尺;`heroTargetH` 單一縫的上界)—— 環高的推導基準 */
export const heroTallestH = () => {
  if (_tallestH) return _tallestH;
  let h = 0;
  for (const ch of Object.keys(CHARACTERS)) h = Math.max(h, heroTargetH(charKind(ch), ch));
  _tallestH = h;
  return _tallestH;
};
/** 障礙環高的**下界**(公尺)。夾在物件高度上限之內(與建物/地標/巨岩共用同一個天花板) */
export const edgeWallHM = () => Math.min(objHeightMax(), heroTallestH() * WORLD_EDGE.WALL_H_F);
/** 最深型式的環厚(公尺)= 邊界帶要讓開的距離。單一縫,見上方檔頭 */
export const edgeWallDeepM = () => WORLD_EDGE.WALL_T * WORLD_EDGE.WALL_T_F;
/** 緩衝空間深度(公尺):地形範圍再往外鋪這麼遠的地。推導不手寫,見檔頭 */
export const edgeBufferM = () => curveHorizonM() * WORLD_EDGE.BUFFER_F;

// ---- 自機碰撞量體(2026-08-02 由 game.js 移入本檔)----
// 住 data.js 的理由與 hitR/hitH 相同:**伺服器也要用**。使用者定案「電腦玩家的碰撞法則一律跟
// 正常玩家一樣」⇒ bots.js 的移動走 `sim.solidResolve`,那支是客戶端 `_collide` 的鏡像,
// 兩端各寫一份係數就是「真人撞得到、電腦穿得過」(A30 家族的移動版)。
// climb.js 的 `MAX_BODY_R` 也 MUST 吃這一份(舊制在該檔手抄 0.317)。
// 係數校準自舊制觀感:robot 6m → myR 1.9 / eye 3.4、drone 3m → myR 1.6。
export const SELF_F = {
  groundR: 0.317, groundTop: 0.70, eye: 0.567,
  flyR: 0.533, flyBot: 0.267, flyTop: 0.40,
};
/**
 * 自機碰撞圓柱(**唯一縫**;客戶端 `game.js _collide`/`_sweepBlockers` 與伺服器
 * `sim.solidResolve` MUST 同吃這一支)。`H` = 機體實高(heroTargetH);`fly` = 飛行型態。
 * `bot`/`top` 是相對機體 y 的**偏移**(飛行型態的機腹在 y 之下)⇒ 垂直帶 = [y+bot, y+top]。
 */
export const selfCollider = (H, fly) => ({
  r: H * (fly ? SELF_F.flyR : SELF_F.groundR),
  bot: fly ? -H * SELF_F.flyBot : 0,
  top: H * (fly ? SELF_F.flyTop : SELF_F.groundTop),
});
// 「會擋住座機」的機種(客戶端 `COLLIDER` 與伺服器 `solidResolve` 同吃這一份鍵集)。
// MUST NOT 隨 TARGET_R 增列而擴張 —— 那會讓直升機/碉堡突然開始擋路;量體本身則永遠由
// hitR/hitH 推導,與命中判定同步。英雄不在此表(體型綁角色,逐機由 hitR/hitH 動態推導)。
export const COLLIDE_KINDS = ['base', 'tower', 'tank', 'apc', 'soldier'];

// ---- 戰鬥分數(kn;2026-08-11 使用者定案:八軌升級的第二道門檻,金錢之外還要打出戰績)----
// 助攻 +1 / 擊殺 +4;打「玩家(含電腦玩家)與砲塔」×HARD_F —— 硬目標才是戰績,刷小兵不算。
// 上限 MAX 分、**只增不減**(陣亡不扣、升級不消耗:它是資格不是貨幣)。
// 舊制的 KILL_SCORE 逐機種分數表與 BOT_KILL_SCORE(刷 bot 折價)一併退場 —— 使用者這一輪
// 明講「玩家(含電腦)」同一個係數,兩份分數表並存就是兩套規則。
export const BATTLE_SCORE = { MAX: 100, KILL: 4, ASSIST: 1, HARD_F: 5 };
/** 硬目標(玩家機體/電腦玩家機體/砲塔)倍率;其餘(小兵/碉堡/中立)×1 */
export const scoreHardF = (kind, hero) => (hero || kind === 'tower' ? BATTLE_SCORE.HARD_F : 1);
/** 這一次擊殺/助攻的得分(唯一縫:sim 的擊殺與助攻兩條路徑同吃) */
export const battleScoreGain = (kind, hero, assist = false) =>
  (assist ? BATTLE_SCORE.ASSIST : BATTLE_SCORE.KILL) * scoreHardF(kind, hero);
/** 累加(夾上限、只增不減) */
export const addBattleScore = (cur, gain) =>
  Math.min(BATTLE_SCORE.MAX, (cur || 0) + Math.max(0, gain || 0));

// 階級數值取值:陣列 = [Lv1, Lv2, Lv3, …];純量 = 各階相同。
// 2026-07-20 四面向升級(開場 Lv1 → 可升到 Lv4):超出資料階(Lv4+)沿「最後一段成長」線性外推 —
// 單一推導縫,免手寫 32 角色 × 每欄位的第 4 階(CLAUDE.md §2.1「推導值 MUST NOT 手寫」)。
// 遞增欄位(dmg/mag/rate)續增、遞減欄位(cd/reload/mul 折減)續減,夾 ≥0。
export const tierVal = (v, lvl = 1) => {
  if (!Array.isArray(v)) return v;
  const n = v.length, i = lvl - 1;
  if (i <= 0) return v[0];
  if (i < n) return v[i];
  const step = v[n - 1] - (v[n - 2] ?? v[n - 1]);   // 末段增量;長度 1 → step 0(純量化,不外推)
  return Math.max(0, v[n - 1] + step * (i - (n - 1)));
};

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

/** 角色武器的**解析後射程**(唯一縫;heroWeapon 與射程預算 rangeMid/rngDmgF 同吃 ——
 *  分兩份寫就會出現「計價用的射程」與「實戰射程」不同的無聲分歧)。 */
export function heroRange(ch, slot, heroic = true) {
  const w = CHARACTERS[ch]?.[slot];
  if (!w) return 0;
  return heroic ? Math.min(w.range * HEROIC.range, rangeCap(charKind(ch), slot)) : w.range;
}
/**
 * 解析角色武器(slot: 'light'|'heavy')在 lvl 階的實戰數值。
 * heroic=true 套用玩家英雄倍率(射程 ×1.2、傷害 ×1.5)並夾住 rangeCap;false = NPC 基準值。
 * 重武器以 mag 發彈夾 + reload 秒裝填實作(2026-07-18:彈夾 2~5、裝填 6~15s,取代舊「蓄力/單發 cd」)。
 * 無人機為單機(SQUAD.N=1),SQUAD.DMG=1 = 不折算(唯一折算點,保留機制;三機時代 = 1/3)。
 */
export function heroWeapon(ch, slot, lvl = 1, heroic = true) {
  const w = CHARACTERS[ch]?.[slot];
  if (!w) return null;
  const t = (v) => tierVal(v, lvl);
  const kind = charKind(ch);
  const squad = kind === 'drone' ? SQUAD.DMG : 1;
  return {
    id: slot, name: w.name, rw: w.rw, type: w.type, mv: w.mv,
    // counterDmgF:加成越多越廣泛 → 基礎傷害越低(推導不手寫;沒掛護盾軸的武器恆 ×1)
    // aoeTrimF:被「不得一次打到兩座塔」夾掉的範圍,照 areaValue 的價格還成火力(沒被夾過恆 ×1)
    // mobDmgF / rngDmgF:機動與射程越高 → 基礎火力越低(各以同儕的幾何中點為軸;推導不手寫)
    dmg: t(w.dmg) * counterDmgF(w) * aoeTrimF(w) * mobDmgF(ch) * rngDmgF(ch, slot)
      * (heroic ? HEROIC.dmg : 1) * squad,
    // w.range 已於下方統一縮放塊 ×COMBAT_SCALE(source 縮 reach);rangeCap 隨 UNITS.sight 同步縮 ⇒ 相對關係不變
    range: heroRange(ch, slot, heroic),
    rate: t(w.rate ?? RATE_DEF),   // rate 也可三階(s05 旋轉機砲);漏過 tierVal 會把陣列外洩給 UI/射速限制
    // rate0 = 射速壓縮**前**的射速(見 FIRE_RATE):連發演出 fireBurstN/fireBurstGap 的唯一依據。
    // 未被壓縮的武器沒有這一欄 ⇒ 退回 rate 本身 ⇒ N = 1 = 不做連發演出。
    rate0: t(w.rate0 ?? w.rate ?? RATE_DEF),
    mag: t(w.mag ?? 1),
    reload: t(w.cd ?? w.reload ?? 2),
    r: t(w.r), pen: t(w.pen ?? 0),
    // 暴擊:類型基準(w.crit/critX)夾下限(CRIT_MIN/CRITX_MIN)後,依階級線性成長(見 VITALS 上方註)
    crit: Math.max(VITALS.CRIT_MIN, t(w.crit ?? 0)) + VITALS.CRIT_PER_LVL * (lvl - 1),
    critX: Math.max(VITALS.CRITX_MIN, w.critX ?? VITALS.CRIT_X) + VITALS.CRITX_PER_LVL * (lvl - 1),
    emp: t(w.emp ?? 0),
    charge: t(w.charge ?? 0), guide: !!w.guide, arc: t(w.arc ?? 0),
    fan: !!w.fan || w.type === 'plasma',   // 扇形武器(散彈 / 電漿):錐狀判定 + 越近越高衰減
    recoil: recoilTier(w, slot === 'heavy' ? 'heavy' : 'light', !!w.fan || w.type === 'plasma'),
    needAim: slot === 'heavy' || !!w.needAim,
    vs: w.vs || {},
    // 護盾/裝甲分軌剋制(見 shieldSplit):刻意**不過 tierVal** —— 這是武器的性格不是火力,
    // 隨階級漂移會讓「反護盾」在 Lv1 與 Lv4 是兩把不同的武器。火力成長仍走 dmg 階梯。
    vsSp: w.vsSp ?? 1, vsHp: w.vsHp ?? 1, spPierce: w.spPierce || 0,
  };
}

/** 解析角色招式(slot: 'skill'|'ult')在 lvl 階的實戰數值 */
export function heroAbility(ch, slot, lvl = 1) {
  const a = CHARACTERS[ch]?.[slot];
  if (!a) return null;
  const t = (v) => tierVal(v, lvl);
  // 大招載具遞送(2026-08-06 使用者定案;見 ULT_CARRIER):carrier 大招的 cd 壓入 [30,60] 帶、
  // 未標 range 的支援型補上遞送距離 = hyperRange()(與機甲接戰距離同一把尺;不再 ×COMBAT_SCALE ——
  // hyperRange 已是縮好的遊戲公尺)。其餘欄位(dmg/heal/dur/mp/…)逐位元不動。
  // 2026-08-07:剩下 9 台自身強化型改由**跟隨玩家的輔助機隊**供輸(見 ULT_SUPPORT)⇒ 32 台大招
  // 全數載具化,只差形式。`support` 是伺服器分流的旗標,其餘欄位(含 cd)逐位元不動 ——
  // CD 帶 [30,60] 是 23 台「合併為一招」那一輪的仿射映射,把 9 台也壓進去會同時改掉 selfUltEq
  // 的分子(補償 ∝ cd)⇒ 一個改動同時動兩個平衡面,MUST NOT 順手併進來。
  // 2026-08-07 第二輪(使用者定案「小招也改為輔助機型模式,CD 時間 15~30s,從玩家身邊召喚;
  //   大招改為從最近的砲塔或主堡召喚」):載具制自此涵蓋**兩個槽位** ⇒ carrier/support 不再
  //   看 slot,只看 `abilDelivered` 這一支分類;差別全部收進 `abilOrigin`(發射點)與
  //   `abilCdMapped`(cd 要不要壓進該槽位的帶)。
  const carrier = abilDelivered(ch, slot);
  const support = !carrier;
  // 遞送距離的預設值只給**大招**:它是「從後方工事送到指定點」的戰略遞送 ⇒ 未標 range 的支援型
  //   要有一段可以指定的遞送距離(= hyperRange,與機甲接戰距離同一把尺)。小招從主機身邊召喚,
  //   遞送距離就是招式本來的 range(未標 = 施放在腳下)—— 補一個 186m 的預設等於**憑空**
  //   把三把團隊 buff / 兩把團隊治療小招變成遠端指定,那不是使用者要的(只換召喚方式)。
  const deliverR = carrier && slot === 'ult' && !a.range;
  return {
    id: slot, name: a.name, fx: a.fx, desc: a.desc, carrier, support,
    cd: abilCdMapped(ch, slot) ? abilCarrierCd(slot, t(a.cd)) : t(a.cd),
    mp: t(a.mp), dur: t(a.dur ?? 0), r: t(a.r ?? 0),
    dmg: t(a.dmg ?? 0) * counterDmgF(a), heal: t(a.heal ?? 0), count: t(a.count ?? 1),   // 折減見 heroWeapon 同欄註
    range: deliverR ? hyperRange() : t(a.range ?? 0) * COMBAT_SCALE,
    imp: t(a.imp ?? 0), scatter: t(a.scatter ?? 0),   // range 縮 reach;imp/scatter/r 為效果尺寸不縮
    unit: a.unit, target: a.target || 'self', sp: !!a.sp, vision: t(a.vision ?? 0) * COMBAT_SCALE,
    // 純自身型大招補償帶進來的三個新欄位(2026-08-06;見 SELF_ULT):
    //   regen 恢復速度倍率 / cleanse 解除並免疫異常 / revive 復活回場血量比例 / brk 被擊中即結束。
    // 未標註的角色一律得到 0/false ⇒ 其餘 28 台的 heroAbility 輸出逐位元不動。
    regen: t(a.regen ?? 0), cleanse: !!a.cleanse, revive: t(a.revive ?? 0), brk: !!a.brk,
    mul: a.mul ? Object.fromEntries(Object.entries(a.mul).map(([k, v]) => [k, t(v)])) : null,
    vs: a.vs || {},
    vsSp: a.vsSp ?? 1, vsHp: a.vsHp ?? 1, spPierce: a.spPierce || 0,   // 見 heroWeapon 同欄註
    pen: t(a.pen ?? 0),
    // 追加效果(2026-07-16):{fx:'pull|stun|slow|confuse|haste|leap|dodge|vamp|bleed|mark', 數值欄逐一過 tierVal}
    add: a.add ? Object.fromEntries(Object.entries(a.add).map(([k, v]) =>
      [k, typeof v === 'string' ? v : t(v)])) : null,
  };
}

/** 角色機體種類(不需要 side:2026-08-02 混編改制後**每名角色一律自帶 kind**)— heroWeapon 的折算依據。
 *  MUST NOT 再由 side 推機種:三陣營各自混編(蜂群 7/3/2、鋼鐵 3/7/2、傭兵 2/2/4),
 *  退路 'robot' 只是防呆,漏寫 kind 即為資料錯誤。 */
export const charKind = (ch) => CHARACTERS[ch]?.kind || 'robot';

/** 角色實戰護甲值:無人機等比縮放到「機甲平均 armor ×SQUAD.HP_F」(SQUAD.ARMOR_F,UNITS 後 derive);
 *  其餘機種照 mods.armor。套用點:sim._add 生成 + buy('ar') 升級,兩處共用此縫(客戶端體型仍讀原 mods.armor)。 */
export const heroArmor = (ch) => {
  const a = CHARACTERS[ch]?.mods?.armor ?? 0;
  return charKind(ch) === 'drone' ? a * SQUAD.ARMOR_F : a;
};

// 陣營可選角色池:專屬角色 + 傭兵(side:'MERC',雙陣營皆可受雇)
export const charsOf = (side) => Object.keys(CHARACTERS)
  .filter((id) => CHARACTERS[id].side === side || CHARACTERS[id].side === 'MERC');

/** 角色機體種類:kind 一律綁角色(機種不隨陣營);查無角色才退回 SIDES 主力機種 */
export const heroKindOf = (ch, side) => CHARACTERS[ch]?.kind || SIDES[side].hero;

// ---- 角色圖鑑(24 名陣營角色 + 8 名傭兵;劇情設定見 docs/characters.md)----
// 每名角色 = 專屬機體(**kind 一律顯式標註**)+ 輕武器 + 重武器(CD)+ 小招 + 大招。
// 2026-08-02 機體混編改制(使用者定案):陣營不再等於機種,每個陣營三種機體都有 ——
//   蜂群 無人機 7 / 機甲 3 / 變形機甲 2、鋼鐵 無人機 3 / 機甲 7 / 變形機甲 2、傭兵 無人機 2 / 機甲 2 / 變形機甲 4。
//   **角色的陣營不變**,移動的是「機體」:每具機體的原型(仿生/現實)配到與該陣營國家相稱的駕駛員身上,
//   例:袋鼠機甲 → 蜂群(駕駛員國籍改澳洲)、孫悟空變形機甲 → 鋼鐵(駕駛員國籍為中國)、
//       龍/翼龍無人機 → 鋼鐵(東亞)、Shahed 三角翼 → 鋼鐵(伊朗)、恐龍系機甲 → 傭兵(不結盟市場)。
//   機體設計共 12 無人機 / 12 機甲 / 8 變形機甲,**每款恰好被一名角色使用一次**(改動 MUST 維持 1:1)。
//   武器/招式跟著**角色**走(不跟機體)⇒ 兩陣營的武器型別與招式家族覆蓋率不受混編影響;
//   但「換機種 = 換底盤」:EHP(UNITS[kind] + heroArmor 折算)、機動、射程上限(rangeCap ← sight)、
//   閃避(飛行才有)與 `CLASS_SYM` 分組全部跟著變 ⇒ 14 名換機種的角色 MUST 重新校準。
//   校準只走兩個旋鈕(逐武器手改 `vs` 仍是禁令):`mods` 與該角色的 `dmg` 階梯。
//   換到無人機(t07/t08/t09/m03/m04)= 白拿飛行閃避 + 較長的射程上限 ⇒ 火力階梯下修;
//   換到機甲/變形機甲(s06/s07/s09/s10/s12/t06/t11/m02/m06)= 失去上述 ⇒ 火力階梯上修。
//   s01/s02/s05/s08/s11 未換機種但同池水位被墊高,收尾各修一階(見 `npm run bal` ①⑤)。
// 武器參考現實原型(rw 註明原型與初速);傷害/射程為 NPC 基準值,
// 玩家英雄實戰值 = 基準 × HEROIC(射程 1.2 / 威力 1.5),一律走 heroWeapon() 解析。
// mods:hp/sp/mp/speed 為倍率,armor 為護甲值(裝甲層減免用)。
// visual:程序生成機體外觀參數(hue 主色;無人機 frame/body(座艙沿用)、機甲 pod 掛件;
//         2026-07-10 外觀改制(doc/image 賽璐璐重構,無人機/機甲各三型等比例):
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
//         變形機甲 morph 用 flight(飛行型:jet 戰機/uav 固定翼/heli 直升機/tilt 傾轉旋翼/
//         levi・archo・beetle・owl 擬態翼)+ ground(地面型:人形四體態 wolf 狼人趾行/
//         vampire 吸血鬼挺立(披風即機翼)/monkey 猿猴蹲伏(多節長尾)/atlas 負重前傾(雙肩掛架);
//         四足獸 elephant/raptor/beetle/panther)+ bulk 體格倍率 — 純外觀,不動數值)。
//         paint(2026-07-11 塗裝改制):機體裝甲色版一律由 hue 推導(paint.js heroPalette),
//         再依角色性格印上程序花紋 — minimal 制式極簡 / camo 迷彩 / graffiti 街頭塗鴉 /
//         tattoo 線描刺青 / totem 民族圖騰 / flag 旗幟徽記。花紋以「靜止姿勢的機體局部座標」
//         三平面投影(paint.js paintUnit),鎖在裝甲板上不隨關節游移。
// fx 一覽:buff(增益)/ heal(維修)/ strike(打擊)/ summon(召喚)/ emp(癱瘓)
//          / vision(視野)/ stealth(匿蹤)/ dash(突進)/ intercept(攔截飛彈)。
// 招式追加效果 add(2026-07-16):攻擊性招式全面小幅降傷(strike 約 −15%、增益 dmg 倍率 −0.05),
// 換取一項追加效果;數值欄吃 [L1,L2,L3] 階梯,解析在 heroAbility、結算唯一縫 = sim.heroCast/_applyCC:
//   控場(strike 彈著區 r×1.5 內敵人;建築/無敵幀免疫):pull 拉近彈著中心(imp 衝量)/
//     stun 麻痺(禁移動、武器照常 —— 與 EMP「武器離線、可移動」互補)/ slow 緩速(f 移速倍率)/
//     confuse 混亂(玩家操縱反轉、NPC 沿線倒退)
//   走位(掛在增益招式上,走 mods 通道 [{k,m,until}]):haste 衝鋒(k:'speed' 移速倍率)/
//     leap 大跳躍(k:'jump' 跳躍初速倍率)/ dodge 完美迴避(k:'dodge',直射武器必閃)/
//    (隱形 = 既有 stealth 招式,不另設 add)
//   其他:vamp 吸血(k:'vamp',實際造成傷害 × f 回自身裝甲)/ bleed 出血(DoT,dps×dur,
//     擊殺計給施放者)/ mark 定位(markUntil:下一擊必中 —— 無視閃避 —— 且必爆;
//     消耗路徑只在 heroHit 直擊 —— fan/launcher/missile AoE 武器的角色 MUST NOT 掛 mark)
// 武器 type 一覽(2026-07-11 機制多元化;傷害距離衰減見 dmgFalloff):
//   gun      動能彈:彈道學拋物線,動能隨空阻衰減
//   rail     磁軌炮:極速直擊(幾乎無衰減、高破甲);2026-07-18 取消蓄力,改彈夾連發
//   launcher 火箭/榴彈:AoE 戰鬥部;guide:1 = 狙擊視角雷射導引(彈體追準星修正航向)
//   missile  飛彈:發射時有準星鎖定 → 自動追蹤該目標近炸;無鎖定 = 直飛(AoE 戰鬥部)
//   beam     定向能:光速直擊無下墜,穩定輸出;吃大氣消光;emp 附帶 = 電磁癱瘓控場
//   plasma   電漿:扇形 arc(半角度°)大面積,範圍內敵人全數命中(伺服器結算),消散快、射程短
// 重武器範圍攻擊三分類(blast/fan/line)與彈道五分類(lob/flat/line/guide/fnf)見上方
//   aoeClass() / trajClass() —— 重武器一律屬於三分類之一,rail/gun/beam 重武器走 sim.heroLance
//   圓柱貫穿(輕武器不變,仍是單體 heroHit)。
// 扇形武器(fan:電漿 / 散彈 shotgun):dmgFalloff 走 fanFalloff(越近越高)、sim.heroPlasma 錐判定。
// 輕武器類型(2026-07-13 多元化;2026-07-14 開放散彈):launcher/missile 在 heroBurst、
//   plasma/fan 在 heroPlasma —— heroPlasma 已收 slot 參數,故「散彈輕武器(fan:true)」可經
//   {t:'plasma', slot:'light'} 走同一條錐判定(唯一破例;launcher/missile 仍只准重武器)。
//   非扇形輕武器(gun/rail/beam)照走 heroHit(slot 無關)。2026-07-18:重武器全面取消蓄力(charge),
//   改「彈夾 2~5 發 + 裝填 6~15s」(依型別,見 heroWeapon 上方各型 mag/reload 設計);rail 亦不再有蓄力窗。
export const CHARACTERS = {
  // ================= 蜂群陣營(無人機)=================
  s01: {
    side: 'SWARM', kind: 'drone', name: '卡特琳娜・薛甫琴科', code: '蜂后', machine: '「第聶伯總譜」指揮型六旋翼',
    visual: { hue: 0xffd257, frame: 'hexa', body: 'box', form: 'avian', creature: 'bee', paint: 'natflag', flag: [0xffd700, 0x0057b7] },
    mods: { hp: 1.0, sp: 1.15, mp: 1.15, speed: 0.95, armor: 6 },
    light: { name: '雙聯 5.56 機槍艙', rw: 'FN Minimi・初速 915m/s', type: 'gun', mv: 915,
      dmg: [11, 14, 17], rate: 10, mag: [40, 50, 60], reload: 2.0, range: 190, crit: 0.06,
      vs: { flesh: 1.2, armor: 0.6, air: 1.3, building: 0.5 } },
    heavy: { name: '70mm 導引火箭巢', rw: 'Hydra 70 + APKWS 雷射導引・初速 700m/s', type: 'launcher', mv: 700, guide: 1,
      dmg: [49, 75, 109], r: [12, 14, 16], mag: 3, reload: 12, range: 300, pen: 6,
      vs: { flesh: 1.1, armor: 1.4, air: 0.5, building: 1.2 } },
    skill: { name: '蜂群協奏', fx: 'buff', target: 'team', r: 180, mul: { dmg: [1.15, 1.23, 1.3] },
      add: { fx: 'vamp', f: [0.1, 0.13, 0.16] },
      dur: [6, 8, 10], cd: 20, mp: [35, 40, 45], desc: '指揮頻道開啟:友軍火力提升,蜂群回收戰果(吸血)' },
    ult: { name: '總譜:終樂章', fx: 'summon', unit: 'heli', count: [2, 3, 4],
      cd: [80, 70, 60], mp: [80, 90, 100], desc: '呼叫攻擊直升機編隊沿最近兵線壓上' },
  },
  s02: {
    side: 'SWARM', kind: 'drone', name: '塔拉斯・邦達爾', code: '鐵匠', machine: '「鐵匠鋪」重載運翼機',
    visual: { hue: 0xc98a3d, frame: 'hexa', body: 'slab', paint: 'minimal' },
    mods: { hp: 1.2, sp: 0.9, mp: 0.9, speed: 0.85, armor: 12 },
    light: { name: '12.7 重機艙', rw: 'DShK・初速 850m/s', type: 'gun', mv: 850,
      // crit 0 = 類型基準(重機槍低暴擊);2026-07-25 起 heroWeapon() 夾 CRIT_MIN 5% ⇒ 實戰 ≥5%。
      // e2e 的 s02/t01 確定性傷害斷言改用 Math.random 樁固定不觸發暴擊(不再依賴 crit:0)。
      dmg: [15, 19, 23], rate: 5, mag: [30, 36, 42], reload: 2.4, range: 200, crit: 0, pen: 6,
      vs: { flesh: 1.2, armor: 1.1, air: 0.9, building: 0.7 } },
    // range 275(2026-07-14):解析後 = min(275×1.2, cap) = 330m —— 全機種「最短的重武器」,
    // 剛好越過砲塔射程 310m 約 20m(使用者指示:重武器可在砲塔射程外拆塔,最短者僅稍遠一點點)。
    // 電漿扇形重武器(180~210m)是刻意的近戰例外,不在此列。
    // 榴彈類(trajClass 'lob')射程一律 = 全表最短的那一帶(= 扇形 264;見 AREA_WEAPONS 檔頭
    // 2026-08-04 定案)—— 吊射的大範圍換的就是「得走進去打」。r 由家族帶夾制(BLAST_BAND)。
    heavy: { name: '溫壓火箭', rw: 'TBG-7V・初速 120m/s', type: 'launcher', mv: 120,
      // dmg −5%:讓出 15m 爆風換回的火力補償(aoeTrimF)把它推到 bal ⑤ 81% 出界(見 t02 heavy 同欄註)
      dmg: [48, 69, 100], r: [15, 17, 19], mag: 3, reload: 12, range: 264, pen: 15,
      vs: { flesh: 1.4, armor: 1.3, air: 0.4, building: 2.0 } },
    skill: { name: '野戰搶修', fx: 'heal', target: 'self', heal: [180, 260, 340],
      cd: [24, 21, 18], mp: [35, 40, 45], desc: '焊槍出手:立即修復自身裝甲' },
    ult: { name: '蜂巢再鑄', fx: 'heal', target: 'team', r: 200, heal: [220, 300, 380], sp: true,
      cd: [80, 70, 60], mp: [85, 95, 105], desc: '半徑內友軍裝甲大修,護盾同步充滿' },
  },
  s03: {
    // 2026-08-03 使用者定案「台灣換成變形者(迅猛龍 + 始祖鳥)」:接下原屬 s12 的
    // 「始祖鳥 ↔ 迅猛龍」變形機甲。**機體欄整組互換、角色欄一格不動**(CLAUDE.md §2.1 角色機種:
    // 機體換手時 kind/visual 的機體欄、mods、models.js MOVE_SIG/CAST_SIG、lore proto/bond 跟著搬;
    // 武器/招式/塗裝(hue + paint)綁角色不動)。**mods 整組隨機體搬**是刻意的:這樣
    // drone/morph 兩個機種池的 mods 多重集逐位元不變 ⇒ UNITS.drone.hp / SQUAD.ARMOR_F /
    // SQUAD.DRONE_AVG_HP 三個推導值完全不動,只剩 CLASS_SYM 的分組會位移(bal ⑤ 已複驗)。
    // 塗裝 paint:'tattoo' 留在她身上正好:那張徽是「對稱線描羽紋」——始祖鳥化石上的羽印。
    side: 'SWARM', kind: 'morph', name: '林翎', code: '半羽', machine: '「羽陣」始祖式可變機甲',
    visual: { hue: 0x9ef2e6, pod: 'antenna', flight: 'archo', ground: 'raptor', bulk: 0.85, paint: 'tattoo' },
    mods: { hp: 0.9, sp: 1.1, mp: 1.15, speed: 1.15, armor: 8 },
    // 2026-08-03 換機體後的 dmg 校準(唯一合法的旋鈕,見 §2.1 三軸預算:「校準只走 dmg 階梯」)。
    // 她從無人機底盤換到變形機甲底盤 ⇒ rangeCap 由 sight 270 掉到 240,輕武器解析射程 114 → 108m
    // (重武器 168m 兩邊都沒被夾,不受影響)。射程是 ⑦ 量到最貴的一軸,而她的重武器又是全表
    // **總傷害最低**的那一把(反護盾的設計代價:vsSp 1.7 / vsHp 0.7 再吃 counterDmgF)⇒ 換完之後
    // bal ⑤ 掉到 17% < 20% 下界。**補在輕武器而不是重武器**:重武器的低總傷害是護盾軸的定價本身,
    // 動它等於把那筆交易改掉;輕武器沒掛任何護盾旗標,是乾淨的基礎火力。
    light: { name: '翼面相位脈衝槍', rw: '翼緣相控陣・光速直擊', type: 'beam',
      dmg: [15, 19, 24], rate: 9, mag: [36, 44, 52], reload: 1.9, range: 190, crit: 0.06,
      vs: { flesh: 1.2, armor: 0.7, air: 1.3, building: 0.5 } },
    // 護盾軸示範 ①【反護盾】:HPM 微波把能量灌進護盾場直接燒穿,對裝甲板卻幾乎只是加熱 ——
    // 開場兩發剝光對手護盾,之後就得換輕武器慢慢磨(見 data.js shieldSplit 上方註)。
    // **原本的 air 2.0 由夾制②自動歸 1**(反護盾不得有其他單位加成)—— 這裡刻意留著原值不手改:
    // 紀律是程式在管,寫死 1.0 反而看不出「這把武器本來被拿掉了什麼」。
    heavy: { name: '羽冠高功率微波炮', rw: 'HPM 定向能・光速', type: 'beam',
      dmg: [21, 31, 44], mag: 5, reload: 8, range: 280, emp: [0.8, 1.0, 1.2],
      vsSp: 1.7, vsHp: 0.7,
      vs: { flesh: 0.7, armor: 0.8, air: 2.0, building: 0.4 } },
    skill: { name: '定向干擾', fx: 'emp', r: 120, dur: [2.5, 3, 3.5], range: 260,
      cd: [18, 16, 14], mp: [40, 45, 50], desc: '頸羽同相位對準:指定區域敵軍武器離線(建築免疫)' },
    ult: { name: '全頻壓制', fx: 'emp', r: 260, dur: [4, 5, 6],
      cd: [70, 62, 54], mp: [90, 100, 110], desc: '全身羽面一起起振:以自身為中心的大範圍電子壓制' },
  },
  s04: {
    side: 'SWARM', kind: 'drone', name: '樫村蒼真', code: 'Kashi', machine: '「鐵鍬」零式突擊翼',
    visual: { hue: 0xd6d63a, body: 'box', form: 'fixed', wing: 'zero', paint: 'hinomaru' },  // 純黃素色;雙翼正反面各一枚紅日
    mods: { hp: 1.1, sp: 1.0, mp: 0.95, speed: 1.05, armor: 8 },
    light: { name: '戰鬥霰彈莢艙', rw: 'Benelli M4・初速 400m/s', type: 'gun', mv: 400, fan: true, arc: [16, 14, 12],
      dmg: [34, 42, 52], rate: 2.2, mag: [7, 8, 10], reload: 2.6, range: 170, crit: 0.10, critX: 1.5,
      vs: { flesh: 1.6, armor: 0.5, air: 1.2, building: 0.4 } },
    heavy: { name: '電漿噴湧砲', rw: '磁化電漿投射・扇形噴焰', type: 'plasma', arc: [13, 15, 17],
      dmg: [46, 75, 117], mag: 3, reload: 7, range: 264, pen: 8,
      vs: { flesh: 1.5, armor: 1.0, air: 0.5, building: 1.2 } },
    skill: { name: '突進機動', fx: 'dash', imp: [28, 34, 40],
      cd: [12, 10, 8], mp: [25, 30, 35], desc: '沿視線方向爆發加速(教官の鐵鍬距離)' },
    ult: { name: '白刃時刻', fx: 'buff', target: 'self', mul: { dmg: [1.35, 1.45, 1.55], dmgTaken: [0.85, 0.8, 0.75] },
      add: { fx: 'haste', f: [1.25, 1.3, 1.35] },
      dur: [8, 10, 12], cd: [70, 60, 50], mp: [75, 85, 95], desc: '近接教官進入戰鬥反射狀態,衝鋒突臉' },
  },
  s05: {
    side: 'SWARM', kind: 'drone', name: '河瑟琪', code: 'Overclock', machine: '「超頻」競速 FPV',
    visual: { hue: 0xff6fb0, frame: 'quad', body: 'wedge', paint: 'minimal' },
    mods: { hp: 0.85, sp: 1.1, mp: 1.1, speed: 1.2, armor: 3 },
    light: { name: '微型軌道轉輪砲', rw: '實驗性線性感應馬達・初速 1400m/s', type: 'rail', mv: 1400,
      dmg: [9, 11, 14], rate: [14, 16, 18], mag: [70, 90, 110], reload: 2.8, range: 180, crit: 0.05,
      vs: { flesh: 1.2, armor: 0.6, air: 1.4, building: 0.4 } },
    heavy: { name: '巡飛彈釋放器', rw: 'Lancet 縮裝・巡飛 90m/s', type: 'missile', mv: 90,
      dmg: [44, 63, 88], r: [13, 15, 17], mag: 4, reload: 11, range: 320, pen: 12,
      vs: { flesh: 1.0, armor: 1.6, air: 0.6, building: 1.1 } },
    skill: { name: '超頻', fx: 'buff', target: 'self', mul: { dmg: [1.05, 1.1, 1.15], reload: [0.65, 0.6, 0.55] },
      add: { fx: 'dodge' },
      dur: [6, 7, 8], cd: [18, 16, 14], mp: [30, 35, 40], desc: 'APM 全開:填彈大幅加速,競速走位完美迴避直射' },
    ult: { name: '蜂群風暴', fx: 'strike', count: [6, 8, 10], dmg: [60, 77, 94], r: 10, scatter: 30,
      add: { fx: 'confuse', dur: [1.5, 2, 2.5] },
      range: 320, pen: 8, cd: [70, 62, 54], mp: [85, 95, 105], vs: { armor: 1.3, building: 1.1 },
      desc: '呼叫 FPV 蜂群對指定區域飽和俯衝,纏擾致盲(混亂)' },
  },
  s06: {
    // 2026-08-02 機體混編:接下原屬鋼鐵的「半人馬」四足機甲(希臘神話的凱隆 —— 教人療傷的射手,
    // 不是獵人)。四足射擊平台把她的精準軌道步槍鎖死,上半身空出來的雙手才是她真正要的:擋。
    side: 'SWARM', kind: 'robot', name: '瑪雅・柯爾曼', code: '悼歌', machine: '「輓歌」凱隆式護衛機甲',
    visual: { hue: 0xb9c7ff, pod: 'rack', form: 'beast', creature: 'centaur', paint: 'minimal' },
    mods: { hp: 1.0, sp: 1.2, mp: 1.1, speed: 1.0, armor: 16 },
    light: { name: '精準軌道步槍艙', rw: '實驗性磁軌步槍・初速 1600m/s', type: 'rail', mv: 1600,
      dmg: [27, 34, 42], rate: 3, mag: [15, 18, 21], reload: 2.2, range: 230, crit: 0.15, critX: 1.8,
      vs: { flesh: 1.2, armor: 0.8, air: 1.5, building: 0.5 } },
    // r 6 → 8(2026-08-02 機體混編):她從飛行機體換到地面四足平台,sight 270 → 240 ⇒ 重武器解析
    // 射程 194 → 173m,導引頭在「剛解除保險」的近帶只剩約 26m 修正距離(audit_weapon_gate Ⅵ 的
    // s06@50% 由此翻紅)。核心帶 6 → 8m 把承諾(射程光暈)拉回實際彈道,仍是全機種最小的戰鬥部。
    heavy: { name: '微型攔截彈', rw: 'AIM-9X 縮裝・初速 1000m/s', type: 'missile', mv: 1000,
      dmg: [45, 68, 102], r: [8, 9, 10], mag: 4, reload: 11, range: 340, pen: 6,
      vs: { flesh: 0.6, armor: 0.6, air: 2.5, building: 0.3 } },
    skill: { name: '攔截領域', fx: 'intercept', r: [150, 190, 230],
      cd: [16, 14, 12], mp: [30, 35, 40], desc: '擊落半徑內所有來襲飛彈(擋下的,不是打掉的)' },
    ult: { name: '空白布章', fx: 'buff', target: 'team', r: 220, mul: { dmgTaken: [0.6, 0.5, 0.4] },
      dur: [6, 7, 8], cd: [75, 65, 55], mp: [85, 95, 105], desc: '護航誓約:半徑內友軍承傷大減' },
  },
  s07: {
    // 2026-08-02 機體混編:接下原屬鋼鐵的「頭足類」四足機甲 —— 四觸手步行、四觸手持械,
    // 掛載恆為偶數,正好對上他「演算法一律雙發齊射」的執念(非歐幾何的機體,給非歐幾何的數學家)。
    side: 'SWARM', kind: 'robot', name: '埃坦・沙哈', code: '鐵證', machine: '「證明完畢」八臂防空機甲',
    visual: { hue: 0x7fd8ff, pod: 'dish', form: 'beast', creature: 'cthulhu', paint: 'totem' },
    mods: { hp: 1.05, sp: 1.1, mp: 1.1, speed: 0.9, armor: 18 },
    light: { name: '25mm 空爆機砲', rw: 'XM25 派生・初速 760m/s', type: 'gun', mv: 760,
      dmg: [20, 25, 31], rate: 6, mag: [24, 30, 36], reload: 2.3, range: 210, crit: 0.06,
      vs: { flesh: 1.3, armor: 0.7, air: 1.6, building: 0.5 } },
    heavy: { name: '防空散射矩陣', rw: '磁化電漿・扇形防空散布', type: 'plasma', arc: [20, 23, 26],
      dmg: [50, 77, 113], mag: 3, reload: 7, range: 264, pen: 4,
      vs: { flesh: 0.9, armor: 0.6, air: 2.0, building: 0.4 } },
    skill: { name: '分配演算法', fx: 'intercept', r: [170, 210, 250],
      cd: [15, 13, 11], mp: [30, 35, 40], desc: '一道證明完畢:清空半徑內來襲飛彈' },
    ult: { name: '飽和反擊', fx: 'strike', count: [5, 7, 9], dmg: [68, 85, 106], r: 11, scatter: 35,
      add: { fx: 'slow', f: 0.6, dur: [2, 2.5, 3] },
      range: 340, pen: 6, cd: [72, 64, 56], mp: [85, 95, 105], vs: { air: 1.5, armor: 1.1 },
      desc: '攔截網反向齊射:破片撕裂操縱面(緩速)' },
  },
  s08: {
    side: 'SWARM', kind: 'drone', name: '佐菲亞・馬列克', code: '聖燭', machine: '「燭台」醫療運補機',
    visual: { hue: 0xe8f0f4, frame: 'coax', body: 'sphere', paint: 'flag' },
    mods: { hp: 1.0, sp: 1.15, mp: 1.25, speed: 1.0, armor: 5 },
    light: { name: '護航機槍艙', rw: 'PKM 7.62・初速 825m/s', type: 'gun', mv: 825,
      dmg: [14, 18, 22], rate: 7, mag: [36, 44, 52], reload: 2.1, range: 190, crit: 0.06,
      vs: { flesh: 1.3, armor: 0.7, air: 1.1, building: 0.5 } },
    heavy: { name: '同步軌道狙擊砲', rw: '實驗性電磁狙擊系統・初速 2200m/s', type: 'rail', mv: 2200,
      dmg: [66, 99, 149], mag: 2, reload: 8, range: 360, crit: 0.25, critX: 2.0, pen: [16, 20, 24],
      vs: { flesh: 1.4, armor: 0.8, air: 1.4, building: 0.4 } },
    skill: { name: '血漿空投', fx: 'heal', target: 'team', r: 140, heal: [150, 210, 270],
      cd: [20, 18, 16], mp: [40, 45, 50], desc: '空中血庫開倉:半徑內友軍裝甲回復' },
    ult: { name: '修道院鐘聲', fx: 'heal', target: 'team', r: 240, heal: [280, 380, 480], sp: true,
      cd: [85, 75, 65], mp: [90, 100, 110], desc: '大範圍野戰醫療:裝甲大量回復、護盾充滿' },
  },
  s09: {
    // 2026-08-02 機體混編:「袋鼠」機甲轉入蜂群(使用者定案 —— 袋鼠是澳洲的機體),
    // 駕駛員國籍隨之改為澳洲(見 lore.js s09:內陸大牧場的獵場主,不再是英國子爵)。
    // 跟腱儲能的躍步底盤 = 打完就換陣地的防空獵手,和他「一發撂一架、換膛的停頓分毫不差」是同一套節奏。
    side: 'SWARM', kind: 'robot', name: '艾德蒙・惠特洛克', code: '獵場主', machine: '「獵場看守人」躍步防空機甲',
    visual: { hue: 0xd0602f, pod: 'rack', form: 'biped', creature: 'roo', paint: 'split', split: 'shade' },  // 鏽橙同色系:反蔭 —— 面朝上=背深、面朝下=腹淺
    mods: { hp: 1.05, sp: 1.15, mp: 1.0, speed: 1.05, armor: 18 },
    light: { name: '雙管防空霰彈', rw: 'Purdey 12 鉛徑改・初速 420m/s', type: 'gun', mv: 420, fan: true, arc: [18, 16, 14],
      dmg: [34, 43, 53], rate: 2.6, mag: [8, 10, 12], reload: 2.4, range: 170, crit: 0.10, critX: 1.5,
      vs: { flesh: 1.3, armor: 0.4, air: 2.0, building: 0.3 } },
    heavy: { name: '獵狐飛彈', rw: 'Starstreak 縮裝・雷射波束導引・初速 300m/s', type: 'launcher', mv: 300, guide: 1,
      dmg: [76, 112, 165], r: [13, 15, 17], mag: 3, reload: 12, range: 320, pen: 10,
      vs: { flesh: 0.9, armor: 1.2, air: 1.8, building: 0.8 } },
    // mark 只在 heroHit(直擊彈道)有消耗路徑 —— s09 雙武器是 fan 散彈(heroPlasma)+ launcher
    // (heroBurst),掛 mark 等於死效果,2026-07-16 改 haste(獵手加速追獵)
    skill: { name: '好球!', fx: 'buff', target: 'self', mul: { dmg: [1.25, 1.35, 1.45] },
      add: { fx: 'haste', f: [1.2, 1.25, 1.3] },
      dur: 6, cd: [18, 16, 14], mp: [30, 35, 40], desc: '紳士的開獵宣言:火力增幅、健步追獵' },
    ult: { name: '獵場封鎖', fx: 'strike', count: [8, 10, 12], dmg: [51, 64, 77], r: 9, scatter: 40,
      add: { fx: 'pull', imp: [16, 20, 24] },
      range: 300, cd: [70, 62, 54], mp: [80, 90, 100], vs: { air: 2.0, flesh: 1.2 },
      desc: '獵網彈幕封鎖指定空域,獵物向彈著中心收攏(拉近)' },
  },
  s10: {
    // 2026-08-02 機體混編:接下原屬傭兵的「飛鯨↔機械巨象」變形機甲 —— 鯨歌與象的次聲波是
    // 自然界最遠的兩種通訊,象耳就是天線。她原本的機體註記寫著「別人的機體是拳頭,她的是一隻豎起來的耳朵」。
    side: 'SWARM', kind: 'morph', name: '卡佳・塔姆', code: '白噪音', machine: '「靜電」長耳可變訊號機',
    visual: { hue: 0xd7b8ff, pod: 'antenna', flight: 'levi', ground: 'elephant', bulk: 0.95, paint: 'minimal' },
    mods: { hp: 0.9, sp: 1.2, mp: 1.3, speed: 1.05, armor: 8 },
    light: { name: '低功率脈衝雷射槍艙', rw: '抑制型雷射訊號步槍・光速直擊', type: 'beam',
      dmg: [16, 20, 24], rate: 9, mag: [30, 36, 42], reload: 1.8, range: 170, crit: 0.08,
      vs: { flesh: 1.4, armor: 0.5, air: 1.1, building: 0.4 } },
    heavy: { name: '訊號矛', rw: 'EMP 狙擊彈・初速 900m/s', type: 'gun', mv: 900,
      dmg: [42, 64, 94], mag: 3, reload: 9, range: 340, emp: [1.5, 2, 2.5],
      vs: { flesh: 0.8, armor: 1.0, air: 1.8, building: 0.5 } },
    skill: { name: '頻譜側錄', fx: 'vision', vision: [6, 8, 10],
      cd: [26, 23, 20], mp: [35, 40, 45], desc: '破解敵方遙測:全隊限時無霧視野' },
    ult: { name: '拒絕服務', fx: 'emp', r: 300, dur: [4, 5, 6],
      cd: [75, 65, 55], mp: [90, 100, 110], desc: '大範圍鏈路壓制,聽起來就很假' },
  },
  s11: {
    side: 'SWARM', kind: 'drone', name: '維爾納・哈特曼', code: '鐘匠', machine: '「錶芯」精密工作機',
    visual: { hue: 0xd8c690, frame: 'wing', body: 'frame', form: 'fixed', wing: 'vtail', paint: 'minimal' },
    mods: { hp: 1.0, sp: 1.05, mp: 1.05, speed: 0.95, armor: 8 },
    light: { name: '精密聚焦雷射步槍', rw: '低散射固態雷射・光速直擊', type: 'beam',
      dmg: [16, 20, 24], rate: 3.5, mag: [20, 24, 28], reload: 2.1, range: 220, crit: 0.12, critX: 1.8, pen: 6,
      vs: { flesh: 1.1, armor: 1.3, air: 1.0, building: 0.6 } },
    heavy: { name: '關節破壞者', rw: '實驗性 EM 磁軌・初速 2000m/s', type: 'rail', mv: 2000,
      dmg: [48, 70, 99], mag: 2, reload: 8, range: 380, crit: 0.15, critX: 2.0, pen: [25, 30, 35],
      vs: { flesh: 0.8, armor: 2.2, air: 1.2, building: 0.7 } },
    skill: { name: '弱點解析', fx: 'buff', target: 'self', mul: { dmg: [1.3, 1.4, 1.5] },
      add: { fx: 'mark', dur: [4, 5, 6] },
      dur: [5, 6, 7], cd: [18, 16, 14], mp: [35, 40, 45], desc: '我造了那個膝蓋:下一擊必中必爆' },
    ult: { name: '大修', fx: 'heal', target: 'self', heal: [400, 550, 700], sp: true,
      cd: [80, 70, 60], mp: [80, 90, 100], desc: '鐘錶匠的手:自身裝甲大修、護盾充滿' },
  },
  s12: {
    // 2026-08-03 台灣變形者定案的另一半:把「始祖鳥↔迅猛龍」讓給 s03,自己接下她那架鴨翼定翼機。
    // 換得比看起來合理 —— 星象導航要的是**穩定的視軸**,撲翼機每一拍都在晃,而鴨翼給的正是
    // 高攻角安定性:機身一邊急轉,星象儀一邊維持指向。他的偵察本來就分兩段(先用腳走過、
    // 再從天上核對一遍),讓出撲翼收爪那一段,換來整夜不落地的長航時。
    side: 'SWARM', kind: 'drone', name: '埃米爾・賽伊托夫', code: '歸鄉', machine: '「星圖」鴨翼長航偵察機',
    visual: { hue: 0x9db8d8, frame: 'wing', body: 'wedge', form: 'fixed', wing: 'canard', paint: 'totem' },
    mods: { hp: 0.9, sp: 1.25, mp: 1.3, speed: 1.0, armor: 4 },
    light: { name: '偵察卡賓艙', rw: 'AKS-74U・初速 735m/s', type: 'gun', mv: 735,
      dmg: [16, 20, 25], rate: 8, mag: [30, 36, 42], reload: 1.9, range: 180, crit: 0.08,
      vs: { flesh: 1.3, armor: 0.6, air: 1.1, building: 0.4 } },
    heavy: { name: '星象測距雷射砲', rw: '高能雷射測距一體・光速直擊', type: 'beam',
      dmg: [44, 68, 102], mag: 5, reload: 8, range: 320, pen: [10, 13, 16],
      // range 320 MUST NOT 因為換機種而下修:bal ④ 要求**每一名無人機**的重武器解析射程 > 砲塔
      // (站外攻堅是無人機的生存方式)。他從變形機甲底盤換到無人機底盤,rangeCap 由 sight 240 升到 270
      // ⇒ 解析射程 172.8 → 192m。曾經試過把名目射程壓回去讓解析值不動(320 → 240),結果是
      // ④ 當場紅字(172.8 < 砲塔的 186)、而且 rngDmgF 反手把傷害補上去,⑤ 直接衝到 88%。
      vs: { flesh: 0.8, armor: 1.1, air: 0.5, building: 1.2 } },
    skill: { name: '薰衣草斗篷', fx: 'stealth', dur: [4, 5, 6],
      cd: [20, 18, 16], mp: [35, 40, 45], desc: '從敵方感測網上消失(開火即現形)' },
    // 2026-08-06 使用者定案(機種絕招退場的補償;見 SELF_ULT):由「全隊無霧」改成**全隊復甦**——
    // 恢復速度倍率 + 解除既有異常 + 期間免疫異常 + **仍在重生倒數中**的隊友原地半血復活。
    // 復活刻意只救「倒數中」的(已重生的不算)且回場半血 + 一瞬無敵,CD 維持 70→54s:
    // 這是全場唯一能把一條命拿回來的效果,價錢付在「必須在那 30 秒窗口內按下去」。
    ult: { name: '滿天星座', fx: 'rally', target: 'team', regen: [2.5, 3, 3.5],
      cleanse: true, revive: [0.5, 0.5, 0.5], dur: [8, 10, 12],
      cd: [70, 62, 54], mp: [80, 90, 100], desc: '衛星會被打下來,星星不會:全隊回復加速、解除並免疫異常,倒下的人原地站起來' },
  },

  // ================= 鋼鐵陣營(機甲)=================
  t01: {
    side: 'STEEL', kind: 'robot', name: '瓦列里・格羅莫夫', code: '冬將軍', machine: '「莫洛茲」指揮型重機甲',
    visual: { hue: 0xd6e4ef, pod: 'none', proto: 'bastion', paint: 'natflag', flag: [0xffffff, 0x0039a6, 0xd52b1e] },
    mods: { hp: 1.15, sp: 1.0, mp: 1.1, speed: 0.9, armor: 22 },
    light: { name: '12.7 同軸重機槍', rw: 'Kord・初速 860m/s', type: 'gun', mv: 860,
      dmg: [22, 27, 33], rate: 4.5, mag: [40, 48, 56], reload: 2.4, range: 200, pen: 4,
      vs: { flesh: 1.3, armor: 1.0, air: 0.8, building: 0.6 } },
    // 護盾軸示範 ④【反裝甲】(原 vs.building 1.8 —— 全表最高的攻城加乘之一,在 EX_SIEGE_WEAPONS
    // 名冊內,紀律①)。反護盾的鏡像:榴彈的超壓是「大面積、慢」的能量,護盾場整個消化得掉;
    // 但盾一破,152mm 破片打在裝甲板上就不是護盾場能談的事了。
    // 它同時留著 vs.armor 1.3,依紀律③「加成越多含金量越低」⇒ vsHp 只給一小格,折減照吃。
    heavy: { name: '152mm 榴彈砲', rw: '2A65 縮裝・初速 650m/s', type: 'launcher', mv: 650,
      dmg: [75, 111, 156], r: [16, 18, 20], mag: 3, reload: 12, range: 264, pen: 14,   // range:榴彈類短射程帶(見 s02 同欄註)
      vsSp: 0.72, vsHp: 1.15,
      vs: { flesh: 1.1, armor: 1.3, air: 0.3, building: 1.8 } },
    skill: { name: '冬將軍號令', fx: 'buff', target: 'team', r: 200, mul: { dmg: [1.15, 1.25, 1.35] },
      add: { fx: 'haste', f: [1.2, 1.25, 1.3] },
      dur: [6, 8, 10], cd: [22, 20, 18], mp: [35, 40, 45], desc: '全軍衝鋒:友軍火力與移速齊升' },
    ult: { name: '雪崩齊射', fx: 'strike', count: [6, 8, 10], dmg: [77, 98, 119], r: 12, scatter: 40,
      add: { fx: 'stun', dur: [0.8, 1, 1.2] },
      range: 340, pen: 10, cd: [80, 70, 60], mp: [90, 100, 110], vs: { building: 1.4, armor: 1.2 },
      desc: '全營砲兵行進間齊射,砲擊震撼(麻痺)' },
  },
  t02: {
    side: 'STEEL', kind: 'robot', name: '薇拉・佐洛塔列娃', code: '編號七', machine: '「加拉泰亞-7」神經同步機',
    visual: { hue: 0xcfd8ff, pod: 'none', proto: 'seraph', paint: 'minimal' },
    mods: { hp: 0.9, sp: 1.3, mp: 1.2, speed: 1.15, armor: 14 },
    light: { name: '高斯衝鋒槍', rw: '實驗性 EM 線圈・初速 1100m/s', type: 'rail', mv: 1100,
      dmg: [14, 18, 21], rate: 8, mag: [32, 40, 48], reload: 1.9, range: 200, crit: 0.08,
      vs: { flesh: 1.2, armor: 0.9, air: 1.1, building: 0.5 } },
    heavy: { name: '同步狙擊砲', rw: 'EM 加速穿甲彈・初速 1500m/s', type: 'rail', mv: 1500,
      // dmg −5%(2026-08-04):榴彈類改吃短射程帶之後,長射程貫穿砲在 bal ⑤ 的相對優勢跟著上浮
      // (t02 79% → 82%,出界)。射程差買不回來(⑦ 實測 +15% 射程 = +21pp,火力只有 +4pp)⇒
      // 依 §2.1「個別角色改 dmg 階梯」這條唯一的具名出口修正,MUST NOT 回頭動 vs 表。
      dmg: [68, 102, 148], mag: 2, reload: 8, range: 360, crit: 0.15, critX: 2.0, pen: [18, 22, 26],
      vs: { flesh: 1.0, armor: 1.8, air: 1.2, building: 0.6 } },
    skill: { name: '相位突進', fx: 'dash', imp: [26, 32, 38],
      cd: [12, 10, 8], mp: [25, 30, 35], desc: '同步率暴走:機體瞬間位移' },
    // 2026-08-06 使用者定案(見 SELF_ULT):改成**超載** —— 彈藥全滿 + 期間無限彈藥(免裝填)
    // + 閃避率提升,**被擊中即結束**。補償當量由「免裝填的 DPS 增益 × 撐得住的秒數」兌現,
    // 故刻意不再疊 mul.dmg(疊上去就是同一份預算領兩次);`brk` 那條風險正是它的價錢 ——
    // 全滿彈匣 + 零裝填的爆發只有在沒被打到的前提下成立,吃到一發就回到常態。
    ult: { name: '同步率 100%', fx: 'buff', target: 'self',
      mul: { dmgTaken: [0.75, 0.7, 0.65] },
      add: { fx: 'overdrive', evade: [0.25, 0.32, 0.4] }, brk: true,
      dur: [8, 10, 12], cd: [80, 70, 60], mp: [85, 95, 105], desc: '再沒有介面延遲:彈藥全滿、期間免裝填、閃避率大增 —— 但挨一發就結束' },
  },
  t03: {
    side: 'STEEL', kind: 'robot', name: '阿爾喬姆・薩維利耶夫', code: '大鍋', machine: '「爐膛」突擊機甲',
    visual: { hue: 0xe08a4a, pod: 'shield', form: 'biped', creature: 'gorilla', paint: 'minimal' },
    mods: { hp: 1.3, sp: 0.85, mp: 0.9, speed: 0.95, armor: 26 },
    light: { name: '全自動霰彈', rw: 'Saiga-12 彈鼓・初速 400m/s', type: 'gun', mv: 400, fan: true, arc: [17, 15, 13],
      dmg: [36, 45, 56], rate: 2.4, mag: [8, 10, 12], reload: 2.6, range: 170, crit: 0.10, critX: 1.5,
      vs: { flesh: 1.6, armor: 0.6, air: 0.9, building: 0.5 } },
    heavy: { name: '電漿噴焰', rw: '磁化電漿投射・扇形噴焰', type: 'plasma', arc: [15, 17, 19],
      dmg: [49, 72, 102], mag: 3, reload: 7, range: 264, pen: 12,
      vs: { flesh: 1.6, armor: 1.1, air: 0.3, building: 1.4 } },
    // 雙扇形(霰彈 + 電漿噴焰)= 全機種最短的交戰帶,又是最慢的機體 ⇒ 兩招都給貼身套件
    // (2026-07-27 使用者原則:扇形武器優先配置拉敵人/進場退場/匿蹤、控場或走位的大小招;稽核 bal ⑥)。
    // 舊制「承傷減免 + 傷害增益吸血」是站樁包:貼不上的時候一項都兌現不了,對進戰(bal ⑤)長年墊底。
    // 小招保留鑄鐵鍋盾本體(機體左前臂真的掛著那口鍋,見 models.js gorilla)並補上衝鋒 ——
    // lore 寫的就是「頂著那口鑄鐵鍋盾一路撞進去」,承傷減免 + 加速正是這句話的機制化;
    // 大招從自身增益改成把敵人捲進鍋裡的範圍打擊,直接把目標帶進扇形武器的甜蜜點。
    skill: { name: '鑄鐵鍋盾', fx: 'buff', target: 'self', mul: { dmgTaken: [0.55, 0.5, 0.45] },
      add: { fx: 'haste', f: [1.35, 1.45, 1.55] },
      dur: [5, 6, 7], cd: [16, 14, 12], mp: [30, 35, 40], desc: '左臂鑄鐵鍋一橫,頂著彈幕加速撞進去(承傷大減 + 衝鋒)' },
    ult: { name: '開鍋!', fx: 'strike', count: [2, 3, 4], dmg: [88, 110, 138], r: 14, scatter: 18,
      add: { fx: 'pull', imp: [24, 30, 36] },
      range: 160, pen: 10, cd: [75, 65, 55], mp: [80, 90, 100], vs: { flesh: 1.5, armor: 1.1 },
      desc: '掀鍋!滾燙熱浪炸開,周圍的全給我捲進來(拉近)' },
  },
  t04: {
    side: 'STEEL', kind: 'robot', name: '娜傑日達・奧爾洛娃', code: '灰雁', machine: '「灰犬」獵殺型',
    visual: { hue: 0x8a97a5, pod: 'rack', form: 'beast', creature: 'hound', paint: 'camo' },
    mods: { hp: 0.95, sp: 1.1, mp: 1.1, speed: 1.1, armor: 16 },
    light: { name: '消音 DMR', rw: 'VSS Vintorez 9×39・初速 295m/s', type: 'gun', mv: 295,
      dmg: [21, 27, 33], rate: 3.2, mag: [20, 24, 28], reload: 2.0, range: 210, crit: 0.15, critX: 1.8,
      vs: { flesh: 1.4, armor: 0.8, air: 1.0, building: 0.5 } },
    heavy: { name: '14.5 反器材砲', rw: 'KPV・初速 1000m/s', type: 'gun', mv: 1000,
      dmg: [54, 80, 112], mag: 3, reload: 9, range: 380, crit: 0.20, critX: 2.0, pen: [20, 25, 30],   // dmg −5%:同 t02 heavy 同欄註(bal ⑤ 離群修正)
      vs: { flesh: 1.2, armor: 2.0, air: 1.5, building: 0.6 } },
    skill: { name: '灰色迷彩', fx: 'stealth', dur: [4, 5, 6],
      cd: [20, 18, 16], mp: [35, 40, 45], desc: '從所有感測器上消失(開火即現形)' },
    ult: { name: '獵殺名單', fx: 'buff', target: 'self', mul: { dmg: [1.25, 1.35, 1.45] }, vision: [8, 10, 12],
      add: { fx: 'mark', dur: [5, 6, 7] },
      dur: [8, 10, 12], cd: [75, 65, 55], mp: [85, 95, 105], desc: '名單下一行:全圖視野,下一擊必中必爆' },
  },
  t05: {
    side: 'STEEL', kind: 'robot', name: '沈鶴鳴', code: '鶴', machine: '「仿生鶴」原型機',
    visual: { hue: 0xf2f2f2, pod: 'dish', form: 'biped', creature: 'ostrich', paint: 'solid' },
    mods: { hp: 1.0, sp: 1.1, mp: 1.15, speed: 1.05, armor: 18 },
    light: { name: '原型軌道步槍', rw: '實驗性線圈砲・初速 1500m/s', type: 'rail', mv: 1500,
      dmg: [16, 20, 25], rate: 7, mag: [36, 44, 52], reload: 2.1, range: 200, crit: 0.06,
      vs: { flesh: 1.3, armor: 0.8, air: 1.0, building: 0.5 } },
    heavy: { name: '原型脈衝雷射矛', rw: '仿生關節整合雷射・光速直擊', type: 'beam',
      dmg: [37, 56, 83], mag: 5, reload: 8, range: 300, pen: [18, 22, 26],
      vs: { flesh: 0.8, armor: 1.7, air: 0.6, building: 0.6 } },
    skill: { name: '結構自檢', fx: 'heal', target: 'self', heal: [200, 280, 360],
      cd: [22, 19, 16], mp: [35, 40, 45], desc: '仿生關節自我修復(掉漆的才是我的)' },
    ult: { name: '量產線', fx: 'summon', unit: 'tank', count: [1, 2, 3],
      cd: [90, 80, 70], mp: [90, 100, 110], desc: '瀋陽重工加班:主戰坦克沿最近兵線出廠' },
  },
  t06: {
    // 2026-08-02 機體混編(使用者定案:孫悟空轉鋼鐵、國籍中國 —— 他本來就是中國人):
    // 「孫悟空」變形機甲從傭兵轉入鋼鐵。掌行跑酷的猴姿 ↔ 升空展開觔斗雲式光翼,
    // 正是他那套「輕功」的原型;麻辣走位(dash)與主角時刻(leap)一個字都不用改。
    side: 'STEEL', kind: 'morph', name: '陸小川', code: '小川', machine: '「輕功」齊天式可變機甲',
    visual: { hue: 0xffb84d, pod: 'blade', flight: 'uav', ground: 'monkey', bulk: 0.95, paint: 'minimal' },
    mods: { hp: 0.95, sp: 1.05, mp: 1.0, speed: 1.2, armor: 14 },
    light: { name: '5.8 突擊步槍', rw: 'QBZ-191・初速 930m/s', type: 'gun', mv: 930,
      dmg: [15, 18, 23], rate: 9, mag: [34, 42, 50], reload: 1.8, range: 190, crit: 0.08,
      vs: { flesh: 1.3, armor: 0.7, air: 1.0, building: 0.5 } },
    heavy: { name: '如意熔核砲', rw: '磁化電漿聚爆・多節長尾前捲貼身直擊', type: 'plasma', arc: [10, 12, 14],
      dmg: [60, 93, 144], mag: 3, reload: 7, range: 264, pen: 10,
      vs: { flesh: 1.1, armor: 1.4, air: 0.3, building: 0.8 } },
    skill: { name: '麻辣走位', fx: 'dash', imp: [28, 34, 40],
      cd: [11, 9, 7], mp: [25, 30, 35], desc: '模擬器省冠軍的走位,機體像長在他身上' },
    ult: { name: '主角時刻', fx: 'buff', target: 'self', mul: { dmg: [1.35, 1.45, 1.55], dmgTaken: [0.8, 0.75, 0.7] },
      add: { fx: 'leap', f: [2.0, 2.3, 2.6] },
      dur: [8, 10, 12], cd: [70, 60, 50], mp: [80, 90, 100], desc: '儲物櫃漫畫的主角上場了:輕功大跳躍' },
  },
  t07: {
    // 2026-08-02 機體混編:接下原屬蜂群的「翼龍」擬態翼無人機 —— 膜翼滑翔幾乎不耗電、也幾乎沒有聲音,
    // 雙爪各抓一具槍莢:要抓才有、鬆手就沒有,對一個「只需要一發」的狙擊手是量身訂做的機體。
    side: 'STEEL', kind: 'drone', name: '李正赫', code: '無聲', machine: '「屏息」翼龍狙擊機',
    visual: { hue: 0x3fae4a, frame: 'coax', body: 'sphere', form: 'avian', creature: 'ptero', paint: 'split', split: 'y', splitAt: 0.63 },  // 翡翠綠同色系:翼背(上)亮/腹面(下)暗
    mods: { hp: 0.9, sp: 1.0, mp: 1.05, speed: 1.05, armor: 7 },
    light: { name: '消音卡賓', rw: '88 式縮裝・初速 720m/s', type: 'gun', mv: 720,
      dmg: [15, 19, 23], rate: 6, mag: [30, 36, 42], reload: 2.0, range: 190, crit: 0.10,
      vs: { flesh: 1.3, armor: 0.7, air: 1.0, building: 0.4 } },
    heavy: { name: '白頭山反器材', rw: '14.5mm 栓動・初速 1000m/s', type: 'gun', mv: 1000,
      dmg: [40, 57, 80], mag: 3, reload: 9, range: 400, crit: 0.25, critX: 2.2, pen: [18, 24, 30],
      vs: { flesh: 2.0, armor: 1.6, air: 1.2, building: 0.5 } },
    skill: { name: '靜默潛行', fx: 'stealth', dur: [5, 6, 7],
      cd: [20, 18, 16], mp: [35, 40, 45], desc: '動作省到一毫米都不多(開火即現形)' },
    ult: { name: '零點五度', fx: 'strike', count: 1, dmg: [340, 442, 553], r: 6,
      add: { fx: 'bleed', dps: [24, 30, 38], dur: 5, pen: 12 },
      range: 400, pen: 20, cd: [70, 62, 54], mp: [80, 90, 100], vs: { flesh: 1.5, armor: 1.2 },
      desc: '一發,只需要一發 —— 貫穿創口持續失血(出血)' },
  },
  t08: {
    // 2026-08-02 機體混編:接下原屬蜂群的「機械龍」擬態翼無人機 —— 東亞的龍,張口即齊射,
    // 而她的武器本來就是從喉嚨裡出來的:諧振波炮的發射口就是那張嘴。
    side: 'STEEL', kind: 'drone', name: '韓雪', code: '電波歌姬', machine: '「詠嘆調」電戰無人機',
    visual: { hue: 0xffc7dd, frame: 'hexa', body: 'slab', form: 'avian', creature: 'dragon', paint: 'sakura' },
    mods: { hp: 0.9, sp: 1.25, mp: 1.3, speed: 1.0, armor: 6 },
    light: { name: '共鳴脈衝步槍', rw: '聲電複合雷射・光速直擊', type: 'beam',
      dmg: [15, 19, 23], rate: 7, mag: [36, 44, 52], reload: 2.1, range: 190, crit: 0.06,
      vs: { flesh: 1.3, armor: 0.7, air: 1.0, building: 0.5 } },
    // 護盾軸示範 ②【反護盾】:諧振頻率對準護盾場的共振點,場一垮就沒戲唱了 —— 與 s03 同型,
    // 但削盾幅度小一點、主 HP 掉得少一點(同一個原型的兩種調校,不是同一把武器)。
    heavy: { name: '諧振波炮', rw: '定向聲電複合・光速', type: 'beam',
      dmg: [23, 33, 45], mag: 5, reload: 8, range: 300, emp: [1.0, 1.5, 2.0],
      vsSp: 1.55, vsHp: 0.78,
      vs: { flesh: 0.9, armor: 0.8, air: 1.8, building: 0.4 } },
    skill: { name: '搖籃曲', fx: 'emp', r: 140, dur: [2.5, 3, 3.5], range: 260,
      cd: [18, 16, 14], mp: [40, 45, 50], desc: '把你頻道撕碎的搖籃曲(區域武器離線)' },
    ult: { name: '詠嘆調', fx: 'emp', r: 280, dur: [4, 5, 6],
      cd: [72, 64, 56], mp: [90, 100, 110], desc: '絕對音感的全頻壓制' },
  },
  t09: {
    // 2026-08-02 機體混編:接下原屬蜂群的三角翼定翼無人機 —— 他是「廉價自殺式無人機之父」,
    // 而 Shahed-136 本來就是三角翼。他終於坐進了自己畫出來的那個外形裡。
    side: 'STEEL', kind: 'drone', name: '達留什・法拉赫扎德', code: '詩人', machine: '「悲歌」巡飛彈母機',
    visual: { hue: 0xc9b7e8, frame: 'wing', body: 'wedge', form: 'fixed', wing: 'delta', paint: 'totem' },
    mods: { hp: 1.05, sp: 1.0, mp: 1.15, speed: 0.9, armor: 8 },
    light: { name: '防衛機槍', rw: 'MG3 7.62・初速 820m/s', type: 'gun', mv: 820,
      dmg: [14, 18, 22], rate: 8, mag: [40, 48, 56], reload: 2.2, range: 190, crit: 0.06,
      vs: { flesh: 1.3, armor: 0.7, air: 1.0, building: 0.5 } },
    heavy: { name: '見證者巡飛彈', rw: 'Shahed 縮裝・巡飛 100m/s', type: 'missile', mv: 100,
      dmg: [38, 55, 77], r: [15, 17, 19], mag: 4, reload: 11, range: 360, pen: 10,
      vs: { flesh: 1.1, armor: 1.3, air: 0.3, building: 1.6 } },
    skill: { name: '哀悼詩', fx: 'summon', unit: 'rocketeer', count: [2, 3, 4],
      cd: [26, 23, 20], mp: [40, 45, 50], desc: '為敵我雙方各寫一行:火箭兵支援' },
    ult: { name: '巡飛彈之雨', fx: 'strike', count: [7, 9, 11], dmg: [72, 89, 111], r: 11, scatter: 45,
      add: { fx: 'confuse', dur: [1.5, 2, 2.5] },
      range: 360, pen: 8, cd: [80, 70, 60], mp: [90, 100, 110], vs: { building: 1.3, armor: 1.2 },
      desc: '讓戰爭打不完的東西一次下完,漫天彈雨引發恐慌(混亂)' },
  },
  t10: {
    side: 'STEEL', kind: 'robot', name: '蕾拉・侯賽尼', code: '落點', machine: '「軌跡」攔截機甲',
    visual: { hue: 0x7fe8c9, pod: 'none', proto: 'aegis', paint: 'tattoo' },
    mods: { hp: 1.0, sp: 1.15, mp: 1.2, speed: 1.0, armor: 16 },
    light: { name: '30mm 速射砲', rw: '2A42 縮裝・初速 960m/s', type: 'gun', mv: 960,
      dmg: [18, 22, 27], rate: 5.5, mag: [28, 34, 40], reload: 2.3, range: 210, pen: 6,
      vs: { flesh: 1.1, armor: 1.0, air: 1.5, building: 0.5 } },
    heavy: { name: '攔截者飛彈', rw: '9M330 縮裝・初速 800m/s', type: 'missile', mv: 800,
      dmg: [50, 75, 113], r: [11, 13, 15], mag: 4, reload: 11, range: 340, pen: 6,
      vs: { flesh: 0.7, armor: 0.7, air: 2.4, building: 0.4 } },
    skill: { name: '彈道預解', fx: 'intercept', r: [160, 200, 240],
      cd: [15, 13, 11], mp: [30, 35, 40], desc: '攔截永遠該比打擊便宜:清空來襲飛彈' },
    ult: { name: '不可攔截區', fx: 'buff', target: 'team', r: 220, mul: { dmgTaken: [0.55, 0.45, 0.35] },
      dur: [6, 7, 8], cd: [80, 70, 60], mp: [90, 100, 110], desc: '頭巾內襯的那頁詩:友軍承傷大減' },
  },
  t11: {
    // 2026-08-02 機體混編:接下原屬傭兵的「傾轉旋翼 ↔ 負重工」變形機甲 —— 傾轉旋翼把步兵班
    // 載到定位(大招「安哥拉支援」),落地變成扛著整個班的負重前傾體態。老兵的活,本來就是扛人。
    side: 'STEEL', kind: 'morph', name: '拉斐爾・富恩特斯', code: '老雪茄', machine: '「老兵」可變式戰術指導機',
    visual: { hue: 0x8a9a5a, pod: 'antenna', flight: 'tilt', ground: 'atlas', bulk: 1.15, paint: 'camo' },
    mods: { hp: 1.2, sp: 0.9, mp: 1.0, speed: 0.9, armor: 24 },
    light: { name: '車載重機槍', rw: 'DShKM・初速 850m/s', type: 'gun', mv: 850,
      dmg: [20, 25, 31], rate: 4.8, mag: [34, 40, 48], reload: 2.3, range: 200, pen: 4,
      vs: { flesh: 1.3, armor: 1.0, air: 0.8, building: 0.6 } },
    heavy: { name: '無後座砲', rw: 'SPG-9・初速 435m/s', type: 'launcher', mv: 435,
      dmg: [78, 115, 168], r: [13, 15, 17], mag: 3, reload: 12, range: 264, pen: 12,   // range:榴彈類短射程帶(見 s02 同欄註)
      vs: { flesh: 1.0, armor: 1.5, air: 0.4, building: 1.3 } },
    skill: { name: '老兵的叮嚀', fx: 'buff', target: 'team', r: 160, mul: { dmgTaken: [0.7, 0.65, 0.6] },
      dur: [4, 5, 6], cd: [20, 18, 16], mp: [35, 40, 45], desc: '罐頭哪裡最薄,他都教過:友軍承傷降低' },
    ult: { name: '安哥拉支援', fx: 'summon', unit: 'squad', count: [4, 6, 8],
      cd: [85, 75, 65], mp: [85, 95, 105], desc: '老戰友聽得懂的黑話:步兵班沿最近兵線投入' },
  },
  t12: {
    side: 'STEEL', kind: 'robot', name: '阿列霞・卡爾波維奇', code: '螢火', machine: '「巨兵」訊號掃描機',
    visual: { hue: 0xb8ffb0, pod: 'none', proto: 'colossus', paint: 'tattoo' },
    mods: { hp: 0.9, sp: 1.15, mp: 1.3, speed: 1.05, armor: 12 },
    light: { name: '掃描脈衝槍', rw: '低功率相位雷射・光速直擊', type: 'beam',
      dmg: [13, 16, 20], rate: 10, mag: [40, 50, 60], reload: 1.8, range: 170, crit: 0.08,
      vs: { flesh: 1.3, armor: 0.5, air: 1.0, building: 0.4 } },
    heavy: { name: '標定脈衝砲', rw: 'EM 標定彈・初速 2500m/s', type: 'rail', mv: 2500,
      dmg: [53, 82, 122], mag: 2, reload: 8, range: 340, emp: [0.8, 1.0, 1.2],
      vs: { flesh: 0.8, armor: 1.0, air: 1.6, building: 0.5 } },
    skill: { name: '螢火掃描', fx: 'vision', vision: [5, 7, 9],
      cd: [24, 21, 18], mp: [35, 40, 45], desc: '在頻譜裡找蜂群的心跳:全隊限時無霧' },
    ult: { name: '那也是一個人', fx: 'emp', r: 240, dur: [3, 4, 5], vision: [4, 5, 6],
      cd: [75, 65, 55], mp: [90, 100, 110], desc: '標記過的訊號全數靜默,並回傳位置' },
  },

  // ================= 傭兵(side:'MERC',雙陣營皆可受雇)=================
  // 「變形者」(kind:'morph'):HP/火力與機甲相同,
  // 飛行型觸地變形為地面型、地面型蓄力跳躍彈射變形為飛行型(見 MORPH/UNITS.morph)。
  // 無論受雇於蜂群或鋼鐵,機體/武器/招式/特長完全相同。
  // 2026-08-02 機體混編:傭兵不再全員變形者 —— 變形機甲 4(m01/m05/m07/m08)、
  //   無人機 2(m03/m04)、機甲 2(m02/m06);讓出的四款變形機甲各自轉入對應陣營
  //   (悟空 → 鋼鐵、傾轉旋翼母艦 → 鋼鐵、飛鯨巨象 → 蜂群、始祖鳥迅猛龍 → 蜂群),
  //   換回的四款機體一律取「不屬於任何國族象徵」的原型(恐龍系機甲 + 貨運/猛禽無人機),
  //   契合不結盟市場的設定。
  // 變形者型態兩類等比例(2/2):
  //  A 類 定翼/旋翼 ↔ 人形(地面型各有體態,不再共用一套站姿):
//       m01 heli↔vampire(挺立高領・三旋翼:機首桅 + 雙腿末端,飛行雙腿與機身呈 Y 字)、
//       m05 jet↔wolf(趾行深屈・鬃刺肩尖)
  //  B 類 擬態翼 ↔ 四足獸:m07 beetle、m08 owl↔panther
  //  (uav↔monkey 現屬 t06、tilt↔atlas 現屬 t11、levi↔elephant 現屬 s10、archo↔raptor 現屬 s03)
  // 2026-08-03 地緣政治對帳:傭兵 = 「不結盟市場」,而舊名冊裡有四名是北約/歐盟成員國的人
  //   (克羅埃西亞 / 葡萄牙 / 加拿大 / 德國)—— 那四國在世界觀裡明寫是蜂群同盟那一側的技術與志願
  //   來源,擺在「兩邊都接」的傭兵席上是設定衝突。依「機體原型的形象 × 使用武器 × 地緣政治立場」
  //   改為:m01 塞爾維亞(吸血鬼一詞的原產地,也是歐洲最典型的兩邊都賣的不結盟軍工國)、
  //   m03 瑞士(中立國的中立生意:戰地再保 + 高山空中救援)、m04 蒙古(阿爾泰馴鷹世家 ×「第三鄰國」
  //   等距外交)、m08 印度(高山狙擊傳統 × 兩大陣營都買也都賣的不結盟大國)。
  m01: {
    // 2026-08-04 稱號整理的**唯一具名豁免**:全表只有這一台機體與駕駛員同名,而且是刻意的 ——
    // 他賣的就是那個剪影,人與機體在他這門生意裡是同一件商品(見 lore.js m01 bond:
    // 「客戶記不住兩個名字,那就只給他們一個」)。其餘同名者一律已改成相似但不同的機體名。
    side: 'MERC', kind: 'morph', name: '德揚・科瓦切維奇', code: '渡鴉', machine: '「渡鴉」可變式突襲機甲',
    visual: { hue: 0xd94f4f, pod: 'rack', flight: 'heli', ground: 'vampire', bulk: 1.0, paint: 'natflag', flag: [0xc6363c, 0x0c4076, 0xffffff] },
    mods: { hp: 1.0, sp: 1.05, mp: 1.0, speed: 1.1, armor: 7 },
    light: { name: '7.62 六管速射艙', rw: 'M134 Minigun・初速 850m/s', type: 'gun', mv: 850,
      dmg: [11, 14, 17], rate: 12, mag: [60, 75, 90], reload: 2.4, range: 185, crit: 0.05,
      vs: { flesh: 1.3, armor: 0.6, air: 1.3, building: 0.4 } },
    // 護盾軸示範 ③【穿盾】(原 vs.building 1.1,在 EX_SIEGE_WEAPONS 名冊內 —— 紀律①):
    // 破甲彈的金屬射流截面極小、速度極高,護盾場來不及耦合就被穿過去,一半動能直接打在裝甲上。
    // 代價寫在兩處:總量偏低(vsHp < 1)、基礎傷害再吃 counterDmgF —— 它同時還留著 vs.armor 1.7
    // 這個大加成,依紀律③「加成越多含金量越低」,折減會比只掛一項的武器更重。
    heavy: { name: '地獄火反裝甲彈', rw: 'AGM-114 縮裝・鎖定追蹤・初速 450m/s', type: 'missile', mv: 450,
      dmg: [50, 72, 103], r: [12, 14, 16], mag: 4, reload: 11, range: 320, pen: [14, 18, 22],
      spPierce: 0.45, vsHp: 0.9,
      vs: { flesh: 0.9, armor: 1.7, air: 0.5, building: 1.1 } },
    skill: { name: '違約金條款', fx: 'dash', imp: [27, 33, 39],
      cd: [12, 10, 8], mp: [25, 30, 35], desc: '哪邊付錢都一樣快:沿視線爆發脫離' },
    ult: { name: '加班費三倍', fx: 'buff', target: 'self', mul: { dmg: [1.3, 1.4, 1.5], reload: [0.8, 0.75, 0.7] },
      add: { fx: 'vamp', f: [0.12, 0.16, 0.2] },
      dur: [8, 10, 12], cd: [75, 65, 55], mp: [80, 90, 100], desc: '合約外時段全面超載,渡鴉汲血(吸血)' },
  },
  m02: {
    // 2026-08-02 機體混編:改駕「暴龍」雙足機甲 —— 前傾軀幹以重尾配平,巨顎裡藏的正是
    // 他那門重型線圈加農砲(HEAVY_MOUNT.trex = mouth);護衛重裝的體格一分未減。
    side: 'MERC', kind: 'robot', name: '巴澤爾・奧坎', code: '磐石', machine: '「壓艙石」重型突擊機甲',
    visual: { hue: 0x9aa3ad, pod: 'shield', form: 'biped', creature: 'trex', paint: 'totem' },
    mods: { hp: 1.25, sp: 0.9, mp: 0.95, speed: 0.9, armor: 24 },
    light: { name: '7.62 通用機槍', rw: 'FN MAG・初速 840m/s', type: 'gun', mv: 840,
      dmg: [16, 20, 25], rate: 7, mag: [40, 48, 56], reload: 2.2, range: 195, crit: 0.05,
      vs: { flesh: 1.3, armor: 0.8, air: 0.9, building: 0.5 } },
    heavy: { name: '重型線圈加農砲', rw: '大口徑線性馬達砲・初速 1800m/s', type: 'rail', mv: 1800,
      dmg: [74, 109, 154], mag: 2, reload: 8, range: 360, crit: 0.1, critX: 1.8, pen: [20, 25, 30],
      vs: { flesh: 0.9, armor: 1.7, air: 0.4, building: 1.0 } },
    skill: { name: '掩體協議', fx: 'buff', target: 'self', mul: { dmgTaken: [0.6, 0.55, 0.5] },
      dur: [4, 5, 6], cd: [16, 14, 12], mp: [30, 35, 40], desc: '雇主的貨要緊:承傷大減' },
    ult: { name: '押運合約', fx: 'buff', target: 'team', r: 200, mul: { dmgTaken: [0.7, 0.62, 0.55] },
      dur: [6, 8, 10], cd: [80, 70, 60], mp: [85, 95, 105], desc: '這一單保到底:半徑內友軍承傷降低' },
  },
  m03: {
    // 2026-08-02 機體混編:改駕雙尾桁定翼無人機 —— 兩根尾桁之間的空腔本來是天線艙,
    // 她改成了貨艙:先把血漿、零件、修理臂空投下去,帳單後到。
    side: 'MERC', kind: 'drone', name: '烏蘇拉・林德特', code: '雪線', machine: '「續命」雙尾桁運補機',
    visual: { hue: 0x59c9a5, frame: 'wing', body: 'frame', form: 'fixed', wing: 'twinboom', paint: 'minimal' },
    mods: { hp: 0.95, sp: 1.15, mp: 1.2, speed: 1.0, armor: 5 },
    light: { name: '護衛脈衝雷射艙', rw: '低功率防禦雷射・光速直擊', type: 'beam',
      dmg: [15, 19, 23], rate: 8, mag: [30, 36, 42], reload: 1.9, range: 175, crit: 0.07,
      vs: { flesh: 1.4, armor: 0.5, air: 1.1, building: 0.4 } },
    heavy: { name: '空投截擊彈', rw: 'APKWS 雷射導引・初速 700m/s', type: 'launcher', mv: 700, guide: 1,
      dmg: [62, 95, 137], r: [11, 13, 15], mag: 3, reload: 12, range: 300, pen: 8,
      vs: { flesh: 1.1, armor: 1.2, air: 1.2, building: 1.0 } },
    skill: { name: '戰地保單', fx: 'heal', target: 'team', r: 150, heal: [140, 200, 260],
      cd: [20, 18, 16], mp: [40, 45, 50], desc: '先修好再收錢:半徑內友軍裝甲回復' },
    ult: { name: '年度結算', fx: 'heal', target: 'team', r: 220, heal: [260, 350, 440], sp: true,
      cd: [85, 75, 65], mp: [90, 100, 110], desc: '大帳一次結清:裝甲大修、護盾充滿' },
  },
  m04: {
    // 2026-08-02 機體混編:改駕「鷹」擬態翼無人機 —— 她的檔案上寫著「雷達截面壓到鳥類等級」,
    // 現在那句話是字面意思:機體本身就是一隻鳥。翼掛反器材砲、俯衝一擊即走。
    // 2026-08-03 國籍對帳:加拿大 → 蒙古(阿爾泰馴鷹世家)。鷹式機體終於有了它的原產地,
    // 而「第三鄰國」的等距外交,正是不結盟市場最乾淨的一張履歷。
    side: 'MERC', kind: 'drone', name: '烏音嘎・策倫', code: '霧行者', machine: '「無名」鷹式偵獵機',
    visual: { hue: 0xd24fb4, frame: 'coax', body: 'box', form: 'avian', creature: 'eagle', paint: 'totem' },  // 洋紅+圖騰徽:與夜豹(m08 紫)脫鉤,改素色+徽章
    mods: { hp: 0.9, sp: 1.1, mp: 1.15, speed: 1.1, armor: 8 },
    light: { name: '消音戰鬥步槍', rw: 'HK G28・初速 780m/s', type: 'gun', mv: 780,
      dmg: [17, 21, 25], rate: 3.6, mag: [20, 24, 28], reload: 2.0, range: 215, crit: 0.14, critX: 1.8,
      vs: { flesh: 1.3, armor: 0.8, air: 1.1, building: 0.5 } },
    heavy: { name: '鷹爪反器材砲', rw: '20mm 市購反器材砲・初速 900m/s', type: 'gun', mv: 900,
      dmg: [40, 58, 81], mag: 3, reload: 9, range: 380, crit: 0.18, critX: 2.0, pen: [18, 23, 28],
      vs: { flesh: 1.2, armor: 1.9, air: 1.3, building: 0.5 } },
    skill: { name: '匿名發包', fx: 'stealth', dur: [4, 5, 6],
      cd: [20, 18, 16], mp: [35, 40, 45], desc: '合約不留名:從感測網上消失(開火即現形)' },
    // 2026-08-06 使用者定案(見 SELF_ULT):無霧秒數加倍,並在同一段窗內給**全隊**射程 / 跑速 /
    // 閃避率加成。fx 仍是 `recon`(不是 buff+team)⇒ `ultDelivered` 不收它,維持瞬發全隊型;
    // 射程加成走 mods 的 `range` 鍵(伺服器射程閘與客戶端有效射程同吃 heroRange 那條縫)。
    ult: { name: '全境盡職調查', fx: 'recon', target: 'team', vision: [18, 24, 30],
      mul: { range: [1.2, 1.25, 1.3], speed: [1.2, 1.25, 1.3] },
      add: { fx: 'evade', evade: [0.12, 0.16, 0.2] }, dur: [8, 10, 12],
      cd: [72, 64, 56], mp: [85, 95, 105], desc: '受雇前先查清楚:全隊無霧視野加倍,射程/跑速/閃避同步拉高' },
  },
  m05: {
    side: 'MERC', kind: 'morph', name: '瑪爾塔・韋恩', code: '熄燈', machine: '「鎖喉」電戰可變機甲',
    visual: { hue: 0x5551cc, pod: 'antenna', flight: 'jet', ground: 'wolf', bulk: 1.05, paint: 'split', split: 'x', splitFlip: true },  // 靛藍同色系:機體右半(-x)亮/左半暗
    mods: { hp: 1.1, sp: 1.0, mp: 1.15, speed: 0.95, armor: 16 },
    light: { name: '12.7 電磁機砲', rw: 'GAU-19 線圈化改裝・初速 1300m/s', type: 'rail', mv: 1300,
      dmg: [19, 24, 30], rate: 6, mag: [36, 44, 52], reload: 2.4, range: 200, crit: 0.06,
      vs: { flesh: 1.2, armor: 1.0, air: 0.9, building: 0.6 } },
    heavy: { name: '追債者制導彈', rw: '射後鎖定制導彈・初速 400m/s', type: 'missile', mv: 400,
      dmg: [50, 72, 103], r: [13, 15, 17], mag: 4, reload: 11, range: 330, pen: [12, 15, 18],
      vs: { flesh: 1.0, armor: 1.5, air: 0.5, building: 1.2 } },
    skill: { name: '斷路協議', fx: 'emp', r: 130, dur: [2.5, 3, 3.5], range: 250,
      cd: [18, 16, 14], mp: [40, 45, 50], desc: '欠債不還就斷電:指定區域敵軍武器離線' },
    ult: { name: '連本帶利', fx: 'strike', count: [6, 8, 10], dmg: [68, 85, 106], r: 11, scatter: 38,
      add: { fx: 'stun', dur: [0.8, 1, 1.2] },
      range: 330, pen: 10, cd: [78, 68, 58], mp: [88, 98, 108], vs: { armor: 1.3, building: 1.2 },
      desc: '逾期利滾利:飽和清算打擊,斷電扣押(麻痺)' },
  },
  m06: {
    // 2026-08-02 機體混編:改駕「劍龍」四足機甲 —— 背上那排骨板就是發射軌(HEAVY_MOUNT.stego = back),
    // 一整排掛架吊著轉包出去的貨:一座會走路的碼頭,比傾轉旋翼還像他的生意。
    side: 'MERC', kind: 'robot', name: '圖里奧・費雷拉', code: '嘉年華', machine: '「傾盆」母艦式機甲',
    visual: { hue: 0xf0c24a, pod: 'rack', form: 'beast', creature: 'stego', paint: 'totem' },
    mods: { hp: 1.0, sp: 1.1, mp: 1.25, speed: 1.0, armor: 14 },
    light: { name: '雙聯掛載機槍', rw: 'PKP 縮裝・初速 825m/s', type: 'gun', mv: 825,
      dmg: [13, 16, 20], rate: 9, mag: [45, 54, 63], reload: 2.2, range: 180, crit: 0.05,
      vs: { flesh: 1.3, armor: 0.6, air: 1.2, building: 0.5 } },
    heavy: { name: '集束子母彈', rw: 'CBU 縮裝・初速 400m/s', type: 'launcher', mv: 400,
      dmg: [55, 79, 112], r: [16, 18, 20], mag: 3, reload: 12, range: 264, pen: 6,   // range:榴彈類短射程帶(見 s02 同欄註)
      vs: { flesh: 1.4, armor: 0.9, air: 0.5, building: 1.2 } },
    skill: { name: '轉分包', fx: 'summon', unit: 'rocketeer', count: [2, 3, 4],
      cd: [26, 23, 20], mp: [40, 45, 50], desc: '臨時轉包:火箭兵沿最近兵線加入' },
    ult: { name: '旺季擴編', fx: 'summon', unit: 'heli', count: [1, 2, 3],
      cd: [85, 75, 65], mp: [90, 100, 110], desc: '訂單爆量:攻擊直升機編隊壓上' },
  },
  m07: {
    side: 'MERC', kind: 'morph', name: '約蘭妲・里奧斯', code: '界碑', machine: '「落閘」區域拒止可變機甲',
    visual: { hue: 0x5fa8d3, pod: 'shield', flight: 'beetle', ground: 'beetle', bulk: 1.25, paint: 'totem' },
    mods: { hp: 1.15, sp: 1.05, mp: 1.1, speed: 0.9, armor: 20 },
    light: { name: '雙 35 快砲', rw: 'Oerlikon 縮裝・初速 1100m/s', type: 'gun', mv: 1100,
      dmg: [18, 23, 28], rate: 6.5, mag: [32, 40, 48], reload: 2.6, range: 210, crit: 0.05,
      vs: { flesh: 1.0, armor: 0.9, air: 1.6, building: 0.5 } },
    heavy: { name: '區域拒止電漿陣列', rw: '近迫電漿散射・扇形攔截', type: 'plasma', arc: [22, 25, 28],
      dmg: [46, 73, 111], mag: 3, reload: 7, range: 264, pen: 8,
      vs: { flesh: 0.8, armor: 1.0, air: 2.2, building: 0.3 } },
    skill: { name: '拒止穹頂', fx: 'intercept', r: [160, 200, 240],
      cd: [16, 14, 12], mp: [30, 35, 40], desc: '一手交錢一手交貨:清空半徑內來襲飛彈' },
    ult: { name: '全域布防', fx: 'strike', count: [7, 9, 11], dmg: [55, 68, 85], r: 9, scatter: 40,
      add: { fx: 'slow', f: 0.6, dur: [2, 2.5, 3] },
      range: 320, cd: [74, 66, 58], mp: [85, 95, 105], vs: { air: 2.0, flesh: 1.2 },
      desc: '把整片天空劃進責任區:彈幕壓制(緩速)' },
  },
  m08: {
    side: 'MERC', kind: 'morph', name: '維迪雅・拉托爾', code: '尾聲', machine: '「空號」隱形狙擊可變機甲',
    visual: { hue: 0x8f7fd0, pod: 'blade', flight: 'owl', ground: 'panther', bulk: 0.85, paint: 'camo' },
    mods: { hp: 0.85, sp: 1.1, mp: 1.15, speed: 1.15, armor: 5 },
    light: { name: '消音精準艙', rw: 'VSS 縮裝・初速 295m/s', type: 'gun', mv: 295,
      dmg: [24, 30, 37], rate: 3.2, mag: [18, 22, 26], reload: 2.0, range: 200, crit: 0.16, critX: 1.9,
      vs: { flesh: 1.4, armor: 0.6, air: 1.0, building: 0.4 } },
    heavy: { name: '反器材長槍', rw: 'AMR 縮裝・初速 900m/s', type: 'gun', mv: 900,
      dmg: [61, 89, 126], mag: 3, reload: 9, range: 390, crit: 0.2, critX: 2.0, pen: [18, 23, 28],
      vs: { flesh: 1.3, armor: 1.7, air: 1.2, building: 0.5 } },
    skill: { name: '預付訂金', fx: 'dash', imp: [28, 34, 40],
      cd: [12, 10, 8], mp: [25, 30, 35], desc: '訂金到帳就位:沿視線瞬間位移' },
    // 2026-08-06 使用者定案(見 SELF_ULT):破隱後 SELF_ULT.ALPHA_S 秒內傷害倍增 ——
    // 倍率由 `selfUltBoost` 從被移除的機種絕招預算**推導**(MUST NOT 手寫);`alpha` 只是旗標。
    ult: { name: '查無此人', fx: 'stealth', dur: [4, 5, 6], add: { fx: 'alpha' },
      cd: [70, 62, 54], mp: [80, 90, 100], desc: '尾款結清便人間蒸發:開火即現形,但現形那一秒傷害暴增' },
  },
};

// ---- 射速壓縮 + 連發演出(2026-08-02 使用者定案)----------------------------------------
// 使用者需求:「DPS 不變、降低輕重武器射速,射速越高降越多,拉近射速差異、但射速的排名不變,
// 高射速武器動畫做對應調整,例如機槍做成 3 連發實質一次傷害,整體看起來攻擊動畫是連續的」。
//
// **這是一段推導迴圈,不是改數值**(同 CLASS_SYM / VS_DEFS 夾制 / aoe 夾制):32 角 × 兩槽位的
// `rate`/`dmg`/`mag` 由 `rateComp()` 一次改寫完,MUST NOT 回頭逐武器手改階梯 —— 那正是
// 「32 角一動就漂移」的老病。原始射速留在 `rate0`(連發演出與後座分級的唯一依據)。
//
// ① 曲線:`rateComp(r) = PIVOT × (r/PIVOT)^K`(r > PIVOT),PIVOT 以下逐位元不動。
//    K < 1 ⇒ 折減率隨射速單調遞增 = 「射速越高降越多」;曲線嚴格遞增 ⇒ **排名保證不變**
//    (這是「不變」的來源,不是巧合 —— MUST NOT 改成分段表或整數倍率:整數倍率會讓
//    rate 8 → 4.0 而 rate 9 → 3.0,排名當場翻掉)。K = 1 ⇒ 逐位元回到舊制(反向驗證用)。
// ② 錨點 `PIVOT = RATE_DEF`:32 把重武器一把都沒有標 `rate`,全部共用預設值 3 —— 那就是
//    現役射速帶的底。錨在這裡 = 重武器與 2.2/2.4/2.6/3 那幾把慢速輕武器折減 0%,
//    正是「降最少」的那一端。**MUST NOT 把錨點下修到全場最低 2.2**:重武器彈夾只有 2~5 發,
//    ③ 的整數化在那個尺度上誤差 14%(實測 mag 3 → 2 = DPS −14%),遠超「DPS 不變」。
// ③ **DPS 不變靠三件事一起動**:rate ×f、dmg ÷f、**mag ×f**。少了 mag 那一項,彈夾撐得更久
//    ⇒ 裝填次數變少 ⇒ 持續 DPS 最多虛胖 33.5%(實測),而且完全看不出來。
//    彈夾週期 `mag/rate + reload` 因此逐位元保持 ⇒ `heavyMpCost`(每發電力)與 bal ①④⑤⑦
//    吃的持續火力同步不動。mag 必須是整數(`st.ammo` 逐發遞減),四捨五入是唯一的誤差來源:
//    全 64 把武器 × Lv1~Lv4 實測最大偏差 0.99%。
// ④ **演出**:一次擊發 = `fireBurstN` 發視覺子彈(實質傷害仍是一次結算,伺服器只收到一發)。
//    N = round(rate0 / rate) ⇒ 視覺脈衝率 = N × rate ≈ 原射速,連發間隔 `fireBurstGap` 把 N 發
//    **平均鋪滿整個擊發週期** ⇒ 跨週期的間隔與週期內完全相同 = 使用者要的「看起來是連續的」。
//    現值:機槍(rate 10)→ 3 連發、旋轉機砲(14~18)→ 3~4 連發、重武器一律 N = 1(不變)。
export const RATE_DEF = 3;   // 未標 rate 的武器共用的預設射速(32 把重武器全數落在這裡)
export const FIRE_RATE = {
  K: 0.22,         // 壓縮指數(< 1 = 越快降越多);校準錨 = 使用者指定的「機槍 3 連發」⇒ K ≤ 0.239
  PIVOT: RATE_DEF, // 錨點:此值(含)以下折減 0%
  BURST_MAX: 4,    // 單次擊發的視覺連發上限
};
/** 壓縮後射速(唯一縫;嚴格遞增 ⇒ 排名不變)。K ≥ 1 或 r ≤ PIVOT 一律原值回傳(逐位元舊制)。 */
export const rateComp = (r) => (r <= FIRE_RATE.PIVOT || FIRE_RATE.K >= 1
  ? r : FIRE_RATE.PIVOT * (r / FIRE_RATE.PIVOT) ** FIRE_RATE.K);
/** 一次擊發的視覺連發數(解析後 def;`rate0` = 壓縮前射速)。MUST NOT 在消費端自己 round。 */
export const fireBurstN = (def) => {
  const r0 = def?.rate0, r = def?.rate;
  if (!r0 || !r) return 1;
  return Math.min(FIRE_RATE.BURST_MAX, Math.max(1, Math.round(r0 / r)));
};
/** 連發間隔:N 發平均鋪滿整個擊發週期 ⇒ 週期內與跨週期的間隔一致 =「連續」的來源 */
export const fireBurstGap = (def) => 1 / (def.rate * fireBurstN(def));
/**
 * 一把武器的射速壓縮(**純函式,唯一實作**;下方的推導迴圈與 `tools/audit_fire_rate.mjs` 同吃)。
 * 吃原始 `{rate, dmg, mag}`,回傳壓縮後的同三欄 + `rate0`;錨點以下(f 全階為 1)回傳 null
 * = 這把武器逐位元不動(連 `rate0` 都不掛 ⇒ `fireBurstN` 恆 1 ⇒ 不做連發演出)。
 *
 * 三欄一起動才守得住「DPS 不變」(見上方 ③):rate ×f、dmg ÷f、mag ×f。
 * rate 通常是純量(f 對全階相同 ⇒ dmg 階梯形狀原樣保留);s05 旋轉機砲的 rate 是三階陣列
 * ⇒ 逐階各自解一次 f,同樣只改幅度不改形狀。
 */
export function compressWeapon(w) {
  const arr = (v, n) => (Array.isArray(v) ? v : Array(n).fill(v));
  const src = { rate: w.rate ?? RATE_DEF, dmg: w.dmg ?? 0, mag: w.mag ?? 1 };
  const n = Math.max(...Object.values(src).map((v) => (Array.isArray(v) ? v.length : 1)));
  const r0 = arr(src.rate, n), d0 = arr(src.dmg, n), m0 = arr(src.mag, n);
  const f = r0.map((r) => rateComp(r) / r);
  if (f.every((x) => x === 1)) return null;
  const out = {
    rate0: src.rate,   // 演出(fireBurstN)與後座分級(recoilTier)的原始射速,唯一保留處
    rate: r0.map((r, i) => Math.round(r * f[i] * 1000) / 1000),
    dmg: d0.map((d, i) => Math.round(d / f[i] * 1000) / 1000),
    mag: m0.map((m, i) => Math.max(1, Math.round(m * f[i]))),
  };
  // 純量進來的欄位只要各階同值就仍以純量回去 —— tierVal 對「長度 1 的陣列」有專門語意
  // (末段增量 0 = 不外推),把純量胖成三元素陣列會讓 Lv4 從「同值」變成「線性外推」。
  for (const k of ['rate', 'dmg', 'mag']) {
    if (!Array.isArray(src[k]) && out[k].every((v) => v === out[k][0])) out[k] = out[k][0];
  }
  return out;
}
for (const c of Object.values(CHARACTERS)) {
  for (const slot of ['light', 'heavy']) {
    const w = c[slot];
    if (!w) continue;
    Object.assign(w, compressWeapon(w) || {});
  }
}

// ---- 經濟(2026-07-17 改制:金錢只來自擊殺/助攻/物資,無被動收入)----
// 擊殺 = 全額賞金;助攻 = 賞金 × ASSIST.F —— 曾對死者造成傷害或負面狀態才算貢獻,
// 貢獻後離開可視半徑(自身 sight)超過 ASSIST.TTL_S 秒即失效(sim._kill 結算)。
// 賞金「對應難度」:表列戰鬥單位由 UNITS 戰力推導(見 UNITS 之後的推導區塊),
// 此處只手訂非表列目標(missile 擊落防空飛彈 / aasite 匿蹤陣地 / decoy 集束轟炸機 / 英雄機體)。
// 校準錨(npm run bal ③):單一兵線 30% 擊殺 + 40% 助攻 × 10 分鐘 ≈ 八軌全滿總價。
export const ECON = {
  START: 200,
  // DOTA 式陣亡罰金:每 1 秒重生倒數,額外自玩家共用金錢扣 $10(不透支)。只罰玩家英雄/無人機。
  DEATH_PENALTY_PER_S: 10,
  ASSIST: { F: 0.25, TTL_S: 10 },
  // 重武器「持續火力耗電率」(每秒);每發電力由 heavyMpCost 依彈夾週期均攤,全武器一致(見 heavyMpCost)
  HEAVY_MP_PER_CD: 2.0,
  // 英雄賞金:機甲/變形者全額;無人機(單機,2026-07-17)≈ 機甲 ×SQUAD.HP_F(生存值 80% → 150)
  BOUNTY: { missile: 15, aasite: 40, decoy: 25, drone: 150, robot: 190, morph: 190 },
  BOUNTY_DPS_S: 8,     // 戰力公式的 DPS 權重(秒):value = EHP + DPS × 此值
  BOUNTY_F: 0.12,      // 戰力 → 金錢的匯率(10 分鐘升滿預算的主旋鈕)
  // ---- 八軌強化(2026-07-20 面向改制;全軌統一階梯定價 UPG_BASE+UPG_INC×lvl、開場 + 升 3 次)----
  // 4 戰鬥面向(帶 abil 欄):直接推進該武器/招式階級,開場 Lv1 → 升 3 次到 Lv4;成長走該武器/招式
  //   的 3 階數組 + tierVal 第 4 階外推(傷害/射速/彈夾/冷卻「全面」提升),不再有獨立精通旋鈕。
  // 4 防禦/系統(step 制):開場 Lv0 → 升 3 次。攻防曲線於 npm run bal ④ 校準,改 step/max MUST 重跑。
  UPGRADES: {
    lw:  { name: '輕武器強化', abil: 'light', desc: '輕武器全面提升(傷害/射速/彈夾)', max: 3 },
    hw:  { name: '重武器強化', abil: 'heavy', desc: '重武器全面提升(傷害/裝填/破甲)', max: 3 },
    sk:  { name: '小招強化',   abil: 'skill', desc: '小招全面提升(威力/冷卻/範圍)',   max: 3 },
    ult: { name: '大招強化',   abil: 'ult',   desc: '大招全面提升(威力/冷卻/範圍)',   max: 3 },
    hp:  { name: '裝甲強化', desc: '裝甲上限 +27%/級', max: 3, step: 0.27 },
    ar:  { name: '複合裝甲', desc: '護甲值 +10/級',    max: 3, step: 10 },
    sp:  { name: '護盾強化', desc: '護盾上限 +27%/級', max: 3, step: 0.27 },
    ch:  { name: '充能系統', desc: '護盾/電力回復速度提升(滿級 = 現役最高規格)', max: 3 },
  },
  // 全軌統一階梯(2026-08-11 使用者定案):逐階「金額 + 戰鬥分數門檻」——
  // 第一階 $75 無門檻、第二階 $150 且戰鬥分數 ≥20、第三階 $300 且 ≥100。
  // **一張表兩欄**:價格與門檻是同一個階梯的兩個維度,MUST NOT 拆成兩份表(改一邊漏另一邊)。
  // 列數 MUST = 各軌 max(逐軌 3 階);八軌全滿 = 8 ×(75+150+300) = $4200,見 npm run bal ③。
  UPG_STEPS: [
    { price: 75,  score: 0 },
    { price: 150, score: 20 },
    { price: 300, score: 100 },
  ],
  CHARGE_MIN: 0.4,     // 充能 Lv0 的回復速度比例(滿級 = 1.0 = VITALS.SP_REGEN_PS / mpRegen 現值)
};
/** 這一次購買(0-based lvl)落在階梯的哪一列;超出表尾夾在最後一列 */
const upgStep = (lvl) => ECON.UPG_STEPS[Math.min(Math.max(0, lvl || 0), ECON.UPG_STEPS.length - 1)];
/** 升級單價(八軌共用這一支 —— MUST NOT 在商店 UI / sim.buy 另寫價格) */
export const upgradePrice = (u, lvl) => upgStep(lvl).price;
/** 這一階所需的最低戰鬥分數(同上:唯一縫,商店鈕面/sim.buy/bot 採購同吃) */
export const upgradeScore = (u, lvl) => upgStep(lvl).score;
/** 買不買得起 = 錢 + 戰鬥分數兩道閘一起看(單一縫;拆開判會出現「鈕面亮著按不動」) */
export const canUpgrade = (u, lvl, money, score) =>
  (lvl || 0) < u.max && (money || 0) >= upgradePrice(u, lvl) && (score || 0) >= upgradeScore(u, lvl);
/** 充能倍率:護盾/電力回復速度 ×(CHARGE_MIN → 1.0);現役回復速度即滿級規格 */
export const chargeF = (lvl) => ECON.CHARGE_MIN + (1 - ECON.CHARGE_MIN) * (lvl || 0) / ECON.UPGRADES.ch.max;
/** 重武器每發電力(解析後 def)。輕武器不耗電。彈夾週期 = mag/rate + reload 秒,週期總耗電 =
 *  週期 × HEAVY_MP_PER_CD,均攤到每發 ⇒「持續火力耗電率」= HEAVY_MP_PER_CD/s(mag=1 時 ≈ 舊值)。
 *  2026-07-20:電力折減併入重武器階級(reload/mag 隨階變),取消獨立武器精通折減。 */
export const heavyMpCost = (def) => {
  const mag = def.mag || 1, cycle = (def.reload || 0) + mag / (def.rate || 3);
  return Math.round(cycle / mag * ECON.HEAVY_MP_PER_CD);
};

// ---- 單位數值(armor = 護甲值,吃 armorMul 減免;英雄另有 shield/mp 基準)----
export const UNITS = {
  // 小兵(雙方都是人類部隊:士兵 / 裝甲車 / 坦克)
  // 射程一律 < 防禦塔(2026-07-12 起,見 UNITS.tower):沒有「安全圍攻位」,推塔要靠人數/血量硬吃塔火。
  // hp/armor/dmg 大幅上調(2026-07-12「拉近 NPC 與玩家戰力」):小兵不再是英雄的移動經驗值 ——
  // 步槍兵 EHP 320、火箭兵一發 95,三隻步槍兵齊射就足以逼退半血機甲。
  // 2026-07-17「一波 NPC = 玩家 60% EHP」重校準:波次追加主戰坦克(使用者指示)——
  // 一波 = WAVE_SOLDIERS 步槍兵 + 火箭兵 + 榴彈兵 + 坦克 + 攻擊直升機(見 GAME.WAVE_EXTRAS)。
  // 波次總 EHP/DPS 因坦克大增 ⇒ 全員 hp/dmg 下修(armor 不動)維持同一條不變式:
  // 玩家只用 Lv1 輕武器 + 重武器照 CD 單挑整波 ⇒ 清完波後平均剩 ~40% EHP。
  // 改任一項 MUST 重跑 `npm run bal`。
  // 移動速度:坦克 9 → 12(波次凝聚錨定最慢者 —— 坦克拖到 9 整團就在爬行;12 = 榴彈兵同級)。
  soldier:   { name: '步槍兵', hp: 115, armor: 8,  dmg: 6,  range: 150, rate: 1.0, speed: 16, sight: 150, bounty: 1, wid: 'rgun' },
  rocketeer: { name: '火箭兵', hp: 150, armor: 12, dmg: 34, range: 180, rate: 0.4, speed: 15, sight: 190, bounty: 3, wid: 'rocket' },
  howitzer:  { name: '榴彈兵', hp: 180, armor: 14, dmg: 39, range: 220, rate: 0.3, speed: 12, sight: 220, bounty: 4, wid: 'siege' },
  heli:      { name: '攻擊直升機', hp: 270, armor: 14, dmg: 20, range: 175, rate: 0.8, speed: 20, sight: 220, bounty: 6, wid: 'rgun' },
  tank:      { name: '主戰坦克', hp: 390, armor: 18, dmg: 39, range: 150, rate: 0.6, speed: 12, sight: 200, bounty: 4, wid: 'siege' },
  // 舊兵種資料保留(不再於一般波次生成,供召喚/測試沿用)
  apc:     { name: '裝甲車', hp: 320,  armor: 10, dmg: 22, range: 100, rate: 0.9, speed: 11, sight: 170, bounty: 2, wid: 'rgun' },
  // 建築(防禦塔)
  // range 310(2026-07-12):**恆大於所有玩家輕武器(最大 243 = drone sight 270 × RANGE_SIGHT_F)
  // 與所有 NPC(最大 220 = 榴彈兵)**,且 > 輕武器射程 + 同塔位左右塔間距(2×TOWER_SIDE_OFF)
  // ⇒ 打其中一座塔,必定同時吃到另一座的覆蓋火力。改 sight/RANGE_SIGHT_F/TOWER_SIDE_OFF
  // MUST 重驗這條不等式(sim._spawnStructures 的塔距守衛也吃 range)。
  // hp/armor(2026-07-12):兩位機甲玩家(lvl1,無人干擾)集火單塔 ≈ 13~14s 拆掉,
  // 期間兩座塔的回擊 ≈ 1.8 × 機甲 EHP(981)⇒ 剛好擊殺一位、把另一位壓到 ~20%。
  // 推導:towerHp = 1.8 × heroEHP × heroDPS / towerDPS。改任一邊 MUST 重算(tools 的 _bal 推導)。
  tower:   { name: '防禦塔', hp: 1800, armor: 30, dmg: 65, range: 310, rate: 1.0, speed: 0,  sight: 310 },
  // base.dmg 只是佔位(UNITS 之後 derive 成 BASE_DPS_MULT × towerDps() 反解值,見該處註解),
  // range/rate 仍與塔取最大值 ⇒ 這兩欄的初始值(230/1.2)實際會生效,dmg 的初始值(90)不會。
  base:    { name: '主堡',   hp: 3000, armor: 25, dmg: 90, range: 230, rate: 1.2, speed: 0,  sight: 230 },
  // 英雄基準(實戰值 × CHARACTERS[ch].mods):護盾 shield 非戰鬥自然回復、
  // 裝甲 hp 只能回主堡 / 治療招式回復;mp = 電力(施放小招/大招 + 重武器擊發皆消耗,
  // 見 heavyMpCost);mpRegen 為「充能」滿級規格(實際回速 × chargeF(充能等級))。
  // 無人機 = 單架(SQUAD.N=1,2026-07-17):hp/shield/armor 於 UNITS 之後 derive = 機甲平均 ×SQUAD.HP_F
  // (80%;MUST NOT 手寫),傷害 = 機甲全額(heroWeapon() 唯一折算點,DMG=1)。各自重生、各自吃冷卻。
  drone: {
    name: '獵蜂無人機', hp: 0, shield: 0, mp: 100, mpRegen: 4,
    // fov/zoomFov 與機甲一致(2026-07-12):FPV 視覺大小感受度雙陣營必須相同,廣角會把同距離目標畫小。
    // sight 270(原 300,2026-07-17):單機取代小隊 —— 輕武器射程上限 = 270×RANGE_SIGHT_F = 243m,
    //   ≈ 機甲 216 的 9/8(射程較機甲高約 1/8);重武器上限(×AIM_SIGHT_MULT)仍遠 > 塔 310。
    speed: 42, vspeed: 22, fov: 68, zoomFov: 35, sight: 270,
    bomb: 'bomb',                        // F 鍵原地引爆 / 高速撞擊引爆(自毀);僚機衝刺自爆
    regen: 12,
    respawn: { base: 8, perDeath: 2 },   // 重生需冷卻,越死越久(單機獨立計數)
  },
  robot: {
    // sight 240(原 220):輕武器射程被 rangeCap 夾到 sight×0.9,220 會把全機甲輕武器砍到
    // 198m(#INC-104 的 y=250 高空射擊測試要求 ×1.25 > 250)。240 = 與變形者齊平。
    // fov 68:自然人眼的舒適垂直視角 = 全機種 FPV 基準(2026-07-12 起無人機/變形者一律對齊,
    // 雙陣營同距離目標的視覺大小才一致;差異化只靠座艙造型與視點高度)
    name: '執法者機甲', hp: 640, shield: 220, mp: 100, mpRegen: 4,
    speed: 21, jump: 9, fov: 68, zoomFov: 35, sight: 240,
    regen: 18,
    respawn: { base: 8, perDeath: 2 },   // 重生需冷卻,越死越久
  },
  // 集束轟炸機:變形者的外掛子機(長按右鍵分離發射)。hp 於生成時覆寫為 decoyHp()(砲塔火力反解);
  // speed:0 = 不進 sim 主迴圈的推線邏輯(位置由 _tickDecoys 管),但仍是敵方小兵/塔的合法目標。
  decoy: { name: '集束轟炸機', hp: 160, armor: 0, speed: 0, sight: DECOY.SIGHT },
  // 極音速飛彈:機甲的長按招式彈體(2026-08-01)。**刻意是可被鎖定/擊落的實體**(使用者定調),
  // hp 於生成時覆寫為 hyperHp();speed:0 同上(位置由 _tickHypers 管)。sight 0 = 不提供視野。
  hyper: { name: '極音速飛彈', hp: 160, armor: 0, speed: 0, sight: 0 },
  // 第三方碉堡(2026-07-17,見 THIRD):本身無傷害(range/dmg 0 ⇒ 永不鎖定目標),
  // 功能 = 駐守 3 名步槍兵(免傷 + 緩慢回血 + 射程 ×GAR_RANGE_F)。
  // hp 於 UNITS 之後 derive = 塔的一半(MUST NOT 手寫,塔一動就漂移);armor 同塔。
  bunker: { name: '碉堡', hp: 0, armor: 30, dmg: 0, range: 0, rate: 0, speed: 0, sight: 150 },
};
UNITS.bunker.hp = Math.round(UNITS.tower.hp / 2);   // 碉堡 HP = 砲塔一半(唯一推導處)
// 單架無人機生存值的唯一推導處(2026-07-17):令「無人機各角色 effective 值的平均」= 機甲(robot)
// 平均的 SQUAD.HP_F(80%),HP/護盾逐層對齊;護甲等比縮放係數 ARMOR_F 於此一併算出(套用點 heroArmor())。
{
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const dch = Object.keys(CHARACTERS).filter((c) => charKind(c) === 'drone');
  const mch = Object.keys(CHARACTERS).filter((c) => charKind(c) === 'robot');
  const modAvg = (cs, k, d) => avg(cs.map((c) => CHARACTERS[c].mods?.[k] ?? d));
  UNITS.drone.hp = Math.round(SQUAD.HP_F * UNITS.robot.hp * modAvg(mch, 'hp', 1) / modAvg(dch, 'hp', 1));
  UNITS.drone.shield = Math.round(SQUAD.HP_F * UNITS.robot.shield * modAvg(mch, 'sp', 1) / modAvg(dch, 'sp', 1));
  SQUAD.ARMOR_F = SQUAD.HP_F * modAvg(mch, 'armor', 0) / modAvg(dch, 'armor', 0);
  // 初始無人機平均總血量(護盾+裝甲)—— 防空伏擊傷害 = 此值 /3(見 GAME 之後的 AA_AMBUSH.DMG derive)
  SQUAD.DRONE_AVG_HP = avg(dch.map((c) =>
    UNITS.drone.hp * (CHARACTERS[c].mods?.hp ?? 1) + UNITS.drone.shield * (CHARACTERS[c].mods?.sp ?? 1)));
}
// ---- 陣營對抗係數對稱化(2026-07-27 使用者原則:戰力平衡須考量攻擊距離與高度差)----
// 對進戰模型(tools/duel.mjs / `npm run bal` ⑤)量到的**結構性偏差**:英雄對英雄時,
// SWARM 英雄恆是 air 類機體、STEEL/MERC 英雄恆是 armor 類 ⇒ 蜂群實際吃到的是自家武器的 `vs.armor`,
// 鋼鐵/傭兵吃到的是自家武器的 `vs.air`。兩張表各自逐武器手訂風味值(光束對空好、榴彈對甲好),
// 合計起來卻不對稱 —— 蜂群把加成大量點在 vs.air(對上機甲永遠用不到),持續火力先天矮一截,
// 於是「選哪個陣營」本身就先決定了一部分勝負。
// 校正縫 = 此處:把兩邊「對敵方陣營機體類別的持續火力平均」往**幾何中點**拉,係數由 DPS 推導
// (**MUST NOT** 手寫逐武器 vs —— 那就是 32 角一改就漂移的老病)。各武器之間的相對風味完全保留
// (整組等比縮放),且**只動跨陣營的那一欄** ⇒ 對 NPC(flesh/building)與同類目標的數值不受影響。
// K = 對稱化強度(1 = 完全對稱到中點)。**校準錨 = bal ⑤ 陣營勝率 50%**:K=1 會衝到 59% ——
// 蜂群另有射程(輕 122 vs 108 / 重 194 vs 173)、機動與閃避優勢,那些優勢原本正是被不對稱的
// vs 表隱性抵銷掉的;K=0.5 校出 50.3%(逐角色火力再微調後現值 52.7%,仍在 50±5pp 內)。
// 改 K 或任何角色武器 dmg/mag/rate/cd/vs MUST 重跑 `npm run bal`
// (校正落在跨陣營那一欄,但波次含坦克(armor)⇒ ① 的三機種剩餘率會跟著微動)。
export const CLASS_SYM = { K: 0.5, SWARM_ARMOR_F: 1, STEEL_AIR_F: 1 };
{
  // 持續火力權重 = 彈夾週期攤平的每秒發數(與 bal ①/④、duel.mjs 同一個簡化)
  const rps = (w) => {
    const mag = tierVal(w.mag ?? 1, 1), rate = tierVal(w.rate ?? 3, 1);
    return mag / (mag / rate + tierVal(w.cd ?? w.reload ?? 2, 1));
  };
  const out = (cs, cls) => cs.reduce((s, c) => s + ['light', 'heavy'].reduce((v, slot) => {
    const w = CHARACTERS[c][slot];
    return w ? v + tierVal(w.dmg, 1) * rps(w) * (w.vs?.[cls] ?? 1) : v;
  }, 0), 0) / cs.length;
  const swarm = Object.keys(CHARACTERS).filter((c) => charKind(c) === 'drone');
  const steel = Object.keys(CHARACTERS).filter((c) => charKind(c) !== 'drone');
  const oS = out(swarm, 'armor'), oT = out(steel, 'air');
  const mid = Math.sqrt(oS * oT);                       // 幾何中點:兩邊等比對調,總火力水位不漂移
  CLASS_SYM.SWARM_ARMOR_F = (mid / oS) ** CLASS_SYM.K;
  CLASS_SYM.STEEL_AIR_F = (mid / oT) ** CLASS_SYM.K;
  for (const [cs, cls, f] of [[swarm, 'armor', CLASS_SYM.SWARM_ARMOR_F], [steel, 'air', CLASS_SYM.STEEL_AIR_F]]) {
    for (const c of cs) for (const slot of ['light', 'heavy']) {
      const w = CHARACTERS[c][slot];
      if (w) (w.vs ||= {})[cls] = Math.round((w.vs[cls] ?? 1) * f * 1000) / 1000;
    }
  }
}
// ---- 剋制表夾制(建築加乘 + 反護盾獨占;唯一套用處)----
// 名冊 MUST 涵蓋所有帶 vs 的 def —— 漏一張表就是「這把武器還是拆得比較快」而且沒有任何
// 錯誤訊息。heroWeapon()/heroAbility() 的 `vs: w.vs` 是**同一個物件參照** ⇒ 夾在源頭即全鏈生效。
// **排在 CLASS_SYM 之後**是硬需求,不是排版偏好:那一段把 drone 的 armor 欄 / 非 drone 的 air 欄
// 整組等比放大,夾在它前面會被重新放回 1 以上(而且只在某些角色身上,更難察覺)。
const VS_DEFS = [
  ...Object.values(WEAPONS), DECOY, HYPER,
  ...Object.values(CHARACTERS).flatMap((c) => ['light', 'heavy', 'skill', 'ult'].map((s) => c[s])),
].filter((w) => w?.vs);
for (const w of VS_DEFS) {
  // ① 建築加乘移除(見 BUILDING_VS_CAP):加乘歸零、懲罰(< 1)原樣保留
  if (w.vs.building > BUILDING_VS_CAP) w.vs.building = BUILDING_VS_CAP;
  // ② 反護盾獨占(使用者定案「反護盾效果的武器不要有其他單位加成」):護盾軸是廣泛加成,
  //    再疊類別剋制 = 一把武器領兩份預算。懲罰同樣保留 —— 拿掉的是「加成」不是「剋制關係」。
  if ((w.vsSp ?? 1) > 1) for (const k of Object.keys(w.vs)) if (w.vs[k] > 1) w.vs[k] = 1;
}
// 傭兵變形者:HP/護盾/電力/回復/重生一律與機甲相同(spread 保證不漂移),
// 差異只有移動能力(地面 + 蓄力跳變形飛行)與視野;傷害不吃 SQUAD 折算(charKind ≠ drone)。
UNITS.morph = {
  ...UNITS.robot,
  name: '變形者',
  fly: 36, vspeed: 20,                  // 飛行型態:巡航 / 垂直速度(略慢於無人機)
  fov: 68, fovAir: 68, zoomFov: 35, sight: 240,   // 全型態 = 人眼視角(FPV 視覺大小雙陣營一致,飛行不再放寬)
};
// 主堡的武器**只有一把**(2026-08-13 使用者定案「主堡兩個武器合併,射程/範圍/傷害等參數都挑
// 最大值」)。舊制是兩把:本體火砲(dmg/rate/range 住 UNITS.base)+ 加裝雙聯裝砲(整組 derive
// 自砲塔)—— 同一棟建築掛兩套射控、兩份 CD、兩條開火路徑(主迴圈 + _tickBaseGuns)。
// 合併時射程/射速**逐項取最大值**,MUST NOT 手抄任何一個數字:
//   射程 max(主堡 230, 塔 310)/ 射速 max(1.2, 1)/ 砲管數 max(1, 2)
// 砲管數也照這條規則 ⇒ 保留兩根砲管輪替(演出不變)。
// **開火路徑因此也只剩一條**(`_tickBaseGuns`)—— sim 主迴圈那一支對 `u.guns` 的單位不開火,
// 否則合併之後反而變成三條路徑。爆風半徑見下方 STRUCT_W(同樣取兩者的較大者)。
//
// 傷害改由**總 DPS 目標**反解(2026-08-13 使用者追加定案「主堡的 DPS 提高至砲塔的 1.68 倍」):
// 兩根砲管輪替後的總輸出 DPS(n × dmg × rate)= BASE_DPS_MULT × towerDps(),唯一推導處,
// MUST NOT 手寫 dmg。改 BASE_DPS_MULT、塔的 dmg/rate、或砲管數 MUST 重跑 `npm run bal` ①④
// 與 `audit_weapon_gate`(爆風半徑吃同一個 dmg,會跟著這個目標一起動)。
export const BASE_DPS_MULT = 1.68;
UNITS.base.range = Math.max(UNITS.base.range, UNITS.tower.range);
UNITS.base.rate = Math.max(UNITS.base.rate, UNITS.tower.rate);
const BASE_GUN_N = 2;
UNITS.base.dmg = (BASE_DPS_MULT * towerDps()) / (BASE_GUN_N * UNITS.base.rate);
UNITS.base.guns = { n: BASE_GUN_N, range: UNITS.base.range, dmg: UNITS.base.dmg, rate: UNITS.base.rate };
// 擊殺賞金推導(2026-07-17;「對應難度的金錢」唯一推導處,MUST NOT 手寫表列單位):
// 賞金 = 戰力(EHP + DPS × BOUNTY_DPS_S)× BOUNTY_F,取 5 的倍數。
// 第三方(GUER/MILI)沿用正規 kind ⇒ 同一張表;改 UNITS 任一數值賞金自動連動。
// 現值:步兵 20 / 火箭 35 / 榴彈 35 / 坦克 75 / 直升機 50 / 塔 330 / 主堡 485 / 碉堡 135。
for (const k of ['soldier', 'rocketeer', 'howitzer', 'tank', 'heli', 'apc', 'tower', 'base', 'bunker']) {
  const u = UNITS[k];
  const v = u.hp / armorMul(u.armor || 0) + (u.dmg || 0) * (u.rate || 0) * ECON.BOUNTY_DPS_S;
  ECON.BOUNTY[k] = Math.round(v * ECON.BOUNTY_F / 5) * 5;
}
// ================= NPC / 建築 / 第三方的爆風半徑(2026-08-13 使用者定案)=================
// 原句:「榴彈類/導彈類等爆炸傷害爆炸時,**無論是對地或對目標發射**,都會對範圍內所有單位
// 造成傷害(閃避率各自計算)」+「**所有爆炸傷害武器都套用**」。帶 `r` 的攻擊早已如此(全部匯流
// 到 sim._blast,逐目標各自擲骰 —— 見 evadable / A45),落在規則之外的是**沒有 r 的那幾把**:
//   ・`WEAPONS.siege` 攻城榴彈砲(榴彈兵 + 坦克):名為榴彈砲、客戶端畫拋物線曳光,結算卻是單體直擊
//   ・主堡火砲(2026-08-13 起是合併後的唯一一把):連武器 def 都沒有(無 `wid`)⇒ 舊制既不可閃也不爆風
//     **防禦塔是具名例外** —— 使用者同日定案「塔換成單體攻擊武器,傷害不變」,見 STRUCT_W 檔頭
//   ・第三方防空伏擊飛彈:`boom` 事件寫著 r = 14 而結算是單發直擊(演出與結算分家的典型)
// 補上半徑之後,消費端全部是**既有**的那一支(sim NPC 分支的 `wd?.r` / `_tickBaseGuns` / `_tickMissiles`
// 各自改呼 `_blast`),**沒有第二份傷害實作**。
//
// **不在名冊裡的就是真的不爆**:`WEAPONS.rgun` 重型機槍(動能)、英雄輕武器(動能/定向能)、
// 貫穿與扇形重武器(機制上一次掃一整排,沒有「這一發瞄的是誰」)—— 它們不是爆炸傷害武器。
//
// 半徑 MUST 推導不手寫,而且**只有一條規則**:以表內既有的唯一 NPC 爆炸型(肩射火箭)為軸,
// 「爆風面積 × 火力」守恆 ⇒ r = rocket.r × √(軸的火力 ÷ 這一把的火力) —— 打得越猛,單發炸得越小。
// 「火力」有兩種單位,**軸與被算的那一把 MUST 同單位**:
//   ・持續射擊(小兵 / 塔 / 主堡):用**持續 DPS**(dmg × rate)
//   ・一次性彈藥(第三方伏擊飛彈,每架機體 3 分鐘冷卻):用**單發傷害** —— 拿 DPS 算會除到接近 0,
//     半徑當場爆掉(實測 95m)。
// 改 UNITS 的 dmg/rate 或 rocket.r 一律自動連動;**改完 MUST 重跑 `npm run bal` ①**(爆炸型自動
// 吃閃避補償 evadeComped ⇒ 對飛行機體的期望傷害會從 ×(1−p) 回到全額,那是 ① 的直接位移)。
export const NPC_BLAST = { DPS: 0, SHOT: 0 };   // 軸的兩種單位(UNITS 之後 derive)
/** 爆風半徑唯一縫:fire = 這一把的火力,anchor = 同單位的軸(NPC_BLAST.DPS 或 .SHOT) */
export const npcBlastR = (fire, anchor) => Math.round(WEAPONS.rocket.r * Math.sqrt(anchor / fire) * 10) / 10;
/**
 * 建築制式火砲的 def(唯一縫)—— 它們沒有 `wid`,舊制 def 為空 ⇒ 既不可閃也不爆風。
 * 只帶「爆風半徑 + 破甲」:傷害/射速/射程仍住 UNITS(MUST NOT 在這裡複製第二份)。
 *
 * **`tower` 刻意不在這張表裡**(2026-08-13 使用者定案「塔換成單體攻擊武器,傷害不變」):
 * 防禦塔的主砲是**單體攻擊武器**,不是爆炸彈頭。這裡 MUST 是「查不到 ⇒ def 為 undefined」而不是
 * 「給一個 `r: 0` 的 def」—— 後者會讓 `evadable()` 判 true(它的判據是排除法:不是 fan/line 就吃
 * 閃避),塔火從此可以被閃開**而且沒有補償**(`evadeComped` 要 `r > 0`)⇒ 期望傷害掉 ×(1−p),
 * 與「傷害不變」正面衝突,而畫面上只表現成「塔好像變弱了」。
 */
export const STRUCT_W = { base: { r: 0, pen: 0 } };
{
  const dps = (k) => UNITS[k].dmg * UNITS[k].rate;
  NPC_BLAST.DPS = dps('rocketeer');
  NPC_BLAST.SHOT = UNITS.rocketeer.dmg;
  // 攻城榴彈砲由**榴彈兵與坦克共用**(兩者 DPS 差一倍)⇒ 取兩者的**幾何中點**,與 mobMid/
  // speedMid/rangeMid 同一條慣例(算術平均會被快的那一邊主導)。現值 ≈18.1m(單獨算 21.6 / 15.2)
  WEAPONS.siege.r = npcBlastR(Math.sqrt(dps('howitzer') * dps('tank')), NPC_BLAST.DPS);
  // 主堡合併後只有一把武器 ⇒ 只有一個半徑,取「主堡單管 dps / 塔 dps」兩者推導值的**較大者**
  // (火力越弱、半徑越大 —— 同一條「面積 × 火力守恆」規則,MUST NOT 拿別的軸重推)。
  // 主堡總 DPS 改吃 BASE_DPS_MULT 目標(見 UNITS.base.dmg 推導)後單管 dps 會跟著動,
  // 半徑因此自動連動,MUST NOT 手寫。
  STRUCT_W.base.r = Math.max(npcBlastR(dps('base'), NPC_BLAST.DPS), npcBlastR(dps('tower'), NPC_BLAST.DPS));
  // 第三方伏擊飛彈的半徑接在 `GAME.AA_AMBUSH.DMG` 那一支 derive 的後面(它自己也是推導值,
  // 而 GAME 在本區塊之後才宣告)—— 搬上來只會拿到 TDZ。
}
// 主堡飛彈的飛行參數(2026-08-13 使用者定案「主堡改為射後不理導彈」):`sim._tickBaseGuns` 發射後
// 走既有的 `this.missiles` / `_tickMissiles` / `_samBlast` 通用飛彈追蹤機制(與第三方防空伏擊飛彈
// 同一條唯一縫,MUST NOT 另寫第二套追蹤/命中/失鎖邏輯)。飛行中可被玩家擊落(`hitMissile` 對
// `this.missiles` 一視同仁、不分來源)—— 擊落 = 完全否定,不引爆(見 A45 ⑧ 註,MUST NOT 順手改成
// 爆風)。傷害/射速/射程仍住 `UNITS.base`、爆風半徑/破甲仍住 `STRUCT_W.base`,這裡只帶飛彈本身的
// 飛行/生存值(MUST NOT 複製第二份傷害)。`TTL_PAD` 是失鎖後直線飛行的緩衝秒數,飛彈自毀上限
// = 射程 ÷ 飛行速度 + `TTL_PAD`(推導,MUST NOT 手寫成固定秒數 —— 射程一動,原本的固定值就會
// 在飛彈根本還沒到最大射程時提前自毀)。
export const BASE_MISSILE = { SPEED: 110, HP: 70, LAUNCH_Y: 20, TTL_PAD: 3 };

// ---- 平民與間諜(2026-07-18;非兵線隨機放置的非戰鬥人員,DOTA 野區思想的變體)----
// 每陣營在非兵線空曠處隨機生成 ~10 名(隨兵線數縮放),其中 SPY_RATE(1/10)為間諜(9:1)。
// 外觀「只能分辨陣營、無法分辨間諜」:平民與間諜共用模型(models.js buildCivilian),
// 陣營僅靠貼地 teamRing / 頭頂陣營箭頭辨識;唯一的行為破綻是「移動速度」——
// 平民 = 步槍兵 ×CIV_SPEED_F(0.5)、間諜 = ×SPY_SPEED_F(0.66),細看走位可分辨。
// 是 neutral ent(NPC 永不鎖定、恆可見、可被玩家武器/爆風擊殺),伺服器權威 _tickCivilians。
// 陣亡後 RESPAWN_S 秒於隨機合法點重生(保留陣營/間諜身分維持 9:1,職業與位置重抽)。
//
// 擊殺報酬(以步槍兵賞金 ECON.BOUNTY.soldier 為單位;平民一律負值 = 誤殺平民有損失):
//   我方平民 −1 / 敵方平民 −0.33 / 我方間諜 −3 / 敵方間諜 +6(唯一正報酬 = 揪出敵方間諜)。
// 互動(靠近 INTERACT_R 內):驅趕(逃離後消失)或要求跟隨,兩者不分陣營皆可。
//   我方跟隨者(cs === 玩家陣營)存活時每 FOLLOW_REWARD_S(3 分)給一次報酬 ——
//   依職業給 medkit/battery/money(見 CIVILIANS.reward),量 = 小空投(S,FOLLOW_MUL)。
export const CIVILIAN = {
  PER_SIDE_BASE: 6, PER_SIDE_PER_LANE: 2,   // 每側數量 = BASE + PER_LANE × 兵線數(1/2/3 → 8/10/12)
  SPY_RATE: 0.1,                            // 9:1 平民:間諜
  RESPAWN_S: 30,                            // 陣亡後於隨機合法點重生的延遲(維持全場平民數量)
  HP: 40, ARMOR: 0,                         // 低血:一輪點放即倒
  CIV_SPEED_F: 0.5, SPY_SPEED_F: 0.66,      // × 步槍兵移速(UNITS.soldier.speed = 16 → 8 / 10.56)
  LANE_MIN: 60,                             // 非兵線位置(距兵線走廊最小距離)
  BASE_CLEAR: 90,                           // 距主堡/重生點淨空
  WANDER_R: 45,                             // 徘徊半徑(繞出生點慢走)
  WANDER_PAUSE: [1.5, 4.5],                 // 抵達路點後停留秒數區間
  INTERACT_R: 22,                           // 玩家互動半徑(靠近可驅趕/跟隨)
  FOLLOW_R: 9,                              // 跟隨時保持的距離
  FOLLOW_LINK_M: 260,                       // 跟隨者離主人超過此距離 = 失聯,回復徘徊
  FOLLOW_REWARD_S: 180,                     // 我方跟隨者每 180s 給一次報酬
  FOLLOW_MUL: 1.0,                          // 報酬量 = 小空投(S)
  FLEE_SPEED_F: 1.35,                       // 被驅趕後逃離速度(× 自身移速)
  FLEE_TTL_S: 6,                            // 逃離後消失
  KILL_F: { ownCiv: -1, enemyCiv: -0.33, ownSpy: -3, enemySpy: 6 },   // × ECON.BOUNTY.soldier
};
// 平民/間諜移動速度(m/s):唯一辨識破綻(伺服器 _tickCivilians 與客戶端估算共用)
export const civSpeed = (spy) => UNITS.soldier.speed * (spy ? CIVILIAN.SPY_SPEED_F : CIVILIAN.CIV_SPEED_F);
// 平民職業圖鑑(男 10 + 女 10;展示台可逐一檢視)。
// 外觀差異化(2026-07-18):models.js buildCivilian 依 name 給每種職業專屬服裝剪影
// (頭飾 + 罩衫 + 招牌配件,如醫師白袍聽診器 / 廚師高帽 / 建築工反光背心工具帶……);
// hat/bag 僅供備援 __def 分支使用。服裝一律中性/職業色,MUST NOT 用雙方陣營標誌色
// (SWARM 琥珀 #ffb300 / STEEL 冷藍 #4fc3f7)。reward = 我方跟隨者每 3 分提供的物資種類。
export const CIVILIANS = [
  // 男性 10 種
  { name: '醫師',       g: 'M', reward: 'medkit',  hat: 0xf2f2f2, bag: 0xc0392b },
  { name: '工程師',     g: 'M', reward: 'battery', hat: 0xe8621f, bag: 0x556070 },
  { name: '商人',       g: 'M', reward: 'money',   hat: 0x6e4b2a, bag: 0x3b2a1c },
  { name: '廚師',       g: 'M', reward: 'money',   hat: 0xf4f4f0, bag: 0x7a2e2a },
  { name: '電工',       g: 'M', reward: 'battery', hat: 0xc0362f, bag: 0x2b3550 },
  { name: '教師',       g: 'M', reward: 'money',   hat: 0x4a4e86, bag: 0x6f3f7a },
  { name: '農夫',       g: 'M', reward: 'medkit',  hat: 0xb59a58, bag: 0x5f6a34 },
  { name: '記者',       g: 'M', reward: 'battery', hat: 0x3a4150, bag: 0x2b3038 },
  { name: '郵差',       g: 'M', reward: 'money',   hat: 0x2f6b45, bag: 0x244f34 },
  { name: '建築工',     g: 'M', reward: 'battery', hat: 0xd9591f, bag: 0x6b6b6b },
  // 女性 10 種
  { name: '護理師',     g: 'F', reward: 'medkit',  hat: 0xf2f2f2, bag: 0xd8657f },
  { name: '藥師',       g: 'F', reward: 'medkit',  hat: 0xe8eef0, bag: 0x2f9e6a },
  { name: '銀行員',     g: 'F', reward: 'money',   hat: 0x3a4250, bag: 0x2b3038 },
  { name: '程式設計師', g: 'F', reward: 'battery', hat: 0x6b4f9e, bag: 0x3a2f5a },
  { name: '會計師',     g: 'F', reward: 'money',   hat: 0x7d6fae, bag: 0x4a4470 },
  { name: '律師',       g: 'F', reward: 'money',   hat: 0x2a2f38, bag: 0x5c2a34 },
  { name: '獸醫',       g: 'F', reward: 'medkit',  hat: 0xefe7d3, bag: 0xcf4d4a },
  { name: '技師',       g: 'F', reward: 'battery', hat: 0xbf4f2f, bag: 0x455060 },
  { name: '攤販',       g: 'F', reward: 'money',   hat: 0xcf6a34, bag: 0x7a5330 },
  { name: '心理師',     g: 'F', reward: 'medkit',  hat: 0xa86ab8, bag: 0xdcc7e4 },
];
// 平民單位數值(neutral ent;無戰鬥屬性 —— 展示台/傷害只讀 hp/armor/speed)
UNITS.civilian = {
  name: '平民', hp: CIVILIAN.HP, armor: CIVILIAN.ARMOR,
  speed: Math.round(UNITS.soldier.speed * CIVILIAN.CIV_SPEED_F),
};

// ---- 第三方軍隊(2026-07-17;遠離兵線的中立武裝,DOTA 野區思想:交戰可獲得金錢)----
// 每條兵線兩側各駐守一團(總團數 = 兵線數 × 2):游擊隊 GUER / 武裝民兵 MILI 各踞一側。
// 佈營硬約束:離雙方每座砲塔與主堡的距離 ≥ 該工事射程 × CLEAR_F(1.25 = 塔 388m)—— 絕不與正規戰線交火;
// 另離兵線走廊 ≥ LANE_MIN(> 全 NPC 最大射程 220 + 緩衝 ⇒ 兵線上的部隊不會被野營射到)。
// 開戰即生成,單位走一般迷霧規則(非 neutral、碉堡非 tower/base)⇒ 開始時全數藏在戰爭迷霧。
// 行為:駐守碉堡周圍;追擊離碉堡 > TETHER_M 立即撤回(HOME_R 內解除);
// 步槍兵 HP ≤ GAR_ENTER_F 躲進碉堡(免傷 + GAR_REGEN_PS 回血 + 射程 ×GAR_RANGE_F,回滿出堡)。
// 重生:碉堡 BUNKER_RESPAWN_S 原地重生(倒數恆走);其他單位 UNIT_RESPAWN_S,
// 碉堡不存在時單位重生「暫停倒數」(碉堡回來才繼續)。
export const THIRD = {
  SIDES: {
    GUER: { name: '游擊隊',   color: '#7ed957', colorDim: '#3f7a2c' },
    MILI: { name: '武裝民兵', color: '#e0714f', colorDim: '#8a3a24' },
  },
  COMP: {
    GUER: ['soldier', 'soldier', 'soldier', 'rocketeer', 'tank'],
    MILI: ['soldier', 'soldier', 'soldier', 'howitzer', 'heli'],
  },
  CLEAR_F: 1.25,         // 離砲塔/主堡淨空 = 工事射程 × 此倍率(= 塔 388m)。硬不變式:淨空 > max(塔射程 310,
                         //   野營最大射程 220)= 310 ⇒ 雙方互不可及、絕不交火 ⇒ MUST > 1.0(此值留 78m 緩衝)。
                         //   2026-07-18:1.5→1.25 讓 L2(兩線相擠)也生滿野營;改此值 MUST 重跑 camp 冒煙(見 §3)
  LANE_MIN: 260,         // 離兵線走廊最小距離(> NPC 最大射程 220 + 40 緩衝:野營不掃兵線)
  LANE_MAX: 560,         // 佈營取樣最遠側偏
  SPACING: 140,          // 營地彼此最小間距
  FORM_R: 13,            // 駐守編隊半徑(繞碉堡站位)
  EXIT_ARC: Math.PI / 3, // 出堡/重生扇形半角(60°):駐守與重生位集中在朝兵線的清空側,而非整圈環列
  BLD_CLEAR_R: 16,       // 碉堡淨空半徑(> FORM_R 13 + 碉堡半徑):重疊建物(客戶端移除)與 LOS 遮蔽柱(伺服器)同步清此半徑內
  TETHER_M: 90,          // 追擊繫繩:離碉堡超過即刻放棄交戰撤回
  HOME_R: 26,            // 撤回解除半徑(回到碉堡周圍)
  AGGRO_TTL: 8,          // 被攻擊 → 記仇追擊攻擊者的持續秒數(過期回一般防衛;追擊仍受 TETHER_M 繫繩上限)
  GAR_ENTER_F: 0.5,      // 步槍兵 HP ≤ 50% 躲進碉堡
  GAR_EXIT_F: 1.0,       // 回滿血出堡
  GAR_REGEN_PS: 0.03,    // 駐守回血:每秒上限血量 3%(緩慢)
  GAR_RANGE_F: 0.75,     // 駐守射程 = 3/4(射孔限制)
  GAR_CAP: 3,            // 碉堡容量:3 名步槍兵
  UNIT_RESPAWN_S: 60,    // 單位重生 1 分鐘(碉堡不存在時暫停倒數)
  BUNKER_RESPAWN_S: 180, // 碉堡 3 分鐘原地重生(恆倒數)
  CLEAR_CIVS: 4,         // 首次清空整營(碉堡 + 全單位皆亡)脫困的平民數:隨機陣營、自動跟隨清營者、不重生
};
export const isThirdSide = (s) => s === 'GUER' || s === 'MILI';
/** 陣營資訊統一查表(SWARM/STEEL/第三方皆可):客戶端配色/播報用,查無給中性灰 */
export const sideInfo = (s) =>
  SIDES[s] || THIRD.SIDES[s] || { name: '不明勢力', color: '#9aa39b', colorDim: '#4d524c' };

// ---- 對局節奏(緊湊化:1/2/3 線目標 5/8/10 分鐘一場)----
export const GAME = {
  TICK_MS: 125,               // 伺服器模擬 8Hz
  SNAP_MS: 125,               // 快照廣播 8Hz
  // 波次節奏(2026-07-30 使用者定案:**爆兵頻率改成固定**,不再逐波加速)。
  // WAVE_S = 20 的由來:舊制「34s 起,第 4~14 波線性加速到 14s」在 bal ③ 的 10 分鐘視窗內
  // 出兵 27 波(540s / 27 ≈ 20.0s)—— 取同一個平均值,經濟校準(③ 的波數預算)不因改制位移。
  // 改此值 MUST 重跑 `npm run bal`(③),且開場預置兵線的間距同步變動(見 waveSpacingM)。
  WAVE_S: 20,
  FIRST_WAVE_DELAY_S: 0,      // 開局即出第一波(從主堡出發),不再空等對線
  WAVE_SPAWN_OFF_M: 34,       // 波次生成點離己方主堡的沿線距離:落在主路線上、出主堡外(base R 22)
  WAVE_COHESION_M: 26,        // 同波僚兵最大脫節距離:領先者原地等最慢的(交戰中除外)
  WAVE_SOLDIERS: 3,           // 每波每兵線步槍兵數(固定編制另見 WAVE_EXTRAS)
  // 波次固定編制(2026-07-17 追加坦克):sim._spawnWave / tools/balance.mjs / e2e 共用唯一真相,
  // MUST NOT 在任何一處手抄編制;改編制 MUST 重跑 `npm run bal`(60% EHP 不變式)。
  WAVE_EXTRAS: ['rocketeer', 'howitzer', 'tank', 'heli'],
  HELI_ALT: 26,               // 攻擊直升機巡航高度(公尺;純視覺+高空降權判定用)
  AIM_SIGHT_MULT: 1.6,        // 瞄準模式視野加成(狙擊模式看得更遠)
  // 「長按右鍵 / 觸控 R」達此秒數 → 觸發機種專屬招(無人機飽和攻擊 / 機甲極音速飛彈 / 變形者集束炸彈)。
  // **一般模式與狙擊模式皆可觸發**(2026-07-27):舊版限定狙擊模式,等於要先短按切模式再長按,
  // 貼身遭遇時來不及;現在兩種模式的長按走同一條判定,不必先切換。
  // 短按右鍵仍 = 切換一般/狙擊模式;達門檻才出招(觸發後放開不再切換,兩者不衝突),能力各有獨立 CD。
  // 左鍵射擊與此無關(狙擊模式重武器照常連射)。純客戶端輸入計時。
  ABILITY_HOLD_S: 0.5,
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
  // 規則 #5(2026-07-23 使用者定奪):兵線穿隧道/地下道時,落在**覆蓋段內**的砲塔至少要有
  // 這個比例的射程伸出洞口之外 ⇒ 塔到最近洞口的沿線距離 ≤ range ×(1 − 此值)。
  // 動機:隧道側牆對 LOS 全擋(sim._slabBlocked),埋在山體深處的塔只能沿 9m 洞內走廊對射;
  // 敵我前線塔一深一淺時淺的那座單方面壓制(現尺度 range 155 < 深塔距洞口 161 = 連洞口都打不到)。
  // 判定縫 = towerTunnelAudit();稽核 tools/audit_lane_grade_sep.mjs、選線 tools/bake_venue_lanes.mjs。
  TOWER_TUNNEL_OUT_F: 0.2,
  // 直射武器的鎖定天花板(公尺):高過此高度的飛行單位塔砲/小兵打不到(交給 SAM)。
  // MUST 與 range 脫鉤 —— 綁 range×0.9 的話,塔射程一拉高就會把 #INC-104 的 y=250 高空機也鎖住。
  GUN_CEIL_M: 170,
  CREEP_AGGRO_HERO_BIAS: 0.7, // 小兵優先打小兵/建築,英雄目標權重
  HERO_HEAL_RADIUS: 160,      // 主堡服務半徑:軍械庫購物範圍 + 地形整平(治癒光暈半徑見 HERO_HEAL_R)
  HERO_HEAL_R: 80,            // 主堡治癒光暈半徑(補裝甲 + 貼地光環)= 服務半徑一半
  // 出生/重生點:主堡朝敵方向外推距離。> 主堡護盾半徑 30 + 模型半徑 ~23,
  // 剛好落在堡外、遠在補血半徑內(舊值 100 是 8× 超尺度世界時代校的,重生跑回堡太遠)
  HERO_SPAWN_OFF: 45,
  // 出生/重生點橫向偏移(公尺):沿兵線推出主堡後偏到路旁,避開兵線中央的 NPC 波次生成點與行進隊列
  // (伺服器 _spawnPoint 與客戶端 _spawnAt 共用此值)。> 波次抖動 ±7 + 最大機體半徑(坦克 1.9)+ 自機半徑,
  // 一出生就不會被剛生出的兵線 NPC 撞到;仍 < 走廊半寬 LANE_SAFE_M 45(貼著兵線,正對兵線箭頭)。
  HERO_SPAWN_SIDE: 18,
  BASE_ARMOR_NEED_CREEP: 0.35,// 沒有己方小兵在場時打主堡的傷害折減
  AA_MIN_ALT: 40,             // 兵線走廊上:防空飛彈只鎖定離地 ≥ 40m 的無人機(低飛吃塔砲)
  LANE_SAFE_M: 45,            // 正規路線走廊半寬(僚機歸隊/地形不放大的走廊)
  // 第三方打擊(地雷 / 匿蹤防空伏擊)的「非正規路線」判定半徑(2026-07-12):
  // **稍微偏離主要路線不該被打到** ⇒ 觸發與佈設淨空一律用這個(遠大於走廊半寬 45),
  // 且雷區/陣地另外避開主堡、重生點與砲塔。MUST NOT 改回用 LANE_SAFE_M 當伏擊閘門。
  AMBUSH_M: 110,
  // 第三方打擊總量(2026-07-12;2026-07-17 修:防空砍為地雷的 1/3):
  //   地雷打擊面積 = THREAT_AREA_PER_LANE(m²);防空打擊面積 = 地雷 × THREAT_AA_AREA_FRAC(1/3)。
  //   地雷:PER_LANE × π×R²(由面積反推顆數);防空:AA_SITES_PER_LANE × π×range²(由面積反推射程)。
  //   兩者一律在下方 derive(**MUST NOT** 手寫 MINES.PER_LANE / AA_SITE.range)。
  THREAT_AREA_PER_LANE: 20000,
  THREAT_AA_AREA_FRAC: 1 / 3,   // 防空打擊總面積 = 地雷總面積的 1/3(密度 = 地雷 1/3;見下方 AA_SITE.range derive)
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
  // 匿蹤防空伏擊(非正規路線的無人機):飛彈可被擊毀。觸發需射程內有存活的匿蹤防空陣地(aasite)。
  // DMG(2026-07-17)= 初始無人機平均總血量的 1/3,於 FIELD 之後 derive(**MUST NOT** 手寫);
  //   不再命中即墜 —— 一發約削去三分之一血量。
  AA_AMBUSH: { CHANCE_PER_S: 0.22, DMG: 0, SPEED: 130, HP: 40, PEN: 20 },
};
// ---- 閃避(2026-07-14)----
// 有效機動(移速)> MOBILITY_MIN 的機體,在「移動中」有機率完全閃開一擊(範圍見 evadable);
// 飛行單位額外加成(蜂群靠機動求生)。純伺服器結算(命中本就 server-authoritative,
// 客戶端只回報命中)。**只在移動中生效** ⇒ bal 的靜止對射清波情境不受影響(仍是站樁 DPS)。
export const EVASION = {
  MOBILITY_MIN: 20,   // 有效移速(m/s)> 此值才具閃避 —— 重甲慢速機體站著吃彈
  MOVING_SPD: 3,      // 判定「移動中」的最低瞬時速度(m/s)
  GROUND: 0.20,       // 地面移動:閃避率
  AIR_BONUS: 0.15,    // 飛行單位(無人機 / 變形機飛行型)額外加成
  P_MAX: 0.95,        // 閃避率硬上限(舊制手寫在 lanesim,2026-08-12 收進來 —— 補償係數的分母就是 1−p)
};
/**
 * 這一擊吃不吃閃避(**唯一縫**;sim / duel / lanesim / balance 四個消費端 MUST 全走這一支,
 * MUST NOT 任一端自己比對 `def.id === 'light'` 或 `!def.r`)。
 *
 * 2026-08-11 使用者定案:**輕武器直射 + 一切爆炸傷害**(爆炸型重武器、攻擊招式、載具戰鬥部、
 * NPC 肩射火箭)。原句是「爆炸傷害爆炸時,就算沒擊中原先的目標,也會造成範圍傷害(閃避率各自
 * 計算)」—— 語意不是「爆炸可以整發打空」,而是**閃避降級成逐目標的事**:爆風照樣鋪開,範圍內
 * 每個目標各自擲自己的骰,閃掉的只是自己那一份。同時退場兩條舊規則:
 *   ・「有爆風 r ⇒ 不可閃」(舊 sim NPC 分支註解:火箭/榴彈/塔砲是 AoE / 制式火砲,不可閃)
 *   ・「招式不吃高度差/閃避/爆擊」的閃避那一半(高度差與爆擊仍不吃 —— AoE 不爆是另一條定案)
 *
 * 判據寫成**排除法**(扇形與貫穿以外全部吃閃避)而不是列舉「輕武器 + 有 r 的」——
 * 列舉法會在 NPC 那半靜默失效:小兵武器的 def(WEAPONS 的 rgun/rocket/siege)**沒有 `id`**,
 * 拿 `def.id === 'light'` 判會把重型機槍/攻城砲判成不可閃,而它們自 2026-07-14 起一直是可閃的。
 * 同理也不能拿 `aoeClass(def) === 'blast'` 判爆炸 —— 那條認 blast 的前提正是 `def.id === 'heavy'`,
 * 招式與 NPC 火箭都不帶 `id` ⇒ 會被判成「非爆炸」。反過來,`fan`/`line` 這兩類 `aoeClass` 認得出
 * 來的**只有**英雄重武器,正好就是要豁免的那一批。
 * 扇形(fan)與貫穿(line)**依機制豁免**:錐/圓柱一次掃過整排目標,沒有「這一發瞄的是誰」可閃。
 * `def` 為空(塔/主堡的制式火砲無 `wid`)一律不可閃。
 */
export const evadable = (def) => {
  if (!def) return false;
  const cls = aoeClass(def);
  return cls !== 'fan' && cls !== 'line';
};
// ---- 閃避補償(2026-08-12 使用者定案「維持 DPS 提高傷害,閃避率不動」)----
// 把爆炸傷害納入閃避,代價是它對機動機體的期望輸出整組 ×(1−p) —— 實測讓 bal ①⑤⑦e 三項出界。
// 使用者的收法**不是調閃避率**,而是把被閃掉的那一份**還給沒被閃掉的那幾發**:
//     期望傷害 = dmg × (1−p) × 1/(1−p) ≡ dmg
// ⇒ 期望 DPS 逐位元同改制前(平衡模型是算期望值的 ⇒ `npm run bal` 逐項回到基準),
//   閃避對爆炸傷害從「整組減傷」變成**純方差**:閃掉就是 0,沒閃掉就吃更重的一發。
//
// 三條紀律:
//   ① **只補「這一輪新納入閃避的那一批」= 一切爆炸傷害**。輕武器直射自 2026-07-14 就吃閃避,
//      它的基準 DPS 早就含著那份損失 —— 補它等於憑空加傷(`evadeComped` 因此不是 `evadable`)。
//   ② 分母的 p MUST 是**那個目標自己的**閃避率(逐目標,與 `_blast` 的擲骰同一個 p)。
//      拿全體平均當單一係數的話,閃不掉的小兵/建築/重甲會平白吃到那份補償 —— 那是通膨不是補償。
//      p = 0 ⇒ 係數恆 1 ⇒ 這些目標逐位元同舊制。
//   ③ p 夾在 `EVASION.P_MAX`:分母是 1−p,沒有夾就會在 p→1 時炸掉。
// **副作用要知道**:閃避對爆炸傷害的**期望減傷因此是 0**,帶閃避增額的招式(如 t02 滿級 +0.48)
// 對爆風只剩「全有全無」的價值。這是「維持 DPS」這四個字的直接推論,不是實作漏掉了什麼。
/** 這一擊的閃避要不要補償(= 這一輪新納入閃避的那一批:一切爆炸傷害) */
export const evadeComped = (def) => evadable(def) && (def?.r || 0) > 0;
/** 補償係數:被閃掉的期望輸出還給沒被閃掉的那幾發(p = 該目標自己的閃避率) */
export const evadeCompF = (p) => 1 / (1 - Math.min(Math.max(p || 0, 0), EVASION.P_MAX));
/** 期望傷害倍率(平衡模型用 —— 伺服器是擲骰,這是它的期望值) */
export const evadeExpF = (def, p) => {
  if (!evadable(def)) return 1;
  const pc = Math.min(Math.max(p || 0, 0), EVASION.P_MAX);
  if (!evadeComped(def)) return 1 - pc;
  // 補償後的期望值 = (1−p) × 1/(1−p) ≡ 1。**MUST 寫成恆等式而不是把兩個浮點數乘起來**:
  // 乘出來是 0.9999999999999999,而 duel/lanesim 是長時間步進模擬 —— 那一位會被放大成
  // ±1pp 的勝率漂移(實測 ⑤ 的 s02 80%→79%、⑦e 23.0%→23.1%),看起來就像平衡真的動了。
  // 之後若給補償加上限(讓閃避重新有期望減傷),這一行 MUST 跟著改回真的相乘。
  return 1;
};

// ================= 高地壓制(2026-08-12 使用者定案)=================
// 原句:「**高度優勢越高時,被擊中後的 1 秒內 命中率/閃避率與速度下降越多**」。
//
// 這一條補上了高度差這一軸長年缺的**代價**。ALTITUDE 那一組給的是「較高方 +射程 / +閃避,
// 攻擊爆擊↓、受擊爆擊↑」—— 全部是**開火前就結算好**的靜態修正,於是搶到高地之後沒有任何事
// 會把它拿回去。高地壓制把它改成**有條件的優勢**:站得越高,一旦被打到,接下來 1 秒越打不準、
// 越閃不掉、越跑不動 ⇒ 高地是**先手**優勢而不是**持續**優勢(持續火力下每一發都會續期,
// 這不是漏算,而是這條規則的重點 —— 被壓制住就該一直被壓制住,直到脫離接觸)。
//
// 五條紀律:
// ① **強度只有 `altScale` 一把尺**:與 +射程 / +閃避 / 爆擊代價共用同一條斜坡(1 個砲塔高起算、
//    3 個砲塔高封頂)⇒ 「優勢越高、代價越大」是同一條線的兩端,MUST NOT 另立門檻或曲線。
// ② **沒有高度優勢 = 逐位元同舊制**:`dh ≤ 門檻` ⇒ f = 0 ⇒ 三個倍率全 1、`highSupMissP` 退化成
//    純閃避。bal ①②④⑥⑦ 全是同高度模型 ⇒ 一格未動;動的只有 ⑤(唯一掃高度差的那一支)。
// ③ **相對的是「打你的那個人」**:高度優勢由 `sim._altDh(目標, 攻擊者)` 取,與射程/爆擊/閃避
//    三處加成同一支。沒有攻擊者的傷害(地雷/火場/沼澤/淹水)不留壓制 —— 那沒有「相對誰的高度」。
// ④ **命中率下降 = 這一發打不中的機率**,與目標閃避是**兩個獨立事件**(MUST NOT 直接相加:
//    兩者都 0.6 相加會超過 1)。伺服器只擲**一顆**骰(`sim._missP`),但閃避補償 `evadeCompF`
//    的分母 MUST 仍只吃**閃避那一半** —— 補償是 A45 ⑦「維持 DPS」的規則,壓制不在那個帳裡,
//    把壓制也補回去等於這條新規則對爆炸傷害完全沒有作用。
// ⑤ **速度只在「位置權威」那一端折**:真人住客戶端 `game._mobility`、電腦玩家住 `bots._speed`
//    (各自唯一取速處)⇒ 伺服器 MUST NOT 再對真人折一次(同 FLIGHT 的受擊掉高)。
// **三個值的上界是 bal ⑤c(較高方勝率 50±3pp),不是手感**:壓制只發生在較高的那一方身上 ⇒ 它是
// 高度差這一軸的**淨扣分**,而 ⑤c 要求高地在期望勝負上維持中性。實測逐軸代價(⑤c 相對無壓制的基準):
//   ・HIT 0.30 → −9.2pp(最貴:折的是**持續輸出**,而高地的報酬 +25% 射程只在接近期兌現一次)
//   ・DODGE 0.60 → −3.2pp(0.35 就已經 −2.9pp:曲線在此**飽和** ⇒ 這一軸買大送小,值得吃滿)
//   ・SPEED 0.30 → **0.0pp**(對進戰模型只有兵線一個空間自由度,機動幾乎沒有價格;⑦ 是同高度模型
//     也量不到 ⇒ 這一軸**沒有任何離線模型在守**,唯一守門是真機冒煙)
// 把 ATK/RCV 爆擊代價縮到 1/5 之後仍只剩約 6pp 的預算 ⇒ HIT 只吃得起 0.04。
// **要更強 MUST 先動 ⑤c 的目標**(那是 2026-07-27 使用者原則「高地換視野與機動,不換勝負」),
// MUST NOT 直接調大這三個值把 ⑤c 撞紅。
export const HIGH_SUP = {
  FLOOR: 0.60,    // 跨過門檻那一階（見 highSupF）
  DUR_S: 1,        // 使用者定案:被擊中後 1 秒(持續火力下逐發續期)
  HIT: 0.10,       // 命中率下降(封頂;實得 = 此值 × f)—— 預算被 ⑤c 夾住,見上方
  DODGE: 0.60,     // 閃避率下降(封頂):曲線飽和點,這一軸的性價比最高
  SPEED: 0.30,     // 移動速度下降(封頂):離線模型量不到 ⇒ 唯一守門是真機冒煙
};
/**
 * 這一擊在目標身上留下的壓制強度 f ∈ [0,1](dh = 目標視線高 − 射手視線高;無高度優勢 = 0)。
 *
 * **形狀 MUST 是「跨過門檻的一階 + 隨高度的斜坡」,不是純斜坡** —— 這是量出來的,不是手感:
 * 高地的**報酬**在對進戰模型裡就是這個形狀(同機體鏡像對局的剩餘 EHP 差:只有 +射程、其餘全關時
 * s=0.25 就已經 +12.8pp、s=1.00 +25.3pp ⇒ 斜率 16.7pp/s **加上 8.6pp 的截距**)。
 * 截距的來源是機制本身:一旦射程勝過對方,接近期那段單方面輸出就整段拿到手,再多的射程只是線性加碼。
 * 代價若寫成純斜坡(f = altScale),斜率可以配平但那 8.6pp 的截距**永遠配不掉** ——
 * 實測就是「不管站多高,較高方恆多留 8.7% EHP」,而逐項斷言全綠。
 * `FLOOR` 就是那一階;仍然「越高越多」(FLOOR 之上還有 (1−FLOOR)·altScale 的斜坡),
 * 且門檻以下(altScale = 0)一律 0 ⇒ 沒有高度優勢的路徑逐位元同舊制。
 */
export const highSupF = (dh) => {
  if (!(dh > 0)) return 0;
  const s = altScale(dh);
  return s > 0 ? HIGH_SUP.FLOOR + (1 - HIGH_SUP.FLOOR) * s : 0;
};
/** 閃避率倍率(套在 `_dodgeP` 的結果上) */
export const highSupDodgeF = (f) => 1 - HIGH_SUP.DODGE * (f || 0);
/** 移動速度倍率(兩個位置權威端各自套一次) */
export const highSupSpeedF = (f) => 1 - HIGH_SUP.SPEED * (f || 0);
/** 「這一發打不中」的機率 = 目標閃避 ⊕ 射手失準(獨立事件;f = **射手**身上的壓制強度) */
export const highSupMissP = (dodgeP, f) =>
  1 - (1 - Math.min(Math.max(dodgeP || 0, 0), EVASION.P_MAX)) * (1 - HIGH_SUP.HIT * (f || 0));
// ================= 移速壓縮:機體之間的移速拉近差距、排序不變(2026-08-04 使用者定案)=================
// 使用者需求:「所有機體的移動速度拉近差距,但排序不變」。形狀與 FIRE_RATE(射速壓縮)同款 ——
// 一條**嚴格遞增**的冪次曲線,而不是分段表或整數倍率(整數倍率會把排名當場翻掉)。
//
// ① 軸取**幾何中點**而非帶底(這是與 FIRE_RATE 唯一的形狀差別,理由在「有沒有補償機制」):
//    射速壓縮有 dmg ÷ f、mag × f 兩欄同步把 DPS 補回來,所以錨在帶底(全體只降不升)不會改水位;
//    移速沒有那種補償欄 —— 錨在帶底就是**全體變慢**(一場對局的節奏整個拖掉),那不是「拉近差距」。
//    錨在幾何中點 ⇒ 快的降、慢的升,而壓縮後整組的幾何中點**逐位元不動**
//    (geo(MID·(v/MID)^K) = MID·(geo(v)/MID)^K = MID),與 CLASS_SYM / AOE_BUDGET.NORM /
//    BUILD_DPS ②「收斂 MUST 是重分配而非削弱」同一條紀律。
// ② 中點 `speedMid()` **推導不手寫**:任一機種基準或任一角色 `mods.speed` 一改,軸自己跟著走。
//    取樣面 = 每台機體的**每一種型態**(32 台的地面速 + 8 台變形者的飛行巡航速)—— 變形者飛起來
//    也是一台在跑的機體,漏掉它就等於「飛行型態不受壓縮」,而畫面上只表現成變形者飛行時特別快。
// ③ K 是**壓縮強度**:壓縮後的全距比值 = 舊比值 ^ K(現值 0.5 ⇒ 2.67× → 1.63×)。
//    K = 1 逐位元回到舊制(反向驗證用);K = 0 = 全員同速(排序資訊整個消失,MUST NOT)。
//    校準錨 = `npm run bal` ①④⑤⑦ 四條 —— 移速同時牽動 EVASION(閃避門檻 MOBILITY_MIN)與
//    MOB_BUDGET(機動越高基礎火力越低),K 一動兩邊一起漂,MUST 四條一起看。
//    **K 有實測下界**(2026-08-04 逐值掃描 1 / 0.6 / 0.5 / 0.4 / 0.3):K ≤ 0.4 起 ④ 的變形者
//    「滿級單推同塔位雙塔」剩餘 EHP 掉到 −0.0%(= 第二座塔推不掉)。0.5 是「四條同時全綠」的
//    最強壓縮 —— 再往下要先處理 ④ 那一條的邊際,MUST NOT 只因為「差距還能更小」就調過頭。
//    (壓縮**改善**了另外三處:⑤ 射程壓制 35.0% → 28.1%、角色離群 11~80% → 17~76%、
//     ⑦c robot vs morph 64.1% → 56.8% —— 移速差距本來就是那幾條的離群來源之一。)
// ④ **唯一縫 = `heroMobility`**:客戶端物理(game._mobility)、電腦玩家(bots._speed)、伺服器閃避
//    (sim._dodges)、兩支平衡模型(duel / lanesim)、圖鑑六角圖一律經此取速 ——
//    MUST NOT 在任何消費端讀 `UNITS[kind].speed × mods.speed`(那是**壓縮前**的原始值,
//    第二份實作的症狀是「圖鑑寫 12、實際跑起來是 9.45」這種只能靠碼表抓的無聲分歧)。
// ⑤ `speedMid()` 惰性定案並快取 ⇒ 首次呼叫必然在 `COMBAT_SCALE` 統一縮放**之後**(同 buildDps ③);
//    曲線對整體縮放是齊次的(MID 與 v 同步縮 ⇒ 結果同步縮),故 reach 縮放不改變任何相對關係。
export const SPEED_COMP = { K: 0.5 };
let _spdMid = 0;
/** 全機體移速的幾何中點(m/s;**壓縮前**的原始值為取樣面,推導不手寫,首次呼叫時定案並快取) */
export function speedMid() {
  if (!_spdMid) {
    const v = [];
    for (const ch of Object.keys(CHARACTERS)) {
      const u = UNITS[charKind(ch)];        // 機種取 charKind 單一縫(陣營 ≠ 機種)
      if (!u) continue;
      const f = CHARACTERS[ch].mods?.speed ?? 1;
      if (u.speed > 0) v.push(u.speed * f);
      if (u.fly > 0) v.push(u.fly * f);       // 變形者飛行巡航:同樣是一台在跑的機體
    }
    _spdMid = v.length ? Math.exp(v.reduce((a, x) => a + Math.log(x), 0) / v.length) : 1;
  }
  return _spdMid;
}
/** 壓縮後移速(**唯一縫**;嚴格遞增 ⇒ 排序保證不變)。K ≥ 1 一律原值回傳(逐位元舊制)。 */
export const spdComp = (v) => (SPEED_COMP.K >= 1 || !(v > 0)
  ? v : speedMid() * (v / speedMid()) ** SPEED_COMP.K);
/** 機體有效機動 = 壓縮後的「機種基準移速(飛行取 fly)× 角色 speed 修正」(全消費端唯一取速處) */
export const heroMobility = (kind, mods, flying = false) => {
  const u = UNITS[kind];
  if (!u) return 0;
  return spdComp((flying ? (u.fly ?? u.speed) : u.speed) * (mods?.speed ?? 1));
};
/**
 * 閃避門檻(m/s;**唯一縫**,三個消費端 sim._dodges / duel / lanesim 一律吃這一支)。
 * 門檻是**同一條速度軸上的一個點** ⇒ MUST 與機體速度走同一張映射,否則壓縮會無聲地重畫
 * 「誰閃得掉」:`MOBILITY_MIN` 原本卡在地面機甲那一帶中間(重甲慢速機體站著吃彈),
 * 而壓縮把慢的往上抬 —— 門檻不跟著抬的話,32 台會整組落到門檻之上 = 那條設計當場失效,
 * 而畫面上只表現成「重機甲好像變得比較難打中」。經 `spdComp` 之後,誰在門檻哪一側逐位元不變
 * (曲線嚴格遞增 ⇒ 保序)。
 */
export const evasionMinSpeed = () => spdComp(EVASION.MOBILITY_MIN);

// 等面積約束的唯一推導處(見 GAME.THREAT_AREA_PER_LANE)
GAME.MINES.PER_LANE = Math.round(GAME.THREAT_AREA_PER_LANE / (Math.PI * GAME.MINES.R ** 2));
// 塔距 = 射程重疊率的唯一推導處(見 GAME.TOWER_OVERLAP)
GAME.TOWER_SEP_F = 2 - GAME.TOWER_OVERLAP;

// ================= 攻擊範圍收斂:一發 AoE 不得同時吃到同塔位的兩座塔(2026-08-02 使用者定案)=================
// 使用者定案:「輕重武器縮減攻擊範圍,除了**以範圍見長**的武器之外,其他都避免一次打到兩座塔」。
// 舊制每一把爆炸型重武器的打擊足跡(r × BLAST.EDGE = 14~29m)都大於「同塔位左右兩座塔的淨間距」
// (30 − 2×7 = 16m)⇒ 對著兩塔正中丟一發就同時削兩座,攻堅節奏從「選一座硬吃另一座的交叉火力」
// 退化成「站中間刮」,② 的 80% 射程重疊設計等於白做。
//
// ---- 判定幾何(推導不手寫;MUST NOT 在任何消費端手抄 30 / 7 / 1.8)----
//   同塔位左右塔距 towerPairSepM() = 2 × GAME.TOWER_SIDE_OFF;
//   爆心取兩塔正中 ⇒ 到各塔**命中量體表面**的距離 = towerPairSepM()/2 − TARGET_R.tower
//     (sim._blast 量的是「爆心 → 命中量體最近點」,不是中心;量到中心會少算一個塔半徑 = 夾不夠緊);
//   blastFalloff 於 r × BLAST.EDGE 歸零 ⇒ 半徑上限 soloBlastRmax() = 該距離 ÷ BLAST.EDGE。
//
// ---- 誰進夾制(三分類同吃 aoeClass,MUST NOT 另寫一份 type 比對)----
//   blast 爆炸 —— 進夾制。一個點炸出一片,正是「一次打到兩座塔」的那個機制。
//   fan   扇形 —— 豁免。「大面積」就是它的本體(見 CHARACTERS 檔頭 plasma 說明)= 使用者說的
//         「以範圍見長」;而且錐是從槍口張開的,射手貼到塔邊時錐寬本來就收斂。
//   line  貫穿 —— 豁免。沿一條線穿透,要同時吃到兩座塔必須「射手與兩塔共線」(塔位左右對稱 ⇒
//         那條線垂直於兵線、射手站在側翼),不是「一次打到一片」;夾它等於把貫穿機制本身拿掉。
//   另有具名名冊 AREA_WEAPONS(以範圍見長的爆炸型武器)同樣豁免 —— MUST 附理由,
//   MUST NOT 為了讓某個角色好過而加名(那就變成「範圍見長」四個字誰都可以自稱)。
//
// ---- 收掉的範圍 MUST 還回火力(範圍是有價的)----
// 只夾不補 = 單方面砍掉半數重武器約三成的實戰價值,而且只砍到「剛好帶 r 的那 13 把」——
// 那不是平衡調整,是把爆炸型武器降級。價格表 = areaValue():**足跡直徑**每多一個基準單位,
// 價值 +AOE_BUDGET.W。刻意是**線性於半徑**而非面積:目標是沿兵線排開的一列,掃到幾個 ∝ 足跡
// 直徑;用 πr² 會讓大半徑武器領到 3~13 倍的補償(t01 直接翻四倍傷害),那是模型錯,不是設計。
// 夾制與補償由**同一次**迴圈定案(`_aoeRaw` 是唯一的中間狀態),套用點只有 heroWeapon 的 dmg 一處
// (與 counterDmgF 同欄)—— MUST NOT 回頭逐武器手改 dmg 階梯,那正是「32 角一動就漂移」的老病。
//
// ---- 補償 MUST 是**重分配**而非通膨(NORM 幾何平均)----
// 舊有四條不變式(bal ①④⑤ 與 duel)全是**單體**模型:爆風半徑從來沒有進過任何一條算式 ⇒
// 這批武器的範圍在既有校準裡本來就是「免費的」。若把補償當純加法發下去,單體模型只看得到
// 「傷害整批變高」= 直接把 drone 推出機種對稱區間、t11→s07 的射程壓制從 35% 衝到 57%
// (2026-08-02 實測 W=0.35 的原始結果)。故補償一律先除以**這批武器補償係數的幾何平均**:
//   收掉的範圍在「被收的那批武器之內」重新分配 —— 讓出越多範圍的拿越多火力,讓出得少的把火力
//   讓出去,整批的火力水位不動(幾何平均 ⇒ 乘性係數的中點,與 CLASS_SYM 用幾何中點同理)。
// 於是 W 的語意是**分配的陡度**(範圍的相對價格),不是總量;W → 0 即逐位元回到舊制傷害。
//
// ---- 2026-08-04 使用者定案:名冊清空 + 爆炸型改吃「家族帶」----
// 使用者定案兩條:①「榴彈類武器射程調整為較短射程的那一類,縮小爆炸範圍、**不可一次命中兩座
// 砲塔**」;②「增加雷射導引、射後不理的攻擊範圍,同爆炸傷害、但**範圍較榴彈類小**」。
// ① 直接廢掉這張豁免名冊 —— 名冊裡本來就只有那三把榴彈類(溫壓火箭 / 152mm / 集束子母彈),
//    使用者把它們一併收進「不可一次命中兩座砲塔」⇒ 沒有任何爆炸型武器再享有豁免。
//    名冊本身**保留為空**:它是「以範圍見長」的具名縫,後續要開特例仍 MUST 走這裡並附理由
//    (fan/line 仍依機制豁免,不經此表)。
// ② 於是三族(榴彈 / 導引 / 其餘)全部擠進同一條上限 `soloBlastRmax()` 之下,「導引 < 榴彈」
//    只能靠**家族帶**表達:見下方 BLAST_BAND —— 榴彈吃滿上限、導引取其 GUIDED_F 倍。
export const AREA_WEAPONS = {
  // (目前為空)以範圍見長的爆炸型武器豁免名冊 —— 增刪 MUST 附理由並同步 tools/audit_aoe_trim.mjs。
};

// ---- 爆炸型武器的家族帶(2026-08-04 使用者定案;推導不手寫)----
// 三個事實壓在一起,結論只有一種形狀:
//   ・「一發不得同時吃到同塔位兩座塔」把**所有**爆炸型武器的足跡上限鎖死在 soloBlastRmax()。
//   ・榴彈類是面殺傷的本體 ⇒ 它就是吃滿那個上限的那一族。
//   ・導引類(雷射導引 / 射後不理)「範圍較榴彈類小」⇒ 只能取上限的一個固定比例。
// 於是家族上限 = soloBlastRmax() × 家族係數,而**階梯底**(Lv1)= 家族上限 × LO ——
// 這一項才是使用者說的「增加攻擊範圍」:舊制的夾制是「等比收斂到頂階貼齊上限」,授權階梯越陡
// 的武器 Lv1 就被壓得越小(導引類實測只剩 2.88~3.17m = 幾乎是點命中,而它的授權值是 11~15m)。
// 改成把授權階梯**仿射映射進家族帶** ⇒ 頂階恰好貼齊家族上限、Lv1 抬到 LO 倍,階梯的相對形狀
// (誰成長得快)完整保留。LO → 1 = 半徑不隨武器階級成長;LO 與 GUIDED_F 都取 1 即回到
// 「全族共用單一上限」的舊語意。
// **範圍照樣要付錢**:授權值與定案值的價差由既有的 `aoeTrimF` 自動計價(半徑漲的武器
// aoeTrimRaw < 1 = 基礎傷害折減),整批再除以 NORM ⇒ 火力水位不動(見下方註)。
export const BLAST_BAND = {
  LO: 0.86,        // 階梯底(Lv1)= 家族上限 × 此值 —— 爆炸型武器一開場就該炸出「一片」不是「一點」
  GUIDED_F: 0.90,  // 導引類(guide 雷射導引 / fnf 射後不理)家族上限 = 榴彈類的此倍(恆 < 1)
};
/** 爆風家族(**唯一分組縫**):榴彈類 'lob' / 導引類 'guided'(雷射導引 guide + 射後不理 fnf 同一族 ——
 *  使用者是把這兩者當同一組講的:「增加雷射導引、射後不理的攻擊範圍…範圍較榴彈類小」)。 */
export const blastFamily = (traj) => (traj === 'lob' ? 'lob' : 'guided');
/** 爆風半徑的**家族上限**(公尺;推導不手寫):榴彈類吃滿「不得一次吃兩塔」的上限,導引類取其 GUIDED_F 倍 */
export const blastCapR = (traj) => soloBlastRmax() * (blastFamily(traj) === 'lob' ? 1 : BLAST_BAND.GUIDED_F);
// W:範圍的**相對價格**(分配陡度,不是總量 —— 總量由 NORM 鎖住)。校準錨 = `npm run bal`
// ⑤(機種對稱 / 角色離群 / 射程壓制):W 越大,讓出範圍越多的武器拿到越多火力、讓得少的賠越多,
// 陡到某個程度就會把單一角色推出 20~80%。NORM 於下方夾制迴圈 derive,**MUST NOT 手寫**。
export const AOE_BUDGET = { W: 0.35, NORM: 1 };
/** 同塔位左右兩座砲塔的間距(公尺;推導不手寫) */
export const towerPairSepM = () => 2 * GAME.TOWER_SIDE_OFF;
/** 「一發不得同時傷到同塔位兩座塔」的爆風半徑上限(公尺;推導不手寫) */
export const soloBlastRmax = () => (towerPairSepM() / 2 - TARGET_R.tower) / BLAST.EDGE;
/** 爆風打擊足跡半徑(公尺)= 傷害歸零邊界(blastFalloff 的外界) */
export const blastFootprintR = (r) => Math.max(0, r || 0) * BLAST.EDGE;
/** 範圍價值(相對「剛好打不到第二座塔」的單體基準;線性於足跡直徑,見上方註) */
export const areaValue = (r) => 1 + AOE_BUDGET.W * (blastFootprintR(r) / blastFootprintR(soloBlastRmax()));
/** 未正規化的補償係數 = 「收掉的範圍值多少火力」(夾制迴圈用它算 NORM;消費端請用 aoeTrimF) */
export const aoeTrimRaw = (w) => (w?._aoeRaw ? areaValue(w._aoeRaw) / areaValue(tierVal(w.r, 1)) : 1);
/** 收掉範圍的火力補償(唯一套用點 = heroWeapon 的 dmg;沒被夾過的武器恆 ×1)。
 *  除以 NORM ⇒ 這批武器的火力水位不動,只在彼此之間重分配(見上方註)。 */
export const aoeTrimF = (w) => (w?._aoeRaw ? aoeTrimRaw(w) / AOE_BUDGET.NORM : 1);
{
  const TOP = 1 + ECON.UPGRADES.hw.max, trimmed = [];   // 戰鬥面向滿級階(Lv4;含 tierVal 外推)
  // ---- ① 收集受夾制的爆炸型武器,依**家族**(trajClass)分組 ----
  // 仿射映射的定義域取**整個家族**的授權跨距(而非逐把武器各自伸展到帶的兩端):逐把伸展會把
  // 「誰的範圍比較大」整組抹平 —— 集束子母彈與無後座砲會拿到逐位元相同的半徑,那是把一個設計
  // 維度刪掉,不是收斂範圍。共用同一組 (A, B) ⇒ 家族內的相對大小與階梯形狀全部保留。
  const fams = new Map();
  for (const [ch, c] of Object.entries(CHARACTERS)) for (const slot of ['light', 'heavy']) {
    const w = c[slot];
    if (!w || w.r == null || AREA_WEAPONS[`${ch}.${slot}`]) continue;
    if (aoeClass({ ...w, id: slot }) !== 'blast') continue;   // id 是 aoeClass 分辨重武器的依據
    const traj = trajClass(w), fam = blastFamily(traj);
    let f = fams.get(fam);
    if (!f) fams.set(fam, f = { cap: blastCapR(traj), lo: Infinity, hi: -Infinity, ws: [] });
    f.lo = Math.min(f.lo, tierVal(w.r, 1));
    f.hi = Math.max(f.hi, tierVal(w.r, TOP));                 // 頂 = 外推後的真正上界
    f.ws.push(w);
  }
  // ---- ② 逐家族仿射映射進家族帶 [cap × LO, cap] ----
  // 一律**無條件捨去**到 0.001m:四捨五入會讓頂階回到 cap 之上(4.4444 → 4.445),而這條界是
  // 「打不打得到第二座塔」的充要條件 —— 差 0.001m 就整條規則失效(原則 6 寧缺勿錯)。
  const q = (v) => Math.floor(v * 1000) / 1000;
  for (const f of fams.values()) {
    const span = f.hi - f.lo;
    // tierVal 對「條目」是仿射的(含末段外推 v[n−1]·(1+k) − v[n−2]·k)⇒ 對條目做 a = A + B·r
    // 之後,家族授權跨距的兩端恰好落在帶的兩端,階梯形狀與家族內排序完整保留。
    const B = span > 0 ? (f.cap - f.cap * BLAST_BAND.LO) / span : 0;
    const A = f.cap * BLAST_BAND.LO - B * f.lo;
    for (const w of f.ws) {
      w._aoeRaw = tierVal(w.r, 1);                            // 計價基準 = 授權的 Lv1 半徑(見 aoeTrimRaw)
      if (!Array.isArray(w.r)) { w.r = q(A + B * w.r); trimmed.push(w); continue; }
      const a = w.r.map((v) => q(A + B * v)), n = a.length, k = Math.max(0, TOP - n);
      // 頂階是 tierVal 的**外推**⇒ 逐項捨去之後外推值會反彈到 cap 之上(t09 [15,17,19] 實測
      // 回到 4.445)。末階由外推式**反解**(推導不手寫)。
      if (n >= 2) a[n - 1] = Math.min(a[n - 1], q((f.cap + k * a[n - 2]) / (1 + k)));
      w.r = a;
      trimmed.push(w);
    }
  }
  // 幾何平均:乘性係數的中點。整批補償除以它 ⇒ 火力總量不動,只在這批武器之間重分配
  //(讓出範圍的拿火力、拿到範圍的賠火力 —— 導引類這次是後者)。
  AOE_BUDGET.NORM = trimmed.length
    ? Math.exp(trimmed.reduce((s2, w) => s2 + Math.log(aoeTrimRaw(w)), 0) / trimmed.length) : 1;
}

// ================= 機動預算:機動越高,基礎火力越低(2026-08-02 使用者定案)=================
// 使用者定案:「涵蓋 DPS / 攻擊範圍(考量實質戰鬥角度)/ 射程 / 移動速度,重新調正武器平衡性,
// 三種機體使用不同武器類型交叉對戰」。前三軸都已經有價格表(DPS = dmg 階梯本身、攻擊範圍 =
// `AOE_BUDGET`、射程 = 各武器 range + rangeCap),**只有移動速度沒有**:機動一直是免費的。
//
// 免費的代價在新的前線交戰模型(`tools/lanesim.mjs` / bal ⑦)裡量得出來:那支有「扛不住就退回
// 自家塔後等護盾、回滿再上」的撤退循環(= 正式對局的對線節奏),而**撤退的成本與機動成反比** ——
// 跑得快的一方每次脫離接觸只挨兩秒打、跑得慢的挨四秒半,一場對線下來差距被乘上十幾次。
// 2026-08-02 實測(改制前):drone 62.6% / robot 45.0% / morph 38.5%,而三機種的 EHP 只差 ±10%。
// 既有的 bal ①④⑤ 全是「站著對射」的模型,機動在那裡只透過 EVASION 閃避作用一點點,量不到這件事。
//
// 價格表沿用 counterDmgF / aoeTrimF 的同一個形狀,但**以幾何中點為軸**:
//   mobDmgF(ch) = (全角色有效機動的幾何中點 ÷ 該角色有效機動) ^ K
// ⇒ 機動高於中點者基礎火力下修、低於中點者上修,整體火力水位由幾何中點鎖住(不通膨,與
//   CLASS_SYM 取幾何中點同理)。K = 0 即逐位元回到舊制。
// **只作用於武器**(招式不吃):使用者指示「先不考慮長按技和大小招」,那三類的預算住 SPECIAL /
// 招式階梯,不在本次校準範圍。
// 校準錨:bal ①(清波剩餘 EHP 三機種同時朝 40% 收斂)、④(drone 站外攻堅秒數上升,有預算上限)、
//         ⑤(機種對稱 / 角色離群)、⑦(前線交戰機種對稱)。改 K MUST 四條一起看。
// **K 有實測上界**(2026-08-02 逐值掃描):K=0.15 起 t02 的 ⑤ 平均勝率頂到 80%、K=0.20 起 t02/t04
// 雙雙出界,K=0.28 另把 ④ 的 drone 站外攻堅推到 205s > 200s 預算。0.10 是「四條同時全綠」的最大值 ——
// 再往上要先處理那兩名角色的 dmg 階梯,MUST NOT 只因為 ⑦ 好看就把 K 調過頭。
export const MOB_BUDGET = { K: 0.10 };
let _mobMid = 0;
/** 全角色「有效機動」的幾何中點(m/s;推導不手寫,首次呼叫時定案並快取) */
export function mobMid() {
  if (!_mobMid) {
    const v = Object.keys(CHARACTERS).map((c) => {
      const k = charKind(c);
      return heroMobility(k, CHARACTERS[c].mods, k === 'drone');
    }).filter((x) => x > 0);
    _mobMid = v.length ? Math.exp(v.reduce((a, x) => a + Math.log(x), 0) / v.length) : 1;
  }
  return _mobMid;
}
/** 機動折減/加成係數(唯一套用點 = heroWeapon 的 dmg,與 counterDmgF / aoeTrimF 同欄) */
export function mobDmgF(ch) {
  const k = charKind(ch);
  const m = heroMobility(k, CHARACTERS[ch]?.mods, k === 'drone');
  return m > 0 ? (mobMid() / m) ** MOB_BUDGET.K : 1;
}

// ================= 射程預算:射程越長,基礎火力越低(2026-08-02 使用者定案)=================
// 與 MOB_BUDGET 同一條「軸要有價格」的道理,但**射程是新模型量到最貴的一軸**:
// `tools/lanesim.mjs`(bal ⑦)的單軸擾動自驗實測 —— 同一台機體對全體對局,
//   火力 +15% → 勝率 +4.1pp、範圍 +50% → +2.1pp、移速 +15% → +0.6pp、**射程 +15% → +21.3pp**。
// 射程貴在它同時買到三件事:接近期單方面輸出、對線時把對手壓在自己的甜蜜點外、以及站在
// 砲塔射程外拆塔(④ 的站外攻堅)。既有校準完全沒有替這一軸標價 ⇒ 誰的武器射程長誰就贏,
// 而三機種的射程上限本來就不同(rangeCap ← UNITS[kind].sight),差距直接變成機種勝率差。
//
// 價格表與 MOB_BUDGET 同形,但**中點逐槽位取**(輕/重武器各算各的):
//   rngDmgF(ch, slot) = (該槽位全角色解析後射程的幾何中點 ÷ 這把武器的射程) ^ K
// 逐槽位而非全表混一鍋的理由:輕武器 102~122m、重武器 158~194m,混算會變成「所有輕武器
// 集體加成、所有重武器集體折減」= 量到的是槽位不是射程優勢。比的必須是**同級距的同儕**。
// K = 0 即逐位元回到舊制。校準錨同 MOB_BUDGET(bal ①④⑤⑦ 四條一起看)。
// **K 有實測上界**(2026-08-02 逐值掃描):K ≥ 0.25 起 t02 的 ⑤ 平均勝率頂到 80% 出界
// (它是低機動 + 中射程,兩份預算的加成同時落在它身上)。0.15 留一格餘裕(現況最高 t04 79%)。
// **也要知道 K 買不到什麼**:⑦ 的射程敏感度(+15% 射程 = +21pp 勝率)遠高於火力敏感度
// (+15% 火力 = +4.1pp),因為 `dmgFalloff` 的平台/衰減段都是**射程的比例** ⇒ 射程長不只是打得遠,
// 是同一個距離上衰減更少。要靠火力折減把 12% 的射程優勢吃回來得砍掉近八成傷害 —— 不可能,也不該。
// 真正的旋鈕在機種射程上限(`rangeCap` ← `UNITS[kind].sight`),那條線牽動 #INC-104 的高空射擊
// 測試與全機種輕武器射程,MUST 另案處理,MUST NOT 拿 K 硬湊。
export const RANGE_BUDGET = { K: 0.15 };
const _rngMid = {};
/** 某槽位「解析後射程」的幾何中點(公尺;推導不手寫,首次呼叫時定案並快取) */
export function rangeMid(slot) {
  if (!_rngMid[slot]) {
    const v = Object.keys(CHARACTERS).map((c) => heroRange(c, slot)).filter((x) => x > 0);
    _rngMid[slot] = v.length ? Math.exp(v.reduce((a, x) => a + Math.log(x), 0) / v.length) : 1;
  }
  return _rngMid[slot];
}
/** 射程折減/加成係數(唯一套用點 = heroWeapon 的 dmg,與 counterDmgF / aoeTrimF / mobDmgF 同欄) */
export function rngDmgF(ch, slot) {
  const r = heroRange(ch, slot);
  return r > 0 ? (rangeMid(slot) / r) ** RANGE_BUDGET.K : 1;
}

// ---- 全際 reach 縮放(規則 #4,見 COMBAT_SCALE;唯一縫,MUST NOT 在別處二次縮)----
// 統一縮「射程 / 視野 / 移速 / 制空高度門檻 / 速度門檻」× COMBAT_SCALE;**不動** 實體尺寸、AoE/障礙半徑、
// 地圖佈局距離(走廊/淨空/生成偏移/雷區)、比率(HEROIC/RANGE_SIGHT_F/AIM_SIGHT_MULT)。放在所有相關定義與
// 推導(bounty/drone/base.guns/MINES/SEP —— 皆非 range/sight/speed)之後、solveTowerSites 前;函式在呼叫期讀 UNITS,故縮值即時生效。
{
  const CS = COMBAT_SCALE;
  for (const u of Object.values(UNITS)) {
    for (const key of ['range', 'sight', 'speed', 'fly', 'vspeed', 'jump']) if (typeof u[key] === 'number') u[key] *= CS;
    if (typeof u.guns?.range === 'number') u.guns.range *= CS;  // 主堡加裝砲(derive 自塔,獨立縮)
  }
  for (const w of Object.values(WEAPONS)) if (typeof w.range === 'number') w.range *= CS;   // NPC 武器射程(留 blast r/AoE)
  // 英雄武器基準射程(scalar;heroWeapon 讀此 source ⇒ 玩家英雄與 NPC 基準一致縮;招式 range/vision 走 heroAbility 輸出縮)
  for (const c of Object.values(CHARACTERS)) for (const slot of ['light', 'heavy'])
    if (typeof c[slot]?.range === 'number') c[slot].range *= CS;
  // 高度差空戰門檻 = 砲塔實體高(不吃 reach 縮放,與 AoE/實體尺寸同類);故此塊不縮 ALTITUDE。
  for (const k of ['GUN_CEIL_M', 'HELI_ALT', 'AA_MIN_ALT', 'HERO_HEAL_RADIUS', 'HERO_HEAL_R']) GAME[k] *= CS;
  EVASION.MOBILITY_MIN *= CS; EVASION.MOVING_SPD *= CS;   // 速度門檻隨移速縮
}

// ---- 持續 DPS 的唯一量法(彈匣週期;**MUST NOT 在任何消費端手抄這兩行**)----
// 三個消費端各自抄一份是這個公式的老病:對建築收斂 `buildDps`、平衡 `tools/balance.mjs slotDps`、
// 圖鑑六角圖的「火力」軸 —— 抄第三份的症狀是「圖鑑寫的火力跟平衡量到的不是同一個數」,
// 而兩邊都言之成理、沒有任何錯誤訊息。`dmg` 可覆寫成「對某個目標的實得傷害」(剋制 × 破甲後)。
/** 一個彈匣週期(秒)= 打完 mag 發 + 裝填 */
export const weaponCycleS = (w) => w.mag / (w.rate || RATE_DEF) + w.reload;
/** 持續 DPS = 一個彈匣週期打出的傷害 ÷ 週期長度 */
export const weaponDps = (w, dmg = w?.dmg ?? 0) => (w ? dmg * w.mag / weaponCycleS(w) : 0);

// ================= 對建築 DPS 收斂(2026-08-04 使用者定案)=================
// 使用者定案:「所有重武器之間與輕武器之間對建築的 DPS 不要落差太大」。
// 改制前實測(對砲塔持續 DPS,Lv1):重武器 2.8 ~ 30.8(**10.8 倍**)、輕武器 19.9 ~ 62.8(3.2 倍)。
// 10.8 倍的意思是:同樣站在塔下打滿一整場,有的機種拆得掉兩座塔,有的連一座都刮不完 ——
// 而玩家看到的只是「我這把武器打建築好像沒有傷害」(2026-08-04 另一條回報的成因之一)。
//
// ---- 為什麼旋鈕是 `vs.building` 而不是 dmg 階梯 ----
// 對建築 DPS = dmg × vs.building × armorMul × mag/cycle。dmg 階梯同時決定對**所有**目標的火力
// (bal ①④⑤⑦ 全部吃它),拿它調建築就是把四條不變式一起推走;`vs.building` 是「目標類別剋制」
// 那一軸,**只**作用在建築上 —— 這一條規則要動的正好就是這一軸。
//
// ---- 形狀與既有三個預算同款(逐槽位幾何中點為軸;推導不手寫)----
//   vs.building' = vs.building × (該槽位 DPS 幾何中點 ÷ 這把武器的 DPS) ^ K,再夾到 (0, BUILDING_VS_CAP]
// ⇒ 新的離散度 = 舊離散度 ^ (1 − K):K = 0 逐位元回到舊制、K = 1 完全拉平。**逐槽位**取中點
// (與 RANGE_BUDGET 同理):輕重武器的建築 DPS 本來就不同級距,混一鍋量到的是槽位不是武器。
//
// ---- 三條 MUST ----
// ① 上夾 `BUILDING_VS_CAP`(A34 ①「建築加乘一律移除」)**不得為了收斂而放寬**。
// ② 收斂 MUST 是**重分配而非削弱**(與 AOE_BUDGET.NORM / CLASS_SYM 取幾何中點同一條紀律),
//    而**水位 MUST 量在 bal ④ 量的那個量上** = 滿級(Lv4)逐角色拆塔 DPS 的**算術**平均。
//    只鎖幾何中點是不夠的:壓縮保住幾何中點(乘性中點)卻必然壓低**算術**平均(把長尾收進來),
//    而拆一座塔的秒數 = 塔 HP ÷ (輕 + 重 DPS) 吃的是算術量 —— 實測只鎖幾何中點時,
//    ④ 的機甲/變形者從剩餘 2.7%/4.9% 掉到 −0.1%/−0.1%(兩座塔都推不掉)。
//    另一半原因是 ① 的上夾:高的可以無限降、低的最多補到 1.0,補不滿的缺口一樣要回填。
//    故壓縮後 MUST 等比抬回水位再夾,重複到收斂:夾住的不再動,沒夾住的把缺口補起來。
// ③ MUST 排在 `COMBAT_SCALE` 統一縮放**之後**:`buildDps` 走 `heroWeapon`,而射程縮放會定案
//    `rangeMid`/`rngDmgF` 的快取 ⇒ 排在前面量到的是縮放前的火力,收斂係數整組偏掉。
// 這一段**不改 `counterDmgF`**:夾制後 vs.building ≤ 1 ⇒ 它對 `narrow`(超出 1 的加成總和)的
// 貢獻恆為 0,升降都不會回頭改動基礎傷害(沒有回饋迴圈)。
export const BUILD_DPS = { K: 0.55, LEVEL_ITERS: 64 };
/** 某角色某槽位對建築(砲塔)的持續 DPS(**唯一量法**;收斂迴圈與稽核同吃)。
 *  公式與 tools/balance.mjs 的 slotDps 同構:cycle = mag/rate + reload;
 *  無護盾層 ⇒ shieldSplit(…, sp=0) = 整發吃 vsHp(與 sim._damage 非英雄分支同一支)。 */
export function buildDps(ch, slot, lvl = 1) {
  const w = heroWeapon(ch, slot, lvl, true);
  if (!w) return 0;
  return weaponDps(w, shieldSplit(w, w.dmg, 0).toHp * vsMult(w, 'tower')
    * armorMul(UNITS.tower.armor, w.pen));
}
{
  const q = (v) => Math.round(v * 1000) / 1000;
  const set = (w, v) => { (w.vs ||= {}).building = q(Math.min(BUILDING_VS_CAP, v)); };
  const SLOTS = ['light', 'heavy'];
  const top = (slot) => 1 + ECON.UPGRADES[slot === 'light' ? 'lw' : 'hw'].max;   // 戰鬥面向滿級階(Lv4)
  const all = [];
  for (const slot of SLOTS) {
    for (const ch of Object.keys(CHARACTERS)) {
      const w = CHARACTERS[ch][slot];
      if (w) all.push({ ch, slot, w, dps: buildDps(ch, slot), lv4: buildDps(ch, slot, top(slot)) });
    }
  }
  // 水位錨(② 的守門值)= 滿級拆塔 DPS 的**算術**平均 —— bal ④ 量的就是這個。
  const level = () => all.reduce((s, r) => s + buildDps(r.ch, r.slot, top(r.slot)), 0) / all.length;
  const level0 = all.reduce((s, r) => s + r.lv4, 0) / all.length;
  // ---- ① 離散度:逐槽位朝該槽位的幾何中點壓縮 ----
  for (const slot of SLOTS) {
    // 先整批量完再套用:`buildDps` 讀的是 live 的 `vs.building`,邊量邊改會讓中點跟著漂。
    const rows = all.filter((r) => r.slot === slot && r.dps > 0);
    if (!rows.length) continue;
    const mid = Math.exp(rows.reduce((s, r) => s + Math.log(r.dps), 0) / rows.length);
    for (const r of rows) set(r.w, (r.w.vs?.building ?? 1) * (mid / r.dps) ** BUILD_DPS.K);
  }
  // ---- ② 水位回填(見上方註):DPS 與 vs.building 成正比 ⇒ 直接等比抬,夾住的自然停在 CAP ----
  for (let it = 0; it < BUILD_DPS.LEVEL_ITERS; it++) {
    const g = level0 / level();
    if (!(Math.abs(g - 1) > 1e-6)) break;
    for (const r of all) set(r.w, (r.w.vs?.building ?? 1) * g);
  }
}

// ================= 圖鑑六角能力圖(2026-08-04 使用者定案)=================
// 使用者定案:「角色能力使用六角圖顯示:HP 和護盾合併顯示為耐久,另外加上兩個項目:火力、
// 射程 + 傷害面積」。舊制五條長條(裝甲 HP / 護盾 / 電力 / 機動 / 護甲值)全是**生存面**的
// 拆解 —— 一台機體「打得多痛、控得住多大一塊地」在圖鑑上完全看不到,而那兩件事才是選角時
// 真正要比的。合併 HP + 護盾(兩者都是「還能撐多久」,分兩條只是把同一件事講兩次)騰出位置,
// 補上火力與制域 ⇒ 生存 3(耐久/護甲/電力)+ 輸出 3(火力/制域/機動)= 六軸。
//
// ---- 四條 MUST ----
// ① **六軸全部推導**:值一律走既有的唯一縫(`heroArmor` / `heroMobility` / `heroWeapon` →
//    `weaponDps`),MUST NOT 在 UI 端另寫一份公式或手抄一張數值表 —— 圖鑑與實戰分家的症狀是
//    「圖上看起來很強、打起來不是」,而且沒有任何錯誤訊息。
// ② **滿格基準 `hexMax` 由全體現役角色推導**(舊制 `BAR_MAX` 是手寫的:改一名角色的數值,
//    別人的長條就悄悄失準,甚至爆出格子)。以全場最大值為滿格 ⇒ 每一軸至少有一名角色貼到
//    外框,六角形的形狀因此讀得出「這台機體在這一軸上相對全場的位置」。
// ③ **「射程 + 傷害面積」合成一軸 = 制域**(m²):`zoneAreaM2` = 射程 × 打擊足跡的**等效直徑**。
//    兩者相加是量綱不同的東西(m 與 m²)不能真的相加,但它們回答的是同一個問題 ——
//    「這一發能否定掉多大一塊空間」⇒ 以「射程長 × 足跡寬」的矩形面積表達,單體直擊武器的
//    足跡取一名步兵的命中量體(`hitR`,不是 0)⇒ 它的制域就退化成純射程的線性量。
// ④ 六軸一律取 **Lv1 未升級**(與卡面「數值 Lv1 → Lv4」的左端一致);八軌升級是玩家的選擇,
//    不是機體的性格。
/** 打擊足跡面積(m²;三類 AoE 各按自己的幾何 —— 分類走 `aoeClass` 單一縫,MUST NOT 比對 type) */
export function strikeAreaM2(def) {
  if (!def) return 0;
  const cls = aoeClass(def);
  if (cls === 'blast') return Math.PI * blastFootprintR(def.r) ** 2;       // 圓形超壓
  if (cls === 'fan') return fanArcHalf(def) * def.range ** 2;              // 扇形 = 半角 × R²
  if (cls === 'line') return 2 * lanceR(def) * def.range;                  // 貫穿圓柱的地面投影
  return Math.PI * hitR({ kind: 'soldier' }) ** 2;                         // 單體直擊 = 一名步兵的量體
}
/** 制域(m²)= 射程 × 足跡等效直徑 ——「射程 + 傷害面積」的單一評估量(見上方 ③) */
export const zoneAreaM2 = (def) => (def ? def.range * 2 * Math.sqrt(strikeAreaM2(def) / Math.PI) : 0);
/**
 * 六軸定義(**唯一真相**:名稱 / 單位 / 取值全在這裡;UI 只負責畫,MUST NOT 自備第二張表)。
 * 每一軸「是什麼意思」只寫在 `help.js UI_TIPS.charHex`(⓵ 懸浮提示與說明分頁同一份文字);
 * 本表只管**名稱 / 單位 / 怎麼算**,MUST NOT 在這裡再抄一份說明(兩份說明遲早各講各的)。
 * 陣列順序 = 六角形**由頂點起順時針**的繪製順序,右半三軸(火力/制域/機動)是輸出面、
 * 左半三軸(電力/護甲)與頂點(耐久)是生存面 ⇒ 圖形偏右 = 打擊型、偏左 = 耐戰型。
 * 消費端 MUST 照這個順序走(自己重排 = 兩張圖不同形狀,而兩邊都「看起來合理」)。
 */
export const HEX_AXES = [
  { key: 'dur', name: '耐久', unit: '',
    val: (ch) => Math.round(UNITS[charKind(ch)].hp * (CHARACTERS[ch].mods?.hp ?? 1))
      + Math.round(UNITS[charKind(ch)].shield * (CHARACTERS[ch].mods?.sp ?? 1)) },
  { key: 'fire', name: '火力', unit: '/s',
    val: (ch) => weaponDps(heroWeapon(ch, 'light')) + weaponDps(heroWeapon(ch, 'heavy')) },
  { key: 'zone', name: '制域', unit: 'm²',
    val: (ch) => zoneAreaM2(heroWeapon(ch, 'light')) + zoneAreaM2(heroWeapon(ch, 'heavy')) },
  { key: 'mob', name: '機動', unit: 'm/s',
    val: (ch) => heroMobility(charKind(ch), CHARACTERS[ch].mods, charKind(ch) === 'drone') },
  { key: 'power', name: '電力', unit: '',
    val: (ch) => Math.round(UNITS[charKind(ch)].mp * (CHARACTERS[ch].mods?.mp ?? 1)) },
  { key: 'armor', name: '護甲', unit: '',
    val: (ch) => heroArmor(ch) },
];
// ---- 正規化:內圈 = 全場最低、外框 = 全場最高,且在**對數**尺度上內插 ----
// 兩種直覺的做法都試過,都會讓圖形讀不出東西:
//   ・以 0 為內圈:現役 32 台的耐久只差 1.5 倍(659~1019)、電力 1.4 倍 ⇒ 六個頂點全部貼在
//     外圈附近,每一台看起來都是同一個正六邊形。
//   ・線性 min~max:對**長尾**的軸無效 —— 制域最大值(扇形武器的錐面)是中位數的近十倍,
//     其餘 27 台全部擠在內圈 5% 以內,那一軸退化成「是不是扇形」的二元旗標。
// 取對數 ⇒ 「差幾倍」而不是「差多少」決定半徑,與本檔其餘預算一律取幾何中點同一條尺;
// 底 `FLOOR` 讓全場最低者仍看得見(半徑 0 的頂點會把六邊形塌成一條線)。
export const HEX = { FLOOR: 0.14 };
const _hexBand = {};
/** 該軸的全場值域 { lo, hi }(推導不手寫 —— 改任一角色數值,基準自己跟著走;首呼定案並快取) */
export function hexBand(key) {
  if (!_hexBand[key]) {
    const ax = HEX_AXES.find((a) => a.key === key);
    const v = ax ? Object.keys(CHARACTERS).map((c) => Math.max(1e-6, ax.val(c))) : [1];
    _hexBand[key] = { lo: Math.min(...v), hi: Math.max(...v) };
  }
  return _hexBand[key];
}
/** 一名角色的六軸能力(**唯一取值處**;`f` = FLOOR~1 已正規化,UI 直接拿來畫) */
export const heroHexStats = (ch) => HEX_AXES.map((ax) => {
  const v = CHARACTERS[ch] ? ax.val(ch) : 0;
  const { lo, hi } = hexBand(ax.key);
  const span = Math.log(hi / lo);
  const t = span > 1e-9 ? Math.log(Math.max(1e-6, v) / lo) / span : 1;
  return { key: ax.key, name: ax.name, unit: ax.unit, v,
    f: HEX.FLOOR + (1 - HEX.FLOOR) * Math.max(0, Math.min(1, t)) };
});

// ---- 波次編制 / 節奏的唯一推導處(sim._spawnWave・_prefillLanes・balance.mjs・e2e 共用)----
/** 一波每兵線每側的固定編制(WAVE_SOLDIERS 名步槍兵 + WAVE_EXTRAS);MUST NOT 在任何消費端手抄。 */
export const waveComp = () => [...Array(GAME.WAVE_SOLDIERS).fill('soldier'), ...GAME.WAVE_EXTRAS];
/** 波次行軍速度(m/s)= 編制中最慢者 —— 隊形凝聚(sim._waveAnchors)讓整波錨定最慢的那隻,
 *  所以「一個出兵間隔的行軍距離」只能用最小速度算。MUST 於呼叫期讀 UNITS(速度吃 COMBAT_SCALE)。 */
export const waveMarchSpeed = () => Math.min(...waveComp().map((k) => UNITS[k].speed));
/** 相鄰兩波在兵線上的穩態間距(公尺)= 出兵間隔 × 行軍速度。
 *  開場預置兵線(sim._prefillLanes)用它擺出「已經打了一陣子」的兵線密度,MUST NOT 手寫距離。 */
export const waveSpacingM = () => GAME.WAVE_S * waveMarchSpeed();

// ---- 陣營小兵強化(2026-07-30 使用者定案;八軌全滿後的無限金錢去化)----
// **同陣營全玩家共用**(誰買都記在陣營帳上)、**不同兵線分開**(強化只作用於該條兵線的波次)。
// LV 0(初始未強化)~ MAX,每階固定 PRICE —— 階梯單價與八軌的 upgradePrice 無關,MUST NOT 併軌。
// 「全能力與陣亡提供的報酬成長率 = log(LV)」⇒ 倍率 creepUpgMul = 1 + log10(1 + LV):
//   LV0 ×1.00(未強化)/ LV1 ×1.30 / LV10 ×2.04 / LV100 ×3.00。取 1+LV 是因為 log(0) 無定義,
//   且要讓 LV0 恰好落在 ×1.00(未購買 = 原數值)。
// 套用範圍(2026-08-11 使用者改制:**只強化「對玩家(含電腦玩家)以外」的護甲與傷害**)——
//   ・傷害:小兵打**非英雄**目標(敵方小兵/砲塔/主堡)×cu;打玩家機體一律 ×1。
//   ・耐久:hp 不再 ×cu(hp 是全域的,連打玩家時都會變硬)⇒ 整份耐久折進「**非英雄**攻擊者
//     造成的傷害 ×creepDmgTakenF」,使該情境下的 EHP **逐位元等於**舊制的 hp×cu + armor×cu。
//   ・陣亡賞金不再 ×cu:小兵對玩家已不再更難打,賞金還加成就是純白送(見 sim._bounty)。
//   ⇒ DPS 與總耐久的「強化幅度」與舊制相同,只是作用面收斂到非玩家對象。
//   **刻意不吃 range / sight / speed / rate**:射程會撞破「小兵射程一律 < 防禦塔」的設計底線
//   (見 UNITS.tower)、移速會拆掉波次間距與凝聚錨定(waveSpacingM)、rate 與 dmg 疊乘會變成 ×9 DPS。
export const CREEP_UPG = { MAX: 100, PRICE: 200 };
/** 小兵強化倍率(傷害與耐久共用同一條曲線);超出 0~MAX 一律夾制。 */
export const creepUpgMul = (lv) =>
  1 + Math.log10(1 + Math.max(0, Math.min(CREEP_UPG.MAX, Math.floor(lv || 0))));
/**
 * 強化小兵「受非英雄攻擊」時的傷害倍率(耐久側唯一縫)。
 * 舊制 EHP = hp×cu / armorMul(ar×cu, pen);新制 hp 不動 ⇒ EHP = hp / (armorMul(ar,pen) × F)。
 * 兩者相等解出 F = armorMul(ar×cu, pen) /(cu × armorMul(ar, pen))—— 逐 pen 精確,MUST NOT 手寫近似。
 */
export const creepDmgTakenF = (cu, ar, pen = 0) =>
  (cu || 1) > 1 ? armorMul((ar || 0) * cu, pen) / (cu * armorMul(ar || 0, pen)) : 1;

/**
 * 攻堅順序(2026-08-10 使用者定案「劇情戰役時,一定要按照順序打:前線砲塔>中段砲塔>主堡,
 * 前面沒打爆後面會鎖血」)—— **階段定義的唯一縫**,伺服器結算(sim)、客戶端 HUD(game)、
 * 對話觸發(storytalk)與稽核共吃這一份。
 *
 * 兩件事在這裡定死,消費端 MUST NOT 各自重算:
 *   ① **哪一座塔算前線** —— 由 `solveTowerSites()` 回傳的 `frac` 推導:同一條兵線內 frac 最大
 *      (最靠戰場中線 = 最先撞上的那一組)= 前線,其餘 = 中段。**MUST NOT 拿陣列索引當判據**:
 *      `solveTowerSites` 的回傳是 `[後塔, 前塔]`(後塔求解在後、unshift 在前),而兵線太短塞不下
 *      後塔時只回一個元素 —— 拿 index 0 當前線在「單塔位兵線」上剛好對、在雙塔位兵線上剛好相反,
 *      而症狀只是「這張圖的鎖血順序反了」,沒有任何錯誤訊息。
 *   ② **階段是全戰場的,不是逐兵線的** —— 一個陣營所有兵線的前線砲塔全數擊毀,中段砲塔才解鎖;
 *      全部中段砲塔擊毀,主堡才解鎖(`siegeOpenStage()`)。逐兵線制會讓「推掉每階段」變成一章
 *      觸發 2×兵線數 次,而劇情對話一階只有一場。
 *
 * 鎖血 = **完全免傷**(不是減傷):`sim._damage` 早退、`_tgBlockedD`/`bots._acquire` 一併把它排除在
 * 索敵之外 —— 只擋傷害不擋索敵的話,小兵會停在打不動的塔前面把兵線卡死。
 */
export const SIEGE = {
  STAGES: ['front', 'mid', 'base'],
  NAMES: ['前線砲塔', '中段砲塔', '主堡'],
};
SIEGE.BASE = SIEGE.STAGES.length - 1;   // 主堡恆為最後一階(推導,MUST NOT 手寫 2)

/**
 * 一條兵線的塔位 → 逐塔位階段(0 = 前線塔、1 = 中段塔)。
 * sites = `solveTowerSites(lanes)[li]`(元素帶 `frac`)。單一塔位的兵線 ⇒ 那一座就是前線。
 */
export function siegeSiteStages(sites) {
  const maxF = Math.max(...sites.map((s) => s.frac));
  return sites.map((s) => (s.frac >= maxF - 1e-9 ? 0 : 1));
}

/**
 * 某一方目前「打得動的最高階段」= 仍有存活建築的最低階段。
 * counts[i] = 該方第 i 階仍存活的建築數(塔以座計、主堡 1)。全滅回 SIEGE.BASE(主堡沒了 = 已結束)。
 */
export function siegeOpenStage(counts) {
  for (let i = 0; i < SIEGE.STAGES.length; i++) if ((counts[i] || 0) > 0) return i;
  return SIEGE.BASE;
}

/**
 * 塔位求解(sim._spawnStructures 與 biomes 淨空共用的唯一的縫)。
 * lanes: [[x,z], …][] — 兵線折線(世界公尺;每條 index 0 = SWARM 主堡端、末端 = STEEL 主堡端)。
 * 回傳 lanes.map(sites[]),每個 site = { frac, SWARM:{x,z,nx,nz}, STEEL:{…} };
 * 實際砲塔 = site 沿法線 ±TOWER_SIDE_OFF 各一座。每條兵線 1~2 個塔位(前塔恆有、後塔 best-effort)。
 *
 * 規則 #4(2026-07-19 使用者定奪)—— **per-lane**(跨兵線在共用主堡/中線的聚攏屬 DOTA 拓樸固有,只防疊不強制):
 *   - **前線敵我雙砲塔**:維持射程重疊 80%(爭中線,invariant ②;敵我對距 ≈ SEP = R×TOWER_SEP_F)。同陣營跨兵線前塔僅防
 *     物理疊塔(≥ STACK,非 ≥SEP;多線在中線本就匯聚)——修陽明山 L3 兩塔 4m 疊塔。前塔↔己方主堡不設限(短兵線固有)。
 *   - **後方己方雙砲塔點**:與**己方**主堡、與**同兵線**前塔的射程重疊率 ≤ 80%(後塔↔該兩者最近距離 ≥ SEP),
 *     且對全場塔 ≥ STACK 不疊。**不捨棄**(塔數不變⇒平衡不動):兵線太短塞不下 ≤80% → 取重疊最小的合法位(best-effort)。
 *   - **相鄰兵線雙砲塔點**(|Δli|=1,同陣營,前/後皆算,2026-07-19 追加):射程重疊率 ≤ 80%(最近距離 ≥ SEP),best-effort;
 *     非相鄰兵線(如 L3 上↔下,中路隔開)仍只防物理疊塔 ≥ STACK。相鄰約束**絕不覆蓋敵我前線 opp≥SEP**(invariant ②):塞不下時退回舊行為(frontNoAdj/spreadNoAdj),塔數與 ② 不回歸。
 *   - 真正 ≤80% 全達成需兵線 ≥ ~5·SEP;現尺度多數兵線做不到 → 靠放大地圖(降 REAL_SCALE)拉長兵線(見 GEO_SCALE_VER)。
 * MUST 用直線距離判定 —— 兵線 90° 急彎時沿線距離會騙過去。稽核:tools/audit_map_rules.mjs。
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
  // 主堡 = 兵線共用端點(每條 index 0 = SWARM、末端 = STEEL);只約束「後塔↔主堡 ≤80%」,不約束前塔。
  const ep = lanes[0] || [];
  const bases = ep.length
    ? [{ x: ep[0][0], z: ep[0][1] }, { x: ep[ep.length - 1][0], z: ep[ep.length - 1][1] }]
    : [];
  const STACK = 2 * OFF + 10;   // 同陣營不同塔位最近塔距下限(> 同塔位左右塔 2·OFF ⇒ 塔模型不互穿)
  // 分陣營記錄已定案砲塔:**敵我**塔對一律 ≥ SEP(preserve invariant ② 前線 80% + 不對射,含跨兵線);
  // **同陣營**塔對只防物理疊塔 ≥ STACK(中線/主堡聚攏屬 DOTA 拓樸固有)。
  const placedS = [], placedT = [];   // 已定案砲塔(帶 li = 所屬兵線)
  const nearest = (T, arr) => {   // 一組塔(左右 2 座)對 arr 內任一點的最近距離(空 arr → Infinity)
    let m = Infinity;
    for (const q of arr) for (const a of T) { const d = d2(a, q); if (d < m) m = d; }
    return m;
  };
  // **相鄰兵線**(|Δli| = 1)同陣營塔的最近距離 —— 用於「相鄰兵線雙砲塔點重疊 ≤80%(≥ SEP)」規則。
  // 只看 arr 內 li 與當前兵線相鄰者;非相鄰(如 L3 的上↔下)仍只由 nearest(…)≥STACK 防疊。
  const nearestAdj = (T, arr, li) => {
    let m = Infinity;
    for (const q of arr) { if (Math.abs(q.li - li) !== 1) continue; for (const a of T) { const d = d2(a, q); if (d < m) m = d; } }
    return m;
  };
  const G = lanes.map((pts) => {
    const { total, at } = geom(pts);
    const site = (side, frac) => {
      const d = side === 'SWARM' ? total * frac : total * (1 - frac);
      const [x, z] = at(d);
      const [ax, az] = at(d - 1), [bx, bz] = at(d + 1);
      const len = Math.hypot(bx - ax, bz - az) || 1;
      return { x, z, nx: (bz - az) / len, nz: -(bx - ax) / len };
    };
    const towers = (p) => [-1, 1].map((s) => ({ x: p.x + p.nx * OFF * s, z: p.z + p.nz * OFF * s }));
    return { site, towers };
  });
  const push = (li, S, T) => { for (const t of S) placedS.push({ x: t.x, z: t.z, li }); for (const t of T) placedT.push({ x: t.x, z: t.z, li }); };
  const pairGap = (S, T) => {   // 當前敵我兩組塔的最近距離(前線爭中線目標 ≈ SEP)
    let m = Infinity;
    for (const a of S) for (const b of T) { const d = d2(a, b); if (d < m) m = d; }
    return m;
  };
  // 趟 1:前線(爭中線,永不捨棄)。硬底線(絕不為軟規則犧牲):**敵我對距 opp**(含當前對 + 跨兵線敵塔)MUST ≥ SEP(不對射,invariant ②)、
  //   非相鄰同陣營 sameAll ≥ STACK(不疊)。**相鄰兵線同陣營 sameAdj**(|Δli|=1)偏好 ≥ SEP(重疊 ≤80%,使用者新增規則,優先滿足)。
  //   ① front:opp≥SEP 且 sameAdj≥SEP 中「og 最貼 SEP」⇒ 敵我 80% 且相鄰兵線 ≤80%;
  //   ② frontNoAdj:相鄰兵線塞不下 ≤80% 時退回「只保 opp≥SEP(② 不破)、相鄰 best-effort」= 舊行為,② 與塔數不回歸;
  //   ③ anti:匯聚使 opp 全<SEP → sameAll≥STACK 中 opp 最大;④ fb:連疊都難 → min(opp,sameAll,sameAdj) 最大。L1 無相鄰 ⇒ sameAdj=∞ ⇒ 退化為純 min og。
  const frontSites = [];
  for (let li = 0; li < G.length; li++) {
    const { site, towers } = G[li];
    let front = null, frontNoAdj = null, anti = null, fb = null;
    for (let f = GAME.TOWER_MIN_FRAC; f <= GAME.TOWER_MAX_FRAC + 1e-9; f += 0.002) {
      const pS = site('SWARM', f), pT = site('STEEL', f);
      const S = towers(pS), T = towers(pT);
      const opp = Math.min(pairGap(S, T), nearest(S, placedT), nearest(T, placedS));   // 全敵我對距
      const sameAll = Math.min(nearest(S, placedS), nearest(T, placedT));              // 全同陣營跨兵線(防疊)
      const sameAdj = Math.min(nearestAdj(S, placedS, li), nearestAdj(T, placedT, li)); // 相鄰兵線同陣營(≤80%)
      const og = pairGap(S, T);
      const e = { f, pS, pT, og };
      const oppOk = opp >= SEP - 1e-6 && sameAll >= STACK - 1e-6;
      if (oppOk && sameAdj >= SEP - 1e-6 && (!front || og < front.og)) front = e;   // 首選:② + 相鄰 ≤80%,og 貼 SEP
      if (oppOk && (!frontNoAdj || og < frontNoAdj.og)) frontNoAdj = e;             // 保底:相鄰塞不下時守住 ②(= 舊行為)
      if (sameAll >= STACK - 1e-6 && (!anti || opp > anti.opp)) anti = { ...e, opp };
      const combo = Math.min(opp, sameAll, sameAdj);
      if (!fb || combo > fb.combo) fb = { ...e, combo };
    }
    const fe = front || frontNoAdj || anti || fb;
    push(li, towers(fe.pS), towers(fe.pT));
    frontSites.push({ frac: fe.f, SWARM: fe.pS, STEEL: fe.pT });
  }
  // 趟 2:後方(己方防線,per-lane;不捨棄 ⇒ 塔數不變、平衡不動)。硬底線:敵我對距 opp ≥ SEP(不對射)、非相鄰同陣營 sameAll ≥ STACK(不疊)。
  //   軟目標(皆 ≥ SEP ⇒ ≤80%):sep = 後塔↔己方主堡/同兵線前塔、sameAdj = 後塔↔**相鄰兵線**同陣營塔(前/後皆算,使用者新增規則,優先滿足)。
  //   ① strict:sep≥SEP 且 sameAdj≥SEP 時取最貼主堡(防禦縱深);② spread:相鄰塞得下(sameAdj≥SEP)時 sep 最大;
  //   ③ spreadNoAdj:相鄰塞不下時退回舊行為(只保 opp/sameAll,sep 最大);④ fb:皆難 → min(sep,opp,sameAll,sameAdj) 最大。
  return frontSites.map((frontSite, li) => {
    const { site, towers } = G[li];
    const fS = towers(frontSite.SWARM), fT = towers(frontSite.STEEL);   // 己方前塔
    let strict = null, spread = null, spreadNoAdj = null, fb = null;
    for (let f = GAME.TOWER_MIN_FRAC; f < frontSite.frac - 1e-6; f += 0.002) {
      const pS = site('SWARM', f), pT = site('STEEL', f);
      const S = towers(pS), T = towers(pT);
      const sep = Math.min(nearest(S, [bases[0]]), nearest(S, fS), nearest(T, [bases[1]]), nearest(T, fT));
      const opp = Math.min(nearest(S, placedT), nearest(T, placedS));
      const sameAll = Math.min(nearest(S, placedS), nearest(T, placedT));
      const sameAdj = Math.min(nearestAdj(S, placedS, li), nearestAdj(T, placedT, li));   // 相鄰兵線同陣營(前/後皆算)
      if (opp >= SEP - 1e-6 && sameAll >= STACK - 1e-6) {
        if (!spreadNoAdj || sep > spreadNoAdj.sep) spreadNoAdj = { pS, pT, f, sep };       // 舊行為保底(相鄰塞不下時)
        if (sameAdj >= SEP - 1e-6) {                                                       // 相鄰兵線 ≤80% 優先
          if (sep >= SEP - 1e-6 && !strict) strict = { pS, pT, f };
          if (!spread || sep > spread.sep) spread = { pS, pT, f, sep };
        }
      }
      const combo = Math.min(sep, opp, sameAll, sameAdj);
      if (!fb || combo > fb.combo) fb = { pS, pT, f, combo };
    }
    const pick = strict || spread || spreadNoAdj || fb;
    if (pick) { push(li, towers(pick.pS), towers(pick.pT)); return [{ frac: pick.f, SWARM: pick.pS, STEEL: pick.pT }, frontSite]; }
    return [frontSite];
  });
}

/**
 * 砲塔佈局規則稽核(規則 #4 的**唯一結算縫**)—— 給定兵線(遊戲公尺),跑 solveTowerSites 後
 * 檢查所有塔↔塔 / 塔↔主堡的射程重疊,回傳是否合規 + 各項最壞值。稽核工具、自訂地圖掃描
 * (mapSelect)、伺服器 validateBattleConfig、烘焙工具**共用這一支**,MUST NOT 各寫一套。
 *   合規 = 無「殘餘 >80%」(後塔↔己方主堡 / 後塔↔同兵線己方前塔 / 相鄰兵線同陣營塔)且無物理疊塔(≥ STACK)。
 *   敵我前線塔重疊 ≤80% 是固有設計(invariant ②,solveTowerSites 保證),不算殘餘。
 * lanes: [[x,z], …][](遊戲公尺;index 0 = SWARM 端、末端 = STEEL 端,與 solveTowerSites 同)。
 */
export function towerLayoutAudit(lanes) {
  const R = UNITS.tower.range, OFF = GAME.TOWER_SIDE_OFF;
  const BASE_R = Math.max(UNITS.base.range, UNITS.base.guns.range);
  const STACK = 2 * OFF + 10;
  const overlapPct = (d, ra, rb) => Math.max(0, (ra + rb - d) / Math.min(ra, rb)) * 100;
  const sites = solveTowerSites(lanes);
  const ep = lanes[0] || [];
  const structs = [];
  if (ep.length) {
    const baseXY = { SWARM: { x: ep[0][0], z: ep[0][1] }, STEEL: { x: ep[ep.length - 1][0], z: ep[ep.length - 1][1] } };
    for (const side of ['SWARM', 'STEEL']) structs.push({ side, role: 'base', li: -1, r: BASE_R, pts: [baseXY[side]] });
  }
  for (let li = 0; li < sites.length; li++) {
    sites[li].forEach((st, idx) => {
      const role = idx === sites[li].length - 1 ? 'front' : 'rear';
      for (const side of ['SWARM', 'STEEL']) {
        const p = st[side];
        structs.push({ side, role, li, r: R, pts: [-1, 1].map((s) => ({ x: p.x + p.nx * OFF * s, z: p.z + p.nz * OFF * s })) });
      }
    });
  }
  const minTD = (A, B) => { let m = Infinity; for (const a of A.pts) for (const b of B.pts) m = Math.min(m, Math.hypot(a.x - b.x, a.z - b.z)); return m; };
  let residual = 0, minStack = Infinity, worstRB = 0, worstRF = 0, worstAdj = 0, oppFront = 0;
  for (let i = 0; i < structs.length; i++) for (let j = i + 1; j < structs.length; j++) {
    const a = structs[i], b = structs[j];
    if (a.li === b.li && a.role === b.role && a.side === b.side) continue;   // 同塔位左右塔
    const d = minTD(a, b), pct = overlapPct(d, a.r, b.r);
    const rear = a.role === 'rear' ? a : b.role === 'rear' ? b : null;
    const other = rear === a ? b : a;
    if (rear && other.role === 'base' && rear.side === other.side) { worstRB = Math.max(worstRB, pct); if (pct > 81) residual++; }
    else if (rear && other.role === 'front' && rear.side === other.side && rear.li === other.li) { worstRF = Math.max(worstRF, pct); if (pct > 81) residual++; }
    if (a.role !== 'base' && b.role !== 'base' && a.side === b.side && Math.abs(a.li - b.li) === 1) { worstAdj = Math.max(worstAdj, pct); if (pct > 81) residual++; }
    if (a.role === 'front' && b.role === 'front' && a.side !== b.side && a.li === b.li) oppFront = Math.max(oppFront, pct);
    if (a.role !== 'base' && b.role !== 'base') minStack = Math.min(minStack, d);
  }
  const stackBad = minStack < STACK - 1;
  return { ok: residual === 0 && !stackBad, residual, minStack: minStack === Infinity ? 0 : minStack, stackBad, worstRB, worstRF, worstAdj, oppFront };
}

/**
 * 砲塔 × 隧道洞口稽核(規則 #5 的**唯一結算縫**)—— 落在隧道覆蓋段內的砲塔,
 * 沿兵線到最近洞口的距離 d MUST ≤ range ×(1 − GAME.TOWER_TUNNEL_OUT_F),
 * 即「至少 TOWER_TUNNEL_OUT_F 比例的射程涵蓋到洞口外」。
 * lanes: 同 solveTowerSites(遊戲公尺);tunSpans[li] = [[s0,s1]…] 該兵線的隧道覆蓋弧長區間
 *   (遊戲公尺,沿兵線自 SWARM 端起算;該線無隧道給 [] 或省略)。
 * **隧道資料只在離線期存在**(覆蓋區間 = 圖資 tunnel way × 地形高度,見 biomes.tunnelCoverIntervals),
 * 開局時 solveTowerSites 手上只有兵線 ⇒ 本規則是**選線期**的判定(烘焙/稽核),
 * MUST NOT 改成執行期挪塔 —— 伺服器與客戶端拿不到同一份洞口資料,塔位會分家。
 */
export function towerTunnelAudit(lanes, tunSpans = []) {
  const need = UNITS.tower.range * (1 - GAME.TOWER_TUNNEL_OUT_F);
  const sites = solveTowerSites(lanes);
  const bad = [];
  let worst = 0, inside = 0;
  for (let li = 0; li < sites.length; li++) {
    const spans = tunSpans[li] || [];
    if (!spans.length) continue;
    const pts = lanes[li] || [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    sites[li].forEach((st, idx) => {
      const role = idx === sites[li].length - 1 ? 'front' : 'rear';   // 末項 = 前線塔(見 solveTowerSites 回傳序)
      for (const side of ['SWARM', 'STEEL']) {
        const s = side === 'SWARM' ? total * st.frac : total * (1 - st.frac);
        for (const [a, b] of spans) {
          if (s < a || s > b) continue;
          inside++;
          const d = Math.min(s - a, b - s);
          if (d > worst) worst = d;
          if (d > need + 1e-6) bad.push({ li, role, side, s, d });
        }
      }
    });
  }
  return { ok: bad.length === 0, need, worst, inside, bad };
}

// ---- 地形呈現(解析度 + 主要道路外海拔放大)----
// GRID_N/ELEV_ZOOM 純渲染;AMP_* 會改 heightAt(單位貼地)故列為平衡值住這裡。
export const TERRAIN = {
  GRID_N: 193,        // 地形頂點解析度(129→193;純幾何,便宜)
  ELEV_ZOOM: 13,      // 高程磚 zoom(真實範圍已縮半,可提高一級;磚數仍在 buildTerrain 守衛內)
  AMP: 0.9,           // 主要道路(兵線)以外:相對全場均值的海拔偏差放大係數
  AMP_R0: 45,         // 距兵線 ≤ R0(= LANE_SAFE_M 走廊):完全不放大,保留真實可行駛
  AMP_R1: 260,        // 距兵線 ≥ R1:完全放大
  // 市區衰減(2026-07-17 巴黎陡峭案):SRTM 在市區含建物殘留雜訊(±5~10m 街廓級顆粒),
  // AMP 放大後平坦市街變丘壑、建物半埋、河谷成乾峽谷 —— 市區場地本就該平。
  // 有效放大 = AMP × (1 − mix.urban × AMP_URBAN_F);巴黎 urban 0.8 → ×0.2。
  // 自訂地圖無 venue.mix → 不衰減(行為不變);山地/荒野場地 urban≈0 → 丘壑照舊。
  AMP_URBAN_F: 1.0,
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

// 沼澤扣血速率 = 火災 dot 的 SWAMP_DRAIN_FIRE_FRAC(1/3)—— 推導值回填(MUST NOT 手寫;單一真相 = 火災 dot)。
TERRAIN_FX.SWAMP_DRAIN_PS = HAZARDS.fire.dot * TERRAIN_FX.SWAMP_DRAIN_FIRE_FRAC;

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
// 防空陣地射程 = 「每線防空打擊面積 ÷ 陣地數」的等效圓半徑(2026-07-17:防空總面積 =
// 地雷總面積 × THREAT_AA_AREA_FRAC(1/3)⇒ 防空密度 = 地雷密度的 1/3;不再等面積)。
FIELD.AA_SITE.range = Math.round(
  Math.sqrt(GAME.THREAT_AREA_PER_LANE * GAME.THREAT_AA_AREA_FRAC / (Math.PI * FIELD.AA_SITES_PER_LANE)));
// 防空伏擊傷害 = 初始無人機平均總血量(護盾+裝甲)的 1/3(2026-07-17:不再命中即墜)。
GAME.AA_AMBUSH.DMG = Math.round(SQUAD.DRONE_AVG_HP / 3);
// 爆風半徑(2026-08-13「所有爆炸傷害武器都套用」):飛彈 = 導彈類,MUST 真的炸開 —— 舊制的
// `boom` 事件寫著 r = 14 而結算是單發直擊(演出與結算分家)。它是**一次性彈藥**(每架機體吃過
// 一次要冷卻 THREAT_CD_S = 3 分鐘)⇒ 走 `NPC_BLAST.SHOT`(單發傷害為單位)那一條;拿持續 DPS
// 算的話分母趨近 0,半徑會膨脹到 95m。現值 ≈7.5m。
GAME.AA_AMBUSH.R = npcBlastR(GAME.AA_AMBUSH.DMG, NPC_BLAST.SHOT);

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

// ---- 空投物資(2026-07-17;非兵線隨機空投,時間驅動,不分陣營先到先得)----
// 與 LOOT(擊毀障礙掉落)分家:LOOT 事件驅動、掉在障礙原地;空投時間驅動、投在非兵線空曠處。
// 每 INTERVAL_S 投一批 → 批量 = ceil(玩家數 × PER_PLAYER)(至少 1、上限 MAX_LIVE);每箱存活 TTL_S。
// 箱型 S/M/L 依 SIZES 權重(15:4:1);開箱等機率抽 medkit(補血+護盾)/ battery(補電力·可破上限 + 減招式CD)/ money。
// 獎勵量 = 基準 × 箱型 mul;medkit/battery 以「上限比例」計 ⇒ 三機種同一手感。全部伺服器結算。
export const AIRDROP = {
  INTERVAL_S: 60,          // 投放間隔(每分鐘一批)
  TTL_S: 180,              // 單箱存活上限(3 分鐘,過期自毀)
  LAND_S: 1.6,             // 落地時間:降落傘飄降期間不可拾取(客戶端同步演出下降 DROP_H)
  DROP_H: 55,              // 空投起始高度(公尺;純客戶端下降動畫用)
  PER_PLAYER: 2.0,         // 批量 = ceil(玩家數 × 此值);玩家數 = sim.squads.size = 敵我雙方總玩家數(含電腦)
                           //   ⇒ 每批空投數 = 總玩家數 × 2(2026-07-18 使用者指定)
  MAX_LIVE: 40,            // 場上同時存在上限(防堆積;放寬到能容一整批 ×2 + 前批殘留不被夾)
  PICK_R: 8, MAX_Y: 25,    // 拾取半徑 / 拾取高度上限(沿用 LOOT 尺度)
  LANE_MIN: 60,            // 距兵線走廊最小距離(= 非兵線位置)
  BASE_CLEAR: 130,         // 距主堡淨空(不投在重生點附近)
  SIZES: [                 // 權重 15:4:1(S 75% / M 20% / L 5%);mul = 該箱獎勵倍率
    { key: 'S', w: 15, mul: 1.0 },
    { key: 'M', w: 4,  mul: 2.0 },
    { key: 'L', w: 1,  mul: 3.5 },
  ],
  REWARDS: ['medkit', 'battery', 'money'],   // 開箱等機率抽一種
  MEDKIT_HP: 0.35,         // 回復裝甲 HP(× maxHp × 箱型 mul,夾 maxHp)
  MEDKIT_SP: 0.5,          // 回復護盾(× maxSp × 箱型 mul,夾 maxSp)
  BATTERY_MP: 0.6,         // 回復電力(× maxMp × 箱型 mul;可 overcharge 超過上限)
  BATTERY_CD: 5,           // 招式冷卻減少秒數(skill + ult,× 箱型 mul)
  MONEY: 50,               // 金錢(× 箱型 mul)
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
//
// ---- 操作節奏(2026-07-27 使用者需求:依難度限制「每項操作切換」的時間間隔)----
// 舊制 bot 每個 tick 都能重新決策(= 無限手速 + 零反應時間),難度差只有「準不準」一項。
// 新制兩顆旋鈕(bots.js `_op()` 是唯一節流縫,MUST NOT 在別處另寫 tick 計數式節流):
//   gap   = 全域手速上限 —— 任兩次操作之間的最短間隔(秒);一次只能做一件事。
//   react = 反應時間 —— 目標換人(新目標入視野)到準星拉上去可以開火的延遲(秒)。
// 各類操作另有自己的切換間隔 = gap × BOT_OPS[操作](見 botOpGap):
//   掃描選敵 / 切重武器 / 施放招式 / 機種絕招 / 行為狀態切換 / 開商店。
// 最高難度對齊**頂尖 FPS 電競選手實測值**:視覺刺激→扣扳機的反應時間 150~200ms、
// 有效操作約 400 APM ⇒ 兩者都取 0.15s。伺服器 tick 為 GAME.TICK_MS(125ms)⇒ 高難度幾乎不設限
// (就是人類手速的頂點),往下每一級明顯遲鈍:中 ≈ 熟練玩家、低 ≈ 一般玩家、新手 ≈ 生手。
// 持續開火**不算切換操作**(扳機是按住的,不是每發重按一次)⇒ 不吃 gap,射速仍由 sim 的武器 rate 把關。
//
// ---- 戰術旗標(2026-08-02 使用者需求:中/高難度的操作邏輯優化)----
// tactic(中/高):威脅選敵(對我傷害最高 / 對我方總輸出最高 / 快陣亡)+ 兩段撤退線。
// elite(高):撿尾刀、打帶跑、扛半條護盾就後撤。
// 難度分層一律走這兩顆旗標 —— bots.js MUST NOT 比對難度字串(`diff.key === 'high'` 一出現就是第二份分級表)。
export const BOT_DIFF = {
  novice: { key: 'novice', name: '新手', aimErr: 0.55, heavy: false, ability: false, gap: 0.90, react: 0.70, tactic: false, elite: false },
  low:    { key: 'low',    name: '低',   aimErr: 0.35, heavy: true,  ability: false, gap: 0.55, react: 0.45, tactic: false, elite: false },
  medium: { key: 'medium', name: '中',   aimErr: 0.15, heavy: true,  ability: true,  gap: 0.30, react: 0.28, tactic: true,  elite: false },
  high:   { key: 'high',   name: '高',   aimErr: 0.0,  heavy: true,  ability: true,  gap: 0.15, react: 0.15, tactic: true,  elite: true  },
};
// 各類操作的切換間隔 = 該難度 gap × 此倍數(1 = 一次基本操作)。
// buy 27 ⇒ 高難度 ≈ 4.1s,與 2026-07-27 之前的硬編碼 4s 巡店節奏一致(其餘難度按手速等比放慢)。
export const BOT_OPS = { scan: 2, weapon: 3, ability: 4, special: 5, state: 4, buy: 27 };
export const BOT_DIFF_KEYS = ['novice', 'low', 'medium', 'high'];
export const DEFAULT_BOT_DIFF = 'medium';
export const botDiffOf = (key) => BOT_DIFF[key] || BOT_DIFF[DEFAULT_BOT_DIFF];
/** 某難度下某類操作的最短切換間隔(秒);未列名的操作 = 一次基本操作(× 1) */
export const botOpGap = (D, op) => (D?.gap ?? BOT_DIFF[DEFAULT_BOT_DIFF].gap) * (BOT_OPS[op] ?? 1);

// ---- 電腦玩家視野(2026-08-02 使用者定案)----
// 需求原文:「電腦應該要跟玩家一樣只有前方特定角度範圍的視野,其他方向敵人來襲視角要跟著轉向,
// 不可以有全角度視野」。舊制 bot 的 `_acquire` 只吃「射程 + 迷霧 + LOS」⇒ 正背後的敵人照樣鎖得到
// (**全角度視野**),而真人只看得到螢幕上那一塊 —— 這是 bot 相對真人最不公平的一項優勢。
//
// **只限水平**:bot 沒有俯仰狀態(`h.ry` 是它唯一的視角欄位),垂直錐無從量起;硬套一份垂直角
// 只會讓巡航高度的無人機對正下方的目標整批失明(原則 6 寧缺勿錯)。
//
// **半視角推導不手寫**:相機吃的 `UNITS[kind].fov` 是**垂直**視角,畫面的水平半視角 =
// `atan(tan(fov/2) × 寬高比)`(與 game.js 濺血方位的 `halfH` 同一條式子)。bot 沒有畫面 ⇒
// 寬高比取寬螢幕基準 `ASPECT`;窄螢幕的真人只會看得更少,取寬 = 偏差一律朝「不苛刻 bot」。
//
// 轉頭速度**不另立常數**:一律走 `viewLockStep`(真人視野鎖定輔助的同一支角速度上限)——
// 「跟玩家一樣」包含「不能瞬間回頭」,bots.js MUST NOT 手寫 rad/s。
export const BOT_VIEW = {
  ASPECT: 16 / 9,   // 基準畫面寬高比(bot 沒有畫面,取寬螢幕)
  ALERT_S: 4,       // 受擊警戒:被視野外的敵人打中之後,朝彈著方向轉頭的持續秒數
};
/** 電腦玩家的水平半視角(弧度):看得見 = 目標方位與機體朝向的夾角 ≤ 這個值 */
export const botFovHalf = (kind) =>
  Math.atan(Math.tan((UNITS[kind]?.fov ?? 68) * Math.PI / 360) * BOT_VIEW.ASPECT);

// ---- 電腦玩家戰術(2026-08-02 使用者定案)----
// 需求原文:「被打時優先對『對自己傷害最高者、造成敵人最大總傷害、快要陣亡的目標』進行攻擊」/
//          「HP 低於 25% 才會回主堡,否則撤退到最近砲塔後方兵線等滿護盾即可」/
//          高級追加「撿尾刀、打帶跑操作、扛半條護盾就後撤」。
//
// 舊制 bot 的選敵只有「加權距離最近」一條(`_acquire`),撤退只有「回主堡補到 85%」一條 ——
// 前者讓 bot 對著滿血步槍兵磨到死也不去收隔壁剩一口氣的英雄,後者讓每次擦傷都變成一趟
// 橫越半張地圖的長征(兵線空窗 30 秒以上)。這兩件事都不是「準不準」,是**取捨**,所以分級
// 走 BOT_DIFF 的 tactic/elite 旗標,新手/低難度**逐位元維持舊制**。
//
// **三項選敵指標一律正規化成「候選集內的佔比」**:傷害量的絕對值跨場地/跨時間沒有可比性
// (開局 200 點就是最高威脅、後期 2000 點才是),拿絕對值當權重等於讓權重隨戰況漂移。
export const BOT_TACTIC = {
  // ① 選敵優先度(見 botTargetPrio;三項各自 0~1)
  THREAT_S: 6,      // 威脅記憶秒數:只有「剛剛還在打我的人」算正在打我(線性淡出)
  W_THREAT: 1.5,    // 對自己傷害最高者
  W_OUTPUT: 0.7,    // 對我方造成總傷害最高者(專殺輸出核心)
  W_EXEC: 1.0,      // 快要陣亡的目標
  EXEC_S: 1.0,      // 收割窗:這麼多秒的持續輸出打得完 = 撿得到尾刀(見 botSalvo)
  EXEC_MAX: 3,      // 撿尾刀的權重輸入(見 botExecW)—— 刻意遠高於「已損失比例」的上限 1
  // ② 撤退線(使用者定案:回主堡是**唯一**會離開兵線的情況)
  PULL_HP: 0.32,    // 脫離交戰的裝甲門檻(= 改制前 bots.js 的 RETREAT_HP,平衡不動)
  BASE_HP: 0.25,    // 低於此才回主堡
  RESUME_HP: 0.85,  // 回堡補血的復出線(= 改制前的 RESUME_HP)
  RALLY_BACK_M: 70, // 集結點:沿兵線退到最近己方砲塔後方多遠
  // ③ 護盾線。**進場 PULL_SP、出場 RALLY_SP** 是刻意留寬的遲滯帶:裝甲離開主堡不會自己回,
  //    單看裝甲的話「退到塔後 → 護盾滿 → 回去 → 血還是低 → 又退」會在門檻上無限抖動。
  PULL_SP: 0.5,     // 扛掉半條護盾(高難度單獨成立;中難度需同時裝甲 < PULL_HP)
  RALLY_SP: 0.98,   // 集結點復出線:護盾回到接近滿(「等滿護盾即可」)
  // ④ 打帶跑(高難度):距離環比例
  KITE_NEAR: 0.55,  // 可擊發 ⇒ 貼上去
  KITE_FAR: 0.95,   // 裝填中 ⇒ 拉到射程外緣
  // ⑤ 其餘距離環 / 選敵折算 / 招式血線(2026-08-08 定位分類改制收成旋鈕)。
  //    基準值**逐一等於**改制前 bots.js 那幾個硬編碼常數 ⇒ 沒有定位覆寫時逐位元同舊制。
  //    收成旋鈕的理由不是「比較整齊」:定位策略要調的就是這幾個數,留在 bots.js 裡等於
  //    「策略表在 data.js、真正在動的數字在別的檔」——第二份實作的標準形狀。
  KEEP_F: 0.6,       // 沒有打帶跑時的一般距離環(中難度與非 elite 同吃)
  KEEP_STRUCT: 0.85, // 打建築的距離環(塔/主堡不會追,拉開只是白白少打幾秒)
  PRIO_HERO: 0.55,   // 選敵加權距離:英雄的折扣(< 1 = 優先咬人)
  PRIO_STRUCT: 1.3,  // 選敵加權距離:塔/主堡的加價(> 1 = 順路才拆)
  CAST_HURT: 0.55,   // 自保/輔助招式的觸發血線(裝甲低於此才放治療/減傷)
};
/** 選敵優先度(≥1,越大越優先;`_acquire` 以加權距離除以它)。三項佔比一律 0~1 ——
 *  消費端 MUST NOT 另寫權重或改變組合方式。
 *  第二參數 T = 戰術旋鈕表(預設全域 BOT_TACTIC;學習迴圈逐 brain 注入候選策略用,見 BOT_LEARN)。 */
export const botTargetPrio = ({ threat = 0, output = 0, exec = 0 }, T = BOT_TACTIC) =>
  1 + T.W_THREAT * threat + T.W_OUTPUT * output + T.W_EXEC * exec;
/** 威脅記憶淡出(線性;THREAT_S 秒後歸零)—— 剛剛挨的那一槍權重最高。
 *  THREAT_S 刻意**不在** BOT_LEARN 白名單:sim._hurtLog 累加前的淡出吃同一支(全域)——
 *  帳的時鐘只有一個,逐 brain 各走各的秒數 = 記帳與讀帳兩個時鐘(第二份帳的變體)。 */
export const botThreatDecay = (age, T = BOT_TACTIC) => Math.max(0, 1 - Math.max(0, age) / T.THREAT_S);
/** 一個收割窗內打得出的傷害(撿尾刀的判準)。刻意是**近似**:不含護甲減免/爆擊/衰減 ——
 *  這是「該不該插隊去收人頭」的取捨,不是傷害結算(結算永遠只在 sim._damage)。 */
export const botSalvo = (wd, kind, T = BOT_TACTIC) => wd.dmg * vsMult(wd, kind) * wd.rate * T.EXEC_S;
/**
 * 「快要陣亡」那一項的權重輸入。一般 = **已損失比例**(0~1);收割窗內打得完 = `EXEC_MAX`。
 * 兩者刻意差一個量級:「剩一口氣」只是排序偏好(反正誰打都會死),「我這一秒打得死」才是
 * 該丟下手上目標去插隊的理由 —— 兩件事若共用 0~1 的尺,撿尾刀就只是個四捨五入的雜訊。
 * `salvo = 0` ⇒ 關掉收割分支(中難度只有一般的低血偏好),消費端 MUST NOT 另寫 if。
 */
export const botExecW = (ehp, maxEhp, salvo) =>
  (salvo > 0 && ehp <= salvo) ? BOT_TACTIC.EXEC_MAX
    : (maxEhp > 0 ? Math.max(0, 1 - ehp / maxEhp) : 0);
/** 打帶跑的距離環比例:可擊發 = 貼上去、裝填中 = 拉開 */
export const botKiteF = (ready, T = BOT_TACTIC) => (ready ? T.KITE_NEAR : T.KITE_FAR);

// ---- 電腦玩家學習策略(2026-08-06 使用者需求「最佳操作策略的電腦玩家,平衡性調整時可不斷學習」)----
// 手寫的 BOT_TACTIC 是**基準**;`tools/bot_learn.mjs` 以離線自對戰(CRN 配對鏡射 + 鏡射高斯
// 擾動)持續優化其中的**取捨型旋鈕**,成果寫進 `botPolicy.js`,由下面的覆寫迴圈套回 BOT_TACTIC。
// 平衡數值一改(指紋 `balanceFingerprint()` 變了)⇒ 重跑 bot_learn 即以現行策略暖啟動再學 —— 這
// 就是「平衡性調整時可不斷學習」的落點:策略不追 commit,追**平衡指紋**。
//
// 四條紀律(缺一即是 A32/A33 倒退,詳見 docs/bot_design.md 與 audit_bot_policy.mjs):
// ①**只學「取捨」,不學「能力」**:白名單全是決策權重/距離環/集結參數 —— 視野(BOT_VIEW)、
//   手速(BOT_DIFF.gap/react)、準度(aimErr)一律不可學,學了就是把「比真人多看/多走」偷渡回來。
// ②**使用者定案值不可學**:PULL_SP(=0.5)/BASE_HP(=0.25)/PULL_HP/RESUME_HP/EXEC_MAX 是
//   2026-08-02 使用者定案或舊制平衡錨,MUST NOT 進白名單;THREAT_S 見 botThreatDecay 檔頭。
// ③**白名單鍵 MUST 只被 tactic/elite 分支消費**(讀取端 = bots.js `this.tac`):新手/低難度
//   因此**結構性地**逐位元維持舊制,不靠「記得別改到」。
// ④**夾制只有 `botPolicySanitize` 一份**(執行期覆寫與學習工具同吃):邊界鏡射
//   audit_bot_tactics 的守門斷言(W_THREAT 恆最重、RALLY_SP ∈ (0.9,1)、KITE 近 < 遠…)——
//   壞掉的學習輪寫出再離譜的值,套用時也會被夾回合法域(原則 6)。
export const BOT_TACTIC_BASE = Object.freeze({ ...BOT_TACTIC });   // 手寫基準快照(同 rate0 的留檔模式)
export const BOT_LEARN = {
  // 可學習鍵與邊界 [lo, hi](夾制唯一真相;audit_bot_policy 反查每一條都收在 audit_bot_tactics 的守門線內)
  KEYS: {
    W_THREAT: [0.8, 4],        // 對自己傷害最高者的權重(恆最重,由 GAP 交叉夾制保證)
    W_OUTPUT: [0, 2],          // 對我方總輸出最高者
    W_EXEC: [0, 2.5],          // 快要陣亡目標
    EXEC_S: [0.4, 2.5],        // 收割窗秒數
    RALLY_SP: [0.91, 0.995],   // 集結復出的護盾線(audit 守門 (0.9, 1) 之內)
    RALLY_BACK_M: [20, UNITS.tower.range * 0.9],   // 集結點退到塔後多遠(推導:恆 < tower.range 守門線)
    KITE_NEAR: [0.35, 0.8],    // 打帶跑:可擊發的距離環
    KITE_FAR: [0.75, 1],       // 打帶跑:裝填中的距離環
  },
  GAP: 0.05,   // 交叉約束的最小間距(W_THREAT 對其餘權重 / KITE 近對遠)
};
/**
 * 策略夾制的**唯一縫**:部分策略(botPolicy.js 的 tactic 或學習中的候選)→ 完整合法旋鈕表。
 * 非白名單鍵/非有限數一律忽略(= 取基準);逐鍵夾邊界後再套交叉約束。
 * `botPolicySanitize({})` MUST 逐位元等於 BOT_TACTIC_BASE(中性不變式,稽核釘住)。
 */
export const botPolicySanitize = (p) => {
  const out = { ...BOT_TACTIC_BASE };
  for (const [k, [lo, hi]] of Object.entries(BOT_LEARN.KEYS)) {
    const v = p?.[k];
    if (Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, v));
  }
  return botTacticCross(out);
};
/**
 * 旋鈕表的**交叉約束**(唯一實作:學習夾制 `botPolicySanitize` 與定位覆寫 `botRoleTactic` 同吃)。
 * 鏡射 audit_bot_tactics 的守門斷言,只收緊不放寬;就地改寫並回傳同一個物件。
 * 兩個消費端各抄一份的下場:學習寫得出的合法值,定位覆寫寫不出來(或反過來)——
 * 而兩邊都不會報錯,只表現成「某個定位的 bot 行為怪怪的」。
 *   ・W_THREAT 恆最重(「被打時優先」是需求原文的第一順位)
 *   ・KITE 近 < 遠(打帶跑的兩個環不得交叉,交叉 = 裝填中反而貼上去)
 *   ・PULL_HP > BASE_HP(RALLY 的窗口:低於 BASE_HP 就直接回堡了,兩條線一旦反轉
 *     「退到砲塔後方」那一段就是死碼,而畫面上只表現成「這台 bot 一受傷就跑回家」)
 */
export const botTacticCross = (out) => {
  out.W_THREAT = Math.max(out.W_THREAT, Math.max(out.W_OUTPUT, out.W_EXEC) + BOT_LEARN.GAP);
  out.KITE_FAR = Math.min(1, Math.max(out.KITE_FAR, out.KITE_NEAR + BOT_LEARN.GAP));
  out.KITE_NEAR = Math.min(out.KITE_NEAR, out.KITE_FAR - BOT_LEARN.GAP);
  out.PULL_HP = Math.max(out.PULL_HP, out.BASE_HP + BOT_LEARN.GAP);
  return out;
};
{ // 覆寫迴圈(唯一套用點):學習成果 → BOT_TACTIC。空 policy ⇒ 逐位元同基準。
  const s = botPolicySanitize(BOT_POLICY?.tactic);
  for (const k of Object.keys(BOT_LEARN.KEYS)) BOT_TACTIC[k] = s[k];
}

// ---- 電腦玩家定位分類與策略(2026-08-08 使用者需求「依機體技能等數值為電腦玩家分類,並設計不同策略」)----
// 改制前,32 台機體的 bot 全部共用**同一張** BOT_TACTIC:同樣的距離環、同樣的選敵權重、同樣的
// 撤退線、同樣的採購順序。一台 6.4m/s 的偵察無人機與一台扛 26 護甲的攻城機甲用一模一樣的
// 打法 —— 而那張表只可能對其中一種是對的。畫面上不會有任何錯誤訊息,只表現成「這台 bot 好像
// 不太會用自己的機體」。
//
// ---- 六條 MUST ----
// ① **分類推導不手寫**:定位由機體自己的數值算出來,MUST NOT 出現任何逐角色名冊(`s01: 'raider'`
//    這種東西一旦寫下去,改平衡數值時沒有任何東西會提醒你它已經過期)。取值一律走**既有的
//    唯一縫** —— 五條特徵直接吃 `HEX_AXES[].val`(圖鑑六角圖那六軸的同一份取值函式)、攻堅吃
//    `buildDps`、支援吃 `heroAbility`。改任一角色的武器/機體數值,圖鑑與 bot 分類**同步**改。
// ② **特徵是「相對全場的位置」不是絕對值**:同 `hexBand` 的對數分位(差幾倍決定位置,而不是
//    差多少)。絕對值沒有可比性 —— 「射程 190」在輕武器裡是最遠、在重武器裡是最近。
//    `aid` 是例外且刻意如此:它本來就是 0~1 的佔比(「兩個招式槽裡有幾個在供輸隊友」),
//    取分位反而會把「一招都沒有」跟「有一招」拉成 0 與 1 的二元旗標。
// ③ **策略是既有旋鈕的覆寫,不是第二套決策系統**:定位只改 `BOT_TACTIC` 的值 + 採購順序,
//    bots.js 的狀態機/選敵/撤退流程一行都不動。新增一條「定位專用的行為分支」就是第二份實作,
//    而且會與難度分層(A33)打架。讀取縫仍然只有 `this.tac` 一個。
// ④ **覆寫是重分配不是通膨**:每個旋鈕的四個乘數以**角色數加權的幾何平均 = 1** 正規化
//    (同 `AOE_BUDGET.NORM` / `SPEED_COMP` / `BUILD_DPS` 的同一條)⇒ 全場的幾何中點逐位元
//    錨在使用者定案值上。少了這一步,「給每個定位一點加強」會變成整體 bot 悄悄變強/變弱,
//    而 `npm run sim` 的勝負旗標對這種整體漂移是飽和的(量不出來)。
// ⑤ **難度分層不得被繞過**(A33):定位覆寫只在 `BOT_DIFF.tactic` 之下解析 ⇒ 新手/低難度
//    **結構性地**逐位元維持舊制,不靠「記得別改到」。
// ⑥ **與學習迴圈疊加而不是取代**:`bot_learn` 學的是全體共用的**基準**(BOT_LEARN.KEYS),
//    定位覆寫是疊在那份基準上的相對偏移 ⇒ 學習輪不必為 4 個定位各學一份(搜尋空間 ×4、
//    每一份的樣本數 ÷4 = 訊號淹在雜訊裡)。夾制與交叉約束共用 `botTacticCross` 單一縫。
const _hexVal = Object.fromEntries(HEX_AXES.map((a) => [a.key, a.val]));
/** 「這一招是在供輸隊友嗎」的判準:團隊指向恆是;自身指向裡只有這幾種 fx 帶著資訊/續戰價值 */
const AID_FX = new Set(['heal', 'rally', 'recon', 'vision']);
/**
 * 分類特徵(**唯一真相**:名稱 / 從哪裡取值 / 要不要取分位)。`raw` 一律轉呼既有唯一縫,
 * MUST NOT 在這裡自己算 DPS / EHP / 射程(那就是圖鑑與 bot 分類分家的起點)。
 * 六角圖的 `power`(電力)刻意不收:它決定的是「多久能放一次招」,不是「該站多近、該先打誰」——
 * 收進來只會讓分類跟著一個與戰術取捨無關的軸漂移。
 */
export const BOT_ROLE_FEATS = {
  dur:   { name: '耐久', raw: _hexVal.dur },
  armor: { name: '護甲', raw: _hexVal.armor },
  fire:  { name: '火力', raw: _hexVal.fire },
  zone:  { name: '制域', raw: _hexVal.zone },
  mob:   { name: '機動', raw: _hexVal.mob },
  siege: { name: '攻堅', raw: (ch) => buildDps(ch, 'light') + buildDps(ch, 'heavy') },
  aid:   { name: '支援', ratio: true,   // 已是 0~1 的佔比(見上方 ②),不取分位
    raw: (ch) => ['skill', 'ult'].reduce((s, slot) => {
      const A = heroAbility(ch, slot);
      return s + (!A ? 0 : A.target === 'team' ? 1 : AID_FX.has(A.fx) ? 0.5 : 0);
    }, 0) / 2 },
};
/**
 * 四個定位(**唯一真相**:名稱 / 判別剖面 / 策略乘數 / 採購順序)。
 *
 * `w` = 判別剖面:分數 = Σ w_i × (特徵_i − 0.5),取分數最高者。**特徵置中**(減 0.5)是公平性
 * 的來源 —— 各項都恰好中庸的機體對四個定位一律得 0 分,不會因為某個剖面的正權重比較多就
 * 先天佔便宜;`Σ|w| = 1` 讓四個分數落在同一把尺上(稽核釘住這兩條)。
 *
 * `mul` = 策略乘數(相對值;實際套用前先經 `botRoleMul` 正規化,見上方 ④)。
 * `buy` = 八軌採購順序,MUST 是 BOT_BUY_ORDER 的排列(缺一軌 = 那一軌永遠不會被買)。
 *
 * 四個定位的設計主軸(每一條都是「這台機體的數值本來就該這樣打」):
 *   突襲 = 機動高、扛不住 ⇒ 貼身點殺、撿尾刀、獵殺輸出核心,見血就退、退得近(跑得回來)。
 *   壓制 = 制域大、火力高 ⇒ 站中距離讓範圍發揮,不追人也不主動貼臉。
 *   攻堅 = 耐久護甲高、對建築 DPS 高 ⇒ 咬工事、貼著塔打,撐到裝甲見底才脫離。
 *   支援 = 招式在供輸隊友 ⇒ 站得最後面、最早放招、最早脫離(死掉的支援供輸為零)。
 */
export const BOT_ROLES = {
  raider: { name: '突襲',
    w: { mob: 0.45, zone: -0.15, aid: -0.15, dur: -0.13, armor: -0.12 },
    buy: ['lw', 'hw', 'sk', 'ult', 'sp', 'hp', 'ch', 'ar'],
    mul: { KITE_NEAR: 0.80, KEEP_F: 0.80, KEEP_STRUCT: 1.00, W_OUTPUT: 1.25, W_EXEC: 1.30,
      PRIO_HERO: 0.85, PRIO_STRUCT: 1.20, PULL_HP: 1.15, PULL_SP: 1.10, RALLY_BACK_M: 0.80, CAST_HURT: 1.00 } },
  zoner: { name: '壓制',
    w: { zone: 0.45, fire: 0.25, mob: -0.20, siege: -0.10 },
    buy: ['hw', 'lw', 'ult', 'sk', 'hp', 'ar', 'sp', 'ch'],
    mul: { KITE_NEAR: 1.20, KEEP_F: 1.20, KEEP_STRUCT: 1.10, W_OUTPUT: 1.00, W_EXEC: 1.00,
      PRIO_HERO: 1.00, PRIO_STRUCT: 1.00, PULL_HP: 1.00, PULL_SP: 1.00, RALLY_BACK_M: 1.10, CAST_HURT: 1.00 } },
  siege: { name: '攻堅',
    w: { siege: 0.35, dur: 0.20, armor: 0.20, mob: -0.15, zone: -0.10 },
    buy: ['hw', 'ar', 'hp', 'lw', 'ult', 'sk', 'sp', 'ch'],
    mul: { KITE_NEAR: 0.85, KEEP_F: 0.85, KEEP_STRUCT: 0.85, W_OUTPUT: 0.75, W_EXEC: 0.75,
      PRIO_HERO: 1.20, PRIO_STRUCT: 0.70, PULL_HP: 0.90, PULL_SP: 0.85, RALLY_BACK_M: 0.75, CAST_HURT: 0.90 } },
  support: { name: '支援',
    w: { aid: 0.65, fire: -0.15, siege: -0.20 },
    buy: ['sk', 'ult', 'ch', 'lw', 'sp', 'hp', 'hw', 'ar'],
    mul: { KITE_NEAR: 1.15, KEEP_F: 1.20, KEEP_STRUCT: 1.10, W_OUTPUT: 1.20, W_EXEC: 0.85,
      PRIO_HERO: 0.95, PRIO_STRUCT: 1.15, PULL_HP: 1.25, PULL_SP: 1.20, RALLY_BACK_M: 1.25, CAST_HURT: 1.30 } },
};
export const BOT_ROLE_KEYS = Object.keys(BOT_ROLES);
/** 八軌採購順序的基準(沒有定位時 = 舊制;bots.js BUY_ORDER 已收到這裡,MUST NOT 兩邊各一份) */
export const BOT_BUY_ORDER = ['hw', 'lw', 'ult', 'sk', 'hp', 'sp', 'ar', 'ch'];
export const BOT_ROLE = {
  MUL_MAX: 1.5,   // 乘數的合法幅度 [1/MUL_MAX, MUL_MAX](防呆上限;現役最大 1.30)
  // 覆寫後的合法域。與 BOT_LEARN.KEYS 重疊的那幾個 MUST 收在學習邊界之內(稽核反查)——
  // 兩張表對同一個旋鈕給出不同的合法域,就會出現「學習寫不出來、但定位寫得出來」的值。
  KNOBS: {
    KITE_NEAR: [0.35, 0.8],
    KEEP_F: [0.35, 0.95],
    KEEP_STRUCT: [0.6, 1.0],
    W_OUTPUT: [0, 2],
    W_EXEC: [0, 2.5],
    PRIO_HERO: [0.3, 1],
    PRIO_STRUCT: [1, 2.5],
    PULL_HP: [0.2, 0.5],
    PULL_SP: [0.3, 0.7],
    RALLY_BACK_M: [20, UNITS.tower.range * 0.9],
    CAST_HURT: [0.3, 0.85],
  },
};
// ---- 特徵分位 / 定位判定 / 乘數正規化(全部惰性快取:首呼定案,同 hexBand)----
const _roleBand = {};
/** 某特徵在全體現役角色中的值域 { lo, hi }(推導不手寫 —— 改任一角色數值,基準自己跟著走) */
function botRoleBand(key) {
  if (!_roleBand[key]) {
    const f = BOT_ROLE_FEATS[key];
    const v = f ? Object.keys(CHARACTERS).map((c) => Math.max(1e-6, f.raw(c))) : [1];
    _roleBand[key] = { lo: Math.min(...v), hi: Math.max(...v) };
  }
  return _roleBand[key];
}
/** 一名角色的分類特徵向量(每一項 0~1;`ratio` 型直接取原值,其餘取對數分位) */
export const botRoleFeats = (ch) => Object.fromEntries(Object.entries(BOT_ROLE_FEATS).map(([k, f]) => {
  // 佔比型直接取原值(0 是合法的「一招都沒有」);分位型才需要 log 的正值下限
  if (f.ratio) return [k, Math.max(0, Math.min(1, f.raw(ch)))];
  const v = Math.max(1e-6, f.raw(ch));
  const { lo, hi } = botRoleBand(k);
  const span = Math.log(hi / lo);
  return [k, span > 1e-9 ? Math.max(0, Math.min(1, Math.log(v / lo) / span)) : 0.5];
}));
/** 一名角色對四個定位的親和分數(**唯一評分處**;越大越像)。稽核與 UI 若要顯示一律取這一支。 */
export const botRoleScores = (ch) => {
  const f = botRoleFeats(ch);
  return Object.fromEntries(BOT_ROLE_KEYS.map((r) =>
    [r, Object.entries(BOT_ROLES[r].w).reduce((s, [k, w]) => s + w * ((f[k] ?? 0.5) - 0.5), 0)]));
};
const _roleOf = {};
/**
 * 角色的定位(**唯一分類處**)= 親和分數最高者;同分時取 `BOT_ROLE_KEYS` 的宣告序(決定性)。
 * 查無角色回 null ⇒ 呼叫端逐位元退回無定位的基準表(原則 6 降級不例外)。
 */
export function botRoleOf(ch) {
  if (!CHARACTERS[ch]) return null;
  if (!_roleOf[ch]) {
    const sc = botRoleScores(ch);
    let best = BOT_ROLE_KEYS[0];
    for (const r of BOT_ROLE_KEYS) if (sc[r] > sc[best]) best = r;
    _roleOf[ch] = best;
  }
  return _roleOf[ch];
}
/** 全體現役角色的定位名冊 { 角色: 定位 }(乘數正規化的權重來源;稽核與工具同吃) */
let _roster = null;
export const botRoleRoster = () => (_roster ||= Object.fromEntries(
  Object.keys(CHARACTERS).map((c) => [c, botRoleOf(c)])));
const _roleNorm = {};
/**
 * 某旋鈕四個乘數的**角色數加權幾何平均**(正規化基準;見上方 ④)。
 * 除掉它之後,全體現役角色的該旋鈕幾何中點逐位元 = 使用者定案的基準值 ——
 * 「讓某個定位更敢貼上去」的代價是別的定位更保守,而不是整批 bot 一起往前站。
 */
function botRoleNorm(key) {
  if (_roleNorm[key] === undefined) {
    const roster = botRoleRoster();
    const n = {};
    for (const r of BOT_ROLE_KEYS) n[r] = 0;
    let tot = 0;
    for (const c of Object.keys(roster)) { if (n[roster[c]] !== undefined) { n[roster[c]]++; tot++; } }
    let s = 0;
    for (const r of BOT_ROLE_KEYS) s += n[r] * Math.log(BOT_ROLES[r].mul[key] ?? 1);
    _roleNorm[key] = tot > 0 ? Math.exp(s / tot) : 1;
  }
  return _roleNorm[key];
}
/** 某定位在某旋鈕上的**正規化後乘數**(唯一取用處;全體加權幾何平均恆 = 1) */
export const botRoleMul = (key, role) =>
  (BOT_ROLES[role]?.mul?.[key] ?? 1) / botRoleNorm(key);
/**
 * 定位策略表(**唯一套用處**):基準旋鈕表 → 該定位的旋鈕表。
 * `base` = 這顆 brain 當下的基準(全域 BOT_TACTIC,或學習迴圈逐 brain 注入的候選策略)——
 * 定位是疊在它之上的相對偏移,不是取代它(見上方 ⑥)。
 * `role` 為 null / 未知 ⇒ **回傳 base 本身**(逐位元同基準,新手/低難度走這條)。
 */
export function botRoleTactic(base = BOT_TACTIC, role = null) {
  if (!role || !BOT_ROLES[role]) return base;
  const out = { ...base };
  for (const [k, [lo, hi]] of Object.entries(BOT_ROLE.KNOBS)) {
    const b = Number.isFinite(base?.[k]) ? base[k] : BOT_TACTIC_BASE[k];
    out[k] = Math.min(hi, Math.max(lo, b * botRoleMul(k, role)));
  }
  return botTacticCross(out);
}
/** 各定位的採購順序(未知定位 ⇒ 舊制順序) */
export const botBuyOrder = (role) => BOT_ROLES[role]?.buy || BOT_BUY_ORDER;
/**
 * 平衡數值指紋(FNV-1a 32-bit):蓋住學習結果所依附的那批數值 —— 機種/角色(含推導迴圈
 * 定案後的武器階梯)/經濟/波次。指紋一變 = 平衡調整過,botPolicy.js 的 meta.balHash 過期
 * ⇒ bot_learn 提示重新學習(策略檔照常生效 —— 過期的好策略仍比中性好,原則 6)。
 */
export const balanceFingerprint = () => {
  let s;
  try { s = JSON.stringify([UNITS, CHARACTERS, WEAPONS, ECON, SQUAD, GAME]); } catch { return 'json-err'; }
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
};

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

/**
 * 環境標籤(「夏・正午・晴」)——**全專案唯一縫**。
 * 住 data.js 而不住 environment.js:它只是 `ENV` 的取名查表,而 environment.js import three
 * ⇒ 放那裡的話,任何在 Node 端(離線稽核 / 故事書的純標記模組)要印這一行的人都載不起來。
 * `environment.js` 保留舊入口 re-export(同 `hazards.js` → `rng.js` 的處理)。
 */
export function envLabel(env) {
  if (!env) return '';
  const s = ENV.seasons[env.season]?.name || '?';
  const t = ENV.times[env.time]?.name || '?';
  const w = ENV.weathers[env.weather]?.name || '?';
  return `${s}・${t}・${w}`;
}

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
