import { ROAD_JUNCTION_PROFILE as PROFILE } from './roadStructureMeshData.js';

const cross = (a, b) => a[0] * b[1] - a[1] * b[0];

const pointKey = (x, z) => `${x.toFixed(4)},${z.toFixed(4)}`;

/** Presentation-only fillets share their midpoint even when OSM splits a bend into two ways. */
export function roadCurveIndex(records) {
  const curves = new Map(), reaches = new Map();
  for (const rec of records) {
    if (rec?.arms !== 2 || rec.dirs?.length !== 2 || rec.armHw?.length !== 2 || rec.armLength?.length !== 2
      || ![rec.x, rec.z, ...rec.armLength, ...rec.armHw, ...rec.dirs.flat()].every(Number.isFinite)
      || [...rec.armLength, ...rec.armHw].some(v => v <= 0)) continue;
    const [a, b] = rec.dirs, dot = a[0] * b[0] + a[1] * b[1];
    if (dot < -.9999 || dot > .9999) continue;
    const hw = Math.min(...rec.armHw);
    const changingWidth = Math.abs(rec.armHw[0] - rec.armHw[1]) > .01;
    const cut = Math.min(hw * 2, ...rec.armLength.map(length => length * (changingWidth ? .2 : .45)));
    if (!(cut > .01)) continue;
    const count = Math.max(8, Math.ceil(Math.acos(-dot) / (Math.PI / 36)), Math.ceil(cut * 2));
    const n = count + count % 2, points = [], samples = [0];
    const tangent = t => {
      const dx = -(1 - t) * a[0] + t * b[0], dz = -(1 - t) * a[1] + t * b[1], length = Math.hypot(dx, dz);
      return [dx / length, dz / length];
    };
    const subdivide = (start, end, depth = 0) => {
      const u = tangent(start), v = tangent(end);
      if (depth < 12 && u[0] * v[0] + u[1] * v[1] < Math.cos(Math.PI / 60)) {
        const mid = (start + end) / 2;
        subdivide(start, mid, depth + 1); subdivide(mid, end, depth + 1);
      } else samples.push(end);
    };
    for (let i = 0; i < n; i++) subdivide(i / n, (i + 1) / n);
    for (const t of samples) {
      const u = 1 - t;
      const p = [rec.x + cut * (u * u * a[0] + t * t * b[0]),
        rec.z + cut * (u * u * a[1] + t * t * b[1])];
      let dx = -u * a[0] + t * b[0], dz = -u * a[1] + t * b[1];
      const length = Math.hypot(dx, dz);
      p.normal = [dz / length, -dx / length];
      p.hw = (rec.armHw[0] + rec.armHw[1]) / 2;
      // An inner offset beyond the curve radius folds backwards and exposes backface holes.
      const radius = 2 * cut * length ** 3 / Math.abs(cross(a, b));
      p.innerSide = cross(a, b) > 0 ? 1 : -1;
      p.innerScale = Math.min(1, radius * .9 / p.hw);
      points.push(p);
    }
    curves.set(`${rec.layer || 0}:${pointKey(rec.x, rec.z)}`, { rec, points, middle: samples.indexOf(.5) });
    reaches.set(rec, cut);
  }
  const pathOf = (points, layer = 0) => {
    const out = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i], curve = curves.get(`${layer}:${pointKey(...p)}`);
      if (!curve) { out.push(p); continue; }
      const { rec, points: path, middle } = curve;
      const neighbor = points[i ? i - 1 : 1];
      const dx = neighbor[0] - p[0], dz = neighbor[1] - p[1];
      const fromA = dx * rec.dirs[0][0] + dz * rec.dirs[0][1]
        > dx * rec.dirs[1][0] + dz * rec.dirs[1][1];
      const forward = fromA === (i > 0);
      const oriented = forward ? path : path.slice().reverse().map(q => {
        const r = [...q]; r.hw = q.hw; r.normal = q.normal.map(v => -v);
        r.innerSide = -q.innerSide; r.innerScale = q.innerScale; return r;
      });
      const half = forward ? middle : path.length - 1 - middle;
      out.push(...(i === 0 ? oriented.slice(half) : i === points.length - 1 ? oriented.slice(0, half + 1) : oriented));
    }
    return out;
  };
  pathOf.reachOf = rec => reaches.get(rec) || 0;
  return pathOf;
}

export function roadOffsetPoint(point, px, pz, offset) {
  const off = offset * (Math.sign(offset) === point.innerSide ? point.innerScale : 1);
  return [point[0] + px * off, point[1] + pz * off];
}

/** Tight inner offsets can make a concave quad; its diagonal must stay inside the pavement. */
export function roadQuadIndices(positions, a, b, c, d) {
  const area = (i, j, k) => (positions[j * 3] - positions[i * 3]) * (positions[k * 3 + 2] - positions[i * 3 + 2])
    - (positions[j * 3 + 2] - positions[i * 3 + 2]) * (positions[k * 3] - positions[i * 3]);
  return area(a, b, c) <= 1e-8 && area(b, d, c) <= 1e-8 ? [a, b, c, b, d, c] : [a, b, d, a, d, c];
}

export function roadPathWidthAt(run, fallback) {
  const segments = [];
  for (let i = 1; i < run.length; i++) {
    if (run[i - 1].hw != null && run[i].hw != null) segments.push([run[i - 1], run[i]]);
  }
  return (x, z, hw) => {
    let best = .01, width = fallback(x, z, hw);
    for (const [a, b] of segments) {
      const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
      if (l2 < 1e-12) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
      const distance = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
      if (distance >= best) continue;
      best = distance; width = a.hw + (b.hw - a.hw) * t;
    }
    return width;
  };
}

/** A boundary fitted to each arm, including bends and roundabout mouths. No collision data. */
export function junctionBoundary(rec) {
  if (!Array.isArray(rec?.dirs) || !Array.isArray(rec.armHw) || rec.dirs.length < 2
    || rec.dirs.length !== rec.armHw.length || ![rec.x, rec.z, rec.hw].every(Number.isFinite)) return null;
  const arms = rec.dirs.map((d, i) => ({ d, hw: rec.armHw[i], length: rec.armLength?.[i] ?? Infinity }))
    .filter(a => a.d.every(Number.isFinite) && Number.isFinite(a.hw) && a.hw > 0)
    .sort((a, b) => Math.atan2(a.d[1], a.d[0]) - Math.atan2(b.d[1], b.d[0]));
  if (arms.length !== rec.dirs.length) return null;
  if (arms.length === 2) return null;
  const reaches = arms.map(a => Math.min(a.hw + PROFILE.cornerRadius, a.length * .45));
  const corners = [];
  for (let i = 0; i < arms.length; i++) {
    const a = arms[i], b = arms[(i + 1) % arms.length];
    const p = [-a.d[1] * a.hw, a.d[0] * a.hw];
    const q = [b.d[1] * b.hw, -b.d[0] * b.hw];
    const det = cross(a.d, b.d), delta = [q[0] - p[0], q[1] - p[1]];
    const ta = det > .04 ? cross(delta, b.d) / det : -1;
    const tb = det > .04 ? cross(delta, a.d) / det : -1;
    const capA = Math.min(rec.hw * 4, a.length * .45), capB = Math.min(rec.hw * 4, b.length * .45);
    if (ta < 0 || tb < 0 || ta > capA || tb > capB) { corners.push([p, q]); continue; }
    const radius = Math.max(0, Math.min(PROFILE.cornerRadius, capA - ta, capB - tb));
    const hit = [p[0] + a.d[0] * ta, p[1] + a.d[1] * ta];
    corners.push(PROFILE.corner.map(([u, v]) => [hit[0] + radius * (a.d[0] * u + b.d[0] * v),
      hit[1] + radius * (a.d[1] * u + b.d[1] * v)]));
    reaches[i] = Math.max(reaches[i], ta + radius);
    reaches[(i + 1) % arms.length] = Math.max(reaches[(i + 1) % arms.length], tb + radius);
  }
  const local = [];
  arms.forEach((a, i) => {
    const [dx, dz] = a.d, t = reaches[i];
    local.push([dx * t + dz * a.hw, dz * t - dx * a.hw],
      [dx * t - dz * a.hw, dz * t + dx * a.hw], ...corners[i]);
  });
  const points = local.filter((p, i) => Math.hypot(p[0] - local[(i + local.length - 1) % local.length][0],
    p[1] - local[(i + local.length - 1) % local.length][1]) > 1e-5);
  return { points: points.map(([x, z]) => [rec.x + x, rec.z + z]),
    reaches: rec.dirs.map(d => reaches[arms.findIndex(a => a.d === d)]),
    radius: Math.max(...points.map(p => Math.hypot(...p))) };
}

/** Width transitions change the existing ribbon itself; an overlay cannot remove a wide-road lip. */
export function roadTransitionIndex(records, interpolate, bendReach = () => 0) {
  const cells = new Map(), cell = 48;
  for (const rec of records) {
    if (rec.roundabout || rec.arms !== 2 || Math.abs(rec.armHw[0] - rec.armHw[1]) < .01) continue;
    const [a, b] = rec.dirs;
    const hold = bendReach(rec);
    if (!hold && a[0] * b[0] + a[1] * b[1] > -.85) continue;
    const reach = Math.min(PROFILE.taperMax, Math.max(PROFILE.taperMin,
      Math.abs(rec.armHw[0] - rec.armHw[1]) / PROFILE.taperSlope));
    const lengths = rec.armHw.map((_, i) => Math.min(reach + hold, (rec.armLength?.[i] ?? Infinity) * .45));
    const radius = Math.max(...lengths) + rec.hw;
    for (let z = Math.floor((rec.z - radius) / cell); z <= Math.floor((rec.z + radius) / cell); z++) {
      for (let x = Math.floor((rec.x - radius) / cell); x <= Math.floor((rec.x + radius) / cell); x++) {
        const key = `${x},${z}`, rows = cells.get(key) || [];
        rows.push({ rec, lengths, hold }); cells.set(key, rows);
      }
    }
  }
  return (x, z, hw, layer = 0) => {
    let best = Infinity, width = hw;
    for (const { rec, lengths, hold } of cells.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) || []) {
      if ((rec.layer || 0) !== layer) continue;
      const rx = x - rec.x, rz = z - rec.z;
      for (let i = 0; i < 2; i++) {
        if (Math.abs(hw - rec.armHw[i]) > .01 || lengths[i] < .1) continue;
        const [dx, dz] = rec.dirs[i], along = rx * dx + rz * dz, across = Math.abs(rx * dz - rz * dx);
        if (along < -.01 || along > lengths[i] || across > rec.hw + .1) continue;
        const distance = Math.hypot(rx, rz);
        if (distance >= best) continue;
        best = distance;
        width = interpolate((rec.armHw[0] + rec.armHw[1]) / 2, hw, Math.max(0, along - hold) / (lengths[i] - hold));
      }
    }
    return width;
  };
}
