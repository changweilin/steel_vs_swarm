#!/usr/bin/env node
/**
 * 將未分類母照片、YOLO26 schema-v2 證據與 Luna 功能分類綁成同一份穩定清單。
 *
 * 來源檔不搬動；身份由 corpus + source.image 決定。這避免移動照片後讓來源帳、人眼判決與
 * YOLO target id 斷線，也讓缺少 YOLO26 快取明確呈現為 missing 而非靜默略過。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../audit_src.mjs';
import {
  CLASSIFICATION_SCHEMA_VERSION,
  validateClassification,
} from './object_classification_policy.mjs';

export const CORPORA = Object.freeze({
  primary: Object.freeze({
    id: 'primary',
    photos: 'C:\\Users\\user\\Documents\\steel_vs_swarm\\tools\\ai3d\\photos',
  }),
  restricted: Object.freeze({
    id: 'restricted',
    photos: 'C:\\Users\\user\\Documents\\study\\ai3d_restricted\\photos',
  }),
});

export const CLASSIFICATION_DIR = path.join(ROOT, 'tools', 'ai3d', 'object_classifications');
export const MANIFEST_PATH = path.join(ROOT, 'tools', 'ai3d', 'object_classification_manifest.json');
export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
const DEFAULT_SUBPART = Object.freeze({ building: 'mass', ship: 'hull', tree: 'canopy' });
const textCmp = (a, b) => String(a).localeCompare(String(b), 'en');
const posix = (value) => String(value).replace(/\\/g, '/');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function atomicJson(file, value) {
  const temp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temp, json(value), 'utf8');
  fs.renameSync(temp, file);
}

function directImages(corpus, family) {
  const dir = path.join(corpus.photos, family);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && IMAGE_EXTS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => ({
      id: `${corpus.id}:${family}/${entry.name}`,
      corpus: corpus.id,
      family,
      image: `${family}/${entry.name}`,
      fullPath: path.join(dir, entry.name),
    }))
    .sort((a, b) => textCmp(a.image, b.image));
}

function classificationDocs() {
  if (!fs.existsSync(CLASSIFICATION_DIR)) return [];
  return fs.readdirSync(CLASSIFICATION_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => ({ file: path.join(CLASSIFICATION_DIR, entry.name), doc: readJson(path.join(CLASSIFICATION_DIR, entry.name)) }));
}

function featureCandidates(source) {
  const stem = path.parse(source.image).name;
  const subpart = DEFAULT_SUBPART[source.family] || 'main';
  return [
    path.join(ROOT, 'out', 'yolo_features', source.corpus, source.family, subpart, `${stem}.json`),
    path.join(ROOT, 'out', 'yolo_features', source.family, subpart, `${stem}.json`),
  ];
}

function relativeOutput(file) {
  const relative = path.relative(ROOT, file);
  return relative.startsWith('..') ? posix(path.resolve(file)) : posix(relative);
}

function pairedEvidence(source) {
  const sourceFullPath = path.resolve(source.fullPath);
  for (const featureFile of featureCandidates(source)) {
    if (!fs.existsSync(featureFile)) continue;
    const feature = readJson(featureFile);
    if (!feature || feature.schemaVersion !== 2) continue;
    const declaredFullPath = feature.sourceFullPath ? path.resolve(feature.sourceFullPath) : null;
    if (declaredFullPath && declaredFullPath.toLowerCase() !== sourceFullPath.toLowerCase()) continue;
    if (!declaredFullPath && posix(feature.sourceImage).toLowerCase() !== source.image.toLowerCase()) continue;
    return {
      status: 'present',
      schemaVersion: feature.schemaVersion,
      featureFile: relativeOutput(featureFile),
      sourceImage: feature.sourceImage,
      targets: (feature.targets || []).map((target) => ({
        targetId: target.targetId,
        className: target.className,
        targetFile: target.targetFile || null,
        maskFile: target.maskFile || null,
      })),
      depthFile: feature.depth?.rawFile || null,
      depthPreviewFile: feature.depth?.previewFile || null,
    };
  }
  return {
    status: 'missing',
    expectedFeatureFile: relativeOutput(featureCandidates(source)[0]),
    expectedLegacyFeatureFile: relativeOutput(featureCandidates(source)[1]),
  };
}

export function buildClassificationManifest() {
  const docs = classificationDocs();
  const issues = [];
  const classified = new Map();
  for (const { file, doc } of docs) {
    if (!doc || doc.schemaVersion !== CLASSIFICATION_SCHEMA_VERSION || !Array.isArray(doc.items)) {
      issues.push(`${path.relative(ROOT, file)}：schemaVersion/items 無效`);
      continue;
    }
    if (doc.classifier?.model !== 'gpt-5.6-luna' || doc.classifier?.reasoningEffort !== 'max') {
      issues.push(`${path.relative(ROOT, file)}：分類器必須是 gpt-5.6-luna/max`);
    }
    for (const row of doc.items) {
      const rowIssues = validateClassification(row);
      for (const issue of rowIssues) issues.push(`${row?.id || '?'}：${issue}`);
      if (row.family !== doc.family) issues.push(`${row?.id || '?'}：family 與分類檔不一致`);
      if (classified.has(row.id)) issues.push(`${row.id}：分類重複`);
      classified.set(row.id, row);
    }
  }

  const inventory = [];
  for (const corpus of Object.values(CORPORA)) {
    if (!fs.existsSync(corpus.photos)) {
      issues.push(`${corpus.id}：照片根目錄不存在 ${corpus.photos}`);
      continue;
    }
    for (const entry of fs.readdirSync(corpus.photos, { withFileTypes: true }).filter((row) => row.isDirectory())) {
      inventory.push(...directImages(corpus, entry.name));
    }
  }
  inventory.sort((a, b) => textCmp(a.id, b.id));
  const sourceIds = new Set(inventory.map((row) => row.id));
  for (const id of classified.keys()) if (!sourceIds.has(id)) issues.push(`${id}：分類沒有對應的直屬來源照片`);

  const items = inventory.map((source) => {
    const classification = classified.get(source.id) || null;
    if (!classification) issues.push(`${source.id}：未分類`);
    return {
      id: source.id,
      source: { corpus: source.corpus, image: source.image },
      classification,
      yolo26: pairedEvidence(source),
    };
  });

  const byFamily = {};
  for (const row of items) {
    const family = row.source.image.split('/')[0];
    const stats = byFamily[family] ||= { sources: 0, classified: 0, yolo26: 0, needsDecomposition: 0 };
    stats.sources++;
    stats.classified += Number(Boolean(row.classification));
    stats.yolo26 += Number(row.yolo26.status === 'present');
    stats.needsDecomposition += Number(row.classification?.decompositionStatus === 'needs_decomposition');
  }
  return {
    schemaVersion: CLASSIFICATION_SCHEMA_VERSION,
    policy: {
      identity: 'corpus + source.image',
      pairing: 'YOLO26 sourceFullPath；舊快取僅在來源完全相符時採用',
      sourceMutation: 'none',
      replacementBasis: 'object function + real part function; never appearance',
    },
    counts: {
      sources: items.length,
      classified: items.filter((row) => row.classification).length,
      yolo26: items.filter((row) => row.yolo26.status === 'present').length,
      needsDecomposition: items.filter((row) => row.classification?.decompositionStatus === 'needs_decomposition').length,
      issues: issues.length,
    },
    byFamily,
    issues: issues.sort(textCmp),
    items,
  };
}

function main() {
  const manifest = buildClassificationManifest();
  if (process.argv.includes('--write')) atomicJson(MANIFEST_PATH, manifest);
  console.log(`功能分類：${manifest.counts.classified}/${manifest.counts.sources}；YOLO26 配對：${manifest.counts.yolo26}；待拆件：${manifest.counts.needsDecomposition}`);
  if (manifest.issues.length) for (const issue of manifest.issues) console.error(`  ✗ ${issue}`);
  if (process.argv.includes('--check') && manifest.issues.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
