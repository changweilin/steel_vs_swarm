// Presentation load plans. All coordinates are metres; no weapon authority lives here.
import { mulberry32 } from './rng.js';

export const VESSEL_DESIGNS = {
  skiff:['open','none','fishing'], trawler:['ship','forward','fishing'],
  tug:['tug','work','tow'], dredger:['barge','aft','dredging'], barge:['barge','none','mixed'],
  container:['ship','aft','containers'], tanker:['ship','aft','oil'], ferry:['ship','passenger','none'],
  yacht:['speed','yacht','none'], sloop:['sail','coachroof','none'], excursion:['ship','passenger','none'],
  liner:['ship','liner','none'], research:['ship','forward','science'], submersible:['sub','dome','subscience'],
  patrol:['speed','combat','patrol'], frigate:['ship','combat','escort'], submarine:['sub','sail','submarine'],
  kayak:['kayak','none','none'], racing:['speed','cockpit','none'], rescue:['speed','rescue','rescue'],
  paddlesteamer:['barge','heritage','none'], towboat:['barge','none','mixed'], junk:['sail','wood','mixed'],
  icebreaker:['ice','forward','science'], inflatable:['inflatable','none','rescue'], rib:['rib','console','rescue'],
  lifeboat:['capsule','capsule','none'], canoe:['canoe','none','none'], rowboat:['open','none','none'],
  lng:['ship','aft','lng'], lng_membrane:['ship','aft','membrane'], bulk:['ship','aft','bulk'],
  general_cargo:['ship','aft','mixed'], roro:['ship','roro','roro'], cable:['ship','forward','cable'],
  corvette:['ship','combat','escort'], destroyer:['ship','combat','destroyer'], cruiser:['ship','combat','cruiser'],
  carrier:['carrier','island','carrier'], light_carrier:['carrier','island','lightCarrier'],
  amphibious:['carrier','island','amphibious'], missile_boat:['speed','combat','missile'], minesweeper:['ship','forward','mine'],
};

export const VESSEL_EQUIPMENT = {
  cannon:{category:'weapon',label:'艦砲'}, autocannon:{category:'weapon',label:'遙控機砲'},
  ciws:{category:'weapon',label:'近迫防禦砲'}, vls:{category:'weapon',label:'垂直發射模組'},
  missile:{category:'weapon',label:'斜置飛彈發射箱'}, torpedo:{category:'weapon',label:'魚雷發射管'},
  sam:{category:'weapon',label:'防空飛彈架'}, decoy:{category:'weapon',label:'誘餌發射器'},
  container:{category:'cargo',label:'標準貨櫃'}, reefer:{category:'cargo',label:'冷藏貨櫃'},
  tank_container:{category:'cargo',label:'罐式貨櫃'}, crates:{category:'cargo',label:'木箱棧板'},
  logs:{category:'cargo',label:'綁紮原木'}, coils:{category:'cargo',label:'鋼捲'}, pipes:{category:'cargo',label:'鋼管束'},
  machinery:{category:'cargo',label:'工程機具'}, truck:{category:'cargo',label:'貨車'}, car:{category:'cargo',label:'轎車'},
  coal:{category:'cargo',label:'煤炭艙'}, ore:{category:'cargo',label:'礦砂艙'}, grain:{category:'cargo',label:'穀物艙'}, hatch:{category:'cargo',label:'封閉貨艙蓋'},
  lng_sphere:{category:'cargo',label:'球型 LNG 儲罐'}, lng_membrane:{category:'cargo',label:'薄膜罐甲板罩'},
  oil_manifold:{category:'cargo',label:'油艙管匯'}, cable_drum:{category:'cargo',label:'電纜捲盤'},
  radar:{category:'instrument',label:'導航雷達'}, satcom:{category:'instrument',label:'衛星通訊罩'},
  phased_array:{category:'instrument',label:'相控陣雷達'}, ctd:{category:'instrument',label:'CTD 採水架'},
  rov:{category:'instrument',label:'ROV 水下機器人'}, winch:{category:'instrument',label:'探測絞車'},
  buoy:{category:'instrument',label:'觀測浮標'}, lab:{category:'instrument',label:'移動實驗艙'},
  sonar:{category:'instrument',label:'拖曳聲納'}, a_frame:{category:'instrument',label:'艉部 A 架'},
  net_drum:{category:'utility',label:'漁網捲筒'}, fish_crates:{category:'utility',label:'漁獲箱'},
  crane:{category:'utility',label:'甲板吊機'}, dredge:{category:'utility',label:'疏浚管架'},
  tow_winch:{category:'utility',label:'拖纜絞盤'}, rescue_kit:{category:'utility',label:'救援裝備箱'},
  lifeboat:{category:'utility',label:'吊架救生艇'},
  fighter:{category:'aircraft',label:'艦載戰機'}, helicopter:{category:'aircraft',label:'直升機'},
};
const choose=(r,list)=>list[Math.floor(r()*list.length)];
const count=(r,min,max)=>min+Math.floor(r()*(max-min+1));

export function planVesselLayout(v) {
  const design=VESSEL_DESIGNS[v.type];
  if (!design) throw new Error(`Missing vessel design: ${v.type}`);
  const [hull,cabinStyle,mission]=design, L=v.length, B=v.beam, F=v.freeboard;
  const r=mulberry32(v.decorationSeed ^ 0x4c4f4144);
  const small=['kayak','canoe','open','inflatable','rib'].includes(hull);
  // Open craft use a shallow raised sole so the shared water plane stays below the interior.
  const deckY=small?Math.max(0.02,-v.draft*0.55+B*0.0125):F, deckWidth=B*(hull==='carrier'?1.45:0.86);
  const cabins=[], reserved=[], zones=[], equipment=[];
  function cabin(style,x,z,w,d,h,levels=1) {
    const c={style,x:x*B,z:z*L,w:w*B,d:d*L,h,y:deckY,levels};
    cabins.push(c); reserved.push({...c,name:'cabin'}); return c;
  }
  if(cabinStyle==='aft') cabin('bridge',0,-0.34,0.68,0.17,Math.min(12,B*0.52),2);
  if(cabinStyle==='forward') cabin('work',0,0.19,0.7,0.24,Math.min(10,B*0.58),2);
  if(cabinStyle==='work') cabin('work',0,0.08,0.66,0.28,Math.min(6,B*0.8),2);
  if(cabinStyle==='combat') cabin('combat',0,-0.02,0.64,0.28,Math.min(12,B*0.58),2);
  if(cabinStyle==='rescue') cabin('rescue',0,-0.02,0.64,0.34,Math.min(2.8,B*0.56));
  if(cabinStyle==='yacht') cabin('yacht',0,-0.04,0.68,0.48,Math.min(4.5,B*0.42),2);
  if(cabinStyle==='coachroof') cabin('coachroof',0,-0.09,0.56,0.28,Math.min(1.4,B*0.22));
  if(cabinStyle==='wood') cabin('wood',0,-0.3,0.66,0.18,Math.min(3,B*0.38));
  if(cabinStyle==='passenger' || cabinStyle==='heritage') cabin(cabinStyle,0,-0.02,0.74,0.64,Math.min(6,B*0.65),2);
  if(cabinStyle==='liner') cabin('liner',0,-0.01,0.8,0.73,Math.min(26,B*0.75),count(r,4,6));
  if(cabinStyle==='roro') cabin('roro',0,0.03,0.76,0.6,Math.min(18,B*0.7),3);
  if(cabinStyle==='island') cabin('island',0.48,0.04,0.25,0.18,Math.min(18,B*0.5),3);
  if(cabinStyle==='console') cabin('console',0,0.06,0.25,0.14,Math.min(1.1,B*0.35));
  if(cabinStyle==='cockpit') cabin('cockpit',0,-0.06,0.5,0.22,B*0.2);
  if(cabinStyle==='capsule') cabin('capsule',0,0,0.82,0.73,B*0.5);
  if(hull==='carrier') reserved.push({name:'runway',x:-B*0.2,z:0,w:B*0.56,d:L*0.92,y:deckY,h:0});
  if(v.parts.includes('helipad')) reserved.push({name:'helipad',x:0,z:-L*0.36,w:B*0.76,d:L*0.18,y:deckY,h:0});

  // A cell includes the entire render envelope (barrels, wings and booms included).
  function zone(name,x,z,w,d,cols,rows,min,max,kinds,y=deckY,layers=1,cellSize=null) {
    const zone={name,x:x*B,z:z*L,w:w*B,d:d*L,y,cols,rows,kinds}; zones.push(zone);
    const cw=zone.w/cols, cd=zone.d/rows;
    const cells=[];
    for(let row=0;row<rows;row++)for(let col=0;col<cols;col++)cells.push({row,col});
    // Shuffle cells, then fill a stack bottom-up; no floating cargo tiers.
    for(let i=cells.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[cells[i],cells[j]]=[cells[j],cells[i]];}
    const target=count(r,Math.min(min,cells.length),Math.min(max,cells.length));
    for(const {row,col} of cells.slice(0,target)) {
      const kind=choose(r,kinds), tierCount=count(r,1,layers);
      const ew=cellSize?.w??cw*0.82, ed=cellSize?.d??cd*0.82;
      const eh=cellSize?.h??Math.min(ew,ed)*0.7;
      for(let tier=0;tier<tierCount;tier++)equipment.push({
        kind,category:VESSEL_EQUIPMENT[kind].category,zone:name,
        x:zone.x-zone.w/2+cw*(col+0.5),z:zone.z-zone.d/2+cd*(row+0.5),
        y:y+tier*eh,w:ew,d:ed,h:eh,tier,
        variant:count(r,0,3),units:kind==='vls'?count(r,2,4)*4:1,
        heading:VESSEL_EQUIPMENT[kind].category!=='weapon'?0
          :name.startsWith('port')?-Math.PI/2:name.startsWith('starboard')?Math.PI/2
          :kind==='torpedo'?(col===0?-Math.PI/2:Math.PI/2):name.startsWith('aft')?Math.PI:0,
      });
    }
  }
  const cargo=(kinds,cols=2,rows=4,min=3,max=8)=>zone('cargo',0,v.type==='junk'?0.065:0.04,0.74,v.type==='junk'?0.47:0.53,cols,rows,min,max,kinds);
  if(mission==='containers') {
    const cols=Math.max(1,Math.floor(B*0.76/2.75)), rows=Math.max(1,Math.floor(L*0.53/12.65));
    const max=Math.min(cols*rows,40);
    zone('container_bays',0,0.04,0.76,0.53,cols,rows,Math.ceil(max*0.65),max,['container','reefer','tank_container'],deckY,3,{w:2.44,d:12.19,h:2.59});
  }
  if(mission==='mixed') cargo(['crates','logs','coils','pipes','machinery']);
  if(mission==='lng'||mission==='membrane') {
    const n=count(r,3,5);zone('gas_tanks',0,0.04,0.78,0.54,1,n,n,n,[mission==='lng'?'lng_sphere':'lng_membrane']);
  }
  if(mission==='bulk') {const n=count(r,3,6);cargo(['coal','ore','grain','hatch'],1,n,n,n);}
  if(mission==='oil') cargo(['oil_manifold'],2,5,6,10);
  if(mission==='roro') zone('stern_vehicle_deck',0,-0.36,0.62,0.12,3,1,1,3,['truck','car']);
  if(mission==='science'||mission==='mine'||mission==='cable') {
    zone('working_deck',0,-0.18,0.7,0.38,2,3,4,6,
      mission==='cable'?['cable_drum','winch']:mission==='mine'?['sonar','rov','winch']:['ctd','rov','buoy','winch','lab']);
    zone('stern_handling',0,-0.43,0.74,0.09,1,1,1,1,['a_frame']);
  }
  if(mission==='fishing') {
    const z=v.type==='skiff'?0:-0.2;
    zone('fishing_deck',0,z,0.64,v.type==='skiff'?0.28:0.34,2,2,2,4,['fish_crates','net_drum']);
  }
  if(mission==='dredging') cargo(['dredge','crane'],1,2,2,2);
  if(mission==='tow') zone('tow_deck',0,-0.3,0.65,0.22,1,1,1,1,['tow_winch']);
  if(mission==='rescue') zone('rescue_stowage',0,-0.32,0.52,0.12,2,1,1,2,['rescue_kit']);
  if(mission==='subscience')zone('submersible_samples',0,-0.12,0.55,0.18,2,1,1,2,['ctd','sonar'],-v.draft-B*0.1);
  const combat=['patrol','escort','destroyer','cruiser','missile'].includes(mission);
  if(combat) {
    zone('forecastle',0,0.34,0.5,0.15,1,1,1,1,[mission==='patrol'?'autocannon':'cannon']);
    if(mission!=='patrol'||L>=25)zone('forward_weapons',0,0.2,0.64,0.1,2,1,mission==='patrol'?0:1,mission==='patrol'?1:2,mission==='patrol'?['decoy']:mission==='missile'?['sam','decoy']:['vls','sam']);
    const lightBoat=mission==='patrol';
    zone('port_weapons',-0.39,-0.03,0.12,0.28,1,3,lightBoat?1:2,lightBoat?1:3,lightBoat?['autocannon']:['ciws','autocannon','decoy']);
    zone('starboard_weapons',0.39,-0.03,0.12,0.28,1,3,lightBoat?1:2,lightBoat?1:3,lightBoat?['autocannon']:['ciws','autocannon','decoy']);
    if(mission!=='patrol'||L>=25)zone('aft_weapons',0,-0.23,0.64,0.09,2,1,lightBoat?0:1,lightBoat?1:2,lightBoat?['autocannon']:mission==='missile'?['missile']:['missile','torpedo']);
    if(['destroyer','cruiser'].includes(mission))zone('forward_vls',0,0.135,0.56,0.028,4,1,3,4,['vls']);
    if(mission==='cruiser')zone('aft_vls',0,-0.174,0.56,0.02,4,1,3,4,['vls']);
  }
  if(hull==='carrier') {
    zone('port_sponsons',-0.65,0,0.12,0.78,1,4,3,4,['ciws','sam','decoy']);
    zone('starboard_sponsons',0.68,0,0.08,0.78,1,4,3,4,['ciws','sam','decoy']);
    const air=mission==='amphibious'?['helicopter']:mission==='lightCarrier'?['fighter','helicopter']:['fighter'];
    zone('aft_aircraft',0.35,-0.29,0.4,0.25,2,4,4,8,air);
    zone('forward_aircraft',0.35,0.29,0.4,0.21,2,3,3,6,air);
  }
  if(v.type==='liner')for(const side of [-1,1])zone(side<0?'port_lifeboats':'starboard_lifeboats',side*0.445,0,0.085,0.65,1,8,3,6,['lifeboat'],deckY,1,{w:Math.min(B*0.065,3),d:Math.min(L*0.055,10),h:Math.min(B*0.15,3)});
  if(cabins.length && !small && !['capsule','cockpit','coachroof','wood'].includes(cabinStyle)) {
    const c=cabins[0];
    const kinds=v.purpose==='military'?['radar','phased_array','satcom']:['radar','satcom'];
    zone('roof_sensors',c.x/B,c.z/L,c.w/B*0.6,c.d/L*0.6,2,2,1,v.purpose==='military'?4:2,kinds,c.y+c.h);
  }
  return {hull,cabinStyle,mission,deckY,deckWidth,cabins,reserved,zones,equipment};
}
