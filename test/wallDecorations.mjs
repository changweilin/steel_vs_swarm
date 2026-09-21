import assert from 'node:assert/strict';
import { register } from 'node:module';
const modules = {
  three: new URL('../out/forest_review/three.module.js', import.meta.url).href,
  'three/addons/utils/BufferGeometryUtils.js': new URL('../out/forest_review/utils_BufferGeometryUtils.js', import.meta.url).href,
};
register('data:text/javascript,' + encodeURIComponent(`const modules = ${JSON.stringify(modules)};
export async function resolve(s, c, next) { return modules[s] ? { url: modules[s], shortCircuit: true } : next(s, c); }`), import.meta.url);
const { wallDecorationParts } = await import('../public/js/wallDecorations.js');
const { WALL_DECORATIONS, WALL_COVERAGE, WALL_DECORATION_LIMIT } = await import('../public/js/wallDecorationCatalog.js');
const { architecturePartGeometry } = await import('../public/js/architecturePartGeometry.js');
const { generateBuildingAppurtenances } = await import('../public/js/buildingAppurtenances.js');
const { buildOsmPolygonBuildings } = await import('../public/js/osmBuilding.js');
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
console.log(`PASS: ${kinds.size} themes, ${scopes.size} coverage patterns, geometry bounds, entrance clearance, deterministic plans and ${integratedKinds.size} integrated themes.`);
