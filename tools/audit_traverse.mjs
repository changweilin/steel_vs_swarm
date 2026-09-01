// ============ 兵線與結構「可通行」稽核(離線;泛洪連通性)============
// 用途:回答**「一個機體真的走得過去嗎」**。既有的四十支稽核驗的都是**幾何契約**
// (洞口涵蓋、剖面連續、走廊淨空、坡度曲線),沒有任何一支問過「從主堡出發,走得到
// 對面主堡 / 每一座塔位 / 每一座洞的另一端嗎」。
//
// 為什麼要有這支(2026-08-03):bot **沒有尋路** —— 正面頂著建物/工事就原地卡死,整條兵線
// 停止推進,而「bot 站著不動」在畫面上非常像 AI 難度問題。現行唯一的偵測器是**間接**的
// `繞行%`(`_skirtUntil` 生效的 tick 比,≈4.0%,SD≈0.2),要 24 場取樣才有訊號;單場工事損血
// 在 433~10298 之間跳。本支改成**直接問連通性**,離線、零取樣變異、秒級。
//
// 判定用的全部是**執行期的真品**,不是另抄一份:
//   ・地形高度場   `venue_field.mjs buildHeightField`(terrain.js buildTerrain 高度管線的鏡射,
//                  與 audit_lane_scenarios 同一份縫)
//   ・結構路面     `biomes.js tunFloorAt` / `underpassPlan` / `deckAt` 的**原文**(venue_field 抽出)
//   ・坡度閘       `data.js slopeDeg` / `slopeBlocked` / `SLOPE.STRUCT_M`(客戶端 `_slopeDegAlong`
//                  的同一條規則:站立面與裸地形差超過 STRUCT_M = 人造鋪面,不吃坡度)
//   ・實體推擠     **真的 `BattleSim.solidResolve`**(bots.js `_move` 的唯一縫)—— 塔/主堡/碉堡
//                  的碰撞量體由它給,MUST NOT 在這裡自己算一份圓
//   ・開挖後地形   `terrain.js carveTunnels` 的**原文**(venue_field `makeCarvedField`)——
//                  引道路塹與地下道斜坡是**挖出來的**,拿天然地形走那一段會把通的路報成不通
//
// **淨空(V-D)刻意仍吃天然地形**:那一項問的是「這座山藏不藏得住頂板」,本來就該用未開挖的
// 山來問(與 `tunnelWallProfile` 條件③吃 `natureAt` 同一條理由)。兩個高度場並存不是重複,
// 是兩個不同的問題。
//
// 泛洪的兩個地雷(都踩過,寫在這裡免得再踩):
//   ① visited 的鍵 MUST 是 **(格, 層別 sid, 高度桶)** —— 一格一個位元的話,每一段階梯、引道、
//      洞口都會被判成「已經走過」而回報不可達,但它們明明走得通(洞在山**下**、山頂在洞**上**,
//      同一格兩層)。**層別不可省**:引道/橋頭正是「結構面高 ≡ 開挖後地面高」的地方,兩層
//      落在同一個桶 ⇒ 地面層先佔鍵、結構層永遠進不了佇列;等走進覆蓋段,換層閘(buried >
//      OPEN_M)又擋掉跳層 ⇒ 洞中/橋中不可達,能不能進洞全看洞口有沒有剛好跨在桶邊界上
//      (2026-08-05 實測:補上 sid 之後 jinlong/madrid/hehuanshan 整場轉綠)。
//   ② 高度桶 MUST 是**固定量化**,MUST NOT 用「±tol 內視為同一點」的模糊比對 —— 在斜坡上
//      會無限乒乓(別處實測:770k 格跑出 53.6M 次拜訪,不會結束)。
//
// 斷言的是**航點清單**不是格數:兩座主堡、每一座塔位、每一座洞的兩端洞口與洞中、每一段
// 橋面、每一條地下道引道。格數是個沒有意義的數字(地圖一改就變),航點才是契約。
//
// 網路模式:高程走 terrarium(快取在 tools/.scen_cache/),圖資走 Overpass → OSM API。
//      fixture 模式:高程與圖資一律讀 test/fixtures/osm/elevation + OSM raw，
//      MUST NOT 查外部或用平地／synthetic fallback；缺固定高程即明確未驗並退出 1。
//      網路模式取不到圖資時仍可降級成「地形層」(原則 6)，結構航點列為未驗；
//      MUST NOT 因為取不到圖資或高程就報綠。
// 用法:node tools/audit_traverse.mjs [--only=jinlong,taroko] [--team=1|2|3] [--cell=4]
//      [--fixture-dir=test/fixtures/osm --fixtures=taipei_dense,shibuya_dense] [--json=out.json]
//      [--clearance-report] [--check-clearance-manifest]
//      [--write-clearance-manifest[=<path>]]  (path omitted = <fixture-dir>/manifests/osm_clearance_manifest_v1.json)
//      高程 companion 預設位於 <fixture-dir>/elevation/<name>.json + tiles/*.png。
//      node tools/audit_traverse.mjs --break-slope   ← 反向驗證:把坡度閘寫死成「什麼都擋」
//      node tools/audit_traverse.mjs --break-clearance-source|--break-clearance-tags
// 退出碼:0 = 全部航點可達;1 = 有航點不可達
//
// ---- 接縫紀律:泛洪看得到什麼、看不到什麼(2026-08-16 併入,`docs/anime_style_plan.md` ④-4;
//      純註解,零斷言改動)----
// 這一支是全專案唯一「真的走一遍」的稽核,所以它同時是那一族接縫陷阱**最好的偵測器**與
// **最大的盲區**。兩件事分開記:
//
//  ㋐ **泛洪抓得到、而人抓不到的那一種:平台盒 MUST 重疊,不得相接。**
//     「取最高的那一個平台」這種高度查詢**四邊都是排他的** ⇒ 一次落在兩塊平台**接縫上**的查詢
//     **兩塊都不匹配**,回傳的是原始地面高。症狀:*玩家從一塊平台走到另一塊時掉下去,
//     而且掉下去就爬不回來*。⚠ 關鍵是**誰會踩到它**:真人幾乎永遠不會恰好站在那條數學上
//     零寬的線上,而**本支 0.35 m 的泛洪格每一次都踩得到** —— 所以「玩起來沒事、稽核紅字」
//     不是誤報,是這支稽核在做它該做的事(參考專案的原始紀錄:平台盒 MUST 重疊約 40 mm)。
//     同一族的第二半:**兩個區域各自「正確地」結束自己的工作**,就會在中間留下一段沒有人負責的
//     門檻 —— 一段 0.6 m 的無主門檻可以讓玩家掉下 1.79 m 到自然地面而再也上不來。
//     本專案對應的落點是橋面板 ⇄ 引道、隧道頂板 ⇄ 地形、明隧道 open 段 ⇄ 覆蓋段這三處交界
//     (規則住 A29 / A6b,判定面在 `audit_layer_block`);本支是**唯一會真的走過去試**的那一支。
//  ㋑ **泛洪結構上看不到的那一種:純視覺帶。** 不進 `blockers`、不進碰撞、不改站立面的東西,
//     對本支而言**不存在** —— 地下道緣石 `UND.COPE`、道路漸縮帶、標線、緩衝布景、視線背景、
//     邊界緩衝裙的擺件、旗陣、落花與鳥群一律如此。所以「一道緣石橫在車道入口上」「一片布景
//     擋住視線走廊」這一類 symptom,**本支永遠是綠的**,而它們只在真機上看得出來(㋕)。
//     ⇒ 看到「通行稽核全綠」時 MUST NOT 推論成「這條路看起來也沒問題」。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { VENUES, venueConfig } from '../public/js/venues.js';
// WATER 是橋下淨空那一段在用的(水面下不算「走得過去」)。漏了它不會報錯 ——
// `scanVenue` 整段包在 try 裡,ReferenceError 會被吞成「⏭ 場地跳過」⇒ 每一個**有橋**的
// 場地都靜默不驗,而收尾只會印「通過 N 項」看起來全綠(實測 27 場地跳掉 10 個)。
import {
  SLOPE, slopeDeg, slopeBlocked, battleBBox, battleRect, heroTargetH, CHARACTERS, WATER,
} from '../public/js/data.js';
import { BattleSim } from '../server/sim.js';
// `buildStructs`/`projectArc`/`ptAt`/`sampleAlong` 2026-08-16 起住 venue_field.mjs
// (§0-a 線工切面樁要的「結構足跡 keep-out」與本支泛洪吃同一份清單,抄第二份就是繞過那條縫)。
import {
  llToWorld, elevSampler, buildHeightField, osmFor, makeCarvedField, TUN, BRIDGE_RISE,
  buildStructs, projectArc, ptAt, ptPoly, ptSeg, strucTunnel,
} from './venue_field.mjs';
import { readSrc } from './audit_src.mjs';
import { catalogAreas, pointInProjectedArea, projectAreaRecord } from '../public/js/osmAreas.js';
import {
  DEFAULT_FIXTURE_DIR, elevationDirForFixtureDir, elevationFixtureContract, fixtureElevationSampler,
  fixtureOsm, fixtureQueries, heightFieldBboxForWorldBounds, loadElevationFixture,
  loadOsmFixture, loadOsmFixtureForVenue, validateElevationFixture,
} from './osm_fixture.mjs';

const ARG = Object.fromEntries(process.argv.slice(2).map((s) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(s);
  return m ? [m[1], m[2] ?? '1'] : ['_', s];
}));
const ONLY = (ARG.only || '').split(',').filter(Boolean);
const TEAM = +(ARG.team || 1);
const CELL = +(ARG.cell || 4);          // 泛洪格寬(遊戲公尺)
const BREAK_SLOPE = !!ARG['break-slope'];   // 反向驗證開關(原則 9)
const BREAK_OSM_HOLE = !!(ARG['break-osm-hole'] || ARG['break-hole']);
const BREAK_OSM_BLOCKER = !!(ARG['break-osm-blocker'] || ARG['break-blocker']);
const BREAK_OSM_ROOF = !!(ARG['break-osm-roof'] || ARG['break-roof']);
const BREAK_OSM_APPLIED = { hole: false, blocker: false, roof: false };
const BREAK_CLEARANCE_SOURCE = !!ARG['break-clearance-source'];
const BREAK_CLEARANCE_TAGS = !!ARG['break-clearance-tags'];
const BREAK_CLEARANCE_APPLIED = { source: false, tags: false };
const FIXTURE_MODE = ARG['fixture-dir'] != null || ARG.fixtures != null;
const FIXTURE_DIR = ARG['fixture-dir'] || DEFAULT_FIXTURE_DIR;
const ELEVATION_DIR = elevationDirForFixtureDir(FIXTURE_DIR);
const FIXTURE_NAMES = new Set(String(ARG.fixtures || '').split(',').filter(Boolean));
const CLEARANCE_REPORT = !!ARG['clearance-report'];
const CHECK_CLEARANCE_MANIFEST = !!ARG['check-clearance-manifest'];
const WRITE_CLEARANCE_MANIFEST = Object.prototype.hasOwnProperty.call(ARG, 'write-clearance-manifest');
const WRITE_CLEARANCE_MANIFEST_VALUE = ARG['write-clearance-manifest'];
const CLEARANCE_MANIFEST_PATH = resolve(
  WRITE_CLEARANCE_MANIFEST_VALUE && WRITE_CLEARANCE_MANIFEST_VALUE !== '1'
    ? WRITE_CLEARANCE_MANIFEST_VALUE : join(FIXTURE_DIR, 'manifests', 'osm_clearance_manifest_v1.json'));
const CLEARANCE_MANIFEST_SCHEMA = 'osm-clearance-manifest-v1';
const CLEARANCE_MANIFEST_VERSION = 1;
const CLEARANCE_MANIFEST_FIXTURES = Object.freeze([
  Object.freeze({ name: 'shibuya_dense', venueId: 'shibuya' }),
  Object.freeze({ name: 'roppongi_underpass', venueId: 'roppongi' }),
]);
let FIXTURE_BINDINGS = new Map();

// osmBuilding.js 直接 import THREE/CDN，Node 沒有 three 套件；這裡只提供最小的
// 幾何接收器，讓 production 原文完整執行並回傳 blocker/platform。任何 stub 失敗都
// 只能降級成「純資料 footprint 診斷」，不得把近似量體當成已驗證碰撞。
let OSM_BUILDER;
function loadOsmBuilder() {
  if (OSM_BUILDER !== undefined) return OSM_BUILDER;
  try {
    const src = readSrc('public', 'js', 'osmBuilding.js')
      .replace(/^import.*$/gm, '')
      .replace(/^export\s+/gm, '');
    class StubGeometry {
      rotateX() { return this; }
      rotateY() { return this; }
      translate() { return this; }
    }
    class StubPath {
      constructor() { this.holes = []; }
      moveTo() {}
      lineTo() {}
    }
    class StubMesh {
      constructor(geometry, material) {
        this.geometry = geometry;
        this.material = material;
        this.userData = {};
        this.frustumCulled = true;
      }
    }
    const THREE = {
      Shape: StubPath, Path: StubPath, ShapeGeometry: StubGeometry,
      BoxGeometry: StubGeometry, CylinderGeometry: StubGeometry,
      ConeGeometry: StubGeometry, Mesh: StubMesh,
    };
    const factory = new Function('THREE', 'mergeGeometries', 'envMat',
      `${src}\nreturn { buildOsmPolygonBuildings };`);
    OSM_BUILDER = factory(THREE, () => new StubGeometry(), () => ({})).buildOsmPolygonBuildings;
  } catch (error) {
    OSM_BUILDER = { error };
  }
  return OSM_BUILDER;
}

// 高度桶:固定量化,不是容差比對(見檔頭地雷②)。桶要夠粗才不會在斜坡上把同一層切成很多層,
// 又要夠細才分得出「洞內路面」與「洞上山頂」—— 取隧道淨空(TUN.CLEAR)當尺:同一格若兩個
// 可站立面差不到一個淨空高,本來就不可能是上下兩層。
const BUCKET_M = TUN.CLEAR;
// 一步爬得上去的高差(公尺):與客戶端 `_collide` 的台階同量級。超過就得繞路。
const STEP_UP = 1.2;
// 一步掉得下去的高差:比這更深就不是「走過去」而是墜落(仍會扣血/需要爬回來)。
const STEP_DOWN = 6;
// 「這個站立面通不通天」的門檻:結構路面被地表壓在下面超過這麼多 = 頭頂有岩/有頂板,
// 不可能與地表層互換(洞口處 terrain ≈ floor ⇒ 自然可以進出)。
const OPEN_M = 1.5;
// 航點抵達判定半徑(公尺):泛洪是格心取樣,航點不會剛好落在格心上。
const HIT_R = CELL * 1.6;

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log(`    ✓ ${msg}`)) : (fail++, console.error(`    ✗ ${msg}`)); };

// 場上最大的機體(淨空/量體一律由 data.js 推導,MUST NOT 手寫公尺數)
const BIGGEST = Object.keys(CHARACTERS).reduce((a, ch) =>
  heroTargetH(CHARACTERS[ch].kind, ch) > heroTargetH(CHARACTERS[a].kind, a) ? ch : a, Object.keys(CHARACTERS)[0]);
const MECH_H = heroTargetH(CHARACTERS[BIGGEST].kind, BIGGEST);
const HEAD_M = 0.2;   // 頭頂餘裕(CLAUDE.md §5「淨空 > 最大機體 + 0.2」)

/**
 * 場地的「可站立面」模型。
 * 每個點可能有多個站立面:地表一個,加上每一座覆蓋到該點的結構(隧道/地下道/橋)各一個。
 * 每個面帶 `sid`(結構代號;地表 = -1)與 `buried`(地表高 − 該面高:> 0 = 頭頂有東西)。
 */
function makeSurfaces(ground, structs, roofPlatforms = []) {
  return (x, z) => {
    const ty = ground(x, z);
    const out = [{ y: ty, sid: -1, buried: 0 }];
    for (let k = 0; k < structs.length; k++) {
      const st = structs[k];
      const s = projectArc(x, z, st);
      if (s == null) continue;
      const y = st.floorAt(s, x, z);
      out.push({ y, sid: k, buried: ty - y });
    }
    // 屋頂平台沿用 osmBuilding.js 的 outer/holes 面域契約；只用 bbox 會把洞內
    // 也變成可站立面，與 runtime surfaceAt 分家。sid 排在結構之後，保持高度桶
    // 與層別鍵的既有語意。
    for (let k = 0; k < roofPlatforms.length; k++) {
      const p = roofPlatforms[k];
      if (p?.active === false || !pointInProjectedArea(x, z, p)) continue;
      out.push({ y: p.y, sid: structs.length + k, buried: ty - p.y, roof: true,
        sourceId: p.sourceId, catalogKind: p.kind, polygonIndex: p.polygonIndex ?? null });
    }
    return out;
  };
}

/**
 * 泛洪:從種子出發,沿 8 鄰格走可站立面。
 * 一步的三道閘(缺一不可):
 *   ① 垂直:爬 ≤ STEP_UP、掉 ≤ STEP_DOWN;
 *   ② 換層:兩個面的 sid 不同時,兩端都要「通天」(buried ≤ OPEN_M)—— 否則就是穿過山體
 *      走進洞裡,或從地表直接掉進頂板下方;
 *   ③ 坡度 + 實體:裸地形段吃真 `slopeBlocked`,人造鋪面(差 > SLOPE.STRUCT_M)豁免;
 *      位移一律過真 `sim.solidResolve`,被夾回來就是撞牆。
 */
function flood(seeds, surfacesAt, hf, ground, sim, probe) {
  const seen = new Set();
  const key = (i, j, y, sid) => `${i},${j},${sid},${Math.round(y / BUCKET_M)}`;
  const cellX = (i) => hf.minX + (i + 0.5) * CELL;
  const cellZ = (j) => hf.minZ + (j + 0.5) * CELL;
  const iOf = (x) => Math.floor((x - hf.minX) / CELL);
  const jOf = (z) => Math.floor((z - hf.minZ) / CELL);
  const nI = Math.ceil((hf.maxX - hf.minX) / CELL), nJ = Math.ceil((hf.maxZ - hf.minZ) / CELL);
  const queue = [];
  const reached = [];   // [x, z, y] 逐點記錄(航點比對用)
  for (const [sx, sz] of seeds) {
    const i = iOf(sx), j = jOf(sz);
    if (i < 0 || j < 0 || i >= nI || j >= nJ) continue;
    for (const s of surfacesAt(cellX(i), cellZ(j))) {
      if (s.buried > OPEN_M) continue;                 // 種子只從通天的那一層下去
      const k = key(i, j, s.y, s.sid);
      if (seen.has(k)) continue;
      seen.add(k); queue.push([i, j, s.y, s.sid, s.buried]); reached.push([cellX(i), cellZ(j), s.y]);
    }
  }
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let head = 0; head < queue.length; head++) {
    const [i, j, y, sid, buried] = queue[head];
    const x = cellX(i), z = cellZ(j);
    for (const [di, dj] of NB) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= nI || nj >= nJ) continue;
      const nx = cellX(ni), nz = cellZ(nj);
      const run = Math.hypot(nx - x, nz - z);
      for (const s of surfacesAt(nx, nz)) {
        const dy = s.y - y;
        if (dy < -STEP_DOWN) continue;                                       // 閘①(上升由下方 trace)
        if (s.sid !== sid && (buried > OPEN_M || s.buried > OPEN_M)) continue;   // 閘②
        const k = key(ni, nj, s.y, s.sid);
        if (seen.has(k)) continue;
        // 4m 泛洪格只是取樣解析度，不是玩家一步的長度。橋面 24m 緩坡若一次跨格，
        // 會把本來可走的連續斜坡誤判成超過 STEP_UP；只有端點高差超過閘值時才做線性
        // trace，地面平移維持原本的單次路徑成本。每個子段仍逐次吃同一份坡度與
        // solidResolve，故不會以放寬閘門換假綠。
        const parts = Math.max(1, Math.ceil(Math.max(0, dy) / STEP_UP));
        let px = x, pz = z, py = y, psid = sid, pburied = buried;
        let walkable = true;
        for (let part = 1; part <= parts && walkable; part++) {
          const t = part / parts;
          const qx = x + (nx - x) * t, qz = z + (nz - z) * t;
          const at = surfacesAt(qx, qz);
          // 進入/離開結構的中間子段優先維持目標面；結構尚未覆蓋到前，留在原面，
          // 讓橋頭/洞口 transition 發生在真正的幾何交界，而非格心。
          const next = part === parts ? s : (at.find((v) => v.sid === s.sid)
            || at.find((v) => v.sid === psid));
          if (!next) { walkable = false; break; }
          const subRun = Math.hypot(qx - px, qz - pz) || run / parts;
          const subDy = next.y - py;
          if (subDy > STEP_UP || subDy < -STEP_DOWN) { walkable = false; break; }
          if (next.sid !== psid && (pburied > OPEN_M || next.buried > OPEN_M)) { walkable = false; break; }
          // 閘③-a 坡度:兩端都是裸地形才吃(與客戶端 _slopeDegAlong 的 STRUCT_M 豁免同一條)
          const bare = Math.abs(py - ground(px, pz)) <= SLOPE.STRUCT_M
                    && Math.abs(next.y - ground(qx, qz)) <= SLOPE.STRUCT_M;
          const deg = bare ? slopeDeg(ground(qx, qz) - ground(px, pz), subRun) : 0;
          if (BREAK_SLOPE ? true : slopeBlocked(deg)) { walkable = false; break; }
          // 閘③-b 實體推擠:走真 sim.solidResolve(塔/主堡/碉堡的量體由它給)
          probe.x = px; probe.z = pz; probe.y = Math.max(0, next.y);
          const [rx, rz] = sim.solidResolve(probe, px, pz, qx, qz, false);
          if (Math.hypot(rx - qx, rz - qz) > CELL * 0.4) { walkable = false; break; }
          px = qx; pz = qz; py = next.y; psid = next.sid; pburied = next.buried;
        }
        if (!walkable) continue;
        seen.add(k); queue.push([ni, nj, s.y, s.sid, s.buried]); reached.push([nx, nz, s.y]);
      }
    }
  }
  return reached;
}

function stableTags(tags) {
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return null;
  return Object.fromEntries(Object.entries(tags).sort(([a], [b]) =>
    a < b ? -1 : (a > b ? 1 : 0)));
}

function clearanceRow(st, mode, worst, at, total) {
  return {
    sourceId: st.sourceId ?? null,
    tags: stableTags(st.sourceTags),
    kind: st.kind ?? null,
    mode,
    worst,
    at,
    total,
  };
}

/**
 * 淨空列的來源帳檢查。sourceId 與 tags 必須逐列回到同一份 fixture raw way；
 * 只驗「有字串」會讓錯綁另一條 OSM way 的壞版靜默通過。
 */
function clearanceMetadataAudit(rows, fixture) {
  const raw = new Map(rawStructureWays(fixture).map((way) => [`way/${way.id}`, way]));
  const errors = [];
  for (const [index, row] of (rows || []).entries()) {
    if (!row || typeof row.sourceId !== 'string' || !row.sourceId) {
      errors.push(`row[${index}] 缺少 sourceId`);
      continue;
    }
    const source = raw.get(row.sourceId);
    if (!source) {
      errors.push(`row[${index}] sourceId 不在 raw structure ways: ${row.sourceId}`);
    } else if (JSON.stringify(stableTags(row.tags)) !== JSON.stringify(stableTags(source.tags))) {
      errors.push(`row[${index}] tags 與 ${row.sourceId} 的 raw tags 不符`);
    }
    if (!['橋', '隧道', '地下道'].includes(row.kind)) {
      errors.push(`row[${index}] kind 無效: ${row.kind ?? 'null'}`);
    }
    if (!['underpass', 'deck-only', 'tunnel'].includes(row.mode)) {
      errors.push(`row[${index}] mode 無效: ${row.mode ?? 'null'}`);
    }
    for (const key of ['worst', 'at', 'total']) {
      if (!Number.isFinite(Number(row[key]))) errors.push(`row[${index}] ${key} 非有限值`);
    }
  }
  return { ok: errors.length === 0, rows: rows?.length || 0, errors };
}

/**
 * 淨空(V-D)。`CLAUDE.md` §5 只寫「重驗『淨空 > 最大機體 4.5m + 0.2 頭頂餘裕』」卻**沒有指名腳本**
 * —— 那是一次手動檢查。這裡把它變成數字。
 *
 * **為什麼非得是數值檢查**:剖面若寫錯基準(拿半徑當拱腳之類)是**完全無聲**的 ——
 * 隧道就是一個黑洞、裡面有個黑影在動,肉眼永遠看不出來拱頂差了 2.75m。
 * 兩件事各自量:
 *   ① 洞體:天花板(路面 + CLEAR)之上還要有 ROOF_T 的板 —— 覆蓋段的**天然地表**
 *      MUST 高過板頂,否則就是「山藏不住頂板」(那一段本來就該判成明隧道);
 *   ② 橋下:跨中內側(扣掉兩端 24m 緩坡)只有淨空足夠的橋段才算「橋下可通行」；
 *      低架段必須與執行期 `surfaceAt`/`ceilingAt` 同步標成「橋面專用」，避免機體卡在橋腹。
 * 機體高度一律由 `data.js heroTargetH` 推導,MUST NOT 手寫 4.5。
 */
function clearance(structs, hf) {
  const need = MECH_H + HEAD_M;
  const out = { need, bore: [], deck: [], rows: [] };
  for (const st of structs) {
    const total = st.cum[st.cum.length - 1] || 1;
    if (st.kind === '橋') {
      let worst = Infinity, at = 0;
      for (let s = 24; s <= total - 24; s += 4) {
        const p = ptAt(st, s);
        const g = hf.heightAt(p[0], p[1]);
        if (g <= WATER.LEVEL) continue;            // 水面下沒有人會走
        const h = st.floorAt(s, p[0], p[1]) - g;
        if (h < worst) { worst = h; at = s; }
      }
      if (worst < Infinity) out.deck.push(clearanceRow(
        st, worst >= need ? 'underpass' : 'deck-only', worst, at, total));
    } else {
      let worst = Infinity, at = 0;
      for (let s = 0; s <= total; s += 4) {
        const p = ptAt(st, s);
        // 天然地表 − 板頂(路面 + 淨空 + 頂板厚):< 0 = 山藏不住頂板
        const h = hf.heightAt(p[0], p[1]) - (st.floorAt(s, p[0], p[1]) + TUN.CLEAR + TUN.ROOF_T);
        if (h < worst) { worst = h; at = s; }
      }
      if (worst < Infinity) out.bore.push(clearanceRow(
        st, st.kind === '地下道' ? 'underpass' : 'tunnel', worst, at, total));
    }
  }
  out.rows = [...out.deck, ...out.bore];
  return out;
}

const isBuildingArea = (a) => a?.tags?.building != null || a?.tags?.['building:part'] != null;
const near = (a, b, eps = 1e-7) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps;

function ringMatches(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length
    && a.every((p, i) => near(p?.[0], b[i]?.[0]) && near(p?.[1], b[i]?.[1]));
}

function polygonIndexForRing(area, ring) {
  return (area?.worldPolygons || []).findIndex((p) => ringMatches(p.outer, ring));
}

function polygonIndexForBlocker(blocker, area) {
  for (let pi = 0; pi < (area?.worldPolygons || []).length; pi++) {
    const poly = area.worldPolygons[pi];
    for (const ring of [poly.outer, ...(poly.holes || [])]) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
        if (!len) continue;
        const ry = Math.atan2(dz, dx);
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const parallel = Math.abs(Math.sin((blocker.ry || 0) - ry)) <= 1e-6;
        if (parallel && Math.hypot(mid[0] - blocker.x, mid[1] - blocker.z) <= 1e-5
          && Math.abs(len / 2 - blocker.hw2) <= 1e-5) return pi;
      }
    }
  }
  return null;
}

function flatRingDistance(x, z, ring) {
  if (!Array.isArray(ring) || ring.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) best = Math.min(best,
    ptSeg([x, z], ring[i], ring[(i + 1) % ring.length]));
  return best;
}

function footprintEdges(areas) {
  const out = [];
  for (const area of areas || []) {
    for (let polygonIndex = 0; polygonIndex < (area.worldPolygons || []).length; polygonIndex++) {
      const poly = area.worldPolygons[polygonIndex];
      for (const ring of [poly.outer, ...(poly.holes || [])]) {
        for (let i = 0; i < ring.length; i++) out.push({
          a: ring[i], b: ring[(i + 1) % ring.length], sourceId: area.sourceId,
          catalogKind: area.classification?.kind || null, polygonIndex,
        });
      }
    }
  }
  return out;
}

function osmBuildingModel(osm, cfg, ground) {
  const rawAreas = osm?.features?.areas || [];
  if (!rawAreas.length) return {
    mode: 'none', areas: [], blockers: [], platforms: [], edges: [], generated: 0,
    generatedByKind: {}, invalid: [], skipped: [], holes: 0, catalog: null,
  };
  const projected = rawAreas.map((a) => projectAreaRecord(a, llToWorld, cfg.center)).filter(Boolean);
  const catalog = catalogAreas(projected);
  const areas = catalog.areas.filter(isBuildingArea);
  const edges = footprintEdges(areas);
  if (!areas.length) return {
    mode: 'none', areas, blockers: [], platforms: [], edges, generated: 0,
    generatedByKind: {}, invalid: [], skipped: [], holes: 0, catalog,
  };
  const builder = loadOsmBuilder();
  if (typeof builder !== 'function') return {
    mode: 'pure-data', error: builder?.error || new Error('osmBuilding.js harness unavailable'),
    areas, blockers: [], platforms: [], edges, generated: 0, generatedByKind: {},
    invalid: [], skipped: [], holes: 0, catalog,
  };
  try {
    const group = { add() {} };
    // terrain.heightAt 與 biomes.js 的 buildOsmPolygonBuildings 呼叫契約相同；Fake
    // THREE 只接住 mesh，不改任何 production 幾何或 blocker 公式。
    const result = builder(group, areas, { terrain: { heightAt: ground } });
    const areaById = new Map(areas.map((a) => [a.sourceId, a]));
    const blockers = (result.blockers || []).map((b) => {
      const area = areaById.get(b.sourceId);
      return { ...b, polygonIndex: polygonIndexForBlocker(b, area), catalogKind: b.kind || area?.classification?.kind || null };
    });
    const platforms = (result.platforms || []).map((p) => {
      const area = areaById.get(p.sourceId);
      return { ...p, polygonIndex: polygonIndexForRing(area, p.outer) };
    });
    const holes = platforms.reduce((n, p) => n + (p.holes?.length || 0), 0);
    return {
      mode: 'exact-runtime', result, areas, blockers, platforms, edges, generated: result.generated || 0,
      generatedByKind: result.generatedByKind || {}, invalid: result.invalid || [], skipped: result.skipped || [],
      holes, catalog,
    };
  } catch (error) {
    return {
      mode: 'pure-data', error, areas, blockers: [], platforms: [], edges, generated: 0,
      generatedByKind: {}, invalid: [], skipped: [], holes: 0, catalog,
    };
  }
}

function boxDistance(x, z, blocker) {
  const ry = Number(blocker.ry) || 0, c = Math.cos(ry), s = Math.sin(ry);
  const lx = (x - blocker.x) * c + (z - blocker.z) * s;
  const lz = -(x - blocker.x) * s + (z - blocker.z) * c;
  const ax = Math.abs(lx), az = Math.abs(lz), hw = Number(blocker.hw2), hd = Number(blocker.hd2);
  if (![ax, az, hw, hd].every(Number.isFinite)) return Infinity;
  const dx = Math.max(ax - hw, 0), dz = Math.max(az - hd, 0);
  return dx || dz ? Math.hypot(dx, dz) : Math.min(hw - ax, hd - az);
}

function nearestBuilding(x, z, model) {
  if (model.mode === 'exact-runtime') {
    let best = null;
    for (const b of model.blockers || []) {
      const distanceM = boxDistance(x, z, b);
      if (!Number.isFinite(distanceM) || (best && distanceM >= best.distanceM)) continue;
      best = {
        type: 'building', sourceId: b.sourceId ?? null, catalogKind: b.catalogKind || b.kind || null,
        polygonIndex: b.polygonIndex ?? null, distanceM,
      };
    }
    return best;
  }
  let best = null;
  for (const e of model.edges || []) {
    const distanceM = flatRingDistance(x, z, [e.a, e.b]);
    if (!Number.isFinite(distanceM) || (best && distanceM >= best.distanceM)) continue;
    best = { type: 'building-footprint', sourceId: e.sourceId ?? null,
      catalogKind: e.catalogKind || null, polygonIndex: e.polygonIndex ?? null, distanceM };
  }
  return best;
}

function nearestStructure(x, z, structs) {
  let best = null;
  for (const st of structs || []) {
    const distanceM = Math.max(0, ptPoly([x, z], st.pts) - st.hw);
    if (!Number.isFinite(distanceM) || (best && distanceM >= best.distanceM)) continue;
    best = { type: 'structure', sourceId: st.sourceId ?? null, catalogKind: st.catalogKind || st.kind || null,
      polygonIndex: null, distanceM };
  }
  return best;
}

function nearestReached(point, reached) {
  let best = null;
  for (const q of reached || []) {
    const distanceM = Math.hypot(q[0] - point[0], q[1] - point[1]);
    if (best && distanceM >= best.distanceM) continue;
    best = { point: q, distanceM };
  }
  return best;
}

function diagnoseWaypoint(w, reached, model, structs) {
  const b = nearestBuilding(w.p[0], w.p[1], model);
  const s = nearestStructure(w.p[0], w.p[1], structs);
  const nearest = b && s ? (b.distanceM <= s.distanceM ? b : s) : (b || s || null);
  const reachedNear = nearestReached(w.p, reached);
  return {
    waypoint: w.name, point: w.p, targetY: w.y ?? null,
    nearestReached: reachedNear?.point || null, nearestReachedM: reachedNear?.distanceM ?? null,
    nearest, nearestSourceId: nearest?.sourceId ?? null, nearestCatalogKind: nearest?.catalogKind ?? null,
    nearestPolygonIndex: nearest?.polygonIndex ?? null, nearestDistanceM: nearest?.distanceM ?? null,
    nearestBlocker: b, nearestStructure: s,
  };
}

function polygonProbe(polygon, hole = false) {
  const ring = hole ? polygon?.holes?.[0] : polygon?.outer;
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const candidates = [];
  const average = ring.reduce((a, q) => [a[0] + q[0], a[1] + q[1]], [0, 0]);
  candidates.push([average[0] / ring.length, average[1] / ring.length]);
  const xs = ring.map((q) => q[0]), zs = ring.map((q) => q[1]);
  candidates.push([(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2]);
  for (let gz = 0; gz < 7; gz++) for (let gx = 0; gx < 7; gx++) candidates.push([
    Math.min(...xs) + (gx + 0.5) * (Math.max(...xs) - Math.min(...xs)) / 7,
    Math.min(...zs) + (gz + 0.5) * (Math.max(...zs) - Math.min(...zs)) / 7,
  ]);
  // 屋頂 probe 必須尊重完整 outer+holes 面域；否則排序最前的中庭建物會把
  // probe 落進洞內，`makeSurfaces` 正確不產 roof 而稽核卻誤報 roof-mutation。
  // hole probe 則刻意先在 hole ring 內，再確認仍在 outer 內，保留洞內 mutation 語意。
  return candidates.find(([x, z]) => hole
    ? pointInProjectedArea(x, z, { outer: ring, holes: [] })
      && pointInProjectedArea(x, z, { outer: polygon.outer, holes: [] })
    : pointInProjectedArea(x, z, polygon)) || null;
}

function rawStructureWays(fixture) {
  return (fixture?.responses?.roads?.elements || []).filter((w) => w?.type === 'way'
    && Array.isArray(w.geometry) && w.geometry.length >= 2
    && (w.tags?.bridge || strucTunnel(w.tags || {})));
}

function annotateStructures(structs, fixture, center, hf = null) {
  // buildStructs 先以同一個 4m 邊界餘裕裁切 way，再由 underpassPlan 對兩端做
  // 延伸；來源帳不能用 production run 的端點反推，必須拿裁切後 raw 節點作內點比對。
  const raws = rawStructureWays(fixture).flatMap((way) => {
    const segments = [];
    let current = [];
    for (const point of way.geometry) {
      const world = llToWorld(point.lat, point.lon ?? point.lng, center);
      const inside = !hf || (world[0] >= hf.minX + 4 && world[0] <= hf.maxX - 4
        && world[1] >= hf.minZ + 4 && world[1] <= hf.maxZ - 4);
      if (!inside) {
        if (current.length >= 2) segments.push(current);
        current = [];
      } else current.push(world);
    }
    if (current.length >= 2) segments.push(current);
    return segments.map((world, segmentIndex) => ({ ...way, world, segmentIndex }));
  });
  const pointDistance = (point, poly) => {
    let best = Infinity;
    for (let i = 1; i < poly.length; i++) best = Math.min(best, ptSeg(point, poly[i - 1], poly[i]));
    return best;
  };
  const coverage = (from, to) => {
    const distances = from.map((point) => pointDistance(point, to));
    return {
      max: Math.max(...distances),
      mean: distances.reduce((sum, distance) => sum + distance, 0) / distances.length,
    };
  };
  const lengthOf = (poly) => poly.slice(1).reduce((sum, point, index) =>
    sum + Math.hypot(point[0] - poly[index][0], point[1] - poly[index][1]), 0);
  for (const st of structs || []) {
    const candidates = raws.filter((raw) => st.kind === '橋' ? raw.tags?.bridge : !raw.tags?.bridge)
      .map((raw) => {
        const sourceCoverage = coverage(raw.world, st.pts);
        const productionCoverage = coverage(st.pts, raw.world);
        return {
          raw,
          sourceCoverage,
          productionCoverage,
          lengthDelta: Math.abs(lengthOf(st.pts) - lengthOf(raw.world)),
        };
      })
      .sort((a, b) => a.sourceCoverage.max - b.sourceCoverage.max
        || a.sourceCoverage.mean - b.sourceCoverage.mean
        || a.productionCoverage.max - b.productionCoverage.max
        || a.productionCoverage.mean - b.productionCoverage.mean
        || a.lengthDelta - b.lengthDelta
        || Number(a.raw.id) - Number(b.raw.id)
        || a.raw.segmentIndex - b.raw.segmentIndex);
    // source 節點是 production run 的子折線；2m 只吸收浮點誤差，距離更大的候選
    // 必須留 null 讓 provenance 稽核報紅，不可把鄰近的另一條 OSM way 誤綁進名冊。
    const best = candidates[0];
    if (best && best.raw.id != null && best.sourceCoverage.max <= 2) {
      st.sourceId = best.raw.id == null ? null : `way/${best.raw.id}`;
      st.sourceTags = stableTags(best.raw.tags);
    } else {
      st.sourceId = null;
      st.sourceTags = null;
    }
    st.catalogKind = st.kind;
  }
  return structs;
}

function fixtureContract(v, fixture) {
  const capturedTeam = Number(fixture?.team);
  const team = Number.isFinite(capturedTeam) ? capturedTeam : TEAM;
  const cfg = venueConfig(v, team);
  const expectedBBox = battleBBox(cfg);
  const observedBBox = fixture?.bbox || {};
  const observedCenter = fixture?.center || {};
  const bboxKeys = ['minLat', 'minLng', 'maxLat', 'maxLng'];
  const bboxOk = bboxKeys.every((k) => near(Number(observedBBox[k]), Number(expectedBBox[k]), 1e-9));
  const centerOk = ['lat', 'lng', 'rot'].every((k) => near(Number(observedCenter[k]), Number(cfg.center[k]), 1e-9));
  const observedQueries = fixtureQueries(fixture);
  const expectedQueries = fixtureQueries({ ...fixture, bbox: expectedBBox });
  const queryTextOk = !!fixture?.queries?.features?.text && !!fixture?.queries?.roads?.text
    && fixture.queries.features.text === expectedQueries.features
    && fixture.queries.roads.text === expectedQueries.roads;
  const observedQueryTextOk = !!fixture?.queries?.features?.text && !!fixture?.queries?.roads?.text
    && fixture.queries.features.text === observedQueries.features
    && fixture.queries.roads.text === observedQueries.roads;
  const venueIdOk = fixture?.venue?.id === v.id;
  const teamOk = capturedTeam === TEAM;
  return {
    venueId: v.id, capturedVenueId: fixture?.venue?.id ?? null, capturedTeam, teamOk,
    venueIdOk, bboxOk, centerOk, queryTextOk, observedQueryTextOk,
    ok: venueIdOk && teamOk && bboxOk && centerOk && queryTextOk,
    expectedBBox, observedBBox, expectedCenter: cfg.center, observedCenter,
  };
}

function elevationContract(v, osmFixture, elevation) {
  const cfg = venueConfig(v, TEAM);
  return elevationFixtureContract(elevation, {
    name: osmFixture?.name || null,
    venueId: v.id,
    team: TEAM,
    bbox: battleBBox(cfg),
    center: cfg.center,
    bounds: battleRect(cfg),
  });
}

function clearanceTextCompare(a, b) {
  const aa = String(a ?? ''), bb = String(b ?? '');
  return aa < bb ? -1 : (aa > bb ? 1 : 0);
}

function canonicalClearanceRow(row) {
  return {
    sourceId: row?.sourceId ?? null,
    tags: stableTags(row?.tags),
    kind: row?.kind ?? null,
    mode: row?.mode ?? null,
    worst: row?.worst ?? null,
    at: row?.at ?? null,
    total: row?.total ?? null,
  };
}

function canonicalClearanceRows(rows) {
  return (rows || []).map(canonicalClearanceRow).sort((a, b) =>
    clearanceTextCompare(a.sourceId, b.sourceId)
    || clearanceTextCompare(a.kind, b.kind)
    || clearanceTextCompare(a.mode, b.mode)
    || Number(a.at) - Number(b.at));
}

/** 由本次 scan 的 production 結構資料建出穩定名冊；不放 cell count 或耗時。 */
function clearanceManifestForResults(results) {
  const fixtures = {};
  for (const target of CLEARANCE_MANIFEST_FIXTURES) {
    const result = (results || []).find((item) => item.id === target.venueId
      && item.fixtureName === target.name && !item.skip);
    if (!result) continue;
    fixtures[target.name] = {
      venueId: target.venueId,
      team: Number(result.team),
      rows: canonicalClearanceRows(result.clearanceRows),
    };
  }
  return {
    version: CLEARANCE_MANIFEST_VERSION,
    schema: CLEARANCE_MANIFEST_SCHEMA,
    source: 'tools/audit_traverse.mjs',
    fixtures,
  };
}

function manifestNames(doc) {
  return Object.keys(doc?.fixtures || {}).sort(clearanceTextCompare);
}

function clearanceManifestErrors(doc, actual) {
  const errors = [];
  if (doc?.version !== CLEARANCE_MANIFEST_VERSION) errors.push('manifest version 不符');
  if (doc?.schema !== CLEARANCE_MANIFEST_SCHEMA) errors.push('manifest schema 不符');
  if (doc?.source !== 'tools/audit_traverse.mjs') errors.push('manifest source 不符');
  if (manifestNames(doc).some((name) => Object.prototype.hasOwnProperty.call(doc.fixtures[name] || {}, 'cells'))) {
    errors.push('manifest 不得含易漂移的 cells 欄');
  }
  const expectedNames = CLEARANCE_MANIFEST_FIXTURES.map((x) => x.name).sort(clearanceTextCompare);
  const actualNames = manifestNames(actual);
  const observedNames = manifestNames(doc);
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    errors.push(`目前輸入未同時提供兩份目標 fixture(${expectedNames.join(',')})`);
  }
  if (JSON.stringify(observedNames) !== JSON.stringify(expectedNames)) {
    errors.push(`manifest fixture 名單不符(${observedNames.join(',') || '空'})`);
  }
  for (const target of CLEARANCE_MANIFEST_FIXTURES) {
    const want = actual.fixtures?.[target.name];
    const got = doc.fixtures?.[target.name];
    if (!want || !got) continue;
    if (got.venueId !== target.venueId) errors.push(`${target.name} venueId 不符`);
    if (Number(got.team) !== Number(want.team)) errors.push(`${target.name} team 不符`);
    if (JSON.stringify(canonicalClearanceRows(got.rows))
      !== JSON.stringify(canonicalClearanceRows(want.rows))) {
      errors.push(`${target.name} clearance rows 與 production 重建結果不符`);
    }
  }
  return errors;
}

function readClearanceManifest(path) {
  if (!existsSync(path)) return { error: `找不到 manifest: ${path}` };
  try { return { doc: JSON.parse(readFileSync(path, 'utf8')) }; }
  catch (error) { return { error: `manifest JSON 無法解析: ${error.message}` }; }
}

function printClearanceReport(actual) {
  console.log(`CLEARANCE_REPORT ${CLEARANCE_MANIFEST_SCHEMA}`);
  for (const name of manifestNames(actual)) {
    const fixture = actual.fixtures[name];
    for (const row of fixture.rows) {
      console.log(JSON.stringify({ fixture: name, venueId: fixture.venueId, team: fixture.team, ...row }));
    }
  }
}

function preflightFixtures(list) {
  if (!FIXTURE_MODE || !FIXTURE_NAMES.size) return;
  console.log('固定 fixture 契約(OSM venue.id / team / bbox / center / query + 真實高程 companion)');
  for (const name of FIXTURE_NAMES) {
    const fixture = loadOsmFixture(name, FIXTURE_DIR);
    if (!fixture) {
      ok(false, `${name}:找不到或版本/schema 不符(${FIXTURE_DIR})`);
      continue;
    }
    const checks = list.map((v) => fixtureContract(v, fixture));
    const matches = checks.filter((c) => c.ok);
    if (matches.length === 1) {
      const contract = matches[0];
      const elevation = loadElevationFixture(name, ELEVATION_DIR, { validate: false });
      const matchedVenue = list.find((v) => v.id === contract.venueId);
      const elevationChecks = elevation ? elevationContract(matchedVenue, fixture, elevation) : null;
      const elevationValid = elevation
        ? validateElevationFixture(elevation, { dir: ELEVATION_DIR })
        : null;
      const elevationOk = !!elevation && !!elevationChecks?.ok && !!elevationValid?.ok;
      FIXTURE_BINDINGS.set(contract.venueId, {
        fixture, contract, elevation, elevationChecks, elevationValid,
      });
      ok(contract.ok && elevationOk,
        `${name} ↔ ${contract.venueId}:OSM 契約相容・高程 fixture ${elevationOk ? '成立' : '缺失/未驗'}`);
      if (!elevationOk) {
        const reasons = elevation
          ? [...(elevationChecks?.valid?.errors || []), ...(elevationValid?.errors || [])]
          : ['找不到同名高程 fixture'];
        console.error(`      高程未驗：${[...new Set(reasons)].join('；')}`);
      }
      continue;
    }
    ok(false, `${name}:沒有唯一相容的正式 venue.id；fixture 保持未綁定`);
    console.error(`      觀測 venue.id=${fixture.venue?.id ?? 'null'} team=${fixture.team ?? 'null'}`
      + ` center=${JSON.stringify(fixture.center)} bbox=${JSON.stringify(fixture.bbox)}`);
    const ranked = checks.slice().sort((a, b) => {
      const score = (c) => Number(!c.venueIdOk) + Number(!c.teamOk) + Number(!c.bboxOk)
        + Number(!c.centerOk) + Number(!c.queryTextOk);
      return score(a) - score(b) || String(a.venueId).localeCompare(String(b.venueId));
    }).slice(0, 3);
    for (const c of ranked) console.error(`      ${c.venueId}: venue.id=${c.venueIdOk ? '✓' : '✗'}`
      + ` team=${c.teamOk ? '✓' : '✗'} bbox=${c.bboxOk ? '✓' : '✗'} center=${c.centerOk ? '✓' : '✗'}`
      + ` query(expected)=${c.queryTextOk ? '✓' : '✗'} query(observed)=${c.observedQueryTextOk ? '✓' : '✗'}`
      + ` expectedCenter=${JSON.stringify(c.expectedCenter)} expectedBBox=${JSON.stringify(c.expectedBBox)}`);
  }
  console.log('');
}

async function scanVenue(v) {
  const cfg = venueConfig(v, TEAM);
  const bbox = battleBBox(cfg);
  let fixture = null;
  let contract = null;
  let elevation = null;
  let elevationChecks = null;
  let elevationValid = null;
  if (FIXTURE_MODE) {
    if (FIXTURE_NAMES.size) {
      const binding = FIXTURE_BINDINGS.get(v.id);
      if (!binding) return { id: v.id, skip: '不在契約相容的指定 fixture 名單', selected: false };
      fixture = binding.fixture;
      contract = binding.contract;
      elevation = binding.elevation;
      elevationChecks = binding.elevationChecks;
      elevationValid = binding.elevationValid;
    } else {
      fixture = loadOsmFixtureForVenue(v.id, FIXTURE_NAMES, FIXTURE_DIR);
    }
    if (!fixture) return { id: v.id, skip: `找不到固定 fixture(${FIXTURE_DIR})`, unverified: true };
    contract = contract || fixtureContract(v, fixture);
    if (!contract.ok) return {
      id: v.id, skip: '固定 fixture 未通過 venue.id/team/bbox/center/query 契約',
      unverified: true, fixtureMismatch: contract,
    };
    elevation = elevation || loadElevationFixture(fixture.name, ELEVATION_DIR, { validate: false });
    elevationChecks = elevationChecks || (elevation ? elevationContract(v, fixture, elevation) : null);
    elevationValid = elevationValid || (elevation
      ? validateElevationFixture(elevation, { dir: ELEVATION_DIR }) : null);
    if (!elevation || !elevationChecks?.ok || !elevationValid?.ok) {
      const reasons = elevation
        ? [...(elevationChecks?.valid?.errors || []), ...(elevationValid?.errors || [])]
        : ['找不到同名版本化真實高程 fixture'];
      return {
        id: v.id,
        skip: '固定 fixture 缺少版本化真實高程資料(未查外部、未使用平地 fallback)',
        unverified: true,
        elevationMismatch: {
          checks: elevationChecks, valid: elevationValid, reasons: [...new Set(reasons)],
        },
      };
    }
  }
  const terrainBBox = FIXTURE_MODE ? heightFieldBboxForWorldBounds(battleRect(cfg), cfg.center) : bbox;
  if (FIXTURE_MODE && !terrainBBox) {
    return {
      id: v.id,
      skip: '固定高程 fixture 無法將 runtime world bounds 轉成 LL grid 契約',
      unverified: true,
      elevationMismatch: { reasons: ['heightFieldBboxForWorldBounds 失敗'] },
    };
  }
  const sampleElev = FIXTURE_MODE
    ? fixtureElevationSampler(elevation, { bbox: terrainBBox })
    : await elevSampler(bbox);
  if (!sampleElev) return { id: v.id, skip: '取不到高程磚', unverified: true };
  const hf = buildHeightField(cfg, terrainBBox, sampleElev);

  let osm;
  if (FIXTURE_MODE) {
    osm = fixtureOsm(fixture);
  } else {
    osm = await osmFor(v.id, bbox);
  }
  const { structs, marks, carveRuns } = osm
    ? buildStructs(osm, cfg.center, hf)
    : { structs: [], marks: [], carveRuns: [] };
  annotateStructures(structs, fixture, cfg.center, hf);
  if (BREAK_CLEARANCE_SOURCE || BREAK_CLEARANCE_TAGS) {
    // 反向驗證只拔掉第一筆可辨識結構的 provenance；沒有適用列時收尾必須報錯。
    const target = structs.find((st) => st.sourceId && st.sourceTags);
    if (target) {
      if (BREAK_CLEARANCE_SOURCE) {
        target.sourceId = null;
        BREAK_CLEARANCE_APPLIED.source = true;
      }
      if (BREAK_CLEARANCE_TAGS) {
        target.sourceTags = null;
        BREAK_CLEARANCE_APPLIED.tags = true;
      }
    }
  }
  // 站立面吃**開挖後**的地形(V-C):引道路塹/地下道斜坡是挖出來的,拿天然地形走那一段
  // 就是把一條通的路報成不通。淨空檢查刻意仍吃 `hf.heightAt`(天然)—— 覆蓋門檻問的是
  // 「這座山藏不藏得住頂板」,那本來就該用未開挖的山來問。
  const ground = carveRuns.length ? makeCarvedField(hf, carveRuns) : hf.heightAt;
  const building = osmBuildingModel(osm, cfg, ground);
  const roofPlatforms = building.mode === 'exact-runtime'
    ? building.platforms.map((p, i) => ({
      ...p,
      ...(BREAK_OSM_HOLE ? { holes: [] } : {}),
      ...(BREAK_OSM_ROOF && i === 0 ? { active: false } : {}),
    })) : [];
  const surfacesAt = makeSurfaces(ground, structs, roofPlatforms);

  // 真 BattleSim:塔/主堡/碉堡的碰撞量體與塔位解都由它給(MUST NOT 另解一次)
  const sim = new BattleSim(cfg);
  // 開場預置的小兵是**動態的**,不是地形契約 ⇒ 泛洪前移除(留著會把兵線報成不通)
  for (const [id, e] of [...sim.ents]) if (e.kind !== 'tower' && e.kind !== 'base' && e.kind !== 'bunker') sim.ents.delete(id);
  const probe = sim.addHero('SWARM', 'p_probe', BIGGEST);
  sim.ents.delete(probe.id);   // 探針自己不參與碰撞(僚機由 pid 相同自動略過)
  const expectedBlockers = building.mode === 'exact-runtime' ? building.blockers : [];
  if (BREAK_OSM_BLOCKER && expectedBlockers.length) BREAK_OSM_APPLIED.blocker = true;
  const submittedBlockers = BREAK_OSM_APPLIED.blocker ? expectedBlockers.slice(1) : expectedBlockers;
  sim.setWorld({ occ: submittedBlockers.map((b) => [b.x, b.z, b.r, b.h, b.hw2, b.hd2, b.ry]) });

  const B = (side) => llToWorld(cfg.bases[side][0], cfg.bases[side][1], cfg.center);
  // BattleSim 使用 z=北、OSM/Three 使用 z=南；與 sim.llToMeters 的唯一鏡射一致。
  // 塔位與出生點都來自 BattleSim，直接把 z 帶進泛洪會驗到地圖鏡像另一側。
  const simPointToWorld = ([x, z]) => [x, -z];
  // 主堡中心是工事碰撞量體內部，直接從中心泛洪會被真 `solidResolve` 擋在原地。
  // 以正式 `_spawnPoint` 作為第二個種子，與實際玩家出生位置一致；主堡中心仍保留為航點，
  // 這樣同時驗「出生後能離堡」與「主堡座標屬於場地」，不繞過任何碰撞判定。
  const seeds = ['SWARM', 'STEEL'].flatMap((side) => [B(side), simPointToWorld(sim._spawnPoint(side, 0, 0))]);
  const wps = [
    { name: '蜂群主堡', p: B('SWARM') },
    { name: '鋼鐵主堡', p: B('STEEL') },
  ];
  (sim.towerSites || []).forEach((laneSites, li) => laneSites.forEach((site, si) => {
    for (const side of ['SWARM', 'STEEL']) {
      const cp = site[side];
      if (cp) wps.push({ name: `L${li + 1}塔${si + 1}${side === 'SWARM' ? '蜂' : '鋼'}`, p: simPointToWorld([cp.x, cp.z]) });
    }
  }));
  for (const m of marks) wps.push(m);

  const clear = clearance(structs, hf);
  const clearanceMeta = FIXTURE_MODE && fixture
    ? clearanceMetadataAudit(clear.rows, fixture) : null;
  const reached = flood(seeds, surfacesAt, hf, ground, sim, probe);
  const missWaypoints = [];
  for (const w of wps) {
    const hit = reached.some(([x, z, y]) =>
      Math.hypot(x - w.p[0], z - w.p[1]) <= HIT_R && (w.y == null || Math.abs(y - w.y) <= BUCKET_M));
    if (!hit) missWaypoints.push(w);
  }
  const miss = missWaypoints.map((w) => w.name);
  const diagnostics = missWaypoints.map((w) => diagnoseWaypoint(w, reached, building, structs));
  const osmChecks = [];
  if (building.mode === 'exact-runtime') {
    const polygonInput = building.areas
      .filter((a) => a.classification?.generator === 'polygonBuilding')
      .reduce((n, a) => n + (a.worldPolygons || []).length, 0);
    const holeInput = building.areas
      .filter((a) => a.classification?.generator === 'polygonBuilding')
      .reduce((n, a) => n + (a.worldPolygons || []).reduce((m, p) => m + (p.holes?.length || 0), 0), 0);
    if (BREAK_OSM_HOLE && holeInput > 0) BREAK_OSM_APPLIED.hole = true;
    if (BREAK_OSM_ROOF && building.platforms.length > 0) BREAK_OSM_APPLIED.roof = true;
    osmChecks.push({ kind: 'blocker', expected: expectedBlockers.length, submitted: submittedBlockers.length,
      ok: !BREAK_OSM_BLOCKER && submittedBlockers.length === expectedBlockers.length });
    osmChecks.push({ kind: 'roof', expected: building.generated, actual: building.platforms.length,
      active: roofPlatforms.filter((p) => p.active !== false).length,
      ok: !BREAK_OSM_ROOF && building.platforms.length === building.generated
        && roofPlatforms.length === building.platforms.length });
    osmChecks.push({ kind: 'hole', expected: holeInput, actual: building.holes,
      ok: !BREAK_OSM_HOLE && building.holes === holeInput });
    const holePlatform = building.platforms.find((p) => p.holes?.length && polygonProbe(p, true));
    if (holePlatform) {
      const hp = polygonProbe(holePlatform, true);
      const regular = makeSurfaces(ground, structs, [holePlatform]);
      const mutated = makeSurfaces(ground, structs, [{ ...holePlatform, holes: [] }]);
      const regularHasRoof = regular(hp[0], hp[1]).some((s) => s.roof && s.sourceId === holePlatform.sourceId);
      const mutatedHasRoof = mutated(hp[0], hp[1]).some((s) => s.roof && s.sourceId === holePlatform.sourceId);
      osmChecks.push({ kind: 'hole-mutation', point: hp, ok: !regularHasRoof && mutatedHasRoof,
        regularHasRoof, mutatedHasRoof });
    } else if (holeInput) osmChecks.push({ kind: 'hole-mutation', ok: false, reason: '找不到可驗證洞內 probe' });
    const roofPlatform = building.platforms.find((p) => polygonProbe(p));
    if (roofPlatform) {
      const rp = polygonProbe(roofPlatform);
      const roofAt = makeSurfaces(ground, structs, roofPlatforms)(rp[0], rp[1])
        .some((s) => s.roof && s.sourceId === roofPlatform.sourceId && s.y === roofPlatform.y);
      osmChecks.push({ kind: 'roof-mutation', point: rp, ok: !BREAK_OSM_ROOF && roofAt, roofAt });
    } else osmChecks.push({ kind: 'roof-mutation', ok: false, reason: '找不到可驗證屋頂 probe' });
  } else if (building.areas.length) {
    osmChecks.push({ kind: 'building-runtime', ok: false,
      reason: building.error?.message || 'production osmBuilding.js 未能在 Node harness 執行' });
  }
  return {
    id: v.id, cells: reached.length, wps: wps.length, miss, diagnostics, structs: structs.length,
    carve: carveRuns.length, osm: !!osm, clear, terrainBBox,
    fixtureName: fixture?.name || null, team: fixture?.team ?? TEAM,
    clearanceRows: clear.rows, clearanceMeta,
    fixtureContract: contract,
    elevationContract: elevationChecks, elevationValid,
    buildingMode: building.mode, buildingAreas: building.areas.length, buildingGenerated: building.generated,
    buildingBlockers: expectedBlockers.length, buildingRoofs: building.platforms.length,
    buildingHoles: building.holes, buildingError: building.error?.message || null, osmChecks,
  };
}

// ---- 主流程 ----
console.log(`== 兵線與結構可通行稽核 ==  ${TEAM}v${TEAM}、格寬 ${CELL}m、高度桶 ${BUCKET_M}m、`
  + `量體取最大機體 ${BIGGEST}(${heroTargetH(CHARACTERS[BIGGEST].kind, BIGGEST).toFixed(1)}m)`
  + `${BREAK_SLOPE ? '  ⚠ 反向驗證模式(坡度閘寫死成全擋)' : ''}`
  + `${BREAK_OSM_HOLE ? '  ⚠ break-hole' : ''}${BREAK_OSM_BLOCKER ? '  ⚠ break-blocker' : ''}`
  + `${BREAK_OSM_ROOF ? '  ⚠ break-roof' : ''}\n`);

// ---- 淨空的資料層檢查(V-D;不需網路、不需場地,CI 一定跑得到)----
// `CLAUDE.md` §5 那條「改 SOLDIER_H / HERO_SIZE.mul / BRIDGE_RISE / TUN.CLEAR 要重驗
// 淨空 > 最大機體 + 0.2」原本**沒有指名腳本** = 一次手動檢查。這裡把它變成斷言。
console.log('淨空(資料層)');
ok(TUN.CLEAR >= MECH_H + HEAD_M,
  `隧道淨空 ${TUN.CLEAR}m ≥ 最大機體 ${MECH_H.toFixed(2)}m + 頭頂餘裕 ${HEAD_M}m`);
ok(BRIDGE_RISE >= MECH_H + HEAD_M,
  `橋面抬升 ${BRIDGE_RISE}m ≥ 最大機體 ${MECH_H.toFixed(2)}m + 頭頂餘裕 ${HEAD_M}m(跨中橋下走得過)`);
console.log('');

// ---- 開挖鏡射的行為直測(V-C;合成高度場,不需網路 ⇒ CI 與沙箱都跑得到)----
// 這一段驗的是「`makeCarvedField` 真的執行到了 terrain.js 的原文」而不是「有回傳一個函式」:
// 一座 60m 的錐形山 + 一條穿過去的走廊,開挖後路廊 MUST 壓到路面高、遠場 MUST 逐位元不動、
// 過渡帶 MUST 落在兩者之間(斜壁而非垂直斷崖)。任一條不成立就是原文抽取失敗(靜默的那種)。
{
  console.log('開挖鏡射(合成場)');
  const N = 65, minX = -160, maxX = 160, minZ = -160, maxZ = 160;
  const heights = new Float32Array(N * N);
  const gxz = (i, j) => [minX + (maxX - minX) * j / (N - 1), minZ + (maxZ - minZ) * i / (N - 1)];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) { const [x, z] = gxz(i, j); heights[i * N + j] = Math.max(0, 60 - Math.hypot(x, z) * 0.5); }
  }
  const sample = (hs) => (x, z) => {
    const gj = (x - minX) / (maxX - minX) * (N - 1), gi = (z - minZ) / (maxZ - minZ) * (N - 1);
    const i0 = Math.max(0, Math.min(N - 2, Math.floor(gi))), j0 = Math.max(0, Math.min(N - 2, Math.floor(gj)));
    const fi = Math.max(0, Math.min(1, gi - i0)), fj = Math.max(0, Math.min(1, gj - j0));
    const at = (i, j) => hs[i * N + j];
    const a = at(i0, j0), b = at(i0, j0 + 1), c = at(i0 + 1, j0), d = at(i0 + 1, j0 + 1);
    return fi + fj <= 1 ? a + (b - a) * fj + (c - a) * fi : d + (c - d) * (1 - fj) + (b - d) * (1 - fi);
  };
  const nat = sample(heights);
  const hf = { heightAt: nat, minX, maxX, minZ, maxZ, heights, N };
  const FLOOR = 5, HW = 9;
  const pts = [], floors = [];
  for (let i = 0; i <= 20; i++) { pts.push([-140 + i * 14, 0]); floors.push(FLOOR); }
  const carved = makeCarvedField(hf, [{ pts, floors, hw: HW, covA: false, covB: false }]);
  ok(Math.abs(carved(0, 0) - FLOOR) < 0.01, `路廊中心壓到路面高(${carved(0, 0).toFixed(2)}m,天然 ${nat(0, 0).toFixed(0)}m)`);
  ok(carved(0, 40) === nat(0, 40), `過渡帶外逐位元不動(${carved(0, 40).toFixed(2)}m)`);
  const mid = carved(0, HW + 4);
  ok(mid > FLOOR + 0.5 && mid < nat(0, HW + 4) - 0.5, `過渡帶是斜壁不是斷崖(${mid.toFixed(2)}m 落在 ${FLOOR} 與 ${nat(0, HW + 4).toFixed(1)} 之間)`);
  ok(nat(0, 0) === 60, '天然高度場未被就地改寫(淨空檢查吃的是這一份)');
  console.log('');
}

const list = VENUES.filter((v) => !ONLY.length || ONLY.includes(v.id));
preflightFixtures(list);
const results = [];
let noOsm = 0;
let unverified = 0;
for (const v of list) {
  const t0 = Date.now();
  let r;
  // 例外 MUST NOT 被洗成「跳過」:跳過是留給**外部服務取不到**的降級(高程磚/圖資,原則 6),
  // 程式自己的 ReferenceError/TypeError 洗成跳過就是假綠 —— 收尾照印「✅ 通過 N 項」,
  // 而那 N 項裡根本沒有那個場地(前科:`WATER` 漏 import 讓 10 個有橋場地整批靜默不驗)。
  try { r = await scanVenue(v); } catch (e) { r = { id: v.id, crash: e }; }
  results.push(r);
  if (r.crash) { ok(false, `${v.id}:掃描拋出例外(不是降級,是 bug)—— ${r.crash.message}`); continue; }
  if (r.skip) {
    console.log(`  ${v.id}  ⏭  ${r.skip}`);
    if (r.fixtureMismatch) {
      unverified++;
      ok(false, `${v.id}:fixture 契約不相容，未綁定/未完成可通行驗證`);
      console.error(`      fixture observed center=${JSON.stringify(r.fixtureMismatch.observedCenter)}`
        + ` bbox=${JSON.stringify(r.fixtureMismatch.observedBBox)}`
        + ` expected center=${JSON.stringify(r.fixtureMismatch.expectedCenter)}`
        + ` bbox=${JSON.stringify(r.fixtureMismatch.expectedBBox)}`);
    } else if (r.elevationMismatch) {
      unverified++;
      ok(false, `${v.id}:固定高程 fixture 契約未成立，未完成可通行驗證`);
      console.error(`      高程未驗原因：${(r.elevationMismatch.reasons || []).join('；')}`);
    } else if (r.unverified) { unverified++; ok(false, `${v.id}:外部資料缺失，未完成可通行驗證`); }
    continue;
  }
  if (!r.osm) noOsm++;
  if (CLEARANCE_REPORT) {
    console.log(`  ${v.id}  clearance rows ${r.clearanceRows.length}`
      + `・結構 ${r.structs}・開挖走廊 ${r.carve}${r.osm ? '' : '(⚠ 取不到路網 ⇒ 只驗地形層)'}`
      + `・OSM建物 ${r.buildingMode}/${r.buildingAreas}面/${r.buildingBlockers} blockers/${r.buildingRoofs} roofs`);
  } else {
    console.log(`  ${v.id}  ${((Date.now() - t0) / 1000).toFixed(1)}s  可站立節點 ${r.cells}`
      + `・結構 ${r.structs}・開挖走廊 ${r.carve}${r.osm ? '' : '(⚠ 取不到路網 ⇒ 只驗地形層)'}`
      + `・OSM建物 ${r.buildingMode}/${r.buildingAreas}面/${r.buildingBlockers} blockers/${r.buildingRoofs} roofs`);
  }
  ok(r.miss.length === 0, `${v.id}:${r.wps} 個航點全部可達${r.miss.length ? ` —— 不可達:${r.miss.join('、')}` : ''}`);
  for (const d of r.diagnostics || []) {
    const n = d.nearest || {};
    console.error(`      waypoint=${d.waypoint} nearest=${n.type || 'none'}`
      + ` sourceId=${n.sourceId ?? 'null'} catalogKind=${n.catalogKind ?? 'null'}`
      + ` polygonIndex=${n.polygonIndex ?? 'null'} distance=${Number.isFinite(n.distanceM) ? n.distanceM.toFixed(2) : 'null'}m`
      + ` nearestReached=${Number.isFinite(d.nearestReachedM) ? d.nearestReachedM.toFixed(2) : 'null'}m`);
  }
  if (r.buildingMode === 'pure-data') {
    unverified++;
    console.error(`      OSM建物純資料診斷：${r.buildingError || 'production osmBuilding.js 未能在 Node harness 執行'}；未納入泛洪`);
  }
  for (const c of r.osmChecks || []) {
    const detail = c.reason || `expected=${c.expected ?? '-'} actual=${c.actual ?? c.submitted ?? '-'}${c.point ? ` probe=${c.point.join(',')}` : ''}`;
    ok(c.ok, `${v.id}:OSM ${c.kind} 契約${c.ok ? '成立' : `失敗(${detail})`}`);
  }
  if (r.clearanceMeta) {
    ok(r.clearanceMeta.ok,
      `${v.id}:clearance sourceId/tags provenance ${r.clearanceMeta.ok ? '成立' : '失敗'}`);
    for (const error of r.clearanceMeta.errors || []) console.error(`      clearance: ${error}`);
  }
  if (!r.osm) { unverified++; ok(false, `${v.id}:圖資缺失，只驗地形層，結構航點未驗`); }
  // 淨空(V-D):高橋段驗橋下可通行；低架段驗執行期同樣把它導向橋面專用。
  // 洞體的「山藏不住頂板」只印出來當診斷 ——
  // 那一段本來就該被 `tunnelWallProfile` 判成明隧道(柱列側是開的),不是破圖。
  for (const d of r.clear.deck) {
    if (d.mode === 'underpass') {
      ok(d.worst >= r.clear.need,
        `${v.id}:橋下淨空 ${d.worst.toFixed(2)}m ≥ ${r.clear.need.toFixed(2)}m(最大機體 ${MECH_H.toFixed(1)}m + 頭頂餘裕 ${HEAD_M}m)`);
    } else {
      ok(d.mode === 'deck-only' && d.worst < r.clear.need,
        `${v.id}:低架段 ${d.worst.toFixed(2)}m < ${r.clear.need.toFixed(2)}m，依 main.js surfaceAt/ceilingAt 視為橋面專用`);
    }
  }
  const shallow = r.clear.bore.filter((b) => b.worst < 0).length;
  if (r.clear.bore.length) {
    console.log(`      洞體覆蓋:${r.clear.bore.length} 座,最薄 `
      + `${Math.min(...r.clear.bore.map((b) => b.worst)).toFixed(2)}m`
      + `${shallow ? `(其中 ${shallow} 座有裸露段 ⇒ 應由 tunnelWallProfile 判成明隧道)` : ''}`);
  }
}

for (const [kind, requested] of Object.entries({
  hole: BREAK_OSM_HOLE, blocker: BREAK_OSM_BLOCKER, roof: BREAK_OSM_ROOF,
})) {
  if (requested && !BREAK_OSM_APPLIED[kind]) {
    ok(false, `--break-osm-${kind}:找不到適用的真實 OSM 建物，反向驗證未執行`);
  }
}

for (const [kind, requested] of Object.entries({
  source: BREAK_CLEARANCE_SOURCE, tags: BREAK_CLEARANCE_TAGS,
})) {
  if (requested && !BREAK_CLEARANCE_APPLIED[kind]) {
    ok(false, `--break-clearance-${kind}:找不到適用的淨空 provenance 列，反向驗證未執行`);
  }
}

const actualClearanceManifest = clearanceManifestForResults(results);
const actualClearanceNames = manifestNames(actualClearanceManifest);
const expectedClearanceNames = CLEARANCE_MANIFEST_FIXTURES.map((x) => x.name).sort(clearanceTextCompare);
if (CLEARANCE_REPORT && JSON.stringify(actualClearanceNames) !== JSON.stringify(expectedClearanceNames)) {
  ok(false, `--clearance-report 必須同時指定澀谷與六本木 fixture(${expectedClearanceNames.join(',')})`);
}
if (WRITE_CLEARANCE_MANIFEST) {
  if (JSON.stringify(actualClearanceNames) !== JSON.stringify(expectedClearanceNames)) {
    ok(false, `--write-clearance-manifest 必須同時重建兩份目標 fixture(${expectedClearanceNames.join(',')})`);
  } else if (fail > 0) {
    ok(false, '淨空 manifest 有未通過稽核，拒絕寫入');
  } else {
    try {
      mkdirSync(dirname(CLEARANCE_MANIFEST_PATH), { recursive: true });
      writeFileSync(CLEARANCE_MANIFEST_PATH, JSON.stringify(actualClearanceManifest, null, 2) + '\n');
      ok(true, `已寫入 deterministic clearance manifest: ${CLEARANCE_MANIFEST_PATH}`);
    } catch (error) {
      ok(false, `寫入 clearance manifest 失敗: ${error.message}`);
    }
  }
}
if (CHECK_CLEARANCE_MANIFEST) {
  const loaded = readClearanceManifest(CLEARANCE_MANIFEST_PATH);
  if (loaded.error) {
    ok(false, `clearance manifest 比對失敗: ${loaded.error}`);
  } else {
    const errors = clearanceManifestErrors(loaded.doc, actualClearanceManifest);
    ok(errors.length === 0, `clearance manifest deterministic 比對${errors.length ? '失敗' : '成立'}`);
    for (const error of errors) console.error(`      manifest: ${error}`);
  }
}
if (CLEARANCE_REPORT) printClearanceReport(actualClearanceManifest);

if (ARG.json) writeFileSync(ARG.json, JSON.stringify(results, null, 2));
if (noOsm) console.log(`\n⚠ ${noOsm} 個場地取不到路網(Overpass / OSM API 皆不可達)⇒ 結構航點未驗。`
  + '沙箱/公司網路常態如此,CI(GitHub Actions)可達。');
if (unverified) console.log(`⚠ ${unverified} 個場地含未驗資料；未驗狀態已計入失敗，不得報綠。`);
console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail === 0 ? 0 : 1);
