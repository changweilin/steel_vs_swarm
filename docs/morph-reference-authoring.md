# Reference-authored morphers

All eight morphers use the review bench's original dual-form illustrations and prompts.
The prompt owns anatomical weapon sides when an illustration reverses them.
Unseen rear surfaces, cavity depth and shield hardware are inferred.

[The morpher contract](../tools/mech_authoring/morphers.json) owns the component plan,
rig, rigid endpoint transforms and acceptance. It inherits project limits from the existing
asset contract. [The morpher recipe](../tools/mech_authoring/morph_recipe.py) consumes the
existing Blender builder and geometric utilities. Both registry forms consume one generated
mesh inventory; the flight wrapper cannot introduce another geometry source.

The existing morph solver derives motion from the two endpoint rigs. Stable joint/material
tags keep the same parts paired across the rig swap. Cape panels retain their dimensions.
Closed flight bays contain folded ground limbs without changing their rigid scale.
The flying squirrel follows its individual prompt: exactly four exposed struts support
the patagium. The Atlas arms remain propulsion mounts for its shared rotor shields.
Only the beetle membrane wings enter the flap driver; its elytra remain protective armor.

Shield deployment shares one presentation clock across both trees. Its mechanical post-pass
follows the interpolated transform without advancing that clock twice. The authored membrane
remains decorative; defense, shield points and collision remain server-owned.

Commands live in [package.json](../package.json). Editable Blender sources and review renders
live in `out/morph_reference/<id>/`; the GLB and runtime batches use the existing export seams.
[Source validation](../out/morph_reference/source-validation.json) reopens the editable file,
recovers actions and tests folded limb vertices against each authored hull profile.
[Runtime validation](../out/morph_reference/runtime-validation.json) exercises the shipped
registry, reversible transitions, fire/cast/shield motion, frame rates and independently loaded
GLB clips. Comparison sheets preserve original images alongside exact renders.
Visual approval remains a separate user review gate.
