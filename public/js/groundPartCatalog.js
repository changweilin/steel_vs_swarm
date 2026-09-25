// Reference dimensions describe markings, not certified competition installations.
// A single uniform game scale applies to the pitch and its equipment.
const sportVenue = (label, length, width, marking, regions, equipment = []) => ({
  label, length, width, marking, regions, category: 'sport', color: 0x63845b, equipment,
});
export const VENUES = {
  tennis: sportVenue('網球', 23.77, 10.97, 'tennis', ['global'], [['tennisnet', 0, 0, 0]]),
  badminton: sportVenue('羽球', 13.4, 6.1, 'badminton', ['global'], [['badmintonnet', 0, 0, 0]]),
  pickleball: sportVenue('匹克球', 13.4112, 6.096, 'pickleball', ['North America'], [['picklenet', 0, 0, 0]]),
  volleyball: sportVenue('排球', 18, 9, 'volleyball', ['global'], [['volleynet', 0, 0, 0]]),
  beachvolley: sportVenue('沙灘排球', 16, 8, 'beach', ['coastal'], [['beachnet', 0, 0, 0]]),
  soccer: sportVenue('足球', 105, 68, 'soccer', ['global']),
  futsal: sportVenue('五人制足球', 40, 20, 'futsal', ['global']),
  handball: sportVenue('手球', 40, 20, 'handball', ['Europe']),
  fieldhockey: sportVenue('曲棍球', 91.4, 55, 'hockey', ['South Asia', 'Europe', 'Oceania']),
  rugby: sportVenue('橄欖球', 120, 70, 'rugby', ['Oceania', 'Europe', 'Southern Africa']),
  americanfootball: sportVenue('美式足球', 109.728, 48.768, 'football', ['North America']),
  netball: sportVenue('籃網球', 30.5, 15.25, 'netball', ['Oceania', 'Commonwealth']),
  cricket: sportVenue('板球', 120, 110, 'cricket', ['South Asia', 'Commonwealth']),
  baseball: sportVenue('棒球', 110, 110, 'baseball', ['East Asia', 'Americas']),
  softball: sportVenue('壘球', 75, 75, 'softball', ['global']),
  kabaddi: sportVenue('卡巴迪', 13, 10, 'kabaddi', ['South Asia']),
  sepaktakraw: sportVenue('藤球', 13.4, 6.1, 'takraw', ['Southeast Asia'], [['takrawnet', 0, 0, 0]]),
  petanque: sportVenue('法式滾球', 15, 4, 'boules', ['France', 'Mediterranean']),
  bocce: sportVenue('義式滾球', 26.5, 4, 'bocce', ['Italy']),
  gateball: sportVenue('門球', 20, 15, 'gateball', ['Japan', 'East Asia']),
  sumo: sportVenue('相撲土俵', 6.7, 6.7, 'sumo', ['Japan']),
  wrestling: sportVenue('摔角墊', 12, 12, 'wrestling', ['global']),
  archery: sportVenue('射箭練習場', 50, 20, 'archery', ['global']),
  longjump: sportVenue('跳遠助跑與沙坑', 48, 8, 'longjump', ['global']),
  taiwanTemple: { label: '臺灣廟埕', length: 28, width: 22, marking: 'forecourt', regions: ['Taiwan'], category: 'culture', color: 0xb39378, equipment: [['incenseurn', .18, 0, 0], ['lantern', -.3, -.3, 0], ['lantern', -.3, .3, 0]] },
  japaneseGarden: { label: '日本枯山水庭園', length: 24, width: 16, marking: 'raked', regions: ['Japan'], category: 'culture', color: 0xc5c0ad, equipment: [['boulder', .16, .12, 0], ['rockflat', -.17, -.2, 0], ['stonelantern', .3, -.3, 0]] },
  chineseCourtyard: { label: '華人庭院', length: 26, width: 22, marking: 'courtyard', regions: ['East Asia'], category: 'culture', color: 0x96948a, equipment: [['planter', -.3, -.3, 0], ['planter', .3, .3, 0], ['bench', 0, .33, 0]] },
  mediterraneanPlaza: { label: '地中海噴泉廣場', length: 30, width: 24, marking: 'plaza', regions: ['Mediterranean'], category: 'culture', color: 0xc5b496, equipment: [['fountain', 0, 0, 0], ['bench', .3, .3, 0], ['planter', -.3, -.3, 0]] },
  northAfricanCourt: { label: '北非中庭', length: 24, width: 20, marking: 'courtyard', regions: ['North Africa'], category: 'culture', color: 0xc1a17c, equipment: [['fountain', 0, 0, 0], ['planter', -.3, .3, 0], ['planter', .3, -.3, 0]] },
  latinPlaza: { label: '拉丁美洲市集廣場', length: 30, width: 24, marking: 'market', regions: ['Latin America'], category: 'culture', color: 0xb98970, equipment: [['marketstall', -.28, -.28, 0], ['marketstall', .28, -.28, 0], ['bench', 0, .32, 0]] },
  southAsianMaidan: { label: '南亞公共活動空地', length: 38, width: 28, marking: 'commons', regions: ['South Asia'], category: 'culture', color: 0xb3a279, equipment: [['bench', -.3, -.32, 0], ['marketstall', .3, .3, 0]] },
  nordicSquare: { label: '北歐公共廣場', length: 28, width: 24, marking: 'plaza', regions: ['Northern Europe'], category: 'culture', color: 0x959b99, equipment: [['bench', -.3, .3, 0], ['planter', .3, -.3, 0], ['marketstall', .3, .3, 0]] },
};
for (const [id, goal] of Object.entries({soccer:'soccergoal', futsal:'smallgoal', handball:'smallgoal', fieldhockey:'hockeygoal', rugby:'rugbypost', americanfootball:'footballpost', netball:'netballpost'})) {
  const u = id === 'rugby' ? .4 * (VENUES[id].length - 20) / VENUES[id].length : .4;
  VENUES[id].equipment.push([goal, -u, 0, Math.PI / 2], [goal, u, 0, -Math.PI / 2]);
}
VENUES.cricket.equipment.push(['wicket', -20.12 / 120 * .4, 0, Math.PI / 2], ['wicket', 20.12 / 120 * .4, 0, Math.PI / 2]);
VENUES.gateball.equipment.push(['gate', -.25, -.2, 0], ['gate', 0, .2, Math.PI / 2], ['gate', .25, -.2, 0]);
for (const z of [-.25, 0, .25]) VENUES.archery.equipment.push(['target', .35, z, Math.PI / 2]);
for (const id of ['beachvolley', 'petanque', 'bocce', 'sumo', 'longjump']) VENUES[id].color = 0xc3aa7b;
for (const id of ['tennis', 'pickleball', 'netball']) VENUES[id].color = 0x547e99;
for (const id of ['volleyball', 'handball', 'wrestling', 'kabaddi']) VENUES[id].color = 0xb58263;
export const TRACK = { straight: 84.39, radius: 36.5, lane: 1.22, lanes: 8, margin: 12, lineWidth: .45 };
export const TRACK_WIDTH = TRACK.straight + 2 * (TRACK.radius + TRACK.lanes * TRACK.lane + TRACK.margin);
export const TRACK_DEPTH = 2 * (TRACK.radius + TRACK.lanes * TRACK.lane + TRACK.margin);

// Feature patches supplement the continuous carpet. No new shared random stream.
const greenLandscape = (label, pattern, color, parts, limits = {}) => ({
  label, pattern, color, landscape: 'grassland', zone: 'green', parts, ...limits,
});
const bareLandscape = (label, pattern, color, parts, limits = {}) => ({
  label, pattern, color, landscape: 'exposed', zone: 'bare', parts, ...limits,
});
export const LANDSCAPES = {
  mossbed: greenLandscape('苔蘚地', 'moss', 0x70865b, ['rockflat', 'mushroom'], { temperature: [-10, 28] }),
  cloverfield: greenLandscape('三葉草地', 'clover', 0x73945e, ['flower', 'tuft']),
  fernfloor: greenLandscape('蕨類林下地', 'fern', 0x61794e, ['bush', 'mushroom', 'log'], { landscape: 'woodland', temperature: [0, 35] }),
  heathland: greenLandscape('石楠灌叢地', 'heath', 0x877782, ['bush', 'flower', 'pebble'], { temperature: [-15, 28] }),
  prairie: greenLandscape('高草草原', 'prairie', 0x9b9f64, ['miscanthus', 'flower', 'tuft']),
  savannagrass: greenLandscape('稀樹草地', 'savanna', 0xb2a36a, ['drybush', 'sapling', 'tuft'], { temperature: [15, 50] }),
  alpineflowers: greenLandscape('高山花甸', 'heath', 0x849774, ['flower', 'rockflat', 'tuft'], { altitude: [1200, 5000], temperature: [-20, 20], zones: ['green', 'alpine'] }),
  wetmeadow: greenLandscape('濕草甸', 'moss', 0x6e906b, ['reed', 'tuft', 'flower']),
  riparianbrush: greenLandscape('河岸灌叢', 'fern', 0x6c8462, ['reed', 'bush', 'log'], { zones: ['green', 'wet'] }),
  coastalgrass: greenLandscape('海岸草叢', 'prairie', 0xa0aa77, ['miscanthus', 'shell', 'tuft'], { altitude: [-20, 180] }),
  basaltfield: bareLandscape('玄武岩碎地', 'angular', 0x636568, ['boulder', 'rockflat', 'pebble']),
  volcanicash: bareLandscape('火山灰地', 'ash', 0x827d78, ['pebble', 'boulder']),
  chalkground: bareLandscape('白堊裸地', 'chalk', 0xc9c5b0, ['rockflat', 'pebble', 'drybush']),
  sanddunes: bareLandscape('風紋沙地', 'dunes', 0xd0b486, ['shell', 'drybush']),
  shinglebank: bareLandscape('礫石灘', 'shingle', 0xaaa292, ['pebble', 'rockflat', 'shell']),
  saltcrust: bareLandscape('鹽殼地', 'crust', 0xdad5c4, ['saltmound', 'pebble']),
  drylakebed: bareLandscape('乾湖床', 'cracks', 0xb3a58c, ['pebble', 'drybush']),
  erodedclay: bareLandscape('侵蝕黏土地', 'gullies', 0xb17f61, ['spoil', 'pebble', 'drybush']),
  glacialtill: bareLandscape('冰磧裸地', 'shingle', 0xaaa99e, ['boulder', 'pebble', 'rockflat'], { zones: ['bare', 'alpine'], temperature: [-50, 15] }),
  ironstone: bareLandscape('鐵質碎石地', 'angular', 0x9b6650, ['rockflat', 'pebble', 'boulder']),
};

// Each recent natural addition has exactly one authored visitor/service counterpart.
// Equipment anchors and their access paths share normalized patch coordinates.
const siteSpec = (naturalCounterpart, label, layout, equipment) => ({ naturalCounterpart, label, layout, equipment });
export const VISITOR_SITES = {
  mossGarden: siteSpec('mossbed', '苔庭休憩區', 'garden', [['rockflat', -.22, -.2], ['stonelantern', .28, -.24], ['bench', .22, .25]]),
  picnicLawn: siteSpec('cloverfield', '草坪野餐區', 'picnic', [['picnictable', -.23, -.22], ['picnictable', .23, -.22], ['litterbin', .3, .28]]),
  forestLearning: siteSpec('fernfloor', '林下自然教室', 'classroom', [['billboard', 0, -.28], ['bench', -.23, .06], ['bench', .23, .06], ['bench', 0, .28]]),
  heatherGarden: siteSpec('heathland', '石楠花園步道', 'garden', [['planter', -.24, -.24], ['planter', .24, -.24], ['bench', .25, .26]]),
  grasslandCamp: siteSpec('prairie', '草原露營區', 'camp', [['tent', -.23, -.2], ['tent', .23, -.2], ['picnictable', 0, .24]]),
  safariRest: siteSpec('savannagrass', '草原導覽休息站', 'shade', [['marketstall', 0, -.2], ['billboard', -.3, .2], ['bench', .28, .24]]),
  alpineRest: siteSpec('alpineflowers', '高山步道休憩點', 'lookout', [['bench', -.22, -.22], ['billboard', .28, -.22], ['fencepost', -.3, .28], ['fencepost', .3, .28]]),
  wetlandLearning: siteSpec('wetmeadow', '濕地解說廣場', 'classroom', [['billboard', 0, -.25], ['bench', -.25, .18], ['bench', .25, .18]]),
  riversidePicnic: siteSpec('riparianbrush', '河岸野餐休憩地', 'picnic', [['picnictable', -.22, -.2], ['bench', .24, -.2], ['litterbin', .3, .25]]),
  coastalRest: siteSpec('coastalgrass', '海岸步道休息站', 'lookout', [['bench', -.24, -.2], ['bench', .24, -.2], ['billboard', .28, .28]]),
  basaltExhibit: siteSpec('basaltfield', '玄武岩戶外展示場', 'exhibit', [['boulder', -.24, -.2], ['rockflat', .24, -.2], ['billboard', 0, .26]]),
  volcanoVisitor: siteSpec('volcanicash', '火山地質導覽站', 'shade', [['marketstall', 0, -.23], ['billboard', -.28, .22], ['bench', .27, .22]]),
  chalkTrailhead: siteSpec('chalkground', '白堊地步道入口', 'trailhead', [['billboard', -.27, -.22], ['bench', .27, -.22], ['litterbin', .3, .25]]),
  desertCamp: siteSpec('sanddunes', '沙地營地', 'camp', [['tent', -.23, -.2], ['tent', .23, -.2], ['picnictable', 0, .24]]),
  beachRest: siteSpec('shinglebank', '礫灘休憩廣場', 'picnic', [['picnictable', -.24, -.2], ['marketstall', .24, -.2], ['litterbin', .3, .26]]),
  saltInterpretation: siteSpec('saltcrust', '鹽地文化解說場', 'exhibit', [['saltmound', -.24, -.2], ['saltmound', .24, -.2], ['billboard', 0, .26]]),
  stargazingSite: siteSpec('drylakebed', '乾湖觀星集合地', 'circle', [['bench', -.27, -.22], ['bench', .27, -.22], ['billboard', .3, .26]]),
  clayWorkshop: siteSpec('erodedclay', '陶土戶外體驗場', 'workshop', [['marketstall', 0, -.25], ['picnictable', -.23, .2], ['crate', .26, .22]]),
  moraineLookout: siteSpec('glacialtill', '冰磧地觀景休息點', 'lookout', [['bench', 0, -.24], ['billboard', .28, .24], ['rockflat', -.27, .24]]),
  miningHeritage: siteSpec('ironstone', '礦業遺產展示地', 'exhibit', [['boulder', -.25, -.22], ['crate', .25, -.22], ['billboard', 0, .26]]),
};
for (const value of Object.values(VISITOR_SITES)) {
  const natural = LANDSCAPES[value.naturalCounterpart];
  Object.assign(value, { zone: natural.zone, length: 28, width: 22,
    color: natural.color, temperature: natural.temperature, altitude: natural.altitude });
}
// Nominal envelopes in metres; procedural builders vary joints, panels and silhouettes.
export const GROUND_PARTS = {
  tuft: ['blade', .7, 1, .7, 'grass'], rice: ['blade', .38, .95, .38, 'grass'],
  reed: ['blade', .45, 1.7, .45, 'grass'], miscanthus: ['blade', .8, 1.9, .8, 'grass'],
  weed: ['blade', .5, .7, .5, 'grass'], flower: ['flower', .4, .6, .4, 'palette'],
  bush: ['crown', 1.5, 1.2, 1.5, 'foliage'], drybush: ['crown', 1.3, .9, 1.3, 0xa08c58],
  cabbage: ['crown', .65, .5, .65, 'foliage'], sapling: ['tree', 1.6, 2.4, 1.6, 'foliage'],
  bamboo: ['tree', .75, 2.9, .75, 'foliage'], snag: ['snag', .6, 3, .6, 0x89735a],
  charsnag: ['snag', .55, 2.6, .55, 0x443b36],
  pebble: ['rock', .7, .35, .6, 0x9e9889], boulder: ['rock', 2, 1.5, 1.8, 0x89877b],
  rockflat: ['rock', 1.3, .4, 1.1, 0x999082], iceshard: ['rock', .85, 1, .7, 0xc9e5eb],
  saltmound: ['rock', 1.3, .8, 1.1, 0xe7e8df], spoil: ['rock', 2.3, 1, 2, 0xa08b6e],
  slab: ['rock', 1.8, .6, 1.2, 0x9a9b96],
  log: ['log', 3.2, .65, .65, 0x96734b], logpile: ['logs', 3.1, 1.2, 1.3, 0xa17c50],
  stump: ['stump', .9, .6, .9, 0x8e704b], hay: ['log', 1.6, 1.5, 1.5, 0xc2a35a],
  plank: ['crate', 2.1, .6, .9, 0xbc9c69], crate: ['crate', .95, .85, .95, 0xb99862],
  cabin: ['hut', 3.4, 2.4, 2.8, 0x88704f], ghouse: ['hut', 3.5, 1.8, 2.2, 0xc7d4cb],
  vinerow: ['trellis', 3.1, 1.5, .7, 'foliage'], fencepost: ['post', .15, 1.2, .15, 0x8c704c],
  pipe: ['pipe', 2.7, .9, .9, 0xa7b0b2], drum: ['drum', .68, .95, .68, 'palette'],
  barrier: ['crate', 1.7, .75, .38, 0xd7d4bf], canopy: ['canopy', 4.6, 3.4, 3.2, 0xd2d7d2],
  pump: ['pump', .6, 1.3, .45, 'palette'], container: ['container', 6.058, 2.591, 2.438, 'palette'],
  carwreck: ['car', 4.8, 1.45, 1.9, 'palette'], solarpanel: ['solar', 2.5, 1.1, 1.5, 0x345879],
  solar_carport: ['solar', 4.6, 2.8, 2.4, 0x345879], solar_pasture: ['solar', 3.8, 2.7, 2.2, 0x345879],
  solar_aquaculture: ['solar', 3.6, 2.8, 2.4, 0x345879],
  car: ['car', 4.3, 1.4, 1.85, 'palette'], motorcycle: ['motorcycle', 1.85, 1.15, 0.75, 'palette'],
  bench: ['bench', 1.7, .95, .65, 0x9e774c], headstone: ['stone', .6, .9, .25, 0xb2b4aa],
  billboard: ['sign', 3.8, 3.8, .3, 'palette'], planter: ['planter', 1.1, 1.4, 1.1, 0xb47a50],
  hoop: ['hoop', 1.8, 3.65, .8, 0xe9ece5],
  lotuspad: ['leaf', 1.1, .12, 1, 'foliage'], fish: ['fish', 1, .22, .3, 0xd1a065],
  shell: ['shell', .4, .15, .32, 0xe5d9ba], mushroom: ['mushroom', .4, .4, .4, 0xb17a50],
  shrine: ['shrine', 2.2, 2.5, 2.0, 0xb71c1c],
  pingpong_table: ['pingpong', 2.74, 0.85, 1.53, 0x1976d2],
  pool_table: ['pool', 2.75, 0.85, 1.55, 0x2e7d32],
  sofa: ['sofa', 2.2, 0.85, 1.4, 0x546e7a],
  table_chairs: ['table_chairs', 2.0, 2.2, 2.0, 0x616161],
  gazebo: ['gazebo', 4.2, 3.6, 4.2, 0x8d6e63],
  parking_garage: ['garage', 8.5, 5.8, 7.5, 0x788086],
};
export const PART_VARIATION = { count: 3, size: [.88, 1.08], segments: [5, 9], branches: [3, 6], blades: [5, 9] };
Object.assign(GROUND_PARTS, {
  picnictable: ['picnic', 2.1, .85, 1.7, 0xa8875d],
  tent: ['tent', 2.6, 1.7, 2.8, 0xb49157], litterbin: ['bin', .55, .9, .55, 0x63776d],
  tennisnet: ['net', 12.8, 1.07, .12, 0xe6e2cf], badmintonnet: ['net', 6.3, 1.55, .12, 0xe6e2cf],
  picklenet: ['net', 6.3, .914, .12, 0xe6e2cf], volleynet: ['net', 10, 2.43, .12, 0xe6e2cf],
  beachnet: ['net', 9, 2.43, .12, 0xe6e2cf], takrawnet: ['net', 6.3, 1.55, .12, 0xe6e2cf],
  soccergoal: ['goal', 7.32, 2.44, 1.5, 0xe9e8dd], smallgoal: ['goal', 3, 2, 1, 0xe9e8dd],
  hockeygoal: ['goal', 3.66, 2.14, 1.2, 0xe9e8dd], rugbypost: ['uprights', 5.6, 8, .2, 0xe9e8dd],
  footballpost: ['uprights', 5.64, 9, .2, 0xeec65d], netballpost: ['netball', .4, 3.05, .4, 0xe9e8dd],
  wicket: ['wicket', .229, .711, .06, 0xc5ab77], gate: ['goal', .22, .2, .04, 0xe9e8dd],
  target: ['target', 1.22, 1.8, .3, 0xe9e8dd], incenseurn: ['urn', 1.4, 1.3, 1.4, 0x8c7455],
  fountain: ['fountain', 3, 1.8, 3, 0xb4aa94], stonelantern: ['lantern', .8, 1.7, .8, 0x999b91],
  lantern: ['lantern', .6, 2.4, .6, 0xb94739], marketstall: ['stall', 3, 2.5, 2, 0xbf9366],
});

// scatter: [minimum count, maximum count, minimum scale, maximum scale, probability].
// rows: [X spacing, Z spacing, cap, missing fraction, minimum scale, maximum scale].
// fixed: [type, local X / width, local Z / depth, heading in radians, scale].
export const GROUND_ATTACHMENTS = {
  turf: { scatter: { tuft: [3, 7, .7, 1.3], weed: [2, 6, .7, 1.2], flower: [2, 5, .7, 1.1, .7] } },
  lawn: { scatter: { tuft: [3, 6, .7, 1.2], weed: [1, 3, .6, 1], flower: [1, 3, .7, 1.1, .4] } },
  meadow: { scatter: { miscanthus: [9, 16, .9, 1.6], tuft: [3, 5, 1, 1.7], weed: [3, 5, .7, 1.2] } },
  bushfield: { scatter: { bush: [5, 9, .8, 1.7], tuft: [2, 4, .7, 1.2], weed: [2, 4, .7, 1.1] } },
  flowerfield: { scatter: { flower: [12, 20, .8, 1.4], tuft: [3, 5, .6, 1], weed: [2, 4, .6, 1] } },
  orchard: { rows: { sapling: [5, 5, 14, .2, .9, 1.4] } },
  paddy: { rows: { rice: [2.8, 2.6, 34, .15, .8, 1.2] } },
  dryfield: { scatter: { hay: [1, 2, .8, 1.3, .6], pebble: [2, 4, .5, 1] } },
  teafield: { rows: { bush: [2.6, 3.4, 28, .12, .45, .7] }, scatter: { tuft: [2, 4, .5, .8] } },
  veggiefield: { rows: { cabbage: [1.7, 2.4, 36, .15, .8, 1.3] }, scatter: { fencepost: [3, 6, .9, 1.2, .5] } },
  pasture: { scatter: { fencepost: [6, 10, 1, 1.3], tuft: [7, 12, .8, 1.4], weed: [2, 4, .6, 1], hay: [1, 3, .9, 1.3, .55] } },
  wild: { scatter: { pebble: [3, 6, .5, 1.3], tuft: [3, 5, .6, 1], drybush: [2, 4, .7, 1.2], boulder: [1, 3, .7, 1.2, .35], weed: [2, 4, .7, 1.1], miscanthus: [1, 3, .8, 1.3], flower: [1, 2, .6, .9, .15], shrine: [1, 1, .9, 1.1, .25], gazebo: [1, 1, .9, 1.1, .2], table_chairs: [1, 2, .9, 1.1, .25], sofa: [1, 1, .9, 1.1, .2], pool_table: [1, 1, .9, 1.1, .15] } },
  gravel: { scatter: { pebble: [6, 12, .5, 1.4], boulder: [2, 4, .8, 1.5, .3], rockflat: [2, 4, .7, 1.2, .3], weed: [1, 3, .6, 1], gazebo: [1, 1, .9, 1.1, .2], table_chairs: [1, 2, .9, 1.1, .25] } },
  sand: { scatter: { pebble: [4, 7, .7, 1.8], shell: [3, 6, .8, 1.4], drybush: [1, 2, .6, 1, .5], gazebo: [1, 1, .9, 1.1, .3], table_chairs: [1, 2, .9, 1.1, .4], sofa: [1, 1, .9, 1.1, .25] } },
  mud: { scatter: { pebble: [2, 4, .5, .9], weed: [2, 4, .6, .9], reed: [2, 4, .6, 1] } },
  crackedearth: { scatter: { pebble: [2, 4, .5, .9], weed: [2, 4, .6, .9], drybush: [1, 3, .6, 1] } },
  redsoil: { scatter: { pebble: [2, 4, .5, .9], tuft: [1, 3, .5, .8], weed: [1, 3, .6, .9] } },
  marsh: { scatter: { reed: [8, 14, .8, 1.4], tuft: [3, 5, .6, 1.1], log: [1, 2, .7, 1, .4], fish: [2, 4, .7, 1.1] } },
  lotus: { scatter: { lotuspad: [12, 20, .8, 1.6], reed: [4, 6, .7, 1.2], fish: [3, 6, .8, 1.3] } },
  watertile: { scatter: { reed: [1, 3, .7, 1.1], fish: [3, 7, .8, 1.4] },
    contexts: { pond: { lotuspad: [5, 9, .8, 1.3] }, lake: { reed: [5, 9, .8, 1.4] }, spring: { reed: [1, 2, .6, 1] } } },
  deepwater: { scatter: { fish: [4, 8, 1, 1.8], lotuspad: [1, 2, .7, 1, .15] } },
  arrowbamboo: { scatter: { bamboo: [6, 12, .8, 1.4], tuft: [3, 6, .6, 1], mushroom: [2, 4, .8, 1.2] } },
  deadwood: { scatter: { snag: [3, 6, .7, 1.2], log: [2, 4, .8, 1.2], mushroom: [2, 5, .8, 1.3] } },
  fallenlogs: { scatter: { log: [4, 7, .7, 1.4], stump: [2, 4, .7, 1.2], mushroom: [2, 5, .8, 1.3], tuft: [2, 4, .6, 1] } },
  deadforest: { scatter: { charsnag: [3, 7, .7, 1.3], log: [2, 4, .8, 1.2], mushroom: [1, 3, .7, 1.1] } },
  clearcut: { scatter: { stump: [4, 8, .7, 1.3], log: [2, 4, .8, 1.2], weed: [3, 6, .6, 1] } },
  lumberyard: { rows: { logpile: [4, 2.4, 12, .25, .8, 1.2] }, scatter: { plank: [2, 4, .8, 1.2] } },
  rottencabin: { scatter: { cabin: [1, 2, .8, 1.2], plank: [2, 4, .7, 1.1], weed: [4, 7, .6, 1] } },
  vineyard: { rows: { vinerow: [4, 3, 24, .15, .8, 1.2] } },
  greenhouse: { rows: { ghouse: [4.5, 3.2, 12, .15, .9, 1.1] } },
  abandonedfarm: { scatter: { weed: [6, 12, .7, 1.2], hay: [1, 3, .8, 1.2], fencepost: [3, 6, .8, 1.2] } },
  slabruin: { scatter: { slab: [3, 6, .8, 1.4], pebble: [3, 6, .6, 1.2], weed: [2, 4, .6, 1], shrine: [1, 1, .9, 1.1, .3], gazebo: [1, 1, .9, 1.1, .25], sofa: [1, 1, .9, 1.1, .2], pool_table: [1, 1, .9, 1.1, .15] } },
  steppe: { scatter: { tuft: [5, 9, .6, 1], drybush: [2, 4, .7, 1.2], pebble: [3, 6, .5, 1] } },
  saltpan: { scatter: { saltmound: [3, 6, .7, 1.3], pebble: [2, 4, .5, .9] } },
  quarry: { scatter: { rockflat: [4, 7, .9, 1.7], spoil: [1, 3, .8, 1.4], boulder: [1, 3, .7, 1.2] } },
  plateau: { scatter: { rockflat: [3, 6, .8, 1.4], boulder: [1, 3, .7, 1.2], tuft: [3, 6, .6, 1], shrine: [1, 1, .9, 1.1, .25], gazebo: [1, 1, .9, 1.1, .25], table_chairs: [1, 2, .9, 1.1, .3] } },
  icefield: { scatter: { iceshard: [6, 11, .7, 1.5], pebble: [1, 3, .4, .8], boulder: [1, 2, .6, 1, .5] } },
  scree: { scatter: { pebble: [9, 16, .5, 1.4], rockflat: [3, 5, .7, 1.3], boulder: [1, 3, .6, 1.1], shrine: [1, 1, .9, 1.1, .2], gazebo: [1, 1, .9, 1.1, .2] } },
  construction: { scatter: { pipe: [1, 3, .9, 1.3], spoil: [1, 3, .8, 1.3], barrier: [3, 5, .9, 1.2], plank: [1, 3, .8, 1.1], drum: [2, 4, .9, 1.1], crate: [1, 3, .9, 1.2] } },
  gasstation: { fixed: [['canopy', 0, 0, 0, 1.1]], scatter: { drum: [2, 4, .9, 1.1] } },
  park: { scatter: { sapling: [4, 7, .9, 1.4], bench: [1, 3, .9, 1.1], flower: [8, 12, .7, 1.2], tuft: [3, 5, .6, 1], planter: [1, 3, .9, 1.1, .5], gazebo: [1, 1, .9, 1.1, .35], pingpong_table: [1, 2, .9, 1.1, .4], pool_table: [1, 1, .9, 1.1, .2], table_chairs: [1, 3, .9, 1.1, .5], shrine: [1, 1, .9, 1.1, .25], sofa: [1, 2, .9, 1.1, .3] } },
  plaza: { scatter: { bench: [2, 4, .9, 1.1], planter: [2, 4, .9, 1.1], billboard: [1, 2, .9, 1.05, .4] } },
  concrete: { scatter: { bench: [1, 2, .9, 1.1, .4], drum: [1, 2, .9, 1.1, .3], crate: [1, 2, .9, 1.2, .3], planter: [1, 3, .9, 1.1, .35], bush: [1, 3, .7, 1.1, .3], sapling: [1, 2, .9, 1.2, .25], billboard: [1, 2, .9, 1.05, .22], flower: [2, 4, .7, 1, .3], weed: [3, 5, .6, .9], container: [1, 2, .9, 1.1, .15], solarpanel: [1, 2, .9, 1.1, .12], table_chairs: [1, 2, .9, 1.1, .35], sofa: [1, 2, .9, 1.1, .25], shrine: [1, 1, .9, 1.1, .2], gazebo: [1, 1, .9, 1.1, .2], pool_table: [1, 1, .9, 1.1, .15] } },
  pavement: { scatter: { bench: [1, 2, .9, 1.1, .4], planter: [1, 2, .9, 1.1, .35], flower: [2, 4, .7, 1], weed: [2, 4, .6, .9], table_chairs: [1, 2, .9, 1.1, .4], sofa: [1, 1, .9, 1.1, .25], shrine: [1, 1, .9, 1.1, .2], pingpong_table: [1, 1, .9, 1.1, .2] } },
  brick: { scatter: { planter: [1, 2, .9, 1.1, .35], flower: [2, 4, .7, 1], weed: [2, 4, .6, .9] } },
  parking: { scatter: { billboard: [1, 2, .9, 1.1, .5], planter: [1, 3, .9, 1.1], weed: [2, 4, .6, .9], car: [4, 8, .98, 1.02, 1], motorcycle: [3, 7, .98, 1.02, 1], parking_garage: [1, 1, 0.9, 1.1, 0.25] } },
  court: { fixed: [['hoop', -.42, 0, Math.PI / 2, 1], ['hoop', .42, 0, -Math.PI / 2, 1], ['bench', 0, -.44, 0, .75], ['bench', 0, .44, Math.PI, .75]] },
  track: { fixed: [['bench', 0, -.44, 0, .75], ['bench', 0, .44, Math.PI, .75]] },
  helipad: {},
  scrapyard: { scatter: { carwreck: [4, 7, .9, 1.3], drum: [2, 4, .9, 1.1], crate: [1, 3, .9, 1.2], pipe: [1, 3, .7, 1], pebble: [2, 4, .5, .9], weed: [3, 6, .6, 1] } },
  containeryard: { rows: { container: [7.4, 3.4, 26, .15, .9, 1.1] }, scatter: { crate: [2, 4, .8, 1.1] } },
  cemetery: { rows: { headstone: [2.2, 2.6, 24, .25, .9, 1.2] }, scatter: { sapling: [1, 3, .9, 1.2] } },
  solarfarm: { rows: { solarpanel: [2.65, 1.65, 140, 0, .98, 1.02] } },
  fishpond: { scatter: { reed: [6, 10, .7, 1.1], lotuspad: [3, 6, .7, 1.1, .4], fish: [3, 7, .8, 1.3] } },
};
export const GROUND_PART_PALETTES = {
  flower: [0xe88bb0, 0xf2d24a, 0xf5f5f5, 0xc77ddb, 0xe8734a],
  container: [0xd94f3d, 0x3d7ad9, 0x4f9a55, 0xe8a03d, 0x8a8f96],
  carwreck: [0x9a4a3a, 0x5a6a7a, 0x7a6a3a, 0x4a5a4a, 0x8a3a2a],
  car: [0x2f528f, 0xc0392b, 0xecf0f1, 0x2c3e50, 0x7f8c8d, 0xd35400, 0x27ae60],
  motorcycle: [0xc0392b, 0x2980b9, 0x2c3e50, 0xd35400, 0x7f8c8d, 0x16a085],
  pump: [0xd94f3d, 0x3d6ed9, 0xf2d24a], drum: [0x3d6ed9, 0xd94f3d, 0x4f9a55, 0xd9b23d, 0x8a8f96],
  billboard: [0xe8734a, 0x3d7ad9, 0xf2d24a, 0x4f9a55, 0xc77ddb],
};

for (const [id, venue] of Object.entries(VENUES)) {
  GROUND_ATTACHMENTS[id] = { fixed: venue.equipment.map(([type, x, z, heading]) =>
    [type, x, z, heading, 1]), referenceWidth: venue.length / .8 };
}
for (const [id, landscape] of Object.entries(LANDSCAPES)) {
  GROUND_ATTACHMENTS[id] = { scatter: Object.fromEntries(landscape.parts.map(type =>
    [type, ['boulder', 'log', 'sapling', 'spoil'].includes(type) ? [1, 3, .6, 1.1] : [4, 9, .5, 1.2]])) };
}
for (const [id, site] of Object.entries(VISITOR_SITES)) {
  GROUND_ATTACHMENTS[id] = { fixed: site.equipment.map(([type, x, z]) => [type, x, z, 0, 1]) };
}
