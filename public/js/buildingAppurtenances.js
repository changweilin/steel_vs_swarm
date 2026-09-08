// ============ 建築外部零件程序化生成系統 ============
// 涵蓋：招牌、看板、大門、側門、電視牆、選舉廣告牆、塗鴉牆、遮雨棚、逃生梯、盆栽、
// 陽台、冷氣室外機、抽風機、水塔、天線、基地台、太陽能板、曬衣架、鴿棚、旗幟、煙囪、
// 鐘樓、尖塔、直升機棚。
// 依功能類別置於正確結構部位（頂部角落/邊緣/中心、正門地面、側邊地面、立面高程），
// 根據建物生成後的實體尺寸（長度、高度、屋頂面積、跨度）進行空間容量保護與確定性隨機配置。
import * as THREE from 'three';
import { architectureHash } from './buildingDiversity.js';
import { paintGeometry, pointInRing, attachmentSite } from './osmBuilding.js';
import {
  ROOF_APPURTENANCE_COMPATIBILITY,
  distanceToSegment,
  distanceToPolyBoundary,
  isSiteValid,
} from './architectureStyles.js';

export { distanceToSegment, distanceToPolyBoundary, isSiteValid };

/** 外部零件型錄定義與配置規則 (24 款外部構件) */
export const APPURTENANCE_RULES = Object.freeze({
  // 頂部物件 (Rooftop)
  water_tank: {
    slot: 'rooftop',
    categories: ['residential', 'commercial', 'industrial'],
    maxCount: 3, prob: 0.85, minArea: 30, minSpan: 4,
  },
  antenna: {
    slot: 'rooftop',
    categories: ['residential', 'rural'],
    maxCount: 2, prob: 0.60, minArea: 20, minSpan: 3,
  },
  cellular_mast: {
    slot: 'rooftop',
    categories: ['commercial', 'residential'],
    maxCount: 1, prob: 0.35, minHeight: 24, minArea: 120, minSpan: 8,
  },
  solar_array: {
    slot: 'rooftop',
    categories: ['commercial', 'industrial', 'rural', 'residential'],
    maxCount: 4, prob: 0.45, minArea: 80, minSpan: 8,
  },
  pigeon_coop: {
    slot: 'rooftop',
    categories: ['residential', 'rural'],
    maxCount: 1, prob: 0.25, minArea: 60, minSpan: 6,
  },
  chimney: {
    slot: 'rooftop',
    categories: ['rural', 'industrial'],
    maxCount: 2, prob: 0.55, minArea: 35, minSpan: 4,
  },
  roof_billboard: {
    slot: 'rooftop',
    categories: ['commercial'],
    maxCount: 1, prob: 0.40, minHeight: 18, minSpan: 14, minArea: 150,
  },
  clock_tower: {
    slot: 'rooftop',
    categories: ['tourism', 'civic', 'commercial'],
    maxCount: 1, prob: 0.35, minHeight: 10, minArea: 160, minSpan: 12,
  },
  rooftop_spire: {
    slot: 'rooftop',
    categories: ['tourism', 'residential', 'commercial'],
    maxCount: 2, prob: 0.35, minHeight: 12, minArea: 100, minSpan: 10,
  },
  heli_hangar: {
    slot: 'rooftop',
    categories: ['commercial', 'industrial'],
    maxCount: 1, prob: 0.40, minHeight: 28, minArea: 500, minSpan: 22,
  },

  // 正門地面物件 (Ground Entrance)
  main_door: {
    slot: 'ground_front',
    categories: ['commercial', 'residential', 'tourism', 'industrial'],
    maxCount: 1, prob: 1.0,
  },
  canopy: {
    slot: 'ground_front',
    categories: ['commercial', 'residential', 'tourism'],
    maxCount: 1, prob: 0.75,
  },
  planter_pots: {
    slot: 'ground_front',
    categories: ['residential', 'commercial', 'tourism'],
    maxCount: 2, prob: 0.70,
  },

  // 側邊與後側地面物件 (Side & Rear Ground)
  side_door: {
    slot: 'side_ground',
    categories: ['industrial', 'commercial', 'residential'],
    maxCount: 2, prob: 0.65, minLength: 3.5,
  },
  exhaust_fan: {
    slot: 'side_ground',
    categories: ['industrial', 'commercial'],
    maxCount: 3, prob: 0.75, minLength: 3.0,
  },
  graffiti_wall: {
    slot: 'side_ground',
    categories: ['industrial', 'residential'],
    maxCount: 1, prob: 0.40, minLength: 6.0,
  },

  // 立面與側邊高程物件 (Facade & Upper Sides)
  blade_sign: {
    slot: 'facade',
    categories: ['commercial', 'residential'],
    maxCount: 3, prob: 0.80, minLength: 4.5,
  },
  video_wall: {
    slot: 'facade',
    categories: ['commercial'],
    maxCount: 1, prob: 0.30, minHeight: 24, minLength: 12.0, minArea: 180,
  },
  election_banner: {
    slot: 'facade',
    categories: ['residential', 'commercial'],
    maxCount: 1, prob: 0.25, minHeight: 8, minLength: 6.0,
  },
  fire_escape: {
    slot: 'facade',
    categories: ['residential', 'commercial', 'industrial'],
    maxCount: 1, prob: 0.40, minHeight: 12, minLength: 6.5,
  },
  balconies: {
    slot: 'facade',
    categories: ['residential'],
    maxCount: 8, prob: 0.70, minHeight: 10, minLength: 7.5,
  },
  drying_rack: {
    slot: 'facade',
    categories: ['residential'],
    maxCount: 4, prob: 0.60,
  },
  ac_units: {
    slot: 'facade',
    categories: ['residential', 'commercial'],
    maxCount: 12, prob: 0.85, minLength: 3.2,
  },
  flagpole: {
    slot: 'facade',
    categories: ['tourism', 'commercial', 'residential'],
    maxCount: 1, prob: 0.35, minHeight: 8, minLength: 8.0,
  },
});

/** 計算屋頂多邊形幾何量測指標（面積、跨度、長寬邊界與質心） */
export function calculateRoofMetrics(poly) {
  const outer = poly?.outer || [];
  if (outer.length < 3) return null;
  const xs = outer.map((p) => p[0]), zs = outer.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const width = Math.max(0.1, maxX - minX);
  const depth = Math.max(0.1, maxZ - minZ);
  const span = Math.min(width, depth);
  const aspect = Math.max(width, depth) / span;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

  let area = 0;
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    area += (outer[j][0] + outer[i][0]) * (outer[j][1] - outer[i][1]);
  }
  area = Math.abs(area) * 0.5;

  return {
    width, depth, span, aspect, area, cx, cz, minX, maxX, minZ, maxZ,
    outer, holes: poly.holes || [],
  };
}

/** 提取屋頂上的多種候選位置區位（角落 corners、邊緣 edges、中心 center），確保嚴格保留邊緣留白空間 */
export function getRoofPlacementSites(poly, metrics) {
  if (!metrics) return { corners: [], edges: [], center: null };
  const { outer, cx, cz } = metrics;
  const corners = [];
  const edges = [];

  // 1. 角落候選點：自頂點朝向質心內縮，確保到鄰近邊界的留白距離 >= 1.6m
  for (let i = 0; i < outer.length; i++) {
    const p = outer[i];
    const dx = cx - p[0], dz = cz - p[1];
    const dist = Math.hypot(dx, dz);
    if (dist > 1.8) {
      // 沿對角線向內推進，尋找淨距 >= 1.8m 的安全區位
      let chosen = null;
      for (let step = 0.25; step <= 0.65; step += 0.08) {
        const sx = p[0] + (dx / dist) * (dist * step);
        const sz = p[1] + (dz / dist) * (dist * step);
        if (distanceToPolyBoundary(sx, sz, poly) >= 1.8) {
          chosen = { x: sx, z: sz, origVertex: p };
          break;
        }
      }
      if (chosen) corners.push(chosen);
    }
  }

  // 2. 邊緣候選點：自邊段中點朝向質心內縮，確保到邊界的留白距離 >= 1.8m
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i], b = outer[(i + 1) % outer.length];
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    const dx = cx - mx, dz = cz - mz;
    const dist = Math.hypot(dx, dz);
    if (dist > 1.8) {
      const angle = Math.atan2(b[0] - a[0], b[1] - a[1]);
      let chosen = null;
      for (let step = 0.20; step <= 0.60; step += 0.08) {
        const sx = mx + (dx / dist) * (dist * step);
        const sz = mz + (dz / dist) * (dist * step);
        if (distanceToPolyBoundary(sx, sz, poly) >= 1.8) {
          chosen = { x: sx, z: sz, ry: angle };
          break;
        }
      }
      if (chosen) edges.push(chosen);
    }
  }

  // 3. 中心候選點：淨距 >= 2.0m
  let center = null;
  if (distanceToPolyBoundary(cx, cz, poly) >= 2.0) {
    center = { x: cx, z: cz };
  } else {
    const fallback = attachmentSite(poly, 2.0);
    if (fallback && distanceToPolyBoundary(fallback[0], fallback[1], poly) >= 1.5) {
      center = { x: fallback[0], z: fallback[1] };
    }
  }

  return { corners, edges, center };
}

/** 依外向法線計算牆面幾何局部坐標系 (保證 local +Z 指向戶外、角度與世界坐標同調) */
export function getEdgeFrame(edge, poly) {
  const len = edge.hw2 * 2;
  const nx = -Math.sin(edge.ry);
  const nz = Math.cos(edge.ry);
  const testDist = 0.25;
  const isInside = pointInRing(edge.x + nx * testDist, edge.z + nz * testDist, poly.outer) &&
    !(poly.holes || []).some(h => pointInRing(edge.x + nx * testDist, edge.z + nz * testDist, h));
  const outNx = isInside ? -nx : nx;
  const outNz = isInside ? -nz : nz;
  const rotY = Math.atan2(outNx, outNz);
  return { outNx, outNz, rotY, len };
}

/** 依屋頂造型計算指定 (x, z) 點的實際屋頂面高度，杜絕屋頂構件漂浮或埋入 */
export function getRoofElevation(x, z, poly, roofForm = 'flat', metrics = null, topY = 0) {
  if (!roofForm || roofForm === 'flat' || !poly?.outer?.length) return topY;
  const xs = poly.outer.map(p => p[0]), zs = poly.outer.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const polyW = maxX - minX, polyD = maxZ - minZ;
  const isRotated = polyD > polyW;
  const span = isRotated ? polyW : polyD;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const roofH = Math.min(Math.max(1.6, 10 * 0.32), Math.max(1.8, span * 0.36));

  if (roofForm === 'stepped') {
    const distRatio = Math.max(Math.abs(x - cx) / (polyW / 2 || 1), Math.abs(z - cz) / (polyD / 2 || 1));
    const tier = distRatio > 0.66 ? 0 : distRatio > 0.33 ? 1 : 2;
    return topY + tier * (roofH * 0.28);
  }

  const distFromRidge = isRotated ? Math.abs(x - cx) : Math.abs(z - cz);
  const halfSpan = Math.max(0.5, span / 2);
  const slopeRatio = Math.max(0, Math.min(1, 1 - distFromRidge / halfSpan));

  if (roofForm === 'shed') {
    const sRatio = Math.max(0, Math.min(1, ((isRotated ? (x - minX) : (z - minZ)) / (span || 1))));
    return topY + sRatio * roofH * 0.8;
  }
  return topY + slopeRatio * roofH * 0.85;
}

/** 生成單棟建築的全部外部零件 (0~N，支援角落/邊緣/中心隨機化分佈與大小容量保護) */
export function generateBuildingAppurtenances(poly, edges = [], baseY, topY, architecture, wallThickness = 0.28, actualRoofForm = null, precomputedMetrics = null) {
  if (!architecture || !edges.length || !poly?.outer?.length) return [];
  const geos = [];
  const funcInfo = architecture.functionInfo || { category: 'residential', key: 'residential_townhouse' };
  const cat = funcInfo.category || 'residential';
  const height = topY - baseY;
  const idBase = `${architecture.id || 'bld'}|${edges[0]?.sourceId || edges[0]?.x}|${poly.outer.length}`;
  const variant = architecture.variant || 0;

  // 計算屋頂指標與候選放置區位
  const metrics = precomputedMetrics || calculateRoofMetrics(poly);
  const sites = getRoofPlacementSites(poly, metrics);

  // 決定此棟建築之屋頂造型，並取得相容的屋頂零件清單 (依屋頂類型決定可放物件)
  const roofForm = actualRoofForm || architecture.actualRoofForm || architecture.roofForm || 'flat';
  const allowedRooftopParts = new Set(ROOF_APPURTENANCE_COMPATIBILITY[roofForm] || ROOF_APPURTENANCE_COMPATIBILITY.flat);

  // 1. 識別正門牆段 (通常是長度最適中、臨路或主要長邊)
  const sortedEdges = [...edges].sort((a, b) => b.hw2 - a.hw2);
  const frontEdge = sortedEdges[0];
  const sideEdges = sortedEdges.slice(1);

  // 2. 正門地面物件生成 (大門、雨棚、盆栽 - 緊密貼齊外牆法線，杜絕內旋或拆開)
  if (frontEdge) {
    const frame = getEdgeFrame(frontEdge, poly);
    const frontLen = frame.len;
    if (frontLen >= 2.4) {
      // 大門 (Main Door)
      const doorW = Math.min(2.8, frontLen * 0.35);
      const doorH = Math.min(3.2, Math.max(2.2, height * 0.25));

      // 隨機偏置：不一定置中，但在安全邊界內隨機滑移
      const maxOffset = Math.max(0, (frontLen - doorW - 1.2) * 0.35);
      const doorOffset = maxOffset > 0 ? (((architectureHash(idBase, 'door_pos') % 100) / 50) - 1.0) * maxOffset : 0;

      const doorGeo = new THREE.BoxGeometry(doorW, doorH, 0.08);
      doorGeo.translate(doorOffset, doorH / 2, wallThickness / 2 + 0.04);
      doorGeo.rotateY(frame.rotY);
      doorGeo.translate(frontEdge.x, baseY, frontEdge.z);
      geos.push(paintGeometry(doorGeo, 0x3d3731, variant));

      // 門楣橫板
      const lintel = new THREE.BoxGeometry(doorW + 0.3, 0.22, 0.12);
      lintel.translate(doorOffset, doorH + 0.11, wallThickness / 2 + 0.06);
      lintel.rotateY(frame.rotY);
      lintel.translate(frontEdge.x, baseY, frontEdge.z);
      geos.push(paintGeometry(lintel, architecture.trim || 0x6e5d50, variant));

      // 遮雨棚 (Canopy / Awning) - 需正門長度足夠包容門框與兩側餘裕，且嚴格受限於邊界
      const hasCanopy = (architectureHash(idBase, 'canopy') % 100) < 75;
      const maxCanopyW = Math.min(doorW + 1.2, (frontLen / 2 - Math.abs(doorOffset)) * 2 - 0.4);
      if (hasCanopy && maxCanopyW >= doorW + 0.3) {
        const canopyW = maxCanopyW;
        const canopyD = 1.5;
        const canopy = new THREE.BoxGeometry(canopyW, 0.12, canopyD);
        canopy.translate(doorOffset, doorH + 0.35, wallThickness / 2 + canopyD / 2);
        canopy.rotateY(frame.rotY);
        canopy.translate(frontEdge.x, baseY, frontEdge.z);
        const canopyColor = cat === 'commercial' ? 0x2a3b4c : 0xb04132;
        geos.push(paintGeometry(canopy, canopyColor, variant));
      }

      // 迎賓盆栽 (Planter Pots) - 需正門兩側有足夠餘裕 (>= doorW + 1.8)
      const hasPots = (architectureHash(idBase, 'pots') % 100) < 70;
      if (hasPots && frontLen >= doorW + 1.8) {
        for (const side of [-1, 1]) {
          const px = doorOffset + side * (doorW / 2 + 0.5);
          if (Math.abs(px) + 0.35 > frontLen / 2 - 0.2) continue;

          const pot = new THREE.CylinderGeometry(0.25, 0.18, 0.5, 8);
          pot.translate(px, 0.25, wallThickness / 2 + 0.35);
          pot.rotateY(frame.rotY);
          pot.translate(frontEdge.x, baseY, frontEdge.z);
          geos.push(paintGeometry(pot, 0xb86344, variant));

          const shrub = new THREE.SphereGeometry(0.3, 8, 6);
          shrub.translate(px, 0.65, wallThickness / 2 + 0.35);
          shrub.rotateY(frame.rotY);
          shrub.translate(frontEdge.x, baseY, frontEdge.z);
          geos.push(paintGeometry(shrub, 0x3d7043, variant));
        }
      }
    }
  }

  // 3. 側邊與後側地面物件 (側門、抽風機、塗鴉牆 - 依側邊長度容量分派)
  if (sideEdges.length > 0) {
    const sideEdge = sideEdges[0];
    const sFrame = getEdgeFrame(sideEdge, poly);
    const sLen = sFrame.len;

    // 側門 (Side Entrance) - 需側邊長度 >= 3.5m
    const hasSideDoor = (architectureHash(idBase, 'side_door') % 100) < 65;
    if (hasSideDoor && sLen >= 3.5) {
      const sOffset = (((architectureHash(idBase, 'sdoor_u') % 60) - 30) * 0.01) * (sLen - 2.0);
      const sDoor = new THREE.BoxGeometry(1.2, 2.2, 0.06);
      sDoor.translate(sOffset, 1.1, wallThickness / 2 + 0.03);
      sDoor.rotateY(sFrame.rotY);
      sDoor.translate(sideEdge.x, baseY, sideEdge.z);
      geos.push(paintGeometry(sDoor, 0x4f5459, variant));
    }

    // 抽風機 (Exhaust Fans) - 工業或商業，數量依側邊長度限制
    if (cat === 'industrial' || cat === 'commercial') {
      const maxFans = Math.min(3, Math.max(1, Math.floor(sLen / 3.0)));
      const fanCount = (architectureHash(idBase, 'fan_cnt') % maxFans) + 1;
      const fanBaseU = (((architectureHash(idBase, 'fan_base') % 40) - 20) * 0.01) * sLen;
      for (let i = 0; i < fanCount; i++) {
        const u = fanBaseU + (i - (fanCount - 1) / 2) * 1.4;
        if (Math.abs(u) + 0.5 > sLen / 2 - 0.2) break;

        const fanBox = new THREE.BoxGeometry(0.65, 0.65, 0.24);
        fanBox.translate(u, 2.0, wallThickness / 2 + 0.12);
        fanBox.rotateY(sFrame.rotY);
        fanBox.translate(sideEdge.x, baseY, sideEdge.z);
        geos.push(paintGeometry(fanBox, 0x76808a, variant));

        const vent = new THREE.CylinderGeometry(0.22, 0.22, 0.28, 8);
        vent.rotateX(Math.PI / 2);
        vent.translate(u, 2.0, wallThickness / 2 + 0.24);
        vent.rotateY(sFrame.rotY);
        vent.translate(sideEdge.x, baseY, sideEdge.z);
        geos.push(paintGeometry(vent, 0x343a40, variant));
      }
    }

    // 塗鴉牆 (Graffiti Wall) - 工業或住宅長牆面 (>= 6m)
    const hasGraffiti = (architectureHash(idBase, 'graffiti') % 100) < 45;
    if (hasGraffiti && (cat === 'industrial' || cat === 'residential') && sLen >= 6.0) {
      const gwW = Math.min(6.0, sLen * 0.65);
      const gwOffset = (((architectureHash(idBase, 'graf_pos') % 40) - 20) * 0.01) * (sLen - gwW);
      const graffiti = new THREE.BoxGeometry(gwW, 2.2, 0.04);
      graffiti.translate(gwOffset, 1.1, wallThickness / 2 + 0.02);
      graffiti.rotateY(sFrame.rotY);
      graffiti.translate(sideEdge.x, baseY, sideEdge.z);
      geos.push(paintGeometry(graffiti, 0x8e24aa, variant));
    }
  }

  // 4. 立面高程物件 (招牌、電視牆、看板、選舉廣告、逃生梯、陽台、曬衣架、冷氣、旗幟)
  for (const edge of edges) {
    const frame = getEdgeFrame(edge, poly);
    const len = frame.len;
    if (len < 3.2) continue;
    const floors = Math.max(1, Math.floor(height / 3.2));
    const floorH = height / floors;

    // 招牌 (Blade Sign - 垂直側看板，偏向立面邊角)
    const hasBladeSign = (architectureHash(`${idBase}:${edge.x}`, 'blade') % 100) < 65;
    if (hasBladeSign && floors >= 2 && len >= 4.5) {
      const signSide = (architectureHash(`${idBase}:${edge.x}`, 'blade_side') % 2) === 0 ? 1 : -1;
      const signU = signSide * Math.min(len * 0.38, len / 2 - 0.8);
      const signH = Math.min(3.6, floorH * 1.5);
      const signGeo = new THREE.BoxGeometry(0.12, signH, 0.9);
      signGeo.translate(signU, 3.8 + signH / 2, wallThickness / 2 + 0.45);
      signGeo.rotateY(frame.rotY);
      signGeo.translate(edge.x, baseY, edge.z);
      const signColor = (architectureHash(`${idBase}:${edge.z}`, 'sign_col') % 2) ? 0xe65100 : 0x0277bd;
      geos.push(paintGeometry(signGeo, signColor, variant));
    }

    // 電視牆 (LED Video Wall) - 商業高層且立面與面積足夠
    const hasVideoWall = (architectureHash(`${idBase}:${edge.x}`, 'video_wall') % 100) < 35;
    if (hasVideoWall && cat === 'commercial' && height >= 24 && len >= 12.0 && (metrics?.area || 0) >= 180) {
      const vwW = Math.min(10.0, len * 0.65);
      const vwH = Math.min(12.0, floorH * 2.5);
      const vwall = new THREE.BoxGeometry(vwW, vwH, 0.16);
      vwall.translate(0, height * 0.45, wallThickness / 2 + 0.08);
      vwall.rotateY(frame.rotY);
      vwall.translate(edge.x, baseY, edge.z);
      geos.push(paintGeometry(vwall, 0x00e5ff, variant));
    }

    // 看板 / 大型廣告看板 (Billboard)
    const hasAdBoard = (architectureHash(`${idBase}:${edge.x}`, 'ad_board') % 100) < 40;
    if (hasAdBoard && len >= 8.0 && height >= 14 && !hasVideoWall) {
      const adW = Math.min(8.0, len * 0.55);
      const adH = Math.min(4.5, floorH * 1.4);
      const adBoard = new THREE.BoxGeometry(adW, adH, 0.12);
      adBoard.translate(0, height * 0.65, wallThickness / 2 + 0.06);
      adBoard.rotateY(frame.rotY);
      adBoard.translate(edge.x, baseY, edge.z);
      geos.push(paintGeometry(adBoard, 0xf5f5dc, variant));
    }

    // 選舉廣告牆 (Election Banner)
    const hasElection = (architectureHash(`${idBase}:${edge.x}`, 'election') % 100) < 28;
    if (hasElection && (cat === 'residential' || cat === 'commercial') && height >= 8 && len >= 6.0) {
      const elW = Math.min(3.2, len * 0.4);
      const elH = Math.min(6.5, height * 0.6);
      const elSide = (architectureHash(`${idBase}:${edge.x}`, 'el_side') % 2) === 0 ? 1 : -1;
      const elU = elSide * (len * 0.25);
      const elBoard = new THREE.BoxGeometry(elW, elH, 0.08);
      elBoard.translate(elU, elH / 2 + 1.2, wallThickness / 2 + 0.04);
      elBoard.rotateY(frame.rotY);
      elBoard.translate(edge.x, baseY, edge.z);
      const partyColor = (architectureHash(idBase, 'party') % 2) ? 0x00c853 : 0x2979ff;
      geos.push(paintGeometry(elBoard, partyColor, variant));
    }

    // 逃生梯 (Fire Escape Stairway) - 位於側端角落邊緣
    const hasFireEscape = (architectureHash(`${idBase}:${edge.x}`, 'fire_escape') % 100) < 35;
    if (hasFireEscape && floors >= 3 && len >= 6.5 && height >= 12) {
      const feSide = (architectureHash(`${idBase}:${edge.x}`, 'fe_side') % 2) === 0 ? 1 : -1;
      const feU = feSide * (len / 2 - 1.2);
      for (let f = 1; f < floors; f++) {
        const fy = f * floorH;
        // 平台
        const platform = new THREE.BoxGeometry(1.6, 0.1, 1.1);
        platform.translate(feU, fy, wallThickness / 2 + 0.55);
        platform.rotateY(frame.rotY);
        platform.translate(edge.x, baseY, edge.z);
        geos.push(paintGeometry(platform, 0x37474f, variant));

        // 欄杆
        const rail = new THREE.BoxGeometry(1.6, 0.8, 0.05);
        rail.translate(feU, fy + 0.4, wallThickness / 2 + 1.1);
        rail.rotateY(frame.rotY);
        rail.translate(edge.x, baseY, edge.z);
        geos.push(paintGeometry(rail, 0x455a64, variant));
      }
      // 連接梯身
      const ladderH = (floors - 1) * floorH;
      const ladder = new THREE.BoxGeometry(0.35, ladderH, 0.1);
      ladder.translate(feU + 0.6 * feSide, floorH + ladderH / 2, wallThickness / 2 + 0.6);
      ladder.rotateY(frame.rotY);
      ladder.translate(edge.x, baseY, edge.z);
      geos.push(paintGeometry(ladder, 0x263238, variant));
    }

    // 陽台 (Balconies) & 曬衣架 (Drying Racks) - 住宅類
    if (cat === 'residential' && floors >= 2 && len >= 7.5) {
      const bays = Math.max(1, Math.floor(len / 4.5));
      for (let f = 1; f < floors; f++) {
        const fy = f * floorH;
        for (let b = 0; b < bays; b++) {
          const u = -len / 2 + (b + 0.5) * (len / bays);
          const balW = Math.min(2.8, (len / bays) * 0.7);

          // 陽台底板
          const bSlab = new THREE.BoxGeometry(balW, 0.12, 1.2);
          bSlab.translate(u, fy, wallThickness / 2 + 0.6);
          bSlab.rotateY(frame.rotY);
          bSlab.translate(edge.x, baseY, edge.z);
          geos.push(paintGeometry(bSlab, architecture.trim || 0x616161, variant));

          // 陽台欄杆
          const bRail = new THREE.BoxGeometry(balW, 0.8, 0.06);
          bRail.translate(u, fy + 0.4, wallThickness / 2 + 1.2);
          bRail.rotateY(frame.rotY);
          bRail.translate(edge.x, baseY, edge.z);
          geos.push(paintGeometry(bRail, 0x424242, variant));

          // 曬衣架 (Clothes Drying Rack)
          const hasDrying = (architectureHash(`${idBase}:${f}:${b}`, 'dry') % 100) < 55;
          if (hasDrying) {
            const pole = new THREE.BoxGeometry(balW * 0.8, 0.04, 0.04);
            pole.translate(u, fy + 1.4, wallThickness / 2 + 0.6);
            pole.rotateY(frame.rotY);
            pole.translate(edge.x, baseY, edge.z);
            geos.push(paintGeometry(pole, 0x90a4ae, variant));

            // 垂掛衣物塊
            const clothesCol = (architectureHash(`${idBase}:${f}:${b}`, 'cloth_col') % 3);
            const col = clothesCol === 0 ? 0xffffff : clothesCol === 1 ? 0xef5350 : 0x42a5f5;
            const cloth = new THREE.BoxGeometry(0.4, 0.55, 0.06);
            cloth.translate(u, fy + 1.1, wallThickness / 2 + 0.6);
            cloth.rotateY(frame.rotY);
            cloth.translate(edge.x, baseY, edge.z);
            geos.push(paintGeometry(cloth, col, variant));
          }
        }
      }
    }

    // 冷氣室外機 (AC Outdoor Units)
    const bays = Math.min(6, Math.max(1, Math.floor(len / 3.4)));
    for (let f = 0; f < floors; f++) {
      const fy = f * floorH;
      for (let b = 0; b < bays; b++) {
        const hasAc = (architectureHash(`${idBase}:${f}:${b}`, 'ac') % 100) < 65;
        if (!hasAc) continue;
        const u = -len / 2 + (b + 0.35) * (len / bays);
        const acY = fy + 0.6;
        const acUnit = new THREE.BoxGeometry(0.85, 0.55, 0.4);
        acUnit.translate(u, acY, wallThickness / 2 + 0.2);
        acUnit.rotateY(frame.rotY);
        acUnit.translate(edge.x, baseY, edge.z);
        geos.push(paintGeometry(acUnit, 0xe0e0e0, variant));

        const acGrill = new THREE.BoxGeometry(0.4, 0.4, 0.04);
        acGrill.translate(u, acY, wallThickness / 2 + 0.41);
        acGrill.rotateY(frame.rotY);
        acGrill.translate(edge.x, baseY, edge.z);
        geos.push(paintGeometry(acGrill, 0x616161, variant));
      }
    }

    // 旗幟 (Flagpole with Flag) - 觀光、文化或市政
    const hasFlag = (architectureHash(`${idBase}:${edge.x}`, 'flag') % 100) < 35;
    if (hasFlag && (cat === 'tourism' || cat === 'commercial') && height >= 8 && len >= 8.0) {
      const pole = new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6);
      pole.rotateZ(-0.35);
      pole.translate(0, height * 0.5, wallThickness / 2 + 0.4);
      pole.rotateY(frame.rotY);
      pole.translate(edge.x, baseY, edge.z);
      geos.push(paintGeometry(pole, 0xffd54f, variant));

      const flag = new THREE.BoxGeometry(0.9, 0.55, 0.04);
      flag.translate(0.5, height * 0.5 + 0.6, wallThickness / 2 + 0.6);
      flag.rotateY(frame.rotY);
      flag.translate(edge.x, baseY, edge.z);
      geos.push(paintGeometry(flag, 0xd32f2f, variant));
    }
  }

  // 5. 頂部物件生成 (角落/邊緣/中心分派，附帶屋頂面積與跨度容量檢查)
  if (metrics && metrics.span >= 3.0 && metrics.area >= 20.0) {
    const { span, area } = metrics;
    const { corners, edges, center } = sites;

    // Helper: 獲取指定優先順序的位置（角落、邊緣或中心）
    function pickSite(preference = 'corner', seedTag = 'site') {
      const hashVal = architectureHash(idBase, seedTag);
      if (preference === 'corner' && corners.length > 0) {
        return corners[hashVal % corners.length];
      }
      if (preference === 'edge' && edges.length > 0) {
        return edges[hashVal % edges.length];
      }
      if (preference === 'center' && center) {
        return center;
      }
      return center || corners[0] || edges[0] || null;
    }

    // 5.1 鐘樓 (Clock Tower) - 觀光、文化或大型商用；需屋頂面積 >= 160m²、跨度 >= 14m、樓高 >= 10m，且相容於當前屋頂類型
    const canClock = (cat === 'tourism' || cat === 'civic' || cat === 'commercial') &&
                     area >= 160 && span >= 14 && height >= 10 && allowedRooftopParts.has('clock_tower');
    const hasClock = canClock && ((architectureHash(idBase, 'clock_tower') % 100) < 35);
    if (hasClock) {
      const clockSite = pickSite('corner', 'clock_pos');
      // 鐘樓出挑線腳半寬 1.7m，嚴格預留 1.2m 邊界留白 (淨距需 >= 2.9m)
      if (clockSite && isSiteValid(poly, clockSite.x, clockSite.z, 1.7, 1.2)) {
        const cx = clockSite.x, cz = clockSite.z;
        const baseRoofY = getRoofElevation(cx, cz, poly, roofForm, metrics, topY);
        const shaftH = Math.min(8.5, Math.max(5.5, height * 0.35));

        // 鐘樓主塔身 (Stone/brick shaft)
        const shaft = new THREE.BoxGeometry(3.0, shaftH, 3.0);
        shaft.translate(cx, baseRoofY + shaftH / 2, cz);
        geos.push(paintGeometry(shaft, architecture.wall || 0xd5cbbb, variant));

        // 線腳腰帶 (Mid cornice)
        const cornice = new THREE.BoxGeometry(3.4, 0.4, 3.4);
        cornice.translate(cx, baseRoofY + shaftH + 0.2, cz);
        geos.push(paintGeometry(cornice, architecture.trim || 0x6e5d50, variant));

        // 時鐘室 (Clock chamber)
        const chamberH = 2.6;
        const chamber = new THREE.BoxGeometry(3.2, chamberH, 3.2);
        chamber.translate(cx, baseRoofY + shaftH + 0.4 + chamberH / 2, cz);
        geos.push(paintGeometry(chamber, architecture.wall || 0xd5cbbb, variant));

        // 四面時鐘圓盤 (4 Clock dials with hour hands)
        const clockY = baseRoofY + shaftH + 0.4 + chamberH / 2;
        const dialRotations = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
        for (const rot of dialRotations) {
          // 圓形錶盤底座
          const dial = new THREE.CylinderGeometry(0.85, 0.85, 0.12, 16);
          dial.rotateX(Math.PI / 2);
          dial.translate(0, 0, 1.62);
          dial.rotateY(rot);
          dial.translate(cx, clockY, cz);
          geos.push(paintGeometry(dial, 0xfafafa, variant));

          // 外環黑邊框
          const rim = new THREE.CylinderGeometry(0.92, 0.92, 0.08, 16);
          rim.rotateX(Math.PI / 2);
          rim.translate(0, 0, 1.60);
          rim.rotateY(rot);
          rim.translate(cx, clockY, cz);
          geos.push(paintGeometry(rim, 0x212121, variant));

          // 指針 (Cross hands)
          const hand = new THREE.BoxGeometry(0.12, 0.65, 0.04);
          hand.translate(0, 0.15, 1.70);
          hand.rotateY(rot);
          hand.translate(cx, clockY, cz);
          geos.push(paintGeometry(hand, 0x1a1a1a, variant));
        }

        // 尖錐塔頂 (Spire cap / copper roof)
        const capH = 3.6;
        const cap = new THREE.ConeGeometry(2.3, capH, 4);
        cap.rotateY(Math.PI / 4);
        cap.translate(cx, baseRoofY + shaftH + 0.4 + chamberH + capH / 2, cz);
        geos.push(paintGeometry(cap, architecture.roof || 0x386b58, variant));

        // 避雷針 / 風向計 (Weather vane needle)
        const needle = new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6);
        needle.translate(cx, baseRoofY + shaftH + 0.4 + chamberH + capH + 0.8, cz);
        geos.push(paintGeometry(needle, 0xffd54f, variant));
      }
    }

    // 5.2 尖塔 (Rooftop Spire) - 觀光、宗教或古典住宅；需面積 >= 100m²、跨度 >= 10m、樓高 >= 12m，且相容於當前屋頂類型
    const canSpire = (cat === 'tourism' || cat === 'residential' || cat === 'commercial') &&
                     area >= 100 && span >= 10 && height >= 12 && !hasClock && allowedRooftopParts.has('rooftop_spire');
    const hasSpire = canSpire && ((architectureHash(idBase, 'rooftop_spire') % 100) < 35);
    if (hasSpire) {
      const spireCount = Math.min(2, Math.max(1, (architectureHash(idBase, 'spire_cnt') % 2) + 1));
      for (let s = 0; s < spireCount; s++) {
        const spireSite = (s === 0 ? pickSite('corner', 'spire_0') : (corners[1] || pickSite('edge', 'spire_1')));
        // 基座半徑 1.35m，保留 1.0m 留白 (淨距需 >= 2.35m)
        if (spireSite && isSiteValid(poly, spireSite.x, spireSite.z, 1.35, 1.0)) {
          const sx = spireSite.x, sz = spireSite.z;
          const baseRoofY = getRoofElevation(sx, sz, poly, roofForm, metrics, topY);

          // 八角基座 (Octagonal plinth)
          const plinth = new THREE.CylinderGeometry(1.2, 1.35, 1.4, 8);
          plinth.translate(sx, baseRoofY + 0.7, sz);
          geos.push(paintGeometry(plinth, architecture.trim || 0x78909c, variant));

          // 拱廊身 (Middle belfry)
          const midH = 2.0;
          const midBody = new THREE.CylinderGeometry(0.95, 1.1, midH, 8);
          midBody.translate(sx, baseRoofY + 1.4 + midH / 2, sz);
          geos.push(paintGeometry(midBody, architecture.wall || 0x90a4ae, variant));

          // 細長哥德尖塔 (Slender spire cone)
          const spireH = Math.min(9.0, Math.max(6.0, height * 0.3));
          const spireCone = new THREE.ConeGeometry(0.85, spireH, 8);
          spireCone.translate(sx, baseRoofY + 1.4 + midH + spireH / 2, sz);
          geos.push(paintGeometry(spireCone, architecture.roof || 0x455a64, variant));

          // 尖端飾頂 (Finial rod)
          const finial = new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6);
          finial.translate(sx, baseRoofY + 1.4 + midH + spireH + 0.6, sz);
          geos.push(paintGeometry(finial, 0xd4af37, variant));
        }
      }
    }

    // 5.3 停機坪與直升機棚 (Heli Hangar & Helipad) - 大型商用或工業；需面積 >= 500m²、跨度 >= 24m、樓高 >= 28m，且僅平頂相容
    const canHeli = (cat === 'commercial' || cat === 'industrial') &&
                    area >= 500 && span >= 24 && height >= 28 && !hasClock && allowedRooftopParts.has('heli_hangar');
    const hasHeli = canHeli && ((architectureHash(idBase, 'heli_hangar') % 100) < 40);
    if (hasHeli) {
      const heliSite = pickSite('center', 'heli_pos');
      // 停機甲板半徑 7.8m，嚴格保留 1.5m 邊緣安全走廊留白 (淨距需 >= 9.3m)
      if (heliSite && isSiteValid(poly, heliSite.x, heliSite.z, 7.8, 1.5)) {
        const hx = heliSite.x, hz = heliSite.z;
        const baseRoofY = getRoofElevation(hx, hz, poly, roofForm, metrics, topY);

        // 八角高架停機坪 (Octagonal Helipad deck)
        const deck = new THREE.CylinderGeometry(7.5, 7.8, 0.45, 8);
        deck.translate(hx, baseRoofY + 0.225, hz);
        geos.push(paintGeometry(deck, 0x263238, variant));

        // 停機坪黃白導引邊界圈 (Perimeter border ring)
        const ring = new THREE.CylinderGeometry(7.6, 7.6, 0.48, 8);
        ring.translate(hx, baseRoofY + 0.24, hz);
        geos.push(paintGeometry(ring, 0xfff59d, variant));

        // "H" 字母標誌 (Yellow "H" Marking)
        for (const side of [-1, 1]) {
          const vBar = new THREE.BoxGeometry(0.65, 0.08, 4.4);
          vBar.translate(hx + side * 1.5, baseRoofY + 0.50, hz);
          geos.push(paintGeometry(vBar, 0xffeb3b, variant));
        }
        const hBar = new THREE.BoxGeometry(2.4, 0.08, 0.65);
        hBar.translate(hx, baseRoofY + 0.50, hz);
        geos.push(paintGeometry(hBar, 0xffeb3b, variant));

        // 4 角導航指示燈 (Perimeter navigation lights)
        const lightOffsets = [
          [-5.2, -5.2], [5.2, -5.2], [5.2, 5.2], [-5.2, 5.2],
        ];
        for (const [lx, lz] of lightOffsets) {
          const lampStand = new THREE.CylinderGeometry(0.12, 0.12, 0.45, 6);
          lampStand.translate(hx + lx, baseRoofY + 0.68, hz + lz);
          geos.push(paintGeometry(lampStand, 0x78909c, variant));

          const lamp = new THREE.SphereGeometry(0.16, 6, 6);
          lamp.translate(hx + lx, baseRoofY + 0.95, hz + lz);
          geos.push(paintGeometry(lamp, 0x00e676, variant));
        }

        // 若跨度夠大 (>= 28m)，在後側配置圓拱直升機棚 (半徑 4.0m，保留 1.5m 留白)
        if (span >= 28 && isSiteValid(poly, hx, hz - 8.5, 4.0, 1.5)) {
          const hangarW = 7.5, hangarD = 5.5, hangarH = 4.2;
          const hangarRoof = new THREE.CylinderGeometry(hangarW / 2, hangarW / 2, hangarD, 12, 1, false, 0, Math.PI);
          hangarRoof.rotateZ(Math.PI / 2);
          hangarRoof.translate(hx, baseRoofY + 0.2 + hangarH * 0.6, hz - 8.5);
          geos.push(paintGeometry(hangarRoof, 0x455a64, variant));

          const hangarWall = new THREE.BoxGeometry(hangarW, hangarH * 0.6, hangarD);
          hangarWall.translate(hx, baseRoofY + (hangarH * 0.6) / 2, hz - 8.5);
          geos.push(paintGeometry(hangarWall, 0x607d8b, variant));

          // 飛航風向筒 (Windsock mast)
          const pole = new THREE.CylinderGeometry(0.05, 0.05, 2.8, 6);
          pole.translate(hx + 4.5, baseRoofY + 1.4, hz - 6.0);
          geos.push(paintGeometry(pole, 0xff9800, variant));

          const windsock = new THREE.ConeGeometry(0.28, 0.9, 6);
          windsock.rotateZ(-Math.PI / 2);
          windsock.translate(hx + 4.9, baseRoofY + 2.7, hz - 6.0);
          geos.push(paintGeometry(windsock, 0xff5722, variant));
        }
      }
    }

    // 5.4 白鐵不銹鋼水塔 (Water Tank) - 需平頂或相容屋面，各水塔單體均嚴格檢查邊界留白
    const hasWaterTank = ((architectureHash(idBase, 'water_tank') % 100) < 85) && !hasHeli && allowedRooftopParts.has('water_tank');
    if (hasWaterTank) {
      const tankSite = pickSite('corner', 'tank_pos');
      if (tankSite) {
        const tankCount = area < 80 ? 1 : (area < 220 ? 2 : 3);
        for (let i = 0; i < tankCount; i++) {
          const ox = tankSite.x + (i - (tankCount - 1) / 2) * 1.6;
          const oz = tankSite.z;
          // 水塔支架半徑 0.7m，嚴格預留 0.9m 留白空間 (淨距需 >= 1.6m)
          if (!isSiteValid(poly, ox, oz, 0.7, 0.9)) continue;
          const baseRoofY = getRoofElevation(ox, oz, poly, roofForm, metrics, topY);

          // 支架
          const stand = new THREE.BoxGeometry(1.3, 0.6, 1.3);
          stand.translate(ox, baseRoofY + 0.3, oz);
          geos.push(paintGeometry(stand, 0x455a64, variant));

          // 圓筒水塔
          const tank = new THREE.CylinderGeometry(0.65, 0.65, 1.4, 10);
          tank.translate(ox, baseRoofY + 1.3, oz);
          geos.push(paintGeometry(tank, 0xdfe6e9, variant));

          // 水塔錐頂蓋
          const cap = new THREE.ConeGeometry(0.68, 0.35, 10);
          cap.translate(ox, baseRoofY + 2.15, oz);
          geos.push(paintGeometry(cap, 0xb2bec3, variant));
        }
      }
    }

    // 5.5 魚骨電視天線 (Antenna) - 置於角落、山牆脊頂或女兒牆邊緣內側留白處
    const hasAntenna = ((architectureHash(idBase, 'antenna') % 100) < 60) && !hasHeli && allowedRooftopParts.has('antenna');
    if (hasAntenna) {
      const antSite = pickSite('corner', 'antenna_pos') || pickSite('edge', 'antenna_pos');
      if (antSite && isSiteValid(poly, antSite.x, antSite.z, 0.4, 0.9)) {
        const ax = antSite.x, az = antSite.z;
        const baseRoofY = getRoofElevation(ax, az, poly, roofForm, metrics, topY);
        const mast = new THREE.CylinderGeometry(0.04, 0.04, 2.8, 6);
        mast.translate(ax, baseRoofY + 1.4, az);
        geos.push(paintGeometry(mast, 0x90a4ae, variant));

        for (let i = 0; i < 3; i++) {
          const crossbar = new THREE.BoxGeometry(0.75 - i * 0.15, 0.03, 0.03);
          crossbar.translate(ax, baseRoofY + 2.0 + i * 0.3, az);
          geos.push(paintGeometry(crossbar, 0xb0bec5, variant));
        }
      }
    }

    // 5.6 通訊基地台塔 (Cellular Mast) - 商業摩天樓或高層公寓邊緣/角落，保留 0.9m 留白
    const hasCellular = ((architectureHash(idBase, 'cellular') % 100) < 35) && height >= 24 && area >= 120 && !hasHeli && allowedRooftopParts.has('cellular_mast');
    if (hasCellular) {
      const cellSite = pickSite('edge', 'cellular_pos') || pickSite('corner', 'cellular_pos');
      if (cellSite && isSiteValid(poly, cellSite.x, cellSite.z, 0.65, 0.9)) {
        const cx = cellSite.x, cz = cellSite.z;
        const baseRoofY = getRoofElevation(cx, cz, poly, roofForm, metrics, topY);
        // 三角桁架塔身
        const tower = new THREE.CylinderGeometry(0.25, 0.38, 4.0, 3);
        tower.translate(cx, baseRoofY + 2.0, cz);
        geos.push(paintGeometry(tower, 0x78909c, variant));

        // 3 面定向天線板
        for (let a = 0; a < 3; a++) {
          const ang = (a * Math.PI * 2) / 3;
          const ant = new THREE.BoxGeometry(0.18, 1.1, 0.1);
          ant.translate(Math.cos(ang) * 0.32, 0, Math.sin(ang) * 0.32);
          ant.translate(cx, baseRoofY + 3.8, cz);
          geos.push(paintGeometry(ant, 0xffffff, variant));
        }
      }
    }

    // 5.7 太陽能光伏板陣列 (Solar Panels Array) - 各板獨立檢驗邊界留白
    const hasSolar = ((architectureHash(idBase, 'solar') % 100) < 45) && area >= 80 && span >= 8 && !hasHeli && allowedRooftopParts.has('solar_array');
    if (hasSolar) {
      const solarSite = pickSite('center', 'solar_pos');
      if (solarSite) {
        const count = Math.min(4, Math.max(2, Math.floor(area / 90)));
        for (let i = 0; i < count; i++) {
          const sx = solarSite.x + (i - (count - 1) / 2) * 1.8;
          const sz = solarSite.z;
          // 光伏板半徑 0.85m，保留 0.9m 留白 (淨距需 >= 1.75m)
          if (!isSiteValid(poly, sx, sz, 0.85, 0.9)) continue;
          const baseRoofY = getRoofElevation(sx, sz, poly, roofForm, metrics, topY);

          const panel = new THREE.BoxGeometry(1.5, 0.06, 1.0);
          panel.rotateX(0.35); // 朝向日照傾角
          panel.translate(sx, baseRoofY + 0.35, sz);
          geos.push(paintGeometry(panel, 0x1a237e, variant));

          const leg = new THREE.BoxGeometry(1.4, 0.25, 0.06);
          leg.translate(sx, baseRoofY + 0.125, sz + 0.4);
          geos.push(paintGeometry(leg, 0x9e9e9e, variant));
        }
      }
    }

    // 5.8 木造鴿棚 (Rooftop Pigeon Coop) - 住宅後側角落或邊緣，保留 1.0m 留白
    const hasCoop = ((architectureHash(idBase, 'coop') % 100) < 25) && (cat === 'residential' || cat === 'rural') && area >= 60 && span >= 6 && !hasHeli && allowedRooftopParts.has('pigeon_coop');
    if (hasCoop) {
      const coopSite = pickSite('corner', 'coop_pos') || pickSite('edge', 'coop_pos');
      if (coopSite && isSiteValid(poly, coopSite.x, coopSite.z, 1.0, 1.0)) {
        const px = coopSite.x, pz = coopSite.z;
        const baseRoofY = getRoofElevation(px, pz, poly, roofForm, metrics, topY);
        // 木棚主體
        const coop = new THREE.BoxGeometry(1.8, 1.4, 1.5);
        coop.translate(px, baseRoofY + 1.2, pz);
        geos.push(paintGeometry(coop, 0x795548, variant));

        // 跳板平台
        const shelf = new THREE.BoxGeometry(1.2, 0.06, 0.6);
        shelf.translate(px, baseRoofY + 0.8, pz + 0.95);
        geos.push(paintGeometry(shelf, 0x8d6e63, variant));

        // 支柱
        const stilts = new THREE.BoxGeometry(1.7, 0.5, 1.4);
        stilts.translate(px, baseRoofY + 0.25, pz);
        geos.push(paintGeometry(stilts, 0x5d4037, variant));
      }
    }

    // 5.9 排煙煙囪 (Chimney / Smokestack) - 鄉村、工業或壁爐，邊緣或斜坡穿出，保留 0.9m 留白
    const hasChimney = ((architectureHash(idBase, 'chimney') % 100) < 55) && (cat === 'rural' || cat === 'industrial' || cat === 'residential') && area >= 35 && span >= 4 && !hasHeli && allowedRooftopParts.has('chimney');
    if (hasChimney) {
      const chSite = pickSite('edge', 'chimney_pos') || pickSite('corner', 'chimney_pos');
      if (chSite && isSiteValid(poly, chSite.x, chSite.z, 0.45, 0.9)) {
        const chX = chSite.x, chZ = chSite.z;
        const baseRoofY = getRoofElevation(chX, chZ, poly, roofForm, metrics, topY);
        const chH = cat === 'industrial' ? 3.6 : 1.8;
        const chBody = cat === 'industrial'
          ? new THREE.CylinderGeometry(0.3, 0.35, chH, 8)
          : new THREE.BoxGeometry(0.65, chH, 0.65);
        chBody.translate(chX, baseRoofY + chH / 2, chZ);
        geos.push(paintGeometry(chBody, cat === 'industrial' ? 0x424242 : 0xa0402e, variant));

        const chCap = new THREE.ConeGeometry(0.45, 0.25, 8);
        chCap.translate(chX, baseRoofY + chH + 0.15, chZ);
        geos.push(paintGeometry(chCap, 0x212121, variant));
      }
    }

    // 5.10 屋頂大型廣告架 (Roof Billboard) - 商業高層前緣，雙側嚴格留白
    const hasRoofBoard = ((architectureHash(idBase, 'roof_board') % 100) < 40) && cat === 'commercial' && height >= 18 && span >= 14 && area >= 150 && !hasHeli && frontEdge && allowedRooftopParts.has('roof_billboard');
    if (hasRoofBoard && frontEdge) {
      const bSite = pickSite('edge', 'rb_pos');
      if (bSite) {
        // 看板寬度必須嚴格受限於邊界淨距，左右兩端預留至少 1.2m 留白
        const maxSafeW = Math.max(2.4, Math.min(8.0, (distanceToPolyBoundary(bSite.x, bSite.z, poly) - 1.2) * 2));
        const bbW = Math.min(maxSafeW, span * 0.55);
        const bbH = 3.6;
        if (bbW >= 3.0 &&
            isSiteValid(poly, bSite.x - bbW * 0.45, bSite.z, 0.4, 0.9) &&
            isSiteValid(poly, bSite.x + bbW * 0.45, bSite.z, 0.4, 0.9)) {
          const baseRoofY = getRoofElevation(bSite.x, bSite.z, poly, roofForm, metrics, topY);
          // 鋼構支架柱
          for (const legSide of [-1, 1]) {
            const leg = new THREE.CylinderGeometry(0.1, 0.1, 2.2, 6);
            leg.translate(bSite.x + legSide * (bbW * 0.35), baseRoofY + 1.1, bSite.z);
            geos.push(paintGeometry(leg, 0x546e7a, variant));
          }

          // 看板大版面
          const board = new THREE.BoxGeometry(bbW, bbH, 0.18);
          board.translate(bSite.x, baseRoofY + 2.2 + bbH / 2, bSite.z);
          geos.push(paintGeometry(board, 0xfff9c4, variant));
        }
      }
    }
  }

  return geos;
}

