import assert from 'node:assert/strict';
import {vehicleBackgroundObject,VEHICLE_PROFILES} from '../public/js/vehicleCatalog.js';
import {partAABB} from '../public/js/vehicles.js';

// Broad-phase regression: a detached AABB proves a gap; overlapping boxes do not
// prove exact surface contact, so this complements visual inspection.
const failures=[];
let samples=0;
for(const key of Object.keys(VEHICLE_PROFILES))for(const power of VEHICLE_PROFILES[key].powers)for(const seed of [0,1,42,88,-9,2147483647]) {
  const {parts,plates,generation}=vehicleBackgroundObject(key,seed,{power});
  samples++;
  assert.equal(parts.filter(p=>p.name==='license_plate').length,plates.length);
  if(generation.type==='rail'||generation.type==='tracked')assert.equal(plates.length,0,'鐵道與履帶機具不可誤套道路車牌');
  for(const plate of plates) {
    assert.equal(Math.abs(plate.ry),Math.PI/2,'車牌必須朝車頭或車尾');
    const end=Math.sign(plate.ry);
    assert.ok(parts.some(p=>p.name==='license_plate'&&Math.abs(p.position[1]-plate.y)<1e-8
      && Math.abs(p.position[2]-plate.z)<1e-8 && Math.abs(plate.x-p.position[0]-end*.004)<1e-8),'文字須貼合專用車牌底板');
  }
  if(key==='motorcycle')assert.ok(plates.every(p=>p.ry<0&&p.x<-generation.length*.35),'機車只在尾端掛牌');
  if(key==='bulldozer'||key==='paver')assert.ok(!parts.some(p=>p.name==='armored_hull'||p.name==='hatch'),'工程車不得套用裝甲上身');
  const required={concretePump:'pump_articulated_section',bucketTruck:'insulated_work_bucket',tipper:'hinged_tailgate',paver:'feed_conveyor',fireEngine:'pressure_gauge',dewatering:'centrifugal_pump_housing',generatorTruck:'power_socket_panel',prisoner:'secure_rear_door',command:'stowed_satellite_dish',libraryBus:'book_spine'};
  if(required[key])assert.ok(parts.some(p=>p.name===required[key]),`${key} 缺少專用功能幾何`);
  const boxes=parts.map(p=>partAABB({p:p.position,r:p.rotation,g:p.type==='box'
    ? ['box',...p.dimensions] : p.type==='cylinder' ? ['cyl',...p.radii,p.height,p.sides]
      : ['box',2*(p.radius+p.tube),2*(p.radius+p.tube),p.tube*2]}));
  const left=new Set(parts.map((_,i)=>i)),groups=[];
  while(left.size) {
    const queue=[left.values().next().value];left.delete(queue[0]);
    for(let q=0;q<queue.length;q++)for(const j of left) {
      const a=boxes[j],b=boxes[queue[q]];
      if(['x','y','z'].every(k=>a[k+'0']<=b[k+'1']+.015&&b[k+'0']<=a[k+'1']+.015)) {
        left.delete(j);queue.push(j);
      }
    }
    groups.push(queue);
  }
  groups.sort((a,b)=>b.length-a.length);
  if(groups.length>1)failures.push(`${key}/${power}/${seed}: `+groups.slice(1).map(g=>[...new Set(g.map(i=>parts[i].name))].join('/')).join(', '));
  for(const cab of parts.filter(p=>p.name==='cab')) {
    assert.ok(parts.some(p=>p.name==='front_windshield'&&p.position[0]>cab.position[0]+cab.dimensions[0]/2),'前擋必須露出駕駛艙正面');
  }
  if(key==='mixer') {
    const drum=parts.filter(p=>p.name==='mixer_drum_section').sort((a,b)=>a.position[0]-b.position[0]);
    assert.equal(drum.length,3);
    assert.ok(drum[0].position[1]>drum[2].position[1],'卸料端在後方且高於前端');
    assert.ok(drum[0].radii[0]<drum[1].radii[0],'後端必須縮口');
    assert.ok(drum[2].radii[1]<drum[1].radii[1],'前端必須收束');
  }
}
assert.deepEqual(failures,[],'零件群與主體間存在超過 1.5 cm 的包絡間隙');
console.log(`${samples} 組車型／動力／種子：零件接合包絡、前擋位置與攪拌筒方向通過`);
