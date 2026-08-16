---
name: mech-part-forge
description: Generate mech / building-unit NPC geometry with open-source AI 3D models as **parts** that drop into the existing named rig slots in models.js — never as a whole unit. Covers per-slot 2D splitting, the 12GB image→3D tool ladder and fallback chain, the part-library load seam, and the muzzle/cockpit/cast_jump audits that form the acceptance gate. Use when adding or upgrading mech/NPC geometry, converting concept art into game meshes, generating parts for an existing rig, or when a unit "needs more detail" but the gait and hardpoints must not move.
license: MIT
compatibility: Offline pipeline (Python 3.11 venv + Blender headless under tools/ai3d/, never in package.json); runtime adds only partlib.js — still vanilla ES modules + CDN three
---

# Mech Part Forge (AI geometry → existing rig slots)

> Read `docs/ai3d_runbook.md` first (plan and phase gates). Generic external-pipeline knowledge lives in
> `ai-mesh-generation` / `ai-rigging-motion`. This skill covers **only this repo's contract and what breaks silently**.
>
> **Route disambiguation**: this skill is the **AI-GLB-parts** route into shipped `models.js` units.
> For the humanoid-forge prototype (`tools/humanoid_forge/`) where parts are **hand-written procedural
> polyhedra traced from 2D art** and verified by screenshot loop, use `mecha-polyhedron-modeling` instead.

## 0. Core premise

The rig in `models.js` is **not a skinned skeleton**. It is a **named part hierarchy** — `rig.hips`,
`rig.legChainL`, `rig.tailSegs`, `rig.muzzles.light.n`, `rig.wpn.heavy` — whose position/rotation
`locomotion.js` writes every frame.

Two hard rules follow:

1. **The unit of AI output is a part, not a machine.** A single-mesh GLB has none of those nodes ⇒ the
   moment it is wired in, gait, `MOVE_SIG`, `CAST_SIG`, muzzle alignment and the FPV weapon source all
   fail at once — and on screen it just looks like "the mech stands still".
2. **No auto-rigging.** UniRig / SkinTokens solve "this mesh has no skeleton". That was never the problem
   here; attaching a skinned skeleton replaces the entire hierarchy above.

---

## 1. Slot contract (spec; `models.js` source is authoritative, this table is an index)

| Kind | `rig.kind` | Nodes that must exist with **unchanged position/orientation** |
|---|---|---|
| Drone | `aerial` | `tilt`, body, `wpn.light.g`/`wpn.heavy.g`, `muzzles.light.n`/`muzzles.heavy.n`, `lightGlow` |
| Mech (biped) | `biped` | `hips` `chest` `neck` `head` `legL/R` `armL/R` `legChainL/R` `armChainL/R` `tailSegs` `gunR` `gunL` `aimPose` |
| Mech (beast) | `quad` | `spine` `chest` `neck` `head` `tail` `tail2` `legFL/FR/HL/HR` `chFL/FR/HL/HR` `tents` `armSh/armEl` |
| Transformer | `morph` | `torso` `head` `legL/R` `armL/R` `kneeL/R` `ankleL/R` `elbowL/R` `wristL/R` `vents` `thrusters` `rotors` `flapWings` `midLegs/midKnees/midTarsi` |

**Four MUSTs**

- **Do not touch muzzles.** `muzzles.*.n` and `rig.wpn` local transforms are fixed. Forward-facing muzzles
  come from a build-time world-alignment inverse (`getWorldQuaternion().invert()`), not hand-tuned angles —
  change a parent's orientation and the inverse absorbs the error, with tracers leaving the side of the
  hull as the only symptom. Any hardpoint change ⇒ rerun `audit_muzzle.mjs`.
- **bbox drift ≤ ±5%.** Beyond that `fitToHeight` rescales the unit, skewing `ent.dimTop/dimH/dimR`
  (health bar, glow, enemy marker) — measured once at spawn, so it is invisible afterwards.
- **Hydraulic-style single-end-anchored angled parts** must not become two-end joint-spanning parts;
  the gait stretches them apart.
- **`heavy.pivot` must stay empty for morph handheld weapons** (it fights per-frame `gunPitch`).

---

## 2. Runtime seam: `public/js/partlib.js`

```js
export function loadPartLib(url)   // load once → markShared() (A25) → pure lookup afterwards
export function libGeo(name)       // miss ⇒ null
```

Consumers change only the geometry-resolution line:

```js
// any part in models.js
const geo = libGeo('m05/thigh_L') ?? new THREE.BoxGeometry(0.34, 1.2, 0.4);
//                                 ↑ this ?? is the fuse; MUST stay
```

**Fuse semantics** = the existing `MODEL_MANIFEST` degradation (principle 6): if the library fails to load,
the frame is **bit-identical to today**. Without it, one CDN hiccup deletes the whole mech.

**A25**: library geometry is always `markShared()`; `disposeTree` skips it by registry. The library itself
is not destroyed with a unit.

---

## 3. Production flow

```
concept master  public/assets/cyberpunk_art/mechs/{id}_static.png   ← exists
    │
    │  2D /edit, one slot at a time (§4)
    ▼
tools/ai3d/drafts/{id}/{slot}.png   →[rembg matte → alpha]
    │
    │  image→3D fallback chain: TRELLIS.2@512 → @256 → Hunyuan3D 2.1 shape-only → SF3D
    ▼
raw mesh  →  Blender headless: decimate → move origin to slot pivot → align orientation → merge by colour → export
    ▼
public/assets/models/parts/{id}.glb   →  partlib lookup  →  existing makeUnit assembly (unchanged)
```

**Why per-slot generation instead of "generate the whole unit, then split with P3-SAM"**: nothing
guarantees the 7th chunk is the left shin, and the only symptom of a wrong mapping is a slightly odd gait.
A per-slot prompt hard-codes the mapping. The whole-unit route still has a use: **cross-checking silhouette
consistency** (independently generated parts tend to be "same style, not the same machine").

**Origin and orientation per part** is the step most often missed: AI meshes have their origin at the bbox
centre, while rig nodes pivot **at the joint**. Blender MUST move the origin to the pivot and rotate local
+Z to that part's forward direction — otherwise every segment rotates about the wrong axis and looks like
a dislocated joint rather than a bug.

---

## 4. Per-slot 2D splitting

### 4.0 Which tool: bulk goes local, subscription quota goes to the hard splits

**Since 2026-06-18 Gemini CLI dropped consumer tiers** (free / AI Pro / AI Ultra), replaced by Antigravity
CLI (`agy`); `gemini` now needs enterprise or a **paid** API key. Routes, ordered by bulk feasibility:

| # | Route | Auth / cost | Use (user decision 2026-08-04) |
|---|---|---|---|
| **A** | **`agy` built-in Nano Banana Pro** | Antigravity OAuth = subscription quota, no API key | **Mech 2D** (masters + per-slot splits). `agy --print "…"` is non-interactive ⇒ scriptable |
| **B** | Local **FLUX.1 Kontext [dev] GGUF** (ComfyUI) | open weights, offline, **zero quota / zero cost** | **All other 2D**: building-unit NPCs, static-prop photo normalisation. GGUF exists for ≤12GB |
| **C** | Gemini CLI + `nanobanana` extension | **API key required**; OAuth/subscription quota does not apply | only when a paid key is already on hand |

⚠ **Quota is route A's only risk** (tightened 2026-02; 2–5 images per call reported at peak) ⇒ the two
rules in §4.0.2 are a **feasibility precondition, not an optimisation**.

### 4.0.1 Drawing order

**Mechs (12) → drones (12) → transformers (8, dual-form)**

| # | Kind | Character ids | Missing masters | Why |
|---|---|---|---|---|
| 1 | `robot` | s06 s07 s09 t01 t02 t03 t04 t05 t10 t12 m02 m06 | 4 (t10 t12 m02 m06) | most typical slots; split rules settled here transfer to the other kinds |
| 2 | `drone` | s01 s02 s03 s04 s05 s08 s11 t07 t08 t09 m03 m04 | **0** | fewest slots + masters complete = lowest unit cost |
| 3 | `morph` | s10 s12 t06 t11 m01 m05 m07 m08 | 7 units × 2 forms | see below |

**Three MUSTs for transformers** (`makePoser` interpolates between `p.a` and `p.b` using **the same `p.g`**
⇒ both forms share one part set; only the pose differs):

1. **MUST NOT generate a part set per form** — that turns "transform" into "swap model" and kills
   `makePoser`'s staggered time-window sequence (Macross-style multi-stage transform).
2. Split images are drawn **from the ground form** (joint pivots are most legible there).
3. Flight-form masters are for **acceptance**: every part must read correctly in both forms. A shin that
   only works on the ground fails when it folds into the fuselage as an engine nacelle — the other two
   kinds have no such check. Master redraws MUST be **ground + flight pairs produced in one conversation**
   (otherwise the silhouettes diverge).

### 4.0.2 Two volume rules

1. **Generate mirror-symmetric parts once; mirror in Blender** (`legL/R`, `armL/R`, `chFL/FR`, symmetric
   pods) ⇒ ~40% fewer unique slots.
2. **Retry only slots that split badly**, not a blanket 3×. Fixed criteria: single subject / flat
   background / no transparency or glow residue — all three pass ⇒ done.

⇒ ~**260 split images + 18 masters** total, in three batches, each a deliverable milestone.

Route C env precedence (archived):
`NANOBANANA_GEMINI_API_KEY` → `NANOBANANA_GOOGLE_API_KEY` → `GEMINI_API_KEY` → `GOOGLE_API_KEY`;
none set ⇒ `ERROR: No valid API key found…` (the README's `NANOBANANA_API_KEY` disagrees with the source;
this list wins). Models: `gemini-2.5-flash-image` has a free tier, $0.039; `gemini-3-pro-image-preview`
has **no free tier**, $0.134 ⇒ on route C, always flash (960 images: flash $0 vs pro ≈$129).

**The nine prompt rules (§4.1) apply to all three routes** — changing tool does not change the spec.

### 4.1 Prompt rules (omit one and you pay for it at the 3D stage)

| # | Rule | Why |
|---|---|---|
| 1 | one object, complete, uncropped, centred at ~85% of frame | cropped parts get invented |
| 2 | three-quarter view, ~35° yaw, ~20° elevation | maximum surface exposed |
| 3 | long lens (~100mm) flattened perspective | true ortho is out of training distribution |
| 4 | flat light, no cast shadow, no rim light, no blown highlights | baked highlights survive delighting |
| 5 | flat `#808080` background, no gradient, no ground plane | clean matting is the single largest quality factor |
| 6 | **fully opaque**: no glass, no transparency, no glow | #1 failure mode for image→3D |
| 7 | keep panel lines / bolts, matte surface | panel lines convey volume |
| 8 | no text / labels / arrows / watermark / multi-view sheet | text becomes geometric noise |
| 9 | ≥1024×1024, square | 1024 short side is the floor |

### 4.2 Template

```
Using {REF} as the design reference, redraw ONLY the "{SLOT}".
Output: exactly one object, complete and uncropped, centred, filling ~85% of the frame;
three-quarter view, ~35° yaw and ~20° elevation, long-lens (100mm) flattened perspective;
flat even ambient light, no cast shadow, no rim light, no blown highlights;
flat #808080 background, no gradient, no ground plane;
fully opaque materials — no glass, no transparency, no glow, no emissive;
keep the original panel lines and bolt detail, matte surface;
no text, no labels, no arrows, no watermark, no multi-view sheet;
1024×1024.
```

### 4.3 Two known defects in the masters

- **Translucent glowing wings** (e.g. the swarm wings in `s01_static.png`): rule 6 exists for this; the
  redraw must state opaque.
- **Thick black outline strokes**: if the stroke survives on the alpha edge it is read as a groove around
  the part. Inspect the alpha after matting; add `no outline stroke` to the prompt when needed.

---

## 5. Tool ladder at 12GB

| Tool | VRAM | Role |
|---|---|---|
| TRELLIS.2-4B | README 24GB; community 8GB@256 / 12GB@512 | **primary, but MUST be measured first**. MIT |
| Hunyuan3D 2.1 (**shape only**) | shape 10GB (paint 21GB — **never run**) | primary backup; this project does not want PBR |
| Hunyuan3D-2GP | lower (CPU offload) | fuse |
| Stable Fast 3D | 6GB, <1s | bulk small parts |
| P3-SAM | unpublished, to be measured | cross-validation only |
| UniRig family | — | **deliberately unused** (§0) |

Python 3.13 cannot run this stack (ecosystem pinned to 3.10–3.11) ⇒ separate `tools/ai3d/.venv`,
**never in `package.json`, never in a build step** (A2).

---

## 6. Geometry + one base colour only

Normal / metal / roughness maps **never enter the repo** (AGENTS.md §1 requires deleting normal maps and
rewriting the gltf to drop the reference; same boundary note as `ai-pbr-texturing`). This project colours
with a quantised toon ramp — a texture carrying baked shading fights the ramp bands rather than helping.
Part colour still comes from `paint.js` / `visual.hue` ⇒ the exported GLB **MUST leave base colour
overridable** (single material; do not bake per-part colours).

---

## 7. Acceptance (all required; listed in priority order)

```bash
node tools/audit_muzzle.mjs        # hardpoints: 32 heroes + 4 factions of NPCs
node tools/audit_cockpit.mjs       # FPV cockpit framing
node tools/audit_cast_jump.mjs     # cast/jump — only defence against post-pass channel leaks
node tools/audit_gpu_lifecycle.mjs # library geometry markShared
node tools/shot_units.mjs          # generate→render→review loop, before/after
npm test && npm run bal            # presentation layer ⇒ MUST be bit-identical
```

**Reverse verification (principle 9)**: deliberately offset one part's origin by 0.5m — `audit_muzzle.mjs`
or the `shot_units` comparison MUST show it. If nothing shows, this round never tested hardpoints at all.

**Triangle budget MUST be derived by measurement**: measure the current unit's triangle count first; the
new ceiling is that value × a factor you can justify. A hand-written number is discovered only when mobile
frame time drops.

---

## 8. Six things that break silently

1. **Parent node orientation changed** → the muzzle world-alignment inverse absorbs the error → tracers fire out of the hull's side.
2. **Part origin not moved to the joint pivot** → every segment rotates about the wrong axis → looks like a dislocated joint, not a bug.
3. **bbox grows past 5%** → `fitToHeight` shrinks the unit → health bar / glow / enemy marker all skew, and the values are measured once at spawn.
4. **The `??` fuse removed** → library load failure deletes the whole mech, with no error message.
5. **Library geometry not `markShared()`** → `disposeTree` reclaims shared geometry → the next unit spawns corrupted (A25).
6. **AI normal maps brought along** → fights the toon ramp → "some objects' shadow edges don't match the rest".
