import assert from 'node:assert/strict';
import {generateVehicle,vehicleBackgroundObject,VEHICLE_PROFILES} from '../public/js/vehicleCatalog.js';
const brands=new Set(),rims=new Set();let roof=0;
for(const key of Object.keys(VEHICLE_PROFILES))for(let seed=0;seed<256;seed++) {
  const v=generateVehicle(key,seed);
  assert.deepEqual(v,generateVehicle(key,seed));
  assert.ok(v.curbTonnes>0&&v.payloadTonnes>=0&&v.cargoTonnes<=v.payloadTonnes);
  assert.equal(v.grossTonnes,v.curbTonnes+v.payloadTonnes);
  brands.add(v.brand.name);rims.add(v.wheels.rimStyle);
  if(v.coupling||v.type==='tracked')assert.equal(v.wheels.suspensionLift,0);
  if(v.cargo?.location==='roof') {
    assert.ok(['sedan','van','pickup','rover','camper'].includes(key));
    assert.ok(v.cargo.count>=1&&v.cargo.count<=3);
    const e=vehicleBackgroundObject(key,seed);
    assert.equal(e.parts.filter(p=>p.name==='cargo_tie_top').length,v.cargo.count);
    assert.equal(e.parts.filter(p=>p.name==='cargo_roof_foot').length,4);
    assert.ok(e.bounds.min[1]>=-1e-8);
    assert.ok(e.parts.length<160,'貨物不能突破單車零件預算');
    roof++;
  }
  if(v.cargo?.location==='load') {
    const e=vehicleBackgroundObject(key,seed);
    const role=v.cargo.type==='logs'?(v.parts.includes('logs')?'timber':'secured_log'):v.cargo.type==='cars'?'transported_car':'aggregate_load';
    assert.equal(e.parts.filter(p=>p.name===role).length,v.cargo.count);
  }
}
assert.equal(brands.size,5);assert.ok(rims.has('steel')&&rims.has('alloy')&&rims.has('disc'));
assert.ok(roof>60&&roof<145,'車頂貨物應維持低機率，約 8%');
console.log(`${Object.keys(VEHICLE_PROFILES).length*256} 組變體：質量範圍、5 品牌、輪框、載貨數量與車頂綁載通過（${roof}/1280）`);
