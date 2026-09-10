import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { ANCIENT_RUINS, ANCIENT_MONUMENTS } from '../public/js/ancientStone.js';
import { generateHeritageSite, heritageStateOf, heritageRuinType, LEGACY_HERITAGE } from '../public/js/heritageSites.js';
import { generateGeology } from '../public/js/geology.js';
import { mulberry32 } from '../public/js/rng.js';

assert.equal(heritageStateOf({tourism:'attraction'}),'tourism');
assert.equal(heritageStateOf({access:'private'}),'abandoned');
assert.equal(heritageStateOf({location:'underwater',access:'no'}),'underwater');
assert.equal(heritageRuinType({archaeological_site:'settlement'}),'village');
assert.equal(heritageRuinType({archaeological_site:'unknown'}),'auto');
assert.throws(()=>generateHeritageSite(1,{state:'broken'}));
let count=0;
for(const id of Object.keys(ANCIENT_RUINS)) for(const state of ['tourism','abandoned','underwater']) {
  const input={ruinType:id,state};
  const result=generateHeritageSite(41,input);
  assert.deepEqual(result,generateHeritageSite(41,input));
  assert.equal(result.selection.id,id);
  assert.equal(result.facilities,state==='tourism');
  assert.ok(result.triangles.length>0);
  assert.ok(result.bounds.size.every(v=>Number.isFinite(v)&&v>0));
  count++;
}
for(const [id,row] of Object.entries(ANCIENT_MONUMENTS)) {
  const selection={id,kind:'monument',uniformScale:1,...row};
  const model=generateHeritageSite(8,{selection,state:'tourism'});
  assert.equal(model.selection.id,id);
  assert.equal(model.facilities,true);
  count++;
}
for(const state of ['tourism','abandoned','underwater']) {
  const model=generateGeology('ruins',12,{ruinType:'temple',heritageState:state});
  assert.equal(model.stoneGeometry.state,state);
}
const modules={three:new URL('../out/forest_review/three.module.js',import.meta.url).href};
register('data:text/javascript,'+encodeURIComponent(`const m=${JSON.stringify(modules)};export async function resolve(s,c,next){return m[s]?{url:m[s],shortCircuit:true}:next(s,c)}`),import.meta.url);
const THREE=await import('three');
const {buildHeritageSite}=await import('../public/js/heritageSiteMesh.js');
const source=readFileSync(new URL('../public/js/aquatics.js',import.meta.url),'utf8');
const wrappers=[...source.matchAll(/export function (\w+)\(group, x, y, z, rnd, opts = \{\}\) \{\s+return buildHeritageSite\('([^']+)'/g)];
assert.equal(wrappers.length,Object.keys(LEGACY_HERITAGE).length,'all legacy ancient entry points must use shared generator');
for(const kind of Object.keys(LEGACY_HERITAGE)) for(const state of ['tourism','abandoned','underwater']) {
  const parent=new THREE.Group();
  const group=buildHeritageSite(kind,parent,8,-10,4,{state,seed:31,radius:8,maxHeight:2.5});
  assert.equal(parent.children.length,1);assert.equal(group.children.length,1,'one merged mesh');
  const geometry=group.children[0].geometry;
  assert.ok(geometry.attributes.position.array.every(Number.isFinite));
  const box=geometry.boundingBox,size=box.getSize(new THREE.Vector3());
  assert.ok(Math.hypot(size.x,size.z)/2<=8.0001);
  assert.ok(size.y<=2.5001);
  assert.ok(Math.abs(box.min.y)<1e-6,'base rests on sampled floor');
  assert.equal(group.userData.heritage.facilities,state==='tourism');
  geometry.dispose();group.children[0].material.dispose();
}
const start=source.indexOf('export function buildSunkenRelics(');
const end=source.indexOf('/** 1. 建造水下潛艦',start);
const placement=new Function('AQUATIC','mulberry32','terrainEnvCode','RELIC_KINDS','buildRelicObject','relicCollider','extractWaterlineSlices','heritageRuinType',
  `return ${source.slice(start,end).replace('export ','')}`)(
    {MAX_UNDERWATER_PROPS:1},mulberry32,()=>1,{ruins:{underwater:true,colR:11}},
    (kind,parent,x,y,z,_rnd,opts)=>buildHeritageSite(kind,parent,x,y,z,{radius:11,...opts}),()=>null,()=>[],heritageRuinType);
const waterParent=new THREE.Group();
placement(waterParent,{waterY:0,minX:-50,maxX:50,minZ:-50,maxZ:50,heightAt:()=>-4},19,[],[
  {x:7,z:8,tags:{archaeological_site:'temple'}}]);
assert.equal(waterParent.children.length,1);
assert.equal(waterParent.children[0].position.x,7,'mapped site precedes random fill');
assert.equal(waterParent.children[0].userData.heritage.id,'temple');
const worldBox=new THREE.Box3().setFromObject(waterParent);
assert.ok(worldBox.max.y<=-.2999,'mapped site stays below water');
console.log(`PASS: ${count} canonical/state combinations, geology integration, 11 legacy adapters, mapped underwater priority and bounded deterministic meshes`);
