# Geographic scene studio

The generator's geographic tab invokes `buildTerrain` and `buildBiomes` directly.
Exact OSM footprints, polygon holes, building tags, climate-aware forest models,
habitat detail, exposed-ground models and settled water use the battle pipeline.
Generation starts only on an explicit request; selecting a venue does not fetch
public geographic services. Leaving the tab invalidates pending scene attachment.

Source failures remain visible as partial coverage. WorldCover is the dated
ESA 2021 v200 prior, not current imagery or a building-height measurement.
Geology remains unknown; procedural rock appearance does not identify lithology.
Species and untagged heights remain procedural interpretations.

The Blender snapshot contains shared triangle geometry, material base colors,
vertex colors and resolved instance transforms. `tools/import_geographic_scene.py`
imports it into a separate Blender scene, preserving existing scenes. The import
converts Y-up game coordinates to Z-up once and handles mirrored triangle winding.
Deflate-compressed float32/index channels preserve geometry without expanding
large facade batches into oversized decimal JSON strings. The importer uses
Blender's bundled NumPy and bulk mesh writes; no runtime dependencies are added.
The resolved land-surface color field is baked into terrain vertex colors.
Cel shading, other procedural shader fields, textures, weather animation and skinning
are outside the snapshot; use the browser view to assess shipped materials.
Coordinates remain game metres, including the existing geographic compression.
Non-finite geometry and unsupported skinned meshes are omitted with explicit
records in the snapshot. Source attribution and prior identity accompany exports.

OSM-derived exports require [OpenStreetMap attribution](https://www.openstreetmap.org/copyright).
The satellite prior retains [ESA WorldCover attribution](https://esa-worldcover.org/en/data-access)
under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Commands live in `package.json`.
