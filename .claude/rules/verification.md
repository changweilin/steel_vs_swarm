# §5 Change Area → Guarding Audits (verification matrix)

> Layer 2: topic-to-guard mapping only. Principles live in root `AGENTS.md`; full definitions live in `seams-*` and `antipatterns.md`; assertion details live in audit script headers (layer 4). English only; no operations.

| Change area | Guards | Invariant |
|---|---|---|
| Shader-bearing client scripts | `audit_client_syntax` | Embedded shader strings keep parseable boundaries. |
| Roster kind and visual assignment | `audit_muzzle`, `audit_cockpit` | Roster composition and per-kind identity stay stable. |
| Fire-rate compression and burst presentation | `audit_fire_rate` | Rate changes preserve expected output ordering. |
| Movement-speed compression | `audit_speed_comp` | Speed gaps narrow while ordering stays unchanged. |
| Move penalty while firing | `audit_recoil_move` | Firing slows movement without canceling recoil. |
| Blast families and area budgets | `audit_aoe_trim` | Area trades against single-target power through one family seam. |
| Building damage convergence | `audit_shield_counter` | Anti-building output converges through the single derivation loop. |
| Shield split and shield-axis setup | `audit_shield_counter` | Shield and armor handling stays single-track. |
| Codex hexagon chart | `audit_hex_stats` | Chart bands derive from weapon output. |
| Upgrade steps and battle score | `audit_shop_auto` | Step prices and score gates advance together. |
| Shop sweep and reservation | `audit_shop_auto` | Purchase order behavior stays unchanged. |
| Story map and boss setup | `audit_story_map`, `audit_story_talk` | Story geometry stays isolated from standard battles. |
| Siege lock and boss dialogue | `audit_story_talk`, `audit_story_map` | Lock floors and dialogue triggers stay on their single seams. |
| Story interface and local storybook | `audit_story_talk`, `audit_ui_layout` | Story marks stay complete across both consumers. |
| Lane engagement model | `audit_aoe_trim` | Lane model self-checks stay consistent. |
| Self-type compensation gesture | `audit_self_ult`, `audit_ult_carrier` | Self-type group keeps positive delivery. |
| Escort fleet behavior | `audit_self_ult`, `audit_ult_carrier` | Escorts exist only as server entities during attacks. |
| Carrier origin and slot pacing | `audit_ult_carrier` | Carriers launch from named points under slot pacing. |
| Ultimate delivery | `audit_ult_carrier` | Delivery guards stay closed until conditions hold. |
| Carrier forms and ballistics | `audit_flight_power` | All carrier forms keep bounded effective ratios. |
| Carrier health and blast pricing | `audit_flight_power` | Carrier durability derives from turret output. |
| Flight dynamics | `audit_flight_power` | Falling-hit height behavior stays unchanged. |
| Range sphere and mortar fire control | `audit_weapon_gate` | Range, muzzle, flight time, and bounds stay consistent. |
| Tolerance, blast volume, halo, air control | `audit_weapon_gate` | Gate tolerance and volume behavior stay bounded. |
| High-ground suppression | `audit_weapon_gate` | Suppression never leaks into same-height paths. |
| Evasion and blast dice with compensation | `audit_weapon_gate` | Evasion preserves expected output through compensation. |
| Pursuit and blast spread | `audit_weapon_gate` | Pursuit and spread behavior stays unchanged. |
| Ridge occlusion | `audit_weapon_gate` | Ridge blocking stays deterministic. |
| Lance penetration and vertical bands | `audit_lance_hit` | Penetration and band switching stay consistent. |
| Guidance and lock behavior | `audit_weapon_gate` | Guidance behavior stays unchanged. |
| Reload and fan edges | `audit_weapon_gate` | Reload gating and fan geometry stay consistent. |
| Hit height and hit radius | `audit_lance_hit` | Vertical inclusion and edge falloff stay exact. |
| Bot vision and collision | `audit_bot_vision` | Bot perception stays within human limits. |
| Bot tactics | `audit_bot_tactics` | Targeting and retreat behavior stays winnable. |
| Bot roles | `audit_bot_role` | Role assignment leaves the balance fingerprint unchanged. |
| Bot learning policy | `audit_bot_policy` | Policy stays clamped, neutral, and allowlisted. |
| NPC height and unit collision | `audit_npc_collide` | Server height baseline and collision stay stable. |
| World height caps | `audit_world_height` | Ceiling and object caps stay consistent. |
| World edge and buffer skirt | `audit_world_edge` | Boundary staging stays inside collision. |
| World curvature | `audit_world_curve` | Curve and horizon behavior stays stable. |
| Depth of field | `audit_visual_prefs` | Focus behavior stays presentation-only. |
| Day cycle, sun, moon, shadows | `audit_daynight` | Sky contracts stay unchanged by time. |
| Visual knobs and weathering | `audit_visual_prefs` | Knobs stay presentation-only. |
| Soft matter | `audit_soft_stroke` | Vertex sway never moves joint tables. |
| Waves, gusts, grass motion | `audit_soft_stroke` | Water and wind motion stays presentation-only. |
| Flag objects | `audit_soft_stroke` | Layout stays deterministic with zero shared randomness. |
| Cel pipeline and outline width | `audit_cel_pipeline` | Outline decisions stay reproducible. |
| Resource lifecycle and adaptive resolution | `audit_gpu_lifecycle` | Resource release stays complete. |
| Outline buffer and new shader materials | `audit_cel_pipeline` | Soft alpha contract restores exactly when disabled. |
| Terrain codes and color branch | `audit_cel_pipeline` | Geometry and randomness stay untouched by color work. |
| Color grade lookup | `audit_visual_prefs` | Grade replaces rather than stacks. |
| Aerial perspective fog | `audit_visual_prefs` | Fog restore returns exactly the ungraded image. |
| Packed outline info and surface groups | `audit_cel_pipeline` | Geometry and shared randomness stay unchanged. |
| Ink breaks, graze term, wipes, dissolve, fade | `audit_soft_stroke`, `audit_cel_pipeline` | Single-writer semantics hold at every soft-contract site. |
| Cel school switching | `audit_cel_pipeline` | Exactly one school active at a time. |
| Structure materials and line authorization | `audit_struct_ink` | Visual changes never leak into geometry. |
| Petals and fallen leaves | `audit_ambient_motion` | Shared randomness sequence stays undisturbed. |
| Leaf cards, rocks, distant backdrop groups | `audit_leaf_card`, `audit_rock_ink` | Shared randomness and canopy contracts stay stable. |
| Foam and reflection consumers | `audit_water_edge` | Foam follows depth; reflections stay presentation-only. |
| Vehicle and prop catalog | `audit_vehicle_spec` | Declared boxes contain measured extents with no second implementation. |
| Bird flocks | `audit_wildlife` | Flocks stay frame-rate independent with zero shared randomness. |
| Animation weight vector | `audit_anim_weights` | Gait output stays unchanged while weights stay normalized. |
| Vegetation disturbance feed | `audit_anim_weights` | Locomotion stays untouched by disturbance feed. |
| Wipe call sites | `audit_visual_prefs` | Cover and reveal calls stay paired with reentry guards. |
| Audio layers | `audit_audio_layers` | Movement bed follows the weight vector with registered sources. |
| Page touch hardening | `audit_ctrl_mode` | Device and layout flags stay separated. |
| Zone cuts and runtime fields | `audit_zone_cut`, `audit_traverse` | Partitioning leaves authority simulation unchanged. |
| Build-time yielding | `audit_client_syntax` | Yielding preserves sampling order and outputs. |
| Procedural object placement | `audit_object_joints` | Joints stay connected without isolated failures. |
| Site layout, shyness, geology | `audit_siteplan` | Passages stay walkable after placement. |
| Settlement fields and source trust | `audit_siteplan`, `audit_venue_biome` | Roster and clipping behavior stays consistent. |
| Building mass and window bands | `audit_siteplan` | Mass and band behavior stays reproducible. |
| Planarization, sealing, wall panels | `audit_siteplan` | Panel grids stay integral inside window bands. |
| Collision profile, fit, signs, glazing | `audit_siteplan` | Ground passage width stays unchanged. |
| Mirror patching | `audit_object_joints` | Part extents and budgets stay unchanged. |
| Semantic landmarks | `audit_beacons` | Landmark extents and ordering stay stable. |
| World text | `audit_world_text` | Atlas, layout, and choice knobs stay consistent. |
| Vernacular corpus | `audit_vernacular` | Rebuilt corpus matches runtime collection rules. |
| Codex format | `audit_codex` | Format layers and pose alignment stay stable. |
| Paper doll and shared stage | `audit_paper_doll` | Both benches keep identical shape and layers. |
| Coating block and tunnel roof | `audit_layer_block` | Geometry stays unchanged across coating work. |
| Open tunnels | `audit_open_tunnel` | Tunnel geometry behavior stays stable. |
| Underpass qualification | `audit_underpass` | Centerline and full-width seam behavior stays convergent. |
| Map bearing and rotation | `audit_road_grid` | Rotation stays an isometry for balance. |
| Road pruning and direction quantization | `audit_road_grid` | Corridors consume one quantized network. |
| Footbridges, entrances, rail corridors | `audit_pedestrian_plan` | Attachments add no blockers and share no randomness. |
| Road paint and structure joints | `audit_road_joint` | Joint invariants stay unchanged. |
| Roadbed leveling | `audit_road_bed` | Tunnel invariants stay unchanged. |
| Slope movement limits | `audit_slope_move` | Grade behavior stays consistent. |
| Terrain rays and holes | `audit_terrain_ray` | Accelerated rays match brute-force results. |
| Walkability | `audit_traverse` | Lanes and structures stay traversable. |
| Clearance heights | `audit_traverse` | Unit height derives without hand-written constants. |
| Climb routes and cross sections | `audit_climb` | Both ends judge the same box identically. |
| Bridge, skirt, and tower pads | `audit_bridge_crossing` | Priority, clearance, and offset stay stable. |
| Mini map and tower layout | `audit_mini_map` | Mini geometry stays isolated from full battles. |
| Lane baking keys and tower ranges | `audit_mini_map`, `audit_story_map` | Shared short-lane geometry stays identical. |
| Lane navigation rules | `audit_lane_navigation` | Geometric contract and walkability both hold. |
| Venue tags and coordinates | `audit_lane_scenarios` | Marks derive from measurement alone. |
| Venue menu descriptions | `audit_ui_layout` | Summaries derive from venue config and tactics. |
| Seam, enclave, and orientation | `audit_ground_seam` | No consumer keeps a second combination table. |
| Overlap gaps and footprints | `audit_ground_qc` | Judgments use true footprints without overlap. |
| Carpet color, pattern, buffer carpet | `audit_ground_tile` | Variant ordering and spill behavior stay stable. |
| Land adoption of terrain triangles | `audit_ground_tile` | Planning layer stays unchanged by adoption. |
| Field bunds and alignment | `audit_ground_qc` | Neighboring bunds truly join with consistent winding. |
| Pasture seasons | `audit_ground_tile` | Seasons differ by more than base color. |
| Drape lift | `audit_ground_drape` | Flat ground stays flat by design. |
| Border puzzle and dry band | `audit_ground_border` | Presentation-planned dry mask stays the sole authority exception. |
| Minimap view range | `audit_minimap_view` | Display range behavior stays stable. |
| View lock | `audit_view_lock` | Lock behavior stays consistent across layouts. |
| Spectator camera | `audit_spectator_cam` | Spectator behavior stays consistent across layouts. |
| Blood splats | `audit_blood_splat` | Hit feedback behavior stays stable. |
| Blind flash and charged jump | `audit_cc_flash` | Flash and jump behavior stays stable. |
| Control modes and battle menu | `audit_ctrl_mode` | Owner-selected control behavior stays stable. |
| Tips, key styles, room tabs, icons | `audit_ui_layout` | Button and overlay rules stay consistent. |
| Mobile look, move, commands, styles | `audit_touch_layout` | Touch targets stay separated, sized, and reachable. |
| Tap detection | `audit_touch_gesture` | Taps separate cleanly from holds and drags. |
| Viewport settle behavior | `audit_ctrl_mode` | Single wait time with no bypassing consumers. |
| Frame-rate independent damping | `audit_damp_fps` | Bot turn exception stays stepwise while presentation damps. |
| Landscape shop and orientation | `audit_touch_layout` | Grip variants and orientation behavior stay stable. |
| Menu layout and button text | `audit_ui_layout` | Button and stacking rules stay stable. |
| Gyroscope | `audit_gyro` | Sensor paths agree with declared defaults. |
| FPV cockpit | `audit_cockpit` | Framing, clearance, and band limits hold. |
| Hero modeling from forge parts | `audit_muzzle`, `audit_cockpit` | Muzzle, cockpit, outline, and roster behavior stay consistent. |
| Morph transition | `audit_morph_rig` | Part correspondence and tree swap stay continuous. |
| Gait curves and combat posture | `audit_gait_anat` | Muzzle and cockpit behavior follows skeletal pose. |
| Skeleton, joints, weapon mounts | `audit_cast_jump` | Rig coverage stays complete across heroes and NPCs. |
| Game modes and solo packaging | `audit_net_modes` | Mode behavior stays consistent across transports. |
| Road network relay | `audit_osm_relay` | Payload stays sanitized, monotone, and ordered. |
| Multi-path LAN | `audit_net_modes` | All paths stay playable together. |
| Side swap on room creation | `audit_net_modes` | Single implementation with exactly two call sites. |
| Developer tool gating | `audit_net_modes` | No hard-coded ports and kind-based routing holds. |
| Image selection and filtering | `audit_split_targets` | Reading seam stays unchanged by collection work. |
| Collection loop and file lifecycle | `audit_auto_intake` | Tool liveness and button state derive correctly. |
| Archive, verdict vocabulary, redo order | `audit_auto_intake` | Archive rows stay printable and reversible. |
| Automatic intake and rollback loop | `audit_auto_intake` | Reviews keep zero missing, orphan, and unlisted parts. |
| Flag cloth waveform | `audit_soft_stroke` | Cloth motion stays off geometry and randomness. |
| Terrain moss and wet masks | `audit_cel_pipeline` | Mask edges change without moving color or seams. |
| Authoritative death dissolve | `audit_cel_pipeline` | Death dissolves while plain disappearance stays instant. |
| Source reading for audits | `audit_src` (`readSrc`/`grabMethod`) | Sole provider for reading source text and extracting blocks, with line-ending normalization. |

Assertion formulas and thresholds live in layer-4 audit script headers.
