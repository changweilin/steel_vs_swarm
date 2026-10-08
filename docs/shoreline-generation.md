# Water and land interfaces

`shoreline.js` conditions presentation on the settled terrain boundary and the room's
existing satellite/OSM observation field. Water use follows the explicit
[OSM water](https://wiki.openstreetmap.org/wiki/Key:water) and
[waterway](https://wiki.openstreetmap.org/wiki/Key:waterway) tags: sea, lagoon,
lake, reservoir, pond, river, stream, canal, drain, ditch, basin and tidal channel.
Generic water stays unknown. RGB and WorldCover corroborate water cover; they do
not establish salinity, water use, engineering inventory or survey accuracy.
Confidence is ordinal support, not a calibrated probability. Conflicting imagery
does not overwrite explicit OSM semantics.

Exact projected water polygons retain priority and holes. Nearby source lines are
considered only outside those polygons. Spatial indexes, terrain sampling and
source-guided cross-sections have bounded budgets; unresolved or dry channels omit
anchors. Normals point toward dry terrain, so opposite banks of narrow channels
remain distinct. The immutable base water datum prevents tidal presentation from
changing the generated layout.

`shorelineCatalog.js` owns facility compatibility and envelopes. Context dressing
uses built/vegetated observations; beach sand and rocky shores require explicit
OSM natural tags. Safety, mooring and water-control point features require their
own OSM tags. Historical cover cannot prove that a particular structure exists.
Mapped points retain their coordinates. Long mapped piers, breakwaters, groynes
and dams are not reconstructed from point proxies or inferred from satellite
pixels. Their library members are available for compatible authored assemblies;
this pipeline does not settle engineering geometry or navigable decks.

Procedural maps explicitly enable the compatible facility appearance pool from
their saved recipe. They can vary infrastructure without geographic POIs. This
flag comes from the existing map-mode seam, never from an OSM source string.
Those placements remain labelled procedural appearance and obey the same fitted
dry envelopes, reservations, omission rules and isolated seeds.

The Blender library covers natural banks, dune fences, timber/steel rails, quay
edges, riprap, gabions, stairs, life rings, moorings, ladders, fixed/floating docks,
fishing decks, kayak racks, slipways, sluices, debris screens, pumps, outfalls,
culvert heads, gauges, groynes, breakwaters, beach showers and rescue towers.
Variants and scale use coordinate-derived seeds. Asset addition consumes no
shared scene randomness. Whole envelopes reject wet, missing, steep, occupied
or out-of-bounds sites; unsupported data is omitted. These are appearance models,
so water, terrain, standing height and combat collision retain their existing owners.

`habitatRender.js` reserves the complete accepted roster before infill and before
the low-power slice. Both clients therefore preserve the same placement while
draw budgets differ. `shorelineRender.js` instances the Blender-baked members;
the battle owns their buffers and materials through the existing teardown seam.

Authoring uses the installed Blender MCP and a separate scene. Browser reviews
execute the production planners and renderer; `preview.py` reuses the shared
Blender studio and saves evidence on editable context scenes. Synthetic sea,
rounded lake/basin and channel cases verify selected rendering and omission
behavior. They do not certify every map or exhaust every possible real-world
shoreline. Editable sources, captures and evidence remain under the ignored
`out/shoreline_review` directory. Commands live in `package.json`.
