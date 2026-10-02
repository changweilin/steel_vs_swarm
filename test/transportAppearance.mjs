import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { VEHICLE_PROFILES, vehicleBackgroundObject, makeSceneVehicleParts } from '../public/js/vehicleCatalog.js';
import { VEHICLE_MESH_RECIPES } from '../public/js/transportMeshData.js';

if(!process.env.THREE_MODULE)throw new Error('Set THREE_MODULE to the game Three.js module');
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,next){if(s==='three')return{url:${JSON.stringify(pathToFileURL(process.env.THREE_MODULE).href)},shortCircuit:true};return next(s,c);}`),import.meta.url);
const THREE=await import('three');
const { runtimePrimitiveGeometry }=await import('../public/js/runtimePartModel.js');
let windshields=0,maximumTriangles=0;
const material=new THREE.MeshBasicMaterial();
function meshOf(p) {
  const mesh=new THREE.Mesh(runtimePrimitiveGeometry(p),material);
  mesh.position.fromArray(p.position);mesh.rotation.fromArray([...p.rotation,'XYZ']);mesh.updateMatrixWorld(true);
  return mesh;
}
for(const key of Object.keys(VEHICLE_PROFILES))for(const seed of [0,42,-9]) {
  const entry=vehicleBackgroundObject(key,seed),source=vehicleBackgroundObject(key,seed,{sourceGeometry:true});
  assert.deepEqual(entry.generation,source.generation,'Appearance must not change sampled state');
  assert.deepEqual(entry.plates,source.plates,'Appearance must not move plate text away from its backing');
  assert.equal(entry.parts.length,source.parts.length,'Surface edits must not create per-detail draw objects');
  if(VEHICLE_MESH_RECIPES[key])assert.ok(entry.parts.some(p=>p.type==='mesh'));
  let triangles=0;
  for(const p of entry.parts) {
    const geo=runtimePrimitiveGeometry(p);
    const position=geo.attributes.position,normal=geo.attributes.normal;
    assert.ok([...position.array,...normal.array].every(Number.isFinite),key);
    triangles+=(geo.index?.count??position.count)/3;
    geo.dispose();
  }
  maximumTriangles=Math.max(maximumTriangles,triangles);
  assert.ok(triangles<10000,`${key}: geometry budget ${triangles}`);
  const cab=entry.parts.find(p=>p.name==='cab');
  if(cab?.type==='mesh') {
    const glass=entry.parts.find(p=>p.name==='front_windshield');
    const bodyMesh=meshOf(cab),glassMesh=meshOf(glass);
    const ray=new THREE.Raycaster(new THREE.Vector3(entry.generation.length*2,glass.position[1],glass.position[2]),new THREE.Vector3(-1,0,0));
    const bodyHit=ray.intersectObject(bodyMesh)[0],glassHit=ray.intersectObject(glassMesh)[0];
    assert.ok(bodyHit&&glassHit&&glassHit.distance<bodyHit.distance,`${key}: windshield occluded by cabin`);
    bodyMesh.geometry.dispose();glassMesh.geometry.dispose();windshields++;
  }
}
for(const crush of [1,.65,.2]) {
  const parts=makeSceneVehicleParts('sedan',{fit:{L:5,W:2,H:3},crush});
  for(const p of parts.filter(p=>p.g[0]==='mesh')) {
    assert.ok([...p.g[1].vertices,...p.g[1].normals].every(Number.isFinite));
  }
}
material.dispose();
const { buildHazard }=await import('../public/js/hazards.js');
const { buildCivic, civicExtent }=await import('../public/js/siteplan.js');
const { disposeTree }=await import('../public/js/toon.js');
assert.ok(Number.isFinite(civicExtent('lot')));
for(const kind of ['wreck','car','lot'])for(const seed of [0,42]) {
  const root=kind==='lot'?buildCivic(kind,seed):buildHazard(kind,seed,8);
  let meshes=0;
  root.traverse(o=>{
    if(!o.isMesh)return;
    meshes++;
    for(const attr of Object.values(o.geometry.attributes))assert.ok([...attr.array].every(Number.isFinite),`${kind}: deployment geometry`);
  });
  assert.ok(meshes>0);
  disposeTree(root);
}
console.log(`PASS: 384 appearance replays, ${windshields} visible raked windshields, ${maximumTriangles} max triangles, finite crushed meshes`);
