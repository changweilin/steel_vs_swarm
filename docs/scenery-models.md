# Scenery and civilian surfaces

Blender authors the local surfaces in `sceneryMeshData.js`. `sceneryAppearance.js` scales CPU mesh data; renderers retain ownership of disposable geometry. Box chamfers keep the original dimensions, position and assembly descriptors, including thin panels and moving equipment. Concrete planters have an open shell, and wind turbines use swept, tapered blades.

Civilian anatomy, hair and footwear attach to the existing articulated hierarchy in `npcModels.js`. Entity appearance streams and `civilianBody()` remain the sole sources of identity and hit dimensions; `models.js` still fits the finished model to authoritative height. Civilian models do not consume background-object assembly data.

Natural surface templates fit circular scatter envelopes. Forest crowns replace presentation geometry only; species, branches, climate, seasonal organs, wind and layout streams remain in the forest seam. Habitat stones and mushroom caps reuse the same authored library. Street furniture, supply cases, agricultural equipment, ground furniture and assembled background buildings receive their surfaces through existing render entry points.

The authoring and review tools live under `tools/scenery_authoring/`. Run `author.py` with Blender to reproduce the library and editable surface scene. The review command captures deployed models and exports them to the shared Blender studio through `preview.py`. Generated captures and `.blend` files live under ignored `out/scenery_review/`.

Topology and civilian triangle budgets are checked by `test/sceneryAppearance.mjs`. Existing civilian, motion, hit, habitat, scene-model and GPU guards cover body fitting, animation, placement, batching and disposal.
