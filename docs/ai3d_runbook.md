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
| Photo DB gap-fill (parts at 0, see §4 step A) | TODO | — |
| P2b pilot — LLM-written pure-data parts (regular geometry) | TODO | — |
| P2c pilot — img→3D GLB parts (organic geometry) | TODO | — |
| biomes consumption-loop seam (`p.lib` field; plan §8 correction 1) | TODO — **blocked until P2c ships first tree/rock parts** | — |
| `giantCrownR` GLB-compat (vertex scan or metadata; plan §8 correction 1) | TODO — **hard blocker for canopy GLBs** | — |
| P3 dynamic track (mech slots) | NOT STARTED | Plan §3; do not start before P2c passes |

## 2. Environment matrix (measured 2026-08-05 — do not rediscover, trust this)

| Environment | Can do | Cannot do (measured) |
|---|---|---|
| **CC sandbox** (this repo's remote sessions) | All offline audits; e2e (`node server/server.js` then `npm test`); `npm run bal`; editing + push; GitHub MCP (PR/Actions API); HF MCP (search + the curated `dynamic_space` roster) | Egress to `api.openverse.org` / `commons.wikimedia.org` / `huggingface.co` / `upload.wikimedia.org` / `*.blob.core.windows.net` — all CONNECT 403 ⇒ **no photo ingress, no artifact ingress, no HF gradio calls**. No GPU (`nvidia-smi` absent). Raw `api.github.com` REST is gated (MCP tools work; `curl` with `$GITHUB_TOKEN` returns "GitHub access is not enabled") |
| **GitHub Actions** (ubuntu runner) | Open egress ⇒ photo fetching (proven, run 1); licence re-audit; artifact publishing | No GPU. SF3D weights are licence-gated on HF ⇒ inference here would need an `HF_TOKEN` secret **which only the repo owner can add** — do not attempt without it |
| **User's RTX 3060 12 GB machine** | The whole model ladder (plan §1): SF3D 6 GB / Hunyuan3D 2.1 shape-only 10 GB / TRELLIS.2 (measure first); Blender headless; `agy` 2D | Nothing relevant blocked; Python 3.13 is system default — the model stack needs a **separate 3.10–3.11 venv** in `tools/ai3d/.venv` (never in `package.json`, A2) |
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
