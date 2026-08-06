# AI 3D Asset Pipeline — Execution Runbook

> **Audience: AI agents.** This is the operational sequel to `docs/ai3d_asset_plan.md`
> (decisions + method split, esp. §8 Appendix A) and the skills
> `.claude/skills/photo-to-prop-forge/` (static contract) / `.claude/skills/mech-part-forge/` (dynamic) /
> **`.claude/skills/photo-to-3d-pipeline/` (the procedure: photo sourcing → route by geometry class →
> img→three.js parts or local Blender GLB → gates)**.
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
| biomes consumption-loop seam (`p.lib` field; plan §8 correction 1) | **DONE 2026-08-05** (§5f) | `partGeo(p) = (p.lib && libGeo(p.lib)) \|\| p.g` in `buildVegMeshes` (draw only; no `lib:` rows yet ⇒ frame bit-identical); pinned by `audit_siteplan` Ⅴ (+3 assertions, manual reverse-verify both red modes); full battery green |
| `giantCrownR` GLB-compat (plan §8 correction 1) | **DONE 2026-08-05 — by contract, zero code change** (§5f) | Vertex scan would be a determinism bug (layout ← load state, §2.3); layout math pinned to the fuse `p.g` (audit red if it touches `libGeo`/`partGeo`/`.lib`); intake envelope makes fuse crown radii conservative. Canopy GLBs unblocked |
| 3D 零件對照台 (`tools/parts_review.mjs` + `tools/ai3d/parts_manifest.json` provenance ledger) | **DONE 2026-08-05** (§7) | Settings-page dev tool (`npm run parts`, port 8622); generated-vs-original side by side from the **real** `buildBeacon`; states method + source img per part. Found two silent bugs on first run — see §7 |
| **D-1 static scale-out — 綠地首批(神木樹冠)** | **DONE 2026-08-05** (§5g) | `tree.glb` 12 nodes (4 shapes × size ladder 10/8/7/6/5/4.5/3.5, 212–215 tris each) consumed by **biomes** `GIANT_DEFS` via the `lib:` field — 25 rows across 9 of 11 species; intake extended to the biomes consumer (113 green, reverse-red); `audit_siteplan` 171→174 (both new gates reverse-red); object_joints 21311/0; beacons 68 + reverse-red; soft_stroke 73 / cel 52 / visual_prefs 124 / gpu 54; e2e green (fresh server :8666); `npm run bal` green (⑦f 1.63× unchanged); review board extended to biomes (16 rows, 0 gaps) with side-by-side render |
| **D-2 megalith seam — 巨岩呼叫點守衛 + 首批低面數岩塊** | **DONE 2026-08-05** (§5h) | `biomes.js MEGA_LIB` 名冊 + `megaGeo`(一律 clone,bakeContactAO 就地烤頂點色)5 呼叫點(marble 塊/崩落塊/伴生丘/hoodoo 整柱/疊石);`rock.glb` +3 單位包絡節點 `mega_a/b/c`(284/272/274 tris);`families.megalith` 逐件上限 306 = 4×1071÷14(推導);intake 125 green + bogus-node reverse-red;siteplan 176 + reverse-red;object_joints 21311/0;beacons 68 ± reverse;gpu/cel/visual_prefs/soft_stroke green |
| Photo catalog round 5 — 逐樹種大擴充(使用者定案「大量下載不同樹種」) | **IN PROGRESS 2026-08-05** | +12 tree-species rows / +4 rock kinds / +4 img→3D-friendly building modules;fetcher 改**逐主機**節流 + `excluded_source` 排館藏(§5h)+ 樹種列優先;4 輪抓到 sequoia/baobab/maple/cypress/strata/chimney/rooftank **7 個零件達標**,conifer/pine/willow/banyan/tropical/karst/acunit/dormer 待續 |
| **D-3 逐樹種冠簇拆分(第一步)** | **PARTIAL 2026-08-05** (§5h) | `tree.glb` +6 節點(e/f 兩形 × 3 尺寸階):dougfir/sitka/taiwania 三種原本共用 `canopy_d35` **一顆**,現各有自己的冠形;sequoia/meranti 各多接一列原本無 lib 的 ico。**4 形 → 6 形,不是 11 形** —— 卡在語料而非管線,見 §5h |
| P3 dynamic track (mech slots) | **BLOCKED on agy quota**(2026-08-05 §5h) | t01 七槽兩輪全 429 RESOURCE_EXHAUSTED(gemini-3.1-flash-image);`--no-ref` 也一樣 = 模型級額度。models.js 刻意續留不動(無真零件可校準的縫 = 10× 貴的失敗)。額度重置後:`node tools/ai3d/gen2d.mjs --only t01 --no-ref --limit 7` |
| **D-4 建築族首批 — 屋頂配件桶幾何縫 + families.building 預算量測** | **PARTIAL 2026-08-06** (§5i) | 使用者定案「大量下載不同國家、城市、小鎮、風格的建築物照片,再 img→3D;無視舊有物件直接畫,禁止使用原版重繪」。`families.building` 預算**先量測後生成**(新工具 `measure_building_tris.mjs`,shibuya/manhattan/seoul 三場 --live 實測;InstancedMesh 桶的逐桶節點上限由 instance 上界反推);`building.glb` 首批 2 節點(`chimney_a` 220 tris / `ac_a` 402 tris)接進 `BLD_LIB` + `buildBldBucket` 桶建構表(零 rnd、draw call 不變);照片目錄 +19 列(module + 17 國家/風格整棟列),第 1 輪收 55 張;**tank_a 未出貨**(候選全是場景照/有人入鏡,等 tank_wood 冷卻輪);對照台 + intake + audit_siteplan(184,含反向)+ bal 全綠 |

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
9. **Every generated object carries a provenance record** — one row in `tools/ai3d/parts_manifest.json`
   naming **which method** (key from `tools/ai3d/provenance.mjs METHODS`) and **which img**
   (id + licence + source URL). No record ⇒ the review board lists it under 未記載來源 and it is not
   done. Never copy derivable numbers (extents, triangle counts, part counts) into that file —
   they come from the consumer part table and the GLB itself.

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
   then the review board (§7): add the provenance row, look at old-vs-new side by side, tick 通過.
   In-game smoke: the landmark reads better at lane distance, collider matches visuals.
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
6. Provenance + review: `node tools/ai3d/intake_parts.mjs` must be green **and** the part needs its
   row in `parts_manifest.json` (method + img) before the review board (§7) counts it as done.

### D. Scale-out static (only after B and C are both green)
Batches of ≤5 assets, full gate set per batch (plan §6). Order: megalith facets → landmark upgrades
(mixed method) → building modules (LLM parts) → giant-tree parts (**after** `giantCrownR` fix).

**D-1 giant-tree canopies: DONE 2026-08-05** (§5g). What the next batch inherits from it:
1. **Measure the family before generating for it.** The per-part cap that fits rocks was meaningless
   for trees; the gate that mattered (per-species total) did not exist until the measurement did.
   Any new family gets its own `tri_budget.json families.<fam>` entry, measured, before wiring.
2. **Match the AI part to the fallback's *shape*, not to the slot's name** — `ico` rows only, because
   the envelope is what the offline contract checks. A `cone`/`box` row needs a part generated to that
   proportion, not a blob squeezed into it.
3. Remaining tree work: `buttress` + `fork` nodes (photo supply still short — Wikimedia PDFs/429s),
   then `VEG_DEFS` ordinary trees (**check the draw-call and triangle maths again**: ordinary
   vegetation has orders of magnitude more instances than the handful of giant trees).

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

## 5f. Trial log (2026-08-05, 3060-machine session — biomes seam + giantCrownR resolution)

- **Seam shipped**: `biomes.js` now imports `libGeo`; a single build-time resolver
  `const partGeo = (p) => (p.lib && libGeo(p.lib)) || p.g;` sits next to `vegSoftKind`, and
  `buildVegMeshes` draws `partGeo(part)`. That is the **entire** code change (plus comments) —
  no `lib:` rows exist in any table yet, so today's frame is bit-identical, same as P1's landing.
- **The `giantCrownR` "hard blocker" dissolved by contract, not by code** — and the plan's own
  proposed fix (vertex scan) turned out to be a latent bug: crown radius feeds `planShyGrove`
  (shrink + lean) → items → blockers → `blocked` cells → every later placement. A GLB-derived
  radius varies with **load success**, so scanning loaded geometry would diverge the whole layout
  per client (§2.3) with zero error message. Resolution: **layout math (`giantCrownR`, `vegSpan`)
  reads the fuse `p.g` only**; the intake envelope (GLB ≤ fallback, ≥ half) makes fuse-derived
  radii conservative — gaps err wider (原則 6), canopy shyness never under-spaces. Canopy GLBs
  are unblocked with `giantCrownR` untouched. Plan §8 correction 1 annotated so nobody
  "re-fixes" it into the scan.
- **Audit support** (原則 9): 3 new assertions in `audit_siteplan` Ⅴ — ① exactly one `libGeo(`
  call in biomes and it is `partGeo`'s definition; ② the veg loop draws `partGeo(part)`;
  ③ `giantCrownR`/`vegSpan` stripped source contains no `libGeo`/`partGeo`/`.lib`.
  Reverse-verified both ways (crown reading `partGeo` ⇒ ③ red; a second inline `libGeo` call in
  the loop ⇒ ①② red). 168 → 171 items.
- **CRLF found a real audit bug**: `audit_road_joint` red'd "dropLaneBridges 恰一份實作一個呼叫點"
  on this machine — **pre-existing, not this change** (A/B: HEAD content converted to CRLF reds
  identically; `git show` LF content passes). Root cause is the exact ㋑ trap: it used raw
  `readFileSync`, and this workspace is CRLF-checked-out (`core.autocrlf=true`) ⇒ per-line
  `//.*$` comment-stripping silently fails ⇒ a comment mentioning `dropLaneBridges(` joins the
  count. Fixed to `readSrc` (86/86 green). ~22 more audits still use raw `readFileSync` and may
  be silently *weaker* on CRLF — spun off as its own task (chip), do not fold into this branch.
- **Gates** (this machine, CRLF workspace): siteplan 171 (+ both reverse modes red);
  soft_stroke 73; beacons 68 + `--break-extent` reverse-red; object_joints `--seeds 8`
  21311/0; gpu 54; cel 52; visual_prefs 124; open_tunnel 159; underpass 155; road_joint 86;
  climb 211; ground_qc/seam/enclave, terrain_ray 11, bridge_crossing 16, water_skirt 8,
  bridge_tower_pad 23, road_bed 16, world_text 57, vernacular 287 — all green. `npm run bal`
  green (balance tooling imports neither biomes nor partlib). e2e on a fresh worktree server
  (port 8666, user's 8620 untouched): green.
- **Next consumer note** (queue D): `MEGALITHS`/`synthMegalith` are imperative builders running at
  biome-build time — they need **no seam**, just guarded `libGeo('rock/…') ?? primitive` at the
  call site (zero extra `rnd()` either way; no in-place geometry mutation ⇒ no clone). The
  declarative seam above covers `VEG_DEFS`/`GIANT_DEFS`/`GIANT_DECO`. Road props / civic parts
  stay LLM-parts territory (method split) — do not extend `partGeo` there.

## 5g. Trial log (2026-08-05, 3060-machine session — queue D first batch: giant-tree canopies)

First consumer outside beacons. What was actually new (the rest was the rock recipe replayed):

- **A triangle budget that a per-part cap cannot express.** Measured first (playwright, biomes source
  + real three): a whole giant tree today is **259–402 tris** across 13–20 parts, and one canopy
  cluster is **20** (an `ico`). An AI part cannot be 20. Cap-per-part alone is a trap here: swap every
  canopy on a tree and each part passes while the tree becomes 20×. So `tri_budget.json` gained
  `families.tree` with **two** gates — per part ≤ heaviest whole tree today (402, same rule shape as
  rock), **plus per-species Σ(library parts) ≤ 4× that species' current total**. Measured outcome:
  2.2–3.7×, worst species meranti 315 → ~890. Draw calls unchanged (one InstancedMesh per part row,
  before and after).
- **Only `ico` canopy rows are swappable, and that is geometry not taste.** A `cone` fallback's
  envelope is `{r, h/2}` (e.g. `cone(7,26)` = r7 / hy13) — fitting a canopy blob into it stretches it
  into a column. `ico` is a sphere, which is what a photographed crown actually fits. Two species
  (klinki, alerce) are **deliberately left alone**: their crown clusters are 2.2–3.0 m, smaller than
  the smallest node (3.325), and forcing them in would break the envelope contract.
- **Non-uniform scaling added to `normalize_parts.py`** (`"r x hy"` target form; `"r"` keeps the old
  equal-ratio path bit-identical for rock). Real crowns are flatter than a sphere: fit equal-ratio and
  the node under-fills the vertical envelope, then the part row's `sy` squashes it again into a pancake.
- **Input curation, again, is the whole game.** First 14 tree photos → **1 solid mesh** (the queries
  `tree crown isolated sky` / `buttress root rainforest` return herbarium sheets and dark forest
  scenes). Re-queried for *named single subjects* — `solitary oak tree meadow`, `lone tree field`,
  `isolated tree grassland` — and 6 photos gave **5 solid meshes**. Same tool, same params. §5c's
  finding generalises: the wording of the query beats every model knob.
  `buttress` is still short (Wikimedia keeps serving book-scan PDFs and 429s) — buttress/fork parts
  are **not done**, and the ledger says so rather than pretending the family is complete.
- **Two seams extended rather than copied** (原則 2): `parts_src.mjs` gained `bioLibDescs()` — it
  executes the `VEG_DEFS`/`GIANT_DEFS` source with `cyl/cone/ico` **stubs that return descriptor
  arrays**, so biomes rows land in the exact same vocabulary `fbEnvelope` already speaks; and the
  review board now derives rows from both consumers, building the veg side with the game's own
  `buildVegMeshes` (exported for this; no second assembler on the board).
- **A gate that counts what it cannot execute.** `bioLibDescs` also returns the raw count of `lib:` in
  the source; intake reds when it differs from what the executable tables yielded — otherwise a `lib:`
  row added to `GIANT_DECO` (which builds `THREE.TorusGeometry` directly, so the stubs cannot reach it)
  would simply never be verified. First run of that gate went red on **its own doc comments** —
  the ㋑ trap in miniature: source counting must strip comments.
- **Provenance: one record can own several keys.** A size ladder is one generation job baked at
  several scales; four entries with `keys: [...]` beat twelve near-identical ones (and twelve would
  drift, with the stale ones still looking fine). `loadProvenance` now accepts `key` or `keys`.
- **Not yet done**: in-game smoke (walk a grove + 30 s steady-state frame time) and `audit_traverse`
  (㋓ network; canopies touch no collider — trunk colliders are registered by the scatter code and are
  untouched — so no route can change, but it has not been run). `audit_ui_layout` reds on this machine
  **identically at the pre-change tree** (A/B'd via `git stash`) — pre-existing, unrelated.

## 5h. Trial log (2026-08-05 night, 3060-machine session — scale-out campaign, user redirect)

**User decisions (this session; supersede where they conflict):**
1. **所有物件(神木/巨石/建築)一律照片→img→3D**,大量下載**不同樹種**的照片 —— §3 rule 8 的
   method split 修訂:building modules 從 LLM-parts 改走 img→3D GLB(landmark 純資料表維持);
   樹族改**逐樹種**列(11 神木種逐種對位 + VEG 常見種)。
2. **無視舊有物件、不要只是原版重繪** —— 落地為:①逐樹種專屬冠簇(現況 9 種共用 4 形 →
   每種自己的形狀);②巨岩塊/hoodoo 換實拍;③包絡契約不變(fuse 仍是尺寸上界,「新設計」
   改的是形狀來源,不是尺寸紀律)。
3. 機體維持 rig 槽位契約(骨架 = ControlNet 類比),**3D 外皮全新設計** —— 即 Track A 原案;
   出圖以 codex 設計敘述為權威(`--no-ref` 模式本來就是這個語意)。

**Landed:**
- **Megalith seam(D-2,狀態帳)**:命令式建造端的第一個消費端。要點:megaGeo MUST clone
  (`bakeContactAO` 就地 setAttribute 頂點色 —— 共用庫幾何被烤一次,全場帶著別顆岩的 AO);
  節點契約 = **單位包絡**(ico(1)),呼叫端 mesh.scale 拉尺寸 ⇒ 一顆節點服務任意大小;
  rnd 枚數兩條路恆等(佈局逐位元不變);`audit_siteplan` Ⅴ 改釘「恰兩份解析(partGeo+megaGeo)
  + 呼叫點凍結清單 5 處 + col/anchor 回傳塊無庫引用」。`audit_object_joints` 的 megal 沙箱
  要多抽 MEGA_LIB/megaGeo 兩段並注入 `libGeo = () => null`(= 走保險絲;接合真相在保險絲上)。
- **mesh_stats.mjs(新工具)**:封閉網格有號體積 ÷ 包圍盒 = 實心度(fill)。塊狀候選
  fill ≥ ~0.34,薄殼/碎片 < 0.15 —— 19 顆 6 中,與 §5e 人眼結論一致;人眼只需複核前幾名
  (本輪抓到兩顆統計合格但語意錯誤的:博物館老照片**有人入鏡**、立體鏡**雙聯卡** ——
  fill 篩不掉「內容錯誤」,人眼那一步不可省)。
- **fetch_photos 逐主機節流**:429 只封該主機(upload.wikimedia.org),其他主機照抓;
  舊制「一顆 429 整輪收工」讓 Commons-heavy 的零件把整輪陪葬,排後面的樹種列永遠輪不到
  (同一個病灶的另一面:工作清單順序 = 優先序,樹種列 MUST 排在 fork/buttress 前)。
- **normalize_parts --base**:追加節點時整支匯入既有 GLB 原樣保留 —— 舊節點不重跑
  (重跑 = 減面/縮放重算,位元漂移)。
- **agy 額度牆**:t01 七槽 2D 切圖兩輪全數 429 RESOURCE_EXHAUSTED。額度是模型級
  (gemini-3.1-flash-image),與 read_file 權限無關。P3 停在牆前,models.js 一行未動。
- **樹族的真瓶頸不是張數,是「CC0 = 館藏數位化」**(本輪最重要的一個發現,也推翻了
  §5c/§5g「換個查詢措辭就好」的樂觀版本)。逐樹種查詢**照張數是成功的**(baobab 6/6、
  maple 6/6、cypress 5/5、sequoia 6/6),但 26 顆 SF3D 產出逐張看過去,`fill` 排名最前的是:
  1832 年的**猴麵包樹石版畫**、19 世紀伐木營地的**蛋白相紙**、**臘葉標本壓葉**(白色標本帶
  清晰可見)、**立體鏡雙聯卡**、鉛筆素描明信片。授權全部合法、解析度全部達標、統計全部合格
  —— 只是它們不是現代單體攝影。成因是結構性的:CC0 語料的重心是博物館/圖書館的數位化館藏
  (實測供應者分佈:rawpixel 50 / Commons 20 / Cooper Hewitt 13 / …)。
  **兩層對策**:①`mesh_stats.mjs` 的 fill 只篩得掉薄殼,篩不掉「內容錯誤」⇒ 人眼那一步
  **不可省**(這一輪它擋下了六顆);②fetcher 加 `excluded_source`(排除純館藏型供應者;
  rawpixel 刻意留著 —— 它同時供應現代攝影與公版版畫,砍掉會連最好的那幾張一起砍)。
  ⇒ **逐樹種專屬冠簇本輪只推進到 6 形**(新增 e/f 兩形,拆開 dougfir/sitka/taiwania 原本
  共用 `canopy_d35` 的三種),不是 11 形。誠實記在這裡而不是報成完成。
- **playwright 補上了**(`npm install -g playwright` + `npm link playwright`)。兩個注意:
  ①ESM `import` **不吃 `NODE_PATH`**(那是 CJS 的機制)⇒ memory 裡那條「全域 + NODE_PATH」
  對 `.mjs` 工具無效,要 `npm link`;②**本儲存庫的 `node_modules` 是受版控的**(唯一依賴 ws
  隨庫附帶,A2)⇒ `npm link` 會改到 tracked 的 `.package-lock.json`,MUST 還原並把連結
  加進 `.gitignore`,否則看起來像「本專案依賴 playwright」。`shot_giants.mjs` 的 8620 硬編
  URL 順手改成可指定。
- **建築族擋在預算量測**(不是擋在照片):chimney 5/5、rooftank 5/5 已到位,但
  `families.building` 的三角形上限 MUST 量測(§2.1-6),量法與 tree 族同樣是 playwright 頁內
  執行 `LANDMARKS` 原文 + 真 three。**MUST NOT 手寫一個好看的數字** ⇒ 停在這裡,下一輪第一件事。

## 5i. Trial log (2026-08-06, 3060-machine session — 建築族首批:使用者定案「大量下載不同國家/城市/小鎮/風格的建築物照片再 img→3D,無視舊有物件直接畫,禁止使用原版重繪」)

- **兩個資料家並存**(§5d 的單一資料家已不成立,記清楚免得下一輪撲空):venv/vendor/weights
  住 `zen-albattani-b33990/tools/ai3d`(絕對路徑,不可搬);**照片庫/photo_manifest/matte/SF3D
  產出住 `reverent-pascal-fcd63e/tools/ai3d`**(§5h 那一輪在那裡跑的 fetch)。本輪流程:目錄改在
  本 worktree → `cp fetch_photos.mjs` 到 reverent-pascal 跑 fetch;matte/run.py 用 zen 的 venv、
  吃 reverent-pascal 的檔案。GLB/manifest/預算檔一律落在**本 worktree**。
- **InstancedMesh 桶的預算與 rock/tree 是不同的幾何學**(本輪最重要的方法結論):一顆節點
  幾何被全桶 instance 共用 ⇒ GPU 成本 = 節點 tris × instance 數,「單件 ≤ 最重整件」在這裡毫無
  意義。故 `families.building` 的逐桶節點上限 = (whole_factor−1) × 配件桶總量上界 ÷ 名冊桶數 ÷
  該桶 instance 上界(全部量測/可數:`measure_building_tris.mjs` 三個最密市區 --live 實測
  chimneys 212 / roofTanks 97 / roofBoxes 117,配件桶合計上界 50,936 tris,全場 1.47M~1.72M)
  ⇒ chimney 240 / tank 525 / acbox 435;名冊全換滿的最壞情況 = 4× 現值(≈204k,佔最重場景
  11.8%)。`parts_src.triBudget()` 新增 `nodeCap(fam, kind)`,intake 與對照台同吃。
- **接線 = 桶建構表,不是逐呼叫點散裝**:`BLD_LIB` 名冊(單位包絡:box(1,1,1)/cyl(1,1,1),
  instance scale 本來就是尺寸)+ `bldGeo` 守衛 + **`buildBldBucket` 桶建構表**(單位 primitive
  保險絲 + 桶色 + InstancedMesh 一次定案;遊戲三個呼叫點與對照台 `bld` 建構器同吃 ⇒ 台上
  沒有第二套組裝器)。零 rnd、draw call 逐位元不變、屋頂配件本無碰撞柱(A30 的「佈局讀庫」
  問題天然不存在)。`audit_siteplan` Ⅴ 改釘「恰三份解析 + bldGeo 只在三桶 + 消費點恰 3 處」,
  反向驗證(拔煙囪桶保險絲 ⇒ 紅 2/3)。
- **建築照片是 SF3D 的甜蜜點**:79 張 matte 全批(tvc 520)→ mesh_stats 塊狀候選 ~30/79
  (樹/岩輪次是 ~1/15)—— 建築天生塊狀。但**人眼那一步照樣不可省**:統計前段照樣混進
  蒙古包**有人入鏡**(§5h 同款)、整片屋頂**場景照**(rooftank 查詢命中率 0/5 可用)、
  以及兩顆統計合格語意荒謬的**蛋形/球形**(window 立面照的 SF3D 產出)。contact sheet
  渲染器升格為正式工具 `mesh_sheet.mjs`(§5e 備註「reused 就 promote」兌現)。
- **首批兩顆**:`chimney_a` ← 磚砌工業煙囪仰拍(brick chimney,rawpixel CC0;938 → 234 tris
  ≤ 240)、`ac_a` ← 白色商辦量體(building rooftop 查詢;節點角色 = 屋頂機房箱,照片族 ≠
  節點名;986 → 426 ≤ 435)。normalize 非等向 0.6×0.5 / 0.65×0.5 —— box 包絡 r 0.707 容得下,
  但桶的 S=(w,h,w) 以**軸寬**為準,貼滿 0.707 會比原單位盒視覺胖一圈(對角 vs 軸向的差,
  mega 的 ico 包絡沒有這一題)。
- **人造直線輪廓的減面路線與岩族相反**(實測,兩張截圖都留在 §5i 這一輪的 out 目錄):
  SF3D 超低 tvc 的等向 remesh 會把直線磨圓 —— tvc 120 的煙囪是**彎香蕉**、tvc 220 的方箱是
  鵝卵石(岩族 tvc 150 沒事:岩石本來就是塊團)。正確路線 = 挑選版 tvc 520 出貨 + normalize
  內建的 Blender collapse decimate 溫和減面(3.9:1 / 2.3:1;§5e「溫和減面無害」的上緣)。
  另:單位包絡節點的**遊戲內模樣**要把 instance scale 烤進去才看得出來(俯拍預覽小心
  glTF y-up ↔ Blender z-up:object scale 的 y 是 glTF 的 −z,軸搞錯會把「拉高」變「拉深」)。
- **tank_a 未出貨(誠實記錄)**:rooftank 現有 5 照全是場景照;`tank_wood`(木製水塔,具名
  單一主體)列已進目錄,但 dormer/tank_wood 的候選重度 Wikimedia-hosted —— 本輪撞上
  **深度 IP 節流**:與 §5b「每 10 分鐘窗放 2~3 張」不同,第 1 輪 55 張爆量後
  **連續 7 輪(≈80 分鐘)整輪 0 張**,是小時級的長時窗。結論:單輪 ≤55 張的爆量會把
  同一天的後續輪次全部賠掉 —— 下次大量抓取把 `--limit` 壓在 ~25,或隔天再補缺額。
  BLD_LIB 的 tank 列在節點入庫前保持註解(intake「名冊有、GLB 無」紅字驗證過會咬人 ——
  這是特性)。補抓指令:`node fetch_photos.mjs --family building --limit 25`(reverent-pascal
  資料家),tank_wood/dormer/acunit 達標後從 §5i 的 mesh_sheet 挑選流程續跑。
- **cp950 主控台會咬 Python 工具**:matte_photos.py 印 `✓` 直接 UnicodeEncodeError 死在
  第一張(exit 0,看起來像跑完)—— 跑任何會印非 ASCII 的 venv 工具一律帶
  `PYTHONIOENCODING=utf-8`。另:matte 的 rglob 在 fetch 還在下載時列舉會漏檔,重跑一次
  就補上(可續跑語意)。
- **量測選點**:場景照/仰拍導致 SF3D 背面外推失敗的比例遠低於樹族;`bld_*` 整棟風格列
  17 列有 13 列首輪就至少 2 張達標(barn/chalet/halftimber/stonecottage/lighthouse 全滿),
  歐洲城市立面列(rowhouse/shophouse)與亞洲列(hanok/minka 部分)卡在 Commons 429。
  **整棟節點還沒有消費端**(邊界樓/程序街區/巨岩石屋是候選)—— 下一輪先開縫再入庫,
  不要先塞節點(孤兒節點會被對照台點名)。

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

## 7. Review board — 3D 零件對照台 (generated vs original, side by side)

User decision (2026-08-05): *「在設定頁面另外建立 docs/ai3d_runbook.md 生成的 3D 物件與原版 3D
物件比較的工具,須說明使用哪個生成方法與 img,操作比照生圖對照台」*.

**How to run** — same three ways as the 2D board:

```bash
npm run parts
```

`node tools/parts_review.mjs --report` prints the pairing table without a browser;
`--port` / `--photos <某個 tools/ai3d 目錄>` override the port and where source photos are looked up.
In-game it is the second row of 設定 → 開發工具(本機) (▶ 啟動 / ↗ 開啟 / ⏹ 停止, port **8622**) —
that row exists because the tool is registered in `tools/dev_supervisor.mjs TOOLS`; the settings page
derives the list from the server, so no client code was touched.

**What one row shows**

| | |
|---|---|
| Left pane | **原版** — for GLB parts, the fuse path (procedural primitive, part library deliberately not loaded); for pure-data parts, the pre-rewrite table built by **that revision's own `buildBeacon`**, served from `git show <rev>:public/js/beacons.js` |
| Right pane | **AI 生成** — the real game path (library loaded / current table) |
| Both | one shared camera and one seed (two different angles are not a comparison), collider cylinder overlaid, live readout: triangles / meshes(= draw calls) / collider r,h. The readout **names where that cylinder came from**, because the three consumers differ: beacons = measured `beaconCollider`, giant trees = bounding box (the real collider lives in the scatter code), megaliths = the registered `meta.col` |
| 來源圖 | every img with role, licence, creator, query and a link to the source page; the photo itself is served from whichever `tools/ai3d` data home has it (§5d) and says so plainly when it is not on this machine |
| 生成方法 | method label + why that method (plan §8 split), tool, runner, params, machine, measured VRAM/seconds, post-processing, landing rev |
| 數據對照 | GLB extent vs fallback envelope (+ verdict), triangles vs the measured budget; for pure-data parts, part count / measured extent / nominal `foot` then-vs-now |
| Bottom | 缺件 (descriptor → missing node ⇒ whole prop silently falls back), 孤兒節點 (node nobody uses), 未記載來源, ledger problems — never hidden, same rule as the 2D board |

**Where each fact lives** (no second copy anywhere):
`tools/ai3d/parts_src.mjs` reads the consumer part table, `PART_LIBS`, the fallback envelope and the
GLB (shared with `intake_parts.mjs` — it used to own all four); `tools/ai3d/provenance.mjs` holds the
method vocabulary and reads `parts_manifest.json`; the page only draws. Both panes are built by the
game's own `buildBeacon` — the board contains no second assembler and no second primitive builder.

**The ordering that makes it true**: `libGeo` is module state, so every "原版" must be built *before*
`loadPartLibs()` and cached. Getting that wrong produces two identical panes and no error message —
i.e. a confident, wrong "the AI part looks much like the original".

**One builder per consumer** (`build(…, builder)`): `beacon` → `beacons.buildBeacon`, `veg` →
`biomes.buildVegMeshes`, `mega` → biomes' own `synthMegalith` → `decorateMegalith` →
`jitterMegalith` → `bakeContactAO`, in `placeMegaliths`' order. The megalith one has to be a
**synthesised** rock: `MEGA_LIB` nodes only appear in `synthMegalith` (marble stack / talus blocks /
satellite domes) and `decorateMegalith` (cairn) — the named `MEGALITHS[].build` eat no library part
at all, so they would render bit-identically on both sides. An unknown builder now renders
**nothing** and logs; see silent bug 3.

**Three silent bugs found so far** (this is what the board is for):

1. `partlib.js` / `models.js` fetch **relative** asset URLs (`assets/models/parts/rock.glb`), and the
   dev boards serve the repo root ⇒ 404 ⇒ the library fell back to primitives and the "generated"
   pane quietly drew the original. Fixed with `<base href="/public/">` (URL layout mirrors the
   repo layout, A28) — **and the same line was missing from the 2D board**, whose 3D stage had been
   showing procedural fallbacks instead of the CC0 GLB units all along.
2. §5b's "*57 pure-data parts (was 12)*" — the board derives **11** from rev `32ec7b5`. The counts are
   derived from both revisions' part tables now, so the manifest records no part counts at all.
3. (2026-08-06) The megalith nodes `rock/mega_a|b|c` — the newest generation round, and the first
   **imperative** consumer — had a row on the board but no builder: `build()` fell through to
   `buildBeacon('megalith')`, whose `KIND_PARTS[kind] || KIND_PARTS.cairn` silently substituted the
   **cairn beacon**. And because the cairn eats `rock/*` nodes itself, the two panes genuinely
   differed and the readouts genuinely moved — it looked completely normal while the rock had never
   once been on stage. Fixed by adding the `mega` builder (three exports in `biomes.js`; behaviour
   bit-identical, `placeMegaliths` is still the only in-game caller) and by making an unrecognised
   builder/kind render nothing and log, instead of letting `buildBeacon` cover for it.

## 6. Open questions for the repo owner (do not guess)

1. Add an `HF_TOKEN` repo secret (with SF3D licence accepted) if CPU inference in Actions should ever
   be attempted; otherwise all inference stays on the 3060.
2. `fetch-photos.yml`'s push trigger is pinned to branch `claude/photo-db-img-to-3d-8j9tbe`;
   after PR #127 merges, keep only `workflow_dispatch` (edit the `on:` block) or repoint the branch.
3. ~~Accept the SF3D licence~~ — **RESOLVED 2026-08-05** (owner accepted on `winniexchang`;
   weights downloaded, P2c executed same day, §5e).
4. ~~Approve installing Blender~~ — **RESOLVED 2026-08-05** (Blender 5.2 LTS via winget, §5c).
