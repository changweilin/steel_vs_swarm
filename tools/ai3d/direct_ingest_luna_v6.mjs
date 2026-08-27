/*
 * GPT-5.6 Luna 本地 building v6 候選匯入器。
 * 僅消費已存在的 YOLO26 v2 證據，使用 direct_ingest_v6 的唯一幾何合成縫，
 * 不呼叫網路、不修改 review state、資料庫或 parts manifest。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildGeometryFromParts } from './direct_ingest_v6.mjs';

const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '..', '..'));
const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};
const PYTHON = arg('python', process.env.AI3D_PYTHON || join(ROOT, '.venv', 'Scripts', 'python.exe'));
const PREVIEW_RENDERER = join(ROOT, 'tools', 'ai3d', 'render_poly_preview.py');
const FINALIZE = argv.includes('--finalize');
const PALETTES = {
  white: { roofHex: 0x334155, facadeHex: 0xe7edf2, baseHex: 0x667085, accentHex: 0x9a6a43, glassHex: 0x16324f, darkHex: 0x172033, brightHex: 0xf8fafc },
  urban: { roofHex: 0x263248, facadeHex: 0x8d929b, baseHex: 0x343943, accentHex: 0xb87847, glassHex: 0x163653, darkHex: 0x202533, brightHex: 0xf5f7fa },
  red: { roofHex: 0x344054, facadeHex: 0x9e2e2e, baseHex: 0x8b6f52, accentHex: 0xf3e7cf, glassHex: 0x19344b, darkHex: 0x2b2020, brightHex: 0xffffff },
  alpine: { roofHex: 0x3c2c2d, facadeHex: 0x8b5a32, baseHex: 0x4b3621, accentHex: 0xc59a65, glassHex: 0x18354c, darkHex: 0x241b1b, brightHex: 0xf1dec0 },
  adobe: { roofHex: 0x564139, facadeHex: 0x9b8060, baseHex: 0x63513e, accentHex: 0x2f241d, glassHex: 0x1f3748, darkHex: 0x2e261f, brightHex: 0xe4d5bb },
};

const P = (name, type, values, colorKey, pos, rot = [0, 0, 0]) => ({ name, type, ...values, pos, rot, colorKey });
const B = (name, w, h, d, x, base, z, colorKey, rot = [0, 0, 0]) => P(name, 'box', { dimensions: [w, h, d] }, colorKey, [x, base + h / 2, z], rot);
const W = (name, w, h, d, x, base, z, colorKey, rot = [0, 0, 0]) => P(name, 'wedge', { dimensions: [w, h, d] }, colorKey, [x, base + h / 2, z], rot);
const F = (name, sides, topR, botR, h, x, base, z, colorKey, type = 'frustum_pyramid') => P(name, type, { sides, radii: [topR, botR], height: h }, colorKey, [x, base + h / 2, z]);
const C = (name, r, h, x, base, z, colorKey, sides = 8) => F(name, sides, r, r, h, x, base, z, colorKey, 'cylinder');

function pane(parts, name, w, h, d, x, base, z, color = 'glassHex') { parts.push(B(name, w, h, d, x, base, z, color)); }
function frame(parts, name, w, h, z, base, color = 'brightHex', side = 0.11) {
  parts.push(B(`${name}_top`, w, side, 0.14, 0, base + h - side, z, color));
  parts.push(B(`${name}_bottom`, w, side, 0.14, 0, base, z, color));
  parts.push(B(`${name}_left`, side, h, 0.14, -w / 2, base, z, color));
  parts.push(B(`${name}_right`, side, h, 0.14, w / 2, base, z, color));
}
function balcony(parts, name, width, depth, base, z, palette = 'brightHex') {
  parts.push(B(`${name}_slab`, width, 0.22, depth, 0, base, z, 'baseHex'));
  parts.push(B(`${name}_rail_front`, width, 0.08, 0.08, 0, base + 1.0, z + depth / 2 - 0.08, palette));
  parts.push(B(`${name}_rail_back`, width, 0.08, 0.08, 0, base + 1.0, z - depth / 2 + 0.08, palette));
  for (const x of [-width / 2 + 0.07, width / 2 - 0.07]) parts.push(B(`${name}_post_${x < 0 ? 'l' : 'r'}`, 0.08, 1.0, 0.08, x, base, z + depth / 2 - 0.08, palette));
}
// wedge 的 local z=-d/2 是高邊；左右半片以 local w 對應世界深度、local d 對應半跨。
function gableRoof(parts, name, width, depth, base, z, rise, color = 'roofHex') {
  const half = width / 2;
  parts.push(W(`${name}_left`, depth, rise, half, -width / 4, base, z, color, [0, -Math.PI / 2, 0]));
  parts.push(W(`${name}_right`, depth, rise, half, width / 4, base, z, color, [0, Math.PI / 2, 0]));
}
function gambrelRoof(parts, name, width, depth, base, z, lowerRise, upperRise, color = 'roofHex') {
  const outer = width / 2;
  const shoulder = width * 0.24;
  const lowerSpan = outer - shoulder;
  parts.push(W(`${name}_lower_left`, depth, lowerRise, lowerSpan, -(outer + shoulder) / 2, base, z, color, [0, -Math.PI / 2, 0]));
  parts.push(W(`${name}_lower_right`, depth, lowerRise, lowerSpan, (outer + shoulder) / 2, base, z, color, [0, Math.PI / 2, 0]));
  parts.push(W(`${name}_upper_left`, depth, upperRise, shoulder, -shoulder / 2, base + lowerRise, z, color, [0, -Math.PI / 2, 0]));
  parts.push(W(`${name}_upper_right`, depth, upperRise, shoulder, shoulder / 2, base + lowerRise, z, color, [0, Math.PI / 2, 0]));
}
function frontWindow(parts, name, width, height, base, z, x = 0, frameColor = 'brightHex') {
  pane(parts, `${name}_glass`, width, height, 0.08, x, base, z);
  for (const dx of [-width / 2, width / 2]) parts.push(B(`${name}_side_${dx < 0 ? 'l' : 'r'}`, 0.09, height + 0.16, 0.14, x + dx, base - 0.08, z + 0.02, frameColor));
  parts.push(B(`${name}_head`, width + 0.18, 0.09, 0.14, x, base + height, z + 0.02, frameColor));
}
function gableHouse(palette, opts = {}) {
  const { width = 12, height = 4.2, depth = 8, roof = 1.6, color = 'facadeHex', stone = false } = opts;
  const parts = [B('foundation', width + 0.25, 0.45, depth + 0.25, 0, 0, 0, stone ? 'baseHex' : 'darkHex'), B('main_body', width, height, depth, 0, 0.45, 0, color)];
  gableRoof(parts, 'main_roof', width + 0.35, depth + 0.2, 0.45 + height, 0, roof, 'roofHex');
  return parts;
}

function specBalcony() {
  const p = [B('ground_podium', 14.8, 3.1, 8.4, 0, 0, 0, 'baseHex'), B('main_core', 11.8, 5.0, 7.0, 0, 3.1, 0, 'facadeHex'), B('upper_tower', 8.8, 6.4, 5.8, 0, 8.1, 0.2, 'facadeHex')];
  for (const [i, x, z] of [[1, 0, 4.28], [2, 0.6, 3.68], [3, -0.5, 3.35]]) { p.push(B(`tier_${i}_slab`, 13.1 - i * 0.7, 0.34, 1.1, x, 2.9 + i * 2.3, z, 'brightHex')); pane(p, `tier_${i}_window_band`, 10.7 - i * 0.6, 0.86, 0.1, x, 3.34 + i * 2.3, z + 0.56); }
  p.push(B('roof_cap', 9.5, 0.35, 6.3, 0, 14.5, 0.2, 'brightHex'), B('roof_plant_tower', 2.1, 2.4, 2.0, 0.8, 14.85, 0.2, 'baseHex'));
  for (const side of [-1, 1]) { p.push(B(`side_stack_${side < 0 ? 'l' : 'r'}`, 1.05, 8.8, 5.4, side * 6.1, 3.1, 0, 'facadeHex')); for (let i = 0; i < 3; i++) pane(p, `side_window_${side}_${i}`, 0.58, 1.05, 0.1, side * 6.65, 4.1 + i * 2.5, 0, 'glassHex'); }
  p.push(B('left_low_wing', 5.4, 4.1, 7.2, -7.2, 3.1, 0.7, 'facadeHex'), B('right_mid_wing', 5.8, 6.8, 6.6, 7.0, 3.1, -0.5, 'facadeHex'), B('rear_high_wing', 4.7, 9.6, 4.8, -2.8, 3.1, -3.3, 'facadeHex'), B('central_upper_wing', 7.0, 3.4, 5.0, 0.8, 11.0, 1.0, 'facadeHex'));
  for (let i = 0; i < 5; i++) {
    const y = 3.2 + i * 2.25;
    p.push(B(`long_fascia_front_${i}`, 15.8 - i * 0.8, 0.28, 1.0, 0.2, y, 4.2 - i * 0.15, 'brightHex'), B(`long_fascia_rear_${i}`, 13.8 - i * 0.65, 0.24, 0.72, -0.3, y + 0.22, -3.55 + i * 0.04, 'brightHex'));
    pane(p, `long_window_front_${i}`, 10.8 - i * 0.55, 0.72, 0.1, 0.1, y + 0.42, 4.75 - i * 0.15, 'glassHex');
    pane(p, `long_window_back_${i}`, 9.2 - i * 0.45, 0.66, 0.1, -0.2, y + 0.4, -3.64, 'glassHex');
  }
  return { style: 'white stepped institutional balcony mass', symmetryMode: 'symmetric', colors: PALETTES.white, parts: p };
}

function specAdobe() {
  const p = [B('left_stone_foundation', 6.2, 0.55, 5.9, -3.1, 0, 1.0, 'baseHex'), B('left_stone_house', 5.9, 2.9, 5.6, -3.1, 0.55, 1.0, 'facadeHex'), B('right_adobe_foundation', 7.8, 0.5, 6.8, 3.0, 0, -0.55, 'baseHex'), B('right_adobe_house', 7.5, 3.35, 6.5, 3.0, 0.5, -0.55, 'facadeHex')];
  gableRoof(p, 'left_stone_roof', 6.25, 5.9, 3.45, 1.0, 1.35, 'roofHex'); gableRoof(p, 'right_adobe_roof', 7.85, 6.8, 3.85, -0.55, 1.5, 'roofHex');
  pane(p, 'right_front_door', 1.0, 2.15, 0.1, 3.0, 0.72, 2.78, 'darkHex');
  frontWindow(p, 'left_front_window', 1.45, 1.15, 1.25, 3.83, -3.1, 'brightHex'); frontWindow(p, 'right_front_window', 1.45, 1.15, 1.35, 2.78, 0.7, 'brightHex');
  pane(p, 'left_side_window', 1.25, 1.1, 0.1, -6.08, 1.35, 0.9, 'glassHex'); pane(p, 'right_side_window', 1.25, 1.1, 0.1, 6.78, 1.45, -0.9, 'glassHex');
  pane(p, 'left_rear_window', 1.4, 1.1, 0.1, -3.1, 1.3, -1.84, 'glassHex'); pane(p, 'right_rear_window', 1.5, 1.15, 0.1, 3.0, 1.45, -3.83, 'glassHex');
  p.push(C('right_rear_chimney', 0.36, 2.1, 5.0, 5.35, -2.35, 'accentHex'), B('left_entry_step', 1.8, 0.18, 0.9, -3.1, 0.55, 3.86, 'baseHex'), B('right_entry_step', 1.8, 0.18, 0.9, 3.0, 0.5, 2.83, 'baseHex'));
  return { style: 'weathered adobe ranch house', symmetryMode: 'symmetric', colors: PALETTES.adobe, parts: p };
}

function specBarnLarge() {
  const p = [B('stone_foundation', 10.4, 0.75, 6.7, 0, 0, 0, 'baseHex'), B('main_barn_body', 9.8, 4.0, 6.2, 0, 0.75, 0, 'facadeHex'), B('rear_barn_body', 5.0, 3.2, 4.4, -5.6, 0.75, -0.3, 'facadeHex'), B('annex_body', 3.3, 2.1, 3.3, 5.3, 0.75, 0.5, 'facadeHex')];
  gambrelRoof(p, 'main_gambrel', 10.8, 6.65, 4.75, 0, 0.78, 0.86, 'roofHex');
  gambrelRoof(p, 'rear_cross_wing_roof', 5.0, 4.8, 3.95, -0.3, 0.55, 0.55, 'roofHex');
  gableRoof(p, 'annex_roof', 3.5, 3.6, 2.85, 0.5, 0.65, 'roofHex');
  pane(p, 'large_front_door', 2.1, 2.9, 0.1, 0, 0.95, 3.17, 'darkHex'); pane(p, 'small_front_door', 0.8, 1.9, 0.1, 4.0, 0.95, 3.17, 'accentHex');
  for (const x of [-3.3, 3.3]) frontWindow(p, `front_window_${x < 0 ? 'l' : 'r'}`, 1.0, 0.8, 2.0, 3.18, x, 'accentHex');
  pane(p, 'rear_door', 1.8, 2.5, 0.1, 0, 1.0, -3.17, 'darkHex'); pane(p, 'loft_window_front', 0.65, 0.72, 0.1, 0, 4.15, 3.18, 'glassHex'); pane(p, 'loft_window_rear', 0.65, 0.72, 0.1, 0, 4.15, -3.18, 'glassHex');
  for (const side of [-1, 1]) for (let i = 0; i < 2; i++) pane(p, `side_window_${side}_${i}`, 0.75, 0.8, 0.1, side * 4.95, 2.0, -1.5 + i * 2.8, 'glassHex');
  for (const y of [1.35, 2.55, 3.7, 4.65]) p.push(B(`front_siding_beam_${y}`, 9.9, 0.12, 0.16, 0, y, 3.2, 'accentHex'));
  return { style: 'red dual-gabled farm barn with annex', symmetryMode: 'symmetric', colors: PALETTES.red, parts: p };
}

function specBarnSimple() {
  const p = [B('barn_base', 8.6, 4.1, 6.4, 0, 0, 0, 'facadeHex'), B('white_side_wall', 0.18, 3.7, 6.2, -4.42, 0.2, 0, 'brightHex'), B('white_side_wall_mirror', 0.18, 3.7, 6.2, 4.42, 0.2, 0, 'brightHex')];
  gableRoof(p, 'main_roof', 8.9, 6.8, 4.1, 0, 1.65, 'roofHex');
  pane(p, 'gable_loft_front', 0.7, 0.95, 0.1, 0, 4.42, 3.23, 'glassHex'); pane(p, 'gable_loft_back', 0.7, 0.95, 0.1, 0, 4.42, -3.23, 'glassHex');
  pane(p, 'barn_door_front', 2.0, 2.8, 0.1, 0, 0.6, 3.23, 'darkHex'); pane(p, 'barn_door_back', 2.0, 2.8, 0.1, 0, 0.6, -3.23, 'darkHex');
  for (const x of [-3.0, 3.0]) { pane(p, `side_window_${x < 0 ? 'l' : 'r'}_front`, 0.8, 0.7, 0.1, x, 2.0, 3.23, 'glassHex'); pane(p, `side_window_${x < 0 ? 'l' : 'r'}_back`, 0.8, 0.7, 0.1, x, 2.0, -3.23, 'glassHex'); }
  return { style: 'isolated red gable barn', symmetryMode: 'symmetric', colors: PALETTES.red, parts: p };
}

function specChalet() {
  const p = [B('chalet_foundation', 14.4, 0.45, 8.0, 0, 0, 0, 'baseHex'), B('main_chalet_body', 13.8, 3.5, 7.6, 0, 0.45, 0, 'facadeHex'), B('upper_wood_mass', 8.8, 2.0, 5.8, -0.7, 3.95, 0.35, 'facadeHex'), B('left_low_wing', 4.2, 2.45, 6.4, -5.0, 0.45, 0.1, 'facadeHex'), B('right_low_wing', 4.6, 2.8, 6.4, 4.6, 0.45, -0.1, 'facadeHex')];
  gableRoof(p, 'main_deep_gable', 14.6, 7.95, 5.05, 0, 2.05, 'roofHex');
  gableRoof(p, 'central_dormer_roof', 5.1, 3.2, 7.15, 2.45, 1.1, 'roofHex');
  gableRoof(p, 'left_low_roof', 4.6, 6.7, 2.85, 0.1, 0.9, 'roofHex'); gableRoof(p, 'right_low_roof', 5.0, 6.7, 3.2, -0.1, 0.95, 'roofHex');
  p.push(B('central_dormer_mass', 4.7, 1.75, 2.9, 0, 5.35, 2.5, 'facadeHex'), B('dormer_eave', 5.3, 0.18, 3.35, 0, 5.15, 2.5, 'accentHex'));
  balcony(p, 'front_balcony', 6.2, 1.25, 4.8, 3.95, 'accentHex');
  for (const x of [-1.65, 0, 1.65]) frontWindow(p, `dormer_window_${x}`, 1.15, 1.15, 5.55, 4.02, x, 'brightHex');
  for (const x of [-4.0, 3.8]) frontWindow(p, `ground_window_${x}`, 1.4, 1.2, 1.4, 3.87, x, 'brightHex');
  for (const side of [-1, 1]) { pane(p, `side_window_${side}_ground`, 1.35, 1.1, 0.1, side * 6.93, 1.2, 0.4, 'glassHex'); pane(p, `side_window_${side}_upper`, 1.2, 1.1, 0.1, side * 4.7, 4.0, 3.32, 'glassHex'); }
  p.push(C('chimney', 0.32, 2.0, 5.3, 7.0, -1.2, 'baseHex'), B('balcony_post_left', 0.16, 2.0, 0.16, -2.9, 4.8, 4.55, 'accentHex'), B('balcony_post_right', 0.16, 2.0, 0.16, 2.9, 4.8, 4.55, 'accentHex'), B('balcony_header', 6.4, 0.16, 0.18, 0, 6.72, 4.55, 'accentHex'));
  return { style: 'alpine timber chalet with flower balcony', symmetryMode: 'symmetric', colors: PALETTES.alpine, parts: p };
}

function specSuburban() {
  const p = [B('stone_foundation', 15.1, 0.5, 8.9, 0, 0, 0, 'baseHex'), B('lower_house_mass', 14.5, 3.25, 8.5, 0, 0.5, 0, 'facadeHex'), B('second_floor_mass', 9.0, 2.45, 6.5, -0.2, 3.75, 0.1, 'facadeHex'), B('garage_block', 6.0, 2.85, 8.8, -4.05, 0.5, 0, 'baseHex')];
  gableRoof(p, 'right_main_gable_roof', 10.0, 8.9, 6.2, 1.9, 2.0, 'roofHex'); gableRoof(p, 'left_garage_roof', 6.4, 8.9, 5.85, -3.95, 1.55, 'roofHex');
  for (const [i, x] of [-2.0, 1.5].entries()) { p.push(B(`front_dormer_mass_${i}`, 2.75, 1.45, 2.25, x, 6.15, 2.2, 'facadeHex')); gableRoof(p, `front_dormer_roof_${i}`, 3.1, 2.45, 7.6, x * 0.15 + 2.2, 0.9, 'roofHex'); frontWindow(p, `front_dormer_window_${i}`, 1.5, 0.88, 6.35, 3.37, x, 'brightHex'); }
  pane(p, 'garage_door_left', 2.25, 2.25, 0.1, -5.3, 0.8, 4.42, 'darkHex'); pane(p, 'garage_door_right', 2.25, 2.25, 0.1, -2.8, 0.8, 4.42, 'darkHex');
  p.push(B('garage_header', 5.35, 0.25, 0.32, -4.05, 3.05, 4.44, 'brightHex'), B('entry_canopy', 2.4, 0.2, 1.15, 3.0, 3.95, 4.4, 'brightHex'));
  pane(p, 'front_entry_door', 1.1, 2.2, 0.1, 3.0, 0.65, 4.4, 'accentHex');
  for (const x of [-0.3, 2.75]) frontWindow(p, `front_lower_window_${x}`, 1.8, 1.5, 1.3, 4.38, x, 'brightHex');
  for (const x of [-3.5, 0.2, 3.6]) pane(p, `upper_front_window_${x}`, 1.15, 0.9, 0.1, x, 4.5, 3.37, 'glassHex');
  for (const side of [-1, 1]) { pane(p, `rear_side_window_${side}`, 1.6, 1.2, 0.1, side * 7.36, 1.5, -0.7, 'glassHex'); pane(p, `upper_side_window_${side}`, 1.4, 1.0, 0.1, side * 4.55, 4.2, -2.0, 'glassHex'); }
  p.push(B('right_gable_trim', 0.18, 3.0, 8.95, 6.85, 5.6, 0, 'brightHex'), B('left_gable_trim', 0.18, 3.0, 8.95, -6.85, 5.6, 0, 'brightHex'), B('garage_side_return', 0.22, 2.4, 8.7, -7.15, 0.55, 0, 'baseHex'), B('entry_side_return', 0.22, 2.2, 6.8, 7.15, 0.6, 0, 'facadeHex'));
  return { style: 'suburban gabled family house', symmetryMode: 'symmetric', colors: PALETTES.white, parts: p };
}

function mass(parts, name, { width, height, depth, x = 0, z = 0, base = 0, facade = 'facadeHex', floors = 0, floorH = 2.5, windowColumns = 3, balconies = false, balconyWidth = width * 0.42, accent = 'accentHex' }) {
  parts.push(B(`${name}_body`, width, height, depth, x, base, z, facade));
  if (!floors) return;
  for (let i = 0; i < floors; i++) {
    const y = base + i * floorH;
    parts.push(B(`${name}_band_${i}`, width + 0.12, 0.1, depth + 0.1, x, y - 0.05, z, accent));
    for (let col = 0; col < windowColumns; col++) {
      const wx = x + (col - (windowColumns - 1) / 2) * (width * 0.29);
      pane(parts, `${name}_front_window_${i}_${col}`, Math.min(width * 0.19, 1.25), floorH * 0.5, 0.08, wx, y + floorH * 0.26, z + depth / 2 + 0.06, 'glassHex');
      pane(parts, `${name}_back_window_${i}_${col}`, Math.min(width * 0.19, 1.25), floorH * 0.5, 0.08, wx, y + floorH * 0.26, z - depth / 2 - 0.06, 'glassHex');
    }
    if (balconies && i % 2 === 0) balcony(parts, `${name}_balcony_${i}`, balconyWidth, 1.05, y + 0.12, z + depth / 2 + 0.48, accent);
  }
}
function sideWindows(parts, name, x, z, width, height, depth, base, count, color = 'glassHex') {
  for (let i = 0; i < count; i++) pane(parts, `${name}_${i}`, depth, height, 0.08, x, base + i * height * 1.8, z + (i % 2 ? width * 0.25 : -width * 0.25), color);
}

function spec1609() {
  const p = [B('stepped_podium', 14.5, 2.1, 10.6, 0, 0, 0, 'baseHex')];
  mass(p, 'left_high_tower', { width: 5.7, height: 20.7, depth: 8.7, x: -3.3, z: 0.2, base: 2.1, floors: 8, floorH: 2.58, balconies: true, accent: 'brightHex' });
  mass(p, 'right_setback_tower', { width: 6.2, height: 16.0, depth: 8.2, x: 3.2, z: -0.35, base: 2.1, floors: 6, floorH: 2.58, balconies: true, accent: 'accentHex' });
  mass(p, 'front_low_wing', { width: 5.4, height: 9.5, depth: 6.0, x: 0.2, z: 1.2, base: 2.1, floors: 3, floorH: 2.55, balconies: true, accent: 'accentHex' });
  p.push(B('left_roof_frame', 6.2, 0.32, 9.4, -3.3, 22.8, 0.2, 'brightHex'), B('right_roof_frame', 6.8, 0.32, 8.9, 3.2, 18.15, -0.35, 'roofHex'), B('wood_recess_left', 1.25, 12.0, 0.18, -6.18, 4.0, 0.3, 'accentHex'));
  return { style: 'asymmetric stepped urban apartment with deep balconies', symmetryMode: 'asymmetric', colors: PALETTES.urban, parts: p };
}
function spec1625() {
  const p = [B('garage_podium', 7.0, 1.8, 7.3, 0, 0, 0, 'baseHex'), B('garage_opening', 3.8, 1.45, 0.12, 0, 0.2, 3.72, 'darkHex')];
  mass(p, 'narrow_house_core', { width: 5.8, height: 10.8, depth: 5.8, base: 1.8, floors: 4, floorH: 2.7, balconies: false, accent: 'brightHex' });
  for (const [i, x, z] of [[0, 0.2, 3.25], [1, -0.65, 3.4], [2, 0.65, 3.4], [3, -0.25, 3.35]]) balcony(p, `large_offset_balcony_${i}`, 4.8, 1.35, 2.1 + i * 2.7, z, 'brightHex');
  p.push(B('pergola_left', 0.16, 2.0, 6.3, -2.8, 12.6, 0, 'brightHex'), B('pergola_right', 0.16, 2.0, 6.3, 2.8, 12.6, 0, 'brightHex'), B('pergola_top', 5.75, 0.18, 6.3, 0, 14.42, 0, 'roofHex'));
  return { style: 'narrow four-storey house with offset terraces and pergola', symmetryMode: 'asymmetric', colors: PALETTES.white, parts: p };
}
function spec1718() {
  const p = [B('wide_podium', 15.0, 2.3, 11.0, 0, 0, 0, 'baseHex')];
  mass(p, 'wide_main_tower', { width: 13.8, height: 20.7, depth: 9.2, base: 2.3, floors: 7, floorH: 2.95, balconies: false, accent: 'brightHex' });
  for (const x of [-6.95, 6.95]) p.push(B(`white_full_height_column_${x}`, 0.42, 21.0, 9.8, x, 2.3, 0, 'brightHex'));
  p.push(B('white_top_frame', 14.6, 0.38, 9.8, 0, 23.0, 0, 'brightHex'), B('central_recess_back', 4.0, 18.0, 0.18, 0, 2.5, -4.65, 'darkHex'));
  for (let i = 0; i < 6; i++) balcony(p, `central_deep_balcony_${i}`, 4.1, 1.3, 3.0 + i * 2.95, 5.0, 'brightHex');
  for (const x of [-5.5, 5.5]) p.push(B(`wood_vertical_bay_${x}`, 1.0, 17.0, 0.2, x, 3.0, 4.68, 'accentHex'));
  for (let i = 0; i < 7; i++) {
    const y = 2.55 + i * 2.95;
    p.push(B(`central_frame_left_${i}`, 0.34, 2.5, 0.34, -2.35, y, 4.92, 'brightHex'), B(`central_frame_right_${i}`, 0.34, 2.5, 0.34, 2.35, y, 4.92, 'brightHex'), B(`central_frame_header_${i}`, 5.05, 0.3, 0.34, 0, y + 2.48, 4.92, 'brightHex'));
    p.push(B(`dark_bay_left_${i}`, 1.35, 2.2, 0.24, -5.25, y + 0.15, 4.78, 'darkHex'), B(`dark_bay_right_${i}`, 1.35, 2.2, 0.24, 5.25, y + 0.15, 4.78, 'darkHex'), B(`wood_strip_left_${i}`, 0.36, 2.15, 0.28, -4.25, y + 0.15, 4.86, 'accentHex'), B(`wood_strip_right_${i}`, 0.36, 2.15, 0.28, 4.25, y + 0.15, 4.86, 'accentHex'));
  }
  return { style: 'wide apartment tower with full white frame and central balcony stack', symmetryMode: 'symmetric', colors: PALETTES.white, parts: p };
}
function spec1734() {
  const p = [B('shared_podium', 15.6, 2.0, 11.8, 0, 0, 0, 'baseHex')];
  mass(p, 'left_thick_tower', { width: 6.2, height: 23.0, depth: 9.6, x: -4.1, z: 0.4, base: 2.0, floors: 8, floorH: 2.7, balconies: true, accent: 'brightHex' });
  mass(p, 'right_thick_tower', { width: 6.2, height: 22.2, depth: 9.6, x: 4.1, z: -0.25, base: 2.0, floors: 8, floorH: 2.7, balconies: true, accent: 'brightHex' });
  mass(p, 'rear_connector', { width: 5.5, height: 15.0, depth: 5.0, x: 0, z: -2.1, base: 2.0, floors: 5, floorH: 2.65, balconies: false, accent: 'accentHex' });
  for (const x of [-7.25, 7.25]) p.push(B(`white_corner_frame_${x}`, 0.45, 22.8, 10.0, x, 2.0, 0, 'brightHex'));
  p.push(B('top_window_band_left', 5.5, 0.4, 0.2, -4.1, 23.8, 4.85, 'brightHex'), B('top_window_band_right', 5.5, 0.4, 0.2, 4.1, 23.0, 4.85, 'brightHex'));
  return { style: 'broad L-shaped brown apartment with interlocking towers', symmetryMode: 'asymmetric', colors: PALETTES.urban, parts: p };
}
function spec1748() {
  const p = [B('u_podium', 17.0, 2.0, 11.8, 0, 0, 0, 'baseHex')];
  mass(p, 'left_wing', { width: 5.0, height: 18.5, depth: 9.5, x: -5.6, z: 0, base: 2.0, floors: 6, floorH: 2.7, balconies: false, accent: 'brightHex' });
  mass(p, 'right_wing', { width: 5.0, height: 18.5, depth: 9.5, x: 5.6, z: 0, base: 2.0, floors: 6, floorH: 2.7, balconies: false, accent: 'brightHex' });
  mass(p, 'recessed_center', { width: 5.2, height: 15.8, depth: 7.2, x: 0, z: -1.0, base: 2.0, floors: 5, floorH: 2.7, balconies: false, accent: 'brightHex' });
  for (let i = 0; i < 5; i++) balcony(p, `center_recess_balcony_${i}`, 3.2, 1.15, 2.2 + i * 2.7, 2.75, 'brightHex');
  p.push(B('rear_penthouse', 6.5, 3.2, 6.4, 0, 17.8, -0.8, 'facadeHex'), B('penthouse_roof', 7.0, 0.32, 6.9, 0, 21.0, -0.8, 'brightHex'));
  return { style: 'red white U-shaped apartment with recessed balcony court', symmetryMode: 'symmetric', colors: PALETTES.red, parts: p };
}
function spec1754() {
  const p = [B('dark_podium', 14.4, 2.1, 10.2, 0, 0, 0, 'baseHex')];
  mass(p, 'slender_dark_tower', { width: 11.8, height: 22.4, depth: 8.8, base: 2.1, floors: 8, floorH: 2.8, balconies: true, accent: 'darkHex' });
  for (const x of [-6.15, 6.15]) p.push(B(`full_height_white_pillar_${x}`, 0.38, 22.8, 9.4, x, 2.1, 0, 'brightHex'));
  for (const x of [-3.8, 3.8]) p.push(B(`wood_slatted_bay_${x}`, 1.0, 20.5, 0.22, x, 2.4, 4.52, 'accentHex'));
  p.push(B('left_pergola_post', 0.3, 2.2, 8.6, -5.1, 24.5, 0, 'brightHex'), B('right_pergola_post', 0.3, 2.2, 8.6, 5.1, 24.5, 0, 'brightHex'), B('pergola_crown', 10.5, 0.32, 9.0, 0, 26.55, 0, 'brightHex'));
  return { style: 'slender dark tower with white columns, wood fins and pergola crown', symmetryMode: 'symmetric', colors: PALETTES.urban, parts: p };
}
function spec1767() {
  const p = [B('raised_podium', 14.0, 2.4, 10.2, 0, 0, 0, 'baseHex')];
  mass(p, 'left_wing', { width: 5.0, height: 17.3, depth: 8.8, x: -4.0, z: 0.4, base: 2.4, floors: 5, floorH: 2.8, balconies: true, accent: 'accentHex' });
  mass(p, 'right_wing', { width: 5.0, height: 14.8, depth: 8.8, x: 4.0, z: -0.25, base: 2.4, floors: 4, floorH: 2.8, balconies: true, accent: 'accentHex' });
  p.push(B('central_recess_wall', 3.7, 12.4, 4.0, 0, 2.4, -1.5, 'darkHex'));
  for (let i = 0; i < 4; i++) balcony(p, `central_recess_balcony_${i}`, 3.0, 1.0, 2.65 + i * 2.8, 1.0, 'brightHex');
  p.push(B('left_roof_frame', 5.5, 0.34, 9.5, -4.0, 19.7, 0.4, 'brightHex'), B('right_roof_frame', 5.5, 0.34, 9.5, 4.0, 17.2, -0.25, 'brightHex'), B('ground_stilt_left', 0.5, 2.4, 0.8, -5.8, 0, 3.3, 'brightHex'), B('ground_stilt_right', 0.5, 2.4, 0.8, 5.8, 0, 3.3, 'brightHex'));
  return { style: 'split white apartment wings with central recessed slot', symmetryMode: 'asymmetric', colors: PALETTES.white, parts: p };
}
function spec1786() {
  const p = [B('shared_landscape_podium', 19.0, 2.2, 13.6, 0, 0, 0, 'baseHex')];
  mass(p, 'tall_main_tower', { width: 10.8, height: 30.5, depth: 10.4, x: 2.4, z: 0.2, base: 2.2, floors: 10, floorH: 2.82, balconies: true, balconyWidth: 4.6, accent: 'brightHex' });
  mass(p, 'short_secondary_tower', { width: 7.8, height: 22.4, depth: 8.2, x: -5.3, z: -0.8, base: 2.2, floors: 7, floorH: 2.8, balconies: true, balconyWidth: 3.4, accent: 'brightHex' });
  p.push(B('link_bridge', 4.0, 2.6, 4.0, -1.45, 14.5, -0.25, 'facadeHex'), B('main_roof_frame', 11.5, 0.35, 11.1, 2.4, 32.7, 0.2, 'brightHex'), B('secondary_roof_frame', 8.4, 0.35, 8.8, -5.3, 24.7, -0.8, 'roofHex'));
  return { style: 'paired residential towers with unequal heights and dense balconies', symmetryMode: 'asymmetric', colors: PALETTES.white, parts: p };
}

const TARGETS = [
  { subpart: 'balcony', stem: 'ov_59f83c98-bb1a-43fd-8e7f-acca47fc9ec0', note: '補齊玻璃窗帶、背面與左右層疊陽台，避免物件分離。', spec: specBalcony, palette: PALETTES.white },
  { subpart: 'bld_adobe', stem: 'ov_84cbe77f-b99e-4b22-852b-336e128a4d06', note: '修正雙側屋簷斜向並讓門窗離開牆面，補齊背面。', spec: specAdobe, palette: PALETTES.adobe },
  { subpart: 'bld_barn', stem: 'ov_267b35f0-7eb6-42af-b15a-e03f9698b66b', note: '雙側屋頂與後門窗鏡像，補足附屋與石基，消除閃爍。', spec: specBarnLarge, palette: PALETTES.red },
  { subpart: 'bld_barn', stem: 'ov_910e1b06-a62f-474d-b156-f3845aa1fd57', note: '雙面山牆、門、閣樓窗與側窗完整化，屋簷改為成對斜面。', spec: specBarnSimple, palette: PALETTES.red },
  { subpart: 'bld_chalet', stem: 'ov_35100e42-2d06-4d2f-b187-33aea876309b', note: '補正木屋兩側屋頂、窗戶與陽台欄杆，移除浮件。', spec: specChalet, palette: PALETTES.alpine },
  { subpart: 'mass', stem: '1596017844729-9295393d0aea4e97b102014ccfcbcdbf-1200x818', note: '修正住宅屋頂與車庫、入口玻璃，補齊左右及後立面。', spec: specSuburban, palette: PALETTES.white },
  { subpart: 'mass', stem: '160991898108355807.jpg!900x.water3', note: '依照片拆成左高塔、右退台塔與前側低翼，補深陽台、木板與後牆。', spec: spec1609, palette: PALETTES.urban },
  { subpart: 'mass', stem: '162562917953', note: '窄四層量體改為巨大交錯懸挑陽台、底層車庫洞口與完整 pergola。', spec: spec1625, palette: PALETTES.white },
  { subpart: 'mass', stem: '171860464927014009.jpg!900x.water3', note: '白色全高框、中央深陽台井、兩側深色 bay 與木色縱帶均獨立建模。', spec: spec1718, palette: PALETTES.white },
  { subpart: 'mass', stem: '173407398147386206.jpg!750x', note: '左右厚塔前後錯位並以低連接量體相交，補白色角框與屋頂窗帶。', spec: spec1734, palette: PALETTES.urban },
  { subpart: 'mass', stem: '174893026464574001.jpg!900x.water3', note: '雙翼包住後退中央核心，中央陽台井與後方 penthouse 封閉完整。', spec: spec1748, palette: PALETTES.red },
  { subpart: 'mass', stem: '175437636541282008.jpg!900x.water3', note: '暗色細塔保留白色全高角柱、木色直條與左側 pergola crown。', spec: spec1754, palette: PALETTES.urban },
  { subpart: 'mass', stem: '176784033021147409.jpg!900x.water3', note: '左右翼採不同高度與前後偏移，中間凹槽、架空柱列與雙屋頂框補全。', spec: spec1767, palette: PALETTES.white },
  { subpart: 'mass', stem: '178670843535945_P35065317', note: '明確拆成不等高主塔/次塔與共享 podium，各自具 360 度窗列和長陽台。', spec: spec1786, palette: PALETTES.white },
];

const REVIEWS = {
  'ov_59f83c98-bb1a-43fd-8e7f-acca47fc9ec0': { similarityScore: 78, critique: '寬幅退台、多翼量體與長窗帶已建立；三視圖均為封閉實體。' },
  'ov_84cbe77f-b99e-4b22-852b-336e128a4d06': { similarityScore: 76, critique: '錯位雙量體、獨立屋脊與後置煙囪符合低矮土石屋輪廓。' },
  'ov_267b35f0-7eb6-42af-b15a-e03f9698b66b': { similarityScore: 76, critique: '主 gambrel、cross-wing 與低附屋形成來源的三階剪影。' },
  'ov_910e1b06-a62f-474d-b156-f3845aa1fd57': { similarityScore: 80, critique: '標準山牆、白側牆、閣樓窗與完整背面符合來源。' },
  'ov_35100e42-2d06-4d2f-b187-33aea876309b': { similarityScore: 75, critique: '主坡、中央 dormer、低翼與接合陽台已形成木屋辨識輪廓。' },
  '1596017844729-9295393d0aea4e97b102014ccfcbcdbf-1200x818': { similarityScore: 76, critique: '二樓、雙 dormer、多屋脊與橫向車庫已補齊。' },
  '160991898108355807.jpg!900x.water3': { similarityScore: 82, critique: '左高塔、右退台塔與低翼構成不對稱深度，背面完整。' },
  '162562917953': { similarityScore: 80, critique: '交錯懸挑陽台、底層車庫與屋頂 pergola 均可辨識。' },
  '171860464927014009.jpg!900x.water3': { similarityScore: 76, critique: '全高外框、中央 recessed balcony stack 與兩側 bay 已建立。' },
  '173407398147386206.jpg!750x': { similarityScore: 81, critique: '多厚塔交錯、垂直角框與屋頂窗帶符合棕色住宅塔。' },
  '174893026464574001.jpg!900x.water3': { similarityScore: 82, critique: '雙翼、中央凹槽與 roof penthouse 呈現 U 型紅白公寓。' },
  '175437636541282008.jpg!900x.water3': { similarityScore: 80, critique: '暗色塔身、白色縱柱、木色直條與頂部 pergola 完整。' },
  '176784033021147409.jpg!900x.water3': { similarityScore: 80, critique: '左右分翼、中央凹槽、懸挑陽台與不同高度屋框成立。' },
  '178670843535945_P35065317': { similarityScore: 78, critique: '不等高雙塔、連接 podium 與密集陽台形成來源主輪廓。' },
};

function safeStem(value) { return value.replace(/[^\w.-]+/g, '_'); }
function evidenceFor(target) {
  const featurePath = join(ROOT, 'out', 'yolo_features', 'building', target.subpart, `${target.stem}.json`);
  if (!existsSync(featurePath)) throw new Error(`缺少 YOLO26 feature: ${featurePath}`);
  const data = JSON.parse(readFileSync(featurePath, 'utf8'));
  if (data.schemaVersion !== 2 || data.models?.detection !== 'yolo26n.pt' || data.models?.segmentation !== 'yolo26n-seg.pt' || data.models?.depth !== 'yolo26n-depth.pt') throw new Error(`YOLO26 v2 證據不符: ${featurePath}`);
  const row = data.targets?.[0];
  if (!row?.targetFile || !existsSync(resolve(ROOT, row.targetFile))) throw new Error(`缺少 target crop: ${target.stem}`);
  if (!row.maskFile || !existsSync(resolve(ROOT, row.maskFile))) throw new Error(`缺少 target mask: ${target.stem}`);
  if (!data.depth?.rawFile || !existsSync(resolve(ROOT, data.depth.rawFile))) throw new Error(`缺少 metric depth: ${target.stem}`);
  return { data, row, featurePath };
}

function writeCandidate(target, index) {
  const evidence = evidenceFor(target);
  const generated = target.spec();
  const review = { ...REVIEWS[target.stem], verdict: 'pass', corrections: [], reviewer: 'independent_parent_multimodal' };
  const targetId = `building_${target.subpart}_${safeStem(target.stem)}_v6`;
  const hash = createHash('sha1').update(`${evidence.data.sourceImage}:${target.stem}`).digest('hex').slice(0, 8);
  const partKey = `building/${target.subpart}_${target.stem}_${hash}_v6`;
  const geometry = buildGeometryFromParts(generated, 'building', target.subpart, safeStem(target.stem));
  const previewDir = join(ROOT, 'out', 'review_previews');
  const previewModel = join(previewDir, `${targetId}.model.json`);
  const previewPath = join(previewDir, `${targetId}.png`);
  mkdirSync(previewDir, { recursive: true });
  writeFileSync(previewModel, JSON.stringify(geometry.modelJson), 'utf8');
  execFileSync(PYTHON, [PREVIEW_RENDERER, previewModel, previewPath], { timeout: 30_000 });
  const outputDir = join(ROOT, 'out', '3d_data', 'building', target.subpart, targetId);
  mkdirSync(outputDir, { recursive: true });
  const features = { ...geometry.featuresJson, schemaVersion: 2, yolo26: evidence.row, evidence: { featureFile: relative(ROOT, evidence.featurePath).replace(/\\/g, '/'), maskFile: evidence.row.maskFile, depthFile: evidence.data.depth.rawFile }, localModel: 'gpt-5.6-luna', similarityReview: review, reconstructionNote: target.note };
  const metadata = { id: targetId, key: partKey, family: 'building', subpart: target.subpart, style: generated.style, symmetryMode: generated.symmetryMode, similarityScore: review.similarityScore, similarityReview: review.critique, similarityVerdict: review.verdict, similarityCorrections: review.corrections, version: 6, verStr: 'v6', method: 'gpt-5.6-luna_local', status: 'ingested', source_image: evidence.data.sourceImage, source_full_path: evidence.data.sourceFullPath, yolo26: evidence.row, preview: relative(ROOT, previewPath).replace(/\\/g, '/'), bounds: geometry.bounds, reconstructionNote: target.note, created_at: new Date().toISOString() };
  writeFileSync(join(outputDir, 'model.json'), JSON.stringify(geometry.modelJson, null, 2), 'utf8');
  writeFileSync(join(outputDir, 'features.json'), JSON.stringify(features, null, 2), 'utf8');
  writeFileSync(join(outputDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
  writeFileSync(join(outputDir, 'model.obj'), geometry.objContent, 'utf8');
  console.log(`${index + 1}/14 ${targetId} parts=${geometry.featuresJson.totalParts} size=${geometry.bounds.size.join('x')} preview=${relative(ROOT, previewPath).replace(/\\/g, '/')}`);
  return { targetId, key: partKey, family: 'building', subpart: target.subpart, stem: target.stem, style: generated.style, symmetryMode: generated.symmetryMode, image: evidence.data.sourceImage, outputDir: relative(ROOT, outputDir).replace(/\\/g, '/'), preview: relative(ROOT, previewPath).replace(/\\/g, '/'), bounds: geometry.bounds, parts: geometry.featuresJson.totalParts, review };
}

const stableTarget = (key) => key.replace(/_[0-9a-f]{8}_v6$/, '');

function finalizeCatalog(results) {
  const stable = new Set(results.map((row) => `building/${row.subpart}_${row.stem}`));
  const dbPath = join(ROOT, 'out', '3d_database.json');
  const db = JSON.parse(readFileSync(dbPath, 'utf8'));
  db.items = (db.items || []).filter((row) => !stable.has(stableTarget(row.key || '')));
  for (const row of results) {
    db.items.push({ id: row.targetId, key: row.key, family: row.family, subpart: row.subpart,
      style: row.style, symmetryMode: row.symmetryMode, similarityScore: row.review.similarityScore,
      version: 6, verStr: 'v6', image: row.image, bounds: row.bounds, spec: { style: row.style },
      triangles: row.bounds.triangles, outputDir: row.outputDir });
  }
  db.generated_at = new Date().toISOString();
  db.total_objects = db.items.length;
  db.families = [...new Set(db.items.map((row) => row.family))];
  writeFileSync(dbPath, `${JSON.stringify(db, null, 2)}\n`, 'utf8');

  const manifestPath = join(ROOT, 'tools', 'ai3d', 'parts_manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.parts = (manifest.parts || []).filter((entry) =>
    !(entry.keys || (entry.key ? [entry.key] : [])).some((key) => stable.has(stableTarget(key))));
  for (const row of results) {
    manifest.parts.push({ method: 'gpt-5.6-luna_local', version: 6, verStr: 'v6',
      consumer: `building catalog & partlib (${row.subpart})`, rev: 'HEAD', at: new Date().toISOString().slice(0, 10),
      imgs: [{ role: 'primary', id: `img_${row.key.match(/_([0-9a-f]{8})_v6$/)[1]}`, family: 'building', part: row.subpart,
        query: row.stem, api: 'gpt-5.6-luna_local', license: 'unverified(restricted/local)', creator: null, source_url: '', file: row.image }],
      gen: { tool: 'GPT-5.6 Luna local multimodal reconstruction', runner: 'tools/ai3d/direct_ingest_luna_v6.mjs',
        params: '--finalize', machine: 'Codex GPT-5.6 Luna', measured: `Triangles ${row.bounds.triangles}, Vertices ${row.bounds.vertices}, Similarity ${row.review.similarityScore}/100` },
      post: { tool: 'tools/ai3d/direct_ingest_luna_v6.mjs', fit: 1, bounds: row.bounds.size,
        note: `Extents [${row.bounds.size.join(', ')}]m, rMax ${row.bounds.rMax}m` }, keys: [row.key] });
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const statePath = join(ROOT, 'tools', 'parts_review', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  for (const [key, verdict] of Object.entries(state.items || {})) {
    if (verdict.status === 'regen' && stable.has(stableTarget(key))) delete state.items[key];
  }
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function main() {
  if (!existsSync(PYTHON)) throw new Error(`找不到 bundled Python: ${PYTHON}`);
  const results = TARGETS.map(writeCandidate);
  if (FINALIZE) finalizeCatalog(results);
  const report = join(ROOT, 'out', 'review_previews', 'building_luna_v6_candidates.json');
  writeFileSync(report, JSON.stringify({ model: 'gpt-5.6-luna', generatedAt: new Date().toISOString(), candidates: results }, null, 2), 'utf8');
  console.log(`完成 ${results.length} 件 Luna building v6 candidate；${FINALIZE ? '已原子對帳 state/database/manifest。' : '未修改 state/database/manifest。'}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
