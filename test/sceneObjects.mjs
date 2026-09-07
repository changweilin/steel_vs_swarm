// THREE_MODULE 指向遊戲相同版本的 three.module.js；不新增 npm 依賴。
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

if (process.env.THREE_MODULE) {
  register('data:text/javascript,' + encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      if (specifier === 'three') return { url: ${JSON.stringify(pathToFileURL(process.env.THREE_MODULE).href)}, shortCircuit: true };
      return next(specifier, context);
    }
  `), import.meta.url);
}
const THREE = await import('three');
const { deploySceneObjects, deploySceneBatches } = await import('../public/js/sceneObjects.js');
const { makeRuntimePartModel } = await import('../public/js/runtimePartModel.js');
const { generatedApprovedVehicleModelAt } = await import('../public/js/approvedVehicleModels.js');
const { BUILDING_PARTS } = await import('../public/js/runtimeParts.js');
const { makeApprovedBuildingBatch } = await import('../public/js/approvedBuildingModels.js');

const geometry = new THREE.BoxGeometry();
const material = new THREE.MeshBasicMaterial();
let compiled = 0;
const rows = Array.from({ length: 2000 }, (_, i) => ({ x: i, variant: i % 4 }));
const build = (entry, placements) => deploySceneObjects(placements, {
  variantOf: row => row.variant,
  geometryOf: () => { compiled++; return geometry; },
  material,
  matrixOf: (row, matrix) => matrix.makeTranslation(row.x, 2, 3),
  name: '測試實體', metadata: { key: entry.key },
});
const target = new THREE.Group();
let yields = 0;
const stats = await deploySceneBatches([{ entry: { key: 'test' }, rows }], target, build, async () => { yields++; });
assert.equal(compiled, 4);
assert.equal(target.children.length, 4);
assert.equal(stats.objects, 2000);
assert.equal(yields, 1);
const matrix = new THREE.Matrix4();
target.children.forEach((mesh, variant) => {
  assert.ok(mesh.isInstancedMesh);
  assert.equal(mesh.count, 500);
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    assert.deepEqual(matrix.elements.slice(12, 15), [i * 4 + variant, 2, 3]);
  }
});
assert.throws(() => build({ key: 'bad' }, [{ x: NaN, variant: 0 }]), /變換無效/);

// 逐款建物都走正式建構器；多配色批次必須能被直接子節點淨空邏輯找到。
const buildingTarget = new THREE.Group();
const buildingRows = rows.slice(0, 100).map(row => ({ x: row.x, y: 5, z: -row.x, ry: 0.7, w: 8, h: 10, d: 6 }));
await deploySceneBatches(BUILDING_PARTS.map(entry => ({ entry, rows: buildingRows })), buildingTarget, makeApprovedBuildingBatch);
assert.ok(buildingTarget.children.every(mesh => mesh.isInstancedMesh));
assert.equal(buildingTarget.children.reduce((sum, mesh) => sum + mesh.count, 0), BUILDING_PARTS.length * buildingRows.length);
for (const mesh of buildingTarget.children) {
  mesh.getMatrixAt(0, matrix);
  assert.equal(matrix.elements[13], 0);
  assert.equal(mesh.material.userData.celOpts.wash, 0);
  assert.equal(mesh.material.userData.celOpts.bands, 3);
}

const entry = generatedApprovedVehicleModelAt(1);
const coldAt = performance.now();
const first = makeRuntimePartModel(entry);
const coldMs = performance.now() - coldAt;
const warmAt = performance.now();
const second = makeRuntimePartModel(entry);
const warmMs = performance.now() - warmAt;
assert.deepEqual(first.geometry.attributes.position.array, second.geometry.attributes.position.array);
assert.notEqual(first.geometry, second.geometry);
assert.notEqual(first.geometry.attributes.position.array, second.geometry.attributes.position.array);
first.geometry.attributes.position.array[0] = 999999;
first.geometry.dispose();
const third = makeRuntimePartModel(entry);
assert.deepEqual(second.geometry.attributes.position.array, third.geometry.attributes.position.array);
// 可編輯物件不能因同一個 entry 參考而看見舊模型。
const mutable = { key: 'edit', parts: [{ type: 'box', dimensions: [1, 1, 1], color: 0xffffff }] };
const before = makeRuntimePartModel(mutable);
mutable.parts[0].dimensions[0] = 3;
const after = makeRuntimePartModel(mutable);
assert.notDeepEqual(before.geometry.attributes.position.array, after.geometry.attributes.position.array);
console.log(JSON.stringify({ objects: stats.objects, batches: target.children.length, buildings: BUILDING_PARTS.length, coldMs, warmMs }));
console.log('通過：實例矩陣、配色批次、淨空可見性、正式建物、快取隔離與編輯刷新');
