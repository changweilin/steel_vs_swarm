# Evidence-driven habitat generation

The runtime replaces random ground-patch deployment and the mixed-biome canopy
lottery with a recipe conditioned on the room's satellite/OSM observation field.
Mapped buildings and facilities retain their existing polygon generators.

## Ownership

| Seam | Responsibility |
|---|---|
| habitatCatalog.js | Cover profiles and presentation budgets. |
| habitat.js | Exact semantic mask lookup, cover resolution, coherent patch density, coordinate-seeded canopy/detail plans and street draping. |
| landfield.js | Settled zone labels and a separate continuous surface-color field. |
| habitatRender.js | Bounded instance batches and terrain-conforming street verges. |
| biomes.js | Existing clearance, OSM ownership, climate-aware botanical selection and trunk collision integration. |
| toon.js | Surface texture lifetime, color-space decoding and world-anchored material variation. |

## Interpretation

Woodland has a canopy and low understory; grassland keeps an open silhouette;
scrub uses low clusters; cropland does not acquire random forest trees. Bare
cover has sparse plants and generic surface fragments, without a mineral claim.
Built cover creates paved verges from actual road direction. RGB brightness and
texture vary existing materials; gray pixels cannot seed a real-world city.
Directional contrast changes no road bearing or building footprint.

OSM semantic masks retain polygon holes and resolve overlaps by priority, with a
stable source-id tie break. Local observation cells remain visible inside large
unpartitioned faces; a face majority cannot erase a small observed green or bare
region. Water/swamp classification and slope gates still use their existing seams.
Generic green tags preserve observed subtypes, while explicit forest, scrub,
meadow and farmland tags define their known cover structure.

Surface color uses a separate filtered sRGB texture. Zone indices remain nearest
filtered. Coherent patch density replaces independent texel grain, with subtle
material variation in the existing shader. No replacement terrain skin is laid
over the battle surface. Street panels clip into the actual terrain triangulation,
so their interior heights match the slope as well as their corners.

## Determinism and fallback

Each candidate owns a coordinate-derived stream. Map-center and synthetic-map
seed define one scene seed. Detail ranks are distributed across the whole map
before budget truncation; low-power mode does not empty one end of the battlefield
or change canopy collision. Species selection remains a climate-based procedural
choice rather than a claim about species observed in imagery.

Missing observations retain conservative dry-zone profiles. Missing heights,
water probes, occupied footprints, roads and slope breaks omit candidates.
Canopy placement uses the existing occupancy and trunk-collision registration;
small surface detail and thin street panels remain presentation-only. Observation
completion is still gated before scene generation and never swaps a running battle.

## Verification

audit_habitat executes the shipped planners and land-field builder, including
OSM holes/overlaps, unknown sources, replay, budget prefixes, missing probes and
non-square saddle draping. shot_habitat renders street, meadow, woodland, scrub
and exposed fixtures through the production material pipeline, checks shader
errors and finite geometry, compares renderer replay and measures GPU teardown.
Its optional fixture mode runs buildTerrain and buildBiomes against validated
captured OSM and Terrarium data plus the packaged numeric WorldCover prior.
Rendered fixtures illustrate the recipe; they do not validate survey accuracy.
