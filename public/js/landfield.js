import { evidenceDryBiome, evidenceLandVariant } from './mapEvidence.js';
import { habitatAt, habitatPatch } from './habitat.js';
// ============ Zonecut lines -> seven-zone landform field (runtime sole assembly point)============
// R=zone index, G=appearance segment with geometric reason, B=deterministic continuous field, A=road/built mask.
// This module emits pure data only; DataTexture and shader lifetimes are owned by toon.js.
import { SLOPE } from './data.js';
import { rasterLines, corridorKeepOut, floodFaces, assignWallTexels, mergeSmall, faceSamples } from './zonecut.js';
import { areaSurfaceRows, classifyArea } from './osmAreas.js';

export const LAND_ZONES = ['water', 'wet', 'green', 'bare', 'urban', 'alpine', 'cliff'];
export const LAND_FIELD_N = 1024;
export const LAND_ROAD_RANK = 3;
export const LAND_AREA_MIN_F = 0.0004;

const ROAD_RANK = (hw) => (/^(motorway|trunk)$/.test(hw) ? 1
  : /^(primary|secondary)$/.test(hw) ? 2
    : /^(tertiary|unclassified|residential|living_street)$/.test(hw) ? 3 : 4);
const ROAD_W = {
  motorway: 12, trunk: 11, primary: 10, secondary: 8, tertiary: 7,
  unclassified: 5, residential: 5.5, living_street: 5, service: 4,
};

export function coverZone(tags = {}) {
  const classified = classifyArea(tags).surface;
  if (classified) return tags.natural === 'cliff' ? 'cliff' : classified;
  const lu = tags.landuse, na = tags.natural, le = tags.leisure;
  if (na === 'cliff') return 'cliff';
  if (na === 'water' || lu === 'reservoir' || lu === 'basin' || na === 'bay' || na === 'strait') return 'water';
  if (na === 'wetland' || lu === 'salt_pond' || na === 'marsh' || na === 'mud') return 'wet';
  if (na === 'sand' || na === 'beach' || na === 'bare_rock' || na === 'scree' || na === 'shingle'
    || na === 'rock' || lu === 'quarry' || lu === 'landfill') return 'bare';
  if (na === 'wood' || na === 'scrub' || na === 'grassland' || na === 'heath' || na === 'tree_row'
    || le || lu === 'forest' || lu === 'grass' || lu === 'meadow' || lu === 'farmland'
    || lu === 'orchard' || lu === 'vineyard' || lu === 'allotments' || lu === 'village_green'
    || lu === 'cemetery' || lu === 'recreation_ground' || lu === 'greenfield' || lu === 'plant_nursery') return 'green';
  return lu ? 'urban' : null;
}

const pointInPoly = (x, z, pts, holes = []) => {
  let inside = false;
  for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
    const [xa, za] = pts[a], [xb, zb] = pts[b];
    if ((za > z) !== (zb > z) && x < (xb - xa) * (z - za) / (zb - za) + xa) inside = !inside;
  }
  if (!inside) return false;
  for (const hole of holes) {
    let inHole = false;
    for (let a = 0, b = hole.length - 1; a < hole.length; b = a++) {
      const [xa, za] = hole[a], [xb, zb] = hole[b];
      if ((za > z) !== (zb > z) && x < (xb - xa) * (z - za) / (zb - za) + xa) inHole = !inHole;
    }
    if (inHole) return false;
  }
  return true;
};
const median = (a) => {
  if (!a.length) return 0;
  a.sort((x, y) => x - y);
  return a[(a.length / 2) | 0];
};
const yieldFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** Build a one-shot landform field. All map arrays MUST be the osmrelay-purified, room-shared copy. */
export async function buildLandField({ terrain, center, roads = [], rails = [], waters = [], covers = [], areas = [],
  boundaries = [], gradeCorridors = [], classifyPureAt, envCodeAt, projectAt, seed = 0, onProgress }) {
  const spanX = terrain.worldW, spanZ = terrain.worldH;
  const mpt = Math.max(spanX, spanZ) / LAND_FIELD_N;
  const nx = Math.max(2, Math.ceil(spanX / mpt)), nz = Math.max(2, Math.ceil(spanZ / mpt));
  const xOf = (i) => terrain.minX + (i + 0.5) * mpt;
  const zOf = (j) => terrain.minZ + (j + 0.5) * mpt;
  const ti = (x) => (x - terrain.minX) / mpt;
  const tj = (z) => (z - terrain.minZ) / mpt;
  // Caller injects the A42 sole projection seam; this module MUST NOT keep a second lat/lon formula.
  const proj = (p) => projectAt(p.lat, p.lon ?? p.lng, center);
  const waySegs = (list, hwOf) => {
    const out = [];
    for (const way of list) {
      let prev = null;
      for (const p of way.geometry || []) {
        const q = proj(p);
        if (prev) out.push([ti(prev[0]), tj(prev[1]), ti(q[0]), tj(q[1]), Math.max(0.5, hwOf(way) / mpt)]);
        prev = q;
      }
    }
    return out;
  };

  await onProgress?.(0.035, '建立地貌線工切面…');
  const roadWays = roads.filter((w) => ROAD_RANK(w.tags?.highway || '') <= LAND_ROAD_RANK);
  const coverWays = !areas.length && covers.filter((w) => {
    if (!coverZone(w.tags) || (w.geometry?.length || 0) < 4) return false;
    const a = w.geometry[0], b = w.geometry[w.geometry.length - 1];
    return Math.abs(a.lat - b.lat) + Math.abs((a.lon ?? a.lng) - (b.lon ?? b.lng)) < 1e-6;
  });
  // Sole source for land-use/nature/water/recreation zones is osmAreas worldPolygons; keep every hole,
  // never maintain a second covers classification. areaSurfaceRows reads existing projection results to avoid recomputing projection in landfield.
  const areaRows = areaSurfaceRows(areas);
  const areaPolys = areaRows
    .map((r) => ({ zone: r.zone || coverZone(r.tags), tags: r.tags, sourceId: r.sourceId,
      pts: r.outer, holes: r.holes || [], priority: r.priority || 0 }))
    .filter((p) => p.zone && Array.isArray(p.pts) && p.pts.length >= 3)
    .sort((a, b) => a.priority - b.priority || String(b.sourceId).localeCompare(String(a.sourceId)));
  const ringSegs = (pts, hw) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const q = pts[(i + 1) % pts.length];
      const a = pts[i], b = q;
      out.push([ti(a[0]), tj(a[1]), ti(b[0]), tj(b[1]), Math.max(0.5, hw / mpt)]);
    }
    return out;
  };
  const areaSegs = areaPolys.flatMap((p) => [
    ...ringSegs(p.pts, 1.5),
    ...p.holes.flatMap((h) => ringSegs(h, 1.5)),
  ]);
  const mainSegs = [
    ...waySegs(roadWays, (w) => (ROAD_W[w.tags?.highway] || 5) / 2),
    ...waySegs(rails, () => 3),
    ...waySegs(waters, (w) => (w.tags?.waterway === 'river' ? 6 : 2.5)),
    ...(areaPolys.length ? areaSegs : waySegs(coverWays, () => 1.5)),
  ];
  const nearWall = rasterLines(nx, nz, mainSegs.map((s) => [s[0], s[1], s[2], s[3], 40 / mpt])).wall;
  const admSegs = waySegs(boundaries, () => 1.5).filter((s) => {
    const i = Math.round((s[0] + s[2]) / 2), j = Math.round((s[1] + s[3]) / 2);
    return i >= 0 && j >= 0 && i < nx && j < nz && !nearWall[j * nx + i];
  });

  const keepOut = corridorKeepOut(nx, nz, mpt, gradeCorridors, { toI: ti, toJ: tj });

  const slope = new Float32Array(nx * nz), height = new Float32Array(nx * nz);
  let hMin = Infinity, hMax = -Infinity;
  const d = Math.max(terrain.gridM || mpt, mpt);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = xOf(i), z = zOf(j), h = terrain.heightAt(x, z);
      height[j * nx + i] = h; hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
      const gx = (terrain.heightAt(x + d, z) - terrain.heightAt(x - d, z)) / (2 * d);
      const gz = (terrain.heightAt(x, z + d) - terrain.heightAt(x, z - d)) / (2 * d);
      slope[j * nx + i] = Math.hypot(gx, gz);
    }
    if ((j & 63) === 63) await yieldFrame();
  }
  const contour = new Uint8Array(nx * nz);
  const cuts = [Math.tan(SLOPE.EASE_DEG * Math.PI / 180), Math.tan(SLOPE.BLOCK_DEG * Math.PI / 180)];
  for (let j = 0; j + 1 < nz; j++) for (let i = 0; i + 1 < nx; i++) {
    const k = j * nx + i, a = slope[k];
    if (cuts.some((v) => (a - v) * (slope[k + 1] - v) < 0 || (a - v) * (slope[k + nx] - v) < 0)) contour[k] = 1;
  }
  const roadMask = rasterLines(nx, nz, waySegs(roadWays, (w) => (ROAD_W[w.tags?.highway] || 5) / 2)).wall;
  const rl = rasterLines(nx, nz, [...mainSegs, ...admSegs], { keepOut });
  for (let k = 0; k < contour.length; k++) if (contour[k] && !keepOut[k]) rl.wall[k] = 1;
  const ff = floodFaces(rl.wall, nx, nz);
  assignWallTexels(ff.face, rl.wall, nx, nz);
  const mg = mergeSmall(ff.face, ff.n, nx, nz, {
    areaMin: Math.max(4, Math.round(LAND_AREA_MIN_F * nx * nz)), rel: 0.5,
  });
  await yieldFrame();

  const polyZone = new Int8Array(nx * nz).fill(-1), polyOwner = new Int32Array(nx * nz).fill(-1);
  const polys = areaPolys.length ? areaPolys : coverWays.map((w) => ({ zone: coverZone(w.tags), tags: w.tags, pts: w.geometry.map(proj), holes: [] }));
  for (let pi = 0; pi < polys.length; pi++) {
    const p = polys[pi];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of p.pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const i0 = Math.max(0, Math.floor(ti(minX))), i1 = Math.min(nx - 1, Math.ceil(ti(maxX)));
    const j0 = Math.max(0, Math.floor(tj(minZ))), j1 = Math.min(nz - 1, Math.ceil(tj(maxZ)));
    const zi = LAND_ZONES.indexOf(p.zone);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (pointInPoly(xOf(i), zOf(j), p.pts, p.holes)) {
      polyZone[j * nx + i] = zi; polyOwner[j * nx + i] = pi;
    }
  }

  const samples = faceSamples(mg.face, mg.n, 24), labels = new Int8Array(mg.n);
  const alpineH = hMax - hMin > 40 ? hMin + (hMax - hMin) * 0.62 : Infinity;
  for (let f = 0; f < mg.n; f++) {
    const votes = new Int16Array(LAND_ZONES.length), ss = [], hs = [];
    for (const k of samples[f]) {
      const i = k % nx, j = (k / nx) | 0, x = xOf(i), z = zOf(j);
      const pz = polyZone[k];
      let zn = pz >= 0 ? LAND_ZONES[pz] : classifyPureAt(x, z);
      if (!LAND_ZONES.includes(zn) || zn === 'water') zn = slope[k] > 0.28 ? 'bare' : 'green';
      votes[LAND_ZONES.indexOf(zn)]++; ss.push(slope[k]); hs.push(height[k]);
    }
    let zi = 2;
    for (let q = 0; q < votes.length; q++) if (votes[q] > votes[zi]) zi = q;
    const sm = median(ss), hm = median(hs);
    if (sm > 0.75) zi = 6;
    else if (sm > 0.28 && zi !== 1) zi = 3;
    else if ((zi === 2 || zi === 3) && hm > alpineH) zi = 5;
    labels[f] = zi;
  }

  const data = new Uint8Array(nx * nz * 4), appearance = new Uint8Array(nx * nz * 4);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = xOf(i), z = zOf(j), ec = envCodeAt(x, z);
    let zi = ec === 1 ? 0 : ec === 2 ? 1 : labels[mg.face[k]];
    const observation = terrain.evidenceAt?.(x, z);
    if (ec === 0) {
      const dry = polyZone[k] >= 0 ? LAND_ZONES[polyZone[k]] : (typeof classifyPureAt === 'function' ? classifyPureAt(x, z) : evidenceDryBiome(observation));
      if (dry && dry !== 'water' && dry !== 'wet') zi = LAND_ZONES.indexOf(dry);
      if (slope[k] > .75) zi = 6;
      else if (slope[k] > .28 && zi !== 1) zi = 3;
      else if ((zi === 2 || zi === 3) && height[k] > alpineH) zi = 5;
    }
    const patch = habitatPatch(seed, x, z), n = patch, s = slope[k], h = height[k];
    let variant = 0;
    if (zi === 0) variant = terrain.waterY != null && h < terrain.waterY - 2.5 ? 1 : 0;
    else if (zi === 1) variant = n > 0.62 ? 1 : 0;
    else if (zi === 2) variant = s > 0.12 ? 2 : n > 0.95 ? 3 : n > 0.48 ? 1 : 0;
    else if (zi === 3) variant = s > 0.2 ? 1 : h < hMin + 3 ? 2 : n > 0.76 ? 3 : 0;
    else if (zi === 4) variant = polyZone[k] === 4 ? 3 : n > 0.82 ? 2 : n > 0.62 ? 1 : 0;
    else if (zi === 5) variant = h > hMin + (hMax - hMin) * 0.84 ? 2 : s > 0.28 ? 1 : 0;
    else if (zi === 6) variant = s > 1.25 ? 1 : 0;
    variant = evidenceLandVariant(observation, LAND_ZONES[zi]) ?? variant;
    const o = k * 4;
    data[o] = zi; data[o + 1] = variant; data[o + 2] = Math.round(patch * 255);
    data[o + 3] = roadMask[k] || polyZone[k] === 4 ? 255 : 0;
    const habitat = habitatAt(observation, LAND_ZONES[zi], polys[polyOwner[k]]?.tags,
      Number.isFinite(terrain.waterY) ? terrain.waterY - h : null,
      { ...terrain.forestEnv, x, z });
    if (habitat) { appearance.set(habitat.color, o); appearance[o + 3] = 255; }
  }
  const bounds = { minX: terrain.minX, maxX: terrain.maxX, minZ: terrain.minZ, maxZ: terrain.maxZ };
  const sample = (x, z) => {
    const i = Math.max(0, Math.min(nx - 1, Math.floor(ti(x))));
    const j = Math.max(0, Math.min(nz - 1, Math.floor(tj(z))));
    return LAND_ZONES[data[(j * nx + i) * 4]];
  };
  return { data, appearance, nx, nz, bounds, sample, faces: mg.n, merged: mg.merged };
}
