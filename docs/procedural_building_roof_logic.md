# Procedural Buildings, Roof Frames, and Part Generation

> SSOT: `public/js/osmBuilding.js` (footprint body), `architectureStyles.js`
> (`resolveAdaptiveRoofForm()`), `architecturalFacadeParts.js`,
> `architectureRoofParts.js`, `architecturePartGeometry.js` (OSM-side geometry
> adapter), `buildingAppurtenances.js`, `buildingFunctions.js`,
> `regionalArchitecture.js`, `heritageSites.js`.
> Verification: `node test/buildingGeneration.mjs`, `node test/regionalArchitecture.mjs`,
> `node test/buildingFunctions.mjs`, `node test/heritageSites.mjs`.

## Pipeline (four strict phases)

1. Deploy body and measure: keep the true outer ring and courtyard holes; never
   simplify non-orthogonal or concave polygons to a center AABB. Measure width,
   depth, short-span, aspect, exact area (shoelace), and centroid; wall meshes and
   aligned blocker boxes derive from the same edge geometry.
2. Resolve roof with anti-warp downgrade: skyscrapers (>= 35m) step down to
   stepped/flat crowns; giant footprints (>= 750 sqm or >= 28m span) go sawtooth
   (industrial) or flat/stepped; extreme slenderness (aspect > 2.6) drops radial
   roofs for long-axis gables; tiny footprints (< 2.5m span or < 15 sqm) fall to a
   plain shed. Concave or courtyard polygons default to flat so no wing hangs in air.
3. Render facade in depth tiers (glass < frame < trim < pier, non-coplanar offsets)
   so WebGL never z-fights; long residential/industrial walls take graffiti bands,
   commercial faces take video walls and shop signs.
4. Filter parts by roof-compat matrix with area-gradient counts, and validate every
   placement with `isSiteValid` (distance to outer ring and hole edges >= radius +
   margin) so parts never hover over courtyards or pierce parapets.

## Constraints (why, not what)

- One body per building: a compatible whole model or the procedural
  ring/roof/facade -- whole models attach no legacy skirts, stair towers, or second
  roofs. Legacy branches keep only their existing RNG draw order so other scene
  objects never drift.
- Level-only parts stay level: heli hangars, billboards, water tanks, masts, and
  dovecotes mount on flat/stepped roofs only; sloped roofs take only penetrating
  chimneys, ridge antennas, gable belfries, or spire pins.
- Function pooling, not per-function models: `buildingFunctions.js` routes OSM tags
  to shared style pools by explicit current use (a 90m hospital stays a hospital);
  religious sites without a clear tag stay neutral instead of guessed.
- Regional styles are simplified vocabularies (never heritage reconstructions);
  country codes win, and smaller culture bounding boxes are a coarse fallback, not
  administrative boundaries. All variants use coordinate hashes with zero shared-RNG
  cost under the existing batched vertex-color pipeline.
- Ruins reuse the geology ancient-stone selector with seed-proportional scaling:
  tourist versions keep gaps and add paths/rails/signs without completing palaces;
  abandoned versions add weathering only; underwater versions sink the roofline at
  least 0.3m below the surface with sediment instead of land paths.
