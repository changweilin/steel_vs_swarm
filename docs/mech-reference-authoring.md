# Reference-authored mechs and drones

The contract covers all twelve mechs and twelve drones. Morphers and their alternate forms are excluded.
The review bench reads the existing art prompt tables and original mech images; those remain the visual authority.
T10 follows the prompt's anatomical weapon sides and single left-shoulder launcher despite the mirrored illustration.
S01 follows the four enclosed rotor reference instead of the retired insect-wing body.

[The asset contract](../tools/mech_authoring/assets.json) owns component plans, estimated proportions,
material regions, joint bindings, motion channels and acceptance limits.
[The Blender pipeline](../tools/mech_authoring/build.py) and [construction recipes](../tools/mech_authoring/catalog.py)
produce editable scenes under `out/mech_reference/`,
GLB interchange exports under `public/assets/models/reference/`, and runtime joint/material batches
under `public/js/forge/assets/`. Runtime asset data is generated; changes belong in the contract or recipe.
The Blender skeleton follows the named rigid driver joints. Animate these joint objects;
armor stays rigid across elbows and knees. Export clips share their NLA track names.
Limb geometry, tail segments and rider gun compensation derive from those same joint bindings;
the recipe does not maintain a second list of pivot coordinates.

Both the game and review bench use `forgeMech()` and the existing locomotion/combat clock.
Shield deployment is a post-pass on dedicated emitter joints and the free arm; it cannot alter
defense, shield points, damage, collider dimensions or weapon timing. The authored radar membrane
is decorative; the existing authoritative shield presentation remains the gameplay boundary.
Static parts batch only within their own joint and material, preserving moving attachments while limiting draw calls.

Build and verification commands live in [package.json](../package.json).
The authoring runner accepts contracted IDs with `--asset` (comma-separated for a batch), or `--asset all`;
`BLENDER_BIN` selects an existing Blender installation.
Browser verification uses the existing optional Playwright runtime through `PW_MODULE` and `PW_CHROME`.
`THREE_MODULE` can select an existing offline copy of the game's Three.js version and adjacent addon modules.
The review server serves those files through an explicit allowlist when this option is set.
No authoring dependency belongs in the runtime package.
`--rebuild --no-render` writes an isolated factory reconstruction under the evidence directory.
[The rebuild check](../tools/mech_authoring/check_rebuild.mjs) requires identical runtime and GLB bytes.

[Build reports](../out/mech_reference/) identify input/export hashes, measured resources and review renders.
[Runtime validation](../out/mech_reference/runtime-validation.json) loads the exact registry assets and GLB exports,
exercises moving fire/cast/shield poses, invalid time inputs, frame rates, shield depletion and death.
Human acceptance is deliberately separate from these mechanical gates.

Open the review bench with `?mech=<id>`. Its shield and skeleton controls follow the authored rig.
Original reference images remain unchanged; unseen geometry is inferred.
