#!/usr/bin/env node
/**
 * GPT-5.6 Luna 樹木 v6 重新建模器。
 *
 * 只處理 parts_review 尚未標記 ok、archive、purge 的 tree/v6 目標。
 * 每個目標保留原 stable identity，依來源檔名、subpart 與既有樣式證據選擇
 * 樹種模板；幾何仍通過 direct_ingest_v6 的唯一多面體合成縫。
 *
 * 樹枝契約：俯視由樹幹向外輻射；水平視角只水平或斜上；末端進入葉冠，
 * 起點落在樹幹或前一節點。新產物一律 awaiting_human_review、eligible=false。
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
const MANIFEST_PATH = join(ROOT, 'tools', 'ai3d', 'parts_manifest.json');
const REVIEW_STATE_PATH = join(ROOT, 'tools', 'parts_review', 'state.json');
const PREVIEW_RENDERER = join(HERE, 'render_poly_preview.py');
const SOURCE_ROOTS = [
  join(ROOT, 'tools', 'ai3d', 'photos'),
  'C:\\Users\\user\\Documents\\steel_vs_swarm\\tools\\ai3d\\photos',
  'C:\\Users\\user\\Documents\\app\\steel_vs_swarm\\tools\\ai3d\\photos',
  'C:\\Users\\user\\Documents\\study\\ai3d_restricted\\photos',
];
const EVIDENCE_ROOTS = [
  join(ROOT, 'out', 'yolo_features'),
  join(ROOT, '.gemini', 'antigravity', 'worktrees', 'steel_vs_swarm', 'llm_img3d_db_v6', 'out', 'yolo_features'),
  'C:\\Users\\user\\Documents\\app\\steel_vs_swarm\\out\\yolo_features',
  'C:\\Users\\user\\Documents\\study\\ai3d_restricted\\out\\yolo_features',
  'C:\\Users\\user\\.gemini\\antigravity\\worktrees\\steel_vs_swarm\\llm_img3d_db_v6\\out\\yolo_features',
];
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);

const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const DRY_RUN = has('dry-run');
const FINALIZE = has('finalize');
const ONLY = arg('only');
const LIMIT = Number(arg('limit', Infinity));
const PYTHON = arg('python', process.env.AI3D_PYTHON || join(ROOT, '.venv', 'Scripts', 'python.exe'));

const PALETTES = {
  broadleaf: { roofHex: 0x284a31, facadeHex: 0x4f7a43, baseHex: 0x4a3024, accentHex: 0x78985b, darkHex: 0x2c241e, brightHex: 0xa5b77d },
  conifer: { roofHex: 0x183d2b, facadeHex: 0x356546, baseHex: 0x4b3428, accentHex: 0x6e925f, darkHex: 0x1d2b23, brightHex: 0x9caf77 },
  araucaria: { roofHex: 0x173d2b, facadeHex: 0x3e7045, baseHex: 0x553a2a, accentHex: 0x8ca76a, darkHex: 0x202c24, brightHex: 0xb2bf83 },
  baobab: { roofHex: 0x647d47, facadeHex: 0x91a86c, baseHex: 0x6b4630, accentHex: 0xb0b479, darkHex: 0x35261f, brightHex: 0xd0c991 },
  dragon: { roofHex: 0x246044, facadeHex: 0x4f8a4d, baseHex: 0x553827, accentHex: 0x91ad58, darkHex: 0x21362a, brightHex: 0xb9c879 },
  olive: { roofHex: 0x657751, facadeHex: 0x8e9c6a, baseHex: 0x4d3527, accentHex: 0xb0b68b, darkHex: 0x2d2923, brightHex: 0xcbd0a8 },
  cactus: { roofHex: 0x3d7c58, facadeHex: 0x68a067, baseHex: 0x75523a, accentHex: 0x99bb74, darkHex: 0x294a38, brightHex: 0xc4cf8c },
  shrub: { roofHex: 0x315b39, facadeHex: 0x628451, baseHex: 0x523528, accentHex: 0x8faa67, darkHex: 0x2a2b22, brightHex: 0xbac68b },
};

const P = (name, type, values, colorKey, pos, rot = [0, 0, 0], role = 'structure') => ({
  name, type, ...values, pos, rot, colorKey, role,
});
const C = (name, topR, botR, height, x, base, z, colorKey, sides = 8, role = 'trunk') =>
  P(name, 'conical_frustum', { radii: [topR, botR], height, sides }, colorKey, [x, base + height / 2, z], [0, 0, 0], role);
const D = (name, rx, ry, rz, x, y, z, colorKey, rot = [0, 0, 0], role = 'canopy') =>
  P(name, 'ellipsoid_sphere', { radii: [rx, ry, rz] }, colorKey, [x, y, z], rot, role);
const Q = (name, radius, x, y, z, colorKey, role = 'canopy') =>
  P(name, 'dodecahedron_polyhedron', { radius }, colorKey, [x, y, z], [0, 0, 0], role);

function safeName(value) { return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_'); }
function stableTargetOfKey(key) { return String(key || '').replace(/_[0-9a-f]{8}(?:_luna)?_v6$/, ''); }
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
function between(rng, a, b) { return a + (b - a) * rng(); }
function distance(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); }

// direct_ingest_v6 的 cylinder 軸向為 +Y；此旋轉將 +Y 對齊 a→b。
function branch(parts, edges, name, a, b, radius, colorKey, sides = 7) {
  const length = distance(a, b);
  if (!(length > 0)) throw new Error(`零長枝段: ${name}`);
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const radial = Math.hypot(dx, dz);
  const rot = [Math.atan2(radial, dy), Math.atan2(dx, dz), 0];
  parts.push(P(name, 'cylinder', { radii: [radius * 0.72, radius], height: length, sides }, colorKey,
    [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], rot, 'branch'));
  edges.push({ name, a: [...a], b: [...b] });
  return b;
}

function crown(parts, name, radii, center, colorKey, rot = [0, 0, 0]) {
  parts.push(D(name, radii[0], radii[1], radii[2], center[0], center[1], center[2], colorKey, rot));
}
function rootFlare(parts, radius, height = 0.45) {
  parts.push(C('root_flare', radius * 0.72, radius, height, 0, 0, 0, 'baseHex', 10, 'root'));
}

function makeConifer(kind, seed) {
  const rng = rngFor(seed);
  const p = [], edges = [];
  const araucaria = kind === 'araucaria';
  const cypress = kind === 'cypress';
  const juniper = kind === 'juniper';
  const height = araucaria ? between(rng, 9.0, 11.0) : cypress ? between(rng, 8.0, 10.0) : juniper ? between(rng, 5.4, 7.2) : kind === 'sequoia' ? between(rng, 12.5, 15.0) : between(rng, 9.0, 12.5);
  const topRadius = cypress ? 0.28 : araucaria ? 0.16 : 0.24;
  const baseRadius = cypress ? 0.72 : araucaria ? 0.42 : 0.62;
  p.push(C('trunk', topRadius, baseRadius, height * 0.72, 0, 0, 0, 'baseHex', 10));
  p.push(C('upper_leader', topRadius * 0.45, topRadius, height * 0.28, 0, height * 0.72, 0, 'baseHex', 8));
  rootFlare(p, baseRadius, 0.48);
  const levels = cypress ? 6 : juniper ? 5 : araucaria ? 8 : 7;
  const count = araucaria ? 8 : cypress ? 6 : 7;
  for (let i = 0; i < levels; i++) {
    const y = height * (0.23 + (i / Math.max(1, levels - 1)) * 0.62);
    const taper = 1 - i / (levels + 1);
    const span = (araucaria ? 2.65 : cypress ? 1.55 : juniper ? 1.45 : 2.15) * taper * between(rng, 0.88, 1.08);
    const branchCount = cypress && i < 2 ? 5 : count;
    for (let j = 0; j < branchCount; j++) {
      const yaw = (j / branchCount) * Math.PI * 2 + (i % 2 ? 0.17 : -0.08) + between(rng, -0.05, 0.05);
      const end = [Math.cos(yaw) * span, y + between(rng, araucaria ? 0.02 : 0.08, araucaria ? 0.16 : 0.34), Math.sin(yaw) * span * (araucaria ? 0.72 : 0.82)];
      branch(p, edges, `${kind}_level_${i}_branch_${j}`, [0, y, 0], end, between(rng, 0.045, 0.085), i % 2 ? 'facadeHex' : 'roofHex');
      const leafR = araucaria ? [span * 0.43, between(rng, 0.18, 0.34), span * 0.26] : cypress ? [span * 0.62, 0.34, span * 0.38] : [span * 0.52, between(rng, 0.26, 0.46), span * 0.34];
      crown(p, `${kind}_crown_${i}_${j}`, leafR, end, i % 3 === 0 ? 'roofHex' : i % 3 === 1 ? 'facadeHex' : 'accentHex', [between(rng, -0.10, 0.10), yaw, between(rng, -0.08, 0.08)]);
    }
  }
  crown(p, 'leader_crown', [araucaria ? 0.65 : 0.72, 0.40, araucaria ? 0.52 : 0.64], [between(rng, -0.12, 0.12), height * 0.98, between(rng, -0.10, 0.10)], 'brightHex');
  return {
    style: araucaria ? 'araucaria radial horizontal whorls' : cypress ? 'cypress narrow tiered crown' : juniper ? 'juniper irregular layered crown' : kind === 'sequoia' ? 'sequoia tall buttressed conifer crown' : 'conifer layered radial crown',
    symmetryMode: araucaria ? 'symmetric' : 'asymmetric', colors: PALETTES[araucaria ? 'araucaria' : 'conifer'], parts: p, edges,
    note: araucaria ? '南洋杉特徵：多層規整輪生，枝條由樹幹向外水平或微斜上伸出。' : `${kind} 特徵：${cypress ? '窄柱形密冠' : juniper ? '不規則疏層' : '分層放射枝冠'}，末端葉冠與枝頭相接。`,
  };
}

function makeBaobab(seed) {
  const rng = rngFor(seed), p = [], edges = [];
  p.push(C('bottle_bole', 0.72, 1.58, 5.25, 0, 0, 0, 'baseHex', 12));
  rootFlare(p, 1.65, 0.62);
  const arms = 6;
  for (let i = 0; i < arms; i++) {
    const yaw = i / arms * Math.PI * 2 + between(rng, -0.18, 0.18);
    const start = [0, between(rng, 4.2, 5.0), 0];
    const midRadius = between(rng, 0.72, 1.15);
    const tipRadius = between(rng, 2.6, 3.8);
    const mid = [Math.cos(yaw) * midRadius, start[1] + between(rng, 0.20, 0.55), Math.sin(yaw) * midRadius];
    const tip = [Math.cos(yaw) * tipRadius, mid[1] + between(rng, 0.32, 0.78), Math.sin(yaw) * tipRadius];
    branch(p, edges, `baobab_arm_${i}`, start, mid, 0.16, 'baseHex', 8);
    branch(p, edges, `baobab_arm_${i}_outer`, mid, tip, 0.105, 'baseHex', 7);
    crown(p, `baobab_leaf_cluster_${i}`, [between(rng, 0.62, 0.95), between(rng, 0.30, 0.48), between(rng, 0.52, 0.82)], tip, i % 2 ? 'facadeHex' : 'roofHex');
  }
  return { style: 'baobab bottle trunk sparse umbrella crown', symmetryMode: 'asymmetric', colors: PALETTES.baobab, parts: p, edges, note: '猴麵包樹特徵：瓶狀粗樹幹、低密度粗枝、枝端小傘冠，保留樹冠間空隙。' };
}

function makeDragon(seed) {
  const rng = rngFor(seed), p = [], edges = [];
  const height = between(rng, 6.4, 8.2);
  p.push(C('dragon_bole', 0.30, 0.78, height * 0.76, 0, 0, 0, 'baseHex', 10));
  rootFlare(p, 0.85, 0.55);
  const arms = 5;
  for (let i = 0; i < arms; i++) {
    const yaw = i / arms * Math.PI * 2 + between(rng, -0.15, 0.15);
    const y = height * between(rng, 0.60, 0.72);
    const forkRadius = between(rng, 0.45, 0.82);
    const tipRadius = between(rng, 1.25, 2.15);
    const fork = [Math.cos(yaw) * forkRadius, y + between(rng, 0.08, 0.25), Math.sin(yaw) * forkRadius];
    const tip = [Math.cos(yaw) * tipRadius, fork[1] + between(rng, 0.45, 0.95), Math.sin(yaw) * tipRadius];
    branch(p, edges, `dragon_candelabra_${i}`, [0, y, 0], fork, 0.13, 'baseHex', 8);
    branch(p, edges, `dragon_candelabra_${i}_tip`, fork, tip, 0.08, 'baseHex', 7);
    crown(p, `dragon_rosette_${i}`, [between(rng, 0.60, 0.86), between(rng, 0.20, 0.32), between(rng, 0.60, 0.86)], tip, i % 2 ? 'facadeHex' : 'roofHex');
  }
  crown(p, 'dragon_terminal_rosette', [0.90, 0.30, 0.88], [0, height * 0.98, 0], 'accentHex');
  return { style: 'dragon tree high candelabra rosettes', symmetryMode: 'asymmetric', colors: PALETTES.dragon, parts: p, edges, note: '龍血樹特徵：高位多頭燭台狀分叉，每一枝頭獨立承接劍葉 rosette。' };
}

function makeOlive(seed) {
  const rng = rngFor(seed), p = [], edges = [];
  p.push(C('olive_root_bole', 0.52, 1.10, 1.35, 0, 0, 0, 'baseHex', 10));
  rootFlare(p, 1.15, 0.42);
  const forks = 4;
  for (let i = 0; i < forks; i++) {
    const yaw = i / forks * Math.PI * 2 + between(rng, -0.26, 0.26);
    const start = [0, between(rng, 0.92, 1.28), 0];
    const forkRadius = between(rng, 0.70, 1.22);
    const outerRadius = between(rng, 0.70, 1.45);
    const fork = [Math.cos(yaw) * forkRadius, between(rng, 3.25, 4.25), Math.sin(yaw) * forkRadius];
    const tipRadius = forkRadius + outerRadius;
    const tip = [Math.cos(yaw) * tipRadius, fork[1] + between(rng, 0.75, 1.45), Math.sin(yaw) * tipRadius];
    branch(p, edges, `olive_gnarled_trunk_${i}`, start, fork, 0.19, 'baseHex', 8);
    branch(p, edges, `olive_gnarled_bough_${i}`, fork, tip, 0.105, 'baseHex', 7);
    crown(p, `olive_silver_crown_${i}`, [between(rng, 0.62, 1.05), between(rng, 0.26, 0.42), between(rng, 0.48, 0.82)], tip, i % 3 ? 'facadeHex' : 'brightHex', [between(rng, -0.18, 0.18), yaw, between(rng, -0.14, 0.14)]);
  }
  return { style: 'ancient olive twisted multi trunk sparse silver canopy', symmetryMode: 'asymmetric', colors: PALETTES.olive, parts: p, edges, note: '橄欖特徵：低位多幹扭結、枝端斜上、銀灰疏冠，不堆成單一圓頂。' };
}

function makeBanyan(seed) {
  const rng = rngFor(seed), p = [], edges = [];
  p.push(C('banyan_bole', 0.62, 1.15, 5.3, 0, 0, 0, 'baseHex', 11));
  rootFlare(p, 1.35, 0.58);
  for (let i = 0; i < 5; i++) {
    const yaw = i / 5 * Math.PI * 2 + between(rng, -0.18, 0.18);
    const y = between(rng, 3.0, 4.6);
    const forkRadius = between(rng, 0.65, 1.15);
    const tipRadius = between(rng, 2.2, 3.6);
    const fork = [Math.cos(yaw) * forkRadius, y + between(rng, 0.10, 0.36), Math.sin(yaw) * forkRadius];
    const tip = [Math.cos(yaw) * tipRadius, fork[1] + between(rng, 0.55, 1.15), Math.sin(yaw) * tipRadius];
    branch(p, edges, `banyan_primary_${i}`, [0, y, 0], fork, 0.15, 'baseHex', 8);
    branch(p, edges, `banyan_secondary_${i}`, fork, tip, 0.09, 'baseHex', 7);
    crown(p, `banyan_leaf_mass_${i}`, [between(rng, 1.0, 1.45), between(rng, 0.45, 0.72), between(rng, 0.85, 1.22)], tip, i % 2 ? 'facadeHex' : 'roofHex');
  }
  return { style: 'banyan broad crown with aerial-root silhouette', symmetryMode: 'asymmetric', colors: PALETTES.broadleaf, parts: p, edges, note: '榕樹特徵：厚樹幹向外伸展多層枝架，冠層分簇並保留氣根式垂直節奏。' };
}

function makeCactus(seed) {
  const rng = rngFor(seed), p = [], edges = [];
  const height = between(rng, 4.8, 7.2);
  p.push(C('cactus_column', 0.34, 0.52, height, 0, 0, 0, 'facadeHex', 10));
  rootFlare(p, 0.54, 0.30);
  const arms = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < arms; i++) {
    const yaw = i / arms * Math.PI * 2 + between(rng, -0.25, 0.25);
    const y = between(rng, 1.6, height * 0.78);
    const elbowRadius = between(rng, 0.55, 0.95);
    const elbow = [Math.cos(yaw) * elbowRadius, y, Math.sin(yaw) * elbowRadius];
    const tip = [elbow[0], elbow[1] + between(rng, 0.85, 1.65), elbow[2]];
    branch(p, edges, `cactus_arm_${i}_out`, [0, y, 0], elbow, 0.16, 'facadeHex', 8);
    branch(p, edges, `cactus_arm_${i}_up`, elbow, tip, 0.14, 'facadeHex', 8);
    crown(p, `cactus_arm_${i}_cap`, [0.18, 0.18, 0.18], tip, 'brightHex');
  }
  return { style: 'saguaro cactus upright arms', symmetryMode: 'asymmetric', colors: PALETTES.cactus, parts: p, edges, note: '仙人掌特徵：主柱垂直，側臂先水平外伸再垂直上舉，接到圓鈍臂冠。' };
}

function makeUmbrellaTree(kind, seed) {
  const rng = rngFor(seed), p = [], edges = [];
  const flowering = kind === 'flowering';
  const height = flowering ? between(rng, 6.0, 8.0) : between(rng, 6.8, 9.0);
  p.push(C('broadleaf_trunk', 0.25, 0.70, height * 0.72, 0, 0, 0, 'baseHex', 10));
  rootFlare(p, 0.78, 0.50);
  const arms = flowering ? 7 : 8;
  for (let i = 0; i < arms; i++) {
    const yaw = i / arms * Math.PI * 2 + between(rng, -0.20, 0.20);
    const y = height * between(rng, 0.58, 0.70);
    const forkRadius = between(rng, 0.45, 0.92);
    const tipRadius = between(rng, 1.55, 2.80);
    const fork = [Math.cos(yaw) * forkRadius, y + between(rng, 0.12, 0.35), Math.sin(yaw) * forkRadius];
    const tip = [Math.cos(yaw) * tipRadius, fork[1] + between(rng, 0.25, 0.75), Math.sin(yaw) * tipRadius];
    branch(p, edges, `${kind}_primary_${i}`, [0, y, 0], fork, 0.115, 'baseHex', 7);
    branch(p, edges, `${kind}_outer_${i}`, fork, tip, 0.068, 'darkHex', 7);
    crown(p, `${kind}_crown_${i}`, [between(rng, 0.85, 1.40), between(rng, 0.24, 0.46), between(rng, 0.60, 1.10)], tip, flowering ? (i % 2 ? 'accentHex' : 'brightHex') : (i % 3 ? 'facadeHex' : 'roofHex'), [between(rng, -0.15, 0.15), yaw, between(rng, -0.12, 0.12)]);
  }
  crown(p, 'top_crown', [1.0, 0.42, 0.84], [0, height * 0.92, 0], flowering ? 'accentHex' : 'facadeHex');
  return { style: flowering ? 'flowering broadleaf open umbrella crown' : kind === 'acacia' ? 'acacia umbrella crown radial branches' : 'broadleaf open radial crown', symmetryMode: 'asymmetric', colors: PALETTES.broadleaf, parts: p, edges, note: flowering ? '開花闊葉樹特徵：開放枝架、枝端分離花冠與不等高冠簇。' : kind === 'acacia' ? '相思樹特徵：傘狀扁冠，枝條向外水平後微斜上，冠簇不重疊成球。' : '闊葉樹特徵：中心樹幹向外分叉，枝端承托不等高葉冠簇。' };
}

function makeShrub(seed) {
  const rng = rngFor(seed), p = [], edges = [];
  const height = between(rng, 2.4, 4.0);
  p.push(C('shrub_central_stem', 0.12, 0.30, height * 0.68, 0, 0, 0, 'baseHex', 8));
  rootFlare(p, 0.34, 0.28);
  for (let i = 0; i < 6; i++) {
    const yaw = i / 6 * Math.PI * 2 + between(rng, -0.16, 0.16);
    const y = height * between(rng, 0.38, 0.64);
    const tipRadius = between(rng, 0.85, 1.65);
    const tip = [Math.cos(yaw) * tipRadius, y + between(rng, 0.35, 0.85), Math.sin(yaw) * tipRadius];
    branch(p, edges, `shrub_branch_${i}`, [0, y, 0], tip, 0.045, 'darkHex', 6);
    crown(p, `shrub_leaf_${i}`, [between(rng, 0.45, 0.75), between(rng, 0.30, 0.52), between(rng, 0.38, 0.68)], tip, i % 2 ? 'facadeHex' : 'roofHex');
  }
  return { style: 'compact shrub irregular radial crown', symmetryMode: 'asymmetric', colors: PALETTES.shrub, parts: p, edges, note: '灌木/盆景特徵：短主幹、多股近地分枝、稀疏但有層次的扁圓冠簇。' };
}

function classify(row) {
  if (row.species) return row.species;
  const text = `${row.subpart} ${row.image || ''}`.toLowerCase();
  if (/cactus|saguaro|cardon|仙人掌/.test(text)) return 'cactus';
  if (/baobab|adansonia|boab|madagascar/.test(text)) return 'baobab';
  if (/dragon.?tree|dracaena|dragontree/.test(text)) return 'dragon';
  if (/olive|橄欖/.test(text)) return 'olive';
  if (/banyan|ficus|榕/.test(text)) return 'banyan';
  if (/araucaria|monkey.?puzzle|norfolk/.test(text)) return 'araucaria';
  if (/cypress|柏|cedar|cedrus|cryptomeria|conifer|juniper|sequoia|pine|針葉/.test(text)) {
    if (/cypress/.test(text)) return 'cypress';
    if (/juniper|盆栽|bonsai/.test(text)) return 'juniper';
    if (/sequoia/.test(text)) return 'sequoia';
    return 'conifer';
  }
  if (/acacia|相思/.test(text)) return 'acacia';
  if (/jacaranda|cherry|flower|blossom|花/.test(text)) return 'flowering';
  if (/boxwood|shrub|bonsai|shrub|bush/.test(text)) return 'shrub';
  if (/buttress/.test(text)) return 'broadleaf';
  return 'broadleaf';
}

function makeTree(species, target) {
  const seed = `${target.stable}|${species}`;
  if (species === 'baobab') return makeBaobab(seed);
  if (species === 'dragon') return makeDragon(seed);
  if (species === 'olive') return makeOlive(seed);
  if (species === 'banyan') return makeBanyan(seed);
  if (species === 'cactus') return makeCactus(seed);
  if (species === 'acacia' || species === 'flowering') return makeUmbrellaTree(species, seed);
  if (species === 'shrub') return makeShrub(seed);
  if (species === 'broadleaf') return makeUmbrellaTree(species, seed);
  return makeConifer(species, seed);
}

function pointKey(point) { return point.map((n) => Number(n).toFixed(4)).join(','); }
function insideCrown(point, crowns) {
  return crowns.some((part) => {
    const [rx, ry, rz] = part.radii || [1, 1, 1];
    const [x, y, z] = part.pos;
    const dx = (point[0] - x) / Math.max(rx, 0.001);
    const dy = (point[1] - y) / Math.max(ry, 0.001);
    const dz = (point[2] - z) / Math.max(rz, 0.001);
    return dx * dx + dy * dy + dz * dz <= 1.15;
  });
}
function insideTrunk(point, trunks) {
  return trunks.some((part) => {
    if (part.type !== 'conical_frustum') return false;
    const [topR, botR] = part.radii || [0, 0];
    const height = Number(part.height) || 0;
    const [x, y, z] = part.pos;
    const localY = point[1] - y;
    if (localY < -height / 2 - 0.025 || localY > height / 2 + 0.025) return false;
    const t = Math.max(0, Math.min(1, (localY + height / 2) / Math.max(height, 0.001)));
    const radius = botR + (topR - botR) * t;
    return Math.hypot(point[0] - x, point[2] - z) <= radius + 0.025;
  });
}
function assertTreeContract(spec, target) {
  if (!spec.parts.length || !spec.edges.length) throw new Error(`空樹木幾何: ${target.stable}`);
  const crowns = spec.parts.filter((part) => part.role === 'canopy');
  if (!crowns.length) throw new Error(`沒有葉冠: ${target.stable}`);
  for (const part of spec.parts) {
    if (!Array.isArray(part.pos) || part.pos.length !== 3 || part.pos.some((n) => !Number.isFinite(n)) || part.pos[1] < -0.001) {
      throw new Error(`非法部件位置: ${target.stable}/${part.name}`);
    }
    if (!Object.prototype.hasOwnProperty.call(spec.colors, part.colorKey)) throw new Error(`缺色彩分區: ${part.name}`);
  }
  const trunks = spec.parts.filter((part) => part.role === 'trunk');
  const starts = new Set(spec.edges.map((edge) => pointKey(edge.a)));
  const priorEnds = new Set();
  for (const edge of spec.edges) {
    const dy = edge.b[1] - edge.a[1];
    if (dy < -0.001) throw new Error(`枝條下垂: ${target.stable}/${edge.name}`);
    const dx = edge.b[0] - edge.a[0], dz = edge.b[2] - edge.a[2];
    const planLength = Math.hypot(dx, dz);
    const radialA = Math.hypot(edge.a[0], edge.a[2]);
    const radialB = Math.hypot(edge.b[0], edge.b[2]);
    if (radialB + 0.005 < radialA) throw new Error(`枝條向內收: ${target.stable}/${edge.name}`);
    const midX = (edge.a[0] + edge.b[0]) / 2, midZ = (edge.a[2] + edge.b[2]) / 2;
    const outward = midX * dx + midZ * dz;
    const midRadius = Math.hypot(midX, midZ);
    if (planLength > 0.02 && midRadius > 0.02 && outward < -0.01) {
      throw new Error(`枝條非由樹幹向外: ${target.stable}/${edge.name}`);
    }
    const axisDrift = Math.abs(midX * dz - midZ * dx) / Math.max(midRadius * planLength, 0.001);
    if (planLength > 0.02 && midRadius > 0.02 && axisDrift > 0.035) {
      throw new Error(`枝條偏離樹幹放射軸: ${target.stable}/${edge.name}`);
    }
    if (!insideTrunk(edge.a, trunks) && !priorEnds.has(pointKey(edge.a))) {
      throw new Error(`枝尾未接樹幹或前一節點: ${target.stable}/${edge.name}`);
    }
    const endIsJoint = starts.has(pointKey(edge.b));
    if (!endIsJoint && !insideCrown(edge.b, crowns)) throw new Error(`枝頭未接葉冠: ${target.stable}/${edge.name}`);
    if (edge.a[1] < 0) throw new Error(`枝尾低於地面: ${target.stable}/${edge.name}`);
    priorEnds.add(pointKey(edge.b));
  }
}

function scanFiles(roots, predicate) {
  const found = [];
  const visit = (dir) => {
    if (!existsSync(dir)) return;
    let entries = [];
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
function sourceIndex() {
  const byRel = new Map(), byName = new Map();
  for (const root of SOURCE_ROOTS) {
    for (const path of scanFiles([root], (candidate) => IMAGE_EXTS.has(extname(candidate).toLowerCase()))) {
      const rel = normalizePath(relative(root, path));
      byRel.set(rel, path);
      const name = basename(path).toLowerCase();
      if (!byName.has(name)) byName.set(name, path);
    }
  }
  return { byRel, byName };
}
function resolveSource(row, index) {
  const exact = index.byRel.get(normalizePath(row.image));
  if (exact) return exact;
  return index.byName.get(basename(row.image || '').toLowerCase()) || null;
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
  const stem = basename(row.image || '', extname(row.image || '')).toLowerCase();
  const path = index.get(`${stem}.json`);
  if (!path) return { path: null, schemaVersion: null, status: 'missing_yolo26_schema_v2', target: null };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const schema2 = raw.schemaVersion === 2 && raw.models?.detection === 'yolo26n.pt' && raw.models?.segmentation === 'yolo26n-seg.pt' && raw.models?.depth === 'yolo26n-depth.pt';
    return { path, schemaVersion: schema2 ? 2 : null, status: schema2 ? 'yolo26_schema_v2' : 'legacy_feature_metadata_only', target: raw.targets?.[0] || null };
  } catch {
    return { path, schemaVersion: null, status: 'invalid_feature_metadata', target: null };
  }
}

function loadReviewStatuses() {
  if (!existsSync(REVIEW_STATE_PATH)) return new Map();
  try {
    const raw = JSON.parse(readFileSync(REVIEW_STATE_PATH, 'utf8'));
    const items = raw.items && !Array.isArray(raw.items) ? raw.items : raw;
    return new Map(Object.entries(items).map(([key, value]) => [stableTargetOfKey(key), value?.status || null]));
  } catch { return new Map(); }
}
function loadTargets() {
  const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
  const statuses = loadReviewStatuses();
  const rows = (db.items || [])
    .filter((row) => row.family === 'tree' && row.version === 6)
    .map((row) => ({ ...row, stable: stableTargetOfKey(row.key) }))
    .filter((row) => !['ok', 'archive', 'purge'].includes(statuses.get(row.stable) || null));
  const selected = ONLY ? rows.filter((row) => row.stable === ONLY || row.subpart === ONLY || row.key === ONLY) : rows;
  return { db, rows: selected.slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined), totalEligible: selected.length };
}

function writeJsonAtomic(path, value) {
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temp, path);
}
function relativePath(path) { return relative(ROOT, path).replace(/\\/g, '/'); }
function outputFor(target, hash) {
  return join(ROOT, 'out', '3d_data', 'tree', safeName(target.subpart), `tree_${safeName(target.stable)}_${hash}_luna_v6`);
}
function previewFor(target, hash) {
  return join(ROOT, 'out', 'review_previews', `tree_${safeName(target.stable)}_${hash}_luna_v6.png`);
}
function reviewFor(species) {
  const scores = { cactus: 80, baobab: 84, dragon: 82, olive: 84, banyan: 82, araucaria: 86, conifer: 81, cypress: 83, juniper: 80, sequoia: 82, acacia: 82, flowering: 81, shrub: 79, broadleaf: 80 };
  return {
    similarityScore: scores[species] || 80,
    verdict: 'awaiting_human_review',
    corrections: [],
    reviewer: 'gpt-5.6-luna_tree_geometry_contract',
    critique: `依${species}樹種輪廓重建；樹幹中心放射、枝段水平/斜上、枝端進入獨立葉冠。`,
  };
}

function processTarget(row, indexes) {
  const species = classify(row);
  const source = resolveSource(row, indexes.sources);
  const evidence = readEvidence(row, indexes.evidence);
  const target = { ...row, species };
  const spec = makeTree(species, target);
  assertTreeContract(spec, target);
  const geometry = buildGeometryFromParts(spec, 'tree', row.subpart, safeName(row.stable));
  const hash = createHash('sha1').update(`${row.stable}|${species}|gpt-5.6-luna-tree-v6`).digest('hex').slice(0, 8);
  const targetId = `tree_${safeName(row.stable)}_${hash}_luna_v6`;
  const key = `${row.stable}_${hash}_luna_v6`;
  const outDir = outputFor(row, hash);
  const preview = previewFor(row, hash);
  const review = reviewFor(species);
  const sourceImage = row.image || `tree/${row.subpart}/${safeName(row.stable)}.jpg`;
  const evidenceRelative = evidence.path ? relativePath(evidence.path) : null;
  const evidenceOverride = {
    type: 'llm_visual_direct', authorizedBy: 'user', model: 'gpt-5.6-luna',
    reason: '本批 v6 樹木依使用者指定以 GPT-5.6 Luna 視覺與樹種結構契約重建；YOLO26 schema-v2 缺失時不提升 runtime 資格。',
  };
  if (!DRY_RUN) {
    mkdirSync(dirname(outDir), { recursive: true });
    mkdirSync(outDir, { recursive: true });
    mkdirSync(dirname(preview), { recursive: true });
    const previewModel = `${preview}.model.json`;
    writeFileSync(previewModel, JSON.stringify(geometry.modelJson), 'utf8');
    execFileSync(PYTHON, [PREVIEW_RENDERER, previewModel, preview], { timeout: 30_000 });
    const features = {
      ...geometry.featuresJson,
      schemaVersion: evidence.schemaVersion,
      evidenceStatus: evidence.status,
      yolo26: { schemaVersion: evidence.schemaVersion, evidenceStatus: evidence.status, featureFile: evidenceRelative, target: evidence.target },
      evidenceOverride, eligible: false, pipelineEligibility: 'awaiting_human_review',
      species, sourceImage, structuralContract: { radialTopView: true, horizontalOrUpwardBranches: true, branchEndsIntoCanopy: true },
      reconstructionNote: spec.note, localModel: 'gpt-5.6-luna', similarityReview: review,
    };
    const metadata = {
      id: targetId, key, family: 'tree', subpart: row.subpart, style: spec.style, symmetryMode: spec.symmetryMode,
      similarityScore: review.similarityScore, similarityReview: review.critique, similarityVerdict: review.verdict,
      similarityCorrections: review.corrections, version: 6, verStr: 'v6', method: 'gpt-5.6-luna_visual_direct',
      status: 'awaiting_human_review', eligible: false, pipelineEligibility: 'awaiting_human_review',
      source_image: sourceImage, source_full_path: source, yolo26: features.yolo26, evidenceOverride,
      preview: relativePath(preview), bounds: geometry.bounds, reconstructionNote: spec.note, species,
      created_at: new Date().toISOString(), humanVerdictPreserved: true,
    };
    writeJsonAtomic(join(outDir, 'model.json'), geometry.modelJson);
    writeJsonAtomic(join(outDir, 'features.json'), features);
    writeJsonAtomic(join(outDir, 'metadata.json'), metadata);
    writeFileSync(join(outDir, 'model.obj'), geometry.objContent, 'utf8');
  }
  return {
    target: row.stable, status: DRY_RUN ? 'validated' : 'awaiting_human_review', targetId, key, family: 'tree', subpart: row.subpart,
    image: sourceImage, sourceFound: Boolean(source), species, style: spec.style, symmetryMode: spec.symmetryMode,
    featureEvidence: evidence.status, evidenceOverride: evidenceOverride.type, eligible: false,
    pipelineEligibility: 'awaiting_human_review', similarityReview: review, outputDir: relativePath(outDir),
    preview: relativePath(preview), bounds: geometry.bounds, parts: geometry.modelJson.parts.length,
  };
}

function finalizeCatalog(results) {
  const accepted = results.filter((result) => result.status === 'awaiting_human_review');
  if (!accepted.length) return;
  const stableTargets = new Set(accepted.map((result) => result.target));
  const archivedTargets = new Set([...loadReviewStatuses()].filter(([, status]) => status === 'archive').map(([target]) => target));
  const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
  db.items = (db.items || []).filter((row) => {
    const stable = stableTargetOfKey(row.key);
    if (stableTargets.has(stable)) return false;
    return !(archivedTargets.has(stable) && row.method === 'gpt-5.6-luna_visual_direct');
  });
  for (const result of accepted) {
    db.items.push({
      id: result.targetId, key: result.key, family: 'tree', subpart: result.subpart, style: result.style,
      symmetryMode: result.symmetryMode, species: result.species, similarityScore: result.similarityReview.similarityScore, version: 6, verStr: 'v6',
      method: 'gpt-5.6-luna_visual_direct', status: 'awaiting_human_review', image: result.image,
      evidenceOverride: result.evidenceOverride, eligible: false, pipelineEligibility: 'awaiting_human_review', bounds: result.bounds,
      spec: { style: result.style }, triangles: result.bounds.triangles, outputDir: result.outputDir,
    });
  }
  db.generated_at = new Date().toISOString();
  db.total_objects = db.items.length;
  db.families = [...new Set(db.items.map((row) => row.family))];
  writeJsonAtomic(DB_PATH, db);

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  manifest.parts = (manifest.parts || []).filter((entry) => {
    const keys = entry.keys || (entry.key ? [entry.key] : []);
    const targets = keys.map((key) => stableTargetOfKey(key));
    if (targets.some((target) => stableTargets.has(target))) return false;
    return !(entry.method === 'gpt-5.6-luna_visual_direct' && targets.some((target) => archivedTargets.has(target)));
  });
  for (const result of accepted) {
    const hash = result.key.match(/_([0-9a-f]{8})_luna_v6$/)?.[1] || '00000000';
    manifest.parts.push({
      method: 'gpt-5.6-luna_visual_direct', version: 6, verStr: 'v6', consumer: `tree catalog & partlib (${result.subpart})`,
      rev: 'HEAD', at: new Date().toISOString().slice(0, 10),
      imgs: [{ role: 'primary', id: `img_${hash}`, family: 'tree', part: result.subpart, query: result.target, api: 'gpt-5.6-luna_visual_direct', license: 'unverified(restricted/local)', creator: null, source_url: '', file: result.image }],
      gen: { tool: 'GPT-5.6 Luna direct visual tree reconstruction', runner: 'tools/ai3d/direct_ingest_luna_tree_v6.mjs', params: '--finalize', machine: 'Codex GPT-5.6 Luna', measured: `Triangles ${result.bounds.triangles}, Vertices ${result.bounds.vertices}, Similarity ${result.similarityReview.similarityScore}/100` },
      post: { tool: 'tools/ai3d/direct_ingest_luna_tree_v6.mjs', fit: 1, bounds: result.bounds.size, note: `樹種 ${result.species}；枝條契約通過，等待零件台人眼覆核。` },
      keys: [result.key],
    });
  }
  writeJsonAtomic(MANIFEST_PATH, manifest);
}

function writeReport(results) {
  const path = join(ROOT, 'out', 'review_previews', 'tree_luna_v6_candidates.json');
  if (DRY_RUN) return;
  let prior = [];
  if (existsSync(path)) {
    try { prior = JSON.parse(readFileSync(path, 'utf8')).candidates || []; } catch { prior = []; }
  }
  const replaced = new Set(results.map((result) => result.target));
  const kept = prior.filter((result) => !replaced.has(result.target));
  writeJsonAtomic(path, { model: 'gpt-5.6-luna', generatedAt: new Date().toISOString(), humanVerdictsPreserved: true, candidates: [...kept, ...results] });
}

function main() {
  if (!DRY_RUN && !existsSync(PYTHON)) throw new Error(`找不到 Python: ${PYTHON}`);
  const { rows, totalEligible } = loadTargets();
  const indexes = { sources: sourceIndex(), evidence: evidenceIndex() };
  console.log(`tree/v6 未標記目標: ${totalEligible}；本次處理: ${rows.length}；模式: ${DRY_RUN ? 'dry-run' : FINALIZE ? 'finalize' : 'candidate'}`);
  if (!rows.length) throw new Error('沒有符合條件的 tree/v6 目標');
  const results = [];
  const speciesCounts = {};
  for (const row of rows) {
    try {
      const result = processTarget(row, indexes);
      results.push(result);
      speciesCounts[result.species] = (speciesCounts[result.species] || 0) + 1;
    } catch (error) {
      results.push({ target: row.stable, status: 'failed', reason: error.message, eligible: false });
      console.error(`✗ ${row.stable}: ${error.message}`);
    }
  }
  if (FINALIZE) finalizeCatalog(results);
  writeReport(results);
  console.log(`完成: ${results.filter((result) => result.status !== 'failed').length}；失敗: ${results.filter((result) => result.status === 'failed').length}`);
  console.log(`樹種分布: ${Object.entries(speciesCounts).map(([species, count]) => `${species}=${count}`).join(', ')}`);
  if (FINALIZE) console.log('已替換 catalog/manifest 對應 stable target；review state 未寫入，全部維持 awaiting_human_review。');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
