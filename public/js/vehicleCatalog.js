// 陸上載具的用途／結構相容表。所有數值是遊戲美術範圍，不是工程規格。
import { mulberry32 } from './rng.js';
import { partAABB } from './vehicles.js';
import { industryProfiles, INDUSTRY_PART_NAMES } from './vehicleIndustry.js';
import { buildIndustryEquipment } from './vehicleEquipment.js';

export const VEHICLE_PREFIX = 'vehicle/';
export const RAIL_GAUGE = 1.435;
export const VEHICLE_PART_NAMES = {basket:'前籃',panniers:'側袋',crate:'貨箱',canopy:'篷頂',rack:'行李架',taxi:'計程車頂燈',spoiler:'尾翼',lamps:'輔助燈',sensor:'感測器',hitch:'拖曳鉤',header:'收割台',logs:'原木與固定樁',livestock:'通風牲畜艙',fork:'升降桅桿與貨叉',boom:'動臂與挖斗',cargo:'貨廂',beacon:'警示燈',brush:'清掃刷',antenna:'通訊天線',turret:'砲塔',chimney:'煙囪'};
export const VEHICLE_AXES = {
  purpose: { agriculture: '農業', livestock: '畜牧', forestry: '林業', industry: '工業', freight: '貨運', private: '私人', passenger: '載人', tourism: '觀光', science: '科學', military: '軍事', sport: '運動競技', rescue: '救援', municipal: '市政' },
  type: { twoWheel: '兩輪', threeWheel: '三輪', fourWheel: '四輪', heavy: '大型多軸', offroad: '越野', tracked: '履帶', rail: '鐵道' },
  power: { human: '人力', animal: '獸力牽引', steam: '蒸氣', petrol: '汽油', diesel: '柴油', battery: '電池電力', overhead: '架空供電', hybrid: '油電混合', hydrogen: '氫燃料電池' },
};
Object.assign(VEHICLE_PART_NAMES, INDUSTRY_PART_NAMES);
Object.assign(VEHICLE_AXES.purpose,{government:'政府公務',police:'警政司法',construction:'建築土木',water:'水利供水',mining:'礦業',energy:'能源',utilities:'電力通訊',food:'食品餐飲',commerce:'民生商業',waste:'環衛廢棄物',medical:'醫療衛生',education:'教育文化',aviation:'航空地勤'});
Object.assign(VEHICLE_AXES.type,{trailer:'半拖車'});
Object.assign(VEHICLE_AXES.power,{towed:'無動力・牽引'});
const row = (name, purpose, type, powers, form, length, widthRatio, heightRatio, age, parts, habitat) =>
  ({ name, purpose, type, powers, form, length, widthRatio, heightRatio, age, parts, habitat });
export const VEHICLE_PROFILES = {
  bicycle: row('通勤自行車', ['private', 'sport'], 'twoWheel', ['human', 'battery'], 'cycle', [1.6, 1.95], .32, .59, [0, 25], ['basket', 'panniers'], ['street', 'park']),
  cargoTrike: row('載貨三輪車', ['freight', 'agriculture'], 'threeWheel', ['human', 'battery'], 'trike', [2.1, 2.8], .46, .5, [0, 25], ['crate'], ['street', 'farm']),
  motorcycle: row('道路機車', ['private', 'passenger'], 'twoWheel', ['petrol', 'battery'], 'motor', [1.8, 2.3], .35, .55, [0, 25], ['panniers'], ['street']),
  raceBike: row('競賽自行車', ['sport'], 'twoWheel', ['human'], 'cycle', [1.7, 1.9], .26, .55, [0, 8], [], ['track']),
  handcart: row('手推貨車', ['freight', 'industry'], 'twoWheel', ['human'], 'cart', [1.2, 1.8], .62, .6, [0, 30], ['crate'], ['yard']),
  carriage: row('畜力觀光馬車', ['tourism', 'passenger'], 'fourWheel', ['animal'], 'carriage', [3.0, 4.2], .48, .62, [0, 80], ['canopy'], ['heritage', 'farm']),
  sedan: row('家庭轎車', ['private', 'passenger'], 'fourWheel', ['petrol', 'battery', 'hybrid'], 'sedan', [4.1, 4.9], .4, .31, [0, 35], ['rack'], ['street']),
  taxi: row('計程車', ['passenger'], 'fourWheel', ['petrol', 'hybrid', 'battery'], 'sedan', [4.3, 4.9], .4, .34, [0, 15], ['taxi'], ['street']),
  rally: row('拉力賽車', ['sport'], 'offroad', ['petrol', 'hybrid'], 'sedan', [3.9, 4.5], .43, .37, [0, 12], ['spoiler', 'lamps'], ['track', 'trail']),
  rover: row('野外科考車', ['science'], 'offroad', ['diesel', 'battery', 'hybrid'], 'utility', [4.2, 5.6], .42, .49, [0, 25], ['sensor', 'rack'], ['trail', 'research']),
  tractor: row('農用曳引機', ['agriculture', 'livestock'], 'offroad', ['diesel', 'battery'], 'tractor', [3.0, 4.8], .55, .62, [0, 45], ['hitch'], ['farm']),
  harvester: row('聯合收割機', ['agriculture'], 'heavy', ['diesel'], 'harvester', [6, 8.5], .7, .51, [0, 35], ['header'], ['farm']),
  logger: row('林業集材車', ['forestry', 'freight'], 'heavy', ['diesel'], 'truck', [8, 11], .3, .36, [0, 35], ['logs'], ['forest', 'yard']),
  livestock: row('牲畜運輸車', ['livestock', 'freight'], 'heavy', ['diesel'], 'truck', [7, 10], .32, .39, [0, 25], ['livestock'], ['farm', 'yard']),
  forklift: row('堆高機', ['industry', 'freight'], 'fourWheel', ['battery', 'diesel'], 'forklift', [2.5, 3.8], .46, .8, [0, 25], ['fork'], ['yard']),
  excavator: row('履帶挖掘機', ['industry', 'construction'], 'tracked', ['diesel', 'battery'], 'excavator', [5, 8], .42, .57, [0, 35], ['boom'], ['construction']),
  truck: row('箱式物流貨車', ['freight'], 'heavy', ['diesel', 'battery', 'hydrogen'], 'truck', [7, 12], .25, .34, [0, 25], ['cargo'], ['street', 'yard']),
  bus: row('市區巴士', ['passenger'], 'heavy', ['diesel', 'battery', 'hybrid', 'hydrogen'], 'bus', [9, 12], .23, .3, [0, 20], [], ['street']),
  tourBus: row('觀光巴士', ['tourism', 'passenger'], 'heavy', ['diesel', 'battery'], 'bus', [9, 12], .23, .32, [0, 25], ['rack'], ['street']),
  ambulance: row('救護車', ['government', 'medical', 'rescue'], 'fourWheel', ['diesel', 'battery'], 'utility', [4.8, 6], .4, .46, [0, 15], ['beacon','medicalCabin'], ['street']),
  sweeper: row('道路清掃車', ['government', 'municipal', 'waste'], 'fourWheel', ['diesel', 'battery'], 'utility', [3, 4.5], .46, .55, [0, 20], ['brush'], ['street']),
  armored: row('裝甲運兵車', ['military', 'passenger'], 'heavy', ['diesel'], 'armor', [6, 8], .41, .38, [0, 45], ['antenna'], ['base']),
  tank: row('履帶戰車', ['military'], 'tracked', ['diesel'], 'tank', [7, 9], .46, .35, [0, 55], ['turret'], ['base']),
  tram: row('電力軌道車', ['passenger'], 'rail', ['overhead'], 'railcar', [14, 21], .15, .2, [0, 45], [], ['rail']),
  dieselRail: row('柴油客運車', ['passenger', 'tourism'], 'rail', ['diesel'], 'railcar', [16, 22], .145, .2, [0, 50], [], ['rail']),
  steam: row('保存型蒸汽機車', ['tourism'], 'rail', ['steam'], 'steam', [10, 15], .23, .32, [40, 130], ['chimney'], ['heritageRail']),
  ...industryProfiles(row),
};
const PAINT = {
  civilian: [0xddd8c9, 0x344a61, 0x8c3332, 0x497769, 0xd5a945, 0x42464b],
  work: [0xc88d22, 0xd0a938, 0x437749, 0xb94e30], military: [0x515d40, 0x807951, 0x626b62],
  rescue: [0xf0eee4, 0xe4d9b5], sport: [0xe05036, 0x427fa9, 0xf0c42f],
};
const COPIES = { agriculture: 'FIELD', livestock: 'FARM', forestry: 'TIMBER', industry: 'WORKS', freight: 'CARGO', private: '', passenger: 'TRANSIT', tourism: 'TOUR', science: 'SURVEY', military: 'UNIT', sport: 'RACING', rescue: 'RESCUE', municipal: 'CITY' };
Object.assign(COPIES,{government:'PUBLIC',police:'POLICE',construction:'BUILD',water:'WATER',mining:'MINING',energy:'ENERGY',utilities:'SERVICE',food:'FOOD',commerce:'DELIVERY',waste:'SANITATION',medical:'MEDICAL',education:'LIBRARY',aviation:'AIRPORT'});
const choose = (rng, values) => values[Math.floor(rng() * values.length)];
const between = (rng, [min, max]) => min + rng() * (max - min);
const tint = (color, amount) => {
  const channel = shift => Math.round(((color >>> shift) & 255) * amount);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
};

/** 篩選交集；沒有合理組合就回空陣列，禁止隨機退回別種車。 */
export function vehicleCandidates(filters = {}) {
  for (const axis of ['purpose', 'type', 'power']) {
    if (filters[axis] != null && !Object.hasOwn(VEHICLE_AXES[axis], filters[axis])) throw new RangeError(`未知載具分類:${axis}`);
  }
  return Object.keys(VEHICLE_PROFILES).filter(key => {
    const p = VEHICLE_PROFILES[key];
    return (!filters.purpose || p.purpose.includes(filters.purpose)) && (!filters.type || p.type === filters.type)
      && (!filters.power || p.powers.includes(filters.power)) && (!filters.habitat || p.habitat.includes(filters.habitat));
  });
}

export function generateVehicle(key, seed = 0, options = {}) {
  if (!Object.hasOwn(VEHICLE_PROFILES, key)) throw new RangeError(`未知車型:${key}`);
  if (!Number.isSafeInteger(seed)) throw new TypeError('載具 seed 必須是安全整數');
  const spec = VEHICLE_PROFILES[key];
  if (!vehicleCandidates(options).includes(key)) throw new RangeError(`不相容的載具組合:${key}`);
  const r = mulberry32(seed ^ 0x56454849);
  const purpose = options.purpose || choose(r, spec.purpose), power = options.power || choose(r, spec.powers);
  const length = between(r, spec.length), width = length * spec.widthRatio, height = length * spec.heightRatio;
  const age = Math.floor(between(r, [spec.age[0], spec.age[1] + 1]));
  const maintenance = between(r, [.3, 1]);
  const wear = Math.min(.85, (age / (spec.age[1] || 1)) * (1 - maintenance) + r() * .07);
  const palette = purpose === 'military' ? 'military' : purpose === 'rescue' ? 'rescue' : purpose === 'sport' ? 'sport'
    : ['agriculture', 'livestock', 'forestry', 'industry', 'municipal'].includes(purpose) ? 'work' : 'civilian';
  let paint = choose(r, PAINT[palette]);
  if (['ladderTruck','fireEngine'].includes(key)) paint=choose(r,[0xa8372f,0xc74530]);
  if (['ambulance','mobileClinic'].includes(key)) paint=0xe9e9dc;
  if(key==='police'||key==='prisoner')paint=0x34475e;
  const graffitiChance = spec.purpose.some(p=>['military','government','medical','rescue','sport'].includes(p)) ? 0 : .12;
  const graffiti = r() < graffitiChance ? choose(r, ['HI', 'GO!', 'NOVA', '自由']) : '';
  const number = String(1 + Math.floor(r() * 999)).padStart(3, '0');
  // 功能件必裝，便利件獨立抽樣；動力硬體由 power 決定。
  const parts = spec.parts.filter(part => !['rack', 'basket', 'panniers', 'canopy'].includes(part) || r() < .6);
  return { key, seed, name: spec.name, purpose, type: spec.type, power, form: spec.form, habitat: spec.habitat,
    length, width, height, age, maintenance, wear, paint, fadedPaint: tint(paint, 1 - wear * .25),
    dust: r() * (spec.habitat.includes('street') ? .25 : .65), graffiti, lettering: COPIES[purpose], number, parts,
    coupling:spec.form==='railWagon'||spec.form==='railLocomotive'?{system:'rail',height:.85,gauge:RAIL_GAUGE}
      :spec.form==='semiTrailer'||spec.form==='tractorUnit'?{system:'fifthWheel',height:1.2}:null };
}

/** +X 車頭、地面原點。零件先在公稱盒內生成，再由宿主決定權威 fit。 */
export function vehicleBackgroundObject(key, seed = 0, options = {}) {
  const v = generateVehicle(key, seed, options);
  const { length: L, width: W, height: H } = v;
  const paint = v.fadedPaint, dark = 0x252b30, glass = 0x304959, steel = 0x8d969b;
  const rows = [], plates = [];
  const box = (name, x, y, z, l, h, w, c = paint, rotation) => rows.push({ role: name, g: ['box', l, h, w], p: [x, y, z], c, ...(rotation ? { r: rotation } : {}) });
  const cyl = (name, x, y, z, radius, depth, c, rotation = [Math.PI / 2, 0, 0]) => rows.push({ role: name, g: ['cyl', radius, radius, depth, 12], p: [x, y, z], c, r: rotation });
  const beam = (name, a, b, radius, color = steel) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    box(name, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a[2], Math.hypot(dx, dy), radius, radius, color, [0, 0, Math.atan2(dy, dx)]);
  };
  const wheel = (x, radius, z, depth = W * .12) => {
    if (['cycle','trike'].includes(v.form)) {
      // 18 段圓環旋轉 90°，讓一個取樣頂點精確落在最低點。
      rows.push({role:'tire',g:['ring',radius*.94,radius*.06],p:[x,radius,z],r:[0,0,Math.PI/2],c:dark});
      cyl('hub',x,radius,z,radius*.1,depth,steel);
      for(let i=0;i<6;i++) {
        const angle=i*Math.PI/3;
        beam('spoke',[x,radius,z],[x+Math.cos(angle)*radius*.9,radius+Math.sin(angle)*radius*.9,z],radius*.025);
      }
      return;
    }
    cyl('tire', x, radius, z, radius, depth, dark);
    cyl('rim', x, radius, z, radius * .5, depth * 1.04, steel);
  };
  const cab = (x, y, l, h, w = W * .82, z = 0) => {
    box('cab', x, y, z, l, h, w);
    box('cab_mount',x,y-h*.5-H*.02,z,l*.84,H*.06,w*.8,dark);
    box('glazing', x, y + h * .12, z, l * .88, h * .55, w * 1.005, glass);
    box('front_windshield', x+l*.502, y+h*.12, z, l*.008, h*.55, w*.84, glass);
    box('windshield_divider', x+l*.507, y+h*.12, z, l*.01, h*.56, w*.025);
    for (const side of [-1, 1]) box('pillar', x, y + h * .12, z + side * w * .502, l * .04, h * .65, W * .025);
  };
  if (v.form === 'sedan') {
    for(const x of [-.31,.31]) for(const side of [-1,1]) wheel(L*x,H*.21,side*W*.43,W*.12);
    box('floor',0,H*.29,0,L*.87,H*.09,W*.78,dark);
    box('body',0,H*.48,0,L*.96,H*.3,W*.91);
    box('hood',L*.31,H*.66,0,L*.3,H*.08,W*.85);
    box('trunk',-L*.36,H*.65,0,L*.22,H*.08,W*.85);
    cab(-L*.05,H*.78,L*.43,H*.37,W*.77);
    for(const [x,angle] of [[.195,.55],[-.295,-.5]]) {
      box('raked_glass',L*x,H*.79,0,L*.016,H*.36,W*.74,glass,[0,0,angle]);
    }
    for(const side of [-1,1]) {
      box('door_handle',-L*.06,H*.58,side*W*.458,L*.047,H*.018,W*.012,steel);
      box('mirror',L*.14,H*.75,side*W*.455,L*.045,H*.055,W*.08,dark);
      box('mirror_mount',L*.14,H*.75,side*W*.405,L*.035,H*.035,W*.12,dark);
      for(const x of [-.31,.31]) box('wheel_arch',L*x,H*.45,side*W*.454,L*.17,H*.055,W*.055,dark);
    }
  } else if (v.form === 'truck' || v.form === 'tractorUnit') {
    for(const x of [-.34,-.18,.34]) for(const side of [-1,1]) wheel(L*x,H*.13,side*W*.41,W*.17);
    box('ladder_chassis',0,H*.28,0,L*.94,H*.12,W*.65,dark);
    cab(L*.34,H*.64,L*.27,H*.65,W*.86);
    box('cab_step',L*.32,H*.27,0,L*.27,H*.08,W*.92,steel);
    for(const side of [-1,1]) {
      box('mirror_arm',L*.39,H*.78,side*W*.445,L*.055,H*.025,W*.09,steel);
      box('mirror',L*.4,H*.76,side*W*.475,L*.04,H*.11,W*.03,dark);
    }
  } else if (v.form === 'railWagon' || v.form === 'railLocomotive') {
    box('rail_frame',0,H*.28,0,L*.93,H*.11,W*.87,dark);
    box('rail_deck',0,H*.335,0,L*.93,H*.035,W*.87,steel);
    for(const bogie of [-.33,.33]) {
      box('bogie',L*bogie,H*.17,0,L*.17,H*.1,RAIL_GAUGE,dark);
      box('bogie_bolster',L*bogie,H*.225,0,L*.1,H*.045,RAIL_GAUGE*.8,steel);
      for(const delta of [-.05,.05])for(const s of [-1,1])wheel(L*(bogie+delta),H*.1,s*RAIL_GAUGE/2,W*.07);
    }
    for(const end of [-1,1]) {
      box('rail_coupler',end*L*.49,.85,0,L*.05,H*.04,W*.12,steel);
      box('coupler_draft_mount',end*L*.445,(.85+H*.28)/2,0,L*.07,Math.abs(H*.28-.85)+H*.05,W*.2,dark);
    }
    if(v.form==='railLocomotive') {
      box('engine_hood',-L*.08,H*.53,0,L*.66,H*.42,W*.71);
      cab(L*.31,H*.66,L*.25,H*.55,W*.87);
      for(let i=0;i<8;i++)for(const s of [-1,1])box('engine_louver',L*(-.34+i*.07),H*.58,s*W*.36,L*.025,H*.2,W*.012,dark);
      if(v.power==='overhead') {
        box('pantograph_base',-L*.1,H*.758,0,L*.24,H*.055,W*.4,steel);
        beam('pantograph',[-L*.2,H*.77,0],[-L*.1,H*1.04,0],W*.03,steel);
        beam('pantograph',[-L*.1,H*1.04,0],[0,H*.8,0],W*.03,steel);
        box('contact_shoe',-L*.1,H*1.04,0,L*.03,H*.025,W*.63,dark);
      }
    }
  } else if (v.form === 'semiTrailer') {
    box('trailer_frame',0,H*.29,0,L*.94,H*.09,W*.87,dark);
    for(const x of [-.35,-.23,-.11])for(const s of [-1,1])wheel(L*x,H*.135,s*W*.41,W*.14);
    box('gooseneck',L*.34,1.3,0,L*.27,H*.06,W*.65,dark);
    cyl('kingpin',L*.36,1.2,0,W*.035,H*.065,steel,[0,0,0]);
    for(const s of [-1,1])box('parking_leg',L*.2,H*.22,s*W*.3,W*.055,H*.29,W*.055,steel);
  } else if (v.form === 'van' || v.form === 'pickup') {
    for(const x of [-.32,.32])for(const s of [-1,1])wheel(L*x,H*.17,s*W*.41,W*.14);
    box('chassis',0,H*.32,0,L*.94,H*.12,W*.86);
    cab(L*.25,H*.65,L*.4,H*.55,W*.85);
    if(v.form==='van')box('van_body',-L*.18,H*.62,0,L*.54,H*.6,W*.88);
  } else if (v.form === 'roller') {
    for(const x of [-.3,.3])cyl('steel_drum',L*x,H*.2,0,H*.2,W*.88,steel);
    box('roller_frame',0,H*.43,0,L*.79,H*.14,W*.64);
    cab(-L*.06,H*.71,L*.34,H*.46,W*.62);
  } else if (v.form === 'railcar') {
    box('underframe',0,H*.25,0,L*.97,H*.13,W*.87,dark);
    for(const bogie of [-.32,.32]) {
      box('bogie',L*bogie,H*.18,0,L*.17,H*.12,W*.69,dark);
      for(const delta of [-.052,.052]) for(const side of [-1,1]) wheel(L*(bogie+delta),H*.105,side*RAIL_GAUGE/2,W*.1);
    }
    box('carriage_body',0,H*.57,0,L*.94,H*.59,W*.94);
    box('roof',0,H*.9,0,L*.93,H*.07,W*.91,steel);
    for(const side of [-1,1]) {
      for(let i=0;i<10;i++) box('passenger_window',L*(-.395+i*.088),H*.7,side*W*.472,L*.062,H*.19,W*.005,glass);
      for(const x of [-.29,.29]) {
        box('passenger_door',L*x,H*.51,side*W*.475,L*.065,H*.43,W*.012,steel);
        box('door_glass',L*x,H*.65,side*W*.482,L*.05,H*.15,W*.006,glass);
      }
    }
    for(const side of [-1,1]) box('cab_windshield',side*L*.472,H*.7,0,L*.005,H*.21,W*.71,glass);
    if(v.power==='overhead') {
      beam('pantograph',[-L*.1,H*.93,0],[0,H*1.08,0],W*.025,steel);
      beam('pantograph',[0,H*1.08,0],[L*.1,H*.96,0],W*.025,steel);
      box('contact_shoe',0,H*1.08,0,L*.025,H*.025,W*.66,dark);
    }
  } else if (['cycle', 'motor', 'trike'].includes(v.form)) {
    const R = H * .29, rear = -L * .31, front = L * .31;
    wheel(front, R, 0, W * .13);
    for (const z of v.form === 'trike' ? [-W * .36, W * .36] : [0]) wheel(rear, R, z, W * .13);
    const a = [rear, R, 0], b = [-L * .02, H * .77, 0], c = [L * .07, R, 0], d = [L * .26, H * .8, 0];
    for (const [p, q] of [[a,b],[b,c],[c,a],[b,d],[c,d],[d,[front,R,0]]]) beam('frame', p, q, W * .06, paint);
    box('saddle', b[0], b[1], 0, L * .17, H * .06, W * .34, dark);
    box('handlebar', d[0], H * .88, 0, L * .025, H * .025, W * .96, steel);
    beam('handlebar_stem',d,[d[0],H*.88,0],W*.04,steel);
    box('pedals', c[0], c[1], 0, L * .06, H * .035, W * .55, dark);
    if (v.form === 'motor') box('engine', 0, H * .44, 0, L * .3, H * .24, W * .42, dark);
    if (v.form === 'trike') box('cargo_bed', rear, H * .62, 0, L * .32, H * .2, W * .68);
  } else if (['cart', 'carriage'].includes(v.form)) {
    const R = H * .23;
    for (const x of v.form === 'cart' ? [-L * .1] : [-L * .31, L * .23]) for (const side of [-1, 1]) wheel(x, R, side * W * .42);
    box('wooden_bed', -L * .08, H * .52, 0, L * .64, H * .12, W * .76, 0x8c6542);
    for (const side of [-1, 1]) {
      box('side_board', -L * .08, H * .66, side * W * .35, L * .64, H * .2, W * .055, 0x8c6542);
      box(v.power === 'animal' ? 'drawbar' : 'handle', L * .32, H * .45, side * W * .24, L * .35, H * .035, W * .04, steel);
    }
    if (v.form === 'carriage') for (const x of [-.25, .1]) box('bench', L*x, H*.69, 0, L*.13, H*.1, W*.65, dark);
  } else if (v.form === 'steam') {
    box('chassis', 0, H*.25, 0, L*.95, H*.12, W*.82, dark);
    for (const x of [-.31,-.1,.12,.31]) for (const side of [-1,1]) wheel(L*x,H*.19,side*RAIL_GAUGE/2,W*.14);
    cyl('boiler', L*.1,H*.53,0,W*.31,L*.64,dark,[0,0,Math.PI/2]);
    cab(-L*.33,H*.66,L*.24,H*.48);
    for (const side of [-1,1]) {
      const z=side*(RAIL_GAUGE/2+W*.075);
      box('connecting_rod',0,H*.18,z,L*.68,H*.035,W*.02,steel);
      for(const dx of [-.31,-.1,.12,.31])cyl('rod_crank_pin',L*dx,H*.18,z,W*.035,W*.035,steel);
    }
  } else {
    const tracked = v.type === 'tracked';
    const radius = H * (v.form === 'tractor' ? .24 : .16);
    const axles = v.type === 'heavy' ? [-.33,-.13,.33] : [-.31,.31];
    if (tracked) for (const side of [-1, 1]) {
      box('track', 0, H*.17, side*W*.37, L*.86, H*.32, W*.24,dark);
      for (let i=0;i<6;i++) wheel(L*(-.34+i*.136),H*.13,side*W*.488,W*.035);
    }
    else for (const x of axles) for (const side of [-1,1]) wheel(L*x, v.form==='tractor' && x>0 ? radius*.68 : radius, side*W*.41,W*.16);
    box('chassis',0,H*.35,0,L*.87,H*.16,W*.8);
    if (v.form === 'bus') {
      cab(0,H*.64,L*.94,H*.64,W*.94);
      for(let i=0;i<9;i++) box('window_pillar',L*(-.4+i*.1),H*.75,0,L*.018,H*.36,W*.95);
    } else if (key==='bulldozer' || key==='paver') {
      box('engine_compartment',L*.08,H*.53,0,L*.55,H*.3,W*.65);
      if(key==='bulldozer') {
        cab(-L*.2,H*.81,L*.3,H*.44,W*.65);
        for(const s of [-1,1])beam('blade_push_arm',[-L*.25,H*.25,s*W*.32],[L*.43,H*.2,s*W*.32],W*.09,steel);
        box('rear_ripper_mount',-L*.43,H*.32,0,L*.12,H*.12,W*.56,steel);
      } else {
        box('operator_platform',-L*.2,H*.7,0,L*.38,H*.08,W*.81,steel);
        for(const s of [-1,1]) {
          box('operator_console',-L*.2,H*.82,s*W*.28,L*.14,H*.2,W*.19,dark);
          box('canopy_support',-L*.28,H*.99,s*W*.33,L*.025,H*.56,W*.03,steel);
        }
        box('paver_canopy',-L*.2,H*1.27,0,L*.46,H*.05,W*.86);
      }
    } else if (['armor','tank'].includes(v.form)) {
      box('armored_hull',0,H*.5,0,L*.8,H*.36,W*.8);
      box('hatch',-L*.08,H*.71,0,L*.17,H*.07,W*.28,dark);
    } else if (v.form === 'excavator') {
      cab(-L*.15,H*.65,L*.32,H*.48,W*.4,W*.22);
      box('counterweight',-L*.3,H*.51,-W*.12,L*.29,H*.24,W*.43);
    } else {
      const frontCab = ['utility','forklift'].includes(v.form);
      cab(L*(frontCab ? .23 : -.16),H*.69,L*.3,H*.48);
      if (key === 'ambulance' || key === 'rover') {
        box('equipment_compartment',-L*.19,H*.61,0,L*.48,H*.56,W*.8);
      } else if (v.form === 'harvester') {
        box('grain_hopper',-L*.25,H*.65,0,L*.38,H*.53,W*.8);
      } else {
        box('hood',L*(frontCab ? -.22 : .23),H*.49,0,L*.36,H*.24,W*.65);
      }
    }
  }
  if (['sedan','truck','bus','utility','railcar'].includes(v.form)) {
    for(const end of [-1,1]) {
      box('bumper_mount',end*L*.44,H*.3,0,L*.1,H*.065,W*.48,dark);
      box('lamp_backing',end*L*.475,H*.385,0,L*.018,H*.2,W*.82,dark);
    }
    for(const side of [-1,1]) {
      box('headlamp',L*.477,H*.42,side*W*.3,L*.015,H*.075,W*.16,0xf3e5ae);
      box('tail_lamp',-L*.477,H*.4,side*W*.32,L*.015,H*.07,W*.1,0xb83b32);
    }
    for(const end of [-1,1]) box('bumper',end*L*.48,H*.3,0,L*.025,H*.065,W*.88,dark);
  }
  for (const part of v.parts) {
    if(buildIndustryEquipment(part,v,{box,cyl,beam,frustum:(name,x,y,z,top,bottom,depth,color,rotation)=>rows.push({role:name,g:['cyl',top,bottom,depth,20],p:[x,y,z],c:color,r:rotation})}))continue;
    if (['cargo','livestock'].includes(part)) {
      box('cargo_box',-L*.14,H*.59,0,L*.65,H*.7,W*.92);
      if(part==='livestock') for(let i=0;i<4;i++) box('ventilation',-L*.14,H*(.4+i*.13),0,L*.59,H*.05,W*.925,dark);
    } else if(part==='logs') {
      for(const dx of [-.38,.07])box('log_saddle',L*dx,H*.36,0,L*.055,H*.1,W*.86,steel);
      for(const z of [-.27,0,.27]) cyl('timber',-L*.14,H*.48,z*W,W*.13,L*.63,0x77553a,[0,0,Math.PI/2]);
      for(const x of [-.38,.07]) for(const s of [-1,1]) box('log_stake',L*x,H*.56,s*W*.42,L*.015,H*.45,W*.035,steel);
    } else if(part==='fork') {
      for(const side of [-1,1]) {box('mast',L*.38,H*.53,side*W*.23,L*.05,H*.83,W*.06,dark);box('fork',L*.43,H*.13,side*W*.23,L*.12,H*.03,W*.08,steel);}
    } else if(part==='boom') {
      beam('boom',[-L*.05,H*.55,0],[L*.22,H*.96,0],W*.12,paint);
      beam('stick',[L*.22,H*.96,0],[L*.42,H*.38,0],W*.085,paint);
      box('bucket',L*.4,H*.29,0,L*.16,H*.19,W*.47,dark);
    } else if(part==='turret') {
      box('turret',0,H*.77,0,L*.28,H*.3,W*.47);
      box('barrel',L*.29,H*.8,0,L*.4,H*.06,W*.065,dark);
    } else if(part==='header') {
      box('header',L*.38,H*.22,0,L*.21,H*.15,W*.96,dark);
      for(let i=0;i<9;i++) box('cutter',L*.47,H*.18,W*(-.44+i*.11),L*.05,H*.05,W*.025,steel);
    } else if(part==='chimney') cyl('chimney',L*.3,H*.77,0,W*.09,H*.42,dark,[0,0,0]);
    else if(part==='brush') for(const side of [-1,1]) cyl('brush',L*.3,H*.11,side*W*.34,W*.15,H*.1,dark,[0,0,0]);
    else if(part==='hitch') {
      box('hitch',-L*.45,H*.23,0,L*.09,H*.045,W*.25,steel);
      box('hitch_mount',-L*.41,H*.29,0,L*.06,H*.14,W*.22,steel);
    }
    else if(part==='sensor'||part==='antenna') {
      box('antenna_base',-L*.14,H*.8,0,W*.065,H*.27,W*.065,steel);
      box('antenna',-L*.14,H*.93,0,W*.018,H*.13,W*.018,steel);
      if(part==='sensor') cyl('sensor',-L*.14,H*.98,0,W*.1,H*.03,steel,[0,0,0]);
    } else if(part==='basket'||part==='crate') {
      box(part,-L*.24,H*.79,0,L*.23,H*.23,W*.55,0x9f7950);
      box('cargo_bracket',-L*.24,H*.62,0,L*.18,H*.16,W*.36,steel);
    }
    else if(part==='panniers') {
      box('pannier_carrier',-L*.23,H*.61,0,L*.2,H*.04,W*.66,steel);
      for(const side of [-1,1]) box(part,-L*.23,H*.54,side*W*.32,L*.2,H*.27,W*.22,0x79634d);
    }
    else if(part==='canopy') {
      box(part,-L*.08,H*.96,0,L*.65,H*.04,W*.8,0xd7c8a1);
      for(const x of [-.36,.2]) for(const side of [-1,1]) box('canopy_post',L*x,H*.78,side*W*.35,L*.017,H*.34,W*.025,steel);
    } else if(part==='rack') {
      for(const side of [-1,1]) box('roof_rail',-L*.03,H*.96,side*W*.3,L*.36,H*.025,W*.025,steel);
      for(const x of [-.19,.13]) box('rack_crossbar',L*x,H*.96,0,L*.02,H*.025,W*.61,steel);
    } else if(part==='spoiler') box(part,-L*.37,H*.65,0,L*.1,H*.04,W*.83,dark);
    else if(part==='lamps') for(const side of [-1,1]) box(part,L*.47,H*.44,side*W*.17,L*.04,H*.08,W*.13,0xf3e5ae);
    else if(part==='beacon'||part==='taxi') {
      const roof=rows.find(p=>p.role==='cab');
      if(roof)box(part,roof.p[0],roof.p[1]+roof.g[2]/2+H*.025,roof.p[2],L*.1,H*.05,W*.48,part==='taxi'?0xedc953:0x358bdd);
    }
  }
  if (['diesel','petrol','hybrid'].includes(v.power)) {
    box('exhaust',-L*.43,H*.28,W*.28,L*.11,H*.035,W*.045,dark);
    box('exhaust_hanger',-L*.39,H*.33,W*.2,L*.025,H*.13,W*.2,dark);
    if(v.form==='motor')box('exhaust_pipe',-L*.25,H*.34,W*.19,L*.35,H*.055,W*.06,dark);
  }
  if (['battery','hybrid','hydrogen'].includes(v.power)) {
    const y=v.form==='roller'?H*.36:H*.24;
    box('battery_pack',0,y,0,L*.27,H*.06,W*.48,dark);
  }
  if(v.power==='hydrogen') {
    const roof=rows.find(p=>p.role==='cab');
    const x=roof.p[0],base=roof.p[1]+roof.g[2]/2;
    cyl('hydrogen_tank',x,base+W*.13,0,W*.13,Math.min(L*.35,roof.g[1]*.9),steel,[0,0,Math.PI/2]);
    for(const dx of [-.08,.08])box('hydrogen_saddle',x+L*dx,base+W*.035,0,L*.035,W*.09,W*.25,dark);
  }
  // 牌照屬於端面安裝件，不能沿用最大的側面廣告／車隊標記。
  if(v.habitat.includes('street') && !['cycle','trike','cart','carriage'].includes(v.form)) {
    if(v.form==='motor') {
      beam('rear_plate_stay',[-L*.02,H*.77,0],[-L*.39,H*.61,0],W*.055,steel);
      box('rear_plate_bracket',-L*.39,H*.56,0,L*.04,H*.16,W*.4,steel);
    }
    for(const end of v.form==='motor'||v.form==='semiTrailer'?[-1]:[-1,1]) {
      const support=(v.form==='motor'?rows.find(p=>p.role==='rear_plate_bracket'):null)
        || (end<0&&key==='garbage'?rows.find(p=>p.role==='hopper_loading_sill'):null)
        || rows.find(p=>p.role==='bumper'&&Math.sign(p.p[0])===end)
        || rows.find(p=>['ladder_chassis','trailer_frame','chassis','floor','engine'].includes(p.role));
      if(!support)continue;
      const face=support.p[0]+end*support.g[1]/2,y=support.p[1],z=v.form==='semiTrailer'||key==='garbage'?W*.28:0;
      const h=Math.min(.14,W*.085),w=h*4;
      box('license_plate_mount',face+end*.012,y,z,.024,h*1.2,w*1.06,steel);
      box('license_plate',face+end*.026,y,z,.006,h,w,0xe8e4d8);
      plates.push({x:face+end*.030,y,z,h:h*.88,ry:end*Math.PI/2,text:'SV '+v.number});
    }
  }
  const panel = rows.filter(p => p.g[0] === 'box' && p.c === paint && !p.r && p.p[2]===0)
    .sort((a,b) => b.g[1]*b.g[2] - a.g[1]*a.g[2])[0];
  const markingSurface = panel ? {x:panel.p[0],y:panel.p[1],z:panel.g[3]/2,
    length:panel.g[1],height:panel.g[2]} : null;
  const r = mulberry32(seed ^ 0x57454152);
  if (panel && !['cycle','motor','trike','cart','carriage'].includes(v.form)) {
    const s = markingSurface;
    for(let i=0;i<Math.floor(v.wear*12);i++) for(const side of [-1,1]) box('paint_chip',s.x+s.length*between(r,[-.38,.38]),s.y-s.height*.32,side*(s.z+.001),s.length*.015,s.height*between(r,[.04,.12]),.002,0x86563b);
    for(const side of [-1,1]) box('dust',s.x,s.y-s.height*.4,side*(s.z+.001),s.length*.75,s.height*(.015+v.dust*.08), .002,tint(0x9a866b,.65+v.dust*.35));
  }
  const boxes = rows.map(p => p.g[0]==='ring'
    ? partAABB({...p,r:[0,0,0],g:['box',2*(p.g[1]+p.g[2]),2*(p.g[1]+p.g[2]),2*p.g[2]]}) : partAABB(p));
  const min = ['x0','y0','z0'].map(axis => Math.min(...boxes.map(b=>b[axis])));
  const max = ['x1','y1','z1'].map(axis => Math.max(...boxes.map(b=>b[axis])));
  const parts = rows.map((part,index) => {
    const [type,a,b,c,sides] = part.g;
    return { name: part.role || `body_${index}`, position: part.p, rotation: part.r || [0,0,0], color: part.c,
      ...(type==='box' ? { type, dimensions:[a,b,c] } : type==='ring' ? {type:'torus_ring',radius:a,tube:b}
        : {type:'cylinder', radii:[a,b],height:c,sides}) };
  });
  return { key: `${VEHICLE_PREFIX}${key}:${seed}:${v.purpose}:${v.power}`, targetKey: VEHICLE_PREFIX+key,
    name:v.name,family:'vehicle',version:1,subpart:v.type,parts,palettes:[],
    bounds:{min,max,size:max.map((n,i)=>n-min[i])}, dimensions:{L,W,H},sceneBasis:{rotationY:0},markingSurface,plates,generation:v };
}
