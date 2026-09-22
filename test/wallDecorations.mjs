import assert from 'node:assert/strict';
import { register } from 'node:module';
const modules = {
  three: new URL('../out/forest_review/three.module.js', import.meta.url).href,
  'three/addons/utils/BufferGeometryUtils.js': new URL('../out/forest_review/utils_BufferGeometryUtils.js', import.meta.url).href,
};
register('data:text/javascript,' + encodeURIComponent(`const modules = ${JSON.stringify(modules)};
export async function resolve(s, c, next) { return modules[s] ? { url: modules[s], shortCircuit: true } : next(s, c); }`), import.meta.url);
const { wallDecorationParts, generateSeamlessVinePattern, LOW_RISE_LIMIT } = await import('../public/js/wallDecorations.js');
const { WALL_DECORATIONS, WALL_COVERAGE, WALL_DECORATION_LIMIT } = await import('../public/js/wallDecorationCatalog.js');
const { architecturePartGeometry } = await import('../public/js/architecturePartGeometry.js');
const { generateBuildingAppurtenances } = await import('../public/js/buildingAppurtenances.js');
const { buildOsmPolygonBuildings } = await import('../public/js/osmBuilding.js');
const { architecturalRoofParts } = await import('../public/js/architectureRoofParts.js');
const THREE = await import('three');
const kinds = new Set(), scopes = new Set();
const originalRandom = Math.random;
// The pure planner must never consume a shared or nondeterministic sequence.
Math.random = () => { throw Error('Unexpected random call'); };
try {
  for (const category of ['commercial', 'residential', 'industrial', 'rural', 'tourism', 'civic']) {
    for (let seed = 0; seed < 80; seed++) {
      const options = { seed: `wall:${seed}`, width: 3 + seed % 27, height: 3 + seed % 33,
        category, contemporary: seed % 2 === 0, budget: 64,
        claims: [{ x: 0, y: 1, w: 2, h: 2 }] };
      const parts = wallDecorationParts(options);
      assert.deepEqual(parts, wallDecorationParts(options));
      assert(parts.length <= options.budget);
      for (const part of parts) {
        kinds.add(part.role.slice(5)); scopes.add(part.scope);
        if (!options.contemporary) assert(!WALL_DECORATIONS[part.role.slice(5)].modern);
      }
    }
  }
} finally { Math.random = originalRandom; }
assert.deepEqual([...kinds].sort(), Object.keys(WALL_DECORATIONS).sort());
assert.deepEqual([...scopes].sort(), Object.keys(WALL_COVERAGE).sort());
// Verify actual transformed primitives, including leaves, against the wall and claims.
for (let seed = 0; seed < 200; seed++) {
  const options = { seed: `bounds:${seed}`, width: 3 + seed % 20, height: 3 + seed % 30,
    category: 'residential', contemporary: true, claims: [{ x: 0, y: 1.7, w: 40, h: 3.4 }] };
  for (const part of wallDecorationParts(options)) {
    const geo = architecturePartGeometry(part); geo.computeBoundingBox();
    const { min, max } = geo.boundingBox;
    assert(geo.attributes.position.array.every(Number.isFinite));
    assert(min.x >= -options.width / 2 && max.x <= options.width / 2, part.role + ' width');
    assert(min.y >= 3.4 && max.y <= options.height, part.role + ' height / entrance');
    assert(min.z > 0, part.role + ' wall embed');
    geo.dispose();
  }
}
for (const options of [{ width: NaN, height: 9 }, { width: 0, height: 9 }, { width: 9, height: Infinity }]) {
  assert.deepEqual(wallDecorationParts({ ...options, category: 'residential', seed: 'invalid' }), []);
}
assert.deepEqual(wallDecorationParts({ seed: 'occupied', width: 20, height: 20, category: 'residential',
  claims: [{ x: 0, y: 10, w: 20, h: 20 }] }), []);
const integratedKinds = new Set();
for (let seed = 0; seed < 36; seed++) {
  const angle = seed * Math.PI / 18, c = Math.cos(angle), s = Math.sin(angle);
  const rotate = ([x, z]) => [x * c - z * s, x * s + z * c];
  const poly = { outer: [[-12,-8],[12,-8],[12,8],[-12,8]].map(rotate), holes: [] };
  const edges = [[0,-8,12,0],[12,0,8,Math.PI/2],[0,8,12,0],[-12,0,8,Math.PI/2]].map(([x,z,hw2,ry]) => {
    const [rx, rz] = rotate([x,z]); return { x: rx, z: rz, hw2, ry: ry + angle, sourceId: `fixture:${seed}` };
  });
  const style = { id: `wall-test:${seed}`, variant: 0, roofForm: 'flat', trim: 0x69757d,
    functionInfo: { category: seed % 2 ? 'residential' : 'commercial' } };
  const geos = generateBuildingAppurtenances(poly, edges, 0, 24, style);
  const art = geos.filter(g => g.userData.wallDecoration);
  assert(art.length <= WALL_DECORATION_LIMIT);
  for (const geo of geos) {
    assert(geo.attributes.position.array.every(Number.isFinite));
    if (geo.userData.wallDecoration) integratedKinds.add(geo.userData.wallDecoration);
    geo.dispose();
  }
}
assert(integratedKinds.has('wall-video'), 'Video walls must survive actual accessory occupancy');
assert(integratedKinds.size >= 6, 'Integrated placement retains wall diversity');
// Exercise the production merge/material adapter, not only isolated primitives.
const group = new THREE.Group();
const result = buildOsmPolygonBuildings(group, [{ sourceId: 'wall-integration', tags: { building: 'commercial', height: '18' },
  centroid: { x: 0, z: 0 }, classification: { generator: 'polygonBuilding', kind: 'commercial' },
  worldPolygons: [{ outer: [[-10,-8],[10,-8],[10,8],[-10,8]], holes: [] }],
}], { terrain: { heightAt: () => 0 }, architectureOf: () => ({ id: 'wall-integration', wall: 0xbab7a5,
  roof: 0x667788, trim: 0x445566, glass: 0x7799aa, variant: 0, profile: 'plain', roofForm: 'flat',
  functionInfo: { category: 'commercial' } }) });
assert.equal(result.generated, 1);
assert(group.children.length > 0);
group.traverse(object => {
  if (!object.geometry) return;
  assert(object.geometry.attributes.position.array.every(Number.isFinite));
  assert.equal(object.geometry.attributes.color.count, object.geometry.attributes.position.count);
  object.geometry.dispose();
});
// 1. 爬藤多塊連續拼接 (Seamless Connection) 與完全不重複 (Non-repeating Pattern) 測試
const vineMotif = generateSeamlessVinePattern({
  seed: 'seamless_vine_test', slot: 0, site: { x: 0, y: 0 },
  w: 6, h: 4, kind: 'ivy', rule: WALL_DECORATIONS.ivy, scope: 'field',
  cols: 3, rows: 2, budget: 120,
});
assert(vineMotif.length >= 24, 'Multi-block vine motif generated adequate primitives');
// 驗證各塊幾何圖案不重複
const blockFingerprints = new Map();
for (const p of vineMotif) {
  const bk = p.block || 'default';
  if (!blockFingerprints.has(bk)) blockFingerprints.set(bk, []);
  blockFingerprints.get(bk).push(`${p.g[0]}:${p.p.map(n => n.toFixed(2)).join(',')}`);
}
assert.equal(blockFingerprints.size, 6, 'Grid generates all 3x2 blocks');
const fpStrings = [...blockFingerprints.values()].map(arr => arr.join('|'));
const uniqueFpStrings = new Set(fpStrings);
assert.equal(uniqueFpStrings.size, blockFingerprints.size, 'All vine blocks have completely non-repeating patterns');

// 2. 限定低樓層建築使用，陽台/雨遮/冷氣廣泛規律使用項目除外
assert.equal(LOW_RISE_LIMIT, 24);
assert.deepEqual(wallDecorationParts({ seed: 'highrise', width: 12, height: 28, category: 'commercial' }), [],
  'High-rise buildings strictly omit wall decorations');
assert.ok(wallDecorationParts({ seed: 'lowrise:0', width: 12, height: 20, category: 'commercial' }).length > 0,
  'Low-rise buildings allow wall decorations');

// 3. 高樓層建築規律配件保留驗證 (陽台與冷氣室外機在全樓層正常配置)
const tallPoly = { outer: [[-12,-8],[12,-8],[12,8],[-12,8]], holes: [] };
const tallEdges = [[0,-8,12,0],[12,0,8,Math.PI/2],[0,8,12,0],[-12,0,8,Math.PI/2]].map(([x,z,hw2,ry]) => ({
  x, z, hw2, ry, sourceId: 'tall-fixture'
}));
const tallStyle = { id: 'tall-test', variant: 0, roofForm: 'flat', trim: 0x69757d,
  functionInfo: { category: 'residential' } };
const tallGeos = generateBuildingAppurtenances(tallPoly, tallEdges, 0, 36, tallStyle);
// 牆飾全面歸零
assert.equal(tallGeos.filter(g => g.userData.wallDecoration).length, 0, 'No wall decorations on 36m tower');
// 陽台與冷氣室外機在 36m 高樓維持正常配置
assert.ok(tallGeos.length > 20, 'Regular fixtures (balconies, AC units, drying racks) persist on high-rise');
for (const g of tallGeos) g.dispose();

// 4. 非平面屋頂垂直端面同等建築牆面，由建築牆面延伸驗證
for (const form of ['gable', 'shed', 'steep_gable', 'gambrel', 'crowstep']) {
  const rParts = architecturalRoofParts({ outer: [[-10,-6],[10,-6],[10,6],[-10,6]], holes: [] },
    12, { roof: 0x223344, wall: 0x887766, variant: 0 }, form);
  const wallFaces = rParts.filter(p => p.role === 'architecture-wall');
  assert.ok(wallFaces.length > 0, `${form} roof vertical face must extend building wall`);
  assert.ok(wallFaces.every(p => p.c === 0x887766), `${form} roof vertical face must take wall color`);
}

console.log(`PASS: ${kinds.size} themes, ${scopes.size} coverage patterns, geometry bounds, entrance clearance, deterministic plans and ${integratedKinds.size} integrated themes.`);
console.log('PASS: seamless non-repeating vines, low-rise limit with regular fixture preservation, and roof vertical wall extension verified.');
