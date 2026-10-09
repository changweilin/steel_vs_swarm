# Authored combat presentation

All characters consume Blender-authored effects through the existing rigid driver joints.
The art tables in `art_gen.md` supply weapon and move descriptions, prototypes, emblems,
traits and mounting constraints through `combat_intent.mjs`. Shared weapon and ability
definitions supply all combat measures; the existing cultural style supplies the palette
and shield identity. [The construction recipe](../tools/mech_authoring/combat.py)
adds effect attachments and samples their action curves. It does not change weapon timing,
damage, shield points, collision or server settlement.

The builder's combat mode writes separate editable scenes under `out/combat_reference/<id>/`,
integrated GLBs under `public/assets/models/combat/`, and generated effect batches under
`public/js/forge/combatAssets/`. Original body inventories remain owned by their existing
contracts and recipes. Combat GLBs batch by driver joint and material under those same limits.
The shipped renderer attaches the effect batches to the real model instead of loading a second body.

Light/heavy fire events and attack/defense casts drive the sampled curves. Existing locomotion
continues to own body posture. Weapon mechanisms receive the authored event tracks after that
pose, so recoil, emission and recovery use the same event age. Transported projectiles use the
authored meshes through `projectileMesh()` and the existing trajectory/pool; attached effects
cannot draw a duplicate missile or bullet. Beam and ion meshes use the shared clipped-endpoint
seams, normalized to the existing presentation radius and range.

Authored cast fields stay detached from the caster rig until the settled cast or arrival event.
Their normalized three-layer tracks use that event's radius, including partial delivery;
self-only effects use the body scale. Ranged fields include their settled boundary and keep
all animated vertices and particle drift inside it. Fans use the shared spherical sub-cone
ranges and clip each ray against obstacles. Each triangle, fragment and bright core belongs
to one angular bin; adjacent bins share only their boundary and apex. Exported ownership and
convex half-space checks prevent overlapping interiors after aiming, clipping and fading.
The showcase changes camera distance rather
than shrinking those footprints.

Shield placement derives from the body envelope over running, firing, casting and both morph forms.
Its projection has a fixed clearance ahead of that envelope; free-arm emitters can articulate
without pulling the membrane into the hull. Every defense cast projects a decorative shield.
Cached local joint bounds also cover morph rotations and firing postures that exceed both endpoint
envelopes. That clearance pass only moves the projection; it never changes the pose.
The same presentation clock handles ordinary defense and both morph trees, including depletion,
death and retraction. Cultural textures reuse the cast compositor's canonical signature and frame.

Commands live in [package.json](../package.json). MCP authoring requires an already running
Blender add-on; `BLENDER_MCP_BIN` selects the installed MCP server executable. The runner's
`--combat` mode also supports the existing Blender CLI route for clean reconstruction.
The runtime audit requires the existing optional Playwright runtime and uses `THREE_MODULE`
for an available offline dependency copy. No authoring dependency belongs in the runtime package.

The audit writes runtime measurements and action, field-layer and fan contact sheets under `out/combat_reference/`.
It checks every character and morph form, every event channel, front clearance, unique shield
textures, independently loaded GLBs, field bounds, disjoint fan bins, resource limits and repeated GPU teardown. Visual acceptance
uses those exact rendered exports and remains a user review decision.
