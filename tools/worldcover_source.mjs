// Narrow reader for ESA WorldCover v200: tiled, little-endian, uint8 Deflate GeoTIFF.
// Only required source blocks are fetched. Unsupported products fail before publication.
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/';
export const WORLDCOVER_SOURCE = {
  provider: 'ESA WorldCover', product: '2021-v200', nativeResolutionM: 10,
  license: 'CC-BY-4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  attribution: '© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium',
  sourceUrl: 'https://esa-worldcover.org/en/data-access',
};
const hash = data => createHash('sha256').update(data).digest('hex');

async function range(url, start, length, path) {
  if (existsSync(path)) {
    const data = readFileSync(path);
    if (data.length === length) return data;
  }
  const response = await fetch(url, {
    headers: { Range: `bytes=${start}-${start + length - 1}` }, signal: AbortSignal.timeout(30000),
  });
  if (response.status !== 206 || !response.headers.get('content-range')?.startsWith(`bytes ${start}-`)) {
    throw new Error(`WorldCover range rejected: ${response.status}`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length !== length) throw new Error('Truncated WorldCover range');
  writeFileSync(path, data);
  return data;
}

function metadata(bytes) {
  if (bytes.toString('ascii', 0, 2) !== 'II' || bytes.readUInt16LE(2) !== 42) throw new Error('Unsupported WorldCover TIFF');
  const offset = bytes.readUInt32LE(4), count = bytes.readUInt16LE(offset), tags = new Map();
  if (count > 128 || offset + 2 + count * 12 + 4 > bytes.length) throw new Error('Invalid WorldCover directory');
  for (let i = 0; i < count; i++) {
    const p = offset + 2 + i * 12, tag = bytes.readUInt16LE(p), type = bytes.readUInt16LE(p + 2);
    const n = bytes.readUInt32LE(p + 4), width = ({ 2: 1, 3: 2, 4: 4, 12: 8 })[type];
    if (!width) continue;
    const at = n * width <= 4 ? p + 8 : bytes.readUInt32LE(p + 8);
    if (n > 100000 || at + n * width > bytes.length) throw new Error('WorldCover metadata exceeds header');
    const values = [];
    for (let j = 0; j < n; j++) values.push(type === 12 ? bytes.readDoubleLE(at + j * width)
      : type === 4 ? bytes.readUInt32LE(at + j * width) : type === 3 ? bytes.readUInt16LE(at + j * width) : bytes[at + j]);
    tags.set(tag, values);
  }
  const one = tag => tags.get(tag)?.[0];
  if (one(258) !== 8 || one(259) !== 8 || one(277) !== 1 || (one(317) ?? 1) !== 1 || one(339) !== 1) {
    throw new Error('WorldCover requires unsigned uint8 Deflate without predictor');
  }
  const width = one(256), height = one(257), tileW = one(322), tileH = one(323);
  const offsets = tags.get(324), lengths = tags.get(325), scale = tags.get(33550), origin = tags.get(33922);
  const keys = tags.get(34735) || [];
  let geographic = false;
  for (let i = 4; i + 3 < keys.length; i += 4) if (keys[i] === 2048 && keys[i + 1] === 0 && keys[i + 3] === 4326) geographic = true;
  if (!geographic || !scale || !origin || origin[0] !== 0 || origin[1] !== 0
    || !(scale[0] > 0 && scale[1] > 0) || !(width > 0 && height > 0)
    || !(tileW > 0 && tileH > 0 && tileW * tileH <= 1048576)
    || offsets?.length !== Math.ceil(width / tileW) * Math.ceil(height / tileH) || offsets.length !== lengths?.length) {
    throw new Error('Invalid WorldCover raster layout');
  }
  return { width, height, tileW, tileH, offsets, lengths, dx: scale[0], dy: scale[1], west: origin[3], north: origin[4] };
}

/** Return a cropped numeric class raster; geographic pixels retain their source lattice. */
export async function captureWorldCover(bbox, cacheDir) {
  if (!bbox || ![bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng].every(Number.isFinite)
    || bbox.minLat >= bbox.maxLat || bbox.minLng >= bbox.maxLng || bbox.minLat < -85 || bbox.maxLat > 85
    || bbox.minLng < -180 || bbox.maxLng > 180
    || (bbox.maxLat - bbox.minLat) * (bbox.maxLng - bbox.minLng) * 12000 ** 2 > 4000000) {
    throw new Error('Invalid or oversized WorldCover crop');
  }
  mkdirSync(cacheDir, { recursive: true });
  const sources = [], tiles = new Map();
  for (let lat = Math.floor(bbox.minLat / 3) * 3; lat <= Math.floor(bbox.maxLat / 3) * 3; lat += 3) {
    for (let lng = Math.floor(bbox.minLng / 3) * 3; lng <= Math.floor(bbox.maxLng / 3) * 3; lng += 3) {
      const name = `ESA_WorldCover_10m_2021_v200_${lat < 0 ? 'S' : 'N'}${String(Math.abs(lat)).padStart(2, '0')}${lng < 0 ? 'W' : 'E'}${String(Math.abs(lng)).padStart(3, '0')}_Map.tif`;
      const url = BASE + name, header = await range(url, 0, 65536, join(cacheDir, name + '.header'));
      const m = metadata(header), blocks = new Map();
      const x0 = Math.max(0, Math.floor((bbox.minLng - m.west) / m.dx));
      const x1 = Math.min(m.width - 1, Math.ceil((bbox.maxLng - m.west) / m.dx));
      const y0 = Math.max(0, Math.floor((m.north - bbox.maxLat) / m.dy));
      const y1 = Math.min(m.height - 1, Math.ceil((m.north - bbox.minLat) / m.dy));
      const blockDigests = [];
      for (let y = Math.floor(y0 / m.tileH); y <= Math.floor(y1 / m.tileH); y++) {
        for (let x = Math.floor(x0 / m.tileW); x <= Math.floor(x1 / m.tileW); x++) {
          const k = y * Math.ceil(m.width / m.tileW) + x, length = m.lengths[k];
          if (!(length > 0 && length <= 4194304)) throw new Error('Invalid WorldCover block size');
          const compressed = await range(url, m.offsets[k], length, join(cacheDir, name + '.' + k));
          const raw = inflateSync(compressed, { maxOutputLength: m.tileW * m.tileH });
          if (raw.length !== m.tileW * m.tileH) throw new Error('Invalid WorldCover block pixels');
          blocks.set(k, raw); blockDigests.push([k, hash(compressed)]);
        }
      }
      sources.push({ itemId: name, url, headerDigest: hash(header), blocks: blockDigests });
      tiles.set(`${lat},${lng}`, { ...m, blocks });
    }
  }
  const m = tiles.values().next().value, dx = m.dx, dy = m.dy;
  const west = Math.floor(bbox.minLng / dx) * dx, north = Math.ceil(bbox.maxLat / dy) * dy;
  const cols = Math.ceil((bbox.maxLng - west) / dx), rows = Math.ceil((north - bbox.minLat) / dy);
  if (!(cols > 0 && rows > 0 && cols * rows <= 4000000)) throw new Error('WorldCover crop exceeds budget');
  const data = Buffer.alloc(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const lat = north - (j + 0.5) * dy, lng = west + (i + 0.5) * dx;
    const tile = tiles.get(`${Math.floor(lat / 3) * 3},${Math.floor(lng / 3) * 3}`);
    if (!tile) throw new Error('WorldCover crop missing source tile');
    const x = Math.floor((lng - tile.west) / tile.dx), y = Math.floor((tile.north - lat) / tile.dy);
    const k = Math.floor(y / tile.tileH) * Math.ceil(tile.width / tile.tileW) + Math.floor(x / tile.tileW);
    const block = tile.blocks.get(k);
    if (!block) throw new Error('WorldCover crop missing source block');
    data[j * cols + i] = block[(y % tile.tileH) * tile.tileW + x % tile.tileW];
  }
  return { schema: 1, source: { ...WORLDCOVER_SOURCE, items: sources }, grid: { west, north, dx, dy, cols, rows },
    encoding: 'uint8-base64', digest: hash(data), data: data.toString('base64') };
}
