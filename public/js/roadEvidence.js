import { MAPGEO, llToXZ, laneStructEntryAudit, slopeMoveF, UNITS } from './data.js';
import { MAP_ROAD_PROFILE, MAP_RULE_LIMITS } from './mapRules.js';
import { distanceToSegment } from './architectureStyles.js';
import { evidenceChecksum } from './mapEvidence.js';
import { structuralTunnel } from './roadSemantics.js';

export const ROAD_EVIDENCE_VERSION = 1;
export const ROAD_EVIDENCE_LIMITS = Object.freeze({ SIMPLIFY_REAL_M: 3, ROUND_REAL_M: .2, MAX_POINTS: 12000 });
export const roadFingerprint = value => evidenceChecksum(new TextEncoder().encode(JSON.stringify(value)));
const pointKey = p => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
const validPoint = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)
  && Math.abs(p[0]) < 85 && Math.abs(p[1]) <= 180;
const canonical = lane => JSON.stringify(lane[0]) < JSON.stringify(lane.at(-1)) ? lane : [...lane].reverse();
export const laneFingerprint = lane => roadFingerprint(canonical(lane));

/** Trace the entire lane through connected source edges, including bridge/tunnel portals. */
export function traceRoadEvidence(lane, ways, { kind = 'osm-baked', source, center } = {}) {
  if (!Array.isArray(lane) || lane.length < 2 || !lane.every(validPoint) || !Array.isArray(ways)
    || !source?.provider || !source?.version || !source?.fingerprint) return null;
  center ||= { lat: lane[0][0], lng: lane[0][1], rot: 0 };
  const nodes = new Map(), edges = [], portals = new Set();
  const node = p => {
    const key = pointKey(p);
    if (!nodes.has(key)) nodes.set(key, { key, p, xy: llToXZ(...p, center), links: [] });
    return nodes.get(key);
  };
  for (const way of ways) {
    if (!Number.isSafeInteger(way?.id) || way.id <= 0 || !MAP_ROAD_PROFILE.test(way.tags?.highway || '')
      || !Array.isArray(way.geometry) || way.geometry.length < 2) continue;
    const pts = way.geometry.map(p => [p.lat, p.lon ?? p.lng]);
    if (!pts.every(validPoint)) continue;
    const structural = structuralTunnel(way.tags) || (!!way.tags.bridge && way.tags.bridge !== 'no');
    if (structural) { portals.add(pointKey(pts[0])); portals.add(pointKey(pts.at(-1))); }
    for (let i = 1; i < pts.length; i++) {
      const a = node(pts[i - 1]), b = node(pts[i]);
      if (a.key === b.key) continue;
      const edge = { a, b, id: way.id, structural, len: Math.hypot(b.xy[0] - a.xy[0], b.xy[1] - a.xy[1]) };
      a.links.push({ to: b, edge }); b.links.push({ to: a, edge }); edges.push(edge);
    }
  }
  if (!edges.length) return null;
  const pins = lane.map((p, i) => {
    const exact = nodes.get(pointKey(p));
    if (exact) return exact;
    if (i !== 0 && i !== lane.length - 1) return null;
    const xy = llToXZ(...p, center);
    let nearest = null, distance = ROAD_EVIDENCE_LIMITS.ROUND_REAL_M / MAPGEO.REAL_SCALE;
    for (const edge of edges) {
      const d = distanceToSegment(...xy, ...edge.a.xy, ...edge.b.xy);
      if (d <= distance) { nearest = edge; distance = d; }
    }
    if (!nearest) return null;
    const pinned = { key: `pin:${i}`, p, xy, links: [] };
    for (const n of [nearest.a, nearest.b]) {
      const edge = { ...nearest, a: pinned, b: n, len: Math.hypot(xy[0] - n.xy[0], xy[1] - n.xy[1]) };
      pinned.links.push({ to: n, edge }); n.links.push({ to: pinned, edge });
    }
    return pinned;
  });
  if (pins.some(p => !p)) return null;
  const path = [], edgeIds = [], structure = [false], portal = [];
  const tolerance = (ROAD_EVIDENCE_LIMITS.SIMPLIFY_REAL_M + ROAD_EVIDENCE_LIMITS.ROUND_REAL_M) / MAPGEO.REAL_SCALE;
  for (let i = 1; i < pins.length; i++) {
    const start = pins[i - 1], end = pins[i];
    const chord = Math.hypot(end.xy[0] - start.xy[0], end.xy[1] - start.xy[1]);
    const queue = new Set([start]), cost = new Map([[start, 0]]), previous = new Map();
    while (queue.size) {
      let current = null;
      for (const item of queue) if (!current || cost.get(item) < cost.get(current)) current = item;
      queue.delete(current);
      if (current === end) break;
      for (const { to, edge } of current.links) {
        if (distanceToSegment(...to.xy, ...start.xy, ...end.xy) > tolerance) continue;
        const next = cost.get(current) + edge.len;
        if (next > chord * MAP_RULE_LIMITS.DETOUR + tolerance || next >= (cost.get(to) ?? Infinity)) continue;
        cost.set(to, next); previous.set(to, { current, edge }); queue.add(to);
      }
    }
    if (!cost.has(end)) return null;
    const leg = [], steps = [];
    for (let n = end; n !== start;) {
      const prev = previous.get(n);
      if (!prev) return null;
      leg.push(n); steps.push(prev.edge); n = prev.current;
    }
    leg.push(start); leg.reverse(); steps.reverse();
    if (!path.length) { path.push(start.p); portal.push(portals.has(start.key)); }
    for (let k = 1; k < leg.length; k++) {
      path.push(leg[k].p); portal.push(portals.has(leg[k].key));
      edgeIds.push(steps[k - 1].id); structure.push(steps[k - 1].structural);
    }
    if (path.length > ROAD_EVIDENCE_LIMITS.MAX_POINTS) return null;
  }
  if (!laneStructEntryAudit(structure, portal).ok) return null;
  const proof = { version: ROAD_EVIDENCE_VERSION, kind, laneHash: laneFingerprint(lane),
    source: { ...source }, path, edgeIds, structure, portal };
  proof.fingerprint = roadFingerprint(proof);
  return proof;
}

export function validRoadEvidence(proof, lane) {
  try {
    if (!proof || proof.version !== ROAD_EVIDENCE_VERSION || proof.laneHash !== laneFingerprint(lane)) return false;
    if (proof.kind === 'synthetic') return true;
    const { fingerprint, ...body } = proof;
    if (!['osm-baked', 'osrm'].includes(proof.kind) || fingerprint !== roadFingerprint(body)
      || !proof.source?.provider || !proof.source?.version || !/^[a-f0-9]{8}$/.test(proof.source.fingerprint)
      || !Array.isArray(proof.path) || proof.path.length < 2 || proof.path.length > ROAD_EVIDENCE_LIMITS.MAX_POINTS
      || !proof.path.every(validPoint) || proof.edgeIds?.length !== proof.path.length - 1
      || !proof.edgeIds.every(id => Number.isSafeInteger(id) && id > 0)
      || proof.structure?.length !== proof.path.length || proof.portal?.length !== proof.path.length
      || !proof.structure.every(v => typeof v === 'boolean') || !proof.portal.every(v => typeof v === 'boolean')
      || !laneStructEntryAudit(proof.structure, proof.portal).ok) return false;
    const center = { lat: lane[0][0], lng: lane[0][1], rot: 0 };
    const first = llToXZ(...lane[0], center);
    const head = llToXZ(...proof.path[0], center), tail = llToXZ(...proof.path.at(-1), center);
    const points = (Math.hypot(first[0] - head[0], first[1] - head[1]) <= Math.hypot(first[0] - tail[0], first[1] - tail[1])
      ? proof.path : [...proof.path].reverse()).map(p => llToXZ(...p, center));
    const cum = [0];
    for (let i = 1; i < points.length; i++) cum.push(cum.at(-1) + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    const tolerance = (ROAD_EVIDENCE_LIMITS.SIMPLIFY_REAL_M + ROAD_EVIDENCE_LIMITS.ROUND_REAL_M) / MAPGEO.REAL_SCALE;
    let progress = 0;
    for (let i = 1; i < lane.length; i++) {
      const a = llToXZ(...lane[i - 1], center), b = llToXZ(...lane[i], center);
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / tolerance));
      for (let k = 0; k <= n; k++) {
        const x = a[0] + (b[0] - a[0]) * k / n, z = a[1] + (b[1] - a[1]) * k / n;
        let nearest = Infinity, next = progress;
        for (let j = 1; j < points.length; j++) {
          const [ax, az] = points[j - 1], [bx, bz] = points[j], dx = bx - ax, dz = bz - az;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
          const arc = cum[j - 1] + (cum[j] - cum[j - 1]) * t;
          if (arc < progress - ROAD_EVIDENCE_LIMITS.ROUND_REAL_M / MAPGEO.REAL_SCALE) continue;
          const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
          if (d < nearest) { nearest = d; next = arc; }
        }
        if (nearest > tolerance) return false;
        progress = Math.max(progress, next);
      }
    }
    if (cum.at(-1) - progress > tolerance) return false;
    return true;
  } catch { return false; }
}

export function syntheticLaneEvidence(lane) {
  return { version: ROAD_EVIDENCE_VERSION, kind: 'synthetic', laneHash: laneFingerprint(lane) };
}

export function roadSourceSummary(cfg) {
  const mother = cfg?.motherLanes || cfg?.lanes || [];
  const proofs = cfg?.roadSources || [];
  const verified = mother.map((lane, i) => proofs[i]?.kind !== 'synthetic' && validRoadEvidence(proofs[i], lane));
  return { real: verified.filter(Boolean).length, total: mother.length,
    active: (cfg?.laneIds || []).filter(i => verified[i]).length, count: cfg?.lanes?.length || 0 };
}

/** Source relief is sampled in game coordinates; travel time uses the existing creep movement rules. */
export function assessLaneTerrain(lanes, center, elevationAt) {
  if (typeof elevationAt !== 'function') return { verified: false, maxGrade: null, times: [] };
  let maxGrade = 0, complete = true;
  const times = lanes.map(original => {
    const lane = canonical(original);
    let time = 0;
    for (let i = 1; i < lane.length; i++) {
      const a = llToXZ(...lane[i - 1], center), b = llToXZ(...lane[i], center);
      const distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(distance / MAPGEO.TACTICS.SEG_M));
      let previous = elevationAt(...a);
      for (let k = 1; k <= n; k++) {
        const h = elevationAt(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n);
        if (!Number.isFinite(h) || !Number.isFinite(previous)) { complete = false; previous = h; continue; }
        const run = distance / n;
        if (run > 0) {
          const grade = (h - previous) / (run * MAPGEO.REAL_SCALE);
          maxGrade = Math.max(maxGrade, Math.abs(grade));
          const angle = Math.atan((h - previous) / run) * 180 / Math.PI;
          time += run / (UNITS.soldier.speed * slopeMoveF(angle));
        }
        previous = h;
      }
    }
    return time;
  });
  const quantize = value => Math.round(value * 1e6) / 1e6;
  return { verified: complete, maxGrade: complete ? quantize(maxGrade) : null, times: complete ? times.map(quantize) : [] };
}

const terrainKey = cfg => roadFingerprint([(cfg.motherLanes || cfg.lanes).map(laneFingerprint),
  cfg.gen?.layers?.elevation || null]);

export function makeTerrainAssessment(cfg, elevationAt) {
  const samples = [];
  const result = assessLaneTerrain(cfg.motherLanes || cfg.lanes, cfg.center, (x, z) => {
    const h = elevationAt(x, z); samples.push(h); return h;
  });
  const packet = { version: ROAD_EVIDENCE_VERSION, key: terrainKey(cfg), samples, ...result };
  packet.fingerprint = roadFingerprint(packet);
  return packet;
}

export function validTerrainAssessment(cfg) {
  try {
    const p = cfg.roadTerrain;
    if (p?.version !== ROAD_EVIDENCE_VERSION || p.key !== terrainKey(cfg) || !Array.isArray(p.samples)
      || p.samples.length > 48000 || !p.samples.every(Number.isFinite)) return false;
    let index = 0;
    const checked = makeTerrainAssessment(cfg, () => p.samples[index++]);
    return index === p.samples.length && checked.verified
      && checked.maxGrade <= Math.tan(MAPGEO.MAX_ROAD_GRADE_DEG * Math.PI / 180)
      && JSON.stringify(p) === JSON.stringify(checked);
  } catch { return false; }
}
