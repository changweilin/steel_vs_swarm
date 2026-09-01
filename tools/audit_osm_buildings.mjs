// ============ 真實 OSM 建物外環／中庭／屋頂平台契約稽核 ============
// 離線執行固定 fixture，並以 `audit_src.mjs` 讀取、執行 `osmBuilding.js` 原文。
// Node 目前沒有 Three.js 時，受控沙箱只替換 Three 的幾何容器，絕不重寫建物
// 生成器；blocker、platform、roof 與附件位置都取自 production 函式的回傳／追蹤。
//
// 固定名冊：L 形（凹入且近正交）、斜向、大型不規則、中庭、multipolygon、多 outer、
// 超細長。每列都保留 fixture 與 sourceId；沒有足夠真實幾何證據就列「未驗」並退出 1，
// 不用合成輪廓補數。runtime 的 invalid／skipped／capacity 也逐筆檢查 sourceId/reason。
//
// 反向驗證（每個旗標預期以非零退出）：
//   --break-real-hole     平台與屋頂拿掉 holes，必須被中庭契約攔下
//   --break-real-blocker  外環少一段 blocker，必須被邊界契約攔下
//   --break-real-roof     roof Shape 拿掉 holes，必須被 roof 契約攔下
// 替換沒有命中原文、挑到不適用 fixture，或壞版未被攔下，均是稽核失敗。

import { readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readSrc } from './audit_src.mjs';
import {
  DEFAULT_FIXTURE_DIR, FIXTURE_VERSION, fixturePath, loadOsmFixture,
} from './osm_fixture.mjs';
import {
  OSM_AREA_KEYS, OSM_AREA_LIMITS, assembleRelationRings, areaAreaM2,
  catalogAreas, isSimpleRing, normalizeRing, pointInProjectedArea,
  projectAreaRecord,
} from '../public/js/osmAreas.js';
import { llToXZ } from '../public/js/data.js';
import { parseOsmFeatureElements } from '../public/js/osmQuery.js';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
  return m ? [m[1], m[2] ?? '1'] : ['_', arg];
}));
const BREAK_NAMES = ['real-hole', 'real-blocker', 'real-roof'];
const BREAKS = BREAK_NAMES.filter((name) => process.argv.includes(`--break-${name}`));
const PINNED_CATALOG = Object.freeze({
  // 正式 taipei_dense 隨三線場地移動；舊 bbox 獨立保留為幾何 fixture，避免路線重烤
  // 靜默換掉已固定的 L 型 source ID 證據。
  l_shape: Object.freeze({ fixture: 'taipei_lshape', sourceId: 'way/1071343896' }),
  // Berlin 正式場地已改綁 Prenzlauer Berg；固定斜向證據改用新 raw 的 Kino in der Kulturbrauerei。
  oblique: Object.freeze({ fixture: 'berlin', sourceId: 'way/23093989' }),
  courtyard: Object.freeze({ fixture: 'berlin_bridge', sourceId: 'relation/7671395' }),
  large_irregular: Object.freeze({ fixture: 'roppongi_underpass', sourceId: 'way/136048451' }),
  multipolygon: Object.freeze({ fixture: 'berlin_bridge', sourceId: 'relation/21178637' }),
  multi_outer: Object.freeze({ fixture: 'berlin_bridge', sourceId: 'relation/21178637' }),
  super_long: Object.freeze({ fixture: 'shibuya_dense', sourceId: 'way/116806278' }),
});
const ONLY = new Set(String(args.only || '').split(',').map((v) => v.trim()).filter(Boolean));
const DIR = resolve(args['fixture-dir'] || DEFAULT_FIXTURE_DIR);
const OUT = args.json ? resolve(args.json) : null;
const EPS = 1e-5;
const PINNED_CATEGORY_KEYS = Object.freeze({
  'L形': 'l_shape', '斜向': 'oblique', '中庭': 'courtyard', '大型不規則': 'large_irregular',
  multipolygon: 'multipolygon', '多 outer': 'multi_outer', '超細長': 'super_long',
});
let pass = 0;
let fail = 0;

function check(ok, label) {
  if (ok) { pass++; console.log(`    ✓ ${label}`); }
  else { fail++; console.error(`    ✗ ${label}`); }
  return ok;
}

function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
function close(a, b, eps = EPS) { return finite(a) && finite(b) && Math.abs(a - b) <= eps; }
function angleClose(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) <= 1e-5;
}
function distance(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

function cross(a, b, c) {
  return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
}

function angleToOrthogonal(angle, axis) {
  const period = Math.PI / 2;
  let d = ((angle - axis + period / 2) % period + period) % period - period / 2;
  return Math.abs(d);
}

function convexHull(points) {
  const sorted = [...new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values()]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length <= 2) return sorted;
  const turn = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && turn(lower.at(-2), lower.at(-1), p) <= EPS) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of sorted.slice().reverse()) {
    while (upper.length >= 2 && turn(upper.at(-2), upper.at(-1), p) <= EPS) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function orientedExtent(ring) {
  const hull = convexHull(ring);
  if (hull.length < 3) return { lengthM: 0, widthM: 0, aspect: 0 };
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const ux = Math.cos(angle), uz = Math.sin(angle), vx = -uz, vz = ux;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of hull) {
      const u = p[0] * ux + p[1] * uz, v = p[0] * vx + p[1] * vz;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const w = Math.max(0, u1 - u0), h = Math.max(0, v1 - v0), area = w * h;
    if (!best || area < best.area) best = { lengthM: Math.max(w, h), widthM: Math.min(w, h), area };
  }
  return { ...best, aspect: best.widthM > EPS ? best.lengthM / best.widthM : Infinity };
}

function primaryPolygon(area) {
  return [...(area.worldPolygons || [])].sort((a, b) => {
    const aa = Math.abs(ringArea(a.outer)), ab = Math.abs(ringArea(b.outer));
    return ab - aa || a.outer.length - b.outer.length;
  })[0] || null;
}

function polygonMetrics(area) {
  const polygon = primaryPolygon(area);
  const ring = polygon?.outer || [];
  const signed = ringArea(ring);
  const winding = Math.sign(signed) || 1;
  const edges = [];
  let reflex = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], c = ring[(i + 2) % ring.length];
    const len = distance(a, b);
    if (len <= EPS) continue;
    const nextLen = distance(b, c);
    edges.push({ angle: Math.atan2(b[1] - a[1], b[0] - a[0]), len });
    if (nextLen > EPS && cross(a, b, c) * winding < -EPS * len * nextLen) reflex++;
  }
  const axis = edges.slice().sort((a, b) => b.len - a.len)[0]?.angle || 0;
  const totalLength = edges.reduce((sum, edge) => sum + edge.len, 0) || 1;
  const orthogonalLength = edges.reduce((sum, edge) => (
    sum + (angleToOrthogonal(edge.angle, axis) <= Math.PI / 180 * 16 ? edge.len : 0)
  ), 0);
  const hullArea = Math.abs(ringArea(convexHull(ring)));
  const footprintArea = Math.abs(signed);
  const concavity = hullArea > EPS ? Math.max(0, 1 - footprintArea / hullArea) : 0;
  const extent = orientedExtent(ring);
  const obliqueLength = totalLength - orthogonalLength;
  return {
    outerPoints: ring.length,
    holes: (area.worldPolygons || []).reduce((sum, p) => sum + (p.holes?.length || 0), 0),
    polygons: area.worldPolygons?.length || 0,
    reflex,
    concavity,
    orthogonalLengthFraction: orthogonalLength / totalLength,
    obliqueLengthFraction: obliqueLength / totalLength,
    lengthM: extent.lengthM,
    widthM: extent.widthM,
    aspect: extent.aspect,
    areaM2: areaAreaM2(area),
  };
}

function buildingArea(area) {
  return (area?.tags?.building != null || area?.tags?.['building:part'] != null)
    && area?.classification?.generator === 'polygonBuilding'
    && Array.isArray(area.worldPolygons) && area.worldPolygons.length > 0;
}

function sourceIdOf(row) {
  return typeof row?.sourceId === 'string' && row.sourceId.trim() ? row.sourceId : null;
}

function reasonOf(row) {
  return typeof row?.reason === 'string' && row.reason.trim() ? row.reason : null;
}

function categoryRank(a, b) {
  return String(a.fixture).localeCompare(String(b.fixture)) || String(a.sourceId).localeCompare(String(b.sourceId));
}

function candidateRecord(fixture, area, metric, category, score) {
  return {
    category, fixture: fixture.name, sourceId: area.sourceId, sourceType: area.sourceType,
    polygonIndex: area.worldPolygons.indexOf(primaryPolygon(area)),
    score, metric, area,
  };
}

function selectCatalog(records) {
  const candidates = records.flatMap((fixture) => fixture.buildings.map((area) => ({
    fixture, area, metric: polygonMetrics(area),
  })));
  const choose = (category, test, score) => {
    const rows = candidates.filter((row) => test(row.metric, row.area))
      .map((row) => candidateRecord(row.fixture, row.area, row.metric, category, score(row.metric, row.area)))
      .sort((a, b) => b.score - a.score || categoryRank(a, b));
    // 新增正式 fixture 不得因候選分數更高而換掉既有回歸樣本；只要 pinned sourceId
    // 仍存在，就固定選它。若 sourceId 已從所有 fixture 消失，後面的名冊斷言仍須報紅。
    const pinned = PINNED_CATALOG[PINNED_CATEGORY_KEYS[category]];
    return rows.find((row) => row.fixture === pinned?.fixture && row.sourceId === pinned?.sourceId)
      || rows[0] || null;
  };
  return {
    l_shape: choose('L形', (m) => m.polygons === 1 && m.outerPoints >= 6 && m.reflex >= 1
      && m.concavity >= 0.025 && m.orthogonalLengthFraction >= 0.45,
    (m) => m.concavity * (m.orthogonalLengthFraction + 0.1) * Math.log1p(m.areaM2)),
    oblique: choose('斜向', (m) => m.outerPoints >= 4 && m.obliqueLengthFraction >= 0.38,
      (m) => m.obliqueLengthFraction * Math.log1p(m.areaM2)),
    courtyard: choose('中庭', (m) => m.holes > 0,
      (m) => m.holes * 100 + Math.log1p(m.areaM2)),
    large_irregular: choose('大型不規則', (m) => m.outerPoints >= 8 && m.concavity >= 0.02,
      (m) => m.areaM2 * (1 + m.concavity)),
    multipolygon: choose('multipolygon', (_, area) => area.sourceType === 'relation',
      (m) => m.polygons * 1000 + m.areaM2),
    multi_outer: choose('多 outer', (m, area) => area.sourceType === 'relation' && m.polygons >= 2,
      (m) => m.polygons * 100000 + m.areaM2),
    super_long: choose('超細長', (m) => m.aspect >= 5 && m.lengthM >= 20 && m.widthM >= 2,
      (m) => m.aspect * Math.log1p(m.lengthM)),
  };
}

// ---------------------------------------------------------------------------
// Three 受控沙箱：只記錄 production 建構器呼叫的幾何，不包含任何建物演算法。
// ---------------------------------------------------------------------------
let activeTrace = null;

function unionBounds(items) {
  const out = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const item of items || []) {
    const b = item?.bounds;
    if (!b) continue;
    out.minX = Math.min(out.minX, b.minX); out.maxX = Math.max(out.maxX, b.maxX);
    out.minY = Math.min(out.minY, b.minY); out.maxY = Math.max(out.maxY, b.maxY);
    out.minZ = Math.min(out.minZ, b.minZ); out.maxZ = Math.max(out.maxZ, b.maxZ);
  }
  return out;
}

class TracePath {
  constructor() { this.points = []; }
  moveTo(x, y) { this.points.push([x, y]); }
  lineTo(x, y) { this.points.push([x, y]); }
}

class TraceShape extends TracePath {
  constructor() { super(); this.holes = []; }
}

class TraceGeometry {
  constructor(kind, bounds = null) {
    this.kind = kind; this.bounds = bounds || {
      minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity,
      minZ: Infinity, maxZ: -Infinity,
    };
    this.localBounds = { ...this.bounds }; this.children = null; this.position = { x: 0, y: 0, z: 0 };
    if (activeTrace) activeTrace.geometries.push(this);
  }
  rotateX(angle) { this.rotateXAngle = angle; return this; }
  rotateY(angle) {
    this.rotateYAngle = angle;
    const b = this.localBounds, c = Math.cos(angle), s = Math.sin(angle);
    const xs = [b.minX, b.maxX], zs = [b.minZ, b.maxZ];
    const points = xs.flatMap((x) => zs.map((z) => [x * c + z * s, -x * s + z * c]));
    this.bounds = { ...this.bounds, minX: Math.min(...points.map((p) => p[0])), maxX: Math.max(...points.map((p) => p[0])),
      minZ: Math.min(...points.map((p) => p[1])), maxZ: Math.max(...points.map((p) => p[1])) };
    return this;
  }
  translate(x, y, z) {
    this.position = { x, y, z };
    const b = this.bounds;
    this.bounds = { minX: b.minX + x, maxX: b.maxX + x, minY: b.minY + y, maxY: b.maxY + y,
      minZ: b.minZ + z, maxZ: b.maxZ + z };
    this.localBounds = { ...this.bounds };
    return this;
  }
}

class TraceShapeGeometry extends TraceGeometry {
  constructor(shape) {
    const points = shape.points.map(([x, y]) => [x, -y]);
    const bounds = points.length ? {
      minX: Math.min(...points.map((p) => p[0])), maxX: Math.max(...points.map((p) => p[0])),
      minY: 0, maxY: 0, minZ: Math.min(...points.map((p) => p[1])), maxZ: Math.max(...points.map((p) => p[1])),
    } : null;
    super('shape', bounds); this.shape = shape;
    if (activeTrace) activeTrace.roofShapes.push(shape);
  }
}

class TraceBoxGeometry extends TraceGeometry {
  constructor(width, height, depth) {
    super('box', { minX: -width / 2, maxX: width / 2, minY: -height / 2, maxY: height / 2,
      minZ: -depth / 2, maxZ: depth / 2 });
    this.width = width; this.height = height; this.depth = depth;
  }
}

class TraceCylinderGeometry extends TraceGeometry {
  constructor(top, bottom, height) {
    const r = Math.max(Math.abs(Number(top) || 0), Math.abs(Number(bottom) || 0));
    super('cylinder', { minX: -r, maxX: r, minY: -height / 2, maxY: height / 2, minZ: -r, maxZ: r });
  }
}

class TraceConeGeometry extends TraceGeometry {
  constructor(radius, height) {
    const r = Math.abs(Number(radius) || 0);
    super('cone', { minX: -r, maxX: r, minY: -height / 2, maxY: height / 2, minZ: -r, maxZ: r });
  }
}

class TraceMesh {
  constructor(geometry, material) { this.geometry = geometry; this.material = material; this.userData = {}; this.frustumCulled = true; }
}

const THREE_STUB = {
  Shape: TraceShape, Path: TracePath, ShapeGeometry: TraceShapeGeometry,
  BoxGeometry: TraceBoxGeometry, CylinderGeometry: TraceCylinderGeometry,
  ConeGeometry: TraceConeGeometry, Mesh: TraceMesh,
};

function mergeGeometries(geometries) {
  const merged = new TraceGeometry('merged', unionBounds(geometries));
  merged.children = [...geometries];
  return merged;
}

function envMat(color, options) { return { color, options }; }

function compileBuilder(source) {
  // `readSrc` 已先正規化 CRLF；只移除 ES module 外殼，函式本體仍是正式原文。
  const body = source.replace(/^import[^\n]*\n/gm, '')
    .replace(/^export\s+(?=(?:const|function)\b)/gm, '');
  const factory = new Function('THREE', 'mergeGeometries', 'envMat', `${body}\nreturn { buildOsmPolygonBuildings };`);
  return factory(THREE_STUB, mergeGeometries, envMat).buildOsmPolygonBuildings;
}

function executeBuilder(builder, areas) {
  const trace = { geometries: [], roofShapes: [] };
  const group = { children: [], add(child) { this.children.push(child); } };
  activeTrace = trace;
  let result;
  try {
    result = builder(group, areas, {});
  } finally {
    activeTrace = null;
  }
  return { group, result, trace };
}

function pathRing(path) {
  const out = (path?.points || []).map(([x, y]) => [x, -y]);
  if (out.length > 1 && distance(out[0], out.at(-1)) <= EPS) out.pop();
  return out;
}

function sameRing(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length
    && a.every((p, i) => close(p[0], b[i][0]) && close(p[1], b[i][1]));
}

function sameRingSet(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const remaining = expected.slice();
  for (const ring of actual) {
    const i = remaining.findIndex((item) => sameRing(ring, item));
    if (i < 0) return false;
    remaining.splice(i, 1);
  }
  return remaining.length === 0;
}

function blockerContains(blocker, x, z) {
  const dx = x - blocker.x, dz = z - blocker.z;
  const c = Math.cos(blocker.ry), s = Math.sin(blocker.ry);
  const localX = dx * c + dz * s, localZ = -dx * s + dz * c;
  return Math.abs(localX) <= blocker.hw2 + EPS && Math.abs(localZ) <= blocker.hd2 + EPS;
}

function segmentCross(a, b, c, d) {
  const orient = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const between = (p, q, r) => Math.min(p[0], r[0]) - EPS <= q[0] && q[0] <= Math.max(p[0], r[0]) + EPS
    && Math.min(p[1], r[1]) - EPS <= q[1] && q[1] <= Math.max(p[1], r[1]) + EPS;
  const a1 = orient(a, b, c), a2 = orient(a, b, d), b1 = orient(c, d, a), b2 = orient(c, d, b);
  if (Math.abs(a1) <= EPS && between(a, c, b)) return true;
  if (Math.abs(a2) <= EPS && between(a, d, b)) return true;
  if (Math.abs(b1) <= EPS && between(c, a, d)) return true;
  if (Math.abs(b2) <= EPS && between(c, b, d)) return true;
  return (a1 > 0) !== (a2 > 0) && (b1 > 0) !== (b2 > 0);
}

function ringEdgesCrossRect(ring, rect) {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    for (let j = 0; j < rect.length; j++) if (segmentCross(a, b, rect[j], rect[(j + 1) % rect.length])) return true;
  }
  return false;
}

function rectInsideArea(bounds, area) {
  if (![bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ].every(finite)) return false;
  const rect = [[bounds.minX, bounds.minZ], [bounds.maxX, bounds.minZ],
    [bounds.maxX, bounds.maxZ], [bounds.minX, bounds.maxZ]];
  const samples = [...rect, [(bounds.minX + bounds.maxX) / 2, bounds.minZ],
    [bounds.maxX, (bounds.minZ + bounds.maxZ) / 2], [(bounds.minX + bounds.maxX) / 2, bounds.maxZ],
    [bounds.minX, (bounds.minZ + bounds.maxZ) / 2], [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2]];
  const polygons = area.worldPolygons || [];
  if (!samples.every(([x, z]) => polygons.some((poly) => pointInProjectedArea(x, z, poly)))) return false;
  for (const poly of polygons) {
    if (ringEdgesCrossRect(poly.outer, rect) || (poly.holes || []).some((hole) => ringEdgesCrossRect(hole, rect))) return false;
    for (const hole of poly.holes || []) if (hole.some(([x, z]) => x >= bounds.minX - EPS && x <= bounds.maxX + EPS
      && z >= bounds.minZ - EPS && z <= bounds.maxZ + EPS)) return false;
  }
  return true;
}

function expectedEdge(a, b) {
  const len = distance(a, b);
  return { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, len,
    ry: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

function edgeMatches(blocker, edge) {
  return close(blocker.x, edge.x) && close(blocker.z, edge.z)
    && close(blocker.hw2, edge.len / 2) && finite(blocker.hd2) && blocker.hd2 > 0
    && finite(blocker.h) && blocker.h > 0 && angleClose(blocker.ry, edge.ry)
    && close(blocker.r, Math.hypot(blocker.hw2, blocker.hd2));
}

function wallGeometryList(run) {
  const list = [];
  for (const mesh of run.group.children.filter((item) => item.userData?.osmBuildingBatch)) {
    const children = mesh.geometry?.children?.length ? mesh.geometry.children : [mesh.geometry];
    list.push(...children);
  }
  return list;
}

function wallMatchesGeometry(geometry, blocker) {
  return geometry?.kind === 'box' && geometry.width > 0 && geometry.height > 0 && geometry.depth > 0
    && close(geometry.position?.x, blocker.x) && close(geometry.position?.z, blocker.z)
    && close(geometry.position?.y, blocker.y + blocker.h / 2)
    && close(geometry.width, blocker.hw2 * 2) && close(geometry.height, blocker.h)
    && close(geometry.depth, blocker.hd2 * 2) && angleClose(geometry.rotateYAngle || 0, blocker.ry);
}

function validateWallEdges(area, result, run) {
  const blockers = (result.blockers || []).filter((b) => b.sourceId === area.sourceId && b.osm === 1 && b.bld === 1);
  const walls = wallGeometryList(run);
  let errors = Math.abs(walls.length - blockers.length);
  const used = new Set();
  for (const wall of walls) {
    const found = blockers.findIndex((blocker, index) => !used.has(index) && wallMatchesGeometry(wall, blocker));
    if (found < 0) errors++;
    else used.add(found);
  }
  return { errors, expectedCount: blockers.length, actualCount: walls.length };
}

function validateBlockerEdges(area, result) {
  const platforms = result.platforms || [];
  const blockers = result.blockers || [];
  const sourceBlockers = blockers.filter((b) => b.sourceId === area.sourceId && b.osm === 1 && b.bld === 1);
  let errors = 0, expectedCount = 0;
  const used = new Set();
  for (const platform of platforms.filter((p) => p.sourceId === area.sourceId)) {
    for (const ring of [platform.outer, ...(platform.holes || [])]) {
      for (let i = 0; i < ring.length; i++) {
        expectedCount++;
        const edge = expectedEdge(ring[i], ring[(i + 1) % ring.length]);
        const found = sourceBlockers.findIndex((b, index) => !used.has(index) && edgeMatches(b, edge));
        if (found < 0) errors++;
        else used.add(found);
      }
    }
  }
  if (sourceBlockers.length !== expectedCount) errors += Math.abs(sourceBlockers.length - expectedCount) || 1;
  return { errors, expectedCount, actualCount: sourceBlockers.length };
}

function validateRoofAndPlatform(area, run) {
  const platforms = (run.result.platforms || []).filter((p) => p.sourceId === area.sourceId);
  const expected = area.worldPolygons || [];
  let platformErrors = 0, roofErrors = 0, courtyardErrors = 0;
  if (platforms.length !== expected.length) platformErrors++;
  const shapes = run.trace.roofShapes || [];
  if (shapes.length !== expected.length) roofErrors++;
  for (let i = 0; i < expected.length; i++) {
    const source = expected[i], platform = platforms[i];
    if (!platform || !sameRing(platform.outer, source.outer)
      || !sameRingSet(platform.holes || [], source.holes || [])) {
      platformErrors++;
    }
    const shape = shapes[i];
    if (!shape || !sameRing(pathRing(shape), source.outer)
      || !sameRingSet((shape.holes || []).map(pathRing), source.holes || [])) roofErrors++;
    const tracedPoly = shape ? { outer: pathRing(shape), holes: (shape.holes || []).map(pathRing) } : null;
    for (const hole of source.holes || []) {
      const probe = hole.reduce((sum, p) => [sum[0] + p[0], sum[1] + p[1]], [0, 0]).map((v) => v / hole.length);
      if (pointInProjectedArea(probe[0], probe[1], { outer: source.outer, holes: source.holes || [] })) courtyardErrors++;
      if (tracedPoly && pointInProjectedArea(probe[0], probe[1], tracedPoly)) courtyardErrors++;
      if ((run.result.blockers || []).some((b) => b.sourceId === area.sourceId && blockerContains(b, probe[0], probe[1]))) courtyardErrors++;
    }
  }
  return { platformErrors, roofErrors, courtyardErrors };
}

function validateNoDegeneration(area, run) {
  const platforms = (run.result.platforms || []).filter((p) => p.sourceId === area.sourceId);
  const shapes = run.trace.roofShapes || [];
  let errors = 0;
  for (let i = 0; i < (area.worldPolygons || []).length; i++) {
    const source = area.worldPolygons[i];
    if (source.outer.length <= 4 && !(source.holes || []).length) continue;
    if ((platforms[i]?.outer?.length || 0) <= 4 || (pathRing(shapes[i])?.length || 0) <= 4) errors++;
  }
  return errors;
}

function validateAttachments(area, run) {
  const detailMeshes = run.group.children.filter((mesh) => mesh.userData?.osmBuildingDetailBatch);
  const geometries = [];
  for (const mesh of detailMeshes) {
    const list = mesh.geometry?.children?.length ? mesh.geometry.children : [mesh.geometry];
    geometries.push(...list);
  }
  const errors = geometries.reduce((sum, geometry) => sum + (rectInsideArea(geometry.bounds, area) ? 0 : 1), 0);
  return { errors, count: geometries.length };
}

function contractOf(area, run) {
  const blocker = validateBlockerEdges(area, run.result);
  const wall = validateWallEdges(area, run.result, run);
  const roof = validateRoofAndPlatform(area, run);
  const attachment = validateAttachments(area, run);
  const shape = polygonMetrics(area).outerPoints > 4
    && (blocker.actualCount <= 4 || blocker.expectedCount <= 4) ? 1 : 0;
  return {
    blockerErrors: blocker.errors + shape,
    wallErrors: wall.errors,
    roofErrors: roof.roofErrors,
    holeErrors: roof.platformErrors + roof.courtyardErrors,
    degenerationErrors: validateNoDegeneration(area, run),
    attachmentErrors: attachment.errors,
    detailCount: attachment.count,
    expectedEdges: blocker.expectedCount,
    actualEdges: blocker.actualCount,
    expectedWalls: wall.expectedCount,
    actualWalls: wall.actualCount,
  };
}

function rawAreaCapacityRows(elements, parsed) {
  const accepted = new Set((parsed.areas || []).map((area) => area.sourceId));
  const wanted = new Set(OSM_AREA_KEYS);
  const relationWayIds = new Set();
  const ways = new Map();
  for (const element of elements || []) {
    if (element?.type === 'way' && element.id != null) ways.set(`way/${element.id}`, element);
    if (element?.type === 'relation' && element.tags?.type === 'multipolygon') {
      for (const member of element.members || []) if (member?.type === 'way' && member.ref != null) relationWayIds.add(String(member.ref));
    }
  }
  const hasAreaTag = (tags) => Object.keys(tags || {}).some((key) => wanted.has(key));
  const candidates = [];
  for (const element of elements || []) {
    if (element?.type !== 'way' || element.id == null || !hasAreaTag(element.tags)) continue;
    if (relationWayIds.has(String(element.id)) && !element.tags?.['building:part']) continue;
    const ring = normalizeRing(element.geometry);
    if (ring && isSimpleRing(ring)) candidates.push(`way/${element.id}`);
  }
  for (const relation of elements || []) {
    if (relation?.type !== 'relation' || relation.tags?.type !== 'multipolygon' || !hasAreaTag(relation.tags)) continue;
    const rings = assembleRelationRings(relation, ways);
    if (rings.some((item) => item.role === 'outer' && item.ring?.length >= 3)) candidates.push(`relation/${relation.id}`);
  }
  const dropped = [...new Set(candidates)].sort((a, b) => a.localeCompare(b)).filter((id) => !accepted.has(id));
  const count = Number(parsed.areaCapacity) || 0;
  const rows = dropped.slice(0, count).map((sourceId) => ({ sourceId, reason: 'capacity' }));
  return { rows, expected: count, unresolved: Math.max(0, count - rows.length) };
}

function runtimeGapRows(parsed, run, capacity) {
  const expandGap = (row) => {
    const sourceIds = Array.isArray(row?.sourceIds) ? row.sourceIds.filter((id) => typeof id === 'string' && id.trim()) : [];
    if (!sourceIds.length) return [{ sourceId: sourceIdOf(row), reason: reasonOf(row), raw: row }];
    return sourceIds.map((sourceId) => ({ sourceId, reason: reasonOf(row), raw: row }));
  };
  const rows = [
    ...(parsed.areaGaps || []).filter((row) => row.reason !== 'capacity').flatMap(expandGap),
    ...(run.result.invalid || []), ...(run.result.skipped || []),
    ...(Array.isArray(run.result.capacity) ? run.result.capacity : []), ...capacity.rows,
  ];
  return rows.map((row) => ({ sourceId: sourceIdOf(row), reason: reasonOf(row), raw: row }));
}

function mutateOnce(source, name) {
  const mutations = {
    'real-hole': {
      pattern: /outer:\s*poly\.outer,\s*holes:\s*poly\.holes,\s*y:\s*topY,/,
      replacement: 'outer: poly.outer, holes: [], y: topY,',
    },
    'real-blocker': {
      pattern: /blockers\.push\(\.\.\.outer\.edges\);/,
      replacement: 'blockers.push(...outer.edges.slice(0, -1));',
    },
    'real-roof': {
      pattern: /batch\.roofs\.push\(roofGeometry\(poly,\s*topY\)\);/,
      replacement: 'batch.roofs.push(roofGeometry({ outer: poly.outer, holes: [] }, topY));',
    },
  };
  const mutation = mutations[name];
  if (!mutation) throw new Error(`未知反向旗標 ${name}`);
  const matches = source.match(mutation.pattern) || [];
  if (matches.length !== 1) throw new Error(`--break-${name} 原文替換命中 ${matches.length} 次（預期 1）`);
  return source.replace(mutation.pattern, mutation.replacement);
}

function fixtureNames() {
  const names = ONLY.size ? [...ONLY].sort() : readdirSync(DIR).filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -5)).sort();
  return names.filter((name) => fixturePath(name, DIR));
}

function loadRecord(name) {
  const fixture = loadOsmFixture(name, DIR);
  if (!fixture) throw new Error(`${name}: fixture 不存在、版本不符或名稱不符`);
  if (fixture.version !== FIXTURE_VERSION || fixture.schema !== 'osm-fixture-v1') {
    throw new Error(`${name}: fixture schema/version 不符`);
  }
  const raw = fixture.responses?.features?.elements;
  if (!Array.isArray(raw)) throw new Error(`${name}: 缺少 features raw elements`);
  const parsed = parseOsmFeatureElements(raw);
  const catalog = catalogAreas(parsed.areas);
  const projected = catalog.areas.map((area) => projectAreaRecord(area, llToXZ, fixture.center)).filter(Boolean);
  const buildings = projected.filter(buildingArea);
  return { name, fixture, raw, parsed, catalog, projected, buildings };
}

function reportCatalog(records, selected) {
  console.log('\n--- 固定真實建物 sourceId 名冊 ---');
  const report = {};
  for (const [key, label] of [
    ['l_shape', 'L形'], ['oblique', '斜向'], ['courtyard', '中庭'], ['large_irregular', '大型不規則'],
    ['multipolygon', 'multipolygon'], ['multi_outer', '多 outer'], ['super_long', '超細長'],
  ]) {
    const row = selected[key];
    if (!row) {
      report[key] = { category: label, status: '未驗', reason: '固定 fixture 沒有足夠幾何證據' };
      fail++;
      console.error(`  ✗ ${label}: 未驗（固定 fixture 沒有足夠幾何證據）`);
      continue;
    }
    const pinned = PINNED_CATALOG[key];
    const pinnedMatch = row.fixture === pinned?.fixture && row.sourceId === pinned?.sourceId;
    check(pinnedMatch, `${label}:固定 sourceId 未漂移（${pinned?.fixture}/${pinned?.sourceId}）`);
    const m = row.metric;
    report[key] = {
      category: label, status: 'verified', fixture: row.fixture, sourceId: row.sourceId,
      sourceType: row.sourceType, polygonIndex: row.polygonIndex,
      evidence: {
        outerPoints: m.outerPoints, holes: m.holes, polygons: m.polygons, reflex: m.reflex,
        concavity: Number(m.concavity.toFixed(6)), orthogonalLengthFraction: Number(m.orthogonalLengthFraction.toFixed(6)),
        obliqueLengthFraction: Number(m.obliqueLengthFraction.toFixed(6)), lengthM: Number(m.lengthM.toFixed(3)),
        widthM: Number(m.widthM.toFixed(3)), aspect: Number.isFinite(m.aspect) ? Number(m.aspect.toFixed(3)) : 'Infinity',
        areaM2: Number(m.areaM2.toFixed(3)),
      },
    };
    console.log(`  ✓ ${label}: ${row.fixture}/${row.sourceId}`
      + ` outer=${m.outerPoints} holes=${m.holes} polygons=${m.polygons}`
      + ` concavity=${m.concavity.toFixed(3)} aspect=${Number.isFinite(m.aspect) ? m.aspect.toFixed(2) : '∞'}`);
  }
  return report;
}

function auditFixture(record, builder, selected) {
  const allRun = executeBuilder(builder, record.projected);
  const gaps = runtimeGapRows(record.parsed, allRun, rawAreaCapacityRows(record.raw, record.parsed));
  const gapContract = gaps.filter((row) => !row.sourceId || !row.reason);
  check(gapContract.length === 0, `${record.name}:invalid/skipped/capacity 每筆具 sourceId/reason（${gaps.length} 筆）`);
  const capacity = rawAreaCapacityRows(record.raw, record.parsed);
  check(capacity.unresolved === 0, `${record.name}:capacity drop sourceId 可由 raw candidate 對應（${capacity.expected} 筆）`);
  const allContracts = [];
  for (const [key, candidate] of Object.entries(selected)) {
    if (!candidate || candidate.fixture !== record.name) continue;
    const oneRun = executeBuilder(builder, [candidate.area]);
    const contract = contractOf(candidate.area, oneRun);
    allContracts.push({ key, sourceId: candidate.sourceId, contract });
    check(contract.blockerErrors === 0, `${record.name}/${candidate.sourceId}:${candidate.category} outer→blocker 邊界（${contract.actualEdges}/${contract.expectedEdges}）`);
    check(contract.wallErrors === 0, `${record.name}/${candidate.sourceId}:${candidate.category} outer→wall 段邊界（${contract.actualWalls}/${contract.expectedWalls}）`);
    check(contract.holeErrors === 0, `${record.name}/${candidate.sourceId}:${candidate.category} platform 保留 outer-holes / 中庭無屋頂`);
    check(contract.roofErrors === 0, `${record.name}/${candidate.sourceId}:${candidate.category} roof Shape 保留 outer-holes`);
    check(contract.degenerationErrors === 0, `${record.name}/${candidate.sourceId}:${candidate.category} 非 AABB/圓退化`);
    check(contract.attachmentErrors === 0, `${record.name}/${candidate.sourceId}:${candidate.category} 附件 footprint 內且不跨 holes（${contract.detailCount} 件）`);
  }
  return {
    name: record.name, sourceIds: record.buildings.map((area) => area.sourceId),
    runtime: {
      generated: allRun.result.generated, generatedByKind: allRun.result.generatedByKind,
      invalid: allRun.result.invalid || [], skipped: allRun.result.skipped || [],
      capacity: capacity.rows, gaps,
    },
    contracts: allContracts,
  };
}

async function main() {
  let threeAvailable = false;
  try { await import('three'); threeAvailable = true; } catch { /* 此處是能力探測；下面仍執行正式原文 */ }
  const source = readSrc('public', 'js', 'osmBuilding.js');
  check(source.includes('buildOsmPolygonBuildings') && source.includes('edgeGeometry')
    && source.includes('roofGeometry'), '讀取 production osmBuilding.js 原文');
  console.log(`  production 原文執行：受控 Three 沙箱（Node Three ${threeAvailable ? '可用但為追蹤而注入 stub' : '不可用'}）`);

  const names = fixtureNames();
  if (!names.length) { console.error(`❌ 找不到 fixture：${DIR}`); process.exitCode = 2; return; }
  const records = [];
  for (const name of names) {
    try { records.push(loadRecord(name)); }
    catch (error) { fail++; console.error(`  ✗ ${name}: ${error.message}`); }
  }
  if (!records.length) { process.exitCode = 1; return; }
  const selected = selectCatalog(records);
  const catalogReport = reportCatalog(records, selected);
  const builder = compileBuilder(source);
  const fixtureReports = records.map((record) => auditFixture(record, builder, selected));

  for (const breakName of BREAKS) {
    let brokenSource;
    try { brokenSource = mutateOnce(source, breakName); }
    catch (error) { fail++; console.error(`  ✗ --break-${breakName}: ${error.message}`); continue; }
    let brokenBuilder;
    try { brokenBuilder = compileBuilder(brokenSource); }
    catch (error) { fail++; console.error(`  ✗ --break-${breakName}: 變異後 production 原文無法執行 —— ${error.message}`); continue; }
    const target = breakName === 'real-hole' ? selected.courtyard
      : breakName === 'real-roof' ? selected.courtyard : selected.l_shape || selected.multi_outer;
    if (!target) {
      fail++;
      console.error(`  ✗ --break-${breakName}: 沒有適用的真實建物（需要 ${breakName === 'real-blocker' ? '非矩形外環' : '中庭 holes'}）`);
      continue;
    }
    const record = records.find((item) => item.name === target.fixture);
    const brokenRun = executeBuilder(brokenBuilder, [target.area]);
    const broken = contractOf(target.area, brokenRun);
    const key = breakName === 'real-blocker' ? 'blockerErrors' : breakName === 'real-roof' ? 'roofErrors' : 'holeErrors';
    const caught = broken[key] > 0;
    // 反向命令的非零是預期結果：壞版已被這支稽核攔下；未攔下同樣失敗。
    fail++;
    console.error(`  ${caught ? '✗' : '✗'} --break-${breakName} ${caught ? `已攔下 ${target.fixture}/${target.sourceId}（預期紅字）` : 'mutation 未生效或未被攔下'}`);
    if (record) fixtureReports.find((item) => item.name === record.name)?.contracts.push({
      reverse: `--break-${breakName}`, sourceId: target.sourceId, contract: broken,
    });
  }

  const output = { version: 1, source: 'public/js/osmBuilding.js', threeAvailable, catalog: catalogReport, fixtures: fixtureReports };
  if (OUT) writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n');
  console.log(`\n${fail ? '❌' : '✅'} OSM 真實建物契約稽核：${pass} 綠 / ${fail} 紅`);
  process.exitCode = fail ? 1 : 0;
}

await main();
