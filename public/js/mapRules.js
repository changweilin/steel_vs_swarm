import { MAPGEO, MOTHER_LANES, laneCountFor, laneSubsetFor, mapArg, mapPlan, geoLanesFor,
  sideMFor, overlapCellM, llToXZ, lanePathBalanceAudit, laneSeparationAudit,
  laneBacktrackFrac, laneUTurnAudit, laneTurnAccumAudit, laneIsSide, towerLayoutAudit, MAX_MAP_WATER_WET } from './data.js';

export const MAP_RULE_VERSION = 1;
export const MAP_ROAD_PROFILE = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)(_link)?$/;
export const MAP_RULE_LIMITS = Object.freeze({ ENDPOINT_GAME_M: .25, DETOUR: 2.2, OCCUPANCY_SAMPLES: 100000 });
const validPoint = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)
  && Math.abs(p[0]) < 85 && Math.abs(p[1]) <= 180;
const validLane = l => Array.isArray(l) && l.length >= 2 && l.length <= 12000 && l.every(validPoint);

/** Reject unbounded sampling before source-independent room geometry allocates occupancy grids. */
function withinOccupancyBudget(lanes, cell) {
  if (!(cell > 0)) return false;
  let samples = 0;
  for (const lane of lanes) for (let i = 1; i < lane.length; i++) {
    samples += Math.max(1, Math.ceil(Math.hypot(lane[i][0] - lane[i - 1][0], lane[i][1] - lane[i - 1][1]) / (cell / 2))) + 1;
    if (!Number.isFinite(samples) || samples > MAP_RULE_LIMITS.OCCUPANCY_SAMPLES) return false;
  }
  return true;
}

/** A canonical base anchors occupancy cells so side swaps cannot change a verdict. */
export function laneOverlapRatioXZ(a, b, cell) {
  if (!a?.length || !b?.length || !withinOccupancyBudget([a, b], cell)) return Infinity;
  const ends = [a[0], a.at(-1), b[0], b.at(-1)].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const [ox, oz] = ends[0];
  const cells = points => {
    const result = new Set();
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1], [bx, bz] = points[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (cell / 2)));
      for (let k = 0; k <= n; k++) result.add(`${Math.round((ax + (bx - ax) * k / n - ox) / cell)},${Math.round((az + (bz - az) * k / n - oz) / cell)}`);
    }
    return result;
  };
  const ca = cells(a), cb = cells(b);
  let shared = 0;
  for (const key of ca) if (cb.has(key)) shared++;
  return shared / Math.min(ca.size, cb.size);
}

export function mapGeometryMetrics(cfg) {
  const mother = cfg.motherLanes || cfg.lanes;
  if (!validPoint(cfg.bases?.SWARM) || !validPoint(cfg.bases?.STEEL)
    || !Number.isFinite(cfg.center?.lat) || !Number.isFinite(cfg.center?.lng)
    || Math.abs(cfg.center.lat) >= 85 || Math.abs(cfg.center.lng) > 180
    || !Number.isFinite(cfg.center.rot ?? 0) || !Array.isArray(mother)
    || mother.length < 1 || mother.length > MOTHER_LANES || !mother.every(validLane)) return null;
  const game = mother.map(lane => lane.map(p => llToXZ(...p, cfg.center)));
  const a = llToXZ(...cfg.bases.SWARM, cfg.center), b = llToXZ(...cfg.bases.STEEL, cfg.center);
  const overlaps = [];
  const cell = overlapCellM(geoLanesFor(cfg.teamSize || 5, mapArg(cfg)), mapArg(cfg)) / MAPGEO.REAL_SCALE;
  if (!withinOccupancyBudget(game, cell)) return null;
  for (let i = 0; i < game.length; i++) for (let j = i + 1; j < game.length; j++) overlaps.push(laneOverlapRatioXZ(game[i], game[j], cell));
  const lengths = game.map(lane => lane.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - lane[i][0], p[1] - lane[i][1]), 0));
  return { game, lengths, distM: Math.hypot(b[0] - a[0], b[1] - a[1]),
    diagM: cfg.sizeM * Math.SQRT2, maxOverlap: Math.max(0, ...overlaps), overlaps,
    balance: lanePathBalanceAudit(game, game.length) };
}

/** One geometry verdict for selection, saved recipes, baking and all room transports. */
export function mapGeometryAudit(cfg, teamSize = cfg?.teamSize || 5) {
  try {
    const metrics = cfg && mapGeometryMetrics(cfg);
    const fail = code => ({ ok: false, code, metrics });
    if (!metrics || !Number.isInteger(teamSize) || teamSize < 1 || teamSize > 5 || !Array.isArray(cfg.lanes)
      || !cfg.lanes.every(validLane)) return fail('shape');
    const arg = mapArg(cfg), story = mapPlan(arg).mode === 'story', L = laneCountFor(teamSize, arg);
    if (cfg.lanes.length !== L || cfg.laneCount !== L) return fail('laneCount');
    if (!Number.isFinite(cfg.sizeM) || Math.abs(cfg.sizeM - sideMFor(geoLanesFor(teamSize, arg), arg)) > .01) return fail('frame');
    const middle = llToXZ((cfg.bases.SWARM[0] + cfg.bases.STEEL[0]) / 2,
      (cfg.bases.SWARM[1] + cfg.bases.STEEL[1]) / 2, cfg.center);
    if (Math.hypot(...middle) > MAP_RULE_LIMITS.ENDPOINT_GAME_M) return fail('frame');
    if (metrics.distM < metrics.diagM * MAPGEO.MIN_DIST_FRAC) return fail('distance');
    const mother = cfg.motherLanes || cfg.lanes;
    if (!story && mother.length !== MOTHER_LANES) return fail('mother');
    const ids = story ? [0] : laneSubsetFor(L);
    if (JSON.stringify(cfg.laneIds) !== JSON.stringify(ids)
      || cfg.lanes.some((lane, i) => JSON.stringify(lane) !== JSON.stringify(mother[ids[i]]))) return fail('mother');
    const near = (p, base) => {
      const a = llToXZ(...p, cfg.center), b = llToXZ(...base, cfg.center);
      return Math.hypot(a[0] - b[0], a[1] - b[1]) <= MAP_RULE_LIMITS.ENDPOINT_GAME_M;
    };
    if (mother.some(lane => !near(lane[0], cfg.bases.SWARM) || !near(lane.at(-1), cfg.bases.STEEL))) return fail('endpoints');
    if (metrics.maxOverlap > MAPGEO.MAX_OVERLAP + 1e-9) return fail('overlap');
    if (metrics.lengths.some(length => length / metrics.distM > MAP_RULE_LIMITS.DETOUR)) return fail('detour');
    if (!metrics.balance.ok) return fail('balance');
    if (metrics.game.some((lane, i) => laneBacktrackFrac(lane) > MAPGEO.MAX_BACKTRACK
      || !laneUTurnAudit(lane).ok || !laneTurnAccumAudit(lane, { side: laneIsSide(i, mother.length) }).ok)) return fail('navigation');
    if (!laneSeparationAudit(metrics.game).ok) return fail('separation');
    if (!towerLayoutAudit(metrics.game, arg).ok) return fail('towers');
    const mix = cfg.venue?.mix;
    if (mix && (!Object.values(mix).every(v => Number.isFinite(v) && v >= 0)
      || (mix.water || 0) + (mix.wet || 0) > MAX_MAP_WATER_WET + 1e-9)) return fail('mix');
    return { ok: true, code: null, metrics };
  } catch { return { ok: false, code: 'shape', metrics: null }; }
}

export function settleMapMetrics(cfg) {
  const metrics = mapGeometryMetrics(cfg);
  if (metrics) for (const key of ['distM', 'diagM', 'maxOverlap', 'overlaps']) cfg[key] = metrics[key];
  return cfg;
}
