// Appearance choices are procedural priors; imagery never certifies paving material or individual facilities.
export const WALKWAY_SURFACES = Object.freeze({
  asphalt: { color: 0x53595b, pattern: 'grain', repeat: 4, hard: true },
  concrete: { color: 0xa5a399, pattern: 'slabs', repeat: 4, hard: true },
  paving_stones: { color: 0xa49983, pattern: 'pavers', repeat: 2, hard: true },
  bricks: { color: 0xa66c50, pattern: 'bricks', repeat: 2, hard: true },
  tiles: { color: 0xb7ada0, pattern: 'tiles', repeat: 2, hard: true },
  sett: { color: 0x88857a, pattern: 'setts', repeat: 2, hard: true },
  cobblestone: { color: 0x928c7b, pattern: 'cobbles', repeat: 2, hard: true },
  stone: { color: 0xaaa18b, pattern: 'flagstones', repeat: 3, hard: true },
  gravel: { color: 0x9a9382, pattern: 'gravel', repeat: 2, hard: false },
  compacted: { color: 0xa39172, pattern: 'grain', repeat: 3, hard: false },
  ground: { color: 0x8a7151, pattern: 'earth', repeat: 3, hard: false },
  sand: { color: 0xc3ad7f, pattern: 'grain', repeat: 3, hard: false },
  wood: { color: 0x957654, pattern: 'planks', repeat: 2, hard: true },
  metal: { color: 0x758082, pattern: 'grating', repeat: 2, hard: true },
  grass_paver: { color: 0x88916a, pattern: 'grass-grid', repeat: 2, hard: false },
});

export const WALKWAY_SURFACE_ALIASES = Object.freeze({
  'concrete:plates': 'concrete', 'concrete:lanes': 'concrete',
  paving_stones: 'paving_stones', 'paving_stones:lanes': 'paving_stones', brick: 'bricks',
  'cobblestone:flattened': 'sett', stone: 'stone', flagstone: 'stone', stone_slabs: 'stone',
  fine_gravel: 'gravel', pebblestone: 'gravel', dirt: 'ground', earth: 'ground', mud: 'ground',
  grass: 'ground', woodchips: 'ground', wooden: 'wood', boardwalk: 'wood', tartan: 'asphalt',
});

export const WALKWAY_PALETTES = Object.freeze({
  sidewalk: ['concrete', 'paving_stones', 'bricks', 'tiles', 'asphalt'],
  built: ['paving_stones', 'concrete', 'bricks', 'sett', 'stone'],
  park: ['compacted', 'gravel', 'paving_stones'],
  natural: ['ground', 'compacted', 'gravel'],
  coast: ['sand', 'compacted', 'wood'],
  oldstreet: ['bricks', 'sett', 'paving_stones'],
  promenade: ['paving_stones', 'stone', 'concrete'],
});

export const WALKWAY_FURNITURE = Object.freeze({
  bench: { r: 1.5, urban: true, park: true, trail: true },
  planter: { r: 1.1, urban: true, park: true },
  wastebasket: { r: .65, urban: true, park: true },
  bicycle_rack: { r: 1.65, urban: true, park: true },
  bollard: { r: .35, urban: true },
  drinking_fountain: { r: .75, urban: true, park: true },
  picnic_table: { r: 2.3, park: true },
  shelter: { r: 3.3, park: true },
  information_board: { r: 1.4, park: true },
  trail_marker: { r: .45, trail: true },
});

export const WALKWAY_DETAIL = Object.freeze({
  MIN_WIDTH_M: .6, MAX_WIDTH_M: 12, PANEL_PROBE_M: .6,
  PATH_ANCHOR_LIMIT: 6000, KERB_LIMIT: 6000, LOW_KERB_LIMIT: 1800,
  KERB_H_M: .13, KERB_W_M: .18,
  FURNITURE_CLEAR_M: .6, MAPPED_NEAR_M: 14, MAX_SLOPE_F: .18,
  DETAIL_LIMIT: 1200, LOW_DETAIL_LIMIT: 360,
});
