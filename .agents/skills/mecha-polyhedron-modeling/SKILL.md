---
name: mecha-polyhedron-modeling
description: Rebuild procedural mecha from 2D concept art as polyhedron part assemblies on the humanoid-forge rig — a shared geometry vocabulary (tapered frusta / polygon prisms / lathes / blade fins / feather fans / segment chains / cable bundles), per-mecha builder files, frozen rig contracts, and a headless screenshot closed loop as the only correctness gate. Use when a mecha "uses only simple boxes", when modeling body/limbs/head/wings/feathers/tail/tentacles from a 2D image, when weapons must be rebuilt piece-by-piece from art, or when fanning out one agent per mecha for parallel remodeling.
license: MIT
compatibility: forge lives in public/js/forge/ (game + board eat the same tree since 2026-08-14); boards and capture tools stay in tools/; vanilla ES modules + CDN three@0.160; Playwright borrowed from global npm (A2 — never in package.json)
---

# Mecha Polyhedron Modeling (2D art → part assemblies, screenshot-verified)

> **Route disambiguation** — two skills share the "more mecha detail, rig must not move" trigger:
> - NPCs, vehicles and structures in `public/js/models.js` (heroes left it on 2026-08-14), detail
>   via **AI-generated GLB parts** through the
>   `partlib.js` fuse and the `audit_muzzle/cockpit/cast_jump` acceptance gate → `mech-part-forge`.
> - The **humanoid forge** (`public/js/forge/`), detail via **procedural polyhedra written by hand
>   from 2D art**, screenshot loop as the only gate → this skill. It stopped being a prototype on
>   2026-08-14: the user ruled the new modelling replaces the old wholesale, so `makeUnit()`'s hero
>   branch now calls `forgeHero()` and the board renders the same tree the match does. The old
>   builders are frozen in `tools/humanoid_forge/legacy/legacy_models.js`, on the board only.
>
> Other siblings: `headless-3d-inspection` (generic `__shot` capture / raycast verification —
> this skill's §4 is one instantiation of it); `cel-shading-pipeline` (the toon/outline renderer
> itself — §2b here covers only the outline traps specific to vocabulary-built polyhedra).

## 0. Core premise

1. **Two references, two jobs — never swap them.** Body proportions and skeletal structure follow
   the curated real-world reference photos on the 機體台 board (`/api/protorefs`; real skeleton/
   whole-animal/whole-airframe photos, curated per-mecha — that curation *is* "機體台選檔照片",
   not a fresh web search you do yourself; mechanics in §6). Feature detail — armor panelling,
   mechanism language, weapon form, glows, signature parts — follows the mecha's 2D concept art in
   `public/assets/cyberpunk_art/mechs/` (`/api/protoimgs`; `{id}_{form?}_{pose}.{png,jpg}`; for
   morphs the `ground_*` set is the modeling target, `flight_*` is color/detail reference). Read
   both before writing code; never model from the text brief alone. Signature parts you can only
   discover by looking: serrated axe edges, feather rows inside binder pods, 10+ tail segments
   where the code had 5, a spare tire on a cargo rack. Never substitute one source for the other's
   job — the concept art gets anatomy wrong or omits it entirely (no metatarsals, no
   three-segment bird wing, no crescent tusk, no whale-hull continuity: modeling proportions
   straight from it produces limbs that read as stilts), and the proto-ref photos carry no paint
   scheme or signature parts to copy.
2. **A body part is an assembly, not a box.** Main shells (head/chest/pelvis/limb shells/pauldrons/
   feet) must be faceted polyhedra — tapered frusta, extruded polygon profiles, lathed solids.
   Plain `bxF` boxes are allowed only for small detail (rivets, trim strips, buttons).
3. **Organic multiples are one part per element.** Feathers, manes, tails, tentacles, wing blades,
   sinew bundles: each feather/segment/strand is its own mesh, built with `fanF`/`chainF`/`finF`/
   `cablesF`. A single stretched box reading as "the tail" is the exact failure this skill exists to fix.
4. **Weapons follow the same logic.** Blade silhouettes via polygon prism, barrels/muzzles/drums via
   lathe, rings/coils/ammo boxes as individual pieces — all traced from the art.
5. **Geometry changes only.** The rig is a named Group hierarchy driven verbatim by
   `public/js/locomotion.js`. Contracts in §3 are frozen; break one and the mech stands still or
   fires from the wrong node with no error message.

## 1. Three-layer architecture (who owns what)

| File | Role | May you edit it? |
|---|---|---|
| `public/js/forge/geo.js` | Geometry vocabulary — the alphabet (aliases re-exported from the repo-wide primitive seam `public/js/geo3d.js`) | Only to add a letter for ≥2 consumers; never mid-fan-out |
| `public/js/forge/mechs/<id>.js` | One mecha's feature→part builders | Yes — this is where all modeling happens |
| `public/js/forge/mechs/index.js` | Roster aggregation | Only when adding a mecha |
| `public/js/forge/forge.js` | Feature table, spec merge, rig scaffold (`forgeMech` / `forgeMorphUnit`) | No (frozen contract) |
| `public/js/forge/roster.js` | Roster + proto classification (`entryKey()` = `t01` / `t06@ground` / `t06@flight`) | Only when adding a mecha |
| `tools/humanoid_forge/viewer.js` + `stage.js` + `index.html` | Standalone board (:8631); `stage.js` is the one shared stage both boards host | Board work only |
| `tools/codex_review/review.js` | Codex board forge block + 2D reference strip | Board work only |
| `tools/humanoid_forge/shot_mech.mjs` | Closed-loop capture tool | Rarely |

Mech files import **only** from `../geo.js` and `three`. Never `new THREE.BufferGeometry()` in a
mech file — that is a second implementation of the vocabulary and its outline discipline (§2b).

## 2. The vocabulary (pick by shape language)

| Letter | Shape | Use for |
|---|---|---|
| `tboxF(parent,{w0,d0,w1,d1,h,sx,sz},x,y,z,color,opts)` | Tapered frustum, sheared top | Armor plates, limb shells, trapezoid chests — the workhorse replacing boxes |
| `prismF(parent,pts,depth,x,y,z,color,opts)` | Extruded 2D polygon (CCW points, XY plane, extruded in Z) | Chest profiles, shields, crescent/serrated blades, collar wings, wedge heads, hex/octagon panels |
| `latheF(parent,[[r,y],...],seg,...)` | Lathe around Y (smooth normals kept) | Dome pauldrons, ribbed drums, gun barrels/muzzles, joint rings, ring-stack limbs, ammo drums |
| `finF(parent,{len,w0,w1,t,sweep,camber},...)` | 3-section blade along +Y, origin at root | Single feather/blade/spike/rotor blade; caller rotates at the quill |
| `fanF(parent,{n,arc,len,edgeF,gap,fin},...)` | N fins fanned around local Z, center-longest, per-fin z-stagger | Wings, manes, tail-feather arrays, flame plumes — one part per feather |
| `chainF(parent,{n,len0,len1,r0,r1,rot0,rotD,ring,drawSeg},color,opts)` | Chained pivot Groups, bodies along −Z, taper + joint rings | Tails, tentacles, whips; returns `{segs}` — feed `segs` straight into `rig.tailSegs` |
| `cablesF(parent,{p0,p1,k,r,sag,spread},...)` | k bezier tubes, index-fanned offsets | Exposed sinew, cable bundles, feed chutes — one part per strand |
| `bxF/cylF/sphF/coneF/torusF` | Primitives | Small detail only |
| `hydCyl/sinew/seg2` | Per-mecha joint idioms | Keep each mecha's mechanism language distinct |

Hard limits: radial segments ≤ 12; ≤ 250 meshes per mecha (count with a scene traverse, outlines
excluded); **zero `Math.random()`** — variation across fan/chain elements is index-derived.

### 2b. Cel-outline discipline (breaks silently)

`toon.js outlinify` builds an inverted hull pushed along normals:

- Flat-shaded (non-indexed) polyhedra crack the hull ⇒ `geo.js facet()` attaches a **welded
  smooth copy** as `userData.outlineGeo`. Anything you build through the vocabulary gets this free.
- **Beveled `prismF` + welded copy = garbage outline lines across the front face** (measured on
  t12). `prismF` drops `outlineGeo` when `bevel` is set; prefer no bevel at all.
- **Thin parts (torus tube r < ~0.01, hair-thin strips) render as a black blob** — the hull is
  thicker than the part. Set `mesh.userData.noOutline = true` (A16 flag) on such pieces
  (monocle rings, antenna tips).

## 3. Frozen contracts (checklist before you save)

- Builder signatures: `head(c,h)`, `chest(c,ch,d)`, `pelvis(c,hips,d)`,
  `thigh/shin/foot/armUp/armFore(c,l,d)`, `mount(c,F)`, `extra(c,F,rig)`.
- `mount()` return shape: `gunR/gunL {g,rest,aim}`, `muzzles {light/heavy:{n,r}}`,
  `lightGlowM/heavyGlowM/heavyPivot`, `weap`, `hvy`, `aimPose`, `wpn {nodes,ref,muz,fwd}`.
  Muzzle **nodes** may be replaced by new parts; the **fields** must survive.
- Numeric blocks frozen: `prop`, `gait`, `pose`, `moveSig`, `castSig` — they are calibrated to
  `locomotion.js`. Evolve geometry **in place** at the existing anchors (`*G` widths, `d.len`
  spans, `shoulderY/waistY`); do not re-derive positions.
- Sign conventions: limb geometry extends toward −y; `+x` rotation moves the far end backwards ⇒
  knee positive, elbow negative, ankle inverted. `c.sx` is the left/right sign.
- Palette: shells use `c.PAL` tiers (`lite/main/mid/dark/deep` — most shells sit on `mid/main`,
  full-`main` bodies read washed-out), glows use `c.accent`; weapon lengths multiply `c.K.barrelF`.
- Per-mecha special contracts (grep the file header): `knuckle:true` palm-walk, `rig.tailSegs/
  tailUp`, `c.binderPivots` (charge-deploy wings), `c.vlsPorts`, `c.rackL/rackR`, `c.browCannon`,
  `c.hellfireMuz`.
- Update the `doc` rows (feature → part, Traditional Chinese) — they render on the boards.

## 4. The loop (per mecha)

1. **Read the art.** All poses. Write a part plan: image feature → vocabulary letter, before code.
2. **Evolve `mechs/<id>.js` in place.** Replace shells, add signature parts, rebuild weapons.
3. **Gate syntax:** `node --input-type=module --check < public/js/forge/mechs/<id>.js`
   (or `node tools/audit_client_syntax.mjs`, which now walks `public/js/**` recursively)
   (plain `node --check` parses CommonJS and false-fails on `import`).
4. **Shoot:** with the dev server up (`node tools/humanoid_forge.mjs --port <p>` — start your own
   from your checkout; a default-port server may be serving a stale checkout with no error), run
   `node tools/humanoid_forge/shot_mech.mjs --id <id> --port <p> --prefix <id>_v1`.
   Eight frames: `front/side45/back` (silhouette vs art) + `run/fire/charge/heavy/cast`
   (detached parts, clipping, muzzle misalignment, deploy animations). Lines starting `✗` on
   stderr = your module threw in the page — fix before judging pixels.
5. **Read the PNGs and compare to the 2D.** Iterate ≥ 2 rounds; 3–4 is typical. Judge silhouette
   first, then signature parts, then proportions, then weapon form.
6. Screenshot verification is the **only** correctness gate — no offline audit sees this geometry.
7. **Reverse-verify the loop itself once per session** (repo principle 9): offset one signature
   part by 0.5 m, re-shoot, and confirm the frame shows it — then revert. If the frame is
   unchanged you are shooting a stale server or a cached module, and every "verified" frame this
   session proved nothing.

## 5. Fan-out recipe (many mechs in parallel)

- One agent per `mechs/<id>.js`; the file split exists precisely so agents never collide.
  Each agent gets: image paths, the frozen-contract list (§3), its mecha's special contracts, a
  part-design brief from your own reading of the art, and unique shot prefixes.
- All agents share **one** dev server; forbid them from starting/killing servers or editing
  `geo.js`/`forge.js`/other mech files. Vocabulary gaps are **reported, not hacked around** —
  collect them and extend `geo.js` yourself afterwards.
- An agent killed mid-edit leaves a half-migrated file that still parses. That is a valid resume
  state: the replacement agent shoots `--prefix <id>_r0` first to see what exists, then continues.
- After all agents land, run one integration probe in a single page: for each id
  `__forge.setSpec(id)` → traverse mesh count (≤250 excl. outlines) → check rig channels
  (`hips/chest/head`, both chains ×2, `muzzles.light/heavy`, `wpn.light/heavy`, `weap/hvy/kickAmp`,
  `moveSig/castSig`, expected `tailSegs.length`) → `__shot('final_<id>')`. Then look at every image.

## 6. Reference images on the boards

Two endpoints, two authorities (§0.1) — never conflate them:

- **`GET /api/protorefs?key=`** — the **body/skeleton** authority. Real-world skeleton/
  whole-animal/whole-airframe photos, grouped by proto layer (bionic/ground/air — same layers as
  `codex.js PROTO_LAYERS`). Backed by `tools/proto_refs/manifest.json`; populated by
  `node tools/fetch_protorefs.mjs` (CC0/PD only, hard-gated through `tools/ai3d/fetch_photos.mjs`'s
  licence check) and then **curated on the board itself** — reject (✕ 不符: deletes the file +
  blacklists the id so the next fetch run won't bring it back), annotate (what's right/wrong about
  a kept photo), retune (override the search query for the next fetch run), or upload your own
  (📁 選檔 / paste / drag-drop, licence stamped `user`). This curated set — **"機體台選檔
  照片"** — is what you model body proportions from; it replaces ad-hoc searching for skeleton
  photos yourself. If a layer is empty or wrong, retune/reject/upload on the board and re-run the
  fetch script rather than sourcing a photo out-of-band. Measure a base bone (femur or trunk
  length) in pixels and express every other bone as a multiple of it; write the ratio table into
  the mech file header. A specimen shot with a scale bar beats several without. Watch for
  projection foreshortening in 3/4-mounted photos — "collinear in 2D" does not imply one scale
  factor; cross-check with independent landmarks.
- **`GET /api/protoimgs?id=`** — the **feature** authority: the mecha's 2D concept art (the
  roster **is the directory listing**, ground form sorted first). Clients never assemble
  filenames; a client-side filename pattern is a second source table that rots silently.
- Codex board forge block: reuse the server manifest's `shots` rows (`has`, `form`, `star`),
  filter `form !== 'flight'`, star (appearance authority) first.
- **Features must not be sacrificed to skeleton accuracy.** Rebuilding limb bones from proto-ref
  photos must not delete a signature part the concept art and `mecha.js gen.parts` both call
  out — restore it if a bone-accuracy pass drops it.

## 7. Traps that pass every gate

- **Paint is not geometry.** Camouflage, tribal patterns, gold filigree textures in the art belong
  to the `paint.js` palette/pattern layer. Modeling them as meshes wastes budget; skipping them is
  correct, note it as a known deviation.
- Board lighting is globally brighter than the 2D art's dramatic grading — compare shape, not tone.
- The viewer page 404s `favicon.ico`; `shot_mech` prints it as console noise. Only `✗ 頁面例外`
  (pageerror) means your module crashed.
- `git status` on an untracked directory shows one `??` line — you cannot diff a half-migrated
  mech file against "before" via git; keep the previous agent's shots as the baseline instead.
- Restarting the shared server invalidates every other agent's loop mid-flight. Additive server
  changes (new endpoint) go on a **second** port until the fan-out finishes.
