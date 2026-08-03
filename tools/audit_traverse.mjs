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
// WATER 是橋下淨空那一段在用的(水面下不算「走得過去」)。漏了它不會報錯 ——
// `scanVenue` 整段包在 try 裡,ReferenceError 會被吞成「⏭ 場地跳過」⇒ 每一個**有橋**的
// 場地都靜默不驗,而收尾只會印「通過 N 項」看起來全綠(實測 27 場地跳掉 10 個)。
import { SLOPE, slopeDeg, slopeBlocked, battleBBox, heroTargetH, CHARACTERS, WATER } from '../public/js/data.js';
import { BattleSim } from '../server/sim.js';
import {
  llToWorld, elevSampler, buildHeightField, osmFor, tunnelRunOf, strucTunnel, strucHw,
  LANE_HW, ptSeg, arcOf, densify, ROAD_SEG, makeDeckAt, makeCarvedField, TUN, UND, BRIDGE_RISE,
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
const MECH_H = heroTargetH(CHARACTERS[BIGGEST].kind, BIGGEST);
const HEAD_M = 0.2;   // 頭頂餘裕(CLAUDE.md §5「淨空 > 最大機體 + 0.2」)

/**
 * 場地的「可站立面」模型。
 * 每個點可能有多個站立面:地表一個,加上每一座覆蓋到該點的結構(隧道/地下道/橋)各一個。
 * 每個面帶 `sid`(結構代號;地表 = -1)與 `buried`(地表高 − 該面高:> 0 = 頭頂有東西)。
 */
function makeSurfaces(ground, structs) {
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

/** 結構清單(隧道 / 地下道 / 橋)+ 它們貢獻的航點 + 開挖走廊(carveTunnels 的輸入) */
function buildStructs(osm, center, hf) {
  const structs = [], marks = [], carveRuns = [];
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
      // 開挖走廊(V-C):`carveTunnels` 吃的是**敞開補集**(引道 / 路塹),不是覆蓋段本身 ——
      // 洞體是把三角形整片刪掉,不是把山壓平。分段規則逐字鏡射 `biomes.js` 那一段
      // (bounds = [頭, 各覆蓋段的頂點索引…, 尾],成對取);cut 旗標 = 地下道引道收窄成垂直路塹。
      // 少了這一步,泛洪就是拿**天然**地形在走引道 —— 一條靠開挖才通的路會被報成不可達,
      // 而那是假紅字,比沒驗還糟。
      {
        const bounds = [0, ...run.intervals.flatMap(([, , ia, ib]) => [ia, ib]), run.pts.length - 1];
        for (let k = 0; k + 1 < bounds.length; k += 2) {
          const a = bounds[k], b = bounds[k + 1];
          if (!(b - a >= 1)) continue;
          carveRuns.push({ pts: run.pts.slice(a, b + 1), floors: run.floors.slice(a, b + 1),
            covA: k > 0, covB: k + 2 < bounds.length, hw, cut: !!run.under });
        }
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
  return { structs, marks, carveRuns };
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
function flood(seeds, surfacesAt, hf, ground, sim, probe) {
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
        const bare = Math.abs(y - ground(x, z)) <= SLOPE.STRUCT_M
                  && Math.abs(s.y - ground(nx, nz)) <= SLOPE.STRUCT_M;
        const deg = bare ? slopeDeg(ground(nx, nz) - ground(x, z), run) : 0;
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

/**
 * 淨空(V-D)。`CLAUDE.md` §5 只寫「重驗『淨空 > 最大機體 4.5m + 0.2 頭頂餘裕』」卻**沒有指名腳本**
 * —— 那是一次手動檢查。這裡把它變成數字。
 *
 * **為什麼非得是數值檢查**:剖面若寫錯基準(拿半徑當拱腳之類)是**完全無聲**的 ——
 * 隧道就是一個黑洞、裡面有個黑影在動,肉眼永遠看不出來拱頂差了 2.75m。
 * 兩件事各自量:
 *   ① 洞體:天花板(路面 + CLEAR)之上還要有 ROOF_T 的板 —— 覆蓋段的**天然地表**
 *      MUST 高過板頂,否則就是「山藏不住頂板」(那一段本來就該判成明隧道);
 *   ② 橋下:跨中內側(扣掉兩端 24m 緩坡)的橋面到地表 MUST 塞得下最大機體。
 * 機體高度一律由 `data.js heroTargetH` 推導,MUST NOT 手寫 4.5。
 */
function clearance(structs, hf) {
  const need = MECH_H + HEAD_M;
  const out = { need, bore: [], deck: [] };
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
      if (worst < Infinity) out.deck.push({ worst, at, total });
    } else {
      let worst = Infinity, at = 0;
      for (let s = 0; s <= total; s += 4) {
        const p = ptAt(st, s);
        // 天然地表 − 板頂(路面 + 淨空 + 頂板厚):< 0 = 山藏不住頂板
        const h = hf.heightAt(p[0], p[1]) - (st.floorAt(s, p[0], p[1]) + TUN.CLEAR + TUN.ROOF_T);
        if (h < worst) { worst = h; at = s; }
      }
      if (worst < Infinity) out.bore.push({ worst, at, total, kind: st.kind });
    }
  }
  return out;
}

async function scanVenue(v) {
  const cfg = venueConfig(v, TEAM);
  const bbox = battleBBox(cfg);
  const sampleElev = await elevSampler(bbox);
  if (!sampleElev) return { id: v.id, skip: '取不到高程磚' };
  const hf = buildHeightField(cfg, bbox, sampleElev);

  const osm = await osmFor(v.id, bbox);
  const { structs, marks, carveRuns } = osm
    ? buildStructs(osm, cfg.center, hf)
    : { structs: [], marks: [], carveRuns: [] };
  // 站立面吃**開挖後**的地形(V-C):引道路塹/地下道斜坡是挖出來的,拿天然地形走那一段
  // 就是把一條通的路報成不通。淨空檢查刻意仍吃 `hf.heightAt`(天然)—— 覆蓋門檻問的是
  // 「這座山藏不藏得住頂板」,那本來就該用未開挖的山來問。
  const ground = carveRuns.length ? makeCarvedField(hf, carveRuns) : hf.heightAt;
  const surfacesAt = makeSurfaces(ground, structs);

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

  const clear = clearance(structs, hf);
  const reached = flood(seeds, surfacesAt, hf, ground, sim, probe);
  const miss = [];
  for (const w of wps) {
    const hit = reached.some(([x, z, y]) =>
      Math.hypot(x - w.p[0], z - w.p[1]) <= HIT_R && (w.y == null || Math.abs(y - w.y) <= BUCKET_M));
    if (!hit) miss.push(w.name);
  }
  return { id: v.id, cells: reached.length, wps: wps.length, miss, structs: structs.length,
    carve: carveRuns.length, osm: !!osm, clear };
}

// ---- 主流程 ----
console.log(`== 兵線與結構可通行稽核 ==  ${TEAM}v${TEAM}、格寬 ${CELL}m、高度桶 ${BUCKET_M}m、`
  + `量體取最大機體 ${BIGGEST}(${heroTargetH(CHARACTERS[BIGGEST].kind, BIGGEST).toFixed(1)}m)`
  + `${BREAK_SLOPE ? '  ⚠ 反向驗證模式(坡度閘寫死成全擋)' : ''}\n`);

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
const results = [];
let noOsm = 0;
for (const v of list) {
  const t0 = Date.now();
  let r;
  // 例外 MUST NOT 被洗成「跳過」:跳過是留給**外部服務取不到**的降級(高程磚/圖資,原則 6),
  // 程式自己的 ReferenceError/TypeError 洗成跳過就是假綠 —— 收尾照印「✅ 通過 N 項」,
  // 而那 N 項裡根本沒有那個場地(前科:`WATER` 漏 import 讓 10 個有橋場地整批靜默不驗)。
  try { r = await scanVenue(v); } catch (e) { r = { id: v.id, crash: e }; }
  results.push(r);
  if (r.crash) { ok(false, `${v.id}:掃描拋出例外(不是降級,是 bug)—— ${r.crash.message}`); continue; }
  if (r.skip) { console.log(`  ${v.id}  ⏭  ${r.skip}`); continue; }
  if (!r.osm) noOsm++;
  console.log(`  ${v.id}  ${((Date.now() - t0) / 1000).toFixed(1)}s  可站立節點 ${r.cells}`
    + `・結構 ${r.structs}・開挖走廊 ${r.carve}${r.osm ? '' : '(⚠ 取不到路網 ⇒ 只驗地形層)'}`);
  ok(r.miss.length === 0, `${v.id}:${r.wps} 個航點全部可達${r.miss.length ? ` —— 不可達:${r.miss.join('、')}` : ''}`);
  // 淨空(V-D):橋下塞不塞得下最大機體。洞體的「山藏不住頂板」只印出來當診斷 ——
  // 那一段本來就該被 `tunnelWallProfile` 判成明隧道(柱列側是開的),不是破圖。
  for (const d of r.clear.deck) {
    ok(d.worst >= r.clear.need,
      `${v.id}:橋下淨空 ${d.worst.toFixed(2)}m ≥ ${r.clear.need.toFixed(2)}m(最大機體 ${MECH_H.toFixed(1)}m + 頭頂餘裕 ${HEAD_M}m)`);
  }
  const shallow = r.clear.bore.filter((b) => b.worst < 0).length;
  if (r.clear.bore.length) {
    console.log(`      洞體覆蓋:${r.clear.bore.length} 座,最薄 `
      + `${Math.min(...r.clear.bore.map((b) => b.worst)).toFixed(2)}m`
      + `${shallow ? `(其中 ${shallow} 座有裸露段 ⇒ 應由 tunnelWallProfile 判成明隧道)` : ''}`);
  }
}

if (ARG.json) writeFileSync(ARG.json, JSON.stringify(results, null, 2));
if (noOsm) console.log(`\n⚠ ${noOsm} 個場地取不到路網(Overpass / OSM API 皆不可達)⇒ 結構航點未驗。`
  + '沙箱/公司網路常態如此,CI(GitHub Actions)可達。');
console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail === 0 ? 0 : 1);
