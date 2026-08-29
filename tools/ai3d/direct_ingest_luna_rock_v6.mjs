#!/usr/bin/env node
/**
 * GPT-5.6 Luna 岩石 v6 視覺直讀候選重建器。
 *
 * 只處理 review state 尚未標記 ok、archive、purge 的既有 rock/v6 目標。
 * 來源照片先經本地視覺特徵擷取，再由岩石結構規約映射為多面體組合；
 * 幾何一律通過 direct_ingest_v6 的唯一合成縫，候選不提升 runtime 資格。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { buildGeometryFromParts } from './direct_ingest_v6.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const DB_PATH = join(ROOT, 'out', '3d_database.json');
const REVIEW_STATE_PATH = join(ROOT, 'tools', 'parts_review', 'state.json');
const PREVIEW_RENDERER = join(HERE, 'render_poly_preview.py');
const FEATURE_CAPTURE = join(HERE, 'luna_vision_rock_features.py');
const ROCK_ROOT = join(ROOT, 'out', '3d_data', 'rock');
const CANDIDATE_ROOT = join(ROOT, 'out', '3d_data_luna_candidates', 'rock');
const PREVIEW_ROOT = join(ROOT, 'out', 'review_previews');
const SOURCE_ROOTS = [
  join(ROOT, 'tools', 'ai3d', 'photos'),
  'C:\\Users\\user\\Documents\\steel_vs_swarm\\tools\\ai3d\\photos',
  'C:\\Users\\user\\Documents\\app\\steel_vs_swarm\\tools\\ai3d\\photos',
  'C:\\Users\\user\\Documents\\study\\ai3d_restricted\\photos',
];
const EVIDENCE_ROOTS = [
  join(ROOT, 'out', 'yolo_features'),
  'C:\\Users\\user\\.gemini\\antigravity\\worktrees\\steel_vs_swarm\\llm_img3d_db_v6\\out\\yolo_features',
  'C:\\Users\\user\\Documents\\app\\steel_vs_swarm\\out\\yolo_features',
  'C:\\Users\\user\\Documents\\study\\ai3d_restricted\\out\\yolo_features',
];

const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const arg = (name, fallback = null) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};
const DRY_RUN = has('dry-run');
const LIMIT = Number(arg('limit', Infinity));
const ONLY = arg('only');
const PYTHON = arg('python', process.env.AI3D_PYTHON || join(ROOT, '.venv', 'Scripts', 'python.exe'));

const PALETTES = {
  basalt: { roofHex: 0x242b31, facadeHex: 0x4f5960, baseHex: 0x30383b, accentHex: 0x69757a, darkHex: 0x202528, brightHex: 0xaab5b5, glassHex: 0x172c33 },
  sandstone: { roofHex: 0x6a4530, facadeHex: 0x9a6a45, baseHex: 0x674431, accentHex: 0xc18a58, darkHex: 0x4a3028, brightHex: 0xe2bb81, glassHex: 0x233744 },
  limestone: { roofHex: 0x666d69, facadeHex: 0x9b9a88, baseHex: 0x5d655f, accentHex: 0xb6aa8c, darkHex: 0x353c39, brightHex: 0xd9d4b9, glassHex: 0x20343b },
  moss: { roofHex: 0x304b38, facadeHex: 0x5d7052, baseHex: 0x4d4938, accentHex: 0x7f965d, darkHex: 0x292f28, brightHex: 0xb1b98a, glassHex: 0x183936 },
};

const P = (name, type, values, colorKey, pos, rot = [0, 0, 0], role = 'structure') => ({
  name, type, ...values, pos, rot, colorKey, role,
});
const frustum = (name, sides, topR, botR, height, x, base, z, colorKey, role = 'structure') =>
  P(name, 'frustum_pyramid', { sides, radii: [topR, botR], height }, colorKey, [x, base + height / 2, z], [0, 0, 0], role);
const prism = (name, sides, radius, height, x, base, z, colorKey, role = 'structure') =>
  P(name, 'polygonal_prism', { sides, radius, height }, colorKey, [x, base + height / 2, z], [0, 0, 0], role);
const hull = (name, width, height, depth, x, base, z, colorKey, rot = [0, 0, 0], role = 'structure') =>
  P(name, 'hull_polyhedron', { dimensions: [width, height, depth] }, colorKey, [x, base, z], rot, role);
const ico = (name, radius, x, y, z, colorKey, rot = [0, 0, 0], role = 'structure') =>
  P(name, 'icosahedron_polyhedron', { radius }, colorKey, [x, Math.max(y, radius * 1.12 + 0.02), z], rot, role);
const dode = (name, radius, x, y, z, colorKey, rot = [0, 0, 0], role = 'structure') =>
  P(name, 'dodecahedron_polyhedron', { radius }, colorKey, [x, Math.max(y, radius * 0.96 + 0.02), z], rot, role);
const ellipsoid = (name, rx, ry, rz, x, y, z, colorKey, rot = [0, 0, 0], role = 'structure') =>
  P(name, 'ellipsoid_sphere', { radii: [rx, ry, rz] }, colorKey, [x, Math.max(y, Math.max(rx, ry, rz) * 1.08 + 0.02), z], rot, role);
const dome = (name, rx, ry, rz, x, y, z, colorKey, rot = [0, 0, 0], role = 'attachment') =>
  P(name, 'hemisphere_dome', { radii: [rx, ry, rz] }, colorKey, [x, y, z], rot, role);
const wedge = (name, w, h, d, x, y, z, colorKey, rot = [0, 0, 0], role = 'structure') =>
  P(name, 'wedge', { dimensions: [w, h, d] }, colorKey, [x, y, z], rot, role);

function hashSeed(value) {
  const hex = createHash('sha1').update(String(value)).digest('hex').slice(0, 8);
  return Number.parseInt(hex, 16) || 1;
}
function rngFor(value) {
  let state = hashSeed(value) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash01(value) { return (hashSeed(value) >>> 0) / 4294967296; }
function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
function between(rng, low, high) { return low + (high - low) * rng(); }
function safeName(value) {
  const normalized = String(value).replace(/[^a-zA-Z0-9._-]+/g, '_');
  if (normalized.length <= 86) return normalized;
  return `${normalized.slice(0, 70)}_${hashSeed(normalized).toString(16).padStart(8, '0')}`;
}
function stableTargetOfKey(key) { return String(key || '').replace(/_[0-9a-f]{8}_v6$/, ''); }
function relativePath(value) { return relative(ROOT, value).replace(/\\/g, '/'); }
function writeJsonAtomic(path, value) {
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temp, path);
}
function writeTextAtomic(path, value) {
  const temp = `${path}.tmp`;
  writeFileSync(temp, value, 'utf8');
  renameSync(temp, path);
}
function scanFiles(roots, predicate) {
  const found = [];
  const visit = (dir) => {
    if (!existsSync(dir)) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (predicate(path)) found.push(path);
    }
  };
  for (const root of roots) visit(root);
  return found;
}
function normalizePath(value) { return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase(); }

function loadReviewStatuses() {
  if (!existsSync(REVIEW_STATE_PATH)) return new Map();
  const raw = JSON.parse(readFileSync(REVIEW_STATE_PATH, 'utf8'));
  const items = raw.items && !Array.isArray(raw.items) ? raw.items : raw;
  return new Map(Object.entries(items).map(([key, value]) => [stableTargetOfKey(key), value?.status || null]));
}

function loadTargets() {
  const statuses = loadReviewStatuses();
  const rows = [];
  const visit = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { visit(path); continue; }
      if (entry.name !== 'metadata.json') continue;
      const metadata = JSON.parse(readFileSync(path, 'utf8'));
      if (metadata.family !== 'rock' || metadata.version !== 6) continue;
      const stable = stableTargetOfKey(metadata.key);
      if (['ok', 'archive', 'purge'].includes(statuses.get(stable) || null)) continue;
      const featuresPath = join(dirname(path), 'features.json');
      const features = existsSync(featuresPath) ? JSON.parse(readFileSync(featuresPath, 'utf8')) : {};
      rows.push({
        ...metadata,
        stable,
        modelDir: dirname(path),
        oldFeatures: features,
        oldPartNames: features.partNames || [],
      });
    }
  };
  visit(ROCK_ROOT);
  const selected = ONLY
    ? rows.filter((row) => row.stable === ONLY || row.subpart === ONLY || row.key === ONLY)
    : rows;
  selected.sort((a, b) => a.key.localeCompare(b.key));
  return { rows: selected.slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined), totalEligible: selected.length };
}

function sourceIndex() {
  const byRel = new Map();
  const byName = new Map();
  const extensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
  for (const root of SOURCE_ROOTS) {
    for (const path of scanFiles([root], (candidate) => extensions.has(extname(candidate).toLowerCase()))) {
      byRel.set(normalizePath(relative(root, path)), path);
      const name = basename(path).toLowerCase();
      if (!byName.has(name)) byName.set(name, path);
    }
  }
  return { byRel, byName };
}
function resolveSource(row, index) {
  return index.byRel.get(normalizePath(row.source_image))
    || index.byName.get(basename(row.source_image || '').toLowerCase())
    || (row.source_full_path && existsSync(row.source_full_path) ? row.source_full_path : null);
}

function evidenceIndex() {
  const index = new Map();
  for (const path of scanFiles(EVIDENCE_ROOTS, (candidate) => extname(candidate).toLowerCase() === '.json')) {
    const name = basename(path).toLowerCase();
    if (!index.has(name)) index.set(name, path);
  }
  return index;
}
function readEvidence(row, index) {
  const stem = basename(row.source_image || '', extname(row.source_image || '')).toLowerCase();
  const path = index.get(`${stem}.json`);
  if (!path) return { path: null, schemaVersion: null, status: 'missing_yolo26_schema_v2', target: null };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const valid = raw.schemaVersion === 2
      && raw.models?.detection === 'yolo26n.pt'
      && raw.models?.segmentation === 'yolo26n-seg.pt'
      && raw.models?.depth === 'yolo26n-depth.pt';
    return {
      path,
      schemaVersion: valid ? 2 : null,
      status: valid ? 'yolo26_schema_v2' : 'legacy_feature_metadata_only',
      target: raw.targets?.[0] || null,
    };
  } catch {
    return { path, schemaVersion: null, status: 'invalid_feature_metadata', target: null };
  }
}

function captureVisualFeatures(rows, sources) {
  const paths = [...new Set(rows.map((row) => sources.get(row.stable)).filter(Boolean))];
  if (!paths.length || DRY_RUN) return new Map();
  const output = execFileSync(PYTHON, [FEATURE_CAPTURE, ...paths], {
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 24 * 1024 * 1024,
  });
  const parsed = JSON.parse(output);
  return new Map(parsed.map((feature) => [feature.path, feature]));
}

function tokens(row) {
  return [row.subpart, row.style, ...(row.oldPartNames || []), row.source_image]
    .join(' ').toLowerCase();
}
function includesAny(text, values) { return values.some((value) => text.includes(value)); }
function classify(row, visual) {
  const text = tokens(row);
  if (row.subpart === 'mg_arch') return 'arch';
  if (row.subpart === 'hoodoo') return 'hoodoo';
  if (row.subpart === 'tor') return 'tor';
  if (row.subpart === 'st_dolmen') return 'dolmen';
  if (row.subpart === 'mg_mesa') return 'mesa';
  if (row.subpart === 'mg_tower') return 'tower';
  if (row.subpart === 'talus') return 'talus';
  if (row.subpart === 'mg_slab' || row.subpart === 'strata') return 'strata';
  if (includesAny(text, ['arch', 'gateway'])) return 'arch';
  if (includesAny(text, ['hoodoo', 'pillar'])) return 'hoodoo';
  if (includesAny(text, ['tor', 'natural_rock_tor'])) return 'tor';
  if (includesAny(text, ['dolmen', 'megalithic', 'monument', 'standing_stone'])) return 'dolmen';
  if (includesAny(text, ['mesa', 'plateau', 'cliff', 'mountain', 'ridge'])) return 'mesa';
  if (includesAny(text, ['tower', 'observation', 'graffiti'])) return 'tower';
  if (includesAny(text, ['talus', 'scree', 'debris', 'stone_patch'])) return 'talus';
  if (includesAny(text, ['slab', 'strata', 'layer', 'pyramid'])) return 'strata';
  const visualWater = (visual?.coverage?.waterSky || 0) > 0.28
    && (visual?.luminance?.bottomMean || 0) < (visual?.luminance?.topMean || 1) * 0.82;
  if (visualWater || includesAny(text, ['water', 'waterline', 'sea', 'ocean', 'foam', 'coastal'])) return 'water_formation';
  return 'boulder';
}
function visualGeometryPolicyFor(row, visual, profile) {
  const text = tokens(row);
  const edgeDensity = Number(visual?.edgeDensity?.combined) || 0;
  const neutralRock = Number(visual?.coverage?.neutralRock) || 0;
  const luminanceRange = Number(visual?.luminance?.range) || 0;
  const measuredHardEdges = edgeDensity >= 0.018 && neutralRock >= 0.28 && luminanceRange >= 180;
  const angularProfile = profile !== 'boulder';
  const angularTokens = includesAny(text, [
    'angular', 'faceted', 'crag', 'fracture', 'strata', 'layer', 'slab', 'mesa', 'hoodoo',
    'dolmen', 'tor', 'arch', 'tower', 'talus', 'scree', 'pyramid', 'monolith', 'formation',
  ]);
  const angularOnly = measuredHardEdges || angularProfile || angularTokens;
  const reasons = [];
  if (measuredHardEdges) reasons.push('edge_density');
  if (angularProfile) reasons.push(`profile:${profile}`);
  if (angularTokens) reasons.push('rock_feature_tokens');
  return {
    mode: angularOnly ? 'angular_polyhedral_only' : 'faceted_polyhedral_with_rounded_fallback',
    angularOnly,
    reason: reasons.join('+') || 'low_hard_edge_signal',
    metrics: { edgeDensity, neutralRock, luminanceRange },
    forbiddenPrimitives: angularOnly ? ['ellipsoid_sphere', 'hemisphere_dome', 'cylinder', 'cone'] : [],
  };
}
function choosePalette(row, visual, hasVegetation) {
  const text = tokens(row);
  let palette;
  if (visual?.coverage?.warmEarth > 0.10 || includesAny(text, ['sandstone', 'red', 'desert'])) palette = PALETTES.sandstone;
  else if (includesAny(text, ['limestone', 'chalk', 'white'])) palette = PALETTES.limestone;
  else if (hasVegetation && (visual?.coverage?.green || 0) > 0.36 && (visual?.coverage?.neutralRock || 0) < 0.45) palette = PALETTES.moss;
  else palette = PALETTES.basalt;
  if (hasVegetation && palette !== PALETTES.moss) {
    return { ...palette, accentHex: 0x557c47, brightHex: 0x9fba72 };
  }
  return palette;
}
function dimensions(row) {
  const size = row.bounds?.size || [4, 4, 4];
  return {
    width: clamp(Number(size[0]) || 4, 1.8, 26),
    height: clamp(Number(size[1]) || 4, 1.5, 24),
    depth: clamp(Number(size[2]) || 4, 1.8, 26),
  };
}
function attachmentFlags(row, visual) {
  const text = tokens(row);
  const coverage = visual?.coverage || {};
  return {
    vegetation: coverage.green > 0.065 || includesAny(text, ['moss', 'lichen', 'vegetation', 'foliage', 'grass', 'bush', 'shrub', 'crown']),
    waterline: coverage.waterSky > 0.09 || includesAny(text, ['water', 'waterline', 'foam', 'sea', 'ocean', 'coastal']),
    strata: includesAny(text, ['strata', 'layer', 'mineral', 'geologic', 'formation']),
    stain: includesAny(text, ['guano', 'stain', 'decal', 'graffiti', 'mineral_band']),
    stairs: includesAny(text, ['stair', 'path', 'step']),
    observation: includesAny(text, ['observation', 'building', 'tower', 'facility']),
    hat: includesAny(text, ['hat', 'crown']),
  };
}

function addGroundAnchor(parts, width, depth, palette, profile) {
  const r = Math.max(0.45, Math.min(width, depth) * (profile === 'talus' ? 0.48 : 0.35));
  parts.push(frustum('ground_contact_anchor', 8, r * 0.78, r, Math.max(0.14, r * 0.22), 0, 0, 0, 'baseHex', 'ground_anchor'));
}
function addBoulder(parts, d, palette, flags, rng) {
  const r = Math.min(d.width, d.depth);
  addGroundAnchor(parts, d.width, d.depth, palette, 'boulder');
  parts.push(frustum('faceted_lower_foot', 9, r * 0.34, r * 0.48, d.height * 0.22, 0, d.height * 0.10, 0, 'baseHex'));
  if (flags.angularVisual) {
    parts.push(hull('weathered_main_polyhedron', d.width * 0.84, d.height * 0.72, d.depth * 0.80, 0, d.height * 0.16, 0, 'facadeHex', [0.02, 0.08, -0.04], 'mass'));
    parts.push(frustum('weathered_main_lower_facet', 8, r * 0.29, r * 0.43, d.height * 0.12, -d.width * 0.03, d.height * 0.23, d.depth * 0.02, 'baseHex', 'mass'));
    parts.push(wedge('weathered_main_front_shear', d.width * 0.48, d.height * 0.23, d.depth * 0.26, d.width * 0.04, d.height * 0.54, d.depth * 0.27, 'facadeHex', [0.06, 0.10, -0.08], 'fracture'));
    parts.push(dode('weathered_main_crown_facet', r * 0.24, -d.width * 0.05, d.height * 0.78, -d.depth * 0.04, 'roofHex', [0.14, 0.22, 0.02], 'mass'));
  } else {
    parts.push(ellipsoid('weathered_main_mass', d.width * 0.42, d.height * 0.42, d.depth * 0.40, 0, d.height * 0.50, 0, 'facadeHex'));
  }
  parts.push(ico('front_angular_face', r * 0.27, d.width * 0.02, d.height * 0.44, d.depth * 0.30, 'facadeHex', [0.08, 0.24, -0.05]));
  parts.push(dode('upper_crest_facet', r * 0.25, d.width * between(rng, -0.08, 0.10), d.height * 0.78, d.depth * between(rng, -0.05, 0.08), 'roofHex', [0.12, 0.18, 0.04]));
  parts.push(ico('left_weathered_shoulder', r * 0.22, -d.width * 0.27, d.height * 0.43, d.depth * 0.03, 'baseHex', [0.18, -0.12, 0.12]));
  parts.push(dode('right_weathered_shoulder', r * 0.20, d.width * 0.27, d.height * 0.38, -d.depth * 0.06, 'facadeHex', [-0.08, 0.28, -0.08]));
  parts.push(wedge('front_shear_plane', d.width * 0.34, d.height * 0.20, d.depth * 0.28, d.width * 0.05, d.height * 0.52, d.depth * 0.28, 'darkHex', [0.08, 0, -0.10], 'fracture'));
  parts.push(frustum('top_cap_fragment', 7, r * 0.13, r * 0.23, d.height * 0.12, -d.width * 0.10, d.height * 0.75, -d.depth * 0.08, 'accentHex', 'strata'));
  if (flags.strata) {
    for (let i = 0; i < 3; i++) {
      const y = d.height * (0.30 + i * 0.16);
      parts.push(frustum(`horizontal_stratum_${i}`, 8, r * (0.26 - i * 0.018), r * (0.39 - i * 0.012), Math.max(0.05, d.height * 0.035), 0, y, d.depth * 0.03, i % 2 ? 'accentHex' : 'darkHex', 'strata'));
    }
  }
}
function addFormation(parts, d, palette, flags, rng) {
  const r = Math.min(d.width, d.depth);
  addGroundAnchor(parts, d.width, d.depth, palette, 'formation');
  parts.push(frustum('formation_base_slope', 8, r * 0.42, r * 0.62, d.height * 0.20, 0, 0.08, 0, 'baseHex'));
  parts.push(frustum('formation_lower_tier', 9, r * 0.38, r * 0.48, d.height * 0.27, -d.width * 0.05, d.height * 0.22, d.depth * 0.01, 'facadeHex'));
  parts.push(frustum('formation_mid_tier', 8, r * 0.32, r * 0.42, d.height * 0.25, d.width * 0.04, d.height * 0.49, -d.depth * 0.03, 'facadeHex'));
  parts.push(dode('formation_top_block', r * 0.28, d.width * 0.04, d.height * 0.80, -d.depth * 0.03, 'roofHex', [0.10, 0.20, 0.02]));
  parts.push(wedge('left_buttress', d.width * 0.31, d.height * 0.43, d.depth * 0.30, -d.width * 0.31, d.height * 0.30, -d.depth * 0.04, 'baseHex', [0.02, 0.18, -0.09]));
  parts.push(wedge('right_buttress', d.width * 0.29, d.height * 0.38, d.depth * 0.27, d.width * 0.30, d.height * 0.28, d.depth * 0.04, 'facadeHex', [-0.06, -0.14, 0.12]));
  parts.push(ico('forward_rubble_facet', r * 0.16, d.width * 0.24, d.height * 0.24, d.depth * 0.30, 'accentHex', [0.15, 0.22, 0.10]));
  if (flags.strata) {
    for (let i = 0; i < 4; i++) {
      const y = d.height * (0.18 + i * 0.16);
      parts.push(frustum(`exposed_stratum_${i}`, 7 + (i % 2), r * (0.32 - i * 0.012), r * (0.48 - i * 0.015), Math.max(0.06, d.height * 0.035), d.width * (i % 2 ? 0.03 : -0.03), y, d.depth * 0.14, i % 2 ? 'accentHex' : 'darkHex', 'strata'));
    }
  }
  if (hash01(`${d.width}|${d.depth}|formation`) > 0.35) {
    parts.push(dode('rear_support_fragment', r * 0.17, -d.width * 0.28, d.height * 0.22, -d.depth * 0.25, 'baseHex', [0.2, -0.2, 0.05]));
  }
}
function addMesa(parts, d, palette, flags) {
  const r = Math.min(d.width, d.depth);
  addGroundAnchor(parts, d.width, d.depth, palette, 'mesa');
  parts.push(frustum('mesa_lower_slope', 8, r * 0.44, r * 0.64, d.height * 0.22, 0, 0.08, 0, 'baseHex'));
  parts.push(frustum('mesa_cliff_body', 8, r * 0.37, r * 0.45, d.height * 0.44, -d.width * 0.02, d.height * 0.23, 0, 'facadeHex'));
  parts.push(prism('mesa_flat_cap', 8, r * 0.38, Math.max(0.12, d.height * 0.13), d.width * 0.02, d.height * 0.67, -d.depth * 0.02, 'roofHex', 'plateau'));
  parts.push(wedge('mesa_front_overhang', d.width * 0.54, d.height * 0.18, d.depth * 0.27, d.width * 0.02, d.height * 0.62, d.depth * 0.28, 'accentHex', [0.06, 0.02, -0.04], 'ledge'));
  parts.push(ico('mesa_left_crag', r * 0.19, -d.width * 0.32, d.height * 0.40, d.depth * 0.08, 'baseHex', [0.1, 0.24, 0.1]));
  parts.push(dode('mesa_right_crag', r * 0.18, d.width * 0.31, d.height * 0.35, -d.depth * 0.08, 'facadeHex', [-0.1, -0.18, 0.02]));
  if (flags.strata) {
    for (let i = 0; i < 4; i++) {
      parts.push(frustum(`mesa_strata_${i}`, 8, r * (0.38 - i * 0.018), r * (0.48 - i * 0.015), Math.max(0.06, d.height * 0.035), 0, d.height * (0.27 + i * 0.11), d.depth * 0.18, i % 2 ? 'accentHex' : 'darkHex', 'strata'));
    }
  }
}
function addHoodoo(parts, d, palette, flags, rng) {
  const r = Math.min(d.width, d.depth);
  addGroundAnchor(parts, d.width, d.depth, palette, 'hoodoo');
  parts.push(frustum('eroded_slope_base', 8, r * 0.48, r * 0.70, d.height * 0.18, 0, 0.08, 0, 'baseHex'));
  const columns = [
    [-d.width * 0.28, d.height * 0.55, -d.depth * 0.05, 0.15],
    [0, d.height * 0.78, d.depth * 0.02, 0.00],
    [d.width * 0.27, d.height * 0.48, -d.depth * 0.04, -0.12],
  ];
  columns.forEach(([x, height, z, drift], index) => {
    const radius = r * (index === 1 ? 0.15 : 0.13);
    const base = d.height * 0.12;
    parts.push(frustum(`hoodoo_pillar_${index}`, 7 + index, radius * 0.72, radius, height, x, base, z, index === 1 ? 'facadeHex' : 'baseHex', 'pillar'));
    parts.push(dode(`hoodoo_cap_${index}`, radius * 1.55, x + drift * r, base + height + radius * 0.60, z, index === 1 ? 'roofHex' : 'facadeHex', [0.10, index * 0.18, -0.06]));
    parts.push(frustum(`hoodoo_band_${index}`, 7, radius * 0.93, radius * 1.13, Math.max(0.08, d.height * 0.035), x, base + height * 0.42, z + d.depth * 0.02, 'accentHex', 'strata'));
  });
  parts.push(wedge('hoodoo_back_cliff', d.width * 0.42, d.height * 0.36, d.depth * 0.24, d.width * 0.03, d.height * 0.25, -d.depth * 0.26, 'darkHex', [0.04, -0.16, 0.05]));
  parts.push(ico('hoodoo_debris_left', r * 0.15, -d.width * 0.38, d.height * 0.16, d.depth * 0.22, 'accentHex', [0.2, 0.1, 0.05]));
  parts.push(dode('hoodoo_debris_right', r * 0.13, d.width * 0.39, d.height * 0.14, d.depth * 0.18, 'baseHex', [-0.1, 0.2, 0.12]));
}
function addArch(parts, d, palette, flags, rng, tor = false) {
  const r = Math.min(d.width, d.depth);
  addGroundAnchor(parts, d.width, d.depth, palette, 'arch');
  const pillarHeight = d.height * (tor ? 0.70 : 0.62);
  const pillarRadius = r * (tor ? 0.16 : 0.19);
  const spread = d.width * (tor ? 0.30 : 0.27);
  for (const side of [-1, 1]) {
    const x = side * spread;
    parts.push(frustum(`arch_pillar_${side < 0 ? 'left' : 'right'}_lower`, 8, pillarRadius * 0.78, pillarRadius, pillarHeight, x, 0.06, 0, side < 0 ? 'baseHex' : 'facadeHex', 'pillar'));
    parts.push(ico(`arch_pillar_${side < 0 ? 'left' : 'right'}_facet`, pillarRadius * 1.18, x, pillarHeight * 0.54, d.depth * 0.03, 'facadeHex', [0.12, side * 0.16, 0.04]));
  }
  parts.push(wedge('arch_top_bridge', d.width * 0.60, d.height * 0.22, d.depth * 0.52, 0, d.height * 0.78, 0, 'roofHex', [0, 0.02, 0], 'bridge'));
  if (flags.angularVisual) {
    parts.push(hull('arch_weathered_crown_polyhedron', d.width * 0.76, d.height * 0.30, d.depth * 0.68, 0, d.height * 0.60, -d.depth * 0.02, 'facadeHex', [0, 0.08, 0], 'mass'));
    parts.push(wedge('arch_crown_shear_facet', d.width * 0.36, d.height * 0.15, d.depth * 0.24, d.width * 0.04, d.height * 0.76, d.depth * 0.24, 'accentHex', [0.06, -0.08, 0.04], 'fracture'));
  } else {
    parts.push(ellipsoid('arch_weathered_crown', d.width * 0.38, d.height * 0.25, d.depth * 0.34, 0, d.height * 0.75, -d.depth * 0.02, 'facadeHex'));
  }
  parts.push(dode('arch_left_keystone', r * 0.14, -d.width * 0.15, d.height * 0.78, d.depth * 0.08, 'accentHex', [0.04, -0.10, 0.06]));
  parts.push(ico('arch_right_keystone', r * 0.13, d.width * 0.16, d.height * 0.76, d.depth * 0.08, 'baseHex', [-0.06, 0.14, -0.04]));
  parts.push(wedge('arch_inner_shadow', d.width * 0.27, d.height * 0.12, d.depth * 0.08, 0, d.height * 0.57, d.depth * 0.27, 'darkHex', [0.02, 0, 0], 'fracture'));
  if (tor) {
    parts.push(dode('tor_left_cap', r * 0.20, -d.width * 0.24, d.height * 0.88, -d.depth * 0.04, 'roofHex', [0.15, -0.18, 0.1]));
    parts.push(dode('tor_right_cap', r * 0.18, d.width * 0.24, d.height * 0.84, d.depth * 0.04, 'roofHex', [-0.1, 0.19, -0.06]));
  }
  if (flags.strata) {
    for (let i = 0; i < 3; i++) {
      parts.push(frustum(`arch_stratum_${i}`, 8, r * (0.25 - i * 0.015), r * (0.37 - i * 0.018), Math.max(0.05, d.height * 0.03), 0, d.height * (0.22 + i * 0.17), d.depth * 0.12, i % 2 ? 'accentHex' : 'darkHex', 'strata'));
    }
  }
}
function addDolmen(parts, d, palette, flags) {
  const r = Math.min(d.width, d.depth);
  addGroundAnchor(parts, d.width, d.depth, palette, 'dolmen');
  const supportHeight = d.height * 0.65;
  for (const side of [-1, 1]) {
    const x = side * d.width * 0.20;
    parts.push(frustum(`standing_stone_${side < 0 ? 'left' : 'right'}`, 6, r * 0.13, r * 0.18, supportHeight, x, 0.05, 0, side < 0 ? 'baseHex' : 'facadeHex', 'standing_stone'));
    parts.push(dode(`standing_stone_cap_${side < 0 ? 'left' : 'right'}`, r * 0.15, x, supportHeight + r * 0.10, side * d.depth * 0.03, 'accentHex', [0.1, side * 0.17, 0]));
  }
  parts.push(wedge('dolmen_lintel', d.width * 0.66, d.height * 0.25, d.depth * 0.38, 0, d.height * 0.78, 0, 'roofHex', [0, 0, 0.06], 'lintel'));
  parts.push(dode('dolmen_lintel_facet', r * 0.22, d.width * 0.05, d.height * 0.88, -d.depth * 0.03, 'facadeHex', [0.16, 0.12, -0.08]));
  parts.push(ico('dolmen_front_marker', r * 0.13, 0, d.height * 0.30, d.depth * 0.27, 'accentHex', [0.2, 0.2, 0.05]));
  if (flags.strata) parts.push(frustum('lintel_strata_band', 7, r * 0.24, r * 0.34, Math.max(0.06, d.height * 0.035), 0, d.height * 0.70, d.depth * 0.19, 'darkHex', 'strata'));
}
function addTower(parts, d, palette, flags) {
  const r = Math.min(d.width, d.depth);
  addGroundAnchor(parts, d.width, d.depth, palette, 'tower');
  parts.push(frustum('monument_base', 8, r * 0.34, r * 0.52, d.height * 0.20, 0, 0.05, 0, 'baseHex'));
  parts.push(prism('monument_lower_tower', 7, r * 0.30, d.height * 0.35, -d.width * 0.04, d.height * 0.19, 0, 'facadeHex'));
  parts.push(frustum('monument_upper_tower', 7, r * 0.22, r * 0.29, d.height * 0.30, d.width * 0.03, d.height * 0.54, -d.depth * 0.02, 'roofHex'));
  parts.push(dode('monument_capstone', r * 0.22, d.width * 0.03, d.height * 0.88, 0, 'accentHex', [0.1, 0.2, 0]));
  parts.push(wedge('monument_front_face', d.width * 0.34, d.height * 0.22, d.depth * 0.10, 0, d.height * 0.40, d.depth * 0.29, 'darkHex', [0.05, 0, 0], 'fracture'));
  if (flags.observation) {
    parts.push(prism('attached_observation_platform', 6, r * 0.12, d.height * 0.19, d.width * 0.02, d.height * 0.70, d.depth * 0.10, 'accentHex', 'attachment'));
    parts.push(wedge('attached_observation_roof', r * 0.24, d.height * 0.09, r * 0.20, d.width * 0.02, d.height * 0.89, d.depth * 0.10, 'brightHex', [0, 0, 0], 'attachment'));
  }
  if (flags.stain) {
    parts.push(wedge('surface_graffiti_or_mineral_stain', d.width * 0.20, d.height * 0.14, d.depth * 0.06, d.width * 0.04, d.height * 0.45, d.depth * 0.31, 'accentHex', [0.03, 0, 0], 'surface_attachment'));
  }
}
function addStrata(parts, d, palette, flags) {
  const r = Math.min(d.width, d.depth);
  addGroundAnchor(parts, d.width, d.depth, palette, 'strata');
  for (let i = 0; i < 5; i++) {
    const base = d.height * (0.08 + i * 0.17);
    const width = d.width * (0.62 - i * 0.035);
    const depth = d.depth * (0.62 - i * 0.025);
    const top = Math.min(width, depth) * 0.38;
    const bottom = Math.min(width, depth) * 0.52;
    parts.push(frustum(`strata_mass_${i}`, 8 + (i % 2), top, bottom, Math.max(0.12, d.height * 0.18), (i % 2 ? 0.04 : -0.04) * d.width, base, (i % 3 - 1) * d.depth * 0.04, i === 4 ? 'roofHex' : i % 2 ? 'facadeHex' : 'baseHex', 'strata'));
  }
  parts.push(wedge('strata_front_break', d.width * 0.30, d.height * 0.22, d.depth * 0.18, d.width * 0.12, d.height * 0.44, d.depth * 0.30, 'darkHex', [0.04, 0.10, -0.08], 'fracture'));
  parts.push(dode('strata_top_fragment', r * 0.20, -d.width * 0.18, d.height * 0.92, -d.depth * 0.05, 'accentHex', [0.14, -0.14, 0.04]));
  if (flags.stairs) addStairs(parts, d, palette);
}
function addTalus(parts, d, palette, flags, rng) {
  const r = Math.min(d.width, d.depth);
  addGroundAnchor(parts, d.width, d.depth, palette, 'talus');
  parts.push(frustum('talus_slope_core', 9, r * 0.31, r * 0.58, d.height * 0.34, 0, 0.05, -d.depth * 0.04, 'baseHex'));
  for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 2 + between(rng, -0.18, 0.18);
    const radius = r * between(rng, 0.24, 0.58);
    const size = r * between(rng, 0.07, 0.15);
    const x = Math.cos(angle) * Math.min(d.width * 0.46, radius);
    const z = Math.sin(angle) * Math.min(d.depth * 0.46, radius);
    const y = Math.max(size * 0.88, d.height * between(rng, 0.12, 0.30));
    parts.push(i % 2 ? dode(`talus_fragment_${i}`, size, x, y, z, i % 3 ? 'facadeHex' : 'accentHex', [0.12, angle, 0.06], 'debris')
      : ico(`talus_fragment_${i}`, size, x, y, z, i % 3 ? 'baseHex' : 'roofHex', [0.08, angle, -0.04], 'debris'));
  }
  if (flags.strata) parts.push(frustum('talus_exposed_band', 8, r * 0.26, r * 0.40, Math.max(0.06, d.height * 0.04), 0, d.height * 0.25, d.depth * 0.23, 'accentHex', 'strata'));
}

function addStairs(parts, d, palette) {
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    parts.push(wedge(`attached_stone_step_${i}`, d.width * 0.16, d.height * 0.045, d.depth * 0.13, -d.width * 0.16, d.height * (0.08 + i * 0.045), d.depth * (0.29 - i * 0.055), 'accentHex', [0, 0.04, 0], 'attachment'));
  }
}
function addAttachments(parts, d, palette, flags, visual) {
  if (flags.vegetation) {
    const topY = d.height * 0.90;
    if (flags.angularVisual) {
      const lichenHeight = Math.max(0.10, d.height * 0.065);
      parts.push(frustum('attached_lichen_canopy_polyhedron', 7, d.width * 0.10, d.width * 0.19, lichenHeight, -d.width * 0.03, topY - lichenHeight, -d.depth * 0.02, 'accentHex', 'surface_attachment'));
      parts.push(wedge('attached_lichen_shear_facet', d.width * 0.20, lichenHeight * 0.90, d.depth * 0.12, -d.width * 0.03, topY - lichenHeight * 0.48, d.depth * 0.10, 'brightHex', [0.08, 0.12, -0.04], 'surface_attachment'));
    } else {
      parts.push(dome('attached_lichen_canopy', d.width * 0.19, Math.max(0.10, d.height * 0.065), d.depth * 0.17, -d.width * 0.03, topY, -d.depth * 0.02, 'accentHex', [0, 0.08, 0], 'surface_attachment'));
    }
    parts.push(dode('attached_moss_facet', Math.min(d.width, d.depth) * 0.085, d.width * 0.16, d.height * 0.77, d.depth * 0.20, 'brightHex', [0.08, 0.24, 0.02], 'surface_attachment'));
    if ((visual?.coverage?.green || 0) > 0.22) {
      if (flags.angularVisual) {
        parts.push(hull('attached_side_shrub_polyhedron', d.width * 0.32, d.height * 0.26, d.depth * 0.34, -d.width * 0.27, d.height * 0.48, d.depth * 0.05, 'facadeHex', [0.10, -0.12, 0], 'surface_attachment'));
        parts.push(ico('attached_side_shrub_facet', Math.min(d.width, d.depth) * 0.075, -d.width * 0.27, d.height * 0.70, d.depth * 0.05, 'brightHex', [0.12, -0.18, 0.04], 'surface_attachment'));
      } else {
        parts.push(ellipsoid('attached_side_shrub', d.width * 0.16, d.height * 0.13, d.depth * 0.17, -d.width * 0.27, d.height * 0.57, d.depth * 0.05, 'facadeHex', [0.1, -0.12, 0], 'surface_attachment'));
      }
    }
  }
  if (flags.waterline) {
    parts.push(prism('attached_waterline_foam', 9, Math.min(d.width, d.depth) * 0.29, Math.max(0.045, d.height * 0.035), 0, Math.max(0.03, d.height * 0.035), d.depth * 0.30, 'brightHex', 'waterline'));
    parts.push(frustum('attached_tide_band', 8, Math.min(d.width, d.depth) * 0.27, Math.min(d.width, d.depth) * 0.33, Math.max(0.06, d.height * 0.05), 0, d.height * 0.07, d.depth * 0.08, 'darkHex', 'waterline'));
  }
  if (flags.stain) {
    parts.push(wedge('attached_surface_stain', d.width * 0.18, d.height * 0.18, d.depth * 0.045, -d.width * 0.10, d.height * 0.48, d.depth * 0.36, 'darkHex', [0.08, 0.05, -0.04], 'surface_attachment'));
  }
  if (flags.hat) {
    parts.push(prism('attached_hat_brim', 8, d.width * 0.25, Math.max(0.06, d.height * 0.04), 0, d.height * 0.84, d.depth * 0.02, 'accentHex', 'attachment'));
    parts.push(frustum('attached_hat_crown', 8, d.width * 0.13, d.width * 0.18, d.height * 0.16, 0, d.height * 0.88, d.depth * 0.02, 'roofHex', 'attachment'));
  }
  if (flags.stairs && !['strata', 'tower'].includes(flags.profile)) addStairs(parts, d, palette);
}

function makeSpec(row, visual) {
  const d = dimensions(row);
  const flags = attachmentFlags(row, visual);
  const profile = classify(row, visual);
  const visualGeometryPolicy = visualGeometryPolicyFor(row, visual, profile);
  flags.angularVisual = visualGeometryPolicy.angularOnly;
  const palette = choosePalette(row, visual, flags.vegetation);
  const rng = rngFor(`${row.stable}|${profile}|gpt-5.6-luna`);
  const parts = [];
  if (profile === 'arch') addArch(parts, d, palette, flags, rng, false);
  else if (profile === 'tor') addArch(parts, d, palette, flags, rng, true);
  else if (profile === 'hoodoo') addHoodoo(parts, d, palette, flags, rng);
  else if (profile === 'dolmen') addDolmen(parts, d, palette, flags);
  else if (profile === 'mesa') addMesa(parts, d, palette, flags);
  else if (profile === 'tower') addTower(parts, d, palette, flags);
  else if (profile === 'strata') addStrata(parts, d, palette, flags);
  else if (profile === 'talus') addTalus(parts, d, palette, flags, rng);
  else if (profile === 'water_formation') addFormation(parts, d, palette, flags, rng);
  else if (includesAny(tokens(row), ['formation', 'natural_rock_formation', 'monolith'])) addFormation(parts, d, palette, flags, rng);
  else addBoulder(parts, d, palette, flags, rng);
  flags.profile = profile;
  addAttachments(parts, d, palette, flags, visual);
  const style = {
    boulder: 'faceted weathered erratic boulder',
    formation: 'layered asymmetrical geological formation',
    water_formation: 'coastal layered rock with waterline attachment',
    mesa: 'stratified flat-topped mesa formation',
    hoodoo: 'clustered eroded hoodoo pillars with capstones',
    arch: 'weathered coastal rock arch with open span',
    tor: 'natural stone tor gateway with open span',
    dolmen: 'ancient dolmen assembly with polygonal lintel',
    tower: 'stacked geological monument with attached observation detail',
    strata: 'stacked geological slab and fracture assembly',
    talus: 'faceted talus slope with anchored debris field',
  }[profile] || 'faceted geological rock assembly';
  const symmetryMode = ['dolmen', 'strata'].includes(profile) ? 'symmetric' : 'asymmetric';
  return {
    style,
    symmetryMode,
    colors: palette,
    parts,
    profile,
    dimensions: d,
    flags,
    visualGeometryPolicy,
    note: `以 GPT-5.6 Luna 視覺特徵辨識為「${profile}」；以多層多面體重建輪廓，保留${Object.entries(flags).filter(([key, value]) => !['profile', 'angularVisual'].includes(key) && value).map(([key]) => key).join('、') || '岩體本身'}附著特徵；幾何政策：${visualGeometryPolicy.mode}。`,
  };
}

function assertGeometryPolicy(spec, geometry) {
  if (!spec.visualGeometryPolicy.angularOnly) return;
  const forbidden = new Set(spec.visualGeometryPolicy.forbiddenPrimitives);
  const violations = geometry.modelJson.parts.filter((part) => forbidden.has(part.type)).map((part) => `${part.name}:${part.type}`);
  if (violations.length) {
    throw new Error(`稜角型視覺禁止圓滑幾何：${violations.join(', ')}`);
  }
}

function selfReview(spec, visual, oldBounds) {
  const coverage = visual?.coverage || {};
  let score = 68;
  if (spec.parts.length >= 12) score += 5;
  if (spec.flags.vegetation && coverage.green > 0.05) score += 4;
  if (spec.flags.waterline && coverage.waterSky > 0.05) score += 4;
  if (spec.flags.strata) score += 3;
  if (spec.profile === 'arch' || spec.profile === 'tor' || spec.profile === 'hoodoo') score += 4;
  if (oldBounds?.size && spec.dimensions.height > 0) {
    const oldAspect = oldBounds.size[1] / Math.max(oldBounds.size[0], 0.01);
    const newAspect = spec.dimensions.height / Math.max(spec.dimensions.width, 0.01);
    if (Math.abs(Math.log((oldAspect + 0.01) / (newAspect + 0.01))) < 0.7) score += 3;
  }
  score = clamp(Math.round(score), 0, 89);
  return {
    similarityScore: score,
    verdict: 'awaiting_human_review',
    corrections: [],
    reviewer: 'gpt-5.6-luna_local_visual_feature_contract',
    critique: `視覺特徵與${spec.profile}幾何契約已對齊；${spec.visualGeometryPolicy.mode} 通過幾何禁用閘門；${spec.parts.length} 個多面體零件涵蓋主輪廓與附著特徵。分數是本地結構自檢，不是人眼/第二模型核准。`,
  };
}

function outputFor(row, hash) { return join(CANDIDATE_ROOT, safeName(row.subpart), `rock_${safeName(row.stable)}_${hash}_luna_v6`); }
function previewFor(row, hash) { return join(PREVIEW_ROOT, `rock_${safeName(row.stable)}_${hash}_luna_v6.png`); }

function processTarget(row, indexes, visualFeatures) {
  const visual = visualFeatures.get(row.sourcePath) || { status: 'missing_visual_capture', coverage: {} };
  const spec = makeSpec(row, visual);
  const geometry = buildGeometryFromParts(spec, 'rock', row.subpart, safeName(row.stable));
  assertGeometryPolicy(spec, geometry);
  const hash = createHash('sha1').update(`${row.stable}|${spec.profile}|gpt-5.6-luna|${row.source_image}`).digest('hex').slice(0, 8);
  const targetId = `rock_${safeName(row.stable)}_${hash}_luna_v6`;
  const key = `${row.stable}_${hash}_luna_v6`;
  const outDir = outputFor(row, hash);
  const preview = previewFor(row, hash);
  const review = selfReview(spec, visual, row.bounds);
  const evidence = readEvidence(row, indexes.evidence);
  const evidenceRelative = evidence.path ? relativePath(evidence.path) : null;
  const evidenceOverride = {
    type: 'llm_visual_direct',
    authorizedBy: 'user',
    model: 'gpt-5.6-luna',
    reason: '本批岩石依使用者指定以 GPT-5.6 Luna 視覺特徵與多面體岩石契約重建；缺少 YOLO26 schema-v2 時不提升 runtime 資格。',
  };
  if (!DRY_RUN) {
    mkdirSync(outDir, { recursive: true });
    mkdirSync(PREVIEW_ROOT, { recursive: true });
    const previewModel = `${preview}.model.json`;
    writeJsonAtomic(previewModel, geometry.modelJson);
    execFileSync(PYTHON, [PREVIEW_RENDERER, previewModel, preview], { timeout: 30_000 });
    const features = {
      ...geometry.featuresJson,
      schemaVersion: 1,
      sourceImage: row.source_image,
      sourceFullPath: row.sourcePath,
      oldV6: { key: row.key, style: row.style, bounds: row.bounds, partNames: row.oldPartNames },
      lunaVisualFeatures: visual,
      yolo26: { schemaVersion: evidence.schemaVersion, evidenceStatus: evidence.status, featureFile: evidenceRelative, target: evidence.target },
      evidenceStatus: evidence.status,
      evidenceOverride,
      attachments: spec.flags,
      visualGeometryPolicy: spec.visualGeometryPolicy,
      eligible: false,
      pipelineEligibility: 'awaiting_human_review',
      localModel: 'gpt-5.6-luna',
      similarityReview: review,
      reconstructionNote: spec.note,
    };
    const metadata = {
      id: targetId,
      key,
      family: 'rock',
      subpart: row.subpart,
      style: spec.style,
      symmetryMode: spec.symmetryMode,
      similarityScore: review.similarityScore,
      similarityReview: review.critique,
      similarityVerdict: review.verdict,
      similarityCorrections: review.corrections,
      version: 6,
      verStr: 'v6',
      method: 'gpt-5.6-luna_visual_direct',
      status: 'awaiting_human_review',
      eligible: false,
      pipelineEligibility: 'awaiting_human_review',
      source_image: row.source_image,
      source_full_path: row.sourcePath,
      yolo26: features.yolo26,
      evidenceOverride,
      lunaVisualFeatures: visual,
      attachments: spec.flags,
      visualGeometryPolicy: spec.visualGeometryPolicy,
      preview: relativePath(preview),
      bounds: geometry.bounds,
      reconstructionNote: spec.note,
      created_at: new Date().toISOString(),
      humanVerdictPreserved: true,
    };
    writeJsonAtomic(join(outDir, 'model.json'), geometry.modelJson);
    writeJsonAtomic(join(outDir, 'features.json'), features);
    writeJsonAtomic(join(outDir, 'metadata.json'), metadata);
    writeTextAtomic(join(outDir, 'model.obj'), geometry.objContent);
  }
  return {
    target: row.stable,
    status: DRY_RUN ? 'validated' : 'awaiting_human_review',
    targetId,
    key,
    family: 'rock',
    subpart: row.subpart,
    image: row.source_image,
    sourceFound: Boolean(row.sourcePath),
    sourcePath: row.sourcePath,
    profile: spec.profile,
    style: spec.style,
    symmetryMode: spec.symmetryMode,
    featureEvidence: evidence.status,
    visualCapture: visual.status || 'missing_visual_capture',
    evidenceOverride: evidenceOverride.type,
    eligible: false,
    pipelineEligibility: 'awaiting_human_review',
    similarityReview: review,
    outputDir: relativePath(outDir),
    preview: relativePath(preview),
    bounds: geometry.bounds,
    parts: geometry.modelJson.parts.length,
    attachments: spec.flags,
    visualGeometryPolicy: spec.visualGeometryPolicy,
  };
}

function writeReport(results) {
  if (DRY_RUN) return;
  writeJsonAtomic(join(PREVIEW_ROOT, 'rock_luna_v6_candidates.json'), {
    model: 'gpt-5.6-luna',
    generatedAt: new Date().toISOString(),
    humanVerdictsPreserved: true,
    runtimeEligible: false,
    candidates: results,
  });
}

function main() {
  if (!DRY_RUN && !existsSync(PYTHON)) throw new Error(`找不到 Python: ${PYTHON}`);
  const { rows, totalEligible } = loadTargets();
  if (!rows.length) throw new Error('沒有符合條件的 rock/v6 目標');
  const indexes = { sources: sourceIndex(), evidence: evidenceIndex() };
  const sourcePaths = new Map(rows.map((row) => [row.stable, resolveSource(row, indexes.sources)]));
  for (const row of rows) row.sourcePath = sourcePaths.get(row.stable);
  const visualFeatures = captureVisualFeatures(rows, sourcePaths);
  console.log(`rock/v6 未標記目標: ${totalEligible}；本次處理: ${rows.length}；模式: ${DRY_RUN ? 'dry-run' : 'candidate'}`);
  const results = [];
  const profileCounts = {};
  for (const row of rows) {
    try {
      const result = processTarget(row, indexes, visualFeatures);
      results.push(result);
      profileCounts[result.profile] = (profileCounts[result.profile] || 0) + 1;
      console.log(`✓ ${result.target} → ${result.profile} parts=${result.parts} visual=${result.visualCapture}`);
    } catch (error) {
      results.push({ target: row.stable, status: 'failed', reason: error.message, eligible: false });
      console.error(`✗ ${row.stable}: ${error.message}`);
    }
  }
  writeReport(results);
  console.log(`完成: ${results.filter((result) => result.status !== 'failed').length}；失敗: ${results.filter((result) => result.status === 'failed').length}`);
  console.log(`岩石分型: ${Object.entries(profileCounts).map(([profile, count]) => `${profile}=${count}`).join(', ')}`);
  console.log('候選全部維持 awaiting_human_review / eligible=false，未修改 review state、資料庫或 parts manifest。');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
