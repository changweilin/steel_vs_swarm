import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { chooseArchitecture, createArchitecturePlanner } from '../public/js/buildingDiversity.js';
import { ARCHITECTURE_STYLES, ARCHITECTURE_PROFILES } from '../public/js/architectureStyles.js';

const contexts = { urban: { urban: true }, rural: { rural: true }, plain: {}, hillside: { slope: 24, urban: true } };
for (const [profile, context] of Object.entries(contexts)) {
  const counts = {};
  const count = 12000;
  for (let i = 0; i < count; i++) {
    const result = chooseArchitecture(9182, i, context);
    assert.equal(result.profile, profile);
    counts[result.id] = (counts[result.id] || 0) + 1;
    if (i < 10) assert.deepEqual(result, chooseArchitecture(9182, i, context));
  }
  const total = Object.values(ARCHITECTURE_PROFILES[profile]).reduce((a, b) => a + b, 0);
  for (const [id, weight] of Object.entries(ARCHITECTURE_PROFILES[profile])) {
    assert.ok(Math.abs(counts[id] / count - weight / total) < 0.02, `${profile}:${id} 比例偏離`);
  }
  console.log(profile, counts);
}
assert.ok(Array.from({ length: 100 }, (_, i) => chooseArchitecture(1, i).id !== chooseArchitecture(2, i).id).filter(Boolean).length > 60);

if (process.env.THREE_MODULE && process.env.THREE_BUFFER_UTILS) {
  const modules = {
    three: pathToFileURL(process.env.THREE_MODULE).href,
    'three/addons/utils/BufferGeometryUtils.js': pathToFileURL(process.env.THREE_BUFFER_UTILS).href,
  };
  register('data:text/javascript,' + encodeURIComponent(`
    const modules = ${JSON.stringify(modules)};
    export async function resolve(specifier, context, next) {
      return modules[specifier] ? { url: modules[specifier], shortCircuit: true } : next(specifier, context);
    }
  `), import.meta.url);
}
const THREE = await import('three');
const { buildOsmPolygonBuildings } = await import('../public/js/osmBuilding.js');
const { sceneObjectMat } = await import('../public/js/toon.js');
const polygons = [
  { outer: [[0, 0], [24, 0], [24, 18], [0, 18]], holes: [] },
  { outer: [[0, 0], [24, 0], [24, 6], [6, 6], [6, 18], [0, 18]], holes: [] },
  { outer: [[0, 0], [24, 0], [24, 24], [0, 24]], holes: [[[8, 8], [16, 8], [16, 16], [8, 16]]] },
];
const areas = polygons.map((poly, i) => ({ sourceId: `test/${i}`, centroid: { x: 4, z: 4 }, tags: { building: 'house', height: '10' }, classification: { kind: 'house', generator: 'polygonBuilding' }, worldPolygons: [poly] }));
const terrain = { heightAt: () => 0 };
const base = buildOsmPolygonBuildings(new THREE.Group(), areas, { terrain });
const signatures = new Set();
for (const [id, row] of Object.entries(ARCHITECTURE_STYLES)) {
  const group = new THREE.Group();
  const result = buildOsmPolygonBuildings(group, areas, {
    terrain, architectureOf: () => ({ ...row, id, profile: 'plain', variant: 1 }),
    materialOf: () => ({ wall: sceneObjectMat(0xffffff, { vertexColors: true }), roof: sceneObjectMat(0xffffff, { vertexColors: true }) }),
  });
  assert.deepEqual(result.blockers, base.blockers);
  assert.deepEqual(result.platforms, base.platforms);
  assert.equal(result.architectureCounts[`plain:${id}`], 3);
  let vertices = 0;
  for (const mesh of group.children) {
    assert.ok(mesh.geometry);
    assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
    assert.equal(mesh.geometry.attributes.color.count, mesh.geometry.attributes.position.count);
    vertices += mesh.geometry.attributes.position.count;
  }
  signatures.add(vertices);
  assert.equal(group.children.length, 3, '文化混搭不增加每用途批次數');
}
assert.ok(signatures.size >= 6, '文化差異包含幾何，不能只有換色');
const farmland = { sourceId: 'land/1', tags: { landuse: 'farmland' }, worldPolygons: [polygons[0]] };
const planner = createArchitecturePlanner({ areas: [...areas, farmland], terrain, seed: 9 });
assert.equal(planner(areas[0], polygons[0]).profile, 'rural');
const reversed = createArchitecturePlanner({ areas: [farmland, ...areas].reverse(), terrain, seed: 9 });
assert.deepEqual(planner(areas[0], polygons[0]), reversed(areas[0], polygons[0]));
const slopePlanner = createArchitecturePlanner({ areas, terrain: { heightAt: x => x * 0.4 }, seed: 9 });
assert.equal(slopePlanner(areas[0], polygons[0]).profile, 'hillside');
console.log('通過：地形比例、每局變化、跨端確定性、八種實體建築、凹輪廓／中庭與碰撞不變');
