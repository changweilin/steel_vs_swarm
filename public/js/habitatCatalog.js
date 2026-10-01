// Cover describes structure, never tree species, mineral composition or building height.
export const HABITATS = Object.freeze({
  woodland: { zone: 'green', color: [75, 87, 57], density: .78, canopy: .82, plant: 'understory', height: .52, stone: .05 },
  scrub: { zone: 'green', color: [113, 117, 76], density: .54, canopy: .35, plant: 'scrub', height: .72, stone: .12 },
  meadow: { zone: 'green', color: [125, 137, 80], density: .86, canopy: .025, plant: 'grass', height: .46, stone: .03 },
  cropland: { zone: 'green', color: [134, 128, 83], density: .52, canopy: 0, plant: 'grass', height: .38, stone: .02 },
  built: { zone: 'urban', color: [133, 131, 121], density: .06, canopy: 0, plant: 'grass', height: .20, stone: .10 },
  exposed: { zone: 'bare', color: [157, 142, 116], density: .12, canopy: .008, plant: 'grass', height: .24, stone: .78 },
  alpine: { zone: 'alpine', color: [133, 137, 121], density: .18, canopy: .025, plant: 'grass', height: .22, stone: .58 },
  cliff: { zone: 'cliff', color: [121, 115, 102], density: 0, canopy: 0, plant: null, height: 0, stone: 0 },
});

export const HABITAT_SCENE = Object.freeze({
  CELL_M: 6, PATCH_WAVE_F: 5, MAX_CELLS: 60000,
  CANOPY_CELL_M: 14,
  DETAIL_LIMIT: 12000, LOW_DETAIL_LIMIT: 3200,
  STREET_STEP_M: 4, STREET_WIDTH_M: 1.8, STREET_LIFT_M: .045,
  STREET_LIMIT: 6000, LOW_STREET_LIMIT: 1800,
  VARIANTS: 4,
});
