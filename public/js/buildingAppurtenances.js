// ============ 建築外部零件程序化生成系統 ============
// 涵蓋：招牌、看板、大門、側門、電視牆、選舉廣告牆、塗鴉牆、遮雨棚、逃生梯、盆栽、
// 陽台、冷氣室外機、抽風機、水塔、天線、基地台、太陽能板、曬衣架、鴿棚、旗幟、煙囪、
// 鐘樓、尖塔、直升機棚。
// 依功能類別置於正確結構部位（頂部角落/邊緣/中心、正門地面、側邊地面、立面高程），
// 根據建物生成後的實體尺寸（長度、高度、屋頂面積、跨度）進行空間容量保護與確定性隨機配置。
import * as THREE from 'three';
import { wallDecorationParts } from './wallDecorations.js';
import { WALL_DECORATION_RULES, WALL_DECORATION_LIMIT } from './wallDecorationCatalog.js';
import { architecturePartGeometry } from './architecturePartGeometry.js';
import { architectureHash } from './buildingDiversity.js';
import { roofDimensions, sectionRoofProfile, sectionRoofHeight } from './roofProfiles.js';
import { paintGeometry, pointInRing, attachmentSite } from './osmBuilding.js';
import {
  ROOF_APPURTENANCE_COMPATIBILITY,
  distanceToSegment,
  distanceToPolyBoundary,
  isSiteValid,
  computeOrientedRoofFrame,
} from './architectureStyles.js';

export { distanceToSegment, distanceToPolyBoundary, isSiteValid };

/** 外部零件型錄定義與配置規則 */
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

  // 擴充屋頂範圍零件 (Rooftop Extent Parts, 面積佔比 20~80%)
  rooftop_canopy: {
    slot: 'rooftop',
    categories: ['residential', 'commercial', 'industrial', 'rural'],
    maxCount: 1, prob: 0.40, minArea: 40, minSpan: 6,
  },
  drying_room: {
    slot: 'rooftop',
    categories: ['residential', 'rural'],
    maxCount: 1, prob: 0.45, minArea: 35, minSpan: 5,
  },
  roof_garden: {
    slot: 'rooftop',
    categories: ['residential', 'commercial', 'tourism', 'civic'],
    maxCount: 1, prob: 0.35, minArea: 60, minSpan: 7,
  },

  // 擴充屋頂獨立零件 (Rooftop Standalone Parts)
  stairwell_penthouse: {
    slot: 'rooftop',
    categories: ['residential', 'commercial', 'industrial', 'tourism', 'civic'],
    maxCount: 1, prob: 0.70, minArea: 40, minSpan: 5,
  },
  rooftop_shrine: {
    slot: 'rooftop',
    categories: ['residential', 'commercial', 'rural'],
    maxCount: 1, prob: 0.25, minArea: 30, minSpan: 4,
  },
  pingpong_table: {
    slot: 'rooftop',
    categories: ['residential', 'commercial', 'civic'],
    maxCount: 2, prob: 0.30, minArea: 40, minSpan: 5,
  },
  pool_table: {
    slot: 'rooftop',
    categories: ['commercial', 'residential', 'tourism'],
    maxCount: 1, prob: 0.25, minArea: 50, minSpan: 6,
  },
  rooftop_sofa: {
    slot: 'rooftop',
    categories: ['residential', 'commercial', 'tourism'],
    maxCount: 2, prob: 0.40, minArea: 35, minSpan: 5,
  },
  table_chairs: {
    slot: 'rooftop',
    categories: ['residential', 'commercial', 'tourism', 'civic'],
    maxCount: 3, prob: 0.50, minArea: 25, minSpan: 4,
  },
  gazebo: {
    slot: 'rooftop',
    categories: ['residential', 'tourism', 'civic', 'commercial'],
    maxCount: 1, prob: 0.30, minArea: 70, minSpan: 8,
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

  // 立面與側邊高程物件 (Facade & Upper Sides)
  blade_sign: {
    slot: 'facade',
    categories: ['commercial', 'residential'],
    maxCount: 3, prob: 0.80, minLength: 4.5,
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
  ...WALL_DECORATION_RULES,
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
  const len = edge.hw2 != null ? edge.hw2 * 2 : (edge.len || 0);
  const ry = edge.ry ?? (edge.nx != null && edge.nz != null ? Math.atan2(-edge.nx, edge.nz) : 0);
  const nx = -Math.sin(ry);
  const nz = Math.cos(ry);
  const testDist = 0.25;
  const isInside = pointInRing(edge.x + nx * testDist, edge.z + nz * testDist, poly.outer) &&
    !(poly.holes || []).some(h => pointInRing(edge.x + nx * testDist, edge.z + nz * testDist, h));
  const outNx = isInside ? -nx : nx;
  const outNz = isInside ? -nz : nz;
  const rotY = Math.atan2(outNx, outNz);
  return { outNx, outNz, rotY, len };
}

/** 依屋頂造型計算指定 (x, z) 點的實際屋頂面高度，杜絕屋頂構件漂浮或埋入 */
export function getRoofElevation(x, z, poly, roofForm = 'flat', metrics = null, topY = 0, height = 10) {
  if (!roofForm || roofForm === 'flat' || !poly?.outer?.length) return topY;
  const frame = metrics?.frame || computeOrientedRoofFrame(poly);
  if (!frame) return topY;
  const { len, span, cx, cz, dirX, dirZ, normalX, normalZ } = frame;
  const { rise: roofH } = roofDimensions(span, height);

  const dx = x - cx, dz = z - cz;
  const uDist = dx * dirX + dz * dirZ;
  const vDist = dx * normalX + dz * normalZ;
  const section = sectionRoofProfile(roofForm, span, height);
  if (section) return topY + sectionRoofHeight(section, vDist);

  if (roofForm === 'stepped') {
    const distRatio = Math.max(Math.abs(uDist) / (len / 2 || 1), Math.abs(vDist) / (span / 2 || 1));
    const tier = distRatio > 0.66 ? 0 : distRatio > 0.33 ? 1 : 2;
    return topY + tier * (roofH * 0.28);
  }

  const distFromRidge = Math.abs(vDist);
  const halfSpan = Math.max(0.5, span / 2);
  const slopeRatio = Math.max(0, Math.min(1, 1 - distFromRidge / halfSpan));

  if (roofForm === 'shed') {
    // 視覺楔形高邊位於局部 -Z（經 rotateY(-angle) 落於 -normal 側），高邊對齊 -normal。
    const sRatio = Math.max(0, Math.min(1, (span / 2 - vDist) / (span || 1)));
    return topY + sRatio * roofH * 0.85;
  }

  if (roofForm === 'vault' || roofForm === 'curved_ridge') {
    const archRatio = Math.max(0, 1 - Math.pow(distFromRidge / halfSpan, 2));
    return topY + Math.sqrt(archRatio) * roofH;
  }

  if (roofForm === 'dome') {
    const r = Math.min(len / 2, span / 2);
    const distFromCenter = Math.hypot(dx, dz);
    if (distFromCenter >= r) return topY;
    return topY + Math.sqrt(Math.max(0, r * r - distFromCenter * distFromCenter));
  }

  return topY + slopeRatio * roofH * 0.85;
}

/** 屋頂式太陽能板貼合角：以屋頂面高度梯度推導面板俯仰/橫滾，面板法線貼合屋頂法線 */
export function roofPanelAngles(x, z, poly, roofForm = 'flat', metrics = null, topY = 0, height = 10, rotY = 0) {
  if (!roofForm || roofForm === 'flat' || !poly?.outer?.length) return { pitch: 0, roll: 0, slope: 0 };
  const e = 0.75;
  const hx1 = getRoofElevation(x + e, z, poly, roofForm, metrics, topY, height);
  const hx0 = getRoofElevation(x - e, z, poly, roofForm, metrics, topY, height);
  const hz1 = getRoofElevation(x, z + e, poly, roofForm, metrics, topY, height);
  const hz0 = getRoofElevation(x, z - e, poly, roofForm, metrics, topY, height);
  if (![hx1, hx0, hz1, hz0].every(Number.isFinite)) return { pitch: 0, roll: 0, slope: 0 };
  const gx = (hx1 - hx0) / (2 * e), gz = (hz1 - hz0) / (2 * e);
  const slope = Math.hypot(gx, gz);
  if (slope < 0.02) return { pitch: 0, roll: 0, slope };
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const glx = c * gx - s * gz, glz = s * gx + c * gz;
  const clamp = (v) => Math.max(-0.6, Math.min(0.6, v));
  // rotateX(θ):+Z 端下沉 sinθ；rotateZ(φ):+X 端抬升 sinφ ⇒ 貼合屋面需 pitch=-atan, roll=+atan
  return { pitch: clamp(-Math.atan(glz)), roll: clamp(Math.atan(glx)), slope };
}

/** 生成單棟建築的全部外部零件 (0~N，支援角落/邊緣/中心隨機化分佈與大小容量保護) */
export function generateBuildingAppurtenances(poly, edges = [], baseY, topY, architecture, wallThickness = 0.28, actualRoofForm = null, precomputedMetrics = null) {
  if (!architecture || !edges.length || !poly?.outer?.length) return [];
  const geos = [];
  const funcInfo = architecture.functionInfo || { category: 'residential', key: 'residential_townhouse' };
  const cat = funcInfo.category || 'residential';
  const height = topY - baseY;
  const contemporary = !architecture.proceduralOnly || architecture.era !== 'historic';
  const idBase = `${architecture.id || 'bld'}|${edges[0]?.sourceId || edges[0]?.x}|${poly.outer.length}`;
  const variant = architecture.variant || 0;

  // 計算屋頂指標與候選放置區位
  const metrics = precomputedMetrics || calculateRoofMetrics(poly);
  const sites = getRoofPlacementSites(poly, metrics);

  // 決定此棟建築之屋頂造型，並取得相容的屋頂零件清單 (依屋頂類型決定可放物件)
  const roofForm = actualRoofForm || architecture.actualRoofForm || architecture.roofForm || 'flat';
  const allowedRooftopParts = new Set(ROOF_APPURTENANCE_COMPATIBILITY[roofForm] || ROOF_APPURTENANCE_COMPATIBILITY.flat);
  // 非平面屋頂僅容太陽能板／水塔／煙囪／天線／尖塔（牛眼窗／老虎窗為立面窗，不佔屋面）；其餘由相容矩陣擋下。
  const isSlopedRoof = roofForm !== 'flat' && roofForm !== 'stepped';

  // 屋頂物件佔位登記：全部屋頂物件互不重疊。圓形以半徑計，矩形以有向半尺寸計；
  // 佔位重疊者靜默捨棄（degrade by omission）。純數學、無 RNG，不消耗共享隨機序列。
  const roofClaims = [];
  function roofObbCorners(r) {
    const c = Math.cos(r.rot || 0), s = Math.sin(r.rot || 0);
    const pts = [];
    for (const [qx, qz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const lx = qx * r.hw, lz = qz * r.hd;
      pts.push([r.x + lx * c + lz * s, r.z - lx * s + lz * c]);
    }
    return pts;
  }
  function roofObbsOverlap(a, b) {
    const ca = roofObbCorners(a), cb = roofObbCorners(b);
    const axes = [];
    for (const r of [a, b]) {
      const c = Math.cos(r.rot || 0), s = Math.sin(r.rot || 0);
      axes.push([c, -s], [s, c]);
    }
    for (const [ax, az] of axes) {
      let mna = Infinity, mxa = -Infinity, mnb = Infinity, mxb = -Infinity;
      for (const [px, pz] of ca) { const d = px * ax + pz * az; if (d < mna) mna = d; if (d > mxa) mxa = d; }
      for (const [px, pz] of cb) { const d = px * ax + pz * az; if (d < mnb) mnb = d; if (d > mxb) mxb = d; }
      if (mxa < mnb || mxb < mna) return false;
    }
    return true;
  }
  function roofCircleHitsRect(x, z, r, rc) {
    const dx = x - rc.x, dz = z - rc.z;
    const c = Math.cos(rc.rot || 0), s = Math.sin(rc.rot || 0);
    const lx = c * dx - s * dz, lz = s * dx + c * dz;
    const qx = Math.max(-rc.hw, Math.min(rc.hw, lx));
    const qz = Math.max(-rc.hd, Math.min(rc.hd, lz));
    return (lx - qx) * (lx - qx) + (lz - qz) * (lz - qz) < r * r;
  }
  function roofFreeCircle(x, z, r) {
    for (const o of roofClaims) {
      if (o.circle) {
        const dx = x - o.x, dz = z - o.z;
        if (dx * dx + dz * dz < (r + o.r) * (r + o.r)) return false;
      } else if (roofCircleHitsRect(x, z, r, o)) return false;
    }
    return true;
  }
  function roofClaimFree(x, z, hw, hd, rot) {
    const r = { x, z, hw, hd, rot: rot || 0 };
    for (const o of roofClaims) {
      if (o.circle) { if (roofCircleHitsRect(o.x, o.z, o.r, r)) return false; }
      else if (roofObbsOverlap(o, r)) return false;
    }
    return true;
  }
  function claimCircle(x, z, r) {
    if (!roofFreeCircle(x, z, r)) return false;
    roofClaims.push({ circle: true, x, z, r });
    return true;
  }
  function claimRect(x, z, hw, hd, rot) {
    if (!roofClaimFree(x, z, hw, hd, rot)) return false;
    roofClaims.push({ x, z, hw, hd, rot: rot || 0 });
    return true;
  }
  // 棚架（rooftop_canopy）資訊：大型遮雨棚優先佔位；同區域太陽能板貼於棚架頂面並填滿。
  let canopyInfo = null;

  // 1. 識別正門牆段 (通常是長度最適中、臨路或主要長邊)
  const sortedEdges = [...edges].sort((a, b) => b.hw2 - a.hw2);
  const frontEdge = sortedEdges[0];
  const sideEdges = sortedEdges.slice(1);
  const groundAttachments = new Map();

  // 2. 正門地面物件生成 (大門、雨棚、盆栽 - 緊密貼齊外牆法線，杜絕內旋或拆開)
  if (frontEdge) {
    const groundStart = geos.length;
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

      if (height >= 3 && (architectureHash(idBase, 'doormat') % 100) < 80) {
        const mat = new THREE.BoxGeometry(doorW * 0.8, 0.045, 0.65);
        mat.translate(doorOffset, 0.025, wallThickness / 2 + 0.38);
        mat.rotateY(frame.rotY); mat.translate(frontEdge.x, baseY, frontEdge.z);
        geos.push(paintGeometry(mat, [0x655443, 0x425c51, 0x804c42][architectureHash(idBase, 'mat_color') % 3], variant));
      }

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
        const awningStyle = architectureHash(idBase, 'awning_style') % 3;
        if (awningStyle === 1) canopy.rotateX(0.16);
        canopy.translate(doorOffset, doorH + 0.35, wallThickness / 2 + canopyD / 2);
        canopy.rotateY(frame.rotY);
        canopy.translate(frontEdge.x, baseY, frontEdge.z);
        const canopyColor = contemporary ? (cat === 'commercial' ? 0x2a3b4c : 0xb04132) : architecture.trim;
        geos.push(paintGeometry(canopy, canopyColor, variant));
        if (awningStyle === 2) {
          for (let strip = 0; strip < 7; strip++) {
            const stripe = new THREE.BoxGeometry(canopyW / 7 * 0.48, 0.025, canopyD);
            stripe.translate(doorOffset + (strip - 3) * canopyW / 7, doorH + 0.423, wallThickness / 2 + canopyD / 2);
            stripe.rotateY(frame.rotY); stripe.translate(frontEdge.x, baseY, frontEdge.z);
            geos.push(paintGeometry(stripe, 0xe6d6b3, variant));
          }
        }
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
    groundAttachments.set(frontEdge, geos.slice(groundStart));
  }

  // 3. 側邊與後側地面物件 (側門、抽風機 - 依側邊長度容量分派)
  if (sideEdges.length > 0) {
    const groundStart = geos.length;
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
    groundAttachments.set(sideEdge, geos.slice(groundStart));
  }

  let decorationBudget = WALL_DECORATION_LIMIT;
  let balconyCount = 0, acCount = 0;
  // 4. 立面高程物件 (招牌、電視牆、看板、選舉廣告、逃生梯、陽台、曬衣架、冷氣、旗幟)
  for (const edge of edges) {
    const frame = getEdgeFrame(edge, poly);
    const len = frame.len;
    if (len < 3.2) continue;
    const floors = Math.max(1, Math.floor(height / 3.2));
    const floorH = height / floors;
    const attachmentStart = geos.length;
    const edgeSeed = `${idBase}|${edge.x},${edge.z}|${frame.rotY}`;
    const addDetail = (w, h, d, u, y, z, color) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      geo.translate(u, y, wallThickness / 2 + z);
      geo.rotateY(frame.rotY); geo.translate(edge.x, baseY, edge.z);
      geos.push(paintGeometry(geo, color, variant));
    };

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
      // Raised blocks read from either side of the projecting shop sign.
      for (const side of [-1, 1]) for (let glyph = 0; glyph < 3; glyph++) {
        addDetail(0.025, signH * 0.15, 0.55, signU + side * 0.075,
          3.8 + signH * (0.25 + glyph * 0.25), 0.45, 0xf0dfba);
      }
    }

    // 選舉廣告牆 (Election Banner)
    const hasElection = contemporary && (architectureHash(`${idBase}:${edge.x}`, 'election') % 100) < 28;
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
    const hasFireEscape = contemporary && (architectureHash(`${idBase}:${edge.x}`, 'fire_escape') % 100) < 35;
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
    if (contemporary && cat === 'residential' && floors >= 2 && len >= 7.5) {
      const bays = Math.max(1, Math.floor(len / 4.5));
      for (let f = 1; f < floors; f++) {
        const fy = f * floorH;
        for (let b = 0; b < bays; b++) {
          const u = -len / 2 + (b + 0.5) * (len / bays);
          const balW = Math.min(2.8, (len / bays) * 0.7);

          if (balconyCount >= APPURTENANCE_RULES.balconies.maxCount ||
            architectureHash(edgeSeed, `${f}:${b}:balcony`) % 100 >= 70) continue;
          balconyCount++;
          const balconyStyle = architectureHash(edgeSeed, `${f}:${b}:balcony_style`) % 3;
          // 陽台底板
          const bSlab = new THREE.BoxGeometry(balW, 0.12, 1.2);
          bSlab.translate(u, fy, wallThickness / 2 + 0.6);
          bSlab.rotateY(frame.rotY);
          bSlab.translate(edge.x, baseY, edge.z);
          geos.push(paintGeometry(bSlab, architecture.trim || 0x616161, variant));

          // 陽台欄杆
          const bRail = new THREE.BoxGeometry(balW, balconyStyle === 1 ? 0.09 : 0.8, 0.06);
          bRail.translate(u, fy + 0.4, wallThickness / 2 + 1.2);
          bRail.rotateY(frame.rotY);
          bRail.translate(edge.x, baseY, edge.z);
          geos.push(paintGeometry(bRail, balconyStyle === 2 ? 0x77989f : 0x424242, variant));
          if (balconyStyle === 1) for (let bar = 0; bar < 5; bar++) {
            addDetail(0.045, 0.8, 0.045, u + (bar - 2) * balW / 5, fy + 0.4, 1.2, 0x424242);
          }
          if (balconyStyle === 2) {
            addDetail(balW * 0.65, 0.22, 0.3, u, fy + 0.9, 1.05, 0xa16e50);
            for (let plant = 0; plant < 3; plant++) addDetail(balW * 0.17, 0.22 + plant % 2 * 0.16,
              0.26, u + (plant - 1) * balW * 0.2, fy + 1.1, 1.05, 0x53754b);
          }

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
        const hasAc = contemporary && (architectureHash(`${idBase}:${f}:${b}`, 'ac') % 100) < 65;
        if (!hasAc || acCount >= APPURTENANCE_RULES.ac_units.maxCount) continue;
        acCount++;
        const acStyle = architectureHash(edgeSeed, `${f}:${b}:ac_style`) % 3;
        const u = -len / 2 + (b + 0.35) * (len / bays);
        const acY = fy + 0.6;
        const acUnit = new THREE.BoxGeometry(acStyle === 2 ? 1.2 : 0.85, 0.55, 0.4);
        acUnit.translate(u, acY, wallThickness / 2 + 0.2);
        acUnit.rotateY(frame.rotY);
        acUnit.translate(edge.x, baseY, edge.z);
        geos.push(paintGeometry(acUnit, 0xe0e0e0, variant));

        const acGrill = new THREE.BoxGeometry(0.4, 0.4, 0.04);
        acGrill.translate(u, acY, wallThickness / 2 + 0.41);
        acGrill.rotateY(frame.rotY);
        acGrill.translate(edge.x, baseY, edge.z);
        geos.push(paintGeometry(acGrill, 0x616161, variant));
        if (acStyle === 1) for (let slat = 0; slat < 3; slat++) {
          addDetail(0.65, 0.035, 0.025, u, acY + (slat - 1) * 0.12, 0.445, 0xb4bbb8);
        }
        if (acStyle === 2) addDetail(0.3, 0.4, 0.04, u + 0.36, acY, 0.41, 0x616161);
      }
    }

    // 旗幟 (Flagpole with Flag) - 觀光、文化或市政
    const hasFlag = contemporary && (architectureHash(`${idBase}:${edge.x}`, 'flag') % 100) < 35;
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
    // Project existing attachments into wall space so artwork never covers them.
    const claims = [];
    for (const source of [...(groundAttachments.get(edge) || []), ...geos.slice(attachmentStart)]) {
      const pos = source.attributes.position;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      const c = Math.cos(frame.rotY), s = Math.sin(frame.rotY);
      for (let vi = 0; vi < pos.count; vi++) {
        const x = (pos.getX(vi) - edge.x) * c - (pos.getZ(vi) - edge.z) * s;
        const y = pos.getY(vi) - baseY;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      claims.push({ x: (minX + maxX) / 2, y: (minY + maxY) / 2,
        w: maxX - minX, h: maxY - minY });
    }
    const decorations = wallDecorationParts({ seed: edgeSeed, width: len, height,
      category: cat, contemporary, claims, budget: decorationBudget });
    for (const part of decorations) {
      const geo = architecturePartGeometry({ ...part, colorVariant: variant });
      geo.userData.wallDecoration = part.role;
      geo.userData.coverage = part.scope;
      geo.translate(0, 0, wallThickness / 2 + 0.18);
      geo.rotateY(frame.rotY); geo.translate(edge.x, baseY, edge.z);
      geos.push(geo);
    }
    decorationBudget -= decorations.length;

  }

  // 5. 頂部物件生成 (角落/邊緣/中心分派，附帶屋頂面積與跨度容量檢查)
  if (architecture.roofFeature && roofForm === 'flat' && sites.center) {
    const feature = architecture.roofFeature;
    const radius = feature === 'chhatri' ? 1.7 : 1.1;
    const { x, z } = sites.center;
    if (isSiteValid(poly, x, z, radius, 0.8) && height >= 5 && claimCircle(x, z, radius)) {
      const rot = -(metrics.frame?.angle || 0);
      const add = (geo, y, color, dx = 0, dz = 0) => {
        geo.translate(dx, y, dz); geo.rotateY(rot); geo.translate(x, topY, z);
        geos.push(paintGeometry(geo, color, variant));
      };
      const trim = architecture.trim || 0x80634a;
      if (feature === 'windcatcher') {
        const h = Math.min(4.5, height * 0.3);
        add(new THREE.BoxGeometry(1.4, h * 0.65, 1.4), h * 0.325, architecture.wall);
        for (const dx of [-0.58,0.58]) for (const dz of [-0.58,0.58]) {
          add(new THREE.BoxGeometry(0.22, h * 0.35, 0.22), h * 0.825, trim, dx, dz);
        }
        for (const side of [-1,1]) for (let i = 1; i <= 3; i++) {
          const y = h * (0.65 + i * 0.075);
          add(new THREE.BoxGeometry(1.1, 0.06, 0.1), y, trim, 0, side * 0.64);
          add(new THREE.BoxGeometry(0.1, 0.06, 1.1), y, trim, side * 0.64, 0);
        }
        add(new THREE.BoxGeometry(1.5, 0.15, 1.5), h + 0.075, trim);
      } else if (feature === 'chhatri') {
        add(new THREE.BoxGeometry(2.4, 0.16, 2.4), 0.08, trim);
        for (const dx of [-0.88,0.88]) for (const dz of [-0.88,0.88]) {
          add(new THREE.CylinderGeometry(0.1, 0.14, 1.8, 6), 1.06, architecture.wall, dx, dz);
        }
        add(new THREE.BoxGeometry(2.4, 0.14, 2.4), 2.03, trim);
        const dome = new THREE.SphereGeometry(1.15, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
        dome.scale(1, 0.65, 1); add(dome, 2.1, architecture.roof);
      }
    }
  }
  if (contemporary && !architecture.roofFeature && metrics && metrics.span >= 3.0 && metrics.area >= 20.0) {
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
      if (clockSite && isSiteValid(poly, clockSite.x, clockSite.z, 1.7, 1.2) && claimRect(clockSite.x, clockSite.z, 1.7, 1.7, 0)) {
        const cx = clockSite.x, cz = clockSite.z;
        const baseRoofY = getRoofElevation(cx, cz, poly, roofForm, metrics, topY, height);
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
        if (spireSite && isSiteValid(poly, spireSite.x, spireSite.z, 1.35, 1.0) && claimCircle(spireSite.x, spireSite.z, 1.35)) {
          const sx = spireSite.x, sz = spireSite.z;
          const baseRoofY = getRoofElevation(sx, sz, poly, roofForm, metrics, topY, height);

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
      if (heliSite && isSiteValid(poly, heliSite.x, heliSite.z, 7.8, 1.5) && claimCircle(heliSite.x, heliSite.z, 7.8)) {
        const hx = heliSite.x, hz = heliSite.z;
        const baseRoofY = getRoofElevation(hx, hz, poly, roofForm, metrics, topY, height);

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
        if (span >= 28 && isSiteValid(poly, hx, hz - 8.5, 4.0, 1.5) && claimRect(hx, hz - 8.5, 3.9, 2.9, 0)) {
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

    // 5.3b 波浪板遮雨棚 (Rooftop Rain Shed / Canopy)：大型遮雨棚優先佔位（面積佔比 20% ~ 80%）；
    // 同區域太陽能板貼於棚架頂面並填滿，不再佔用屋面。
    const hasCanopy = ((architectureHash(idBase, 'rf_canopy') % 100) < 40) && area >= 40 && span >= 6 && !hasHeli && allowedRooftopParts.has('rooftop_canopy');
    if (hasCanopy) {
      const frame = metrics?.frame || computeOrientedRoofFrame(poly);
      const rotY = frame ? frame.angle : 0;
      const dirX = frame ? frame.dirX : 1, dirZ = frame ? frame.dirZ : 0;
      const normX = frame ? frame.normalX : 0, normZ = frame ? frame.normalZ : 1;
      const cx = frame ? frame.cx : metrics.cx, cz = frame ? frame.cz : metrics.cz;
      const len = frame ? frame.len : (metrics.maxX - metrics.minX);
      const sp = frame ? frame.span : (metrics.maxZ - metrics.minZ);

      const canopyRatio = 0.20 + ((architectureHash(idBase, 'canopy_pct') % 6001) / 10000); // 20% ~ 80%
      const targetCanopyArea = area * canopyRatio;
      const cLen = Math.min(len * 0.88, Math.max(3.2, Math.sqrt(targetCanopyArea * (len / sp))));
      const cSpan = Math.min(sp * 0.88, targetCanopyArea / cLen);

      const offU = (len - cLen) * ((architectureHash(idBase, 'canopy_u') % 40) - 20) / 100;
      const offV = (sp - cSpan) * ((architectureHash(idBase, 'canopy_v') % 40) - 20) / 100;
      const posX = cx + offU * dirX + offV * normX;
      const posZ = cz + offU * dirZ + offV * normZ;

      if (isSiteValid(poly, posX, posZ, Math.min(cLen, cSpan) * 0.45, 0.4) && claimRect(posX, posZ, cLen / 2, cSpan / 2, rotY)) {
        const baseRoofY = getRoofElevation(posX, posZ, poly, roofForm, metrics, topY, height);
        const postH = 2.4;

        // 4 根鋼構立柱
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const post = new THREE.CylinderGeometry(0.06, 0.06, postH, 6);
            post.translate(sx * (cLen * 0.45), postH / 2, sz * (cSpan * 0.45));
            if (rotY) post.rotateY(rotY);
            post.translate(posX, baseRoofY, posZ);
            geos.push(paintGeometry(post, 0x546e7a, variant));
          }
        }

        // 頂部斜面遮雨頂棚
        const canopyRoof = new THREE.BoxGeometry(cLen, 0.08, cSpan);
        canopyRoof.rotateX(0.08);
        canopyRoof.translate(0, postH + 0.04, 0);
        if (rotY) canopyRoof.rotateY(rotY);
        canopyRoof.translate(posX, baseRoofY, posZ);
        geos.push(paintGeometry(canopyRoof, 0x78909c, variant));

        // 邊界導水天溝
        const gutter = new THREE.BoxGeometry(cLen * 1.02, 0.08, 0.08);
        gutter.translate(0, postH - 0.02, cSpan * 0.5);
        if (rotY) gutter.rotateY(rotY);
        gutter.translate(posX, baseRoofY, posZ);
        geos.push(paintGeometry(gutter, 0x455a64, variant));

        canopyInfo = { placed: true, posX, posZ, cLen, cSpan, rotY, baseRoofY, postH };
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
          if (!isSiteValid(poly, ox, oz, 0.7, 0.9) || !claimCircle(ox, oz, 0.7)) continue;
          const baseRoofY = getRoofElevation(ox, oz, poly, roofForm, metrics, topY, height);

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
      if (antSite && isSiteValid(poly, antSite.x, antSite.z, 0.4, 0.9) && claimCircle(antSite.x, antSite.z, 0.4)) {
        const ax = antSite.x, az = antSite.z;
        const baseRoofY = getRoofElevation(ax, az, poly, roofForm, metrics, topY, height);
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
      if (cellSite && isSiteValid(poly, cellSite.x, cellSite.z, 0.65, 0.9) && claimCircle(cellSite.x, cellSite.z, 0.65)) {
        const cx = cellSite.x, cz = cellSite.z;
        const baseRoofY = getRoofElevation(cx, cz, poly, roofForm, metrics, topY, height);
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

    // 5.7 太陽能光伏板陣列 (Solar Panels Array) - 覆蓋率 20%~80%，支援直接建立與架高複合式用途（遮雨棚/曬衣間）
    const hasSolar = ((architectureHash(idBase, 'solar') % 100) < 45) && area >= 80 && span >= 8 && !hasHeli && allowedRooftopParts.has('solar_array');
    // 5.7a 同區域有棚架：太陽能板貼在棚架頂面並填滿（跟棚架頂棚同傾角），不再佔用屋面。
    if (hasSolar && canopyInfo && canopyInfo.placed) {
      const { posX, posZ, cLen, cSpan, rotY: cRot, baseRoofY: cBaseY, postH: cPostH } = canopyInfo;
      const cTopY = cBaseY + cPostH + 0.08;
      const stepU = 1.58, stepV = 1.10;
      const uCount = Math.max(1, Math.floor((cLen - 0.3) / stepU));
      const vCount = Math.max(1, Math.floor((cSpan - 0.3) / stepV));
      const cc = Math.cos(cRot || 0), ss = Math.sin(cRot || 0);
      for (let vi = 0; vi < vCount; vi++) {
        for (let ui = 0; ui < uCount; ui++) {
          const lu = -((uCount - 1) * stepU) / 2 + ui * stepU;
          const lv = -((vCount - 1) * stepV) / 2 + vi * stepV;
          const px = posX + lu * cc + lv * ss;
          const pz = posZ - lu * ss + lv * cc;
          const panel = new THREE.BoxGeometry(1.5, 0.06, 1.0);
          panel.userData.partType = 'solar_panel';
          panel.rotateX(0.08);
          if (cRot) panel.rotateY(cRot);
          panel.translate(px, cTopY + 0.06, pz);
          geos.push(paintGeometry(panel, 0x1a237e, variant));
        }
      }
    }
    if (hasSolar && !(canopyInfo && canopyInfo.placed)) {
      const frame = metrics?.frame || computeOrientedRoofFrame(poly);
      const rotY = frame ? frame.angle : 0;
      const dirX = frame ? frame.dirX : 1, dirZ = frame ? frame.dirZ : 0;
      const normX = frame ? frame.normalX : 0, normZ = frame ? frame.normalZ : 1;
      const cx = frame ? frame.cx : metrics.cx, cz = frame ? frame.cz : metrics.cz;
      const len = frame ? frame.len : (metrics.maxX - metrics.minX);
      const sp = frame ? frame.span : (metrics.maxZ - metrics.minZ);

      // 目標覆蓋率精確控制在 20% ~ 80% 之間
      const targetRatio = 0.20 + ((architectureHash(idBase, 'solar_coverage') % 6001) / 10000); // 0.20 ~ 0.80
      const targetPanelCount = Math.max(1, Math.round((area * targetRatio) / 1.5));
      const minPanelCount = Math.max(1, Math.ceil((area * 0.20) / 1.5));
      const maxPanelCount = Math.max(minPanelCount, Math.floor((area * 0.80) / 1.5));
      const desiredPanels = Math.min(maxPanelCount, Math.max(minPanelCount, targetPanelCount));

      // 面板 1.5m × 1.0m，步距 1.58m × 1.10m，單板 1.5m²
      const stepU = 1.58, stepV = 1.10;
      const uCount = Math.max(1, Math.floor((len - 1.2) / stepU));
      const vCount = Math.max(1, Math.floor((sp - 1.2) / stepV));
      const uStart = -((uCount - 1) * stepU) / 2;
      const vStart = -((vCount - 1) * stepV) / 2;

      let candidateSites = [];
      for (let vi = 0; vi < vCount; vi++) {
        for (let ui = 0; ui < uCount; ui++) {
          const u = uStart + ui * stepU, v = vStart + vi * stepV;
          const sx = cx + u * dirX + v * normX;
          const sz = cz + u * dirZ + v * normZ;
          if (isSiteValid(poly, sx, sz, 0.72, 0.35) && roofFreeCircle(sx, sz, 0.78)) {
            candidateSites.push({ sx, sz, distSq: u * u + v * v });
          }
        }
      }

      // 若候選點未達 20% 門檻，嘗試適度以稍緊密邊距補足
      if (candidateSites.length < minPanelCount && area >= 80) {
        for (let vi = -1; vi <= vCount; vi++) {
          for (let ui = -1; ui <= uCount; ui++) {
            if (vi >= 0 && vi < vCount && ui >= 0 && ui < uCount) continue;
            const u = uStart + ui * stepU, v = vStart + vi * stepV;
            const sx = cx + u * dirX + v * normX;
            const sz = cz + u * dirZ + v * normZ;
            if (isSiteValid(poly, sx, sz, 0.68, 0.25) && roofFreeCircle(sx, sz, 0.72)) {
              candidateSites.push({ sx, sz, distSq: u * u + v * v });
              if (candidateSites.length >= minPanelCount) break;
            }
          }
          if (candidateSites.length >= minPanelCount) break;
        }
      }

      // 由內向外排序置中挑選，嚴格鎖定於 20% ~ 80% 區間
      candidateSites.sort((a, b) => a.distSq - b.distSq);

      // 直接建立 vs 架高複合式用途 (遮雨棚 / 曬衣間)
      const isElevatedSolar = (architectureHash(idBase, 'solar_mount') % 100) >= 45;
      const solarCompositeType = (architectureHash(idBase, 'solar_composite') % 100) < 50 ? 'canopy' : 'laundry';
      const stiltHeight = isElevatedSolar ? 2.3 : 0.25;
      const panelLift = isElevatedSolar ? stiltHeight + 0.15 : 0.35;

      // 同一屋頂區塊統一傾斜方向：取近中心、坡度明確的貼合角為全塊代表（排除稜線平點與
      // 邊牆階差假影），塊內全部面板共用；位置仍逐板貼合屋面高度。
      // 會切入屋面的站點直接捨棄並往外遞補，維持覆蓋率。純數學、無 RNG，不消耗共享隨機序列。
      let blockFit = { pitch: 0, roll: 0, slope: 0 };
      if (isSlopedRoof) {
        let flatFallback = null, steepest = null, steepestSlope = -1, picked = false;
        for (const { sx, sz } of candidateSites) {
          const f = roofPanelAngles(sx, sz, poly, roofForm, metrics, topY, height, rotY);
          if (!flatFallback && f.slope < 0.02) flatFallback = f;
          if (f.slope > steepestSlope) { steepestSlope = f.slope; steepest = f; }
          if (f.slope >= 0.02 && f.slope <= 1.0) { blockFit = f; picked = true; break; }
        }
        if (!picked) blockFit = flatFallback || steepest || blockFit;
      }
      const useBlockRoofFit = isSlopedRoof;
      const clearMat = isSlopedRoof
        ? new THREE.Matrix4().makeRotationY(rotY)
          .multiply(new THREE.Matrix4().makeRotationZ(blockFit.roll))
          .multiply(new THREE.Matrix4().makeRotationX(blockFit.pitch))
        : null;
      const clearVec = new THREE.Vector3();
      const placedSites = [];
      for (const { sx, sz } of candidateSites) {
        if (placedSites.length >= desiredPanels) break;
        const baseRoofY = getRoofElevation(sx, sz, poly, roofForm, metrics, topY, height);
        if (clearMat) {
          const panelY = baseRoofY + panelLift;
          let clears = true;
          for (const [lx, lz] of [[0.75, 0.5], [0.75, -0.5], [-0.75, 0.5], [-0.75, -0.5]]) {
            clearVec.set(lx, -0.03, lz).applyMatrix4(clearMat);
            if (clearVec.y + panelY - getRoofElevation(clearVec.x + sx, clearVec.z + sz, poly, roofForm, metrics, topY, height) < 0.02) {
              clears = false; break;
            }
          }
          if (!clears) continue;
        }
        // 單板佔位登記：與其他屋頂物件互不重疊（半尺寸略小於步距，相鄰板不互斥）
        if (!claimRect(sx, sz, 0.76, 0.53, rotY)) continue;
        placedSites.push({ sx, sz });
      }

      for (const { sx, sz } of placedSites) {
        const baseRoofY = getRoofElevation(sx, sz, poly, roofForm, metrics, topY, height);
        // 屋頂式貼合：整塊共用代表貼合角，平頂（與階梯露台）一律固定日照傾角
        const fit = blockFit;
        // 非平面屋頂強制貼合斜率（順坡排列，絕不水平放置）；平頂才用固定日照傾角
        const useRoofFit = useBlockRoofFit;
        const panelY = baseRoofY + panelLift;

        if (isElevatedSolar) {
          // 架高鋼構立柱 (Stilt column)
          const stilt = new THREE.CylinderGeometry(0.045, 0.045, stiltHeight, 6);
          stilt.translate(0, stiltHeight / 2, 0);
          if (rotY) stilt.rotateY(rotY);
          stilt.translate(sx, baseRoofY, sz);
          geos.push(paintGeometry(stilt, 0x546e7a, variant));

          // 頂部支撐縱樑 (Mounting rail)：與面板同傾角，貼合屋頂斜率（先旋轉後平移，避免繞原點公轉位移）
          const rail = new THREE.BoxGeometry(0.06, 0.08, 0.85);
          if (useRoofFit) { rail.rotateX(fit.pitch); rail.rotateZ(fit.roll); }
          if (rotY) rail.rotateY(rotY);
          rail.translate(sx, baseRoofY + stiltHeight, sz);
          geos.push(paintGeometry(rail, 0x78909c, variant));
        } else {
          // 直接建立：兩側角鋼腳架，腳底各自踩在屋頂面上，面板貼合斜率（腳架保持直立，僅高度跟坡）
          for (const side of [-0.55, 0.55]) {
            const fx = sx + Math.cos(rotY) * side, fz = sz - Math.sin(rotY) * side;
            const footY = getRoofElevation(fx, fz, poly, roofForm, metrics, topY, height);
            const legH = Math.max(0.08, panelY - 0.06 - footY);
            const leg = new THREE.BoxGeometry(0.06, legH, 0.8);
            leg.translate(side, legH / 2, 0);
            if (rotY) leg.rotateY(rotY);
            leg.translate(sx, footY, sz);
            geos.push(paintGeometry(leg, 0x9e9e9e, variant));
          }
        }

        const panel = new THREE.BoxGeometry(1.5, 0.06, 1.0);
        panel.userData.partType = 'solar_panel';
        if (useRoofFit) { panel.rotateX(fit.pitch); panel.rotateZ(fit.roll); }
        else panel.rotateX(0.35); // 平頂朝向日照傾角
        if (rotY) panel.rotateY(rotY);
        panel.translate(sx, panelY, sz);
        geos.push(paintGeometry(panel, 0x1a237e, variant));
      }

      // 若為架高複合用途，在中央挑空空間配置遮雨或曬衣設施
      if (isElevatedSolar && placedSites.length >= 4) {
        const centerSite = placedSites[Math.floor(placedSites.length / 2)];
        const underY = getRoofElevation(centerSite.sx, centerSite.sz, poly, roofForm, metrics, topY, height);
        if (solarCompositeType === 'laundry') {
          for (let l = -1; l <= 1; l += 2) {
            const line = new THREE.BoxGeometry(2.4, 0.03, 0.03);
            line.translate(0, 1.6, l * 0.8);
            if (rotY) line.rotateY(rotY);
            line.translate(centerSite.sx, underY, centerSite.sz);
            geos.push(paintGeometry(line, 0xb0bec5, variant));

            const cloth = new THREE.BoxGeometry(0.4, 0.5, 0.05);
            cloth.translate(l * 0.4, 1.35, l * 0.8);
            if (rotY) cloth.rotateY(rotY);
            cloth.translate(centerSite.sx, underY, centerSite.sz);
            geos.push(paintGeometry(cloth, l === -1 ? 0xffffff : 0x42a5f5, variant));
          }
          const sink = new THREE.BoxGeometry(0.7, 0.85, 0.55);
          sink.translate(0, 0.425, 0);
          if (rotY) sink.rotateY(rotY);
          sink.translate(centerSite.sx, underY, centerSite.sz);
          geos.push(paintGeometry(sink, 0xb0bec5, variant));
        } else {
          const gutter = new THREE.BoxGeometry(2.8, 0.06, 0.06);
          gutter.translate(0, 2.1, 1.2);
          if (rotY) gutter.rotateY(rotY);
          gutter.translate(centerSite.sx, underY, centerSite.sz);
          geos.push(paintGeometry(gutter, 0x455a64, variant));
        }
      }
    }

    // 5.8 木造鴿棚 (Rooftop Pigeon Coop) - 住宅後側角落或邊緣，保留 1.0m 留白
    const hasCoop = ((architectureHash(idBase, 'coop') % 100) < 25) && (cat === 'residential' || cat === 'rural') && area >= 60 && span >= 6 && !hasHeli && allowedRooftopParts.has('pigeon_coop');
    if (hasCoop) {
      const coopSite = pickSite('corner', 'coop_pos') || pickSite('edge', 'coop_pos');
      if (coopSite && isSiteValid(poly, coopSite.x, coopSite.z, 1.0, 1.0) && claimRect(coopSite.x, coopSite.z, 1.0, 0.9, 0)) {
        const px = coopSite.x, pz = coopSite.z;
        const baseRoofY = getRoofElevation(px, pz, poly, roofForm, metrics, topY, height);
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
      if (chSite && isSiteValid(poly, chSite.x, chSite.z, 0.45, 0.9) && claimCircle(chSite.x, chSite.z, 0.45)) {
        const chX = chSite.x, chZ = chSite.z;
        const baseRoofY = getRoofElevation(chX, chZ, poly, roofForm, metrics, topY, height);
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
            isSiteValid(poly, bSite.x + bbW * 0.45, bSite.z, 0.4, 0.9) &&
            claimRect(bSite.x, bSite.z, bbW / 2, 0.5, 0)) {
          const baseRoofY = getRoofElevation(bSite.x, bSite.z, poly, roofForm, metrics, topY, height);
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

    // 5.11 擴充屋頂範圍零件 (Rooftop Extent Parts: 曬衣間、空中花園，面積佔比 20% ~ 80%)
    // 註：遮雨棚已前移至 5.3b 優先佔位；太陽能板若同區域則貼於棚架頂面。
    // (1) 屋頂採光曬衣間 (Rooftop Laundry Drying Room / Shelter)
    const hasDryingRoom = ((architectureHash(idBase, 'rf_drying') % 100) < 45) && (cat === 'residential' || cat === 'rural') && area >= 35 && span >= 5 && !hasHeli && allowedRooftopParts.has('drying_room');
    if (hasDryingRoom) {
      const frame = metrics?.frame || computeOrientedRoofFrame(poly);
      const rotY = frame ? frame.angle : 0;
      const dirX = frame ? frame.dirX : 1, dirZ = frame ? frame.dirZ : 0;
      const normX = frame ? frame.normalX : 0, normZ = frame ? frame.normalZ : 1;
      const cx = frame ? frame.cx : metrics.cx, cz = frame ? frame.cz : metrics.cz;
      const len = frame ? frame.len : (metrics.maxX - metrics.minX);
      const sp = frame ? frame.span : (metrics.maxZ - metrics.minZ);

      const dryingRatio = 0.20 + ((architectureHash(idBase, 'dry_pct') % 6001) / 10000); // 20% ~ 80%
      const targetArea = area * dryingRatio;
      const dLen = Math.min(len * 0.85, Math.max(3.0, Math.sqrt(targetArea * (len / sp))));
      const dSpan = Math.min(sp * 0.85, targetArea / dLen);

      const offU = (len - dLen) * ((architectureHash(idBase, 'dry_u') % 40) - 20) / 100;
      const offV = (sp - dSpan) * ((architectureHash(idBase, 'dry_v') % 40) - 20) / 100;
      const posX = cx + offU * dirX + offV * normX;
      const posZ = cz + offU * dirZ + offV * normZ;

      if (isSiteValid(poly, posX, posZ, Math.min(dLen, dSpan) * 0.45, 0.4) && claimRect(posX, posZ, dLen / 2, dSpan / 2, rotY)) {
        const baseRoofY = getRoofElevation(posX, posZ, poly, roofForm, metrics, topY, height);
        const shedH = 2.2;

        // 鋁框骨架支柱
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const post = new THREE.BoxGeometry(0.08, shedH, 0.08);
            post.translate(sx * (dLen * 0.46), shedH / 2, sz * (dSpan * 0.46));
            if (rotY) post.rotateY(rotY);
            post.translate(posX, baseRoofY, posZ);
            geos.push(paintGeometry(post, 0xb0bec5, variant));
          }
        }

        // 半透明採光雨棚
        const translucentRoof = new THREE.BoxGeometry(dLen, 0.05, dSpan);
        translucentRoof.translate(0, shedH, 0);
        if (rotY) translucentRoof.rotateY(rotY);
        translucentRoof.translate(posX, baseRoofY, posZ);
        geos.push(paintGeometry(translucentRoof, 0xe0f7fa, variant));

        // 內部平行曬衣桿與垂掛衣物
        for (let l = -1; l <= 1; l++) {
          const pole = new THREE.BoxGeometry(dLen * 0.85, 0.03, 0.03);
          pole.translate(0, 1.7, l * (dSpan * 0.28));
          if (rotY) pole.rotateY(rotY);
          pole.translate(posX, baseRoofY, posZ);
          geos.push(paintGeometry(pole, 0x90a4ae, variant));

          for (let c = -1; c <= 1; c += 2) {
            const col = (architectureHash(`${idBase}:${l}:${c}`, 'cloth') % 3);
            const clothColor = col === 0 ? 0xffffff : col === 1 ? 0xef5350 : 0x42a5f5;
            const cloth = new THREE.BoxGeometry(0.35, 0.52, 0.04);
            cloth.translate(c * (dLen * 0.24), 1.4, l * (dSpan * 0.28));
            if (rotY) cloth.rotateY(rotY);
            cloth.translate(posX, baseRoofY, posZ);
            geos.push(paintGeometry(cloth, clothColor, variant));
          }
        }

        // 洗滌台水槽
        const sink = new THREE.BoxGeometry(0.75, 0.85, 0.55);
        sink.translate(-dLen * 0.35, 0.425, -dSpan * 0.35);
        if (rotY) sink.rotateY(rotY);
        sink.translate(posX, baseRoofY, posZ);
        geos.push(paintGeometry(sink, 0xb0bec5, variant));
      }
    }

    // (3) 空中花園木甲板 (Rooftop Garden)
    const hasRoofGarden = ((architectureHash(idBase, 'rf_garden') % 100) < 35) && area >= 60 && span >= 7 && !hasHeli && allowedRooftopParts.has('roof_garden');
    if (hasRoofGarden) {
      const frame = metrics?.frame || computeOrientedRoofFrame(poly);
      const rotY = frame ? frame.angle : 0;
      const dirX = frame ? frame.dirX : 1, dirZ = frame ? frame.dirZ : 0;
      const normX = frame ? frame.normalX : 0, normZ = frame ? frame.normalZ : 1;
      const cx = frame ? frame.cx : metrics.cx, cz = frame ? frame.cz : metrics.cz;
      const len = frame ? frame.len : (metrics.maxX - metrics.minX);
      const sp = frame ? frame.span : (metrics.maxZ - metrics.minZ);

      const gardenRatio = 0.20 + ((architectureHash(idBase, 'garden_pct') % 6001) / 10000); // 20% ~ 80%
      const targetArea = area * gardenRatio;
      const gLen = Math.min(len * 0.88, Math.max(3.5, Math.sqrt(targetArea * (len / sp))));
      const gSpan = Math.min(sp * 0.88, targetArea / gLen);

      const offU = (len - gLen) * ((architectureHash(idBase, 'g_u') % 30) - 15) / 100;
      const offV = (sp - gSpan) * ((architectureHash(idBase, 'g_v') % 30) - 15) / 100;
      const posX = cx + offU * dirX + offV * normX;
      const posZ = cz + offU * dirZ + offV * normZ;

      if (isSiteValid(poly, posX, posZ, Math.min(gLen, gSpan) * 0.45, 0.4) && claimRect(posX, posZ, gLen / 2, gSpan / 2, rotY)) {
        const baseRoofY = getRoofElevation(posX, posZ, poly, roofForm, metrics, topY, height);

        // 木甲板底座平台
        const deck = new THREE.BoxGeometry(gLen, 0.08, gSpan);
        deck.translate(0, 0.04, 0);
        if (rotY) deck.rotateY(rotY);
        deck.translate(posX, baseRoofY, posZ);
        geos.push(paintGeometry(deck, 0x8d6e63, variant));

        // 綠化長條花台
        for (const side of [-1, 1]) {
          const bedW = gLen * 0.75, bedH = 0.4, bedD = 0.55;
          const planter = new THREE.BoxGeometry(bedW, bedH, bedD);
          planter.translate(0, 0.08 + bedH / 2, side * (gSpan * 0.36));
          if (rotY) planter.rotateY(rotY);
          planter.translate(posX, baseRoofY, posZ);
          geos.push(paintGeometry(planter, 0x5d4037, variant));

          const bush = new THREE.BoxGeometry(bedW * 0.95, 0.35, bedD * 0.85);
          bush.translate(0, 0.08 + bedH + 0.175, side * (gSpan * 0.36));
          if (rotY) bush.rotateY(rotY);
          bush.translate(posX, baseRoofY, posZ);
          geos.push(paintGeometry(bush, 0x388e3c, variant));
        }

        // 藤蔓休閒花架 (Pergola)
        const pergW = 2.4, pergD = 2.0, pergH = 2.2;
        for (const px of [-pergW / 2, pergW / 2]) {
          for (const pz of [-pergD / 2, pergD / 2]) {
            const col = new THREE.BoxGeometry(0.1, pergH, 0.1);
            col.translate(px, pergH / 2, pz);
            if (rotY) col.rotateY(rotY);
            col.translate(posX, baseRoofY, posZ);
            geos.push(paintGeometry(col, 0x6d4c41, variant));
          }
        }
        for (let b = -1; b <= 1; b++) {
          const rBeam = new THREE.BoxGeometry(pergW * 1.15, 0.08, 0.08);
          rBeam.translate(0, pergH, b * 0.7);
          if (rotY) rBeam.rotateY(rotY);
          rBeam.translate(posX, baseRoofY, posZ);
          geos.push(paintGeometry(rBeam, 0x5d4037, variant));
        }

        // 花園休閒長椅
        const bench = new THREE.BoxGeometry(1.4, 0.45, 0.5);
        bench.translate(0, 0.08 + 0.225, 0);
        if (rotY) bench.rotateY(rotY);
        bench.translate(posX, baseRoofY, posZ);
        geos.push(paintGeometry(bench, 0x4e342e, variant));
      }
    }

    // 5.12 擴充屋頂獨立零件 (Rooftop Standalone Parts: 樓梯間、小廟、桌球桌、撞球桌、沙發、桌椅、涼亭)
    // (1) 頂樓樓梯間 / 屋突 (Stairwell Penthouse)
    const hasStairwell = ((architectureHash(idBase, 'stairwell') % 100) < 70) && area >= 40 && span >= 5 && allowedRooftopParts.has('stairwell_penthouse');
    if (hasStairwell) {
      const stSite = pickSite('corner', 'stair_pos') || pickSite('edge', 'stair_pos');
      if (stSite && isSiteValid(poly, stSite.x, stSite.z, 1.5, 0.8) && claimRect(stSite.x, stSite.z, 1.3, 1.5, 0)) {
        const sx = stSite.x, sz = stSite.z;
        const baseRoofY = getRoofElevation(sx, sz, poly, roofForm, metrics, topY, height);
        const stH = 2.4;

        const body = new THREE.BoxGeometry(2.4, stH, 2.8);
        body.translate(sx, baseRoofY + stH / 2, sz);
        geos.push(paintGeometry(body, architecture.wall || 0x90a4ae, variant));

        const roofSlab = new THREE.BoxGeometry(2.65, 0.15, 3.05);
        roofSlab.translate(sx, baseRoofY + stH + 0.075, sz);
        geos.push(paintGeometry(roofSlab, architecture.trim || 0x546e7a, variant));

        const door = new THREE.BoxGeometry(0.85, 1.9, 0.08);
        door.translate(sx, baseRoofY + 0.95, sz + 1.41);
        geos.push(paintGeometry(door, 0x37474f, variant));

        const vent = new THREE.BoxGeometry(0.65, 0.45, 0.06);
        vent.translate(sx + 1.21, baseRoofY + 1.6, sz);
        geos.push(paintGeometry(vent, 0x78909c, variant));
      }
    }

    // (2) 屋頂小廟 / 神明廳 (Rooftop Shrine / Temple)
    const hasShrine = ((architectureHash(idBase, 'shrine') % 100) < 30) && area >= 30 && span >= 4 && allowedRooftopParts.has('rooftop_shrine');
    if (hasShrine) {
      const shSite = pickSite('edge', 'shrine_pos') || pickSite('corner', 'shrine_pos');
      if (shSite && isSiteValid(poly, shSite.x, shSite.z, 1.3, 0.8) && claimRect(shSite.x, shSite.z, 1.0, 0.9, 0)) {
        const sx = shSite.x, sz = shSite.z;
        const baseRoofY = getRoofElevation(sx, sz, poly, roofForm, metrics, topY, height);
        const shH = 1.6;

        const shrineBody = new THREE.BoxGeometry(1.8, shH, 1.6);
        shrineBody.translate(sx, baseRoofY + shH / 2, sz);
        geos.push(paintGeometry(shrineBody, 0xb71c1c, variant));

        const shrineRoof = new THREE.BoxGeometry(2.2, 0.35, 2.0);
        shrineRoof.translate(sx, baseRoofY + shH + 0.175, sz);
        geos.push(paintGeometry(shrineRoof, 0xff8f00, variant));

        const ridge = new THREE.BoxGeometry(2.0, 0.12, 0.12);
        ridge.translate(sx, baseRoofY + shH + 0.41, sz);
        geos.push(paintGeometry(ridge, 0xd84315, variant));

        const burner = new THREE.CylinderGeometry(0.3, 0.35, 0.6, 8);
        burner.translate(sx, baseRoofY + 0.3, sz + 1.25);
        geos.push(paintGeometry(burner, 0xc5a059, variant));
      }
    }

    // (3) 屋頂桌球桌 (Ping-Pong Table)
    const hasPingpong = ((architectureHash(idBase, 'pingpong') % 100) < 35) && area >= 40 && span >= 5 && allowedRooftopParts.has('pingpong_table');
    if (hasPingpong) {
      const ppSite = pickSite('edge', 'pingpong_pos') || pickSite('center', 'pingpong_pos');
      if (ppSite && isSiteValid(poly, ppSite.x, ppSite.z, 1.5, 0.8) && claimRect(ppSite.x, ppSite.z, 1.45, 0.85, 0)) {
        const px = ppSite.x, pz = ppSite.z;
        const baseRoofY = getRoofElevation(px, pz, poly, roofForm, metrics, topY, height);
        const tableH = 0.76;

        for (const sx of [-1.1, 1.1]) {
          for (const sz of [-0.6, 0.6]) {
            const leg = new THREE.BoxGeometry(0.06, tableH, 0.06);
            leg.translate(px + sx, baseRoofY + tableH / 2, pz + sz);
            geos.push(paintGeometry(leg, 0x212121, variant));
          }
        }

        const tabletop = new THREE.BoxGeometry(2.74, 0.08, 1.525);
        tabletop.translate(px, baseRoofY + tableH + 0.04, pz);
        geos.push(paintGeometry(tabletop, 0x1976d2, variant));

        const net = new THREE.BoxGeometry(0.03, 0.18, 1.6);
        net.translate(px, baseRoofY + tableH + 0.17, pz);
        geos.push(paintGeometry(net, 0xffffff, variant));
      }
    }

    // (4) 屋頂撞球桌 (Pool / Billiards Table)
    const hasPool = ((architectureHash(idBase, 'pool') % 100) < 28) && area >= 50 && span >= 6 && allowedRooftopParts.has('pool_table');
    if (hasPool) {
      const poolSite = pickSite('center', 'pool_pos') || pickSite('edge', 'pool_pos');
      if (poolSite && isSiteValid(poly, poolSite.x, poolSite.z, 1.6, 0.8) && claimRect(poolSite.x, poolSite.z, 1.45, 0.85, 0)) {
        const px = poolSite.x, pz = poolSite.z;
        const baseRoofY = getRoofElevation(px, pz, poly, roofForm, metrics, topY, height);
        const tableH = 0.8;

        for (const sx of [-1.1, 1.1]) {
          for (const sz of [-0.6, 0.6]) {
            const leg = new THREE.CylinderGeometry(0.09, 0.11, tableH, 8);
            leg.translate(px + sx, baseRoofY + tableH / 2, pz + sz);
            geos.push(paintGeometry(leg, 0x3e2723, variant));
          }
        }

        const frame = new THREE.BoxGeometry(2.75, 0.12, 1.55);
        frame.translate(px, baseRoofY + tableH + 0.06, pz);
        geos.push(paintGeometry(frame, 0x4e342e, variant));

        const cloth = new THREE.BoxGeometry(2.45, 0.06, 1.25);
        cloth.translate(px, baseRoofY + tableH + 0.1, pz);
        geos.push(paintGeometry(cloth, 0x2e7d32, variant));

        for (const cx of [-1.2, 0, 1.2]) {
          for (const cz of [-0.6, 0.6]) {
            if (cx === 0 && cz === 0) continue;
            const pocket = new THREE.BoxGeometry(0.1, 0.08, 0.1);
            pocket.translate(px + cx, baseRoofY + tableH + 0.11, pz + cz);
            geos.push(paintGeometry(pocket, 0x1b1b1b, variant));
          }
        }
      }
    }

    // (5) 露台休閒沙發茶几組 (Rooftop Lounge Sofa)
    const hasSofa = ((architectureHash(idBase, 'sofa') % 100) < 40) && area >= 35 && span >= 5 && allowedRooftopParts.has('rooftop_sofa');
    if (hasSofa) {
      const sofaSite = pickSite('corner', 'sofa_pos') || pickSite('edge', 'sofa_pos');
      if (sofaSite && isSiteValid(poly, sofaSite.x, sofaSite.z, 1.4, 0.8) && claimRect(sofaSite.x, sofaSite.z, 1.1, 1.0, 0)) {
        const sx = sofaSite.x, sz = sofaSite.z;
        const baseRoofY = getRoofElevation(sx, sz, poly, roofForm, metrics, topY, height);

        const mainSeat = new THREE.BoxGeometry(2.0, 0.42, 0.85);
        mainSeat.translate(sx, baseRoofY + 0.21, sz);
        geos.push(paintGeometry(mainSeat, 0x78909c, variant));

        const back = new THREE.BoxGeometry(2.0, 0.38, 0.18);
        back.translate(sx, baseRoofY + 0.61, sz - 0.34);
        geos.push(paintGeometry(back, 0x546e7a, variant));

        const lSeat = new THREE.BoxGeometry(0.85, 0.42, 0.95);
        lSeat.translate(sx + 0.58, baseRoofY + 0.21, sz + 0.85);
        geos.push(paintGeometry(lSeat, 0x78909c, variant));

        const coffeeTable = new THREE.BoxGeometry(0.9, 0.32, 0.55);
        coffeeTable.translate(sx - 0.2, baseRoofY + 0.16, sz + 0.7);
        geos.push(paintGeometry(coffeeTable, 0x5d4037, variant));
      }
    }

    // (6) 露天桌椅遮陽傘組 (Patio Table, Chairs & Parasol)
    const hasTableChairs = ((architectureHash(idBase, 'tab_chairs') % 100) < 50) && area >= 25 && span >= 4 && allowedRooftopParts.has('table_chairs');
    if (hasTableChairs) {
      const tcSite = pickSite('edge', 'tc_pos') || pickSite('corner', 'tc_pos');
      if (tcSite && isSiteValid(poly, tcSite.x, tcSite.z, 1.2, 0.7) && claimCircle(tcSite.x, tcSite.z, 1.2)) {
        const tx = tcSite.x, tz = tcSite.z;
        const baseRoofY = getRoofElevation(tx, tz, poly, roofForm, metrics, topY, height);

        const table = new THREE.CylinderGeometry(0.55, 0.55, 0.05, 12);
        table.translate(tx, baseRoofY + 0.72, tz);
        geos.push(paintGeometry(table, 0x616161, variant));

        const tLeg = new THREE.CylinderGeometry(0.05, 0.15, 0.70, 8);
        tLeg.translate(tx, baseRoofY + 0.35, tz);
        geos.push(paintGeometry(tLeg, 0x424242, variant));

        for (const [cx, cz] of [[-0.75, 0], [0.75, 0], [0, -0.75], [0, 0.75]]) {
          const chair = new THREE.BoxGeometry(0.42, 0.42, 0.42);
          chair.translate(tx + cx, baseRoofY + 0.21, tz + cz);
          geos.push(paintGeometry(chair, 0x455a64, variant));

          const backrest = new THREE.BoxGeometry(0.42, 0.4, 0.06);
          backrest.translate(tx + cx, baseRoofY + 0.62, tz + cz + (cz > 0 ? 0.18 : cz < 0 ? -0.18 : 0));
          geos.push(paintGeometry(backrest, 0x37474f, variant));
        }

        const pole = new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6);
        pole.translate(tx, baseRoofY + 1.1, tz);
        geos.push(paintGeometry(pole, 0xb0bec5, variant));

        const umbrella = new THREE.ConeGeometry(1.15, 0.4, 8);
        umbrella.translate(tx, baseRoofY + 2.3, tz);
        geos.push(paintGeometry(umbrella, 0xffeb3b, variant));
      }
    }

    // (7) 屋頂休閒涼亭 (Rooftop Gazebo / Pavilion)
    const hasGazebo = ((architectureHash(idBase, 'gazebo') % 100) < 30) && area >= 70 && span >= 8 && allowedRooftopParts.has('gazebo');
    if (hasGazebo) {
      const gzSite = pickSite('corner', 'gazebo_pos') || pickSite('edge', 'gazebo_pos');
      if (gzSite && isSiteValid(poly, gzSite.x, gzSite.z, 1.8, 1.0) && claimRect(gzSite.x, gzSite.z, 1.5, 1.5, 0)) {
        const gx = gzSite.x, gz = gzSite.z;
        const baseRoofY = getRoofElevation(gx, gz, poly, roofForm, metrics, topY, height);
        const gzH = 2.4;

        const deck = new THREE.BoxGeometry(2.8, 0.1, 2.8);
        deck.translate(gx, baseRoofY + 0.05, gz);
        geos.push(paintGeometry(deck, 0x8d6e63, variant));

        for (const sx of [-1.2, 1.2]) {
          for (const sz of [-1.2, 1.2]) {
            const col = new THREE.CylinderGeometry(0.07, 0.07, gzH, 6);
            col.translate(gx + sx, baseRoofY + gzH / 2, gz + sz);
            geos.push(paintGeometry(col, 0x5d4037, variant));
          }
        }

        const roofCone = new THREE.ConeGeometry(2.1, 0.95, 4);
        roofCone.rotateY(Math.PI / 4);
        roofCone.translate(gx, baseRoofY + gzH + 0.475, gz);
        geos.push(paintGeometry(roofCone, 0x3e2723, variant));

        for (const side of [-0.9, 0.9]) {
          const bench = new THREE.BoxGeometry(2.2, 0.42, 0.35);
          bench.translate(gx, baseRoofY + 0.31, gz + side);
          geos.push(paintGeometry(bench, 0x6d4c41, variant));
        }
      }
    }
  }

  return geos;
}

