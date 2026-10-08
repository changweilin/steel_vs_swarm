import { MAPGEO } from './data.js';

export const ROAD_LANE_M = 3.2;
const SCAN_VERSION = '1';
const DRIVABLE = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)(?:_link)?$/;
const laneNumber = value => /^\d+$/.test(String(value ?? '')) && +value > 0 && +value <= 16 ? +value : null;

export function taggedRoadLanes(tags = {}) {
  const lanes = laneNumber(tags.lanes);
  if (lanes) return lanes;
  const forward = laneNumber(tags['lanes:forward']), backward = laneNumber(tags['lanes:backward']);
  return forward && backward && forward + backward <= 16 ? forward + backward : null;
}

export function observedRoadWidth(tags = {}) {
  if (taggedRoadLanes(tags) || tags['svs:lane-source'] !== 'satellite') return null;
  const lanes = laneNumber(tags['svs:lanes']);
  return lanes && lanes <= 8 ? lanes * ROAD_LANE_M : null;
}

const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const pavement = c => Array.isArray(c) && c.length === 3 && c.every(Number.isFinite)
  && Math.max(...c) - Math.min(...c) <= 40 && Math.min(...c) >= 28 && Math.max(...c) <= 235;

/** A cross-section estimates carriageway width, never an exact count of painted lane dividers. */
export function satelliteRoadSection(x, z, dx, dz, imagery) {
  if (!imagery || !(imagery.pixelM > 0 && imagery.pixelM <= ROAD_LANE_M / 3)
    || typeof imagery.sampleColor !== 'function' || ![x, z, dx, dz].every(Number.isFinite)) return null;
  const length = Math.hypot(dx, dz);
  if (length < .01) return null;
  const px = dz / length, pz = -dx / length, step = Math.max(.4, imagery.pixelM);
  const colorAt = offset => imagery.sampleColor(x + px * offset / MAPGEO.REAL_SCALE,
    z + pz * offset / MAPGEO.REAL_SCALE);
  const center = colorAt(0);
  if (!pavement(center)) return null;
  const edges = [];
  for (const side of [-1, 1]) {
    let edge = null, misses = 0;
    for (let offset = step; offset <= ROAD_LANE_M * 8; offset += step) {
      const color = colorAt(offset * side);
      if (!Array.isArray(color) || !color.every(Number.isFinite)) return null;
      if (pavement(color) && distance(color, center) < 58) { misses = 0; continue; }
      if (++misses === 2) { edge = offset - step * 1.5; break; }
    }
    if (edge === null || edge < 1) return null;
    edges.push(edge);
  }
  const width = edges[0] + edges[1];
  if (width < 2.4 || width > ROAD_LANE_M * 8 + step || Math.max(...edges) > Math.min(...edges) * 2.5) return null;
  return { width, lanes: Math.max(1, Math.min(8, Math.round(width / ROAD_LANE_M))) };
}

/** Freeze estimates in the raw road relay, before pruning, quantization or terrain grading. */
export async function inferSatelliteRoadLanes(ways, toXZ, imageryAt) {
  if (!Array.isArray(ways) || typeof imageryAt !== 'function') return ways;
  const out = ways.map(way => ({ ...way, tags: { ...way.tags } }));
  const ordered = out.filter(way => DRIVABLE.test(way.tags.highway || '')
    && !way.tags.tunnel && !taggedRoadLanes(way.tags) && way.tags['svs:lane-scan'] !== SCAN_VERSION)
    .sort((a, b) => JSON.stringify(a.geometry).localeCompare(JSON.stringify(b.geometry)));
  await Promise.all(ordered.map(async way => {
    way.tags['svs:lane-scan'] = SCAN_VERSION;
    const points = (way.geometry || []).map(toXZ), segments = [];
    if (points.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) return;
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!(length > .01)) continue;
      segments.push({ a, b, length, start: total }); total += length;
    }
    if (total * MAPGEO.REAL_SCALE < 24) return;
    const sections = await Promise.all([.2, .5, .8].map(async fraction => {
      const at = total * fraction, segment = segments.find(s => s.start + s.length >= at);
      if (!segment || segment.length * MAPGEO.REAL_SCALE < 8) return null;
      const { a, b, length, start } = segment, t = (at - start) / length;
      const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      try { return satelliteRoadSection(x, z, b[0] - a[0], b[1] - a[1], await imageryAt(x, z)); }
      catch { return null; }
    }));
    const valid = sections.filter(Boolean).sort((a, b) => a.width - b.width);
    if (valid.length < 3 || valid[2].width - valid[0].width > ROAD_LANE_M
      || valid.some(s => s.lanes !== valid[1].lanes)) return;
    way.tags['svs:lanes'] = String(valid[1].lanes);
    way.tags['svs:observed-width'] = valid[1].width.toFixed(2);
    way.tags['svs:lane-source'] = 'satellite';
  }));
  return out;
}
