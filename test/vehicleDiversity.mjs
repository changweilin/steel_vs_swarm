import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { makeSceneVehicleParts } from '../public/js/vehicleParts.js';
import { makeVehicle as collisionContract, partsAABB } from '../public/js/vehicles.js';
import { VEHICLE_AXES, VEHICLE_PROFILES, VEHICLE_PART_NAMES, generateVehicle, vehicleBackgroundObject, vehicleCandidates } from '../public/js/vehicleCatalog.js';
import { sharedBackgroundObjectTargets, generateSharedBackgroundObject } from '../public/js/backgroundObjects.js';
import { VEHICLE_CONSISTS, vehicleConsistBackgroundObject,CONSIST_PREFIX } from '../public/js/vehicleConsists.js';

const keys = Object.keys(VEHICLE_PROFILES);
assert.equal(sharedBackgroundObjectTargets('vehicle').length,keys.length+Object.keys(VEHICLE_CONSISTS).length);
const catalogSource=await readFile(new URL('../public/js/vehicleCatalog.js',import.meta.url),'utf8');
assert.ok(!/makeVehicle\s*\(|approvedVehicle|RUNTIME_PARTS/.test(catalogSource),'新車模不可借用舊幾何');
for(const kind of ['sedan','truck','railcar']) {
  const opts={fit:{L:5,W:2,H:3},col:1,vc:3,at:[12,2,-7],ry:Math.PI/3};
  const fresh=makeSceneVehicleParts(kind,opts);
  const colliders=fresh.filter(p=>p.col).map(({collisionOnly,...p})=>p);
  assert.deepEqual(colliders,collisionContract(kind,opts).filter(p=>p.col),'權威碰撞契約不變');
  assert.ok(fresh.filter(p=>!p.collisionOnly).every(p=>!p.col));
  const bounds=partsAABB(makeSceneVehicleParts(kind,{fit:opts.fit}));
  assert.ok(bounds.x0>=-2.50001 && bounds.x1<=2.50001 && bounds.y0>=-1e-6 && bounds.y1<=3.00001 && bounds.z0>=-1.00001 && bounds.z1<=1.00001);
}
assert.deepEqual(vehicleCandidates({power:'steam',type:'twoWheel'}), []);
assert.deepEqual(vehicleCandidates({power:'animal'}), ['carriage']);
assert.throws(()=>generateVehicle('sedan',1,{power:'steam'}), /不相容/);
assert.throws(()=>generateVehicle('unknown',1), /未知/);
assert.throws(()=>generateVehicle('sedan',NaN), /seed/);
assert.throws(()=>vehicleCandidates({purpose:'unknown'}), /未知/);
for(const [axis,values] of Object.entries(VEHICLE_AXES)) for(const key of Object.keys(values)) assert.ok(vehicleCandidates({[axis]:key}).length,`${axis}:${key}`);
let samples = 0;
for(const key of keys) {
  const spec=VEHICLE_PROFILES[key];
  assert.ok(spec.parts.every(part=>VEHICLE_PART_NAMES[part]));
  assert.ok(sharedBackgroundObjectTargets('vehicle').includes('vehicle/'+key));
  for(const power of spec.powers) for(const seed of [0,1,42,88,-9,2147483647]) {
    const model=vehicleBackgroundObject(key,seed,{power}), v=model.generation;
    assert.deepEqual(model,generateSharedBackgroundObject('vehicle/'+key,seed,{power}));
    assert.ok(v.age>=spec.age[0] && v.age<=spec.age[1]);
    assert.ok(v.length>=spec.length[0] && v.length<=spec.length[1]);
    assert.ok(v.wear>=0 && v.wear<=.85);
    assert.ok(model.parts.length<160);
    assert.ok(model.bounds.min[1]>=-1e-8,`${key}: below ground`);
    assert.ok(Math.abs(model.bounds.min[1])<1e-8,`${key}: floating`);
    for(const p of model.parts) {
      assert.ok(p.position.every(Number.isFinite) && p.rotation.every(Number.isFinite));
      if(p.dimensions) assert.ok(p.dimensions.every(n=>Number.isFinite(n)&&n>0));
    }
    const exhaust=model.parts.some(p=>p.name==='exhaust');
    assert.equal(exhaust,['diesel','petrol','hybrid'].includes(power));
    if(['military','rescue','sport'].includes(v.purpose)) assert.equal(v.graffiti,'');
    samples++;
  }
  const appearances=new Set(Array.from({length:32},(_,seed)=>JSON.stringify(generateVehicle(key,seed))));
  assert.equal(appearances.size,32);
}
console.log(`${keys.length} 車型 / ${samples} 動力與種子組合：相容性、接地、有限幾何、重現性通過`);
for(const [key,recipe] of Object.entries(VEHICLE_CONSISTS))for(const count of [...new Set(recipe.count)])for(const leader of recipe.leaders){
  const opts={wagonCount:count,leaderKey:leader};
  const entry=vehicleConsistBackgroundObject(key,42,opts);
  assert.deepEqual(entry,generateSharedBackgroundObject(CONSIST_PREFIX+key,42,opts));
  assert.equal(entry.generation.members.length,count+1);
  assert.ok(entry.parts.length<1000);
  for(const member of entry.generation.members.slice(1))assert.equal(member.power,'towed');
  const members=entry.generation.members;
  for(let i=1;i<members.length;i++){
    const prev=members[i-1], next=members[i];
    const rear=prev.offset-prev.length*(recipe.mode==='rail'?.49:.23);
    const front=next.offset+next.length*(recipe.mode==='rail'?.49:.36);
    assert.ok(Math.abs(rear-front)<1e-8,'聯結點須重合');
    assert.equal(prev.coupling.height,next.coupling.height);
    if(recipe.mode==='rail')assert.equal(prev.coupling.gauge,next.coupling.gauge);
  }
}
assert.throws(()=>vehicleConsistBackgroundObject('fuelSemi',0,{wagonCount:2}),/車廂數/);
assert.throws(()=>vehicleConsistBackgroundObject('timberTrain',0,{wagonKey:'railFuel'}),/不相容/);
assert.throws(()=>vehicleConsistBackgroundObject('timberTrain',0,{leaderKey:'roadTractor'}),/不相容/);
console.log(`${Object.keys(VEHICLE_CONSISTS).length} 種編組：聯結點、軌距、動力角色與拒絕不合理載荷通過`);

if (!process.env.THREE_MODULE) throw new Error('請設定 THREE_MODULE 執行正式渲染器驗證');
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,n){if(s==='three')return{url:${JSON.stringify(pathToFileURL(process.env.THREE_MODULE).href)},shortCircuit:true};return n(s,c);}`),import.meta.url);
const THREE=await import('three');
const {makeProceduralVehicle}=await import('../public/js/vehicleModels.js');
for(const key of [...keys,...Object.keys(VEHICLE_CONSISTS).map(k=>CONSIST_PREFIX+k)]) {
  const root=makeProceduralVehicle(key,42,{fit:{L:5,W:2,H:3}});
  root.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(root);
  assert.ok(Math.abs(bounds.min.y)<1e-5,`${key}: rendered wheel contact`);
  const size=bounds.getSize(new THREE.Vector3());
  assert.ok(size.x<=5.00001 && size.y<=3.00001 && size.z<=2.00001,`${key}: fit overflow`);
  root.traverse(o=>{if(o.geometry){assert.ok(o.geometry.attributes.position.count>0);assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite));o.geometry.dispose();}o.material?.dispose();});
}
console.log('全部車型經正式 Three.js 編譯與宿主碰撞盒包絡驗證通過');
