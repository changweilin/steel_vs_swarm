import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readSrc } from '../tools/audit_src.mjs';
import { mulberry32 } from '../public/js/rng.js';
import { VESSEL_TYPES, VESSEL_AXES, generateVessel, vesselFitsAt } from '../public/js/vesselCatalog.js';
import { VESSEL_DESIGNS, VESSEL_EQUIPMENT } from '../public/js/vesselLayout.js';

assert.deepEqual(Object.keys(VESSEL_DESIGNS).sort(),VESSEL_TYPES.map(t=>t.id).sort());
const overlaps=(a,b)=>Math.abs(a.x-b.x)<(a.w+b.w)/2-1e-6 && Math.abs(a.z-b.z)<(a.d+b.d)/2-1e-6;
const observedKinds=new Set(),loadVariants=new Set();

for (const t of VESSEL_TYPES) for(let seed=0;seed<100;seed++) {
  const v=generateVessel(seed,{id:t.id});
  assert.deepEqual(v,generateVessel(seed,{id:t.id}));
  assert.ok(v.length>=t.length[0] && v.length<=t.length[1]);
  assert.ok(v.age>=t.age[0] && v.age<=t.age[1]);
  assert.ok(t.power.includes(v.power));
  assert.ok(v.displacementTonnes>0 && v.draft>0);
  assert.ok(v.displacementTonnes>=t.displacementRange[0] && v.displacementTonnes<=t.displacementRange[1]);
  assert.ok(v.wear>=0 && v.wear<=0.85);
  const es=v.layout.equipment;
  for(const item of es) {
    observedKinds.add(item.kind);
    assert.equal(item.category,VESSEL_EQUIPMENT[item.kind].category);
    assert.ok([item.x,item.y,item.z,item.w,item.h,item.d].every(Number.isFinite));
    const zone=v.layout.zones.find(z=>z.name===item.zone);
    assert.ok(Math.abs(item.x-zone.x)+item.w/2<=zone.w/2+1e-6);
    assert.ok(Math.abs(item.z-zone.z)+item.d/2<=zone.d/2+1e-6);
    assert.ok(zone.kinds.includes(item.kind));
    for(const c of v.layout.reserved) {
      if(c.name!=='cabin'||item.y<c.y+c.h-1e-6)assert.ok(!overlaps(item,c),t.id+': '+item.zone+' overlaps '+c.name);
    }
    if(item.tier>0)assert.ok(es.some(b=>b.zone===item.zone&&b.x===item.x&&b.z===item.z&&b.tier===item.tier-1&&Math.abs(b.y+b.h-item.y)<1e-6),'stack support');
  }
  for(let i=0;i<es.length;i++)for(let j=i+1;j<es.length;j++){
    const a=es[i],b=es[j];assert.ok(!(overlaps(a,b)&&a.y<b.y+b.h-1e-6&&b.y<a.y+a.h-1e-6),t.id+': overlapping load cells');
  }
  if(t.id==='destroyer')loadVariants.add(JSON.stringify(es.map(e=>[e.kind,e.units])));
}
assert.ok(loadVariants.size>50,'weapons and quantities vary with seed');
assert.deepEqual([...observedKinds].sort(),Object.keys(VESSEL_EQUIPMENT).sort(),'all equipment reachable');
for (const key of Object.keys(VESSEL_AXES.purpose)) assert.ok(generateVessel(5,{purpose:key}));
for (const key of Object.keys(VESSEL_AXES.waters)) assert.ok(generateVessel(5,{water:key}));
for (const key of Object.keys(VESSEL_AXES.power)) assert.ok(generateVessel(5,{power:key}));
assert.equal(generateVessel(5,{purpose:'sport',power:'nuclear'}),null);
assert.equal(generateVessel(5,{id:'submarine',surface:true}),null);
assert.equal(generateVessel(5,{id:'towboat',selfPropelled:true}),null);
assert.throws(()=>generateVessel(NaN),TypeError);
const v=generateVessel(1,{id:'trawler'});
const terrain={minX:-500,maxX:500,minZ:-500,maxZ:500,waterY:0,heightAt:()=>-30};
assert.ok(vesselFitsAt(v,terrain,0,0,()=>true));
assert.equal(vesselFitsAt(v,terrain,499,0,()=>true),false);
assert.equal(vesselFitsAt(v,{...terrain,heightAt:()=>-0.1},0,0,()=>true),false);
assert.equal(vesselFitsAt(v,terrain,0,0,x=>x<1),false);
assert.equal(vesselFitsAt(v,{...terrain,heightAt:()=>NaN},0,0,()=>true),false);
console.log('PASS: '+VESSEL_TYPES.length*100+' deterministic profiles; compatible loadouts, supported stacks, cabin/runway/helipad clearance');

if (!process.env.THREE_MODULE) throw Error('Set THREE_MODULE to the game Three.js 0.160 module for geometry tests');
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,next){if(s==='three')return {url:${JSON.stringify(pathToFileURL(process.env.THREE_MODULE).href)},shortCircuit:true};return next(s,c);}`),import.meta.url);
const THREE=await import('three');
const { buildGeneratedVesselMesh }=await import('../public/js/vesselModels.js');
const { disposeTree }=await import('../public/js/toon.js');
for(const t of VESSEL_TYPES) for(const seed of [1,42,150]) {
  const v=generateVessel(seed,{id:t.id});
  const mesh=buildGeneratedVesselMesh(v,{wake:false});
  assert.equal(mesh.userData.vessel,v);
  const bounds=new THREE.Box3().setFromObject(mesh),size=bounds.getSize(new THREE.Vector3());
  assert.ok([size.x,size.y,size.z].every(n=>Number.isFinite(n)&&n>0),t.id);
  assert.ok(size.z>=v.length*0.99 && size.z<=v.length*1.1,t.id);
  for(const child of mesh.children) {
    const e=child.userData.equipment;if(!e)continue;
    const b=new THREE.Box3().setFromObject(child),eps=1e-4;
    assert.ok(b.min.x>=e.x-e.w/2-eps&&b.max.x<=e.x+e.w/2+eps,e.kind+': rendered width exceeds slot');
    assert.ok(b.min.z>=e.z-e.d/2-eps&&b.max.z<=e.z+e.d/2+eps,e.kind+': rendered length exceeds slot');
    assert.ok(b.min.y>=e.y-eps&&b.max.y<=e.y+e.h+eps,e.kind+': rendered height exceeds slot');
  }
  if(['kayak','canoe','inflatable','rowboat'].includes(t.id)) {
    assert.equal(v.layout.cabins.length,0);
    assert.equal(mesh.getObjectByName('paint_wear'),undefined,'small non-steel hulls never rust');
  }
  if(t.id==='inflatable')assert.ok(mesh.getObjectByName('inflatable_tube'));
  if(t.id==='kayak')assert.ok(mesh.getObjectByName('cockpit_coaming'));
  if(t.id==='tanker')assert.equal(mesh.getObjectByName('moss_tank'),undefined);
  let triangles=0,disposed=0,meshes=0;
  mesh.traverse(o=>{
    if(!o.isMesh)return;
    meshes++;o.geometry.addEventListener('dispose',()=>disposed++);
    const pos=o.geometry.attributes.position;
    assert.ok([...pos.array].every(Number.isFinite),t.id);
    if(o.name.startsWith('raked_')||o.name==='sealed_deck') {
      o.geometry.computeBoundingBox();
      const center=o.geometry.boundingBox.getCenter(new THREE.Vector3()),normal=o.geometry.attributes.normal;
      for(let j=0;j<pos.count;j+=3) {
        const faceCenter=new THREE.Vector3();
        for(let k=0;k<3;k++)faceCenter.add(new THREE.Vector3().fromBufferAttribute(pos,j+k));
        faceCenter.multiplyScalar(1/3).sub(center);
        assert.ok(faceCenter.dot(new THREE.Vector3().fromBufferAttribute(normal,j))>=-1e-5,t.id+': inward-facing '+o.name);
      }
    }
    triangles+=(o.geometry.index?.count??pos.count)/3;
  });
  assert.ok(triangles<10000,`${t.id}: geometry budget`);
  disposeTree(mesh);assert.equal(disposed,meshes);
  const underway=buildGeneratedVesselMesh(v);
  assert.equal(Boolean(underway.userData.wake),!v.parts.includes('sub'));
  disposeTree(underway);
}
console.log('PASS: '+VESSEL_TYPES.length*3+' real Three.js models; equipment fits slots, distinct hulls, geometry budgets, wakes and disposal');

// Execute the shipped deployment function against a controlled depth field;
// only the terrain environment probe is injected instead of loading all biomes.
const source=readSrc('public','js','aquatics.js');
const start=source.indexOf('export function createSurfaceVessels(');
const end=source.indexOf('/** 建造現代巡邏艇幾何群 */',start);
assert.ok(start>=0 && end>start);
const create=new Function('THREE','mulberry32','generateVessel','vesselFitsAt','buildGeneratedVesselMesh','disposeTree','terrainEnvCode','AQUATIC',
  source.slice(start,end).replace('export function','function')+';return createSurfaceVessels;')(
    THREE,mulberry32,generateVessel,vesselFitsAt,buildGeneratedVesselMesh,disposeTree,()=>1,
    {SHIP_CRUISE_SPD:3,BOAT_BOB_AMP:0.05,BOAT_BOB_FREQ:1});
assert.equal(create({...terrain,waterY:NaN},1),null);
const dry=create({...terrain,heightAt:()=>1},8);
assert.equal(dry.group.children.length,0);dry.dispose();
const system=create(terrain,8), repeat=create(terrain,8);
assert.ok(system.group.children.length>0);
assert.deepEqual(system.group.children.map(m=>[m.name,m.position.toArray()]),repeat.group.children.map(m=>[m.name,m.position.toArray()]));
for(let i=0;i<100;i++)system.step(0.5,i*0.5);
for(const mesh of system.group.children) {
  assert.ok(mesh.position.toArray().every(Number.isFinite));
  assert.ok(Math.abs(mesh.position.x)<500 && Math.abs(mesh.position.z)<500);
}
const frozen=system.group.children.map(m=>m.position.toArray());
system.step(10,100,true);
assert.deepEqual(system.group.children.map(m=>m.position.toArray()),frozen);
system.dispose();repeat.dispose();
console.log('PASS: production deployment, dry omission, deterministic placement, movement and freeze');
