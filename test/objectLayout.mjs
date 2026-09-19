import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { boundaryGrid } from '../public/js/objectLayout.js';
import { edgeWallHM } from '../public/js/data.js';
import { readSrc, grabFn } from '../tools/audit_src.mjs';

for (const len of [12, 30, 180]) for (const depth of [4, 14, 18]) {
  const grid = boundaryGrid({ len, depth, bufferDepth: 32, pitchX: 18, pitchZ: 18 });
  assert.equal(grid.numCols * grid.colStep, len);
  assert(grid.unitW < grid.colStep);
  assert(grid.unitD < grid.rowStep);
  assert(grid.maxBufferRows * grid.rowStep <= 32);
}
for (const value of [NaN, Infinity, 0, -1]) assert.throws(() =>
  boundaryGrid({ len: value, depth: 10, pitchX: 10, pitchZ: 10 }), RangeError);

if (!process.env.THREE_MODULE) throw new Error('Set THREE_MODULE to the game Three.js module');
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){
  if(s==='three')return {url:${JSON.stringify(pathToFileURL(process.env.THREE_MODULE).href)},shortCircuit:true};
  return next(s,c);
}`), import.meta.url);
const THREE = await import('three');
const src = readSrc('test', 'architecturePreview.mjs');
const clickable = [];
let layout = 'scene';
const envelope = new Function('THREE', grabFn(src, 'addTransparentWallEnvelope') + ';return addTransparentWallEnvelope;')(THREE);
const arrange = new Function('THREE', 'boundaryGrid', 'edgeWallHM', 'boundaryLayoutOf', 'clickableObjects', 'addTransparentWallEnvelope',
  grabFn(src, 'withObjectLayout') + ';return withObjectLayout;')(THREE, boundaryGrid, edgeWallHM, () => layout, clickable, envelope);

for (const prefix of ['geo', 'plant', 'veh', 'vessel', 'industry', 'ice']) {
  layout = 'scene';
  const parent = new THREE.Group();
  const geometry = new THREE.BoxGeometry(4, 3, 2);
  const material = new THREE.MeshBasicMaterial();
  const model = new THREE.Mesh(geometry, material);
  parent.add(model);
  const physical = { name: 'selected-model', length: 4, width: 2, height: 3 };
  const result = { model, meta: { seed: 42 }, vehicle: physical };
  assert.equal(arrange(result, prefix).model, model, 'scene model remains unchanged');
  layout = 'boundary';
  const out = arrange(result, prefix);
  assert.equal(out.vehicle, physical, 'layout must not overwrite physical specifications');
  assert.equal(parent.children[0], out.model);
  const bodies = out.model.children.filter(o => o.geometry === geometry);
  assert.equal(bodies.length, 6, 'three columns plus one buffer row');
  assert(bodies.every(o => o.material === material), 'layout shares original model resources');
  assert.deepEqual(out.model.userData.objectLayout.sourceSize, [4, 3, 2]);
  assert.equal(out.model.userData.objectLayout.seed, 42);
  const walls = out.model.children.filter(o => o.material?.transparent && o.isMesh);
  assert.equal(walls.length, 1, 'one transparent continuous wall');
  assert(walls[0].geometry.parameters.height >= edgeWallHM());
  assert(walls[0].geometry.parameters.width >= out.layoutSize[0]);
  geometry.dispose(); material.dispose();
}
console.log('PASS: shared boundary grid; six categories preserve source models, seeds and physical specifications.');
