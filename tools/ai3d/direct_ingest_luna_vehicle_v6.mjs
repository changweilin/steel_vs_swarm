#!/usr/bin/env node
/**
 * GPT-5.6 Luna 視覺直建：vehicle/bike、vehicle/motor v6。
 *
 * 這個 runner 只接管目前沒有 ok、archive、purge 標記的目標，並把同一張
 * 來源圖被錯拆成 ~0/~1 的碎片收斂成一個完整候選件。所有候選件保持
 * awaiting_human_review，絕不寫入 review state 或假造 YOLO26 通過證據。
 *
 * 幾何契約：+X 為車頭、+Y 向上、+Z 為車體右側；車輪法線沿 Z，輪胎
 * 外緣落在 y=0。細長構件一律由兩個接點推導中心、長度與方向，避免端點
 * 間隙或旋轉猜測；只有後下叉、後上叉、前叉等真實雙側構件成對生成，
 * 中心線車架件維持單件。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
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
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};
const DRY_RUN = has('dry-run');
const FINALIZE = has('finalize');
const ONLY = arg('only');
const LIMIT = Number(arg('limit', Infinity));
const PYTHON = arg('python', process.env.AI3D_PYTHON || join(ROOT, '.venv', 'Scripts', 'python.exe'));
const UV_PREVIEW = has('uv-preview');
const UV_PYTHON = arg('uv-python', '3.12');

const PI_2 = Math.PI * 0.5;
const COLORS = {
  road: { roofHex: 0xd43f35, facadeHex: 0x222833, baseHex: 0x151923, accentHex: 0xe4e8ee, darkHex: 0x101216, brightHex: 0xf4f0dc, glassHex: 0x182b3b },
  mtb: { roofHex: 0x263039, facadeHex: 0x477a71, baseHex: 0x15191d, accentHex: 0xb5c4c2, darkHex: 0x111416, brightHex: 0xe4ebdf, glassHex: 0x193744 },
  green: { roofHex: 0x75a85b, facadeHex: 0x26302a, baseHex: 0x1a211d, accentHex: 0xd8e3c0, darkHex: 0x0f1512, brightHex: 0xeaf0dc, glassHex: 0x1d3b3b },
  mint: { roofHex: 0x87bfb0, facadeHex: 0xe6ded0, baseHex: 0x5c6e69, accentHex: 0xa66f50, darkHex: 0x273331, brightHex: 0xf4f0df, glassHex: 0x264c52 },
  trike: { roofHex: 0xf1f0e8, facadeHex: 0xdc3b3c, baseHex: 0x26353d, accentHex: 0x55b8cc, darkHex: 0x182027, brightHex: 0xffffff, glassHex: 0x2c6974 },
  scooter: { roofHex: 0x78909b, facadeHex: 0x222a31, baseHex: 0x161b20, accentHex: 0xc3c8c5, darkHex: 0x0d1114, brightHex: 0xf2e9d6, glassHex: 0x193844 },
  redScooter: { roofHex: 0xc83d37, facadeHex: 0xe2a54a, baseHex: 0x343131, accentHex: 0xf1d5a3, darkHex: 0x1d1816, brightHex: 0xfff7df, glassHex: 0x263a48 },
  motorcycle: { roofHex: 0x235d9d, facadeHex: 0x1b2028, baseHex: 0x30343c, accentHex: 0xd7a842, darkHex: 0x111318, brightHex: 0xf1eee5, glassHex: 0x182c43 },
  classic: { roofHex: 0x173b68, facadeHex: 0xc1c3bd, baseHex: 0x252a2f, accentHex: 0xc9a550, darkHex: 0x13171b, brightHex: 0xf3eee2, glassHex: 0x2b3d4a },
  chopper: { roofHex: 0x3274bb, facadeHex: 0x1f2b39, baseHex: 0x333940, accentHex: 0xd09d43, darkHex: 0x121619, brightHex: 0xf6efe1, glassHex: 0x1b3248 },
};

const P = (name, type, values, colorKey, pos, rot = [0, 0, 0], role = 'structure') => ({
  name, type, ...values, pos, rot, colorKey, role,
});
const B = (name, w, h, d, pos, colorKey, rot = [0, 0, 0], role = 'body') =>
  P(name, 'box', { dimensions: [w, h, d] }, colorKey, pos, rot, role);
const W = (name, w, h, d, pos, colorKey, rot = [0, 0, 0], role = 'body') =>
  P(name, 'wedge', { dimensions: [w, h, d] }, colorKey, pos, rot, role);
const E = (name, rx, ry, rz, pos, colorKey, rot = [0, 0, 0], role = 'body') =>
  P(name, 'ellipsoid_sphere', { radii: [rx, ry, rz] }, colorKey, pos, rot, role);
const C = (name, r, h, pos, colorKey, sides = 8, rot = [0, 0, 0], role = 'structure') =>
  P(name, 'cylinder', { radii: [r, r], height: h, sides }, colorKey, pos, rot, role);
const F = (name, topR, botR, h, pos, colorKey, sides = 8, rot = [0, 0, 0], role = 'structure') =>
  P(name, 'conical_frustum', { radii: [topR, botR], height: h, sides }, colorKey, pos, rot, role);
const T = (name, radius, tube, pos, colorKey, rot = [0, 0, 0], role = 'detail') =>
  P(name, 'torus_ring', { radius, tube }, colorKey, pos, rot, role);

function hashHex(value) {
  return createHash('sha1').update(String(value)).digest('hex').slice(0, 8);
}
function safeName(value) {
  const normalized = String(value).replace(/[^a-zA-Z0-9._-]+/g, '_');
  return normalized.length <= 96 ? normalized : `${normalized.slice(0, 80)}_${hashHex(normalized)}`;
}
function relativePath(path) { return relative(ROOT, path).replace(/\\/g, '/'); }
function writeJsonAtomic(path, value) {
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  if (existsSync(path)) unlinkSync(path);
  renameSync(temp, path);
}
function writeTextAtomic(path, value) {
  const temp = `${path}.tmp`;
  writeFileSync(temp, value, 'utf8');
  if (existsSync(path)) unlinkSync(path);
  renameSync(temp, path);
}
function distance(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); }
function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; }

// cylinder 的局部軸為 +Y；由端點推導完整 3D 旋轉，避免斜向細件被猜角度。
function strut(parts, joints, name, a, b, radius, colorKey, sides = 8, role = 'tube') {
  const length = distance(a, b);
  if (!(length > 0.001)) throw new Error(`零長細長構件: ${name}`);
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const radial = Math.hypot(dx, dz);
  const rot = [Math.atan2(radial, dy), Math.atan2(dx, dz), 0];
  parts.push(P(name, 'cylinder', { radii: [radius, radius], height: length, sides }, colorKey, mid(a, b), rot, role));
  joints.push({ name, a: [...a], b: [...b], radius });
}
function strutPair(parts, joints, name, a, b, radius, colorKey, sides = 8, role = 'tube') {
  const offset = Math.max(Math.abs(a[2]), Math.abs(b[2]), 0.052);
  for (const side of [-1, 1]) strut(parts, joints, `${name}_${side < 0 ? 'left' : 'right'}`, [a[0], a[1], side * offset], [b[0], b[1], side * offset], radius, colorKey, sides, role);
}
function axle(parts, name, x, y, z, length, radius, colorKey, role = 'axle') {
  parts.push(C(name, radius, length, [x, y, z], colorKey, 10, [PI_2, 0, 0], role));
}
function pointOnWheel(x, y, z, radius, angle) {
  return [x + radius * Math.cos(angle), y + radius * Math.sin(angle), z];
}

function addWheel(parts, wheels, name, x, z, outerRadius, tireTube, colors, options = {}) {
  const y = outerRadius;
  const rimRadius = outerRadius - tireTube - 0.025;
  const tire = `${name}_tire`;
  const rim = `${name}_rim`;
  parts.push(T(tire, outerRadius - tireTube, tireTube, [x, y, z], 'darkHex', [PI_2, 0, 0], 'wheel_tire'));
  parts.push(T(rim, rimRadius, 0.014, [x, y, z], 'accentHex', [PI_2, 0, 0], 'wheel_rim'));
  axle(parts, `${name}_hub`, x, y, z, options.hubWidth || 0.16, 0.025, 'baseHex');
  for (const side of [-1, 1]) {
    const spokeZ = z + side * 0.036;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + (name === 'front_wheel' ? 0.15 : 0);
      const outer = pointOnWheel(x, y, spokeZ, rimRadius - 0.01, angle);
      strut(parts, [], `${name}_spoke_${side < 0 ? 'left' : 'right'}_${i}`, [x, y, spokeZ], outer, 0.006, 'accentHex', 5, 'wheel_spoke');
    }
  }
  if (options.disc) {
    const discZ = z + (options.discSide || 0.075);
    parts.push(T(`${name}_brake_disc`, 0.115, 0.009, [x, y, discZ], 'brightHex', [PI_2, 0, 0], 'brake')); 
  }
  wheels.push({ name, center: [x, y, z], outerRadius, tireTube, axis: 'z', tire, rim });
}

function addChain(parts, joints, rear, crank, z, colorKey = 'darkHex') {
  const rearPoint = [rear[0], rear[1], z];
  const crankPoint = [crank[0], crank[1], z];
  strut(parts, joints, `chain_upper_${z < 0 ? 'left' : 'right'}`, rearPoint, crankPoint, 0.009, colorKey, 5, 'chain');
  strut(parts, joints, `chain_lower_${z < 0 ? 'left' : 'right'}`, [rear[0], rear[1] - 0.045, z], [crank[0], crank[1] - 0.045, z], 0.009, colorKey, 5, 'chain');
}

function bikeClass(stem) {
  const s = stem.toLowerCase();
  if (s.startsWith('800x') && !s.includes('(1)')) return 'trike';
  if (s.startsWith('w1si')) return 'training_city';
  if (s.startsWith('t-806')) return 'city_utility';
  if (s.includes('folding-gravel')) return 'folding_gravel';
  if (s.includes('folding') || s.startsWith('14-')) return 'city_folding';
  if (s.includes('110295') || s.includes('12544404') || s.includes('800x (1)') || s.includes('my25propel') || s.includes('兒童款') || s.startsWith('000001_173')) return 'road';
  if (s.includes('003002') || s.includes('10012915') || s.includes('110296') || s.includes('13226803') || s.includes('3827532') || s.includes('5df81') || s.includes('6756854') || s.includes('e582') || s.includes('19e97')) return 'mtb';
  return 'hybrid';
}

function bikeSpec(target) {
  const kind = bikeClass(target.stem);
  const palette = kind === 'road' ? COLORS.road : kind === 'trike' ? COLORS.trike : kind === 'training_city' || kind === 'city_folding' || kind === 'city_utility' || kind === 'folding_gravel' ? COLORS.mint : kind === 'mtb' ? (target.stem.includes('5df') ? COLORS.green : COLORS.mtb) : COLORS.mtb;
  const parts = [], joints = [], wheels = [];
  const side = 0.052;
  const tube = kind === 'mtb' ? 0.043 : kind === 'city_folding' ? 0.036 : kind === 'city_utility' || kind === 'folding_gravel' ? 0.034 : 0.032;

  if (kind === 'trike') {
    const front = { x: 0.48, z: 0, r: 0.27 };
    const rear = { x: -0.48, r: 0.19 };
    addWheel(parts, wheels, 'front_wheel', front.x, front.z, front.r, 0.042, palette, { hubWidth: 0.15 });
    addWheel(parts, wheels, 'rear_wheel_left', rear.x, -0.28, rear.r, 0.035, palette, { hubWidth: 0.11 });
    addWheel(parts, wheels, 'rear_wheel_right', rear.x, 0.28, rear.r, 0.035, palette, { hubWidth: 0.11 });
    axle(parts, 'rear_axle', rear.x, rear.r, 0, 0.62, 0.025, 'baseHex');
    const center = [0.05, 0.31, 0];
    const hinge = [0.28, 0.43, 0];
    strut(parts, joints, 'center_lower_frame', [-0.48, 0.31, 0], center, 0.042, 'roofHex', 8, 'frame');
    strut(parts, joints, 'center_front_frame', center, hinge, 0.042, 'roofHex', 8, 'frame');
    strut(parts, joints, 'front_head_tube', hinge, [0.38, 0.79, 0], 0.034, 'facadeHex', 8, 'frame');
    strut(parts, joints, 'front_fork', [0.38, 0.79, 0], [front.x, front.r, 0], 0.022, 'baseHex', 7, 'fork');
    axle(parts, 'front_axle', front.x, front.r, 0, 0.16, 0.025, 'baseHex');
    strut(parts, joints, 'seat_post', [-0.18, 0.31, 0], [-0.18, 0.65, 0], 0.018, 'baseHex', 7, 'seatpost');
    parts.push(B('seat', 0.27, 0.055, 0.13, [-0.18, 0.68, 0], 'baseHex'));
    strut(parts, joints, 'handle_stem', [0.38, 0.79, 0], [0.30, 1.01, 0], 0.018, 'baseHex', 7, 'handlebar');
    axle(parts, 'handlebar', 0.30, 1.01, 0, 0.48, 0.016, 'baseHex', 'handlebar');
    parts.push(B('front_basket_floor', 0.48, 0.035, 0.42, [0.13, 0.80, 0], 'accentHex', [0, 0, 0], 'basket'));
    parts.push(B('front_basket_back', 0.035, 0.27, 0.42, [-0.10, 0.94, 0], 'accentHex', [0, 0, 0], 'basket'));
    for (const z of [-0.20, 0.20]) {
      strut(parts, joints, `basket_support_${z < 0 ? 'left' : 'right'}`, [hinge[0], hinge[1], z], [-0.10, 0.80, z], 0.014, 'accentHex', 6, 'basket');
      strut(parts, joints, `basket_rail_${z < 0 ? 'left' : 'right'}`, [-0.10, 0.80, z], [0.34, 0.80, z], 0.012, 'accentHex', 6, 'basket');
    }
    parts.push(B('rear_fender_left', 0.42, 0.025, 0.07, [rear.x, 0.40, -0.28], 'brightHex'));
    parts.push(B('rear_fender_right', 0.42, 0.025, 0.07, [rear.x, 0.40, 0.28], 'brightHex'));
    return { style: 'child_tricycle', symmetryMode: 'explicit_three_wheel', colors: palette, parts, joints, wheels, note: '單一前輪與左右後輪完整建模；籃筐、車架、把手與三組輪轂均接在對應接點。' };
  }

  if (kind === 'training_city') {
    const r = 0.255;
    const tire = 0.043;
    const wb = 1.00;
    const rearX = -wb / 2;
    const frontX = wb / 2;
    addWheel(parts, wheels, 'rear_wheel', rearX, 0, r, tire, palette);
    addWheel(parts, wheels, 'front_wheel', frontX, 0, r, tire, palette, { disc: true });
    addWheel(parts, wheels, 'training_wheel_left', rearX + 0.05, -0.42, 0.11, 0.030, palette, { hubWidth: 0.08 });
    addWheel(parts, wheels, 'training_wheel_right', rearX + 0.05, 0.42, 0.11, 0.030, palette, { hubWidth: 0.08 });
    axle(parts, 'training_axle', rearX + 0.05, 0.11, 0, 0.92, 0.015, 'baseHex');
    const rearAxle = [rearX, r, 0];
    const frontAxle = [frontX, r, 0];
    const bottom = [0.00, 0.33, 0];
    const seat = [-0.28, 0.69, 0];
    const head = [0.37, 0.70, 0];
    strut(parts, joints, 'stepthrough_lower', rearAxle, bottom, 0.038, 'roofHex', 8, 'frame');
    strut(parts, joints, 'stepthrough_upper', bottom, head, 0.038, 'roofHex', 8, 'frame');
    strut(parts, joints, 'seat_support', bottom, seat, 0.034, 'facadeHex', 8, 'frame');
    strutPair(parts, joints, 'rear_chainstay', rearAxle, bottom, 0.025, 'baseHex', 7, 'stay');
    strutPair(parts, joints, 'rear_seatstay', rearAxle, seat, 0.020, 'baseHex', 7, 'stay');
    strut(parts, joints, 'head_tube', [0.30, 0.51, 0], head, 0.030, 'facadeHex', 8, 'head');
    strutPair(parts, joints, 'front_fork', head, frontAxle, 0.021, 'baseHex', 7, 'fork');
    for (const z of [-0.42, 0.42]) {
      strut(parts, joints, `training_brace_${z < 0 ? 'left' : 'right'}`, [rearX + 0.05, 0.11, z], [rearX, 0.32, z], 0.016, 'baseHex', 6, 'training_wheel');
      strut(parts, joints, `training_link_${z < 0 ? 'left' : 'right'}`, [rearX, 0.32, z], [rearX, 0.32, z * 0.124], 0.014, 'baseHex', 6, 'training_wheel');
    }
    strut(parts, joints, 'seat_post', seat, [seat[0], 0.89, 0], 0.018, 'baseHex', 7, 'seatpost');
    parts.push(B('saddle', 0.27, 0.055, 0.14, [seat[0], 0.93, 0], 'accentHex'));
    parts.push(B('chain_guard', 0.48, 0.08, 0.23, [-0.03, 0.38, -0.075], 'brightHex', [0, 0, 0], 'chain_guard'));
    strut(parts, joints, 'handle_stem', head, [0.42, 0.95, 0], 0.018, 'baseHex', 7, 'handlebar');
    axle(parts, 'flat_handlebar', 0.42, 0.97, 0, 0.48, 0.016, 'baseHex', 'handlebar');
    parts.push(B('front_basket_floor', 0.42, 0.035, 0.38, [0.19, 0.79, 0], 'accentHex', [0, 0, 0], 'basket'));
    parts.push(B('front_basket_back', 0.035, 0.28, 0.38, [-0.02, 0.93, 0], 'accentHex', [0, 0, 0], 'basket'));
    for (const z of [-0.18, 0.18]) {
      strut(parts, joints, `basket_support_${z < 0 ? 'left' : 'right'}`, [head[0], head[1], z], [-0.02, 0.79, z], 0.012, 'accentHex', 6, 'basket');
      strut(parts, joints, `basket_rail_${z < 0 ? 'left' : 'right'}`, [-0.02, 0.79, z], [0.40, 0.79, z], 0.010, 'accentHex', 6, 'basket');
    }
    parts.push(T('rear_fender', r + 0.012, 0.012, [rearX, r + 0.026, 0], 'brightHex', [PI_2, 0, 0], 'fender'));
    parts.push(T('front_fender', r + 0.012, 0.012, [frontX, r + 0.026, 0], 'brightHex', [PI_2, 0, 0], 'fender'));
    return { style: 'training_wheel_city_bicycle', symmetryMode: 'explicit_training_wheel_pair', colors: palette, parts, joints, wheels, note: '前籃、鏈罩、前後擋泥板、穿越式車架與左右輔助輪完整建模，輔助輪軸與支架接回後車架。' };
  }

  const r = kind === 'city_folding' ? 0.245 : kind === 'mtb' ? 0.37 : kind === 'hybrid' ? 0.35 : kind === 'city_utility' ? 0.34 : kind === 'folding_gravel' ? 0.36 : 0.345;
  const tire = kind === 'mtb' ? 0.058 : kind === 'hybrid' ? 0.045 : kind === 'city_folding' ? 0.040 : kind === 'city_utility' ? 0.040 : kind === 'folding_gravel' ? 0.042 : 0.034;
  const wb = kind === 'city_folding' ? 0.98 : kind === 'mtb' ? 1.12 : kind === 'hybrid' ? 1.08 : kind === 'city_utility' ? 1.08 : kind === 'folding_gravel' ? 1.08 : 1.10;
  const rearX = -wb / 2;
  const frontX = wb / 2;
  addWheel(parts, wheels, 'rear_wheel', rearX, 0, r, tire, palette, { disc: kind === 'mtb' });
  addWheel(parts, wheels, 'front_wheel', frontX, 0, r, tire, palette, { disc: kind === 'mtb' });
  const rearAxle = [rearX, r, 0];
  const frontAxle = [frontX, r, 0];

  if (kind === 'city_folding') {
    const bottom = [0.02, 0.34, 0];
    const hinge = [0.08, 0.47, 0];
    const seat = [-0.28, 0.70, 0];
    const head = [0.37, 0.70, 0];
    strut(parts, joints, 'stepthrough_lower', rearAxle, bottom, tube, 'roofHex', 8, 'frame');
    strut(parts, joints, 'stepthrough_hinge', bottom, hinge, tube, 'roofHex', 8, 'frame');
    strut(parts, joints, 'seat_support', hinge, seat, tube * 0.92, 'roofHex', 8, 'frame');
    strut(parts, joints, 'top_stepthrough', seat, head, tube * 0.82, 'facadeHex', 8, 'frame');
    strut(parts, joints, 'head_down', head, [0.25, 0.50, 0], tube * 0.9, 'facadeHex', 8, 'frame');
    strutPair(parts, joints, 'rear_chainstay', rearAxle, bottom, tube * 0.72, 'baseHex', 7, 'stay');
    strutPair(parts, joints, 'rear_seatstay', rearAxle, seat, tube * 0.60, 'baseHex', 7, 'stay');
    parts.push(C('fold_hinge', 0.055, 0.12, hinge, 'accentHex', 8, [PI_2, 0, 0], 'hinge'));
    strutPair(parts, joints, 'front_fork', [0.25, 0.50, 0], frontAxle, 0.021, 'baseHex', 7, 'fork');
    strut(parts, joints, 'seat_post', seat, [seat[0], 0.91, 0], 0.018, 'baseHex', 7, 'seatpost');
    parts.push(B('seat', 0.25, 0.055, 0.13, [seat[0], 0.95, 0], 'baseHex'));
    strut(parts, joints, 'handle_stem', head, [0.43, 0.94, 0], 0.018, 'baseHex', 7, 'handlebar');
    axle(parts, 'flat_handlebar', 0.43, 0.96, 0, 0.48, 0.016, 'baseHex', 'handlebar');
    parts.push(T('rear_fender', r + 0.014, 0.012, [rearX, r + 0.028, 0], 'brightHex', [PI_2, 0, 0], 'fender'));
    parts.push(T('front_fender', r + 0.014, 0.012, [frontX, r + 0.028, 0], 'brightHex', [PI_2, 0, 0], 'fender'));
    strut(parts, joints, 'rear_rack_lower', [rearX - 0.05, r + 0.04, -0.15], [rearX - 0.05, 0.68, -0.15], 0.012, 'accentHex', 6, 'rack');
    strut(parts, joints, 'rear_rack_upper', [rearX - 0.05, 0.68, -0.15], [0.05, 0.68, -0.15], 0.012, 'accentHex', 6, 'rack');
    parts.push(B('rear_basket', 0.30, 0.22, 0.32, [rearX - 0.08, 0.80, 0], 'accentHex', [0, 0, 0], 'basket'));
    return { style: 'folding_city_bicycle', symmetryMode: 'mirrored_bilateral', colors: palette, parts, joints, wheels, note: '小徑輪、折疊鉸鏈、穿越式車架、雙側輪架、前後擋泥板與後籃完整接合。' };
  }

  if (kind === 'city_utility' || kind === 'folding_gravel') {
    const bottom = [0.00, 0.39, 0];
    const hinge = kind === 'folding_gravel' ? [0.05, 0.52, 0] : null;
    const seat = [-0.39, 0.80, 0];
    const headTop = [0.40, 0.89, 0];
    const headBottom = [0.38, 0.66, 0];
    const rearFrameEnd = hinge || bottom;
    strut(parts, joints, 'top_tube', seat, headTop, tube, 'roofHex', 8, 'frame');
    strut(parts, joints, 'down_tube', headBottom, bottom, tube * 1.08, 'facadeHex', 8, 'frame');
    strut(parts, joints, 'seat_tube', bottom, seat, tube * 0.95, 'roofHex', 8, 'frame');
    strutPair(parts, joints, 'rear_chainstay', rearAxle, rearFrameEnd, tube * 0.72, 'baseHex', 7, 'stay');
    strutPair(parts, joints, 'rear_seatstay', rearAxle, seat, tube * 0.60, 'baseHex', 7, 'stay');
    if (hinge) {
      strut(parts, joints, 'folding_hinge_front', hinge, bottom, tube, 'facadeHex', 8, 'frame');
      parts.push(C('fold_hinge', 0.055, 0.12, hinge, 'accentHex', 8, [PI_2, 0, 0], 'hinge'));
    }
    strut(parts, joints, 'head_tube', headBottom, headTop, tube * 0.82, 'facadeHex', 8, 'head');
    strutPair(parts, joints, 'front_fork', headBottom, frontAxle, 0.021, 'baseHex', 7, 'fork');
    strut(parts, joints, 'seat_post', seat, [seat[0], 0.99, 0], 0.018, 'baseHex', 7, 'seatpost');
    parts.push(B('saddle', 0.28, 0.045, 0.13, [seat[0], 1.02, 0], 'baseHex', [0, 0, 0], 'saddle'));
    const crank = [bottom[0], bottom[1], 0];
    for (const z of [-0.09, 0.09]) {
      parts.push(T(`crank_ring_${z < 0 ? 'left' : 'right'}`, 0.095, 0.016, [crank[0], crank[1], z], 'accentHex', [PI_2, 0, 0], 'drivetrain'));
      axle(parts, `crank_axle_${z < 0 ? 'left' : 'right'}`, crank[0], crank[1], z, 0.20, 0.018, 'baseHex', 'drivetrain');
      strut(parts, joints, `crank_arm_${z < 0 ? 'left' : 'right'}`, [crank[0], crank[1], z], [crank[0] + (z < 0 ? -0.12 : 0.12), crank[1] - 0.10, z], 0.012, 'accentHex', 6, 'drivetrain');
      parts.push(B(`pedal_${z < 0 ? 'left' : 'right'}`, 0.11, 0.025, 0.035, [crank[0] + (z < 0 ? -0.14 : 0.14), crank[1] - 0.11, z], 'baseHex', [0, 0, 0], 'pedal'));
    }
    addChain(parts, joints, rearAxle, crank, -0.09, 'darkHex');
    const handleTop = [0.47, 1.00, 0];
    strut(parts, joints, 'handle_stem', headTop, handleTop, 0.018, 'baseHex', 7, 'handlebar');
    axle(parts, 'flat_handlebar', handleTop[0], handleTop[1], 0, 0.60, 0.016, 'baseHex', 'handlebar');
    parts.push(B('handle_grip_left', 0.08, 0.035, 0.055, [handleTop[0], handleTop[1], -0.34], 'darkHex', [0, 0, 0], 'handlebar'));
    parts.push(B('handle_grip_right', 0.08, 0.035, 0.055, [handleTop[0], handleTop[1], 0.34], 'darkHex', [0, 0, 0], 'handlebar'));
    strut(parts, joints, 'front_brake_cable', [handleTop[0], handleTop[1], 0], [headTop[0], headTop[1], 0], 0.008, 'darkHex', 5, 'cable');
    parts.push(T('rear_fender', r + 0.014, 0.012, [rearX, r + 0.028, 0], 'brightHex', [PI_2, 0, 0], 'fender'));
    parts.push(T('front_fender', r + 0.014, 0.012, [frontX, r + 0.028, 0], 'brightHex', [PI_2, 0, 0], 'fender'));
    if (kind === 'city_utility') {
      parts.push(B('rear_rack_deck', 0.68, 0.035, 0.32, [-0.43, 0.70, 0], 'accentHex', [0, 0, 0], 'rack'));
      for (const z of [-0.14, 0.14]) {
        strut(parts, joints, `rear_rack_support_${z < 0 ? 'left' : 'right'}`, [-0.43, 0.39, z], [-0.43, 0.70, z], 0.012, 'accentHex', 6, 'rack');
      }
      parts.push(B('chain_guard', 0.52, 0.08, 0.24, [-0.03, 0.39, -0.075], 'brightHex', [0, 0, 0], 'chain_guard'));
    } else {
      parts.push(B('folding_gravel_hinge_plate_left', 0.18, 0.035, 0.08, [hinge[0], hinge[1], -0.08], 'accentHex', [0, 0, 0], 'hinge'));
      parts.push(B('folding_gravel_hinge_plate_right', 0.18, 0.035, 0.08, [hinge[0], hinge[1], 0.08], 'accentHex', [0, 0, 0], 'hinge'));
    }
    return {
      style: kind === 'city_utility' ? 'city_utility_bicycle' : 'folding_gravel_bicycle',
      symmetryMode: 'mirrored_bilateral', colors: palette, parts, joints, wheels,
      note: kind === 'city_utility'
        ? '全尺寸通勤車的穿越式車架、單側鏈條、前後擋泥板、鏈罩、後貨架與把手均接回車架關節。'
        : '全尺寸折疊礫石車保留真實輪徑，以中央鉸鏈板連接前後車架；單側鏈條、碟煞、前叉與把手均接回關節。',
    };
  }

  const bottom = [0.00, kind === 'road' ? 0.37 : 0.39, 0];
  const seat = [-0.39, kind === 'road' ? 0.82 : 0.79, 0];
  const headTop = [0.40, kind === 'road' ? 0.91 : 0.84, 0];
  const headBottom = [0.38, kind === 'road' ? 0.68 : 0.63, 0];
  strut(parts, joints, 'top_tube', seat, headTop, tube, 'roofHex', 8, 'frame');
  strut(parts, joints, 'down_tube', headBottom, bottom, tube * 1.12, 'facadeHex', 8, 'frame');
  strut(parts, joints, 'seat_tube', bottom, seat, tube * 0.95, 'roofHex', 8, 'frame');
  strutPair(parts, joints, 'rear_chainstay', rearAxle, bottom, tube * 0.72, 'baseHex', 7, 'stay');
  strutPair(parts, joints, 'rear_seatstay', rearAxle, seat, tube * 0.60, 'baseHex', 7, 'stay');
  strut(parts, joints, 'head_tube', headBottom, headTop, tube * 0.82, 'facadeHex', 8, 'head');
  strutPair(parts, joints, 'front_fork', headBottom, frontAxle, kind === 'mtb' ? 0.026 : 0.021, 'baseHex', 7, 'fork');
  if (kind === 'mtb') {
    strutPair(parts, joints, 'suspension_upper', headTop, [frontX - 0.03, r + 0.22, 0], 0.022, 'accentHex', 7, 'suspension');
    parts.push(C('fork_crown', 0.045, 0.16, [frontX - 0.03, r + 0.20, 0], 'accentHex', 8, [PI_2, 0, 0], 'suspension'));
  }
  strut(parts, joints, 'seat_post', seat, [seat[0], seat[1] + 0.19, 0], 0.018, 'baseHex', 7, 'seatpost');
  parts.push(B('saddle', kind === 'road' ? 0.24 : 0.28, 0.045, 0.12, [seat[0], seat[1] + 0.22, 0], 'baseHex'));
  const crank = [bottom[0], bottom[1], 0];
  for (const z of [-0.09, 0.09]) {
    parts.push(T(`crank_ring_${z < 0 ? 'left' : 'right'}`, 0.095, 0.016, [crank[0], crank[1], z], 'accentHex', [PI_2, 0, 0], 'drivetrain'));
    axle(parts, `crank_axle_${z < 0 ? 'left' : 'right'}`, crank[0], crank[1], z, 0.20, 0.018, 'baseHex', 'drivetrain');
    strut(parts, joints, `crank_arm_${z < 0 ? 'left' : 'right'}`, [crank[0], crank[1], z], [crank[0] + (z < 0 ? -0.12 : 0.12), crank[1] - 0.10, z], 0.012, 'accentHex', 6, 'drivetrain');
    parts.push(B(`pedal_${z < 0 ? 'left' : 'right'}`, 0.11, 0.025, 0.035, [crank[0] + (z < 0 ? -0.14 : 0.14), crank[1] - 0.11, z], 'baseHex', [0, 0, 0], 'pedal'));
  }
  addChain(parts, joints, rearAxle, crank, -0.09, 'darkHex');
  const handleTop = [0.47, headTop[1] + 0.08, 0];
  strut(parts, joints, 'handle_stem', headTop, handleTop, 0.018, 'baseHex', 7, 'handlebar');
  if (kind === 'road') {
    strut(parts, joints, 'drop_bar_center', handleTop, [0.54, handleTop[1], 0], 0.016, 'baseHex', 7, 'handlebar');
    strut(parts, joints, 'drop_bar_left', [0.54, handleTop[1], 0], [0.54, handleTop[1] - 0.15, -0.20], 0.014, 'baseHex', 7, 'handlebar');
    strut(parts, joints, 'drop_bar_right', [0.54, handleTop[1], 0], [0.54, handleTop[1] - 0.15, 0.20], 0.014, 'baseHex', 7, 'handlebar');
    strut(parts, joints, 'drop_bar_bridge', [0.54, handleTop[1] - 0.15, -0.20], [0.54, handleTop[1] - 0.15, 0.20], 0.014, 'baseHex', 7, 'handlebar');
  } else {
    axle(parts, 'flat_handlebar', handleTop[0], handleTop[1], 0, 0.60, 0.016, 'baseHex', 'handlebar');
    parts.push(B('handle_grip_left', 0.08, 0.035, 0.055, [handleTop[0], handleTop[1], -0.34], 'darkHex'));
    parts.push(B('handle_grip_right', 0.08, 0.035, 0.055, [handleTop[0], handleTop[1], 0.34], 'darkHex'));
  }
  strut(parts, joints, 'front_brake_cable', [handleTop[0], handleTop[1], 0], [headTop[0], headTop[1], 0], 0.008, 'darkHex', 5, 'cable');
  if (kind === 'mtb') {
    parts.push(B('left_bottle_cage', 0.08, 0.24, 0.25, [-0.01, 0.57, -0.075], 'accentHex', [0, 0, 0], 'accessory'));
    parts.push(B('right_bottle_cage', 0.08, 0.24, 0.25, [-0.01, 0.57, 0.075], 'accentHex', [0, 0, 0], 'accessory'));
  }
  return { style: kind === 'road' ? 'drop_bar_road_bicycle' : kind === 'hybrid' ? 'hybrid_bicycle' : 'mountain_bicycle', symmetryMode: 'mirrored_bilateral', colors: palette, parts, joints, wheels, note: '中心面前三角、雙側後下叉／後上叉、單側鏈條、曲柄踏板、前叉、輪圈、輪轂、輻條、煞車盤與纜線均以接點建模。' };
}

function motorClass(stem) {
  const s = stem.toLowerCase();
  if (s.includes('180512')) return 'chopper';
  if (s.includes('165019')) return 'sport_motorcycle';
  if (s.includes('5bdf') || s.includes('7801666')) return 'classic_motorcycle';
  if (s.includes('148928') || s.includes('000001_174237')) return 'retro_scooter';
  if (s.includes('541753') || s.includes('000002_164517')) return 'maxi_scooter';
  return 'scooter';
}

function motorSpec(target) {
  const kind = motorClass(target.stem);
  const palette = kind === 'chopper' ? COLORS.chopper : kind === 'sport_motorcycle' ? COLORS.motorcycle : kind === 'classic_motorcycle' ? COLORS.classic : kind === 'retro_scooter' ? COLORS.redScooter : COLORS.scooter;
  const parts = [], joints = [], wheels = [];
  const motorcycle = kind === 'chopper' || kind === 'sport_motorcycle' || kind === 'classic_motorcycle';
  const wheelProfile = kind === 'chopper'
    ? { front: 0.38, rear: 0.39, tire: 0.060 }
    : kind === 'sport_motorcycle'
      ? { front: 0.34, rear: 0.34, tire: 0.055 }
      : kind === 'classic_motorcycle'
        ? { front: 0.34, rear: 0.34, tire: 0.055 }
        : kind === 'maxi_scooter'
          ? { front: 0.33, rear: 0.30, tire: 0.065 }
          : kind === 'retro_scooter'
            ? { front: 0.31, rear: 0.285, tire: 0.065 }
            : { front: 0.30, rear: 0.275, tire: 0.065 };
  const frontR = wheelProfile.front;
  const rearR = wheelProfile.rear;
  const tire = wheelProfile.tire;
  const wb = kind === 'chopper' ? 1.78 : motorcycle ? 1.48 : 1.23;
  const rearX = -wb / 2;
  const frontX = wb / 2;
  addWheel(parts, wheels, 'rear_wheel', rearX, 0, rearR, tire, palette, { disc: motorcycle });
  addWheel(parts, wheels, 'front_wheel', frontX, 0, frontR, tire, palette, { disc: true });
  const rearAxle = [rearX, rearR, 0];
  const frontAxle = [frontX, frontR, 0];

  if (!motorcycle) {
    parts.push(B('underbody', 0.98, 0.18, 0.46, [-0.03, 0.37, 0], 'baseHex'));
    parts.push(B('footboard', 0.78, 0.11, 0.40, [-0.08, 0.50, 0], 'darkHex'));
    parts.push(W('front_cowling', 0.48, 0.66, kind === 'maxi_scooter' ? 0.58 : 0.52, [0.43, 0.72, 0], 'roofHex', [0, 0, -0.12]));
    parts.push(W('rear_body', 0.55, 0.43, 0.48, [-0.44, 0.63, 0], 'facadeHex', [0, 0, 0.08]));
    parts.push(B('seat', 0.58, 0.12, 0.40, [-0.28, 0.82, 0], 'darkHex'));
    parts.push(B('seat_trim', 0.46, 0.025, 0.33, [-0.28, 0.89, 0], 'brightHex'));
    strut(parts, joints, 'front_fork_left', [0.38, 0.63, -0.12], frontAxle.map((v, i) => i === 2 ? -0.12 : v), 0.022, 'baseHex', 7, 'fork');
    strut(parts, joints, 'front_fork_right', [0.38, 0.63, 0.12], frontAxle.map((v, i) => i === 2 ? 0.12 : v), 0.022, 'baseHex', 7, 'fork');
    axle(parts, 'front_axle', frontX, frontR, 0, 0.20, 0.026, 'baseHex');
    strut(parts, joints, 'handle_stem', [0.39, 0.78, 0], [0.34, 1.03, 0], 0.020, 'baseHex', 7, 'handlebar');
    axle(parts, 'handlebar', 0.34, 1.03, 0, 0.66, 0.017, 'baseHex', 'handlebar');
    for (const z of [-0.39, 0.39]) {
      parts.push(E(`mirror_${z < 0 ? 'left' : 'right'}`, 0.075, 0.025, 0.11, [0.34, 1.12, z], 'brightHex', [0, 0, 0], 'mirror'));
      strut(parts, joints, `mirror_stem_${z < 0 ? 'left' : 'right'}`, [0.34, 1.03, z * 0.8461538462], [0.34, 1.12, z], 0.010, 'baseHex', 6, 'mirror');
    }
    parts.push(E('headlamp', 0.095, 0.085, 0.13, [0.66, 0.82, 0], 'brightHex', [0, 0, 0], 'lamp'));
    parts.push(B('windshield', 0.035, kind === 'maxi_scooter' ? 0.42 : 0.35, kind === 'maxi_scooter' ? 0.40 : 0.34, [0.50, kind === 'maxi_scooter' ? 1.08 : 1.04, 0], 'glassHex', [0, 0, -0.18], 'glass'));
    strut(parts, joints, 'rear_swingarm', rearAxle, [-0.08, 0.42, 0], 0.028, 'baseHex', 7, 'swingarm');
    parts.push(C('engine_case', 0.23, 0.25, [-0.02, 0.43, 0], 'baseHex', 10, [PI_2, 0, 0], 'engine'));
    strut(parts, joints, 'exhaust_header', [-0.24, 0.45, -0.20], [-0.60, 0.38, -0.20], 0.025, 'accentHex', 7, 'exhaust');
    parts.push(B('exhaust_muffler', 0.42, 0.09, 0.10, [-0.42, 0.37, -0.20], 'accentHex', [0, 0, 0], 'exhaust'));
    strut(parts, joints, 'kickstand', [-0.16, 0.40, 0.16], [-0.28, 0.035, 0.16], 0.012, 'baseHex', 6, 'stand');
    return { style: kind, symmetryMode: 'mirrored_bilateral', colors: palette, parts, joints, wheels, note: '踏板、前整流罩、擋風鏡、左右後視鏡、前叉、引擎、後搖臂、單側排氣管、側柱與前後不同輪徑均完整接合。' };
  }

  const bottom = [0.00, 0.40, 0];
  const seat = [kind === 'chopper' ? -0.48 : -0.35, kind === 'chopper' ? 0.70 : 0.78, 0];
  const head = [kind === 'chopper' ? 0.72 : 0.54, 0.80, 0];
  const tank = [kind === 'chopper' ? 0.03 : 0.10, kind === 'chopper' ? 0.76 : 0.86, 0];
  strutPair(parts, joints, 'main_top_frame', seat, head, 0.034, 'roofHex', 8, 'frame');
  strutPair(parts, joints, 'main_down_frame', head, bottom, 0.038, 'facadeHex', 8, 'frame');
  strutPair(parts, joints, 'rear_frame', rearAxle, seat, 0.030, 'baseHex', 7, 'frame');
  strutPair(parts, joints, 'rear_swingarm', rearAxle, bottom, 0.025, 'baseHex', 7, 'swingarm');
  parts.push(B('fuel_tank', kind === 'sport_motorcycle' ? 0.56 : 0.48, 0.28, 0.40, tank, 'roofHex', [0, 0, kind === 'chopper' ? -0.08 : 0], 'tank'));
  parts.push(E('engine', 0.27, 0.25, 0.22, [0.00, 0.49, 0], 'baseHex', [0, 0, 0], 'engine'));
  parts.push(C('engine_head', 0.18, 0.22, [0.00, 0.68, 0], 'accentHex', 8, [0, 0, 0], 'engine'));
  parts.push(B('seat', kind === 'chopper' ? 0.70 : 0.52, 0.10, 0.34, [seat[0] - 0.04, seat[1] + 0.05, 0], 'darkHex'));
  strutPair(parts, joints, 'front_fork', head, frontAxle, 0.025, 'accentHex', 7, 'fork');
  if (kind === 'sport_motorcycle') strutPair(parts, joints, 'fork_inner', head, [frontX, frontR + 0.12, 0], 0.014, 'brightHex', 6, 'fork');
  axle(parts, 'front_axle', frontX, frontR, 0, 0.20, 0.025, 'baseHex');
  strut(parts, joints, 'handle_stem', head, [head[0] + 0.02, 1.04, 0], 0.018, 'baseHex', 7, 'handlebar');
  axle(parts, 'handlebar', head[0] + 0.02, 1.04, 0, 0.62, 0.016, 'baseHex', 'handlebar');
  for (const z of [-0.38, 0.38]) {
    parts.push(E(`mirror_${z < 0 ? 'left' : 'right'}`, 0.075, 0.025, 0.10, [head[0] + 0.02, 1.14, z], 'brightHex', [0, 0, 0], 'mirror'));
    strut(parts, joints, `mirror_stem_${z < 0 ? 'left' : 'right'}`, [head[0] + 0.02, 1.04, z * 0.8157894737], [head[0] + 0.02, 1.14, z], 0.010, 'baseHex', 6, 'mirror');
  }
  parts.push(E('headlamp', 0.11, 0.10, 0.14, [head[0] + 0.20, 0.90, 0], 'brightHex', [0, 0, 0], 'lamp'));
  strut(parts, joints, 'front_brake_line', [head[0] + 0.02, 1.04, 0], [frontX, frontR + 0.12, 0], 0.008, 'darkHex', 5, 'cable');
  const exhaustSides = kind === 'chopper' ? [-0.20, 0.20] : [-0.20];
  for (const z of exhaustSides) {
    strut(parts, joints, `exhaust_${z < 0 ? 'left' : 'right'}`, [0.03, 0.47, z], [-0.72, 0.37, z], 0.025, 'accentHex', 7, 'exhaust');
    parts.push(B(`muffler_${z < 0 ? 'left' : 'right'}`, 0.40, 0.09, 0.09, [-0.52, 0.35, z], 'accentHex', [0, 0, 0], 'exhaust'));
  }
  if (kind === 'sport_motorcycle') {
    parts.push(W('front_fairing', 0.42, 0.58, 0.54, [0.55, 0.79, 0], 'roofHex', [0, 0, -0.16], 'fairing'));
    parts.push(B('windscreen', 0.035, 0.34, 0.30, [0.60, 1.10, 0], 'glassHex', [0, 0, -0.20], 'glass'));
    parts.push(B('radiator', 0.12, 0.30, 0.42, [0.22, 0.54, 0], 'baseHex', [0, 0, 0], 'radiator'));
    parts.push(T('front_fender', frontR + 0.022, 0.014, [frontX, frontR + 0.038, 0], 'roofHex', [PI_2, 0, 0], 'fender'));
    for (const z of [-0.20, 0.20]) strut(parts, joints, `fairing_stay_${z < 0 ? 'left' : 'right'}`, [head[0], head[1], z], [0.68, 0.79, z], 0.012, 'baseHex', 6, 'fairing');
  }
  if (kind === 'classic_motorcycle') {
    parts.push(T('front_fender', frontR + 0.022, 0.014, [frontX, frontR + 0.038, 0], 'brightHex', [PI_2, 0, 0], 'fender'));
  }
  if (kind === 'classic_motorcycle') {
    for (const z of [-0.18, 0.18]) strut(parts, joints, `rear_shock_${z < 0 ? 'left' : 'right'}`, rearAxle, [rearX + 0.18, 0.74, z], 0.014, 'brightHex', 6, 'suspension');
    parts.push(B('rear_fender', 0.70, 0.025, 0.34, [rearX - 0.02, 0.61, 0], 'brightHex', [0, 0, 0], 'fender'));
  }
  if (kind === 'chopper') {
    parts.push(B('rear_fender', 0.74, 0.025, 0.34, [rearX - 0.04, 0.67, 0], 'brightHex', [0, 0, 0], 'fender'));
    parts.push(B('sissy_bar', 0.035, 0.52, 0.035, [rearX - 0.20, 0.96, 0], 'accentHex', [0, 0, 0], 'frame'));
    strut(parts, joints, 'chopper_rake_brace', head, [frontX, frontR + 0.10, 0], 0.014, 'accentHex', 6, 'fork');
  }
  strut(parts, joints, 'kickstand', [-0.10, 0.40, 0.15], [-0.27, 0.035, 0.15], 0.012, 'baseHex', 6, 'stand');
  return { style: kind, symmetryMode: 'mirrored_bilateral', colors: palette, parts, joints, wheels, note: '車架、油箱/車殼、引擎、依實車配置的排氣、前叉、後視鏡、頭燈、煞車線、擋泥板與側柱均以共享接點完成。' };
}

function stableTargetOfKey(key) {
  return String(key || '')
    .replace(/_[0-9a-f]{8}(?:_luna)?_v6$/, '')
    .replace(/_v6$/, '')
    .replace(/~\d+$/, '');
}
function canonicalFromImage(row) {
  const image = row.image || row.source_image || '';
  const stem = basename(image, extname(image));
  return `vehicle/${row.subpart}_${stem}`;
}
function canonicalFromKey(key) {
  return stableTargetOfKey(key);
}
function loadReviewStatuses() {
  if (!existsSync(REVIEW_STATE_PATH)) return new Map();
  try {
    const raw = JSON.parse(readFileSync(REVIEW_STATE_PATH, 'utf8'));
    const items = raw.items && !Array.isArray(raw.items) ? raw.items : raw;
    return new Map(Object.entries(items).map(([key, value]) => [canonicalFromKey(key), value?.status || null]));
  } catch { return new Map(); }
}
function sourceIndex() {
  const index = new Map();
  for (const root of SOURCE_ROOTS) {
    if (!existsSync(root)) continue;
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (IMAGE_EXTS.has(extname(entry.name).toLowerCase())) index.set(entry.name.toLowerCase(), path);
      }
    };
    walk(root);
  }
  return index;
}
function evidenceIndex() {
  const index = new Map();
  for (const root of EVIDENCE_ROOTS) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) if (entry.toLowerCase().endsWith('.json')) index.set(entry.toLowerCase(), join(root, entry));
  }
  return index;
}
function resolveSource(row, sources) {
  const image = row.image || '';
  const name = basename(image).toLowerCase();
  if (sources.has(name)) return sources.get(name);
  for (const root of SOURCE_ROOTS) {
    const direct = join(root, image);
    if (existsSync(direct)) return direct;
  }
  return null;
}
function readEvidence(row, evidence) {
  const stem = basename(row.image || '', extname(row.image || '')).toLowerCase();
  const path = evidence.get(`${stem}.json`);
  if (!path) return { path: null, schemaVersion: null, status: 'missing_yolo26_schema_v2', target: null };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const schema2 = raw.schemaVersion === 2 && raw.models?.detection === 'yolo26n.pt' && raw.models?.segmentation === 'yolo26n-seg.pt' && raw.models?.depth === 'yolo26n-depth.pt';
    return { path, schemaVersion: schema2 ? 2 : null, status: schema2 ? 'yolo26_schema_v2' : 'legacy_feature_metadata_only', target: raw.targets?.[0] || null };
  } catch { return { path, schemaVersion: null, status: 'invalid_feature_metadata', target: null }; }
}
function loadTargets() {
  const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
  const statuses = loadReviewStatuses();
  const grouped = new Map();
  for (const row of db.items || []) {
    if (row.family !== 'vehicle' || !['bike', 'motor'].includes(row.subpart) || row.version !== 6) continue;
    const canonical = canonicalFromImage(row);
    const current = grouped.get(canonical);
    if (!current || String(row.image || '').length > String(current.image || '').length) {
      grouped.set(canonical, { ...row, stable: canonical, stem: basename(row.image || '', extname(row.image || '')), staleKeys: [...(current?.staleKeys || []), row.key] });
    } else current.staleKeys.push(row.key);
  }
  const all = [...grouped.values()].filter((row) => !['ok', 'archive', 'purge'].includes(statuses.get(row.stable) || null));
  const selected = ONLY ? all.filter((row) => row.stable === ONLY || row.key === ONLY || row.stem === ONLY || row.image === ONLY || `${row.subpart}/${row.stem}` === ONLY) : all;
  return { rows: selected.slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined), totalEligible: selected.length, db };
}

function assertVehicleContract(spec, target) {
  if (!spec.parts.length) throw new Error(`${target.stable}: 沒有零件`);
  if (!spec.wheels.length) throw new Error(`${target.stable}: 沒有車輪`);
  for (const part of spec.parts) {
    if (!Array.isArray(part.pos) || part.pos.length !== 3 || part.pos.some((value) => !Number.isFinite(value))) throw new Error(`${target.stable}: 零件位置無效 ${part.name}`);
    if (part.type === 'cylinder' && (!(part.height > 0) || !(part.radii?.[0] > 0))) throw new Error(`${target.stable}: 圓柱尺寸無效 ${part.name}`);
  }
  for (const joint of spec.joints) {
    if (!(distance(joint.a, joint.b) > joint.radius * 2)) throw new Error(`${target.stable}: 接點過短 ${joint.name}`);
    if (joint.a[1] < 0 || joint.b[1] < 0) throw new Error(`${target.stable}: 接點穿地 ${joint.name}`);
  }
  const duplicateJoints = new Map();
  for (const joint of spec.joints) {
    const endpoints = [joint.a, joint.b].map((point) => point.map((value) => value.toFixed(4)).join(',')).sort().join('|');
    const key = `${endpoints}|${joint.radius.toFixed(4)}`;
    const previous = duplicateJoints.get(key);
    if (previous) throw new Error(`${target.stable}: 同端點細長件重複 ${previous} / ${joint.name}`);
    duplicateJoints.set(key, joint.name);
  }
  for (const wheel of spec.wheels) {
    if (wheel.axis !== 'z' || Math.abs(wheel.center[1] - wheel.outerRadius) > 0.001) throw new Error(`${target.stable}: 輪胎方向或尺度契約失敗 ${wheel.name}`);
    const tire = spec.parts.find((part) => part.name === wheel.tire);
    if (!tire || tire.type !== 'torus_ring' || Math.abs(tire.rot[0] - PI_2) > 0.001) throw new Error(`${target.stable}: 輪胎未沿 Z 軸 ${wheel.name}`);
  }
  for (const part of spec.parts.filter((part) => part.type === 'cylinder' && (part.role === 'axle' || ['flat_handlebar', 'handlebar'].includes(part.name) || part.name.endsWith('_hub')))) {
    if (Math.abs(part.rot[0] - PI_2) > 0.001 || Math.abs(part.rot[1]) > 0.001 || Math.abs(part.rot[2]) > 0.001) {
      throw new Error(`${target.stable}: 橫向軸方向錯誤 ${part.name}`);
    }
  }
  const tireParts = spec.parts.filter((part) => part.role === 'wheel_tire');
  if (tireParts.length !== spec.wheels.length) throw new Error(`${target.stable}: 車輪與輪胎數量不一致`);
}

function addContracts(geometry, spec) {
  geometry.modelJson.structuralContract = {
    coordinateFrame: { nose: '+X', up: '+Y', lateral: '+Z' },
    thinMembersEndpointDerived: true,
    sharedJoints: spec.joints,
    wheelContract: spec.wheels,
    noGroundPenetrationExpected: true,
    mirroredBilateral: spec.symmetryMode === 'mirrored_bilateral',
    centerlineMembersSingle: true,
    sourceSpecificAssembly: true,
    visualReviewRequired: true,
  };
  geometry.featuresJson.structuralContract = geometry.modelJson.structuralContract;
}
function reviewFor(spec, bounds) {
  const hasHardBoundsDefect = bounds.min[1] < -0.035 || bounds.size[0] < 0.7 || bounds.size[1] < 0.25 || bounds.size[2] < 0.25;
  return {
    similarityScore: null,
    verdict: 'awaiting_human_review',
    corrections: ['逐張對照來源圖與固定五方向視圖', '確認車型特有零件、接點與前後輪徑'],
    reviewer: 'gpt-5.6-luna_vehicle_geometry_contract',
    reviewMode: 'fixed_five_view_visual_inspection_plus_deterministic_geometry',
    independentMultimodalReview: 'required',
    hardDefects: hasHardBoundsDefect ? ['bounds_contract', 'human_visual_review_required'] : ['human_visual_review_required'],
    fixedViews: ['front_3_4', 'side_left', 'front', 'side_right', 'rear'],
    critique: `${spec.style}：解析幾何契約已通過，中心線車架件為單件、雙側件才鏡像；細長件由共享接點生成、車輪法線沿 Z 且輪胎落地；尚未完成獨立視覺比對，不得視為通過。`,
  };
}
function outputFor(target, hash) { return join(ROOT, 'out', '3d_data', 'vehicle', target.subpart, `vehicle_${safeName(target.stable)}_${hash}_luna_v6`); }
function previewFor(target, hash) { return join(ROOT, 'out', 'review_previews', `vehicle_${safeName(target.stable)}_${hash}_luna_v6.png`); }
function renderPreview(model, preview) {
  const modelPath = `${preview}.model.json`;
  writeJsonAtomic(modelPath, model);
  const args = UV_PREVIEW
    ? ['run', '--quiet', '--python', UV_PYTHON, '--with', 'Pillow', '--no-project', 'python', PREVIEW_RENDERER, modelPath, preview]
    : [PREVIEW_RENDERER, modelPath, preview];
  execFileSync(PYTHON, args, { timeout: 30_000 });
}

function processTarget(row, indexes) {
  const spec = row.subpart === 'bike' ? bikeSpec(row) : motorSpec(row);
  assertVehicleContract(spec, row);
  const geometry = buildGeometryFromParts({ style: spec.style, symmetryMode: spec.symmetryMode, colors: spec.colors, parts: spec.parts }, 'vehicle', row.subpart, safeName(row.stable));
  geometry.modelJson.parts.forEach((part, index) => {
    part.role = spec.parts[index]?.role || 'structure';
  });
  addContracts(geometry, spec);
  geometry.objContent = geometry.objContent.replaceAll('v6 Gemini', 'v6 GPT-5.6 Luna');
  const evidence = readEvidence(row, indexes.evidence);
  const source = resolveSource(row, indexes.sources);
  const hash = hashHex(`${row.stable}|${spec.style}|gpt-5.6-luna-vehicle-v6`);
  const targetId = `vehicle_${safeName(row.stable)}_${hash}_luna_v6`;
  const key = `${row.stable}_${hash}_luna_v6`;
  const outDir = outputFor(row, hash);
  const preview = previewFor(row, hash);
  const review = reviewFor(spec, geometry.bounds);
  const sourceImage = row.image || `vehicle/${row.subpart}/${row.stem}.jpg`;
  const evidenceOverride = {
    type: 'llm_visual_direct', authorizedBy: 'user', model: 'gpt-5.6-luna',
    reason: '依使用者指定以 GPT-5.6 Luna 視覺重建；YOLO26 schema-v2 缺失時保持 awaiting_human_review，不提升 runtime 資格。',
  };
  if (!DRY_RUN) {
    mkdirSync(outDir, { recursive: true });
    mkdirSync(dirname(preview), { recursive: true });
    renderPreview(geometry.modelJson, preview);
    const evidenceRelative = evidence.path ? relativePath(evidence.path) : null;
    const features = {
      ...geometry.featuresJson, schemaVersion: evidence.schemaVersion, evidenceStatus: evidence.status,
      yolo26: { schemaVersion: evidence.schemaVersion, evidenceStatus: evidence.status, featureFile: evidenceRelative, target: evidence.target },
      evidenceOverride, eligible: false, pipelineEligibility: 'awaiting_human_review', sourceImage,
      reconstructionNote: spec.note, localModel: 'gpt-5.6-luna', similarityReview: review,
    };
    const metadata = {
      id: targetId, key, family: 'vehicle', subpart: row.subpart, style: spec.style, symmetryMode: spec.symmetryMode,
      similarityScore: review.similarityScore, similarityReview: review.critique, similarityVerdict: review.verdict,
      similarityCorrections: review.corrections, version: 6, verStr: 'v6', method: 'gpt-5.6-luna_visual_direct',
      status: 'awaiting_human_review', eligible: false, pipelineEligibility: 'awaiting_human_review', source_image: sourceImage,
      source_full_path: source, yolo26: features.yolo26, evidenceOverride, preview: relativePath(preview), bounds: geometry.bounds,
      reconstructionNote: spec.note, created_at: new Date().toISOString(), humanVerdictPreserved: true,
    };
    writeJsonAtomic(join(outDir, 'model.json'), geometry.modelJson);
    writeJsonAtomic(join(outDir, 'features.json'), features);
    writeJsonAtomic(join(outDir, 'metadata.json'), metadata);
    writeTextAtomic(join(outDir, 'model.obj'), geometry.objContent);
  }
  return {
    target: row.stable, status: DRY_RUN ? 'validated' : 'awaiting_human_review', targetId, key, family: 'vehicle', subpart: row.subpart,
    image: sourceImage, sourceFound: Boolean(source), staleRowsCollapsed: row.staleKeys.length, style: spec.style,
    symmetryMode: spec.symmetryMode, featureEvidence: evidence.status, evidenceOverride: evidenceOverride.type, eligible: false,
    pipelineEligibility: 'awaiting_human_review', similarityReview: review, outputDir: relativePath(outDir), preview: relativePath(preview),
    bounds: geometry.bounds, parts: geometry.modelJson.parts.length, thinMembers: spec.joints.length,
  };
}

function entryCanonical(entry) {
  for (const key of entry.keys || (entry.key ? [entry.key] : [])) {
    const canonical = canonicalFromKey(key);
    if (/^vehicle\/(bike|motor)_/.test(canonical)) return canonical;
  }
  for (const image of entry.imgs || []) {
    const file = image.file || '';
    const match = file.match(/^vehicle\/(bike|motor)\/([^/]+)$/i);
    if (match) return `vehicle/${match[1]}_${basename(match[2], extname(match[2]))}`;
  }
  return null;
}
function finalizeCatalog(results) {
  const accepted = results.filter((result) => result.status === 'awaiting_human_review');
  if (!accepted.length) return;
  const targets = new Set(accepted.map((result) => result.target));
  const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
  db.items = (db.items || []).filter((row) => !(row.family === 'vehicle' && ['bike', 'motor'].includes(row.subpart) && row.version === 6 && targets.has(canonicalFromImage(row))));
  for (const result of accepted) {
    db.items.push({
      id: result.targetId, key: result.key, family: 'vehicle', subpart: result.subpart, style: result.style, symmetryMode: result.symmetryMode,
      similarityScore: result.similarityReview.similarityScore, version: 6, verStr: 'v6', method: 'gpt-5.6-luna_visual_direct', status: 'awaiting_human_review',
      image: result.image, evidenceOverride: result.evidenceOverride, eligible: false, pipelineEligibility: 'awaiting_human_review', bounds: result.bounds,
      spec: { style: result.style }, triangles: result.bounds.triangles, outputDir: result.outputDir,
    });
  }
  db.generated_at = new Date().toISOString();
  db.total_objects = db.items.length;
  db.families = [...new Set(db.items.map((row) => row.family))];
  writeJsonAtomic(DB_PATH, db);

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  manifest.parts = (manifest.parts || []).filter((entry) => !targets.has(entryCanonical(entry)));
  for (const result of accepted) {
    const hash = result.key.match(/_([0-9a-f]{8})_luna_v6$/)?.[1] || '00000000';
    manifest.parts.push({
      method: 'gpt-5.6-luna_visual_direct', version: 6, verStr: 'v6', consumer: `vehicle catalog & partlib (${result.subpart})`,
      rev: 'HEAD', at: new Date().toISOString().slice(0, 10),
      imgs: [{ role: 'primary', id: `img_${hash}`, family: 'vehicle', part: result.subpart, query: result.target, api: 'gpt-5.6-luna_visual_direct', license: 'unverified(restricted/local)', creator: null, source_url: '', file: result.image }],
      gen: { tool: 'GPT-5.6 Luna direct visual vehicle reconstruction', runner: 'tools/ai3d/direct_ingest_luna_vehicle_v6.mjs', params: '--finalize', machine: 'Codex GPT-5.6 Luna', measured: `Triangles ${result.bounds.triangles}, Vertices ${result.bounds.vertices}, Similarity pending independent visual review` },
      post: { tool: 'tools/ai3d/direct_ingest_luna_vehicle_v6.mjs', fit: 1, bounds: result.bounds.size, note: `${result.style}；中心線／雙側構件與車輪方向契約通過，固定五方向預覽等待零件台人眼覆核。` },
      keys: [result.key],
    });
  }
  writeJsonAtomic(MANIFEST_PATH, manifest);
}
function writeReport(results) {
  if (DRY_RUN) return;
  const path = join(ROOT, 'out', 'review_previews', 'vehicle_luna_v6_candidates.json');
  let prior = [];
  if (existsSync(path)) {
    try { prior = JSON.parse(readFileSync(path, 'utf8')).candidates || []; } catch { prior = []; }
  }
  const canonicalReportTarget = (target) => String(target)
    .replace(/^vehicle_(bike|motor)_/, 'vehicle/$1_');
  const replaced = new Set(results.map((result) => result.target));
  const merged = new Map();
  for (const result of prior) {
    const canonical = canonicalReportTarget(result.target);
    if (!replaced.has(canonical)) merged.set(canonical, { ...result, target: canonical });
  }
  for (const result of results) merged.set(result.target, result);
  writeJsonAtomic(path, { model: 'gpt-5.6-luna', generatedAt: new Date().toISOString(), humanVerdictsPreserved: true, candidates: [...merged.values()] });
}

function main() {
  if (!DRY_RUN && !existsSync(PYTHON)) throw new Error(`找不到 Python: ${PYTHON}`);
  const { rows, totalEligible } = loadTargets();
  const indexes = { sources: sourceIndex(), evidence: evidenceIndex() };
  console.log(`vehicle/bike+motor v6 未標記目標: ${totalEligible}；本次處理: ${rows.length}；模式: ${DRY_RUN ? 'dry-run' : FINALIZE ? 'finalize' : 'candidate'}`);
  if (!rows.length) throw new Error('沒有符合條件的 vehicle/bike 或 vehicle/motor v6 目標');
  const results = [];
  const counts = {};
  for (const row of rows) {
    try {
      const result = processTarget(row, indexes);
      results.push(result);
      counts[result.style] = (counts[result.style] || 0) + 1;
      console.log(`✓ ${row.stable} | ${result.style} | parts=${result.parts} | thin=${result.thinMembers}`);
    } catch (error) {
      results.push({ target: row.stable, status: 'failed', reason: error.message, eligible: false });
      console.error(`✗ ${row.stable}: ${error.message}`);
    }
  }
  if (FINALIZE) finalizeCatalog(results);
  writeReport(results);
  console.log(`完成: ${results.filter((result) => result.status !== 'failed').length}；失敗: ${results.filter((result) => result.status === 'failed').length}`);
  console.log(`樣式分布: ${Object.entries(counts).map(([style, count]) => `${style}=${count}`).join(', ')}`);
  if (FINALIZE) console.log('已收斂舊 v6 碎片並同步 catalog/manifest；review state 未寫入，全部維持 awaiting_human_review。');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
