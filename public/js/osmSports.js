import { VENUES, TRACK, trackDimensions, GROUND_ATTACHMENTS } from './groundPartCatalog.js';
import { areaCandidates, projectedAreaContainsRect } from './osmAreas.js';

const aliases = { football: 'soccer', american_football: 'americanfootball', field_hockey: 'fieldhockey',
  beachvolleyball: 'beachvolley', sepak_takraw: 'sepaktakraw', table_tennis: null };

// Only mapped playing surfaces receive markings; a stadium/campus boundary is not a pitch.
export function osmSportSpec(tags = {}) {
  if (tags.indoor === 'yes' || tags.covered === 'yes') return null;
  if (!['pitch', 'practice_pitch', 'track'].includes(tags.leisure)) return null;
  const sport = String(tags.sport || '').trim().toLowerCase();
  if (tags.leisure === 'track') {
    if (tags.athletics || (sport && !['running', 'athletics'].includes(sport))) return null;
    const rawLanes = Number(tags.lanes), lanes = Number.isInteger(rawLanes) && rawLanes >= 1 && rawLanes <= 12 ? rawLanes : TRACK.lanes;
    const dimensions = trackDimensions(lanes);
    return { id: 'track', length: dimensions.width, width: dimensions.depth, lanes, color: 0xb46950, equipment: [] };
  }
  if (sport === 'basketball') return { id: 'court', length: 28 / .84, width: 15 / .84,
    color: 0x547d99, equipment: GROUND_ATTACHMENTS.court.fixed.filter(e => e[0] === 'hoop') };
  const id = Object.hasOwn(aliases, sport) ? aliases[sport] : sport;
  const spec = Object.hasOwn(VENUES, id) ? VENUES[id] : null;
  return spec?.category === 'sport' ? { ...spec, id, length: spec.length / .8, width: spec.width / .8 } : null;
}

export function sportLocalToWorld(x, z, ry, u, v) {
  const c = Math.cos(ry), s = Math.sin(ry);
  return [x + u * c + v * s, z - u * s + v * c];
}

/** Uniform fit preserves the shared marking/equipment scale; incomplete envelopes are omitted. */
export function osmSportCandidates(area, max, ry) {
  const spec = osmSportSpec(area.tags);
  if (!spec) return [];
  const candidates = [], c = Math.cos(ry), s = Math.sin(ry);
  for (const poly of area.worldPolygons || []) {
    const local = poly.outer.map(([x, z]) => [x * c - z * s, x * s + z * c]);
    const minU = Math.min(...local.map(p => p[0])), maxU = Math.max(...local.map(p => p[0]));
    const minV = Math.min(...local.map(p => p[1])), maxV = Math.max(...local.map(p => p[1]));
    const [x, z] = sportLocalToWorld(0, 0, ry, (minU + maxU) / 2, (minV + maxV) / 2);
    const initial = Math.min(1, (maxU - minU) * .94 / spec.length, (maxV - minV) * .94 / spec.width);
    const sites = [{ x, z }, ...areaCandidates({ worldPolygons: [poly] }, max)];
    for (const f of [1, .8, .6]) for (const site of sites) {
      const scale = initial * f;
      if (scale < .25) continue;
      const hw = spec.length * scale / 2, hd = spec.width * scale / 2;
      if (!projectedAreaContainsRect(site.x, site.z, hw, hd, ry, poly)) continue;
      candidates.push({ ...site, ry, sport: { ...spec, scale, hw, hd }, shape: 'sport' });
      if (candidates.length >= max) return candidates;
    }
  }
  return candidates;
}

export function osmSportSamples(p, step = 4) {
  const { hw, hd } = p.sport, points = [];
  const nx = Math.ceil(hw * 2 / step), nz = Math.ceil(hd * 2 / step);
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    points.push(sportLocalToWorld(p.x, p.z, p.ry, -hw + 2 * hw * i / nx, -hd + 2 * hd * j / nz));
  }
  return points;
}
