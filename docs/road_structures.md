# Road structures

`public/js/roadStructures.js` owns bridge grades, connected-layer datums, support clearance, fitted roundabout islands and military-platform approaches. Bridge grade limits come from `MAPGEO`; impossible profiles omit their geometry and standing indexes together and count in `bridgeGradeRejected`. Underpasses and road culverts retain the existing tunnel planning and excavation seam.

`public/js/roadStructureRender.js` consumes normalized members baked by Blender from `tools/road_structure_authoring/author.py`. Full datum faces remain intact; concrete chamfers retreat into existing collision envelopes. Jersey barriers, portal frames, gallery columns, cap beams and platform slabs share that library. Expansion joints, drains and island curbs use bounded batches without shared layout randomness.

Deck queries accept a height band. Standing chooses a reachable deck, ceilings choose the nearest overhead slab, and ballistic overlap tests each intersected deck layer. Interchange branches retain their common datum and open parapets at shared road nodes. Bridge supports avoid other carriageways.

Land-base access profiles settle in `terrain.carvePlatforms` before road rendering. Both cutting and filling use the same approach; it extends beneath the slab across height-grid triangles to avoid an interpolation gap at the platform edge. Water approaches are omitted.

The `audit:roads` package script executes production planning, standing, collision-related queries and terrain excavation sources. The `shot:roads` script assembles ten synthetic terrain cases with actual production builders, probes both directions at 0.35 m intervals using the standing and collision methods, and exports geometry, texture images and traversal results. It requires an existing Playwright/Chrome runtime and a local Three.js module cache; no dependency is added.

Blender MCP executes `author.py` for the member bake and `preview.py` for review assembly and rendering. The review uses exact exported road meshes with sectioned synthetic terrain around buried structures. It writes ten editable scenes, packed textures and PNG renders under the ignored `out/road_structure_review` directory. These fixtures verify selected landforms and junctions; they do not certify every external map.
