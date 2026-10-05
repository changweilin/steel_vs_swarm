// Pure road engineering seam. Rendering and offline traversal consume the same profiles.
const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

export function structureLayer(tags = {}) {
  const value = Number(tags.layer);
  if (tags.layer != null && Number.isFinite(value)) return Math.max(-5, Math.min(5, value));
  return tags.tunnel ? -1 : tags.bridge || tags.railway === 'monorail' ? 1 : 0;
}

export function bridgeConnections(ways) {
  const nodes = new Map();
  const key = (p, tags) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}|${structureLayer(tags)}`;
  for (const w of ways) {
    if (!w.tags?.bridge || w.tags.tunnel || !(w.geometry?.length >= 2)) continue;
    for (const k of new Set(w.geometry.map(p => key(p, w.tags)))) {
      nodes.set(k, (nodes.get(k) || 0) + 1);
    }
  }
  return (w, p) => (nodes.get(key(p, w.tags)) || 0) > 1;
}

export const waysShareNode = (a, b) => a.geometry.some(p => b.geometry.some(q =>
  Math.abs(p.lat - q.lat) < 1e-6 && Math.abs(p.lon - q.lon) < 1e-6));

/** Grade-limited upper envelope: terrain can raise neighbours, never pierce a deck. */
export function planBridgeDeck(points, heightAt, {
  rise, grade, lift, waterFloor = -Infinity, startJoined = false, endJoined = false, joins = [],
} = {}) {
  if (!Array.isArray(points) || points.length < 2 || typeof heightAt !== 'function'
    || !points.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    || ![rise, grade, lift].every(Number.isFinite) || rise < 0 || grade <= 0 || lift < 0
    || !(waterFloor === -Infinity || Number.isFinite(waterFloor))) return null;
  const cum = [0];
  const ground = points.map(p => heightAt(p[0], p[1]));
  if (!ground.every(Number.isFinite)) return null;
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1]
    + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const total = cum.at(-1);
  if (!(total > 0)) return null;
  const a = Math.max(waterFloor, ground[0] + lift + (startJoined ? rise : 0));
  const b = Math.max(waterFloor, ground.at(-1) + lift + (endJoined ? rise : 0));
  const baseGrade = Math.abs(b - a) / total;
  if (baseGrade > grade + 1e-8 || a < waterFloor || b < waterFloor) return null;
  // Smoothstep's peak derivative is 1.5. Short spans reduce the rise, not the grade budget.
  const available = grade - baseGrade;
  const ramps = Number(!startJoined) + Number(!endJoined);
  const span = ramps ? total / ramps : total;
  const amplitude = ramps === 2 ? Math.min(rise, available * span / 1.5) : 0;
  const ramp = amplitude > 0 ? 1.5 * amplitude / available : 1;
  const floors = cum.map((s, i) => {
    const t = Math.min(startJoined ? 1 : s / ramp, endJoined ? 1 : (total - s) / ramp);
    return Math.max(a + (b - a) * s / total + amplitude * smooth(t), ground[i] + lift, waterFloor);
  });
  const fixed = new Map();
  for (let i = 0; i < points.length; i++) {
    if (!joins.some(p => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]) < .01)) continue;
    const y = ground[i] + lift + rise;
    fixed.set(i, y); floors[i] = y;
  }
  floors[0] = a; floors[floors.length - 1] = b;
  // The minimal Lipschitz majorant retains endpoint datums if the span is feasible.
  for (let i = 1; i < floors.length; i++) floors[i] = Math.max(floors[i], floors[i - 1] - grade * (cum[i] - cum[i - 1]));
  for (let i = floors.length - 2; i >= 0; i--) floors[i] = Math.max(floors[i], floors[i + 1] - grade * (cum[i + 1] - cum[i]));
  if (floors[0] > a + 1e-7 || floors.at(-1) > b + 1e-7) return null;
  for (const [i, y] of fixed) if (Math.abs(floors[i] - y) > 1e-7) return null;
  const at = s => {
    s = Math.max(0, Math.min(total, s));
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
    const t = (s - cum[lo]) / (cum[hi] - cum[lo] || 1);
    return floors[lo] + (floors[hi] - floors[lo]) * t;
  };
  return { points, cum, floors, total, at };
}

/** An elevated branch opens the parapet only where its connected road meets this deck. */
export function bridgeOpenings(ways, host, project) {
  const points = [];
  for (const w of ways) {
    if (w === host || !w.tags?.bridge || structureLayer(w.tags) !== structureLayer(host.tags)) continue;
    for (const p of [w.geometry[0], w.geometry.at(-1)]) {
      if (!host.geometry.some(q => Math.abs(p.lat - q.lat) < 1e-6 && Math.abs(p.lon - q.lon) < 1e-6)) continue;
      points.push(project(p));
    }
  }
  return points;
}

export const bridgeOpeningAt = (points, x, z, radius) => points.some(p => Math.hypot(x - p[0], z - p[1]) < radius);

/** Keep bridge supports out of other carriageways, including the lower deck of an interchange. */
export function bridgeSupportClearance(ways, project, widthOf) {
  const segments = [];
  for (const way of ways) {
    if (way.tags?.tunnel || !(way.geometry?.length >= 2)) continue;
    const pts = way.geometry.map(project), hw = widthOf(way.tags) / 2;
    for (let i = 1; i < pts.length; i++) {
      const [x1, z1] = pts[i - 1], [x2, z2] = pts[i];
      segments.push({ way, layer: structureLayer(way.tags), x1, z1, x2, z2, hw });
    }
  }
  return (host, x, z, radius) => {
    const layer = structureLayer(host.tags);
    for (const s of segments) {
      if (s.way === host || s.layer > layer) continue;
      const r = s.hw + radius + 1;
      if (x < Math.min(s.x1, s.x2) - r || x > Math.max(s.x1, s.x2) + r
        || z < Math.min(s.z1, s.z2) - r || z > Math.max(s.z1, s.z2) + r) continue;
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
      const t = Math.max(0, Math.min(1, ((x - s.x1) * dx + (z - s.z1) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(x - s.x1 - t * dx, z - s.z1 - t * dz) < r) return false;
    }
    return true;
  };
}

/** A level military slab needs road approaches on both the cut and fill sides. */
export function platformApproaches(pad, lanes, heightAt, { grade, lift, hw = 8, maxLength = 180, overlap = 12, dryAt = () => true }) {
  if (![pad?.cx, pad?.cz, pad?.hw, pad?.hd, pad?.y, grade, lift, hw, maxLength, overlap].every(Number.isFinite)
    || !Array.isArray(lanes) || pad.hw <= 0 || pad.hd <= 0 || hw <= 0 || grade <= 0 || maxLength <= 0 || overlap < 0) return [];
  const ca = Math.cos(pad.ry || 0), sa = Math.sin(pad.ry || 0);
  const local = p => [(p[0] - pad.cx) * ca - (p[1] - pad.cz) * sa,
    (p[0] - pad.cx) * sa + (p[1] - pad.cz) * ca];
  const inside = p => { const q = local(p); return Math.abs(q[0]) <= pad.hw && Math.abs(q[1]) <= pad.hd; };
  const approaches = [], datum = pad.y - lift;
  for (const points of lanes) for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], inA = inside(a), inB = inside(b);
    if (inA === inB) continue;
    const inner = inA ? a : b, outer = inA ? b : a, q = local(inner), r = local(outer);
    let t = 1;
    for (const [axis, limit] of [[0, pad.hw], [1, pad.hd]]) {
      const delta = r[axis] - q[axis];
      if (delta > 0) t = Math.min(t, (limit - q[axis]) / delta);
      else if (delta < 0) t = Math.min(t, (-limit - q[axis]) / delta);
    }
    const edge = [inner[0] + (outer[0] - inner[0]) * t, inner[1] + (outer[1] - inner[1]) * t];
    const pts = [edge], cum = [0], direction = inA ? 1 : -1;
    let anchor = null;
    for (let j = inA ? i : i - 1; j >= 0 && j < points.length; j += direction) {
      const point = points[j], last = pts.at(-1), step = Math.hypot(point[0] - last[0], point[1] - last[1]);
      if (step < 1e-6) continue;
      const distance = cum.at(-1) + step;
      if (distance > maxLength || !dryAt(...point) || inside(point)) break;
      const ground = heightAt(...point);
      if (!Number.isFinite(ground)) break;
      pts.push(point); cum.push(distance);
      // Smoothstep has zero slope at the slab and a peak derivative of 1.5.
      if (distance >= 12 && Math.abs(ground - datum) * 1.5 / distance <= grade) { anchor = ground; break; }
    }
    if (anchor == null) continue;
    const length = cum.at(-1), floors = cum.map(s => datum + (anchor - datum) * smooth(s / length));
    // A height-grid triangle straddles the edge. Fill beneath the slab too, so interpolation cannot reopen a gap.
    const dx = pts[1][0] - edge[0], dz = pts[1][1] - edge[1], d = Math.hypot(dx, dz);
    pts.unshift([edge[0] - dx / d * overlap, edge[1] - dz / d * overlap]); floors.unshift(datum);
    approaches.push({ pts, floors, hw });
  }
  return approaches;
}

/** Exact road loop ownership keeps islands outside pavement and external approach arms. */
export function roundaboutIsland(points, roadHw) {
  if (!(points?.length >= 4) || !Number.isFinite(roadHw) || roadHw <= 0) return null;
  if (Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) > .5) return null;
  const ring = points.slice(0, -1);
  const center = [0, 0];
  for (const p of ring) { center[0] += p[0] / ring.length; center[1] += p[1] / ring.length; }
  let r = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], len2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((center[0] - a[0]) * dx + (center[1] - a[1]) * dz) / (len2 || 1)));
    r = Math.min(r, Math.hypot(center[0] - a[0] - dx * t, center[1] - a[1] - dz * t));
  }
  // Reject a concave or offset loop whose mean falls outside it.
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > center[1]) !== (b[1] > center[1])
      && center[0] < (b[0] - a[0]) * (center[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  r -= roadHw + .8;
  return inside && r > 1 ? { x: center[0], z: center[1], r } : null;
}
