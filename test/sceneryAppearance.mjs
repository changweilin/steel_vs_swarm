// Authored topology, circular scatter envelopes, anisotropic normals and deployed civilian budgets.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { SCENERY_MESHES } from '../public/js/sceneryMeshData.js';
import { sceneryMeshData, sceneryBoxData } from '../public/js/sceneryAppearance.js';
import { readSrc, grabFn } from '../tools/audit_src.mjs';

assert(process.env.THREE_MODULE, 'Set THREE_MODULE to the game Three.js module');
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){if(s==='three')return{url:${JSON.stringify(pathToFileURL(process.env.THREE_MODULE).href)},shortCircuit:true};return next(s,c);}`), import.meta.url);
const THREE = await import('three');
const { runtimePrimitiveGeometry, runtimeMeshDataGeometry } = await import('../public/js/runtimePartModel.js');
const { sceneryBoxGeometry } = await import('../public/js/sceneryGeometry.js');
const { buildNpcModel } = await import('../public/js/npcModels.js');
const { disposeTree } = await import('../public/js/toon.js');

for (const [name, data] of Object.entries(SCENERY_MESHES)) {
  const edges = new Map(); let volume = 0;
  const vertex = index => new THREE.Vector3(...data.vertices.slice(index * 3, index * 3 + 3));
  assert(data.vertices.every(n => Number.isFinite(n) && Math.abs(n) <= .500001), name + ': envelope');
  for (let i = 0; i < data.faces.length; i += 3) {
    const face = data.faces.slice(i, i + 3), [a,b,c] = face.map(vertex);
    assert(new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).length() > 1e-9, name + ': degenerate face');
    volume += a.dot(new THREE.Vector3().crossVectors(b,c)) / 6;
    for (let j = 0; j < 3; j++) {
      const key = [face[j], face[(j+1)%3]].sort((x,y) => x-y).join('/');
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  assert(volume > 0, name + ': outward winding');
  assert([...edges.values()].every(n => n === 2), name + ': closed surface');
  if (['stone','crown','mushroomCap'].includes(name)) for (let i = 0; i < data.vertices.length; i += 3)
    assert(Math.hypot(data.vertices[i], data.vertices[i+2]) <= .500001, name + ': circular scatter envelope');
  const scaled = sceneryMeshData(name, [3.7, .13, .9]);
  for (let i = 0; i < scaled.normals.length; i += 3)
    assert(Math.abs(Math.hypot(...scaled.normals.slice(i,i+3))-1) < 1e-9, name + ': unit normal');
}
for (const size of [[1,1,1],[24,.035,.16],[.05,12,.05],[4.8,2.1,2.7]]) {
  const data = sceneryBoxData(size);
  const geometry = runtimePrimitiveGeometry({type:'box',dimensions:size});
  geometry.computeBoundingBox();
  for (let axis = 0; axis < 3; axis++) {
    assert(Math.abs(geometry.boundingBox.min.getComponent(axis)+size[axis]/2)<1e-6);
    assert(Math.abs(geometry.boundingBox.max.getComponent(axis)-size[axis]/2)<1e-6);
  }
  assert(data.normals.every(Number.isFinite)); geometry.dispose();
}
let maximumTriangles = 0;
const source = readSrc('public', 'js', 'biomes.js');
const emit = new Function('THREE','runtimeMeshDataGeometry','sceneryBoxGeometry','_wm','_wq','_we','_wp','_ws','_wg',
  grabFn(source, 'wallGeo') + '\n' + grabFn(source, 'emitWallParts') + '\nreturn emitWallParts;')(
  THREE, runtimeMeshDataGeometry, sceneryBoxGeometry, new THREE.Matrix4(), new THREE.Quaternion(),
  new THREE.Euler(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3());
const fixtures = [
  {g:['box',2.4,.12,1.3],p:[1,2,-3],r:[.2,.7,.1],c:0x556677},
  {g:['box',.2,1.8,.3],p:[-2,.9,1],mat:'glass',c:0x88aabb},
];
const batches = [false,true].map(surfaces => {
  const batch = {opaque:{geos:[],cols:[]},glass:{geos:[],cols:[]}};
  emit(batch, fixtures, 12, 4, -7, .35, 1.2, null, surfaces);
  return batch;
});
for (const key of ['opaque','glass']) {
  const original = batches[0][key].geos[0], authored = batches[1][key].geos[0];
  original.computeBoundingBox(); authored.computeBoundingBox();
  const outer = original.boundingBox.clone().expandByScalar(1e-6);
  assert(outer.containsBox(authored.boundingBox), 'Scatter surface exceeds the original collision envelope');
  assert.equal(original.index.count, 36, 'Boundary boxes retain their original surface');
  assert(authored.index.count > original.index.count, 'Scattered objects receive the authored chamfer');
  assert.deepEqual(batches[0][key].cols, batches[1][key].cols);
  original.dispose(); authored.dispose();
}
for (let seed = 1; seed <= 192; seed++) {
  const group = buildNpcModel('civ', seed % 2 ? 'STEEL' : 'SWARM', {profile:seed%20, appearanceSeed:seed});
  let triangles = 0;
  group.traverse(node => {
    if (!node.isMesh) return;
    triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
    for (const attribute of Object.values(node.geometry.attributes)) assert([...attribute.array].every(Number.isFinite));
  });
  assert(triangles <= 3500, 'Civilian triangle budget: '+seed+'/'+triangles);
  maximumTriangles = Math.max(maximumTriangles, triangles);
  assert.equal(group.userData.rig.gunArm, undefined);
  disposeTree(group);
}
console.log(JSON.stringify({surfaces:Object.keys(SCENERY_MESHES).length,civilians:192,maximumTriangles}));
