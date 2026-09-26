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
