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
//
// 泛洪的兩個地雷(都踩過,寫在這裡免得再踩):
//   ① visited 的鍵 MUST 是 **(格, 高度桶)** —— 一格一個位元的話,每一段階梯、引道、洞口
//      都會被判成「已經走過」而回報不可達,但它們明明走得通(洞在山**下**、山頂在洞**上**,
//      同一格兩層)。
//   ② 高度桶 MUST 是**固定量化**,MUST NOT 用「±tol 內視為同一點」的模糊比對 —— 在斜坡上
//      會無限乒乓(別處實測:770k 格跑出 53.6M 次拜訪,不會結束)。
//
// 斷言的是**航點清單**不是格數:兩座主堡、每一座塔位、每一座洞的兩端洞口與洞中、每一段
// 橋面、每一條地下道引道。格數是個沒有意義的數字(地圖一改就變),航點才是契約。
//
// 網路:高程走 terrarium(快取在 tools/.scen_cache/),圖資走 Overpass → OSM API。
//      **取不到圖資時自動降級成「地形層」**(原則 6 降級不例外):主堡/塔位仍然驗,
//      結構航點列為未驗並在結尾標示 —— MUST NOT 因為取不到圖資就報綠。
// 用法:node tools/audit_traverse.mjs [--only=jinlong,taroko] [--team=1|2|3] [--cell=4] [--json=out.json]
//      node tools/audit_traverse.mjs --break-slope   ← 反向驗證:把坡度閘寫死成「什麼都擋」
// 退出碼:0 = 全部航點可達;1 = 有航點不可達
import { writeFileSync } from 'node:fs';
import { VENUES, venueConfig } from '../public/js/venues.js';
import { SLOPE, slopeDeg, slopeBlocked, battleBBox, heroTargetH, CHARACTERS } from '../public/js/data.js';
import { BattleSim } from '../server/sim.js';
import {
  llToWorld, elevSampler, buildHeightField, osmFor, tunnelRunOf, strucTunnel, strucHw,
  LANE_HW, ptSeg, arcOf, densify, ROAD_SEG, makeDeckAt, TUN, UND,
} from './venue_field.mjs';

const ARG = Object.fromEntries(process.argv.slice(2).map((s) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(s);
  return m ? [m[1], m[2] ?? '1'] : ['_', s];
}));
const ONLY = (ARG.only || '').split(',').filter(Boolean);
const TEAM = +(ARG.team || 1);
const CELL = +(ARG.cell || 4);          // 泛洪格寬(遊戲公尺)
const BREAK_SLOPE = !!ARG['break-slope'];   // 反向驗證開關(原則 9)

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

/**
 * 場地的「可站立面」模型。
 * 每個點可能有多個站立面:地表一個,加上每一座覆蓋到該點的結構(隧道/地下道/橋)各一個。
 * 每個面帶 `sid`(結構代號;地表 = -1)與 `buried`(地表高 − 該面高:> 0 = 頭頂有東西)。
 */
function makeSurfaces(hf, structs) {
  return (x, z) => {
    const ty = hf.heightAt(x, z);
    const out = [{ y: ty, sid: -1, buried: 0 }];
    for (let k = 0; k < structs.length; k++) {
      const st = structs[k];
      const s = projectArc(x, z, st);
      if (s == null) continue;
      const y = st.floorAt(s, x, z);
      out.push({ y, sid: k, buried: ty - y });
    }
    return out;
  };
}

/** 點落在結構通行寬內時回傳它的弧長座標,否則 null */
function projectArc(x, z, st) {
  let best = Infinity, bs = 0;
  const p = st.pts;
  for (let i = 1; i < p.length; i++) {
    const d = ptSeg([x, z], p[i - 1], p[i]);
    if (d < best) {
      best = d;
      const ex = p[i][0] - p[i - 1][0], ez = p[i][1] - p[i - 1][1], L2 = ex * ex + ez * ez || 1;
      let t = ((x - p[i - 1][0]) * ex + (z - p[i - 1][1]) * ez) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      bs = st.cum[i - 1] + t * Math.hypot(ex, ez);
    }
  }
  return best <= st.hw ? bs : null;
}

/** 結構清單(隧道 / 地下道 / 橋)+ 它們貢獻的航點 */
function buildStructs(osm, center, hf) {
  const structs = [], marks = [];
  for (const w of (osm?.roads || [])) {
    if (!LANE_HW.test(w.tags.highway || '') || w.geometry.length < 2) continue;
    const hw = strucHw(w.tags);
    if (strucTunnel(w.tags)) {
      const run = tunnelRunOf(w, center, hf.heightAt, hf);
      if (!run || !run.intervals.length) continue;
      const total = run.cum[run.cum.length - 1] || 1;
      const floorAt = (s) => sampleAlong(run.cum, run.floors, s);
      const st = { pts: run.pts, cum: run.cum, hw, floorAt, kind: run.under ? '地下道' : '隧道' };
      structs.push(st);
      // 航點:兩端洞口 + 每一段覆蓋區間的中點(= 真的鑽過去,不是繞到山頂上)
      for (const [a, b] of run.intervals) {
        marks.push({ name: `${st.kind}洞口A`, p: ptAt(run, a), y: floorAt(a) });
        marks.push({ name: `${st.kind}洞中`, p: ptAt(run, (a + b) / 2), y: floorAt((a + b) / 2) });
        marks.push({ name: `${st.kind}洞口B`, p: ptAt(run, b), y: floorAt(b) });
      }
      if (run.under) {   // 地下道引道:兩端各一個(引道走不通 = 掉進洞裡出不來)
        marks.push({ name: '地下道引道A', p: ptAt(run, Math.min(total, UND.EDGE + 2)), y: floorAt(Math.min(total, UND.EDGE + 2)) });
        marks.push({ name: '地下道引道B', p: ptAt(run, Math.max(0, total - UND.EDGE - 2)), y: floorAt(Math.max(0, total - UND.EDGE - 2)) });
      }
    } else if (w.tags.bridge) {
      const pts = densify(w.geometry.map((p) => llToWorld(p.lat, p.lon, center)), ROAD_SEG);
      if (pts.length < 2) continue;
      const cum = arcOf(pts);
      const total = cum[cum.length - 1] || 1;
      if (total < 24) continue;                       // 太短的「橋」是路面涵管,沒有橋面可走
      const hA = hf.heightAt(pts[0][0], pts[0][1]);
      const hB = hf.heightAt(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      const deckAt = makeDeckAt(hA, hB, total, hf.heightAt);
      const st = { pts, cum, hw, floorAt: (s, x, z) => deckAt(s, x, z), kind: '橋' };
      structs.push(st);
      const mid = total / 2;
      const mp = ptAt({ pts, cum }, mid);
      marks.push({ name: '橋面中段', p: mp, y: deckAt(mid, mp[0], mp[1]) });
    }
  }
  return { structs, marks };
}

/** 折線上弧長 s 的座標 */
function ptAt(run, s) {
  const { pts, cum } = run;
  for (let i = 1; i < cum.length; i++) {
    if (cum[i] >= s) {
      const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    }
  }
  return pts[pts.length - 1];
}
/** 沿弧長線性內插一組取樣值(隧道路面 floors 已由 tunFloorAt 逐點算好) */
function sampleAlong(cum, vals, s) {
  for (let i = 1; i < cum.length; i++) {
    if (cum[i] >= s) {
      const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
      return vals[i - 1] + (vals[i] - vals[i - 1]) * t;
    }
  }
  return vals[vals.length - 1];
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
function flood(seeds, surfacesAt, hf, sim, probe) {
  const seen = new Set();
  const key = (i, j, y) => `${i},${j},${Math.round(y / BUCKET_M)}`;
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
      const k = key(i, j, s.y);
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
        if (dy > STEP_UP || dy < -STEP_DOWN) continue;                       // 閘①
        if (s.sid !== sid && (buried > OPEN_M || s.buried > OPEN_M)) continue;   // 閘②
        const k = key(ni, nj, s.y);
        if (seen.has(k)) continue;
        // 閘③-a 坡度:兩端都是裸地形才吃(與客戶端 _slopeDegAlong 的 STRUCT_M 豁免同一條)
        const bare = Math.abs(y - hf.heightAt(x, z)) <= SLOPE.STRUCT_M
                  && Math.abs(s.y - hf.heightAt(nx, nz)) <= SLOPE.STRUCT_M;
        const deg = bare ? slopeDeg(hf.heightAt(nx, nz) - hf.heightAt(x, z), run) : 0;
        if (BREAK_SLOPE ? true : slopeBlocked(deg)) continue;
        // 閘③-b 實體推擠:走真 sim.solidResolve(塔/主堡/碉堡的量體由它給)
        probe.x = x; probe.z = z; probe.y = Math.max(0, s.y);
        const [rx, rz] = sim.solidResolve(probe, x, z, nx, nz, false);
        if (Math.hypot(rx - nx, rz - nz) > CELL * 0.4) continue;
        seen.add(k); queue.push([ni, nj, s.y, s.sid, s.buried]); reached.push([nx, nz, s.y]);
      }
    }
  }
  return reached;
}

async function scanVenue(v) {
  const cfg = venueConfig(v, TEAM);
  const bbox = battleBBox(cfg);
  const sampleElev = await elevSampler(bbox);
  if (!sampleElev) return { id: v.id, skip: '取不到高程磚' };
  const hf = buildHeightField(cfg, bbox, sampleElev);

  const osm = await osmFor(v.id, bbox);
  const { structs, marks } = osm ? buildStructs(osm, cfg.center, hf) : { structs: [], marks: [] };
  const surfacesAt = makeSurfaces(hf, structs);

  // 真 BattleSim:塔/主堡/碉堡的碰撞量體與塔位解都由它給(MUST NOT 另解一次)
  const sim = new BattleSim(cfg);
  // 開場預置的小兵是**動態的**,不是地形契約 ⇒ 泛洪前移除(留著會把兵線報成不通)
  for (const [id, e] of [...sim.ents]) if (e.kind !== 'tower' && e.kind !== 'base' && e.kind !== 'bunker') sim.ents.delete(id);
  const probe = sim.addHero('SWARM', 'p_probe', BIGGEST);
  sim.ents.delete(probe.id);   // 探針自己不參與碰撞(僚機由 pid 相同自動略過)

  const B = (side) => llToWorld(cfg.bases[side][0], cfg.bases[side][1], cfg.center);
  const seeds = [B('SWARM'), B('STEEL')];
  const wps = [
    { name: '蜂群主堡', p: B('SWARM') },
    { name: '鋼鐵主堡', p: B('STEEL') },
  ];
  (sim.towerSites || []).forEach((laneSites, li) => laneSites.forEach((site, si) => {
    for (const side of ['SWARM', 'STEEL']) {
      const cp = site[side];
      if (cp) wps.push({ name: `L${li + 1}塔${si + 1}${side === 'SWARM' ? '蜂' : '鋼'}`, p: [cp.x, cp.z] });
    }
  }));
  for (const m of marks) wps.push(m);

  const reached = flood(seeds, surfacesAt, hf, sim, probe);
  const miss = [];
  for (const w of wps) {
    const hit = reached.some(([x, z, y]) =>
      Math.hypot(x - w.p[0], z - w.p[1]) <= HIT_R && (w.y == null || Math.abs(y - w.y) <= BUCKET_M));
    if (!hit) miss.push(w.name);
  }
  return { id: v.id, cells: reached.length, wps: wps.length, miss, structs: structs.length, osm: !!osm };
}

// ---- 主流程 ----
console.log(`== 兵線與結構可通行稽核 ==  ${TEAM}v${TEAM}、格寬 ${CELL}m、高度桶 ${BUCKET_M}m、`
  + `量體取最大機體 ${BIGGEST}(${heroTargetH(CHARACTERS[BIGGEST].kind, BIGGEST).toFixed(1)}m)`
  + `${BREAK_SLOPE ? '  ⚠ 反向驗證模式(坡度閘寫死成全擋)' : ''}\n`);

const list = VENUES.filter((v) => !ONLY.length || ONLY.includes(v.id));
const results = [];
let noOsm = 0;
for (const v of list) {
  const t0 = Date.now();
  let r;
  try { r = await scanVenue(v); } catch (e) { r = { id: v.id, skip: e.message }; }
  results.push(r);
  if (r.skip) { console.log(`  ${v.id}  ⏭  ${r.skip}`); continue; }
  if (!r.osm) noOsm++;
  console.log(`  ${v.id}  ${((Date.now() - t0) / 1000).toFixed(1)}s  可站立節點 ${r.cells}`
    + `・結構 ${r.structs}${r.osm ? '' : '(⚠ 取不到路網 ⇒ 只驗地形層)'}`);
  ok(r.miss.length === 0, `${v.id}:${r.wps} 個航點全部可達${r.miss.length ? ` —— 不可達:${r.miss.join('、')}` : ''}`);
}

if (ARG.json) writeFileSync(ARG.json, JSON.stringify(results, null, 2));
if (noOsm) console.log(`\n⚠ ${noOsm} 個場地取不到路網(Overpass / OSM API 皆不可達)⇒ 結構航點未驗。`
  + '沙箱/公司網路常態如此,CI(GitHub Actions)可達。');
console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail === 0 ? 0 : 1);
