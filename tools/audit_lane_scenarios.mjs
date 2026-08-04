// ============ 1v1 兵線立體場景稽核(離線;找測試用預設場地)============
// 用途:回答「哪一個預設場地的 **1v1(L1)兵線**上,真的走得到某種立體交通場景」——
// 供手動測試八種情境各挑一張預設地圖:
//   ① 隧道(山體):道路平坦,鑽進突起的地形 —— 深度來自山
//   ② 地下道(平地下穿):地形平坦,路面一端往下、另一端上來 —— 深度來自挖
//      (2026-07-28 起引擎會生成:`biomes.js underpassPlan` 把平坦 tunnel way 改吃下沉剖面)
//   ③ 陸上高架橋(兵線走在**純陸域**橋面上)  ④ 明隧道(側向土牆藏不住結構那一側)
//   ⑤ 平交道(兵線與地面鐵軌平面交會)        ⑥ 穿越高架橋底部(兵線從橋下鑽過)
//   ⑦ 穿越地下道上方(兵線從洞頂走過)
//   ⑧ 其中一側有超過一座砲塔高的地形(altTier() = TARGET_H.tower,高度差加成的觸發門檻;
//      **只算一般道路段** —— 橋面/隧道/引道一律扣掉:洞裡量到的側向高差是「地下道/隧道的深度」,
//      不是可以佔領的戰術高地)
//   ⑨ 水上高架橋(兵線走在橋面上,但橋跨的是水域)
//
// ③ 與 ⑨ 是**兩種場景**(2026-08-02 使用者定案):橋下是陸地 ⇒ 橋墩之間可穿行、掉下去照樣打;
// 橋下是水域 ⇒ 橋面是唯一通路、掉下去進水。判定縫只有 `spansWater()` 一支(圖資水道相交 ∪
// 橋下地表沉在水/沼面下),兩者共用 —— MUST NOT 由場地名稱或 mix 的 water 比例臆測。
// (2026-08-02 前 ⑨ 只是「跨水橋」附帶診斷、不列場景 ⇒ 沒有任何預設地圖被標記;改制後與 ③ 同級。)
//
// 一個附帶診斷(不是場景,但選場地時要看):
//   落空地下道 圖資掛 tunnel、地形也平坦,但 underpassPlan 放棄(人行道 / 引道空間不足 /
//            要挖到 SINK_MAX 以上 / 走廊碰水)⇒ 仍當一般道路,列出來供評估
//
// 資料來源與執行期完全同源:
//   - 兵線/主堡/bbox:`venues.js venueConfig(v, 1)` + `data.js battleBBox`(teamSize=1 ⇒ L=1)
//   - 路網/鐵路/平交道:Overpass,查詢字串與 `biomes.js fetchOsmRoads/fetchOsmFeatures` 同一份;
//     Overpass 的公共鏡像對雲端 IP 幾乎一律拒絕 ⇒ 全掛時退到 OSM 官方 API 的 /map(見 OSM_API)
//   - 高程:AWS terrarium 磚(= `terrain.js` 主來源),再走同一條「3×3 平滑 → 兵線外 AMP 放大
//     → 塔位乾地帶抬升」管線,故本工具的 heightAt 與遊戲內地形同形。
//   - 隧道覆蓋/地下道規劃/明隧道判定:**直接執行 `biomes.js` 的函式原文**(tunnelCoverIntervals /
//     tunFloorAt / underpassPlan / tunnelWallProfile;抽原文的理由同 audit_open_tunnel.mjs ——
//     biomes.js 的 three 走 CDN importmap,Node 端 import 不了,另抄一份公式則永遠會通過)。
//
// 網路:第一次跑會抓圖資 + terrarium 高程,結果寫進 `tools/.scen_cache/`(之後純離線可重跑)。
// 用法:node tools/audit_lane_scenarios.mjs [--only=jinlong,london] [--json=out.json]
//      node tools/audit_lane_scenarios.mjs --probe='25.09,121.54,自強隧道;40.78,-73.97,中央公園'  ← 找新場地用
// 退出碼:0 = 八種場景各至少有一個場地;1 = 有場景無場地(需要新增測試場地)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { VENUES, venueConfig, SCEN_LABEL } from '../public/js/venues.js';
// MAPGEO 只有 `probePoint` 用得到(探測 bbox 的邊長換算)。2026-08-03 抽出 venue_field.mjs
// 時把 import 清單縮成「主掃描路徑用得到的」,連帶把它刪掉 ⇒ **探測模式自那天起整支炸掉**
// (ReferenceError: MAPGEO is not defined),而 workflow 的探測步驟是 continue-on-error、
// 主掃描又碰不到這條分支 ⇒ 沒有任何紅字。找新場地的工具就是這一支,它壞掉的症狀是
// 「② 地下道一直找不到第二張圖」而不是「有個錯誤訊息」。
import { MAPGEO, WATER, GAME, UNITS, TARGET_H, altTier, battleBBox, sideMFor, solveTowerSites } from '../public/js/data.js';
// 高度場 / 圖資 / 結構剖面的 Node 端唯一縫(audit_traverse 與淨空檢查共用同一份)
import {
  ROOT, CACHE, llToWorld, distToSegs, R_EARTH, d2r, WORLD_S,
  TUN, UND, PASS_W, ROAD_SEG, tunnelCoverIntervals, tunnelWallProfile, densify, underpassPlan,
  strucTunnel, roadWidth, strucHw, elevSampler, buildHeightField, osmFor, LANE_HW,
  segCross, ptSeg, ptPoly, arcOf, tangentAt, tunnelRunOf,
} from './venue_field.mjs';

const ARG = Object.fromEntries(process.argv.slice(2).map((s) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(s);
  return m ? [m[1], m[2] ?? '1'] : ['_', s];
}));
const ONLY = (ARG.only || '').split(',').filter(Boolean);

// ---- 場景判定門檻(遊戲公尺)----
const ON_MIN = 24;        // 「兵線走在結構上」的最短同向重疊長度
const ALIGN = 0.6;        // 同向判定 |cos|
const XING_R = 20;        // 平交道節點離兵線的容許距離(≈ 10 真實公尺)
// 側向高地掃描距離(遊戲公尺):高度差加成作用在「交戰中的兩造」⇒ 尺規取交戰距離而非貼身距離。
// 300 ≈ 英雄重武器射程上限,也就是「站在那片高地上真的打得到兵線」的最遠處。--side= 可覆寫。
const SIDE_MAX = +(ARG.side || 300);
const SIDE_STEP = 10;
const SIDE_RUN_MIN = 60;  // 高地要連續涵蓋這麼長的兵線才算「一側有高地」

/** 兵線與 way 的同向重疊區間(兵線弧長 [s0,s1] 陣列) */
function overlapRuns(laneD, laneCum, wayPts, hw) {
  const runs = [];
  let cur = null;
  for (let i = 1; i < laneD.length; i++) {
    const mid = [(laneD[i][0] + laneD[i - 1][0]) / 2, (laneD[i][1] + laneD[i - 1][1]) / 2];
    const ex = laneD[i][0] - laneD[i - 1][0], ez = laneD[i][1] - laneD[i - 1][1], l = Math.hypot(ex, ez) || 1;
    const t = tangentAt(mid, wayPts);
    const on = ptPoly(mid, wayPts) <= hw + ROAD_SEG && Math.abs((ex / l) * t[0] + (ez / l) * t[1]) >= ALIGN;
    if (on) cur = cur || [laneCum[i - 1], 0];
    if (on) cur[1] = laneCum[i];
    else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  return runs.filter(([a, b]) => b - a >= ON_MIN);
}

/**
 * 橋跨的是水域還是陸域 —— ③ 陸上高架橋 / ⑨ 水上高架橋 的**唯一分流縫**
 * (2026-07-28 起 ③ 要純陸域;2026-08-02 起水域那半升格成 ⑨,兩者共用這一支)。
 *   ① 與圖資水道相交,或 ② 橋下地表沉在水/沼面之下 —— 兩者任一即判水域。
 * 第二條是為了抓沒被畫成 waterway 的湖/潟湖/海灣(遊戲端的 splitWaterPieces 也是看高程與水色)。
 * scanVenue(兵線判定)與 probePoint(找錨點)MUST 同吃這一支,分兩份必然出現
 * 「探測說是陸橋、掃描說是水橋」這種只在特定場地現形的分歧。
 */
const WET_Y = WATER.LEVEL + WATER.SWAMP_BAND;
function makeSpansWater(waterWays, heightAt) {
  return (wpts) => {
    for (let i = 1; i < wpts.length; i++) {
      for (const wp of waterWays) {
        for (let j = 1; j < wp.length; j++) {
          if (segCross(wpts[i - 1], wpts[i], wp[j - 1], wp[j])) return '水道';
        }
      }
    }
    for (const p of densify(wpts, ROAD_SEG)) if (heightAt(p[0], p[1]) <= WET_Y) return '水面';
    return null;
  };
}

async function scanVenue(v) {
  const cfg = venueConfig(v, 1);                  // teamSize 1 ⇒ L = 1(1v1)
  const res = { id: v.id, name: v.name, synthetic: cfg.synthetic, hits: {}, notes: [] };
  if (cfg.synthetic) res.notes.push('兵線為合成弧(無 baked 真實道路)');
  const bbox = battleBBox(cfg);
  const sampleElev = await elevSampler(bbox);
  if (!sampleElev) { res.error = '高程磚下載失敗'; return res; }
  const hf = buildHeightField(cfg, bbox, sampleElev);
  const { heightAt } = hf;
  const center = cfg.center;
  const laneW = cfg.lanes[0].map(([lat, lng]) => llToWorld(lat, lng, center));
  const laneD = densify(laneW, ROAD_SEG), laneCum = arcOf(laneD);
  // 兵線頂點就是 OSM 路網節點(venueLanes.js 烘焙時取自真實道路)⇒ 「兵線是否**走在**這條 way 上」
  // 用共用節點判定最紮實:純看 2D 距離會把「正下方的人行地下道 / 正上方的空橋」誤判成同一條路。
  const k6 = (lat, lng) => `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const laneKeys = new Set(cfg.lanes[0].map(([lat, lng]) => k6(lat, lng)));
  const sharesNode = (way) => way.geometry.some((p) => laneKeys.has(k6(p.lat, p.lon)));

  const osm = await osmFor(v.id, bbox);
  if (!osm) { res.error = '取不到路網(Overpass 與 OSM API 皆不可達)'; return res; }
  res.osm = { src: osm.src || 'overpass', roads: osm.roads.length, rails: osm.rails.length,
    waters: (osm.waters || []).length, crossings: osm.crossings.length };

  // 兵線上「踩在立體結構上」的弧長區間(橋面 / 隧道含引道):⑧ 的側翼高地要扣掉這些段,
  // 使用者要的是**一般道路**上的高地對峙,不是站在橋上或洞裡比高度。
  const structArcs = [];

  const spansWater = makeSpansWater(
    (osm.waters || []).map((w) => w.geometry.map((p) => llToWorld(p.lat, p.lon, center))), heightAt);

  // ---- ①③⑤⑥ 結構 way(隧道/橋)----
  for (const way of osm.roads) {
    const isTun = strucTunnel(way.tags), isBrg = !!way.tags.bridge && !way.tags.tunnel;
    if (!isTun && !isBrg) continue;
    const hw = strucHw(way.tags);
    const wpts = way.geometry.map((p) => llToWorld(p.lat, p.lon, center));
    if (wpts.length < 2) continue;
    const runs = overlapRuns(laneD, laneCum, wpts, hw);
    const onLen = runs.reduce((s, [a, b]) => s + (b - a), 0);
    const name = way.tags.name || way.tags.highway;

    const canCarry = LANE_HW.test(way.tags.highway || '') && sharesNode(way);
    if (isBrg) {
      if (onLen >= ON_MIN && canCarry) {           // 兵線走在橋面上(車行橋 + 共用節點)
        structArcs.push(...runs);
        // ③ 陸上高架橋 = 純陸域上方;⑨ 水上高架橋 = 跨水域。同一支 spansWater 分流,兩者同級。
        const wet = spansWater(wpts);
        const key = wet ? 'waterBridge' : 'bridge';
        const cur = res.hits[key];
        if (!cur || onLen > cur.len) res.hits[key] = { name, len: Math.round(onLen), ...(wet ? { wet } : {}) };
      } else {                                     // ⑥ 兵線從橋下鑽過(純幾何交叉)
        for (let i = 1; i < laneD.length && !res.hits.underBridge; i++) {
          for (let j = 1; j < wpts.length; j++) {
            if (segCross(laneD[i - 1], laneD[i], wpts[j - 1], wpts[j])) { res.hits.underBridge = { name }; break; }
          }
        }
      }
      continue;
    }
    // 隧道/地下道:先問「執行期真的成洞嗎」(山體藏得住 → 隧道;平地 → 試挖地下道)
    const tr = tunnelRunOf(way, center, heightAt, hf);
    if (!tr || !tr.intervals.length) {
      // 圖資是地下道,山體藏不住、underpassPlan 也放棄(人行道 / 引道空間不足 / 太深 / 碰水)
      // ⇒ buildRoads 當一般道路。列出來供評估,不記成 hits(標記代表「遊戲裡真的走得到」,
      // 這裡走得到的是一條普通街道)。
      if (onLen >= ON_MIN && canCarry) {
        const cur = res.flatTunnel;
        if (!cur || onLen > cur.len) res.flatTunnel = { name, len: Math.round(onLen) };
        structArcs.push(...runs);
      }
      continue;
    }
    if (onLen >= ON_MIN && canCarry) structArcs.push(...runs);
    const covIdx = new Set();
    for (const [, , ia, ib] of tr.intervals) for (let i = ia; i <= ib; i++) covIdx.add(i);
    if (onLen >= ON_MIN && canCarry) {
      // ①/② 洞段:重疊段要真的落在覆蓋區間內(否則只是走在引道上)
      let covLen = 0;
      for (let i = 1; i < laneD.length; i++) {
        const mid = [(laneD[i][0] + laneD[i - 1][0]) / 2, (laneD[i][1] + laneD[i - 1][1]) / 2];
        if (ptPoly(mid, tr.pts) > hw + ROAD_SEG) continue;
        let k = 0, best = Infinity;
        for (let m = 0; m < tr.pts.length; m++) {
          const d = Math.hypot(mid[0] - tr.pts[m][0], mid[1] - tr.pts[m][1]);
          if (d < best) { best = d; k = m; }
        }
        if (covIdx.has(k)) covLen += laneCum[i] - laneCum[i - 1];
      }
      if (covLen >= ON_MIN) {
        // 山體隧道 = ①、地下道 = ②(深度來自山還是來自挖,是兩種場景)
        const key = tr.under ? 'underpass' : 'tunnel';
        const cur = res.hits[key];
        if (!cur || covLen > cur.len) res.hits[key] = { name, len: Math.round(covLen) };
        // ④ 明隧道:同一條隧道的側向土牆體檢(biomes.js 唯一結算縫)。
        // 地下道不在此列 —— 它的頂是沒被開挖的原地表,buildRoads 一律把 open 歸零(見 A29)。
        const cov = tr.pts.map((_, i) => covIdx.has(i));
        for (const side of [1, -1]) {
          if (tr.under) break;
          const prof = tunnelWallProfile(tr.pts, tr.floors, cov, heightAt, TUN.HW, side);
          const n = prof.filter((g) => g.open).length;
          if (n) {
            const cur2 = res.hits.gallery;
            if (!cur2 || n > cur2.pts) res.hits.gallery = { name, pts: n, side, len: Math.round(n * ROAD_SEG) };
          }
        }
      }
    } else if (!sharesNode(way)) {
      // ⑦ 穿越地下道上方:兵線不在這條隧道上(不共節點)且**橫越**它的覆蓋段 = 從洞頂走過去。
      // 只認「橫越」:平行並行的另一個孔(例如同一座山的人行孔)在高度場上與兵線同層,
      // 不是「上下分層」的測試場景 —— 那條規則放進來會讓 jinlong 的人行孔誤判成 ⑦。
      for (let i = 1; i < laneD.length && !res.hits.overTunnel; i++) {
        for (let j = 1; j < tr.pts.length; j++) {
          if (!segCross(laneD[i - 1], laneD[i], tr.pts[j - 1], tr.pts[j])) continue;
          if (covIdx.has(j) || covIdx.has(j - 1)) { res.hits.overTunnel = { name }; break; }
        }
      }
    }
  }

  // ---- ① 的候選診斷:bbox 內「執行期真的成洞」的車行隧道 + 它的**深度**----
  // 「地表高 − 路面高」在高度場上同時是「上方有多少土」與「路面沉在地表之下多深」——
  // 語意上是**深度**(2026-07-28 使用者指正):地下道的關鍵尺寸是路面下沉多少,不是頂上多厚。
  // 使用者要的 ① 是「地下道感」= 短、**淺**(路面只沉十來公尺就出來)、周邊地形平坦;
  // 金龍隧道那種深覆蓋是「山體隧道」。深度取覆蓋段的中位數。
  for (const w of osm.roads) {
    if (!strucTunnel(w.tags) || !LANE_HW.test(w.tags.highway || '') || w.geometry.length < 2) continue;
    const tr = tunnelRunOf(w, center, heightAt, hf);
    if (!tr || !tr.intervals.length) continue;
    if (tr.under) {                       // 地下道走 ② 的候選清單(深度來自挖,不是山)
      const covLen2 = tr.intervals.reduce((a, [s0, s1]) => a + (s1 - s0), 0);
      const d2 = Math.round(Math.min(...tr.pts.map((p) => ptPoly(p, laneD))));
      const c2 = { name: w.tags.name || w.tags.highway, len: Math.round(covLen2), depth: Math.round(tr.sink), d: d2 };
      if (!res.underCand || d2 < res.underCand.d) res.underCand = c2;
      continue;
    }
    const th = [];
    for (const [, , ia, ib] of tr.intervals) {
      for (let i = ia; i <= ib; i++) th.push(heightAt(tr.pts[i][0], tr.pts[i][1]) - tr.floors[i]);
    }
    if (!th.length) continue;
    th.sort((a, b) => a - b);
    const covLen = tr.intervals.reduce((a, [s0, s1]) => a + (s1 - s0), 0);
    const d = Math.round(Math.min(...tr.pts.map((p) => ptPoly(p, laneD))));
    const cand = { name: w.tags.name || w.tags.highway, len: Math.round(covLen),
                   depth: Math.round(th[th.length >> 1]), d };
    // 首選「最淺」的那條(路面沉得越少越像地下道);同深度取離兵線近的
    if (!res.tunnelCand || cand.depth < res.tunnelCand.depth
        || (cand.depth === res.tunnelCand.depth && d < res.tunnelCand.d)) res.tunnelCand = cand;
  }

  // ---- ③/⑨ 的候選診斷:bbox 內的車行高架橋(兵線沒走到也列出來),陸域/水域分開記 ----
  // 用途:某個場景缺場地時,靠這份清單判斷「哪個場地換個錨點重烤兵線就能踩上橋面」。
  for (const w of osm.roads) {
    if (!w.tags.bridge || w.tags.tunnel || !LANE_HW.test(w.tags.highway || '') || w.geometry.length < 2) continue;
    const wpts = w.geometry.map((p) => llToWorld(p.lat, p.lon, center));
    const wet = spansWater(wpts);
    let len = 0;
    for (let i = 1; i < wpts.length; i++) len += Math.hypot(wpts[i][0] - wpts[i - 1][0], wpts[i][1] - wpts[i - 1][1]);
    if (len < ON_MIN) continue;
    const d = Math.round(Math.min(...wpts.map((p) => ptPoly(p, laneD))));
    const slot = wet ? 'waterBridgeCand' : 'landBridgeCand';
    if (!res[slot] || d < res[slot].d) {
      res[slot] = { name: w.tags.name || w.tags.highway, len: Math.round(len), d, ...(wet ? { wet } : {}) };
    }
  }

  // ---- ⑦ 的候選診斷:bbox 內有沒有「任一車行道從覆蓋段隧道上方跨過」----
  // ⑦ 要的是**兵線**從洞頂走過,可遇不可求;這裡順手回報「這張地圖上存不存在這種交叉、
  // 離兵線多遠」,好判斷「換個錨點/方位角重烤兵線」有沒有機會把 ⑦ 湊出來(離兵線越近越有機會)。
  {
    const tunRuns = [];
    for (const w of osm.roads) {
      if (!strucTunnel(w.tags) || w.geometry.length < 2) continue;
      const tr = tunnelRunOf(w, center, heightAt, hf);
      if (!tr || !tr.intervals.length) continue;
      const cov = new Set();
      for (const [, , ia, ib] of tr.intervals) for (let i = ia; i <= ib; i++) cov.add(i);
      tunRuns.push({ name: w.tags.name || w.tags.highway, tr, cov });
    }
    for (const t of tunRuns) {
      for (const w of osm.roads) {
        if (w.tags.tunnel || w.tags.bridge || w.geometry.length < 2) continue;
        const rp = w.geometry.map((p) => llToWorld(p.lat, p.lon, center));
        for (let i = 1; i < rp.length; i++) {
          for (let j = 1; j < t.tr.pts.length; j++) {
            if (!segCross(rp[i - 1], rp[i], t.tr.pts[j - 1], t.tr.pts[j])) continue;
            if (!t.cov.has(j) && !t.cov.has(j - 1)) continue;
            const d = ptPoly(rp[i], laneD);
            if (!res.overTunnelCand || d < res.overTunnelCand.d) {
              res.overTunnelCand = { road: w.tags.name || w.tags.highway, tunnel: t.name, d: Math.round(d) };
            }
          }
        }
      }
    }
  }

  // ---- ⑧ 側翼高地(altTier() = 一座砲塔高 = 高度差加成門檻)----
  // 2026-07-28 使用者需求:**扣掉隧道/地下道/高架橋段**。理由是語意:在地下道裡側面地形之所以
  // 「比兵線高」,只是因為**路面沉得深**(那個高度差就是地下道的深度),不是可以佔領的戰術高地;
  // 站在橋面上比更沒有意義。要的是「一般道路的兵線,單側地形高過一座砲塔」。
  // structArcs = 兵線踩在立體結構上的弧長區間(含引道)。
  {
    const T = altTier();
    const onStruct = (sArc) => structArcs.some(([a, b]) => sArc >= a - ROAD_SEG && sArc <= b + ROAD_SEG);
    const gain = [[], []];
    for (let i = 0; i < laneD.length; i++) {
      const a = laneD[Math.max(0, i - 1)], c = laneD[Math.min(laneD.length - 1, i + 1)];
      let dx = c[0] - a[0], dz = c[1] - a[1];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const base = heightAt(laneD[i][0], laneD[i][1]);
      [1, -1].forEach((side, si) => {
        const nx = dz * side, nz = -dx * side;
        let best = -Infinity;
        for (let d = SIDE_STEP; d <= SIDE_MAX; d += SIDE_STEP) {
          best = Math.max(best, heightAt(laneD[i][0] + nx * d, laneD[i][1] + nz * d) - base);
        }
        gain[si].push(best);
      });
    }
    let bestRun = 0, peak = -Infinity, bestSide = 0;
    gain.forEach((g, si) => {
      let s0 = null;
      for (let i = 0; i < g.length; i++) {
        if (onStruct(laneCum[i])) { s0 = null; continue; }   // 結構段整段跳過(含引道)
        peak = Math.max(peak, g[i]);
        if (g[i] >= T) {
          if (s0 === null) s0 = laneCum[i];
          const run = laneCum[i] - s0;
          if (run > bestRun) { bestRun = run; bestSide = si ? -1 : 1; }
        } else s0 = null;
      }
    });
    if (bestRun >= SIDE_RUN_MIN) {
      res.hits.highGround = { len: Math.round(bestRun), peak: Math.round(peak), side: bestSide };
    }
    res.peakSide = Number.isFinite(peak) ? Math.round(peak) : null;
  }

  // ---- ④ 平交道(圖資 railway=level_crossing 節點落在兵線上)----
  for (const c of osm.crossings) {
    const p = llToWorld(c.lat, c.lng, center);
    const d = ptPoly(p, laneD);
    if (d <= XING_R) {
      const cur = res.hits.crossing;
      if (!cur || d < cur.d) res.hits.crossing = { d: Math.round(d) };
    }
  }
  return res;
}

/**
 * 探測模式(--probe=lat,lng[,名稱]):不需要 baked 兵線,只問「這個點周邊一張 L1 地圖裡,
 * 有沒有執行期真的成洞的車行隧道、覆蓋多長多厚」。用來替 ①(地下道感 = 短、覆蓋薄)找新場地。
 * 2026-08-02 起同時回報**車行高架橋**(陸域 ③ / 水域 ⑨ 分流走 makeSpansWater 同一縫)——
 * 三種使用者指定的場景(② 地下道 / ③ 陸上高架橋 / ⑨ 水上高架橋)因此一次探測就選得完錨點,
 * 不必為了找橋另跑一輪「先烤兵線再掃描」(烤一次兵線是分鐘級的 Overpass 往返)。
 * ④ 明隧道候選也在此體檢:對每條成洞山體隧道跑 `tunnelWallProfile`(與執行期同一縫)兩側,
 * 報 open 點數 × ROAD_SEG = 明隧道段長 —— 判定與兵線無關(只吃地形與隧道軸),探測即可定案。
 * bbox 與 L1 同尺寸(`--probe-r=N` 可放大 N 倍廣域掃,找到後再精確定錨);
 * 每條成洞隧道/明隧道段都回報**經緯度中點** —— L1 bbox 半徑僅 ~266 真實公尺,
 * 憑地名記憶下錨必偏,拿中點座標當錨點才擺得準。
 * heightAt 用「東西向穿過該點的假兵線」餵 AMP(探測只需大略地形)。
 */
async function probePoint(lat, lng, label) {
  const half = sideMFor(1) / 2 * MAPGEO.REAL_SCALE * MAPGEO.MAP_EXPAND * (+ARG['probe-r'] || 1);
  const dLat = half / R_EARTH * 180 / Math.PI, dLng = half / (R_EARTH * Math.cos(d2r(lat))) * 180 / Math.PI;
  const bbox = { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
  const sampleElev = await elevSampler(bbox);
  if (!sampleElev) return console.log(`${label}:高程磚下載失敗`);
  const A = [lat, lng - dLng * 0.7], B = [lat, lng + dLng * 0.7];
  const cfg = { center: { lat, lng }, bases: { SWARM: A, STEEL: B }, lanes: [[A, B]], venue: { mix: { urban: 0.6 } } };
  const hf = buildHeightField(cfg, bbox, sampleElev);
  const { heightAt } = hf;
  const osm = await osmFor(`probe_${lat.toFixed(4)}_${lng.toFixed(4)}`, bbox);
  if (!osm) return console.log(`${label}:取不到路網`);
  // 世界座標 → 經緯度(llToWorld 的逆換算;錨點擺位要用)
  const w2ll = ([x, z]) => `${(lat - z / (R_EARTH * WORLD_S) * 180 / Math.PI).toFixed(5)},${(lng + x / (R_EARTH * Math.cos(d2r(lat)) * WORLD_S) * 180 / Math.PI).toFixed(5)}`;
  const found = [];
  for (const w of osm.roads) {
    if (!strucTunnel(w.tags) || !LANE_HW.test(w.tags.highway || '') || w.geometry.length < 2) continue;
    const tr = tunnelRunOf(w, cfg.center, heightAt, hf);
    if (!tr || !tr.intervals.length) { found.push({ name: w.tags.name || w.tags.highway, flat: true }); continue; }
    const th = [];
    for (const [, , ia, ib] of tr.intervals) for (let i = ia; i <= ib; i++) th.push(heightAt(tr.pts[i][0], tr.pts[i][1]) - tr.floors[i]);
    th.sort((a, b) => a - b);
    const covList = [];
    for (const [, , ia, ib] of tr.intervals) for (let i = ia; i <= ib; i++) covList.push(i);
    const covMid = tr.pts[covList[covList.length >> 1]];
    // ④ 明隧道體檢:同 scanVenue 的判定縫(tunnelWallProfile),取兩側 open 點數較大者
    let gal = 0, galSide = 0, galMid = null;
    if (!tr.under) {
      const cov = tr.pts.map((_, i) => covList.includes(i));
      for (const side of [1, -1]) {
        const opens = [];
        tunnelWallProfile(tr.pts, tr.floors, cov, heightAt, TUN.HW, side).forEach((g, i) => { if (g.open) opens.push(i); });
        if (opens.length > gal) { gal = opens.length; galSide = side; galMid = tr.pts[opens[opens.length >> 1]]; }
      }
    }
    found.push({ name: w.tags.name || w.tags.highway, under: tr.under,
      len: Math.round(tr.intervals.reduce((a, [s0, s1]) => a + (s1 - s0), 0)),
      depth: Math.round(th[th.length >> 1]), gal, galSide,
      at: covMid ? w2ll(covMid) : '', galAt: galMid ? w2ll(galMid) : '' });
  }
  // ③/⑨ 車行高架橋:陸域/水域走 makeSpansWater(與 scanVenue 同一縫)。回報中點座標當錨點,
  // 長度取全橋(> ON_MIN 才列 —— 短於這個長度的橋,兵線就算踩上去也判不成場景)。
  const spansWater = makeSpansWater(
    (osm.waters || []).map((w) => w.geometry.map((p) => llToWorld(p.lat, p.lon, cfg.center))), heightAt);
  const bridges = [];
  for (const w of osm.roads) {
    if (!w.tags.bridge || w.tags.tunnel || !LANE_HW.test(w.tags.highway || '') || w.geometry.length < 2) continue;
    const wpts = w.geometry.map((p) => llToWorld(p.lat, p.lon, cfg.center));
    let len = 0;
    for (let i = 1; i < wpts.length; i++) len += Math.hypot(wpts[i][0] - wpts[i - 1][0], wpts[i][1] - wpts[i - 1][1]);
    if (len < ON_MIN) continue;
    bridges.push({ name: w.tags.name || w.tags.highway, len: Math.round(len),
      wet: spansWater(wpts), at: w2ll(wpts[wpts.length >> 1]) });
  }
  const land = bridges.filter((b) => !b.wet).sort((a, b) => b.len - a.len);
  const wetB = bridges.filter((b) => b.wet).sort((a, b) => b.len - a.len);

  const real = found.filter((f) => !f.flat && !f.under).sort((a, b) => a.depth - b.depth);
  const und = found.filter((f) => f.under);
  const galHits = real.filter((f) => f.gal).sort((a, b) => b.gal - a.gal);
  console.log(`${label} (${lat},${lng}) 車行隧道 ${found.length} 條、山體成洞 ${real.length} 條、地下道 ${und.length} 條、明隧道 ${galHits.length} 條、陸橋 ${land.length} 座、水橋 ${wetB.length} 座`
    + (real.length ? `　最淺山體洞:${real.slice(0, 3).map((f) => `${f.name} 覆蓋${f.len}m/深${f.depth}m @${f.at}`).join('、')}` : '')
    + (galHits.length ? `　明隧道:${galHits.slice(0, 3).map((f) => `${f.name} open ${f.gal}點≈${Math.round(f.gal * ROAD_SEG)}m(side ${f.galSide},覆蓋${f.len}m)@${f.galAt}`).join('、')}` : '')
    + (und.length ? `　地下道:${und.slice(0, 3).map((f) => `${f.name} 覆蓋${f.len}m @${f.at}`).join('、')}` : '')
    + (land.length ? `　陸上高架橋:${land.slice(0, 3).map((b) => `${b.name} ${b.len}m @${b.at}`).join('、')}` : '')
    + (wetB.length ? `　水上高架橋:${wetB.slice(0, 3).map((b) => `${b.name} ${b.len}m/${b.wet} @${b.at}`).join('、')}` : '')
    + (found.length - real.length - und.length ? `　平地不成洞 ${found.length - real.length - und.length} 條` : ''));
}

if (ARG.probe) {
  for (const spec of ARG.probe.split(';')) {
    const [la, ln, ...rest] = spec.split(',');
    await probePoint(+la, +ln, rest.join(',') || spec);
  }
  process.exit(0);
}

// ---- 主流程 ----
// 隧道與地下道是**兩種東西**,判定與分類一律分開(2026-07-28 使用者指示):
//   隧道   道路平坦,鑽進突起的地形 —— 深度來自「山」。
//   地下道 地形平坦,路面一端往下、另一端再上來 —— 深度來自「挖」。
//          2026-07-28 起引擎會生成:直線剖面藏不住天花板時改吃 `underpassPlan` 的下沉剖面
//          (兩端接引道、中段平底),覆蓋判定與後續構件一律沿用隧道那一套。
//          放棄的情形(人行道 / 引道空間不足 / 要挖到 SINK_MAX 以上 / 走廊碰水)仍當一般道路,
//          在報告裡列成「落空地下道」。
const SCEN = [
  ['tunnel', '① 隧道(山體)'],
  ['underpass', '② 地下道(平地下穿)'],
  ['bridge', '③ 陸上高架橋'],
  ['gallery', '④ 明隧道'],
  ['crossing', '⑤ 平交道'],
  ['underBridge', '⑥ 穿越高架橋底部'],
  ['overTunnel', '⑦ 穿越地下道上方'],
  ['highGround', '⑧ 一側高於一座砲塔'],
  ['waterBridge', '⑨ 水上高架橋'],
];
// 引擎尚未生成的場景:報告但不計入「缺場地」(換地圖解不了,要改引擎)。
// 2026-07-28:`underpass` 已隨 underpassPlan 落地 ⇒ 此表清空(留著結構,下一個缺口照樣掛得上)。
const KNOWN_GAP = new Map();
{ // 場景代號 MUST 與 venues.js 的 SCEN_LABEL 同集合(標記與判定分家 = 標了卻沒人驗)
  const a = SCEN.map(([k]) => k).sort().join(','), b = Object.keys(SCEN_LABEL).sort().join(',');
  if (a !== b) throw new Error(`場景代號與 venues.js SCEN_LABEL 不一致:\n  稽核 ${a}\n  標記 ${b}`);
}

// 整支時間預算(分鐘;0 = 不限)。Overpass 公共節點排隊時單一場地可能等上一分鐘,
// 22 個場地跑成一小時的 CI job 誰也看不到中途進度 ⇒ 超時就把剩下的場地標成「未掃」,
// 先把已完成的印出來。快取(.scen_cache)保留 ⇒ 下一次接著跑就會補完。
const MAX_MS = (+(ARG['max-min'] || 0)) * 60000;
const T_START = Date.now();

const list = VENUES.filter((v) => !ONLY.length || ONLY.includes(v.id));
console.log(`1v1(L1)兵線立體場景稽核 —— 場地 ${list.length}、砲塔高 ${TARGET_H.tower}m、`
  + `側向掃描 ${SIDE_MAX} 遊戲公尺(塔射程 ${UNITS.tower.range})\n`);
const results = [];
let skipped = 0;
for (const v of list) {
  if (MAX_MS && Date.now() - T_START > MAX_MS) {
    skipped++;
    console.log(`${(v.id + ' ').padEnd(15, '·')} ⏭ 時間預算用盡,未掃(快取保留,下次接著跑)`);
    continue;
  }
  const t0 = Date.now();
  const r = await scanVenue(v);
  r.secs = ((Date.now() - t0) / 1000).toFixed(0);
  results.push(r);
  const marks = SCEN.map(([k]) => (r.hits[k] ? '●' : '·')).join(' ');
  const detail = SCEN.filter(([k]) => r.hits[k]).map(([k, label]) => {
    const h = r.hits[k];
    return `${label.slice(0, 2)}${h.name ? h.name : ''}${h.len ? ` ${h.len}m` : ''}${k === 'highGround' ? ` +${h.peak}m` : ''}`;
  }).join('、');
  console.log(`${(r.id + ' ').padEnd(15, '·')} ${marks}  側向峰值 +${r.peakSide ?? '?'}m  ${r.secs}s  `
    + `${r.osm ? `[${r.osm.src} 路 ${r.osm.roads}/軌 ${r.osm.rails}/平交 ${r.osm.crossings}] ` : ''}`
    + `${r.error ? `⚠️ ${r.error}` : detail || '(無)'}`
    + `${r.landBridgeCand ? `　③候選陸橋:${r.landBridgeCand.name} ${r.landBridgeCand.len}m 離兵線 ${r.landBridgeCand.d}m` : ''}`
    + `${r.waterBridgeCand ? `　⑨候選水橋:${r.waterBridgeCand.name} ${r.waterBridgeCand.len}m/${r.waterBridgeCand.wet} 離兵線 ${r.waterBridgeCand.d}m` : ''}`
    + `${r.flatTunnel ? `　落空地下道(規劃放棄,仍是平街):${r.flatTunnel.name} ${r.flatTunnel.len}m` : ''}`
    + `${r.underCand ? `　②候選地下道:${r.underCand.name} 覆蓋 ${r.underCand.len}m/沉 ${r.underCand.depth}m 離兵線 ${r.underCand.d}m` : ''}`
    + `${r.tunnelCand ? `　①候選洞:${r.tunnelCand.name} 覆蓋 ${r.tunnelCand.len}m/深 ${r.tunnelCand.depth}m 離兵線 ${r.tunnelCand.d}m` : ''}`
    + `${r.overTunnelCand ? `　⑦候選:${r.overTunnelCand.road}×${r.overTunnelCand.tunnel} 離兵線 ${r.overTunnelCand.d}m` : ''}`);
}

console.log('\n各場景可用的 1v1 預設場地:');
let missing = 0;
const pick = {};
for (const [k, label] of SCEN) {
  const hit = results.filter((r) => r.hits[k]);
  if (KNOWN_GAP.has(k)) {                       // 已知缺口:列候選,不計入缺場地
    const cand = results.filter((r) => r.flatTunnel)
      .map((r) => `${r.id}(${r.flatTunnel.name} ${r.flatTunnel.len}m)`);
    console.log(`  ${label}:⚠️ ${KNOWN_GAP.get(k)}`);
    console.log(`      圖資上是地下道的兵線段(引擎支援後即成立):${cand.join('、') || '(無)'}`);
    continue;
  }
  if (!hit.length) {
    missing++;
    console.log(`  ${label}:❌ 沒有任何預設場地 —— 需新增測試場地`);
    // 沒場地時把候選一起印出來:離兵線多遠、規劃有沒有落空,決定要不要重烤兵線 / 換錨點
    if (k === 'underpass') {
      const cand = results.filter((r) => r.underCand).map((r) => `${r.id}(${r.underCand.name} ${r.underCand.len}m 離兵線 ${r.underCand.d}m)`);
      const lost = results.filter((r) => r.flatTunnel).map((r) => `${r.id}(${r.flatTunnel.name})`);
      console.log(`      bbox 內建得出來的地下道:${cand.join('、') || '(無)'}`);
      console.log(`      規劃落空(仍是平街):${lost.join('、') || '(無)'}`);
    }
    if (k === 'bridge' || k === 'waterBridge') {
      const slot = k === 'bridge' ? 'landBridgeCand' : 'waterBridgeCand';
      const cand = results.filter((r) => r[slot]).map((r) => `${r.id}(${r[slot].name} ${r[slot].len}m 離兵線 ${r[slot].d}m)`);
      console.log(`      bbox 內的候選橋:${cand.join('、') || '(無)'}`);
    }
    continue;
  }
  // 首選 = 該場景「量」最大的場地(隧道/橋取長度、高地取連續長度、平交道取最近)
  const score = (r) => {
    const h = r.hits[k];
    return k === 'crossing' ? -h.d : (h.len ?? h.pts ?? 1);
  };
  hit.sort((a, b) => score(b) - score(a));
  pick[k] = hit[0].id;
  console.log(`  ${label}:${hit[0].id}(${hit[0].name})　其他:${hit.slice(1).map((r) => r.id).join('、') || '—'}`);
}
// ---- venues.js 的 scen / relief 標記 MUST 對得上實測(標記是給玩家看的提示,不能是臆測)----
// relief(側翼峰值)與 scen 同一條規則:2026-08-02 起場地選單會用它推導「起伏」分級
// (venues.js reliefTier),手寫或忘了更新都會讓玩家在選單看到與地圖不符的地形說明。
// 只在「整批掃描且該場地確實取得圖資」時比對:--only= 或 Overpass 掛掉時無從判定漏標。
let tagBad = 0;
if (!ONLY.length && !skipped) {
  console.log('\nvenues.js scen / relief 標記複驗:');
  for (const r of results) {
    if (r.error) { console.log(`  ⚠️ ${r.id}:${r.error} —— 無法複驗標記`); continue; }
    const want = SCEN.map(([k]) => k).filter((k) => !KNOWN_GAP.has(k) && r.hits[k]);
    const v = VENUES.find((x) => x.id === r.id);
    const have = v.scen || [];
    const extra = have.filter((k) => !want.includes(k)), miss = want.filter((k) => !have.includes(k));
    const reliefBad = r.peakSide != null && v.relief !== r.peakSide;
    if (!extra.length && !miss.length && !reliefBad) continue;
    tagBad++;
    console.log(`  ❌ ${r.id}:${extra.length ? `多標 ${extra.join('、')}` : ''}`
      + `${extra.length && miss.length ? ' / ' : ''}${miss.length ? `漏標 ${miss.join('、')}` : ''}`
      + `${reliefBad ? `${extra.length || miss.length ? ' / ' : ''}relief ${v.relief ?? '(未標)'} ≠ 實測 ${r.peakSide}` : ''}`
      + `　實測 = [${want.join(', ')}] relief ${r.peakSide}`);
  }
  if (!tagBad) console.log('  ✓ 全數相符');
}
if (ARG.json) writeFileSync(ARG.json, JSON.stringify({ results, pick }, null, 2));
const NEED = SCEN.length - KNOWN_GAP.size;   // 已知缺口不列入分母(換地圖解不了)
console.log(`\n總結:${NEED - missing}/${NEED} 種場景有預設場地(另 ${KNOWN_GAP.size} 種為引擎已知缺口)、標記不符 ${tagBad}`
  + `${skipped ? `、未掃 ${skipped} 個場地(時間預算)` : ''}`);
process.exit(missing || tagBad || skipped ? 1 : 0);
