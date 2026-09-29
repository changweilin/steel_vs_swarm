# Scene model rebuild checklist

Scope: replace legacy scene geometry while preserving entity identity, placement,
server-owned collision, health, damage, rewards, and deterministic layout.
Checked items require both runtime-path verification and the relevant audits;
visual review must use the shipped builders, including damaged states.

## Inventory and runtime ownership

| Family | Legacy types / consumers | Geometry owner |
|---|---|---|
| Natural obstacles | `sacredtree`, `fallentree`, `boulder`, `rockfall`, `landslide` | `forest.js`, `geology.js`, adapted by `scenePropModels.js` |
| Artificial obstacles | `construction`, `wreck`, `car`, `ship` | `sceneFurnitureParts.js`, existing vehicle and vessel generators |
| Disasters | `fire`, `forestfire`, `grassfire`, `factoryfire`, `sinkhole`, `pothole`, `flood` | `sceneDisasterGeometry.js`, `hazards.js` |
| Vegetation | `LEGACY_PLANT_SPECIES`, `GROUND_PLANTS`, road and roof planting | `scenePlantParts.js`, shared forest generator |
| Tree attachments | `gnest`, `epiphyte`, `antnest`, `beehive`, `branch`, `vinebranch`, `treehouse`, `vine` | `sceneAttachmentParts.js` |
| OSM area objects | `tank`, `crop`, `tree`, `bench`, `goal`, `car`, `motorcycle`, `solar`, `facility`, `spire`, `marker`, `barrier`, `signal`, `buoy`, `reed`, `rock`, `transformer` | `osmAreaGeometry` delegates to shared generators; building function follows OSM tags |
| Street and roof furniture | Lamps, signals, park fixtures, stands, water tanks, AC units, antennas | `sceneFurnitureParts.js`; existing placement in `biomes.js` and `siteplan.js` |
| Landmarks and tactical objects | `LEGACY_LANDMARK_TYPES`, `aasite`, `relay`, mines, loot, airdrops | `sceneLandmarkModels.js`, `sceneFurnitureParts.js`, `hazards.js` |

The legacy landmark roster covers hospital, school, station, temple, church,
mosque, museum, power, factory, castle, lighthouse, pagoda, stadium, shrine,
mandir, stupa, synagogue, gurdwara, stave church, pyramid, slate house,
tongkonan, Egyptian pylon, Sahel mosque, Nuer tukul and Inuit igloo.
Their cultural silhouettes and original placement envelopes remain authoritative;
facades, masonry, roof profiles and structural surfaces are rebuilt within them.

Existing generated vehicles, giant forest species, geological boundary objects,
tower buildings and heritage ruins retain their shared generators. The adapters
reuse these generators instead of introducing competing model catalogues.

Legacy descriptor dimensions remain layout inputs where collision and scatter
consume them. They are not the rendered fallback for the replacement types.

## Natural obstacles
- [x] Sacred tree: connected roots, branching trunk and separated foliage clusters.
- [x] Fallen tree: shared forest deadwood with exposed broken ends.
- [x] Boulder, rockfall and landslide: shared geology geometry.

## Artificial obstacles
- [x] Construction barriers, cones and scaffolding.
- [x] Wrecks and parked cars: preserve the shared vehicle generator.
- [x] Stranded ship: shared vessel hull and equipment.

## Disaster scenes
- [x] Urban, forest, grassland and factory fires: flame and smoke silhouettes.
- [x] Sinkhole, pothole and flood: terrain contact and irregular edges.

## Vegetation
- [x] Roadside, rooftop and understory trees: shared forest generator.
- [x] Shrubs, grass, reeds and bamboo ground cover.
- [x] Mushroom species: stems, cap profiles and clusters.

## Tree attachments
- [x] Nests, epiphytes, ant nests, beehives, treehouses and vines.

## OSM area objects
- [x] Trees, crops, reeds and rocks use shared natural generators.
- [x] Parked vehicles use the shared vehicle generator.
- [x] Tanks, benches, goals, facilities, spires, markers, barriers, signals,
      buoys and transformers.

## Street furniture and building attachments
- [x] Streetlights, traffic signals and market lamps.
- [x] Park gazebo, pond, flowerbeds, seating and sports stands.
- [x] Rooftop tanks, air conditioning and antennas.

## Landmarks and tactical objects
- [x] Legacy civic, religious, cultural and industrial landmark builders.
- [x] Air defence site and relay station.
- [x] Mines, supplies and airdrops.

## Verification
- [x] Deterministic geometry and finite bounds across seeds and sizes.
- [x] No shared layout RNG consumption introduced.
- [x] Collision and gameplay definitions unchanged.
- [x] Damage, collapse and restoration preserve geometry ownership.
- [x] Client syntax, geometry joints and resource lifecycle checks.
- [x] Multi-angle visual review with runtime builders, including winter and night lighting.
