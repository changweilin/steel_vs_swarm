// ============ Pedestrian Network Semantic Planning ============
// OSM walkways partition into four outcomes here:
//   1. bridge=yes outdoor walkways remain as footbridges;
//   2. Underground / indoor negative-level footpaths drop routing, keeping only endpoint portals;
//   3. Station entrance nodes and nearby underground portals share station portal styling;
//   4. Long-distance ground walkways parallel to roads/railways become themed corridors (heritage, greenway, bike path).
//
// Zero-import, zero-THREE, zero-RNG module. Source of truth for classification, portal placement,
// and corridor themes; biomes.js only converts results into geometry. Input ways are not mutated in-place.

export const PED_PLAN = {
  NEAR_M: 24,             // Maximum lateral distance for ground parallel corridor (game meters; ~12m real distance at REAL_SCALE=0.5)
  PARALLEL_DEG: 24,
  MIN_PARALLEL_F: 0.42,   // Minimum proportion of footway segments aligned with road/railway to theme whole way
  STATION_NEAR_M: 140,    // Detection radius for nearby station portals and commercial old streets (~70m real distance)
  ENTRANCE_MERGE_M: 10,
  FOOTBRIDGE_MIN_W_M: 6,  // Clearance for single mech; vehicular bridges use PASS_W
  DRESS_STEP_M: 18,
  JOINT_M: 0.06,          // Minimum overlap for structural seams; excluded from entrance collision OBB
};

// One generator family + archetype table; rendering code MUST NOT duplicate builders per style.
export const PED_ARCHETYPES = Object.freeze({
  // Base and legacy archetypes
  station:              { w: 5.8, d: 7.2, h: 3.3, roof: 0x44687c, frame: 0xd8e0e3, wall: 0x91a6ad, accent: 0xe0a030, style: 'canopy' },
  station_modern:       { w: 6.0, d: 7.6, h: 3.4, roof: 0x3a5d73, frame: 0xe0e6eb, wall: 0x768c96, accent: 0x357899, style: 'modern' },
  station_canopy:       { w: 5.6, d: 7.2, h: 3.2, roof: 0x2e6b8a, frame: 0xd0d8de, wall: 0x85a2b0, accent: 0x4a90e2, style: 'canopy' },
  station_pavilion:     { w: 6.2, d: 7.8, h: 3.6, roof: 0x5a4236, frame: 0xc8baa8, wall: 0x9e8a76, accent: 0xd4a373, style: 'pavilion' },
  underpass:            { w: 5.2, d: 6.4, h: 2.8, roof: 0x77736b, frame: 0xb7b4aa, wall: 0x8f8b82, accent: 0x9a9488, style: 'cantilever' },
  underpass_cantilever: { w: 5.4, d: 6.6, h: 3.0, roof: 0x485868, frame: 0xccd5dd, wall: 0x82919d, accent: 0x5b7082, style: 'cantilever' },
  underpass_concrete:   { w: 5.2, d: 6.4, h: 2.8, roof: 0x6e6a64, frame: 0x9c968e, wall: 0x8a847c, accent: 0xa89f91, style: 'concrete' },
  underpass_open:       { w: 4.8, d: 6.0, h: 2.2, roof: 0x505860, frame: 0xb8c0c8, wall: 0x707880, accent: 0x3b82f6, style: 'open' },
  underpass_covered:    { w: 5.0, d: 6.2, h: 2.9, roof: 0x3d6652, frame: 0xb4c2ba, wall: 0x7d8e85, accent: 0x2b8a5f, style: 'covered' },

  // Representative metro / station portals
  station_taipei:       { w: 6.2, d: 8.0, h: 3.6, roof: 0x247a8c, frame: 0xd8e4e8, wall: 0x6c96a3, accent: 0xf5b82e, style: 'arch_glass', city: 'taipei' },
  station_tokyo:        { w: 5.8, d: 7.6, h: 3.4, roof: 0x282c34, frame: 0x4a515e, wall: 0x616a78, accent: 0xf0c644, style: 'tokyo_slate', city: 'tokyo' },
  station_paris:        { w: 5.6, d: 7.2, h: 3.8, roof: 0x2b5443, frame: 0x1a382c, wall: 0x3a6652, accent: 0xe69138, style: 'art_nouveau', city: 'paris' },
  station_london:       { w: 6.0, d: 7.6, h: 3.5, roof: 0x243342, frame: 0x7b1c1c, wall: 0x4f1212, accent: 0xd32f2f, style: 'oxblood_tube', city: 'london' },
  station_nyc:          { w: 5.4, d: 7.0, h: 3.3, roof: 0x1f3b2c, frame: 0x14281e, wall: 0x264735, accent: 0x43a047, style: 'nyc_kiosk', city: 'nyc' },
  station_berlin:       { w: 6.2, d: 7.6, h: 3.4, roof: 0x475569, frame: 0xf59e0b, wall: 0x1d4ed8, accent: 0xd97706, style: 'bauhaus_portal', city: 'berlin' },
  station_fosterito:    { w: 6.4, d: 8.4, h: 3.8, roof: 0x48bb78, frame: 0xe2e8f0, wall: 0x94a3b8, accent: 0x0d9488, style: 'glass_cocoon', city: 'bilbao' },
  station_seoul:        { w: 6.0, d: 7.8, h: 3.5, roof: 0x2563eb, frame: 0xcfd8dc, wall: 0x78909c, accent: 0x1d4ed8, style: 'metallic_gabled', city: 'seoul' },

  // Representative underpass portals
  underpass_chika_mall: { w: 6.6, d: 8.2, h: 3.6, roof: 0x334155, frame: 0xf1f5f9, wall: 0x64748b, accent: 0xf97316, style: 'mall_portal', city: 'mall' },
  underpass_stone_arch: { w: 5.6, d: 7.0, h: 3.3, roof: 0x6b6357, frame: 0x998d7c, wall: 0x7d7263, accent: 0xbfa074, style: 'stone_arch', city: 'europe' },
  underpass_origami:    { w: 5.6, d: 7.2, h: 3.3, roof: 0x334155, frame: 0xb0bec5, wall: 0x546e7a, accent: 0x06b6d4, style: 'origami', city: 'modern' },
  underpass_glass_cube: { w: 5.4, d: 6.8, h: 3.2, roof: 0x5eead4, frame: 0x0f172a, wall: 0x2dd4bf, accent: 0x0f766e, style: 'glass_cube', city: 'nordic' },
});

/** Nominal portal envelope; shared between rendering and player/NPC/ballistic collision (PED_ARCHETYPES). */
export function pedestrianEntranceCollider(site, y) {
  const archKey = site?.archetype || site?.kind || 'underpass';
  const def = PED_ARCHETYPES[archKey] || PED_ARCHETYPES[site?.kind] || PED_ARCHETYPES.underpass;
  return {
    x: site.x, z: site.z, y: y - 0.1,
    hw2: def.w / 2, hd2: def.d / 2, ry: site.ry,
    r: Math.hypot(def.w, def.d) / 2,
    h: def.h + 0.2, name: 'pedestrian_entrance',
  };
}

const STATION_ARCHETYPES = [
  'station_taipei', 'station_tokyo', 'station_paris', 'station_london',
  'station_nyc', 'station_berlin', 'station_fosterito', 'station_seoul',
  'station_modern', 'station_canopy', 'station_pavilion', 'station',
];
const UNDERPASS_ARCHETYPES = [
  'underpass_chika_mall', 'underpass_stone_arch', 'underpass_origami', 'underpass_glass_cube',
  'underpass_cantilever', 'underpass_concrete', 'underpass_open', 'underpass_covered', 'underpass',
];

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

const ROAD_W = {
  motorway: 12, trunk: 11, primary: 10, secondary: 8, tertiary: 7,
  unclassified: 5, residential: 5.5, living_street: 5, service: 4,
  pedestrian: 4, track: 3.5, footway: 2.4, path: 2.2,
};

function roadHalfWidth(tags) {
  const base = ROAD_W[tags?.highway] || 5.5;
  const lanes = parseInt(tags?.lanes, 10) || 0;
  const w = lanes ? Math.max(base, lanes * 3.2) : base;
  return w / 2;
}

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
    const hw = roadHalfWidth(item.tags);
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.2) continue;
      out.push({ ax, az, bx, bz, ux: (bx - ax) / len, uz: (bz - az) / len,
        len, kind, hw, layer: layerOf(item.tags), tags: item.tags || {} });
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
  
  let posX = x, posZ = z;
  let nearRoad = null;

  // Iterative relaxation: push portal bounds and sidewalk buffer completely outside adjacent roadway curbs
  for (let iter = 0; iter < 3; iter++) {
    nearRoad = nearestPoint(posX, posZ, roadTargets);
    if (!nearRoad) break;
    const d = Math.sqrt(nearRoad.d2);
    const segHw = nearRoad.seg.hw || 4.5;
    // Portal radius (4.2m) + sidewalk buffer (2.5m) + lane half-width (segHw)
    const minClearance = segHw + 4.2 + 2.5;

    if (d < minClearance) {
      let nx = posX - nearRoad.qx, nz = posZ - nearRoad.qz;
      let nl = Math.hypot(nx, nz);
      if (nl < 0.1) {
        nx = -nearRoad.seg.uz;
        nz = nearRoad.seg.ux;
        if (dx * nx + dz * nz < 0) { nx = -nx; nz = -nz; }
        nl = 1;
      }
      nx /= nl;
      nz /= nl;
      posX = nearRoad.qx + nx * minClearance;
      posZ = nearRoad.qz + nz * minClearance;
    } else {
      break;
    }
  }

  if (!nearRoad) nearRoad = nearestPoint(posX, posZ, roadTargets);
  let nx = posX - nearRoad.qx, nz = posZ - nearRoad.qz;
  let nl = Math.hypot(nx, nz);
  if (nl < 0.1) {
    nx = -nearRoad.seg.uz;
    nz = nearRoad.seg.ux;
    if (dx * nx + dz * nz < 0) { nx = -nx; nz = -nz; }
    nl = 1;
  }
  nx /= nl;
  nz /= nl;

  // Portal orientation: facing roadway center or aligned with curb, never facing away from road
  // Towards road center: [-nx, -nz]
  // Aligned with curb: [nearRoad.seg.ux, nearRoad.seg.uz] or [-nearRoad.seg.ux, -nearRoad.seg.uz]
  const h = ((Math.round(posX * 10) * 73856093) ^ (Math.round(posZ * 10) * 19349663) ^ 101) >>> 0;
  const faceMode = (h % 100) < 45 ? 'road' : 'side'; // 45% facing road, 55% curb-aligned
  let ry;
  if (faceMode === 'road') {
    ry = Math.atan2(-nx, -nz);
  } else {
    const ux = nearRoad.seg.ux, uz = nearRoad.seg.uz;
    const dot = dx * ux + dz * uz;
    const sign = dot < 0 ? -1 : 1;
    ry = Math.atan2(ux * sign, uz * sign);
  }
  return { x: posX, z: posZ, ry };
}

function endpointSites(way, pts, stations, roadTargets = null) {
  if (pts.length < 2) return [];
  // Closed underground rings lack distinct surface endpoints; MUST NOT generate phantom portals at coincident terminals.
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

function clusterAndBrandEntrances(entrances, stations) {
  if (!entrances || !entrances.length) return entrances;
  const visited = new Set();
  const clusters = [];

  for (let i = 0; i < entrances.length; i++) {
    if (visited.has(i)) continue;
    const cluster = [entrances[i]];
    visited.add(i);
    for (let j = i + 1; j < entrances.length; j++) {
      if (visited.has(j)) continue;
      const e1 = entrances[i], e2 = entrances[j];
      const d2 = (e1.x - e2.x) ** 2 + (e1.z - e2.z) ** 2;
      const sameStation = e1.stationTags && e2.stationTags && e1.stationTags === e2.stationTags;
      if (sameStation || d2 <= PED_PLAN.STATION_NEAR_M ** 2) {
        cluster.push(e2);
        visited.add(j);
      }
    }
    clusters.push(cluster);
  }

  for (const cluster of clusters) {
    const isStat = cluster.some((e) => e.kind === 'station');
    // 1. Unify district / station naming across the cluster
    let baseName = null;
    for (const e of cluster) {
      const st = e.stationTags || e.tags;
      const name = st?.name || st?.['name:zh'] || st?.['name:zh-Hant'] || st?.['name:en'];
      if (name) { baseName = name; break; }
    }
    if (!baseName) {
      baseName = isStat ? '捷運站' : '人行地下道';
    }

    // 2. Unify architectural style per cluster (hashed from centroid and district name)
    const cx = cluster.reduce((sum, e) => sum + e.x, 0) / cluster.length;
    const cz = cluster.reduce((sum, e) => sum + e.z, 0) / cluster.length;
    let ch = ((Math.round(cx * 10) * 73856093) ^ (Math.round(cz * 10) * 19349663) ^ (baseName.length * 37)) >>> 0;
    const stylePool = isStat ? STATION_ARCHETYPES : UNDERPASS_ARCHETYPES;
    const styleKey = stylePool[ch % stylePool.length];

    // 3. Sequential geometric sorting and exit number assignment
    cluster.sort((a, b) => {
      const angA = Math.atan2(a.z - cz, a.x - cx);
      const angB = Math.atan2(b.z - cz, b.x - cx);
      return angA - angB || a.x - b.x || a.z - b.z;
    });

    cluster.forEach((e, idx) => {
      e.archetype = styleKey;
      const ref = e.tags?.ref || String(idx + 1);
      e.exitNum = ref;
      e.baseName = baseName;
      if (isStat) {
        e.signText = `${baseName} 出口 ${ref}`;
      } else {
        e.signText = cluster.length > 1 ? `${baseName} ${ref}號出入口` : `${baseName}`;
      }
    });
  }
  return entrances;
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
  const branded = clusterAndBrandEntrances(merged, stations);
  return { roads: kept, entrances: branded, stats: {
    inputWays: roads.length, outputWays: kept.length, undergroundRemoved: underground,
    entrances: branded.length, footbridges, oldstreet, cycleway, promenade,
  } };
}

