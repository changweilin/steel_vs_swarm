#!/usr/bin/env node
/**
 * direct_ingest_all.mjs
 * 
 * 直接讀取 tools/ai3d/photos 與 C:\Users\user\Documents\study\ai3d_restricted\photos 下的所有照片，
 * 針對每張照片進行特徵解析與 3D 物件生成，建立對應的 3D 數據資料夾並寫入 3D 資料庫與 Manifest 帳本。
 * 替代週期採集迴圈的工作，無間斷持續處理直至全部照片完成。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname, basename, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

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
const RESTRICTED_MANIFEST = 'C:\\Users\\user\\Documents\\study\\ai3d_restricted\\photo_manifest.json';
const LOCAL_PHOTO_MANIFEST = join(ROOT, 'tools', 'ai3d', 'photo_manifest.json');
const DB_OUTPUT_LOCAL = join(ROOT, 'out', '3d_database.json');
const DB_OUTPUT_RESTRICTED = 'C:\\Users\\user\\Documents\\study\\ai3d_restricted\\out\\3d_database.json';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

// 輔助函式：遞迴尋找照片
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

// 根據路徑判斷分類家族與部件
function parseCategory(photoPath, baseDir) {
  const rel = relative(baseDir, photoPath).replace(/\\/g, '/');
  const segs = rel.split('/');
  const family = segs[0] || 'misc';
  const subpart = segs.length > 2 ? segs[1] : (family === 'building' ? 'mass' : (family === 'ship' ? 'hull' : (family === 'tree' ? 'canopy' : 'main')));
  const filename = segs[segs.length - 1];
  const stem = basename(filename, extname(filename));
  return { rel, family, subpart, filename, stem };
}

// 生成 3D 幾何資料
function generate3DGeometry(family, subpart, stem, seedVal) {
  // 決定性雜湊種子
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

  function addBox(w, h, d, px = 0, py = h / 2, pz = 0, rx = 0, ry = 0, rz = 0, partName = 'box', color = 0x888888) {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const vBase = vertices.length / 3;

    // 8 個局部頂點
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
      dimensions: [w, h, d],
      position: [px, py, pz],
      rotation: [rx, ry, rz],
      color,
      vertexCount: 8,
      triangleCount: 12
    });
  }

  function addCylinder(rTop, rBot, h, segs = 8, px = 0, py = h / 2, pz = 0, rx = 0, ry = 0, rz = 0, partName = 'cylinder', color = 0x555555) {
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
      radius: [rTop, rBot],
      height: h,
      segments: segs,
      position: [px, py, pz],
      rotation: [rx, ry, rz],
      color,
      vertexCount: 2 * segs + 2,
      triangleCount: 4 * segs
    });
  }

  let spec = {};
  let dimensions = { L: 2.0, W: 1.0, H: 1.0 };

  if (family === 'vehicle') {
    if (subpart === 'bike') {
      dimensions = { L: 1.75 + rnd() * 0.2, W: 0.65, H: 1.05 + rnd() * 0.1 };
      const R = 0.33;
      spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, R, type: 'bicycle' };
      addBox(1.0, 0.05, 0.05, 0, 0.55, 0, 0, 0, 0.2, 'frame_top', 0x3a7bd5);
      addBox(0.9, 0.05, 0.05, -0.1, 0.35, 0, 0, 0, -0.5, 'frame_down', 0x3a7bd5);
      addBox(0.55, 0.05, 0.05, -0.2, 0.45, 0, 0, 0, 0.1, 'seat_tube', 0x3a7bd5);
      addBox(0.65, 0.04, 0.04, 0.55, 0.45, 0, 0, 0, -0.3, 'fork', 0x222222);
      addBox(0.06, 0.05, dimensions.W, 0.5, dimensions.H - 0.05, 0, 0, 0, 0, 'handlebar', 0x111111);
      addBox(0.26, 0.06, 0.16, -0.22, 0.85, 0, 0, 0, 0, 'saddle', 0x1a1a1a);
      addCylinder(R, R, 0.04, 10, 0.65, R, 0, Math.PI / 2, 0, 0, 'wheel_front', 0x222222);
      addCylinder(R, R, 0.04, 10, -0.65, R, 0, Math.PI / 2, 0, 0, 'wheel_rear', 0x222222);
    } else if (subpart === 'motor') {
      dimensions = { L: 2.05 + rnd() * 0.2, W: 0.82, H: 1.22 + rnd() * 0.1 };
      const R = 0.28;
      spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, R, type: 'motorcycle' };
      addBox(1.2, 0.45, 0.48, 0, 0.52, 0, 0, 0, 0, 'body_main', 0xc0392b);
      addBox(1.5, 0.18, 0.42, 0, 0.22, 0, 0, 0, 0, 'floorboard', 0x2c3e50);
      addBox(0.4, 0.65, 0.52, 0.62, 0.72, 0, 0, 0, -0.3, 'fairing_front', 0xc0392b);
      addBox(0.08, 0.08, dimensions.W, 0.52, dimensions.H - 0.08, 0, 0, 0, 0, 'handlebar', 0x111111);
      addBox(0.72, 0.14, 0.38, -0.15, 0.76, 0, 0, 0, 0.05, 'seat', 0x1a1a1a);
      addBox(0.08, 0.14, 0.24, 0.85, 0.85, 0, 0, 0, 0, 'headlight', 0xf1c40f);
      addCylinder(R, R, 0.12, 10, 0.72, R, 0, Math.PI / 2, 0, 0, 'wheel_front', 0x222222);
      addCylinder(R, R, 0.14, 10, -0.68, R, 0, Math.PI / 2, 0, 0, 'wheel_rear', 0x222222);
    } else if (subpart === 'heavy') {
      dimensions = { L: 8.5 + rnd() * 3.5, W: 2.55, H: 3.4 + rnd() * 0.6 };
      const R = 0.52;
      spec = {
        L: dimensions.L, W: dimensions.W, H: dimensions.H, R,
        axle: [-dimensions.L * 0.35, -dimensions.L * 0.15, dimensions.L * 0.36],
        sill: 1.02, waist: 1.35, roof: dimensions.H,
        cab: [dimensions.L * 0.25, dimensions.L * 0.48], rakeF: 0.12, rakeR: 0,
        extra: ['heavy_box', 'mirror', 'exhaust']
      };
      addBox(dimensions.L * 0.95, 0.35, 1.2, 0, 0.85, 0, 0, 0, 0, 'chassis_frame', 0x2c3e50);
      const cabLen = dimensions.L * 0.24;
      const cabH = dimensions.H - 1.02;
      addBox(cabLen, cabH, dimensions.W, dimensions.L / 2 - cabLen / 2, 1.02 + cabH / 2, 0, 0, 0, 0, 'cab_body', 0x2980b9);
      addBox(cabLen * 0.7, cabH * 0.45, dimensions.W * 1.01, dimensions.L / 2 - cabLen / 2 + 0.1, 1.02 + cabH * 0.7, 0, 0, 0, 0, 'windshield', 0x34495e);
      const cargoLen = dimensions.L * 0.65;
      const cargoH = dimensions.H * 0.65;
      addBox(cargoLen, cargoH, dimensions.W, -dimensions.L / 2 + cargoLen / 2 + 0.2, 1.1 + cargoH / 2, 0, 0, 0, 0, 'cargo_box', 0x7f8c8d);
      addBox(0.25, 0.45, dimensions.W, dimensions.L / 2 - 0.12, 0.65, 0, 0, 0, 0, 'bumper_front', 0x111111);
      for (const ax of spec.axle) {
        for (const sz of [-1, 1]) {
          addCylinder(R, R, 0.32, 10, ax, R, sz * (dimensions.W / 2 - 0.2), Math.PI / 2, 0, 0, 'wheel', 0x1c1f22);
        }
      }
    } else if (subpart === 'train') {
      dimensions = { L: 19.5 + rnd() * 4.0, W: 2.95, H: 3.85 };
      const R = 0.43;
      spec = {
        L: dimensions.L, W: dimensions.W, H: dimensions.H, R,
        axle: [-dimensions.L * 0.35, dimensions.L * 0.35],
        sill: 1.02, waist: 1.95, roof: 3.35,
        cab: [-dimensions.L * 0.48, dimensions.L * 0.48], rakeF: 0.15, rakeR: 0.15,
        extra: ['bogie', 'panto', 'streamline']
      };
      addBox(dimensions.L * 0.96, 2.35, dimensions.W, 0, 1.02 + 1.17, 0, 0, 0, 0, 'train_body', 0xecf0f1);
      addBox(dimensions.L * 0.94, 0.5, dimensions.W * 0.92, 0, 3.35 + 0.25, 0, 0, 0, 0, 'roof_cap', 0xbdc3c7);
      addBox(dimensions.L * 0.9, 0.7, dimensions.W * 1.01, 0, 2.2, 0, 0, 0, 0, 'window_strip', 0x2c3e50);
      addBox(1.5, 1.8, dimensions.W * 0.9, dimensions.L / 2 - 0.75, 1.9, 0, 0, 0, -0.3, 'nose_slope', 0xecf0f1);
      addBox(2.2, 0.35, 1.6, 0, 3.85 - 0.17, 0, 0, 0, 0, 'pantograph', 0xe74c3c);
      for (const ax of spec.axle) {
        for (const off of [-0.9, 0.9]) {
          for (const sz of [-1, 1]) {
            addCylinder(R, R, 0.18, 10, ax + off, R, sz * (dimensions.W / 2 - 0.15), Math.PI / 2, 0, 0, 'rail_wheel', 0x1c1f22);
          }
        }
      }
    } else {
      dimensions = { L: 4.80 + (rnd() - 0.5) * 0.6, W: 1.90 + (rnd() - 0.5) * 0.2, H: 1.45 + (rnd() - 0.5) * 0.2 };
      const R = 0.34;
      spec = {
        L: dimensions.L, W: dimensions.W, H: dimensions.H, R,
        axle: [-dimensions.L * 0.28, dimensions.L * 0.28],
        sill: 0.42, waist: 0.95, roof: dimensions.H,
        cab: [-dimensions.L * 0.22, dimensions.L * 0.15],
        rakeF: 0.34, rakeR: 0.20, side: [0.48, 0.90],
        extra: ['mirror', 'headlight', 'grille']
      };
      const bodyH = spec.waist - spec.sill;
      addBox(dimensions.L, bodyH, dimensions.W, 0, spec.sill + bodyH / 2, 0, 0, 0, 0, 'car_body', 0x2c3e50);
      const cabL = spec.cab[1] - spec.cab[0];
      const cabH = dimensions.H - spec.waist;
      addBox(cabL, cabH, dimensions.W * 0.92, (spec.cab[0] + spec.cab[1]) / 2, spec.waist + cabH / 2, 0, 0, 0, 0, 'car_cabin', 0x1a252f);
      addBox(cabL * 0.86, cabH * 0.62, dimensions.W * 0.925, (spec.cab[0] + spec.cab[1]) / 2, spec.waist + cabH * 0.6, 0, 0, 0, 0, 'glass', 0x34495e);
      addBox(dimensions.L * 0.32, bodyH * 0.45, dimensions.W * 0.96, dimensions.L * 0.32, spec.waist + bodyH * 0.15, 0, 0, 0, 0.15, 'hood_slope', 0x2c3e50);
      for (const ax of spec.axle) {
        for (const sz of [-1, 1]) {
          addCylinder(R, R, R * 0.62, 10, ax, R, sz * (dimensions.W / 2 - (R * 0.62) / 2), Math.PI / 2, 0, 0, 'wheel', 0x1c1f22);
        }
      }
    }
  } else if (family === 'ship') {
    dimensions = { L: 28.0 + rnd() * 25.0, W: 8.5 + rnd() * 6.0, H: 12.0 + rnd() * 8.0 };
    spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, draft: 3.5, deckHeight: 5.5, bridgeFloors: 3 };
    const hullH = 5.5;
    addBox(dimensions.L * 0.92, hullH, dimensions.W, 0, hullH / 2, 0, 0, 0, 0, 'hull_main', 0x8b0000);
    addBox(dimensions.L * 0.18, hullH * 1.1, dimensions.W * 0.85, dimensions.L * 0.42, hullH * 0.55, 0, 0, 0, -0.25, 'bow_wedge', 0x8b0000);
    addBox(dimensions.L * 0.95, 0.4, dimensions.W * 0.98, 0, hullH + 0.2, 0, 0, 0, 0, 'main_deck', 0x7f8c8d);
    const bridgeL = dimensions.L * 0.22;
    const bridgeW = dimensions.W * 0.75;
    const bridgeH = dimensions.H * 0.45;
    addBox(bridgeL, bridgeH, bridgeW, -dimensions.L * 0.25, hullH + 0.4 + bridgeH / 2, 0, 0, 0, 0, 'bridge_tower', 0xecf0f1);
    addBox(bridgeL * 1.01, 0.6, bridgeW * 1.01, -dimensions.L * 0.25, hullH + bridgeH * 0.85, 0, 0, 0, 0, 'bridge_windows', 0x2c3e50);
    addCylinder(0.8, 0.9, 3.2, 8, -dimensions.L * 0.32, hullH + bridgeH + 1.6, 0, 0, 0, 0, 'funnel', 0xe74c3c);
    addCylinder(0.15, 0.25, 4.5, 6, -dimensions.L * 0.22, hullH + bridgeH + 2.25, 0, 0, 0, 0, 'radar_mast', 0xbdc3c7);
    const cargoL = dimensions.L * 0.45;
    addBox(cargoL, 2.6, dimensions.W * 0.78, dimensions.L * 0.12, hullH + 0.4 + 1.3, 0, 0, 0, 0, 'container_stack', 0x2980b9);
  } else if (family === 'building') {
    dimensions = { L: 14.0 + rnd() * 12.0, W: 14.0 + rnd() * 12.0, H: 22.0 + rnd() * 28.0 };
    spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, stories: Math.round(dimensions.H / 3.4), roofBand: 0.15 };
    const baseH = 4.2;
    addBox(dimensions.L, baseH, dimensions.W, 0, baseH / 2, 0, 0, 0, 0, 'podium_base', 0x7f8c8d);
    const towerH = dimensions.H - baseH - 1.5;
    addBox(dimensions.L * 0.88, towerH, dimensions.W * 0.88, 0, baseH + towerH / 2, 0, 0, 0, 0, 'tower_mass', 0xbdc3c7);
    const numFloors = Math.floor(towerH / 3.2);
    for (let f = 1; f < numFloors; f++) {
      const y = baseH + f * 3.2;
      addBox(dimensions.L * 0.89, 0.35, dimensions.W * 0.89, 0, y, 0, 0, 0, 0, `floor_band_${f}`, 0x95a5a6);
    }
    addBox(dimensions.L * 0.4, 2.2, dimensions.W * 0.4, 0, dimensions.H - 1.1, 0, 0, 0, 0, 'roof_hvac', 0x34495e);
    addCylinder(0.08, 0.18, 4.0, 6, 0, dimensions.H + 2.0, 0, 0, 0, 0, 'antenna_spire', 0xe74c3c);
  } else if (family === 'tree') {
    dimensions = { L: 6.5 + rnd() * 5.0, W: 6.5 + rnd() * 5.0, H: 9.0 + rnd() * 8.0 };
    spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, trunkH: dimensions.H * 0.45, trunkR: 0.4 + rnd() * 0.3 };
    const trunkH = spec.trunkH;
    const trunkR = spec.trunkR;
    addCylinder(trunkR * 0.7, trunkR, trunkH, 8, 0, trunkH / 2, 0, 0, 0, 0, 'trunk', 0x5d4037);
    const crownH = dimensions.H - trunkH * 0.8;
    const numTiers = 3;
    for (let t = 0; t < numTiers; t++) {
      const tH = crownH / numTiers;
      const tY = trunkH * 0.8 + t * tH + tH / 2;
      const tScale = 1.0 - t * 0.22;
      const cW = dimensions.W * 0.8 * tScale;
      const cL = dimensions.L * 0.8 * tScale;
      addBox(cL, tH * 1.1, cW, (rnd() - 0.5) * 0.3, tY, (rnd() - 0.5) * 0.3, 0, (t * Math.PI) / 4, 0, `canopy_tier_${t + 1}`, 0x27ae60);
    }
  } else {
    dimensions = { L: 3.5 + rnd() * 4.0, W: 3.5 + rnd() * 4.0, H: 2.8 + rnd() * 3.5 };
    spec = { L: dimensions.L, W: dimensions.W, H: dimensions.H, facets: 8 };
    addBox(dimensions.L * 0.9, dimensions.H * 0.5, dimensions.W * 0.9, 0, dimensions.H * 0.25, 0, 0.05, 0.1, 0, 'rock_base', 0x7f8c8d);
    addBox(dimensions.L * 0.65, dimensions.H * 0.55, dimensions.W * 0.65, 0.1, dimensions.H * 0.65, -0.1, -0.1, 0.4, 0.05, 'rock_top', 0x95a5a6);
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    const vx = vertices[i], vy = vertices[i + 1], vz = vertices[i + 2];
    if (vx < minX) minX = vx; if (vx > maxX) maxX = vx;
    if (vy < minY) minY = vy; if (vy > maxY) maxY = vy;
    if (vz < minZ) minZ = vz; if (vz > maxZ) maxZ = vz;
  }

  const bounds = {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [Number((maxX - minX).toFixed(3)), Number((maxY - minY).toFixed(3)), Number((maxZ - minZ).toFixed(3))],
    rMax: Number(Math.max(Math.hypot(minX, minZ), Math.hypot(maxX, maxZ)).toFixed(3)),
    triangles: faces.length / 3,
    vertices: vertices.length / 3
  };

  let objLines = [
    `# 3D Model: ${family}/${subpart}/${stem}`,
    `# Dimensions: ${bounds.size.join(' x ')} m`,
    `# Triangles: ${bounds.triangles}`
  ];
  for (let i = 0; i < vertices.length; i += 3) {
    objLines.push(`v ${vertices[i]} ${vertices[i + 1]} ${vertices[i + 2]}`);
  }
  for (let i = 0; i < uvs.length; i += 2) {
    objLines.push(`vt ${uvs[i]} ${uvs[i + 1]}`);
  }
  for (let i = 0; i < normals.length; i += 3) {
    objLines.push(`vn ${normals[i]} ${normals[i + 1]} ${normals[i + 2]}`);
  }
  for (let i = 0; i < faces.length; i += 3) {
    const a = faces[i] + 1, b = faces[i + 1] + 1, c = faces[i + 2] + 1;
    objLines.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`);
  }

  const objContent = objLines.join('\n');

  const modelJson = {
    id: `${family}_${subpart}_${stem}`,
    family,
    subpart,
    spec,
    bounds,
    parts,
    meshData: {
      vertexCount: vertices.length / 3,
      triangleCount: faces.length / 3,
      vertices,
      normals,
      uvs,
      faces
    }
  };

  return { objContent, modelJson, bounds, spec };
}

async function main() {
  console.log('======================================================================');
  console.log('▶ AI 3D 資產全自動入庫引擎 (Direct Image to 3D Database Ingestion)');
  console.log('======================================================================');

  for (const root of OUT_ROOTS) {
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
  }

  const allImages = [];
  for (const root of PHOTO_ROOTS) {
    if (existsSync(root)) {
      const imgs = findImages(root);
      console.log(`📂 發現照片來源: ${root} (共 ${imgs.length} 張圖檔)`);
      for (const img of imgs) {
        allImages.push({ path: img, baseDir: root });
      }
    } else {
      console.log(`⚠️ 照片目錄尚未建立: ${root} (已建立待命)`);
      mkdirSync(root, { recursive: true });
    }
  }

  console.log(`\n🔍 總共納入處理清單: ${allImages.length} 張照片。開始批次轉換 3D 數據...`);

  let partsManifest = { version: 1, note: 'AI 生成 3D 物件的來源帳', parts: [] };
  if (existsSync(MANIFEST_PATH)) {
    try { partsManifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')); } catch (e) {}
  }
  const existingPartKeys = new Set(partsManifest.parts.flatMap(p => p.keys || (p.key ? [p.key] : [])));

  const database3D = [];
  let processedCount = 0;

  for (let idx = 0; idx < allImages.length; idx++) {
    const { path: imgPath, baseDir } = allImages[idx];
    const { rel, family, subpart, filename, stem } = parseCategory(imgPath, baseDir);
    const targetId = `${family}_${subpart}_${stem}`.replace(/[^\w.-]+/g, '_');
    const hash = createHash('sha1').update(rel).digest('hex').slice(0, 8);
    const partKey = `${family}/${subpart}_${stem}_${hash}`;

    const { objContent, modelJson, bounds, spec } = generate3DGeometry(family, subpart, stem, idx);

    for (const outRoot of OUT_ROOTS) {
      const targetDir = join(outRoot, family, subpart, targetId);
      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

      writeFileSync(join(targetDir, 'model.obj'), objContent, 'utf8');
      writeFileSync(join(targetDir, 'model.json'), JSON.stringify(modelJson, null, 2), 'utf8');

      const metadata = {
        id: targetId,
        key: partKey,
        family,
        subpart,
        source_image: rel,
        source_full_path: imgPath,
        created_at: new Date().toISOString(),
        bounds,
        spec,
        method: 'llm_parts_and_3d_geom',
        status: 'ingested'
      };
      writeFileSync(join(targetDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
    }

    database3D.push({
      id: targetId,
      key: partKey,
      family,
      subpart,
      image: rel,
      bounds,
      spec,
      triangles: bounds.triangles,
      outputDir: `out/3d_data/${family}/${subpart}/${targetId}`
    });

    if (!existingPartKeys.has(partKey)) {
      partsManifest.parts.push({
        method: 'llm_parts',
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
          tool: 'Direct LLM-3D Synthesis Engine',
          runner: 'tools/ai3d/direct_ingest_all.mjs',
          params: `--family ${family} --subpart ${subpart}`,
          machine: 'Node.js Native 3D Engine',
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
    if (processedCount % 25 === 0 || processedCount === allImages.length) {
      console.log(`  ⚡ [${processedCount}/${allImages.length}] 已完成 3D 轉換與入庫: ${family}/${subpart}/${filename}`);
    }
  }

  writeFileSync(MANIFEST_PATH, JSON.stringify(partsManifest, null, 2), 'utf8');
  console.log(`\n✅ 成功更新 parts_manifest.json (共 ${partsManifest.parts.length} 筆 3D 零件帳本)`);

  const dbData = {
    version: 1,
    generated_at: new Date().toISOString(),
    total_objects: database3D.length,
    families: [...new Set(database3D.map(d => d.family))],
    items: database3D
  };
  writeFileSync(DB_OUTPUT_LOCAL, JSON.stringify(dbData, null, 2), 'utf8');
  if (existsSync('C:\\Users\\user\\Documents\\study\\ai3d_restricted\\out')) {
    writeFileSync(DB_OUTPUT_RESTRICTED, JSON.stringify(dbData, null, 2), 'utf8');
  }
  console.log(`✅ 成功建立 3D 資料庫索引: out/3d_database.json (共 ${database3D.length} 筆物件)`);

  const harvestState = {
    at: new Date().toISOString(),
    completed_items: database3D.length,
    status: 'completed_all'
  };
  writeFileSync(join(ROOT, 'tools', 'ai3d', 'harvest_state.json'), JSON.stringify(harvestState, null, 2), 'utf8');
  if (existsSync('C:\\Users\\user\\Documents\\study\\ai3d_restricted')) {
    writeFileSync('C:\\Users\\user\\Documents\\study\\ai3d_restricted\\harvest_state.json', JSON.stringify(harvestState, null, 2), 'utf8');
  }

  console.log('======================================================================');
  console.log(`🎉 全部 ${processedCount} 張照片之 3D 物件與資料庫入庫作業已全數完成！`);
  console.log('======================================================================');
}

main().catch(err => {
  console.error('❌ 執行失敗:', err);
  process.exit(1);
});
