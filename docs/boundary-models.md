# Boundary presentation surfaces

`boundaryAppearance.js` adapts Blender-authored surfaces from `boundaryMeshData.js`
to the existing render-free part descriptors. Masonry and concrete tile in metres,
recessing joints inside the original envelopes. Their parent edges remain exact so
sloped sections, end caps and adjacent modules retain their contacts. Gatehouses
reuse their roof envelope; the cast tetrapod junction and filleted legs retain four
tetrahedral directions under a deterministic rigid pose.

Natural boundaries retain the shared geological grid. Authored scarp profiles and
periodic fracture relief enter that grid before mesh extraction and cover landing,
so the body and outward buffer sample identical geometry. Strata colours precede
the existing seasonal surface treatment. Other geological consumers omit the
surface adapter and retain their original generation.

The collision ring, biome selection, placement envelopes and shared random stream
remain independent of these meshes. Runtime renderers own and dispose geometry;
the appearance seam stores CPU arrays only.

`tools/boundary_authoring/author.py` rebuilds the surface library in an isolated
Blender scene. The review command exports deployed models for the shared studio
through `tools/boundary_authoring/preview.py`. Editable Blender scenes and captures
live in ignored `out/boundary_review/`. Commands live in `package.json`; topology,
physical contacts, deterministic replay and triangle budgets are guarded by
`test/boundaryAppearance.mjs` and the world-edge and buffer audits.
