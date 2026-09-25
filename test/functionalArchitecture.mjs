import assert from 'node:assert/strict';
import { register } from 'node:module';
import { chooseArchitecture, createArchitecturePlanner } from '../public/js/buildingDiversity.js';
import { BUILDING_FUNCTIONS, taggedBuildingFunction } from '../public/js/buildingFunctions.js';
import { functionalArchitecture, FUNCTIONAL_VARIANTS, FUNCTIONAL_FAMILIES, FUNCTIONAL_DETAIL_LIMIT } from '../public/js/functionalArchitectureCatalog.js';
import { functionalBuildingParts } from '../public/js/functionalBuildingParts.js';
const modules = {
  three: new URL('../out/forest_review/three.module.js', import.meta.url).href,
  'three/addons/utils/BufferGeometryUtils.js': new URL('../out/forest_review/utils_BufferGeometryUtils.js', import.meta.url).href,
};
register('data:text/javascript,' + encodeURIComponent(`const modules=${JSON.stringify(modules)}; export async function resolve(s,c,next){return modules[s]?{url:modules[s],shortCircuit:true}:next(s,c)}`), import.meta.url);
const THREE = await import('three');
const { buildOsmPolygonBuildings } = await import('../public/js/osmBuilding.js');
const { architecturePartGeometry } = await import('../public/js/architecturePartGeometry.js');
const info = type => ({ type, category: BUILDING_FUNCTIONS[type].category, key: BUILDING_FUNCTIONS[type].range, locked: true });
const design = (type, tags = {}, context = {}, seed = 0) => functionalArchitecture(info(type), { building: { tags }, ...context }, seed);
assert.equal(design('church', { denomination: 'orthodox' }).functionalDesign.motif, 'orthodox');
assert.equal(design('mosque', {}, { region: 'maghreb' }).functionalDesign.motif, 'square_minaret');
assert.equal(design('temple', {}, { region: 'japan' }).functionalDesign.id, 'japanese_hall');
assert.equal(design('temple', {}, { region: 'southeast_asia' }).functionalDesign.id, 'theravada_hall');
assert.equal(design('school', { start_date: '1900' }).functionalDesign.id, 'brick_campus');
assert.equal(design('school', { start_date: '2001' }).functionalDesign.id, 'modern_campus');
assert.equal(design('civic', { architecture: 'neoclassical', start_date: '2000' }).functionalDesign.id, 'neoclassical_civic');
assert.equal(design('library', { start_date: '2000', climate: 'alpine' }).roofForm, 'gable');
assert.equal(design('school', { climate: 'tropical' }).detail, 'brise_soleil');
assert.equal(design('civic', { start_date: '1900' }, { region: 'japan' }).functionalDesign.id, 'east_asian_civic');
assert.equal(design('factory', { start_date: '2000', climate: 'arid' }).functionalDesign.id, 'warm_climate_factory');
assert.notEqual(design('museum', { start_date: '1800' }, { geology: 'basalt' }).wall, design('museum', { start_date: '1800' }).wall);
assert.equal(design('museum', { start_date: '1800', 'building:material': 'brick' }, { geology: 'basalt' }).wall,
  design('museum', { start_date: '1800', 'building:material': 'brick' }).wall);
assert.equal(design('plant').functionalDesign.motif, 'energy');
for (const source of ['solar', 'hydro', 'wind', 'nuclear']) assert.equal(design('plant', { 'plant:source': source }).functionalDesign.motif, source);
assert.equal(design('plant', { 'plant:source': 'gas' }).functionalDesign.motif, 'thermal');
assert.equal(design('church', { start_date: 'unknown' }).functionalDesign.year, null);
assert.equal(functionalArchitecture({ type: 'school', locked: false }), null);
assert.equal(taggedBuildingFunction({ office: 'government' }).type, 'civic');
const planner = createArchitecturePlanner({ terrain: { heightAt: () => 10 },
  environmentAt: () => ({ climate: 'tropical', geology: 'basalt' }) });
const planned = planner({ sourceId: 'climate', tags: { tourism: 'museum', start_date: '1800' } });
assert.equal(planned.functionalDesign.climate, 'tropical');
assert.equal(planned.functionalDesign.material, 'basalt');

const rectangle = (w, d) => ({ outer: [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]], holes: [] });
const signatures = new Map();
let variants = 0;
for (const [family, rows] of Object.entries(FUNCTIONAL_VARIANTS)) {
  const type = Object.keys(BUILDING_FUNCTIONS).find(key => (FUNCTIONAL_FAMILIES[key] || key) === family);
  assert.ok(type, family);
  for (const row of rows) {
    const tags = { building: type, architecture: row.id, height: '16', ...(row.climates ? { climate: row.climates[0] } : {}), ...(row.sources ? { 'plant:source': row.sources[0] } : {}),
      ...(row.denominations ? { denomination: row.denominations[0] } : {}) };
    const context = { building: { tags }, functionInfo: info(type), region: row.regions?.[0] };
    const style = chooseArchitecture(12, family, context);
    assert.equal(style.functionalDesign.id, row.id);
    assert.deepEqual(style, chooseArchitecture(12, family, context));
    const edge = { x: 0, z: -10, y: 10, ry: 0, hw2: 12, hd2: 0.25, h: 16 };
    for (const budget of [0, 0.4, 12]) {
      const result = functionalBuildingParts([edge], 10, 26, style, [0,0], 6, budget);
      assert.ok(result.parts.length <= FUNCTIONAL_DETAIL_LIMIT);
      for (const part of result.parts) {
        const geometry = architecturePartGeometry(part);
        assert.ok(geometry.attributes.position.array.every(Number.isFinite), row.id);
        geometry.computeBoundingBox();
        assert.ok(geometry.boundingBox.max.y <= 26 + budget + 1e-4, `${row.id} height cap`);
        geometry.dispose();
      }
      if (budget === 12) signatures.set(row.id, JSON.stringify(result));
    }
    for (const poly of [rectangle(24,20), rectangle(80,12), { outer: [[-12,-10],[12,-10],[12,0],[0,0],[0,10],[-12,10]], holes: [] },
      { ...rectangle(24,20), holes: [rectangle(8,6).outer] }]) {
      const group = new THREE.Group();
      const result = buildOsmPolygonBuildings(group, [{ sourceId: row.id, tags, classification: { kind: 'house', generator: 'polygonBuilding' }, worldPolygons: [poly] }], {
        terrain: { heightAt: () => 10, waterY: -5 }, architectureOf: () => ({ ...style }),
      });
      assert.equal(result.generated, 1, row.id);
      assert.ok(result.blockers.length >= poly.outer.length);
      const marker = functionalBuildingParts(result.blockers.slice(0, poly.outer.length), 10, 26, style).parts[0];
      const expectedGeometry = architecturePartGeometry(marker);
      const expected = expectedGeometry.attributes.position.array;
      const detail = group.children.find(mesh => mesh.userData.osmBuildingDetailBatch);
      const actual = detail.geometry.attributes.position.array;
      let found = false;
      for (let i = 0; i <= actual.length - expected.length; i += 3) {
        if (expected.every((value, j) => Math.abs(value - actual[i + j]) < 1e-5)) { found = true; break; }
      }
      assert.ok(found, `${row.id}: semantic marker must reach the actual render batch`);
      expectedGeometry.dispose();
      for (const mesh of group.children) {
        assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite), row.id);
        mesh.geometry.dispose();
      }
    }
    variants++;
  }
}
assert.equal(new Set(signatures.values()).size, signatures.size, 'variants must change rendered parts');
console.log(`PASS: ${variants} functional variants, religion/region/era/material/climate/source precedence, real polygon geometry, courtyard/concave fallback, bounded details and height caps`);
