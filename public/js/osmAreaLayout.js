import { areaAreaM2, areaCandidates, buildContainmentIndex, placeAreaCandidates,
  pointInProjectedArea, projectedAreaContainsDisk, projectedAreaIntersectsDisk, classifyArea } from './osmAreas.js';
import { OSM_AREA_OBJECT_ROWS as ROWS } from './osmAreaCatalog.js';
import { forestSeed } from './forest.js';
import { mulberry32 } from './rng.js';
import { osmSportSpec, osmSportCandidates, osmSportSamples } from './osmSports.js';

/** A parcel's longest edge supplies a repeatable local frame, never an inferred satellite road. */
export function areaLayoutAngle(area) {
  let longest = 0, angle = 0;
  for (const poly of area?.worldPolygons || []) for (let i = 0; i < poly.outer.length; i++) {
    const a = poly.outer[i], b = poly.outer[(i + 1) % poly.outer.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], length = dx * dx + dz * dz;
    const direction = (Math.atan2(dz, dx) + Math.PI) % Math.PI;
    if (length > longest + 1e-6 || (Math.abs(length - longest) <= 1e-6 && direction < angle)) {
      longest = length; angle = direction;
    }
  }
  return -angle;
}

/** Row layouts are clipped to the same OSM rings as scatter, including inner holes. */
function rowCandidates(area, max) {
  const row = ROWS[area.classification?.generator];
  if (!row?.rows) return areaCandidates(area, max);
  const ry = areaLayoutAngle(area), c = Math.cos(ry), s = Math.sin(ry), result = [];
  const target = Math.max(1, Math.floor(max / 6));
  for (const poly of area.worldPolygons || []) {
    const local = poly.outer.map(([x, z]) => [x * c - z * s, x * s + z * c]);
    const minU = Math.min(...local.map(p => p[0])), maxU = Math.max(...local.map(p => p[0]));
    const minV = Math.min(...local.map(p => p[1])), maxV = Math.max(...local.map(p => p[1]));
    const step = Math.max(row.radius * 2 + 2, Math.sqrt((maxU - minU) * (maxV - minV) / target));
    const nu = Math.max(1, Math.min(max, Math.floor((maxU - minU) / step)));
    const nv = Math.max(1, Math.min(Math.floor(max / nu), Math.floor((maxV - minV) / step)));
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const u = (minU + maxU) / 2 + (i - (nu - 1) / 2) * step;
      const v = (minV + maxV) / 2 + (j - (nv - 1) / 2) * step;
      const x = u * c + v * s, z = -u * s + v * c;
      if (pointInProjectedArea(x, z, poly)) result.push({ x, z, ry });
    }
  }
  result.sort((a, b) => forestSeed(a.x, a.z) - forestSeed(b.x, b.z) || a.x - b.x || a.z - b.z);
  return result.slice(0, max);
}

/** The render-free placement seam rejects missing heights and unsupported water before batching. */
export function planOsmAreaObjects(areas = [], { terrain, inset = 0, heightAt, envCodeAt, blocked,
  maxObjects = 480, seed = 0, utilityPoints = [] } = {}) {
  if (!Number.isInteger(maxObjects) || maxObjects < 0 || typeof heightAt !== 'function') throw new TypeError('Invalid OSM area plan');
  const containment = buildContainmentIndex(areas);
  const masks = areas.flatMap(area => (area.worldPolygons || []).map(poly => ({ area, poly,
    minX: Math.min(...poly.outer.map(p => p[0])), maxX: Math.max(...poly.outer.map(p => p[0])),
    minZ: Math.min(...poly.outer.map(p => p[1])), maxZ: Math.max(...poly.outer.map(p => p[1])),
  })));
  const points = utilityPoints.filter(p => [p?.x, p?.z].every(Number.isFinite)
    && p.tags?.power === 'generator' && classifyArea(p.tags).generator === 'wind').map(p => ({
    sourceId: `wind/${p.x.toFixed(5)},${p.z.toFixed(5)}`, tags: p.tags,
    point: { x: p.x, z: p.z }, classification: classifyArea(p.tags),
  }));
  const eligible = [...areas, ...points].filter(area => {
    const row = ROWS[area?.classification?.generator];
    if (!row || area.tags?.building != null || area.tags?.['building:part'] != null) return false;
    if (area.classification.generator === 'sports') return !!osmSportSpec(area.tags);
    if (!area.point && area.classification.generator === 'wind' && points.some(p =>
      (area.worldPolygons || []).some(poly => pointInProjectedArea(p.point.x, p.point.z, poly)))) return false;
    return !row.representative || !containment.childrenOf(area).some(child =>
      (child.tags?.building != null || child.tags?.['building:part'] != null)
      && child.classification?.family === area.classification.family);
  });
  const plan = placeAreaCandidates(eligible, {
    maxObjects, maxPerArea: Math.max(...Object.values(ROWS).map(row => row.max)), minGap: 1.5,
    candidatesOf: (area, max) => area.point ? [area.point] : area.classification.generator === 'sports'
      ? osmSportCandidates(area, max, areaLayoutAngle(area)) : rowCandidates(area, max),
    contains: (area, p, r) => p.sport ? true : area.point ? p === area.point
      : (area.worldPolygons || []).some(poly => projectedAreaContainsDisk(p.x, p.z, r, poly)),
    radiusOf: (area, p) => p.sport ? Math.hypot(p.sport.hw, p.sport.hd) : ROWS[area.classification.generator].radius,
    countOf: area => {
      const row = ROWS[area.classification.generator];
      if (area.classification.generator === 'sports') return 1;
      if (area.point) return 1;
      return Math.min(row.max, Math.max(1, Math.floor(areaAreaM2(area) / row.minArea)));
    },
    blocked: (x, z, r, area, p) => {
      if (terrain && (x - r < terrain.minX + inset || x + r > terrain.maxX - inset
        || z - r < terrain.minZ + inset || z + r > terrain.maxZ - inset)) return true;
      const samples = p.sport ? osmSportSamples(p).map(([px, pz]) => [px - x, pz - z])
        : [[0, 0], [-r, -r], [r, -r], [r, r], [-r, r]];
      const heights = samples.map(([dx, dz]) => heightAt(x + dx, z + dz));
      if (!heights.every(Number.isFinite) || Math.max(...heights) - Math.min(...heights)
        > (p.sport ? .3 : Math.max(.35, r * .22))) return true;
      const generator = area.classification.generator;
      if (masks.some(mask => mask.area !== area && x + r >= mask.minX && x - r <= mask.maxX
        && z + r >= mask.minZ && z - r <= mask.maxZ
        && (mask.area.tags?.building != null || mask.area.tags?.['building:part'] != null
          || (mask.area.classification?.priority || 0) > (area.classification?.priority || 0))
        && projectedAreaIntersectsDisk(x, z, r, mask.poly))) return true;
      if (typeof envCodeAt === 'function') {
        const envs = samples.map(([dx, dz]) => envCodeAt(x + dx, z + dz));
        const wet = generator === 'water' || generator === 'aquaculture' || generator === 'wetland';
        if (envs.some(ec => ![0, 1, 2].includes(ec) || (wet ? ec === 0 : generator !== 'flood' && ec !== 0))) return true;
      } else if (['water', 'aquaculture', 'wetland'].includes(generator)) return true;
      if (['water', 'aquaculture'].includes(generator) && (!Number.isFinite(terrain?.waterY)
        || heights.some(h => h > terrain.waterY))) return true;
      return !!blocked?.(x, z, r, area);
    },
  });
  plan.placed = plan.placed.flatMap(p => {
    const row = ROWS[p.area.classification.generator], localSeed = forestSeed(p.x, p.z, seed);
    let shape = row.shape;
    if (p.area.classification.generator === 'parking') {
      const rnd = mulberry32(localSeed);
      if (rnd() < .22) return [];
      shape = rnd() < .33 ? 'motorcycle' : 'car';
    }
    const floating = ['water', 'aquaculture'].includes(p.area.classification.generator);
    return [{ ...p, seed: localSeed, y: floating ? terrain.waterY : heightAt(p.x, p.z),
      shape: p.shape || shape, ry: p.ry ?? (localSeed / 4294967296) * Math.PI * 2 }];
  });
  return plan;
}
