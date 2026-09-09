import { vehicleBackgroundObject } from './vehicleCatalog.js';
import { mulberry32 } from './rng.js';

export const CONSIST_PREFIX = 'consist/';
const train=(name,purpose,wagons)=>({name,purpose,mode:'rail',leaders:['dieselLocomotive','electricLocomotive'],wagons,count:[2,6]});
const semi=(name,purpose,trailer)=>({name,purpose,mode:'semi',leaders:['roadTractor'],wagons:[trailer],count:[1,1]});
export const VEHICLE_CONSISTS = {
  timberTrain:train('林業原木列車','forestry',['railLogs']),
  oreTrain:train('礦石運輸列車','mining',['railOre']),
  containerTrain:train('貨櫃聯運列車','freight',['railContainer']),
  militaryTrain:train('軍事裝備運輸列車','military',['railMilitary','railBox']),
  fuelTrain:train('能源燃油列車','energy',['railFuel']),
  grainTrain:train('穀物運輸列車','agriculture',['railGrain']),
  coldTrain:train('食品冷鏈列車','food',['railReefer']),
  carTrain:train('汽車運輸列車','freight',['railAuto']),
  maintenanceTrain:train('鐵道工程列車','construction',['railMaintenance','railBallast']),
  wasteTrain:train('廢棄物運輸列車','waste',['railWaste']),
  mixedTrain:train('一般混合貨運列車','freight',['railBox','railContainer','railAuto']),
  containerSemi:semi('貨櫃聯結車','freight','semiContainer'),
  timberSemi:semi('原木聯結車','forestry','semiLogs'),
  aggregateSemi:semi('砂石聯結車','mining','semiOre'),
  machineSemi:semi('工程機具低床聯結車','construction','semiLowboy'),
  militarySemi:semi('軍用裝備聯結車','military','semiMilitary'),
  fuelSemi:semi('油罐聯結車','energy','semiFuel'),
  nitrogenSemi:semi('液氮充填聯結車','science','semiNitrogen'),
  coldSemi:semi('冷鏈聯結車','food','semiReefer'),
  autoSemi:semi('轎車運輸聯結車','freight','semiAuto'),
  livestockSemi:semi('牲畜運輸聯結車','livestock','semiLivestock'),
  curtainSemi:semi('側簾物流聯結車','commerce','semiCurtain'),
  grainSemi:semi('散裝穀物聯結車','agriculture','semiGrain'),
};

/** 車頭 +X；只允許配方白名單。編組不控制行車或物理鉸接。 */
export function vehicleConsistBackgroundObject(key,seed=0,options={}) {
  if(!Object.hasOwn(VEHICLE_CONSISTS,key))throw new RangeError(`未知編組:${key}`);
  if(!Number.isSafeInteger(seed))throw new TypeError('編組 seed 必須是安全整數');
  const recipe=VEHICLE_CONSISTS[key], r=mulberry32(seed^0x434f5550);
  const leader=options.leaderKey||recipe.leaders[Math.floor(r()*recipe.leaders.length)];
  if(!recipe.leaders.includes(leader))throw new RangeError('牽引車與編組不相容');
  const count=options.wagonCount??(recipe.count[0]+Math.floor(r()*(recipe.count[1]-recipe.count[0]+1)));
  if(!Number.isInteger(count)||count<recipe.count[0]||count>recipe.count[1])throw new RangeError(`車廂數須介於 ${recipe.count.join('–')}`);
  const cargo=options.wagonKey;
  if(cargo&&!recipe.wagons.includes(cargo))throw new RangeError('車廂載荷與產業不相容');
  const selected=[leader,...Array.from({length:count},(_,i)=>cargo||recipe.wagons[i%recipe.wagons.length])];
  const children=selected.map((k,i)=>vehicleBackgroundObject(k,(seed+i*7919)|0));
  const parts=[],markings=[],members=[],plates=[];
  const system=recipe.mode==='rail'?'rail':'fifthWheel';
  let offset=0, previous=null;
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  children.forEach((child,index)=>{
    const v=child.generation;
    if(v.coupling?.system!==system || (index>0&&v.power!=='towed'))throw new RangeError('聯結系統或動力角色不相容');
    if(previous) {
      if(v.coupling.height!==previous.generation.coupling.height || (system==='rail'&&v.coupling.gauge!==previous.generation.coupling.gauge))throw new RangeError('車鉤高度或軌距不相容');
      offset=system==='rail'
        ? offset-previous.generation.length*.49-v.length*.49
        : -previous.generation.length*.23-v.length*.36;
    }
    parts.push(...child.parts.map(p=>({...p,name:`${index}:${p.name}`,position:[p.position[0]+offset,p.position[1],p.position[2]]})));
    if(child.markingSurface)markings.push({surface:{...child.markingSurface,x:child.markingSurface.x+offset},vehicle:v});
    // 聯結後只保留牽引車前牌與末端拖車後牌，避免牌照藏在聯結器內。
    for(const plate of child.plates||[])if((index===0&&plate.ry>0)||(index===children.length-1&&plate.ry<0))plates.push({...plate,x:plate.x+offset});
    members.push({key:selected[index],name:v.name,power:v.power,offset,length:v.length,coupling:v.coupling});
    for(let axis=0;axis<3;axis++){
      const shift=axis===0?offset:0;
      min[axis]=Math.min(min[axis],child.bounds.min[axis]+shift);
      max[axis]=Math.max(max[axis],child.bounds.max[axis]+shift);
    }
    previous=child;
  });
  const size=max.map((value,i)=>value-min[i]);
  const lead=children[0].generation;
  return {key:`${CONSIST_PREFIX}${key}:${seed}:${leader}:${count}:${cargo||'mixed'}`,targetKey:CONSIST_PREFIX+key,
    name:recipe.name,family:'vehicle',version:1,subpart:recipe.mode,parts,palettes:[],markings,plates,bounds:{min,max,size},
    dimensions:{L:size[0],W:size[2],H:size[1]},sceneBasis:{rotationY:0},
    generation:{...lead,key,name:recipe.name,form:'consist',purpose:recipe.purpose,type:recipe.mode==='rail'?'rail':'trailer',
      length:size[0],width:size[2],height:size[1],parts:[],consist:recipe.mode,members,wagonCount:count}};
}
