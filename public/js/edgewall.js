// ============ 邊界牆型錄 / 緩衝空間布景 / 視線邊界背景(唯一縫)============
// 2026-08-11 使用者定案(原話):
//   「邊界牆使用城牆/連排民房/河堤/海堤/軍工級路障/土石流/懸崖峭壁/山崩地/消波塊/倒塌神木/
//     倒塌摩天樓/倒塌高架橋或跨海大橋/停駛的列車/連排大貨車/連排貨輪等等,地貌切換或太長的
//     時候,會隨機更換符合地貌與水陸域的牆。邊界延伸不可進入的緩衝空間也要貼地貌拼圖,並加入
//     少許 3D 物件。視線邊界的空氣牆貼上假山/假海/假森林/假城市(視陸域或水域而定)。」
//
// 舊制(2026-08-10)的障礙環是**一圈灰盒子**:結構上完美(沒有縫、看到多粗 = 撞到多粗),
// 視覺上是一條 40m 外的水泥帶。本檔把「這一段牆長什麼樣」變成型錄查表,而**環的權威幾何
// 一格未動** —— 段位、沿邊覆蓋、內緣貼夾制線、四角互相跨過,全部照舊(見 `biomes.js
// buildEdgeWall` 檔頭與 `audit_world_edge` Ⅱ)。
//
// ---- 六條紀律(每一條壞掉都沒有錯誤訊息)----
//  ① **零 import(除 `rng.js`)、零 THREE**:型錄是**純資料**,零件表是 `['box', w,h,d]` 這種
//     描述子(同 `beacons.js` 紀律③)。這才是本項能離線稽核的原因 —— three 走 CDN、A2 不准進
//     `package.json`,零件若寫成 `new THREE.Mesh(...)`,「這款牆有沒有頂出碰撞盒」就只能靠
//     真瀏覽器看,而那正是會靜默壞掉的一半。
//  ② **零共享 `rnd()` 消耗**(§2.3):「隨機更換」的隨機一律由**座標雜湊**餵一條自己的
//     `mulberry32`。抽一枚共享亂數就把後面每一株植被、每一棟建物的佈局整條推移,而畫面上
//     只表現成「整張圖變了」。
//  ③ **演出 ⊆ 碰撞盒**(原則 4 / A30):每一款宣告 `depth`/`h`,零件表 MUST 整份收在
//     「段長 × depth × h」這個盒子裡 —— 三軸都要,**縱向尤其**:碰撞盒只到 h,而視覺若更高,
//     從上方斜射進緩衝空間的彈道會穿過看得見的船樓/塔頂而伺服器毫無所悉(= 看得見卻打不到)。
//     反過來,盒子的**內面**(朝可玩區那一面)MUST 被實體零件蓋滿到本體實際阻擋高度,否則就是
//     「撞到空氣」。一般款量到機體視線高；低矮設施用資料列 `faceH` 明列自身高度，MUST NOT
//     為了撐滿量測帶另加底座／圍牆。兩方向由 `wallFit()` / `wallFaceCover()` 雙向釘死。
//  ④ **深度是真實尺寸,邊界帶跟著讓開**:貨輪 18m、懸崖 14m —— §2.5 說得很清楚,載具/建物
//     一律用真實公稱尺寸。碰撞盒的**內面恆貼夾制線**、厚度往圖界方向長,故邊界帶的內緣
//     (`placeBoundary` 的 IN1)MUST 吃 `edgeWallDeepM()` 而不是 `WALL_T` —— 手寫的話深型牆
//     會長進邊界樓群裡。
//  ⑤ **切分規則只有一條**:`地貌/水陸域改變` 或 `這一款已經連續鋪了 RUN_MAX_M`。前者讓牆跟著
//     地面走(海邊出現消波塊、市區出現連排民房),後者防「一整條邊三公里同一款」。衛星色是
//     **逐段抖動**的 ⇒ 短於 `RUN_MIN_SEG` 節的 run MUST 併回前一段,不然一條邊會碎成城牆/
//     民房/城牆/民房的雜訊(症狀不是壞掉,是看起來很廉價)。
//  ⑥ **緩衝空間與背景是純表現層**:兩者都在夾制線之外、玩家永遠到不了 ⇒ 不進 `blockers`、
//     不進 `occ`、不進 LOS,伺服器對這一整套一無所知(原則 4)。它們唯一的職責是「往外看
//     不是虛空」。
import { mulberry32 } from './rng.js';
import { makeVehicle, partAABB } from './vehicles.js';

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

// ---- 坡度分級(2026-08-11 使用者追加:「太陡的時候只使用懸崖峭壁/土石流/山崩這類自然
//      景觀,中等坡度可以再加上倒木/長城」)----
// 門檻**推導不手寫**,而且刻意錨在既有的兩條線上(`data.js SLOPE`,由呼叫端注入 —— 本檔
// 維持零 import,見紀律①)。兩條線本來就有精確的遊戲語意,分級因此不是美術偏好而是物理:
//   `flat`  ≤ `EASE_DEG`  平緩帶 = 兵線走廊恆全速的那一帶 ⇒ 現實裡也就是**修得起路的坡**,
//                          鐵路/貨車/連排民房/高架橋這些線形人造物只有在這裡才立得住;
//   `mid`   ≤ `BLOCK_DEG` 機體還爬得上去但路修不上去 ⇒ 只剩「順著地形長出來的東西」:
//                          自然三款 + **倒塌神木**(樹本來就長在坡上)+ **城牆**(長城正是
//                          沿著山稜蓋的,那是它唯一合理的位置);
//   `steep` > `BLOCK_DEG`  機體爬不上去的崖面 ⇒ **只准自然景觀**:懸崖峭壁 / 土石流 / 山崩地。
// 逐款的 `slope` 欄 = 「這一款最陡站得到哪一級」,故 `steep` 款在三級都合法(自然景觀擺在
// 緩坡上不突兀,反過來把貨櫃車擺上崖面則當場穿幫)。
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
  skyfall:   { dom: 'land',  bio: ['urban'],                  slope: 'flat',  depth: 16,  h: 26,   label: '倒塌摩天樓' },
  viaduct:   { dom: 'land',  bio: ['urban', 'wet'],           slope: 'flat',  depth: 13,  h: 14,   label: '倒塌高架橋' },
  levee:     { dom: 'land',  bio: ['wet', 'green'],           slope: 'flat',  depth: 12,  h: 8,    label: '河堤' },
  // `faceDeg` 是岩壁剖面的真實傾角範圍(相對水平)，幾何仍受同一個 depth/h 包絡約束。
  cliff:     { dom: 'land',  bio: ['bare'],                   slope: 'steep', depth: 18,  h: 30,   label: '懸崖峭壁', faceDeg: [60, 90] },
  landslide: { dom: 'land',  bio: ['bare', 'green'],          slope: 'steep', depth: 16,  h: 18,   label: '山崩地' },
  debris:    { dom: 'land',  bio: ['bare', 'green', 'wet'],   slope: 'steep', depth: 16,  h: 10,   label: '土石流' },
  fallentree:{ dom: 'land',  bio: ['green'],                  slope: 'mid',   depth: 9,   h: 9,    label: '倒塌神木' },
  // ---- 水域 ----(水面恆是平的 ⇒ 水域段的分級一律 flat,見 `planWallRuns`)
  seawall:   { dom: 'water', bio: ['water'],                  slope: 'flat',  depth: 10,  h: 8,    label: '海堤' },
  tetrapod:  { dom: 'water', bio: ['water'],                  slope: 'flat',  depth: 12,  h: 9.2,  label: '大型消波塊層層堆疊' },
  ship:      { dom: 'water', bio: ['water'],                  slope: 'flat',  depth: 18,  h: 22,   label: '連排貨輪' },
  // ---- 大型邊界設施(同族共用生成器；水域款直接落水，不借用海堤／擋土平台)----
  windsea:      { dom: 'water', bio: ['water'], slope: 'flat', depth: 16, h: 28, label: '海上風機陣列', family: 'wind', mount: 'fixed', col: [0xd9dde0, 0x70808c] },
  floatsolar:   { dom: 'water', bio: ['water'], slope: 'flat', depth: 16, h: 9,  faceH: 1.7, label: '浮動式太陽能板陣列', family: 'solar', mount: 'float', col: [0x244b73, 0x6b8799] },
  searanch:     { dom: 'water', bio: ['water'], slope: 'flat', depth: 16, h: 12, label: '海上牧場（網箱／圍網／貝類長線）', family: 'ranch', mount: 'float', col: [0x3f6f7a, 0xc28c38] },
  deeprig:      { dom: 'water', bio: ['water'], slope: 'flat', depth: 18, h: 28, label: '深海油井', family: 'extract', mount: 'float', col: [0xd07a32, 0x596168] },
  windland:     { dom: 'land',  bio: ['bare', 'green'], slope: 'flat', depth: 14, h: 28, label: '陸域風機陣列', family: 'wind', col: [0xe1e4e4, 0x69747c] },
  solarfield:   { dom: 'land',  bio: ['bare'], slope: 'flat', depth: 14, h: 14, faceH: 1.7, label: '太陽能板陣列', family: 'solar', col: [0x243f63, 0x777b70] },
  mine:         { dom: 'land',  bio: ['bare'], slope: 'flat', depth: 18, h: 20, label: '大型礦場', family: 'extract', col: [0xb88a3d, 0x786c5d] },
  oilfield:     { dom: 'land',  bio: ['bare'], slope: 'flat', depth: 16, h: 18, label: '陸上油井', family: 'extract', col: [0x86583f, 0x555c62] },
  ranch:        { dom: 'land',  bio: ['green'], slope: 'flat', depth: 14, h: 14, label: '大型畜牧場', family: 'ranch', col: [0x8e7652, 0x6b7a4b] },
  greenhouse:   { dom: 'land',  bio: ['green'], slope: 'flat', depth: 14, h: 14, label: '大型溫室', family: 'greenhouse', col: [0xa9c7bf, 0x6a8a78] },
  factory:      { dom: 'land',  bio: ['urban'], slope: 'flat', depth: 18, h: 24, label: '大型工廠', family: 'industry', mix: 'industry', variants: 3, separated: true, col: [0x7b8790, 0xb0653e] },
  powerplant:   { dom: 'land',  bio: ['urban'], slope: 'flat', depth: 18, h: 28, label: '大型電廠', family: 'industry', mix: 'industry', variants: 3, separated: true, col: [0x69747c, 0x9a8f72] },
  incinerator:  { dom: 'land',  bio: ['urban'], slope: 'flat', depth: 18, h: 30, label: '大型焚化爐', family: 'industry', mix: 'industry', variants: 3, separated: true, col: [0x727c82, 0xb46b3f] },
  skyscrapers:  { dom: 'land',  bio: ['urban'], slope: 'flat', depth: 18, h: 34, label: '摩天大樓群', family: 'highrise', mix: 'urban-building', variants: 3, separated: true, col: [0x64717d, 0x8ca0ad] },
  oysterracks:  { dom: 'land',  bio: ['wet'], slope: 'flat', depth: 14, h: 14, label: '蚵棚', family: 'wetland', col: [0x665541, 0x9caa9e] },
  strandedship:{ dom: 'land',  bio: ['wet'], slope: 'flat', depth: 18, h: 18, label: '擱淺船隻', family: 'wreck', variants: 3, separated: true, col: [0x5b6970, 0x8a4f3e] },
  wetpods:      { dom: 'land',  bio: ['wet'], slope: 'flat', depth: 16, h: 14, label: '大型消波塊層層堆疊', family: 'pods', col: [0x969a9b, 0x777c7d] },
};

// 同類設施可在一個地貌 run 內交錯；這是「可混排」名冊，不是生成器家族。
// 住商與工業刻意分組，避免只因都在 urban 就把電廠插進連排住宅。
export const WALL_MIX_GROUPS = {
  industry: ['factory', 'powerplant', 'incinerator'],
  'urban-building': ['rowhouse', 'skyscrapers'],
};

/** 這一款站得到這一級坡上嗎(`slope` 是**上界**:自然景觀在三級都合法) */
const fitsTier = (k, tier) => tierRank(WALL_KINDS[k].slope) >= tierRank(tier);
/** 這一款吃得下這個(地貌, 水陸域)嗎 */
const kindFits = (k, biome, water) => {
  const d = WALL_KINDS[k];
  if (!d) return false;
  if (water) return d.dom === 'water';
  return d.dom === 'land' && d.bio.includes(biome);
};

/**
 * (地貌, 水陸域, 坡度級)→ 候選款式清單(**排序恆定**,`Object.keys` 的宣告序)。
 *
 * **坡度是硬門檻、地貌是偏好**:陡坡上配不到符合地貌的自然景觀時(例如「陡的市區」),
 * 退回「這一級全部合法的款」而**不是**退回平地款 —— 那一步走錯就是貨櫃車掛在崖面上,
 * 而畫面之外的每一條斷言都還是綠的。一款都配不到才回最通用那一款(原則 6:降級不例外)。
 */
export function wallCandidates(biome, water, tier = 'flat') {
  const byTier = Object.keys(WALL_KINDS).filter((k) => fitsTier(k, tier));
  const list = byTier.filter((k) => kindFits(k, biome, water));
  if (list.length) return list;
  if (byTier.length) return byTier;
  return water ? ['seawall'] : ['barricade'];
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
    const cand = wallCandidates(r.biome, r.water, r.tier);
    const s = segs[r.i0];
    let idx = edgeSeed(s.x, s.z, r.i0) % cand.length;
    if (cand.length > 1 && cand[idx] === prevKind) idx = (idx + 1) % cand.length;
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
const zIn = (D, d, back = 0) => D / 2 - d / 2 - back;
/** 從一組色票裡挑一個(確定性) */
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
/**
 * 落石/土塊:**半徑先抽、位置再由半徑推**(紀律③)。
 * 反過來寫(先定位置再抽半徑)是這一族最常見的頂出方式 —— 大顆的那幾次就穿出盒頂或盒底,
 * 而它只在某些種子上發生 ⇒ 看一張圖是看不出來的。
 */
const rock = (rnd, x, D, H, rmin, rmax, c, backMax = 0, role = 'rock') => {
  const r = rmin + rnd() * (rmax - rmin);
  return {
    g: ['ico', r], c,
    p: [x, r + rnd() * Math.max(0, H - 2 * r), zIn(D, 2 * r, rnd() * backMax)],
    role,
  };
};
/**
 * 斷木:沿邊躺著(`rz = π/2`)、只加**小幅** yaw。長軸躺平後吃的是 x 方向的餘裕 ⇒ 落點
 * 一律收在 `len × spanF` 之內,MUST NOT 塞進 `rep()`(那會把它擺到最後一節的中心,長軸一半
 * 直接伸出段外)。
 */
const log = (rnd, len, D, y, c, lmin, lmax, spanF = 0.55, role = 'deadwood') => {
  const L = lmin + rnd() * (lmax - lmin), r = 0.34 + rnd() * 0.22;
  return {
    g: ['cyl', r, r * 0.72, L, 5], c,
    p: [(rnd() - 0.5) * len * spanF, y, zIn(D, 2 * (0.35 * L / 2 + r), rnd() * 2)],
    r: [0, (rnd() - 0.5) * 0.7, Math.PI / 2],
    role,
  };
};

// 懸崖上的枯木不是水平擺件：以自身半徑先算出可用厚度，再把木幹斜向崖內收。
const cliffDeadwood = (rnd, len, D, H) => {
  const L = 4.8 + rnd() * 2.4, r = 0.3 + rnd() * 0.16;
  const tilt = 0.58 + rnd() * 0.28;
  const zExt = Math.sin(tilt) * L / 2 + Math.cos(tilt) * r;
  const yExt = Math.cos(tilt) * L / 2 + Math.sin(tilt) * r;
  return {
    g: ['cyl', r, r * 0.68, L, 5], c: pick(rnd, [0x5d4c38, 0x6b5a42, 0x4e4233]),
    p: [
      (rnd() - 0.5) * len * 0.42,
      Math.min(H - yExt - 0.2, H * (0.52 + rnd() * 0.2)),
      D / 2 - zExt - 0.2,
    ],
    r: [-tilt, (rnd() - 0.5) * 0.18, (rnd() - 0.5) * 0.16],
    role: 'embedded-deadwood',
    slopeDown: true,
  };
};

const PARTS = {
  // 城牆:收分基座 → 牆身 → 走道緣 → 雉堞,再依雜湊給這一節一座**構造**
  // (2026-08-11 使用者追加「城牆也加上城門/城樓/砲台等結構(不會攻擊)」):
  //   `gate`  城門 + 城樓:門洞 + **緊閉的雙扇門** + 拱券 + 上方兩層樓身與歇山頂(最高,到 H)
  //   `bat`   砲台:牆頂加寬的台體 + 垛口 + 三門朝外的砲(**純擺設**)+ 彈藥堆
  //   `arrow` 箭樓:馬面加高成帶箭窗的方樓 + 攢尖頂
  //   其餘    素牆(只有馬面)
  // **門一定是關著的**:開一個真的洞在這裡就是「看得穿卻走不過」——`wallFaceCover` 正是
  // 為這件事訂的門檻,而邊界本來就不該有出口。砲是幾何,不是實體:`buildEdgeWall` 只碰
  // `group` 與 `blockers`,不進任何單位/實體清單 ⇒「不會攻擊」是**構造保證**不是設定值。
  // 牆身只長到 `H × WALL_F`,剩下的高度留給構造 —— 而碰撞盒是**逐段實測**的(見 biomes.js),
  // 素牆那幾節不會因為型錄宣告了 14m 就多出一截撞得到卻看不見的空氣。
  citywall: (len, D, H, rnd) => {
    const WALL_F = 0.64;
    const wh = H * WALL_F;                       // 牆身(含雉堞)頂
    const bodyH = wh * 0.76, capY = wh * 0.86;
    const feat = rnd();
    const stone = [0x9a9184, 0x958c7f, 0xa0978a];
    const base = [
      { g: ['box', len, wh * 0.1, D], c: 0x8b8276, p: [0, wh * 0.05, 0] },
      { g: ['box', len, bodyH, D * 0.86], c: pick(rnd, stone), p: [0, wh * 0.1 + bodyH / 2, zIn(D, D * 0.86)] },
      { g: ['box', len, wh * 0.06, D], c: 0xa79d8f, p: [0, capY - wh * 0.03, 0] },
      ...rep(len, 2.6, (x, s) => [
        { g: ['box', s * 0.58, wh * 0.14, D * 0.66], c: 0xa79d8f, p: [x, capY + wh * 0.07, zIn(D, D * 0.66)] },
      ]),
      // 石紋:三道深色橫縫,貼在內面上(牆身退在後面 0.35m,故 z 用內面推)
      ...[0.28, 0.5, 0.7].map((f) => (
        { g: ['box', len, 0.16, 0.12], c: 0x7d7568, p: [0, wh * f, zIn(D, 0.12)] })),
    ];
    // ---- 城門 + 城樓 ----
    if (feat < 0.26) {
      const gw = Math.min(9, len * 0.4);          // 門洞外框寬
      const dh = wh * 0.62, dw = gw * 0.24;       // 門扇高 / 單扇寬
      const tw = Math.min(len * 0.46, gw + 2);    // 樓身寬
      const eave = H * 0.92, ridge = H;           // 簷線 / 屋脊(頂**恰在** H)
      const roofT = 0.34, roofD = D * 0.42, RT = 0.5;
      return [
        ...base,
        { g: ['box', gw, wh * 0.8, D], c: 0x8f8779, p: [0, wh * 0.4, 0] },                    // 門座
        { g: ['box', gw * 0.72, dh * 1.08, 0.5], c: 0x5b544a, p: [0, dh * 0.54, zIn(D, 0.5)] }, // 門洞(內凹深色)
        ...[-1, 1].map((sd) => (                                                              // 緊閉的雙扇門
          { g: ['box', dw, dh, 0.34], c: 0x6b4f36, p: [sd * dw * 0.52, dh / 2, zIn(D, 0.34, 0.16)] })),
        ...[-1, 1].flatMap((sd) => [0.3, 0.55, 0.8].map((f) => (                               // 門釘
          { g: ['ico', 0.11], c: 0x8d949c, p: [sd * dw * 0.52, dh * f, zIn(D, 0.22, 0.16)] }))),
        { g: ['cyl', gw * 0.36, gw * 0.36, 0.44, 9], c: 0x8b8276, p: [0, dh, zIn(D, 0.44, 0.1)], r: [Math.PI / 2, 0, 0] }, // 拱券
        { g: ['box', gw * 0.86, 0.5, D * 0.96], c: 0xa79d8f, p: [0, dh + gw * 0.36 + 0.25, 0] },  // 門楣
        // 城樓:台基 → 樓身(柱與窗)→ 腰簷 → 歇山頂
        { g: ['box', tw + 1.2, wh * 0.08, D], c: 0xa79d8f, p: [0, wh + wh * 0.04, 0] },
        { g: ['box', tw, H * 0.2, D * 0.8], c: 0xb4a893, p: [0, wh + wh * 0.08 + H * 0.1, zIn(D, D * 0.8)] },
        ...rep(tw, 2.4, (x, s) => [
          { g: ['box', 0.34, H * 0.19, 0.34], c: 0x7a5f4b, p: [x, wh + wh * 0.08 + H * 0.1, zIn(D, 0.34)] },
          { g: ['box', s * 0.52, H * 0.1, 0.22], c: 0x4a4238, p: [x, wh + wh * 0.08 + H * 0.12, zIn(D, 0.22)] },
        ]),
        { g: ['box', tw + 1.6, 0.32, D * 0.94], c: 0x7a6352, p: [0, eave - H * 0.13, 0] },     // 腰簷
        { g: ['box', tw + 1.4, 0.4, D * 0.96], c: 0x7a6352, p: [0, eave, 0] },                 // 簷板
        ...[1, -1].map((sd) => ({                                                              // 兩坡頂
          // 縱向半徑先算(傾斜件的高度是板長投影出來的)⇒ 頂**恰在**屋脊;
          // 拿 (簷+脊)/2 當中心是「看起來差不多」,而它會把屋頂疊出宣告高度之外
          g: ['box', tw + 1.0, roofT, roofD / Math.cos(RT)], c: 0x6f5b4c,
          p: [0, ridge - (Math.cos(RT) * roofT / 2 + Math.sin(RT) * roofD / (2 * Math.cos(RT))), (sd * roofD) / 2],
          r: [sd * RT, 0, 0],
        })),
        { g: ['box', tw + 1.0, 0.34, 0.6], c: 0x5f4d40, p: [0, ridge - 0.17, 0] },             // 屋脊
        ...[-1, 1].map((sd) => (                                                               // 脊獸(小方塊)
          { g: ['box', 0.4, 0.5, 0.4], c: 0x8d7f6c, p: [sd * (tw / 2 + 0.3), ridge - 0.45, 0] })),
      ];
    }
    // ---- 砲台(純擺設:砲是幾何,不進任何實體清單)----
    if (feat < 0.5) {
      const pw = Math.min(len * 0.56, 12), py = wh + wh * 0.12;
      return [
        ...base,
        { g: ['box', pw, wh * 0.24, D], c: 0x8f8779, p: [0, wh + wh * 0.12, 0] },              // 台體
        ...rep(pw, 2.2, (x, s) => [                                                            // 台上垛口
          { g: ['box', s * 0.56, wh * 0.16, D * 0.7], c: 0xa79d8f, p: [x, py + wh * 0.2, zIn(D, D * 0.7)] },
        ]),
        ...rep(pw * 0.86, 3.6, (x) => [                                                        // 三門砲(砲口朝圖界外)
          { g: ['cyl', 0.34, 0.24, 2.4, 8], c: 0x4a4f55, p: [x, py + wh * 0.22, -D / 2 + 1.2], r: [Math.PI / 2, 0, 0] },
          { g: ['box', 1.3, 0.55, 1.9], c: 0x6b4f36, p: [x, py + wh * 0.16, -D / 2 + 1.5] },   // 砲架
          ...[-0.62, 0.62].map((o) => (
            { g: ['cyl', 0.42, 0.42, 0.22, 8], c: 0x5b544a, p: [x + o, py + wh * 0.13, -D / 2 + 1.6], r: [Math.PI / 2, 0, 0] })),
          { g: ['ico', 0.28], c: 0x3f4750, p: [x + 1.2, py + wh * 0.16, -D / 2 + 2.4] },        // 彈堆
          { g: ['ico', 0.24], c: 0x3f4750, p: [x + 1.5, py + wh * 0.15, -D / 2 + 2.1] },
        ]),
        { g: ['box', pw * 0.9, 0.22, D * 0.5], c: 0x8b8276, p: [0, py + wh * 0.13, -D / 2 + D * 0.28] },
      ];
    }
    // ---- 箭樓(馬面加高 + 箭窗 + 攢尖頂)----
    if (feat < 0.72) {
      const tw = 4.6, th = wh * 1.12;
      const rr = Math.min(tw * 0.62, D / 2 - 0.05), rh = wh * 0.3;   // 攢尖頂:半徑吃厚度上限
      const tx = len * (rnd() - 0.5) * 0.4;
      return [
        ...base,
        { g: ['box', tw, th, D], c: 0x8f8779, p: [tx, th / 2, 0] },
        ...[0.42, 0.62, 0.82].flatMap((f) => [-1, 1].map((sd) => (                             // 箭窗
          { g: ['box', 0.4, 0.9, 0.18], c: 0x4a4238, p: [tx + sd * 1.2, th * f, zIn(D, 0.18)] }))),
        ...rep(tw, 1.6, (x, s) => [
          { g: ['box', s * 0.54, wh * 0.12, D * 0.72], c: 0xa79d8f, p: [tx + x, th + wh * 0.06, zIn(D, D * 0.72)] },
        ]),
        { g: ['cone', rr, rh, 4], c: 0x6f5b4c, p: [tx, th + wh * 0.12 + rh / 2, 0] },           // 攢尖頂
      ];
    }
    // ---- 素牆:只有馬面(交錯左右 ⇒ 沿邊看過去是有節奏的凸出)----
    return [
      ...base,
      { g: ['box', 4.6, wh * 0.9, D], c: 0x8f8779, p: [len * (rnd() - 0.5) * 0.5, wh * 0.45, 0] },
    ];
  },
  // 連排民房:狹面寬、斜屋頂、一樓店面 —— 沿邊排成一道街牆(這正是「連排」的意思)。
  rowhouse: (len, D, H, rnd) => {
    const wallH = H * 0.66, wallD = D * 0.9, tilt = 0.52;
    // 屋頂**不到滿足跡**(留屋簷內縮 0.14):板身自己的厚度在傾斜後也會往外長,鋪到滿的話
    // 屋簷必定頂出內面 —— 這一族最容易漏掉的一項(演出頂出 = A30)
    const roofSpan = wallD * 0.86, zc = zIn(D, wallD);
    return [
      { g: ['box', len, 0.5, D], c: 0x7c7268, p: [0, 0.25, 0] },
      { g: ['box', len, H * 0.34, 1.0], c: 0x8a8276, p: [0, H * 0.17, -D / 2 + 0.5] },   // 後巷矮牆
      ...rep(len, 6.2, (x, s) => {
        const c = pick(rnd, [0xcfc4b0, 0xc3b9a6, 0xd6cdbb, 0xb9ae9c, 0xc9bda6]);
        const roofC = pick(rnd, [0x8a5f4a, 0x6f5b4c, 0x7a6352]);
        return [
          { g: ['box', s * 0.96, wallH, wallD], c, p: [x, 0.5 + wallH / 2, zc] },
          // 斜屋頂:兩片繞 x 傾斜的板(A26 —— 傾角與板長由跨距算出來,不手寫)
          ...[1, -1].map((sd) => ({
            g: ['box', s * 0.99, 0.28, roofSpan / 2 / Math.cos(tilt)], c: roofC,
            p: [x, 0.5 + wallH + (roofSpan / 4) * Math.tan(tilt), zc + (sd * roofSpan) / 4],
            r: [sd * tilt, 0, 0],
          })),
          { g: ['box', s * 0.99, 0.3, 0.45], c: roofC, p: [x, 0.5 + wallH + (roofSpan / 2) * Math.tan(tilt), zc] },
          // 一樓店面 + 二樓窗:貼內面的深色薄板(看得出來是「有人住過的房子」)
          { g: ['box', s * 0.72, 2.5, 0.24], c: 0x3c4148, p: [x, 1.7, zIn(D, 0.24)] },
          { g: ['box', s * 0.7, 0.35, 0.7], c: pick(rnd, [0xc2513f, 0x3f6f7a, 0xb8912f]), p: [x, 3.2, zIn(D, 0.7)] },
          ...[0.62, 0.82].map((f) => (
            { g: ['box', s * 0.5, 1.2, 0.2], c: 0x4a5158, p: [x, 0.5 + wallH * f, zIn(D, 0.2)] })),
          // 頂樓水塔:雜湊決定有沒有(不是每一戶都有 ⇒ 天際線不齊)
          ...(rnd() < 0.45 ? [{ g: ['cyl', 0.85, 0.85, 1.6, 8], c: 0x9aa2a8, p: [x, H - 0.9, zIn(D, 1.7, 1.4)] }] : []),
        ];
      }),
    ];
  },
  // 軍工級路障:HESCO 防爆牆兩排 + 沙包 + 觀測哨 + 蛇腹鐵絲網。
  barricade: (len, D, H, rnd) => [
    ...rep(len, 2.4, (x, s) => [
      { g: ['box', s * 0.97, 2.4, D], c: pick(rnd, [0x9a8f72, 0xa2977a, 0x8f8568]), p: [x, 1.2, 0] },
      { g: ['box', s * 0.97, 2.2, D * 0.62], c: pick(rnd, [0x958a6d, 0x9e9375]), p: [x, 3.5, zIn(D, D * 0.62)] },
      { g: ['box', s * 0.97, 0.16, D * 0.94], c: 0x6f664f, p: [x, 2.48, zIn(D, D * 0.94)] },
    ]),
    // 沙包稜線
    ...rep(len, 1.1, (x, s) => [
      { g: ['cyl', 0.42, 0.42, s * 0.92, 6], c: 0x87805f, p: [x, 4.9, zIn(D, 0.9)], r: [0, 0, Math.PI / 2] },
    ]),
    // 觀測哨:一節一座,擺在段中偏移處
    { g: ['box', 3.2, 2.4, 3.0], c: 0x6e7364, p: [len * (rnd() - 0.5) * 0.4, 6.1, zIn(D, 3.0, 0.6)] },
    { g: ['box', 3.6, 0.3, 3.4], c: 0x5c6155, p: [len * 0.0, H - 0.15, zIn(D, 3.4, 0.6)] },
    // 蛇腹鐵絲網(沿邊的細圓柱,繞 x 躺平)
    { g: ['cyl', 0.55, 0.55, len * 0.98, 5], c: 0xb7bcc0, p: [0, 5.6, zIn(D, 1.1)], r: [0, 0, Math.PI / 2] },
    ...rep(len, 3.2, (x) => [{ g: ['cyl', 0.09, 0.09, 2.0, 4], c: 0x767b80, p: [x, 5.7, zIn(D, 0.2)] }]),
  ],
  // 停駛的列車:路堤 + 道碴 + 鋼軌 + 兩節車廂 + 電桿。車廂沿邊躺著,盒子只有 3.4m 厚。
  train: (len, D, H, rnd) => {
    const emb = 2.0, rail = emb + 0.55;
    return [
      { g: ['box', len, emb, D], c: 0x6f6a5e, p: [0, emb / 2, 0] },
      { g: ['box', len, 0.5, D * 0.86], c: 0x8a8378, p: [0, emb + 0.25, 0] },
      { g: ['box', len, H - emb, 0.3], c: 0x596168, p: [0, emb + (H - emb) / 2, zIn(D, 0.3)] },
      ...[-0.72, 0.72].map((z) => (
        { g: ['box', len, 0.16, 0.14], c: 0x5d6167, p: [0, rail + 0.08, z] })),
      ...rep(len, 13.5, (x, s) => {
        const c = pick(rnd, [0x3f6f7a, 0x7d4a3c, 0x4c5a3f, 0x5a5f68]);
        return [
          ...makeVehicle('railcar', {
            fit: { L: s * 0.9, W: 3.0, H: 3.85 }, paint: c, at: [x, rail + 0.5, 0],
          }),
        ];
      }),
      // 電車線桿:柱 + 橫臂(頂**恰在**盒頂 —— 差一點就是「盒子上面有一截空的」)
      ...rep(len, 9, (x) => [
        { g: ['cyl', 0.13, 0.16, H - emb, 5], c: 0x6b7076, p: [x, emb + (H - emb) / 2, -D / 2 + 0.4] },
        { g: ['box', 0.14, 0.14, D * 0.8], c: 0x6b7076, p: [x, H - 0.5, 0] },
      ]),
    ];
  },
  // 連排大貨車:低土堤上一整排貨櫃車,首尾相接。頂上再壓一層貨櫃把高度補到盒頂。
  trucks: (len, D, H, rnd) => {
    const berm = 1.5;
    return [
      { g: ['box', len, berm, D], c: 0x6f685c, p: [0, berm / 2, 0] },
      { g: ['box', len, H - berm, 0.3], c: 0x5c625d, p: [0, berm + (H - berm) / 2, zIn(D, 0.3)] },
      ...rep(len, 12.5, (x, s) => {
        const c = pick(rnd, [0xb4553c, 0x3f6f7a, 0x7d8a4a, 0xa8a08c, 0xc2913a]);
        const c2 = pick(rnd, [0x9a4a35, 0x35606b, 0x6d7a40]);
        return [
          ...makeVehicle('truck', {
            fit: { L: s * 0.94, W: 2.5, H: Math.min(4.0, H - berm) }, paint: c,
            cabC: pick(rnd, [0xd6cdbb, 0x3f4750, 0xb9ae9c]), at: [x, berm, 0],
          }),
          ...makeVehicle('container20', {
            fit: { L: s * 0.55, W: 2.3, H: 2.4 }, paint: c2,
            at: [x + s * 0.14, H - 2.5, 0],
          }),
        ];
      }),
    ];
  },
  // 倒塌摩天樓:瓦礫基座 + 側傾的塔身(樓板一層層露出來)+ 折斷的上段 + 天線。
  skyfall: (len, D, H, rnd) => {
    const tilt = 0.18, bodyD = 12.5, bodyH = 12, base = 3.4;
    const hz = Math.abs(Math.sin(tilt)) * (bodyH / 2) + Math.cos(tilt) * (bodyD / 2);
    const hy = Math.cos(tilt) * (bodyH / 2) + Math.abs(Math.sin(tilt)) * (bodyD / 2);
    const zc = D / 2 - hz;
    const upD = 10, upTilt = -0.35;
    const uhy = Math.cos(upTilt) * 5 + Math.abs(Math.sin(upTilt)) * (upD / 2);
    const uhz = Math.abs(Math.sin(upTilt)) * 5 + Math.cos(upTilt) * (upD / 2);
    return [
      { g: ['box', len, base, D], c: 0x8b8378, p: [0, base / 2, 0] },
      ...rep(len, 4.5, (x) => [rock(rnd, x, D, base + 2.4, 1.1, 1.9, pick(rnd, [0x9a958a, 0x857f75, 0x8f8a80]), 3)]),
      { g: ['box', len * 0.99, bodyH, bodyD], c: 0x8e97a0, p: [0, base + hy, zc], r: [tilt, 0, 0] },
      // 樓板:一層一片,露在傾斜的斷面上
      ...[0.16, 0.34, 0.52, 0.7, 0.88].map((f) => (
        { g: ['box', len * 0.99, 0.34, bodyD * 1.01], c: 0xb2b8bd, p: [0, base + bodyH * f, zc], r: [tilt, 0, 0] })),
      // 外露柱(沿邊躺著的細柱,鋼骨斷面)
      ...rep(len, 6.5, (x) => [
        { g: ['cyl', 0.34, 0.34, 5.2, 5], c: 0x767d84, p: [x, base + bodyH * 0.55, zc + 4.4], r: [tilt, 0, 0] },
      ]),
      { g: ['box', len * 0.34, 10, upD], c: 0x828b94, p: [len * 0.24, base + bodyH + uhy - 3, D / 2 - uhz], r: [upTilt, 0, 0] },
      { g: ['cyl', 0.42, 0.24, 4.2, 6], c: 0x9aa2a8, p: [len * 0.24, H - 2.1, D / 2 - uhz] },
      ...rep(len, 8, (x) => [
        { g: ['cyl', 0.08, 0.08, 3.4, 4], c: 0xa8917a, p: [x, base + bodyH * 0.98, zc + 3.0], r: [0.7, 0, 0.3] },
      ]),
    ];
  },
  // 倒塌高架橋(或跨海大橋):瓦礫 + 一片橫躺的橋面 + 斷墩 + 一座還立著的墩帽。
  viaduct: (len, D, H, rnd) => {
    const base = 4.5, dtilt = 0.15, deckD = 12;
    const dhy = Math.cos(dtilt) * 0.5 + Math.abs(Math.sin(dtilt)) * (deckD / 2);
    const dhz = Math.abs(Math.sin(dtilt)) * 0.5 + Math.cos(dtilt) * (deckD / 2);
    return [
      { g: ['box', len, base, D], c: 0x8a8378, p: [0, base / 2, 0] },
      ...rep(len, 5, (x) => [rock(rnd, x, D, base + 2.0, 0.9, 1.8, pick(rnd, [0x9a958a, 0x8a857b]), 3)]),
      // 橫躺的橋面(整段長)—— 內面覆蓋的主力
      { g: ['box', len * 0.99, 1.0, deckD], c: 0x9aa0a6, p: [0, base + dhy, D / 2 - dhz], r: [dtilt, 0, 0] },
      { g: ['box', len * 0.99, 0.8, 0.4], c: 0xb0b6bb, p: [0, base + dhy + 0.9, D / 2 - 0.35] },
      // 斷墩:折斷面朝上,露出鋼筋
      ...rep(len, 11, (x) => [
        { g: ['box', 3.0, 6.6, 3.4], c: 0x8f959b, p: [x, base + 3.3, -D / 2 + 2.0] },
        ...[-0.9, 0, 0.9].map((f) => (
          { g: ['cyl', 0.07, 0.07, 1.8, 4], c: 0xa8917a, p: [x + f, base + 7.4, -D / 2 + 2.0], r: [0, 0, f * 0.25] })),
      ]),
      // 還立著的那一座:墩身 + 墩帽(頂到盒頂)
      { g: ['box', 3.6, H - base - 1.0, 3.8], c: 0x969ca2, p: [len * 0.3, base + (H - base - 1.0) / 2, -D / 2 + 2.6] },
      { g: ['box', 4.8, 1.0, 8.0], c: 0x868d93, p: [len * 0.3, H - 0.5, -D / 2 + 4.0] },
    ];
  },
  // 河堤:內面是垂直的混凝土護岸,背後是梯形堤身,頂上有步道、欄杆與燈桿。
  levee: (len, D, H, rnd) => {
    const wallH = H * 0.78, crest = H * 0.8;
    return [
      { g: ['box', len, wallH, 1.4], c: 0xa6a49c, p: [0, wallH / 2, zIn(D, 1.4)] },
      { g: ['box', len, crest, D - 1.4], c: 0x7f8368, p: [0, crest / 2, zIn(D, D - 1.4, 1.4)] },
      { g: ['box', len, 0.45, D * 0.86], c: 0x9a9689, p: [0, crest + 0.22, zIn(D, D * 0.86, 0.6)] },
      // 護岸伸縮縫 + 排水口(貼內面)
      ...rep(len, 3.4, (x) => [
        { g: ['box', 0.14, wallH * 0.92, 0.16], c: 0x8d8b83, p: [x, wallH * 0.46, zIn(D, 0.16)] },
      ]),
      ...rep(len, 12, (x) => [
        { g: ['cyl', 0.34, 0.34, 0.8, 6], c: 0x6e6c66, p: [x, wallH * 0.34, zIn(D, 0.8)], r: [Math.PI / 2, 0, 0] },
      ]),
      // 欄杆:立柱 + 兩道橫桿
      ...rep(len, 2.6, (x) => [
        { g: ['cyl', 0.07, 0.07, 1.0, 5], c: 0x9aa2a8, p: [x, crest + 0.95, zIn(D, 0.2, 0.5)] },
      ]),
      ...[0.62, 0.95].map((f) => (
        { g: ['box', len, 0.09, 0.09], c: 0x9aa2a8, p: [0, crest + f, zIn(D, 0.09, 0.5)] })),
      // 燈桿(頂到盒頂)
      ...rep(len, 24, (x) => [
        { g: ['cyl', 0.11, 0.13, H - crest, 5], c: 0x8a9096, p: [x, crest + (H - crest) / 2, zIn(D, 0.3, 2.2)] },
        { g: ['box', 0.7, 0.16, 0.34], c: 0xd8d2c2, p: [x + 0.3, H - 0.1, zIn(D, 0.34, 2.2)] },
      ]),
      // 堤肩草被
      ...rep(len, 2.0, (x, s) => [
        { g: ['box', s * 0.9, 0.22, D * 0.4], c: pick(rnd, [0x6f7a4c, 0x64703f, 0x77804f]), p: [x, crest + 0.42, -D / 2 + D * 0.22] },
      ]),
    ];
  },
  // 懸崖峭壁:以逐層後退的岩棚近似 60~90° 崖面；底層山體填滿盒內，
  // 岩紋、嵌入巨石與斜下枯木全都在同一個段落包絡內。
  cliff: (len, D, H, rnd) => {
    const faceD = D * 0.48;
    const wantedDeg = 68 + rnd() * 18;
    const retreat = Math.min(D - faceD - 0.2, H / Math.tan(wantedDeg * Math.PI / 180));
    const actualDeg = Math.atan2(H, Math.max(0.01, retreat)) * 180 / Math.PI;
    const strata = [0.1, 0.23, 0.37, 0.52, 0.68, 0.82, 0.94];
    return [
      { g: ['box', len, H * 0.74, D], c: 0x6f685c, p: [0, H * 0.37, 0], role: 'cliff-core' }, // 山體填滿厚度
      // 每一層都向圖界退一點，內側輪廓形成不規則的斜面而非垂直牆。
      ...strata.map((f) => {
        const d = faceD * (0.92 + rnd() * 0.12);
        const back = 0.18 + retreat * f;
        return {
          g: ['box', len, H * (f > 0.88 ? 0.08 : 0.1), d],
          c: pick(rnd, [0x7c7466, 0x928a7c, 0x6f685c, 0x81786a]),
          p: [0, H * f, zIn(D, d, back)], role: 'rock-strata', slopeDeg: actualDeg,
        };
      }),
      { g: ['box', len, H * 0.08, faceD], c: 0x6d7a4c, p: [0, H * 0.96, zIn(D, faceD, retreat + 0.1)], role: 'cliff-crest' },
      // 崖底崩積錐 + 嵌在岩棚上的巨石(半徑先抽，位置再由半徑決定)。
      ...rep(len, 4.8, (x, step) => [
        { g: ['cone', Math.min(2.2, step * 0.38), 4.0, 7], c: pick(rnd, [0x8f8a80, 0x9a958a]), p: [x, 2.0, zIn(D, 4.4)], role: 'talus' },
        rock(rnd, x, D, 4.0, 0.75, 1.55, 0x857f75, 1.8, 'embedded-boulder'),
        ...(rnd() < 0.72 ? [rock(rnd, x + (rnd() - 0.5) * step * 0.26, D, 7.0, 0.42, 0.9, 0x756f66, 2.8, 'embedded-boulder')] : []),
      ]),
      // 斜向下插入岩壁的枯木；不伸出段端，也不超過 depth/h。
      ...[0, 1, 2].map(() => cliffDeadwood(rnd, len, D, H)),
      // 不規則裂隙與深色橫向岩紋。
      ...rep(len, 6.4, (x) => [
        { g: ['box', 0.28, H * 0.58, 0.28], c: 0x5e584e, p: [x, H * 0.4, zIn(D, 0.28, retreat * 0.22)], role: 'rock-fissure' },
      ]),
    ];
  },
  // 山崩地:後方崩崖 + 前方起伏沙土 + 多層土脊、巨礫與折斷樹幹。
  landslide: (len, D, H, rnd) => {
    const bodyD = D * 0.94, bodyH = H * 0.58;
    return [
      { g: ['box', len, bodyH, bodyD], c: 0x8b7f6b, p: [0, bodyH / 2, zIn(D, bodyD)], role: 'landslide-soil' },
      { g: ['box', len, H * 0.5, D * 0.34], c: 0x7a7263, p: [0, H * 0.75, -D / 2 + D * 0.17], role: 'landslide-scarp' },
      // 起伏沙土脊：高度、厚度與前後位置分開抖動，形成非規則崩積面。
      ...rep(len, 5.0, (x, step, i) => {
        const ridgeH = 0.75 + rnd() * 1.35, ridgeD = D * (0.24 + rnd() * 0.18);
        return [{
          g: ['box', step * 0.84, ridgeH, ridgeD], c: pick(rnd, [0x9a896f, 0x8f806b, 0xa18e70]),
          p: [x, bodyH + ridgeH * 0.45 + (i % 2) * 0.18, zIn(D, ridgeD, rnd() * 2.6)], role: 'soil-ridge',
        }];
      }),
      ...rep(len, 4.4, (x, s) => [
        rock(rnd, x, D, bodyH + 2.0, 1.0, 2.0, pick(rnd, [0x9a958a, 0x857f75, 0x8f8a80, 0x7d786e]), 5, 'landslide-rock'),
        ...(rnd() < 0.58 ? [rock(rnd, x + (rnd() - 0.5) * s * 0.3, D, bodyH + 1.0, 0.52, 1.25, 0x7f796f, 6, 'landslide-rock')] : []),
        ...(rnd() < 0.34 ? [{ g: ['cone', 1.4, 3.0, 6], c: 0x5f6b40, p: [x, bodyH + 1.4, -D / 2 + 3.4], role: 'scrub-root' }] : []),
      ]),
      // 折斷的樹幹(躺著,收在段中央 —— 見 `log` 的檔頭)
      ...[0, 1, 2].map(() => log(rnd, len, D, bodyH + 0.8, 0x6b5a42, 6, 9, 0.5, 'landslide-deadwood')),
      // 泥流舌:從崩崖底下漫出來的扁平舌狀體
      ...rep(len, 6, (x, s) => [
        { g: ['box', s * 0.86, 1.1, D * 0.5], c: 0x7f7360, p: [x, bodyH + 0.4, -D / 2 + D * 0.42], role: 'slide-tongue' },
      ]),
      ...[-1, 1].flatMap((sd, i) => plume(
        sd * len * 0.18, bodyH + 1.0, zIn(D, 0.8, 1.2), rnd, `landslide_dust_${i}`, 'dust', 'dust',
      )),
    ];
  },
  // 土石流:爛泥坡、隨機石塊、枯木與分流泥舌(整段最矮的一款,靠面積說話)。
  debris: (len, D, H, rnd) => [
    { g: ['box', len, H * 0.5, D], c: 0x7d7260, p: [0, H * 0.25, 0], role: 'mud-core' },
    // 上層堆體的頂**恰在**盒頂:靠亂數落石去填頂是碰運氣,某些種子上盒子頂端就會空一截
    { g: ['box', len * 0.96, H * 0.34, D * 0.76], c: 0x8a7e69, p: [0, H * 0.83, zIn(D, D * 0.76, 1.2)], role: 'mud-crust' },
    ...rep(len, 2.8, (x, step) => [
      rock(rnd, x, D, H, 0.8, 1.4, pick(rnd, [0x948f84, 0x827c72, 0x9e998e, 0x726d64]), 8, 'debris-rock'),
      ...(rnd() < 0.62 ? [rock(rnd, x + (rnd() - 0.5) * step * 0.08, D, H, 0.55, 1.1, 0x8a857b, 6, 'debris-rock')] : []),
      ...(rnd() < 0.25 ? [rock(rnd, x, D, H, 0.42, 0.8, 0x736d64, 9, 'debris-rock')] : []),
    ]),
    // 斷木(躺著;收在段中央,不進 rep)
    ...[0, 1, 2, 3].map(() => log(rnd, len, D, H * 0.62, pick(rnd, [0x6b5a42, 0x5c4d38]), 5, 8.5, 0.52, 'debris-deadwood')),
    // 泥漿舌(貼內面漫出來的扁平體)
    ...rep(len, 5, (x, s) => [
      { g: ['box', s * 0.92, 0.9, D * 0.36], c: 0x6f6553, p: [x, 0.45, zIn(D, D * 0.36)], role: 'mud-tongue' },
    ]),
  ],
  // 倒塌神木:兩根沿邊躺著的巨幹 + 兩側掀起的根盤 + 斷枝 + 苔蘚與新生樹苗。
  fallentree: (len, D, H, rnd) => {
    const mound = 1.5, r1 = 2.4, r2 = 1.5;
    return [
      { g: ['box', len, mound, D], c: 0x5f5a45, p: [0, mound / 2, 0] },
      { g: ['cyl', r1, r1 * 0.86, len * 0.99, 8], c: 0x6b5a42, p: [0, mound + r1, zIn(D, r1 * 2)], r: [0, 0, Math.PI / 2] },
      { g: ['cyl', r2, r2 * 0.9, len * 0.72, 7], c: 0x5c4d38, p: [len * 0.1, mound + r1 * 2 - 0.4 + r2, zIn(D, r2 * 2, 1.6)], r: [0, 0, Math.PI / 2] },
      // 掀起的根盤(立起來的圓盤,軸沿 x)
      ...[-1, 1].map((sd) => ({
        g: ['cyl', 3.4, 3.4, 0.9, 9], c: 0x4f4433,
        p: [sd * len * 0.46, mound + 3.5, 0], r: [0, 0, Math.PI / 2],
      })),
      ...rep(len, 6.0, (x, s) => [
        { g: ['cyl', 0.3, 0.16, 3.0 + rnd() * 1.6, 5], c: 0x6b5a42, p: [x, mound + r1 * 1.6, zIn(D, 2.6, rnd() * 2)], r: [0, rnd() * 1.0 - 0.5, 0.5 + rnd() * 0.5] },
        rock(rnd, x + s * 0.2, D, mound + r1 * 2 + 0.6, 0.5, 1.0, pick(rnd, [0x5f6b40, 0x6d7a4c, 0x55603a]), 2),
        ...(rnd() < 0.5 ? [{ g: ['cone', 1.0, 2.6, 6], c: 0x5f6b40, p: [x, mound + 1.2, zIn(D, 2.0)] }] : []),
      ]),
    ];
  },
  // 海堤:沉箱基礎 + 直立牆身 + 反曲胸牆(浪返)+ 頂步道;內面帶潮線污漬。
  seawall: (len, D, H, rnd) => {
    const cais = H * 0.36, bodyD = 6, para = 0.5;
    const phy = Math.cos(para) * 0.8 + Math.abs(Math.sin(para)) * 1.1;
    const phz = Math.abs(Math.sin(para)) * 0.8 + Math.cos(para) * 1.1;
    return [
      { g: ['box', len, cais, D], c: 0x8d8a82, p: [0, cais / 2, 0] },
      { g: ['box', len, H * 0.52, bodyD], c: 0xa3a099, p: [0, cais + H * 0.26, zIn(D, bodyD)] },
      { g: ['box', len, 0.5, D * 0.7], c: 0x928f88, p: [0, H * 0.9, zIn(D, D * 0.7, 2.2)] },
      { g: ['box', len, 1.6, 2.2], c: 0xaeaba3, p: [0, H - phy, D / 2 - phz], r: [-para, 0, 0] },
      // 潮線 + 藻痕(貼內面)
      ...[0.16, 0.24].map((f) => (
        { g: ['box', len, H * 0.05, 0.14], c: 0x6c7264, p: [0, H * f, zIn(D, 0.14)] })),
      // 消波塊護趾(海堤腳下那一排)
      ...rep(len, 3.6, (x) => [rock(rnd, x, D, cais + 1.2, 0.9, 1.4, 0x9a9c9e, 1)]),
      ...rep(len, 6, (x) => [
        { g: ['cyl', 0.16, 0.16, 1.0, 5], c: 0x8a9096, p: [x, H * 0.88, zIn(D, 0.4, 2.2)] },
      ]),
    ];
  },
  // 消波塊:下層到上層逐步減少的四層交錯塊群(每塊 = 塊心 + 四支腳)，
  // 不另墊海堤／護坡平台；下層行數嚴格多於上層，堆疊輪廓呈金字塔。
  tetrapod: (len, D, H, rnd) => {
    const pod = (x, y, z, s, layer, role = 'breakwater-core') => {
      const c = pick(rnd, [0x9fa2a4, 0x94989a, 0xa8abad]);
      const leg = [0.3 * s, 0.2 * s, 1.65 * s, 5];
      return [
        { g: ['ico', 0.72 * s], c, p: [x, y, z], role, layer },
        { g: ['cyl', ...leg], c, p: [x, y + 0.72 * s, z], role: 'breakwater-leg', layer },
        { g: ['cyl', ...leg], c, p: [x + 0.72 * s, y, z], r: [0, 0, -Math.PI / 2], role: 'breakwater-leg', layer },
        { g: ['cyl', ...leg], c, p: [x - 0.72 * s, y, z], r: [0, 0, Math.PI / 2], role: 'breakwater-leg', layer },
        { g: ['cyl', ...leg], c, p: [x, y, z], r: [Math.PI / 2, 0, 0], role: 'breakwater-leg', layer },
      ];
    };
    // 每一層的節距由行數推導；密度由下往上遞減，不依賴共享亂數。
    const layers = [
      { n: 15, y: 1.25, span: len - 2.8 },
      { n: 14, y: 3.25, span: len * 0.9 },
      { n: 12, y: 5.25, span: len * 0.88 },
      { n: 10, y: 7.05, span: len * 0.8 },
    ];
    const out = [
      // 兩條窄腳帶只封住深度包絡的最外緣，不是連續可站立平台。
      { g: ['box', len * 0.98, 0.24, 0.26], c: 0x8d9192, p: [0, 0.12, D / 2 - 0.13], role: 'breakwater-foot', layer: 0 },
      { g: ['box', len * 0.98, 0.24, 0.26], c: 0x777b7d, p: [0, 0.12, -D / 2 + 0.13], role: 'breakwater-foot', layer: 0 },
    ];
    for (let layer = 0; layer < layers.length; layer++) {
      const { n, y, span } = layers[layer], step = span / n;
      for (let i = 0; i < n; i++) {
        const x = -span / 2 + (i + 0.5) * step;
        const s = 1.12 + rnd() * 0.06;
        out.push(...pod(x, y, zIn(D, 2.7 * s, 0.05), s, layer));
      }
    }
    // 外側水下護腳保留真實堆石深度；行數沿用最下層，仍不會改變上窄下寬的輪廓。
    const underN = layers[0].n, underSpan = len - 2.8, underStep = underSpan / underN;
    for (let i = 0; i < underN; i++) {
      const x = -underSpan / 2 + (i + 0.5) * underStep;
      out.push(...pod(x, 1.0, -D / 2 + 1.0, 0.82 + rnd() * 0.08, -1, 'breakwater-underwater'));
    }
    // 最高一列的薄頂緣把盒高用滿，但不冒充一層新的消波塊。
    out.push({ g: ['box', len * 0.62, 0.24, 0.26], c: 0xa2a6a7, p: [0, H - 0.12, D / 2 - 0.13], role: 'breakwater-crest', layer: 4 });
    return out;
  },
  // 連排貨輪:船體吃水線直接貼水，不再以整段灘床／碼頭盒墊高。
  ship: (len, D, H, rnd) => {
    const hullH = 8, hullD = D, deck = hullH;
    const hullC = pick(rnd, [0x7d3f36, 0x2f5566, 0x3f5a3c, 0x53565c]);
    return [
      { g: ['box', len * 0.99, hullH, hullD], c: hullC, p: [0, hullH / 2, 0], role: 'hull' },
      { g: ['box', len * 0.99, 0.9, hullD * 0.99], c: 0xb0402f, p: [0, 1.4, 0], role: 'hull' },
      { g: ['box', len * 0.99, 0.5, hullD], c: 0x8a8f92, p: [0, deck + 0.25, zIn(D, hullD)] },
      // 貨櫃堆(三列 × 兩層)
      ...rep(len, 6.4, (x, s) => [-4.6, 0, 4.6].flatMap((z, j) => [
        ...makeVehicle('container20', {
          fit: { L: s * 0.9, W: 2.4, H: 2.6 },
          paint: pick(rnd, [0xb4553c, 0x3f6f7a, 0x7d8a4a, 0xa8a08c, 0xc2913a]),
          at: [x, deck + 0.5, zIn(D, hullD) + z],
        }),
        ...(rnd() < 0.75 ? makeVehicle('container20', {
          fit: { L: s * 0.9, W: 2.4, H: 2.6 },
          paint: pick(rnd, [0x9a4a35, 0x35606b, 0x6d7a40, 0x8f8878]),
          at: [x, deck + 3.2, zIn(D, hullD) + z],
        }) : []),
        ...(j === 1 && rnd() < 0.4 ? makeVehicle('container20', {
          fit: { L: s * 0.9, W: 2.4, H: 2.6 }, paint: 0x8d949c,
          at: [x, deck + 5.9, zIn(D, hullD) + z],
        }) : []),
      ]).flat(),
      ),
      // 上層建築 + 駕駛台 + 煙囪 + 桅桿(桅頂 = 盒頂)
      { g: ['box', 6.5, 6.0, 9], c: 0xd6cdbb, p: [len * 0.32, deck + 3.0, zIn(D, 9, 2.4)] },
      { g: ['box', 7.4, 1.7, 9.8], c: 0xe2dccd, p: [len * 0.32, deck + 6.85, zIn(D, 9.8, 2.4)] },
      { g: ['box', 2.6, 3.2, 3.0], c: 0x3f4750, p: [len * 0.32 - 3.6, deck + 9.3, zIn(D, 3.0, 3.4)] },
      { g: ['cyl', 0.24, 0.16, H - deck - 7.7, 5], c: 0xd6cdbb, p: [len * 0.32, deck + 7.7 + (H - deck - 7.7) / 2, zIn(D, 0.5, 3.0)] },
      // 起重機吊臂(斜的細柱)
      ...rep(len, 15, (x) => [
        { g: ['cyl', 0.3, 0.22, 9, 5], c: 0xc2913a, p: [x, deck + 4.4, zIn(D, 4, 5.5)], r: [0, 0.4, 0.62] },
      ]),
    ];
  },
};

// ---- 大型設施族生成器 -------------------------------------------------------
// `WALL_KINDS` 的每一款只是資料列；同族共用生成器，避免風機／工業量體／農牧設施各自
// 長出一份略有不同的接點與比例。障礙物本體直接由地面／水面長出；MUST NOT 另加通用底座、
// 擋土方盒或為了填碰撞面而存在的無語意圍牆。
const moving = (row, kind, id, pivot, phase, pad = 0) => ({
  ...row, motion: { kind, id, pivot, phase, pad },
});

// 一個煙／塵柱合併成一組動態網格，避免每顆粒子各自產生 draw call。
const plume = (x, y, z, rnd, id, kind = 'smoke', role = kind) => {
  const phase = rnd() * Math.PI * 2, pivot = [x, y, z];
  const rows = [
    { r: 0.48, dy: 0, dz: 0 },
    { r: 0.38, dy: 0.62, dz: 0.14 },
    { r: 0.3, dy: 1.24, dz: -0.16 },
  ];
  return rows.map((q, i) => moving({
    g: ['ico', q.r], c: kind === 'dust' ? [0x8c806d, 0x9b8b73, 0x756b60][i] : [0x4f5354, 0x686766, 0x858078][i],
    p: [x + (i ? (rnd() - 0.5) * 0.34 : 0), y + q.dy, z + q.dz], role,
  }, kind, id, pivot, phase, 0.58));
};

const windFacility = (len, D, H, rnd, spec) => {
  const marine = spec.dom === 'water';
  const bladeR = 2.9, hubY = H - bladeR - 0.18;
  return [
    ...rep(len, 7.2, (x, step, i) => {
      const z = zIn(D, 0.3, 0.47), id = `rotor_${i}`;
      const pivot = [x, hubY, z], phase = rnd() * Math.PI * 2;
      const span = step * 0.84, rise = hubY - 0.3;
      const legL = Math.hypot(span / 2, rise), legA = Math.atan2(span / 2, rise);
      return [
        // 兩支斜腿與塔柱就是風機塔架本體；海上款的腿腳直接入水，陸上款直接落地。
        { g: ['box', 0.32, legL, 0.34], c: spec.col[1], p: [x - span / 4, 0.3 + rise / 2, z], r: [0, 0, -legA], role: 'tower-leg' },
        { g: ['box', 0.32, legL, 0.34], c: spec.col[1], p: [x + span / 4, 0.3 + rise / 2, z], r: [0, 0, legA], role: 'tower-leg' },
        ...(marine ? [{ g: ['cone', 1.2, 2.4, 8], c: spec.col[1], p: [x, 1.2, zIn(D, 2.4, 1.2)], role: 'monopile' }] : []),
        { g: ['cyl', 0.34, 0.54, hubY, 8], c: spec.col[0], p: [x, hubY / 2, zIn(D, 1.2, 1.5)] },
        { g: ['box', 1.6, 0.8, 1.4], c: spec.col[1], p: [x, hubY, zIn(D, 1.4, 0.35)] },
        { g: ['ico', 0.62], c: 0xd9dde0, p: pivot },
        ...[0, 1, 2].map((j) => {
          const a = j * Math.PI * 2 / 3;
          return moving({
            g: ['box', 0.34, bladeR, 0.24], c: 0xe4e7e7,
            p: [x + Math.cos(a) * bladeR / 2, hubY + Math.sin(a) * bladeR / 2, z],
            r: [0, 0, a - Math.PI / 2],
          }, 'rotor', id, pivot, phase);
        }),
      ];
    }),
    { g: ['ico', 0.44], c: marine ? 0xe2b84d : spec.col[1], p: [0, 0.44, -D / 2 + 0.44], role: marine ? 'mooring' : 'service-marker' },
  ];
};

const solarFacility = (len, D, H, rnd, spec) => {
  const marine = spec.dom === 'water';
  const panels = rep(len, 6.2, (x, step, i) => {
    const z = zIn(D, 5.0, marine ? 0.55 : 0.05), id = `float_${i}`;
    const panelY = marine ? 1.15 : 1.1, floatY = marine ? 0.75 : 0.25;
    const rows = [
      // 低傾角面板與浮筒／追日腳就是障礙物本體；不為了碰撞高度把面板堆成直立牆。
      { g: ['box', step * (marine ? 0.76 : 0.86), 0.18, 5.0], c: spec.col[0], p: [x, panelY, z], r: [marine ? -0.12 : -0.25, 0, 0], role: 'panel' },
      { g: ['box', step * (marine ? 0.76 : 0.86), marine ? 0.38 : 0.5, 5.2], c: 0x56636a, p: [x, floatY, zIn(D, 5.2, marine ? 0.55 : 0.05)], role: marine ? 'float' : 'tracker-foot' },
      ...[-1.7, 0, 1.7].map((o) => ({ g: ['box', step * 0.7, 0.06, 0.08], c: 0xaeb8bc, p: [x, panelY + 0.12, z + o], role: 'panel-rail' })),
    ];
    if (spec.mount !== 'float') return rows;
    const pivot = [x, floatY, z];
    const phase = rnd() * Math.PI * 2;
    return rows.map((p) => moving(p, 'float', id, pivot, phase, EDGE_MOTION.FLOAT_AMP_M + 0.12));
  });
  return [
    ...panels,
    { g: ['box', 3.4, 0.7, 2.4], c: 0xe0ded4, p: [len * 0.2, marine ? 1.05 : 0.35, -D / 2 + 1.4], role: marine ? 'inverter-float' : 'inverter' },
    { g: ['cyl', 0.16, 0.22, H - 0.4, 6], c: 0xb9c0c2, p: [len * 0.38, 0.4 + (H - 0.4) / 2, -D / 2 + 1.4], role: 'marker' },
    ...(marine ? [
      { g: ['ico', 0.44], c: 0xe2b84d, p: [0, 0.44, -D / 2 + 0.44], role: 'mooring' },
      { g: ['ico', 0.44], c: 0xe2b84d, p: [0, 0.44, D / 2 - 0.44], role: 'mooring' },
    ] : [{ g: ['ico', 0.44], c: spec.col[1], p: [0, 0.44, -D / 2 + 0.44], role: 'service-marker' }]),
  ];
};

const ranchFacility = (len, D, H, rnd, spec) => {
  const marine = spec.dom === 'water';
  const pens = rep(len, 7.5, (x, step, i) => {
    const y = marine ? 1.0 : 0.38;
    const z = zIn(D, 5.2, 0.25), id = `pen_${i}`, pivot = [x, y, z];
    const rows = [
      // 大型箱網／圍網的浮式環框；中間保持空水面，不以方盒填滿。
      ...[-2.2, 2.2].map((o) => ({ g: ['box', step * 0.86, 0.28, 0.22], c: spec.col[0], p: [x, y, z + o], role: 'cage-collar' })),
      ...[-1, 1].map((sd) => ({ g: ['box', 0.22, 0.28, 4.6], c: spec.col[0], p: [x + sd * step * 0.39, y, z], role: 'cage-collar' })),
      ...[-1.5, 0, 1.5].map((o) => ({ g: ['ico', 0.42], c: marine ? 0xd9b24b : 0xd8d0bd, p: [x + o, y + 0.28, z + (rnd() - 0.5) * 2.6], role: 'buoy' })),
      // 上方細框是防鳥網／投餌索，不是建築牆面。
      ...[-1, 1].map((sd) => ({ g: ['box', 0.12, 6.2, 0.12], c: spec.col[1], p: [x + sd * step * 0.36, y + 3.1, z + 2.15] })),
      ...[-1, 1].map((sd) => {
        const span = step * 0.72, rise = 6.2, L = Math.hypot(span, rise);
        return { g: ['box', L, 0.1, 0.1], c: spec.col[1], p: [x, y + 3.1, z + 2.15], r: [0, 0, sd * Math.atan2(rise, span)], role: 'cage-net' };
      }),
      { g: ['box', step * 0.76, 0.1, 0.1], c: spec.col[1], p: [x, y + 6.18, z + 2.15] },
    ];
    if (spec.mount !== 'float') return rows;
    const phase = rnd() * Math.PI * 2;
    return rows.map((p) => moving(p, 'float', id, pivot, phase, EDGE_MOTION.FLOAT_AMP_M + 0.12));
  });
  return [
    ...pens,
    // 飼料／維修浮台是獨立小船台；旁邊長線以浮標串出貝類養殖帶。
    { g: ['box', 4.8, 0.8, 4.2], c: spec.col[0], p: [len * 0.26, marine ? 1.0 : 0.4, -D / 2 + 2.6], role: marine ? 'service-float' : 'feed-depot' },
    { g: ['box', 3.8, 3.4, 3.2], c: 0xd8d0bd, p: [len * 0.26, marine ? 3.1 : 2.1, -D / 2 + 2.6] },
    ...(marine ? rep(len * 0.62, 2.4, (x) => [{ g: ['ico', 0.34], c: 0xe0ad3f, p: [x - len * 0.16, 0.48, -D / 2 + 0.6], role: 'longline-buoy' }]) : rep(len, 7.5, (x, step, i) => [
      { g: ['box', step * 0.88, 7.2, 4.8], c: spec.col[0], p: [x, 3.6, zIn(D, 4.8, 0.2)], role: 'livestock-shed' },
      { g: ['box', step * 0.94, 0.42, 5.4], c: spec.col[1], p: [x, 7.08, zIn(D, 5.4, 0.0)], r: [0, 0, i % 2 ? 0.08 : -0.08], role: 'shed-roof' },
    ])),
    { g: ['cyl', 0.14, 0.2, H - 0.4, 6], c: spec.col[1], p: [len * 0.4, 0.4 + (H - 0.4) / 2, -D / 2 + 0.2], role: 'marker' },
    ...(marine ? [
      { g: ['ico', 0.44], c: 0xe2b84d, p: [0, 0.44, -D / 2 + 0.44], role: 'mooring' },
      { g: ['ico', 0.44], c: 0xe2b84d, p: [0, 0.44, D / 2 - 0.44], role: 'mooring' },
    ] : []),
  ];
};

const extractFacility = (len, D, H, rnd, spec, kind) => {
  const marine = spec.dom === 'water';
  if (kind === 'deeprig') {
    const pad = EDGE_MOTION.FLOAT_AMP_M + 0.14;
    const pivot = [0, 1.2, 0], id = 'rig_float';
    const phase = rnd() * Math.PI * 2;
    const deck = [
      { g: ['box', len * 0.78, 6.4, D * 0.72], c: spec.col[0], p: [0, 3.2 + pad, zIn(D, D * 0.72, pad)], role: 'platform-deck' },
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({
        g: ['box', 2.2, 1.1, 4.8], c: spec.col[1], p: [sx * len * 0.25, 1.2, sz * D * 0.24], role: 'pontoon',
      }))),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({
        g: ['box', 0.34, 4.2, 0.34], c: spec.col[1], p: [sx * len * 0.29, 3.2 + pad, sz * D * 0.26], role: 'platform-leg',
      }))),
      { g: ['box', 5.2, 4.2, 4.8], c: 0xd7d1c2, p: [len * 0.2, 5.2 + pad, -D * 0.1], role: 'platform-control' },
      { g: ['box', 6.4, 0.42, 6.2], c: spec.col[0], p: [0, H - pad - 0.21, 0], role: 'derrick-platform' },
      // 兩座鑽井塔、鑽柱與側臂，平台本體一併隨浪浮動。
      ...[-1, 1].flatMap((sd, di) => {
        const x = sd * len * 0.16, towerH = H - pad - 5.2, z = zIn(D, 3.8, 1.0);
        const rows = [
          { g: ['box', 0.28, towerH, 0.28], c: spec.col[1], p: [x - 1.4, 4.2 + towerH / 2, z], role: 'offshore-derrick-leg' },
          { g: ['box', 0.28, towerH, 0.28], c: spec.col[1], p: [x + 1.4, 4.2 + towerH / 2, z], role: 'offshore-derrick-leg' },
          { g: ['box', 3.5, 0.3, 0.3], c: spec.col[0], p: [x, 4.2 + towerH, z], role: 'offshore-derrick-crossbar' },
          { g: ['cyl', 0.16, 0.2, towerH + 1.0, 6], c: 0x4e565b, p: [x, 4.2 + (towerH + 1.0) / 2, z], role: 'drill-string' },
          moving({ g: ['box', 4.4, 0.32, 0.5], c: 0xc28b38, p: [x + 0.6, 7.0, z], r: [0, 0, 0.16], role: 'offshore-oil-machine' }, 'machine', `offshore_machine_${di}`, [x, 6.7, z], phase + di * 0.7, 0.32),
        ];
        return rows;
      }),
    ].map((p) => p.motion ? p : moving(p, 'float', id, pivot, phase, pad));
    const smoke = [-1, 1].flatMap((sd, i) => plume(
      sd * len * 0.16, H - 4.8, zIn(D, 0.8, 1.2), rnd, `offshore_smoke_${i}`, 'smoke', 'smoke',
    ));
    return [
      ...deck,
      ...smoke,
      { g: ['ico', 0.44], c: 0xe2b84d, p: [0, 0.44, -D / 2 + 0.44], role: 'mooring' },
      { g: ['ico', 0.44], c: 0xe2b84d, p: [0, 0.44, D / 2 - 0.44], role: 'mooring' },
    ];
  }
  const pump = (x, i) => {
    const y = 2.3, c = i % 2 ? spec.col[0] : spec.col[1];
    return [
      { g: ['box', 3.8, 0.5, 3.4], c: 0x555b5f, p: [x, 0.25, zIn(D, 3.4, 1.2)], role: kind === 'mine' ? 'mine-machine-base' : 'oil-machine-base' },
      { g: ['cyl', 0.22, 0.28, 4.2, 6], c, p: [x - 1.0, y, zIn(D, 0.7, 2.0)], role: kind === 'mine' ? 'mine-machine-cab' : 'oil-pump-column' },
      { g: ['box', 5.2, 0.48, 0.72], c, p: [x + 0.8, y + 1.6, zIn(D, 0.72, 1.7)], r: [0, 0, kind === 'mine' ? -0.28 : 0.18], role: kind === 'mine' ? 'mine-machine-boom' : 'oil-pump-beam' },
      { g: ['ico', 1.25], c: kind === 'mine' ? 0x807568 : 0x444a4e, p: [x + 1.3, 1.25, -D / 2 + 2.0], role: kind === 'mine' ? 'mine-machine-wheel' : 'oil-counterweight' },
    ];
  };
  if (kind === 'mine') {
    const machines = rep(len, 12, (x, step, i) => {
      const z = zIn(D, 3.8, 0.7), pivot = [x, 4.5, z], phase = rnd() * Math.PI * 2;
      return [
        ...pump(x, i),
        moving({ g: ['box', 5.8, 0.4, 0.55], c: 0x9a6e35, p: [x + 1.6, 5.0, z], r: [0, 0, -0.24], role: 'mine-machine-arm' }, 'machine', `mine_machine_${i}`, pivot, phase, 0.34),
        moving({ g: ['ico', 0.48], c: 0x68605a, p: [x + 4.0, 3.7, z], role: 'mine-machine-bucket' }, 'machine', `mine_machine_${i}`, pivot, phase, 0.34),
        ...plume(x + 3.6, 6.6, zIn(D, 0.8, 1.0), rnd, `mine_dust_${i}`, 'dust', 'dust'),
      ];
    }).flat();
    const benches = rep(len, 8, (x, step, i) => {
      const ridgeH = 0.65 + rnd() * 1.45, ridgeD = D * (0.28 + rnd() * 0.2);
      return [{ g: ['box', step * 0.82, ridgeH, ridgeD], c: i % 2 ? 0x806f5c : 0x9a856c, p: [x, ridgeH / 2 + (i % 3) * 0.35, zIn(D, ridgeD, rnd() * 2.0)], role: 'mine-bench' }];
    }).flat();
    const ore = rep(len, 5.5, (x, step, i) => {
      const largeH = 6.2 + rnd() * 1.0, smallH = 2.5 + rnd() * 1.4;
      return [
        { g: ['cone', step * 0.4, largeH, 8], c: i % 2 ? 0x807568 : 0x9a8a74, p: [x, largeH / 2, zIn(D, step * 0.8, 0.1)], role: 'ore-pile' },
        { g: ['cone', step * 0.25, smallH, 7], c: 0xb08b4c, p: [x + step * 0.18, smallH / 2, zIn(D, step * 0.5, 0.3)], role: 'ore-pile' },
      ];
    }).flat();
    return [
      ...machines, ...benches, ...ore,
      { g: ['cyl', 0.28, 0.42, H, 6], c: spec.col[1], p: [len * 0.34, H / 2, -D / 2 + 2.2], role: 'mine-marker' },
      { g: ['ico', 0.44], c: spec.col[1], p: [0, 0.44, -D / 2 + 0.44], role: 'service-marker' },
    ];
  }
  const derricks = rep(len, 12, (x, step, i) => {
    const towerH = Math.min(H - 2.2, 11.8), z = zIn(D, 3.8, 0.4), pivot = [x, 3.3, z], phase = rnd() * Math.PI * 2;
    return [
      { g: ['box', 4.8, 0.5, 3.8], c: 0x555b5f, p: [x, 0.25, z], role: 'oil-rig-base' },
      ...[-1, 1].map((sd) => ({ g: ['box', 0.26, towerH, 0.26], c: spec.col[1], p: [x + sd * 1.65, towerH / 2 + 0.5, z], role: 'derrick-leg' })),
      { g: ['box', 3.8, 0.28, 0.28], c: spec.col[0], p: [x, towerH + 0.36, z], role: 'derrick-crossbar' },
      { g: ['cyl', 0.14, 0.18, towerH + 1.4, 6], c: 0x4e565b, p: [x, (towerH + 1.4) / 2 + 0.5, z], role: 'drill-string' },
      moving({ g: ['box', 4.8, 0.34, 0.52], c: 0xb27e32, p: [x + 0.65, 3.7, z], r: [0, 0, 0.18], role: 'oil-machine' }, 'machine', `oil_machine_${i}`, pivot, phase, 0.3),
      moving({ g: ['ico', 0.46], c: 0x6c5b4c, p: [x + 2.9, 3.3, z], role: 'oil-machine-counterweight' }, 'machine', `oil_machine_${i}`, pivot, phase, 0.3),
      ...plume(x, towerH + 1.3, zIn(D, 0.8, 0.8), rnd, `oil_smoke_${i}`, 'smoke', 'smoke'),
    ];
  }).flat();
  const tanks = rep(len, 6.0, (x, step, i) => [
    { g: ['cyl', step * 0.38, step * 0.42, 7.2, 10], c: i % 2 ? spec.col[0] : spec.col[1], p: [x, 3.6, zIn(D, step * 0.84, 0.1)], role: 'storage-tank' },
  ]).flat();
  return [
    ...derricks, ...tanks,
    { g: ['cyl', 0.28, 0.42, H, 6], c: spec.col[1], p: [len * 0.34, H / 2, -D / 2 + 2.2], role: 'oilfield-marker' },
    { g: ['ico', 0.44], c: spec.col[1], p: [0, 0.44, -D / 2 + 0.44], role: 'service-marker' },
  ];
};

const greenhouseFacility = (len, D, H, rnd, spec) => {
  return [
    ...rep(len, 7.2, (x, step) => [
      { g: ['box', step * 0.9, 6.8, D * 0.62], c: 0x78988b, p: [x, 3.4, zIn(D, D * 0.62)] },
      { g: ['cyl', 2.0, 2.0, step * 0.9, 8], c: spec.col[0], p: [x, 6.8, zIn(D, D * 0.62)], r: [0, 0, Math.PI / 2] },
      ...[-1.8, 0, 1.8].map((o) => ({ g: ['box', step * 0.84, 0.08, 0.08], c: 0xd3dfda, p: [x, 7.2, zIn(D, 0.1, D * 0.22 + o)] })),
    ]),
    { g: ['cyl', 0.18, 0.22, H, 6], c: 0x718078, p: [len * 0.4, H / 2, -D / 2 + 0.22] },
  ];
};

const highriseFacility = (len, D, H, rnd, spec, variant = 0) => {
  const widthF = [0.78, 0.76, 0.8][variant % 3];
  return [
    ...rep(len, 8.2, (x, step, i) => {
      const rank = (i + variant) % 3;
      const h = rank === 1 ? H : H * (0.52 + rnd() * 0.25);
      const d = D * (0.5 + rank * 0.04);
      return [
        { g: ['box', step * widthF, h, d], c: (i + variant) % 2 ? spec.col[0] : spec.col[1], p: [x, h / 2, zIn(D, d)] },
        ...[0.24, 0.48, 0.72].map((f) => ({ g: ['box', step * (widthF - 0.06), 0.18, 0.16], c: 0xb6ccd5, p: [x, h * f, zIn(D, 0.16)] })),
      ];
    }),
    { g: ['box', 3.4 + variant * 0.4, H * (0.52 + variant * 0.05), 2.0], c: spec.col[1], p: [(variant - 1) * len * 0.18, H * (0.26 + variant * 0.025), -D / 2 + 1.0], role: 'service-wing' },
  ];
};

const industryFacility = (len, D, H, rnd, spec, kind, variant = 0) => {
  const hallH = Math.min(H - 1, kind === 'factory' ? 9 : 11);
  const stacks = kind === 'powerplant' ? 3 : (kind === 'incinerator' ? 2 : 1);
  const stackRows = Array.from({ length: stacks }, (_, i) => {
    const x = len * (0.2 + i * 0.12);
    const h = i === stacks - 1 ? H - 2.2 : Math.min(H - 2.2, H * (0.68 + i * 0.08));
    const z = -D / 2 + 1.15 + i * 1.3;
    return [
      { g: ['cyl', 0.72, 1.15, h, 10], c: i % 2 ? spec.col[0] : spec.col[1], p: [x, h / 2, z], role: 'chimney' },
      ...plume(x, h, z, rnd, `${kind}_smoke_${i}`, 'smoke', 'smoke'),
    ];
  }).flat();
  return [
    ...rep(len, variant === 1 ? 10.8 : 8.4, (x, step, i) => {
      const h = hallH * (0.78 + ((i + variant) % 3) * 0.1);
      const d = D * (0.5 + ((i + variant) % 2) * 0.08);
      const back = ((i + variant) % 2) * 1.15;
      return [
        { g: ['box', step * 0.76, h, d], c: (i + variant) % 2 ? spec.col[0] : spec.col[1], p: [x, h / 2, zIn(D, d, back)], role: 'industrial-hall' },
        { g: ['box', step * 0.72, 0.46, d + 0.35], c: spec.col[1], p: [x, h + 0.23, zIn(D, d + 0.35, back)], role: 'industrial-roof' },
      ];
    }),
    ...stackRows,
    ...(kind === 'powerplant' ? rep(len * 0.42, 9, (x) => [
      { g: ['cyl', 2.5, 3.4, 7.4, 10], c: 0x9b9d96, p: [x - len * 0.18, 3.7, zIn(D, 6.8, 1.0)], role: 'cooling-tower' },
    ]) : []),
  ];
};

const wetlandFacility = (len, D, H, rnd, spec) => {
  return [
    ...rep(len, 5.4, (x, step) => [
      ...Array.from({ length: 12 }, (_, i) => ({
        g: ['cyl', 0.18, 0.18, 7.2, 5], c: i % 2 ? spec.col[0] : 0xc7c1ad,
        p: [x - step * 0.44 + (i + 0.5) * step * 0.88 / 12, 3.6, zIn(D, 0.36, 0.05)], role: 'oyster-line',
      })),
      ...[-1.8, 0, 1.8].map((z) => ({ g: ['cyl', 0.11, 0.15, 6.8, 5], c: spec.col[0], p: [x, 3.4, zIn(D, 0.3, D * 0.22 + z)] })),
      { g: ['box', step * 0.86, 0.16, 4.2], c: spec.col[1], p: [x, 5.8, zIn(D, 4.2, 1.0)] },
      ...[-1.2, 0, 1.2].map((z) => ({ g: ['cyl', 0.26, 0.34, step * 0.72, 6], c: 0xc7c1ad, p: [x, 6.0, zIn(D, 0.7, D * 0.24 + z)], r: [0, 0, Math.PI / 2] })),
    ]),
    { g: ['cyl', 0.16, 0.2, H, 5], c: spec.col[0], p: [len * 0.4, H / 2, -D / 2 + 0.2] },
  ];
};

const wreckFacility = (len, D, H, rnd, spec, variant = 0) => {
  const dir = variant === 1 ? -1 : 1;
  const hullF = [0.8, 0.76, 0.84][variant % 3];
  const bridgeX = dir * len * (0.18 + variant * 0.025);
  return [
    // 分層船殼、龍骨、尖艏／方艉與甲板直接構成障礙；不是堆貨櫃的底座。
    { g: ['box', len * hullF, 5.2, D * (0.6 + variant * 0.03)], c: spec.col[0], p: [-dir * len * 0.03, 2.6, zIn(D, D * (0.6 + variant * 0.03), 0.05)], role: 'hull' },
    { g: ['box', len * (hullF - 0.08), 1.7, D * 0.72], c: spec.col[1], p: [-dir * len * 0.06, 6.05, zIn(D, D * 0.72, 0.05)], role: 'hull-deck' },
    { g: ['box', len * (hullF - 0.14), 1.8, D * 0.28], c: 0x46545d, p: [-dir * len * 0.06, 0.9, -D / 2 + D * 0.14], role: 'keel' },
    { g: ['cone', D * 0.18, 5.2, 8], c: spec.col[0], p: [dir * len * (hullF / 2 - 0.03), D * 0.18, zIn(D, D * 0.42, 0.05)], r: [0, 0, -dir * Math.PI / 2], role: 'bow' },
    { g: ['box', len * 0.15, 4.2, D * 0.6], c: spec.col[1], p: [-dir * len * (hullF / 2 - 0.04), 2.3, zIn(D, D * 0.6, 0.1)], role: 'stern' },
    { g: ['box', len * (hullF - 0.08), 0.5, D * 0.76], c: 0xa55d45, p: [-dir * len * 0.04, 7.15, zIn(D, D * 0.76)], role: 'deck' },
    // 駕駛台、舷窗帶、煙囪、桅桿與救生艇讓船型在遠景仍可辨識。
    { g: ['box', 5.4 + variant * 0.4, 3.8, 6.2], c: 0xc8c2b4, p: [bridgeX, 9.0, zIn(D, 6.2, 2.0)], role: 'bridge' },
    { g: ['box', 4.8 + variant * 0.3, 0.7, 6.5], c: 0x53616a, p: [bridgeX, 11.25, zIn(D, 6.5, 1.8)], role: 'bridge-window' },
    { g: ['cyl', 0.55, 0.45, 3.3, 7], c: variant === 2 ? 0x4f5960 : 0x9a4d37, p: [bridgeX - dir * 0.7, 12.1, zIn(D, 1.1, 2.0)], role: 'funnel' },
    { g: ['cyl', 0.16, 0.22, H - 12.5, 5], c: spec.col[1], p: [-dir * len * 0.04, 12.5 + (H - 12.5) / 2, zIn(D, 0.5, 2.1)], role: 'mast' },
    ...[-1, 1].map((sd) => ({ g: ['box', 2.4, 0.55, 0.85], c: 0xd6c7a7, p: [len * 0.03, 8.0, zIn(D, 0.85, 5.3 + sd * 0.55)], role: 'lifeboat' })),
    ...rep(len * 0.72, 5.8, (x) => [
      { g: ['cyl', 0.07, 0.07, 1.0, 5], c: 0xb4b8b6, p: [x, 8.05, zIn(D, 0.18, 0.42)], role: 'ship-rail' },
    ]),
  ];
};

const podFacility = (len, D, H, rnd, spec) => {
  const pod = (x, y, z, s, rz) => [
    { g: ['ico', 0.92 * s], c: pick(rnd, spec.col), p: [x, y, z] },
    ...[-1, 1].map((sd) => ({ g: ['cyl', 0.34 * s, 0.2 * s, 2.4 * s, 6], c: pick(rnd, spec.col), p: [x + sd * 0.82 * s, y, z], r: [0, 0, sd * 1.05 + rz] })),
    ...[-1, 1].map((sd) => ({ g: ['cyl', 0.34 * s, 0.2 * s, 2.4 * s, 6], c: pick(rnd, spec.col), p: [x, y + sd * 0.82 * s, z], r: [sd * 1.05, 0, rz] })),
  ];
  return [
    ...rep(len, 3.2, (x, step, i) => {
      const px = x * 0.91, nearZ = zIn(D, 3.2, 0.1);
      return [
        ...pod(px, 2.1, nearZ, 1.2, i % 2 ? 0.25 : -0.25),
        ...pod(px, 4.4, nearZ, 1.05, i % 2 ? -0.3 : 0.3),
        ...pod(px, 6.7, nearZ, 1.05, i % 2 ? 0.2 : -0.2),
        ...pod(px, 2.1, -D / 2 + 1.5, 1.2, i % 2 ? -0.22 : 0.22),
      ];
    }),
    { g: ['cyl', 0.16, 0.2, H, 5], c: spec.col[1], p: [len * 0.42, H / 2, -D / 2 + 1.0] },
  ];
};

function facilityParts(kind, len, D, H, rnd, variant) {
  const spec = WALL_KINDS[kind];
  if (!spec?.family) return null;
  if (spec.family === 'wind') return windFacility(len, D, H, rnd, spec);
  if (spec.family === 'solar') return solarFacility(len, D, H, rnd, spec);
  if (spec.family === 'ranch') return ranchFacility(len, D, H, rnd, spec);
  if (spec.family === 'extract') return extractFacility(len, D, H, rnd, spec, kind);
  if (spec.family === 'greenhouse') return greenhouseFacility(len, D, H, rnd, spec);
  if (spec.family === 'industry') return industryFacility(len, D, H, rnd, spec, kind, variant);
  if (spec.family === 'highrise') return highriseFacility(len, D, H, rnd, spec, variant);
  if (spec.family === 'wetland') return wetlandFacility(len, D, H, rnd, spec);
  if (spec.family === 'wreck') return wreckFacility(len, D, H, rnd, spec, variant);
  return podFacility(len, D, H, rnd, spec);
}

/**
 * 取一款的零件表。`seed` 決定同款不同節的色差與擺位(零共享亂數)。
 * 找不到的款一律回退 `barricade`(原則 6:降級不例外)。
 */
export function wallParts(kind, { len, depth, h, seed = 1, variant = wallVariant(kind, seed) }) {
  const rnd = mulberry32((seed * 2654435761) >>> 0);
  return facilityParts(kind, len, depth, h, rnd, variant) || (PARTS[kind] || PARTS.barricade)(len, depth, h, rnd);
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
  grove: (rnd) => [
    { g: ['cyl', 0.9, 1.2, 7, 5], c: 0x5c4d38, p: [0, 3.5, 0] },
    ...[0, 1, 2].map((i) => ({
      g: ['cone', 5.5 - i * 1.3, 8 - i * 1.4, 7], c: pick(rnd, [0x4e5f36, 0x5f6b40, 0x44532f]),
      p: [(rnd() - 0.5) * 2, 8 + i * 4.4, (rnd() - 0.5) * 2],
    })),
    ...[0, 1, 2, 3].map(() => ({
      g: ['cone', 3.2 + rnd() * 2, 9 + rnd() * 6, 6], c: pick(rnd, [0x4e5f36, 0x55603a]),
      p: [(rnd() - 0.5) * 22, 5 + rnd() * 3, (rnd() - 0.5) * 22],
    })),
  ],
  boulder: (rnd) => [
    { g: ['ico', 4 + rnd() * 3], c: pick(rnd, [0x8f8a80, 0x9a958a, 0x7d786e]), p: [0, 3.5, 0] },
    ...[0, 1, 2].map(() => ({
      g: ['ico', 1.8 + rnd() * 2.6], c: pick(rnd, [0x857f75, 0x948f84]),
      p: [(rnd() - 0.5) * 18, 1.4 + rnd() * 1.6, (rnd() - 0.5) * 18],
    })),
    { g: ['cone', 6, 9, 6], c: 0x8a857b, p: [(rnd() - 0.5) * 14, 4.5, (rnd() - 0.5) * 14] },
  ],
  hamlet: (rnd) => [
    ...[0, 1, 2].map((i) => {
      const w = 7 + rnd() * 6, h = 6 + rnd() * 9;
      return { g: ['box', w, h, w * 0.8], c: pick(rnd, [0xc3b9a6, 0xb9ae9c, 0xd6cdbb, 0x9aa2a8]), p: [(i - 1) * (10 + rnd() * 8), h / 2, (rnd() - 0.5) * 12] };
    }),
    { g: ['box', 9, 0.5, 8], c: 0x8a5f4a, p: [0, 9.5, 0] },
    { g: ['cyl', 0.3, 0.3, 14, 5], c: 0x8d949c, p: [8 + rnd() * 6, 7, (rnd() - 0.5) * 10] },
  ],
  islet: (rnd) => [
    { g: ['ico', 5 + rnd() * 4], c: pick(rnd, [0x7d786e, 0x6f6a60]), p: [0, 1.5, 0] },
    { g: ['cone', 3.4, 6, 6], c: 0x857f75, p: [(rnd() - 0.5) * 8, 3, (rnd() - 0.5) * 8] },
    ...(rnd() < 0.5 ? [{ g: ['cone', 1.6, 4.5, 6], c: 0x4e5f36, p: [(rnd() - 0.5) * 9, 4.5, (rnd() - 0.5) * 9] }] : []),
  ],
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
  // 假森林:密集的錐冠帶(兩排),前排壓低 ⇒ 遠看是一片起伏的林線
  forest: (len, H, rnd) => [
    ...rep(len, H * 0.42, (x, s) => {
      const h = H * (0.62 + rnd() * 0.38);
      return [{ g: ['cone', s * 0.62, h, 5], c: pick(rnd, [0x3f4e2e, 0x475838, 0x364527]), p: [x, h / 2, -H * 0.3] }];
    }),
    ...rep(len, H * 0.3, (x, s) => {
      const h = H * (0.45 + rnd() * 0.35);
      return [{ g: ['cone', s * 0.66, h, 5], c: pick(rnd, [0x44532f, 0x4e5f36]), p: [x, h / 2, H * 0.2] }];
    }),
  ],
  // 假城市:高低錯落的量體天際線 + 幾支塔尖;前排壓低成一道低矮街廓
  city: (len, H, rnd) => [
    ...rep(len, H * 0.36, (x, s) => {
      const h = H * (0.35 + rnd() * 0.65), w = s * (0.5 + rnd() * 0.4);
      return [
        { g: ['box', w, h, w * 0.9], c: pick(rnd, [0x5d6672, 0x69727e, 0x525b66, 0x757e89]), p: [x, h / 2, -H * 0.2] },
        // 塔尖只加在**還有餘裕**的那幾棟上(不然最高那一棟加上去就頂破天花板)
        ...(h < H * 0.76 && rnd() < 0.3
          ? [{ g: ['cyl', w * 0.06, w * 0.03, H * 0.22, 4], c: 0x8d949c, p: [x, h + H * 0.11, -H * 0.2] }] : []),
      ];
    }),
    ...rep(len, H * 0.24, (x, s) => {
      const h = H * (0.14 + rnd() * 0.18);
      return [{ g: ['box', s * 0.86, h, s * 0.5], c: pick(rnd, [0x6f7883, 0x7d8791]), p: [x, h / 2, H * 0.22] }];
    }),
  ],
  // 假海:遠方的低平島影 + 一道霧色海平帶(海面本身是 terrain.js 的外環水盤,這裡只補「有東西」)
  sea: (len, H, rnd) => [
    { g: ['box', len, H * 0.34, H * 0.5], c: 0x7f8c98, p: [0, H * 0.17, 0] },
    ...rep(len, H * 3.4, (x, s) => {
      const h = H * (0.5 + rnd() * 0.5);
      return [
        { g: ['cone', s * 0.16, h, 5], c: pick(rnd, [0x64707c, 0x59646f]), p: [x, h / 2, -H * 0.2] },
        ...(rnd() < 0.5 ? [{ g: ['cone', s * 0.1, h * 0.6, 5], c: 0x6c7884, p: [x + s * 0.14, h * 0.3, H * 0.1] }] : []),
      ];
    }),
  ],
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
