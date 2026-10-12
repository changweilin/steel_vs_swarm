# Five-model appearance and motion review

| Model | Refinement | Editable source / export |
| --- | --- | --- |
| s07 / Cthulhu | Eight radial roots share one body height; all arms have distributed curves; the rear arm clears the mantle while firing. | [Blender](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/mech_reference/s07/s07.blend) / [GLB](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/public/assets/models/reference/s07.glb) |
| t06 / Monkey King | Shrunk weapons stay horizontal in their respective hands; a delayed lateral tail sweep stays bounded during turns. | [Blender](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/morph_reference/t06/t06.blend) / [GLB](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/public/assets/models/reference/t06.glb) |
| m05 / Wolf | Three blades on each hand remain parallel to their forearm in every sampled ground and flight action. | [Blender](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/morph_reference/m05/m05.blend) / [GLB](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/public/assets/models/reference/m05.glb) |
| m07 / Rhino beetle | The horn curves upward and tilts forward; separated barrels enter a widened receiver at a fixed exposed height. | [Blender](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/morph_reference/m07/m07.blend) / [GLB](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/public/assets/models/reference/m07.glb) |
| s06 / Centaur | Carried bow and arrow follow their forearms outside the light firing pose. | [Blender](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/mech_reference/s06/s06.blend) / [GLB](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/public/assets/models/reference/s06.glb) |

## Preview

[Overview](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/appearance_refinement/overview.png) · [Five views per model](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/appearance_refinement/shape.png) · [Six action states](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/appearance_refinement/actions.png).

Animated cycles: [Cthulhu](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/appearance_refinement/s07-run.gif) · [Monkey King](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/appearance_refinement/t06-run.gif).

## Validation

Full cycles verify forearm-aligned carry, radial root height, rear-arm clearance, whole-arm curvature, lateral tail reversal, bounded turning, weapon/sole clearance, constant cannon height and both barrel-to-receiver and muzzle-to-horn paths. Native Blender checks also confirm all six wolf blades follow their forearms at every sampled frame.

Independent Blender loads compare 2,852,735 joint samples; GLB imports compare 485,035 samples across all 23 sampled assets. Positions, rotations and scales match. Both morph forms, source recovery, shipped registry and shield controls pass. Unit motion passes at 30, 60 and 144 FPS; all 32 combat scenes and effects pass their independent checks. Clean rebuilds reproduce the octopus, wolf and beetle structure and geometry.

[Fingerprint manifest](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/appearance_refinement/delivery-validation.json) · [Equipment evidence](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/appearance_refinement/runtime-validation.json) · [Rebuild evidence](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/appearance_refinement/rebuild-validation.json).

## Owners and references

[Base asset contract](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/tools/mech_authoring/assets.json) · [Morph asset contract](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/tools/mech_authoring/morphers.json) · [Morph geometry recipe](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/tools/mech_authoring/morph_recipe.py) · [Motion driver](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/public/js/locomotion.js) · [Equipment pose](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/public/js/anatomicalPose.js).

The distributed curves and delayed tail motion are authored approximations informed by [MBARI octopus locomotion observations](https://www.mbari.org/news/mbari-researchers-deploy-new-imaging-system-to-study-the-movement-of-deep-sea-octopus/) and [Wisconsin National Primate Research Center monkey locomotion references](https://primate.wisc.edu/primate-info-net/pin-factsheets/pin-factsheet-patas-monkey/). Visual inspection passes; user signoff remains pending.
