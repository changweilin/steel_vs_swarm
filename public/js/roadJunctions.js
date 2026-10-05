import { ROAD_JUNCTION_PROFILE as PROFILE } from './roadStructureMeshData.js';

const cross = (a, b) => a[0] * b[1] - a[1] * b[0];

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
