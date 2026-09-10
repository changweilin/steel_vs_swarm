// 圖資功能語意單一來源；明確用途先於建築舊形制與環境猜測。
// styles 是封閉候選池，文化偏好只可調整池內權重。
export const BUILDING_FUNCTIONS = Object.freeze({
  hospital: { label: '醫院', category: 'medical', styles: ['modern', 'brutalist_concrete'], range: 'commercial_office', landmark: 'hospital' },
  clinic: { label: '診所／健康中心', category: 'medical', styles: ['modern', 'tile_apartment'], range: 'residential_townhouse' },
  school: { label: '學校', category: 'education', styles: ['modern', 'deco', 'brutalist_concrete'], range: 'tourism_visitor', landmark: 'school' },
  university: { label: '大學／學院', category: 'education', styles: ['modern', 'deco', 'brutalist_concrete'], range: 'commercial_office', landmark: 'school' },
  kindergarten: { label: '幼兒園', category: 'education', styles: ['modern', 'suburban_shed'], range: 'tourism_visitor', landmark: 'school' },
  library: { label: '圖書館', category: 'education', styles: ['deco', 'modern', 'brutalist_concrete'], range: 'tourism_cultural' },
  station: { label: '鐵路車站', category: 'transport', styles: ['deco', 'modern', 'industrial'], range: 'tourism_visitor', landmark: 'station' },
  bus_station: { label: '公車轉運站', category: 'transport', styles: ['modern', 'industrial'], range: 'tourism_visitor', landmark: 'station' },
  terminal: { label: '機場／渡輪航廈', category: 'transport', styles: ['modern', 'brutalist_concrete'], range: 'commercial_retail' },
  hangar: { label: '機庫', category: 'transport', styles: ['industrial', 'brutalist_concrete'], range: 'industrial_warehouse' },
  parking: { label: '停車樓', category: 'transport', styles: ['brutalist_concrete', 'modern'], range: 'commercial_retail' },
  museum: { label: '博物館', category: 'tourism', styles: ['deco', 'brutalist_concrete', 'modern'], range: 'tourism_cultural', landmark: 'museum' },
  theatre: { label: '劇院／音樂廳／電影院', category: 'tourism', styles: ['deco', 'modern', 'baroque_mansard'], range: 'tourism_cultural' },
  civic: { label: '市政廳／法院／公共服務', category: 'civic', styles: ['deco', 'modern', 'brutalist_concrete'], range: 'tourism_cultural' },
  emergency: { label: '消防／警察／救護站', category: 'civic', styles: ['modern', 'brutalist_concrete'], range: 'tourism_visitor' },
  sports: { label: '體育館／運動中心', category: 'civic', styles: ['modern', 'industrial'], range: 'commercial_retail' },
  stadium: { label: '體育場', category: 'civic', styles: ['modern', 'industrial'], range: 'commercial_retail', landmark: 'stadium' },
  hotel: { label: '旅館', category: 'commercial', styles: ['modern', 'deco', 'baroque_mansard'], range: 'commercial_office' },
  market: { label: '市場／商場', category: 'commercial', styles: ['industrial', 'deco', 'modern'], range: 'commercial_retail' },
  plant: { label: '發電廠', category: 'industrial', styles: ['industrial', 'brutalist_concrete'], range: 'industrial_power' },
  substation: { label: '變電站', category: 'industrial', styles: ['brutalist_concrete', 'industrial'], range: 'industrial_power' },
  generator: { label: '發電設備', category: 'industrial', styles: ['industrial'], range: 'industrial_power' },
  power_tower: { label: '輸電塔', category: 'utility', styles: ['industrial'], range: 'industrial_power', landmark: 'power', structureOnly: true },
  water: { label: '淨水／污水處理設施', category: 'utility', styles: ['industrial', 'brutalist_concrete'], range: 'industrial_factory' },
  factory: { label: '工廠／工坊', category: 'industrial', styles: ['industrial', 'brutalist_concrete'], range: 'industrial_factory', landmark: 'factory' },
  warehouse: { label: '倉庫／物流庫房', category: 'industrial', styles: ['industrial', 'brutalist_concrete'], range: 'industrial_warehouse', landmark: 'factory' },
  greenhouse: { label: '溫室', category: 'rural', styles: ['greenhouse_glass'], range: 'rural_greenhouse' },
  church: { label: '教堂／禮拜堂', category: 'religious', styles: ['gothic_spire', 'baroque_mansard'], range: 'tourism_cultural', landmark: 'church' },
  temple: { label: '佛道儒殿宇', category: 'religious', styles: ['xieshan_temple', 'east_asian_palace'], range: 'tourism_cultural', landmark: 'temple' },
  mosque: { label: '清真寺', category: 'religious', styles: ['islamic_vault'], range: 'tourism_cultural', landmark: 'mosque' },
  shrine: { label: '神社', category: 'religious', styles: ['xieshan_temple', 'traditional_curved'], range: 'tourism_visitor', landmark: 'shrine' },
  mandir: { label: '印度教寺廟', category: 'religious', styles: ['east_asian_palace'], roofForm: 'spire', range: 'tourism_cultural', landmark: 'mandir' },
  synagogue: { label: '猶太會堂', category: 'religious', styles: ['deco', 'baroque_mansard'], range: 'tourism_cultural', landmark: 'synagogue' },
  gurdwara: { label: '錫克教謁師所', category: 'religious', styles: ['deco'], roofForm: 'dome', range: 'tourism_cultural', landmark: 'gurdwara' },
  stupa: { label: '佛塔', category: 'religious', styles: ['earthen'], roofForm: 'dome', range: 'tourism_cultural', landmark: 'stupa' },
  pagoda: { label: '樓閣式塔', category: 'religious', styles: ['courtyard'], range: 'tourism_cultural', landmark: 'pagoda' },
  worship: { label: '未細分類宗教場所', category: 'religious', styles: ['brutalist_concrete'], range: 'tourism_visitor' },
  castle: { label: '城堡／堡壘', category: 'heritage', styles: ['baroque_mansard', 'gothic_spire'], range: 'tourism_cultural', landmark: 'castle' },
  heritage: { label: '歷史建築', category: 'heritage', styles: ['deco', 'baroque_mansard', 'minnan_brick', 'siheyuan_courtyard'], range: 'tourism_cultural' },
  ruins: { label: '遺址／廢墟', category: 'heritage', styles: ['earthen'], range: 'tourism_visitor', structureOnly: true },
  monument: { label: '紀念碑／紀念物', category: 'heritage', styles: ['deco'], range: 'tourism_visitor', structureOnly: true },
  pyramid: { label: '金字塔', category: 'heritage', styles: ['earthen'], range: 'tourism_cultural', landmark: 'pyramid', structureOnly: true },
  lighthouse: { label: '燈塔', category: 'transport', styles: ['brutalist_concrete'], range: 'tourism_cultural', landmark: 'lighthouse', structureOnly: true },
});

const amenityTypes = {
  hospital: 'hospital', clinic: 'clinic', doctors: 'clinic', dentist: 'clinic',
  school: 'school', university: 'university', college: 'university', kindergarten: 'kindergarten', library: 'library',
  bus_station: 'bus_station', ferry_terminal: 'terminal',
  theatre: 'theatre', cinema: 'theatre', music_venue: 'theatre', arts_centre: 'museum',
  townhall: 'civic', courthouse: 'civic', community_centre: 'civic', social_facility: 'civic',
  fire_station: 'emergency', police: 'emergency', ambulance_station: 'emergency', marketplace: 'market',
};
const buildingTypes = {
  hospital: 'hospital', school: 'school', university: 'university', college: 'university', kindergarten: 'kindergarten',
  train_station: 'station', transportation: 'station', terminal: 'terminal', hangar: 'hangar', parking: 'parking',
  museum: 'museum', church: 'church', cathedral: 'church', chapel: 'church', temple: 'temple', mosque: 'mosque',
  shrine: 'shrine', synagogue: 'synagogue', gurdwara: 'gurdwara', stupa: 'stupa', pagoda: 'pagoda',
  castle: 'castle', ruins: 'ruins', pyramid: 'pyramid', lighthouse: 'lighthouse', hotel: 'hotel', retail: 'market', supermarket: 'market',
  industrial: 'factory', factory: 'factory', warehouse: 'warehouse', depot: 'warehouse', greenhouse: 'greenhouse',
  sports_hall: 'sports', stadium: 'stadium', civic: 'civic', fire_station: 'emergency',
};
const religions = { christian: 'church', muslim: 'mosque', buddhist: 'temple', taoist: 'temple', confucian: 'temple', shinto: 'shrine', hindu: 'mandir', jewish: 'synagogue', sikh: 'gurdwara' };
const powerTypes = { tower: 'power_tower', plant: 'plant', substation: 'substation', generator: 'generator', transformer: 'substation' };
const normalized = value => String(value || '').trim().toLowerCase();
const lookup = (table, key) => Object.hasOwn(table, key) ? table[key] : null;

export function taggedBuildingFunction(tags = {}) {
  const b = normalized(tags.building || tags['building:part']);
  const a = normalized(tags.amenity);
  let type = lookup(powerTypes, normalized(tags.power)) || lookup(amenityTypes, a);
  if (!type && a === 'place_of_worship') {
    type = ['stupa', 'pagoda'].includes(b) ? b : lookup(religions, normalized(tags.religion)) ||
      (BUILDING_FUNCTIONS[lookup(buildingTypes, b)]?.category === 'religious' ? lookup(buildingTypes, b) : 'worship');
  }
  if (!type && normalized(tags.healthcare)) type = ['hospital', 'clinic'].includes(normalized(tags.healthcare)) ? normalized(tags.healthcare) : null;
  if (!type && ['museum', 'gallery', 'hotel', 'motel', 'hostel'].includes(normalized(tags.tourism))) type = ['museum', 'gallery'].includes(normalized(tags.tourism)) ? 'museum' : 'hotel';
  if (!type && normalized(tags.railway) === 'station') type = 'station';
  if (!type && ['terminal', 'hangar'].includes(normalized(tags.aeroway))) type = normalized(tags.aeroway);
  if (!type && ['water_works', 'wastewater_plant', 'pumping_station'].includes(normalized(tags.man_made))) type = 'water';
  if (!type && normalized(tags.man_made) === 'lighthouse') type = 'lighthouse';
  if (!type && normalized(tags.leisure) === 'sports_centre') type = 'sports';
  if (!type && normalized(tags.leisure) === 'stadium') type = 'stadium';
  if (!type && a === 'parking' && normalized(tags.parking) === 'multi-storey') type = 'parking';
  if (!type && b === 'temple') type = lookup(religions, normalized(tags.religion));
  if (!type) type = lookup(buildingTypes, b);
  if (!type && ['castle', 'fort', 'manor', 'ruins', 'archaeological_site', 'building', 'monument', 'memorial'].includes(normalized(tags.historic))) {
    const historic = normalized(tags.historic);
    type = ['castle', 'fort'].includes(historic) ? 'castle' : ['ruins', 'archaeological_site'].includes(historic) ? 'ruins' : ['monument', 'memorial'].includes(historic) ? 'monument' : 'heritage';
  }
  if (!type && tags.heritage && !['no', '0'].includes(normalized(tags.heritage))) type = 'heritage';
  if (!type) return null;
  const rule = BUILDING_FUNCTIONS[type];
  return { category: rule.category, type, key: rule.range, locked: true, label: rule.label, structureOnly: !!rule.structureOnly };
}
