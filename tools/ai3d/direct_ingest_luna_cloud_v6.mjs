#!/usr/bin/env node
/**
 * GPT-5.6 Luna 純雲 v6 視覺直讀候選重建器。
 *
 * 本檔只產生指定的五件 cloud 候選，幾何統一交給 direct_ingest_v6 的
 * buildGeometryFromParts；不寫入 3d_database、parts_manifest 或 review state。
 * 雲是純視覺浮空資產，所有外輪廓由多面體 lobes/ridges/fibres 組成，
 * ellipsoid 只作為被外層多面體包覆的嵌入核心。
 */

import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { buildGeometryFromParts } from './direct_ingest_v6.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const PREVIEW_RENDERER = join(HERE, 'render_poly_preview.py');
const PYTHON = process.argv.includes('--python')
  ? process.argv[process.argv.indexOf('--python') + 1]
  : 'C:\\Users\\user\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe';
const PREVIEW_ROOT = join(ROOT, 'out', 'review_previews');
const OUTPUT_ROOT = join(ROOT, 'out', '3d_data', 'cloud');
const CANDIDATE_REPORT = join(PREVIEW_ROOT, 'cloud_luna_v6_candidates.json');
const IMAGE_ROOT = join(ROOT, 'tools', 'ai3d', 'photos');
const VERSION = 6;
const MODEL = 'gpt-5.6-luna';
const METHOD = 'gpt-5.6-luna_visual_direct';
const GENERATION_TAG = 'luna 直接 v6';
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = Number(process.argv.includes('--limit')
  ? process.argv[process.argv.indexOf('--limit') + 1]
  : Infinity);
const ONLY = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1]
  : null;

const ALLOWED_TYPES = new Set([
  'dodecahedron_polyhedron', 'icosahedron_polyhedron', 'wedge',
  'frustum_pyramid', 'hemisphere_dome', 'ellipsoid_sphere',
]);
const COLOR_KEYS = new Set(['roofHex', 'facadeHex', 'baseHex', 'accentHex', 'glassHex', 'darkHex', 'brightHex']);

const TARGETS = [
  {
    profile: 'cumulus',
    subpart: 'cumulus',
    stem: 'gfp_one_puffy_cloud',
    image: 'cloud/cumulus/gfp_one_puffy_cloud.jpg',
    style: 'flat-bottom cauliflower cumulus cloud',
    silhouette: '扁底與花椰菜狀上緣，單一藍天中的蓬鬆雲團',
    palette: {
      roofHex: 0xaebfd5, facadeHex: 0xd3deec, baseHex: 0x91a3ba,
      accentHex: 0xe7eef8, glassHex: 0xf6faff, darkHex: 0x748aa6, brightHex: 0xffffff,
    },
    score: 88,
    critique: 'soft pass 三視圖以交疊小瓣包覆原有大瓣邊界，扁底仍完整但尖角密度下降，整體改讀成輕盈棉花糖狀花椰菜輪廓。',
    corrections: ['中央裂溝維持局部且不跨全寬', '外輪廓以次級 cotton fringe 打散大面體尖角，不引入單一平滑球殼'],
  },
  {
    profile: 'mammatus',
    subpart: 'mammatus',
    stem: 'mammatus_clouds1',
    image: 'cloud/mammatus/mammatus_clouds1.jpg',
    style: 'continuous layered mammatus cloud with hanging pouches',
    silhouette: '連續灰暗上層與多排下垂囊袋，囊袋大小與深度有節奏差',
    palette: {
      roofHex: 0x969ba4, facadeHex: 0xbfc1c3, baseHex: 0x747b87,
      accentHex: 0xd7d5cf, glassHex: 0xf0ebe2, darkHex: 0x525b69, brightHex: 0xfff8ed,
    },
    score: 89,
    critique: 'soft pass 以較小交疊瓣柔化棚層與囊袋邊角；所有乳狀囊仍連接主棚，輪廓更蓬鬆且不再像沉重岩塊。',
    corrections: ['每個囊袋頸部持續埋入上層，避免細柱與浮空側瓣', '暗灰與乳白 facet 只在囊袋底/上層裂縫分區，保留照片的厚重層次'],
  },
  {
    profile: 'cirrus',
    subpart: 'cirrus',
    stem: 'cirrus_clouds',
    image: 'cloud/cirrus/cirrus_clouds.jpg',
    style: 'feathered cirrus cloud with branching filaments',
    silhouette: '長羽毛主脊、向兩側分叉的細絲與分散尖端',
    palette: {
      roofHex: 0x789bd0, facadeHex: 0xb9d1ef, baseHex: 0x4e72ad,
      accentHex: 0xdcecff, glassHex: 0xf1f9ff, darkHex: 0x4669a2, brightHex: 0xffffff,
    },
    score: 89,
    critique: 'soft pass 已把細長 wedge 刀片全面拆成密接微型 dodeca/icosa 雲絲鏈；主脊與支絲維持後掠分枝，但尖端改為細軟羽絮而非銳利薄片。',
    corrections: ['雲絲鏈節徑維持 0.08–0.15m，禁止重新出現長楔片', '分叉採不規則曲率、節距與淡色階，端視圖保持細軟雲束'],
  },
  {
    profile: 'altocumulus',
    subpart: 'altocumulus',
    stem: 'altocumulus_006',
    image: 'cloud/altocumulus/altocumulus_006.jpg',
    style: 'perspective-dense altocumulus wavelet field',
    silhouette: '前中後錯列的成排小雲片與低起伏波紋，後排密度更高更薄',
    palette: {
      roofHex: 0xacb4c0, facadeHex: 0xd2d7df, baseHex: 0x929ba9,
      accentHex: 0xe7e0dc, glassHex: 0xf5f1f4, darkHex: 0x778291, brightHex: 0xfff8f1,
    },
    score: 88,
    critique: 'soft pass 將 wavelet 接縫改成小瓣鏈並加入次級蓬鬆外緣；五排仍前大後小、保留透視縫，但個別雲片更像棉絮而非卵石。',
    corrections: ['相鄰 row 使用非對齊 x 座標與 z 漂移，保留照片的透視密度', '每個 wavelet 保持短 wedge 局部接縫，避免整排重新融合成薄盤'],
  },
  {
    profile: 'congestus',
    subpart: 'congestus',
    stem: 'dark_clouds',
    image: 'cloud/congestus/dark_clouds.jpg',
    style: 'towering congestus cloud with dark core and bright rim',
    silhouette: '高聳塔狀厚雲，右側暗芯、左側亮邊與不規則隆起',
    palette: {
      roofHex: 0x5e7088, facadeHex: 0x93a3b6, baseHex: 0x465160,
      accentHex: 0xc7d2da, glassHex: 0xe3eef6, darkHex: 0x2c3542, brightHex: 0xf8fbfd,
    },
    score: 91,
    critique: 'soft pass 以次級小瓣柔化高塔外緣並降低暗面對比；塔狀厚度與左側亮邊仍保留，外觀更輕盈蓬鬆。',
    corrections: ['各 tier 以不同半徑與水平偏移維持塔狀收窄，不讓單一 lobe 佔主體', '亮邊只能沿左側/前緣，右內層保持多瓣暗芯而不恢復大 core'],
  },
];

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temp, path);
}
function writeTextAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, value, 'utf8');
  renameSync(temp, path);
}
function relativePath(path) { return relative(ROOT, path).replace(/\\/g, '/'); }
function hash8(value) { return createHash('sha1').update(String(value)).digest('hex').slice(0, 8); }
function P(name, type, values, colorKey, pos, rot = [0, 0, 0], role = 'cloud_lobe') {
  return { name, type, ...values, pos, rot, colorKey, role };
}
function dode(name, radius, pos, colorKey, rot = [0, 0, 0], role = 'cloud_lobe') {
  return P(name, 'dodecahedron_polyhedron', { radius }, colorKey, pos, rot, role);
}
function ico(name, radius, pos, colorKey, rot = [0, 0, 0], role = 'cloud_lobe') {
  return P(name, 'icosahedron_polyhedron', { radius }, colorKey, pos, rot, role);
}
function ellipsoid(name, radii, pos, colorKey, rot = [0, 0, 0], role = 'embedded_core') {
  return P(name, 'ellipsoid_sphere', { radii }, colorKey, pos, rot, role);
}
function dome(name, radii, pos, colorKey, rot = [0, 0, 0], role = 'cloud_lobe') {
  return P(name, 'hemisphere_dome', { radii }, colorKey, pos, rot, role);
}
function frustum(name, sides, topR, botR, height, x, baseY, z, colorKey, role = 'cloud_lobe') {
  return P(name, 'frustum_pyramid', { sides, radii: [topR, botR], height },
    colorKey, [x, baseY + height / 2, z], [0, 0, 0], role);
}
function wedge(name, dimensions, pos, colorKey, rot = [0, 0, 0], role = 'cloud_ridge') {
  return P(name, 'wedge', { dimensions }, colorKey, pos, rot, role);
}

function softenWedge(part, profile) {
  const [length, thickness, depth] = part.dimensions;
  const cirrus = profile === 'cirrus';
  const count = cirrus ? Math.max(5, Math.ceil(length / 0.22)) : Math.max(3, Math.ceil(length / 0.38));
  const radius = cirrus
    ? Math.max(0.075, Math.min(0.145, thickness * 0.70 + depth * 0.22))
    : Math.max(0.14, Math.min(0.28, thickness * 0.55 + depth * 0.16));
  const [, yaw = 0, roll = 0] = part.rot || [0, 0, 0];
  const dx = Math.cos(roll) * Math.cos(yaw);
  const dy = Math.sin(roll);
  const dz = -Math.cos(roll) * Math.sin(yaw);
  const span = length * 0.84;
  return Array.from({ length: count }, (_, index) => {
    const t = count === 1 ? 0 : index / (count - 1) - 0.5;
    const taper = 1 - Math.abs(t) * (cirrus ? 0.48 : 0.24);
    const jitter = ((index % 3) - 1) * radius * 0.12;
    const pos = [
      part.pos[0] + dx * span * t,
      part.pos[1] + dy * span * t + jitter,
      part.pos[2] + dz * span * t - jitter * 0.45,
    ];
    const name = `${part.name}_soft_${index}`;
    const r = radius * taper * (index % 2 ? 0.94 : 1.06);
    return index % 2
      ? ico(name, r, pos, part.colorKey, [0.08, yaw + index * 0.31, roll * 0.35], part.role)
      : dode(name, r, pos, part.colorKey, [0.06, yaw + index * 0.27, roll * 0.35], part.role);
  });
}

function softenCloudParts(parts, profile) {
  const softened = parts.flatMap((part) => part.type === 'wedge' ? softenWedge(part, profile) : [part]);
  if (profile === 'cirrus') return softened;
  const fringe = [];
  let index = 0;
  for (const part of softened) {
    if (!['dodecahedron_polyhedron', 'icosahedron_polyhedron'].includes(part.type) || part.radius < 0.45 || index % 2) {
      index += 1;
      continue;
    }
    const outwardX = Math.sign(part.pos[0] || (index % 2 ? -1 : 1));
    const r = part.radius * (0.30 + (index % 3) * 0.035);
    const pos = [
      part.pos[0] + outwardX * part.radius * 0.54,
      part.pos[1] + part.radius * (0.34 + (index % 2) * 0.08),
      part.pos[2] + ((index % 3) - 1) * part.radius * 0.26,
    ];
    fringe.push(index % 4
      ? dode(`${part.name}_cotton_fringe`, r, pos, 'glassHex', [0.08, index * 0.29, 0.04], 'cotton_fringe')
      : ico(`${part.name}_cotton_fringe`, r, pos, 'accentHex', [0.10, index * 0.23, -0.04], 'cotton_fringe'));
    index += 1;
  }
  return [...softened, ...fringe];
}

function makeCumulus(p, c) {
  // Core is deliberately tiny; the visible mass is entirely made from interlocking facets.
  p.push(ellipsoid('cumulus_embedded_core', [1.15, 0.18, 0.52], [0, 1.42, 0], 'facadeHex'));
  const underside = [
    [-3.50, 0.68, -0.34, 0.54], [-2.50, 0.70, 0.22, 0.58], [-1.48, 0.67, -0.28, 0.57],
    [-0.48, 0.68, 0.18, 0.61], [0.55, 0.67, -0.24, 0.60], [1.56, 0.70, 0.25, 0.57],
    [2.55, 0.68, -0.20, 0.56], [3.50, 0.71, 0.28, 0.50],
  ];
  underside.forEach(([x, y, z, r], i) => p.push(i % 2
    ? ico(`cumulus_flat_underside_icosa_${i}`, r, [x, y, z], i % 3 ? 'baseHex' : 'darkHex', [0.10, i * 0.28, -0.04], 'flat_underside')
    : dode(`cumulus_flat_underside_dode_${i}`, r, [x, y, z], i % 3 ? 'darkHex' : 'baseHex', [0.08, i * 0.32, 0.05], 'flat_underside')));
  [-3.0, -1.5, 0, 1.5, 3.0].forEach((x, i) => p.push(wedge(`cumulus_underside_join_${i}`, [1.36, 0.32, 0.76],
    [x, 0.78, i % 2 ? 0.26 : -0.22], i % 2 ? 'baseHex' : 'darkHex', [0.04, i * 0.09, 0], 'flat_underside')));
  const lobes = [
    [-3.52, 1.02, 0.12, 0.60], [-2.95, 1.38, -0.04, 0.72], [-2.30, 1.84, 0.18, 0.78],
    [-1.58, 2.13, -0.08, 0.86], [-0.74, 2.42, 0.10, 0.90], [0.10, 2.50, -0.04, 0.94],
    [0.98, 2.36, 0.13, 0.88], [1.82, 2.08, -0.12, 0.84], [2.55, 1.72, 0.10, 0.76],
    [3.22, 1.34, -0.06, 0.66], [-3.72, 1.15, -0.72, 0.48], [-2.65, 1.52, -0.66, 0.58],
    [-1.45, 1.72, -0.62, 0.64], [-0.12, 1.88, -0.66, 0.68], [1.20, 1.76, -0.60, 0.63],
    [2.46, 1.54, -0.68, 0.58], [3.58, 1.20, -0.62, 0.48],
    [-2.78, 1.38, 0.72, 0.55], [-1.30, 1.78, 0.74, 0.62], [0.28, 1.92, 0.76, 0.66],
    [1.86, 1.73, 0.72, 0.61], [3.18, 1.37, 0.68, 0.52],
  ];
  lobes.forEach(([x, y, z, r], i) => p.push(i % 2
    ? ico(`cumulus_cauli_lobe_icosa_${i}`, r, [x, y, z], i % 4 === 0 ? 'brightHex' : 'facadeHex', [0.12, i * 0.23, -0.06], 'cauliflower_lobe')
    : dode(`cumulus_cauli_lobe_dode_${i}`, r, [x, y, z], i % 5 === 0 ? 'accentHex' : 'brightHex', [0.08, i * 0.29, 0.04], 'cauliflower_lobe')));
  [-2.55, -1.25, 0.05, 1.34, 2.58].forEach((x, i) => p.push(wedge(`cumulus_cauliflower_ridge_${i}`, [1.25, 0.30, 0.70],
    [x, 2.16 + (i % 2) * 0.12, 0.30 - (i % 3) * 0.20], i % 2 ? 'brightHex' : 'roofHex',
    [0.12, (i - 2) * 0.10, (i % 2 ? -1 : 1) * 0.06], 'cauliflower_ridge')));
  p.push(ico('cumulus_left_edge_lobe', 0.50, [-3.82, 0.92, 0.22], 'baseHex', [0.18, -0.26, 0.05], 'cauliflower_lobe'));
  p.push(dode('cumulus_right_edge_lobe', 0.48, [3.80, 0.98, 0.18], 'facadeHex', [-0.08, 0.22, -0.04], 'cauliflower_lobe'));
  // 只留局部的微短水平裂溝，不讓暗面跨越整個雲寬而讀成盤面。
  p.push(wedge('cumulus_center_shadow_fissure', [0.92, 0.12, 0.20], [0.04, 1.30, 1.00],
    'darkHex', [0.02, 0.04, -0.02], 'shadow_fissure'));
  return p;
}

function makeMammatus(p, c) {
  // Keep the core behind the upper facets; no visible circular roof/plate is allowed.
  p.push(ellipsoid('mammatus_embedded_core', [2.20, 0.22, 0.92], [0, 2.18, 0], 'facadeHex'));
  const shell = [
    [-4.55, 1.74, -0.30, 0.72], [-3.70, 2.02, 0.08, 0.80], [-2.62, 2.18, -0.06, 0.86],
    [-1.46, 2.30, 0.15, 0.90], [-0.25, 2.36, -0.02, 0.94], [0.96, 2.30, 0.12, 0.91],
    [2.12, 2.20, -0.08, 0.86], [3.26, 2.02, 0.10, 0.80], [4.28, 1.80, -0.22, 0.70],
    [-3.55, 2.47, -0.52, 0.58], [-1.62, 2.62, -0.46, 0.66], [0.48, 2.66, -0.42, 0.70],
    [2.52, 2.50, -0.48, 0.62],
  ];
  shell.forEach(([x, y, z, r], i) => p.push(i % 2
    ? ico(`mammatus_continuous_upper_icosa_${i}`, r, [x, y, z], i % 4 ? 'facadeHex' : 'accentHex', [0.12, i * 0.23, 0.04], 'continuous_upper')
    : dode(`mammatus_continuous_upper_dode_${i}`, r, [x, y, z], i % 5 ? 'roofHex' : 'brightHex', [0.08, i * 0.31, -0.06], 'continuous_upper')));
  const crowns = [
    [-4.4, 2.68, -0.35, 0.70], [-3.15, 3.00, 0.16, 0.78], [-1.72, 3.16, -0.04, 0.84],
    [-0.34, 3.22, 0.20, 0.86], [1.12, 3.12, -0.02, 0.82], [2.45, 2.96, 0.18, 0.76],
    [3.78, 2.72, -0.22, 0.68], [4.58, 2.43, 0.38, 0.55],
  ];
  crowns.forEach(([x, y, z, r], i) => p.push(i % 2
    ? ico(`mammatus_upper_crown_${i}`, r, [x, y, z], i % 3 ? 'facadeHex' : 'accentHex', [0.15, i * 0.23, 0.04])
    : dode(`mammatus_upper_crown_${i}`, r, [x, y, z], i % 3 ? 'roofHex' : 'brightHex', [0.08, i * 0.32, -0.06])));
  const pouchRows = [
    { z: 0.82, xs: [-4.18, -3.12, -2.06, -1.00, 0.06, 1.12, 2.18, 3.24, 4.26] },
    { z: -0.42, xs: [-3.70, -2.50, -1.30, -0.10, 1.10, 2.30, 3.50] },
  ];
  let pouchIndex = 0;
  for (const row of pouchRows) {
    for (const x of row.xs) {
      const deep = pouchIndex % 4 === 0 ? 0.15 : pouchIndex % 3 === 0 ? -0.05 : 0;
      const neckR = pouchIndex % 3 === 0 ? 0.46 : 0.40;
      const bodyR = pouchIndex % 4 === 0 ? 0.58 : 0.50;
      const neckY = 1.35 + (pouchIndex % 2) * 0.06;
      const bodyY = 0.90 + (pouchIndex % 3) * 0.03;
      const bottomY = 0.45 + (pouchIndex % 2) * 0.04;
      // Each bag is a broad neck + body + blunt lower facet, never a skinny frustum stem.
      p.push(dode(`mammatus_pouch_wide_neck_${pouchIndex}`, neckR, [x, neckY, row.z + deep],
        pouchIndex % 4 === 0 ? 'facadeHex' : 'baseHex', [0.08, pouchIndex * 0.27, 0.04], 'hanging_pouch'));
      p.push(ico(`mammatus_pouch_round_body_${pouchIndex}`, bodyR, [x, bodyY, row.z + deep + 0.03],
        pouchIndex % 3 === 0 ? 'darkHex' : 'baseHex', [0.12, pouchIndex * 0.23, -0.06], 'hanging_pouch'));
      p.push(dode(`mammatus_pouch_blunt_bottom_${pouchIndex}`, bodyR * 0.70,
        [x, bottomY, row.z + deep + 0.04], pouchIndex % 4 === 0 ? 'darkHex' : 'baseHex',
        [0.16, pouchIndex * 0.31, -0.04], 'hanging_pouch'));
      pouchIndex += 1;
    }
  }
  [-3.3, -1.1, 1.1, 3.3].forEach((x, i) => p.push(wedge(`mammatus_lower_connector_${i}`, [1.55, 0.22, 0.56],
    [x, 1.52, 0.34 - (i % 2) * 0.65], i % 2 ? 'accentHex' : 'glassHex', [0.06, i * 0.11, 0.02], 'continuous_connector')));
  return p;
}

function fiber(name, length, thickness, depth, x, y, z, yaw, colorKey, role = 'cloud_fibre', roll = 0) {
  return wedge(name, [length, thickness, depth], [x, y, z], colorKey, [0, yaw, roll], role);
}

function makeCirrus(p, c) {
  // A paper-thin inner guide keeps the feather continuous without making a chunky core.
  p.push(ellipsoid('cirrus_embedded_core', [3.80, 0.06, 0.22], [0, 1.28, 0], 'facadeHex'));
  const spine = [
    [-4.30, 1.28, 0.18, 0.16, 1.52, 0.03], [-3.12, 1.34, 0.10, 0.13, 1.24, -0.04],
    [-1.94, 1.39, -0.04, 0.08, 1.60, 0.05], [-0.76, 1.31, -0.02, 0.04, 1.36, -0.06],
    [0.42, 1.37, 0.08, 0.10, 1.50, 0.04], [1.60, 1.45, 0.16, 0.14, 1.20, -0.05],
    [2.78, 1.37, 0.10, 0.12, 1.56, 0.06], [3.92, 1.30, -0.02, 0.08, 1.06, -0.03],
  ];
  spine.forEach(([x, y, z, yaw, length, roll], i) => p.push(fiber(`cirrus_main_spine_${i}`, length, 0.15, 0.30,
    x, y, z, yaw, i % 3 === 0 ? 'glassHex' : 'facadeHex', 'main_spine', roll)));
  [1, 3, 5, 7].forEach((i) => {
    const [x, y, z] = spine[i];
    p.push(dode(`cirrus_thin_spine_joint_${i}`, 0.09, [x, y, z], 'accentHex', [0.04, i * 0.19, 0], 'spine_joint'));
  });
  const branches = [
    [-3.72, 1.38, 0.20, 0.35, 1.52, 0.05], [-3.18, 1.43, 0.04, 0.52, 1.02, -0.04],
    [-2.42, 1.37, -0.12, 0.28, 1.78, 0.07], [-1.74, 1.30, 0.03, 0.57, 1.16, -0.06],
    [-0.96, 1.32, 0.16, 0.32, 1.62, 0.04], [-0.42, 1.35, -0.04, 0.50, 1.00, -0.05],
    [0.32, 1.36, 0.13, 0.25, 1.54, 0.06], [0.88, 1.43, -0.01, 0.54, 1.12, -0.07],
    [1.56, 1.44, 0.22, 0.31, 1.70, 0.04], [2.08, 1.38, 0.02, 0.60, 1.04, -0.06],
    [2.78, 1.36, 0.16, 0.29, 1.42, 0.06], [3.18, 1.33, -0.05, 0.50, 1.00, -0.05],
    [3.66, 1.30, 0.12, 0.24, 1.28, 0.03], [3.92, 1.28, -0.10, 0.46, 0.94, -0.04],
  ];
  branches.forEach(([x, y, z, yaw, length, roll], i) => p.push(fiber(`cirrus_branch_fibre_${i}`, length, 0.09 + (i % 4) * 0.018,
    0.18, x, y, z, yaw, i % 4 === 0 ? 'glassHex' : 'accentHex', 'branch_fibre', roll)));
  const tips = [
    [-4.04, 1.41, 0.54, 0.34, 1.12, 0.06], [-2.70, 1.47, 0.62, 0.56, 0.98, -0.05],
    [-1.52, 1.31, 0.48, 0.27, 1.06, 0.04], [-0.20, 1.35, 0.70, 0.50, 0.88, -0.07],
    [1.08, 1.39, 0.56, 0.30, 1.00, 0.05], [2.34, 1.36, 0.46, 0.58, 0.86, -0.04],
    [3.54, 1.31, 0.38, 0.22, 0.92, 0.06], [3.94, 1.28, 0.20, 0.44, 0.74, -0.03],
  ];
  tips.forEach(([x, y, z, yaw, length, roll], i) => p.push(fiber(`cirrus_tapered_tip_${i}`, length, 0.075, 0.12,
    x, y, z, yaw, i % 2 ? 'brightHex' : 'glassHex', 'fine_tip', roll)));
  return p;
}

function makeAltocumulus(p, c) {
  // Five separated wave rows are intentional: no monolithic sheet or hidden blanket.
  const rows = [
    { z: 1.98, xs: [-4.50, -2.86, -0.94, 0.98, 2.65, 4.42], zOffsets: [0.12, -0.06, 0.08, -0.10, 0.06, -0.04], y: [1.54, 1.63, 1.65, 1.71, 1.60, 1.55], r: 0.60 },
    { z: 0.98, xs: [-3.68, -1.88, 0.12, 1.67, 3.58], zOffsets: [-0.08, 0.10, -0.04, 0.12, -0.06], y: [1.66, 1.75, 1.78, 1.70, 1.67], r: 0.54 },
    { z: 0.00, xs: [-4.34, -2.46, -0.66, 1.16, 2.84, 4.58], zOffsets: [0.06, -0.10, 0.12, -0.06, 0.08, -0.04], y: [1.74, 1.82, 1.85, 1.87, 1.79, 1.73], r: 0.49 },
    { z: -1.02, xs: [-3.48, -1.62, 0.28, 1.98, 3.74], zOffsets: [0.10, -0.04, 0.08, -0.10, 0.06], y: [1.90, 1.98, 2.01, 1.94, 1.89], r: 0.42 },
    { z: -1.98, xs: [-4.10, -2.03, 0.18, 2.24, 4.02], zOffsets: [-0.05, 0.08, -0.10, 0.06, -0.03], y: [2.04, 2.09, 2.12, 2.06, 2.03], r: 0.34 },
  ];
  let cloudlet = 0;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    row.xs.forEach((x, i) => {
      const drift = ((((i * 3) + rowIndex) % 5) - 2) * 0.07;
      const radius = Math.max(0.26, row.r + ((((i * 2) + (rowIndex * 3)) % 5) - 2) * 0.035);
      const pos = [x + drift, row.y[i], row.z + (row.zOffsets?.[i] || 0)];
      const key = (cloudlet + rowIndex) % 4 === 0 ? 'brightHex' : rowIndex === 0 ? 'accentHex' : 'facadeHex';
      // Each wavelet is its own four-part faceted cluster, locally joined by one short wedge.
      p.push(dode(`altocumulus_wavelet_core_${cloudlet}`, radius, pos, key,
        [0.06, cloudlet * 0.29, 0.04], 'wavelet_cloudlet'));
      p.push(ico(`altocumulus_wavelet_front_${cloudlet}`, radius * 0.68,
        [pos[0] + radius * 0.62, row.y[i] - 0.03 + (i % 2) * 0.025, pos[2] + 0.12], (cloudlet + 1) % 4 === 0 ? 'brightHex' : 'accentHex',
        [0.10, cloudlet * 0.23, -0.04], 'wavelet_cloudlet'));
      p.push(dode(`altocumulus_wavelet_back_${cloudlet}`, radius * 0.62,
        [pos[0] - radius * 0.58, row.y[i] + 0.06 - (i % 3) * 0.02, pos[2] - 0.12], rowIndex > 2 ? 'roofHex' : 'facadeHex',
        [0.08, cloudlet * 0.21, 0.06], 'wavelet_cloudlet'));
      p.push(wedge(`altocumulus_wavelet_join_${cloudlet}`, [radius * 1.38, 0.14, radius * 0.70],
        [pos[0], row.y[i] - 0.20, pos[2]], rowIndex % 2 ? 'roofHex' : 'accentHex',
        [0.06, 0.02 * ((i % 3) - 1), 0.02], 'wavelet_join'));
      cloudlet += 1;
    });
  }
  p.push(dode('altocumulus_left_depth_anchor', 0.36, [-4.70, 1.55, -1.98], 'baseHex', [0.14, -0.2, 0.04], 'depth_anchor'));
  p.push(ico('altocumulus_right_depth_anchor', 0.38, [4.70, 1.61, -1.98], 'facadeHex', [-0.08, 0.22, -0.06], 'depth_anchor'));
  return p;
}

function makeCongestus(p, c) {
  // Tower is a stack of individually sized lobes; no giant dark ellipsoid/hemisphere.
  const tiers = [
    { y: 0.90, z: 0.00, xs: [-2.40, -1.20, 0.00, 1.20, 2.40], r: [0.74, 0.82, 0.88, 0.84, 0.72] },
    { y: 1.22, z: 0.04, xs: [-2.28, -1.12, 0.04, 1.18, 2.30], r: [0.66, 0.76, 0.82, 0.74, 0.62] },
    { y: 2.00, z: -0.06, xs: [-2.08, -1.00, 0.08, 1.10, 2.14], r: [0.62, 0.70, 0.78, 0.68, 0.58] },
    { y: 2.78, z: 0.06, xs: [-1.84, -0.86, 0.10, 1.04, 1.92], r: [0.56, 0.66, 0.72, 0.62, 0.52] },
    { y: 3.56, z: -0.02, xs: [-1.62, -0.68, 0.22, 1.06, 1.68], r: [0.52, 0.60, 0.70, 0.58, 0.46] },
    { y: 4.32, z: 0.05, xs: [-1.40, -0.48, 0.38, 1.18], r: [0.46, 0.56, 0.62, 0.48] },
    { y: 5.06, z: -0.01, xs: [-1.02, -0.12, 0.72, 1.40], r: [0.38, 0.50, 0.56, 0.40] },
    { y: 5.70, z: 0.02, xs: [-0.52, 0.30, 0.98], r: [0.30, 0.42, 0.34] },
  ];
  let lobeIndex = 0;
  for (let tierIndex = 0; tierIndex < tiers.length; tierIndex += 1) {
    const tier = tiers[tierIndex];
    tier.xs.forEach((x, i) => {
      const r = tier.r[i];
      const z = tier.z + ((i + tierIndex) % 2 ? 0.30 : -0.28);
      const rightInner = x > 0 && i % 2 === 0;
      const leftRim = x < -0.85 && (tierIndex < 6 || i === 0);
      const key = leftRim ? (lobeIndex % 2 ? 'brightHex' : 'accentHex')
        : rightInner ? (tierIndex < 3 ? 'darkHex' : 'baseHex')
          : tierIndex < 2 ? 'baseHex' : tierIndex % 2 ? 'facadeHex' : 'roofHex';
      p.push(lobeIndex % 2
        ? ico(`congestus_tier_${tierIndex}_icosa_${i}`, r, [x, tier.y, z], key, [0.10, lobeIndex * 0.23, -0.04], 'tiered_lobe')
        : dode(`congestus_tier_${tierIndex}_dode_${i}`, r, [x, tier.y, z], key, [0.08, lobeIndex * 0.29, 0.05], 'tiered_lobe'));
      lobeIndex += 1;
    });
  }
  const rim = [
    [-2.68, 1.10, 0.42, 0.46], [-2.64, 1.90, 0.34, 0.50], [-2.48, 2.72, 0.40, 0.48],
    [-2.28, 3.56, 0.34, 0.46], [-2.00, 4.36, 0.38, 0.43], [-1.62, 5.10, 0.34, 0.38],
    [-1.12, 5.70, 0.28, 0.32],
  ];
  rim.forEach(([x, y, z, r], i) => p.push(i % 2
    ? ico(`congestus_bright_left_rim_${i}`, r, [x, y, z], 'brightHex', [0.10, i * 0.22, -0.04], 'bright_rim')
    : dode(`congestus_bright_left_rim_${i}`, r, [x, y, z], 'accentHex', [0.08, i * 0.27, 0.04], 'bright_rim')));
  [-1.72, -0.58, 0.58, 1.72].forEach((x, i) => p.push(dode(`congestus_dark_underbelly_${i}`, 0.42,
    [x, 0.58 + (i % 2) * 0.08, 1.02], i % 2 ? 'darkHex' : 'baseHex', [0.16, i * 0.33, 0.03], 'dark_underbelly')));
  // Replace the old projecting white wedges with small inner facets that close dark gaps.
  [
    [0.02, 2.58, 0.50, 0.36, 'darkHex'], [0.72, 3.26, 0.44, 0.34, 'baseHex'],
    [-0.34, 4.06, 0.34, 0.32, 'darkHex'], [1.10, 4.68, 0.38, 0.28, 'roofHex'],
  ].forEach(([x, y, z, r, key], i) => p.push(i % 2
    ? ico(`congestus_inner_gap_fill_icosa_${i}`, r, [x, y, z], key, [0.10, i * 0.22, -0.04], 'inner_shadow_lobe')
    : dode(`congestus_inner_gap_fill_dode_${i}`, r, [x, y, z], key, [0.08, i * 0.27, 0.05], 'inner_shadow_lobe')));
  return p;
}

function makeSpec(target) {
  const rawParts = [];
  if (target.profile === 'cumulus') makeCumulus(rawParts, target.palette);
  else if (target.profile === 'mammatus') makeMammatus(rawParts, target.palette);
  else if (target.profile === 'cirrus') makeCirrus(rawParts, target.palette);
  else if (target.profile === 'altocumulus') makeAltocumulus(rawParts, target.palette);
  else if (target.profile === 'congestus') makeCongestus(rawParts, target.palette);
  else throw new Error(`未知雲型: ${target.profile}`);
  const parts = softenCloudParts(rawParts, target.profile);
  return {
    style: target.style,
    symmetryMode: 'asymmetric',
    colors: target.palette,
    parts,
    cloudProfile: target.profile,
    silhouette: target.silhouette,
    pureCloudOnly: true,
    generationTag: GENERATION_TAG,
    method: METHOD,
    version: VERSION,
    note: `照片特徵「${target.silhouette}」以 ${parts.length} 個連接多面體重建；ellipsoid 僅為嵌入核心，外輪廓由 faceted lobes/ridges/fibres 打破。`,
  };
}

function validateSpec(spec, target) {
  if (spec.parts.length < 28) throw new Error(`${target.profile} parts=${spec.parts.length} < 28`);
  for (const [key, color] of Object.entries(spec.colors)) {
    if (!COLOR_KEYS.has(key) || !Number.isInteger(color)) throw new Error(`無效七區色彩: ${key}`);
  }
  for (const part of spec.parts) {
    if (!ALLOWED_TYPES.has(part.type)) throw new Error(`雲模型禁用 primitive: ${part.type}`);
    if (!COLOR_KEYS.has(part.colorKey)) throw new Error(`無效 colorKey: ${part.name}`);
    if (!Array.isArray(part.pos) || part.pos.length !== 3 || part.pos.some((v) => !Number.isFinite(v))) {
      throw new Error(`無效位置: ${part.name}`);
    }
    if (part.pos[1] < -0.05) throw new Error(`雲部件穿過 y=0: ${part.name}`);
    if (part.type === 'ellipsoid_sphere' && part.role !== 'embedded_core') {
      throw new Error(`ellipsoid 只能作嵌入核心: ${part.name}`);
    }
  }
  const ellipsoids = spec.parts.filter((part) => part.type === 'ellipsoid_sphere');
  const facetedNodes = spec.parts.filter((part) => ['dodecahedron_polyhedron', 'icosahedron_polyhedron'].includes(part.type));
  if (target.profile !== 'altocumulus' && target.profile !== 'congestus' && !ellipsoids.length) {
    throw new Error(`${target.profile} 缺少嵌入核心`);
  }
  if (facetedNodes.length < 4) {
    throw new Error(`${target.profile} 缺少 faceted 外輪廓`);
  }
}

function primitiveVolume(part) {
  if (part.type === 'ellipsoid_sphere') {
    const [rx, ry, rz] = part.radii;
    return (4 / 3) * Math.PI * rx * ry * rz;
  }
  if (part.type === 'hemisphere_dome') {
    const [rx, ry, rz] = part.radii;
    return (2 / 3) * Math.PI * rx * ry * rz;
  }
  if (['dodecahedron_polyhedron', 'icosahedron_polyhedron'].includes(part.type)) {
    return (4 / 3) * Math.PI * (part.radius ** 3);
  }
  if (part.type === 'wedge') {
    const [w, h, d] = part.dimensions;
    return (w * h * d) / 6;
  }
  if (part.type === 'frustum_pyramid') {
    const [topR, botR] = part.radii;
    return (Math.PI * part.height * (topR ** 2 + topR * botR + botR ** 2)) / 3;
  }
  return 0;
}

function primitiveReach(part) {
  if (['dodecahedron_polyhedron', 'icosahedron_polyhedron'].includes(part.type)) return part.radius * 1.16;
  if (part.type === 'ellipsoid_sphere' || part.type === 'hemisphere_dome') return Math.max(...part.radii);
  if (part.type === 'wedge') return Math.hypot(...part.dimensions.map((value) => value / 2));
  if (part.type === 'frustum_pyramid') return Math.hypot(Math.max(...part.radii), part.height / 2);
  return 0.2;
}

function assertContract(spec, geometry, target) {
  const boundsVolume = geometry.bounds.size.reduce((product, value) => product * Math.max(value, 0.001), 1);
  const maxVolume = boundsVolume * 0.20;
  const maxEllipsoidProduct = boundsVolume * 0.10;
  if (geometry.bounds.min[1] < -0.02) throw new Error(`${target.profile} 幾何穿過 y=0: ${geometry.bounds.min[1]}`);
  const isolated = [];
  for (let i = 0; i < spec.parts.length; i += 1) {
    const part = spec.parts[i];
    const volume = primitiveVolume(part);
    if (volume > maxVolume) throw new Error(`${target.profile} 單一 primitive 體積超過 20%: ${part.name}`);
    if (part.type === 'ellipsoid_sphere' && target.profile !== 'cirrus') {
      const product = part.radii.reduce((value, radius) => value * radius, 1);
      if (product > maxEllipsoidProduct) throw new Error(`${target.profile} ellipsoid core 超過 bounds 體積 10%: ${part.name}`);
    }
    const [x, y, z] = part.pos;
    const reach = primitiveReach(part);
    let joined = false;
    for (let j = 0; j < spec.parts.length; j += 1) {
      if (i === j) continue;
      const other = spec.parts[j];
      const distance = Math.hypot(x - other.pos[0], y - other.pos[1], z - other.pos[2]);
      if (distance <= reach + primitiveReach(other) + 0.22) {
        joined = true;
        break;
      }
    }
    if (!joined) isolated.push(part.name);
  }
  if (isolated.length) throw new Error(`${target.profile} 出現主體孤立部件: ${isolated.join(', ')}`);
}

function applyCloudRoles(geometry, spec) {
  geometry.modelJson.generationTag = GENERATION_TAG;
  geometry.modelJson.version = VERSION;
  geometry.modelJson.method = METHOD;
  geometry.modelJson.cloudProfile = spec.cloudProfile;
  geometry.modelJson.pureCloudOnly = true;
  geometry.modelJson.cloudSemantic = {
    glassHex: 'cloud_highlight',
    noWindowSemantics: true,
    noSunLandscapePeopleAnimals: true,
  };
  geometry.modelJson.parts.forEach((part, index) => {
    part.role = spec.parts[index]?.role || 'cloud_lobe';
    part.colorKey = spec.parts[index]?.colorKey || null;
  });
  geometry.featuresJson.generationTag = GENERATION_TAG;
  geometry.featuresJson.version = VERSION;
  geometry.featuresJson.method = METHOD;
  geometry.featuresJson.cloudProfile = spec.cloudProfile;
  geometry.featuresJson.pureCloudOnly = true;
  geometry.featuresJson.cloudSemantic = geometry.modelJson.cloudSemantic;
  geometry.featuresJson.reconstructionNote = spec.note;
}

function makeReview(target) {
  return {
    similarityScore: target.score,
    verdict: 'awaiting_human_review',
    reviewer: 'gpt-5.6-luna_visual_direct',
    reviewStage: 'retry_2_three_view_visual_review',
    retry: 2,
    critique: target.critique,
    corrections: target.corrections,
  };
}

function processTarget(target) {
  const sourcePath = join(IMAGE_ROOT, target.image);
  if (!existsSync(sourcePath)) throw new Error(`找不到指定參考照: ${sourcePath}`);
  const spec = makeSpec(target);
  validateSpec(spec, target);
  const stableTarget = `cloud/${target.subpart}_${target.stem}`;
  const hash = hash8(`${stableTarget}|${METHOD}|${VERSION}|${target.silhouette}`);
  const targetId = `cloud_${target.subpart}_${target.stem}_${hash}_luna_v6`;
  const key = `${stableTarget}_${hash}_luna_v6`;
  const geometry = buildGeometryFromParts(spec, 'cloud', target.subpart, targetId);
  assertContract(spec, geometry, target);
  applyCloudRoles(geometry, spec);
  const preview = join(PREVIEW_ROOT, `${targetId}.png`);
  const previewModel = `${preview}.model.json`;
  const review = makeReview(target);
  const yolo26 = {
    schemaVersion: null,
    evidenceStatus: 'missing_yolo26_schema_v2',
    eligible: false,
    pipelineEligibility: 'awaiting_human_review',
    featureFile: null,
    target: null,
  };
  const evidenceOverride = {
    type: 'llm_visual_direct',
    authorizedBy: 'user',
    model: MODEL,
    reason: '本批五件純雲目標依使用者指定由 GPT-5.6 Luna 直接逐張目視重建；缺少 YOLO26 schema-v2 時保持不可入 runtime。',
  };
  const outputDir = join(OUTPUT_ROOT, target.subpart, targetId);
  if (!DRY_RUN) {
    mkdirSync(outputDir, { recursive: true });
    writeJsonAtomic(previewModel, geometry.modelJson);
    execFileSync(PYTHON, [PREVIEW_RENDERER, previewModel, preview], { timeout: 30_000 });
    const features = {
      ...geometry.featuresJson,
      schemaVersion: null,
      sourceImage: target.image,
      sourceFullPath: sourcePath,
      sourceLicenseHint: 'photo_manifest.json',
      yolo26,
      evidenceStatus: 'missing_yolo26_schema_v2',
      evidenceOverride,
      eligible: false,
      pipelineEligibility: 'awaiting_human_review',
      localModel: MODEL,
      similarityReview: review,
      similarityScore: review.similarityScore,
      reconstructionNote: spec.note,
    };
    const metadata = {
      id: targetId,
      key,
      canonicalTarget: stableTarget,
      family: 'cloud',
      subpart: target.subpart,
      stem: target.stem,
      style: target.style,
      symmetryMode: spec.symmetryMode,
      cloudProfile: target.profile,
      silhouette: target.silhouette,
      pureCloudOnly: true,
      cloudSemantic: geometry.modelJson.cloudSemantic,
      colors: target.palette,
      similarityScore: review.similarityScore,
      similarityReview: review.critique,
      similarityVerdict: review.verdict,
      similarityCorrections: review.corrections,
      similarityReviewRecord: review,
      model: MODEL,
      version: VERSION,
      verStr: 'v6',
      method: METHOD,
      generationTag: GENERATION_TAG,
      status: 'awaiting_human_review',
      eligible: false,
      pipelineEligibility: 'awaiting_human_review',
      source_image: target.image,
      source_full_path: sourcePath,
      yolo26,
      evidenceOverride,
      preview: relativePath(preview),
      previewModel: relativePath(previewModel),
      bounds: geometry.bounds,
      parts: geometry.modelJson.parts.length,
      reconstructionNote: spec.note,
      created_at: new Date().toISOString(),
      humanVerdictPreserved: true,
    };
    writeJsonAtomic(join(outputDir, 'model.json'), geometry.modelJson);
    writeJsonAtomic(join(outputDir, 'features.json'), features);
    writeJsonAtomic(join(outputDir, 'metadata.json'), metadata);
    writeTextAtomic(join(outputDir, 'model.obj'), geometry.objContent);
  }
  return {
    target: stableTarget,
    targetId,
    key,
    family: 'cloud',
    subpart: target.subpart,
    stem: target.stem,
    image: target.image,
    sourcePath,
    sourceFound: true,
    profile: target.profile,
    style: target.style,
    silhouette: target.silhouette,
    model: MODEL,
    method: METHOD,
    version: VERSION,
    verStr: 'v6',
    generationTag: GENERATION_TAG,
    yolo26,
    evidenceStatus: yolo26.evidenceStatus,
    eligible: false,
    pipelineEligibility: 'awaiting_human_review',
    similarityReview: review,
    outputDir: relativePath(outputDir),
    preview: relativePath(preview),
    previewModel: relativePath(previewModel),
    bounds: geometry.bounds,
    parts: geometry.modelJson.parts.length,
    triangles: geometry.bounds.triangles,
    vertices: geometry.bounds.vertices,
    primitiveTypes: geometry.featuresJson.polyhedralPrimitivesUsed,
  };
}

function main() {
  const selected = TARGETS.filter((target) => !ONLY || target.profile === ONLY || target.subpart === ONLY || target.stem === ONLY)
    .slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);
  if (!selected.length) throw new Error(`沒有符合 --only/--limit 的 cloud 目標: ${ONLY || 'all'}`);
  if (!DRY_RUN && !existsSync(PYTHON)) throw new Error(`找不到固定 Python runtime: ${PYTHON}`);
  const results = [];
  for (const target of selected) {
    try {
      const result = processTarget(target);
      results.push({ ...result, status: DRY_RUN ? 'validated' : 'awaiting_human_review' });
      console.log(`✓ ${result.target} parts=${result.parts} tris=${result.triangles} score=${result.similarityReview.similarityScore}`);
    } catch (error) {
      results.push({ target: `cloud/${target.subpart}_${target.stem}`, status: 'failed', eligible: false, reason: error.message });
      console.error(`✗ ${target.profile}: ${error.message}`);
    }
  }
  if (!DRY_RUN) {
    writeJsonAtomic(CANDIDATE_REPORT, {
      model: MODEL,
      method: METHOD,
      version: VERSION,
      verStr: 'v6',
      generationTag: GENERATION_TAG,
      generatedAt: new Date().toISOString(),
      humanVerdictsPreserved: true,
      runtimeEligible: false,
      evidenceStatus: 'missing_yolo26_schema_v2',
      pipelineEligibility: 'awaiting_human_review',
      candidates: results,
    });
  }
  const failed = results.filter((row) => row.status === 'failed');
  console.log(`完成: ${results.length - failed.length}；失敗: ${failed.length}`);
  console.log('五件純雲候選均維持 awaiting_human_review / eligible=false，未修改 DB、manifest 或 review state。');
  if (failed.length) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
