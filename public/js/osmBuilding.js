// ============ OSM 精確建物外環生成器 ============
// 只吃 osmAreas.js 投影後的 outer/holes；不把輪廓縮成中心方盒。牆段與 blocker
// 共用同一組 edge 資料，屋頂則由 ShapeGeometry 保留內洞。不同語意最後各自合批，
// 因而 draw call 由型別數決定，不隨建物棟數線性增加。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { envMat, sceneObjectMat } from './toon.js';
import { generateBuildingAppurtenances } from './buildingAppurtenances.js';
import { resolveAdaptiveRoofForm, calculateFootprintMetrics } from './architectureStyles.js';

const EPS = 1e-5;
const DEFAULT_H = Object.freeze({
  house: 8, terrace: 10, apartments: 20, commercial: 18, industrial: 12, farm: 8,
  school: 10, hospital: 14, station: 12, church: 14, mosque: 14, temple: 14,
  synagogue: 14, civic: 12, museum: 14, stadium: 18, garage: 5, hangar: 12,
  lighthouse: 18, castle: 16,
});

// 一種類型一列；幾何仍只由下方單一 polygon/attachment 生成器負責。
// attachment 是識別性屋頂件，fit 不進完整輪廓時整件略過，不放大主體。
export const BUILDING_STYLE_ROWS = Object.freeze({
  house: { wall: 0xb7a893, roof: 0x6d5d52, attachment: 'chimney' },
  terrace: { wall: 0xb39a84, roof: 0x67584f, attachment: 'chimney' },
  apartments: { wall: 0xa9a398, roof: 0x505b64, attachment: 'hvac' },
  commercial: { wall: 0x7189a8, roof: 0x465765, attachment: 'canopy' },
  industrial: { wall: 0x727b83, roof: 0x4f5964, attachment: 'stack' },
  farm: { wall: 0xa58d68, roof: 0x66574a, attachment: 'silo' },
  school: { wall: 0x9aaf8f, roof: 0x596d58, attachment: 'clock' },
  hospital: { wall: 0xb47e7e, roof: 0x66565b, attachment: 'cross' },
  station: { wall: 0x888fa4, roof: 0x505866, attachment: 'canopy' },
  church: { wall: 0xa58f73, roof: 0x5c5660, attachment: 'spire' },
  mosque: { wall: 0xc0ad83, roof: 0x56756f, attachment: 'dome' },
  temple: { wall: 0xa77b64, roof: 0x6f3e36, attachment: 'finial' },
  synagogue: { wall: 0xb49f7b, roof: 0x5f6b78, attachment: 'dome' },
  civic: { wall: 0x9b9ea6, roof: 0x565d66, attachment: 'flag' },
  museum: { wall: 0x9d8eaa, roof: 0x5a5265, attachment: 'skylight' },
  stadium: { wall: 0x789b80, roof: 0x4e6658, attachment: 'mast' },
  garage: { wall: 0x8a8d91, roof: 0x55595c, attachment: null },
  hangar: { wall: 0x7c858b, roof: 0x4d555b, attachment: 'beacon' },
  lighthouse: { wall: 0xd4c7ad, roof: 0x8b4f47, attachment: 'beacon' },
  castle: { wall: 0x958b78, roof: 0x5f5b55, attachment: 'battlement' },
});

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const ringOf = (ring) => {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const out = [];
  for (const p of ring) {
    if (!Array.isArray(p) || !finite(p[0]) || !finite(p[1])) return null;
    if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) > EPS) out.push([p[0], p[1]]);
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= EPS) out.pop();
  return out.length >= 3 ? out : null;
};

function polyOf(polygon) {
  const outer = ringOf(polygon?.outer);
  if (!outer) return null;
  const holes = [];
  for (const raw of polygon?.holes || []) {
    const hole = ringOf(raw);
    if (hole) holes.push(hole);
  }
  return { outer, holes };
}

function addPath(shape, ring) {
  shape.moveTo(ring[0][0], -ring[0][1]);
  for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i][0], -ring[i][1]);
  shape.lineTo(ring[0][0], -ring[0][1]);
}

function roofGeometry(poly, y) {
  const shape = new THREE.Shape();
  addPath(shape, poly.outer);
  for (const hole of poly.holes) {
    const path = new THREE.Path();
    addPath(path, hole);
    shape.holes.push(path);
  }
  const geo = new THREE.ShapeGeometry(shape);
  // ShapeGeometry is X/Y; map its local Y to world Z while keeping its normal upward.
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  return geo;
}

function edgeGeometry(ring, baseY, height, thickness, sourceId, kind) {
  const geos = [], edges = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (len <= EPS) continue;
    const ry = Math.atan2(dz, dx);
    const geo = new THREE.BoxGeometry(len, height, thickness);
    geo.rotateY(-ry);
    geo.translate((a[0] + b[0]) / 2, baseY + height / 2, (a[1] + b[1]) / 2);
    geos.push(geo);
    // This is the same oriented box as the visible wall segment (A30).
    edges.push({
      x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, y: baseY,
      h: height, hw2: len / 2, hd2: thickness / 2, ry,
      r: Math.hypot(len, thickness) / 2, ty: baseY + height,
      bld: 1, osm: 1, cl: 'bld', sourceId, kind,
    });
  }
  return { geos, edges };
}

function heightOf(area, kind) {
  const tags = area?.tags || {};
  const raw = Number.parseFloat(tags.height);
  if (Number.isFinite(raw) && raw > 2) return Math.min(120, raw);
  const levels = Number.parseFloat(tags['building:levels']);
  if (Number.isFinite(levels) && levels > 0) return Math.min(120, Math.max(3.2, levels * 3.2));
  return DEFAULT_H[kind] || 8;
}

function baseOf(poly, terrain, fallback = 0) {
  if (typeof terrain?.heightAt !== 'function') return fallback;
  let y = Infinity;
  for (const p of poly.outer) y = Math.min(y, terrain.heightAt(p[0], p[1]));
  for (const ring of poly.holes) for (const p of ring) y = Math.min(y, terrain.heightAt(p[0], p[1]));
  return Number.isFinite(y) ? y : fallback;
}

function defaultMaterials(style, batch = null) {
  if (batch?.architecture) return {
    wall: sceneObjectMat(0xffffff, { vertexColors: true }),
    roof: sceneObjectMat(0xffffff, { vertexColors: true }),
  };
  const row = BUILDING_STYLE_ROWS[style] || BUILDING_STYLE_ROWS.house;
  return {
    wall: envMat(row.wall, { wash: 0.42, cool: 0.4 }),
    roof: envMat(row.roof, { wash: 0.3, cool: 0.45 }),
  };
}

export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (((a[1] > z) !== (b[1] > z)) && x < (b[0] - a[0]) * (z - a[1]) / ((b[1] - a[1]) || EPS) + a[0]) inside = !inside;
  }
  return inside;
}

// 多邊形實體與圓盤是否相交(零 import 純幾何):外環頂點入盤、或外環邊緣掠過盤內、
// 或盤心落在實體內(外環內且不在內洞裡) —— 塔堡 1/4 圈淨空的判定縫,呼叫端只餵圈,
// 幾何只認這一份(中庭裡的塔不算重疊,照樣放行)
function polyHitsDisc(poly, cx, cz, r) {
  const outer = poly?.outer || [];
  for (const p of outer) if (Math.hypot(p[0] - cx, p[1] - cz) < r) return true;
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i], b = outer[(i + 1) % outer.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
    let t = l2 ? ((cx - a[0]) * dx + (cz - a[1]) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    if (Math.hypot(cx - (a[0] + t * dx), cz - (a[1] + t * dz)) < r) return true;
  }
  return pointInRing(cx, cz, outer) && !(poly.holes || []).some((hole) => pointInRing(cx, cz, hole));
}

export function attachmentSite(poly, half) {
  const xs = poly.outer.map((p) => p[0]), zs = poly.outer.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const points = [[cx, cz], ...poly.outer.map((p) => [(p[0] + cx) / 2, (p[1] + cz) / 2])];
  return points.find(([x, z]) => [[-half, -half], [half, -half], [half, half], [-half, half]].every(([dx, dz]) =>
    pointInRing(x + dx, z + dz, poly.outer) && !poly.holes.some((hole) => pointInRing(x + dx, z + dz, hole)))) || null;
}

function attachmentGeometry(kind, poly, y) {
  const type = BUILDING_STYLE_ROWS[kind]?.attachment;
  if (!type) return null;
  const xs = poly.outer.map((p) => p[0]), zs = poly.outer.map((p) => p[1]);
  const half = Math.max(0.35, Math.min(2.2, Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) * 0.12));
  const site = attachmentSite(poly, half);
  if (!site) return null;
  const [x, z] = site;
  let geo;
  let lift = half * 0.5;
  if (type === 'dome' || type === 'silo') {
    geo = new THREE.CylinderGeometry(half, half * 0.75, half * 1.8, 10);
    lift = half * 0.9;
  } else if (type === 'spire' || type === 'finial') {
    geo = new THREE.ConeGeometry(half, half * 3.2, 8);
    lift = half * 1.6;
  } else if (type === 'stack' || type === 'mast' || type === 'flag' || type === 'beacon') {
    geo = new THREE.CylinderGeometry(half * 0.28, half * 0.34, half * 2.8, 8);
    lift = half * 1.4;
  } else if (type === 'cross') {
    const stem = new THREE.BoxGeometry(half * 0.35, half * 2.6, half * 0.3);
    const arm = new THREE.BoxGeometry(half * 1.5, half * 0.32, half * 0.3); arm.translate(0, half * 0.45, 0);
    geo = mergeGeometries([stem, arm], false);
    lift = half * 1.3;
  } else if (type === 'canopy' || type === 'skylight' || type === 'battlement') {
    geo = new THREE.BoxGeometry(half * 1.8, half * 0.8, half * 1.8);
    lift = half * 0.4;
  } else {
    geo = new THREE.BoxGeometry(half, half, half);
    lift = half * 0.5;
  }
  geo.translate(x, y + lift, z);
  return geo;
}

export function paintGeometry(geometry, hex, variant = 0) {
  const color = new THREE.Color(hex).multiplyScalar(0.94 + variant * 0.06);
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) { colors[i] = color.r; colors[i + 1] = color.g; colors[i + 2] = color.b; }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** 沿真實外環／中庭牆段配置窗格、立柱與橫梁，零件數有上限。
 * 採階層式深度分層（Glass < Mullion/Frame < Trim/Header < Column/Pier），
 * 杜絕同平面共面 (Coplanar) 導致的 WebGL Z-fighting 閃爍。
 */
function architecturalFacade(edges, style, thickness) {
  const geos = [];
  let budget = 180;
  const facade = style.facade || style.wallType || 'ribbon';
  const glassColor = style.glass || 0x68a5c2;
  const trimColor = style.trim || 0x546575;

  for (const edge of edges) {
    if (budget <= 0) break;
    const length = edge.hw2 * 2;
    const floors = Math.max(1, Math.min(8, Math.floor(edge.h / 3.2)));
    const isCurtain = facade === 'ribbon' || facade === 'glass_curtain';
    const bays = Math.max(1, Math.min(10, Math.floor(length / (isCurtain ? 5 : 3.2))));
    const bayW = length / bays, floorH = edge.h / floors;

    // Helper: 在特定額外厚度階層上生成幾何，避免 Z-fighting
    const add = (w, h, u, y, color, extraDepth = 0.05) => {
      if (budget-- <= 0) return;
      const geo = new THREE.BoxGeometry(w, h, thickness + extraDepth);
      geo.translate(u, y, 0);
      geo.rotateY(-edge.ry);
      geo.translate(edge.x, edge.y, edge.z);
      geos.push(paintGeometry(geo, color, style.variant));
    };

    for (let floor = 0; floor < floors && budget > 0; floor++) {
      const y = (floor + 0.52) * floorH;
      for (let bay = 0; bay < bays && budget > 0; bay++) {
        const u = -length / 2 + (bay + 0.5) * bayW;

        // 1. 玻璃窗尺寸比例設定：帷幕窗高透光，一般窗開口均勻
        const w = bayW * (isCurtain ? 0.94 : (facade === 'recess' || facade === 'concrete') ? 0.40 : 0.62);
        const h = floorH * (isCurtain ? 0.82 : (facade === 'piers' || facade === 'stone') ? 0.70 : 0.55);

        // Tier 1: 玻璃窗面（深度 +0.05m，突出於牆面 2.5cm，徹底脫離牆面 Z-fighting）
        add(w, h, u, y, glassColor, 0.05);

        // Tier 2: 窗框 / 窗梃 / 格子（深度 +0.09m，突出於玻璃面 2cm，徹底脫離與玻璃的共面閃爍）
        if (isCurtain) {
          // 帷幕下沿金屬飾條
          add(w, 0.06, u, y - h / 2 + 0.03, trimColor, 0.09);
        }
        if (facade === 'lattice' || facade === 'timber') {
          add(0.08, h, u, y, trimColor, 0.09);
          add(w, 0.08, u, y, trimColor, 0.09);
        }

        // Tier 3: 磚石窗楣 / 綠化花槽 / 拱圈（深度 +0.13m ~ +0.14m）
        if (facade === 'brick') {
          add(w + 0.08, 0.09, u, y + h / 2 + 0.045, trimColor, 0.13);
        }
        if (facade === 'green') {
          add(w + 0.06, 0.16, u, y - h / 2 - 0.08, 0x3d6e4a, 0.14);
        }
        if (facade === 'arches') {
          for (const side of [-1, 1]) {
            if (budget-- <= 0) break;
            const arch = new THREE.TorusGeometry(w / 2, Math.min(0.12, w * 0.07), 3, 8, Math.PI);
            arch.translate(u, y + h / 2, side * (thickness / 2 + 0.055));
            arch.rotateY(-edge.ry); arch.translate(edge.x, edge.y, edge.z);
            geos.push(paintGeometry(arch, trimColor, style.variant));
          }
        }
      }

      // Tier 4: 水平樓層腰帶 (Stringcourse / Cornice)（深度 +0.15m）
      if (facade !== 'recess' && facade !== 'concrete') {
        add(length, 0.14, 0, floor * floorH + 0.10, trimColor, 0.15);
      }
    }

    // Tier 5: 垂直立柱 / 壁柱 (Piers / Columns)（深度 +0.18m）
    if (['columns', 'piers', 'timber', 'industrial', 'stone'].includes(facade)) {
      for (let bay = 1; bay < bays && budget > 0; bay++) {
        add(0.18, edge.h, -length / 2 + bay * bayW, edge.h / 2, trimColor, 0.18);
      }
    }
  }
  return geos;
}

/** 屋頂構件覆蓋建築實體輪廓並封閉山牆兩端，杜絕懸空、空洞與零件拆離。支援 12 種自適應屋頂造型。 */
function architecturalRoof(poly, y, style, actualRoofForm = null, metrics = null, targetH = 10) {
  const form = actualRoofForm || style?.actualRoofForm || style?.roofForm;
  if (!form || form === 'flat' || poly.holes.length) return [];
  let sign = 0;
  for (let i = 0; i < poly.outer.length; i++) {
    const a = poly.outer[i], b = poly.outer[(i + 1) % poly.outer.length], c = poly.outer[(i + 2) % poly.outer.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < EPS) continue;
    if (sign && Math.sign(cross) !== sign) return [];
    sign = Math.sign(cross);
  }
  const xs = poly.outer.map(p => p[0]), zs = poly.outer.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const polyW = maxX - minX, polyD = maxZ - minZ;
  if (polyW < 1.2 || polyD < 1.2) return [];

  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const isRotated = polyD > polyW;
  const len = isRotated ? polyD : polyW;
  const span = isRotated ? polyW : polyD;

  const roofH = Math.min(Math.max(1.6, (targetH || 10) * 0.32), Math.max(1.8, span * 0.36));
  const ov = Math.min(0.45, Math.max(0.2, span * 0.05)); // 屋簷出挑 (eave overhang)
  const totalL = len + ov * 2;
  const totalS = span + ov * 2;

  const geos = [];
  const add = (geo, lift = 0, rotY = 0) => {
    if (rotY) geo.rotateY(rotY);
    if (isRotated) geo.rotateY(Math.PI / 2);
    geo.translate(cx, y + lift, cz);
    geos.push(paintGeometry(geo, style.roof, style.variant));
  };
  const addGableWall = (geo, lift = 0) => {
    if (isRotated) geo.rotateY(Math.PI / 2);
    geo.translate(cx, y + lift, cz);
    geos.push(paintGeometry(geo, style.trim || style.wall, style.variant));
  };

  if (form === 'dome') {
    const r = Math.min(span / 2, len / 2);
    add(new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0);
  } else if (form === 'vault') {
    const r = span / 2;
    const geo = new THREE.CylinderGeometry(r, r, totalL, 14, 1, false, 0, Math.PI);
    geo.rotateZ(Math.PI / 2);
    add(geo, 0);
  } else if (form === 'spire') {
    const r = Math.min(span / 2, len / 2) * 0.85;
    const geo = new THREE.ConeGeometry(r, roofH * 2.2, 8);
    add(geo, roofH * 1.1);
  } else if (form === 'shed') {
    const slopeH = roofH * 0.85;
    const geo = new THREE.BoxGeometry(totalL, 0.18, totalS);
    geo.rotateZ(0.22);
    add(geo, slopeH / 2 + 0.1);
    // 封閉兩側山牆
    for (const side of [-1, 1]) {
      const gWall = new THREE.BoxGeometry(0.18, slopeH * 0.8, span * 0.9);
      gWall.translate(side * (len / 2 - 0.09), slopeH * 0.4, 0);
      addGableWall(gWall, 0);
    }
  } else if (form === 'mansard') {
    const lower = new THREE.CylinderGeometry(span * 0.42, totalS / 2, roofH * 0.55, 4);
    lower.rotateY(Math.PI / 4);
    add(lower, roofH * 0.275);
    const upper = new THREE.CylinderGeometry(span * 0.25, span * 0.42, roofH * 0.35, 4);
    upper.rotateY(Math.PI / 4);
    add(upper, roofH * 0.55 + roofH * 0.175);
  } else if (form === 'curved_ridge') {
    const r = span * 0.65;
    const geo = new THREE.CylinderGeometry(r, r, totalL, 16, 1, false, Math.PI * 0.22, Math.PI * 0.56);
    geo.rotateZ(Math.PI / 2);
    add(geo, 0.1);
  } else if (form === 'wudian') {
    const hip = new THREE.CylinderGeometry(span * 0.28, totalS / 2, roofH, 4);
    hip.rotateY(Math.PI / 4);
    add(hip, roofH / 2);
    const ridge = new THREE.BoxGeometry(Math.max(1.0, len - span * 0.6), 0.15, 0.2);
    add(ridge, roofH + 0.075);
  } else if (form === 'xieshan') {
    const lower = new THREE.CylinderGeometry(span * 0.38, totalS / 2, roofH * 0.5, 4);
    lower.rotateY(Math.PI / 4);
    add(lower, roofH * 0.25);
    const upper = new THREE.CylinderGeometry(roofH * 0.55, roofH * 0.55, totalL * 0.8, 3);
    upper.rotateZ(Math.PI / 2);
    add(upper, roofH * 0.65);
  } else if (form === 'xuanshan') {
    // 懸山頂：挑梁出檁，屋面延伸出山牆外
    const geo = new THREE.CylinderGeometry(span / 2 + ov, span / 2 + ov, totalL + 0.6, 3);
    geo.rotateZ(Math.PI / 2);
    add(geo, roofH * 0.48);
    const beam = new THREE.BoxGeometry(totalL + 0.8, 0.14, 0.14);
    add(beam, roofH + 0.07);
    // 山牆面
    for (const side of [-1, 1]) {
      const gWall = new THREE.BoxGeometry(0.18, roofH * 0.9, span * 0.88);
      gWall.translate(side * (len / 2 - 0.09), roofH * 0.45, 0);
      addGableWall(gWall, 0);
    }
  } else if (form === 'yingshan') {
    // 硬山頂：山牆與屋面齊平，兩側磚石封火牆凸出
    const geo = new THREE.CylinderGeometry(span / 2, span / 2, len, 3);
    geo.rotateZ(Math.PI / 2);
    add(geo, roofH * 0.48);
    for (const side of [-1, 1]) {
      const wall = new THREE.BoxGeometry(0.22, roofH * 1.05, span + 0.2);
      wall.translate(side * (len / 2 + 0.11), roofH * 0.525, 0);
      addGableWall(wall, 0);
    }
  } else if (form === 'tiered') {
    for (let i = 0; i < 3; i++) {
      const s = 1 - i * 0.24;
      const geo = new THREE.ConeGeometry(Math.min(span, len) * 0.48 * s, roofH * 0.4, 4);
      geo.rotateY(Math.PI / 4);
      add(geo, roofH * (0.2 + i * 0.32));
    }
  } else if (form === 'stepped') {
    for (let i = 0; i < 3; i++) {
      const s = 1 - i * 0.22;
      const tierH = roofH * 0.28;
      add(new THREE.BoxGeometry(len * s, tierH, span * s), tierH * (0.5 + i));
    }
  } else {
    // sawtooth 或一般雙坡 (gable)
    const n = form === 'sawtooth' ? Math.min(4, Math.max(2, Math.floor(span / 4.0))) : 1;
    const toothS = span / n;
    for (let i = 0; i < n; i++) {
      const geo = new THREE.CylinderGeometry(toothS / 2 + ov, toothS / 2 + ov, totalL, 3);
      geo.rotateZ(Math.PI / 2);
      const zOffset = n > 1 ? (i - (n - 1) / 2) * toothS : 0;
      geo.translate(0, 0, zOffset);
      add(geo, roofH * 0.48 / (n > 1 ? 1.4 : 1));
    }
    // 山牆封閉兩端
    for (const side of [-1, 1]) {
      const gWall = new THREE.BoxGeometry(0.18, roofH * 0.88, span * 0.92);
      gWall.translate(side * (len / 2 - 0.09), roofH * 0.44, 0);
      addGableWall(gWall, 0);
    }
  }
  return geos;
}

/**
 * 生成 OSM 建物外環／內洞。`materialOf` 回傳 { wall, roof }，可由 biomes 注入既有材質縫。
 * `rings` = 塔堡 1/4 圈 [{x,z,r}]:實體撞圈的輪廓整棟略過(寧缺勿錯),記進 skipped 供圖資缺口報表。
 * 回傳的 platforms 不放進 blockers，僅交給 main.js 的既有 surfaceAt 平台索引。
 */
export function buildOsmPolygonBuildings(group, areas = [], options = {}) {
  const terrain = options.terrain;
  const materialOf = typeof options.materialOf === 'function' ? options.materialOf : defaultMaterials;
  const wallThickness = Math.max(0.08, Number(options.wallThickness) || 0.28);
  const rings = Array.isArray(options.rings) ? options.rings : [];
  const batches = new Map();
  const blockers = [], platforms = [], generatedByKind = {}, invalid = [], skipped = [];
  const architectureCounts = {};
  const ordered = [...areas].sort((a, b) => String(a?.sourceId).localeCompare(String(b?.sourceId)));
  for (const area of ordered) {
    const cls = area?.classification || {};
    const isBuilding = area?.tags?.building != null || area?.tags?.['building:part'] != null;
    if (!isBuilding) continue;
    if (cls.generator !== 'polygonBuilding') {
      skipped.push({ sourceId: area.sourceId, reason: cls.mode === 'unmapped' ? 'unmapped' : 'unsupported_building' });
      continue;
    }
    const kind = cls.kind || 'house';
    const height = heightOf(area, kind);
    let areaGenerated = 0;
    for (const raw of area.worldPolygons || []) {
      const poly = polyOf(raw);
      if (!poly) { invalid.push({ sourceId: area.sourceId, reason: 'invalid_footprint' }); continue; }
      if (rings.some((rg) => polyHitsDisc(poly, rg.x, rg.z, rg.r))) {
        skipped.push({ sourceId: area.sourceId, reason: 'tower_base_clear' });
        continue;
      }
      if (terrain && Number.isFinite(terrain.minX) && Number.isFinite(terrain.maxX)
          && Number.isFinite(terrain.minZ) && Number.isFinite(terrain.maxZ)) {
        const inset = Math.max(0, Number(options.inset) || 0);
        const bMinX = terrain.minX + inset, bMaxX = terrain.maxX - inset;
        const bMinZ = terrain.minZ + inset, bMaxZ = terrain.maxZ - inset;
        const xs = poly.outer.map((p) => p[0]), zs = poly.outer.map((p) => p[1]);
        const pMinX = Math.min(...xs), pMaxX = Math.max(...xs);
        const pMinZ = Math.min(...zs), pMaxZ = Math.max(...zs);
        if (pMinX < terrain.minX || pMaxX > terrain.maxX || pMinZ < terrain.minZ || pMaxZ > terrain.maxZ
            || (inset > 0 && (pMinX < bMinX || pMaxX > bMaxX || pMinZ < bMinZ || pMaxZ > bMaxZ))) {
          skipped.push({ sourceId: area.sourceId, reason: 'outside_map_bounds' });
          continue;
        }
      }
      const architecture = options.architectureOf?.(area, poly) || null;
      const targetH = (area?.tags?.height || area?.tags?.['building:levels']) ? height : (architecture?.targetHeight || height);
      const baseY = baseOf(poly, terrain, 0);
      const topY = baseY + targetH;
      let batch = batches.get(kind);
      if (!batch) { batch = { kind, walls: [], roofs: [], details: [], count: 0 }; batches.set(kind, batch); }
      const wallStart = batch.walls.length, roofStart = batch.roofs.length, detailStart = batch.details.length;
      batch.roofs.push(roofGeometry(poly, topY));
      const detail = !architecture ? attachmentGeometry(kind, poly, topY) : null;
      if (detail) batch.details.push(detail);
      const outer = edgeGeometry(poly.outer, baseY, targetH, wallThickness, area.sourceId, kind);
      batch.walls.push(...outer.geos); blockers.push(...outer.edges);
      const facadeEdges = [...outer.edges];
      for (const hole of poly.holes) {
        const inner = edgeGeometry(hole, baseY, targetH, wallThickness, area.sourceId, kind);
        batch.walls.push(...inner.geos); blockers.push(...inner.edges);
        facadeEdges.push(...inner.edges);
      }
      if (architecture) {
        batch.architecture = true;
        for (const geo of batch.walls.slice(wallStart)) paintGeometry(geo, architecture.wall, architecture.variant);
        for (const geo of batch.roofs.slice(roofStart)) paintGeometry(geo, architecture.roof, architecture.variant);
        for (const geo of batch.details.slice(detailStart)) paintGeometry(geo, architecture.trim, architecture.variant);

        // 基礎入地裙帶 (Grounding plinth): 沿外環向下扎實入地 0.25m，杜絕懸空縫隙
        for (let i = 0; i < poly.outer.length; i++) {
          const a = poly.outer[i], b = poly.outer[(i + 1) % poly.outer.length];
          const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
          if (len <= EPS) continue;
          const ry = Math.atan2(dz, dx);
          const plinthH = 0.32;
          const plinth = new THREE.BoxGeometry(len + 0.06, plinthH, wallThickness + 0.12);
          plinth.rotateY(-ry);
          plinth.translate((a[0] + b[0]) / 2, baseY - plinthH * 0.4, (a[1] + b[1]) / 2);
          batch.details.push(paintGeometry(plinth, architecture.trim || 0x475569, architecture.variant));
        }
        // 4 階段程序化管線 (4-Phase Procedural Pipeline)
        // Phase 1: 依 OSM 圖資外環計算建物實體尺寸指標
        const metrics = calculateFootprintMetrics(poly);

        // Phase 2: 決議最適屋頂構造並自適應調整尺寸 (防止長寬比異常或過大面積失真)
        const adaptiveRoofForm = resolveAdaptiveRoofForm(
          architecture.roofForm,
          metrics,
          targetH,
          architecture.functionInfo?.category
        );
        architecture.actualRoofForm = adaptiveRoofForm;
        if (['house', 'terrace', 'apartments', 'commercial', 'farm', 'garage', 'industrial'].includes(kind)) {
          batch.details.push(...architecturalRoof(poly, topY, architecture, adaptiveRoofForm, metrics, targetH));
        }

        // Phase 3: 建築立面與平面特徵渲染 (大玻璃窗、塗鴉牆、壁柱、格柵等)
        batch.details.push(...architecturalFacade(facadeEdges, architecture, wallThickness));

        // Phase 4: 外部零件依屋頂類型嚴格篩選相容性後隨機配置
        batch.details.push(...generateBuildingAppurtenances(poly, facadeEdges, baseY, topY, architecture, wallThickness, adaptiveRoofForm, metrics));
        const key = `${architecture.profile}:${architecture.id}`;
        architectureCounts[key] = (architectureCounts[key] || 0) + 1;
      }
      // Polygon platform retains the outer ring and all holes; no AABB approximation is used.
      const xs = poly.outer.map((p) => p[0]), zs = poly.outer.map((p) => p[1]);
      platforms.push({
        platform: 1, active: true, sourceId: area.sourceId, kind,
        outer: poly.outer, holes: poly.holes, y: topY,
        bounds: { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) },
      });
      batch.count++; areaGenerated++;
    }
    if (areaGenerated) generatedByKind[kind] = (generatedByKind[kind] || 0) + areaGenerated;
  }
  const meshes = [];
  for (const batch of batches.values()) {
    const mats = materialOf(batch.kind, batch, BUILDING_STYLE_ROWS[batch.kind]) || defaultMaterials(batch.kind);
    if (batch.walls.length) {
      const geometry = batch.walls.length === 1 ? batch.walls[0] : mergeGeometries(batch.walls, false);
      const mesh = new THREE.Mesh(geometry, mats.wall);
      mesh.userData.osmBuildingBatch = batch.kind;
      mesh.frustumCulled = false;
      group.add(mesh); meshes.push(mesh);
    }
    if (batch.roofs.length) {
      const geometry = batch.roofs.length === 1 ? batch.roofs[0] : mergeGeometries(batch.roofs, false);
      const mesh = new THREE.Mesh(geometry, mats.roof);
      mesh.userData.osmBuildingRoofBatch = batch.kind;
      mesh.frustumCulled = false;
      group.add(mesh); meshes.push(mesh);
    }
    if (batch.details.length) {
      const geometry = batch.details.length === 1 ? batch.details[0] : mergeGeometries(batch.details, false);
      const mesh = new THREE.Mesh(geometry, mats.detail || mats.roof);
      mesh.userData.osmBuildingDetailBatch = batch.kind;
      mesh.frustumCulled = false;
      group.add(mesh); meshes.push(mesh);
    }
  }
  return {
    blockers, platforms, generated: Object.values(generatedByKind).reduce((n, v) => n + v, 0),
    generatedByKind, invalid, skipped,
    meshes, architectureCounts,
  };
}
