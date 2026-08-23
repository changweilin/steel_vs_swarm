#!/usr/bin/env node
/** 依穩定來源身分執行 v6 purge；預設只列計畫，加 --apply 才真刪。 */
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { ROOT } from '../audit_src.mjs';

const APPLY = process.argv.includes('--apply');
const FAMILY = (() => { const i = process.argv.indexOf('--family'); return i >= 0 ? process.argv[i + 1] : null; })();
const STATE = join(ROOT, 'tools', 'parts_review', 'state.json');
const DB = join(ROOT, 'out', '3d_database.json');
const MANIFEST = join(ROOT, 'tools', 'ai3d', 'parts_manifest.json');
const PURGE_LEDGER = join(ROOT, 'tools', 'ai3d', 'v6_purge_manifest.json');
const PHOTO_ROOTS = [
  'C:\\Users\\user\\Documents\\steel_vs_swarm\\tools\\ai3d\\photos',
  'C:\\Users\\user\\Documents\\study\\ai3d_restricted\\photos',
].map((path) => resolve(path));
const DATA_ROOTS = [
  join(ROOT, 'out', '3d_data'),
  'C:\\Users\\user\\Documents\\study\\ai3d_restricted\\out\\3d_data',
].map((path) => resolve(path));

const load = (path, fallback) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; } };
const stableOfKey = (key) => key.replace(/_[0-9a-f]{8}_v6$/, '');
const sourceStableOfKey = (key) => key.endsWith('_v6') ? stableOfKey(key).replace(/~\d+$/, '') : null;
const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const inside = (path, root) => {
  const rel = relative(root, path);
  return rel && !rel.startsWith('..') && !rel.includes(`..${process.platform === 'win32' ? '\\' : '/'}`);
};
const atomicJson = (path, value) => {
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temp, path);
};

function scanPhotos() {
  const map = new Map();
  for (const root of PHOTO_ROOTS) {
    if (!existsSync(root)) continue;
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (['.jpg', '.jpeg', '.png', '.webp', '.avif'].includes(extname(entry.name).toLowerCase())) {
          const rel = relative(root, full).replace(/\\/g, '/').split('/');
          if (rel.length < 3) continue;
          const stable = `${rel[0]}/${rel[1]}_${basename(entry.name, extname(entry.name))}`;
          const rows = map.get(stable) || [];
          rows.push(resolve(full));
          map.set(stable, rows);
        }
      }
    };
    walk(root);
  }
  return map;
}

function derivedPaths(stable, source) {
  const [family] = stable.split('/');
  const sourceRoot = PHOTO_ROOTS.find((root) => inside(source, root));
  const rel = relative(sourceRoot, source).replace(/\\/g, '/').split('/');
  const subpart = rel[1];
  const stem = basename(source, extname(source));
  const targetId = `${family}_${subpart}_${stem}_v6`.replace(/[^\w.-]+/g, '_');
  const paths = [source];
  for (const root of DATA_ROOTS) {
    const dir = join(root, family, subpart);
    if (!existsSync(dir)) continue;
    const prefix = `${family}_${subpart}_${stem}`.replace(/[^\w.-]+/g, '_');
    const familyOutput = new RegExp(`^${escapeRe(prefix)}(?:_\\d+)?_v6$`);
    for (const name of readdirSync(dir)) {
      if (familyOutput.test(name)) paths.push(join(dir, name));
    }
  }
  paths.push(join(ROOT, 'out', 'yolo_features', family, subpart, `${stem}.json`));
  paths.push(join(ROOT, 'out', 'yolo_depth', family, subpart, `${stem}.npy`));
  paths.push(join(ROOT, 'out', 'yolo_depth', family, subpart, `${stem}.png`));
  const previewDir = join(ROOT, 'out', 'review_previews');
  if (existsSync(previewDir)) {
    const prefix = targetId.replace(/_v6$/, '');
    for (const name of readdirSync(previewDir)) if (name.startsWith(prefix)) paths.push(join(previewDir, name));
  }
  for (const kind of ['targets', 'yolo_masks']) {
    const dir = join(ROOT, 'out', kind, family, subpart);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) if (name.startsWith(`${stem}~`)) paths.push(join(dir, name));
  }
  return [...new Set(paths.map((path) => resolve(path)))];
}

const state = load(STATE, { items: {} });
const database = load(DB, { items: [] });
const manifest = load(MANIFEST, { parts: [] });
const ledger = load(PURGE_LEDGER, { version: 1, targets: [] });
const photos = scanPhotos();
const todo = Object.entries(state.items || {}).filter(([key, verdict]) =>
  key.endsWith('_v6') && verdict?.status === 'purge' && (!FAMILY || key.startsWith(`${FAMILY}/`)));
const todoByStable = new Map(todo.map(([reviewKey, verdict]) => [stableOfKey(reviewKey), { reviewKey, verdict }]));
for (const row of ledger.targets || []) {
  if (!row?.stable || (FAMILY && !row.stable.startsWith(`${FAMILY}/`))) continue;
  if (!todoByStable.has(row.stable)) {
    todoByStable.set(row.stable, {
      reviewKey: row.reviewKey,
      verdict: { note: row.note },
      source: row.source,
    });
  }
}

const plan = [];
for (const [stable, row] of todoByStable) {
  const { reviewKey, verdict } = row;
  const sources = photos.get(stable) || [];
  const source = row.source ? resolve(row.source) : sources[0];
  if (!source || (!row.source && sources.length !== 1)) throw new Error(`${stable} 應對應恰一張來源圖，實得 ${sources.length}`);
  const paths = derivedPaths(stable, source);
  for (const path of paths) {
    const allowed = PHOTO_ROOTS.some((root) => inside(path, root))
      || DATA_ROOTS.some((root) => path === root || inside(path, root))
      || inside(path, join(ROOT, 'out'));
    if (!allowed) throw new Error(`拒絕刪除未驗證路徑: ${path}`);
  }
  plan.push({ reviewKey, stable, note: verdict.note || null, source, paths });
}

console.log(JSON.stringify({ apply: APPLY, count: plan.length, targets: plan.map(({ paths, ...row }) => ({ ...row, existingPaths: paths.filter(existsSync) })) }, null, 2));
if (!APPLY) process.exit(0);

for (const row of plan) {
  for (const path of row.paths) if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  for (const key of Object.keys(state.items || {})) {
    if (sourceStableOfKey(key) === row.stable) delete state.items[key];
  }
  ledger.targets = ledger.targets.filter((entry) => entry.stable !== row.stable);
  ledger.targets.push({ stable: row.stable, reviewKey: row.reviewKey, source: row.source, note: row.note, purgedAt: new Date().toISOString() });
}
const purged = new Set(plan.map((row) => row.stable));
database.items = (database.items || []).filter((entry) => !purged.has(sourceStableOfKey(entry.key || '')));
database.total_objects = database.items.length;
manifest.parts = (manifest.parts || []).filter((entry) =>
  !(entry.keys || (entry.key ? [entry.key] : [])).some((key) => purged.has(sourceStableOfKey(key))));
atomicJson(STATE, state);
atomicJson(DB, database);
atomicJson(MANIFEST, manifest);
atomicJson(PURGE_LEDGER, ledger);
console.log(`✅ 已 purge ${plan.length} 個 v6 穩定目標`);
