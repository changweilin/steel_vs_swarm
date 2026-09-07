// ============ 建築文化風格、功能分區、立面材質與屋頂幾何型錄 ============
// 文化／年代是視覺語彙，不改寫圖資的實際用途；比例皆為相對權重。
// 依座標位置所屬國家與文化圈加權，符合在地文化者占 60% (CULTURAL_AFFINITY_RATIO)。

/** 12 款屋頂外觀分類 */
export const ROOF_FORMS = Object.freeze({
  flat: '平頂',
  shed: '單邊斜頂',
  gable: '雙邊斜頂',
  dome: '圓頂',
  vault: '圓拱頂',
  spire: '尖頂',
  mansard: '複摺屋頂',
  curved_ridge: '捲棚頂',
  wudian: '廡殿頂',
  xieshan: '歇山頂',
  xuanshan: '懸山頂',
  yingshan: '硬山頂',
});

/** 7 款牆面外觀材質分類 */
export const FACADE_TYPES = Object.freeze({
  brick: '磚瓦',
  stone: '石砌',
  timber: '木造',
  tile: '磁磚',
  glass_curtain: '大玻璃窗',
  concrete: '清水模',
  green: '綠建築',
});

/** 地點與功能分類：樓層數與層高隨機範圍（先針對區域拉伸後再渲染） */
export const BUILDING_FUNCTION_RANGES = Object.freeze({
  // 商業區
  commercial_skyscraper: { label: '商業摩天樓', levels: [14, 28], floorH: [3.4, 4.0], minH: 48, maxH: 110 },
  commercial_office:     { label: '商辦大樓',   levels: [5, 12],  floorH: [3.2, 3.8], minH: 18, maxH: 45 },
  commercial_retail:     { label: '商場賣場',   levels: [2, 4],   floorH: [3.8, 5.0], minH: 8,  maxH: 20 },
  // 工業區
  industrial_factory:    { label: '工業廠房',   levels: [1, 3],   floorH: [4.8, 6.5], minH: 7,  maxH: 18 },
  industrial_warehouse:  { label: '物流倉儲',   levels: [1, 2],   floorH: [5.5, 7.5], minH: 6,  maxH: 15 },
  industrial_power:      { label: '能源設施',   levels: [2, 4],   floorH: [4.0, 6.0], minH: 9,  maxH: 24 },
  // 住宅郊區
  residential_apartment: { label: '集合公寓',   levels: [4, 9],   floorH: [3.0, 3.3], minH: 12, maxH: 30 },
  residential_townhouse: { label: '獨棟透天',   levels: [2, 4],   floorH: [3.2, 3.5], minH: 7,  maxH: 14 },
  residential_alley:     { label: '巷弄老屋',   levels: [1, 3],   floorH: [3.0, 3.4], minH: 4,  maxH: 10 },
  // 鄉村
  rural_farmhouse:       { label: '鄉村農舍',   levels: [1, 2],   floorH: [3.2, 3.8], minH: 4,  maxH: 8 },
  rural_greenhouse:      { label: '農業溫室',   levels: [1, 1],   floorH: [3.5, 4.8], minH: 3.5, maxH: 5.5 },
  // 觀光區
  tourism_visitor:       { label: '遊客中心',   levels: [1, 3],   floorH: [3.5, 4.5], minH: 5,  maxH: 12 },
  tourism_cultural:      { label: '文化歷史建築', levels: [2, 5],  floorH: [3.8, 5.0], minH: 8,  maxH: 22 },
});

/** 計算建築多邊形量測指標（面積、跨度、長寬、長寬比、邊界與質心） */
export function calculateFootprintMetrics(poly) {
  const outer = poly?.outer || [];
  if (outer.length < 3) return null;
  const xs = outer.map((p) => p[0]), zs = outer.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const width = Math.max(0.1, maxX - minX);
  const depth = Math.max(0.1, maxZ - minZ);
  const span = Math.min(width, depth);
  const aspect = Math.max(width, depth) / span;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

  let area = 0;
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    area += (outer[j][0] + outer[i][0]) * (outer[j][1] - outer[i][1]);
  }
  area = Math.abs(area) * 0.5;

  return {
    width, depth, span, aspect, area, cx, cz, minX, maxX, minZ, maxZ,
    outer, holes: poly.holes || [],
  };
}

/** 判斷點 (x, z) 是否在多邊形環 (ring) 內部（射線法） */
export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (((a[1] > z) !== (b[1] > z)) && x < (b[0] - a[0]) * (z - a[1]) / ((b[1] - a[1]) || 1e-5) + a[0]) inside = !inside;
  }
  return inside;
}

/** 計算點 (px, pz) 到線段 (ax, az)-(bx, bz) 的精確歐氏距離 */
export function distanceToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  if (l2 <= 1e-10) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/** 計算點 (x, z) 到多邊形外環與所有洞口邊界的最小淨距。若不在外環內或在洞口內則回傳 0。 */
export function distanceToPolyBoundary(x, z, poly) {
  if (!poly?.outer || poly.outer.length < 3) return 0;
  if (!pointInRing(x, z, poly.outer)) return 0;
  for (const hole of poly.holes || []) {
    if (pointInRing(x, z, hole)) return 0;
  }

  let minDist = Infinity;
  for (let i = 0; i < poly.outer.length; i++) {
    const a = poly.outer[i], b = poly.outer[(i + 1) % poly.outer.length];
    const d = distanceToSegment(x, z, a[0], a[1], b[0], b[1]);
    if (d < minDist) minDist = d;
  }
  for (const hole of poly.holes || []) {
    for (let i = 0; i < hole.length; i++) {
      const a = hole[i], b = hole[(i + 1) % hole.length];
      const d = distanceToSegment(x, z, a[0], a[1], b[0], b[1]);
      if (d < minDist) minDist = d;
    }
  }
  return Number.isFinite(minDist) ? minDist : 0;
}

/** 檢驗特定中心點是否可容納半徑 r 之構件，並保留邊緣安全留白空間 (預設 margin = 0.8m) */
export function isSiteValid(poly, x, z, r, margin = 0.8) {
  if (!poly?.outer || poly.outer.length < 3) return false;
  const requiredDistance = Math.max(0.2, r) + Math.max(0, margin);
  return distanceToPolyBoundary(x, z, poly) >= requiredDistance;
}

/** 屋頂造型與可容納頂部零件相容性矩陣 (依屋頂類型決定可放物件) */
export const ROOF_APPURTENANCE_COMPATIBILITY = Object.freeze({
  // 平頂與階梯露台：結構平整開闊，支援全套屋頂設備
  flat: Object.freeze(['water_tank', 'antenna', 'cellular_mast', 'solar_array', 'pigeon_coop', 'chimney', 'roof_billboard', 'clock_tower', 'rooftop_spire', 'heli_hangar']),
  stepped: Object.freeze(['water_tank', 'antenna', 'cellular_mast', 'solar_array', 'pigeon_coop', 'chimney', 'roof_billboard', 'clock_tower', 'rooftop_spire', 'heli_hangar']),

  // 斜坡雙坡/單坡/折線/懸山/硬山屋頂：瓦面傾斜，嚴禁平放停機坪與大型看板；相容煙囪穿透、天線架設脊頂、山牆鐘樓與尖頂
  gable: Object.freeze(['chimney', 'antenna', 'clock_tower', 'rooftop_spire']),
  shed: Object.freeze(['solar_array', 'chimney', 'antenna', 'rooftop_spire']),
  mansard: Object.freeze(['chimney', 'antenna', 'clock_tower', 'rooftop_spire']),
  yingshan: Object.freeze(['chimney', 'antenna', 'rooftop_spire']),
  xuanshan: Object.freeze(['chimney', 'antenna', 'rooftop_spire']),
  sawtooth: Object.freeze(['chimney', 'antenna', 'exhaust_fan', 'solar_array']),
  spire: Object.freeze(['rooftop_spire', 'antenna']),

  // 東亞傳統宮殿與寺廟大頂（廡殿、歇山、捲棚、重簷）：文化造型嚴謹，不可放置現代大型水塔與直升機棚，相容脊頂寶頂與飾針
  wudian: Object.freeze(['rooftop_spire', 'clock_tower', 'chimney']),
  xieshan: Object.freeze(['rooftop_spire', 'clock_tower', 'chimney']),
  curved_ridge: Object.freeze(['rooftop_spire', 'chimney']),
  tiered: Object.freeze(['rooftop_spire', 'clock_tower']),

  // 圓頂與穹窿拱頂：曲面球頂，相容頂端尖塔飾頂、十字/新月天線或底部煙道
  dome: Object.freeze(['rooftop_spire', 'antenna', 'chimney']),
  vault: Object.freeze(['rooftop_spire', 'antenna', 'chimney']),
});

/**
 * 依長寬高與面積決定屋頂類型並調整適當大小
 * 若長寬高比例不對或面積過大，避免使用容易被扭曲的屋頂構造（如超大基地硬塞廡殿/歇山，或細長建物硬塞圓頂）
 */
export function resolveAdaptiveRoofForm(requestedForm, metrics, height = 10, category = 'residential') {
  if (!requestedForm || requestedForm === 'flat') return 'flat';
  if (!metrics) return requestedForm;
  const { area = 100, span = 10, aspect = 1.0 } = metrics;
  const isComplexRoof = ['wudian', 'xieshan', 'curved_ridge', 'mansard', 'dome', 'vault', 'spire', 'tiered'].includes(requestedForm);

  // 1. 超高層摩天樓 (樓高 >= 35m)
  // 摩天樓頂部應為平頂停機露台或階梯冠頂，避免整棟樓頂被單一傳統瓦坡覆蓋
  if (height >= 35) {
    if (requestedForm === 'stepped') return 'stepped';
    return isComplexRoof ? 'stepped' : (category === 'commercial' ? 'flat' : 'stepped');
  }

  // 2. 超大基地面積或巨型跨度 (面積 >= 750m² 或 跨度 >= 28m)
  // 大型商場賣場、物流倉儲、高鐵站或工業廠房，傳統歇山廡殿或陡尖頂會形成巨大虛積或破面扭曲
  // 應切換為當代平頂(含女兒牆)、低坡鋸齒/單斜或階梯退台
  if (area >= 750 || span >= 28) {
    if (requestedForm === 'sawtooth') return 'sawtooth';
    if (category === 'industrial') return 'sawtooth';
    return isComplexRoof ? (aspect > 1.8 ? 'flat' : 'stepped') : (requestedForm === 'shed' ? 'sawtooth' : 'flat');
  }

  // 3. 建築過於細長 (長寬比 > 2.6 或跨度 < 4.5m)
  // 圓頂、尖頂、廡殿頂、重簷塔頂等向心結構會嚴重縱向拉伸變形，應轉為雙坡(gable)、懸山(xuanshan)、硬山(yingshan)或鋸齒/平頂
  if (aspect > 2.6) {
    if (['dome', 'vault', 'spire', 'wudian', 'xieshan', 'tiered'].includes(requestedForm)) {
      if (requestedForm === 'wudian' || requestedForm === 'xieshan' || requestedForm === 'tiered') {
        return 'yingshan';
      }
      return category === 'industrial' ? 'sawtooth' : 'gable';
    }
  }

  // 4. 極端矮小或小跨度建物 (跨度 < 2.5m 或 面積 < 15m² 或 樓高 < 3.5m)
  if (span < 2.5 || area < 15 || height < 3.5) {
    if (['xieshan', 'tiered', 'mansard', 'wudian'].includes(requestedForm)) {
      return 'shed';
    }
  }

  return requestedForm;
}

/** 符合在地文化風格者占 60% */
export const CULTURAL_AFFINITY_RATIO = 0.60;

/** 外部零件型錄定義與配置規則 (20+ 種外部構件，含適配槽位、建築類別與機率) */
export const APPURTENANCE_RULES = Object.freeze({
  // 頂部物件 (Rooftop)
  water_tank:      { label: '白鐵不銹鋼水塔', slot: 'rooftop', categories: ['residential', 'commercial', 'industrial'], maxCount: 3, prob: 0.85 },
  antenna:         { label: '魚骨電視天線',   slot: 'rooftop', categories: ['residential', 'rural'], maxCount: 2, prob: 0.60 },
  cellular_mast:   { label: '通訊基地台塔',   slot: 'rooftop', categories: ['commercial', 'residential'], maxCount: 1, prob: 0.35, minHeight: 24 },
  solar_array:     { label: '光伏太陽能板',   slot: 'rooftop', categories: ['commercial', 'industrial', 'rural', 'residential'], maxCount: 4, prob: 0.45 },
  pigeon_coop:     { label: '頂樓木造鴿棚',   slot: 'rooftop', categories: ['residential', 'rural'], maxCount: 1, prob: 0.25 },
  chimney:         { label: '排煙煙囪',       slot: 'rooftop', categories: ['rural', 'industrial'], maxCount: 2, prob: 0.55 },
  roof_billboard:  { label: '屋頂大型廣告架', slot: 'rooftop', categories: ['commercial'], maxCount: 1, prob: 0.40, minHeight: 18, minSpan: 16 },
  clock_tower:     { label: '古典時鐘鐘樓',   slot: 'rooftop', categories: ['tourism', 'civic', 'commercial'], maxCount: 1, prob: 0.35, minHeight: 10, minArea: 160, minSpan: 12 },
  rooftop_spire:   { label: '哥德/東亞尖塔',   slot: 'rooftop', categories: ['tourism', 'residential', 'commercial'], maxCount: 2, prob: 0.35, minHeight: 12, minArea: 100, minSpan: 10 },
  heli_hangar:     { label: '停機坪直升機棚', slot: 'rooftop', categories: ['commercial', 'industrial'], maxCount: 1, prob: 0.40, minHeight: 28, minArea: 500, minSpan: 22 },

  // 正門地面物件 (Ground Entrance)
  main_door:       { label: '正門大門門框',   slot: 'ground_front', categories: ['commercial', 'residential', 'tourism', 'industrial'], maxCount: 1, prob: 1.0 },
  canopy:          { label: '門頭遮雨棚',     slot: 'ground_front', categories: ['commercial', 'residential', 'tourism'], maxCount: 1, prob: 0.75 },
  planter_pots:    { label: '迎賓景觀盆栽',   slot: 'ground_front', categories: ['residential', 'commercial', 'tourism'], maxCount: 2, prob: 0.70 },

  // 側邊與後側地面物件 (Side & Rear Ground)
  side_door:       { label: '後勤出入側門',   slot: 'side_ground', categories: ['industrial', 'commercial', 'residential'], maxCount: 2, prob: 0.65 },
  exhaust_fan:     { label: '工業抽風機',     slot: 'side_ground', categories: ['industrial', 'commercial'], maxCount: 3, prob: 0.75 },
  graffiti_wall:   { label: '街頭塗鴉牆',     slot: 'side_ground', categories: ['industrial', 'residential'], maxCount: 1, prob: 0.40 },

  // 立面與側邊高程物件 (Facade & Upper Sides)
  blade_sign:      { label: '側懸店鋪招牌',   slot: 'facade', categories: ['commercial', 'residential'], maxCount: 3, prob: 0.80 },
  video_wall:      { label: '戶外大型電視牆', slot: 'facade', categories: ['commercial'], maxCount: 1, prob: 0.30, minHeight: 24 },
  election_banner: { label: '外牆選舉看板',   slot: 'facade', categories: ['residential', 'commercial'], maxCount: 1, prob: 0.25 },
  fire_escape:     { label: '外露鋼構逃生梯', slot: 'facade', categories: ['residential', 'commercial', 'industrial'], maxCount: 1, prob: 0.40, minHeight: 12 },
  balconies:       { label: '各層懸挑陽台',   slot: 'facade', categories: ['residential'], maxCount: 8, prob: 0.70, minHeight: 10 },
  drying_rack:     { label: '陽台曬衣架',     slot: 'facade', categories: ['residential'], maxCount: 4, prob: 0.60 },
  ac_units:        { label: '冷氣室外機',     slot: 'facade', categories: ['residential', 'commercial'], maxCount: 12, prob: 0.85 },
  flagpole:        { label: '立面斜插旗幟',   slot: 'facade', categories: ['tourism', 'commercial', 'residential'], maxCount: 1, prob: 0.35 },
});

/** 世界各大文化建築語彙型錄 */
export const ARCHITECTURE_STYLES = Object.freeze({
  // ---- 既有保留語彙（完全相容現有測試與設定）----
  machiya: {
    label: '日式町屋', era: 'historic', facade: 'lattice', wallType: 'timber',
    roofForm: 'gable', wall: 0xf0dfbd, roof: 0x434c61, trim: 0x69463b, glass: 0x8ec2cb,
    affinity: 'house|rowhouse|pagoda|civic|alley', region: 'east_asia',
  },
  courtyard: {
    label: '東亞院落', era: 'historic', facade: 'columns', wallType: 'brick',
    roofForm: 'tiered', wall: 0xeee5cc, roof: 0x466979, trim: 0xa54f43, glass: 0x6ba5b7,
    affinity: 'pagoda|civic|house|cultural', region: 'east_asia',
  },
  mediterranean: {
    label: '地中海拱廊', era: 'historic', facade: 'arches', wallType: 'stone',
    roofForm: 'gable', wall: 0xf5dcba, roof: 0xba6954, trim: 0xd0ab79, glass: 0x5aa8cc,
    affinity: 'adobe|stone|civic|house|visitor', region: 'mediterranean',
  },
  alpine: {
    label: '山地木石屋', era: 'historic', facade: 'timber', wallType: 'timber',
    roofForm: 'gable', wall: 0xe2c8a4, roof: 0x5c6175, trim: 0x614538, glass: 0x8ec8dc,
    affinity: 'cottage|stone|house|windmill|farmhouse', region: 'europe_alpine',
  },
  earthen: {
    label: '土築聚落', era: 'historic', facade: 'recess', wallType: 'stone',
    roofForm: 'dome', wall: 0xe0b780, roof: 0xad8064, trim: 0x926c4c, glass: 0x6ca4b3,
    affinity: 'adobe|yurt|stone|rural', region: 'middle_east',
  },
  deco: {
    label: '近代裝飾藝術', era: 'transitional', facade: 'piers', wallType: 'stone',
    roofForm: 'stepped', wall: 0xecdac0, roof: 0x617487, trim: 0xae9270, glass: 0x72a8be,
    affinity: 'civic|rowhouse|mass|commercial|office', region: 'americas',
  },
  modern: {
    label: '當代玻璃街廓', era: 'modern', facade: 'ribbon', wallType: 'glass_curtain',
    roofForm: 'flat', wall: 0xd8e6ed, roof: 0x4e667b, trim: 0x93afbd, glass: 0x50aed2,
    affinity: 'mass|commercial|office|apartment|skyscraper', region: 'global_modern',
  },
  industrial: {
    label: '近代廠房', era: 'transitional', facade: 'industrial', wallType: 'concrete',
    roofForm: 'sawtooth', wall: 0xc18d78, roof: 0x597f87, trim: 0x616572, glass: 0x76b4c6,
    affinity: 'industrial|warehouse|mass|shed|factory|power', region: 'global_modern',
  },

  // ---- 擴充文化建築風格（涵蓋 12 種屋頂與 7 種外牆）----
  minnan_brick: {
    label: '閩南磚石硬山', era: 'historic', facade: 'brick', wallType: 'brick',
    roofForm: 'yingshan', wall: 0xd96749, roof: 0x5a443a, trim: 0x8c4533, glass: 0x82b2bc,
    affinity: 'house|townhouse|alley|cultural', region: 'east_asia',
  },
  east_asian_palace: {
    label: '東亞廡殿堂閣', era: 'historic', facade: 'columns', wallType: 'timber',
    roofForm: 'wudian', wall: 0xd6b485, roof: 0xb5803a, trim: 0x992b23, glass: 0x669cb0,
    affinity: 'civic|cultural|temple|tourism', region: 'east_asia',
  },
  siheyuan_courtyard: {
    label: '華北合院懸山', era: 'historic', facade: 'timber', wallType: 'brick',
    roofForm: 'xuanshan', wall: 0xbfb6a8, roof: 0x424852, trim: 0x78352e, glass: 0x7eaebb,
    affinity: 'house|rowhouse|alley|cultural', region: 'east_asia',
  },
  traditional_curved: {
    label: '水鄉古韻捲棚', era: 'historic', facade: 'tile', wallType: 'tile',
    roofForm: 'curved_ridge', wall: 0xeeebe5, roof: 0x3d434d, trim: 0x3e3f45, glass: 0x78a8b8,
    affinity: 'house|cultural|visitor|tourism', region: 'east_asia',
  },
  xieshan_temple: {
    label: '歇山古風殿閣', era: 'historic', facade: 'columns', wallType: 'timber',
    roofForm: 'xieshan', wall: 0xcc8b6a, roof: 0x4d6673, trim: 0x96392c, glass: 0x6ca3b5,
    affinity: 'cultural|temple|civic|museum', region: 'east_asia',
  },
  gothic_spire: {
    label: '哥德石造尖頂', era: 'historic', facade: 'stone', wallType: 'stone',
    roofForm: 'spire', wall: 0xc4c2ba, roof: 0x444d5c, trim: 0x7c8594, glass: 0x6eb0cc,
    affinity: 'church|cultural|civic|museum', region: 'europe_west',
  },
  baroque_mansard: {
    label: '法式複摺屋頂', era: 'historic', facade: 'stone', wallType: 'stone',
    roofForm: 'mansard', wall: 0xe8dfd1, roof: 0x4b586e, trim: 0x8a7f72, glass: 0x7bb6ce,
    affinity: 'civic|apartment|townhouse|office', region: 'europe_west',
  },
  islamic_vault: {
    label: '伊斯蘭圓拱穹頂', era: 'historic', facade: 'arches', wallType: 'stone',
    roofForm: 'vault', wall: 0xe6cfb0, roof: 0x4f888c, trim: 0xc2934f, glass: 0x56a6b5,
    affinity: 'mosque|cultural|civic|market', region: 'middle_east',
  },
  suburban_shed: {
    label: '當代單斜木屋', era: 'modern', facade: 'timber', wallType: 'timber',
    roofForm: 'shed', wall: 0xccb293, roof: 0x3c434f, trim: 0x5c4a3d, glass: 0x7ebcd5,
    affinity: 'house|townhouse|farmhouse|visitor', region: 'americas',
  },
  brutalist_concrete: {
    label: '極簡清水模', era: 'modern', facade: 'concrete', wallType: 'concrete',
    roofForm: 'flat', wall: 0xb5bcc4, roof: 0x545d66, trim: 0x757f8a, glass: 0x649eb8,
    affinity: 'civic|museum|office|power|apartment', region: 'global_modern',
  },
  eco_green: {
    label: '生態綠建築', era: 'modern', facade: 'green', wallType: 'green',
    roofForm: 'flat', wall: 0xa9c2a5, roof: 0x47694f, trim: 0x789c72, glass: 0x58b0ba,
    affinity: 'commercial|office|skyscraper|visitor|apartment', region: 'global_modern',
  },
  tile_apartment: {
    label: '都會磁磚公寓', era: 'transitional', facade: 'tile', wallType: 'tile',
    roofForm: 'flat', wall: 0xd9d3c5, roof: 0x5a6370, trim: 0x8c796b, glass: 0x7ab2c6,
    affinity: 'apartment|townhouse|rowhouse|commercial', region: 'east_asia',
  },
  greenhouse_glass: {
    label: '農業透光溫室', era: 'modern', facade: 'glass_curtain', wallType: 'glass_curtain',
    roofForm: 'gable', wall: 0xd0e8ed, roof: 0xa8cfdb, trim: 0xffffff, glass: 0x93cbde,
    affinity: 'greenhouse|farm|farmhouse', region: 'global_modern',
  },
});

/** 基礎地形情境權重表（無地理文化或未指定時的標準分佈） */
export const ARCHITECTURE_PROFILES = Object.freeze({
  urban: {
    machiya: 10, courtyard: 8, mediterranean: 9, alpine: 3, earthen: 3, deco: 22, modern: 35, industrial: 10,
  },
  rural: {
    machiya: 22, courtyard: 20, mediterranean: 15, alpine: 16, earthen: 12, deco: 5, modern: 5, industrial: 5,
  },
  plain: {
    machiya: 12, courtyard: 14, mediterranean: 14, alpine: 7, earthen: 19, deco: 8, modern: 10, industrial: 16,
  },
  hillside: {
    machiya: 12, courtyard: 9, mediterranean: 18, alpine: 34, earthen: 14, deco: 5, modern: 5, industrial: 3,
  },
});

/** 世界文化大區與對應風格名冊 */
export const CULTURAL_REGIONS = Object.freeze({
  east_asia: {
    name: '東亞文化圈',
    countries: ['TW', 'JP', 'KR', 'CN', 'HK', 'MO'],
    // 粗略經緯度邊界 [minLat, minLon, maxLat, maxLon]
    bbox: [15, 95, 50, 150],
    styles: ['machiya', 'courtyard', 'minnan_brick', 'east_asian_palace', 'siheyuan_courtyard', 'traditional_curved', 'xieshan_temple', 'tile_apartment'],
  },
  europe_west: {
    name: '西歐中歐文化圈',
    countries: ['FR', 'DE', 'GB', 'BE', 'NL', 'CH', 'AT', 'PL', 'IE'],
    bbox: [42, -10, 60, 25],
    styles: ['gothic_spire', 'baroque_mansard', 'deco', 'alpine'],
  },
  europe_alpine: {
    name: '阿爾卑斯山地文化圈',
    countries: ['CH', 'AT'],
    bbox: [45, 5, 48, 17],
    styles: ['alpine', 'gothic_spire', 'suburban_shed'],
  },
  mediterranean: {
    name: '地中海文化圈',
    countries: ['ES', 'IT', 'PT', 'GR'],
    bbox: [34, -10, 44, 28],
    styles: ['mediterranean', 'earthen', 'baroque_mansard'],
  },
  americas: {
    name: '美洲文化圈',
    countries: ['US', 'CA', 'MX', 'BR', 'AR', 'CL'],
    bbox: [-56, -168, 72, -34],
    styles: ['deco', 'suburban_shed', 'modern', 'industrial'],
  },
  middle_east: {
    name: '中東北非文化圈',
    countries: ['EG', 'SA', 'AE', 'TR', 'IR', 'IL', 'MA'],
    bbox: [12, -18, 42, 60],
    styles: ['earthen', 'islamic_vault', 'mediterranean'],
  },
  oceania: {
    name: '大洋洲文化圈',
    countries: ['AU', 'NZ'],
    bbox: [-48, 110, -10, 180],
    styles: ['suburban_shed', 'modern', 'deco', 'eco_green'],
  },
});

export const ARCHITECTURE_SITE = Object.freeze({ slopeDeg: 10, probeM: 12, densityCellM: 100, urbanNeighbors: 18 });

