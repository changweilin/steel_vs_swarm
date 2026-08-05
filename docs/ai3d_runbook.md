# AI 3D Asset Pipeline — Execution Runbook

> **Audience: AI agents.** This is the operational sequel to `docs/ai3d_asset_plan.md`
> (decisions + method split, esp. §8 Appendix A) and the two skills
> `.claude/skills/photo-to-prop-forge/` (static) / `.claude/skills/mech-part-forge/` (dynamic).
> Read those first; this file tells you **what to run next, where it can run, and how to prove it worked**.
> Update the Status Ledger and Trial Log below as you complete steps — this file is the hand-off state.

---

## 1. Status ledger (update on every completed step)

| Item | Status | Evidence |
|---|---|---|
| P1 seam (`public/js/partlib.js` + `beacons.js` `['lib', name, fallback]` + `main.js warmModels` preload) | **DONE 2026-08-05** | PR #127; `audit_beacons` 68 green, `--break-extent` reverse-red; full audit battery + `npm test` + `npm run bal` green |
| Photo fetcher `tools/ai3d/fetch_photos.mjs` (CC0 double gate, resumable, manifest) | **DONE 2026-08-05** | Same PR |
| Photo DB round 1 (GitHub Actions `fetch-photos.yml`) | **DONE 2026-08-05** | Run 30973968007 success: **35 photos, all CC0/PD**, artifact `photo-db` id 8917619002 (63 MB, expires 2026-09-04) |
| Photo DB gap-fill (parts at 0, see §4 step A) | **DONE 2026-08-05** (3060 local run, not Actions — see Trial Log) | Broadened queries + 3 fetcher fixes; **all 14 parts at target** (55 photos), licence re-audit 55/55 CC0/PD; throttle-cooldown loop needed 3 extra rounds for `lattice`/`tank` |
| Photo DB integrity pass (magic-bytes gate + manifest path portability) | **DONE 2026-08-05** (§5d) | 2 whole PDFs had passed the licence audit as `ok` photos (bytes, not licence, was the lie) — de-booked, deleted, refetched; 28 absolute-path manifest rows migrated to relative POSIX; final audit **61/61 ok = real image + file present + CC0/PD**, all 14 parts at target |
| P2b pilot — LLM-written pure-data parts (regular geometry) | **DONE 2026-08-05** | `tank` (watertower) KIND_PARTS rewritten: 2-segment legs, central riser, 2 X-brace panels ×4 faces, 3 drum ribs; foot 5.2→5.6 (measured 5.56); `audit_beacons` 68 green + `--break-extent` red; `audit_object_joints --seeds 8` 0 anomalies; `npm test` green (fresh worktree server, WS_URL=8666); `npm run bal` **bit-identical** (diff vs pre-change baseline); before/after lane-distance renders with collider overlay |
| P2c pilot — img→3D GLB parts (organic geometry) | **DONE 2026-08-05** (§5e; gate opened same day) | `public/assets/models/parts/rock.glb` shipped: 3 nodes (`collapse_a`/`facet_a`/`facet_b`, 938/882/588 tris) consumed by beacons `cairn` via `['lib', …]`; SF3D measured on the 3060 (peak VRAM 6.17 GB, warm 13.6 s / 2 images); intake 14/14; `audit_beacons` 68 + reverse-red; `audit_object_joints --seeds 8` 21311/0; cel 52 / visual_prefs 124 / gpu 54 / siteplan 168; e2e green; bal green (structurally bit-identical — balance tooling imports neither beacons nor partlib); fallback-vs-lib renders with collider overlay (`tools/shot_beacons.mjs`) |
| biomes consumption-loop seam (`p.lib` field; plan §8 correction 1) | TODO — **unblocked** (P2c shipped rock parts 2026-08-05); next in queue before any `MEGALITHS`/`VEG_DEFS` consumer | — |
| `giantCrownR` GLB-compat (vertex scan or metadata; plan §8 correction 1) | TODO — **hard blocker for canopy GLBs** | — |
| P3 dynamic track (mech slots) | NOT STARTED | Plan §3; do not start before P2c passes |

## 2. Environment matrix (measured 2026-08-05 — do not rediscover, trust this)

| Environment | Can do | Cannot do (measured) |
|---|---|---|
| **CC sandbox** (this repo's remote sessions) | All offline audits; e2e (`node server/server.js` then `npm test`); `npm run bal`; editing + push; GitHub MCP (PR/Actions API); HF MCP (search + the curated `dynamic_space` roster) | Egress to `api.openverse.org` / `commons.wikimedia.org` / `huggingface.co` / `upload.wikimedia.org` / `*.blob.core.windows.net` — all CONNECT 403 ⇒ **no photo ingress, no artifact ingress, no HF gradio calls**. No GPU (`nvidia-smi` absent). Raw `api.github.com` REST is gated (MCP tools work; `curl` with `$GITHUB_TOKEN` returns "GitHub access is not enabled") |
| **GitHub Actions** (ubuntu runner) | Open egress ⇒ photo fetching (proven, run 1); licence re-audit; artifact publishing | No GPU. SF3D weights are licence-gated on HF ⇒ inference here would need an `HF_TOKEN` secret **which only the repo owner can add** — do not attempt without it |
| **User's RTX 3060 12 GB machine** | The whole model ladder (plan §1): **SF3D proven 2026-08-05** (weights local, peak VRAM 6.17 GB, warm 13.6 s / 2 images) / Hunyuan3D 2.1 shape-only 10 GB / TRELLIS.2 (measure first); Blender 5.2 LTS (headless normalise proven); `agy` 2D; **photo fetching (open egress — measured 2026-08-05; step A does not need Actions)**; `uv 0.5.30` present | Python 3.13 is system default — the model stack lives in the **3.11 venv** at `<data home>/tools/ai3d/.venv` (never in `package.json`, A2; data home = worktree `zen-albattani-b33990`, §5d). **Wikimedia IP throttle**: bulk original-size downloads from `upload.wikimedia.org` trip HTTP 429 with `Retry-After: 600` after ~30 images, then ~2–3 images per 10-min window; most Openverse CC0 results are Wikimedia-hosted, so this throttles both APIs' downloads (search quota itself is fine — 200/day anon, measured) |
| **HF Spaces** | `stabilityai/stable-fast-3d` (official gradio Space) as no-GPU fallback — drive it from a machine that can reach `huggingface.co`, i.e. the 3060 box or a browser; **not** from the sandbox | The HF MCP `dynamic_space` roster has **no mesh-generating space** (checked: only image/video/audio tools; `stabilityai/stable-fast-3d` is not MCP-enabled → HTTP 404 via MCP) |

**Consequence an agent must internalise**: photos and GLBs cannot pass through the sandbox.
The sandbox's role is seams, tools, audits, docs, and PRs. Anything touching pixels or meshes runs on
the 3060 (or Actions for photo fetching only).

## 3. Fixed rules (violating any of these = revert, no discussion)

1. **Parts, never finished props** — assembly/variation stays in existing code (skill §0; plan §2).
2. **CC0/PD only, photos never enter the repo** — only part-library GLBs do (plan §4.1; `.gitignore` has `tools/ai3d/photos/`).
3. **Fuse stays** — `['lib', name, <fallback primitive>]`: the fallback descriptor is the degradation path AND the offline extent bound. Export tooling MUST reject a GLB part whose measured extent exceeds its fallback's extent (encoded in `partExtent`, `partlib.js` header).
4. **Zero extra `rnd()` consumption** when swapping geometry (CLAUDE.md §2.3 / A4).
5. **`markShared()` for library geometry; consumers that mutate must `.clone()`** (A25; `beacons._geo` does).
6. **Geometry + base colour only** — no normal/metal/roughness maps (CLAUDE.md §1).
7. **Triangle budget derived from measured current values**, never hand-written (plan §2.1-6).
8. **Method split by geometry class** (plan §8 Appendix A): regular/man-made → LLM-written pure-data part rows; organic → img→3D GLB; small vegetation → stays procedural; mechs → Track A only.

## 4. Execution queue (in order; each step names its environment)

### A. Photo gap-fill — env: GitHub Actions — ~15 min
Round 1 left these at/below half: `rock/collapse 0/4`, `rock/talus 1/4`, `landmark/lattice 1/4`,
`landmark/tank 0/3`, `building/window 1/4`, `building/roofcap 0/4`.
Root cause is almost certainly query wording + the ≥1024 px short-side filter, not supply.

1. Edit `PHOTO_CATALOG` queries in `tools/ai3d/fetch_photos.mjs` for the deficient parts
   (broader nouns, e.g. `"water tower"`, `"rooftop parapet"`, `"fallen boulder"`; keep 2–3 queries/part).
2. Push to the dev branch (path-filtered auto-trigger) **or** dispatch `照片庫抓取` manually
   (`workflow_dispatch`, inputs `family`, `limit`).
3. Success = `--plan` step shows all parts at target, licence re-audit step green, new `photo-db` artifact.
4. Do **not** loosen the CC0 regexes or the 1024 px filter to make numbers move.

### B. P2b pilot — LLM-written parts for one landmark — env: 3060 (or any machine with the photo artifact) — ½ day
Target: `watertower` (or `pylon`) in `public/js/beacons.js KIND_PARTS` — the plan's P2 pilot family.

1. Download the `photo-db` artifact; open the `landmark/tank/*` photos.
2. Rewrite/extend that kind's part rows (pure primitives, richer silhouette: tank ribs, riser legs,
   cross-braces) using the photo as **measurement reference only**. Keep nominal `foot` honest — the
   audit checks it **both ways** (no under-report, no padding).
3. Gates: `node tools/audit_beacons.mjs` (+ `--break-extent`), `node tools/audit_object_joints.mjs --seeds 8`,
   `npm test`, `npm run bal` (must be bit-identical — this is presentation-layer),
   then in-game smoke: the landmark reads better at lane distance, collider matches visuals.
4. This pilot needs **no Python, no GPU, no GLB** — it is the cheapest end-to-end proof of the method split.

### C. P0 + P2c pilot — first GLB parts (rock family) — env: 3060 — 1–2 days
1. **P0 (unchanged from plan §6)**: `tools/ai3d/.venv` with Python 3.10/3.11; install SF3D first;
   measure VRAM + seconds; record in this file. Fallback chain: SF3D → keep procedural.
   (TRELLIS/Hunyuan can wait; rocks do not need them.)
2. Pick 2–3 `rock/facet` photos from the artifact → `rembg` matte → SF3D → Blender headless:
   decimate, **origin on the mating face**, +Y up, strip textures, export
   `public/assets/models/parts/rock.glb` with named nodes (`facet_a`, `facet_b`, `collapse_a`).
3. Write the intake checker (extend `tools/ai3d/`): measures each GLB part's extent, verifies
   ≤ its fallback descriptor's extent, verifies triangle budget vs measured current rock triangle count.
4. Wire consumption: add `'rock'` to `PART_LIBS` in `public/js/partlib.js`; **beacons-style consumers
   only** at first. For `MEGALITHS`/`VEG_DEFS` (biomes), first implement the consumption-loop seam
   (plan §8 correction 1: optional `p.lib` next to `p.g`, resolved at build time — module-scope
   `libGeo()` can never work; and solve `giantCrownR` before ANY canopy part).
5. Gates: full static battery (skill §5) — `audit_object_joints --seeds 8`, `audit_beacons` ±reverse,
   `audit_traverse`, `audit_cel_pipeline`, `audit_visual_prefs`, `audit_gpu_lifecycle`,
   `npm test`, `npm run bal` (bit-identical), `shot_scene.mjs --venue taroko` before/after,
   30 s steady-state frame-time (desktop + touch emulation).

### D. Scale-out static (only after B and C are both green)
Batches of ≤5 assets, full gate set per batch (plan §6). Order: megalith facets → landmark upgrades
(mixed method) → building modules (LLM parts) → giant-tree parts (**after** `giantCrownR` fix).

### E. Track A dynamic (plan §3/P3–P4) — env: 3060 — unchanged
Do not start before D's first batch ships; the rig contract makes failures 10× more expensive.

## 5b. Trial log (2026-08-05, 3060-machine session — step A + step B)

- **Step A ran locally, not on Actions** (allowed by §2: the 3060 box has open egress; faster feedback
  and photos land exactly where B/C consume them). Round-1 `photo-db` artifact downloaded into
  `tools/ai3d/` first so the resumable manifest semantics hold.
- **429 root cause measured**: Openverse *search* quota is healthy (`x-ratelimit-available-anon_sustained: 199/200`);
  the failures are *downloads* from `upload.wikimedia.org` (Varnish edge, `Retry-After: 600`) — most
  Openverse CC0 hits are Wikimedia-hosted originals of several MB. After ~30 downloads the IP is
  throttled; each subsequent 10-min window admits ~2–3 more.
- **Three fetcher fixes** (all in `tools/ai3d/fetch_photos.mjs`):
  1. `seen` now counts only `ok` entries — transient failures no longer permanently block a photo
     (old behaviour contradicted the header's "resumable" promise: one throttled run blackballed
     every candidate it touched).
  2. Commons fallback now also fires when Openverse *returned results but every download failed*
     (previously only on zero results — an entirely-throttled query never degraded).
  3. HTTP 429 ⇒ early-exit the whole round (`cooled` flag) and **do not write the failure to the
     manifest** (it is the round's network state, not a fact about the photo); 179 stale 429 rows
     pruned from the manifest.
- Gap-fill result: **all 14 parts at target** (55 photos, licence re-audit 55/55 CC0/PD). The last
  four photos (`lattice` 1, `tank` 3) needed a cooldown-retry loop (~11 min/round, 3 productive
  rounds) — budget for that whenever bulk-fetching from this IP again.
- Tank photo cross-check (after the rewrite landed — throttle delayed the photos): the Dallas-type
  four-leg tower photo confirms the part vocabulary (X-brace panels between horizontal struts,
  central riser, bottom ring, conical roof + finial). One deliberate deviation: legs stay vertical
  (two-segment taper) instead of splaying — the tilted-part extent tax is documented in the
  part-table comment.
- **P2b executed** (§4-B): `tank` rewritten as 57 pure-data parts (was 12). Two engineering notes
  now recorded in the part table's comment: ① tilted parts pay the 3D-half-diagonal extent tax
  (foot 5.2→5.6 for a true visual extent of ~4.3); ② `buildBeacon`'s `stretch` scales tilted parts'
  *position* but not *length* ⇒ X-braces must anchor on the vertical leg axes (+0.18 m end margin),
  never on horizontal strut endpoints. A centre-y doubling bug in the brace math survived the extent
  audit (extent ignores y) and was caught only by the **screenshot loop** — keep shooting before/after.
- **SF3D licence gate probed**: `hf` CLI (logged in as `winniexchang`) cannot see gated
  `stabilityai/stable-fast-3d` ⇒ owner must accept the licence on HF (and the token must allow
  gated-repo read) before P0 venv work is worth starting. Blender also absent (owner install).

## 5c. Trial log (2026-08-05, 3060-machine session — step C prep after owner unblocked installs)

- **P0 environment fully built** (weights are the only missing piece):
  `tools/ai3d/.venv` = uv-provisioned CPython 3.11.11; torch **2.5.1+cu121** (`cuda.is_available()` ✓
  on the 3060); all SF3D requirements; **both native extensions compiled on Windows**
  (`texture_baker`/`uv_unwrapper` real `_C.cp311-win_amd64.pyd`, ~34 s / ~14 s builds, VS2022
  Community + CUDA toolkit 12.6, `uv pip install --no-build-isolation` after `uv pip install
  setuptools wheel ninja` — uv venvs ship without pip/setuptools). `from sf3d.system import SF3D` OK.
  Blender **5.2 LTS** installed via winget. Vendor clone + venv + weights dirs are gitignored.
- **SF3D weights still 403** after the owner reported accepting the licence — the API answer is
  "not in the authorized list" for the `winniexchang` token (x111281@gmail.com). Public files
  (LICENSE/README) download fine ⇒ the token works; the *grant* is missing. Accept on
  https://huggingface.co/stabilityai/stable-fast-3d while logged in as that exact account.
- **HF Space fallback measured and rejected**: the official `stabilityai/stable-fast-3d` gradio
  Space is a *stateful event chain* — `/run_button` via `gradio_client` raises a hidden upstream
  exception, and `/requires_bg_remove` returns a UI-update dict, not a model (session state the API
  client never populates). Do not budget time on driving it headlessly; plan §8's "Space fallback"
  is browser-manual only.
- **Photo pool quality finding (the big one for Track B)**: numeric targets ≠ usable inputs.
  Human review of every rock candidate: **~1/15 usable** for image→3D — the CC0-only corpus is
  dominated by museum scans, stereograph cards, watercolours, night shots and scene photos
  (licence gate stays; this is an input-curation problem, not a licence problem). Two remedies that
  worked, in order: ① **query for named single-object landforms** — `glacial erratic` returned a
  33 MP, frame-filling, evenly-lit single boulder (now `rock/collapse ov_4a7de829`, the pilot's
  primary input); ② **crop single subjects out of scene photos** (still CC0) — `facet_a_crop.png`
  from `ov_92b0`'s left boulder. Also: one Commons "photo" was a 148-page **PDF** (fetcher should
  gain a magic-bytes/MIME check some round).
- **Intake checker + measured triangle budget shipped** (runbook C.3 done ahead of the GLB):
  `tools/ai3d/intake_parts.mjs` executes the beacons pure block for `['lib', name, fallback]`
  descriptors, parses GLB by hand (zero npm deps), verifies vertex extents fit the fallback
  envelope **both ways** (over = A30, under-half = bloated upper bound) and triangle count ≤
  `tri_budget.json` (measured: synthMegalith across 200 seeds min 85 / p50 380 / p90 548 /
  **max 1071**, factor 1.0 with recorded justification).
- **Next single action when the gate opens**: `hf download stabilityai/stable-fast-3d --local-dir
  tools/ai3d/weights/sf3d` → run one image through `vendor/stable-fast-3d/run.py` (venv python,
  `--texture-resolution 512`), record VRAM/seconds here → Blender headless normalise (origin on
  mating face, +Y up, strip textures, named nodes `facet_a`/`collapse_a`) → intake checker →
  wire `PART_LIBS = ['rock']` + cairn `['lib', …]` descriptors → full static battery.

## 5e. Trial log (2026-08-05, 3060-machine session — P2c executed: first GLB parts shipped)

- **Gate opened** (owner accepted the licence) → weights downloaded (4.02 GB, ~6 min).
  **Measured**: cold run 3 m 02 s (includes one-time dinov2/CLIP aux downloads), **warm run 13.6 s
  for 2 images end-to-end, peak VRAM 6.17 GB** at `--texture-resolution 512` — comfortable on the
  12 GB 3060; plan §1's "SF3D 6 GB" confirmed.
- **Do not decimate raw SF3D output in Blender** — the ~50k-tri shell tears into dark speckle
  holes at 50:1 ratios (first attempt, visible in the screenshot loop). Use SF3D's own
  `--remesh_option triangle --target_vertex_count 520` → clean solid ~944/808-tri meshes straight
  out; Blender then only centres/scales/strips (its decimate stays as a mild safety trim, e.g.
  808→588 for the 0.85 m node — harmless at that ratio).
- **Input curation is a mesh-level fact, not just a photo-level one**: batched all 15 matted rock
  candidates through SF3D (13.6 s… batching is ~free) and contact-sheeted the meshes — only
  **5/15 solid** (indices 2/6/8/9/11); crops-from-scene-photos (`facet_a_crop`) and museum-scan
  survivors all came out as thin shells or flakes. §5c's "~1/15 usable" holds at the mesh stage
  too; the reliable route stays "named single-object landform" queries. Batch + contact sheet is
  now the standard pick flow (render script kept in scratchpad; promote if reused).
- **Final picks** (node = consumer role, photo family ≠ node name): `collapse_a` ← batch 6
  (facet `ov_f7e1cc51`, blocky), `facet_a` ← batch 11 (collapse `ov_62d21e5a`, lumpy),
  `facet_b` ← batch 8 (collapse `ov_0012000f`, smooth, +137° yaw for same-source disguise).
- **`normalize_parts.py` shipped** (tools/ai3d): centre-to-origin + envelope-fit (FIT 0.95) +
  strip materials/UV/colour + optional per-node `ry`/`dy`. `dy` exists because real boulders are
  flatter than the fallback ico — centring left the base stone hovering 12 cm; `dy −0.12` puts its
  underside at −0.9 = the consumer's `p.y`, so it grounds at **every** stretch value (`py·s − hy·s`).
  Field separator is `|` (`:` collides with Windows drive letters).
- **Wiring**: `PART_LIBS = ['rock']`; cairn's three stack stones → `['lib', 'rock/…', ['ico', r]]`
  with the old ico as fuse. `foot` untouched — `partExtent(lib) ≡ fallback extent` by contract.
- **Gates all green**: intake 14/14; `audit_beacons` 68 + `--break-extent` reverse-red;
  `audit_object_joints --seeds 8` 21311 joints / 0 anomalies; cel 52 / visual_prefs 124 / gpu 54 /
  siteplan 168; e2e green (fresh server on 8666, user's 8620 servers untouched); bal green and
  structurally bit-identical (balance tooling imports neither beacons.js nor partlib.js nor the GLB).
  **Visual closure** via new `tools/shot_beacons.mjs`: same seed shot twice — fuse path (no
  `loadPartLibs`) renders the old all-ico cairn, lib path renders the three AI rocks solid and
  grounded, collider cylinder overlaid (r 2.28 unchanged — set by the untouched scatter stone).
- **`audit_traverse` ran on the 3060** (first time on this machine; warm `.scen_cache` copied from
  the main checkout): **89 pass / 20 fail — and the failure set is line-for-line identical at the
  pre-change commit 2c1d123** (A/B in the zen-albattani worktree, same cache). So it is a
  **pre-existing baseline red** (bridge mid-deck / underpass-interior waypoints unreachable in 14
  venues + several collapsed bridge-clearance readings, e.g. 0.45 m), not something this change
  introduced — structurally it cannot be: traverse's pipeline (venue_field/terrain/biomes flood)
  never touches beacons/partlib/the GLB. Tracked as its own issue outside this runbook.
- Remaining smoke (interactive, next real-game session): walk past a cairn in taroko + 30 s
  steady-state frame time. Expected delta is negligible: +~2.2k tris per cairn, merged into the
  same colour buckets (draw-call count unchanged), few cairns per map.

## 5d. Trial log (2026-08-05, 3060-machine session — gate re-probe + photo-DB integrity)

- **SF3D gate re-probed: still closed.** Token itself is healthy — `whoami-v2` shows a classic
  `read`-role access token ("WillyRnnoise") on `winniexchang`, public files (LICENSE/README)
  download fine — but `model.safetensors` returns 403 *"you are not in the authorized list"*.
  The repo is **`gated: auto`** ⇒ clicking "Agree" on the model page while logged in as
  `winniexchang` grants instantly, no human review. Whatever was accepted earlier landed on a
  different account or was never submitted. When it opens, resume at §5c's "next single action".
- **Data home recorded** (hand-off state): the gitignored ai3d working set (`.venv`, `photos/`,
  `photo_manifest.json`, `vendor/stable-fast-3d`, `weights/`, `out/matte`) lives in worktree
  **`.claude/worktrees/zen-albattani-b33990/tools/ai3d/`** — the venv has absolute paths, do not
  move it; run the fetcher from that copy (data is keyed off the script's own dir).
- **Magic-bytes gate shipped** (the §5c "fetcher should gain a magic-bytes check" item):
  `sniffImage()` accepts JPEG/PNG/WebP header bytes only; a non-image download now books
  `ok:false` (it is a fact about the file, same rule as 404 — unlike 429 which never books)
  and never lands on disk. Extension and Content-Type are both untrusted.
- The pool scan found the predicted corruption **already inside the "green" DB**: two whole
  Internet Archive book-scan **PDFs** booked as `ok` rock/facet photos (7 MB + 25 MB,
  `wc_91723690` / `wc_93938159`) — the licence audit passes them because *Public domain is true*;
  only the bytes reveal the lie. De-booked, deleted, refetched → **all 14 parts back at target,
  61 ok entries, 61/61 real image + file present + CC0/PD**.
- **Second fetcher bug caught by the same scan**: `entry.file` was made relative by
  `replace(HERE + '/', '')`, which is separator-sensitive ⇒ on Windows it silently no-oped and
  the manifest recorded **absolute paths of whatever worktree ran the fetch** (28 rows; the
  Actions/Linux rows were fine — why round 1 never showed it). Fixed with `path.relative` +
  POSIX separators; the 28 rows migrated. Portability moral: the artifact/manifest must never
  encode the machine it was fetched on.

## 5. Trial log (2026-08-05, sandbox session)

- Actions run 1 (`fetch-photos.yml` #30973968007): 118 manifest entries, 35 ok, **0 licence violations**,
  63 MB artifact. Per-part tallies in §4-A.
- HF Space route probed from sandbox: `dynamic_space` requires MCP-enabled spaces;
  `stabilityai/stable-fast-3d` is not (404); the curated roster contains no image→mesh tool.
  ⇒ Space fallback must be driven from the 3060/browser, not from sandbox MCP.
- Artifact ingress to sandbox probed: MCP hands out a signed `*.blob.core.windows.net` URL; proxy 403.
  Raw `api.github.com` REST with the session token: "GitHub access is not enabled for this session".
  ⇒ recorded in §2; do not burn time re-testing.

## 6. Open questions for the repo owner (do not guess)

1. Add an `HF_TOKEN` repo secret (with SF3D licence accepted) if CPU inference in Actions should ever
   be attempted; otherwise all inference stays on the 3060.
2. `fetch-photos.yml`'s push trigger is pinned to branch `claude/photo-db-img-to-3d-8j9tbe`;
   after PR #127 merges, keep only `workflow_dispatch` (edit the `on:` block) or repoint the branch.
3. ~~Accept the SF3D licence~~ — **RESOLVED 2026-08-05** (owner accepted on `winniexchang`;
   weights downloaded, P2c executed same day, §5e).
4. ~~Approve installing Blender~~ — **RESOLVED 2026-08-05** (Blender 5.2 LTS via winget, §5c).
