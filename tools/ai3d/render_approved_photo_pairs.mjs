import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DEFAULT_PYTHON = 'C:\\Users\\user\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe';
const SOURCE_ROOTS = [
  path.join('C:\\Users\\user\\Documents\\steel_vs_swarm', 'tools', 'ai3d', 'photos'),
  path.join('C:\\Users\\user\\Documents\\study\\ai3d_restricted', 'photos'),
];
const OUTPUT_ROOT = path.join(ROOT, 'out', 'review_previews', 'approved_photo_pairs');
const DB_PATH = path.join(ROOT, 'out', '3d_database.json');
const STATE_PATH = path.join(ROOT, 'tools', 'parts_review', 'state.json');
const PREVIEW_RENDERER = path.join(HERE, 'render_poly_preview.py');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseArgs(argv) {
  const options = { python: DEFAULT_PYTHON, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--python') options.python = argv[++i];
    else if (argv[i] === '--force') options.force = true;
  }
  return options;
}

function imagePath(image) {
  if (typeof image !== 'string' || !image) return null;
  const parts = image.split(/[\\/]+/).filter(Boolean);
  for (const root of SOURCE_ROOTS) {
    const candidate = path.join(root, ...parts);
    if (fs.existsSync(candidate)) return path.resolve(candidate);
  }
  return null;
}

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 220);
}

function candidateInventory(reportPath) {
  if (!fs.existsSync(reportPath)) return [];
  const report = readJson(reportPath);
  return (report.candidates || [])
    .filter((row) => row && row.evidenceOverride === 'llm_visual_direct')
    .map((row) => ({
      key: row.key || null,
      targetId: row.targetId || row.target || null,
      family: row.family || null,
      subpart: row.subpart || null,
      image: row.image || null,
      sourcePhoto: imagePath(row.image),
      preview: row.preview ? path.resolve(ROOT, row.preview) : null,
      status: row.status || null,
      eligible: row.eligible === true,
      pipelineEligibility: row.pipelineEligibility || null,
    }));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const database = readJson(DB_PATH);
  const review = readJson(STATE_PATH);
  const reviewItems = review.items || {};
  const records = Array.isArray(database.items) ? database.items : [];
  const approved = [];
  const missing = [];
  const familyTotals = {};

  for (const record of records) {
    if (!['building', 'vehicle', 'ship'].includes(record.family) || !record.image) continue;
    familyTotals[record.family] = (familyTotals[record.family] || 0) + 1;
    const reviewRow = reviewItems[record.key];
    if (reviewRow?.status !== 'ok') {
      missing.push({ key: record.key, family: record.family, reason: 'human_review_not_ok', status: reviewRow?.status || null });
      continue;
    }
    const sourcePhoto = imagePath(record.image);
    const modelPath = path.join(ROOT, record.outputDir || '', 'model.json');
    if (!sourcePhoto) {
      missing.push({ key: record.key, family: record.family, reason: 'source_photo_missing', image: record.image });
      continue;
    }
    if (!fs.existsSync(modelPath)) {
      missing.push({ key: record.key, family: record.family, reason: 'model_json_missing', modelPath });
      continue;
    }

    const previewName = `${safeName(record.key)}.png`;
    const previewPath = path.join(OUTPUT_ROOT, previewName);
    fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
    if (options.force || !fs.existsSync(previewPath)) {
      execFileSync(options.python, [PREVIEW_RENDERER, modelPath, previewPath], {
        cwd: ROOT,
        stdio: 'inherit',
        timeout: 30_000,
      });
    }
    approved.push({
      key: record.key,
      id: record.id,
      family: record.family,
      subpart: record.subpart,
      version: record.version,
      image: record.image,
      sourcePhoto,
      modelPath: path.resolve(modelPath),
      previewPath: path.resolve(previewPath),
      reviewStatus: reviewRow.status,
      reviewedAt: reviewRow.at || null,
      method: record.method || null,
      bounds: record.bounds || null,
    });
  }

  const lunaDirect = [
    'tree_luna_v6_candidates.json',
    'vehicle_luna_v6_candidates.json',
  ].flatMap((name) => candidateInventory(path.join(ROOT, 'out', 'review_previews', name)));
  const byFamily = (rows) => rows.reduce((out, row) => {
    out[row.family] = (out[row.family] || 0) + 1;
    return out;
  }, {});

  const manifest = {
    generatedAt: new Date().toISOString(),
    selection: 'database record + parts_review/state.json status=ok + source photo + model.json',
    fixedViews: ['FRONT 3/4', 'SIDE +Z', 'FRONT', 'SIDE -Z', 'REAR'],
    mutationPolicy: 'render-only; database, manifest and human review state are unchanged',
    approvedPhotoPairs: approved,
    missingOrNotApproved: missing,
    counts: {
      databaseRecordsWithPhotos: familyTotals,
      renderedApprovedPhotoPairs: byFamily(approved),
      renderedTotal: approved.length,
      missingOrNotApproved: missing.length,
      lunaDirectV6Candidates: byFamily(lunaDirect),
      lunaDirectV6Total: lunaDirect.length,
    },
    lunaDirectV6: lunaDirect,
  };
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({
    rendered: approved.length,
    renderedByFamily: byFamily(approved),
    missingOrNotApproved: missing.length,
    lunaDirectV6: byFamily(lunaDirect),
    output: path.resolve(OUTPUT_ROOT),
  }, null, 2));
}

main();
