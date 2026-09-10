import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { BUILDING_FUNCTIONS, taggedBuildingFunction } from '../public/js/buildingFunctions.js';
import { chooseArchitecture, inferBuildingFunction } from '../public/js/buildingDiversity.js';
import { ARCHITECTURE_STYLES, CULTURAL_REGIONS } from '../public/js/architectureStyles.js';
import { nativeFunctionalKind } from '../public/js/nativeFunctionalBuildings.js';
import { heritageStateOf } from '../public/js/heritageSites.js';

const cases = [
  [{ amenity: 'hospital', height: '90', building: 'yes' }, 'hospital'],
  [{ healthcare: 'clinic' }, 'clinic'], [{ building: 'school' }, 'school'],
  [{ amenity: 'university' }, 'university'], [{ amenity: 'kindergarten' }, 'kindergarten'],
  [{ amenity: 'library' }, 'library'], [{ railway: 'station' }, 'station'],
  [{ amenity: 'bus_station' }, 'bus_station'], [{ aeroway: 'terminal' }, 'terminal'],
  [{ aeroway: 'hangar' }, 'hangar'], [{ building: 'parking' }, 'parking'],
  [{ tourism: 'museum', building: 'church' }, 'museum'],
  [{ amenity: 'theatre' }, 'theatre'], [{ amenity: 'townhall' }, 'civic'],
  [{ amenity: 'fire_station' }, 'emergency'], [{ leisure: 'sports_centre' }, 'sports'],
  [{ leisure: 'stadium' }, 'stadium'],
  [{ tourism: 'hotel' }, 'hotel'], [{ amenity: 'marketplace' }, 'market'],
  [{ power: 'plant' }, 'plant'], [{ power: 'substation' }, 'substation'],
  [{ power: 'tower' }, 'power_tower'], [{ power: 'generator' }, 'generator'],
  [{ man_made: 'water_works' }, 'water'], [{ building: 'factory' }, 'factory'],
  [{ building: 'warehouse' }, 'warehouse'], [{ building: 'greenhouse' }, 'greenhouse'],
  [{ building: 'church' }, 'church'], [{ building: 'temple' }, 'temple'],
  [{ building: 'temple', religion: 'hindu' }, 'mandir'],
  [{ amenity: 'place_of_worship', religion: 'muslim' }, 'mosque'],
  [{ amenity: 'place_of_worship', religion: 'shinto' }, 'shrine'],
  [{ building: 'synagogue' }, 'synagogue'], [{ building: 'gurdwara' }, 'gurdwara'],
  [{ amenity: 'place_of_worship', religion: 'buddhist', building: 'stupa' }, 'stupa'],
  [{ building: 'pagoda' }, 'pagoda'], [{ amenity: 'place_of_worship' }, 'worship'],
  [{ historic: 'castle' }, 'castle'], [{ heritage: '2' }, 'heritage'],
  [{ historic: 'archaeological_site' }, 'ruins'], [{ historic: 'memorial' }, 'monument'],
  [{ building: 'pyramid', historic: 'archaeological_site' }, 'pyramid'],
  [{ man_made: 'lighthouse' }, 'lighthouse'],
];
for (const [tags, type] of cases) {
  const inferred = inferBuildingFunction({ tags }, null, { urban: true, rural: true });
  assert.equal(inferred.type, type, JSON.stringify(tags));
  assert.equal(inferred.locked, true);
}
assert.equal(taggedBuildingFunction({ building: 'constructor' }), null);
assert.equal(taggedBuildingFunction({ amenity: 'toString' }), null);
assert.equal(taggedBuildingFunction({ building: 'no', historic: 'no' }), null);
assert.equal(taggedBuildingFunction({ amenity: ' HOSPITAL ' }).type, 'hospital');
assert.equal(inferBuildingFunction({ tags: { building: 'yes' } }, null, { parentTags: { amenity: 'school' } }).type, 'school');
assert.equal(inferBuildingFunction({ tags: { building: 'dormitory' } }, null, { parentTags: { amenity: 'school' } }).category, 'residential');
assert.equal(inferBuildingFunction({ tags: { amenity: 'clinic' } }, null, { parentTags: { amenity: 'school' } }).type, 'clinic');
assert.equal(nativeFunctionalKind({ tourism: 'museum', building: 'church' }), 'museum');

// 執行正式點位路由，避免點位与精確輪廓各維護一套語意。
const biome = readFileSync(new URL('../public/js/biomes.js', import.meta.url), 'utf8');
const source = biome.slice(biome.indexOf('export const CULTURAL_RELIC_LANDMARKS'), biome.indexOf('function buildingHeight(')).replace(/export\s+/g, '');
const route = new Function('nativeFunctionalKind', 'BUILDING_FUNCTIONS', 'taggedBuildingFunction', 'heritageStateOf', `${source}; return matchedBuildingType;`)(nativeFunctionalKind, BUILDING_FUNCTIONS, taggedBuildingFunction, heritageStateOf);
for (const [tags, type] of cases) {
  const rule = BUILDING_FUNCTIONS[type];
  assert.equal(route(tags), ['ruins','monument'].includes(type) ? `heritage_${heritageStateOf(tags)}` : rule.landmark || (rule.structureOnly ? 'unmodeled_structure' : 'functional'));
}
assert.equal(route({ historic: 'archaeological_site' }), 'heritage_tourism');
assert.equal(route({ building: 'stave_church' }), 'stave_church');

for (const [type, rule] of Object.entries(BUILDING_FUNCTIONS)) {
  assert.ok(rule.styles.length);
  for (const id of rule.styles) assert.ok(ARCHITECTURE_STYLES[id], `${type}: ${id}`);
  for (const region of Object.keys(CULTURAL_REGIONS)) for (const slope of [0, 45]) for (let seed = 0; seed < 12; seed++) {
    const context = { region, slope, functionInfo: { type, category: rule.category, key: rule.range, locked: true } };
    const choice = chooseArchitecture(seed, type, context);
    assert.ok(rule.styles.includes(choice.id), `${type} escaped its pool in ${region}`);
    assert.equal(choice.proceduralOnly, true);
    if (slope) assert.equal(choice.foundation, 'retaining');
    assert.deepEqual(choice, chooseArchitecture(seed, type, context));
  }
}

const modules = {
  three: new URL('../out/forest_review/three.module.js', import.meta.url).href,
  'three/addons/utils/BufferGeometryUtils.js': new URL('../out/forest_review/utils_BufferGeometryUtils.js', import.meta.url).href,
};
register('data:text/javascript,' + encodeURIComponent(`const modules=${JSON.stringify(modules)}; export async function resolve(s,c,next){return modules[s]?{url:modules[s],shortCircuit:true}:next(s,c)}`), import.meta.url);
const THREE = await import('three');
const { buildOsmPolygonBuildings } = await import('../public/js/osmBuilding.js');
const { fitApprovedPolygon } = await import('../public/js/approvedBuildingModels.js');
const poly = { outer: [[-10,-6],[10,-6],[10,6],[-10,6]], holes: [] };
for (const [tags, type] of cases) {
  const architecture = chooseArchitecture(5, type, { building: { tags } });
  assert.equal(fitApprovedPolygon(poly, 10, architecture, 5), null);
  const area = { sourceId: type, tags: { ...tags, building: tags.building || 'yes' }, classification: { kind: 'house', generator: 'polygonBuilding' }, worldPolygons: [poly] };
  const group = new THREE.Group();
  const result = buildOsmPolygonBuildings(group, [area], { terrain: { heightAt: () => 0 }, architectureOf: () => architecture });
  assert.equal(result.generated, architecture.structureOnly ? 0 : 1, type);
  for (const mesh of group.children) {
    assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite), type);
    mesh.geometry.dispose();
  }
  if (architecture.structureOnly) assert.ok(result.skipped.some(row => row.reason === 'non_building_function'));
}
console.log(`PASS: ${Object.keys(BUILDING_FUNCTIONS).length} functional pools, explicit tag priority, native routing, campus inheritance, culture/slope isolation and real geometry`);
