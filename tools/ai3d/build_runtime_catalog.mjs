import fs from 'node:fs';
import path from 'node:path';
import { buildRuntimeCatalog, REPO_ROOT } from './runtime_catalog.mjs';

const OUTPUT_PATH = path.join(REPO_ROOT, 'public/js/runtimeParts.js');

function stableJson(value, compact = false) {
  return JSON.stringify(value, null, compact ? 0 : 2);
}

function moduleSource(catalog) {
  const meta = {
    schemaVersion: catalog.schemaVersion,
    policy: catalog.policy,
    generatedFrom: catalog.generatedFrom,
    counts: catalog.counts,
    versions: catalog.versions,
  };
  return `// 本檔由 tools/ai3d/build_runtime_catalog.mjs 決定性產生，請勿手改。\n`
    + `export const RUNTIME_PARTS_META = Object.freeze(${stableJson(meta)});\n\n`
    + `export const RUNTIME_PARTS = Object.freeze(${stableJson(catalog.families, true)});\n\n`
    + `export const BUILDING_PARTS = RUNTIME_PARTS.building || Object.freeze([]);\n`
    + `export const VEHICLE_PARTS = RUNTIME_PARTS.vehicle || Object.freeze([]);\n`;
}

function report(catalog) {
  console.log(`執行期零件：${Object.values(catalog.counts).reduce((sum, count) => sum + count, 0)} 件`);
  for (const [family, count] of Object.entries(catalog.counts)) console.log(`  ${family}: ${count}`);
  console.log(`版本：${Object.entries(catalog.versions).map(([version, count]) => `${version}=${count}`).join(', ')}`);
  const reasons = {};
  for (const row of catalog.excluded) reasons[row.reason] = (reasons[row.reason] || 0) + 1;
  console.log(`排除：${catalog.excluded.length} 筆`);
  for (const [reason, count] of Object.entries(reasons).sort()) console.log(`  ${reason}: ${count}`);
}

const catalog = buildRuntimeCatalog();
const source = moduleSource(catalog);
const check = process.argv.includes('--check');
const verbose = process.argv.includes('--report') || check;

if (check) {
  const current = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, 'utf8') : '';
  if (current !== source) {
    console.error('runtimeParts.js 不是最新決定性輸出；請執行 node tools/ai3d/build_runtime_catalog.mjs');
    process.exitCode = 1;
  }
} else {
  fs.writeFileSync(OUTPUT_PATH, source, 'utf8');
}

if (verbose) report(catalog);
