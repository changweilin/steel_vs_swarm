# Mech appearance and motion review

The eleven requested bodies and their runtime motion are updated. The retired external carrier mount is removed from all eight morphers.

| ID | Model | Editable source | Exact export |
| --- | --- | --- | --- |
| s06 | Centaur | [Blender](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/mech_reference/s06/s06.blend) | [GLB](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/public/assets/models/reference/s06.glb) |
| s07 | Cthulhu | [Blender](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/mech_reference/s07/s07.blend) | [GLB](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/public/assets/models/reference/s07.glb) |
| s09 | Kangaroo | [Blender](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/mech_reference/s09/s09.blend) | [GLB](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/public/assets/models/reference/s09.glb) |
| m02 | Tyrannosaur | [Blender](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/mech_reference/m02/m02.blend) | [GLB](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/public/assets/models/reference/m02.glb) |
| t12 | Colossus | [Blender](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/mech_reference/t12/t12.blend) | [GLB](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/public/assets/models/reference/t12.glb) |
| t03 | Gorilla | [Blender](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/mech_reference/t03/t03.blend) | [GLB](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/public/assets/models/reference/t03.glb) |
| t06 | Monkey King | [Blender](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/morph_reference/t06/t06.blend) | [GLB](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/public/assets/models/reference/t06.glb) |
| s10 | Raptor | [Blender](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/morph_reference/s10/s10.blend) | [GLB](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/public/assets/models/reference/s10.glb) |
| t11 | T11 | [Blender](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/morph_reference/t11/t11.blend) | [GLB](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/public/assets/models/reference/t11.glb) |
| m05 | Wolf | [Blender](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/morph_reference/m05/m05.blend) | [GLB](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/public/assets/models/reference/m05.glb) |
| m07 | Rhino beetle | [Blender](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/morph_reference/m07/m07.blend) | [GLB](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/public/assets/models/reference/m07.glb) |

## Review images

Five views per body: [Sheet 1](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/appearance_motion/shape-1.png), [Sheet 2](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/appearance_motion/shape-2.png), [Sheet 3](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/appearance_motion/shape-3.png).

Idle, run, light, heavy, defense and attack: [Sheet 1](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/appearance_motion/actions-1.png), [Sheet 2](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/appearance_motion/actions-2.png), [Sheet 3](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/appearance_motion/actions-3.png).

Run cycles: [s06](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/appearance_motion/s06-run.gif), [s07](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/appearance_motion/s07-run.gif), [t06](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/appearance_motion/t06-run.gif), [s10](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/appearance_motion/s10-run.gif).

## Verification

The equipment guard covers all eleven changed bodies over full cycles and actual vertex bounds. Unit motion passes at 30, 60 and 144 FPS. Independent Blender loads compare 2,852,735 joint samples; independent GLB imports compare 485,035 samples across all 23 sampled motion assets. Positions, rotations and weapon scales match. All 32 combat sources, effects, shield textures and both morph forms pass their combat guard.

Clean rebuilds of the centaur, wolf and beetle reproduce the runtime structure and exported geometry. The final geometry is also compared with the contract snapshot before checking its rest-pose invariants. Runtime-sampled clips are verified directly instead of testing the snapshot's replaced animations.

The T11 generic biped guard still reports a vertical offset between the defense disk and projected shield. The original Git version also fails that legacy guard at its left forearm firing check. Dedicated shoulder placement, firing direction, live shield clearance and morph checks pass. User visual signoff remains pending.

[Validation manifest](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/appearance_motion/delivery-validation.json) · [Equipment evidence](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/appearance_motion/runtime-validation.json) · [Clean rebuild evidence](C:/Users/user/.codex/worktrees/370f/steel_vs_swarm/out/appearance_motion/rebuild-validation.json).

The centaur draw posture follows the [World Archery recurve technique guide](https://extranet.worldarchery.sport/documents/index.php/Media/Information_Sheets/003_Guide_to_Recurve_Technique.pdf): extended bow arm, aligned drawing forearm and a stable face anchor. Other actions retain separate bow and arrow grips.
