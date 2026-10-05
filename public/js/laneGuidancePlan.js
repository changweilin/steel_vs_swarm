import { LANE_COLORS } from './data.js';
import { LANE_GUIDANCE_COPY } from './laneGuidanceText.js';
import { roadSignSegments, nearestSignRoad } from './roadSigns.js';
import { LANE_GUIDANCE_SIZE, laneGuidanceHeights } from './laneGuidanceSize.js';

export const LANE_SIGN_RESERVE = 24;
export const LANE_MARK_LIMIT = 720;
const OFFSET = 7, MARK_STEP = 18;

// Consume the NPC/minimap profile; a second height march can select the wrong bridge layer.
export function planLaneGuidance(profiles, { laneIds = [], surfaceAt, ceilingAt = () => null,
  contains = () => true, roadRuns = [] } = {}) {
  const markers = [], signs = [];
  const segments = roadSignSegments(roadRuns, true);
  const valid = profiles.filter(p => p?.samples?.length > 1).length;
  const quota = Math.min(10, Math.floor(LANE_SIGN_RESERVE / Math.max(1, valid) / 2));
  profiles.forEach((profile, li) => {
    const points = profile?.samples;
    if (!points || points.length < 2) return;
    const cum = [0];
    for (let i = 1; i < points.length; i++) cum.push(cum.at(-1) + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
    const total = cum.at(-1);
    if (!Number.isFinite(total) || total < 4 || points.some(p => ![p.x, p.y, p.z].every(Number.isFinite))) return;
    const id = laneIds[li] ?? li, color = LANE_COLORS[id % LANE_COLORS.length];
    const at = s => {
      s = Math.max(0, Math.min(total, s));
      let i = 1;
      while (i < points.length - 1 && cum[i] <= s) i++;
      while (i < points.length - 1 && cum[i] === cum[i - 1]) i++;
      const a = points[i - 1], b = points[i], len = cum[i] - cum[i - 1];
      if (len < 1e-6) return null;
      const t = (s - cum[i - 1]) / len;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t, dx: (b.x - a.x) / len, dz: (b.z - a.z) / len };
    };
    const site = (s, side, h) => {
      const p = at(s);
      if (!p) return null;
      const road = nearestSignRoad(segments, p.x, p.z, [p.dx, p.dz], p.y);
      let offset = OFFSET, panelH = LANE_GUIDANCE_SIZE.panelH;
      if (road && road.d <= road.hw && Number.isFinite(road.hw)) {
        const lateral = (p.x - road.x) * p.dz - (p.z - road.z) * p.dx;
        if (road.seg.run.kind === 'road') offset = Math.max(OFFSET, road.hw + .6 - lateral * side);
        else if (road.seg.run.kind === 'bridge') offset = road.hw - .5 - lateral * side;
        else { panelH = LANE_GUIDANCE_SIZE.narrowPanelH; offset = road.hw - (h > 2 ? 1.85 : .5) - lateral * side; }
      }
      if (offset < 3) return null;
      const x = p.x + p.dz * offset * side, z = p.z - p.dx * offset * side;
      if (!contains(x, z, h > 2 ? 3 : .3)) return null;
      const y = surfaceAt ? surfaceAt(x, z, p.y + 1.2) : p.y;
      // Do not hang posts over road cuts, off bridge decks, or on a tunnel roof.
      if (!Number.isFinite(y) || Math.abs(y - p.y) > 1.2) return null;
      const ceiling = ceilingAt(x, z, y);
      if (ceiling != null && (!Number.isFinite(ceiling) || ceiling - y < h + .25)) return null;
      return { ...p, x, y, z, color, id, panelH };
    };
    const step = Math.max(MARK_STEP, total * Math.max(1, valid) * 2 / LANE_MARK_LIMIT);
    for (let s = 6; s < total - 3; s += step) for (const side of [-1, 1]) {
      const p = site(s, side, LANE_GUIDANCE_SIZE.markerH);
      if (p && markers.length < LANE_MARK_LIMIT) markers.push({ ...p, ry: Math.atan2(p.dx, p.dz) });
    }
    const stations = [];
    const addStation = s => {
      if (s < 8 || s > total - 8 || stations.some(q => Math.abs(q - s) < 28)) return;
      stations.push(s);
    };
    addStation(Math.min(18, total / 4)); addStation(total - Math.min(18, total / 4));
    // Bend notices precede the turn; endpoints remain visible when the budget fills.
    for (let s = 18; s < total - 18 && stations.length < quota; s += 8) {
      const a = at(s), b = at(s + 18);
      if (a && b && a.dx * b.dx + a.dz * b.dz < .84) addStation(s);
    }
    for (let k = 1; k <= quota && stations.length < quota; k++) addStation(total * k / (quota + 1));
    for (const s of stations.sort((a, b) => a - b)) for (const direction of [1, -1]) {
      if (signs.length >= LANE_SIGN_RESERVE) break;
      const p = site(s, direction, laneGuidanceHeights().top);
      if (!p) continue;
      const ahead = at(s + direction * 24);
      const turn = ahead ? p.dz * ahead.dx - p.dx * ahead.dz : 0;
      const arrow = Math.abs(turn) < .22 ? 'straight' : turn > 0 ? 'right' : 'left';
      signs.push({ ...p, arrow, ry: Math.atan2(-p.dx * direction, -p.dz * direction),
        h: p.panelH, copy: { t: LANE_GUIDANCE_COPY.title, s: LANE_GUIDANCE_COPY.route(id),
          ref: String(id + 1).padStart(2, '0'), arrow } });
    }
  });
  return { markers, signs };
}
