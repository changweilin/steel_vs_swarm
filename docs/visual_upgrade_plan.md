# Visual Upgrade Plan — Cel Pipeline, Object Detail, Verification

Derived from a study of sakura-crossing (`C:/Users/user/Documents/study/sakura-crossing`).
Method captured in six skills under `.claude/skills/` — read those for the how, this file
is the what:

| Section | Skill |
|---|---|
| P0-A, P0-C, P1-A…D | `cel-shading-pipeline` |
| P0-B, P2-A, P2-B, P2-C | `procedural-object-detail` |
| V-A | `headless-3d-inspection` |
| V-B | `walkable-level-verification` |
| V-C, V-D | `heightfield-terrain-integrity` + `headless-3d-inspection` |
| V-E (declined) | `procedural-canvas-textures` |

**Scope.** Sections P0–P2 are **presentation layer only** (原則 4): no authoritative
geometry, collision, ballistics, LOS or balance values change, so `npm run bal` and the
server audits are unaffected (㋒) — adjacent audits must still pass.
Section V adds **offline verification tooling**; it changes no runtime code at all, but it
reads the real `solidResolve` / `heightAt` / `rayTerrain` seams, so it must import them
rather than reimplement them.

Date 2026-08-03. **Frame time not yet measured**; every performance claim below is an
open item, not a conclusion.

---

## Gap analysis

| Layer | sakura-crossing | This project | Gap |
|---|---|---|---|
| Ramp | 2/3/4/5-band + 2 high-key | **single** `[102,182,255]` | pale objects have nowhere to go |
| Shadow tint | patched into ramp, scene-wide | `CEL_COOL` added to `outgoingLight`, **`envMat` only** | mechs/heroes/weapons just get darker |
| Terrain | 5-tone ladder + cover field + threshold jitter | `terrain.js:435` **raw `new MeshToonMaterial`**, no cel patch | largest area in frame is the only unprocessed surface |
| Sky | 3-stop dome, 26-step soft quantise, billboard clouds | `environment.js:101` `scene.background = skyC` **flat colour** | second-largest area is one solid colour |
| Outlines | screen-space ink (all) + few hero shells | **shells only**; `biomes.js` calls `outlinify` **0 times** | buildings/landmarks/vegetation/terrain/water have no contour |
| Shell width | clip space × `clip.w` ⇒ constant px | object space `normal * uOW` ⇒ **shrinks with distance** | distant mech lines disappear |
| Post | ink → grade → FXAA | **none**, `game.js:8591` renders direct | no split-tone, no shadow lift |
| AA | 1.5–2× supersample + FXAA | `antialias: !isTouchUI()` | **touch devices have no AA at all** |

**Do not touch (already better than the reference):** hard metal specular band,
rig-space triplanar livery, `bakeContactAO`, `markShared`/`disposeTree` GPU lifecycle
seam, `vegPartXform` rigid-transform invariants, `RES_GOV`.

---

## P0 — high value, low architectural risk

### P0-A Gradient sky dome

**Now** `scene.background = skyC`, a single colour. All 4 weathers × 3 times of day are
expressed by that colour plus fog.

**Do** Add a `BackSide` dome (radius ≈ 1.5× map span) in `environment.js`; three stops
derived from the existing `TIMES` table; keep 35% quantisation:

```glsl
float t = clamp( h * 1.15 + 0.02, 0.0, 1.0 );
float q = floor( t * 26.0 ) / 26.0;
t = mix( t, q, 0.35 );
```

Billboard clouds, `depthWrite:false`, `fog:false`, two opacities; count scales inversely
with `WEATHERS[w].light`; no clouds in `fog` weather.

**Constraints** `frustumCulled = false`, `renderOrder = -10`. Colours MUST derive from
`TIMES`/`SEASONS`/`WEATHERS` — no fourth colour table (§2.1), or sky and fog diverge in
some combinations. Night dome must not exceed `T.sky` brightness.

**Cost** 1 draw call, 1 shader. Lowest risk item.

**Accept** Screenshots across 12 env combinations; `audit_ui_layout.mjs` green;
rain/fog sky must not read brighter than the fog far colour.

---

### P0-B Terrain cel patch + tone ladder

**Now**
```js
mat = imagery ? new THREE.MeshToonMaterial({ map: tex, gradientMap: toonGradient() })
              : new THREE.MeshToonMaterial({ color: 0x39424c, gradientMap: toonGradient() });
```
Two defects: (1) it is the only large surface not using `envMat`, so it gets neither
`wash` nor `cool`; (2) **without satellite imagery it is one flat `0x39424c`** — exactly
the "88% of the slope in one tone" failure the reference spent three rounds fixing.

**Do**
1. Immediate: both paths use `envMat(color, { map, rim: 0, wash: 0.5, cool: 0.5 })`.
   `rim: 0` is required — ground planes at grazing angles wash out entirely
   (already documented in `toon.js:envMat`).
2. No-imagery path: replace the flat colour with an attribute-field-driven tone ladder.
   - Add `coverAt(x, z)`: scattered-ellipse field, **weighted average** `s / max(0.55, w)`,
     never a sum (a summed field saturates to a constant — worse than nothing).
   - Seed from battlefield centre, same source as `biomes.js` `mulberry32` scatter (§2.3).
   - Design the ladder by **relative luminance**; the dark-end step must exceed the
     light-end step.
   - Jitter every threshold with a coarser-grained hash or boundaries read as contour lines.

**Constraints**
- **A14 / #INC-106**: 3-band ramp dark stop MUST NOT fall below 102. Terrain is a large
  `receiveShadow` mesh and `cool` lowers the dark band again — **sample and verify**.
- Vertex colours cost `pos.count * 3` floats. If memory or build time is unacceptable,
  split into N material groups instead (the reference uses separate meshes per tone).
- Water material also lacks the patch; include it, but `transparent` meshes skip `moss`.

**Accept** 3 maps × (imagery / no-imagery) screenshots. Sample per-tone area share;
**no tone above 35%**, number recorded in the source comment as the regression baseline.
`audit_gpu_lifecycle.mjs` green.

---

### P0-C Screen-space ink pass ★ highest value

**Now** Outlines exist only as inverted hulls, and `biomes.js` never calls `outlinify`.
Net effect on screen: **mechs have black lines, the world has none** — mechs read as
stickers on a photo. Covering the world with shells is not viable: hundreds of extra
draw calls in a measurably draw-call-bound renderer.

**Do** Add depth second-difference post pass (full GLSL in the `cel-shading-pipeline`
skill, L3). Key points: second difference not first; convex full strength / concave ×0.42;
ink mixed with base colour; distance fade; sky-depth early out.

**Placement** New `public/js/postfx.js` exporting a `Pipeline` class.
`game.js:8591` `this.renderer.render(this.scene, this.camera)` → `this.pipeline.render()`.

**Constraints — all risk is here**
- **A25 GPU lifecycle**: 3 RTs + depthTexture + 3 FullScreenQuad materials MUST all be
  disposed on teardown. `audit_gpu_lifecycle.mjs` must cover the new module.
- **`RES_GOV` interaction**: RT size MUST still flow from `_dpr() * _resScale`. The
  pipeline MUST NOT compute its own pixel ratio, or the governor's downscale stops
  affecting the RTs (i.e. the governor becomes a no-op). Conservative option: keep the
  existing `setPixelRatio` and let passes follow the drawing buffer size.
- **Mobile**: half-float RTs are a **bandwidth** cost on tilers — the same bottleneck as
  the MSAA note at `game.js:481`. A downgrade path is mandatory: under `isTouchUI()` or
  `svs_lowpower`, run ink only with an `UnsignedByteType` colour RT, or disable entirely.
- `charPreview.js` is a separate renderer, unaffected.
- **Thin meshes must stop writing depth.** The ink pass reads the depth buffer; audit
  `vfx.js` / `castfx.js` / `hazards.js` for depth-writing particles, beams and decals
  before shipping, or they render as speckle.
- No predicate is touched: this is renderer-side only.

**Follow-up** Once ink covers the scene, some of the 15 existing `outlinify` calls will
double-line. Keep mechs / cockpit / turrets (hero props needing a heavier line); drop
the `hazards.js` and `vfx.js` ones. Compare per item — do not remove them all at once.

**Accept**
- 30 s steady-state frame time, desktop + touch emulation, before/after. This is the only
  data that decides viability.
- Same-view screenshots with ink on/off (add a `?ink=0` toggle).
- `audit_gpu_lifecycle.mjs` new assertions + 60 s firing, heap not monotonically rising.
- `npm test` green (㋒).

---

## P1 — clear value, ship with P0-C

### P1-A Ramp family

**Now** `toonGradient()` returns one `[102,182,255]` for everything.

**Do** `toonGradient(bands = 3)` with:

```js
const RAMPS = {
  2: [102, 255],          // small dark parts: tyres, cables, dark armour
  3: [102, 182, 255],     // current — MUST stay bit-identical
  4: [102, 158, 206, 255],
  soft: [190, 255],       // pale masses: snow, smoke, water, white livery
};
```

**Constraints** Band `3` bit-identical or the whole scene recolours. A14's ≥102 dark stop
holds for every entry (`soft` is higher, so safer). All call sites go through
`toonMat`/`envMat` `opts.bands`; no DataTexture construction elsewhere.

**Accept** Call sites without `bands` produce bit-identical output (screenshot diff).
New audit assertion: `DataTexture` for ramps constructed in `toon.js` only.

### P1-B Move shadow tint into the ramp

**Now** `CEL_COOL` mixes `outgoingLight` before `opaque_fragment` and only `envMat`
enables it. Mechs, heroes and weapons use `toonMat`, so **their shadows only darken**.

**Do** Patch `lights_toon_pars_fragment` instead (one line, skill L1b). Weaker tint for
mechs (they must hold faction livery hue), stronger for environment.

**Constraints** `customProgramCacheKey` must encode the tint value.
**This changes the shadow hue of every mech** — get art-direction confirmation before
applying; do not fold it into another batch.

### P1-C Grade pass + FXAA

**Do** Append split-tone + `uLift` + FXAA to the P0-C pipeline.

**Why** Lift and the strong cool fill are the same requirement twice: cel shadows must be
coloured, not crushed. **MSAA does nothing for pass-drawn lines**, so once P0-C ships,
`antialias: !isTouchUI()` should become `false` + FXAA — desktop saves the MSAA bandwidth
and touch gets AA for the first time. The env system currently expresses season and time
of day only through light and fog colour; grade makes those differences painterly rather
than just brighter/darker.

**Constraints** Grade runs in linear space then converts manually ⇒ `NoToneMapping` +
`NoColorSpace` RTs. This changes every final colour; re-review all screenshots.

### P1-D Clip-space outline width

**Now** `outlineMaterial` extrudes along normals in object space by a fixed world width,
divided by world scale only. No distance compensation ⇒ distant lines vanish, near ones bloat.

**Do** Extrude in clip space × `clip.w` (skill L4); width unit becomes NDC. Add distance
fade so shells do not double-line with ink.

**Constraints** Keep the `SkinnedMesh` `bind(skeleton, bindMatrix)` branch and the
`userData.outlineGeo` smooth-normal copy for hard-edged geometry. Changing the width unit
means retuning all 15 call sites (`0.012` / `0.03` / `0.05` / `0.07` / `0.1` / `outlineW(target)`).

---

## P2 — independent scheduling

### P2-A Weathering attribute field

**Now** `CEL_MOSS` is a world-Y projection plus one noise layer, applied **uniformly**
to every environment object; `CEL_WASH` likewise. Neither has any notion of "this area is
older than that one".

**Do** Share P0-B's field (`coverAt`, or a `weatherAt(x,z)`); drive moss density, rust and
water staining from it via uniform or vertex attribute.

**Discipline** The field MUST NOT be derived from terrain. "How old is this wall" must not
be purely a function of height above ground or distance from a blast — such terms are
constant across a uniform region, which is the defect rather than the fix.

### P2-B Extend micro-jitter to buildings / obstacles / landmarks

**Now** `xform.js` `dj` jitter (`jr` increase-only radius, `spin` for axis-centred parts)
applies to `VEG_DEFS` only. `BUILDERS` and `MEGALITHS` do not use it.

**Do** Route building/obstacle part tables through `vegPartXform` — already a single seam,
already covered by `audit_object_joints.mjs`, so extending needs no new verification.

**Constraints** (reuse existing invariants) `jr` increase-only; `spin` only for
`px === pz === 0`; never jitter `y`/`px`/`pz`/longitudinal scale.
**Visual radius must stay inside the authoritative collider margin** (原則 4) — inflated
geometry must not exceed the collision columns uploaded via `_losGrid`, or it becomes
"visible but unhittable" (A30 family). `audit_climb.mjs` Ⅲ two-end agreement is the
existing yardstick; this is the item most in need of measurement.

### P2-C Semantic placement pass

Current scatter is density-driven. Pick 3–5 points every player passes each match
(base exit, first tower, tunnel portal, bridgehead) and place one legible object at each.
No new code required.

---

## V — verification and tooling (from the level/inspection/terrain skills)

Independent of the rendering work, but **V-A gates it**: without a fixed camera set there is
no way to prove any P0/P1 batch did not regress something off-frame.

### V-A Fixed establishing-shot set ★ prerequisite for batch 1

**Now** Five `tools/shot_*.mjs` Playwright tools exist (`units`, `tunnels`, `seasons`,
`giants`, `gnest`), each per-feature. There is **no checked-in "one establishing shot per
place, run before and after"** set, so visual regressions outside the feature under test
are invisible.

**Do** Add `tools/shot_scene.mjs` with a checked-in camera list — spawn, first tower, lane
mid, both portals, bridgehead, base interior, roof deck, one open hillside, one water edge —
per venue tier. Reuse the existing `__SVS` hook and `tools/pw.mjs` runner. Add a
`?ink=0` / `?grade=0` style pass toggle once P0-C lands, so a layer can be isolated.

**Note** Aerial framing must set `battle.pos` / `battle.pitch`, **not** `camera` directly —
the camera is re-derived from the player each frame.

**Accept** Full set captured on ≥2 venues; committed as the baseline for every later batch.

### V-B Lane and structure traversability audit ★ highest value of the four skills

**Now** `CLAUDE.md` states the failure directly: bots have no pathfinding, so a bot pressed
against a building **stalls in place and the whole lane stops pushing** — and "a bot standing
still" is easily misread as an AI difficulty problem. The current detector is the **indirect**
`繞行%` proxy (`_skirtUntil` tick share, ≈4.0%, SD ≈0.2), measured over 24 sampled matches.
There is **no connectivity check anywhere in the 40 audit scripts** (`grep 泛洪 CLAUDE.md` = 0).

**Do** Add `tools/audit_traverse.mjs`: headless grid BFS over a baked venue using the real
`solidResolve` / `heightAt` / slope gate, seeded at each base.

- Key the visited set on **`(cell, height bucket)`** — one bit per cell makes every stair,
  ramp and portal approach report unreachable while being perfectly walkable.
- **No height tolerance in the key** — it ping-pongs forever on a slope (measured elsewhere:
  53.6 M visits for 770 k cells, non-terminating).
- Assert a **waypoint list**, not a cell count: both bases, every tower site, both portal
  mouths of every bore end-to-end, every bridge deck, every underpass ramp.
- Run per venue tier; chunk it if it exceeds a few seconds.

**Why this beats the proxy** It answers "is the lane traversable" directly instead of
inferring it from how often bots sidestep, and it runs offline with no sampling variance —
the current method needs n≈24 because single-match 工事損血 ranges 433–10298.

**Accept** All waypoints reached on every shipped venue; add to the regression matrix under
「兵線導航規則」and「地下道 / 明隧道」, both of which currently verify *geometry contracts*
but never *that a body can get through*.

### V-C Move the quantitative scans out of Playwright into Node

**Now** `shot_tunnels.mjs` already performs five numeric scans (section residue, portal
sky-leak, section obstruction, see-through holes, in-bore sky fraction) — but inside a
Playwright page. The whole class is marked ㋓ in the regression matrix: **not runnable in a
sandbox, so an agent cannot verify its own tunnel work.**

**Do** Split the numeric half into a Node entry point. Geometry never depends on canvas
contents, so stub `document` with a proxy that no-ops every Canvas2D call, import
`biomes.js` / `terrain.js` directly, and fire the same `rayTerrain` probes. Screenshots stay
in Playwright; the pass/fail numbers move to `npm test`-adjacent scripts.

**Constraint** The scans stay **screening values, not verdicts** — the existing note that
slope-crossing gullies produce false positives still holds; a red result means "look at the
picture", not "it is broken".

**Accept** Same numbers from Node and Playwright on the same synthetic venue; ㋓ removed from
the tunnel rows of the matrix.

### V-D Numeric clearance check

**Now** The matrix says to re-verify 「淨空 > 最大機體 4.5m + 0.2 頭頂餘裕」when
`SOLDIER_H` / `HERO_SIZE.mul` / `BRIDGE_RISE` / `TUN.CLEAR` change, but names **no script** —
it is a manual check.

**Do** Add a `clearance()` function to the tunnel/bridge audit: sample the section along
every bore, gallery and bridge underside, and report the worst headroom against the largest
`heroTargetH` in `data.js`. Derive the mech height from `data.js`, never hard-code it.

**Why** A section written from the wrong reference is completely silent — in the reference
project an arch written from its radius instead of its springing put the crown 2.75 m out and
ran a train through solid rock for the structure's entire life, because a tunnel is a dark
hole with a dark shape moving in it. A numeric check is the only thing that finds this.

**Accept** Worst-case headroom printed per structure; fails below the margin.

### V-E Not proposed: world signage

The procedural-texture skill has the **least applicable surface here**. `paint.js` is already
exemplary — procedural canvas, `${pattern}:${hue}:${tone}` cache, rig-rest triplanar so the
pattern stays on the armour plate. The world itself carries almost no readable signage, and
adding some is a **feature request, not a fix**. The skill's residual value is its trap list
(aspect-ratio crush, the two-sided-plate mirror rule) — apply it *if* signage is ever added;
do not schedule work for it now.

---

## Batch order

| Batch | Items | Rationale |
|---|---|---|
| **0** | **V-A fixed shot set** | measurement instrument; every later batch is compared against it |
| 1 | P0-A sky, P0-B terrain | small, low risk, largest areas |
| 2 | P1-A ramp family | needed by P0-B's ladder and by later passes |
| 3 | **P0-C ink + P1-C grade/FXAA** | one pipeline, build and verify together |
| 4 | P1-D outline + prune duplicate shells | only knowable after ink ships |
| 5 | P1-B shadow tint into ramp | changes every mech's art; confirm direction first |
| 6 | P2-A / P2-B / P2-C | independent |

**Runs in parallel, not blocked by any of the above** (different files, different reviewers):

| Track | Items | Rationale |
|---|---|---|
| **T1** | **V-B traversability audit** | highest-value single item in this document; replaces an indirect proxy with a direct check and needs no rendering work |
| T2 | V-C Node-side scans → V-D clearance | same refactor; V-D lands as one more scan once the Node harness exists |

If capacity is limited, **V-A and V-B before anything visual.** V-B fixes a class of bug that
currently reaches players (a stalled lane reads as broken AI); the rendering items fix how the
game looks, which nothing is currently reporting as broken.

**Gate for every batch:** **the V-A camera set re-shot and compared** · `npm test` green ·
adjacent audits green (at minimum `audit_gpu_lifecycle.mjs`, `audit_ui_layout.mjs`) ·
steady-state frame time on desktop and touch · **`npm run bal` unchanged** (any movement
means something outside the presentation layer was touched).

**Gate for track T1/T2:** the new audit must **reverse-verify** — break the predicate on
purpose and confirm it goes red (原則 9). An audit that has never failed has never been
tested. Read source through `tools/audit_src.mjs`, never `readFileSync`, or CRLF checkouts
silently pass (㋑).

**Register new seams in `CLAUDE.md` §2.1**: `postfx.js` Pipeline, `toonGradient(bands)`
ramp table, `coverAt` attribute field. All three will have multiple consumers; unregistered
seams grow second implementations.

---

## Out of scope

- No new npm dependencies (A2). Passes are hand-written; `FullScreenQuad` from
  `three/addons/postprocessing/Pass.js` is in-tree and permitted.
- No changes to predicates: range, blast, LOS, collision, slope, ballistics (原則 1, 原則 4).
- No bloom / DoF / motion blur — sources of photographic feel, opposite to the target.
- Do not change the three values of the `3`-band ramp (A14 / #INC-106).
