// ============ 道路格網量化(2026-08-10 使用者定案)============
// 使用者原句:「處理圖資時先找出地圖上下左右對準哪一個方向時,可以對齊最多的大馬路組成
// 正交網格,接著將所有道路量化成 16 個方向,同時盡可能避免讓道路變成鋸齒,這樣道路拼圖
// 可以透過這 16 個方向簡化並無縫準確貼合對齊,建築也更容易對齊排列。」
//
// 分工:
//   ①「地圖上下左右對準哪個方向」= 整份投影旋轉,住 `data.js`(`mapRot`/`llToXZ`);
//      角度由本檔的 `gridAngle()` 量出來,離線烘焙進 `venueGrid.js`。
//   ②「所有道路量化成 16 個方向」+「避免鋸齒」+「無縫貼合」= 本檔 `quantizeRoads()`。
//   ③ 建築/地被的朝向本來就取自最近道路(`biomes.nearestRoadAngle` → `siteplan.roadFaceRy`、
//      `ground.orient`),道路一被量化,那兩者自動落在同一組 16 方向 —— 本檔 MUST NOT 另外
//      去碰建築(第二份對齊規則 = 兩套朝向打架)。
//   ④ 圖資的糾纏小環先走 `pruneRoads()`：只剪完整的「真路口↔真路口」走廊，
//      並以閉環面積 + 替代路徑 + 節點度數守住連通；短距離能接到另一條路的死端在
//      分析圖視為閉合，其餘不參與閉面的單純死端不剪。
//
// **零 import**(同 `rng.js`/`vernacular.js`/`ctrlmode.js`):投影與經緯度一律由呼叫端以
// `toXZ`/`toLL` 回呼注入 —— 這是離線稽核 `tools/audit_road_grid.mjs` 能直接吃真品的唯一理由。
// **零亂數**(§2.3):本檔一枚共享 `rnd()` 都不消耗,也不自帶亂數 —— 量化必須是圖資的純函式,
// 否則同一份 geocache 定案的路網會在不同客戶端長出不同的路口。
//
// 三件事一起做才成立,少任何一件都是可見的破圖:
//   ⓐ **量化**:每段的方位吸附到 16 格之一(22.5°/格)。
//   ⓑ **去鋸齒**:格界附近的抖動會讓一條 10° 的路變成 0°/22.5° 交替的鋸齒 —— 靠「沿路走、
//      偏離真實路線超過預算才換格」的位置空間遲滯(`assignDirs`),直段長度因此有**推導出來的
//      下界**(`minStraightM()`),不是靠事後把短段併掉。
//   ⓒ **無縫**:路口是**共用節點**,量化 MUST 是「解出新的節點位置」而不是「逐 way 各轉各的」——
//      逐 way 各轉,兩條路在路口就會裂開一條縫,而畫面上只表現成「路口破了一塊」。
//
// 為什麼是「鬆弛 + 逐段長度重解」兩步:把每條邊釘在指定方向上是一組線性約束,有迴圈的
// 路網通常**無解**(三條邊的方向湊不出封閉三角形)⇒ 只能取最小平方。鬆弛給出全域最佳的
// 節點位置;之後再逐「錨點到錨點」的段落重解**長度**,把該段內部的每一條邊拉回**精確**的
// 16 方向並精確收在兩端錨點上 ⇒ 殘差只剩在「路口到路口只有一條邊」那種段落上。

// ============ 道路圖資預整理(2026-08-24 使用者定案)============
// 使用者原句:「刪除道路的指標更改為：道路圍成的封閉環的面積過小時剪枝，優先移除較窄、
// 較冗餘的道路；一般道路與高架橋／地下道／明隧道／隧道並排時、或是雙向車道分隔，
// 則不剪枝。」「如果有死路，短距離內能連到另一個道路的話視為封閉處理，其餘規則與
// 先前相同。」
//
// 這裡剪的不是「折線的某一小段」，而是跨過 OSM tag 造成的 degree=2 way 接縫，重組成
// 完整物理走廊後才原子判定：候選走廊 MUST 實際構成小面積幾何閉環；死端若在短距離內
// 接近另一條道路，只在分析圖補虛擬閉合邊，不移動或補畫輸出道路。不參與閉面的其餘
// 單純死端、筆直支路與大環一律保留。通過面積門檻後才依「窄、閉面其餘周長比低」排序。
// 每次刪除仍重驗替代路徑、端點度數與分量總額，不得新增死路或切斷路網。
//
// 結構道路先於剪枝做幾何配對：橋、隧道、地下道、明隧道與平行相鄰的一般道路成對保留；
// 兩條相鄰、平行、同級且反向 oneway 的道路視為雙向分隔車道保留。單有 layer 數字不等於
// 結構語意，否則倫敦地鐵站內 layer=-1…-5 的步道會整批永久免檢。
// 共享節點的連續路段與交叉道路不算「並排」。全程零亂數，輸入 way 重排後選到同一批幾何。
//
// `widthOf` 由呼叫端注入，寬度唯一真相仍是 biomes.js `roadWidth()`；本檔 MUST NOT
// 再抄一份 highway→寬度表。下列常數集中管理候選資格、排序尺度、替代路徑與移除預算。
export const ROAD_PRUNE = {
  MAX_W_M: 6,              // 候選寬度上界；主幹道與多車道路自然排除
  MAX_LOOP_AREA_M2: 3200,  // 約 57m×57m；仍小於正常街廓，涵蓋站內步道的碎小面
  MAX_LOOP_SEARCH_M: 700,  // Dijkstra 局部上限；只限制搜尋成本，不參與候選排序
  MIN_FACE_SHARE_F: 0.05,  // 排除浮點擦邊；正常直路無閉面，不能靠提高此值替代面積判定
  NO_ALT_FACE_SHARE_F: 0.5,// 無 OSM 拓撲替代路時，至少半條走廊須實際構成幾何閉環
  NEAR_CLOSE_W_F: 2,       // 死端近接閉合距離 = 候選最大路寬 × 此倍數（目前 12m）
  PARALLEL_GAP_M: 18,      // 結構並排 / 分隔車道最大橫向間距
  PARALLEL_OVERLAP_M: 12,  // 沿道路方向至少並行此長度，避免把交叉道路當並排
  PARALLEL_SHARE_F: 0.35,  // 並行須覆蓋較短走廊的實質比例，短暫擦肩不保護整條折線
  PARALLEL_DEG: 12,
  FOCUS_DROP_F: 0.18,      // 重生圈只增加分量總額，不繞過閉環與拓撲安全門
  MAX_DROP_F: 0.30,        // 每個連通分量最多剪掉的初始總長比
  MAX_CYCLE_CHECKS: 1536,
  TANGLE_CELL_M: 160,      // 剩餘窄路最密集區的量測格；固定鏡位與診斷共用
};

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * 把圖資路網剪成「不斷線、不新增死路」的簡化圖。原座標不移動；只原子移除完整走廊。
 * 輸入陣列與 geometry 都不就地修改。
 *
 * @param {Array} ways `{tags, geometry:[{lat,lon}]}`
 * @param {(p)=>[number,number]} toXZ `{lat,lon}` → 世界公尺
 * @param {(way)=>number} widthOf 路寬唯一真相回呼
 * @param {object} [stats] 選填；寫入小環、結構保護、死路、道路種類與最密窄路格計數
 * @param {Array<[number,number]>} [focuses] 優先整理中心；距離尺度與最密窄路量測格共用
 */
export function pruneRoads(ways, toXZ, widthOf, stats = null, focuses = []) {
  if (!ways?.length) return ways;
  const focusPoints = (focuses || []).filter((p) => Array.isArray(p)
    && Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p) => [p[0], p[1]]);

  // ---- ① 原始共用節點圖(精確 lat/lon 鍵，不把擦肩而過的路黏成路口)----
  const nodeMap = new Map();
  const nx = [], nz = [];
  const nodeOf = (p) => {
    const key = `${p.lat},${p.lon}`;
    let id = nodeMap.get(key);
    if (id !== undefined) return id;
    const q = toXZ(p);
    id = nx.length;
    nodeMap.set(key, id); nx.push(q[0]); nz.push(q[1]);
    return id;
  };
  let normalized = false;
  const geoms = ways.map((w) => {
    const out = [];
    let prev = '';
    for (const p of w.geometry || []) {
      if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lon)) { normalized = true; continue; }
      const key = `${p.lat},${p.lon}`;
      if (key === prev) { normalized = true; continue; }
      prev = key; out.push(p); nodeOf(p);
    }
    return out;
  });
  const chains = geoms.map((g) => g.map(nodeOf));
  const use = new Int32Array(nx.length);
  const anchor = new Uint8Array(nx.length);
  const neighbors = Array.from({ length: nx.length }, () => new Set());
  for (const ch of chains) {
    if (!ch.length) continue;
    anchor[ch[0]] = 1; anchor[ch[ch.length - 1]] = 1;
    const seen = new Set();
    for (const id of ch) {
      if (seen.has(id)) anchor[id] = 1;
      else { seen.add(id); use[id]++; }
    }
    for (let i = 1; i < ch.length; i++) {
      const a = ch[i - 1], b = ch[i];
      if (a === b) continue;
      neighbors[a].add(b); neighbors[b].add(a);
    }
  }
  for (let i = 0; i < nx.length; i++) {
    if (use[i] > 1 || neighbors[i].size !== 2) anchor[i] = 1;
  }

  // ---- ② 只沿錨點切拓撲邊；不在普通折點中途斷開 ----
  const edges = [];
  const segEdge = geoms.map((g) => new Int32Array(Math.max(0, g.length - 1)).fill(-1));
  const tagOn = (v) => v !== undefined && v !== null
    && !['', '0', 'no', 'false'].includes(String(v).toLowerCase());
  const structureWay = (w) => {
    const t = w.tags || {};
    const location = String(t.location || '').toLowerCase();
    return tagOn(t.bridge) || tagOn(t.tunnel) || tagOn(t.covered) || tagOn(t.embankment)
      || tagOn(t.cutting)
      || ['underground', 'underwater', 'elevated', 'overground'].includes(location);
  };
  const onewayDir = (w) => {
    const t = w.tags || {}, one = String(t.oneway || '').toLowerCase();
    const highway = String(t.highway || '');
    if (/^(?:footway|path|pedestrian|steps|cycleway|service)$/.test(highway)) return 0;
    if (['-1', 'reverse'].includes(one)) return -1;
    return ['yes', '1', 'true'].includes(one) ? 1 : 0;
  };
  for (let wi = 0; wi < chains.length; wi++) {
    const ch = chains[wi], g = geoms[wi];
    if (ch.length < 2) continue;
    const width0 = Number(widthOf(ways[wi]));
    const width = Number.isFinite(width0) && width0 > 0 ? width0 : Infinity;
    let s = 0;
    for (let e = 1; e < ch.length; e++) {
      if (e < ch.length - 1 && !anchor[ch[e]]) continue;
      let len = 0;
      for (let k = s + 1; k <= e; k++) len += Math.hypot(nx[ch[k]] - nx[ch[k - 1]], nz[ch[k]] - nz[ch[k - 1]]);
      if (len > 1e-3) {
        const seq = g.slice(s, e + 1).map((p) => `${p.lat},${p.lon}`).join(';');
        const rev = g.slice(s, e + 1).reverse().map((p) => `${p.lat},${p.lon}`).join(';');
        const id = edges.length;
        const highway = ways[wi].tags?.highway || '';
        const structure = structureWay(ways[wi]);
        const grade = structure;
        const oneDir = onewayDir(ways[wi]), divided = oneDir !== 0;
        const junction = ways[wi].tags?.junction;
        edges.push({ id, wi, s, e, a: ch[s], b: ch[e], len, width, highway, structure, grade,
          divided, oneDir,
          protected: junction === 'roundabout' || junction === 'circular',
          sig: `${seq < rev ? seq : rev}|${highway}` });
        for (let k = s; k < e; k++) segEdge[wi][k] = id;
      }
      s = e;
    }
  }
  if (!edges.length) {
    if (stats) Object.assign(stats, { inputWays: ways.length, outputWays: ways.length, edges: 0,
      candidates: 0, removedEdges: 0, removedM: 0, spurM: 0, cycleM: 0, deadEndsBefore: 0, deadEndsAfter: 0,
      nearClosed: { maxGapM: ROAD_PRUNE.MAX_W_M * ROAD_PRUNE.NEAR_CLOSE_W_F, links: 0 } });
    return ways;
  }

  const adj = Array.from({ length: nx.length }, () => []);
  for (const e of edges) { adj[e.a].push(e.id); if (e.b !== e.a) adj[e.b].push(e.id); }
  for (let i = 0; i < adj.length; i++) adj[i].sort((a, b) => edges[a].sig.localeCompare(edges[b].sig));
  const active = new Uint8Array(edges.length); active.fill(1);
  const degree = (node, skip = -1) => {
    const ns = new Set();
    for (const eid of adj[node]) {
      if (eid === skip || !active[eid]) continue;
      const e = edges[eid];
      const other = e.a === node ? e.b : e.a;
      if (other !== node) ns.add(other);
    }
    return ns.size;
  };
  const deadEnds = () => {
    let n = 0;
    for (let i = 0; i < adj.length; i++) if (degree(i) === 1) n++;
    return n;
  };
  const deadEndsBefore = deadEnds();
  const byHighway = () => {
    const out = {};
    for (const e of edges) {
      const r = out[e.highway] ||= { before: 0, after: 0, removed: 0, beforeM: 0, afterM: 0 };
      r.before++; r.beforeM += e.len;
      if (active[e.id]) { r.after++; r.afterM += e.len; } else r.removed++;
    }
    return out;
  };
  const pointSegDist2 = (px, pz, ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az, dd = dx * dx + dz * dz;
    const t = dd > 1e-12 ? clamp01(((px - ax) * dx + (pz - az) * dz) / dd) : 0;
    const qx = ax + dx * t, qz = az + dz * t;
    return (px - qx) ** 2 + (pz - qz) ** 2;
  };
  // ---- ③ 結構並排與雙向分隔車道保護 ----
  // 空間桶只加速幾何配對；共享節點與交叉角度會在精確判定排除。
  const nearCloseM = ROAD_PRUNE.MAX_W_M * ROAD_PRUNE.NEAR_CLOSE_W_F;
  const segPad = Math.max(ROAD_PRUNE.PARALLEL_GAP_M, nearCloseM);
  const roadSegs = [], segBuckets = new Map(), segCell = segPad * 2;
  const segKey = (ix, iz) => `${ix},${iz}`;
  for (const e of edges) {
    const ch = chains[e.wi];
    for (let k = e.s + 1; k <= e.e; k++) {
      const a = ch[k - 1], b = ch[k];
      const dx = nx[b] - nx[a], dz = nz[b] - nz[a], len = Math.hypot(dx, dz);
      if (len <= 1e-3) continue;
      const sid = roadSegs.length;
      roadSegs.push({ eid: e.id, n0: a, n1: b, ax: nx[a], az: nz[a], bx: nx[b], bz: nz[b],
        len, ux: dx / len, uz: dz / len });
      const pad = segPad;
      const x0 = Math.floor((Math.min(nx[a], nx[b]) - pad) / segCell);
      const x1 = Math.floor((Math.max(nx[a], nx[b]) + pad) / segCell);
      const z0 = Math.floor((Math.min(nz[a], nz[b]) - pad) / segCell);
      const z1 = Math.floor((Math.max(nz[a], nz[b]) + pad) / segCell);
      for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
        const key = segKey(ix, iz), bucket = segBuckets.get(key) || [];
        bucket.push(sid); segBuckets.set(key, bucket);
      }
    }
  }
  const structurePairs = new Map(), dividedPairs = new Map(), pairSeen = new Set();
  const addPairM = (map, a, b, m) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    map.set(key, (map.get(key) || 0) + m);
  };
  const parallelCos = Math.cos(ROAD_PRUNE.PARALLEL_DEG * Math.PI / 180);
  for (const bucket of segBuckets.values()) for (let i = 0; i < bucket.length; i++) {
    const a = roadSegs[bucket[i]], ea = edges[a.eid];
    for (let j = i + 1; j < bucket.length; j++) {
      const b = roadSegs[bucket[j]], eb = edges[b.eid];
      if (a.eid === b.eid || ea.wi === eb.wi || a.n0 === b.n0 || a.n0 === b.n1
        || a.n1 === b.n0 || a.n1 === b.n1) continue;
      const pairKey = bucket[i] < bucket[j] ? `${bucket[i]},${bucket[j]}` : `${bucket[j]},${bucket[i]}`;
      if (pairSeen.has(pairKey)) continue;
      pairSeen.add(pairKey);
      if (Math.abs(a.ux * b.ux + a.uz * b.uz) < parallelCos) continue;
      const p0 = (b.ax - a.ax) * a.ux + (b.az - a.az) * a.uz;
      const p1 = (b.bx - a.ax) * a.ux + (b.bz - a.az) * a.uz;
      const overlap = Math.min(a.len, Math.max(p0, p1)) - Math.max(0, Math.min(p0, p1));
      if (overlap < ROAD_PRUNE.PARALLEL_OVERLAP_M) continue;
      const gap2 = Math.min(
        pointSegDist2(a.ax, a.az, b.ax, b.az, b.bx, b.bz),
        pointSegDist2(a.bx, a.bz, b.ax, b.az, b.bx, b.bz),
        pointSegDist2(b.ax, b.az, a.ax, a.az, a.bx, a.bz),
        pointSegDist2(b.bx, b.bz, a.ax, a.az, a.bx, a.bz),
      );
      if (gap2 > ROAD_PRUNE.PARALLEL_GAP_M ** 2) continue;
      if (ea.grade !== eb.grade) {
        addPairM(structurePairs, ea.id, eb.id, overlap);
      }
      const travelDot = (a.ux * b.ux + a.uz * b.uz) * ea.oneDir * eb.oneDir;
      if (ea.divided && eb.divided && ea.highway === eb.highway && travelDot <= -parallelCos) {
        addPairM(dividedPairs, ea.id, eb.id, overlap);
      }
    }
  }
  const structureParallel = new Set(), dividedParallel = new Set();
  for (const [key, overlap] of structurePairs) {
    const [ai, bi] = key.split(',').map(Number), a = edges[ai], b = edges[bi];
    const need = Math.max(ROAD_PRUNE.PARALLEL_OVERLAP_M,
      Math.min(a.len, b.len) * ROAD_PRUNE.PARALLEL_SHARE_F);
    if (overlap < need) continue;
    a.protected = true; b.protected = true;
    structureParallel.add((a.grade ? b : a).id);
  }
  for (const [key, overlap] of dividedPairs) {
    const [ai, bi] = key.split(',').map(Number), a = edges[ai], b = edges[bi];
    const need = Math.max(ROAD_PRUNE.PARALLEL_OVERLAP_M,
      Math.min(a.len, b.len) * ROAD_PRUNE.PARALLEL_SHARE_F);
    if (overlap < need) continue;
    a.protected = true; b.protected = true;
    dividedParallel.add(a.id); dividedParallel.add(b.id);
  }

  // 小環是玩家看到的幾何面，不以 OSM 是否剛好在交點共用 node 為前提。只在這份分析圖
  // 將真交點切開；結構「並排」例外已在上方成對保護，輸出幾何完全不受此圖移動。
  const cuts = roadSegs.map(() => [0, 1]);
  const facePairSeen = new Set();
  const cross2 = (ax, az, bx, bz) => ax * bz - az * bx;
  for (const bucket of segBuckets.values()) for (let i = 0; i < bucket.length; i++) {
    const ai = bucket[i], a = roadSegs[ai], ea = edges[a.eid];
    for (let j = i + 1; j < bucket.length; j++) {
      const bi = bucket[j], b = roadSegs[bi], eb = edges[b.eid];
      const pairKey = ai < bi ? `${ai},${bi}` : `${bi},${ai}`;
      if (facePairSeen.has(pairKey)) continue;
      facePairSeen.add(pairKey);
      const arx = a.bx - a.ax, arz = a.bz - a.az;
      const brx = b.bx - b.ax, brz = b.bz - b.az;
      const den = cross2(arx, arz, brx, brz);
      if (Math.abs(den) < 1e-9) continue;
      const qx = b.ax - a.ax, qz = b.az - a.az;
      const ta = cross2(qx, qz, brx, brz) / den;
      const tb = cross2(qx, qz, arx, arz) / den;
      if (ta < -1e-9 || ta > 1 + 1e-9 || tb < -1e-9 || tb > 1 + 1e-9) continue;
      cuts[ai].push(clamp01(ta)); cuts[bi].push(clamp01(tb));
    }
  }

  // OSM 的步道常在另一條道路前數公尺收尾。若死端與同類的「另一條 way」只差短縫，
  // 僅在分析圖補一條虛擬邊，讓後續仍以完整閉面面積判定；真圖資與輸出幾何完全不動。
  // 每個死端只接最近的一條，等距再以幾何簽章決勝，避免輸入 way 重排改變結果。
  const nearLinks = [];
  if (nearCloseM > 1e-6) for (let node = 0; node < adj.length; node++) {
    if (degree(node) !== 1) continue;
    const leafEid = adj[node].find((eid) => active[eid]);
    const leaf = edges[leafEid];
    if (!leaf || leaf.protected || leaf.width > ROAD_PRUNE.MAX_W_M) continue;
    const bucket = segBuckets.get(segKey(Math.floor(nx[node] / segCell), Math.floor(nz[node] / segCell))) || [];
    const seenSeg = new Set();
    let best = null;
    for (const sid of bucket) {
      if (seenSeg.has(sid)) continue;
      seenSeg.add(sid);
      const s = roadSegs[sid], target = edges[s.eid];
      if (s.eid === leafEid || target.wi === leaf.wi || target.grade !== leaf.grade
        || s.n0 === node || s.n1 === node) continue;
      const dx = s.bx - s.ax, dz = s.bz - s.az, dd = dx * dx + dz * dz;
      const t = dd > 1e-12 ? clamp01(((nx[node] - s.ax) * dx + (nz[node] - s.az) * dz) / dd) : 0;
      const x = s.ax + dx * t, z = s.az + dz * t;
      const d2 = (nx[node] - x) ** 2 + (nz[node] - z) ** 2;
      if (d2 <= 1e-8 || d2 > nearCloseM * nearCloseM + 1e-8) continue;
      const a = `${s.ax.toFixed(6)},${s.az.toFixed(6)}`;
      const b = `${s.bx.toFixed(6)},${s.bz.toFixed(6)}`;
      const sig = `${target.sig}|${a < b ? `${a}>${b}` : `${b}>${a}`}`;
      if (!best || d2 < best.d2 - 1e-8 || (Math.abs(d2 - best.d2) <= 1e-8 && sig < best.sig)) {
        best = { node, leafEid, sid, t, x, z, d2, sig };
      }
    }
    if (!best) continue;
    cuts[best.sid].push(best.t);
    const from = `${nx[node].toFixed(6)},${nz[node].toFixed(6)}`;
    const to = `${best.x.toFixed(6)},${best.z.toFixed(6)}`;
    nearLinks.push({ ...best, len: Math.sqrt(best.d2), sig: `virtual:${from}>${to}|${leaf.sig}|${best.sig}` });
  }
  nearLinks.sort((a, b) => a.sig.localeCompare(b.sig));

  const faceNodes = [], faceNodeMap = new Map();
  const faceNodeOf = (x, z) => {
    const key = `${x.toFixed(6)},${z.toFixed(6)}`;
    let id = faceNodeMap.get(key);
    if (id !== undefined) return id;
    id = faceNodes.length; faceNodeMap.set(key, id); faceNodes.push({ x, z, key, out: [] });
    return id;
  };
  const faceEdges = [];
  for (let si = 0; si < roadSegs.length; si++) {
    const s = roadSegs[si], ts = cuts[si].sort((a, b) => a - b);
    const uniq = ts.filter((t, i) => !i || t - ts[i - 1] > 1e-8);
    for (let k = 1; k < uniq.length; k++) {
      const t0 = uniq[k - 1], t1 = uniq[k];
      const ax = s.ax + (s.bx - s.ax) * t0, az = s.az + (s.bz - s.az) * t0;
      const bx = s.ax + (s.bx - s.ax) * t1, bz = s.az + (s.bz - s.az) * t1;
      const len = Math.hypot(bx - ax, bz - az);
      if (len <= 1e-5) continue;
      const a = faceNodeOf(ax, az), b = faceNodeOf(bx, bz);
      if (a !== b) faceEdges.push({ a, b, eid: s.eid, len });
    }
  }
  for (const link of nearLinks) {
    const a = faceNodeOf(nx[link.node], nz[link.node]), b = faceNodeOf(link.x, link.z);
    if (a !== b) faceEdges.push({ a, b, eid: -1, len: link.len, virtual: true, sig: link.sig });
  }
  const half = [];
  for (const pe of faceEdges) {
    const a = faceNodes[pe.a], b = faceNodes[pe.b], h0 = half.length, h1 = h0 + 1;
    const edgeSig = pe.virtual ? pe.sig : edges[pe.eid].sig;
    half.push({ from: pe.a, to: pe.b, twin: h1, eid: pe.eid, len: pe.len,
      virtual: !!pe.virtual, angle: Math.atan2(b.z - a.z, b.x - a.x), sig: `${a.key}>${b.key}|${edgeSig}` });
    half.push({ from: pe.b, to: pe.a, twin: h0, eid: pe.eid, len: pe.len,
      virtual: !!pe.virtual, angle: Math.atan2(a.z - b.z, a.x - b.x), sig: `${b.key}>${a.key}|${edgeSig}` });
    a.out.push(h0); b.out.push(h1);
  }
  for (const n of faceNodes) n.out.sort((ia, ib) => half[ia].angle - half[ib].angle
    || half[ia].sig.localeCompare(half[ib].sig));
  const halfUsed = new Uint8Array(half.length), planarFaces = [];
  for (let seed = 0; seed < half.length; seed++) {
    if (halfUsed[seed]) continue;
    let h = seed, area2 = 0, perimeter = 0, virtualM = 0, virtualN = 0;
    let fx = 0, fz = 0, vertices = 0, guard = 0;
    const byEdge = new Map(), boundary = new Set();
    while (!halfUsed[h] && guard++ <= half.length) {
      halfUsed[h] = 1;
      const e = half[h], a = faceNodes[e.from], b = faceNodes[e.to];
      area2 += a.x * b.z - b.x * a.z; perimeter += e.len;
      fx += a.x; fz += a.z; vertices++;
      if (e.virtual) { virtualM += e.len; virtualN++; }
      else { byEdge.set(e.eid, (byEdge.get(e.eid) || 0) + e.len); boundary.add(e.eid); }
      const outs = faceNodes[e.to].out, ri = outs.indexOf(e.twin);
      if (ri < 0 || !outs.length) { h = -1; break; }
      h = outs[(ri - 1 + outs.length) % outs.length];
      if (h === seed) break;
    }
    const areaM2 = area2 * 0.5;
    if (h === seed && boundary.size >= 2 && areaM2 > 1e-4) {
      planarFaces.push({ areaM2, perimeter, virtualM, virtualN, byEdge, boundary,
        x: fx / Math.max(1, vertices), z: fz / Math.max(1, vertices) });
    }
  }
  const focusWeight = (ids) => {
    if (!focusPoints.length) return 0;
    let best2 = Infinity;
    for (const id of ids) {
      const e = edges[id], ch = chains[e.wi];
      for (let k = e.s + 1; k <= e.e; k++) {
        const a = ch[k - 1], b = ch[k];
        for (const p of focusPoints) best2 = Math.min(best2,
          pointSegDist2(p[0], p[1], nx[a], nz[a], nx[b], nz[b]));
      }
    }
    const r = ROAD_PRUNE.TANGLE_CELL_M;
    return best2 < r * r ? 1 - Math.sqrt(best2) / r : 0;
  };
  const focusRoads = (after) => focusPoints.map(([x, z]) => {
    let m = 0;
    const ids = new Set();
    for (const e of edges) {
      if ((after && !active[e.id]) || e.protected || e.width > ROAD_PRUNE.MAX_W_M) continue;
      const ch = chains[e.wi];
      for (let k = e.s + 1; k <= e.e; k++) {
        const a = ch[k - 1], b = ch[k];
        if (pointSegDist2(x, z, nx[a], nz[a], nx[b], nz[b]) > ROAD_PRUNE.TANGLE_CELL_M ** 2) continue;
        m += Math.hypot(nx[b] - nx[a], nz[b] - nz[a]); ids.add(e.id);
      }
    }
    return { x, z, m, edges: ids.size };
  });
  const densityPeak = (after) => {
    const cells = new Map(), cellM = ROAD_PRUNE.TANGLE_CELL_M;
    for (const e of edges) {
      if ((after && !active[e.id]) || e.protected || e.width > ROAD_PRUNE.MAX_W_M) continue;
      const ch = chains[e.wi];
      for (let k = e.s + 1; k <= e.e; k++) {
        const a = ch[k - 1], b = ch[k];
        const len = Math.hypot(nx[b] - nx[a], nz[b] - nz[a]);
        if (len <= 1e-3) continue;
        const x = (nx[a] + nx[b]) / 2, z = (nz[a] + nz[b]) / 2;
        const key = `${Math.floor(x / cellM)},${Math.floor(z / cellM)}`;
        const r = cells.get(key) || { x: 0, z: 0, m: 0, ids: new Set() };
        r.x += x * len; r.z += z * len; r.m += len; r.ids.add(e.id); cells.set(key, r);
      }
    }
    let best = null, bestKey = '';
    for (const [key, r] of cells) {
      if (!best || r.m > best.m || (r.m === best.m && key < bestKey)) { best = r; bestKey = key; }
    }
    return best ? { x: best.x / best.m, z: best.z / best.m, m: best.m, edges: best.ids.size } : null;
  };
  const denseBefore = densityPeak(false);
  const focusBefore = focusRoads(false);

  // 連通分量的移除預算在任何剪枝之前定案；剪完再縮分母會連鎖把整網吃光。
  const comp = new Int32Array(nx.length); comp.fill(-1);
  let compN = 0;
  for (let seed = 0; seed < nx.length; seed++) {
    if (comp[seed] >= 0 || !adj[seed].length) continue;
    const q = [seed]; comp[seed] = compN;
    for (let h = 0; h < q.length; h++) {
      const u = q[h];
      for (const eid of adj[u]) {
        const e = edges[eid], v = e.a === u ? e.b : e.a;
        if (comp[v] < 0) { comp[v] = compN; q.push(v); }
      }
    }
    compN++;
  }
  const compM = new Float64Array(compN), droppedM = new Float64Array(compN);
  for (const e of edges) { e.comp = comp[e.a]; compM[e.comp] += e.len; }

  // 有上限的 Dijkstra：只供兩端都留在主網內的走廊做連通安全複核。
  const alternateCycle = (dropIds, start, goal) => {
    if (start === goal) return null;
    const dist = new Float64Array(nx.length); dist.fill(Infinity); dist[start] = 0;
    const hd = [0], hn = [0];
    const push = (d, node) => {
      let i = hd.length; hd.push(d); hn.push(node);
      while (i > 1) {
        const p = i >> 1;
        if (hd[p] < d || (hd[p] === d && hn[p] <= node)) break;
        hd[i] = hd[p]; hn[i] = hn[p]; i = p;
      }
      hd[i] = d; hn[i] = node;
    };
    push(0, start);
    const pop = () => {
      const d = hd[1], node = hn[1], lastD = hd.pop(), lastN = hn.pop();
      if (hd.length > 1) {
        let i = 1;
        while (true) {
          let c = i << 1;
          if (c >= hd.length) break;
          if (c + 1 < hd.length && (hd[c + 1] < hd[c] || (hd[c + 1] === hd[c] && hn[c + 1] < hn[c]))) c++;
          if (hd[c] > lastD || (hd[c] === lastD && hn[c] >= lastN)) break;
          hd[i] = hd[c]; hn[i] = hn[c]; i = c;
        }
        hd[i] = lastD; hn[i] = lastN;
      }
      return [d, node];
    };
    while (hd.length > 1) {
      const [d, u] = pop();
      if (d !== dist[u] || d > ROAD_PRUNE.MAX_LOOP_SEARCH_M) continue;
      if (u === goal) return { len: d };
      for (const eid of adj[u]) {
        if (dropIds.has(eid) || !active[eid]) continue;
        const e = edges[eid], v = e.a === u ? e.b : e.a, nd = d + e.len;
        if (nd <= ROAD_PRUNE.MAX_LOOP_SEARCH_M && nd < dist[v]) {
          dist[v] = nd; push(nd, v);
        }
      }
    }
    return null;
  };

  // ---- ④ 只剪小閉環；逐次重驗當下圖，不用 OSM way 切段假裝一條道路 ----
  const removable = (e) => !e.protected && e.a !== e.b && e.width <= ROAD_PRUNE.MAX_W_M;
  let removedEdges = 0, removedM = 0, spurM = 0, cycleM = 0, cycleChecks = 0;
  const rejected = { budget: 0, changed: 0, endpoint: 0, noAlternate: 0, openedFace: 0 };
  const candidateSigs = new Set();

  // 網內糾纏以「真路口↔真路口」的完整走廊為原子。OSM way 的 tag 接縫即使是
  // degree=2，也不該把一條物理走廊切成數段後各自量獨立性。
  const corridorOf = (seed) => {
    const first = edges[seed];
    if (!active[seed] || !removable(first)) return null;
    const ids = [seed], used = new Set(ids);
    const grow = (start) => {
      let node = start, prev = seed;
      while (degree(node) === 2) {
        const next = adj[node].filter((eid) => eid !== prev && active[eid] && !used.has(eid));
        if (next.length !== 1) break;
        const eid = next[0], e = edges[eid];
        if (!removable(e)) break;
        ids.push(eid); used.add(eid);
        node = e.a === node ? e.b : e.a;
        prev = eid;
      }
      return node;
    };
    const a = grow(first.a), b = grow(first.b);
    let len = 0, width = 0;
    for (const id of ids) { len += edges[id].len; width = Math.max(width, edges[id].width); }
    const sig = ids.map((id) => edges[id].sig).sort().join('||');
    return { seed, ids, skip: used, a, b, len, width, comp: first.comp, sig,
      focus: focusWeight(ids) };
  };
  const degreeWithout = (node, skip) => {
    const ns = new Set();
    for (const eid of adj[node]) {
      if (skip.has(eid) || !active[eid]) continue;
      const e = edges[eid], other = e.a === node ? e.b : e.a;
      if (other !== node) ns.add(other);
    }
    return ns.size;
  };
  const faceActive = (face) => [...face.boundary].every((eid) => active[eid]);
  const loopMetrics = (c) => {
    let best = null;
    for (const face of planarFaces) {
      if (!faceActive(face) || face.areaM2 >= ROAD_PRUNE.MAX_LOOP_AREA_M2 - 1e-6) continue;
      let candidateM = 0;
      for (const eid of c.ids) candidateM += face.byEdge.get(eid) || 0;
      if (candidateM / Math.max(1e-6, c.len) < ROAD_PRUNE.MIN_FACE_SHARE_F) continue;
      const altLen = face.perimeter - candidateM;
      if (candidateM <= 1e-6 || altLen <= 1e-6) continue;
      const metric = { areaM2: face.areaM2, altLen, detourF: altLen / candidateM,
        shareF: candidateM / Math.max(1e-6, c.len) };
      if (!best || metric.detourF < best.detourF
        || (metric.detourF === best.detourF && metric.areaM2 < best.areaM2)) best = metric;
    }
    return best;
  };
  const candidateOrder = (a, b) => a.width - b.width || a.detourF - b.detourF
    || a.areaM2 - b.areaM2 || b.focus - a.focus || a.len - b.len
    || (a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0);
  const loopReport = () => {
    const values = [];
    let small = 0, focusSmall = 0, nearClosedSmall = 0;
    for (const face of planarFaces) {
      if (!faceActive(face)) continue;
      values.push(face.areaM2);
      if (face.areaM2 < ROAD_PRUNE.MAX_LOOP_AREA_M2 - 1e-6) {
        small++;
        if (face.virtualN > 0) nearClosedSmall++;
        if (focusPoints.some(([x, z]) => Math.hypot(face.x - x, face.z - z) < ROAD_PRUNE.TANGLE_CELL_M)) {
          focusSmall++;
        }
      }
    }
    values.sort((a, b) => a - b);
    return { thresholdM2: ROAD_PRUNE.MAX_LOOP_AREA_M2, faces: planarFaces.length,
      closed: values.length, small, focusSmall, nearClosedSmall,
      p50M2: values.length ? values[Math.floor(values.length / 2)] : null };
  };
  const loopBefore = loopReport();

  const seen = new Set(), corridors = [];
  const raw = [];
  for (const e of edges) {
    const c = corridorOf(e.id);
    if (!c || seen.has(c.sig)) continue;
    seen.add(c.sig); candidateSigs.add(c.sig); raw.push(c);
  }
  raw.sort((a, b) => a.width - b.width || b.focus - a.focus || a.sig.localeCompare(b.sig));
  for (const c of raw) {
    if (cycleChecks >= ROAD_PRUNE.MAX_CYCLE_CHECKS) break;
    cycleChecks++;
    const m = loopMetrics(c);
    if (m && m.areaM2 < ROAD_PRUNE.MAX_LOOP_AREA_M2 - 1e-6) corridors.push(Object.assign(c, m));
  }
  corridors.sort(candidateOrder);
  for (const c of corridors) {
    const now = corridorOf(c.seed);
    if (!now) { rejected.changed++; continue; }
    const metricNow = loopMetrics(now);
    if (!metricNow || metricNow.areaM2 >= ROAD_PRUNE.MAX_LOOP_AREA_M2 - 1e-6) {
      rejected.openedFace++; continue;
    }
    const budgetF = ROAD_PRUNE.MAX_DROP_F + (now.focus > 0 ? ROAD_PRUNE.FOCUS_DROP_F : 0);
    const budget = compM[now.comp] * budgetF;
    if (droppedM[now.comp] + now.len > budget) { rejected.budget++; continue; }
    const beforeA = degree(now.a), beforeB = degree(now.b);
    const afterA = degreeWithout(now.a, now.skip), afterB = degreeWithout(now.b, now.skip);
    const leafA = beforeA === 1, leafB = beforeB === 1;
    if ((!leafA && afterA < Math.min(2, beforeA)) || (!leafB && afterB < Math.min(2, beforeB))) {
      rejected.endpoint++; continue;
    }
    // 整條既有支梢可被小面積幾何環證明為冗邊；兩端仍在主網內時則必須另有拓撲替代路徑。
    if (!leafA && !leafB && !alternateCycle(now.skip, now.a, now.b)
      && metricNow.shareF < ROAD_PRUNE.NO_ALT_FACE_SHARE_F) { rejected.noAlternate++; continue; }
    for (const eid of now.ids) active[eid] = 0;
    droppedM[now.comp] += now.len; removedM += now.len; cycleM += now.len;
    removedEdges += now.ids.length;
  }

  const loopAfter = loopReport();
  const parallelProtected = { structure: structureParallel.size, divided: dividedParallel.size };
  const nearClosed = { maxGapM: nearCloseM, links: nearLinks.length };

  // ---- ⑤ 按原 way 重組連續片段；一個被剪邊必定從錨點到錨點 ----
  if (!removedEdges && !normalized) {
    if (stats) Object.assign(stats, { inputWays: ways.length, outputWays: ways.length, edges: edges.length,
      candidates: candidateSigs.size, removedEdges, removedM, spurM, cycleM, cycleChecks,
      deadEndsBefore, deadEndsAfter: deadEndsBefore, byHighway: byHighway(), denseBefore, denseAfter: denseBefore,
      focusBefore, focusAfter: focusBefore, loopBefore, loopAfter, parallelProtected, nearClosed, rejected });
    return ways;
  }
  const out = [];
  for (let wi = 0; wi < ways.length; wi++) {
    const g = geoms[wi], se = segEdge[wi];
    if (g.length < 2 || !se.length) { if (g.length) out.push({ ...ways[wi], geometry: g }); continue; }
    let frag = [];
    const flush = () => {
      if (frag.length >= 2) out.push({ ...ways[wi], geometry: frag });
      frag = [];
    };
    for (let i = 0; i < se.length; i++) {
      const kept = se[i] < 0 || active[se[i]];
      if (!kept) { flush(); continue; }
      if (!frag.length) frag.push(g[i]);
      frag.push(g[i + 1]);
    }
    flush();
  }
  if (stats) Object.assign(stats, { inputWays: ways.length, outputWays: out.length, edges: edges.length,
    candidates: candidateSigs.size, removedEdges, removedM, spurM, cycleM, cycleChecks,
    deadEndsBefore, deadEndsAfter: deadEnds(), byHighway: byHighway(), denseBefore, denseAfter: densityPeak(true),
    focusBefore, focusAfter: focusRoads(true), loopBefore, loopAfter, parallelProtected, nearClosed, rejected });
  return out;
}

export const ROAD_GRID = {
  DIRS: 16,             // 方向格數(360/16 = 22.5°)
  // **位移上限(遊戲公尺,硬約束)**:任一節點離它在圖資上的真實位置的最大距離。
  // 這是本檔唯一的硬邊界,理由是量化的代價會**沿著路累積** —— 一條方位剛好卡在格界
  // (11.25°)的長直路,硬轉到鄰格的話尾端會甩出數百公尺(實測合成 1.5km 路 = 518m),
  // 而那條路就此離開衛星底圖、離開已整平的路基、離開自己那排建物,畫面上看起來像
  // 「馬路長在草地上」而沒有任何錯誤訊息。寧可留下角度殘差,也 MUST NOT 讓路走掉(原則 6)。
  // 值 = 約一個車道寬(真實 7m):肉眼看不出路挪了,但足夠把幾度的殘差吸收掉。
  MAX_DRIFT_M: 14,
  // 細分後每一步的量化偏差只准吃掉預算的 1/DENSIFY_F(`densifyM()` 由此反推頂點間距)。
  // **量化之前 MUST 先細分**:一段的偏差 ≈ 段長 × 角度誤差,OSM 原始頂點在直路上可以隔到
  // 一兩百公尺,單單一段就吃掉 20m 預算 ⇒ DDA 每一步都超標、逐段換格,結果不是量化而是鋸齒
  // (實測 100m 頂點間距的斜街:量化前 10.1° → 量化後 10.3°,等於整條沒被量化)。
  DENSIFY_F: 4,
  DDA_F: 0.5,           // DDA 換格門檻佔硬上限的比例(見 assignDirs;留給細分步 + 長度重解的餘裕)
  RELAX_SWEEPS: 64,     // 節點鬆弛掃描數
  ANCHOR_W: 0.05,       // 拉回原位權重(起始值;沿掃描退火到 ANCHOR_END 倍)
  ANCHOR_END: 0.1,      // 退火終點倍率 —— 收尾幾乎是純方向投影,殘差才收得下去
  DEGEN_EPS: 1e-4,      // 方向集是否張得開 2D 的判準(2×2 法方程行列式 / 跡²)
};

/** 把 (qx,qz) 夾回「離原位 ≤ MAX_DRIFT_M」的圓盤內(位移硬上限的唯一實作) */
function clampDrift(qx, qz, px, pz, i) {
  const dx = qx[i] - px[i], dz = qz[i] - pz[i];
  const d = Math.hypot(dx, dz);
  if (d <= ROAD_GRID.MAX_DRIFT_M) return false;
  const f = ROAD_GRID.MAX_DRIFT_M / d;
  qx[i] = px[i] + dx * f;
  qz[i] = pz[i] + dz * f;
  return true;
}

/** 第 k 格的方位角(rad)。世界已被主方位旋轉過 ⇒ 格網錨在 0,不再有第二個偏移量。 */
export const dirAngle = (k) => k * (Math.PI * 2 / ROAD_GRID.DIRS);
/** 半格(rad):任一方位離最近格的最大距離 */
export const halfBin = () => Math.PI / ROAD_GRID.DIRS;
/** 量化前的細分間距(遊戲公尺)—— **推導,MUST NOT 手寫**:段長 × 半格 ≈ 該段的量化偏差 */
export const densifyM = () => ROAD_GRID.MAX_DRIFT_M / (ROAD_GRID.DENSIFY_F * halfBin());
/**
 * 量化後「同一個方向能連續走多遠」的**結構下界**(遊戲公尺)= 換格門檻 ÷ sin(半格)。
 * 這就是「不變成鋸齒」的保證本身,而且是**推導**出來的:DDA 只在偏離真實路線超過門檻時
 * 換格,而偏差最快也只能以 sin(半格) 的斜率累積 ⇒ 換格週期不可能比這更短。
 * MUST NOT 改用「事後把短段併掉」來達成同一件事(見 `assignDirs` ⓑ)。
 */
export const minStraightM = () => ROAD_GRID.MAX_DRIFT_M * ROAD_GRID.DDA_F / Math.sin(halfBin());

/**
 * 地圖主方位:一組線段的「mod 90° 長度加權圓平均」,回 (−45°, 45°] 的弧度,無樣本回 null。
 * ×4 倍角是關鍵 —— 地籍格網對 90° 旋轉對稱,不取 4 倍角的話南北向與東西向街道會互相抵銷成 0。
 * 取樣面由呼叫端決定(烘焙取**大馬路**、`ground.js` 的擺件格網取全部道路),本檔只有這一份實作。
 * @param {Array<[number,number,number,number]>} segs 世界座標線段 [x0,z0,x1,z1]
 */
export function gridAngle(segs) {
  let sx = 0, sz = 0;
  for (const s of segs) {
    const dx = s[2] - s[0], dz = s[3] - s[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) continue;
    const a4 = Math.atan2(dz, dx) * 4;
    sx += Math.cos(a4) * len;
    sz += Math.sin(a4) * len;
  }
  if (sx * sx + sz * sz <= 1e-12) return null;
  return Math.atan2(sz, sx) / 4;
}

/** ways(`{tags, geometry:[{lat,lon}]}`)攤成 gridAngle 吃的線段陣列;filter 缺席 = 全收 */
export function waySegs(ways, toXZ, filter = null) {
  const segs = [];
  for (const w of ways || []) {
    if (filter && !filter(w)) continue;
    const g = w.geometry || [];
    for (let i = 1; i < g.length; i++) {
      const a = toXZ(g[i - 1]), b = toXZ(g[i]);
      segs.push([a[0], a[1], b[0], b[1]]);
    }
  }
  return segs;
}

/**
 * 主方位的**取樣面**:大馬路。使用者定案的原句是「對齊最多的**大馬路**組成正交網格」,
 * 不是「對齊最多的路」—— 巷弄與 service 道路在市區的總長度遠大於幹道,收進來的話主方位
 * 會被停車場通道與後巷帶著走(它們本來就不成格網)。
 * `.source` 就是 Overpass 查詢要的字串 ⇒ **離線烘焙與執行期共用同一份定義**,
 * MUST NOT 在查詢字串裡再手寫一次(那是第二份會過期的取樣面)。
 */
export const GRID_HW = /^(motorway|trunk|primary|secondary|tertiary)$/;

/**
 * 地圖主方位(**度**):把地圖轉這麼多度,這一帶的大馬路就會對齊世界軸。量不到回 null。
 *
 * 這是「一組 way → 一個角度」的**唯一縫**,離線烘焙(`tools/bake_venue_grid.mjs`)與
 * 執行期(自訂地圖存入最愛時量一次)同吃。三件事綁在一起,拆開任何一件都會讓兩條路徑
 * 算出不同的角度(而畫面上只表現成「這張圖沒轉正」):
 *   ① 取樣面 = `GRID_HW`(大馬路);
 *   ② 量測 MUST 在**未旋轉**的框裡做(`toXZ` 的 center MUST NOT 帶 rot)—— 量到的是
 *      「格網相對正北偏多少」;
 *   ③ 旋轉量是它的**負值**(把格網轉回軸對齊)。
 * @param {Array<{tags:object, geometry:Array<{lat:number,lon:number}>}>} ways
 * @param {(p:{lat:number,lon:number}) => [number, number]} toXZ 未旋轉框的投影
 */
export function roadGridRotDeg(ways, toXZ) {
  const segs = waySegs(ways, toXZ, (w) => GRID_HW.test(w.tags?.highway || ''));
  if (!segs.length) return null;
  const a = gridAngle(segs);
  return a == null ? null : -a * 180 / Math.PI;
}

/** 方位角 → 最近的格(0..DIRS-1) */
function nearestDir(a) {
  const N = ROAD_GRID.DIRS;
  return ((Math.round(a / (Math.PI * 2 / N)) % N) + N) % N;
}
/** 帶號最小夾角(−π, π] */
function wrapPi(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }

/**
 * 逐 way 指派方向格(去鋸齒的兩道手續都在這裡)。
 *
 * ⓐ 主手續是**位置空間**的遲滯,不是角度空間的:沿著 way 走一遍,一邊用「已選的格 + 原段長」
 *    推進一個虛擬位置 `cur`,一邊和真實頂點比 —— **只要 `cur` 還在真實路線的 MAX_DRIFT_M 之內
 *    就繼續沿用同一格**,離太遠才換格,而且換格時是「從 `cur` 指向下一個**真實**頂點」
 *    (自我修正 ⇒ 偏差不累積)。這一步同時買到三件事:
 *      ・沿用同一格 = 長直段 ⇒ 不是鋸齒(換格週期 ≈ MAX_DRIFT_M / sin(11.25°) ≈ 72m);
 *      ・偏差有界 ⇒ 路不會走離衛星底圖、不會離開自己那條兵線;
 *      ・剛好落在格上的路(全域旋轉之後的大馬路就是)一次都不會換格。
 *    角度空間的遲滯(「差幾度以內就沿用」)做不到這三件事:它管得住格界抖動,管不住
 *    「整條路系統性偏 11.25°」—— 那種路會被整條吸到鄰格上,尾端甩出去幾百公尺。
 * ⓑ **MUST NOT 再加一道事後的「短段併入鄰段」** —— 那是角度遲滯時代的清理手續,在 DDA 上是
 *    反效果:它會把 DDA 剛排好的階梯整個併回同一格,於是整段變成單一方向 ⇒ 長度重解退化
 *    ⇒「兩錨點之間拉直」= 那條路等於沒被量化。實測(同一份合成路網):拿掉併段後角度誤差
 *    p90 由 5.9° 掉到 0.5°、斜街/圓弧/格界長直路三條由 6~10° 掉到 0.00°,而直段均長只從
 *    122m 降到 86m —— 併段買到的「更長的直段」本來就不是問題,它賣掉的才是。
 *
 * @returns {number[]} 每一段(頂點數 − 1)的格號
 */
function assignDirs(ch, px, pz) {
  const m = ch.length - 1;
  if (m < 1) return [];
  // DDA 的換格門檻**刻意低於**硬上限:走完這一步還會再吃掉一個細分步的偏差,而後面的
  // 長度重解也要有餘裕落地 —— 門檻頂著硬上限的話,DDA 自己走出來的路徑就已經卡在邊界上,
  // 長度重解的候選解一律驗不過、整段退回「兩錨點之間拉直」= 那條路等於沒被量化。
  const CAP = ROAD_GRID.MAX_DRIFT_M * ROAD_GRID.DDA_F;
  const len = new Array(m), d = new Array(m).fill(0);
  for (let i = 0; i < m; i++) {
    len[i] = Math.hypot(px[ch[i + 1]] - px[ch[i]], pz[ch[i + 1]] - pz[ch[i]]);
  }
  // ---- ⓐ 沿路 DDA:偏差在預算內就不換格 ----
  let cx = px[ch[0]], cz = pz[ch[0]];
  let k = -1;
  for (let i = 0; i < m; i++) {
    if (len[i] < 1e-9) { d[i] = k < 0 ? 0 : k; continue; }
    const tx = px[ch[i + 1]], tz = pz[ch[i + 1]];
    if (k >= 0) {
      const a = dirAngle(k);
      const dev = Math.hypot(cx + Math.cos(a) * len[i] - tx, cz + Math.sin(a) * len[i] - tz);
      if (dev > CAP) k = -1;
    }
    if (k < 0) k = nearestDir(Math.atan2(tz - cz, tx - cx));
    const a = dirAngle(k);
    cx += Math.cos(a) * len[i];
    cz += Math.sin(a) * len[i];
    d[i] = k;
  }
  return d;
}

/**
 * 節點鬆弛:把每條邊的「垂直於指定方向」的分量逐次投影掉(Gauss-Seidel/PBD),
 * 同時以退火的權重把節點拉回原位(形狀保真;收尾權重降到 ANCHOR_END 倍 ⇒ 方向贏)。
 * 投影對兩端**對稱**施力 ⇒ 每條邊的中點不動 ⇒ 整體不會平移漂走。
 * 掃描方向逐輪交替(前向/後向),長鏈的修正才不會只從一頭慢慢擴散。
 */
function relax(edges, px, pz, qx, qz) {
  const m = edges.a.length;
  if (!m) return;
  const n = qx.length;
  const { RELAX_SWEEPS, ANCHOR_W, ANCHOR_END } = ROAD_GRID;
  for (let s = 0; s < RELAX_SWEEPS; s++) {
    const fwd = (s & 1) === 0;
    for (let t = 0; t < m; t++) {
      const e = fwd ? t : m - 1 - t;
      const a = edges.a[e], b = edges.b[e], ux = edges.ux[e], uz = edges.uz[e];
      const dx = qx[b] - qx[a], dz = qz[b] - qz[a];
      const pr = dx * ux + dz * uz;
      const ex = (dx - ux * pr) * 0.5, ez = (dz - uz * pr) * 0.5;
      qx[a] += ex; qz[a] += ez;
      qx[b] -= ex; qz[b] -= ez;
    }
    const w = ANCHOR_W * (1 + (ANCHOR_END - 1) * (RELAX_SWEEPS < 2 ? 1 : s / (RELAX_SWEEPS - 1)));
    for (let i = 0; i < n; i++) {
      qx[i] += (px[i] - qx[i]) * w;
      qz[i] += (pz[i] - qz[i]) * w;
      clampDrift(qx, qz, px, pz, i);   // 位移硬上限 MUST 每一輪都夾(只夾收尾 = 中途早就飛出去)
    }
  }
}

/**
 * 逐「錨點 → 錨點」段落重解**長度**:段內每一條邊都精確落在自己那一格上,而且精確收在
 * 兩端錨點(路口)之上 —— 這就是「無縫準確貼合」。
 * 解法 = 在 Σ Lᵢ·uᵢ = D 這兩條線性約束下,對原長做最小平方修正(2×2 法方程,解析解)。
 * 兩種退化都退回「兩錨點之間等比直線擺放」(仍然沒有鋸齒,只是那一段的方位不精確):
 *   ・方向集張不開 2D(整段被併成同一格 = 一條直路)⇒ 垂直分量本來就補不回來;
 *   ・修正後出現負長度(方向彼此幾乎反向的病態段)⇒ 硬解會讓路自己折回去。
 */
function closeRun(ch, d, s, e, px, pz, qx, qz) {
  const m = e - s;
  if (m < 2) return;                       // 單邊段落:方向由鬆弛決定,這裡無事可做
  const ax = ch[s], bx = ch[e];
  const Dx = qx[bx] - qx[ax], Dz = qz[bx] - qz[ax];
  let m00 = 0, m01 = 0, m11 = 0, sx = 0, sz = 0;
  const ux = new Array(m), uz = new Array(m), L = new Array(m);
  for (let i = 0; i < m; i++) {
    const a = dirAngle(d[s + i]);
    ux[i] = Math.cos(a); uz[i] = Math.sin(a);
    const p = ch[s + i], q = ch[s + i + 1];
    L[i] = Math.hypot(px[q] - px[p], pz[q] - pz[p]);
    m00 += ux[i] * ux[i]; m01 += ux[i] * uz[i]; m11 += uz[i] * uz[i];
    sx += ux[i] * L[i]; sz += uz[i] * L[i];
  }
  const det = m00 * m11 - m01 * m01;
  const tr = m00 + m11;
  let okSolve = det > ROAD_GRID.DEGEN_EPS * tr * tr;
  if (okSolve) {
    const rx = Dx - sx, rz = Dz - sz;
    const lx = (m11 * rx - m01 * rz) / det, lz = (m00 * rz - m01 * rx) / det;
    for (let i = 0; i < m; i++) {
      L[i] += ux[i] * lx + uz[i] * lz;
      if (L[i] < 0) { okSolve = false; break; }
    }
  }
  // 候選解 MUST 先整段驗過位移上限再落地 —— 精確落格是加分題,「路不准走掉」是硬約束。
  // 落地後才夾會把剛解出來的精確段落夾歪(等於白解),所以是 check-then-apply。
  const cand = new Array(m - 1);
  if (okSolve) {
    let cx = qx[ax], cz = qz[ax];
    for (let i = 0; i < m - 1; i++) {
      cx += ux[i] * L[i]; cz += uz[i] * L[i];
      cand[i] = [cx, cz];
      const id = ch[s + i + 1];
      if (Math.hypot(cx - px[id], cz - pz[id]) > ROAD_GRID.MAX_DRIFT_M) { okSolve = false; break; }
    }
  }
  if (okSolve) {
    for (let i = 0; i < m - 1; i++) { qx[ch[s + i + 1]] = cand[i][0]; qz[ch[s + i + 1]] = cand[i][1]; }
    return;
  }
  // 退化 / 超出位移上限:兩錨點之間依原長等比擺放(共線 ⇒ 仍無鋸齒);同樣先驗再落地
  let tot = 0;
  for (let i = 0; i < m; i++) tot += Math.hypot(px[ch[s + i + 1]] - px[ch[s + i]], pz[ch[s + i + 1]] - pz[ch[s + i]]);
  if (tot <= 0) return;
  let acc = 0;
  for (let i = 0; i < m - 1; i++) {
    acc += Math.hypot(px[ch[s + i + 1]] - px[ch[s + i]], pz[ch[s + i + 1]] - pz[ch[s + i]]);
    const f = acc / tot;
    const id = ch[s + i + 1];
    const cx = qx[ax] + Dx * f, cz = qz[ax] + Dz * f;
    if (Math.hypot(cx - px[id], cz - pz[id]) > ROAD_GRID.MAX_DRIFT_M) return;   // 這一段整段維持鬆弛解
    cand[i] = [cx, cz];
  }
  for (let i = 0; i < m - 1; i++) { qx[ch[s + i + 1]] = cand[i][0]; qz[ch[s + i + 1]] = cand[i][1]; }
}

/**
 * 把整份路網量化到 16 個方向。**way 的順序、tags、端點的節點身分一律不變**;頂點會因為
 * 量化前的細分而變多(見 `DENSIFY_F`)—— 下游本來就會再 densify 到 `ROAD_SEG`,多出來的
 * 頂點只是提早出現,`mergeGradeChains` 靠端點配對、`way._tun[ri]` 在此之後才建,皆不受影響。
 *
 * @param {Array} ways   `{tags, geometry:[{lat,lon}]}`;原陣列不被修改(回新的 way 物件)
 * @param {(p)=>[number,number]} toXZ   `{lat,lon}` → 世界公尺
 * @param {(x,z)=>{lat,lon}} toLL       世界公尺 → `{lat,lon}`
 * @param {object} [stats]              選填;填入 `{nodes, edges, anchors, offDeg, movedM}` 供稽核/烘焙報表
 * @returns {Array} 量化後的 ways
 */
export function quantizeRoads(ways, toXZ, toLL, stats = null) {
  if (!ways?.length) return ways;
  // ---- ① 節點索引 + 細分 ----
  // 共用節點 = 同一把鑰匙 ⇒ 路口的連通性由「同一個 id」保證。OSM `out geom` 在共用節點上
  // 給的是**逐位元相同**的 lat/lon,字串鍵直接對得上;MUST NOT 先 round(兩條路的路口被
  // round 到不同格 = 路口裂開)。細分點是 way 自己的內部點、**永不共用** ⇒ 不進鑰匙表,
  // 也因此不會把兩條剛好交錯而過的路誤黏成一個路口。
  const idx = new Map();
  const px = [], pz = [];
  const newNode = (x, z) => { px.push(x); pz.push(z); return px.length - 1; };
  const nodeOf = (p) => {
    const k = `${p.lat},${p.lon}`;
    let id = idx.get(k);
    if (id === undefined) {
      const xz = toXZ(p);
      id = newNode(xz[0], xz[1]);
      idx.set(k, id);
    }
    return id;
  };
  const SEG = densifyM();
  const chains = ways.map((w) => {
    const g = w.geometry || [];
    if (g.length < 2) return g.map(nodeOf);
    const ch = [nodeOf(g[0])];
    for (let i = 1; i < g.length; i++) {
      const a = ch[ch.length - 1], b = nodeOf(g[i]);
      const ax = px[a], az = pz[a], bx = px[b], bz = pz[b];
      const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / SEG));
      for (let t = 1; t < k; t++) ch.push(newNode(ax + (bx - ax) * t / k, az + (bz - az) * t / k));
      ch.push(b);   // 原始頂點 MUST 是**同一個 id**(內插到端點會差最後一個 ulp = 路口裂開)
    }
    return ch;
  });
  const n = px.length;
  const qx = Float64Array.from(px), qz = Float64Array.from(pz);
  // 錨點 = 路口與端點:way 端點 / 被兩條以上 way 用到 / 同一條 way 自交
  const hits = new Int32Array(n);
  const anchor = new Uint8Array(n);
  for (const ch of chains) {
    if (!ch.length) continue;
    anchor[ch[0]] = 1;
    anchor[ch[ch.length - 1]] = 1;
    const seen = new Set();
    for (const id of ch) {
      if (seen.has(id)) anchor[id] = 1;
      else { seen.add(id); hits[id]++; }
    }
  }
  for (let i = 0; i < n; i++) if (hits[i] > 1) anchor[i] = 1;

  // ---- ② 逐 way 指派方向格(遲滯 + 短段併入)----
  const dirs = chains.map((ch) => assignDirs(ch, px, pz));

  // ---- ③ 全域節點鬆弛 ----
  const edges = { a: [], b: [], ux: [], uz: [] };
  for (let w = 0; w < chains.length; w++) {
    const ch = chains[w], d = dirs[w];
    for (let i = 0; i < d.length; i++) {
      if (ch[i] === ch[i + 1]) continue;
      const a = dirAngle(d[i]);
      edges.a.push(ch[i]); edges.b.push(ch[i + 1]);
      edges.ux.push(Math.cos(a)); edges.uz.push(Math.sin(a));
    }
  }
  relax(edges, px, pz, qx, qz);

  // ---- ④ 逐段長度重解(段內精確落格 + 精確收在錨點上)----
  for (let w = 0; w < chains.length; w++) {
    const ch = chains[w], d = dirs[w];
    if (d.length < 2) continue;
    let s = 0;
    for (let e = 1; e < ch.length; e++) {
      if (e < ch.length - 1 && !anchor[ch[e]]) continue;
      closeRun(ch, d, s, e, px, pz, qx, qz);
      s = e;
    }
  }

  // ---- ⑤ 寫回經緯度(同一個節點 id ⇒ 兩條 way 拿到逐位元相同的 lat/lon)----
  const out = ways.map((w, wi) => {
    const ch = chains[wi];
    if (!ch.length) return w;
    return { ...w, geometry: ch.map((id) => toLL(qx[id], qz[id])) };
  });

  if (stats) {
    let anchors = 0;
    for (let i = 0; i < n; i++) if (anchor[i]) anchors++;
    const off = [], mv = [];
    for (let e = 0; e < edges.a.length; e++) {
      const a = edges.a[e], b = edges.b[e];
      const dx = qx[b] - qx[a], dz = qz[b] - qz[a];
      if (Math.hypot(dx, dz) < 1e-9) continue;
      off.push(Math.abs(wrapPi(Math.atan2(dz, dx) - Math.atan2(edges.uz[e], edges.ux[e]))) * 180 / Math.PI);
    }
    for (let i = 0; i < n; i++) mv.push(Math.hypot(qx[i] - px[i], qz[i] - pz[i]));
    const pct = (arr, p) => (arr.length ? arr.slice().sort((x, y) => x - y)[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0);
    stats.nodes = n;
    stats.edges = edges.a.length;
    stats.anchors = anchors;
    stats.offDeg = { p50: pct(off, 0.5), p90: pct(off, 0.9), p99: pct(off, 0.99), max: off.length ? Math.max(...off) : 0 };
    stats.movedM = { p50: pct(mv, 0.5), p90: pct(mv, 0.9), max: mv.length ? Math.max(...mv) : 0 };
  }
  return out;
}

/**
 * 量測「一份路網離 16 方向有多遠」(度):稽核與烘焙報表用,對量化前後同一把尺。
 * 回 `{n, p50, p90, max}`。
 */
export function dirErrorDeg(ways, toXZ) {
  const STEP = Math.PI * 2 / ROAD_GRID.DIRS;
  const es = [];
  for (const s of waySegs(ways, toXZ)) {
    const dx = s[2] - s[0], dz = s[3] - s[1];
    if (Math.hypot(dx, dz) < 1e-9) continue;
    const a = Math.atan2(dz, dx);
    es.push(Math.abs(wrapPi(a - Math.round(a / STEP) * STEP)) * 180 / Math.PI);
  }
  es.sort((x, y) => x - y);
  const at = (p) => (es.length ? es[Math.min(es.length - 1, Math.floor(es.length * p))] : 0);
  return { n: es.length, p50: at(0.5), p90: at(0.9), max: es.length ? es[es.length - 1] : 0 };
}
