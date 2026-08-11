---
name: photo-to-prop-forge
description: Turn CC0 web photos into a **part vocabulary** for buildings, giant trees, megaliths and landmarks using open-source AI 3D models, then let the existing procedural assembly code (VEG_DEFS / MEGALITHS / KIND_PARTS / BUILDERS) pick, place and jitter them — never bake a finished tree. Covers the Openverse/Wikimedia licence hard gate, the 12GB tool ladder, measured extents vs collider consistency, and the audit_object_joints / audit_beacons / audit_traverse acceptance gates. Use when static world objects look too uniform or too coarse, when adding rock/tree/building/landmark detail, when sourcing reference photos for 3D generation, or when asked to make scenery "more detailed".
license: MIT
compatibility: Offline pipeline (Python 3.11 venv + Blender headless under tools/ai3d/, never in package.json); runtime adds only partlib.js
---

# Photo → Static Prop Part Forge

> Read `docs/ai3d_runbook.md` first (plan and phase gates). Generic external-pipeline knowledge lives in
> `ai-mesh-generation`; variation and seed discipline in `procedural-object-detail`. This skill covers
> **only this repo's contract and what breaks silently**.

## 0. Core premise: produce vocabulary, not finished props

Static props today are **pure-data part tables** + procedural assembly:

```js
// beacons.js KIND_PARTS — pure data, zero THREE (the only reason it is offline-verifiable)
pylon: [ { g: ['cyl', 0.42, 0.52, 13, 4], c: 0x8d949c, p: [-2.9, 6.5, -2.9] }, … ]

// biomes.js VEG_DEFS
conifer2: { parts: [ { g: cyl(0.18, 0.3, 2.4), y: 1.2, c: 0x54402a },
                     { g: ico(2.0), y: 3.4, key: 'conifer', sy: 0.8 }, … ] }
```

The assembly code owns **per-instance variation**: the seed picks the variant, `stretch` sets the
height/width ratio, `partJitter` perturbs parts, `vegPartXform` sets whole-instance yaw and tilt.
**Baking a complete tree throws that entire layer away** — every tree in the forest becomes identical,
with no error message.

So AI produces parts only:

| Family | Parts today | What AI should produce |
|---|---|---|
| Vegetation / giant trees `VEG_DEFS` `GIANT_DEFS` | `cyl` trunk + `ico`/`cone` canopy | 3–5 canopy modules, 2–3 branch forks, buttress roots |
| Megaliths `MEGALITHS` | `Box`/`Sphere` + hand-written grooves | rock facets, collapse blocks, talus cones |
| Landmarks `KIND_PARTS` | `['cyl'\|'box'\|'cone'\|'ico']` | lattice nodes, microwave dishes, water-tank drums, containers |
| Buildings `hazards.js BUILDERS` | extruded boxes | window modules, roof caps, balconies/canopies, external piping |

---

## 1. Sourcing: the licence gate is hard, not advisory

- **Openverse API** (`api.openverse.org`): **no key**, 800M+ items, `license` filter, covers Flickr /
  Wikimedia / museums.
- **Wikimedia Commons API**: fills the landmark category; each item carries licence, author, size, category.

**Rules**

1. **Hard-code `license=cc0`** (includes public domain). **CC-BY is also rejected** — a rock baked into the
   repo has nowhere to carry attribution, and a licence violation produces no error message.
2. Every download records `{source_url, license, creator, retrieved_at}` in `tools/ai3d/photo_manifest.json`.
3. **Photos are offline input and never enter the repo**; only the part-library GLB does.

**Selection criteria** (same spec as `mech-part-forge` §4.1, but here you are picking, not generating):
single subject, clean background, flat light without hard shadows, opaque, no people/cars occluding,
short side ≥1024, avoid wide-angle close-up distortion. One good photo beats three patched ones.

---

## 2. Production flow

```
Openverse / Commons (license=cc0)
    │  download + record in photo_manifest.json
    ▼
select →[rembg matte → alpha]
    │  image→3D: Stable Fast 3D (6GB, primary) / Hunyuan3D 2.1 shape-only (10GB) / TRELLIS.2 (hero parts)
    ▼
raw mesh → Blender headless: decimate → **origin on the mating face** → normalise orientation (+Y up, +Z forward) → export
    ▼
public/assets/models/parts/{family}.glb  →  partlib lookup  →  existing part tables select it
```

**SF3D is the workhorse here, not TRELLIS**: a tree needs ~15 parts and a landmark ~25, so 6GB/<1s
throughput is what makes the batch viable; only the few parts that genuinely need detail (giant-tree
canopies, signature megaliths) escalate to TRELLIS.2 / Hunyuan.

**Origin on the mating face** is the step most often missed: a canopy's origin belongs at the canopy base,
a roof cap's at the eaves, a talus cone's at ground level. With the origin at the bbox centre, every `y:`
value in the existing part tables would have to be recomputed — and the symptom is a canopy floating in
mid-air, reported by `audit_object_joints` as FLOAT.

---

## 3. Runtime seam: `public/js/partlib.js`

```js
// beacons.js — one extra descriptor form in _geo(), nothing else changes
function _geo(g) {
  if (g[0] === 'lib') return libGeo(g[1]) ?? _geo(g[2]);   // g[2] = original primitive descriptor = the fuse
  …
}

// biomes.js VEG_DEFS
{ g: libGeo('tree/canopy_c') ?? ico(2.7), y: 5.0, key: 'foliage', sy: 0.75 }
//                            ↑ this ?? MUST stay
```

**`beacons.js`'s front half MUST stay THREE-free** — that is the only reason it is offline-verifiable
(`audit_beacons.mjs` I pins this). Part descriptors stay pure data, `['lib', name, <original primitive>]`;
the lookup happens inside `_geo`.

---

## 4. Four invariants (acceptance conditions, not advice)

1. **Measured extents**: collider / `foot` / `col.r` always from `Box3.setFromObject` **after** the swap.
   Reusing nominal values means visuals poking outside the collider (A30) or the landmark being pushed
   needlessly far away. `audit_beacons.mjs` I pins this column in both directions.
2. **Zero extra randomness**: swapping geometry MUST NOT consume an extra `rnd()`. One extra draw shifts
   the whole map's vegetation/building/hazard layout sequence (CLAUDE.md §2.3), and on screen it just reads as
   "this map is different from last time".
3. **`markShared()` for shared geometry**: library geometry is shared by many InstancedMeshes;
   `disposeTree` must skip it by registry (A25).
4. **Geometry + base colour only**: no normal/metal/roughness maps in the repo; colour still comes from the
   part table's `c:` ⇒ the exported GLB **MUST leave base colour overridable**.

---

## 5. Acceptance

```bash
node tools/audit_object_joints.mjs --seeds 8   # FLOAT/PARTIAL/DETACHED/ISOLATED hard failures
node tools/audit_beacons.mjs                   # extents / collider / placement
node tools/audit_beacons.mjs --break-extent    # reverse check: an oversized part MUST turn it red
node tools/audit_traverse.mjs                  # new parts do not block routes
node tools/audit_cel_pipeline.mjs              # ramp family / outlines unchanged
node tools/audit_visual_prefs.mjs              # part-jitter invariants
node tools/audit_gpu_lifecycle.mjs             # shared geometry
npm test && npm run bal                        # presentation layer ⇒ MUST be bit-identical
```

**Reverse verification (principle 9)**: if `--break-extent` / `--break-pad` do not turn red, this round
never tested extents.

**Visual loop**: `node tools/shot_scene.mjs --venue taroko` before/after; `--ink=0` / `--grade=0` /
`--post=0` isolate each layer — "which layer made this frame worse" must be answerable.

---

## 6. Six things that break silently

1. **Baking a whole tree / whole building** → per-instance variation disappears → the forest is uniform, with no error message.
2. **Origin not on the mating face** → floating canopies / roof caps sunk into walls → `audit_object_joints` reports FLOAT/PARTIAL.
3. **Collider reusing nominal values** → visible extent pokes outside the collider (A30) → what you can hit and what you can see diverge.
4. **One extra `rnd()`** → the whole map's layout shifts → scenes differ across clients (CLAUDE.md §2.3 / A4).
5. **CC-BY accepted without attribution** → licence contamination, no error message ⇒ hard-code `license=cc0`.
6. **No triangle budget** → a landmark with 25 high-poly parts → heavier outline pass, mobile frame time drops. The budget MUST be derived from **measured current values**, not hand-written.

---

## 7. 12GB tool ladder

| Tool | VRAM | Role |
|---|---|---|
| Stable Fast 3D | 6GB, <1s, delight + UV included | **static workhorse**, batch throughput |
| Hunyuan3D 2.1 (shape only) | 10GB (paint 21GB — **never run**) | mid-tier detail parts |
| TRELLIS.2-4B | README 24GB; community 8GB@256 / 12GB@512 | signature parts, **MUST be measured first** |
| P3-SAM | to be measured | when one scanned mesh must be split into parts |

Fallback chain: `TRELLIS.2 → Hunyuan3D shape-only → SF3D → keep current procedural parts`.
Drop a tier whenever one fails. **Never change a rule or a contract to make a tool fit.**
