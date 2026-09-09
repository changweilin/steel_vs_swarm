import {mulberry32} from './rng.js';

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

// 現有轎車停車格只選相近尺寸民用車；不將軍用車或大型休旅硬塞入格內。
export const ROAD_CAR_WEIGHTS={sedan:24,compactSedan:22,hatchback:22,executiveSedan:10,wagon:10,coupe:5,luxurySedan:4,sportsCar:2,convertible:1};
export function selectRoadCar(seed) {
  let roll=mulberry32(seed^0x524f4144)()*100;
  for(const [key,weight] of Object.entries(ROAD_CAR_WEIGHTS)){roll-=weight;if(roll<0)return key;}
  return 'sedan';
}

