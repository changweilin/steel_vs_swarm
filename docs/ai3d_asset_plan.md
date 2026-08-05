# AI 3D Asset Pipeline — Execution Plan (settled 2026-08-04)

> **Operational state and next steps live in [`ai3d_runbook.md`](ai3d_runbook.md)** (agent-readable
> runbook: status ledger, environment matrix, execution queue, trial log). This file holds the
> settled decisions; the runbook holds what to run next.

> Goal: raise detail density of **dynamic units (mechs / building-unit NPCs)** and **static props
> (buildings, giant trees, megaliths, landmarks)** one tier, without touching the rig contract,
> determinism, or A2 (zero npm deps).
> Hardware anchor: **RTX 3060 12GB** (measured 12288 MiB). Every tool choice below is gated on that line.

---

## 0. Decisions

| Item | Decision | Reason |
|---|---|---|
| Output form | **Part-library GLB + existing assembly code** | Assembly / paint / gait / jitter stay in current code ⇒ per-instance variation, determinism, `partJitter` unchanged; zero contact with the rig contract |
| Skill placement | New `mech-part-forge` (dynamic), `photo-to-prop-forge` (static) | Existing `ai-mesh-generation` / `ai-pbr-texturing` / `ai-rigging-motion` are generic external-pipeline knowledge — leave them alone. New skills carry only this repo's slot contract and acceptance gates |
| Geometry (image→3D) | **TRELLIS.2-4B** primary / **Hunyuan3D 2.1 shape-only** backup | See §1. Hunyuan's paint stage (21GB) is **never run** — this project does not want PBR |
| Bulk small static parts | **Stable Fast 3D (SF3D)** | 6GB, <1s, built-in delight + UV unwrap ⇒ cheapest way to sweep a tree's ~15 parts |
| Part splitting | **P3-SAM** (+ X-Part if needed) | Split a whole-unit generation into rig slots; preserves "same machine" silhouette better than per-part generation |
| Decimate / clean / export | **Blender headless (bpy)** + AutoRemesher (MIT) | Offline, no npm, scriptable; `blender-mcp-agent` skill covers MCP hardening |
| Auto-rigging (UniRig et al.) | **Deliberately not used** | This rig is not a skinned skeleton, it is a **named part hierarchy** (`rig.legL` / `rig.chest` / `rig.muzzles`…) driven per-frame by `locomotion.js`. Injecting a skinned skeleton scraps `MOVE_SIG` / `CAST_SIG` and three audits at once |
| 2D drafts | **`agy` Nano Banana Pro** (mechs) / **local FLUX.1 Kontext dev GGUF** (everything else) | See §5.0. Existing `public/assets/cyberpunk_art/mechs/*.png` are usable silhouette masters; the 2D tool only splits them into per-slot views |
| Photo sourcing (static) | **Openverse API** (no key) + Wikimedia Commons API, **CC0/PD only** | See §4.1. The licence filter is a hard gate, not a recommendation |

---

## 1. Environment and VRAM budget (the 12GB line)

Measured: `NVIDIA GeForce RTX 3060, 12288 MiB` / `Python 3.13.1` / `gemini` on PATH.

**Python 3.13 cannot run this model stack** (TRELLIS / Hunyuan3D ecosystems are pinned to 3.10–3.11)
⇒ use a separate env. It **must not enter `package.json` or any build step** (A2): the pipeline lives in
`tools/ai3d/` with its own `.venv` and is run manually, offline.

| Tool | Use | VRAM (official / reported) | Viable at 12GB |
|---|---|---|---|
| TRELLIS.2-4B | image→high-fidelity geometry (MIT) | README says **24GB** (A100/H100); community/ComfyUI builds report **8GB@256 / 12GB@512** | ⚠ **must measure first**: run 256, then push to 512. If it fails, drop to Hunyuan |
| Hunyuan3D 2.1 (shape only) | image→geometry | shape **10GB** / paint 21GB / full 29GB | ✅ shape-only fits; **paint never runs** |
| Hunyuan3D-2GP | low-spec build (CPU offload) | below the above | ✅ fuse |
| Stable Fast 3D | fast small parts, delight + UV included | **6GB** | ✅ loosest; primary for static parts |
| P3-SAM / X-Part | 3D part segmentation / part generation | unpublished, **to be measured** | ⚠ use P3-SAM (segmentation) only for now |
| Blender headless | decimate / merge / export GLB | CPU | ✅ |

**Fallback chain (principle 6)**: `TRELLIS.2@512 → TRELLIS.2@256 → Hunyuan3D 2.1 shape-only → SF3D → keep current procedural parts`.
Drop a tier whenever one fails. **Never change a rule or a contract to make a tool fit.**

---

## 2. Boundary: a part library, not whole-unit GLBs

`MODEL_MANIFEST` already supports whole-unit GLBs (`base:SWARM` is one), but the mech column is all
`null` on purpose:

- `locomotion.js` writes **named nodes** every frame: `rig.hips` / `rig.legChainL` / `rig.tailSegs` /
  `rig.gunR`. A single-mesh GLB has none of them ⇒ adopting one means rewriting the whole animation layer.
- `paint.js` liveries, `toon.js` ramps and the `uPaintFace` orientation gate all hang off **per-part materials**.
- Static side is even clearer: the value of `VEG_DEFS` / `MEGALITHS` / `KIND_PARTS` **is** per-instance
  variation (`partJitter`, seed, `stretch`). Bake a whole tree and every tree in the forest is identical.

So AI produces **part shapes only**; everything else is untouched:

```
AI output      →  part-library GLB (one named node per part; geometry + one base colour)
existing code  →  which part, where, what rotation, how much jitter, what colour, how it moves
```

### 2.1 New single seam: `public/js/partlib.js`

```js
// libGeo(name)      → BufferGeometry | null   (null ⇒ caller falls back to its procedural primitive)
// loadPartLib(url)  → load once, markShared() (A25), pure lookup afterwards
```

Three consumers change one line each — **nothing else**:

| Consumer | Today | Change |
|---|---|---|
| `beacons.js _geo(p.g)` | `['cyl', 0.42, 0.52, 13, 4]` | also accept `['lib', 'pylon/foot_a', <original descriptor>]`; miss ⇒ original |
| `biomes.js` `VEG_DEFS` / `MEGALITHS` | `g:` is a THREE geometry | `g: libGeo('tree/canopy_c') ?? ico(2.7)` — **the `??` half is the fuse; MUST stay** |
| `models.js` part construction | per-part `new THREE.BoxGeometry(...)` | same; geometry source only. `position` / `rotation` / hardpoints / `rig.*` registration unchanged |

**Hard invariants (acceptance conditions, not advice):**

1. **Fuse**: part-library load failure ⇒ today's frame, bit-for-bit (same degradation semantics as `MODEL_MANIFEST`).
2. **Measured extents**: collider / `foot` / `col.r` always from `Box3.setFromObject` **after** the swap.
   MUST NOT reuse nominal values (A30 / `audit_beacons.mjs` I).
3. **Zero extra randomness**: swapping geometry MUST NOT consume an extra `rnd()`, or the whole map's
   vegetation/building layout sequence shifts (CLAUDE.md §2.3).
4. **Shared geometry**: library geometry is always `markShared()`; `disposeTree` must skip it (A25).
5. **Geometry + base colour only**: no normal/metal/roughness maps in the repo (CLAUDE.md §1).
6. **Triangle budget derived by measurement**: measure today's per-unit / per-tree triangle count first;
   the new budget is that value × a justified factor. **MUST NOT hand-write a nice-sounding number.**

---

## 3. Track A — dynamic (mechs / building-unit NPCs)

### 3.1 Slot contract (the spec for this whole pipeline)

Slots are already defined per chassis kind; AI parts must map onto them **by name**:

| Kind | Slots (excerpt; `models.js` source is authoritative) |
|---|---|
| `aerial` (drone) | `tilt` / body / `wpn.light.g` · `wpn.heavy.g` / `muzzles.light.n` · `muzzles.heavy.n` |
| `biped` / `quad` (mech) | `hips` `chest` `neck` `head` `legL/R` `armL/R` `legChainL/R` `armChainL/R` `tailSegs` `gunR/gunL` |
| `morph` (transformer) | `torso` `head` `legL/R` `armL/R` `kneeL/R` `ankleL/R` `elbowL/R` `wristL/R` `vents` `thrusters` `rotors` `flapWings` |

**Three MUSTs:**
- Muzzle nodes (`muzzles.*.n`) and `rig.wpn` local position/orientation must not move — forward-facing
  muzzles rely on a build-time world-alignment inverse. `audit_muzzle.mjs` must stay green after a re-skin.
- Whole-unit bbox drift **≤ ±5%**, or `fitToHeight` rescales the unit and `dimTop/dimH/dimR`
  (health bar, enemy marker, glow) all skew.
- Hydraulic-style **single-end anchored, angled** parts must not become two-end joint-spanning parts
  (the gait will stretch them apart).

### 3.2 Flow

```
concept master  cyberpunk_art/mechs/{id}_static.png   ← exists; 3/4 view, single object, flat background
   │
   ├─(A) whole-unit: master →[matte]→ TRELLIS.2 → whole mesh → P3-SAM split → map to slots
   └─(B) per-slot:   master → 2D /edit "keep only the left leg, redraw, centred, opaque" → per-slot image → image→3D
                                                                            ↓
                                Blender headless: decimate → align origin to slot pivot → align orientation
                                                → merge by colour → export part-library GLB
                                                                            ↓
                                                 partlib.js lookup → existing makeUnit assembly (no changes)
```

**(B) is the main line**: the slot mapping is guaranteed by the prompt, so nothing has to guess whether
P3-SAM's 7th chunk is the left shin.
**(A) is cross-validation**: whole-unit generation holds silhouette consistency better; use it to check
that (B)'s parts still read as one machine.

⚠ **Known master defect**: wings in images like `s01_static.png` are **translucent and emissive** —
image→3D handles transparency/glass/glow badly. Per-slot redraws MUST specify fully opaque, no glow,
no motion blur (negative terms in §5.2).

### 3.3 Acceptance gates (all required)

| Gate | Command | Criterion |
|---|---|---|
| Hardpoints | `node tools/audit_muzzle.mjs` | green (32 heroes + 4 factions of NPCs) |
| Cockpit framing | `node tools/audit_cockpit.mjs` | green |
| Cast / jump pose | `node tools/audit_cast_jump.mjs` | green (only defence against post-pass channel leaks) |
| GPU lifecycle | `node tools/audit_gpu_lifecycle.mjs` | green (library geometry `markShared`) |
| Visual loop | `node tools/shot_units.mjs` | before/after renders, human review |
| No regression | `npm test` / `npm run bal` | presentation-layer only ⇒ **MUST be bit-identical** |

---

## 4. Track B — static (buildings / giant trees / megaliths / landmarks)

### 4.1 Photo sourcing = Openverse API, with a hard licence gate

- **Openverse API** (`api.openverse.org`): no key, 800M+ items, `license=cc0` filter, covers Flickr /
  Wikimedia / museums.
- **Wikimedia Commons API**: fills the landmark category (licence, author, size per item).
- **Hard gate: CC0 and public domain only.** Not even CC-BY — a rock baked into the repo has nowhere to
  carry attribution, and a licence violation produces no error message.
- Every download records `{source_url, license, creator, retrieved_at}` in `tools/ai3d/photo_manifest.json`.

### 4.2 Output is a part vocabulary, not finished props

| Family | Parts today | What AI should produce |
|---|---|---|
| Trees / vegetation `VEG_DEFS` | `cyl` trunk + `ico`/`cone` canopy | 3–5 canopy modules, 2–3 branch forks, buttress roots |
| Megaliths `MEGALITHS` | `Box`/`Sphere` + hand-written grooves | rock facets, collapse blocks, talus cones |
| Landmarks `KIND_PARTS` | `['cyl'\|'box'\|'cone'\|'ico']` pure data | lattice nodes, microwave dishes, water-tank drums, containers |
| Buildings `hazards.js BUILDERS` | extruded boxes | window modules, roof caps, balconies/canopies, external piping |

**Modules, not whole props**: a baked building makes every building on the street identical; modules +
existing seeded selection + `partJitter` raise detail while keeping variation.
`beacons.js`'s front half **MUST stay THREE-free** (the only reason it is offline-verifiable) ⇒ part
descriptors stay pure data, `['lib', name, <fallback>]`.

### 4.3 Acceptance gates

| Gate | Command | Criterion |
|---|---|---|
| Joint integrity | `node tools/audit_object_joints.mjs --seeds 8` | zero FLOAT/PARTIAL/DETACHED/ISOLATED |
| Landmark extent / collider | `node tools/audit_beacons.mjs` (+ `--break-extent` reverse check) | nominal `foot` matches measured extent both ways |
| Traversability | `node tools/audit_traverse.mjs` | new parts do not block routes |
| Cel pipeline | `node tools/audit_cel_pipeline.mjs` | ramp family / outlines unchanged |
| Visual knobs | `node tools/audit_visual_prefs.mjs` | part-jitter invariants |
| GPU | `node tools/audit_gpu_lifecycle.mjs` | shared geometry registered |
| No regression | `npm test` / `npm run bal` | **MUST be bit-identical** |

---

## 5. 2D drafts and prompt spec

### 5.0 Tool split (user decision, 2026-08-04)

**On 2026-06-18 Gemini CLI dropped consumer tiers** (free / AI Pro / AI Ultra), replaced by **Antigravity
CLI (`agy`)**; only enterprise and **paid** API keys still drive `gemini`. Local check: `gemini 0.33.2`
and `agy 1.0.2` both present, `~/.gemini/antigravity*` exists ⇒ the migration already happened. Routes,
ordered by bulk feasibility:

| # | Route | Auth / cost | Use |
|---|---|---|---|
| **A** | **`agy` built-in Nano Banana Pro** | Antigravity OAuth = subscription quota, no API key | **Mech 2D** (32 hero masters + per-slot splits). Splitting is an instruction-following task, so a lower quality tier costs several retries. `agy --print "…"` is non-interactive ⇒ scriptable |
| **B** | **Local FLUX.1 Kontext [dev] GGUF** (ComfyUI, 3060) | open weights, offline, **zero quota / zero cost** | **All other 2D**: building-unit NPCs, Openverse photo normalisation (de-occlude, de-shadow, straighten) — high volume, quality-tolerant. GGUF quantisation exists for ≤12GB |
| **C** | Gemini CLI + `nanobanana` extension | **API key required**; OAuth/subscription quota does not apply | only if a paid Gemini API key is already on hand (details §5.1) |

⚠ **Quota is the only risk in this split**: Antigravity image quota tightened in 2026-02; Pro subscribers
report 2–5 images per call at peak. The two volume rules in §5.0.2 are a **feasibility precondition, not an optimisation**.

#### 5.0.1 Drawing order (user decision)

**Mechs (12) → drones (12) → transformers (8, dual-form)**

| # | Kind | Count | Character ids | Missing masters | Why here |
|---|---|---|---|---|---|
| 1 | `robot` | 12 | s06 s07 s09 t01 t02 t03 t04 t05 t10 t12 m02 m06 | **4** (t10 t12 m02 m06) | Most typical slots (`biped`/`quad` have full limb chains); split rules settled here transfer to the rest |
| 2 | `drone` | 12 | s01 s02 s03 s04 s05 s08 s11 t07 t08 t09 m03 m04 | **0** | Fewest slots (body/nose/wings/two weapon pods) + masters complete ⇒ lowest unit cost |
| 3 | `morph` | 8 | s10 s12 t06 t11 m01 m05 m07 m08 | **7 units × 2 forms = 14 images** | Hardest; see below |

**Why transformers last, and the only correct method**:
`models.js makePoser(parts)` interpolates between `p.a` (ground pose) and `p.b` (flight pose) using
**the same `p.g`** — both forms share one part set; only the pose differs. Hence three MUSTs:

1. **MUST NOT generate a separate part set per form** — that turns "transform" into "swap model" and
   breaks `makePoser`'s staggered time-window sequence (Macross-style multi-stage transform).
2. Split images are drawn **from the ground form** (joint pivots are most legible there).
3. Flight-form masters are for **acceptance**: each part must read correctly in both forms. A shin that
   only looks right on the ground fails once it folds into the fuselage as an engine nacelle — the other
   two kinds have no such check.

⇒ Transformer masters are drawn as **ground + flight pairs, in the same conversation**, for silhouette consistency.

#### 5.0.2 Two volume rules (quota precondition)

1. **Mirror-symmetric parts are generated once; mirroring happens in Blender.** Applies to `legL/R`,
   `armL/R`, `chFL/FR`, symmetric pods ⇒ cuts unique slot count by ~40%.
2. **Retry only slots that split badly**, not a blanket 3×. Fixed criteria: single subject / flat
   background / no transparency or glow residue — all three pass ⇒ done.

Estimate (unique slots, selective retries):

| Kind | Unique slots/unit | Units | Split images | Master redraws |
|---|---|---|---|---|
| Mech | ~9 | 12 | ~108 | 4 |
| Drone | ~6 | 12 | ~72 | 0 |
| Transformer | ~10 | 8 | ~80 | 14 |
| **Total** | | **32** | **~260** | **18** |

≈ **280 images** (not the 960 implied by a blanket 3× retry). Three batches per the order above; each
completed batch is a deliverable milestone.

### 5.1 Route C auth details (archived)

The `nanobanana` extension starts its own MCP server and calls the Gemini API directly ⇒ Gemini CLI login
state is irrelevant. Env var precedence (first non-empty wins):

```
NANOBANANA_GEMINI_API_KEY → NANOBANANA_GOOGLE_API_KEY → GEMINI_API_KEY → GOOGLE_API_KEY
```

None set ⇒ `ERROR: No valid API key found…`.
(The README says `NANOBANANA_API_KEY`, which disagrees with the source — the list above is authoritative.)

Model choice is a cost decision: `gemini-2.5-flash-image` has a free tier (~500/day reported; check AI
Studio for current limits), $0.039/image; `gemini-3.1-flash-image-preview` (extension default) has no
free tier, $0.067; `gemini-3-pro-image-preview` has **0 RPM / 0 RPD free**, $0.134.
At 960 images: flash free tier spread over 2–3 days = $0, pro ≈ $129 ⇒ **on route C, always flash**.

### 5.2 Prompt spec for image→3D inputs (nine rules)

Image→3D models do not want a pretty illustration; they want an image that **states the shape and removes
interference**. All nine go into every prompt.

| # | Rule | Wording | Why |
|---|---|---|---|
| 1 | Single object | `exactly one object, isolated, complete, nothing else in frame` | multiple objects ⇒ geometry fuses |
| 2 | Uncropped | `full object visible, ~85% of frame, even margin on all sides` | cropped edges get invented |
| 3 | Near-orthographic | `three-quarter view, ~35° yaw / ~20° elevation, long-lens (100mm) flattened perspective` | true ortho is out of training distribution; long lens is the in-distribution compromise |
| 4 | Flat light | `flat even ambient lighting, no cast shadow, no rim light, no blown highlights` | baked highlights/shadows survive delighting |
| 5 | Flat background | `flat single-colour neutral background (#808080), no gradient, no vignette, no ground plane` | clean matting is the single largest quality factor |
| 6 | Fully opaque | `fully opaque materials, no glass, no transparency, no glow, no emissive` | transparency is the #1 failure mode (see the wing defect above) |
| 7 | Surface cues | `crisp panel lines, bolts, greebles; matte surface` | panel lines convey volume, but keep it matte |
| 8 | No text | `no text, no logos, no arrows, no dimensions, no watermark, no turntable sheet` | text becomes geometric noise |
| 9 | Size | `1024×1024 or larger, square` | short side ≥1024; 2048 for refine mode |

**Per-slot `/edit` template** (`{REF}` = existing concept master):

```
Using {REF} as the design reference, redraw ONLY the "{SLOT}" (e.g. left leg assembly: thigh + shin + foot).
Output: exactly one object, complete and uncropped, centred, filling ~85% of the frame;
three-quarter view, ~35° yaw and ~20° elevation, long-lens (100mm) flattened perspective;
flat even ambient light, no cast shadow, no rim light, no blown highlights;
flat #808080 background, no gradient, no ground plane;
fully opaque materials — no glass, no transparency, no glow, no emissive;
keep the original panel lines and bolt detail, matte surface;
no text, no labels, no arrows, no watermark, no multi-view sheet;
1024×1024.
```

### 5.3 Required pre-processing before image→3D

1. **Matte to alpha** (`rembg` / BiRefNet) — the flat background exists to make this step clean.
2. Check the alpha edge for leftover black outline strokes (concept art has thick outlines; they read as
   a groove around the part).
3. Do not submit anything with a short side < 1024.

---

## 6. Phases and exit conditions

| Phase | Content | Exit condition |
|---|---|---|
| **P0 env** (½ day) | `tools/ai3d/` + Python 3.11 venv; install SF3D → Hunyuan3D 2.1 → TRELLIS.2; **measure each against 12GB and record** | one test GLB per tool; measured VRAM and seconds written down |
| **P1 seam** (½ day) | `public/js/partlib.js` + one-line parse change in each of the three consumers; **no AI parts yet** | every audit bit-identical (the point of this step is proving the fuse works) |
| **P2 static pilot** (1–2 d) | one landmark (`pylon` or `watertower`) end-to-end: Openverse → SF3D → Blender → part library | `audit_beacons.mjs` + `audit_object_joints.mjs` + `--break-extent` reverse check |
| **P3 dynamic pilot** (2–3 d) | one mech (`biped`, most typical slots) end-to-end: `agy` split → TRELLIS/Hunyuan → slot alignment | three rig audits green + bbox drift ≤±5% + `shot_units.mjs` before/after |
| **P4a mechs ×12** | draw the 4 missing masters (t10 t12 m02 m06), then split per unit; symmetric parts once | each unit passes the three rig audits; 12 done = first deliverable milestone |
| **P4b drones ×12** | masters complete ⇒ split directly; fewest slots, lowest unit cost | same |
| **P4c transformers ×8** | draw 7 × ground/flight master pairs; **one part set only**, split from ground form, accept against flight form | same **+ `shot_units.mjs` in both forms** (`makePoser` time-window sequence must not drift) |

**Batches of ≤5 assets; run the full gate set per batch.** Each milestone additionally needs a 30s
steady-state frame-time comparison (desktop + touch emulation).

**P2 before P3**: static has no rig contract, so failure costs "this rock looks bad". Dynamic failure hits
gait, hardpoints and hit volumes simultaneously.

---

## 7. Risks and unverified items

| Risk | Symptom | Mitigation |
|---|---|---|
| TRELLIS.2 won't fit in 12GB | OOM, or only 256 runs and detail is worse than current procedural parts | verify in P0; fall back to Hunyuan3D 2.1 shape-only (10GB, safe) |
| P3-SAM splits don't map to slots | left shin split in two, foot merged into shin | main line is per-slot generation (§3.2 B); P3-SAM is cross-validation only |
| Triangle count blowout | mobile frame time drops, outline pass gets heavier | budget derived from **measured current values**; frame-time comparison per batch |
| Binary payload growth | repo size, slower solo packaging | split library per family, load on demand; confirm `npm run build:solo` copies it |
| Licence contamination | CC-BY image in repo without attribution | hard-code `license=cc0` in queries; keep `photo_manifest.json` |
| Outline stroke read as geometry | mysterious groove around the part surface | inspect alpha edge after matting; add `no outline stroke` to the prompt if needed |
| Translucent wings | foggy blob geometry | prompt rule 6; never submit existing concept art unmodified |

**Unverified (must be flagged on delivery)**: TRELLIS.2's real ceiling on this 12GB card; P3-SAM/X-Part
VRAM; how reliably the 2D tool obeys "keep only this part"; part-library load impact on first-frame time.

---

## 8. Appendix A (2026-08-05) — Static-prop generation: method split per object family

User proposal evaluated: "download a photo database first, fill gaps by search, then img→3D;
(1) an Opus agent writing three.js from images, (2) local open-source img→3D models, (3) anything better."
Verdict: **the proposal matches Track B §4 and is being executed** — but the three options are not
alternatives; they split **by geometry class**:

| Object family | Method | Why |
|---|---|---|
| Landmarks `KIND_PARTS`(pylon/watertower/container/cairn)| **LLM agent reads photos → writes pure-data part rows**(proposal 1, corrected form)| Part tables are already pure-data primitives; that is the only reason `audit_beacons` Ⅰ can verify extents offline in the sandbox. Zero binary weight, zero licence exposure(photos are measurement reference only, never baked in), native fit with `stretch`/`partJitter`/colour seam. The agent's output is **part-table data rows, not three.js code**(A38 purity)|
| Building modules(windows/roof caps/balconies/piping)`BUILDERS` | Same as above | Boxy, regular; primitives suffice; oriented-box colliders stay derivable(A30)|
| Civic parts `CIVIC_PARTS` | Same as above | Same |
| Megaliths(rock facets/collapse blocks/talus cones)`MEGALITHS` | **img→3D model → partlib GLB**(proposal 2)| Organic, irregular — primitives cannot express them; this is the only family class worth the GLB payload + offline-extent contract. SF3D for bulk, TRELLIS.2/Hunyuan for signature pieces(§1 ladder unchanged)|
| Giant-tree parts(canopy modules/buttress roots/forks)`GIANT_DEFS` | **img→3D model → partlib GLB** | Same; **blocked on the `giantCrownR` issue below — do not ship canopy GLBs before it is solved** |
| Small vegetation / generic building masses | **Keep procedural** — no AI | Not every family should eat AI: wholesale GLB swap explodes draw calls/triangle budget, and `procedural-object-detail` already covers variation there |
| Mechs / NPCs(Track A)| Unchanged(§3 per-slot 2D→3D)| Out of scope of this proposal |

**Proposal 3(better routes)found**: when no local GPU is available, the official
**`stabilityai/stable-fast-3d` HF Space**(gradio, 1206 likes)runs SF3D as a service; output still goes
through the same Blender normalisation + intake contract. Photos must still be CC0 regardless of where
inference runs.

**Execution-environment split**(measured 2026-08-05): the CI sandbox has no GPU(`nvidia-smi` absent)
and its proxy blocks `api.openverse.org` / `commons.wikimedia.org`(CONNECT 403 — ㋓)⇒ sandbox does
seams/tools/audits; the 3060 machine(or Actions)does photo download + inference; HF Space is the
no-GPU fallback.

**Two plan corrections found by implementation(P1 landed 2026-08-05)**:

1. **§2.1's biomes one-liner `g: libGeo(…) ?? ico(2.7)` cannot work as written**: `biomes.js` is a
   static import, so `VEG_DEFS` is constructed at module-load time — before any async GLB fetch can
   complete ⇒ `libGeo` would always miss and the library would silently never be used. The biomes seam
   MUST resolve at the **consumption loop**(build time; e.g. an optional `p.lib` field next to `p.g`,
   `p.g` remaining the fuse). Wire it in P2 together with the first real parts. Also `giantCrownR`
   reads `p.g.parameters`, which GLB `BufferGeometry` does not have — crown-radius derivation must scan
   vertices(or carry measured metadata)before any canopy GLB ships, or crown shyness silently
   diverges from the visible canopy.
2. **Offline-extent contract for lib descriptors**: `['lib', name, <fallback primitive>]`'s offline
   extent = the fallback's extent; the export tool MUST verify the GLB part fits inside the fallback's
   extent before intake(now encoded in `partExtent` and the `partlib.js` header). Runtime colliders
   still come from `beaconCollider` measurement — A30 holds on both sides.

**P1 status**: `public/js/partlib.js`(fuse + `markShared` + zero-randomness lookup)+ `beacons.js`
`['lib', …]` descriptor + `main.js warmModels` preload hook are in. `PART_LIBS` is empty ⇒ today's
frame bit-identical(`audit_beacons` 68 green; `--break-extent` reverse check red as required).
`models.js` deliberately untouched until P3. Photo sourcing tool: `tools/ai3d/fetch_photos.mjs`
(catalog + resumable gap-fill + CC0 double gate + manifest; runs on the 3060/Actions, not the sandbox).

## 9. Related skills

- `.claude/skills/mech-part-forge/` — Track A (dynamic mech/NPC parts)
- `.claude/skills/photo-to-prop-forge/` — Track B (photo → static prop parts)
- Generic external-pipeline knowledge (unchanged): `ai-mesh-generation` / `ai-pbr-texturing` /
  `ai-rigging-motion` / `blender-mcp-agent`
- Adjacent constraints: `procedural-object-detail` (variation and seeds), `cel-shading-pipeline`
  (base colour only), `headless-3d-inspection` (seeing your own output)
