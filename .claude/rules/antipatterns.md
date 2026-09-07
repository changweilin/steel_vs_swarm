# §3 Absolute Antipatterns (stable A-numbers for cross-file reference)

> Layer 2: full definitions. Principles and boundaries live in root `AGENTS.md`; assertion details live in audit script headers (layer 4). A-numbers are stable identifiers cited by code and audit headers — gaps are dropped entries, never renumber.

| ID | Boundary | Guards |
|---|---|---|
| A1 | Client MUST NOT mutate authoritative state; anti-cheat logic MUST NOT move client-side. | — |
| A2 | MUST NOT add npm dependencies, build tools, TypeScript, or frameworks; single websocket dependency only. | — |
| A4 | Deterministic scatter paths MUST NOT use `Math.random()`. | — |
| A5 | Heavy-weapon cooldown has exactly one implementation (`mag:1 + reload=cd`); MUST NOT invent a second scheme. | — |
| A6 | Fire raycast MUST target units only; terrain uses analytic rays, buildings use analytic cylinder/box tests. MUST NOT add terrain, vegetation, or building meshes as raycast targets; fire MUST NOT cross blocking obstacles. | — |
| A6b | Solid faces separating spaces MUST block fire in both directions except transparent passables; a fire-blocking face MUST also be standable. Gating MUST use segment tests, MUST NOT gate on height-at-point; vertical tests MUST use crossing-intervals against bands. | `audit_layer_block` |
| A7 | Fly-straight-on-lost-lock applies to laser-guided and tower SAM only, judged identically on both ends; fire-and-forget MUST NOT use it. Chase caps are chase envelopes, MUST NOT serve as range. | `audit_weapon_gate` |
| A9 | Client/server ammo micro-drift is by design (misses unreported); MUST NOT be "fixed". | — |
| A10 | Fog is server snapshot filtering; the client MUST NOT apply a second masking pass. | — |
| A11 | Blast intentionally ignores LOS (diffraction approximation) and range (range limits only the spread center). MUST NOT add range gates inside blast. Aiming halo governs aimability only, never splash. | — |
| A12 | Drone respawn cross-tick guard MUST NOT be removed. | — |
| A13 | Neutral entities MUST be skipped in target acquisition and the tick main loop. | — |
| A14 | Cel dark sides MUST keep a brightness floor; hue shifts MUST be luminance-neutral. The floor value lives in exactly one table; every other path MUST derive it, MUST NOT hand-write it. Materials MUST use the single cel-material entry points; one scene MUST have exactly one active quantization school fixed at module load. | `audit_cel_pipeline`, `audit_visual_prefs` |
| A15 | Helicopter creeps intentionally have no tower-SAM wiring; MUST NOT be "completed". | — |
| A18 | Penetration is horizontal offset plus vertical band; MUST NOT be "corrected" to 3D (the server holds no terrain elevation). Band height MUST convert into the target's own vertical frame; radius adds both radii; distance uses the closest point on the segment; pierce aim MUST NOT stop at the first unit. | `audit_lance_hit` |
| A21 | Help-text device branches live in exactly one help module; MUST NOT branch device strings in the main module. | — |
| A22 | Ability-gesture dispatch lives in exactly one function; MUST NOT branch aiming at input sites; MUST NOT restore per-type dispatch tables. | — |
| A25 | Disposable 3D objects MUST release GPU resources on removal; projectiles and effects use pooled paths with one disposal implementation; shared geometry MUST register centrally. | `audit_gpu_lifecycle` |
| A26 | Procedural part orientation and rotation MUST agree through one anchor rule; MUST NOT fake stacking with interleaved offsets; grounded parts sit at self-radius height. | `audit_object_joints` |
| A27 | Instance yaw and micro-tilt MUST apply as one rigid whole-plant transform; MUST NOT fold into per-part angles. | — |
| A28 | Simulation, room, and bot modules MUST NOT import Node builtins nor use process/Buffer/require; URL layout MUST mirror repo layout; solo exit MUST shut the hub down. | `audit_net_modes`, `audit_solo_boot` |
| A29 | Underpasses MUST reuse the mountain-tunnel system with only named flags differing; approach cuts are vertical with no walkable side slopes; coverage MUST converge on the extended baseline, else fall back to open cutting — MUST NOT hide gaps by editing terrain. | `audit_underpass`, `audit_open_tunnel` |
| A30 | Obstacle collision, ballistics, and server LOS MUST share one cross-section: buildings and landmarks are oriented boxes, circles are broad-phase only as circumscribed half-diagonals. Upload MUST negate the mirrored angle; local-axis decode uses the matching sign convention. | `audit_climb` |
| A31 | Climb routes live in exactly one module; facility fronts MUST face structures through one seam; pole-top MUST equal structure-top; probabilities share one slope curve; climb axes stay outside colliders. | `audit_climb` |
| A32 | Bots MUST NOT see or move beyond human limits: enemy choice passes the forward vision cone; heading writes through one stepper only; alert bearings come only from the server damage log; positions move only through the shared collision resolver with sweep and push-out. | `audit_bot_vision` |
| A33 | Bot tactics keep one account with flag-only layering; difficulty MUST NOT be compared as strings; retreat needs all gates; role classes MUST derive, MUST NOT hand-list roles, with multipliers normalized under the tactic flag. | `audit_bot_tactics`, `audit_bot_role` |
| A34 | Buildings take no multipliers (building-vs capped at one; no grenade building multiplier). Shield/armor split lives in exactly one function with all consumers routed through it; overflow folds back by budget. | `audit_shield_counter` |
| A35 | One blast MUST NOT catch two tower slots of one site (bound derived from blast geometry); exemptions use only the frozen roster; clamp and refill settle in the same derivation pass. | `audit_aoe_trim` |
| A36 | Rate, damage, and magazine settle in one compression pass with a strictly increasing curve; burst make-up is presentation only — MUST NOT send network messages, spawn bullets, or touch ammo. | `audit_fire_rate` |
| A37 | World text uses one atlas and one mesh; naming uses one picker with local primary names; sign sizes derive from aspect; signs MUST NOT enter blockers, collision, or LOS. | `audit_world_text`, `audit_vernacular` |
| A38 | Site rules are pure geometry taking only a caller probe callback with no terrain/collider/engine knowledge; block layout consumes zero shared randomness; setbacks, spacing, crowns, and headings derive; volumed parts register oriented boxes. | `audit_siteplan` |
| A39 | Softness is one flag driving both stroke weight and sway, classified from existing part keys; fine strokes pass only through the scene-alpha contract; sway is vertex displacement only with zero server movement; wind and clock are each singletons. | `audit_soft_stroke` |
| A40 | Character and body file schemas live in exactly one module with identical generated key sets and order; body prototypes are structured layers derived from visuals; outbound texts assemble in exactly one place; content modules keep zero imports. | `audit_codex` |
| A41 | Homing MUST use the firing-moment reticle solution, MUST NOT read stale lock ids; no solution means unguided straight flight. | `audit_weapon_gate` |
| A42 | Latlong projection lives in exactly one function with rotation as part of it; all other converters delegate. The mirrored consumer stays a thin shell and MUST NOT rotate again; rotation freezes before battle configuration finalizes; sampling frames compute unrotated. | `audit_road_grid` |
| A43 | Relay payload shape and limits live in exactly one module shared idempotently by both ends; the module keeps zero imports and zero mutable state; the server accepts the host only, stores fresh objects, stays monotone per cell, MUST NOT touch battle configuration, and MUST NOT ride on sync traffic. | `audit_osm_relay` |
| A44 | Edge-wall catalog, split rule, and buffer/background placement live in exactly one module with zero 3D imports; reselection hashes coordinates into a private generator with zero shared randomness; parts fit inside the staged box with per-segment measured collision height; inner faces cover to body sight height; slope is a hard gate from caller-injected thresholds; buffer and background are presentation-only; gates stay shut. | `audit_world_edge` |
| A45 | Evadability lives in exactly one function with all consumers routed through it using fan/line exclusion; blast dice continue per target, MUST NOT return the whole shot; self-damage never rolls; tower main guns stay single-shot with no damage definition; compensation covers only newly-evaded blast hits at each target's own odds. | `audit_weapon_gate` |
| A46 | Mass-building collision registers per-segment oriented boxes with each segment taking its maximum half-span; profiles are pure data decoupled from library loading; per-instance scale derives from measured extents; signs and glazing mount only on flat vertical walls; flattening precedes flatness qualification under one shared spec. | `audit_siteplan` |
| A47 | Compact-map scale derives from lane-chain needs; MUST NOT hand-write ratios; omitted parameters reproduce standard battlefields bit-identically; lanes use the dedicated baked route; external buffer depth has one accessor; handset gating stays client-side. | `audit_mini_map`, `audit_world_edge` |
| A48 | Story campaigns flag only the defending side with lanes, towers, scale, and siege lock derived from it; tower-adjacent consumers use one accessor; boss identity follows the defending side; stage and siege accounting live in one place; map size MUST NOT vary with headcount; siege floors and dialogue countdown stay server-driven. | `audit_story_map`, `audit_story_talk` |

Assertion details live in layer-4 audit script headers.
