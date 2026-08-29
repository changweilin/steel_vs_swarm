#!/usr/bin/env node
/** 將 Luna 純雲 v6 候選對帳至型錄；不修改任何人審狀態。 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const REPORT_PATH = join(ROOT, 'out', 'review_previews', 'cloud_luna_v6_candidates.json');
const DB_PATH = join(ROOT, 'out', '3d_database.json');
const MANIFEST_PATH = join(HERE, 'parts_manifest.json');
const PHOTO_MANIFEST_PATH = join(HERE, 'photo_manifest.json');
const METHOD = 'gpt-5.6-luna_visual_direct';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}

function stableTarget(key = '') {
  return key.replace(/_[0-9a-f]{8}_luna_v6$/, '');
}

function main() {
  for (const path of [REPORT_PATH, DB_PATH, MANIFEST_PATH, PHOTO_MANIFEST_PATH]) {
    if (!existsSync(path)) throw new Error(`缺少對帳輸入: ${path}`);
  }
  const report = readJson(REPORT_PATH);
  if (report.model !== 'gpt-5.6-luna' || report.generationTag !== 'luna 直接 v6') {
    throw new Error('候選報告不是 luna 直接 v6');
  }
  const accepted = (report.candidates || []).filter((row) => row.status === 'awaiting_human_review');
  if (accepted.length !== 5 || accepted.some((row) => row.eligible !== false)) {
    throw new Error('純雲候選必須恰為 5 件，且全部 eligible=false');
  }
  const targets = new Set(accepted.map((row) => row.target));
  const photos = readJson(PHOTO_MANIFEST_PATH).filter((row) => row.family === 'cloud' && row.ok);
  const photoByPart = new Map(photos.map((row) => [row.part, row]));
  if (photoByPart.size !== 5) throw new Error('純雲照片來源帳必須恰為 5 種');

  const db = readJson(DB_PATH);
  db.items = (db.items || []).filter((row) => !(row.method === METHOD && targets.has(stableTarget(row.key))));
  for (const row of accepted) {
    db.items.push({
      id: row.targetId,
      key: row.key,
      family: 'cloud',
      subpart: row.subpart,
      style: row.style,
      silhouette: row.silhouette,
      symmetryMode: 'asymmetric',
      similarityScore: row.similarityReview.similarityScore,
      version: 6,
      verStr: 'v6',
      method: METHOD,
      generationTag: 'luna 直接 v6',
      status: 'awaiting_human_review',
      image: row.image,
      evidenceStatus: row.evidenceStatus,
      eligible: false,
      pipelineEligibility: 'awaiting_human_review',
      bounds: row.bounds,
      spec: { style: row.style },
      triangles: row.triangles,
      outputDir: row.outputDir,
      preview: row.preview,
    });
  }
  db.generated_at = new Date().toISOString();
  db.total_objects = db.items.length;
  db.families = [...new Set(db.items.map((row) => row.family))];
  writeJsonAtomic(DB_PATH, db);

  const manifest = readJson(MANIFEST_PATH);
  manifest.parts = (manifest.parts || []).filter((entry) => {
    const keys = entry.keys || (entry.key ? [entry.key] : []);
    return !(entry.method === METHOD && keys.some((key) => targets.has(stableTarget(key))));
  });
  for (const row of accepted) {
    const photo = photoByPart.get(row.subpart);
    const hash = row.key.match(/_([0-9a-f]{8})_luna_v6$/)?.[1] || '00000000';
    manifest.parts.push({
      method: METHOD,
      version: 6,
      verStr: 'v6',
      consumer: `cloud catalog & partlib (${row.subpart})`,
      rev: 'HEAD',
      at: new Date().toISOString().slice(0, 10),
      imgs: [{
        role: 'primary', id: `img_${hash}`, family: 'cloud', part: row.subpart,
        query: photo.query, api: photo.api, license: photo.license, creator: photo.creator,
        source_url: photo.source_url, file: row.image,
      }],
      gen: {
        tool: 'GPT-5.6 Luna direct visual cloud reconstruction',
        runner: 'tools/ai3d/direct_ingest_luna_cloud_v6.mjs',
        params: '--retry 2',
        machine: 'Codex GPT-5.6 Luna',
        measured: `Parts ${row.parts}, Triangles ${row.triangles}, Vertices ${row.vertices}, Similarity ${row.similarityReview.similarityScore}/100`,
      },
      post: {
        tool: 'tools/ai3d/render_poly_preview.py', fit: 1, bounds: row.bounds.size,
        note: `純雲五視角；${row.evidenceStatus}，維持 awaiting_human_review。`,
      },
      keys: [row.key],
    });
  }
  writeJsonAtomic(MANIFEST_PATH, manifest);
  console.log(`已對帳 ${accepted.length} 件 luna 直接 v6 純雲候選；未修改 review state。`);
}

main();
