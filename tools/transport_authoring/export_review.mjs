import { writeFileSync } from 'node:fs';
import { register } from 'node:module';
const three=new URL('../../out/forest_review/three.module.js',import.meta.url).href;
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,next){if(s==='three')return{url:${JSON.stringify(three)},shortCircuit:true};return next(s,c);}`),import.meta.url);
const THREE=await import('three');
const {vehicleBackgroundObject}=await import('../../public/js/vehicleCatalog.js');
const {mergeRuntimeParts}=await import('../../public/js/runtimePartModel.js');
const {generateVessel}=await import('../../public/js/vesselCatalog.js');
const {buildGeneratedVesselMesh}=await import('../../public/js/vesselModels.js');
const {disposeTree}=await import('../../public/js/toon.js');
const models=[];
function record(root,key) {
  root.updateMatrixWorld(true);
  const parts=[];
  root.traverse(o=>{
    if(!o.isMesh)return;
    const geo=o.geometry.clone().applyMatrix4(o.matrixWorld),position=geo.attributes.position,color=geo.attributes.color;
    parts.push({vertices:Array.from(position.array),faces:geo.index?Array.from(geo.index.array):Array.from({length:position.count},(_,i)=>i),
      colors:color?Array.from(color.array):null,color:o.material.color?.toArray()||[.5,.5,.5]});
    geo.dispose();
  });
  models.push({key,parts});disposeTree(root);
}
for(const key of ['compactSedan','hatchback','sportsCar','familySUV','cargoVan','militaryPickup','truck','dieselLocomotive']) {
  const entry=vehicleBackgroundObject(key,42);
  record(new THREE.Mesh(mergeRuntimeParts(entry.parts),new THREE.MeshBasicMaterial({vertexColors:true})),key);
}
for(const key of ['skiff','patrol','yacht','trawler'])record(buildGeneratedVesselMesh(generateVessel(42,{id:key}),{wake:false}),key);
writeFileSync(new URL('../../out/transport_review/review.json',import.meta.url),JSON.stringify({models}));
console.log(`${models.length} production models exported for Blender review`);
