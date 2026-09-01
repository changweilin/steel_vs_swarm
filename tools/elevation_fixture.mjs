// ============ 真實 Terrarium 高程 fixture 捕獲器 =============
// 這個模組只接受 AWS Terrain Tiles(terrarium) 作為來源；不提供 open-meteo、
// flat、synthetic 或程序噪聲 fallback。每份 fixture 同時保留原始 PNG tile、
// SHA-256、來源 URL、bbox/center/team 與 runtime 同形的 193×193 raw 網格。
//
// CLI 在 fetch_elevation_fixture.mjs；fetch_osm_fixture.mjs 以 --elevation 呼叫
// captureElevationFixture。正式 audit 只消費已寫入版控的資料，不在 fixture 模式查網路。
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, posix } from 'node:path';
import { inflateSync } from 'node:zlib';
import {
  DEFAULT_ELEVATION_DIR,
  ELEVATION_FIXTURE_SCHEMA, ELEVATION_FIXTURE_VERSION, ELEVATION_GRID_N,
  elevationFixturePath, elevationWorldBounds, fixtureNameOf,
} from './osm_fixture.mjs';
import { TERRAIN, xzToLL } from '../public/js/data.js';

export const TERRARIUM_URL = (z, x, y) =>
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/' + z + '/' + x + '/' + y + '.png';
export const TERRARIUM_PROVIDER = 'aws-terrain-tiles';
export const TERRARIUM_ENCODING = 'terrarium';
const UA = 'steel-vs-swarm-elevation-fixture/1.0 (maintainer-updated regression data)';

const d2r = (d) => d * Math.PI / 180;
const lon2tx = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2ty = (lat, z) =>
  (1 - Math.log(Math.tan(d2r(lat)) + 1 / Math.cos(d2r(lat))) / Math.PI) / 2 * 2 ** z;
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function tileBounds(bbox, z) {
  const tx0 = Math.floor(lon2tx(bbox.minLng, z));
  const tx1 = Math.floor(lon2tx(bbox.maxLng, z));
  const ty0 = Math.floor(lat2ty(bbox.maxLat, z));
  const ty1 = Math.floor(lat2ty(bbox.minLat, z));
  const cols = tx1 - tx0 + 1, rows = ty1 - ty0 + 1;
  if (cols < 1 || rows < 1 || cols * rows > 16) {
    throw new Error('高程磚數量異常:' + cols + '×' + rows);
  }
  return { z, tx0, tx1, ty0, ty1, cols, rows };
}

// 極簡 PNG 解碼，與 venue_field.mjs 共用同一種無依賴策略；只接受 8-bit RGB/RGBA。
function decodePng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('高程來源不是 PNG');
  }
  let p = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (p + 12 <= buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8);
    const end = p + 12 + len;
    if (end > buf.length) throw new Error('高程 PNG chunk 超出檔案');
    const body = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4);
      bitDepth = body[8]; colorType = body[9];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw new Error('不支援的 Terrarium PNG 格式:' + bitDepth + '/' + colorType);
      }
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p = end;
  }
  if (w !== 256 || h !== 256) throw new Error('Terrarium tile 必須是 256×256:' + w + '×' + h);
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * bpp);
  const stride = w * bpp;
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = (prev && i >= bpp) ? prev[i - bpp] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      } else if (ft !== 0) throw new Error('不支援的 PNG filter:' + ft);
      cur[i] = v & 0xff;
    }
  }
  return { w, h, bpp, data: out };
}

async function fetchTile(url, timeoutMs, tries = 4) {
  let last = '未知錯誤';
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) last = url + ' HTTP ' + response.status;
      else return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      last = url + ' ' + error.message;
    }
    if (attempt + 1 < tries) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 800 * (attempt + 1)));
    }
  }
  throw new Error('Terrarium tile 下載失敗：' + last);
}

function writeAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp-' + process.pid;
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, path);
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}

function tilePath(z, x, y) {
  return posix.join('tiles', z + '_' + x + '_' + y + '.png');
}

function sampleMosaic(mosaic, bounds, lat, lng) {
  const fx0 = (lon2tx(lng, bounds.z) - bounds.tx0) * 256;
  const fy0 = (lat2ty(lat, bounds.z) - bounds.ty0) * 256;
  const x0 = Math.max(0, Math.min(mosaic.w - 2, Math.floor(fx0)));
  const y0 = Math.max(0, Math.min(mosaic.h - 2, Math.floor(fy0)));
  const fx = Math.max(0, Math.min(1, fx0 - x0));
  const fy = Math.max(0, Math.min(1, fy0 - y0));
  const at = (x, y) => mosaic.values[y * mosaic.w + x];
  return at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy)
    + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
}

function makeMosaic(tiles, bounds) {
  const w = bounds.cols * 256;
  const values = new Float32Array(w * bounds.rows * 256);
  for (const { x, y, image } of tiles) {
    for (let py = 0; py < 256; py++) {
      for (let px = 0; px < 256; px++) {
        const source = (py * image.w + px) * image.bpp;
        const value = image.data[source] * 256 + image.data[source + 1]
          + image.data[source + 2] / 256 - 32768;
        values[(y - bounds.ty0) * 256 * w + py * w + (x - bounds.tx0) * 256 + px] = value;
      }
    }
  }
  return { w, h: bounds.rows * 256, values };
}

function normalizeVenue(venue) {
  if (!venue) return null;
  return {
    id: venue.id || null,
    name: venue.name || null,
    type: venue.type || null,
    country: venue.country || null,
  };
}

function gridStats(values) {
  let min = Infinity, max = -Infinity, sum = 0;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
  }
  return { minM: min, maxM: max, meanM: sum / values.length };
}

/** 捕獲一份真實 AWS Terrarium 高程 fixture；任何來源失敗都直接 throw。 */
export async function captureElevationFixture({
  name,
  venue = null,
  team,
  bbox,
  center,
  bounds = null,
  outputDir = DEFAULT_ELEVATION_DIR,
  timeoutMs = 45000,
  update = false,
}) {
  if (!fixtureNameOf(name)) throw new Error('name 只能含英數、底線與連字號');
  if (!bbox || !Number.isFinite(bbox.minLat) || !Number.isFinite(bbox.minLng)
    || !Number.isFinite(bbox.maxLat) || !Number.isFinite(bbox.maxLng)
    || bbox.maxLat <= bbox.minLat || bbox.maxLng <= bbox.minLng) {
    throw new Error('bbox 無效');
  }
  if (!center || !['lat', 'lng', 'rot'].every((key) => Number.isFinite(Number(center[key])))) {
    throw new Error('center 無效');
  }
  if (!Number.isInteger(Number(team)) || Number(team) < 1 || Number(team) > 5) {
    throw new Error('team 必須是 1 到 5');
  }
  const dir = resolve(outputDir);
  const path = elevationFixturePath(name, dir);
  if (!path) throw new Error('高程 fixture 路徑無效');
  if (existsSync(path) && !update) {
    throw new Error('高程 fixture 已存在：' + path + '；需要覆寫時加 --update');
  }

  const tileBoundsInfo = tileBounds(bbox, TERRAIN.ELEV_ZOOM);
  const tiles = [];
  for (let y = tileBoundsInfo.ty0; y <= tileBoundsInfo.ty1; y++) {
    for (let x = tileBoundsInfo.tx0; x <= tileBoundsInfo.tx1; x++) {
      const url = TERRARIUM_URL(TERRAIN.ELEV_ZOOM, x, y);
      const buf = await fetchTile(url, timeoutMs);
      const image = decodePng(buf);
      const relative = tilePath(TERRAIN.ELEV_ZOOM, x, y);
      writeAtomic(join(dir, relative), buf);
      tiles.push({
        z: TERRAIN.ELEV_ZOOM, x, y, path: relative, url,
        sha256: sha256(buf), bytes: buf.length, width: image.w, height: image.h,
      });
    }
  }

  const mosaic = makeMosaic(tiles.map((tile) => ({
    ...tile, image: decodePng(readFileSync(join(dir, tile.path))),
  })), tileBoundsInfo);
  const gridBounds = bounds || elevationWorldBounds(bbox, center);
  if (!gridBounds || !['minX', 'maxX', 'minZ', 'maxZ'].every((key) => Number.isFinite(gridBounds[key]))) {
    throw new Error('高程網格 bounds 無效');
  }
  const values = new Float32Array(ELEVATION_GRID_N * ELEVATION_GRID_N);
  for (let i = 0; i < ELEVATION_GRID_N; i++) {
    const z = gridBounds.minZ + (gridBounds.maxZ - gridBounds.minZ) * i / (ELEVATION_GRID_N - 1);
    for (let j = 0; j < ELEVATION_GRID_N; j++) {
      const x = gridBounds.minX + (gridBounds.maxX - gridBounds.minX) * j / (ELEVATION_GRID_N - 1);
      const [lat, lng] = xzToLL(x, z, center);
      const value = sampleMosaic(mosaic, tileBoundsInfo, lat, lng);
      if (!Number.isFinite(value)) throw new Error('高程取樣非有限值:i=' + i + ',j=' + j);
      values[i * ELEVATION_GRID_N + j] = value;
    }
  }
  const capturedAt = new Date().toISOString();
  const gridSha256 = sha256(Buffer.from(values.buffer));
  const fixture = {
    version: ELEVATION_FIXTURE_VERSION,
    schema: ELEVATION_FIXTURE_SCHEMA,
    name,
    osmFixture: name,
    venue: normalizeVenue(venue),
    team: Number(team),
    center,
    bbox,
    capturedAt,
    source: {
      provider: TERRARIUM_PROVIDER,
      encoding: TERRARIUM_ENCODING,
      zoom: TERRAIN.ELEV_ZOOM,
      urlTemplate: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
      userAgent: UA,
      capturedAt,
      tiles,
    },
    grid: {
      width: ELEVATION_GRID_N,
      height: ELEVATION_GRID_N,
      axis: 'world-z-x',
      interpolation: 'two-triangle',
      sample: 'xzToLL → Terrarium bilinear at runtime world grid',
      valueType: 'float32',
      digestAlgorithm: 'sha256-float32-le',
      sha256: gridSha256,
      bounds: gridBounds,
      values: Array.from(values),
    },
    stats: {
      ...gridStats(values),
      points: values.length,
      tileCount: tiles.length,
    },
  };
  writeAtomic(path, JSON.stringify(fixture, null, 2) + '\n');
  return { path, fixture };
}
