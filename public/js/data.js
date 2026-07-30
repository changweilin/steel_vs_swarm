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

  // 3) 繞 bbox 中心等比放大 MAP_EXPAND(兵線不動;取代舊 5% pad,為第三方野營留側翼合法區)
  const cLat = (minLat + maxLat) / 2, cLng = (minLng + maxLng) / 2;
  const hLat = (maxLat - minLat) / 2 * MAPGEO.MAP_EXPAND, hLng = (maxLng - minLng) / 2 * MAPGEO.MAP_EXPAND;
  return { minLat: cLat - hLat, maxLat: cLat + hLat, minLng: cLng - hLng, maxLng: cLng + hLng };
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
  // bomb 只留「彈體規格」(半徑/破甲/vs);**傷害刻意不住這裡** —— 2026-07-27 起自爆攻擊與另兩招
  // (餌機/重砲)共用機種絕招傷害預算,由 kamiBlast()/selfBoomBlast() 推導(見 SPECIAL)。
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
// 封頂效果:+25% 射程、+10% 閃避、攻擊爆率 ×0.65、攻擊爆傷加成 ×0.65、受擊爆率 ×1.7、受擊爆傷加成 +35%。
// 爆擊只作用於直擊武器(heroHit/heroLance _rollCrit);招式不吃高度差/閃避/爆擊(見 sim.heroCast → _blast)。
export const ALTITUDE = {
  TIERS: 3,             // |dh| 達「3 個砲塔高」時效果封頂(門檻在 1 個砲塔高)
  RANGE: 0.25,         // 較高方 +射程(封頂)
  DODGE: 0.10,         // 較高方 +閃避率(封頂)
  // 爆擊代價四項於 2026-07-27 整組 ×0.7 重新校準(原 0.5/0.5/1.0/0.5)——
  // 對進戰模型(`npm run bal` ⑤)量到舊值讓「較高方勝率」只有 48.3%:+25% 射程只在接近期兌現、
  // +10% 閃避只擋輕武器直射,兩者合計買不回「攻擊爆擊砍半 + 受擊爆率翻倍」的代價 ⇒ **搶高地是淨虧損**,
  // 與設計意圖(高地換視野與機動、不換爆發 ⇒ 期望勝負應為**中性**)相反。整組等比縮放保留原本的效果形狀。
  ATK_CRIT_RATE: 0.35, // 較高方攻擊時:爆率 ×(1 − 此值·s)  → 封頂 ×0.65
  ATK_CRIT_DMG: 0.35,  // 較高方攻擊時:爆傷加成 ×(1 − 此值·s)→ 封頂 ×0.65
  RCV_CRIT_RATE: 0.7,  // 較高方受擊時:爆率 ×(1 + 此值·s)  → 封頂 ×1.7
  RCV_CRIT_DMG: 0.35,  // 較高方受擊時:爆傷加成 ×(1 + 此值·s)→ 封頂 +35%
};
/** 觸發門檻/一階高度 = 一個砲塔高(公尺,實體高不吃 COMBAT_SCALE);推導不手寫 */
export const altTier = () => TARGET_H.tower;
/** 高度差強度係數 s ∈ [0,1]:|dh| 由 1 個砲塔高線性升到 TIERS 個砲塔高封頂;未達門檻 = 0(無加成) */
export const altScale = (dh) => {
  const T = altTier(), a = Math.abs(dh || 0);
  return Math.max(0, Math.min(1, (a - T) / (T * (ALTITUDE.TIERS - 1))));
};
// SQUAD:蜂群玩家 = 單架無人機(2026-07-17 起;舊制為 N 架小隊,現 N=1)。
// 生存值(HP/護盾/護甲)= 機甲平均的 HP_F(80%);傷害 = 機甲全額(DMG=1,單機不折)。
// 傷害折算仍住在 heroWeapon()(與 HEROIC 同一個縫),別在 sim/game 二次乘算。
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
  // ── 護衛自殺攻擊機(2026-07-18 重設計)──
  //  兩架 1/2 體型、外觀同主機的護衛機常駐主機兩側;觸發前不可被鎖定/受傷(純客戶端貼身外觀,不在 sim)。
  //  「狙擊模式長按右鍵」觸發:兩架同時衝出,以主機 3 倍速撲擊,各造成機種絕招預算 1/N 的重型炸彈爆風;
  //  自爆後需等滿 CD_S 秒才重新出現(客戶端以 kamiCd 判定顯隱)。敵方導引飛彈會被衝出的護衛機吸走砲火
  //  (見 sim._tickKamis / _tickMissiles)。觸發改狙擊長按右鍵(舊 F 鍵)。
  KAMI: {
    N: 2, HP_F: 1 / 3, SIZE_F: 1 / 2, SPEED_MUL: 3, CD_S: 30,
    // 傷害不再手寫折半係數:每架 = 機種絕招預算 / N(見 kamiBlast);N 架打完 = 一份完整預算。
    DEATH_F: 0.5,     // 被擊毀時原地引爆(2026-07-22 使用者需求):傷害與半徑各取正常撲擊爆風的 50%
    SPREAD: 0.55,     // 衝出時前方左右散開角(弧度,≈32°)
    FWD: 8, SIDE: 5,  // 衝出生成點:前置 / 側置偏移(公尺)
    TURN: 3.2,        // 追蹤限轉率(弧度/秒;比餌機敏捷)
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

// ---- 餌機(變形機甲專屬可分離子機;2026-07-18:非變形機甲已移除餌機,改重砲模式)----
// 觸發改「狙擊模式長按右鍵」(舊 F 鍵)。分離發射,航向鎖定發射瞬間的機首朝向 —— 玩家無法操舵。
// 準星有鎖定目標(LOCK.TTL 內)才會追蹤,否則直飛到燃料耗盡自爆。沿途投彈見下(BOMB_*)。
// 飛行中經 PiP 小視窗回傳畫面與視野;超過 LINK_M 即失聯(斷訊、不再回傳視野),
// 機體仍直飛到 TTL_S 自爆。可被擊落 —— 這就是「餌」:替主機甲吸走火力。
export const DECOY = {
  HP_F: 0.25,       // 生命值 = 主機甲裝甲上限的 1/4
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
  R: 20, PEN: 10,
  vs: { flesh: 1.4, armor: 1.3, air: 0.6, building: 1.2 },
  // 沿途投彈(2026-07-18):敵人進 BOMB_R 才開始丟,間隔 BOMB_GAP 秒、單次任務最多 BOMB_MAX 枚。
  // 單枚 = 直擊爆風(預算的非撞擊部分均分)+ 依機體類型附加狀態(見 DECOY_BOMB / MORPH_BOMB)。
  BOMB_R: 90, BOMB_MAX: 5, BOMB_GAP: 0.9, BOMB_BLAST_R: 14, BOMB_PEN: 6,
};
// ---- 餌機沿途投彈:依機體類型的效果(復用 sim 既有 bleed/slow/EMP/stun,無新狀態欄位)----
// fire/poison 走 bleed 逐體 DoT(owner 記功)、freeze 走 slow 減速、thunder 走 EMP(武器離線)+ stun 麻痺。
export const DECOY_BOMB = {
  fire:    { name: '燃燒彈', color: 0xff6a2a, dot: 22, dur: 4 },              // 灼燒 DoT
  freeze:  { name: '凍結彈', color: 0x8fd8ff, slow: 0.35, dur: 3 },          // 重減速(近凍結)
  poison:  { name: '毒霧彈', color: 0x8fe36a, dot: 15, dur: 5, slow: 0.7 },  // 毒 DoT + 微減速
  thunder: { name: '雷爆彈', color: 0xffe14f, emp: 2.0, stun: 0.6 },         // 武器離線 + 短暫麻痺
};
/** 變形機甲角色 → 餌機炸彈類型(四類各兩台,依機體/性格配置) */
export const MORPH_BOMB = {
  m01: 'thunder', m02: 'freeze', m03: 'fire',   m04: 'poison',
  m05: 'thunder', m06: 'fire',   m07: 'freeze', m08: 'poison',
};
export const morphBomb = (ch) => DECOY_BOMB[MORPH_BOMB[ch] || 'fire'];
// ---- 重砲模式(巨炮;2026-07-18;非變形機甲專屬:狙擊模式長按右鍵)----
// 0.5 秒內傾洩重武器剩餘彈夾(DUR 窗解除射速閘與電力門檻),傷害 ×barrageDmgF()、射程 ×RANGE_F;
// 獨立於彈夾裝填的 30s 冷卻。伺服器以 h.barrageUntil 窗結算加成(見 sim.heroBarrage / _heroDmg / heroHit)。
// 每發傷害倍率 2026-07-27 起**不再是固定 ×2**:改由機種絕招傷害預算 ÷ 整夾爆發推導(見 barrageDmgF)——
// 整夾傾洩完 = 追加一份與自爆攻擊/轟炸餌機同額的預算,單發爆發低的重武器倍率自然較高(三招因此等值);
// 夾在 [DMG_MIN, DMG_MAX] 之間(32 把重武器整夾爆發差距約 2 倍,不夾會讓極端武器倍率失控)。
// DMG_GRACE(2026-07-25 使用者回報「巨炮沒有傷害」修正):傾洩窗 DUR 是「多快能把彈夾打完」,
//   但榴彈/火箭/飛彈是**拋射彈**,離膛後要飛一段才落點回報 heroBurst/heroLance —— 舊制傷害加成/射速閘/
//   射程驗證全在**落點時刻**以 barrageUntil(DUR 窗)判定,彈體落地時窗早已過期 ⇒ ①2× 加成掉回原傷、
//   ②射速閘重新生效讓同一輪傾洩的第 2 發起被擋(實測:一輪 3 發榴彈只有 1 發、且只造成原傷)。修正 =
//   傷害/射速/電力/射程的加成窗延長 DMG_GRACE 秒涵蓋彈體飛行時間(_barragingDmg;彈夾此時已空且裝填中,
//   不會有非傾洩的重武器射擊誤吃加成)。DUR 仍只管客戶端傾洩節奏,MUST NOT 用它判落點加成。
export const BARRAGE = { DUR: 0.5, DMG_MIN: 1.5, DMG_MAX: 3.0, RANGE_F: 1.20, CD_S: 30, DMG_GRACE: 3.5 };

// ---- 機種絕招傷害(2026-07-27 使用者需求;三招共用同一份傷害預算 = 唯一縫)----
// 三招 = 無人機「自爆攻擊」(護衛自殺機 / 主機自毀撞擊)、變形機甲「轟炸餌機」、非變形機甲「重砲模式」;
// 三者共用同一顆鍵(長按右鍵 / 觸控 ZR,見 game.js _fireHoldAbility)與同一段 30s CD,威力理應等值。
// 舊制三招各自為政:自爆吃輕武器階(240→420)、餌機固定值(260 + 5×34,完全不隨升級成長)、
// 重砲固定 ×2(實得加成 = 整夾爆發,隨重武器階 ~265→~730)⇒ 同一格絕招的期望傷害差到三倍。
// 新制:一次絕招的**總傷害預算** = BASE ×(1 + PER_LVL ×(綜合等級 − 1)),
//   綜合等級 = (輕武器階 + 重武器階) / 2 —— 絕招是機體整套武裝的爆發,兩條武器軌都算數,
//   故等級可為 x.5 的**分數階** ⇒ MUST NOT 丟進 tierVal(三階數組只吃整數階,分數會回傳 undefined)。
// 三招各自把同一份預算切給自己的投射數:
//   自爆 = KAMI.N 架均分(主機自毀撞擊 = 一架機體吃整份);
//   餌機 = 撞擊自爆 DECOY_IMPACT,其餘均分給 DECOY.BOMB_MAX 枚沿途投彈;
//   重砲 = 整夾傾洩的**追加**傷害(每發倍率 = 1 + 預算 ÷ 整夾爆發,夾在 BARRAGE.DMG_MIN~MAX)。
// BASE 300 ≈ 舊制三者的中位(自爆 240 / 餌機 430 / 重砲加成 ~265),PER_LVL 0.45 ⇒ 綜合 Lv4 = ×2.35
// (對齊重武器整夾爆發 Lv1→Lv4 的成長)。**MUST NOT** 在 sim/game/HUD 另寫任一招的傷害常數。
export const SPECIAL = {
  BASE: 300,          // 綜合 Lv1 一次絕招的總傷害預算(三招同額)
  PER_LVL: 0.45,      // 每 +1 綜合等級的線性成長(綜合 Lv4 = ×2.35)
  DECOY_IMPACT: 0.6,  // 餌機:撞擊自爆佔預算的比例(其餘均分給沿途投彈)
};
/** 輕/重武器綜合等級(= 兩軌平均,可為 x.5 分數階;缺值以 Lv1 計) */
export const specialTier = (abil) => ((abil?.light || 1) + (abil?.heavy || 1)) / 2;
/** 綜合等級成長倍率(線性) */
export const specialMul = (abil) => 1 + SPECIAL.PER_LVL * (specialTier(abil) - 1);
/** 一次機種絕招的總傷害預算 */
export const specialBudget = (abil) => SPECIAL.BASE * specialMul(abil);
/** 自爆攻擊:單架護衛自殺機的爆風(N 架均分預算;半徑/破甲/vs 沿用重型炸彈規格) */
export const kamiBlast = (abil) => ({ ...WEAPONS.bomb, dmg: Math.round(specialBudget(abil) / SQUAD.KAMI.N) });
/** 自爆攻擊:主機自毀撞擊引爆(單一機體 = 整份預算) */
export const selfBoomBlast = (abil) => ({ ...WEAPONS.bomb, dmg: Math.round(specialBudget(abil)) });
/** 轟炸餌機:撞擊自爆的爆風 */
export const decoyBlast = (abil) => ({
  dmg: Math.round(specialBudget(abil) * SPECIAL.DECOY_IMPACT), r: DECOY.R, pen: DECOY.PEN, vs: DECOY.vs,
});
/** 轟炸餌機:沿途投彈單枚的爆風(預算的非撞擊部分均分 BOMB_MAX 枚) */
export const decoyBombBlast = (abil) => ({
  dmg: Math.round(specialBudget(abil) * (1 - SPECIAL.DECOY_IMPACT) / DECOY.BOMB_MAX),
  r: DECOY.BOMB_BLAST_R, pen: DECOY.BOMB_PEN, vs: DECOY.vs,
});
/** 重砲模式:每發傷害倍率 —— 整夾(mag 發)傾洩完 ≈ 追加一份預算;夾在 [DMG_MIN, DMG_MAX] */
export const barrageDmgF = (def, abil) => {
  const burst = (def?.dmg || 0) * (def?.mag || 1);
  if (!(burst > 0)) return BARRAGE.DMG_MIN;
  return Math.min(BARRAGE.DMG_MAX, Math.max(BARRAGE.DMG_MIN, 1 + specialBudget(abil) / burst));
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
// 對空彈射模式(2026-07-23 使用者需求):launcher 準星錐(AA_CONE 弧度)內掃到飛行類目標
// (TARGET_CLASS 'air':無人機/直升機/餌機)即改用高初速 AA_MV —— 拋物線吊射打不到會動的飛行單位,
// 高速平直彈道才有火控意義(射程/傷害不變,只換初速 ⇒ 純客戶端彈道,伺服器仍只驗落點)。
// AA_MV 720(原 340;使用者「再更快更直」):實際初速取 min(武器真實 mv, AA_MV) ——
// 彈射模式 = **全裝藥直射**,砲彈跑該武器的真實初速(152mm 650 / 無後座砲 435 / 集束彈 400),
// 只有真實初速本就慢的溫壓火箭(120)維持慢速。MUST NOT 改成無視 mv 的固定值(超過真實初速)。
// AA_ALT:他人視覺彈體(_spawnVisShell)無法得知對方準星,改以「落點離地高度」推定對空射擊。
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
  G: 9.81, LAUNCH_MV: 100, AA_MV: 720, AA_CONE: 0.14, AA_ALT: 10,
  LOB_TOL: 3.5, LOB_SUP_MAX: 0.70, LOB_CHARGE: [1, 0.78, 0.6, 0.46], LOB_MIN_F: 1.5,
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
/** 爆風超壓衰減:核心(≤0.5r)全傷,外圍隨距離急降、1.8r 歸零(取代舊二段式 1/0.4) */
export function blastFalloff(r, d) {
  if (d <= r * 0.5) return 1;
  if (d >= r * 1.8) return 0;
  return ((r * 1.8 - d) / (r * 1.3)) ** 0.75;
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
// BARRAGE_F:重砲模式(傾洩窗)的圓柱加粗係數。**原本只存在於演出端**(game.js _lanceVisual
//   畫 1.5 倍粗),伺服器仍用原半徑結算 ⇒ 巨炮開下去「看到的比打到的粗 50%」,正是使用者回報的
//   「打不到單位」之一。收進本縫後兩端同步(A18「看到多粗就是打到多粗」)。
export const LANCE = {
  R: { beam: 5.4, rail: 4.2, gun: 3.3 },
  DECAY: 0.75,
  MAX: 6,
  VBAND_F: 2.2,     // 垂直帶寬容 = R × 此值(伺服器無地形高程,射線高度只能近似 —— 見 sim.heroLance)
  BARRAGE_F: 1.5,   // 重砲模式加粗(與 BARRAGE.RANGE_F 同層:傾洩窗的火力展開)
};
/** 貫穿圓柱半徑(公尺);barrage = 重砲傾洩窗 ⇒ 判定與演出**同時**加粗 */
export const lanceR = (def, barrage = false) =>
  (LANCE.R[def?.type] ?? LANCE.R.gun) * (barrage ? LANCE.BARRAGE_F : 1);

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

// ---- 榴彈類最小安全射程(2026-07-27 使用者需求;伺服器與客戶端 HUD 共用同一縫)----
// 只約束 trajClass 'lob'(launcher 無導引:溫壓火箭 / 152 榴彈砲 / 無後座砲 / 集束子母彈)——
// 這正是「榴彈類」。導引/射後不理是自導武器(已有 ARMING 軌跡修正期散布),不在此列。
// 落點與射手的距離 < lobMinRange(def) ⇒ 伺服器 _blast 改「無差別」(不分敵我 + 波及自身),
// 自損量由既有 blastFalloff(def.r, 距離)自然導出(越貼近爆心自損越重);≥ 此距離則照常只傷敵。
// **推導不手寫**:= 爆風半徑 def.r × BALLISTIC.LOB_MIN_F(改係數自動跟著走);非 lob 回 0。
export const lobMinRange = (def) => (def && trajClass(def) === 'lob' ? (def.r || 0) * BALLISTIC.LOB_MIN_F : 0);

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
    high: { move: 'stop', climb: 0.044, kick: 4.5, slowF: 0,   back: 0, burst: 0, settle: 0, steady: 0 },   // steady 0(2026-07-18):重武器改彈夾連發,取消開火前停穩蓄力
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

// ---- 鏡頭震動 trauma(2026-07-23:發射感 + 震波作用範圍)----
// 純客戶端手感(同 RECOIL,伺服器不涉入)⇒ bal/e2e 不受影響。
// trauma 每秒衰減 1.4、以平方驅動噪聲(game.js _updatePlayer),故連發會自然疊成持續轟鳴。
//   FIRE       每發開火的基礎震動(再乘 RECOIL.kick 分級倍率)
//   HEAVY_F    重武器槽的額外倍率:重砲擊發要有頓挫感,輕武器維持原本的細碎抖動
//   BARRAGE_F  巨炮傾洩窗內每發再乘的倍率
//   KAMI / DECOY / BARRAGE  三種狙擊長按機種招(自殺機 / 餌機 / 重砲)的發射震動
//   BLAST_F    爆炸震波(鏡頭震動 + 掀飛推力)的作用半徑 = 該武器攻擊半徑 × 此值。
//              MUST NOT 改回「固定下限 + 倍數放大」—— 使用者指示震波不可無限遠傳遞,
//              震波範圍就是該武器的攻擊範圍(爆點核心的推力/震動強度不變,只是邊界收到 r)。
export const SHAKE = {
  FIRE: 0.03, HEAVY_F: 3.0, BARRAGE_F: 1.3,   // 重武器單發 0.22~0.41(依 kick 2.4~4.5);傾洩窗連發疊到上限 = 巨炮轟鳴
  KAMI: 0.6, DECOY: 0.5, BARRAGE: 0.55,
  BLAST_F: 1,
};

// 榴彈 / 火箭(launcher)對建築的額外傷害加成(使用者指示「榴彈類武器對建築物傷害強化」)。
// 疊在武器自身 vs.building 之上,只在 launcher 型命中建築(塔/主堡/障礙)時生效 ——
// 攻城武器拆建築更快,但對兵員/裝甲/空中目標不變。套用點唯一:sim._heroDmg()。
export const GRENADE = { BUILDING_MUL: 1.4 };
export const grenadeBuildingMul = (def, kind) =>
  def && def.type === 'launcher' && TARGET_CLASS[kind] === 'building' ? GRENADE.BUILDING_MUL : 1;

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

// ---- 障礙物視線遮蔽(2026-07-15;伺服器 sim._losBlocked / 客戶端彈道共用參數)----
// 建物/神木/巨岩等實體障礙擋砲火與視線:塔/NPC/玩家都不能透視。
// EYE_M/TGT_M:射手眼高 / 目標身高取樣(地面單位);TOWER_EYE_M:塔的砲位高(塔身 26m,砲位過半);
// THRU_M:穿越障礙圓柱的弦長門檻(< 門檻 = 貼牆擦邊,不算遮蔽);MAX_OCC:上傳障礙數上限。
// MAX_SLAB:上傳橋面/隧道天花薄板段數上限(#1;橋面 deck 段可達數千,取足量)。
// TUN_CLEAR_M:隧道路面→天花淨空(遊戲公尺)。單一縫:biomes.js 建洞(TUN.CLEAR)與
// sim.js 飛行體所在層推定(_unitLev:飛行高度 ≥ 淨空 ⇒ 必在山體上方,非洞內)共用。
export const LOS = { EYE_M: 2.0, TGT_M: 1.0, TOWER_EYE_M: 14, THRU_M: 3, MAX_OCC: 4000, CELL_M: 64, MAX_SLAB: 6000, TUN_CLEAR_M: 8 };

// ================= 機體實體高度 / 命中量體(2026-07-10 尺度基準;2026-07-23 移入本檔)=================
// 步兵 = 真人身高 SOLDIER_H,是全遊戲唯一的「身高單位」。人員/載具/建物一律用真實世界
// 公稱尺寸,不再有超尺度倍率(舊制步兵 3.2m,建物/植被便得靠 biomes.js OVER ×1.8 補回比例)。
// **住在 data.js 的理由**:這組值同時是「渲染縮放」(models.js fitToHeight)與「伺服器命中量體」
// (sim._blast/_lanceHits 的垂直帶 —— 打到機體哪個部位就在那裡結算)。兩端 MUST 共用同一把尺,
// 各寫一份 = 看得到卻打不到。models.js 只做 re-export,呼叫端不動。
export const SOLDIER_H = 1.8;

// 機體尺寸(2026-07-12 改制,相對真人身高):
//   機甲 / 變形機甲(不分型態)= 150%~250%、無人機 = 75%~150%。
// 倍率仍隨 mods.armor 在該機種護甲區間內線性內插:
// 高防禦 = 更巨大 = 剪影更大 = 更容易被命中(命中是客戶端對 mesh raycast,體型直接生效)。
export const HERO_SIZE = {
  robot: { armor: [12, 26], mul: [1.5, 2.5] },
  morph: { armor: [5, 24], mul: [1.5, 2.5] },
  drone: { armor: [3, 12], mul: [0.75, 1.5] },
};
const BEAST_H_F = 0.78;   // 獸型四足:同噸位的站姿較矮(體長換來的)—— 但不得跌破機種下限
// 變形機甲的人形地面型(vis.ground):其餘值一律四足獸型
export const MORPH_HUMANOID = new Set(['biped', 'wolf', 'vampire', 'monkey', 'atlas']);

/** 英雄機體顯示高度(公尺):依角色護甲值在機種區間內插 */
export function heroTargetH(kind, ch) {
  const S = HERO_SIZE[kind];
  if (!S) return SOLDIER_H * 4;
  const c = CHARACTERS[ch];
  const armor = c?.mods?.armor;
  const t = armor == null ? 0.5 : Math.max(0, Math.min(1, (armor - S.armor[0]) / (S.armor[1] - S.armor[0])));
  const h = SOLDIER_H * (S.mul[0] + (S.mul[1] - S.mul[0]) * t);
  // 獸型矮化:機甲看 visual.form;變形機甲看 visual.ground(非人形即四足獸,體長換高度)。
  // 矮化後 MUST 夾回機種區間下限 —— 機甲/變形機甲不分型態都要 ≥ 150% 真人身高。
  const quad = c?.visual?.form === 'beast'
    || (c?.visual?.ground && !MORPH_HUMANOID.has(c.visual.ground));
  return quad ? Math.max(SOLDIER_H * S.mul[0], h * BEAST_H_F) : h;
}

// 非英雄單位顯示高度(公尺;models.js fitToHeight 自動縮放)。人員/載具 = 真實世界尺寸;
// 塔/主堡是虛構工事,維持既有的地標級量體。
export const TARGET_H = {
  // decoy:fitToHeight 量的是「高度」— 餌機高 ≈ 0.99 / 長 ≈ 2.2,取 1.4 得機身長約 3.1m
  decoy: 1.4,
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

// ---- 擊殺分數(kn:純供 HUD 統計,2026-07-20 起不再作升級門檻)----
// 擊殺數 kn:小兵 1、坦克/直升機 2、塔 3、英雄 4。升級全改「金錢階梯單價」(隨等級遞增,見 ECON.UPGRADES / upgradePrice)。
export const KILL_SCORE = { drone: 4, robot: 4, morph: 4, tower: 3, tank: 2, heli: 2, bunker: 2 };
// 電腦玩家(bot;含駕駛傭兵變形機甲的 bot)只算 3 分 — 刷 bot 解招式比打真人便宜,但沒那麼便宜。
export const BOT_KILL_SCORE = 3;
export const killScore = (kind) => KILL_SCORE[kind] ?? 1;

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
    dmg: t(w.dmg) * (heroic ? HEROIC.dmg : 1) * squad,
    // w.range 已於下方統一縮放塊 ×COMBAT_SCALE(source 縮 reach);rangeCap 隨 UNITS.sight 同步縮 ⇒ 相對關係不變
    range: heroic ? Math.min(w.range * HEROIC.range, rangeCap(kind, slot)) : w.range,
    rate: t(w.rate ?? 3),   // rate 也可三階(s05 旋轉機砲);漏過 tierVal 會把陣列外洩給 UI/射速限制
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
    range: t(a.range ?? 0) * COMBAT_SCALE, imp: t(a.imp ?? 0), scatter: t(a.scatter ?? 0),   // range 縮 reach;imp/scatter/r 為效果尺寸不縮
    unit: a.unit, target: a.target || 'self', sp: !!a.sp, vision: t(a.vision ?? 0) * COMBAT_SCALE,
    mul: a.mul ? Object.fromEntries(Object.entries(a.mul).map(([k, v]) => [k, t(v)])) : null,
    vs: a.vs || {},
    pen: t(a.pen ?? 0),
    // 追加效果(2026-07-16):{fx:'pull|stun|slow|confuse|haste|leap|dodge|vamp|bleed|mark', 數值欄逐一過 tierVal}
    add: a.add ? Object.fromEntries(Object.entries(a.add).map(([k, v]) =>
      [k, typeof v === 'string' ? v : t(v)])) : null,
  };
}

/** 角色機體種類(不需要 side:傭兵自帶 kind,陣營角色由 side 決定)— heroWeapon 的折算依據 */
export const charKind = (ch) =>
  CHARACTERS[ch]?.kind || (CHARACTERS[ch]?.side === 'SWARM' ? 'drone' : 'robot');

/** 角色實戰護甲值:無人機等比縮放到「機甲平均 armor ×SQUAD.HP_F」(SQUAD.ARMOR_F,UNITS 後 derive);
 *  其餘機種照 mods.armor。套用點:sim._add 生成 + buy('ar') 升級,兩處共用此縫(客戶端體型仍讀原 mods.armor)。 */
export const heroArmor = (ch) => {
  const a = CHARACTERS[ch]?.mods?.armor ?? 0;
  return charKind(ch) === 'drone' ? a * SQUAD.ARMOR_F : a;
};

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
    side: 'SWARM', name: '卡特琳娜・薛甫琴科', code: '蜂后', machine: '「第聶伯總譜」指揮型六旋翼',
    visual: { hue: 0xffd257, frame: 'hexa', body: 'box', form: 'avian', creature: 'bee', paint: 'natflag', flag: [0xffd700, 0x0057b7] },
    mods: { hp: 1.0, sp: 1.15, mp: 1.15, speed: 0.95, armor: 6 },
    light: { name: '雙聯 5.56 機槍艙', rw: 'FN Minimi・初速 915m/s', type: 'gun', mv: 915,
      dmg: [12, 15, 18], rate: 10, mag: [40, 50, 60], reload: 2.0, range: 190, crit: 0.06,
      vs: { flesh: 1.2, armor: 0.6, air: 1.3, building: 0.5 } },
    heavy: { name: '70mm 導引火箭巢', rw: 'Hydra 70 + APKWS 雷射導引・初速 700m/s', type: 'launcher', mv: 700, guide: 1,
      dmg: [52, 80, 116], r: [12, 14, 16], mag: 3, reload: 12, range: 300, pen: 6,
      vs: { flesh: 1.1, armor: 1.4, air: 0.5, building: 1.2 } },
    skill: { name: '蜂群協奏', fx: 'buff', target: 'team', r: 180, mul: { dmg: [1.15, 1.23, 1.3] },
      add: { fx: 'vamp', f: [0.1, 0.13, 0.16] },
      dur: [6, 8, 10], cd: 20, mp: [35, 40, 45], desc: '指揮頻道開啟:友軍火力提升,蜂群回收戰果(吸血)' },
    ult: { name: '總譜:終樂章', fx: 'summon', unit: 'heli', count: [2, 3, 4],
      cd: [80, 70, 60], mp: [80, 90, 100], desc: '呼叫攻擊直升機編隊沿最近兵線壓上' },
  },
  s02: {
    side: 'SWARM', name: '塔拉斯・邦達爾', code: '鐵匠', machine: '「鐵匠鋪」重載運翼機',
    visual: { hue: 0xc98a3d, frame: 'hexa', body: 'slab', paint: 'minimal' },
    mods: { hp: 1.2, sp: 0.9, mp: 0.9, speed: 0.85, armor: 12 },
    light: { name: '12.7 重機艙', rw: 'DShK・初速 850m/s', type: 'gun', mv: 850,
      // crit 0 = 類型基準(重機槍低暴擊);2026-07-25 起 heroWeapon() 夾 CRIT_MIN 5% ⇒ 實戰 ≥5%。
      // e2e 的 s02/t01 確定性傷害斷言改用 Math.random 樁固定不觸發暴擊(不再依賴 crit:0)。
      dmg: [17, 21, 26], rate: 5, mag: [30, 36, 42], reload: 2.4, range: 200, crit: 0, pen: 6,
      vs: { flesh: 1.2, armor: 1.1, air: 0.9, building: 0.7 } },
    // range 275(2026-07-14):解析後 = min(275×1.2, cap) = 330m —— 全機種「最短的重武器」,
    // 剛好越過砲塔射程 310m 約 20m(使用者指示:重武器可在砲塔射程外拆塔,最短者僅稍遠一點點)。
    // 電漿扇形重武器(180~210m)是刻意的近戰例外,不在此列。
    heavy: { name: '溫壓火箭', rw: 'TBG-7V・初速 120m/s', type: 'launcher', mv: 120,
      dmg: [60, 88, 126], r: [15, 17, 19], mag: 3, reload: 12, range: 275, pen: 15,
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
      dmg: [21, 31, 44], mag: 5, reload: 8, range: 280, emp: [0.8, 1.0, 1.2],
      vs: { flesh: 0.7, armor: 0.8, air: 2.0, building: 0.4 } },
    skill: { name: '定向干擾', fx: 'emp', r: 120, dur: [2.5, 3, 3.5], range: 260,
      cd: [18, 16, 14], mp: [40, 45, 50], desc: '指定區域敵軍武器離線(建築免疫)' },
    ult: { name: '全頻壓制', fx: 'emp', r: 260, dur: [4, 5, 6],
      cd: [70, 62, 54], mp: [90, 100, 110], desc: '以自身為中心的大範圍電子壓制' },
  },
  s04: {
    side: 'SWARM', name: '樫村蒼真', code: 'Kashi', machine: '「鐵鍬」零式突擊翼',
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
    side: 'SWARM', name: '河瑟琪', code: 'Overclock', machine: '「超頻」競速 FPV',
    visual: { hue: 0xff6fb0, frame: 'quad', body: 'wedge', paint: 'minimal' },
    mods: { hp: 0.85, sp: 1.1, mp: 1.1, speed: 1.2, armor: 3 },
    light: { name: '微型軌道轉輪砲', rw: '實驗性線性感應馬達・初速 1400m/s', type: 'rail', mv: 1400,
      dmg: [9, 11, 14], rate: [14, 16, 18], mag: [70, 90, 110], reload: 2.8, range: 180, crit: 0.05,
      vs: { flesh: 1.2, armor: 0.6, air: 1.4, building: 0.4 } },
    heavy: { name: '巡飛彈釋放器', rw: 'Lancet 縮裝・巡飛 90m/s', type: 'missile', mv: 90,
      dmg: [48, 69, 96], r: [13, 15, 17], mag: 4, reload: 11, range: 320, pen: 12,
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
    side: 'SWARM', name: '瑪雅・柯爾曼', code: '悼歌', machine: '「輓歌」攔截者',
    visual: { hue: 0xb9c7ff, frame: 'coax', body: 'sphere', form: 'avian', creature: 'ptero', paint: 'minimal' },
    mods: { hp: 1.0, sp: 1.2, mp: 1.1, speed: 1.0, armor: 6 },
    light: { name: '精準軌道步槍艙', rw: '實驗性磁軌步槍・初速 1600m/s', type: 'rail', mv: 1600,
      dmg: [24, 30, 37], rate: 3, mag: [15, 18, 21], reload: 2.2, range: 230, crit: 0.15, critX: 1.8,
      vs: { flesh: 1.2, armor: 0.8, air: 1.5, building: 0.5 } },
    heavy: { name: '微型攔截彈', rw: 'AIM-9X 縮裝・初速 1000m/s', type: 'missile', mv: 1000,
      dmg: [38, 58, 87], r: [6, 7, 8], mag: 4, reload: 11, range: 340, pen: 6,
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
      dmg: [33, 51, 75], mag: 3, reload: 7, range: 264, pen: 4,
      vs: { flesh: 0.9, armor: 0.6, air: 2.0, building: 0.4 } },
    skill: { name: '分配演算法', fx: 'intercept', r: [170, 210, 250],
      cd: [15, 13, 11], mp: [30, 35, 40], desc: '一道證明完畢:清空半徑內來襲飛彈' },
    ult: { name: '飽和反擊', fx: 'strike', count: [5, 7, 9], dmg: [68, 85, 106], r: 11, scatter: 35,
      add: { fx: 'slow', f: 0.6, dur: [2, 2.5, 3] },
      range: 340, pen: 6, cd: [72, 64, 56], mp: [85, 95, 105], vs: { air: 1.5, armor: 1.1 },
      desc: '攔截網反向齊射:破片撕裂操縱面(緩速)' },
  },
  s08: {
    side: 'SWARM', name: '佐菲亞・馬列克', code: '聖燭', machine: '「聖燭」醫療運補機',
    visual: { hue: 0xe8f0f4, frame: 'coax', body: 'sphere', paint: 'flag' },
    mods: { hp: 1.0, sp: 1.15, mp: 1.25, speed: 1.0, armor: 5 },
    light: { name: '護航機槍艙', rw: 'PKM 7.62・初速 825m/s', type: 'gun', mv: 825,
      dmg: [15, 19, 23], rate: 7, mag: [36, 44, 52], reload: 2.1, range: 190, crit: 0.06,
      vs: { flesh: 1.3, armor: 0.7, air: 1.1, building: 0.5 } },
    heavy: { name: '同步軌道狙擊砲', rw: '實驗性電磁狙擊系統・初速 2200m/s', type: 'rail', mv: 2200,
      dmg: [77, 116, 175], mag: 2, reload: 8, range: 360, crit: 0.25, critX: 2.0, pen: [16, 20, 24],
      vs: { flesh: 1.4, armor: 0.8, air: 1.4, building: 0.4 } },
    skill: { name: '血漿空投', fx: 'heal', target: 'team', r: 140, heal: [150, 210, 270],
      cd: [20, 18, 16], mp: [40, 45, 50], desc: '空中血庫開倉:半徑內友軍裝甲回復' },
    ult: { name: '修道院鐘聲', fx: 'heal', target: 'team', r: 240, heal: [280, 380, 480], sp: true,
      cd: [85, 75, 65], mp: [90, 100, 110], desc: '大範圍野戰醫療:裝甲大量回復、護盾充滿' },
  },
  s09: {
    side: 'SWARM', name: '艾德蒙・惠特洛克', code: '獵場主', machine: '「獵場看守人」雙管獵鷹',
    visual: { hue: 0xd0602f, frame: 'coax', body: 'box', form: 'avian', creature: 'eagle', paint: 'split', split: 'shade' },  // 鏽橙同色系:反蔭(含翅膀)—— 面朝上=背深、面朝下=腹淺
    mods: { hp: 1.05, sp: 1.0, mp: 1.0, speed: 1.0, armor: 8 },
    light: { name: '雙管防空霰彈', rw: 'Purdey 12 鉛徑改・初速 420m/s', type: 'gun', mv: 420, fan: true, arc: [18, 16, 14],
      dmg: [30, 38, 47], rate: 2.6, mag: [8, 10, 12], reload: 2.4, range: 170, crit: 0.10, critX: 1.5,
      vs: { flesh: 1.3, armor: 0.4, air: 2.0, building: 0.3 } },
    heavy: { name: '獵狐飛彈', rw: 'Starstreak 縮裝・雷射波束導引・初速 300m/s', type: 'launcher', mv: 300, guide: 1,
      dmg: [68, 100, 147], r: [13, 15, 17], mag: 3, reload: 12, range: 320, pen: 10,
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
    side: 'SWARM', name: '卡佳・塔姆', code: '白噪音', machine: '「靜電」訊號機',
    visual: { hue: 0xd7b8ff, frame: 'wing', body: 'frame', form: 'fixed', wing: 'twinboom', paint: 'minimal' },
    mods: { hp: 0.9, sp: 1.2, mp: 1.3, speed: 1.05, armor: 3 },
    light: { name: '低功率脈衝雷射槍艙', rw: '抑制型雷射訊號步槍・光速直擊', type: 'beam',
      dmg: [14, 17, 21], rate: 9, mag: [30, 36, 42], reload: 1.8, range: 170, crit: 0.08,
      vs: { flesh: 1.4, armor: 0.5, air: 1.1, building: 0.4 } },
    heavy: { name: '訊號矛', rw: 'EMP 狙擊彈・初速 900m/s', type: 'gun', mv: 900,
      dmg: [36, 55, 81], mag: 3, reload: 9, range: 340, emp: [1.5, 2, 2.5],
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
      dmg: [17, 21, 25], rate: 3.5, mag: [20, 24, 28], reload: 2.1, range: 220, crit: 0.12, critX: 1.8, pen: 6,
      vs: { flesh: 1.1, armor: 1.3, air: 1.0, building: 0.6 } },
    heavy: { name: '關節破壞者', rw: '實驗性 EM 磁軌・初速 2000m/s', type: 'rail', mv: 2000,
      dmg: [61, 88, 126], mag: 2, reload: 8, range: 380, crit: 0.15, critX: 2.0, pen: [25, 30, 35],
      vs: { flesh: 0.8, armor: 2.2, air: 1.2, building: 0.7 } },
    skill: { name: '弱點解析', fx: 'buff', target: 'self', mul: { dmg: [1.3, 1.4, 1.5] },
      add: { fx: 'mark', dur: [4, 5, 6] },
      dur: [5, 6, 7], cd: [18, 16, 14], mp: [35, 40, 45], desc: '我造了那個膝蓋:下一擊必中必爆' },
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
      dmg: [34, 52, 78], mag: 5, reload: 8, range: 320, pen: [10, 13, 16],
      vs: { flesh: 0.8, armor: 1.1, air: 0.5, building: 1.2 } },
    skill: { name: '薰衣草斗篷', fx: 'stealth', dur: [4, 5, 6],
      cd: [20, 18, 16], mp: [35, 40, 45], desc: '從敵方感測網上消失(開火即現形)' },
    ult: { name: '滿天星座', fx: 'vision', vision: [10, 13, 16],
      cd: [70, 62, 54], mp: [80, 90, 100], desc: '衛星會被打下來,星星不會:全隊長時間無霧' },
  },

  // ================= 鋼鐵陣營(機甲)=================
  t01: {
    side: 'STEEL', name: '瓦列里・格羅莫夫', code: '冬將軍', machine: '「莫洛茲」指揮型重機甲',
    visual: { hue: 0xd6e4ef, pod: 'none', proto: 'bastion', paint: 'natflag', flag: [0xffffff, 0x0039a6, 0xd52b1e] },
    mods: { hp: 1.15, sp: 1.0, mp: 1.1, speed: 0.9, armor: 22 },
    light: { name: '12.7 同軸重機槍', rw: 'Kord・初速 860m/s', type: 'gun', mv: 860,
      dmg: [22, 27, 33], rate: 4.5, mag: [40, 48, 56], reload: 2.4, range: 200, pen: 4,
      vs: { flesh: 1.3, armor: 1.0, air: 0.8, building: 0.6 } },
    heavy: { name: '152mm 榴彈砲', rw: '2A65 縮裝・初速 650m/s', type: 'launcher', mv: 650,
      dmg: [75, 111, 156], r: [16, 18, 20], mag: 3, reload: 12, range: 340, pen: 14,
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
    side: 'STEEL', name: '薇拉・佐洛塔列娃', code: '編號七', machine: '「加拉泰亞-7」神經同步機',
    visual: { hue: 0xcfd8ff, pod: 'none', proto: 'seraph', paint: 'minimal' },
    mods: { hp: 0.9, sp: 1.3, mp: 1.2, speed: 1.15, armor: 14 },
    light: { name: '高斯衝鋒槍', rw: '實驗性 EM 線圈・初速 1100m/s', type: 'rail', mv: 1100,
      dmg: [14, 18, 21], rate: 8, mag: [32, 40, 48], reload: 1.9, range: 200, crit: 0.08,
      vs: { flesh: 1.2, armor: 0.9, air: 1.1, building: 0.5 } },
    heavy: { name: '同步狙擊砲', rw: 'EM 加速穿甲彈・初速 1500m/s', type: 'rail', mv: 1500,
      dmg: [72, 107, 156], mag: 2, reload: 8, range: 360, crit: 0.15, critX: 2.0, pen: [18, 22, 26],
      vs: { flesh: 1.0, armor: 1.8, air: 1.2, building: 0.6 } },
    skill: { name: '相位突進', fx: 'dash', imp: [26, 32, 38],
      cd: [12, 10, 8], mp: [25, 30, 35], desc: '同步率暴走:機體瞬間位移' },
    ult: { name: '同步率 100%', fx: 'buff', target: 'self',
      mul: { dmg: [1.3, 1.4, 1.5], dmgTaken: [0.75, 0.7, 0.65], reload: [0.75, 0.7, 0.65] },
      add: { fx: 'dodge' },
      dur: [8, 10, 12], cd: [80, 70, 60], mp: [85, 95, 105], desc: '再沒有介面延遲:直射攻擊完美迴避' },
  },
  t03: {
    side: 'STEEL', name: '阿爾喬姆・薩維利耶夫', code: '大鍋', machine: '「大鍋」突擊機甲',
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
    side: 'STEEL', name: '娜傑日達・奧爾洛娃', code: '灰雁', machine: '「灰雁」獵殺型',
    visual: { hue: 0x8a97a5, pod: 'rack', form: 'beast', creature: 'hound', paint: 'camo' },
    mods: { hp: 0.95, sp: 1.1, mp: 1.1, speed: 1.1, armor: 16 },
    light: { name: '消音 DMR', rw: 'VSS Vintorez 9×39・初速 295m/s', type: 'gun', mv: 295,
      dmg: [21, 27, 33], rate: 3.2, mag: [20, 24, 28], reload: 2.0, range: 210, crit: 0.15, critX: 1.8,
      vs: { flesh: 1.4, armor: 0.8, air: 1.0, building: 0.5 } },
    heavy: { name: '14.5 反器材砲', rw: 'KPV・初速 1000m/s', type: 'gun', mv: 1000,
      dmg: [57, 84, 118], mag: 3, reload: 9, range: 380, crit: 0.20, critX: 2.0, pen: [20, 25, 30],
      vs: { flesh: 1.2, armor: 2.0, air: 1.5, building: 0.6 } },
    skill: { name: '灰色迷彩', fx: 'stealth', dur: [4, 5, 6],
      cd: [20, 18, 16], mp: [35, 40, 45], desc: '從所有感測器上消失(開火即現形)' },
    ult: { name: '獵殺名單', fx: 'buff', target: 'self', mul: { dmg: [1.25, 1.35, 1.45] }, vision: [8, 10, 12],
      add: { fx: 'mark', dur: [5, 6, 7] },
      dur: [8, 10, 12], cd: [75, 65, 55], mp: [85, 95, 105], desc: '名單下一行:全圖視野,下一擊必中必爆' },
  },
  t05: {
    side: 'STEEL', name: '沈鶴鳴', code: '鶴', machine: '「仿生鶴」原型機',
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
    side: 'STEEL', name: '陸小川', code: '小川', machine: '「輕功」高機動機甲',
    visual: { hue: 0xffb84d, pod: 'none', form: 'biped', creature: 'roo', paint: 'minimal' },
    mods: { hp: 0.95, sp: 1.05, mp: 1.0, speed: 1.2, armor: 14 },
    light: { name: '5.8 突擊步槍', rw: 'QBZ-191・初速 930m/s', type: 'gun', mv: 930,
      dmg: [13, 16, 20], rate: 9, mag: [34, 42, 50], reload: 1.8, range: 190, crit: 0.08,
      vs: { flesh: 1.3, armor: 0.7, air: 1.0, building: 0.5 } },
    heavy: { name: '熔核直拳砲', rw: '磁化電漿聚爆・貼身直擊', type: 'plasma', arc: [10, 12, 14],
      dmg: [55, 85, 132], mag: 3, reload: 7, range: 264, pen: 10,
      vs: { flesh: 1.1, armor: 1.4, air: 0.3, building: 0.8 } },
    skill: { name: '麻辣走位', fx: 'dash', imp: [28, 34, 40],
      cd: [11, 9, 7], mp: [25, 30, 35], desc: '模擬器省冠軍的走位,機體像長在他身上' },
    ult: { name: '主角時刻', fx: 'buff', target: 'self', mul: { dmg: [1.35, 1.45, 1.55], dmgTaken: [0.8, 0.75, 0.7] },
      add: { fx: 'leap', f: [2.0, 2.3, 2.6] },
      dur: [8, 10, 12], cd: [70, 60, 50], mp: [80, 90, 100], desc: '儲物櫃漫畫的主角上場了:輕功大跳躍' },
  },
  t07: {
    side: 'STEEL', name: '李正赫', code: '無聲', machine: '「無聲」狙擊型',
    visual: { hue: 0x3fae4a, pod: 'rack', form: 'beast', creature: 'centaur', paint: 'split', split: 'y', splitAt: 0.63 },  // 翡翠綠同色系:人身(上)亮/馬身(下)暗
    mods: { hp: 0.9, sp: 1.0, mp: 1.05, speed: 1.05, armor: 14 },
    light: { name: '消音卡賓', rw: '88 式縮裝・初速 720m/s', type: 'gun', mv: 720,
      dmg: [15, 19, 23], rate: 6, mag: [30, 36, 42], reload: 2.0, range: 190, crit: 0.10,
      vs: { flesh: 1.3, armor: 0.7, air: 1.0, building: 0.4 } },
    heavy: { name: '白頭山反器材', rw: '14.5mm 栓動・初速 1000m/s', type: 'gun', mv: 1000,
      dmg: [65, 93, 130], mag: 3, reload: 9, range: 400, crit: 0.25, critX: 2.2, pen: [18, 24, 30],
      vs: { flesh: 2.0, armor: 1.6, air: 1.2, building: 0.5 } },
    skill: { name: '靜默潛行', fx: 'stealth', dur: [5, 6, 7],
      cd: [20, 18, 16], mp: [35, 40, 45], desc: '動作省到一毫米都不多(開火即現形)' },
    ult: { name: '零點五度', fx: 'strike', count: 1, dmg: [340, 442, 553], r: 6,
      add: { fx: 'bleed', dps: [24, 30, 38], dur: 5, pen: 12 },
      range: 400, pen: 20, cd: [70, 62, 54], mp: [80, 90, 100], vs: { flesh: 1.5, armor: 1.2 },
      desc: '一發,只需要一發 —— 貫穿創口持續失血(出血)' },
  },
  t08: {
    side: 'STEEL', name: '韓雪', code: '電波歌姬', machine: '「詠嘆調」電戰機甲',
    visual: { hue: 0xffc7dd, pod: 'dish', form: 'beast', creature: 'cthulhu', paint: 'sakura' },
    mods: { hp: 0.9, sp: 1.25, mp: 1.3, speed: 1.0, armor: 12 },
    light: { name: '共鳴脈衝步槍', rw: '聲電複合雷射・光速直擊', type: 'beam',
      dmg: [15, 19, 23], rate: 7, mag: [36, 44, 52], reload: 2.1, range: 190, crit: 0.06,
      vs: { flesh: 1.3, armor: 0.7, air: 1.0, building: 0.5 } },
    heavy: { name: '諧振波炮', rw: '定向聲電複合・光速', type: 'beam',
      dmg: [23, 33, 45], mag: 5, reload: 8, range: 300, emp: [1.0, 1.5, 2.0],
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
      dmg: [51, 74, 104], r: [15, 17, 19], mag: 4, reload: 11, range: 360, pen: 10,
      vs: { flesh: 1.1, armor: 1.3, air: 0.3, building: 1.6 } },
    skill: { name: '哀悼詩', fx: 'summon', unit: 'rocketeer', count: [2, 3, 4],
      cd: [26, 23, 20], mp: [40, 45, 50], desc: '為敵我雙方各寫一行:火箭兵支援' },
    ult: { name: '巡飛彈之雨', fx: 'strike', count: [7, 9, 11], dmg: [72, 89, 111], r: 11, scatter: 45,
      add: { fx: 'confuse', dur: [1.5, 2, 2.5] },
      range: 360, pen: 8, cd: [80, 70, 60], mp: [90, 100, 110], vs: { building: 1.3, armor: 1.2 },
      desc: '讓戰爭打不完的東西一次下完,漫天彈雨引發恐慌(混亂)' },
  },
  t10: {
    side: 'STEEL', name: '蕾拉・侯賽尼', code: '軌跡', machine: '「軌跡」攔截機甲',
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
    side: 'STEEL', name: '拉斐爾・富恩特斯', code: '老雪茄', machine: '「老兵」戰術指導機',
    visual: { hue: 0x8a9a5a, pod: 'antenna', form: 'biped', creature: 'trex', paint: 'camo' },
    mods: { hp: 1.2, sp: 0.9, mp: 1.0, speed: 0.9, armor: 24 },
    light: { name: '車載重機槍', rw: 'DShKM・初速 850m/s', type: 'gun', mv: 850,
      dmg: [20, 25, 31], rate: 4.8, mag: [34, 40, 48], reload: 2.3, range: 200, pen: 4,
      vs: { flesh: 1.3, armor: 1.0, air: 0.8, building: 0.6 } },
    heavy: { name: '無後座砲', rw: 'SPG-9・初速 435m/s', type: 'launcher', mv: 435,
      dmg: [78, 115, 168], r: [13, 15, 17], mag: 3, reload: 12, range: 320, pen: 12,
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
    heavy: { name: '標定脈衝砲', rw: 'EM 標定彈・初速 2500m/s', type: 'rail', mv: 2500,
      dmg: [53, 82, 122], mag: 2, reload: 8, range: 340, emp: [0.8, 1.0, 1.2],
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
    visual: { hue: 0xd94f4f, pod: 'rack', flight: 'heli', ground: 'vampire', bulk: 1.0, paint: 'natflag', flag: [0xd52b1e, 0xffffff, 0x171796] },
    mods: { hp: 1.0, sp: 1.05, mp: 1.0, speed: 1.1, armor: 7 },
    light: { name: '7.62 六管速射艙', rw: 'M134 Minigun・初速 850m/s', type: 'gun', mv: 850,
      dmg: [11, 14, 17], rate: 12, mag: [60, 75, 90], reload: 2.4, range: 185, crit: 0.05,
      vs: { flesh: 1.3, armor: 0.6, air: 1.3, building: 0.4 } },
    heavy: { name: '地獄火反裝甲彈', rw: 'AGM-114 縮裝・鎖定追蹤・初速 450m/s', type: 'missile', mv: 450,
      dmg: [50, 72, 103], r: [12, 14, 16], mag: 4, reload: 11, range: 320, pen: [14, 18, 22],
      vs: { flesh: 0.9, armor: 1.7, air: 0.5, building: 1.1 } },
    skill: { name: '違約金條款', fx: 'dash', imp: [27, 33, 39],
      cd: [12, 10, 8], mp: [25, 30, 35], desc: '哪邊付錢都一樣快:沿視線爆發脫離' },
    ult: { name: '加班費三倍', fx: 'buff', target: 'self', mul: { dmg: [1.3, 1.4, 1.5], reload: [0.8, 0.75, 0.7] },
      add: { fx: 'vamp', f: [0.12, 0.16, 0.2] },
      dur: [8, 10, 12], cd: [75, 65, 55], mp: [80, 90, 100], desc: '合約外時段全面超載,渡鴉汲血(吸血)' },
  },
  m02: {
    side: 'MERC', kind: 'morph', name: '巴澤爾・奧坎', code: '磐石', machine: '「磐石」重型可變機甲',
    visual: { hue: 0x9aa3ad, pod: 'shield', flight: 'levi', ground: 'elephant', bulk: 1.3, paint: 'totem' },
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
    side: 'MERC', kind: 'morph', name: '伊內絲・杜阿爾特', code: '帳房', machine: '「帳房」後勤可變機甲',
    visual: { hue: 0x59c9a5, pod: 'dish', flight: 'uav', ground: 'monkey', bulk: 0.95, paint: 'minimal' },
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
    side: 'MERC', kind: 'morph', name: '奧莉薇亞・松', code: '霧行者', machine: '「霧行者」偵獵可變機甲',
    visual: { hue: 0xd24fb4, pod: 'antenna', flight: 'archo', ground: 'raptor', bulk: 0.85, paint: 'totem' },  // 洋紅+圖騰徽:與夜豹(m08 紫)脫鉤,改素色+徽章
    mods: { hp: 0.9, sp: 1.1, mp: 1.15, speed: 1.1, armor: 13 },
    light: { name: '消音戰鬥步槍', rw: 'HK G28・初速 780m/s', type: 'gun', mv: 780,
      dmg: [21, 26, 32], rate: 3.6, mag: [20, 24, 28], reload: 2.0, range: 215, crit: 0.14, critX: 1.8,
      vs: { flesh: 1.3, armor: 0.8, air: 1.1, building: 0.5 } },
    heavy: { name: '游騎反器材砲', rw: 'NTW-20・初速 900m/s', type: 'gun', mv: 900,
      dmg: [63, 92, 130], mag: 3, reload: 9, range: 380, crit: 0.18, critX: 2.0, pen: [18, 23, 28],
      vs: { flesh: 1.2, armor: 1.9, air: 1.3, building: 0.5 } },
    skill: { name: '匿名發包', fx: 'stealth', dur: [4, 5, 6],
      cd: [20, 18, 16], mp: [35, 40, 45], desc: '合約不留名:從感測網上消失(開火即現形)' },
    ult: { name: '全境盡職調查', fx: 'vision', vision: [9, 12, 15],
      cd: [72, 64, 56], mp: [85, 95, 105], desc: '受雇前先查清楚:全隊限時無霧視野' },
  },
  m05: {
    side: 'MERC', kind: 'morph', name: '瑪爾塔・韋恩', code: '清算', machine: '「清算日」電戰可變機甲',
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
    side: 'MERC', kind: 'morph', name: '圖里奧・費雷拉', code: '外包', machine: '「外包」母艦式可變機甲',
    visual: { hue: 0xf0c24a, pod: 'rack', flight: 'tilt', ground: 'atlas', bulk: 1.15, paint: 'totem' },
    mods: { hp: 1.0, sp: 1.1, mp: 1.25, speed: 1.0, armor: 6 },
    light: { name: '雙聯掛載機槍', rw: 'PKP 縮裝・初速 825m/s', type: 'gun', mv: 825,
      dmg: [13, 16, 20], rate: 9, mag: [45, 54, 63], reload: 2.2, range: 180, crit: 0.05,
      vs: { flesh: 1.3, armor: 0.6, air: 1.2, building: 0.5 } },
    heavy: { name: '集束子母彈', rw: 'CBU 縮裝・初速 400m/s', type: 'launcher', mv: 400,
      dmg: [55, 79, 112], r: [16, 18, 20], mag: 3, reload: 12, range: 300, pen: 6,
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
    side: 'MERC', kind: 'morph', name: '芮娜・沃斯', code: '尾款', machine: '「尾款」隱形狙擊可變機甲',
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
    ult: { name: '查無此人', fx: 'stealth', dur: [4, 5, 6],
      cd: [70, 62, 54], mp: [80, 90, 100], desc: '尾款結清便人間蒸發(開火即現形)' },
  },
};

// ---- 經濟(2026-07-17 改制:金錢只來自擊殺/助攻/物資,無被動收入)----
// 擊殺 = 全額賞金;助攻 = 賞金 × ASSIST.F —— 曾對死者造成傷害或負面狀態才算貢獻,
// 貢獻後離開可視半徑(自身 sight)超過 ASSIST.TTL_S 秒即失效(sim._kill 結算)。
// 賞金「對應難度」:表列戰鬥單位由 UNITS 戰力推導(見 UNITS 之後的推導區塊),
// 此處只手訂非表列目標(missile 擊落防空飛彈 / aasite 匿蹤陣地 / decoy 餌機 / 英雄機體)。
// 校準錨(npm run bal ③):單一兵線 30% 擊殺 + 40% 助攻 × 10 分鐘 ≈ 八軌全滿總價。
export const ECON = {
  START: 200,
  // DOTA 式陣亡罰金:每 1 秒重生倒數,額外自玩家共用金錢扣 $10(不透支)。只罰玩家英雄/無人機。
  DEATH_PENALTY_PER_S: 10,
  ASSIST: { F: 0.25, TTL_S: 10 },
  // 重武器「持續火力耗電率」(每秒);每發電力由 heavyMpCost 依彈夾週期均攤,全武器一致(見 heavyMpCost)
  HEAVY_MP_PER_CD: 2.0,
  // 英雄賞金:機甲/變形機甲全額;無人機(單機,2026-07-17)≈ 機甲 ×SQUAD.HP_F(生存值 80% → 150)
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
  // 全軌統一階梯單價:price(lvl) = BASE + INC × 該軌現有等級 —— 隨等級遞增(Lv0→1=75、1→2=125),
  // **第三階(lvl 2→3)一律 UPG_L3**(2026-07-27 使用者需求:所有升級的第三階金額都改成 200)。
  // 八軌全滿 = 8 ×(75+125+200) = $3200(≈ 10 分鐘收入,見 npm run bal ③);改任一值 MUST 重跑 bal。
  UPG_BASE: 75, UPG_INC: 50, UPG_L3: 200,
  CHARGE_MIN: 0.4,     // 充能 Lv0 的回復速度比例(滿級 = 1.0 = VITALS.SP_REGEN_PS / mpRegen 現值)
};
/** 「第三階」的 lvl 索引(0-based:Lv2 → Lv3 這一次購買) */
export const UPG_L3_LVL = 2;
/** 升級單價:全軌統一階梯 = BASE + INC × 該軌現有等級 lvl;**第三階(lvl=2)固定 UPG_L3 = 200**
 *  (2026-07-27 使用者需求)。八軌共用這一支 —— MUST NOT 在商店 UI / sim.buy 另寫價格。 */
export const upgradePrice = (u, lvl) => ((lvl || 0) === UPG_L3_LVL ? ECON.UPG_L3 : ECON.UPG_BASE + ECON.UPG_INC * (lvl || 0));
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
// 擊殺賞金推導(2026-07-17;「對應難度的金錢」唯一推導處,MUST NOT 手寫表列單位):
// 賞金 = 戰力(EHP + DPS × BOUNTY_DPS_S)× BOUNTY_F,取 5 的倍數。
// 第三方(GUER/MILI)沿用正規 kind ⇒ 同一張表;改 UNITS 任一數值賞金自動連動。
// 現值:步兵 20 / 火箭 35 / 榴彈 35 / 坦克 75 / 直升機 50 / 塔 330 / 主堡 540 / 碉堡 135。
for (const k of ['soldier', 'rocketeer', 'howitzer', 'tank', 'heli', 'apc', 'tower', 'base', 'bunker']) {
  const u = UNITS[k];
  const v = u.hp / armorMul(u.armor || 0) + (u.dmg || 0) * (u.rate || 0) * ECON.BOUNTY_DPS_S;
  ECON.BOUNTY[k] = Math.round(v * ECON.BOUNTY_F / 5) * 5;
}

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
  // 波次節奏:前期慢(對線期長,英雄有時間補刀/囤錢),中後期逐波加速到 MIN_S
  WAVE_PACE: { START_S: 34, MIN_S: 14, RAMP_FROM: 4, RAMP_TO: 14 },
  FIRST_WAVE_DELAY_S: 0,      // 開局即出第一波(從主堡出發),不再空等對線
  WAVE_SPAWN_OFF_M: 34,       // 波次生成點離己方主堡的沿線距離:落在主路線上、出主堡外(base R 22)
  WAVE_COHESION_M: 26,        // 同波僚兵最大脫節距離:領先者原地等最慢的(交戰中除外)
  WAVE_SOLDIERS: 3,           // 每波每兵線步槍兵數(固定編制另見 WAVE_EXTRAS)
  // 波次固定編制(2026-07-17 追加坦克):sim._spawnWave / tools/balance.mjs / e2e 共用唯一真相,
  // MUST NOT 在任何一處手抄編制;改編制 MUST 重跑 `npm run bal`(60% EHP 不變式)。
  WAVE_EXTRAS: ['rocketeer', 'howitzer', 'tank', 'heli'],
  HELI_ALT: 26,               // 攻擊直升機巡航高度(公尺;純視覺+高空降權判定用)
  AIM_SIGHT_MULT: 1.6,        // 瞄準模式視野加成(狙擊模式看得更遠)
  // 「長按右鍵 / 觸控 R」達此秒數 → 觸發機種專屬招(無人機護衛自殺機 / 機甲重砲 / 變形機甲餌機)。
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
export const BOT_DIFF = {
  novice: { key: 'novice', name: '新手', aimErr: 0.55, heavy: false, ability: false, gap: 0.90, react: 0.70 },
  low:    { key: 'low',    name: '低',   aimErr: 0.35, heavy: true,  ability: false, gap: 0.55, react: 0.45 },
  medium: { key: 'medium', name: '中',   aimErr: 0.15, heavy: true,  ability: true,  gap: 0.30, react: 0.28 },
  high:   { key: 'high',   name: '高',   aimErr: 0.0,  heavy: true,  ability: true,  gap: 0.15, react: 0.15 },
};
// 各類操作的切換間隔 = 該難度 gap × 此倍數(1 = 一次基本操作)。
// buy 27 ⇒ 高難度 ≈ 4.1s,與 2026-07-27 之前的硬編碼 4s 巡店節奏一致(其餘難度按手速等比放慢)。
export const BOT_OPS = { scan: 2, weapon: 3, ability: 4, special: 5, state: 4, buy: 27 };
export const BOT_DIFF_KEYS = ['novice', 'low', 'medium', 'high'];
export const DEFAULT_BOT_DIFF = 'medium';
export const botDiffOf = (key) => BOT_DIFF[key] || BOT_DIFF[DEFAULT_BOT_DIFF];
/** 某難度下某類操作的最短切換間隔(秒);未列名的操作 = 一次基本操作(× 1) */
export const botOpGap = (D, op) => (D?.gap ?? BOT_DIFF[DEFAULT_BOT_DIFF].gap) * (BOT_OPS[op] ?? 1);

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
