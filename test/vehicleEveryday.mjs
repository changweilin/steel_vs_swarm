import assert from 'node:assert/strict';
import {ROAD_CAR_WEIGHTS,selectRoadCar} from '../public/js/vehicleEveryday.js';
import {VEHICLE_PROFILES,vehicleBackgroundObject} from '../public/js/vehicleCatalog.js';
import {INDIVIDUAL_BODIES} from '../public/js/vehicleIndividualBodies.js';
import {readFileSync} from 'node:fs';
const individualKeys=Object.keys(VEHICLE_PROFILES).filter(key=>VEHICLE_PROFILES[key].style);
assert.deepEqual(Object.keys(INDIVIDUAL_BODIES).sort(),individualKeys.sort(),'新增車款必須逐款建模');
const shapes=new Set();
for(const key of individualKeys) {
  const model=INDIVIDUAL_BODIES[key];
  // 忽略名稱與顏色，防止只改名稱／配色冒充專屬幾何。
  shapes.add(JSON.stringify({wheels:model.wheels,boxes:model.boxes.map(p=>p.slice(1,7)),beams:model.beams.map(p=>p.slice(1,4)),cylinders:model.cylinders.map(p=>p.slice(1,6))}));
  const entry=vehicleBackgroundObject(key,42);
  assert.ok(!entry.parts.some(p=>['cab','van_body','body','floor','frame'].includes(p.name)),`${key} 不可退回共用車身`);
  if(VEHICLE_PROFILES[key].form!=='cycle'&&VEHICLE_PROFILES[key].form!=='motor')assert.ok(entry.parts.some(p=>p.name==='front_windshield'));
  for(const power of VEHICLE_PROFILES[key].powers) {
    const powered=vehicleBackgroundObject(key,42,{power});
    if(power==='battery')assert.ok(!powered.parts.some(p=>['engine','sculpted_fuel_tank','exhaust'].includes(p.name)),`${key} 電動版不可攜帶燃油硬體`);
    if(VEHICLE_PROFILES[key].form==='motor')assert.ok(powered.parts.some(p=>p.name==='brand_badge_base'),`${key} 品牌徽章不可因動力消失`);
  }
}
assert.equal(shapes.size,individualKeys.length,'各車款必須具有不同幾何');
const source=readFileSync(new URL('../public/js/vehicleCatalog.js',import.meta.url),'utf8');
assert.match(source,/if \(v.style\) \{\s*buildIndividualBody\(v,\{box,cyl,beam,wheel\}\);\s*\} else if/,'獨立車款須在共用模組前分流');
assert.equal(Object.values(ROAD_CAR_WEIGHTS).reduce((a,b)=>a+b,0),100);
const counts={};
for(let seed=0;seed<10000;seed++) {
  const key=selectRoadCar(seed);
  assert.equal(key,selectRoadCar(seed));
  assert.ok(!VEHICLE_PROFILES[key].purpose.includes('military'));
  counts[key]=(counts[key]||0)+1;
}
for(const [key,weight] of Object.entries(ROAD_CAR_WEIGHTS))assert.ok(Math.abs(counts[key]/100-weight)<2,`${key} 頻率偏离設定`);
const names=key=>vehicleBackgroundObject(key,42).parts.map(p=>p.name);
assert.ok(!names('convertible').includes('cab'),'敞篷車不能保留封閉車頂');
for(const [key,role] of Object.entries({foldingBike:'folding_frame_hinge',electricBike:'ebike_downtube_battery',scooter:'scooter_legshield',sportMoto:'motor_fairing',motorhome:'overcab_sleeping_pod',offroadSUV:'rear_spare_tire',militaryVan:'communications_roof_case'}))assert.ok(names(key).includes(role));
assert.ok(!names('electricScooter').includes('engine'));
console.log('道路選款比例、軍民隔離與常見車型專用外觀通過');
