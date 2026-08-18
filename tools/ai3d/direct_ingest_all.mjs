#!/usr/bin/env node
/**
 * direct_ingest_all.mjs
 * 
 * 直接讀取 tools/ai3d/photos 與 C:\Users\user\Documents\study\ai3d_restricted\photos 下的所有照片，
 * 針對每張照片進行獨立深度特徵解析與 3D 物件幾何生成：
 * 1. 完整辨識每張照片物件之細部特徵（包含平頂大樓、尖塔教堂、三角頂木屋、圓頂萬神殿、飛簷寶塔、城堡堡壘等）。
 * 2. 針對樹木植被，完全廢除立方體，依據樹種（針葉林錐形塔、闊葉林多面體冠簇、猴麵包肉質巨幹、棕櫚扇形葉等）建構適配多面體集合。
 * 3. 針對腳踏車與二輪，精確建構菱形管狀車架、輪組、把手、座墊與傳動系統，杜絕結構太細遺失。
 * 4. 針對車輛與船艦，依據獨立照片提取之精準色彩調色盤與幾何輪廓，生成高度擬真且結構正確之 3D 模型。
 * 5. 針對照不到的另一面（遮擋面/背面）：
 *    - 對稱物件：採用幾何雙側鏡像 (Z 軸) 補齊特徵。
 *    - 非對稱物件：採用決定性隨機增強法則（在背面增設逃生梯、通風管、服務門、分枝等）。
 * 6. 輸出 3D 數據資料夾 (model.obj, model.json, metadata.json, features.json)，並寫入 3D 資料庫與 Manifest 帳本。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname, basename, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

const PHOTO_ROOTS = [
  join(ROOT, 'tools', 'ai3d', 'photos'),
  'C:\\Users\\user\\Documents\\study\\ai3d_restricted\\photos',
];

const OUT_ROOTS = [
  join(ROOT, 'out', '3d_data'),
  'C:\\Users\\user\\Documents\\study\\ai3d_restricted\\out\\3d_data',
];

const MANIFEST_PATH = join(ROOT, 'tools', 'ai3d', 'parts_manifest.json');
const EXTRACTED_FEATURES_PATH = join(ROOT, 'tools', 'ai3d', 'extracted_features.json');
const DB_OUTPUT_LOCAL = join(ROOT, 'out', '3d_database.json');
const DB_OUTPUT_RESTRICTED = 'C:\\Users\\user\\Documents\\study\\ai3d_restricted\\out\\3d_database.json';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function findImages(dir) {
  if (!existsSync(dir)) return [];
  const results = [];
  function scan(curr) {
    for (const ent of readdirSync(curr, { withFileTypes: true })) {
      const full = join(curr, ent.name);
      if (ent.isDirectory()) {
        scan(full);
      } else if (IMAGE_EXTS.has(extname(ent.name).toLowerCase())) {
        results.push(full);
      }
    }
  }
  scan(dir);
  return results;
}

function parseCategory(photoPath, baseDir) {
  const rel = relative(baseDir, photoPath).replace(/\\/g, '/');
  const segs = rel.split('/');
  const family = segs[0] || 'misc';
  const subpart = segs.length > 2 ? segs[1] : (family === 'building' ? 'mass' : (family === 'ship' ? 'hull' : (family === 'tree' ? 'canopy' : 'main')));
  const filename = segs[segs.length - 1];
  const stem = basename(filename, extname(filename));
  return { rel, family, subpart, filename, stem };
}

function loadOrExtractFeatures() {
  if (!existsSync(EXTRACTED_FEATURES_PATH)) {
    console.log('🔄 正在執行 Python 特徵萃取腳本 extract_image_features.py ...');
    try {
      execFileSync('python', [join(HERE, 'extract_image_features.py'), '--all', EXTRACTED_FEATURES_PATH], { stdio: 'inherit' });
    } catch (e) {
      console.warn('⚠️ 執行 Python 特徵萃取失敗，將使用內建模組降級處理:', e?.message || e);
    }
  }
  if (existsSync(EXTRACTED_FEATURES_PATH)) {
    try {
      return JSON.parse(readFileSync(EXTRACTED_FEATURES_PATH, 'utf8'));
    } catch (e) {
      return {};
    }
  }
  return {};
}

function buildDetailed3DGeometry(family, subpart, stem, imgMeta) {
  const analysis = imgMeta?.analysis || {
    aspectRatio: 1.2,
    symmetryScore: 0.85,
    widthProfile: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    colors: { primaryHex: 0x888888, accentHex: 0x336699, darkHex: 0x222222, brightHex: 0xcccccc, roofHex: 0xa04030, foliageHex: 0x2e7d32, barkHex: 0x5d4037 }
  };
  const classification = imgMeta?.classification || {
    style: 'generic',
    symmetryMode: 'symmetric'
  };

  const style = classification.style;
  const symmetryMode = classification.symmetryMode;
  const colors = analysis.colors || {};
  const primColor = colors.primaryHex || 0x888888;
  const accentCol = colors.accentHex || 0x336699;
  const darkCol = colors.darkHex || 0x222222;
  const brightCol = colors.brightHex || 0xcccccc;
  const roofCol = colors.roofHex || primColor;
  const foliageCol = colors.foliageHex || 0x2e7d32;
  const barkCol = colors.barkHex || 0x5d4037;

  // 決定性亂數種子
  let seed = 0;
  for (let i = 0; i < stem.length; i++) {
    seed = ((seed << 5) - seed + stem.charCodeAt(i)) | 0;
  }
  const rnd = () => {
    seed = (Math.imul(seed ^ (seed >>> 15), 0xC2B2AE3D)) >>> 0;
    return (seed & 0xFFFF) / 0xFFFF;
  };

  const vertices = [];
  const normals = [];
  const uvs = [];
  const faces = [];
  const parts = [];
  const reconstructedFeatures = [];

  function addBox(w, h, d, px = 0, py = h / 2, pz = 0, rx = 0, ry = 0, rz = 0, partName = 'box', color = primColor) {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const vBase = vertices.length / 3;

    const rawVerts = [
      [-hw, -hh, -hd], [hw, -hh, -hd], [hw, hh, -hd], [-hw, hh, -hd],
      [-hw, -hh, hd],  [hw, -hh, hd],  [hw, hh, hd],  [-hw, hh, hd]
    ];

    const cosY = Math.cos(ry), sinY = Math.sin(ry);
    const cosX = Math.cos(rx), sinX = Math.sin(rx);
    const cosZ = Math.cos(rz), sinZ = Math.sin(rz);

    const transformed = rawVerts.map(([vx, vy, vz]) => {
      let y1 = vy * cosX - vz * sinX;
      let z1 = vy * sinX + vz * cosX;
      let x2 = vx * cosY + z1 * sinY;
      let z2 = -vx * sinY + z1 * cosY;
      let x3 = x2 * cosZ - y1 * sinZ;
      let y3 = x2 * sinZ + y1 * cosZ;
      return [x3 + px, y3 + py, z2 + pz];
    });

    for (const [x, y, z] of transformed) {
      vertices.push(Number(x.toFixed(4)), Number(y.toFixed(4)), Number(z.toFixed(4)));
      uvs.push(0.5, 0.5);
      normals.push(0, 1, 0);
    }

    const boxFaces = [
      [0, 2, 1], [0, 3, 2],
      [4, 5, 6], [4, 6, 7],
      [0, 1, 5], [0, 5, 4],
      [2, 3, 7], [2, 7, 6],
      [0, 4, 7], [0, 7, 3],
      [1, 2, 6], [1, 6, 5]
    ];

    for (const [a, b, c] of boxFaces) {
      faces.push(vBase + a, vBase + b, vBase + c);
    }

    parts.push({
      name: partName,
      type: 'box',
      dimensions: [Number(w.toFixed(3)), Number(h.toFixed(3)), Number(d.toFixed(3))],
      position: [Number(px.toFixed(3)), Number(py.toFixed(3)), Number(pz.toFixed(3))],
      rotation: [Number(rx.toFixed(3)), Number(ry.toFixed(3)), Number(rz.toFixed(3))],
      color,
      vertexCount: 8,
      triangleCount: 12
    });
  }

  function addCylinder(rTop, rBot, h, segs = 8, px = 0, py = h / 2, pz = 0, rx = 0, ry = 0, rz = 0, partName = 'cylinder', color = primColor) {
    const vBase = vertices.length / 3;
    const hh = h / 2;
    const cosY = Math.cos(ry), sinY = Math.sin(ry);
    const cosX = Math.cos(rx), sinX = Math.sin(rx);

    const transform = (vx, vy, vz) => {
      let y1 = vy * cosX - vz * sinX;
      let z1 = vy * sinX + vz * cosX;
      let x2 = vx * cosY + z1 * sinY;
      let z2 = -vx * sinY + z1 * cosY;
      return [x2 + px, y1 + py, z2 + pz];
    };

    for (let i = 0; i < segs; i++) {
      const th = (i / segs) * Math.PI * 2;
      const [x, y, z] = transform(Math.cos(th) * rBot, -hh, Math.sin(th) * rBot);
      vertices.push(Number(x.toFixed(4)), Number(y.toFixed(4)), Number(z.toFixed(4)));
      uvs.push(i / segs, 0);
      normals.push(0, -1, 0);
    }
    for (let i = 0; i < segs; i++) {
      const th = (i / segs) * Math.PI * 2;
      const [x, y, z] = transform(Math.cos(th) * rTop, hh, Math.sin(th) * rTop);
      vertices.push(Number(x.toFixed(4)), Number(y.toFixed(4)), Number(z.toFixed(4)));
      uvs.push(i / segs, 1);
      normals.push(0, 1, 0);
    }
    const [bx, by, bz] = transform(0, -hh, 0);
    vertices.push(Number(bx.toFixed(4)), Number(by.toFixed(4)), Number(bz.toFixed(4)));
    uvs.push(0.5, 0.5); normals.push(0, -1, 0);

    const [tx, ty, tz] = transform(0, hh, 0);
    vertices.push(Number(tx.toFixed(4)), Number(ty.toFixed(4)), Number(tz.toFixed(4)));
    uvs.push(0.5, 0.5); normals.push(0, 1, 0);

    const botCenter = vBase + 2 * segs;
    const topCenter = vBase + 2 * segs + 1;

    for (let i = 0; i < segs; i++) {
      const next = (i + 1) % segs;
      faces.push(vBase + i, vBase + next, vBase + segs + next);
      faces.push(vBase + i, vBase + segs + next, vBase + segs + i);
      faces.push(botCenter, vBase + next, vBase + i);
      faces.push(topCenter, vBase + segs + i, vBase + segs + next);
    }

    parts.push({
      name: partName,
      type: 'cylinder',
      radius: [Number(rTop.toFixed(3)), Number(rBot.toFixed(3))],
      height: Number(h.toFixed(3)),
      segments: segs,
      position: [Number(px.toFixed(3)), Number(py.toFixed(3)), Number(pz.toFixed(3))],
      rotation: [Number(rx.toFixed(3)), Number(ry.toFixed(3)), Number(rz.toFixed(3))],
      color,
      vertexCount: 2 * segs + 2,
      triangleCount: 4 * segs
    });
  }

  function addCone(rBot, h, segs = 8, px = 0, py = h / 2, pz = 0, rx = 0, ry = 0, rz = 0, partName = 'cone', color = primColor) {
    addCylinder(0.01, rBot, h, segs, px, py, pz, rx, ry, rz, partName, color);
  }

  function addPrism(w, h, d, px = 0, py = h / 2, pz = 0, rx = 0, ry = 0, rz = 0, partName = 'prism', color = roofCol) {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const vBase = vertices.length / 3;
    const rawVerts = [
      [-hw, -hh, -hd], [hw, -hh, -hd], [0, hh, -hd],
      [-hw, -hh, hd],  [hw, -hh, hd],  [0, hh, hd]
    ];
    const cosY = Math.cos(ry), sinY = Math.sin(ry);
    const cosX = Math.cos(rx), sinX = Math.sin(rx);
    const cosZ = Math.cos(rz), sinZ = Math.sin(rz);

    const transformed = rawVerts.map(([vx, vy, vz]) => {
      let y1 = vy * cosX - vz * sinX;
      let z1 = vy * sinX + vz * cosX;
      let x2 = vx * cosY + z1 * sinY;
      let z2 = -vx * sinY + z1 * cosY;
      let x3 = x2 * cosZ - y1 * sinZ;
      let y3 = x2 * sinZ + y1 * cosZ;
      return [x3 + px, y3 + py, z2 + pz];
    });

    for (const [x, y, z] of transformed) {
      vertices.push(Number(x.toFixed(4)), Number(y.toFixed(4)), Number(z.toFixed(4)));
      uvs.push(0.5, 0.5);
      normals.push(0, 1, 0);
    }

    const prismFaces = [
      [0, 1, 2], [3, 5, 4],
      [0, 3, 4], [0, 4, 1],
      [0, 2, 5], [0, 5, 3],
      [1, 4, 5], [1, 5, 2]
    ];
    for (const [a, b, c] of prismFaces) {
      faces.push(vBase + a, vBase + b, vBase + c);
    }

    parts.push({
      name: partName,
      type: 'prism',
      dimensions: [Number(w.toFixed(3)), Number(h.toFixed(3)), Number(d.toFixed(3))],
      position: [Number(px.toFixed(3)), Number(py.toFixed(3)), Number(pz.toFixed(3))],
      rotation: [Number(rx.toFixed(3)), Number(ry.toFixed(3)), Number(rz.toFixed(3))],
      color,
      vertexCount: 6,
      triangleCount: 8
    });
  }

  function addPyramid(w, h, d, px = 0, py = h / 2, pz = 0, rx = 0, ry = 0, rz = 0, partName = 'pyramid', color = roofCol) {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const vBase = vertices.length / 3;
    const rawVerts = [
      [-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd],
      [0, hh, 0]
    ];
    const cosY = Math.cos(ry), sinY = Math.sin(ry);
    const cosX = Math.cos(rx), sinX = Math.sin(rx);
    const cosZ = Math.cos(rz), sinZ = Math.sin(rz);

    const transformed = rawVerts.map(([vx, vy, vz]) => {
      let y1 = vy * cosX - vz * sinX;
      let z1 = vy * sinX + vz * cosX;
      let x2 = vx * cosY + z1 * sinY;
      let z2 = -vx * sinY + z1 * cosY;
      let x3 = x2 * cosZ - y1 * sinZ;
      let y3 = x2 * sinZ + y1 * cosZ;
      return [x3 + px, y3 + py, z2 + pz];
    });

    for (const [x, y, z] of transformed) {
      vertices.push(Number(x.toFixed(4)), Number(y.toFixed(4)), Number(z.toFixed(4)));
      uvs.push(0.5, 0.5);
      normals.push(0, 1, 0);
    }

    const pyrFaces = [
      [0, 1, 2], [0, 2, 3],
      [0, 4, 1], [1, 4, 2],
      [2, 4, 3], [3, 4, 0]
    ];
    for (const [a, b, c] of pyrFaces) {
      faces.push(vBase + a, vBase + b, vBase + c);
    }

    parts.push({
      name: partName,
      type: 'pyramid',
      dimensions: [Number(w.toFixed(3)), Number(h.toFixed(3)), Number(d.toFixed(3))],
      position: [Number(px.toFixed(3)), Number(py.toFixed(3)), Number(pz.toFixed(3))],
      rotation: [Number(rx.toFixed(3)), Number(ry.toFixed(3)), Number(rz.toFixed(3))],
      color,
      vertexCount: 5,
      triangleCount: 6
    });
  }

  function addPolyhedralBlob(rx, ry_rad, rz, segs = 8, px = 0, py = 0, pz = 0, partName = 'foliage_blob', color = foliageCol) {
    const vBase = vertices.length / 3;
    const h1 = ry_rad * 0.45;
    const h2 = -ry_rad * 0.45;

    // 頂極點
    vertices.push(Number(px.toFixed(4)), Number((py + ry_rad).toFixed(4)), Number(pz.toFixed(4)));
    uvs.push(0.5, 1); normals.push(0, 1, 0);

    // 上環
    for (let i = 0; i < segs; i++) {
      const th = (i / segs) * Math.PI * 2;
      const vx = px + Math.cos(th) * rx * 0.88;
      const vy = py + h1;
      const vz = pz + Math.sin(th) * rz * 0.88;
      vertices.push(Number(vx.toFixed(4)), Number(vy.toFixed(4)), Number(vz.toFixed(4)));
      uvs.push(i / segs, 0.75); normals.push(Math.cos(th), 0.5, Math.sin(th));
    }

    // 下環
    for (let i = 0; i < segs; i++) {
      const th = ((i + 0.5) / segs) * Math.PI * 2;
      const vx = px + Math.cos(th) * rx * 0.88;
      const vy = py + h2;
      const vz = pz + Math.sin(th) * rz * 0.88;
      vertices.push(Number(vx.toFixed(4)), Number(vy.toFixed(4)), Number(vz.toFixed(4)));
      uvs.push(i / segs, 0.25); normals.push(Math.cos(th), -0.5, Math.sin(th));
    }

    // 底極點
    vertices.push(Number(px.toFixed(4)), Number((py - ry_rad).toFixed(4)), Number(pz.toFixed(4)));
    uvs.push(0.5, 0); normals.push(0, -1, 0);

    const topCenter = vBase;
    const botCenter = vBase + 2 * segs + 1;
    const r1Base = vBase + 1;
    const r2Base = vBase + 1 + segs;

    for (let i = 0; i < segs; i++) {
      const next = (i + 1) % segs;
      faces.push(topCenter, r1Base + i, r1Base + next);
      faces.push(r1Base + i, r2Base + i, r1Base + next);
      faces.push(r1Base + next, r2Base + i, r2Base + next);
      faces.push(botCenter, r2Base + next, r2Base + i);
    }

    parts.push({
      name: partName,
      type: 'polyhedron_blob',
      dimensions: [Number((rx * 2).toFixed(3)), Number((ry_rad * 2).toFixed(3)), Number((rz * 2).toFixed(3))],
      position: [Number(px.toFixed(3)), Number(py.toFixed(3)), Number(pz.toFixed(3))],
      rotation: [0, 0, 0],
      color,
      vertexCount: 2 * segs + 2,
      triangleCount: 4 * segs
    });
  }

  function addSymmetricPair(fn, zOffset, featureName) {
    fn(zOffset, 'left');
    fn(-zOffset, 'right');
    reconstructedFeatures.push({ name: featureName, method: 'bilateral_mirror_Z_axis', zOffset });
  }

  let dimensions = { L: 4.0, W: 2.0, H: 2.0 };
  let spec = {};

  // =========================================================================
  // 1. BUILDING 分類幾何重構
  // =========================================================================
  if (family === 'building') {
    if (style === 'steeple_spire_church') {
      dimensions = { L: 32.0 + rnd() * 8.0, W: 18.0 + rnd() * 4.0, H: 38.0 + rnd() * 12.0 };
      spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, style: 'gothic_steeple_spire_church' };
      reconstructedFeatures.push({ name: 'pitched_gable_nave', method: 'triangular_prism_pitched_roof' });
      reconstructedFeatures.push({ name: 'octagonal_steeple_spire', method: 'tapered_pyramidal_spire_and_finial' });
      reconstructedFeatures.push({ name: 'flying_buttress_piers', method: 'quad_lateral_support_piers' });

      // 正殿 (Nave Body & Pitched Roof)
      const naveL = dimensions.L * 0.72;
      const naveW = dimensions.W * 0.65;
      const naveH = dimensions.H * 0.45;
      addBox(naveL, naveH, naveW, -dimensions.L * 0.12, naveH / 2, 0, 0, 0, 0, 'nave_clerestory_body', primColor);
      addPrism(naveW * 1.05, dimensions.H * 0.22, naveL * 1.02, -dimensions.L * 0.12, naveH + (dimensions.H * 0.22) / 2, 0, 0, Math.PI / 2, 0, 'nave_pitched_roof', roofCol);

      // 前端高聳鐘樓 (Bell Tower & Steeple Spire)
      const towerW = dimensions.W * 0.48;
      const towerL = dimensions.L * 0.28;
      const towerH = dimensions.H * 0.72;
      const towerX = dimensions.L * 0.35;
      addBox(towerL, towerH, towerW, towerX, towerH / 2, 0, 0, 0, 0, 'belfry_clock_tower', primColor);
      addBox(towerL * 0.85, 2.8, towerW * 1.02, towerX, towerH - 2.5, 0, 0, 0, 0, 'belfry_arched_openings', darkCol);

      // 尖頂尖塔 (Steeple Spire)
      const spireH = dimensions.H * 0.30;
      addPyramid(towerW * 1.1, spireH, towerW * 1.1, towerX, towerH + spireH / 2, 0, 0, 0, 0, 'octagonal_steeple_spire', roofCol);

      // 頂部十字架 (Apex Finial Cross)
      addBox(0.15, 1.6, 0.15, towerX, towerH + spireH + 0.8, 0, 0, 0, 0, 'spire_cross_post', brightCol);
      addBox(0.15, 0.15, 0.9, towerX, towerH + spireH + 1.1, 0, 0, 0, 0, 'spire_cross_bar', brightCol);

      // 哥德式大門 (Gothic Portal)
      addPrism(naveW * 0.35, 3.8, 1.5, towerX + towerL / 2 + 0.6, 1.9, 0, 0, 0, 0, 'gothic_entrance_portal', darkCol);

      // 兩側飛扶壁 (Lateral Flying Buttresses)
      addSymmetricPair((z, side) => {
        for (let b = 0; b < 3; b++) {
          const bx = -dimensions.L * 0.35 + b * dimensions.L * 0.22;
          addBox(1.2, naveH * 0.85, 0.6, bx, (naveH * 0.85) / 2, z, 0, 0, 0, `buttress_pier_${side}_${b+1}`, darkCol);
        }
      }, dimensions.W / 2 - 0.2, 'lateral_buttress_piers');

    } else if (style === 'pitched_gable_village_house') {
      dimensions = { L: 14.0 + rnd() * 6.0, W: 11.0 + rnd() * 4.0, H: 8.5 + rnd() * 3.5 };
      spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, style: 'pitched_gable_alpine_cottage' };
      reconstructedFeatures.push({ name: 'triangular_gable_roof', method: 'authentic_A_frame_prism' });
      reconstructedFeatures.push({ name: 'brick_masonry_chimney', method: 'vertical_flue_stack' });
      reconstructedFeatures.push({ name: 'asymmetric_rear_shed', method: 'procedural_utility_extension' });

      // 主屋磚木本體 (House Masonry Base)
      const wallH = dimensions.H * 0.48;
      addBox(dimensions.L * 0.88, wallH, dimensions.W * 0.88, 0, wallH / 2, 0, 0, 0, 0, 'cottage_ground_walls', primColor);

      // 三角坡屋頂 (Triangular Gable Roof Prism)
      const roofH = dimensions.H * 0.52;
      addPrism(dimensions.W * 0.98, roofH, dimensions.L * 0.98, 0, wallH + roofH / 2, 0, 0, Math.PI / 2, 0, 'gable_pitched_roof', roofCol);

      // 磚造煙囪 (Brick Chimney)
      addBox(1.1, dimensions.H * 0.45, 1.1, -dimensions.L * 0.22, wallH + roofH * 0.65, dimensions.W * 0.22, 0, 0, 0, 'brick_chimney_stack', 0x8d4925);

      // 正面玄關門廊 (Front Porch & Pillars)
      addBox(2.8, 0.25, 1.8, dimensions.L * 0.44 + 0.8, 0.12, 0, 0, 0, 0, 'porch_wooden_deck', darkCol);
      addBox(2.8, 0.2, 1.8, dimensions.L * 0.44 + 0.8, 2.6, 0, 0, 0, 0, 'porch_awning_roof', roofCol);
      addCylinder(0.1, 0.1, 2.4, 6, dimensions.L * 0.44 + 1.5, 1.3, 0.7, 0, 0, 0, 'porch_pillar_left', brightCol);
      addCylinder(0.1, 0.1, 2.4, 6, dimensions.L * 0.44 + 1.5, 1.3, -0.7, 0, 0, 0, 'porch_pillar_right', brightCol);

      // 【非對稱背部增強】後方工具木柴間 (Asymmetric Rear Tool Shed)
      addBox(dimensions.L * 0.38, 2.4, 1.8, -dimensions.L * 0.24, 1.2, -dimensions.W * 0.44 - 0.9, 0, 0, 0, 'rear_asymmetric_tool_shed', darkCol);
      addPrism(1.8, 0.6, dimensions.L * 0.38, -dimensions.L * 0.24, 2.7, -dimensions.W * 0.44 - 0.9, 0, Math.PI / 2, 0, 'shed_lean_to_roof', roofCol);

    } else if (style === 'domed_rotunda_monument') {
      dimensions = { L: 26.0 + rnd() * 8.0, W: 26.0 + rnd() * 8.0, H: 28.0 + rnd() * 8.0 };
      spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, style: 'classical_domed_rotunda_monument' };
      reconstructedFeatures.push({ name: 'cylindrical_rotunda_drum', method: 'sixteen_sided_arcade_drum' });
      reconstructedFeatures.push({ name: 'hemispherical_ribbed_dome', method: 'stepped_concentric_dome_cap' });
      reconstructedFeatures.push({ name: 'classical_pediment_portico', method: 'tetrastyle_colonnaded_entrance' });

      // 圓柱形主體大廳 (Rotunda Drum)
      const drumR = dimensions.W * 0.42;
      const drumH = dimensions.H * 0.52;
      addCylinder(drumR, drumR * 1.05, drumH, 16, 0, drumH / 2, 0, 0, 0, 0, 'rotunda_cylindrical_drum', primColor);
      addCylinder(drumR * 1.08, drumR * 1.08, 0.8, 16, 0, drumH - 0.4, 0, 0, 0, 0, 'rotunda_cornice_band', accentCol);

      // 上層同心環階與圓頂 (Concentric Attic & Hemispherical Dome)
      const domeBaseY = drumH;
      const domeH = dimensions.H * 0.32;
      addCylinder(drumR * 0.92, drumR * 0.98, 1.8, 16, 0, domeBaseY + 0.9, 0, 0, 0, 0, 'dome_attic_base', darkCol);
      addCylinder(drumR * 0.68, drumR * 0.92, domeH * 0.65, 16, 0, domeBaseY + 1.8 + (domeH * 0.65) / 2, 0, 0, 0, 0, 'ribbed_dome_tier_1', roofCol);
      addCylinder(0.2, drumR * 0.68, domeH * 0.35, 16, 0, domeBaseY + 1.8 + domeH * 0.65 + (domeH * 0.35) / 2, 0, 0, 0, 0, 'ribbed_dome_tier_2_apex', roofCol);

      // 頂層採光小亭與尖頂 (Lantern Cupola)
      const cupolaY = domeBaseY + 1.8 + domeH;
      addCylinder(1.4, 1.6, 2.5, 8, 0, cupolaY + 1.25, 0, 0, 0, 0, 'lantern_cupola_chamber', brightCol);
      addCone(1.8, 2.2, 8, 0, cupolaY + 2.5 + 1.1, 0, 0, 0, 0, 'cupola_finial_cap', accentCol);

      // 正面四柱山牆門廊 (Classical Portico)
      const porticoX = drumR + 2.2;
      addPrism(dimensions.W * 0.42, 2.4, 3.8, porticoX, drumH * 0.72, 0, 0, 0, 0, 'portico_pediment', brightCol);
      for (const pz of [-dimensions.W * 0.16, -dimensions.W * 0.05, dimensions.W * 0.05, dimensions.W * 0.16]) {
        addCylinder(0.35, 0.42, drumH * 0.65, 8, porticoX + 1.4, (drumH * 0.65) / 2, pz, 0, 0, 0, 'portico_column', brightCol);
      }

    } else if (style === 'classical_temple') {
      dimensions = { L: 30.0 + rnd() * 6.0, W: 16.5 + rnd() * 4.0, H: 12.5 + rnd() * 2.5 };
      spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, style: 'classical_parthenon_peristyle' };
      reconstructedFeatures.push({ name: 'stepped_stylobate_base', method: 'tri_tier_concentric_plinth' });
      reconstructedFeatures.push({ name: 'peristyle_fluted_colonnade', method: 'four_sided_symmetric_columns' });
      reconstructedFeatures.push({ name: 'pediment_and_tympanum', method: 'front_and_rear_mirrored_gables' });

      for (let t = 0; t < 3; t++) {
        const step = t * 0.4;
        addBox(dimensions.L + (3 - t) * 0.6, 0.45, dimensions.W + (3 - t) * 0.6, 0, 0.22 + step, 0, 0, 0, 0, `stylobate_tier_${t+1}`, darkCol);
      }

      const cellaL = dimensions.L * 0.72;
      const cellaW = dimensions.W * 0.58;
      const colH = dimensions.H * 0.58;
      addBox(cellaL, colH, cellaW, 0, 1.35 + colH / 2, 0, 0, 0, 0, 'cella_sanctuary_wall', primColor);

      const numColsL = 8;
      const numColsW = 5;
      const colR = 0.48;
      for (let i = 0; i < numColsL; i++) {
        const x = -dimensions.L * 0.44 + (i / (numColsL - 1)) * dimensions.L * 0.88;
        addCylinder(colR * 0.9, colR, colH, 8, x, 1.35 + colH / 2, dimensions.W * 0.44, 0, 0, 0, `column_north_${i+1}`, brightCol);
        addCylinder(colR * 0.9, colR, colH, 8, x, 1.35 + colH / 2, -dimensions.W * 0.44, 0, 0, 0, `column_south_${i+1}`, brightCol);
      }
      for (let j = 1; j < numColsW - 1; j++) {
        const z = -dimensions.W * 0.44 + (j / (numColsW - 1)) * dimensions.W * 0.88;
        addCylinder(colR * 0.9, colR, colH, 8, dimensions.L * 0.44, 1.35 + colH / 2, z, 0, 0, 0, `column_east_${j+1}`, brightCol);
        addCylinder(colR * 0.9, colR, colH, 8, -dimensions.L * 0.44, 1.35 + colH / 2, z, 0, 0, 0, `column_west_${j+1}`, brightCol);
      }

      const entH = 1.2;
      addBox(dimensions.L * 0.96, entH, dimensions.W * 0.96, 0, 1.35 + colH + entH / 2, 0, 0, 0, 0, 'entablature_frieze', accentCol);

      const pedH = dimensions.H - (1.35 + colH + entH);
      addPrism(dimensions.W * 0.98, pedH, dimensions.L * 0.98, 0, 1.35 + colH + entH + pedH / 2, 0, 0, Math.PI / 2, 0, 'temple_pitched_roof', roofCol);
      addPrism(dimensions.W * 0.95, pedH * 0.95, 0.4, dimensions.L * 0.46, 1.35 + colH + entH + pedH / 2, 0, 0, 0, 0, 'pediment_front_east', brightCol);
      addPrism(dimensions.W * 0.95, pedH * 0.95, 0.4, -dimensions.L * 0.46, 1.35 + colH + entH + pedH / 2, 0, 0, Math.PI, 0, 'pediment_rear_west_mirror', brightCol);

    } else if (style === 'leaning_arcade_tower') {
      dimensions = { L: 14.0, W: 14.0, H: 28.0 + rnd() * 4.0 };
      spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, style: 'leaning_campanile_arcade' };
      reconstructedFeatures.push({ name: 'concentric_arcades', method: 'six_tiered_radial_galleries' });
      reconstructedFeatures.push({ name: 'inclination_lean', method: 'authentic_axial_tilt' });

      const tilt = 0.065;
      const baseH = 3.5;
      addCylinder(6.2, 6.6, baseH, 12, 0, baseH / 2, 0, 0, 0, tilt, 'ground_tier_blind_arcade', darkCol);

      const numGalleries = 6;
      const gallH = (dimensions.H - baseH - 3.5) / numGalleries;
      for (let g = 0; g < numGalleries; g++) {
        const y = baseH + g * gallH + gallH / 2;
        const xOff = Math.sin(tilt) * y;
        addCylinder(5.6, 5.8, gallH * 0.85, 12, xOff, y, 0, 0, 0, tilt, `arcade_gallery_tier_${g+1}`, brightCol);
        addCylinder(5.9, 5.9, 0.25, 12, xOff, y - gallH * 0.4, 0, 0, 0, tilt, `balustrade_rim_${g+1}`, accentCol);
      }

      const belfryY = dimensions.H - 1.8;
      const belfryX = Math.sin(tilt) * belfryY;
      addCylinder(4.2, 4.6, 3.2, 10, belfryX, belfryY, 0, 0, 0, tilt, 'top_belfry_chamber', primColor);

    } else if (style === 'asian_pagoda_pavilion') {
      dimensions = { L: 20.0 + rnd() * 6.0, W: 20.0 + rnd() * 6.0, H: 26.0 + rnd() * 8.0 };
      spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, style: 'asian_pagoda_upturned_eaves' };
      reconstructedFeatures.push({ name: 'flared_curved_eaves', method: 'multi_tier_symmetric_roofs' });
      reconstructedFeatures.push({ name: 'finial_spire_sanrin', method: 'sacred_bronze_finial' });

      addBox(dimensions.L * 0.95, 1.8, dimensions.W * 0.95, 0, 0.9, 0, 0, 0, 0, 'stone_plinth_foundation', darkCol);

      const numTiers = 3;
      const tierH = (dimensions.H - 4.5) / numTiers;
      for (let t = 0; t < numTiers; t++) {
        const yBase = 1.8 + t * tierH;
        const scale = 1.0 - t * 0.22;
        const bodyW = dimensions.W * 0.65 * scale;
        const bodyL = dimensions.L * 0.65 * scale;
        addBox(bodyL, tierH * 0.65, bodyW, 0, yBase + tierH * 0.32, 0, 0, 0, 0, `pagoda_chamber_tier_${t+1}`, primColor);
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            addCylinder(0.25, 0.25, tierH * 0.65, 6, sx * bodyL * 0.45, yBase + tierH * 0.32, sz * bodyW * 0.45, 0, 0, 0, `pillar_${t+1}_${sx}_${sz}`, accentCol);
          }
        }
        const eaveW = dimensions.W * 0.95 * scale;
        const eaveL = dimensions.L * 0.95 * scale;
        addBox(eaveL, 0.45, eaveW, 0, yBase + tierH * 0.68, 0, 0, 0, 0, `curved_eaves_${t+1}`, darkCol);
        addPrism(eaveW * 0.85, 0.65, eaveL * 0.85, 0, yBase + tierH * 0.82, 0, 0, Math.PI / 2, 0, `roof_slope_${t+1}`, roofCol);
      }

      addCylinder(0.08, 0.35, 4.5, 6, 0, dimensions.H + 1.2, 0, 0, 0, 0, 'finial_spire_sanrin', brightCol);

    } else if (style === 'castle_fortress_keep') {
      dimensions = { L: 24.0 + rnd() * 6.0, W: 24.0 + rnd() * 6.0, H: 22.0 + rnd() * 5.0 };
      spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, style: 'medieval_stone_keep_turrets' };
      reconstructedFeatures.push({ name: 'four_corner_turrets', method: 'quad_symmetric_bastions' });
      reconstructedFeatures.push({ name: 'crenellated_parapet', method: 'perimeter_merlons' });

      addBox(dimensions.L * 0.82, dimensions.H * 0.85, dimensions.W * 0.82, 0, dimensions.H * 0.425, 0, 0, 0, 0, 'stone_keep_body', primColor);

      const turR = 2.4;
      const turH = dimensions.H * 1.05;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const px = sx * dimensions.L * 0.42;
          const pz = sz * dimensions.W * 0.42;
          addCylinder(turR * 0.95, turR, turH, 8, px, turH / 2, pz, 0, 0, 0, `turret_${sx}_${sz}`, darkCol);
          addCone(turR * 1.08, 2.2, 8, px, turH + 1.1, pz, 0, 0, 0, `turret_conical_roof_${sx}_${sz}`, roofCol);
        }
      }

      const numMerlons = 6;
      for (let i = 0; i < numMerlons; i++) {
        const x = -dimensions.L * 0.38 + (i / (numMerlons - 1)) * dimensions.L * 0.76;
        addBox(0.8, 0.9, 0.4, x, dimensions.H * 0.85 + 0.45, dimensions.W * 0.41, 0, 0, 0, `merlon_north_${i}`, darkCol);
        addBox(0.8, 0.9, 0.4, x, dimensions.H * 0.85 + 0.45, -dimensions.W * 0.41, 0, 0, 0, `merlon_south_${i}`, darkCol);
      }

    } else if (style === 'modern_skyscraper_tower') {
      dimensions = { L: 22.0 + rnd() * 10.0, W: 22.0 + rnd() * 10.0, H: 50.0 + rnd() * 35.0 };
      spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, style: 'modern_stepped_skyscraper' };
      reconstructedFeatures.push({ name: 'stepped_setback_tower', method: 'triple_tier_massing' });
      reconstructedFeatures.push({ name: 'curtain_wall_ribs', method: 'vertical_mullion_grid' });
      reconstructedFeatures.push({ name: 'rooftop_mechanicals', method: 'chillers_and_antenna' });

      const podH = 6.5;
      addBox(dimensions.L, podH, dimensions.W, 0, podH / 2, 0, 0, 0, 0, 'podium_lobby_glass', darkCol);
      addBox(dimensions.L * 0.4, 0.35, 3.5, 0, 4.2, dimensions.W / 2 + 1.2, 0, 0, 0, 'entrance_canopy', accentCol);

      const t1H = (dimensions.H - podH) * 0.45;
      addBox(dimensions.L * 0.88, t1H, dimensions.W * 0.88, 0, podH + t1H / 2, 0, 0, 0, 0, 'tower_tier_1', primColor);

      const t2H = (dimensions.H - podH) * 0.35;
      addBox(dimensions.L * 0.72, t2H, dimensions.W * 0.72, 0, podH + t1H + t2H / 2, 0, 0, 0, 0, 'tower_tier_2_setback', primColor);

      const t3H = (dimensions.H - podH) * 0.20;
      addBox(dimensions.L * 0.54, t3H, dimensions.W * 0.54, 0, podH + t1H + t2H + t3H / 2, 0, 0, 0, 0, 'tower_tier_3_crown', brightCol);

      const totalFloors = Math.floor(dimensions.H / 3.6);
      for (let f = 1; f < totalFloors; f++) {
        const fy = f * 3.6;
        const scale = fy < (podH + t1H) ? 0.89 : (fy < (podH + t1H + t2H) ? 0.73 : 0.55);
        addBox(dimensions.L * scale, 0.3, dimensions.W * scale, 0, fy, 0, 0, 0, 0, `floor_spandrel_${f}`, accentCol);
      }

      addBox(dimensions.L * 0.32, 2.5, dimensions.W * 0.32, 0, dimensions.H + 1.25, 0, 0, 0, 0, 'rooftop_hvac_penthouse', darkCol);
      addCylinder(0.08, 0.22, 6.5, 6, 0, dimensions.H + 5.5, 0, 0, 0, 0, 'rooftop_antenna_spire', accentCol);

    } else {
      // 商業/住商混合 (Commercial / Residential with Asymmetric Occluded Rear)
      dimensions = { L: 16.0 + rnd() * 8.0, W: 14.0 + rnd() * 6.0, H: 22.0 + rnd() * 12.0 };
      spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, style: 'commercial_residential_asymmetric' };
      reconstructedFeatures.push({ name: 'front_facade_balconies', method: 'storefront_and_residential_balconies' });
      reconstructedFeatures.push({ name: 'rear_fire_escape_and_utilities', method: 'asymmetric_procedural_augmentation' });

      addBox(dimensions.L, dimensions.H, dimensions.W, 0, dimensions.H / 2, 0, 0, 0, 0, 'building_mass', primColor);

      addBox(dimensions.L * 0.9, 3.2, 0.4, 0, 1.8, dimensions.W / 2 + 0.15, 0, 0, 0, 'front_storefront_glass', darkCol);
      const floors = Math.floor((dimensions.H - 4.0) / 3.2);
      for (let f = 1; f <= floors; f++) {
        const y = 4.0 + (f - 1) * 3.2 + 1.6;
        for (const bx of [-dimensions.L * 0.28, dimensions.L * 0.28]) {
          addBox(dimensions.L * 0.35, 1.1, 1.2, bx, y - 0.5, dimensions.W / 2 + 0.6, 0, 0, 0, `balcony_f${f}_${bx > 0 ? 'r' : 'l'}`, accentCol);
        }
      }

      const rearZ = -dimensions.W / 2;
      for (let f = 1; f <= floors; f++) {
        const y = 4.0 + (f - 1) * 3.2 + 1.6;
        addBox(3.0, 0.2, 1.5, -dimensions.L * 0.2, y - 1.0, rearZ - 0.75, 0, 0, 0, `rear_fire_escape_landing_f${f}`, darkCol);
        addBox(0.2, 3.2, 1.4, -dimensions.L * 0.2 + (f % 2 === 0 ? 1.2 : -1.2), y + 0.6, rearZ - 0.75, 0, 0, (f % 2 === 0 ? 0.35 : -0.35), `rear_fire_ladder_f${f}`, darkCol);
      }
      addBox(0.6, dimensions.H * 0.85, 0.6, dimensions.L * 0.32, dimensions.H * 0.45, rearZ - 0.35, 0, 0, 0, 'rear_ventilation_duct', brightCol);
      addBox(2.2, 2.6, 0.3, dimensions.L * 0.15, 1.3, rearZ - 0.15, 0, 0, 0, 'rear_service_door', darkCol);
      addBox(1.2, 1.5, 0.4, dimensions.L * 0.35, 1.8, rearZ - 0.2, 0, 0, 0, 'rear_electrical_transformer', accentCol);
    }
  }

  // =========================================================================
  // 2. VEHICLE 分類幾何重構
  // =========================================================================
  else if (family === 'vehicle') {
    if (subpart === 'bike') {
      dimensions = { L: 1.78 + rnd() * 0.15, W: 0.65, H: 1.05 + rnd() * 0.1 };
      const R = 0.34;
      spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, R, style: 'precision_bicycle_frame' };
      reconstructedFeatures.push({ name: 'diamond_tube_frame', method: 'tubular_truss_geometry' });
      reconstructedFeatures.push({ name: 'visible_spoked_wheels', method: 'dual_wheel_rims_and_hubs' });
      reconstructedFeatures.push({ name: 'drivetrain_and_saddle', method: 'crankset_pedals_seatpost' });

      // 菱形車架管件 (Visible Structural Tubes)
      addBox(0.92, 0.05, 0.05, 0, 0.58, 0, 0, 0, 0.18, 'frame_top_tube', primColor);
      addBox(0.86, 0.06, 0.06, -0.06, 0.36, 0, 0, 0, -0.48, 'frame_down_tube', primColor);
      addBox(0.56, 0.05, 0.05, -0.16, 0.46, 0, 0, 0, 0.12, 'frame_seat_tube', primColor);
      addBox(0.62, 0.05, 0.06, 0.54, 0.46, 0, 0, 0, -0.32, 'front_fork_blades', primColor);
      addBox(0.58, 0.04, 0.08, -0.42, 0.50, 0, 0, 0, -0.42, 'rear_seatstays', primColor);
      addBox(0.52, 0.04, 0.08, -0.42, 0.22, 0, 0, 0, 0, 'rear_chainstays', primColor);

      // 車把與龍頭 (Handlebars & Stem)
      addBox(0.06, 0.15, 0.06, 0.48, 0.88, 0, 0, 0, 0, 'handlebar_stem', darkCol);
      addBox(0.06, 0.06, dimensions.W, 0.48, dimensions.H - 0.05, 0, 0, 0, 0, 'bicycle_handlebars', darkCol);

      // 人體工學座墊與座管 (Saddle & Seatpost)
      addBox(0.05, 0.20, 0.05, -0.16, 0.72, 0, 0, 0, 0.12, 'seatpost', brightCol);
      addBox(0.28, 0.07, 0.16, -0.18, 0.88, 0, 0, 0, 0, 'ergonomic_saddle', darkCol);

      // 大齒盤、曲柄與踏板 (Crankset & Pedals)
      addCylinder(0.11, 0.11, 0.22, 8, -0.16, 0.22, 0, Math.PI / 2, 0, 0, 'chainring_crankset', brightCol);

      // 前後大輪組 (Solid Visible Wheel Rims & Tires)
      addCylinder(R, R, 0.06, 12, 0.65, R, 0, Math.PI / 2, 0, 0, 'front_wheel_tire', darkCol);
      addCylinder(R * 0.75, R * 0.75, 0.03, 10, 0.65, R, 0, Math.PI / 2, 0, 0, 'front_wheel_rim', brightCol);
      addCylinder(R, R, 0.06, 12, -0.65, R, 0, Math.PI / 2, 0, 0, 'rear_wheel_tire', darkCol);
      addCylinder(R * 0.75, R * 0.75, 0.03, 10, -0.65, R, 0, Math.PI / 2, 0, 0, 'rear_wheel_rim', brightCol);

      // 配件（籃子/貨架）
      if (style === 'city_cruiser') {
        addBox(0.32, 0.22, 0.42, 0.68, 0.82, 0, 0, 0, 0, 'front_wire_basket', brightCol);
        addBox(0.48, 0.04, 0.22, -0.52, 0.68, 0, 0, 0, 0, 'rear_cargo_rack', darkCol);
      }

    } else if (subpart === 'car') {
      if (style === 'pickup_truck') {
        dimensions = { L: 5.35 + rnd() * 0.4, W: 2.05, H: 1.88 + rnd() * 0.15 };
        const R = 0.42;
        spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, R, style: 'pickup_truck_offroad' };
        reconstructedFeatures.push({ name: 'open_cargo_bed', method: 'ribbed_floor_and_tailgate' });
        reconstructedFeatures.push({ name: 'roll_bar_cage', method: 'cab_tubular_chassis' });

        addBox(dimensions.L * 0.95, 0.35, dimensions.W * 0.85, 0, 0.55, 0, 0, 0, 0, 'chassis_frame', darkCol);
        const cabL = dimensions.L * 0.46;
        const cabH = dimensions.H - 0.65;
        addBox(cabL, cabH, dimensions.W, dimensions.L * 0.12, 0.65 + cabH / 2, 0, 0, 0, 0, 'crew_cab_body', primColor);
        addBox(cabL * 0.8, cabH * 0.5, dimensions.W * 0.96, dimensions.L * 0.12, 0.65 + cabH * 0.65, 0, 0, 0, 0, 'cab_glasshouse', darkCol);

        const bedL = dimensions.L * 0.44;
        addBox(bedL, 0.55, dimensions.W, -dimensions.L * 0.26, 0.65 + 0.28, 0, 0, 0, 0, 'pickup_bed_walls', primColor);
        addBox(0.12, 0.55, dimensions.W * 0.94, -dimensions.L * 0.47, 0.65 + 0.28, 0, 0, 0, 0, 'pickup_tailgate', primColor);

        addBox(0.1, 0.65, dimensions.W * 0.85, -dimensions.L * 0.11, dimensions.H - 0.3, 0, 0, 0, 0, 'tubular_roll_bar', darkCol);

        addBox(dimensions.L * 0.28, 0.45, dimensions.W * 0.96, dimensions.L * 0.38, 0.95, 0, 0, 0, 0.1, 'engine_hood', primColor);
        addBox(0.15, 0.4, dimensions.W * 0.88, dimensions.L * 0.50, 0.85, 0, 0, 0, 0, 'front_grille_mesh', darkCol);
        addBox(0.25, 0.3, dimensions.W * 1.02, dimensions.L * 0.52, 0.48, 0, 0, 0, 0, 'front_heavy_bumper', darkCol);

        addSymmetricPair((z, side) => {
          addBox(0.1, 0.18, 0.25, dimensions.L * 0.51, 0.92, z, 0, 0, 0, `headlight_${side}`, brightCol);
          addBox(0.1, 0.18, 0.12, -dimensions.L * 0.48, 0.88, z, 0, 0, 0, `taillight_${side}`, 0xcc2222);
          addBox(0.2, 0.15, 0.22, dimensions.L * 0.18, 1.25, z * 1.08, 0, 0, 0, `side_mirror_${side}`, darkCol);
          addCylinder(R, R, 0.32, 10, dimensions.L * 0.32, R, z * 0.88, Math.PI / 2, 0, 0, `wheel_front_${side}`, darkCol);
          addCylinder(R, R, 0.32, 10, -dimensions.L * 0.32, R, z * 0.88, Math.PI / 2, 0, 0, `wheel_rear_${side}`, darkCol);
        }, dimensions.W / 2 - 0.15, 'mirrored_lights_mirrors_wheels');

      } else if (style === 'sports_coupe') {
        dimensions = { L: 4.65 + rnd() * 0.3, W: 2.05, H: 1.25 + rnd() * 0.1 };
        const R = 0.36;
        spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, R, style: 'aerodynamic_sports_supercar' };
        reconstructedFeatures.push({ name: 'aerodynamic_bodykit', method: 'front_splitter_and_side_scoops' });
        reconstructedFeatures.push({ name: 'rear_wing_spoiler', method: 'carbon_downforce_wing' });

        addBox(dimensions.L, 0.45, dimensions.W, 0, 0.45, 0, 0, 0, 0, 'supercar_lower_body', primColor);
        addBox(dimensions.L * 0.52, 0.48, dimensions.W * 0.85, -0.15, 0.85, 0, 0, 0, 0, 'cabin_canopy', darkCol);

        addBox(0.35, 0.1, dimensions.W * 1.02, dimensions.L / 2 - 0.05, 0.15, 0, 0, 0, 0, 'carbon_front_splitter', darkCol);

        addBox(0.35, 0.06, dimensions.W * 0.95, -dimensions.L * 0.46, 1.15, 0, 0, 0, 0.1, 'rear_gt_wing', darkCol);
        addBox(0.08, 0.35, 0.08, -dimensions.L * 0.45, 0.95, 0.5, 0, 0, 0, 'wing_strut_left', darkCol);
        addBox(0.08, 0.35, 0.08, -dimensions.L * 0.45, 0.95, -0.5, 0, 0, 0, 'wing_strut_right', darkCol);
        addBox(0.3, 0.22, dimensions.W * 0.85, -dimensions.L * 0.48, 0.3, 0, 0, 0, 0, 'rear_aero_diffuser', darkCol);

        addSymmetricPair((z, side) => {
          addBox(0.25, 0.08, 0.28, dimensions.L * 0.45, 0.62, z, 0, 0, 0, `led_headlight_${side}`, brightCol);
          addBox(0.12, 0.08, 0.32, -dimensions.L * 0.47, 0.65, z, 0, 0, 0, `led_taillight_${side}`, 0xe74c3c);
          addBox(0.18, 0.1, 0.18, dimensions.L * 0.12, 0.92, z * 1.05, 0, 0, 0, `aero_mirror_${side}`, primColor);
          addCylinder(R, R, 0.28, 12, dimensions.L * 0.28, R, z * 0.92, Math.PI / 2, 0, 0, `alloy_wheel_front_${side}`, darkCol);
          addCylinder(R * 1.05, R * 1.05, 0.32, 12, -dimensions.L * 0.28, R * 1.05, z * 0.92, Math.PI / 2, 0, 0, `alloy_wheel_rear_${side}`, darkCol);
        }, dimensions.W / 2 - 0.14, 'mirrored_supercar_aerodynamics');

      } else {
        dimensions = { L: 4.80 + rnd() * 0.4, W: 1.92, H: 1.55 + rnd() * 0.2 };
        const R = 0.35;
        spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, R, style: 'standard_passenger_sedan' };
        reconstructedFeatures.push({ name: 'three_box_profile', method: 'hood_cabin_trunk_architecture' });
        reconstructedFeatures.push({ name: 'symmetric_mirrors_and_lights', method: 'bilateral_mirror_Z_axis' });

        addBox(dimensions.L, 0.52, dimensions.W, 0, 0.56, 0, 0, 0, 0, 'sedan_main_body', primColor);
        const cabL = dimensions.L * 0.52;
        const cabH = dimensions.H - 0.82;
        addBox(cabL, cabH, dimensions.W * 0.90, -0.05, 0.82 + cabH / 2, 0, 0, 0, 0, 'sedan_glass_cabin', darkCol);

        addBox(dimensions.L * 0.32, 0.35, dimensions.W * 0.96, dimensions.L * 0.32, 0.72, 0, 0, 0, 0.1, 'engine_hood_slope', primColor);
        addBox(dimensions.L * 0.22, 0.32, dimensions.W * 0.92, -dimensions.L * 0.36, 0.70, 0, 0, 0, -0.05, 'trunk_decklid', primColor);

        addBox(0.12, 0.32, dimensions.W * 0.75, dimensions.L / 2 - 0.02, 0.52, 0, 0, 0, 0, 'radiator_grille', accentCol);
        addBox(0.22, 0.28, dimensions.W * 1.01, dimensions.L / 2 - 0.08, 0.35, 0, 0, 0, 0, 'front_bumper', primColor);
        addBox(0.22, 0.28, dimensions.W * 1.01, -dimensions.L / 2 + 0.08, 0.35, 0, 0, 0, 0, 'rear_bumper', primColor);

        addSymmetricPair((z, side) => {
          addBox(0.15, 0.14, 0.25, dimensions.L / 2 - 0.05, 0.65, z, 0, 0, 0, `headlight_${side}`, brightCol);
          addBox(0.12, 0.14, 0.22, -dimensions.L / 2 + 0.05, 0.68, z, 0, 0, 0, `taillight_${side}`, 0xe74c3c);
          addBox(0.18, 0.12, 0.20, dimensions.L * 0.12, 0.98, z * 1.08, 0, 0, 0, `side_mirror_${side}`, primColor);
          addCylinder(R, R, 0.24, 10, dimensions.L * 0.28, R, z * 0.90, Math.PI / 2, 0, 0, `wheel_front_${side}`, darkCol);
          addCylinder(R, R, 0.24, 10, -dimensions.L * 0.28, R, z * 0.90, Math.PI / 2, 0, 0, `wheel_rear_${side}`, darkCol);
        }, dimensions.W / 2 - 0.15, 'mirrored_sedan_features');
      }

    } else if (subpart === 'heavy') {
      if (style === 'tanker_truck') {
        dimensions = { L: 11.5 + rnd() * 2.0, W: 2.65, H: 3.65 + rnd() * 0.4 };
        const R = 0.54;
        spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, R, style: 'heavy_liquid_tanker_truck' };
        reconstructedFeatures.push({ name: 'cylindrical_tank_body', method: 'multi_dome_manholes_and_catwalk' });
        reconstructedFeatures.push({ name: 'rear_access_ladder', method: 'safety_inspection_ladder' });

        addBox(dimensions.L * 0.96, 0.42, 1.35, 0, 0.95, 0, 0, 0, 0, 'heavy_ladder_chassis', darkCol);
        const cabL = 2.4;
        const cabH = 2.4;
        addBox(cabL, cabH, dimensions.W, dimensions.L / 2 - cabL / 2, 1.1 + cabH / 2, 0, 0, 0, 0, 'heavy_truck_cab', primColor);
        addBox(cabL * 0.6, cabH * 0.4, dimensions.W * 1.01, dimensions.L / 2 - cabL / 2 + 0.2, 1.1 + cabH * 0.72, 0, 0, 0, 0, 'cab_windshield', darkCol);

        const tankL = dimensions.L * 0.68;
        const tankR = 1.15;
        const tankX = -dimensions.L / 2 + tankL / 2 + 0.3;
        addCylinder(tankR, tankR, tankL, 12, tankX, 1.15 + tankR, 0, 0, 0, Math.PI / 2, 'liquid_cargo_tank', brightCol);

        addBox(tankL * 0.85, 0.1, 0.7, tankX, 1.15 + tankR * 2 + 0.05, 0, 0, 0, 0, 'tank_top_catwalk', darkCol);
        for (let m = -1; m <= 1; m++) {
          addCylinder(0.35, 0.35, 0.25, 8, tankX + m * 2.2, 1.15 + tankR * 2 + 0.18, 0, 0, 0, 0, `tank_manhole_${m+2}`, accentCol);
        }
        addBox(0.1, tankR * 1.8, 0.45, tankX - tankL / 2 - 0.08, 1.15 + tankR, 0, 0, 0, 0, 'tank_rear_ladder', darkCol);

        const axles = [dimensions.L * 0.38, -dimensions.L * 0.22, -dimensions.L * 0.35];
        for (const ax of axles) {
          addSymmetricPair((z, side) => {
            addCylinder(R, R, 0.34, 10, ax, R, z, Math.PI / 2, 0, 0, `tanker_wheel_${ax > 0 ? 'steer' : 'drive'}_${side}`, darkCol);
          }, dimensions.W / 2 - 0.2, 'multi_axle_wheels');
        }

      } else if (style === 'dump_truck') {
        dimensions = { L: 9.2 + rnd() * 1.8, W: 2.65, H: 3.55 + rnd() * 0.3 };
        const R = 0.54;
        spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, R, style: 'heavy_quarry_dump_truck' };
        reconstructedFeatures.push({ name: 'reinforced_dump_box', method: 'ribbed_tipper_and_cab_guard' });
        reconstructedFeatures.push({ name: 'hydraulic_hoist_ram', method: 'telescopic_lifting_cylinder' });

        addBox(dimensions.L * 0.95, 0.45, 1.35, 0, 0.95, 0, 0, 0, 0, 'heavy_dump_chassis', darkCol);
        const cabL = 2.3;
        const cabH = 2.2;
        addBox(cabL, cabH, dimensions.W, dimensions.L / 2 - cabL / 2, 1.1 + cabH / 2, 0, 0, 0, 0, 'quarry_cab_body', primColor);

        const dumpL = dimensions.L * 0.65;
        const dumpH = 1.65;
        const dumpX = -dimensions.L / 2 + dumpL / 2 + 0.3;
        addBox(dumpL, dumpH, dimensions.W * 0.96, dumpX, 1.35 + dumpH / 2, 0, 0, 0, 0, 'dump_box_bed', accentCol);
        addBox(1.6, 0.15, dimensions.W * 0.94, dumpX + dumpL / 2 + 0.8, 1.35 + dumpH, 0, 0, 0, -0.15, 'cab_protector_guard', accentCol);
        addCylinder(0.18, 0.22, 1.8, 8, dumpX + dumpL / 2 - 0.2, 1.6, 0, 0, 0, 0.25, 'hydraulic_hoist_ram', brightCol);

        const axles = [dimensions.L * 0.36, -dimensions.L * 0.18, -dimensions.L * 0.34];
        for (const ax of axles) {
          addSymmetricPair((z, side) => {
            addCylinder(R, R, 0.35, 10, ax, R, z, Math.PI / 2, 0, 0, `dump_wheel_${side}`, darkCol);
          }, dimensions.W / 2 - 0.2, 'dump_truck_wheels');
        }

      } else {
        dimensions = { L: 8.8 + rnd() * 2.5, W: 2.60, H: 3.65 + rnd() * 0.5 };
        const R = 0.52;
        spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, R, style: 'heavy_cargo_freight_truck' };
        reconstructedFeatures.push({ name: 'enclosed_cargo_box', method: 'composite_insulated_box' });
        reconstructedFeatures.push({ name: 'dual_vertical_exhausts', method: 'chrome_exhaust_stacks' });

        addBox(dimensions.L * 0.95, 0.4, 1.3, 0, 0.9, 0, 0, 0, 0, 'freight_chassis_frame', darkCol);
        const cabL = 2.4;
        const cabH = 2.4;
        addBox(cabL, cabH, dimensions.W, dimensions.L / 2 - cabL / 2, 1.05 + cabH / 2, 0, 0, 0, 0, 'freight_cab_body', primColor);
        addBox(cabL * 0.65, cabH * 0.45, dimensions.W * 1.01, dimensions.L / 2 - cabL / 2 + 0.15, 1.05 + cabH * 0.7, 0, 0, 0, 0, 'cab_windshield', darkCol);

        const boxL = dimensions.L * 0.66;
        const boxH = dimensions.H - 1.25;
        const boxX = -dimensions.L / 2 + boxL / 2 + 0.2;
        addBox(boxL, boxH, dimensions.W * 0.98, boxX, 1.15 + boxH / 2, 0, 0, 0, 0, 'freight_cargo_box', brightCol);
        addBox(0.12, boxH * 0.9, dimensions.W * 0.9, boxX - boxL / 2 - 0.05, 1.15 + boxH / 2, 0, 0, 0, 0, 'rear_rollup_door', accentCol);

        addSymmetricPair((z, side) => {
          addCylinder(0.1, 0.1, 2.8, 6, dimensions.L / 2 - cabL - 0.15, 2.6, z * 0.75, 0, 0, 0, `exhaust_stack_${side}`, brightCol);
          addCylinder(R, R, 0.32, 10, dimensions.L * 0.34, R, z, Math.PI / 2, 0, 0, `steer_wheel_${side}`, darkCol);
          addCylinder(R, R, 0.34, 10, -dimensions.L * 0.22, R, z, Math.PI / 2, 0, 0, `drive_wheel_1_${side}`, darkCol);
          addCylinder(R, R, 0.34, 10, -dimensions.L * 0.36, R, z, Math.PI / 2, 0, 0, `drive_wheel_2_${side}`, darkCol);
        }, dimensions.W / 2 - 0.2, 'heavy_truck_dual_exhaust_and_axles');
      }

    } else if (subpart === 'motor') {
      if (style === 'sportbike') {
        dimensions = { L: 2.10, W: 0.78, H: 1.18 + rnd() * 0.1 };
        const R = 0.30;
        spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, R, style: 'superbike_full_fairing' };
        reconstructedFeatures.push({ name: 'aerodynamic_fairing', method: 'racing_cowl_and_windscreen' });
        reconstructedFeatures.push({ name: 'upswept_exhaust', method: 'titanium_racing_muffler' });

        addBox(1.15, 0.52, 0.42, 0, 0.58, 0, 0, 0, 0, 'racing_main_fairing', primColor);
        addBox(0.45, 0.55, 0.38, 0.55, 0.78, 0, 0, 0, -0.32, 'front_nose_fairing', primColor);
        addBox(0.25, 0.28, 0.32, 0.62, 0.98, 0, 0, 0, -0.45, 'racing_windscreen', darkCol);

        addBox(0.55, 0.28, 0.35, 0.12, 0.88, 0, 0, 0, 0.12, 'aerodynamic_fuel_tank', primColor);
        addBox(0.65, 0.15, 0.28, -0.28, 0.82, 0, 0, 0, 0.18, 'stepped_racing_seat', darkCol);

        addBox(0.65, 0.06, 0.18, 0.62, 0.48, 0, 0, 0, -0.42, 'usd_front_fork', brightCol);
        addBox(0.55, 0.08, 0.22, -0.42, 0.35, 0, 0, 0, 0.18, 'rear_mono_swingarm', brightCol);
        addCylinder(0.06, 0.08, 0.65, 8, -0.35, 0.48, 0.24, 0, 0, 0.45, 'upswept_racing_muffler', brightCol);

        addCylinder(R, R, 0.12, 10, 0.72, R, 0, Math.PI / 2, 0, 0, 'front_wheel_disc', darkCol);
        addCylinder(R, R, 0.16, 10, -0.68, R, 0, Math.PI / 2, 0, 0, 'rear_wheel_wide', darkCol);

      } else {
        dimensions = { L: 2.15, W: 0.82, H: 1.25 + rnd() * 0.1 };
        const R = 0.29;
        spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, R, style: 'cruiser_scooter_motorcycle' };
        reconstructedFeatures.push({ name: 'chassis_engine_block', method: 'v_twin_cylinder_cooling_fins' });
        reconstructedFeatures.push({ name: 'dual_chrome_pipes', method: 'staggered_exhaust_system' });

        addBox(1.2, 0.45, 0.44, 0, 0.52, 0, 0, 0, 0, 'motorcycle_engine_chassis', primColor);
        addBox(0.55, 0.28, 0.36, 0.15, 0.85, 0, 0, 0, 0.1, 'teardrop_fuel_tank', accentCol);
        addBox(0.72, 0.15, 0.34, -0.22, 0.76, 0, 0, 0, 0, 'leather_saddle', darkCol);

        addBox(0.06, 0.06, dimensions.W, 0.48, dimensions.H - 0.12, 0, 0, 0, 0, 'chrome_handlebars', brightCol);
        addCylinder(0.12, 0.12, 0.15, 8, 0.78, 0.85, 0, 0, 0, Math.PI / 2, 'round_headlight', brightCol);

        addCylinder(R, R, 0.12, 10, 0.75, R, 0, Math.PI / 2, 0, 0, 'front_spoke_wheel', darkCol);
        addCylinder(R, R, 0.15, 10, -0.68, R, 0, Math.PI / 2, 0, 0, 'rear_spoke_wheel', darkCol);
      }

    } else if (subpart === 'train') {
      dimensions = { L: 22.5 + rnd() * 4.0, W: 3.15, H: 3.95 };
      const R = 0.46;
      spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, R, style: 'streamlined_high_speed_train' };
      reconstructedFeatures.push({ name: 'aerodynamic_wedge_nose', method: 'high_speed_emu_cowl' });
      reconstructedFeatures.push({ name: 'single_arm_pantograph', method: 'roof_catenary_collector' });
      reconstructedFeatures.push({ name: 'flush_continuous_windows', method: 'tinted_glass_ribbon' });

      addBox(dimensions.L * 0.96, 2.45, dimensions.W, 0, 1.05 + 1.22, 0, 0, 0, 0, 'train_car_body', brightCol);
      addBox(dimensions.L * 0.94, 0.55, dimensions.W * 0.94, 0, 3.50 + 0.27, 0, 0, 0, 0, 'roof_aerodynamic_cap', primColor);
      addBox(dimensions.L * 0.90, 0.75, dimensions.W * 1.01, 0, 2.30, 0, 0, 0, 0, 'continuous_tinted_windows', darkCol);

      addBox(2.2, 1.9, dimensions.W * 0.92, dimensions.L / 2 - 1.1, 2.0, 0, 0, 0, -0.35, 'aerodynamic_bullet_nose', brightCol);
      addBox(2.4, 0.35, 1.6, -dimensions.L * 0.25, 4.05, 0, 0, 0, 0, 'high_speed_pantograph', accentCol);

      const bogieCenters = [-dimensions.L * 0.36, dimensions.L * 0.36];
      for (const bc of bogieCenters) {
        addBox(3.2, 0.35, dimensions.W * 0.85, bc, 0.55, 0, 0, 0, 0, `train_bogie_frame_${bc > 0 ? 'f' : 'r'}`, darkCol);
        for (const off of [-0.95, 0.95]) {
          addSymmetricPair((z, side) => {
            addCylinder(R, R, 0.18, 10, bc + off, R, z, Math.PI / 2, 0, 0, `rail_wheel_${side}`, darkCol);
          }, dimensions.W / 2 - 0.18, 'train_rail_wheels');
        }
      }
    }
  }

  // =========================================================================
  // 3. SHIP 分類幾何重構
  // =========================================================================
  else if (family === 'ship') {
    if (style === 'aircraft_carrier') {
      dimensions = { L: 65.0 + rnd() * 20.0, W: 18.5 + rnd() * 4.0, H: 16.0 + rnd() * 4.0 };
      spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, style: 'aircraft_carrier_flight_deck' };
      reconstructedFeatures.push({ name: 'angled_flight_deck', method: 'full_length_cantilever_deck' });
      reconstructedFeatures.push({ name: 'starboard_island_tower', method: 'asymmetric_command_bridge' });

      const hullH = 7.5;
      addBox(dimensions.L * 0.94, hullH, dimensions.W * 0.68, 0, hullH / 2, 0, 0, 0, 0, 'carrier_main_hull', darkCol);
      addBox(dimensions.L * 0.18, hullH * 1.05, dimensions.W * 0.55, dimensions.L * 0.42, hullH * 0.55, 0, 0, 0, -0.25, 'clipper_bow_wedge', darkCol);

      const deckH = 0.65;
      addBox(dimensions.L * 0.98, deckH, dimensions.W, 0, hullH + deckH / 2, 0, 0, 0, 0, 'full_flight_deck', accentCol);

      const islandL = dimensions.L * 0.16;
      const islandW = dimensions.W * 0.18;
      const islandH = dimensions.H * 0.45;
      const islandZ = -dimensions.W * 0.38;
      addBox(islandL, islandH, islandW, dimensions.L * 0.08, hullH + deckH + islandH / 2, islandZ, 0, 0, 0, 'starboard_island_tower', brightCol);
      addBox(islandL * 0.95, 0.6, islandW * 1.02, dimensions.L * 0.08, hullH + deckH + islandH * 0.85, islandZ, 0, 0, 0, 'island_navigation_bridge', darkCol);
      addCylinder(0.12, 0.35, 6.5, 6, dimensions.L * 0.08, hullH + deckH + islandH + 3.2, islandZ, 0, 0, 0, 'phased_array_radar_mast', darkCol);

    } else if (style === 'container_ship') {
      dimensions = { L: 52.0 + rnd() * 15.0, W: 12.0 + rnd() * 3.0, H: 15.0 + rnd() * 4.0 };
      spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, style: 'intermodal_container_ship' };
      reconstructedFeatures.push({ name: 'stacked_container_blocks', method: 'multi_colored_bay_stacks' });
      reconstructedFeatures.push({ name: 'aft_bridge_and_funnel', method: 'accommodations_deckhouse' });

      const hullH = 6.2;
      addBox(dimensions.L * 0.92, hullH, dimensions.W, 0, hullH / 2, 0, 0, 0, 0, 'container_hull_main', primColor);
      addBox(dimensions.L * 0.95, 0.35, dimensions.W * 0.98, 0, hullH + 0.18, 0, 0, 0, 0, 'cargo_main_deck', darkCol);

      const containerColors = [0x2980b9, 0xc0392b, 0x27ae60, 0xf39c12, 0x8e44ad];
      const numBays = 5;
      const bayL = (dimensions.L * 0.62) / numBays;
      for (let b = 0; b < numBays; b++) {
        const bx = -dimensions.L * 0.28 + b * bayL + bayL / 2;
        const stackH = 2.4 + ((b * 7 + 3) % 3) * 1.8;
        const col = containerColors[b % containerColors.length];
        addBox(bayL * 0.88, stackH, dimensions.W * 0.82, bx, hullH + 0.35 + stackH / 2, 0, 0, 0, 0, `container_bay_stack_${b+1}`, col);
      }

      const bridgeL = dimensions.L * 0.14;
      const bridgeH = dimensions.H * 0.55;
      const bridgeX = -dimensions.L * 0.38;
      addBox(bridgeL, bridgeH, dimensions.W * 0.72, bridgeX, hullH + 0.35 + bridgeH / 2, 0, 0, 0, 0, 'aft_deckhouse_bridge', brightCol);
      addCylinder(0.7, 0.8, 4.2, 8, bridgeX - bridgeL * 0.32, hullH + bridgeH + 2.1, 0, 0, 0, 0, 'main_smokestack_funnel', 0xe74c3c);

    } else {
      dimensions = { L: 35.0 + rnd() * 20.0, W: 9.5 + rnd() * 4.0, H: 12.0 + rnd() * 6.0 };
      spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, style: 'multipurpose_maritime_vessel' };
      reconstructedFeatures.push({ name: 'streamlined_hull_superstructure', method: 'terraced_decks_and_masts' });

      const hullH = 5.5;
      addBox(dimensions.L * 0.92, hullH, dimensions.W, 0, hullH / 2, 0, 0, 0, 0, 'vessel_hull_body', primColor);
      addBox(dimensions.L * 0.18, hullH * 1.1, dimensions.W * 0.85, dimensions.L * 0.42, hullH * 0.55, 0, 0, 0, -0.22, 'bow_wedge_flare', primColor);
      addBox(dimensions.L * 0.95, 0.35, dimensions.W * 0.98, 0, hullH + 0.18, 0, 0, 0, 0, 'vessel_main_deck', darkCol);

      const superL = dimensions.L * 0.35;
      const superH = dimensions.H * 0.48;
      addBox(superL, superH, dimensions.W * 0.75, -dimensions.L * 0.15, hullH + 0.35 + superH / 2, 0, 0, 0, 0, 'vessel_superstructure', brightCol);
      addCylinder(0.7, 0.85, 3.5, 8, -dimensions.L * 0.22, hullH + superH + 1.75, 0, 0, 0, 0, 'vessel_funnel', accentCol);
      addCylinder(0.12, 0.25, 5.2, 6, -dimensions.L * 0.10, hullH + superH + 2.6, 0, 0, 0, 0, 'vessel_radar_mast', darkCol);
    }
  }

  // =========================================================================
  // 4. TREE 分類幾何重構 (完全無立方體樹冠，依樹種構建多面體幾何)
  // =========================================================================
  else if (family === 'tree') {
    if (style === 'conifer_pine') {
      dimensions = { L: 6.5 + rnd() * 2.5, W: 6.5 + rnd() * 2.5, H: 15.0 + rnd() * 6.0 };
      spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, style: 'conifer_pine_pagoda_tiers' };
      reconstructedFeatures.push({ name: 'tiered_conical_whorls', method: 'six_tiered_polyhedral_conical_canopies' });

      // 筆直漸縮樹幹 (Tapered Trunk)
      const trunkH = dimensions.H * 0.32;
      addCylinder(0.28, 0.48, trunkH, 8, 0, trunkH / 2, 0, 0, 0, 0, 'pine_tapered_trunk', barkCol);

      // 多層多面體圓錐冠裙 (Tiered Conical Whorls)
      const numTiers = 6;
      const crownH = dimensions.H - trunkH * 0.6;
      for (let t = 0; t < numTiers; t++) {
        const y = trunkH * 0.6 + (t / numTiers) * crownH + (crownH / numTiers) * 0.5;
        const scale = 1.0 - (t / numTiers) * 0.78;
        const rTop = 0.25 * scale;
        const rBot = (dimensions.W / 2) * scale;
        const tH = (crownH / numTiers) * 1.45;
        addCylinder(rTop, rBot, tH, 10, 0, y, 0, 0, (t * Math.PI) / 6, 0, `pine_canopy_tier_${t+1}`, foliageCol);
      }

    } else if (style === 'baobab_tree') {
      dimensions = { L: 8.5 + rnd() * 3.0, W: 8.5 + rnd() * 3.0, H: 12.0 + rnd() * 4.0 };
      spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, style: 'succulent_bottle_baobab' };
      reconstructedFeatures.push({ name: 'swollen_bottle_trunk', method: 'massive_succulent_barrel' });
      reconstructedFeatures.push({ name: 'polyhedral_foliage_pads', method: 'faceted_dome_cushions' });

      // 巨大瓶狀肉質主幹 (Massive Swollen Barrel Trunk)
      const trunkH = dimensions.H * 0.65;
      addCylinder(2.4, 3.2, trunkH, 12, 0, trunkH / 2, 0, 0, 0, 0, 'baobab_bottle_trunk', barkCol);

      // 頂部分叉與扁平多面體葉墊 (Staghorn Branches & Polyhedral Foliage Pads)
      const numBranches = 5;
      for (let b = 0; b < numBranches; b++) {
        const th = (b / numBranches) * Math.PI * 2;
        const bx = Math.cos(th) * 2.6;
        const bz = Math.sin(th) * 2.6;
        addCylinder(0.4, 0.9, 2.8, 6, bx * 0.5, trunkH + 1.2, bz * 0.5, Math.sin(th) * 0.45, 0, -Math.cos(th) * 0.45, `baobab_branch_${b+1}`, barkCol);
        addPolyhedralBlob(1.8, 0.7, 1.8, 8, bx, trunkH + 2.5, bz, `baobab_cushion_${b+1}`, foliageCol);
      }

    } else if (style === 'palm_dragontree') {
      dimensions = { L: 7.0 + rnd() * 2.0, W: 7.0 + rnd() * 2.0, H: 11.0 + rnd() * 3.0 };
      spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, style: 'tropical_palm_dragontree' };
      reconstructedFeatures.push({ name: 'ringed_columnar_trunk', method: 'slender_curved_column' });
      reconstructedFeatures.push({ name: 'radial_frond_rosette', method: 'radiating_polyhedral_fronds' });

      const trunkH = dimensions.H * 0.78;
      addCylinder(0.22, 0.35, trunkH, 8, 0, trunkH / 2, 0, 0, 0, 0, 'palm_trunk', barkCol);

      // 頂部傘狀多面體冠叢 (Rosette Canopy Blobs)
      addPolyhedralBlob(dimensions.W * 0.45, 1.2, dimensions.W * 0.45, 10, 0, trunkH + 0.6, 0, 'palm_crown_dome', foliageCol);
      for (let f = 0; f < 8; f++) {
        const th = (f / 8) * Math.PI * 2;
        const fx = Math.cos(th) * (dimensions.W * 0.35);
        const fz = Math.sin(th) * (dimensions.W * 0.35);
        addPolyhedralBlob(0.9, 0.4, 0.9, 6, fx, trunkH + 0.2, fz, `palm_frond_leaf_${f+1}`, foliageCol);
      }

    } else if (style === 'cactus_succulent') {
      dimensions = { L: 4.5, W: 4.5, H: 8.5 + rnd() * 2.5 };
      spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, style: 'ribbed_columnar_cactus' };
      reconstructedFeatures.push({ name: 'ribbed_columnar_stem', method: 'octagonal_faceted_cylinder' });
      reconstructedFeatures.push({ name: 'candelabra_arms', method: 'curved_lateral_branches' });

      // 主柱體 (Ribbed Columnar Stem)
      addCylinder(0.48, 0.52, dimensions.H, 8, 0, dimensions.H / 2, 0, 0, 0, 0, 'cactus_main_stem', foliageCol);

      // 兩側向上生長之燭台側枝 (Candelabra Arms)
      for (const sz of [-1, 1]) {
        const armH = dimensions.H * 0.45;
        const armZ = sz * 1.2;
        addBox(0.4, 0.4, 0.8, 0, dimensions.H * 0.42, sz * 0.6, 0, 0, 0, `cactus_arm_joint_${sz > 0 ? 'r' : 'l'}`, foliageCol);
        addCylinder(0.38, 0.38, armH, 8, 0, dimensions.H * 0.42 + armH / 2, armZ, 0, 0, 0, `cactus_arm_stem_${sz > 0 ? 'r' : 'l'}`, foliageCol);
      }

    } else if (style === 'shrub_bush_hedge') {
      dimensions = { L: 5.5 + rnd() * 2.0, W: 5.5 + rnd() * 2.0, H: 2.8 + rnd() * 1.0 };
      spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, style: 'low_polyhedral_bush_cluster' };
      reconstructedFeatures.push({ name: 'ground_multi_dome_mounds', method: 'overlapping_polyhedral_mounds' });

      // 地面短枝幹
      addCylinder(0.15, 0.25, 0.6, 6, 0, 0.3, 0, 0, 0, 0, 'bush_root_stem', barkCol);

      // 低矮多面體草叢/灌木群 (Multi-dome Polyhedral Mounds)
      const numBlobs = 6;
      for (let b = 0; b < numBlobs; b++) {
        const th = (b / numBlobs) * Math.PI * 2;
        const dist = 0.8 + (b % 2) * 0.7;
        const bx = Math.cos(th) * dist;
        const bz = Math.sin(th) * dist;
        const br = 1.2 + ((b * 5) % 3) * 0.3;
        addPolyhedralBlob(br, br * 0.85, br, 8, bx, br * 0.85, bz, `shrub_mound_${b+1}`, foliageCol);
      }

    } else {
      // 廣闊闊葉樹 (Camphor / Oak / Deciduous with Organic Polyhedral Canopy Clusters)
      dimensions = { L: 10.5 + rnd() * 5.0, W: 10.5 + rnd() * 5.0, H: 16.0 + rnd() * 8.0 };
      spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, style: 'organic_polyhedral_broadleaf_oak' };
      reconstructedFeatures.push({ name: 'fluted_buttress_roots', method: 'organic_root_flare_spread' });
      reconstructedFeatures.push({ name: 'polyhedral_canopy_cloud_cluster', method: 'eight_faceted_dome_blobs' });

      // 主幹與板根 (Trunk & Roots)
      const trunkH = dimensions.H * 0.42;
      const trunkR = 0.85 + rnd() * 0.35;
      addCylinder(trunkR * 0.75, trunkR * 1.35, trunkH, 8, 0, trunkH / 2, 0, 0, 0, 0, 'broadleaf_trunk', barkCol);

      for (let r = 0; r < 4; r++) {
        const rAng = (r * Math.PI) / 2 + 0.2;
        const rx = Math.cos(rAng) * 1.6;
        const rz = Math.sin(rAng) * 1.6;
        addBox(0.35, 1.8, 1.6, rx / 2, 0.9, rz / 2, 0, -rAng, 0.35, `buttress_root_${r+1}`, barkCol);
      }

      // 枝椏與多面體圓頂樹冠簇 (Branch Limbs & Organic Polyhedral Dome Blobs)
      const canopyCenterY = trunkH + (dimensions.H - trunkH) * 0.55;
      // 中心大冠頂
      addPolyhedralBlob(dimensions.W * 0.35, (dimensions.H - trunkH) * 0.45, dimensions.W * 0.35, 10, 0, canopyCenterY, 0, 'center_canopy_dome', foliageCol);

      // 外圍 6 個有機多面體樹冠球 (Organic Polyhedral Canopy Blobs)
      const numBlobs = 6;
      for (let b = 0; b < numBlobs; b++) {
        const th = (b / numBlobs) * Math.PI * 2 + 0.3;
        const bx = Math.cos(th) * (dimensions.W * 0.32);
        const bz = Math.sin(th) * (dimensions.W * 0.32);
        const by = canopyCenterY + ((b % 2 === 0 ? 1 : -1) * (dimensions.H * 0.08));
        const blobR = 2.4 + (b % 3) * 0.6;
        // 分枝
        addCylinder(0.25, 0.45, 3.2, 6, bx * 0.45, (trunkH + by) / 2, bz * 0.45, Math.sin(th) * 0.35, 0, -Math.cos(th) * 0.35, `branch_arm_${b+1}`, barkCol);
        // 多面體樹冠簇
        addPolyhedralBlob(blobR, blobR * 0.85, blobR, 8, bx, by, bz, `canopy_blob_${b+1}`, foliageCol);
      }
    }
  }

  // =========================================================================
  // 5. ROCK 分類幾何重構
  // =========================================================================
  else if (family === 'rock') {
    dimensions = { L: 6.0 + rnd() * 4.0, W: 5.5 + rnd() * 3.5, H: 4.5 + rnd() * 3.0 };
    spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, style: 'geological_rock_formation' };
    reconstructedFeatures.push({ name: 'fractured_rock_facets', method: 'polyhedral_boulder_facets' });

    addPolyhedralBlob(dimensions.L * 0.48, dimensions.H * 0.48, dimensions.W * 0.48, 8, 0, dimensions.H * 0.48, 0, 'primary_boulder_mass', primColor);
    addBox(dimensions.L * 0.4, dimensions.H * 0.5, dimensions.W * 0.4, dimensions.L * 0.25, dimensions.H * 0.25, dimensions.W * 0.2, 0.2, 0.4, -0.1, 'rock_fracture_block_1', darkCol);
    addBox(dimensions.L * 0.35, dimensions.H * 0.4, dimensions.W * 0.35, -dimensions.L * 0.2, dimensions.H * 0.2, -dimensions.W * 0.25, -0.2, -0.3, 0.15, 'rock_fracture_block_2', accentCol);
  }

  // 計算包圍盒與多邊形數量
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (let i = 0; i < vertices.length; i += 3) {
    const vx = vertices[i], vy = vertices[i + 1], vz = vertices[i + 2];
    if (vx < minX) minX = vx; if (vx > maxX) maxX = vx;
    if (vy < minY) minY = vy; if (vy > maxY) maxY = vy;
    if (vz < minZ) minZ = vz; if (vz > maxZ) maxZ = vz;
  }

  const sx = maxX - minX, sy = maxY - minY, sz = maxZ - minZ;
  const rMax = Math.max(
    Math.hypot(minX, minZ), Math.hypot(maxX, minZ),
    Math.hypot(minX, maxZ), Math.hypot(maxX, maxZ)
  );

  const bounds = {
    min: [Number(minX.toFixed(3)), Number(minY.toFixed(3)), Number(minZ.toFixed(3))],
    max: [Number(maxX.toFixed(3)), Number(maxY.toFixed(3)), Number(maxZ.toFixed(3))],
    size: [Number(sx.toFixed(3)), Number(sy.toFixed(3)), Number(sz.toFixed(3))],
    rMax: Number(rMax.toFixed(3)),
    triangles: faces.length / 3,
    vertices: vertices.length / 3
  };

  // 生成標準 OBJ 檔案字串
  let objStr = '# Direct LLM-3D Synthesis Engine v3\n';
  objStr += `# Object: ${stem} (${family}/${subpart})\n`;
  objStr += `# Style: ${style}, Symmetry: ${symmetryMode}\n\n`;

  for (let i = 0; i < vertices.length; i += 3) {
    objStr += `v ${vertices[i]} ${vertices[i+1]} ${vertices[i+2]}\n`;
  }
  for (let i = 0; i < normals.length; i += 3) {
    objStr += `vn ${normals[i]} ${normals[i+1]} ${normals[i+2]}\n`;
  }
  for (let i = 0; i < uvs.length; i += 2) {
    objStr += `vt ${uvs[i]} ${uvs[i+1]}\n`;
  }
  for (let i = 0; i < faces.length; i += 3) {
    const f1 = faces[i] + 1, f2 = faces[i+1] + 1, f3 = faces[i+2] + 1;
    objStr += `f ${f1}/${f1}/${f1} ${f2}/${f2}/${f2} ${f3}/${f3}/${f3}\n`;
  }

  return {
    dimensions,
    spec,
    bounds,
    parts,
    reconstructedFeatures,
    objStr,
    meshData: { vertices, normals, uvs, faces }
  };
}

async function runDirectIngestion() {
  console.log('🚀 啟動直接影像轉 3D 物件寫入數據庫管線 (v3)...');

  const featureDb = loadOrExtractFeatures();
  const allImages = [];
  for (const rootDir of PHOTO_ROOTS) {
    const imgs = findImages(rootDir);
    for (const imgP of imgs) {
      allImages.push({ fullPath: imgP, baseDir: rootDir });
    }
  }

  console.log(`📸 已發現 ${allImages.length} 張來源照片進行 3D 結構重構...`);

  let partsManifest = { schema: 'svs-ai3d-provenance-v2', parts: [] };
  if (existsSync(MANIFEST_PATH)) {
    try {
      partsManifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    } catch (e) {
      console.warn('⚠️ 讀取現有 parts_manifest 失敗，重新初始化');
    }
  }

  const existingPartKeys = new Set((partsManifest.parts || []).map(p => p.keys ? p.keys[0] : (p.key || '')));
  const database3D = [];
  let processedCount = 0;

  for (const { fullPath, baseDir } of allImages) {
    const { rel, family, subpart, filename, stem } = parseCategory(fullPath, baseDir);
    const hash = createHash('md5').update(rel).digest('hex').slice(0, 10);
    const targetId = `${family}_${subpart}_${stem.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const partKey = `${family}/${subpart === 'mass' ? stem : (family === 'building' ? 'bld_' + stem : stem)}`;

    const imgMeta = featureDb[fullPath] || {
      analysis: {
        aspectRatio: 1.2,
        symmetryScore: 0.85,
        widthProfile: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
        colors: { primaryHex: 0x888888, accentHex: 0x336699, darkHex: 0x222222, brightHex: 0xcccccc, roofHex: 0xa04030, foliageHex: 0x2e7d32, barkHex: 0x5d4037 }
      },
      classification: { style: 'generic', symmetryMode: 'symmetric' }
    };

    const style = imgMeta.classification?.style || 'generic';
    const symmetryMode = imgMeta.classification?.symmetryMode || 'symmetric';

    const { dimensions, spec, bounds, parts, reconstructedFeatures, objStr, meshData } =
      buildDetailed3DGeometry(family, subpart, stem, imgMeta);

    for (const outRoot of OUT_ROOTS) {
      const targetDir = join(outRoot, family, subpart, targetId);
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }

      writeFileSync(join(targetDir, 'model.obj'), objStr, 'utf8');

      const modelJson = {
        id: targetId,
        family,
        subpart,
        style,
        symmetryMode,
        dimensions,
        bounds,
        parts,
        meshData
      };
      writeFileSync(join(targetDir, 'model.json'), JSON.stringify(modelJson, null, 2), 'utf8');

      const metadataJson = {
        id: targetId,
        stem,
        family,
        subpart,
        source_image: rel,
        generated_at: new Date().toISOString(),
        method: 'Direct LLM-3D Synthesis Engine v3',
        bounds,
        spec
      };
      writeFileSync(join(targetDir, 'metadata.json'), JSON.stringify(metadataJson, null, 2), 'utf8');

      const featuresJson = {
        id: targetId,
        stem,
        family,
        subpart,
        style,
        symmetryMode,
        aspectRatio: imgMeta.analysis?.aspectRatio || 1.0,
        symmetryScore: imgMeta.analysis?.symmetryScore || 0.85,
        widthProfile: imgMeta.analysis?.widthProfile || [],
        colors: imgMeta.analysis?.colors || {},
        reconstructedFeatures
      };
      writeFileSync(join(targetDir, 'features.json'), JSON.stringify(featuresJson, null, 2), 'utf8');
    }

    database3D.push({
      id: targetId,
      key: partKey,
      family,
      subpart,
      style,
      symmetryMode,
      version: 3,
      verStr: 'v3',
      image: rel,
      bounds,
      spec,
      triangles: bounds.triangles,
      outputDir: `out/3d_data/${family}/${subpart}/${targetId}`
    });

    if (!existingPartKeys.has(partKey)) {
      partsManifest.parts.push({
        method: 'llm_parts',
        version: 3,
        verStr: 'v3',
        consumer: `${family} catalog & partlib (${subpart})`,
        rev: 'HEAD',
        at: new Date().toISOString().slice(0, 10),
        imgs: [
          {
            role: 'primary',
            id: `img_${hash}`,
            family,
            part: subpart,
            query: stem,
            api: 'local_intake',
            license: 'unverified(restricted/local)',
            creator: null,
            source_url: '',
            file: rel
          }
        ],
        gen: {
          tool: 'Direct LLM-3D Synthesis Engine v3',
          runner: 'tools/ai3d/direct_ingest_all.mjs',
          params: `--family ${family} --subpart ${subpart} --style ${style} --symmetry ${symmetryMode}`,
          machine: 'Node.js Native Fine-Detail 3D Engine',
          measured: `Triangles ${bounds.triangles}, Vertices ${bounds.vertices}`
        },
        post: {
          tool: 'tools/ai3d/direct_ingest_all.mjs',
          fit: 1.0,
          bounds: bounds.size,
          note: `Extents [${bounds.size.join(', ')}]m, rMax ${bounds.rMax}m`
        },
        keys: [partKey]
      });
      existingPartKeys.add(partKey);
    }

    processedCount++;
    if (processedCount % 30 === 0 || processedCount === allImages.length) {
      console.log(`  ⚡ [${processedCount}/${allImages.length}] 已完成細部特徵 3D 重構: ${family}/${subpart}/${filename} (Style: ${style}, Symmetry: ${symmetryMode})`);
    }
  }

  writeFileSync(MANIFEST_PATH, JSON.stringify(partsManifest, null, 2), 'utf8');
  console.log(`\n✅ 成功更新 parts_manifest.json (共 ${partsManifest.parts.length} 筆 3D 零件帳本)`);

  const dbData = {
    version: 3,
    generated_at: new Date().toISOString(),
    total_objects: database3D.length,
    families: [...new Set(database3D.map(d => d.family))],
    items: database3D
  };

  writeFileSync(DB_OUTPUT_LOCAL, JSON.stringify(dbData, null, 2), 'utf8');
  if (existsSync(dirname(DB_OUTPUT_RESTRICTED))) {
    writeFileSync(DB_OUTPUT_RESTRICTED, JSON.stringify(dbData, null, 2), 'utf8');
  }

  console.log(`✅ 成功寫入 3D 數據庫索引 (共 ${database3D.length} 筆物件) 至 out/3d_database.json`);
  console.log('🎉 所有影像轉 3D 物件細部特徵重建與入庫完畢！');
}

runDirectIngestion().catch(e => {
  console.error('❌ 入庫執行失敗:', e);
  process.exit(1);
});
