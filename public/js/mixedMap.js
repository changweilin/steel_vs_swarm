import { TEAM, MAPGEO, battleBBox, llToXZ, lanePathBalanceAudit, laneSeparationAudit, towerLayoutAudit, MOTHER_LANES } from './data.js';
import { VENUE_LANES } from './venueLanes.js';
import { venueConfig } from './venues.js';
import { mulberry32 } from './rng.js';
import { mixedMapConfig } from './mapgen.js';
import { MIXED_LAYERS, MIXED_MIN_REGION_M } from './mapLayerSources.js';
import { venueAvailability } from './venues.js';
import { MAP_ROAD_PROFILE } from './mapRules.js';

// A venue's synthetic flag also covers partially synthesized mothers; inspect the raw bake.
export function mixedRoadFrame(venue) {
  if (!venueAvailability(venue).available) return null;
  const raw = VENUE_LANES[venue?.id]?.[MOTHER_LANES];
  if (!raw?.lanes || raw.lanes.length !== MOTHER_LANES) return null;
  const cfg = venueConfig(venue, TEAM.MAX);
  if (JSON.stringify(cfg.motherLanes) !== JSON.stringify(raw.lanes)) return null;
  const game = cfg.motherLanes.map(lane => lane.map(p => llToXZ(...p, cfg.center)));
  if (!lanePathBalanceAudit(game, MOTHER_LANES).ok || !laneSeparationAudit(game).ok || !towerLayoutAudit(game).ok) return null;
  return cfg;
}

export function mixedRoadCount(roads, bbox) {
  return (Array.isArray(roads) ? roads : []).filter(road => {
    if (!MAP_ROAD_PROFILE.test(road?.tags?.highway || '') || !Array.isArray(road.geometry)) return false;
    return road.geometry.some((p, i, points) => {
      const q = points[i + 1];
      const lng = p?.lon ?? p?.lng, nextLng = q?.lon ?? q?.lng;
      if (![p?.lat, lng, q?.lat, nextLng].every(Number.isFinite) || (p.lat === q.lat && lng === nextLng)) return false;
      // Ignore ways outside the capture; Overpass may include the entire crossing way.
      if (Math.abs(p.lat) > 90 || Math.abs(q.lat) > 90 || Math.abs(lng) > 180 || Math.abs(nextLng) > 180) return false;
      let lo = 0, hi = 1;
      for (const [a, b, min, max] of [[p.lat, q.lat, bbox.minLat, bbox.maxLat], [lng, nextLng, bbox.minLng, bbox.maxLng]]) {
        const d = b - a;
        if (!d) { if (a < min || a > max) return false; continue; }
        const t0 = (min - a) / d, t1 = (max - a) / d;
        lo = Math.max(lo, Math.min(t0, t1));
        hi = Math.min(hi, Math.max(t0, t1));
        if (lo > hi) return false;
      }
      return true;
    });
  }).length;
}

export async function generateMixedMap(venues, { seed, teamSize = TEAM.MAX, fetchRoads, signal, onProgress = () => {}, mixOverride = null } = {}) {
  if (typeof fetchRoads !== 'function' || !Number.isFinite(seed)) throw new TypeError('Mixed-map generation requires a road provider and a seed');
  const pool = [...new Map((Array.isArray(venues) ? venues : []).filter(v => v?.id && Array.isArray(v.ll)
    && v.ll.length === 2 && v.ll.every(Number.isFinite) && Math.abs(v.ll[0]) < 85 && Math.abs(v.ll[1]) <= 180)
    .map(v => [v.id, v])).values()];
  const rnd = mulberry32(seed >>> 0);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const sources = [];
  const checked = new Map();
  // Settle the real road mother first; other layers never move its coordinates.
  for (const role of ['surface', 'elevation', 'regional']) {
    let chosen = null;
    for (const venue of pool) {
      if (signal?.aborted) return null;
      const roadFrame = role === 'surface' ? mixedRoadFrame(venue) : null;
      if (role === 'surface' && !roadFrame) continue;
      const frame = roadFrame || venueConfig(venue, TEAM.MAX);
      if (sources.some(s => {
        const [x, z] = llToXZ(frame.center.lat, frame.center.lng, s.frame.center);
        return s.id === venue.id || Math.hypot(x, z) * MAPGEO.REAL_SCALE < MIXED_MIN_REGION_M;
      })) continue;
      onProgress(role, venue.name);
      const checkKey = role + '|' + venue.id;
      if (!checked.has(checkKey)) {
        const captureFrame = role === 'surface' ? frame : sources.find(s => s.role === 'surface').frame;
        const bbox = battleBBox(captureFrame, frame.center);
        let roads = null;
        try { roads = await fetchRoads(bbox); } catch { /* Failed verification excludes this source. */ }
        checked.set(checkKey, mixedRoadCount(roads, bbox));
      }
      if (signal?.aborted) return null;
      const roadCount = checked.get(checkKey);
      if (!roadCount) continue;
      chosen = { role, id: venue.id, name: venue.name, ll: venue.ll, mix: venue.mix,
        ampF: venue.ampF ?? 1, country: venue.country, weight: 1, frame, roadCount,
        laneSource: role === 'surface' ? 'osm-baked' : null };
      break;
    }
    if (!chosen) return null;
    sources.push(chosen);
  }
  return mixedMapConfig(MIXED_LAYERS.map(role => sources.find(s => s.role === role)), { seed, teamSize, mixOverride });
}
