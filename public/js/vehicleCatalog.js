// Land vehicle role/structure compatibility table. Values represent visual art boundaries, not engineering specs.
import { mulberry32 } from './rng.js';
import { partAABB, makeVehicle as collisionContract, VEHICLE_SPEC, placeParts } from './vehicles.js';
import { buildIndividualBody } from './vehicleIndividualBodies.js';

export const INDUSTRY_PART_NAMES = {policeStripe:'警用識別條',secureCabin:'封閉押送艙與格柵',commandCabin:'指揮通訊艙',ladder:'伸縮雲梯',outriggers:'收納式支腿',firePump:'消防泵浦櫃',hose:'軟管捲盤',waterTank:'灑水槽罐',sprayBar:'灑水排管',compactor:'壓縮箱與尾部料斗',recyclingBins:'分類回收箱',vacuumTank:'吸污真空罐',saltHopper:'撒鹽料斗',snowBlade:'除雪鏟',bucketLift:'高空工作斗',telecomMast:'折收基地台天線',generator:'隔音發電機',cableReel:'電纜捲盤',dumpBed:'傾卸貨斗',mixerDrum:'混凝土攪拌筒',pumpBoom:'折疊泵送臂',craneBoom:'伸縮吊臂與吊鉤',drillMast:'鑽架與鑽桿',dozerBlade:'推土鏟',graderBlade:'中央整平鏟',paverHopper:'瀝青料斗',screed:'後置熨平板',trenchChain:'挖溝鏈臂',pumpUnit:'防汛抽水泵',fuelTank:'燃油罐與頂部人孔',cryogenicTank:'雙層保溫罐與閥箱',potableTank:'飲用水密閉罐',sanitaryTank:'衛生級乳品罐',chemicalTank:'化學槽罐與防護閥罩',servingHatch:'餐飲販售窗口',awning:'側面遮雨棚',kitchenVent:'廚房排風罩',openBed:'開放式貨斗',vanWindows:'乘客側窗',refrigeratedBox:'保溫廂與冷凍機',medicalCabin:'醫療艙',bookShelves:'圖書展示櫃',camperCabin:'居住艙與通風口',recoveryBed:'救援平板',winch:'牽引絞盤',fifthWheel:'第五輪聯結座',logLoad:'原木與防滾樁',oreHopper:'礦石料斗與底卸口',containerLoad:'貨櫃與鎖固角座',militaryLoad:'繫固的裝甲裝備',grainHopper:'密閉穀物斗',enclosedBox:'封閉棚式貨廂',autoDeck:'雙層載車架',ballastHopper:'道碴漏斗',toolCabinet:'維修工具櫃',sealedWaste:'密閉廢料箱',machineLoad:'工程機具載荷',animalBox:'通風牲畜廂',curtainBox:'側簾貨廂'};

export function industryProfiles(row) {
  const road = (name,purpose,equipment,length=[6,9]) => row(name,purpose,'heavy',['diesel','battery'],'truck',length,.3,.39,[0,25],equipment,['street','yard']);
  const van = (name,purpose,equipment) => row(name,purpose,'fourWheel',['petrol','diesel','battery'],'van',[4.6,5.8],.39,.46,[0,25],equipment,['street']);
  const wagon = (name,purpose,equipment) => row(name,purpose,'rail',['towed'],'railWagon',[11,16],.2,.27,[0,50],equipment,['rail']);
  const trailer = (name,purpose,equipment) => row(name,purpose,'trailer',['towed'],'semiTrailer',[10,13.5],.21,.29,[0,30],equipment,['street','yard']);
  return {
    police: row('警用巡邏車',['government','police'],'fourWheel',['petrol','hybrid','battery'],'sedan',[4.4,5],.4,.34,[0,15],['beacon','policeStripe'],['street']),
    prisoner: van('囚犯運送車',['government','police'],['secureCabin','beacon']),
    command: van('災害指揮車',['government','rescue'],['commandCabin','antenna','beacon']),
    ladderTruck: road('消防雲梯車',['government','rescue'],['ladder','outriggers','beacon'],[8,11]),
    fireEngine: road('消防泵浦車',['government','rescue'],['firePump','hose','beacon']),
    sprinkler: road('道路灑水車',['government','municipal','water'],['waterTank','sprayBar']),
    garbage: road('壓縮式垃圾車',['government','waste'],['compactor']),
    recycling: road('資源回收車',['government','waste'],['recyclingBins']),
    sewer: road('下水道吸污車',['government','water','waste'],['vacuumTank','hose']),
    snowplow: road('除雪撒鹽車',['government','municipal'],['saltHopper','snowBlade']),
    bucketTruck: road('高空作業工程車',['utilities','construction'],['bucketLift','outriggers']),
    mobileTower: road('行動基地台車',['utilities','government'],['telecomMast','generator','outriggers']),
    generatorTruck: road('緊急供電車',['utilities','rescue'],['generator','cableReel']),
    tipper: road('土石傾卸車',['construction','mining'],['dumpBed']),
    mixer: road('預拌混凝土攪拌車',['construction'],['mixerDrum']),
    concretePump: road('混凝土泵送車',['construction'],['pumpBoom','outriggers']),
    mobileCrane: road('伸縮臂起重車',['construction','industry'],['craneBoom','outriggers'],[8,11]),
    drillRig: row('地質鑽探機',['construction','science','water'],'tracked',['diesel'],'excavator',[5,7],.42,.7,[0,30],['drillMast'],['construction','research']),
    bulldozer: row('履帶推土機',['construction','forestry'],'tracked',['diesel'],'tank',[4.5,6.5],.51,.49,[0,35],['dozerBlade'],['construction','forest']),
    roller: row('雙鋼輪壓路機',['construction'],'fourWheel',['diesel','battery'],'roller',[3.5,5],.5,.6,[0,25],[],['construction']),
    grader: row('平地機',['construction'],'heavy',['diesel'],'utility',[7,9],.31,.38,[0,30],['graderBlade'],['construction']),
    paver: row('瀝青鋪路機',['construction'],'tracked',['diesel'],'tank',[4.5,6],.6,.47,[0,25],['paverHopper','screed'],['construction']),
    trencher: row('鏈式開溝機',['construction','water'],'tracked',['diesel'],'excavator',[4,6],.4,.5,[0,25],['trenchChain'],['construction']),
    dewatering: road('防汛抽水車',['government','water','rescue'],['pumpUnit','hose']),
    fuelTanker: road('油罐車',['freight','energy'],['fuelTank']),
    nitrogen: road('液氮充填車',['freight','science'],['cryogenicTank']),
    waterSupply: road('飲用水補給車',['water','freight'],['potableTank','hose']),
    milkTanker: road('鮮乳槽罐車',['food','livestock'],['sanitaryTank']),
    chemicalTanker: road('化學品槽車',['industry','freight'],['chemicalTank']),
    foodTruck: van('餐車',['food','commerce'],['servingHatch','awning','kitchenVent']),
    miniTruck: row('發財車',['commerce','freight'],'fourWheel',['petrol','battery'],'pickup',[3.5,4.2],.43,.48,[0,30],['openBed'],['street','farm']),
    van: van('麵包車',['private','passenger','commerce'],['vanWindows']),
    pickup: row('皮卡',['private','agriculture','freight'],'offroad',['petrol','diesel','battery'],'pickup',[4.8,5.8],.38,.38,[0,30],['openBed'],['street','farm','trail']),
    refrigerated: road('冷藏配送車',['food','freight'],['refrigeratedBox']),
    mobileClinic: van('行動診療車',['government','medical'],['medicalCabin','awning']),
    libraryBus: row('行動圖書車',['government','education'],'heavy',['diesel','battery'],'bus',[7,10],.28,.35,[0,25],['bookShelves','awning'],['street']),
    camper: van('露營車',['private','tourism'],['camperCabin','awning']),
    towTruck: road('道路救援拖吊車',['rescue','commerce'],['recoveryBed','winch']),
    airportFuel: road('機場加油車',['aviation','energy'],['fuelTank','hose']),
    baggage: row('機場行李牽引車',['aviation','freight'],'fourWheel',['battery','diesel'],'utility',[2.5,3.5],.48,.55,[0,25],['hitch'],['airport']),
    roadTractor: row('半拖車牽引車',['freight','industry','military'],'heavy',['diesel','hydrogen'],'tractorUnit',[5.8,7],.39,.52,[0,25],['fifthWheel'],['street','yard']),
    dieselLocomotive: row('產業貨運柴油機車',['freight','forestry','mining','military','energy','food','waste'],'rail',['diesel'],'railLocomotive',[15,19],.18,.25,[0,50],[],['rail']),
    electricLocomotive: row('貨運電力機車',['freight','industry'],'rail',['overhead'],'railLocomotive',[16,20],.17,.24,[0,45],[],['rail']),
    railLogs: wagon('原木運輸平車',['forestry','freight'],['logLoad']),
    railOre: wagon('礦石漏斗車',['mining','freight'],['oreHopper']),
    railContainer: wagon('貨櫃平車',['freight'],['containerLoad']),
    railMilitary: wagon('軍用裝備運輸平車',['military'],['militaryLoad']),
    railFuel: wagon('燃油罐車',['energy','freight'],['fuelTank']),
    railGrain: wagon('穀物密閉漏斗車',['agriculture','food','freight'],['grainHopper']),
    railReefer: wagon('冷藏貨車',['food','freight'],['refrigeratedBox']),
    railBox: wagon('棚式貨車',['freight','industry'],['enclosedBox']),
    railAuto: wagon('汽車運輸雙層車',['freight','industry'],['autoDeck']),
    railBallast: wagon('道碴工程車',['construction','government'],['ballastHopper']),
    railMaintenance: wagon('鐵道維修吊車',['construction','government'],['craneBoom','toolCabinet']),
    railWaste: wagon('密閉廢棄物運輸車',['waste'],['sealedWaste']),
    semiContainer: trailer('貨櫃半拖車',['freight'],['containerLoad']),
    semiLogs: trailer('原木半拖車',['forestry','freight'],['logLoad']),
    semiOre: trailer('砂石傾卸半拖車',['mining','construction','freight'],['oreHopper']),
    semiLowboy: trailer('低床機具半拖車',['construction','industry'],['machineLoad']),
    semiMilitary: trailer('軍用重裝備半拖車',['military'],['militaryLoad']),
    semiFuel: trailer('油罐半拖車',['energy','freight'],['fuelTank']),
    semiNitrogen: trailer('低溫液氮半拖車',['science','freight'],['cryogenicTank']),
    semiReefer: trailer('冷藏半拖車',['food','freight'],['refrigeratedBox']),
    semiAuto: trailer('轎車運輸半拖車',['industry','freight'],['autoDeck']),
    semiLivestock: trailer('牲畜半拖車',['livestock','freight'],['animalBox']),
    semiCurtain: trailer('側簾半拖車',['commerce','freight'],['curtainBox']),
    semiGrain: trailer('散裝穀物半拖車',['agriculture','freight'],['grainHopper']),
  };
}

export function everydayProfiles(row) {
  const make=(name,style,form,length,w,h,powers,purpose=['private','passenger'],type='fourWheel',parts=[])=>
    ({...row(name,purpose,type,powers,form,length,w,h,[0,30],parts,['street']),style});
  const bike=(name,style,powers=['human'])=>make(name,style,'cycle',[1.7,2],.32,.6,powers,['private','sport'],'twoWheel',[]);
  const moto=(name,style,powers=['petrol'])=>make(name,style,'motor',[1.9,2.5],.36,.56,powers,['private','passenger'],'twoWheel',[]);
  const car=(name,style,length,w,h,powers=['petrol','hybrid','battery'])=>make(name,style,'sedan',length,w,h,powers);
  return {
    cityBike:bike('城市淑女自行車','stepThrough'),
    foldingBike:bike('小輪折疊自行車','folding'),
    mountainBike:bike('登山自行車','mountain'),
    roadBike:bike('公路彎把自行車','roadBike'),
    electricBike:bike('電動輔助自行車','ebike',['battery']),
    deliveryBike:make('外送電動自行車','deliveryCycle','cycle',[1.9,2.2],.34,.58,['battery'],['commerce','freight'],'twoWheel'),
    scooter:moto('通勤速克達','scooter'),
    electricScooter:moto('電動速克達','electricScooter',['battery']),
    deliveryScooter:make('外送機車','deliveryMoto','motor',[1.9,2.2],.37,.58,['petrol','battery'],['food','commerce'],'twoWheel'),
    dirtBike:{...moto('越野摩托車','dirtBike'),purpose:['private','sport'],habitat:['street','trail']},
    adventureBike:moto('多功能探險重機','adventure'),
    cruiser:moto('巡航重型機車','cruiser'),
    sportMoto:moto('全整流罩跑車重機','sportMoto'),
    touringMoto:moto('長途旅行重機','touringMoto'),
    hatchback:car('都會掀背車','hatchback',[3.5,4.1],.44,.38),
    compactSedan:car('緊湊型房車','compact',[4,4.5],.41,.34),
    executiveSedan:car('中大型房車','executive',[4.7,5.2],.38,.3),
    wagon:car('旅行車','wagon',[4.5,5],.4,.33),
    coupe:car('雙門轎跑車','coupe',[4.3,4.8],.42,.29),
    sportsCar:car('雙座跑車','sportsCar',[4.2,4.7],.44,.26,['petrol','battery']),
    convertible:car('敞篷跑車','convertible',[4.2,4.7],.43,.29,['petrol']),
    luxurySedan:car('豪華旗艦房車','luxury',[5,5.6],.38,.3),
    limousine:car('加長禮賓車','limousine',[6,7.5],.29,.24,['petrol','hybrid']),
    crossover:make('都會跨界休旅','crossover','van',[4.2,4.8],.42,.37,['petrol','hybrid','battery']),
    familySUV:make('家庭七人座休旅','suv','van',[4.7,5.2],.4,.38,['petrol','hybrid','battery']),
    offroadSUV:make('硬派越野吉普','offroadSUV','van',[4.3,4.8],.44,.43,['petrol','diesel'],['private','tourism'],'offroad'),
    minivan:make('家庭廂式休旅','minivan','van',[4.7,5.2],.39,.38,['petrol','hybrid','battery']),
    cargoVan:make('高頂商用廂型車','cargoVan','van',[5,6.2],.36,.44,['diesel','battery'],['commerce','freight']),
    passengerVan:make('九人座接駁廂型車','passengerVan','van',[5,5.8],.37,.4,['diesel','battery'],['passenger','tourism']),
    camperVan:make('升頂露營廂型車','popTop','van',[4.8,5.5],.39,.4,['diesel','battery'],['private','tourism']),
    motorhome:make('額頭床大型露營車','motorhome','van',[6.2,7.5],.34,.42,['diesel'],['private','tourism']),
    militaryJeep:make('軍用輕型指揮吉普','militaryJeep','van',[4.1,4.7],.45,.43,['diesel'],['military'],'offroad',['antenna']),
    militaryPickup:make('軍用勤務皮卡','militaryPickup','pickup',[5,5.8],.4,.4,['diesel'],['military'],'offroad',['openBed']),
    militaryVan:make('軍用通訊廂型車','militaryVan','van',[5.1,6],.38,.43,['diesel'],['military'],'fourWheel',['antenna']),
    militaryMoto:make('軍用偵察摩托車','militaryMoto','motor',[2,2.4],.38,.59,['petrol','battery'],['military'],'twoWheel'),
  };
}

export const ROAD_CAR_WEIGHTS={sedan:24,compactSedan:22,hatchback:22,executiveSedan:10,wagon:10,coupe:5,luxurySedan:4,sportsCar:2,convertible:1};
export function selectRoadCar(seed) {
  let roll=mulberry32(seed^0x524f4144)()*100;
  for(const [key,weight] of Object.entries(ROAD_CAR_WEIGHTS)){roll-=weight;if(roll<0)return key;}
  return 'sedan';
}


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
  ...everydayProfiles(row),
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

export const VEHICLE_BRANDS = [
  {name:'嶺川 RIVORN',mark:'diamond',color:0xc4d6df},
  {name:'曜輪 SOLTRA',mark:'sun',color:0xd9af53},
  {name:'鐵嶼 FERROVA',mark:'bars',color:0xb5bbc3},
  {name:'北辰 NORDEN',mark:'cross',color:0x779fb4},
  {name:'森原 VERDAN',mark:'chevron',color:0x65a583},
];
export const RIM_NAMES={steel:'鋼製孔式',alloy:'六輻鋁圈',disc:'封閉碟式',spoked:'鋼絲輻條',rail:'鐵道鋼輪',tracked:'履帶負重輪'};
const mass={cycle:[.009,.03],trike:[.06,.2],motor:[.1,.35],cart:[.025,.12],carriage:[.3,1],sedan:[1.1,2.2],van:[1.7,3.2],pickup:[1.5,3],truck:[5,12],tractorUnit:[6,10],bus:[8,16],tractor:[2,7],harvester:[8,18],forklift:[2,6],excavator:[8,25],tank:[12,55],armor:[10,25],roller:[3,12],railcar:[25,48],railWagon:[15,30],railLocomotive:[70,120],steam:[45,90],semiTrailer:[5,10],utility:[1.5,5]};

/** Art tonnage and cosmetic variant parameters; excluded from collision, damage, or economy simulation. */
export function vehicleVariants(key,spec,seed,length) {
  const r=mulberry32(seed^0x56415249),pick=a=>a[Math.floor(r()*a.length)],sample=(a,b)=>a+r()*(b-a);
  const range=mass[spec.form],size=(length-spec.length[0])/(spec.length[1]-spec.length[0]);
  const curbTonnes=range[0]+(range[1]-range[0])*(size*.8+r()*.2);
  const heavy=['heavy','trailer','rail'].includes(spec.type);
  const noFreight=['railLocomotive','steam','tractorUnit','tank','excavator','roller','harvester','tractor'].includes(spec.form);
  const payloadTonnes=noFreight?0:curbTonnes*(['bus','railcar'].includes(spec.form)?sample(.12,.25):heavy?sample(.45,1.4):sample(.15,.35));
  const roadWheel=!['tracked','rail'].includes(spec.type)&&!['cycle','trike','cart','carriage','roller'].includes(spec.form);
  // Maintain standard mount heights across couplings, rail gauge, tracks, and road wheels.
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
    // Straps contour over cargo top and sides down to load bed.
    box('cargo_tie_top',cx,base+h+.005,0,l*.09,.018,w*.84,0x353b40);
    for(const side of [-1,1])box('cargo_tie_side',cx,base+h/2,side*w*.41,l*.09,h+.025,.018,0x353b40);
  }

}

/** Equipment shares common geometric vocabulary sized to carrier load bed without dedicated chassis duplication. */
export function buildIndustryEquipment(part, v, {box,cyl,beam,frustum}) {
  if (!Object.hasOwn(INDUSTRY_PART_NAMES,part)) return false;
  const {length:L,width:W,height:H,fadedPaint:paint}=v;
  const trailer=['railWagon','semiTrailer'].includes(v.form);
  const x=trailer?0:-L*.16, span=L*(trailer?.83:.57), floor=H*.34;
  const dark=0x28313a,steel=0x97a3a5,light=0xe2e3d7;
  const enclosure=(name,color=paint)=>box(name,x,floor+H*.27,0,span,H*.54,W*.87,color);
  const railings=()=>{for(const side of [-1,1])box('bed_side',x,floor+H*.13,side*W*.43,span,H*.26,W*.045);};
  const hopper=(closed=false)=>{
    box('hopper_floor',x,floor,0,span,H*.08,W*.78,dark);
    for(const side of [-1,1])box('sloped_hopper',x,floor+H*.2,side*W*.32,span,H*.37,W*.065,paint,[side*.28,0,0]);
    for(const end of [-1,1])box('hopper_end',x+end*span*.48,floor+H*.2,0,span*.035,H*.4,W*.84);
    for(const dx of [-.27,.27])box('bottom_discharge',x+span*dx,floor-H*.065,0,span*.17,H*.12,W*.33,dark);
    if(closed)box('sealed_hopper_roof',x,floor+H*.42,0,span,H*.07,W*.85,light);
    else for(const dx of [-.3,0,.3].slice(0,v.cargo?.type==='aggregate'?v.cargo.count:3))box('aggregate_load',x+span*dx,floor+H*.26,0,span*.29,H*.16,W*.62,0x67615a);
  };
  if(['fuelTank','cryogenicTank','potableTank','sanitaryTank','chemicalTank','waterTank','vacuumTank'].includes(part)) {
    const radius=Math.min(W*.41,H*.28), y=floor+radius;
    const color=part==='fuelTank'?0xc6c7b6:part==='waterTank'||part==='potableTank'?0xc0dce3:part==='vacuumTank'?paint:light;
    cyl(part,x,y,0,radius,span,color,[0,0,Math.PI/2]);
    for(const end of [-1,1])cyl('tank_endcap',x+end*span*.5,y,0,radius*.91,span*.018,steel,[0,0,Math.PI/2]);
    for(const dx of [-.32,.32])box('tank_saddle',x+span*dx,floor,0,span*.09,H*.12,W*.73,dark);
    if(part==='cryogenicTank') {
      box('insulated_valve_cabinet',x-span*.44,floor+.04,0,span*.16,H*.23,W*.65,steel);
      for(const s of [-1,1])cyl('filling_valve',x-span*.47,floor+H*.05,s*W*.24,W*.04,W*.12,0x31759c);
    } else {
      for(const dx of [-.28,0,.28])cyl('tank_manway',x+span*dx,y+radius,0,W*.095,H*.05,steel,[0,0,0]);
      if(part==='chemicalTank')box('valve_protection',x,y+radius+H*.055,0,span*.2,H*.12,W*.35,dark);
    }
    if(part==='fuelTank'||part==='chemicalTank')for(const s of [-1,1])box('cargo_warning_panel',x,y,s*radius,span*.15,H*.09,W*.008,0xe5a434);
    if(part==='fuelTank')for(let i=0;i<3;i++) {
      box('fuel_outlet_manifold',x+span*(-.23+i*.23),floor+H*.04,W*.38,span*.13,H*.1,W*.1,steel);
      cyl('fuel_outlet_cap',x+span*(-.23+i*.23),floor+H*.04,W*.46,W*.045,W*.09,dark);
    }
    if(part==='sanitaryTank')box('sanitary_rear_valve_cover',x-span*.49,y-radius*.38,0,span*.08,H*.22,W*.45,steel);
    if(part==='potableTank') {
      box('drinking_water_tap_rail',x-span*.25,floor+H*.13,W*.4,span*.3,H*.045,W*.1,steel);
      for(const dx of [-.35,-.25,-.15])cyl('water_delivery_tap',x+span*dx,floor+H*.1,W*.45,W*.026,H*.09,0x407daa,[0,0,0]);
    }
    if(part==='vacuumTank') {
      cyl('vacuum_rear_door',x-span*.515,y,0,radius*.96,span*.035,steel,[0,0,Math.PI/2]);
      for(const s of [-1,1])box('vacuum_door_clamp',x-span*.54,y,s*radius*.85,span*.04,H*.17,W*.08,dark);
    }
  } else if(['enclosedBox','containerLoad','refrigeratedBox','sealedWaste','animalBox','curtainBox'].includes(part)) {
    enclosure(part);
    for(let i=0;i<12;i++)for(const s of [-1,1])box('body_rib',x+span*(-.46+i*.084),floor+H*.27,s*W*.438,span*.012,H*.5,W*.018,steel);
    if(part==='refrigeratedBox')box('refrigeration_unit',x+span*.48,floor+H*.42,0,span*.12,H*.2,W*.53,light);
    if(part==='animalBox')for(let i=0;i<3;i++)for(const s of [-1,1])box('animal_vent',x,floor+H*(.17+i*.12),s*W*.45,span*.9,H*.04,W*.015,dark);
    if(part==='containerLoad')for(const end of [-1,1])for(const s of [-1,1])box('twistlock',x+end*span*.49,floor-H*.015,s*W*.43,span*.03,H*.06,W*.09,dark);
    if(part==='curtainBox')for(let i=0;i<10;i++)for(const s of [-1,1])box('curtain_buckle',x+span*(-.43+i*.095),floor+H*.04,s*W*.439,span*.018,H*.06,W*.015,dark);
    if(part==='enclosedBox')for(const s of [-1,1]) {
      box('boxcar_sliding_door',x,floor+H*.26,s*W*.447,span*.32,H*.47,W*.025,steel);
      box('sliding_door_track',x,floor+H*.51,s*W*.46,span*.61,H*.025,W*.04,dark);
    }
    if(part==='sealedWaste')for(const dx of [-.27,.27]) {
      box('waste_sealed_lid',x+span*dx,floor+H*.56,0,span*.42,H*.035,W*.8,steel);
      box('lid_lifting_eye',x+span*dx,floor+H*.59,0,span*.07,H*.04,W*.18,dark);
    }
    if(part==='containerLoad'||part==='refrigeratedBox'||part==='curtainBox') {
      for(const s of [-1,1]) {
        box('rear_cargo_door',x-span*.504,floor+H*.27,s*W*.215,span*.012,H*.49,W*.41,light);
        box('door_lock_bar',x-span*.516,floor+H*.27,s*W*.22,span*.014,H*.44,W*.018,steel);
      }
    }
  } else if(part==='dumpBed') {
    box('tipper_floor',x,floor,0,span,H*.08,W*.85,steel);
    for(const s of [-1,1]) {
      box('tipper_side',x,floor+H*.2,s*W*.43,span,H*.4,W*.055);
      for(let i=0;i<5;i++)box('tipper_side_stiffener',x+span*(-.4+i*.2),floor+H*.2,s*W*.46,span*.025,H*.39,W*.045,steel);
    }
    for(const end of [-1,1])box(end<0?'hinged_tailgate':'tipper_headboard',x+end*span*.48,floor+H*.2,0,span*.035,H*.4,W*.89);
    cyl('tailgate_hinge',x-span*.48,floor+H*.38,0,W*.035,W*.92,steel);
    beam('tipper_lift_ram',[x+span*.26,H*.28,0],[x+span*.3,floor+H*.1,0],W*.12,steel);
    for(const dx of [-.3,0,.3].slice(0,v.cargo.count))box('aggregate_load',x+span*dx,floor+H*.11,0,span*.29,H*.2,W*.72,0x756d62);
  } else if(part==='paverHopper') {
    box('asphalt_feed_floor',L*.28,H*.4,0,L*.35,H*.08,W*.94,dark);
    for(const s of [-1,1])box('folding_hopper_wing',L*.28,H*.52,s*W*.43,L*.36,H*.24,W*.08,paint,[s*.3,0,0]);
    box('feed_conveyor',0,H*.43,0,L*.65,H*.065,W*.36,dark);
    cyl('rear_spreading_auger',-L*.39,H*.3,0,W*.07,W*.87,steel);
  } else if(['oreHopper','grainHopper','ballastHopper','saltHopper'].includes(part)) {
    hopper(part==='grainHopper');
    if(part==='grainHopper')for(const dx of [-.3,0,.3])box('grain_loading_hatch',x+span*dx,floor+H*.47,0,span*.17,H*.045,W*.4,steel);
    if(part==='ballastHopper')for(const s of [-1,1])box('ballast_side_chute',x,H*.28,s*W*.39,span*.3,H*.15,W*.22,steel);
    if(part==='saltHopper') {
      box('salt_delivery_conveyor',x-span*.42,H*.32,0,span*.13,H*.25,W*.23,dark);
      cyl('salt_spreader_disc',x-span*.42,H*.2,0,W*.24,H*.055,steel,[0,0,0]);
    }
  } else if(part==='logLoad') {
    for(const dx of [-.4,0,.4])box('log_bunk_crossbar',x+span*dx,floor+W*.015,0,span*.04,W*.045,W*.89,steel);
    for(let i=0;i<v.cargo.count;i++)cyl('secured_log',x,floor+W*(.14+Math.floor(i/3)*.23),(i%3-1)*W*.27,W*.13,span,0x846140,[0,0,Math.PI/2]);
    for(const dx of [-.4,0,.4])for(const s of [-1,1])box('log_bunk',x+span*dx,floor+H*.25,s*W*.43,span*.025,H*.55,W*.055,steel);
  } else if(['militaryLoad','machineLoad'].includes(part)) {
    box('secured_equipment_hull',x,floor+H*.22,0,span*.65,H*.23,W*.6,part==='militaryLoad'?0x667050:0xd6a03a);
    for(const s of [-1,1])box('equipment_track',x,floor+H*.09,s*W*.3,span*.71,H*.17,W*.16,dark);
    if(part==='militaryLoad') {
      box('equipment_turret',x,floor+H*.4,0,span*.29,H*.18,W*.39,0x667050);
      box('stowed_barrel',x+span*.26,floor+H*.41,0,span*.36,H*.035,W*.045,dark);
    } else {
      box('equipment_cab',x-span*.1,floor+H*.4,0,span*.2,H*.26,W*.38,0xd6a03a);
      beam('folded_digger_arm',[x,floor+H*.38,0],[x+span*.3,floor+H*.48,0],W*.09,0xd6a03a);
    }
    for(const dx of [-.35,.35])for(const s of [-1,1])box('tie_down',x+span*dx,floor+H*.03,s*W*.35,span*.05,H*.03,W*.22,steel);
  } else if(part==='autoDeck') {
    for(const level of [0,1]) {
      const y=floor+H*level*.34;
      box('car_deck',x,y,0,span,H*.04,W*.85,steel);
      for(const [slot,dx] of [-.28,.28].entries()){
        if(level*2+slot>=v.cargo.count)continue;
        for(const axle of [-.12,.12])for(const s of [-1,1])cyl('transported_car_wheel',x+span*(dx+axle),y+H*.065,s*W*.28,H*.05,W*.09,dark);
        box('transported_car',x+span*dx,y+H*.13,0,span*.38,H*.13,W*.62,level?0xa55b45:0x4e7188);
        box('transported_car_glass',x+span*dx,y+H*.22,0,span*.17,H*.08,W*.5,dark);
      }
    }
    for(const dx of [-.47,0,.47])for(const s of [-1,1])box('deck_post',x+span*dx,floor+H*.3,s*W*.43,span*.025,H*.65,W*.045,steel);
  } else if(['ladder','pumpBoom','craneBoom','bucketLift'].includes(part)) {
    const y=H*1.06;
    box('boom_equipment_deck',x,H*.44,0,span,H*.22,W*.85);
    box('boom_turntable',x-span*.27,H*.65,0,span*.22,H*.22,W*.57,dark);
    box('boom_pivot_pedestal',x-span*.27,H*.86,0,span*.13,H*.3,W*.43,steel);
    box('boom_transport_rest',x+span*.4,H*.8,0,span*.07,H*.5,W*.58,dark);
    if(part==='ladder') {
      for(const s of [-1,1]) {
        for(const level of [0,1])box('ladder_rail',x,y+level*H*.16,s*W*.25,span*1.2,H*.045,W*.055,steel);
        for(let i=0;i<10;i++)beam('ladder_truss',[x+span*(-.57+i*.114),y,s*W*.25],[x+span*(-.456+i*.114),y+H*.16,s*W*.25],W*.035,steel);
        box('nested_ladder',x+span*.02,y+H*.035,s*W*.19,span*1.08,H*.065,W*.05,steel);
      }
      for(let i=0;i<13;i++)box('ladder_rung',x+span*(-.56+i*.094),y,0,span*.018,H*.035,W*.55,steel);
      box('ladder_basket_floor',x+span*.53,y,0,span*.16,H*.055,W*.64,light);
      for(const s of [-1,1])box('ladder_basket_rail',x+span*.53,y+H*.1,s*W*.3,span*.16,H*.21,W*.04,light);
      box('ladder_basket_front',x+span*.6,y+H*.1,0,span*.02,H*.21,W*.64,light);
    } else if(part==='pumpBoom') {
      for(let i=0;i<3;i++) {
        const by=y+i*H*.12;
        box('pump_articulated_section',x,by,0,span*(1-i*.1),H*.09,W*.2,i===1?light:paint);
        const hingeX=x+(i%2?1:-1)*span*(.45-i*.05);
        cyl('pump_elbow_pin',hingeX,by+H*.055,0,W*.065,W*.28,steel);
        box('concrete_delivery_line',x,by,W*.13,span*(1-i*.1),H*.045,W*.065,dark);
      }
      box('concrete_receiving_hopper',x-span*.4,H*.62,0,span*.19,H*.25,W*.66,steel);
    } else if(part==='bucketLift') {
      beam('bucket_lower_arm',[x-span*.27,y,0],[x+span*.34,y+H*.13,0],W*.18,paint);
      beam('bucket_return_arm',[x+span*.34,y+H*.13,0],[x-span*.1,y+H*.24,0],W*.14,light);
      cyl('bucket_elbow',x+span*.34,y+H*.13,0,W*.095,W*.3,steel);
      box('insulated_work_bucket',x-span*.1,y+H*.14,0,span*.19,H*.27,W*.5,light);
      box('bucket_open_top',x-span*.1,y+H*.278,0,span*.15,H*.008,W*.38,dark);
    } else {
      for(let i=0;i<3;i++)box('folded_boom',x+span*i*.14,y,0,span*(1-i*.18),H*(.18-i*.035),W*(.32-i*.06),i===1?light:paint);
      if(part==='craneBoom') {box('hoist_wire',x+span*.44,y-H*.1,0,W*.012,H*.24,W*.012,dark);box('hook',x+span*.44,y-H*.23,0,W*.09,H*.055,W*.04,steel);}
      cyl('hoist_drum',x-span*.3,y-H*.16,0,W*.13,W*.48,steel);
      box('crane_counterweight',x-span*.44,H*.72,0,span*.16,H*.22,W*.67,dark);
    }
  } else if(part==='outriggers') {
    for(const dx of [-.38,.38])for(const s of [-1,1])box('stowed_outrigger',x+span*dx,H*.26,s*W*.4,span*.06,H*.1,W*.17,steel);
  } else if(['hose','cableReel','winch'].includes(part)) {
    const y=floor+H*.15;
    cyl(part,x-span*.32,y,W*.34,W*.16,W*.16,part==='hose'?0x344a52:dark);
    for(const s of [-1,1])cyl('reel_flange',x-span*.32,y,W*(.34+s*.095),W*.18,W*.025,steel);
    if(part==='winch') {
      box('winch_motor',x-span*.32,y,W*.15,span*.11,H*.11,W*.22,steel);
      box('winch_fairlead',x-span*.4,y,W*.34,span*.045,H*.1,W*.19,steel);
    } else if(part==='cableReel')box('cable_connector_box',x-span*.32,y-H*.1,W*.35,span*.13,H*.12,W*.2,0x416884);
  } else if(part==='sprayBar') {
    box('spray_bar',-L*.47,H*.22,0,L*.025,H*.025,W*.94,steel);
    for(const s of [-1,1])cyl('water_nozzle',-L*.48,H*.21,s*W*.35,W*.03,H*.07,dark,[0,0,0]);
  } else if(part==='mixerDrum') {
    // Axis points from low front (+X) to raised rear (-X); rear discharge opening feeds and unloads concrete.
    const tilt=.22, center=[x,H*.7,0], radius=W*.4;
    const point=t=>[center[0]-Math.cos(tilt)*t,center[1]+Math.sin(tilt)*t,0];
    const sections=[[-.4,-.22,.2,1],[-.22,.09,1,1],[.09,.4,1,.38]];
    for(const [a,b,ra,rb] of sections){const p=point(span*(a+b)/2);frustum('mixer_drum_section',...p,radius*rb,radius*ra,span*(b-a),light,[0,0,Math.PI/2-tilt]);}
    for(const t of [-.22,.09]) {
      const p=point(span*t);
      cyl('drum_running_ring',...p,radius*1.015,span*.028,steel,[0,0,Math.PI/2-tilt]);
      const base=p[1]-radius*.88;
      box('mixer_support',p[0],(floor+base)/2,0,span*.09,Math.max(H*.06,base-floor),W*.65,dark);
      for(const s of [-1,1])cyl('drum_support_roller',p[0],base,s*W*.22,W*.075,span*.09,dark,[0,0,Math.PI/2]);
    }
    const rear=point(span*.41);
    cyl('mixer_opening',...rear,radius*.34,span*.02,dark,[0,0,Math.PI/2-tilt]);
    box('feed_hopper',rear[0],rear[1]+H*.1,0,span*.13,H*.19,W*.33,steel);
    beam('discharge_chute',[rear[0],rear[1]-radius*.3,0],[rear[0]-span*.1,H*.4,0],W*.13,steel);
    for(const s of [-1,1])box('rear_hopper_support',rear[0],(floor+rear[1])/2,s*W*.23,span*.025,rear[1]-floor,W*.035,steel);
  } else if(part==='drillMast'||part==='telecomMast') {
    const mastX=part==='drillMast'?L*.32:x;
    box(part,mastX,H*.76,0,W*.13,H*.85,W*.13,steel);
    if(part==='drillMast')cyl('drill_rod',mastX+W*.1,H*.55,0,W*.035,H*.95,dark,[0,0,0]);
    else for(const s of [-1,1]) {box('sector_antenna',mastX,H*1.09,s*W*.2,W*.13,H*.22,W*.08,light);box('antenna_bracket',mastX,H*.99,0,W*.04,H*.04,W*.45,steel);}
  } else if(['dozerBlade','snowBlade','graderBlade','screed'].includes(part)) {
    const bx=part==='graderBlade'?0:part==='screed'?-L*.42:L*.43;
    box(part,bx,H*.2,0,L*.08,H*.26,W*.94,steel,[0,part==='graderBlade'?.23:0,.1]);
    if(part==='screed') {
      for(const s of [-1,1])box('screed_extension',bx,H*.17,s*W*.42,L*.15,H*.15,W*.32,dark);
      beam('screed_tow_arm',[-L*.12,H*.37,0],[bx,H*.27,0],W*.12,steel);
    } else {
      box('blade_cutting_edge',bx+L*.035,H*.08,0,L*.04,H*.045,W*.97,dark);
      for(const s of [-1,1])beam('blade_hydraulic', [bx-L*.19,H*.4,s*W*.27],[bx,H*.22,s*W*.27],W*.065,paint);
      if(part==='snowBlade')for(const s of [-1,1])box('snow_deflector',bx,H*.23,s*W*.43,L*.16,H*.3,W*.15,paint,[0,-s*.35,0]);
      if(part==='graderBlade')cyl('grader_rotation_circle',bx,H*.39,0,W*.28,H*.075,dark,[0,0,0]);
    }
  } else if(part==='trenchChain') {
    beam('chain_arm',[L*.1,H*.55,0],[L*.43,H*.12,0],W*.13,dark);
    for(let i=0;i<7;i++)box('chain_tooth',L*(.1+i*.055),H*(.55-i*.071),0,L*.045,H*.04,W*.19,steel);
  } else if(['generator','firePump','pumpUnit','toolCabinet'].includes(part)) {
    box('equipment_skid',x,H*.345,0,span*.76,H*.04,W*.72,steel);
    box(part,x,H*.55,0,span*.75,H*.4,W*.7,part==='generator'?0x6b7975:paint);
    for(let i=0;i<6;i++)for(const s of [-1,1])box('equipment_louver',x-span*.23+i*span*.09,H*.57,s*W*.355,span*.025,H*.22,W*.01,dark);
    if(part==='pumpUnit'||part==='firePump')for(const s of [-1,1])cyl('hose_coupling',x,H*.42,s*W*.37,W*.075,W*.09,steel);
    if(part==='firePump') {
      for(const s of [-1,1]) {
        box('pump_control_panel',x,H*.57,s*W*.357,span*.46,H*.25,W*.018,steel);
        for(const dx of [-.12,0,.12])cyl('pressure_gauge',x+span*dx,H*.61,s*W*.375,W*.042,W*.02,light);
      }
    } else if(part==='pumpUnit') {
      cyl('centrifugal_pump_housing',x-span*.24,H*.51,W*.4,W*.18,W*.21,0x527c91);
      cyl('suction_flange',x-span*.24,H*.51,W*.54,W*.11,W*.12,steel);
    } else if(part==='generator') {
      box('generator_access_door',x,H*.53,W*.36,span*.34,H*.3,W*.025,light);
      box('power_socket_panel',x-span*.24,H*.49,W*.37,span*.12,H*.16,W*.03,dark);
    } else for(const s of [-1,1])for(let i=0;i<4;i++)box('tool_drawer_handle',x,H*(.43+i*.07),s*W*.365,span*.48,H*.015,W*.025,steel);
  } else if(part==='compactor') {
    box('compression_chamber',x+span*.06,H*.6,0,span*.78,H*.49,W*.86);
    box('compactor_roof',x+span*.06,H*.86,0,span*.78,H*.07,W*.68);
    for(const s of [-1,1]) {
      box('chamber_roof_shoulder',x+span*.06,H*.825,s*W*.375,span*.78,H*.12,W*.15,paint,[s*.5,0,0]);
      box('rear_loader_cheek',x-span*.41,H*.57,s*W*.38,span*.23,H*.56,W*.12,paint,[0,0,-.15]);
      beam('tailgate_hydraulic',[x-span*.27,H*.83,s*W*.46],[x-span*.46,H*.44,s*W*.46],W*.055,steel);
      box('bin_lifter',x-span*.53,H*.3,s*W*.25,span*.05,H*.18,W*.06,steel);
    }
    box('tailgate_header',x-span*.39,H*.84,0,span*.24,H*.13,W*.84);
    box('loading_mouth',x-span*.49,H*.46,0,span*.04,H*.25,W*.66,dark);
    box('hopper_loading_sill',x-span*.48,H*.33,0,span*.19,H*.075,W*.8,steel);
  } else if(part==='recyclingBins') {
    for(let i=0;i<3;i++)box('sorted_bin',x+span*(-.32+i*.32),H*.54,0,span*.29,H*.42,W*.85,[0x528c79,0x5785a5,0xceab51][i]);
  } else if(part==='openBed'||part==='recoveryBed') {
    box(part,x,floor,0,span,H*.055,W*.88,steel);
    if(part==='openBed')railings();
    else for(const s of [-1,1])box('loading_ramp',x-span*.48,H*.27,s*W*.3,span*.18,H*.035,W*.19,dark,[0,0,.22]);
  } else if(part==='awning') {
    box('stowed_awning',x,H*.94,W*.45,span,H*.035,W*.07,0xd8bf75);
  } else if(part==='kitchenVent') {
    box('kitchen_hood',x,H*.96,0,span*.3,H*.09,W*.4,steel);
  } else if(part==='servingHatch') {
    box('service_window',x,H*.65,W*.445,span*.69,H*.23,W*.018,dark);
    box('serving_shelf',x,H*.52,W*.49,span*.73,H*.025,W*.13,steel);
  } else if(part==='policeStripe') {
    for(const s of [-1,1])box('police_livery',0,H*.5,s*W*.458,L*.72,H*.1,W*.012,0xc9dbe9);
  } else if(['vanWindows','secureCabin','commandCabin','medicalCabin','camperCabin','bookShelves'].includes(part)) {
    const skin=v.form==='utility'?.402:.445;
    for(const s of [-1,1])for(const dx of [-.32,0]){
      box(part,x+span*dx,H*.68,s*W*skin,span*.23,H*.19,W*.015,part==='bookShelves'?0xba9b67:dark);
      if(part==='secureCabin')for(let i=0;i<4;i++)box('security_grille',x+span*(dx-.09+i*.06),H*.68,s*W*.458,span*.009,H*.2,W*.012,steel);
    }
    if(part==='medicalCabin')for(const s of [-1,1]) {box('medical_mark',x,H*.46,s*W*(skin+.005),span*.18,H*.04,W*.01,0x3c976c);box('medical_mark',x,H*.46,s*W*(skin+.008),span*.045,H*.14,W*.01,0x3c976c);}
    if(part==='camperCabin')box('roof_vent',x,H*.935,0,span*.2,H*.045,W*.36,light);
    if(part==='commandCabin') {
      cyl('satellite_pedestal',x,H*.96,0,W*.09,H*.1,steel,[0,0,0]);
      cyl('stowed_satellite_dish',x,H*1.02,0,W*.24,H*.035,light,[0,0,0]);
    }
    if(part==='secureCabin') {
      box('secure_rear_door',-L*.452,H*.58,0,L*.012,H*.49,W*.68,steel);
      box('secure_door_latch',-L*.462,H*.54,W*.19,L*.015,H*.06,W*.16,dark);
    }
    if(part==='medicalCabin')for(const s of [-1,1]) {
      const rear=v.form==='utility'?-L*.432:-L*.452;
      box('ambulance_rear_door',rear,H*.6,s*W*.19,L*.014,H*.45,W*.36,light);
      box('ambulance_rear_glass',rear-L*.008,H*.72,s*W*.19,L*.005,H*.13,W*.26,dark);
      box('rear_medical_handle',rear-L*.011,H*.53,s*W*.075,L*.008,H*.08,W*.035,steel);
    }
    if(part==='camperCabin') {
      box('camper_entry_door',-L*.29,H*.59,W*.447,L*.12,H*.5,W*.022,light);
      box('camper_entry_window',-L*.29,H*.73,W*.46,L*.085,H*.15,W*.009,dark);
      box('camper_folded_step',-L*.29,H*.35,W*.46,L*.14,H*.055,W*.13,steel);
    }
    if(part==='bookShelves')for(const s of [-1,1]) {
      for(let level=0;level<3;level++) {
        box('library_shelf',x,H*(.52+level*.1),s*W*.475,span*.75,H*.018,W*.09,steel);
        for(let i=0;i<7;i++)box('book_spine',x+span*(-.32+i*.1),H*(.56+level*.1),s*W*.475,span*.065,H*.07,W*.05,[0x885747,0x497e77,0xb39a54][i%3]);
      }
    }
  } else if(part==='fifthWheel') {
    box('fifth_wheel_mount',-L*.23,(1.2+H*.34)/2,0,L*.17,Math.abs(1.2-H*.34)+H*.035,W*.52,steel);
    cyl('fifth_wheel',-L*.23,1.2,0,W*.24,H*.035,dark,[0,0,0]);
  } else throw new RangeError(`專用車設備尚未建模:${part}`);
  return true;
}


/** Filter archetype candidates; returns empty array if no valid profile matches, forbidding arbitrary fallback. */
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
  // Functional parts are mandatory, convenience accessories sampled independently; powertrain determined by power.
  const parts = spec.parts.filter(part => !['rack', 'basket', 'panniers', 'canopy'].includes(part) || r() < .6);
  return { key, seed, name: spec.name, purpose, type: spec.type, power, form: spec.form, habitat: spec.habitat,
    style:spec.style,
    ...vehicleVariants(key,spec,seed,length),
    length, width, height, age, maintenance, wear, paint, fadedPaint: tint(paint, 1 - wear * .25),
    dust: r() * (spec.habitat.includes('street') ? .25 : .65), graffiti, lettering: COPIES[purpose], number, parts,
    coupling:spec.form==='railWagon'||spec.form==='railLocomotive'?{system:'rail',height:.85,gauge:RAIL_GAUGE}
      :spec.form==='semiTrailer'||spec.form==='tractorUnit'?{system:'fifthWheel',height:1.2}:null };
}

/** Vehicle facing +X with ground origin. Parts generated in nominal box before host determines authoritative fit. */
export function vehicleBackgroundObject(key, seed = 0, options = {}) {
  const v = generateVehicle(key, seed, options);
  const { length: L, width: W, height: H } = v;
  const paint = v.fadedPaint, dark = 0x252b30, glass = 0x304959, steel = 0x8d969b;
  const rows = [], plates = [],wheelRows=new Set(),wheelMounts=[];
  const box = (name, x, y, z, l, h, w, c = paint, rotation) => rows.push({ role: name, g: ['box', l, h, w], p: [x, y, z], c, ...(rotation ? { r: rotation } : {}) });
  const cyl = (name, x, y, z, radius, depth, c, rotation = [Math.PI / 2, 0, 0]) => rows.push({ role: name, g: ['cyl', radius, radius, depth, 12], p: [x, y, z], c, r: rotation });
  const beam = (name, a, b, radius, color = steel) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    box(name, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a[2], Math.hypot(dx, dy), radius, radius, color, [0, 0, Math.atan2(dy, dx)]);
  };
  const wheel = (x, radius, z, depth = W * .12) => {
    const first=rows.length,originalRadius=radius;
    radius*=v.wheels.radiusScale;depth*=v.wheels.widthScale;
    if (['cycle','trike'].includes(v.form)) {
      // Rotate 18-segment ring by 90 deg so one sample vertex aligns exactly with lowest ground contact point.
      rows.push({role:'tire',g:['ring',radius*.94,radius*.06],p:[x,radius,z],r:[0,0,Math.PI/2],c:dark});
      cyl('hub',x,radius,z,radius*.1,depth,steel);
      for(let i=0;i<6;i++) {
        const angle=i*Math.PI/3;
        beam('spoke',[x,radius,z],[x+Math.cos(angle)*radius*.9,radius+Math.sin(angle)*radius*.9,z],radius*.025);
      }
      return;
    }
    cyl('tire', x, radius, z, radius, depth, dark);
    cyl('rim', x, radius, z, radius * .5, depth * 1.04, v.wheels.rimStyle==='alloy'?dark:steel);
    if(v.wheels.rimStyle==='alloy'||v.wheels.rimStyle==='steel') {
      const count=v.wheels.rimStyle==='alloy'?6:5,face=z+Math.sign(z)*depth*.535;
      for(let i=0;i<count;i++) {
        const angle=i*Math.PI*2/count;
        if(v.wheels.rimStyle==='alloy')beam('alloy_spoke',[x,radius,face],[x+Math.cos(angle)*radius*.48,radius+Math.sin(angle)*radius*.48,face],radius*.075,steel);
        else cyl('steel_rim_hole',x+Math.cos(angle)*radius*.32,radius+Math.sin(angle)*radius*.32,face,radius*.075,depth*.025,dark);
      }
    }
    for(let i=first;i<rows.length;i++)wheelRows.add(rows[i]);
    wheelMounts.push({x,z,radius,delta:radius-originalRadius});
  };
  const cab = (x, y, l, h, w = W * .82, z = 0) => {
    box('cab', x, y, z, l, h, w);
    box('cab_mount',x,y-h*.5-H*.02,z,l*.84,H*.06,w*.8,dark);
    box('glazing', x, y + h * .12, z, l * .88, h * .55, w * 1.005, glass);
    box('front_windshield', x+l*.502, y+h*.12, z, l*.008, h*.55, w*.84, glass);
    box('windshield_divider', x+l*.507, y+h*.12, z, l*.01, h*.56, w*.025);
    for (const side of [-1, 1]) box('pillar', x, y + h * .12, z + side * w * .502, l * .04, h * .65, W * .025);
  };
  if (v.style) {
    buildIndividualBody(v,{box,cyl,beam,wheel});
  } else if (v.form === 'sedan') {
    for(const x of [-.31,.31]) for(const side of [-1,1]) wheel(L*x,H*.21,side*W*.43,W*.12);
    box('floor',0,H*.29,0,L*.87,H*.09,W*.78,dark);
    box('body',0,H*.48,0,L*.96,H*.3,W*.91);
    box('hood',L*.31,H*.66,0,L*.3,H*.08,W*.85);
    box('trunk',-L*.36,H*.65,0,L*.22,H*.08,W*.85);
    const extended=['hatchback','wagon','limousine'].includes(v.style);
    if(v.style!=='convertible')cab(-L*(extended?.11:.05),H*.78,L*(extended?.58:.43),H*.37,W*.77);
    else box('open_cockpit_floor',-L*.08,H*.66,0,L*.46,H*.07,W*.72,dark);
    for(const [x,angle] of (v.style==='convertible'?[[.195,.55]]:[[.195,.55],[extended?-.405:-.295,-.5]])) {
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
    box('gooseneck_web',L*.28,(1.3+H*.29)/2,0,L*.13,Math.abs(1.3-H*.29)+H*.06,W*.52,steel);
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
    const R = H * (v.style==='folding'?.21:.29), rear = -L * .31, front = L * .31;
    wheel(front, R, 0, W * .13);
    for (const z of v.form === 'trike' ? [-W * .36, W * .36] : [0]) wheel(rear, R, z, W * .13);
    const a = [rear, R, 0], b = [-L * .02, H * .77, 0], c = [L * .07, R, 0], d = [L * .26, H * .8, 0];
    const frameLinks=v.style==='stepThrough'||['scooter','electricScooter','deliveryMoto'].includes(v.style)?[[a,b],[b,c],[c,a],[c,d],[d,[front,R,0]]]:[[a,b],[b,c],[c,a],[b,d],[c,d],[d,[front,R,0]]];
    for (const [p, q] of frameLinks) beam('frame', p, q, W * .06, paint);
    box('saddle', b[0], b[1], 0, L * .17, H * .06, W * .34, dark);
    box('handlebar', d[0], H * .88, 0, L * .025, H * .025, W * .96, steel);
    beam('handlebar_stem',d,[d[0],H*.88,0],W*.04,steel);
    box('pedals', c[0], c[1], 0, L * .06, H * .035, W * .55, dark);
    if (v.form === 'motor') box(v.power==='battery'?'electric_motor':'engine', 0, H * .44, 0, L * .3, H * .24, W * .42, dark);
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
  if (!v.style && ['sedan','truck','bus','utility','railcar'].includes(v.form)) {
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
      for(const z of [-.27,0,.27].slice(0,v.cargo.count)) cyl('timber',-L*.14,H*.48,z*W,W*.13,L*.63,0x77553a,[0,0,Math.PI/2]);
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
  buildVariantEquipment(v,rows,{box,cyl,beam});
  const lift=wheelMounts.length?Math.max(...wheelMounts.map(w=>w.delta))+v.wheels.suspensionLift:0;
  if(lift!==0) {
    for(const row of rows)if(!wheelRows.has(row))row.p[1]+=lift;
    for(const w of wheelMounts)box('suspension_strut',w.x,w.radius+H*.12,Math.sign(w.z)*Math.abs(w.z)*.94,L*.025,H*.27,W*.13,steel);
  }
  // License plates mount on end facades, kept separate from lateral advertising or fleet livery.
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

/** Vehicle facing +X; whitelist recipes only. Consist definition does not simulate articulation physics. */
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
    // Consist retains only tractor front plate and tail wagon rear plate, omitting occluded inter-coupling plates.
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


// Host adapter: decoupled from existing collision contracts without backward derivation.
export function makeSceneVehicleParts(kind, opts = {}) {
  // Containers are independent static logistics props without vehicle chassis.
  if (kind.startsWith('container')) return collisionContract(kind, opts);
  const seed = (opts.paint || 0) ^ Math.round((opts.at?.[0] || 0)*100) ^ Math.round((opts.at?.[2] || 0)*100);
  const key = kind === 'railcar' ? 'tram' : kind==='sedan'?selectRoadCar(seed):kind;
  const model = vehicleBackgroundObject(key, seed);
  const fit = opts.fit || VEHICLE_SPEC[kind];
  if (!fit || !['L','W','H'].every(axis=>Number.isFinite(fit[axis]) && fit[axis]>0)) throw new RangeError('載具宿主缺少正有限 fit');
  const { min,max,size } = model.bounds;
  const factor = Math.min(fit.L/size[0],fit.H/size[1],fit.W/size[2]);
  const crush = opts.crush ?? 1;
  if (!Number.isFinite(crush) || crush <= 0 || crush > 1) throw new RangeError('crush 必須介於 0 與 1');
  const rows = model.parts.map(p=>{
    if (!['box','cylinder'].includes(p.type)) throw new RangeError(`描述子宿主不支援車型零件:${p.type}`);
    const dims=p.type==='box' ? ['box',...p.dimensions.map(n=>n*factor)]
      : ['cyl',p.radii[0]*factor,p.radii[1]*factor,p.height*factor,p.sides];
    const at=[(p.position[0]-(min[0]+max[0])/2)*factor,(p.position[1]-min[1])*factor,(p.position[2]-(min[2]+max[2])/2)*factor];
    // Wreck upper-half collapse preserves grounded wheel posture; handles procedural geometry only.
    if (p.type==='box' && at[1]>fit.H*.5) {
      at[1]=fit.H*.5+(at[1]-fit.H*.5)*crush;
      dims[2]*=crush;
    }
    return {g:dims,p:at,r:p.rotation,c:p.color,role:p.name,...(opts.vc?{vc:opts.vc}:{})};
  });
  const visual=placeParts(rows,opts.at,opts.ry);
  if (!opts.col) return visual;
  // Preserve authoritative collision hulls bit-identical; renderer ignores appearance-less contract entries.
  return [...collisionContract(kind,opts).filter(p=>p.col).map(p=>({...p,collisionOnly:true})),...visual];
}

