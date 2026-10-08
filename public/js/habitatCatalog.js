// Cover describes structure, never tree species, mineral composition or building height.
export const HABITATS = Object.freeze({
  woodland: { zone: 'green', color: [75, 87, 57], density: .78, canopy: .82, plant: 'understory', height: .52, stone: .05 },
  scrub: { zone: 'green', color: [113, 117, 76], density: .54, canopy: .35, plant: 'scrub', height: .72, stone: .12 },
  meadow: { zone: 'green', color: [125, 137, 80], density: .86, canopy: .025, plant: 'grass', height: .46, stone: .03 },
  pasture: { zone: 'green', color: [126, 139, 80], density: .82, canopy: 0, plant: 'grass', height: .32, stone: .02 },
  cropland: { zone: 'green', color: [134, 128, 83], density: .78, canopy: 0, plant: 'crop', height: .70, stone: .02 },
  orchard: { zone: 'green', color: [120, 129, 76], density: .38, canopy: 1, plant: 'grass', height: .28, stone: .02 },
  marsh: { zone: 'wet', color: [101, 113, 77], density: .76, canopy: 0, plant: 'reed', height: 1.6, stone: .02 },
  wetmeadow: { zone: 'wet', color: [112, 126, 79], density: .80, canopy: 0, plant: 'grass', height: .55, stone: .02 },
  mudflat: { zone: 'wet', color: [131, 122, 100], density: .06, canopy: 0, plant: 'grass', height: .15, stone: .32 },
  shallows: { zone: 'water', color: [133, 130, 98], density: .30, canopy: 0, plant: 'reed', height: 1.7, stone: .10 },
  built: { zone: 'urban', color: [133, 131, 121], density: .06, canopy: 0, plant: 'grass', height: .20, stone: .10 },
  exposed: { zone: 'bare', color: [157, 142, 116], density: .12, canopy: .008, plant: 'grass', height: .24, stone: .78 },
  sand: { zone: 'bare', color: [174, 158, 119], density: .06, canopy: 0, plant: 'grass', height: .18, stone: .08 },
  rocky: { zone: 'bare', color: [132, 129, 121], density: .03, canopy: .003, plant: 'grass', height: .16, stone: .94 },
  alpine: { zone: 'alpine', color: [133, 137, 121], density: .18, canopy: .025, plant: 'grass', height: .22, stone: .58 },
  cliff: { zone: 'cliff', color: [121, 115, 102], density: 0, canopy: 0, plant: null, height: 0, stone: 0 },
});

export const HABITAT_SCENE = Object.freeze({
  CELL_M: 6, PATCH_WAVE_F: 5, MAX_CELLS: 60000,
  INFILL_TRIES: 3, DETAIL_GAP_M: .3, COVERAGE_BUDGET_F: .6,
  CANOPY_CELL_M: 6, CANOPY_LIMIT: 16000, CANOPY_COLLIDER_F: .5, COMMUNITY_CELL_M: 72,
  PHENOLOGY_ALTITUDE_M: 250,
  DETAIL_LIMIT: 12000, LOW_DETAIL_LIMIT: 3200,
  DETAIL_PLANT_PARTS: 6,
  DETAIL_MODEL_LIMIT: 47,
  STREET_STEP_M: 4, STREET_WIDTH_M: 1.8, STREET_LIFT_M: .045,
  STREET_LIMIT: 6000, LOW_STREET_LIMIT: 1800,
  FURNITURE_STEP_M: 24, FURNITURE_LIMIT: 240, LOW_FURNITURE_LIMIT: 70,
  SHALLOW_DEPTH_M: .8,
  VARIANTS: 4,
});

// Structural appearance priors, not surveyed stocking rates or measured ages.
// Moisture limits woody cover; recruitment clusters in gaps, while managed rows stay regular.
export const HABITAT_COMMUNITIES = Object.freeze({
  forest: { woody: 1.2, ground: .75, height: [14, 24], recruits: .28, dominance: .72, forms: 'tree' },
  drywood: { woody: .6, ground: .55, height: [5, 12], recruits: .18, dominance: .82, forms: 'tree' },
  savanna: { woody: 1, ground: 1, height: [5, 11], recruits: .16, dominance: .85, forms: 'tree' },
  grassland: { woody: .35, ground: 1, height: [4, 9], recruits: .18, dominance: .8, forms: 'tree' },
  shrubland: { woody: 1.8, ground: .8, height: [.7, 2.4], recruits: .3, dominance: .82, forms: 'shrub' },
  desert: { woody: 3, ground: .18, height: [.5, 2.2], recruits: .12, dominance: .9, forms: 'xeric' },
  oasis: { woody: 1.15, ground: .9, height: [6, 15], recruits: .25, dominance: .85, forms: 'oasis' },
  tundra: { woody: .25, ground: .4, height: [.15, .65], recruits: .2, dominance: .9, forms: 'shrub' },
  managed: { woody: 1, ground: 1, height: [4, 6], recruits: 0, dominance: 1, forms: 'tree' },
});

// Occupied slots reduce the target; minimum coverage precedes optional densification.
export const HABITAT_FILL = Object.freeze({
  woodland: [2, 4], scrub: [2, 3], meadow: [3, 4], pasture: [2, 3],
  cropland: [3, 4], orchard: [1, 2], marsh: [2, 4], wetmeadow: [3, 4],
  mudflat: [1, 2], shallows: [1, 3], built: [1, 2], exposed: [2, 3],
  sand: [1, 2], rocky: [2, 3], alpine: [1, 2],
});
