// Roadside evidence settles here; coarse RGB cells cannot certify individual poles or narrow medians.
import { roadSignSegments, nearestSignRoad } from './roadSigns.js';
import { normalizeRing, isSimpleRing, pointInProjectedArea } from './osmAreas.js';

const yes = value => /^(yes|1|true)$/.test(value || '');
const keyOf = row => JSON.stringify([row.points || [row.x, row.z], Object.entries(row.tags || {}).sort()]);
const ordered = rows => rows.slice().sort((a, b) => { const x = keyOf(a), y = keyOf(b); return x < y ? -1 : x > y ? 1 : 0; });
const polygonAt = (x, z, dx, dz, hw, hd) => [[-hd, -hw], [hd, -hw], [hd, hw], [-hd, hw]]
  .map(([s, q]) => [x + dx * s + dz * q, z + dz * s - dx * q]);
const contains = (island, x, z) => pointInProjectedArea(x, z, { outer: island.points, holes: [] });

function straightSegments(runs) {
  const result = [];
  for (const run of runs) {
    let current = null;
    for (const seg of roadSignSegments([run])) {
      const dx = (seg.b[0] - seg.a[0]) / seg.len, dz = (seg.b[1] - seg.a[1]) / seg.len;
      if (current && current.dx * dx + current.dz * dz > .9999
        && Math.abs(current.hw - seg.hwA) < .01 && Math.abs(seg.hwA - seg.hwB) < .01) {
        current.b = seg.b; current.len = Math.hypot(seg.b[0] - current.a[0], seg.b[1] - current.a[1]);
      } else {
        current = { ...seg, dx, dz, hw: Math.max(seg.hwA, seg.hwB) }; result.push(current);
      }
    }
  }
  return result;
}

/** pre: projected game coordinates, unamplified evidence cell size in game metres. post: bounded presentation only. */
export function planRoadFurniture({ runs = [], points = [], features = [], junctions = [], heightAt,
  evidenceAt, evidenceCellM = Infinity, free = () => true, drivingSide = 'right' } = {}) {
  const plan = { islands: [], lamps: [], trees: [], signals: [], crossings: [], gaps: [] };
  if (typeof heightAt !== 'function') return plan;
  const sortedRuns = ordered(runs.filter(r => r.kind === 'road'));
  const segments = roadSignSegments(sortedRuns), seen = new Set();
  let kerbPieces = 0;
  const inbound = drivingSide === 'left' ? 1 : -1;
  const safe = (x, z, radius = .3) => [x, z].every(Number.isFinite)
    && Number.isFinite(heightAt(x, z)) && free(x, z, radius);
  const roadAt = (x, z, layer = 0) => nearestSignRoad(segments.filter(s => Number(s.run.tags.layer || 0) === layer), x, z);
  const onRoad = (x, z, radius = .3) => segments.some(seg => {
    const hit = nearestSignRoad([seg], x, z);
    return hit && hit.d < hit.hw + radius;
  });
  const addIsland = (points, source, tags = {}) => {
    if (!segments.length || plan.islands.length >= 120 || !Array.isArray(points)
      || Number(tags.layer || 0) !== 0 || tags.bridge || tags.tunnel) return;
    if (points.length > 256) { plan.gaps.push('island-ring-budget'); return; }
    const ring = normalizeRing(points.map(([x, z]) => ({ lon: x, lat: z })), 1e-7);
    if (!isSimpleRing(ring)) { plan.gaps.push('invalid-island-ring'); return; }
    const poly = ring.map(p => [p.lon, p.lat]), key = JSON.stringify(poly);
    if (seen.has(key)) return;
    const pieces = poly.reduce((n, p, i) => n + Math.ceil(Math.hypot(p[0] - poly[(i + 1) % poly.length][0],
      p[1] - poly[(i + 1) % poly.length][1]) / 2), 0);
    if (kerbPieces + pieces > 8192) { plan.gaps.push('island-kerb-budget'); return; }
    const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
    const samples = [...poly];
    // Whole envelopes reject submerged or steep interiors, not merely their vertices.
    const stepX = Math.min(4, Math.max(...xs) - Math.min(...xs)), stepZ = Math.min(4, Math.max(...zs) - Math.min(...zs));
    if (Math.ceil((Math.max(...xs) - Math.min(...xs)) / stepX)
      * Math.ceil((Math.max(...zs) - Math.min(...zs)) / stepZ) > 16384) return;
    for (let z = Math.min(...zs) + stepZ / 2; z < Math.max(...zs); z += stepZ) {
      for (let x = Math.min(...xs) + stepX / 2; x < Math.max(...xs); x += stepX) {
        if (samples.length >= 4096) { plan.gaps.push('island-envelope-budget'); return; }
        if (pointInProjectedArea(x, z, { outer: poly, holes: [] })) samples.push([x, z]);
      }
    }
    if (!samples.every(([x, z]) => safe(x, z, .2))) { plan.gaps.push('unsafe-island-envelope'); return; }
    if (source === 'osm-pair-rgb' && samples.some(([x, z]) => onRoad(x, z, .1)
      || plan.islands.some(island => contains(island, x, z)))) return;
    const heights = samples.map(([x, z]) => heightAt(x, z));
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
    if (Math.max(...heights) - Math.min(...heights) > Math.max(.6, span * .12)) return;
    const green = ['grass', 'grass_paver'].includes(tags.surface) || tags.landcover === 'grass';
    seen.add(key); kerbPieces += pieces; plan.islands.push({ points: poly, source, green });
  };
  for (const feature of ordered(features)) {
    if (feature.tags?.['area:highway'] !== 'traffic_island') continue;
    const p = feature.points;
    if (!Array.isArray(p) || p.length < 4 || Math.hypot(p[0][0] - p.at(-1)[0], p[0][1] - p.at(-1)[1]) > .01) {
      plan.gaps.push('unclosed-island'); continue;
    }
    addIsland(p, 'osm-outline', feature.tags);
  }
  const candidates = ordered(points.filter(p => [p.x, p.z].every(Number.isFinite)));
  for (const p of candidates) {
    const tags = p.tags || {}, hit = roadAt(p.x, p.z, Number(tags.layer || 0));
    if (!hit || hit.d > hit.hw + 12 || !safe(p.x, p.z)) continue;
    if (tags.highway === 'crossing') {
      const markings = tags['crossing:markings'];
      const marked = !['no', 'unmarked'].includes(tags.crossing) && markings !== 'no';
      const one = hit.seg.run.tags.oneway;
      plan.crossings.push({ x: hit.x, z: hit.z, dx: hit.dx, dz: hit.dz, hw: hit.hw,
        directions: one === '-1' ? [1] : yes(one) ? [-1] : [-1, 1], drivingSide,
        marked, signals: tags.crossing === 'traffic_signals' || yes(tags['crossing:signals']), source: 'osm-node' });
      if ((yes(tags['crossing:island']) || tags.crossing === 'island') && hit.hw >= 3
        && !plan.islands.some(island => contains(island, hit.x, hit.z))) {
        // The refuge has a flush pedestrian gap instead of a kerb across the zebra stripes.
        for (const side of [-1, 1]) addIsland(polygonAt(hit.x + hit.dx * 3.4 * side,
          hit.z + hit.dz * 3.4 * side, hit.dx, hit.dz, .8, 1.5), 'osm-refuge');
      }
    }
    if (tags.highway === 'street_lamp' || tags.natural === 'tree') {
      if (tags.highway === 'street_lamp' && tags.lamp_mount && !['pole', 'freestanding'].includes(tags.lamp_mount)) continue;
      if (onRoad(p.x, p.z) && !plan.islands.some(i => contains(i, p.x, p.z))) continue;
      const rows = tags.natural === 'tree' ? plan.trees : plan.lamps;
      if (rows.length < 380 && !rows.some(r => Math.hypot(r.x - p.x, r.z - p.z) < 1)) rows.push({ x: p.x,
        z: p.z, y: heightAt(p.x, p.z), ry: Math.atan2(-(hit.z - p.z), hit.x - p.x), source: 'osm-node' });
    }
    if (tags.highway !== 'traffic_signals' && !(tags.highway === 'crossing'
      && (tags.crossing === 'traffic_signals' || yes(tags['crossing:signals'])))) continue;
    const junction = junctions.find(j => j.arms >= 3 && Number(j.layer || 0) === Number(tags.layer || 0)
      && Math.hypot(j.x - p.x, j.z - p.z) < 3);
    const arms = junction ? junction.dirs.map((d, i) => ({ dx: d[0], dz: d[1], x: junction.x, z: junction.z,
      hw: junction.armHw[i], reach: (junction.boundary?.reaches[i] ?? junction.hw) + 5,
      incoming: junction.armIncoming?.[i] !== false }))
      : [-1, 1].filter(direction => {
        const one = hit.seg.run.tags.oneway, control = tags['traffic_signals:direction'];
        return (one === '-1' ? direction > 0 : yes(one) ? direction < 0 : true)
          && (control === 'forward' ? direction < 0 : control === 'backward' ? direction > 0 : true);
      }).map(direction => ({ ...hit, dx: hit.dx * direction, dz: hit.dz * direction, reach: 2.5, incoming: true }));
    arms.sort((a, b) => Math.atan2(a.dz, a.dx) - Math.atan2(b.dz, b.dx));
    const major = junction?.dirs.map((d, i) => ({ d, hw: junction.armHw[i] }))
      .sort((a, b) => b.hw - a.hw || Math.abs(b.d[0]) - Math.abs(a.d[0])
        || a.d[0] - b.d[0] || a.d[1] - b.d[1])[0]?.d;
    for (const a of arms) {
      if (!a.incoming) continue;
      for (let retreat = 0; retreat <= 16; retreat += 2) {
        const x = a.x + a.dx * (a.reach + retreat) + a.dz * (a.hw + .9) * inbound;
        const z = a.z + a.dz * (a.reach + retreat) - a.dx * (a.hw + .9) * inbound;
        if (!safe(x, z) || onRoad(x, z, .4)) continue;
        if (plan.signals.length < 120 && !plan.signals.some(r => Math.hypot(r.x - x, r.z - z) < 2)) {
          plan.signals.push({ x, z, y: heightAt(x, z), ry: Math.atan2(a.dx, a.dz), source: 'osm-control',
            aspect: major && Math.abs(a.dx * major[0] + a.dz * major[1]) < .8 ? 'red' : 'green' });
        }
        break;
      }
    }
  }
  for (const feature of ordered(features)) {
    if (feature.tags?.natural !== 'tree_row' || !Array.isArray(feature.points)) continue;
    let distance = 0, next = 0;
    for (let i = 1; i < feature.points.length; i++) {
      const a = feature.points[i - 1], b = feature.points[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!Number.isFinite(length) || length < .01) continue;
      for (; next <= distance + length && plan.trees.length < 460; next += 12) {
        const t = (next - distance) / length, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        if (!safe(x, z, 1.6) || onRoad(x, z, 1.6) || !roadAt(x, z)
          || plan.trees.some(r => Math.hypot(r.x - x, r.z - z) < 6)) continue;
        plan.trees.push({ x, z, y: heightAt(x, z), ry: 0, source: 'osm-tree-row' });
      }
      distance += length;
    }
  }
  // Opposing carriageways must identify the same road; adjacent streets are not medians.
  const straight = straightSegments(sortedRuns).filter(s => /^(yes|1|-1|true)$/.test(s.run.tags.oneway || '')
    && (s.run.tags.name || s.run.tags.ref)).slice(0, 800);
  for (let i = 0; i < straight.length; i++) for (let j = i + 1; j < straight.length; j++) {
    const a = straight[i], b = straight[j], ta = a.run.tags, tb = b.run.tags;
    if (a.run === b.run || ta.highway !== tb.highway || (ta.layer || '0') !== (tb.layer || '0')
      || (ta.ref || ta.name) !== (tb.ref || tb.name)) continue;
    const flow = (ta.oneway === '-1' ? -1 : 1) * (tb.oneway === '-1' ? -1 : 1);
    if ((a.dx * b.dx + a.dz * b.dz) * flow > -.9999) continue;
    const along = p => (p[0] - a.a[0]) * a.dx + (p[1] - a.a[1]) * a.dz;
    const s0 = Math.max(0, Math.min(along(b.a), along(b.b))) + 3;
    const s1 = Math.min(a.len, Math.max(along(b.a), along(b.b))) - 3;
    const across = (b.a[0] - a.a[0]) * a.dz - (b.a[1] - a.a[1]) * a.dx;
    const gap = Math.abs(across) - a.hw - b.hw - .6;
    if (!(evidenceCellM > 0) || !Number.isFinite(evidenceCellM) || gap < evidenceCellM + 2
      || gap > 96 || s1 - s0 < evidenceCellM + 2 || typeof evidenceAt !== 'function') continue;
    const side = Math.sign(across), q = side * (a.hw + .3 + gap / 2), probes = [];
    for (const t of [.2, .5, .8]) {
      const s = s0 + (s1 - s0) * t, x = a.a[0] + a.dx * s + a.dz * q, z = a.a[1] + a.dz * s - a.dx * q;
      probes.push(evidenceAt(x, z));
    }
    if (!probes.every(p => p && (p.sources & 2) && p.confidence >= 2 && p.greenFraction >= .55)) continue;
    const s = (s0 + s1) / 2, x = a.a[0] + a.dx * s + a.dz * q, z = a.a[1] + a.dz * s - a.dx * q;
    const poly = polygonAt(x, z, a.dx, a.dz, gap / 2, (s1 - s0) / 2);
    if (plan.islands.some(island => contains(island, x, z))
      || poly.some(p => onRoad(...p, .1)) || onRoad(x, z, .1)) continue;
    addIsland(poly, 'osm-pair-rgb', { surface: 'grass' });
  }
  return plan;
}
