---
name: photo-to-3d-pipeline
description: Execute the photo → 3D asset flow end to end — source CC0 reference photos, then route each object by geometry class to either **img→three.js** (read the photo, write pure-data primitive part rows; no GPU, no binary) or **local Blender** (SF3D on the 3060 → headless normalise → part-library GLB). Covers the environment matrix, per-host throttling, the solidity prefilter and the human-eye step the statistics cannot replace, measured triangle budgets, the three consumption seams, the provenance ledger, and the audit battery with reverse verification. Use when downloading reference photos, converting an image into game geometry, adding rock/tree/building/landmark detail, deciding which generation method an object should take, or continuing `docs/ai3d_runbook.md`.
license: MIT
compatibility: Offline pipeline (Python 3.11 venv + Blender 5.2 headless under tools/ai3d/, never in package.json — A2); runtime adds only partlib.js
---

# Photo → 3D: routed execution

> **State lives in `docs/ai3d_runbook.md`** (status ledger + trial logs) — read it for *what is done*,
> read this for *how to do the next one*. Contract and "what must never be baked" live in
> `photo-to-prop-forge`; mech slots in `mech-part-forge`; generic external-tool knowledge in
> `ai-mesh-generation`. This skill is the **operational procedure and its routing decision**.

---

## 0. The one decision that comes first: which route

Both routes start from the same CC0 photo. They diverge on **what the photo becomes**.

| Route | What the photo becomes | Cost | When |
|---|---|---|---|
| **0 — drawing→hull** (`method: plan_hull`) | Not a photo at all: an **orthographic drawing**. Take each view's outer contour, extrude along its own axis, intersect the prisms — the visual hull is *solved*, not generated | Zero GPU, zero weights, zero randomness, offline-verifiable | **Whenever a measured drawing exists.** A photo forces the model to guess depth; an elevation states it. This rung sits *above* every generative one — if you have the drawing, don't guess |
| **A — img→three.js** (`method: llm_parts`) | You *read* the photo and write pure-data primitive rows (`['cyl', r0, r1, h, seg]`, `ico(r)`, …) into the existing part table | Zero GPU, zero binary, zero licence exposure, extents verifiable offline | **Regular / man-made geometry**: landmarks (`beacons.js KIND_PARTS`), civic parts, road props — anything a primitive can honestly express |
| **B — local Blender** (`method: sf3d`) | You *run* the photo through SF3D on the 3060, normalise headless, ship a named node in `assets/models/parts/{family}.glb` | 4 GB weights, ~6 GB VRAM, ~7 s/image, binary in repo, offline extent contract needed | **Organic / irregular geometry**: rock bodies, tree canopies, buttress roots, hoodoos — shapes a primitive cannot express, plus **building modules** (user decision 2026-08-05) |
| **neither** (`method: procedural`) | Nothing — it stays as it is | — | Small/ordinary vegetation (orders of magnitude more instances ⇒ draw-call and triangle budget), and **mechs**, which go Track A (2D slot images into existing rig slots) and never through this pipeline |

The photo family is **not** the route and **not** the node role: `rock/facet` photos have shipped as
`collapse_a`. You pick by *shape*, and you fit to **the fallback descriptor's shape** — an `ico` fuse is a
sphere and takes a crown; squeezing a blob into a `cone` fuse stretches it into a column. If no `ico`-shaped
row exists, that slot is not a Route B candidate yet.

**Route A is not the cheap consolation prize.** It is the cheapest complete end-to-end proof of the whole
pipeline (photo → part vocabulary → audits → review board) and it needs no Python, no GPU, no GLB. When a
family is blocked on weights, quota or supply, ship its Route A members first.

---

## 1. Environment matrix (measured — do not rediscover)

| Where | Can | Cannot |
|---|---|---|
| **CC sandbox** | All offline audits, `npm test`, `npm run bal`, edits, PRs, GitHub/HF MCP | **No egress to Openverse / Commons / huggingface / blob storage; no GPU.** Pixels and meshes cannot pass through here |
| **GitHub Actions** | Photo fetching, licence re-audit, artifact publishing | No GPU; SF3D weights are licence-gated ⇒ needs an owner-added `HF_TOKEN` |
| **3060 12 GB box** | Everything: fetching (open egress), SF3D, Blender 5.2 headless, `agy` 2D, all audits | Python 3.13 is system default — the stack is the **3.11 venv** under `tools/ai3d/.venv` |
| **HF Space** | Browser-manual fallback only | The official SF3D Space is a stateful event chain; `gradio_client` cannot drive it. Do not budget time on it |

**Consequence**: the sandbox owns seams, tools, audits and docs. Anything touching a pixel or a vertex runs
on the 3060. The gitignored working set (`.venv`, `photos/`, `weights/`, `vendor/`, `out/`) lives in the data
home recorded in runbook §5d — the venv holds absolute paths, so **do not move it**, and run the fetcher from
that copy (it keys data off the script's own directory).

---

## 2. Step 1 — photo sourcing (both routes)

```bash
node tools/ai3d/fetch_photos.mjs --plan                 # work list + deficits, no API calls
node tools/ai3d/fetch_photos.mjs --family tree --limit 20
node tools/ai3d/fetch_photos.mjs --part rock/facet
node tools/ai3d/fetch_photos.mjs --review               # list what is on disk, for human picking
```

The catalog (`PHOTO_CATALOG`) is the single seam: family → part → `{want, q[], grp?}`. **Catalog order is
priority order** — put the rows you actually need next above the rows whose candidates are throttle-heavy,
or they never get their turn.

**Whole-building rows carry a corpus mix (user decision 2026-08-09): 50% ordinary urban / 25% rural or
tourist-lodging / 25% functional (temple, church, hospital, station, school, museum, government).** It is
declared as `BUILDING_MIX`, tagged per row with `grp`, and **checked from the `want` totals** — `--plan`
prints target vs. holdings and the fetcher refuses to run on drift. Two rules that are easy to get wrong:
the mix covers *buildings*, not the module rows (window/parapet/AC unit — counting those makes 50% drift
with every part you add), and rebalancing means **lowering `want`, not deleting rows** (a deleted row
orphans photos already on disk).

**The mix spans photos *and* drawings** (user decision 2026-08-09, second pass — supersedes the earlier
"drawings are an input format, not a building category" carve-out). Keep the two dimensions orthogonal:
`grp` is the building *type* and is the only thing the mix counts; a separate `src` field says which
conversion route the row feeds. Folding format into `grp` turns "drawing" into a fourth category and the
50/25/25 stops being computable. Drawings must **not** go through the photo screening gates — those
thresholds are calibrated on photographs, and a drawing is never matted at all; its quality gate is
`plan_to_mesh`'s own (line-art vs rendering, gap, frame).

The data home is a **parameter** (`--home`), not wherever the script happens to live: a worktree was once
deleted and took a 305-entry corpus with it.

**Four things the fetcher already knows; do not re-derive them**

1. `license=cc0` is hard-wired and re-verified per item. **CC-BY is rejected too** — a rock baked into the
   repo has nowhere to carry attribution, and a licence violation raises nothing.
2. Throttling is **per host**. `upload.wikimedia.org` returns 429 with `Retry-After: 600` after ~30
   downloads, then admits ~2–3 per 10-minute window. A 429 blocks only that host and is **never booked to
   the manifest** (it is the round's network state, not a fact about the photo). Budget cooldown rounds.
3. Bytes are checked, not extensions: `sniffImage()` accepts JPEG/PNG/WebP headers only. Two whole PDFs once
   passed the licence audit as `ok` photos — *Public domain* was true, the bytes were the lie.
4. Manifest paths are relative POSIX. Never let the manifest encode which machine fetched it.
5. **Commons TIFFs are fetched as MediaWiki's own JPEG render** (`iiurlwidth`), because the drawing corpus
   *is* TIFF: HABS measured drawings are archival 5000px `.tif`, so rule 3 booked every single one as a
   permanent failure — and permanent failures are never retried. Three drawing rows were structurally
   unfillable and the only symptom was a column of `✗`. The size gate must then read the **thumb**
   dimensions, not the original's. Only TIFF gets this: a PDF's "thumbnail" is page 1 of a document, which
   is exactly the thing rule 3 exists to reject.

**Query wording beats every model knob** — this is the largest measured lever in the whole pipeline.
`tree crown isolated sky` returns herbarium sheets and dark forest scenes (14 photos → 1 usable mesh);
`solitary oak tree meadow` / `lone tree field` returns single subjects (6 photos → 5 usable meshes). Same
tool, same parameters. Ask for a **named single subject** (`glacial erratic`, `italian cypress tree`,
`umbrella thorn acacia`), never a scene or a category.

**Selection standard (user decision 2026-08-09): as clean as possible — the target object and nothing
else — and well lit.** It lands in two places, and knowing which half is which saves a round:

- *Before download*, the only lever is query wording (above). Licence and short-edge are the only other
  things checkable from metadata.
- *After matting*, `screen_mattes.py` measures what wording cannot: `④ 多主體` (largest connected alpha
  component < 0.70 of subject area) and `⑤ 光源不足` (mean subject luma < 35 **and** shadow fraction ≥ 0.70).
  Thresholds are calibrated against **sources that already shipped a node**, zero false kills.

Three things that round cost:
1. **Measure the matte, not the photo.** The winning hoodoo source was a cluttered hillside with three
   mushroom rocks and a power line; matting left exactly one (`main` 0.984). A dirty photo is not a dirty
   input — and the converse holds too (a clean 3-chimney photo shattered into 6 components at 222 tris).
2. **Area share, not blob count.** A lattice water tower's legs are 4 blobs of *one* subject.
3. **Where statistics cannot separate, watch — do not tighten.** Balloons sat at 0.760 and a shipped water
   tower at 0.778. Narrowing the threshold to catch the balloons is overfitting to two samples; those cases
   go to a `*_screen_watch.png` sheet with their numbers, for the human pass.

**Thresholds carry a shape assumption — check it before applying a gate to a new family.** The original
`BLANK_COV` (canvas coverage) and `PRINT_FILL` (bbox fill = "the subject is a sheet of paper") were
calibrated on trees. Trees are dense blobs; a lattice tower is not, and *a building is a box*. Applied
family-wide as-is they would have killed four already-shipped sources (including the Devils Tower one).
Scope them to the calibrated families and demote them to the watch list elsewhere — do not simply drop
them, because what they catch (yearbook covers, near-empty mattes) exists in every family.

**The structural limit you will hit** (do not mistake it for bad wording): CC0 corpora are dominated by
*digitised museum and library holdings*. Per-species queries can hit their photo target in full and still
yield an 1832 lithograph, a 19th-century albumen print, a pressed herbarium sheet and a stereograph card —
all correctly licensed, all ≥1024 px, all statistically fine. `excluded_source` prunes pure-holdings
providers (rawpixel deliberately stays: it supplies both modern photography and public-domain prints).
**Do not loosen the CC0 regexes or the 1024 px filter to make a number move.**

---

## 2b. Route 0 — drawing→hull (`tools/ai3d/plan_to_mesh.py`)

```bash
python tools/ai3d/plan_to_mesh.py --front elev.png [--side s.png] [--plan p.png] --out raw.glb
python tools/ai3d/audit_plan_mesh.py                       # 21 assertions, no GPU/network
python tools/ai3d/audit_plan_mesh.py --break-outer          # must go red (9)
```

**"Outer surface only" is two things with one implementation**: take only the outermost contour
(windows, floor lines and partitions get filled in — those are texture, and filling them is also the
main triangle-budget lever), and emit only the envelope (no floors, no rooms). The rule is enforced in
**three** places — fill, `RETR_EXTERNAL`, and `prism` using `exterior` only. That redundancy is why a
reverse check that breaks only one of them **passes anyway**: break all three or the test proves nothing.

Three failure modes that produce no error, all measured:

1. **Every real drawing sheet has a border frame.** The obvious implementation — flood from the canvas
   edge, everything unreached is solid — measures *the sheet*, not the building (0.6678 → 0.7366 wide,
   mesh looks fine). Pick the outline by contour instead and drop near-canvas-sized candidates, but only
   while another candidate remains.
2. **A rendering is not a line drawing.** In a watercolour elevation the ink is *tone*, not outline, so
   the silhouette crumbles and highlights become holes. Ink density inside the contour separates them
   cleanly: HABS measured drawing 11.4%, four renderings 32–71%.
3. **Order the gates.** "Outline has a gap" must be checked *before* "this is a rendering" — a broken
   line's mask is the line itself, so its ink density is 100% and the error points at the wrong cause.

## 3. Route A — img→three.js (pure-data parts)

The photo is a **measurement reference**, nothing else. You extend the consumer's part rows in place.

1. Open the photos for that part; identify the real vocabulary (for a water tower: X-brace panels between
   horizontal struts, central riser, bottom ring, conical roof, finial).
2. Write the rows. Two engineering facts that already cost a debugging round:
   - **Tilted parts pay the 3D half-diagonal extent tax.** A true visual extent of ~4.3 m needed a nominal
     `foot` of 5.6. Keep `foot` honest anyway — `audit_beacons` checks it **both ways**: no under-report
     (A30), no padding (the landmark gets pushed needlessly far away).
   - **`buildBeacon`'s `stretch` scales a tilted part's *position* but not its *length***. Anchor braces on
     the vertical leg axes with an end margin; never on horizontal strut endpoints.
3. `foot` and colliders are **measured after** the rewrite, never carried over.
4. **Extent audits ignore y.** A centre-y doubling bug survived the full extent audit and was caught only by
   the screenshot loop. Shoot before/after every time.

Route A needs no Python, no GPU and no GLB — but it needs the same provenance row and the same review-board
pass as Route B, and its "original" pane is served from `git show <rev>:…`, so **record `baseline.rev`**.

---

## 4. Route B — local Blender (SF3D → GLB part)

```bash
# 1. matte  (venv, CPU is fine)
.venv/Scripts/python matte_photos.py tree sp_cypress

# 2. generate — batch everything; 13.6 s for 2 images means batching is ~free
.venv/Scripts/python vendor/stable-fast-3d/run.py <matte dir>/*.png \
    --texture-resolution 512 --remesh_option triangle --target_vertex_count 520

# 3. solidity prefilter (statistics)
node tools/ai3d/mesh_stats.mjs <sf3d out dir>

# 4. normalise (Blender 5.2 headless).  field separator is `|` — `:` collides with drive letters
blender --background --python tools/ai3d/normalize_parts.py -- \
  --base public/assets/models/parts/tree.glb \
  --out  public/assets/models/parts/tree.glb \
  --node "canopy_e5=<src.glb>|5.0x3.4|400|137|-0.12"
#         node name  ← source   ↑r x hy  ↑tri cap ↑ry° ↑dy

# 5. intake gate
node tools/ai3d/intake_parts.mjs
```

**Five things that are measured, not adjustable**

- **Use SF3D's own remesh; never hard-decimate its raw output in Blender.** A ~50k-tri shell tears into dark
  speckle holes at 50:1. Blender then only centres, scales and strips (a mild trim, e.g. 808→588, is fine).
- **`mesh_stats` filters shells, not content.** Blocky candidates sit at fill ≥ ~0.34, shells and flakes
  below 0.15. It is a *prefilter*: it happily ranks a lithograph and a stereograph double-card at the top.
  **The human-eye pass on the top few is not optional** — it caught six wrong-content meshes in one round.
  Expect ~1/15 usable from a CC0 pool; that ratio holds at both photo and mesh stage.
- **Centring, not "origin on the mating face", for stacked stone.** The fallback primitives are centred and
  the consumer's `p:` offsets assume that. Real boulders are flatter than an `ico`, so centring can leave a
  base stone hovering — that is what `dy` is for (put the underside at −`p.y` so it grounds at *every*
  `stretch`). Wall/roof-type modules with a genuine mating face are the exception.
- **Non-uniform fit (`"r x hy"`) for crowns and roots**; equal-ratio (`"r"`) keeps rock bit-identical. Fit a
  flat crown equal-ratio and it under-fills the vertical envelope, then the row's `sy` squashes it into a
  pancake.
- **`--base` when appending nodes.** Re-running an existing node re-runs decimation and scaling ⇒ bit drift
  in a part nobody meant to touch.

Also: same-source nodes get a yaw (`ry`) so two stones from one photo do not read as one stone twice.

---

## 5. Consumption seams (three forms — pick by consumer, do not invent a fourth)

```js
// beacons.js KIND_PARTS — declarative, resolved inside _geo()
{ g: ['lib', 'rock/facet_a', ['ico', 1.15]], … }          // g[2] = fuse = offline extent bound

// biomes.js VEG_DEFS / GIANT_DEFS — declarative, resolved at build time
{ g: ico(5), lib: 'tree/canopy_a5', y: 12, key: 'foliage' }
//   ↑ fuse stays and is what layout math reads

// biomes.js MEGALITHS / synthMegalith — imperative builder, guarded at the call site
const g = megaGeo('rock/mega_a') ?? primitive();          // MUST .clone() — bakeContactAO writes vertex colours in place
```

**Layout math reads the fuse `p.g`, never the library geometry.** `giantCrownR` / `vegSpan` feed
`planShyGrove` → blockers → every later placement; a GLB-derived radius varies with *load success*, so
scanning loaded geometry diverges the whole map per client with no error message (§2.3 / A4). The intake
envelope (GLB ≤ fallback, ≥ half) is what makes fuse-derived radii conservative. This is settled — do not
"fix" it into a vertex scan.

Same rule in the other direction: swapping geometry consumes **zero extra `rnd()`**, on both paths.

---

## 6. Triangle budget — measure the family before generating for it

`tri_budget.json` is a measurement record (`measured_what` / value / `factor` / `justification` /
`staleness`), never a hand-written number.

A per-part cap alone is a trap for multi-part families. A giant tree is 259–402 tris across 13–20 parts and
one canopy cluster is **20** — an AI part cannot be 20. Swap every canopy and each part passes while the tree
becomes 20×. So a family gets **two gates**: per part ≤ the heaviest whole unit today, **and**
Σ(library parts) per unit ≤ `kind_factor` × that unit's current total. Megaliths encode the same idea inside
the per-part cap because the max part count is directly countable from the builder's loop bounds.

`kind_tris` is a snapshot: **changing a consumer part table means re-measuring it**, or the gate admits
things against a stale baseline. Measurement method = playwright, executing the consumer's real source with
real three, summing `index.count/3`.

**Blocked on a missing measurement is a legitimate stopping point.** Do not write a plausible-looking cap to
keep moving.

---

## 7. Provenance — no record, not done

One row per generation job in `tools/ai3d/parts_manifest.json`: `method` (a key from
`provenance.mjs METHODS`), `consumer`, `rev`, `imgs[]` (id, licence, creator, query, source_url),
`gen` (tool, runner, params, machine, measured VRAM/seconds), `post`, and `baseline.rev` for Route A.

- A size ladder is **one** job baked at several scales ⇒ one row with `keys: [...]`. Twelve near-identical
  rows drift, and the stale ones still look fine.
- **Never copy derivable numbers** (extents, triangle counts, part counts) into it — they come from the
  consumer table and the GLB. A manifest once claimed "57 parts (was 12)"; the board derived 11.
- No record ⇒ the review board lists it under 未記載來源 and it does not count as done.

---

## 8. Acceptance

```bash
node tools/ai3d/intake_parts.mjs                       # envelope contract + triangle budget
node tools/audit_object_joints.mjs --seeds 8           # FLOAT / PARTIAL / DETACHED / ISOLATED
node tools/audit_beacons.mjs   && node tools/audit_beacons.mjs --break-extent
node tools/audit_siteplan.mjs  && node tools/audit_siteplan.mjs --break-shy
for a in cel_pipeline visual_prefs gpu_lifecycle soft_stroke; do node tools/audit_$a.mjs; done
npm test && npm run bal                                # presentation layer ⇒ MUST be bit-identical
node tools/audit_traverse.mjs                          # ㋓ network; new parts must not block routes
```

**Reverse verification is the acceptance, not the green run** (principle 9): if `--break-extent` /
`--break-shy` / a deliberately oversized node does **not** turn red, this round never tested anything.

**Visual closure** — two panes of the same seed, one camera:

```bash
npm run parts                       # 3D board :8622 — fuse vs library, collider overlay, provenance
node tools/shot_beacons.mjs         # landmark parts
node tools/shot_giants.mjs          # giant trees
node tools/shot_scene.mjs --venue taroko   # --ink=0 / --grade=0 / --post=0 isolate a layer
```

The board builds both panes with the game's own `buildBeacon` / `buildVegMeshes`. **`libGeo` is module
state, so every "original" pane must be built and cached *before* `loadPartLibs()`** — getting that order
wrong produces two identical panes, no error, and a confident wrong conclusion that the AI part looks much
like the original. Dev boards also need `<base href="/public/">`: asset URLs are relative, and without it the
library 404s and the "generated" pane quietly draws the fallback.

---

## 9. Failures that produce no error message

1. **Baking a finished prop** instead of parts → per-instance variation (seed / `stretch` / `partJitter`)
   disappears → the whole forest is identical.
2. **Layout math reading library geometry** → layout depends on load success → clients diverge.
3. **One extra `rnd()`** → every later placement on the map shifts.
4. **Shared library geometry mutated in place** → the second consumer gets another rock's baked AO. Clone.
5. **Statistically-fine, semantically-wrong inputs** (lithographs, herbarium sheets, stereograph cards,
   people in frame) → they pass licence, resolution and fill, and look like assets until you look.
6. **`--break-*` not run** → an audit round that proves nothing.
7. **Extent audits ignoring y** → vertical placement bugs survive the whole battery; only screenshots catch them.
8. **Raw `readFileSync` in an audit on a CRLF checkout** → per-line comment stripping silently fails and
   comments join the counts. Use `readSrc()` / `grabMethod()` from `tools/audit_src.mjs` (CLAUDE.md ㋑).
9. **A `lib:` row in a table the executable stubs cannot reach** (e.g. one that builds `THREE.TorusGeometry`
   directly) → never verified. `intake_parts` counts source `lib:` occurrences against parsed rows for this
   reason — and that counter must strip comments too.
10. **ESM `import` does not honour `NODE_PATH`** — a globally installed playwright needs `npm link`, and
    since this repo's `node_modules` is version-controlled (`ws` only, A2), the link must be reverted and
    gitignored or it reads as "this project depends on playwright".

---

## 10. Finishing a batch

Batches of ≤5 assets, full gate set per batch. Then, in this order:

1. `intake_parts` green, provenance row written, review board ticked 通過.
2. Update **`docs/ai3d_runbook.md`** — the status ledger row *and* a trial-log entry. Record what was
   measured (VRAM, seconds, usable ratio, budget numbers) and what is **not** done. A family that reached
   6 of 11 shapes is written as 6 of 11, not as complete; the ledger is the hand-off state and an optimistic
   row costs the next session a full rediscovery round.
3. Remaining interactive smoke (walk past the object at lane distance, 30 s steady-state frame time) is
   listed explicitly if it has not been run.
