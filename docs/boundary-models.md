# Boundary presentation surfaces

`boundaryAppearance.js` adapts Blender-authored surfaces from `boundaryMeshData.js`
to the existing render-free part descriptors. Masonry and concrete tile in metres,
recessing joints inside the original envelopes. Their parent edges remain exact so
sloped sections, end caps and adjacent modules retain their contacts. Gatehouses
reuse their roof envelope; the cast tetrapod junction and filleted legs retain four
tetrahedral directions under a deterministic rigid pose.

Natural boundaries retain the shared geological grid. Authored scarp profiles and
periodic fracture relief enter that grid before mesh extraction and cover landing,
so the body and outward buffer sample identical geometry. The deployed boundary
entry blends this seeded relief into world-aligned end profiles. Shared ends and
mitered corners use seed-independent geometry and colour; mixed masonry contacts
retain their cross-sections, while discrete neighbours receive a valley termination.
Snow coverage uses the shared end slope to avoid seed-dependent colour seams.
Buried toes stop at the existing ring floor rather than enlarging collision bounds.
Strata colours precede the existing seasonal surface treatment. Other geological
consumers omit the surface adapter and retain their original generation.

Array and scatter joints ease density and orientation toward the neighbouring
layout. Whole units respect the shared end plane or outward corner diagonal;
failed fits are omitted instead of clipping vehicles, buildings or moving parts.
Structural runs terminate at abutments and intact arrays at perimeter frames.

The collision ring, biome selection, placement envelopes and shared random stream
remain independent of these meshes. Runtime renderers own and dispose geometry;
the appearance seam stores CPU arrays only.

`tools/boundary_authoring/author.py` rebuilds the surface library in an isolated
Blender scene. The review command exports deployed models for the shared studio
through `tools/boundary_authoring/preview.py`. Editable Blender scenes and captures
live in ignored `out/boundary_review/`. Commands live in `package.json`; topology,
physical contacts, deterministic replay and triangle budgets are guarded by
`test/boundaryAppearance.mjs`, `test/boundaryJoins.mjs` and the world-edge and buffer
audits. The joint review uses deployed entry points and can export mixed structures
through the same Blender studio; its captures and editable library live in the
`joins` output subdirectory.
