// Metres, years, knots; displacement is metric tonnes, never GT or DWT.
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


export const VESSEL_MATERIALS = {steel:'船用鋼',wood:'木材',composite:'纖維複合材',rubber:'充氣橡膠／織物',aluminium:'鋁合金'};

export const VESSEL_AXES = {
  purpose: { fishing: '漁業', industry: '工業', transport: '運輸', private: '私人', tourism: '觀光', science: '科學', military: '軍事', sport: '運動競技', rescue: '救援', heritage: '歷史文化' },
  waters: { lake: '湖泊', river: '河川', inlandSea: '內海', ocean: '遠洋', coastal: '淺海', seabed: '海底', ice: '冰區' },
  power: { human: '人力', animal: '岸上畜力拖曳', wind: '風帆', steam: '蒸氣', diesel: '柴油', petrol: '汽油', nuclear: '核動力', electric: '電池電力', hybrid: '柴油電力混合', tow: '拖船牽引' },
};

// Each archetype owns its compatible axes, proportions and equipment.
// Ranges are broad game-design envelopes, not certified naval specifications.
const rows = [
  ['skiff','沿岸漁艇','fishing','lake river coastal','human petrol', [4,10],[3,4],[0.035,0.06],[0,35],[2,12], 'nets', 'wood'],
  ['trawler','拖網漁船','fishing','coastal inlandSea ocean','diesel', [18,65],[3,4.5],[0.06,0.09],[0,45],[6,14], 'nets crane', 'steel'],
  ['tug','港勤拖船','industry','river inlandSea coastal','diesel hybrid', [15,35],[2.5,3.5],[0.09,0.13],[0,45],[5,13], 'fenders tow', 'steel'],
  ['dredger','疏浚工程船','industry','river coastal','diesel', [25,90],[3,5],[0.035,0.065],[0,50],[3,10], 'crane pipe', 'steel'],
  ['barge','平底駁船','transport','river lake inlandSea','tow', [20,95],[3,6],[0.025,0.045],[0,50],[2,7], 'cargo', 'steel'],
  ['container','貨櫃輪','transport','inlandSea ocean','diesel', [65,300],[5,7],[0.04,0.06],[0,35],[12,24], 'containers', 'steel'],
  ['tanker','液貨輪','transport','inlandSea ocean','diesel', [70,280],[5,6.5],[0.045,0.065],[0,35],[10,17], 'tanks pipe', 'steel'],
  ['ferry','渡輪','transport','lake river inlandSea coastal','diesel electric hybrid', [12,70],[3,5],[0.035,0.065],[0,40],[7,22], 'passengers', 'steel'],
  ['yacht','私人遊艇','private','lake coastal inlandSea','petrol diesel', [8,35],[3,4.5],[0.04,0.065],[0,35],[8,28], 'lounge', 'composite'],
  ['sloop','單桅帆船','private','lake coastal ocean','wind', [6,22],[3,4.5],[0.08,0.14],[0,50],[3,10], 'sail', 'composite'],
  ['excursion','觀光遊船','tourism','lake river inlandSea coastal','electric diesel', [12,50],[3,4.5],[0.035,0.06],[0,40],[5,15], 'passengers canopy', 'steel'],
  ['liner','遠洋郵輪','tourism','ocean inlandSea','diesel hybrid', [100,320],[5,7],[0.03,0.045],[0,40],[14,23], 'passengers lifeboats', 'steel'],
  ['research','海洋調查船','science','coastal ocean','diesel hybrid', [25,85],[3.8,5.5],[0.055,0.085],[0,45],[7,15], 'crane radar lab', 'steel'],
  ['submersible','海底研究潛器','science','seabed','electric', [3,9],[1.8,3],[0.1,0.16],[0,25],[1,4], 'sub lamp manipulator', 'steel'],
  ['patrol','巡邏艇','military','river coastal inlandSea','diesel', [12,45],[3.5,5],[0.045,0.075],[0,35],[12,32], 'radar gun', 'steel'],
  ['frigate','巡防艦','military','ocean inlandSea','diesel hybrid', [85,150],[7,9],[0.035,0.05],[0,40],[15,30], 'radar gun helipad', 'steel'],
  ['submarine','核動力潛艦','military','ocean seabed','nuclear', [75,150],[8,11],[0.05,0.075],[0,40],[8,25], 'sub tower', 'steel'],
  ['kayak','競技獨木舟','sport','lake river coastal','human', [3,6],[6,9],[0.025,0.04],[0,15],[2,7], 'oars', 'composite'],
  ['racing','競速快艇','sport','lake coastal inlandSea','petrol', [5,13],[3,5],[0.03,0.05],[0,20],[20,55], 'racing', 'composite'],
  ['rescue','全天候救援艇','rescue','coastal inlandSea','diesel', [10,20],[3,4],[0.045,0.07],[0,30],[12,28], 'radar', 'composite'],
  ['paddlesteamer','明輪蒸汽遊船','heritage','lake river','steam', [18,65],[4,6],[0.025,0.04],[10,110],[4,10], 'passengers paddle', 'wood'],
  ['towboat','畜力運河船','heritage','river','animal', [8,22],[4,7],[0.025,0.04],[5,80],[1,3], 'tow cargo', 'wood'],
  ['junk','傳統帆船','heritage','coastal inlandSea','wind', [12,35],[3,4],[0.045,0.07],[5,90],[3,9], 'sail cargo', 'wood'],
  ['icebreaker','極地破冰船','science','ice ocean','diesel nuclear', [70,160],[4,5],[0.055,0.08],[0,50],[5,18], 'radar lab', 'steel'],
  ['inflatable','充氣救生艇','rescue','lake river coastal','petrol',[4,6],[2.2,2.8],[0.025,0.04],[0,12],[8,22],'outboard','rubber'],
  ['rib','硬底充氣救援艇','rescue','coastal inlandSea','petrol',[6,10],[2.8,3.5],[0.035,0.05],[0,20],[15,35],'outboard','rubber'],
  ['lifeboat','封閉式逃生艇','rescue','coastal ocean','diesel',[6,12],[2.5,3.4],[0.04,0.06],[0,25],[4,8],'enclosed','composite'],
  ['canoe','開放式獨木舟','private','lake river','human',[3.5,6],[4.5,6.5],[0.025,0.04],[0,35],[2,5],'oars','wood'],
  ['rowboat','鋁製划艇','private','lake river','human',[3,5],[2.5,3.5],[0.025,0.045],[0,30],[2,5],'oars','aluminium'],
  ['lng','球罐 LNG 運輸船','transport','ocean inlandSea','diesel hybrid',[180,300],[5,6.5],[0.035,0.055],[0,35],[12,20],'gas','steel'],
  ['lng_membrane','薄膜式 LNG 運輸船','transport','ocean inlandSea','diesel hybrid',[180,300],[5,6.5],[0.035,0.055],[0,35],[12,20],'gas','steel'],
  ['bulk','散裝貨輪','transport','ocean inlandSea','diesel',[80,280],[5,7],[0.04,0.065],[0,35],[10,16],'bulk','steel'],
  ['general_cargo','雜貨船','transport','coastal ocean','diesel',[35,150],[4,6],[0.035,0.06],[0,40],[8,17],'cargo','steel'],
  ['roro','滾裝貨輪','transport','coastal ocean','diesel',[80,220],[4.5,6],[0.035,0.055],[0,35],[12,22],'vehicles','steel'],
  ['cable','海底電纜船','industry','ocean coastal','diesel hybrid',[60,140],[4,6],[0.045,0.065],[0,40],[8,16],'cable','steel'],
  ['corvette','護衛艦','military','coastal inlandSea ocean','diesel',[55,100],[6,8],[0.035,0.055],[0,35],[15,28],'radar helipad','steel'],
  ['destroyer','飛彈驅逐艦','military','ocean inlandSea','diesel hybrid',[140,190],[7,9],[0.035,0.05],[0,40],[16,32],'radar helipad','steel'],
  ['cruiser','飛彈巡洋艦','military','ocean','diesel',[170,230],[7,9],[0.035,0.05],[0,40],[16,32],'radar helipad','steel'],
  ['carrier','大型航空母艦','military','ocean','nuclear',[260,330],[6.5,8],[0.03,0.045],[0,50],[18,30],'radar flightdeck','steel'],
  ['light_carrier','輕型航空母艦','military','ocean inlandSea','diesel hybrid',[170,250],[6,8],[0.03,0.045],[0,40],[15,28],'radar flightdeck','steel'],
  ['amphibious','兩棲突擊艦','military','ocean coastal','diesel',[160,250],[5.5,7],[0.03,0.045],[0,40],[12,24],'radar flightdeck','steel'],
  ['missile_boat','飛彈快艇','military','coastal inlandSea','diesel',[30,55],[5,7],[0.035,0.055],[0,30],[18,36],'radar','aluminium'],
  ['minesweeper','獵雷艦','military','coastal inlandSea','diesel',[35,65],[5,7],[0.04,0.06],[0,35],[8,16],'radar','composite'],
];
const displacement = (length,beam,draft,coefficient) => length*beam*draft*coefficient*1.025;
export const VESSEL_TYPES = rows.map(([id,name,purpose,waters,power,length,slenderness,draftRatio,age,speed,parts,material]) => {
  const coefficient = parts.split(' ').includes('sub') ? 0.65
    : ['skiff','kayak','sloop','junk','racing'].includes(id) ? 0.2
    : ['barge','towboat'].includes(id) ? 0.8
    : ['container','tanker'].includes(id) ? 0.7 : 0.48;
  return {
    id,name,purpose,waters:waters.split(' '),power:power.split(' '),length,slenderness,draftRatio,age,speed,parts:parts.split(' '),material,coefficient,
    displacementRange:[
      displacement(length[0],length[0]/slenderness[1],length[0]*draftRatio[0],coefficient),
      displacement(length[1],length[1]/slenderness[0],length[1]*draftRatio[1],coefficient),
    ],
  };
});
const palettes = {
  steel: [0x254c65,0x38796f,0xa64232,0xd7d9cc,0xd29d38],
  wood: [0x79503b,0xa77949,0x466e70,0x843f32],
  composite: [0xf2eee0,0x248ca3,0xdd493a,0xedbd34],
  rubber: [0xe76f21,0xe99a26,0x313b40],
  aluminium: [0xaebfc1,0x889eaa,0xd1d7cd],
};
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const range = (r, [a,b]) => a + r() * (b-a);

export function generateVessel(seed, filters = {}) {
  if (!Number.isFinite(seed)) throw new TypeError('Vessel seed must be finite');
  const r = mulberry32((seed ^ 0x53a971b7) >>> 0);
  const choices = VESSEL_TYPES.filter(t => (!filters.id || t.id === filters.id)
    && (!filters.purpose || t.purpose === filters.purpose)
    && (!filters.water || t.waters.includes(filters.water))
    && (!filters.power || t.power.includes(filters.power))
    && (!filters.maxLength || t.length[1] <= filters.maxLength)
    && (!filters.selfPropelled || !t.power.every(p => ['animal','tow'].includes(p)))
    && (!filters.surface || !t.parts.includes('sub')));
  if (!choices.length) return null;
  const t = pick(r, choices), length = range(r,t.length), beam = length / range(r,t.slenderness);
  const draft = length * range(r,t.draftRatio), age = Math.floor(range(r,t.age));
  const power = filters.power || pick(r,t.power);
  const wear = Math.min(0.85, age / 100 + r() * 0.2);
  const parts = [...t.parts];
  if (length > 10 && !parts.includes('sub') && r() < 0.45 && !parts.includes('fenders')) parts.push('fenders');
  if (t.purpose === 'private' && power !== 'wind' && r() < 0.5) parts.push('radar');
  const vessel = {
    type:t.id, name:t.name, purpose:t.purpose, waters:[...t.waters], power, material:t.material,
    length, beam, draft, freeboard: Math.max(0.18, beam * 0.22),
    displacementTonnes: displacement(length,beam,draft,t.coefficient),
    age, wear, speedKnots:Math.min(range(r,t.speed),power==='human'?7:power==='animal'?3:Infinity), parts,
    hullColor:t.purpose === 'military' ? pick(r,[0x68777a,0x505f63,0x384950]) : pick(r,palettes[t.material]),
    trimColor:pick(r,[0xeee7d2,0xf4ab32,0x3b7d97]),
    flag:{ kind:'fictional', pattern:pick(r,['bands','cross','diagonal']), colors:[pick(r,[0xdf4936,0x287596,0xe8b844]),0xf4eee0] },
    registry:`SV-${Math.floor(r()*90000+10000)}`,
    vesselName:pick(r,['AURORA','TIDEBIRD','HORIZON','CORAL','NORTH STAR','BLUE FIN']),
    graffiti: t.purpose !== 'military' && r() < 0.3 ? pick(r,['SEA YOU','KEEP SAILING','WAVE RIDER']) : '',
    decorationSeed:Math.floor(r()*0xffffffff),
  };
  vessel.layout = planVesselLayout(vessel);
  return vessel;
}

// Conservative swept circle: checks water, under-keel clearance and map bounds.
export function vesselFitsAt(v, terrain, x, z, isWater) {
  const radius = Math.hypot(v.length / 2, Math.max(v.beam,v.layout?.deckWidth??v.beam) / 2) + 1;
  const needed = v.draft + (v.parts.includes('sub') ? v.beam * 1.1 + 2.5 : 0.5);
  for (let ring = 0; ring <= 2; ring++) {
    const n = ring ? Math.max(16, Math.ceil(2 * Math.PI * radius * ring / 2 / 3)) : 1;
    for (let i = 0; i < n; i++) {
      const a = i/n*Math.PI*2, px=x+Math.cos(a)*radius*ring/2, pz=z+Math.sin(a)*radius*ring/2;
      if (px < terrain.minX || px > terrain.maxX || pz < terrain.minZ || pz > terrain.maxZ) return false;
      const depth = terrain.waterY-terrain.heightAt(px,pz);
      if (!Number.isFinite(depth) || depth < needed || !isWater(px,pz)) return false;
    }
  }
  return true;
}
