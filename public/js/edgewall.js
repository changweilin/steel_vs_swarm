// Boundary catalog and deterministic ring planner. All models are procedural.
// A fixed, continuous collision ring blocks visible gaps as well as the objects themselves.
// Geometry must stay inside the declared envelope; it need not fill the envelope.
// The catalog imports only render-free generators and never consumes the shared scene RNG.
import { mulberry32 } from './rng.js';
import { boundaryGrid } from './objectLayout.js';
import { partAABB, VEHICLE_SPEC } from './vehicles.js';
import { ENVIRONMENT_OBJECTS, environmentParts, linearEnvironmentParts, storageTankParts, environmentAvailable, environmentSize, makeSceneVehicleParts, NATURAL_CLIFF_KINDS, citywallBarbicanParts, leveeGateParts } from './environmentParts.js';
import { SLOPE_BOUNDARIES, EXPANDED_BOUNDARIES, buildSlopeBoundary } from './edgeSlope.js';
export { ROCK_SEASON_TINT } from './environmentParts.js';

// ---- 規劃參數 ----
export const EDGE_WALL = {
  RUN_MAX_M: 180,    // 同一款最長連續長度(m);超過就換一款(使用者原話的「太長的時候」)
  RUN_MIN_SEG: 2,    // 一段 run 至少幾節 —— 見紀律⑤(衛星色抖動 → 碎成雜訊)
  FACE_T: 1.6,       // 內面判定帶(m):零件的外廓進到內面這麼近就算「蓋到了」
  FACE_COVER: 0.72,  // 本體實際阻擋帶的內面覆蓋率下限(孔隙型式可過，通用補牆不可過)
  FILL_TOL: 0.35,    // 宣告的 depth/h 與零件實算的容差(m):兩個方向都夾(低報 = A30,虛胖 = 白佔空間)
  PROP_STEP_M: 110,  // 緩衝空間 3D 物件的格距(m):「少許」= 一格一件、還要過雜湊的存活閘
  PROP_KEEP: 0.5,    // 每一格的存活率(雜湊決定,零共享亂數)
  PROP_JIT: 0.4,     // 落點抖動(格距的比例)
  BACK_SEG_M: 150,   // 視線邊界背景的分段長(m)
  BACK_INSET_F: 0.9, // 背景落在緩衝深度的這個比例上(留一截裙在它腳下,不然背景像浮在邊上)
};

// 岩景四季色階：假山與懸崖共用，避免邊界兩種岩體季節分家。

// 邊界設施的剛體動態只在 `biomes.js` 建 mesh；本檔仍只交純資料。
// 轉速的唯一輸入是 `toon.js` 的即時風量，浮動幅度的唯一輸入是同一份天氣浪量。
export const EDGE_MOTION = {
  ROTOR_RAD_S: 0.72, // 風量 1 時約 6.9 rpm；實際角速度 = 此值 × 即時風量
  FLOAT_AMP_M: 0.42,
  FLOAT_FREQ: 0.58,
  FLOAT_TILT: 0.018,
  MACHINE_FREQ: 1.15,
  MACHINE_SWING: 0.12,
  PLUME_FREQ: 0.34,
  PLUME_RISE_M: 0.4,
  PLUME_DRIFT_M: 0.24,
};

// 坡度門檻由呼叫端注入。剛性物件保留各自上限；陡坡另要求連續貼坡生成能力。
export const SLOPE_TIERS = ['flat', 'mid', 'steep'];
const tierRank = (t) => Math.max(0, SLOPE_TIERS.indexOf(t));
/**
 * 坡度角(度)→ 分級。門檻由呼叫端注入(`SLOPE.EASE_DEG` / `SLOPE.BLOCK_DEG`)——
 * 本檔 MUST NOT 自己寫死度數,那樣改了 `MAX_ROAD_GRADE_DEG` 只有移動那一半跟著走。
 */
export const wallSlopeTier = (deg, easeDeg, blockDeg) => (
  deg > blockDeg ? 'steep' : (deg > easeDeg ? 'mid' : 'flat'));

// ---- 型錄 ----
// `dom` = 水陸域('land' / 'water');`bio` = 吃得下哪些地貌(`classifyImg` 的四類 + 'wet');
// `slope` = **最陡站得到哪一級**(見上)。
// `depth` / `h` = **真實公稱尺寸**(m),同時是碰撞盒的厚與高、也是稽核的雙向上下界；
// `faceH` = 低矮設施本體的實際阻擋高度(省略則量到機體視線高)，不得拿它替額外底座開後門。
// `h` MUST 大於全場最高機體(結構保證:沒有任何機體看得到自己越過邊界);實際建構時再與
// `edgeWallHM()` 取大者,故改機體尺寸時矮的那幾款自己會被抬起來。
export const WALL_KINDS = {
  // ---- 陸域 ----
  citywall:  { dom: 'land',  bio: ['urban', 'bare'],          slope: 'mid',   depth: 5,   h: 14,   label: '城牆' },
  rowhouse:  { dom: 'land',  bio: ['urban'],                  slope: 'flat',  depth: 7.5, h: 9.5,  label: '連排民房', mix: 'urban-building' },
  barricade: { dom: 'land',  bio: ['urban', 'bare'],          slope: 'flat',  depth: 6,   h: 7.5,  label: '軍工級路障' },
  train:     { dom: 'land',  bio: ['urban'],                  slope: 'flat',  depth: 3.4, h: 7.2,  label: '停駛的列車' },
  trucks:    { dom: 'land',  bio: ['urban'],                  slope: 'flat',  depth: 3.2, h: 7.4,  label: '連排大貨車' },
  skyfall:   { object: 'skyfall', dom: 'land',  bio: ['urban'],                  slope: 'flat',  depth: 16,  h: 26,   label: '倒塌摩天樓' },
  viaduct:   { dom: 'land',  bio: ['urban', 'wet'],           slope: 'flat',  depth: 13,  h: 14,   label: '倒塌高架橋' },
  levee:     { dom: 'land',  bio: ['wet', 'green'],           slope: 'flat',  depth: 12,  h: 8,    label: '河堤' },
  // `faceDeg` 是岩壁剖面的真實傾角範圍(相對水平)，幾何仍受同一個 depth/h 包絡約束。
  cliff:     { dom: 'land',  bio: ['bare', 'green', 'wet'],   slope: 'steep', depth: 18,  h: 30,   label: '懸崖峭壁', faceDeg: [60, 90], slopeBias: { mid: 6, steep: 10 } },
  rockery:   { object: 'boulder', dom: 'land',  bio: ['bare', 'green', 'wet'],   slope: 'mid', depth: 18,  h: 30,   label: '巨型假山群', slopeBias: { mid: 6, steep: 10 } },
  landslide: { dom: 'land',  bio: ['bare', 'green'],          slope: 'steep', depth: 16,  h: 18,   label: '山崩地' },
  debris:    { dom: 'land',  bio: ['bare', 'green', 'wet'],   slope: 'steep', depth: 16,  h: 10,   label: '土石流' },
  giantforest:{dom: 'land',  bio: ['green', 'wet'],           slope: 'mid',   depth: 18,  h: 28,   label: '巨木林壁', slopeBias: { flat: 10, mid: 14 } },
  fallentree:{ object: 'fallentree', dom: 'land',  bio: ['green', 'wet'],           slope: 'mid',   depth: 9,   h: 9,    label: '大倒木群', slopeBias: { flat: 6, mid: 12 } },
  edgehamlet:{ object: 'house', dom: 'land',  bio: ['urban'],                  slope: 'flat',  depth: 18,  h: 24,   label: '邊界假城街' },
  // ---- 水域 ----(水面恆是平的 ⇒ 水域段的分級一律 flat,見 `planWallRuns`)
  icefloe: { object: 'icefloe', dom: 'water', bio: ['water'], slope: 'flat', depth: 18, h: 8, label: '浮冰' },
  iceberg: { object: 'iceberg', dom: 'water', bio: ['water'], slope: 'flat', depth: 18, h: 30, label: '冰山' },
  seaice: { dom: 'water', bio: ['water'], slope: 'flat', depth: 18, h: 12, category: 'sea-ice', label: '碎裂浮冰帶' },
  seawall:   { dom: 'water', bio: ['water'],                  slope: 'flat',  depth: 10,  h: 8,    label: '海堤' },
  tetrapod:  { dom: 'water', bio: ['water'],                  slope: 'flat',  depth: 12,  h: 9.2,  label: '大型消波塊層層堆疊' },
  ship:      { dom: 'water', bio: ['water'],                  slope: 'flat',  depth: 18,  h: 22,   label: '連排貨輪' },
  isletbarrier:{dom:'water', bio: ['water'],                   slope: 'flat',  depth: 18,  h: 22,   label: '島礁海界' },
  // ---- 大型邊界設施(同族共用生成器；水域款直接落水，不借用海堤／擋土平台)----
  windsea:      { dom: 'water', bio: ['water'], slope: 'flat', depth: 16, h: 28, minCover: 0.12, label: '海上風機陣列', family: 'wind', mount: 'fixed', col: [0xd9dde0, 0x70808c] },
  floatsolar:   { dom: 'water', bio: ['water'], slope: 'flat', depth: 16, h: 9,  faceH: 1.7, label: '浮動式太陽能板陣列', family: 'solar', mount: 'float', col: [0x244b73, 0x6b8799] },
  searanch:     { dom: 'water', bio: ['water'], slope: 'flat', depth: 16, h: 12, label: '浮式養殖網箱', family: 'ranch', mount: 'float', col: [0x3f6f7a, 0xc28c38] },
  deeprig:      { dom: 'water', bio: ['water'], slope: 'flat', depth: 18, h: 28, label: '深海油井', family: 'extract', mount: 'float', col: [0xd07a32, 0x596168] },
  windland:     { dom: 'land',  bio: ['bare', 'green'], slope: 'flat', depth: 14, h: 28, minCover: 0.12, label: '陸域風機陣列', family: 'wind', col: [0xe1e4e4, 0x69747c] },
  solarfield:   { dom: 'land',  bio: ['bare'], slope: 'flat', depth: 14, h: 14, faceH: 1.7, label: '太陽能板陣列', family: 'solar', col: [0x243f63, 0x777b70] },
  mine:         { object: 'mine', dom: 'land',  bio: ['bare'], slope: 'flat', depth: 18, h: 20, label: '大型礦場', family: 'extract', col: [0xb88a3d, 0x786c5d] },
  oilfield:     { object: 'oilfield', dom: 'land',  bio: ['bare'], slope: 'flat', depth: 16, h: 18, label: '陸上油井', family: 'extract', col: [0x86583f, 0x555c62] },
  ranch:        { object: 'ranch', dom: 'land',  bio: ['green'], slope: 'flat', depth: 14, h: 14, label: '大型畜牧場', family: 'ranch', col: [0x8e7652, 0x6b7a4b] },
  greenhouse:   { object: 'greenhouse', dom: 'land',  bio: ['green'], slope: 'flat', depth: 14, h: 14, label: '大型溫室', family: 'greenhouse', col: [0xa9c7bf, 0x6a8a78] },
  factory:      { object: 'factory', dom: 'land',  bio: ['urban'], slope: 'flat', depth: 18, h: 24, label: '大型工廠', family: 'industry', mix: 'industry', variants: 3, separated: true, col: [0x7b8790, 0xb0653e] },
  powerplant:   { object: 'powerplant', dom: 'land',  bio: ['urban'], slope: 'flat', depth: 18, h: 28, label: '大型電廠', family: 'industry', mix: 'industry', variants: 3, separated: true, col: [0x69747c, 0x9a8f72] },
  incinerator:  { object: 'incinerator', dom: 'land',  bio: ['urban'], slope: 'flat', depth: 18, h: 30, label: '大型焚化爐', family: 'industry', mix: 'industry', variants: 3, separated: true, col: [0x727c82, 0xb46b3f] },
  skyscrapers:  { object: 'skyscraper', dom: 'land',  bio: ['urban'], slope: 'flat', depth: 18, h: 34, label: '摩天大樓群', family: 'highrise', mix: 'urban-building', variants: 3, separated: true, col: [0x64717d, 0x8ca0ad] },
  oysterracks:  { dom: 'land',  bio: ['wet'], slope: 'flat', depth: 14, h: 14, label: '蚵棚', family: 'wetland', col: [0x665541, 0x9caa9e], slopeBias: { flat: 5 } },
  strandedship:{ object: 'strandedship', dom: 'land',  bio: ['wet'], slope: 'flat', depth: 18, h: 18, label: '擱淺船隻', family: 'wreck', variants: 3, separated: true, col: [0x5b6970, 0x8a4f3e], slopeBias: { flat: 5 } },
  wetpods:      { dom: 'land',  bio: ['wet'], slope: 'flat', depth: 16, h: 14, label: '大型消波塊層層堆疊', family: 'pods', col: [0x969a9b, 0x777c7d], slopeBias: { flat: 5 } },
  house: { object: 'house', dom: 'land', bio: ['urban'], slope: 'flat', depth: 12, h: 18, label: '住家' },
  car: { object: 'car', dom: 'land', bio: ['urban'], slope: 'flat', depth: 8, h: 10, label: '汽車' },
  gianttree: { object: 'gianttree', dom: 'land', bio: ['green', 'wet'], slope: 'mid', depth: 18, h: 38, label: '神木', slopeBias: { flat: 6, mid: 2 } },
  boulder: { object: 'boulder', dom: 'land', bio: ['bare', 'green', 'wet'], slope: 'mid', depth: 18, h: 24, label: '巨石' },
};
// Only generators with a continuous terrain cross-section may enter steep runs.
for (const [kind, def] of Object.entries(EXPANDED_BOUNDARIES)) {
  const { label, category, bio, slope, depth, h, dom = 'land', slopeBias } = def;
  WALL_KINDS[kind] = { label, category, bio, slope, depth, h, dom, ...(slopeBias ? { slopeBias } : {}) };
}
for (const kind of Object.keys(SLOPE_BOUNDARIES)) {
  WALL_KINDS[kind].terrainFit = true;
  if (SLOPE_BOUNDARIES[kind].fillContact) WALL_KINDS[kind].fillContact = true;
  if (SLOPE_BOUNDARIES[kind].bufferFill) WALL_KINDS[kind].bufferFill = true;
  if (!EXPANDED_BOUNDARIES[kind] && WALL_KINDS[kind].dom === 'land') WALL_KINDS[kind].slope = 'steep';
}


// ---- 邊界物件分類 / 使用政策 -------------------------------------------------
// 邊界型錄同時包含「一件就成立的物件」與「必須沿邊成列才成立的長構造」。分類只描述
// 物件語意；layout 才決定能否流入一般背景物件型錄。長構造維持 edge-only，避免把一小截
// 河堤／城牆／消波塊當成可任意散布的獨立擺件。
const BOUNDARY_LINEAR_CATEGORIES = Object.freeze({
  citywall: 'fortification', rowhouse: 'residential', barricade: 'military', train: 'rail',
  trucks: 'vehicle', skyfall: 'highrise', viaduct: 'bridge', levee: 'levee',
  cliff: 'rock', rockery: 'rock', landslide: 'rock', debris: 'rock',
  giantforest: 'giant-tree', fallentree: 'deadwood', edgehamlet: 'residential',
  seawall: 'coastal', tetrapod: 'coastal', ship: 'marine-vehicle', isletbarrier: 'rock',
  windsea: 'energy', floatsolar: 'energy', searanch: 'aquaculture', deeprig: 'extraction',
  windland: 'energy', solarfield: 'energy', mine: 'extraction', oilfield: 'extraction',
  ranch: 'agriculture', greenhouse: 'agriculture', factory: 'industry', powerplant: 'industry',
  incinerator: 'industry', skyscrapers: 'highrise', oysterracks: 'aquaculture',
  strandedship: 'marine-vehicle', wetpods: 'coastal',
});

export const BOUNDARY_OBJECT_CATEGORIES = Object.freeze(Object.fromEntries(
  Object.entries(WALL_KINDS).map(([kind, def]) => [kind,
    def.object ? ENVIRONMENT_OBJECTS[def.object].category : def.category || BOUNDARY_LINEAR_CATEGORIES[kind]]),
));

// 只有這些完整單體可作一般背景物件。其餘款式仍只在邊界生成器內成列或延伸。
export const STANDALONE_BOUNDARY_KINDS = Object.freeze(
  Object.keys(WALL_KINDS).filter(kind => WALL_KINDS[kind].object),
);
export const BOUNDARY_ONLY_KINDS = Object.freeze(
  Object.keys(WALL_KINDS).filter((kind) => !STANDALONE_BOUNDARY_KINDS.includes(kind)),
);

export function boundaryObjectMeta(kind) {
  const def = WALL_KINDS[kind];
  if (!def) return null;
  return {
    kind,
    category: def.object ? ENVIRONMENT_OBJECTS[def.object].category : BOUNDARY_OBJECT_CATEGORIES[kind],
    layout: STANDALONE_BOUNDARY_KINDS.includes(kind) ? 'standalone' : 'edge-only',
    dom: def.dom,
    bio: [...def.bio],
    label: def.label,
  };
}

export function boundaryObjectKinds({ category = null, layout = null } = {}) {
  return Object.keys(WALL_KINDS).filter((kind) => {
    const meta = boundaryObjectMeta(kind);
    return (!category || meta.category === category) && (!layout || meta.layout === layout);
  });
}

// 同類設施可在一個地貌 run 內交錯；這是「可混排」名冊，不是生成器家族。
// 住商與工業刻意分組，避免只因都在 urban 就把電廠插進連排住宅。
export const WALL_MIX_GROUPS = {
  industry: ['factory', 'powerplant', 'incinerator'],
  'urban-building': ['rowhouse', 'skyscrapers'],
};

/** 這一款站得到這一級坡上嗎(`slope` 是**上界**:自然景觀在三級都合法) */
const fitsTier = (k, tier) => tierRank(WALL_KINDS[k].slope) >= tierRank(tier)
  && (tier !== 'steep' || WALL_KINDS[k].terrainFit === true);
/** 這一款吃得下這個(地貌, 水陸域)嗎 */
const kindFits = (k, biome, water) => {
  const d = WALL_KINDS[k];
  if (!d) return false;
  if (water) return d.dom === 'water';
  return d.dom === 'land' && d.bio.includes(biome);
};

/**
 * 依場地環境與區域類型過濾障礙物類別：
 * 荒野／自然風景區（如太魯閣、合歡山、陽明山、黑森林等零市區成份場地）禁止人造建築、
 * 重型工廠、市區交通、工業開採、能源陣列與軍工路障，維持純粹地貌與自然景觀。
 * 工業區與住商區則各自優先或排除不符之構造。
 */
export function isCategoryAllowed(category, environment = null) {
  if (!environment) return true;
  const mix = environment.mix || environment.venue?.mix;
  const venueType = environment.venue?.type;
  const isNature = (mix && (mix.urban || 0) <= 0.05)
    || (venueType && venueType !== '市區' && (mix?.urban || 0) <= 0.05)
    || environment.wilderness === true;

  if (isNature) {
    const artificial = ['industry', 'residential', 'highrise', 'rail', 'vehicle', 'bridge', 'extraction', 'energy', 'military', 'fortification', 'agriculture'];
    if (artificial.includes(category)) return false;
  } else if (environment.zone === 'industrial' || environment.industrial === true) {
    if (category === 'residential') return false;
  } else if (environment.zone === 'residential' || environment.residential === true) {
    if (['industry', 'extraction'].includes(category)) return false;
  }
  return true;
}

/**
 * (地貌, 水陸域, 坡度級)→ 候選款式清單(**排序恆定**,`Object.keys` 的宣告序)。
 *
 * **坡度是硬門檻、地貌是偏好**:陡坡上配不到符合地貌的自然景觀時(例如「陡的市區」),
 * 退回「這一級全部合法的款」而**不是**退回平地款 —— 那一步走錯就是貨櫃車掛在崖面上,
 * 而畫面之外的每一條斷言都還是綠的。一款都配不到才回最通用那一款(原則 6:降級不例外)。
 */
export function wallCandidates(biome, water, tier = 'flat', environment = null) {
  const byTier = Object.keys(WALL_KINDS).filter((k) => fitsTier(k, tier)
    && (!environment || environmentAvailable(k === 'seaice' ? 'icefloe' : WALL_KINDS[k].object, environment))
    && isCategoryAllowed(BOUNDARY_OBJECT_CATEGORIES[k], environment));
  const list = byTier.filter((k) => kindFits(k, biome, water));
  const weighted = (rows) => rows.flatMap((k) => Array.from(
    { length: Math.max(1, WALL_KINDS[k].slopeBias?.[tier] || 1) }, () => k));
  if (list.length) return weighted(list);
  if (byTier.length && !water) return weighted(byTier);
  const mix = environment?.mix || environment?.venue?.mix;
  const venueType = environment?.venue?.type;
  const isNature = (mix && (mix.urban || 0) <= 0.05)
    || (venueType && venueType !== '市區' && (mix?.urban || 0) <= 0.05)
    || environment?.wilderness === true;
  return water ? ['seawall'] : (isNature ? ['cliff'] : ['barricade']);
};

/**
 * 落點 → 確定性種子。**與 `beacons.js beaconSeed` / `biomes.js djAt` 同一個雜湊形狀** ——
 * 那兩支各自住在 import 了 THREE 的檔案裡(本檔的紀律① 不准碰),故此處第三份是刻意的:
 * 三支算的是同一件事、對同一組輸入回同一個值,改雜湊 MUST 三處一起改。
 */
export function edgeSeed(x, z, salt = 0) {
  const h = (Math.imul(Math.round(x * 8) | 0, 0x9E3779B1)
    ^ Math.imul(Math.round(z * 8) | 0, 0x85EBCA77) ^ Math.imul(salt | 0, 0x27D4EB2F)) | 0;
  return Math.imul(h ^ (h >>> 15), 0xC2B2AE3D) >>> 0;
}

/**
 * 沿一條邊把節切成 run,每個 run 配一款(唯一縫;純函式、零共享亂數、零 THREE)。
 *
 * 切分只有紀律⑤ 那一條:**地貌 / 水陸域 / 坡度級改變** 或 **已經連續鋪了 `RUN_MAX_M`**。
 * 短 run 併回前一段的動作 MUST 排在配款**之前** —— 反過來做的話一節長的 run 已經先抽過一款,
 * 併進去只是把它的款式丟掉,而 run 的長度分布看起來已經正常了(問題被藏起來)。
 *
 * **併的時候坡度級取兩者之中較陡的那一個**:反過來(取較緩)就是把一節崖面併進平地 run,
 * 於是一列貨櫃車橫跨那道崖 —— 而 run 長度、款式分布、外廓契約全部照樣綠。往陡的方向併
 * 只會讓自然景觀多鋪幾節緩坡(自然景觀擺在緩坡上不突兀),是安全的那一邊。
 * 水陸域**仍然不准併**(把海堤併進城牆就是牆站在水裡,反過來也一樣)。
 *
 * 相鄰 run **刻意避免同款**:兩段同款接在一起就是一段更長的同款牆,而使用者要的正是
 * 「太長的時候會更換」。候選只有一款時不強求(那是型錄的事,不是這裡的)。
 *
 * @param segs [{ x, z, len, biome, water, tier }] 沿邊順序排好的節(`tier` 見 `wallSlopeTier`)
 * @param opts { runMaxM, minSeg }
 * @returns [{ i0, i1, kind, biome, water, tier, len }](i1 為**不含**的結束索引)
 */
export function planWallRuns(segs, opts = {}) {
  const runMax = opts.runMaxM ?? EDGE_WALL.RUN_MAX_M;
  const minSeg = opts.minSeg ?? EDGE_WALL.RUN_MIN_SEG;
  if (!segs.length) return [];
  // 水面恆是平的 ⇒ 水域段的坡度級一律 flat(水底的坡與站在水面上的東西無關)
  const tierOf = (s) => (s.water ? 'flat' : (s.tier || 'flat'));
  const steeper = (a, b) => (tierRank(a) >= tierRank(b) ? a : b);
  // ① 依「地貌/水陸域/坡度級改變 或 太長」切
  const runs = [];
  const mk = (i) => ({ i0: i, i1: i + 1, biome: segs[i].biome, water: segs[i].water, tier: tierOf(segs[i]), len: segs[i].len });
  let cur = mk(0);
  for (let i = 1; i < segs.length; i++) {
    const s = segs[i];
    const changed = s.biome !== cur.biome || s.water !== cur.water || tierOf(s) !== cur.tier;
    if (changed || cur.len >= runMax) {
      runs.push(cur);
      cur = mk(i);
    } else {
      cur.i1 = i + 1;
      cur.len += s.len;
    }
  }
  runs.push(cur);
  // ② 太短的 run 併回前一段(併不到前面就併到後面);併完長度重算、**坡度級取較陡者**
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs.length === 1 || runs[i].i1 - runs[i].i0 >= minSeg) continue;
    const prev = i > 0 && runs[i - 1].water === runs[i].water ? runs[i - 1] : null;
    const next = i + 1 < runs.length && runs[i + 1].water === runs[i].water ? runs[i + 1] : null;
    const into = prev || next;
    if (!into) continue;
    into.i0 = Math.min(into.i0, runs[i].i0);
    into.i1 = Math.max(into.i1, runs[i].i1);
    into.len += runs[i].len;
    into.tier = steeper(into.tier, runs[i].tier);
    runs.splice(i, 1);
  }
  // ③ 配款:候選清單由(地貌, 水陸域, 坡度級)決定,雜湊挑一支;與前一段撞款就往後挪一格
  let prevKind = null;
  for (const r of runs) {
    const cand = wallCandidates(r.biome, r.water, r.tier, opts.environment);
    const s = segs[r.i0];
    let idx = edgeSeed(s.x, s.z, r.i0) % cand.length;
    if (cand.some((k) => k !== prevKind) && cand[idx] === prevKind) {
      do idx = (idx + 1) % cand.length; while (cand[idx] === prevKind);
    }
    r.kind = cand[idx];
    prevKind = r.kind;
  }
  return runs;
}

/**
 * 一個 run 內的逐節實際款式。同組款可穿插，且相鄰節不重複；沒有 mix 的長構造維持原款。
 * `prevKind` 讓相鄰 run 的接縫也遵守去重。只使用座標雜湊，不消耗共享亂數。
 */
export function planWallKinds(run, segs, prevKind = null) {
  const base = WALL_KINDS[run.kind] || WALL_KINDS.barricade;
  const pool = (WALL_MIX_GROUPS[base.mix] || [run.kind]).filter((k) => (
    kindFits(k, run.biome, run.water) && fitsTier(k, run.tier)));
  const candidates = pool.length ? pool : [run.kind];
  const out = [];
  let prev = prevKind;
  for (let i = run.i0; i < run.i1; i++) {
    const s = segs[i];
    let at = edgeSeed(s.x, s.z, i + 0x4D49) % candidates.length;
    if (candidates.length > 1 && candidates[at] === prev) at = (at + 1) % candidates.length;
    prev = candidates[at];
    out.push(prev);
  }
  return out;
}

/** 同款的構型輪替；呼叫端傳入前一節構型即可保證相鄰不重複。 */
export function wallVariant(kind, seed, prevVariant = -1) {
  const n = Math.max(1, WALL_KINDS[kind]?.variants || 1);
  let v = (seed >>> 0) % n;
  if (n > 1 && v === prevVariant) v = (v + 1) % n;
  return v;
}

// ---- 零件外廓(純幾何)----
// `beacons.js partExtent` 算的是「離軸心多遠」(圓形外廓,規劃期預留空間用),本檔要的是
// **三軸各自的區間**(零件收不收得進那個長方盒)—— 圓外廓答不了「厚度方向有沒有頂出去」。
// 兩支算的不是同一件事,故不是第二份實作;而且那一支住在 import THREE 的檔案裡(紀律①)。
/** 零件在**局部座標**的 AABB:{ x0,x1, y0,y1, z0,z1 }。純幾何、無 three */
export function partBox(part) {
  const b = partAABB(part);
  const m = part.motion;
  if (!m) return b;
  if (m.kind === 'rotor') {
    const [px = 0, py = 0] = m.pivot || [];
    const r = Math.max(
      Math.hypot(b.x0 - px, b.y0 - py), Math.hypot(b.x0 - px, b.y1 - py),
      Math.hypot(b.x1 - px, b.y0 - py), Math.hypot(b.x1 - px, b.y1 - py),
    );
    return { ...b, x0: px - r, x1: px + r, y0: py - r, y1: py + r };
  }
  const pad = Math.max(0, m.pad || 0);
  return { x0: b.x0 - pad, x1: b.x1 + pad, y0: b.y0 - pad, y1: b.y1 + pad, z0: b.z0 - pad, z1: b.z1 + pad };
}

/**
 * 一整份零件表收不收得進盒子(紀律③ 的「不外凸」那一半)。
 * 局部座標:x = 沿邊(盒心為 0)、y = 由段底往上、z = 厚度方向(**+z = 朝可玩區**,內面在 +D/2)。
 * @returns { fit, ox, oy, oz, depth, h } —— ox/oy/oz = 三軸各自頂出去多少(m;≤0 = 沒頂出)
 */
export function wallFit(parts, len, depth, h) {
  let ox = -Infinity, oy = -Infinity, oz = -Infinity;
  let dz0 = Infinity, dz1 = -Infinity, top = -Infinity;
  for (const p of parts) {
    const b = partBox(p);
    ox = Math.max(ox, b.x1 - len / 2, -len / 2 - b.x0);
    oy = Math.max(oy, b.y1 - h, -b.y0);
    oz = Math.max(oz, b.z1 - depth / 2, -depth / 2 - b.z0);
    dz0 = Math.min(dz0, b.z0); dz1 = Math.max(dz1, b.z1);
    top = Math.max(top, b.y1);
  }
  return { fit: ox <= 1e-9 && oy <= 1e-9 && oz <= 1e-9, ox, oy, oz, depth: dz1 - dz0, h: top };
}

/**
 * 內面覆蓋率(紀律③ 的「不撞空氣」那一半)。
 * 在盒子的內面(z = +D/2)上取 `nx × ny` 格,問「有沒有任何零件的 AABB 罩到這一格、
 * 而且它的外廓進到內面 `FACE_T` 以內」。量測帶只到呼叫端給的 `bandH`(一般款 = 機體視線高；
 * 低矮設施 = 資料列 `faceH`)——
 * 更高的地方本來就允許是天空(倒塌摩天樓的斷面、貨輪的桅桿),而低於機體高的破洞
 * 是實打實的「看得穿卻走不過去」。
 */
export function wallFaceCover(parts, len, depth, bandH, nx = 24, ny = 8) {
  const face = depth / 2, t = EDGE_WALL.FACE_T;
  const near = parts.map(partBox).filter((b) => b.z1 >= face - t);
  let hit = 0;
  for (let i = 0; i < nx; i++) {
    const x = -len / 2 + ((i + 0.5) * len) / nx;
    for (let j = 0; j < ny; j++) {
      const y = ((j + 0.5) * bandH) / ny;
      if (near.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1)) hit++;
    }
  }
  return hit / (nx * ny);
}

// ---- 零件表(純資料;幾何 = ['box',w,h,d] / ['cyl',r1,r2,h,seg] / ['cone',r,h,seg] / ['ico',r])----
// 每一款是 `(len, D, H, rnd) => rows` 的**函式**而不是靜態陣列:段長由 `WORLD_EDGE.SEG_M` 推導、
// 高度由最高機體推導,兩者都會變 ⇒ 靜態表一改參數就穿幫(車廂浮在半空、雉堞穿出盒頂)。
// `rnd` 是**這一節自己的** `mulberry32`(座標雜湊起種),同款不同節才會有色差與擺位差。

/** 沿邊等距重複的單元(車廂/民房/消波塊…);回傳攤平後的零件列 */
const rep = (len, pitch, fn) => {
  const n = Math.max(1, Math.round(len / pitch));
  const step = len / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(...fn(-len / 2 + (i + 0.5) * step, step, i, n));
  return out;
};
/** 深度 d 的零件要貼齊**內面**時的 z 中心(內面在 +D/2) */
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

// Visible gaps remain blocked by the continuous authoritative ring.
export function wallParts(kind, { len, depth, h, seed = 1, variant = wallVariant(kind, seed), season = 'summer', yaw = false, joins = null }) {
  const def = WALL_KINDS[kind];
  if (!def) throw new RangeError('Unknown boundary kind: ' + kind);
  if (![len, depth, h].every(n => Number.isFinite(n) && n > 0)) throw new RangeError('Invalid boundary dimensions');
  const objectSeed = (seed ^ Math.imul(variant, 0x45d9f3b)) >>> 0;
  // 邊界本體是沿邊連續構造，單體朝向維持軸向對齊(預設除外)；獨立散布經 standaloneBoundaryParts 另開。
  if (def.object) return environmentParts(def.object, { size: [len, h, depth], seed: objectSeed, season, yaw });
  if (EXPANDED_BOUNDARIES[kind] || ['barricade', 'levee', 'seawall'].includes(kind)) return buildSlopeBoundary(kind, {
    len, depth, h: h - .4, x: objectSeed % 997 * 11, z: objectSeed % 953 * 7,
    seed: objectSeed, season, heightAt: () => .4, joins,
  }).parts;
  return linearEnvironmentParts(kind, { len, depth, h, seed: objectSeed, season, joins });
}

/**
 * 可獨立散布的邊界物件出口。背景型錄與邊界本體共用 wallParts，沒有第二份電廠／礦場／
 * 摩天樓生成器；長構造在此直接拒絕，避免被誤當一般擺件。
 */
export function standaloneBoundaryParts(kind, opts = {}) {
  if (!STANDALONE_BOUNDARY_KINDS.includes(kind)) {
    throw new RangeError(`邊界款式不是獨立物件:${kind}`);
  }
  const def = WALL_KINDS[kind];
  const size = ENVIRONMENT_OBJECTS[def.object].size;
  return wallParts(kind, {
    len: opts.len ?? size[0],
    depth: opts.depth ?? size[2],
    h: opts.h ?? size[1],
    seed: opts.seed ?? 1,
    variant: opts.variant ?? wallVariant(kind, opts.seed ?? 1),
    season: opts.season ?? 'summer',
    yaw: opts.yaw ?? true,
  });
}

// ============ 邊界緩衝區單一物件組合類障礙物填滿 ============
// 正常人造物件如：風機／太陽能板／完好摩天樓／連排透天等，以整齊排列（矩陣排列或交錯排列）填滿邊界緩衝區；
// 荒廢或被破壞人造物如：被攻擊或縱火車輛／出軌列車／倒塌大樓／擱淺船隻／倒塌高架等，以隨機方向位置排列；
// 自然物件如：大小神木林／大小巨岩／大小山頭／冰山浮冰等，以隨機排列填滿邊界緩衝區。
// 所有物件尺寸嚴格錨定遊戲空間正常物件標準尺寸（杜絕為作障礙物而故意放大）。
// 全程使用世界座標雜湊起種，零全域共享隨機序列消耗，嚴格決定性。
export const BOUNDARY_BUFFER_LAYOUTS = Object.freeze({
  // ---- 正常營運人造物件 (Artificial Intact): 整齊排列 (矩陣 grid 或交錯 staggered) ----
  // 風機: 交錯排列 (staggered) 避免尾流
  windland:    { type: 'artificial', mode: 'staggered', pitchX: 18, pitchZ: 18, object: 'wind',  scaleRange: [0.95, 1.05] },
  windsea:     { type: 'artificial', mode: 'staggered', pitchX: 18, pitchZ: 18, object: 'wind',  scaleRange: [0.95, 1.05] },
  // 太陽能板: 矩陣排列 (grid) 採光一致
  solarfield:  { type: 'artificial', mode: 'grid',      pitchX: 8,  pitchZ: 7,  object: 'solar', scaleRange: [1.0, 1.0] },
  floatsolar:  { type: 'artificial', mode: 'grid',      pitchX: 8,  pitchZ: 7,  object: 'solar', scaleRange: [1.0, 1.0] },
  // 完好摩天樓: 交錯排列 (staggered) 豐富立體天際線
  skyscrapers: { type: 'artificial', mode: 'staggered', pitchX: 20, pitchZ: 20, object: 'skyscraper', scaleRange: [0.85, 1.0] },
  alpinecity:  { type: 'artificial', mode: 'staggered', pitchX: 20, pitchZ: 20, object: 'skyscraper', scaleRange: [0.85, 1.0] },
  // 連排透天 / 民房: 矩陣排列 (grid) 正交街廓
  rowhouse:    { type: 'artificial', mode: 'grid',      pitchX: 14, pitchZ: 12, object: 'house', scaleRange: [0.9, 1.0] },
  edgehamlet:  { type: 'artificial', mode: 'grid',      pitchX: 14, pitchZ: 12, object: 'house', scaleRange: [0.9, 1.0] },
  cliffvillage:{ type: 'artificial', mode: 'grid',      pitchX: 14, pitchZ: 12, object: 'house', scaleRange: [0.9, 1.0] },
  house:       { type: 'artificial', mode: 'grid',      pitchX: 14, pitchZ: 12, object: 'house', scaleRange: [0.9, 1.0] },
  // 工業廠房 / 倉儲 / 電廠 / 焚化爐: 矩陣排列 (grid)
  warehousebelt:    { type: 'artificial', mode: 'grid', pitchX: 30, pitchZ: 24, object: 'factory', scaleRange: [0.9, 1.0] },
  harborwarehouses: { type: 'artificial', mode: 'grid', pitchX: 30, pitchZ: 24, object: 'factory', scaleRange: [0.9, 1.0] },
  factory:          { type: 'artificial', mode: 'grid', pitchX: 30, pitchZ: 24, object: 'factory', scaleRange: [0.9, 1.0] },
  powerplant:       { type: 'artificial', mode: 'grid', pitchX: 32, pitchZ: 24, object: 'powerplant', scaleRange: [0.9, 1.0] },
  incinerator:      { type: 'artificial', mode: 'grid', pitchX: 26, pitchZ: 22, object: 'incinerator', scaleRange: [0.9, 1.0] },
  // 油槽儲運: 交錯排列 (staggered)
  tankfarm:         { type: 'artificial', mode: 'staggered', pitchX: 14, pitchZ: 14, object: 'tank', scaleRange: [0.9, 1.05] },
  // 溫室大棚: 矩陣排列 (grid)
  greenhouse:         { type: 'artificial', mode: 'grid', pitchX: 24, pitchZ: 18, object: 'greenhouse', scaleRange: [0.95, 1.0] },
  hillsidegreenhouses:{ type: 'artificial', mode: 'grid', pitchX: 24, pitchZ: 18, object: 'greenhouse', scaleRange: [0.95, 1.0] },
  // 農牧場: 矩陣排列 (grid)
  ranch:            { type: 'artificial', mode: 'grid', pitchX: 26, pitchZ: 20, object: 'ranch', scaleRange: [0.9, 1.0] },
  terracedfarms:    { type: 'artificial', mode: 'grid', pitchX: 26, pitchZ: 20, object: 'ranch', scaleRange: [0.9, 1.0] },
  // 採掘與油井: 交錯排列 (staggered)
  mine:             { type: 'artificial', mode: 'staggered', pitchX: 32, pitchZ: 26, object: 'mine', scaleRange: [0.9, 1.0] },
  oilfield:         { type: 'artificial', mode: 'staggered', pitchX: 20, pitchZ: 18, object: 'oilfield', scaleRange: [0.9, 1.0] },
  deeprig:          { type: 'artificial', mode: 'staggered', pitchX: 22, pitchZ: 20, object: 'oilfield', scaleRange: [0.9, 1.0] },

  // ---- 荒廢／被破壞人造物件 (Artificial Ruined): 隨機方向位置排列 (random + randomYaw) ----
  // 倒塌的大樓: 隨機方向散布
  skyfall:     { type: 'artificial', ruined: true, mode: 'random', pitchX: 36, pitchZ: 20, object: 'skyfall',      scaleRange: [0.85, 1.0], randomYaw: true },
  // 擱淺的船隻 / 貨輪殘骸: 隨機方向擱淺散布
  strandedship:{ type: 'artificial', ruined: true, mode: 'random', pitchX: 34, pitchZ: 18, object: 'strandedship', scaleRange: [0.85, 1.0], randomYaw: true },
  ship:        { type: 'artificial', ruined: true, mode: 'random', pitchX: 34, pitchZ: 18, object: 'strandedship', scaleRange: [0.85, 1.0], randomYaw: true },
  // 被攻擊／縱火的車輛: 隨機方向停放殘骸，車頂塌陷與焦黑配色
  trucks:      { type: 'artificial', ruined: true, mode: 'random', pitchX: 14, pitchZ: 8,  object: 'truck',        scaleRange: [0.95, 1.05], randomYaw: true },
  car:         { type: 'artificial', ruined: true, mode: 'random', pitchX: 6,  pitchZ: 5,  object: 'car',          scaleRange: [0.9, 1.0],   randomYaw: true },
  // 出軌的列車: 斷裂、橫臥、傾覆於緩衝區之車廂
  train:       { type: 'artificial', ruined: true, mode: 'random', pitchX: 22, pitchZ: 10, object: 'train',        scaleRange: [0.95, 1.05], randomYaw: true },
  // 倒塌的高架橋: 橋面斷裂錯位
  viaduct:     { type: 'artificial', ruined: true, mode: 'random', pitchX: 22, pitchZ: 14, object: 'viaduct',      scaleRange: [0.9, 1.05],  randomYaw: true },

  // ---- 自然物件 (Natural): 隨機排列 (random) 帶多尺度大小變化 ----
  // 大小神木林: 隨機散布，尺度 0.65x ~ 1.55x
  gianttree:   { type: 'natural', mode: 'random', pitchX: 26, pitchZ: 26, object: 'gianttree', scaleRange: [0.65, 1.55], randomYaw: true },
  giantforest: { type: 'natural', mode: 'random', pitchX: 26, pitchZ: 26, object: 'gianttree', scaleRange: [0.65, 1.50], randomYaw: true },
  densegiants: { type: 'natural', mode: 'random', pitchX: 24, pitchZ: 24, object: 'gianttree', scaleRange: [0.70, 1.55], randomYaw: true },
  foresthills: { type: 'natural', mode: 'random', pitchX: 26, pitchZ: 26, object: 'gianttree', scaleRange: [0.65, 1.45], randomYaw: true },
  fallentree:  { type: 'natural', mode: 'random', pitchX: 24, pitchZ: 14, object: 'fallentree',scaleRange: [0.60, 1.40], randomYaw: true },
  // 大小巨岩: 隨機散布，尺度 0.55x ~ 1.65x
  boulder:     { type: 'natural', mode: 'random', pitchX: 18, pitchZ: 18, object: 'boulder',   scaleRange: [0.55, 1.65], randomYaw: true },
  rockery:     { type: 'natural', mode: 'random', pitchX: 18, pitchZ: 18, object: 'boulder',   scaleRange: [0.60, 1.60], randomYaw: true },
  basaltspine: { type: 'natural', mode: 'random', pitchX: 18, pitchZ: 18, object: 'boulder',   scaleRange: [0.60, 1.50], randomYaw: true },
  reefchain:   { type: 'natural', mode: 'random', pitchX: 18, pitchZ: 18, object: 'boulder',   scaleRange: [0.60, 1.50], randomYaw: true },
  isletbarrier:{ type: 'natural', mode: 'random', pitchX: 18, pitchZ: 18, object: 'boulder',   scaleRange: [0.55, 1.50], randomYaw: true },
  // 大小山頭: 隨機散布，尺度 0.70x ~ 1.45x
  rollinghills:{ type: 'natural', mode: 'random', pitchX: 20, pitchZ: 20, object: 'boulder',   scaleRange: [0.70, 1.45], randomYaw: true },
  // 冰山浮冰: 隨機散布，尺度 0.50x ~ 1.45x
  icefloe:     { type: 'natural', mode: 'random', pitchX: 24, pitchZ: 20, object: 'icefloe',   scaleRange: [0.50, 1.40], randomYaw: true },
  iceberg:     { type: 'natural', mode: 'random', pitchX: 32, pitchZ: 28, object: 'iceberg',   scaleRange: [0.55, 1.45], randomYaw: true },
  seaice:      { type: 'natural', mode: 'random', pitchX: 22, pitchZ: 20, object: 'icefloe',   scaleRange: [0.50, 1.35], randomYaw: true },

  // ---- 連續組裝邊界障礙物 (Continuous Boundary Obstacles): 本體無縫接軌，外側緩衝區生成等同一般遊戲區域物件 ----
  citywall:    { type: 'artificial', continuous: true, mode: 'grid', pitchX: 24, pitchZ: 20, scaleRange: [0.9, 1.0], bio: ['urban', 'bare'] },
  levee:       { type: 'artificial', continuous: true, mode: 'grid', pitchX: 24, pitchZ: 20, scaleRange: [0.9, 1.0], bio: ['wet', 'green'] },
  seawall:     { type: 'artificial', continuous: true, mode: 'grid', pitchX: 24, pitchZ: 20, scaleRange: [0.9, 1.0], bio: ['water'] },
  tetrapod:    { type: 'artificial', continuous: true, mode: 'staggered', pitchX: 24, pitchZ: 20, scaleRange: [0.9, 1.0], bio: ['water'] },
  wetpods:     { type: 'artificial', continuous: true, mode: 'grid', pitchX: 24, pitchZ: 20, scaleRange: [0.9, 1.0], bio: ['wet'] },
  canalbank:   { type: 'artificial', continuous: true, mode: 'grid', pitchX: 24, pitchZ: 20, scaleRange: [0.9, 1.0], bio: ['wet', 'urban'] },
  barricade:   { type: 'artificial', continuous: true, mode: 'grid', pitchX: 20, pitchZ: 18, scaleRange: [0.9, 1.0], bio: ['urban', 'bare'] },
  searanch:    { type: 'artificial', object: 'aquaculture', mode: 'grid', pitchX: 24, pitchZ: 20, scaleRange: [0.9, 1.0], bio: ['water'] },
  oysterracks: { type: 'artificial', object: 'aquaculture', mode: 'grid', pitchX: 20, pitchZ: 18, scaleRange: [0.9, 1.0], bio: ['wet'] },
});

// Row 0 連續排列仍可逐件轉向的款式：180° 翻轉（繞 Y 保持置中 AABB 不變故不突出碰撞柱）。
// 車輛／船隻（車頭／船艏方向）＋倒塌樓／倒木（layDown 後一律倒向 +x）＋岩石／冰體（mesh 非對稱）。
// 連續長構造與整齊人造物、徑向對稱的神木必須維持軸向對齊，故不在此列。
const ROW0_FLIP_KINDS = new Set(['trucks', 'car', 'train', 'ship', 'strandedship',
  'skyfall', 'fallentree', 'boulder', 'rockery', 'basaltspine', 'reefchain',
  'isletbarrier', 'rollinghills', 'icefloe', 'iceberg', 'seaice']);

/**
 * 邊界單元生成器：針對單一障礙物款式產出單一物件零件。
 * 邊界本體與緩衝區共用同一生成器，確保大小、顏色、風格、構件完全一致（單一縫）。
 * 物件尺寸嚴格採用標準遊戲空間真實尺寸，絕不故意放大。
 */
function generateBoundaryUnit(kind, { w, d, h, seed, season, water, layout, isBuffer = false }) {
  const def = WALL_KINDS[kind];
  const objKey = layout?.object || def?.object;

  if (objKey === 'wind' || kind.startsWith('wind')) {
    return linearEnvironmentParts(kind, { len: w, depth: d, h, seed, season });
  }
  if (objKey === 'solar' || kind.includes('solar')) {
    return linearEnvironmentParts(kind, { len: w, depth: d, h, seed, season });
  }
  if (objKey === 'aquaculture' || ['searanch', 'oysterracks'].includes(kind)) {
    return linearEnvironmentParts(kind, { len: w, depth: d, h, seed, season });
  }
  if (kind === 'deeprig') {
    return linearEnvironmentParts('deeprig', { len: w, depth: d, h, seed, season });
  }
  if (objKey === 'tank' || kind === 'tankfarm') {
    return storageTankParts({ w, d, h, seed });
  }
  if (objKey === 'truck' || kind === 'trucks') {
    const rnd = mulberry32(seed >>> 0);
    const crush = layout?.ruined ? (0.55 + rnd() * 0.35) : 1;
    const paint = layout?.ruined
      ? pick(rnd, [0x22201e, 0x332c28, 0x1a1918, 0x3f352e, 0x473d36, 0x2b2d30])
      : (seed ^ 0x74727563);
    const spec = VEHICLE_SPEC.truck;
    const fit = {
      L: Math.min(spec.L, w),
      H: Math.min(spec.H, h),
      W: Math.min(spec.W, d),
    };
    return makeSceneVehicleParts('truck', { fit, crush, paint });
  }
  if (objKey === 'train' || kind === 'train') {
    const rnd = mulberry32(seed >>> 0);
    const crush = layout?.ruined ? (0.65 + rnd() * 0.35) : 1;
    const paint = seed ^ 0x7261696c;
    const spec = VEHICLE_SPEC.railcar;
    const fit = {
      L: Math.min(spec.L, w),
      H: Math.min(spec.H, h),
      W: Math.min(spec.W, d),
    };
    return makeSceneVehicleParts('railcar', { fit, crush, paint });
  }
  if (objKey === 'car' || kind === 'car') {
    const rnd = mulberry32(seed >>> 0);
    const crush = layout?.ruined ? (0.55 + rnd() * 0.35) : 1;
    const paint = layout?.ruined
      ? pick(rnd, [0x22201e, 0x332c28, 0x1a1918, 0x3f352e, 0x473d36])
      : seed;
    const spec = VEHICLE_SPEC.sedan;
    const fit = {
      L: Math.min(spec.L, w),
      H: Math.min(spec.H, h),
      W: Math.min(spec.W, d),
    };
    return makeSceneVehicleParts('sedan', { fit, crush, paint });
  }
  if (objKey === 'viaduct' || kind === 'viaduct') {
    return linearEnvironmentParts('viaduct', { len: w, depth: d, h, seed, season });
  }
  if (objKey && ENVIRONMENT_OBJECTS[objKey]) {
    // 嚴格錨定正常物件世界標準尺寸，不可為了當障礙物就故意放大；
    // Row 0 位於權威碰撞柱內，維持軸向對齊(除外)，緩衝區才帶生成器朝向。
    const normalSize = environmentSize(objKey, seed);
    const unitSize = isBuffer
      ? normalSize
      : [Math.min(normalSize[0], w), Math.min(normalSize[1], h), Math.min(normalSize[2], d)];
    return environmentParts(objKey, { size: unitSize, seed, season, yaw: isBuffer });
  }
  return linearEnvironmentParts(kind, { len: w, depth: d, h, seed, season });
}

/**
 * 邊界障礙物與緩衝區物件的聯合批次生成器（唯一縫：同源管線、規格一致、排列連續、風格同批）。
 * 邊界本體（Row 0）坐落於碰撞盒內，緩衝區（Row 1..N）無縫銜接於其後。
 *
 * @returns {{ parts: Array, bufferParts: Array }}
 */
export function buildBoundaryRunParts(kind, {
  len, depth, bufferDepth = 0, h = 18, seed = 1, variant = 0, season = 'summer', water = false, biome = null, joins = null,
}) {
  const layout = BOUNDARY_BUFFER_LAYOUTS[kind];
  const def = WALL_KINDS[kind];
  const targetH = Math.max(h, def?.h || 18);
  if (!layout) {
    return {
      parts: wallParts(kind, { len, depth, h: targetH, seed, variant, season, joins }),
      bufferParts: [],
    };
  }

  const { mode, pitchX, pitchZ } = layout;
  const parts = [];
  const bufferParts = [];

  const { numCols, colStep, unitW, rowStep, unitD, maxBufferRows } =
    boundaryGrid({ len, depth, bufferDepth, pitchX, pitchZ });
  const totalRows = 1 + maxBufferRows; // Row 0 = boundary wall, Row 1..maxBufferRows = buffer fill

  if (layout.continuous) {
    // 連續組裝邊界障礙物：本體（Row 0）透過 wallParts 產生連續無縫長構造；
    // 城牆/河堤自身延伸時透過甕城/閘門連接；與非峭壁/土石流/崩塌地物件相接時建立甕城/閘門作為端點，兩端向緩衝區繼續鋪設
    const wallObstacleParts = wallParts(kind, { len, depth, h: targetH, seed, variant, season, joins });
    for (const p of wallObstacleParts) parts.push(p);

    if (kind === 'levee') {
      const hasGate = parts.some(p => p.role === 'gate-pier' || p.role === 'gate-leaf');
      if (!hasGate) {
        for (const endIdx of [0, 1]) {
          const j = joins ? joins[endIdx] : { kind: 'levee' };
          const jKind = j ? (j.kind || j) : null;
          if (jKind && NATURAL_CLIFF_KINDS.has(jKind)) continue;
          const isEndpoint = !jKind || jKind !== 'levee';
          parts.push(...leveeGateParts({ len, depth, h: targetH, seed: (seed ^ Math.imul(endIdx + 1, 0x5173)) >>> 0, endIdx, isEndpoint }));
        }
      }
    }

    // 端點兩端向緩衝區繼續鋪設 (citywall / levee)
    const endpointXs = [];
    if ((kind === 'citywall' || kind === 'levee') && bufferDepth > 0) {
      for (const endIdx of [0, 1]) {
        const j = joins ? joins[endIdx] : { kind };
        const jKind = j ? (j.kind || j) : null;
        if (jKind && NATURAL_CLIFF_KINDS.has(jKind)) continue;
        const isEndpoint = !jKind || jKind !== kind;
        if (!isEndpoint) continue; // 僅非自然岩體端點向緩衝區繼續鋪設
        const sign = endIdx === 0 ? -1 : 1;
        const ex = sign * (len / 2 - Math.min(5, len * 0.15));
        endpointXs.push(ex);

        const paveRows = Math.max(maxBufferRows, bufferDepth >= 8 ? 1 : 0);
        for (let r = 1; r <= paveRows; r++) {
          const stepD = maxBufferRows > 0 ? rowStep : Math.min(rowStep, bufferDepth);
          const v = Math.min(-depth / 2 - 1.0, -depth / 2 - (r - 0.5) * stepD);
          if (v < -depth / 2 - bufferDepth - 1e-4) continue;
          if (kind === 'citywall') {
            const bodyH = targetH * 0.68;
            bufferParts.push({
              g: ['box', 8, bodyH * 0.88, rowStep * 0.9],
              p: [ex, bodyH * 0.44, v],
              c: 0x989789,
              role: 'buffer-wall',
              boundaryBuffer: true,
            });
            bufferParts.push({
              g: ['box', 8.2, targetH * 0.018, rowStep * 0.92],
              p: [ex, bodyH * 0.5, v],
              c: 0x646d6b,
              role: 'course-joint',
              boundaryBuffer: true,
            });
            bufferParts.push({
              g: ['box', 1.6, targetH * 0.12, rowStep * 0.88],
              p: [ex - 2, bodyH * 0.88 + targetH * 0.06, v],
              c: 0x989789,
              role: 'battlement',
              boundaryBuffer: true,
            });
            bufferParts.push({
              g: ['box', 1.6, targetH * 0.12, rowStep * 0.88],
              p: [ex + 2, bodyH * 0.88 + targetH * 0.06, v],
              c: 0x989789,
              role: 'battlement',
              boundaryBuffer: true,
            });
          } else if (kind === 'levee') {
            bufferParts.push({
              g: ['box', 8, targetH * 0.55, rowStep * 0.92],
              p: [ex, targetH * 0.275, v],
              c: 0x8c9587,
              role: 'buffer-levee',
              boundaryBuffer: true,
            });
            bufferParts.push({
              g: ['box', 2.2, targetH * 0.62, rowStep * 0.92],
              p: [ex + sign * 2.8, targetH * 0.31, v],
              c: 0x78807d,
              role: 'wing-wall',
              boundaryBuffer: true,
            });
          }
        }
      }
    }

    const bioList = biome ? [biome] : (layout.bio || (water ? ['water'] : ['bare']));
    const candidateKinds = Object.keys(ENVIRONMENT_OBJECTS).filter(k =>
      ENVIRONMENT_OBJECTS[k].bio.some(b => bioList.includes(b)) && environmentAvailable(k)
    );
    const validCandidates = candidateKinds.length > 0 ? candidateKinds : ['boulder'];

    for (let r = 1; r <= maxBufferRows; r++) {
      const isStaggeredRow = mode === 'staggered' && (r % 2 === 1);
      const uOffset = isStaggeredRow ? (colStep * 0.5) : 0;

      for (let c = 0; c < numCols; c++) {
        let u = -len / 2 + (c + 0.5) * colStep + uOffset;
        if (u > len / 2 - colStep * 0.15) u -= (len - colStep * 0.3);

        if (endpointXs.some(ex => Math.abs(u - ex) < colStep * 0.75)) continue;

        const ptSeed = edgeSeed(Math.round((u + 500) * 8), Math.round((-r * rowStep + 500) * 8), (seed ^ Math.imul(r + 1, 0x1f1f) ^ Math.imul(c + 1, 0x9e37)) >>> 0);
        const rnd = mulberry32(ptSeed);

        const objKind = validCandidates[Math.floor(rnd() * validCandidates.length)];
        const normalSize = environmentSize(objKind, ptSeed);
        const [nw, nh, nd] = normalSize;

        const maxV = -depth / 2 - nd / 2 - 0.2;
        const v = Math.min(maxV, -depth / 2 - (r - 0.5) * rowStep);

        if (u - nw / 2 < -len / 2 - 2 || u + nw / 2 > len / 2 + 2) continue;
        if (v - nd / 2 < -depth / 2 - bufferDepth - 2) continue;

        const modelParts = environmentParts(objKind, { size: normalSize, seed: ptSeed, season });
        for (const p of modelParts) {
          const [px = 0, py = 0, pz = 0] = p.p || [];
          bufferParts.push({
            ...p,
            p: [px + u, py, pz + v],
            boundaryBuffer: true,
            role: p.role || 'boundary-buffer-fill',
          });
        }
      }
    }
    return { parts, bufferParts };
  }

  if (mode === 'random') {
    // 自然物件或荒廢破壞人造物：全區（邊界 + 緩衝區）一體化隨機散布與姿態旋轉
    for (let r = 0; r < totalRows; r++) {
      const isBuffer = r > 0;
      const baseV = r === 0 ? 0 : (-depth / 2 - (r - 0.5) * rowStep);
      for (let c = 0; c < numCols; c++) {
        const baseU = -len / 2 + (c + 0.5) * colStep;
        const ptSeed = edgeSeed(Math.round((baseU + 500) * 8), Math.round((baseV + 500) * 8), (seed ^ Math.imul(r + 1, 0x1f1f) ^ Math.imul(c + 1, 0x9e37)) >>> 0);
        const rnd = mulberry32(ptSeed);

        // Row 0 微小間距誤差（±0.02 colStep）：單元最寬 objW = 0.95 colStep，
        // 相鄰中心最小距離 0.96 colStep > 0.95 → 構造保證不重疊；僅翻轉款適用。
        const jitU = isBuffer ? (rnd() - 0.5) * colStep * 0.45
          : (ROW0_FLIP_KINDS.has(kind) ? (rnd() - 0.5) * colStep * 0.04 : 0);
        const jitV = isBuffer ? (rnd() - 0.5) * rowStep * 0.35 : 0;
        let u = baseU + jitU;
        let v = baseV + jitV;

        const objW = colStep * 0.95;
        const objD = (isBuffer ? rowStep : depth) * 0.92;
        const objH = targetH;

        if (u - objW / 2 < -len / 2 - 2 || u + objW / 2 > len / 2 + 2) continue;
        if (isBuffer && (v - objD / 2 < -depth / 2 - bufferDepth - 2)) continue;

        const modelParts = generateBoundaryUnit(kind, {
          w: objW, d: objD, h: objH, seed: ptSeed, season, water, layout, isBuffer,
        });

        // 隨機方向旋轉（Row 0 位於權威碰撞盒內：ROW0_FLIP_KINDS 採 180° 翻轉，
        // 全 360° 會讓件體突出碰撞柱；其餘款維持軸向對齊；緩衝區全 360 度隨機旋轉與傾覆）
        let yaw = 0;
        if (layout.randomYaw) {
          if (isBuffer) yaw = rnd() * Math.PI * 2;
          else if (ROW0_FLIP_KINDS.has(kind)) yaw = rnd() < 0.5 ? Math.PI : 0;
        }
        const cy = Math.cos(yaw), sy = Math.sin(yaw);

        for (const p of modelParts) {
          const [px = 0, py = 0, pz = 0] = p.p || [];
          const rx = yaw !== 0 ? (px * cy + pz * sy) : px;
          const rz = yaw !== 0 ? (-px * sy + pz * cy) : pz;
          const rRot = p.r ? [p.r[0], (p.r[1] || 0) + yaw, p.r[2]] : (yaw !== 0 ? [0, yaw, 0] : undefined);
          const outPart = {
            ...p,
            p: [rx + u, py, rz + v],
            ...(rRot ? { r: rRot } : {}),
            ...(isBuffer ? { boundaryBuffer: true, role: p.role || 'boundary-buffer-fill' } : {}),
          };
          if (isBuffer) {
            delete outPart.motion;
            bufferParts.push(outPart);
          } else {
            parts.push(outPart);
          }
        }
      }
    }
  } else {
    // 正常人造物件：整齊排列（矩陣 grid 或交錯 staggered），邊界（Row 0）與緩衝區（Row 1..N）鎖入同一網格
    for (let r = 0; r < totalRows; r++) {
      const isBuffer = r > 0;
      const v = r === 0 ? 0 : (-depth / 2 - (r - 0.5) * rowStep);
      const isStaggeredRow = mode === 'staggered' && (r % 2 === 1);
      const uOffset = isStaggeredRow ? (colStep * 0.5) : 0;

      for (let c = 0; c < numCols; c++) {
        let u = -len / 2 + (c + 0.5) * colStep + uOffset;
        if (u > len / 2 - colStep * 0.15) u -= (len - colStep * 0.3);

        const ptSeed = edgeSeed(Math.round((u + 500) * 8), Math.round((v + 500) * 8), (seed ^ Math.imul(r + 1, 0x1f1f) ^ Math.imul(c + 1, 0x9e37)) >>> 0);

        if (u - unitW / 2 < -len / 2 - 2 || u + unitW / 2 > len / 2 + 2) continue;
        if (isBuffer && (v - unitD / 2 < -depth / 2 - bufferDepth - 2)) continue;

        const modelParts = generateBoundaryUnit(kind, {
          w: unitW, d: unitD, h: targetH, seed: ptSeed, season, water, layout, isBuffer,
        });

        for (const p of modelParts) {
          const [px = 0, py = 0, pz = 0] = p.p || [];
          const outPart = {
            ...p,
            p: [px + u, py, pz + v],
            ...(p.motion ? { motion: { ...p.motion,
              pivot: [p.motion.pivot[0] + u, p.motion.pivot[1], p.motion.pivot[2] + v],
              id: `${r}_${c}_${p.motion.id}`,
            } } : {}),
            ...(isBuffer ? { boundaryBuffer: true, role: p.role || 'boundary-buffer-fill' } : {}),
          };
          if (isBuffer) {
            delete outPart.motion;
            bufferParts.push(outPart);
          } else {
            parts.push(outPart);
          }
        }
      }
    }
  }

  return { parts, bufferParts };
}

/** 取緩衝空間物件的零件表（委派至 buildBoundaryRunParts 確保同源一致性） */
export function buildBoundaryBufferParts(kind, opts) {
  return buildBoundaryRunParts(kind, opts).bufferParts;
}

// ============ 緩衝空間的 3D 物件(使用者原話:「加入少許 3D 物件」)============
// 緩衝空間本身是 `terrain.js` 那一圈外緣裙(貼地貌拼圖那一半住在那裡);這裡只管「擺什麼」。
// 三條:①**格子 + 雜湊抖動**(不是亂數序列)⇒ 零共享消耗、跨客戶端逐位元一致;
//      ②**只擺在地形範圍之外**(內域是真地形,擺進去會跟真植被互穿);
//      ③**離得越遠擺得越大**(近處小樹 / 遠處大林),不然 400m 外的 8m 樹是一個像素。
export const PROP_KINDS = {
  grove:   { bio: ['green', 'wet'] },   // 林塊
  boulder: { bio: ['bare'] },           // 岩塊
  hamlet:  { bio: ['urban'] },          // 聚落
  islet:   { bio: ['water'] },          // 礁岩/浮標
};

const PROP_PARTS = {
  grove: (rnd) => environmentParts('gianttree', { size: [18, 28, 18], seed: Math.floor(rnd() * 0x10000000) }),
  boulder: (rnd) => environmentParts('boulder', { size: [14, 12, 14], seed: Math.floor(rnd() * 0x10000000) }),
  hamlet: (rnd) => environmentParts('house', { size: [12, 10, 10], seed: Math.floor(rnd() * 0x10000000) }),
  islet: (rnd) => environmentParts('boulder', { size: [16, 10, 16], seed: Math.floor(rnd() * 0x10000000) }),
};

/** 地貌 → 緩衝空間物件款(找不到就用岩塊墊底) */
export const propKindFor = (biome) => Object.keys(PROP_KINDS).find((k) => PROP_KINDS[k].bio.includes(biome)) || 'boulder';

/** 取一件緩衝空間物件的零件表 */
export function propParts(kind, seed = 1) {
  const fn = PROP_PARTS[kind] || PROP_PARTS.boulder;
  return fn(mulberry32((seed * 2246822519) >>> 0));
}

/**
 * 緩衝空間物件的落點規劃(唯一縫;純幾何、零亂數序列、零 THREE)。
 * 走一張覆蓋「地形方框 + 緩衝深度」的方格,格心以雜湊抖動 ±`PROP_JIT`,
 * 落在地形方框之內的一律略過(那是真地形的地盤)。
 *
 * @param probe (x, z) => 'urban'|'green'|'bare'|'water'|'wet' —— 呼叫端夾回圖界後取樣
 */
export function planBufferProps({ minX, maxX, minZ, maxZ, buffer, probe, step = EDGE_WALL.PROP_STEP_M, margin = 30 }) {
  const out = [];
  const x0 = minX - buffer, x1 = maxX + buffer, z0 = minZ - buffer, z1 = maxZ + buffer;
  const nx = Math.max(1, Math.round((x1 - x0) / step)), nz = Math.max(1, Math.round((z1 - z0) / step));
  const sx = (x1 - x0) / nx, sz = (z1 - z0) / nz;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const cx = x0 + (i + 0.5) * sx, cz = z0 + (j + 0.5) * sz;
      const seed = edgeSeed(cx, cz, 0x5B);
      const r = mulberry32(seed);
      if (r() > EDGE_WALL.PROP_KEEP) continue;
      const x = cx + (r() - 0.5) * sx * EDGE_WALL.PROP_JIT * 2;
      const z = cz + (r() - 0.5) * sz * EDGE_WALL.PROP_JIT * 2;
      // 內域留給真地形;還要多讓一圈 `margin` —— 一叢林塊的外圍零件散得比落點遠得多,
      // 貼著圖界擺的話樹會伸進可玩區裡(而它沒有碰撞柱 ⇒ 看得見、穿得過、打不到)
      if (x > minX - margin && x < maxX + margin && z > minZ - margin && z < maxZ + margin) continue;
      const biome = probe(x, z) || 'bare';
      // 離圖界越遠擺越大(視角補償):1× ~ 2.4×
      const d = Math.max(0, Math.max(minX - x, x - maxX, minZ - z, z - maxZ, 0));
      out.push({
        x, z, seed, kind: propKindFor(biome), biome,
        s: (0.9 + r() * 0.6) * (1 + (d / Math.max(1, buffer)) * 1.4),
        ry: r() * Math.PI * 2,
      });
    }
  }
  return out;
}

// ============ 視線邊界的背景(使用者原話:「空氣牆貼上假山/假海/假森林/假城市」)============
// 落在緩衝深度的 `BACK_INSET_F` 上(留一截裙在腳下,不然背景像浮在世界邊緣);
// 逐段取**最近的圖界點**的地貌決定貼哪一種 —— 海邊那一側是假海、市區那一側是假城市。
// `hF` = 高度佔 `objHeightMax()` 的比例(呼叫端傳上限進來;與建物/地標同一個天花板 ⇒
// 背景永遠構不到世界天花板,飛行機體也永遠飛不到這裡,兩件事各自成立)。
export const BACKDROP_KINDS = {
  mountain: { bio: ['bare'], hF: 1.0 },
  forest:   { bio: ['green', 'wet'], hF: 0.34 },
  city:     { bio: ['urban'], hF: 0.6 },
  sea:      { bio: ['water'], hF: 0.14 },
};

// 邊界山脈四季雪線高度比例（佔最高天花板 H 的比例；夏天無雪）
export const MOUNTAIN_SNOWLINE = {
  spring: 0.74,  // 春季雪線：高海拔積雪（山頂 26% 覆雪）
  summer: 1.0,   // 夏季無雪：雪線在山頂之上（0% 覆雪）
  autumn: 0.80,  // 秋季初雪：最高峰頂積雪（山頂 20% 覆雪）
  winter: 0.52,  // 冬季雪線：雪線大幅下降至中高海拔（山頂 48% 覆雪）
};

/** 地貌 → 背景款 */
export const backdropKindFor = (biome) => Object.keys(BACKDROP_KINDS).find((k) => BACKDROP_KINDS[k].bio.includes(biome)) || 'mountain';

function backdropCluster(kind, len, h, rnd, season) {
  return rep(len, Math.max(8, h * .7), (x, step) => environmentParts(kind, {
    size: [step * .94, h * (.55 + rnd() * .45), Math.max(1, h * .65)],
    seed: Math.floor(rnd() * 0x100000000), season,
  }).map(p => ({ ...p, p: [p.p[0] + x, p.p[1], p.p[2]] })));
}

const BACKDROP_PARTS = {
  // 假山:兩排錯開的山稜(後排高、前排矮)+ 稜線上的雪/裸岩帶
  // 雪線高度隨季節變化(夏天無雪);雪錐底面半徑嚴格由山稜斜率等比推導,頂點與山頂對齊,不外突也不懸空
  mountain: (len, H, rnd, season = 'summer') => {
    const snowLineF = MOUNTAIN_SNOWLINE[season] ?? MOUNTAIN_SNOWLINE.summer;
    const ySnow = H * snowLineF;
    return [
      ...rep(len, H * 0.62, (x, s) => {
        const h = H * (0.62 + rnd() * 0.38);
        const rBase = s * 0.78;
        const parts = [
          { g: ['cone', rBase, h, 5], c: pick(rnd, [0x5c6470, 0x525a66, 0x666e79]), p: [x, h / 2, -H * 0.18] },
        ];
        // 峰頂超過季節雪線才覆雪(夏天 ySnow = H ⇒ h <= ySnow 故無雪)
        if (h > ySnow) {
          const hs = h - ySnow;
          // 斜率嚴格等比(rSnow / hs ≈ rBase / h),微量 1.01 避免 WebGL 共面 Z-fighting
          const rSnow = rBase * (hs / h) * 1.01;
          const py = h - hs / 2;
          parts.push({ g: ['cone', rSnow, hs, 5], c: 0xd8dee4, p: [x, py, -H * 0.18] });
        }
        return parts;
      }),
      ...rep(len, H * 0.44, (x, s) => {
        const h = H * (0.3 + rnd() * 0.3);
        return [{ g: ['cone', s * 0.8, h, 5], c: pick(rnd, [0x4c5647, 0x566151, 0x445040]), p: [x, h / 2, H * 0.12] }];
      }),
    ];
  },
  // Distant silhouettes use the same species/building/rock constructors as the scene.
  forest: (len, H, rnd, season) => backdropCluster('gianttree', len, H, rnd, season),
  city: (len, H, rnd, season) => backdropCluster('skyscraper', len, H, rnd, season),
  sea: (len, H, rnd, season) => backdropCluster('boulder', len, H, rnd, season),
};

/** 取一段背景的零件表(局部座標:x = 沿邊、y = 由地面往上、z = 厚度方向) */
export function backdropParts(kind, { len, h, seed = 1, season = 'summer' }) {
  const fn = BACKDROP_PARTS[kind] || BACKDROP_PARTS.mountain;
  return fn(len, h, mulberry32((seed * 3266489917) >>> 0), season);
}

/**
 * 背景環的分段規劃(唯一縫;純幾何、零亂數序列、零 THREE)。
 * 四條邊各自往外推 `buffer × BACK_INSET_F`,以 `BACK_SEG_M` 切段;每段的款式由**最近的
 * 圖界點**的地貌決定(呼叫端的 probe 已夾回圖界)。`ry` 只取 0 / π/2(同障礙環,A30 的
 * 正負號坑天生不存在)。
 */
export function planBackdrop({ minX, maxX, minZ, maxZ, buffer, probe, segM = EDGE_WALL.BACK_SEG_M }) {
  const off = buffer * EDGE_WALL.BACK_INSET_F;
  const out = [];
  const edges = [
    { ax: 1, x0: minX - off, x1: maxX + off, at: minZ - off, ry: 0, ez: minZ },
    { ax: 1, x0: minX - off, x1: maxX + off, at: maxZ + off, ry: 0, ez: maxZ },
    { ax: 0, z0: minZ - off, z1: maxZ + off, at: minX - off, ry: Math.PI / 2, ex: minX },
    { ax: 0, z0: minZ - off, z1: maxZ + off, at: maxX + off, ry: Math.PI / 2, ex: maxX },
  ];
  for (const e of edges) {
    const lo = e.ax ? e.x0 : e.z0, hi = e.ax ? e.x1 : e.z1;
    const n = Math.max(1, Math.round((hi - lo) / segM));
    const step = (hi - lo) / n;
    for (let i = 0; i < n; i++) {
      const d = lo + (i + 0.5) * step;
      const x = e.ax ? d : e.at, z = e.ax ? e.at : d;
      // 最近的圖界點(夾回方框)= 這一段背後是什麼地貌
      const px = Math.min(maxX, Math.max(minX, x)), pz = Math.min(maxZ, Math.max(minZ, z));
      const kind = backdropKindFor(probe(px, pz) || 'bare');
      out.push({ x, z, ry: e.ry, len: step, kind, seed: edgeSeed(x, z, 0xB4) });
    }
  }
  return out;
}
