# Procedural Random Maps

Random maps have no real-world anchor. The zero-valued center is an inert frame
for the existing metre/coordinate projection; virtual regional coordinates only
select game climate and geological appearance rules. Geographic imagery,
elevation, OSM, WorldCover and place-name providers are bypassed.

## Rules and ranges

`public/js/randomMapRules.js` owns all supported ranges and the versioned recipe.
The map builder exposes separate minimum/maximum controls for each layer.
Overrides must remain inside the supported limits; invalid, reversed or missing
numeric input prevents saving. Carriageway counts and building levels are integers.

| Layer | Parameters | Settlement |
|---|---|---|
| Contour terrain | Amplitude, wavelength, roughness, ridge share, terrace height, datum | Smooth seeded multiscale relief with softened terraces; tactical road corridors stay on the shared datum. |
| Satellite/OSM-style surface | Block spacing, grid jitter, lane count, building density/width/levels, urban/bare/water/wet shares | Connected shared-node streets, clustered semantic land-use cells, bounded building footprints and generated RGB samples. |
| Regional environment | Virtual latitude/longitude, moisture, wind, annual rainfall, vegetation density | Existing game climate/geology bands, existing cultural architecture types, climate-aware tree selection and coordinate-owned canopy density. |

Lengths are game metres. Rainfall reaches forest habitat rules in millimetres per
year and geological weathering as normalized intensity. Bare share applies to
remaining dry nonurban land. Existing biome normalization and water limits remain
the sole mix settlement. Geological appearance is an inferred game classification;
the observation field never reports measured lithology.

## Determinism and integration

Each layer has an independent salted `mulberry32` stream. A seed and the same
ranges recreate the same recipe. Favorites and rooms retain the realized values,
layer seeds and recipe version, so clients need no regional lookup or range UI
state to replay it. Older geographically anchored random recipes require
regeneration rather than silently changing their terrain.

The three mother lanes pass the shared balance, separation and tower audits before
acceptance. They are explicit roads in the generated network; the street lattice
joins them at both bases. Team size selects the shared lane subset without moving
the mother frame. Generated sources use the existing semantic parser, terrain,
evidence, architecture and road pipelines. Rendering and Node terrain audits read
the same procedural samplers. Failed generation is omitted.
The shared map verdict also checks final overlap, endpoints, navigation and frame
identity. Synthetic provenance remains explicit and cannot qualify the recipe as
a geographic road map.

`test/randomMap.mjs` checks bounded recipes, authority validation, connected roads,
team-size stability, forest/geology units, deterministic canopy density, source
isolation, terrain/evidence preparation with external requests trapped, and room
replay. `test/mapSelection.mjs` exercises production builder callbacks and range
controls in desktop and mobile browser layouts. Commands live in `package.json`.
