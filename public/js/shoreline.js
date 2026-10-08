// Terrain fixes the dry/wet boundary; OSM identifies water use, while coarse imagery only corroborates cover.
import { areaSurfaceRows, pointInProjectedArea } from './osmAreas.js';
import { distanceToSegment } from './architectureStyles.js';
import { forestSeed } from './forest.js';
import { mulberry32 } from './rng.js';
import { SHORELINE, SHORE_WATER_TAGS, SHORE_FACILITIES } from './shorelineCatalog.js';

function waterWidth(tags) {
  const raw = tags?.width;
  if (!/^\d+(\.\d+)?( m)?$/.test(raw || '')) return 0;
  return Math.min(SHORELINE.MAX_WIDTH_M, Number.parseFloat(raw));
}

function shoreSourceIndex(rows, pointsOf, paddingOf = () => 0, bounds = null) {
  const grid = new Map(), cell = SHORELINE.INDEX_CELL_M;
  let used = 0;
  for (const row of rows) {
    const pts = pointsOf(row);
    if (!pts.length || !pts.every(p => p.length === 2 && p.every(Number.isFinite))) continue;
    const pad = paddingOf(row), xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
    const minX = Math.max(Math.min(...xs) - pad, bounds?.minX ?? -Infinity);
    const maxX = Math.min(Math.max(...xs) + pad, bounds?.maxX ?? Infinity);
    const minZ = Math.max(Math.min(...zs) - pad, bounds?.minZ ?? -Infinity);
    const maxZ = Math.min(Math.max(...zs) + pad, bounds?.maxZ ?? Infinity);
    if (maxX < minX || maxZ < minZ) continue;
    const i0 = Math.floor(minX / cell), i1 = Math.floor(maxX / cell), j0 = Math.floor(minZ / cell), j1 = Math.floor(maxZ / cell);
    const count = (i1 - i0 + 1) * (j1 - j0 + 1);
    if (used + count > SHORELINE.MAX_INDEX_CELLS) continue;
    used += count;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const key = i + '/' + j;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(row);
    }
  }
  return (x, z) => grid.get(Math.floor(x / cell) + '/' + Math.floor(z / cell)) || [];
}

/** post: unknown tags remain unknown; shape, size and RGB never invent an inland water use. */
export function shoreWaterType(tags = {}) {
  if (tags.natural === 'coastline' || ['bay', 'strait'].includes(tags.natural)) return 'sea';
  if (tags.water != null) return SHORE_WATER_TAGS[tags.water] || 'unknown';
  if (tags.waterway != null) return SHORE_WATER_TAGS[tags.waterway] || (tags.waterway === 'riverbank' ? 'river' : 'unknown');
  if (tags.landuse === 'reservoir') return 'reservoir';
  if (tags.landuse === 'basin') return 'basin';
  if (tags.landuse === 'salt_pond') return 'pond';
  return 'unknown';
}

/** post: specialized mapped facilities precede general tag matches. */
export function mappedShoreFacility(tags = {}) {
  return Object.entries(SHORE_FACILITIES).filter(([, spec]) => spec.mapped)
    .sort((a, b) => Number(!!b[1].allTags) - Number(!!a[1].allTags))
    .find(([, spec]) => spec.allTags ? spec.mapped.every(([k, v]) => tags[k] === v)
      : spec.mapped.some(([k, v]) => tags[k] === v))?.[0] || null;
}

/** pre: areas are already projected room data; lines and points use the same world X/Z frame. */
export function createShoreClassifier({ areas = [], lines = [], bounds = null, evidenceAt, reach = SHORELINE.TYPE_REACH_M } = {}) {
  const polygons = areaSurfaceRows(areas).filter(p => p.zone === 'water')
    .sort((a, b) => b.priority - a.priority || String(a.sourceId).localeCompare(String(b.sourceId)));
  const segments = lines.flatMap(line => (line.points || []).slice(1).map((b, i) => ({
    a: line.points[i], b, tags: line.tags || {}, type: shoreWaterType(line.tags),
    width: waterWidth(line.tags),
  }))).filter(s => s.type !== 'unknown' && [...s.a, ...s.b].every(Number.isFinite));
  const areasAt = shoreSourceIndex(polygons, p => p.outer, undefined, bounds);
  const linesAt = shoreSourceIndex(segments, s => [s.a, s.b], s => reach + s.width / 2, bounds);
  return (x, z) => {
    const area = areasAt(x, z).find(p => pointInProjectedArea(x, z, p));
    let type = area ? shoreWaterType(area.tags) : 'unknown', tags = area?.tags || {}, source = area ? 'osm-area' : 'terrain';
    if (!area) {
      let best = Infinity;
      for (const s of linesAt(x, z)) {
        const d = distanceToSegment(x, z, ...s.a, ...s.b);
        if (d <= reach + s.width / 2 && d < best) { best = d; type = s.type; tags = s.tags; source = 'osm-line'; }
      }
    }
    const sample = evidenceAt?.(x, z), satellite = !!sample?.confidence && !!(sample.sources & 3);
    const corroborated = satellite && sample.code === 80;
    return { type, tags, source, satellite, corroborated,
      conflict: satellite && sample.code !== 80, confidence: type === 'unknown' ? 0 : corroborated ? 3 : 2,
      tidal: tags.tidal === 'yes' || type === 'tidal', intermittent: tags.intermittent === 'yes' };
  };
}

function bankContext(sample, tags = {}) {
  if (tags.natural === 'beach') return 'sand';
  if (['bare_rock', 'scree', 'shingle'].includes(tags.natural)) return 'rock';
  if (!sample?.confidence) return 'unknown';
  if (sample.code === 50) return 'built';
  if ([10, 20, 30, 40, 90, 95, 100].includes(sample.code)) return 'vegetated';
  // RGB/WorldCover bare cover cannot distinguish beach sand from bedrock.
  return 'unknown';
}

/** pre: heights and waterY are settled terrain metres. post: every anchor brackets finite dry/wet samples. */
export function planShoreAnchors({ bounds, heightAt, waterY, classifyAt = () => ({ type: 'unknown' }),
  lines = [], step = SHORELINE.STEP_M } = {}) {
  if (!bounds || !Number.isFinite(waterY) || typeof heightAt !== 'function' || !Number.isFinite(step) || step <= 0
    || !Object.values(bounds).every(Number.isFinite) || bounds.maxX <= bounds.minX || bounds.maxZ <= bounds.minZ) return [];
  step = Math.max(step, (bounds.maxX - bounds.minX) / SHORELINE.MAX_SIDE, (bounds.maxZ - bounds.minZ) / SHORELINE.MAX_SIDE);
  const rows = [], seen = new Set(), inside = (x, z) => x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
  const cross = (a, b) => {
    if (rows.length >= SHORELINE.MAX_ANCHORS || !inside(...a) || !inside(...b)) return;
    const ha = heightAt(...a), hb = heightAt(...b);
    if (![ha, hb].every(Number.isFinite) || (ha > waterY) === (hb > waterY)) return;
    let dry = ha > waterY ? a : b, wet = ha > waterY ? b : a;
    for (let i = 0; i < 12; i++) {
      const mid = [(dry[0] + wet[0]) / 2, (dry[1] + wet[1]) / 2], h = heightAt(...mid);
      if (!Number.isFinite(h)) return;
      if (h > waterY) dry = mid; else wet = mid;
    }
    const x = (dry[0] + wet[0]) / 2, z = (dry[1] + wet[1]) / 2;
    const e = SHORELINE.NORMAL_PROBE_M, heights = [heightAt(x + e, z), heightAt(x - e, z), heightAt(x, z + e), heightAt(x, z - e)];
    if (!heights.every(Number.isFinite)) return;
    let nx = heights[0] - heights[1], nz = heights[2] - heights[3], n = Math.hypot(nx, nz);
    if (n < 1e-6) { nx = dry[0] - wet[0]; nz = dry[1] - wet[1]; n = Math.hypot(nx, nz); }
    if (n < 1e-6) return;
    nx /= n; nz /= n;
    const key = Math.round(x / (step / 2)) + '/' + Math.round(z / (step / 2)) + '/' + Math.round(Math.atan2(nz, nx) * 4 / Math.PI);
    if (seen.has(key)) return;
    const probe = [x - nx * SHORELINE.WET_PROBE_M, z - nz * SHORELINE.WET_PROBE_M];
    const dryProbe = [x + nx * SHORELINE.WET_PROBE_M, z + nz * SHORELINE.WET_PROBE_M];
    if (!inside(...probe) || !inside(...dryProbe) || !(heightAt(...probe) <= waterY) || !(heightAt(...dryProbe) > waterY)) return;
    seen.add(key);
    rows.push({ x, z, nx, nz, waterY, ...classifyAt(...probe) });
  };
  // Source-guided cross-sections retain narrow resolved channels that a coarse grid can miss.
  let probes = 0;
  for (const line of lines) for (let i = 1; i < (line.points?.length || 0); i++) {
    if (!['river', 'stream', 'canal', 'drain', 'ditch', 'tidal'].includes(shoreWaterType(line.tags))) continue;
    const a = line.points[i - 1], b = line.points[i], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (!Number.isFinite(len) || len < .01) continue;
    const width = waterWidth(line.tags) || step;
    const reach = Math.min(SHORELINE.MAX_WIDTH_M / 2, Math.max(step, width));
    const count = Math.ceil(len / step);
    for (let j = 0; j <= count && probes < SHORELINE.MAX_SOURCE_PROBES; j++, probes++) {
      const p = [a[0] + dx * j / count, a[1] + dz * j / count];
      for (const side of [-1, 1]) cross(p, [p[0] - dz / len * reach * side, p[1] + dx / len * reach * side]);
    }
  }
  const nx = Math.ceil((bounds.maxX - bounds.minX) / step), nz = Math.ceil((bounds.maxZ - bounds.minZ) / step);
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = Math.min(bounds.maxX, bounds.minX + i * step), z = Math.min(bounds.maxZ, bounds.minZ + j * step);
    if (i < nx) cross([x, z], [Math.min(bounds.maxX, x + step), z]);
    if (j < nz) cross([x, z], [x, Math.min(bounds.maxZ, z + step)]);
  }
  return rows;
}

/** pre: fits validates the complete footprint against shared occupied/OSM envelopes. post: low budgets are prefixes. */
export function planShoreFacilities({ anchors = [], points = [], areas = [], bounds, heightAt, evidenceAt,
  fits = () => true, reserve = () => {}, seed = 0, limit = SHORELINE.LIMIT, procedural = false } = {}) {
  if (!bounds || typeof heightAt !== 'function' || !Number.isInteger(limit) || limit < 0) return [];
  const rows = [], taken = new Set(), bankAreas = areaSurfaceRows(areas)
    .sort((a, b) => b.priority - a.priority || String(a.sourceId).localeCompare(String(b.sourceId)));
  const banksAt = shoreSourceIndex(bankAreas, p => p.outer, undefined, bounds);
  const add = (anchor, kind, point = null) => {
    const spec = SHORE_FACILITIES[kind];
    if (!spec || !spec.types.includes(anchor.type) || rows.length >= limit
      || ![anchor.x, anchor.z, anchor.nx, anchor.nz, anchor.waterY].every(Number.isFinite)) return;
    if (point?.tags?.access === 'no' || point?.tags?.disused === 'yes' || point?.tags?.demolished === 'yes') return;
    const rnd = mulberry32(forestSeed(anchor.x, anchor.z, seed ^ 0x53484f52));
    const variant = Math.floor(rnd() * SHORELINE.VARIANTS), scale = .92 + rnd() * .16;
    const [w, , d] = spec.size, r = Math.hypot(w, d) * scale / 2;
    const offset = r + SHORELINE.GAP_M;
    const x = point ? point.x : anchor.x + anchor.nx * offset, z = point ? point.z : anchor.z + anchor.nz * offset;
    const ry = Math.atan2(-anchor.nx, -anchor.nz);
    const foot = { x, z, r, hw: w * scale / 2, hd: d * scale / 2, ry };
    if (x - r < bounds.minX || x + r > bounds.maxX || z - r < bounds.minZ || z + r > bounds.maxZ || !fits(foot)) return;
    const countX = Math.ceil(w * scale / SHORELINE.FIT_STEP_M), countZ = Math.ceil(d * scale / SHORELINE.FIT_STEP_M);
    if ((countX + 1) * (countZ + 1) > SHORELINE.MAX_FIT_PROBES) return;
    const c = Math.cos(ry), s = Math.sin(ry), heights = [];
    for (let i = 0; i <= countX; i++) for (let j = 0; j <= countZ; j++) {
      const u = (i / countX - .5) * w * scale, v = (j / countZ - .5) * d * scale;
      const h = heightAt(x + u * c + v * s, z - u * s + v * c);
      if (!Number.isFinite(h) || h <= anchor.waterY) return;
      heights.push(h);
    }
    if (Math.max(...heights) - Math.min(...heights) > SHORELINE.MAX_GROUND_DELTA_M) return;
    const row = { ...foot, y: Math.min(...heights) - .025, kind, variant, scale,
      type: anchor.type, source: point ? 'osm-point' : procedural ? 'procedural-appearance' : 'context-appearance', evidence: anchor.source };
    rows.push(row); reserve(foot); taken.add(anchor);
  };
  for (const p of [...points].sort((a, b) => a.x - b.x || a.z - b.z)) {
    const kind = mappedShoreFacility(p.tags);
    if (!kind || ![p.x, p.z].every(Number.isFinite)) continue;
    let nearest = null, best = SHORELINE.TYPE_REACH_M;
    for (const a of anchors) {
      const d = Math.hypot(a.x - p.x, a.z - p.z);
      if (d < best) { best = d; nearest = a; }
    }
    if (nearest) add(nearest, kind, p);
  }
  for (const anchor of anchors) {
    if (taken.has(anchor)) continue;
    const x = anchor.x + anchor.nx * 3, z = anchor.z + anchor.nz * 3;
    const sample = evidenceAt?.(x, z), tags = banksAt(x, z).find(p => pointInProjectedArea(x, z, p))?.tags;
    const context = bankContext(sample, tags), rnd = mulberry32(forestSeed(anchor.x, anchor.z, seed ^ 0x434f4e54));
    const kinds = Object.entries(SHORE_FACILITIES).filter(([, s]) => s.types.includes(anchor.type)
      && (procedural ? s.proceduralContexts : s.contexts).includes(context)).map(([k]) => k);
    if (kinds.length && rnd() < .55) add(anchor, kinds[Math.floor(rnd() * kinds.length)]);
  }
  return rows;
}
