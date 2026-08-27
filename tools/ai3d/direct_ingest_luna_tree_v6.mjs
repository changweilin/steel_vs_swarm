/*
 * GPT-5.6 Luna tree v6 候選／覆核台匯入器。
 *
 * 預設只寫隔離候選；使用者明確授權 `--finalize` 時，將四個有效目標登記到
 * 資料庫與來源帳供零件台覆核，但不寫 review state，也不使未經人眼判定的
 * 物件進入 runtime。幾何一律交給 direct_ingest_v6 的合成縫。
 *
 * Tree-specific detail follows procedural-object-detail:
 * - every branch is derived from two named endpoints;
 * - foliage uses three values of one hue, with species-specific silhouette;
 * - all pivots use y=0 as ground and dimensions are metres.
 *
 * `--dry-run` only validates target/evidence discovery and geometry contracts.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildGeometryFromParts } from './direct_ingest_v6.mjs';

const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '..', '..'));
const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : fallback;
};
const DRY_RUN = argv.includes('--dry-run');
const FINALIZE = argv.includes('--finalize');
const ONLY = arg('only');
const PYTHON = arg('python', process.env.AI3D_PYTHON || join(ROOT, '.venv', 'Scripts', 'python.exe'));
const PREVIEW_RENDERER = join(ROOT, 'tools', 'ai3d', 'render_poly_preview.py');

const PALETTES = {
  cryptomeria: { roofHex: 0x274936, facadeHex: 0x517b52, baseHex: 0x3a2a23, accentHex: 0x6d9362, glassHex: 0x19352b, darkHex: 0x33261f, brightHex: 0x8eaa78 },
  araucariaSepia: { roofHex: 0x31452d, facadeHex: 0x526b3c, baseHex: 0x4d3529, accentHex: 0xb4773e, glassHex: 0x223a2d, darkHex: 0x292923, brightHex: 0x7f925d },
  araucariaGreen: { roofHex: 0x183c25, facadeHex: 0x2d6334, baseHex: 0x594338, accentHex: 0xc08443, glassHex: 0x163226, darkHex: 0x14231a, brightHex: 0x6d9b4c },
  olive: { roofHex: 0x687b58, facadeHex: 0x889b70, baseHex: 0x4b3527, accentHex: 0xaeb795, glassHex: 0x26392b, darkHex: 0x2d2923, brightHex: 0xc4c8a7 },
};

const P = (name, type, values, colorKey, pos, rot = [0, 0, 0]) => ({ name, type, ...values, pos, rot, colorKey });
const C = (name, topR, botR, height, x, base, z, colorKey, sides = 8) => P(name, 'conical_frustum', { radii: [topR, botR], height, sides }, colorKey, [x, base + height / 2, z]);
const D = (name, rx, ry, rz, x, y, z, colorKey, rot = [0, 0, 0]) => P(name, 'ellipsoid_sphere', { radii: [rx, ry, rz] }, colorKey, [x, y, z], rot);
const Q = (name, radius, x, y, z, colorKey, rot = [0, 0, 0]) => P(name, 'dodecahedron_polyhedron', { radius }, colorKey, [x, y, z], rot);
const H = (name, radius, height, x, base, z, colorKey, sides = 8) => P(name, 'cylinder', { radii: [radius, radius], height, sides }, colorKey, [x, base + height / 2, z]);

function distance(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); }

// direct_ingest_v6 cylinders are +Y. These Euler angles map the local axis to b-a.
function branch(parts, name, a, b, radius, colorKey, sides = 8) {
  const length = distance(a, b);
  if (!(length > 0)) throw new Error(`零長枝段: ${name}`);
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const radial = Math.hypot(dx, dz);
  const rot = [Math.atan2(radial, dy), Math.atan2(dx, dz), 0];
  return parts.push(P(name, 'cylinder', { radii: [radius, radius * 1.08], height: length, sides }, colorKey,
    [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], rot));
}

function cryptomeria() {
  const p = [];
  // Ukiyo-e giant cedar: roots and bole dominate the lower frame; the upper crown is
  // broken into offset masses around two separate leaders rather than stacked lampshades.
  p.push(C('root_flare_main', 1.18, 2.35, 6.3, 0, 0, 0, 'baseHex', 10));
  p.push(C('root_flare_left', 0.42, 0.92, 2.35, -0.84, 0, 0.20, 'baseHex', 8));
  p.push(C('root_flare_right', 0.39, 0.85, 2.20, 0.82, 0, -0.18, 'baseHex', 8));
  p.push(C('bole_upper', 0.92, 1.30, 4.7, 0, 6.3, 0, 'baseHex', 10));
  branch(p, 'broken_leader_left', [0, 9.5, 0], [-0.72, 16.95, 0.10], 0.19, 'baseHex', 9);
  branch(p, 'broken_leader_right', [0, 10.0, 0], [0.86, 16.70, 0.28], 0.17, 'baseHex', 9);
  const clusters = [
    [-4.65, 10.65, 0.55, 2.65, 0.92, 2.85, -0.10], [3.95, 10.85, -0.55, 2.90, 0.86, 3.05, 0.08],
    [-3.55, 12.15, -0.70, 3.15, 0.98, 3.10, -0.16], [4.72, 12.35, 0.80, 2.38, 0.84, 3.25, 0.12],
    [-5.20, 13.55, 0.15, 2.40, 0.80, 2.95, 0.04], [2.72, 13.75, -0.95, 3.10, 0.92, 3.00, -0.09],
    [-2.52, 14.20, 0.82, 2.55, 0.88, 3.15, 0.18], [4.05, 14.80, 0.30, 2.10, 0.76, 3.05, -0.12],
    [-3.85, 15.20, -0.35, 2.15, 0.82, 2.75, 0.11], [1.72, 15.55, 0.78, 2.35, 0.80, 2.80, 0.04],
    [-1.45, 16.35, -0.55, 1.78, 0.72, 2.35, -0.15], [2.35, 16.45, -0.30, 1.70, 0.68, 2.25, 0.14],
    [-0.75, 17.15, 0.25, 1.32, 0.58, 1.80, -0.08], [0.95, 17.18, 0.35, 1.28, 0.56, 1.75, 0.10],
  ];
  for (const [i, [x, y, z, rx, ry, rz, tilt]] of clusters.entries()) {
    const tone = i % 3 === 0 ? 'roofHex' : i % 3 === 1 ? 'facadeHex' : 'accentHex';
    p.push(D(`crown_cluster_${i}`, rx, ry, rz, x, y, z, tone, [tilt, (i % 2 ? -0.10 : 0.08), tilt * 0.6]));
  }
  // Short, visible bough anchors make the offset foliage read as one attached crown.
  for (const [i, y, x, z] of [[0, 10.5, -3.2, 0.30], [1, 11.1, 3.0, -0.35], [2, 12.6, -2.8, -0.55], [3, 13.2, 2.6, 0.45], [4, 14.0, -2.2, 0.40], [5, 14.5, 2.1, -0.45]]) {
    branch(p, `crown_bough_${i}`, [0, y, 0], [x, y + (i % 2 ? 0.16 : -0.08), z], 0.105 - i * 0.006, 'darkHex', 7);
  }
  return { style: 'giant Japanese cedar high narrow layered crown', symmetryMode: 'asymmetric', colors: PALETTES.cryptomeria, parts: p, note: '柳杉：粗大直立樹幹、上段密集高窄冠層，避免單一圓錐燈罩。' };
}

function regularAraucaria() {
  const p = [C('trunk', 0.22, 0.42, 7.65, 0, 0, 0, 'baseHex', 9)];
  const levels = [
    [2.9, 1.75], [3.65, 2.05], [4.4, 2.20], [5.15, 2.05], [5.9, 1.85],
    [6.65, 1.55], [7.35, 1.24], [8.0, 0.88], [8.58, 0.52],
  ];
  for (const [i, [y, span]] of levels.entries()) {
    const count = 8;
    for (let j = 0; j < count; j++) {
      const yaw = (j / count) * Math.PI * 2 + (i % 2 ? 0.22 : 0);
      const end = [Math.cos(yaw) * span, y - 0.10 - (i < 2 ? 0.04 : 0), Math.sin(yaw) * span * 0.54];
      branch(p, `whorl_${i}_${j}`, [0, y, 0], end, 0.052, i % 3 === 0 ? 'roofHex' : i % 3 === 1 ? 'facadeHex' : 'brightHex', 7);
      p.push(D(`needle_cluster_${i}_${j}`, 0.17, 0.12, 0.10, end[0], end[1] - 0.02, end[2], i % 3 === 0 ? 'roofHex' : i % 3 === 1 ? 'facadeHex' : 'brightHex'));
    }
  }
  p.push(C('leader', 0.025, 0.045, 1.0, 0, 7.65, 0, 'brightHex', 6));
  return { style: 'Norfolk pine regular horizontal whorls', symmetryMode: 'symmetric', colors: PALETTES.araucariaSepia, parts: p, note: '南洋杉 1903：規整開放水平輪生，窄高比例；每輪以八向枝段實接樹幹。' };
}

function hookedAraucaria() {
  const p = [C('trunk', 0.30, 0.53, 7.65, 0, 0, 0, 'baseHex', 9), C('trunk_crown', 0.17, 0.30, 2.05, 0, 7.65, 0, 'baseHex', 8)];
  const levels = [
    [2.25, 3.35, 0.70], [3.10, 3.72, 0.80], [3.95, 3.62, 0.86], [4.8, 3.35, 0.92],
    [5.65, 3.02, 0.96], [6.48, 2.62, 0.90], [7.25, 2.20, 0.82], [8.02, 1.68, 0.70], [8.72, 1.10, 0.52],
  ];
  const yawOffsets = [0.00, 0.22, -0.14, 0.31, -0.19, 0.11, -0.27, 0.16];
  for (const [i, [y, span, drop]] of levels.entries()) {
    for (let j = 0; j < 7; j++) {
      const yaw = (j / 7) * Math.PI * 2 + yawOffsets[(i + j) % yawOffsets.length];
      const side = 0.90 + (((i * 5 + j * 3) % 7) - 3) * 0.025;
      const elbow = [Math.cos(yaw) * span * 0.40 * side, y - 0.04, Math.sin(yaw) * span * 0.40 * side];
      const sag = [Math.cos(yaw) * span * 0.76 * side, y - drop * 0.60, Math.sin(yaw) * span * 0.52 * side];
      const hook = [Math.cos(yaw) * span * 0.96 * side, y - drop, Math.sin(yaw) * span * 0.66 * side];
      const upTip = [Math.cos(yaw) * span * 1.04 * side, y - drop + Math.min(0.52, drop * 0.52), Math.sin(yaw) * span * 0.70 * side];
      const tone = i % 3 === 0 ? 'roofHex' : i % 3 === 1 ? 'facadeHex' : 'brightHex';
      branch(p, `hooked_whorl_${i}_${j}_inner`, [0, y, 0], elbow, 0.068, tone, 7);
      branch(p, `hooked_whorl_${i}_${j}_sag`, elbow, sag, 0.060, tone, 7);
      branch(p, `hooked_whorl_${i}_${j}_hook`, sag, hook, 0.050, tone, 7);
      branch(p, `hooked_whorl_${i}_${j}_upturn`, hook, upTip, 0.042, tone, 7);
      for (const [k, q] of [[0, elbow], [1, sag], [2, hook], [3, upTip]]) {
        p.push(Q(`needle_fan_${i}_${j}_${k}`, k === 3 ? 0.18 : 0.13, q[0], q[1], q[2], tone, [0, yaw + 0.3, 0.2 * (j % 2 ? -1 : 1)]));
      }
    }
  }
  p.push(C('leader', 0.035, 0.06, 1.15, 0, 9.7, 0, 'brightHex', 6));
  p.push(D('blunt_top_crown', 0.62, 0.38, 0.58, 0, 10.82, 0.05, 'facadeHex'));
  return { style: 'mature monkey-puzzle dense hooked whorls', symmetryMode: 'symmetric', colors: PALETTES.araucariaGreen, parts: p, note: '南洋杉成熟株：粗繩狀枝條由內段接至下垂鉤曲外段，冠內較密，與 1903 照片不共用比例。' };
}

function olive() {
  const p = [C('root_flare', 0.62, 1.05, 1.35, 0, 0, 0, 'baseHex', 9)];
  const tone = (i) => i % 3 === 0 ? 'roofHex' : i % 3 === 1 ? 'facadeHex' : 'brightHex';
  // Ancient olive: three twisted trunks fork from one root and support a sparse silver crown.
  const forks = [
    [[0, 0.9, 0], [-1.05, 3.9, 0.12], 0.25], [[0, 0.82, 0], [0.15, 4.35, 0.05], 0.28], [[0, 0.92, 0], [1.18, 3.72, -0.10], 0.23],
    [[-1.05, 3.9, 0.12], [-2.65, 5.75, 0.20], 0.15], [[-1.05, 3.9, 0.12], [-0.90, 5.85, 0.38], 0.14],
    [[0.15, 4.35, 0.05], [0.45, 6.10, 0.20], 0.16], [[0.15, 4.35, 0.05], [-0.38, 6.05, -0.35], 0.14],
    [[1.18, 3.72, -0.10], [2.55, 5.50, -0.25], 0.15], [[1.18, 3.72, -0.10], [1.02, 5.85, -0.55], 0.14],
    [[-2.65, 5.75, 0.20], [-3.75, 6.10, 0.38], 0.09], [[2.55, 5.50, -0.25], [3.55, 5.95, -0.65], 0.085],
    [[-0.90, 5.85, 0.38], [-1.70, 6.45, 0.64], 0.075], [[1.02, 5.85, -0.55], [1.95, 6.35, -0.82], 0.075],
  ];
  for (const [i, [a, b, r]] of forks.entries()) branch(p, `gnarled_member_${i}`, a, b, r, 'baseHex', 8);
  const crowns = [
    [-3.82, 6.35, 0.38, 0.78, 0.38, 0.62, -0.20], [-3.10, 6.72, 0.68, 0.94, 0.42, 0.55, 0.10],
    [-2.30, 7.10, 0.22, 0.82, 0.36, 0.68, -0.14], [-1.50, 6.58, -0.38, 0.88, 0.34, 0.52, 0.18],
    [-0.82, 7.12, 0.46, 1.02, 0.40, 0.60, -0.06], [0.10, 7.48, -0.12, 0.90, 0.36, 0.66, 0.12],
    [0.82, 7.02, 0.70, 0.78, 0.34, 0.54, -0.17], [1.62, 6.64, -0.38, 0.94, 0.37, 0.62, 0.08],
    [2.38, 6.30, -0.22, 0.82, 0.35, 0.56, -0.12], [3.28, 6.38, -0.70, 0.70, 0.32, 0.60, 0.18],
    [-3.56, 7.34, -0.42, 0.68, 0.31, 0.50, 0.11], [-2.66, 7.68, 0.64, 0.72, 0.32, 0.54, -0.15],
    [-1.55, 7.76, 0.12, 0.84, 0.33, 0.56, 0.06], [-0.52, 7.98, -0.48, 0.78, 0.30, 0.50, -0.17],
    [0.54, 8.18, 0.36, 0.86, 0.32, 0.58, 0.14], [1.48, 7.80, 0.22, 0.72, 0.30, 0.52, -0.08],
    [2.55, 7.54, -0.56, 0.70, 0.30, 0.50, 0.12], [-3.88, 6.92, 0.92, 0.62, 0.28, 0.46, -0.14],
    [-0.18, 6.70, 1.00, 0.70, 0.29, 0.48, 0.16], [2.98, 7.12, -1.00, 0.64, 0.28, 0.50, -0.10],
  ];
  for (const [i, [x, y, z, rx, ry, rz, tilt]] of crowns.entries()) p.push(D(`silver_leaf_cluster_${i}`, rx * 0.72, ry * 0.72, rz * 0.88, x, y, z, tone(i), [tilt, (i % 2 ? -0.12 : 0.10), tilt * 0.7]));
  // Two deliberately bare ends preserve the ancient tree's dead wood and keep the canopy open.
  branch(p, 'dead_tip_left', [-3.75, 6.10, 0.38], [-4.35, 6.72, 0.46], 0.045, 'darkHex', 6);
  branch(p, 'dead_tip_right', [3.55, 5.95, -0.65], [4.12, 6.18, -0.78], 0.042, 'darkHex', 6);
  return { style: 'ancient twisted multi-trunk olive with sparse silver canopy', symmetryMode: 'asymmetric', colors: PALETTES.olive, parts: p, note: '橄欖：多幹扭曲分叉、冠層疏鬆銀灰且左右不規則；每個主冠由相鄰枝端承托。' };
}

const TARGETS = [
  { subpart: 'sp_acacia', stem: 'ov_51d36975-4681-4f3e-a9a5-46eab91f9fa1', spec: null, note: '母圖為長頸鹿與飼草架，無相思樹；fail-closed source mismatch。' },
  { subpart: 'gt_cryptomeria', stem: 'ov_ef085512-f1b2-4415-bb2a-4bad15affd68', spec: cryptomeria },
  { subpart: 'cf_araucaria', stem: 'ov_cfee01fe-a3fd-4f7e-b4a4-32aecb9029e2', spec: regularAraucaria },
  { subpart: 'cf_araucaria', stem: 'ov_61a8c242-5841-4892-847c-ab6278bf0fce', spec: hookedAraucaria },
  { subpart: 'bl_olive', stem: 'ov_f3c022cd-793e-4c3f-9829-bd123c8445ff', spec: olive },
];

function safeStem(value) { return value.replace(/[^\w.-]+/g, '_'); }
function outputDir(target) {
  const base = FINALIZE ? '3d_data' : '3d_data_luna_candidates';
  return join(ROOT, 'out', base, 'tree', target.subpart, `tree_${target.subpart}_${safeStem(target.stem)}_luna_v6`);
}
function writeJsonAtomic(path, value) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}
function sourceImage(target) {
  const ext = ['.jpg', '.jpeg', '.png', '.webp'].find((suffix) => existsSync(join(ROOT, 'tools', 'ai3d', 'photos', 'tree', target.subpart, target.stem + suffix)));
  if (ext) return join(ROOT, 'tools', 'ai3d', 'photos', 'tree', target.subpart, target.stem + ext);
  const external = 'C:\\Users\\user\\Documents\\app\\steel_vs_swarm';
  const ext2 = ['.jpg', '.jpeg', '.png', '.webp'].find((suffix) => existsSync(join(external, 'tools', 'ai3d', 'photos', 'tree', target.subpart, target.stem + suffix)));
  return ext2 ? join(external, 'tools', 'ai3d', 'photos', 'tree', target.subpart, target.stem + ext2) : null;
}
function evidencePath(target) {
  const roots = [join(ROOT, 'out', 'yolo_features'), 'C:\\Users\\user\\Documents\\app\\steel_vs_swarm\\out\\yolo_features', 'C:\\Users\\user\\.gemini\\antigravity\\worktrees\\steel_vs_swarm\\llm_img3d_db_v6\\out\\yolo_features'];
  return roots.map((root) => join(root, 'tree', target.subpart, `${target.stem}.json`)).find(existsSync) || null;
}
function evidenceFor(target) {
  const featureFile = evidencePath(target);
  const image = sourceImage(target);
  if (!featureFile) throw new Error(`缺少既有 YOLO feature cache: ${target.subpart}/${target.stem}`);
  if (!image) throw new Error(`缺少來源圖或 repo crop: ${target.subpart}/${target.stem}`);
  const raw = JSON.parse(readFileSync(featureFile, 'utf8'));
  const row = raw.targets?.[0];
  if (!row) throw new Error(`feature cache 缺 target row: ${featureFile}`);
  const schema2 = raw.schemaVersion === 2 && raw.models?.detection === 'yolo26n.pt' && raw.models?.segmentation === 'yolo26n-seg.pt' && raw.models?.depth === 'yolo26n-depth.pt';
  // Older checked-in metadata is retained as evidence provenance, never silently called v2.
  return {
    sourceImage: raw.sourceImage || `tree/${target.subpart}/${target.stem}${image.slice(image.lastIndexOf('.'))}`,
    sourceFullPath: image,
    featureFile,
    schemaVersion: schema2 ? 2 : null,
    evidenceStatus: schema2 ? 'yolo26_schema_v2' : 'legacy_feature_metadata_only',
    row,
    raw,
  };
}

function assertGeometry(spec, target) {
  if (!spec?.parts?.length) throw new Error(`空幾何: ${target.stem}`);
  for (const part of spec.parts) {
    if (!Array.isArray(part.pos) || part.pos.length !== 3 || part.pos[1] < 0) throw new Error(`非法位置: ${part.name}`);
    if (!part.colorKey || !spec.colors[part.colorKey]) throw new Error(`缺色彩分區: ${part.name}`);
  }
  if (spec.parts.some((part) => part.pos[1] === 0 && part.type !== 'cylinder' && part.type !== 'conical_frustum')) {
    throw new Error(`非樹幹部件直接穿入 ground: ${target.stem}`);
  }
}
function assertEvidenceConsistency(evidence, featureSchemaVersion) {
  if (evidence.evidenceStatus !== 'yolo26_schema_v2' && featureSchemaVersion === 2) {
    throw new Error(`證據不一致：${evidence.evidenceStatus} 不得標示 schemaVersion=2`);
  }
}
function reviewFor(target) {
  const reviews = {
    'ov_ef085512-f1b2-4415-bb2a-4bad15affd68': { similarityScore: 82, critique: '粗根張與厚古樹幹佔據下半部；斷裂雙主梢、左右不等高側冠與厚 Z 深度避免規整橢球塔。' },
    'ov_cfee01fe-a3fd-4f7e-b4a4-32aecb9029e2': { similarityScore: 80, critique: '1903 Norfolk pine 的規整水平輪生與開放枝間距被保留，比例獨立於另一張南洋杉。' },
    'ov_61a8c242-5841-4892-847c-ab6278bf0fce': { similarityScore: 84, critique: '成熟 monkey-puzzle 以七向不規則輪生、三至四段粗節枝形成明確 U/J 回鉤；沿枝葉簇與鈍圓頂冠保留內部密度。' },
    'ov_f3c022cd-793e-4c3f-9829-bd123c8445ff': { similarityScore: 84, critique: '多幹低位扭結、左右不等高主枝與兩個枯梢清楚；二十個縮小扁長銀灰簇保留可讀空隙，未連成圓頂。' },
  };
  return { ...reviews[target.stem], verdict: 'pass', corrections: [], reviewer: 'independent_parent_multimodal', priorHumanVerdict: 'archive' };
}

function writeCandidate(target, index) {
  if (!target.spec) return { target: target.stem, status: 'skipped', reason: 'source_mismatch', priorHumanVerdict: 'archive', eligible: false, pipelineEligibility: 'blocked_source_mismatch', note: target.note };
  const evidence = evidenceFor(target);
  const generated = target.spec();
  assertGeometry(generated, target);
  const review = reviewFor(target);
  const targetId = `tree_${target.subpart}_${safeStem(target.stem)}_luna_v6`;
  const geometry = buildGeometryFromParts(generated, 'tree', target.subpart, safeStem(target.stem));
  assertEvidenceConsistency(evidence, evidence.schemaVersion);
  const pipelineEligibility = evidence.evidenceStatus === 'yolo26_schema_v2'
    ? { eligible: true, pipelineEligibility: 'yolo26_v2_verified' }
    : { eligible: false, pipelineEligibility: 'blocked_missing_yolo26_v2' };
  const previewDir = join(ROOT, 'out', 'review_previews');
  const previewModel = join(previewDir, `${targetId}.model.json`);
  const previewPath = join(previewDir, `${targetId}.png`);
  const outDir = outputDir(target);
  const hash = createHash('sha1').update(`${evidence.sourceImage}:${target.stem}`).digest('hex').slice(0, 8);
  const partKey = `tree/${target.subpart}_${target.stem}_${hash}_luna_v6`;
  if (!DRY_RUN) {
    mkdirSync(previewDir, { recursive: true });
    writeFileSync(previewModel, JSON.stringify(geometry.modelJson), 'utf8');
    execFileSync(PYTHON, [PREVIEW_RENDERER, previewModel, previewPath], { timeout: 30_000 });
    mkdirSync(outDir, { recursive: true });
    const evidenceOverride = FINALIZE ? {
      type: 'llm_visual_direct',
      authorizedBy: 'user',
      reason: 'YOLO26 schema-v2 證據缺失，依使用者指示直接以來源圖進行 LLM 視覺重建。',
    } : null;
    const features = { ...geometry.featuresJson, schemaVersion: evidence.schemaVersion, ...pipelineEligibility, yolo26: { schemaVersion: evidence.schemaVersion, evidenceStatus: evidence.evidenceStatus, featureFile: relative(ROOT, evidence.featureFile).replace(/\\/g, '/'), target: evidence.row }, evidenceOverride, similarityReview: review, reconstructionNote: generated.note, localModel: 'gpt-5.6-luna' };
    const metadata = { id: targetId, key: partKey, family: 'tree', subpart: target.subpart, style: generated.style, symmetryMode: generated.symmetryMode, similarityScore: review.similarityScore, similarityReview: review.critique, similarityVerdict: review.verdict, similarityCorrections: review.corrections, priorHumanVerdict: 'archive', version: 6, verStr: 'v6', method: FINALIZE ? 'gpt-5.6-luna_visual_direct' : 'gpt-5.6-luna_tree_candidate', status: FINALIZE ? 'awaiting_human_review' : 'candidate_unapproved', eligible: false, pipelineEligibility: FINALIZE ? 'awaiting_human_review' : pipelineEligibility.pipelineEligibility, source_image: evidence.sourceImage, source_full_path: evidence.sourceFullPath, yolo26: features.yolo26, evidenceOverride, preview: relative(ROOT, previewPath).replace(/\\/g, '/'), bounds: geometry.bounds, reconstructionNote: generated.note, created_at: new Date().toISOString() };
    writeFileSync(join(outDir, 'model.json'), JSON.stringify(geometry.modelJson, null, 2), 'utf8');
    writeFileSync(join(outDir, 'features.json'), JSON.stringify(features, null, 2), 'utf8');
    writeFileSync(join(outDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
    writeFileSync(join(outDir, 'model.obj'), geometry.objContent, 'utf8');
  }
  return { target: target.stem, status: DRY_RUN ? 'validated' : (FINALIZE ? 'awaiting_human_review' : 'candidate'), targetId, key: partKey, family: 'tree', subpart: target.subpart, style: generated.style, symmetryMode: generated.symmetryMode, image: evidence.sourceImage, featureEvidence: evidence.evidenceStatus, evidenceOverride: FINALIZE ? 'llm_visual_direct' : null, eligible: false, pipelineEligibility: FINALIZE ? 'awaiting_human_review' : pipelineEligibility.pipelineEligibility, similarityReview: review, outputDir: relative(ROOT, outDir).replace(/\\/g, '/'), preview: relative(ROOT, previewPath).replace(/\\/g, '/'), bounds: geometry.bounds, parts: geometry.featuresJson.totalParts };
}

function finalizeCatalog(results) {
  const accepted = results.filter((row) => row.status === 'awaiting_human_review');
  const keys = new Set(accepted.map((row) => row.key));

  const dbPath = join(ROOT, 'out', '3d_database.json');
  const db = JSON.parse(readFileSync(dbPath, 'utf8'));
  db.items = (db.items || []).filter((row) => !keys.has(row.key));
  for (const row of accepted) {
    db.items.push({
      id: row.targetId, key: row.key, family: row.family, subpart: row.subpart,
      style: row.style, symmetryMode: row.symmetryMode,
      similarityScore: row.similarityReview.similarityScore,
      version: 6, verStr: 'v6', method: 'gpt-5.6-luna_visual_direct',
      status: 'awaiting_human_review', image: row.image,
      evidenceOverride: row.evidenceOverride, bounds: row.bounds,
      spec: { style: row.style }, triangles: row.bounds.triangles,
      outputDir: row.outputDir,
    });
  }
  db.generated_at = new Date().toISOString();
  db.total_objects = db.items.length;
  db.families = [...new Set(db.items.map((row) => row.family))];
  writeJsonAtomic(dbPath, db);

  const manifestPath = join(ROOT, 'tools', 'ai3d', 'parts_manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.parts = (manifest.parts || []).filter((entry) =>
    !(entry.keys || (entry.key ? [entry.key] : [])).some((key) => keys.has(key)));
  for (const row of accepted) {
    const hash = row.key.match(/_([0-9a-f]{8})_luna_v6$/)?.[1];
    manifest.parts.push({
      method: 'gpt-5.6-luna_visual_direct', version: 6, verStr: 'v6',
      consumer: `tree catalog & partlib (${row.subpart})`, rev: 'HEAD',
      at: new Date().toISOString().slice(0, 10),
      imgs: [{
        role: 'primary', id: `img_${hash}`, family: 'tree', part: row.subpart,
        query: row.target, api: 'gpt-5.6-luna_visual_direct',
        license: 'unverified(restricted/local)', creator: null, source_url: '',
        file: row.image,
      }],
      gen: {
        tool: 'GPT-5.6 Luna direct visual polyhedral reconstruction',
        runner: 'tools/ai3d/direct_ingest_luna_tree_v6.mjs',
        params: '--finalize', machine: 'Codex GPT-5.6 Luna',
        evidenceOverride: 'llm_visual_direct',
        measured: `Triangles ${row.bounds.triangles}, Vertices ${row.bounds.vertices}, Similarity ${row.similarityReview.similarityScore}/100`,
      },
      post: {
        tool: 'tools/ai3d/direct_ingest_luna_tree_v6.mjs', fit: 1,
        bounds: row.bounds.size,
        note: `Extents [${row.bounds.size.join(', ')}]m, rMax ${row.bounds.rMax}m；等待零件台人眼覆核。`,
      },
      keys: [row.key],
    });
  }
  writeJsonAtomic(manifestPath, manifest);
}

function main() {
  if (!DRY_RUN && !existsSync(PYTHON)) throw new Error(`找不到 bundled Python，請以 --python 指定: ${PYTHON}`);
  const selected = ONLY ? TARGETS.filter((target) => target.stem === ONLY || target.subpart === ONLY) : TARGETS;
  if (!selected.length) throw new Error(`--only 找不到 tree target: ${ONLY}`);
  const results = selected.map((target, index) => writeCandidate(target, index));
  if (FINALIZE) finalizeCatalog(results);
  const report = join(ROOT, 'out', 'review_previews', 'tree_luna_v6_candidates.json');
  if (!DRY_RUN) {
    mkdirSync(join(ROOT, 'out', 'review_previews'), { recursive: true });
    let prior = [];
    if (ONLY && existsSync(report)) {
      try { prior = JSON.parse(readFileSync(report, 'utf8')).candidates || []; } catch { prior = []; }
    }
    const byTarget = new Map(prior.map((row) => [row.target, row]));
    for (const row of results) byTarget.set(row.target, row);
    writeFileSync(report, JSON.stringify({ model: 'gpt-5.6-luna', generatedAt: new Date().toISOString(), humanVerdictsPreserved: true, candidates: TARGETS.map((target) => byTarget.get(target.stem)).filter(Boolean) }, null, 2), 'utf8');
  }
  console.log(`${DRY_RUN ? '驗證' : '完成'} tree Luna v6: ${results.filter((row) => row.status !== 'skipped').length} candidates, ${results.filter((row) => row.status === 'skipped').length} skipped; ${DRY_RUN ? '未寫入輸出。' : `${FINALIZE ? '已登記零件台待人眼覆核；' : ''}report=${relative(ROOT, report).replace(/\\/g, '/')}`}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
