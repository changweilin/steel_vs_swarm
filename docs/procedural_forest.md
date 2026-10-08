# Procedural Forest

> SSOT: `public/js/forest.js` (shared by general vegetation, giant groves, boundary
> trees) and `public/js/forestSpecies.js` (species data). Game loads no reference
> photos and no external generation service.
> Verification: `node tools/audit_forest.mjs`, `node tools/audit_tree_joints.mjs`,
> `node tools/audit_gpu_lifecycle.mjs`.

## Constraints (why, not what)

- Catalog names, representative regions and climate tags live with each species.
  Regions describe browsing groups (including broad taxa and generic deadwood), not
  surveyed native-range masks. The preview intersects these tags with crown form;
  habitat sampling then renormalizes the shared distribution within that intersection.
  An empty intersection or unsuitable environment remains empty.
- Species additions reuse the shared procedural forms with species-specific size,
  branching and habitat parameters. Botanical naming references include Kew POWO:
  [Quercus robur](https://powo.science.kew.org/taxon/urn:lsid:ipni.org:names:304293-2/general-information),
  [Ginkgo biloba](https://powo.science.kew.org/taxon/urn:lsid:ipni.org:names:262125-1/general-information),
  [Vachellia tortilis](https://powo.science.kew.org/taxon/77087190-1), and
  [NatureScot's native woodland list](https://www.nature.scot/professional-advice/land-and-sea-management/managing-land/forests-and-woodlands/native-versus-non-native-woodland).

- Zero shared-RNG discipline: each plant grows from coordinate seeds. New shapes and
  organs use independent randomness and MUST NOT consume the shared scene sequence,
  so adding a species never shifts the whole map's vegetation and building layout.
- Slope gates read real terrain: 45+ degrees requires a `steep` flag, 85+ degrees
  skips; fallen logs exclude from 28 degrees. Explicit author slopes can only raise
  the true slope, never overwrite a cliff into flatland.
- Environment values are game proxies, not field data: geology-to-pH, lat/alt-to-temp,
  and the 0-1 salinity index are overridable stand-ins. Mangroves additionally require
  explicit salinity plus a real water-body check (surface height, max 0.8m depth);
  salt alone never turns dry land into mangrove.
- Wind and batching: trunks add a segment per 5 world meters with phase delay rising
  along height and zero displacement at roots; wood, crown, flower, and fruit share
  one local frame and wind parameters so joints never separate. Each plant merges to
  2-4 draw batches; flower/fruit ride independent seeds so seasons never reshape
  trunks, roots, or collision.

- Seasonal appearance uses `seasonalEnvironment.js` across plants, rock covers and
  ground textures. Latitude and elevation modulate local named seasons (no hemisphere
  inversion of an explicitly selected season); explicit temperature is the current
  temperature and receives no additional seasonal offset. Habitat sampling retains
  its long-term baseline so dormant plants do not relocate.
- Species opt into deciduous or drought shedding in `forestSpecies.js`; evergreen
  is the default. A separate seed hides crowns while preserving woody geometry and
  colliders. Flower/fruit calendars additionally require growing conditions. Snow
  needs both cold and moisture and shares tree-local wind with its supporting parts.
  These are stylized opening-scene states, not a live phenology simulation.
- Flower/fruit growth also uses the species' existing soil-pH suitability curve.
  Explicit pH overrides the geological proxy; unknown substrate adds no penalty.
  Soil stress suppresses reproductive organs without reshaping the woody skeleton.
- Legacy instanced shrubs and grasses apply local seasonal strength, drought and
  snow through instance colors, retaining shared meshes and instance transforms.

## Vegetation communities

- `habitat.js` resolves structure after satellite cover and exact OSM masks; climate,
  annual rainfall in millimetres, latitude, altitude and settled water select appearance
  priors. Explicit grassland and managed fields remain open. Water deficits favour
  shrubs and xeric forms; an oasis requires mapped oasis semantics or nearby settled
  water, and known saline water cannot supply it. These proxies are not groundwater
  measurements or species occurrence records.
- `habitatCatalog.js` owns stocking, stature and relative juvenile/mature/old stages.
  Age labels describe visual development, not years inferred from imagery. Gap patches
  favour recruitment; stands share a dominant taxon with a minority of other suitable
  taxa. Climate and leaf structure still filter every sampled species.
- Dense stands reuse three seeded botanical skeletons per species and phenology state.
  The same skeleton supplies rendering, ground footprint and trunk collision; seasonal
  batching never alters planting coordinates. Planting reserves capacity for later
  static colliders instead of creating visible solid trees beyond the authority limit.
  Surface patches spread metre-scale blades within fitted envelopes instead of enlarging
  a single grass tuft; terrain-plane shear keeps roots on slopes and blades upright,
  while non-planar or missing probes omit a patch.
- Ecological references: [FAO grassland structure and water constraints](https://www.fao.org/agriculture/crops/thematic-sitemap/theme/spi/scpi-home/managing-ecosystems/management-of-grasslands-and-rangelands/grasslands-what/en/),
  [NPS canopy gaps and uneven-aged forests](https://home.nps.gov/neri/planyourvisit/old-growth-forest-hike.htm),
  and [NPS desert vegetation, elevation and water availability](https://home.nps.gov/deva/learn/nature/plants.htm).
  Numerical rendering budgets are game appearance choices, not ecological survey estimates.
