import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { BUILDING_FUNCTIONS, taggedBuildingFunction } from '../public/js/buildingFunctions.js';
import { nativeFunctionalKind } from '../public/js/nativeFunctionalBuildings.js';
import { heritageStateOf } from '../public/js/heritageSites.js';
import { parseOsmFeatureElements, osmFeatureQuery } from '../public/js/osmQuery.js';
const modules = { three: new URL('../out/forest_review/three.module.js', import.meta.url).href };
register('data:text/javascript,' + encodeURIComponent(`const modules=${JSON.stringify(modules)}; export async function resolve(s,c,next){return modules[s]?{url:modules[s],shortCircuit:true}:next(s,c)}`), import.meta.url);
const THREE = await import('three');
const { TOWER_BUILDINGS, towerSides, buildTowerBuilding } = await import('../public/js/towerBuildings.js');
const biome = readFileSync(new URL('../public/js/biomes.js', import.meta.url), 'utf8');
const routeSource = biome.slice(biome.indexOf('export const CULTURAL_RELIC_LANDMARKS'), biome.indexOf('function buildingHeight(')).replace(/export\s+/g, '');
const route = new Function('nativeFunctionalKind', 'BUILDING_FUNCTIONS', 'taggedBuildingFunction', 'heritageStateOf', `${routeSource}; return matchedBuildingType;`)(nativeFunctionalKind, BUILDING_FUNCTIONS, taggedBuildingFunction, heritageStateOf);
for (const [tags, kind] of [
  [{ man_made: 'tower', 'tower:type': 'bell_tower' }, 'bell_tower'],
  [{ man_made: 'tower', 'tower:type': 'clock' }, 'clock_tower'],
  [{ aeroway: 'control_tower' }, 'control_tower'],
  [{ man_made: 'tower', 'tower:type': 'observation' }, 'observation_tower'],
  [{ man_made: 'tower', 'tower:type': 'defensive' }, 'gun_tower'],
  [{ man_made: 'tower', 'tower:type': 'beacon' }, 'beacon_tower'],
  [{ man_made: 'tower', 'tower:construction': 'lattice' }, 'iron_tower'],
  [{ man_made: 'communications_tower' }, 'radio_tower'],
  [{ historic: 'tower' }, 'watchtower'],
  [{ power: 'tower', man_made: 'tower' }, 'power_tower'],
  [{ amenity: 'hospital', building: 'tower' }, 'hospital'],
]) assert.equal(taggedBuildingFunction(tags)?.type, kind);

const signature = group => {
  group.updateMatrixWorld(true);
  const result = [];
  group.traverse(mesh => {
    if (!mesh.geometry) return;
    const positions = mesh.geometry.attributes.position.array;
    assert.ok(positions.every(Number.isFinite));
    result.push([...positions], mesh.matrixWorld.elements);
  });
  return result;
};
for (const [kind, spec] of Object.entries(TOWER_BUILDINGS)) {
  assert.equal(taggedBuildingFunction({ building: kind }).type, kind);
  assert.equal(route({ building: kind }), kind);
  const signatures = new Set();
  for (const shape of ['round', 'rectangular', 'hexagonal', 'octagonal']) {
    const options = { seed: 27, tags: { 'tower:shape': shape } };
    const a = new THREE.Group(), b = new THREE.Group();
    assert.equal(buildTowerBuilding(a, kind, options), true);
    buildTowerBuilding(b, kind, options);
    assert.deepEqual(signature(a), signature(b), kind);
    signatures.add(JSON.stringify(signature(a)));
    const bounds = new THREE.Box3().setFromObject(a);
    assert.ok(bounds.min.y >= -1e-5 && bounds.max.y <= spec.h + 1e-5, `${kind}: height envelope`);
    a.traverse(mesh => {
      if (!mesh.geometry) return;
      const p = mesh.geometry.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
        assert.ok(Math.hypot(v.x, v.z) <= spec.r + 1e-5, `${kind}: footprint envelope`);
      }
    });
    for (const group of [a, b]) group.traverse(mesh => { mesh.geometry?.dispose(); mesh.material?.dispose(); });
  }
  assert.equal(signatures.size, 4, `${kind}: distinct geometry`);
}
assert.deepEqual([0, 1, 2, 3].map(seed => towerSides({}, seed)), [4, 6, 8, 24]);
assert.equal(towerSides({ 'tower:shape': 'constructor' }), 4);
assert.equal(buildTowerBuilding(new THREE.Group(), 'unknown'), false);
assert.equal(buildTowerBuilding(new THREE.Group(), 'constructor'), false);
const tags = { man_made: 'tower', 'tower:type': 'observation', 'tower:shape': 'hexagonal' };
const parsed = parseOsmFeatureElements([{ type: 'node', id: 1, lat: 25, lon: 121, tags }]);
assert.deepEqual(parsed.pointFeatures.pois[0], { lat: 25, lng: 121, tags });
assert.ok(osmFeatureQuery({ minLat: 25, minLng: 121, maxLat: 25.1, maxLng: 121.1 }).includes('communications_tower'));
console.log('PASS: 9 tower types × 4 shapes, deterministic geometry, height/footprint envelopes, OSM semantics and node routing');
