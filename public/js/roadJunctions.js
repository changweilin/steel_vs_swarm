import { ROAD_JUNCTION_PROFILE as PROFILE } from './roadStructureMeshData.js';
import { pointInProjectedArea } from './osmAreas.js';

export const JUNCTION_PAINT_REACH = 6.3;

const cross = (a, b) => a[0] * b[1] - a[1] * b[0];

const paintQuad = (x, z, dx, dz, s0, s1, q0, q1) => [[s0, q1], [s0, q0], [s1, q1], [s1, q0]]
  .map(([s, q]) => [x + dx * s + dz * q, z + dz * s - dx * q]);

/** pre: mapped crossing on a settled surface run. post: balanced stripes stay inside its own carriageway. */
export function crossingMarkings(c) {
  if (!c || ![c.x, c.z, c.dx, c.dz, c.hw].every(Number.isFinite) || c.hw < 1) return [];
  const zw = c.hw * .82, count = Math.floor(zw * 2), start = -(count - 1) / 2 - .25;
  const marks = c.marked ? Array.from({ length: count }, (_, i) => ({ role: 'zebra',
    points: paintQuad(c.x, c.z, c.dx, c.dz, -1.6, 1.6, start + i, start + i + .5) })) : [];
  if (c.signals) for (const direction of c.directions || [-1, 1]) {
    const inbound = c.drivingSide === 'left' ? 1 : -1;
    marks.push({ role: 'stop', points: paintQuad(c.x, c.z, c.dx * direction, c.dz * direction,
      2.6, 2.95, inbound < 0 ? -zw : .25, inbound < 0 ? -.25 : zw) });
  }
  return marks;
}

/** post: channelization retreats from the physical island; no painted polygon becomes collision. */
export function islandNoseMarkings(island) {
  const p = island?.points;
  if (!Array.isArray(p) || p.length !== 4) return [];
  let longest = 0, axis = null;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > longest) { longest = len; axis = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]; }
  }
  if (longest < 6) return [];
  const [dx, dz] = axis, s = p.map(([x, z]) => x * dx + z * dz), q = p.map(([x, z]) => x * dz - z * dx);
  const hw = (Math.max(...q) - Math.min(...q)) / 2, mid = (Math.max(...q) + Math.min(...q)) / 2;
  if (hw < .5 || hw > 6 || longest < hw * 3) return [];
  const marks = [];
  for (const side of [-1, 1]) {
    const end = side < 0 ? Math.min(...s) : Math.max(...s);
    const x = dx * end + dz * mid, z = dz * end - dx * mid;
    for (let t = .6; t < 4; t += .8) {
      const half = hw * (1 - (t + .3) / 4.6);
      const points = paintQuad(x, z, dx * side, dz * side, t, t + .16, -half, half);
      // Both ends use their own taper widths, keeping hatch tips inside the triangular nose.
      points[2] = [x + dx * side * (t + .46) + dz * side * half,
        z + dz * side * (t + .46) - dx * side * half];
      points[0] = [x + dx * side * (t + .30) + dz * side * half,
        z + dz * side * (t + .30) - dx * side * half];
      marks.push({ points, role: 'channelization' });
    }
  }
  return marks;
}

/** pre: settled arm boundary. post: paint fits each throat and short arms omit incomplete crossings. */
export function junctionMarkings(rec, { controlled = false, drivingSide = 'right', islands = [], crossings = [] } = {}) {
  const marks = [], inbound = drivingSide === 'left' ? 1 : -1;
  if (!rec?.boundary || rec.dirs.length < 3 || rec.roundabout) return marks;
  for (let ai = 0; ai < rec.dirs.length; ai++) {
    const [dx, dz] = rec.dirs[ai], armHw = rec.armHw[ai], tags = rec.armTags?.[ai] || {};
    if (/^(motorway|trunk)(?:_link)?$/.test(tags.highway || '') || tags.crossing === 'no'
      || tags.crossing === 'unmarked' || tags['crossing:markings'] === 'no') continue;
    const d0 = rec.boundary.reaches[ai] + 1.2, zw = armHw * .82;
    if (crossings.some(c => !c.marked && Math.abs(c.dx * dx + c.dz * dz) > .8
      && Math.hypot(c.x - rec.x - dx * (d0 + 1.6), c.z - rec.z - dz * (d0 + 1.6)) < armHw + 5)) continue;
    if (d0 + 5.1 >= (rec.armPaintLength?.[ai] ?? rec.armLength?.[ai] ?? Infinity) * .45) continue;
    const add = (s0, s1, q0, q1, role) => {
      const points = paintQuad(rec.x, rec.z, dx, dz, s0, s1, q0, q1);
      const cx = points.reduce((sum, p) => sum + p[0], 0) / 4;
      const cz = points.reduce((sum, p) => sum + p[1], 0) / 4;
      if (islands.some(i => [ ...points, [cx, cz] ].some(([x, z]) =>
        pointInProjectedArea(x, z, { outer: i.points, holes: [] })))) return;
      marks.push({ points, role });
    };
    for (const m of crossingMarkings({ x: rec.x + dx * (d0 + 1.6), z: rec.z + dz * (d0 + 1.6),
      dx, dz, hw: armHw, marked: true })) {
      marks.push(m);
    }
    if (controlled && rec.armIncoming?.[ai] !== false) {
      add(d0 + 4.2, d0 + 4.55, inbound < 0 ? -zw : .25, inbound < 0 ? -.25 : zw, 'stop');
    }
  }
  return marks;
}

/** A boundary fitted to each arm, including bends and roundabout mouths. No collision data. */
export function junctionBoundary(rec) {
  if (!Array.isArray(rec?.dirs) || !Array.isArray(rec.armHw) || rec.dirs.length < 2
    || rec.dirs.length !== rec.armHw.length || ![rec.x, rec.z, rec.hw].every(Number.isFinite)) return null;
  const arms = rec.dirs.map((d, i) => ({ d, hw: rec.armHw[i], length: rec.armLength?.[i] ?? Infinity }))
    .filter(a => a.d.every(Number.isFinite) && Number.isFinite(a.hw) && a.hw > 0)
    .sort((a, b) => Math.atan2(a.d[1], a.d[0]) - Math.atan2(b.d[1], b.d[0]));
  if (arms.length !== rec.dirs.length) return null;
  if (arms.length === 2 && arms[0].d[0] * arms[1].d[0] + arms[0].d[1] * arms[1].d[1] < -.85) return null;
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
export function roadTransitionIndex(records, interpolate) {
  const cells = new Map(), cell = 48;
  for (const rec of records) {
    if (rec.roundabout || rec.arms !== 2 || Math.abs(rec.armHw[0] - rec.armHw[1]) < .6) continue;
    const [a, b] = rec.dirs;
    if (a[0] * b[0] + a[1] * b[1] > -.85) continue;
    const reach = Math.min(PROFILE.taperMax, Math.max(PROFILE.taperMin,
      Math.abs(rec.armHw[0] - rec.armHw[1]) / PROFILE.taperSlope));
    const lengths = rec.armHw.map((_, i) => Math.min(reach, (rec.armLength?.[i] ?? Infinity) * .45));
    const radius = Math.max(...lengths) + rec.hw;
    for (let z = Math.floor((rec.z - radius) / cell); z <= Math.floor((rec.z + radius) / cell); z++) {
      for (let x = Math.floor((rec.x - radius) / cell); x <= Math.floor((rec.x + radius) / cell); x++) {
        const key = `${x},${z}`, rows = cells.get(key) || [];
        rows.push({ rec, lengths }); cells.set(key, rows);
      }
    }
  }
  return (x, z, hw, layer = 0) => {
    let best = Infinity, width = hw;
    for (const { rec, lengths } of cells.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) || []) {
      if ((rec.layer || 0) !== layer) continue;
      const rx = x - rec.x, rz = z - rec.z;
      for (let i = 0; i < 2; i++) {
        if (Math.abs(hw - rec.armHw[i]) > .01 || lengths[i] < .1) continue;
        const [dx, dz] = rec.dirs[i], along = rx * dx + rz * dz, across = Math.abs(rx * dz - rz * dx);
        if (along < -.01 || along > lengths[i] || across > rec.hw + .1) continue;
        const distance = Math.hypot(rx, rz);
        if (distance >= best) continue;
        best = distance;
        width = interpolate((rec.armHw[0] + rec.armHw[1]) / 2, hw, along / lengths[i]);
      }
    }
    return width;
  };
}
