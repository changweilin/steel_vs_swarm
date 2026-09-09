import {mulberry32} from './rng.js';

export const VEHICLE_BRANDS = [
  {name:'嶺川 RIVORN',mark:'diamond',color:0xc4d6df},
  {name:'曜輪 SOLTRA',mark:'sun',color:0xd9af53},
  {name:'鐵嶼 FERROVA',mark:'bars',color:0xb5bbc3},
  {name:'北辰 NORDEN',mark:'cross',color:0x779fb4},
  {name:'森原 VERDAN',mark:'chevron',color:0x65a583},
];
export const RIM_NAMES={steel:'鋼製孔式',alloy:'六輻鋁圈',disc:'封閉碟式',spoked:'鋼絲輻條',rail:'鐵道鋼輪',tracked:'履帶負重輪'};
const mass={cycle:[.009,.03],trike:[.06,.2],motor:[.1,.35],cart:[.025,.12],carriage:[.3,1],sedan:[1.1,2.2],van:[1.7,3.2],pickup:[1.5,3],truck:[5,12],tractorUnit:[6,10],bus:[8,16],tractor:[2,7],harvester:[8,18],forklift:[2,6],excavator:[8,25],tank:[12,55],armor:[10,25],roller:[3,12],railcar:[25,48],railWagon:[15,30],railLocomotive:[70,120],steam:[45,90],semiTrailer:[5,10],utility:[1.5,5]};

/** 美術用噸位與改裝參數；不進入碰撞、傷害或經濟計算。 */
export function vehicleVariants(key,spec,seed,length) {
  const r=mulberry32(seed^0x56415249),pick=a=>a[Math.floor(r()*a.length)],sample=(a,b)=>a+r()*(b-a);
  const range=mass[spec.form],size=(length-spec.length[0])/(spec.length[1]-spec.length[0]);
  const curbTonnes=range[0]+(range[1]-range[0])*(size*.8+r()*.2);
  const heavy=['heavy','trailer','rail'].includes(spec.type);
  const noFreight=['railLocomotive','steam','tractorUnit','tank','excavator','roller','harvester','tractor'].includes(spec.form);
  const payloadTonnes=noFreight?0:curbTonnes*(['bus','railcar'].includes(spec.form)?sample(.12,.25):heavy?sample(.45,1.4):sample(.15,.35));
  const roadWheel=!['tracked','rail'].includes(spec.type)&&!['cycle','trike','cart','carriage','roller'].includes(spec.form);
  // 聯結座、軌距、履帶與工作輪保持標準安裝高度。
  const adjustable=['sedan','van','pickup','utility'].includes(spec.form);
  const radiusScale=adjustable?sample(.96,1.08):1;
  const suspensionLift=adjustable?sample(0,spec.type==='offroad'?.12:.045):0;
  const widthScale=roadWheel?sample(.95,1.16):1;
  const rimStyle=spec.type==='rail'?'rail':spec.type==='tracked'?'tracked':['cycle','trike'].includes(spec.form)?'spoked':roadWheel?pick(['steel','alloy','disc']):'steel';
  const roofEligible=['sedan','van','pickup','rover','camper'].includes(key);
  const roof=roofEligible&&r()<.08;
  const open=spec.parts.includes('openBed');
  let cargo=roof||open?{location:roof?'roof':'bed',type:pick(roof?['luggage','crate','camping']:['crate','sacks','barrels']),count:roof?1+Math.floor(r()*3):Math.floor(r()*5)}:null;
  if(spec.parts.some(p=>['logs','logLoad'].includes(p)))cargo={location:'load',type:'logs',count:1+Math.floor(r()*(spec.parts.includes('logs')?3:6))};
  if(spec.parts.includes('autoDeck'))cargo={location:'load',type:'cars',count:1+Math.floor(r()*4)};
  if(spec.parts.some(p=>['oreHopper','ballastHopper','dumpBed'].includes(p)))cargo={location:'load',type:'aggregate',count:Math.floor(r()*4)};
  const cargoTonnes=cargo?Math.min(payloadTonnes,cargo.count*(cargo.location==='roof'?.012:cargo.location==='load'?cargo.type==='cars'?1.5:.6:.065)):0;
  return {brand:pick(VEHICLE_BRANDS),curbTonnes,payloadTonnes,grossTonnes:curbTonnes+payloadTonnes,cargoTonnes,
    wheels:{radiusScale,widthScale,suspensionLift,rimStyle},cargo};
}

export function buildVariantEquipment(v,rows,{box,cyl,beam}) {
  const {length:L,width:W,height:H,brand,cargo}=v;
  const cab=rows.find(p=>p.role==='cab')||rows.find(p=>['model_cowl','armored_hull','rail_frame','trailer_frame','wooden_bed','engine','electric_motor'].includes(p.role));
  if(cab) {
    const x=cab.p[0]+cab.g[1]/2+.014,y=cab.p[1]-cab.g[2]*.25,z=cab.p[2],s=Math.min(W*.075,.19);
    box('brand_badge_base',x,y,z,.025,s,s,0x28313a);
    if(brand.mark==='sun')cyl('brand_sun',x+.014,y,z,s*.36,.016,brand.color,[0,0,Math.PI/2]);
    else if(brand.mark==='diamond')box('brand_diamond',x+.014,y,z,.016,s*.52,s*.52,brand.color,[Math.PI/4,0,0]);
    else if(brand.mark==='bars')for(const side of [-1,1])box('brand_bars',x+.014,y,z+side*s*.2,.016,s*.65,s*.13,brand.color);
    else if(brand.mark==='cross') {box('brand_cross',x+.014,y,z,.016,s*.7,s*.15,brand.color);box('brand_cross',x+.014,y,z,.016,s*.15,s*.7,brand.color);}
    else for(const side of [-1,1])box('brand_chevron',x+.014,y,z+side*s*.17,.016,s*.55,s*.13,brand.color,[side*.55,0,0]);
  }
  if(!cargo||!cargo.count||cargo.location==='load')return;
  const roof=cargo.location==='roof';
  const surface=roof?rows.filter(p=>['cab','van_body','equipment_compartment'].includes(p.role)).sort((a,b)=>(b.p[1]+b.g[2]/2)-(a.p[1]+a.g[2]/2))[0]:rows.find(p=>p.role==='openBed');
  if(!surface)return;
  const x=surface.p[0],top=surface.p[1]+surface.g[2]/2,span=Math.min(surface.g[1]*.78,L*.36),w=W*.57;
  const base=top+(roof?H*.06:0);
  if(roof) {
    for(const dx of [-.35,.35])for(const side of [-1,1])box('cargo_roof_foot',x+span*dx,top+H*.025,side*w*.4,L*.025,H*.06,W*.045,0x65747b);
    box('cargo_roof_platform',x,base,0,span,H*.025,w,0x65747b);
  }
  for(let i=0;i<cargo.count;i++) {
    const cx=x+span*((i+.5)/cargo.count-.5),l=span/cargo.count*.87,h=H*(roof?.12:.2);
    if(cargo.type==='barrels')cyl('cargo_barrel',cx,base+h/2,0,Math.min(l,w)*.4,h,0x658797,[0,0,0]);
    else {
      box('cargo_'+cargo.type,cx,base+h/2,0,l,h,w*.8,cargo.type==='crate'?0x9b794c:cargo.type==='camping'?0x52725d:0x98775f);
      if(cargo.type==='crate')box('crate_batten',cx,base+h/2,w*.405,l*.13,h,W*.015,0x624b30);
    }
    // 綁帶貼著貨物頂面與兩側，落到承載平台。
    box('cargo_tie_top',cx,base+h+.005,0,l*.09,.018,w*.84,0x353b40);
    for(const side of [-1,1])box('cargo_tie_side',cx,base+h/2,side*w*.41,l*.09,h+.025,.018,0x353b40);
  }
}
