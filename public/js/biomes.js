// ============ 地貌系統:五類地被 + 圖資建物 + 兵線淨空 ============
// 依衛星影像逐點分類五種地貌,鋪設對應的 3D 地物:
//   綠地   — 竹林(大小不一的群落)/ 闊葉林 / 針葉林(高海拔)
//            + 神木群落:全球實存 >65m 巨樹樹種,同種群聚、株高各異(GIANT_DEFS),
//              樹身掛鳥巢/樹屋/附生植物/垂藤(GIANT_DECO)
//   裸露地 — 芒草 / 箭竹 / 灌木 / 多肉植物
//            + 巨岩地標:世界名岩取材(烏魯魯/大霸尖山/獅子岩…,MEGALITHS)
//              與特徵基因合成岩(synthMegalith);岩上有電塔/石屋/疊石/鳥巢/斷崖樹
//   市區   — 依 OSM 圖資設置建物(住宅/商辦/醫院/學校/車站/寺廟/教堂/清真寺/
//            博物館/電塔/工廠/城堡/燈塔/佛塔/體育場),離線時退回程序生成街區;
//            一般建物分七款立面樣式(店面/陽台/帷幕/絲帶窗…)× 擴充色盤
//   水體   — 不鋪地物(水面由 terrain.js 處理)
//   濕地   — 紅樹林 / 蘆葦(僅低海拔成立)
// 預設場地的 mix(venues.js)會對分類加權,做出「單一 80% / 混合」的場地感。
// 兵線走廊保持淨空(寬度 > 4 台機甲並行),主堡與防禦塔周圍同樣清場。
// 植被全部用 InstancedMesh(低多邊形 + 分層樹冠),整張圖數十個 draw call。
// 亂數以戰場中心為種子:同一房間所有玩家看到同一片森林。
//
// 超尺度原則(2026-07-09;2026-07-10 佔地對齊現實比例):士兵顯示高 3.2m ≈ 真人 ×1.8,
// 建物高度與佔地同乘 ×1.8 → 建物:士兵比例與現實一致;神木/巨岩跟著等比放大(×1.35)。
// 立面用程序生成窗格貼圖(賽璐璐「畫上去的窗」)取代單色塊;
// 建物同時輸出碰撞柱(group.userData.blockers)— 限制玩家行動但不封鎖,
// 兵線走廊由淨空網格保證暢通(佔地放大後改用半對角掃走廊),無人機永遠可以飛越屋頂。
// 立體掩體三本柱(2026-07-10):建物 26~170m,神木 / 巨岩隨等比放大可達 ~220m,
// 三者皆登記碰撞柱作障礙與隱蔽;神木與巨岩先於一般植被佔位,小植被/地被自動避開。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  ENV, solveTowerSites, siteCPs, mapArg, WATER, MAPGEO, LOS, GAME, objHeightMax, objScaleFit,
  WORLD_EDGE, edgeWallInsetM, edgeWallHM, edgeWallDeepM, xzToLL, SLOPE, slopeDeg,
  CHARACTERS, INK_CTR, UNITS,
} from './data.js';
import { llToWorld } from './terrain.js';
import { pruneRoads, quantizeRoads, GRID_HW } from './roadgrid.js';
import { geoGet, geoPut, geoKey } from './geocache.js';
import { osmRelayKey } from './osmrelay.js';
import {
  OSM_AREA_KEYS, projectAreaRecord, catalogAreas,
  pointInProjectedArea, mergeAreaGaps,
} from './osmAreas.js';
import {
  OSM_FEATURE_QUERY_VERSION, osmFeatureQuery, osmFeatureQuotas, osmRoadQuery, osmRoadQuotas,
  parseOsmFeatureElements, osmRoadsFromElements,
} from './osmQuery.js';
import { toonMat, toonGradient, envMat, bakeContactAO } from './hazards.js';
import { mulberry32 } from './rng.js';
import { buildGroundCover, makeFootprintIndex } from './ground.js';
import { buildLandField } from './landfield.js';
import { setLandField } from './toon.js';
import { vegPartXform, partId, partJitter } from './xform.js';
import { SignSheet, resolveName, resolveRef, signAspect } from './worldtext.js';
import { beaconAnchors, planBeaconSites, buildBeacon, beaconCollider, beaconSeed, mergeGeos } from './beacons.js';
// 邊界牆型錄 / 緩衝空間布景 / 視線邊界背景(2026-08-11 使用者定案)——
// 型錄、切分規則、落點規劃全在那一支(純資料、零 THREE、離線可驗);本檔只負責取樣地貌與建幾何。
import {
  EDGE_WALL, EDGE_MOTION, WALL_KINDS, BACKDROP_KINDS, planWallRuns, planWallKinds, wallParts, wallVariant, wallSlopeTier, edgeSeed, partBox,
  planBufferProps, propParts, planBackdrop, backdropParts,
} from './edgewall.js';
import { libGeo } from './partlib.js';
// 通過零件台的 v5/v6 建築：選款與每款一批的執行期建模縫。
import { fitApprovedBuilding, makeApprovedBuildingBatch } from './approvedBuildingModels.js';
import { generatedApprovedVehicleModelAt } from './approvedVehicleModels.js';
import { makeRuntimePartModel } from './runtimePartModel.js';
import { buildOsmPolygonBuildings } from './osmBuilding.js';
import { buildOsmAreaObjects } from './osmAreaObjects.js';
// 鳥群 / 魚群 / 貓 / 狗 (2026-08-16 序 11 ⑥-2 / 2026-08-27 生態擴充; 零 THREE 的積分器)
import {
  FLOCK, FISH, CAT, DOG,
  planFlockRoutes, planFishRoutes, planCatRoutes, planDogRoutes,
  flockInit, flockStep, flockHeading, wingAngle, tailAngle, bounceOffset,
  wildlifeInit, wildlifeStep, wildlifeHeading,
  birdParts, fishParts, catParts, dogParts,
} from './wildlife.js';
// 平整垂直牆面板 + 窗格貼齊(2026-08-13;零 import 的純模組,離線工具吃同一支 —— 面板的
// 定義只有一份,見該檔檔頭)
// 場址配置規則(2026-08-03 使用者定案三條:市區都市計畫 / 綠地樹冠羞避 / 裸露地地質排列)——
// 規則本體全在 siteplan.js(純幾何、零 THREE、離線可驗),本檔只負責「餵地形/淨空、收成果」。
import {
  CIVIC_KINDS, CIVIC_TREES, roadFaceRy, planBlocks, buildCivic, civicColliders,
  planShyGrove, ROCKFIELD, strikeRad, planRockField, plotSeed, frac,
} from './siteplan.js';
// 低功耗旗標的**唯一真相**仍是 mobile.js(localStorage svs_lowpower);世界文字的 atlas
// 解析度跟著它降,MUST NOT 在此另讀一次 localStorage(第二份預設值遲早分家)。
import { lowPower } from './mobile.js';
import { planClimbRoutes, buildClimbMeshes, MAX_BODY_R } from './climb.js';
import { harvestOsm, mergeCorpus, localeOf, signCopy } from './vernacular.js';
import { VENUE_TEXT } from './venueText.js';
import { drawFlag, pickFlagIso, flagSeed, sideIsoRoster, isoOfFlagEmoji, FLAG_RATIO } from './flags.js';
// 落花 / 落葉粒子的**規則層**(2026-08-16 ⑤-4;零 THREE、只 import rng.js —— 同 edgewall /
// flags / wallpanel 的邊界)。本檔只負責「把最終的植被實例名冊翻成樹冠、建幾何、逐幀寫矩陣」。
import { PETAL, petalSeason, petalTones, planPetalFields, stepPetal, petalRnd } from './petals.js';
// 葉片卡冠層的**排列規則層**(2026-08-16 ②-1;零 THREE、只 import rng.js —— 同上一條的邊界)。
// 本檔只負責「把純資料的卡片名冊組成 BufferGeometry、畫遮罩、接進既有的那一行 InstancedMesh」。
import { CARD, cardEnvelope, cardCount, planCards, cardRnd, leafSurfId } from './leafcard.js';
// `REFL` / `seaSoft` = 水面倒影塊(⑤-3)的形狀常數與海浪參數:**MUST NOT 在本檔手寫**
// (同 `SEA_M`/`SEA_SEG` 的紀律 —— 消費端手寫 = 改了 toon.js 那邊只動到一半)。
// `SURF_ID` / `inkRepeat` / `INK_CONTRIB_NONE` = 立體結構的線工授權(2026-08-16 序 12b;S3/S4)。
// 貢獻一律**推導**(`inkRepeat` 的節距軸 / `inkCtrM` 的尺寸軸),唯一容許手寫的是具名否決值。
// `toonPlain` = **賽璐璐學派的第三個入口**(2026-08-16 序 12;§0-b):不掛 rim / gInfo,
// 但**掛學派**。本檔這四處(GLB 植被的不透明樹幹 / 洞頂 / 潮間帶 / 水簾)以前是裸的
// `new THREE.MeshToonMaterial` ⇒ 換學派時它們會留在舊制,而畫面上只表現成「同一棵樹
// 葉子是硬切的、樹幹還是三階 ramp」,沒有任何錯誤訊息。一個場景 MUST 只有一套量化
// (`audit_cel_pipeline` Ⅺ⑧ 的凍結名冊守著:名冊非空 ⇒ `celSchool` 的 def MUST NOT 是 'b')。
import {
  WIND, markShared, surfGroup, joinSurfGroup, REFL, seaSoft, swampSoft, celWindTime, celWindAmount, celWindHeading, celWaveAmount,
  isWeatherFrozen, getWeatherDynamics,
  SURF_ID, inkRepeat, INK_CONTRIB_NONE, toonPlain,
} from './toon.js';
import { buildAquaticWorld, buildRelicObject, relicCollider, RELIC_KINDS } from './aquatics.js';
import { visualPref } from './visualPrefs.js';
import { LORE } from './lore.js';
import { isRuntimeEligibleNatureKey } from './legacyNatureModels.js';
import { nativeFunctionalKind } from './nativeFunctionalBuildings.js';
import {
  PED_PLAN, PED_ARCHETYPES, pedestrianEntranceCollider,
  isPedestrianWay, isPedestrianBridge, planPedestrianNetwork,
} from './pedestrian.js';

const CELL = 10;                 // 淨空網格(m);走廊全寬約 34m > 4×3.5m 機甲
const MAX_VEG = 7000;            // 植被實例上限
const MAX_BUILDINGS = 240;       // 種子建物上限:OSM 圖資 / 程序街區(特殊地標另計 ≤ 60)
const MAX_INFILL = 1200;         // 補間建物上限(立面 InstancedMesh 仍是常數級 10 個)
// 市區補間參數:每個種子沿自身朝向鋪一塊 cols×rows 的街廓網格。
// pitch 36m ≈ 最大佔地(32m)+ 巷弄 ⇒ 大型商辦間僅 4m(< 機甲碰撞直徑 4.6~7.7m)不可穿越
// = 實心掩體;住宅(10~22m)間 14~26m 成街道 = 巷戰路徑。兵線走廊(半寬 17m)恆淨空。
const INFILL = { maxSeeds: 160, pitch: 36, cols: [3, 6], rows: [3, 6], skip: 0.18, gap: 2 };
// 尺度倍率(2026-07-10 改制:步兵 = 真人 1.8m,見 models.js SOLDIER_H)。
// 2026-07-12 佔地改制:建物公稱佔地加大到真實市街量體(住宅 10~22m、商辦 16~32m)——
// 建物佔地:士兵比例對齊現實;神木/巨岩以 giant/mega = 1.35 跟隨佔地等比放大,
// 與建物維持視覺等比(高度公稱值不動,仍是真實公尺)。lm 同步放大:地標量體對齊真實公共建築。
// `bldCap` = 建物高度上限:2026-08-08 使用者定案「所有物件的最高高度限定 N 倍砲塔高度」之後
// 它不再是本檔自己的一個數字,而是 `data.js objHeightMax()` 那個全世界共用的上限
//(舊制手寫 170 = 六倍多的砲塔高,遠高過飛行天花板到地表的餘裕)。MUST NOT 改回字面值。
const OVER = { bldH: 1.0, bldXZ: 1.0, bldCap: objHeightMax(), lm: 1.5, giant: 1.35, mega: 1.35 };
// 植被放大倍率(喬木最誇張,地被小幅)。
// 注意:此表作用在很小的公稱幾何上(針葉樹公稱僅 ~8.7m),放大後的「絕對高度」本就接近真實,
// 故改制不動它 —— 步兵縮到 1.8m 後,樹木相對步兵的比例自動回歸現實。
const VEG_SCALE = {
  bamboo: 1.5, broadleaf: 1.45, birch: 1.4, conifer: 1.5, deadtree: 1.35, mangrove: 1.3,
  conifer2: 1.5, conifer3: 1.45, conifer4: 1.5,
  shrub: 1.2, silvergrass: 1.15, arrowbamboo: 1.2, succulent: 1.15, reed: 1.1,
  sapling: 1.2, redcap: 1.15, browncap: 1.1, parasol: 1.2, toadstool: 1.1,
};
// 植被可見外廓半徑係數(×最終實例 s)：建物、道路、外部場地共用，MUST NOT 各抄一份。
const VEG_FOOT_R = {
  bamboo: 2.2, broadleaf: 3.2, birch: 2.6, conifer: 2.2, deadtree: 2.4, mangrove: 2.8,
  conifer2: 2.4, conifer3: 1.4, conifer4: 3.0,
  shrub: 1.2, silvergrass: 0.9, arrowbamboo: 1.0, succulent: 0.8, reed: 0.8,
  sapling: 1.0, redcap: 0.6, browncap: 0.6, parasol: 0.5, toadstool: 0.5,
};
// 地被級平面植栽(無木質幹/冠):塔堡 1/4 圈內可保留為草原/沙漠背景;名冊之外一律視為實體淨空
const VEG_FLAT = new Set(['silvergrass', 'arrowbamboo', 'succulent', 'reed', 'redcap', 'browncap', 'parasol', 'toadstool']);
// Overpass 鏡像輪替(2026-07-22 倫敦橋數浮動案):主站限流(429/504)是圖資逐局忽有忽無的
// 主因之一 —— 限流回應是即時的,換鏡像重試幾乎不吃載入時間預算;逾時(abort)才放棄。
// 與 tools/bake_venue_lanes.mjs 同一組鏡像。
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// ---- 決定性亂數(mulberry32):全房間共享同一片地貌;唯一縫住 rng.js(見該檔檔頭)----

// ---- 淨空網格 ----
// 主堡淨空半徑:`buildClearance` 登記的那一圈,與 `placeMegaliths` 的名岩退避距同吃這一份
// (兩處各寫一個 70 = 改了其中一個,名岩的退避距悄悄以另一個基準計算,而畫面上只表現成
//  「這張圖的巨岩離主堡近了一點」)。
const BASE_CLEAR_R = 70;
// 砲塔淨空半徑:1/4 射程推導(UNITS.tower.range 一動自己跟著走;推導值 MUST NOT 手寫)
const TOWER_CLEAR_R = UNITS.tower.range / 4;
function cellKey(x, z) { return `${Math.round(x / CELL)},${Math.round(z / CELL)}`; }

// 大型地物 footprint 淨空:巨岩/神木群半徑可達數十公尺,逐格掃整個圓盤
function areaFreeCore(blocked, ignore, x, z, r) {
  const n = Math.ceil(r / CELL);
  const cx = Math.round(x / CELL), cz = Math.round(z / CELL);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const k = `${cx + i},${cz + j}`;
      if (i * i + j * j <= n * n + n && blocked.has(k) && !(ignore && ignore.has(k))) return false;
    }
  }
  return true;
}
function areaFree(blocked, x, z, r) {
  return areaFreeCore(blocked, null, x, z, r);
}
// 走廊淨空(平面背景用):與 areaFree 同一掃描,但塔堡 1/4 圈的格子視為可放 ——
// 公設鋪面/地被小植栽可以鋪進圈內,實體物件(樹/建物/岩/地標)不行
function areaFreeLane(blocked, towerBase, x, z, r) {
  return areaFreeCore(blocked, towerBase, x, z, r);
}
function blockArea(blocked, x, z, r) {
  const n = Math.ceil(r / CELL);
  const cx = Math.round(x / CELL), cz = Math.round(z / CELL);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      if (i * i + j * j <= n * n + n) blocked.add(`${cx + i},${cz + j}`);
    }
  }
}

function buildClearance(cfg, center) {
  const blocked = new Set();
  const towerBase = new Set();   // 塔堡 1/4 圈格:平面背景可放行、實體物件禁行(與 blocked 同一次登記)
  const rings = [];              // 同一圈的圓盤視圖:精確多邊形(圖資建物)走真幾何相交,不吃格子
  const blockPoint = (x, z, r = CELL, ring = null) => {
    const n = Math.ceil(r / CELL);
    const cx = Math.round(x / CELL), cz = Math.round(z / CELL);
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        if (i * i + j * j <= n * n + n) {
          const k = `${cx + i},${cz + j}`;
          blocked.add(k);
          if (ring) ring.add(k);
        }
      }
    }
  };
  const lanesW = cfg.lanes.map((lane) => lane.map(([lat, lng]) => llToWorld(lat, lng, center)));
  for (const lane of lanesW) {
    for (let i = 1; i < lane.length; i++) {
      const [x1, z1] = lane[i - 1], [x2, z2] = lane[i];
      const seg = Math.hypot(x2 - x1, z2 - z1);
      const n = Math.max(1, Math.ceil(seg / 5));
      for (let k = 0; k <= n; k++) {
        blockPoint(x1 + (x2 - x1) * k / n, z1 + (z2 - z1) * k / n, 17);   // 走廊半寬 17m(建物佔地放大後仍不侵走廊)
      }
    }
  }
  // 防禦塔位置周圍清場:與 sim._spawnStructures 共用 solveTowerSites()(前線塔位是解出來的,
  // MUST NOT 用 TOWER_FRACS 自己重算 —— 那會清錯位置、讓建物長在塔上)
  // 名冊走 `siteCPs`:劇情戰役只有防守方有塔,直接讀 st[side] 會拿到 undefined(見該支註)
  for (const sites of solveTowerSites(lanesW, mapArg(cfg))) {
    for (const st of sites) {
      // 砲塔 1/4 射程圈淨空:圈內不與背景實體物件重疊(平面背景另由 areaFreeLane 放行)
      for (const p of siteCPs(st)) {
        blockPoint(p.x, p.z, TOWER_CLEAR_R, towerBase);
        rings.push({ x: p.x, z: p.z, r: TOWER_CLEAR_R });
      }
    }
  }
  for (const side of ['SWARM', 'STEEL']) {
    const [x, z] = llToWorld(cfg.bases[side][0], cfg.bases[side][1], center);
    blockPoint(x, z, BASE_CLEAR_R, towerBase);
    rings.push({ x, z, r: BASE_CLEAR_R });
  }
  return { blocked, towerBase, rings };
}

// ---- 地貌分類(影像顏色 + 高程 + 場地 mix 加權)----
function weightedPick(mix, rnd) {
  let sum = 0;
  for (const k in mix) sum += mix[k];
  let r = rnd() * sum;
  for (const k in mix) { r -= mix[k]; if (r <= 0) return k; }
  return null;
}

// 純影像判(零亂數;2026-08-05 抽成單一縫):classify 的第一層 + urbanPts 收集的信任閘同吃。
// 抄第二份色彩門檻 = 兩份規則遲早分家(症狀是「植被說這裡是市區、種子閘說不是」)。
// 注意「低飽和灰 → urban」對裸岩/陰影/道路是**系統性誤判** —— 這正是建物種子 MUST NOT
// 只信這一支、還要過「圖資查詢失敗才當備援」那道閘的原因(見 urbanPts 收集處)。
function classifyImg(rgb) {
  if (!rgb) return null;
  const [r, g, b] = rgb;
  if (b > r + 14 && b > g + 6) return 'water';
  if (g > r + 10 && g > b + 12) return 'green';
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  if (sat < 24) return 'urban';              // 低飽和灰 → 人工地貌
  return r > b + 12 ? 'bare' : 'green';      // 棕黃 → 裸露地
}

function classify(rgb, h, mix, rnd) {
  let c = classifyImg(rgb);
  if (mix && rnd() < 0.55) c = weightedPick(mix, rnd) || c;   // 場地類型加權
  if (!c) c = h > 400 ? 'bare' : 'green';                     // 無影像時粗略猜
  if (c === 'wet' && h > 8) c = 'green';                      // 濕地只在低海拔
  return c;
}

// ---- 植被幾何(低多邊形;key='foliage'/'conifer'/'grass' 依季節換色)----
const cyl = (r1, r2, h, n = 5) => new THREE.CylinderGeometry(r1, r2, h, n);
const cone = (r, h, n = 5) => new THREE.ConeGeometry(r, h, n);
const ico = (r) => new THREE.IcosahedronGeometry(r, 0);

// 每型多零件 = 分層樹冠/主幹/枝節,擺脫「一根柱 + 一顆球」的扁平輪廓;
// 每個 part 一個 InstancedMesh(draw call),整批仍是常數級
const VEG_DEFS = {
  bamboo:      { parts: [{ g: cyl(0.10, 0.14, 6.5), y: 3.25, c: 0x8fae4e },
                         { g: cone(1.1, 2.4), y: 7.4, key: 'foliage' },
                         { g: cone(0.8, 1.6), y: 5.6, key: 'foliage', sy: 0.9 }] },
  // 闊葉喬木:**不對稱寬展冠**(2026-08-06 使用者質疑「新舊物件結構這麼像」後重寫骨架)——
  // 舊制是「兩顆同軸疊球」,而 birch/shrub/conifer2 也都是同一個骨架 ⇒ `lib:` 換的只有每一團的
  // 表面起伏,換再多不同樹種的照片,這幾型看起來還是同一棵樹。闊葉的識別特徵是冠幅大於半個
  // 樹高、主冠偏心、側簇各自朝不同方位散開。
  broadleaf:   { parts: [{ g: cyl(0.22, 0.40, 3.2), y: 1.6, c: 0x6b4a2f },
                         { g: cyl(0.10, 0.14, 2.2, 5), y: 3.6, c: 0x5f452c },   // 主分枝
                         { g: cyl(0.09, 0.13, 2.0, 5), y: 4.1, px: 0.85, rz: -0.62, c: 0x5f452c },   // 斜出側枝(外端朝上)
                         { g: cyl(0.09, 0.13, 1.8, 5), y: 3.9, pz: -0.8, rx: 0.58, c: 0x5f452c },
                         { g: ico(2.7), y: 5.1, px: 0.35, key: 'foliage', sy: 0.62 },   // 主冠偏心壓扁
                         { g: ico(1.7), y: 5.9, px: -1.5, pz: 0.5, key: 'foliage', sy: 0.66 },
                         { g: ico(1.7), y: 5.4, px: 1.7, pz: -0.9, key: 'foliage', sy: 0.6 },
                         { g: ico(1.2), y: 6.5, px: -0.3, pz: -0.6, key: 'foliage', sy: 0.7 }],
                 // 整樹節點(2026-08-08 §5z-o);規則同 conifer2 那一段。冠形維持 ico 圓潤葉團
                 // (使用者 2026-08-08 定案:寧可從 shrub 挖額度也不換成八面體的稜角冠)。
                 whole: [{ g: cyl(2.22, 2.22, 6.99), y: 3.425, c: 0x6b4a2f, lib: 'tree/bl_wood_a' },
                         { g: cyl(3.06, 3.06, 6.99), y: 3.425, key: 'foliage', lib: 'tree/bl_crown_a' }] },
  // 白樺:**細高窄冠、葉簇沿幹上段縱向錯落**(與 broadleaf 的寬展冠成對比)——
  // 先鋒樹種的樹型:幹細直、冠幅窄、葉簇一路散到頂,不是頂著兩顆球。
  birch:       { parts: [{ g: cyl(0.16, 0.22, 4.6), y: 2.3, c: 0xe8e4dc },
                         { g: cyl(0.07, 0.10, 1.6, 4), y: 5.0, px: 0.5, rz: -0.85, c: 0xd8d2c6 },   // 細枝(外端朝上)
                         { g: cyl(0.07, 0.10, 1.5, 4), y: 5.8, px: -0.45, rz: 0.85, c: 0xd8d2c6 },
                         { g: ico(1.2), y: 5.2, px: 0.75, key: 'foliage', sy: 1.15, lib: 'tree/vleaf_a12' },   // 縱向拉長的窄簇
                         { g: ico(1.2), y: 6.2, px: -0.7, key: 'foliage', sy: 1.1, lib: 'tree/vleaf_a12' },
                         { g: ico(1.2), y: 7.1, pz: 0.55, key: 'foliage', sy: 1.05 },
                         { g: ico(1.2), y: 7.9, key: 'foliage', sy: 0.95 }] },
  // 枯立木(2026-08-07 §5u):**整樹節點** —— `whole:` 是**一列以上**的陣列(2026-08-08 改;
  // 枯幹單色不換季不是軟性 ⇒ 它恰好只需要一列,見 buildVegMeshes 的說明),載到 ⇒ 只畫那幾顆節點
  // (T2 實拍漂白刺果松枯幹;缺枝/補接痕當砍伐或雷擊損毀 —— 使用者定案「自然的樹木
  // 本來就不完美」),載不到 ⇒ **逐位元**退回 parts 三件式(比任何 fuse 近似都乾淨)。
  // 佈局數學(vegSpan/散布)仍只讀 parts(partGeo 紀律);whole.g 只當入庫包絡與世界尺度。
  deadtree:    { parts: [{ g: cyl(0.14, 0.30, 4.4), y: 2.2, c: 0x6a5a48 },
                         { g: cyl(0.06, 0.1, 2.2, 5), y: 4.6, c: 0x5c4e40 },
                         { g: cyl(0.05, 0.08, 1.6, 4), y: 3.6, c: 0x5c4e40 }],
                 whole: [{ g: ico(3.2), y: 3.05, c: 0x9a8b74, lib: 'tree/snag_a' }] },
  conifer:     { parts: [{ g: cyl(0.20, 0.32, 2.0), y: 1.0, c: 0x5d4027 },
                         { g: cone(2.3, 3.4, 7), y: 3.2, key: 'conifer' },      // 三層塔狀樹冠
                         { g: cone(1.8, 3.0, 7), y: 5.4, key: 'conifer' },
                         { g: cone(1.2, 2.6, 7), y: 7.4, key: 'conifer' }],
                 // 整樹節點(2026-08-09):與 conifer2 同一支星盤生成器,只換樹種參數
                 // (`STAR_SPECIES.fir`:5 角 / 谷底 0.55 / 凹面 1.7)。三種針葉在此之前
                 // **一顆庫節點都沒有** —— 那三組樹種參數自 §5z-r 寫出來就沒上過畫面。
                 whole: [{ g: cyl(0.33, 0.33, 8.30), y: 4.133, c: 0x5d4027, lib: 'tree/cf1_wood_a' },
                         { g: cyl(2.23, 2.23, 8.30), y: 4.133, key: 'conifer', lib: 'tree/cf1_crown_a' }] },
  // 針葉林幾何多樣化(2026-07-12):三角錐塔之外再添三款輪廓,同林異形
  conifer2:    { parts: [{ g: cyl(0.18, 0.3, 2.4), y: 1.2, c: 0x54402a },       // 老雲杉:不規則簇疊冠
                         { g: ico(2.0), y: 3.2, key: 'conifer', sy: 0.5 },   // 老雲杉:下層枝盤外伸、上層急收
                         { g: ico(1.6), y: 4.15, px: 0.62, pz: 0.3, key: 'conifer', sy: 0.46 },
                         { g: ico(1.6), y: 4.9, px: -0.58, pz: -0.35, key: 'conifer', sy: 0.44 },
                         { g: ico(1.4), y: 5.7, px: 0.4, key: 'conifer', sy: 0.42 },
                         { g: ico(1.4), y: 6.45, px: -0.34, pz: 0.28, key: 'conifer', sy: 0.4 },
                         { g: ico(0.9), y: 7.15, key: 'conifer', sy: 0.6 },
                         { g: cone(0.5, 1.9, 5), y: 8.0, key: 'conifer' }],   // 突出頂梢
                 // 整樹節點(2026-08-08 §5z-o):簡單幾何版一株樹 = **木質 + 葉冠兩顆節點**
                 // (為什麼不能併成一顆:見 buildVegMeshes)。兩顆是 normalize_parts `--group`
                 // **共用同一個變換**烤出來的 ⇒ 相對位置烤進頂點,兩列因此共用同一組 `y`
                 // (= 聯集半跨,讓樹底落在 0),少一個可以寫錯的地方。
                 // 逐部件 `lib:` 同輪退場 —— whole 載到時 parts 整組不畫,那幾列永遠不會再被
                 // 解析,留著只會讓預算帳多算一份(而且對照台會把它們列成孤兒)。
                 // 冠形 = **疊層星盤**(使用者 2026-08-08 手稿,§5z-r):上視各角邊長內凹、
                 // 側視每層下緣內凹、層間平面錯開疊加、越上層角越短但頂角越尖、頂部不露幹、
                 // **不需要樹枝**。一層 = 2 × 角數 × arc 面(6 角 × arc 2 × 8 層 = 192)。
                 // ⚠ **葉冠的包絡與整株同高不是筆誤**:星盤把「尖端」還給了葉冠 —— 最上層星盤
                 // 自己的頂點就是樹尖(而且是綠的),舊制那根**木質**頂梢(`--spire`)同輪退場
                 // ⇒ 葉冠節點的頂 = 整株的頂。envelope 若沿用舊的 7.41,intake 的縱向契約會紅
                 // 在「葉冠比包絡高」上,而那正是這一輪要的形狀。木質那一列反而縮到樹尖之下。
                 whole: [{ g: cyl(0.24, 0.24, 8.68), y: 4.251, c: 0x54402a, lib: 'tree/cf2_wood_a' },
                         { g: cyl(1.92, 1.92, 8.52), y: 4.251, key: 'conifer', lib: 'tree/cf2_crown_a' }] },
  conifer3:    { parts: [{ g: cyl(0.14, 0.22, 1.2), y: 0.6, c: 0x5d4027 },      // 柱狀絲柏:細長紡錘
                         { g: cone(1.1, 7.6, 6), y: 4.9, key: 'conifer' },
                         { g: cyl(0.9, 1.3, 2.2, 6), y: 2.2, key: 'conifer' },
                         { g: cone(0.5, 2.0, 5), y: 8.6, key: 'conifer' }],
                 // `STAR_SPECIES.cypress`:8 角 / 谷底 0.70 / 凹面 2.4 —— 角多而淺、輪廓最直,
                 // 配上這一型自己的細高包絡(r 1.30 × 全高 9.60)才是「柱狀」那個身分
                 whole: [{ g: cyl(0.15, 0.15, 9.16), y: 4.560, c: 0x5d4027, lib: 'tree/cf3_wood_a' },
                         { g: cyl(1.26, 1.26, 9.16), y: 4.560, key: 'conifer', lib: 'tree/cf3_crown_a' }] },
  conifer4:    { parts: [{ g: cyl(0.12, 0.36, 8.2), y: 4.1, c: 0x66492e },      // 雪松:平展層枝盤
                         { g: cyl(2.6, 3.1, 0.9, 8), y: 3.0, key: 'conifer' },
                         { g: cyl(2.0, 2.5, 0.85, 8), y: 4.6, key: 'conifer' },
                         { g: cyl(1.4, 1.9, 0.8, 8), y: 6.1, key: 'conifer' },
                         { g: cyl(0.7, 1.2, 0.75, 7), y: 7.4, key: 'conifer' },
                         { g: cone(0.5, 1.3, 6), y: 8.0, key: 'conifer' }],
                 // `STAR_SPECIES.cedar`:4 角 / 谷底 0.45 / 凹面 1.4 —— 角少而深、層盤最平展,
                 // 包絡最寬(r 3.10)⇒ 與絲柏在同一片林子裡一眼分得出來
                 whole: [{ g: cyl(0.33, 0.33, 8.25), y: 4.109, c: 0x66492e, lib: 'tree/cf4_wood_a' },
                         { g: cyl(3.00, 3.00, 8.25), y: 4.109, key: 'conifer', lib: 'tree/cf4_crown_a' }] },
  // sf(軟性覆寫;2026-08-04):芒花穗/箭竹葉/蘆葦有固定色 ⇒ 沒有 key,但它們正是使用者
  // 點名的「芒草」。細勾線與擺動由 `vegSoftKind` 讀這一欄,MUST NOT 另開一張名單。
  silvergrass: { parts: [{ g: cone(0.85, 1.5), y: 0.75, key: 'grass' },
                         { g: cone(0.4, 1.4, 5), y: 1.5, c: 0xd8cfa8, sf: 'grass' }] },   // 抽穗的芒花
  arrowbamboo: { parts: [{ g: cone(0.9, 2.3), y: 1.15, c: 0x5c7a3a, sf: 'grass' },
                         { g: cone(0.5, 1.5), y: 2.2, c: 0x6b8a44, sf: 'grass' }] },
  // 灌木:**叢生多幹、寬大於高**(舊制是縮小版的樹:兩顆同軸疊球)——灌木的識別特徵正好是
  // 「沒有主幹、幾叢從地面各自長開」,故三團並排、高度互不相同。只有最大那一團接零件庫:
  // 灌木 1909 個 instance 是全族最貴的一列(見 tri_budget families.veg),其餘兩團留保險絲
  // —— 它們本來就被主團擋住大半。
  shrub:       { parts: [{ g: ico(0.9), y: 0.55, px: 0.3, key: 'foliage', sy: 0.85, lib: 'tree/bush_a09' },
                         { g: ico(0.62), y: 0.42, px: -0.72, pz: 0.3, key: 'foliage', sy: 0.8 },
                         { g: ico(0.5), y: 0.36, px: -0.15, pz: -0.7, key: 'foliage', sy: 0.75 }] },
  succulent:   { parts: [{ g: cyl(0.5, 0.7, 0.9, 6), y: 0.45, c: 0x7a9c74 },
                         { g: cyl(0.28, 0.4, 0.7, 6), y: 1.1, c: 0x8cae82 }] },
  mangrove:    { parts: [{ g: cyl(0.25, 0.5, 1.8), y: 0.9, c: 0x54412e },
                         { g: cyl(0.08, 0.12, 1.4, 4), y: 0.6, c: 0x4a3826 },   // 支柱根
                         { g: cyl(0.08, 0.12, 1.3, 4), y: 0.55, px: 0.3, pz: -0.2, rz: 0.42, c: 0x4a3826 },   // 支柱根(多方位;上端 MUST 咬進幹面)
                         { g: cyl(0.08, 0.12, 1.2, 4), y: 0.5, px: -0.28, pz: 0.22, rz: -0.4, c: 0x4a3826 },
                         { g: ico(2.0), y: 2.5, px: 0.4, key: 'foliage', sy: 0.42, lib: 'tree/vleaf_a20' },   // 低平寬冠(潮間帶樹型)
                         { g: ico(1.4), y: 3.0, px: -0.9, pz: 0.5, key: 'foliage', sy: 0.4 }] },
  reed:        { parts: [{ g: cone(0.35, 1.9, 4), y: 0.95, c: 0xa9b06a, sf: 'grass' }] },
  // ---- 神木林床層(森林分層最底層):樹苗 + 各式香菇 ----
  // 分層邏輯:神木冠層 → 中小型同科喬木(sub-canopy,沿用 conifer*/broadleaf/birch)
  // → 樹苗/灌木叢(shrub)/各式香菇(林床)。香菇無 key(不吃季節葉色):固定菌色,
  // 蕈柄淺、蕈傘各異即「各品種」;蕈傘用壓扁 ico(低多邊形半球)貼合日漫 toon 風。
  sapling:     { parts: [{ g: cyl(0.05, 0.09, 1.6, 5), y: 0.8, c: 0x6b4a2f },
                         { g: cyl(0.04, 0.06, 0.9, 4), y: 1.5, c: 0x5f452c },      // 細分枝
                         { g: ico(0.55), y: 1.65, key: 'foliage', sy: 0.9 },
                         { g: ico(0.36), y: 2.05, key: 'foliage', sy: 0.85 }] },   // 疊層幼冠
  redcap:      { parts: [{ g: cyl(0.16, 0.24, 1.1, 7), y: 0.55, c: 0xf2ece0 },     // 乳白蕈柄
                         { g: cyl(0.82, 0.5, 0.14, 10), y: 1.02, c: 0xf5ecd8 },    // 傘底菌褶承盤
                         { g: ico(0.95), y: 1.28, sy: 0.52, c: 0xc0392b },         // 半球紅傘(毒鵝膏式)
                         { g: ico(0.14), y: 1.55, pz: 0.42, c: 0xfbf6ea },         // 白斑
                         { g: ico(0.13), y: 1.6, px: 0.38, pz: -0.2, c: 0xfbf6ea },
                         { g: ico(0.12), y: 1.52, px: -0.44, c: 0xfbf6ea }] },
  browncap:    { parts: [{ g: cyl(0.2, 0.3, 0.8, 7), y: 0.4, c: 0xd9c3a0 },        // 矮胖蕈柄
                         { g: cyl(0.9, 0.58, 0.1, 10), y: 0.86, c: 0xe4d6b8 },     // 菌褶
                         { g: ico(1.05), y: 1.0, sy: 0.4, c: 0x7a4a2c }] },        // 扁圓褐傘(牛肝菌/香菇感)
  parasol:     { parts: [{ g: cyl(0.08, 0.12, 1.7, 6), y: 0.85, c: 0xe8dcc4 },    // 細長蕈柄
                         { g: cone(0.62, 0.55, 9), y: 1.9, c: 0xb79063 },          // 錐形陽傘
                         { g: ico(0.24), y: 2.12, sy: 0.7, c: 0xa07c4e }] },       // 傘心凸頂
  toadstool:   { parts: [{ g: cyl(0.06, 0.09, 0.55, 5), y: 0.28, c: 0xe4d2b0 },   // 蜜環菌叢:一叢高低錯落小菇
                         { g: ico(0.26), y: 0.62, sy: 0.6, c: 0xd9a441 },
                         { g: cyl(0.05, 0.08, 0.42, 5), y: 0.21, px: 0.42, pz: 0.18, c: 0xe4d2b0 },
                         { g: ico(0.2), y: 0.48, px: 0.42, pz: 0.18, sy: 0.6, c: 0xd7a94f },
                         { g: cyl(0.05, 0.07, 0.36, 5), y: 0.18, px: -0.36, pz: 0.24, c: 0xe4d2b0 },
                         { g: ico(0.18), y: 0.42, px: -0.36, pz: 0.24, sy: 0.6, c: 0xcf9a3a },
                         { g: cyl(0.04, 0.06, 0.3, 5), y: 0.15, px: 0.1, pz: -0.4, c: 0xe4d2b0 },
                         { g: ico(0.15), y: 0.36, px: 0.1, pz: -0.4, sy: 0.6, c: 0xdcae52 }] },
  // 邊界巨岩簇(裸露地邊界帶專用;InstancedMesh 管線,公稱 ~5m × s 1.4~3.4 → 7~17m)
  // j:2 = 細節抖動振幅加倍(xform.js dj):每簇岩塊大小/稜線各異,不再同一張剪影
  borderrock:  { parts: [{ g: ico(2.4), y: 1.4, j: 2, c: 0x8f8878 },
                         { g: ico(1.7), y: 0.9, px: 2.2, sy: 0.75, j: 2, c: 0x7d786c },
                         { g: ico(1.3), y: 0.7, px: -1.9, pz: 1.1, sy: 0.7, j: 2, c: 0x968e7c },
                         { g: cone(2.2, 1.8, 7), y: 0.9, pz: -1.6, j: 2, c: 0x857e70 }] },
};

const TRUNK_TYPES = new Set([
  'bamboo', 'broadleaf', 'birch', 'conifer', 'deadtree', 'mangrove',
  'conifer2', 'conifer3', 'conifer4', 'sapling',
]);

/** 一般樹幹碰撞吃 VEG_DEFS 的木質首件與 vegPartXform，同畫面實例共用同一把變換尺。 */
function registerTreeTrunkColliders(items, blockers) {
  const box = new THREE.Box3(), size = new THREE.Vector3(), center = new THREE.Vector3();
  const mat = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  let count = 0;
  for (const type of TRUNK_TYPES) {
    const part = VEG_DEFS[type]?.parts?.[0];
    if (!part) continue;
    if (!part.g.boundingBox) part.g.computeBoundingBox();
    for (const it of items[type] || []) {
      const xf = vegPartXform(part, it);
      pos.fromArray(xf.pos); quat.fromArray(xf.quat); scl.fromArray(xf.scl);
      mat.compose(pos, quat, scl);
      box.copy(part.g.boundingBox).applyMatrix4(mat);
      box.getSize(size); box.getCenter(center);
      const r = Math.max(size.x, size.z) / 2;
      blockers.push({
        x: center.x, z: center.z, y: box.min.y,
        r: Math.max(0.05, r), h: Math.max(0.1, size.y), cl: 'tree', name: `trunk_${type}`,
      });
      count++;
    }
  }
  return count;
}

// ---- 神木(全球實存 >65m 巨樹樹種;綠地超尺度地標植被)----
//   紅杉(海岸紅杉 115m)/ 巨杉(世界爺 95m)/ 杏仁桉(澳洲王桉 100m)/
//   花旗松(100m)/ 西加雲杉(97m)/ 黃柳桉(婆羅洲熱帶巨樹 100m)/ 台灣杉(90m)/
//   亞馬遜天使樹(Dinizia excelsa 88m)/ 克林奇南洋杉(紐幾內亞 90m)/
//   蜂樹(東南亞 Koompassia 88m)/ 智利柏(巴塔哥尼亞 Fitzroya 70m+)
// 同一種神木成群聚落、株高各異(s = 0.75~1.10 → 公稱高的 75%~110%,即真實世界株高區間);
// 每株多零件建模:板根/樹皮絲帶/斜出枝節/多層樹冠(px/pz = 距軸心偏移,
// rx/rz = 枝幹傾角),樹幹登記碰撞柱 = 立體障礙與隱蔽。h/r = 公稱高/幹半徑。
//
// `lib:` = AI 零件庫的節點名(2026-08-05,計畫書 P2c 綠地首批):`g` 仍是**保險絲**
// —— 載不到 GLB 就逐位元退回今天的畫面,而佈局數學(giantCrownR 冠幅 / vegSpan 擺幅 /
// 淨空 / 碰撞)一律只讀 `g`(見 partGeo 檔頭:讀庫幾何 = 佈局隨載入成敗分家)。
// 三條選列紀律:
//   ① **只換 ico 冠簇,不換 cone 冠層**:cone 的包絡是 {r, h/2}(如 cone(7,26) = r7/hy13),
//      把一團樹冠塞進去會被拉成柱子;ico 的包絡是球,實拍樹冠正好是球內的團塊。
//   ② **節點半徑 MUST ≤ 該列 fallback 半徑**(且 ≥ 一半)—— 這就是離線外廓契約,
//      `intake_parts.mjs` 逐列驗;所以節點做成尺寸階梯(10/8/7/6/5/4.5/3.5)而不是一顆通用件。
//   ③ **三角形數是預算不是免費的**:實測現行一整株神木只有 259~402 tris、冠簇一顆 20,
//      而 AI 零件一顆 215 ⇒ 逐株換幾件是有上限的(tri_budget.json families.tree:
//      單件 ≤ 現行最重一整株、逐株 Σ 庫零件 ≤ 4× 該株現值)。klinki/alerce 的冠簇半徑
//      只有 2.2~3.0m,比最小節點還小 ⇒ **刻意不換**(硬塞就破契約)。
const GIANT_DEFS = {
  redwood:  { h: 110, r: 3.4, parts: [
    { g: cyl(3.4, 5.6, 7, 7), y: 3.5, c: 0x6e4630 },
    { g: cyl(2.4, 3.5, 40, 7), y: 26, c: 0x7a4a32 },
    { g: cyl(1.4, 2.4, 34, 7), y: 63, c: 0x82503a },
    { g: cyl(0.6, 1.4, 22, 6), y: 91, c: 0x82503a },
    { g: cone(2.6, 8, 3), y: 4, px: 3.4, c: 0x5e3c28 },          // 板根鰭(基部放射狀;鰭尖須貼回幹面)
    { g: cone(2.4, 7, 3), y: 3.5, px: -1.9, pz: 2.8, c: 0x664130 },
    { g: cone(2.4, 7, 3), y: 3.5, px: -1.9, pz: -2.8, c: 0x5e3c28 },
    { g: cyl(2.65, 2.72, 5, 7), y: 40, c: 0x8f9a6e },            // 地衣環帶(淡黃綠)
    { g: cyl(1.4, 2.2, 6, 4), y: 3, px: 3.2, c: 0x38241a },      // 火疤(基部焦黑鑿痕)
    // 側枝外端一律朝上(rz 符號 = −sign(px);真樹分叉向上,不下垂)
    { g: cyl(0.4, 0.6, 9, 5), y: 56, px: 4.5, rz: -1.25, c: 0x6e4630 },
    { g: cyl(0.4, 0.6, 8, 5), y: 48, px: -4, rz: 1.2, c: 0x6e4630 },
    { g: cone(7, 26, 7), y: 96, c: 0x3f7a46 },                   // 頂冠偏亮 = 受光層次
    { g: cone(9, 20, 7), y: 82, c: 0x33643c },
    { g: cone(10, 16, 7), y: 68, c: 0x2e5c38 },
    { g: ico(5), y: 58, px: 6, sy: 0.8, lib: 'tree/canopy_a5', c: 0x33643c },
    { g: ico(5), y: 51, px: -6, sy: 0.8, lib: 'tree/canopy_b5', c: 0x2e5c38 },
    { g: ico(4), y: 74, px: -8, sy: 0.7, c: 0x4a8a4e },          // 受光亮綠簇
    { g: ico(4.5), y: 62, pz: 6.5, sy: 0.75, lib: 'tree/canopy_c45', c: 0x3b7042 },
    // 樹種特徵配件(2026-07-29):毬果簇(紅杉小毬果掛冠緣;R 主導色不吃 gleaf 季節疊色,
    // 錨在既有樹冠簇內 → 接合天然成立;各簇色抖動獨立,見 buildVegMeshes)
    { g: ico(1.4), y: 55.5, px: 6.8, c: 0x6e4a30 },
    { g: ico(1.2), y: 48.5, px: -6.5, c: 0x66452c },
  ] },
  sequoia:  { h: 92, r: 5.6, parts: [
    { g: cyl(5.6, 9.2, 9, 8), y: 4.5, c: 0x7d4a2e },
    { g: cyl(4.0, 5.7, 44, 8), y: 30, c: 0x8a552f },
    { g: cyl(2.2, 4.0, 26, 7), y: 65, c: 0x936030 },
    { g: cyl(0.7, 1.0, 13, 5), y: 50, px: 5.5, rz: -1.3, c: 0x7d4a2e },   // 側枝外端朝上
    { g: cyl(0.7, 1.0, 12, 5), y: 58, px: -5.5, rz: 1.3, c: 0x7d4a2e },
    { g: cone(4.5, 9, 3), y: 4.5, px: 5.6, c: 0x6e4226 },        // 板根鰭(鰭尖貼回幹面)
    { g: cone(4.2, 8, 3), y: 4, px: -3.5, pz: 4.8, c: 0x75462a },
    { g: ico(1.9), y: 12, px: 5.4, sy: 0.8, c: 0x6e4226 },       // 樹瘤
    { g: ico(5), y: 88, px: 4, sy: 0.7, c: 0x55904a },           // 頂部受光亮簇
    { g: ico(9), y: 72, sy: 0.8, lib: 'tree/canopy_c8', c: 0x39683a },
    { g: ico(7), y: 82, lib: 'tree/canopy_a7', c: 0x336033 },
    { g: ico(6), y: 66, px: 7.5, lib: 'tree/canopy_c6', c: 0x4a7a3c },   // 黃綠受光簇
    { g: ico(6), y: 60, px: -7.5, lib: 'tree/canopy_d6', c: 0x336033 },
    { g: ico(5), y: 55, pz: 7, lib: 'tree/canopy_f5', c: 0x39683a },
    { g: cone(5, 10, 6), y: 89, c: 0x336033 },
    { g: cyl(0.24, 0.45, 7, 5), y: 96, c: 0x8a6a4a },            // 突出頂梢枯枝(雷擊痕)
    { g: ico(1.3), y: 63.5, px: 8, c: 0x7a5230 },                // 世界爺毬果簇(冠緣)
    { g: ico(1.1), y: 57.5, px: -8, c: 0x704b2c },
  ] },
  euc:      { h: 98, r: 2.6, parts: [
    { g: cyl(2.2, 3.6, 6, 7), y: 3, c: 0xcfc4b0 },
    { g: cyl(1.6, 2.3, 52, 7), y: 32, c: 0xdbd2c0 },
    { g: cyl(0.9, 1.6, 28, 6), y: 72, c: 0xe3dac8 },
    { g: cyl(0.16, 0.2, 12, 4), y: 20, px: 2.1, c: 0x9a8a76 },   // 剝落樹皮絲帶
    { g: cyl(0.14, 0.18, 10, 4), y: 44, px: -2.0, pz: 0.8, rz: 0.12, c: 0xa89884 },
    { g: cyl(0.15, 0.19, 11, 4), y: 60, px: 1.2, pz: -0.9, rz: -0.1, c: 0xb0a28c },
    { g: ico(3.5), y: 70, px: 3.2, sy: 0.6, c: 0x86985e },       // 低位側簇(銀綠;內緣貼幹,無枝可錨)
    { g: cyl(0.5, 0.9, 18, 5), y: 80, px: 3.5, rz: -0.55, c: 0xcfc4b0 },  // 側枝外端朝上
    { g: cyl(0.5, 0.8, 16, 5), y: 76, px: -3.2, rz: 0.6, c: 0xd6ccba },
    { g: ico(7), y: 90, sy: 0.7, lib: 'tree/canopy_b7', c: 0x5c7a4a },
    { g: ico(5.5), y: 84, px: 8.5, sy: 0.65, lib: 'tree/canopy_a5', c: 0x738a52 },   // 橄欖偏黃簇(桉葉銀綠層次)
    { g: ico(5), y: 80, px: -8, sy: 0.65, lib: 'tree/canopy_b5', c: 0x5c7a4a },
    { g: ico(4.5), y: 83, pz: 4.5, sy: 0.6, c: 0x648250 },       // z 向無側枝 → 內緣貼幹
    { g: ico(4), y: 96, c: 0x7a9058 },
    { g: ico(1.5), y: 86, px: 9, c: 0xe9e2c8 },                  // 桉樹乳白花簇(冠緣,R≥G 不吃 gleaf)
    { g: ico(1.3), y: 84.5, pz: 5, c: 0xe4dcc0 },
  ] },
  dougfir:  { h: 100, r: 2.5, parts: [
    { g: cyl(2.5, 4.0, 6, 7), y: 3, c: 0x5d4027 },
    { g: cyl(1.8, 2.6, 42, 7), y: 27, c: 0x694a2d },
    { g: cyl(2.52, 2.62, 8, 7), y: 13, c: 0x49663a },            // 樹幹苔蘚環帶
    { g: ico(3.2), y: 34, pz: 4.4, sy: 0.55, c: 0x3a7a52 },
    { g: cone(11, 22, 8), y: 52, c: 0x2f5e40 },
    { g: cone(9, 20, 8), y: 65, c: 0x35684a },
    { g: cone(7, 18, 7), y: 78, c: 0x2f5e40 },
    { g: cone(4.5, 16, 7), y: 90, c: 0x35684a },
    { g: cone(2, 11, 6), y: 99, c: 0x2f5e40 },
    { g: ico(4), y: 46, px: 6, sy: 0.6, lib: 'tree/canopy_e4', c: 0x35684a },
    { g: ico(4), y: 42, px: -6, sy: 0.6, lib: 'tree/canopy_e4', c: 0x2f5e40 },
    { g: cone(1.2, 5, 4), y: 47, px: 5.5, rx: Math.PI, c: 0x7fa06a },   // 枝下垂掛松蘿(上端埋進樹冠錐)
    { g: cone(1.0, 4, 4), y: 60, px: -5.0, rx: Math.PI, c: 0x8aa876 },
    { g: ico(1.1), y: 44.4, px: 6.4, c: 0x8a6244 },              // 花旗松垂毬果簇(側簇下緣)
    { g: ico(1.0), y: 40.6, px: -6.4, c: 0x805b3e },
  ] },
  sitka:    { h: 96, r: 2.3, parts: [
    { g: cyl(2.3, 3.7, 5, 7), y: 2.5, c: 0x59452f },
    { g: cyl(1.6, 2.4, 44, 7), y: 27, c: 0x64503a },
    { g: cone(9, 20, 7), y: 54, c: 0x3d6a5e },
    { g: cone(7.5, 18, 7), y: 66, c: 0x467567 },
    { g: cone(6, 16, 7), y: 78, c: 0x3d6a5e },
    { g: cone(3.5, 15, 6), y: 89, c: 0x467567 },
    { g: ico(3.8), y: 46, px: 5.5, sy: 0.55, lib: 'tree/canopy_f38', c: 0x3d6a5e },
    { g: ico(3.8), y: 44.5, px: -5.5, sy: 0.55, lib: 'tree/canopy_f38', c: 0x467567 },
    { g: ico(3.2), y: 44, pz: 5.5, sy: 0.55, lib: 'tree/canopy_e32', c: 0x3d6a5e },
    { g: cone(1.1, 4.5, 4), y: 50, px: 6, rx: Math.PI, c: 0xa8c0a8 },   // 老人鬚地衣(灰綠垂簾)
    { g: cone(0.9, 3.6, 4), y: 62, px: -4.2, rx: Math.PI, c: 0x9db89d },
    { g: ico(3), y: 88, px: 3.2, sy: 0.6, c: 0x529272 },         // 頂部亮青簇
    { g: ico(1.0), y: 44.8, px: 5.9, c: 0x9a7a52 },              // 西加雲杉淺褐毬果簇
    { g: ico(0.9), y: 42.9, pz: 5.8, c: 0x92714a },
  ] },
  meranti:  { h: 95, r: 2.5, parts: [
    { g: cone(3.0, 10, 3), y: 5, px: 2.3, c: 0x8a7354 },         // 板根鰭(鰭尖貼回幹面)
    { g: cone(3.0, 10, 3), y: 5, px: -1.25, pz: 1.95, c: 0x93805e },
    { g: cone(3.0, 10, 3), y: 5, px: -1.25, pz: -1.95, c: 0x8a7354 },
    { g: cyl(1.5, 2.5, 52, 7), y: 30, c: 0xa08462 },
    { g: cyl(0.9, 1.5, 20, 6), y: 66, c: 0xa89068 },
    { g: cyl(0.5, 0.8, 14, 5), y: 74, px: 4, rz: -0.7, c: 0x93805e },     // 側枝外端朝上(傾角勿過斜:枝根會穿出幹身反側)
    { g: cyl(0.5, 0.8, 14, 5), y: 76, px: -4, rz: 0.7, c: 0x93805e },
    // 龍腦香突出傘冠 = **一片攤平的圓盤**(2026-08-06 重寫骨架):四方等高環繞、整層壓到 sy 0.4,
    // 中心只比外圈高一點。舊制的「中心 + 兩側 + 頂上再堆兩層」與 dinizia/tualang 是同一份配方,
    // `lib:` 換的只是每一團的表面起伏,三種樹的剪影還是一樣的。
    { g: ico(12), y: 81, sy: 0.4, lib: 'tree/canopy_i10', c: 0x4a8a3e },
    { g: ico(8), y: 79.5, px: 9.8, sy: 0.36, lib: 'tree/canopy_i8', c: 0x57994a },
    { g: ico(8), y: 79.5, px: -9.8, sy: 0.36, lib: 'tree/canopy_i8', c: 0x4a8a3e },
    { g: ico(8), y: 79, pz: 9.8, sy: 0.36, lib: 'tree/canopy_i8', c: 0x57994a },
    { g: ico(7), y: 79, pz: -9.8, sy: 0.36, c: 0x4a8a3e },
    { g: ico(6), y: 83, px: 4.6, pz: 4.2, sy: 0.42, c: 0x8fa054 },   // 盤上兩處隆起(開花期淡黃;留保險絲控逐株預算)
    { g: ico(5), y: 82.6, px: -4.4, pz: -4.6, sy: 0.42, c: 0x8fa054 },
    { g: cyl(0.1, 0.16, 26, 4), y: 40, px: 1.7, rz: 0.018, c: 0x6a7a44 },   // 纏繞藤蔓(貼幹面、傾角跟隨幹身收分)
    { g: ico(1.5), y: 77.2, px: 10, c: 0xc27a4a },               // 龍腦香翅果簇(掛在冠盤下緣;冠盤高度一改這一顆要跟著走)
    { g: ico(1.3), y: 76.8, pz: 9.5, c: 0xb8703f },
  ] },
  taiwania: { h: 86, r: 2.1, parts: [
    { g: cyl(2.1, 3.4, 5, 7), y: 2.5, c: 0x8a5a38 },             // 紅褐樹皮(台灣杉特徵)
    { g: cyl(1.4, 2.2, 38, 7), y: 24, c: 0x96603a },
    { g: cone(8, 14, 7), y: 45, c: 0x2c6242 },
    { g: cone(6.5, 13, 7), y: 56, c: 0x347050 },
    { g: cone(5, 12, 7), y: 67, c: 0x2c6242 },
    { g: cone(3.2, 11, 6), y: 77, c: 0x347050 },
    { g: cone(1.6, 9, 5), y: 85, c: 0x2c6242 },
    { g: ico(3.5), y: 38, px: 4.5, sy: 0.65, lib: 'tree/canopy_e35', c: 0x347050 },
    { g: ico(3.5), y: 34, px: -3.9, sy: 0.65, lib: 'tree/canopy_d35', c: 0x2c6242 },
    { g: cyl(0.2, 0.35, 6, 4), y: 86, px: -0.4, rz: 0.5, c: 0x9a7a56 },   // 頂梢突出枯枝(基部埋回頂冠內)
    { g: ico(3), y: 50, pz: 5, sy: 0.6, c: 0x3f7a52 },
    { g: ico(0.9), y: 36.6, px: 4.9, c: 0x8a5a38 },              // 台灣杉紅褐毬果簇
    { g: ico(0.8), y: 48.9, pz: 5.3, c: 0x825332 },
  ] },
  dinizia:  { h: 88, r: 2.7, parts: [                            // 亞馬遜天使樹(Dinizia excelsa 88m)
    { g: cone(3.4, 11, 3), y: 5.5, px: 2.5, c: 0x7a5a40 },       // 高聳板根(鰭尖貼回幹面)
    { g: cone(3.4, 11, 3), y: 5.5, px: -1.3, pz: 2.15, c: 0x846248 },
    { g: cone(3.4, 11, 3), y: 5.5, px: -1.3, pz: -2.15, c: 0x7a5a40 },
    { g: cyl(1.7, 2.7, 48, 7), y: 28, c: 0x96704e },             // 淡紅褐通直巨幹
    { g: cyl(1.0, 1.7, 18, 6), y: 61, c: 0xa07a54 },
    { g: cyl(0.5, 0.9, 15, 5), y: 70, px: 4.5, rz: -0.75, c: 0x846248 },  // 側枝外端朝上(傾角勿過斜:枝根會穿出幹身反側)
    { g: cyl(0.5, 0.9, 15, 5), y: 72, px: -4.5, rz: 0.75, c: 0x846248 },
    { g: cyl(0.4, 0.7, 12, 5), y: 72, pz: 5.0, rx: 1.0, c: 0x7a5a40 },
    // 天使樹的平頂冠 = **外緣高於中心的凹頂**(2026-08-06 重寫骨架):它突出主林冠、常年受風,
    // 中心反而被削低。與 meranti 的「攤平圓盤」和 tualang 的「高處聚冠」是三種不同剪影。
    { g: ico(11), y: 78.5, sy: 0.34, lib: 'tree/canopy_g10', c: 0x4f8a44 },   // 低平中心
    { g: ico(7), y: 80.5, px: 8.6, sy: 0.5, lib: 'tree/canopy_g7', c: 0x5c9a50 },   // 外緣抬高一圈
    { g: ico(7), y: 80.5, px: -8.6, sy: 0.5, lib: 'tree/canopy_g7', c: 0x468040 },
    { g: ico(7), y: 80, pz: 8.4, sy: 0.5, lib: 'tree/canopy_g7', c: 0x549048 },
    { g: ico(6), y: 79.8, pz: -8.2, sy: 0.5, c: 0x86a45c },
    { g: ico(1.3), y: 75.2, px: 9.5, c: 0x7a5434 },              // 天使樹豆莢簇(豆科莢果)
    { g: ico(1.1), y: 77.5, pz: 9, c: 0x714d30 },
  ] },
  // ---- 2026-07-29 增補:三種世界地標巨樹(實存 >65m,剪影與現有八種互異)----
  klinki:   { h: 90, r: 2.2, parts: [                            // 克林奇南洋杉(紐幾內亞 90m):下 2/3 淨幹 + 輪生枝盤
    { g: cyl(2.2, 3.4, 5, 7), y: 2.5, c: 0x6a5138 },
    { g: cyl(1.5, 2.2, 46, 7), y: 28, c: 0x75593c },             // 通直淨幹
    { g: cyl(0.8, 1.5, 26, 6), y: 64, c: 0x7d6142 },
    { g: cyl(2.25, 2.32, 4, 7), y: 20, c: 0x8f9a6e },            // 地衣環帶
    // 南洋杉的識別特徵是**輪生**:枝盤成層,層與層之間留明顯空隙(不是把葉簇黏在幹上)。
    // 2026-08-06 重寫骨架:三層 × 每層一對枝 + 枝端葉盤,層距 8m、盤壓到 sy 0.34 = 一層層的盤子。
    { g: cyl(0.35, 0.55, 11, 5), y: 58, px: 5.5, rz: -1.42, c: 0x6a5138 },   // 第一輪(近水平,梢端略朝上)
    { g: cyl(0.35, 0.55, 11, 5), y: 58, px: -5.5, rz: 1.42, c: 0x6a5138 },
    { g: cyl(0.32, 0.5, 9.5, 5), y: 66, pz: 4.75, rx: 1.44, c: 0x75593c },   // 第二輪(轉 90°)
    { g: cyl(0.32, 0.5, 9.5, 5), y: 66, pz: -4.75, rx: -1.44, c: 0x75593c },
    { g: cyl(0.28, 0.44, 7.5, 5), y: 74, px: 3.75, rz: -1.46, c: 0x6a5138 },   // 第三輪(收小)
    { g: cyl(0.28, 0.44, 7.5, 5), y: 74, px: -3.75, rz: 1.46, c: 0x6a5138 },
    { g: ico(2.6), y: 58.5, px: 10.4, sy: 0.34, lib: 'tree/canopy_j22', c: 0x3a6b3a },   // 枝端扁平葉盤
    { g: ico(2.6), y: 58.5, px: -10.4, sy: 0.34, lib: 'tree/canopy_j22', c: 0x2f5e34 },
    { g: ico(2.4), y: 66.5, pz: 9.0, sy: 0.34, lib: 'tree/canopy_j22', c: 0x3a6b3a },
    { g: ico(2.4), y: 66.5, pz: -9.0, sy: 0.34, c: 0x2f5e34 },
    { g: ico(2.2), y: 74.5, px: 7.1, sy: 0.34, lib: 'tree/canopy_j22', c: 0x35643a },
    { g: ico(2.2), y: 74.5, px: -7.1, sy: 0.34, c: 0x3a6b3a },
    { g: cone(4.5, 14, 6), y: 84, c: 0x2f5e34 },                 // 頂梢窄錐冠
    { g: ico(1.2), y: 59.5, px: 9.5, c: 0x7a5a34 },              // 克林奇大毬果簇(掛枝端葉盤)
  ] },
  tualang:  { h: 85, r: 2.8, parts: [                            // 蜂樹(東南亞 Koompassia 88m):灰白滑幹 + 突出傘冠 + 野蜂巢
    { g: cone(3.6, 12, 3), y: 6, px: 2.6, c: 0x9a917e },         // 高聳板根(鰭尖貼回幹面)
    { g: cone(3.6, 12, 3), y: 6, px: -1.3, pz: 2.25, c: 0xa39a86 },
    { g: cone(3.6, 12, 3), y: 6, px: -1.3, pz: -2.25, c: 0x9a917e },
    { g: cyl(1.8, 2.8, 50, 7), y: 29, c: 0xb3aa94 },             // 灰白滑幹(蜜蜂天敵爬不上去)
    { g: cyl(1.0, 1.8, 20, 6), y: 64, c: 0xbcb29c },
    { g: cyl(0.5, 0.9, 13, 5), y: 71, px: 4, rz: -0.8, c: 0xa39a86 },   // 側枝外端朝上
    { g: cyl(0.5, 0.9, 13, 5), y: 73, px: -4, rz: 0.8, c: 0xa39a86 },
    // 蜂樹 = **枝下高極高、冠小而聚**(2026-08-06 重寫骨架):灰白滑幹一路光禿到近頂,冠幅收在
    // 軸心附近並往上堆成半球 —— 與 meranti 的攤平圓盤、dinizia 的凹頂各走各的剪影。
    { g: ico(10), y: 82, sy: 0.62, lib: 'tree/canopy_h10', c: 0x4f8a44 },
    { g: ico(6.5), y: 79.5, px: 5.4, sy: 0.6, lib: 'tree/canopy_h65', c: 0x5c9a50 },   // 收在軸心附近
    { g: ico(6.5), y: 79.5, px: -5.2, pz: 1.2, sy: 0.6, lib: 'tree/canopy_h65', c: 0x468040 },
    { g: ico(5.5), y: 86.5, px: 1.4, sy: 0.62, c: 0x549048 },     // 往上堆的冠頂
    { g: ico(4.5), y: 89.5, px: -1.2, sy: 0.6, c: 0x6fa050 },
    { g: ico(1.3), y: 74.8, px: 9, c: 0x8a5a30 },                // 豆莢簇(蜂樹為豆科)
    { g: ico(0.9), y: 55, px: 1.9, c: 0xd8b04a },                // 樹幹垂掛野巨蜂巢(蜂樹地標特徵)
  ] },
  alerce:   { h: 72, r: 2.4, parts: [                            // 智利柏(巴塔哥尼亞 Fitzroya 70m+):紅褐纖維皮窄錐塔
    { g: cyl(2.4, 3.8, 6, 7), y: 3, c: 0x7d4a30 },
    { g: cyl(1.6, 2.4, 34, 7), y: 23, c: 0x8a5434 },
    { g: cyl(0.8, 1.6, 20, 6), y: 50, c: 0x935c38 },
    { g: cyl(2.45, 2.52, 5, 7), y: 14, c: 0x49663a },            // 苔蘚環帶(溫帶雨林老樹)
    { g: cone(6.5, 16, 7), y: 32, c: 0x2c5c40 },                 // 窄錐疊冠
    { g: cone(5.5, 15, 7), y: 43, c: 0x336850 },
    { g: cone(4.4, 14, 7), y: 53, c: 0x2c5c40 },
    { g: cone(3.2, 13, 6), y: 62, c: 0x336850 },
    { g: cone(1.8, 10, 5), y: 70, c: 0x2c5c40 },
    { g: ico(2.6), y: 36, px: 3.8, sy: 0.6, lib: 'tree/canopy_k22', c: 0x33684a },
    { g: ico(2.4), y: 33, px: -3.6, sy: 0.6, lib: 'tree/canopy_k22', c: 0x2c5c40 },
    { g: cyl(0.2, 0.3, 5, 4), y: 72.5, c: 0x9a7a56 },            // 頂梢枯枝(千年老樹雷痕)
    { g: ico(0.8), y: 30.5, pz: 4.2, c: 0x7a5434 },              // 小毬果簇
  ] },
};

// 神木吃四季:綠色主導(g 為最大通道)的樹冠/苔蘚/地衣零件自動標記 'gleaf' → 季節疊色
// (保留樹種色相與冠層層次);紅褐樹幹/板根/剝皮絲帶(R 主導)不動。>65m 巨樹皆常綠,
// 故用常綠專屬 tint(SEASON_GIANT_TINT,非闊葉橘紅),見 seasonColor。單一縫、免逐零件手標。
for (const def of Object.values(GIANT_DEFS)) for (const p of def.parts) {
  const c = p.c; if (c == null) continue;
  const r = c >> 16 & 255, g = c >> 8 & 255, b = c & 255;
  if (g > r && g >= b) p.key = 'gleaf';
}

// ---- 巨木表面特徵(鳥巢/山蘇/蟻窩/蜂窩/樹屋/垂藤):與植被同管線 InstancedMesh ----
// 放置時把「樹幹半徑 + 掛載高度」烤進實例座標(item.x/y/z),零件只做小幅局部偏移;
// item.s ≈ 1 與樹齡脫鉤 → 特徵在任何體格的巨木上世界尺寸恆定。
//
// 支撐枝單一縫 bough():近水平側枝(faceOut,local +x = 徑向外),根粗梢細 + 梢端雙叉上揚
// + 葉簇(key:'foliage' 吃季節色)。巢/蕨/窩/蜂巢/藤枝皆疊在同一份枝相上,payload 各自加掛;
// 改枝的粗細/分叉/葉量只需動這裡一處。梢端雙叉靠 rz=π/2+δ(上揚)× rx=±φ(左右分)splay。
const bough = () => [
  { g: cyl(0.28, 0.13, 2.8, 6), y: 0, px: 0.65, rz: Math.PI / 2, c: 0x5a4632 },                                    // 主枝(根粗梢細)
  { g: cyl(0.12, 0.05, 1.5, 5), y: 0.2, px: 1.55, pz: 0.12, rx: 0.8, rz: Math.PI / 2 + 0.35, c: 0x5a4632 },        // 梢上叉(+z 上揚)
  { g: cyl(0.12, 0.05, 1.4, 5), y: 0.2, px: 1.55, pz: -0.12, rx: -0.85, rz: Math.PI / 2 + 0.3, c: 0x5a4632 },      // 梢下叉(−z 上揚)
  { g: cyl(0.09, 0.04, 1.1, 4), y: 0.32, px: 2.05, rz: Math.PI / 2 + 0.22, c: 0x5a4632 },                          // 中央續枝
  { g: ico(0.75), y: 0.7, px: 2.5, pz: 0.42, sy: 0.8, key: 'foliage', c: 0x4f7a3c },                               // 梢端葉簇(季節色)
  { g: ico(0.66), y: 0.62, px: 2.5, pz: -0.42, sy: 0.8, key: 'foliage', c: 0x4f7a3c },
  { g: ico(0.6), y: 0.95, px: 2.75, sy: 0.8, key: 'foliage', c: 0x4f7a3c },
];
const GIANT_DECO = {
  // 鳥巢生在枝梢叉口(px≈1.25),不貼主幹;巢杯/蛋/鳥疊在 bough 上。
  gnest:     { parts: [...bough(),
                       { g: new THREE.TorusGeometry(0.85, 0.3, 5, 8), y: 0.2, px: 1.25, rx: Math.PI / 2, c: 0x6a5138 },
                       { g: ico(0.2), y: 0.3, px: 1.45, c: 0xf2ead6 },
                       { g: ico(0.2), y: 0.3, px: 1.08, pz: 0.18, c: 0xf6efdc },
                       { g: cone(0.28, 0.75, 4), y: 0.66, px: 1.05, pz: -0.32, c: 0x4a586a }] },      // 停棲的鳥
  // 山蘇(鳥巢蕨):枝上腐植土墊(根系聚積腐植)+ 蓮座長葉。funnel 正解 = 葉「底聚頂展」:
  // 每片葉底端聚於共同基點 B=(1.2,0.35,0),沿葉軸 d 外展上翹(中心 = B + (h/2)·d,故不中間交叉)。
  // 方位角 a → tz=-cos·k, tx=sin·k;葉軸 d=(-sin tz, cos tz·cos tx, cos tz·sin tx),k 控展開角。
  epiphyte:  { parts: [...bough(),
                       { g: ico(0.62), y: 0.12, px: 1.2, sy: 0.42, c: 0x4a3b28 },                                  // 腐植土墊
                       { g: ico(0.46), y: 0.16, px: 0.86, sy: 0.42, c: 0x40331f },
                       { g: ico(0.42), y: 0.4, px: 1.2, sy: 0.5, key: 'foliage', c: 0x4f7a3c },                    // 蓮座心(葉基叢)
                       ...Array.from({ length: 11 }, (_, i) => {
                         const a = i / 11 * Math.PI * 2, k = 0.72, h = 1.55 - (i % 3) * 0.12;
                         const tz = -Math.cos(a) * k, tx = Math.sin(a) * k;
                         const dx = -Math.sin(tz), dy = Math.cos(tz) * Math.cos(tx), dz = Math.cos(tz) * Math.sin(tx);
                         return { g: cone(0.13, h, 4), px: 1.2 + dx * h / 2, y: 0.35 + dy * h / 2, pz: dz * h / 2,
                                  rx: tx, rz: tz, key: 'foliage', c: [0x4f7a3c, 0x5c8a46, 0x567a40][i % 3] };
                       })] },
  // 蟻窩:褐色紙質蟻碳窩裹住枝身中段
  antnest:   { parts: [...bough(),
                       { g: ico(0.62), y: 0.05, px: 0.95, sy: 1.15, c: 0x4a3524 },
                       { g: ico(0.4), y: 0.1, px: 1.35, sy: 1.1, c: 0x53402c },
                       { g: ico(0.34), y: -0.05, px: 0.7, sy: 1.05, c: 0x40301f }] },
  // 蜂窩:垂吊於枝下(y<0),頂錐接枝、巢體垂墜;底部露出六角蜂巢面(comb,朝下)。
  // comb = 六角柱蜂窩排列:中央 1 + 環 6,環距 = 兩倍邊心距(≈0.26)恰好貼合成網格。
  beehive:   { parts: [...bough(),
                       { g: cone(0.5, 0.7, 7), y: -0.35, px: 1.35, c: 0xb99860 },                                  // 頂錐(接枝)
                       { g: ico(0.56), y: -0.92, px: 1.35, sy: 1.15, c: 0xc7a56b },                                // 巢體(紙質外殼)
                       { g: cyl(0.58, 0.5, 0.28, 7), y: -1.52, px: 1.35, c: 0xbf9c63 },                            // 巢底承盤
                       ...Array.from({ length: 7 }, (_, i) => {
                         const a = (i - 1) / 6 * Math.PI * 2, r = i === 0 ? 0 : 0.26;
                         return { g: cyl(0.145, 0.145, 0.2, 6), y: -1.72,
                                  px: 1.35 + Math.cos(a) * r, pz: Math.sin(a) * r,
                                  c: i % 2 ? 0xd9b869 : 0xcdaa5c };
                       }),
                       { g: ico(0.07), y: -1.2, px: 1.35, pz: 0.56, c: 0x2a2018 }] },                              // 巢口
  // 一般葉枝:只有 bough(豐富枝相);vinebranch 再垂掛攀藤
  branch:    { parts: bough() },
  vinebranch:{ parts: [...bough(),
                       { g: cyl(0.05, 0.09, 3.2, 4), y: -1.5, px: 1.7, pz: 0.1, c: 0x567a40 },                     // 垂藤
                       { g: cyl(0.04, 0.07, 2.4, 4), y: -0.85, px: 2.2, pz: -0.06, c: 0x5c8a46 },
                       { g: ico(0.28), y: -2.9, px: 1.7, pz: 0.1, sy: 0.7, key: 'foliage', c: 0x4f7a3c },          // 藤端葉
                       { g: ico(0.22), y: -1.85, px: 2.2, pz: -0.06, sy: 0.7, key: 'foliage', c: 0x5c8a46 }] },
  treehouse: { parts: [{ g: new THREE.BoxGeometry(3.6, 0.4, 3.6), y: 0, c: 0x7a5a3c },       // 平台
                       { g: new THREE.BoxGeometry(2.2, 1.9, 2.0), y: 1.15, c: 0x8a6a48 },    // 小屋
                       { g: cone(2.0, 1.4, 4), y: 2.8, c: 0x6e4a38 },                        // 屋頂
                       { g: new THREE.BoxGeometry(0.9, 1.2, 0.12), y: 1.0, pz: 1.05, c: 0x3e3226 },   // 門
                       { g: new THREE.BoxGeometry(0.5, 4.5, 0.14), y: -2.4, pz: 1.5, c: 0x6a4e34 },   // 垂降木梯
                       { g: cyl(0.14, 0.6, 1.4, 4), y: -0.9, px: 1.2, c: 0x6a4e34 },         // 斜撐
                       { g: cyl(0.14, 0.6, 1.4, 4), y: -0.9, px: -1.2, c: 0x6a4e34 }] },
  vine:      { parts: [{ g: cyl(0.07, 0.14, 7, 4), y: -3.5, c: 0x567a40 },                   // 主幹垂掛藤蔓
                       { g: ico(0.4), y: -7, sy: 0.6, c: 0x4f7a3c },
                       { g: ico(0.3), y: -4.6, px: 0.3, sy: 0.6, c: 0x5c8a46 }] },
};

// 針葉神木(配針葉幼樹)vs 闊葉神木(euc/meranti/dinizia,配闊葉幼樹):林下同科喬木分流
const CONIFER_GIANTS = new Set(['redwood', 'sequoia', 'dougfir', 'sitka', 'taiwania', 'klinki', 'alerce']);

/** 綠地神木群落:同一樹種成群、株高各異;樹幹登記碰撞柱(障礙 + 隱蔽) */
/**
 * 神木的**冠幅半徑**(體格 1.0 時;m)—— 由零件表推導,MUST NOT 逐樹種手寫。
 *
 * 樹冠羞避量的是「冠緣到冠緣」,而冠幅只有零件表知道:取樹高 35% 以上(各樹種冠層約自
 * 40% 樹高起,留一點餘裕)所有零件的最遠水平點。手寫一欄 `cr` 的話,改了任何一個冠簇的
 * `px/pz` 或半徑,間隙規則就與看得見的樹冠分家 —— 而畫面上只表現成「有些樹冠還是黏在一起」。
 * three 的 `parameters` 是各 Geometry 建構時存下的原始參數(r160 恆有)。
 *
 * AI 零件庫(`p.lib`)在這裡**刻意不解析**(MUST NOT 改吃 partGeo / 掃庫幾何頂點):
 * 冠幅是佈局數學(縮冠量/傾斜方向/後續佔位全吃它),庫幾何隨載入成敗而異,讀它 =
 * 佈局跨客戶端逐位元分家(§2.3)。保險絲 `p.g` 的包絡 ≥ GLB 實體(intake 契約)⇒
 * 以它計冠幅恆保守 —— 冠層零件換 GLB 不需要動這一支,這正是 canopy GLB 的解鎖條件。
 */
function giantCrownR(def) {
  if (def._cr != null) return def._cr;
  let m = 0;
  for (const p of def.parts) {
    if ((p.y ?? 0) < def.h * 0.35) continue;
    const q = p.g.parameters || {};
    const r = q.radius != null ? q.radius : Math.max(q.radiusTop ?? 0, q.radiusBottom ?? 0);
    m = Math.max(m, Math.hypot(p.px ?? 0, p.pz ?? 0) + r * (p.sx ?? 1));
  }
  def._cr = m;
  return m;
}

function placeGiantGroves({ terrain, blocked, blockers, items, rnd, sites, roadOccupied }) {
  const species = Object.keys(GIANT_DEFS);
  const centers = [];
  let trees = 0;
  for (const [x, z] of sites) {
    if (centers.length >= 6) break;
    if (centers.some(([cx, cz]) => Math.hypot(x - cx, z - cz) < 210)) continue;
    const type = species[Math.floor(rnd() * species.length)];
    const def = GIANT_DEFS[type];
    const n = 5 + Math.floor(rnd() * 7);          // 一群 5~11 株
    const cr = 52 + rnd() * 70;                   // 群落半徑(株體放大 → 群落跟著攤開;
                                                  // 2026-08-03 樹冠羞避上線後同步放大:冠緣要留間隙,
                                                  // 林子攤不開就只能少種樹 —— 使用者要的是「森林」)
    const base = (0.75 + rnd() * 0.35) * OVER.giant;   // 群落基準體格(隨建物佔地等比放大)
    // ---- 樹冠羞避(2026-08-03 使用者定案②「多個神木組成森林,遵循 Crown shyness 的規則」)----
    // 抽樣與規則**分開**:落點/體格照舊逐株抽(每株固定枚數,§2.3),整群抽完才交給
    // `siteplan.js planShyGrove` 一次定案 —— 它會把冠緣相碰的那幾株**縮冠**(而不是一律
    // 淘汰,否則「森林」會被打成稀疏散株),縮不下去才丟。規則本身**零亂數消耗**。
    // 傾斜 `lean` 遠離鄰冠:羞避的成因就是枝梢感受到鄰株而偏離,林相才不是一排直挺挺的柱子。
    // 注意規則跑在地形淘汰(水域/淨空)**之前**:被地形刷掉的那株仍算進鄰株 ⇒ 間隙偏保守,
    // 方向朝「留得更開」而不是「黏在一起」(原則 6)。
    const gcr = giantCrownR(def);
    const cands = [];
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2, d = k === 0 ? 0 : 10 + rnd() * cr;
      // 物件高度上限(`WORLD_H.OBJ_F` 倍砲塔高;2026-08-09 起 4 倍)。神木走**分布版** `objScaleFit`
      // 而不是硬夾:>65m 巨樹的公稱高 72~110m,連最矮的抽樣(× 0.72)都超過上限
      // ⇒ 硬夾會把整片森林壓成**每一株一樣高**,而「同種群聚、株高各異」正是這套群落的設計
      //(樹冠羞避的縮冠量也是從株高變異來的)。等比壓縮 ⇒ 最高那株恰好貼齊上限、矮的仍矮。
      // `sMax` = 本群抽得到的最大縮放(= base × 0.72+0.63 的上端),同群逐株共用同一個壓縮率。
      // MUST 夾在 `cands.push` 之前:羞避規劃吃的 `s` 與後面的落底/腳印/碰撞柱/攀爬設施
      // 全是同一個值,晚一步夾就是「冠幅按大株算、樹身按小株長」(原則 4)。
      // 夾制**不消耗亂數** ⇒ 佈局序列逐位元不變(§2.3)。
      const s = objScaleFit(base * (0.72 + rnd() * 0.63), def.h, base * 1.35);
      cands.push({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, s, cr: gcr, h: def.h });
    }
    const shy = planShyGrove(cands);
    let added = 0;
    const trunks = [];   // 本群樹幹腳印:迴圈後才整圓封鎖(不干擾同群後續植株的群聚)
    for (const cand of shy) {
      const gx = cand.x, gz = cand.z, s = cand.s;
      // 腳印半徑 = 幹半徑 × 1.6(基部喇叭口 + 板根鰭)—— 落底與淨空 MUST 吃同一個值
      const foot = def.r * s * 1.6;
      // 淨空 MUST 掃**整個腳印圓盤**(areaFree,同 placeMegaliths),MUST NOT 只問中心格:
      // 巨幹半徑可 >10m,中心落在隧道走廊淨空外一格、樹身照樣橫插進洞內斷面
      // (2026-08-01 金龍隧道真圖資實測:洞內卡著整根神木樹幹)。
      // 抽樣紀律(§2.3):淘汰檢查排在 s 抽樣**之後** —— foot 要有 s 才算得出來。
      if (!areaFree(blocked, gx, gz, foot)) continue;
      if (roadOccupied?.({ x: gx, z: gz, r: foot })) continue;
      // 落底高度取「板根腳印周圈最低點」(sinkBaseY 單一縫):只取中心高度的話,
      // 陡坡/巨岩崖邊的樹根會整片懸空。
      const gy = sinkBaseY(terrain, gx, gz, foot);
      // 水域/沼澤不長神木(terrainEnvCode 確定性純函式;群落中心的 classify 有 55% mix 改寫
      // 可能把水色點洗成 green、株散 ±82m 也會越到濕地 —— 這裡是最後把關)
      if (gy < 0.4 || terrainEnvCode(terrain, gx, gz) !== 0) continue;
      (items[type] ??= []).push({
        x: gx, y: gy, z: gz, s,
        ry: rnd() * Math.PI * 2,
        // 站姿微傾斜 + 羞避傾斜(遠離鄰冠):兩者都是**剛體**傾斜,走 `xform.js vegPartXform`
        // 同一份通道(A27),MUST NOT 併進逐零件歐拉角
        tx: (rnd() - 0.5) * 0.05 + cand.lean[0], tz: (rnd() - 0.5) * 0.05 + cand.lean[1],
        dj: rnd(),   // 細節種子(xform.js):冠層/枝節逐株走樣,同種不同貌
      });
      // 幹半徑隨高度收窄(表面特徵掛點與攀爬設施共用的單一縫;世界尺寸與樹齡脫鉤)
      const trunkR = (yy) => def.r * s * (1 - 0.72 * yy / (def.h * s));
      // tr = **頂端**幹半徑(climb.js:垂降技術繩的頂端繩錨靠 `r − tr` 的跨接臂伸回幹身)——
      // 碰撞半徑吃的是基部,不帶這個值的話繩錨會吊在幹外好幾公尺的空中。推導自 trunkR,MUST NOT 手寫
      blockers.push({ x: gx, z: gz, y: gy - 1, r: def.r * s + 0.6, h: def.h * s + 1, std: 1, cl: 'tree', tr: trunkR(def.h * s) });   // std:頂部可站立(surfaceAt);cl:攀爬設施型別(climb.js)
      blocked.add(cellKey(gx, gz));               // 小植被/地被不長進樹幹
      trunks.push([gx, gz, def.r * s + 8]);       // 巨幹半徑可 >10m 網格;+8 淨距 = 樹冠不貼建物牆面
      // 巨木表面特徵:掛在樹幹側面,世界尺寸與樹齡脫鉤
      const hang = (dtype, frac, ds, faceOut = false) => {
        const ha = rnd() * Math.PI * 2;
        const hy = def.h * s * frac;
        // faceOut:錨點落在樹皮表面、零件 local +x 指徑向外(枝根埋入、巢懸枝梢)
        const rr = trunkR(hy) + (faceOut ? 0 : 0.3);
        const jry = rnd() * Math.PI * 2;   // 保留亂數消耗序(確定性:faceOut 也照抽不跳號)
        const hx = gx + Math.cos(ha) * rr, hz = gz + Math.sin(ha) * rr;
        (items[dtype] ??= []).push({
          x: hx, y: gy + hy, z: hz,
          s: ds, ry: faceOut ? -ha : jry,
          // 細節種子(2026-08-05):由落點雜湊給(零共享 rnd 消耗)—— 舊制沒帶 dj,
          // 所有樹屋/鳥巢/蜂窩/枝條逐位元相同,只有整體縮放與轉角不同(單調成因)
          dj: djAt(hx, hz),
        });
      };
      // 掛載高度停在樹冠底緣以下(各樹種冠層約自 40% 樹高起),特徵才不被樹冠吞掉;
      // 巢/蕨/窩/蜂巢/枝 皆 faceOut 生於近水平側枝,樹屋維持平台式(自帶斜撐)。
      if (rnd() < 0.4) hang('gnest', 0.28 + rnd() * 0.14, 0.9 + rnd() * 0.7, true);
      if (rnd() < 0.35) hang('epiphyte', 0.24 + rnd() * 0.2, 0.85 + rnd() * 0.6, true);   // 山蘇(鳥巢蕨)
      if (rnd() < 0.16) hang('antnest', 0.3 + rnd() * 0.12, 0.9 + rnd() * 0.5, true);     // 蟻窩
      if (rnd() < 0.2) hang('beehive', 0.32 + rnd() * 0.12, 0.85 + rnd() * 0.5, true);    // 蜂窩(垂吊)
      if (rnd() < 0.2) hang('treehouse', 0.16 + rnd() * 0.14, 0.9 + rnd() * 0.4);
      // 一般葉枝(豐富枝相):1~2 根,部分隨機再掛攀藤
      const nBr = 1 + Math.floor(rnd() * 2);
      for (let b = 0; b < nBr; b++)
        hang(rnd() < 0.45 ? 'vinebranch' : 'branch', 0.2 + rnd() * 0.32, 0.85 + rnd() * 0.6, true);
      if (rnd() < 0.35) hang('vine', 0.38 + rnd() * 0.12, 0.8 + rnd() * 0.6);   // 主幹垂藤(保留)
      // 追加枝(2026-08-05):以**落點雜湊**再掛 0~2 根 —— hang() 會消耗共享 rnd,
      // 逐株加抽會把整張圖後續佈局推移(§2.3),故追加的枝走零消耗的雜湊路徑。
      {
        const xb = djAt(gx + 11.3, gz - 7.9);
        const hangH = (dtype, salt, hfrac, ds) => {
          const ha2 = djAt(gx + salt, gz - salt * 1.7) * Math.PI * 2;
          const hy2 = def.h * s * hfrac;
          const rr2 = trunkR(hy2);
          const hx2 = gx + Math.cos(ha2) * rr2, hz2 = gz + Math.sin(ha2) * rr2;
          (items[dtype] ??= []).push({ x: hx2, y: gy + hy2, z: hz2, s: ds, ry: -ha2, dj: djAt(hx2, hz2) });
        };
        if (xb < 0.5) hangH(xb < 0.2 ? 'vinebranch' : 'branch', 5.1, 0.24 + xb * 0.5, 0.85 + xb * 0.6);
        if (xb > 0.72) hangH('branch', 9.7, 0.44 - (xb - 0.72) * 0.5, 0.9 + (1 - xb) * 0.8);
      }
      // ---- 林下分層:中小型同科喬木(sub-canopy)→ 樹苗/灌木叢/各式香菇(林床)----
      // 環樹基佈點;體格 = 神木零頭(msz/fsz 為體格分數,drop() 再乘 VEG_SCALE)。
      // 抽樣紀律(§2.3):角度/距離/選型/體格先抽定,blocked/水域淘汰放在抽樣之後,
      // 落點才 push(比照上方神木本體迴圈:淘汰只吃前段亂數,不跳號)。
      const trunkOut = def.r * s;
      const midPool = CONIFER_GIANTS.has(type)
        ? ['conifer', 'conifer2', 'conifer3', 'conifer4']
        : ['broadleaf', 'birch'];
      const floorPool = ['sapling', 'shrub', 'redcap', 'browncap', 'parasol', 'toadstool', 'toadstool'];
      const drop = (t, ux, uz, uy, sc) => {
        (items[t] ??= []).push({
          x: ux, y: uy, z: uz, s: sc * (VEG_SCALE[t] || 1),
          ry: rnd() * Math.PI * 2, tx: (rnd() - 0.5) * 0.09, tz: (rnd() - 0.5) * 0.09,
          dj: rnd(),
        });
      };
      const scatterRing = (pool, count, rMin, rSpan, szMin, szSpan) => {
        for (let u = 0; u < count; u++) {
          const ua = rnd() * Math.PI * 2, ud = trunkOut + rMin + rnd() * rSpan;
          const ut = pool[Math.floor(rnd() * pool.length)], usz = szMin + rnd() * szSpan;
          const ux = gx + Math.cos(ua) * ud, uz = gz + Math.sin(ua) * ud;
          if (blocked.has(cellKey(ux, uz))) continue;
          const uy = terrain.heightAt(ux, uz);
          if (uy < 0.4 || terrainEnvCode(terrain, ux, uz) !== 0) continue;
          drop(ut, ux, uz, uy, usz);
        }
      };
      scatterRing(midPool, 1 + Math.floor(rnd() * 3), 4, 26, 0.32, 0.34);    // 1~3 株中小型同科喬木
      scatterRing(floorPool, 3 + Math.floor(rnd() * 4), 3, 40, 0.6, 0.5);    // 3~6 叢樹苗/灌木/香菇
      added++; trees++;
    }
    for (const [tx, tz, tr] of trunks) blockArea(blocked, tx, tz, tr);   // 建物/小植被避開整根巨幹
    if (added) centers.push([x, z]);
  }
  return trees;
}

// ---- Quaternius Ultimate Stylized Nature(CC0)植被插槽 ----
// 下載自 quaternius.com(gltf + bin + 貼圖,法線圖已剝除);
// 載入失敗自動退回上面 VEG_DEFS 的程序生成版本,不開天窗。
//
// **2026-08-06 使用者定案「連 Quaternius 一起換掉」**(第 8 輪:灌木/闊葉林/針葉林/各種
// 大小神木一律照片 → img→3D)—— broadleaf / birch / shrub 三型**退出這份名冊**,改走
// 下面 VEG_DEFS 的零件表 + `lib:` 照片零件庫冠簇。三件事要一起記住:
//   ① 這份名冊在這裡的語意是「這一型**不走**零件表」:掛在名冊裡的型別,`buildVegMeshes`
//      連呼叫都不會被呼叫到 ⇒ 在名冊裡的型別上加 `lib:` 列是接在**沒人看得到的路徑**上
//      (整支 GLB 分支沒有零件表可掛),而且不會有任何錯誤訊息。移除是唯一的接法。
//   ② **只換冠簇,樹幹/枝條維持 primitive**(§3 rule 1「parts, never finished props」):
//      SF3D 吃一張整棵樹的照片會吐出一整棵樹 —— 那是成品,烤進去就沒有逐實例變化了。
//      故照片零件只接 `ico` 冠簇列,樹幹那幾根 cyl 一根都不動。
//   ③ **尺寸接得上**:GLB 路徑的高度是 `it.s × entry.h`(8 / 8.5 / 1.8),零件表路徑是
//      `vegSpan(def) × it.s`(實測 7.8 / 7.3 / 1.75)⇒ 同量級,不必改散布尺度。
//      兩條路徑都零 `rnd()` 消耗(散布早就跑完)⇒ **佈局逐位元不變**,只換畫出來的幾何。
// silvergrass 留在名冊裡:草葉的鏤空貼圖是 img→3D 生不出來的東西(寧缺勿錯)。
// deadtree 已退出名冊改走零件表(2026-08-07 §5u;§5q 定案樹族 img→3D 只收雕塑性主體,
// 枯幹正是首件 —— §5k ⑤ broadleaf 的同一條遷移路,Quaternius DeadTree_1/2 隨之退場)。
const NATURE_DIR = 'assets/models/quaternius/nature/';
// h = 基準高(m):GLB 植被同步吃超尺度(比現實高大;put() 的 VEG_SCALE 已含在 s)
const NATURE_MANIFEST = {
  silvergrass: { files: ['Grass_Large.gltf', 'Grass_Small.gltf'], h: 1.2 },
};
// 葉片的季節色偏(乘在貼圖上;樹幹不動)
const SEASON_LEAF_TINT = { spring: 0xd9ffd0, summer: 0xffffff, autumn: 0xffab5e, winter: 0xc9d6da };
// 神木常綠樹冠季節疊色(乘在樹種色上;常綠不轉橘紅 → 春嫩黃綠、夏原色、秋偏金、冬霜青)
const SEASON_GIANT_TINT = { spring: 0xe4f2be, summer: 0xffffff, autumn: 0xd8b06a, winter: 0xb2c2c6 };
const mulHex = (a, b) => ((((a >> 16 & 255) * (b >> 16 & 255) / 255) | 0) << 16)
  | ((((a >> 8 & 255) * (b >> 8 & 255) / 255) | 0) << 8) | (((a & 255) * (b & 255) / 255) | 0);

/** gltf → 正規化零件(高度=1、底部貼地),材質轉 toon 並保留貼圖 */
function extractNatureParts(gltf, season) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const h = Math.max(0.01, box.max.y - box.min.y);
  const norm = new THREE.Matrix4()
    .makeScale(1 / h, 1 / h, 1 / h)
    .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(norm, o.matrixWorld));
    const src = Array.isArray(o.material) ? o.material[0] : o.material;
    // 葉片判定只有這一條(季節色偏與軟性旗標同吃):另寫第二條 regex 就會出現
    // 「這叢葉子會變色卻不會飄」。幾何已正規化成「底部貼地、高度 1」⇒ 擺動權重的
    // span 恆為 1、base 恆為 0(這正是正規化那一步順帶給的東西,不必再量一次)。
    const leafy = /leaves|grass|flower|bush/i.test(`${src.name} ${o.name} ${src.map?.name || ''}`);
    // rim: 0 = 逐位元維持這條路徑原本沒有邊緣光的樣子(同一棵樹的樹幹仍是未補丁材質)
    const mat = leafy
      ? toonMat(src.color ? src.color.clone() : new THREE.Color(0xffffff),
        { map: src.map || null, rim: 0, soft: { k: 'leaf', span: 1 } })
      : toonPlain({
        color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
        map: src.map || null,
      });
    if (src.map) { mat.alphaTest = 0.5; mat.side = THREE.DoubleSide; }   // 葉片鏤空貼圖
    if (leafy) mat.color.multiply(new THREE.Color(SEASON_LEAF_TINT[season] ?? 0xffffff));
    parts.push({ geo, mat });
  });
  return parts;
}

/** 併發載入 manifest 植被模型;個別失敗只是該類型退回程序生成 */
async function loadNatureModels(season) {
  const loader = new GLTFLoader();
  const out = {};
  await Promise.all(Object.entries(NATURE_MANIFEST).map(async ([type, def]) => {
    const slots = new Array(def.files.length).fill(null);   // 保持檔案順序:全房間變體分配一致
    await Promise.all(def.files.map(async (f, i) => {
      try {
        const gltf = await loader.loadAsync(NATURE_DIR + f);
        const parts = extractNatureParts(gltf, season);
        if (parts.length) slots[i] = { parts };
      } catch (e) {
        console.warn(`植被模型載入失敗(退回程序生成):${f}`, e.message);
      }
    }));
    const variants = slots.filter(Boolean);
    if (variants.length) out[type] = { variants, h: def.h };
  }));
  return out;
}

/** GLB 植被 → InstancedMesh(變體以 i % n 決定性分配;實例色/傾斜差異化同程序生成版) */
function buildVegMeshesGlb(entry, items) {
  const meshes = [];
  const groups = entry.variants.map(() => []);
  items.forEach((it, i) => groups[i % entry.variants.length].push([it, i]));
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const P = new THREE.Vector3(), S = new THREE.Vector3();
  const tint = new THREE.Color();
  groups.forEach((list, vi) => {
    if (!list.length) return;
    entry.variants[vi].parts.forEach((part, pi) => {
      const m = new THREE.InstancedMesh(part.geo, part.mat, list.length);
      list.forEach(([it, gi], k) => {
        E.set(it.tx || 0, it.ry, it.tz || 0);
        Q.setFromEuler(E);
        P.set(it.x, it.y, it.z);
        const sc = it.s * entry.h;
        S.set(sc, sc, sc);
        M.compose(P, Q, S);
        m.setMatrixAt(k, M);
        // hash 併入零件序 pi:同株樹幹/葉叢的色抖各自獨立(與程序生成版同邏輯)
        const kk = gi * 197 + pi * 3121 + 1;
        const j1 = ((kk * 2654435761) >>> 0) % 100 / 100;
        const j2 = ((kk * 1597334677) >>> 0) % 100 / 100;
        const j3 = ((kk * 3812015801) >>> 0) % 100 / 100;
        tint.setRGB(0.8 + j1 * 0.36, 0.8 + j2 * 0.36, 0.8 + j3 * 0.36);
        m.setColorAt(k, tint);
      });
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.castShadow = false;
      m.frustumCulled = false;
      meshes.push(m);
    });
  });
  return meshes;
}

function seasonColor(key, fixed, season) {
  const s = ENV.seasons[season] || ENV.seasons.summer;
  if (key === 'foliage') return s.foliage;
  if (key === 'grass') return s.grass;
  if (key === 'conifer') return season === 'winter' ? 0x8fa89a : 0x2f6b34;
  // 'gleaf' = 神木樹冠:疊季節 tint 在樹種原色上(保留色相/層次,常綠不轉橘紅)
  if (key === 'gleaf') return mulHex(fixed ?? 0x4f7a3c, SEASON_GIANT_TINT[season] ?? 0xffffff);
  return fixed ?? 0x777777;
}

// ---- 軟性零件的判定(2026-08-04;細勾線 + 隨風飄揚,規則與參數住 `toon.js SOFT_KINDS`)----
// **由既有的 `part.key` 推導,不另開一張名單**:那一欄本來就是「這個零件是不是葉子/草」
// 的唯一真相(`seasonColor` 同吃它)。另開一份「哪些零件會飄」遲早與季節換色那份分家,
// 而分家的症狀是「這叢草會飄、但入秋不會變色」—— 沒有錯誤訊息,只是看起來不對。
// `sf` 是**逐零件的顯式覆寫**,只給「不吃季節色但確實是軟的」那幾件(芒花穗/蘆葦/箭竹葉):
// 它們有固定色 `c` 所以沒有 key,但它們正是使用者點名的「芒草」。
const SOFT_BY_VEG_KEY = { foliage: 'leaf', gleaf: 'leaf', conifer: 'leaf', grass: 'grass' };
const vegSoftKind = (part) => part.sf ?? SOFT_BY_VEG_KEY[part.key] ?? null;

// ---- AI 零件庫的消費端縫(2026-08-05;docs/ai3d_runbook.md §0.2 不變式 7)----
// 零件列可帶選用欄 `lib: '家族/節點'`(例 `lib: 'rock/facet_a'`),**解析只在 build 時**
// 走這一支:VEG_DEFS 這些表在模組載入期就建好,那時 GLB 還沒抓 ⇒ 表內解析恆 miss
// (修正 1 的成因)。`p.g` 仍是保險絲 —— 載入失敗/查無此名 ⇒ 原 primitive(原則 6)。
//   ① **佈局數學 MUST 只讀 `p.g`**(giantCrownR 冠幅 / vegSpan 擺動分母 / 淨空 / 碰撞):
//      解析結果隨載入成敗而異,佈局讀它 = 跨客戶端逐位元分家(§2.3);intake 契約保證
//      GLB 外廓收在 fallback 包絡內 ⇒ 以保險絲計佈局恆保守(方向朝「留得更開」)。
//   ② 庫幾何已 markShared(A25)且本迴圈不就地改幾何 ⇒ 不 clone;會 applyMatrix4 的
//      消費端(beacons buildBeacon)才要 clone。
//   ③ 查表是純函式,零共享 rnd 消耗(§2.3)。
const partGeo = (p) => (p.lib && isRuntimeEligibleNatureKey(p.lib) && libGeo(p.lib)) || p.g;

/**
 * 一株植被的公稱高度(擺動權重的分母)。**推導不手寫**:改任一零件的 y/幾何,
 * 擺幅自己跟著走 —— 手寫一欄 `h` 的話,加高樹冠之後梢端的權重會停在 1 以下(擺不動)。
 * 取零件包圍盒的頂端(含 `sy` 縱向壓縮),與 `vegPartXform` 疊零件的算法同框。
 * 讀的是保險絲 `p.g` 不是 AI 零件庫(與 giantCrownR 同一條紀律,見 partGeo 檔頭)。
 */
function vegSpan(def) {
  let top = 0;
  for (const p of def.parts) {
    if (!p.g.boundingBox) p.g.computeBoundingBox();
    top = Math.max(top, (p.y || 0) + p.g.boundingBox.max.y * (p.sy || 1));
  }
  return Math.max(0.5, top);
}

// ---- 葉片卡冠層 + 整棵樹的表面群組(2026-08-16 ②-1;`docs/anime_style_plan.md` 序 7)----
// 使用者這一輪的話是「葉冠處理**延伸到整棵樹**」:一株樹在畫面上是**一個東西**,不該被
// 勾線畫成一堆多邊形稜線。落地是**兩層**,而且兩層各自成立、可以只開一層:
//   ①**逐株面號**(`surfAttr` + `aSurfId`,吃 `inkGroup` 旋鈕):同一株的幹 / 枝 / 冠拿到
//     同一個號、葉列的類別碼是 `GROUP` ⇒ 勾線 pass 的群組早退把「幹與冠的交界」那條線收掉,
//     而**幹自己的多邊形折邊留著**(五格同號但沒有一格是 GROUP ⇒ 不早退;110m 神木近距離
//     還讀得出是一根有轉折的柱子,見 seq7 規格的取捨 ⑤)。相鄰兩株是**不同**號 ⇒ 兩株之間
//     仍然有線 —— 這正是逐株而不是逐型的理由。
//   ②**葉片卡**(`leafCard` 旋鈕,掛在 ① 之下):葉團的幾何由實心團塊換成一叢面向鏡頭的卡片,
//     任何角度都給鋸齒冠緣。排列規則住 `leafcard.js`(零 THREE),本段只組幾何與畫遮罩。
//
// **三條會靜默壞掉的地方**:
//   ・**沒有群組早退的卡片叢比舊制更糟**:一張卡的 alpha-test 邊界對深度二階差分而言就是
//     一條真的輪廓 ⇒ 12~24 張卡 = 12~24 個黑色多邊形。故 ② MUST 掛在 ① 與 MRT 能力之下,
//     配不到就**逐位元退回團塊**(原則 6)。
//   ・**佈局數學 MUST 只讀保險絲 `p.g`**:`giantCrownR`(冠幅)與 `vegSpan`(擺幅分母)一格
//     未動。卡片幾何的包圍盒比保險絲大(卡心在包絡上、卡片還往外伸半張)⇒ 誤改成讀卡片幾何,
//     擺動權重的分母會變大 = 整片林子擺幅變小,而沒有任何錯誤訊息。
//   ・**`transparent` 被誤設成 true**:`applyCelPatch` 的 `inkable = !!sk && !mat.transparent`
//     會把細勾線那一半關掉,而且 `gl_FragColor.a = uSoftInk` 寫下去就是把冠層的不透明度改成
//     0.3。一律 `transparent: false` + `alphaTest`。`castShadow` 同理 MUST 維持 false
//     (陰影走 `MeshDepthMaterial`,沒有 `CEL_LEAFCARD` 補丁 ⇒ 卡片在陰影圖裡是退化四邊形)。
//
// ⚠ **能力閘只有半份住在這裡**:`postfx` 的 `_mrtCap` = 「renderer 是 WebGL2」∧「three 有
// `WebGLMultipleRenderTargets`」,而本檔沒有 renderer ⇒ 只問得到後半(逐字同 postfx.js)。
// 前半要一支從 `postfx.js` 匯出的能力查詢才問得到(見交付說明的待裁決)。
const CARD_MRT_CAP = typeof THREE.WebGLMultipleRenderTargets === 'function';
/** 逐株面號要不要掛(= 群組剪影開著)。旋鈕關著 ⇒ 整段不生效、逐位元同舊制 */
const groupInkOn = () => visualPref('inkGroup') === 'on';
/**
 * 這一列要不要換成葉片卡。三態旋鈕:`off` / `auto`(只換**解析不到庫節點**的葉列 ⇒
 * `intake_parts` 的分母與 `node_cap` 完全不動)/ `all`(連庫冠簇一起換)。
 * @param sk   `vegSoftKind(part)` 的結果(**MUST 沿用同一次呼叫**,MUST NOT 再呼叫一次:
 *             `audit_soft_stroke` Ⅳ⑤ 釘住 `vegSoftKind(` 全檔恰一次)
 */
function leafCardOn(part, sk) {
  if (sk !== 'leaf' || !CARD_MRT_CAP || !groupInkOn()) return false;
  const mode = visualPref('leafCard');
  if (mode === 'all') return true;
  return mode === 'auto' && partGeo(part) === part.g;
}

let _cardTex = null;
/**
 * 葉片卡的遮罩貼圖(程序生成,整場一份)。RGB 近白 ⇒ 季節色與逐實例 tint 照樣透出來;
 * alpha 才是形狀,配 `alphaTest` 切出鋸齒冠緣。
 * 刻意**不設 NearestFilter**:窗格那一族要硬邊是因為格線落在 texel 中間(A46 ⑦),
 * 葉緣要的是「不規則」不是「像素對齊」,而 alphaTest 本來就把它切成硬邊。
 */
function leafCardTex() {
  if (_cardTex) return _cardTex;
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const rnd = mulberry32(0x1EAF5EED);
  g.clearRect(0, 0, S, S);
  // 一叢 = 十來片小葉:中心密、邊緣散(整片方形實心的話卡片就只是一個方塊)
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * S * 0.42;
    const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d;
    const rx = S * (0.11 + rnd() * 0.09), ry = rx * (0.55 + rnd() * 0.5);
    g.save();
    g.translate(x, y); g.rotate(rnd() * Math.PI * 2);
    // 明度逐片微差 ⇒ 同一張卡上的葉片不是一塊死白(乘上季節色之後才有層次)
    const v = 226 + Math.floor(rnd() * 29);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  _cardTex = new THREE.CanvasTexture(cv);
  _cardTex.colorSpace = THREE.SRGBColorSpace;
  return _cardTex;
}

const _cardGeo = new Map();
/**
 * 一列葉團 → 一叢卡片的 `BufferGeometry`(逐型逐列快取一份;`markShared` ⇒ A25 跳過)。
 * `position` = 卡心重複四次、`normal` = 球面法線、`aCard` = (角落 x, 角落 y, 自轉),
 * 四角在**視域空間**展開(`toon.js` 的 `CEL_LEAFCARD` 區塊;中心點已經過了世界曲面那一刀
 * 與擺動 ⇒ 卡片自動吃到曲面、一整片同相位移,MUST NOT 在這裡再彎一次)。
 * 包絡認不出來 / 張數為零 ⇒ 回 `null`,呼叫端退回保險絲團塊(原則 6)。
 */
function leafRowGeo(type, part, pi) {
  const ck = `${type}|${pi}`;
  if (_cardGeo.has(ck)) return _cardGeo.get(ck);
  // **MUST 讀保險絲 `part.g` 的 parameters**(不是 partGeo 的解析結果):包絡與 `giantCrownR`
  // 吃同一組參數,畫出來的冠幅才不可能大過佈局用的那一份(leafcard.js 檔頭 ③④)
  const env = cardEnvelope(part.g?.parameters);
  const cards = env ? planCards(env, cardRnd(type, pi)) : [];
  if (!cards.length) { _cardGeo.set(ck, null); return null; }
  const n = cards.length;
  const pos = new Float32Array(n * 12), nor = new Float32Array(n * 12);
  const crd = new Float32Array(n * 12), uv = new Float32Array(n * 8);
  const idx = new Uint16Array(n * 6);
  const CU = [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]];
  cards.forEach((c, i) => {
    for (let k = 0; k < 4; k++) {
      const o = i * 4 + k;
      pos[o * 3] = c.cx; pos[o * 3 + 1] = c.cy; pos[o * 3 + 2] = c.cz;
      nor[o * 3] = c.nx; nor[o * 3 + 1] = c.ny; nor[o * 3 + 2] = c.nz;
      crd[o * 3] = CU[k][0] * c.hr; crd[o * 3 + 1] = CU[k][1] * c.hr; crd[o * 3 + 2] = c.rot;
      uv[o * 2] = CU[k][2]; uv[o * 2 + 1] = CU[k][3];
    }
    const b = i * 4;
    idx.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aCard', new THREE.BufferAttribute(crd, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingBox(); g.computeBoundingSphere();
  markShared(g);
  _cardGeo.set(ck, g);
  return g;
}

/**
 * 幫一列掛上逐實例的 `aSurfId`。**只換屬性、不動拓樸**:position / normal / uv / index
 * 沿用**同一份** `BufferAttribute`(與 `alignedGeo` 的窗格對齊同一個 idiom)⇒ draw call、
 * 三角形數、記憶體逐位元不動,只多一條逐實例的 float。
 * ⚠ 殼 `markShared` 註冊:它借用的是別人的屬性,被 `disposeTree` 放掉就會把保險絲幾何
 * (整場共用、每一場都要用)一起釋放 ⇒ 之後所有借用者變空白(A25 的原話)。
 */
function surfIdGeo(geo, attr) {
  if (!attr) return geo;               // 群組剪影關著 ⇒ 連殼都不建(逐位元同舊制)
  const q = new THREE.BufferGeometry();
  for (const k in geo.attributes) q.setAttribute(k, geo.attributes[k]);
  if (geo.index) q.setIndex(geo.index);
  q.boundingBox = geo.boundingBox;
  q.boundingSphere = geo.boundingSphere;
  q.setAttribute('aSurfId', attr);   // 逐型**一份**屬性,各列共用 ⇒ 一顆 GPU buffer
  return markShared(q);
}

/**
 * 把某類植被的所有實例組成 InstancedMesh(每 part 一個 draw call)。
 * `export` 是給 **3D 零件對照台**(dev-only)用的:那座台子要兩側都由**遊戲自己的**建構器建,
 * 不然「原版」跟遊戲裡的原版不是同一個東西而且不會報錯(對照台檔頭紀律 ①)。遊戲路徑不變。
 */
export function buildVegMeshes(type, items, season) {
  const def = VEG_DEFS[type] || GIANT_DEFS[type] || GIANT_DECO[type];
  const span = vegSpan(def);
  // 整樹節點(def.whole;2026-08-07 §5u,**2026-08-08 起是「一列以上」**):lib 全數載到 ⇒
  // 這一型只畫 whole 那幾列(保險絲零件全藏 —— 與 synthMegalith tower 的「載到就不 add 原
  // primitive」同語意);載不到 ⇒ rows = def.parts 逐位元同舊制。span/佈局仍讀 parts,
  // 零 rnd 消耗;庫的解析仍只經 partGeo 這一份(partGeo ≠ 保險絲 g ⇔ 節點真的載到了)。
  //
  // **為什麼一株樹要拆成木質 / 葉冠兩列**(2026-08-08 入庫輪;使用者定案「走零件庫」):
  // 一列 = 一個 InstancedMesh = **一份材質**。整株併成一列會同時失去三樣東西,而且三樣
  // 都沒有錯誤訊息 —— ①樹幹與葉冠同色;②`seasonColor` 的季節換色(那一列沒有 `key`);
  // ③**A39 軟性物質**:`vegSoftKind` 逐列判 ⇒ 一列只能二選一,不是樹幹跟著風擺就是葉子
  // 不擺(= 把「軟性物質隨風飄揚」整個關掉)。§5u 的 `snag_a` 能單列,是因為枯幹**本來
  // 就單色、不換季、不是軟性**,不是因為「整株一列」這件事本身成立。
  // **MUST 是全有全無**(`every`):只載到木質那一列 ⇒ 畫出一棵沒有葉子的樹,比整型退回
  // 保險絲更糟(原則 6 寧缺勿錯)。
  const whole = def.whole;
  const rows = (whole && whole.every((w) => partGeo(w) !== w.g)) ? whole : def.parts;
  const meshes = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion();
  const P = new THREE.Vector3(), S = new THREE.Vector3();
  const tint = new THREE.Color();
  // 逐株面號(②-1;零共享 `rnd()` —— 落點雜湊自帶種子,§2.3)。**整型算一次、每一列共用
  // 同一份陣列** ⇒ 同一株的幹 / 枝 / 冠拿到逐位元相同的號,群組早退才讀得出「這是一棵樹」。
  const grpOn = groupInkOn();
  let sidAttr = null;
  if (grpOn) {
    const arr = new Float32Array(items.length);
    items.forEach((it, i) => { arr[i] = leafSurfId(it.x, it.z); });
    sidAttr = new THREE.InstancedBufferAttribute(arr, 1);
  }
  rows.forEach((part, pi) => {
    // 日漫賽璐璐渲染(4 階 toon 漸層,取代寫實 PBR)
    // 軟性零件(葉/草)另帶擺動錨點:base = 這個零件的原點在整株上的高度、sy = 它自己的
    // 縱向壓縮 ⇒ 樹幹頂與樹冠底在同一個高度上拿到同一份權重,接合不會被風吹開。
    const sk = vegSoftKind(part);
    // 葉片卡是「畫什麼」的**第三個**解析結果(`lib` > 卡片 > 保險絲;優先序住 leafCardOn)。
    // 判定 MUST 沿用上面那一次 `vegSoftKind` 的結果 —— 再呼叫一次就是第二張名單(A39)。
    const card = leafCardOn(part, sk) ? leafRowGeo(type, part, pi) : null;
    // 材質選項一路收在同一個物件裡:`const mat = toonMat(seasonColor…` **全檔恰一處**
    // (`audit_soft_stroke` Ⅳ⑤ 釘住),分支寫成第二個呼叫點就是「軟性旗標有兩條路」
    // 樹幹/枝隨風搖曳(2026-09-02):「木質件」= 有葉子的樹型(TRUNK_TYPES) 且 sk===null。
    // 走 'wood' kind(amp 是 leaf 的一半、同 freq/axis)共用同一個 span ⇒ 幹梢與葉冠底部
    // 在相同 sw 高度上取到連續位移,接縫不會被風吹開。
    // ⚠ vegSoftKind **刻意不改**:audit_soft_stroke 的 hardOk 驗證木質件 vegSoftKind 回 null,
    //   此處直接在 mo 帶 soft 而不經 vegSoftKind,確保該驗證逐位元不變。
    const isTreeWood = !sk && TRUNK_TYPES.has(type);
    const mo = sk
      ? { soft: { k: sk, span, base: part.y || 0, sy: part.sy || 1 } }
      : isTreeWood
        ? { soft: { k: 'wood', span, base: part.y || 0, sy: part.sy || 1 } }
        : {};
    if (grpOn) {
      mo.surfAttr = true;                       // 面號改吃逐實例屬性 aSurfId
      if (sk === 'leaf') mo.ink = 'group';      // 葉列 = 群組剪影;木質列維持 'hard'(幹的折邊留著)
    }
    if (card) { mo.map = leafCardTex(); mo.alphaTest = 0.5; mo.transparent = false; mo.card = true; }
    const mat = toonMat(seasonColor(part.key, part.c, season), mo);
    // 畫的是 partGeo 解析結果(AI 零件庫 ?? 保險絲);佈局(span/冠幅)仍吃 p.g,見 partGeo 檔頭
    const m = new THREE.InstancedMesh(partGeo(part), mat, items.length);
    // 卡片與逐株面號**只換這一列的幾何**,那一行的解析縫一格未動:卡片是「畫什麼」的第三個
    // 解析結果,優先序 `lib` > 卡片 > 保險絲(判定住 `leafCardOn`);面號是只換屬性的殼。
    if (card || sidAttr) m.geometry = surfIdGeo(card || m.geometry, sidAttr);
    items.forEach((it, i) => {
      // 零件擺位 + 實例朝向/微傾斜(剛體)一律走 xform.js 的單一縫:
      // 併進逐零件歐拉角會讓 rx≠0 的枝叉被朝向攪亂、微傾斜變成分段剪切(接合開縫)
      const { pos, quat, scl } = vegPartXform(part, it);
      P.set(pos[0], pos[1], pos[2]);
      Q.set(quat[0], quat[1], quat[2], quat[3]);
      S.set(scl[0], scl[1], scl[2]);
      M.compose(P, Q, S);
      m.setMatrixAt(i, M);
      // 色彩細節隨機化(2026-07-29):hash 併入零件序 pi → 同株各零件抖動各自獨立
      // (葉團層層異色、板根塊塊異調),不再整株同一支 tint。
      // 葉/冠零件(key)振幅放大 = 明度連色相一起動;岩塊(j)次之;
      // 結構件(幹/枝/根)只小幅動明度 + 極淡暖冷偏,保住樹種手調色版
      const k = i * 197 + pi * 3121 + 1;
      const j1 = ((k * 2654435761) >>> 0) % 100 / 100;
      const j2 = ((k * 1597334677) >>> 0) % 100 / 100;
      const j3 = ((k * 3812015801) >>> 0) % 100 / 100;
      // 區域色相家族(2026-08-05;sakura-crossing):同一片林地共用一份「暖黃 ↔ 冷藍綠」
      // 偏向(這片林子偏黃、那片偏藍綠),逐簇只在家族之上再抖 —— 逐簇全隨機的每通道
      // 雜訊沒有族群感,只讀成顆粒。位置雜湊(格寬 ~110m ≈ 一個群落),零共享 rnd 消耗。
      const fqx = Math.floor(it.x / 110) | 0, fqz = Math.floor(it.z / 110) | 0;
      const fh = (Math.imul(fqx, 0x9E3779B1) ^ Math.imul(fqz, 0x85EBCA77)) | 0;
      const fu = ((Math.imul(fh ^ (fh >>> 15), 0xC2B2AE3D) >>> 0) % 1000) / 1000;
      if (part.key) tint.setRGB((0.74 + j1 * 0.5) * (0.92 + fu * 0.22), 0.74 + j2 * 0.5, (0.74 + j3 * 0.5) * (1.14 - fu * 0.22));
      else if (part.j) tint.setRGB(0.78 + j1 * 0.42, 0.78 + j2 * 0.42, 0.78 + j3 * 0.42);
      else {
        const l = 0.84 + j1 * 0.28;
        tint.setRGB(l * (0.97 + j2 * 0.06), l, l * (0.97 + j3 * 0.06));
      }
      m.setColorAt(i, tint);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.castShadow = false;
    m.frustumCulled = false;   // 實例散佈全圖,包圍球不可靠
    // 這一列是「哪一型的第幾件」——**建造端本來就知道,離線量測 MUST 問它而不是事後反推**。
    // 舊制 `measure_veg_tris` 以「幾何參數 + 材質色」當指紋去對回 VEG_DEFS,而同參同色是常態
    // (birch 與 mangrove 的 ico(2.0)、broadleaf 與 borderrock 的 ico(1.7)…)⇒ 碰撞群的
    // instance 數被**記給群裡每一列**,三個綠地場地量到 broadleaf 與 birch 同為 438
    // = 兩型互相灌帳。那個偏差方向雖然朝「算多」(閘門偏緊,不會放行過重的節點),
    // 但它同時讓 `node_cap` 的除數虛胖 ⇒ **合格的節點被擋在門外**,而紅字的理由與真正的
    // 三角形成本無關。純資訊、執行期沒有任何消費端,不影響渲染與權威幾何(原則 4)。
    m.userData.vegKind = type;
    m.userData.vegRow = pi;
    meshes.push(m);
  });
  return meshes;
}

// ---- 落花 / 落葉粒子(2026-08-16;`docs/anime_style_plan.md` ⑤-4)----
// 分工:**規則住 `petals.js`**(季節閘 / 三色調 / 分群 / 逐粒運動;零 THREE、只 import rng.js
// ⇒ 離線稽核 `audit_ambient_motion` 真的執行得到那些純函式),本檔只做三件事 ——
// ①把**最終**的植被實例名冊 `items` 翻成樹冠名冊 ②建三顆 InstancedMesh ③逐幀寫矩陣。
// 這與 `edgewall.js → buildEdgeWall`、`flags.js → placeBaseFlags` 是同一條分工。
//
// 三條會靜默壞掉的地方:
//   ・**共享 `rnd()` 的帳**:一律走專屬 `petalRnd(gseed)`,共享 `rnd`/`grnd` 消耗恆為 0。
//     多抽一枚就把後面每一株植被、每一棟建物的佈局整條推移(§2.3),而畫面上只表現成
//     「整張圖變了」,沒有任何錯誤訊息 —— `audit_siteplan`/`beacons`/`object_joints` 逐項不動
//     是唯一的證明面(它們驗規則不驗位置,所以「仍全綠」不算數)。
//   ・**A25**:單位四邊形**只有一份**且 `markShared` 註冊(整場共用的那份被 `disposeTree`
//     放掉 ⇒ 之後所有借用者變空白);逐色調各一顆 mesh = 三個 draw call、幾何不重配。
//   ・**半透明會把場景 RT 的 alpha 推離 1**(A39 的勾線門檻契約):落花蓋住的像素上,
//     背後建物邊的線會變細。量級極小(逐粒覆蓋率很低)且與「落花是軟性物質」自洽,
//     但要知道它存在 —— 看到幾根線變細時 MUST NOT 回頭去改勾線參數。
/**
 * 岸線環(鳥群的第一順位錨點)。**純幾何、零亂數、零共享 `rnd()`**。
 *
 * 手法:先用粗格掃 `terrainEnvCode`(與 `buildWaterEdges` 同一支判定)找出水域格,
 * 取其重心,再往 24 個方位射線,記下**最後一格仍是水**的位置 ⇒ 連成一條閉合折線。
 * 這一支刻意**不**去串「岸線 run」:那要處理分岔與多個水體,而鳥群只需要一條可飛的環,
 * 多解的複雜度買不到任何畫面上的差別(降級不例外,原則 6)。
 * 水域面積太小(< `MIN_CELLS` 格)⇒ 回 null = 這一類錨不到。
 */
function shoreRing(terrain) {
  if (terrain.waterY == null) return null;
  const MIN_CELLS = 12, DIRS = 24, CELL = 16;
  const cols = Math.max(4, Math.min(192, Math.ceil((terrain.maxX - terrain.minX) / CELL)));
  const rows = Math.max(4, Math.min(192, Math.ceil((terrain.maxZ - terrain.minZ) / CELL)));
  const dx = (terrain.maxX - terrain.minX) / cols, dz = (terrain.maxZ - terrain.minZ) / rows;
  let n = 0, sx = 0, sz = 0;
  const wet = new Uint8Array(cols * rows);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const x = terrain.minX + (j + 0.5) * dx, z = terrain.minZ + (i + 0.5) * dz;
    if (terrainEnvCode(terrain, x, z) !== 1) continue;
    wet[i * cols + j] = 1; n++; sx += x; sz += z;
  }
  if (n < MIN_CELLS) return null;
  const cx = sx / n, cz = sz / n;
  const isWet = (x, z) => {
    const j = Math.floor((x - terrain.minX) / dx), i = Math.floor((z - terrain.minZ) / dz);
    return i >= 0 && i < rows && j >= 0 && j < cols && wet[i * cols + j] === 1;
  };
  const step = Math.min(dx, dz) * 0.5;
  const reach = Math.hypot(terrain.maxX - terrain.minX, terrain.maxZ - terrain.minZ);
  const poly = [];
  for (let d = 0; d < DIRS; d++) {
    const th = (d / DIRS) * Math.PI * 2;
    const ux = Math.cos(th), uz = Math.sin(th);
    let last = 0;
    for (let r = 0; r <= reach; r += step) if (isWet(cx + ux * r, cz + uz * r)) last = r;
    // 岸線環往岸上退半格:鳥沿著水岸飛而不是壓在水面正上方
    poly.push([cx + ux * (last + step), cz + uz * (last + step)]);
  }
  return poly;
}

const BIRDS_OFF = typeof location !== 'undefined' && /[?&]birds=0/.test(location.search);
const FISH_OFF = typeof location !== 'undefined' && /[?&]fish=0/.test(location.search);
const CATS_OFF = typeof location !== 'undefined' && /[?&]cats=0/.test(location.search);
const DOGS_OFF = typeof location !== 'undefined' && /[?&]dogs=0/.test(location.search);

// ============ 生態動物群 (鳥群 / 魚群 / 貓 / 狗; 規則住 wildlife.js, 本支只建 mesh + 接既有的 dynamics) ============
// 三件事在這裡而不是在 wildlife.js:①錨點由**已經定案的世界幾何**推導(水域 / 神木林候選地 / 地標 / 聚落)
// ②InstancedMesh 與逐幀矩陣 ③夾制線與天花板由呼叫端**注入**(同 edgewall 的坡度門檻)。
// **零共享 `rnd()` 消耗**(§2.3):錨點是讀既有結果、逐隻抖動走座標雜湊。
// `birds = 0` 時不建曲線(零 mesh、零 dynamics 條目);預設密度由 visualPrefs 定案
function buildFlocks(group, terrain, dynamics, { anchors, low }) {
  const dens = visualPref('birds');
  if (BIRDS_OFF || !(dens > 0)) return 0;
  const inset = edgeWallInsetM();
  const bounds = {
    minX: terrain.minX + inset, maxX: terrain.maxX - inset,
    minZ: terrain.minZ + inset, maxZ: terrain.maxZ - inset,
  };
  const probe = (x, z) => terrain.heightAt(x, z);
  const altMax = objHeightMax();

  const birdRoutes = planFlockRoutes({ anchors, probe, bounds, altMax, low });
  const fishDens = visualPref('fish');
  const fishRoutes = (FISH_OFF || !(fishDens > 0) || terrain.waterY == null) ? []
    : planFishRoutes({ anchors, probe, bounds, waterY: terrain.waterY, low });
  const catDens = visualPref('cats');
  const catRoutes = (CATS_OFF || !(catDens > 0)) ? []
    : planCatRoutes({ anchors, probe, bounds, low });
  const dogDens = visualPref('dogs');
  const dogRoutes = (DOGS_OFF || !(dogDens > 0)) ? []
    : planDogRoutes({ anchors, probe, bounds, low });

  if (!birdRoutes.length && !fishRoutes.length && !catRoutes.length && !dogRoutes.length) return 0;

  const geoOf = (rows) => {
    const geos = [], cols = [];
    for (const p of rows) {
      const [t, a, b, c, sg] = p.g;
      const geo = t === 'box' ? new THREE.BoxGeometry(a, b, c)
        : t === 'cyl' ? new THREE.CylinderGeometry(a, b, c, sg || 6)
          : t === 'cone' ? new THREE.ConeGeometry(a, b, sg || 6)
            : new THREE.IcosahedronGeometry(a, 0);
      const m = new THREE.Matrix4();
      const [px = 0, py = 0, pz = 0] = p.p || [];
      const [rx = 0, ry = 0, rz = 0] = p.r || [];
      m.compose(new THREE.Vector3(px, py, pz),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
        new THREE.Vector3(1, 1, 1));
      geo.applyMatrix4(m);
      geos.push(geo); cols.push(p.c);
    }
    return mergeGeos(geos, cols);
  };

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), WQ = new THREE.Quaternion();
  const P = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1);
  const FWD = new THREE.Vector3(0, 0, 1), DIR = new THREE.Vector3(), AXZ = new THREE.Vector3(0, 0, 1), AY = new THREE.Vector3(0, 1, 0);
  const H = [0, 0, 0];

  // ① 鳥群
  const birdPartsList = birdParts();
  const birdBodyGeo = geoOf(birdPartsList.filter((p) => !p.wing));
  const birdWingGeo = [1, -1].map((s) => geoOf(birdPartsList.filter((p) => p.wing === s)));
  const birdFlocks = [];
  let total = 0;

  for (const route of birdRoutes) {
    const st = flockInit(route);
    const mk = (geo) => {
      const n = Math.max(1, Math.round(st.count * Math.min(1.5, dens)));
      const m = new THREE.InstancedMesh(geo, envMat(0xffffff, {
        vertexColors: true, wash: 0.3, cool: 0.45, rim: 0,
      }), n);
      m.frustumCulled = false;
      m.castShadow = false;
      group.add(m);
      return m;
    };
    birdFlocks.push({ st, body: mk(birdBodyGeo), wing: [mk(birdWingGeo[0]), mk(birdWingGeo[1])] });
    total += st.count;
  }

  // ② 魚群
  const fishPartsList = fishParts();
  const fishBodyGeo = geoOf(fishPartsList.filter((p) => !p.tail));
  const fishTailGeo = geoOf(fishPartsList.filter((p) => p.tail));
  const fishFlocks = [];
  for (const route of fishRoutes) {
    const st = wildlifeInit(route, FISH);
    const mk = (geo) => {
      const n = Math.max(1, Math.round(st.count * Math.min(1.5, fishDens)));
      const m = new THREE.InstancedMesh(geo, envMat(0xffffff, {
        vertexColors: true, wash: 0.4, cool: 0.6, rim: 0,
      }), n);
      m.frustumCulled = false;
      m.castShadow = false;
      group.add(m);
      return m;
    };
    fishFlocks.push({ st, body: mk(fishBodyGeo), tail: mk(fishTailGeo) });
    total += st.count;
  }

  // ③ 貓咪
  const catPartsList = catParts();
  const catBodyGeo = geoOf(catPartsList.filter((p) => !p.tail));
  const catTailGeo = geoOf(catPartsList.filter((p) => p.tail));
  const catFlocks = [];
  for (const route of catRoutes) {
    const st = wildlifeInit(route, CAT);
    const mk = (geo) => {
      const n = Math.max(1, Math.round(st.count * Math.min(1.5, catDens)));
      const m = new THREE.InstancedMesh(geo, envMat(0xffffff, {
        vertexColors: true, wash: 0.25, cool: 0.35, rim: 0,
      }), n);
      m.frustumCulled = false;
      m.castShadow = false;
      group.add(m);
      return m;
    };
    catFlocks.push({ st, body: mk(catBodyGeo), tail: mk(catTailGeo) });
    total += st.count;
  }

  // ④ 狗狗
  const dogPartsList = dogParts();
  const dogBodyGeo = geoOf(dogPartsList.filter((p) => !p.tail));
  const dogTailGeo = geoOf(dogPartsList.filter((p) => p.tail));
  const dogFlocks = [];
  for (const route of dogRoutes) {
    const st = wildlifeInit(route, DOG);
    const mk = (geo) => {
      const n = Math.max(1, Math.round(st.count * Math.min(1.5, dogDens)));
      const m = new THREE.InstancedMesh(geo, envMat(0xffffff, {
        vertexColors: true, wash: 0.25, cool: 0.35, rim: 0,
      }), n);
      m.frustumCulled = false;
      m.castShadow = false;
      group.add(m);
      return m;
    };
    dogFlocks.push({ st, body: mk(dogBodyGeo), tail: mk(dogTailGeo) });
    total += st.count;
  }

  const write = (t) => {
    // 渲染鳥群
    for (const f of birdFlocks) {
      const n = f.body.count;
      for (let i = 0; i < n; i++) {
        const j = (i % f.st.count) * 3;
        P.set(f.st.pos[j], f.st.pos[j + 1], f.st.pos[j + 2]);
        flockHeading(f.st, i % f.st.count, H);
        DIR.set(H[0], H[1], H[2]);
        if (DIR.lengthSq() > 1e-9) Q.setFromUnitVectors(FWD, DIR.normalize());
        M.compose(P, Q, S);
        f.body.setMatrixAt(i, M);
        const a = wingAngle(f.st, i % f.st.count, t);
        for (const s of [0, 1]) {
          WQ.setFromAxisAngle(AXZ, s === 0 ? a : -a);
          M.compose(P, WQ.premultiply(Q), S);
          f.wing[s].setMatrixAt(i, M);
        }
      }
      f.body.instanceMatrix.needsUpdate = true;
      for (const w of f.wing) w.instanceMatrix.needsUpdate = true;
    }

    // 渲染魚群 (水平擺尾)
    for (const f of fishFlocks) {
      const n = f.body.count;
      for (let i = 0; i < n; i++) {
        const j = (i % f.st.count) * 3;
        P.set(f.st.pos[j], f.st.pos[j + 1], f.st.pos[j + 2]);
        wildlifeHeading(f.st, i % f.st.count, H, FISH);
        DIR.set(H[0], H[1], H[2]);
        if (DIR.lengthSq() > 1e-9) Q.setFromUnitVectors(FWD, DIR.normalize());
        M.compose(P, Q, S);
        f.body.setMatrixAt(i, M);
        const a = tailAngle(f.st, i % f.st.count, t, FISH);
        WQ.setFromAxisAngle(AY, a);
        M.compose(P, WQ.premultiply(Q), S);
        f.tail.setMatrixAt(i, M);
      }
      f.body.instanceMatrix.needsUpdate = true;
      f.tail.instanceMatrix.needsUpdate = true;
    }

    // 渲染貓咪 (慢速優雅擺尾)
    for (const f of catFlocks) {
      const n = f.body.count;
      for (let i = 0; i < n; i++) {
        const j = (i % f.st.count) * 3;
        P.set(f.st.pos[j], f.st.pos[j + 1], f.st.pos[j + 2]);
        wildlifeHeading(f.st, i % f.st.count, H, CAT);
        DIR.set(H[0], 0, H[2]);
        if (DIR.lengthSq() > 1e-9) Q.setFromUnitVectors(FWD, DIR.normalize());
        M.compose(P, Q, S);
        f.body.setMatrixAt(i, M);
        const a = tailAngle(f.st, i % f.st.count, t, CAT);
        WQ.setFromAxisAngle(AY, a);
        M.compose(P, WQ.premultiply(Q), S);
        f.tail.setMatrixAt(i, M);
      }
      f.body.instanceMatrix.needsUpdate = true;
      f.tail.instanceMatrix.needsUpdate = true;
    }

    // 渲染狗狗 (快速搖尾 + 輕快小跑彈跳)
    for (const f of dogFlocks) {
      const n = f.body.count;
      for (let i = 0; i < n; i++) {
        const j = (i % f.st.count) * 3;
        const bY = bounceOffset(f.st, i % f.st.count, t, DOG);
        P.set(f.st.pos[j], f.st.pos[j + 1] + bY, f.st.pos[j + 2]);
        wildlifeHeading(f.st, i % f.st.count, H, DOG);
        DIR.set(H[0], 0, H[2]);
        if (DIR.lengthSq() > 1e-9) Q.setFromUnitVectors(FWD, DIR.normalize());
        M.compose(P, Q, S);
        f.body.setMatrixAt(i, M);
        const a = tailAngle(f.st, i % f.st.count, t, DOG);
        WQ.setFromAxisAngle(AY, a);
        M.compose(P, WQ.premultiply(Q), S);
        f.tail.setMatrixAt(i, M);
      }
      f.body.instanceMatrix.needsUpdate = true;
      f.tail.instanceMatrix.needsUpdate = true;
    }
  };

  write(0);   // 首幀就位(dynamics 還沒跑時不會整批疊在原點)
  dynamics.push((dt) => {
    const t = celWindTime();   // 全場共用的風時鐘(雲 / 植被同一支)
    for (const f of birdFlocks) flockStep(f.st, t, dt);
    for (const f of fishFlocks) wildlifeStep(f.st, t, dt, FISH);
    for (const f of catFlocks) wildlifeStep(f.st, t, dt, CAT);
    for (const f of dogFlocks) wildlifeStep(f.st, t, dt, DOG);
    write(t);
  });
  return total;
}

const PETAL_OFF = typeof location !== 'undefined' && /[?&]petal=0/.test(location.search);
let _petalGeo = null;
/** 單位四邊形(整場唯一一份;A25 markShared ⇒ disposeTree 跳過) */
const petalGeo = () => (_petalGeo ??= markShared(new THREE.PlaneGeometry(1, 1)));

/**
 * 落葉樹冠的量體(逐型算一次,零亂數):由 `key: 'foliage'` 的零件推導冠頂高與冠幅半徑。
 * **判據 MUST 是既有欄位**(同 `SOFT_BY_VEG_KEY` 那一條):另開一張「哪幾種樹會落葉」的名單
 * 遲早與季節換色那一份分家,而畫面上只表現成「這棵樹在落葉、旁邊同款的沒有」。
 * 佈局數學只讀**保險絲** `p.g`(partlib 紀律:庫幾何載不載得到逐客戶端不同,讀它 = 跨客戶端分家)。
 */
function foliageCrown(def) {
  const fs = def?.parts?.filter((p) => p.key === 'foliage');
  if (!fs?.length) return null;
  let top = 0, r = 0;
  for (const p of fs) {
    if (!p.g.boundingBox) p.g.computeBoundingBox();
    const bb = p.g.boundingBox;
    top = Math.max(top, (p.y || 0) + bb.max.y * (p.sy || 1));
    r = Math.max(r, Math.hypot(p.px || 0, p.pz || 0) + Math.max(bb.max.x, bb.max.z));
  }
  return { top, r };
}

/**
 * 建立落花層。回傳實得粒子數(0 = 這張圖沒有落葉樹或全被地貌閘擋掉 ⇒ 零 mesh 零 dynamics)。
 * @param items 最終的植被實例名冊(建物過濾已完成)
 */
function buildPetals(group, terrain, items, season, mode, dynamics, gseed) {
  const crowns = [];
  for (const type in items) {
    const cr = foliageCrown(VEG_DEFS[type]);   // 針葉常綠 / 草類 / 神木一律不在此列
    if (!cr) continue;
    for (const it of items[type]) {
      crowns.push({ x: it.x, z: it.z, top: it.y + cr.top * it.s, r: cr.r * it.s });
    }
  }
  if (!crowns.length) return 0;
  const { parts } = planPetalFields(crowns, {
    mode,
    groundAt: (x, z) => terrain.heightAt(x, z),
    // 地貌閘(第二道;樹本來就不長在水裡):水域/沼澤上不下花
    dryAt: (x, z) => terrainEnvCode(terrain, x, z) === 0,
    low: lowPower(),
  }, petalRnd(gseed));
  if (!parts.length) return 0;

  // 三色調由 `ENV.seasons[季]` 的 accent 與 foliage **推導**(petals.js petalTones),
  // MUST NOT 在此手寫色碼 —— 手寫那一份會在調季節色盤時靜默過期。
  const meshes = petalTones(ENV.seasons[season], mode).map((c, i) => {
    const n = parts.reduce((a, p) => a + (p.tone === i ? 1 : 0), 0);
    if (!n) return null;
    const m = new THREE.InstancedMesh(petalGeo(), envMat(c, {
      transparent: true, opacity: PETAL.OPACITY, depthWrite: false,
      side: THREE.DoubleSide, rim: 0, wash: 0, cool: 0,
    }), n);
    m.userData.noOutline = true;   // 0.2m 的碎片掛反轉外殼只會糊成一團黑
    m.frustumCulled = false;       // 實例散佈全圖,包圍球不可靠(同植被)
    m.castShadow = false;
    m.renderOrder = 2;             // 疊在不透明世界之上(同水岸泡沫的慣例)
    group.add(m);
    return m;
  });
  const seq = [0, 0, 0];
  for (const p of parts) p.mi = seq[p.tone]++;

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), AX = new THREE.Vector3();
  const P = new THREE.Vector3(), S = new THREE.Vector3();
  let t = 0;
  const write = (dt, dyn) => {
    t += dt;
    for (const p of parts) {
      stepPetal(p, dt, t, dyn);
      // 位置一律是「場中心線 + 偏移」:環繞因此是構造保證,不靠任何係數調得剛好
      P.set(p.cx + p.ox, p.y0 + p.oy, p.cz + p.oz);
      AX.set(p.ax, p.ay, p.az);
      Q.setFromAxisAngle(AX, p.ang);      // 逐粒隨機軸自轉(全部繞 Y = 一地的硬幣)
      S.set(p.sz * PETAL.ASPECT, p.sz, p.sz);
      M.compose(P, Q, S);
      meshes[p.tone]?.setMatrixAt(p.mi, M);
    }
    for (const m of meshes) if (m) m.instanceMatrix.needsUpdate = true;
  };
  write(0);   // 首幀就位(dynamics 尚未跑時不會整批疊在原點)
  // 逐幀 dt MUST 夾在 `PETAL.DT_MAX` —— 與 `toon.stepCelWind` 同一個理由(背景分頁切回來
  // 那一幀的 dt 是好幾秒,不夾就是整場落花瞬移到地面)。
  dynamics.push((dt) => write(Math.min(PETAL.DT_MAX, Math.max(0, dt || 0)), getWeatherDynamics()));
  return parts.length;
}

// ---- 建物(特殊地標 = 小 Group;住宅/商辦 = InstancedMesh)----
function bmat(color, opts = {}) {
  // 建物走環境賽璐璐:低頻水彩 wash 打破大立面單色 + 冷藍陰影(botw_plan Task 2.1/3.1)
  return envMat(color, { wash: 0.4, cool: 0.45, ...opts });
}
function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bmat(color));
  m.position.set(x, y + h / 2, z);
  return m;
}
// ---- 國旗貼圖(2026-08-13;版式與挑國住 `flags.js`,本檔只負責把它畫進畫布)----
// 畫布尺寸由 `FLAG_RATIO` 推導,MUST NOT 手寫寬高:比例一改而畫布沒跟著改,記號的座標
// (flags.js 一律用比例)就會被拉扁,而「哪一國」仍然對 ⇒ 看得出不對卻找不到是誰錯。
const FLAG_TEX_H = 48;
const _flagTexCache = new Map();
function flagTex(iso) {
  if (_flagTexCache.has(iso)) return _flagTexCache.get(iso);
  const H = FLAG_TEX_H, W = Math.round(H * FLAG_RATIO);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d');
  // 畫不出來(型錄沒有這一國)⇒ 回 null,呼叫端退回純色旗(原則 6:寧缺勿錯,
  // 一面空白的白旗在戰場上讀起來是投降旗,比掛一面無名的紅旗更糟)
  if (!drawFlag(cx, W, H, iso)) { _flagTexCache.set(iso, null); return null; }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  _flagTexCache.set(iso, t);
  return t;
}

/**
 * 旗面(軟性:細勾線 + 隨風飄揚;2026-08-04,2026-08-13 改掛國旗)。
 * `look` = ISO 二碼(國旗)**或**數字色(型錄查無此國時的退路,亦供不帶國籍情境的呼叫端)。
 *
 * 擺動權重沿**旗面自己的 −x → +x** 遞增(base = 半寬 ⇒ 左緣 0、右緣 1):場上的旗幟一律
 * 把旗桿放在旗面的 −x 側,所以桿邊不動、旗尾飄得最開。
 * **新增旗幟 MUST 沿用這個朝向**,否則會看到旗面繞著旗尾擺。
 *
 * 橫向分段(`FLAG_SEG`)是 2026-08-13 加的,而且**不是為了畫得細**:擺動是逐頂點的位移,
 * 一段的盒子只有兩排頂點 ⇒ 旗面只能被「整片剪過去」,那是**一塊被推歪的板子**不是飄揚。
 * 有了分段,`CEL_SWAY_H` 那條沿旗面推遲的相位才畫得出「波由旗桿往旗尾跑」。
 */
/**
 * 國旗歸屬(2026-08-13 使用者定案:**依戰場半邊**)。回一支純函式 `(x, z) → iso|null`。
 *   ・地圖國   = 場地的 `country` 旗幟 emoji(battleConfig 帶下來的;自訂地圖沒有 ⇒ null)
 *   ・駐軍國   = **離這個落點最近的那一座主堡**的陣營名冊裡抽一國
 *   ・敵對國   = 對面陣營的名冊
 * 比例 30 : 60 : 10 由 `flags.js FLAG_MIX` 定案,本檔 MUST NOT 自己再寫一份門檻。
 *
 * 為什麼吃 `cfg.bases` 而不是玩家選了誰:那兩個座標在**開房當下**就由
 * `rooms.rollSideSwap` 定案並隨 battleConfig 廣播全房(那支的檔頭明講擲點 MUST 留在房間
 * 階段,正是為了客戶端的地形預建)⇒ 建圖期拿得到、且跨客戶端逐位元一致(§2.3)。
 * 選角是房間階段之後的事,拿它當依據就得等開戰才建得出這一批物件。
 */
function makeNationPicker(cfg, basesW) {
  const map = isoOfFlagEmoji(cfg?.venue?.country);
  const roster = sideIsoRoster(CHARACTERS, LORE);
  return (x, z) => {
    let near = null, best = Infinity;
    for (const b of basesW) {
      const d2 = (x - b.x) ** 2 + (z - b.z) ** 2;
      if (d2 < best) { best = d2; near = b; }
    }
    const gar = near?.side === 'STEEL' ? 'STEEL' : 'SWARM';
    const foe = gar === 'SWARM' ? 'STEEL' : 'SWARM';
    return pickFlagIso(flagSeed(x, z), { map, garrison: roster[gar] || [], enemy: roster[foe] || [] })?.iso || null;
  };
}

const FLAG_SEG = 10;
function flag(w, h, d, look, x = 0, y = 0, z = 0) {
  const tex = typeof look === 'string' ? flagTex(look) : null;
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d, FLAG_SEG, 2, 1),
    // 有貼圖時底色走白:MeshToonMaterial 的 color 與 map 相乘,留著原本的紅會把整面旗染紅
    bmat(tex ? 0xffffff : (typeof look === 'string' ? 0xd93a2b : look),
      { soft: { k: 'cloth', span: w, base: w / 2 }, ...(tex ? { map: tex } : {}) }),
  );
  m.position.set(x, y + h / 2, z);
  return m;
}

// ---- 立面窗格貼圖(賽璐璐「畫上去的窗」;取代單一色塊)----
// 底色畫白 → 與材質 color / setColorAt 相乘 = 同貼圖多種外牆色。
// emissiveMap 只畫「亮著的窗」,夜間配 emissive 暖光 = 萬家燈火。
// 固定種子:全房間(乃至每次載入)同一張貼圖,不吃共享 rnd 的呼叫序。
const _facadeCache = new Map();
// style:'plain' 標準窗格 | 'curtain' 玻璃帷幕(整格寬窗)| 'balcony' 每層陽台帶 |
//       'shop' 底層店面(彩色遮陽棚 + 亮櫥窗)| 'hband' 整層水平帶窗(現代主義商辦)
// ---- 外牆圖層(2026-08-09 使用者定案:「不同類型、不同風格、平頂和斜頂等的建築外牆
// 圖層都要不同」「就算是摩天大樓外牆圖層也不要只有一種,同一種建築也要差異化」)----
//
// **這一層畫的是「牆本身是什麼做的」**,窗格是疊在它上面的另一件事 —— 舊制只有一種牆
// (純白 + 底部暗帶),所有差異都靠窗格節奏與 tint,結果是「每一棟的牆都是同一面牆」。
// 圖樣一律 **Canvas2D 程序生成**(skill procedural-canvas-textures / A2:不進二進位資產),
// 而**比例與配色參考語料庫那幾張 CC0 照片** —— 每一款下面註明參考的是哪一張:
//   boardv  直紋木板 + 壓縫條 ← `bld_barn/ov_910e1b06`(Highsmith 紅色穀倉:寬板 + 細壓條)
//   boardh  橫紋雨淋板         ← `bld_church/ov_16f1257f`(白色木造教堂:一層層的陰影線)
//   stone   亂石砌             ← `bld_stonecottage/ov_3966cc35`(蘇格蘭石屋:大小不一的塊石)
//   brick   磚砌               ← `bld_warehouse/ov_bd624950`(紅磚倉庫:交丁砌 + 灰縫)
//   stucco  灰泥               ← `bld_medit/ov_f42bb333`(地中海白牆:低頻污漬)
//   panel   預鑄混凝土板       ← `bld_office/ov_e62e476d`(板縫格線 + 板面明暗差)
//   spandrel 帷幕裙板帶        ← `bld_tower/ov_8811db29`(層間實心帶,玻璃只佔一部分)
//   plainw  純白(**舊制**,預設)—— 既有八款不指定 wall 時逐位元不變
//
// 逐款自帶種子(`key` 的雜湊)⇒ 同一款在不同建物上是同一張(貼圖有快取),差異落在
// **款式 × 窗格節奏 × 街區色相 × 逐棟 tint** 四層,而不是在這裡逐棟重畫一張。
function wallLayer(cx, W, H, kind, rnd) {
  const line = (a) => `rgba(0,0,0,${a})`;
  if (kind === 'boardv') {                       // 直紋木板:寬板 + 壓縫條
    const bw = W / 9;
    for (let i = 0; i <= 9; i++) {
      cx.fillStyle = line(0.16); cx.fillRect(i * bw - 0.5, 0, 1, H);
      cx.fillStyle = 'rgba(255,255,255,0.10)'; cx.fillRect(i * bw + 0.5, 0, 1.5, H);
    }
  } else if (kind === 'boardh') {                // 橫紋雨淋板:逐層下緣陰影
    const bh = 7;
    for (let y = 0; y < H; y += bh) {
      cx.fillStyle = line(0.13); cx.fillRect(0, y + bh - 1.5, W, 1.5);
      cx.fillStyle = 'rgba(255,255,255,0.08)'; cx.fillRect(0, y, W, 1);
    }
  } else if (kind === 'stone') {                 // 亂石砌:錯縫塊石 + 逐塊明暗
    const rh = 11;
    for (let y = 0, r = 0; y < H; y += rh, r++) {
      let x = -((r * 13) % 26);
      while (x < W) {
        const w = 14 + rnd() * 16;
        // 逐塊明暗**只走灰階**(2026-08-09 排面複核):三個通道各自擲一次 0/255 會擲出
        // 洋紅/青/黃那幾種組合 ⇒ 整面牆讀起來是粉彩拼布,而參考照片(托斯卡尼石屋)
        // 是暖灰與土黃的**同色系**塊石 —— 色相差異該由逐棟 tint 給,不是在貼圖裡擲。
        // 亂數枚數刻意維持 3 枚 ⇒ 序列不動,只有顏色變(其餘七款逐位元不受影響)。
        const g = rnd() < 0.5 ? 0 : 255;
        cx.fillStyle = `rgba(${g},${g},${g},${0.05 + rnd() * 0.04})`;
        rnd();
        cx.fillRect(x + 1, y + 1, w - 2, rh - 2);
        cx.fillStyle = line(0.15); cx.fillRect(x, y, 1, rh); cx.fillRect(x, y + rh - 1, w, 1);
        x += w;
      }
    }
  } else if (kind === 'brick') {                 // 磚砌:交丁 + 灰縫
    const bh = 5, bw = 15;
    for (let y = 0, r = 0; y < H; y += bh, r++) {
      cx.fillStyle = line(0.12); cx.fillRect(0, y + bh - 1, W, 1);
      for (let x = (r % 2) * bw / 2; x < W; x += bw) { cx.fillStyle = line(0.10); cx.fillRect(x, y, 1, bh - 1); }
    }
  } else if (kind === 'stucco') {                // 灰泥:低頻污漬(沒有幾何線)
    for (let i = 0; i < 26; i++) {
      const r = 8 + rnd() * 22;
      cx.fillStyle = `rgba(0,0,0,${0.02 + rnd() * 0.035})`;
      cx.beginPath(); cx.arc(rnd() * W, rnd() * H, r, 0, Math.PI * 2); cx.fill();
    }
  } else if (kind === 'panel') {                 // 預鑄混凝土板:板縫格線 + 逐板明暗差
    const pw = W / 4, ph = 26;
    for (let y = 0, r = 0; y < H; y += ph, r++) {
      for (let c = 0; c < 4; c++) {
        cx.fillStyle = `rgba(0,0,0,${0.02 + ((r + c) % 3) * 0.022})`;
        cx.fillRect(c * pw, y, pw, ph);
      }
      cx.fillStyle = line(0.14); cx.fillRect(0, y, W, 1);
    }
    for (let c = 0; c <= 4; c++) { cx.fillStyle = line(0.14); cx.fillRect(c * pw - 0.5, 0, 1, H); }
  } else if (kind === 'spandrel') {              // 帷幕裙板帶:層間實心帶(玻璃只佔一部分)
    for (let y = 0; y < H; y += 18) {
      cx.fillStyle = line(0.10); cx.fillRect(0, y, W, 6);
      cx.fillStyle = 'rgba(255,255,255,0.12)'; cx.fillRect(0, y + 6, W, 1);
    }
  }
}

// 屋頂帶圖樣(2026-08-09):畫在貼圖**底部** `MASS.UVB[桶].roof` 那一條 —— 庫節點的朝上面
// 被 `--roofband` 壓進 v ∈ [0, BAND],而 v=0 是畫布底邊(CanvasTexture 的 flipY 預設為真)。
// **MUST NOT 假設坡向**:兩顆節點的屋脊軸實測就不同(masslow_a 坡向 X、masslow_b 坡向 Z),
// 而屋頂面吃的是**平面投影** ⇒ 同一張貼圖在兩顆上轉了 90°。故四款一律「一向排列 + 另一向
// 接縫」的雙向紋理(真實瓦作本來就是這樣),讀起來兩個方向都成立。
// 逐款參考語料庫的 CC0 照片(人眼看過那一張,不是憑印象):
//   metal   浪板 ← `bld_barn/ov_910e1b06`(Highsmith 紅穀倉:鍍鋅浪板 + 一道橫向搭接)
//   shingle 木瓦 ← `bld_church/ov_16f1257f`(草原教堂:深色低對比、細層線)
//   pantile 筒瓦 ← `bld_stonecottage/ov_3966cc35`(托斯卡尼石屋:紅陶筒瓦 + 檐口厚邊)
//   tile    平瓦 ← `bld_chalet/ov_35100e42`(阿爾卑斯木屋:交丁錯縫的方瓦,逐列陰影明顯)
function roofLayer(cx, W, y0, h, col, kind, rnd) {
  const line = (a) => `rgba(0,0,0,${a})`;
  cx.fillStyle = col; cx.fillRect(0, y0, W, h);
  if (kind === 'metal') {                       // 浪板:密肋 + 橫向搭接縫
    for (let x = 0; x < W; x += 6) {
      cx.fillStyle = line(0.17); cx.fillRect(x, y0, 1.5, h);
      cx.fillStyle = 'rgba(255,255,255,0.13)'; cx.fillRect(x + 2.5, y0, 1, h);
    }
    for (let y = y0 + h * 0.5; y < y0 + h; y += h) { cx.fillStyle = line(0.22); cx.fillRect(0, y, W, 1.5); }
  } else if (kind === 'shingle') {              // 木瓦:低對比層線 + 交丁短縫
    const rh = 7;
    for (let y = y0, r = 0; y < y0 + h; y += rh, r++) {
      cx.fillStyle = line(0.14); cx.fillRect(0, Math.min(y + rh - 1, y0 + h - 1), W, 1);
      for (let x = (r % 2) * 7; x < W; x += 14) { cx.fillStyle = line(0.09); cx.fillRect(x, y, 1, rh - 1); }
    }
  } else if (kind === 'pantile') {              // 筒瓦:順向凸肋 + 逐列瓦頭陰影
    for (let x = 0; x < W; x += 9) {
      cx.fillStyle = 'rgba(255,255,255,0.16)'; cx.fillRect(x + 1, y0, 2.5, h);
      cx.fillStyle = line(0.15); cx.fillRect(x + 6, y0, 2, h);
    }
    for (let y = y0 + 9; y < y0 + h; y += 9) { cx.fillStyle = line(0.13); cx.fillRect(0, y, W, 2); }
  } else if (kind === 'tile') {                 // 平瓦:交丁錯縫的方瓦
    const rh = 9, bw = 11;
    for (let y = y0, r = 0; y < y0 + h; y += rh, r++) {
      cx.fillStyle = line(0.17); cx.fillRect(0, Math.min(y + rh - 1.5, y0 + h - 1.5), W, 1.5);
      for (let x = (r % 2) * bw / 2; x < W; x += bw) {
        cx.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.05})`; cx.fillRect(x, y, bw - 1, rh - 2);
        cx.fillStyle = line(0.12); cx.fillRect(x, y, 1, rh - 1.5);
      }
    }
  } else if (kind === 'flat') {
    // 平屋頂(2026-08-12,高層那一桶開屋頂帶用):防水層分格 + 設備基座 + 女兒牆內緣。
    // 高層的屋頂在畫面上多半是俯視或遠景剪影 ⇒ 要的是「不是玻璃帷幕」而不是細節。
    const gw = 21;
    for (let x = 0; x < W; x += gw) { cx.fillStyle = line(0.09); cx.fillRect(x, y0, 1, h); }
    for (let y = y0 + 10; y < y0 + h; y += 14) { cx.fillStyle = line(0.09); cx.fillRect(0, y, W, 1); }
    for (let i = 0; i < 3; i++) {                // 機房/水塔基座:低對比方塊
      const bwd = 10 + rnd() * 16, bht = Math.min(h * 0.4, 7 + rnd() * 9);
      cx.fillStyle = line(0.16); cx.fillRect(rnd() * (W - bwd), y0 + h * 0.2 + rnd() * (h * 0.4), bwd, bht);
    }
    cx.fillStyle = 'rgba(255,255,255,0.10)'; cx.fillRect(0, y0 + h - 5, W, 3);   // 女兒牆內緣受光
  }
  // 屋脊/檐口:帶的兩個邊緣各壓一道 —— 底邊(v=0)是屋頂最外那一圈,頂邊接著牆
  cx.fillStyle = line(0.24); cx.fillRect(0, y0, W, 1.5);
  cx.fillStyle = 'rgba(255,255,255,0.18)'; cx.fillRect(0, y0 + h - 2, W, 2);
}

// 貼圖高度隨列數長:每層固定拿到 `PX_PER_STOREY` 個 texel。舊制 H 恆 256 ⇒ 35 層的塔樓
// 一層只有 6.6px、窗高 3px = 一條橫線(層高對了、**窗還是細的**,而且離線讀數全正常)。
// 10 列以下維持 256 ⇒ **絕大多數建物的貼圖逐位元不變**;上界防止一張圖吃掉幾 MB。
// ⚠ 欄位刻意叫 `H_MIN`/`H_MAX` 而不是 `MIN_H` —— 後者與 `MASS.MIN_H`(整棟量體的樓高門檻)
// 同名,而**兩支稽核都以「原文裡的 MIN_H」抓那個門檻**:撞名的症狀是稽核說
// 「門檻 256/55」或「構不到 256m」,看起來像門檻被改壞了,其實只是抓錯了那一個。
const FACADE_PX = { PER_STOREY: 24, H_MIN: 256, H_MAX: 1024, FRAME: 1, ANISO: 4 };
const facadeTexH = (rows) =>
  Math.min(FACADE_PX.H_MAX, Math.max(FACADE_PX.H_MIN, Math.round(rows * FACADE_PX.PER_STOREY)));
// 窗框墨色(2026-08-13):賽璐璐的窗要有一條**線**,不只是一塊比牆深的色塊。
// 不透明度刻意不是 1 —— 全黑的框在夜景自發光那一層旁邊會讀成焦邊。
const WIN_INK = 'rgba(22,26,30,0.86)';

function facadeTex(key, cols, rows, winC, litRatio, style = 'plain', wall = 'plainw', roofC = 0, roofKind = '', bands = null, win = null) {
  if (_facadeCache.has(key)) return _facadeCache.get(key);
  const W = 128, H = facadeTexH(rows);
  // 三條帶由畫布**底部**往上排(v=0 是底邊,`CanvasTexture.flipY` 預設為真):
  //   [0, roof)              屋頂帶      —— 庫節點的朝上面
  //   [roof, roof+plain)     素牆帶      —— 傾斜/朝下的面(2026-08-12,見 `MASS.UVB` 檔頭)
  //   [roof+plain, 1]        窗牆帶      —— 近垂直的面,只有這一帶畫窗
  // 沒有屋頂色 ⇒ band = pband = 0 ⇒ `WW === H` ⇒ 既有 16 款與六支地標**逐位元不變**
  // (連 wallLayer 的 rnd 消耗都不動 —— 它的迴圈吃高度)。
  const band = roofC ? Math.round(H * (bands ? bands.roof : 0)) : 0;
  const pband = roofC && bands ? Math.round(H * bands.plain) : 0;
  const WH = H - band;                                                   // 屋頂帶以外(= 牆的全部)
  const WW = WH - pband;                                                 // 其中真的畫窗的那一段
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d');
  const em = document.createElement('canvas'); em.width = W; em.height = H;
  const ex = em.getContext('2d');
  cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, W, WH);
  cx.fillStyle = 'rgba(0,0,0,0.18)'; cx.fillRect(0, WW - 14, W, 14);     // 底層基座暗帶
  ex.fillStyle = '#000000'; ex.fillRect(0, 0, W, H);                     // 屋頂/素牆帶恆不發光
  const rnd = mulberry32(0xFACADE ^ (cols * 131 + rows * 7));
  // 外牆圖層排在窗格**之前**:窗要蓋在牆上,不是牆蓋在窗上。`plainw` = 舊制純白 ⇒
  // 沒有指定 wall 的八款逐位元不變(而且它們的 rnd 序列也不動:plainw 不抽數)。
  // **素牆帶吃同一份牆材質**(它就是「這棟樓的牆,只是沒有窗」)⇒ 一次畫到 WH。
  wallLayer(cx, W, WH, wall, rnd);
  const cw = W / cols, ch = (WW - 26) / rows;                            // 頂部留女兒牆帶
  // 窗格幾何依樣式:[x偏,y偏,寬,高](格內比例);帷幕窗近乎滿格。
  // **`win` 是逐款覆寫**(2026-08-12 使用者定案「不同建築使用窗戶圖層間距不要都一樣,
  // 也可以使用幾乎無間距的玻璃牆」):`[fw, fh]` = 窗在格內的寬高佔比,間距 = 1 − fh。
  // 沒給 ⇒ 走舊制那兩組 ⇒ 逐位元不變。y 偏移由 fh 反推**置中**(給了高卻讓它黏在上緣的話,
  // 窗越高裙板就越偏,而使用者要的正是「間距不一樣」而不是「窗往上跑」)。
  const base = style === 'curtain' ? [0.05, 0.10, 0.90, 0.80] : [0.18, 0.18, 0.64, 0.64];
  const [ox, oy, fw, fh] = win
    ? [(1 - win[0]) / 2, (1 - win[1]) / 2, win[0], win[1]]
    : base;
  // ---- 窗格輪廓銳利化(2026-08-13 使用者「窗戶圖層輪廓都太模糊」)----
  // 三個成因疊在一起,只修一個看不出差別:
  //   ㋐ **畫的時候就是糊的**:`cw = W / cols` 與 `ch = (WW − 26) / rows` 都是小數 ⇒ 每一格窗
  //      的四個邊都落在 texel **中間**,而 Canvas2D 對非整數的 `fillRect` 會反鋸齒 —— 邊緣
  //      先變成一條半透明漸層,再被 `NearestFilter` 原封不動放大成一條糊帶。硬邊窗格那句
  //      註解從第一天起就只兌現了一半:放大是硬的,**畫進去的本來就是軟的**。
  //      ⇒ 邊界一律 `Math.round` 到整數 texel(寬高各留 1 texel 下限)。
  //   ㋑ **沒有輪廓可言**:舊制的窗只是一塊比牆深的色塊 —— 牆與窗都是中間調,遠一點就糊成
  //      一片。⇒ 補一道 `FACADE_PX.FRAME` texel 的**窗框**,那才是使用者說的「輪廓」。
  //      窗太小(放不下框 + 1 texel 玻璃)就不畫框 —— 全框的窗會變成一個實心黑點。
  //   ㋒ **縮小時沒有各向異性過濾**:立面幾乎永遠是掠射角,而 `anisotropy` 預設 1 ⇒ GPU 取到
  //      很高的 mip 階 = 整面糊掉。全專案其他六張貼圖都設 4(terrain/paint/worldtext…),
  //      只有立面這張漏了。
  const R = Math.round, FR = FACADE_PX.FRAME;
  /** 對齊整數 texel(寬高至少 1 texel);回傳 [x, y, w, h] */
  const snap = (x, y, w, h) => {
    const x0 = R(x), y0 = R(y);
    return [x0, y0, Math.max(1, R(x + w) - x0), Math.max(1, R(y + h) - y0)];
  };
  /** 畫一格窗:窗框(= 輪廓)→ 玻璃 → 上緣高光帶。回傳 snap 後的矩形,**自發光層吃同一組**
   *  座標(兩層各自 round 會差半個 texel ⇒ 夜裡亮的那一塊與白天的窗錯開一條邊) */
  const pane = (x, y, w, h) => {
    const [px, py, pw, ph] = snap(x, y, w, h);
    if (pw >= FR * 2 + 1 && ph >= FR * 2 + 1) {
      cx.fillStyle = WIN_INK; cx.fillRect(px, py, pw, ph);
      cx.fillStyle = winC; cx.fillRect(px + FR, py + FR, pw - FR * 2, ph - FR * 2);
      cx.fillStyle = 'rgba(255,255,255,0.35)';
      cx.fillRect(px + FR, py + FR, pw - FR * 2, Math.max(1, R((ph - FR * 2) * 0.2)));
    } else {
      cx.fillStyle = winC; cx.fillRect(px, py, pw, ph);
      cx.fillStyle = 'rgba(255,255,255,0.35)'; cx.fillRect(px, py, pw, Math.max(1, R(ph * 0.2)));
    }
    return [px, py, pw, ph];
  };
  if (style === 'glass') {
    // **幾乎無間距的玻璃牆**(2026-08-12 使用者定案的後半):整面玻璃 + 髮絲級橫豎框,
    // 沒有裙板帶 —— 這是與 `curtain`(有 spandrel 裙板)本質不同的一種立面,不是它的參數。
    // 亮燈仍逐格擲(整層一起亮會讀成霓虹燈管而不是辦公室)。
    const gy0 = 12, gh = WW - 26;
    cx.fillStyle = winC; cx.fillRect(0, gy0, W, gh);
    for (let r = 0; r <= rows; r++) {
      const y = R(12 + r * ch);
      cx.fillStyle = 'rgba(255,255,255,0.30)'; cx.fillRect(0, y - 1, W, 1);       // 樓層橫框
      cx.fillStyle = 'rgba(15,20,25,0.22)'; cx.fillRect(0, y, W, 1.5);
    }
    for (let c = 0; c <= cols; c++) {
      const x = R(c * cw);
      cx.fillStyle = 'rgba(15,20,25,0.18)'; cx.fillRect(x, gy0, 1.5, gh);
      cx.fillStyle = 'rgba(255,255,255,0.25)'; cx.fillRect(x - 1, gy0, 1, gh);
    }
    for (let r = 0; r < rows; r++) {
      const y = R(12 + r * ch), y2 = R(12 + (r + 1) * ch);
      cx.fillStyle = 'rgba(255,255,255,0.18)';
      cx.fillRect(0, y + R(ch * 0.08), W, Math.max(1, R(ch * 0.22)));             // 反射帶
      for (let c = 0; c < cols; c++) {
        const x = R(c * cw), x2 = R((c + 1) * cw);
        if (rnd() < litRatio) { ex.fillStyle = '#ffb45e'; ex.fillRect(x + 1, y + 1, Math.max(1, x2 - x - 2), Math.max(1, y2 - y - 2)); }
      }
    }
  } else if (style === 'hband') {                                        // 整層絲帶窗 + 豎框
    const useFh = Math.max(0.55, fh);
    for (let r = 0; r < rows; r++) {
      const [px, py, pw, ph] = pane(3, 12 + r * ch + ch * (0.5 - useFh / 2), W - 6, ch * useFh);
      cx.fillStyle = 'rgba(255,255,255,0.45)';
      for (let c = 1; c < cols; c++) cx.fillRect(R(c * cw) - 1, py, 2, ph);
      if (rnd() < litRatio) { ex.fillStyle = '#ffb45e'; ex.fillRect(px, py, pw, ph); }
    }
  } else for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [px, py, pw, ph] = pane(c * cw + cw * ox, 12 + r * ch + ch * oy, cw * fw, ch * fh);
      if (rnd() < litRatio) { ex.fillStyle = '#ffb45e'; ex.fillRect(px, py, pw, ph); }
    }
    if (style === 'balcony') {                                           // 每層窗下的陽台欄板帶
      const bx = R(cw * 0.06), by = R(12 + r * ch + ch * (oy + fh)), bw = W - bx * 2;
      cx.fillStyle = 'rgba(0,0,0,0.14)'; cx.fillRect(bx, by, bw, Math.max(1, R(ch * 0.16)));
      cx.fillStyle = 'rgba(255,255,255,0.3)'; cx.fillRect(bx, by, bw, 1);
    }
  }
  if (style === 'shop') {                                                // 底層店面:遮陽棚 + 櫥窗
    const awn = ['#c25c4a', '#3f7a8c', '#c7a13d', '#5c8a52'];
    for (let c = 0; c < cols; c++) {
      const [ax, , aw] = snap(c * cw + cw * 0.12, 0, cw * 0.76, 1);
      const [wx, , ww] = snap(c * cw + cw * 0.18, 0, cw * 0.64, 1);
      cx.fillStyle = awn[Math.floor(rnd() * awn.length)];
      cx.fillRect(ax, WW - 34, aw, 8);
      cx.fillStyle = WIN_INK; cx.fillRect(wx - FR, WW - 25 - FR, ww + FR * 2, 11 + FR * 2);
      cx.fillStyle = '#2c343c'; cx.fillRect(wx, WW - 25, ww, 11);
      if (rnd() < 0.7) { ex.fillStyle = '#ffd9a0'; ex.fillRect(wx, WW - 25, ww, 11); }
    }
  }
  // 素牆帶:牆的材質已經畫到 WH 了,這裡只補「它不是窗牆」的兩道界線
  // ——上緣一道暗縫(退縮處的陰角)、下緣一道受光(斜面朝天的那一側比較亮)
  if (pband) {
    cx.fillStyle = 'rgba(0,0,0,0.16)'; cx.fillRect(0, WW, W, 2);
    cx.fillStyle = 'rgba(255,255,255,0.10)'; cx.fillRect(0, WH - 3, W, 3);
  }
  if (band) roofLayer(cx, W, WH, band, `#${(roofC >>> 0).toString(16).padStart(6, '0')}`, roofKind, rnd);
  const mk = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;   // 硬邊窗格 = 漫畫筆觸(放大那一半)
    // 縮小那一半:立面幾乎永遠是掠射角,`anisotropy` 預設 1 ⇒ GPU 取到很高的 mip 階 =
    // 整面糊掉。這是「窗戶輪廓太模糊」在**遠景**的成因(近景是畫進去就糊,見 `pane`)。
    t.anisotropy = FACADE_PX.ANISO;
    // 橫向環繞:窗格貼齊面板之後(2026-08-13,`wallpanel.js`)一片斜牆的 u 可以超過 1
    // ——貼圖橫向本來就是逐欄重複的,環繞是恆等的。**縱向 MUST 維持 clamp**:
    // v 是三條帶,捲起來就是屋頂帶接在窗牆帶上面。
    t.wrapS = THREE.RepeatWrapping;
    return t;
  };
  const out = { map: mk(cv), emissiveMap: mk(em) };
  _facadeCache.set(key, out);
  return out;
}

// 一般建物外牆色盤(setColorAt 相乘;暖灰住宅 vs 冷色玻璃帷幕,
// 2026-07-10 擴充二:焦糖/赭石/鼠尾草綠/霧藍/玫瑰灰、深青玻璃/古銅/板岩/暮紫;
// 2026-07-12 擴充三:BOTW 水彩灰泥系 —— 奶油白/陶土橘/苔綠/粉青/杏褐、湖青/藤紫/松石/暖沙)
const PALETTE = {
  residential: [0xc4b8a8, 0xb0a494, 0xccc0b4, 0xa8b0ac, 0xc8b09a, 0xb8ac9c,
                0xc99a7e, 0xb3766a, 0xd6c48e, 0x9db3a4, 0xa9b8c8, 0xd8cfc4,
                0xd9a06a, 0xa77e5f, 0xc5cfa8, 0x8fa6b8, 0xd7b8b0, 0xbfae8e,
                0xe0cba8, 0xc98a5e, 0x9fae8e, 0xb8c4d6, 0xcc9e8a, 0xa89a78],
  commercial:  [0x7a92a4, 0x6a8294, 0x8aa0b0, 0x9aa8b0, 0x708898, 0x84909c,
                0x5f7d8c, 0x7f96b2, 0x6e8a7a, 0x8d95ac, 0x9fb4bd, 0x63707e,
                0x4f7a72, 0x8a7a5f, 0x50606e, 0x7c88a8, 0x9aa899, 0x6a7f95,
                0x486a80, 0x7aa0a8, 0x94a4c0, 0x5f8a80, 0x8f9a78, 0x6a7a9c],
};

// 立面樣式變體:同類建物分八款(窗格疏密/窗色/亮燈率/樣式/牆的材質/屋頂色),
// 街景擺脫「同一張貼圖複製貼上」;v 在建物生成時決定性分配。
// **`rows`(窗格列數)刻意不在這張表上** —— 見下方 `facadeRows`:它由**那一件的高度**推導。
// 款只管「窗長什麼樣」(落地窗/帷幕/小窗),層高由 STOREY 那一帶管(2026-08-09 使用者定案)。
// **`win: [寬佔比, 高佔比]`**(2026-08-12 使用者定案「不同建築使用窗戶圖層間距不要都一樣,
// 也可以使用幾乎無間距的玻璃牆」)。窗在一個樓層格內佔多少 ⇒ **上下間距 = 1 − 高佔比**。
// 舊制只有兩組幾何(帷幕 0.86×0.62、其餘一律 0.52×0.48)⇒ 十六款樓的窗間距只有兩種,
// 一整條街讀起來是同一張貼圖。層高本身**仍夾在 `STOREY` 帶內**(2026-08-09 使用者定案
// 「上下樓層間距要在合理差異範圍以內」不動)—— 這一輪改的是**窗在那一層裡佔多少**,
// 兩件事正交:層高是現實約束,窗佔比是建築風格。
// `glass` 是一種**立面**不是一組參數:整面玻璃 + 髮絲框、沒有裙板帶(見 facadeTex)。
const FACADES = {
  residential: [
    { key: 'res0', cols: 4, winC: '#3a4046', lit: 0.3,  style: 'shop',    wall: 'stucco',  roof: 0x9c8e7c, win: [0.65, 0.60] },
    { key: 'res1', cols: 3, winC: '#46525e', lit: 0.22, style: 'balcony', wall: 'panel',   roof: 0x8a6f5a, win: [0.68, 0.58] },
    { key: 'res2', cols: 4, winC: '#333b42', lit: 0.36, style: 'plain',   wall: 'brick',   roof: 0x7a8577, win: [0.62, 0.64] },
    { key: 'res3', cols: 3, winC: '#4a3f38', lit: 0.26, style: 'balcony', wall: 'stucco',  roof: 0xa2543e, win: [0.70, 0.60] },
    { key: 'res4', cols: 4, winC: '#3d4750', lit: 0.32, style: 'shop',    wall: 'panel',   roof: 0x6e7f8a, win: [0.64, 0.66] },
    { key: 'res5', cols: 3, winC: '#3f4a3a', lit: 0.28, style: 'plain',   wall: 'boardh',  roof: 0xb98455, win: [0.64, 0.58] },
    { key: 'res6', cols: 4, winC: '#52453c', lit: 0.24, style: 'balcony', wall: 'brick',   roof: 0x87795f, win: [0.65, 0.60] },
    { key: 'res7', cols: 3, winC: '#43382e', lit: 0.3,  style: 'shop',    wall: 'boardv',  roof: 0x8a5a40, win: [0.68, 0.62] },
  ],
  commercial: [
    { key: 'com0', cols: 4, winC: '#2e3c4a', lit: 0.55, style: 'plain',   wall: 'panel',    roof: 0x707c88, win: [0.72, 0.66] },
    { key: 'com1', cols: 5, winC: '#243240', lit: 0.68, style: 'glass',   wall: 'spandrel', roof: 0x5c6874 },
    { key: 'com2', cols: 4, winC: '#35424e', lit: 0.45, style: 'shop',    wall: 'brick',    roof: 0x86766a, win: [0.70, 0.62] },
    { key: 'com3', cols: 3, winC: '#1f3a38', lit: 0.6,  style: 'hband',   wall: 'spandrel', roof: 0x4f6a66, win: [0.94, 0.62] },
    { key: 'com4', cols: 4, winC: '#2c3350', lit: 0.5,  style: 'curtain', wall: 'panel',    roof: 0x5a5f7c, win: [0.92, 0.80] },
    { key: 'com5', cols: 5, winC: '#1e2e3e', lit: 0.62, style: 'glass',  wall: 'panel',    roof: 0x6a7a6a },
    { key: 'com6', cols: 4, winC: '#2a3a46', lit: 0.4,  style: 'shop',    wall: 'stucco',   roof: 0x7c6a58, win: [0.68, 0.66] },
    { key: 'com7', cols: 4, winC: '#2e3d3a', lit: 0.48, style: 'hband',   wall: 'brick',    roof: 0x6a7468, win: [0.94, 0.60] },
  ],
};

// **斜頂低矮建物專用的立面家族**(2026-08-09 使用者回報「斜頂屋頂外觀變摩天大樓的玻璃」)。
// 成因是庫節點是**單一材質群組** ⇒ three 取 material[0] = 那一款的立面貼圖,而方盒路徑
// 的屋頂本來走另一個材質(`[wall, wall, roof, roof, wall, wall]` 的第 3/4 格)—— 對平頂
// 塔樓那是刻意的取捨(俯視看得到頂面的機會低),對**斜屋頂**卻是整個剪影最顯眼的那一面。
// ⇒ 這一桶改吃自己的家族:**木板/石砌/灰泥/磚**這類鄉村與公共建築的牆,窗小、亮燈率低、
// 沒有帷幕玻璃也沒有店面遮陽棚 —— 就算貼到斜屋頂上,讀起來也是「同一種材料蓋的屋頂」
// 而不是玻璃帷幕。款式由**落點雜湊**決定(零 rnd,§2.3)⇒ 同一張圖上的穀倉彼此不同。
// **2026-08-09 第二輪**:上面那一段只換掉了牆的材質感,窗格仍印在斜屋頂上(單一材質群組
// 這件事沒變)。這一輪把區分移進 UV(`MASS.UVB`),於是這張表多一個 `rf` 欄
// —— 「屋頂形式」自此是真的屋頂形式,而不是牆的顏色換一換。
const FACADES_PITCHED = [
  { key: 'pit0', cols: 4, rows: 3, winC: '#3a2f28', lit: 0.12, style: 'plain', wall: 'boardv', roof: 0x8f9298, rf: 'metal', win: [0.52, 0.52] },    // 木板穀倉 + 鍍鋅浪板
  { key: 'pit1', cols: 3, rows: 3, winC: '#44505c', lit: 0.16, style: 'plain', wall: 'boardh', roof: 0x4a4a48, rf: 'shingle', win: [0.52, 0.62] },  // 雨淋板教堂 + 深色木瓦(細長窗)
  { key: 'pit2', cols: 3, rows: 2, winC: '#4a4238', lit: 0.18, style: 'plain', wall: 'stone',  roof: 0xa2543e, rf: 'pantile', win: [0.56, 0.54] },  // 石砌農舍 + 紅陶筒瓦
  { key: 'pit3', cols: 4, rows: 3, winC: '#4e463c', lit: 0.2,  style: 'plain', wall: 'stucco', roof: 0x8a4a3a, rf: 'tile', win: [0.58, 0.56] },     // 灰泥民宅 + 平瓦
  { key: 'pit4', cols: 5, rows: 3, winC: '#38404a', lit: 0.16, style: 'plain', wall: 'brick',  roof: 0x6a7078, rf: 'metal', win: [0.65, 0.54] },    // 磚造校舍/倉庫 + 金屬浪板(橫向長窗)
  { key: 'pit5', cols: 3, rows: 3, winC: '#332c26', lit: 0.14, style: 'plain', wall: 'boardv', roof: 0x5e6e52, rf: 'shingle', win: [0.54, 0.60] },  // 深色木造 + 苔綠木瓦
];

// ---- 街區色相家族(2026-08-05;sakura-crossing「變化要落在正確層級」)----
// 逐棟全隨機的色抖是均勻雜訊,反而讀成單調;真正讀得出「這一帶」的是:同一街區的樓
// 共用一份色相/飽和偏移(家族),跨街區才換家族,逐棟只在家族之上再抖明度與一點色相。
// 雜湊吃世界座標(格寬 ≈ 一個街廓),**零共享 rnd 消耗**(§2.3;同 djAt 的落點雜湊語意)。
const BLK_M = 76;
function blockTone(x, z) {
  const h = (Math.imul(Math.floor(x / BLK_M) | 0, 0x9E3779B1) ^ Math.imul(Math.floor(z / BLK_M) | 0, 0x85EBCA77)) | 0;
  const u = ((Math.imul(h ^ (h >>> 15), 0xC2B2AE3D) >>> 0) % 100003) / 100003;
  const v = ((Math.imul(h ^ (h >>> 11), 0x27D4EB2F) >>> 0) % 100003) / 100003;
  return { u, v, dh: (u - 0.5) * 0.09, ds: (v - 0.5) * 0.24, dl: (u + v - 1) * 0.05 };
}

// ---- 樓層間距(2026-08-09 使用者定案)----
// 「不同建築可以有不同窗戶大小(玻璃大樓/落地窗),但**上下樓層間距要在合理差異範圍以內**,
//   因為現實世界每棟建築每層高度差異不大。」
//
// **成因**:立面貼圖沒有 per-instance repeat ⇒ 一張貼圖被拉滿**那一件的整個高度**
// ⇒ 層高 = 件高 ÷ 列數。舊制的列數是**立面款自帶的常數**,只靠三段樓高分桶粗調
// ⇒ 實測全面出界(層高):住宅 h=8m → **1.6m**、商辦 h=13m → **1.1m**、
//    h=104m → 6.5~8.7m;而最誇張的是**同一棟的附件件** —— 退縮頂塔與臨街裙樓有自己
//    的高度卻吃同一張貼圖:100m 塔樓的裙樓(12m)拿 16 列 = **0.75m 一層**。
// ⇒ 列數 MUST 由**那一件自己的高度**推導,而且分桶 MUST 逐件(不是逐棟)。
//
// 規則:先取讓層高落在 [MIN, MAX] 的候選列數(這就是使用者說的「合理差異範圍」),
// 其中**最接近該類別目標層高**者;沒有候選(件太矮,只放得下一層)才退回最接近者。
// 取「最接近」比的是**比值**(log 距離)不是差值 —— 層高是比例量,20 列差 1 列與
// 2 列差 1 列不是同一件事。
const STOREY = {
  residential: 3.1,   // 住宅/一般樓房的目標層高(現實 2.8~3.6)
  commercial: 3.9,    // 商辦/店面(現實 3.2~4.6;首層挑高與設備層拉高平均)
  MIN: 2.6,           // ↓ 這一帶就是「合理差異範圍」;MAX/MIN = 2.08 > 級距比 ⇒ 恆有候選
  MAX: 5.4,           // 上界含單層倉庫/教堂中殿那種挑高;MIN·MAX/(MAX−MIN) = 5.01m
                      //   ⇒ 高於 5.01m 的件必有合法列數,低於它的只放得下一層(層高 = 件高)
};
// 列數級距:每級 ×`STEP`。**級距同時是畫質與 draw call / 貼圖記憶體的旋鈕**——
// 立面桶依「款 × 列數」分桶,級數一多桶數就跟著長:taipei101 --live 實測
// **×1.2 的 17 級 → 145 個 facade 桶**(每桶一張 128×H 的貼圖 = 幾十 MB),
// 改 ×1.35 的 12 級 + 款綁級距帶之後 → **50 個**(全場 2,732 個 mesh,佔 1.8%)。
// 級距只要**比帶寬比窄**就恆有落在帶內的候選(見 STOREY.MAX/MIN = 2.08);
// 1.5 讓同類層高散到 1.67×、1.25 只收到 1.31× 卻多兩級 ⇒ 取 1.35(同類 1.40×)。
// 桶數的**結構上界** = 2 類別 × 款數 × 級數(= 192):款綁的是**那一棟**的帶,而
// 退縮頂塔/裙樓吃自己的列數 ⇒ (款, 列數) 不只落在對角線上。
// 上界由**世界物件高度上限**推導(建物最高就是那個值),MUST NOT 手寫:頂級要讓
// 最高的那一棟**還能貼近自己的目標層高** ⇒ ≥ `objHeightMax() / 最小的那個目標`。
// (只取 `/ STOREY.MAX` 是「放得下」而不是「貼得近」:實測那樣 104m 的住宅只有 22 列
//  = 層高 4.73m —— 合法但一路貼著上界,而畫面上就是「高樓的樓層特別高」。)
const ROW_LADDER = (() => {
  const STEP = 1.35;
  const need = objHeightMax() / Math.min(STOREY.residential, STOREY.commercial);
  const a = [1];
  while (a[a.length - 1] < need) a.push(Math.max(a[a.length - 1] + 1, Math.round(a[a.length - 1] * STEP)));
  return a;
})();
// 一個級距帶配兩款(款只管窗長什麼樣)—— 同高度的鄰棟仍有兩種立面,而桶數不隨級數翻倍。
const LOOKS_PER_BAND = 2;
/** 這一件的窗格列數(唯一縫:方盒桶 / 整棟量體桶 / 斜頂桶三處同吃) */
function facadeRows(h, commercial) {
  const t = commercial ? STOREY.commercial : STOREY.residential;
  const want = Math.max(h, 1e-3) / t;
  const inBand = ROW_LADDER.filter((r) => h / r >= STOREY.MIN && h / r <= STOREY.MAX);
  const pool = inBand.length ? inBand : ROW_LADDER;
  return pool.reduce((best, r) => (Math.abs(Math.log(r / want)) < Math.abs(Math.log(best / want)) ? r : best), pool[0]);
}
/**
 * 這一棟的立面款(只管窗長什麼樣;層高由 facadeRows 管)。
 * 款**綁在級距帶上**(每帶 `LOOKS_PER_BAND` 款,由收錄期抽好的 `v` 在帶內二選一):
 * 讓款自由跨帶的話,桶 =(8 款 × 級數)全populated,實測 145 個 facade 桶 = 幾十 MB 貼圖。
 * 綁帶之後桶數上界 = 級數 × LOOKS_PER_BAND,而「同一條街的鄰棟不同立面」仍成立。
 */
function facadeStyle(b) {
  const looks = FACADES[b.commercial ? 'commercial' : 'residential'].length;
  const band = ROW_LADDER.indexOf(facadeRows(b.h, b.commercial));
  return (band * LOOKS_PER_BAND + ((b.v ?? 0) % LOOKS_PER_BAND)) % looks;
}

// 瓦色盤(2026-08-05 由 6 色擴到 12 色)+ 街區取色:同一街區只用相鄰兩個色階
// (跨街區才換族)、逐棟再抖一點明度 —— 一條街的屋頂「同族不同色」而不是隨機彩紙屑。
const RPAL = [0xa2543e, 0x7d8a70, 0x54636e, 0x8a6f5a, 0x9c8e7c, 0x6e5a48,
              0x4f6a78, 0x7a4a3a, 0x8f8a5e, 0x5e6e52, 0x6b7a8c, 0xa08060];
function roofTint(tint, x, z, i) {
  const bt = blockTone(x, z);
  const jl = ((i * 1597334677) >>> 0) % 100 / 100;
  tint.setHex(RPAL[(Math.floor(bt.u * RPAL.length) + (i % 2)) % RPAL.length]);
  return tint.offsetHSL(0, 0, (jl - 0.5) * 0.08);
}

// 地標近似碰撞柱(未縮放;放置時 × lm scale)
const LANDMARK_COL = {
  hospital: { r: 11, h: 22 }, school: { r: 13, h: 11 }, station: { r: 14, h: 13 },
  temple: { r: 8, h: 13 }, church: { r: 9, h: 19 }, mosque: { r: 10, h: 14 },
  museum: { r: 12, h: 12 }, power: { r: 2.6, h: 42 }, factory: { r: 13, h: 12 },
  castle: { r: 14, h: 24 }, lighthouse: { r: 6, h: 30 }, pagoda: { r: 8, h: 26 },
  stadium: { r: 18, h: 13 },
  shrine: { r: 9, h: 14 }, mandir: { r: 10, h: 22 }, stupa: { r: 9, h: 18 },
  synagogue: { r: 11, h: 17 }, gurdwara: { r: 12, h: 18 }, stave_church: { r: 8, h: 20 },
  pyramid: { r: 16, h: 20 },
  slate_house: { r: 8, h: 8 }, tongkonan: { r: 10, h: 18 }, egyptian_pylon: { r: 14, h: 20 },
  sahel_mosque: { r: 11, h: 18 }, nuer_tukul: { r: 7, h: 10 }, inuit_igloo: { r: 7, h: 7 },
};

const LANDMARKS = {
  hospital: (g) => {
    const f = facadeTex('hosp', 6, 6, '#46525c', 0.3);
    const main = box(16, 18, 12, 0xe8e4dc); main.material.map = f.map; g.add(main);
    g.add(box(10, 10, 10, 0xdcd8cc, 12, 0, 2));                 // 側翼
    g.add(box(6, 3, 3, 0xcfc8b8, 0, 0, 7));                     // 急診入口雨庇
    g.add(box(1.6, 5, 0.6, 0xd93a2b, 0, 18.2, 6.0));            // 紅十字(直)
    g.add(box(5, 1.6, 0.6, 0xd93a2b, 0, 19.9, 6.0));            //        (橫)
    const pad = new THREE.Mesh(cyl(4.5, 4.5, 0.5, 12), bmat(0x5a6068));
    pad.position.set(0, 18.4, -1); g.add(pad);                  // 屋頂直升機坪
    const hMark = new THREE.Mesh(cyl(2.6, 2.6, 0.2, 12), bmat(0xe8e4dc));
    hMark.position.set(0, 18.7, -1); g.add(hMark);
  },
  school: (g, rnd, iso) => {
    const f = facadeTex('school', 8, 3, '#4a5058', 0.2);
    const main = box(22, 9, 8, 0xd9c9a8); main.material.map = f.map; g.add(main);
    const wing = box(8, 9, 8, 0xd9c9a8, 10, 0, 8); wing.material.map = f.map; g.add(wing);
    g.add(box(23, 1, 9, 0xb89a78, 0, 9, 0));                    // 屋簷
    const clock = new THREE.Mesh(cyl(1.1, 1.1, 0.4, 12), bmat(0xf4f0e6));
    clock.rotation.x = Math.PI / 2; clock.position.set(0, 7, 4.2); g.add(clock);
    const pole = new THREE.Mesh(cyl(0.12, 0.12, 12, 6), bmat(0x9aa2a8));
    pole.position.set(-8, 6, 8); g.add(pole);
    // 校旗 = 國旗(2026-08-13):`iso` 由呼叫端依落點的戰場半邊挑好(makeNationPicker);
    // 拿不到(型錄查無此國 / 對照台不帶國籍)⇒ 退回原本那面紅旗,畫面逐位元同舊制。
    g.add(flag(1.4, 0.9, 0.06, iso ?? 0xd93a2b, -7.2, 11, 8));  // 旗(軟性:細線 + 飄揚)
    for (const s of [-1, 1]) g.add(box(1, 2.6, 1, 0xb0a898, s * 4, 0, 9));   // 校門柱
  },
  station: (g) => {
    const f = facadeTex('station', 9, 2, '#3c4854', 0.45);
    const main = box(26, 7, 12, 0xb8bfc4); main.material.map = f.map; g.add(main);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 26, 10, 1, false, 0, Math.PI), bmat(0x6f8a99));
    roof.rotation.z = Math.PI / 2; roof.position.y = 7; g.add(roof);
    const clock = new THREE.Mesh(cyl(1.3, 1.3, 0.4, 12), bmat(0xf4f0e6));
    clock.rotation.x = Math.PI / 2; clock.position.set(0, 9.5, 6.1); g.add(clock);
    g.add(box(20, 0.4, 6, 0x8a9298, 0, 4.6, 10));               // 月台雨棚
    for (const sx of [-8, 0, 8]) g.add(box(0.4, 4.6, 0.4, 0x6a7278, sx, 0, 12));
    g.add(box(5, 3.4, 0.5, 0x2e3840, 0, 0, 6.1));               // 大門
  },
  temple: (g) => {
    g.add(box(13, 1.2, 11, 0xb0a494));                          // 石台基
    g.add(box(12, 6, 10, 0xc9563a, 0, 1.2, 0));
    for (const [sx, sz] of [[-5, 4.4], [5, 4.4], [-5, -4.4], [5, -4.4]]) {
      const col = new THREE.Mesh(cyl(0.4, 0.4, 6, 8), bmat(0x8a3324));
      col.position.set(sx, 4.2, sz); g.add(col);                // 廊柱
    }
    const r1 = new THREE.Mesh(cone(9.5, 3.4, 4), bmat(0x2e5a46)); r1.position.y = 8.9; r1.rotation.y = Math.PI / 4; g.add(r1);
    const r2 = new THREE.Mesh(cone(6.5, 2.8, 4), bmat(0x2e5a46)); r2.position.y = 12.2; r2.rotation.y = Math.PI / 4; g.add(r2);
    g.add(box(1.4, 0.8, 0.8, 0xc7a13d, 0, 13.6, 0));            // 脊飾
    for (const s of [-1, 1]) {                                  // 燈籠(夜裡也亮)
      const lan = new THREE.Mesh(cyl(0.5, 0.6, 1.0, 8),
        bmat(0xe8a03c, { emissive: new THREE.Color(0x8a4a10), emissiveIntensity: 0.8 }));
      lan.position.set(s * 4, 3.4, 5.6); g.add(lan);
    }
  },
  church: (g) => {
    const f = facadeTex('church', 3, 3, '#4e5a66', 0.15);
    const nave = box(10, 9, 16, 0xd8d2c4); nave.material.map = f.map; g.add(nave);
    for (const s of [-1, 1]) for (const z of [-3, 3]) g.add(box(1.2, 6, 1.6, 0xc8c2b4, s * 5.2, 0, z));   // 扶壁
    const gable = new THREE.Mesh(cone(7.2, 4, 4), bmat(0x8a6a4a));
    gable.rotation.y = Math.PI / 4; gable.scale.x = 0.72; gable.position.set(0, 11, 0); g.add(gable);     // 斜屋頂
    g.add(box(4.5, 17, 4.5, 0xd8d2c4, 0, 0, -8));               // 鐘塔
    const spire = new THREE.Mesh(cone(3.4, 5, 4), bmat(0x6a7a88));
    spire.rotation.y = Math.PI / 4; spire.position.set(0, 19.4, -8); g.add(spire);
    const rose = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.3, 6, 12),
      bmat(0x4a6a9a, { emissive: new THREE.Color(0x1a3a6a), emissiveIntensity: 0.5 }));
    rose.position.set(0, 6.5, 8.1); g.add(rose);                // 玫瑰窗
    g.add(box(0.5, 3, 0.5, 0xc7a13d, 0, 21.8, -8));             // 十字架
    g.add(box(1.8, 0.5, 0.5, 0xc7a13d, 0, 23.4, -8));
    g.add(box(2.6, 4, 0.4, 0x5a4a3a, 0, 0, 8.1));               // 木門
  },
  mosque: (g) => {
    const f = facadeTex('mosque', 5, 2, '#5a6a6a', 0.2);
    const main = box(14, 8, 14, 0xe6ded0); main.material.map = f.map; g.add(main);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(5.4, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), bmat(0x3f8f7a));
    dome.position.y = 8; g.add(dome);
    const crest = new THREE.Mesh(cyl(0.12, 0.12, 1.8, 6), bmat(0xc7a13d));
    crest.position.y = 14; g.add(crest);                        // 新月桿
    for (const [sx, sz] of [[9.5, 9.5], [-9.5, 9.5]]) {         // 對稱雙宣禮塔
      const mn = new THREE.Mesh(cyl(0.9, 1.1, 18, 8), bmat(0xe6ded0)); mn.position.set(sx, 9, sz); g.add(mn);
      const gal = new THREE.Mesh(cyl(1.4, 1.4, 0.6, 8), bmat(0xd8cfc0)); gal.position.set(sx, 15.5, sz); g.add(gal);
      const mt = new THREE.Mesh(cone(1.3, 2.6, 8), bmat(0x3f8f7a)); mt.position.set(sx, 19.3, sz); g.add(mt);
    }
    for (const s of [-1, 1]) {                                  // 側頂小圓頂
      const sd = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), bmat(0x3f8f7a));
      sd.position.set(s * 5.2, 8, -5); g.add(sd);
    }
    g.add(box(3.4, 5, 0.5, 0x8a7a5a, 0, 0, 7.1));               // 拱門(方形近似)
  },
  museum: (g) => {
    g.add(box(22, 1.4, 16, 0xb8b0a0));                          // 台階基座
    g.add(box(20, 8, 14, 0xcfc8b8, 0, 1.4, 0));
    for (let i = -2; i <= 2; i++) {
      const col = new THREE.Mesh(cyl(0.55, 0.55, 7, 8), bmat(0xe3dccb));
      col.position.set(i * 3.6, 4.9, 7.6); g.add(col);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.4), bmat(0xe3dccb));
      cap.position.set(i * 3.6, 8.6, 7.6); g.add(cap);          // 柱頭
    }
    const ped = new THREE.Mesh(cone(11, 3, 3), bmat(0xd8d1c0));
    ped.rotation.y = Math.PI / 2; ped.scale.z = 0.45; ped.position.y = 10.8; g.add(ped);
    g.add(box(3, 5, 0.6, 0xd93a5e, 8.5, 3.2, 7.4));             // 特展直幅
    g.add(box(3, 5, 0.6, 0x3a6ad9, -8.5, 3.2, 7.4));
  },
  power: (g) => {
    const tower = new THREE.Mesh(cyl(0.9, 3.4, 42, 4), bmat(0x8e979e, { wireframe: true }));
    tower.position.y = 21; g.add(tower);
    g.add(box(16, 0.7, 0.7, 0x8e979e, 0, 34, 0));
    g.add(box(11, 0.7, 0.7, 0x8e979e, 0, 38, 0));
    for (const [sx, y] of [[-7, 33], [7, 33], [-4.8, 37], [4.8, 37]]) {   // 礙子串
      const ins = new THREE.Mesh(cyl(0.22, 0.22, 1.6, 6), bmat(0x3a4046));
      ins.position.set(sx, y, 0); g.add(ins);
    }
    const beacon = new THREE.Mesh(ico(0.5), bmat(0xd93a2b, { emissive: new THREE.Color(0x8a1408), emissiveIntensity: 1.4 }));
    beacon.position.y = 42.6; g.add(beacon);                    // 航空警示燈
  },
  factory: (g) => {
    const f = facadeTex('factory', 7, 2, '#3e464e', 0.25);
    const main = box(24, 9, 14, 0x9aa0a4); main.material.map = f.map; g.add(main);
    for (let i = -1; i <= 1; i++) {                             // 鋸齒天窗屋頂
      const saw = new THREE.Mesh(cone(4.2, 3, 4), bmat(0x7c8388));
      saw.rotation.y = Math.PI / 4; saw.scale.z = 1.6; saw.position.set(i * 8, 10.4, 0); g.add(saw);
    }
    const ch1 = new THREE.Mesh(cyl(1.1, 1.4, 16, 8), bmat(0x7c8388)); ch1.position.set(-8, 8, -4); g.add(ch1);
    g.add(box(3.4, 1.2, 3.4, 0xd93a2b, -8, 15.2, -4));          // 煙囪警示環
    const ch2 = new THREE.Mesh(cyl(0.9, 1.2, 12, 8), bmat(0x7c8388)); ch2.position.set(-4.5, 6, -4); g.add(ch2);
    const tank = new THREE.Mesh(cyl(2.6, 2.6, 6, 10), bmat(0xb8bfc4)); tank.position.set(10, 3, -9); g.add(tank);
    const pipe = new THREE.Mesh(cyl(0.3, 0.3, 8, 6), bmat(0x6a7278));
    pipe.rotation.z = Math.PI / 2; pipe.position.set(6, 5.5, -8); g.add(pipe);   // 連通管線
    g.add(box(6, 5, 0.6, 0x4a5058, 4, 0, 7.1));                 // 捲門
  },
  // ---- 2026-07-29 增補:四種世界地標建築(builder 吃 rnd → 逐座變化,同巨岩準則)----
  castle: (g, rnd, iso) => {
    // 歐洲石堡:主樓 + 四隅圓塔錐頂 + 雉堞圍牆 + 大門;塔高/主樓高/旗色逐座抽
    const kh = 14 + rnd() * 5;
    g.add(box(9, kh, 9, 0xb8b0a2));                             // 主樓
    g.add(box(10, 1.2, 10, 0xa39a8a, 0, kh, 0));                // 主樓頂緣
    for (const [sx, sz] of [[-9, -7], [9, -7], [-9, 7], [9, 7]]) {   // 四隅圓塔
      const th = 10 + rnd() * 4;
      const tw = new THREE.Mesh(cyl(1.9, 2.3, th, 8), bmat(0xb0a898));
      tw.position.set(sx, th / 2, sz); g.add(tw);
      const tr = new THREE.Mesh(cone(2.5, 3.2, 8), bmat(0x5f7d8c));
      tr.position.set(sx, th + 1.6, sz); g.add(tr);             // 灰藍錐頂
    }
    for (const [w, d, x, z] of [[18, 1.4, 0, -7], [18, 1.4, 0, 7], [1.4, 14, -9, 0], [1.4, 14, 9, 0]]) {
      g.add(box(w, 6, d, 0xaaa294, x, 0, z));                   // 圍牆
      const along = Math.max(w, d), n = Math.floor(along / 2.4);
      for (let i = 0; i < n; i++) {                             // 雉堞方齒
        const t = -along / 2 + 1.2 + i * 2.4;
        g.add(box(w > d ? 1.1 : 1.4, 1.1, w > d ? 1.4 : 1.1, 0xaaa294,
          w > d ? t : x, 6, w > d ? z : t));
      }
    }
    g.add(box(3.4, 4.5, 0.8, 0x4a3a2a, 0, 0, -7.4));            // 大門
    const pole = new THREE.Mesh(cyl(0.1, 0.1, 5, 5), bmat(0x9aa2a8));
    pole.position.set(0, kh + 3.5, 0); g.add(pole);
    // 主樓旗 = 國旗(2026-08-13)。**rnd() MUST 照抽**(§2.3 抽樣紀律:淘汰排在抽樣之後)——
    // 掛國旗就少抽一枚的話,後面每一株植被、每一棟建物的佈局整條推移,而畫面上只表現成
    // 「整張圖變了」。抽到的徽色仍是型錄查無此國時的退路。
    const heraldic = [0xd93a2b, 0x3a6ad9, 0xc7a13d, 0x2e7a4a][(rnd() * 4) | 0];
    g.add(flag(2.2, 1.2, 0.08, iso ?? heraldic, 1.2, kh + 4.4, 0));   // 主樓旗(軟性)
  },
  lighthouse: (g, rnd) => {
    // 燈塔:白塔身 + 紅環帶 + 迴廊燈室 + 看守小屋;高度/環帶數逐座抽
    const h = 19 + rnd() * 6;
    const tw = new THREE.Mesh(cyl(1.7, 2.6, h, 9), bmat(0xf0ece2));
    tw.position.y = h / 2; g.add(tw);
    const nB = 2 + (rnd() < 0.5 ? 1 : 0);
    for (let i = 0; i < nB; i++) {                              // 紅環帶(貼塔身)
      const by = h * (0.18 + (i + rnd() * 0.3) * 0.55 / nB);
      const br = 2.6 - 0.9 * (by / h);
      const band = new THREE.Mesh(cyl(br + 0.04, br + 0.12, h * 0.13, 9), bmat(0xc9463a));
      band.position.y = by; g.add(band);
    }
    const gal = new THREE.Mesh(cyl(2.3, 2.3, 0.5, 9), bmat(0x3a4046));
    gal.position.y = h + 0.25; g.add(gal);                      // 迴廊台
    const lamp = new THREE.Mesh(cyl(1.2, 1.3, 2.2, 8),
      bmat(0xffe9b0, { emissive: new THREE.Color(0x8a6a10), emissiveIntensity: 1.2 }));
    lamp.position.y = h + 1.6; g.add(lamp);                     // 燈室(常亮)
    const cap = new THREE.Mesh(cone(1.7, 1.6, 8), bmat(0xc9463a));
    cap.position.y = h + 3.5; g.add(cap);
    const hx = 3.8 + rnd();
    g.add(box(4.5, 3.2, 3.6, 0xe4ded0, hx, 0, 0));              // 看守小屋
    g.add(box(5, 0.5, 4, 0x8a8274, hx, 3.2, 0));
  },
  pagoda: (g, rnd) => {
    // 五重塔:方樓身逐層退縮 + 出簷四坡頂 + 金頂剎;層數 4~5 逐座抽
    g.add(box(11, 1.2, 11, 0xb0a494));                          // 石台基
    const tiers = 4 + (rnd() < 0.5 ? 1 : 0);
    let y = 1.2, w = 8.4;
    for (let t = 0; t < tiers; t++) {
      g.add(box(w, 3, w, 0x8a3324, 0, y, 0));                   // 丹紅樓身
      const roof = new THREE.Mesh(cone(w * 0.92, 2.1, 4), bmat(0x2e5a46));
      roof.rotation.y = Math.PI / 4;
      roof.position.y = y + 3.9; g.add(roof);                   // 出簷四坡頂(青銅綠)
      y += 4.3; w *= 0.84;
    }
    const mast = new THREE.Mesh(cyl(0.16, 0.16, 3.6, 6), bmat(0xc7a13d));
    mast.position.y = y + 1.4; g.add(mast);                     // 金頂剎
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(cyl(0.55 - i * 0.12, 0.55 - i * 0.12, 0.18, 8), bmat(0xc7a13d));
      ring.position.y = y + 1 + i * 0.8; g.add(ring);           // 相輪
    }
  },
  stadium: (g, rnd) => {
    // 體育場:橢圓碗狀看台 + 頂圈遮棚 + 草坪 + 四座照明塔;殼色/橢圓比逐座抽
    const sz = 0.72 + rnd() * 0.1;
    const outer = new THREE.Mesh(cyl(15.5, 17, 7, 14), bmat([0xd8d3c8, 0xc4ccd8, 0xd6c8b8][(rnd() * 3) | 0]));
    outer.scale.z = sz; outer.position.y = 3.5; g.add(outer);   // 碗殼
    const rim = new THREE.Mesh(cyl(16.2, 15.8, 1.2, 14), bmat(0x6a7278));
    rim.scale.z = sz; rim.position.y = 7.4; g.add(rim);         // 頂圈遮棚
    const field = new THREE.Mesh(cyl(12.5, 12.5, 0.9, 14), bmat(0x4f8a44));
    field.scale.z = sz; field.position.y = 8.4; g.add(field);   // 草坪(座落遮棚圈上緣,低多邊形近似)
    for (const [sx, szn] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {   // 四座照明塔
      const lp = new THREE.Mesh(cyl(0.25, 0.35, 12, 6), bmat(0x8d949a));
      lp.position.set(sx * 15, 6, szn * 12 * sz); g.add(lp);
      const lh = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 0.5),
        bmat(0xfff2c8, { emissive: new THREE.Color(0x8a7a30), emissiveIntensity: 1.0 }));
      lh.position.set(sx * 15, 12.6, szn * 12 * sz);
      lh.lookAt(0, 7, 0);                                       // 面向場心
      g.add(lh);
    }
  },
  // ---- 多元宗教與世界文化建築 (Religions & World Cultures) ----
  shrine: (g, rnd) => {
    // 日本神道教神社:石造參道 + 朱紅笠木鳥居 + 懸山頂拜殿 + 注連繩 + 左右石燈籠
    g.add(box(16, 0.8, 20, 0xb0a898));                          // 石板參道台基
    // 1. 前方朱紅鳥居 (Torii Gate at z = 7)
    for (const sx of [-3.2, 3.2]) {
      const p = new THREE.Mesh(cyl(0.35, 0.38, 6.2, 8), bmat(0xd93a2b));
      p.position.set(sx, 3.1, 7); g.add(p);
    }
    g.add(box(8.6, 0.5, 0.7, 0x1e272c, 0, 6.2, 7));             // 笠木 (Kasagi) 頂黑瓦
    g.add(box(8.2, 0.4, 0.6, 0xd93a2b, 0, 5.8, 7));             // 島木 (Shimaki)
    g.add(box(7.2, 0.35, 0.35, 0xd93a2b, 0, 4.6, 7));           // 貫 (Nuki) 橫樑
    // 2. 後方拜殿 (Haiden Hall at z = -4)
    g.add(box(11, 1.2, 9, 0x7a5035, 0, 0.8, -4));               // 木造架高台
    g.add(box(9.5, 4.6, 7.5, 0xd4c2a5, 0, 3.2, -4));            // 檜木殿身
    const roof = new THREE.Mesh(cone(7.8, 3.2, 4), bmat(0x2d6a4f)); // 銅綠四阿頂/懸山頂
    roof.rotation.y = Math.PI / 4; roof.scale.x = 0.82;
    roof.position.set(0, 7.8, -4); g.add(roof);
    // 屋脊千木與鰹木 (Chigi & Katsuogi)
    for (const sx of [-3.6, 3.6]) {
      const chigiL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.6, 0.3), bmat(0xd4c2a5));
      chigiL.rotation.z = 0.4; chigiL.position.set(sx, 9.6, -4); g.add(chigiL);
      const chigiR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.6, 0.3), bmat(0xd4c2a5));
      chigiR.rotation.z = -0.4; chigiR.position.set(sx, 9.6, -4); g.add(chigiR);
    }
    // 3. 兩側石燈籠 (Toro Lanterns)
    for (const sx of [-4.5, 4.5]) {
      const lan = new THREE.Mesh(cyl(0.3, 0.35, 2.4, 6), bmat(0x9e988a));
      lan.position.set(sx, 1.2, 2); g.add(lan);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7),
        bmat(0xffe082, { emissive: new THREE.Color(0xffa726), emissiveIntensity: 0.9 }));
      lamp.position.set(sx, 2.5, 2); g.add(lamp);
    }
  },
  mandir: (g, rnd) => {
    // 印度教神廟:砂岩基座 (Jagati)+ 多層遞進希卡拉塔 (Shikhara)+ 柱廊前廳 (Mandapa)+ 金頂剎 (Kalasha)
    g.add(box(18, 1.2, 20, 0xd89b65));                          // 紅砂岩台基
    // 1. 後方主殿與希卡拉塔 (Shikhara at z = -4)
    g.add(box(10, 6.5, 10, 0xbf7b45, 0, 1.2, -4));              // 聖所外壁 (Garbhagriha)
    let ty = 7.7, tw = 9.2;
    for (let t = 0; t < 5; t++) {                               // 5 階逐層退縮方錐塔
      g.add(box(tw, 2.4, tw, 0xd88a4e, 0, ty, -4));
      ty += 2.4; tw *= 0.82;
    }
    // 頂部水波扁圓石與金瓶 (Amalaka & Kalasha)
    const amalaka = new THREE.Mesh(cyl(2.0, 2.0, 0.8, 12), bmat(0xd88a4e));
    amalaka.position.set(0, ty + 0.4, -4); g.add(amalaka);
    const kalasha = new THREE.Mesh(cone(1.0, 2.2, 8), bmat(0xc7a13d, { celMetal: true }));
    kalasha.position.set(0, ty + 1.8, -4); g.add(kalasha);
    // 2. 前方曼陀帕柱廊門殿 (Mandapa at z = 4)
    g.add(box(12, 5.0, 8.5, 0xd89b65, 0, 1.2, 4));
    const manRoof = new THREE.Mesh(cone(7.8, 3.4, 4), bmat(0xbf7b45));
    manRoof.rotation.y = Math.PI / 4; manRoof.position.set(0, 7.8, 4); g.add(manRoof);
    for (const sx of [-5.2, 5.2]) {                             // 門廊石柱
      const col = new THREE.Mesh(cyl(0.45, 0.45, 5.0, 8), bmat(0xbf7b45));
      col.position.set(sx, 3.6, 7.5); g.add(col);
    }
  },
  stupa: (g, rnd) => {
    // 佛教舍利佛塔:三層方階 (Medhi)+ 白堊圓頂 (Anda)+ 天宮方盒 (Harmika)+ 十三層相輪金頂
    g.add(box(18, 0.8, 18, 0xd5d0c5));                          // 底層方基
    g.add(box(15, 0.8, 15, 0xd5d0c5, 0, 0.8, 0));               // 中層方基
    g.add(box(12, 0.8, 12, 0xd5d0c5, 0, 1.6, 0));               // 頂層方基
    // 圓形基鼓與半球形白圓頂 (Anda)
    const drum = new THREE.Mesh(cyl(5.6, 5.8, 1.4, 16), bmat(0xf5f3ee));
    drum.position.y = 3.1; g.add(drum);
    const anda = new THREE.Mesh(new THREE.SphereGeometry(5.2, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), bmat(0xf5f3ee));
    anda.position.y = 3.8; g.add(anda);
    // 天宮方盒 (Harmika)
    g.add(box(2.8, 1.8, 2.8, 0xd89a38, 0, 9.6, 0));
    // 十三層相輪法輪金頂 (Chattravali Spire)
    const spireMast = new THREE.Mesh(cyl(0.3, 0.3, 6.5, 8), bmat(0xc7a13d, { celMetal: true }));
    spireMast.position.y = 13.8; g.add(spireMast);
    for (let i = 0; i < 5; i++) {
      const ring = new THREE.Mesh(cyl(1.4 - i * 0.22, 1.4 - i * 0.22, 0.25, 10), bmat(0xc7a13d, { celMetal: true }));
      ring.position.y = 11.2 + i * 0.9; g.add(ring);
    }
    // 頂部日月金珠 (Bindu Finial)
    const jewel = new THREE.Mesh(ico(0.7), bmat(0xffd54f, { celMetal: true, emissive: new THREE.Color(0xffb300), emissiveIntensity: 0.8 }));
    jewel.position.y = 17.4; g.add(jewel);
  },
  synagogue: (g, rnd) => {
    // 猶太教猶太會堂:耶路撒冷石造立面 + 雙角塔拱頂 + 大衛之星彩繪花窗 + 十誡法板
    const f = facadeTex('synagogue', 4, 3, '#4a5568', 0.2);
    const main = box(18, 11, 16, 0xe2dac9); main.material.map = f.map; g.add(main);
    // 兩側拱角塔 (Corner Turrets)
    for (const sx of [-8.5, 8.5]) {
      const tur = box(4.0, 14.5, 4.0, 0xd4cbb8, sx, 0, 6.5); g.add(tur);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(2.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), bmat(0x457b6d));
      dome.position.set(sx, 14.5, 6.5); g.add(dome);
    }
    // 正立面大圓花窗與大衛之星 (Star of David Rose Window)
    const roseRing = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.3, 6, 12),
      bmat(0x1976d2, { emissive: new THREE.Color(0x0d47a1), emissiveIntensity: 0.7 }));
    roseRing.position.set(0, 7.8, 8.1); g.add(roseRing);
    // 正面中央石階與木門
    g.add(box(5.0, 4.2, 0.6, 0x4a3222, 0, 0, 8.2));
    // 屋頂山牆上的十誡石板 (Decalogue Tablets)
    const tabL = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.4, 8), bmat(0xf0ebe1));
    tabL.position.set(-0.6, 12.0, 7.8); g.add(tabL);
    const tabR = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.4, 8), bmat(0xf0ebe1));
    tabR.position.set(0.6, 12.0, 7.8); g.add(tabR);
  },
  gurdwara: (g, rnd) => {
    // 錫克教謁師所:純白大理石殿堂 + 中央鍍金蓮花大圓頂 + 四角穹頂涼亭 (Chhatris)+ 日產旗桿
    const main = box(22, 9, 18, 0xf4f6f8); g.add(main);
    // 中央鍍金大圓頂 (Golden Lotus Dome at y = 9)
    const lotusBase = new THREE.Mesh(cyl(5.2, 5.0, 0.8, 14), bmat(0xe2e8f0));
    lotusBase.position.y = 9.4; g.add(lotusBase);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(4.6, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.65),
      bmat(0xffc107, { celMetal: true }));
    dome.position.y = 9.8; g.add(dome);
    const finial = new THREE.Mesh(cyl(0.12, 0.12, 2.2, 6), bmat(0xffb300));
    finial.position.y = 15.6; g.add(finial);
    // 四角涼亭 (Chhatris at 4 corners)
    for (const [sx, sz] of [[-9.5, -7.5], [9.5, -7.5], [-9.5, 7.5], [9.5, 7.5]]) {
      for (const [cx, cz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
        const col = new THREE.Mesh(cyl(0.12, 0.12, 2.6, 6), bmat(0xf4f6f8));
        col.position.set(sx + cx, 10.3, sz + cz); g.add(col);
      }
      const chDome = new THREE.Mesh(new THREE.SphereGeometry(1.3, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        bmat(0xffc107, { celMetal: true }));
      chDome.position.set(sx, 11.6, sz); g.add(chDome);
    }
    // 側邊錫克三角形旗 (Nishan Sahib Flag)
    const pole = new THREE.Mesh(cyl(0.1, 0.1, 15, 6), bmat(0x94a3b8));
    pole.position.set(-10, 7.5, 9.5); g.add(pole);
    g.add(box(1.8, 1.0, 0.05, 0xff6f00, -9.0, 13.8, 9.5));
  },
  stave_church: (g, rnd) => {
    // 北歐木板教堂:黑焦油木瓦 + 多層極陡坡屋面 + 龍頭簷角山牆 + 中央尖鐘塔
    g.add(box(14, 0.8, 18, 0x2c221e));                          // 木枕基台
    // 1. 下層本堂 (Nave)
    g.add(box(10, 5.5, 14, 0x3d2e26, 0, 0.8, 0));
    const r1 = new THREE.Mesh(cone(7.8, 4.5, 4), bmat(0x2b221d)); // 陡峭四坡木瓦
    r1.rotation.y = Math.PI / 4; r1.scale.x = 0.75;
    r1.position.set(0, 7.5, 0); g.add(r1);
    // 2. 中層重簷天窗層 (Clerestory)
    g.add(box(6, 4.2, 8, 0x3d2e26, 0, 7.5, -0.5));
    const r2 = new THREE.Mesh(cone(5.5, 3.8, 4), bmat(0x2b221d));
    r2.rotation.y = Math.PI / 4; r2.scale.x = 0.8;
    r2.position.set(0, 12.0, -0.5); g.add(r2);
    // 3. 頂部尖塔鐘樓 (Bell Spire)
    const spire = new THREE.Mesh(cone(2.2, 6.0, 6), bmat(0x231a16));
    spire.position.set(0, 16.5, -0.5); g.add(spire);
    // 木雕十字頂 (Wooden Cross)
    g.add(box(0.2, 1.8, 0.2, 0x6e5241, 0, 20.0, -0.5));
    g.add(box(1.1, 0.2, 0.2, 0x6e5241, 0, 20.4, -0.5));
    // 四角飛龍山牆飾 (Dragon Head Prows)
    for (const [sx, sz] of [[-3.8, -4.5], [3.8, -4.5], [-3.8, 3.5], [3.8, 3.5]]) {
      const dragon = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 1.2), bmat(0x5a4233));
      dragon.rotation.x = 0.35; dragon.position.set(sx, 11.2, sz); g.add(dragon);
    }
  },
  pyramid: (g, rnd) => {
    // 美洲階梯金字塔:多層遞進巨石方錐 (Talud-Tablero)+ 正面中央通天石階 + 頂層神殿
    const stepColors = [0x9e988a, 0x8f897c, 0x827c70, 0x767166];
    let py = 0, pw = 26;
    for (let s = 0; s < 4; s++) {                               // 4 層方錐台階
      g.add(box(pw, 3.5, pw, stepColors[s], 0, py, 0));
      py += 3.5; pw -= 5.0;
    }
    // 頂層神殿 (Summit Sanctuary)
    g.add(box(8.5, 4.2, 8.5, 0xaba495, 0, py, 0));
    g.add(box(9.2, 0.8, 9.2, 0x6d675c, 0, py + 4.2, 0));       // 神殿簷口
    g.add(box(3.2, 3.0, 0.6, 0x2e2924, 0, py, 4.3));           // 門洞
    // 正面中央通天巨石大台階 (Central Grand Staircase at +z)
    const stairGeo = new THREE.BoxGeometry(5.2, 14.5, 14.5);
    stairGeo.rotateX(-0.55);                                    // 依台階坡度傾斜
    stairGeo.translate(0, 7.2, 7.5);
    const stair = new THREE.Mesh(stairGeo, bmat(0x908a7e));
    g.add(stair);
    // 台階基部兩側羽蛇神首石雕 (Serpent Heads)
    for (const sx of [-3.0, 3.0]) {
      const serpent = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 1.6), bmat(0x5a554a));
      serpent.position.set(sx, 0.7, 13.5); g.add(serpent);
    }
  },
  // ---- 台灣原住民、南島語族、古埃及、薩赫爾、奴愛、因紐特原住民與古文明建築 ----
  slate_house: (g, rnd) => {
    // 台灣原住民族石板屋:層疊黑灰板岩牆體 + 大斜面頁岩石板屋瓦 + 門前百步蛇祖靈立柱 + 石砌曬場前庭
    g.add(box(16, 0.5, 14, 0x3a3f44));                          // 前庭石板曬場基座
    // 1. 板岩矮牆屋身 (Slate Slab Walls)
    g.add(box(12, 2.8, 9, 0x2e3338, 0, 0.5, -1.5));
    // 2. 層疊大斜面板岩石板屋頂 (Layered Slate Roof)
    const roofGeo = new THREE.BoxGeometry(14.5, 0.45, 11.5);
    roofGeo.rotateX(0.22);                                      // 前低後高的排水大坡面
    roofGeo.translate(0, 3.8, -1.5);
    const roof = new THREE.Mesh(roofGeo, bmat(0x23272b));
    g.add(roof);
    // 屋脊壓頂石排 (Ridge Cap Stones)
    for (let i = -5; i <= 5; i++) {
      g.add(box(0.9, 0.35, 1.2, 0x1a1d20, i * 1.2, 5.0, -6.5));
    }
    // 3. 門前百步蛇與祖靈石柱 (Ancestral Totem Pillar at entrance)
    const totem = new THREE.Mesh(cyl(0.35, 0.4, 3.6, 6), bmat(0x525960));
    totem.position.set(2.4, 1.8, 3.2); g.add(totem);
    // 祖靈石雕眼/百步蛇菱形飾 (emissive rune)
    for (let y = 1.2; y <= 3.0; y += 0.8) {
      const ring = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.25, 0.85),
        bmat(0xffb74d, { emissive: new THREE.Color(0xd97706), emissiveIntensity: 0.6 }));
      ring.position.set(2.4, y, 3.2); g.add(ring);
    }
    // 4. 石板矮門與側邊石椅 (Slate Seat)
    g.add(box(1.8, 2.0, 0.4, 0x1c1f22, 0, 0.5, 3.1));          // 入口低矮木石門
    g.add(box(3.2, 0.6, 1.2, 0x2a2e32, -4.5, 0.5, 3.2));       // 前廊聚會石椅
  },
  tongkonan: (g, rnd) => {
    // 南島語族托拉賈船形屋:高架木樁 (Stilts)+ 懸空起居室 + 兩端極致上翹之巨型鞍形船首茅草弧頂 + 水牛角柱
    // 1. 高架基柱 (Stilts)
    for (const [sx, sz] of [[-3.5, -4.5], [3.5, -4.5], [-3.5, 0], [3.5, 0], [-3.5, 4.5], [3.5, 4.5]]) {
      const stilt = new THREE.Mesh(cyl(0.32, 0.35, 4.5, 8), bmat(0x5c3d2e));
      stilt.position.set(sx, 2.25, sz); g.add(stilt);
    }
    // 2. 懸空起居木艙 (Raised Living Chamber)
    g.add(box(8.5, 4.0, 12.0, 0x8a5438, 0, 4.5, 0));
    // 紅黑幾何彩繪山牆面板飾條 (Toraja Painted Facade Bands)
    g.add(box(8.6, 0.6, 0.2, 0xb91c1c, 0, 5.2, 6.1));          // 硃砂紅飾帶
    g.add(box(8.6, 0.6, 0.2, 0xfacc15, 0, 6.4, 6.1));          // 薑黃金飾帶
    // 3. 巨型船型鞍狀上翹大屋頂 (Upswept Saddle Boat Roof)
    const roofBase = new THREE.Mesh(cyl(4.8, 4.8, 22.0, 10, 1, false, 0, Math.PI), bmat(0x856638));
    roofBase.rotation.x = Math.PI / 2;
    roofBase.scale.set(1.0, 1.6, 1.0);
    roofBase.position.set(0, 9.5, 0); g.add(roofBase);
    // 前後翹起的巨大尖舟船首簷角 (Upswept Prows)
    for (const [sz, dir] of [[11.0, 1], [-11.0, -1]]) {
      const prow = new THREE.Mesh(cone(2.6, 7.5, 4), bmat(0x6e522b));
      prow.rotation.x = dir * 0.75; prow.position.set(0, 13.2, sz); g.add(prow);
    }
    // 4. 正面水牛角立柱 (Buffalo Horn Column)
    const hornPole = new THREE.Mesh(cyl(0.15, 0.15, 8.5, 6), bmat(0x4a3224));
    hornPole.position.set(0, 5.0, 6.5); g.add(hornPole);
    for (let y = 3.0; y <= 8.0; y += 1.0) {
      const horn = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.1, 4, 8, Math.PI), bmat(0xd1d5db));
      horn.rotation.z = Math.PI; horn.position.set(0, y, 6.6); g.add(horn);
    }
  },
  egyptian_pylon: (g, rnd) => {
    // 古埃及塔門神殿:厚重梯形雙塔門 (Pylon)+ 凹線簷口 + 羽翼太陽盤 + 後方紙莎草柱廳 (Hypostyle Hall)
    g.add(box(24, 1.0, 22, 0xdfb17b));                          // 砂岩大台基
    // 1. 梯形雙塔門 (Twin Pylon Towers at +z)
    for (const sx of [-7.8, 7.8]) {
      const pylon = new THREE.Mesh(cyl(3.8, 4.8, 14.0, 4), bmat(0xcda06c));
      pylon.rotation.y = Math.PI / 4; pylon.position.set(sx, 7.5, 7.5); g.add(pylon);
      // 塔頂凹線簷口 (Cavetto Cornice)
      const cap = new THREE.Mesh(new THREE.BoxGeometry(8.8, 0.9, 7.2), bmat(0xb88d59));
      cap.position.set(sx, 14.8, 7.5); g.add(cap);
    }
    // 門楣羽翼太陽盤 (Winged Sun Disc Lintel)
    const sunDisc = new THREE.Mesh(ico(0.9),
      bmat(0xffc107, { celMetal: true, emissive: new THREE.Color(0xd97706), emissiveIntensity: 0.8 }));
    sunDisc.position.set(0, 10.5, 7.5); g.add(sunDisc);
    g.add(box(4.5, 0.4, 0.8, 0xc7a13d, 0, 10.5, 7.5));         // 金翼橫展
    // 2. 後方紙莎草巨柱大廳 (Hypostyle Hall at -z)
    for (const [sx, sz] of [[-6, -4], [6, -4], [-6, -1], [6, -1], [-6, 2], [6, 2]]) {
      // 柱身
      const col = new THREE.Mesh(cyl(0.7, 0.65, 10.5, 10), bmat(0xd9a873));
      col.position.set(sx, 5.75, sz); g.add(col);
      // 開敞紙莎草鐘形柱頭 (Papyrus Bell Capital)
      const cap = new THREE.Mesh(cyl(1.3, 0.7, 1.4, 10), bmat(0xc89762));
      cap.position.set(sx, 11.2, sz); g.add(cap);
    }
    // 柱頂橫樑 (Architrave)
    g.add(box(16, 0.8, 2.0, 0xba8a55, 0, 12.3, -1));
  },
  sahel_mosque: (g, rnd) => {
    // 薩赫爾泥造清真寺 (傑內大清真寺風格):日曬土泥磚曲面主體 + 突出的棕櫚木樁骨架 (Toron)+ 錐形泥塔與鴕鳥蛋陶頂
    const main = box(18, 8.5, 16, 0xb87d4b); g.add(main);       // 泥磚大殿
    // 1. 三座正面錐形宣禮泥塔 (Conical Adobe Minarets)
    for (const sx of [-6.5, 0, 6.5]) {
      const minaret = new THREE.Mesh(cyl(1.2, 2.4, 16.0, 8), bmat(0xb87d4b));
      minaret.position.set(sx, 8.0, 8.2); g.add(minaret);
      // 塔頂鴕鳥蛋陶頂 (Ostrich Egg Finial)
      const egg = new THREE.Mesh(ico(0.75), bmat(0xf5ede0));
      egg.position.set(sx, 16.6, 8.2); g.add(egg);
    }
    // 2. 外露橫突棕櫚木樁 (Toron Timber Sticks projecting from walls)
    for (let y = 3.5; y <= 13.5; y += 2.0) {
      for (const sx of [-6.5, 0, 6.5]) {
        for (const dx of [-1.0, 1.0]) {
          const stick = new THREE.Mesh(cyl(0.08, 0.08, 1.4, 5), bmat(0x3e2723));
          stick.rotation.x = Math.PI / 2; stick.position.set(sx + dx, y, 9.2); g.add(stick);
        }
      }
    }
    // 側牆排柱與洩水陶管 (Gargoyles)
    for (const s of [-1, 1]) {
      for (const z of [-4, 0, 4]) {
        const buttress = new THREE.Mesh(cyl(0.6, 1.2, 9.0, 6), bmat(0xa87142));
        buttress.position.set(s * 9.4, 4.5, z); g.add(buttress);
      }
    }
  },
  nuer_tukul: (g, rnd) => {
    // 東非奴愛族泥圓屋 (Tukul):圓柱泥編牆 + 高聳尖錐金黃茅草屋頂 + 環形牛欄與聖角神木
    // 1. 泥圓屋本體 (Mud-and-wattle Tukul)
    const tukul = new THREE.Mesh(cyl(4.2, 4.4, 3.2, 14), bmat(0xa67c52));
    tukul.position.set(0, 1.6, -2); g.add(tukul);
    // 2. 高挑尖錐茅草頂 (Steep Conical Thatch Roof)
    const thatch = new THREE.Mesh(cone(5.4, 6.5, 14), bmat(0xd4af37));
    thatch.position.set(0, 6.4, -2); g.add(thatch);
    // 頂部編織草冠 (Apex Woven Crown)
    const crown = new THREE.Mesh(ico(0.6), bmat(0x8a6d25));
    crown.position.set(0, 9.8, -2); g.add(crown);
    // 3. 前方木樁牛欄 (Cattle Kraal Fence at +z)
    for (let a = 0; a < Math.PI * 2; a += 0.45) {
      if (a > 2.7 && a < 3.6) continue; // 留出入口
      const px = Math.cos(a) * 7.5, pz = Math.sin(a) * 7.5 + 4.5;
      const post = new THREE.Mesh(cyl(0.1, 0.12, 2.2, 5), bmat(0x5d4037));
      post.position.set(px, 1.1, pz); g.add(post);
    }
    // 4. 聖角立木神柱 (Sacred Cattle Horn Post)
    const hornPost = new THREE.Mesh(cyl(0.18, 0.2, 4.2, 6), bmat(0x3e2723));
    hornPost.position.set(0, 2.1, 4.5); g.add(hornPost);
    const horns = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.15, 6, 10, Math.PI), bmat(0xf5f5f5));
    horns.rotation.z = Math.PI; horns.position.set(0, 4.4, 4.5); g.add(horns);
  },
  inuit_igloo: (g, rnd) => {
    // 北極因紐特雪磚冰屋 (Igloo)+ 防風隧道玄關 + 守護石偶 (Inuksuk)
    // 1. 半球形螺旋雪磚冰屋主穹頂 (Snow Block Dome)
    const iglooGeo = new THREE.SphereGeometry(4.8, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const iglooMat = bmat(0xe8f1f5, { emissive: new THREE.Color(0xb0bec5), emissiveIntensity: 0.2 });
    const igloo = new THREE.Mesh(iglooGeo, iglooMat);
    igloo.position.set(0, 0, -1); g.add(igloo);
    // 2. 半圓拱雪磚隧道玄關 (Tunnel Vestibule at +z)
    const tunGeo = new THREE.CylinderGeometry(1.6, 1.6, 4.2, 10, 1, false, 0, Math.PI);
    tunGeo.rotateX(Math.PI / 2); tunGeo.translate(0, 1.6, 3.2);
    const tunnel = new THREE.Mesh(tunGeo, iglooMat);
    g.add(tunnel);
    // 3. 守護指路石堆偶 (Inuksuk / Inunnguaq Stone Cairn beside igloo)
    const cairnMat = envMat(0x60666d, { bands: 'hard' });
    const cairnGroup = new THREE.Group();
    cairnGroup.position.set(6.5, 0, 1.5);
    // 雙腿石
    for (const lx of [-0.4, 0.4]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.6), cairnMat);
      leg.position.set(lx, 0.6, 0); cairnGroup.add(leg);
    }
    // 軀幹石
    const torso = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.8), cairnMat);
    torso.position.set(0, 1.65, 0); cairnGroup.add(torso);
    // 橫展雙臂石
    const arms = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.4, 0.6), cairnMat);
    arms.position.set(0, 2.3, 0); cairnGroup.add(arms);
    // 頭部石
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.65, 0.65), cairnMat);
    head.position.set(0, 2.85, 0); cairnGroup.add(head);
    g.add(cairnGroup);
  },
};

// ---- 巨岩地標(裸露地;取材世界知名岩體/巨石遺跡)----
// 烏魯魯(艾爾斯岩)/ 奧古斯都山(單體岩山)/
// 大霸尖山(酒桶狀霸尖)/ 摩艾石像群 / 馬丘比丘梯田遺跡 / 巨石陣 /
// 百內三塔(花崗岩尖塔群)/ 張家界石柱(石英砂岩方柱)/ 邁泰奧拉(修道院岩峰)/
// 獅子岩(斯里蘭卡 Sigiriya)。共 10 座(酋長岩/佩特拉 2026-08-05 因方盒量體移除,見表內註)。
// 公稱高即真實比例(×OVER.mega = 1;放置縮放後約 90~160m);col = 近似碰撞柱(× s),
// s = 放置縮放區間。岩面走 envMat + 頂部苔蘚投影(botw_plan 岩石要點)。
function rockMat(color, moss = 0) {
  const m = envMat(color, { wash: 0.6, cool: 0.5, moss: moss ? { amount: moss } : null });
  m.userData.rock = true;   // 岩面材質標記:placeMegaliths 逐顆調色只認這面旗(不動綠冠/木門等)
  return m;
}
/**
 * 楔台/錐台幾何 (tapered box / frustum):
 * 底面 w0×d0、頂面 w1×d1、高 h、頂面偏移 (sx, sz)。
 * 相鄰面夾角皆為鈍角/銳角，杜絕 90° 直角稜邊與立方體生硬感。
 */
function rockFrustum(w0, d0, w1, d1, h, sx = 0, sz = 0) {
  const b = [
    [-w0 / 2, -h / 2, -d0 / 2], [w0 / 2, -h / 2, -d0 / 2],
    [w0 / 2, -h / 2, d0 / 2], [-w0 / 2, -h / 2, d0 / 2],
  ];
  const t = [
    [sx - w1 / 2, h / 2, sz - d1 / 2], [sx + w1 / 2, h / 2, sz - d1 / 2],
    [sx + w1 / 2, h / 2, sz + d1 / 2], [sx - w1 / 2, h / 2, sz + d1 / 2],
  ];
  const quads = [
    [t[0], t[3], t[2], t[1]],   // 頂 +y
    [b[0], b[1], b[2], b[3]],   // 底 −y
    [b[3], b[2], t[2], t[3]],   // 前 +z
    [b[1], b[0], t[0], t[1]],   // 後 −z
    [b[2], b[1], t[1], t[2]],   // 右 +x
    [b[0], b[3], t[3], t[0]],   // 左 −x
  ];
  const arr = [];
  for (const [p0, p1, p2, p3] of quads) arr.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  geo.computeVertexNormals();
  return geo;
}

const MEGALITHS = {
  // col.r 一律涵蓋岩體實際外廓(含側肩/山腳錐):低估半徑 = 其他物件沉進崖錐
  // 2026-08-05 使用者定案「方形巨石非常不自然,請移除」:主量體是**素面大方盒**的兩座名岩
  // (elcap 酋長岩三大盒、petra 佩特拉紅砂岩崖盒)整組退場 —— 露頭群「同片同岩」會讓
  // 一整片 3~4 顆同款方盒排在一起,遠看就是幾個貨櫃。MUST NOT 以 BoxGeometry 當名岩主量體
  // 復辟(小構件:楣樑/梯板/屋舍/稜線墨線不在此限);合成 11 型全走 cyl/ico/cone,不受影響。
  uluru: { col: { r: 88, h: 62 }, s: [1.0, 1.7],   // 含東側低伏 hump(px 66 + r31)
    anchor: { topY: 60, topR: 24, side: { y: [12, 42] } },
    build: (g, rnd) => {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 12, 8), rockMat(0xb3502e));
    dome.scale.set(1.5, 1.15, 0.9); dome.position.y = 4; g.add(dome);     // 長條圓頂單體岩
    const hump = new THREE.Mesh(new THREE.SphereGeometry(26, 10, 7), rockMat(0xc25c33));
    hump.scale.set(1.2, 0.55, 0.9); hump.position.set(66, 8, 6); g.add(hump);
    const nRib = 4 + ((rnd() * 3) | 0);
    for (let i = 0; i < nRib; i++) {                                      // 平行侵蝕縱溝(條數/粗細/間距不定)
      const rib = new THREE.Mesh(new THREE.BoxGeometry(1.2 + rnd() * 1.2, 30 + rnd() * 10, 1.4), rockMat(0x8f3c22));
      rib.position.set(-40 + i * 15 + rnd() * 6, 22, 38 + rnd() * 3); rib.rotation.x = 0.55; g.add(rib);
    }
  } },
  augustus: { col: { r: 80, h: 50 }, s: [0.9, 1.6],   // 主脊 sx1.7 → 實際外廓 ~78
    anchor: { topY: 46, topR: 22, side: { y: [8, 34] } },
    build: (g) => {
    const ridge = new THREE.Mesh(new THREE.SphereGeometry(46, 11, 8), rockMat(0x9a6248, 0.45));
    ridge.scale.set(1.7, 0.95, 1.05); ridge.position.y = 2; g.add(ridge); // 主山脊(帶植被苔蘚)
    const peak = new THREE.Mesh(new THREE.SphereGeometry(24, 9, 7), rockMat(0xa86e50, 0.4));
    peak.scale.set(1.1, 0.9, 0.9); peak.position.set(-30, 26, 0); g.add(peak);
    const toe = new THREE.Mesh(new THREE.SphereGeometry(20, 9, 6), rockMat(0x8f5a42, 0.5));
    toe.scale.set(1.3, 0.6, 1.0); toe.position.set(52, 4, 8); g.add(toe);
  } },
  dabajian: { col: { r: 40, h: 96 }, s: [0.8, 1.5],   // 含 44m 山體基座錐
    anchor: { topY: 97, topR: 12, side: { y: [34, 86] } },
    // 逐層岩層半徑/稜線/軸心各異(2026-07-29):酒桶紋不再同心規整;
    // 層高不動(anchor.topY = 97 由層高總和推得,抖高度會讓頂面特徵懸空)
    build: (g, rnd) => {
    // 山體基座拉高:霸尖圓柱(r≈20)起於 y=30,錐體該處半徑 44×(1−30/58)=21 ≥ 柱半徑
    // —— 柱身與山體相接,不是擱在山尖上懸挑
    const base = new THREE.Mesh(cone(44, 58, 9), rockMat(0x7d7466, 0.45));
    base.position.y = 29; g.add(base);                                    // 山體基座
    let y = 30;
    for (const [r, hh, cc] of [[20, 14, 0x6f6a62], [21, 4, 0x8a8274], [18.5, 13, 0x6f6a62],
                               [19.5, 4, 0x8a8274], [17, 12, 0x67625a], [18, 4, 0x8a8274],
                               [15.5, 11, 0x6f6a62]]) {
      const jr = r * (0.94 + rnd() * 0.09);
      const stratum = new THREE.Mesh(cyl(jr, jr + 1.2 + rnd() * 0.8, hh, 10), rockMat(cc, cc === 0x8a8274 ? 0.15 : 0));
      stratum.position.set((rnd() - 0.5) * 1.4, y + hh / 2, (rnd() - 0.5) * 1.4);
      stratum.rotation.y = rnd() * Math.PI;                               // 十邊柱稜線逐層錯開
      y += hh; g.add(stratum);                                            // 水平岩層(酒桶紋)
    }
    const cap = new THREE.Mesh(cyl(13 + rnd() * 1.2, 15.5 + rnd() * 1.2, 5, 10), rockMat(0x7d7466, 0.5));
    cap.position.set((rnd() - 0.5) * 1.2, y + 2.5, (rnd() - 0.5) * 1.2);  // 平坦霸頂
    cap.rotation.y = rnd() * Math.PI;
    g.add(cap);
  } },
  moai: { col: { r: 16, h: 34 }, s: [1.0, 1.9],
    anchor: { topY: 3.4, topR: 13, side: null },
    build: (g, rnd) => {
    g.add(box(34, 3.4, 10, 0x7f7868));                                    // 阿胡祭壇石台
    // 逐尊各異(2026-07-29):身高/胖瘦/頭型逐尊抽,鼻/眉/髮髻位置由身高頭高推導
    // (尺寸變了接合不開縫);微傾 + 錯位 = 手鑿石像群,不是複製貼上
    for (let i = 0; i < 4; i++) {
      const s = 0.82 + rnd() * 0.28;
      const m = new THREE.Group();
      const bh = 12.5 + rnd() * 2.5;                                      // 身高
      const body = new THREE.Mesh(cyl(2.9 + rnd() * 0.7, 3.9 + rnd() * 0.7, bh, 7), rockMat(0x8f8878));
      body.position.y = bh / 2; m.add(body);
      const hh = 7.8 + rnd() * 1.8, hw = 4.8 + rnd() * 0.9, hd = 4.3 + rnd() * 0.7;
      const head = new THREE.Mesh(new THREE.BoxGeometry(hw, hh, hd), rockMat(0x968e7c));
      head.position.y = bh + hh / 2; m.add(head);
      const nose = new THREE.Mesh(new THREE.BoxGeometry(1.2 + rnd() * 0.5, hh * 0.5, 1.2), rockMat(0x8a8270));
      nose.position.set(0, bh + hh * 0.42, hd / 2 + 0.35); m.add(nose);   // 長鼻(依頭深貼面)
      const brow = new THREE.Mesh(new THREE.BoxGeometry(hw * 0.9, 1.1 + rnd() * 0.4, 1.4), rockMat(0x7f7868));
      brow.position.set(0, bh + hh * 0.78, hd / 2 - 0.1); m.add(brow);    // 眉脊
      if (rnd() < 0.5) {
        const pukao = new THREE.Mesh(cyl(2.3 + rnd() * 0.6, 2.8 + rnd() * 0.5, 2 + rnd() * 0.9, 8), rockMat(0x9a4a3a));
        pukao.position.y = bh + hh + 1.0; m.add(pukao);                   // 紅色普卡奧髮髻
      }
      m.scale.setScalar(s);
      m.position.set(-12 + i * 8 + (rnd() - 0.5) * 1.6, 3.4, (rnd() - 0.5) * 1.6);
      m.rotation.y = (rnd() - 0.5) * 0.35;                                // 各自望向略異方向
      m.rotation.z = (rnd() - 0.5) * 0.05;                                // 千年沉降微傾
      g.add(m);
    }
  } },
  machupicchu: { col: { r: 42, h: 44 }, s: [1.0, 1.7],   // 底層梯田 64×52 半對角
    anchor: { topY: 35, topR: 11, side: { y: [5, 30] } },
    // 手築的不整齊(2026-07-29):每層梯田各自收放/錯位/微轉(底層定腳印不偏),
    // 石屋逐間抽尺寸 —— 偏移收在層間退縮量內,上層不懸挑
    build: (g, rnd) => {
    let y = 0, first = true;
    for (const [w, d] of [[64, 52], [54, 44], [44, 36], [34, 28], [25, 20]]) {
      const jw = w * (0.96 + rnd() * 0.06), jd = d * (0.96 + rnd() * 0.06);
      const ox = first ? 0 : (rnd() - 0.5) * 2, oz = first ? 0 : (rnd() - 0.5) * 2;
      const tier = new THREE.Mesh(new THREE.BoxGeometry(jw, 7, jd), rockMat(0x8d8672, 0.5 + rnd() * 0.15));
      tier.position.set(ox, y + 3.5, oz);                                 // 梯田層(頂面苔蘚投影=草坪)
      tier.rotation.y = (rnd() - 0.5) * 0.06;
      g.add(tier);
      y += 7; first = false;
    }
    for (let i = 0; i < 3; i++) {                                         // 山頂石屋(疊石牆 + 茅草頂,間間不同)
      const hx = -7 + i * 7 + (rnd() - 0.5) * 1.6, hz = (i - 1) * 5 + (rnd() - 0.5) * 1.6;
      const hw = 5.2 + rnd() * 1.4, hht = 4 + rnd() * 1, hdp = 4.4 + rnd() * 1;
      const hry = (rnd() - 0.5) * 0.3;
      const hut = new THREE.Mesh(new THREE.BoxGeometry(hw, hht, hdp), rockMat(0x9c9480));
      hut.position.set(hx, y + hht / 2, hz); hut.rotation.y = hry; g.add(hut);
      const thatch = new THREE.Mesh(cone(hw * 0.72 + 0.6, 2.8 + rnd() * 0.8, 4), rockMat(0xa9945e));
      thatch.rotation.y = Math.PI / 4 + hry; thatch.scale.z = 0.8;
      thatch.position.set(hx, y + hht + 1.4, hz); g.add(thatch);
    }
    const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 4.5 + rnd() * 1, 15 + rnd() * 2), rockMat(0x968e7a));
    wall.position.set(9.5, y + 2.2, (rnd() - 0.5) * 2);                   // 太陽神殿弧牆(直牆近似)
    wall.rotation.y = (rnd() - 0.5) * 0.12;
    g.add(wall);
  } },
  stonehenge: { col: { r: 24, h: 27 }, s: [1.1, 2.0],
    anchor: { topY: 0.2, topR: 12, side: null },   // 特徵落在石圈內地面
    // 「不整齊」是巨石陣的本體(2026-07-29):每塊立石/楣石各自抽尺寸與微傾、環半徑逐塊
    // 漂移、兩成楣石塌失、圈內外散倒伏殘石 —— 外廓上限收在 col(r24/h27)內,碰撞柱不動
    build: (g, rnd) => {
    const posts = [];
    for (let i = 0; i < 10; i++) {                                        // 外環立石:塊塊不同
      const a = i / 10 * Math.PI * 2 + (rnd() - 0.5) * 0.07;
      const r0 = 19 + (rnd() - 0.5) * 2.4;
      const ph = 14.5 + rnd() * 4;
      const post = new THREE.Mesh(new THREE.BoxGeometry(3.9 + rnd() * 1.5, ph, 2.5 + rnd() * 1.1),
        rockMat([0x9b968a, 0x94907f, 0xa19c8e][(rnd() * 3) | 0], 0.2 + rnd() * 0.25));
      post.position.set(Math.cos(a) * r0, ph / 2, Math.sin(a) * r0);
      post.rotation.y = -a + Math.PI / 2 + (rnd() - 0.5) * 0.16;
      post.rotation.x = (rnd() - 0.5) * 0.05;                             // 千年沉降微傾
      post.rotation.z = (rnd() - 0.5) * 0.05;
      g.add(post);
      posts.push({ a, r0, ph });
    }
    // 楣石:架在兩鄰石上(取矮者頂,微沉咬合)。長度與朝向 MUST 由**兩石連線的實際世界向量**推
    // (A26):立石環半徑逐塊漂移 ±1.2m ⇒ 弦長 9.4~14m、弦向與中點切線差可達 7°,
    // 拿「中點方位的切線 + 固定長度 12~14.5m」擺就會有一端落在立石外面(實測到 5m 的縫)
    for (let i = 0; i < 10; i += 2) {
      if (rnd() < 0.2) continue;                                          // 兩成塌失 = 遺跡缺口
      const p1 = posts[i], p2 = posts[(i + 1) % 10];
      const x1 = Math.cos(p1.a) * p1.r0, z1 = Math.sin(p1.a) * p1.r0;
      const x2 = Math.cos(p2.a) * p2.r0, z2 = Math.sin(p2.a) * p2.r0;
      const dx = x2 - x1, dz = z2 - z1, span = Math.hypot(dx, dz);
      const lh = 2.4 + rnd() * 0.9;
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(span + 2.6 + rnd() * 1.2, lh, 3.1 + rnd() * 0.7),
        rockMat(0x8f8a7c, 0.3 + rnd() * 0.2));
      lintel.position.set((x1 + x2) / 2, Math.min(p1.ph, p2.ph) + lh / 2 - 0.3, (z1 + z2) / 2);
      lintel.rotation.y = -Math.atan2(dz, dx);                            // local +x 對準兩石連線
      lintel.rotation.z = (rnd() - 0.5) * 0.04;
      g.add(lintel);
    }
    const th = [];
    for (const s of [-1, 1]) {                                            // 內圈大三石塔:雙石同對不同高、互倚微傾
      const hh = 21.5 + rnd() * 2.5;
      const post = new THREE.Mesh(new THREE.BoxGeometry(4.2 + rnd() * 1.2, hh, 3.0 + rnd() * 0.8),
        rockMat(0xa39e90, 0.25));
      post.position.set(s * (4.2 + rnd() * 0.8), hh / 2, (rnd() - 0.5) * 1.6);
      post.rotation.y = (rnd() - 0.5) * 0.14;
      post.rotation.z = -s * rnd() * 0.03;
      g.add(post);
      th.push(hh);
    }
    const blh = 2.8 + rnd() * 0.7;
    const bigLintel = new THREE.Mesh(new THREE.BoxGeometry(14 + rnd() * 2, blh, 3.6 + rnd() * 0.8),
      rockMat(0x9b968a, 0.35));
    bigLintel.position.y = Math.min(...th) + blh / 2 - 0.3;               // 架矮柱頂,高柱側咬進去
    bigLintel.rotation.y = (rnd() - 0.5) * 0.1;
    bigLintel.rotation.z = (rnd() - 0.5) * 0.05;
    g.add(bigLintel);
    const altar = new THREE.Mesh(new THREE.BoxGeometry(5 + rnd() * 2, 1.2 + rnd() * 0.8, 2.4 + rnd() * 1.2),
      rockMat(0x7f7a6e, 0.3));
    altar.position.set((rnd() - 0.5) * 3, 0.7, (rnd() - 0.5) * 3);
    altar.rotation.y = rnd() * Math.PI;
    g.add(altar);
    const nF = 3 + ((rnd() * 3) | 0);
    for (let i = 0; i < nF; i++) {                                        // 倒伏殘石:散落石圈內外
      const a = rnd() * Math.PI * 2, d = 6 + rnd() * 15;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(3 + rnd() * 3.5, 1.1 + rnd() * 0.9, 2 + rnd() * 1.4),
        rockMat(0x8a8578, 0.4 + rnd() * 0.2));
      slab.position.set(Math.cos(a) * d, 0.5, Math.sin(a) * d);
      slab.rotation.set((rnd() - 0.5) * 0.12, rnd() * Math.PI, (rnd() - 0.5) * 0.12);
      g.add(slab);
    }
  } },
  torres: { col: { r: 34, h: 120 }, s: [0.8, 1.4],   // 塔群外緣 px20 + r13
    anchor: { topY: 28, topR: 2.5, side: { y: [26, 90] } },
    build: (g, rnd) => {
    // 百內三塔:淺色花崗岩塔身 + 暗色角頁岩殘帽,底部共用碎石肩。
    // 2026-07-29:逐塔高矮胖瘦/站位/稜線各異(高度只往下抖,col.h = 120 仍涵蓋)
    for (const [px, h, r] of [[-18, 96, 11], [2, 120, 13], [20, 82, 10]]) {
      const jh = h * (0.88 + rnd() * 0.12), jr = r * (0.88 + rnd() * 0.2);
      const jx = px + (rnd() - 0.5) * 3, pz = (rnd() - 0.5) * 6;
      const body = new THREE.Mesh(cyl(jr * 0.45, jr, jh, 7), rockMat(0xd0c3ae, 0.12));
      body.position.set(jx, jh / 2, pz);
      body.rotation.y = rnd() * Math.PI;                                  // 七邊柱稜線各異
      g.add(body);
      const cap = new THREE.Mesh(cyl(jr * 0.28, jr * 0.48, jh * 0.14, 6), rockMat(0x4e4a48));
      cap.position.set(jx, jh * 0.98, pz); g.add(cap);
    }
    const shH = 26 + rnd() * 7;
    const shoulder = new THREE.Mesh(cone(26 + rnd() * 6, shH, 8), rockMat(0x8f8474, 0.4));
    shoulder.position.y = shH / 2 - 1; g.add(shoulder);                   // 底緣微沉,坡地不懸空
  } },
  karst: { col: { r: 18, h: 104 }, s: [0.8, 1.4],
    anchor: { topY: 100, topR: 7, side: { y: [15, 85] } },
    build: (g, rnd) => {
    // 張家界石柱:石英砂岩方柱疊層(錐台微收 + 錯位微轉),崖頂綠冠環繞。
    // 2026-07-29:逐層寬深/軸心各自抽(層高不動,anchor.topY = 100 由層高總和推得)
    let y = 0;
    const w0 = 22;
    for (const [i, hh] of [20, 16, 18, 15, 17, 14].entries()) {
      const f = 1 - i * 0.08;
      const wBot = w0 * f * (0.92 + rnd() * 0.16), dBot = w0 * 0.85 * f * (0.92 + rnd() * 0.16);
      const wTop = wBot * 0.94, dTop = dBot * 0.94;
      const st = new THREE.Mesh(
        rockFrustum(wBot, dBot, wTop, dTop, hh, 0.2, 0.2),
        rockMat(i % 2 ? 0x8a7a5e : 0x7a6a50, i % 2 ? 0.12 : 0));
      st.position.set((rnd() - 0.5) * 2.4, y + hh / 2, (rnd() - 0.5) * 2.4);
      st.rotation.y = (rnd() - 0.5) * 0.24; y += hh; g.add(st);
    }
    for (const a of [0.4, 2.3, 4.4]) {   // 崖頂綠冠(頂緣三簇,中央留給石屋/疊石;簇簇不同)
      const crown = new THREE.Mesh(ico(4.5 + rnd() * 2), toonMat(0x3f7a44));
      crown.scale.y = 0.45 + rnd() * 0.2;
      const ja = a + (rnd() - 0.5) * 0.5;
      crown.position.set(Math.cos(ja) * (5.5 + rnd() * 2), y + 1.5, Math.sin(ja) * (4.5 + rnd() * 2)); g.add(crown);
    }
  } },
  // ---- 2026-07-29 增補:三座世界地標岩體(逐顆 rnd 變異同前;外廓收在 col/anchor 內)----
  meteora: { col: { r: 36, h: 88 }, s: [0.9, 1.5],
    anchor: { topY: 78, topR: 8, side: { y: [12, 62] } },
    // 邁泰奧拉(希臘):圓潤砂礫岩峰 + 崖頂修道院(紅瓦石屋/鐘塔)+ 伴峰。
    // 層高固定(anchor.topY = 78 錨在頂台),變化放在半徑/軸心/伴峰/修道院配置
    build: (g, rnd) => {
    let y = 0;
    const tones = [0x9a8f7c, 0x938774, 0xa29786];
    for (const [f, hh] of [[1.3, 20], [1.12, 22], [1.0, 21], [0.9, 12]]) {   // 圓柱疊層砂礫岩(圓潤上收)
      const r = 13.5 * f * (0.94 + rnd() * 0.12);
      const st = new THREE.Mesh(cyl(r * 0.9, r, hh + 2, 9), rockMat(tones[(rnd() * 3) | 0], rnd() * 0.15));
      st.position.set((rnd() - 0.5) * 2, y + hh / 2, (rnd() - 0.5) * 2);
      st.rotation.y = rnd() * Math.PI;
      y += hh; g.add(st);
    }
    const plat = new THREE.Mesh(cyl(8.5, 11, 3, 9), rockMat(0xa39884, 0.2));
    plat.position.y = 76.5; g.add(plat);                                     // 頂台 75~78
    const nHut = 1 + (rnd() < 0.6 ? 1 : 0);                                  // 修道院石屋(紅瓦雙坡頂)
    for (let i = 0; i < nHut; i++) {
      const hx = (i ? -1 : 1) * (1.5 + rnd() * 2), hz = (rnd() - 0.5) * 5;
      const hw = 4.5 + rnd() * 1.6, hd = 3.6 + rnd() * 1.2, hh2 = 2.8 + rnd();
      const hut = new THREE.Mesh(new THREE.BoxGeometry(hw, hh2, hd), rockMat(0xcfc4ae));
      hut.position.set(hx, 78 + hh2 / 2, hz); hut.rotation.y = (rnd() - 0.5) * 0.5; g.add(hut);
      const roof = new THREE.Mesh(cone(hw * 0.62, 1.8, 4), rockMat(0xa2543e));
      roof.rotation.y = Math.PI / 4 + hut.rotation.y; roof.scale.z = 0.8;
      roof.position.set(hx, 78 + hh2 + 0.9, hz); g.add(roof);                // 紅瓦頂
    }
    const bell = new THREE.Mesh(new THREE.BoxGeometry(1.8, 4.5, 1.8), rockMat(0xd8cfc0));
    bell.position.set(5.5 + rnd(), 80.2, (rnd() - 0.5) * 4); g.add(bell);    // 鐘塔(頂台緣)
    const bt = new THREE.Mesh(cone(1.6, 1.6, 4), rockMat(0xa2543e));
    bt.rotation.y = Math.PI / 4; bt.position.set(bell.position.x, 83.2, bell.position.z); g.add(bt);
    const cr = 7 + rnd() * 3, ch = 26 + rnd() * 14, ca = rnd() * Math.PI * 2;   // 伴峰(矮圓峰)
    const cx2 = Math.cos(ca) * (19 + rnd() * 3), cz2 = Math.sin(ca) * (16 + rnd() * 3);
    const comp = new THREE.Mesh(cyl(cr * 0.8, cr * 1.15, ch, 9), rockMat(tones[(rnd() * 3) | 0], 0.15 + rnd() * 0.2));
    comp.position.set(cx2, ch / 2, cz2); comp.rotation.y = rnd() * Math.PI; g.add(comp);
    const dome2 = new THREE.Mesh(new THREE.SphereGeometry(cr * 0.82, 9, 6), rockMat(0xa29786, 0.3));
    dome2.scale.y = 0.55; dome2.position.set(cx2, ch, cz2); g.add(dome2);    // 伴峰圓頂
    // 垂直侵蝕墨線:貼壁半徑與內傾角**實測**(rockProbe)—— 疊層各自抽了半徑與軸心偏移、
    // 九邊形小面又內縮 6%,拿「層別 × 0.92」推算會浮在壁外(實測前量到 2.1m 的縫)
    const probe = rockProbe(g);
    const nRib = 3 + ((rnd() * 3) | 0);
    for (let i = 0; i < nRib; i++) {
      const a = rnd() * Math.PI * 2, ry2 = 14 + rnd() * 34;
      const rh2 = 14 + rnd() * 12;
      const rr = probe.wallR(0, 0, ry2, a);
      if (rr == null) continue;
      const rib = new THREE.Mesh(new THREE.BoxGeometry(1.3, rh2, 1.1), rockMat(0x7a7062));
      rib.position.set(Math.cos(a) * (rr - 0.65), ry2, Math.sin(a) * (rr - 0.65));
      rib.rotation.y = -a;
      rib.rotation.z = Math.atan(probe.slope(0, 0, ry2, a, rh2 / 2));   // 跟著砂礫岩上收的壁面內傾
      g.add(rib);
    }
  } },
  sigiriya: { col: { r: 48, h: 76 }, s: [0.8, 1.3],
    anchor: { topY: 74, topR: 18, side: { y: [16, 56] } },
    // 獅子岩(斯里蘭卡):陡壁孤丘 + 白鏡牆帶 + 頂上宮殿基座遺跡 + 山腳獅爪門 + 之字棧道
    build: (g, rnd) => {
    const sz = 0.62 + rnd() * 0.08;                                          // 橢圓斷面(z 壓扁)
    const lower = new THREE.Mesh(cyl(40, 45, 54, 11), rockMat(0xa2765a, 0.18));
    lower.scale.z = sz; lower.position.y = 27; lower.rotation.y = (rnd() - 0.5) * 0.3; g.add(lower);
    const upper = new THREE.Mesh(cyl(34, 39, 18, 11), rockMat(0xaa7e60, 0.12));
    upper.scale.z = sz; upper.position.y = 61; upper.rotation.y = (rnd() - 0.5) * 0.3; g.add(upper);
    const cap = new THREE.Mesh(cyl(31, 34.5, 4, 11), rockMat(0x8a9a5e, 0.6));
    cap.scale.z = sz; cap.position.y = 72; g.add(cap);                       // 頂台草坪(70~74)
    const rw = (y2) => 45 - 5 * y2 / 54;                                     // 下段壁面半徑剖面
    const mirror = new THREE.Mesh(cyl(rw(42.5) + 0.35, rw(37.5) + 0.35, 5, 11), rockMat(0xe8ddc2));
    mirror.scale.z = sz; mirror.position.y = 40;
    mirror.rotation.y = lower.rotation.y;   // 對齊岩體 11 邊形稜線(相對轉會讓帶子局部外浮)
    g.add(mirror);                                                           // 白鏡牆環帶(貼壁)
    const nW = 3 + ((rnd() * 3) | 0);                                        // 頂上宮殿基座遺跡(矮牆格局)
    for (let i = 0; i < nW; i++) {
      const wl = 8 + rnd() * 8;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(wl, 1.3, 1.1), rockMat(0xc9b896, 0.2));
      wall.position.set((rnd() - 0.5) * 22, 74.6, (rnd() - 0.5) * 14);
      wall.rotation.y = (rnd() < 0.5 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.15;
      g.add(wall);
    }
    const pool = new THREE.Mesh(new THREE.BoxGeometry(6 + rnd() * 3, 0.9, 4 + rnd() * 2), rockMat(0x3a5a5e));
    pool.position.set((rnd() - 0.5) * 10, 74.3, (rnd() - 0.5) * 8); g.add(pool);   // 宮殿蓄水池
    for (const s of [-1, 1]) {                                               // 山腳獅爪門(北側雙巨爪)
      const claw = new THREE.Mesh(new THREE.BoxGeometry(4.5 + rnd(), 6.5 + rnd(), 4), rockMat(0xb98a62, 0.1));
      claw.position.set(s * (6.5 + rnd()), 3.2, 45 * sz * 0.92); g.add(claw);
      for (let t = -1; t <= 1; t++) {
        const toe = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 1.6), rockMat(0xa8794f));
        toe.position.set(claw.position.x + t * 1.5, 1.1, claw.position.z + 2.4);
        g.add(toe);
      }
    }
    // 之字棧道(側壁淺色梯板):**貼壁半徑實測**(rockProbe)—— 岩體是 11 邊形 × z 壓扁的
    // 橢圓斷面又整體微轉,拿 `rw()` 剖面推算會浮在小面內縮那一段外面(實測前量到 1.07m 的縫);
    // 之字沿**方位**左右擺(local x = 徑向、z = 踏面長),MUST NOT 用固定 x + z 偏移(離壁越遠越浮)
    const probe = rockProbe(g);
    const nS = 4 + ((rnd() * 3) | 0);
    for (let i = 0; i < nS; i++) {
      const sy2 = 12 + i * (44 / nS) + rnd() * 3;
      const step = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 7 + rnd() * 3), rockMat(0xd8c9a8));
      const aa = (i % 2 ? 1 : -1) * (0.1 + rnd() * 0.18);                    // 繞 +x 側左右擺
      const rr = probe.wallR(0, 0, sy2, aa);
      if (rr == null) continue;
      step.position.set(Math.cos(aa) * (rr - 0.9), sy2, Math.sin(aa) * (rr - 0.9));   // 沉半塊(1.8/2)
      step.rotation.y = -aa;
      g.add(step);
    }
  } },
};

// ---- 巨岩表面實測探針(貼壁 / 頂面落點的唯一縫;2026-07-30)----
// **為什麼是實測而不是公式**:岩體是多面體近似(11 邊形球 / 8~10 邊柱 / 二十面體塊),
// 小面內縮 4~5% 半徑(r=50 的岩體就是 2m)、疊層逐段收分、崩落塊撐大外廓 —— 手寫剖面
// 公式(側壁橢圓 × dome √(1−u²) / taper 線性)一律算不準,算差 1m 樹就浮在半空
// (2026-07-30 使用者回報「巨石懸崖旁的樹沒接好」;稽核 audit_object_joints 巨岩段)。
// A26 的「錨點半徑 MUST 取該高度的錨體半徑」在這裡的落實方式 = 射線量真幾何,
// **MUST NOT** 在消費端另寫第二份剖面公式。
// 用法:`rockProbe(g)` 於「岩體已建好、特徵還沒放上去」時取一次(g 尚未套放置變換 ⇒
// 世界座標 = 岩體 local),回傳的三支查詢只射當下的岩體子物件(不會射到後放的特徵)。
const _rcO = new THREE.Vector3(), _rcD = new THREE.Vector3(), _rc = new THREE.Raycaster();
function rockProbe(g) {
  g.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(g);
  const far = Math.max(20, Math.hypot(bb.max.x - bb.min.x, bb.max.z - bb.min.z)) + 20;
  const topY = bb.max.y + 20;
  const body = g.children.slice();   // 岩體快照
  const hit = (ox, oy, oz, dx, dy, dz, len) => {
    _rc.far = len;
    _rc.set(_rcO.set(ox, oy, oz), _rcD.set(dx, dy, dz));
    const h = _rc.intersectObjects(body, true);
    return h.length ? h[0].distance : null;
  };
  /** 側壁半徑:自 (px,pz) 沿方位 a、高度 y **由外向內**射(正面朝外的岩面才吃得到);null = 該處無岩體 */
  const wallR = (px, pz, y, a) => {
    const dx = Math.cos(a), dz = Math.sin(a);
    const t = hit(px + dx * far, y, pz + dz * far, -dx, 0, -dz, far * 2);
    return t == null ? null : far - t;
  };
  return {
    wallR,
    /** 壁面斜率 |dr/dy|(每升 1m 內收幾 m):彎頭入壁角 / 溝棒內傾角共用 */
    slope: (px, pz, y, a, dy = 2) => {
      const r0 = wallR(px, pz, y, a), r1 = wallR(px, pz, y + dy, a);
      return r0 == null || r1 == null ? 0 : Math.max(0, (r0 - r1) / dy);
    },
    /** 頂面高:自上方垂直下射;null = 該 (x,z) 沒有頂面(懸出岩體外) */
    topAt: (x, z) => { const t = hit(x, topY, z, 0, -1, 0, topY * 2 + 40); return t == null ? null : topY - t; },
  };
}

// ---- 巨岩表面特徵:高壓電塔 / 石砌屋 / 疊石堆 / 鳥巢(岩台)/ 峭壁樹·岩菇 ----
// 在岩體 local 座標放置(隨岩體旋轉縮放),特徵自身尺寸 ÷ s 抵銷縮放 →
// 世界尺寸恆定;anchor 描述可放置面:topY/topR 平頂(選尺寸用)、side = 可附著側壁
// (單面或「柱群」陣列,每項 {px,pz,y:[lo,hi]})—— **落點高度與壁面半徑一律走 rockProbe 實測**。
// 頂面特徵一律「塞不下就縮小到剛好」:sc = min(想要的, 頂面半徑/自身腳印),
// 縮到下限仍塞不下才放棄;偏移量同步夾在「頂半徑 − 腳印」內,再由 `seat()` 實測腳印四角
// 是否踩在同一片頂面上(圓頂/窄頂/疊石堆頂拿 topR 猜會半懸空)。
// ---- 巨岩零件庫(runbook §5f:命令式建造端不開宣告式縫,只做呼叫點守衛)----
// 名冊 = 這裡一份(audit_siteplan Ⅴ 與 tools/ai3d 的 megaLibDescs 都吃這一份;
// 節點還沒入庫就不要把名字放進來 —— intake 會把「名冊有、GLB 無」判成缺件紅字)。
// 節點契約:**單位包絡**(水平徑向 ≤1、縱向 ±1;= fallback ico(1)),呼叫端以
// mesh.scale 拉到自己的尺寸 ⇒ 同一顆節點服務任意大小的岩塊。
const MEGA_LIB = {
  // 渾圓/塊狀岩塊(marble 堆/崩落塊/伴生丘/疊石);2026-08-06 第 7 輪 +3 顆跨國地質實拍:
  // d 海蝕拱殘丘、e 平衡巨礫(花崗岩 tor)、f 砂岩刃脊塊
  block: ['rock/mega_a'].filter(isRuntimeEligibleNatureKey),
  tower: 'rock/tower_a',                                  // 火山頸整座(實拍魔鬼塔;崖錐 + 柱身同一顆)
  mesa: 'rock/mesa_a',                                    // 平頂岩體整座(實拍;裙狀崖錐 + 疊層同一顆)
  hoodoo: 'rock/hoodoo_a',                                // 蘑菇岩整柱(實拍帽岩+細頸,Hoodoo Basin)
  //   (2026-08-06 晚:同一張乾淨候選 wc_112762573,SF3D 在細腰處斷成兩截(§5j 待續①)⇒
  //    改走 fallback chain 下一階 Hunyuan3D-2GP(runbook §5m)—— 帽岩/細頸/基座全保住)
};
// 與 partGeo 同一條紀律的命令式版本:查無此名/載入失敗 ⇒ null,呼叫端以原 primitive
// 收尾(保險絲,原則 6)。兩點不同:①一律 `.clone()` —— 巨岩群組會過 bakeContactAO
// (就地 setAttribute 頂點色),共用庫幾何被烤一次,全場每一處引用都帶著別顆岩的 AO
// (partlib 紀律②);②佈局與碰撞(H/RX/RZ/col/anchor)的算式 MUST NOT 讀庫幾何 ——
// 庫隨載入成敗而異,佈局讀它 = 跨客戶端分家(§2.3)。亂數紀律:呼叫端 MUST NOT 因
// 庫的有無增減 rnd() 枚數(有無庫,共享序列逐位元同一條)。
const megaGeo = (name) => {
  const g2 = name && isRuntimeEligibleNatureKey(name) ? libGeo(name) : null;
  return g2 ? g2.clone() : null;
};
// 輪替除數 MUST 由名冊長度推導(推導值 MUST NOT 手寫,§2.1):四個呼叫點原本各寫死 `% 3`,
// 名冊一擴充,第 4 顆以後的節點就**永遠不會被取到** —— 檔案在、intake 綠、對照台有列,
// 而遊戲裡一顆都沒出現過,沒有任何錯誤訊息。長度為 3 時逐位元同舊制。
const NBLK = MEGA_LIB.block.length;

// ---- 建物配件零件庫(2026-08-06 使用者定案「大量下載不同國家、城市、小鎮、風格的建築物
// 照片,再進行 img to 3D;無視舊有物件直接畫,禁止使用原版重繪」)----
// 名冊 = 這裡一份(audit_siteplan Ⅴ 與 tools/ai3d 的 bldLibDescs 都吃這一份;節點還沒入庫
// 就不要把名字放進來 —— intake 會把「名冊有、GLB 無」判成缺件紅字)。
// 節點契約:**單位包絡** —— 屋頂配件桶的 instance scale 本來就是尺寸(煙囪 S=(w,h,w)、
// 水塔 S=(r,h,r)、機組 S=(w,h,d)),故 fallback = 該桶現行的**單位 primitive** 同義描述:
// box(1,1,1) / cyl(r1,r2 1、h 1)。幾何縫換的是 InstancedMesh 的**共用幾何**:一顆節點服務
// 全桶所有 instance,draw call 逐位元不變;屋頂配件本無碰撞柱(佈局/碰撞無庫可讀的問題
// 天然不存在);換幾何消耗 0 枚 rnd(§2.3)。不 clone —— 這些桶不過 bakeContactAO,
// 幾何唯讀共用(與 megaGeo 的差異點,理由在各自的消費方式)。
// ---- 第四桶 `mass` = **整棟量體**(佇列 F;2026-08-08 使用者定案「執行佇列 F」)----
// 與上面三桶的差別只有一個,但它決定了整條縫的形狀:**這一桶不整桶換,只換一個子集**,
// 而那是**量出來的**不是挑出來的 —— 主量體是單位方盒(12 tris)× 全圖 1,325 個 instance
// (taipei101 --live 實測上界),整桶換的逐節點上限只有 **36 tris**
// (tri_budget families.building.mass.full_swap_cap),而 §5o 已實測 500 面就留不住
// Art Deco 的退縮量體 ⇒ 整桶換出來的每一棟還是同一團方塊。故改成「全圖最高的
// `MASS.PICK_N` 棟高層商辦」,上限因此拉到 2,981 面。挑選規則見下方 `MASS`。
// 名冊值的第一格**可以是陣列**(輪替名冊,同 MEGA_LIB.block):整棟量體一款打天下的話,
// 同一條天際線上會出現十幾棟一模一樣的剪影(零件庫紀律「烤整棟樓會把逐實例變化丟掉」的
// 同一個病)。輪替除數由名冊長度推導,MUST NOT 寫死(MEGA_LIB 那條教訓:名冊擴充後
// 第 N 顆以後永遠取不到,檔案在、intake 綠、遊戲裡一顆都沒出現過)。
const BLD_LIB = {
  chimney: ['building/chimney_a', ['box', 1, 1, 1]],   // 磚砌煙囪(chimneys 桶)
  // tank: ['building/tank_a', ['cyl', 1, 1, 1]],      // 圓筒水塔 —— 節點入庫時再開這一列
  //   (2026-08-06:rooftank 候選照全是場景照/有人入鏡,tank_wood 木製水塔列等節流窗)
  acbox:   ['building/ac_a', ['box', 1, 1, 1]],        // 空調機組/機房(roofBoxes 桶)
  // 整棟量體(高層商辦子集;§5aa/§5ab)。**輪替名冊 MUST ≥2 顆** —— 只有一顆的話
  // 同一張圖上挑中的十幾棟塔樓是同一個剪影(尺寸各異、形狀相同),而所有離線閘門全綠。
  // a = 退縮階梯式方塔、b = 寬裙樓 + 細塔身 + 尖頂(§5ae)、c = 帝國大廈式高聳退縮塔 + 尖塔(§5aq)。
  // c 是**第一顆背面不是空的整棟量體節點**(半空間面積不對稱 asymZ 0.001,而 a 是 0.123)——
  // 選片那一條(§5ae「整棟入鏡,不是最好看的局部」)兌現在這裡:同一族的另一張候選照
  // 生出來的是一塊中空的立面碎片,而它在任何離線閘門上都是綠的(見 §5aq-b)。
  // 第三格 = **輪廓剖面**(2026-08-12;逐節點一筆,與名冊同序)。見 `bldProfile` 檔頭:
  // 它是這一顆節點的形狀在 Node 端唯一拿得到的樣子,而佈局數學(碰撞柱 / 尺寸 / 招牌落點)
  // MUST 只讀它、MUST NOT 讀庫幾何(§2.1「AI 零件庫消費」:庫載不載得到逐客戶端不同 ⇒
  // 讀庫幾何 = 權威幾何跨客戶端分家)。值由 `tools/ai3d/parts_src.mjs nodeProfile` 量,
  // `intake_parts` 逐顆比對宣告與實測(對不上就紅字 ⇒ 名冊不會靜默過期)。
  // 第五欄(2026-08-13)= 這一段的高度區間裡**平整垂直牆**佔的面積比(量法見 `nodeProfile`)。
  // 招牌只准掛在 ≥ `MASS.SIGN_FLAT_MIN` 的那幾段(使用者「外掛招牌只貼在垂直地面且完全平整
  // 的平面牆」)—— 剖面側面依構造是垂直矩形,但那**不保證**那個高度的網格真的是一面平牆
  // (尖塔、山牆、退縮斜切面照樣落在某一段的側面上)。
  mass: [['building/mass_a', 'building/mass_b', 'building/mass_c'], ['box', 1, 1, 1], [
    [[-0.475, -0.1187, 0.3715, 0.4168, 0.5936], [-0.1187, 0.1187, 0.2958, 0.2143, 0.7092], [0.1187, 0.4156, 0.2954, 0.1763, 0.5297], [0.4156, 0.475, 0.1352, 0.0604, 0.0403]],
    [[-0.475, -0.0594, 0.1235, 0.4668, 0.7337], [-0.0594, 0.0594, 0.1255, 0.4358, 0.6054], [0.0594, 0.2969, 0.1218, 0.1637, 0.487], [0.2969, 0.475, 0.0842, 0.0624, 0]],
    [[-0.475, 0.1187, 0.3628, 0.356, 0.6688], [0.1187, 0.1781, 0.3179, 0.3212, 0.1212], [0.1781, 0.2375, 0.2071, 0.2199, 0], [0.2375, 0.475, 0.1096, 0.1146, 0.0586]],
    /* +prof:mass */
  ]],
  // 低矮建物的整棟量體(2026-08-09 使用者定案「開」第二個桶 + §5al-c 選 (a) 8/8 切分)。
  // **它與上面那一桶吃同一個 facade_wall 桶** ⇒ 額度是同一份:`MASS.PICK_N` 與
  // `MASS.PICK_N_LOW` 加起來才是 tri_budget 的 `pick_n`,`node_cap` 因此一格不動
  // (已出貨的 mass_a/mass_b 不受影響)。開這一桶的理由是**消費端**:rural / civic /
  // 設計圖三條語料在此之前沒有任何出口(唯一的 mass 桶只服務 `commercial && h > 55`)。
  // 名冊空著 ⇒ `bldLibN` 回 0 ⇒ 一棟都不挑 ⇒ **逐位元同舊制**(保險絲,原則 6)。
  // ⚠ 輪替名冊 MUST ≥2 顆才算「開好」(同上一列的理由:一款打天下 = 同一張圖上
  //   挑中的那幾棟是同一個剪影,而所有離線閘門全綠)。
  masslow: [['building/masslow_a', 'building/masslow_b'], ['box', 1, 1, 1], [
    [[-0.475, 0.1187, 0.2843, 0.3928, 0.7761], [0.1187, 0.1781, 0.209, 0.3934, 0.435], [0.1781, 0.3562, 0.1734, 0.3976, 0.2107], [0.3562, 0.475, 0.0621, 0.3855, 0.0386]],
    [[-0.475, -0.0594, 0.4186, 0.2359, 0.7482], [-0.0594, 0.0594, 0.415, 0.1656, 0.196], [0.0594, 0.3562, 0.4142, 0.0712, 0.3968], [0.3562, 0.475, 0.3037, 0.0296, 0.2294]],
    /* +prof:masslow */
  ]],
};
// `i` = 輪替索引(只有陣列名冊吃得到;單一字串的舊三桶逐位元不受影響)
const bldGeo = (key, i = 0) => {
  const row = BLD_LIB[key];
  if (!row) return null;
  const n = row[0];
  return libGeo(Array.isArray(n) ? n[((i % n.length) + n.length) % n.length] : n);
};
/** 該桶名冊有幾顆節點(0 = 這一桶還沒入庫;輪替除數的唯一來源) */
const bldLibN = (key) => { const n = BLD_LIB[key]?.[0]; return n ? (Array.isArray(n) ? n.length : 1) : 0; };

/**
 * 這一顆整棟量體節點的**輪廓剖面**(2026-08-12 使用者回報「非簡單幾何的建築…物理碰撞
 * 實質上還是立方體」「招牌會懸空」的唯一縫)。
 *
 * ---- 它修的是什麼 ----
 * 舊制:挑中庫節點的那幾棟,**碰撞柱仍是整個 OSM 足跡的單一方盒**(A30 的有向盒),
 * 而節點自己是退縮塔 / 薄板 / 人字屋頂 —— 實測剖面體積只佔那顆方盒的 **16%~38%**
 * (mass_b 0.157、masslow_b 0.256)。看得到的樣子與撞得到的樣子差到三、四倍:
 *   ・退縮塔上半段整圈是空氣,卻擋彈、擋 LOS、爬得上去;
 *   ・招牌掛在方盒的側面 `b.d/2`,而那個高度的塔身只有方盒的 0.2 倍寬 ⇒ **牌子浮在半空**
 *     (§5ab-c 當時的處理是「挑中的那幾棟純視覺附件一律不掛」—— 那是繞過去,不是修好)。
 *
 * ---- 為什麼是一疊有向盒,不是真網格 ----
 * A30:碰撞 / 彈道 / 伺服器 LOS MUST 同一橫斷面,而三端共同吃得到的形狀只有有向盒與圓柱
 * (occ 上傳欄位、`_blockerHitT`、`sim.solidResolve` 全是)。⇒ 把**一顆方盒換成一疊方盒**,
 * 三端一行都不用改,而剖面跟著退縮階、山牆、裙樓一起收。
 *
 * ---- 三條紀律 ----
 * ① **純資料**:值住名冊(離線量、`intake_parts` 比對),消費端 MUST NOT 讀庫幾何 ——
 *    庫載不載得到逐客戶端不同,讀它就是碰撞柱跨客戶端分家(§2.1 / §2.3 / A30)。
 *    同一條也決定了**挑選 MUST 與庫載入解耦**(見 `massPick`):選中誰是純資料的函式,
 *    載到庫的只是「畫出來的是網格還是保險絲」。
 * ② **保險絲同源**:載不到庫時畫的那顆(`buildBldBucket.mass`)也由**同一份剖面**疊出來
 *    ⇒ 不論載不載得到,看到的與撞到的都是同一個形狀。
 * ③ **包住不切齊**:每一段取該段的**最大**半跨 ⇒ 盒恆包住網格(「演出 ⊆ 碰撞盒」,A44 ③)。
 *    少算一格的代價是「看得見的牆打得穿」,比多算一格嚴重得多。
 * @returns {{slabs:number[][], hw:number, hd:number, hy:number}|null} 單位盒座標;無宣告回 null
 */
function bldProfile(key, i = 0) {
  const rows = BLD_LIB[key]?.[2];
  if (!rows) return null;
  const n = bldLibN(key);
  const slabs = Array.isArray(rows[0]?.[0]) ? rows[((i % n) + n) % n] : rows;
  if (!slabs?.length) return null;
  let hw = 0, hd = 0, hy = 0;
  for (const [y0, y1, w, d] of slabs) {
    hw = Math.max(hw, w); hd = Math.max(hd, d);
    hy = Math.max(hy, Math.abs(y0), Math.abs(y1));
  }
  return { slabs, hw, hd, hy };
}
// 整棟量體的挑選規則(兩個值都與 tri_budget families.building.mass 同一份,audit_siteplan Ⅴ 釘住相等)
const MASS = {
  // **兩個既有的判準各切一刀,對角線兩格換節點**:
  //   commercial && h > MIN_H  → `mass`(高層商辦:退縮量體、婚禮蛋糕剪影)
  //   !commercial && h <= MIN_H → `masslow`(低矮非商辦:農舍/教堂/穀倉那一類坡屋頂量體)
  //   其餘兩格(低矮商辦 / 高層住宅)**維持方盒** —— 那個空隙是刻意留的:為它們再訂
  //   一個門檻就是第三個手寫數字,而語料裡也沒有對得上的東西。
  // 門檻沿用 biomes 既有的退縮頂塔門檻,MUST NOT 另發明數字;`commercial` 是既有的
  // OSM 型別判定(commercial/office/retail/hotel/10 層以上公寓)⇒ 非商辦正好就是
  // 住宅/教堂/穀倉/學校那一類,也正是 rural + civic 兩條語料抓的東西。
  MIN_H: 55,
  // 兩個桶**共用同一份成長額度**(它們是同一個 facade_wall 桶)⇒
  // `PICK_N + PICK_N_LOW` 才是 tri_budget 的 `pick_n`(= 額外 draw call ≤ 立面段現行的 16),
  // 而 `node_cap` 的除數是那個總數 ⇒ 切分比例改不動逐節點上限。8/8 是使用者 2026-08-09
  // 的定案(§5al-c 選 (a)):兩邊都沒有量得出來的偏袒理由。
  PICK_N: 8,      // 高層商辦(排最高的)
  PICK_N_LOW: 8,  // 低矮建物(排足跡面積最大的)
  // **三條 UV 帶**(2026-08-12 使用者定案「建築外部的密集窗戶圖層與外掛招牌只貼垂直地面
  // 且平整的平面牆」;前身是 2026-08-09 的兩帶屋頂帶 §5an-d)。
  // 庫節點只有**一個材質群組** ⇒ three 取 material[0],方盒那條路「第 3/4 格 = 屋頂材質」
  // 對它不生效;拆群組又會讓每一棟多一個 draw call(而 `PICK_N` 的整條推導就是 draw call
  // 上界)⇒ 把區分移進 **UV**:`normalize_parts.py --uvbands` 依**面的傾角**把三群分別壓進
  //   朝上(n.y > MINZ)          → v ∈ [0, roof)          這裡畫屋頂
  //   傾斜 / 朝下(其餘)          → v ∈ [roof, roof+plain) 這裡畫**素牆**(沒有窗)
  //   近垂直(|n.y| ≤ WALL_NY)    → v ∈ [roof+plain, 1]    這裡才畫窗格
  // 中間那條就是這一輪加的:貼圖是盒投影上去的,面越斜同一段 u/v 就攤在越長的表面上
  // ⇒ 退縮頂的斜切面、尖塔、屋簷底上的窗格是被拉糊的一片(舊制它們全在窗格帶裡)。
  // **每一桶各一組**(兩桶本來就各有自己的立面材質家族),值都是量出來的:帶寬 = 該群
  // 面積佔比的**名冊平均** ⇒ 三帶 texel 密度相同(瓦縫、素牆的抹紋與窗框同一個顆粒度)。
  // `MINZ` 取兩顆量到的**空檔中點**(牆的尖峰止於 n.y 0.15、屋頂起於 0.45~0.65);
  // ⚠ 沿用盒投影的「主導軸」等價於門檻 0.577,而那會把穀倉**整個屋頂**判成牆。
  // 這幾個數字與 tri_budget 的 families.building.<桶> **同一份**(audit_siteplan 釘住相等;
  // intake_parts 直接量 GLB 的 UV 帶)—— 分家不會報錯,只會讓屋頂那條接縫落在牆上。
  //
  // ---- 2026-08-13:窗牆帶再加一條「**完全平整**」(使用者這一輪的第 ② 條)----
  // 上一輪把「平整」留給招牌那一半,理由是**當時的網格根本沒有平整的立面**:近垂直面裡
  // 真的貼在自己那一群平面上(≤`FLAT_DEG`)的只有 53.9/61.5/78.9/90.2/74.1%,而相鄰近垂直面
  // 之間夾角落在 (0.5°, 12°] 的更佔 53~64% 的面積 —— 那正是使用者這一輪說的「不平整的多塊
  // 法線角小的平面牆」。⇒ 同一輪先在匯出端把它們**合併整平**(`normalize_parts.py` 的
  // `_planarize` 改成「法線角 + 平面偏移」分群 + 累計夾制 + 多趟收斂;小角面積佔比實測
  // 降到 31.2/9.3/27.9/6.9/10.0%、平整佔比升到 64.5/85.2/92.0/97.1/89.4%),窗牆帶才吃得起
  // 這一條。⇒ 素牆帶跟著長大(mass 0.176 → 0.308),那一段的差額就是**真的不平整的那些牆**。
  // `FLAT_DEG` MUST ≪ 分群容差(12°):分群是「這幾塊算不算同一面牆」、平整是「整完之後
  // 真的貼上去了沒」,兩個用同一個數字這道閘就退化成「有分到群就算平」(恆真)。
  // 逐顆實測(tools/ai3d/parts_src.mjs uvBandStats,MINZ 0.30 / WALL_NY 0.15 / FLAT_DEG 6):
  //   mass    朝上 0.112/0.095/0.139 → 0.115、素牆 0.299/0.182/0.190 → 0.223
  //   masslow 朝上 0.203/0.183       → 0.193、素牆 0.219/0.225       → 0.222
  // (⚠ mass_a 的素牆 0.299 離名冊平均 0.076 —— 它就是那顆「還是不夠平」的節點,見
  //  docs/ai3d_runbook.md 的重生佇列。**這是量測結果不是容差問題**,MUST NOT 靠調鬆
  //  `FLAT_DEG` 讓它好看:那等於把不平整的牆重新放回窗格帶。)
  // **2026-08-14 第四輪重量**(使用者「相對周邊面積過小且角度差異沒有過大的區塊,與角度
  // 最接近的鄰居合併」;`normalize_parts.py` 的 ㋗)。素牆帶整體縮小(mass 0.308 → 0.223、
  // masslow 0.262 → 0.222)= **真的不平整的牆變少了**:碎屑併進相鄰的大平面之後,那些面
  // 從「近垂直但不平整」轉回窗牆帶。⇒ 這一格的數字往下走是**好事**,它往上走的時候才
  // 要回頭看節點品質。
  UVB: {
    mass: { roof: 0.125, plain: 0.245 },
    masslow: { roof: 0.188, plain: 0.155 },
    MINZ: 0.30,
    WALL_NY: 0.15,
    FLAT_DEG: 6,
    FLAT_MIN: 0.005,
  },
  // **招牌落點的平整門檻**(2026-08-13 使用者「外掛招牌只貼在垂直地面且完全平整的平面牆」)。
  // 與窗格那一半分開的理由:窗格是**貼圖**(盒投影,對起伏不敏感),招牌是**剛性矩形**
  // —— 牌面與牆面差一點就讀成浮在半空。⇒ 招牌吃逐段的第五欄(`BLD_LIB` 的剖面),
  // 挑不到合格的段就**不掛牌**(原則 6 寧缺勿錯,而不是退回方盒側面 = 掛在空氣裡)。
  // 門檻取二十段實測值排序後那個**語意空檔**的幾何中點(2026-08-13:… 0.294 |↕| 0.348 …
  // ⇒ √(0.294 × 0.348) = 0.320)。空檔兩側恰好就是語意的兩邊 —— 下面那幾段是尖塔/山牆/
  // 退縮斜切面,上面那幾段是真的立面。
  // **2026-08-14 第四輪重量後不動**:分布位移到 … 0.189 |↕| 0.341 …,而 0.320 仍落在
  // 同一個語意空檔**之內** ⇒ 合格的段一格未變(12/20:mass 3+3+1、masslow 2+3)。
  // 空檔的幾何中點雖然變成 0.254,取它或取 0.320 挑出來的是**同一批段** ⇒ 不動它
  // (改一個「換了也一樣」的門檻,只會讓下一個人以為那次改動有意義)。
  SIGN_FLAT_MIN: 0.320,
  // **面板切分的門檻**(2026-08-13 使用者「平面區域太小的話不渲染窗戶,窗戶會被裁切掉的
  // 時候也不渲染」)。規則本體住 `wallpanel.js`(零 import,離線工具吃同一支);門檻與
  // `tri_budget.json` 的 `families.building.planar_spec` **同一份**(audit_siteplan 釘住相等)
  // —— 匯出端的整平、入庫閘的量測、執行期的窗格對齊,三個消費端用的是同一組數字。
  PANEL: { DEG: 12, OFF_F: 0.03, WALL_NY: 0.15, FLAT_DEG: 6, MIN_F: 0.005 },
  // ---- 輪廓剖面(2026-08-12;見 `bldProfile` 檔頭)----
  // 量測參數:縱向切幾段、合併到剩幾段。段數是**碰撞柱數**與**保險絲面數**的旋鈕:
  // 挑中的至多 `PICK_N + PICK_N_LOW` = 16 棟 × (SLABS − 1) = 至多 +48 根柱
  // (`LOS.MAX_OCC` = 4000,佔 1.2%);實測 5 段只比 4 段再省 4% 體積 ⇒ 取 4。
  PROF_BANDS: 16,
  PROF_SLABS: 4,
  // **變形上限**(2026-08-12 使用者定案「管線最後要再加入調整目標物件到適合的大小,
  // 避免放在遊戲後看起來真實感太差」的消費端那一半)。
  // 消費端是拿**單位方盒**逐實例 scale(w,h,d),而節點的自然平面長寬比是量出來的
  // (mass_a 0.90 / mass_b 0.276 / mass_c 1.01 / masslow_a 0.70 / masslow_b 1.75)——
  // 把 0.276 的薄板塞進正方形基地就是橫向拉 3.6 倍,窗格與退縮階跟著糊掉。
  // ⇒ 指派時逐棟挑「拉伸最小」的那一顆(允許整顆轉 90°,自然比取倒數),**超過上限就不換**
  // (退回方盒 = 既有那條路,原則 6 寧缺勿錯)。1.6 與 STOREY 那條「合理差異範圍」同一個
  // 量級:再寬就看得出來是被拉過的。
  ASPECT_MAX: 1.6,
  // 同分帶:落在最佳拉伸 `PICK_TOL` 倍內的節點視為同樣好,再由落點雜湊挑一顆
  // ——純取最小值的話同一種基地永遠拿到同一顆,天際線又變成一個剪影(名冊輪替的初衷)。
  PICK_TOL: 1.15,
};

/**
 * 剖面 → **保險絲幾何**(一疊方盒;`bldProfile` 檔頭紀律 ②)。
 * 庫載不到時畫的就是這一顆 —— 與碰撞柱吃**同一份剖面** ⇒ 不論載不載得到,
 * 看到的與撞到的都是同一個形狀(舊制保險絲是單顆方盒,而碰撞柱這一輪已經改成剖面 ⇒
 * 不同源的話,沒載到庫的那台客戶端會看到一面走得過去的牆)。
 * UV 逐面**盒投影 + 三帶**,規則與 `normalize_parts.py --uvbands` 逐條相同:
 * 分兩份寫就是「牆對得上、屋頂差一條縫」(那條註解的同一個坑)。
 */
function profGeo(prof, uvb) {
  const { roof, plain } = uvb;
  const pos = [], nor = [], uv = [], idx = [];
  const cl = (v) => Math.min(1, Math.max(0, v));
  for (const [y0, y1, hw, hd] of prof.slabs) {
    const cy = (y0 + y1) / 2, hh = (y1 - y0) / 2;
    // 逐面 [法線, u 切向, v 切向];MUST 是右手系(u × v = n),否則那一面背朝外 = 從外面看穿
    const FACES = [
      [[1, 0, 0], [0, 0, -1], [0, 1, 0], hd, hh],
      [[-1, 0, 0], [0, 0, 1], [0, 1, 0], hd, hh],
      [[0, 1, 0], [1, 0, 0], [0, 0, -1], hw, hd],
      [[0, -1, 0], [1, 0, 0], [0, 0, 1], hw, hd],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0], hw, hh],
      [[0, 0, -1], [-1, 0, 0], [0, 1, 0], hw, hh],
    ];
    for (const [n, tu, tv, hu, hv] of FACES) {
      const c = [n[0] * hw, cy + n[1] * hh, n[2] * hd];
      const b = pos.length / 3;
      for (const [du, dv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = c[0] + tu[0] * du * hu + tv[0] * dv * hv;
        const y = c[1] + tu[1] * du * hu + tv[1] * dv * hv;
        const z = c[2] + tu[2] * du * hu + tv[2] * dv * hv;
        pos.push(x, y, z);
        nor.push(n[0], n[1], n[2]);
        // 盒投影:±X 面 u←z、其餘 u←x;±Y 面 v←z、其餘 v←y(與 normalize_parts 同式)
        const u2 = n[0] ? z + 0.5 : x + 0.5;
        let v2 = cl(n[1] ? z + 0.5 : y + 0.5);
        // 三帶:朝上→屋頂帶、朝下→素牆帶、近垂直→窗牆帶(方盒沒有傾斜面)。
        // 2026-08-13 那條「還要完全平整」對這裡是**恆真**:一疊方盒的側面每一面都是單一
        // 平面矩形 ⇒ 法線與自己那一群逐位元相同。規則沒有第二份,只是這一端不必判。
        if (n[1] > MASS.UVB.MINZ) v2 *= roof;
        else if (Math.abs(n[1]) > MASS.UVB.WALL_NY) v2 = roof + v2 * plain;
        else v2 = roof + plain + v2 * (1 - roof - plain);
        uv.push(cl(u2), v2);
      }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// 桶建構表(凍結四桶:煙囪/水塔/空調機組/整棟量體):單位 primitive 保險絲 + 桶色 +
// InstancedMesh 一次定案在這裡。
// 兩個消費端:①下方一般建物繪製段的四個桶(遊戲內唯一呼叫點);②`tools/parts_review`
// 3D 零件對照台(dev-only、唯讀,count=1 取樣)—— 台上另抄 primitive/桶色就是第二套
// 組裝器(runbook §7 紀律 ①),它壞掉的樣子是「對照台上的原版與遊戲裡的不是同一個東西」。
export const buildBldBucket = {
  chimney: (n) => new THREE.InstancedMesh(bldGeo('chimney') || new THREE.BoxGeometry(1, 1, 1), bmat(0x9a5a44, { wash: 0.5 }), n),
  tank: (n) => new THREE.InstancedMesh(bldGeo('tank') || new THREE.CylinderGeometry(1, 1, 1, 8), bmat(0xb0b8be), n),
  acbox: (n) => new THREE.InstancedMesh(bldGeo('acbox') || new THREE.BoxGeometry(1, 1, 1), bmat(0x8a9096), n),
  // 整棟量體:材質由呼叫端傳入 —— 立面貼圖是**逐立面款**現做的(窗格 + 夜間自發光),
  // 這裡自己 new 一份就是第二套立面材質,而症狀是「那幾棟高樓晚上不亮」。庫節點是單一
  // 群組 ⇒ three 取材質陣列的第 0 格,故傳單一 wall 材質即可(頂面也吃立面貼圖,是
  // 刻意的取捨:換到的是最高的十幾棟,俯視看得到頂面的機會遠低於「晚上不亮」的代價)。
  // 節點契約因此多一條:匯出端 MUST 給**盒投影 UV**(沿用原 BoxGeometry 的 0..1 逐面
  // 慣例),否則整棟只採到 (0,0) 那一個 texel = 一塊沒有窗的純色板。**方向也是契約的一部分**
  // (2026-08-09):v MUST 隨高度遞增 —— glTF 的 UV 原點在左上、Blender 在左下,匯出端會把 v
  // 翻過來,而消費端這張 `CanvasTexture` 的 `flipY` 是預設的 true ⇒ 不補償的話庫節點的立面
  // 是**上下顛倒**的(基座暗帶印在屋簷、遮陽棚印在頂樓),而方盒那條路走 BoxGeometry 自己的
  // UV 是正的 = 同一張圖上兩種方向,沒有任何錯誤訊息。兩桶自 2026-08-12 起都吃**三帶**
  // (`MASS.UVB`:屋頂 / 素牆 / 窗牆),見那一段檔頭。
  // 對照台(count = 1 取樣)不傳材質 ⇒ 退回素色,只看幾何。
  // `key` = 哪一個整棟量體名冊('mass' 高層 / 'masslow' 低矮):兩桶只差名冊與挑選規則,
  // 幾何/材質/保險絲逐條相同 ⇒ **一份實作**。另開一支 `masslow:` 就是第二套桶建構器,
  // 而它壞掉的樣子是「低矮那一桶的保險絲跟高層的不一樣」。
  // **保險絲改吃剖面**(2026-08-12):庫載不到時畫的那顆由 `bldProfile` 疊出來,與碰撞柱
  // 同源 ⇒ 看到的與撞到的恆為同一個形狀(舊制是單顆方盒,而碰撞柱這一輪已改成剖面)。
  // 連剖面都沒宣告(舊名冊 / 新開的桶)才退回單位方盒 —— 那是保險絲的保險絲。
  mass: (n, mat, i = 0, key = 'mass') => {
    const prof = bldProfile(key, i);
    const geo = bldGeo(key, i) || (prof ? profGeo(prof, MASS.UVB[key] || MASS.UVB.mass) : new THREE.BoxGeometry(1, 1, 1));
    return new THREE.InstancedMesh(geo, mat || bmat(0xb9b3a8, { wash: 0.5 }), n);
  },
};

// 巨岩的三支建構器**具名匯出**(2026-08-06):第二個消費端 = `tools/parts_review`(3D 零件
// 對照台,dev-only、唯讀)。MEGA_LIB 的節點只長在命令式建造端 ⇒ 台上要拿「同一顆座號的
// 保險絲版 vs 零件庫版」並排,唯一正當的取得方式就是呼叫**遊戲自己的這三支** —— 台子那邊
// 抄一份組裝順序就是「第二套組裝器」,而它壞掉的樣子是「對照台上的原版跟遊戲裡的原版不是
// 同一個東西」,兩邊都不報錯(紀律 ①)。匯出只是可見性,呼叫端與行為逐位元不變;
// placeMegaliths 仍是遊戲內唯一的呼叫點。
export function decorateMegalith(g, anchor, rnd, s) {
  if (!anchor) return;
  const probe = rockProbe(g);
  const k = 1 / s;
  // 局部亂數(2026-08-05):以「已抽出的那枚共享亂數值」為種子起一條獨立序列 —— 特徵內部
  // 的尺寸/比例走樣全走這一條,**不增減共享 rnd 的枚數**(§2.3:多抽一枚就把整張圖後續
  // 佈局整條推移)。同一顆岩的同一件特徵,全房逐位元同值。舊制石屋/疊石/鳥巢的尺寸全是
  // 常數,每顆巨岩上的石屋一模一樣(單調成因)。
  const lrng = (v) => {
    let a = (((v * 4294967296) | 0) ^ 0x9E3779B9) >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const put = (obj, x, y, z, sc = 1) => {
    obj.scale.multiplyScalar(sc * k);
    obj.position.set(x, y, z);
    g.add(obj);
  };
  // 小型特徵不描邊:一顆岩體可掛十餘件,省下反轉殼 draw call
  const noOut = (grp) => { grp.traverse((o) => { if (o.isMesh) o.userData.noOutline = true; }); return grp; };
  const nest = (lr) => {   // 鳥巢:枝條環 + 蛋 + 停棲的鳥(環徑/蛋徑逐巢走樣)
    const n = new THREE.Group();
    const rv2 = 0.9 + lr() * 0.25;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.3, 5, 8), toonMat(0x6a5138));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.15; ring.scale.setScalar(rv2); n.add(ring);
    for (let e = 0; e < 3; e++) {
      // 蛋窩在巢底:ico 最低頂點在 −0.851r ⇒ 心高 = 0.851r 才剛好躺在巢盤上(抬高就是浮在巢裡);
      // 蛋徑走樣後心高 MUST 跟著縮放比例走(0.17 × esc),縮小的蛋才不會浮在巢盤上
      const esc = 0.85 + lr() * 0.35;
      const egg = new THREE.Mesh(ico(0.2), toonMat(0xf2ead6));
      egg.position.set((lr() - 0.5) * 0.6, 0.17 * esc, (lr() - 0.5) * 0.6);
      egg.scale.setScalar(esc);
      n.add(egg);
    }
    if (lr() < 0.5) {   // 與 cliffPlant 的傘色同一條:`lr` 是這一巢自己的種子,共用 rnd 會分家
      const bird = new THREE.Mesh(cone(0.3, 0.8, 4), toonMat(0x4a586a));
      bird.position.set(0.7, 0.5, 0); bird.rotation.z = -0.4; n.add(bird);
    }
    return noOut(n);
  };
  const stoneHut = (lr) => {   // 石砌屋:石牆 + 石板頂 + 煙囪 + 木門(尺寸/開口逐間走樣)
    const hg = new THREE.Group();
    const w = 3.9 + lr() * 0.7, d = 3.1 + lr() * 0.6, rh = 2.1 + lr() * 0.6;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, 3, d), rockMat(0x9c9480));
    body.position.y = 1.5; hg.add(body);
    // 四角錐石板頂:角距 = 半寬 + 簷口(推導不手寫),z 向縮回進深比例
    const roof = new THREE.Mesh(cone((w / 2 + 0.24) * Math.SQRT2, rh, 4), rockMat(0x6e5a44));
    roof.rotation.y = Math.PI / 4; roof.scale.z = (d / 2 + 0.24) / (w / 2 + 0.24);
    roof.position.y = 3 + rh / 2; hg.add(roof);
    if (lr() < 0.85) {
      const ch = 1.4 + rh * 0.35;
      const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.7, ch, 0.7), rockMat(0x8a8274));
      chimney.position.set((lr() < 0.5 ? 1 : -1) * w * 0.28, 3.6 + ch / 2, (lr() < 0.5 ? 1 : -1) * d * 0.18);
      hg.add(chimney);
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.8, 0.2), toonMat(0x4a3a2a));
    door.position.set((lr() - 0.5) * 0.8, 0.9, (lr() < 0.5 ? 1 : -1) * (d / 2 + 0.05));
    hg.add(door);
    return hg;
  };
  const cairn = (lr) => {   // 疊石堆(登頂紀念):顆數/塊徑/錯位逐堆走樣
    const cg = new THREE.Group();
    const n = 3 + Math.floor(lr() * 3);        // 3~5 顆
    let y = 0, r = 0.78 + lr() * 0.34;
    for (let i = 0; i < n; i++) {
      const g2 = megaGeo(MEGA_LIB.block[i % NBLK]);
      const st = new THREE.Mesh(g2 || ico(r), rockMat(0x8f8a80));
      if (g2) st.scale.set(r, r * 0.7, r); else st.scale.y = 0.7;
      // 疊層錯位:上層小石在 ±12% 半徑內偏移(深交疊不開縫);底石不偏(落座)
      const ex = i ? (lr() - 0.5) * 0.24 * r : 0, ez = i ? (lr() - 0.5) * 0.24 * r : 0;
      y += r * 0.7; st.position.set(ex, y, ez); y += r * 0.36;
      st.rotation.y = lr() * Math.PI;
      cg.add(st);
      r *= 0.62 + lr() * 0.16;
    }
    return noOut(cg);
  };
  // 峭壁樹/岩菇:基部 = 「彎曲水管」式圓弧彎頭 —— 等長等徑圓管沿圓弧等角步進、
  // 節間塞關節球蓋接縫;入壁角 bend 依壁面斜率(垂直壁 = 90° 彎頭、斜壁彎得少),
  // 出彎後幹身直立、樹冠/蕈傘恆朝上(向光性)。放置只繞 Y 對齊方位,
  // MUST NOT 整棵外傾 —— 「冠部朝上」是規格,不是姿態變化。
  const cliffPlant = (mush, bend, lr) => {
    const t = new THREE.Group();
    const stemC = mush ? 0xd6cba8 : 0x6b4a30;
    const nSeg = Math.max(2, Math.round(bend / 0.32));   // 每 ~18° 一節:90° 彎頭約 5 節
    const segL = 1.05, pipeR = mush ? 0.42 : 0.36;       // 水管:等徑,不收分
    // 起點沿入壁方向反推埋進壁內,彎出來才像「自岩縫鑽出」
    let jx = -Math.sin(bend) * 0.8, jy = -Math.cos(bend) * 0.8 - 0.1;
    const kneeAt = (x, y) => {
      const knee = new THREE.Mesh(ico(pipeR * 1.04), toonMat(stemC));
      knee.position.set(x, y, 0);
      t.add(knee);
    };
    kneeAt(jx, jy);
    for (let i = 0; i < nSeg; i++) {
      const phi = bend * (1 - (i + 0.5) / nSeg);         // 等角步進 = 圓弧彎頭(+x = 壁外)
      const seg = new THREE.Mesh(cyl(pipeR, pipeR, segL, 6), toonMat(stemC));
      seg.position.set(jx + Math.sin(phi) * segL / 2, jy + Math.cos(phi) * segL / 2, 0);
      seg.rotation.z = -phi;
      t.add(seg);
      jx += Math.sin(phi) * segL; jy += Math.cos(phi) * segL;
      kneeAt(jx, jy);
    }
    if (mush) {   // 岩菇:蕈柄彎附岩壁,蕈傘水平朝上 + 傘底淺色菌褶(傘徑/傘色逐朵走樣)
      // 傘色 MUST 走**局部** `lr()`(這一朵自己的種子),MUST NOT 用共用 `rnd()`:
      // cliffPlant 只在 `rockProbe` 實測到壁面時才跑(`er == null` 就 continue)⇒ 幾何一換
      // 跑到的朵數就變,共用序列被多抽/少抽幾枚 ⇒ 有沒有載到零件庫會走出兩條佈局
      // (§2.3 / A4)。2026-08-06 由 measure_megalith_tris 的枚數對帳抓到:整座型節點
      // 上線後 50/200 顆分家,而只有 block 名冊時也已經有 1/200 —— 沒有任何錯誤訊息。
      const capC = [0xc25c4a, 0xd8a04a, 0x8a6ab8, 0xb8556e, 0x6a9a4e][Math.floor(lr() * 5)];
      const capR = 1.45 + lr() * 0.45, capH = 1.0 + lr() * 0.25;
      const cap = new THREE.Mesh(cone(capR, capH, 8), toonMat(capC));
      cap.position.set(jx, jy + 0.72, 0); t.add(cap);
      const gill = new THREE.Mesh(cyl(capR * 0.72, capR * 0.81, 0.3, 8), toonMat(0xe8dfc0));
      gill.position.set(jx, jy + 0.15, 0); t.add(gill);
    } else {      // 峭壁松:直立樹幹(接續水管徑,向上收分)+ 疊層樹冠(層數/層徑/微傾逐株走樣;
                  // sakura-crossing:「正圓正放的錐是一疊燈罩」—— 每層橢圓化 + 傾斜才是樹)
      const trunk = new THREE.Mesh(cyl(0.22, pipeR, 2.2, 6), toonMat(stemC));
      trunk.position.set(jx, jy + 1.1, 0); t.add(trunk);
      const c1r = 1.75 + lr() * 0.4, c1h = 3.0 + lr() * 0.5;
      const c1 = new THREE.Mesh(cone(c1r, c1h, 6), toonMat(0x2f5e40));
      c1.position.set(jx, jy + 1.6 + c1h / 2, 0); c1.scale.z = 0.86 + lr() * 0.28; t.add(c1);
      const c2h = 2.3 + lr() * 0.4, c2b = 1.6 + c1h - (0.9 + lr() * 0.2);
      const c2 = new THREE.Mesh(cone(c1r * 0.68, c2h, 6), toonMat(0x35684a));
      c2.position.set(jx, jy + c2b + c2h / 2, 0);
      c2.scale.z = 0.86 + lr() * 0.28; c2.rotation.z = (lr() - 0.5) * 0.12; t.add(c2);
      if (lr() < 0.45) {   // 第三層冠(高株):天際線多一段鋸齒
        const c3h = 1.7 + lr() * 0.3;
        const c3 = new THREE.Mesh(cone(c1r * 0.45, c3h, 6), toonMat(0x2f5e40));
        c3.position.set(jx, jy + c2b + c2h - 0.7 + c3h / 2, 0);
        c3.rotation.z = (lr() - 0.5) * 0.12; t.add(c3);
      }
    }
    return t;
  };

  const topWorldY = anchor.topY * s;
  const topRW = anchor.topR * s;   // 頂面半徑(世界公尺;特徵尺寸也是世界公尺,同單位才能比)
  // 腳印夾算:want = 想要的世界尺寸,foot = 該特徵世界腳印半徑(sc=1 時)。
  // 塞不下 → 縮到剛好;縮到 lo 仍塞不下 → 回傳 0 = 放棄。偏移(local)夾在剩餘空間內。
  const fit = (want, foot, lo) => {
    const sc = Math.min(want, topRW / foot);
    return sc >= lo ? sc : 0;
  };
  const margin = (sc, foot) => Math.max(0, anchor.topR - foot * sc / s);
  // 頂面落座:回傳該 (x,z) 的**實測**頂面高;腳印四角任一射不到岩體、或比中心低超過
  // SEAT_DROP(世界公尺)= 腳印懸出頂緣 ⇒ 回傳 null 不放(§4 寧缺勿錯)。
  const SEAT_DROP = 1.0;
  const seat = (x, z, footW, sc) => {
    const y0 = probe.topAt(x, z);
    if (y0 == null) return null;
    const f = footW * sc / s;   // 世界腳印半徑 → 岩體 local
    for (const [ox, oz] of [[f, 0], [-f, 0], [0, f], [0, -f]]) {
      const yc = probe.topAt(x + ox, z + oz);
      if (yc == null || (y0 - yc) * s > SEAT_DROP) return null;
    }
    return y0;
  };
  if (topWorldY > 45 && rnd() < 0.5) {                       // 高壓電塔:夠高的頂才架線
    const sc = fit(0.55 + rnd() * 0.25, 8.5, 0.28);
    if (sc) {
      const m = margin(sc, 8.5);
      const px = (rnd() - 0.5) * m, pz = (rnd() - 0.5) * m;
      const y = seat(px, pz, 8.5, sc);
      if (y != null) {
        const pylon = new THREE.Group();
        LANDMARKS.power(pylon);
        put(pylon, px, y - 1 / s, pz, sc);   // 塔腳沉 1m(世界)進岩面
      }
    }
  }
  if (rnd() < 0.7) {                                         // 石砌屋 1~2 間
    const n = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const sc = fit(0.9 + rnd() * 0.5, 3.2, 0.4);
      if (!sc) break;
      // 局部種子 = 既抽的轉角值(枚數不變;i 錯開讓同顆兩間石屋不同款)
      const rv = rnd();
      const h = stoneHut(lrng(rv + i * 0.618));
      h.rotation.y = rv * Math.PI * 2;
      const m = margin(sc, 3.2);
      const px = (rnd() - 0.5) * m, pz = (rnd() - 0.5) * m;
      const y = seat(px, pz, 3.2, sc);
      if (y != null) put(h, px, y - 0.3 / s, pz, sc);
    }
  }
  if (rnd() < 0.7) {                                         // 疊石堆
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const wv = rnd();
      const sc = fit(1 + wv * 0.8, 1.2, 0.45);
      if (!sc) break;
      const m = margin(sc, 1.2);
      const px = (rnd() - 0.5) * m * 1.6, pz = (rnd() - 0.5) * m * 1.6;
      const y = seat(px, pz, 1.2, sc);
      if (y != null) put(cairn(lrng(wv + i * 0.618)), px, y - 0.2 / s, pz, sc);
    }
  }
  {   // 鳥巢:先鋪一塊「平坦面朝正上」的岩台,鳥巢放台上(圓頂/窄頂也有水平落腳)
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const sc = fit(1 + rnd() * 0.8, 2.0, 0.4);
      if (!sc) break;
      const av = rnd();
      const a = av * Math.PI * 2;
      const rr = Math.min(anchor.topR * 0.8, margin(sc, 2.0));   // 沿頂緣一圈,但不掉出頂面
      const px = Math.cos(a) * rr, pz = Math.sin(a) * rr;
      const y = seat(px, pz, 2.0, sc);
      if (y == null) continue;
      const lr = lrng(av + i * 0.618);
      const pv = 0.85 + lr() * 0.25;   // 岩台走樣(上限收在 foot 2.0 內)
      const grp = new THREE.Group();
      const pad = new THREE.Mesh(cyl(1.5 * pv, 1.8 * pv, 0.55, 7), rockMat(0x8f8a80));
      pad.position.y = 0.28; grp.add(pad);
      const ne = nest(lr);
      ne.position.y = 0.56; grp.add(ne);
      noOut(grp);
      put(grp, px, y - 0.35 / s, pz, sc);
    }
  }
  // 峭壁樹/岩菇:side = 單一側壁或柱群陣列(只描述「可附著的柱心與高度帶」);
  // 壁面半徑與斜率一律走 rockProbe 實測(MUST NOT 退回剖面公式 —— 見 rockProbe 檔頭)。
  const sides = Array.isArray(anchor.side) ? anchor.side : anchor.side ? [anchor.side] : [];
  if (sides.length) {
    const n = 2 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const sd = sides[Math.floor(rnd() * sides.length)];
      const a = rnd() * Math.PI * 2;
      const y = sd.y[0] + rnd() * (sd.y[1] - sd.y[0]);
      const u = y / Math.max(1, anchor.topY);
      const mush = rnd() < (u < 0.4 ? 0.5 : 0.15);   // 低處背陰長菇,高處長松
      const scv = rnd();                             // 亂數照抽(淘汰排在抽樣之後 ⇒ 序列不漂)
      const sc = 0.8 + scv * 0.8;
      const px = sd.px || 0, pz = sd.pz || 0;
      const er = probe.wallR(px, pz, y, a);
      if (er == null) continue;                      // 該方位沒有壁面(拱洞/柱間空隙)⇒ 不放
      // 入壁彎角依**實測**壁面斜率:直壁 = 90° 彎頭、球面肩部/斜壁彎得少
      const t = cliffPlant(mush, Math.PI / 2 - Math.atan(probe.slope(px, pz, y, a)), lrng(scv + i * 0.618));
      t.rotation.set(0, -a, 0);   // 只轉方位;彎的是水管基部,冠永遠朝上
      put(t, px + Math.cos(a) * er, y, pz + Math.sin(a) * er, sc);
    }
  }
}

// ---- 合成巨岩:抽組名岩「特徵基因」隨機重組,每顆獨一無二 ----
// 主體(圓頂=烏魯魯系/岩壁=酋長岩系/岩層塔=大霸系/尖峰/天然岩拱/平頂桌山/
// 蘑菇岩群=風化 hoodoo/刃狀岩脊)× 伴生小圓丘 × 崩落岩塊 × 侵蝕溝 × 碎石坡 ×
// 鑿面稜線 × 岩色系(18 色);回傳 col/anchor 供放置與表面特徵。
const ROCK_TONES = [0xb3502e, 0xc9c4b8, 0x9a6248, 0x6f6a62, 0xa8875c, 0x8f8878,
                    0xd8b878, 0xc49a8a, 0x5a6470, 0xd4cdb8, 0x7a6a52, 0x996a3e,
                    0x4a4a52, 0xb87850, 0xd8c890, 0x7a8a92, 0x8a7a88, 0x6a5a44];
export function synthMegalith(g, rnd) {
  const base = new THREE.Color(ROCK_TONES[Math.floor(rnd() * ROCK_TONES.length)]);
  const shade = (dl) => base.clone().offsetHSL(0, 0, dl).getHex();
  const moss = rnd() < 0.55 ? 0.2 + rnd() * 0.35 : 0;
  // basalt/granite/marble(2026-07-12):多塊大石拼接 —— 依真實岩石節理各有拼法:
  // 玄武岩 = 柱狀節理(高低參差的六角/方/圓柱束,巨人堤道式);
  // 花崗岩 = 大塊方料錯縫整齊疊置(節理稀疏 → 巨大規則岩塊,tor 岩堆);
  // 大理岩 = 大小互異的渾圓岩塊堆疊互倚(溶蝕圓稜,大塊在下小塊在上)
  const kinds = ['dome', 'slab', 'tower', 'spire', 'arch', 'mesa', 'hoodoo', 'fin',
                 'basalt', 'granite', 'marble'];
  const main = kinds[Math.floor(rnd() * kinds.length)];
  let H = 0, RX = 0, RZ = 0, topR = 6;
  // 側壁錨點逐型定義(null = 該型側壁放不了樹):只描述**可附著的柱心 px/pz 與高度帶 y**,
  // 壁面半徑與斜率一律由 `rockProbe` 實測 —— 手寫橢圓/收縮剖面永遠追不上多面體實際外廓。
  let sideDef = null, topYA = null, topRA = null;
  // 鑿面:斜切稜面貼在量體側緣,把圓弧/平板打成手雕硬邊(botw_plan Task 1.1)
  const chisel = (n, rx, rz, hh) => {
    for (let i = 0; i < n; i++) {
      const fw = 8 + rnd() * 12;
      const facet = new THREE.Mesh(rockFrustum(fw, fw * 0.8, fw * 0.5, fw * 0.4, fw * 0.8, 0.4, 0.4), rockMat(shade(0.04 + rnd() * 0.06), moss * 0.5));
      const a = rnd() * Math.PI * 2;
      facet.position.set(Math.cos(a) * rx * 0.7, hh * (0.3 + rnd() * 0.4), Math.sin(a) * rz * 0.7);
      facet.rotation.set(rnd() * 0.8, rnd() * Math.PI, rnd() * 0.8);
      g.add(facet);
    }
  };
  if (main === 'dome') {
    const r = 28 + rnd() * 26, sx = 1.1 + rnd() * 0.7, sy = 0.7 + rnd() * 0.55, sz = 0.8 + rnd() * 0.3;
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 11, 8), rockMat(shade(0), moss));
    m.scale.set(sx, sy, sz); m.position.y = 3; g.add(m);
    H = 3 + r * sy; RX = r * sx; RZ = r * sz; topR = Math.min(RX, RZ) * 0.35;
    sideDef = { y: [H * 0.22, H * 0.8] };
    chisel(2 + Math.floor(rnd() * 2), RX, RZ, H);
  } else if (main === 'slab') {
    const w = 30 + rnd() * 26, h = 70 + rnd() * 50, d = 16 + rnd() * 12;
    const m = new THREE.Mesh(rockFrustum(w, d, w * 0.82, d * 0.78, h, 1.2, 0.8), rockMat(shade(0), moss));
    m.position.y = h / 2; m.rotation.y = (rnd() - 0.5) * 0.2; g.add(m);
    const nose = new THREE.Mesh(rockFrustum(w * 0.45, d * 0.8, w * 0.32, d * 0.6, h * 0.8, 0.8, 0.4), rockMat(shade(0.04), moss));
    nose.position.set(w * 0.36, h * 0.4, d * 0.2); nose.rotation.y = 0.45; g.add(nose);
    H = h; RX = w * 0.62; RZ = d * 0.8; topR = Math.min(w, d) * 0.32;
    sideDef = { y: [H * 0.25, H * 0.75] };
    chisel(2 + Math.floor(rnd() * 3), RX, RZ, H * 0.8);
  } else if (main === 'tower') {
    const r0 = 17 + rnd() * 8, bh = 24 + rnd() * 14;
    // 整座庫節點(實拍魔鬼塔:崖錐 + 柱身同一顆)?? 原「錐 + 疊層圓柱」——
    // **兩條路的 rnd() 枚數逐位元相同**:下面那個迴圈照跑(它負責消耗亂數並把 y/r 推到
    // 終值,而 H/topR/sideDef 全由 y/r 決定),只有「要不要 add 進場景」分岔。少了這一點,
    // 有沒有載到零件庫就會讓後面每一顆巨岩、每一株植被的落點整條位移(§2.3 / A4)。
    const gT = megaGeo(MEGA_LIB.tower);
    const baseC = new THREE.Mesh(cone(r0 * 2.2, bh, 9), rockMat(shade(0.03), 0.35));
    baseC.position.y = bh / 2; if (!gT) g.add(baseC);
    // 柱基自錐體半高起(該處錐半徑 1.1×r0 ≥ 柱半徑)—— 柱是「從山裡長出來」,
    // 不是擱在山尖上;柱基寬過錐面 = 懸挑,物理不成立(魔鬼塔的崖錐與柱身相接)
    let y = bh * 0.5, r = r0;
    const nL = 5 + Math.floor(rnd() * 3);
    for (let i = 0; i < nL; i++) {
      const band = i % 2 === 1, hh = band ? 3.5 : 9 + rnd() * 5;
      const st = new THREE.Mesh(cyl(r * (band ? 1.06 : 1), r * (band ? 1.06 : 1) + 1, hh, 10),
        rockMat(shade(band ? 0.06 : -0.03), band ? 0.12 : 0));
      st.position.y = y + hh / 2; y += hh; if (!gT) g.add(st);
      if (!band) r *= 0.92;
    }
    H = y; RX = RZ = r0 * 2.0; topR = r * 0.85;   // footprint 含 2.2×r0 山腳崖錐
    if (gT) {   // 單位包絡 → 撐滿這一顆的 footprint 與高度(佈局值 H/RX/RZ 仍由上面推導)
      const pil = new THREE.Mesh(gT, rockMat(shade(0), moss * 0.5));
      pil.scale.set(RX, H / 2, RZ); pil.position.y = H / 2; g.add(pil);
    }
    sideDef = { y: [bh, H * 0.85] };   // 柱身段(崖錐以上)
  } else if (main === 'arch') {   // 天然岩拱:雙墩 + 頂樑 + 拱背圓丘
    const span = 26 + rnd() * 14, ph = 34 + rnd() * 22, pw = 10 + rnd() * 5;
    const cols = [];
    for (const sgn of [-1, 1]) {
      const pier = new THREE.Mesh(rockFrustum(pw * 1.08, pw * 1.35, pw * 0.88, pw * 1.12, ph, sgn * 0.4, 0), rockMat(shade(sgn * 0.03), moss));
      pier.position.set(sgn * span / 2, ph / 2, 0); pier.rotation.y = sgn * 0.15; g.add(pier);
      // 兩座橋墩各自是可附著側壁(內縮吃掉 ±0.15 微轉),樹菇長在墩壁不掛拱洞
      cols.push({ px: sgn * span / 2, pz: 0, y: [ph * 0.15, ph * 0.8] });
    }
    sideDef = cols;
    const beam = new THREE.Mesh(rockFrustum(span + pw * 1.6, pw * 1.1, span + pw * 1.35, pw * 0.9, pw * 0.9, 0, 0), rockMat(shade(0.05), moss));
    beam.position.y = ph + pw * 0.45; g.add(beam);
    const hump = new THREE.Mesh(new THREE.SphereGeometry(pw * 0.9, 8, 6), rockMat(shade(0.02), moss));
    hump.scale.set((span + pw) / (pw * 1.8), 0.7, 1); hump.position.y = ph + pw * 0.8; g.add(hump);
    H = ph + pw * 1.3; RX = span / 2 + pw; RZ = pw * 1.4; topR = 3;
  } else if (main === 'mesa') {   // 平頂桌山:裙狀崖錐 + 疊層 + 開闊平頂
    const r0 = 30 + rnd() * 22, h = 40 + rnd() * 26;
    // 整座庫節點(實拍平頂岩體:裙狀崖錐 + 疊層同一顆)?? 原「錐 + 三段疊層」——
    // 這一支的疊層迴圈**本來就零 rnd()**(逐層係數是靜態表),故兩條路的亂數枚數天然相同;
    // 仍照跑迴圈是為了讓 y 推到終值(H/sideDef 讀它)。
    const gM = megaGeo(MEGA_LIB.mesa);
    const skirt = new THREE.Mesh(cone(r0 * 2.2, h * 0.62, 10), rockMat(shade(0.05), 0.3));
    skirt.position.y = h * 0.31; if (!gM) g.add(skirt);
    let y = h * 0.3;
    for (const [f, hh, dl] of [[1.12, h * 0.22, -0.04], [1.04, h * 0.16, 0.05], [1.0, h * 0.32, -0.02]]) {
      const st = new THREE.Mesh(cyl(r0 * f * 0.94, r0 * f, hh, 10), rockMat(shade(dl)));
      st.position.y = y + hh / 2; y += hh; if (!gM) g.add(st);
    }
    H = y; RX = RZ = r0 * 2.0; topR = r0 * 0.8;   // footprint 含 2.2×r0 裙狀崖錐
    if (gM) {
      const tbl = new THREE.Mesh(gM, rockMat(shade(0), moss * 0.4));
      tbl.scale.set(RX, H / 2, RZ); tbl.position.y = H / 2; g.add(tbl);
    }
    sideDef = { y: [H * 0.4, H * 0.9] };   // 疊層段(裙狀崖錐以上)
  } else if (main === 'hoodoo') {   // 風化蘑菇岩群:細腰石柱頂著過寬帽岩
    const n = 2 + Math.floor(rnd() * 3);
    const cols = [];
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, d = i === 0 ? 0 : 14 + rnd() * 20;
      const px = Math.cos(a) * d, pz = Math.sin(a) * d;
      const h = 26 + rnd() * 30, r = 5 + rnd() * 4;
      // 整柱庫節點(實拍 hoodoo)?? 頸+帽兩件程序生成 —— 兩條路都零 rnd,枚數不變
      const g2 = megaGeo(MEGA_LIB.hoodoo);
      if (g2) {
        const pil = new THREE.Mesh(g2, rockMat(shade(0.03)));
        pil.scale.set(r * 1.5, h * 0.55, r * 1.5);
        pil.position.set(px, h * 0.55, pz); g.add(pil);
      } else {
        const neck = new THREE.Mesh(cyl(r * 0.55, r, h, 8), rockMat(shade(0.03)));
        neck.position.set(px, h / 2, pz); g.add(neck);
        const cap = new THREE.Mesh(cyl(r * 1.5, r * 0.9, h * 0.16, 8), rockMat(shade(-0.08), 0.15));
        cap.position.set(px, h * 1.02, pz); g.add(cap);
      }
      // 頂錨綁「中央柱」帽岩頂面(特徵放置以原點為準;掛在群體最高點必懸空)
      if (i === 0) { topYA = h * 1.1; topRA = r * 1.1; }
      // 每根柱各自是一面可附著側壁(頸部上收 55%),樹菇/侵蝕溝貼各柱的壁
      cols.push({ px, pz, y: [h * 0.15, h * 0.8] });
      H = Math.max(H, h * 1.1);
      RX = RZ = Math.max(RX, d + r * 1.5);
    }
    sideDef = cols;
    topR = 3;
  } else if (main === 'fin') {   // 刃狀岩脊:一列薄板岩沿走向漸縮、微錯位
    const n = 3 + Math.floor(rnd() * 3);
    const cols = [];
    let px = -(n - 1) * 8;
    for (let i = 0; i < n; i++) {
      const f = 1 - Math.abs(i - (n - 1) / 2) / n;   // 中央最高
      const h = (55 + rnd() * 45) * (0.55 + f * 0.45), w = 12 + rnd() * 6, d = 5 + rnd() * 4;
      const bz = (rnd() - 0.5) * 6;
      const blade = new THREE.Mesh(rockFrustum(w, d * 1.15, w * 0.85, d * 0.55, h, 0.6, 0), rockMat(shade((rnd() - 0.5) * 0.1), moss * f));
      blade.position.set(px, h / 2, bz);
      blade.rotation.y = (rnd() - 0.5) * 0.3;
      blade.rotation.z = (rnd() - 0.5) * 0.1;
      g.add(blade);
      // 每片刃岩自成一面側壁(略內縮吃掉微轉/微傾的誤差),樹菇貼刃面長
      cols.push({ px, pz: bz, y: [h * 0.15, h * 0.7] });
      H = Math.max(H, h);
      RX = Math.max(RX, Math.abs(px) + w);
      px += 14 + rnd() * 5;
    }
    sideDef = cols;
    RZ = 12; topR = 4;
    topYA = 0.2; topRA = 4;   // 刃嶺頂是一排參差薄脊,頂面特徵落地放刃間
  } else if (main === 'basalt') {   // 柱狀玄武岩束:高低參差的六角/方/圓柱拼接
    base.set([0x4a4e55, 0x3f4246, 0x565a62, 0x4e4a44][Math.floor(rnd() * 4)]);   // 玄武岩深灰
    const R0 = 16 + rnd() * 10, hMax = 34 + rnd() * 30;
    const nCol = 10 + Math.floor(rnd() * 8);
    for (let i = 0; i < nCol; i++) {
      // 徑向擠壓排列:中央最高、外圈遞減 = 管風琴輪廓(巨人堤道/澎湖柱狀節理)
      const a = rnd() * Math.PI * 2, d = i === 0 ? 0 : Math.sqrt(rnd()) * R0;
      const px = Math.cos(a) * d, pz = Math.sin(a) * d;
      const r = 2.6 + rnd() * 2.2;
      const h = Math.max(8, hMax * (1 - (d / R0) * 0.55) * (0.8 + rnd() * 0.35) * (i === 0 ? 1.1 : 1));
      const t = rnd();
      // 同束柱形一致才像節理:六角為主、偶夾方柱/圓柱段;
      // 柱身向下多長 6m(埋進地基)→ 坡地上外圈柱也確實入土,不懸空
      const geo2 = t < 0.62 ? cyl(r, r * 1.04, h + 6, 6)
        : t < 0.84 ? rockFrustum(r * 1.8, r * 1.8, r * 1.48, r * 1.48, h + 6, 0.2, 0.2)
        : cyl(r, r * 1.04, h + 6, 10);
      // 色差收斂 ±0.02:同束節理是同一次岩漿冷卻,只該有風化深淺
      const col = new THREE.Mesh(geo2, rockMat(shade((rnd() - 0.5) * 0.04), moss * (d / R0) * 0.6));
      col.position.set(px, h / 2 - 3, pz);
      col.rotation.y = rnd() * Math.PI;
      g.add(col);
      // 柱頂斷口:略寬的節理帽蓋(斷面色淺 = 新鮮斷口);中央柱必有 = 頂面特徵落腳點
      if (i === 0 || rnd() < 0.5) {
        const cap = new THREE.Mesh(cyl(r * 1.05, r * 0.95, 1.6, 6), rockMat(shade(0.08)));
        cap.position.set(px, h + 0.8, pz);
        cap.rotation.y = col.rotation.y;
        g.add(cap);
      }
      // 頂錨 = 中央柱帽蓋斷面(特徵放置以群組原點為準,錨在別柱會懸空)
      if (i === 0) { topYA = h + 1.6; topRA = r * 0.9; }
      H = Math.max(H, h + 1.6);
    }
    RX = RZ = R0 + 5; topR = 3;
    sideDef = { y: [H * 0.12, H * 0.6] };   // 柱束外壁(實測會落在該方位最外那根柱)
  } else if (main === 'granite') {   // 花崗岩 tor:大塊方料錯縫整齊疊置
    base.set([0xc9c4b8, 0xbdb2a0, 0xd2cabb, 0xb8b0a4][Math.floor(rnd() * 4)]);   // 淺色花崗岩
    const w0 = 30 + rnd() * 16, d0 = 22 + rnd() * 12;
    const nL = 3 + Math.floor(rnd() * 2);
    let y = -3;   // 底層下沉 3m:坡地上塊底確實入土
    for (let i = 0; i < nL; i++) {
      const f = 1 - i * (0.12 + rnd() * 0.08);      // 逐層內收
      const hh = 12 + rnd() * 9;
      // 每層 1~2 塊並列(錯縫 = 上層縫不對齊下層縫),塊間留 0.8m 節理縫
      const nB = rnd() < 0.5 ? 1 : 2;
      const wL = w0 * f, off0 = (rnd() - 0.5) * 5;
      for (let b2 = 0; b2 < nB; b2++) {
        const wB = nB === 1 ? wL : wL * (0.36 + rnd() * 0.24);
        const px = nB === 1 ? off0 : off0 + (b2 ? 1 : -1) * (wL / 2 - wB / 2) * 1.02;
        // 色差收斂 ±0.015:同一露頭的花崗岩色勻,只留極淡的塊間變化
        const blk = new THREE.Mesh(rockFrustum(wB, d0 * f, wB * 0.88, (d0 * f) * 0.88, hh, 0.6, 0.6), rockMat(shade((rnd() - 0.5) * 0.03), i === nL - 1 ? moss : 0));
        blk.position.set(px, y + hh / 2, (rnd() - 0.5) * 2);
        blk.rotation.y = (rnd() - 0.5) * 0.07;      // 整齊拼接:僅極小微轉
        g.add(blk);
      }
      // 層間 0.4m **交疊**:塊面確實互壓(留空 0.5m = 每層都懸在上一層之上;
      // 「水平節理縫」的視覺靠逐層內收 f 與塊色深淺讀出來,不靠真的留一道空隙)
      y += hh - 0.4;
    }
    H = y; RX = w0 * 0.62; RZ = d0 * 0.62; topR = Math.min(w0, d0) * 0.3;
    sideDef = { y: [H * 0.15, H * 0.8] };
  } else if (main === 'marble') {   // 大理岩堆:大小互異的渾圓岩塊互倚
    base.set([0xd8d3c8, 0xcfc8bc, 0xd4cdc4, 0xc8c4bc][Math.floor(rnd() * 4)]);   // 大理岩灰白
    const R0 = 14 + rnd() * 10;
    const nB = 5 + Math.floor(rnd() * 4);
    let y = 0, rPrev = 0;
    for (let i = 0; i < nB; i++) {
      const r = (12 - i * 1.8) * (0.8 + rnd() * 0.4);   // 大塊在下、小塊在上
      if (r < 3) break;
      // 水平漂移隨層高收斂:頂塊貼近軸心,頂面特徵(錨在原點)才有落腳處
      const drift = Math.max(1.5, (R0 - r) * (1 - i / nB));
      const px = (rnd() - 0.5) * drift, pz = (rnd() - 0.5) * drift;
      // 色差收斂 ±0.02:同一岩體的大理岩塊色近,靠明暗交界讀塊面
      const g2 = megaGeo(MEGA_LIB.block[i % NBLK]);   // 庫節點(單位包絡)?? 原 ico —— rnd 枚數不變
      const blk = new THREE.Mesh(g2 || ico(r), rockMat(shade((rnd() - 0.5) * 0.04), i < 2 ? moss * 0.6 : 0));
      const syF = 0.72 + rnd() * 0.2;               // 溶蝕圓稜:壓扁的渾圓塊
      if (g2) blk.scale.set(r, r * syF, r); else blk.scale.y = syF;
      blk.rotation.set(rnd() * 0.5, rnd() * Math.PI, rnd() * 0.5);
      // 上塊坐進下塊間隙(半徑 55% 交疊 = 岩塊互倚,不是懸浮串珠);
      // 底塊心壓到 0.2r:超過半顆入土,坡地上也確實著地
      y = i === 0 ? r * 0.2 : y + rPrev * 0.55 + r * 0.3;
      blk.position.set(px, y, pz);
      g.add(blk);
      rPrev = r;
      H = Math.max(H, y + r * 0.8);
      RX = Math.max(RX, Math.abs(px) + r); RZ = Math.max(RZ, Math.abs(pz) + r);
    }
    topR = 3.5;
    topYA = H * 0.96; topRA = 3;
    sideDef = { y: [H * 0.15, H * 0.7] };
  } else {   // spire 尖峰
    const r0 = 20 + rnd() * 10, h = 80 + rnd() * 45;
    const m = new THREE.Mesh(cone(r0, h, 8), rockMat(shade(0), moss));
    m.position.y = h / 2; g.add(m);
    const m2 = new THREE.Mesh(cone(r0 * 0.6, h * 0.6, 7), rockMat(shade(0.05), moss));
    m2.position.set(r0 * 0.8, h * 0.3, 0); g.add(m2);
    H = h; RX = r0 * 1.5; RZ = r0 * 1.1; topR = 2;
    sideDef = { y: [H * 0.15, H * 0.65] };   // 錐面
  }
  // 以下崩落岩塊/伴生圓丘只擴 footprint(col);貼壁特徵(側樹/侵蝕溝)的高度帶走各分支
  // 已凍結的 sideDef,落點半徑一律實測 ⇒ 撐大後的 RX/RZ 不再有機會把特徵推到半空
  {   // 崩落岩塊:山腳鑿刻感碎岩(BOTW 手雕硬邊)
    const nB = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < nB; i++) {
      const br = 4 + rnd() * 7, a = rnd() * Math.PI * 2, d = Math.max(RX, RZ) * (0.85 + rnd() * 0.35);
      const g2 = megaGeo(MEGA_LIB.block[(i + 1) % NBLK]);   // 與 marble 錯開輪替,同岩不同型
      const bd = new THREE.Mesh(g2 || ico(br), rockMat(shade((rnd() - 0.5) * 0.06), moss * 0.6));
      const syF = 0.6 + rnd() * 0.3;
      if (g2) bd.scale.set(br, br * syF, br); else bd.scale.y = syF;
      bd.rotation.set(rnd() * 0.6, rnd() * Math.PI, rnd() * 0.6);
      // 塊心壓低到 0.1×半徑:過半入土,離群體最遠的崩落塊在坡地上也不懸空
      bd.position.set(Math.cos(a) * d, br * 0.1, Math.sin(a) * d);
      g.add(bd);
      RX = Math.max(RX, Math.abs(Math.cos(a) * d) + br);
      RZ = Math.max(RZ, Math.abs(Math.sin(a) * d) + br);
    }
  }
  const nSub = Math.floor(rnd() * 3);   // 伴生小圓丘
  for (let i = 0; i < nSub; i++) {
    const r = 10 + rnd() * 14, a = rnd() * Math.PI * 2, d = Math.max(RX, RZ) * (0.9 + rnd() * 0.3);
    const g2 = megaGeo(MEGA_LIB.block[(i + 2) % NBLK]);
    const m = new THREE.Mesh(g2 || new THREE.SphereGeometry(r, 9, 7), rockMat(shade((rnd() - 0.5) * 0.08), moss * 0.8));
    const syF = 0.6 + rnd() * 0.3;
    if (g2) m.scale.set(1.2 * r, r * syF, r); else m.scale.set(1.2, syF, 1);
    m.position.set(Math.cos(a) * d, 4, Math.sin(a) * d);
    g.add(m);
    RX = Math.max(RX, Math.abs(Math.cos(a) * d) + r * 1.2);
    RZ = Math.max(RZ, Math.abs(Math.sin(a) * d) + r);
  }
  // 侵蝕溝墨線:貼著側壁錨點放(單壁或柱群逐柱)。半徑與內傾角一律走 `rockProbe` **實測**
  // (與峭壁樹同一個縫;手寫剖面公式會讓溝棒浮在小面內縮那一段外面 —— 實測前量到 5.3m 的縫)。
  // 棒身 local +x = 徑向(ry = −a)⇒ 沉半深 = 0.8;內傾 MUST 走 `rotation.z`(Euler 'XYZ' 的
  // z 最內層 = 繞**自身**切向軸),MUST NOT 用 rotation.x(最外層 = 繞世界 X,只有某些方位剛好對)。
  {
    const ribCols = Array.isArray(sideDef) ? sideDef : sideDef ? [sideDef] : [];
    if (ribCols.length && rnd() < 0.7) {
      const probe = rockProbe(g);
      const n = 3 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        const cSd = ribCols[Math.floor(rnd() * ribCols.length)];
        const rh = (cSd.y[1] - cSd.y[0]) * (0.45 + rnd() * 0.35);
        const yc = cSd.y[0] + rh / 2 + rnd() * Math.max(0, cSd.y[1] - cSd.y[0] - rh);
        const a = rnd() * Math.PI * 2;
        const px = cSd.px || 0, pz = cSd.pz || 0;
        const er = probe.wallR(px, pz, yc, a);
        if (er == null) continue;
        const rib = new THREE.Mesh(new THREE.BoxGeometry(1.6, rh, 1.3), rockMat(shade(-0.1)));
        rib.position.set(px + Math.cos(a) * (er - 0.8), yc, pz + Math.sin(a) * (er - 0.8));
        rib.rotation.y = -a;
        rib.rotation.z = Math.atan(probe.slope(px, pz, yc, a, Math.max(2, rh / 2)));
        g.add(rib);
      }
    }
  }
  if (rnd() < 0.5) {   // 碎石坡
    const scree = new THREE.Mesh(cone(Math.max(RX, RZ) * 0.8, 10 + rnd() * 8, 9), rockMat(shade(0.06)));
    scree.position.y = 5; scree.scale.z = 0.7; g.add(scree);
  }
  return {
    main,   // 主體型別(給 audit_object_joints 標示是哪一型的接合出問題;放置端不讀)
    col: { r: Math.max(RX, RZ) + 4, h: H },
    anchor: { topY: topYA ?? H, topR: topRA ?? topR, side: sideDef },
  };
}

// 山丘頂的「平坦半徑」:自中心逐環外擴,量到「地面比中心低超過 drop」為止。
// 大於此半徑的物件放上去會懸出丘頂(比山丘還大的巨岩)——放置前把腳印縮進來。
function flatRadiusAt(terrain, x, z, rMax, drop = 8) {
  const h0 = terrain.heightAt(x, z);
  for (let rr = 8; rr <= rMax; rr += 6) {
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2 + rr * 0.19;   // 逐環轉相位,免得八方位漏掉窄脊
      if (h0 - terrain.heightAt(x + Math.cos(a) * rr, z + Math.sin(a) * rr) > drop) return Math.max(6, rr - 6);
    }
  }
  return rMax;
}

/**
 * 圓形腳印的「落底高度」:中心 + 腳印周圈取**最低**點(單一縫)。
 * 佔地放大後坡地會露餡 —— 只取中心高度,下坡側的基部就整片懸空(神木板根/巨岩崖錐/
 * 地標側翼都是幾公尺的腳印)。政策一律「寧可陷入山坡,不懸空」。
 * 2026-07-30:神木群落原本只取中心高度 ⇒ 陡坡與巨岩崖邊的神木樹根浮在空中(使用者回報)。
 */
function sinkBaseY(terrain, x, z, r, n = 8) {
  let gy = terrain.heightAt(x, z);
  for (let k = 0; k < n; k++) {
    const a = k / n * Math.PI * 2;
    gy = Math.min(gy, terrain.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r));
  }
  return gy;
}

// ---- 零件級細節抖動(P2-B;2026-08-03)----
// 規則(只增不減的水平半徑 / 只有軸心件准自轉 / 不動 y·px·pz·縱向尺寸)全在 `xform.js`,
// 這裡只負責「量出來的夾制」:抖完直接量這一件的水平外廓,頂出碰撞柱半徑就退回原樣 ——
// 岩體的碰撞柱本來就已經緊貼外廓(`col.r 一律涵蓋岩體實際外廓`,見 MEGALITHS 檔頭),
// 演出半徑再往外長就是「看得見卻打不到」(原則 4 / A30 家族)。
const MEGA_JIT = 0.12;   // 2026-08-05:0.05 → 0.12(全專案最小的抖幅;夾制本就「量測後退回」,加幅安全)
const _mjbox = new THREE.Box3();
// ---- 巨岩的表面群組門檻(2026-08-16;見 placeMegaliths 那一段)----
// 「這一件是主量體還是貼壁結構件」的判據 = **這一件自己的水平外廓 ÷ 碰撞柱半徑**。
// ⚠ 合成岩的 `col.r = max(RX,RZ) + 4` 帶了 +4 的常數餘裕 ⇒ 主量體的比值恆 < 1
// (實測落在 0.8~0.95)。日後有人改 `col.r` 的定義,這個比值會整批平移而**不會有任何
// 斷言紅字** —— `audit_rock_ink` Ⅰ 因此把逐型的比值分佈印出來(同 `audit_bot_role` 末段)。
const MEGA_BODY_F = 0.5;
const _msbox = new THREE.Box3();
/** 落點 → 細節種子(0~1;零亂數消耗,見呼叫端註解) */
function djAt(x, z) {
  const h = (Math.imul(Math.round(x * 8) | 0, 0x9E3779B1) ^ Math.imul(Math.round(z * 8) | 0, 0x85EBCA77)) | 0;
  return ((Math.imul(h ^ (h >>> 15), 0xC2B2AE3D) >>> 0) % 100003) / 100003;
}
export function jitterMegalith(g, dj, colR) {
  for (const o of g.children) {
    const { jr, spin } = partJitter(
      partId(o.position.y, o.position.x, o.position.z), dj, MEGA_JIT,
      o.position.x === 0 && o.position.z === 0,
    );
    if (jr === 1 && !spin) continue;
    const sx = o.scale.x, sz = o.scale.z;
    o.scale.x *= jr; o.scale.z *= jr;
    if (spin) o.rotateY(spin);
    _mjbox.setFromObject(o);
    const ext = Math.max(Math.abs(_mjbox.min.x), Math.abs(_mjbox.max.x),
      Math.abs(_mjbox.min.z), Math.abs(_mjbox.max.z));
    if (ext > colR) { o.scale.x = sx; o.scale.z = sz; if (spin) o.rotateY(-spin); }
  }
}

// ---- 世界文字圖層(2026-08-03;把圖資上的名字放回世界)----
// 這裡只做一件事:**從真幾何取位置與朝向**,交給 `worldtext.js` 決定要不要掛、掛什麼字。
// 位置 MUST 取自各構件自己那份幾何(portals / signSpots / generic / poi 投影),
// MUST NOT 在這裡重算一次橋在哪、洞口朝哪 —— 那就是第二份幾何,牌子會飄在結構外面。
//
// 優先序 = 額度分配:洞口 → 橋 → 具名點位 → 建物立面 → 語料庫招牌(直式/看板/路標/
// 佈告欄/解說牌)。愈前面的愈是「玩家一定會經過、而且有名字才成立」的東西;構件自己的
// 名字排在語料庫挑字之前 —— 真名優先於「這座城市有的名字」。
//
// 亂數紀律(§2.3):構件名牌那四種**零 `rnd()` 消耗**(全由圖資決定);語料庫那五種走
// **專屬 seed** `signRnd`(每次挑字固定 3 枚),MUST NOT 動到共享 `rnd` 的呼叫序 ——
// 動了整張圖的植被/建物佈局會跟著位移,而畫面上只是「地圖變了」。
const SIGN_POI_H = 5.2;     // 具名點位的標牌柱高(公尺;牌面掛在柱頂)
const SIGN_POST_H = 2.4;    // 路標/佈告欄/解說牌的立柱高(牌面掛在柱上)
const MAIN_HW_SIGN = /^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$/;

/**
 * 語料庫招牌(路標 / 佈告欄 / 解說牌)的落點。
 * 三條共同紀律:
 *   ① 一律**避開兵線淨空走廊**(`isBlocked`)—— 招牌是純表現層,絕不擋路;
 *   ② 位置取自既有幾何(路網折線 / 建物量體 / 地標圓),MUST NOT 另算一次;
 *   ③ **零 `rnd()` 消耗** —— 要不要擺、擺哪一側全由幾何決定(§2.3)。
 */
function planCorpusSites({ terrain, center, roads, generic, features, isBlocked }) {
  const inB = (x, z) => x > terrain.minX + 12 && x < terrain.maxX - 12
    && z > terrain.minZ + 12 && z < terrain.maxZ - 12;
  const free = (x, z) => inB(x, z) && !isBlocked(x, z);
  const roadSites = [], noticeSites = [], scenicSites = [];

  // 道路路標:主要道路每 ~130m 一支,退到路肩外 9m(兩側都試,取空的那一側)
  for (const way of roads || []) {
    const tg = way.tags || {};
    // 橋上/洞內不立牌:柱腳會浮在橋面下或穿進山體(立牌是貼地道具,沒有結構落腳邏輯)
    if (tg.bridge || tg.tunnel || !MAIN_HW_SIGN.test(tg.highway || '')) continue;
    const pts = (way.geometry || []).map((p) => llToWorld(p.lat, p.lon, center));
    let acc = 1e9;
    for (let i = 1; i < pts.length && roadSites.length < 26; i++) {
      const [x1, z1] = pts[i - 1], [x2, z2] = pts[i];
      const seg = Math.hypot(x2 - x1, z2 - z1);
      acc += seg;
      if (acc < 130 || seg < 1) continue;
      acc = 0;
      const ux = (x2 - x1) / seg, uz = (z2 - z1) / seg;
      for (const sgn of [1, -1]) {
        const x = x2 - ux * seg * 0.5 - uz * sgn * 9, z = z2 - uz * seg * 0.5 + ux * sgn * 9;
        if (!free(x, z)) continue;
        // 牌面朝路(讀牌的人站在路上)⇒ 法線 = 路的側向
        roadSites.push({ x, z, y: terrain.heightAt(x, z), ry: Math.atan2(ux, uz) + (sgn > 0 ? 0 : Math.PI) });
        break;
      }
    }
    if (roadSites.length >= 26) break;
  }

  // 佈告欄:住宅棟的臨路側。「外側」搞反是這一類道具最貴的錯誤(整組埋進牆裡)
  // ⇒ 朝**最近的路標**擺,不猜;取樣每 7 棟一次(零亂數的「疏密」)。
  generic.forEach((b, i) => {
    if (b.commercial || noticeSites.length >= 18 || i % 7) return;
    const half = Math.hypot(b.w, b.d) / 2 * 0.8;
    const near = nearestDir(roadSites, b.x, b.z);
    const x = b.x + near.dx * (half + 1.4), z = b.z + near.dz * (half + 1.4);
    if (!free(x, z)) return;
    noticeSites.push({ x, z, y: terrain.heightAt(x, z), ry: Math.atan2(near.dx, near.dz) });
  });

  // 風景解說牌:地標/瀑布旁。牌面**背對**特徵 —— 走上來讀牌,那座山就在牌子後面。
  // 方位取「離戰場中心較近的那一側」(玩家多半從場中央過來),零亂數。
  for (const f of features || []) {
    if (scenicSites.length >= 14) break;
    const d = Math.hypot(f.x, f.z) || 1;
    const r = (f.r || 10) + 7;
    const x = f.x - (f.x / d) * r, z = f.z - (f.z / d) * r;
    if (!free(x, z)) continue;
    scenicSites.push({ x, z, y: terrain.heightAt(x, z), ry: Math.atan2(x - f.x, z - f.z) });
  }
  return { roadSites, noticeSites, scenicSites };
}

/** 離某點最近的路標方向(沒有路標就朝 +x —— 有一個確定的答案好過猜) */
function nearestDir(sites, x, z) {
  let best = null, bd = Infinity;
  for (const s of sites) {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bd) { bd = d; best = s; }
  }
  if (!best || bd < 1) return { dx: 1, dz: 0 };
  const d = Math.sqrt(bd);
  return { dx: (best.x - x) / d, dz: (best.z - z) / d };
}

function buildWorldSigns({ group, terrain, center, portals, signSpots, generic, pois, lowPower,
  corpus, rnd, used, roads, features, isBlocked, wallSigns = [], billboards = [], bldFaces = null,
  entranceSigns = [] }) {
  const sheet = new SignSheet(lowPower);
  const posts = [];
  // 語料庫招牌的落點:全部在這裡先算好(位置一律取自既有幾何 + 路網,零 `rnd()`)
  const { roadSites, noticeSites, scenicSites } = planCorpusSites({
    terrain, center, roads, generic, features, isBlocked,
  });
  // ① 洞口匾額:位置/朝向/門洞寬高全在 portals 那一筆記錄裡(現成版位)。
  //    牌寬 = 高 × 4,MUST 收在門洞寬內 —— 比門洞寬的匾額會穿出洞口兩側的岩壁。
  for (const p of portals) {
    if (sheet.full) break;
    const text = resolveName(p.tags);
    if (!text) continue;
    const h = Math.min(1.5, p.w * 0.78 / 4);
    // 匾額貼在門樑上:洞口高 h(= TUN.CLEAR + 1)之上再半個牌高,略往洞外推出 0.35m 避免與門框共面(z-fight)
    sheet.add({ text, x: p.x + Math.sin(p.ry) * 0.35, z: p.z + Math.cos(p.ry) * 0.35,
      y: p.y + p.h + h * 0.62, ry: p.ry, h, style: 'stone' });
  }
  // ② 橋名牌:橋頭欄杆外側朝外
  for (const s of signSpots) {
    if (sheet.full) break;
    const text = resolveName(s.tags);
    if (!text) continue;
    sheet.add({ text, x: s.x + Math.sin(s.ry) * 0.4, z: s.z + Math.cos(s.ry) * 0.4,
      y: s.y, ry: s.ry, h: Math.min(1.2, s.hw * 0.6 / 4), style: 'stone' });
  }
  // ③ 車站／捷運／地下道入口：只用入口或最近車站的真實名稱與編號；取不到就保留建築、不掛假牌。
  for (const s of entranceSigns) {
    if (sheet.full) break;
    const text = s.signText || resolveName(s.tags);
    if (!text) continue;
    sheet.add({ text, x: s.x, y: s.y, z: s.z, ry: s.ry, h: 0.82, style: 'enamel' });
  }
  // ④ 具名點位(地名 / 山峰 / 交流道 / 車站):立一根柱子 + 兩面看得到的牌。
  //    交流道走公路指示牌配色(guide)、其餘走琺瑯牌(enamel)。山峰附標高 —— `ele` 是
  //    這一類點位唯一一個「名字以外還值得寫上去」的欄位。
  for (const poi of (pois || [])) {
    if (sheet.full) break;
    const [x, z] = llToWorld(poi.lat, poi.lng, center);
    if (x < terrain.minX + 20 || x > terrain.maxX - 20 || z < terrain.minZ + 20 || z > terrain.maxZ - 20) continue;
    const t = poi.tags || {};
    const junction = t.highway === 'motorway_junction';
    const base = resolveName(t) || (junction ? resolveRef(t) : null);
    if (!base) continue;
    const ele = t.natural === 'peak' && Number.isFinite(+t.ele) ? ` ${Math.round(+t.ele)}m` : '';
    const ref = junction ? resolveRef(t) : null;
    const text = junction && ref && base !== ref ? `${ref} ${base}` : base + ele;
    const y = terrain.heightAt(x, z);
    // 牌面朝向:一律面向戰場中心(玩家多半從場中央過來),零亂數
    const ry = Math.atan2(-x, -z);
    if (!sheet.add({ text, x, z, y: y + SIGN_POI_H, ry, h: 1.4, both: true,
      style: junction ? 'guide' : 'enamel' })) continue;
    posts.push({ x, y, z });
  }
  // ⑤ 建物立面招牌:只給**有名字的商業建物**(住宅掛名牌不合理,而且量會爆掉)。
  //    貼在正面(ry 方向)牆上緣下方,寬度收在牆寬內。
  //    **落點吃真的存在的那一面牆**(2026-08-12 使用者回報「招牌會懸空」):換上整棟量體
  //    節點的那幾棟不是方盒 —— 退縮塔在 0.82×樓高 那裡只有足跡的兩成寬,而這一支原本
  //    一律推到 `b.d / 2`(= 方盒側面)⇒ 牌子掛在塔身外面的空氣裡。`bldFaces` 是建物迴圈
  //    量好的剖面側面(唯一縫 `bldProfile`),這裡只挑「涵蓋這個高度的那一段」。
  for (const b of generic) {
    if (sheet.full) break;
    if (!b.commercial) continue;
    const text = resolveName(b.tags);
    if (!text) continue;
    const h = Math.min(2.2, b.w * 0.7 / 4);
    const gy = terrain.heightAt(b.x, b.z);
    let y = gy + Math.min(b.h - h, b.h * 0.82);
    let hd = b.d / 2;
    const faces = bldFaces?.get(b);
    if (faces) {
      // 換上庫節點的那幾棟:`faces` 只收**平整垂直牆**那幾段(2026-08-13 使用者
      // 「外掛招牌只貼在垂直地面且完全平整的平面牆」)。一段都不合格 ⇒ 這一棟不掛牌
      // —— MUST NOT 退回 `b.d / 2`,那正是「掛在方盒側面的空氣裡」那個成因本體。
      if (!faces.length) continue;
      // 牌面高度先夾在合格段的範圍內(頂端那一段可能是尖塔),再取那一段的牆面
      y = Math.min(y, faces[faces.length - 1].y1 - h * 0.6);
      hd = (faces.find((k) => y >= k.y0 && y <= k.y1)
        || [...faces].reverse().find((k) => k.y1 <= y) || faces[0]).hd2;
    }
    // 建物的 ry 是「牆面朝向」;招牌法線取 +ry 那一面,往外推半個牆厚 + 0.2 避免與牆共面
    const nx = Math.sin(b.ry), nz = Math.cos(b.ry);
    sheet.add({ text, x: b.x + nx * (hd + 0.2), z: b.z + nz * (hd + 0.2),
      y, ry: b.ry, h, style: 'lightbox' });
  }

  // ---- 以下五種走**語料庫挑字**(vernacular.js):字不是這個構件自己的名字,而是
  //      「這座城市有的名字」。三層文字(主名 / 日常副行 / 拉丁副名),一鎮一家去重帳
  //      與四種構件名牌**共用同一張 sheet** —— 一個世界只有一個文字圖層(原則 2)。
  //      語料全空(離線 / 沙漠 / 未知語系)⇒ signCopy 回 null ⇒ 這幾類整批不出場(原則 6)。
  const copyOf = (cls) => (corpus ? signCopy(cls, corpus, rnd, used) : null);

  // ⑤ 建築直式招牌:亞洲街景的垂直長條。位置在 wallSigns 那一批(建物迴圈已定案的牆面點)
  for (const s of wallSigns) {
    if (sheet.full) break;
    const copy = copyOf('wallsign');
    if (!copy) break;
    sheet.add({ copy, x: s.x, z: s.z, y: s.y, ry: s.ry, h: s.h, style: 'wallsign' });
  }
  // ⑥ 屋頂廣告看板:遠看的東西,三層文字都放得下
  for (const b of billboards) {
    if (sheet.full) break;
    const copy = copyOf('billboard');
    if (!copy) break;
    sheet.add({ copy, x: b.x, z: b.z, y: b.y + b.h / 2 + 0.6, ry: b.ry, h: b.h, style: 'billboard' });
  }
  // ⑦ 道路路標:主要道路每 ~130m 一支,擺在**路肩外**(招牌絕不擋路),雙面
  for (const st of roadSites) {
    if (sheet.full) break;
    const copy = copyOf('roadsign');
    if (!copy) break;
    if (sheet.add({ copy, x: st.x, z: st.z, y: st.y + SIGN_POST_H, ry: st.ry, h: 1.05, style: 'roadsign', both: true })) {
      posts.push({ x: st.x, y: st.y, z: st.z });
    }
  }
  // ⑧ 佈告欄:住宅棟的**臨路側**。「外側」搞反會把整組道具埋進牆裡 ⇒ 朝最近的路標擺,不猜
  for (const st of noticeSites) {
    if (sheet.full) break;
    const copy = copyOf('notice');
    if (!copy) break;
    if (sheet.add({ copy, x: st.x, z: st.z, y: st.y + SIGN_POST_H * 0.62, ry: st.ry, h: 1.5, style: 'notice' })) {
      posts.push({ x: st.x, y: st.y, z: st.z, h: SIGN_POST_H * 0.62 });
    }
  }
  // ⑨ 風景解說牌:地標 / 瀑布旁。牌面**背對**特徵 —— 走上來讀牌,那座山就在牌子後面
  for (const st of scenicSites) {
    if (sheet.full) break;
    const copy = copyOf('scenic');
    if (!copy) break;
    if (sheet.add({ copy, x: st.x, z: st.z, y: st.y + SIGN_POST_H * 0.5, ry: st.ry, h: 1.15, style: 'scenic' })) {
      posts.push({ x: st.x, y: st.y, z: st.z, h: SIGN_POST_H * 0.5 });
    }
  }

  const mesh = sheet.build();
  if (!mesh) return 0;
  group.add(mesh);
  // 標牌柱:與牌面分兩個 draw call(柱子沒有貼圖)。純視覺 —— **不進 blockers**(原則 4:
  // 表現層不得新增碰撞),機體從柱子中間走過去是刻意的取捨,牌子本身就不該擋兵線。
  if (posts.length) {
    // 單位高柱 + 逐實例縮放:三種立牌的柱高不同(具名點位 5.2m、路標 2.4m、佈告欄/解說牌
    // 更矮),共用同一份幾何 ⇒ 仍是一個 draw call。柱高 MUST 由該塊牌自己的落點帶,
    // MUST NOT 統一成一個常數(牌面會浮在柱頂之上或陷進柱身裡)。
    const pm = new THREE.InstancedMesh(cyl(0.09, 0.11, 1, 6),
      envMat(0x8d9299, { wash: 0.3, cool: 0.45 }), posts.length);
    const M = new THREE.Matrix4(), P = new THREE.Vector3(), S = new THREE.Vector3();
    const Q = new THREE.Quaternion();
    posts.forEach((p, i) => {
      const ph = p.h || SIGN_POI_H;
      P.set(p.x, p.y + ph / 2, p.z);
      S.set(1, ph, 1);
      M.compose(P, Q, S);
      pm.setMatrixAt(i, M);
    });
    pm.instanceMatrix.needsUpdate = true;
    pm.frustumCulled = false;
    group.add(pm);
  }
  return mesh.userData.signCount;
}

/**
 * 語意化地標(P2-C;2026-08-03 使用者定案「放在兵線 / 重生點 / 建築單位旁邊,在周遭可以
 * 看見即可」)。規則與型錄全住 `beacons.js`,這裡只負責把三件事接起來:
 *   ① 錨點:兵線 / 主堡 / 塔位 —— 全部由既有幾何推導,一次 fetch 都不加
 *   ② 落點:`planBeaconSites` + 本函式的 `probe` —— 「淨空 / 乾地 / 界內 / 夠平」的判準
 *      **與巨岩那一支逐條相同**(areaFree / heightAt / terrainEnvCode 腳印周圈 / flatRadiusAt),
 *      只是多留一圈 `BEACON.PAD`。地標因此不可能落進兵線走廊、塔位、主堡、橋樑走廊或
 *      隧道敞開段 —— 「不擋兵線」是構造保證,不是靠事後跑泛洪稽核發現
 *   ③ 碰撞柱:**量出來**再登記(`beaconCollider`),與建物/巨岩走同一條 blockers 路徑
 * 零共享 `rnd()` 消耗(§2.3):外觀差異由落點雜湊自帶種子,不動全圖佈局序列。
 * MUST 排在一般植被散布**之前** —— blockArea 之後小植被才會自動避開整件地標。
 */
function placeBeacons({ group, terrain, blocked, blockers, lanesW, basesW, mapA }) {
  if (!lanesW.length) return 0;
  const anchors = beaconAnchors({ lanesW, basesW, towerSites: solveTowerSites(lanesW, mapA) });
  const probe = (x, z, r) => {
    if (x < terrain.minX + r + 24 || x > terrain.maxX - r - 24
      || z < terrain.minZ + r + 24 || z > terrain.maxZ - r - 24) return false;
    if (terrain.heightAt(x, z) < 0.4) return false;
    // 水域/沼澤:中心 + 腳印周圈四向一併驗(同 placeMegaliths —— 只問中心會讓腳半泡在水裡)
    if (terrainEnvCode(terrain, x, z) !== 0
      || [[r * 0.7, 0], [-r * 0.7, 0], [0, r * 0.7], [0, -r * 0.7]]
        .some(([ox, oz]) => terrainEnvCode(terrain, x + ox, z + oz) !== 0)) return false;
    if (flatRadiusAt(terrain, x, z, r) < r) return false;   // 站不平的地方不立(寧缺勿錯)
    return areaFree(blocked, x, z, r);
  };
  let n = 0;
  for (const st of planBeaconSites(anchors, probe)) {
    const g = buildBeacon(st.kind, beaconSeed(st.x, st.z));
    const col = beaconCollider(g);
    const gy = sinkBaseY(terrain, st.x, st.z, col.r);
    g.position.set(st.x, gy, st.z);
    g.rotation.y = st.ry;
    group.add(g);
    blockArea(blocked, st.x, st.z, col.r);
    blockers.push({ x: st.x, z: st.z, y: gy - 1, r: col.r, h: col.h + 1 });
    n++;
  }
  return n;
}

// ---- 主堡旗陣(2026-08-13 使用者「遊戲中加入國旗物件」)----
// 地標建物上的旗子逐圖數量不定(一張圖不見得抽得到學校或城堡),而**每一場都要看得到國旗**
// ⇒ 兩座主堡外圍各立一圈旗桿。這裡也是「駐軍國」這條規則最讀得出來的地方:走向對面陣營的
// 主堡,旗海會慢慢從自己這一國換成對方那一國(60% 換到 60%),中間夾著 30% 的地主國。
//
// 四條紀律:
//  ①**純表現層**:不進 `blockers`/`occ`/LOS、不 `blockArea` —— 旗桿是 0.12m 的細桿,
//    與球門柱/園燈同級(siteplan 的先例:「掛了就是球門後面那條看不見的牆」)。
//  ②**零共享 `rnd()` 消耗**(§2.3):落點是等分角度的純幾何,國家由座標雜湊自帶種子。
//    這一整段插在建構鏈的任何位置都不會推移後面每一株植被的序列。
//  ③**逐國一個 InstancedMesh**:旗面**MUST NOT** 合併成一個 mesh —— 擺動權重吃的是
//    `transformed.x`(旗桿側 0、旗尾 1),合併之後每一面旗的 x 都是它在合併幾何裡的位置,
//    整批會繞著旗陣的中心擺。實例化則每一面各自吃自己的局部座標,且相位取實例原點 ⇒
//    一圈旗子彼此差半拍,正是要的效果。
//  ④**朝向對著下風**:旗面的 +x 是旗尾,轉到 `WIND.DIR_DEG` 那個方向 ⇒ 旗子朝風吹的方向
//    展開。省掉這一步的話旗子會側著吹(擺動仍正確,但看起來像旗桿裝反了)。
const FLAG_RING_N = 8;        // 每座主堡幾根旗桿
const FLAG_POLE_H = 12;       // 旗桿高(真實公稱 6m × REAL_SCALE 2;§2.5)
const FLAG_POLE_R = 0.12;
// 旗面尺寸:真實公稱 2.5m × 1.5m 的旗 × REAL_SCALE 2(§2.5)。高由 `FLAG_RATIO` **推導** ——
// 手寫兩個數字的話比例一改,貼圖上的記號(flags.js 一律用比例座標)會被拉扁而顏色還是對的。
const FLAG_W = 5.0, FLAG_H = FLAG_W / FLAG_RATIO;
function placeBaseFlags({ group, terrain, blocked, basesW, nation }) {
  // 半徑 MUST 把**淨空圈**與 `areaFree` 的**格子探針**一起算進去:淨空是 `BASE_CLEAR_R`(70m),
  // 而 `areaFree(..., 2)` 的 n = ceil(2 / CELL) = 1 ⇒ 它其實問的是「這一格與四鄰(±CELL)有
  // 沒有被佔住」。乘個 1.12 放到 78m 看起來很安全,實際上探針往內摸到 68m < 70m ⇒ **一根都
  // 立不起來**,而且沒有任何錯誤訊息(2026-08-13 實測:整圈 16 根全被靜默淘汰)。
  const R = BASE_CLEAR_R + CELL * 2;
  const sites = [];
  for (const b of basesW) {
    for (let i = 0; i < FLAG_RING_N; i++) {
      const a = (i + 0.5) / FLAG_RING_N * Math.PI * 2;
      const x = b.x + Math.cos(a) * R, z = b.z + Math.sin(a) * R;
      if (x < terrain.minX + 30 || x > terrain.maxX - 30
        || z < terrain.minZ + 30 || z > terrain.maxZ - 30) continue;
      if (terrainEnvCode(terrain, x, z) !== 0) continue;     // 水域/沼澤不立(寧缺勿錯)
      if (!areaFree(blocked, x, z, 2)) continue;             // 兵線/道路/建物佔住了就跳過
      sites.push({ x, z, y: terrain.heightAt(x, z), iso: nation(x, z) });
    }
  }
  if (!sites.length) return 0;
  // 旗桿:同色同幾何 ⇒ 一個 InstancedMesh
  const poleG = new THREE.CylinderGeometry(FLAG_POLE_R, FLAG_POLE_R, FLAG_POLE_H, 6)
    .translate(0, FLAG_POLE_H / 2, 0);
  const poles = new THREE.InstancedMesh(poleG, bmat(0x9aa2a8), sites.length);
  const M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1);
  const ry = -WIND.DIR_DEG * Math.PI / 180;   // 旗尾(局部 +x)朝下風;見紀律 ④
  Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
  sites.forEach((s, i) => {
    P.set(s.x, s.y, s.z);
    M.compose(P, Q, S);
    poles.setMatrixAt(i, M);
  });
  poles.instanceMatrix.needsUpdate = true;
  poles.castShadow = false;
  poles.frustumCulled = false;
  group.add(poles);
  // 旗面:逐國一個 InstancedMesh(紀律 ③)。旗面掛在桿頂偏 +x 半個旗寬處 = 桿邊貼著桿。
  const byIso = new Map();
  for (const s of sites) {
    const key = s.iso || '';
    if (!byIso.has(key)) byIso.set(key, []);
    byIso.get(key).push(s);
  }
  for (const [iso, list] of byIso) {
    const proto = flag(FLAG_W, FLAG_H, 0.07, iso || 0xd93a2b);   // 幾何 + 材質(含 cloth 軟性)取自同一份 flag()
    const fm = new THREE.InstancedMesh(proto.geometry, proto.material, list.length);
    list.forEach((s, i) => {
      // 局部 +x = 旗尾 ⇒ 旗面中心要往 +x 推半個旗寬,桿才落在旗面的 −x 緣(A39 的旗桿側錨點)
      // 高度傳 `POLE_H − FLAG_H`:`flag()` 自己會再加半個旗高 ⇒ 旗面**頂緣恰在桿頂**。
      // 傳 POLE_H 的話旗子會有一半飄在旗桿上面(而畫面上只看得出「旗桿好像短了一截」)。
      P.set(s.x + Math.cos(ry) * (FLAG_W / 2), s.y + FLAG_POLE_H - FLAG_H,
        s.z - Math.sin(ry) * (FLAG_W / 2));
      M.compose(P, Q, S);
      fm.setMatrixAt(i, M);
    });
    fm.instanceMatrix.needsUpdate = true;
    fm.castShadow = false;
    fm.frustumCulled = false;
    group.add(fm);
  }
  return sites.length;
}

/** 裸露地巨岩地標:名岩輪替 + 合成巨岩;footprint 整圓淨空後放置,登記碰撞柱 */
const MEGA_MAX = 15;       // 全圖巨岩上限(舊制 12;改成露頭群後多留三顆給第三片)
// 合成巨岩的標稱碰撞半徑(`synthMegalith` 回的是 `max(RX,RZ)+4`,逐顆不同)——
// 只用來估**格距**,實際緊密判定仍量每顆真正的 `meta.col.r`(原則 4)
const SYNTH_COL_R = 30;

/**
 * 裸露地的巨岩露頭(2026-08-03 使用者定案③「巨石依地質特性緊密排列,形成壯麗景觀」)。
 *
 * 舊制是「全圖散 12 顆、彼此至少隔 70m」—— 那是**地標**的擺法(每顆都是孤立的奇岩),
 * 不是露頭。改成 `ROCKFIELD.FIELDS` 片**露頭群**,每片內部緊密成列:
 *   ① 走向由地形梯度推導(等高線方向 = 層面/節理的走向;`siteplan.js strikeRad` 單一縫)
 *   ② 節理間距成排、相鄰排錯縫(`planRockField`),長軸一律對齊走向 ⇒ 一看就是同一組節理
 *   ③ 同源同相:整片同一種岩、同一份色相偏移(同一岩層),體格自核心往外遞減
 * 緊密的界線是「碰撞柱不互穿」(`dist ≥ r_i + r_j`):再密也不能長進彼此體內 —— 那是
 * 破圖,不是景觀。逐顆仍走既有的水域/淨空/平坦度/邊界四道閘(一顆放不下就少一顆)。
 */
function placeMegaliths({ group, terrain, blocked, blockers, rnd, sites, basesW, roadOccupied }) {
  const types = Object.keys(MEGALITHS);
  const start = Math.floor(rnd() * types.length);   // 每張圖不同起點,依序輪替求多樣
  const placedM = [];
  const fields = [];
  const talus = [];     // 基部崩積裙(2026-08-05;純表現層,全部收在 blockArea(r) 內)
  const lichens = [];   // 壁面地衣/水漬色斑(同上)
  let named = 0;
  for (const [fx, fz] of sites) {
    if (fields.length >= ROCKFIELD.FIELDS || placedM.length >= MEGA_MAX) break;
    if (fields.some((f) => Math.hypot(fx - f.x, fz - f.z) < ROCKFIELD.SEP)) continue;
    // ---- 露頭群的三個「同源」決定:岩種 / 色相 / 走向 ----
    const fSynth = rnd() < 0.4;                     // 約四成整片走合成岩
    const fType = types[(start + named) % types.length];
    // 同一岩層 ⇒ 整片共用色相偏移(逐顆再抖一點 = 塊面風化深淺)
    const fH = (rnd() - 0.5) * 0.05, fS = (rnd() - 0.5) * 0.12, fL = (rnd() - 0.5) * 0.1;
    // 走向 = 等高線方向(梯度的法向)。取樣距 MUST 跨得過地形格(~8.3m),否則量到的是
    // 單格鋸齒而不是這面山坡的走向;平地(梯度趨零)回 null ⇒ 退回落點雜湊給的定值(原則 6)。
    const G = 26;
    const strike = strikeRad(
      terrain.heightAt(fx + G, fz) - terrain.heightAt(fx - G, fz),
      terrain.heightAt(fx, fz + G) - terrain.heightAt(fx, fz - G),
    ) ?? (frac(beaconSeed(fx, fz), 0) * Math.PI);
    // 標稱半徑(只用來估格距):**縮放先過物件高度上限**再乘半徑 —— 名岩公稱高 50~120m,
    // 上限(`objHeightMax()`)把 s 壓下來的同時半徑也等比縮小 ⇒ 沒過這一支就會用「未夾制的體格」
    // 去排格點,整片露頭之間憑空多出一倍的空隙(而每一顆本身仍然合法,看不出成因)。
    // 合成岩的 H 逐顆生成時才知道 ⇒ 這裡沿用既有估計值,逐顆的真正夾制在下面。
    const nomS = fSynth ? 1.15 * OVER.mega
      : objScaleFit((MEGALITHS[fType].s[0] + MEGALITHS[fType].s[1]) / 2 * OVER.mega,
        MEGALITHS[fType].col.h, MEGALITHS[fType].s[1] * OVER.mega);
    const nomR = nomS * (fSynth ? SYNTH_COL_R : MEGALITHS[fType].col.r);
    const cells = planRockField({
      cx: fx, cz: fz, strike, pitch: nomR * 2 * ROCKFIELD.PACK, seed: beaconSeed(fx, fz),
    });
    let inField = 0;
    for (const cell of cells) {
      if (placedM.length >= MEGA_MAX) break;
      const x = cell.x, z = cell.z;
      // 先建再驗:淘汰只是丟棄未進場景的 Group,rnd 序全房一致
      const synth = fSynth;
      const g = new THREE.Group();
      let meta, s;
      let sMax;   // 這一片露頭抽得到的最大縮放(cell.sf ≤ 1:體格自核心往外遞減)
      if (synth) {
        meta = synthMegalith(g, rnd);
        s = (0.9 + rnd() * 0.5) * OVER.mega * cell.sf;
        sMax = 1.4 * OVER.mega;
      } else {
        const def = MEGALITHS[fType];
        def.build(g, rnd);
        meta = def;
        s = (def.s[0] + rnd() * (def.s[1] - def.s[0])) * OVER.mega * cell.sf;
        sMax = def.s[1] * OVER.mega;
      }
      // 物件高度上限(`WORLD_H.OBJ_F` 倍砲塔高)。**夾縮放不截幾何**:`meta.col.h × s`
      // 正是後面 `topW` 量的那個「岩體世界高度」,而半徑 `r`、落底腳印、緊密判定、攀岩高度帶
      // 全部乘同一個 s ⇒ 夾在這裡(平坦度縮放**之前**)整顆等比縮小,一條也不會分家。
      // 走**分布版**(同神木):名岩公稱高 27~120m,硬夾會把高的那幾型全部壓成同一個高度
      //(而「核心最大、往外遞減」正是露頭的樣子)⇒ 等比壓縮讓最大的那顆恰好貼齊上限。
      // 合成岩與名岩同吃(兩者的 meta 都帶 col.h);夾制不消耗亂數 ⇒ 佈局序列不變(§2.3)。
      s = objScaleFit(s, meta.col.h, sMax);
      let r = meta.col.r * s;
      // 山丘頂容不下整顆巨岩 → 等比縮到平坦半徑剛好;縮過頭(<45%)不像地標,換點
      const fr = flatRadiusAt(terrain, x, z, r + 6);
      if (fr < r) {
        const shrink = fr / r;
        if (shrink < 0.45) continue;
        s *= shrink;
        r = meta.col.r * s;
      }
      if (x < terrain.minX + r + 24 || x > terrain.maxX - r - 24
        || z < terrain.minZ + r + 24 || z > terrain.maxZ - r - 24) continue;
      let gy = terrain.heightAt(x, z);
      if (gy < 0.4) continue;
      // 水域/沼澤不放巨岩:佔地大(r 可 ~20m+),中心 + 腳印周圈四向一併驗(rnd 已抽完,序列安全)
      if (terrainEnvCode(terrain, x, z) !== 0
        || [[r * 0.7, 0], [-r * 0.7, 0], [0, r * 0.7], [0, -r * 0.7]]
          .some(([ox, oz]) => terrainEnvCode(terrain, x + ox, z + oz) !== 0)) continue;
      if (!areaFree(blocked, x, z, r + 6)) continue;
      if (roadOccupied?.({ x, z, r: r + 6 })) continue;
      // 主堡退避:名岩公稱高即真實比例(放置後 90~160m),`blocked` 那圈 70m 是照**建物**
      // 尺度訂的 ⇒ 舊制只保證岩壁邊緣離主堡中心 `BASE_CLEAR_R + 6`,一座 160m 高的岩體
      // 站在 76m 外仰角就是 65° = 從主堡出生看出去整片天空被吃掉(2026-08-05 使用者回報)。
      // 尺 MUST 是**岩體自己的外廓**而不是定值:名岩體格差到四倍,寫死一個退避距不是對
      // 小顆的太鬆就是對大顆的沒用。判準 = 中心距 ≥ 淨空圈 + 一整個岩體直徑
      // (⇒ 岩壁邊緣離淨空圈還隔著一個岩體半徑)。
      if (basesW?.some((b) => Math.hypot(x - b.x, z - b.z) < BASE_CLEAR_R + r * 2)) continue;
      // 緊密排列的界線 = **碰撞柱不互穿**(同片露頭):再密也不能長進彼此體內 —— 那是破圖,
      // 不是景觀。不同露頭群之間維持舊制的孤立感(`SEP` 已在外層擋掉,這裡是逐顆的保險)。
      if (placedM.some((p) => Math.hypot(x - p.x, z - p.z)
        < r + p.r + (p.f === fields.length ? ROCKFIELD.GAP_M : 70))) continue;
      decorateMegalith(g, meta.anchor, rnd, s);
      // 岩色隨生成/風化各異(2026-07-29):整顆色相/彩度/明度偏移 = 同名岩兩顆不同礦源;
      // 逐塊再抖一點明度 = 塊面風化深淺。只動 rockMat 標記的材質(綠冠/木門/描邊不動);
      // envMat 每次呼叫都建新材質,就地調色不會污染他顆。traverse 順序 = 加入序,rnd 序確定
      // 同源同相(2026-08-03):偏移量的**主項是整片露頭共用**的 fH/fS/fL(同一岩層 = 同一礦源),
      // 逐顆只再抖一小截。整片各抽各的話,一片露頭會是七彩的 —— 那看起來是七顆孤岩剛好擠在一起,
      // 不是一片露頭。
      // 表面群組(2026-08-16;序 3 S3 的第一個消費端,`docs/anime_style_plan.md` 使用者追加的
      // 「山頭 / 巨石 / 石堆」那一句)。一顆巨岩在畫面上是**一個東西**,不該被勾線畫成一堆
      // 多邊形稜線 —— 而現況是 `envMat` 每呼叫一次就抽一個逐材質 surfaceId ⇒ **一顆岩的
      // 20~40 塊零件各自是一個號**,`INK_MRT.ID` 那一項沿著同一顆岩的每一條塊界畫線。
      // 分兩群,判據 **MUST 是量出來的外廓比而不是逐型名冊**:
      //   ・主量體(dome / slab / tower / 碎石坡 cone)的水平外廓貼著碰撞柱半徑(實測 0.8~1.0);
      //   ・貼壁結構件(鑿面 / 侵蝕 rib / 之字棧道踏板 / 鏡牆帶 / 獅爪 / 石屋)小一個數量級
      //     (實測 0.03~0.35)⇒ 門檻取 0.5 兩側各有一個數量級的餘裕。
      // **效果**:同群組內部(塊與塊、ico / 圓柱的小面之間)的 id 線消失、法線折邊改吃
      // `INK_MRT.SELF_F` 抬高的門檻;而結構件與主量體**跨群組** ⇒ 節理 / 層理 / 崖階 / 棧道
      // 那幾條線自動留著(使用者要的「有意義的結構線」)。
      // ⚠ 三條順序:①MUST 排在 `jitterMegalith` **之前**(抖動只增不減水平半徑,量在抖動之後
      // 會讓靠近門檻的件逐顆跳邊)②MUST 排在 `group.add(g)` **之前**(`uSurfId` 在首次編譯
      // 當下凍結,晚一步就是一行都不生效:線照畫、console 一個字都沒有)③量測與 `jitterMegalith`
      // 的 `_mjbox` **同一把尺、同一個局部座標系**(`g.scale` 隨後才套上去)。
      // **零亂數消耗**:群組號吃 `surfGroup()` 的模組級序,不是共享 `rnd()`(§2.3 —— 在這裡
      // 抽一枚當群組種子就會把後面每一顆巨岩、每一株植被的佈局整條推移)。
      const gBody = surfGroup(), gFeat = surfGroup();
      const dH = fH + (rnd() - 0.5) * 0.015, dS = fS + (rnd() - 0.5) * 0.04, dL = fL + (rnd() - 0.5) * 0.04;
      g.traverse((o) => {
        if (o.isMesh && o.material?.userData?.rock) {
          o.material.color.offsetHSL(dH, dS, dL + (rnd() - 0.5) * 0.05);
          _msbox.setFromObject(o);
          const ext = Math.max(Math.abs(_msbox.min.x), Math.abs(_msbox.max.x),
            Math.abs(_msbox.min.z), Math.abs(_msbox.max.z));
          joinSurfGroup(o.material, ext >= MEGA_BODY_F * meta.col.r ? gBody : gFeat);
        }
      });
      // 零件級細節抖動(P2-B;2026-08-03):名岩的 build() 逐顆抽條數/尺寸,但**同一顆裡的
      // 各個岩塊**比例是逐位元固定的 —— 兩座酋長岩的鼻樑稜線一模一樣。規則與振幅上界的
      // 唯一縫 = `xform.js partJitter`(與植被/障礙同一份),夾制的尺是**碰撞柱半徑**
      // `meta.col.r`(局部座標;g.scale 隨後才套上去 ⇒ 兩者同尺度)。
      // dj 由**落點**推、MUST NOT 再抽一枚 `rnd()`:抽了就把後面每一顆巨岩/每一株植被的
      // 亂數序列整條推移 ⇒ 全部場地的佈局跟著變(§2.3 的序列紀律),而這一項只是外觀微調。
      jitterMegalith(g, djAt(x, z), meta.col.r);
      bakeContactAO(g, 6);   // 接地 AO:巨岩「長」在地上(botw_plan Task 2.2)
      g.scale.setScalar(s);
      // 佔地放大後坡地會露餡:取腳印周圈最低點落底(同建物),寧可陷入山坡不懸空
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2;
        gy = Math.min(gy, terrain.heightAt(x + Math.cos(a) * r * 0.7, z + Math.sin(a) * r * 0.7));
      }
      g.position.set(x, gy - 1.5, z);
      // 長軸對齊走向(同一組節理面)—— 舊制的 `rnd() * 2π` 是「每顆各轉各的」,那正是
      // 「巨石亂擺」的成因。抖動已含在 `cell.ry` 裡(`ROCKFIELD.RY_JIT`),不再另抽。
      g.rotation.y = cell.ry;
      group.add(g);
      blockArea(blocked, x, z, r);   // 植被/地被/建物自動避開整個岩體
      // ---- 攀岩抓點的「正面」:逐方位**實測**岩面貼不貼碰撞圓(climb.js attachFaces ②)----
      // 巨岩不是圓柱:碰撞圓涵蓋整個外廓(含崖錐/崩落塊/伴生丘),岩面常內縮十幾公尺 ⇒
      // 抓點掛在碰撞圓上就是一整排浮在半空的樹脂塊(2026-07-30 使用者回報「正面必須面對巨石」)。
      // 只留「整條路線高度帶內,岩面與碰撞面的縫都 ≤ ATT_GAP」的方位;一個都沒有 ⇒ attA 空陣列
      // ⇒ 不掛路線(圓頂/崖錐型巨岩本來就架不出一條筆直貼壁的路線,寧缺勿錯)。
      //
      // **實測現況(2026-07-30,13 型 × 多種子;離線量測)**:`col.r`(涵蓋整個外廓)× 0.85 與
      // 「高度帶內壁面半徑」的差距是 4m(酋長岩)~60m(烏魯魯/桌山),故**多數巨岩都通不過**這一關
      //  ⇒ 巨岩幾乎不掛攀岩抓點。這是刻意的:掛上去就是一整排浮在 4~60m 空中的樹脂塊。
      //  (遊戲內這條路徑另有座標系 bug,2026-07-31 才修 —— 見下段;修之前是「恆空」而非「多數不過」。)
      // 要讓巨岩重新掛得上,得先把碰撞體從「一顆涵蓋全外廓的圓柱」換成「主量體有向盒 +
      // 外伸量體(崖錐/崩落塊/伴生丘)各自登記」—— 那是動權威幾何的獨立工項(A30 對建物已改完,
      // 巨岩待補),本次不含。屆時只要碰撞面貼上壁面,這裡就會自動開始產出方位。
      //
      // **座標系(2026-07-31 修)**:`rockProbe(g)` 的射線一律走**世界**座標(g 此刻已定位/縮放/
      // 旋轉,`bb`/`far` 也都是世界量)。舊版拿 local 的 `(0, 0, yL, aL)` 去問,等於從世界原點附近
      // 朝原點射一條射線 —— 幾百公尺外的岩體根本吃不到,`wallR` 恆 null ⇒ **attA 恆空、巨岩一顆
      // 都掛不上抓點**(症狀與上面那段「縫太大」的結論撞在一起,難以分辨)。改成整段用世界量:
      // 方位直接就是世界方位(不必再 `− rot`)、半徑不再乘 s(probe 回的已是世界公尺)。
      const colR = r * 0.85;                     // 碰撞半徑(世界)
      const ATT_GAP = MAX_BODY_R;                // 縫上限(climb.js 單一縫):≤ 最大機體碰撞半徑 ⇒ 機體仍貼著設施
      const attA = [];
      const probe = rockProbe(g);                // g 已含表面特徵,但射線只吃岩體(rockProbe 內部快照)
      {
        const yBase = gy - 1.5;                  // 岩體 local y=0 的世界高(= g.position.y)
        const topW = meta.col.h * s;             // 岩體世界高度(路線頂端 = 碰撞柱頂)
        for (let k = 0; k < 16; k++) {
          const a = k / 16 * Math.PI * 2;         // 世界方位(attA.a 就是 surfacePoint 吃的那個角)
          let gap = 0, top = 0, okA = true;
          for (let i = 0; i <= 4; i++) {
            const yW = yBase + topW * (0.12 + 0.2 * i);   // 高度帶:12%~92%(貼地段被崖錐/碎石坡吃掉,不驗)
            const rr = probe.wallR(x, z, yW, a);
            if (rr == null) { okA = false; break; }
            const d = colR - rr;                  // 該高度的縫(世界公尺)
            if (d > ATT_GAP) { okA = false; break; }
            gap = Math.max(gap, Math.max(0, d));
            if (i === 4) top = Math.max(0, d);
          }
          if (okA) attA.push({ a, gap, top });
        }
      }
      // ty = 岩頂**實測**高(自岩心垂直下射):碰撞柱刻意比岩體高 1.5m(落底時整顆下沉),
      // 圓頂/疊層巨岩的頂面又比 `col.h` 低一截 ⇒ 抓點照碰撞柱畫會整排高出岩頂(同建築那族病灶)
      blockers.push({ x, z, y: gy - 2, r: colR, h: meta.col.h * s + 2, std: 1, cl: 'rock', attA, ty: probe.topAt(x, z) });   // std:頂部可站立(surfaceAt);cl:攀爬設施型別(climb.js)
      // ---- 表面加飾(2026-08-05):基部崩積裙 + 壁面地衣/水漬色斑 ----
      // 落點雜湊自帶種子(同 djAt / buildHazard 的紀律):**零共享 rnd 消耗** ⇒ 既有佈局
      // 逐位元不動。純表現層(原則 4):不登記碰撞、不動 blocked —— 全部收在 blockArea(r) 內。
      {
        const dr = mulberry32((Math.imul(Math.round(x * 8) | 0, 0x9E3779B1)
          ^ Math.imul(Math.round(z * 8) | 0, 0x85EBCA77)) >>> 0);
        // 崩積裙:3~7 顆小岩塊 —— sakura-crossing 露岩配方:埋入 58%、傾入坡面(±0.3rad)
        // 繞 Y 任意、三軸不等比(r, r×0.55~0.8, r×0.8~1.25)⇒ 同一顆幾何長出全異剪影
        const nT = 3 + Math.floor(dr() * 5);
        for (let ti = 0; ti < nT; ti++) {
          const ta = dr() * Math.PI * 2, td = r * (0.55 + dr() * 0.4);
          const tx2 = x + Math.cos(ta) * td, tz2 = z + Math.sin(ta) * td;
          const tr2 = 0.6 + dr() * 1.3;
          const sy2 = 0.55 + dr() * 0.25, sz2 = 0.8 + dr() * 0.45;
          const rx2 = (dr() - 0.5) * 0.6, ry2 = dr() * Math.PI * 2, rz2 = (dr() - 0.5) * 0.6;
          const ty2 = terrain.heightAt(tx2, tz2);
          if (ty2 < 0.4) continue;   // 不進水面(抽樣已完,本序列獨立於共享 rnd)
          talus.push({ x: tx2, y: ty2 + tr2 * sy2 * 0.42, z: tz2, r: tr2, sy: sy2, sz: sz2,
            rx: rx2, ry: ry2, rz: rz2, dH, dS, dL });   // 與母岩同色相(同源同相)
        }
        // 地衣/水漬:貼壁半透明色斑(不寫深度、不描邊)—— 岩壁的「用過的痕跡」;
        // 傾角跟實測壁面斜率走(rockProbe),斑面貼著壁面不懸空
        const nL = 2 + Math.floor(dr() * 4);
        for (let li = 0; li < nL; li++) {
          const la = dr() * Math.PI * 2;
          const ly = (gy - 1.5) + meta.col.h * s * (0.18 + dr() * 0.55);
          const lr2 = 1.2 + dr() * 2.6;
          const dk = dr();
          const lw = probe.wallR(x, z, ly, la);
          if (lw == null) continue;
          const tilt = Math.atan(probe.slope(x, z, ly, la));
          lichens.push({ x: x + Math.cos(la) * (lw + 0.1), y: ly, z: z + Math.sin(la) * (lw + 0.1),
            a: la, r: lr2, tilt, dark: dk < 0.5, dH });
        }
      }
      placedM.push({ x, z, r, f: fields.length });   // f = 所屬露頭群序(緊密判定只對同片放寬)
      inField++;
    }
    // 岩種輪替以**露頭群**為單位遞增(同片同岩;逐顆遞增的話一片露頭會混七種名岩)
    if (inField) {
      if (!fSynth) named++;
      fields.push({ x: fx, z: fz, strike, n: inField });
    }
  }
  // ---- 表面加飾的實例化(各一個 InstancedMesh = 全圖 +2 draw call)----
  if (talus.length || lichens.length) {
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
    const P = new THREE.Vector3(), S = new THREE.Vector3(), tint = new THREE.Color();
    if (talus.length) {
      const tm = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), rockMat(0xffffff), talus.length);
      talus.forEach((t, i) => {
        E.set(t.rx, t.ry, t.rz); Q.setFromEuler(E);
        P.set(t.x, t.y, t.z); S.set(t.r, t.r * t.sy, t.r * t.sz);
        M.compose(P, Q, S);
        tm.setMatrixAt(i, M);
        const jl = ((i * 1597334677) >>> 0) % 100 / 100;
        tint.setHex(0x8f8878).offsetHSL(t.dH, t.dS, t.dL + (jl - 0.5) * 0.08);
        tm.setColorAt(i, tint);
      });
      tm.instanceMatrix.needsUpdate = true;
      if (tm.instanceColor) tm.instanceColor.needsUpdate = true;
      tm.frustumCulled = false;
      group.add(tm);
    }
    if (lichens.length) {
      // 色斑面片:半透明、不寫深度、不描邊(勾線 pass 讀到的仍是壁面深度 ⇒ 不出斑點)
      const lmat = toonMat(0xffffff);
      lmat.transparent = true; lmat.opacity = 0.42; lmat.depthWrite = false;
      const lm = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 9), lmat, lichens.length);
      lm.renderOrder = 1;
      lichens.forEach((t, i) => {
        // 面片法線 = 壁面外法線(方位 a + 依實測斜率上仰 tilt);先仰後轉 ⇒ 'YXZ'
        E.set(-t.tilt, Math.PI / 2 - t.a, 0, 'YXZ'); Q.setFromEuler(E);
        P.set(t.x, t.y, t.z); S.set(t.r, t.r * (0.7 + ((i * 2654435761) >>> 0) % 100 / 100 * 0.5), 1);
        M.compose(P, Q, S);
        lm.setMatrixAt(i, M);
        // 深斑 = 水漬/陰生地衣(偏母岩暗色);淺斑 = 殼狀地衣(偏黃綠灰)
        tint.setHex(t.dark ? 0x4a463e : 0x8f9a6a).offsetHSL(t.dH, 0, 0);
        lm.setColorAt(i, tint);
      });
      lm.instanceMatrix.needsUpdate = true;
      if (lm.instanceColor) lm.instanceColor.needsUpdate = true;
      lm.frustumCulled = false;
      group.add(lm);
    }
  }
  return placedM.length;
}

/**
 * 荒野遺跡與廢棄建築擺放系統 (placeWildernessRelics)
 * 在地圖荒野 (bare / 邊緣開闊區) 擺放古代遺跡、巨神雕像、墜毀飛行器、鐘樓尖塔與貨櫃殘骸等物件。
 * 遵循原則：
 *   - 零共享 rnd() 消耗（使用座標雜湊與局部 mulberry32，不推移植被佈局序）
 *   - 嚴格避開主堡圈 (BASE_CLEAR_R)、道網 (roadOccupied)、現有 blocked 區域
 *   - 佔地登記 blockArea(blocked, x, z, r)，防止後續植被穿模
 *   - 貼地 AO 與坡度落底防懸空
 */
function placeWildernessRelics({ group, terrain, blocked, blockers, sites, basesW, roadOccupied }) {
  const landKinds = Object.keys(RELIC_KINDS).filter((k) => RELIC_KINDS[k].land);
  if (!landKinds.length || !sites?.length) return 0;

  let placedCount = 0;
  const RELIC_MAX = 8;
  const RELIC_SEP = 90; // 遺跡彼此間距 (m)
  const placedList = [];

  for (let i = 0; i < sites.length && placedCount < RELIC_MAX; i++) {
    const [sx, sz] = sites[i];
    const s = (Math.imul(Math.round(sx * 8) | 0, 0x9E3779B1) ^ Math.imul(Math.round(sz * 8) | 0, 0x85EBCA77)) ^ 0x7A4C19;
    const localRnd = mulberry32(s >>> 0);

    const kind = landKinds[Math.floor(localRnd() * landKinds.length)];
    const def = RELIC_KINDS[kind];
    const r = def?.colR ?? 10;

    // 檢查邊界與高度
    if (sx < terrain.minX + r + 30 || sx > terrain.maxX - r - 30
      || sz < terrain.minZ + r + 30 || sz > terrain.maxZ - r - 30) continue;

    let gy = terrain.heightAt(sx, sz);
    if (gy < 0.6) continue; // 避開近水面

    // 避開水域/沼澤
    if (terrainEnvCode(terrain, sx, sz) !== 0) continue;

    // 避開淨空、道路與主堡
    if (!areaFree(blocked, sx, sz, r + 4)) continue;
    if (roadOccupied?.({ x: sx, z: sz, r: r + 4 })) continue;
    if (basesW?.some((b) => Math.hypot(sx - b.x, sz - b.z) < BASE_CLEAR_R + r * 2)) continue;
    if (placedList.some((p) => Math.hypot(sx - p.x, sz - p.z) < RELIC_SEP)) continue;

    // 落底防懸空：取腳印周圈最低點
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      gy = Math.min(gy, terrain.heightAt(sx + Math.cos(a) * r * 0.7, sz + Math.sin(a) * r * 0.7));
    }

    const g = new THREE.Group();
    const relic = buildRelicObject(kind, g, 0, 0, 0, localRnd, { isLand: true });
    g.position.set(sx, gy, sz);
    bakeContactAO(g, 5);

    group.add(g);
    blockArea(blocked, sx, sz, r);
    const col = relicCollider(relic, `relic_${kind}`);
    if (col) blockers?.push(col);
    placedList.push({ x: sx, z: sz, r });
    placedCount++;
  }

  return placedCount;
}

/** OSM tags → 建物類型 */
/** 文化、宗教與古文明遺跡地標名冊 */
export const CULTURAL_RELIC_LANDMARKS = Object.freeze([
  'shrine', 'mandir', 'stupa', 'synagogue', 'gurdwara', 'stave_church',
  'pyramid', 'slate_house', 'tongkonan', 'egyptian_pylon', 'sahel_mosque',
  'nuer_tukul', 'inuit_igloo', 'temple', 'church', 'mosque', 'pagoda', 'castle',
]);

/** 依 OSM tags 取得直接語意對應之建物類型 */
export function matchedBuildingType(tags = {}) {
  const b = tags.building, a = tags.amenity;
  const native = nativeFunctionalKind(tags);
  if (native) return native;
  if (a === 'place_of_worship') {
    const r = tags.religion;
    if (r === 'muslim') return 'mosque';
    if (r === 'shinto') return 'shrine';
    if (r === 'hindu') return 'mandir';
    if (r === 'jewish') return 'synagogue';
    if (r === 'sikh') return 'gurdwara';
    if (r === 'buddhist') {
      if (b === 'stupa' || tags.man_made === 'stupa') return 'stupa';
      if (b === 'pagoda') return 'pagoda';
      return 'temple';
    }
    if (r === 'christian') {
      if (tags.architecture === 'stave' || b === 'stave_church') return 'stave_church';
      return 'church';
    }
  }
  if (b === 'shrine' || tags.historic === 'wayside_shrine') return 'shrine';
  if (b === 'temple' && tags.religion === 'hindu') return 'mandir';
  if (b === 'stupa' || tags.man_made === 'stupa') return 'stupa';
  if (b === 'synagogue') return 'synagogue';
  if (b === 'gurdwara') return 'gurdwara';
  if (b === 'stave_church' || tags.architecture === 'stave') return 'stave_church';
  if (b === 'pyramid' || tags.historic === 'archaeological_site') return 'pyramid';
  if (b === 'slate_house' || tags.architecture === 'slate_house' || tags.indigenous === 'taiwan') return 'slate_house';
  if (b === 'tongkonan' || tags.architecture === 'tongkonan' || tags.traditional === 'austronesian') return 'tongkonan';
  if (tags.historic === 'pylon' || tags.architecture === 'pylon' || tags.historic === 'egyptian_temple') return 'egyptian_pylon';
  if (tags.architecture === 'sahel' || tags.architecture === 'adobe' || b === 'sahel_mosque') return 'sahel_mosque';
  if (b === 'tukul' || b === 'hut' || tags.traditional === 'african') return 'nuer_tukul';
  if (b === 'igloo' || tags.historic === 'inuksuk' || tags.traditional === 'inuit') return 'inuit_igloo';
  if (tags.power === 'tower') return 'power';
  if (b === 'industrial' || b === 'factory' || b === 'warehouse') return 'factory';
  if (tags.historic === 'castle' || b === 'castle') return 'castle';
  if (tags.man_made === 'lighthouse' || b === 'lighthouse') return 'lighthouse';
  if (b === 'pagoda') return 'pagoda';
  if (b === 'stadium' || tags.leisure === 'stadium') return 'stadium';
  if (b === 'commercial' || b === 'office' || b === 'retail' || b === 'hotel' || b === 'apartments' && (+tags['building:levels'] || 0) >= 10) return 'commercial';
  return 'residential';
}

/** OSM tags → 建物類型；文化／宗教地標必須忠實採用匹配類型，不再隨機換成無關建物。 */
export function buildingType(tags, _seed = 0) {
  return matchedBuildingType(tags) || 'residential';
}

function buildingHeight(tags, type, rnd) {
  const real = parseFloat(tags.height) || (+tags['building:levels'] || 0) * 3.2;
  const h = real > 3 ? Math.min(real, 120) : (type === 'commercial' ? 24 + rnd() * 40 : 7 + rnd() * 9);
  const target = type === 'commercial' ? STOREY.commercial : STOREY.residential;
  const scaled = Math.min(h * OVER.bldH, OVER.bldCap);
  const floors = Math.max(1, Math.round(scaled / target));
  return floors * target;   // 量化為整數倍標準層高,杜絕垂直層高跳動
}

// ---- Overpass 取用:鏡像輪替 + **逐站**逾時(2026-08-03 太魯閣結構整批消失案)----
// 舊制三個鏡像共用**一個** AbortController:任何一站掛住(不回應也不斷線)就把整份時間預算
// 吃光,`ctrl.signal.aborted` 一成立就 `return null` —— **後面的鏡像永遠輪不到**。
// 實測 2026-08-03:#2 kumi.systems 穩定不回應(25s 無回應),而 #1 常態 429/504、#3 mail.ru
// 2.2s 就回得漂亮 ⇒ 路網查詢固定在第二站掐死。路網是隧道/明隧道/地下道/橋的**唯一** OSM 輸入,
// 拿不到就退回合成兵線 = 一張圖上的立體結構整批消失(而且沒有任何錯誤訊息,看起來就是
// 「太魯閣的明隧道不見了」)。
// 改成每一站各自計時、總預算只管「什麼時候該收手」:一站掛住最多花掉它自己那一份。
// 這正是 Node 端離線工具(tools/venue_field.mjs overpass()、bake_venue_lanes)一直在用的形狀 ——
// 執行期是唯一的例外,現在對齊。
const OVERPASS_TRY = { feat: 10000, road: 12000 };    // 單站上限(健康的鏡像實測 1.5~10s)
const OVERPASS_TOTAL = { feat: 24000, road: 30000 };  // 總預算(夠三站各輪一次)
/**
 * 逐站送同一個查詢,第一個「解析得出東西」的回應即定案。
 * @param parse (data) => 結果 | null —— 回 null 表示這一站的回應不合用(空結果/被截斷),換下一站
 */
async function overpassQuery(q, parse, tryMs, totalMs) {
  const deadline = Date.now() + totalMs;
  for (const url of OVERPASS_URLS) {
    const left = deadline - Date.now();
    if (left <= 0) break;                   // 總預算用盡,不再換站
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(tryMs, left));
    try {
      const resp = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ctrl.signal });
      if (!resp.ok) continue;               // 限流/伺服器錯誤:即時回應,換鏡像
      const out = parse(await resp.json());
      if (out) return out;
    } catch {
      /* 這一站逾時或連不上 —— 只花掉它自己那一份預算,換下一站(MUST NOT 在此 return) */
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

// ---- 本輪 OSM 輸入的定案表(路網中繼的客戶端這一半;**唯一 store**)----
// 逐格三態:`undefined` = 還沒定案(fetcher 照舊自己抓)/ `null` = 定案為「沒有」
// (本客戶端親自查過且失敗 ⇒ MUST NOT 再多發一次同樣的查詢,否則房主要多吃一整份逾時預算)/
// 資料 = 定案為這一份。store 刻意住在 biomes.js 而非 osmrelay.js:單機模式下 `rooms.js`
// 與客戶端共用模組實例,把可變狀態放進 osmrelay.js 等於伺服器與客戶端共用同一份 store。
let _osmIn = null;   // { key, feats, roads }

/**
 * 定案本輪的 OSM 輸入(中繼抵達 / 房主自查完成)。`slots` 的 `undefined` 代表「不動這一格」。
 * **已定案的格 MUST NOT 被覆蓋**(單調):中繼與自查會先後抵達,反覆換料等於同一間房裡
 * 有人用 v1、有人用 v2 —— 那正是中繼要修的病。
 * @returns {boolean} 這次有沒有真的定案到**新的資料**(呼叫端據此決定要不要重建預建;
 *   定案為 null 不算 —— 那沒有給世界帶來任何新東西)
 */
export function commitOsmIn(bbox, slots) {
  const key = osmRelayKey(bbox);
  if (!key) return false;
  if (_osmIn?.key !== key) _osmIn = { key, feats: undefined, roads: undefined };
  let fresh = false;
  for (const k of ['feats', 'roads']) {
    if (slots?.[k] === undefined || _osmIn[k] !== undefined) continue;
    _osmIn[k] = slots[k];
    if (slots[k]) fresh = true;
  }
  return fresh;
}
/** 取本輪定案值;`undefined` = 還沒定案(fetcher 與 main.js 的閘門共用這一支判定) */
export function osmInOf(bbox, slot) {
  return _osmIn?.key === osmRelayKey(bbox) ? _osmIn[slot] : undefined;
}
/**
 * 定案進度。`all=true`(預設)= 兩格都定案(房主的閘門據此直接放行);
 * `all=false` = 至少一格定案 —— 入房者的閘門用這一版:中繼晚到觸發的重建若再等一次
 * `WAIT_MS`,就是抱著已經到手的資料乾等 20 秒,而缺的那一格本來就該由 fetcher 自己抓。
 */
export function osmInReady(bbox, all = true) {
  const f = osmInOf(bbox, 'feats') !== undefined, r = osmInOf(bbox, 'roads') !== undefined;
  return all ? (f && r) : (f || r);
}
/**
 * 把「定案為沒有」的格退回未定案 —— 房間階段的 OSM 補抓(main.js scheduleOsmRetry)成功後
 * MUST 呼叫,否則房主第一輪抓不到的那一格會被自己的 null 永久鎖死,重試等於沒做。
 * 拿到資料的格刻意不動(那是全房已經在用的那一份)。
 */
export function resetOsmMisses() {
  if (!_osmIn) return;
  if (_osmIn.feats === null) _osmIn.feats = undefined;
  if (_osmIn.roads === null) _osmIn.roads = undefined;
}

/** Overpass 圖資(逾時就放棄 → 程序生成備援):建物 + 鐵路/捷運 + 瀑布 */
async function fetchOsmFeatures(bbox) {
  // 路網中繼:本輪已定案(伺服器轉來的房主那一份,或本客戶端親自查過的結果)⇒ 直接用,
  // 不查網路也不查快取。深拷貝理由同 geocache(下游 buildRails/harvestOsm 就地變異)。
  // **刻意不寫進 geocache**:中繼的來源是房主 = 不可信輸入,持久化它會污染這台機器之後
  // 每一場(含它自己當房主的那一場),而快取的紀律正是「只准存自己完整抓到的東西」。
  const inj = osmInOf(bbox, 'feats');
  if (inj !== undefined) return inj && structuredClone(inj);
  // Overpass 回應快取(geocache.js):同 bbox 首次完整成功即定案(remark = 伺服器截斷/逾時,不入庫)。
  // 之後每場建物/鐵路輸入位元級一致 —— 圖資不再隨鏡像輪替/限流逐局忽有忽無。
  // 鍵含查詢額度:額度常數改版自然失效重抓。
  // 版本 5(2026-08-31):closed way + multipolygon relation 改走完整面域契約；
  // 舊中心點快取 MUST NOT 命中新管線。加入捷運／車站出入口節點；地下步道本體不渲染，只以這些點位與端點建入口。
  // **改查詢 MUST 同步 +1**:不改版的話舊快取會照樣命中,而它裡面沒有 pois ⇒ 新標牌
  // 在所有「以前開過這張圖」的機器上永遠不出現,且沒有任何錯誤訊息。
  const { nBld, nCover, nArea } = osmFeatureQuotas(bbox);
  const ckey = geoKey('osmF', OSM_FEATURE_QUERY_VERSION, bbox, `q${nBld}-${nCover}-${nArea}`);
  const cached = await geoGet(ckey);
  if (cached) return cached;
  // 具名點位額度刻意極小:一張圖最多掛 32 塊牌(worldtext SIGN_MAX),多抓也用不到,
  // 而 node 查詢本身很便宜(不帶幾何)⇒ payload 幾乎不動。
  const q = osmFeatureQuery(bbox);
  return overpassQuery(q, (data) => {
    const res = parseOsmFeatureElements(data.elements);
    // 入庫走深拷貝:IDB 寫入是非同步,下游(buildRails 等)會就地變異這些物件,
    // 不拷貝會把「該局變異後」的資料定案
    if (!data.remark) geoPut(ckey, structuredClone(res));
    return res;
  }, OVERPASS_TRY.feat, OVERPASS_TOTAL.feat);
}

/**
 * 道路路網(獨立 Overpass 查詢):與建物/鐵路分開,避免道路查詢過重或逾時時
 * 連帶拖垮既有的建物/鐵路渲染。失敗回 null → buildBiomes 退回以兵線為主要道路。
 */
async function fetchOsmRoads(bbox) {
  const inj = osmInOf(bbox, 'roads');   // 路網中繼(理由同 fetchOsmFeatures)
  if (inj !== undefined) return inj && structuredClone(inj);
  // 路網快取:兵線橋/地下道/隧道的唯一 OSM 輸入 —— 首次完整成功即定案,
  // 之後每場真橋/隧道 way 集合恆定(dropLaneBridges/dedupe/carve 皆純幾何 → 整條管線可重現)。
  // 兩級查詢、各自額度(2026-07-17 巴黎道路消失案):單一 `out geom 300` 在密路網市區
  // (巴黎 L3 bbox 實測 1533 條 way)截掉八成道路,且 Overpass 依 id 序輸出 —— 主幹道
  // 一樣被犧牲。車道級與小徑分開給額(隨 bbox 面積縮放),幹道永不被 footway/path 擠掉。
  // 額度放大後 payload ~700KB、Overpass 實測 ~10s(舊 10s abort 必掐死)→ timeout 同步放寬。
  const { nMain, nMinor } = osmRoadQuotas(bbox);
  const ckey = geoKey('osmR', 1, bbox, `q${nMain}-${nMinor}`);
  const cached = await geoGet(ckey);
  if (cached?.length) return cached;
  const q = osmRoadQuery(bbox);
  return overpassQuery(q, (data) => {
    const roads = osmRoadsFromElements(data.elements);
    if (!roads.length) return null;   // 空結果(部分逾時)也換鏡像
    // 深拷貝理由同 fetchOsmFeatures:mergeGradeChains/way._tun 會就地變異 way 物件
    if (!data.remark) geoPut(ckey, structuredClone(roads));
    return roads;
  }, OVERPASS_TRY.road, OVERPASS_TOTAL.road);
}

/**
 * 大馬路(主方位量測專用;`main.js resolveMapRot` 是唯一消費端)。
 * **只在自訂地圖存入最愛那一次發**:那是使用者主動觸發、一次性、而且輸出直接寫死進
 * battleConfig 的地方。MUST NOT 在建圖期(`buildBiomes`)呼叫 —— 那是每台客戶端各跑一次的,
 * 而 Overpass 逐局成敗不同 ⇒ 不同客戶端量到不同角度 = 整個世界的座標對不上(A42 ③)。
 * 取樣面走 `roadgrid.GRID_HW`(`.source` 就是 Overpass 要的字串),與離線烘焙同一份。
 * 額度刻意固定 900(同烘焙工具):主方位是**方向**的統計量,和 bbox 面積無關。
 */
export async function fetchGridRoads(bbox) {
  const bb = `${bbox.minLat.toFixed(5)},${bbox.minLng.toFixed(5)},${bbox.maxLat.toFixed(5)},${bbox.maxLng.toFixed(5)}`;
  const ckey = geoKey('osmG', 1, bbox);
  const cached = await geoGet(ckey);
  if (cached?.length) return cached;
  const q = `[out:json][timeout:15];way["highway"~"${GRID_HW.source}"](${bb});out geom 900;`;
  return overpassQuery(q, (data) => {
    const roads = [];
    for (const el of data.elements || []) {
      if (el.type === 'way' && el.geometry && GRID_HW.test(el.tags?.highway || '')) {
        roads.push({ tags: el.tags, geometry: el.geometry });
      }
    }
    if (!roads.length) return null;
    if (!data.remark) geoPut(ckey, structuredClone(roads));
    return roads;
  }, OVERPASS_TRY.road, OVERPASS_TOTAL.road);
}

/**
 * OSM 取用(main.js 的路網中繼閘 `osmGate` 與房間階段重試共用):只發兩個 Overpass 查詢,
 * 不建任何幾何 —— 房主要在建圖**之前**拿到原始圖資才送得出去(buildBiomes 內的那一份
 * 已經被量化與就地變異過,中繼它等於把下游的加工結果當成原料發給全房)。
 * 命中 geocache 即回(零網路);成功結果由 fetcher 自身定案入庫 → 之後的
 * buildBiomes(重建預建或下一場)直接命中快取。回傳 [features|null, roads|null]。
 */
export function warmOsm(bbox) {
  return Promise.all([fetchOsmFeatures(bbox), fetchOsmRoads(bbox)]);
}

// ---- 道路(圖資 way):有寬度的賽璐璐路面,主/次分級 + 依地貌變色 ----
const ROAD_W = {
  motorway: 12, trunk: 11, primary: 10, secondary: 8, tertiary: 7,
  unclassified: 5, residential: 5.5, living_street: 5, service: 4,
  pedestrian: 4, track: 3.5, footway: 2.4, path: 2.2,
};
const MAIN_HW = /^(motorway|trunk|primary|secondary|tertiary)$/;
// 街廓配置(siteplan §A)認得的市街道路:MAIN_HW 之外再加住宅區道路與生活街道。
// 刻意**不**收 service/track/步道 —— 那是停車場通道、產業道路與人行小徑,沿著它們配置街屋
// 就會在山裡的林道兩旁長出整排樓房(而畫面上只表現成「這張圖的城市長到山上去了」)。
const FRONT_HW = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)$/;
// 步道級 way。兵線仍不吃這些路；跨水影像也不自動把它們抬橋，只有 OSM 明確標記 bridge=yes
// 才進人行天橋管線。地下步道已由 pedestrian.js 在任何道路消費端之前移除，只留下入口。
// 橋面/地下道的最小通行寬度(遊戲公尺):機甲碰撞直徑約 4~5m,兩台並行 + 小兵夾縫仍有餘裕
const PASS_W = 16;
// 地下道(真・下沉,2026-07-15 改版):**不開挖地表**。隧道路面 = 兩端洞口地表高的平直內插道路,
// 上方山體(未改動的原地形,照常鋪地被拼圖)自然高過路面即成「隧道」;洞內加不透明天花板遮住山體底面。
//   CLEAR  路面到天花板的淨空(> 最大機甲 真人1.8×250%≈4.5m + 餘裕)⇒ 天花板夠高、最大機甲通過不卡。
//   HW     隧道路面半寬(> PASS_W/2,雙機並行);ROOF_T 天花板厚度。
//   覆蓋門檻:山體地表 ≥ 路面 + CLEAR + ROOF_T 才算「洞內」(天花板藏得進山體);否則是敞開洞口段。
// PORTAL_MAX/LAMP_MAX:全圖門洞/隧道照明的資源上限(具名旋鈕,取代舊硬編 12/120)——
//   舊 12 上限在含多座隧道的密市區把排序在後的洞口砍掉,該洞既不打洞也不掛暗面 ⇒ 露出戳進
//   斷面的原始地形土牆正面擋住視線(= 使用者「遠方看不到出入口」);舊 120 燈上限用罄後長/後段
//   隧道遠端全黑。門洞是輕量 Group、punch 成本受 depth≤40/hw 有界,提高上限只增建圖成本、不動幾何縫。
// 明隧道(gallery / rock shed;2026-07-28 使用者需求 → 2026-07-30 柱列改制)旋鈕 —— 覆蓋判定只看
//   **中心線**藏不藏得住天花板,側向的土牆厚度沒人管:山腰蜿蜒路 / 縫合蓋廊段 / 引道開挖擦邊處,
//   單邊土牆可能只剩幾公尺甚至被挖穿 ⇒ 側牆與天花板憑空浮在山坡上、坡面與結構之間一道看穿到洞內的縫。
//   WALL_MIN 側向土牆最小厚度:自隧道邊緣往外量這麼遠,地表 MUST 全程高過頂板頂面(藏得住結構);
//            任一取樣點沒到 = 該側改明隧道:深埋側維持隧道牆,開放側 = 矮牆 + 連續柱列撐外露頂板,
//            柱間**透明可見可穿透**(兩端同判:slab gal 遮罩讓伺服器 LOS/爆風同步放行,見 buildRoads)。
//   NEAR_W   近帶岩背寬(2026-07-31):牆背這麼近之內只要有取樣點高過頂板 = 牆背貼著實體
//            土/岩(山壁、峽谷岩脊)⇒ 該側維持整面牆,不因更外側落谷判開放(燕子口岩脊實案)。
//   OUT_W    側向落差掃描帶(2026-08-01 使用者定案「貫穿地形的是隧道,不是明隧道」):明隧道的
//            定義是**一側在地形內(牆)、另一側在地形外(柱)**;WALL_MIN 只量得到「上方覆蓋夠不夠厚」,
//            量不到「這一側到底在不在地形裡」—— 7m 還不到一格地形(~8.3m),薄覆蓋與臨崖在它眼裡
//            一模一樣。加掃到牆外 OUT_W(≈3 格),問「地表有沒有落到**路面**以下」:落下去 = 結構
//            浮在地形之外 = 開放側;沒落下去 = 牆背整段是土,即使頂上只剩幾公尺也仍是隧道。
//            實測(金龍隧道真圖資):被舊判定判成明隧道的點,側向地表在 40m 外仍高出路面 3.7~9.8m
//            (= 貫穿山體的真隧道,只是覆蓋比頂板厚度少了 0.2~1.5m);燕子口錐麓隧道/落石棚的
//            開放側則在 15~25m 內就落到路面之下 —— 兩者相隔一個數量級,門檻取「低於路面」即可分開。
//   EAVE     外露頂板較通行寬多挑出的簷口(MUST > 天花板小段的 hw+0.6,否則天花板邊緣露在簷外)。
//   PARAPET  女兒牆高;SILL 開放側矮牆頂(路面起算的護欄牆,封住 facade 底縫、柱腳立其後);
//   COL_GAP  柱列間距;COL_MAX 全圖柱列實例上限(與 LAMP_MAX 同性質的資源閘);
//   GAL_BORE_MAX 明隧道洞內打洞 bore 的全圖上限(側坡地表斜穿洞內斷面,沿明隧道段發 bore
//            交給 punchPortalHoles 清掉 —— 與 PORTAL_MAX 同性質的資源閘)。
const TUN = { CLEAR: LOS.TUN_CLEAR_M, HW: 9, ROOF_T: 1.0, PORTAL_MAX: 48, LAMP_MAX: 240,
              WALL_MIN: 7, NEAR_W: 3, OUT_W: 25, EAVE: 0.8, PARAPET: 0.5, SILL: 1.1, COL_GAP: 4.5, COL_MAX: 600,
              GAL_BORE_MAX: 160, GAL_CLEAR_W: 9, MOUTH_OUT: 8 };   // CLEAR 單一縫住 data.js(sim 層推定共用)
// MOUTH_OUT:門洞走廊往洞**外**延伸的長度(≈ 一格地形,2026-07-31 多視角檢視)。洞口外側 ±hw、
// 路面以上/天花以下那塊空間就是車開出來的地方,開挖後仍攤在切面上的地被底毯與地形殘片會斜插
// 進洞口(洞內往外看 = 幾片浮在路面上方的土色薄片)。垂直三條界不動 ⇒ 路塹底/圍裙/山體不受影響。
// GAL_CLEAR_W:明隧道開放側柱外淨空帶寬(牆線外這段內、低於頂板的土脊開挖到路面;
// 2026-07-31 太魯閣實測柱間視線被牆外 2~3m 殘丘擋在 13~17m ⇒ 帶寬取 9 蓋過實測殘丘)
/**
 * 隧道/明隧道/地下道**頂板頂面**的高度(單一縫,2026-08-03 使用者定案「明隧道天花板…跟橋面
 * 一樣需要遵守物理碰撞法則」)—— 天花底面 `cy` 之上再 `ROOF_T` 就是頂板的**上表面**,也就是
 * 「站得上去、擋得住砲火」的那一面(橋面的 `deckY` 對應物;板體 = [cy, roofTop],厚度語意
 * 與橋的 [deckY − DECK_UNDER, deckY] 完全對稱)。
 * 三個消費端 MUST 全吃這一支:外露頂板 `galRoof` 的頂面、柱列 `galCols` 的柱頂、站立/彈道
 * 索引 `makeTunnelIndex` 的 `roof`。手寫第二份 `+ TUN.ROOF_T` 的代價是「看到的頂面」與
 * 「踩得到/擋得住的頂面」分家 —— 玩家踩在頂板上方一截的空氣裡,或整個人陷進頂板裡(原則 4)。
 * (覆蓋門檻那幾處寫的是 `floors[i] + TUN.CLEAR + TUN.ROOF_T` = 同一個高度的**需求**式,
 *  問的是「地表藏不藏得住頂板」而不是「頂板在哪」,語意不同故不併入本縫。)
 */
const tunRoofTop = (cy) => cy + TUN.ROOF_T;
// 覆蓋區間縫合參數(2026-07-22 洞口改制):
//   GAP_CLOSE 覆蓋段之間 ≤ 此長度的短敞開縫 → 縫合視為覆蓋(蓋廊),否則山腰被挖出天窗壕溝;
//   COV_MIN   短於此的孤立覆蓋殘段視為敞開(一小坨土蓋不成洞,挖掉比立兩座門乾淨)。
const TUN_GAP_CLOSE = 36, TUN_COV_MIN = 18;
// 結構隧道資格(單一縫,2026-07-29 澀谷側壁破口案):山體隧道/地下道管線只收**戶外車行**
// tunnel way;人行/自行車級與室內通道(indoor,車站地下街)一律不進車行結構管線。
// 這些步道已由 pedestrian.js 移除路線並只留下入口。前科:澀谷站 indoor
// footway 閉環被判成山體隧道 —— 敞開補集以 hw+7 斜壁開挖 + 髮夾鄰腿走廊互相捕捉,把覆蓋段
// 側壁挖成走得出去的破口(側壁閘「側向地表高差 >2.6m」的前提被自家開挖打破)。
// 消費端 = carve 指派 way._tun 的入口(唯一結構開關;buildRoads/markGradeCorridors 皆以
// way._tun[ri].intervals 判結構性)與 audit_lane_scenarios 場景判定 —— MUST NOT 另寫第二份。
const strucTunnel = (tags) => !!tags?.tunnel && (tags.indoor == null || tags.indoor === 'no')
  && !isPedestrianWay(tags);
/**
 * 隧道覆蓋區間(單一縫,2026-07-22):carve 呼叫端 / buildRoads / markGradeCorridors 三個
 * 消費端 MUST 共用這一份分類,否則開挖、牆/天花、走廊的「洞口位置」互相對不上(舊版各自
 * 拿開挖後 heightAt 重算 = 三個洞口互不重合)。
 * 輸入:同一條裁切+densify(ROAD_SEG) 後的 run(pts/cum/floors)與「開挖前」heightAt。
 * 逐點判「原地表 ≥ 路面 + CLEAR + ROOF_T(藏得住天花板)」→ 區間化 → 縫短縫、剔殘段。
 * 回傳 [[s0, s1, i0, i1]…](弧長範圍 + 頂點索引範圍);空陣列 = 全程藏不住天花板 =
 * 平坦市區「隧道」→ 呼叫端一律按一般道路處理(不開挖、不鋪平直剖面、不立門洞)。
 */
function tunnelCoverIntervals(pts, cum, floors, heightAt) {
  const n = pts.length;
  const iv = [];
  let s = -1;
  for (let i = 0; i <= n; i++) {
    const c = i < n && heightAt(pts[i][0], pts[i][1]) >= floors[i] + TUN.CLEAR + TUN.ROOF_T;
    if (c && s < 0) s = i;
    if (!c && s >= 0) { iv.push([s, i - 1]); s = -1; }
  }
  const merged = [];
  for (const r of iv) {
    const last = merged[merged.length - 1];
    if (last && cum[r[0]] - cum[last[1]] <= TUN_GAP_CLOSE) last[1] = r[1];
    else merged.push([...r]);
  }
  return merged
    .filter(([a, b]) => cum[b] - cum[a] >= TUN_COV_MIN)
    .map(([a, b]) => [cum[a], cum[b], a, b]);
}
// ---- 地下道(平地下穿;2026-07-28 使用者需求;2026-07-29 引道改制「隧道方法」)----
// 隧道與地下道是**兩種東西**:隧道 = 道路平坦、鑽進突起的地形(深度來自山);
// 地下道 = **地形平坦、道路在地形之下**,路面自一端下沉、穿過去後另一端再爬回地表(深度來自挖)。
// 舊制的隧道路面是「兩端洞口地表高的直線內插」⇒ 平地上下沉量恆 0、永遠藏不住天花板
// ⇒ 整條當一般道路(2026-07-28 之前的已知缺口:圖資明明是地下道,遊戲裡只有一條平街)。
//
// 改制沿用隧道那一整套(牆/天花/橫樑/照明/門洞/打洞/走廊/slab 共用),差異收斂成三件事:
//   ① **路面剖面**:平坦 tunnel way 改吃「下沉剖面」—— 兩端各往外延伸一段**引道**
//      (沿端點切線,夾在圖界內,與外部一般道路對齊),路面以 smoothstep 自地表沉到 −sink;
//      中段平底 ⇒ 原地表(完全不開挖)自然高過 路面 + CLEAR + ROOF_T
//      ⇒ tunnelCoverIntervals 照原判定判成覆蓋段 = 洞段(頂上就是原本那片地/那條橫向道路)。
//   ② **引道開挖剖面收窄成垂直路塹**(run.cut 旗標,carveTunnels):過渡帶只到 hw+CUT_W,
//      山體隧道維持 hw+7 斜壁。出入口只在道路頭尾兩端 —— 舊 hw+7 緩斜壁在平地上是一圈
//      走得下去的碗(= 從地下道**側面**挖出入口),收窄後路塹外的地表保持平坦,
//      兩側只剩擋土牆 + 緣石帶,MUST NOT 再長出可通行的側向斜坡。
//   ③ **引道另登記 open 物理段**(tunnelSegs open:true,見 buildRoads):surfaceAt 捕捉讓
//      單位站在精確的下沉剖面上、_updatePlayer 的隧道側壁閘擋住從溝底爬牆側出 ——
//      但 open 段 MUST NOT 上傳伺服器 slab、MUST NOT 擋彈道(_slabHitT)、MUST NOT 當天花
//      (ceilingAt)、MUST NOT 回報 lev=2:露天路塹頭上是天空,不是隧道。
//      洞口那面橫塞斷面的土牆照舊由 punchPortalHoles 打穿(= 出入口的「可穿透透明牆」),
//      邊緣由 collar + 緣石帶修飾 —— 與山體隧道同一套洞口處理。
// 共用同一條命脈的代價是零:sink=0 時 tunFloorAt 逐位元退回舊公式、run 無 cut 旗標時
// carveTunnels 逐位元同舊剖面(山體隧道行為不動)。
//
// MARGIN    覆蓋餘裕:地表微起伏時洞段才不會被判斷開(下沉量 MUST > CLEAR + ROOF_T + 微起伏)
// SINK_MAX  下沉上限:再深就不是地下道,是把平地挖成峽谷 ⇒ 放棄(§4 寧缺勿錯)
// GRADE     引道目標縱坡;GRADE_MAX 空間不足時可壓到的最大縱坡(更陡就放棄)。
//           smoothstep 的峰值斜率 = 1.5 × sink / ramp ⇒ ramp = 1.5 × sink / grade(引道長由此推導,MUST NOT 手寫)
// BOX_MIN   平底洞段最短長度:短於此不成洞
// EDGE      引道外端距圖界的最小餘裕(引道不得延伸出地圖)
// COPE      引道路塹的**邊緣修飾**帶寬:自牆頂往外鋪到地表的平頂緣石(MUST ≥ carveTunnels 的
//           路塹過渡帶外緣 hw+CUT_W,並蓋住地形網格 ~8.3m 拉伸殘坡,否則殘坡會從緣石外緣露出來)
// KERB      引道護欄高:牆頂高出地表這麼多(從外面看是「一般路面 → 緣石 → 護欄 → 下沉車道」)
const UND = { MARGIN: 1.2, SINK_MAX: 18, GRADE: 0.12, GRADE_MAX: 0.22, BOX_MIN: 24, EDGE: 6, COPE: 8, KERB: 0.45 };
// 准建地下道的道路分級:**只有車行道**。人行地下道(footway/path + tunnel)在圖資裡極常見,
// 照建的話會為了一條人行步道在廣場上挖出 16m 寬、10m 深的壕溝 —— 現實中那是窄樓梯通道。
// (山體隧道不受此限:那是地形本來就高過路面,不是我們挖出來的。)
const UND_HW = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|(motorway|trunk|primary|secondary|tertiary)_link)$/;
/**
 * 隧道/地下道的路面高(**單一縫**:carve 指派、buildRoads 路面/牆/標線/門洞、markGradeCorridors
 * 走廊淨空四個消費端 MUST 共用這一支,分家就是「牆與路面錯層」)。
 *   山體隧道(sink 不存在或 0):兩端洞口地表高的直線內插 —— 逐位元同 2026-07-28 之前。
 *   地下道(sink > 0):同一條直線基準再減去 smoothstep 下沉剖面(兩端引道、中段平底)。
 * @param tw   way._tun[ri] 記錄:{ hA, hB, sink?, ramp? }
 * @param sunk false = 只要「基準線」(= 未下沉的地表道路高):引道護欄頂/緣石帶要對齊一般路面
 */
function tunFloorAt(tw, s, total, sunk = true) {
  const base = tw.hA + (tw.hB - tw.hA) * (s / (total || 1));
  if (!sunk || !tw.sink) return base;
  const r = tw.ramp || 1;
  const t = Math.max(0, Math.min(1, s / r, (total - s) / r));
  return base - tw.sink * (t * t * (3 - 2 * t));   // smoothstep:坡頂/坡底切線皆為 0 ⇒ 與一般道路 C1 連續
}
/**
 * 地下道規劃(單一縫;純幾何、零 rnd ⇒ 跨客戶端同一份)。
 * 輸入是**裁切後、densify 前**的世界折線;回傳 null = 不建地下道(呼叫端退回一般道路,
 * 即 2026-07-28 之前的行為)。回傳物件即 way._tun 記錄所需的全部欄位。
 * 放棄條件(§4 失敗策略 = 降級不例外,寧缺勿錯):
 *   ①非車行道 ②要挖得比 SINK_MAX 還深 ③引道擠不出 GRADE_MAX 以內的縱坡
 *   ④走廊碰到水域(泡水的地下道 = 水底隧道,不是這裡要做的東西)⑤平底洞段短於 BOX_MIN
 */
function underpassPlan(raw, tags, heightAt, opt) {
  if (!raw || raw.length < 2) return null;
  if (!UND_HW.test(tags?.highway || '')) return null;
  const arc = (p) => { const c = [0]; for (let i = 1; i < p.length; i++) c.push(c[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])); return c; };
  // 結構半寬:呼叫端傳 strucHw(tags)(carve 迴圈的 hwWay;離線工具 venue_field 同一份)。
  // 預設 8 = PASS_W/2 的字面值 —— 本函式以「抽原文執行」被離線稽核/工具吃,拿不到模組常數。
  const hw = opt.hw || 8;
  // 全寬地表取樣(2026-08-05 使用者回報「深度不夠導致兩側牆超出地表」「天花板應低於地表」):
  // 要藏進地下的是**整個斷面**(兩側牆線 ±hw、天花外擴 +0.6 = ceilSegs 同款),不是只有中心線。
  // 只量中心線,側向緩坡 / 8.3m 網格細碎起伏就讓牆頂與頂板從路側出土(合成場實測:側向 6% 坡
  // 出土 0.2~0.4m、網格起伏最大 1.09m),而頂板一出土就是一座隱形站立面(surfaceAt 取
  // max(地形, roof))+ 兩端與伺服器 slab 分家。逐點取中心線與兩側牆線三枚的最小值當「地表」。
  const gMinOf = (p) => {
    const gm2 = new Array(p.length);
    for (let i = 0; i < p.length; i++) {
      const a2 = p[Math.max(0, i - 1)], c2 = p[Math.min(p.length - 1, i + 1)];
      let dx = c2[0] - a2[0], dz = c2[1] - a2[1];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const [x, z] = p[i], w = hw + 0.6;
      gm2[i] = Math.min(heightAt(x, z), heightAt(x + dz * w, z - dx * w), heightAt(x - dz * w, z + dx * w));
    }
    return gm2;
  };
  // ① 下沉量(初估):在**未延伸**的折線上量「直線剖面還差多少才藏得住整個斷面」的最大值 ——
  //    只拿來推導引道延伸長度;定案值在 ②-b 於延伸後的基準線上收斂。
  //    平坦地形 ⇒ 恆等於 CLEAR + ROOF_T + MARGIN;地表起伏處自動加深,洞段才不會中途斷開。
  const p0 = densify(raw, ROAD_SEG), c0 = arc(p0), t0 = c0[c0.length - 1] || 1;
  const gA = heightAt(p0[0][0], p0[0][1]), gB = heightAt(p0[p0.length - 1][0], p0[p0.length - 1][1]);
  const gm0 = gMinOf(p0);
  let sink = TUN.CLEAR + TUN.ROOF_T + UND.MARGIN;
  for (let i = 0; i < p0.length; i++) {
    const lin = gA + (gB - gA) * (c0[i] / t0);
    const need = lin + TUN.CLEAR + TUN.ROOF_T + UND.MARGIN - gm0[i];
    if (need > sink) sink = need;
  }
  if (sink > UND.SINK_MAX) return null;
  // ② 引道長:由下沉量與縱坡推導(MUST NOT 手寫);兩端各沿端點切線外延,夾在圖界內。
  //    延伸不足的那一端不是失敗 —— 引道會改往 way 內部吃(下方 ramp 夾制),只是洞段變短。
  const want = 1.5 * sink / UND.GRADE;
  const grow = (p, q) => {
    let dx = p[0] - q[0], dz = p[1] - q[1];
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    let t = want;
    if (dx > 1e-6) t = Math.min(t, (opt.maxX - p[0]) / dx);
    else if (dx < -1e-6) t = Math.min(t, (opt.minX - p[0]) / dx);
    if (dz > 1e-6) t = Math.min(t, (opt.maxZ - p[1]) / dz);
    else if (dz < -1e-6) t = Math.min(t, (opt.minZ - p[1]) / dz);
    return t > 1 ? [p[0] + dx * t, p[1] + dz * t] : null;
  };
  const n = raw.length;
  const head = grow(raw[0], raw[1]), tail = grow(raw[n - 1], raw[n - 2]);
  const ext = [...(head ? [head] : []), ...raw, ...(tail ? [tail] : [])];
  const pts = densify(ext, ROAD_SEG), cum = arc(pts), total = cum[cum.length - 1] || 1;
  const hA = heightAt(pts[0][0], pts[0][1]), hB = heightAt(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  for (const p of pts) if (heightAt(p[0], p[1]) <= WATER.LEVEL + WATER.SWAMP_BAND) return null;
  // ②-b 下沉量在**延伸後**的基準線上收斂(2026-08-05):最終路面吃的基準線是 hA→hB(延伸端點
  //    的地表高),與 ① 量的 gA→gB 不是同一條 —— 延伸端點落在土丘上就把整條基準線抬高,①
  //    量出的覆蓋餘裕(MARGIN 只有 1.2m)被無聲吃掉;覆蓋段也常自 smoothstep 過門檻處起算、
  //    伸進 ① 沒量到的延伸帶。逐輪:以現值取 ramp → 對平底段(已達全深)逐點要求
  //    全寬地表 ≥ 路面 + CLEAR + ROOF_T + MARGIN → 不足就加深(引道跟著變長)。
  //    單調遞增、SINK_MAX 有界 ⇒ 必收斂;平地上第一輪即定(逐位元同 ①)。
  const gm = gMinOf(pts);
  let ramp = 0;
  for (let it = 0; it < 8; it++) {
    ramp = Math.min(1.5 * sink / UND.GRADE, (total - UND.BOX_MIN) / 2);
    let need = sink;
    for (let i = 0; i < pts.length; i++) {
      if (Math.min(cum[i], total - cum[i]) < ramp) continue;   // 引道帶:蓋不住的本來就是露天路塹
      const lin = hA + (hB - hA) * (cum[i] / total);
      const d = lin + TUN.CLEAR + TUN.ROOF_T + UND.MARGIN - gm[i];
      if (d > need) need = d;
    }
    if (need <= sink + 1e-6) break;
    sink = need;
    if (sink > UND.SINK_MAX) return null;
  }
  if (ramp < 1.5 * sink / UND.GRADE_MAX) return null;   // 引道擠不出 GRADE_MAX 以內的縱坡
  const tw = { hA, hB, sink, ramp };
  const floors = cum.map((s) => tunFloorAt(tw, s, total));
  const intervals = tunnelCoverIntervals(pts, cum, floors, heightAt);
  // ③ 全寬覆蓋檢核 + 拆縫(2026-08-05):tunnelCoverIntervals 只問**中心線**,TUN_GAP_CLOSE 又會
  //    把 ≤36m 的缺口縫成蓋廊 —— 山體隧道的蓋廊頂上是山,縫得對;地下道的缺口是「藏不住結構
  //    的露頭」,縫進覆蓋段 = 牆與頂板從平地冒出來、天花板高過地表(使用者點名的病灶)。
  //    逐點以全寬 gm 重驗,蓋不住的點把區間拆開;拆剩的短段(< TUN_COV_MIN)退回露天路塹
  //    (§4 寧缺勿錯 —— 蓋不住就不蓋,MUST NOT 靠改地形把它蓋起來:天花板上方的地表地貌不可動)。
  //    平底段經 ②-b 保證 MARGIN 餘裕 ⇒ 正常拆不出縫,這刀只修引道過渡帶邊緣與縫合殘段。
  const covOK = (i) => gm[i] >= floors[i] + TUN.CLEAR + TUN.ROOF_T;
  const iv2 = [];
  for (const [, , i0, i1] of intervals) {
    let a2 = -1;
    for (let i = i0; i <= i1 + 1; i++) {
      const c2 = i <= i1 && covOK(i);
      if (c2 && a2 < 0) a2 = i;
      if (!c2 && a2 >= 0) {
        if (cum[i - 1] - cum[a2] >= TUN_COV_MIN) iv2.push([cum[a2], cum[i - 1], a2, i - 1]);
        a2 = -1;
      }
    }
  }
  if (iv2.reduce((a, [s0, s1]) => a + (s1 - s0), 0) < UND.BOX_MIN) return null;
  return { ...tw, pts, cum, total, floors, intervals: iv2 };
}
const TUN_WALL_SAMP = 2.5;   // 土牆體檢的側向取樣間距(公尺;地形格 ~8.3m,三枚取樣已跨格)
/**
 * 隧道側向土牆體檢 → 明隧道判定(單一縫,2026-07-28)。
 * `tunnelCoverIntervals` 只逐點問「**中心線**上方的地表藏不藏得住天花板」—— 藏得住就當洞內,
 * 兩側牆整段立起、天花板墊在山體底下。但側向沒人管:單邊土牆薄到剩幾公尺(山腰蜿蜒路)、
 * 被引道開挖擦掉、或本來就是縫合蓋廊段(地表比天花還低)時,從外面看就是一片混凝土浮在
 * 山坡上,坡面與結構之間一道直接看穿到洞內的縫。這種地方現實中蓋的是**明隧道**:
 * 結構自己站在地面上,有外露頂板、落地的擋土 facade、扶壁。
 *
 * 判定純幾何(逐頂點、逐側、無 `rnd` ⇒ 跨客戶端同一份),**三個條件同時成立**才算開放側:
 *   ① 藏不住:自隧道邊緣往外量 `TUN.WALL_MIN`,任一取樣點的地表低於**頂板頂面**(路面 + CLEAR + ROOF_T)。
 *   ② 牆背沒有實體支撐(**近帶岩背例外**,2026-07-31 使用者回報「山壁側牆沒建完整、走得穿」):
 *      牆背 `NEAR_W` 內只要有任一取樣點高過頂板 = 牆背貼著實體土/岩(山壁、峽谷岩脊 —— 燕子口
 *      正是薄岩脊,脊後才落谷)⇒ 該側 MUST 維持整面隧道牆;只看「7m 內有低點」會把柱列開向
 *      一面岩壁,玩家看到的就是「山壁側只有矮牆 + 柱間直接是裸地形」。
 *   ③ **這一側真的在地形之外**(`TUN.OUT_W`,2026-08-01 使用者定案):牆外 OUT_W 內有取樣點
 *      落到**路面**以下 = 結構那一側浮在地形之上(臨谷/臨崖)⇒ 柱列。反過來「地表低於頂板但
 *      仍高於路面」= 覆蓋薄的**貫穿隧道**(牆背整段是土)⇒ 兩側都是牆,與深埋段同待遇。
 *      沒有 ③ 的話,金龍隧道那種只差 0.2~1.5m 就蓋滿頂板的真山體隧道會被整段判成明隧道 ——
 *      柱列開向山肚子,`carveGalleryBands` 還會把山壁真的挖掉一條溝(2026-08-01 使用者回報)。
 * 本函式跑三次(carveGalleryBands 呼叫端在**開挖前**、buildRoads / markGradeCorridors 在**開挖後**),
 * 三次 MUST 同解:①② 吃 heightAt 但開挖只降不升 ⇒ 只會更「開放」不會翻回牆;③ 吃天然地形
 * ⇒ 對開挖**恆定**。分家的代價是「柱外淨空帶沒挖卻長出柱列」(金龍隧道實案,見 natAt)。
 * **只在覆蓋段判**(敞開段/洞口的牆本來就收成零高,見 buildRoads)。
 *
 * 回傳逐頂點 `{ open, gy, nx, nz }`:
 *   open  該側改明隧道;**膨脹一格** —— 單點抖動會在山壁裡留下一段 6m 長的孤立 facade。
 *   gy    側坡地表最低點(facade 落地基準),取前後一格的窗口最小值:頂點間距 ROAD_SEG=6m
 *         大於側向取樣距,單點值會在窪處讓 facade 底緣漏出一道縫。
 *   nx/nz 該側的側向單位法線(= 牆面緞帶用的同一組)—— facade / 頂板 / 扶壁**共用這一份**,
 *         各自再算一次中央差分就是第二個縫(擺位與取樣方向一分家,牆就量錯坡)。
 * @param side +1 / −1
 * @param natAt 天然地形取樣器(`terrain.natureAt`;預設 = heightAt)—— 條件③ 只認天然地形,
 *   我們自己挖出來的路塹/斜壁/整平台不算「在地形之外」。本函式在**開挖前**(carveGalleryBands
 *   呼叫端)與**開挖後**(buildRoads / markGradeCorridors)各跑一次,吃同一份天然地形才同解。
 */
function tunnelWallProfile(pts, floors, cov, heightAt, hw, side, natAt = heightAt) {
  const n = pts.length;
  const raw = [];
  for (let i = 0; i < n; i++) {
    const [x, z] = pts[i];
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(n - 1, i + 1)];
    let dx = c[0] - a[0], dz = c[1] - a[1];
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const nx = dz * side, nz = -dx * side;
    const top = floors[i] + TUN.CLEAR + TUN.ROOF_T;   // 頂板頂面 = 土牆該蓋過的高度
    let gy = Infinity, thin = false, backed = false, outside = false;
    // 取樣點含**兩端**(牆面外 0.5m ~ WALL_MIN 整數點):`d += SAMP` 那種寫法會在最後一步
    // 越界而漏掉最外圈,實際只量到 5.5m —— 門檻寫 7 卻量 5.5 = 旋鈕失真。
    const nS = Math.max(2, Math.ceil((TUN.WALL_MIN - 0.5) / TUN_WALL_SAMP) + 1);
    for (let k = 0; k < nS; k++) {
      const d = hw + 0.5 + (TUN.WALL_MIN - 0.5) * k / (nS - 1);
      const h = heightAt(x + nx * d, z + nz * d);
      if (h < gy) gy = h;
      if (h < top) thin = true;
      else if (d - hw <= TUN.NEAR_W) backed = true;   // 近帶有高於頂板的土/岩 = 牆背有實體支撐
    }
    // 側向落差掃描:牆外 OUT_W 內有沒有低於**路面**的**天然**地表(= 這一側在地形之外)。
    // gy 刻意不吃這段(矮牆落地基準只認 WALL_MIN 帶,擴到谷底就沉到看不見的地方去了)。
    const nO = Math.max(2, Math.ceil((TUN.OUT_W - 0.5) / TUN_WALL_SAMP) + 1);
    for (let k = 0; k < nO && !outside; k++) {
      const d = hw + 0.5 + (TUN.OUT_W - 0.5) * k / (nO - 1);
      if (natAt(x + nx * d, z + nz * d) < floors[i]) outside = true;
    }
    raw.push({ bare: thin && !backed && outside, gy, nx, nz });
  }
  return raw.map((r, i) => ({
    open: !!cov[i] && (r.bare || !!raw[i - 1]?.bare || !!raw[i + 1]?.bare),
    gy: Math.min(r.gy, raw[i - 1]?.gy ?? Infinity, raw[i + 1]?.gy ?? Infinity),
    nx: r.nx, nz: r.nz,
  }));
}
// 高架橋橋面在兩端地面之上的抬升量(公尺):淨空 > 最大機甲(~4.5m)+ 餘裕 ⇒ 機甲從橋下通過不卡;
// 橋面底緣另登記為天花碰撞(game.js),機甲跳不穿橋。
const BRIDGE_RISE = 7.5;
function roadWidth(tags) {
  const base = ROAD_W[tags.highway] || 4;
  const lanes = parseInt(tags.lanes, 10) || 0;
  return lanes ? Math.max(base, lanes * 3.2) : base;   // 寬度依圖資車道數
}
// 由寬度反推車道數(單一縫;3.2m/線是全檔唯一換算比例,markings 車道分隔線與路面鋪裝判定
// 共用這一支,MUST NOT 各自手寫 /3.2)。roadWidth 已把圖資 lanes 值折進寬度,故此處不必
// 再讀一次 tags.lanes。
const roadLaneN = (tags) => roadWidth(tags) / 3.2;
/**
 * 立體結構(橋/隧道/地下道)的通行半寬 —— **單一縫**:buildRoads 的路面/牆、markGradeCorridors
 * 的走廊、carveTunnels 的開挖剖面共用這一支。分家的後果是開挖寬度小於路面寬度 ⇒ 路面兩緣埋進土裡。
 */
const strucHw = (tags) => isPedestrianWay(tags)
  ? Math.max(roadWidth(tags) / 2, PED_PLAN.FOOTBRIDGE_MIN_W_M / 2)
  : Math.max(roadWidth(tags) / 2, PASS_W / 2);
/**
 * 塗裝車道半寬 —— **單一縫**(2026-07-30 使用者需求「橋/隧道/地下道內的馬路寬度與外部馬路
 * 標線與寬度要對齊」):標線(車道線/分向線/路緣線)、避車道邊帶、銜接漸縮帶三個消費端共用。
 * 一般道路的通行半寬本來就 = roadWidth/2 ⇒ 結構內外吃同一個值 = 車道數相同、路緣線接得上。
 * MUST NOT 在結構那側改吃 `strucHw`(遊戲性夾寬 ≥ PASS_W/2):16m 隧道會被畫成 5 車道鋪滿,
 * 與洞外 2 車道的路橫向錯開。也 MUST NOT 依「差額夠不夠寬」在車道寬與結構寬之間三元切換
 * (舊版寫法):差額不足 AVOID_MIN 的路段會悄悄退回結構寬,標線寬度隨圖資 lanes 值在洞口跳動。
 */
const carriageHw = (tags) => roadWidth(tags) / 2;
/**
 * 結構端銜接漸縮帶(2026-07-30 使用者需求「接合處貼合」)。結構通行寬夾到 ≥ PASS_W/2、外部是
 * 真實路寬 ⇒ 洞口/橋頭橫向差一階(路面憑空外擴,且橋/隧節點刻意不入 nodeArms ⇒ 沒有路口
 * 縮減梯形可補)。往結構**外**延伸 ROAD_FLARE_M 補一片同色路面楔形,半寬由結構寬 smoothstep
 * 收到車道寬 —— 兩端切線為 0(接結構端、接一般路端都不折角)。
 * 純視覺:MUST NOT 進 decks / tunnelSegs / cols / 走廊 / 伺服器碰撞(通行寬唯一縫仍是 strucHw)。
 */
const ROAD_FLARE_M = 12;
const flareHw = (hw, cw, t) => {
  const u = Math.min(1, Math.max(0, t));
  return hw + (cw - hw) * (u * u * (3 - 2 * u));
};
// 路面顏色(cel-shaded):城市柏油 / 綠地泥土 / 裸露地礫石;主/次略有深淺
function roadColor(biome, main) {
  if (biome === 'urban') return main ? 0x3a3f45 : 0x4a4640;
  if (biome === 'green') return main ? 0x6f5b3e : 0x77603f;
  if (biome === 'bare') return main ? 0x8c7c5a : 0x94855f;
  if (biome === 'wet') return main ? 0x5c5a48 : 0x6a6350;
  return main ? 0x44484d : 0x50493f;
}

/**
 * 把圖資道路(或離線備援的兵線)畫成貼地賽璐璐路面。
 * 純視覺:掛在 biomes group,不進射擊 raycast、不描邊。
 * 依地貌 + 主/次分色批次合併(每色一個 Mesh),寬度取自圖資車道數。
 * 賽璐璐精修(botw_plan):4 頂點截面 — 路緣 18% 為頂點色「手繪墨線帶」;
 * 市區主幹道加虛線中線;材質帶低頻水彩 wash 打破長路面單色。
 */
const ROAD_SEG = 6;   // 路面貼地取樣間距(公尺)
// 結構(隧道/地下道/明隧道)走廊的地物淨空外擴:MUST ≥ **最寬的那道開挖足跡**,
// 且 MUST NOT 手寫 —— 三道開挖各有自己的縫,漏掉最寬的那道就留下一圈「地物站在已挖掉的
// 地面上」的殘環(2026-08-01 真圖資實測:明隧道柱外淨空帶 GAL_CLEAR_W=9 > 舊值 8,
// 簷口外緣那 1m 環正好站著行道樹)。三道:carveTunnels 山體斜壁 hw+7(terrain.js nearOf,
// 該檔沒有匯出的常數 ⇒ 只有這個數字是手寫的)、引道緣石帶 hw+UND.COPE、明隧道柱外淨空帶
// hw+TUN.GAL_CLEAR_W。橋維持 hw+4(橋下淨空語意不同,不吃這個值)。
const STRUCT_CLEAR_PAD = Math.max(7, UND.COPE, TUN.GAL_CLEAR_W);
/** 折線細分:每段長度不超過 seg,回傳新折線(端點保留) */
function densify(pts, seg) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / seg));
    for (let k = 1; k <= n; k++) out.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
  }
  return out;
}

// ---- 路面材質塗層:程序生成 canvas 貼圖(柏油骨材/泥土車轍/礫石)----
// 白底 + 淡灰細節 → 與 roadColor 相乘 = 各地貌路色不變,只多「畫上去的路面質感」;
// 世界投影 UV + 鏡射重複,長路無接縫(與 ground.js 底毯同手法)。固定種子 = 全房一致。
const _roadTexCache = new Map();
function roadTex(kind) {
  if (_roadTexCache.has(kind)) return _roadTexCache.get(kind);
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const rnd = mulberry32(0x40AD ^ kind.charCodeAt(0));
  g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, S, S);
  if (kind === 'asphalt') {                        // 柏油:骨材噪點 + 髮絲裂縫 + 瀝青補丁
    for (let i = 0; i < 240; i++) {
      const v = 200 + (rnd() * 55 | 0);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(rnd() * S, rnd() * S, 1.6, 1.6);
    }
    g.strokeStyle = 'rgba(120,120,126,0.5)'; g.lineWidth = 1.4; g.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      let x = rnd() * S, y = rnd() * S;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += (rnd() - 0.5) * 30; y += (rnd() - 0.5) * 30; g.lineTo(x, y); }
      g.stroke();
    }
    g.fillStyle = 'rgba(190,190,196,0.5)';         // 補丁(重鋪的深色方塊)
    for (let i = 0; i < 3; i++) g.fillRect(rnd() * S, rnd() * S, 24 + rnd() * 30, 16 + rnd() * 22);
  } else if (kind === 'dirt') {                    // 泥土:縱向車轍雙帶 + 土斑
    for (const x0 of [S * 0.3, S * 0.7]) {
      g.fillStyle = 'rgba(150,140,126,0.5)';
      g.fillRect(x0 - 5, 0, 10, S);
      g.fillStyle = 'rgba(255,255,255,0.35)';      // 轍間受光脊
      g.fillRect(x0 + 6, 0, 3, S);
    }
    for (let i = 0; i < 18; i++) {
      g.fillStyle = `rgba(160,150,132,${0.2 + rnd() * 0.25})`;
      g.beginPath(); g.arc(rnd() * S, rnd() * S, 4 + rnd() * 10, 0, 7); g.fill();
    }
  } else {                                         // gravel 礫石:碎石鱗片 + 描邊
    for (let i = 0; i < 130; i++) {
      const x = rnd() * S, y = rnd() * S, r = 2.5 + rnd() * 4;
      const v = 205 + (rnd() * 50 | 0);
      g.fillStyle = `rgb(${v},${v},${v - 6})`;
      g.beginPath(); g.ellipse(x, y, r, r * 0.7, rnd() * 3.2, 0, 7); g.fill();
      if (rnd() < 0.5) { g.strokeStyle = 'rgba(150,146,136,0.6)'; g.lineWidth = 1; g.stroke(); }
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
  _roadTexCache.set(kind, t);
  return t;
}
const ROAD_TEX_OF = { urban: 'asphalt', green: 'dirt', wet: 'dirt', bare: 'gravel' };

// ---- 道路附屬 3D 件(路燈/紅綠燈/行道樹):多零件 InstancedMesh,常數 draw call ----
// part = { g, y, px, pz, c, e? };px/pz 隨實例朝向 ry 旋轉,e = 恆亮燈件
function roadPropMeshes(group, parts, items) {
  if (!items.length) return;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const P = new THREE.Vector3(), S = new THREE.Vector3(), tint = new THREE.Color();
  for (const part of parts) {
    const mat = part.e
      ? toonMat(part.c, { emissive: new THREE.Color(part.e), emissiveIntensity: 0.95 })
      : toonMat(part.c);
    const m = new THREE.InstancedMesh(part.g, mat, items.length);
    items.forEach((it, i) => {
      E.set(0, it.ry, 0);
      Q.setFromEuler(E);
      const s = it.s || 1;
      const px = part.px || 0, pz = part.pz || 0;
      const ca = Math.cos(it.ry), sa = Math.sin(it.ry);
      P.set(it.x + (px * ca + pz * sa) * s, it.y + part.y * s, it.z + (-px * sa + pz * ca) * s);
      S.set(s, s, s);
      M.compose(P, Q, S);
      m.setMatrixAt(i, M);
      if (!part.e) {                               // 燈件保持定色;結構件微抖不像複製貼上
        const j1 = ((i * 2654435761) >>> 0) % 100 / 100;
        tint.setRGB(0.88 + j1 * 0.2, 0.88 + j1 * 0.2, 0.88 + j1 * 0.2);
        m.setColorAt(i, tint);
      }
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.castShadow = false;
    m.frustumCulled = false;
    group.add(m);
  }
}

// ---- 人行天橋門型鋼架：一個生成器族，所有橋只提供位置／寬度資料列 ----
function buildFootbridgeFrames(group, footbridgeFrames) {
  if (!footbridgeFrames.length) return;
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const mat = envMat(0x6d858e, { wash: 0.28, cool: 0.5 });
  const posts = new THREE.InstancedMesh(unit, mat, footbridgeFrames.length * 2);
  const beamsM = new THREE.InstancedMesh(unit, mat, footbridgeFrames.length);
  posts.name = 'ped-footbridge-posts'; beamsM.name = 'ped-footbridge-beams';
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const P = new THREE.Vector3(), S = new THREE.Vector3();
  let pi = 0;
  footbridgeFrames.forEach((f, fi) => {
    E.set(0, f.ry, 0); Q.setFromEuler(E);
    const rx = Math.cos(f.ry), rz = -Math.sin(f.ry);
    for (const side of [1, -1]) {
      P.set(f.x + rx * (f.w / 2 - 0.16) * side, f.y + 1.45, f.z + rz * (f.w / 2 - 0.16) * side);
      S.set(0.22, 2.9, 0.22); M.compose(P, Q, S); posts.setMatrixAt(pi++, M);
    }
    P.set(f.x, f.y + 2.88, f.z); S.set(f.w, 0.24, 0.34);
    M.compose(P, Q, S); beamsM.setMatrixAt(fi, M);
  });
  posts.instanceMatrix.needsUpdate = beamsM.instanceMatrix.needsUpdate = true;
  posts.castShadow = beamsM.castShadow = false;
  posts.frustumCulled = beamsM.frustumCulled = false;
  group.add(posts, beamsM);
}

// 靜態共享出入口幾何積木（半圓柱拱頂、拱券圓環、立柱圓柱、球形街燈、折板稜柱）
let _pedEntranceGeos = null;
function getPedEntranceGeos() {
  if (_pedEntranceGeos) return _pedEntranceGeos;
  const vaultG = new THREE.CylinderGeometry(1, 1, 1, 18, 1, false, 0, Math.PI);
  vaultG.rotateX(Math.PI / 2);
  const prismG = new THREE.CylinderGeometry(0, 1, 1, 4, 1);
  prismG.rotateY(Math.PI / 4);
  prismG.rotateX(Math.PI / 2);
  _pedEntranceGeos = {
    box: new THREE.BoxGeometry(1, 1, 1),
    arch_vault: vaultG,
    torus_arch: new THREE.TorusGeometry(1, 0.08, 8, 18, Math.PI),
    torus_arch_heavy: new THREE.TorusGeometry(1, 0.20, 8, 18, Math.PI),
    sphere: new THREE.SphereGeometry(1, 12, 10),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
    prism: prismG,
  };
  return _pedEntranceGeos;
}

const STYLE_PARTS = {
  // 1. 台北/高雄捷運 (Taipei / Kaohsiung MRT - 鋼構拱形採光罩、藍綠玻璃天棚、亮黃出口標示)
  arch_glass: [
    { geo: 'arch_vault', color: 'roof', lx: 0, ly: (d) => d.h * 0.58, lz: (d) => -d.d * 0.08,
      sx: (d) => d.w * 0.52, sy: (d) => d.h * 0.42, sz: (d) => d.d * 0.88, wash: 0.4 },
    { geo: 'torus_arch', color: 'frame', lx: 0, ly: (d) => d.h * 0.58, lz: (d) => d.d * 0.35,
      sx: (d) => d.w * 0.53, sy: (d) => d.h * 0.43, sz: () => 1.2 },
    { geo: 'torus_arch', color: 'frame', lx: 0, ly: (d) => d.h * 0.58, lz: (d) => -d.d * 0.08,
      sx: (d) => d.w * 0.53, sy: (d) => d.h * 0.43, sz: () => 1.2 },
    { geo: 'torus_arch', color: 'frame', lx: 0, ly: (d) => d.h * 0.58, lz: (d) => -d.d * 0.51,
      sx: (d) => d.w * 0.53, sy: (d) => d.h * 0.43, sz: () => 1.2 },
    { geo: 'cyl', color: 'frame', lx: (d) => -d.w * 0.5, ly: (d) => d.h * 0.30, lz: (d) => d.d * 0.35,
      sx: () => 0.14, sy: (d) => d.h * 0.60, sz: () => 0.14 },
    { geo: 'cyl', color: 'frame', lx: (d) => d.w * 0.5, ly: (d) => d.h * 0.30, lz: (d) => d.d * 0.35,
      sx: () => 0.14, sy: (d) => d.h * 0.60, sz: () => 0.14 },
    { geo: 'cyl', color: 'frame', lx: (d) => -d.w * 0.5, ly: (d) => d.h * 0.30, lz: (d) => -d.d * 0.51,
      sx: () => 0.14, sy: (d) => d.h * 0.60, sz: () => 0.14 },
    { geo: 'cyl', color: 'frame', lx: (d) => d.w * 0.5, ly: (d) => d.h * 0.30, lz: (d) => -d.d * 0.51,
      sx: () => 0.14, sy: (d) => d.h * 0.60, sz: () => 0.14 },
    { geo: 'box', color: 'wall', lx: (d) => -d.w * 0.5, ly: (d) => d.h * 0.32, lz: (d) => -d.d * 0.08,
      sx: () => 0.08, sy: (d) => d.h * 0.64, sz: (d) => d.d * 0.85, wash: 0.35 },
    { geo: 'box', color: 'wall', lx: (d) => d.w * 0.5, ly: (d) => d.h * 0.32, lz: (d) => -d.d * 0.08,
      sx: () => 0.08, sy: (d) => d.h * 0.64, sz: (d) => d.d * 0.85, wash: 0.35 },
    { geo: 'box', color: 'wall', lx: 0, ly: (d) => d.h * 0.32, lz: (d) => -d.d * 0.51,
      sx: (d) => d.w, sy: (d) => d.h * 0.64, sz: () => 0.08, wash: 0.35 },
    { geo: 'box', color: 'accent', lx: 0, ly: (d) => d.h * 0.62, lz: (d) => d.d * 0.35,
      sx: (d) => d.w * 0.92, sy: () => 0.28, sz: () => 0.18 },
    { geo: 'box', fixed: 0x20272c, lx: 0, ly: () => 0.08, lz: (d) => -d.d * 0.08,
      sx: (d) => d.w * 0.76, sy: () => 0.16, sz: (d) => d.d * 0.76, wash: 0.08 },
  ],

  // 2. 巴黎地鐵 (Paris Métro - Hector Guimard 新藝術風格銅綠鑄鐵與琥珀燈球)
  art_nouveau: [
    { geo: 'box', color: 'roof', lx: 0, ly: (d) => d.h * 0.88, lz: (d) => d.d * 0.08,
      sx: (d) => d.w * 1.12, sy: () => 0.16, sz: (d) => d.d * 0.65, rx: -0.18, wash: 0.35 },
    { geo: 'torus_arch', color: 'frame', lx: 0, ly: (d) => d.h * 0.68, lz: (d) => d.d * 0.36,
      sx: (d) => d.w * 0.48, sy: (d) => d.h * 0.38, sz: () => 1.4 },
    { geo: 'cyl', color: 'frame', lx: (d) => -d.w * 0.48, ly: (d) => d.h * 0.52, lz: (d) => d.d * 0.36,
      sx: () => 0.16, sy: (d) => d.h * 1.04, sz: () => 0.16 },
    { geo: 'cyl', color: 'frame', lx: (d) => d.w * 0.48, ly: (d) => d.h * 0.52, lz: (d) => d.d * 0.36,
      sx: () => 0.16, sy: (d) => d.h * 1.04, sz: () => 0.16 },
    { geo: 'sphere', color: 'accent', lx: (d) => -d.w * 0.48, ly: (d) => d.h * 1.08, lz: (d) => d.d * 0.36,
      sx: () => 0.34, sy: () => 0.34, sz: () => 0.34, wash: 0.6 },
    { geo: 'sphere', color: 'accent', lx: (d) => d.w * 0.48, ly: (d) => d.h * 1.08, lz: (d) => d.d * 0.36,
      sx: () => 0.34, sy: () => 0.34, sz: () => 0.34, wash: 0.6 },
    { geo: 'box', color: 'wall', lx: (d) => -d.w * 0.48, ly: (d) => d.h * 0.24, lz: (d) => -d.d * 0.08,
      sx: () => 0.16, sy: (d) => d.h * 0.48, sz: (d) => d.d * 0.86 },
    { geo: 'box', color: 'wall', lx: (d) => d.w * 0.48, ly: (d) => d.h * 0.24, lz: (d) => -d.d * 0.08,
      sx: () => 0.16, sy: (d) => d.h * 0.48, sz: (d) => d.d * 0.86 },
    { geo: 'box', color: 'wall', lx: 0, ly: (d) => d.h * 0.24, lz: (d) => -d.d * 0.51,
      sx: (d) => d.w * 0.96, sy: (d) => d.h * 0.48, sz: () => 0.16 },
    { geo: 'box', color: 'accent', lx: 0, ly: (d) => d.h * 0.84, lz: (d) => d.d * 0.36,
      sx: (d) => d.w * 0.72, sy: () => 0.26, sz: () => 0.12 },
    { geo: 'box', fixed: 0x20272c, lx: 0, ly: () => 0.08, lz: (d) => -d.d * 0.08,
      sx: (d) => d.w * 0.74, sy: () => 0.16, sz: (d) => d.d * 0.74, wash: 0.08 },
  ],

  // 3. 紐約地鐵 (NYC Subway - 墨綠鑄鐵欄杆與發光雙圓球街燈)
  nyc_kiosk: [
    { geo: 'box', color: 'roof', lx: 0, ly: (d) => d.h * 0.70, lz: (d) => -d.d * 0.18,
      sx: (d) => d.w * 0.98, sy: () => 0.14, sz: (d) => d.d * 0.72, rx: -0.22 },
    { geo: 'cyl', color: 'frame', lx: (d) => -d.w * 0.48, ly: (d) => d.h * 0.54, lz: (d) => d.d * 0.35,
      sx: () => 0.15, sy: (d) => d.h * 1.08, sz: () => 0.15 },
    { geo: 'cyl', color: 'frame', lx: (d) => d.w * 0.48, ly: (d) => d.h * 0.54, lz: (d) => d.d * 0.35,
      sx: () => 0.15, sy: (d) => d.h * 1.08, sz: () => 0.15 },
    { geo: 'sphere', color: 'accent', lx: (d) => -d.w * 0.48, ly: (d) => d.h * 1.12, lz: (d) => d.d * 0.35,
      sx: () => 0.36, sy: () => 0.36, sz: () => 0.36, wash: 0.5 },
    { geo: 'sphere', color: 'accent', lx: (d) => d.w * 0.48, ly: (d) => d.h * 1.12, lz: (d) => d.d * 0.35,
      sx: () => 0.36, sy: () => 0.36, sz: () => 0.36, wash: 0.5 },
    { geo: 'box', color: 'wall', lx: (d) => -d.w * 0.48, ly: (d) => d.h * 0.28, lz: (d) => -d.d * 0.08,
      sx: () => 0.12, sy: (d) => d.h * 0.56, sz: (d) => d.d * 0.86 },
    { geo: 'box', color: 'wall', lx: (d) => d.w * 0.48, ly: (d) => d.h * 0.28, lz: (d) => -d.d * 0.08,
      sx: () => 0.12, sy: (d) => d.h * 0.56, sz: (d) => d.d * 0.86 },
    { geo: 'box', color: 'wall', lx: 0, ly: (d) => d.h * 0.28, lz: (d) => -d.d * 0.51,
      sx: (d) => d.w * 0.96, sy: (d) => d.h * 0.56, sz: () => 0.12 },
    { geo: 'box', color: 'frame', lx: 0, ly: (d) => d.h * 0.72, lz: (d) => d.d * 0.35,
      sx: (d) => d.w * 0.92, sy: () => 0.26, sz: () => 0.14 },
    { geo: 'box', fixed: 0x20272c, lx: 0, ly: () => 0.08, lz: (d) => -d.d * 0.08,
      sx: (d) => d.w * 0.74, sy: () => 0.16, sz: (d) => d.d * 0.74, wash: 0.08 },
  ],

  // 4. 倫敦地鐵 (London Underground - Leslie Green 牛血紅陶磚與半圓懸臂雨棚)
  oxblood_tube: [
    { geo: 'arch_vault', color: 'roof', lx: 0, ly: (d) => d.h * 0.88, lz: (d) => d.d * 0.05,
      sx: (d) => d.w * 0.55, sy: () => 0.22, sz: (d) => d.d * 0.75 },
    { geo: 'box', color: 'frame', lx: (d) => -d.w * 0.46, ly: (d) => d.h * 0.48, lz: (d) => d.d * 0.34,
      sx: () => 0.48, sy: (d) => d.h * 0.96, sz: () => 0.48 },
    { geo: 'box', color: 'frame', lx: (d) => d.w * 0.46, ly: (d) => d.h * 0.48, lz: (d) => d.d * 0.34,
      sx: () => 0.48, sy: (d) => d.h * 0.96, sz: () => 0.48 },
    { geo: 'box', color: 'wall', lx: (d) => -d.w * 0.48, ly: (d) => d.h * 0.32, lz: (d) => -d.d * 0.10,
      sx: () => 0.38, sy: (d) => d.h * 0.64, sz: (d) => d.d * 0.82 },
    { geo: 'box', color: 'wall', lx: (d) => d.w * 0.48, ly: (d) => d.h * 0.32, lz: (d) => -d.d * 0.10,
      sx: () => 0.38, sy: (d) => d.h * 0.64, sz: (d) => d.d * 0.82 },
    { geo: 'box', color: 'frame', lx: (d) => -d.w * 0.48, ly: (d) => d.h * 0.74, lz: (d) => -d.d * 0.10,
      sx: () => 0.18, sy: (d) => d.h * 0.24, sz: (d) => d.d * 0.80, wash: 0.4 },
    { geo: 'box', color: 'frame', lx: (d) => d.w * 0.48, ly: (d) => d.h * 0.74, lz: (d) => -d.d * 0.10,
      sx: () => 0.18, sy: (d) => d.h * 0.24, sz: (d) => d.d * 0.80, wash: 0.4 },
    { geo: 'box', color: 'wall', lx: 0, ly: (d) => d.h * 0.44, lz: (d) => -d.d * 0.51,
      sx: (d) => d.w, sy: (d) => d.h * 0.88, sz: () => 0.36 },
    { geo: 'box', color: 'accent', lx: 0, ly: (d) => d.h * 0.82, lz: (d) => d.d * 0.36,
      sx: (d) => d.w * 0.88, sy: () => 0.28, sz: () => 0.22 },
    { geo: 'box', fixed: 0x20272c, lx: 0, ly: () => 0.08, lz: (d) => -d.d * 0.08,
      sx: (d) => d.w * 0.72, sy: () => 0.16, sz: (d) => d.d * 0.72, wash: 0.08 },
  ],

  // 5. 東京地下鐵 (Tokyo Metro - 消光鋼構懸臂雨遮與直櫺格柵)
  tokyo_slate: [
    { geo: 'box', color: 'roof', lx: 0, ly: (d) => d.h * 0.90, lz: (d) => d.d * 0.05,
      sx: (d) => d.w * 1.06, sy: () => 0.20, sz: (d) => d.d * 0.96, rx: -0.08 },
    { geo: 'box', fixed: 0xf4f0e6, lx: 0, ly: (d) => d.h * 0.82, lz: (d) => d.d * 0.12,
      sx: (d) => d.w * 0.86, sy: () => 0.06, sz: (d) => d.d * 0.68, wash: 0.6 },
    { geo: 'box', color: 'frame', lx: (d) => -d.w * 0.48, ly: (d) => d.h * 0.46, lz: (d) => d.d * 0.34,
      sx: () => 0.26, sy: (d) => d.h * 0.92, sz: () => 0.26 },
    { geo: 'box', color: 'frame', lx: (d) => d.w * 0.48, ly: (d) => d.h * 0.46, lz: (d) => d.d * 0.34,
      sx: () => 0.26, sy: (d) => d.h * 0.92, sz: () => 0.26 },
    { geo: 'box', color: 'wall', lx: (d) => -d.w * 0.48, ly: (d) => d.h * 0.42, lz: (d) => -d.d * 0.10,
      sx: () => 0.16, sy: (d) => d.h * 0.84, sz: (d) => d.d * 0.82 },
    { geo: 'box', color: 'wall', lx: (d) => d.w * 0.48, ly: (d) => d.h * 0.42, lz: (d) => -d.d * 0.10,
      sx: () => 0.16, sy: (d) => d.h * 0.84, sz: (d) => d.d * 0.82 },
    { geo: 'box', color: 'wall', lx: 0, ly: (d) => d.h * 0.42, lz: (d) => -d.d * 0.51,
      sx: (d) => d.w, sy: (d) => d.h * 0.84, sz: () => 0.18 },
    { geo: 'box', color: 'accent', lx: 0, ly: (d) => d.h * 0.84, lz: (d) => d.d * 0.36,
      sx: (d) => d.w * 0.82, sy: () => 0.24, sz: () => 0.16 },
    { geo: 'box', fixed: 0x20272c, lx: 0, ly: () => 0.08, lz: (d) => -d.d * 0.08,
      sx: (d) => d.w * 0.74, sy: () => 0.16, sz: (d) => d.d * 0.74, wash: 0.08 },
  ],

  // 6. 畢爾包/新加坡 Foster 高科技透明流線玻璃穹頂 (Fosterito)
  glass_cocoon: [
    { geo: 'arch_vault', color: 'roof', lx: 0, ly: (d) => d.h * 0.52, lz: (d) => -d.d * 0.05,
      sx: (d) => d.w * 0.54, sy: (d) => d.h * 0.48, sz: (d) => d.d * 0.94, wash: 0.45 },
    { geo: 'torus_arch', color: 'frame', lx: 0, ly: (d) => d.h * 0.52, lz: (d) => d.d * 0.38,
      sx: (d) => d.w * 0.55, sy: (d) => d.h * 0.49, sz: () => 1.2 },
    { geo: 'torus_arch', color: 'frame', lx: 0, ly: (d) => d.h * 0.52, lz: (d) => d.d * 0.10,
      sx: (d) => d.w * 0.55, sy: (d) => d.h * 0.49, sz: () => 1.2 },
    { geo: 'torus_arch', color: 'frame', lx: 0, ly: (d) => d.h * 0.52, lz: (d) => -d.d * 0.18,
      sx: (d) => d.w * 0.55, sy: (d) => d.h * 0.49, sz: () => 1.2 },
    { geo: 'torus_arch', color: 'frame', lx: 0, ly: (d) => d.h * 0.52, lz: (d) => -d.d * 0.48,
      sx: (d) => d.w * 0.55, sy: (d) => d.h * 0.49, sz: () => 1.2 },
    { geo: 'box', color: 'frame', lx: (d) => -d.w * 0.52, ly: () => 0.22, lz: (d) => -d.d * 0.05,
      sx: () => 0.22, sy: () => 0.44, sz: (d) => d.d * 0.94 },
    { geo: 'box', color: 'frame', lx: (d) => d.w * 0.52, ly: () => 0.22, lz: (d) => -d.d * 0.05,
      sx: () => 0.22, sy: () => 0.44, sz: (d) => d.d * 0.94 },
    { geo: 'torus_arch', color: 'accent', lx: 0, ly: (d) => d.h * 0.52, lz: (d) => d.d * 0.40,
      sx: (d) => d.w * 0.52, sy: (d) => d.h * 0.46, sz: () => 0.8, wash: 0.5 },
    { geo: 'box', fixed: 0x20272c, lx: 0, ly: () => 0.08, lz: (d) => -d.d * 0.08,
      sx: (d) => d.w * 0.78, sy: () => 0.16, sz: (d) => d.d * 0.78, wash: 0.08 },
  ],

  // 7. 柏林/維也納包浩斯地鐵門廊 (Bauhaus Portal)
  bauhaus_portal: [
    { geo: 'box', color: 'roof', lx: 0, ly: (d) => d.h * 0.92, lz: (d) => -d.d * 0.06,
      sx: (d) => d.w * 1.08, sy: () => 0.32, sz: (d) => d.d * 0.92 },
    { geo: 'box', color: 'frame', lx: 0, ly: (d) => d.h * 0.76, lz: (d) => d.d * 0.33,
      sx: (d) => d.w * 0.96, sy: () => 0.28, sz: () => 0.24 },
    { geo: 'box', color: 'wall', lx: (d) => -d.w * 0.48, ly: (d) => d.h * 0.44, lz: (d) => -d.d * 0.10,
      sx: () => 0.42, sy: (d) => d.h * 0.88, sz: (d) => d.d * 0.82 },
    { geo: 'box', color: 'wall', lx: (d) => d.w * 0.48, ly: (d) => d.h * 0.44, lz: (d) => -d.d * 0.10,
      sx: () => 0.42, sy: (d) => d.h * 0.88, sz: (d) => d.d * 0.82 },
    { geo: 'box', color: 'wall', lx: 0, ly: (d) => d.h * 0.44, lz: (d) => -d.d * 0.51,
      sx: (d) => d.w, sy: (d) => d.h * 0.88, sz: () => 0.36 },
    { geo: 'box', color: 'accent', lx: (d) => d.w * 0.46, ly: (d) => d.h * 1.14, lz: (d) => d.d * 0.33,
      sx: () => 0.48, sy: () => 0.48, sz: () => 0.48, wash: 0.5 },
    { geo: 'box', fixed: 0x20272c, lx: 0, ly: () => 0.08, lz: (d) => -d.d * 0.08,
      sx: (d) => d.w * 0.72, sy: () => 0.16, sz: (d) => d.d * 0.72, wash: 0.08 },
  ],

  // 8. 首爾/香港雙坡鋁板現代採光罩 (Metallic Gabled)
  metallic_gabled: [
    { geo: 'prism', color: 'roof', lx: 0, ly: (d) => d.h * 0.82, lz: (d) => -d.d * 0.08,
      sx: (d) => d.w * 0.52, sy: () => 0.65, sz: (d) => d.d * 0.88 },
    { geo: 'box', color: 'wall', lx: (d) => -d.w * 0.48, ly: (d) => d.h * 0.38, lz: (d) => -d.d * 0.08,
      sx: () => 0.10, sy: (d) => d.h * 0.76, sz: (d) => d.d * 0.85, wash: 0.35 },
    { geo: 'box', color: 'wall', lx: (d) => d.w * 0.48, ly: (d) => d.h * 0.38, lz: (d) => -d.d * 0.08,
      sx: () => 0.10, sy: (d) => d.h * 0.76, sz: (d) => d.d * 0.85, wash: 0.35 },
    { geo: 'box', color: 'frame', lx: (d) => -d.w * 0.48, ly: (d) => d.h * 0.44, lz: (d) => d.d * 0.34,
      sx: () => 0.28, sy: (d) => d.h * 0.88, sz: () => 0.28 },
    { geo: 'box', color: 'frame', lx: (d) => d.w * 0.48, ly: (d) => d.h * 0.44, lz: (d) => d.d * 0.34,
      sx: () => 0.28, sy: (d) => d.h * 0.88, sz: () => 0.28 },
    { geo: 'box', color: 'accent', lx: 0, ly: (d) => d.h * 0.72, lz: (d) => d.d * 0.34,
      sx: (d) => d.w * 0.88, sy: () => 0.24, sz: () => 0.16 },
    { geo: 'box', fixed: 0x20272c, lx: 0, ly: () => 0.08, lz: (d) => -d.d * 0.08,
      sx: (d) => d.w * 0.74, sy: () => 0.16, sz: (d) => d.d * 0.74, wash: 0.08 },
  ],

  // 9. 大型地下街商場大門廊 (Mall Portal)
  mall_portal: [
    { geo: 'box', color: 'roof', lx: 0, ly: (d) => d.h * 0.94, lz: (d) => d.d * 0.04,
      sx: (d) => d.w * 1.15, sy: () => 0.22, sz: (d) => d.d * 0.95 },
    { geo: 'box', color: 'frame', lx: 0, ly: (d) => d.h * 0.78, lz: (d) => d.d * 0.20,
      sx: (d) => d.w * 1.05, sy: () => 0.16, sz: (d) => d.d * 0.45 },
    { geo: 'box', color: 'accent', lx: (d) => d.w * 0.52, ly: (d) => d.h * 0.58, lz: (d) => d.d * 0.38,
      sx: () => 0.48, sy: (d) => d.h * 1.16, sz: () => 0.48, wash: 0.4 },
    { geo: 'sphere', color: 'accent', lx: (d) => d.w * 0.52, ly: (d) => d.h * 1.20, lz: (d) => d.d * 0.38,
      sx: () => 0.32, sy: () => 0.32, sz: () => 0.32, wash: 0.6 },
    { geo: 'box', color: 'frame', lx: (d) => -d.w * 0.48, ly: (d) => d.h * 0.45, lz: (d) => d.d * 0.35,
      sx: () => 0.36, sy: (d) => d.h * 0.90, sz: () => 0.36 },
    { geo: 'box', color: 'wall', lx: (d) => -d.w * 0.48, ly: (d) => d.h * 0.40, lz: (d) => -d.d * 0.10,
      sx: () => 0.12, sy: (d) => d.h * 0.80, sz: (d) => d.d * 0.80, wash: 0.35 },
    { geo: 'box', color: 'wall', lx: (d) => d.w * 0.48, ly: (d) => d.h * 0.40, lz: (d) => -d.d * 0.10,
      sx: () => 0.12, sy: (d) => d.h * 0.80, sz: (d) => d.d * 0.80, wash: 0.35 },
    { geo: 'box', fixed: 0x20272c, lx: 0, ly: () => 0.08, lz: (d) => -d.d * 0.08,
      sx: (d) => d.w * 0.80, sy: () => 0.16, sz: (d) => d.d * 0.80, wash: 0.08 },
  ],

  // 10. 歐洲古城石砌拱門地下道 (Stone Arch)
  stone_arch: [
    { geo: 'torus_arch_heavy', color: 'frame', lx: 0, ly: (d) => d.h * 0.58, lz: (d) => d.d * 0.32,
      sx: (d) => d.w * 0.46, sy: (d) => d.h * 0.46, sz: () => 1.6 },
    { geo: 'box', color: 'accent', lx: 0, ly: (d) => d.h * 1.02, lz: (d) => d.d * 0.34,
      sx: () => 0.48, sy: () => 0.52, sz: () => 0.52 },
    { geo: 'box', color: 'roof', lx: 0, ly: (d) => d.h * 0.94, lz: (d) => -d.d * 0.08,
      sx: (d) => d.w * 1.08, sy: () => 0.34, sz: (d) => d.d * 0.88 },
    { geo: 'box', color: 'wall', lx: (d) => -d.w * 0.46, ly: (d) => d.h * 0.44, lz: (d) => -d.d * 0.10,
      sx: () => 0.46, sy: (d) => d.h * 0.88, sz: (d) => d.d * 0.82 },
    { geo: 'box', color: 'wall', lx: (d) => d.w * 0.46, ly: (d) => d.h * 0.44, lz: (d) => -d.d * 0.10,
      sx: () => 0.46, sy: (d) => d.h * 0.88, sz: (d) => d.d * 0.82 },
    { geo: 'cyl', color: 'accent', lx: (d) => -d.w * 0.42, ly: (d) => d.h * 0.28, lz: (d) => -d.d * 0.08,
      sx: () => 0.08, sy: (d) => d.d * 0.78, sz: () => 0.08, rx: Math.PI / 2 },
    { geo: 'cyl', color: 'accent', lx: (d) => d.w * 0.42, ly: (d) => d.h * 0.28, lz: (d) => -d.d * 0.08,
      sx: () => 0.08, sy: (d) => d.d * 0.78, sz: () => 0.08, rx: Math.PI / 2 },
    { geo: 'box', fixed: 0x20272c, lx: 0, ly: () => 0.08, lz: (d) => -d.d * 0.08,
      sx: (d) => d.w * 0.70, sy: () => 0.16, sz: (d) => d.d * 0.70, wash: 0.08 },
  ],

  // 11. 現代幾何折板地下道 (Origami / Faceted Steel)
  origami: [
    { geo: 'box', color: 'roof', lx: 0, ly: (d) => d.h * 0.88, lz: (d) => d.d * 0.04,
      sx: (d) => d.w * 1.05, sy: () => 0.18, sz: (d) => d.d * 0.92, rx: -0.14, rz: 0.06 },
    { geo: 'box', color: 'frame', lx: (d) => -d.w * 0.46, ly: (d) => d.h * 0.46, lz: (d) => d.d * 0.32,
      sx: () => 0.22, sy: (d) => d.h * 0.92, sz: () => 0.22, rz: -0.12 },
    { geo: 'box', color: 'frame', lx: (d) => d.w * 0.46, ly: (d) => d.h * 0.46, lz: (d) => d.d * 0.32,
      sx: () => 0.22, sy: (d) => d.h * 0.92, sz: () => 0.22, rz: 0.12 },
    { geo: 'box', color: 'wall', lx: (d) => -d.w * 0.48, ly: (d) => d.h * 0.40, lz: (d) => -d.d * 0.10,
      sx: () => 0.18, sy: (d) => d.h * 0.80, sz: (d) => d.d * 0.80 },
    { geo: 'box', color: 'wall', lx: (d) => d.w * 0.48, ly: (d) => d.h * 0.40, lz: (d) => -d.d * 0.10,
      sx: () => 0.18, sy: (d) => d.h * 0.80, sz: (d) => d.d * 0.80 },
    { geo: 'box', color: 'accent', lx: 0, ly: (d) => d.h * 0.84, lz: (d) => d.d * 0.35,
      sx: (d) => d.w * 0.88, sy: () => 0.14, sz: () => 0.14, rz: 0.06, wash: 0.5 },
    { geo: 'box', fixed: 0x20272c, lx: 0, ly: () => 0.08, lz: (d) => -d.d * 0.08,
      sx: (d) => d.w * 0.74, sy: () => 0.16, sz: (d) => d.d * 0.74, wash: 0.08 },
  ],

  // 12. 北歐極簡全玻璃立方體 (Glass Cube)
  glass_cube: [
    { geo: 'box', color: 'roof', lx: 0, ly: (d) => d.h * 0.96, lz: (d) => -d.d * 0.08,
      sx: (d) => d.w * 0.98, sy: () => 0.12, sz: (d) => d.d * 0.88, wash: 0.4 },
    { geo: 'cyl', color: 'frame', lx: (d) => -d.w * 0.48, ly: (d) => d.h * 0.48, lz: (d) => d.d * 0.34,
      sx: () => 0.08, sy: (d) => d.h * 0.96, sz: () => 0.08 },
    { geo: 'cyl', color: 'frame', lx: (d) => d.w * 0.48, ly: (d) => d.h * 0.48, lz: (d) => d.d * 0.34,
      sx: () => 0.08, sy: (d) => d.h * 0.96, sz: () => 0.08 },
    { geo: 'cyl', color: 'frame', lx: (d) => -d.w * 0.48, ly: (d) => d.h * 0.48, lz: (d) => -d.d * 0.50,
      sx: () => 0.08, sy: (d) => d.h * 0.96, sz: () => 0.08 },
    { geo: 'cyl', color: 'frame', lx: (d) => d.w * 0.48, ly: (d) => d.h * 0.48, lz: (d) => -d.d * 0.50,
      sx: () => 0.08, sy: (d) => d.h * 0.96, sz: () => 0.08 },
    { geo: 'box', color: 'wall', lx: (d) => -d.w * 0.48, ly: (d) => d.h * 0.48, lz: (d) => -d.d * 0.08,
      sx: () => 0.06, sy: (d) => d.h * 0.96, sz: (d) => d.d * 0.84, wash: 0.45 },
    { geo: 'box', color: 'wall', lx: (d) => d.w * 0.48, ly: (d) => d.h * 0.48, lz: (d) => -d.d * 0.08,
      sx: () => 0.06, sy: (d) => d.h * 0.96, sz: (d) => d.d * 0.84, wash: 0.45 },
    { geo: 'box', color: 'wall', lx: 0, ly: (d) => d.h * 0.48, lz: (d) => -d.d * 0.50,
      sx: (d) => d.w * 0.96, sy: (d) => d.h * 0.96, sz: () => 0.06, wash: 0.45 },
    { geo: 'box', color: 'accent', lx: 0, ly: () => 0.12, lz: (d) => -d.d * 0.08,
      sx: (d) => d.w * 0.98, sy: () => 0.08, sz: (d) => d.d * 0.86, wash: 0.5 },
    { geo: 'box', fixed: 0x20272c, lx: 0, ly: () => 0.08, lz: (d) => -d.d * 0.08,
      sx: (d) => d.w * 0.74, sy: () => 0.16, sz: (d) => d.d * 0.74, wash: 0.08 },
  ],
};

const DEFAULT_PARTS = [
  { key: 'roof', geo: 'box', color: 'roof', lx: 0, ly: (d) => d.h - 0.16, lz: (d) => -d.d * 0.12,
    sx: (d) => d.w + 0.45, sy: () => 0.28, sz: (d) => d.d * 0.82 },
  { key: 'left', geo: 'box', color: 'wall', lx: (d) => -d.w / 2, ly: (d) => d.h * 0.43, lz: (d) => -d.d * 0.12,
    sx: () => 0.24, sy: (d) => d.h * 0.86, sz: (d) => d.d * 0.82 },
  { key: 'right', geo: 'box', color: 'wall', lx: (d) => d.w / 2, ly: (d) => d.h * 0.43, lz: (d) => -d.d * 0.12,
    sx: () => 0.24, sy: (d) => d.h * 0.86, sz: (d) => d.d * 0.82 },
  { key: 'back', geo: 'box', color: 'frame', lx: 0, ly: (d) => d.h * 0.43, lz: (d) => -d.d * 0.53,
    sx: (d) => d.w, sy: (d) => d.h * 0.86, sz: () => 0.22 },
  { key: 'lintel', geo: 'box', color: 'frame', lx: 0, ly: (d) => d.h * 0.78, lz: (d) => d.d * 0.31,
    sx: (d) => d.w, sy: () => 0.30, sz: () => 0.28 },
  { key: 'fascia', geo: 'box', color: 'accent', lx: 0, ly: (d) => d.h * 0.87, lz: (d) => d.d * 0.33,
    sx: (d) => d.w * 0.90, sy: () => 0.22, sz: () => 0.14 },
  { key: 'stair', geo: 'box', fixed: 0x20272c, lx: 0, ly: () => 0.08, lz: (d) => -d.d * 0.08,
    sx: (d) => d.w * 0.72, sy: () => 0.16, sz: (d) => d.d * 0.72, wash: 0.08 },
];

/** 地下步道／車站入口。一個生成器吃 PED_ARCHETYPES 資料列；名目尺寸同時產生外觀與碰撞盒。 */
function buildPedestrianEntrances(group, terrain, sites) {
  const rows = [];
  for (const site of sites || []) {
    const archKey = site.archetype || site.kind || 'underpass';
    const def = PED_ARCHETYPES[archKey] || PED_ARCHETYPES[site.kind] || PED_ARCHETYPES.underpass;
    if (site.x < terrain.minX + 5 || site.x > terrain.maxX - 5
      || site.z < terrain.minZ + 5 || site.z > terrain.maxZ - 5) continue;
    const y = terrain.heightAt(site.x, site.z);
    if (y < 0.4) continue;
    rows.push({ ...site, def, archKey, y });
  }
  if (!rows.length) return { built: 0, signSpots: [], cols: [] };

  const geos = getPedEntranceGeos();
  const val = (v, d) => typeof v === 'function' ? v(d) : v;
  const jointM = PED_PLAN.JOINT_M;

  // 零件表是款式外觀，不應靠每款手寫「剛好碰到」的數字。先量出實際屋頂下緣，
  // 再把箱型牆向上補到屋頂並讓水平接點互疊；這只作用在表現層，不改入口 OBB。
  const localBounds = (part, d) => {
    const geo = geos[part.geo || 'box'] || geos.box;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const e = new THREE.Euler(part.rx || 0, part.ry || 0, part.rz || 0, 'YXZ');
    const q = new THREE.Quaternion().setFromEuler(e);
    const s = new THREE.Vector3(val(part.sx, d), val(part.sy, d), val(part.sz, d));
    const p = new THREE.Vector3(val(part.lx, d), val(part.ly, d), val(part.lz, d));
    const m = new THREE.Matrix4().compose(p, q, s);
    return geo.boundingBox.clone().applyMatrix4(m);
  };
  const jointFit = (parts, d) => {
    const roofParts = parts.filter((part) => part.color === 'roof');
    if (!roofParts.length) return new Map();
    const roofBox = roofParts.map((part) => localBounds(part, d)).reduce((a, b) => a.union(b));
    const fit = new Map();
    for (const part of parts) {
      if (part.geo !== 'box' || part.color !== 'wall') continue;
      const box = localBounds(part, d);
      const sx = val(part.sx, d), sy = val(part.sy, d), sz = val(part.sz, d);
      const ly = val(part.ly, d);
      const rise = Math.max(0, roofBox.min.y + jointM - box.max.y);
      fit.set(part, {
        sx: sx + jointM * 2,
        sy: sy + rise,
        sz: sz + jointM * 2,
        ly: ly + rise * 0.5,
      });
    }
    return fit;
  };

  for (const kind of Object.keys(PED_ARCHETYPES)) {
    const list = rows.filter((r) => r.archKey === kind || (!r.archKey && r.kind === kind));
    if (!list.length) continue;
    const def = PED_ARCHETYPES[kind];
    const parts = STYLE_PARTS[def.style] || STYLE_PARTS[kind] || DEFAULT_PARTS;
    const fit = jointFit(parts, def);
    for (let pi = 0; pi < parts.length; pi++) {
      const part = parts[pi];
      const color = part.fixed ?? def[part.color] ?? def.frame;
      const baseGeo = geos[part.geo || 'box'] || geos.box;
      const mesh = new THREE.InstancedMesh(baseGeo,
        envMat(color, { wash: part.wash ?? (part.fixed ? 0.08 : 0.3), cool: part.cool ?? 0.45 }), list.length);
      mesh.name = `ped-entrance-${kind}-${part.key || pi}`;
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
      const P = new THREE.Vector3(), S = new THREE.Vector3();
      list.forEach((r, i) => {
        const d = r.def;
        const lx = val(part.lx, d), ly = val(part.ly, d), lz = val(part.lz, d);
        const ca = Math.cos(r.ry), sa = Math.sin(r.ry);
        const px = r.x + lx * ca + lz * sa;
        const py = r.y + ly;
        const pz = r.z - lx * sa + lz * ca;
        P.set(px, py, pz);
        E.set(part.rx || 0, r.ry + (part.ry || 0), part.rz || 0, 'YXZ');
        Q.setFromEuler(E);
        const f = fit.get(part);
        S.set(f?.sx ?? val(part.sx, d), f?.sy ?? val(part.sy, d), f?.sz ?? val(part.sz, d));
        if (f) P.y += f.ly - ly;
        M.compose(P, Q, S);
        mesh.setMatrixAt(i, M);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = false;
      mesh.frustumCulled = false;
      group.add(mesh);
    }
  }
  const signSpots = rows.map((r) => {
    const d = r.def, f = d.d * 0.34;
    return {
      x: r.x + Math.sin(r.ry) * f,
      y: r.y + d.h * 0.76,
      z: r.z + Math.cos(r.ry) * f,
      ry: r.ry,
      tags: { name: r.signText || (r.stationTags?.name || r.tags?.name || (r.kind === 'station' ? '捷運站' : '地下道')) },
      signText: r.signText || (r.stationTags?.name || r.tags?.name),
    };
  });
  // 入口不是可進入的實際地下關卡：前方階梯只是地面建築外觀。每座以 PED_ARCHETYPES 的同一份
  // 名目寬／深／高登記完整 OBB，避免機體從開口鑽入後穿過背牆，也避免款式零件表各自再抄一份量體。
  const cols = rows.map((r) => pedestrianEntranceCollider(r, r.y));
  return { built: rows.length, signSpots, cols };
}


/**
 * 隧道/橋樑分段合併:同類(tunnel/bridge)且共用端點節點的 way 併成一條完整鏈。
 * OSM 的長隧道/長橋常被切成多段,共用節點深在山體內/河面上 —— 不合併的話,
 * 每半段各自拿「端點地表高」內插路面/橋面,剖面會在結構中段爬回地表(洞內隱形牆、橋面中垂)。
 * 節點鍵取 6 位小數(≈0.11m)= OSM 節點同一性;分岔(同節點 ≥3 條同類 way)不併,保守維持原樣。
 */
// 方向連續性:雙孔隧道/雙幅橋常共用洞口節點 —— 只准「順向接續」的 way 相併,倒鉤(平行孔折返)
// 不併,否則 U/V 形鏈的路面內插會整段錯掉。回傳 our 出向 · 對方入向的 cos。
function dirDot(a, b, c, d) {
  const kx = 111320 * Math.cos(a.lat * Math.PI / 180), ky = 110540;
  const v1 = [(b.lon - a.lon) * kx, (b.lat - a.lat) * ky];
  const v2 = [(d.lon - c.lon) * kx, (d.lat - c.lat) * ky];
  const l1 = Math.hypot(...v1) || 1, l2 = Math.hypot(...v2) || 1;
  return (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2);
}

/**
 * way 串鏈的共用走訪(mergeGradeChains 橋隧鏈 / joinWaterRouteWays 跨水路線**共用這一支**):
 * 以「共用端點節點」為邊,是否接起來由 canJoin(cur, next, dot) 決定。
 * 回傳 [{tags, geometry}](每條鏈一項,鏈序 = 種子序)。節點鍵取 6 位小數(≈0.11m)= OSM 節點同一性。
 * branchDot = null(橋隧鏈):節點上恰有 2 條候選才續行 —— 分岔/真洞口保守不併(平行雙孔共用洞口節點)。
 * branchDot = 數值(跨水路線):分岔節點也准續行,但只取 dot ≥ 該值的「最順向」那條(街道 T/十字
 * 路口的直行續段);degree 2 時兩者行為逐項相同。
 */
function chainWays(ways, canJoin, branchDot = null, snapTol = 0) {
  const key = (p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  // 端點鄰近聚類(snapTol>0,2026-07-28 相接兩橋接縫下沉修):相接但未共 OSM 節點(端點座標相差
  // <snapTol 公尺)的鏈也能續接 —— deckAt 只在真正外端把橋面降回地面,消除假端點處的 V 形谷。
  // 確定性:唯一端點依 key 排序後單鏈接聚類、每群取字典序最小 key 當代表(先建者=最小);純幾何、
  // 無 rnd、不動抽樣枚數 ⇒ 跨客戶端逐位元一致。degree-2 與 dirDot 守衛照舊,真立體交叉/分岔不誤併。
  let nkey = key;
  if (snapTol > 0) {
    const uniq = new Map();
    for (const w of ways) for (const p of [w.geometry[0], w.geometry[w.geometry.length - 1]]) {
      if (!uniq.has(key(p))) uniq.set(key(p), p);
    }
    const rep = new Map(), clusters = [];   // clusters: [{ rep:key, pts:[{lat,lon}] }]
    for (const k of [...uniq.keys()].sort()) {
      const p = uniq.get(k);
      const kx = 111320 * Math.cos(p.lat * Math.PI / 180), ky = 110540;
      let host = null;
      for (const c of clusters) {
        if (c.pts.some((q) => Math.hypot((p.lon - q.lon) * kx, (p.lat - q.lat) * ky) <= snapTol)) { host = c; break; }
      }
      if (host) { host.pts.push(p); rep.set(k, host.rep); }
      else { clusters.push({ rep: k, pts: [p] }); rep.set(k, k); }
    }
    nkey = (p) => rep.get(key(p)) ?? key(p);
  }
  const endMap = new Map();   // 節點鍵 -> [{w, end}](end: 0=頭 1=尾)
  for (const w of ways) {
    for (const [k, end] of [[nkey(w.geometry[0]), 0], [nkey(w.geometry[w.geometry.length - 1]), 1]]) {
      if (!endMap.has(k)) endMap.set(k, []);
      endMap.get(k).push({ w, end });
    }
  }
  const used = new Set();
  const out = [];
  for (const w of ways) {
    if (used.has(w)) continue;
    used.add(w);
    let chain = [...w.geometry];
    for (const fwd of [true, false]) {
      let cur = w, guard = 0;
      while (guard++ < 60) {
        const endPt = fwd ? chain[chain.length - 1] : chain[0];
        const here = endMap.get(nkey(endPt)) || [];
        if (branchDot == null && here.length !== 2) break;   // 真洞口/橋台或分岔:停
        const ours = fwd ? [chain[chain.length - 2] || chain[0], endPt] : [chain[1] || chain[0], chain[0]];
        let best = null;
        for (const e of here) {
          if (used.has(e.w)) continue;
          const g = [...e.w.geometry];
          if (e.end === (fwd ? 1 : 0)) g.reverse();          // 對準接續方向
          const theirs = fwd ? [g[0], g[1]] : [g[g.length - 1], g[g.length - 2]];
          const dot = fwd ? dirDot(ours[0], ours[1], theirs[0], theirs[1])
            : dirDot(ours[1], ours[0], theirs[1], theirs[0]);
          if (branchDot != null && here.length > 2 && dot < branchDot) continue;   // 分岔:只接最順向的直行段
          if (!canJoin(cur, e.w, dot)) continue;
          if (!best || dot > best.dot) best = { w: e.w, g, dot };
        }
        if (!best) break;
        used.add(best.w);
        cur = best.w;
        chain = fwd ? chain.concat(best.g.slice(1)) : best.g.slice(0, -1).concat(chain);
      }
    }
    out.push({ tags: { ...w.tags }, geometry: chain });
  }
  return out;
}

// 橋鏈端點鄰近聚類距離(公尺):相接但未共 OSM 節點的兩橋併成一條(見 chainWays snapTol)。
// = 半個車道,遠小於 PASS_W/2=8 ⇒ 不會跨接到不相干的橋。隧道維持 0(精確節點),放寬會擾動
// tunnelCoverIntervals/洞口落點與規則 #5,且平行雙孔靠精確比對保守不併。
const BRIDGE_SNAP_M = 2.5;
function mergeGradeChains(roads) {
  const plain = roads.filter((w) => !((w.tags?.tunnel || w.tags?.bridge) && w.geometry?.length >= 2));
  const out = [];
  for (const kind of ['tunnel', 'bridge']) {
    // tunnel 優先歸隧道鏈:同時掛兩種 tag 的 way 不會進兩類
    const ways = roads.filter((w) => w.tags?.[kind] && !(kind === 'bridge' && w.tags.tunnel) && w.geometry?.length >= 2);
    // 隧道鏈 MUST 同 tunnel 值才併(2026-07-31):tunnel=yes(山體隧道,覆蓋看地形)與
    // tunnel=avalanche_protector(明隧道實體結構,整段強制覆蓋)是兩種結構;chainWays 併鏈
    // 只保種子 way 的 tags,混併會讓落石棚被吸進山體隧道鏈(或反之)= 強制覆蓋旗標丟失。
    // 太魯閣「隧道→明隧道→隧道」相接序列拆成三段結構,共用節點端 c0<4 不立門洞,接縫無害。
    out.push(...chainWays(ways, (a, b, dot) => dot >= 0.17 && (kind !== 'tunnel' || a.tags?.tunnel === b.tags?.tunnel), null, kind === 'bridge' ? BRIDGE_SNAP_M : 0));   // 倒鉤(平行孔折返)不併;橋端點鄰近聚類
  }
  // 鏈排在前(2026-07-22 倫敦橋數浮動案):buildRoads 的 maxRuns 截斷依陣列序,舊版鏈排尾端
  // 使密路網市區的橋/隧道整批優先被犧牲(泰晤士河真橋忽有忽無)。立體結構是兵線與地標
  // 關鍵物件,MUST 先建。
  return out.concat(plain);
}

/**
 * 跨水路線的 way 串接(2026-07-24 使用者需求「一條路線上的兩座橋不要太靠近,太靠近就直接連在一起」)。
 * OSM 把一條連續街道切成多條 way,而 splitWaterPieces 是**逐 way(逐 run)**判泡水段 ——
 * 夾在兩段泡水 way 之間的短 way(威尼斯實測 17m / 23m / 34m)自成一個乾段,兩側各建一座橋
 * ⇒ 下橋隨即又上橋的 V 形谷。先把「共用端點、順向、同分級」的 way 串成一條再交給
 * splitWaterPieces,兩段泡水就落在**同一個 run**,由其 JOIN_M 規則併成一座連續橋;
 * 橋面剖面(deckAt)也只在真正的兩端起降。
 * **只在接點兩側至少一條沾水時才串**,且一條都沒串到就原樣回傳 ⇒ 無水地圖的 way 陣列逐項不變
 * (rnd 序列 / 建物植被佈局零影響)。橋/隧道 way 不在候選內(已由 mergeGradeChains 併鏈,
 * 且 way._tun 的逐 run 索引不可打亂)。
 */
function joinWaterRouteWays(roads, terrain, center) {
  const isCand = (w) => !w.tags?.bridge && !w.tags?.tunnel && w.geometry?.length >= 2;
  const cand = roads.filter(isCand);
  if (cand.length < 2) return roads;
  const wetWay = new Map();   // way -> 是否有泡水取樣點(densify 後判,與 splitWaterPieces 同一把尺)
  let anyWet = false;
  for (const w of cand) {
    const pts = densify(w.geometry.map((g) => llToWorld(g.lat, g.lon, center)), ROAD_SEG);
    const wet = pts.some(([x, z]) => isWaterPt(terrain, x, z));
    wetWay.set(w, wet);
    anyWet ||= wet;
  }
  if (!anyWet) return roads;   // 無水地圖:原陣列原封不動
  // 街道網格的直角轉角也是 degree-2 節點 ⇒ 方向門檻比橋隧鏈(0.17)嚴,只串大致續行的
  const chains = chainWays(cand, (a, b, dot) => dot >= 0.5
    && a.tags.highway === b.tags.highway
    && (wetWay.get(a) || wetWay.get(b)), 0.85);
  if (chains.length === cand.length) return roads;   // 一條都沒串到 ⇒ 完全無副作用
  return chains.concat(roads.filter((w) => !isCand(w)));
}

// ---- 橋樑單層原則(2026-07-22 倫敦上下兩層橋案)----
// 每座橋的 deck 高度剖面由「自己鏈端點的地表高」內插(deckAt),兩座側向重疊的橋剖面
// 幾乎必然不同 → 玩家看到上下兩層 + 兩套欄杆/橋墩。重疊來源有二,各修一刀:
//  ① OSM 雙向分離車道:兩條平行 bridge way 各建一座 ≥PASS_W 寬的橋 → dedupeParallelBridges
//  ② 兵線跨水補橋疊在真橋上 → dropLaneBridges(兵線走廊內真橋剔除,補橋是唯一結算)
// 皆為純幾何確定性判定,不耗共享 rnd。

/** 橋 way 的 deck 半寬(與 buildRoads 2134 行同一夾制) */
const bridgeHw = (tags) => strucHw(tags || {});

/** pts(世界座標折線取樣點)落在 poly 折線側向 threshold 內的比例(0~1) */
function overlapFrac(pts, poly, threshold) {
  if (!pts.length || poly.length < 2) return 0;
  const t2 = threshold * threshold;
  let hit = 0;
  for (const [x, z] of pts) {
    let inside = false;
    for (let i = 1; i < poly.length && !inside; i++) {
      const [ax, az] = poly[i - 1], [bx, bz] = poly[i];
      const ex = bx - ax, ez = bz - az;
      const L2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L2));
      const dx = x - (ax + ex * t), dz = z - (az + ez * t);
      if (dx * dx + dz * dz < t2) inside = true;
    }
    if (inside) hit++;
  }
  return hit / pts.length;
}

/** ①平行雙幅去重:只在同交通角色內去重；人行天橋與車行橋並排是合法規劃，兩者皆保留。 */
function dedupeParallelBridges(roads, center) {
  const brs = [];
  roads.forEach((w, i) => {
    if (!w.tags?.bridge || w.tags.tunnel || !(w.geometry?.length >= 2)) return;
    const pts = densify(w.geometry.map((p) => llToWorld(p.lat, p.lon, center)), ROAD_SEG);
    let len = 0;
    for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of pts) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    brs.push({ i, pts, len, hw: bridgeHw(w.tags), ped: isPedestrianBridge(w.tags), minX, maxX, minZ, maxZ });
  });
  brs.sort((a, b) => b.len - a.len);   // 長者優先保留(確定性:len 相同時維持插入序)
  const drop = new Set();
  for (let a = 0; a < brs.length; a++) {
    const A = brs[a];
    if (drop.has(A.i)) continue;
    for (let b = a + 1; b < brs.length; b++) {
      const B = brs[b];
      if (drop.has(B.i)) continue;
      if (A.ped !== B.ped) continue;   // 車行橋旁的人行天橋不是雙向分隔車道
      const th = A.hw + B.hw;
      if (B.minX > A.maxX + th || B.maxX < A.minX - th || B.minZ > A.maxZ + th || B.maxZ < A.minZ - th) continue;
      if (overlapFrac(B.pts, A.pts, th) >= 0.6) drop.add(B.i);
    }
  }
  return drop.size ? roads.filter((_, i) => !drop.has(i)) : roads;
}

/**
 * 平行雙孔隧道去重(2026-07-28 金龍隧道「兩端洞口 3 vs 2 不對稱」根因):橋有 dedupeParallelBridges
 * 的單層原則,隧道**沒有對應刀**。金龍同一座山有多條重疊 tunnel way(2 車道 + 2 footway 近乎逐點
 * 重合 + 2 service),進 buildRoads 後 footway/service 被 hw=max(roadWidth/2, PASS_W/2)=8 撐成 16m 大洞
 * 疊在車道孔上,各自在兩端立門洞,不同 way 子集在兩山面解出的門數不同 = 使用者看到的不對稱。
 * 邏輯完全鏡射 dedupeParallelBridges(長者保留、overlapFrac ≥ 0.6 才剔、AABB 早退、穩定排序 = 確定性):
 * 與更長 way 側向大面積重合的短 way(footway/service)剔除;互距 > 帶寬的真雙孔車道(overlapFrac < 0.6)
 * 雙雙保留 ⇒ 兩端各 2 孔對稱。整條 way 保留或整條剔除,不打亂倖存 way 的逐 run way._tun 索引。
 * MUST 排在 carve 指派 way._tun 之前(呼叫端在 mergeGradeChains/dedupeParallelBridges 之後、carve 之前)。
 * 候選 MUST 過 strucTunnel 資格閘:不合格 way(人行/室內)已不成洞,不參與去重、也 MUST NOT
 * 以「長者優先」壓掉合格隧道(前科:澀谷 1178m footway 閉環把 90m 玉川通り trunk 整條剔除
 * ⇒ 資格閘上線後洞與路雙雙蒸發);不合格 way 一律保留、攤平成一般小徑。
 */
function dedupeParallelTunnels(roads, center) {
  const tns = [];
  roads.forEach((w, i) => {
    if (!strucTunnel(w.tags) || !(w.geometry?.length >= 2)) return;
    const pts = densify(w.geometry.map((p) => llToWorld(p.lat, p.lon, center)), ROAD_SEG);
    let len = 0;
    for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of pts) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    tns.push({ i, pts, len, hw: bridgeHw(w.tags), minX, maxX, minZ, maxZ });   // bridgeHw 與結構建置共用 strucHw
  });
  tns.sort((a, b) => b.len - a.len);   // 長者優先保留(確定性:len 相同時維持插入序)
  const drop = new Set();
  for (let a = 0; a < tns.length; a++) {
    const A = tns[a];
    if (drop.has(A.i)) continue;
    for (let b = a + 1; b < tns.length; b++) {
      const B = tns[b];
      if (drop.has(B.i)) continue;
      const th = A.hw + B.hw;
      if (B.minX > A.maxX + th || B.maxX < A.minX - th || B.minZ > A.maxZ + th || B.maxZ < A.minZ - th) continue;
      if (overlapFrac(B.pts, A.pts, th) >= 0.6) drop.add(B.i);
    }
  }
  return drop.size ? roads.filter((_, i) => !drop.has(i)) : roads;
}

/**
 * ②兵線走廊內真橋剔除:兵線跨水段一律自建全跨補橋(引道錨點在兵線上,NPC 沿線必上得去),
 * 與其側向大面積重疊(≥35% 取樣點)的真 OSM 橋剔除 → 同處恆單層。
 * X 形斜交(重疊比例低)保留 —— 立體交叉是現實存在的結構,只有平行堆疊才是破圖。
 */
function dropLaneBridges(roads, wetPieces, center) {
  if (!wetPieces.length) return roads;
  return roads.filter((w) => {
    if (!w.tags?.bridge || w.tags.tunnel || !(w.geometry?.length >= 2)) return true;
    if (isPedestrianBridge(w.tags)) return true;   // 兵線車橋不能取代旁側的獨立人行天橋
    const pts = densify(w.geometry.map((p) => llToWorld(p.lat, p.lon, center)), ROAD_SEG);
    const th = bridgeHw(w.tags) + PASS_W / 2;
    for (const piece of wetPieces) if (overlapFrac(pts, piece, th) >= 0.35) return false;
    return true;
  });
}

/**
 * 兩條世界折線是否「交會」:任一線段對真正**交叉**(叉積異號 → 距 0),或端點/中段互相貼近 ≤ gap。
 * 純幾何、不耗共享 rnd。O(nA·nB),橋 way 段數少 + 呼叫端 AABB 早退 ⇒ 成本可忽略。
 */
function polylinesMeet(A, B, gap) {
  const g2 = gap * gap;
  const ptSeg2 = (px, py, ax, ay, bx, by) => {
    const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1;
    let t = ((px - ax) * ex + (py - ay) * ey) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - (ax + ex * t), dy = py - (ay + ey * t); return dx * dx + dy * dy;
  };
  const cross = (ox, oy, px, py, qx, qy) => (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
  for (let i = 1; i < A.length; i++) {
    const [ax, ay] = A[i - 1], [bx, by] = A[i];
    for (let j = 1; j < B.length; j++) {
      const [cx, cy] = B[j - 1], [dx, dy] = B[j];
      const d1 = cross(ax, ay, bx, by, cx, cy), e1 = cross(ax, ay, bx, by, dx, dy);
      const d3 = cross(cx, cy, dx, dy, ax, ay), e3 = cross(cx, cy, dx, dy, bx, by);
      if (((d1 > 0) !== (e1 > 0)) && ((d3 > 0) !== (e3 > 0))) return true;   // 真正交叉
      if (gap > 0 && Math.min(ptSeg2(cx, cy, ax, ay, bx, by), ptSeg2(dx, dy, ax, ay, bx, by),
        ptSeg2(ax, ay, cx, cy, dx, dy), ptSeg2(bx, by, cx, cy, dx, dy)) <= g2) return true;   // 端點/T 字貼近
    }
  }
  return false;
}

/**
 * ③橋交會去重(2026-07-28 使用者需求「十字路口都有橋交會時只留一座橋」;2026-07-29 定案含**鐵路高架**)。
 * 兩座橋**幾何相交/交會**時只留高優先者,低優先者**整條剔除**。
 *   優先度:兵線補橋(wetPieces,恆最高)> **鐵路高架**(RAIL_RANK)> 大馬路(roadWidth 大)> 小馬路(roadWidth 小)。
 *   ⇒ 鐵路×道路交會時**保留鐵路**(高架優先,使用者定案);鐵路×鐵路 → 長者保留;道路×道路 → 舊制。
 * 鐵路走 fetchOsmFeatures/buildRails(bridge=yes 或 monorail 才升高架),故 rails 另傳入、另回傳過濾集。
 * **交會容差不對稱**:兩方皆道路 → CROSS_GAP(含端點/T 字貼近 —— 道路已由 mergeGradeChains 併鏈,貼近 = 真 T 交會);
 *   任一方是鐵路 → gap=0 **只認真正交叉**(鐵路**未**經 mergeGradeChains,同線相鄰段/junction 共端點會被 ≤2m 誤判成交會而砍斷整條鐵路)。
 * 與 dedupeParallelBridges(側向平行堆疊)互補。純幾何確定性(穩定排序 + AABB 早退,不耗共享 rnd);
 * MUST 排在 roadInput 定案前 + buildRails 之前(markGradeCorridors / buildRoads / buildRails 消費端吃同一份去重集)。
 * 整條保留或整條剔除,不打亂倖存 way 的逐 run 索引。回傳 { roads, rails }(各自過濾集)。
 */
const CROSS_GAP = 2;   // 交會判定容差(公尺):真正交叉恆 0;端點/T 字貼近 ≤2m 也算交會(平行堆疊已由 dedupeParallelBridges 處理)
const RAIL_RANK = 100; // 鐵路高架去重優先度:高於任何道路(motorway roadWidth ~12)⇒ 鐵路×道路保留鐵路
function dedupeCrossingBridges(roads, center, wetPieces = [], rails = []) {
  const aabbOf = (pts) => {
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const [x, z] of pts) { if (x < a) a = x; if (x > b) b = x; if (z < c) c = z; if (z > d) d = z; }
    return [a, b, c, d];
  };
  const gapFar = (p, q, g) => p[0] > q[1] + g || p[1] < q[0] - g || p[2] > q[3] + g || p[3] < q[2] - g;
  const brs = [];
  const add = (w, i, arr, rank) => {
    const pts = densify(w.geometry.map((p) => llToWorld(p.lat, p.lon, center)), ROAD_SEG);
    let len = 0;
    for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    brs.push({ i, arr, pts, rank, len, box: aabbOf(pts) });
  };
  roads.forEach((w, i) => {
    if (!w.tags?.bridge || w.tags.tunnel || !(w.geometry?.length >= 2)) return;
    add(w, i, 'road', roadWidth(w.tags));
  });
  // 鐵路高架 = bridge=yes 或 monorail(buildRails 對這兩者升高架 ⇒ 只有這兩者會與橋在空間交會)
  rails.forEach((w, i) => {
    if (!(w.tags?.bridge || w.tags?.railway === 'monorail') || !(w.geometry?.length >= 2)) return;
    add(w, i, 'rail', RAIL_RANK);
  });
  if (!brs.length) return { roads, rails };
  const dropRoad = new Set(), dropRail = new Set();
  const isDrop = (b) => (b.arr === 'rail' ? dropRail : dropRoad).has(b.i);
  const doDrop = (b) => (b.arr === 'rail' ? dropRail : dropRoad).add(b.i);
  const meetGap = (aRail, bRail) => (aRail || bRail) ? 0 : CROSS_GAP;   // 任一鐵路 → 只認真正交叉
  // ①兵線補橋恆勝:與任一兵線泡水段交會的橋(道路或鐵路)整條剔除(兵線是遊戲關鍵路徑)
  const laneBoxes = wetPieces.map(aabbOf);
  for (const B of brs) {
    const g = B.arr === 'rail' ? 0 : CROSS_GAP;
    for (let k = 0; k < wetPieces.length; k++) {
      if (gapFar(B.box, laneBoxes[k], g)) continue;
      if (polylinesMeet(B.pts, wetPieces[k], g)) { doDrop(B); break; }
    }
  }
  // ②互相交會:高優先保留(rank desc:鐵路 > 道路)、低優先整條剔除。等 rank → 長者保留 → 插入序(確定性)
  const live = brs.filter((b) => !isDrop(b)).sort((a, b) => b.rank - a.rank || b.len - a.len || a.i - b.i);
  for (let a = 0; a < live.length; a++) {
    const A = live[a];
    if (isDrop(A)) continue;
    for (let b = a + 1; b < live.length; b++) {
      const B = live[b];
      if (isDrop(B)) continue;
      const g = meetGap(A.arr === 'rail', B.arr === 'rail');
      if (gapFar(A.box, B.box, g)) continue;
      if (polylinesMeet(A.pts, B.pts, g)) doDrop(B);   // A 優先度 ≥ B ⇒ 剔除 B
    }
  }
  return {
    roads: dropRoad.size ? roads.filter((_, i) => !dropRoad.has(i)) : roads,
    rails: dropRail.size ? rails.filter((_, i) => !dropRail.has(i)) : rails,
  };
}

/** 世界公尺 → 經緯度(`llToWorld` 逆運算;道路格網量化與兵線跨水補橋的偽 way 用)。
 *  實作住 `data.js xzToLL`(含地圖主方位的反向旋轉)—— 本檔 MUST NOT 復辟第二份公式。 */
function worldToLL(x, z, center) {
  const [lat, lon] = xzToLL(x, z, center);
  return { lat, lon };
}

/**
 * 兵線道路補片：OSM 路網查詢有額度上限，兵線所踩的某條住宅路／產業道路可能沒被回傳。
 * 只補「沒有同向道路覆蓋」的乾地小段；已存在的 OSM 路面、橋隧與兵線跨水補橋都不重畫。
 * 兵線本身不量化，因為它也是伺服器導航幾何；補片只補表現層路面，不反向修改 cfg.lanes。
 */
function missingLaneRoadWays(lanes, roads, terrain, center) {
  if (!lanes?.length || !roads?.length) return [];
  const CELL = 32, grid = new Map();
  const cellKey = (i, j) => `${i},${j}`;
  for (const way of roads) {
    const pts = (way.geometry || []).map((p) => llToWorld(p.lat, p.lon, center));
    const reach = roadWidth(way.tags || {}) / 2 + 1.5;
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (len < 0.1) continue;
      const seg = { ax, az, bx, bz, dx, dz, l2: len * len, ux: dx / len, uz: dz / len, reach };
      const i0 = Math.floor((Math.min(ax, bx) - reach) / CELL), i1 = Math.floor((Math.max(ax, bx) + reach) / CELL);
      const j0 = Math.floor((Math.min(az, bz) - reach) / CELL), j1 = Math.floor((Math.max(az, bz) + reach) / CELL);
      for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) {
        const key = cellKey(k, j), arr = grid.get(key);
        if (arr) arr.push(seg); else grid.set(key, [seg]);
      }
    }
  }
  const covered = (ax, az, bx, bz) => {
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const dl = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / dl, uz = (bz - az) / dl;
    for (const s of grid.get(cellKey(Math.floor(mx / CELL), Math.floor(mz / CELL))) || []) {
      if (Math.abs(ux * s.ux + uz * s.uz) < 0.82) continue;   // 僅交叉、不共線，不算覆蓋
      let t = ((mx - s.ax) * s.dx + (mz - s.az) * s.dz) / s.l2;
      t = Math.max(0, Math.min(1, t));
      const ex = mx - (s.ax + s.dx * t), ez = mz - (s.az + s.dz * t);
      if (ex * ex + ez * ez <= s.reach * s.reach) return true;
    }
    return false;
  };
  const out = [];
  for (const lane of lanes) {
    const pts = densify(lane.map(([lat, lng]) => llToWorld(lat, lng, center)), ROAD_SEG);
    let run = null;
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const wet = terrainEnvCode(terrain, (ax + bx) / 2, (az + bz) / 2) !== 0;
      const missing = !wet && !covered(ax, az, bx, bz);
      if (missing) {
        if (!run) run = [[ax, az]];
        run.push([bx, bz]);
      } else if (run) {
        if (run.length >= 2) out.push({ tags: { highway: 'primary', lanes: '2' }, geometry: run.map(([x, z]) => worldToLL(x, z, center)) });
        run = null;
      }
    }
    if (run?.length >= 2) out.push({ tags: { highway: 'primary', lanes: '2' }, geometry: run.map(([x, z]) => worldToLL(x, z, center)) });
  }
  return out;
}

/** 水面判定(高程低於水面 或 衛星影像水色;純色規則不吃場地 mix、不耗共享 rnd)*/
function isWaterPt(terrain, x, z) {
  if (terrain.inDryBand?.(x, z)) return false;   // 兵線砲塔外接帶:強制乾地(壓過影像藍色水色,見 terrain.js 抬升)
  if (terrain.heightAt(x, z) < WATER.LEVEL + 0.05) return true;
  const c = terrain.sampleColor?.(x, z);
  return !!c && c[2] > c[0] + 14 && c[2] > c[1] + 6;
}

/**
 * 地形環境分類(2026-07-19;0 乾地 / 1 水域 / 2 沼澤)。純地形高程 + 衛星影像訊號,
 * 不吃場地 mix、不耗共享 rnd —— 客戶端涉水/狀態回報(game._envAt)與主機水沼遮罩烘烤
 * (main.js 上傳)共用同一規則,確保「玩家看到的濕地 = 伺服器判定的濕地」(WYSIWYG)。
 * 水域:沒入水面下(waterY 有值且高程 < 水面 + SHORE)或影像純水色;
 * 沼澤:近水低地綠植(高程在水面上 SWAMP_BAND 內、非人工鋪面),比照 ground.js 濕地促進。
 */
export function terrainEnvCode(terrain, x, z) {
  if (terrain.inDryBand?.(x, z)) return 0;   // 兵線砲塔外接帶:強制乾地(壓過影像藍色分支,見 terrain.js 抬升)
  // 地貌分界線帶(2026-08-13 使用者「確保水域/沼澤在分界線的區塊內不會觸發異常狀態」):
  // 沙灘/泥灘/小溪那條帶畫在哪裡,那裡就不算泡在水裡 —— 底毯的換手在「畫出來的那條線」上,
  // 而這一支量的是真實地形,兩者最多差半個帶寬(最寬 9m)。遮罩本身住 ground.js bandDryAt,
  // 由 main.js 在 buildBiomes **之後**裝上(建圖期恆為 null,見 buildBiomes 開頭的清空)
  if (terrain.inBorderBand?.(x, z)) return 0;
  const h = terrain.heightAt(x, z);
  const wy = terrain.waterY;
  const c = terrain.sampleColor?.(x, z);
  const blue = !!c && c[2] > c[0] + 14 && c[2] > c[1] + 6;
  if ((wy != null && h < wy + WATER.SHORE) || blue) return 1;
  if (wy != null && h < wy + WATER.SWAMP_BAND && (!c || (c[1] >= c[0] - 4 && c[1] >= c[2] - 4))) return 2;
  return 0;
}

/**
 * 沼澤水平面(2026-07-24 使用者需求「沼澤跟水域一樣有水平線,視線低於水平線呈現暗紫色」):
 * 水域有 terrain.js 的 waterY 藍色水盤;沼澤同理在 **swampY = waterY + SWAMP_BAND**(= terrainEnvCode
 * 沼澤分類界,單一縫 MUST NOT 另寫數字)鋪一片暗紫濁沼半透明盤。視線沒入此面下 →
 * game._updateWaterVeil 暗紫帷幕(判定共用同一條 swampY 線)。
 * **只在沼澤格(terrainEnvCode 2)出面** —— 不覆蓋水域(水盤在更低的 waterY,紫盤蓋上去會把水變紫)、
 * 不覆蓋乾地。DoubleSide:沒入面下抬頭仍見濁面(同水盤)。純視覺、不進 raycast(game.js 只打
 * terrain.mesh)、透明材質 outlinify 自動跳過。純幾何格取樣、不耗共享 rnd(佈局序列不受影響)。
 */
function buildSwampSurface(group, terrain) {
  const wy = terrain.waterY;
  if (wy == null) return;
  const swampY = wy + WATER.SWAMP_BAND;
  const { minX, maxX, minZ, maxZ } = terrain;
  const step = 4.0;   // ~4m 細分網格，確保頂點著色器能呈現波浪起伏與流暢過渡
  const cols = Math.min(480, Math.max(1, Math.ceil((maxX - minX) / step)));
  const rows = Math.min(480, Math.max(1, Math.ceil((maxZ - minZ) / step)));
  const cw = (maxX - minX) / cols, ch = (maxZ - minZ) / rows;
  const pos = [], nrm = [], idx = [], fade = [];
  let base = 0;

  // 計算頂點高度 (若鄰近水域則平滑過渡至 waterY，消除斷層直邊)
  const vertexH = (x, z) => {
    const code = terrainEnvCode(terrain, x, z);
    if (code === 2) return swampY;
    if (code === 1) return wy;
    const h = terrain.heightAt(x, z);
    return Math.min(swampY, Math.max(wy, h));
  };

  for (let i = 0; i < rows; i++) {
    const z0 = minZ + i * ch, z1 = z0 + ch, cz = z0 + ch / 2;
    for (let j = 0; j < cols; j++) {
      const x0 = minX + j * cw, x1 = x0 + cw, cx = x0 + cw / 2;
      if (terrainEnvCode(terrain, cx, cz) !== 2) continue;

      const y00 = vertexH(x0, z0);
      const y10 = vertexH(x1, z0);
      const y11 = vertexH(x1, z1);
      const y01 = vertexH(x0, z1);

      pos.push(x0, y00, z0, x1, y10, z0, x1, y11, z1, x0, y01, z1);
      for (let k = 0; k < 4; k++) nrm.push(0, 1, 0);   // 水平面法線恆朝上
      idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      const fd = terrain.seaFadeAtWorld ? terrain.seaFadeAtWorld(cx, cz) : 1.0;
      for (let k = 0; k < 4; k++) fade.push(fd);
      base += 4;
    }
  }
  if (!idx.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('seaFade', new THREE.Float32BufferAttribute(fade, 1));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, envMat(0x4a3358, {
    bands: 'soft', rim: 0, transparent: true, opacity: 0.76, side: THREE.DoubleSide,
    soft: swampSoft(),
  }));
  mesh.frustumCulled = false;
  mesh.userData.noOutline = true;
  group.add(mesh);
}

/**
 * 沼澤潮間帶(2026-07-24 使用者需求的後半「沼澤與陸地邊界加潮間帶」)。
 * 以 terrainEnvCode 一趟格點掃描(~8m)找沼澤(2)與乾地(0)交界兩側的格 →
 * 隨地形起伏的濕泥帶(靜態)。
 *
 * ⚠ **前半(水岸波浪泡沫)已於 2026-08-16 ⑤-2 退場**,MUST NOT 復辟(§6):
 * 舊制是「8m 格點 + Canvas 徑向漸層的軟 alpha + 固定在 `waterY + 0.1` 的平板 + opacity 呼吸」,
 * 三件事都是這一輪要否定的 —— 驅動量是**岸線幾何**(量化成方塊)而不是水深、外觀是**柔霧**
 * 而不是賽璐璐的白色硬邊、而且平板**穿不過浪**(浪高 ±0.9m 的波峰直接從泡沫片裡穿出去)。
 * 現制住 `toon.js celFoam()`(深度場驅動 + `step()` 硬邊 + 相位減 `celSeaH` ⇒ 跟著浪沖上岸),
 * 消費端只有 `terrain.bakeSeaDepth` / `stampSeaBlockers`。兩份並存 = 新的硬邊被舊的軟 alpha
 * 糊掉,而每一條既有斷言照樣全綠(症狀只是「岸邊看起來髒髒的」)。
 * 連帶退場的還有 `shoreFoamTex()` 的三個 `Math.random()`(只染像素、不進散布路徑,
 * 刪掉是嚴格改善)。
 *
 * 與 buildSwampSurface 同紀律:純視覺不進 raycast(game.js 只打 terrain.mesh)、透明材質不描邊、
 * 純幾何格取樣不耗共享 rnd(§2.3 佈局序列不受影響)。
 * wy==null(無水域)= 無岸也無沼澤(terrainEnvCode 沼澤分類本身要求 wy!=null),直接略過。
 */
function buildWaterEdges(group, terrain) {
  const wy = terrain.waterY;
  if (wy == null) return;
  const { minX, maxX, minZ, maxZ } = terrain;
  const cols = Math.min(256, Math.max(1, Math.ceil((maxX - minX) / 8)));
  const rows = Math.min(256, Math.max(1, Math.ceil((maxZ - minZ) / 8)));
  const cw = (maxX - minX) / cols, ch = (maxZ - minZ) / rows;
  // 一趟預算全格 code(避免逐格再對 4 鄰居重算 terrainEnvCode)
  const code = new Uint8Array(cols * rows);
  const ccx = new Float32Array(cols), ccz = new Float32Array(rows);
  for (let j = 0; j < cols; j++) ccx[j] = minX + (j + 0.5) * cw;
  for (let i = 0; i < rows; i++) ccz[i] = minZ + (i + 0.5) * ch;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++)
    code[i * cols + j] = terrainEnvCode(terrain, ccx[j], ccz[i]);
  const at = (i, j) => (i < 0 || j < 0 || i >= rows || j >= cols) ? 0 : code[i * cols + j];
  const nbr = (i, j, want) => at(i - 1, j) === want || at(i + 1, j) === want || at(i, j - 1) === want || at(i, j + 1) === want;

  const tp = [], tidx = []; let tb = 0;                         // 潮間帶(隨地形)
  for (let i = 0; i < rows; i++) {
    const z0 = minZ + i * ch, z1 = z0 + ch;
    for (let j = 0; j < cols; j++) {
      const x0 = minX + j * cw, x1 = x0 + cw;
      const c = code[i * cols + j];
      if ((c === 2 && nbr(i, j, 0)) || (c === 0 && nbr(i, j, 2))) {
        const yy = (x, z) => terrain.heightAt(x, z) + 0.06;   // 略抬離地表免 z-fight
        tp.push(x0, yy(x0, z0), z0, x1, yy(x1, z0), z0, x1, yy(x1, z1), z1, x0, yy(x0, z1), z1);
        tidx.push(tb, tb + 2, tb + 1, tb, tb + 3, tb + 2);
        tb += 4;
      }
    }
  }

  // 潮間帶 mesh(隨地形起伏,靜態濕泥帶)
  if (tidx.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
    geo.setIndex(tidx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, toonPlain({
      color: 0x5f533c, transparent: true, opacity: 0.55, side: THREE.DoubleSide,   // 濕泥色(潮間帶)
    }));
    mesh.frustumCulled = false;
    mesh.userData.noOutline = true;
    group.add(mesh);
  }
}

// ---------------- 水面倒影塊(2026-08-16 ⑤-3;S6 的 biomes 消費端)----------------
// **不做 planar reflection**:那是第二趟全場 render —— `postfx.js` 檔頭為了同一筆成本拒絕過
// 第二張陰影圖。改成「一份幾何、一個 draw call、朝向在頂點著色器算」的 3~4 段斷口色塊:
// 每個反射體交出 (世界 X, 世界 Z, 水面上的高) 三個數,長度由鏡像幾何**反解**
// `len = D·h/(e+h)`(住 toon.js 的 `CEL_REFL` 分支,推導不手寫),高度吃同一支
// `celSeaH × seaFade` ⇒ 跟著浪起伏,而不是一片死平的色塊貼在起伏的水面上(舊泡沫片的病)。
//
// ⚠ **浪高寫入處有兩個**(這是本段唯一的補償項):`refl` 的材質 MUST 同時帶 `soft: seaSoft()`
//   才拿得到 `uSoftAmp`/`uSoftFreq`(S6 契約原文),而 `soft.axis === 'w'` 會連帶開 `CEL_WAVE`
//   ⇒ toon.js 的頂點端 `#ifdef CEL_REFL` 與 `#ifdef CEL_WAVE` **各加一次** `celSeaH * seaFade`,
//   合起來是 2× 波幅(倒影塊浮在水面上方最多 0.9m)。`toon.js` 是別的道的檔案 ⇒ 唯一能在本檔
//   修的地方是**逐頂點的 `seaFade` 除以寫入處數**,合起來恰好一個浪高。
//   `audit_water_edge` Ⅲ **數 toon.js 的寫入處**並與這個常數比對 ⇒ 上游哪天在 `CEL_WAVE`
//   那一段補上 `#ifndef CEL_REFL`,這裡當場紅字(正解見交付說明的待裁決)。
const REFL_WAVE_WRITERS = 2;
// 倒影塊的色與濃度由交付值定案。`reflect = 0`
// ⇒ mesh `visible = false` ⇒ 一個 draw call 都不進、一個像素都不寫 ⇒ 逐位元同舊制。
// 逐反射體的顏色**刻意沒有**(`blockers` 只有幾何、沒有材質色,要就得在 buildBiomes 收第二本
// 逐棟代表色的帳)—— 全場共用一個色是**刻意的降級**,不是假裝有(同 `surfaceId` 逐材質那條)。
const REFL_C = 0xdfeeff, REFL_A = 0.22;

/**
 * 反射體名冊(純幾何、零亂數)。四道閘,順序即語意:
 * ①**排除邊界牆環** —— 它是 `blockers` 的**第一批**(A44),`slice(0, N)` 剛好只選到它,
 *   結果是四條邊各長出一道連續倒影牆而圖心的建物一個都沒有。判據取既有的唯一縫
 *   `edgeWallInsetM()`(環的盒心恆在夾制線**外側**:內面貼線、厚度往圖界方向長)。
 * ②水面上要夠高(`REFL.MIN_H`);③腳要在近岸帶(**同一個 `MIN_H`**:一個授權值,不是兩個);
 * ④取「離圖心近 + 高」的前 `REFL.MAX_N`(頂點預算,不是 draw call —— 整份是一個 mesh)。
 */
function planReflectors(terrain, blockers) {
  const wy = terrain.waterY;
  if (wy == null || !blockers?.length) return [];
  const inset = edgeWallInsetM();
  const { minX, maxX, minZ, maxZ } = terrain;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const halfSpan = Math.max(1, Math.min(maxX - minX, maxZ - minZ) / 2);
  const out = [];
  for (const b of blockers) {
    if (!b) continue;
    if (Math.min(b.x - minX, maxX - b.x, b.z - minZ, maxZ - b.z) < inset) continue;   // ①
    const h = b.y + b.h - wy;
    if (!(h > REFL.MIN_H)) continue;                                                   // ②
    if (terrain.heightAt(b.x, b.z) >= wy + REFL.MIN_H) continue;                       // ③
    const r = b.hw2 != null ? Math.hypot(b.hw2, b.hd2) : b.r;   // broad-phase 外接半對角(A30)
    if (!(r > 0)) continue;
    out.push({ x: b.x, z: b.z, h, r, s: h / (1 + Math.hypot(b.x - cx, b.z - cz) / halfSpan) });
  }
  // 排序 MUST 是全序(同分再比座標)—— 「前 N 個」在兩台客戶端上要是同一批
  out.sort((a, b) => b.s - a.s || a.x - b.x || a.z - b.z);
  return out.slice(0, REFL.MAX_N);                                                     // ④
}

/**
 * 倒影塊幾何(一份幾何、一個 mesh)。頂點契約 = S6:
 *   `position` = (橫向偏移**世界公尺**, 沿倒影方向的比例 [0,1], 未用)
 *   `aReflO`   = (反射體世界 X, 反射體世界 Z, 反射體在水面上的高 h)
 *   `seaFade`  = 逐頂點浪幅淡出(**唯一來源 = `terrain.seaFadeAtWorld`**,除以寫入處數)
 * mesh MUST 掛在**世界原點**(identity matrix):頂點分支直接把世界座標寫回 `transformed`。
 * 逐段的長度與寬窄由**落點雜湊**自帶種子 ⇒ **零共享 `rnd()` 消耗**(§2.3);每段固定抽 2 枚。
 * @returns 反射體數(0 = 沒有水域 / 岸邊沒有夠高的東西)
 */
function buildWaterReflections(group, terrain, blockers, dynamics) {
  const wy = terrain.waterY;
  if (wy == null) return 0;
  const list = planReflectors(terrain, blockers);
  if (!list.length) return 0;
  const pos = [], nrm = [], ro = [], fade = [], idx = [];
  let base = 0;
  const seg = 1 / REFL.SEG_N;
  for (const b of list) {
    const rnd = mulberry32(edgeSeed(b.x, b.z, 0x5EF1));
    const hw = Math.min(REFL.MAX_HALF_M, REFL.HALF_F * b.r);
    const f = terrain.seaFadeAtWorld(b.x, b.z) / REFL_WAVE_WRITERS;
    for (let k = 0; k < REFL.SEG_N; k++) {
      // 兩枚亂數**先抽完再判**(§2.3 抽樣紀律:淘汰檢查排在抽樣之後 ⇒ 每段固定消耗)
      const gj = 0.6 + rnd() * 0.8;      // 斷口寬的逐段抖動
      const wj = 0.7 + rnd() * 0.6;      // 段寬的逐段抖動(被浪打散的倒影不是一條等寬的帶)
      const g = seg * REFL.GAP_F * gj;
      const t0 = k * seg + g * 0.5, t1 = (k + 1) * seg - g * 0.5;
      if (!(t1 > t0)) continue;
      const w = hw * wj;
      pos.push(-w, t0, 0, w, t0, 0, w, t1, 0, -w, t1, 0);
      for (let v = 0; v < 4; v++) { nrm.push(0, 1, 0); ro.push(b.x, b.z, b.h); fade.push(f); }
      idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      base += 4;
    }
  }
  if (!idx.length) return 0;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('aReflO', new THREE.Float32BufferAttribute(ro, 3));
  geo.setAttribute('seaFade', new THREE.Float32BufferAttribute(fade, 1));
  geo.setIndex(idx);
  const mat = envMat(REFL_C, {
    // `refl` ⇒ define CEL_REFL + 類別碼恆 NONE(貼在水上的一片色塊,不該被畫輪廓);
    // `soft: seaSoft()` ⇒ 浪的振幅/頻率與水盤**同一份**(見上方 REFL_WAVE_WRITERS 那一段)
    refl: { y: wy }, soft: seaSoft(),
    bands: 'soft', rim: 0, wash: 0, cool: 0,
    transparent: true, opacity: REFL_A, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;   // 頂點在著色器裡才拿到世界位置 ⇒ 包圍盒是原點旁邊一小塊
  mesh.castShadow = false;      // 陰影走 MeshDepthMaterial(沒有 CEL_REFL 補丁 ⇒ 會投出退化四邊形)
  mesh.userData.noOutline = true;
  mesh.renderOrder = 1;         // 疊在水盤之上(舊泡沫片留下的慣例)
  mesh.visible = false;         // 拉桿 def = 0 ⇒ 首幀就不進 draw call
  group.add(mesh);
  // 拉桿逐幀讀(**不訂閱 `onVisualChange`**:訂閱要記得退訂,而 biomes group 沒有 dispose 鉤;
  // 這裡本來就有每幀一次的桶)。`reflect === 0` ⇒ `visible = false` ⇒ 一個像素都不寫。
  dynamics.push(() => {
    const a = visualPref('reflect');
    mesh.visible = a > 0;
    if (a > 0) mat.opacity = REFL_A * Math.min(1, a);
  });
  return list.length;
}

// ---- 馬路橫切水域邊緣改繞行(2026-07-28 使用者需求)----
// 「馬路從水域/沼澤橫切時不需要建橋,貼著邊界繞過去即可;橫跨對岸時才建橋」。純表現層,**只作用於真 OSM 道路**
// (splitWaterPieces 的 !inclSwamp 分支;兵線 inclSwamp=true 不繞、真 bridge=yes way 根本不進 splitWaterPieces、
//  沼澤對真道路本就不建橋 ⇒ 天然滿足「沼澤橫切不建橋」)。判定(使用者定案「垂向雙側取樣 + 誤差」):泡水頂點
// 沿道路**垂直方向**兩側各量到乾地的距離 lo(近側)/hi(遠側):
//   **貼邊橫切 = 不對稱**:一側近岸(lo < SKIRT_NEAR)、另一側是開放水域(hi ≥ SKIRT_OPEN)⇒ 沿岸走,推頂點到近岸繞行;
//   **橫跨對岸 = 對稱或兩側皆近**:兩岸距離相當 ⇒ lo≈hi,恆不滿足「一近一遠」⇒ 判橫跨,建橋不繞。
// **斜交穿越修正(2026-07-28 複審)**:垂向量到的岸距 = (半寬)/cos(斜角),斜交穿越時兩岸仍**對稱** lo≈hi,
//   故 SKIRT_OPEN>SKIRT_NEAR 保證對稱穿越(含斜交)恆判橫跨 —— 舊版單看 min<NEAR 會把 40m 河的 45° 斜交誤判成
//   貼邊而把整座橋繞掉(連通性斷裂)。連續「橫跨型」(非貼邊)弧長 ≥ SKIRT_CROSS_MIN 才判整段建橋(濾掉水窪)。
// 端點不動(接鄰 way,動了會斷路口)、非貼邊頂點不推、推不到乾地保留(fail-safe)。純幾何、不耗共享 rnd(佈局序列不變)。
const SKIRT_NEAR = 30;                     // 近岸門檻(公尺):一側 ≤ 此距見乾地 = 可能的貼邊側
const SKIRT_OPEN = 60;                     // 開放水域門檻(公尺):另一側 ≥ 此距才見乾地(或無)= 開放水域(> NEAR:對稱穿越恆非貼邊)
const SKIRT_MAX = 72;                      // 垂向取樣 / 繞行推距上限(公尺;MUST ≥ SKIRT_OPEN 才辨得出開放側)
const SKIRT_STEP = 3;                      // 垂向取樣步距(公尺)
const SKIRT_CROSS_MIN = WATER.SPAN_MIN_M;  // 連續「橫跨型」頂點弧長 ≥ 此 ⇒ 橫跨對岸,整段建橋不繞
function skirtWaterClips(run, terrain) {
  const n = run.length;
  if (n < 3) return;
  const wet = run.map(([x, z]) => isWaterPt(terrain, x, z));
  const perpDry = (x, z, sx, sz) => {      // 自 (x,z) 沿 (sx,sz) 前進,回首個乾地距離(SKIRT_MAX 內無乾地 → Infinity = 開放水域)
    for (let d = SKIRT_STEP; d <= SKIRT_MAX; d += SKIRT_STEP) if (!isWaterPt(terrain, x + sx * d, z + sz * d)) return d;
    return Infinity;
  };
  const info = new Array(n).fill(null);    // 逐頂點:是否貼邊 clip + 近岸方向 sx/sz + 近岸距 near(端點不算 ⇒ 恆保留)
  for (let i = 1; i < n - 1; i++) {
    if (!wet[i]) continue;
    let tx = run[i + 1][0] - run[i - 1][0], tz = run[i + 1][1] - run[i - 1][1];
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const px = tz, pz = -tx;                // 道路法線
    const dPos = perpDry(run[i][0], run[i][1], px, pz), dNeg = perpDry(run[i][0], run[i][1], -px, -pz);
    const lo = Math.min(dPos, dNeg), hi = Math.max(dPos, dNeg);
    const clip = lo < SKIRT_NEAR && hi >= SKIRT_OPEN;   // 一側近岸、另一側開放水域 = 貼邊(不對稱);對稱穿越 lo≈hi 恆非貼邊
    const toPos = dPos <= dNeg;                          // 近岸側 = 距離小的那側(推向岸)
    info[i] = { clip, near: lo, sx: toPos ? px : -px, sz: toPos ? pz : -pz };
  }
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]));
  for (let i = 0; i < n; i++) {
    if (!wet[i]) continue;
    let j = i; while (j + 1 < n && wet[j + 1]) j++;
    let cross = false, cs = -1;              // 連續「橫跨型」(非貼邊)頂點弧長 ≥ SKIRT_CROSS_MIN ⇒ 該段橫跨對岸,不繞
    for (let k = i; k <= j; k++) {
      if (info[k] && !info[k].clip) { if (cs < 0) cs = k; if (cum[k] - cum[cs] >= SKIRT_CROSS_MIN) { cross = true; break; } }
      else cs = -1;
    }
    if (!cross) for (let k = i; k <= j; k++) {   // 貼邊段:貼邊頂點推到最近乾地(貼著邊界繞過去)
      const g = info[k];
      if (!g || !g.clip || !isFinite(g.near)) continue;   // 端點 / 非貼邊 / 推不到乾地 ⇒ 保留(fail-safe)
      run[k] = [run[k][0] + g.sx * (g.near + SKIRT_STEP), run[k][1] + g.sz * (g.near + SKIRT_STEP)];
    }
    i = j;
  }
}

/**
 * 大面積水域自動高架橋(2026-07-15):非橋/非隧道道路的連續泡水段 ≥ WATER.SPAN_MIN_M
 * 即整段升級為高架橋 —— 機體無法下深水(game.js),道路通過大面積水域一定要有橋。
 * 泡水區間向兩岸乾地各外延 WATER.RAMP_M 當引道錨點(deckAt 的 24m 緩坡落在乾地上 = 斜坡出入口,
 * 不是階梯);太短的泡水段(淺灘/窄溝)不蓋橋,照舊涉水。回傳折線陣列,每條掛 .wet 旗標,
 * 邊界頂點前後段共享 = 橋頭與地面路無縫銜接。buildRoads 與 markGradeCorridors 共用(MUST 同一份規則)。
 * inclSwamp(2026-07-24 使用者需求「兵線通過沼澤時也要造橋」):沼澤(terrainEnvCode 2)也算泡水 →
 *   兵線跨沼段一律升橋,機體不必踩進暗紫濁沼(否則電子失效/滯留,同水域)。**只兵線路徑傳 true**
 *   (real OSM 道路維持水域限定,免濕地圖每條小徑都長出短橋);橋面 deckAt 抬升 BRIDGE_RISE 恆
 *   高過沼面 waterY+SWAMP_BAND。
 */
function splitWaterPieces(run, terrain, inclSwamp = false) {
  const n = run.length;
  if (n < 2) { run.wet = false; return [run]; }
  if (!inclSwamp) skirtWaterClips(run, terrain);   // 真 OSM 道路:橫切水域邊緣改繞行(貼邊);兵線/離線備援不繞
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]));
  const wet = run.map(([x, z]) => inclSwamp ? terrainEnvCode(terrain, x, z) !== 0 : isWaterPt(terrain, x, z));
  const spans = [];
  for (let i = 0; i < n; i++) {
    if (!wet[i]) continue;
    let j = i;
    while (j + 1 < n && wet[j + 1]) j++;
    if (cum[j] - cum[i] >= WATER.SPAN_MIN_M) spans.push([cum[i], cum[j]]);
    i = j;
  }
  if (!spans.length) { run.wet = false; return [run]; }
  // 引道外延 + 相鄰跨距合併(重疊即併,不留 <RAMP_M 的碎地面段)。
  // 2026-07-24 使用者需求「一條路線上的兩座橋不要太靠近,太靠近就直接連在一起」:合併門檻自
  // 「重疊」放寬到「兩跨之間的乾地塞不下一趟下坡 + 上坡」(deckAt 兩端各 RAMP_M 的 smoothstep
  // 引道)—— 塞不下 = 中間那段路只可能是個 V 形谷(下橋隨即又上橋),直接併成一座連續橋。
  // **中間乾地高過橋面抬升一半就不併**:那是真的陸地/丘陵,併了會讓橋面爬上山脊(deckAt 夾在
  // 地表之上,不會埋進土裡,但整座橋會變成貼著山走的怪帶子)—— 該處兩座橋分開才是對的。
  const JOIN_M = WATER.RAMP_M * 2;                       // 推導值:下坡 + 上坡,MUST NOT 手寫
  const gapLow = (a, b) => {
    for (let i = 0; i < n; i++) {
      if (cum[i] < a) continue;
      if (cum[i] > b) break;
      if (terrain.heightAt(run[i][0], run[i][1]) > WATER.LEVEL + BRIDGE_RISE * 0.5) return false;
    }
    return true;   // a > b(兩跨引道本就重疊)⇒ 無取樣點 ⇒ 恆真 = 舊版行為
  };
  const merged = [];
  for (const [a, b] of spans) {
    const s0 = Math.max(0, a - WATER.RAMP_M), s1 = Math.min(cum[n - 1], b + WATER.RAMP_M);
    const last = merged[merged.length - 1];
    if (last && s0 <= last[1] + JOIN_M && gapLow(last[1], s0)) last[1] = Math.max(last[1], s1);
    else merged.push([s0, s1]);
  }
  const idxOf = (s) => { let i = 0; while (i < n - 1 && cum[i + 1] <= s) i++; return i; };
  const pieces = [];
  let cursor = 0;
  for (const [s0, s1] of merged) {
    // 夾回 cursor:相鄰跨距的索引取整不可回頭重疊(重疊 = 兩座橋同段 z-fighting)
    const i0 = Math.max(cursor, idxOf(s0));
    const i1 = Math.max(i0 + 1, Math.min(n - 1, idxOf(s1) + 1));
    if (i0 > cursor) { const dry = run.slice(cursor, i0 + 1); dry.wet = false; pieces.push(dry); }
    const wetP = run.slice(i0, i1 + 1);
    wetP.wet = true;
    pieces.push(wetP);
    cursor = i1;
  }
  if (cursor < n - 1) { const dry = run.slice(cursor); dry.wet = false; pieces.push(dry); }
  return pieces.filter((p) => p.length >= 2);
}

/**
 * 立體交通走廊(2026-07-15):隧道與橋樑(含跨水自動橋)的走廊登記,兩個用途:
 *  - blocked 淨空:神木/巨岩/植被/補間建物不得落在 ①隧道敞開/洞口開挖段 ②橋樑走廊(橋下淨空)——
 *    地下道/隧道內只會有道路物件。隧道「覆蓋段」上方是原樣山體地表,照常鋪地物,
 *    MUST NOT 連覆蓋段一起 block(那會把山頂鏟成禿頭)。
 *  - 回傳走廊小段(three 座標)供 main.js 上傳伺服器:sim 據此清除走廊內的第三方障礙/地雷。
 *    kind:'tun'(全段,含覆蓋段 —— 洞內路面不得有障礙)/ 'bridge'(橋面下走廊)。
 * 邊界裁切/細分/拆段 MUST 與 buildRoads 同一套(inb=4 / ROAD_SEG / splitWaterPieces),
 * 否則走廊跟實際結構對不上。不耗共享 rnd(佈局序列不受影響)。
 */
function markGradeCorridors(roads, terrain, center, blocked, inclSwamp = false) {
  const corridors = [];
  const inb = 4;
  for (const way of roads || []) {
    const ped = isPedestrianWay(way.tags || {});
    const bridge = ped ? isPedestrianBridge(way.tags || {}) : !!way.tags?.bridge;
    const tunnel = !!way.tags?.tunnel;
    const hwWay = bridge ? strucHw(way.tags || {}) : roadWidth(way.tags || {}) / 2;
    const runs = [];
    let cur = [];
    for (const gpt of way.geometry || []) {
      const [x, z] = llToWorld(gpt.lat, gpt.lon, center);
      if (x < terrain.minX + inb || x > terrain.maxX - inb || z < terrain.minZ + inb || z > terrain.maxZ - inb) {
        if (cur.length >= 2) runs.push(cur);
        cur = [];
        continue;
      }
      cur.push([x, z]);
    }
    if (cur.length >= 2) runs.push(cur);
    for (let ri = 0; ri < runs.length; ri++) {
      const raw = runs[ri];
      // 結構隧道/地下道 = 有覆蓋區間(way._tun 由開挖階段算好,含地下道的下沉剖面);
      // 兩者都建不成 = 平面市區路,不是立體結構 → 不登記走廊/淨空(與 buildRoads 一致)
      const tw = tunnel ? (way._tun?.[ri] ?? { intervals: [] }) : null;
      const strc = !!tw && tw.intervals.length > 0;
      // 結構隧道/地下道 MUST 吃 way._tun 存下的那一份折線(地下道含兩端引道延伸段)
      const pieces = strc ? [tw.pts] : bridge ? [densify(raw, ROAD_SEG)]
        : splitWaterPieces(densify(raw, ROAD_SEG), terrain, inclSwamp);
      for (const run of pieces) {
        if (run.length < 2) continue;
        const wet = run.wet === true;
        // 步道只接受圖資明示的 bridge=yes；影像泡水不自動抬橋。一般乾地路段亦不登記。
        if (!strc && ((!bridge && !wet) || (ped && !bridge))) continue;
        // 沉錨橋碎片:與 buildRoads 同步跳過(該段不建橋 → 也不登記走廊/淨空);
        // 閾值 MUST 用「沒入水下 1m」(岸壁高程可低到 ~0.1,見 buildRoads 同名註解)
        const sunk = (p) => terrain.heightAt(p[0], p[1]) < WATER.LEVEL - 1.0;
        if (!strc && (bridge
          ? (sunk(run[0]) || sunk(run[run.length - 1]))
          : wet && sunk(run[0]) && sunk(run[run.length - 1]))) continue;
        const hw = (bridge || wet || strc) ? strucHw(way.tags || {}) : hwWay;
        const kind = strc ? 'tun' : 'bridge';
        const cum = [0];
        for (let i = 1; i < run.length; i++) cum.push(cum[i - 1] + Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]));
        const total = cum[cum.length - 1] || 1;
        // 走廊小段(12m 粗化,上傳量減半)
        for (let i = 0; i + 1 < run.length; i += 2) {
          const j = Math.min(run.length - 1, i + 2);
          // cy = 該小段的**頂板底面**(洞內淨空頂)。buildRoads 用它判「別條地表道路的路面緞帶
          // 有沒有畫進洞內斷面」—— 走廊清單就是那道判定的單一縫,MUST NOT 在 buildRoads 另算
          // 一份隧道剖面(兩份剖面 = 洞內殘留跟著圖資逐局忽有忽無)。橋不需要(橋面在天上)。
          const cy = kind === 'tun'
            ? Math.max(tunFloorAt(tw, cum[i], total), tunFloorAt(tw, cum[j], total)) + TUN.CLEAR
            : null;
          const clear = kind === 'tun' ? STRUCT_CLEAR_PAD : 4;
          corridors.push({ x1: run[i][0], z1: run[i][1], x2: run[j][0], z2: run[j][1], hw, kind, cy, clear });
        }
        // 淨空格:橋樑全段;隧道只有敞開/洞口段(覆蓋段山頂地物照舊)。此處 heightAt 是開挖後
        // 高度:自然覆蓋段未被開挖(= 原高)→ skip;縫合蓋廊段(地表低於天花)→ 淨空,
        // 蓋廊頂上才不會長出地物 —— 語意與覆蓋區間一致,不必查 intervals。
        // 明隧道覆蓋段例外(2026-07-31 使用者回報「洞內有不明石頭卡住」):覆蓋段跳過淨空的
        // 前提是「頂上是原樣山體、地物合法」,明隧道段的側坡低於頂板 = 地表斜穿洞內,
        // 照鋪地物就長在洞裡。判定 MUST 走 tunnelWallProfile 單一縫(與 buildRoads 同輸入,
        // 純幾何零 rnd);地下道(tw.sink)恆非明隧道,不判。
        let galOpenAt = null;
        if (kind === 'tun' && !tw.sink) {
          const floorsV = cum.map((s) => tunFloorAt(tw, s, total));
          const covV = run.map(([x, z], i) => terrain.heightAt(x, z) >= floorsV[i] + TUN.CLEAR + TUN.ROOF_T);
          const gp = [1, -1].map((side) => tunnelWallProfile(run, floorsV, covV, (x, z) => terrain.heightAt(x, z), hw, side,
            (x, z) => terrain.natureAt(x, z)));   // 落差掃描吃天然地形(開挖前/後同解)
          galOpenAt = (i) => gp[0][i].open || gp[1][i].open;
        }
        for (let i = 0; i < run.length; i++) {
          const [x, z] = run[i];
          if (kind === 'tun') {
            const floor = tunFloorAt(tw, cum[i], total);   // 山體隧道 = 平直;地下道 = 下沉剖面
            if (terrain.heightAt(x, z) >= floor + TUN.CLEAR + TUN.ROOF_T && !galOpenAt?.(i)) continue;   // 深埋覆蓋段
          }
          // 淨空半徑 MUST 蓋過**開挖足跡**(2026-07-31 使用者回報「殘餘地形在道路之上、洞口沒有淨空」):
          // 隧道/地下道的開挖是 hw+7(山體斜壁)/ 引道 hw+CUT_W 再加 hw+COPE 的緣石帶,舊 hw+4
          // 只蓋到路面外 4m ⇒ 開挖邊緣那一圈仍會生地被特徵拼圖與擺件,它們以「單一取樣高」擺位,
          // 挖空後就懸在路塹上方 = 洞口望出去幾片浮在路面上的土色薄片。橋維持 hw+4(橋下淨空語意不同)。
          blockArea(blocked, x, z, hw + (kind === 'tun' ? STRUCT_CLEAR_PAD : 4));
        }
      }
    }
  }
  return corridors;
}

function buildRoads(group, roads, terrain, center, mix, rnd, season, covers = [], inclSwamp = false, bores = []) {
  const inb = 4;
  // ---- 別條路的洞內斷面:貼地路段的路面/標線 MUST NOT 畫進去(2026-08-01 金龍隧道真圖資實測)----
  // `punchPortalHoles` 刪的是**地形**三角形與地被實例,路面緞帶是另一個 mesh、沒被刪:淺覆蓋處
  // (= 判成明隧道的那種)地表本來就落在洞底與頂板之間,山坡上那條路的緞帶於是整片橫在洞內
  // (玩家看到的「洞裡卡著一片斜板」,肉眼像倒下的樹幹)。判定吃 markGradeCorridors 回傳的
  // **同一份**走廊清單(含頂板底面 cy),MUST NOT 另算一份隧道剖面。
  // 全圖包圍盒早退:這支要對每條路的每個小段問一次,而走廊清單可達數千段 —— 沒有早退就是
  // 千萬次距離運算。純加速,不改判定(界外必然也在每段的 hw 之外)。
  const tunBores = (bores || []).filter((c) => c.kind === 'tun' && c.cy != null);
  let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity, bcy = -Infinity;
  for (const c of tunBores) {
    bx0 = Math.min(bx0, c.x1 - c.hw, c.x2 - c.hw); bx1 = Math.max(bx1, c.x1 + c.hw, c.x2 + c.hw);
    bz0 = Math.min(bz0, c.z1 - c.hw, c.z2 - c.hw); bz1 = Math.max(bz1, c.z1 + c.hw, c.z2 + c.hw);
    bcy = Math.max(bcy, c.cy);
  }
  const inTunBore = (x, y, z) => {
    if (y > bcy || x < bx0 || x > bx1 || z < bz0 || z > bz1) return false;
    for (const c of tunBores) {
      if (y > c.cy) continue;                      // 自頂板上方通過 = 合法(路鋪在洞頂的山坡上)
      const vx = c.x2 - c.x1, vz = c.z2 - c.z1, l2 = vx * vx + vz * vz || 1;
      let t = ((x - c.x1) * vx + (z - c.z1) * vz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - (c.x1 + vx * t), dz = z - (c.z1 + vz * t);
      if (dx * dx + dz * dz <= c.hw * c.hw) return true;
    }
    return false;
  };
  const buckets = new Map();   // `${biome}|${main}|${步行主題}` -> { color, pos, nrm, col, uv, idx, base }
  const PED_SURFACE = {
    footbridge: { color: 0x59636a, tex: 'asphalt' },
    oldstreet: { color: 0x84684e, tex: 'gravel' },
    cycleway: { color: 0x416b63, tex: 'asphalt' },
    promenade: { color: 0x7b786e, tex: 'gravel' },
  };
  const bucketOf = (biome, main, theme = null) => {
    const key = `${biome}|${main ? 1 : 0}|${theme || ''}`;
    let b = buckets.get(key);
    if (!b) {
      const ped = PED_SURFACE[theme];
      b = { color: ped?.color ?? roadColor(biome, main), tex: ped?.tex || ROAD_TEX_OF[biome] || 'asphalt',
            pos: [], nrm: [], col: [], uv: [], idx: [], base: 0 };
      buckets.set(key, b);
    }
    return b;
  };
  // 路面貼地規則:非橋樑截面「各自貼地,但夾在同截面最高點 −0.7m 之上」——
  // 橫坡路段路面切進山壁(路塹感)而不是被地形吞掉;抬升量 0.45 > 地被(0.07~0.18)
  const ROAD_LIFT = 0.45, CLAMP = 0.7;
  const AVOID_MIN = 1.5;   // 每側避車道邊帶最小寬:窄於此不鋪(過寬才畫人行道/槽化線)
  // 標線合併幾何(頂點色 = 黃/白):雙黃線/白虛線/路緣邊線/斑馬線全進同一 draw call
  const mark = { pos: [], nrm: [], col: [], idx: [], base: 0 };
  const MARK_Y = [1.0, 0.78, 0.28], MARK_W = [0.95, 0.96, 0.9];   // 標線黃 / 標線白
  // hM = 該截面最高點(標線跟路面吃同一條夾高規則,才不會沉進被抬高的路面下)。
  // yB ≠ null 時直接以它為基準(結構隧道:路面在山體之下,貼地取樣會把標線畫到山頂;
  // 平直剖面無橫坡,夾高規則本來就用不上)。
  const putMark = (vx, vz, lift2, c, hM = -Infinity, yB = null) => {
    mark.pos.push(vx, (yB ?? Math.max(terrain.heightAt(vx, vz), hM - CLAMP)) + lift2, vz);
    mark.nrm.push(0, 1, 0);
    mark.col.push(...c);
  };
  // 沿折線的縱向實線:偏移 off、寬 w(雙黃線 = 兩次呼叫);hw2 = 路半寬(夾高取樣);
  // yBAt(i) = 該頂點的路面基準高(結構隧道用,回 null 走貼地)
  const emitLine = (run, hw2, lift2, off, w, c, yBAt = null, dropSeg = null) => {
    const nP = run.length, k0 = mark.base;
    for (let i = 0; i < nP; i++) {
      const [x, z] = run[i];
      const a = run[Math.max(0, i - 1)], b2 = run[Math.min(nP - 1, i + 1)];
      let dx = b2[0] - a[0], dz = b2[1] - a[1];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const px = dz, pz = -dx;
      const yB = yBAt ? yBAt(i) : null;
      const hM = yB !== null ? -Infinity
        : Math.max(terrain.heightAt(x + px * hw2, z + pz * hw2),
                   terrain.heightAt(x - px * hw2, z - pz * hw2));
      // 頂點序:大偏移在前(與路面quad同向繞行 → 面朝 +y,不會背面剔除消失)
      putMark(x + px * (off + w / 2), z + pz * (off + w / 2), lift2, c, hM, yB);
      putMark(x + px * (off - w / 2), z + pz * (off - w / 2), lift2, c, hM, yB);
    }
    for (let i = 0; i < nP - 1; i++) {
      if (dropSeg?.(i)) continue;                  // 落進別條路的洞內斷面:頂點留著、這一格不成面
      const k = k0 + i * 2;
      mark.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    mark.base += nP * 2;
  };
  // 高架橋構件:欄杆(直立緞帶幾何)+ 邊梁(box girder 意象,直立緞帶)+ 底板(soffit,橋下抬頭看的橋腹)
  // + 橋墩/橋墩帽(InstancedMesh);地下道門洞(隧道端點)
  const rail = { pos: [], nrm: [], idx: [], base: 0 };
  const girder = { pos: [], nrm: [], idx: [], base: 0 };
  const soffit = { pos: [], nrm: [], idx: [], base: 0 };
  // 避車道:結構通行寬 > 真實車道寬時的邊帶視覺(2026-07-28)。純視覺 — 不進 raycast、不登記 decks/
  // blockers、不動伺服器碰撞寬(整條 hw 仍可通行);幹道鋪白色槽化斜線(進 mark 桶)、住宅/人行橋鋪
  // 灰色人行道實體帶(walk 桶)。依道路分級自動選(arterial → hatch,其餘 → walk)。純幾何、零 rnd。
  const walk = { pos: [], nrm: [], idx: [], base: 0 };
  const piers = [], portals = [], footbridgeFrames = [];
  // 世界文字的錨點(橋名牌;洞口匾額走 portals 自己那份記錄)—— 只收位置與朝向,
  // 要不要掛、掛什麼字一律由 buildWorldSigns 定案(worldtext.js 是唯一縫)
  const signSpots = [];
  // 地下道(開挖式)構件:兩側擋土牆(直立緞帶)+ 跨越橫樑(InstancedMesh)+ 天花照明(InstancedMesh)
  const wall = { pos: [], nrm: [], idx: [], base: 0 };
  const beams = [], ceilLamps = [];
  // 明隧道(2026-07-28 → 2026-07-30 柱列改制):土牆藏不住結構的那一側 —— 外露頂板 + 簷口封邊/
  // 女兒牆(緞帶)、連續柱列(InstancedMesh;柱間透明可見可穿透)。矮牆沿用同一條擋土牆緞帶
  // (底緣落地、頂緣收在路面 + SILL),不另開一份牆幾何。
  const galRoof = { pos: [], nrm: [], idx: [], base: 0 };
  const galCols = [];
  // 明隧道洞內地形楔 bore(2026-07-31 使用者回報):覆蓋只在中心線上判,明隧道段的側坡地表
  // 會斜穿**洞內斷面**(高於路面、低於天花)—— 視覺上一坡岩土橫在柱列與路面之間,彈道端
  // rayTerrain 也被這片地形擋住。與洞口打洞共用 punchPortalHoles 同一把尺(heights[] 不動、
  // 洞緣 collar 封邊);punchPortalHoles 的 index 壓實**只准呼叫一次**,故收進同一份 bore 清單。
  const galBores = [];
  // 地下道引道的**邊緣修飾**(2026-07-28):牆頂 → 外側地表的平頂緣石帶。carveTunnels 的路塹是
  // hw+1 全深、外擴到 hw+7 收回地表的斜壁,不修飾的話從外面看是路邊憑空一道土溝;鋪一條與
  // 一般路面同高的緣石帶把斜壁蓋掉,銜接處就與周邊街廓齊平。純視覺,不進 raycast/碰撞。
  const cope = { pos: [], nrm: [], idx: [], base: 0 };
  // 橋面碰撞面(main.js → terrain.decks → game.js 表面高度):橋是可以站上去的結構物
  const decks = [];
  const cols = [];   // 結構碰撞柱(橋墩/門洞立柱/翼牆)→ blockers(game.js _collide 推擠,不可重疊)
  const tunnelSegs = [];   // 隧道/地下道小段:{路面 fy, 天花 cy, hw, open?} → main.js surfaceAt(洞內站路面)
                           // + 天花碰撞;open:true = 地下道引道露天路塹(只站立/側壁閘,不 slab/彈道/天花)
  const ceilSegs = [];     // 地下道不透明天花板小段(覆蓋段;擋住山體底面)
  // 路口偵測先完整跑一趟：標線建置時必須已知道所有路口，才能在接合面前截斷；邊畫邊收集會讓
  // 陣列前面的道路不知道後面還有交叉臂，中心線／路緣線便穿過斑馬線與路口填面。
  // dirs/armHw 逐臂平行；相同方向的重複 way 合併且保留最大半寬，避免假四岔與重複斑馬線。
  const nodeArms = new Map();   // key -> { x, z, arms, hw, main, dirs: [[dx,dz]…], armHw: [] }
  for (const way of roads) {
    const bridge = isPedestrianWay(way.tags) ? isPedestrianBridge(way.tags) : !!way.tags.bridge;
    const tunnel = !!way.tags.tunnel;
    const hwWay = bridge ? strucHw(way.tags) : roadWidth(way.tags) / 2;
    if (hwWay < 2 || bridge || tunnel) continue;
    const n = way.geometry.length;
    for (let i = 0; i < n; i++) {
      const gpt = way.geometry[i], key = `${gpt.lat.toFixed(6)},${gpt.lon.toFixed(6)}`;
      let rec = nodeArms.get(key);
      if (!rec) {
        const [x, z] = llToWorld(gpt.lat, gpt.lon, center);
        rec = { x, z, arms: 0, hw: 0, main: false, dirs: [], armHw: [] };
        nodeArms.set(key, rec);
      }
      rec.hw = Math.max(rec.hw, hwWay);
      rec.main = rec.main || MAIN_HW.test(way.tags.highway);
      for (const j of [i - 1, i + 1]) {
        if (j < 0 || j >= n) continue;
        const [ax, az] = llToWorld(way.geometry[j].lat, way.geometry[j].lon, center);
        const dl = Math.hypot(ax - rec.x, az - rec.z) || 1;
        const dx = (ax - rec.x) / dl, dz = (az - rec.z) / dl;
        const same = rec.dirs.findIndex(([ux, uz]) => ux * dx + uz * dz > 0.92);
        if (same >= 0) rec.armHw[same] = Math.max(rec.armHw[same], hwWay);
        else { rec.dirs.push([dx, dz]); rec.armHw.push(hwWay); }
      }
    }
  }
  for (const rec of nodeArms.values()) rec.arms = rec.dirs.length;
  const junctionCuts = [...nodeArms.values()].filter((rec) => rec.arms >= 3);
  const JCELL = 32, junctionGrid = new Map();
  for (const rec of junctionCuts) {
    const r = rec.hw + 0.8;
    const i0 = Math.floor((rec.x - r) / JCELL), i1 = Math.floor((rec.x + r) / JCELL);
    const j0 = Math.floor((rec.z - r) / JCELL), j1 = Math.floor((rec.z + r) / JCELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const key = `${i},${j}`, arr = junctionGrid.get(key);
      if (arr) arr.push(rec); else junctionGrid.set(key, [rec]);
    }
  }
  const inJunctionMarkCut = (x, z, pad = 0.8) => {
    for (const rec of junctionGrid.get(`${Math.floor(x / JCELL)},${Math.floor(z / JCELL)}`) || []) {
      const r = rec.hw + pad, dx = x - rec.x, dz = z - rec.z;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  };
  const lights = [], lamps = [], roadTrees = [], marketLamps = [];   // 3D 附屬件實例
  // 建路段數上限隨地圖真實面積縮放(2026-07-17):固定 600 是第二層截斷 —— 查詢額度
  // 提高後照樣只畫前 600 段。計數單位是拆段後的 run(≈ way × 1.2~1.5,邊界裁切/跨水拆段),
  // 密度基準對齊 fetchOsmRoads 額度(~1450 way/km²)再給拆段裕度;附屬件(路燈/紅綠燈/
  // 行道樹)另有各自實例上限,不受此值影響。
  const km2R = terrain.worldW * terrain.worldH * MAPGEO.REAL_SCALE * MAPGEO.REAL_SCALE / 1e6;
  const maxRuns = Math.max(600, Math.min(2600, Math.round(km2R * 1800)));
  let built = 0;
  for (const way of roads) {
    const main = MAIN_HW.test(way.tags.highway);
    const arterial = /^(motorway|trunk|primary)$/.test(way.tags.highway);   // 幹道:雙黃實線
    const ped = isPedestrianWay(way.tags);
    const bridge = ped ? isPedestrianBridge(way.tags) : !!way.tags.bridge;
    const tunnel = !!way.tags.tunnel;
    // 橋樑/地下道是「可站上去、可穿過去」的結構物(兵線可能就走在上面):
    // 路寬夾到 PASS_W 以上,NPC 與玩家並肩通過不互相卡住(跨水自動橋段在 piece 層再夾一次)。
    // 路寬:橋夾通行寬;隧道改在 run 層判定(結構性才夾 PASS_W,平坦市區「隧道」按一般街道寬)
    const hwWay = bridge ? strucHw(way.tags) : roadWidth(way.tags) / 2;
    // (2026-07-22 洞口改制)門洞不再立在 OSM way/鏈端點:端點常在引道壕溝盡頭甚至地圖邊界,
    // 與「山體吞沒道路」的視覺轉換面脫節;且舊版「內側 14m 地形上升 2.2m」檢查在開挖後地形上
    // 評估,探測點已被 carve 壓平 → 真洞口幾乎全數被否決(里約實測全圖只建出 1 座門,還立在
    // 離覆蓋端點 68m 外)。改於覆蓋區間邊界立門 —— 見下方結構區段。
    // 世界折線(超出邊界即切段)
    const runs = [];
    let cur = [];
    for (const gpt of way.geometry) {
      const [x, z] = llToWorld(gpt.lat, gpt.lon, center);
      if (x < terrain.minX + inb || x > terrain.maxX - inb || z < terrain.minZ + inb || z > terrain.maxZ - inb) {
        if (cur.length >= 2) runs.push(cur);
        cur = [];
        continue;
      }
      cur.push([x, z]);
    }
    if (cur.length >= 2) runs.push(cur);
    for (let ri = 0; ri < runs.length; ri++) {
      const raw = runs[ri];
      // 圖資節點間距可達數十公尺,直接連線會讓路面弦切進丘陵裡(整段沉到地表下)。
      // 先細分成 ≤ ROAD_SEG 的小段,每個新頂點各自貼地。
      // 大面積水域自動高架橋(2026-07-15):非橋/非結構隧道 way 先依泡水段拆段(splitWaterPieces),
      // 泡水段以 brg=true 走橋樑管線(橋面/欄杆/邊梁/底板/橋墩/decks 碰撞全套)。
      // 結構隧道/地下道 = 有覆蓋區間(way._tun,開挖階段算好:山體隧道吃平直剖面、
      // 平坦市區的 tunnel way 吃 underpassPlan 的下沉剖面);兩者都建不成 = 一般道路:
      // 貼地剖面、可跨水補橋、不立門洞不開挖(= 2026-07-28 之前平坦 tunnel way 的唯一下場)。
      const tw = tunnel ? (way._tun?.[ri] ?? { intervals: [] }) : null;
      const strc = !!tw && tw.intervals.length > 0;
      const under = strc && !!tw.sink;   // 地下道(平地下穿)= 下沉剖面 + 兩端引道
      // 結構隧道/地下道 MUST 吃 way._tun 存下的那一份折線:地下道的折線含兩端**引道延伸段**
      // (圖資的 tunnel way 只畫覆蓋段,引道是我們接出去的),重算 densify(raw) 會少掉引道。
      const pieces = strc ? [tw.pts] : bridge ? [densify(raw, ROAD_SEG)]
        : splitWaterPieces(densify(raw, ROAD_SEG), terrain, inclSwamp);
      for (const run of pieces) {
      if (run.length < 2) continue;
      // 步道只在圖資明示 bridge=yes 時升成人行天橋；泡水影像不替步道猜一座橋。
      const brg = bridge || (!ped && run.wet === true);
      // 沉錨橋碎片不建(2026-07-22 倫敦雙層橋案):錨點高程沒入水下 ≥1m = 斷鏈/邊界裁切殘片
      // (步橋鏈常在河面上的分岔節點斷開,mergeGradeChains 保守不併)—— 河床錨把 hA/hB 拖沉,
      // 剖面沉成貼水浮板、疊在真橋之下 = 上下兩層(倫敦實測:斷點錨 h=−2.48)。
      // 閾值紀律:岸壁/碼頭高程可低到 ~0.1(倫敦),用 isWaterPt 或 WATER.LEVEL 當閾值會把
      // 真橋岸錨整批誤殺(實測 decks 1034→308);影像藍色也不可靠(斷點常在他橋正下方,像素
      // 是橋面灰/缺磚底色)。「沒入水面下整整 1m」才是河床專屬特徵。寧缺勿錯:
      //  - bridge way:任一錨沉即整段跳過(OSM 斷鏈的典型形態是單端斷在河面上);
      //  - wet 自動橋:錨點是演算法外延的乾地,僅「雙端皆沉」(折線被邊界裁切)才跳過
      //    —— 兵線跨水補橋因此永不受此刀影響。
      const sunk = (p) => terrain.heightAt(p[0], p[1]) < WATER.LEVEL - 1.0;
      if (brg && (bridge
        ? (sunk(run[0]) || sunk(run[run.length - 1]))
        : (sunk(run[0]) && sunk(run[run.length - 1])))) continue;
      // 跨水自動橋段/結構隧道夾通行寬(PASS_W):兵線可能走的結構物;乾段維持原路寬
      const hw = (brg || strc) ? strucHw(way.tags) : hwWay;
      // 真實車道半寬 laneHw(單一縫 carriageHw;供標線、避車道邊帶、銜接漸縮帶共用):結構通行寬 hw
      // 為遊戲性夾到 ≥8,車道本身常窄得多。avoidHw = 每側「太寬、該畫避車道」的差額。通行寬 hw /
      // decks / 牆 / 走廊 / 伺服器碰撞一律不動 —— 只是把中央車道漆成真實寬(與外部一般路等寬、標線
      // 逐條對齊)、兩側差額鋪避車道視覺(見下方 walk/hatch 段)、結構外緣補漸縮帶接回一般路寬。
      const laneHw = carriageHw(way.tags);
      const avoidHw = (brg || strc) ? Math.max(0, hw - laneHw) : 0;
      const mid = run[(run.length / 2) | 0];
      let biome = classify(terrain.sampleColor?.(mid[0], mid[1]), terrain.heightAt(mid[0], mid[1]), mix, rnd);
      // 橋樑就是為了跨越水面而存在 —— 橋段中點取樣落在水色上是常態(河/運河正下方),
      // MUST NOT 跳過,否則現實中最常見的跨河橋會整段連同橋面碰撞一起消失。
      // 乾段(splitWaterPieces 已逐點判定無泡水跨距)中點取到水色 = 河岸取樣誤差,
      // 整段丟棄會讓沿河街道憑空消失(2026-07-17 巴黎塞納河岸案)→ 退回城市路面色。
      if (biome === 'water' && !brg) biome = 'urban';
      // 結構隧道恆為柏油(2026-07-23):中點取樣落在**覆蓋段上方的山體**影像上(森林/裸岩),
      // 分類會判成綠地/裸露地 → 隧道鋪成泥土路(使用者實測金龍隧道)。隧道是工程結構物,
      // 現實中不存在土石路面 —— 與上面「橋段取到水色」同一道理,直接定調柏油。
      // 橋面同款(2026-07-30 使用者需求「風格盡可能一致」):橋也是工程結構物,不存在泥土/礫石
      // 橋面;跨河橋中點恆取到水色 ⇒ 舊版整座橋鋪成 roadColor('water') 的青灰、郊區橋鋪成泥土,
      // 與洞內柏油、與標線(只畫柏油)三種風格。定調柏油後橋面才與隧道/一般市區路同一套外觀。
      if (strc || brg) biome = 'urban';
      // 雙線道以上鋪柏油(2026-08-11 使用者定案「就算是裸露地或綠地,只要是雙線道或以上也都
      // 鋪設公路」):中點取樣落在路旁植被/裸岩色上時常見(林道遮蔭、路緣曝光偏移),但雙線道
      // 以上本來就是鋪面公路而非產業道路/林道,MUST NOT 因為取樣點誤判而退回泥土/礫石。
      // 只收 bare/green(濕地/水面另有各自的定調規則,不在此列)。
      if ((biome === 'bare' || biome === 'green') && roadLaneN(way.tags) >= 2) biome = 'urban';
      const pedTheme = ped ? (brg ? 'footbridge' : way._ped?.theme || null) : null;
      const b = bucketOf(biome, main, pedTheme);
      const nP = run.length, vbase = b.base;
      const cum = [0];
      for (let i = 1; i < nP; i++) cum.push(cum[i - 1] + Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]));
      const total = cum[nP - 1];
      // 高架橋橋面:兩端地面高的直線內插 + 端點 24m 緩坡爬升淨空 —— 橋面是水平的,
      // 不跟著河谷/窪地起伏;地形突起處仍夾在地表之上(不鑽土)。24m 連續內插 = 出入口
      // 是斜坡不是階梯。跨水橋另夾「水面 + 0.9m」下限:錨點萬一泡水,橋面也不沉入水中。
      // 結構隧道/地下道 MUST 用開挖前錨點(way._tun 存檔):開挖後端點重算會與 carve 的 floors
      // 小幅分家(路面/牆/門洞整體偏移)。橋/一般路照舊取當下地表。
      // (此處的 hA/hB 只餵橋面 deckAt;隧道/地下道的路面一律走 tunFloorAt 單一縫。)
      const hA = strc ? tw.hA : terrain.heightAt(run[0][0], run[0][1]);
      const hB = strc ? tw.hB : terrain.heightAt(run[nP - 1][0], run[nP - 1][1]);
      const deckAt = (s, gx, gz) => {
        // 端點緩坡改平滑 S 曲線(smoothstep):斜率在坡底與坡頂皆歸零 → 與地面、水平橋面 C1 連續,
        // 出入口是「連續斜坡」而非硬折角(舊線性版在 s=24 有膝折 = 階梯感)。t=0 逐位元同舊版
        // (坡底抬升 0 = 接地);total≥48 的橋跨中 t=1 峰值仍滿 BRIDGE_RISE(淨空同今日);total<48 的
        // 短橋跨中峰值微幅上抬(淨空不減,安全)。geometry/橋墩/decks 碰撞取同一 deckAt 自動跟隨。
        const t = Math.min(1, s / 24, (total - s) / 24);   // s∈[0,total] 故 t 已夾 [0,1]
        const ramp = t * t * (3 - 2 * t);                  // smoothstep:兩端切線為 0,免三角函式
        const yLine = hA + (hB - hA) * (s / (total || 1)) + BRIDGE_RISE * ramp;
        // 水面下限給「全部橋 run」(2026-07-22;deckAt 只在 brg run 被呼叫):真 OSM 橋斷鏈/被邊界
        // 裁切時端點可能落在河面上,hA/hB 取到水面高 → 舊版(僅 run.wet 有下限)剖面中段沉貼水面。
        // 乾地高架此下限低於地表,max 無感。
        const floor = WATER.LEVEL + 0.9;
        return Math.max(yLine, terrain.heightAt(gx, gz) + ROAD_LIFT * ramp, floor);
      };
      // 隧道/地下道路面(單一縫 tunFloorAt):山體隧道 = 兩端洞口地表高的平直內插(洞內在山體
      // 之下、洞口與地表齊平);地下道 = 同一條基準線再減 smoothstep 下沉剖面(兩端引道、中段平底)。
      const tFloorAt = (s) => tunFloorAt(tw, s, total);
      // 基準線(未下沉)= 該處的一般地表道路高:地下道引道的護欄頂與緣石帶要對齊它才「與一般道路對齊」
      const tBaseAt = (s) => tunFloorAt(tw, s, total, false);
      for (let i = 0; i < nP; i++) {
        const [x, z] = run[i];
        const a = run[Math.max(0, i - 1)], c = run[Math.min(nP - 1, i + 1)];
        let dx = c[0] - a[0], dz = c[1] - a[1];
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const px = dz, pz = -dx;                 // XZ 垂直向量
        // 截面 4 頂點:外緣暗(墨線)→ 內緣亮,漸層即手繪描邊筆觸。
        // 非橋:各自貼地但夾在截面最高點 −CLAMP 之上(橫坡不吞路);橋:水平橋面
        const offs = [[hw, 1], [hw * 0.64, 0], [-hw * 0.64, 0], [-hw, 1]];
        const hs = offs.map(([off]) => terrain.heightAt(x + px * off, z + pz * off));
        const hMax = Math.max(...hs);
        for (let k = 0; k < 4; k++) {
          const [off, ink] = offs[k];
          const vx = x + px * off, vz = z + pz * off;
          const vy = strc ? tFloorAt(cum[i]) + ROAD_LIFT
            : brg ? deckAt(cum[i], x, z)
              : Math.max(hs[k], hMax - CLAMP) + ROAD_LIFT;
          b.pos.push(vx, vy, vz);
          b.nrm.push(0, 1, 0);
          b.uv.push(vx / 9, vz / 9);             // 世界投影 UV:路面質感貼圖(鏡射重複無接縫)
          if (ink) b.col.push(0.52, 0.52, 0.58);   // 邊墨帶微偏冷
          else b.col.push(1, 1, 1);
        }
      }
      // 貼地路段落進別條路的洞內斷面 ⇒ 路面與標線都不成面(頂點照留,序號不變 = 佈局不漂)。
      // 結構自己的路面(strc)與橋面(brg)當然不受此判:那是它們該在的地方。
      const dropXZ = (px, pz) => !strc && !brg
        && inTunBore(px, terrain.heightAt(px, pz) + ROAD_LIFT, pz);
      const dropRoadSeg = (i) => dropXZ((run[i][0] + run[i + 1][0]) / 2, (run[i][1] + run[i + 1][1]) / 2);
      const dropMarkSeg = (i) => {
        const x = (run[i][0] + run[i + 1][0]) / 2, z = (run[i][1] + run[i + 1][1]) / 2;
        return dropXZ(x, z) || inJunctionMarkCut(x, z);
      };
      for (let i = 0; i < nP - 1; i++) {
        if (dropRoadSeg(i)) continue;
        const k = vbase + i * 4;
        for (const o of [0, 1, 2]) {
          b.idx.push(k + o, k + o + 1, k + o + 4, k + o + 1, k + o + 5, k + o + 4);
        }
      }
      b.base += nP * 4;
      // ---- 銜接漸縮帶(2026-07-30 使用者需求「接合處貼合」)----
      // 結構的通行寬被夾到 ≥ PASS_W/2、外面接的是真實路寬 ⇒ 洞口/橋頭一道橫向硬階(結構節點
      // 刻意不入 nodeArms ⇒ 路口「寬度縮減梯形」補不到這裡)。自結構端往**外**鋪一片同桶
      // (同色同材質、同一 draw call)的路面楔形:半寬走 flareHw 由 hw smoothstep 收到車道寬,
      // 末端就與外面那條路等寬、標線也接得上;起點高度取結構路面高(逐位元貼合)再融回一般路面
      // 貼地規則。純視覺:不登記 decks / tunnelSegs / cols / 走廊(通行寬唯一縫仍是 strucHw)。
      // 兩條跳過條件(寧缺勿錯):①端點離邊界不足一個漸縮長(往外會伸出地圖);②往外撞進山體
      // (覆蓋段直接貼齊 run 端 = 洞還沒出山)或懸空(斷鏈端點落在河面/崖下)—— 楔形會沿山坡
      // 爬上去/浮在空中,比那道階更難看。繞行朝向:d 與 p 同時反號 ⇒ 兩端楔形都朝 +Y(不被剔除)。
      if ((brg || strc) && avoidHw >= AVOID_MIN) {
        const FN = 4;   // 漸縮帶分段數(固定步長,零共享 rnd ⇒ 佈局序列不受影響)
        for (const e of [0, 1]) {
          const i0 = e ? nP - 1 : 0, i1 = e ? nP - 2 : 1;
          const ex = run[i0][0], ez = run[i0][1];
          if (ex < terrain.minX + inb + ROAD_FLARE_M || ex > terrain.maxX - inb - ROAD_FLARE_M
            || ez < terrain.minZ + inb + ROAD_FLARE_M || ez > terrain.maxZ - inb - ROAD_FLARE_M) continue;
          let dx = ex - run[i1][0], dz = ez - run[i1][1];
          const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;     // 指向結構外
          const px = dz, pz = -dx;
          const yEnd = strc ? tFloorAt(cum[i0]) + ROAD_LIFT : deckAt(cum[i0], ex, ez);
          const yFar = terrain.heightAt(ex + dx * ROAD_FLARE_M, ez + dz * ROAD_FLARE_M);
          if (yFar > yEnd + 1.6 || yFar < yEnd - 3) continue;
          const fbase = b.base, wbase = walk.base;
          for (let k = 0; k <= FN; k++) {
            const t = k / FN;
            const cx = ex + dx * (t * ROAD_FLARE_M), cz = ez + dz * (t * ROAD_FLARE_M);
            const fhw = flareHw(hw, laneHw, t);
            const offs = [[fhw, 1], [fhw * 0.64, 0], [-fhw * 0.64, 0], [-fhw, 1]];
            const hs = offs.map(([off]) => terrain.heightAt(cx + px * off, cz + pz * off));
            const hMax = Math.max(...hs);
            const w = t * t * (3 - 2 * t);       // 高度融合權重(端點切線 0,與 flareHw 同曲線)
            const yAt = (off) => {
              const vx = cx + px * off, vz = cz + pz * off;
              return yEnd + ((Math.max(terrain.heightAt(vx, vz), hMax - CLAMP) + ROAD_LIFT) - yEnd) * w;
            };
            for (let q = 0; q < 4; q++) {
              const [off, ink] = offs[q];
              const vx = cx + px * off, vz = cz + pz * off;
              const yG = Math.max(hs[q], hMax - CLAMP) + ROAD_LIFT;
              b.pos.push(vx, yEnd + (yG - yEnd) * w, vz);
              b.nrm.push(0, 1, 0);
              b.uv.push(vx / 9, vz / 9);
              if (ink) b.col.push(0.52, 0.52, 0.58);
              else b.col.push(1, 1, 1);
            }
            // 避車道邊帶跟著**同一個 fhw** 收(2026-07-31 使用者回報「洞體內外的道路沒接好、寬度不同」):
            // 結構內的斷面是「中央車道 laneHw + 兩側邊帶到 hw」,漸縮帶只鋪柏油的話出洞那 12m
            // 變成一片全寬柏油 —— 邊帶憑空消失、車道邊線對不上 = 洞口一道斷面階。
            // 車道緣全程不動、邊帶寬 fhw − laneHw 收到零 ⇒ 洞內外同一個斷面。純視覺(同 walk 桶、
            // 同 +0.12 路緣高),MUST NOT 進 decks / 走廊 / 碰撞;半寬 MUST NOT 自己再算一次。
            const inO = Math.min(laneHw + 0.1, fhw), outO = Math.max(inO, fhw - 0.1);
            for (const side of [1, -1]) {
              for (const off of [inO * side, outO * side]) {
                walk.pos.push(cx + px * off, yAt(off) + 0.12, cz + pz * off);
                walk.nrm.push(0, 1, 0);
              }
            }
          }
          for (let s2 = 0; s2 < 2; s2++) {          // 兩側各一條帶(每截面 4 頂點:內外緣 × 左右側)
            for (let k = 0; k < FN; k++) {
              const kb = wbase + k * 4 + s2 * 2;
              walk.idx.push(kb, kb + 1, kb + 4, kb + 1, kb + 5, kb + 4);
            }
          }
          walk.base += (FN + 1) * 4;
          for (let k = 0; k < FN; k++) {
            const kb = fbase + k * 4;
            for (const o of [0, 1, 2]) {
              b.idx.push(kb + o, kb + o + 1, kb + o + 4, kb + o + 1, kb + o + 5, kb + o + 4);
            }
          }
          b.base += (FN + 1) * 4;
        }
      }
      const at = (d) => {
        let i = 1; while (cum[i] < d && i < nP - 1) i++;
        const f = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
        const x = run[i - 1][0] + (run[i][0] - run[i - 1][0]) * f;
        const z = run[i - 1][1] + (run[i][1] - run[i - 1][1]) * f;
        let dx = run[i][0] - run[i - 1][0], dz = run[i][1] - run[i - 1][1];
        const l = Math.hypot(dx, dz) || 1;
        return [x, z, dx / l, dz / l];
      };
      // ---- 橋面碰撞面:每個路面小段登記成可站立平台(game.js 表面高度取樣用)----
      if (brg) {
        for (let i = 0; i < nP - 1; i++) {
          decks.push({
            x1: run[i][0], z1: run[i][1], y1: deckAt(cum[i], run[i][0], run[i][1]),
            x2: run[i + 1][0], z2: run[i + 1][1], y2: deckAt(cum[i + 1], run[i + 1][0], run[i + 1][1]),
            hw,
          });
        }
      }
      // ---- 地下道(真・下沉,2026-07-15;2026-07-22 覆蓋區間改制):路面在山體之下的平直道路
      // + 不透明天花板;山體地表原樣保留。覆蓋判定走單一縫區間(tw.intervals:開挖前高度、
      // 短縫縫合成蓋廊)—— 與開挖/走廊/門洞同一份,洞口位置四者一致;舊版逐頂點拿開挖後
      // heightAt 重判,會在門檻帶抖動(牆頂鋸齒/天花缺片)且與開挖結果對不上。
      if (strc && total > 8) {
        const iv = tw.intervals;
        const ceilOf = (s) => tFloorAt(s) + TUN.CLEAR;
        // 洞口圍裙段(2026-07-22):結構(牆/天花/物理段)沿軸向外伸 APRON,門洞立在圍裙外緣 ——
        //  ① 覆蓋轉換處的地形是一格寬拉伸斜崖,結構只蓋到轉換點的話,門洞會被崖面「半埋」、
        //     只露出頂部;外伸後門洞立在崖前、暗面遮住崖面 = 乾淨的洞口。
        //  ② 出洞物理:tunnelAt 縱向夾制(makeTunnelIndex 0.75m)後,若物理段止於轉換點,
        //     單位一出洞就踩上崖面內插地形 = 撞牆卡死;圍裙讓「穿過崖楔」這 8m 仍站洞內路面。
        // 有門洞的那一側才外伸(貼齊 run 端 = 邊界裁切,不伸)。
        const APRON = 8;
        const ivx = iv.map(([c0, c1]) => [c0 >= 4 ? Math.max(0, c0 - APRON) : c0,
                                          c1 <= total - 4 ? Math.min(total, c1 + APRON) : c1]);
        const covS = (s) => ivx.some(([c0, c1]) => s >= c0 - 0.01 && s <= c1 + 0.01);
        // 路面/天花碰撞段 + 不透明天花板:精確裁切到覆蓋區間邊界(= 門洞立面),不因 6m 取樣
        // 在洞口殘留無頂縫隙(高視角俯瞰洞內的 dollhouse 穿幫)。
        // fy 記「可站立路面」= tFloorAt + ROAD_LIFT(與繪製路面同高;舊版記 tFloorAt,
        // 單位在洞內腳部半沉 0.45m)。
        // 幾何側壁牆頂 by(2026-07-29 破口封堵):地下道**全長**(覆蓋段 + 圍裙 + 引道路塹)的
        // 側面是擋土牆/洞壁,牆頂 = 基準線 + KERB(與引道擋土牆網格同一條線)。高度場網格
        // (格距 ~8.2m)把垂直路塹雙線性攤成每步 ≤0.6m 的緩坡 ⇒ 單步 surfaceAt 高差閘在洞口
        // 內側永不觸發(澀谷殘餘 8 破口的機制),側壁必須改幾何判定(makeTunnelIndex.wallCross)。
        // 只有地下道帶 by;山體隧道 by=undefined(無幾何側壁,覆蓋段側面本來就是實心山體、
        // 敞開段是原生山谷)⇒ 山體行為逐位元不變。純客戶端移動物理:slab 上傳只投影 x/z/hw,
        // by 不出海(伺服器語意零漂移)。
        const wallTopAt = under ? (s) => tBaseAt(s) + UND.KERB : () => undefined;
        // 明隧道體檢(2026-07-28 使用者需求 → 2026-07-30 柱列改制):逐頂點/逐側量側向土牆厚度,
        // 藏不住結構的那一側改明隧道 —— 深埋側維持隧道牆,開放側改「矮牆 + 連續柱列」,柱間
        // **透明可見可穿透**。可穿透 = 兩端同量體(原則 3):覆蓋段 tunnelSegs 逐段附 gal 開放側
        // 位元遮罩(bit1 = side +1、bit2 = side −1),main.js 上傳 slab 第 7 欄,伺服器
        // tunnelSideExit 對開放側穿出的射線/爆風放行;客戶端彈道本來就只擋天花/路面/地形,
        // 開放側低地形自然可穿 ⇒ 看得到就打得到。幾何(hw / fy / cy / 走廊 / 門洞)一律不動:
        // 伺服器 slab ribbon、砲塔規則 #5、bal/e2e 全不受影響。
        const floorsV = cum.map((s) => tFloorAt(s));
        const covV = cum.map((s) => covS(s));
        // 地下道恆非明隧道:它的「頂」是原本那片**沒被開挖的平地**(路面沉在地表之下),
        // 側向土牆厚度天生管夠。體檢照跑(法線 nx/nz 是牆/緣石共用的那一份),但 open 一律歸零 ——
        // 引道轉換帶被開挖的碗緣會讓體檢誤判成明隧道,平地上憑空長出外露頂板與柱列。
        const galP = [1, -1].map((side) => {
          const prof = tunnelWallProfile(run, floorsV, covV, (x, z) => terrain.heightAt(x, z), hw, side,
            (x, z) => terrain.natureAt(x, z));   // 落差掃描吃天然地形(開挖前/後同解)
          return under ? prof.map((g) => ({ ...g, open: false })) : prof;
        });
        const galAny = (i) => galP[0][i].open || galP[1][i].open;
        // 逐段開放側遮罩:任一端頂點 open 即記開放(偏向放行 —— 反向偏差是伺服器擋、客戶端
        // 命中 = 傷害靜默蒸發的 A18/A30 一族)。地下道 galP 已歸零 ⇒ 遮罩恆 0。
        const galMask = (i) => (galP[0][i].open || galP[0][i + 1]?.open ? 1 : 0)
                             | (galP[1][i].open || galP[1][i + 1]?.open ? 2 : 0);
        // 明隧道段洞內打洞 bore:只在有明隧道側的小段發(深埋段地表恆高於天花,bore 天然
        // no-op,不發省帳)。每兩頂點(~12m)一支、首尾各外溢 1m 與鄰支交疊(punchPortalHoles
        // 走廊自錨點 0.5m 起算,不交疊會留 0.5m 條狀殘牆);彎道以 12m 直軸近似,誤差 << hw。
        for (let i = 0; i + 1 < nP && galBores.length < TUN.GAL_BORE_MAX; i += 2) {
          const j = Math.min(nP - 1, i + 2);
          let any = false;
          for (let k = i; k <= j; k++) if (covV[k] && galAny(k)) { any = true; break; }
          if (!any) continue;
          const s0 = Math.max(0, cum[i] - 1), s1 = Math.min(total, cum[j] + 1);
          if (s1 - s0 < 2) continue;
          const [bx, bz, ddx, ddz] = at(s0);
          galBores.push({ x: bx, z: bz, y: tFloorAt(s0), ry: Math.atan2(-ddx, -ddz),
                          hw, depth: s1 - s0, slope: (tFloorAt(s1) - tFloorAt(s0)) / (s1 - s0) });
        }
        for (let i = 0; i < nP - 1; i++) {
          const sA = cum[i], sB = cum[i + 1];
          for (const [c0, c1] of ivx) {
            const o0 = Math.max(sA, c0), o1 = Math.min(sB, c1);
            if (o1 - o0 < 0.4) continue;
            const [x1, z1] = at(o0), [x2, z2] = at(o1);
            tunnelSegs.push({
              x1, z1, fy1: tFloorAt(o0) + ROAD_LIFT, cy1: ceilOf(o0),
              x2, z2, fy2: tFloorAt(o1) + ROAD_LIFT, cy2: ceilOf(o1), hw,
              by1: wallTopAt(o0), by2: wallTopAt(o1),
              gal: galMask(i),   // 明隧道開放側註記(只上傳 slab 第 7 欄;幾何欄位一律與 gal 無關)
            });
            ceilSegs.push({ x1, z1, cy1: ceilOf(o0), x2, z2, cy2: ceilOf(o1), hw: hw + 0.6 });
          }
        }
        // ---- 地下道引道 open 物理段(2026-07-29「隧道方法」改制 ③)----
        // 引道(圍裙外的敞開補集)登記 open:true 的隧道段:①surfaceAt 捕捉(curY < ceil)讓
        // 單位站在**精確的下沉剖面**上(而非開挖後網格內插的近似值),入洞/出洞只沿道路兩端
        // C1 連續斜坡;②_updatePlayer 的隧道側壁閘(inTun0 + g > py0 + 2.6)擋住從溝底爬牆
        // 側出 —— 出入口只在道路頭尾兩端。cy 沿用 ceilOf 同一條公式(與覆蓋段零分支),但
        // open 段對其餘消費端 MUST 隱形:不上傳伺服器 slab(main.js 過濾 !d.open)、不擋彈道
        // (_slabHitT)、不當天花(ceilingAt)、不回報 lev=2 —— 露天路塹頭上是天空,不是隧道。
        // 山體隧道(under=false)MUST NOT 登記:它的敞開段是原生山谷地形,照舊踩 heightAt。
        if (under) {
          const openIv = [];
          let sPrev = 0;
          for (const [c0, c1] of ivx) { if (c0 - sPrev > 0.4) openIv.push([sPrev, c0]); sPrev = Math.max(sPrev, c1); }
          if (total - sPrev > 0.4) openIv.push([sPrev, total]);
          for (let i = 0; i < nP - 1; i++) {
            const sA = cum[i], sB = cum[i + 1];
            for (const [c0, c1] of openIv) {
              const o0 = Math.max(sA, c0), o1 = Math.min(sB, c1);
              if (o1 - o0 < 0.4) continue;
              const [x1, z1] = at(o0), [x2, z2] = at(o1);
              tunnelSegs.push({
                x1, z1, fy1: tFloorAt(o0) + ROAD_LIFT, cy1: ceilOf(o0),
                x2, z2, fy2: tFloorAt(o1) + ROAD_LIFT, cy2: ceilOf(o1), hw, open: true,
                by1: wallTopAt(o0), by2: wallTopAt(o1),
              });
            }
          }
          // 引道路塹的斷面淨空(2026-07-31 使用者回報「殘餘地形在道路之上」):垂直路塹是**開挖**
          // 出來的,牆是結構、地被與地形卻仍沿著切面攤下來 —— 高度場把 10m 深的垂直壁攤成一格寬的
          // 斜面,那片斜面(與貼在上面的地被拼圖)就橫在路塹斷面裡,從洞內往外看是幾片浮在路面上
          // 方的土色薄片。沿引道逐段發 bore(與門洞/明隧道共用同一次 punch),把「路面以上、天花
          // 以下、±hw 以內」的繪製三角形清掉;垂直三條界不動 ⇒ 路塹底與牆背照樣不刪。
          for (const [c0, c1] of openIv) {
            for (let s0 = c0; s0 < c1 - 0.5 && galBores.length < TUN.GAL_BORE_MAX; s0 += 12) {
              const s1 = Math.min(c1, s0 + 12);
              const [bx, bz, ddx, ddz] = at(s0);
              galBores.push({ x: bx, z: bz, y: tFloorAt(s0), ry: Math.atan2(-ddx, -ddz),
                              hw, depth: s1 - s0 + 1, slope: (tFloorAt(s1) - tFloorAt(s0)) / (s1 - s0 || 1) });
            }
          }
        }
        // facade 落地基準(單一縫:矮牆緞帶與柱列共用)—— 沉到側坡地表最低點之下 0.8m,
        // 坡面與牆之間不留看穿的縫;埋在土裡的部分不花額外頂點(同一條緞帶只是拉長)。
        const galBase = (i, g) => Math.min(floorsV[i] - 0.3, g.gy - 0.8);
        // 兩側牆(路面 → 天花):覆蓋段立起,敞開段(洞口)收成零高不破圖。
        // 明隧道開放側(2026-07-30 柱列改制):同一條緞帶改當「落地矮牆」—— 底緣落到側坡地表
        // 之下、頂緣只到路面 + SILL(護欄牆),牆上改由連續柱列撐天花板,柱間透明可見可穿透
        // (深埋側維持整面隧道牆;伺服器經 slab gal 遮罩同步放行,見 tunnelSegs 註記)。
        for (const prof of galP) {          // galP[0] = side +1、galP[1] = side −1(法線已含在 prof)
          const k0 = wall.base;
          for (let i = 0; i < nP; i++) {
            const [x, z] = run[i];
            const g = prof[i];
            const vx = x + g.nx * hw, vz = z + g.nz * hw;
            const yF = g.open ? galBase(i, g) : floorsV[i] - 0.3;
            // 敞開段:山體隧道收成零高(引道兩側是原生山壁,牆立起來反而擋在崖面外);
            // 地下道則相反 —— 引道是我們挖出來的路塹,MUST 立擋土牆頂到**地表基準 + 護欄高**,
            // 開挖斜壁藏到牆後,從外面看就是「一般路面 → 緣石帶 → 護欄 → 下沉車道」。
            const yT = !covV[i] ? (under ? tBaseAt(cum[i]) + UND.KERB : yF + 0.15)
              : g.open ? floorsV[i] + TUN.SILL
                : ceilOf(cum[i]) + 0.2;
            wall.pos.push(vx, yF, vz, vx, yT, vz);
            wall.nrm.push(-g.nx, 0, -g.nz, -g.nx, 0, -g.nz);
          }
          for (let i = 0; i < nP - 1; i++) { const k = k0 + i * 2; wall.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
          wall.base += nP * 2;
          // 連續柱列:明隧道開放側每 COL_GAP 一支,自 facade 底緣(落地)頂到頂板頂面 ——
          // 柱子撐起外露頂板,柱間就是「透明可見可穿透」的開口,是明隧道最好認的外觀特徵。
          // **純視覺,不登記碰撞柱(cols)** —— 柱間本就可穿透,登記了反而在通行走廊邊緣
          // 多出與伺服器判定分家的隱形障礙(伺服器 slab 開放側是整段放行,無逐柱語意)。
          let nextS = 0;
          for (let i = 0; i < nP; i++) {
            const g = prof[i];
            if (!g.open || cum[i] < nextS || galCols.length >= TUN.COL_MAX) continue;
            nextS = cum[i] + TUN.COL_GAP;
            const D = 0.85, off = hw + D / 2 - 0.15;   // 柱深 / 柱心離中線(內緣略埋進牆線不留縫)
            galCols.push({ x: run[i][0] + g.nx * off, z: run[i][1] + g.nz * off,
                        y0: galBase(i, g), y1: tunRoofTop(ceilOf(cum[i])),
                        ry: Math.atan2(-g.nz, g.nx), d: D, w: 0.85 });
          }
        }
        // 明隧道外露頂板 + 女兒牆(「明」的那一面):不透明天花板只是一片零厚度、朝下的板,
        // 上面本來靠山體當屋頂;土牆藏不住的地方(單邊薄/挖穿/縫合蓋廊段)從外面與高空看
        // 就是天花板邊緣與土坡之間的一道縫。補一塊有厚度的頂板(頂面 = 路面 + CLEAR + ROOF_T,
        // 較通行寬外挑 EAVE 當簷口,MUST 蓋過 ceilSegs 的 hw+0.6),明隧道側再立女兒牆。
        // 只在有明隧道側的小段建 —— 深埋段的頂板永遠在山體裡,建了也只是多幾個三角形。
        {
          const RW = hw + TUN.EAVE;
          const topAt = (i) => tunRoofTop(ceilOf(cum[i]));
          const quad = (c4, nrm) => {
            const k = galRoof.base;
            for (const c of c4) { galRoof.pos.push(c[0], c[1], c[2]); galRoof.nrm.push(nrm[0], nrm[1], nrm[2]); }
            galRoof.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
            galRoof.base += 4;
          };
          for (let i = 0; i + 1 < nP; i++) {                                    // 頂面(兩側各外挑 EAVE)
            if (!(covV[i] || covV[i + 1]) || !(galAny(i) || galAny(i + 1))) continue;
            const A = galP[0][i], B = galP[0][i + 1], tA = topAt(i), tB = topAt(i + 1);
            quad([[run[i][0] + A.nx * RW, tA, run[i][1] + A.nz * RW],
                  [run[i][0] - A.nx * RW, tA, run[i][1] - A.nz * RW],
                  [run[i + 1][0] + B.nx * RW, tB, run[i + 1][1] + B.nz * RW],
                  [run[i + 1][0] - B.nx * RW, tB, run[i + 1][1] - B.nz * RW]], [0, 1, 0]);
          }
          // 簷口封邊 + 女兒牆(一條帶):該側兩端都是明隧道才立(轉換處的半段正好埋進山壁,
          // 看不到)。柱列改制後開放側上緣露出頂板橫斷面,封邊帶自**天花底面**(topAt − ROOF_T)
          // 一路拉到女兒牆頂 —— 柱頂沒進封邊帶後緣,外觀 = 柱列頂著一道連續邊樑。
          for (const prof of galP) {
            for (let i = 0; i + 1 < nP; i++) {
              if (!prof[i].open || !prof[i + 1].open) continue;
              const A = prof[i], B = prof[i + 1], tA = topAt(i), tB = topAt(i + 1);
              quad([[run[i][0] + A.nx * RW, tA - TUN.ROOF_T, run[i][1] + A.nz * RW],
                    [run[i][0] + A.nx * RW, tA + TUN.PARAPET, run[i][1] + A.nz * RW],
                    [run[i + 1][0] + B.nx * RW, tB - TUN.ROOF_T, run[i + 1][1] + B.nz * RW],
                    [run[i + 1][0] + B.nx * RW, tB + TUN.PARAPET, run[i + 1][1] + B.nz * RW]], [A.nx, 0, A.nz]);
            }
          }
        }
        // ---- 地下道引道的邊緣修飾(2026-07-28 使用者需求「處理邊緣修飾,與一般道路對齊」)----
        // 引道段兩側各鋪一條自牆頂往外 COPE 寬、與**一般路面同高**(= 未下沉的基準線)的緣石帶,
        // 把 carveTunnels 的開挖斜壁蓋掉:從外面看是平整街廓一路鋪到護欄邊,而不是路邊一道土溝。
        // COPE MUST ≥ 開挖外緣 hw+7 − hw,否則斜壁會從緣石外緣露出來。純視覺(不進 raycast/碰撞/走廊)。
        if (under) {
          for (const prof of galP) {
            const k0 = cope.base;
            let seg = 0;
            for (let i = 0; i + 1 < nP; i++) {
              if (covV[i] && covV[i + 1]) continue;   // 洞段頂上是原地表,不必也不該鋪
              for (const j of [i, i + 1]) {
                const g = prof[j], y = tBaseAt(cum[j]) + 0.06;
                for (const d of [hw, hw + UND.COPE]) {
                  cope.pos.push(run[j][0] + g.nx * d, y, run[j][1] + g.nz * d);
                  cope.nrm.push(0, 1, 0);
                }
              }
              const k = k0 + seg * 4;
              cope.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
              seg++;
            }
            cope.base += seg * 4;
          }
        }
        // 橫樑 + 天花燈:僅覆蓋區間內(含縫合蓋廊段 —— 蓋廊也有頂,照樣掛樑燈)
        for (let s = 6; s < total - 4 && beams.length < TUN.LAMP_MAX; s += 12) {
          if (!covS(s)) continue;
          const [ex, ez, ddx, ddz] = at(s);
          beams.push({ x: ex, z: ez, y: tFloorAt(s) + TUN.CLEAR - 0.35, ry: Math.atan2(ddx, ddz), w: hw * 2 + 2 });
          if (ceilLamps.length < TUN.LAMP_MAX) ceilLamps.push({ x: ex, z: ez, y: tFloorAt(s) + TUN.CLEAR - 0.95, ry: Math.atan2(ddx, ddz) });
        }
        // 洞口門洞:立在圍裙外緣(覆蓋轉換面前方 APRON 處)= 站在崖前而非埋進崖裡,位置在
        // 道路中心線上、沿道路軸向、面朝敞開側 —— 出入口永遠沿著道路進出。覆蓋貼齊 run 端
        // (邊界裁切/覆蓋到頭)側沒有引道,不立門。y 取路面基準(舊版取地表高,斷鏈端點會懸空)。
        for (let vi = 0; vi < iv.length; vi++) {
          if (portals.length >= TUN.PORTAL_MAX) break;
          const [c0, c1] = iv[vi], [e0, e1] = ivx[vi];
          for (const [s, sgn, ok] of [[e0, 1, c0 >= 4], [e1, -1, c1 <= total - 4]]) {
            if (portals.length >= TUN.PORTAL_MAX) break;
            if (!ok) continue;
            const [ex, ez, ddx, ddz] = at(s);
            // hw/slope/depth 供洞口打洞 + collar(punchPortalHoles):slope = 每公尺「進洞」的路面高
            // 變化(進洞方向 = 局部 −Z);depth 夾到本區間長度,兩端洞的走廊最多在遠端相接不越界。
            // slope 取**整段走廊的平均**而非洞口處的瞬時斜率:平直剖面(山體隧道)兩者恆等,
            // 地下道的下沉剖面是曲線,拿洞口瞬時斜率往深處線性外推會偏掉好幾公尺。
            const depth = Math.min(e1 - e0, 40);
            const sIn = Math.max(0, Math.min(total, s + sgn * depth));
            // 地下道:打洞/縮零/collar 的路面參考 fp(每 2m 取樣 tFloorAt 同一份剖面)——
            // 下沉剖面是曲線、引道在洞外還一路爬升,線性 slope 外推會把「引道路面之下」的
            // 地形誤刪 ⇒ 洞緣跑進斷面中央、collar 沿它織出橫跨洞口的混凝土殘片(2026-08-05
            // 使用者回報)。取樣範圍兩端各加 FP_PAD:punch 的重疊判定含「部分在走廊外」的
            // 三角形,遠端頂點可落在走廊外一個地形格對角(~12m)—— fp 蓋不到就被夾成端點值,
            // 爬升段照樣誤刪。山體隧道刻意不帶 fp(平直剖面下線性外推本來就精確 ⇒ 打洞行為
            // 逐位元不變)。
            const FP_PAD = 16;
            const fpN = Math.ceil((depth + TUN.MOUTH_OUT + FP_PAD * 2) / 2);
            const fp = under
              ? Array.from({ length: fpN + 1 }, (_, k) =>
                  tFloorAt(Math.max(0, Math.min(total, s + sgn * (k * 2 - TUN.MOUTH_OUT - FP_PAD)))))
              : undefined;
            portals.push({ x: ex, z: ez, y: tFloorAt(s), ry: Math.atan2(-ddx * sgn, -ddz * sgn), w: hw * 2 + 2, h: TUN.CLEAR + 1,
                           hw, depth, mouth: true, tags: way.tags,   // tags:洞口匾額的字(worldtext)
                           ...(fp ? { fp, fpStep: 2, fpOut: TUN.MOUTH_OUT + FP_PAD } : {}),
                           slope: sIn === s ? 0 : (tFloorAt(sIn) - tFloorAt(s)) / Math.abs(sIn - s) });
          }
        }
      }
      // ---- 高架橋外觀:兩側欄杆(直立緞帶)+ 邊梁(box girder)+ 底板(soffit)+ 等間距橋墩落地(含墩帽)+ 橋燈 ----
      if (brg && total > 10) {
        // 橋名牌的錨點(worldtext):兩端橋頭、掛在欄杆外側朝外。位置與朝向一律由**這一份**
        // 橋幾何給,MUST NOT 在別處拿 way.geometry 再算一次(第二份幾何 = 牌子飄在橋外)。
        if (way.tags?.name) {
          for (const [i0, i1] of [[0, Math.min(nP - 1, 1)], [nP - 1, Math.max(0, nP - 2)]]) {
            const a = run[i0], c = run[i1];
            let dx = c[0] - a[0], dz = c[1] - a[1];
            const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
            // 法線 = 沿橋軸向**外**(牌面正對走上橋的人),與 worldtext 的 (sin ry, cos ry) 同一套
            signSpots.push({ kind: 'bridge', tags: way.tags, x: a[0], z: a[1],
              y: deckAt(cum[i0], a[0], a[1]) + 1.35, ry: Math.atan2(-dx, -dz), hw });
          }
        }
        // 人行天橋以固定節距的門型鋼架辨識；落點與橋面高度直接吃本段 deckAt，零共享 rnd。
        // 車行橋不加這組，避免兩種橋只剩寬度不同。門架不進 blockers，通行面仍由 decks 單一縫負責。
        if (ped && footbridgeFrames.length < 180) {
          const step = PED_PLAN.DRESS_STEP_M;
          const first = Math.min(total / 2, 5);
          for (let s = first; s <= total - first + 1e-6 && footbridgeFrames.length < 180; s += step) {
            const [fx, fz, fdx, fdz] = at(s);
            footbridgeFrames.push({ x: fx, y: deckAt(s, fx, fz), z: fz,
              ry: Math.atan2(fdx, fdz), w: hw * 2 });
          }
        }
        for (const side of [1, -1]) {
          const k0 = rail.base;
          for (let i = 0; i < nP; i++) {
            const [x, z] = run[i];
            const a = run[Math.max(0, i - 1)], c = run[Math.min(nP - 1, i + 1)];
            let dx = c[0] - a[0], dz = c[1] - a[1];
            const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
            const vx = x + dz * hw * 0.96 * side, vz = z - dx * hw * 0.96 * side;
            const dy = deckAt(cum[i], x, z);
            rail.pos.push(vx, dy + 0.02, vz, vx, dy + 1.1, vz);
            rail.nrm.push(dz * side, 0, -dx * side, dz * side, 0, -dx * side);
          }
          for (let i = 0; i < nP - 1; i++) {
            const k = k0 + i * 2;
            rail.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
          }
          rail.base += nP * 2;
          // 邊梁:貼在橋面外緣正下方的直立緞帶,補足側視結構厚度(box girder 意象)
          const g0 = girder.base;
          for (let i = 0; i < nP; i++) {
            const [x, z] = run[i];
            const a = run[Math.max(0, i - 1)], c = run[Math.min(nP - 1, i + 1)];
            let dx = c[0] - a[0], dz = c[1] - a[1];
            const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
            const vx = x + dz * hw * 0.98 * side, vz = z - dx * hw * 0.98 * side;
            const dy = deckAt(cum[i], x, z);
            // 底緣夾在地表之上(留 0.2m 微埋):引道口/低架段淨空 <1.1m 時邊梁原本會鑽出地面 = 破圖
            const gBot = Math.max(dy - 1.1, terrain.heightAt(vx, vz) - 0.2);
            girder.pos.push(vx, dy - 0.1, vz, vx, gBot, vz);
            girder.nrm.push(dz * side, 0, -dx * side, dz * side, 0, -dx * side);
          }
          for (let i = 0; i < nP - 1; i++) {
            const k = g0 + i * 2;
            girder.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
          }
          girder.base += nP * 2;
        }
        // 橋面底板(soffit,2026-07-15):兩側邊梁底緣之間補滿混凝土底面 ——
        // 從橋下往上看是實體橋腹,不再是空的(路面 quad 單面朝上,背面剔除後橋下透明)。
        {
          const s0 = soffit.base;
          for (let i = 0; i < nP; i++) {
            const [x, z] = run[i];
            const a = run[Math.max(0, i - 1)], c = run[Math.min(nP - 1, i + 1)];
            let dx = c[0] - a[0], dz = c[1] - a[1];
            const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
            const dyB = deckAt(cum[i], x, z) - 1.1;   // 與邊梁底緣同深(封成箱梁)
            // 底板同樣夾在地表之上:低淨空引道段免鑽出地面破圖(兩緣各自貼各自地表 → 橋腹在橋頭平順沒入地面)
            const ex1 = x + dz * hw * 0.98, ez1 = z - dx * hw * 0.98;
            const ex2 = x - dz * hw * 0.98, ez2 = z + dx * hw * 0.98;
            const sy1 = Math.max(dyB, terrain.heightAt(ex1, ez1) - 0.2);
            const sy2 = Math.max(dyB, terrain.heightAt(ex2, ez2) - 0.2);
            soffit.pos.push(ex1, sy1, ez1, ex2, sy2, ez2);
            soffit.nrm.push(0, -1, 0, 0, -1, 0);
          }
          for (let i = 0; i < nP - 1; i++) {
            const k = s0 + i * 2;
            soffit.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
          }
          soffit.base += nP * 2;
        }
        // 跨水段橋墩不再跳過(2026-07-15):墩身自水底升出水面 —— 大面積水域的高架橋有落墩支撐
        for (let s = 12; s < total - 8 && piers.length < 120; s += 24) {
          const [ex, ez, ddx, ddz] = at(s);
          const y0 = terrain.heightAt(ex, ez), y1 = deckAt(s, ex, ez);
          if (y1 - y0 > 1.4) {
            piers.push({ x: ex, z: ez, y0: y0 - 0.5, y1, r: Math.min(1.4, hw * 0.35), ry: Math.atan2(ddx, ddz), w: hw * 1.7 });
          }
        }
        // 橋燈:沿橋面邊緣等間距、左右交錯(與地面路燈同款,燈臂朝橋心)
        if (!ped && lamps.length < 380) {
          let side2 = rnd() < 0.5 ? 1 : -1;
          for (let s = 16 + rnd() * 10; s < total - 8 && lamps.length < 380; s += 34) {
            const [ex, ez, ddx, ddz] = at(s);
            const qx = ddz, qz = -ddx, off = hw * 0.96 + 0.5;
            const lx = ex + qx * off * side2, lz = ez + qz * off * side2;
            lamps.push({ x: lx, y: deckAt(s, ex, ez), z: lz, ry: Math.atan2(qz * side2, -qx * side2) });
            side2 = -side2;
          }
        }
      }
      // ---- 避車道(2026-07-28 使用者需求「太寬的地方畫人行道或槽化線做為避車道」)----
      // 結構通行寬 hw(≥8)減真實車道寬 laneHw 的差額 avoidHw,每側鋪成避車道邊帶。依道路分級自動選:
      // 幹道(arterial)鋪白色槽化斜線導流區(45°,進 mark 桶與標線同批 draw call);其餘鋪灰色人行道
      // 實體帶(walk 桶,略抬 0.12 = 路緣高)。純視覺:通行寬 / decks / 牆 / 走廊 / 伺服器碰撞完全不動 ——
      // 整條 hw 仍可通行,只是視覺上中央是等於外部路寬的車道、兩側是避車道。高度基準與路面截面同源
      // (結構 tFloorAt+ROAD_LIFT / 橋 deckAt,皆取中心 x,z ⇒ 平),固定步長迴圈、零共享 rnd。
      if ((brg || strc) && avoidHw >= AVOID_MIN) {
        const perpAt = (i) => {
          const a = run[Math.max(0, i - 1)], c = run[Math.min(nP - 1, i + 1)];
          let dx = c[0] - a[0], dz = c[1] - a[1];
          const l = Math.hypot(dx, dz) || 1;
          return [dz / l, -dx / l];
        };
        const roadY = (i) => strc ? tFloorAt(cum[i]) + ROAD_LIFT : deckAt(cum[i], run[i][0], run[i][1]);
        if (arterial) {
          // 槽化線:每側沿弧長每 HSTEP 一道由車道緣(laneHw)斜向結構緣(hw)的白條(≈45°、寬 0.36)
          const HSTEP = 3.4, inHw = laneHw + 0.2, outHw = hw - 0.2;
          const HATCH_END_PAD = 2;
          for (const side of [1, -1]) {
            for (let s = HATCH_END_PAD; s + HSTEP <= total - HATCH_END_PAD; s += HSTEP) {
              const [ax, az, adx, adz] = at(s);
              const [bx, bz, bdx, bdz] = at(s + HSTEP);
              const aqx = adz, aqz = -adx, bqx = bdz, bqz = -bdx;
              const ix = ax + aqx * inHw * side, iz = az + aqz * inHw * side;   // 內端 = 車道緣
              const ox = bx + bqx * outHw * side, oz = bz + bqz * outHw * side; // 外端吃自己的截面，彎道不凸出
              const yIn = (strc ? tFloorAt(s) + ROAD_LIFT : deckAt(s, ax, az)) + 0.13;
              const yOut = (strc ? tFloorAt(s + HSTEP) + ROAD_LIFT : deckAt(s + HSTEP, bx, bz)) + 0.13;
              let ex = ox - ix, ez = oz - iz; const el = Math.hypot(ex, ez) || 1; ex /= el; ez /= el;
              const wx = ez * 0.18, wz = -ex * 0.18;   // 條寬的法向半量(頂點序仿 dashLine:大偏移在前 → 朝 +Y)
              const k = mark.base;
              mark.pos.push(ix + wx, yIn, iz + wz, ix - wx, yIn, iz - wz,
                            ox + wx, yOut, oz + wz, ox - wx, yOut, oz - wz);
              for (let v = 0; v < 4; v++) { mark.nrm.push(0, 1, 0); mark.col.push(...MARK_W); }
              mark.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
              mark.base += 4;
            }
          }
        } else {
          // 人行道:每側沿 run 鋪一條由 laneHw 到 hw 的灰色實體帶(DoubleSide ⇒ 免管繞行朝向)
          const inHw = laneHw + 0.1, outHw = hw - 0.1;
          for (const side of [1, -1]) {
            const k0 = walk.base;
            for (let i = 0; i < nP; i++) {
              const [px, pz] = perpAt(i);
              const yW = roadY(i) + 0.12;
              walk.pos.push(run[i][0] + px * inHw * side, yW, run[i][1] + pz * inHw * side,
                            run[i][0] + px * outHw * side, yW, run[i][1] + pz * outHw * side);
              walk.nrm.push(0, 1, 0, 0, 1, 0);
            }
            for (let i = 0; i < nP - 1; i++) { const k = k0 + i * 2; walk.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
            walk.base += nP * 2;
          }
        }
      }
      // ---- 交通標線(只畫柏油;泥土/礫石路沒有標線)----
      // 結構隧道(2026-07-23 起)照畫:洞內是柏油車道,沒有標線的隧道很出戲。**MUST** 走
      // yBAt 基準高(= 隧道平直路面 tFloorAt,與路面緞帶同源),回退貼地取樣會把標線畫到
      // 覆蓋段上方的山頂(舊版索性整段跳過就是為了躲這個坑)。
      // 橋面同納(2026-07-30 使用者需求「標線與寬度要對齊、風格盡可能一致」):舊版 `!brg` 把
      // 橋整段排除 ⇒ 上橋瞬間車道線與路緣線全部消失(橋卻鋪著避車道邊帶,更顯突兀)。基準高
      // 走 deckAt − ROAD_LIFT:deckAt 回的是橋面**表面**高,減掉 ROAD_LIFT 才與結構分支的
      // tFloorAt(路面基準,+ROAD_LIFT 才是表面)同語意 ⇒ 兩者都吃同一組 lift 常數,標線離
      // 路面的高度在橋/洞/一般路三處一致。回退貼地取樣會把橋上標線畫到河床。
      const markBaseAt = strc ? (s) => tFloorAt(s)
        : brg ? (s, gx, gz) => deckAt(s, gx, gz) - ROAD_LIFT : null;
      const markYB = markBaseAt ? (i) => markBaseAt(cum[i], run[i][0], run[i][1]) : null;
      // 標線半寬 = 塗裝車道半寬(單一縫 carriageHw,一般路的 hw 本來就等於它):結構通行寬被夾到
      // ≥8,標線一律鋪在真實車道寬上 ⇒ 車道數與路緣線位置與結構外那條路對齊,邊帶交給避車道 +
      // 銜接漸縮帶。MUST NOT 依「差額夠不夠寬」在 laneHw / hw 之間切換(見 carriageHw 註解)。
      const mHw = laneHw;
      if (biome === 'urban' && mHw >= 2) {
        // 白虛線通用鋪法:偏移 off(0 = 中線)。off=0 逐位元同舊版中線(±0.28 = 0.56 寬)
        const dashLine = (off) => {
          for (let s = 5; s + 3.2 < total; s += 9.5) {
            const [ax0, az0] = at(s), [bx0, bz0] = at(s + 3.2);
            const px0 = (ax0 + bx0) / 2, pz0 = (az0 + bz0) / 2;
            if (dropXZ(px0, pz0) || inJunctionMarkCut(ax0, az0) || inJunctionMarkCut(bx0, bz0)) continue;
            const k = mark.base;
            for (const d of [s, s + 3.2]) {
              const [ex, ez, ddx, ddz] = at(d);
              const qx = ddz, qz = -ddx;
              const yB = markBaseAt ? markBaseAt(d, ex, ez) : null;
              const hM = yB !== null ? -Infinity
                : Math.max(terrain.heightAt(ex + qx * hw, ez + qz * hw),
                           terrain.heightAt(ex - qx * hw, ez - qz * hw));
              putMark(ex + qx * (off + 0.28), ez + qz * (off + 0.28), 0.58, MARK_W, hM, yB);
              putMark(ex + qx * (off - 0.28), ez + qz * (off - 0.28), 0.58, MARK_W, hM, yB);
            }
            mark.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
            mark.base += 4;
          }
        };
        if (main) {
          // 車道數由車道寬推導(單一縫 roadLaneN,不硬編各路):main 恆 ≥ 雙線道
          const lanes = Math.max(2, Math.round(roadLaneN(way.tags)));
          if (arterial) {                        // 幹道:雙黃實線分向
            emitLine(run, mHw, 0.58, 0.33, 0.2, MARK_Y, markYB, dropMarkSeg);
            emitLine(run, mHw, 0.58, -0.33, 0.2, MARK_Y, markYB, dropMarkSeg);
          } else {                               // 次要道:單白虛線
            dashLine(0);
          }
          // 四線道以上:每向 nHalf 車道 → nHalf−1 條同向車道分隔白虛線(壓在路緣線內)
          if (lanes >= 4) {
            const nHalf = Math.round(lanes / 2);
            for (let k = 1; k < nHalf; k++) {
              const off = mHw * k / nHalf;
              if (off + 0.28 < mHw * 0.78) { dashLine(off); dashLine(-off); }
            }
          }
          // 路緣白邊線(車道外側,墨帶內)
          emitLine(run, mHw, 0.56, mHw * 0.78, 0.18, MARK_W, markYB, dropMarkSeg);
          emitLine(run, mHw, 0.56, -mHw * 0.78, 0.18, MARK_W, markYB, dropMarkSeg);
        }
        // ---- 路燈:沿路等間距、左右交錯(燈臂朝路心)----
        // 隧道不立(洞內照明是天花燈;路燈桿會戳穿天花板與山體);橋不立(橋燈另有一套沿橋面
        // 邊緣的實例,見上方 brg 段 —— 地面路燈桿以 heightAt 落地,在高架橋上會從橋面下長出來)
        if (!strc && !brg && main && lamps.length < 380) {
          let side = rnd() < 0.5 ? 1 : -1;
          for (let s = 14 + rnd() * 10; s < total - 8 && lamps.length < 380; s += 40) {
            const [ex, ez, ddx, ddz] = at(s);
            const qx = ddz, qz = -ddx, off = hw + 1.2;
            const lx = ex + qx * off * side, lz = ez + qz * off * side;
            if (terrain.heightAt(lx, lz) < 0.4) { side = -side; continue; }
            lamps.push({ x: lx, y: terrain.heightAt(lx, lz), z: lz,
                         ry: Math.atan2(qz * side, -qx * side) });   // 局部 +x 指向路心
            side = -side;
          }
        }
      } else if (!brg && !strc && (biome === 'green' || biome === 'wet') && main && hw >= 2.4) {
        // ---- 行道樹:郊區幹道兩側等間距(純視覺,不登記碰撞)----
        for (let s = 10 + rnd() * 8; s < total - 6 && roadTrees.length < 460; s += 26 + rnd() * 8) {
          const [ex, ez, ddx, ddz] = at(s);
          const qx = ddz, qz = -ddx, off = hw + 1.6 + rnd() * 0.8;
          for (const side of [1, -1]) {
            if (rnd() < 0.18) continue;          // 缺株:不像牙籤陣
            const tx = ex + qx * off * side, tz = ez + qz * off * side;
            const ty = terrain.heightAt(tx, tz);
            if (ty < 0.4) continue;
            roadTrees.push({ x: tx, y: ty, z: tz, ry: rnd() * Math.PI * 2, s: 0.8 + rnd() * 0.5 });
          }
        }
      }
      // ---- 沿道路／鐵道步行廊道的統一鋪裝 ----
      // 只改表現層：不加碰撞、不改路寬；固定節距、零共享 rnd。老街的燈退到路肩，不佔步道中心。
      if (pedTheme && pedTheme !== 'footbridge') {
        const pedBand = (s, halfLen, halfW, color) => {
          for (const ds of [-halfLen, halfLen]) {
            const [x, z, dx, dz] = at(Math.max(0, Math.min(total, s + ds)));
            const qx = dz, qz = -dx;
            const yB = markBaseAt ? markBaseAt(s + ds, x, z) : null;
            const hM = yB !== null ? -Infinity
              : Math.max(terrain.heightAt(x + qx * hw, z + qz * hw), terrain.heightAt(x - qx * hw, z - qz * hw));
            for (const side of [1, -1]) {
              const vx = x + qx * halfW * side, vz = z + qz * halfW * side;
              putMark(vx, vz, 0.59, color, hM, yB);
            }
          }
          const k = mark.base;
          mark.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
          mark.base += 4;
        };
        if (pedTheme === 'cycleway') {
          for (let s = 3; s + 2.8 < total; s += 7.5) pedBand(s + 1.4, 1.4, 0.1, MARK_W);
        } else if (pedTheme === 'oldstreet') {
          for (let s = 5; s < total - 2; s += 11) pedBand(s, 0.22, hw * 0.82, [0.92, 0.72, 0.38]);
          const phase = Math.abs(Math.round(run[0][0] * 13 + run[0][1] * 29)) % 12;
          for (let s = 8 + phase; s < total - 5 && marketLamps.length < 180; s += 30) {
            const [x, z, dx, dz] = at(s), qx = dz, qz = -dx;
            const side = ((Math.floor((s - phase) / 30) & 1) ? 1 : -1);
            const lx = x + qx * (hw + 1.1) * side, lz = z + qz * (hw + 1.1) * side;
            marketLamps.push({ x: lx, y: terrain.heightAt(lx, lz), z: lz,
              ry: Math.atan2(qz * side, -qx * side) });
          }
        } else if (pedTheme === 'promenade') {
          emitLine(run, hw, 0.57, hw * 0.72, 0.12, [0.84, 0.86, 0.82], null, dropMarkSeg);
          emitLine(run, hw, 0.57, -hw * 0.72, 0.12, [0.84, 0.86, 0.82], null, dropMarkSeg);
        }
      }
      built++;
      if (built >= maxRuns) break;
      }   // pieces(拆段)迴圈
      if (built >= maxRuns) break;
    }
    if (built >= maxRuns) break;
  }

  // ---- 路口:斑馬線 + 紅綠燈(市區、車行路口、彼此至少 70m)----
  const junctions = [];
  for (const rec of nodeArms.values()) {
    if (rec.arms < 3 || junctions.length >= 30) continue;
    if (rec.x < terrain.minX + inb + 10 || rec.x > terrain.maxX - inb - 10
      || rec.z < terrain.minZ + inb + 10 || rec.z > terrain.maxZ - inb - 10) continue;
    const h = terrain.heightAt(rec.x, rec.z);
    if (h < 0.4) continue;
    // 純圖資分類(不吃場地 mix 改寫):斑馬線只該出現在柏油市區
    if (classify(terrain.sampleColor?.(rec.x, rec.z), h, null, rnd) !== 'urban') continue;
    if (junctions.some((j) => Math.hypot(j.x - rec.x, j.z - rec.z) < 70)) continue;
    junctions.push(rec);
    const arms2 = rec.dirs.slice(0, 4);            // 前置統計已合併相近方向，不在這裡再分家
    const hJ = terrain.heightAt(rec.x, rec.z);     // 路口中心高:白槓跟路面同一條夾高規則
    for (let ai = 0; ai < arms2.length; ai++) {
      const [dx, dz] = arms2[ai], armHw = rec.armHw[ai];
      const qx = dz, qz = -dx;
      const d0 = rec.hw + 1.2;                     // 由最大臂定中央淨空，斑馬線不伸進路口填面
      const zw = Math.max(0.75, armHw * 0.82);      // 各臂吃自己的寬，窄側路不被寬幹道橫向撐出路面
      // 白槓長軸沿行車方向(3.2m 深)、槓寬 0.5m / 間 0.5m,橫向重複鋪滿路寬
      for (let lo = -zw; lo + 0.5 <= zw + 0.01; lo += 1.0) {
        const kb = mark.base;
        for (const dd of [d0, d0 + 3.2]) {
          const cx2 = rec.x + dx * dd, cz2 = rec.z + dz * dd;
          // 頂點序同 emitLine(大偏移在前)→ 面朝 +y
          putMark(cx2 + qx * (lo + 0.5), cz2 + qz * (lo + 0.5), 0.58, MARK_W, hJ);
          putMark(cx2 + qx * lo, cz2 + qz * lo, 0.58, MARK_W, hJ);
        }
        mark.idx.push(kb, kb + 1, kb + 2, kb + 1, kb + 3, kb + 2);
        mark.base += 4;
      }
    }
    // 紅綠燈:取前兩臂的右側轉角各立一支,燈頭朝路口
    for (const [dx, dz] of arms2.slice(0, 2)) {
      const qx = dz, qz = -dx;
      const lx = rec.x + dx * (rec.hw + 1.6) + qx * (rec.hw + 1.0);
      const lz = rec.z + dz * (rec.hw + 1.6) + qz * (rec.hw + 1.0);
      const ly = terrain.heightAt(lx, lz);
      if (ly < 0.4) continue;
      lights.push({ x: lx, y: ly, z: lz, ry: Math.atan2(qz, -qx) });   // 燈臂 +x 伸回路面上方
    }
  }

  // ---- 路口填面 + 寬度縮減(2026-07-24):道路是各自獨立緞帶,只靠共用 OSM 節點重疊 ——
  // 路口內角的三角楔形露地、寬窄路對接的邊緣落差都無填補幾何。此處對車行節點補道路色面片
  // (進路面桶 → 同色同材質,與緞帶內部重疊不可見,只補露地/落差)。純幾何零 rnd;classify 傳
  // mix=null(同斑馬線迴圈)不消耗共享序列。橋/隧節點本就不入 nodeArms。繞行朝 +Y(依緞帶截面推導)。
  const fillLift = (vx, vz, hMax) => Math.max(terrain.heightAt(vx, vz), hMax - CLAMP) + ROAD_LIFT;
  for (const rec of nodeArms.values()) {
    if (rec.hw < 2) continue;
    let mode = 0;                                  // 3 = 路口圓面 / 2 = 寬度縮減梯形
    if (rec.arms >= 3) mode = 3;
    else if (rec.arms === 2 && rec.armHw.length === 2) {
      const [d0, d1] = rec.dirs, [hw0, hw1] = rec.armHw;
      // 兩臂近反向(直線穿過)且半寬差顯著 → 一條路收窄成另一條
      if (Math.abs(hw0 - hw1) > 0.6 && d0[0] * d1[0] + d0[1] * d1[1] < -0.7) mode = 2;
    }
    if (!mode) continue;
    const biome = classify(terrain.sampleColor?.(rec.x, rec.z), terrain.heightAt(rec.x, rec.z), null, rnd);
    if (biome === 'water') continue;               // 河面節點(橋另建),不鋪路面
    const b = bucketOf(biome, rec.main);
    if (mode === 3) {
      // 扇形圓面:半徑 = 節點最大臂半寬;中心 + N 段緣點,取樣最高地表夾高(坡地不浮不沉)
      const R = rec.hw, N = 10;
      let hMax = terrain.heightAt(rec.x, rec.z);
      for (let k = 0; k < N; k++) {
        const a = k / N * Math.PI * 2;
        hMax = Math.max(hMax, terrain.heightAt(rec.x + Math.cos(a) * R, rec.z + Math.sin(a) * R));
      }
      const c0 = b.base;
      b.pos.push(rec.x, fillLift(rec.x, rec.z, hMax), rec.z);
      b.nrm.push(0, 1, 0); b.uv.push(rec.x / 9, rec.z / 9); b.col.push(1, 1, 1);
      for (let k = 0; k <= N; k++) {
        const a = k / N * Math.PI * 2;
        const vx = rec.x + Math.cos(a) * R, vz = rec.z + Math.sin(a) * R;
        b.pos.push(vx, fillLift(vx, vz, hMax), vz);
        b.nrm.push(0, 1, 0); b.uv.push(vx / 9, vz / 9); b.col.push(1, 1, 1);
      }
      for (let k = 0; k < N; k++) b.idx.push(c0, c0 + 2 + k, c0 + 1 + k);   // (心, 緣k+1, 緣k) → 朝 +Y
      b.base += N + 2;
    } else {
      // 縮減梯形:統一以 d0 為軸,前 T 截面寬 hw0、後 T 截面寬 hw1(d1≈−d0)
      const [d0] = rec.dirs, [hw0, hw1] = rec.armHw;
      const T = Math.min(6, Math.max(hw0, hw1) * 1.5);
      const px = d0[1], pz = -d0[0];
      const s0x = rec.x + d0[0] * T, s0z = rec.z + d0[1] * T;
      const s1x = rec.x - d0[0] * T, s1z = rec.z - d0[1] * T;
      const hMax = Math.max(terrain.heightAt(s0x, s0z), terrain.heightAt(s1x, s1z), terrain.heightAt(rec.x, rec.z));
      const P = [[s0x + px * hw0, s0z + pz * hw0], [s0x - px * hw0, s0z - pz * hw0],
                 [s1x + px * hw1, s1z + pz * hw1], [s1x - px * hw1, s1z - pz * hw1]];
      const c0 = b.base;
      for (const [vx, vz] of P) {
        b.pos.push(vx, fillLift(vx, vz, hMax), vz);
        b.nrm.push(0, 1, 0); b.uv.push(vx / 9, vz / 9); b.col.push(1, 1, 1);
      }
      b.idx.push(c0, c0 + 2, c0 + 1, c0 + 1, c0 + 2, c0 + 3);   // 反向繞行 → 朝 +Y
      b.base += 4;
    }
  }

  // ---- 立體結構的線工授權(⑨-3;2026-08-16 序 12b)----------------------------------
  // 貢獻(`outlineContribution`)一律由**這一桶剛排完的幾何**實測推導,MUST NOT 手寫數字、
  // MUST NOT 建「零件種類 → 貢獻」的名冊(名冊會在加構件時靜默過期;§2.1 F outlineContribution)。
  //
  // 量的是**節距**:本檔每一個帶狀/面狀桶的頂點都是**成對**推入的 —— 直立緞帶(欄杆 / 邊梁 /
  // 擋土牆)是同一 (x,z) 的下緣與上緣,面狀件(路面 / 標線 / 底板 / 緣石帶)是跨向的兩緣。
  // ⇒ 每一對的距離就是「這一條線與下一條線之間有多遠」,也就是 `inkRepeat` 那一軸要的東西。
  // 取**最大值**不是最小值:邊梁底緣被地表夾住的那幾段對距會退化成 0(引道口),拿 min 就是
  // 整條邊梁的墨線一起消失,而畫面上只表現成「橋腹沒有線」、沒有任何錯誤訊息。
  // 手寫第二份 `1.1` 的代價是「改了緞帶高度而貢獻停在舊值」—— 同樣沒有錯誤訊息。
  const bandPitchM = (b) => {
    let m = 0;
    for (let i = 0; i + 5 < b.pos.length; i += 6) {
      const d = Math.hypot(b.pos[i + 3] - b.pos[i], b.pos[i + 4] - b.pos[i + 1], b.pos[i + 5] - b.pos[i + 2]);
      if (d > m) m = d;
    }
    return m;
  };
  // ---- 路面 Mesh(每「地貌×主次」一個 draw call;柏油/泥土/礫石材質塗層)----
  // 貢獻**維持預設 1**:跨向節距 = 車道寬(≫ `INK_REPEAT_M`)⇒ 推導值就是 1,而
  // `inkQuant(1)` 嚴格 === 1 ⇒ 寫一個 `contrib: 1` 進去只是把「推導」偽裝成手寫的常數。
  for (const b of buckets.values()) {
    if (!b.idx.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    geo.setIndex(b.idx);
    // polygonOffset:把路面往鏡頭拉,恆蓋過地被拼貼(橫坡路塹段夾到 hMax−0.7 時與地被同高不 z-fight)
    const m = new THREE.Mesh(geo, envMat(b.color, {
      map: roadTex(b.tex), vertexColors: true, wash: 0.55, cool: 0.5, rim: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    m.frustumCulled = false;
    m.renderOrder = 1;
    m.userData.noOutline = true;
    group.add(m);
  }
  // ---- 標線 Mesh(黃/白頂點色,單一 draw call)----
  if (mark.idx.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(mark.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(mark.nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(mark.col, 3));
    geo.setIndex(mark.idx);
    // 標線 offset 比路面更強(−3 < −2)→ 恆畫在路面之上,不與被拉近的路面 z-fight
    // 貢獻:標線是**塗料**不是構件 —— 它與路面貼在同一個平面上,兩者的 surfaceId 一差就是
    // 每一條虛線、每一塊斑馬線都被描一圈黑邊(inkMrt 開著時最刺眼的一處)。實測對距
    // 0.18~0.56m(縱向實線 / 雙黃線 / 斑馬線 / 導流線)⇒ 節距軸把它收到一絲筆觸。
    const m = new THREE.Mesh(geo, envMat(0xf2edda, { vertexColors: true, wash: 0.15, cool: 0.3, rim: 0,
      contrib: inkRepeat(bandPitchM(mark)),
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    m.frustumCulled = false;
    m.renderOrder = 2;
    m.userData.noOutline = true;
    group.add(m);
  }
  // ---- 避車道人行道(灰色實體帶,雙面;結構通行寬 > 車道寬時鋪在兩側邊帶)----
  if (walk.idx.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(walk.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(walk.nrm, 3));
    geo.setIndex(walk.idx);
    const m = new THREE.Mesh(geo, envMat(0x8a867e, { wash: 0.3, cool: 0.35, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.frustumCulled = false;
    m.userData.noOutline = true;
    m.renderOrder = 1;
    group.add(m);
  }
  // ---- 高架橋欄杆(直立緞帶,雙面)----
  if (rail.idx.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(rail.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(rail.nrm, 3));
    geo.setIndex(rail.idx);
    // 貢獻:計畫 §⑨ 寫的「欄杆立柱 → 中等」在本儲存庫沒有立柱 —— 欄杆是**一條連續緞帶**,
    // 「量太滿」的實際來源是緞帶上下兩條邊的二階差分(側視一座橋在 2.2m 內擠著欄杆上下緣、
    // 邊梁上下緣、底板緣共五條近乎平行的線)。節距軸吃的正是這件事:帶高 1.08m。
    const m = new THREE.Mesh(geo, envMat(0xaab2b8, { wash: 0.35, cool: 0.45, side: THREE.DoubleSide,
      contrib: inkRepeat(bandPitchM(rail)) }));
    m.frustumCulled = false;
    m.userData.noOutline = true;
    group.add(m);
  }
  // ---- 高架橋邊梁(直立緞帶,雙面;貼在橋面外緣下方,補足側視結構厚度)----
  if (girder.idx.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(girder.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(girder.nrm, 3));
    geo.setIndex(girder.idx);
    // 貢獻同欄杆(同一族的第二條緞帶,帶高 1.0m);底板 `soffit` 刻意**不收** —— 它的對距是
    // 橋寬(10~20m)⇒ 推導值本來就是 1,而從橋下抬頭那一條輪廓正是橋的剪影。
    const m = new THREE.Mesh(geo, envMat(0x5c636a, { wash: 0.3, cool: 0.5, side: THREE.DoubleSide,
      contrib: inkRepeat(bandPitchM(girder)) }));
    m.frustumCulled = false;
    m.userData.noOutline = true;
    group.add(m);
  }
  // ---- 高架橋底板(soffit,雙面):從橋下往上看的橋體底面,封住兩側邊梁之間的開口 ----
  if (soffit.idx.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(soffit.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(soffit.nrm, 3));
    geo.setIndex(soffit.idx);
    const m = new THREE.Mesh(geo, envMat(0x565d64, { wash: 0.3, cool: 0.5, side: THREE.DoubleSide }));
    m.frustumCulled = false;
    m.userData.noOutline = true;
    group.add(m);
  }
  // ---- 人行天橋門型鋼架：一個生成器族，所有橋只提供位置／寬度資料列 ----
  buildFootbridgeFrames(group, footbridgeFrames);

  // ---- 地下道擋土牆(直立緞帶,雙面)+ 橫樑 ----
  if (wall.idx.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(wall.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(wall.nrm, 3));
    geo.setIndex(wall.idx);
    const m = new THREE.Mesh(geo, envMat(0x8f8b83, { wash: 0.4, cool: 0.4, side: THREE.DoubleSide }));
    m.frustumCulled = false;
    m.userData.noOutline = true;
    group.add(m);
  }
  // ---- 明隧道外露頂板 + 女兒牆(2026-07-28):土牆藏不住結構的段落,從外面/高空看見的是
  // 完整的結構物頂面(而非零厚度的天花板邊緣與土坡之間的縫)。材質沿用門洞/collar 的混凝土
  // —— 明隧道與洞口在現實中就是同一座構造物,同色才連得起來。----
  if (galRoof.idx.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(galRoof.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(galRoof.nrm, 3));
    geo.setIndex(galRoof.idx);
    // polygonOffset:頂板頂面與「剛好等高的地表」在轉換帶會擦身而過(明隧道判定門檻正是
    // 地表 < 頂板頂面),不推一點點就是一條閃爍的接縫。
    // `surf`(⑨-4):額牆 / 翼牆 / collar / 外露頂板是**同一座構造物**(這一行的註解自己寫了),
    // 而現制它們各呼叫一次 `envMat` ⇒ 各抽一個 `nextSurfId()` ⇒ `INK_MRT.ID` 會在同一座
    // 構造物**內部**畫線。共用具名號之後線收窄到只落在外緣;混凝土↔上方山坡那條線照樣出得來
    // (地貌恆 `SURF_ID.LAND = 0`,兩者差 1/64 = 0.0156 > 勾線 pass 的 id 門檻 0.004 ——
    //  ⚠ 那個門檻是 postfx 著色器裡 `step( 0.004, idv )` 的字面,不是 `INK_MRT.ID`(= 線的強度))。
    const m = new THREE.Mesh(geo, envMat(0x9a958c, { wash: 0.4, cool: 0.45, side: THREE.DoubleSide,
      surf: SURF_ID.CONCRETE,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    m.frustumCulled = false;
    m.userData.noOutline = true;
    group.add(m);
  }
  // ---- 地下道引道緣石帶(邊緣修飾):與一般路面同高的平頂帶,蓋住開挖斜壁 ----
  // polygonOffset 同 galRoof:緣石帶與「剛好等高的地表」在外緣會擦身而過,不推一點點就是閃爍接縫。
  if (cope.idx.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(cope.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(cope.nrm, 3));
    geo.setIndex(cope.idx);
    const m = new THREE.Mesh(geo, envMat(0x8b8880, { wash: 0.4, cool: 0.4, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    m.frustumCulled = false;
    m.userData.noOutline = true;
    group.add(m);
  }
  // ---- 明隧道柱列:開放側每 COL_GAP 一支撐頂柱(純視覺,不登記碰撞柱;柱間可穿透)----
  if (galCols.length) {
    // 貢獻:柱列是本專案唯一真正「重複到會變雜訊」的結構構件(計畫 §⑨ 的「格網」那一格)
    // ⇒ 節距軸直接吃 `TUN.COL_GAP`(現值 4.5m ≥ `INK_REPEAT_M` 3.6m ⇒ 推導值 1 = 舊制)。
    // 這一行今天是恆等式,但把柱距收緊到 3.6m 以下時它會自己讓步,MUST NOT 改寫成常數。
    const btM = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      envMat(0x938e85, { wash: 0.4, cool: 0.45, contrib: inkRepeat(TUN.COL_GAP) }), galCols.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
    const P = new THREE.Vector3(), S = new THREE.Vector3();
    galCols.forEach((b, i) => {
      E.set(0, b.ry, 0); Q.setFromEuler(E);
      P.set(b.x, (b.y0 + b.y1) / 2, b.z);
      S.set(b.d, Math.max(0.5, b.y1 - b.y0), b.w);
      M.compose(P, Q, S);
      btM.setMatrixAt(i, M);
    });
    btM.instanceMatrix.needsUpdate = true;
    btM.castShadow = false;
    btM.frustumCulled = false;
    btM.userData.noOutline = true;
    group.add(btM);
  }
  // ---- 地下道不透明天花板:覆蓋段的頂板(擋住上方山體底面,從洞內抬頭看是天花而非穿幫的山體背面)----
  if (ceilSegs.length) {
    const pos = [], nrm = [], idx = []; let base = 0;
    for (const s of ceilSegs) {
      let dx = s.x2 - s.x1, dz = s.z2 - s.z1; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const px = dz, pz = -dx;
      const c4 = [[s.x1 + px * s.hw, s.cy1, s.z1 + pz * s.hw], [s.x1 - px * s.hw, s.cy1, s.z1 - pz * s.hw],
        [s.x2 + px * s.hw, s.cy2, s.z2 + pz * s.hw], [s.x2 - px * s.hw, s.cy2, s.z2 - pz * s.hw]];
      for (const c of c4) { pos.push(c[0], c[1], c[2]); nrm.push(0, -1, 0); }   // 面朝下(洞內看得到)
      idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      base += 4;
    }
    const cgeo = new THREE.BufferGeometry();
    cgeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    cgeo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    cgeo.setIndex(idx);
    const cm = new THREE.Mesh(cgeo, envMat(0x4a4d47, { wash: 0.3, cool: 0.35, side: THREE.DoubleSide }));
    cm.frustumCulled = false; cm.userData.noOutline = true;
    group.add(cm);
  }
  if (beams.length) {
    const bM = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.7, 1.4),
      envMat(0x9a958c, { wash: 0.35, cool: 0.45 }), beams.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
    const P = new THREE.Vector3(), S = new THREE.Vector3();
    beams.forEach((b, i) => {
      E.set(0, b.ry, 0); Q.setFromEuler(E);
      P.set(b.x, b.y, b.z);
      S.set(b.w, 1, 1);
      M.compose(P, Q, S);
      bM.setMatrixAt(i, M);
    });
    bM.instanceMatrix.needsUpdate = true;
    bM.frustumCulled = false;
    group.add(bM);
  }
  // ---- 地下道天花照明:每支橫樑下掛一具長條燈(常亮 emissive)----
  // ⑨-5:燈具本身**一格不改** —— 它早就是 emissive、早就是 InstancedMesh、也早就涵蓋
  // 山體隧道 / 地下道 / 明隧道(產生點在 `if (strc && total > 8)` 之內、`covS(s)` 只挑覆蓋段)。
  // 貢獻維持預設 1:節距 12m ≫ `INK_REPEAT_M` ⇒ 推導值就是 1,而洞內最需要的一條輪廓正是它。
  if (ceilLamps.length) {
    const lM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.14, 1.6),
      toonMat(0xece7d2, { emissive: new THREE.Color(0xffe9a0), emissiveIntensity: 0.9 }), ceilLamps.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
    const P = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1);
    ceilLamps.forEach((l, i) => {
      E.set(0, l.ry, 0); Q.setFromEuler(E);
      P.set(l.x, l.y, l.z);
      M.compose(P, Q, S);
      lM.setMatrixAt(i, M);
    });
    lM.instanceMatrix.needsUpdate = true;
    lM.castShadow = false;
    lM.frustumCulled = false;
    lM.userData.noOutline = true;
    group.add(lM);
  }
  // ---- 高架橋橋墩:橋面到地面的立柱(InstancedMesh)+ 墩頂帽梁;2026-07-15 起登記碰撞柱(cols → blockers)----
  if (piers.length) {
    const pM = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.18, 1, 8),
      envMat(0x9aa0a4, { wash: 0.35, cool: 0.45 }), piers.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
    const P = new THREE.Vector3(), S = new THREE.Vector3();
    piers.forEach((p, i) => {
      P.set(p.x, (p.y0 + p.y1) / 2, p.z);
      S.set(p.r, p.y1 - p.y0, p.r);
      M.compose(P, Q, S);
      pM.setMatrixAt(i, M);
    });
    pM.instanceMatrix.needsUpdate = true;
    pM.castShadow = false;
    pM.frustumCulled = false;
    group.add(pM);
    // 墩頂帽梁:橋墩與橋面之間加寬的橫向承接梁,補足支撐結構感
    // 頂面 MUST 低於橋面:與路面共面時會依鏡頭角度蓋過柏油,看成一道橫跨車道的障礙。
    const capH = 0.8, capSink = 0.8;   // 水平帽梁下掛於橋腹;餘裕涵蓋坡段前緣與分段弦差
    const capM = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      envMat(0x8f959a, { wash: 0.35, cool: 0.45 }), piers.length);
    piers.forEach((p, i) => {
      E.set(0, p.ry, 0); Q.setFromEuler(E);
      P.set(p.x, p.y1 - capSink - capH / 2, p.z);
      S.set(p.w, capH, p.r * 2.3);
      M.compose(P, Q, S);
      capM.setMatrixAt(i, M);
    });
    capM.instanceMatrix.needsUpdate = true;
    capM.castShadow = false;
    capM.frustumCulled = false;
    group.add(capM);
  }
  // ---- 洞口透明化(2026-07-23):地形打洞 + collar 貼補 ----
  // 洞口望進去原本是一面土牆 —— 覆蓋轉換處的地形斷面(一格寬、從路面高拉到山高的陡面),
  // 橫在天花以下、兩側牆之間,側牆天花都遮不到,舊版只能靠一片黑色暗面正面擋住(= 一片黑板)。
  // 改制:把「戳進隧道斷面」的地形三角形從**繪製 index** 刪掉(heights[] 不動 ⇒ 碰撞/LOS/
  // heightAt 完全不受影響,純視覺),洞外即直接看見真實內部(路面/牆/天花/照明往深處延伸)。
  // 刪出來的洞緣是規則方格(格線對齊、純幾何無 rnd ⇒ 跨客戶端同一個洞),與斜向 bore 之間的
  // 鋸齒縫由 collar 漏斗裙補死:
  //   外環 = 洞緣頂點本身(與地形共用同一組座標 ⇒ 逐點水密,不可能有縫);
  //   內環 = 把洞緣點「夾制」到隧道斷面矩形上(夾制連續 ⇒ 內環是貼在管身表面的封閉曲線)。
  // ⇒ 任一條視線不是打到地形、就是打到 collar、再不然就是進到管內看見隧道,沒有第四種可能。
  // bore 清單 = 洞口 + 明隧道洞內段(共用同一次 punch:index 壓實不可重入,二次呼叫會把
  // 壓實後殘留在陣列尾端的舊三角形重新掃回 index = 已刪的土牆復活)。collar 迴圈同吃這份。
  const boreRecs = [...portals, ...galBores];
  const punch = boreRecs.length && terrain.punchPortalHoles
    ? terrain.punchPortalHoles(boreRecs.map((p) => ({
      x: p.x, z: p.z, ry: p.ry, hw: p.hw, depth: p.depth,
      floorY: p.y, slope: p.slope, clear: TUN.CLEAR, lift: ROAD_LIFT,
      // 門洞的走廊往洞**外**再延 MOUTH_OUT(明隧道/引道段的 bore 不延:它的「外」是隔壁小段)
      out: p.mouth ? TUN.MOUTH_OUT : 0,
      // 地下道下沉剖面取樣(見 portals.push;無 fp 的 bore 在 punch 端逐位元走舊線性外推)
      fp: p.fp, fpStep: p.fpStep, fpOut: p.fpOut,
    })), covers)
    : { rims: [], touched: [] };
  // 打洞能力是否具備(2026-07-27 金龍隧道「出入口只有一側」修復):punchPortalHoles 的 touched[pi]=true
  // ⟺ 該洞斷面走廊內真有橫塞的土牆三角形(且已被刪穿)。touched[pi]=false 只可能是「該洞本來就沒有
  // 土牆」= 已是開口。舊碼 `!punch.touched[pi]` 把後者也掛上黑色暗面 ⇒ 把本來開著的洞口封成黑牆
  // (單機山體隧道很常見一端覆蓋淺、無崖面可刪 ⇒ 那一側整片黑 = 使用者看到的「只有一側出入口」)。
  // 正解:暗面只是「terrain 完全無打洞能力」時的降級布幕;能打洞時一律不掛(有牆→已打穿+collar 封邊、無牆→本就開)。
  const punched = !!(portals.length && terrain.punchPortalHoles);
  const rims = punch.rims;
  if (rims.some((r) => r.length)) {
    const collar = { pos: [], nrm: [], idx: [], base: 0 };
    const INSET = 0.15;   // 內環往管內壓一點點 ⇒ 與牆/天花是「重疊」而非「對縫」,公差再差也無縫可漏
    for (const [pi, p] of boreRecs.entries()) {
      const rim = rims[pi];
      if (!rim?.length) continue;
      const ca = Math.cos(p.ry), sa = Math.sin(p.ry);
      const xMax = p.hw - INSET;
      // 洞緣點 → 隧道斷面矩形(地板~天花 × ±hw)上的對應點;縱向也夾在管身範圍內
      // (管身只存在於 −depth ≤ z ≤ 0,投到管外 = 貼到不存在的面 = 漏)。
      // 路面參考與 terrain.punchPortalHoles 的 floorAt 同一份:地下道帶 fp(下沉曲線剖面),
      // 其餘 bore 走線性內插(逐位元同舊制)—— 兩端分家 = collar 內環貼錯高度、洞緣漏縫。
      const bFloor = (d) => {
        if (p.fp?.length > 1) {
          const t = Math.max(0, Math.min(p.fp.length - 1, (d + p.fpOut) / p.fpStep));
          const i = Math.min(p.fp.length - 2, Math.floor(t));
          return p.fp[i] + (p.fp[i + 1] - p.fp[i]) * (t - i);
        }
        return p.y + p.slope * d;
      };
      const proj = (x, y, z) => {
        const dx = x - p.x, dz = z - p.z;
        const lx = dx * ca - dz * sa;
        const lz = Math.min(-0.2, Math.max(-p.depth, dx * sa + dz * ca));
        const fy = bFloor(-lz);
        const qx = Math.max(-xMax, Math.min(xMax, lx));
        const qy = Math.max(fy, Math.min(fy + TUN.CLEAR - INSET, y));
        return [p.x + qx * ca + lz * sa, qy, p.z - qx * sa + lz * ca];
      };
      // 視線側參考點:洞口上方 —— 洞是朝「門洞方向 + 上方」開的,法線一律朝這側(打光才對)
      const eye = [p.x, p.y + TUN.CLEAR + 12, p.z];
      // fp bore(地下道):貼著路面的 rim 邊不織裙 —— 引道爬升段被刪三角形的「路面高」邊界
      // 沿著整條走廊,把它投影回洞口斷面就是一片浮在路面上方的混凝土殘片;那條邊界下方是
      // 保留的路塹底 + 路面緞帶,本來就無縫可封(2026-08-05 使用者回報「洞口殘留混凝土」)。
      // 山體隧道無 fp ⇒ 恆 false,collar 逐位元舊制。
      const nearRoad = (x, y, z) => {
        if (!(p.fp?.length > 1)) return false;
        const d = -((x - p.x) * sa + (z - p.z) * ca);
        return y <= bFloor(d) + ROAD_LIFT + 0.6;
      };
      for (const [ax, ay, az, bx, by, bz] of rim) {
        if (nearRoad(ax, ay, az) && nearRoad(bx, by, bz)) continue;
        const [ux, uy, uz] = proj(ax, ay, az);
        const [vx, vy, vz] = proj(bx, by, bz);
        // 兩端都退化(洞緣本來就落在管身斷面內,如路面下方那圈)= 零面積裙,跳過
        if (Math.abs(ax - ux) + Math.abs(ay - uy) + Math.abs(az - uz)
          + Math.abs(bx - vx) + Math.abs(by - vy) + Math.abs(bz - vz) < 0.02) continue;
        let nx = (by - ay) * (vz - az) - (bz - az) * (vy - ay);
        let ny = (bz - az) * (vx - ax) - (bx - ax) * (vz - az);
        let nz = (bx - ax) * (vy - ay) - (by - ay) * (vx - ax);
        const nl = Math.hypot(nx, ny, nz);
        if (nl < 1e-6) continue;
        nx /= nl; ny /= nl; nz /= nl;
        const cxm = (ax + bx + ux + vx) / 4, cym = (ay + by + uy + vy) / 4, czm = (az + bz + uz + vz) / 4;
        if (nx * (eye[0] - cxm) + ny * (eye[1] - cym) + nz * (eye[2] - czm) < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const k = collar.base;
        for (const v of [[ax, ay, az], [bx, by, bz], [vx, vy, vz], [ux, uy, uz]]) {
          collar.pos.push(v[0], v[1], v[2]); collar.nrm.push(nx, ny, nz);
        }
        collar.idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
        collar.base += 4;
      }
    }
    if (collar.idx.length) {
      const cgeo = new THREE.BufferGeometry();
      cgeo.setAttribute('position', new THREE.Float32BufferAttribute(collar.pos, 3));
      cgeo.setAttribute('normal', new THREE.Float32BufferAttribute(collar.nrm, 3));
      cgeo.setIndex(collar.idx);
      // 材質沿用門洞混凝土(同一座洞口的額牆/翼牆/collar 是同一構造物)。DoubleSide:collar 恆在
      // 管身**之外**(外環在地形上、內環貼管壁),幾何上不可能橫跨斷面 ⇒ 不會重演「暗面 DoubleSide
      // = 出洞黑牆」那一坑;反過來單面若有一片繞行判錯就是一個看穿的破洞,取水密不取單面。
      // `surf`(⑨-4):與額牆 / 翼牆 / 外露頂板共用同一號 —— 註解上一行講的「同一構造物」
      // 從此在 surfaceId 上也成立(不共用的話 collar 與額牆的接縫會被畫一條線)。
      const cm = new THREE.Mesh(cgeo, envMat(0x9a958c, { wash: 0.4, cool: 0.45, side: THREE.DoubleSide,
        surf: SURF_ID.CONCRETE,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      cm.frustumCulled = false;
      cm.userData.noOutline = true;
      group.add(cm);
    }
  }
  // ---- 隧道門洞:額牆 + 兩翼擋土牆(嵌進山壁,面朝來路)----
  for (const [pi, p] of portals.entries()) {
    const g = new THREE.Group();
    const W = Math.max(6, p.w), H2 = Math.max(6.5, p.h || 6.5);   // 門洞高 ≥ 隧道淨空(最大機甲進得去)
    // `surf`(⑨-4):額牆(立柱 + 頂梁)與兩翼擋土牆 —— 與 collar / 外露頂板同一座構造物。
    // 本專案沒有「坑門冠石」這種零件,額牆頂梁 `lintel` 就是計畫 §⑨ 那一格的實際落點,而它
    // 吃的正是這一份 `wallM` ⇒ 冠石那一列自動成立(貢獻維持推導值 1:門洞高 ≥ 6.5m)。
    const wallM = envMat(0x9a958c, { wash: 0.4, cool: 0.45, surf: SURF_ID.CONCRETE });
    // 門洞是「真的洞」(2026-07-15 隧道有實體內部後改版):額牆 = 兩側立柱 + 頂梁,中央開口
    // (寬 W−1.6、高 H2−1.2)直通隧道路面 —— MUST NOT 退回蓋住路面的黑色實心塞子。
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(W + 3, 3.2, 1.2), wallM);
    lintel.position.y = H2 + 0.4;                        // 底緣 = 開口頂(H2 − 1.2)
    g.add(lintel);
    for (const s of [1, -1]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(2.3, H2 - 1.2, 1.2), wallM);
      pil.position.set(s * (W / 2 + 0.35), (H2 - 1.2) / 2, 0);
      g.add(pil);
    }
    for (const s of [1, -1]) {                             // 翼牆:向來路外八張開的擋土牆
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.0, H2 - 0.8, 6), wallM);
      wing.position.set(s * (W / 2 + 1.8), (H2 - 0.8) / 2 - 0.3, 2.4);
      wing.rotation.y = s * 0.5;
      g.add(wing);
    }
    // 洞口暗面(2026-07-22;2026-07-23 退居備援;2026-07-27 收斂為「無打洞能力」才掛):嵌在開口內側、
    // 只朝外(FrontSide)遮住覆蓋轉換面的拉伸地形布幕。能打洞時土牆已不存在(collar 封邊)或本來就沒有土牆
    // ⇒ 這片黑板多餘,且正是「洞外一片黑 / 某側出入口封死」的元凶,一律不掛。**只有 terrain 完全無
    // punchPortalHoles 能力**(整批降級)才掛回 —— 寧可黑,不可露出土牆(§4 失敗策略 = 降級不例外)。
    if (!punched) {
      // 貢獻 = 具名否決(唯一容許手寫的那一個):這一片是**降級用的黑布幕**不是構造物,
      // 被天空描出一圈輪廓正好把「它是一塊板子」畫出來 —— 那是 `outlineContribution` 存在
      // 的理由。同時它是「最近面覆寫」的活體測試:布幕在前 ⇒ 它後面那一格的線也一起讓開。
      const mouth = new THREE.Mesh(new THREE.PlaneGeometry(W - 1.6, H2 - 1.2),
        envMat(0x0e1013, { wash: 0, cool: 0.1, rim: 0, contrib: INK_CONTRIB_NONE }));
      mouth.position.set(0, (H2 - 1.2) / 2, -1.3);
      g.add(mouth);
    }
    // 洞口警示條紋(黃黑相間,貼在洞頂上緣):標示通行淨空邊界
    // ⑨-5 洞內照明:School B 之下洞內整片落在暗帶是**預期**,處方是「亮的東西自己亮」——
    // 黃格補 `emissive`(反光帶的語意就是亮的那一半),黑格不補。**底色兩個 hex 逐位元不動**:
    // 既有定案是「不亮的凹處要 emissive,**不是換淺一點的顏色**」(自動販賣機取出口那一課),
    // 換底色的症狀是白天整條發白。MUST NOT 順手調高牆的底色或天花燈的 emissiveIntensity。
    // 材質提到迴圈外:舊制逐 stripe 各建一支 ⇒ 每座洞口 8 支、48 座洞口最多 384 支材質,
    // 而 `nextSurfId` 只有 64 個槽(撞號 = 別處少一條線,沒有任何錯誤訊息)。
    // 貢獻走節距軸吃**呼叫端自己算出來的** `stripeW`(每格 0.55~1.6m ⇒ 一絲筆觸):
    // 八格黃黑相間各描一圈黑邊就是把警示帶讀成八個獨立物件。
    const stripeN = 8, stripeSpan = W - 1.6, stripeW = stripeSpan / stripeN;
    const stripeCtr = inkRepeat(stripeW);
    const stripeLit = envMat(0xf2c230, { wash: 0.2, cool: 0.2, contrib: stripeCtr,
      emissive: new THREE.Color(0x6a5210), emissiveIntensity: 0.55 });
    const stripeDark = envMat(0x1a1a1a, { wash: 0.2, cool: 0.2, contrib: stripeCtr });
    for (let si = 0; si < stripeN; si++) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(stripeW * 0.94, 0.5, 0.15),
        si % 2 === 0 ? stripeLit : stripeDark);
      seg.position.set(-stripeSpan / 2 + stripeW * (si + 0.5), H2 - 1.0, 0.76);
      g.add(seg);
    }
    g.traverse((o) => { if (o.isMesh) o.userData.noOutline = true; });
    g.position.set(p.x, p.y - 0.4, p.z);
    g.rotation.y = p.ry;
    group.add(g);
    // 門洞立柱 + 翼牆 + 頂樑 → 精確有向盒:額牆旁邊不能直接走穿、飛行體不能穿頂樑，
    // 只有中央開口可通行。量體逐件吃上方 BoxGeometry 的同一份尺寸/姿態；圓柱近似會在
    // 斜翼牆外製造隱形牆、同時漏掉真正的牆角(A30 兩端同量體)。
    const ca = Math.cos(p.ry), sa = Math.sin(p.ry);
    const toW = (ox, oz) => [p.x + ox * ca + oz * sa, p.z - ox * sa + oz * ca];
    const portalBox = (ox, oz, y, h, hw2, hd2, ry, name) => {
      const [x, z] = toW(ox, oz);
      return { x, z, y, h, hw2, hd2, ry, r: Math.hypot(hw2, hd2), name };
    };
    cols.push(portalBox(0, 0, p.y + H2 - 1.6, 3.2, (W + 3) / 2, 0.6, p.ry, 'tunnel_portal_lintel'));
    for (const s of [1, -1]) {
      cols.push(portalBox(s * (W / 2 + 0.35), 0, p.y - 0.4, H2 - 1.2,
        1.15, 0.6, p.ry, 'tunnel_portal_pillar'));
      cols.push(portalBox(s * (W / 2 + 1.8), 2.4, p.y - 0.7, H2 - 0.8,
        0.5, 3, p.ry + s * 0.5, 'tunnel_portal_wing'));
    }
  }
  // ---- 3D 附屬件:路燈 / 紅綠燈 / 行道樹(全 InstancedMesh)----
  roadPropMeshes(group, [
    { g: cyl(0.09, 0.13, 5.4, 6), y: 2.7, c: 0x50565e },
    { g: cyl(0.05, 0.07, 1.7, 5).rotateZ(Math.PI / 2), y: 5.32, px: 0.75, c: 0x50565e },
    { g: new THREE.BoxGeometry(0.66, 0.2, 0.32), y: 5.28, px: 1.5, c: 0xe8e2cc, e: 0xffe9a0 },
  ], lamps);
  roadPropMeshes(group, [
    { g: cyl(0.07, 0.1, 3.2, 6), y: 1.6, c: 0x493c35 },
    { g: new THREE.BoxGeometry(0.9, 0.08, 0.08), y: 2.95, px: 0.42, c: 0x493c35 },
    { g: new THREE.BoxGeometry(0.42, 0.58, 0.42), y: 2.68, px: 0.82, c: 0xb33b30, e: 0xffa65b },
  ], marketLamps);
  roadPropMeshes(group, [
    { g: cyl(0.1, 0.14, 5.6, 6), y: 2.8, c: 0x3f464e },
    { g: cyl(0.06, 0.09, 3.0, 5).rotateZ(Math.PI / 2), y: 5.45, px: 1.4, c: 0x3f464e },
    { g: new THREE.BoxGeometry(1.1, 0.42, 0.3), y: 5.0, px: 2.4, c: 0x22262c },       // 橫式三燈箱
    { g: new THREE.BoxGeometry(0.22, 0.22, 0.08), y: 5.0, px: 2.06, pz: 0.16, c: 0x551512, e: 0xff3b30 },
    { g: new THREE.BoxGeometry(0.22, 0.22, 0.08), y: 5.0, px: 2.4, pz: 0.16, c: 0x554512, e: 0xffb200 },
    { g: new THREE.BoxGeometry(0.22, 0.22, 0.08), y: 5.0, px: 2.74, pz: 0.16, c: 0x124a22, e: 0x2ee06a },
  ], lights);
  const leafC = (ENV.seasons[season] || ENV.seasons.summer).foliage;   // 行道樹樹冠吃季節色
  roadPropMeshes(group, [
    { g: cyl(0.14, 0.2, 2.8, 5), y: 1.4, c: 0x6b4a2f },
    { g: ico(1.6).scale(1, 0.85, 1), y: 3.7, c: leafC },
    { g: ico(1.0).scale(1, 0.8, 1), y: 4.9, c: leafC },
  ], roadTrees);
  // 橋墩 → 碰撞柱:機體不能穿過橋墩(視覺已存在,補上物理;柱距 24m,通行綽綽有餘)。
  // 柱頂 MUST 封在橋面「底緣」(y1 − 1.2,與 ceilingAt 的 deck 厚度一致)—— 封到橋面上表面的話,
  // 站在橋上的機體 myBot == 柱頂,_collide 的嚴格不等式不會跳過 → 過橋時每 24m 被隱形柱側推。
  for (const p of piers) cols.push({ x: p.x, z: p.z, y: p.y0, r: p.r + 0.25, h: Math.max(1, p.y1 - 1.2 - p.y0) });
  return { built, decks, tunnels: tunnelSegs, cols, portals, signSpots };
}

// ---- 兵線砲塔跨橋墩座(2026-07-24 使用者需求)----
// 砲塔立在兵線兩側 ±TOWER_SIDE_OFF(15m);兵線跨水/跨谷段那裡只有橋,舊版砲塔一律貼地 heightAt
// ⇒ 塔沉在橋面之下(河床/橋下街廓),與走在橋上的兵線分家。改制:與橋重疊的砲塔**蓋在橋面上**,
// 自橋面外緣伸出一塊墩座台(凸出橋寬之外)承載塔身,台下以往外擴張(上窄下寬 + 擴張墩帽)的
// 橋墩落地支撐。
// 唯一縫紀律:塔位走 data.js solveTowerSites(與 sim._spawnStructures 同一支,座標逐點對得上)、
// 橋面走 roadRes.decks(真橋 + 兵線補橋皆已併入)⇒ 客戶端墩座與伺服器塔位不會分家,
// game.js 只查 towerPadY 取高度,MUST NOT 另寫一套「塔在不在橋上」的判定。
// 純視覺 + 客戶端物理(台面進 decks 站立面 / 墩身進 cols 碰撞柱);伺服器無地形高程,權威層不受影響。
// 不消耗共享 rnd(純幾何)⇒ 建物/植被佈局序列不變。
const TOWER_PAD_R = 10.5;    // 墩座台面「徑向」半徑(遊戲公尺,朝橋外法線):> 砲塔基墩外接半徑 ~7 + 走位餘裕
// 墩座台面「沿橋軸」半長(2026-07-28 使用者回報「在橋上砲塔左右側移動時會跌下去」修):砲塔擺在兵線側邊
// TOWER_SIDE_OFF=15m、橋面半寬僅 8m ⇒ 砲塔坐在橋緣外的外伸台上。舊版台面沿橋軸半長 = TOWER_PAD_R(10.5)
// ⇒ 站立面連側向容差僅 ±13.5m,砲塔基座半徑 6.76m,繞到砲塔左右側沿橋軸走約 7m 就掉出台緣(deckY→null →
// surfaceAt 落回河面)。加長沿橋軸半長 ⇒ 砲塔左右各留充裕走位帶。純表現層(站立面 decks + 視覺板);
// 碰撞柱半徑仍 TOWER_BASE_R(不變 ⇒ 伺服器 occ/LOS/平衡不動)。視覺板沿橋軸半寬同取此值(所見=所站)。
const TOWER_PAD_AXIS = 15;
// 墩座台面「朝橋外法線(水側)自砲塔往外伸出」的半長(2026-07-29 使用者回報「繞砲塔水側走位『左右兩座』仍會掉」修):
// 跨河橋兩側砲塔都懸在橋緣外的水上懸臂;舊版台面外緣只到 lat + TOWER_PAD_R(= 砲塔往水側僅 10.5m),碰撞把玩家推到
// 塔心 r≈8.5(myR + max(TOWER_BASE_R, COLLIDER.tower.r 7))⇒ 水側只剩 ~2m 走位帶。繞塔外側走稍寬弧線(orbit r>10.5)
// 即掉出台緣落水/落岸(真機實測 orbit 12/14/16 掉 ~9m;貼碰撞環 r8.5 不掉 ⇒ PR#24 只放大沿橋軸而漏掉這一維)。
// 與 TOWER_PAD_AXIS 同理:純表現層(站立面 decks + 視覺板)獨立放大水側伸展,**MUST NOT** 動 TOWER_BASE_R
//(= 碰撞/伺服器 occ/LOS/平衡不動)。橋內側(朝橋心)由主橋面接手 ⇒ 只需放大朝水側這一維。
const TOWER_PAD_OUT = 16;
const TOWER_PAD_T = 1.4;     // 台面板厚(≥ DECK_UNDER 1.2,與橋面底緣語意一致)
const TOWER_PAD_SINK = 0.02; // 台面繪製下沉量:與橋面路面 quad 錯開,避免共面 z-fighting
const TOWER_PAD_DIRF = 0.6;  // 橋段方向 × 兵線切線的 |cos| 下限:濾掉「剛好經過附近的別條橋」
const TOWER_PAD_LONG_TOL = 1.0;  // 縱向容差(同 makeDeckIndex 的 LONG_TOL):橋頭之外不算重疊
// 塔基座橋墩級障礙(2026-07-27 使用者需求「橋上砲塔基座對玩家與 NPC 也要能支撐與障礙,同等於橋墩與橋面」):
// 墩座面(dy)高度立一根碰撞柱進 cols → blockers(客戶端移動/彈道)+ 伺服器 occ(LOS)⇒ 擋移動 + 擋砲火/視線。
const TOWER_BASE_R = TOWER_PAD_R * 0.62 + 0.25;   // 半徑 = 墩身(與下方橋墩連續一柱);< 台面半徑 ⇒ 台面外圈仍站得上
const TOWER_BASE_H = 8;                            // 墩座面以上阻擋高度:涵蓋所有地面機體(掩體),且 < LOS.TOWER_EYE_M(14)⇒ 塔仍可被遠程擊毀、塔自身射擊不被自家基座擋
/**
 * 橋上砲塔墩座台的**純幾何規劃**(單一縫;不碰 THREE ⇒ 離線稽核可「執行原文」,見 tools/audit_bridge_tower_pad.mjs)。
 *   cps   = 已解出的塔位控制點 [{x,z,nx,nz}](每點沿法線 ±TOWER_SIDE_OFF 生左右兩座砲塔)
 *   decks = 橋面小段(真橋 + 兵線補橋皆已併入);terrain 只用到 heightAt。
 * 回傳 { pads, newDecks, cols, slabs, piers } —— buildTowerBridgePads 據此建 mesh + 併回 decks/cols。
 * 幾何與座標逐點沿用舊版;唯一實質變更 = 台面沿橋軸半長 TOWER_PAD_R → TOWER_PAD_AXIS(見常數註解)。
 */
function planTowerBridgePads(cps, decks, terrain) {
  const pads = [], newDecks = [], cols = [], slabs = [], piers = [];
  for (const cp of cps) {
    const tgx = -cp.nz, tgz = cp.nx;   // 兵線切線(法線轉 90°)
    // 判定錨在**兵線中心點**(= 兵線此處走在橋上),不是逐塔找最近橋:倫敦實測同一塔位的
    // 左右塔會各自吸附到相鄰的平行橋(真橋 + 補橋),橋面高差 5.6m ⇒ 一高一低。錨在中心點後
    // 兩座塔共用同一段橋(同高度、同外法線)= 對稱,且不會被旁邊「剛好平行」的高架橋撈走。
    let brg = null;
    for (const d of decks) {
      let ex = d.x2 - d.x1, ez = d.z2 - d.z1;
      const len = Math.hypot(ex, ez);
      if (len < 0.5) continue;
      ex /= len; ez /= len;
      if (Math.abs(ex * tgx + ez * tgz) < TOWER_PAD_DIRF) continue;   // 不順著兵線 = 不是兵線走的橋
      const tRaw = ((cp.x - d.x1) * ex + (cp.z - d.z1) * ez) / len;
      const over = (tRaw < 0 ? -tRaw : tRaw > 1 ? tRaw - 1 : 0) * len;
      if (over > TOWER_PAD_LONG_TOL) continue;
      const lat = (cp.x - d.x1) * ez - (cp.z - d.z1) * ex;   // 帶號側向距離(右法線 = (ez, −ex))
      if (Math.abs(lat) > d.hw) continue;                    // 兵線中心 MUST 真的落在橋面上
      if (brg && Math.abs(lat) >= Math.abs(brg.lat)) continue;
      const t = Math.max(0, Math.min(1, tRaw));
      brg = { lat, hw: d.hw, ex, ez, y: d.y1 + (d.y2 - d.y1) * t };
    }
    if (!brg) continue;   // 兵線此處不在橋上 ⇒ 兩座塔照舊貼地
    const dy = brg.y;
    for (const s of [-1, 1]) {
      const tx = cp.x + cp.nx * GAME.TOWER_SIDE_OFF * s;
      const tz = cp.z + cp.nz * GAME.TOWER_SIDE_OFF * s;
      let { ex, ez } = brg;
      const hw = brg.hw;
      // 塔的側向距離 = 兵線中心側距 + 側偏量投影到橋法線(兵線法線與橋法線近乎平行,夾角 ≤53°)
      let lat = brg.lat + GAME.TOWER_SIDE_OFF * s * (cp.nx * ez - cp.nz * ex);
      if (Math.abs(lat) > hw + TOWER_PAD_OUT) continue;   // 構不到台面(理論上不會發生,防呆)
      // 塔基地面高過橋面 = 塔站在橋上方的山坡(不是同一層)⇒ 照舊貼地,不蓋墩座
      let gy = terrain.heightAt(tx, tz);
      if (dy < gy - 0.5) continue;
      const R6 = TOWER_PAD_R * 0.6;
      for (const [ox, oz] of [[R6, 0], [-R6, 0], [0, R6], [0, -R6]]) gy = Math.min(gy, terrain.heightAt(tx + ox, tz + oz));
      if (lat < 0) { ex = -ex; ez = -ez; lat = -lat; }   // 翻轉橋軸 ⇒ 右法線恆指向砲塔那側
      const nx = ez, nz = -ex;                            // 外法線
      const fx = tx - nx * lat, fz = tz - nz * lat;       // 橋中心線上的垂足
      const ry = Math.atan2(ex, ez);                      // local +x → 外法線、local +z → 橋軸(同橋墩帽)
      // 台面內緣壓進橋面之下 0.6m(被路面 quad 蓋住)⇒ 與橋面銜接無縫。**MUST NOT** 讓台面往
      // 橋心多伸(舊版 lat − PAD_R):橋面路面 quad 就畫在 deckAt,同高疊上去 = 整條車道 z-fighting。
      const vIn = hw - 0.6, vOut = lat + TOWER_PAD_OUT;     // 外緣 = 凸出橋寬之外的部分(水側走位帶,見 TOWER_PAD_OUT)
      pads.push({ x: tx, z: tz, y: dy });
      // 塔基座橋墩級障礙:所有橋上塔一律補(含未凸出橋面的),y=dy(墩座面)⇒ _collide 的 onDeck 豁免
      // 不跳過(b.y 非 < 站立面−3),站台面的機體被推出塔基;彈道經 _blockerHitT、伺服器 LOS 經 occ 一併擋。
      cols.push({ x: tx, z: tz, y: dy, r: TOWER_BASE_R, h: TOWER_BASE_H });
      if (vOut <= hw - 0.5) continue;                     // 整座塔本來就落在橋面內 ⇒ 不必加台(基座障礙已補)
      // 台面:自橋面外緣伸出的矩形板 —— 徑向 [vIn,vOut]、沿橋軸 ±TOWER_PAD_AXIS(砲塔左右走位帶)。
      // 繪製頂面再沉 TOWER_PAD_SINK(與路面非共面,免 z-fighting);站立面(newDecks)記 dy = 橋面高 ⇒ 無台階。
      // 站立面 hw = TOWER_PAD_AXIS(newDecks 的段向 = 外法線 ⇒ makeDeckIndex 的側向 = 橋軸)= 沿橋軸半長。
      slabs.push({ cx: fx + nx * (vIn + vOut) / 2, cy: dy - TOWER_PAD_SINK - TOWER_PAD_T / 2, cz: fz + nz * (vIn + vOut) / 2,
                   w: vOut - vIn, t: TOWER_PAD_T, d: TOWER_PAD_AXIS * 2, ry });
      newDecks.push({ x1: fx + nx * vIn, z1: fz + nz * vIn, y1: dy,
                      x2: fx + nx * vOut, z2: fz + nz * vOut, y2: dy, hw: TOWER_PAD_AXIS });
      // 墩身:台面底緣 → 地表(埋 0.6);上窄下寬 + 擴張墩帽,重量看得出往外撐開
      const top = dy - TOWER_PAD_SINK - TOWER_PAD_T, base = gy - 0.6;   // top = 台面底緣
      if (top - base < 1.2) continue;                     // 橋面幾乎貼地(引道段)⇒ 台面即基座,不立墩
      const capH = Math.min(2.2, (top - base) * 0.5);
      piers.push({ x: tx, y: top - capH / 2, z: tz, rTop: TOWER_PAD_R * 0.9, rBot: TOWER_PAD_R * 0.45, h: capH });
      const shaftH = top - capH - base;
      if (shaftH > 0.5) piers.push({ x: tx, y: base + shaftH / 2, z: tz, rTop: TOWER_PAD_R * 0.45, rBot: TOWER_PAD_R * 0.62, h: shaftH });
      // 墩身碰撞柱(墩座面「底緣」以下):柱頂 MUST 封在台面底緣(同橋墩紀律)—— 封到台面上表面的話,
      // 站在墩座台上的機體 myBot == 柱頂,_collide 的垂直閘不會跳過 → 被隱形柱側推下橋。
      // (墩座面以上的塔基座障礙由上方 TOWER_BASE 柱負責;兩者半徑同 TOWER_BASE_R = 連續一柱。)
      cols.push({ x: tx, z: tz, y: base, r: TOWER_BASE_R, h: top - base });
    }
  }
  return { pads, newDecks, cols, slabs, piers };
}
function buildTowerBridgePads(group, lanesW, decks, terrain, cols, mapA) {
  if (!lanesW.length) return [];
  const cps = [];   // 塔位控制點展平(每點左右各一座砲塔;solveTowerSites 與 sim 同一支,座標對得上)
  for (const laneSites of solveTowerSites(lanesW, mapA)) for (const site of laneSites) for (const cp of siteCPs(site)) cps.push(cp);
  const { pads, newDecks, cols: padCols, slabs, piers } = planTowerBridgePads(cps, decks, terrain);
  const slabM = envMat(0x8f959a, { wash: 0.35, cool: 0.45 });
  const pierM = envMat(0x9aa0a4, { wash: 0.35, cool: 0.45 });
  for (const sp of slabs) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(sp.w, sp.t, sp.d), slabM);
    slab.position.set(sp.cx, sp.cy, sp.cz);
    slab.rotation.y = sp.ry;
    group.add(slab);
  }
  for (const p of piers) {   // 墩帽(cap,上寬下窄)與墩身(shaft,上窄下寬)同用一支圓柱建法
    const m = new THREE.Mesh(new THREE.CylinderGeometry(p.rTop, p.rBot, p.h, 8), pierM);
    m.position.set(p.x, p.y, p.z);
    m.rotation.y = Math.PI / 8;
    group.add(m);
  }
  cols.push(...padCols);
  decks.push(...newDecks);   // 掃描完才併回(planTowerBridgePads 內 brg 只查原 decks ⇒ 後塔不吸附前塔墩座台)
  return pads;
}

/**
 * 橋面高度查詢:把橋面小段丟進均勻網格,回傳 deckY(x, z) —— 沒有橋面回 null。
 * 多層橋重疊時取最高面(上層橋才是站得住的那一面)。
 */
export function makeDeckIndex(decks) {
  if (!decks?.length) {
    const fn = () => null;
    fn.hasItems = false;
    return fn;
  }
  const CELL = 16;
  const grid = new Map();
  const key = (i, j) => `${i},${j}`;
  decks.forEach((d, n) => {
    const pad = d.hw + 2;
    const i0 = Math.floor((Math.min(d.x1, d.x2) - pad) / CELL), i1 = Math.floor((Math.max(d.x1, d.x2) + pad) / CELL);
    const j0 = Math.floor((Math.min(d.z1, d.z2) - pad) / CELL), j1 = Math.floor((Math.max(d.z1, d.z2) + pad) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = key(i, j);
        let arr = grid.get(k);
        if (!arr) { arr = []; grid.set(k, arr); }
        arr.push(n);
      }
    }
  });
  // margin:**側向**容差(遊戲公尺,垂直於橋段方向)。站立表面查詢帶 margin(讓機體貼近橋緣不掉下
  // 窄橋面 → 上得了橋),天花碰撞查詢用 0(緊貼可見橋面,免橋緣外憑空撞頭)。
  // margin MUST NOT 洩到「縱向」(沿橋段方向):相鄰橋段共用端點會自然接手,只需 LONG_TOL 微容差銜接。
  // 前科(2026-07-18 倫敦案實測):舊版用 hypot(到夾制端點) > hw+margin 判定,margin=3 讓查詢點
  // 縱向溢出到「相鄰較高橋段」的端點 → 斜引道上回報的橋面高度被高估近一整段(~2.5m)→ 上橋台階
  // 超過 DECK_STEP → 爬到一半掉回地面、卡在橋下(=「無法走上去 / 破圖穿越」)。分離側向/縱向即修正。
  const LONG_TOL = 1.0;   // 縱向端點外容差:遠低於橋段長(ROAD_SEG 6m),不會夠到相鄰段端點
  const query = (x, z, margin = 0) => {
    const arr = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!arr) return null;
    let best = null;
    for (const n of arr) {
      const d = decks[n];
      const ex = d.x2 - d.x1, ez = d.z2 - d.z1;
      const len2 = ex * ex + ez * ez || 1, len = Math.sqrt(len2);
      const tRaw = ((x - d.x1) * ex + (z - d.z1) * ez) / len2;
      // 縱向:超出線段兩端的距離只准 LONG_TOL(margin 不放寬縱向 → 斜引道橋面高度不被高估)
      const over = (tRaw < 0 ? -tRaw : tRaw > 1 ? tRaw - 1 : 0) * len;
      if (over > LONG_TOL) continue;
      // 側向:點到橋段直線的垂距(叉積 / 段長),margin 只放寬這一維(貼橋緣不掉下)
      const lat = Math.abs((x - d.x1) * ez - (z - d.z1) * ex) / len;
      if (lat > d.hw + margin) continue;
      const t = tRaw < 0 ? 0 : tRaw > 1 ? 1 : tRaw;
      const y = d.y1 + (d.y2 - d.y1) * t;
      if (best === null || y > best) best = y;
    }
    return best;
  };
  query.hasItems = true;
  return query;
}

// ---- 軍事基地／防禦工事平台塗裝標線 ----
// 純程序生成 Canvas 貼圖(停機坪/警戒斜紋/陣營戰術徽記/物資格位/射角準星)。
// 零外部依賴、全房一致(固定種子)、單張快取、透明底 + 賽璐璐環境材質。
const _platformTexCache = new Map();

function createHazardStripes(ctx, x, y, w, h, angle = Math.PI / 4, stripeW = 16, c1 = '#f1c40f', c2 = '#232528') {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = c2;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = c1;
  const diag = Math.hypot(w, h) * 2;
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(angle);
  for (let sx = -diag; sx < diag; sx += stripeW * 2) {
    ctx.fillRect(sx, -diag, stripeW, diag * 2);
  }
  ctx.restore();
}

function baseMarkingTex(side) {
  const key = `base:${side}`;
  if (_platformTexCache.has(key)) return _platformTexCache.get(key);
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const isSwarm = side === 'SWARM';
  const accent = isSwarm ? '#38ef7d' : '#e74c3c';
  const yellow = '#f1c40f';
  const dark = '#1e2124';
  const white = '#edf2f7';

  // 1. 周邊 45 度黃黑警戒斜紋邊框 (Outer Hazard Stripe Border)
  const bw = 42;
  createHazardStripes(g, 0, 0, S, bw, Math.PI / 4, 20, yellow, dark);
  createHazardStripes(g, 0, S - bw, S, bw, -Math.PI / 4, 20, yellow, dark);
  createHazardStripes(g, 0, bw, bw, S - bw * 2, -Math.PI / 4, 20, yellow, dark);
  createHazardStripes(g, S - bw, bw, bw, S - bw * 2, Math.PI / 4, 20, yellow, dark);

  // 2. 內框實線與角落戰術括弧 [   ]
  g.strokeStyle = yellow;
  g.lineWidth = 6;
  g.strokeRect(bw + 10, bw + 10, S - (bw + 10) * 2, S - (bw + 10) * 2);

  const bracket = (cx, cy, dx, dy, len = 64) => {
    g.strokeStyle = white;
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(cx + dx * len, cy);
    g.lineTo(cx, cy);
    g.lineTo(cx, cy + dy * len);
    g.stroke();
  };
  const off = bw + 22;
  bracket(off, off, 1, 1);
  bracket(S - off, off, -1, 1);
  bracket(off, S - off, 1, -1);
  bracket(S - off, S - off, -1, -1);

  // 3. 中央停機坪／降落起降區 (Helipad / VTOL Landing Zone)
  const cx = S / 2, cy = S / 2;
  const rMain = S * 0.32;
  // 外圈雙環
  g.strokeStyle = white;
  g.lineWidth = 10;
  g.beginPath();
  g.arc(cx, cy, rMain, 0, Math.PI * 2);
  g.stroke();

  g.strokeStyle = yellow;
  g.lineWidth = 4;
  g.setLineDash([24, 16]);
  g.beginPath();
  g.arc(cx, cy, rMain - 20, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);

  // 十字十字準星與刻度 (Cardinal Crosshairs)
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = 4;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 2) {
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * (rMain - 30), cy + Math.sin(a) * (rMain - 30));
    g.lineTo(cx + Math.cos(a) * (rMain + 30), cy + Math.sin(a) * (rMain + 30));
    g.stroke();
  }

  // 大號軍事 "H"
  g.fillStyle = white;
  g.font = 'bold 150px "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('H', cx, cy - 6);

  // 陣營名稱與戰術代號
  g.fillStyle = accent;
  g.font = 'bold 36px "Arial Black", sans-serif';
  g.fillText(isSwarm ? 'SWARM ALLIANCE' : 'STEEL COVENANT', cx, cy - rMain - 32);

  g.fillStyle = yellow;
  g.font = 'bold 24px "Arial Black", sans-serif';
  g.fillText(isSwarm ? 'TACTICAL COMMAND HQ [SECTOR 01]' : 'HEAVY BASTION CITADEL [SECTOR 01]', cx, cy + rMain + 36);

  // 4. 車輛／物資調度區 (Staging & Parking Bays)
  const drawBay = (bx, by, bw, bh, label) => {
    g.strokeStyle = 'rgba(241, 196, 15, 0.85)';
    g.lineWidth = 4;
    g.setLineDash([12, 8]);
    g.strokeRect(bx, by, bw, bh);
    g.setLineDash([]);
    g.fillStyle = white;
    g.font = 'bold 20px "Arial Black", sans-serif';
    g.fillText(label, bx + bw / 2, by + bh / 2);
  };
  drawBay(off + 20, cy - 50, 100, 100, 'BAY 01');
  drawBay(S - off - 120, cy - 50, 100, 100, 'BAY 02');

  // 警示標語 (Danger / Standoff Warnings)
  g.fillStyle = 'rgba(255, 255, 255, 0.85)';
  g.font = 'bold 18px "Arial Black", sans-serif';
  g.fillText('CAUTION: ARMED PERIMETER ・ STANDOFF 15M ・ KEEP CLEAR', cx, S - bw - 18);
  g.fillText('MAX ELEVATION / CLEAR APPROACH ZONE', cx, bw + 28);

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  _platformTexCache.set(key, t);
  return t;
}

function towerMarkingTex(side = 'STEEL') {
  const key = `tower:${side}`;
  if (_platformTexCache.has(key)) return _platformTexCache.get(key);
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const isSwarm = side === 'SWARM';
  const accent = isSwarm ? '#38ef7d' : '#e74c3c';
  const yellow = '#f1c40f';
  const dark = '#1e2124';
  const white = '#edf2f7';

  // 1. 周邊 45 度警戒斜紋
  const bw = 24;
  createHazardStripes(g, 0, 0, S, bw, Math.PI / 4, 14, yellow, dark);
  createHazardStripes(g, 0, S - bw, S, bw, -Math.PI / 4, 14, yellow, dark);
  createHazardStripes(g, 0, bw, bw, S - bw * 2, -Math.PI / 4, 14, yellow, dark);
  createHazardStripes(g, S - bw, bw, bw, S - bw * 2, Math.PI / 4, 20, yellow, dark);

  // 2. 砲位防禦圓形刻度環 (Azimuth / Targeting Compass Ring)
  const cx = S / 2, cy = S / 2;
  const r = S * 0.35;

  g.strokeStyle = white;
  g.lineWidth = 6;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();

  g.strokeStyle = yellow;
  g.lineWidth = 3;
  g.setLineDash([14, 10]);
  g.beginPath();
  g.arc(cx, cy, r - 14, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);

  // 刻度線與角度標記
  g.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  g.lineWidth = 3;
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    const len = (i % 3 === 0) ? 22 : 12;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * (r - len), cy + Math.sin(a) * (r - len));
    g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.stroke();
  }

  // 3. 戰術代號與警示字樣
  g.fillStyle = accent;
  g.font = 'bold 22px "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(isSwarm ? 'SWARM DEFENSE' : 'STEEL BATTERY', cx, cy - r - 14);

  g.fillStyle = yellow;
  g.font = 'bold 16px "Arial Black", sans-serif';
  g.fillText('DANGER: AUTO-FIRE ZONE', cx, cy + r + 14);

  g.fillStyle = white;
  g.font = 'bold 28px "Arial Black", sans-serif';
  g.fillText('T-01', cx - r + 30, cy);
  g.fillText('T-02', cx + r - 30, cy);

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  _platformTexCache.set(key, t);
  return t;
}

// 陸地砲塔基座與標線（與兵線道路同高）
function buildTowerPlatforms(group, lanesW, decks, terrain, cols, mapA, existingPads = []) {
  if (!lanesW.length) return existingPads;
  const cps = [];
  for (const laneSites of solveTowerSites(lanesW, mapA)) for (const site of laneSites) for (const cp of siteCPs(site)) cps.push(cp);
  const deckIdx = decks.length ? makeDeckIndex(decks) : () => null;
  const bridgePadKeys = new Set(existingPads.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`));
  const slabM = envMat(0x8f959a, { wash: 0.35, cool: 0.45 });
  const ROAD_LIFT = 0.45;
  const allPads = [...existingPads];
  const newDecks = [], newCols = [];

  for (const cp of cps) {
    const roadY = deckIdx(cp.x, cp.z) ?? (terrain.heightAt(cp.x, cp.z) + ROAD_LIFT);
    for (const s of [-1, 1]) {
      const tx = cp.x + cp.nx * GAME.TOWER_SIDE_OFF * s;
      const tz = cp.z + cp.nz * GAME.TOWER_SIDE_OFF * s;
      const key = `${tx.toFixed(1)},${tz.toFixed(1)}`;
      const isBridge = bridgePadKeys.has(key);
      const dy = isBridge ? (existingPads.find((p) => Math.hypot(p.x - tx, p.z - tz) < 2)?.y ?? roadY) : roadY;

      if (!isBridge) {
        allPads.push({ x: tx, z: tz, y: dy });
        newCols.push({ x: tx, z: tz, y: dy, r: TOWER_BASE_R, h: TOWER_BASE_H });
        const slab = new THREE.Mesh(new THREE.BoxGeometry(TOWER_PAD_AXIS * 1.8, TOWER_PAD_T, TOWER_PAD_AXIS * 1.8), slabM);
        slab.position.set(tx, dy - TOWER_PAD_SINK - TOWER_PAD_T / 2, tz);
        slab.rotation.y = Math.atan2(cp.nx, cp.nz);
        group.add(slab);
        newDecks.push({
          x1: tx - TOWER_PAD_AXIS * 0.9, z1: tz, y1: dy,
          x2: tx + TOWER_PAD_AXIS * 0.9, z2: tz, y2: dy, hw: TOWER_PAD_AXIS * 0.9,
        });
      }

      // 砲塔平台表面渲染軍事基地標線
      const markGeo = new THREE.PlaneGeometry(TOWER_PAD_AXIS * 1.65, TOWER_PAD_AXIS * 1.65);
      const markMat = envMat(0xffffff, {
        map: towerMarkingTex(cp.side || 'STEEL'),
        transparent: true, alphaTest: 0.05, rim: 0, wash: 0.2, cool: 0.2,
      });
      const markMesh = new THREE.Mesh(markGeo, markMat);
      markMesh.position.set(tx, dy + 0.02, tz);
      markMesh.rotation.x = -Math.PI / 2;
      markMesh.rotation.z = Math.atan2(cp.nx, cp.nz);
      group.add(markMesh);
    }
  }

  cols.push(...newCols);
  decks.push(...newDecks);
  return allPads;
}

// ---- 水域／沼澤主堡承台 ----
// 主堡若落在水域或沼澤，建立與砲塔墩座同語彙的大型平台。台面半徑由治癒光環推導，
// 因而同時涵蓋 HERO_SPAWN_OFF / HERO_SPAWN_SIDE 定義的重生點；站立面併入 decks，
// 主堡本體高度則經 basePads → main.basePadY → game.padY 單一縫取得。
const BASE_PAD_R = Math.max(
  GAME.HERO_HEAL_R,
  Math.hypot(GAME.HERO_SPAWN_OFF, GAME.HERO_SPAWN_SIDE),
) + TOWER_PAD_R;
const BASE_PAD_T = TOWER_PAD_T;
const BASE_PAD_SUPPORT_F = 0.62;

function planBaseWaterPads(basesW, terrain) {
  const pads = [], newDecks = [], cols = [], slabs = [], piers = [];
  for (const base of basesW) {
    if (terrainEnvCode(terrain, base.x, base.z) === 0) continue;

    let top = terrain.waterY == null ? -Infinity : terrain.waterY + WATER.SWAMP_BAND;
    const step = terrain.gridM || WATER.GRID_M;
    const axisSamples = (c, min) => {
      const out = [c - BASE_PAD_R, c + BASE_PAD_R];
      for (let v = min + Math.ceil((c - BASE_PAD_R - min) / step) * step; v < c + BASE_PAD_R; v += step) out.push(v);
      return out;
    };
    // heightAt 是格點三角面；採全域格線節點 + 台面四邊，台下最高點不會落在兩個探針之間。
    const xs = axisSamples(base.x, terrain.minX), zs = axisSamples(base.z, terrain.minZ);
    for (const z of zs) for (const x of xs) top = Math.max(top, terrain.heightAt(x, z));
    top = Math.max(top, terrain.heightAt(base.x, base.z)) + BASE_PAD_T;

    pads.push({ side: base.side, x: base.x, z: base.z, y: top });
    slabs.push({ x: base.x, y: top - BASE_PAD_T / 2, z: base.z, size: BASE_PAD_R * 2 });
    newDecks.push({
      x1: base.x - BASE_PAD_R, z1: base.z, y1: top,
      x2: base.x + BASE_PAD_R, z2: base.z, y2: top, hw: BASE_PAD_R,
    });

    const off = BASE_PAD_R * BASE_PAD_SUPPORT_F;
    for (const ox of [-off, 0, off]) for (const oz of [-off, 0, off]) {
      const x = base.x + ox, z = base.z + oz;
      const floor = terrain.heightAt(x, z) - 0.6;
      const h = top - BASE_PAD_T - floor;
      if (h <= 0.5) continue;
      piers.push({ x, y: floor + h / 2, z, h });
      cols.push({ x, z, y: floor, r: TOWER_BASE_R, h });
    }
  }
  return { pads, newDecks, cols, slabs, piers };
}

function buildBaseWaterPads(group, basesW, terrain, decks, cols) {
  const plan = planBaseWaterPads(basesW, terrain);
  const slabM = envMat(0x8f959a, { wash: 0.35, cool: 0.45 });
  const pierM = envMat(0x9aa0a4, { wash: 0.35, cool: 0.45 });
  const ROAD_LIFT = 0.45;
  const deckIdx = decks.length ? makeDeckIndex(decks) : () => null;

  // 水域主堡板與墩柱
  for (const sp of plan.slabs) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(sp.size, BASE_PAD_T, sp.size), slabM);
    slab.position.set(sp.x, sp.y, sp.z);
    group.add(slab);
  }
  for (const p of plan.piers) {
    const pier = new THREE.Mesh(new THREE.CylinderGeometry(TOWER_BASE_R * 0.72, TOWER_BASE_R, p.h, 8), pierM);
    pier.position.set(p.x, p.y, p.z);
    pier.rotation.y = Math.PI / 8;
    group.add(pier);
  }

  // 陸地主堡基礎平台（與兵線道路同高）
  const allPads = [...plan.pads];
  for (const base of basesW) {
    if (terrainEnvCode(terrain, base.x, base.z) === 0) {
      const roadY = deckIdx(base.x, base.z) ?? (terrain.heightAt(base.x, base.z) + ROAD_LIFT);
      allPads.push({ side: base.side, x: base.x, z: base.z, y: roadY });
      const slab = new THREE.Mesh(new THREE.BoxGeometry(BASE_PAD_R * 2, BASE_PAD_T, BASE_PAD_R * 2), slabM);
      slab.position.set(base.x, roadY - BASE_PAD_T / 2, base.z);
      group.add(slab);
      plan.newDecks.push({
        x1: base.x - BASE_PAD_R, z1: base.z, y1: roadY,
        x2: base.x + BASE_PAD_R, z2: base.z, y2: roadY, hw: BASE_PAD_R,
      });
    }
  }

  // 主堡平台表面渲染軍事基地常見的標線與圖案
  for (const pad of allPads) {
    const baseMarkGeo = new THREE.PlaneGeometry(BASE_PAD_R * 1.92, BASE_PAD_R * 1.92);
    const baseMarkMat = envMat(0xffffff, {
      map: baseMarkingTex(pad.side),
      transparent: true, alphaTest: 0.05, rim: 0, wash: 0.2, cool: 0.2,
    });
    const baseMarkMesh = new THREE.Mesh(baseMarkGeo, baseMarkMat);
    baseMarkMesh.position.set(pad.x, pad.y + 0.02, pad.z);
    baseMarkMesh.rotation.x = -Math.PI / 2;
    group.add(baseMarkMesh);
  }

  decks.push(...plan.newDecks);
  cols.push(...plan.cols);
  return allPads;
}

/**
 * 地下道查詢:回傳 (x, z) 處的 { floor, ceil, roof, open }(路面高 / 天花**底面** / 頂板
 * **頂面** / 露天引道旗標)—— 不在任何地下道上回 null。game.js/main.js 以「curY < ceil」
 * 判定人在洞內(站路面),否則走地表;天花另供頭部碰撞。
 * `roof`(2026-08-03 使用者定案「明隧道天花板…跟橋面一樣需要遵守物理碰撞法則,不可穿越或
 * 穿透攻擊」)= `tunRoofTop(ceil)`,語意完全對應橋的 `deckY`:板體 = [ceil, roof]。
 *   ・站立面(main.js surfaceAt):在天花之上時,頂板頂面是**可站立結構面** —— 深埋段的
 *     地表本來就高過頂板(取 max 後恆是地形,逐位元不變),明隧道那一段的頂板卻是**露在
 *     地形之外**的結構物 ⇒ 舊制走 heightAt = 踩空掉進洞裡(使用者回報)。
 *   ・彈道(game.js _slabHitT):板體區間與橋面同語意,上下都擋。
 * open:true(地下道引道路塹)時天花/頂板/彈道/slab/lev 消費端 MUST 跳過(露天段頭上是天空)。
 */
export function makeTunnelIndex(tunnels) {
  if (!tunnels?.length) {
    const fn = () => null;
    fn.hasItems = false;
    return fn;
  }
  const CELL = 16;
  const grid = new Map();
  const key = (i, j) => `${i},${j}`;
  tunnels.forEach((d, n) => {
    const pad = d.hw + 2;
    const i0 = Math.floor((Math.min(d.x1, d.x2) - pad) / CELL), i1 = Math.floor((Math.max(d.x1, d.x2) + pad) / CELL);
    const j0 = Math.floor((Math.min(d.z1, d.z2) - pad) / CELL), j1 = Math.floor((Math.max(d.z1, d.z2) + pad) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = key(i, j); let arr = grid.get(k);
      if (!arr) { arr = []; grid.set(k, arr); }
      arr.push(n);
    }
  });
  const q = (x, z) => {
    const arr = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!arr) return null;
    let best = null;
    for (const n of arr) {
      const d = tunnels[n];
      const ex = d.x2 - d.x1, ez = d.z2 - d.z1;
      const len2 = ex * ex + ez * ez || 1;
      const tRaw = ((x - d.x1) * ex + (z - d.z1) * ez) / len2;
      const t = Math.max(0, Math.min(1, tRaw));
      // 縱向外溢夾制(2026-07-22):端帽只留 0.75m 容差 —— 舊版 t 夾制 = stadium 端帽,
      // 洞口外 hw 公尺的露天地帶命中隧道(surfaceAt 把斜坡上的單位吸到隧道地板 = 穿地;
      // ceilingAt 幽靈天花在露天處擋彈道/壓飛行)。相鄰小段首尾相接,段間接縫由鄰段覆蓋,
      // 只有鏈真端點(= 洞口立面)失去端帽,正是要的行為。
      if (Math.abs(tRaw - t) * Math.sqrt(len2) > 0.75) continue;
      if (Math.hypot(x - (d.x1 + ex * t), z - (d.z1 + ez * t)) > d.hw) continue;
      const floor = d.fy1 + (d.fy2 - d.fy1) * t;
      // open = 地下道引道露天路塹(2026-07-29):只服務 surfaceAt 站立捕捉與移動側壁閘;
      // 天花/頂板/彈道/slab/lev 消費端 MUST 以 !open 跳過(露天段頭上是天空,不是隧道)。
      if (best === null || floor < best.floor) {
        const ceil = d.cy1 + (d.cy2 - d.cy1) * t;
        best = { floor, ceil, roof: tunRoofTop(ceil), open: !!d.open };   // 頂板厚度走單一縫,MUST NOT 手寫
      }
    }
    return best;
  };
  q.hasItems = true;
  // 幾何側壁(2026-07-29 破口封堵):步進 (x0,z0)→(x1,z1) 是否「由內跨出」某段地下道的
  // ±hw 牆線、且擋土牆頂(by)高出腳下逾可跨步高。高度場網格(格距 ~8.2m)把垂直路塹
  // 雙線性攤成每步 ≤0.6m 的緩坡 ⇒ 靠 surfaceAt 單步高差判側壁在洞口內側永不觸發,
  // 幾何判定不吃地形取樣、與網格解析度無關。只擋**跨出**:跨入(從地表跳/落進路塹)照舊
  // 放行 —— 牆頂與外側地表齊平(+KERB),物理上外進易、內出難。縱向超出段端 ±0.5m 不擋
  //(鏈真端點 = 道路頭尾兩端,那裡才是出入口;引道淺端 by−y ≤ WALL_STEP 也自然放行)。
  // 山體隧道段無 by(undefined)⇒ 整條 wallCross 對它恆 false,行為逐位元不變。
  const WALL_STEP = 2.6;   // 可跨步高:與 game.js _updatePlayer 側壁閘同一門檻
  q.wallCross = (x0, z0, x1, z1, y) => {
    const seen = new Set();
    for (const [px, pz] of [[x0, z0], [x1, z1]]) {
      const arr = grid.get(key(Math.floor(px / CELL), Math.floor(pz / CELL)));
      if (!arr) continue;
      for (const n of arr) {
        if (seen.has(n)) continue;
        seen.add(n);
        const d = tunnels[n];
        if (d.by1 == null) continue;                       // 山體隧道:無幾何側壁
        const ex = d.x2 - d.x1, ez = d.z2 - d.z1;
        const len = Math.hypot(ex, ez) || 1;
        const ux = ex / len, uz = ez / len;
        const w0 = Math.abs((x0 - d.x1) * uz - (z0 - d.z1) * ux);   // 側向垂距
        const w1 = Math.abs((x1 - d.x1) * uz - (z1 - d.z1) * ux);
        if (w0 > d.hw || w1 <= d.hw) continue;             // 只攔「內 → 外」跨線
        const f = (d.hw - w0) / (w1 - w0 || 1);            // 跨線點(沿步進線性內插)
        const s = ((x0 + (x1 - x0) * f) - d.x1) * ux + ((z0 + (z1 - z0) * f) - d.z1) * uz;
        if (s < -0.5 || s > len + 0.5) continue;           // 跨線點不在此段縱向範圍
        const t = Math.max(0, Math.min(1, s / len));
        const by = d.by1 + (d.by2 - d.by1) * t;
        if (y + WALL_STEP < by) return true;               // 牆頂高出腳下逾可跨步高 = 撞牆
      }
    }
    return false;
  };
  return q;
}

/**
 * 大型障礙物「頂面」站立索引(2026-07-22):建物(bld,含裙樓/地標)與神木/巨岩(std)頂部
 * 可站立 —— 與橋面同一套 mount 語意(main.js surfaceAt 的 curY >= top − DECK_STEP 台階測試)。
 * 查詢 (x, z, margin) → footprint 含此點的最高頂(b.y + b.h),無則 null;margin 只放寬水平
 * 邊緣(貼頂緣不掉落),建物走 hw2/hd2/ry 有向盒、其餘走 r 圓柱 —— 與 _collide 同一份幾何。
 * 橋墩/門洞柱/封路障礙不登記(無 bld/std 旗標):橋墩頂緊貼橋底緣(縫 1.2m 塞不下機體)、
 * 封路障礙頂距地僅 ~2m(落在 mount 台階內,會變成「走過去自動跨上」= 封路失效)。
 * 碉堡淨空 clearAround 會 in-place splice blockers —— MUST 經 terrain.rebuildBlockerTops 重建。
 */
export function makeBlockerTopIndex(blockers, platforms = []) {
  const CELL = 16;
  const grid = new Map();
  const key = (i, j) => `${i},${j}`;
  for (const b of blockers || []) {
    if (!b.bld && !b.std) continue;
    const r = b.hw2 != null ? Math.hypot(b.hw2, b.hd2) : b.r;
    const i0 = Math.floor((b.x - r - 1) / CELL), i1 = Math.floor((b.x + r + 1) / CELL);
    const j0 = Math.floor((b.z - r - 1) / CELL), j1 = Math.floor((b.z + r + 1) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = key(i, j);
        let arr = grid.get(k);
        if (!arr) { arr = []; grid.set(k, arr); }
        arr.push(b);
      }
    }
  }
  // 屋頂平台保留精確 outer/holes；只註冊 surface 查詢索引，不進 A30 blocker 碰撞。
  for (const p of platforms || []) {
    if (!p?.platform || !Array.isArray(p.outer) || p.outer.length < 3) continue;
    const xs = p.outer.map((q) => q[0]), zs = p.outer.map((q) => q[1]);
    const i0 = Math.floor((Math.min(...xs) - 1) / CELL), i1 = Math.floor((Math.max(...xs) + 1) / CELL);
    const j0 = Math.floor((Math.min(...zs) - 1) / CELL), j1 = Math.floor((Math.max(...zs) + 1) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = key(i, j);
      let arr = grid.get(k);
      if (!arr) { arr = []; grid.set(k, arr); }
      arr.push(p);
    }
  }
  if (!grid.size) return () => null;
  return (x, z, margin = 0) => {
    const arr = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!arr) return null;
    let best = null;
    for (const b of arr) {
      if (b.platform) {
        if (!pointInProjectedArea(x, z, b)) continue;
        const top = Number(b.y);
        if (!Number.isFinite(top)) continue;
        if (best === null || top > best) best = top;
        continue;
      }
      if (b.hw2 != null) {
        const cs = Math.cos(b.ry), sn = Math.sin(b.ry);
        const rx = x - b.x, rz = z - b.z;
        const lx = rx * cs + rz * sn, lz = -rx * sn + rz * cs;   // world→local(繞 −ry,與 _collide 同式)
        if (Math.abs(lx) > b.hw2 + margin || Math.abs(lz) > b.hd2 + margin) continue;
      } else if (Math.hypot(x - b.x, z - b.z) > b.r + margin) continue;
      const top = b.y + b.h;
      if (best === null || top > best) best = top;
    }
    return best;
  };
}

// ---- 鐵路 / 捷運(圖資 way):道碴 + 雙軌 + 行駛中的低多邊形列車 ----
// 高度一致性(2026-07-18):OSM 常把一條連續鐵軌切成「地面 way + `bridge` way」,舊版對整條
// way 套固定 lift(高架 8m / 地面 0.35m)→ 接點瞬間垂直跳 8m,鐵軌看起來斷掉。改為**逐頂點
// lift**:高架段只在「未接續另一段高架」的端點爬升緩坡(RAMP 內插回地面),接續高架處保持全高
// → 地面↔高架平順銜接;橋墩隨爬升自動縮短(過矮者略過)。與道路 BRIDGE_RISE 端點緩坡同理。
const RAIL_ELEV = 8, RAIL_GROUND = 0.35, RAIL_RAMP = 55;
function buildRails(group, rails, terrain, center, dynamics, crossings) {
  // Pass A:圖資 → 世界折線片段(超界即切段),記高架旗標 + 端點地面高
  const raw = [];
  for (const way of rails) {
    if (way.tags.tunnel) continue;   // 隧道段不可見(捷運地下段)
    const elevated = !!way.tags.bridge || way.tags.railway === 'monorail';
    let cur = [];
    for (const gpt of way.geometry) {
      const [x, z] = llToWorld(gpt.lat, gpt.lon, center);
      if (x < terrain.minX + 5 || x > terrain.maxX - 5 || z < terrain.minZ + 5 || z > terrain.maxZ - 5) {
        if (cur.length >= 2) raw.push({ g: cur, elevated, tags: way.tags });
        cur = [];
        continue;
      }
      cur.push({ x, z, gy: terrain.heightAt(x, z) });
    }
    if (cur.length >= 2) raw.push({ g: cur, elevated, tags: way.tags });
    if (raw.length >= 30) break;
  }
  if (!raw.length) return 0;

  // 高架端點連續性:共用端點(相同 OSM 節點 → 相同世界座標)且兩側都高架 = 連續高架,不爬坡
  const ekey = (p) => `${Math.round(p.x * 2)},${Math.round(p.z * 2)}`;   // 0.5m 量化
  const elevCount = new Map();
  for (const r of raw) {
    if (!r.elevated) continue;
    for (const p of [r.g[0], r.g[r.g.length - 1]]) elevCount.set(ekey(p), (elevCount.get(ekey(p)) || 0) + 1);
  }

  // Pass B:逐頂點 lift(高架端點爬升緩坡 → 平順接地面)
  const lines = [];
  for (const r of raw) {
    const g = r.g, nP = g.length;
    const cum = [0];
    for (let i = 1; i < nP; i++) cum.push(cum[i - 1] + Math.hypot(g[i].x - g[i - 1].x, g[i].z - g[i - 1].z));
    const total = cum[nP - 1] || 1;
    let liftAt;
    if (r.elevated) {
      const startJoined = (elevCount.get(ekey(g[0])) || 0) >= 2;         // 起點接續另一段高架
      const endJoined = (elevCount.get(ekey(g[nP - 1])) || 0) >= 2;      // 終點接續另一段高架
      liftAt = (s) => {
        const upIn = startJoined ? 1 : s / RAIL_RAMP;
        const upOut = endJoined ? 1 : (total - s) / RAIL_RAMP;
        const ease = Math.max(0, Math.min(1, upIn, upOut));
        return RAIL_GROUND + (RAIL_ELEV - RAIL_GROUND) * ease;
      };
    } else {
      liftAt = () => RAIL_GROUND;
    }
    const pts = g.map((p, i) => new THREE.Vector3(p.x, p.gy + liftAt(cum[i]), p.z));
    lines.push({ pts, tags: r.tags, elevated: r.elevated });
  }
  if (!lines.length) return 0;

  // 軌道:每線段 1 個道碴床 + 2 條鋼軌(InstancedMesh,整批 3 個 draw call)
  let segs = [];
  for (const l of lines) {
    for (let i = 1; i < l.pts.length && segs.length < 900; i++) segs.push([l.pts[i - 1], l.pts[i], l]);
  }
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const bedM = new THREE.InstancedMesh(unit, toonMat(0x5a5348), segs.length);
  const railM = new THREE.InstancedMesh(unit, toonMat(0x3a3f45), segs.length * 2);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), side = new THREE.Vector3();
  segs.forEach(([a, b], i) => {
    dir.subVectors(b, a);
    const len = dir.length();
    dir.normalize();
    Q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    side.crossVectors(dir, up).normalize();
    P.addVectors(a, b).multiplyScalar(0.5);
    S.set(3.4, 0.5, len + 0.4);
    M.compose(P, Q, S);
    bedM.setMatrixAt(i, M);
    for (const s of [-1, 1]) {
      const rp = P.clone().addScaledVector(side, s * 0.8);
      rp.y += 0.32;
      S.set(0.2, 0.24, len + 0.4);
      M.compose(rp, Q, S);
      railM.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), M);
    }
  });
  bedM.instanceMatrix.needsUpdate = railM.instanceMatrix.needsUpdate = true;
  bedM.frustumCulled = railM.frustumCulled = false;
  group.add(bedM, railM);

  // 高架橋墩(捷運/橋段):爬升緩坡段橋墩自動變矮,過矮者(< 2.5m)略過不留地面殘樁
  const pierPts = segs.filter(([, , l]) => l.elevated).map(([a]) => a)
    .filter((a) => a.y - terrain.heightAt(a.x, a.z) > 2.5).slice(0, 200);
  if (pierPts.length) {
    const pierM = new THREE.InstancedMesh(unit, toonMat(0x8f9296), pierPts.length);
    pierPts.forEach((a, i) => {
      const gy = terrain.heightAt(a.x, a.z);
      P.set(a.x, (gy + a.y) / 2, a.z);
      S.set(1.6, a.y - gy, 1.6);
      M.compose(P, new THREE.Quaternion(), S);
      pierM.setMatrixAt(i, M);
    });
    pierM.instanceMatrix.needsUpdate = true;
    pierM.frustumCulled = false;
    group.add(pierM);
  }

  // 平交道(圖資 railway=level_crossing 節點):地面鐵軌與道路平面交會處的柵欄警示建模
  if (crossings?.length) buildLevelCrossings(group, crossings, lines, terrain, center);

  // 列車:最長兩條路線各跑一列(捷運=銀藍、鐵路=橘白),往返行駛
  const byLen = lines.map((l) => {
    let d = 0;
    for (let i = 1; i < l.pts.length; i++) d += l.pts[i].distanceTo(l.pts[i - 1]);
    return { ...l, total: d };
  }).filter((l) => l.total > 300).sort((a, b) => b.total - a.total);
  for (const line of byLen.slice(0, 2)) {
    const metro = /subway|light_rail|monorail|tram/.test(line.tags.railway);
    const train = makeTrain(metro);
    group.add(train);
    dynamics.push(trainDriver(train, line, metro ? 22 : 17));
  }
  return lines.length;
}

// ---- 載具描述子 → THREE.Group(`vehicles.js` 型錄的**唯一**建構出口)----
// 型錄是純資料(零 THREE),把它變成網格的動作只准有這一份 —— 兩份的症狀是「同一款車
// 在車禍現場有輪子、在鐵軌上沒有」,而每一條既有斷言照樣全綠。
// **零 `rnd()` 消耗**:形狀是 kind + opts 的純函式,同座標同結果(§2.3)。
function vehGroup(kind, opts = {}) {
  const g = new THREE.Group();
  const fit = opts.fit || { L: 4.4, W: 1.9, H: 1.55 };
  const paintSeed = Number.isInteger(opts.paint) ? opts.paint : 0;
  const atSeed = Math.round((opts.at?.[0] || 0) * 10) + Math.round((opts.at?.[2] || 0) * 10);
  const cls = kind === 'railcar' ? ((opts.fit?.L || 0) > 10 ? 'bus' : 'cargo') : 'passenger';
  const model = generatedApprovedVehicleModelAt((paintSeed ^ atSeed ^ Math.round(fit.L * 100)) | 0, cls);
  const mesh = makeRuntimePartModel(model, { environment: true });
  mesh.rotation.y = model.sceneBasis.rotationY;
  const basis = new THREE.Group();
  basis.add(mesh);
  basis.scale.set(fit.L / model.dimensions.L, fit.H / model.dimensions.H, fit.W / model.dimensions.W);
  basis.rotation.y = opts.ry || 0;
  basis.position.fromArray(opts.at || [0, 0, 0]);
  basis.userData.runtimePart = { key: model.key, version: model.version, family: 'vehicle' };
  g.add(basis);
  return g;
}

/** 低多邊形列車(車頭 + 2 節車廂)。車廂形狀走 `vehicles.js railcar` 的唯一縫 */
function makeTrain(metro) {
  const g = new THREE.Group();
  const body = metro ? 0xdfe5ea : 0xe8873c;
  const stripe = metro ? 0x2a6fa8 : 0xf4f0e6;
  // 舊制的節距 14.4m 與車廂 13.4m 是同一件事的兩個手寫數:節距 = 車長 + 車鉤間隙。
  // 型錄給車長,間隙留在這裡(它是「這一列怎麼編組」不是「一節車廂長什麼樣」)。
  const carL = 13.4, gap = 1.0;
  for (let c = 0; c < 3; c++) {
    // `railcar` 的鼻頭在 +x,而這一支的列車沿 **+z** 行駛(`trainDriver` 走 lookAt)
    // ⇒ 整節車廂繞 y 轉 −90°,由核准零件組的 `ry` 剛體處理(A27:MUST NOT 逐零件轉)
    const car = vehGroup('railcar', {
      fit: { L: carL, W: 3.0, H: 4.3 }, paint: body, cabC: stripe,
      ry: -Math.PI / 2, at: [0, 0, c * (carL + gap)],
    });
    if (c === 0) {   // 車頭斜鼻(編組的事,不是車廂的事)
      const nose = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.6, 2.2), toonMat(body));
      nose.position.set(0, 2.0, -7.6);
      nose.rotation.x = 0.35;
      car.add(nose);
    }
    g.add(car);
  }
  return g;
}

/** 列車駕駛:沿折線等速前進,端點折返(回傳 dt 更新器) */
function trainDriver(train, line, speed) {
  const cum = [0];
  for (let i = 1; i < line.pts.length; i++) cum.push(cum[i - 1] + line.pts[i].distanceTo(line.pts[i - 1]));
  let s = Math.random() * line.total, dirn = 1;
  const at = (d) => {
    const dd = Math.max(0, Math.min(line.total, d));
    let i = 1;
    while (cum[i] < dd && i < cum.length - 1) i++;
    const f = (dd - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return new THREE.Vector3().lerpVectors(line.pts[i - 1], line.pts[i], f);
  };
  return (dt) => {
    s += speed * dirn * dt;
    if (s > line.total || s < 0) { dirn *= -1; s = Math.max(0, Math.min(line.total, s)); }
    const p = at(s);
    const ahead = at(s + dirn * 8);
    train.position.copy(p);
    if (ahead.distanceToSquared(p) > 0.5) train.lookAt(ahead);
  };
}

// ---- 平交道(圖資 railway=level_crossing 節點):鐵路與道路平面交會處的柵欄警示 ----
// 只在「地面鐵軌」附近設(高架/隧道段不可能有平交道);方位取最近地面軌切線,道路 ≈ 垂直於軌。
function buildLevelCrossings(group, crossings, lines, terrain, center) {
  const segs = [];
  for (const l of lines) {
    if (l.elevated) continue;
    for (let i = 1; i < l.pts.length; i++) segs.push([l.pts[i - 1], l.pts[i]]);
  }
  if (!segs.length) return 0;
  let built = 0;
  for (const c of crossings) {
    if (built >= 8) break;
    const [x, z] = llToWorld(c.lat, c.lng, center);
    if (x < terrain.minX + 12 || x > terrain.maxX - 12 || z < terrain.minZ + 12 || z > terrain.maxZ - 12) continue;
    // 最近地面鐵軌段 → 軌道切線方向
    let bestD = Infinity, bdx = 0, bdz = 0, bx = 0, bz = 0;
    for (const [a, b] of segs) {
      const ex = b.x - a.x, ez = b.z - a.z, len2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / len2));
      const px = a.x + ex * t, pz = a.z + ez * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < bestD) { bestD = d; bdx = ex; bdz = ez; bx = px; bz = pz; }
    }
    if (bestD > 30) continue;   // 附近無地面鐵軌(可能落在高架/隧道段)→ 略過
    const rl = Math.hypot(bdx, bdz) || 1;
    group.add(makeLevelCrossing(bx, terrain.heightAt(bx, bz), bz, bdx / rl, bdz / rl));
    built++;
  }
  return built;
}

/** 平交道 3D 建模:兩支警示柱(交叉警示牌 + 紅燈箱)+ 抬起狀態的紅白遮斷器(平交道開放,不擋兵線)*/
function makeLevelCrossing(x, gy, z, rdx, rdz) {
  const g = new THREE.Group();
  g.position.set(x, gy, z);
  g.rotation.y = Math.atan2(-rdz, rdx);   // 本地 +X ← 鐵軌方向;道路 ≈ 本地 Z
  const ROADW = 9, TRK = 5.5, red = 0xd23a2e, white = 0xf2f2f2, dark = 0x2b2f33;
  const post = (sx, sz, face, armDir) => {
    const a = new THREE.Group();
    a.position.set(sx, 0, sz);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 4.2, 6), toonMat(dark));
    pole.position.y = 2.1; a.add(pole);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.7), toonMat(0x55595e));
    base.position.y = 0.25; a.add(base);
    // 紅燈箱(面向道路)
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.28), toonMat(dark));
    box.position.set(0, 3.0, face * 0.22); a.add(box);
    for (const lx of [-0.45, 0.45]) {
      const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.2, 12),
        toonMat(0x7a1c17, { emissive: new THREE.Color(0x3a0d0a), emissiveIntensity: 0.4 }));
      lamp.position.set(lx, 3.0, face * 0.37);
      lamp.rotation.y = face > 0 ? 0 : Math.PI;
      a.add(lamp);
    }
    // 交叉警示牌(St. Andrew's cross,面向道路)
    for (const rot of [Math.PI / 4, -Math.PI / 4]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.42, 0.1), toonMat(white));
      bar.position.set(0, 3.75, face * 0.32); bar.rotation.z = rot; a.add(bar);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.14, 0.12), toonMat(red));
      edge.position.set(0, 3.75, face * 0.34); edge.rotation.z = rot; a.add(edge);
    }
    // 遮斷器:抬起狀態(平交道開放,不擋兵線),紅白條紋臂
    const boom = new THREE.Group();
    boom.position.set(0, 2.4, 0);
    boom.rotation.z = armDir * 1.28;   // ~73° 抬起
    const ARM = ROADW * 0.62, seg = 6;
    for (let i = 0; i < seg; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(ARM / seg * 0.96, 0.24, 0.18), toonMat(i % 2 ? white : red));
      s.position.x = armDir * (ARM / seg) * (i + 0.5);
      boom.add(s);
    }
    a.add(boom);
    return a;
  };
  g.add(post(ROADW / 2 + 0.4, TRK, 1, -1));     // +Z 進場側:右肩 +X,臂朝 -X 跨路
  g.add(post(-ROADW / 2 - 0.4, -TRK, -1, 1));   // -Z 進場側:右肩 -X,臂朝 +X 跨路
  return g;
}

// ---- 瀑布(圖資節點):水簾 + 底部水潭 + 湧動泡沫 ----
function buildWaterfalls(group, falls, terrain, center, dynamics) {
  let built = 0;
  for (const f of falls.slice(0, 6)) {
    const [x, z] = llToWorld(f.lat, f.lng, center);
    if (x < terrain.minX + 20 || x > terrain.maxX - 20 || z < terrain.minZ + 20 || z > terrain.maxZ - 20) continue;
    // 找落差方向:採樣 8 方位高程,水從最高側流向最低側
    let hi = { h: -Infinity }, lo = { h: Infinity };
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2;
      const h = terrain.heightAt(x + Math.cos(a) * 18, z + Math.sin(a) * 18);
      if (h > hi.h) hi = { h, a };
      if (h < lo.h) lo = { h, a };
    }
    const drop = Math.max(6, hi.h - lo.h);
    const g = new THREE.Group();
    g.position.set(x, lo.h, z);
    g.rotation.y = -lo.a;
    // 水簾(兩層錯開的半透明白幕)
    const sheets = [];
    for (const [w, off, op] of [[7, 0, 0.85], [5, 0.8, 0.55]]) {
      const sheet = new THREE.Mesh(
        new THREE.PlaneGeometry(w, drop),
        toonPlain({
          color: 0xeaf6fb, transparent: true, opacity: op, side: THREE.DoubleSide,
        }),
      );
      sheet.position.set(0, drop / 2, -off);
      g.add(sheet);
      sheets.push(sheet);
    }
    // 頂緣溢流 + 底部水潭 + 泡沫
    const lip = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.8, 2.4), toonMat(0xd8eef6, { transparent: true, opacity: 0.9 }));
    lip.position.set(0, drop, -0.6);
    g.add(lip);
    const pool = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.5, 0.5, 14),
      toonMat(0x9fd4e8, { transparent: true, opacity: 0.7 }));
    pool.position.y = 0.25;
    g.add(pool);
    const foam = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.2, 1.1, 12),
      toonMat(0xffffff, { transparent: true, opacity: 0.8 }));
    foam.position.y = 0.7;
    g.add(foam);
    group.add(g);
    built++;
    // 動態:水簾上下捲動錯覺(縮放脈動)+ 泡沫呼吸
    let t = Math.random() * 10;
    dynamics.push((dt) => {
      t += dt;
      sheets.forEach((s, i) => {
        s.material.opacity = (i === 0 ? 0.85 : 0.55) + Math.sin(t * (3 + i)) * 0.1;
        s.scale.x = 1 + Math.sin(t * 2.4 + i) * 0.05;
      });
      foam.scale.setScalar(1 + Math.sin(t * 3.2) * 0.12);
    });
  }
  return built;
}

// ---- 邊界障礙環(2026-08-10 使用者定案「邊界加入不可越過的障礙」)----
// 舊制的邊界是一道**隱形**空氣牆(game.js 夾 x/z):走到那裡莫名停住,而邊界帶的樓群/神木/
// 巨岩只是「看起來被圍住」—— 真正擋人的東西看不見、也打不到。改制:沿四緣鋪一圈**連續**的
// 實體環,內緣恰好貼在夾制線上 ⇒ 地面機體恆先撞到看得見的東西,那兩行夾制永遠用不到。
// 六條紀律,每一條壞掉都沒有錯誤訊息:
//  ①**環是權威幾何**:進 `blockers` ⇒ 客戶端 `_collide`/`_sweepBlockers` 與伺服器 `occ`/
//    `_losBlocked` 吃**同一個有向盒**(A30),而演出的盒子與那個盒子逐位元同尺寸
//    (看到多粗 = 撞到多粗 = 打到多粗,原則 4)。
//  ②**「不可越過」是結構保證不是校準**:相鄰段以 `SEG_LAP_F` 互相咬住 ⇒ 環上沒有縫,
//    不必回頭問「最窄的機體有多寬」;四個角落由 X 邊與 Z 邊互相跨過封死(兩組邊都跑滿整個
//    worldW/worldH,刻意不各自讓開)。飛行那一半仍歸 x/z 夾制(見 data.js WORLD_EDGE 檔頭)。
//  ③**零共享 `rnd()` 消耗**(§2.3):段位/高度/選色全由座標與地形推導 —— 選色走
//    `classifyImg`(純影像判、零亂數),MUST NOT 改吃 `classify`(那一支會抽 `rnd()`,
//    當場把後面每一株植被的佈局整條推移)。
//  ④**MUST 排在 `blockers` 陣列最前面**:`main.js` 的 occ 上傳是 `slice(0, LOS.MAX_OCC)`,
//    環擺在尾端的話密集市區會把它整段切掉 ⇒ 客戶端擋得住、伺服器不知道有牆(兩端分家)。
//  ⑤**頂面不可站立**(不掛 `bld`/`std`):環頂是邊界不是平台,掛上去就變成「跳上牆沿著邊界跑」。
//  ⑥`ry` 只取 0 / π/2:對稱盒在這兩個角度上「繞 +ry 還是 −ry」逐位元同判(|lx|/|lz| 只是
//    對調),⇒ 客戶端 `_collide`、`makeBlockerTopIndex`、伺服器 occ 的 ry 反號三者天生同判,
//    A30 那個「差一個負號 = 牆在另一邊」的坑在這裡結構性地不存在。
//
// **2026-08-11 使用者定案:環體改吃型錄**(城牆/連排民房/河堤/海堤/軍工級路障/土石流/懸崖
// 峭壁/山崩地/消波塊/倒塌神木/倒塌摩天樓/倒塌高架橋/停駛的列車/連排大貨車/連排貨輪),
// 「地貌切換或太長的時候,會隨機更換符合地貌與水陸域的牆」。型錄與切分規則全在 `edgewall.js`
// (純資料、零 THREE ⇒ 離線稽核跑得動);本函式只負責三件事:取樣地貌 → 問規劃器 → 建幾何。
// 上面六條紀律**一條都沒有變**,另外多兩條:
//  ⑦**厚度是逐款的真實尺寸**(貨輪 18m、懸崖 12m):碰撞盒的**內面恆貼夾制線**,厚度往圖界
//    方向長 ⇒ ② 的「沿邊沒有縫」與「內緣在夾制線上」逐條照舊,而 `placeBoundary` 的邊界帶
//    改吃 `edgeWallDeepM()` 讓開最深的那一款。
//  ⑧**演出 ⊆ 碰撞盒**:零件表整份收在「段長 × depth × 高」的盒子裡(`wallFit`),而盒子的
//    內面被實體零件蓋滿到機體視線高(`wallFaceCover`)。**縱向尤其** —— 碰撞盒只到頂,視覺
//    若更高,從上方斜射進緩衝空間的彈道會穿過看得見的船樓而伺服器毫無所悉(A30 家族)。
function buildEdgeWall({ group, terrain, blockers }) {
  const inset = edgeWallInsetM(), WH = edgeWallHM();
  const half = WORLD_EDGE.SEG_M / 2 * WORLD_EDGE.SEG_LAP_F;   // 沿邊半長(> 半間距 ⇒ 段段重疊)
  const wy = terrain.waterY;
  // 地貌/水陸域取樣:**零亂數**。水/沼 MUST 走 `terrainEnvCode`，否則 classifyImg 永遠
  // 產不出 wet，沼澤型錄會成為永遠選不到的死資料；乾地才回到純影像分類。
  const probe = (x, z) => {
    const px = Math.min(terrain.maxX, Math.max(terrain.minX, x));
    const pz = Math.min(terrain.maxZ, Math.max(terrain.minZ, z));
    const env = terrainEnvCode(terrain, px, pz);
    if (env === 1) return 'water';
    if (env === 2) return 'wet';
    return classifyImg(terrain.sampleColor?.(px, pz)) || 'green';
  };
  const segs = [];
  // 演出:逐節取零件表 → 套上這一節的位置/朝向 → 整圈**合併成一個** mesh(顏色走頂點色)。
  // 逐件一個 mesh 的話一圈牆就是上千個 draw call(本渲染器是 draw call 瓶頸,見 beacons 紀律④)。
  const batch = newBatch();
  const edges = [
    { ax: 1, x0: terrain.minX, z0: terrain.minZ + inset, len: terrain.worldW, fry: 0, sz: -1 },
    { ax: 1, x0: terrain.minX, z0: terrain.maxZ - inset, len: terrain.worldW, fry: Math.PI, sz: 1 },
    { ax: 0, x0: terrain.minX + inset, z0: terrain.minZ, len: terrain.worldH, fry: Math.PI / 2, sz: -1 },
    { ax: 0, x0: terrain.maxX - inset, z0: terrain.minZ, len: terrain.worldH, fry: -Math.PI / 2, sz: 1 },
  ];
  for (const e of edges) {
    const n = Math.max(1, Math.round(e.len / WORLD_EDGE.SEG_M));
    const step = e.len / n;
    const row = [];
    for (let i = 0; i < n; i++) {
      const d = (i + 0.5) * step;
      // (fx, fz) = 這一節**內面**的中心(恰在夾制線上);盒心等 run 配好款、知道厚度才算得出來
      const fx = e.ax ? e.x0 + d : e.x0;
      const fz = e.ax ? e.z0 : e.z0 + d;
      // 沿段身取樣:底埋到最低點之下、頂面高過最高點 ⇒ 斜坡上不懸空也不被地形吃掉。
      // 同一趟順便量**坡度**(2026-08-11 使用者追加):取樣距 = 段身取樣間距(≈ 半個段長的
      // 一半,大於地形格距 ⇒ 量到的是地形本身的坡而不是網格雜訊);逐相鄰對取最陡的那一段,
      // 再補一對橫向(沿牆厚方向)—— 只量沿邊那一軸的話,一道橫切過來的崖會整段判成平地。
      // 坡度一律量**裸地形 `heightAt`**(§2.1 地形坡度移動的同一條規則)。
      const hs = [];
      for (let k = -2; k <= 2; k++) {
        const t = k / 2 * half;
        hs.push(terrain.heightAt(e.ax ? fx + t : fx, e.ax ? fz : fz + t));
      }
      const lo = Math.min(...hs), hi = Math.max(...hs), sp = half / 2;
      let deg = 0;
      for (let k = 1; k < hs.length; k++) deg = Math.max(deg, Math.abs(slopeDeg(hs[k] - hs[k - 1], sp)));
      const cx = terrain.heightAt(e.ax ? fx : fx + sp, e.ax ? fz + sp : fz);
      const cz = terrain.heightAt(e.ax ? fx : fx - sp, e.ax ? fz - sp : fz);
      deg = Math.max(deg, Math.abs(slopeDeg(cx - cz, sp * 2)));
      const biome = probe(fx, fz);
      row.push({
        x: fx, z: fz, lo, hi, len: step, biome, water: biome === 'water', e,
        tier: wallSlopeTier(deg, SLOPE.EASE_DEG, SLOPE.BLOCK_DEG), deg,
      });
    }
    // 切 run + 配款(唯一縫;純函式、零共享亂數);零件、碰撞柱、演出**同一趟**定案 ——
    // 盒高是逐段實測的(見下),分兩趟就要嘛把零件表存起來、要嘛重算一次,兩條都是第二份真相。
    let prevKind = null, prevVariant = -1;
    for (const r of planWallRuns(row)) {
      const kinds = planWallKinds(r, row, prevKind);
      for (let i = r.i0; i < r.i1; i++) {
        const s = row[i];
        const kind = kinds[i - r.i0];
        const def = WALL_KINDS[kind] || WALL_KINDS.barricade;
        const hd2 = def.depth / 2, kh0 = Math.max(WH, def.h);
        // 盒心 = 內面往圖界方向退半個厚度 ⇒ 內緣恆落在夾制線上(不管這一款多厚)
        const x = e.ax ? s.x : s.x + e.sz * hd2;
        const z = e.ax ? s.z + e.sz * hd2 : s.z;
        const seed = edgeSeed(x, z);
        const variant = wallVariant(kind, seed, kind === prevKind ? prevVariant : -1);
        const parts = wallParts(kind, {
          len: half * 2, depth: def.depth, h: kh0, seed, variant, season: terrain.season || 'summer',
        });
        // **盒高逐段實測**,不是逐款一個值(2026-08-11 城牆加了城門/城樓/砲台之後的必然):
        // 同一款的節有高有矮(素牆 9m / 箭樓 11m / 城樓 14m),拿型錄宣告的最高值當每一節的
        // 盒高,素牆那幾節的頂上就多出一截**撞得到卻看不見**的空氣(A30 家族的反面)。
        // 宣告的 `def.h` 從此只是「這一款最高長到哪」= 授權上界(零件表 MUST 收在它之內)。
        let top = 0;
        for (const p of parts) top = Math.max(top, partBox(p).y1);
        const kh = Math.max(WH, top);
        // 零件的落地基準:段內最高的地形,水域段改取水面(否則海堤/貨輪整艘沉在水面下)
        const ground = wy != null && s.water ? Math.max(s.hi, wy) : s.hi;
        const y = s.lo - 1.5;
        const motion = parts.filter((p) => p.motion);
        segs.push({
          x, z, y, h: ground + kh - y, hw2: half, hd2,
          ry: e.ax ? 0 : Math.PI / 2, fry: e.fry,
          kind, variant, biome: s.biome, water: s.water, tier: r.tier, ground, kh, motion,
        });
        // 碰撞柱:與建物走同一條有向盒路徑(hw2/hd2/ry);刻意不掛 bld/std(見 ⑤)、不掛 cl(不可攀爬)
        blockers.push({ x, z, y, h: ground + kh - y, hw2: half, hd2, ry: e.ax ? 0 : Math.PI / 2, r: Math.hypot(half, hd2) });
        // 邊界障礙物一律移除底座：本體直接由地面／水面長出，不另加通用底座
        emitWallParts(batch, parts.filter((p) => !p.motion), x, ground, z, e.fry, 1);
        prevKind = kind;
        prevVariant = variant;
      }
    }
  }
  flushPartBatch(group, batch, { wash: 0.42, cool: 0.42 });
  return segs;
}

// ---- 型錄零件 → 世界幾何(邊界牆 / 緩衝空間物件 / 視線邊界背景共用)----
// 三者的零件描述子詞彙完全相同(`edgewall.js` 檔頭),故合併/發射也共用這兩支:
// **第二份實作的代價是「某一類物件的 A25 回收漏掉」**,而畫面上完全看不出來(同 beacons
// 的 `mergeGeos` 檔頭)。
const PLINTH_C = 0x7b7367;   // 底座色(埋在地形裡的那一截,看得到的只有貼著坡面的一線)
function wallGeo(spec) {
  const [t, a, b, c] = spec;
  if (t === 'box') return new THREE.BoxGeometry(a, b, c);
  if (t === 'cyl') return new THREE.CylinderGeometry(a, b, c, spec[4] || 6);
  if (t === 'cone') return new THREE.ConeGeometry(a, b, spec[3] || 6);
  return new THREE.IcosahedronGeometry(a, 0);
}
const _wm = new THREE.Matrix4(), _wq = new THREE.Quaternion(), _we = new THREE.Euler();
const _wp = new THREE.Vector3(), _ws = new THREE.Vector3(), _wg = new THREE.Vector3();
/**
 * 把一份零件表套上「這一件的位置/朝向/縮放」後推進批次(顏色隨幾何一起記帳)。
 *
 * `groundY`(選用)= **逐零件落地**(2026-08-12 使用者定案「視線邊界的假山/假海/假森林/
 * 假城市也要在地形上放置好,在斜坡不要懸空」):一段背景 150m、一叢林塊的外圍零件散到 ±11m,
 * 拿**段心**一個高度擺全部零件 ⇒ 坡上那一端整片浮在半空、坡下那一端埋進土裡。給了這個回呼
 * 就逐零件取自己腳下那一點當落地基準。兩條:
 *   ①**水平位置走同一個矩陣**求(MUST NOT 自己寫一份 sin/cos —— A30 那一族的正負號坑:
 *     寫錯的話零件會落在鏡射的位置取高度,而畫面上只表現成「有些還是浮的」);
 *   ②堆疊件(雪冠疊山頂、塔尖疊樓頂、屋頂疊房子)的局部 x/z 與主體相同 ⇒ 取到同一個基準,
 *     相對關係一格未動。障礙環(`buildEdgeWall`)**刻意不傳** —— 它的碰撞盒是以段的落地基準
 *     量出來的,逐零件落地會讓演出掉出盒子(Ⅲ 演出 ⊆ 碰撞盒)。
 */
function emitWallParts(batch, parts, ox, oy, oz, ry, scale, groundY = null) {
  for (const p of parts) {
    const geo = wallGeo(p.g);
    const [px = 0, py = 0, pz = 0] = p.p || [];
    const [rx = 0, pry = 0, rz = 0] = p.r || [];
    // 先套零件自己的位移/旋轉(局部),再整件轉 ry、縮放、平移到世界
    _we.set(rx, pry, rz);
    _wm.compose(_wp.set(px, py, pz), _wq.setFromEuler(_we), _ws.set(1, 1, 1));
    geo.applyMatrix4(_wm);
    _we.set(0, ry, 0);
    let by = oy;
    if (groundY) {   // 先用 y=0 的外層矩陣求這顆零件在世界的水平位置,再取它腳下的高度
      _wm.compose(_wp.set(ox, 0, oz), _wq.setFromEuler(_we), _ws.set(scale, scale, scale));
      _wg.set(px, py, pz).applyMatrix4(_wm);
      by = groundY(_wg.x, _wg.z);
    }
    _wm.compose(_wp.set(ox, by, oz), _wq.setFromEuler(_we), _ws.set(scale, scale, scale));
    geo.applyMatrix4(_wm);
    const target = p.mat === 'glass' ? batch.glass : batch.opaque;
    target.geos.push(geo);
    target.cols.push(p.c);
  }
}
/**
 * 一批零件 → 不透明／玻璃至多各一個 mesh(合併走 beacons 的 `mergeGeos` 唯一縫，含 A25
 * 的暫時幾何回收)。顏色走頂點色，draw call 不隨色票或零件數增加。
 */
function flushPartBatch(group, batch, matOpts) {
  const add = (partBatch, material) => {
    if (!partBatch.geos.length) return;
    const mesh = new THREE.Mesh(mergeGeos(partBatch.geos, partBatch.cols), material);
    mesh.castShadow = false;
    // 環繞全圖:整體包圍球恆與視錐相交,逐幀剔除只是白算(同舊制的環)
    mesh.frustumCulled = false;
    group.add(mesh);
  };
  add(batch.opaque, envMat(0xffffff, { vertexColors: true, ...matOpts }));
  // 玻璃與牆體仍共用同一份零件表，只拆成第二個材質批次；透明面不寫深度，避免窗帶互相遮死。
  add(batch.glass, envMat(0xffffff, {
    vertexColors: true, transparent: true, opacity: 0.58, depthWrite: false,
    side: THREE.DoubleSide, ...matOpts,
  }));
}
const newBatch = () => ({
  opaque: { geos: [], cols: [] },
  glass: { geos: [], cols: [] },
});

/**
 * 邊界設施的剛體動態層。靜態基座仍留在整圈單一批次；只有葉片／浮台按樞軸各合成一顆 mesh。
 * 更新函式併進既有 `dynamics` 桶，風機與海面共用 toon 的風時鐘與天氣係數。
 */
function buildEdgeMotion({ group, segs, dynamics }) {
  const rotors = [], floats = [], machines = [], plumes = [];
  for (const s of segs) {
    if (!s.motion?.length) continue;
    const sets = new Map();
    for (const p of s.motion) {
      const id = p.motion.id;
      if (!sets.has(id)) sets.set(id, []);
      sets.get(id).push(p);
    }
    for (const rows of sets.values()) {
      const mot = rows[0].motion, [px = 0, py = 0, pz = 0] = mot.pivot || [];
      const root = new THREE.Group(), pivot = new THREE.Group();
      root.position.set(s.x, s.ground, s.z);
      root.rotation.y = s.fry;
      pivot.position.set(px, py, pz);
      const geos = [], cols = [];
      for (const p of rows) {
        const geo = wallGeo(p.g);
        const [x = 0, y = 0, z = 0] = p.p || [];
        const [rx = 0, ry = 0, rz = 0] = p.r || [];
        _we.set(rx, ry, rz);
        _wm.compose(_wp.set(x - px, y - py, z - pz), _wq.setFromEuler(_we), _ws.set(1, 1, 1));
        geo.applyMatrix4(_wm);
        geos.push(geo); cols.push(p.c);
      }
      const mesh = new THREE.Mesh(mergeGeos(geos, cols), envMat(0xffffff, {
        vertexColors: true, wash: 0.4, cool: 0.46,
      }));
      mesh.castShadow = false;
      pivot.add(mesh); root.add(pivot); group.add(root);
      if (mot.kind === 'rotor') {
        pivot.rotation.order = 'YXZ';
        pivot.rotation.z = mot.phase;
        rotors.push({ pivot, angle: mot.phase, fry: s.fry, sinFry: Math.sin(s.fry), cosFry: Math.cos(s.fry) });
      } else if (mot.kind === 'float') {
        floats.push({ pivot, baseY: py, phase: mot.phase });
      } else if (mot.kind === 'machine') {
        machines.push({ pivot, phase: mot.phase });
      } else if (mot.kind === 'smoke' || mot.kind === 'dust') {
        plumes.push({ pivot, baseY: py, phase: mot.phase, kind: mot.kind });
      }
    }
  }
  if (!rotors.length && !floats.length && !machines.length && !plumes.length) return 0;
  dynamics.push((dt) => {
    const step = Math.min(0.25, Math.max(0, dt || 0));
    const wind = celWindAmount(), wave = celWaveAmount(), t = celWindTime();
    const [wx, wz] = celWindHeading();
    for (const r of rotors) {
      // 風向在邊界段局部座標的法向投影 (normalFlow) 與切向投影 (crossFlow) (吃預先快取的 sin/cos)
      const normalFlow = wx * r.sinFry + wz * r.cosFry;
      const crossFlow = wx * r.cosFry - wz * r.sinFry;
      // 轉向：迎風正面吹來時順轉 (1)，由背面吹來時逆轉 (-1)；微幅側風依迎風側決定方向
      const flowSign = normalFlow <= -0.05 ? 1 : (normalFlow >= 0.05 ? -1 : (crossFlow >= 0 ? 1 : -1));
      // 轉速：正對迎風時全速，側風時依受風角平滑衰減，維持動態視覺
      const flowRatio = Math.abs(normalFlow);
      const speedFactor = 0.35 + 0.65 * flowRatio;
      r.angle += step * EDGE_MOTION.ROTOR_RAD_S * wind * flowSign * speedFactor;
      // 朝向：隨來風方向微幅動態迎風偏航（安全容差 ±0.08 rad ≈ 4.6°，收在 14m/16m 碰撞盒內）
      const yawTarget = Math.atan2(-crossFlow, Math.max(0.1, -normalFlow)) * 0.12;
      const clampedYaw = Math.max(-0.08, Math.min(0.08, yawTarget));
      r.pivot.rotation.y = clampedYaw;
      r.pivot.rotation.z = r.angle;
    }
    for (const f of floats) {
      const a = t * EDGE_MOTION.FLOAT_FREQ + f.phase;
      const heave = Math.sin(a) * 0.76 + Math.sin(a * 1.87 + f.phase * 0.7) * 0.24;
      f.pivot.position.y = f.baseY + heave * EDGE_MOTION.FLOAT_AMP_M * wave;
      f.pivot.rotation.x = Math.sin(a * 0.83) * EDGE_MOTION.FLOAT_TILT * wave;
      f.pivot.rotation.z = Math.sin(a * 0.67 + 1.3) * EDGE_MOTION.FLOAT_TILT * wave;
    }
    for (const m of machines) {
      m.pivot.rotation.z = Math.sin(t * EDGE_MOTION.MACHINE_FREQ + m.phase) * EDGE_MOTION.MACHINE_SWING;
    }
    for (const p of plumes) {
      const a = t * EDGE_MOTION.PLUME_FREQ + p.phase;
      const lift = (Math.sin(a) * 0.5 + 0.5) * EDGE_MOTION.PLUME_RISE_M;
      const drift = EDGE_MOTION.PLUME_DRIFT_M * wind;
      p.pivot.position.x = Math.sin(a * 0.73) * drift;
      p.pivot.position.y = p.baseY + lift;
      p.pivot.position.z = Math.cos(a * 0.61 + p.phase) * drift * (p.kind === 'dust' ? 1 : 0.55);
    }
  });
  return rotors.length + floats.length + machines.length + plumes.length;
}

// ---- 緩衝空間的 3D 物件(使用者定案:「邊界延伸不可進入的緩衝空間…並加入少許 3D 物件」)----
// 純表現層:不進 blockers / occ / LOS / heightAt(玩家被 x/z 夾制在障礙環之內,永遠碰不到
// 這些東西)。落地高度走 `terrain.bufferHeightAt`(裙自己那份外推高度的**單一縫**)——
// 拿 `heightAt` 會夾回圖界,整排物件會沿著邊界貼在錯誤的高度上。
function buildBufferProps({ group, terrain }) {
  if (!terrain.bufferHeightAt) return 0;
  const probe = (x, z) => classifyImg(terrain.sampleColor?.(
    Math.min(terrain.maxX, Math.max(terrain.minX, x)),
    Math.min(terrain.maxZ, Math.max(terrain.minZ, z)),
  )) || 'bare';
  const wy = terrain.waterY;
  const plan = planBufferProps({
    minX: terrain.minX, maxX: terrain.maxX, minZ: terrain.minZ, maxZ: terrain.maxZ,
    buffer: terrain.bufferM,   // 深度讀地形實際鋪的那一份(迷你地圖縮到 1/3;見 terrain.js ⑧)
    step: EDGE_WALL.PROP_STEP_M * (lowPower ? 1.6 : 1),
    margin: edgeWallInsetM(),   // 讓開障礙環那一圈:布景的零件散得比落點遠,貼著圖界擺會伸進可玩區
    probe: (x, z) => {
      const h = terrain.bufferHeightAt(x, z);
      return wy != null && h < wy + WATER.SHORE ? 'water' : probe(x, z);
    },
  });
  const batch = newBatch();
  for (const p of plan) {
    // 水域物件坐在水面上(礁岩露出水面才看得見);陸域坐在裙的地表上。
    // **逐零件落地**:一叢林塊的外圍樹散到 ±11m,拿落點一個高度擺全部零件會讓坡上那幾棵懸空
    const gy = (x, z) => {
      const y = terrain.bufferHeightAt(x, z);
      return p.kind === 'islet' && wy != null ? Math.max(y, wy) - 0.6 : y;
    };
    emitWallParts(batch, propParts(p.kind, p.seed), p.x, gy(p.x, p.z), p.z, p.ry, p.s, gy);
  }
  flushPartBatch(group, batch, { wash: 0.5, cool: 0.5 });
  return plan.length;
}

// ---- 視線邊界的背景(使用者定案:「視線邊界的空氣牆貼上假山/假海/假森林/假城市」)----
// 落在緩衝深度的 `BACK_INSET_F` 上,逐段由**最近的圖界點**的地貌決定貼哪一種。
// 高度上限吃 `objHeightMax()`(與建物/地標/巨岩同一個天花板)⇒ 背景永遠構不到世界天花板;
// 而它離可玩區 400m 以上、又被 x/z 夾制擋著,飛行機體也永遠到不了 —— 兩件事各自成立。
// **`ctr`(outlineContribution)由呼叫端注入**,MUST NOT 在本函式裡讀 `INK_CTR`:這一支
// 被 `audit_world_edge` 以真品原文抽出來在沙箱裡跑(自由變數是逐一具名注入的),就地引用一個
// 新的模組常數就是那支稽核當場 ReferenceError —— 而它驗的「演出 ⊆ 碰撞盒 / 逐零件落地」與
// 墨線完全無關。同 `edgewall.js` 的坡度門檻由呼叫端注入那一條紀律。省略 ⇒ 逐位元同舊制。
function buildBackdrop({ group, terrain, ctr }) {
  if (!terrain.bufferHeightAt) return 0;
  const wy = terrain.waterY;
  const season = terrain.season || 'summer';
  const probe = (x, z) => {
    if (wy != null && terrain.heightAt(x, z) < wy + WATER.SHORE) return 'water';
    return classifyImg(terrain.sampleColor?.(x, z)) || 'bare';
  };
  const plan = planBackdrop({
    minX: terrain.minX, maxX: terrain.maxX, minZ: terrain.minZ, maxZ: terrain.maxZ,
    buffer: terrain.bufferM, probe,   // 同上:深度只認地形交出來的那一個數
  });
  const batch = newBatch();
  for (const b of plan) {
    const h = objHeightMax() * (BACKDROP_KINDS[b.kind]?.hF ?? 1);
    // **逐零件落地**(使用者:「在斜坡不要懸空」):一段背景 150m 長,山稜逐座沿段軸散開 ——
    // 拿段心一個高度擺整段,坡上那幾座就整片浮在半空(假海刻意仍以海平面為準)
    const gy = (x, z) => {
      const y = terrain.bufferHeightAt(x, z);
      return wy != null && b.kind === 'sea' ? Math.max(y, wy) - 1 : y;
    };
    emitWallParts(batch, backdropParts(b.kind, { len: b.len, h, seed: b.seed, season }),
      b.x, gy(b.x, b.z), b.z, b.ry, 1, gy);
  }
  // 遠景:洗白拉高、冷色重一點(大氣透視)⇒ 與近處的世界分得開,不會誤讀成可以走過去的地形。
  // `contrib` 是同一句話的另一半:遠景是**畫上去的背景不是物件**,它的每一條稜線都不值得
  // 一條全強度的墨線。⚠ **這一批目前是全場最刺眼的一處**,而真正的通用解是計畫 ④-3
  // 「霧範圍 ≡ 勾線淡出範圍」(`INK.FADE0/FADE1` 錨在 `camera.far` ⇒ 對現役地圖等於永不淡出,
  // 而背景環落在圖界外 410m、`scene.fog` 的 near 是 span×0.5 ≈ 797m ⇒ 那一圈五邊形錐體
  // 零霧、勾線 100% 強度)。contribution 只是止血:**真山(地形)在同樣距離上仍是全強度**,
  // MUST NOT 因此把 FADE 常數就地改小(那會把近景的線一起吃掉)。
  flushPartBatch(group, batch, { wash: 0.78, cool: 0.72, rim: 0, contrib: ctr });
  return plan.length;
}

// ---- 邊界帶(障礙環外的緩衝空間)的視覺邊界 ----
// 障礙環佔內縮 [WALL_M − WALL_T, WALL_M];本帶在它**之外**(內縮 8m ~ 環的外緣)玩家永遠到不了。
// 沿四緣依地貌放置邊界物:市區 → 樓群、綠地/濕地 → 神木、裸露地 → 巨岩簇,
// 讓「打不開的邊」看起來是被城市/森林/岩壁圍住,而不是隱形牆。
// 全部走既有管線(generic 建物 / items 植被 InstancedMesh);邊界樓沿管線
// 也會登記碰撞柱 —— 反正在空氣牆外不可達,無礙。
function placeBoundary({ terrain, items, generic, rnd, mix, occ, settlement, rings = [] }) {
  // 帶的內緣 = 障礙環的外緣(推導不手寫:改環厚/內縮量,這一帶自己跟著讓開)。
  // 現值與舊制的 34 逐位元相同 ⇒ 這一支的亂數序列與佈局完全不變。
  // 2026-08-11:內緣改吃 `edgeWallDeepM()`(最深的那一款牆的厚度)—— 環體自從吃型錄之後
  // 厚度是逐款的真實尺寸(貨輪 18m),沿用 `WALL_T` 的話邊界樓群會長進船身裡。
  const IN0 = 8, IN1 = edgeWallInsetM() - edgeWallDeepM();
  const species = Object.keys(GIANT_DEFS);
  const edges = [
    { x0: terrain.minX, z0: terrain.minZ, dx: 1, dz: 0, len: terrain.worldW },
    { x0: terrain.minX, z0: terrain.maxZ, dx: 1, dz: 0, len: terrain.worldW },
    { x0: terrain.minX, z0: terrain.minZ, dx: 0, dz: 1, len: terrain.worldH },
    { x0: terrain.maxX, z0: terrain.minZ, dx: 0, dz: 1, len: terrain.worldH },
  ];
  let placed = 0;
  for (const e of edges) {
    // 內縮方向:朝地圖中心
    const nx = e.dx ? 0 : (e.x0 === terrain.minX ? 1 : -1);
    const nz = e.dz ? 0 : (e.z0 === terrain.minZ ? 1 : -1);
    for (let d = 14 + rnd() * 20; d < e.len - 14; d += 22 + rnd() * 16) {
      const inset = IN0 + rnd() * (IN1 - IN0);
      const x = e.x0 + e.dx * d + nx * inset;
      const z = e.z0 + e.dz * d + nz * inset;
      const h = terrain.heightAt(x, z);
      // 水面/濕地缺口:水面本身就是邊界;沼澤帶也不種邊界樓/神木牆/巨岩(水沼上禁大型障礙物)
      if (h < 0.4 || terrainEnvCode(terrain, x, z) !== 0) continue;
      // 塔堡圈退讓(主堡落在圖端時邊界帶可能壓進圈):三型最大腳印保守外擴 20m
      if (rings.some((rg) => Math.hypot(x - rg.x, z - rg.z) < rg.r + 20)) continue;
      const avail = occ.room(x, z) - 1;   // 與既有物(含邊界鄰居/邊緣 OSM 樓)的可用半徑
      let biome = classify(terrain.sampleColor?.(x, z), h, mix, rnd);
      // 邊界樓是**建物**(進 generic ⇒ 立面/占位與圖資建物同一條路)⇒ 市區判定 MUST 過
      // 聚落場(圖資建物密度的單一縫,與兩個建物放大器同一把尺)。衛星低飽和像素
      // (裸岩/陰影/道路)與手寫 mix 的 55% 改寫都會把荒野判成 urban —— 舊制沿整圈邊界
      // 每 ~30m 抽一次,綠地/裸露地場地被圈上數十棟 22~70m 高樓,而圖資裡一棟都沒有
      // (2026-08-05 使用者回報「建築太多、不符真實圖資」)。降格**不留缺口**:視覺牆
      // 照樣要圍,改按場地宣告的主要野地地貌擺巨岩/神木(邊界帶本來就是 mix 的具名
      // 消費端 —— 視覺牆選型不是權威地貌;建物那一型才要圖資背書)。
      if (biome === 'urban' && !settlement?.(x, z)) {
        biome = mix && (mix.bare || 0) > (mix.green || 0) + (mix.wet || 0) ? 'bare' : 'green';
      }
      if (biome === 'urban') {
        let w = 14 + rnd() * 14, dd = 12 + rnd() * 10;
        const f = Math.min(1, avail / (Math.max(w, dd) / 2));   // 塞不下就縮到剛好
        if (f < 0.45) continue;
        w *= f; dd *= f;
        const commercial = rnd() < 0.5;
        const storeyTarget = commercial ? STOREY.commercial : STOREY.residential;
        const rawH = Math.min(22 + rnd() * 48, OVER.bldCap);
        const floors = Math.max(1, Math.round(rawH / storeyTarget));
        generic.push({
          x, z, w, d: dd,
          h: floors * storeyTarget,
          ry: (e.dz ? Math.PI / 2 : 0) + (rnd() - 0.5) * 0.1,   // 沿邊排列成街牆
          commercial,
          v: Math.floor(rnd() * FACADES[commercial ? 'commercial' : 'residential'].length),
        });
        occ.add(x, z, Math.max(w, dd) / 2);
      } else if (biome === 'bare') {
        let s = 1.4 + rnd() * 2.0;
        s *= Math.min(1, avail / (3.6 * s));   // 腳印 ~3.6×s
        if (s < 0.7) continue;
        (items.borderrock ??= []).push({
          x, y: sinkBaseY(terrain, x, z, 3.6 * s) - 0.6, z, s,
          ry: rnd() * Math.PI * 2, tx: (rnd() - 0.5) * 0.1, tz: (rnd() - 0.5) * 0.1,
          dj: rnd(),
        });
        occ.add(x, z, 3.6 * s);
      } else {   // green / wet → 神木牆
        const sp = species[Math.floor(rnd() * species.length)];
        // 邊界神木牆吃同一個物件高度上限(分布版,同 placeGiantGroves)—— 邊界帶在空氣牆外
        // 不可達,但它照樣**看得見**,漏掉這一支就是「圖中央的神木被削平、圍牆那圈還是 200m」
        let s = objScaleFit(0.65 + rnd() * 0.5, GIANT_DEFS[sp].h, 1.15);
        const rT = GIANT_DEFS[sp].r;
        // 幹腳印 +6:與邊界樓保持淨距,樹冠不貼上建物牆面(樹冠彼此交疊成林無妨)
        s *= Math.min(1, avail / (rT * s + 6));
        if (s < 0.4) continue;
        (items[sp] ??= []).push({
          x, y: sinkBaseY(terrain, x, z, rT * s * 1.6), z, s,   // 板根腳印落底(見 sinkBaseY)
          ry: rnd() * Math.PI * 2, tx: (rnd() - 0.5) * 0.04, tz: (rnd() - 0.5) * 0.04,
          dj: rnd(),
        });
        occ.add(x, z, rT * s + 6);
      }
      placed++;
    }
  }
  return placed;
}

// ---- 邊界道路封鎖事件:道路穿出障礙環處,以車禍/施工/巨坑封路 ----
// 對每條實體道路折線,找「內 → 外」跨越障礙環內緣的交點,在交點內側放事件障礙(沿路面朝向)
// —— 向玩家解釋「這條路斷了」。障礙環上線後這一支仍留著:環是**沿著邊界**的一堵牆,
// 而封路事件是**沿著這條路**的敘事(路為什麼到此為止),兩者說的不是同一件事。
// 內縮量吃 `edgeWallInsetM()` 單一縫 —— 手寫 40 的話改了環的位置,封路障礙會留在原處
// (症狀:車禍現場離牆十幾公尺,中間一段沒有理由的柏油)。
function buildRoadBlocks(group, roads, terrain, center, blockers, rnd) {
  const INSET = edgeWallInsetM();
  const x0 = terrain.minX + INSET, x1 = terrain.maxX - INSET;
  const z0 = terrain.minZ + INSET, z1 = terrain.maxZ - INSET;
  const inside = (p) => p[0] > x0 && p[0] < x1 && p[1] > z0 && p[1] < z1;
  const noOut = (grp) => { grp.traverse((o) => { if (o.isMesh) o.userData.noOutline = true; }); return grp; };
  const placed = [];

  // 轎車(車禍用):形狀走 `vehicles.js` 的**唯一縫**,本支只決定「多長、什麼漆」。
  // ⚠ **零 `rnd()` 消耗**(舊制也是零)—— 這一支的宿主 `buildRoadBlocks(…, rnd)` 吃的是
  // 世界**共享**序列,順手在這裡抽一枚就把後面每一株植被、每一棟補間建物的落點整條推移,
  // 而畫面上只表現成「整張圖變了」(§2.3)。
  const car = (c, len = 4.4) => vehGroup('sedan', { fit: { L: len, W: 1.9, H: 1.55 }, paint: c });
  const barrier = () => {   // 工程拒馬:橙白條紋橫板 + 雙腳
    const bg = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.7, 0.2), toonMat(0xd97b29));
    board.position.y = 1.0; bg.add(board);
    for (const sx of [-0.9, 0.3]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.24), toonMat(0xf2ede2));
      stripe.position.set(sx, 1.0, 0); bg.add(stripe);
    }
    for (const sx of [-1.2, 1.2]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.3, 0.7), toonMat(0x6a7278));
      leg.position.set(sx, 0.65, 0); bg.add(leg);
    }
    return bg;
  };
  const cone2 = () => {   // 交通錐(橙 + 白環)
    const gg = new THREE.Group();
    const c1 = new THREE.Mesh(cone(0.34, 0.9, 7), toonMat(0xd9622e));
    c1.position.y = 0.45; gg.add(c1);
    const band = new THREE.Mesh(cyl(0.21, 0.26, 0.18, 7), toonMat(0xf2ede2));
    band.position.y = 0.55; gg.add(band);
    return gg;
  };

  const KINDS = {
    crash: (g, rnd) => {   // 連環車禍:兩車追撞、一車翻覆 + 三角警示
      const c1 = car([0xc0392b, 0x2e6da4, 0xd8cfc4][Math.floor(rnd() * 3)]);
      c1.rotation.y = 0.45; c1.position.set(-2.2, 0, -0.8); g.add(c1);
      const c2 = car(0x9aa2a8, 4.0);
      c2.rotation.set(0.12, -0.5, 0.55);   // 半翻覆騎上前車
      c2.position.set(1.8, 0.35, 0.7); g.add(c2);
      const tri = new THREE.Mesh(cone(0.4, 0.7, 3), toonMat(0xd93a2b));
      tri.position.set(-5.5, 0.35, 0.5); g.add(tri);
      for (let i = 0; i < 4; i++) {   // 撞擊碎片
        const shard = new THREE.Mesh(ico(0.22), toonMat(0x3a4046));
        shard.position.set((rnd() - 0.5) * 6, 0.15, (rnd() - 0.5) * 3);
        g.add(shard);
      }
      return 5;
    },
    work: (g, rnd) => {   // 道路施工:拒馬排 + 交通錐 + 土堆
      for (const px of [-3, 0, 3]) {
        const b = barrier();
        b.position.set(px, 0, (rnd() - 0.5) * 0.8);
        b.rotation.y = Math.PI / 2 + (rnd() - 0.5) * 0.3;   // 橫在路上
        g.add(b);
      }
      for (let i = 0; i < 3; i++) {
        const c = cone2();
        c.position.set(-4 + i * 4 + (rnd() - 0.5), 0, 2.2 + rnd());
        g.add(c);
      }
      const spoil = new THREE.Mesh(ico(1.5), toonMat(0x8a6f52));
      spoil.scale.y = 0.55; spoil.position.set(1.5, 0.5, -2.4); g.add(spoil);
      return 5;
    },
    pit: (g, rnd) => {   // 路面巨坑:黑洞盤 + 崩裂瀝青塊 + 圍欄
      const pr = 4.5 + rnd() * 2.5;
      const hole = new THREE.Mesh(cyl(pr, pr * 0.92, 0.5, 12), toonMat(0x11151a));
      hole.position.y = 0.28; g.add(hole);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2 + rnd();
        const chunk = new THREE.Mesh(ico(0.7 + rnd() * 0.6), toonMat(0x3c4046));
        chunk.scale.y = 0.5;
        chunk.position.set(Math.cos(a) * (pr + 0.8), 0.25, Math.sin(a) * (pr + 0.8));
        g.add(chunk);
      }
      for (const sx of [-1, 1]) {
        const b = barrier();
        b.position.set(sx * (pr + 2), 0, 0);
        b.rotation.y = Math.PI / 2;
        g.add(b);
      }
      return pr + 2;
    },
  };
  const kindKeys = Object.keys(KINDS);

  for (const way of roads) {
    if (placed.length >= 24) break;
    if (!way.tags || way.tags.tunnel) continue;
    if (!/^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)$/.test(way.tags.highway || '')) continue;
    const pts = (way.geometry || []).map((p) => llToWorld(p.lat, p.lon, center));
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (inside(a) === inside(b)) continue;   // 沒有跨越空氣牆線
      // 與內縮框四邊求交,取線段上第一個交點
      const ts = [];
      for (const [va, vb, lim] of [[a[0], b[0], x0], [a[0], b[0], x1]]) {
        if ((va - lim) * (vb - lim) < 0) ts.push((lim - va) / (vb - va));
      }
      for (const [va, vb, lim] of [[a[1], b[1], z0], [a[1], b[1], z1]]) {
        if ((va - lim) * (vb - lim) < 0) ts.push((lim - va) / (vb - va));
      }
      if (!ts.length) continue;
      const t = Math.min(...ts);
      const cx = a[0] + (b[0] - a[0]) * t, cz = a[1] + (b[1] - a[1]) * t;
      // 障礙放交點「內側」6m,玩家撞牆前先看到封路
      const dirIn = inside(a) ? -1 : 1;
      const dl = Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]));
      const dx = (b[0] - a[0]) / dl * dirIn, dz = (b[1] - a[1]) / dl * dirIn;
      const ox = cx + dx * 6, oz = cz + dz * 6;
      if (placed.some((p) => Math.hypot(ox - p[0], oz - p[1]) < 30)) continue;   // 同路口去重
      const gy = terrain.heightAt(ox, oz);
      if (gy < 0.4 || terrainEnvCode(terrain, ox, oz) !== 0) continue;   // 水域/沼澤不放封路障礙
      const g = new THREE.Group();
      const kind = kindKeys[Math.floor(rnd() * kindKeys.length)];
      const or2 = KINDS[kind](g, rnd);
      noOut(g);
      g.position.set(ox, gy - 0.15, oz);
      g.rotation.y = Math.atan2(-dz, dx);   // +x 對齊路向
      group.add(g);
      blockers.push({ x: ox, z: oz, y: gy - 1, r: or2, h: 3 });
      placed.push([ox, oz]);
    }
  }
  return placed.length;
}

// 建物占位網格:補間建物不得與既有建物/地標互穿。
// bucket 邊長 64 > 最大(建物半對角 ~23 + 地標碰撞半徑 ~32 + gap 5),故 3×3 掃描必然涵蓋所有可能重疊者。
function makeOccupancy() {
  const C = 64;
  const g = new Map();
  const add = (x, z, r) => {
    const k = `${Math.floor(x / C)},${Math.floor(z / C)}`;
    let a = g.get(k);
    if (!a) g.set(k, a = []);
    a.push([x, z, r]);
  };
  const free = (x, z, r, gap) => {
    const ci = Math.floor(x / C), cj = Math.floor(z / C);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const a = g.get(`${ci + i},${cj + j}`);
        if (!a) continue;
        for (const [bx, bz, br] of a) if (Math.hypot(x - bx, z - bz) < r + br + gap) return false;
      }
    }
    return true;
  };
  // 此點的「可用半徑」= 到最近既有物邊緣的距離(掃 ±1 桶,上限 C)。
  // 「塞不下就縮到剛好」的量尺:呼叫端把腳印縮到 ≤ room 再放
  const room = (x, z) => {
    let best = C;
    const ci = Math.floor(x / C), cj = Math.floor(z / C);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const a = g.get(`${ci + i},${cj + j}`);
        if (!a) continue;
        for (const [bx, bz, br] of a) best = Math.min(best, Math.hypot(x - bx, z - bz) - br);
      }
    }
    return best;
  };
  return { add, free, room };
}

/**
 * 市區補間:把每個既有建物當「街廓種子」,沿它的朝向鋪一塊 cols×rows 的建物網格,
 * 補回連續街區。REAL_SCALE=0.5(遊戲=2×真實)下 OSM 建物間距約為真實 ×2(遠比舊制 8× 密),
 * 補間量由 occ.free() 自然收斂(擠不下就不補);OSM 覆蓋稀疏的郊區/未測繪街廓仍靠它長出街景:
 *   - 同街廓共用朝向 ⇒ 樓面對齊、巷弄成直線;街廓之間的空隙自然留成街道
 *   - areaFree(blocked) 擋住兵線走廊(半寬 17m)/ 塔位 / 主堡 ⇒ 淨空帶成為街廓夾出的戰略通道
 *   - occ 以「外接圓」保證不穿模;skip 留出空地/中庭破除棋盤感
 * 補出的建物與 OSM 建物走同一條路徑登記 blockers,碰撞/隱蔽一致。
 * rnd 為 mulberry32 且每格消耗固定枚數(檢查一律放在抽樣之後)⇒ 全房間各客戶端結果相同。
 *
 * **種子由呼叫端給定(`seeds`),本函式 MUST NOT 自己去 `generic` 撈**(2026-08-04):
 * 「郊野維持開闊,不會整張圖長滿樓」這條不變式的前提是「種子 = 圖資落下來的既有建物、
 * 而且那裡真的是聚落」。舊制在此就地 `generic.slice(0, maxSeeds)`,而呼叫點排在街廓配置
 * **之後** ⇒ 種子裡混進了 planBlocks 剛配出來的臨街樓,一棟圖資建物滾成一整片街區;
 * 圖資越稀疏滾得越兇(市區的 slice 名額早被圖資建物佔滿,荒野才輪得到新配的)。
 */
function densifyUrban({ seeds, generic, blocked, terrain, rnd, inb, occ, roadFacing }) {
  if (!seeds.length) return 0;
  // occ 為全建物共用占位網格(OSM/離線/地標已在收錄時登記),此處只續用

  const rint = ([lo, hi]) => lo + Math.floor(rnd() * (hi - lo + 1));
  let added = 0;
  for (const s of seeds) {
    if (added >= MAX_INFILL) break;
    const ca = Math.cos(s.ry), sa = Math.sin(s.ry);
    const cols = rint(INFILL.cols), rows = rint(INFILL.rows);
    for (let i = 0; i < cols && added < MAX_INFILL; i++) {
      for (let j = 0; j < rows && added < MAX_INFILL; j++) {
        // 抽樣一律先做完,淘汰與否都消耗等量亂數 ⇒ 序列不因地形/淘汰而漂移
        const commercial = rnd() < 0.28;
        const w = (commercial ? 16 + rnd() * 16 : 10 + rnd() * 12) * OVER.bldXZ;
        const d = (commercial ? 16 + rnd() * 16 : 10 + rnd() * 12) * OVER.bldXZ;
        const storeyTarget = commercial ? STOREY.commercial : STOREY.residential;
        const rawH = Math.min((commercial ? 24 + rnd() * 40 : 7 + rnd() * 9) * OVER.bldH, OVER.bldCap);
        const floors = Math.max(1, Math.round(rawH / storeyTarget));
        const h = floors * storeyTarget;
        const jx = (rnd() - 0.5) * 2.4, jz = (rnd() - 0.5) * 2.4;   // 沿街微抖動
        rnd();   // 保留舊版朝向抖動的亂數消耗；方形基底不再實際套用偏角
        const v = Math.floor(rnd() * FACADES[commercial ? 'commercial' : 'residential'].length);
        const vacant = rnd() < INFILL.skip;
        if (vacant) continue;
        const lx = (i - (cols - 1) / 2) * INFILL.pitch + jx;
        const lz = (j - (rows - 1) / 2) * INFILL.pitch + jz;
        const x = s.x + lx * ca + lz * sa;
        const z = s.z - lx * sa + lz * ca;
        if (x < terrain.minX + inb || x > terrain.maxX - inb
          || z < terrain.minZ + inb || z > terrain.maxZ - inb) continue;
        if (terrain.heightAt(x, z) <= 0.4) continue;              // 水面
        if (terrainEnvCode(terrain, x, z) !== 0) continue;        // 水域/沼澤不補間建物(抽樣已完,序列安全)
        // occ 用外接圓(不穿模),blocked 用內縮圓(牆面不侵走廊)— 與 OSM 建物同一套判準
        const r = Math.hypot(w, d) / 2;
        if (!occ.free(x, z, Math.max(w, d) / 2, INFILL.gap)) continue;
        if (!areaFree(blocked, x, z, r * 0.75)) continue;
        occ.add(x, z, Math.max(w, d) / 2);
        const ry = roadFacing ? (roadFacing(x, z) ?? s.ry) : s.ry;
        generic.push({ x, z, w, d, h, ry, commercial, v });
        added++;
      }
    }
  }
  return added;
}

/**
 * 建立整張圖的地物。回傳 THREE.Group(加進 terrain.group 同層即可)。
 * cfg 需含 lanes/bases/center/env/venue;terrain 來自 buildTerrain()。
 */
export async function buildBiomes(cfg, terrain, onProgress) {
  const center = cfg.center;
  const season = cfg.env?.season || 'summer';
  const night = cfg.env?.time === 'night';
  const mix = cfg.venue?.mix || null;
  const rnd = mulberry32(
    (Math.round(center.lat * 1e4) * 31 + Math.round(center.lng * 1e4)) ^ ((cfg.teamSize || 5) << 20),
  );
  const group = new THREE.Group();
  group.name = 'biomes';
  // 地貌分界線帶的「強制乾地」遮罩(2026-08-13;見 ground.js bandDryAt 檔頭 ③)MUST 在建圖
  // 開頭清掉:那一層是 buildGroundCover **產出**的,而底毯分區自己就吃 terrainEnvCode ——
  // 同一個 terrain 再建一次圖(再戰回房)時若還掛著上一次的遮罩,分區就會被上一次的界線
  // 推著走,而症狀是「同一張地圖每次進去長得不一樣」。安裝點只有 main.js 一處。
  terrain.inBorderBand = null;

  await onProgress?.(0.02, '規劃兵線淨空走廊…');
  const naturePromise = loadNatureModels(season);   // Quaternius 植被:與散佈並行載入
  const { blocked, towerBase, rings } = buildClearance(cfg, center);
  // 主堡世界座標:道路預整理、名岩退避與語意化地標的錨點同吃這一份(各算一次 = 第二份實作)
  const basesW = ['SWARM', 'STEEL'].map((side) => {
    const [x, z] = llToWorld(cfg.bases[side][0], cfg.bases[side][1], center);
    return { side, x, z };
  });
  // 水域／沼澤主堡的大承台比既有主堡淨空圈寬；先登記完整台面，避免後續植被、地被與建物
  // 從平台外圈穿出。乾地主堡維持原 BASE_CLEAR_R，既有場景佈局逐位元不動。
  for (const base of basesW) {
    if (terrainEnvCode(terrain, base.x, base.z) !== 0) blockArea(blocked, base.x, base.z, BASE_PAD_R);
  }
  // 地物散布的邊界內縮 = 障礙環內緣(推導不手寫):舊制的 30 讓落點可以抽在環體 [34,40] 之內,
  // 樹幹/岩塊會長在牆裡。改吃同一支之後,散布範圍恰好就是「玩家進得去的那一塊」。
  const inb = edgeWallInsetM();
  const rx = () => terrain.minX + inb + rnd() * (terrain.worldW - inb * 2);
  const rz = () => terrain.minZ + inb + rnd() * (terrain.worldH - inb * 2);

  // ---- OSM 圖資 + 地下道開挖 + 立體交通走廊(2026-07-15 提前到所有地物散布之前)----
  // 順序是硬約束:①洞口開挖先於植被/神木/建物 → 引道上的地物不再「先種在原地表、開挖後漂浮」;
  // ②隧道敞開段與橋樑走廊先進 blocked → 建物/巨木/巨石等障礙不會生成在地下道/隧道內與橋下淨空。
  // 此區全程不耗共享 rnd(fetch/合併/開挖/走廊皆確定性)⇒ 佈局亂數序列與舊版一致。
  await onProgress?.(0.03, '讀取 OSM 圖資(建物/鐵路/道路/瀑布)…');
  // OSM 抓取不再以影像成敗為前提(2026-07-22 倫敦橋數浮動案):舊版 `if (terrain.sampleColor)`
  // 讓 Esri 影像失敗連鎖放棄整組 Overpass → 道路/真橋整套換成兵線備援,圖資逐局忽有忽無。
  // 影像與路網是獨立服務,各自失敗各自降級;離線時 fetch 快速失敗,不拖載入。
  let [osmData, osmRoads] = await Promise.all([fetchOsmFeatures(terrain.bbox), fetchOsmRoads(terrain.bbox)]);
  // OSM 查詢一旦成功，即使 areas 為空也代表「這個 bbox 沒有面域」；只在整個來源回 null
  // 時才走程序城市 fallback。投影與分類共用 osmAreas.js，後續建物／landfield 不再各猜一次。
  const osmSource = osmData !== null && osmData !== undefined;
  let osmCatalogReport = {
    area: 0, building: 0, mapped: 0, exact: 0, parentFallback: 0,
    unmapped: 0, invalid: 0, capacity: 0, byFamily: {}, byKind: {}, gaps: [],
  };
  if (osmSource) {
    const projected = (osmData.areas || []).map((a) => projectAreaRecord(a, llToWorld, center)).filter(Boolean);
    const cat = catalogAreas(projected);
    const parserInvalid = Number(osmData.areaInvalid) || 0;
    const parserCapacity = Number(osmData.areaCapacity) || 0;
    const parserGaps = Array.isArray(osmData.areaGaps) ? osmData.areaGaps : [];
    osmCatalogReport = {
      ...cat.report,
      invalid: cat.report.invalid + parserInvalid,
      capacity: cat.report.capacity + parserCapacity,
      gaps: mergeAreaGaps([...cat.report.gaps, ...parserGaps]),
    };
    const pf = osmData.pointFeatures || {};
    // aliases 只指向 pointFeatures 同一份陣列，供既有鐵路／水路／入口消費端相容；
    // 建物與用地只讀 areas，絕不重建第二份 covers。
    osmData = { ...osmData, ...pf, areas: cat.areas };
  }
  // 行人語意 MUST 先於剪枝／量化／橋隧判定：地下步道從此不再被任何道路消費端看見；
  // 高架與沿線主題則掛在 way 上，後續幾何重組用展開運算保留它。全段零共享 rnd。
  const pedestrianPlan = planPedestrianNetwork({
    roads: osmRoads || [], rails: osmData?.rails || [], pois: osmData?.pois || [],
    entrances: osmData?.entrances || [],
    toXZ: (p) => llToWorld(p.lat, p.lon ?? p.lng, center),
  });
  if (osmRoads?.length) osmRoads = pedestrianPlan.roads;
  const roadPruneStats = {};
  // ---- 道路圖資預整理 + 格網量化(唯一接線點)----
  // 剪枝 MUST 在量化前:已決定不畫的糾纏小路不應參與節點鬆弛、把留下的主網拉歪。
  // `pruneRoads` 跨過 degree=2 OSM tag 接縫，只剪小閉環的完整走廊；近接另一道路的死端
  // 只在分析圖虛擬閉合。寬度由 `roadWidth` 注入；結構並排與雙向分隔車道先受保護。
  // 離線備援仍不動兵線:那是伺服器也在吃的權威幾何，客戶端不得單邊剪枝。
  if (osmRoads?.length) {
    osmRoads = pruneRoads(
      osmRoads,
      (p) => llToWorld(p.lat, p.lon, center),
      (way) => roadWidth(way.tags || {}),
      roadPruneStats,
      basesW.map(({ x, z }) => [x, z]),
    );
  }
  // ---- 道路格網量化(2026-08-10 使用者定案)----
  // 「將所有道路量化成 16 個方向」。MUST 排在**這裡** —— 也就是拿到圖資之後、任何消費端
  // (mergeGradeChains / 橋隧去重 / markGradeCorridors / carveTunnels / gradeRoadBeds /
  // buildRoads / roadPolys / nearestRoadAngle)之前:量化過的路網從此是唯一的一份,
  // 沒有任何一條路徑吃得到未量化的原始幾何(在下游補做 = 走廊與實際路面分家)。
  // 只作用在**真的圖資**上:離線備援(roadInput 退回兵線)刻意不量化 —— 兵線是伺服器
  // 也在吃的權威幾何(sim.lanes 直接吃 config.lanes),客戶端單方面量化 = 兩端分家。
  // 快取存的是量化**前**的圖資(fetchOsmRoads 自己入庫)⇒ 換參數不必清快取;
  // 量化本身零亂數、純函式 ⇒ 同一份快取在每個客戶端算出逐位元相同的路網。
  if (osmRoads?.length) {
    osmRoads = quantizeRoads(
      osmRoads,
      (p) => llToWorld(p.lat, p.lon, center),
      (x, z) => worldToLL(x, z, center),
    );
  }
  // 舊中心點建物欄位已退場；精確面域由下方 OSM polygon builder 消費。
  const osm = null;
  // 隧道/橋樑分段合併(2026-07-15 二修):OSM 常把一條隧道/橋切成多條 way,共用節點
  // 深在山體內/河道上 —— 把「way 端點」當洞口/橋台會讓路面剖面在結構中段爬回地表
  // (Λ 形斷面、覆蓋斷開、接縫殘留岩階 = 洞內隱形牆)。共端點的同類 way MUST 先併成
  // 完整鏈,carveTunnels 與 buildRoads 共用同一份 → 剖面一致、洞口 = 鏈的真端點。
  // 合併後平行雙幅橋去重(單層原則 ①)+ 平行雙孔隧道去重(footway/service 疊在車道孔上 → 洞口不對稱)。
  // 兩刀皆排在 carve 指派 way._tun(下方)之前 ⇒ carve/buildRoads/markGradeCorridors 三消費端吃同一份去重集。
  // ---- 結構剔除記帳(2026-08-04 使用者定案)----
  // 「高架橋/地下道/隧道/明隧道**就算在兵線之外也建立**,除非會干擾兵線,或違反其他規則」。
  // 建置端本來就沒有任何兵線距離判定(`buildRoads` 逐 way 跑完整份 `roadInput`,離兵線
  // 一公里的橋照建、照上碰撞、照登記走廊)—— 會讓結構消失的只有下面這幾把具名的刀。
  // 記帳的用途是**可見性**:少一座橋在畫面上完全看不出原因(它只是不在那裡),
  // 沒有這個計數就只能逐條 way 手動比對圖資。每一把刀都 MUST 對得上一條具名理由:
  //   parallel  平行雙幅橋 / 雙孔隧道疊在一起(單層原則:兩層貼在一起 = 破圖)
  //   laneWet   兵線跨水段的補橋是唯一結算 ⇒ 走廊內側向重疊的真橋剔除(= 「干擾兵線」)
  //   crossing  十字路口兩座橋交會只留一座(2026-07-28 使用者定案 = 「其他規則」)
  // MUST NOT 新增第四把刀而不記帳,也 MUST NOT 加任何「離兵線多遠就不建」的判定。
  const strucDrop = { parallel: 0, laneWet: 0, crossing: 0 };
  const strucN = (rs) => (rs || []).filter((w) => w.tags?.bridge || w.tags?.tunnel).length;
  if (osmRoads?.length) {
    const before = strucN(osmRoads);
    osmRoads = dedupeParallelTunnels(dedupeParallelBridges(mergeGradeChains(osmRoads), center), center);
    strucDrop.parallel = Math.max(0, before - strucN(osmRoads));
  }

  // ---- 在地文字語料(招牌/路標/佈告欄/看板/解說牌上寫什麼;唯一組裝點)----
  // 底本 = `venueText.js` 的離線烘焙(宗教/交通/政府/水文/地名這幾類執行期根本沒查過);
  // 上面再併當場抓到的建物/道路 tag(**零額外網路** —— 那兩份 payload 本來就帶著 name)。
  // 亂數走**專屬 seed**:招牌挑字 MUST NOT 動到共享 rnd 的呼叫序,否則植被/建物佈局會跟著漂。
  const bakedText = VENUE_TEXT[cfg.venue?.id] || null;
  const vtext = mergeCorpus(bakedText, harvestOsm(
    { buildings: osm || [], roads: osmRoads || [] },
    bakedText?.locale || localeOf(cfg.venue?.country),
  ));
  const signRnd = mulberry32(((Math.round(center.lat * 1e4) * 31 + Math.round(center.lng * 1e4)) >>> 0) ^ 0x516E);
  const signUsed = new Set();   // 一鎮一家去重帳:全世界五類招牌共用**一本**(SKILL §一.4)
  // 圖集貼圖現在只有 worldtext 那一張(掛在 mesh.userData.signTex),不再有第二份
  // 地下道洞口開挖(真・下沉版;2026-07-22 覆蓋區間改制):**只開挖敞開補集**(引道/長峽谷),
  // 覆蓋段與縫合蓋廊段地表原樣保留。路面 = 兩端洞口地表高的平直內插;山體自然高過路面即成隧道。
  // 覆蓋區間(tunnelCoverIntervals)在「開挖前」高度上計算一次,掛到 way._tun 供
  // buildRoads / markGradeCorridors 共用 —— 開挖、牆/天花、走廊、門洞四者的洞口位置才一致。
  const tunnelRuns = [];
  const galStrips = [];   // 明隧道開放側柱外淨空帶(與 tunnelRuns 同批收集、開挖前判定)
  if (terrain.carveTunnels && osmRoads?.length) {
    for (const way of osmRoads) {
      if (!strucTunnel(way.tags)) continue;   // 資格閘:人行/室內 tunnel way 不進結構管線
      // 邊界裁切 MUST 與 buildRoads 完全相同(inb=4、逐頂點丟棄切段)+ 同一 densify(ROAD_SEG)
      // —— 兩邊的 run 幾何逐點一致,覆蓋區間索引/路面剖面才對得上。
      const inb2 = 4;
      const wruns = [];
      let cur2 = [];
      for (const p of way.geometry || []) {
        const [x, z] = llToWorld(p.lat, p.lon, center);
        if (x < terrain.minX + inb2 || x > terrain.maxX - inb2 || z < terrain.minZ + inb2 || z > terrain.maxZ - inb2) {
          if (cur2.length >= 2) wruns.push(cur2);
          cur2 = [];
          continue;
        }
        cur2.push([x, z]);
      }
      if (cur2.length >= 2) wruns.push(cur2);
      way._tun = [];
      const hAt = (x, z) => terrain.heightAt(x, z);
      const hwWay = strucHw(way.tags);   // 開挖剖面 MUST 用該路自己的通行寬(單一縫,見 strucHw)
      for (const raw2 of wruns) {
        let pts = densify(raw2, ROAD_SEG);
        const arc = (p) => { const c = [0]; for (let i = 1; i < p.length; i++) c.push(c[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])); return c; };
        let cum = arc(pts);
        let tot = cum[cum.length - 1] || 1;
        let rec = { hA: hAt(pts[0][0], pts[0][1]), hB: hAt(pts[pts.length - 1][0], pts[pts.length - 1][1]) };
        let floors = cum.map((s) => tunFloorAt(rec, s, tot));   // 山體隧道:平直路面
        let iv = tunnelCoverIntervals(pts, cum, floors, hAt);
        // 明隧道實體結構(OSM tunnel=avalanche_protector,2026-07-31):落石棚的頂是**建的**
        // 不是山 —— 覆蓋判定 MUST NOT 依「地表藏得住天花板」(峽谷落石棚常整段裸露,舊制
        // covPts=0 ⇒ 攤成一般道路 = 太魯閣台8線明隧道整段消失)。整條 run 直接視為覆蓋,
        // 開放側 vs 岩背側仍由 tunnelWallProfile 幾何定奪(單一縫)——貼壁側整面牆、
        // 臨谷側矮牆 + 柱列,和真明隧道一樣。
        if (way.tags.tunnel === 'avalanche_protector' && tot >= TUN_COV_MIN) iv = [[0, tot, 0, pts.length - 1]];
        // 平坦市區的 tunnel way(直線剖面藏不住天花板)= **地下道**:改吃下沉剖面 + 兩端引道,
        // 成立的話後續一切(開挖/牆/天花/門洞/走廊)與山體隧道走同一條路 —— 見 underpassPlan。
        if (!iv.length) {
          const up = underpassPlan(raw2, way.tags, hAt, {
            minX: terrain.minX + UND.EDGE, maxX: terrain.maxX - UND.EDGE,
            minZ: terrain.minZ + UND.EDGE, maxZ: terrain.maxZ - UND.EDGE,
            hw: hwWay,   // 全寬覆蓋取樣的牆線位置(單一縫 strucHw;venue_field 同一份)
          });
          if (up) { ({ pts, cum, total: tot, floors, intervals: iv } = up); rec = { hA: up.hA, hB: up.hB, sink: up.sink, ramp: up.ramp }; }
        }
        // 幾何與錨點一併存檔:buildRoads / markGradeCorridors MUST 吃**同一份**折線與剖面
        // (地下道的折線含兩端引道延伸段,重算 densify(raw) 只會拿到沒有引道的舊折線)。
        // hA/hB 是「開挖前」錨點 —— 開挖後重算會與 carve 的 floors 小幅分家。
        way._tun.push({ ...rec, intervals: iv.map(([a, b]) => [a, b]), pts, hw: hwWay });
        if (!iv.length) continue;   // 既不是山體隧道也建不成地下道 = 一般道路,不開挖
        // 敞開補集:[run 頭, 首覆蓋起點] + 各覆蓋區間之間 + [末覆蓋終點, run 尾]
        // (地下道 = 兩端引道;山體隧道 = 引道/長峽谷)。
        // 地下道帶 cut 旗標:carveTunnels 把引道開挖收窄成垂直路塹(過渡帶 hw+CUT_W)——
        // 出入口只在道路兩端,側面 MUST NOT 留下走得下去的開挖斜坡(見 UND 設計註解 ②)。
        // covA/covB = run 頭/尾是否與覆蓋段交界:carveTunnels 只在交界端 PROT_M 內維持
        // 「藏不住天花板才挖」舊判準(保護轉換崖),run 內部一律無條件開挖(殘峰 = 路上岩牆)。
        const bounds = [0, ...iv.flatMap(([, , ia, ib]) => [ia, ib]), pts.length - 1];
        for (let k = 0; k + 1 < bounds.length; k += 2) {
          const a = bounds[k], b = bounds[k + 1];
          if (b - a < 1) continue;
          tunnelRuns.push({ pts: pts.slice(a, b + 1), floors: floors.slice(a, b + 1), covA: k > 0, covB: k + 2 < bounds.length, hw: hwWay, cut: !!rec.sink });
        }
        // 明隧道開放側柱外淨空帶(2026-07-31):覆蓋段逐側跑 tunnelWallProfile(單一縫,
        // **開挖前**高度 —— 本迴圈尚未呼叫 carveTunnels,輸入與覆蓋區間同一份),連續 open
        // 段收成 strip 交給 carveGalleryBands。這刀只降不升、只動頂板以下,且落差掃描一律吃
        // 天然地形(natureAt)⇒ buildRoads / markGradeCorridors 開挖後重算 profile 不翻面。地下道恆不判。
        if (!rec.sink && terrain.carveGalleryBands) {
          const covV2 = pts.map((_, vi) => iv.some(([, , ia, ib]) => vi >= ia && vi <= ib));
          for (const side of [1, -1]) {
            const prof = tunnelWallProfile(pts, floors, covV2, hAt, hwWay, side, (x, z) => terrain.natureAt(x, z));
            let s0 = -1;
            for (let vi = 0; vi <= pts.length; vi++) {
              const on = vi < pts.length && prof[vi].open;
              if (on && s0 < 0) s0 = vi;
              if (!on && s0 >= 0) {
                if (vi - s0 >= 2) galStrips.push({ pts: pts.slice(s0, vi), floors: floors.slice(s0, vi), hw: hwWay, side });
                s0 = -1;
              }
            }
          }
        }
      }
    }
    if (tunnelRuns.length) terrain.carveTunnels(tunnelRuns, { clear: TUN.CLEAR, hw: TUN.HW });
    if (galStrips.length) terrain.carveGalleryBands(galStrips, { clear: TUN.CLEAR, roofT: TUN.ROOF_T, clearW: TUN.GAL_CLEAR_W });
  }
  // ---- 兵線跨水段定案(2026-07-22 確定性改制;開挖後計算,高度已定案,不耗共享 rnd)----
  // 兵線是遊戲性關鍵路徑:跨水段的橋 MUST 與兵線幾何一樣確定,不得依賴 Overpass 逐局回傳
  // (舊版 DECK_COVER 覆蓋率去重 → 真橋忽有忽無時兵線橋數 1~4 浮動、部分覆蓋時全跨補橋
  // 疊在真橋上 = 上下兩層)。此處每個兵線泡水段一律預定一座全跨補橋(引道錨點 ±RAMP_M 在
  // 兵線上,NPC 沿線走 smoothstep 引道自然上橋),並剔除兵線走廊內側向重疊的真橋(單層原則 ②)。
  // osmRoads 失敗時兵線本身就是 roadInput,buildRoads 已為泡水段建橋 → 兩條路徑橋數一致。
  const laneWetWays = [];
  const laneWetPieces = [];   // 兵線泡水段(世界座標);dropLaneBridges + 橋交會去重的最高優先集
  if (osmRoads?.length && cfg.lanes?.length) {
    for (const lane of cfg.lanes) {
      const pts = densify(lane.map(([lat, lng]) => llToWorld(lat, lng, center)), ROAD_SEG);
      for (const p of splitWaterPieces(pts, terrain, true)) {   // 兵線跨沼段也升橋(inclSwamp)
        if (p.wet === true && p.length >= 2) laneWetPieces.push(p);
      }
    }
    if (laneWetPieces.length) {
      const beforeW = strucN(osmRoads);
      osmRoads = dropLaneBridges(osmRoads, laneWetPieces, center);
      strucDrop.laneWet = Math.max(0, beforeW - strucN(osmRoads));
      for (const p of laneWetPieces) {
        laneWetWays.push({ tags: { highway: 'primary' }, geometry: p.map(([x, z]) => worldToLL(x, z, center)) });
      }
    }
  }
  // ③橋交會去重(十字路口只留一座橋,優先度 兵線>鐵路>大馬路>小馬路):橋交叉/交會 → 低優先整條剔除。
  // 2026-07-29 起含**鐵路高架**(osmData.rails 一併去重,鐵路×道路保留鐵路)。MUST 排在 roadInput 定案
  // **之前**(markGradeCorridors/buildRoads 吃 osmRoads)+ buildRails 之前(吃 osmData.rails)。
  if (osmRoads?.length || osmData?.rails?.length) {
    const beforeC = strucN(osmRoads);
    const dd = dedupeCrossingBridges(osmRoads || [], center, laneWetPieces, osmData?.rails || []);
    if (osmRoads?.length) osmRoads = dd.roads;
    if (osmData?.rails?.length) osmData.rails = dd.rails;
    strucDrop.crossing = Math.max(0, beforeC - strucN(osmRoads));
  }
  // 跨水路線 way 串接(一條路線上太靠近的兩座橋直接連成一座):MUST 排在 roadInput 定案**之前**
  // —— markGradeCorridors 與 buildRoads 吃同一份 way 陣列,分家的話走廊會與實際橋面對不上。
  if (osmRoads?.length) osmRoads = joinWaterRouteWays(osmRoads, terrain, center);
  // 道路輸入在此定案(離線備援 = 兵線當主要道路):走廊計算與 buildRoads MUST 吃同一份。
  // OSM 成功仍補上查詢額度漏掉的兵線乾地小段；覆蓋判定會排除已存在的同向路面，跨水段另由
  // laneWetWays 建唯一一層橋，避免以完整兵線再壓一條重疊道路。
  const laneRoadWays = osmRoads?.length ? missingLaneRoadWays(cfg.lanes, osmRoads, terrain, center) : [];
  const roadInput = osmRoads?.length
    ? [...osmRoads.filter((w) => w.tags?.bridge || w.tags?.tunnel), ...laneRoadWays,
       ...osmRoads.filter((w) => !w.tags?.bridge && !w.tags?.tunnel)]
    : cfg.lanes.map((lane) => ({ tags: { highway: 'primary' }, geometry: lane.map(([lat, lng]) => ({ lat, lon: lng })) }));
  // 地表道路足跡：所有獨立物件與地被共用同一批有向盒。橋／結構隧道有垂直分層，不占地面。
  const roadFeet = [];
  for (const way of roadInput) {
    if (way.tags?.bridge || way.tags?.tunnel) continue;
    const pts = (way.geometry || []).map((p) => llToWorld(p.lat, p.lon, center));
    const hd = roadWidth(way.tags) / 2 + 1.5;
    for (let i = 1; i < pts.length; i++) {
      const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
      const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      const hw = len / 2;
      roadFeet.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw, hd,
                      ry: Math.atan2(dz, dx), r: Math.hypot(hw, hd) });
    }
  }
  const roadFootIndex = makeFootprintIndex(roadFeet);
  const roadOccupied = (foot) => roadFootIndex.near(foot);
  const vegFootIndex = makeFootprintIndex();
  // ---- 道路路基整平(2026-07-31 使用者回報「兩側太陡時一邊懸空、一邊陷入地形」)----
  // 一般道路(非橋/非結構隧道/非步道)的乾地走廊橫向整成切填平台:上坡側切、下坡側填,
  // 路面緞帶與單位站的 heightAt 才在同一個平面上。MUST 排在 markGradeCorridors / 地物散布 /
  // buildRoads 之前(高度在此定案,下游全部取樣整平後地形);開挖足跡/水域紀律住
  // terrain.gradeRoadBeds。裁切 + densify + 泡水切段 MUST 與 buildRoads 完全相同
  // (inb=4 / ROAD_SEG / splitWaterPieces),否則整平走廊與實際路面錯位。零共享 rnd。
  const laneModeG = !osmRoads?.length;
  if (terrain.gradeRoadBeds && roadInput?.length) {
    const gradeRuns = [];
    const inbG = 4;
    for (const way of roadInput) {
      if (way.tags?.bridge) continue;                          // 橋:橋面自己是平的,地形不整
      if (isPedestrianWay(way.tags || {})) continue;           // 步道:小徑不值得 8m 網格整地
      const runsG = [];
      let curG = [];
      for (const gpt of way.geometry || []) {
        const [x, z] = llToWorld(gpt.lat, gpt.lon, center);
        if (x < terrain.minX + inbG || x > terrain.maxX - inbG || z < terrain.minZ + inbG || z > terrain.maxZ - inbG) {
          if (curG.length >= 2) runsG.push(curG);
          curG = [];
          continue;
        }
        curG.push([x, z]);
      }
      if (curG.length >= 2) runsG.push(curG);
      for (let ri = 0; ri < runsG.length; ri++) {
        if (way.tags?.tunnel && way._tun?.[ri]?.intervals.length) continue;   // 結構隧道/地下道:carveTunnels 已處理整條 run
        for (const piece of splitWaterPieces(densify(runsG[ri], ROAD_SEG), terrain, laneModeG)) {
          if (piece.wet === true || piece.length < 2) continue;               // 泡水段走橋,不整地
          gradeRuns.push({ pts: piece, hw: Math.max(carriageHw(way.tags || {}), 2.5) });
        }
      }
    }
    if (gradeRuns.length) terrain.gradeRoadBeds(gradeRuns);
  }
  // 立體交通走廊:淨空(blocked)+ 上傳伺服器用小段(gradeCorridors);開挖後才算(高度已定案)。
  // 兵線補橋走廊一併登記(提前到地物散布之前 → 橋下淨空與真橋同等待遇)。分兩趟:真 OSM 道路
  // 維持水域限定(inclSwamp=false),兵線補橋 + 離線兵線 roadInput 吃 inclSwamp(跨沼也造橋);
  // blocked 兩趟累加同一 Set。
  const laneMode = !osmRoads?.length;   // 離線:roadInput = 兵線本身 ⇒ 也吃 inclSwamp
  const gradeCorridors = [
    ...markGradeCorridors(roadInput, terrain, center, blocked, laneMode),
    ...markGradeCorridors(laneWetWays, terrain, center, blocked, true),
  ];

  // ---- 散佈植被 ----
  const areaKm2 = terrain.worldW * terrain.worldH / 1e6;
  const vegTarget = Math.max(800, Math.min(MAX_VEG, Math.round(areaKm2 * 560)));   // 密度加高(仍全 instanced)
  const items = {};   // type -> [{x,y,z,s,ry}]
  const urbanPts = [];
  let placed = 0;
  const put = (type, x, z, s) => {
    const actualS = s * (VEG_SCALE[type] || 1);
    // 拒絕前仍固定抽完姿態亂數，地圖上的後續物件不因道路淘汰而漂移。
    const item = {
      x, y: terrain.heightAt(x, z), z, s: actualS,
      ry: rnd() * Math.PI * 2,
      tx: (rnd() - 0.5) * 0.09, tz: (rnd() - 0.5) * 0.09,
      dj: rnd(),
    };
    const foot = { x, z, r: (VEG_FOOT_R[type] ?? 1) * actualS };
    // 優先序:兵線/塔位/主堡淨空(blocked)高於植被 ⇒ 足印圓盤掃 areaFree(單格驗擋不住大樹);
    // 地被級平面植栽走 areaFreeLane,可鋪進塔堡圈當草原/沙漠背景
    if (VEG_FLAT.has(type)) {
      if (!areaFreeLane(blocked, towerBase, x, z, foot.r)) return;
    } else if (!areaFree(blocked, x, z, foot.r)) return;
    if (roadOccupied(foot) || vegFootIndex.near(foot)) return;
    items[type] ??= [];
    items[type].push(item);
    vegFootIndex.add(foot);
    placed++;
  };

  // ---- 神木群落 + 巨岩地標:先於一般植被佔位(小植被/地被/建物自動避開)----
  await onProgress?.(0.04, '安置神木群落與巨岩地標…');
  const blockers = [];   // 建物/神木/巨岩碰撞柱(main.js → terrain.blockers → game.js _collide)
  // 邊界障礙環:MUST 是 blockers 的**第一批**(main.js 的 occ 上傳 slice(0, LOS.MAX_OCC),
  // 排在尾端會被密集市區擠掉 = 伺服器不知道有牆);排在這裡也保證地形開挖/整平都已定案。
  // 零共享 rnd 消耗 ⇒ 插在這一行不會推移後面任何一株植被的佈局(§2.3)。
  terrain.season = season;
  const edgeSegs = buildEdgeWall({ group, terrain, blockers });
  // 舊緩衝區的林塊／岩塊／聚落／島礁與遠景假山已收入 edgewall 權威障礙環。
  // 不再於圖界外發射無碰撞布景，緩衝裙只保留容納邊界障礙的深度。
  const greenSites = [], bareSites = [];
  for (let a = 0; a < 1400 && (greenSites.length < 20 || bareSites.length < 36); a++) {
    const x = rx(), z = rz();
    const h = terrain.heightAt(x, z);
    if (h < 0.4 || blocked.has(cellKey(x, z))) continue;
    const b = classify(terrain.sampleColor?.(x, z), h, mix, rnd);
    if (b === 'green' && greenSites.length < 20) greenSites.push([x, z]);
    else if (b === 'bare' && bareSites.length < 36) bareSites.push([x, z]);
  }
  // 國旗歸屬(地圖 30 : 駐軍 60 : 敵對 10)。純函式、零共享 rnd ⇒ 建在哪一行都不影響序列。
  const nation = makeNationPicker(cfg, basesW);
  const megalithsBuilt = placeMegaliths({
    group, terrain, blocked, blockers, rnd, sites: bareSites, basesW, roadOccupied,
  });
  // 荒野遺跡與廢棄建築：零共享 rnd 消耗，排在植被前登記 blockArea 防止穿模
  const relicsBuilt = placeWildernessRelics({
    group, terrain, blocked, blockers, sites: bareSites, basesW, roadOccupied,
  });
  const giantTrees = placeGiantGroves({
    terrain, blocked, blockers, items, rnd, sites: greenSites, roadOccupied,
  });
  // 語意化地標(P2-C):排在一般植被之前 ⇒ blockArea 之後小植被自動避開;零共享 rnd 消耗,
  // 故插在這裡**不會**推移後面每一株植被/每一棟建物的亂數序列(§2.3)。
  const beaconsBuilt = placeBeacons({
    group, terrain, blocked, blockers,
    lanesW: cfg.lanes.map((lane) => lane.map(([lat, lng]) => llToWorld(lat, lng, center))),
    basesW, mapA: mapArg(cfg),   // 塔位錨點的型態(迷你只有前線那一組;劇情戰役只有防守方有塔)
  });
  // 主堡旗陣:純表現層、零共享 rnd ⇒ 排在這裡不推移後面的植被序列(§2.3)
  const baseFlags = placeBaseFlags({ group, terrain, blocked, basesW, nation });

  const attempts = vegTarget * 3;
  for (let a = 0; a < attempts && placed < vegTarget; a++) {
    if ((a & 1023) === 0) await onProgress?.(0.05 + (a / attempts) * 0.30, '鋪設植被地貌…');
    const x = rx(), z = rz();
    // 塔堡圈的格子放行到 put() 再判(地被級平面植栽可留);走廊格照舊快拒,亂數序列不為走廊漂移
    if (blocked.has(cellKey(x, z)) && !towerBase.has(cellKey(x, z))) continue;
    const h = terrain.heightAt(x, z);
    if (h < 0.4) {   // 水體:偶爾在水邊補蘆葦
      if (rnd() < 0.06) put('reed', x, z, 0.8 + rnd() * 0.6);
      continue;
    }
    // 內陸影像水域(高於海平面盤、靠衛星水色判定):classify 的 mix 55% 改寫可能把水點
    // 洗成 green 而種樹進河面 —— 比照水體處理(偶發岸邊蘆葦)。沼澤(code 2)保留 wet 分支植被。
    if (terrainEnvCode(terrain, x, z) === 1) {
      if (rnd() < 0.06) put('reed', x, z, 0.8 + rnd() * 0.6);
      continue;
    }
    const biome = classify(terrain.sampleColor?.(x, z), h, mix, rnd);
    if (biome === 'water') continue;
    if (biome === 'urban') {
      // 建物種子的信任階梯(2026-08-05 使用者回報「綠地/裸露地建築太多、不符真實圖資」):
      // urbanPts 是「程序生成市區」備援的唯一種子 ⇒ 影像在手就只收**純影像**判為市區的點
      // (`classifyImg` 單一縫、零亂數)—— 手寫 mix 的 55% 改寫是植被/地被的加權,
      // MUST NOT 讓它憑空生出市區種子(綠地場地宣告一成 urban ⇒ 全圖撒滿假種子)。
      // 影像也取不到(全離線)才退回 classify 的結果 = mix 當最後一層備援(原則 6 降級鏈)。
      // 不動 classify 的呼叫 ⇒ 亂數消耗逐位元不變,植被佈局不漂移(§2.3)。
      const rgb = terrain.sampleColor?.(x, z);
      if ((!rgb || classifyImg(rgb) === 'urban') && urbanPts.length < 500) urbanPts.push([x, z]);
      continue;
    }
    if (biome === 'green') {
      const relH = (h - terrain.minH) / Math.max(1, terrain.maxH - terrain.minH);
      const r = rnd();
      if (r < 0.25) {
        // 竹林:大小不一的群落
        const n = 6 + Math.floor(rnd() * 12);
        const cr = 5 + rnd() * 14;
        for (let k = 0; k < n && placed < vegTarget; k++) {
          const bx = x + (rnd() - 0.5) * cr * 2, bz = z + (rnd() - 0.5) * cr * 2;
          if ((blocked.has(cellKey(bx, bz)) && !towerBase.has(cellKey(bx, bz))) || terrain.heightAt(bx, bz) < 0.4) continue;
          put('bamboo', bx, bz, 0.8 + rnd() * 0.7);
        }
      } else if (relH > 0.55 || r < 0.55) {
        // 針葉林四款輪廓輪替(塔錐/簇疊/紡錘/層盤),同林異形不再滿山三角錐
        put(['conifer', 'conifer', 'conifer2', 'conifer3', 'conifer4'][(rnd() * 5) | 0], x, z, 0.75 + rnd() * 0.9);
      } else {
        put(rnd() < 0.3 ? 'birch' : 'broadleaf', x, z, 0.75 + rnd() * 0.9);
      }
    } else if (biome === 'bare') {
      const r = rnd();
      if (r < 0.38) put('silvergrass', x, z, 0.8 + rnd() * 1.0);
      else if (r < 0.58) put('arrowbamboo', x, z, 0.8 + rnd() * 0.8);
      else if (r < 0.78) put('shrub', x, z, 0.7 + rnd() * 0.9);
      else if (r < 0.88) put('deadtree', x, z, 0.7 + rnd() * 0.7);
      else put('succulent', x, z, 0.7 + rnd() * 0.8);
    } else if (biome === 'wet') {
      if (rnd() < 0.45) put('mangrove', x, z, 0.8 + rnd() * 0.7);
      else put('reed', x, z, 0.8 + rnd() * 0.8);
    }
  }
  // ---- 圖資建物(OSM 已於開頭抓取;植被網格延後到建物定案之後才建:
  // 先拔掉落在建物腳印內的植被(見下),樹才不會穿屋頂)----
  const generic = [];       // {x,z,w,h,d,ry,commercial}
  const landmarks = [];     // {x,z,type,scale}
  const usedLm = new Set();
  // 全建物共用占位網格(OSM/離線/地標/補間):佔地是隨機抽的、不是 OSM 實測輪廓,
  // 相鄰 OSM 種子放大後會彼此互穿 —— 一律先驗占位再收
  const occ = makeOccupancy();
  // OSM 面域建物：外環/內洞直接生成，牆段與 blocker 共用同一份有向盒資料。
  // 平台不混進 blockers；main.js 會透過現有 surfaceAt 查詢精確 outer/holes。
  const osmRoofPlatforms = [];
  const osmBuildingFootprints = [];
  const osmBuildingMeshes = [];
  let osmBuildingResult = { generated: 0, generatedByKind: {}, blockers: [], platforms: [], invalid: [], skipped: [], meshes: [] };
  if (osmSource && osmData?.areas?.length) {
    await onProgress?.(0.58, `建置 OSM 精確建物(${osmData.areas.length} 面域)…`);
    const osmWallColors = {
      residential: 0xb7a893, commercial: 0x7189a8, industrial: 0x727b83,
      education: 0x9aaf8f, healthcare: 0xb47e7e, transport: 0x888fa4,
      religion: 0xa58f73, civic: 0x9b9ea6, culture: 0x9d8eaa,
      sports: 0x789b80, parking: 0x8a8d91, utility: 0x7e8b95,
    };
    osmBuildingResult = buildOsmPolygonBuildings(group, osmData.areas, {
      terrain, rings,
      materialOf: (kind, batch, style) => {
        const family = osmData.areas.find((a) => a.classification?.kind === kind)?.classification?.family || kind;
        const wall = envMat(style?.wall || osmWallColors[family] || 0xb7a893, { wash: 0.42, cool: 0.4 });
        const roof = envMat(style?.roof || 0x4f5964, { wash: 0.3, cool: 0.45 });
        return { wall, roof };
      },
    });
    blockers.push(...osmBuildingResult.blockers);
    osmRoofPlatforms.push(...osmBuildingResult.platforms);
    osmBuildingFootprints.push(...osmBuildingResult.platforms);
    osmBuildingMeshes.push(...osmBuildingResult.meshes);
    // 只把建物腳印的涵蓋 cell 加入 blocked；用地面域不在此阻擋，避免大面域封死兵線。
    for (const p of osmBuildingResult.platforms) {
      const xs = p.outer.map((q) => q[0]), zs = p.outer.map((q) => q[1]);
      const minI = Math.floor(Math.min(...xs) / CELL) - 1, maxI = Math.ceil(Math.max(...xs) / CELL) + 1;
      const minJ = Math.floor(Math.min(...zs) / CELL) - 1, maxJ = Math.ceil(Math.max(...zs) / CELL) + 1;
      for (let i = minI; i <= maxI; i++) for (let j = minJ; j <= maxJ; j++) {
        const x = i * CELL, z = j * CELL;
        if (pointInProjectedArea(x, z, p)) blocked.add(cellKey(x, z));
      }
    }
  }
  // 執行期生成失敗與 relay 容量也走同一份 gap schema；不得只留在 console 或靜默略過。
  if (osmSource) {
    const areaById = new Map((osmData?.areas || []).map((a) => [a.sourceId, a]));
    const gaps = [...(osmCatalogReport.gaps || [])];
    const addRuntimeGap = (entry, reason) => {
      const area = areaById.get(entry?.sourceId);
      const tag = Object.entries(area?.tags || {}).find(([k]) => OSM_AREA_KEYS.includes(k)) || ['source', entry?.sourceId || 'unknown'];
      gaps.push({
        tagKey: tag[0], tagValue: String(tag[1] ?? ''), reason,
        fallback: area?.classification?.fallback || null, count: 1,
        areaM2: Number(area?.areaM2) || 0, sourceIds: entry?.sourceId ? [entry.sourceId] : [],
      });
    };
    for (const row of osmBuildingResult.invalid || []) addRuntimeGap(row, row.reason || 'invalid_footprint');
    for (const row of osmBuildingResult.skipped || []) {
      if (row.reason !== 'unmapped') addRuntimeGap(row, row.reason || 'unsupported_building');
    }
    const relayDrop = Math.max(0, Number(osmData?.relayDrop) || 0);
    if (relayDrop) gaps.push({
      tagKey: 'relay', tagValue: 'capacity', reason: 'capacity', fallback: null,
      count: relayDrop, areaM2: 0, sourceIds: [],
    });
    osmCatalogReport = {
      ...osmCatalogReport,
      invalid: (osmCatalogReport.invalid || 0) + (osmBuildingResult.invalid?.length || 0),
      capacity: (osmCatalogReport.capacity || 0) + relayDrop,
      gaps: gaps.sort((a, b) => String(a.tagKey).localeCompare(String(b.tagKey))
        || String(a.tagValue).localeCompare(String(b.tagValue)) || String(a.reason).localeCompare(String(b.reason))),
    };
  }
  // 障礙環先佔位:邊界帶的樓群/神木/巨岩經既有的 `occ.room` 自動縮到環外(不佔位就是
  // 巨幹/樓身長進環體)。環在 blockers 定案時就算好了,這裡只是把同一份幾何登記進占位網格。
  for (const s of edgeSegs) occ.add(s.x, s.z, Math.hypot(s.hw2, s.hd2));
  // 街道淨空(2026-07-17 巴黎建物騎路案):OSM 建物只有中心點、量體與朝向是程序抽的,
  // 沿街種子與補間網格會直接壓上路面 —— 道路以占位圓帶進 occ,建物系統(種子/補間/邊界物)
  // 經既有 occ.free 檢查自動避讓。占位圓只作用於建物,植被/危險區不查 occ,影響面最小;
  // blocked 的 10m 網格對窄巷太粗(blockPoint 最小 30m 帶會清光沿街建物),不用它。
  // 隧道(覆蓋段上方照常鋪地物)與橋樑(橋下走廊已在 blocked)跳過;離線備援 = 兵線,
  // 走廊已淨空,同樣不需重複。不耗共享 rnd(佈局亂數序列不變)。
  // 同一迴圈順便把道路線段收進桶索引:建物朝向對齊最近道路(nearestRoadAngle)用。
  const roadSegIdx = new Map();   // `${bx},${bz}`(64m 桶)-> [[x1,z1,x2,z2,hw]…]
  const allRoadSegs = [];         // 桶內查無時的全圖備援；方形基底不得退回隨機角
  const SEG_C = 64;
  const segBucketAdd = (x1, z1, x2, z2, hw = 4) => {
    const entry = [x1, z1, x2, z2, hw];
    allRoadSegs.push(entry);
    // 線段掛進兩端桶(段長 ≤ 桶邊即涵蓋);兩端同桶只掛一次
    const k1 = `${Math.floor(x1 / SEG_C)},${Math.floor(z1 / SEG_C)}`;
    const k2 = `${Math.floor(x2 / SEG_C)},${Math.floor(z2 / SEG_C)}`;
    for (const k of (k1 === k2 ? [k1] : [k1, k2])) {
      let a = roadSegIdx.get(k);
      if (!a) roadSegIdx.set(k, a = []);
      a.push(entry);
    }
  };
  // 建物朝向/占位吃 roadInput(線上 = OSM 道路、離線 = 兵線當街道)⇒ 兩模式建物皆能門朝街
  // 臨街配置吃的街道線段(§A):與上面的占位/朝向**同一次迴圈、同一份 roadInput** ——
  // 另開一趟就是第二份街道清單,而它們遲早會因為某個 tag 過濾條件而分家。
  // 這裡收的是 OSM 原始頂點之間的**整段**(直路 = 一長段),不是占位用的細分段:
  // 細分段長度只有 6~12m,MIN_SEG 一律過不了 ⇒ 一棟都配不出來。
  const frontSegs = [];
  for (const way of roadInput) {
    if (way.tags?.tunnel || way.tags?.bridge) continue;
    const hw = roadWidth(way.tags) / 2;
    const hwName = way.tags?.highway || '';
    const front = FRONT_HW.test(hwName);   // 街廓配置只認市街道路(步道/產業道路/連絡道不配)
    const main = MAIN_HW.test(hwName);
    let px = null, pz = 0;
    for (const p of way.geometry || []) {
      const [x, z] = llToWorld(p.lat, p.lon, center);
      if (px !== null) {
        if (front) frontSegs.push({ x1: px, z1: pz, x2: x, z2: z, hw, main });
        const seg = Math.hypot(x - px, z - pz);
        const n = Math.max(1, Math.ceil(seg / Math.max(hw * 1.2, 6)));
        for (let k = 1; k <= n; k++) {
          const sx = px + (x - px) * (k - 1) / n, sz = pz + (z - pz) * (k - 1) / n;
          const ex = px + (x - px) * k / n, ez = pz + (z - pz) * k / n;
          occ.add(ex, ez, hw);
          segBucketAdd(sx, sz, ex, ez, hw);
        }
      } else {
        occ.add(x, z, hw);
      }
      px = x; pz = z;
    }
  }
  /**
   * 最近道路段的「門面朝向」(2026-07-25 使用者需求「建築門口一定對準道路」)。
   * 建物 local +x 沿道路切線(順著道路方向整齊排列)、local +z = 門/正立面。取「朝路法線」(-dz,dx)
   * 並選指向最近路點的那一側 ⇒ 門朝街(不朝街背)、立面平行街道。ry 使世界 +z=(sinθ,cosθ) 對上該法線
   * ⇒ θ=atan2(n.x,n.z)(法線恰朝路時等同舊 atan2(-dz,dx),背街時翻 180° —— 立面仍平行街、+x 仍沿路)。
   * 先掃 ±1 桶(64m)；查無時掃全圖道路，確保任何方形基底都不退回隨機角。
   */
  const nearestRoadAngle = (x, z) => {
    const ci = Math.floor(x / SEG_C), cj = Math.floor(z / SEG_C);
    let bd = Infinity, bry = 0;
    const scan = (a) => {
      for (const [x1, z1, x2, z2] of a) {
        const dx = x2 - x1, dz = z2 - z1;
        const l2 = dx * dx + dz * dz;
        if (!l2) continue;
        let t = ((x - x1) * dx + (z - z1) * dz) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = x1 + dx * t, qz = z1 + dz * t;
        const d = Math.hypot(x - qx, z - qz);
        if (d >= bd) continue;
        bd = d;
        const s = ((-dz) * (qx - x) + dx * (qz - z)) >= 0 ? 1 : -1;
        const l = Math.sqrt(l2);
        bry = roadFaceRy(dx / l, dz / l, -s);
      }
    };
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const a = roadSegIdx.get(`${ci + i},${cj + j}`);
        if (a) scan(a);
      }
    }
    if (bd === Infinity) scan(allRoadSegs);
    return bd === Infinity ? null : bry;
  };

  /**
   * 道路淨空檢驗(2026-08-25 使用者需求「道路上不可以有建築物」)。
   * 建物外接矩形或半徑與鄰近道路車道段進行距離檢驗,禁止任何建物壓在車道上。
   */
  const isRoadClear = (x, z, w, d) => {
    const ci = Math.floor(x / SEG_C), cj = Math.floor(z / SEG_C);
    const toScan = [];
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const a = roadSegIdx.get(`${ci + i},${cj + j}`);
        if (a) toScan.push(...a);
      }
    }
    const list = toScan.length ? toScan : allRoadSegs;
    const r = Math.min(w, d) * 0.45;
    for (const [x1, z1, x2, z2, hw] of list) {
      const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz;
      if (!l2) continue;
      let t = ((x - x1) * dx + (z - z1) * dz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = x1 + dx * t, qz = z1 + dz * t;
      const dist = Math.hypot(x - qx, z - qz);
      if (dist < (hw || 4) + r + 0.5) return false;
    }
    return true;
  };

  const tryPlace = (x, z) =>
    !blocked.has(cellKey(x, z))
    && x > terrain.minX + inb && x < terrain.maxX - inb
    && z > terrain.minZ + inb && z < terrain.maxZ - inb
    && terrain.heightAt(x, z) > 0.4
    && terrainEnvCode(terrain, x, z) === 0;   // 水域/沼澤不蓋建物(單一縫:OSM 建物/地標/離線街區共用)

  if (osm && osm.length) {
    await onProgress?.(0.6, `建置圖資建物(${osm.length} 筆)…`);
    // 特殊地標優先,一般建物均勻抽樣到上限
    osm.sort((p, q) => (buildingType(q.tags) !== 'residential') - (buildingType(p.tags) !== 'residential'));
    for (const el of osm) {
      const [x, z] = llToWorld(el.lat, el.lng, center);
      if (!tryPlace(x, z)) continue;
      const coordSeed = (Math.imul(Math.round(x * 16) | 0, 0x9E3779B1) ^ Math.imul(Math.round(z * 16) | 0, 0x85EBCA77)) ^ 0x3C6EF35F;
      const type = buildingType(el.tags, coordSeed);
      if (LANDMARKS[type]) {
        // 地標放大後不能只驗中心格:以碰撞半徑掃走廊,牆面才不會侵入兵線
        const cr = (LANDMARK_COL[type]?.r || 10) * OVER.lm;
        // 電塔 ≠ 基地台/天線:輸電鐵塔立於地面開闊帶,橫擔外伸 ±8m —— 占位按
        // 橫擔全寬,建物不得貼近(否則手臂壓上屋頂,像「屋頂長電塔」)
        const or3 = Math.max(cr, type === 'power' ? 9 * OVER.lm : 0);
        if (landmarks.length < 60 && areaFree(blocked, x, z, cr * 0.8) && occ.free(x, z, or3, 1)) {
          landmarks.push({ x, z, type }); usedLm.add(type); occ.add(x, z, or3);
        }
      } else if (generic.length < MAX_BUILDINGS) {
        const commercial = type === 'commercial';
        const w = (commercial ? 16 + rnd() * 16 : 10 + rnd() * 12) * OVER.bldXZ;
        const d = (commercial ? 16 + rnd() * 16 : 10 + rnd() * 12) * OVER.bldXZ;
        // 佔地對齊現實比例後改用半對角掃走廊(單格驗證擋不住大樓牆面)
        if (!areaFree(blocked, x, z, Math.hypot(w, d) / 2 * 0.75)) continue;
        if (!occ.free(x, z, Math.max(w, d) / 2, 1)) continue;   // 不與既收建物互穿
        if (!isRoadClear(x, z, w, d)) continue;                 // 道路淨空防線:建物不得壓在道路上
        occ.add(x, z, Math.max(w, d) / 2);
        // 朝向對齊最近道路(2026-07-17):OSM 只給中心點,隨機朝向讓沿街建物歪斜壓路。
        // rnd 先抽(消耗固定枚數,查無路才用)—— 序列不因對齊與否漂移。
        const rndRy = rnd() * Math.PI;
        generic.push({
          x, z, w, d,
          h: buildingHeight(el.tags, type, rnd),
          // tags 留著只為了立面招牌的字(worldtext);其餘欄位一律已在此處推導完畢,
          // MUST NOT 讓下游再從 tags 推第二份幾何/高度(那就是兩份規則)
          tags: el.tags,
          ry: nearestRoadAngle(x, z) ?? rndRy, commercial,
          v: Math.floor(rnd() * FACADES[commercial ? 'commercial' : 'residential'].length),   // 立面樣式變體
        });
      }
    }
  }
  // 備援:**只在圖資查詢失敗**(osm = null = 「不知道」)且影像判定有市區時才程序生成街區。
  // 查詢成功但零建物(osm = [])= 真實答案就是「這裡沒有建物」—— 荒野 MUST 維持荒野,
  // 舊制在這個案例照樣生出一座程序市區 = 綠地/裸露地憑空長樓(2026-08-05 使用者回報)。
  // 「不符真實圖資」與「圖資取不到」是兩件事:前者寧缺勿錯、後者才降級(原則 6)。
  // mix 是同一條信任階梯的第三層**否決票**:備援街區的語意是「重建一座宣告中的市區」——
  // 場地宣告根本沒有市區成分(urban ≤ 10%,荒野場地全是 0)就沒有東西可重建;放行的話,
  // Overpass 掛掉那幾局,裸岩/陰影的低飽和灰像素(classifyImg 的系統性誤判)照樣在
  // 太魯閣/合歡山長出一座城。市區/混合場地(urban ≥ 15%)不受影響。
  if (!osmSource && (!mix || (mix.urban || 0) > 0.1)
    && !landmarks.length && !generic.length && urbanPts.length > 8) {
    await onProgress?.(0.6, '離線模式:程序生成市區…');
    const lmTypes = Object.keys(LANDMARKS);
    urbanPts.forEach(([x, z], i) => {
      if (!tryPlace(x, z)) return;
      if (i < lmTypes.length && rnd() < 0.8) {
        const cr = Math.max((LANDMARK_COL[lmTypes[i]]?.r || 10) * OVER.lm,
          lmTypes[i] === 'power' ? 9 * OVER.lm : 0);   // 電塔占位按橫擔全寬(同 OSM 路徑)
        if (!occ.free(x, z, cr, 1)) return;
        occ.add(x, z, cr);
        landmarks.push({ x, z, type: lmTypes[i] }); return;
      }
      if (generic.length >= MAX_BUILDINGS) return;
      const commercial = rnd() < 0.25;
      const w = (commercial ? 16 + rnd() * 16 : 10 + rnd() * 12) * OVER.bldXZ;
      const d = (commercial ? 16 + rnd() * 16 : 10 + rnd() * 12) * OVER.bldXZ;
      if (!areaFree(blocked, x, z, Math.hypot(w, d) / 2 * 0.75)) return;
      if (!occ.free(x, z, Math.max(w, d) / 2, 1)) return;
      if (!isRoadClear(x, z, w, d)) return;   // 道路淨空防線:建物不得壓在道路上
      occ.add(x, z, Math.max(w, d) / 2);
      const rndRy = rnd() * Math.PI;   // 先抽保序列固定;附近無路(街廓深處)時 nearestRoadAngle 回 null 才用
      const storeyTarget = commercial ? STOREY.commercial : STOREY.residential;
      const rawH = Math.min((commercial ? 24 + rnd() * 40 : 7 + rnd() * 9) * OVER.bldH, OVER.bldCap);
      const floors = Math.max(1, Math.round(rawH / storeyTarget));
      generic.push({
        x, z, w, d,
        h: floors * storeyTarget,
        ry: nearestRoadAngle(x, z) ?? rndRy, commercial,
        v: Math.floor(rnd() * FACADES[commercial ? 'commercial' : 'residential'].length),   // 立面樣式變體
      });
    });
  }

  // 非建築用地物件：道路／兵線／主堡／塔位與既有建物先佔位，再依面積、間距與硬上限配置。
  // 住宅／商業 district 不補樓；校園／醫院／車站已有子建物時不生成代表建築。
  let osmAreaObjectResult = { generated: 0, generatedByKind: {}, blockers: [], capacity: [], skipped: [] };
  if (osmSource && osmData?.areas?.length) {
    osmAreaObjectResult = buildOsmAreaObjects(group, osmData.areas, {
      maxObjects: 480,
      heightAt: (x, z) => terrain.heightAt(x, z),
      // 優先序:兵線/塔位/主堡淨空高於圖資物件 ⇒ 足印半徑掃 areaFree(單格驗擋不住設施)
      blocked: (x, z, r) => !areaFree(blocked, x, z, r) || !occ.free(x, z, r, 1)
        || blockers.some((b) => Math.hypot(b.x - x, b.z - z) < (b.r || 0) + r + 0.5),
      materialOf: (_generator, row) => envMat(row.color, { wash: 0.38, cool: 0.42 }),
    });
    blockers.push(...osmAreaObjectResult.blockers);
    for (const b of osmAreaObjectResult.blockers) occ.add(b.x, b.z, b.r);
    // 優先序:圖資有標記物件(建築/公園/球場)高於樹木背景 ⇒ 先佔 vegFootIndex,
    // 再把已散佈植被中與圖資物件互穿的拔除(零 rnd 消耗,只淘汰不重抽,序列不漂移)
    for (const b of osmAreaObjectResult.blockers) vegFootIndex.add({ x: b.x, z: b.z, r: b.r });
    for (const type in items) {
      if (GIANT_DEFS[type] || !items[type]?.length) continue;
      const rr = VEG_FOOT_R[type] ?? 1;
      const kept = items[type].filter((it) => !osmAreaObjectResult.blockers.some(
        (b) => Math.hypot(it.x - b.x, it.z - b.z) < rr * it.s + b.r));
      placed -= items[type].length - kept.length;
      items[type] = kept;
    }
    const areaById = new Map(osmData.areas.map((a) => [a.sourceId, a]));
    const append = (entry, reason) => {
      const area = areaById.get(entry?.sourceId);
      const tag = Object.entries(area?.tags || {}).find(([k]) => OSM_AREA_KEYS.includes(k)) || ['source', entry?.sourceId || 'unknown'];
      osmCatalogReport.gaps.push({
        tagKey: tag[0], tagValue: String(tag[1] ?? ''), reason, fallback: area?.classification?.fallback || null,
        count: 1, areaM2: Number(area?.areaM2) || 0, sourceIds: entry?.sourceId ? [entry.sourceId] : [],
      });
    };
    for (const row of osmAreaObjectResult.capacity) append(row, 'capacity');
    for (const row of osmAreaObjectResult.skipped) append(row, row.reason || 'blocked');
    osmCatalogReport.capacity += osmAreaObjectResult.capacity.length;
    osmCatalogReport.gaps = mergeAreaGaps(osmCatalogReport.gaps);
  }

  // ---- 聚落場(單一縫):街廓配置與市區補間**共用**這一支「這裡算不算聚落」----
  // 2026-08-04 使用者回報「太魯閣、合歡山不在市區還這麼多建築」。兩個放大器(planBlocks
  // 沿街配置、densifyUrban 街廓補間)本來各有各的門檻,而且都太鬆:
  //   ① 舊 `nearUrban` 只問「±1 格內**有沒有**圖資建物」—— 峽谷裡一間廁所、一座工務段
  //      就讓整條台8線兩旁具備配置資格(閘的註解寫的是「只在既有**聚落**周邊配置」,
  //      但它實際判的是「附近有一棟房子」,兩者差了一個數量級)。
  //   ② `densifyUrban` **一道地貌閘都沒有**:它的檔頭寫「只從既有建物長出去 ⇒ 郊野維持
  //      開闊」,那條不變式只在「generic = 圖資建物」時成立。
  //
  // **門檻是局部標準化的比例,不是手寫的棵數**(2026-08-04 使用者定案「市區建築不是圖資
  // 都有嗎?建立局部標準化判斷」)。理由與 `field.js` 的地表色階同一條(見 CLAUDE.md:
  // 「色階門檻 MUST 取該場地自己的分位數,MUST NOT 手寫固定門檻」):
  //   - 逐格數圖資建物 → `local(x, z)` = ±1 格內的棵數(= 這一點的都市化程度,原始值);
  //   - **標準化基準取這張圖自己的密度尖峰** `peak` = 局部密度的 P90。取分位數不取最大值
  //     (單一密集格會綁架基準)、也不取平均(大片空地會把基準壓平);取樣點是**每一棟
  //     既有建物自己的位置**,不是全圖每一格 —— 空地的 0 會把分位數整個拉到 0。
  //   - 閘門 = `local ≥ DENS_Q × peak`。DENS_Q 是**比例**不是棵數 ⇒ 圖資測繪得越完整
  //     (市區,`MAX_BUILDINGS` 的名額全滿)基準越高、要求跟著高;測繪稀疏的郊區基準低,
  //     兩者用同一把尺。手寫棵數做不到這件事:同一個數字在東京是「空地」、在峽谷是「市鎮」。
  // 退化保險 `URBAN_MIN_PEAK` **推導不手寫** = `densifyUrban` 自己畫得出來的最小一塊街廓
  //   (`INFILL.cols[0] × INFILL.rows[0]`):這張圖最密的地方連一塊最小街廓都湊不出來,
  //   就沒有任何「街廓」可言 ⇒ 全圖不放大。少了它,只有三棟房子的峽谷 peak = 3、
  //   閘門 = 1.05,那三棟自己就過關,比例式反而比舊制還鬆。
  // **MUST NOT 改吃 `venue.mix`**:那是手寫的場地宣告(見 venues.js),不是圖資 ——
  // 拿它當閘門就是「地貌由人宣告」,而使用者問的正是「有正確從圖資判斷地貌嗎」。
  // 這一支只問圖資落下來的建物,場地宣告一格都不參與。
  const UC = 128, URBAN_DENS_P = 0.9, URBAN_DENS_Q = 0.35;
  const URBAN_MIN_PEAK = INFILL.cols[0] * INFILL.rows[0];   // 推導:最小一塊補間街廓的棟數
  const urbanG = new Map();
  const urbanSeeds = [...generic, ...landmarks];   // 此刻的 generic = 圖資建物 / 離線程序街區
  {
    const ukey = (x, z) => `${Math.floor(x / UC)},${Math.floor(z / UC)}`;
    for (const b of urbanSeeds) { const k = ukey(b.x, b.z); urbanG.set(k, (urbanG.get(k) || 0) + 1); }
  }
  const localDens = (x, z) => {
    const ci = Math.floor(x / UC), cj = Math.floor(z / UC);
    let n = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) n += urbanG.get(`${ci + i},${cj + j}`) || 0;
    return n;
  };
  // 這張圖自己的密度尖峰(P90);零建物 ⇒ peak = 0 ⇒ 下面那道保險直接關掉整個放大鏈
  const densSamples = urbanSeeds.map((b) => localDens(b.x, b.z)).sort((a, b) => a - b);
  const urbanPeak = densSamples.length
    ? densSamples[Math.min(densSamples.length - 1, Math.floor(densSamples.length * URBAN_DENS_P))] : 0;
  // 下限 1:`DENS_Q = 0` ⇒ 閘門退化成「附近有一棟就算」= 逐位元回到舊制(反向驗證的錨)
  const urbanGate = Math.max(1, URBAN_DENS_Q * urbanPeak);
  const settlement = (x, z) => urbanPeak >= URBAN_MIN_PEAK && localDens(x, z) >= urbanGate;
  // 補間種子 MUST 在街廓配置**之前**定案:planBlocks 的產出與圖資建物走同一條路徑進
  // `generic`,不先固定下來,下面那一段配出來的臨街樓就會回頭當補間種子 —— 一棟圖資建物
  // → 一整排街屋 → 每一棟再各長一片 3~6×3~6 的網格,而且**圖資越稀疏放大得越兇**
  //(市區的 generic 早就超過 `INFILL.maxSeeds`,新配的排在後面根本輪不到;荒野只有兩三棟
  // 圖資建物,slice 的名額全讓給新配的街屋)。這正是「不在市區反而樓更多」的成因。
  const infillSeeds = generic.slice(0, INFILL.maxSeeds).filter((b) => settlement(b.x, b.z));

  // ---- 都市計畫:沿街配置 + 公設(2026-08-03 使用者定案①)----
  // 「建築沿道路整齊排列,遵循都市規劃的原則來設計,包含公園、運動場、停車場等公設」。
  // 規則本體在 `siteplan.js planBlocks`(純幾何、離線可驗);本檔只做三件事:
  //   ① 餵街道線段(`frontSegs`,與占位/朝向同一次迴圈收的)
  //   ② 把「放不放得下」收進兩個 probe 回呼(界內/乾地/淨空/市區/占位/平坦度)
  //   ③ 收成果:建築進 `generic`(與圖資建物同一條路徑 ⇒ 碰撞/立面/招牌全部一致)、
  //      公設自建 mesh 並**實算**碰撞柱
  // **零共享 `rnd()` 消耗**:量體/樣式/公設款式全由 `plotSeed`/`frac` 雜湊決定 ⇒ 這一段
  // 的存在與否不會推移任何一株植被、任何一棟圖資建物的亂數序列(§2.3)。
  const civics = [];
  if (!osmSource && frontSegs.length && (generic.length || landmarks.length)) {
    await onProgress?.(0.63, '劃設街廓與公設用地…');
    const nearUrban = settlement;   // 「市區」閘 = 聚落場(單一縫;MUST NOT 在此另判一次)
    const dryAt = (x, z) => terrain.heightAt(x, z) > 0.4 && terrainEnvCode(terrain, x, z) === 0;
    const res = planBlocks({
      segs: frontSegs,
      // 建築基地:與圖資建物**同一套判準**(半對角 ×0.75 掃走廊、外接圓查占位)
      probeLot: (x, z, w, d) => {
        if (x < terrain.minX + inb || x > terrain.maxX - inb
          || z < terrain.minZ + inb || z > terrain.maxZ - inb) return false;
        if (!nearUrban(x, z) || !dryAt(x, z)) return false;
        if (!areaFree(blocked, x, z, Math.hypot(w, d) / 2 * 0.75)) return false;
        if (!occ.free(x, z, Math.max(w, d) / 2, INFILL.gap)) return false;
        occ.add(x, z, Math.max(w, d) / 2);   // 通過即收下(規劃器對每個候選只問一次)
        return true;
      },
      // 公設用地:多兩道閘 —— 腳印周圈全在乾地(大平板半邊泡水最難看)、地表夠平
      // (`flatRadiusAt` 單一縫;公園/球場/停車場在現實裡就是整過的平地,坡地上不擺)
      probeCivic: (x, z, kind, r) => {
        if (x < terrain.minX + r || x > terrain.maxX - r
          || z < terrain.minZ + r || z > terrain.maxZ - r) return false;
        if (!nearUrban(x, z) || !dryAt(x, z)) return false;
        // 腳印周圈:全在乾地,且**起伏**收在門檻內。兩件事都要 ——
        // `flatRadiusAt` 只認「掉下去」(它問的是懸崖),整片往上長的山坡它一路放行,
        // 而落底走 `sinkBaseY` 取最低點 ⇒ 山坡會從鋪面中間長出來。故另量 max−min。
        let lo = terrain.heightAt(x, z), hi = lo;
        for (let k = 0; k < 8; k++) {
          const a = k / 8 * Math.PI * 2;
          const rx2 = x + Math.cos(a) * r * 0.8, rz2 = z + Math.sin(a) * r * 0.8;
          if (!dryAt(rx2, rz2)) return false;
          const hh = terrain.heightAt(rx2, rz2);
          lo = Math.min(lo, hh); hi = Math.max(hi, hh);
        }
        if (hi - lo > CIVIC_KINDS[kind].flat) return false;
        // 公設鋪面是平面背景,可鋪進塔堡圈(市區→停車場/球場、綠地→公園/草原);
        // 有量體零件照常登記 blockers,仍與實體互斥
        if (!areaFreeLane(blocked, towerBase, x, z, r)) return false;
        if (!occ.free(x, z, r, 2)) return false;
        if (flatRadiusAt(terrain, x, z, r, CIVIC_KINDS[kind].flat) < r) return false;
        occ.add(x, z, r);
        return true;
      },
    });
    for (const p of res.plots) {
      if (generic.length >= MAX_BUILDINGS + MAX_INFILL) break;
      const f = frac(p.seed, 5);
      const storeyTarget = p.commercial ? STOREY.commercial : STOREY.residential;
      const rawH = Math.min((p.commercial ? 24 + f * 40 : 7 + f * 9) * OVER.bldH, OVER.bldCap);
      const floors = Math.max(1, Math.round(rawH / storeyTarget));
      generic.push({
        x: p.x, z: p.z, w: p.w, d: p.d,
        h: floors * storeyTarget,
        ry: p.ry, commercial: p.commercial,
        v: Math.floor(frac(p.seed, 6) * FACADES[p.commercial ? 'commercial' : 'residential'].length),
      });
    }
    for (const c of res.civics) {
      const def = CIVIC_KINDS[c.kind];
      const g = buildCivic(c.kind, c.seed ?? 0);   // seed:同圖多座公設走樣(車色/花圃色/小件存缺)
      // 落底:取腳印周圈最低點(同建物/巨岩)—— 大平板寧可陷入緩坡,不懸空
      const gy = sinkBaseY(terrain, c.x, c.z, def.foot * 0.8);
      g.position.set(c.x, gy, c.z);
      g.rotation.y = c.ry;
      group.add(g);
      blockArea(blocked, c.x, c.z, def.foot * 0.8);   // 植被/後續建物避開整片公設
      // 碰撞柱:只有有量體的零件才登記(siteplan 紀律④),半徑由零件表**實算**(A30)
      const ca = Math.cos(c.ry), sa = Math.sin(c.ry);
      for (const col of civicColliders(c.kind)) {
        const wx = c.x + col.px * ca + col.pz * sa, wz = c.z - col.px * sa + col.pz * ca;
        // 方盒件登記**有向盒**(A30:圓只當 broad-phase 且恆為外接半對角)——
        // 看台是 40m 長條,只登記外接圓就是球場中央一片 40m 直徑的隱形牆
        blockers.push({
          x: wx, z: wz, y: gy - 1, r: col.r, h: col.h + 1,
          ...(col.hw2 != null ? { hw2: col.hw2, hd2: col.hd2, ry: c.ry + col.ry } : {}),
        });
      }
      // 綠意:走既有植被 InstancedMesh(自建 mesh 就是多幾個 draw call 畫同一棵樹)
      for (const [lx, lz, ls] of (CIVIC_TREES[c.kind] || [])) {
        const wx = c.x + lx * ca + lz * sa, wz = c.z - lx * sa + lz * ca;
        if (!dryAt(wx, wz)) continue;
        const ts = plotSeed(Math.round(wx), Math.round(wz), 1, 5);
        // 樹種走樣(2026-08-05):約三成換白樺 —— 同一座公園不再整排同款(落點雜湊,零 rnd)
        const sp = frac(ts, 5) < 0.3 ? 'birch' : 'broadleaf';
        // 園樹同樣吃互斥:淨空走廊/既有植被/圖資物件其一擋住就不種(全由雜湊推導,零 rnd)
        const tf = { x: wx, z: wz, r: (VEG_FOOT_R[sp] ?? 1) * ls * (VEG_SCALE[sp] || 1) };
        if (!areaFree(blocked, wx, wz, tf.r) || vegFootIndex.near(tf)) continue;
        vegFootIndex.add(tf);
        (items[sp] ??= []).push({
          x: wx, y: terrain.heightAt(wx, wz), z: wz, s: ls * (VEG_SCALE[sp] || 1),
          ry: frac(ts, 1) * Math.PI * 2,
          tx: (frac(ts, 2) - 0.5) * 0.06, tz: (frac(ts, 3) - 0.5) * 0.06, dj: frac(ts, 4),
        });
      }
      civics.push({ x: c.x, z: c.z, ry: c.ry, kind: c.kind, w: def.w, d: def.d });
    }
    if (res.plots.length || civics.length) {
      await onProgress?.(0.66, `沿街配置 ${res.plots.length} 棟、公設 ${civics.length} 處…`);
    }
  }

  // 市區補間:把被 8 倍世界撐開的街廓填回連續街區(隱蔽 + 走廊夾出戰略通道)。
  // 種子吃上面那份 `infillSeeds`(街廓配置**之前**就定案 + 過聚落場),MUST NOT 在此
  // 回頭讀 `generic` —— 那一份此刻已混進 planBlocks 剛配出來的臨街樓(見 infillSeeds 註解)。
  if (!osmSource && infillSeeds.length) {
    const n = densifyUrban({ seeds: infillSeeds, generic, blocked, terrain, rnd, inb, occ, roadFacing: nearestRoadAngle });
    if (n) await onProgress?.(0.68, `補間街廓建物(+${n} 棟)…`);
  }

  // 邊界帶視覺牆:放在補間之後(邊界樓不當補間種子)、植被過濾之前
  await onProgress?.(0.69, '築起邊界帶(樓群/神木/巨岩)…');
  // OSM 成功時建物／用地輪廓已是權威來源；邊界帶的程序樓群也必須停用，避免真實建物外
  // 再長出虛構街區。只有來源整體為 null 才由既有 fallback 產生。
  const boundaryN = osmSource ? 0 : placeBoundary({ terrain, items, generic, rnd, mix, occ, settlement, rings });

  // 建物腳印內/貼牆的植被拔除:植被先散布、建物(圖資/補間)後放且互不看對方,
  // 不濾掉就會樹冠穿屋頂、樹卡進牆面。只濾「錨點貼地」的實例 —— 神木上的
  // 鳥巢/樹屋/垂藤錨在樹身高處,不在此列(神木本體已進 blocked,建物不會壓上來)。
  // 判定用「旋轉矩形 + 樹冠半徑外擴」:圓測試(半對角 ×0.8)在長方形建物的
  // 長邊側面留縫、角落外凸,貼牆的樹會漏掉。
  if (generic.length || landmarks.length) {
    // 桶格 > 最大半對角 + 最大樹冠外擴 ~8,±1 格掃描必然涵蓋:建物 ~23(裙樓外擴後 ~32)、
    // 鋪面型公設 ~45(運動場 76×48)⇒ 53 < 64。改大公設尺寸 MUST 重算這一條。
    const C = 64;
    const rectG = new Map();
    for (const b of generic) {
      const k = `${Math.floor(b.x / C)},${Math.floor(b.z / C)}`;
      let a = rectG.get(k);
      if (!a) rectG.set(k, a = []);
      a.push(b);
    }
    // 全部獨立公設都要拔除既有植被；公園綠意由 CIVIC_TREES 與鋪面本身負責，避免園樹互穿。
    for (const c of civics) {
      const k = `${Math.floor(c.x / C)},${Math.floor(c.z / C)}`;
      let a = rectG.get(k);
      if (!a) rectG.set(k, a = []);
      a.push({ x: c.x, z: c.z, w: c.w, d: c.d, ry: c.ry, commercial: false });
    }
    const lmC = landmarks.map((lm) => [lm.x, lm.z, (LANDMARK_COL[lm.type]?.r || 10) * OVER.lm]);
    const hitsBld = (x, z, pad) => {
      // 精確 OSM footprint 直接保留 outer/holes；不以外接方盒拔除植被。
      if (osmBuildingFootprints.some((p) => pointInProjectedArea(x, z, p))) return true;
      const ci = Math.floor(x / C), cj = Math.floor(z / C);
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          const a = rectG.get(`${ci + i},${cj + j}`);
          if (!a) continue;
          for (const b of a) {
            const dx = x - b.x, dz = z - b.z;
            const ca = Math.cos(b.ry), sa = Math.sin(b.ry);
            // 世界 → 建物局部座標(densifyUrban 正轉的逆),含冠半徑外擴的矩形包含判定。
            // 佔地取「可能的最大輪廓」:商辦臨街裙樓 w×1.4 / d×1.28、住宅四坡屋簷 ×1.08
            // (輪廓件在後段 mesh 建置才擲骰決定,過濾當下不知道 → 一律按最大算,寧可多拔)
            const hw = b.w / 2 * (b.commercial ? 1.4 : 1.08);
            const hd = b.d / 2 * (b.commercial ? 1.28 : 1.08);
            if (Math.abs(dx * ca - dz * sa) < hw + pad
              && Math.abs(dx * sa + dz * ca) < hd + pad) return true;
          }
        }
      }
      for (const [lx, lz, lr] of lmC) if (Math.hypot(x - lx, z - lz) < lr + pad) return true;
      return false;
    };
    for (const type in items) {
      // 神木不濾:已進 blocked(建物 areaFree 會避開),且登記了碰撞柱,拔掉會留隱形牆
      if (GIANT_DEFS[type]) continue;
      const cr = VEG_FOOT_R[type] ?? 1;
      const kept = items[type].filter((it) =>
        Math.abs(it.y - terrain.heightAt(it.x, it.z)) > 4 || !hitsBld(it.x, it.z, cr * it.s));
      placed -= items[type].length - kept.length;
      items[type] = kept;
    }
  }

  await onProgress?.(0.7, '建置植被模型(Quaternius CC0)…');
  const nature = await naturePromise;
  for (const type in items) {
    const meshes = nature[type]
      ? buildVegMeshesGlb(nature[type], items[type])
      : buildVegMeshes(type, items[type], season);
    for (const m of meshes) group.add(m);
  }

  // 一般建物:住宅/商辦 × 七款立面樣式 InstancedMesh — 窗格立面貼圖
  // (白底 × 色盤 tint = 同貼圖多種外牆色)取代單一色塊;
  // 夜間亮窗走 emissiveMap(只有畫了燈的窗亮)。
  // 同時登記碰撞柱(blockers):限制玩家行動但不封鎖(走廊已淨空、可飛越屋頂)。
  const roofBoxes = [];    // 屋頂雜項(空調機組/機房):打破光禿平屋頂輪廓
  const roofTanks = [];    // 圓筒水塔
  const roofGables = [];   // 低層住宅四坡斜屋頂(彩色瓦)
  const roofPrisms = [];   // 低層住宅雙坡人字屋頂(第二剪影:山牆立面 + 鋸齒天際線;2026-08-05)
  const billboards = [];   // 商辦屋頂廣告看板(彩色 + 夜間發光)
  const antennas = [];     // 高樓天線
  const cornices = [];     // 平屋頂簷口帶(頂緣外挑一圈 = 手繪描邊感的輪廓層)
  const chimneys = [];     // 斜屋頂磚砌煙囪(BOTW 村屋剪影)
  const roofPanels = [];   // 太陽能板陣列(同向斜板一排)
  const roofPads = [];     // 屋頂花園綠地墊
  const roofBushes = [];   // 屋頂灌木/花盆植栽
  const roofTreeList = []; // 屋頂盆栽闊葉樹(盆 + 幹 + 冠)
  const cellMasts = [];    // 行動基地台桅桿
  const cellPanels = [];   // 基地台三向扇區天線
  const wallSigns = [];    // 牆面直式招牌:建物垂直面唯一允許的附著物(垂直長條、微凸牆面)
  // 挑中整棟量體節點的那幾棟的**剖面側面**(世界座標,由下而上)。`buildWorldSigns` ④ 的
  // lightbox 立面招牌吃它 —— 那一支只認得 OSM 方盒(`b.d / 2`),而節點在牌子的高度上
  // 可能只有方盒的兩成寬 ⇒ 牌子浮在半空(使用者 2026-08-12 回報)。
  const bldFaces = new Map();
  const bldStart = group.children.length;   // 碉堡淨空用:此後加入 group 的都是建物 InstancedMesh(供 clearAround 篩選)
  {
    const tint = new THREE.Color();
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
    const P = new THREE.Vector3(), S = new THREE.Vector3();
    // 全部一般建物都改吃通過零件台的正式 v5/v6 目錄；舊方盒只保留成目錄異常時的保險絲。
    // 選款只讀座標、足跡與目錄純資料，零共享 rnd() 消耗；重複目標已在目錄縫由 v6 勝出。
    const massPick = new Map();
    for (const b of generic) {
      const fit = fitApprovedBuilding(b);
      if (fit) massPick.set(b, fit);
    }
    /**
     * 挑中的那一棟依構造分類縮放:方盒構築貼合基地,非方盒構築只取單一比例(使用者這一輪第 ① 條的兌現點)。
     * 舊制直接拿 (w, h, d) 縮單位方盒,而節點只佔單位盒的一部分(實測 hw 0.13~0.42)——
     * 症狀是那幾棟塔樓縮在自己的空地中央、四周一圈看不見的碰撞盒。
     * 方盒貼合之後:最寬那一段恰好等於 OSM 足跡(⇒ 地面層的通行寬與舊制**逐位元相同**,
     * `audit_traverse` 不動);非方盒則以完整自然包絡的最小比例放入基地,碰撞同步收縮。
     * 上面的退縮階與山牆在兩種構造都保留各自的收窄形狀。
     * 縱向同理(節點收在 ±0.475 ⇒ 舊制的頂比 `b.h` 矮 5%,而屋頂附件掛在 `b.h` = §5ab-c
     * 那個「附件浮在半空」的成因本體)。
     */
    // 回傳的是**逐實例縮放**(節點局部軸;`M.compose` 是 T·R·S ⇒ S 吃的是局部軸)。
    // `rot` 把節點的局部 X 轉到基地的深度那一邊 ⇒ 兩軸的目標邊長跟著換手。
    // 非方盒構築的幾何已保留自然長寬高比，三軸只能取同一個最小比例，避免把圓頂、斜屋頂
    // 或多面體拉成不自然的形狀；方盒構築仍可依基地三軸貼合。
    const fitScale = (f, b) => {
      const p = f.prof;
      const sx = (f.rot ? b.d : b.w) * 0.5 / p.hw;
      const sy = b.h * 0.5 / p.hy;
      const sz = (f.rot ? b.w : b.d) * 0.5 / p.hd;
      if (f.proportional) {
        const s = Math.min(sx, sy, sz);
        return { sx: s, sy: s, sz: s };
      }
      return { sx, sy, sz };
    };
    /**
     * 剖面某一段的**建物座標**半跨與高度區間(碰撞柱與招牌落點同吃)。
     * 轉 90° 的那一顆只是把兩個半跨換手 —— 有向盒的 `ry` 因此一律維持 `b.ry`
     * (盒轉 90° ≡ 換手半跨,而碰撞柱不在意節點的正面朝哪一邊)。
     */
    const slabBox = (f, b, s, gy) => {
      const sc = fitScale(f, b);
      const ax = s[2] * sc.sx, az = s[3] * sc.sz;      // 節點局部 X / Z 兩軸的世界半跨
      return {
        hw2: f.rot ? az : ax, hd2: f.rot ? ax : az,
        y0: gy - 0.5 + (s[0] + f.prof.hy) * sc.sy, y1: gy - 0.5 + (s[1] + f.prof.hy) * sc.sy,
        // 第五欄 = 這一段真的有多少是「平整垂直牆」(名冊純資料;缺席 ⇒ 1 = 舊制照放行)
        wall: s.length > 4 ? s[4] : 1,
      };
    };
    /**
     * **招牌能掛在哪一面牆**(2026-08-12 使用者「招牌會懸空」+ 2026-08-13「只貼在垂直地面
     * 且**完全平整**的平面牆」的兌現點)。回傳的是剖面**某一段的側面**。
     *
     * 上一輪只挑「涵蓋這個高度的那一段」,理由是「剖面側面依構造就是垂直平整的矩形」——
     * 那句話對**盒**成立,對**盒裡面那塊網格**不成立:尖塔、山牆、退縮斜切面照樣落在
     * 某一段的側面上,牌子貼上去就是貼在一面斜屋頂前面的空氣裡。⇒ 這一輪改吃剖面的
     * 第五欄(那一段的平整垂直牆面積佔比,離線量、`intake_parts` 逐顆比對)。
     * 挑法:先取涵蓋這個高度的那一段;它不合格就**往下**找最近的合格段(招牌沿牆滑下來,
     * 這是真實街景的樣子);整棟都沒有合格段 ⇒ 回 null = **這一棟不掛牌**(原則 6)。
     * ⚠ 回 null 時呼叫端 MUST NOT 退回 `b.w/2`、`b.d/2` —— 那正是「掛在方盒側面的空氣裡」。
     * 方盒那條路(`f` 為 null)才是舊制那條:回 null 且呼叫端照舊用足跡(逐位元同舊制)。
     */
    /** 這一棟**掛得了牌**的那幾段(兩個招牌消費端同吃;各寫一次篩選就是兩套門檻) */
    const bldFaceList = (f, b, gy) =>
      f.prof.slabs.map((s) => slabBox(f, b, s, gy)).filter((k) => k.wall >= MASS.SIGN_FLAT_MIN);
    const bldFace = (f, b, gy, y) => {
      if (!f) return null;
      const okBox = bldFaceList(f, b, gy);
      if (!okBox.length) return null;
      return okBox.find((k) => y >= k.y0 && y <= k.y1)
        || [...okBox].reverse().find((k) => k.y1 <= y) || okBox[0];
    };
    const approvedBatches = new Map();
    for (const commercial of [false, true]) {
      const cat = commercial ? 'commercial' : 'residential';
      // 立面款一個外迴圈(款只管窗長什麼樣);**列數逐件**再分一次桶(見 facadeRows:
      // 退縮頂塔與臨街裙樓有自己的高度,吃主體的列數會壓出 0.6~1.8m 的層高)。
      // ⇒ draw call 由「款數」變成「款 × 該款實際出現過的列數」,仍與建物棟數無關
      //(常數級),而列數級距本身是有界的。
      for (let v = 0; v < FACADES[cat].length; v++) {
        const list = generic.filter((b) => b.commercial === commercial && facadeStyle(b) === v);
        if (!list.length) continue;
        const fd = FACADES[cat][v];
        // 逐列數的立面材質(貼圖本身有 `_facadeCache`;快取鍵 MUST 帶列數,
        // 少了它就是「第一次算出來的那個列數」被全場共用 = 這一整條改制沒有生效)
        const wallMat = new Map();
        // `band` = 要不要走三帶(整棟量體庫節點那幾棟才要;方盒走六材質群組,屋頂本來就
        // 是另一個材質 ⇒ 加帶只會浪費貼圖並讓窗格連同屋頂帶一起被採到)。
        // 貼圖快取鍵 MUST 帶這一位:同一款同一列數的「有帶 / 無帶」是兩張不同的圖。
        const wallOf = (rows, band = false) => {
          const mk = band ? `b${rows}` : rows;
          if (!wallMat.has(mk)) {
            const f = facadeTex(`${fd.key}r${rows}${band ? 'b' : ''}`, fd.cols, rows, fd.winC, fd.lit,
              fd.style, fd.wall, band ? fd.roof : 0, band ? 'flat' : '', band ? MASS.UVB.mass : null, fd.win);
            wallMat.set(mk, bmat(0xffffff, {
              map: f.map,
              emissiveMap: f.emissiveMap,
              emissive: new THREE.Color(night ? 0xffb45e : 0x000000),
              emissiveIntensity: night ? (commercial ? 0.9 : 0.55) : 0,
            }));
          }
          return wallMat.get(mk);
        };
        // 屋頂/底面用素色材質(色塊分離):窗格貼圖只留在四面牆,
        // 屋頂不再出現「躺平的窗」;instance tint 兩材質同吃 → 每棟仍有色差
        const roof = bmat(fd.roof, { wash: 0.5 });
        const pal = PALETTE[cat];
        // 先攤平成實例清單:主體 + 輪廓件(退縮頂塔/臨街裙樓)同吃立面貼圖與 tint,
        // 高層商辦成「婚禮蛋糕」剪影、街廓出裙樓 — 天際線擺脫單一長方體(botw_plan Task 1.1)
        const inst = [];
        list.forEach((b, i) => {
          // 佔地放大後坡地會露餡:取中心 + 四角最低點落底,寧可陷入山坡不懸空
          const ca = Math.cos(b.ry), sa = Math.sin(b.ry);
          let gy = terrain.heightAt(b.x, b.z);
          for (const [lx, lz] of [[b.w / 2, b.d / 2], [b.w / 2, -b.d / 2], [-b.w / 2, b.d / 2], [-b.w / 2, -b.d / 2]]) {
            gy = Math.min(gy, terrain.heightAt(b.x + lx * ca + lz * sa, b.z - lx * sa + lz * ca));
          }
          const palC = pal[((i * 2654435761) >>> 0) % pal.length];
          // 挑中整棟庫節點的那幾棟:**屋頂上的純視覺附件一律不掛** —— 節點自己帶著
          // 退縮頂塔與立面,再疊一頂程序頂塔或一塊看板就是「兩頂帽子」。
          // **MUST 只換「推去哪裡」,rnd() 照抽**(同 synthMegalith 整座型分支:庫節點只換
          // add 進場景,枚數有無零件庫逐位元相同,§2.3 / A4)。
          // 帶碰撞柱的兩件(主量體、臨街裙樓)**MUST NOT 進丟棄桶** —— 少掛一根碰撞柱
          // 會讓「載到庫的客戶端」與「沒載到的」權威幾何分家(A30 + §2.3)。
          // ⚠ 牆面直式招牌**不再**進丟棄桶(2026-08-12):它當初被丟掉的理由是「掛在方盒
          //   側面而節點比方盒瘦 ⇒ 浮在半空」,而這一輪招牌改吃剖面 ⇒ 掛的是那個高度**真的
          //   存在**的那一段的牆面。丟掉它等於「最顯眼的十幾棟樓一塊招牌都沒有」。
          const fit = massPick.get(b) || null;
          const sink = [];
          const vis = (arr) => (fit ? sink : arr);
          // `lib` 只掛在**主量體**這一列(退縮頂塔/裙樓/梯間塔仍走方盒:它們是主體的
          // 附加輪廓件,整棟節點本身已經帶著自己的頂部造型,兩者疊起來會長出第二頂帽子)
          // 縮放:方盒可走 (w,h,d);非方盒由 `fitScale` 取單一比例(保留自然形狀)
          const fsc = fit ? fitScale(fit, b) : null;
          const renderH = fsc ? fsc.sy : b.h;
          inst.push({
            x: b.x, y: gy + renderH / 2 - 0.5, z: b.z,
            ry: b.ry + (fit?.rot ? Math.PI / 2 : 0),
            w: fsc ? fsc.sx : b.w, h: fsc ? fsc.sy : b.h, d: fsc ? fsc.sz : b.d,
            bh: b.h,                                   // 真樓高(縮放係數 ≠ 樓高;列數吃這個)
            c: palC, lib: fit,
          });
          // r = 圓柱近似(投影彈道 _blockerHitT 用,A6 刻意保留);hw2/hd2/ry = 真實盒面(_collide/_cameraDeClip
          // 用有向盒,免玩家/鏡頭斜向鑽進盒角破圖 —— 內切圓柱 r=0.8×盒角 < 盒角實體)
          // ty = **可見**盒頂(= 上面 inst 那一項的頂面,推導不手寫):碰撞柱刻意比實體高 0.5m
          // (站上屋頂才不會被 _collide 的垂直閘推下去),攀爬設施改吃 ty 貼齊屋頂(climb.js facilityEndY)
          //
          // **挑中庫節點的那幾棟改登記剖面**(2026-08-12;使用者「物理碰撞應該要與建模的
          // 3D 外表一致」)—— 一段一根有向盒,三端(客戶端 `_collide`/`_blockerHitT`、
          // 伺服器 occ)一行都不用改(A30 只認有向盒與圓柱)。三條:
          //   ㋐ 方盒地面段恆等於整個足跡;非方盒則與自然包絡同縮放,不另造一圈看不見的盒。
          //      因此方盒街廓通行寬與舊制逐位元相同(`audit_traverse` 不動),非方盒的通行寬
          //      跟著可見幾何保守收縮,收窄的只有上面的退縮階與山牆。
          //   ㋑ 每一段各帶自己的 `ty` ⇒ 退縮平台**站得上去**(`blockerTopAt` 取含入者的最高頂)。
          //   ㋒ 每一段的 `h` 一律比可見頂高 0.5m(與舊制同一條:站上屋頂不被垂直閘推下去)。
          const cols = fit
            ? fit.prof.slabs.map((s, si) => {
              const bx = slabBox(fit, b, s, gy);
              const bot = si === 0 ? gy - 1 : bx.y0;           // 最底那一段照舊沉進地形 1m
              return { x: b.x, z: b.z, y: bot, r: Math.hypot(bx.hw2 * 2, bx.hd2 * 2) / 2 * 0.8,
                h: bx.y1 + 0.5 - bot, bld: 1, cl: 'bld', hw2: bx.hw2, hd2: bx.hd2, ry: b.ry, ty: bx.y1 };
            })
            : [{ x: b.x, z: b.z, y: gy - 1, r: Math.hypot(b.w, b.d) / 2 * 0.8, h: b.h + 1, bld: 1, cl: 'bld',
              hw2: b.w / 2, hd2: b.d / 2, ry: b.ry, ty: gy + b.h - 0.5 }];
          for (const c of cols) blockers.push(c);
          // 招牌那一份**只收合格的段**(2026-08-13);空陣列 = 這一棟一段都不合格,
          // 而它與「這是方盒建物」是兩件事 ⇒ 消費端判的是 `bldFaces.has(b)` 不是長度
          if (fit) bldFaces.set(b, bldFaceList(fit, b, gy));
          // 局部 → 世界(依建物朝向 ry 旋轉)
          const toW = (ox, oz) => [b.x + ox * ca + oz * sa, b.z - ox * sa + oz * ca];
          let crownTop = b.h;   // 天線/告示的落點(退縮頂塔時改放塔頂)
          let crownX = b.x, crownZ = b.z;
          const storeyTarget = commercial ? STOREY.commercial : STOREY.residential;
          const mainFloors = Math.max(1, Math.round(b.h / storeyTarget));
          const floorH = b.h / mainFloors;

          if (commercial && b.h > 55 && rnd() < 0.6) {          // 退縮頂塔(夠高可再疊一階)
            // 頂塔偏心退縮(不再置中)= 婚禮蛋糕改成 BOTW 遺跡式不對稱剪影
            const tw = b.w * 0.62, td = b.d * 0.62;
            const rawTh = b.h * 0.22;
            const thFloors = Math.max(1, Math.round(rawTh / floorH));
            const th = thFloors * floorH;
            const ox = (rnd() - 0.5) * (b.w - tw) * 0.8, oz = (rnd() - 0.5) * (b.d - td) * 0.8;
            [crownX, crownZ] = toW(ox, oz);
            vis(inst).push({ x: crownX, y: gy + crownTop + th / 2 - 0.5, z: crownZ, ry: b.ry, w: tw, h: th, d: td, c: palC, rows: thFloors });
            crownTop += th;
            if (b.h > 100 && rnd() < 0.55) {
              const rawT2 = th * 0.7;
              const t2Floors = Math.max(1, Math.round(rawT2 / floorH));
              const t2 = t2Floors * floorH;
              vis(inst).push({ x: crownX, y: gy + crownTop + t2 / 2 - 0.5, z: crownZ, ry: b.ry, w: tw * 0.62, h: t2, d: td * 0.62, c: palC, rows: t2Floors });
              crownTop += t2;
            }
          }
          if (commercial && rnd() < 0.4) {                      // 臨街裙樓
            const rawPh = Math.max(6, b.h * 0.12);
            const phFloors = Math.max(2, Math.round(rawPh / floorH));
            const ph = phFloors * floorH;
            inst.push({ x: b.x, y: gy + ph / 2 - 0.5, z: b.z, ry: b.ry, w: b.w * 1.4, h: ph, d: b.d * 1.28, c: palC, rows: phFloors });
            // 裙樓比主體寬(1.4×1.28)且齊眼高 —— 另登記自己的碰撞盒(基座段),否則玩家/鏡頭鑽進裙樓看穿牆
            blockers.push({ x: b.x, z: b.z, y: gy - 1, h: ph + 1, bld: 1, cl: 'bld', hw2: b.w * 0.7, hd2: b.d * 0.64, ry: b.ry, r: Math.hypot(b.w * 1.4, b.d * 1.28) / 2 * 0.8, ty: gy + ph - 0.5 });
          }
          if (!commercial && b.h >= 14 && rnd() < 0.4) {        // 中層住宅:角落梯間塔(佔地內、突出屋頂)
            const tw = Math.min(b.w, b.d) * 0.3;
            const [tx, tz] = toW((b.w / 2 - tw / 2) * (rnd() < 0.5 ? 1 : -1),
                                 (b.d / 2 - tw / 2) * (rnd() < 0.5 ? 1 : -1));
            const rawTh = b.h * (1.1 + rnd() * 0.1);
            const stairFloors = Math.max(mainFloors + 1, Math.round(rawTh / floorH));
            const th = stairFloors * floorH;
            inst.push({ x: tx, y: gy + th / 2 - 0.5, z: tz, ry: b.ry, w: tw, h: th, d: tw, c: palC, rows: stairFloors });
          }
          let gable = false;
          // 低層住宅斜屋頂:同一枚亂數三分 —— 人字雙坡(第二剪影;sakura-crossing「一排錐是
          // 扇貝邊,人字的山牆才給天際線鋸齒」)/ 四坡錐頂 / 落到平頂。亂數消耗序與舊制
          // 逐位元相同(rv 一枚 + 各分支原有枚數),只有 rv < 0.32 那些棟換了屋頂形式。
          const rv = (!commercial && b.h < 30) ? rnd() : null;
          if (rv != null && rv < 0.65) {
            gable = true;
            const rh = 2.5 + rnd() * 3;
            // 人字屋頂:脊沿較長那一軸(短軸當脊 = 屋頂比立面還窄,讀成戴錯帽子)
            vis(rv < 0.32 ? roofPrisms : roofGables).push(rv < 0.32
              ? { x: b.x, z: b.z, y: gy + b.h - 0.5, ry: b.ry + (b.w >= b.d ? 0 : Math.PI / 2),
                  w: Math.max(b.w, b.d) * 1.08, d: Math.min(b.w, b.d) * 1.08, h: rh }
              : { x: b.x, z: b.z, y: gy + b.h - 0.5, ry: b.ry, w: b.w, d: b.d, h: rh });
            if (rnd() < 0.55) {                                 // 磚煙囪:根植屋頂平面、貫穿斜屋面冒出
              const [cxw, czw] = toW((rnd() - 0.5) * b.w * 0.3, (rnd() - 0.5) * b.d * 0.2);
              // 從簷口面起算、高過該點屋面(≤0.85rh)→ 永不懸空,也必露頭
              vis(chimneys).push({ x: cxw, z: czw, y: gy + b.h - 0.5, ry: b.ry, w: 0.9 + rnd() * 0.5, h: rh * 0.85 + 1.2 + rnd() * 1.0 });
            }
          } else if (rnd() < 0.5) {                             // 平屋頂:頂緣簷口外挑帶
            vis(cornices).push({ x: b.x, z: b.z, y: gy + b.h - 0.5, ry: b.ry, w: b.w * 1.07, d: b.d * 1.07, c: fd.roof });
          }
          // 屋頂配件(斜屋頂棟跳過):機房/水塔照舊,擴充太陽能板陣列/屋頂花園
          // (綠地墊 + 灌木花盆 + 盆栽闊葉樹)/行動基地台。屋頂是唯一允許的附著面
          // —— 建物垂直牆面 MUST NOT 掛任何配件(樹木/電塔不附牆)
          const rr = rnd();
          if (!gable && rr < 0.9) {
            const ox = (rnd() - 0.5) * b.w * 0.4, oz = (rnd() - 0.5) * b.d * 0.4;
            const [wx, wz] = toW(ox, oz);
            const topY = gy + b.h - 0.5;
            if (rr < 0.2) {
              vis(roofBoxes).push({
                x: wx, z: wz, y: topY, ry: b.ry,
                w: 1.6 + rnd() * b.w * 0.12, h: 1.4 + rnd() * 2.4, d: 1.6 + rnd() * b.d * 0.12,
              });
            } else if (rr < 0.36) {
              vis(roofTanks).push({ x: wx, z: wz, y: topY, r: 1.1 + rnd() * 1.3, h: 2.4 + rnd() * 2.2 });
            } else if (rr < 0.58) {
              // 太陽能板:沿建物軸向一排同向斜板(排長受屋頂寬度夾限)
              const nP = Math.max(1, Math.min(2 + Math.floor(rnd() * 3), Math.floor(b.w * 0.8 / 3.2)));
              for (let p = 0; p < nP; p++) {
                const [px2, pz2] = toW(ox * 0.4 + (p - (nP - 1) / 2) * 3.2, oz);
                vis(roofPanels).push({ x: px2, z: pz2, y: topY, ry: b.ry });
              }
            } else if (rr < 0.72 && Math.min(b.w, b.d) > 11) {
              // 屋頂花園:綠地墊 + 灌木簇 + (六成)一株盆栽闊葉樹
              vis(roofPads).push({ x: wx, z: wz, y: topY, ry: b.ry, w: b.w * 0.45, d: b.d * 0.4 });
              const nB = 2 + Math.floor(rnd() * 2);
              for (let p = 0; p < nB; p++) {
                const [bx2, bz2] = toW(ox + (rnd() - 0.5) * b.w * 0.3, oz + (rnd() - 0.5) * b.d * 0.26);
                vis(roofBushes).push({ x: bx2, z: bz2, y: topY + 0.3, s: 0.7 + rnd() * 0.6 });
              }
              if (rnd() < 0.6) vis(roofTreeList).push({ x: wx, z: wz, y: topY + 0.3, s: 0.9 + rnd() * 0.5 });
            } else if (rr < 0.82) {
              // 行動基地台:桅桿 + 頂端三向扇區天線
              const mh = 4.5 + rnd() * 2.5;
              vis(cellMasts).push({ x: wx, z: wz, y: topY, h: mh });
              for (let p = 0; p < 3; p++) {
                vis(cellPanels).push({ x: wx, z: wz, y: topY + mh - 1.0, ry: b.ry + p * (Math.PI * 2 / 3) });
              }
            } else {
              // 單簇花盆灌木(小屋頂也放得下)
              vis(roofBushes).push({ x: wx, z: wz, y: topY, s: 0.7 + rnd() * 0.6 });
            }
            // 大平頂第二件配件(2026-08-05;sakura-crossing「獨立地面掃描」的屋頂版):
            // 面積夠大的屋頂只放一件會顯空。位置雜湊決定(零共享 rnd,§2.3 —— 既有佈局
            // 逐位元不動),落在第一件的對角象限,永不與第一件重疊。
            if (Math.min(b.w, b.d) > 15) {
              const h2 = djAt(b.x + 31.7, b.z - 17.3);
              if (h2 < 0.55) {
                const [w2x, w2z] = toW(-ox, -oz);
                if (h2 < 0.22) vis(roofTanks).push({ x: w2x, z: w2z, y: topY, r: 0.9 + h2 * 2.2, h: 2.2 + h2 * 4 });
                else vis(roofBoxes).push({ x: w2x, z: w2z, y: topY, ry: b.ry, w: 1.4 + h2 * 2, h: 1.2 + h2 * 2.4, d: 1.4 + h2 * 2 });
              }
            }
          }
          if (commercial && b.h > 40 && crownTop === b.h && rnd() < 0.5) {   // 頂塔棟看板會插進塔身 → 跳過
            // 看板長寬比 MUST 由圖集儲存格推導(signAspect):牌面比例與貼圖比例不合不會報錯,
            // 只會把上面的字橫向壓成一條糊帶(A37)。舊制 h 是獨立亂數 ⇒ 比例逐塊亂跑。
            const bw = Math.min(b.w * 0.7, 10) * (0.8 + rnd() * 0.2);
            vis(billboards).push({ x: b.x, z: b.z, y: gy + b.h - 0.5, ry: b.ry, w: bw, h: bw / signAspect('billboard') });
          }
          if ((commercial || fd.style === 'shop') && b.h > 14 && rnd() < 0.35) {
            // 直式招牌:亞洲街景的垂直長條招牌,掛在牆面微凸 0.4m
            // 高度吃樓高、寬度由長寬比反推(同上:比例是硬約束,不是兩個各自的亂數)
            const sh0 = Math.min(14, renderH * (0.45 + rnd() * 0.2));
            const face = Math.floor(rnd() * 4);              // 0:+x 1:−x 2:+z 3:−z
            const alongW = face < 2;
            const roff = rnd() - 0.5;
            // 掛牌的那一面:方盒吃整個足跡;庫節點吃**這個高度真的存在的那一段**的側面
            // (舊制掛在方盒側面,而節點在那個高度只有方盒的 0.2 倍寬 ⇒ 牌子浮在半空,
            //  §5ab-c 當時的處理是整批不掛 —— 那是繞過去不是修好)。
            const sy = gy + renderH * 0.55 - 0.5;
            const fw = bldFace(fit, b, gy, sy);
            const hwF = fw ? fw.hw2 : b.w / 2, hdF = fw ? fw.hd2 : b.d / 2;
            const off = roff * (alongW ? hdF : hwF) * 1.0;
            const [sx2, sz2] = alongW
              ? toW((face === 0 ? 1 : -1) * (hwF + 0.4), off)
              : toW(off, (face === 2 ? 1 : -1) * (hdF + 0.4));
            // **這棟已經有名字就讓給 worldtext**(2026-08-03 合併 main 的世界文字):
            // `buildWorldSigns` ④ 給每一棟有 `name` 的商業建物掛一塊 lightbox 立面招牌,
            // 而這裡挑的是同一批建物 ⇒ 不擋掉就是同一棟樓掛兩塊牌、而且寫**兩個不同的名字**
            // (worldtext 寫圖資原名、本支寫語料庫挑的店名)。判定走 `resolveName` 同一支
            // 縫,MUST NOT 自己再判一次「這棟有沒有名字」。
            // 淘汰檢查排在四次抽樣**之後** ⇒ 亂數序列不因這條而漂(§2.3)。
            // 這裡 MUST 是 `if` 不是 `return` —— 外層是 `list.forEach`,`return` 會**連同底下
            // 的天線一起跳掉**(改到的是別的系統,而畫面上只表現成「高樓的天線變少了」)。
            // 庫節點那幾棟挑不到**平整垂直**的段 ⇒ 這一棟不掛牌(2026-08-13;`bldFace` 檔頭)。
            // 判的是 `fit && !fw` 而不是 `!fw` —— 方盒那條路本來就回 null 而它的側面就是平牆。
            if (!resolveName(b.tags) && !(fit && !fw)) {
              // 牌高再收在那一段的高度內(剖面上半段只有幾公尺高時,14m 的長條會戳出去);
              // 牌寬 MUST 由 `signAspect` 反推 —— 高一改寬就要跟著,否則牌面比例與貼圖不合,
              // 字會被橫向壓成一條糊帶(A37 ⑤)
              const sh = fw ? Math.min(sh0, (fw.y1 - fw.y0) * 0.9) : sh0;
              wallSigns.push({
                x: sx2, z: sz2, y: sy,
                ry: b.ry + (alongW ? 0 : Math.PI / 2),
                w: sh * signAspect('wallsign'), h: sh,
              });
            }
          }
          if (commercial && b.h > 60 && rnd() < 0.6) {
            vis(antennas).push({ x: crownX, z: crownZ, y: gy + crownTop - 0.5, h: 5 + rnd() * 7 });   // 偏心頂塔時跟著塔頂
          }
        });
        // 色抖的雜湊吃**這一列在 inst 裡的原始序**:下面會把挑中整棟節點的那幾列拆去
        // 另一個 mesh,拿拆完後的新索引去雜湊會讓其餘每一棟的色相都跟著平移(沒有錯誤
        // 訊息,只表現成「這張圖的街廓配色跟上次不一樣」)。名冊空著時 ord === 索引 ⇒
        // 逐位元同舊制。
        inst.forEach((t, i) => { t.ord = i; });
        // 一組實例 → 一個 InstancedMesh(幾何/材質由呼叫端給,其餘逐位元照舊)
        const emitMass = (rows, mesh) => {
          rows.forEach((t, i) => {
            E.set(0, t.ry, 0); Q.setFromEuler(E);
            P.set(t.x, t.y, t.z);
            S.set(t.w, t.h, t.d);
            M.compose(P, Q, S);
            mesh.setMatrixAt(i, M);
            // 色盤之上先疊**街區色相家族**(同街區同家族、跨街區換家族,見 blockTone 檔頭),
            // 再疊每實例色相/明度微抖:同色相鄰棟不再完全同色(水彩手感)
            const bt = blockTone(t.x, t.z);
            const jh = ((t.ord * 2654435761) >>> 0) % 100 / 100;
            const jl = ((t.ord * 1597334677) >>> 0) % 100 / 100;
            tint.setHex(t.c).offsetHSL(bt.dh + (jh - 0.5) * 0.03, bt.ds, bt.dl + (jl - 0.5) * 0.1);
            mesh.setColorAt(i, tint);
          });
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          mesh.frustumCulled = false;
          group.add(mesh);
        };
        // 整棟量體庫節點:挑中的那幾棟幾何與方盒不同 ⇒ 只能另開 mesh。
        // **哪一顆節點在 `fitNode` 就定案了**(2026-08-12):那裡是依「拉伸最小」挑的,
        // 而拉伸倍率正是 `fitScale` 與碰撞剖面吃的東西 ⇒ 這裡再依位置雜湊挑一次就是
        // 「畫的是 A、撞的是 B」。庫沒載到 ⇒ `buildBldBucket.mass` 退回**同一份剖面**疊的
        // 保險絲幾何(不是落回方盒桶):碰撞柱已經是剖面,落回方盒會讓看到的與撞到的分家。
        // **列數逐件取**(`t.h` 是這一件自己的高度:主量體 / 退縮頂塔 / 臨街裙樓各不相同;
        // 庫節點那一列的 `t.h` 是**縮放係數**不是樓高 ⇒ 另存 `bh` 供列數用)
        const rowsOf = (t) => t.rows ?? facadeRows(t.bh ?? t.h, commercial);
        const boxRows = new Map(), libRows = new Map();
        for (const t of inst) {
          if (!t.lib) {
            const rw = rowsOf(t);
            if (!boxRows.has(rw)) boxRows.set(rw, []);
            boxRows.get(rw).push(t);
            continue;
          }
          const bk = t.lib.entry.key;
          if (!libRows.has(bk)) libRows.set(bk, { entry: t.lib.entry, rows: [] });
          libRows.get(bk).rows.push(t);
        }
        // BoxGeometry 群組順序 +x,-x,+y,-y,+z,-z
        for (const [rw, rs] of boxRows) {
          const wall = wallOf(rw);
          emitMass(rs, new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
            [wall, wall, roof, roof, wall, wall], rs.length));
        }
        // 同一正式模型跨住宅/商辦/立面款先彙總，最後每款只發一顆 InstancedMesh。
        for (const { entry, rows } of libRows.values()) {
          if (!approvedBatches.has(entry.key)) approvedBatches.set(entry.key, { entry, rows: [] });
          approvedBatches.get(entry.key).rows.push(...rows);
        }
      }
    }
    for (const { entry, rows } of approvedBatches.values()) group.add(makeApprovedBuildingBatch(entry, rows));
    if (cornices.length) {
      // 簷口帶:比主體大一圈的薄板,tint = 該立面款的屋頂色(與屋頂同系 = 頂緣描一筆深色)
      const cm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bmat(0xffffff, { wash: 0.5 }), cornices.length);
      cornices.forEach((c, i) => {
        E.set(0, c.ry, 0); Q.setFromEuler(E);
        P.set(c.x, c.y + 0.45, c.z);
        S.set(c.w, 0.9, c.d);
        M.compose(P, Q, S);
        cm.setMatrixAt(i, M);
        tint.setHex(c.c);
        cm.setColorAt(i, tint);
      });
      cm.instanceMatrix.needsUpdate = true;
      if (cm.instanceColor) cm.instanceColor.needsUpdate = true;
      cm.frustumCulled = false;
      group.add(cm);
    }
    if (chimneys.length) {
      const hm = buildBldBucket.chimney(chimneys.length);
      chimneys.forEach((c, i) => {
        E.set(0, c.ry, 0); Q.setFromEuler(E);
        P.set(c.x, c.y + c.h / 2, c.z);
        S.set(c.w, c.h, c.w);
        M.compose(P, Q, S);
        hm.setMatrixAt(i, M);
      });
      hm.instanceMatrix.needsUpdate = true;
      hm.frustumCulled = false;
      group.add(hm);
    }
    if (roofPanels.length) {
      // 斜置光電板(傾角烤進幾何,實例只轉 ry):深藍面板 + 微高光
      const pgeo = new THREE.BoxGeometry(2.8, 0.12, 1.8);
      pgeo.rotateX(-0.3);
      pgeo.translate(0, 0.6, 0);
      const pm2 = new THREE.InstancedMesh(pgeo, bmat(0x27435f), roofPanels.length);
      roofPanels.forEach((p, i) => {
        E.set(0, p.ry, 0); Q.setFromEuler(E);
        P.set(p.x, p.y, p.z); S.set(1, 1, 1);
        M.compose(P, Q, S);
        pm2.setMatrixAt(i, M);
      });
      pm2.instanceMatrix.needsUpdate = true;
      pm2.frustumCulled = false;
      group.add(pm2);
    }
    if (roofPads.length) {
      const gm2 = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.3, 1), toonMat(0x4f7a3c), roofPads.length);
      roofPads.forEach((p, i) => {
        E.set(0, p.ry, 0); Q.setFromEuler(E);
        P.set(p.x, p.y + 0.15, p.z); S.set(p.w, 1, p.d);
        M.compose(P, Q, S);
        gm2.setMatrixAt(i, M);
      });
      gm2.instanceMatrix.needsUpdate = true;
      gm2.frustumCulled = false;
      group.add(gm2);
    }
    if (roofBushes.length) {
      const bm2 = new THREE.InstancedMesh(ico(0.8), toonMat(0x4f8a44), roofBushes.length);
      roofBushes.forEach((p, i) => {
        P.set(p.x, p.y + 0.55 * p.s, p.z); S.set(p.s, p.s * 0.72, p.s);
        M.compose(P, new THREE.Quaternion(), S);
        bm2.setMatrixAt(i, M);
        const j1 = ((i * 2654435761) >>> 0) % 100 / 100;
        tint.setRGB(0.8 + j1 * 0.35, 0.85 + ((i * 1597334677) >>> 0) % 100 / 100 * 0.3, 0.8);
        bm2.setColorAt(i, tint);
      });
      bm2.instanceMatrix.needsUpdate = true;
      if (bm2.instanceColor) bm2.instanceColor.needsUpdate = true;
      bm2.frustumCulled = false;
      group.add(bm2);
    }
    if (roofTreeList.length) {
      // 盆栽闊葉樹:盆 + 幹 + 冠(三個 InstancedMesh)
      const potM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 0.7, 0.6, 7), bmat(0x8a6a52), roofTreeList.length);
      const trkM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.18, 1.8, 5), toonMat(0x6b4a30), roofTreeList.length);
      const cnpM = new THREE.InstancedMesh(ico(1.1), toonMat(0x4f8a44), roofTreeList.length);
      roofTreeList.forEach((p, i) => {
        P.set(p.x, p.y + 0.3 * p.s, p.z); S.set(p.s, p.s, p.s);
        M.compose(P, new THREE.Quaternion(), S); potM.setMatrixAt(i, M);
        P.set(p.x, p.y + 1.4 * p.s, p.z);
        M.compose(P, new THREE.Quaternion(), S); trkM.setMatrixAt(i, M);
        P.set(p.x, p.y + 2.9 * p.s, p.z); S.set(p.s * 1.25, p.s * 0.95, p.s * 1.25);
        M.compose(P, new THREE.Quaternion(), S); cnpM.setMatrixAt(i, M);
      });
      for (const m2 of [potM, trkM, cnpM]) {
        m2.instanceMatrix.needsUpdate = true;
        m2.frustumCulled = false;
        group.add(m2);
      }
    }
    if (cellMasts.length) {
      const mm2 = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.16, 1, 6), toonMat(0xc4ccd2), cellMasts.length);
      cellMasts.forEach((p, i) => {
        P.set(p.x, p.y + p.h / 2, p.z); S.set(1, p.h, 1);
        M.compose(P, new THREE.Quaternion(), S);
        mm2.setMatrixAt(i, M);
      });
      mm2.instanceMatrix.needsUpdate = true;
      mm2.frustumCulled = false;
      group.add(mm2);
    }
    if (cellPanels.length) {
      // 扇區天線:窄立板自桿心外推(偏移烤進幾何,實例只轉 ry)
      const cgeo = new THREE.BoxGeometry(0.5, 1.2, 0.16);
      cgeo.translate(0, 0, 0.5);
      const cm2 = new THREE.InstancedMesh(cgeo, bmat(0xdfe4e8), cellPanels.length);
      cellPanels.forEach((p, i) => {
        E.set(0, p.ry, 0); Q.setFromEuler(E);
        P.set(p.x, p.y, p.z); S.set(1, 1, 1);
        M.compose(P, Q, S);
        cm2.setMatrixAt(i, M);
      });
      cm2.instanceMatrix.needsUpdate = true;
      cm2.frustumCulled = false;
      group.add(cm2);
    }
    // 直式招牌的**牌面**已改由 worldtext.js 的單一文字圖層畫(buildWorldSigns ⑤)——
    // 這裡只把牆面落點算進 wallSigns。舊制在這裡另建一個 InstancedMesh + 自己的圖集,
    // 那就是第二套文字圖層(原則 2)。
    if (roofBoxes.length) {
      const rm = buildBldBucket.acbox(roofBoxes.length);
      roofBoxes.forEach((b, i) => {
        E.set(0, b.ry, 0); Q.setFromEuler(E);
        P.set(b.x, b.y + b.h / 2, b.z);
        S.set(b.w, b.h, b.d);
        M.compose(P, Q, S);
        rm.setMatrixAt(i, M);
      });
      rm.instanceMatrix.needsUpdate = true;
      rm.frustumCulled = false;
      group.add(rm);
    }
    if (roofTanks.length) {
      const tm = buildBldBucket.tank(roofTanks.length);
      roofTanks.forEach((t, i) => {
        P.set(t.x, t.y + t.h / 2, t.z);
        S.set(t.r, t.h, t.r);
        M.compose(P, new THREE.Quaternion(), S);
        tm.setMatrixAt(i, M);
      });
      tm.instanceMatrix.needsUpdate = true;
      tm.frustumCulled = false;
      group.add(tm);
    }
    if (roofGables.length) {
      // 單位四角錐(底面 1×1 貼齊屋頂),instance tint 上瓦色
      const geo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4);
      geo.rotateY(Math.PI / 4);
      geo.translate(0, 0.5, 0);
      const gm = new THREE.InstancedMesh(geo, bmat(0xffffff, { wash: 0.5 }), roofGables.length);
      roofGables.forEach((r, i) => {
        E.set(0, r.ry, 0); Q.setFromEuler(E);
        P.set(r.x, r.y, r.z);
        S.set(r.w * 1.08, r.h, r.d * 1.08);
        M.compose(P, Q, S);
        gm.setMatrixAt(i, M);
        gm.setColorAt(i, roofTint(tint, r.x, r.z, i));
      });
      gm.instanceMatrix.needsUpdate = true;
      if (gm.instanceColor) gm.instanceColor.needsUpdate = true;
      gm.frustumCulled = false;
      group.add(gm);
    }
    if (roofPrisms.length) {
      // 雙坡人字屋頂(2026-08-05;sakura-crossing「第二剪影形式」):與四坡錐頂並列的
      // 第二種屋頂構造 —— 一排錐是扇貝邊,人字的山牆三角才給天際線鋸齒與立面體積。
      // 單位幾何:脊沿 x、簷在 y=0、山牆兩片垂直三角(非索引 ⇒ computeVertexNormals = 平面著色)。
      const pv = [
        // −z 坡(A R1 R2 / A R2 B)
        -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0, -0.5, 0, -0.5, 0.5, 1, 0, 0.5, 0, -0.5,
        // +z 坡(D R2 R1 / D C R2)
        -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0, -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0,
        // 山牆 −x(A D R1)/ +x(C B R2)
        -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0,
        // 底面(簷口外挑露出的天花)
        -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5,
      ];
      const pgeo = new THREE.BufferGeometry();
      pgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pv), 3));
      pgeo.computeVertexNormals();
      const pm3 = new THREE.InstancedMesh(pgeo, bmat(0xffffff, { wash: 0.5 }), roofPrisms.length);
      roofPrisms.forEach((r, i) => {
        E.set(0, r.ry, 0); Q.setFromEuler(E);
        P.set(r.x, r.y, r.z);
        S.set(r.w, r.h, r.d);   // 收錄時已含 1.08 簷口外挑與長軸判向
        M.compose(P, Q, S);
        pm3.setMatrixAt(i, M);
        pm3.setColorAt(i, roofTint(tint, r.x, r.z, i));
      });
      pm3.instanceMatrix.needsUpdate = true;
      if (pm3.instanceColor) pm3.instanceColor.needsUpdate = true;
      pm3.frustumCulled = false;
      group.add(pm3);
    }
    // 屋頂廣告看板同上:牌面走 worldtext(buildWorldSigns ⑥),這裡只留落點。
    if (antennas.length) {
      const am = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.12, 0.28, 1, 6),
        toonMat(0xc4ccd2, { emissive: new THREE.Color(0x8a1408), emissiveIntensity: night ? 1.2 : 0.15 }),
        antennas.length,
      );
      antennas.forEach((a, i) => {
        P.set(a.x, a.y + a.h / 2, a.z);
        S.set(1, a.h, 1);
        M.compose(P, new THREE.Quaternion(), S);
        am.setMatrixAt(i, M);
      });
      am.instanceMatrix.needsUpdate = true;
      am.frustumCulled = false;
      group.add(am);
    }
  }
  const bldMeshes = group.children.slice(bldStart);   // 建物實例(不含之後的地標/植被/道路),供 clearAround 篩選
  const landmarkG = [];                               // 地標群組 + 佔地半徑(clearAround 一併隱藏整棟)
  // 特殊地標(超尺度 + 碰撞柱)
  await onProgress?.(0.85, '放置地標建物…');
  for (const lm of landmarks) {
    const g = new THREE.Group();
    // 第三參數 = 這一座地標該掛哪一國的旗(依落點的戰場半邊;makeNationPicker)。
    // 不掛旗的型別忽略它 ⇒ 逐位元同舊制。**rnd 仍是第二參數且照抽**(§2.3)。
    LANDMARKS[lm.type](g, rnd, nation(lm.x, lm.z));   // rnd → 同型地標逐座變化(塔高/層數/徽色)
    bakeContactAO(g, 3);   // 接地 AO 頂點色:地標與地面接縫處手繪暗角(botw_plan Task 2.2)
    let sc = OVER.lm * (0.9 + rnd() * 0.25);
    // 物件高度上限(`WORLD_H.OBJ_F` 倍砲塔高)。標稱高 MUST **實測**而不是讀
    // `LANDMARK_COL[].h` —— 那一欄是手寫的**擋彈**高度,對細長尖頂/天線/煙囪常低報數公尺
    //(同一族病灶已在 `ty` 屋頂實測那段記過一次)⇒ 拿它當分母會讓那幾座地標的真正頂端
    // 越過上限,而碰撞柱卻乖乖收在上限之下 = 看得到的尖頂打不到。此時 g 尚未 scale/rotate
    // ⇒ 世界軸 = 局部軸,量到的就是 s = 1 的標稱高。
    sc = objScaleFit(sc, new THREE.Box3().setFromObject(g).max.y, OVER.lm * 1.15);
    // 山丘頂容不下就縮(同巨岩);地標縮太小不像公共建築 → 下限 0.55×
    const lr0 = (LANDMARK_COL[lm.type]?.r || 10) * sc;
    const lfr = flatRadiusAt(terrain, lm.x, lm.z, lr0 + 6, 5);
    if (lfr < lr0) sc *= Math.max(0.55, lfr / lr0);
    g.scale.setScalar(sc);
    // 佔地放大後坡地會露餡:取中心 + 四向最低點落底,寧可陷入山坡不懸空
    const lr = (LANDMARK_COL[lm.type]?.r || 10) * sc * 0.7;
    let gy = terrain.heightAt(lm.x, lm.z);
    for (const [ox, oz] of [[lr, 0], [-lr, 0], [0, lr], [0, -lr]]) {
      gy = Math.min(gy, terrain.heightAt(lm.x + ox, lm.z + oz));
    }
    g.position.set(lm.x, gy - 0.3, lm.z);
    // 碰撞橫斷面用的**局部**包圍盒 MUST 在套朝向之前量(此時 g 未旋轉 ⇒ 世界軸 = 局部軸);
    // 量完才轉。轉完再 setFromObject 拿到的是旋轉後的世界 AABB,拿它當盒面就整個歪掉。
    const lbb = new THREE.Box3().setFromObject(g);
    g.rotation.y = rnd() * Math.PI * 2;
    group.add(g);
    landmarkG.push({ g, x: lm.x, z: lm.z, r: (LANDMARK_COL[lm.type]?.r || 10) * sc });   // 碉堡淨空:整棟隱藏用
    const col = LANDMARK_COL[lm.type];
    if (col) {
      // 地標是多箱體自訂幾何(主體 + 偏心側翼)+ 隨機朝向。碰撞橫斷面 MUST 是**有向盒**
      // (A30:建物走 hw2/hd2/ry,圓只准當 broad-phase 且取外接半對角)—— 一直沿用的純圓柱
      // 兩頭都不對:側翼那一側外露(打穿看得見的牆)、細長側又外擴(離牆十幾公尺的空氣擋彈),
      // 長梯也只能架在那圈空氣上(2026-07-30:設施正面 MUST 貼著牆)。
      // 盒心取局部包圍盒中心(偏心側翼靠盒心偏移吃進去),再依朝向轉回世界(three Euler(0,ry,0))。
      const hw2 = Math.max(2, (lbb.max.x - lbb.min.x) / 2), hd2 = Math.max(2, (lbb.max.z - lbb.min.z) / 2);
      const cx = (lbb.min.x + lbb.max.x) / 2 - lm.x, cz = (lbb.min.z + lbb.max.z) / 2 - lm.z;
      const ca = Math.cos(g.rotation.y), sa = Math.sin(g.rotation.y);
      const bx = lm.x + cx * ca + cz * sa, bz = lm.z - cx * sa + cz * ca;
      // 屋頂**實測**高(2026-07-31):地標是多箱體模型(側翼/尖頂/天線/紅十字),`LANDMARK_COL.h`
      // 是手寫的**擋彈**高度,常高過真正踩得到的主量體屋頂數公尺 ⇒ 長梯照碰撞柱畫就會高出屋頂一截
      // (使用者回報「屋頂不平的建築,長梯會過高」)。碰撞柱 MUST NOT 動(站立面 + _collide 垂直閘
      // 都吃它),改由 `ty` 餵給 climb.js 的設施幾何。量測 = 自盒心垂直下射(rockProbe 同一支射線工具,
      // 此時 g 已定位/縮放/旋轉 ⇒ 世界座標);射空(盒心正上方是中庭)回 null ⇒ 設施退回碰撞柱頂。
      const lmTop = rockProbe(g).topAt(bx, bz);
      blockers.push({
        x: bx, z: bz,
        y: gy - 1, h: col.h * sc + 1,   // 高度沿用 LANDMARK_COL(細長尖頂不該整段擋彈),只改橫斷面
        bld: 1, cl: 'bld', hw2, hd2, ry: g.rotation.y,
        r: Math.hypot(hw2, hd2),   // broad-phase:外接半對角(內切圓會讓盒角被提早剔掉)
        ty: lmTop,
      });
    }
  }

  // ---- 道路朝向索引(2026-07-23):整齊度高的拼圖/物件沿最近道路方向擺放 ----
  // 粗網格存道路取樣點方位角(atLocal 平面角);查詢取半徑內最近樣本。
  // 純視覺(地被層 orient 擲骰用),不進碰撞/權威;roadInput 已於開頭定案
  // (含離線兵線備援),圖資成敗兩條路徑皆有方位可查。查詢不消耗任何 rnd。
  const RD_CELL = 24, RD_R2 = 46 * 46;   // 46 遊戲公尺內有路才算「順路」;±2 格覆蓋此半徑
  const rdGrid = new Map();
  for (const way of roadInput) {
    const g = way.geometry || [];
    const hw = roadWidth(way.tags) / 2;   // 道路半寬 → roadRankAt 分級來源(每 way 一次)
    for (let i = 1; i < g.length; i++) {
      const [x0, z0] = llToWorld(g[i - 1].lat, g[i - 1].lon, center);
      const [x1, z1] = llToWorld(g[i].lat, g[i].lon, center);
      const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      const a = Math.atan2(dz, dx);
      const n = Math.ceil(len / (RD_CELL * 0.5));   // 每 ~12m 取樣一點
      for (let s = 0; s <= n; s++) {
        const px = x0 + dx * s / n, pz = z0 + dz * s / n;
        const k = `${Math.round(px / RD_CELL)},${Math.round(pz / RD_CELL)}`;
        let arr = rdGrid.get(k);
        if (!arr) { arr = []; rdGrid.set(k, arr); }
        arr.push([px, pz, a, hw]);
      }
    }
  }
  // r2 可覆寫(2026-07-29):規律結構「都市規劃朝向」離路仍要找得到同街區幹道 ——
  // ground.js 以擴大半徑二次查詢;預設值行為與舊版逐位元相同(span=2)
  const roadDirAt = (x, z, r2 = RD_R2) => {
    const ci = Math.round(x / RD_CELL), cj = Math.round(z / RD_CELL);
    const span = Math.ceil(Math.sqrt(r2) / RD_CELL);
    let best = r2, ba = null;
    for (let j = cj - span; j <= cj + span; j++) {
      for (let i = ci - span; i <= ci + span; i++) {
        const arr = rdGrid.get(`${i},${j}`);
        if (!arr) continue;
        for (const p of arr) {
          const d = (p[0] - x) ** 2 + (p[1] - z) ** 2;
          if (d < best) { best = d; ba = p[2]; }
        }
      }
    }
    return ba;
  };

  // ---- 道路分級(2026-07-25):最近取樣點半寬正規化 0..1。純視覺查詢,零 rnd、不進碰撞 ----
  // 規律拼圖依「所對齊道路分級」抬高 lift(大馬路 > 小馬路);與 roadDirAt 共用 rdGrid(取樣點第四欄 hw)
  const RANK_HW0 = 2, RANK_HW1 = 12;   // 半寬 2m→0(footway/service);12m→1(寬幹道,clamp)
  const roadRankAt = (x, z) => {
    const ci = Math.round(x / RD_CELL), cj = Math.round(z / RD_CELL);
    let best = RD_R2, hw = null;
    for (let j = cj - 2; j <= cj + 2; j++) for (let i = ci - 2; i <= ci + 2; i++) {
      const arr = rdGrid.get(`${i},${j}`); if (!arr) continue;
      for (const p of arr) { const d = (p[0] - x) ** 2 + (p[1] - z) ** 2; if (d < best) { best = d; hw = p[3]; } }
    }
    if (hw == null) return null;
    const r = (hw - RANK_HW0) / (RANK_HW1 - RANK_HW0);
    return r < 0 ? 0 : r > 1 ? 1 : r;
  };

  // ---- 道路走廊遮罩：直接重用地物散布前已定案的有向盒足跡索引。----
  const roadPolys = [];   // 沿街規律陣列走訪源:[世界折線 pts, 半寬 hw];roadInput 已 geocache 定案 ⇒ 跨客戶端同序
  for (const way of roadInput) {
    const g = way.geometry || [];
    if (g.length < 2) continue;
    const hw = roadWidth(way.tags) / 2;
    const pts = g.map((p) => llToWorld(p.lat, p.lon, center));
    roadPolys.push([pts, hw]);
  }
  const roadClearAt = (x, z, foot = { x, z, r: 0 }) => roadFootIndex.near(foot);

  // ---- 線工切面地貌場:地形本身著色，底毯不再另鋪一層皮 ----
  const gseed = (Math.round(center.lat * 1e4) * 31 + Math.round(center.lng * 1e4)) >>> 0;
  const landField = await buildLandField({
    terrain, center, roads: roadInput, rails: osmData?.rails || [], waters: osmData?.waters || [],
    areas: osmData?.areas || [], covers: osmData?.covers || [], boundaries: osmData?.boundaries || [], gradeCorridors,
    classifyPureAt: (x, z) => classify(terrain.sampleColor?.(x, z), terrain.heightAt(x, z), null, null),
    envCodeAt: (x, z) => terrainEnvCode(terrain, x, z), projectAt: llToWorld,
    seed: gseed, onProgress,
  });
  setLandField(landField.data, landField.nx, landField.nz, landField.bounds);

  // ---- 地被特徵層:田地/球場/公園等有真實邊界的離散地塊(ground.js)----
  // 專用 rnd(同心種子異或常數):不動用共享 rnd 序列,建物/植被佈局不受影響
  await onProgress?.(0.88, '鋪設地表覆蓋層…');
  const grnd = mulberry32(gseed ^ 0x51AB);
  const gcStart = group.children.length;   // 洞口打洞用:此後加入 group 的都是地被層(底毯拼圖 + 細節實例)
  // 已存在的獨立平面場地 + 貼地植被：ground.js 會再與 blockers 合併成單一占用索引。
  const reservedFootprints = civics.map((c) => ({
    x: c.x, z: c.z, hw: c.w / 2, hd: c.d / 2, ry: c.ry,
    r: Math.hypot(c.w, c.d) / 2,
  }));
  // ground.js 的地被落點同樣避開 OSM 建物 footprint；holes 由 surface API 保留。
  for (const p of osmBuildingFootprints) {
    const xs = p.outer.map((q) => q[0]), zs = p.outer.map((q) => q[1]);
    reservedFootprints.push({
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      z: (Math.min(...zs) + Math.max(...zs)) / 2,
      r: Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2,
    });
  }
  for (const type in items) {
    if (GIANT_DEFS[type]) continue;   // 神木幹已在 blockers；樹上附著物不占地面
    const rr = VEG_FOOT_R[type] ?? 1;
    for (const it of items[type]) {
      if (Math.abs(it.y - terrain.heightAt(it.x, it.z)) <= 4) {
        reservedFootprints.push({ x: it.x, z: it.z, r: rr * it.s });
      }
    }
  }
  const ground = buildGroundCover(group, terrain, {
    isBlocked: (x, z) => blocked.has(cellKey(x, z)),
    classifyAt: (x, z) => classify(terrain.sampleColor?.(x, z), terrain.heightAt(x, z), mix, grnd),
    // 底毯與特徵層一律走純色彩分類(mix=null,跳過 55% 場地隨機改寫)→
    // 拼圖類型與衛星圖資相符;classifyAt 僅作 classifyPureAt 缺席時的備援

    classifyPureAt: (x, z) => classify(terrain.sampleColor?.(x, z), terrain.heightAt(x, z), null, grnd),
    // 水/沼分類唯一縫(WYSIWYG):底毯/特徵層的水域・沼澤專屬拼圖跟著伺服器遮罩同一規則走
    envCodeAt: (x, z) => terrainEnvCode(terrain, x, z),
    blockers, season, seed: gseed, rnd: grnd, roadDirAt, roadRank: roadRankAt, roadClear: roadClearAt, roadPolys,
    reservedFootprints,
    surfaceField: landField,
    // 街邊廣告看板的在地文字:與建物招牌共用**同一本**去重帳與同一條專屬亂數
    // 街邊廣告看板的字也走 worldtext(ground.js 不再自己開圖集)
  });
  // 落點與建物/地被淘汰全部定案後才追加：只增加物理，不反向推移既有世界佈局。
  const trunkColliders = registerTreeTrunkColliders(items, blockers);

  // ---- 道路(圖資主/次要;離線則以兵線為主要道路備援;roadInput 已於開頭與走廊共用定案)----
  await onProgress?.(0.9, '鋪設道路路面…');
  // 地被層一併送進 buildRoads:洞口打洞時地形與地被拼圖/細節 MUST 用同一把尺讓開,
  // 只挖地形的話洞口望進去仍是一坡貼在崖面上的草皮拼圖(地被是獨立圖層)。
  const coverMeshes = group.children.slice(gcStart);
  buildSwampSurface(group, terrain);   // 沼澤水平面(暗紫濁沼盤;視線沒入 → _updateWaterVeil 帷幕)
  // 離線備援(roadInput = 兵線本身)吃 inclSwamp ⇒ 跨沼段也升橋;真 OSM 道路維持水域限定
  const roadRes = buildRoads(group, roadInput, terrain, center, mix, rnd, season, coverMeshes, !osmRoads?.length, gradeCorridors);
  const pedestrianEntrances = buildPedestrianEntrances(group, terrain, pedestrianPlan.entrances);
  blockers.push(...pedestrianEntrances.cols);   // 地下道／捷運入口建築：玩家、NPC、彈道共用同一 blockers 縫
  // ---- 兵線跨水補橋(2026-07-22 確定性改制,幾何定案於前段 laneWetWays):每個兵線泡水段
  // 一律建全跨橋。不再查真橋覆蓋率(舊 DECK_COVER 去重使兵線橋數隨 Overpass 逐局浮動,
  // 部分覆蓋時全跨補橋疊在殘缺真橋上 = 上下兩層);與兵線走廊側向重疊的真橋已於
  // dropLaneBridges 剔除,此處恆單層。MUST NOT 改成「只補未覆蓋子段」:deckAt 讓橋端降回
  // 水面,子段接縫會差一整個 BRIDGE_RISE 高差(垂直台階、上不去);全跨橋維持 _surf 連續。
  // 走廊/淨空已於 gradeCorridors 一併登記,此處只補 decks/cols。
  if (osmRoads?.length && laneWetWays.length) {
    const laneRes = buildRoads(group, laneWetWays, terrain, center, mix, rnd, season, [], true, gradeCorridors);   // 兵線補橋含跨沼段
    roadRes.decks.push(...laneRes.decks);
    roadRes.cols.push(...laneRes.cols);
  }
  // ---- 兵線砲塔跨橋墩座:與橋重疊的砲塔改蓋在橋面上(台面 + 往外擴張的橋墩)----
  // MUST 排在兩次 buildRoads 之後(真橋 + 兵線補橋的 decks 都併齊了才判「塔在不在橋上」),
  // 且排在 blockers.push(roadRes.cols) 之前(墩身碰撞柱走同一條路徑)。
  const bridgeTowerPads = buildTowerBridgePads(
    group, (cfg.lanes || []).map((lane) => lane.map(([lat, lng]) => llToWorld(lat, lng, center))),
    roadRes.decks, terrain, roadRes.cols, mapArg(cfg));
  const towerPads = buildTowerPlatforms(
    group, (cfg.lanes || []).map((lane) => lane.map(([lat, lng]) => llToWorld(lat, lng, center))),
    roadRes.decks, terrain, roadRes.cols, mapArg(cfg), bridgeTowerPads);
  const basePads = buildBaseWaterPads(group, basesW, terrain, roadRes.decks, roadRes.cols);
  const roadsBuilt = roadRes.built;
  group.userData.towerPads = towerPads;   // 橋上／陸地砲塔落位高度(main.js → terrain.towerPadY → game.js)
  group.userData.basePads = basePads;     // 水域／陸地主堡落位高度(main.js → terrain.basePadY → game.js)
  group.userData.decks = roadRes.decks;   // 橋面(main.js → terrain.decks/deckY → game.js 表面高度)
  group.userData.tunnels = roadRes.tunnels;   // 地下道路面 + 天花(main.js → terrain.tunnelAt/ceilingAt)
  group.userData.portals = roadRes.portals;   // 洞口門洞(稽核/冒煙測試用:數量與位置驗證)
  blockers.push(...roadRes.cols);         // 橋墩/門洞立柱:與建物同一條碰撞路徑(玩家不可穿)
  // 道路穿出空氣牆處 → 車禍/施工/巨坑封路事件(合成兵線不出界,自然為 0)
  const roadBlockN = buildRoadBlocks(group, roadInput, terrain, center, blockers, rnd);

  // ---- 鐵路/捷運(含行駛列車)+ 瀑布(動態物件)----
  await onProgress?.(0.92, '鋪設鐵路與瀑布…');
  const dynamics = [];
  const edgeMotionN = buildEdgeMotion({ group, segs: edgeSegs, dynamics });
  buildWaterEdges(group, terrain);   // 沼澤潮間帶(靜態;水岸泡沫 2026-08-16 退場,見該支檔頭)
  // 水面倒影塊(⑤-3):MUST 排在**所有** `blockers.push` 之後(名冊由碰撞柱推導 ——
  // 少一批就是「那幾棟樓在水裡沒有影子」),與 `planClimbRoutes` 同一個理由。
  // 零共享 `rnd()` 消耗;`reflect = 0` ⇒ mesh 不可見。
  const reflN = buildWaterReflections(group, terrain, blockers, dynamics);
  // ---- 鳥群(⑥-2)----
  // MUST 排在 `placeGiantGroves` / `landmarkG` **之後**(錨點取的是它們已經定案的幾何),
  // 更新函式推進**既有的** `dynamics` 桶 ⇒ game.js 一行不動(第二條更新迴圈是禁令)。
  // 錨點順位 水域岸線 > 神木林 > 地標;**刻意排除兵線 / 塔位 / 主堡**(那是戰術資訊,
  // 鳥繞著前線飛就是把它畫出來)。三類都錨不到 ⇒ 這張圖沒有鳥群(原則 6)。
  const birdsBuilt = buildFlocks(group, terrain, dynamics, {
    anchors: {
      shore: shoreRing(terrain),
      groves: giantTrees ? greenSites.map(([x, z]) => ({ x, z, r: 26 })) : [],
      landmarks: landmarkG.map((l) => ({ x: l.x, z: l.z, r: l.r })),
      settlements: (typeof civics !== 'undefined' && civics) ? civics.map((c) => ({ x: c.x, z: c.z, r: 18 })) : [],
      streets: (typeof roadPolys !== 'undefined' && roadPolys?.length) ? roadPolys.slice(0, 8).map((rp) => ({ x: rp[0]?.[0]?.[0] || 0, z: rp[0]?.[0]?.[1] || 0, r: 20 })) : [],
    },
    low: lowPower(),
  });
  const railLines = osmData?.rails?.length ? buildRails(group, osmData.rails, terrain, center, dynamics, osmData.crossings) : 0;
  const fallsBuilt = osmData?.falls?.length ? buildWaterfalls(group, osmData.falls, terrain, center, dynamics) : 0;

  // ---- 落花 / 落葉粒子(⑤-4)----
  // MUST 排在植被散佈與建物過濾**之後**:落點的唯一來源是**最終**的 `items`(見 buildPetals)。
  // 逐幀步進併進既有的 `dynamics` 桶(`group.userData.update` → `terrain.biomesUpdate` →
  // game.js),**MUST NOT** 在 game.js 另開第二條更新迴圈(climb.js 檔頭已把規則寫死)。
  // `?petal=0` = **整段不建立**(零 mesh、零 dynamics 條目)⇒ 對照組逐位元同舊制;
  // 「建了但每幀不更新」不算 —— 那留著 draw call 與記憶體。
  const petalMode = PETAL_OFF ? null : petalSeason(season);
  const petalsBuilt = petalMode ? buildPetals(group, terrain, items, season, petalMode, dynamics, gseed) : 0;

  // ---- 水下與沼澤生態、動態、動植物、遺跡與船艦 (aquatics.js) ----
  if (terrain.waterY != null) {
    const aquaticWorld = buildAquaticWorld(group, terrain, { season, blockers });
    if (aquaticWorld?.step) {
      dynamics.push((dt) => aquaticWorld.step(dt, celWindTime(), null, isWeatherFrozen()));
    }
  }

  // ---- 世界文字(洞口匾額 / 橋名牌 / 地名標牌 / 建物招牌;2026-08-03)----
  // MUST 排在 buildRoads 與建物之後(位置全部取自它們已經定案的幾何),排在攀爬路線之前
  // 沒有硬性理由,但擺這裡讓「純視覺圖層」聚在一起。取不到圖資 = 一塊牌都不掛(原則 6),
  // 而不是拿場地名去填 —— 假名比沒有名字更糟。

  // ---- 攀爬路線(長梯 / 攀岩抓點 / 垂降技術繩;2026-07-28)----
  // 約三成的建築/巨石/神木掛一條「地面 ↔ 頂端」的垂直通道,讓地面機種爬上去立足射擊。
  // MUST 排在**所有** blockers.push 之後 —— 地面端的「無障礙那一側」要看得到橋墩/門洞柱/封路
  // 障礙,少一批就會把梯腳擺進別的結構裡。規劃與幾何都住 climb.js(唯一縫),此處只接線。
  // 亂數走**專屬 seed**(不動既有 rnd/grnd 序列 ⇒ 植被/建物/道路佈局逐位元不變)。
  // 上下兩端的提示箭頭是動態的(chevron 沿上/下方向流動)⇒ 併進既有的 dynamics 桶,
  // 走火車/瀑布同一條 `group.userData.update` 路徑,**MUST NOT** 在 game.js 另開第二條更新迴圈。
  await onProgress?.(0.95, '架設攀爬路線…');
  const climbs = planClimbRoutes({
    blockers,
    heightAt: (x, z) => terrain.heightAt(x, z),
    envCodeAt: (x, z) => terrainEnvCode(terrain, x, z),
    bounds: { minX: terrain.minX, maxX: terrain.maxX, minZ: terrain.minZ, maxZ: terrain.maxZ },
    rnd: mulberry32(gseed ^ 0x0C11B),
  });
  const climbMesh = buildClimbMeshes(climbs);
  if (climbMesh) {
    group.add(climbMesh);
    if (climbMesh.userData.update) dynamics.push(climbMesh.userData.update);
  }
  group.userData.climbs = climbs;   // main.js → terrain.climbs / climbAt → game.js 攀爬狀態機

  // ---- 世界文字圖層(唯一的文字圖層:構件名牌 + 語料庫招牌全在同一張 sheet)----
  // MUST 排在攀爬之後 —— 語料庫那五種的落點要看得到**最終**的 blocked 走廊(招牌不擋路)。
  await onProgress?.(0.96, '掛上世界文字…');
  const signsBuilt = buildWorldSigns({
    group, terrain, center,
    portals: roadRes.portals, signSpots: roadRes.signSpots, generic,
    pois: osmData?.pois, lowPower: lowPower(),
    // 語料庫招牌(直式招牌/屋頂看板/路標/佈告欄/解說牌)的字與落點
    corpus: vtext, rnd: signRnd, used: signUsed, wallSigns, billboards, bldFaces,
    entranceSigns: pedestrianEntrances.signSpots,
    roads: osmRoads || [],
    features: [
      ...landmarkG.map((lm) => ({ x: lm.x, z: lm.z, r: lm.r })),
      ...(osmData?.falls || []).map((f) => { const [x, z] = llToWorld(f.lat, f.lng, center); return { x, z, r: 8 }; }),
    ],
    isBlocked: (x, z) => blocked.has(cellKey(x, z)),
  });

  if (dynamics.length) {
    group.userData.update = (dt) => { for (const fn of dynamics) fn(dt); };
  }

  await onProgress?.(1, '地貌完成');
  group.userData.blockers = blockers;   // 建物碰撞柱(main.js → terrain.blockers → game.js _collide)
  group.userData.roofPlatforms = osmRoofPlatforms;
  group.userData.edgeMotionN = edgeMotionN;
  // 立體交通走廊(隧道全段 + 橋樑走廊):main.js 上傳伺服器 → sim 清除走廊內第三方障礙/地雷
  group.userData.gradeCorridors = gradeCorridors;
  // 分界線帶遮罩(2026-08-13):main.js → terrain.inBorderBand → terrainEnvCode。
  // **只交出來,不在這裡裝上去** —— 裝了就是建圖期的循環相依(見開頭那一段的清空)
  group.userData.bandDryAt = ground.bandDryAt;
  group.userData.stats = {
    veg: placed,
    giantTrees,
    trunkColliders,
    megaliths: megalithsBuilt,
    relics: relicsBuilt,
    beacons: beaconsBuilt,
    baseFlags,
    ground: ground.patches,
    groundDetails: ground.details,
    groundAligned: ground.aligned,   // 沿路對齊件數(拼圖 + 物件;整齊度 reg 稽核用)
    groundBuffer: ground.bufCells,   // 緩衝空間的底毯格數(2026-08-12;0 = 那一圈沒鋪成)
    petals: petalsBuilt,             // 落花 / 落葉粒子數(0 = 夏冬、沒有落葉樹、或 ?petal=0)
    reflectors: reflN,               // 水面倒影塊的反射體數(0 = 無水域,或岸邊沒有夠高的東西)
    buildings: generic.length + landmarks.length + osmBuildingResult.generated,
    landmarks: landmarks.length,
    roads: roadsBuilt,
    roadPrune: roadPruneStats,
    pedestrian: { ...pedestrianPlan.stats, entrancesBuilt: pedestrianEntrances.built },
    // 立體結構(橋 / 隧道 / 地下道 / 明隧道)的建置與剔除 —— 建置端無兵線距離判定,
    // 離兵線多遠一律照建;`strucDrop` 逐把刀記帳(見上方註解),少一座橋查得出原因。
    strucWays: strucN(roadInput),
    strucDrop,
    roadBlocks: roadBlockN,
    boundary: boundaryN,
    climbs: climbs.length,   // 攀爬路線數(長梯/抓點/技術繩合計)

    signText: vtext.spine,   // 這張圖的地名主幹(語料全空 = null ⇒ 語料庫招牌整批不出場)
    rails: railLines,
    falls: fallsBuilt,
    signs: signsBuilt,   // 世界文字塊數(0 = 圖資沒名字或整批缺字 ⇒ 一塊都不掛)
    // `osm` 是來源是否成功，不是建物數量；成功但零 area 也必須阻斷程序城市 fallback。
    osm: osmSource,
    osmAreas: osmData?.areas?.length || 0,
    osmObjects: osmAreaObjectResult.generated,
    osmCatalog: {
      ...osmCatalogReport,
      byFamily: Object.fromEntries(Object.entries(osmCatalogReport.byFamily || {}).map(([family, row]) => {
        const kinds = new Set((osmData?.areas || []).filter((a) => a.classification?.family === family)
          .map((a) => a.classification?.kind));
        let generated = row.generated || 0;
        for (const kind of kinds) generated += (osmBuildingResult.generatedByKind?.[kind] || 0)
          + (osmAreaObjectResult.generatedByKind?.[kind] || 0);
        return [family, { ...row, generated }];
      })),
      byKind: Object.fromEntries(Object.entries(osmCatalogReport.byKind || {}).map(([kind, row]) => ({
        [kind]: {
          ...row,
          generated: (row.generated || 0) + (osmBuildingResult.generatedByKind?.[kind] || 0)
            + (osmAreaObjectResult.generatedByKind?.[kind] || 0),
        },
      }))),
    },
    osmRoads: !!(osmRoads && osmRoads.length),   // 路網查詢是否成功(false = 兵線備援;main.js 房間補抓依據)
  };
  // 碉堡淨空(反應式):碉堡進場時 game.js 呼叫。移除「與碉堡淨空區重疊」的建物(縮 0 隱形)+ 地標(整棟隱藏),
  // 並同步清掉這些建物/地標「自己的」碰撞柱(bld 標記)——植被/巨岩/橋墩(非建物)一律保留機體與碰撞。
  // 視覺與碰撞用同一個「圓重疊」判定(距離 − 半徑 < r)⇒ A6 砲火/碰撞一致:不會出現看得見卻穿得過、
  // 或看不見卻擋彈的物件。回傳是否有動到碰撞柱(供 game.js 決定是否重建 _blockGrid)。
  group.userData.clearAround = (wx, wz, r) => {
    const P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), M = new THREE.Matrix4();
    for (const o of bldMeshes) {
      if (!o.isInstancedMesh) continue;
      let hit = false;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, M); M.decompose(P, Q, S);
        if (S.x === 0) continue;   // 已清過(縮 0)略過
        // 圓重疊:實例佔地半徑 = hypot(寬,深)/2×0.8(與建物碰撞柱 r 同式)
        if (Math.hypot(P.x - wx, P.z - wz) - Math.hypot(S.x, S.z) / 2 * 0.8 < r) { M.makeScale(0, 0, 0); o.setMatrixAt(i, M); hit = true; }
      }
      if (hit) o.instanceMatrix.needsUpdate = true;
    }
    for (const lm of landmarkG) {
      if (!lm.cleared && Math.hypot(lm.x - wx, lm.z - wz) - lm.r < r) { lm.g.visible = false; lm.cleared = true; }
    }
    // 同步清建物/地標碰撞柱(bld=1):in-place splice 讓 terrain.blockers(同一陣列參照)一併生效
    let removed = false;
    const blk = group.userData.blockers;
    for (let i = blk.length - 1; i >= 0; i--) {
      const b = blk[i];
      // OSM 建物按型別合批，無法只隱藏單棟；保留其同源 wall blocker，避免留下可穿越的可見牆。
      if (b.bld && !b.osm && Math.hypot(b.x - wx, b.z - wz) - (b.r || 0) < r) { blk.splice(i, 1); removed = true; }
    }
    // 攀爬路線同步清掉:樓沒了梯子不能留在空中(路線持有 blocker 參照 ⇒ 直接比對即可)。
    // 幾何是 InstancedMesh 不逐條拆(碉堡淨空區內的殘留梯子由建物一併消失時的視覺落差承擔),
    // 但**可攀爬性 MUST 立刻失效** —— 否則爬上去會站在一棟隱形樓的屋頂上。
    if (removed && climbs.length) {
      const live = new Set(blk);
      // 相鄰相接的那一條同時吃兩座結構:低者被拆掉 ⇒ 下端落腳點懸空,一併撤掉
      for (let i = climbs.length - 1; i >= 0; i--) {
        const c = climbs[i];
        if (!live.has(c.b) || (c.link && !live.has(c.link))) climbs.splice(i, 1);
      }
    }
    return removed;
  };
  return group;
}
