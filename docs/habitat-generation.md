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
| osmAreaCatalog.js / osmAreaLayout.js | Facility envelopes, aligned parcel layouts and source-backed utility point placement. |
| osmAreaObjects.js / sceneFurnitureParts.js | Bounded area batches and reusable manufactured object models. |
| biomes.js | Existing clearance, OSM ownership, climate-aware botanical selection and trunk collision integration. |
| toon.js | Surface texture lifetime, color-space decoding and world-anchored material variation. |

## Interpretation

Woodland has a canopy and low understory; grassland keeps an open silhouette;
scrub uses low clusters; cropland and pasture do not acquire random forest trees.
Orchards use parcel-aligned canopy rows. Explicit leaf-type tags narrow procedural
canopy forms while climate still gates species; imagery does not identify species.
Sand and exposed rock use different surface palettes and fragment densities,
without a mineral claim. Marsh, wet meadow and tidal mudflat keep distinct silhouettes;
shallow-water detail requires a finite settled depth. Satellite cover alone cannot
create water or swamp authority.
Built cover creates paved verges and sparse furniture from actual road direction. RGB brightness and
texture vary existing materials; gray pixels cannot seed a real-world city.
Directional contrast changes no road bearing or building footprint.

Free surface cells receive habitat-compatible detail before optional densification.
The coverage lattice expands with map area against the fixed normal presentation
budget, preventing a large map from spending its quota on only part of its free cells.
Each cell offers isolated jittered slots with bounded retries; occupied slots reduce
the available density rather than pushing objects into neighbouring space. Cover
profiles set minimum coverage and maximum local density. Plants, reeds, crops,
scrub and stones follow the resolved habitat; built gaps can use sparse planters.
Complete geometry envelopes remain separated, and semantic boundaries are tested
as disks so narrow masks and small holes cannot be bridged by infill.
Street panels, furniture and every facility's visual footprint reserve space before
surface filling, including non-solid crops and floating fish cages.

Mapped agricultural, livestock, aquaculture, greenhouse, flood-control, sawmill,
mining and power uses select their corresponding models. Fields and equipment
arrays follow parcel edges. Natural woods and wetlands use the habitat seam rather
than a second generic tree/reed generator. A forest tag alone does not imply logging.
Mapped wind-generator points replace synthetic layouts within their wind-farm area.
All area objects fit their complete circular envelope, including small polygon holes,
and yield to buildings, higher-priority masks, roads, tactical clearance and slope limits.
Floating equipment requires settled water and uses its surface height.

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
before budget truncation, with the first coverage round preceding denser rounds;
low-power mode does not empty one end of the battlefield
or change canopy collision. Species selection remains a climate-based procedural
choice rather than a claim about species observed in imagery.

Missing observations retain conservative dry-zone profiles. Missing heights,
water probes, occupied footprints, roads and slope breaks omit candidates.
Canopy placement uses the existing occupancy and trunk-collision registration;
small surface detail, street furniture and thin street panels remain presentation-only. Observation
completion is still gated before scene generation and never swaps a running battle.

## Verification

audit_habitat executes the shipped planners and land-field builder, including
OSM holes/overlaps, unknown sources, replay, budget prefixes, free-cell coverage,
local density bounds, pairwise envelope separation, placement retries, missing probes and
non-square saddle draping, tagged facilities and exact utility points. shot_habitat
renders natural, wetland, urban and manufactured-use fixtures through the production material pipeline, checks shader
errors and finite geometry, compares renderer replay and measures GPU teardown.
Its optional fixture mode runs buildTerrain and buildBiomes against validated
captured OSM and Terrarium data plus the packaged numeric WorldCover prior.
Rendered fixtures illustrate the recipe; they do not validate survey accuracy.
