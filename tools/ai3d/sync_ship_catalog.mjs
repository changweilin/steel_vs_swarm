#!/usr/bin/env node
/** 將既有 ship v6 多面體依母照片去重後，併回零件台的資料庫與來源帳。 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ROOT } from '../audit_src.mjs';

const SHIP_DIR = join(ROOT, 'out', '3d_data', 'ship', 'hull');
const DB_PATH = join(ROOT, 'out', '3d_database.json');
const MANIFEST_PATH = join(ROOT, 'tools', 'ai3d', 'parts_manifest.json');

const readJson = (path, fallback) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return fallback; }
};

const writeJson = (path, value) => {
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temp, path);
};

const score = (row) => Number.isFinite(Number(row.meta.similarityScore))
  ? Number(row.meta.similarityScore)
  : -1;

const candidates = [];
if (existsSync(SHIP_DIR)) {
  for (const name of readdirSync(SHIP_DIR).sort()) {
    if (!name.endsWith('_v6')) continue;
    const dir = join(SHIP_DIR, name);
    const meta = readJson(join(dir, 'metadata.json'), null);
    if (!meta?.key || meta.version !== 6 || !meta.source_image) continue;
    if (!existsSync(join(dir, 'model.json'))) continue;
    candidates.push({ name, dir, meta });
  }
}

const bestBySource = new Map();
for (const row of candidates) {
  const current = bestBySource.get(row.meta.source_image);
  if (!current || score(row) > score(current)
    || (score(row) === score(current) && row.meta.key.localeCompare(current.meta.key) < 0)) {
    bestBySource.set(row.meta.source_image, row);
  }
}

const selected = [...bestBySource.values()].sort((a, b) => a.meta.source_image.localeCompare(b.meta.source_image));
const db = readJson(DB_PATH, { version: 6, verStr: 'v6', items: [] });
const keptDb = (db.items || []).filter((row) => row.family !== 'ship');
const shipDb = selected.map(({ dir, meta }) => ({
  id: meta.id,
  key: meta.key,
  family: 'ship',
  subpart: meta.subpart || 'hull',
  style: meta.style || 'ship',
  symmetryMode: meta.symmetryMode || 'symmetric',
  similarityScore: meta.similarityScore ?? null,
  version: 6,
  verStr: 'v6',
  image: meta.source_image,
  bounds: meta.bounds,
  spec: meta.spec || { style: meta.style || 'ship' },
  triangles: meta.bounds?.triangles || 0,
  outputDir: relative(ROOT, dir).replace(/\\/g, '/'),
}));
db.items = [...keptDb, ...shipDb];
db.total_objects = db.items.length;
db.families = [...new Set(db.items.map((row) => row.family))].sort();
db.generated_at = new Date().toISOString();
writeJson(DB_PATH, db);

const manifest = readJson(MANIFEST_PATH, { version: 1, parts: [] });
const keptParts = (manifest.parts || []).filter((row) => {
  const keys = row.keys || (row.key ? [row.key] : []);
  return !keys.some((key) => key.startsWith('ship/'));
});
const shipParts = selected.map(({ meta }) => {
  const imageId = createHash('sha1').update(meta.source_image).digest('hex').slice(0, 8);
  return {
    method: 'gemini_v6',
    version: 6,
    verStr: 'v6',
    consumer: 'ship catalog & partlib (hull)',
    rev: 'HEAD',
    at: String(meta.created_at || '').slice(0, 10) || null,
    imgs: [{
      role: 'primary',
      id: `img_${imageId}`,
      family: 'ship',
      part: 'hull',
      query: meta.source_image.split('/').pop(),
      api: 'gemini_v6',
      license: 'unverified(restricted/local)',
      creator: null,
      source_url: '',
      file: meta.source_image,
    }],
    gen: {
      tool: 'Gemini v6 Polyhedral Reconstruction',
      runner: 'tools/ai3d/direct_ingest_v6.mjs',
      params: '--family ship',
      machine: 'Gemini API',
      measured: `Triangles ${meta.bounds?.triangles || 0}, Vertices ${meta.bounds?.vertices || 0}, Similarity ${meta.similarityScore ?? '未記載'}/100`,
    },
    post: {
      tool: 'tools/ai3d/direct_ingest_v6.mjs',
      fit: 1,
      bounds: meta.bounds?.size || [1, 1, 1],
    },
    keys: [meta.key],
  };
});
manifest.parts = [...keptParts, ...shipParts];
writeJson(MANIFEST_PATH, manifest);

console.log(`ship v6 候選 ${candidates.length} 件；母照片 ${selected.length} 張；重複裁切淘汰 ${candidates.length - selected.length} 件。`);
