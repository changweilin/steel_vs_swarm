# Blender Transport Surfaces

`vehicleCatalog.js` remains the generator and collision adapter. `transportAppearance.js`
applies Blender-baked meshes from `transportMeshData.js` after equipment, suspension,
plates and weathering settle, so presentation never changes sampled state or collision
contracts. Original part roles survive mesh replacement; labels and crushed wrecks
retain the same host path. Vehicle recipes use role occurrence slots and normalized
vehicle dimensions, including explicit badge offsets for sloped cab surfaces.

`vesselGeometry.js` consumes the authored hull stations and bilge sections. Open boats
retain their recessed shell, barges retain flat bottoms, and catalog envelopes, deck
reservations, placement probes and wake anchors remain authoritative for their existing
purposes. The legacy patrol/wreck hull helper stays independent of these surface edits.

The source-export command in `package.json` prepares unmodified production descriptors.
Run `tools/transport_authoring/author.py` in Blender to regenerate the baked module and
editable source; `export_review.mjs` and `preview.py` reconstruct the shipped meshes for
inspection. All scene outputs live under `out/transport_review/`. The scripts create
separate scenes and preserve existing user scenes. The screenshot and appearance audit
commands in `package.json` use the repository's Three.js revision; browser tooling stays
outside application dependencies.

`test/transportAppearance.mjs` checks sampled-state equality, plate backing, actual
windshield visibility, finite normals after crushing and triangle budgets. Attachment,
vehicle-diversity, everyday-vehicle and vessel tests guard the existing contracts.
