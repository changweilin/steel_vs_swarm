import {
  GROUND_ATTACHMENTS,
  VENUES, TRACK, TRACK_WIDTH, TRACK_DEPTH,
  LANDSCAPES, VISITOR_SITES,
} from './groundPartCatalog.js';

export { VENUES, TRACK, TRACK_WIDTH, TRACK_DEPTH, LANDSCAPES, VISITOR_SITES };

// Surface content and numeric placement contracts. Rendering lives in proceduralGround.js.
export const SURFACE_GROUPS = {
  recreation: { purpose: '休憩運動', landscape: 'managed', pattern: 'paving',
    members: 'lawn park plaza court track flowerfield' },
  agriculture: { purpose: '農牧生產', landscape: 'cultivated', pattern: 'rows',
    members: 'paddy dryfield teafield veggiefield pasture orchard vineyard greenhouse abandonedfarm' },
  logistics: { purpose: '交通與倉儲', landscape: 'built', pattern: 'bays',
    members: 'parking containeryard helipad' },
  industry: { purpose: '產業與工程', landscape: 'built', pattern: 'slabs',
    members: 'construction gasstation scrapyard solarfarm quarry lumberyard' },
  civic: { purpose: '公共鋪面與紀念', landscape: 'built', pattern: 'paving',
    members: 'concrete brick pavement cemetery' },
  woodland: { purpose: '自然保育', landscape: 'woodland', pattern: 'litter',
    members: 'bushfield arrowbamboo deadwood fallenlogs deadforest clearcut rottencabin' },
  grassland: { purpose: '自然保育', landscape: 'grassland', pattern: 'grass',
    members: 'turf meadow steppe' },
  mineral: { purpose: '自然景觀', landscape: 'exposed', pattern: 'sediment',
    members: 'wild gravel sand mud crackedearth redsoil slabruin plateau icefield scree' },
  wetland: { purpose: '水域與養殖', landscape: 'aquatic', pattern: 'ripples',
    members: 'marsh lotus watertile deepwater fishpond saltpan' },
};
export const SURFACE_LIMITS = {
  latitude: [-90, 90], altitude: [-500, 9000], temperature: [-60, 55],
  widthScale: [0.78, 1], aspectScale: [0.7, 1], colorLightness: [-0.06, 0.06],
  detailDensity: [0.6, 1.4], wear: [0.02, 0.22], graffiti: [0, 4],
  seasons: ['spring', 'summer', 'autumn', 'winter'],
  geology: ['unknown', 'granite', 'basalt', 'limestone', 'sandstone', 'alluvium'],
  weather: ['clear', 'cloudy', 'rain', 'heavy_rain', 'storm', 'windy', 'fog', 'snow', 'sandstorm'],
};
export const DEFS = {
  turf:         { shape: 'blob', uvS: 1 / 14, edge: 'fade', slope: 0.40, reg: 0, green: true, fam: 'blobGreen' },
  meadow:       { shape: 'blob', uvS: 1 / 16, edge: 'fade', slope: 0.45, reg: 0, green: true, fam: 'blobGreen' },
  bushfield:    { shape: 'blob', uvS: 1 / 13, edge: 'fade', slope: 0.40, reg: 0, green: true, fam: 'blobGreen' },
  flowerfield:  { shape: 'blob', uvS: 1 / 15, edge: 'fade', slope: 0.35, reg: 0.15, green: true, fam: 'blobGreen' },
  orchard:      { shape: 'blob', uvS: 1 / 20, edge: 'fade', slope: 0.30, reg: 0.45, green: true, fam: 'blobGreen', seasonal: 1 },
  teafield:     { shape: 'rect', uv: 'fit', aspect: 0.8, edge: 'ink', slope: 0.22, reg: 0.8, green: true, fam: 'rectFarm', seasonal: 1 },
  veggiefield:  { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.12, reg: 0.8, green: true, fam: 'rectFarm', seasonal: 1 },
  pasture:      { shape: 'rect', uv: 'fit', aspect: 0.75, edge: 'ink', slope: 0.26, reg: 0.6, green: true, fam: 'rectFarm', seasonal: 1 },
  paddy:        { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.09, rim: 0.5, reg: 0.8, green: true, fam: 'rectFarm', seasonal: 1 },
  dryfield:     { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.14, rim: 0.35, reg: 0.7, fam: 'rectFarm', seasonal: 1 },
  wild:         { shape: 'blob', uvS: 1 / 15, edge: 'fade', slope: 0.50, reg: 0, fam: 'blobBare' },
  gravel:       { shape: 'blob', uvS: 1 / 10, edge: 'fade', slope: 0.40, reg: 0, fam: 'blobBare' },
  sand:         { shape: 'blob', uvS: 1 / 18, edge: 'fade', slope: 0.35, reg: 0, fam: 'blobBare' },
  mud:          { shape: 'blob', uvS: 1 / 12, edge: 'fade', slope: 0.30, reg: 0, fam: 'blobBare' },
  crackedearth: { shape: 'blob', uvS: 1 / 14, edge: 'fade', slope: 0.35, reg: 0, fam: 'blobBare' },
  redsoil:      { shape: 'blob', uvS: 1 / 15, edge: 'fade', slope: 0.40, reg: 0, fam: 'blobBare' },
  lawn:         { shape: 'blob', uvS: 1 / 12, edge: 'fade', slope: 0.30, reg: 0.2, green: true },
  concrete:     { shape: 'rect', uvS: 1 / 16, aspect: 0.8, edge: 'ink', slope: 0.14, reg: 0.75, fam: 'rectUrban' },
  brick:        { shape: 'rect', uvS: 1 / 8, aspect: 0.8, edge: 'ink', slope: 0.12, reg: 0.7 },
  pavement:     { shape: 'blob', uvS: 1 / 8, edge: 'ink', slope: 0.20, reg: 0.6 },
  parking:      { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.10, reg: 0.95, fam: 'rectUrban' },
  court:        { shape: 'rect', uv: 'fit', aspect: 0.54, edge: 'ink', slope: 0.08, reg: 0.9, fam: 'rectUrban' },
  track:        { shape: 'rect', uv: 'fit', aspect: 0.5, edge: 'ink', slope: 0.08, reg: 0.9, fam: 'rectUrban' },
  marsh:        { shape: 'blob', uvS: 1 / 14, edge: 'fade', slope: 0.25, reg: 0, green: true, fam: 'wetFam', aq: 1 },
  lotus:        { shape: 'blob', uvS: 1 / 12, edge: 'fade', slope: 0.15, reg: 0, fam: 'wetFam', aq: 1 },
  // -- Water-only carpet (aq: shoreline/water-height culling pass, vertex height clamped to water surface; terrainEnvCode===1 only) --
  watertile:    { shape: 'blob', uvS: 1 / 13, edge: 'fade', slope: 1.0, reg: 0, aq: 1 },
  deepwater:    { shape: 'blob', uvS: 1 / 13, edge: 'fade', slope: 1.0, reg: 0, aq: 1 },
  // -- Green expansion: bamboo / dead forest / logging / trellis farming --
  arrowbamboo:  { shape: 'blob', uvS: 1 / 14, edge: 'fade', slope: 0.50, reg: 0, green: true, fam: 'blobGreen' },
  deadwood:     { shape: 'blob', uvS: 1 / 15, edge: 'fade', slope: 0.50, reg: 0, fam: 'deadFam' },
  fallenlogs:   { shape: 'blob', uvS: 1 / 13, edge: 'fade', slope: 0.45, reg: 0, green: true, fam: 'deadFam' },
  clearcut:     { shape: 'blob', uvS: 1 / 14, edge: 'fade', slope: 0.35, reg: 0.2, fam: 'deadFam' },
  lumberyard:   { shape: 'blob', uvS: 1 / 11, edge: 'fade', slope: 0.20, reg: 0.65, fam: 'deadFam' },
  rottencabin:  { shape: 'blob', uvS: 1 / 12, edge: 'fade', slope: 0.25, reg: 0.3, green: true, fam: 'ruinFam' },
  vineyard:     { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.18, reg: 0.85, green: true, fam: 'rectFarm', seasonal: 1 },
  greenhouse:   { shape: 'rect', uv: 'fit', aspect: 0.6, edge: 'ink', slope: 0.10, reg: 0.9, fam: 'rectFarm', seasonal: 1 },
  // -- Exposed-land expansion: ruins / dead forest / dry grassland / abandoned farms / industry --
  deadforest:   { shape: 'blob', uvS: 1 / 15, edge: 'fade', slope: 0.50, reg: 0, fam: 'deadFam' },
  slabruin:     { shape: 'blob', uvS: 1 / 10, edge: 'fade', slope: 0.45, reg: 0.15, fam: 'ruinFam' },
  steppe:       { shape: 'blob', uvS: 1 / 16, edge: 'fade', slope: 0.50, reg: 0, green: true, fam: 'alpFam' },
  abandonedfarm:{ shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.16, reg: 0.55, fam: 'rectFarm', seasonal: 1 },
  saltpan:      { shape: 'rect', uv: 'fit', aspect: 0.75, edge: 'ink', slope: 0.06, reg: 0.85, fam: 'panFam' },
  quarry:       { shape: 'rect', uv: 'fit', aspect: 0.8, edge: 'ink', slope: 0.45, reg: 0.5, fam: 'digFam' },
  // -- Highlands (relative-elevation zones; winter exposed land also mixes in icefields) --
  plateau:      { shape: 'blob', uvS: 1 / 12, edge: 'fade', slope: 0.60, reg: 0, fam: 'alpFam' },
  icefield:     { shape: 'blob', uvS: 1 / 14, edge: 'fade', slope: 0.40, reg: 0, fam: 'alpFam' },
  scree:        { shape: 'blob', uvS: 1 / 11, edge: 'fade', slope: 0.80, reg: 0, fam: 'alpFam' },
  // -- Urban expansion: industrial / service / recreation facilities --
  construction: { shape: 'rect', uv: 'fit', aspect: 0.75, edge: 'ink', slope: 0.20, reg: 0.7, fam: 'digFam' },
  gasstation:   { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.08, reg: 0.95, fam: 'rectUrban' },
  park:         { shape: 'blob', uvS: 1 / 13, edge: 'fade', slope: 0.30, reg: 0.15, green: true, fam: 'blobGreen' },
  plaza:        { shape: 'rect', uv: 'fit', aspect: 0.85, edge: 'ink', slope: 0.08, reg: 0.9, fam: 'rectUrban' },
  scrapyard:    { shape: 'rect', uv: 'fit', aspect: 0.75, edge: 'ink', slope: 0.15, reg: 0.55, fam: 'yardFam' },
  containeryard:{ shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.08, reg: 0.9, fam: 'yardFam' },
  cemetery:     { shape: 'rect', uv: 'fit', aspect: 0.8, edge: 'ink', slope: 0.18, reg: 0.85, green: true },
  solarfarm:    { shape: 'rect', uv: 'fit', aspect: 0.7, edge: 'ink', slope: 0.12, reg: 0.9, fam: 'solarFam' },
  helipad:      { shape: 'rect', uv: 'fit', aspect: 1.0, edge: 'ink', slope: 0.06, reg: 0.6 },
  // -- Wetland expansion --
  fishpond:     { shape: 'rect', uv: 'fit', aspect: 0.8, edge: 'ink', slope: 0.06, reg: 0.8, fam: 'panFam', seasonal: 1 },
};
export const ZONES = {
  green: ['rottencabin', 'deadwood', 'paddy', 'flowerfield', 'orchard', 'arrowbamboo',
          'dryfield', 'bushfield', 'teafield', 'vineyard', 'paddy', 'clearcut',
          'veggiefield', 'pasture', 'flowerfield', 'fallenlogs', 'greenhouse', 'lumberyard'],
  bare:  ['slabruin', 'quarry', 'abandonedfarm', 'crackedearth', 'gravel', 'abandonedfarm',
          'solarfarm', 'containeryard', 'saltpan'],
  // User decision 2026-08-13 to sharply lower red-brick and concrete usage: brick leaves the feature layer (it keeps
  // one carpet-list slot, so brick ground is not extinct, just no longer an everywhere pavement)
  urban: ['helipad', 'park', 'parking', 'plaza', 'court',
          'construction', 'track', 'gasstation', 'cemetery', 'scrapyard'],
  wet:   ['fishpond', 'lotus', 'marsh', 'fishpond'],
  alpine: ['slabruin', 'scree', 'plateau', 'slabruin'],
};
export const CARPET = {
  green: ['turf', 'meadow', 'turf', 'bushfield', 'meadow', 'flowerfield', 'turf',
          'arrowbamboo', 'meadow', 'deadwood', 'turf', 'fallenlogs'],
  bare:  ['wild', 'gravel', 'steppe', 'crackedearth', 'sand', 'redsoil', 'wild',
          'deadforest', 'mud', 'scree'],
  // User decision 2026-08-13 to sharply lower red-brick and concrete usage: old mix of concrete x2 + brick x1 was
  // 3 of 7 slots, and concrete and brick are endpoints, so measured urban-carpet share was 36 percent (endpoint bonus, see CARPET_SEL).
  // Keeping one slot each (2 of 21 slots) drops the measured share to 11 percent; freed share goes to sidewalk paving and lawns/parks
  // (which is what urban open ground mostly is). Weights MUST be expressed in slot counts -- after the color-path sort,
  // list position is decided by representative color, so MUST NOT try to tune volume by shuffling positions
  urban: ['pavement', 'pavement', 'pavement', 'pavement', 'pavement', 'pavement',
          'pavement', 'pavement', 'pavement', 'pavement', 'pavement', 'pavement',
          'lawn', 'lawn', 'lawn', 'lawn', 'park', 'park', 'park', 'concrete', 'brick'],
  wet:   ['marsh', 'marsh', 'lotus'],
  water: ['watertile'],   // Water-only (deep cells remap to deepwater by depth in cellKeyAt, never via noise rotation)
  alpine: ['plateau', 'scree', 'icefield', 'steppe', 'plateau'],
};
export const FAMS = {
  rectFarm:  ['paddy', 'dryfield', 'teafield', 'vineyard', 'greenhouse', 'veggiefield', 'abandonedfarm', 'pasture'],
  rectUrban: ['parking', 'court', 'track', 'concrete', 'plaza', 'gasstation'],
  blobGreen: ['turf', 'meadow', 'flowerfield', 'bushfield', 'orchard', 'park', 'arrowbamboo'],
  blobBare:  ['wild', 'gravel', 'sand', 'crackedearth', 'redsoil', 'mud'],
  wetFam:    ['marsh', 'lotus'],
  deadFam:   ['deadwood', 'deadforest', 'fallenlogs', 'clearcut', 'lumberyard'],
  ruinFam:   ['slabruin', 'rottencabin'],
  alpFam:    ['plateau', 'scree', 'icefield', 'steppe'],
  panFam:    ['saltpan', 'fishpond'],
  digFam:    ['quarry', 'construction'],
  yardFam:   ['scrapyard', 'containeryard'],
  solarFam:  ['solarfarm'],
};
export const SIZE = {
  turf: [9, 10], meadow: [10, 12], bushfield: [8, 8], flowerfield: [10, 8], orchard: [11, 8],
  lawn: [8, 8], wild: [10, 12], gravel: [8, 9], sand: [11, 12], mud: [8, 9],
  crackedearth: [11, 10], redsoil: [10, 9], marsh: [8, 8], lotus: [8, 6], watertile: [10, 8], deepwater: [10, 8],
  paddy: [13, 8], dryfield: [12, 8], teafield: [12, 6], veggiefield: [10, 6], pasture: [15, 10], concrete: [9, 7], brick: [7, 6],
  pavement: [8, 6], parking: [14, 4], court: [16, 3], track: [15, 3],
  arrowbamboo: [10, 8], deadwood: [11, 10], deadforest: [12, 10], fallenlogs: [9, 8],
  clearcut: [12, 8], lumberyard: [8, 6], rottencabin: [7, 4], vineyard: [13, 6],
  greenhouse: [11, 5], abandonedfarm: [12, 8], saltpan: [12, 6], fishpond: [11, 6],
  slabruin: [9, 6], steppe: [12, 12], plateau: [13, 10], icefield: [12, 10], scree: [10, 10],
  quarry: [14, 6], construction: [12, 6], gasstation: [11, 4], park: [12, 8], plaza: [10, 6],
  scrapyard: [11, 6], containeryard: [13, 5], cemetery: [10, 6], solarfarm: [14, 5], helipad: [9, 3],
};

const GROUP_COLORS = {
  recreation: 0x77a060, agriculture: 0x8c9155, logistics: 0x697980, industry: 0x999181,
  civic: 0xa09d92, woodland: 0x7e8458, grassland: 0x8caa63, mineral: 0xaa9677, wetland: 0x537b82,
};
const OVERRIDES = {
  court: { pattern: 'court', aspect: 15 / 28, locked: true, flat: 0.12, color: 0x547d99, text: ['PLAY'] },
  track: { pattern: 'track', aspect: TRACK_DEPTH / TRACK_WIDTH, locked: true, flat: 0.15, color: 0xb46950, text: [] },
  helipad: { pattern: 'helipad', aspect: 1, locked: true, flat: 0.12, text: ['H'] },
  parking: { parts: ['billboard', 'planter', 'car', 'motorcycle', 'parking_garage'], text: ['P', '01', '02', '03'] },
  paddy: { flat: 0.25, temperature: [5, 45] }, fishpond: { flat: 0.18 }, saltpan: { flat: 0.18 },
  icefield: { temperature: [-60, 3], color: 0xd8e8ee },
  sand: { color: 0xdcc28f }, redsoil: { color: 0xa05f42 }, mud: { color: 0x6d5940 },
  watertile: { color: 0x2f6f96 }, deepwater: { color: 0x1c4560 },
  teafield: { temperature: [2, 35], altitude: [-100, 3000] },
  lotus: { temperature: [0, 45] }, arrowbamboo: { temperature: [-10, 35] },
};
export const SURFACES = Object.fromEntries(Object.entries(SURFACE_GROUPS).flatMap(([category, group]) =>
  group.members.split(' ').map(id => [id, {
    category, purpose: group.purpose, landscape: group.landscape, pattern: group.pattern,
    color: GROUP_COLORS[category], text: [],
    latitude: SURFACE_LIMITS.latitude, altitude: SURFACE_LIMITS.altitude,
    temperature: SURFACE_LIMITS.temperature, ...OVERRIDES[id],
    parts: [...new Set([
      ...Object.keys(GROUND_ATTACHMENTS[id].scatter || {}),
      ...Object.keys(GROUND_ATTACHMENTS[id].rows || {}),
      ...(GROUND_ATTACHMENTS[id].fixed || []).map(row => row[0]),
      ...Object.values(GROUND_ATTACHMENTS[id].contexts || {}).flatMap(Object.keys),
    ])],
  }])));

for (const [id, venue] of Object.entries(VENUES)) {
  const aspect = venue.width / venue.length;
  DEFS[id] = { shape: 'rect', aspect, uv: 'fit', edge: 'ink', slope: .08, reg: .9, fam: 'rectUrban' };
  SIZE[id] = [Math.min(24, Math.max(9, venue.length * .45)), 3];
  SURFACES[id] = { ...SURFACE_LIMITS, ...venue, purpose: venue.label, landscape: 'managed',
    pattern: 'venue', locked: true, aspect, flat: .12, text: [],
    parts: [...new Set(venue.equipment.map(e => e[0]))] };
  ZONES.urban.push(id);
}
for (const [id, landscape] of Object.entries(LANDSCAPES)) {
  const green = landscape.zone === 'green';
  DEFS[id] = { shape: 'blob', uvS: 1 / 16, edge: 'fade', slope: .45, reg: 0,
    green, fam: green ? 'blobGreen' : 'blobBare' };
  SIZE[id] = [10, 9];
  SURFACES[id] = { ...SURFACE_LIMITS, ...landscape, category: green ? 'grassland' : 'mineral',
    purpose: landscape.label, text: [] };
  for (const zone of landscape.zones || [landscape.zone]) ZONES[zone].push(id);
  FAMS[DEFS[id].fam].push(id);
}
for (const [id, site] of Object.entries(VISITOR_SITES)) {
  const aspect = site.width / site.length;
  DEFS[id] = { shape: 'rect', uv: 'fit', edge: 'ink', aspect, slope: .08, reg: .4,
    green: site.zone === 'green', fam: site.zone === 'green' ? 'visitorGreen' : 'visitorBare' };
  SIZE[id] = [13, 4];
  SURFACES[id] = { ...SURFACE_LIMITS, ...site, temperature: site.temperature || SURFACE_LIMITS.temperature,
    altitude: site.altitude || SURFACE_LIMITS.altitude, category: 'visitor', landscape: 'managed',
    purpose: site.label, pattern: 'visitor', locked: true, aspect, flat: .25, text: [],
    parts: [...new Set(site.equipment.map(e => e[0]))] };
  ZONES[site.zone].push(id);
  (FAMS[DEFS[id].fam] ||= []).push(id);
}
// All consumers (footprints, arrays, marks and attachments) read the same aspect.
for (const [id, spec] of Object.entries(SURFACES)) {
  if (spec.locked) DEFS[id].aspect = spec.aspect;
  DEFS[id].seasonal = 1;
}
