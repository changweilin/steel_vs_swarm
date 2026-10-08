// Immutable observations. This module never reads rendered pixels or settles game geometry.
import { MAPGEO, battleRect, xzToLL } from './data.js';
import { areaSurfaceRows, pointInProjectedArea } from './osmAreas.js';

export const MAP_EVIDENCE = Object.freeze({ VERSION: 1, CELL_REAL_M: 20, MAX_SIDE: 192, CHANNELS: 12 });
export const EVIDENCE_COVER = Object.freeze({
  0: 'unknown', 10: 'tree', 20: 'shrub', 30: 'grass', 40: 'crop', 50: 'built',
  60: 'bare', 70: 'snow', 80: 'water', 90: 'wetland', 95: 'mangrove', 100: 'moss',
});
const ZONE = { green: 30, bare: 60, urban: 50, water: 80, wet: 90 };
const FIELD = Object.freeze({ COVER: 0, CONFIDENCE: 1, TEXTURE: 2, COHERENCE: 3, SLOPE: 4,
  COUPLING: 5, SOURCES: 6, LANDFORM: 7, GREEN: 8, GRAY: 9, LIGHT: 10, GEOLOGY: 11 });
const byte = value => Math.max(0, Math.min(255, Math.round(value)));

// A checksum identifies equal numeric inputs; it is not an authenticity signature.
export function evidenceChecksum(bytes) {
  let h = 2166136261;
  for (const b of bytes) h = Math.imul(h ^ b, 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function evidenceFrame(cfg) {
  const bounds = battleRect(cfg), step = MAP_EVIDENCE.CELL_REAL_M / MAPGEO.REAL_SCALE;
  const cellM = Math.max(step, (bounds.maxX - bounds.minX) / MAP_EVIDENCE.MAX_SIDE,
    (bounds.maxZ - bounds.minZ) / MAP_EVIDENCE.MAX_SIDE);
  return { bounds, center: { lat: cfg.center.lat, lng: cfg.center.lng, rot: cfg.center.rot || 0 },
    cols: Math.max(2, Math.ceil((bounds.maxX - bounds.minX) / cellM)),
    rows: Math.max(2, Math.ceil((bounds.maxZ - bounds.minZ) / cellM)) };
}

export function evidenceFrameKey(frame) {
  const { bounds: b, center: c } = frame;
  return JSON.stringify([MAP_EVIDENCE.VERSION, c.lat, c.lng, c.rot || 0,
    b.minX, b.minZ, b.maxX, b.maxZ, frame.cols, frame.rows]);
}

export function validateEvidenceFrame(f) {
  const b = f?.bounds, c = f?.center;
  return !!b && !!c && [b.minX, b.minZ, b.maxX, b.maxZ, c.lat, c.lng, c.rot].every(Number.isFinite)
    && Math.abs(c.lat) < 85 && Math.abs(c.lng) <= 180 && b.maxX > b.minX && b.maxZ > b.minZ
    && Number.isInteger(f.cols) && Number.isInteger(f.rows)
    && f.cols >= 2 && f.rows >= 2 && f.cols <= MAP_EVIDENCE.MAX_SIDE && f.rows <= MAP_EVIDENCE.MAX_SIDE;
}

export function validateWorldCover(pack) {
  const g = pack?.grid;
  if (pack?.schema !== 1 || !g || pack.source?.product !== '2021-v200'
    || ![g.west, g.north, g.dx, g.dy].every(Number.isFinite) || !(g.dx > 0 && g.dy > 0)
    || !Number.isInteger(g.cols) || !Number.isInteger(g.rows) || g.cols <= 0 || g.rows <= 0
    || g.cols * g.rows > 4000000 || !(pack.pixels instanceof Uint8Array)
    || pack.pixels.length !== g.cols * g.rows) return false;
  for (const code of pack.pixels) if (!Object.hasOwn(EVIDENCE_COVER, code)) return false;
  return true;
}

export function worldCoverAt(pack, lat, lng) {
  if (!pack) return 0;
  const g = pack.grid, i = Math.floor((lng - g.west) / g.dx), j = Math.floor((g.north - lat) / g.dy);
  return i >= 0 && j >= 0 && i < g.cols && j < g.rows ? pack.pixels[j * g.cols + i] : 0;
}

function xy(frame, i, j) {
  const b = frame.bounds;
  return [b.minX + (i + 0.5) * (b.maxX - b.minX) / frame.cols,
    b.minZ + (j + 0.5) * (b.maxZ - b.minZ) / frame.rows];
}

function semanticGrid(frame, areas) {
  const n = frame.cols * frame.rows, cover = new Uint8Array(n), coupled = new Uint8Array(n);
  const records = areaSurfaceRows(areas).filter(a => Object.hasOwn(ZONE, a.zone))
    .sort((a, b) => a.priority - b.priority || (String(a.sourceId) < String(b.sourceId) ? -1 : String(a.sourceId) > String(b.sourceId) ? 1 : 0));
  const b = frame.bounds, dx = (b.maxX - b.minX) / frame.cols, dz = (b.maxZ - b.minZ) / frame.rows;
  for (const area of records) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const p of area.outer) { minX = Math.min(minX, p[0]); minZ = Math.min(minZ, p[1]); maxX = Math.max(maxX, p[0]); maxZ = Math.max(maxZ, p[1]); }
    const i0 = Math.max(0, Math.floor((minX - b.minX) / dx)), i1 = Math.min(frame.cols - 1, Math.floor((maxX - b.minX) / dx));
    const j0 = Math.max(0, Math.floor((minZ - b.minZ) / dz)), j1 = Math.min(frame.rows - 1, Math.floor((maxZ - b.minZ) / dz));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const [x, z] = xy(frame, i, j);
      if (!pointInProjectedArea(x, z, area)) continue;
      let count = 1;
      for (const [ox, oz] of [[-dx / 3, 0], [dx / 3, 0], [0, -dz / 3], [0, dz / 3]]) {
        if (pointInProjectedArea(x + ox, z + oz, area)) count++;
      }
      const k = j * frame.cols + i;
      cover[k] = ZONE[area.zone]; coupled[k] = byte(count * 255 / 5);
    }
  }
  return { cover, coupled };
}

/** Capture source samplers once, before any grading/carving or source-array mutation. */
export function evidenceInputs(cfg, terrain, areas = [], prior = null) {
  const frame = evidenceFrame(cfg), n = frame.cols * frame.rows;
  const colors = new Uint8Array(n * 4), heights = new Float32Array(n).fill(NaN), cover = new Uint8Array(n);
  const semantics = semanticGrid(frame, areas || []);
  for (let j = 0; j < frame.rows; j++) for (let i = 0; i < frame.cols; i++) {
    const k = j * frame.cols + i, [x, z] = xy(frame, i, j), rgb = terrain.sampleColor?.(x, z, true);
    if (rgb?.length === 3 && rgb.every(v => Number.isFinite(v) && v >= 0 && v <= 255)) {
      colors.set(rgb, k * 4); colors[k * 4 + 3] = 255;
    }
    const h = terrain.elevationAt?.(x, z);
    if (terrain.sourceQuality?.elevationComplete !== false && Number.isFinite(h)) heights[k] = h;
    const [lat, lng] = xzToLL(x, z, frame.center);
    cover[k] = worldCoverAt(prior, lat, lng);
  }
  const inputId = [evidenceFrameKey(frame), prior?.digest || '', evidenceChecksum(colors),
    evidenceChecksum(new Uint8Array(heights.buffer)), evidenceChecksum(cover),
    evidenceChecksum(semantics.cover), evidenceChecksum(semantics.coupled)].join('|');
  return { frame, colors, heights, prior: cover, osm: semantics.cover, coupled: semantics.coupled, inputId,
    complete: areas !== null && (cfg.gen?.mode === 'random' || !cfg.venue?.id || !!prior)
      && !!terrain.sourceQuality?.imageryComplete && !!terrain.sourceQuality?.elevationComplete,
    priorDigest: prior?.digest || null };
}

function localColor(input, i, j, stride) {
  let count = 0, sum = 0, sum2 = 0, green = 0, gray = 0, gx = 0, gz = 0;
  for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
    const x = i + ox * stride, z = j + oz * stride;
    if (x < 0 || z < 0 || x >= input.frame.cols || z >= input.frame.rows) continue;
    const k = (z * input.frame.cols + x) * 4;
    if (!input.colors[k + 3]) continue;
    const r = input.colors[k], g = input.colors[k + 1], b = input.colors[k + 2], light = (r + g + b) / 3;
    count++; sum += light; sum2 += light * light; gx += ox * light; gz += oz * light;
    green += g > r * 1.12 && g > b * 1.12 ? 1 : 0;
    gray += Math.max(r, g, b) - Math.min(r, g, b) < 20 ? 1 : 0;
  }
  if (!count) return null;
  return { light: sum / count, rough: Math.sqrt(Math.max(0, sum2 / count - (sum / count) ** 2)),
    green: green / count, gray: gray / count, coherence: Math.abs(Math.abs(gx) - Math.abs(gz)) / (Math.abs(gx) + Math.abs(gz) + 1), count };
}

export function buildEvidence(input) {
  if (!validateEvidenceFrame(input?.frame)) throw new Error('Invalid map evidence frame');
  const { frame } = input, n = frame.cols * frame.rows, data = new Uint8Array(n * MAP_EVIDENCE.CHANNELS);
  if (!(input.colors instanceof Uint8Array) || input.colors.length !== n * 4
    || !(input.heights instanceof Float32Array) || input.heights.length !== n
    || [input.prior, input.osm, input.coupled].some(a => !(a instanceof Uint8Array) || a.length !== n)) throw new Error('Invalid map evidence inputs');
  const realDX = (frame.bounds.maxX - frame.bounds.minX) * MAPGEO.REAL_SCALE / frame.cols;
  const realDZ = (frame.bounds.maxZ - frame.bounds.minZ) * MAPGEO.REAL_SCALE / frame.rows;
  for (let j = 0; j < frame.rows; j++) for (let i = 0; i < frame.cols; i++) {
    const k = j * frame.cols + i, o = k * MAP_EVIDENCE.CHANNELS;
    const scales = [20, 60, 180].map(m => localColor(input, i, j, Math.max(1, Math.round(m / Math.max(realDX, realDZ)))));
    const colors = scales.filter(Boolean), c = colors[0];
    const prior = input.prior[k], osm = input.osm[k];
    let cover = prior, confidence = prior ? 1 : 0, sources = prior ? 1 : 0;
    if (c) {
      sources |= 2;
      data[o + FIELD.TEXTURE] = byte(colors.reduce((sum, s) => sum + s.rough, 0) / colors.length * 4);
      data[o + FIELD.COHERENCE] = byte(c.coherence * 255);
      data[o + FIELD.GREEN] = byte(c.green * 255); data[o + FIELD.GRAY] = byte(c.gray * 255); data[o + FIELD.LIGHT] = byte(c.light);
      if (!cover && c.count >= 5 && c.green >= 0.7) { cover = 30; confidence = 1; }
      if ([10, 20, 30, 40, 95, 100].includes(cover) && c.green >= 0.5) confidence = 2;
      // Texture/axis agreement can corroborate an existing built prior; gray alone cannot create one.
      if (cover === 50 && c.count >= 5 && c.gray >= 0.5 && c.rough >= 6 && c.coherence >= 0.25) confidence = 2;
    }
    if (osm) {
      sources |= 4;
      const same = osm === cover || (osm === 30 && [10, 20, 30, 40, 95, 100].includes(cover));
      if (prior && !same) sources |= 16;
      // Vegetated land-use keeps the observed subtype; semantic footprints are never synthesized.
      if (!same) cover = osm;
      confidence = input.coupled[k] >= 204 ? 3 : 2;
    }
    const west = input.heights[k - 1], east = input.heights[k + 1];
    const north = input.heights[k - frame.cols], south = input.heights[k + frame.cols];
    if (i > 0 && i < frame.cols - 1 && j > 0 && j < frame.rows - 1
      && [west, east, north, south, input.heights[k]].every(Number.isFinite)) {
      sources |= 8;
      const sx = (east - west) / (2 * realDX), sz = (south - north) / (2 * realDZ);
      const slope = Math.atan(Math.hypot(sx, sz)) * 180 / Math.PI;
      const curvature = (west + east + north + south) / 4 - input.heights[k];
      data[o + FIELD.SLOPE] = byte(slope);
      data[o + FIELD.LANDFORM] = slope > 35 ? 5 : curvature > 3 ? 4 : curvature < -3 ? 3 : slope > 5 ? 2 : 1;
    }
    data[o + FIELD.COVER] = Object.hasOwn(EVIDENCE_COVER, cover) ? cover : 0;
    data[o + FIELD.CONFIDENCE] = confidence; data[o + FIELD.COUPLING] = input.coupled[k]; data[o + FIELD.SOURCES] = sources;
  }
  return { version: MAP_EVIDENCE.VERSION, frame, data, inputId: input.inputId, priorDigest: input.priorDigest,
    complete: input.complete, checksum: evidenceChecksum(data) };
}

export function validateEvidence(pack) {
  if (pack?.version !== MAP_EVIDENCE.VERSION || !validateEvidenceFrame(pack.frame)
    || !(pack.data instanceof Uint8Array) || pack.data.length !== pack.frame.cols * pack.frame.rows * MAP_EVIDENCE.CHANNELS
    || typeof pack.inputId !== 'string' || pack.inputId.length > 2048 || typeof pack.complete !== 'boolean'
    || (pack.priorDigest !== null && !/^[a-f0-9]{64}$/.test(pack.priorDigest || ''))
    || evidenceChecksum(pack.data) !== pack.checksum) return false;
  for (let k = 0; k < pack.data.length; k += MAP_EVIDENCE.CHANNELS) {
    if (!Object.hasOwn(EVIDENCE_COVER, pack.data[k]) || pack.data[k + FIELD.CONFIDENCE] > 3
      || pack.data[k + FIELD.SLOPE] > 90 || pack.data[k + FIELD.SOURCES] > 31
      || pack.data[k + FIELD.LANDFORM] > 5 || pack.data[k + FIELD.GEOLOGY] !== 0) return false;
  }
  return true;
}

export function evidenceAt(pack, x, z) {
  const { bounds: b, cols, rows } = pack.frame;
  if (!Number.isFinite(x) || !Number.isFinite(z) || x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return null;
  const i = Math.min(cols - 1, Math.floor((x - b.minX) * cols / (b.maxX - b.minX)));
  const j = Math.min(rows - 1, Math.floor((z - b.minZ) * rows / (b.maxZ - b.minZ))), o = (j * cols + i) * MAP_EVIDENCE.CHANNELS;
  return { code: pack.data[o], cover: EVIDENCE_COVER[pack.data[o]], confidence: pack.data[o + FIELD.CONFIDENCE],
    texture: pack.data[o + FIELD.TEXTURE], coherence: pack.data[o + FIELD.COHERENCE], slope: pack.data[o + FIELD.SLOPE],
    coupling: pack.data[o + FIELD.COUPLING], sources: pack.data[o + FIELD.SOURCES], landform: pack.data[o + FIELD.LANDFORM],
    greenFraction: pack.data[o + FIELD.GREEN] / 255, grayFraction: pack.data[o + FIELD.GRAY] / 255,
    brightness: pack.data[o + FIELD.LIGHT], geology: 'unknown' };
}

export function evidenceDryBiome(sample) {
  if (!sample?.confidence) return null;
  if ([10, 20, 30, 40, 95, 100].includes(sample.code)) return 'green';
  if (sample.code === 50) return 'urban';
  if (sample.code === 60) return 'bare';
  return null;
}

// These are existing presentation variants, never new footprints or lithology claims.
export function evidenceLandVariant(sample, zone) {
  if (!sample?.confidence) return null;
  if (zone === 'green') {
    if ([10, 20].includes(sample.code)) return 2;
    if ([30, 100].includes(sample.code)) return 0;
    if (sample.code === 40) return 1;
  }
  if (zone === 'alpine' && sample.code === 70) return 2;
  return null;
}
