// ============ 兵線 × 隧道/橋樑 進出口 + 砲塔洞口射程稽核(離線,讀 .osm_cache)============
// venueLanes.js 的兵線是「簡化過的」OSM 路徑(共線節點被丟棄,常含洞口本身)——
// 直接看相鄰頂點會誤判「從地面跳進隧道中段」。因此:
//   ① 以快取路網重建完整節點路徑(相鄰頂點間沿 way 走廊 Dijkstra 還原被簡化的節點);
//   ② 沿完整路徑掃「地面 ↔ 結構(tunnel/bridge)」切換:切換節點 MUST 是該結構 way 的
//      端點節點(= 洞口/橋台);切換發生在結構 way 中段節點 = 側面進入,違規。
//   ③ 兵線與結構走廊純幾何交叉(不共節點)= 立體交叉,物理已隔開,計 info。
//   ④ **規則 #5**:隧道段內的砲塔至少要有 GAME.TOWER_TUNNEL_OUT_F 的射程涵蓋到洞口外
//      (判定走 data.js 的唯一結算縫 towerTunnelAudit;塔位由 solveTowerSites 解出)。
// 隧道段取「圖資 tunnel way 全長」= **保守上界**:執行期真正成洞的只有地形蓋得住的覆蓋段
// (biomes.tunnelCoverIntervals),平坦市區的 tunnel way 根本不立結構 ⇒ 這裡報的違規是上界,
// 山地場地才是真違規(平地場地需以瀏覽器冒煙確認 portals 是否真的建出來)。
// 用法:node tools/audit_lane_grade_sep.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VENUE_LANES } from '../public/js/venueLanes.js';
import { UNITS, GAME, MAPGEO, towerTunnelAudit } from '../public/js/data.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, '.osm_cache');
const CORRIDOR = 9;    // 結構走廊半寬(≈ TUN.HW / PASS_W/2),幾何交叉判定用
const REBUILD_W = 30;  // 路徑重建走廊半寬(公尺):被簡化的節點理應緊貼直線段
const SC = 1 / MAPGEO.REAL_SCALE;   // 真實公尺 → 遊戲公尺(規則判定與 runtime 同尺度)
const SPAN_GAP = 36;   // 相鄰隧道段縫合門檻(遊戲公尺;同 biomes.TUN_GAP_CLOSE —— 雙孔/分段 way 視為同一座洞)

const k6 = (lat, lon) => `${lat.toFixed(6)},${lon.toFixed(6)}`;

const filesByVenue = new Map();
for (const f of readdirSync(CACHE)) {
  const id = f.split('_')[0];
  if (!filesByVenue.has(id)) filesByVenue.set(id, []);
  filesByVenue.get(id).push(f);
}

const meters = (lat0) => {
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  return (lat, lon) => [lon * kx, lat * ky];
};

function ptSegDist(px, py, ax, ay, bx, by) {
  const ex = bx - ax, ey = by - ay;
  const L2 = ex * ex + ey * ey || 1;
  let t = ((px - ax) * ex + (py - ay) * ey) / L2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + ex * t), py - (ay + ey * t));
}

/** 點投影到折線 → 弧長(規則 #5:完整節點路徑上的隧道端點 → 簡化兵線上的弧長位置) */
function projArc(px, py, pts, cum) {
  let best = Infinity, bs = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1;
    let t = ((px - ax) * ex + (py - ay) * ey) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(px - (ax + ex * t), py - (ay + ey * t));
    if (d < best) { best = d; bs = cum[i - 1] + t * Math.hypot(ex, ey); }
  }
  return bs;
}

function segDist(ax, ay, bx, by, cx, cy, dx, dy) {
  const cross = (ox, oy, px, py, qx, qy) => (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
  const d1 = cross(ax, ay, bx, by, cx, cy), e1 = cross(ax, ay, bx, by, dx, dy);
  const d3 = cross(cx, cy, dx, dy, ax, ay), e3 = cross(cx, cy, dx, dy, bx, by);
  if (((d1 > 0) !== (e1 > 0)) && ((d3 > 0) !== (e3 > 0))) return 0;
  return Math.min(ptSegDist(cx, cy, ax, ay, bx, by), ptSegDist(dx, dy, ax, ay, bx, by),
    ptSegDist(ax, ay, cx, cy, dx, dy), ptSegDist(bx, by, cx, cy, dx, dy));
}

let violations = 0, traversals = 0, crossings = 0, endsOn = 0, rebuildFails = 0;
let tunLanes = 0, tunTowers = 0, tunBad = 0;   // 規則 #5 統計
for (const [venue, byL] of Object.entries(VENUE_LANES)) {
  const files = filesByVenue.get(venue) || [];
  if (!files.length) { console.log(`${venue}: 無快取,跳過`); continue; }
  const raw = [];
  for (const f of files) {
    try { raw.push(...JSON.parse(readFileSync(join(CACHE, f), 'utf8'))); } catch { /* 壞檔跳過 */ }
  }
  const ways = raw.filter((w) => w?.tags && w.geometry?.length >= 2).map((w, wi) => ({
    id: wi, kind: w.tags.tunnel ? 'tunnel' : w.tags.bridge ? 'bridge' : null,
    name: w.tags.name || w.tags.highway || '?', g: w.geometry,
  }));

  for (const [L, entry] of Object.entries(byL)) {
    if (!entry?.lanes) continue;
    const toM = meters(entry.bases[0][0]);
    // ---- 路網圖(節點 = k6 座標;邊帶所屬 way 與該節點在 way 內是否端點)----
    const nodeXY = new Map();                 // key -> [x, z]
    const adj = new Map();                    // key -> [{to, w, way}]
    const memb = new Map();                   // key -> [{way, interior:boolean}]
    const addM = (k, way, interior) => {
      let a = memb.get(k);
      if (!a) { a = []; memb.set(k, a); }
      a.push({ way, interior });
    };
    for (const w of ways) {
      const ks = w.g.map((p) => k6(p.lat, p.lon));
      ks.forEach((k, i) => {
        if (!nodeXY.has(k)) nodeXY.set(k, toM(w.g[i].lat, w.g[i].lon));
        addM(k, w, i !== 0 && i !== ks.length - 1);
      });
      for (let i = 1; i < ks.length; i++) {
        const a = ks[i - 1], b = ks[i];
        const pa = nodeXY.get(a), pb = nodeXY.get(b);
        const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
        if (!adj.has(a)) adj.set(a, []);
        if (!adj.has(b)) adj.set(b, []);
        adj.get(a).push({ to: b, w: d, way: w });
        adj.get(b).push({ to: a, w: d, way: w });
      }
    }
    // 相鄰頂點間的路徑重建:限制在直線段 REBUILD_W 走廊內的 Dijkstra
    const rebuild = (ka, kb) => {
      const A = nodeXY.get(ka), B = nodeXY.get(kb);
      if (!A || !B) return null;
      const inCorr = (k) => {
        const p = nodeXY.get(k);
        return ptSegDist(p[0], p[1], A[0], A[1], B[0], B[1]) < REBUILD_W;
      };
      const dist = new Map([[ka, 0]]), prev = new Map();
      const Q = [[0, ka]];
      while (Q.length) {
        let bi = 0;
        for (let i = 1; i < Q.length; i++) if (Q[i][0] < Q[bi][0]) bi = i;
        const [d, k] = Q.splice(bi, 1)[0];
        if (k === kb) break;
        if (d > (dist.get(k) ?? Infinity)) continue;
        for (const e of adj.get(k) || []) {
          if (!inCorr(e.to)) continue;
          const nd = d + e.w;
          if (nd < (dist.get(e.to) ?? Infinity)) {
            dist.set(e.to, nd);
            prev.set(e.to, { k, way: e.way });
            Q.push([nd, e.to]);
          }
        }
      }
      if (!dist.has(kb)) return null;
      const path = [];
      let cur = kb;
      while (cur !== ka) {
        const p = prev.get(cur);
        path.push({ k: cur, way: p.way });   // 抵達 cur 用的邊所屬 way
        cur = p.k;
      }
      path.push({ k: ka, way: null });
      return path.reverse();                 // [{k, way(進入該節點的邊)}]
    };

    // 規則 #5 前置:兵線轉遊戲公尺(與 solveTowerSites 同尺度)+ 逐線隧道弧長區間。
    // toM 是絕對經緯投影(座標 ~1e7)⇒ 先以兵線起點為原點平移,免浮點精度損失。
    const [ox, oz] = toM(entry.lanes[0][0][0], entry.lanes[0][0][1]);
    const toG = (lat, lng) => { const [x, z] = toM(lat, lng); return [(x - ox) * SC, (z - oz) * SC]; };
    const lanesGame = entry.lanes.map((lane) => lane.map(([lat, lng]) => toG(lat, lng)));
    const spansByLane = entry.lanes.map(() => []);

    entry.lanes.forEach((lane, li) => {
      const keys = lane.map(([lat, lng]) => k6(lat, lng));
      // 完整節點路徑(帶每一步的邊 way)
      const full = [{ k: keys[0], way: null }];
      let ok = true;
      for (let i = 1; i < keys.length; i++) {
        const seg = rebuild(keys[i - 1], keys[i]);
        if (!seg) { ok = false; break; }
        full.push(...seg.slice(1));
      }
      if (!ok) {
        rebuildFails++;
        console.log(`⚠️ ${venue} L${L} lane${li}:路徑重建失敗(頂點不在快取路網走廊內),略過`);
        return;
      }
      // 掃結構切換:進入邊 way.kind 變化的節點 = 切換點
      let curKind = null, curWay = null, entered = false;
      for (let i = 1; i < full.length; i++) {
        const { k, way } = full[i];
        const kind = way.kind;
        if (kind !== curKind) {
          const node = full[i - 1].k;              // 切換發生在上一個節點(邊的起點)
          const m = memb.get(node) || [];
          if (kind) {                              // 地面/另一結構 → 進入 kind 結構
            traversals++; entered = true;
            // 洞口 = 該節點是「進入的那條結構 way」的端點
            const okPortal = m.some((x) => x.way === way && !x.interior);
            if (!okPortal) {
              violations++;
              console.log(`❌ ${venue} L${L} lane${li} 從 ${kind}「${way.name}」中段節點切入 —— 側面進入(${node})`);
            }
          }
          if (curKind) {                           // 離開 curKind 結構
            const okPortal = m.some((x) => x.way === curWay && !x.interior)
              || m.some((x) => x.way.kind === curKind && !x.interior);
            if (!okPortal) {
              violations++;
              console.log(`❌ ${venue} L${L} lane${li} 從 ${curKind}「${curWay.name}」中段節點切出 —— 側面離開(${node})`);
            }
          }
          curKind = kind; curWay = way;
        } else if (kind && way !== curWay) curWay = way;   // 結構內換 way(分段/會車道)合法
      }
      // 規則 #5:完整節點路徑上的 tunnel 邊 → 簡化兵線上的弧長區間(遊戲公尺)
      {
        const gpts = lanesGame[li], cum = [0];
        for (let i = 1; i < gpts.length; i++) cum.push(cum[i - 1] + Math.hypot(gpts[i][0] - gpts[i - 1][0], gpts[i][1] - gpts[i - 1][1]));
        const raw = [];
        let cur = null;
        for (let i = 1; i < full.length; i++) {
          if (full[i].way.kind === 'tunnel') {
            const a = nodeXY.get(full[i - 1].k), b = nodeXY.get(full[i].k);
            const sa = projArc((a[0] - ox) * SC, (a[1] - oz) * SC, gpts, cum);
            const sb = projArc((b[0] - ox) * SC, (b[1] - oz) * SC, gpts, cum);
            const lo = Math.min(sa, sb), hi = Math.max(sa, sb);
            if (!cur) cur = [lo, hi];
            else { cur[0] = Math.min(cur[0], lo); cur[1] = Math.max(cur[1], hi); }
          } else if (cur) { raw.push(cur); cur = null; }
        }
        if (cur) raw.push(cur);
        for (const s of raw.sort((p, q) => p[0] - q[0])) {   // 雙孔/分段 way 縫成同一座洞
          const last = spansByLane[li][spansByLane[li].length - 1];
          if (last && s[0] - last[1] <= SPAN_GAP) last[1] = Math.max(last[1], s[1]);
          else spansByLane[li].push([...s]);
        }
      }
      // 端點落在結構上(主堡在橋面/隧道內):資訊性警告
      for (const [vi, tag] of [[0, '起點'], [keys.length - 1, '終點']]) {
        const m = memb.get(keys[vi]) || [];
        const stru = m.find((x) => x.way.kind);
        if (stru && m.every((x) => x.way.kind)) {
          endsOn++;
          console.log(`⚠️ ${venue} L${L} lane${li} ${tag}(主堡)落在 ${stru.way.kind}「${stru.way.name}」上`);
        }
      }
      if (entered) return;
      // 純幾何交叉(不共節點)檢查
      const lxy = lane.map(([lat, lng]) => toM(lat, lng));
      let crosses = false;
      outer: for (let i = 1; i < lxy.length; i++) {
        for (const w of ways) {
          if (!w.kind) continue;
          for (let j = 1; j < w.g.length; j++) {
            const a = toM(w.g[j - 1].lat, w.g[j - 1].lon), b = toM(w.g[j].lat, w.g[j].lon);
            if (segDist(lxy[i - 1][0], lxy[i - 1][1], lxy[i][0], lxy[i][1],
              a[0], a[1], b[0], b[1]) < CORRIDOR) { crosses = true; break outer; }
          }
        }
      }
      if (crosses) crossings++;
    });

    // ---- 規則 #5 判定(唯一結算縫 data.js towerTunnelAudit)----
    if (spansByLane.some((s) => s.length)) {
      const ta = towerTunnelAudit(lanesGame, spansByLane);
      tunLanes++;
      if (ta.inside) tunTowers += ta.inside;
      for (const b of ta.bad) {
        tunBad++;
        console.log(`❌ ${venue} L${L} lane${b.li} ${b.role === 'front' ? '前' : '後'}塔(${b.side})埋在隧道內:` +
          `距最近洞口 ${b.d.toFixed(0)}m > ${ta.need.toFixed(0)}m(射程 ${UNITS.tower.range} 的 ${(1 - GAME.TOWER_TUNNEL_OUT_F) * 100}%)` +
          ` —— 洞外涵蓋 ${Math.max(0, ((UNITS.tower.range - b.d) / UNITS.tower.range * 100)).toFixed(0)}% < ${GAME.TOWER_TUNNEL_OUT_F * 100}%`);
      }
    }
  }
}
console.log(`\n總結:進入結構 ${traversals} 次、側面進出違規 ${violations}、主堡落在結構上 ${endsOn}、` +
  `立體交叉(已物理隔開) ${crossings}、路徑重建失敗 ${rebuildFails}`);
console.log(`規則 #5(隧道內砲塔 ≥${GAME.TOWER_TUNNEL_OUT_F * 100}% 射程涵蓋洞口外):` +
  `含隧道兵線組 ${tunLanes}、洞內砲塔 ${tunTowers}、違規 ${tunBad}` +
  `(隧道段取圖資 way 全長 = 上界;平地場地 tunnel way 執行期未必成洞)`);
process.exit(violations || tunBad ? 1 : 0);
