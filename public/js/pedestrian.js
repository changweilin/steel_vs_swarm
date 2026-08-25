// ============ 行人路網語意規劃 ============
// OSM 步道先在此分成四種結果：
//   ① bridge=yes 的戶外步道保留並建成人行天橋；
//   ② 地下／室內負樓層步道移除路線，只留下端點出入口；
//   ③ 車站入口節點與車站附近的地下端點共用車站入口外觀；
//   ④ 與同層道路／鐵道長距離平行的步道，統一規劃成老街、綠廊或自行車道。
//
// 本檔零 import、零 THREE、零亂數。圖資分類、入口落點與沿線主題只有這一份；biomes.js
// 只把結果翻成幾何。輸入 way 不就地修改，供離線稽核直接吃同一支真品。

export const PED_PLAN = {
  NEAR_M: 24,             // 同層平行走廊的最大橫距（遊戲公尺；REAL_SCALE=0.5 時約 12m 真實距離）
  PARALLEL_DEG: 24,
  MIN_PARALLEL_F: 0.42,   // 至少此比例的步道路段貼著道路／鐵道才整條套主題
  STATION_NEAR_M: 140,    // 車站附近入口與商圈老街的判定半徑（約 70m 真實距離）
  ENTRANCE_MERGE_M: 10,
  FOOTBRIDGE_MIN_W_M: 6,  // 單機體可通行；車行橋仍走既有 PASS_W
  DRESS_STEP_M: 18,
};

// 一個生成器族 + 一張款式表；渲染端不得為每一款複製一套建模函式。
export const PED_ARCHETYPES = Object.freeze({
  station:   { w: 5.8, d: 7.2, h: 3.3, roof: 0x44687c, frame: 0xd8e0e3, wall: 0x91a6ad },
  underpass: { w: 5.2, d: 6.4, h: 2.8, roof: 0x77736b, frame: 0xb7b4aa, wall: 0x8f8b82 },
});

const PED_HW = /^(footway|path|pedestrian|steps|cycleway|bridleway)$/;
const on = (v) => v != null && !/^(?:no|false|0)$/.test(String(v));
const layerOf = (tags) => {
  const n = Number(tags?.layer ?? tags?.level);
  return Number.isFinite(n) ? n : 0;
};

export const isPedestrianWay = (tags) => PED_HW.test(tags?.highway || '');
export const isPedestrianBridge = (tags) => isPedestrianWay(tags)
  && on(tags?.bridge) && !on(tags?.tunnel) && tags?.location !== 'underground';

export function isUndergroundPedestrian(tags) {
  if (!isPedestrianWay(tags) || isPedestrianBridge(tags)) return false;
  if (on(tags?.tunnel) || tags?.location === 'underground') return true;
  const indoor = on(tags?.indoor);
  return layerOf(tags) < 0 || (indoor && Number(tags?.level) < 0);
}

const isStation = (tags) => /^(?:station|halt)$/.test(tags?.railway || '')
  || tags?.public_transport === 'station';
const isEntrance = (tags) => /^(?:subway_entrance|station_entrance)$/.test(tags?.railway || '')
  || (on(tags?.entrance) && /^(?:station|subway)$/.test(tags?.public_transport || ''));
const explicitCycle = (tags) => tags?.highway === 'cycleway'
  || /^(?:yes|designated|official)$/.test(tags?.bicycle || '')
  || on(tags?.cycleway) || tags?.segregated === 'yes';

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
const pointSeg = (x, z, s) => {
  const dx = s.bx - s.ax, dz = s.bz - s.az, d2 = dx * dx + dz * dz;
  const t = d2 > 1e-9 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / d2)) : 0;
  const qx = s.ax + dx * t, qz = s.az + dz * t;
  return { d2: (x - qx) ** 2 + (z - qz) ** 2, qx, qz };
};

function projected(geometry, toXZ) {
  const out = [];
  for (const p of geometry || []) {
    const q = toXZ(p);
    if (Number.isFinite(q?.[0]) && Number.isFinite(q?.[1])) out.push([q[0], q[1]]);
  }
  return out;
}

function segmentsOf(items, toXZ, kind, filter = null) {
  const out = [];
  for (const item of items || []) {
    if (filter && !filter(item.tags || {})) continue;
    const pts = projected(item.geometry, toXZ);
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.2) continue;
      out.push({ ax, az, bx, bz, ux: (bx - ax) / len, uz: (bz - az) / len,
        len, kind, layer: layerOf(item.tags), tags: item.tags || {} });
    }
  }
  return out;
}

function nearestPoint(x, z, segs, layer = null) {
  let best = null;
  for (const s of segs) {
    if (layer != null && s.layer !== layer) continue;
    const q = pointSeg(x, z, s);
    if (!best || q.d2 < best.d2) best = { ...q, seg: s };
  }
  return best;
}

function nearestStation(x, z, stations) {
  let best = null;
  for (const s of stations) {
    const d2 = (x - s.x) ** 2 + (z - s.z) ** 2;
    if (!best || d2 < best.d2) best = { ...s, d2 };
  }
  return best && best.d2 <= PED_PLAN.STATION_NEAR_M ** 2 ? best : null;
}

function corridorTheme(way, pts, targets, stations) {
  if (explicitCycle(way.tags || {})) return 'cycleway';
  let total = 0, road = 0, rail = 0;
  const cos = Math.cos(PED_PLAN.PARALLEL_DEG * Math.PI / 180);
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.2) continue;
    total += len;
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    let hit = null;
    for (const s of targets) {
      if (s.layer !== layerOf(way.tags)) continue;
      if (Math.abs(ux * s.ux + uz * s.uz) < cos) continue;
      const q = pointSeg(mx, mz, s);
      if (q.d2 > PED_PLAN.NEAR_M ** 2) continue;
      if (!hit || q.d2 < hit.d2) hit = { d2: q.d2, kind: s.kind };
    }
    if (hit?.kind === 'rail') rail += len;
    else if (hit?.kind === 'road') road += len;
  }
  if (!total || (road + rail) / total < PED_PLAN.MIN_PARALLEL_F) return null;
  const mid = pts[(pts.length / 2) | 0];
  if (nearestStation(mid[0], mid[1], stations) || way.tags?.highway === 'pedestrian') return 'oldstreet';
  return rail >= road ? 'cycleway' : 'promenade';
}

function offsetBesideRoad(x, z, dx, dz, roadTargets) {
  if (!roadTargets || !roadTargets.length) return { x, z, ry: Math.atan2(dx, dz) };
  const nearRoad = nearestPoint(x, z, roadTargets);
  if (!nearRoad) return { x, z, ry: Math.atan2(dx, dz) };
  const d = Math.sqrt(nearRoad.d2);
  const roadHw = 4.5;
  const minClearance = roadHw + 3.5 + 1.2; // 9.2m: 移至道路旁路緣/人行道,杜絕壓在車道上
  if (d < minClearance) {
    let nx = x - nearRoad.qx, nz = z - nearRoad.qz;
    let nl = Math.hypot(nx, nz);
    if (nl < 0.1) {
      nx = -nearRoad.seg.uz;
      nz = nearRoad.seg.ux;
      if (dx * nx + dz * nz < 0) { nx = -nx; nz = -nz; }
      nl = 1;
    }
    nx /= nl;
    nz /= nl;
    const nxPos = nearRoad.qx + nx * minClearance;
    const nzPos = nearRoad.qz + nz * minClearance;
    const ry = Math.atan2(nearRoad.seg.ux, nearRoad.seg.uz);
    return { x: nxPos, z: nzPos, ry };
  }
  return { x, z, ry: Math.atan2(dx, dz) };
}

function endpointSites(way, pts, stations, roadTargets = null) {
  if (pts.length < 2) return [];
  // 封閉地下環沒有可辨識的地面端點；不得在重合起終點憑空捏造一座入口。
  if (dist2(pts[0], pts[pts.length - 1]) <= PED_PLAN.ENTRANCE_MERGE_M ** 2) return [];
  const ends = [[0, 1], [pts.length - 1, pts.length - 2]];
  return ends.map(([i, j]) => {
    const [x, z] = pts[i], [ix, iz] = pts[j];
    const dx = x - ix, dz = z - iz;
    const placed = offsetBesideRoad(x, z, dx, dz, roadTargets);
    const station = nearestStation(placed.x, placed.z, stations);
    return { x: placed.x, z: placed.z, ry: placed.ry, kind: station ? 'station' : 'underpass',
      tags: way.tags || {}, stationTags: station?.tags || null, source: 'underground-end' };
  });
}

function mergeEntrances(sites) {
  const out = [];
  for (const site of sites) {
    const hit = out.find((e) => dist2([e.x, e.z], [site.x, site.z]) <= PED_PLAN.ENTRANCE_MERGE_M ** 2);
    if (!hit) { out.push({ ...site }); continue; }
    if (site.kind === 'station' && hit.kind !== 'station') Object.assign(hit, site);
    else {
      hit.stationTags ||= site.stationTags;
      if (!Object.keys(hit.tags || {}).length) hit.tags = site.tags;
    }
  }
  return out;
}

/**
 * @returns {{roads:Array, entrances:Array, stats:object}}
 */
export function planPedestrianNetwork({ roads = [], rails = [], pois = [], entrances = [], toXZ }) {
  if (typeof toXZ !== 'function') throw new TypeError('planPedestrianNetwork 需要 toXZ');
  const stations = (pois || []).filter((p) => isStation(p.tags || {})).map((p) => {
    const [x, z] = toXZ({ lat: p.lat, lon: p.lng ?? p.lon });
    return { x, z, tags: p.tags || {} };
  }).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z));
  const roadTargets = segmentsOf(roads, toXZ, 'road', (t) => !isPedestrianWay(t));
  const railTargets = segmentsOf(rails, toXZ, 'rail');
  const targets = [...roadTargets, ...railTargets];
  const kept = [], sites = [];
  let underground = 0, footbridges = 0, oldstreet = 0, cycleway = 0, promenade = 0;

  for (const way of roads || []) {
    if (!isPedestrianWay(way.tags || {})) { kept.push(way); continue; }
    const pts = projected(way.geometry, toXZ);
    if (isUndergroundPedestrian(way.tags || {})) {
      underground++;
      sites.push(...endpointSites(way, pts, stations, roadTargets));
      continue;
    }
    let theme = null, kind = 'path';
    if (isPedestrianBridge(way.tags || {})) { kind = theme = 'footbridge'; footbridges++; }
    else theme = corridorTheme(way, pts, targets, stations);
    if (theme === 'oldstreet') oldstreet++;
    else if (theme === 'cycleway') cycleway++;
    else if (theme === 'promenade') promenade++;
    kept.push(theme ? { ...way, _ped: { kind, theme } } : way);
  }

  for (const e of entrances || []) {
    if (!isEntrance(e.tags || {})) continue;
    const [x, z] = toXZ({ lat: e.lat, lon: e.lng ?? e.lon });
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    const station = nearestStation(x, z, stations);
    const nearRoad = nearestPoint(x, z, roadTargets, layerOf(e.tags));
    let dx = station ? x - station.x : 0, dz = station ? z - station.z : 0;
    if (nearRoad && nearRoad.d2 < PED_PLAN.STATION_NEAR_M ** 2) {
      dx = nearRoad.qx - x; dz = nearRoad.qz - z;
      if (dx * dx + dz * dz < 0.25) { dx = nearRoad.seg.uz; dz = -nearRoad.seg.ux; }
    }
    if (dx * dx + dz * dz < 0.25) { dx = 0; dz = 1; }
    const placed = offsetBesideRoad(x, z, dx, dz, roadTargets);
    sites.push({ x: placed.x, z: placed.z, ry: placed.ry, kind: 'station', tags: e.tags || {},
      stationTags: station?.tags || null, source: 'osm-entrance' });
  }

  const merged = mergeEntrances(sites);
  return { roads: kept, entrances: merged, stats: {
    inputWays: roads.length, outputWays: kept.length, undergroundRemoved: underground,
    entrances: merged.length, footbridges, oldstreet, cycleway, promenade,
  } };
}
