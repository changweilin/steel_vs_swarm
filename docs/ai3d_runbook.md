# AI 3D Asset Pipeline — Plan and Execution Runbook

> **Audience: AI agents.** Merged 2026-08-11 from the former `ai3d_asset_plan.md` (settled
> decisions) and this runbook (state + trial log). Companion skills:
> `.claude/skills/photo-to-3d-pipeline/` (the procedure), `photo-to-prop-forge/` (static contract),
> `mech-part-forge/` (dynamic contract).
> §0–§4 are **live state — keep them current**. §5* is the **trial log**: append-only history,
> referenced by anchor (`§5aj-C` etc.) from ~25 files under `tools/ai3d/` and from CLAUDE.md, so
> **anchors must never be renumbered or deleted**.

---

## 0. Settled decisions

Goal: raise detail density of **dynamic units** (mechs / building-unit NPCs) and **static props**
(buildings, giant trees, megaliths, landmarks) one tier without touching the rig contract,
determinism, or A2 (zero npm deps). Hardware anchor: **RTX 3060 12GB**.

| Item | Decision | Reason |
|---|---|---|
| Output form | **Part-library GLB + existing assembly code** | Assembly / paint / gait / jitter stay where they are ⇒ per-instance variation, determinism and `partJitter` unchanged; zero contact with the rig contract |
| Auto-rigging (UniRig et al.) | **Deliberately not used** | This rig is not a skinned skeleton, it is a **named part hierarchy** (`rig.legL` / `rig.chest` / `rig.muzzles`…) driven per frame by `locomotion.js`. A skinned skeleton scraps `MOVE_SIG` / `CAST_SIG` and three audits at once |
| Part splitting | **P3-SAM** as cross-validation only | Per-slot generation guarantees the mapping; P3-SAM is used to check the parts still read as one machine |
| Decimate / clean / export | **Blender headless (bpy)** | Offline, no npm, scriptable |
| 2D drafts | **`agy`** for mechs (subscription quota) / local **FLUX.1 Kontext dev GGUF** for bulk | Gemini CLI dropped consumer tiers 2026-06-18; route C (paid Gemini API key) is archived in §5.1-era notes |
| Photo sourcing | **Openverse API** + Wikimedia Commons, **CC0/PD only** | A hard gate, not a recommendation — a rock baked into the repo has nowhere to carry attribution, and a licence violation produces no error message |

### 0.1 The img→3D ladder (measured on this card, not assumed)

`T2-spz (buildings / anything textured) → Hunyuan3D-2GP (solid rock) → SF3D (fast prescreen) →
keep the procedural part`. Drop a rung whenever one fails. **Never change a rule or a contract to
make a tool fit.**

| Tool | Verdict | Measured |
|---|---|---|
| TRELLIS.2-4B / TRELLIS 1, official builds | ❌ **out on this card** (§5l) | TRELLIS 1 clears cond/sparse-structure/slat but flexicubes mesh extraction OOMs with 9.58GB free after every offload trick; TRELLIS.2-4B needs 24GB and floors at 512³. The old "8GB@256 / 12GB@512" line conflated two generations |
| **TRELLIS.2 stableprojectorz fork** | ✅ **open** (§5n) | Native Windows, prebuilt cp311 wheels, per-stage CPU offload: 7/7 @1024³, torch peak ≤3.4GB, 59–226s/image. **The real threshold is system RAM** — the model sits in CPU at ~19GB, and loading dies silently below ~20GB free |
| **Hunyuan3D-2GP** | ✅ **open** (§5m) | WSL2, torch peak a constant 2524MiB, 61–67s/image, weights 4.9GB. Recovers both SF3D failure modes (hoodoo, Art Deco tower). Human-eye yield ~1/2 vs SF3D's ~1/6 |
| **Stable Fast 3D** | ✅ loosest | 6GB, peak 6.17GB measured, warm 13.6s / 2 images; delight + UV included. Regular man-made geometry collapses to a facade shell — it is a prescreen, not a finisher |
| Blender headless | ✅ | CPU |

Hunyuan's paint stage (21GB) is **never run** — this project does not want PBR.

### 0.2 Boundary: a part library, not whole-unit GLBs

`MODEL_MANIFEST` supports whole-unit GLBs, but the mech column is all `null` on purpose:
`locomotion.js` writes **named nodes** every frame; `paint.js` liveries, `toon.js` ramps and the
`uPaintFace` gate all hang off **per-part materials**; and on the static side the entire value of
`VEG_DEFS` / `MEGALITHS` / `KIND_PARTS` **is** per-instance variation. Bake a whole tree and every
tree in the forest is identical.

```
AI output      →  part-library GLB (one named node per part; geometry + one base colour)
existing code  →  which part, where, what rotation, how much jitter, what colour, how it moves
```

Seam: `public/js/partlib.js` — `libGeo(name) → BufferGeometry | null`, `loadPartLib(url)` loads once
and `markShared()`s. Three consumers changed one line each: `beacons.js _geo(p.g)` accepts
`['lib', name, <original descriptor>]`; `biomes.js` resolves `p.lib` **in the build-time consumption
loop** (a module-scope `libGeo()` can never work — `VEG_DEFS` is constructed at import time, before
any async fetch); `models.js` changes geometry source only.

**Hard invariants (acceptance conditions, not advice):**

1. **Fuse** — library load failure ⇒ today's frame, bit for bit.
2. **Measured extents** — collider / `foot` / `col.r` always from `Box3.setFromObject` *after* the
   swap; never the nominal value (A30, `audit_beacons` Ⅰ).
3. **Zero extra randomness** — swapping geometry must not consume an extra `rnd()`, or the whole
   map's layout sequence shifts (CLAUDE.md §2.3).
4. **Shared geometry** — always `markShared()`; `disposeTree` skips it (A25).
5. **Geometry + base colour only** — no normal/metal/roughness maps (CLAUDE.md §1).
6. **Triangle budget derived by measurement** — measure the family's current count first; the new
   budget is that value × a justified factor. Never hand-write a nice-sounding number.
7. **Layout maths reads the fuse `p.g`, never the library geometry.** `giantCrownR` was resolved
   *by contract, not by vertex scan* — a vertex scan would make crown radius depend on GLB load
   success, i.e. layout diverging per client (§2.3). The intake envelope (GLB extent ≤ fallback,
   ≥ half) keeps fuse-derived radii conservative. **Do not "fix" this into a vertex scan.**

### 0.3 Method split by geometry class

| Family | Method | Why |
|---|---|---|
| Landmarks `KIND_PARTS` | **LLM reads photos → writes pure-data part rows** ("Route A") | Part tables are already pure-data primitives — the only reason `audit_beacons` Ⅰ can verify extents offline. Zero binary weight, zero licence exposure, native fit with `stretch`/`partJitter`. Output is **part-table data rows, not three.js code** (A38) |
| Megaliths `MEGALITHS`, giant-tree sculptural parts | **img→3D → partlib GLB** | Organic and irregular — primitives cannot express them; the only class worth the GLB payload |
| Building whole masses (`biomes.js` general-building InstancedMesh) | **img→3D GLB** (queue F) | Overrides the 2026-08-08 "organic only" scope narrowing — see below |
| Building roof deco `BLD_LIB` | GLB, already shipped | Different consumer from the masses; both are true |
| Small vegetation, generic building masses | **Stay procedural** | Wholesale GLB swap explodes draw calls and the triangle budget; `procedural-object-detail` already covers variation |
| `CIVIC_PARTS` civic props | **Declined** (user, 2026-08-08) | — |
| Mechs / NPCs | Track A only (§0.4) | Out of scope of the static proposal |

**Scope history, because it reads as a contradiction otherwise.** On 2026-08-08 the user narrowed
scope to *"only complex organic shapes — landscape trees, rocks"*, declining `CIVIC_PARTS` and
freezing `KIND_PARTS` at what was declared. Later the same day they directed "now handle the
buildings", and when asked which way to go chose **execute queue F** (whole-mass consumption seam +
T2 intake path). So `BUILDERS`/building masses are **in**, via the GLB lane, not the LLM-part-row
lane. Nothing already shipped was removed — pulling `BLD_LIB` back out would burn measured budget
work nobody asked to change.

**"Just add more rows" is not free.** For trees the roster **is** the knob and it is at its economic
limit: `node_cap = growth allowance ÷ Σ(roster rows × that type's instance ceiling) + current part
tris`. Every new `lib:` row is another instance-row in the divisor — wiring *every* canopy clump
would drop the cap back into the 2.4–3:1 decimation band where Blender tears holes in the canopy
shell, and **extents and budget both stay green in that state**; it only shows up as split canopies
in a screenshot. Within trees, "build more" means **swapping which clumps are wired**. Rocks are the
opposite and still have headroom.

### 0.4 Track A — dynamic (slot contract)

Slots are already defined per chassis kind (`models.js` is authoritative): `aerial` —
`tilt`/body/`wpn.{light,heavy}.g`/`muzzles.*.n`; `biped`/`quad` — `hips` `chest` `neck` `head`
`legL/R` `armL/R` `legChainL/R` `armChainL/R` `tailSegs` `gunR/gunL`; `morph` — `torso` `head`
limbs + `kneeL/R` `ankleL/R` `elbowL/R` `wristL/R` `vents` `thrusters` `rotors` `flapWings`.

- Muzzle nodes and `rig.wpn` local pose **must not move** — forward-facing muzzles rely on a
  build-time world-alignment inverse. `audit_muzzle.mjs` must stay green after a re-skin.
- Whole-unit bbox drift **≤ ±5%**, or `fitToHeight` rescales and the health bar / marker / glow all skew.
- Hydraulic-style **single-end anchored, angled** parts must not become two-end joint-spanning parts
  — the gait will stretch them apart.
- **Transformers get one part set, not two.** `makePoser` interpolates `p.a` (ground) → `p.b`
  (flight) through **the same `p.g`**; a per-form part set turns "transform" into "swap model".
  Split images are drawn from the ground form (pivots are legible there); flight masters are for
  **acceptance** — a shin that only works on the ground fails once it folds into a nacelle.
- Volume rules that make the quota feasible: mirror-symmetric parts are generated **once** and
  mirrored in Blender (~40% fewer unique slots); retry only the slots that split badly.
- Gates: `audit_muzzle` + `audit_cockpit` + `audit_cast_jump` + `audit_gpu_lifecycle` green,
  `shot_units.mjs` before/after, and `npm test` / `npm run bal` **bit-identical**.

### 0.5 Prompt spec for image→3D inputs

Image→3D models do not want a pretty illustration; they want an image that **states the shape and
removes interference**. Nine rules, all of them in every prompt: ①exactly one object, isolated,
complete ②uncropped, ~85% of frame, even margins ③three-quarter view ~35° yaw / ~20° elevation,
long-lens (100mm) flattened perspective ④flat even ambient light, no cast shadow, no rim light
⑤flat single-colour neutral background (#808080), no gradient, no ground plane ⑥**fully opaque — no
glass, transparency, glow or emissive** (the #1 failure mode; the existing concept masters have
translucent emissive wings and must never be submitted unmodified) ⑦crisp panel lines and bolts,
matte surface ⑧no text, logos, arrows, dimensions, watermark or turntable sheet ⑨≥1024 short side,
square.

Pre-processing: matte to alpha (`rembg`/BiRefNet), check the alpha edge for leftover outline strokes
(concept art outlines read as a groove around the part), and never submit a short side < 1024. A
matte fed to T2 **must be binarised** (alpha >16 → 255): T2 crops to an `alpha>204` bbox and eats a
soft matte.

**Two prompt seams, both in `codex.js`, neither writable by its consumers:**

- `FORM_POSE` — the flight master **must state the machine is off the ground and in flight**, and
  its framing must not contain `standing`. Ground framing stays byte-identical so non-transformer
  prompts do not change at all. (Six of eight flight masters came back as correctly transformed
  airframes standing on the ground: the instruction said "the same parts rearranged", which is
  equally true on the ground, while the framing line still said `standing`.)
- `SHOT_POSES` — pose (static / moving / heavy) is **orthogonal** to form; `shotFraming(ch, form,
  pose)` composes them. `static` declares no framing override; `moving`/`heavy` declare framing
  **per medium**, because one shared sentence makes a flying unit sprint along the floor.
  Design anchor: `slots.mjs refShotOf()` resolves a per-unit reference in two tiers — an approved
  in-repo shot first, this round's unreviewed shot second. **A rejected shot is never an anchor.**

A recurring lesson from the first review pass: most review notes were not art direction, they were
the artist hand-patching pipeline bugs — a design brief that was never sent (reading a field deleted
by the A40 restructure, so the prompt still *looked* long), a limb count contradicting itself inside
one paragraph, and stale `visual` fields being fed to the model for chassis that no longer consume
them. See §5.0.4-era trial entries.

---

## 1. Status

**⭐ Current state: blocked on the user supplying photos.** Four nodes marked "regenerate"
(`mass_a`/`mass_b`/`masslow_a` too flat, `ac_a` weathered corners) plus `beacon/depot` have no better
candidate — 27 solidify passes found nothing, and the tall-building bucket is *structurally* out
(every `bld_tower` photo has been run; the survivors are mass_a/b/c themselves). The only remaining
input is `<home>/inbox/<family>/<part>/` + `--adopt`. `ac_a` stays on img→3D by user ruling ("wait
for a clean photo") — the Route-A pure-primitive fallback was **rejected and must not be revived**.

Also outstanding: real-device smoke (four conifer species distinguishable / `mass_near` shows the
third tower / vleaf decimation invisible), `audit_traverse` (needs network), and **§5aj-C** (user's
ruling "only fill actual holes; cap small ones flat" — spec written, not implemented; it overturns
the shipped mirror-fill's trigger condition, whose measure is half-space asymmetry rather than holes.
Trees must be excluded from flat-capping: open leaf cards are design, not damage).

`depot`'s "corpus is ready" was **false** — the count was met but the photos were two Victorian glass
aquaria (a museum catalogues glass vessels as "container") and one harbour panorama. **Roster counts
and `--plan`'s green only ever guarantee *how many*; Route A's first step is to open the photos.**

### Shipped

Evidence for every row is in the cited trial-log section; the ledger deliberately does not repeat it.

| Item | Shipped | §ref |
|---|---|---|
| Corpus images in the review list + "original vs generated" split to same-source pairs only | 2026-08-10 | §5ay |
| Parts board as cockpit — harvest-loop start/stop + three photo states | 2026-08-10 | §5ax |
| Fully automatic intake + after-the-fact human verdicts (⑦⑧⑨) | 2026-08-10 | §5aw |
| Target selection + separation + three screens (several subjects per photo) | 2026-08-10 | §5au |
| Route A parts: `beacon/mast`, `beacon/pylon` | 2026-08-10 | §5av, §5at-b |
| Harvest loop + first full run (169 outputs, all human-reviewed, zero nodes shipped) | 2026-08-10 | §5ar, §5as |
| Parts board hides work-in-progress; per-type veg attribution fix; 7 new nodes (3 conifer species + `mass_c`) | 2026-08-09 | §5aq |
| Building line: storey height from height, roof-band UV, facade layers, second (low-rise) mass bucket, mix incl. drawings | 2026-08-09 | §5ak–§5ap |
| Drawing→3D visual hull `plan_hull` (function shipped, zero nodes) | 2026-08-09 | §5ai |
| `hoodoo_a` replaced (corpus **and** post-processing together); selection + building-mix rulings | 2026-08-09 | §5ah |
| `chimney_a` regenerated (same photo, different model); hoodoo rejected | 2026-08-09 | §5ag |
| Smoke test finally ran — and found the whole building line was dead code on main | 2026-08-09 | §5af |
| `mass` roster to 2 nodes; the corpus is the root cause of "the other side is empty" | 2026-08-09 | §5ae |
| Mirror-fill extended to megaliths (measure which side is empty, then pick the cutter) | 2026-08-09 | §5ad |
| `building/mass_a` — first whole-mass node; deco caps cleared | 2026-08-08 | §5ab, §5ac |
| Whole-mass budget + consumption seam (queue F steps 1–2) | 2026-08-08 | §5aa |
| Canopy shape: petal route vs simple-geometry route → conifer/broadleaf whole-tree nodes; star canopy | 2026-08-08 | §5w–§5z-t |
| Tree corpus rework F0 (selection gate, usable-count ledger, resampling) | 2026-08-07 | §5p, §5q |
| First T2 node (`rock/tower_a`) + `solidify_parts.py`; first tree node (`tree/snag_a`) + `whole:` seam | 2026-08-07 | §5t, §5u |
| Thin-shell decimation gate — direct decimation **closed**, solidify-then-decimate **open** | 2026-08-07 | §5o |
| TRELLIS.2-spz gate **open**; Hunyuan3D-2GP gate **open** + `rock/hoodoo_a`; official TRELLIS **out** | 2026-08-06 | §5n, §5m, §5l |
| Scale-out batches: buildings D-4, megaliths D-5, trees D-6 | 2026-08-06 | §5i, §5j, §5k |
| D-1 giant-tree canopies, D-2 megalith seam, D-3 per-species canopy split | 2026-08-05 | §5g, §5h |
| P1 seam (`partlib.js`), photo fetcher, photo DB + integrity pass, P2b (LLM parts), P2c (first GLB parts), biomes `p.lib` seam, `giantCrownR` by contract, parts review board | 2026-08-05 | §5b–§5f, §7 |

**Blocked:** Track A / P3 mech slots — `agy` returned 429 RESOURCE_EXHAUSTED for every slot across
two rounds (model-level quota, `--no-ref` too). `models.js` is deliberately untouched: a seam with no
real parts to calibrate against is a 10×-expensive failure. Resume with
`node tools/ai3d/gen2d.mjs --only t01 --no-ref --limit 7`.

## 2. Environment matrix (measured; do not rediscover)

| Environment | Can do | Cannot do (measured) |
|---|---|---|
| **CC sandbox** | All offline audits; e2e; `npm run bal`; editing + push; GitHub/HF MCP | Egress to `api.openverse.org` / `commons.wikimedia.org` / `huggingface.co` / `upload.wikimedia.org` — CONNECT 403 ⇒ **no photo ingress, no artifact ingress, no HF gradio**. No GPU |
| **GitHub Actions** | Open egress ⇒ photo fetching, licence re-audit, artifact publishing | No GPU. SF3D weights are licence-gated on HF ⇒ inference needs an `HF_TOKEN` secret only the repo owner can add |
| **User's RTX 3060 12GB** | SF3D, Blender 5.2 headless, `agy` 2D, photo fetching, T2-spz (native Windows), Hunyuan3D-2GP (WSL2 Ubuntu 24.04 with GPU passthrough) | Python 3.13 is the system default — the model stack lives in a 3.11 venv, never in `package.json` (A2). Native Windows cannot build the CUDA-extension stack (no MSVC) ⇒ WSL2 only; the WSL `ext4.vhdx` cannot grow at host level and WSL-side `df` reports a virtual 1TB that will mislead you |
| **HF Spaces** | `stabilityai/stable-fast-3d` as a no-GPU fallback, driven from a machine that can reach `huggingface.co` | The HF MCP `dynamic_space` roster has **no mesh-generating space** |

**Wikimedia IP throttle**: bulk original-size downloads trip HTTP 429 with `Retry-After: 600` after
~30 images, then ~2–3 images per 10-minute window. Most Openverse CC0 results are Wikimedia-hosted,
so this throttles both APIs' downloads (search quota itself is fine — 200/day anon).

**The consequence to internalise**: photos and GLBs cannot pass through the sandbox. The sandbox does
seams, tools, audits, docs and PRs. Anything touching pixels or meshes runs on the 3060 (or Actions,
for photo fetching only). Current homes and venv paths are listed in the memory note
`ai3d-pipeline-state`, because they move.

## 3. Fixed rules (violating any of these = revert, no discussion)

1. **Parts, never finished props** — assembly and variation stay in existing code.
2. **CC0/PD only; photos never enter the repo** — only part-library GLBs do
   (`.gitignore` covers `tools/ai3d/photos/`).
3. **The fuse stays** — `['lib', name, <fallback primitive>]`: the fallback is both the degradation
   path and the offline extent bound. Export tooling must reject a GLB part whose measured extent
   exceeds its fallback's (`partExtent`, `partlib.js` header).
4. **Zero extra `rnd()` consumption** when swapping geometry (CLAUDE.md §2.3 / A4).
5. **`markShared()` for library geometry**; consumers that mutate must `.clone()` (A25).
6. **Geometry + base colour only** — no normal/metal/roughness maps.
7. **Triangle budget derived from measured current values**, never hand-written.
8. **Method split by geometry class** (§0.3).
9. **Every generated object carries a provenance record** — one row in `parts_manifest.json` naming
   the method (a key of `provenance.mjs METHODS`) and the image (id + licence + source URL). No
   record ⇒ the review board lists it as unsourced and it is not done. Never copy derivable numbers
   (extents, triangle counts, part counts) into that file.

## 4. Queue

Steps A–F0 (photo gap-fill, LLM-part pilot, first GLB parts, static scale-out, tree corpus rework,
building whole-mass seam) are **all shipped** — see §1 and their trial-log sections. What remains:

1. **Wait for photos in `inbox/`**, then regenerate the four blocked nodes + `depot` (§1).
2. **First real `auto_intake` run on the 3060 with `--limit 1`**, then `git diff --stat` immediately:
   exactly three files should move (`<family>.glb`, the `biomes.js` roster, `parts_manifest.json`).
   Everything else about that path is sandbox-verified; what is not is whether the Blender command
   line is spelled right.
3. **§5aj-C** — hole-driven fill (§1).
4. **Real-device smoke + `audit_traverse`.**
5. **Track A (mechs)** — do not start before the static batches are stable; the rig contract makes
   failures 10× more expensive. Currently blocked on `agy` quota.

Standing discipline for any new family: **measure the family before generating for it** (its own
`tri_budget.json families.<fam>` entry), and **match the AI part to the fallback's *shape*, not to
the slot's name** — the envelope is what the offline contract checks.

---
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

## 5j. Trial log (2026-08-06, 3060-machine session — 巨岩族第二批:使用者定案「大量下載不同國家地區的地質岩層或奇石/巨岩的照片再 img→3D,無視舊有的物件直接畫,禁止使用原版重繪」)

- **照片目錄改成逐岩型對位消費端**(結構同第 5 輪的逐樹種列):`synthMegalith` 有 11 個岩型
  (dome/slab/tower/spire/arch/mesa/hoodoo/fin/basalt/granite/marble),目錄補上其中九型
  (granite 沿用 `tor`、hoodoo 沿用既有列改點名卡帕多奇亞)+ 八列跨國地質岩層/奇石
  (褶皺/條紋/海蝕柱/蜂窩岩/巨石墓/石灰華/熔岩/石林)。**族序把 rock 提到最前面** ——
  tree 族還有 5 列零張,排在後面的族在無 `--family` 的整輪跑法裡永遠輪不到(§5h 同款坑)。
- **抓取節流實測(與 §5i 的「小時級長時窗」不同)**:本輪 5 輪 × `--limit 25`,第 1~2 輪各
  25 張、第 3~5 輪合計 +19 張(69 張封頂)。429 全數來自 **Commons fallback**,Openverse
  自家 CDN(rawpixel/wordpress.org photos)整輪暢通 ⇒ §5i 的「單輪 ≤25」策略有效,
  但**達標與否取決於該列的候選是不是 Wikimedia-hosted**,不是取決於總量。
- **本輪最重要的方法結論:人眼那一步 MUST 先看照片,再看網格。** 第一次挑選只看
  `mesh_stats` + contact sheet,選出的五顆**全部語意錯誤**:兩張是**藍色 CGI 地形算圖**
  (`mg_dome` 整列 5/5 都是同一組合成算圖 —— 這是 §5c「館藏掃描」之外的**新失敗型態**:
  CC0 平台上的 3D render 資料集)、一張彩繪石雕、一張**維也納城門明信片**、一張 19 世紀
  風景照。統計全部合格(fill 0.20~0.51、tris 800~1000)、licence 全部合格。改成先出
  **照片 contact sheet** 逐張看,49 張裡語意可用的只有 9 張 —— 與 §5c 的「~1/15」同量級。
- **出貨五顆**:`mega_d` ← 海蝕拱殘丘(Hardeep Asrani)、`mega_e` ← 花崗岩平衡巨礫
  (Alan Mattingly)、`mega_f` ← 砂岩刃脊(Sakin Shrestha)、**`tower_a`/`mesa_a` ← 魔鬼塔
  兩張(Carol M Highsmith,PD)**。後兩顆是**整座**節點(崖錐 + 柱身/疊層同一顆),
  接在 `synthMegalith` 的 tower/mesa 兩個分支上:載到庫就不 add 原 primitive,
  **但迴圈照跑** —— 它負責消耗亂數並把 y/r 推到終值(H/topR/sideDef 讀它)。
- **預算錯帳(修掉)**:`families.megalith` 的分子只量 `synthMegalith`、分母只數它的三個
  迴圈,**兩者都漏掉 `decorateMegalith` 的疊石堆**(最多 3 堆 × 5 顆 = 15),而 MEGA_LIB
  這份名冊從第一天就同時服務那兩支。新工具 `measure_megalith_tris.mjs` 把兩者收進**同一次**
  量測(placeMegaliths 的建造順序,200 種子 × 5 尺寸 = 1000 顆):整顆 max **3114**、
  件數解析上限 **29**(抽樣核對 19 ≤ 29)⇒ 逐件上限 **430**(舊 306)。分母 MUST 取解析值、
  分子取量測值 —— 拿抽樣當分母會把閘門算鬆,而鬆掉的閘門不報錯。
- **決定性錯帳(修掉,本輪最有價值的一項)**:同一支工具順手加了「有無零件庫,rnd() 枚數
  MUST 逐顆相同」的對帳,當場紅字。根因是兩處**共用 `rnd()` 混進局部種子的建造器**:
  `cliffPlant` 的蕈傘色、`nest` 的蛋位 ×2 與停棲鳥 —— 而這兩支只在 `rockProbe` **實測到
  壁面/座面**時才跑 ⇒ 幾何一換,跑到的次數就變,共用序列被多抽/少抽幾枚。
  症狀是「載得到零件庫的人與載不到的人,整張圖的植被與巨岩佈局不一樣」,沒有任何錯誤訊息。
  **改前只有 block 名冊時就已經 1/300 顆分家**(D-2 那一輪沒量到),整座型節點上線後 62/300。
  改成走各自的 `lr()` 之後 1000/1000 相同。
- **`normalize_parts.py` 的靜默陷阱(修掉)**:`--base` 重跑**同名**節點時,Blender 撞名自動
  改成 `name.001` ⇒ 舊的那顆繼續當真品(消費端與 intake 都按名字查),新的變孤兒。
  本輪為了留三角形餘裕重跑 tower_a/mesa_a,讀數一切正常而**那次重跑等於沒發生**。
  改成「base 匯入時先刪掉這一輪要重生的同名(含 `.NNN` 尾碼)物件」。
- **逐件上限是量測推導值 ⇒ 出貨 MUST 留餘裕**:tower_a/mesa_a 第一版 421 tris 貼著上限 430,
  而上限會隨岩體零件表重量而移動 —— 貼著上限出貨等於把下一次重量變成紅字。收到 372/371。
- **視覺閉環**(scratchpad `shot_mega.mjs`,同一顆座號、同一顆相機,保險絲 vs 零件庫):
  mesa 從「三段疊層圓柱 + 裙錐」變成一整座有斜坡側翼的實拍岩體、tower 從階梯狀圓柱塔變成
  渾厚岩丘、marble 堆的塊面明顯多樣化。**tower 的新輪廓比舊制矮胖**(節點水平撐滿的是
  `RX = r0×2.0`,那個值本來含山腳崖錐)—— 讀起來像方山而不像火山頸,下一輪若要保住
  「柱」的識別度,應該讓整座節點只撐到柱徑、崖錐留給 primitive。
- **待續**:①`hoodoo` 列仍**不出貨**(六張候選裡單一主體的那兩張過 SF3D 都在**細腰處斷成
  兩截** —— 細頸正是這一型的識別特徵,也正是 SF3D 最容易掉的地方);②`mg_dome` 整列需要
  重下查詢(現有 5 張全是 CGI 算圖);③`spire`/`fin`/`arch`/`slab`/`basalt` 五個岩型分支
  尚未開庫;④照片仍有 12 列未達標(karst 1/5、mg_marble 1/5、mg_basalt 2/6、mg_slab 2/5、
  st_* 六列 0~1)。補抓指令:`node fetch_photos.mjs --family rock --limit 25`(reverent-pascal
  資料家),隔輪冷卻。

## 5k. Trial log (2026-08-06, 3060-machine session — 樹族第二批:使用者定案「大量下載不同國家地區的不同樹種,如灌木/闊葉林/針葉林/各種大小神木的照片再 img→3D,無視舊有的物件直接畫,禁止使用原版重繪」)

- **開工第一件事是一個路由發現,而且它改掉一半的範圍**:`biomes.js NATURE_MANIFEST` 讓
  **broadleaf / birch / shrub / silvergrass / deadtree 五型吃 Quaternius CC0 的 GLB**
  (有葉片鏤空貼圖),`VEG_DEFS` 那幾張零件表只是**載入失敗時的保險絲** —— 掛在名冊裡的型別
  `buildVegMeshes` **連呼叫都不會被呼叫到**,在那幾張表上加 `lib:` 列等於接在沒人看得到的
  路徑上,而且沒有任何錯誤訊息(intake 全綠、對照台也全綠,因為那兩支問的是「零件表與 GLB
  對不對得起來」,不是「遊戲畫不畫得到」)。使用者的「灌木/闊葉林」剛好整整兩類都在名冊裡
  ⇒ **停下來問**,定案「連 Quaternius 一起換掉」。落地方式:三型退出名冊、改走零件表 +
  照片冠簇,而 **只換 `ico` 冠簇、樹幹/枝條維持 primitive**(§3 rule 1 parts-never-props:
  SF3D 吃一張整棵樹的照片會吐出一整棵樹,那是成品,烤進去就沒有逐實例變化了)。
  兩條路徑都零 `rnd()` 消耗(散布早就跑完)⇒ **佈局逐位元不變**,只換畫出來的幾何。
  silvergrass/deadtree 留在名冊裡:不在使用者點名的四類內,而草葉的鏤空貼圖是 SF3D 生不出來的。
- **`families.veg` 是第五個預算族,而它的除數不是桶數是「名冊列 × 該型 instance 數」**
  (新工具 `measure_veg_tris.mjs`)。與 building 族同樣是 InstancedMesh,但**差一個數量級**:
  屋頂煙囪一張圖 212 座,灌木 1909 叢。均分「總額度」的 building 公式套下去,灌木那一列
  分到 **27 tris —— 比現行的 ico(20)還小**,等於這一族永遠不准接。改成均分「**成長**額度」
  (node_cap = (whole_factor−1) × 植被層總量 ÷ Σ(名冊列 × instance) + 現值)才有意義。
  **`whole_factor = 4.0` 這一次是量出來的不是沿用的**:Quaternius 退場後四場實測釋出
  585,966~1,669,392 tris(取最小值 blackforest 2,184,169 → 1,598,203)⇒ 植被層可長到
  193,355 + 585,966 = 4.03× 現值,而每一個量過的場地都不比改制前重。
- **量測工具的指紋 MUST 問真品**:第一版只用幾何參數當指紋,而 `ico(0.9)` 同時是 shrub 與
  conifer2 的零件、`ico(1.7)` 同時是 broadleaf 與 borderrock 的 ⇒ 兩型的 instance 數**互相
  灌到對方頭上**(實測 shrub 與 conifer2 同時報 2044,加起來比整層植被的三角形總量還多)。
  改成頁內呼叫**真品 `buildVegMeshes`** 逐型建一株樣本、讀它的幾何參數 **+ 材質色**
  —— 季節色是 `seasonColor` 算的,在工具端抄一份色表就是第二份實作。改完只剩 birch/mangrove
  一組無解碰撞(同參同色),整群加總 = 偏緊。
- **本輪最貴的一課:三角形預算會回頭決定「這張照片能不能用」,而症狀是撕裂不是紅字。**
  第一版 node_cap = 140(灌木兩列都接),而實拍冠簇原生 336~414 tris ⇒ 減面比 2.4~3:1,
  正好落在 §5e「Blender 硬減面把 SF3D 的殼撕出洞」那個區間:**外廓契約全綠、預算全綠、
  對照台全綠,截圖上樹冠裂成一片一片**。三次嘗試都留在這裡當存證:①換更乾淨的來源(g02
  橡樹冠 1128 → 140 = 8:1,更糟);②SF3D 直接生到 tvc 70(黃楊當場塌成薄殼 fill 0.075);
  ③**真正的解是回頭改名冊** —— 灌木 1909 個 instance,它一列的價錢等於其餘九列的總和,
  把頂端那一小簇留給保險絲(畫面上只是頂上的小球)⇒ Σ 4826 → 2917、cap 140 → **218**,
  減面比回到 1.5:1 以內,截圖乾淨。**名冊本身是旋鈕**,這是這一族與 rock/tree 最不一樣的地方。
- **尺寸階 MUST 逐列一顆,而這條只有截圖抓得到**:第一版讓 `vleaf_a17` 同時服務 `ico(2.7)`
  與 `ico(1.7)` 兩列(包絡契約「≤ fallback 且 ≥ 一半」照樣全綠)⇒ 2.7 那一列拿到的冠簇
  只有標稱的 60%,畫面上是**樹冠浮在樹幹上方、中間開一道縫**。外廓稽核不看 y,而 y 正是
  接合那一軸(§5g/§4-B ④ 的老坑,第三次踩到)。改成逐列一顆、目標一律 `R x R` 拉滿包絡。
- **`photo_sheet.mjs`(新工具)**:§5j 的「人眼 MUST 先看照片再看網格」升格為正式工具
  (同 `mesh_sheet.mjs` 的來歷)。82 張逐張看,語意可用 **13 張(~1/6)**,擋下的東西這一輪
  又多兩種型態:**浮水印**(bristlecone 三張)與**去背後只剩剪影的 PNG 去背圖**(相思樹)。
  實作坑:`setContent` 給的是 opaque origin,`file://` 子資源會被 Chromium 一律擋掉,
  **每一格都空白且沒有錯誤訊息** ⇒ HTML 要寫到磁碟再 `goto('file:///…')`;輸出目錄
  `.sheet` 就在來源目錄底下,不濾掉的話下一輪會把上一輪的 sheet 當照片再收一次(index 全部位移)。
- **`normalize_parts.py --drop`(新旗標)**:節點表換形之後,`canopy_a10/b10/d8/f6` 四顆
  沒有任何消費端 —— 對照台的孤兒清單抓到了,但當時沒有任何辦法把它們從 GLB 裡拿掉
  (`--base` 只會整支保留)。與同名取代共用同一段刪除邏輯,語意差別只有「刪完要不要重生」。
- **對照台的一個潛伏 bug 被這一輪的帳觸發**:來源帳**兩種寫法都合法**(`key` 與 `keys`,
  一筆帳掛多個鍵是刻意允許的),但 `parts_review.mjs` 的純資料件那一段直接讀 `p.key`
  ⇒ 一筆用 `keys:` 寫的純資料件會讓**整支 `--report` TypeError 掛掉**,而那是「這一輪到底
  交付了什麼」的唯一離線出口。改成走 `keys ?? [key]` 的同一條正規化。
- **神木那半是舊配方重播,而「逐種一個專屬冠形」只做到一半(更正)**:①名義上 11 種各有
  自己的節點,但 `canopy_i*` 與舊制 `canopy_a*` 出自**同一張**照片(ov_b1917d71 橡樹冠)、
  `canopy_g*` 與舊制 `canopy_b*` 出自同一張(ov_4e78d273 孤樹)⇒ **11 種對到 9 張照片**,
  redwood/meranti 與 euc/dinizia 各是同一顆冠形的不同尺寸階。挑片時 MUST 先比對「這張前幾輪
  用過沒有」(來源帳 `parts_manifest.json` 的 `imgs[].id` 就是答案 —— 這一輪是漏查,不是查不到);
  真正卡住的是語意可用的冠簇照片只有 9 張,要 11 張得等節流退去。②**klinki / alerce 第一次
  接得上**:它們的冠簇只有 2.2~3.0m,比舊制最小節點(3.325)還小,§5g 當時是**刻意跳過**的,
  這一輪才補得上使用者說的「各種**大小**神木」。逐株閘實測 488~1207 tris(上限 1036~1608)。
- **`lib:` 這條縫只換「一顆冠簇長什麼樣」,換不掉「這棵樹長什麼樣」**(使用者 2026-08-06
  「為何新物件跟舊物件結構這麼像」的正解,比上一條的照片重複**更根本**):這一輪對零件表的
  diff **逐行都是 `+ lib: '…'`** —— `y`/`px`/`pz`/`sy` 一個都沒動、零件沒有增減、樹幹與枝條
  完全沒換(rule 1:只換零件不換成品),再加上包絡契約**強制**每顆新幾何收進它取代的那顆球裡
  ⇒ 剪影骨架(幾顆冠簇、擺在哪、多大、樹幹什麼比例)**逐位元還是舊設計**,變的只有每一團的
  表面起伏。這是縫的射程,不是照片的問題:**換再多不同樹種的照片,骨架都不會變**。
  要讓「結構」不一樣,動的是零件表本身(冠簇數量/偏移/傾角/樹幹收分),而那會同時改到保險絲
  剪影與 `giantCrownR`/`vegSpan` ⇒ 全圖植被佈局跟著位移(仍逐位元決定性),稽核與 bal 要整套
  重跑 —— 是一次獨立的改制,MUST NOT 當成這一輪的補丁塞進來。
- **(同日續作)使用者質疑後把「結構」也換掉了 —— 零件表骨架逐種重寫**:上一條說「換再多照片
  骨架都不會變」,使用者的回應是「那就動零件表」。落地範圍 = **VEG 五型 + 神木四種**:
  闊葉改不對稱寬展冠(主冠偏心 + 側簇各朝不同方位 + 兩根斜出側枝)、白樺改細高窄冠(葉簇沿幹
  上段縱向錯落)、灌木改叢生三團(寬 > 高、沒有主幹)、老雲杉改層疊枝盤(六層遞縮,不是四顆疊球)、
  紅樹林改低平寬冠 + 多方位支柱根;神木則把 meranti/dinizia/tualang **同一份配方**拆成三種剪影
  (攤平圓盤 / 被風削平的凹頂 / 枝下高極高的聚冠),klinki 改成南洋杉的**三層輪生枝盤**(層間留空隙)。
  四件必須連帶處理的事,一件都不能省:
  ①**接合會斷**(joints 當場 20 項紅字):冠盤上移 1.5m,meranti 的翅果簇就 DETACHED;新加的
  紅樹林支柱根離幹 0.12~0.2m 就 ISOLATED。改骨架 MUST 配 `audit_object_joints --seeds 8`。
  ②**兩份預算同時失效**:`families.tree kind_tris` 是量測快照(klinki 286 → 386),
  `families.veg` 的植被層總量也漲(193,355 → 212,963)—— 前者的量測從臨時腳本升格成
  `measure_veg_tris.mjs --giants`(**MUST NOT `loadPartLibs`**:量的是保險絲現值,載了零件庫
  等於拿自己的產出當基準 = 恆綠 = 沒有閘門)。
  ③**名冊是雙向旋鈕**:骨架變豐富 ⇒ 每一團都接庫的話 Σ instance-rows 2917 → 3779、cap 223 → 176,
  又掉回撕裂區。把「被主冠擋住大半」的小簇退回保險絲,額度留給看得見的那幾團;逐株閘同理
  (meranti 一度貼到 1215/1260 = 96%,讓出一列後回到 972/1260)。
  ④**保險絲剪影也一起變了**,這是刻意的:骨架住在零件表,`g` 與 `lib` 讀的是同一張表 ⇒ 載不到
  GLB 的人看到的也是新樹型,只是每一團是 ico 而不是實拍起伏。
- **抓取節流:又是小時級的長時窗**(§5i 同款,與 §5b 的「10 分鐘窗放 2~3 張」不同)。
  第 1 輪 25 張之後,第 2~3 輪 0 張,再加 3 輪 × 15 分鐘冷卻仍 0 張。這一輪另外量到
  **Openverse 自己也開始回 HTTP 401**(第 3 輪起;先前只有 Commons 的 429)⇒ 兩個 API 同時
  進節流時整輪真的一張都拿不到。補抓指令:`node fetch_photos.mjs --family tree --limit 25`
  (reverent-pascal 資料家),**隔天再跑**。
- **待續(誠實記錄)**:①**26 個新照片列裡有 20 列還在 0~3 張**(灌木只有 boxwood/rhodo/sage
  到貨、闊葉只有 jacaranda/olive、針葉只有 cedar/araucaria/juniper、神木只有 cryptomeria 1 張);
  ②因此**一般植被的三個型只各有一個形狀**(灌木黃楊、闊葉橡樹冠、針葉雲杉 + 猴謎樹頂梢)——
  使用者要的「不同國家地區的不同樹種」在**神木**那半兌現了(11 形),在**一般植被**那半還沒有,
  補足要等照片(**但骨架已經逐型不同了** —— 見上面的零件表重寫);③`conifer`/`conifer3`/`conifer4`
  的冠層是 cone/cyl 包絡,**不換**(塞進去會被
  拉成柱子);④`sapling`/`bamboo` 未接(sapling 冠簇 0.36~0.55m、bamboo 全是 cone);
  ⑤未跑:`audit_traverse`(㋓ 需網路;冠簇不登記碰撞柱、Quaternius 退場也不動碰撞 ⇒ 路徑
  結構上不可能改變,但沒跑就是沒跑)、真機互動冒煙(走過一片林子 + 30 秒穩態幀時)。
  **幀時這一輪有反向的好消息**:Quaternius 退場讓 aokigahara 全場三角形從 2,711,079 掉到
  1,447,601(四場皆降 27~49%),而植被層只從 161,783 升到 175,178。

## 5l. Trial log (2026-08-06, 3060-machine session — plan §1 那道「must measure first」的 TRELLIS 閘門終於被跑了,而它**沒過**)

> 起因是使用者問「新完成的 3D 物件都用哪些方法?有其他更適合的模型嗎?」。答案的前半是帳上讀得到的
> (23 筆來源帳:22 筆 SF3D、1 筆純資料件),後半就是這一節 —— plan §1 從 2026-08-04 起掛著
> `⚠ must measure first`,十天內每一輪都直接從梯子最底層的 SF3D 開始,那道閘從來沒有人去撞。

- **這張卡跑不動 TRELLIS,而且是排除掉所有可疑因素之後的結論。** 逐階段量測(WSL2 Ubuntu 24.04 /
  RTX 3060 12GB / torch 2.5.1+cu121 / xformers backend / `SPCONV_ALGO=native`):

  | 階段 | 可用顯存 | torch 配置 | 結果 |
  |---|---|---|---|
  | 起始 | 9165 MiB | 1413 MiB | — |
  | 影像條件(DINOv2) | 9695 MiB | 1431 MiB | ✅ |
  | 稀疏結構取樣 → 4158 voxels | 9685 MiB | 1432 MiB | ✅ |
  | slat 取樣 | 9681 MiB | 1432 MiB | ✅ |
  | mesh 解碼器上 GPU | 9581 MiB | 1605 MiB | ✅ 常駐成功 |
  | **flexicubes 網格抽取** | — | — | ❌ **CUDA out of memory** |

  失敗點恆定在 `trellis/models/structured_latent_vae/decoder_mesh.py to_representation` →
  `representations/mesh/cube2mesh.py`。**排除項逐條都做過了**:未用的兩個解碼器(`slat_decoder_gs`
  /`slat_decoder_rf`)`pop` 掉不載、其餘四個模型逐階段 `.to('cuda')`/`.to('cpu')` 只留當前那一個、
  `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`、停掉佔著 VRAM 的 ollama 把基準壓到 1.0GB。
  **在 9.58GB 完全空著的情況下,單是 flexicubes 那一步就吃不下** ⇒ 官方寫的 16GB 是真的,
  而「12GB 跑得動」的社群回報要嘛是別的輸出格式(gaussian/radiance field 不走 flexicubes)、
  要嘛是量化建置。前三階全過這件事值得記著:**出局的不是 TRELLIS 的推論,是它的網格抽取**。

- **plan §1 的那一行本身就寫錯了,而錯法是把兩代混在一起。** 原文:「TRELLIS.2-4B … README says
  24GB;community/ComfyUI builds report **8GB@256 / 12GB@512**」—— 256/512 是 **TRELLIS 1** 的
  sparse-structure 解析度,TRELLIS.2 的解析度下限就是 512³、官方要 24GB(A100/H100 驗證)。
  兩者的門檻、參數量(1.2B vs 4B)、可調旋鈕都不一樣,合成一行的結果是**梯子最上面那一階根本
  不存在**:在 12GB 卡上 TRELLIS.2 連載都不必試,而 TRELLIS 1 也只走得完前三階。
  `Fallback chain` 的頭兩階 `TRELLIS.2@512 → TRELLIS.2@256` 在這張卡上是空的。

- **安裝面積比 plan 估的小一個量級,這一條對下一個人有用**:只要**幾何**不要 PBR(plan §0
  「Hunyuan's paint stage is never run」同一條),`nvdiffrast`/`nvdiffrec` 整組跳過;`flash-attn`
  走官方支援的 `ATTN_BACKEND=xformers`(預編 wheel,不現場編譯)。**零 sudo**:Ubuntu 24.04 自帶
  gcc/g++/make/git/nvcc 與 libGL/glib,只缺 cmake/ninja 而兩者 `uv pip` 裝得到。實際落地 7.5GB
  venv + 2.9GB 權重,不是官方說的 50–100GB。**但 `kaolin` 是必要的**(我一開始判斷它只服務算圖
  ⇒ 錯):flexicubes 的 mesh 表徵吃它,NVIDIA 有對應 torch 2.5.1+cu121 的預編 wheel
  (`-f https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.5.1_cu121.html`),不必編譯。
  另外 `plyfile`/`xatlas`/`pyvista`/`pymeshfix`/`igraph` 是模組層 import,一次補齊。

- **逐階段 offload 有一個會靜默壞掉的地方**:`Pipeline.device` 取「第一個有裝置的模型的裝置」,
  模型分散兩個裝置時它回報 `cpu` ⇒ 內部建立的輸入張量跟著建在 CPU 上,與已上 GPU 的權重打架,
  錯誤訊息是 `Input type (torch.FloatTensor) and weight type (torch.cuda.FloatTensor) should be
  the same`,看起來像模型 bug 而不是自己的 offload 寫錯。把 `device` 釘死成 cuda 即可。

- **WSL2 是這台機器上唯一可行的路,而它的 VHD 要先搬家。** 原生 Windows 編不動(沒有 MSVC),
  TRELLIS 官方也說 Windows 支援是實驗性、建議 WSL2。Ubuntu 的 `ext4.vhdx` 已經 95.69GB 且住在
  C:,而 C: 當時只剩 23GB / 98% 滿 ⇒ **VHD 在宿主端長不了**(WSL 內 `df` 顯示 870G 可用是虛擬
  大小,會騙人)。`wsl --manage Ubuntu --move D:\wsl\Ubuntu` 走完約 29 分鐘(95GB,實測 C: 讀
  ~50MB/s / D: 寫 ~60MB/s),搬完 **C: 23GB → 119GB**;搬移期間 `wsl -l -v` 會整個卡住(服務被
  鎖),那是正常的、不是掛掉。GPU 直通搬移前後都正常。

- **SF3D 在三族「知名主體」上的基準(使用者定案的測試集:都市建築 / 知名神木 / 知名巨岩)**,
  同一組參數 `--texture-resolution 512 --remesh_option triangle --target_vertex_count 520`,
  峰值 VRAM 6.1–6.2GB:

  | 主體 | 來源 | tris | fill | `mesh_stats` 判讀 | 目視 |
  |---|---|---|---|---|---|
  | Art Deco 摩天樓塔冠 | Openverse CC0 | 802 | **0.048** | 殼/碎片 ✗ | 糊成一團 + 一片突出平板,退縮量體全失 |
  | Chief Sequoyah 神木 | Commons PD | 928 | 0.274 | 比例偏(柱/板) | 一根光滑柱體,板根與火痕樹洞不見 |
  | Devils Tower 巨岩 | Highsmith PD | 930 | 0.313 | 塊狀候選 ◎ | 量體對了,但**柱狀節理**全失、頂面變圓 |
  | hoodoo 帽岩+細頸 | Commons PD | 570 | 0.065 | 殼/碎片 ✗ | 塌成薄片 |
  | hoodoo 整座 | 同上 | 900 | 0.227 | 比例偏 | 塌成薄片 |

  **一個反直覺、而且方向上支持 plan §8 的量測:最乾淨的那張照片(夜空背景、輪廓分明的摩天樓)
  fill 最低。** 規則性人造幾何從單一角落視角看,單前饋模型推不出深度,只生出一片立面殼 ——
  §8 把「規則/人造幾何 → 純資料件、有機不規則 → img→3D」當成分流原則,這是它第一次有實測數字,
  而不是只有論證。反過來說 **Devils Tower 是全場唯一過前篩的**,也正好落在 §8 說的那一格。

- **hoodoo 那六張的實際盤點(§5j 待續 ① 的補完)**:2 張 Bryce 全景、1 張熱氣球觀光照、
  **1 張刻著 KAPADOKYA 的觀光紀念品陶藝**、1 張三柱+電線、1 張乾淨單體(`wc_112762573`,
  平衡帽岩 + 細頸 + 藍天)。紀念品是 §5j「彩繪石雕」之外的**另一種**失敗型態,列進 `photo_sheet`
  的擋下清單。可用度 1 clean + 2 croppable,與 §5c/§5j 的 ~1/6 同量級。

- **未跑 / 待續**:①**fallback chain 的下一階還沒撞** —— `Hunyuan3D 2.1 shape-only`(官方 10GB,
  對這裡實測的 9.5GB 可用仍屬邊緣)⇒ 應直接走 **Hunyuan3D-2GP** 低規建置(內建 CPU offload,
  plan §1 表裡本來就列著);②因此**這一輪一顆節點都沒有出貨**,`parts_manifest.json` 不動、
  `METHODS` 不新增 `trellis` 鍵(沒有產物就不該有方法字彙,原則 6);③plan §1/§8 的更正尚未寫入
  (使用者指示先寫 runbook)。

## 5m. Trial log (2026-08-06 晚, 3060-machine session — Hunyuan3D-2GP 閘門:**開**;首個 2GP 節點 hoodoo_a 出貨)

> §5l 三件待續的收尾輪:①fallback chain 下一階撞了(這一節);②plan §1/§7/§8 更正寫入
> (§1 表拆開 TRELLIS 1 / TRELLIS.2 兩代、fallback chain 頭兩階標空、§8 補 SF3D 三族 fill 實測);
> ③照片節流同晚探測**未退**(tree --limit 25 一輪 0 張,Openverse 401 + Commons 429 都還在封 —— 隔天再抓)。

- **2GP 在這張卡全開,而且餘裕大得反直覺**:§5l 同組知名主體 7 張全過,**逐張 torch 峰值
  恆 2524MiB、GPU 全程 free ≥10.2GB、61~67s/張**(SF3D 6.17GB/7s —— 2GP 慢 9 倍但 VRAM
  只吃 40%)。安裝:獨立 venv `~/ai3d/.venv311hy`(不動 §5l 的 TRELLIS venv,量測可重現;
  torch 2.5.1+cu121 + mmgp 3.2.7 + transformers 4.49.0;uv venv 缺 setuptools 的 §5c 老坑又咬一次
  —— mmgp→optimum.quanto 要它)。`diso` 不裝(dmc 是編譯件),`mc_algo='mc'` 走 skimage;
  texgen/custom_rasterizer 整組跳過(plan §0 paint 不跑)。權重 `tencent/Hunyuan3D-2`
  dit-v2-0 fp16 4.9GB(下載 16 分、熱載 3.6s)。runner `~/ai3d/run_hy.py`(mmgp offload
  profile 3 + `_execution_device` 釘 cuda,gradio_app 的做法照抄)。
- **品質恰好收復 §5l 點名的兩個 SF3D 失敗型態**(fill 前篩 + 人眼渲染複核):
  ①hoodoo **同一張** `wc_112762573`:SF3D 兩參數皆塌片(0.065/0.227)→ 2GP **0.274 ◎,
  帽岩/細頸/基座全保住**(細頸正是 §5j 待續① 說 SF3D 最容易掉的識別特徵);
  ②Art Deco 摩天樓:SF3D 0.048 立面殼 → 2GP **0.447 ◎,退縮量體一階一階清楚**——
  原生 3D 擴散推得出深度,單前饋推不出,§8 分流原則的第二組實測數字(方向仍支持分流:
  規則幾何的純資料件仍然零成本零授權,2GP 只是把「必須用照片的人造物」從不可能變成可行);
  ③魔鬼塔 0.404 ◎(裙狀崖錐 + 平頂)。7 張人眼取 3(~1/2;SF3D 語料可用率 ~1/6)。
  落選四張仍是輸入問題(場景照地面片、背景元素黏進網格、空心殼)—— 挑片紀律不變。
- **`rock/hoodoo_a` 出貨**(D-5 待續① 補完;首個非 SF3D 的庫節點):
  兩段式減面 —— 2GP 原生是 **mc 實心網格 watertight**(213,682 面),pymeshlab quadric
  大比例(213k→560)安全(§5e 的撕裂警告是「SF3D 薄殼 + Blender 硬減面」那條路),
  末段 Blender 1.5:1 溫和(560→382 ≤ 430 留餘裕,§5j 教訓)。單位包絡 1×1、佔比 95%。
  MEGA_LIB.hoodoo 列啟用(呼叫點 D-5 就寫好了,逐柱一顆、柱數 2~4、兩條路零 rnd);
  **預算分母 29 不動**(hoodoo 型整顆 = 4+4+2+15 = 25 < marble 的 29,tri_budget 註記)。
- **座號組重掃踩到一個「差點量錯」**:直呼 `synthMegalith(mulberry32(seed))` 掃出來的
  seed→岩型映射與台子**不同** —— 台子雜湊過(`(seed×2654435761)>>>0`)。用錯映射會挑到
  一顆台上根本不是 hoodoo 型的座號,而台上只顯示「這顆座號沒用到這個節點」= 看起來像
  掃過了。正確映射下 hoodoo 型只在 #22/#33;#1 mesa、#7 tower、#10 marble 各自必要
  (mega_f 只有 marble 的 8 疊塊輪得到)⇒ **加 #22 成四顆,不換掉誰**。
- **wsl.exe 會把多行腳本的換行接成空白**(本輪三次踩同一個坑才定位):`wsl -- bash -lc '<多行>'`
  的變數賦值行被接進上一行變成 `cd` 的多餘參數,`$M` 靜默變空;heredoc 同理被絞。
  對策 = 一律 Write 落地 .sh 到 /mnt/c、`tr -d '\r'` 拷進 WSL 再執行;另外 `bash -lc 'A && B & echo'`
  的 `&` 把**整串**丟背景,wsl.exe 一退出 distro 幾秒內 teardown 連 nohup 都帶走 ——
  長跑一律讓 wsl.exe 前景活著(外層背景任務)。
- **閘門全綠**:intake 240(hoodoo_a 包絡/預算 4 項新增)/ siteplan 187 / joints 21611-0
  (hoodoo 柱的接合全乾淨)/ beacons 68 + `--break-extent` 反向紅 / cel 52 / visual_prefs 124 /
  gpu 54 / soft_stroke 73 / `measure_megalith_tris` rnd 對帳 1000/1000(hoodoo 節點載入下);
  e2e 全綠(**8666 上先撞到一支 8.4 小時的舊伺服器** —— #INC-101 流程救了這一輪:kill 後
  fresh server 再測)/ bal 全綠(⑦f 1.09× 不動)。對照台 0 缺件/0 孤兒/0 未記載;
  provenance `METHODS` +`hunyuan_2gp` 鍵(§5l 當時不加是因為零產物;現在有了),
  帳列含 `imgs[].file`(漏了這一欄的症狀 = 台上「原圖不在本機」而照片明明在)。
  視覺閉環:座號 #22 保險絲 vs 零件庫並排(左 = 平滑柱+綠苔平帽的程序 hoodoo、
  右 = 實拍岩柱群),兩側都落地、崩落塊/疊石正常。
- **未跑 / 待續**:①`audit_traverse`(㋓;巨岩零件不動碰撞柱 ⇒ 結構上路徑不可能變,但沒跑
  就是沒跑);②真機互動冒煙(走過 hoodoo 巨岩 + 30 秒穩態幀時);③2GP 對**神木**沒有幫上
  (兩張 sequoia 都碎 —— 樹的問題仍是輸入語料不是模型);④摩天樓 0.447 那顆**沒有出貨**
  (整棟建物節點還沒有消費端,§5i 待續同款 —— 先開縫再入庫);⑤照片 20+ 列缺額等節流退
  (隔天 `--family tree/rock/building --limit 25` 逐族);⑥hoodoo 只有 _a 一形,#33 那顆
  座號留給下一形驗異質性。

## 5n. Trial log (2026-08-06 深夜→07 凌晨, 3060-machine session — TRELLIS.2(stableprojectorz fork)閘門:**開**;§5l「頭兩階是空的」被 fork 翻案)

> 使用者問「TRELLIS.2-stableprojectorz 專案的 img to 3D 可應用於 steel_vs_swarm 嗎」——
> §5l 判 TRELLIS.2 出局的前提是**官方建置**(24GB、Linux-only);IgorAherne 的
> StableProjectorz fork 宣稱 8GB@1024³ + Windows 原生 + 全預編 cp311 wheel,正好逐條
> 對著 §5l 的死因打 ⇒ 使用者指示「先在 3060 上跑閘門量測」。本輪**原生 Windows**
> (非 WSL2),獨立 venv,§5l/§5m 同組 7 張 matte,同一支 `mesh_stats` 前篩。

- **閘門開:7/7 全過 @1024_cascade,59~226s/張,VRAM 餘裕大到反直覺。** 量測環境:
  study clone `C:\Users\user\Documents\study\TRELLIS.2-stableprojectorz`(venv `.venv`、
  runner `run_t2_gate.py`、產出 `out_gate*/`)、torch 2.8.0+cu128 / xformers 0.0.32.post2 /
  triton-windows 3.4;參數 = 模型自身預設(steps 12 / ss 7.5·0.7·5.0 / shape 7.5·0.5·3.0 /
  tex 1.0·0.0·3.0;fork API 的 12 步「快檔」**就是** TRELLIS.2-4B pipeline.json 的原廠值)、
  seed 1234、decimation 50k、texture 1024:

  | 主體 | 總秒 | sample+decode+glb | raw faces | torch 峰值 |
  |---|---|---|---|---|
  | hoodoo `wc_112762573` | 111.3 | 91.0+6.2+14.1 | 3.84M | 2853MiB |
  | 神木 `wc_82407863` | 59.4 | 51.7+2.8+4.9 | 1.45M | 2746MiB |
  | 神木 `wc_82468948` | 61.2 | 53.1+2.9+5.2 | 1.54M | 2746MiB |
  | Art Deco 摩天樓 `ov_5846` | 226.4 | 198.4+19.1+9.0 | 12.19M | 3409MiB |
  | 直櫺辦公樓 `ov_fde7` | 133.2 | 114.5+10.3+8.4 | 6.18M | 2974MiB |
  | 魔鬼塔 `ov_163a` | 111.3 | 96.8+7.6+6.9 | 4.32M | 2909MiB |
  | 魔鬼塔 `ov_f94b` | 106.0 | 93.0+6.5+6.5 | 3.96M | 2890MiB |

  nvidia-smi 每秒輪詢全程裝置峰值 6648MiB(含桌面基準 ~2.3GB)= **free 恆 ≥5.4GB**;
  §5l 殺掉 TRELLIS 1 的網格抽取,在 O-Voxel 路徑上是 decode 峰值 0.7~3.4GB 的小事。
  載入 68s(權重駐留 CPU)。速度定位:SF3D 7s ≪ 2GP 61~67s ≈ **T2 59~226s**(voxel 數
  隨主體變,建築最貴;steps 25 時魔鬼塔 292.6s)。
- **真正的門檻是 RAM 不是 VRAM**:low_vram 模式整套模型駐留 CPU **~19GB**,32GB 機器
  avail <20GB 時 `from_pretrained` **無聲死亡**(exit 5、零 traceback —— 第一次背景跑就這樣
  死的,GPU 從頭到尾沒被碰)。對策已寫進 runner:依 pipeline type 踢掉用不到的模型
  (cascade 不用 `tex_slat_flow_model_512`)、matte 有 alpha 就踢 rembg ⇒ 載完 avail 2~3.5GB
  可跑完整批。跑批前先確認 avail ≥20GB,或先關瀏覽器。
- **安裝的三個坑(下一個人照抄)**:①installer 的 urllib 抓 GitHub release zip 只有
  17~62KB/s(pip 同時在抓 torch 會把頻寬搶光)——先 pip 完再 curl zip,dinov3 1.07GB +
  RMBG-2.0 785MB 就恢復 ~11MB/s;②**wheel 沒打包 `flex_gemm/kernels/triton/`**(`try: import
  except: pass` 靜默吞掉,直到 to_glb 的 grid_sample 才炸 `has no attribute 'triton'`;取樣
  不炸是因為 spconv 分派吃 `ALGORITHM` 設定恆走 EXPLICIT_GEMM)⇒ 從上游 FlexGEMM 拷
  `kernels/triton/` 進 site-packages,而上游 HEAD 的 `spconv/__init__.py` 又引用八個不存在的
  submanifold 模組 ⇒ init 补 try/except(有留檔註解);③sm_86 自動偵測會選 `flash_attn`
  而 whl/ 沒有那顆 ⇒ **`ATTN_BACKEND=xformers` 必須顯式設**(§5l 同款)。附帶:Blender
  headless 的相對 render 路徑會落到**磁碟根目錄**(`C:\out_gate\`),一律給絕對路徑。
- **`mesh_stats` 的 fill 這把尺對 TRELLIS.2 結構性不適用 —— 別拿它判死最強的模型。**
  七張全被判「殼/碎片 ✗」(fill 0.004~0.025),而人眼有兩張 ◎:O-Voxel 產出是**雙層
  薄殼**(trimesh 驗證:焊掉 UV 縫後開放邊 ~0、`fix_normals` 後 fill 仍趨近 0 = 幾何上
  封閉但不包體積,by construction)。fill 的語意是「實心度」,是為 SF3D 設計的(薄殼 =
  垃圾);對 T2 薄殼 = 常態,判讀只能靠人眼渲染(Blender headless 兩視角 contact sheet,
  `render_gate.py`/`sheet_gate.py`)。連帶警告:**薄殼大比例減面正是 §5e 撕裂警告的那一族**
  (2GP 是實心 mc 網格才敢 213k→560),入庫前 MUST 實測 50k→~500 的減面路徑(**§5o 已實測:
  直接減面確實壞掉,要先實體化**)。
- **人眼判讀(對照 §5l SF3D / §5m 2GP 同組)**:
  ①**建築雙 ◎ —— 這是 T2 的甜蜜點**:Art Deco 摩天樓四面退縮量體 + 窗格貼圖全在
  (SF3D 0.048 立面殼、2GP 0.447 shape-only);直櫺辦公樓箱體 + 垂直櫺線完整。且 T2 是
  **幾何 + PBR 貼圖一次出**(2GP 的 paint 從來沒跑)⇒ 建築整棟節點的縫(§5i/§5m 待續)
  開了之後,T2 是首選生成器;②魔鬼塔 seed 1234 = 正面浮雕背面開口 △,seed 42/steps 25 =
  **全閉合筒身+裙錐 ◎ 但貼圖整體掉成深藍 ✗** ⇒ 浮雕化是**逐 seed 抽籤不是結構性失敗**,
  shape 與 texture 各自有方差 ⇒ 岩石類要 per-seed 重抽紀律(挑片紀律的延伸);③神木仍碎
  且**把照片裡的遊客生成出來**(2GP 同病)—— 樹的問題仍是輸入語料不是模型(§5m ③ 不變)。
- **同一張 matte ≠ 同一個輸入(本輪最重要的一課)**:hoodoo 錨點圖三種輸入三種結果 ——
  SVS matte(下半身**軟 alpha 漸層**,≤8/255)→ T2 preprocess「bbox 取 alpha>204 裁切 +
  RGB×alpha 預乘到黑」把基座**整段裁掉** ⇒ 生成石板,忠於它看到的殘片;同檔案 2GP 全身
  保住是因為 hy3dgen 前處理自己閾值化;原圖 + fork 內建 RMBG-2.0 → 背景同質岩壁剝不掉 ⇒
  **場景地形塊**(hoodoo 本體帽岩/細頸/基座俱全,但埋在場景裡 = §5m 落選同族)。
  ⇒ 接進 SVS 管線的紀律:**餵 T2 的 matte MUST 先驗 alpha 直方圖、軟 alpha 先二值化**
  (>16 → 255);同時這解釋了 §5l SF3D 在同一張的 0.065/0.227 —— 那半條帳也是輸入的。
- **定位定案**:fallback chain 頭兩階從「空」變「**開(fork 版)**」,階梯 =
  `T2-spz(建築/規則幾何、要貼圖時)→ 2GP(實心岩體)→ SF3D(量產快篩)→ procedural`。
  T2 不取代 2GP:薄殼 vs 實心、9~30 倍慢於 SF3D、RAM 門檻高;它拿下的是「SF3D 推不出
  深度、2GP 沒有貼圖」的那一格。
- **未跑 / 待續**:①**零節點出貨** ⇒ `METHODS` 不加鍵、`parts_manifest` 不動(原則 6,
  §5l 同款);②薄殼 50k→~500 大比例減面未測 —— 這是入庫前的下一道閘(**已於 §5o 跑完:
  直接減面關、先實體化再減面開**);③512 / 1536 兩檔
  解析度未量(512 應更快,1536 疑似撞 RAM);④plan §1 表待補一行 fork 建置(與官方
  TRELLIS.2 分列,勿再混寫 —— §5l 的教訓);⑤建築整棟節點的消費端縫仍未開(§5i/§5m
  待續同款),開了才輪得到 T2 的甜蜜點兌現;⑥texture 掉色(魔鬼塔深藍)未歸因,懷疑
  tex_slat 對 seed 敏感,出貨輪要 A/B。

## 5o. Trial log (2026-08-07 凌晨, 3060-machine session — §5n 待續② 的薄殼減面閘門:直接減面**關**,「先實體化再減面」把它**打開**)

> §5n 收尾寫著「薄殼大比例減面正是 §5e 撕裂警告的那一族,入庫前 MUST 實測 50k→~500」。
> 這一輪就是那道閘。量測環境同 §5n(study clone、同一個 `.venv`,另裝 `pymeshlab 2025.7` +
> `fast-simplification` + `rtree`),腳本 `decim_gate.py`(三條路徑 + 拓樸/偏差量測)與
> `render_decim.py`(黏土渲染),產出 `out_decim*/`。**零節點出貨**(`METHODS`/`parts_manifest` 不動)。

- **結論**:T2(O-Voxel)的產出**不能**直接走 §5m 那條兩段式減面入庫;要進零件庫必須多一道
  **實體化(volumetric resample)**。三條路徑逐一實測(四顆主體 × 目標 2000/900/500):

  | 主體 | src 面/開放邊/元件 | A trimesh quadric 實得面 | B pymeshlab→500 面/元件/v:f | C 實體化→500 面/元件/v:f/開放邊 |
  |---|---|---|---|---|
  | Art Deco 摩天樓 `ov_5846` | 49,845 / 34,751 / 3,123 | **4,688(三個目標同值)** | 491 / 335 / 2.24 | 499 / 8 / 0.58 / 97 |
  | 直櫺辦公樓 `ov_fde7` | 49,385 / 22,517 / 990 | **6,076** | 497 / 398 / 2.50 | 500 / 9 / 0.48 / 0 |
  | 魔鬼塔 `ov_163a` | 49,791 / 32,509 / 2,534 | **4,646** | 499 / 479 / 2.86 | 500 / 3 / 0.51 / 8 |
  | hoodoo `wc_112762573` | 47,567 / 23,029 / 1,364 | **2,865** | 499 / 468 / 2.83 | 500 / 2 / 0.50 / 0 |

- **路徑 A(trimesh / fast-simplification quadric,保拓樸)結構性打不到預算,而且不報錯。**
  2000 / 900 / 500 三個目標回傳**逐位元同一個面數**(2,865~6,076 = 預算的 5.7~12.2 倍)——
  它塌不過元件邊界,撞到地板就停,然後**照樣回傳一顆網格**。呼叫端要 500 拿到 6,076,
  唯一會攔下來的地方是 `intake_parts` 的三角形閘;少了那道閘就是「零件庫悄悄多了 12 倍面數」。
- **路徑 B(pymeshlab quadric,`preservetopology=False`)打得到精確目標,代價是產出變成三角形湯。**
  499 面 / 468~479 元件 / v:f ≈ 2.8 ⇒ **平均每個元件 1.0~1.5 面** = 幾乎每一面都是一片孤立三角形。
  對塊狀岩體(魔鬼塔)遠看還像個東西(孤立三角形照樣覆蓋在原輪廓上),對建築當場炸開
  (Art Deco 剩幾片大三角 + 一叢針狀刺)。
- **方法論:表面偏差(dev)量不出撕裂 —— 誰拿它當通過條件,誰就會把彩紙入庫。**
  以包圍盒對角線正規化的最近距離,B→500 的 `dev_p95` 只有 0.0034~0.0057(魔鬼塔 0.0045),
  完全「合格」,因為**孤立三角形本來就貼在原表面上**。真正的偵測器是拓樸兩欄:
  健康的封閉件 **v:f ≈ 0.5、面/元件 = 全部**;三角形湯 **v:f → 3、面/元件 → 1**。
  唯一 dev 也一起爆掉的是 Art Deco(0.0686)—— 那是因為它連輪廓都沒剩。
- **路徑 C(先 uniform volumetric resample 實體化,再 quadric)是唯一兩者同時成立的路。**
  `generate_resampled_uniform_mesh`(cell = 對角線/256、offset = 對角線 ×0.6%)把雙層殼併成
  一層等值面 ⇒ 之後的 quadric 就與 §5m 那顆 2GP 實心 mc 網格同處境。精確打到 500 面、
  **v:f 0.48~0.58、元件 1~9、開放邊 0~97**;`dev_mean` 恆 **0.0051~0.0057 ≈ offset 本身**
  —— 偏差的主項是設計上的等距外移而不是撕裂,這條自洽性檢查值得留著當回歸判準。
- **「原生網格比較乾淨」這條假設被否掉了 —— 兇手不是 fork 的 86:1 減面。**
  魔鬼塔重跑一次 `--decimate 500`(4,318,700 → **473,280** 面,132.4s,torch 峰值 2,911MiB 不變,
  glb 匯出 6.9→17.4s):**開放邊 205,236(0.434/面)、元件 9,898**。50k 版是 0.653/面 ——
  同一個量級,**O-Voxel 的輸出本身就不是封閉面**(§5n 已用 trimesh 驗過「焊掉 UV 縫後 fill 仍趨近 0」,
  這一輪是同一件事的拓樸版證據)。⇒ 「取原生網格再自己減面」不是解法,實體化是必需品。
  附帶:50k 與 473k 的黏土渲染**肉眼幾乎分不出來** ⇒ fork 的預設減面在外觀上沒有損失,
  沒有理由為了品質去付 RAM 與匯出時間(473k 那次載入後 `ram_avail` 只剩 **1.3GB**,起跳是 20.3GB)。
- **人眼複核 MUST 剝貼圖(clay pass;`render_decim.py` 一律清掉材質),但 clay 也看不出不封閉。**
  逐族對照表(`family_sheet.py` → `out_sheets/t2_{building,rock,tree}.png`:輸入 matte → 貼圖
  兩視角 → 黏土)跑完之後,§5n 的「建築雙 ◎」**維持成立** —— 黏土渲染下 Art Deco 的退縮量體
  一階一階都在、直櫺辦公樓箱體完整,立面上那些縱向紋路是**窗帶/櫺線本身**,不是破洞
  (魔鬼塔柱身的縱溝同理,那是它真實的柱狀節理)。⇒ **「不封閉」在物件尺度上是看不見的**,
  能分辨的只有開放邊/元件那兩個數字;clay pass 的用途是「識別特徵在不在」與「減面後有沒有塌」,
  MUST NOT 拿它當封閉性的判準(反過來,貼圖 pass 連減面塌陷都會蓋掉,更不能用)。
  clay 真正抓到的一件事是**背面**:魔鬼塔兩顆的側視都是一片開口的殼(§5n 記的「正面浮雕、
  背面開口」),而那正是「薄殼」在畫面上唯一自己現形的地方。
- **500 面這一級留不住建築的識別特徵**:C→500 的魔鬼塔 ◎(柱身 + 裙狀崖錐都在),但 Art Deco
  的退縮量體被抹平成一團(`dev_p95` 2000 面 0.0088 → 500 面 0.0144)。⇒ 建築整棟節點若真要用 T2,
  **預算不是 500 這一級**;這件事要與 §5i/§5m 待續的「消費端縫」一起定,別分兩次做。
- **逐族對照表(交接用)**:`family_sheet.py` → `out_sheets/t2_{building,rock,tree}.png`,
  逐列 = 輸入 matte → T2 貼圖兩視角 → 黏土。**建築 2/2 ◎**(退縮量體/箱體+櫺線,幾何 + PBR
  一次出);**巨石 2/3 ◎**(魔鬼塔兩張;側視看得到背面開口 = 薄殼在畫面上唯一現形處)、
  hoodoo ✗ 是 matte 軟 alpha 被裁的輸入問題;**神木 0/2**(碎裂,而且把照片裡的遊客一起
  生成出來 —— §5n③「樹的問題是輸入語料不是模型」再確認一次)。⇒ 這張表直接定了下一輪的
  兩件事:**建築的生成品質已經夠了,缺的只有消費端縫(佇列 F)**;而**神木要回到採集端重來**
  (佇列 F0,使用者定案「重新找有神木全身、無其他干擾的照片」—— 三個模型在同一批 sequoia
  上全數碎裂,換模型已經換過兩次了)。
- **未跑 / 待續**:①實體化那一刀**還沒進 `normalize_parts.py`** —— 這一輪只在 study clone 量,
  出貨輪要決定它是入庫前的離線步驟還是 normalise 的一段(前者較符合 A2/原則 6:
  Blender 沒有 volumetric resample,pymeshlab 是**新的離線相依**,MUST NOT 進 `package.json`)
  **(→ §5t 已定案落地:入庫前離線步驟 `tools/ai3d/solidify_parts.py`)**;
  ②C 的兩個旋鈕(cell 256 / offset 0.6%)沒有掃描,offset 直接決定「胖多少」而包絡契約會抓它
  **(→ §5t 已掃描:3×3 全平台,凍結值在平台中央)**;
  ③建築預算該落在哪一級沒量(2000 面看起來夠,但零件庫現行是 400~900);
  ④§5n 待續 ③④⑤⑥ 原封不動(512/1536 解析度、plan §1 補行、消費端縫、texture 掉色)。

## 5p. Trial log (2026-08-07, 3060-machine session — 佇列 F0 執行:選片閘上線、語料帳改「可用張數」、孤立單株重採、T2 黏土複驗 5/5 不再碎裂)

> 使用者指示「接著 PR #160 的進度,在 main 重開一個分支繼續」⇒ 本輪 = **佇列 F0 逐條照做**
> (F0 是使用者 2026-08-07 定案的最優先;佇列 F 建築縫排下一輪)。

- **選片閘 `tools/ai3d/screen_mattes.py` 上線(F0 第一步「補閘,不是再抓一輪」)**:三統計桶
  (門檻與 82 張校準記錄全住檔頭)—— 剝空/主體太小 27、印刷品 10、葉片標本 3,對上人眼分桶
  ~25/~13/~11;**已知可用 16 張零誤殺**(硬約束;可用者最低 cov 0.100 vs 門檻 0.05 = 2× 邊際);
  反向驗證 `BLANK_COV 0.05→0.30` ⇒ 倖存 42→7 紅(原則 9)。統計倖存 42 逐格人眼再淘汰 26
  (烏龜/魚/壓葉標本/浮世繪明信片/含遊客紅杉…)⇒ 82 張既有 matte 可用 = **16**,與 F0 的
  「~16~18」逐張對上。人眼判決(`--human pass|reject`)恆勝統計、統計重跑不覆寫;淘汰者另出
  `out/sheets/tree_screen_reject.png`(誤殺看得見才救得回,原則 6)。
- **帳的語意換掉(F0:「可用張數不是下載張數」)**:`fetch_photos.mjs` 的 `have()`/`--plan`
  只計 screen 未淘汰的條目;淘汰條目仍佔 `seen` ⇒ 同一張垃圾不會被重新下載。`sp_sequoia`
  **want 歸零**(結構性失敗,F0 定案別再抓);F0 列排樹族最前(`gt_dragontree` 新開 +
  canopy/sp_baobab/sp_acacia/sp_conifer/sp_pine 上移),查詢往 lone / isolated /
  full height silhouette 句式。
- **重採兩輪**(Openverse 間歇 401/429、Commons 429 —— §5h 的小時級節流原樣):21 筆新入帳
  (dragontree 3 / canopy 4(其中 4 張是磁碟有檔、帳上從缺的舊檔補登)/ baobab 7 /
  boxwood 3 / cedar 1 / juniper 1 / cypress 2)→ matte → 過閘:統計淘汰 10、人眼淘汰 5
  (向量剪貼圖/柑橘圖鑑版畫(dragontree 查詢誤中)/鄰樹殘塊/老照片含地形塊/樹+大岩塊)
  ⇒ 新增可用 6,樹族可用 **16 → 22**(canopy 6→9 = 句式改善的主證;dragontree 三張只活
  一張石版畫 —— 照片兩張都不是活樹)。另有一小輪**誤啟動**(見下環境筆記 ④)+4 張:
  長頸鹿/犀牛(acacia 查詢)/葫蘆工藝品/岩塊(baobab 查詢)—— 全數「不是樹」人眼淘汰;
  這正是 F0 診斷的再現:**節流主機的淺頁好貨抓完之後,越深的頁面垃圾率越高**,
  續補要等冷卻拿淺頁,不是加深翻頁。
- **T2 黏土複驗(驗收 ③;5 張:大橡樹#16、密冠橡樹(新)、漂白刺果松枯幹(新)、南洋杉#27、
  猴麵包樹白描#58;matte 先二值化 >16→255(study clone `binarize_feed.py`),1024_cascade
  seed 1234)**:**5/5 出網格、58~94s、torch 峰值 ≤2.8GB、raw faces 1.3M~5.5M —— §5n③/§5o
  的「碎裂 + 把遊客生出來」兩個病灶隨語料修正一起消失**(clay `out_clay_f0/`、對照表
  `out_sheets/t2_tree_f0.png`)。人眼判讀:**枯幹 ◎**(真正體積型,側視有厚度 —— 形狀線索強、
  無葉冠的主體是 T2 樹族的甜蜜點,對位 deadtree/snag 節點);其餘四張 △ = **可辨識的樹,但
  單張正面照的茂密冠層出的是「浮雕」**(側視薄板;§5n 薄殼傾向在葉冠主體上的表現形)。
  ⇒ F0 的診斷成立:碎裂的成因是輸入語料;「冠簇節點要不要走 T2」是**下一個問題**
  (浮雕轉不了視角),不是這一輪的失敗。
- **執行環境三筆**:①photo DB(photos 533MB + out 437MB + `photo_manifest.json` 305 筆)自
  reverent-pascal-fcd63e 搬到本分支 worktree(那份已是最新超集;zen-albattani-b33990 從此
  只是 rembg venv 的家);②Windows 主控台 cp950:`screen_mattes.py` 內建 stdout 重設 UTF-8,
  `matte_photos.py` 要帶 `PYTHONIOENCODING=utf-8` 跑(第一次沒帶:第一張存檔成功、print 就炸);
  ③T2 首跑 exit 139 段錯誤 —— **與 rembg 去背同時跑,模型載入撞 RAM**(§5n 的 <20GB 警告以
  另一種死法現形);單獨重跑(avail 19.2GB)全過。**T2 載入與 rembg MUST NOT 同時跑**;
  ④`fetch_photos.mjs` 的 `main()` 是**頂層呼叫** —— 任何 `import` 它的動作(哪怕只想拿
  `PHOTO_CATALOG` 驗個鍵)都會**當場開跑抓取**。要檢查型錄用 `grep`/文字工具,別 import。
- **驗收對帳**:①授權稽核 **264/264 ok 條目 0 違規**;②閘冪等(重跑零改寫、人眼判決保留);
  ③`--plan` F0 列現值:dragontree 1/5、canopy 9/12、baobab 3/6、acacia 1/6、conifer 1/8、
  pine 0/8 —— **缺額是真缺額**,續補用同指令(小時級節流,冷卻後重跑)。
- **未跑 / 待續**:①孤立松柏(conifer/pine)這一輪整批被 401/429 吃掉,冷卻後續抓;
  ②冠簇的浮雕問題:要嘛換斜側面/多視角照片語料,要嘛冠簇維持程序 ico + 照片貼圖,由樹族
  入庫輪定;③枯幹那顆 ◎ 要入庫得走佇列 F 定案的實體化 + 減面路徑(§5o C 路徑),`METHODS`
  的 `trellis2_spz` 鍵仍等**首個入庫節點**才加(原則 6,§5n 同款)**(→ §5t 已加:
  首件 = `rock/tower_a`)**;④`screen_mattes.py` 的
  三桶門檻是 82 張校準的凍結值 —— 語料結構大改(例如大量白背景商品照湧入)要重校,別默默沿用。

## 5q. Trial log (2026-08-07 午後, 3060-machine session — 冠簇路線定案:葉冠不走 img→3D)

> §5p 待續② 的收斂輪:兩個假說各補一組量測,同日關閉。

- **逐 seed 對照(同一張密冠橡樹 matte,seed 1234/42/7;`out_sheets/t2_tree_seed_probe.png`)**:
  1234 = 浮雕(側視薄板帶少量起伏)、42 = **一片平板**(最壞)、7 = 有體積但整團碎塊雲
  (無主幹、葉簇彼此不相連)⇒ **葉冠在 T2 上是逐 seed 抽籤,而且沒有一注是可用冠簇** ——
  單張正面照對「毛茸茸的體積」給不出深度約束,落點在平板與碎雲之間漂。與岩石的 per-seed
  方差(§5n③)不同族:岩石是「浮雕 vs 閉合」兩注都有救、重抽有意義;葉冠是三種都不能用,
  重抽沒有出口。
- **斜側語料探針(`gt_oblique` 列,5 張)**:空拍/俯視查詢撈回的主體天生太小(matte 畫布
  253~711px,4/5 進剝空桶),唯一統計倖存是一座**空拍小島**(人眼淘汰)⇒ 斜側路線在
  **採集端**就死了 —— CC0 語料裡「離機夠近的單株俯拍」實際上不存在,與紅杉「大到拍不下」
  同族的結構性缺片。探針列已 want 歸零收斂(列上有結論註解)。
- **定案(樹族入庫輪的前提)**:①**冠簇維持程序 ico + 照片貼圖**,MUST NOT 再把葉冠照片
  餵 img→3D(三個模型 × 換語料 × 換 seed 都量過了);②**img→3D 對樹族只收雕塑性主體** ——
  枯幹/板根/扭曲樹幹(§5p 的漂白枯幹 ◎ 是範本),對位 deadtree/snag/buttress 節點;
  ③F0 語料庫的價值不因此縮水:可用 22 張裡的冠層照是**貼圖與輪廓參考**(程序冠簇的
  albedo 來源),不是幾何來源。
- 帳面:gt_oblique 5 張全淘汰(4 統計 + 1 人眼),樹族可用維持 22;兩個已收斂的
  want 0 列(sp_sequoia / gt_oblique)不再產生缺額。

## 5r. Trial log (2026-08-07 午後, 3060-machine session — 浮雕救援閘門:幾何閉合**關**,岩石浮雕注的唯一路徑 = per-seed 重抽)

> 使用者問「葉冠或岩石變浮雕時,能不能把水平角度當對稱去跑?多補幾個視角、缺口接合處
> 做近似?」⇒ 方法盤點(工具逐一驗在 venv:pymeshlab 有 **CGAL `generate_alpha_wrap`**、
> screened Poisson、凸包;fork API 收多圖但只用第一張(`generation.py:411/428`)——
> 多圖條件混合要小改 `run()`,列為未跑)+ 閘門實測 `symfill_gate.py`(study clone;
> 測試品 = §5n 魔鬼塔 **seed 1234 浮雕殼**,對照組 = **seed 42 天然閉合**那注,全變體
> 閉合後走 §5o 的 C 路徑到 500 面;產出 `out_symfill{,2}/` + `out_sheets/t2_symfill.png`)。
> 本段跑了**兩輪**:首輪結論被對抗覆核推翻一半,第二輪(誠實版)才定案 —— 兩輪都留著,
> 因為錯的那半正是機制所在。

- **首輪(鏡射平面 = 開放邊界中位數)**:指標把 V1a 鏡射+wrap2% 判為全綠(水密單元件、
  kf_p95 2.3%,勝凸包基線 6.9% 三倍),黏土卻在頂部長出**隧道與簷帽** —— 幻影材料撕裂尺
  與 kf 尺都量不到。**對抗覆核揪出成因:前提整個是錯的** —— T2 殼撕裂遍佈(實測 75% 頂點
  是邊界、2534 元件),「開放邊界 = 後緣」不成立,邊界深度分佈 ≈ 全殼分佈 ⇒ 中位數 =
  體中位平面 ⇒ **鏡射把殼從中剖半**(49% 頂點被鏡穿體、副本突出前緣達原深度 47%)。
  首輪測的是稻草人。
- **第二輪(誠實版:鏡射平面 = 深度背側極值 P99;rot4 軸改包圍盒足跡中心)**:
  V1a 閉合 kf 降到 0.9% 且水密,但深度膨脹到 1.379(CTRL 真塔深 0.944,**+46%**)——
  **殼本身就包過塔身超過半圈**,貼背極值鏡射必然長出**雙瓣體**(黏土側視 = 兩座塔以
  細橋相連),C500 還微破(10 開放邊/2 元件,平面接觸帶太薄)。V2 修軸後 14 → 3 元件
  (覆核者以擬合真軸反事實實測 = 2)⇒ 首輪的 14 元件主要是**質心軸被前板拉偏**的污染,
  但修好也仍碎。⇒ **兩種平面選法用互補的方式證明同一件事:T2 浮雕殼不是「有乾淨後緣的
  半個物體」,鏡射補全沒有合法平面可選** —— 中位面剖體、極值面雙瓣,中間任何位置是
  兩者的線性混合。
- **其餘變體與對照**:V1b wrap5% 減面後破(64~70 開放邊);V3 Poisson 的**本體 kf 0.42%
  全場最佳**,崩的是 C 路徑那一段(42 萬面 Poisson 包膜減面到 932/514 面全開放邊 ——
  目標都沒打到;歸因寫「Poisson 崩」是錯置,覆核已修正);CTRL 再印證 §5o ——「天然閉合」
  也是 2.9 萬開放邊/2443 元件的殼,C 路徑一支就收拾成水密(**不需要 wrap**)。
- **定案(岩石救援紀律)**:①浮雕注的**唯一路徑 = per-seed 重抽**(60~110s GPU;跨 seed
  形狀差 ~9% 但形狀「對」,黏土全場最像)**(→ §5s 部分取代:「唯一」不再成立,缺口楔形
  補丁開為具名備援)**;②**幾何閉合救援閘門關**(鏡射/旋轉/Poisson
  對 T2 浮雕注全數不合格,兩輪實測)**(→ §5s 收窄:不合格的是「整片」鏡射/旋轉/Poisson;
  「補丁照洞剪」的缺口緣鏡射是實測過的例外)**;③工具箱正面收穫:wrap2%+C 能把任意破殼變水密
  單元件 —— 對「形對殼碎」的失敗型態留用,但 CTRL 顯示那種型態 C 路徑自己就夠;
  ④**kf 尺必要不充分**:撕裂尺 + kf + 黏土人眼三者缺一不可(「人眼是主判準」第三次實證:
  fill 尺 §5n、選片統計 §5p、kf 尺本輪);⑤報表紀律:CTRL 的 kf 是**跨 seed 形狀距離**
  不是品質(裸讀 JSON 會把凸包排在重抽前面 —— 報表列已加 `cross_seed_kf` 標記);
  ⑥alpha 的百分比基底是**各 soup 自己的對角線**(跨變體差 13~16%),MUST NOT 把
  「wrap2%」當可移植常數。
- **未跑 / 待續**:①多圖條件混合(同圖/鏡像當多視角)—— `get_cond` 本就收 list、差
  `run()` 一段聚合;在重抽紀律面前優先度低;②葉冠不因此翻案(§5q):這些方法能閉合
  葉冠,但閉合從來不是葉冠的缺口。

## 5s. Trial log (2026-08-07 晚, 3060-machine session — 楔形補丁:§5r「閘門關」部分翻案 —— 補丁照洞剪,缺口緣鏡射就能用)

> 使用者覆核 §5r 第二輪:「誠實鏡射失敗的原因是缺口只有約 30°,拿兩個 150° 去接當然不對,
> 另一片剪一部分去補洞即可」——**方向完全正確、量級低估**:實測缺口 −121°..−6°(span
> 115°;方位角面積直方圖、軸 = 包圍盒足跡中心、空 bin 門檻 = 0.35×中位 bin 面積 ——
> 缺口弧佔圓周 32% 卻只含 4.5% 表面積,r≥0.35 的外牆帶只剩 0.1%,弧內全是 r≈0.22 的
> 內層殘料)。§5r 兩輪的死因就此收斂成一句:**不是鏡射不行,是拿整片 ~240° 的殼去疊
> 115° 的洞**。實測 `symfill_wedge.py` + `gap_probe.py`(study clone;測試品/對照組同
> §5r;產出 `out_symfill3/` + `out_sheets/t2_symfill_wedge.png`)。本輪照 §5r 的教訓
> **先過三鏡頭對抗覆核再定案**(幾何/量測/紀律;零 REFUTED,修正條目已折入下文)。

- **V5a(缺口兩緣各做過軸垂直面鏡射、各補半跨)是唯一過 C500 的補丁變體**:closed 水密
  單元件 kf_p95 0.84%,C500 **水密 0 開放邊單元件**(§5r 第二輪 V1a 的 C500 還有 10 開放邊);
  深度 0.7049 → **0.9338** —— 補丁把背面鼓回去、貼著 CTRL 真塔深 0.9445,不是第二輪的
  1.379 雙瓣。**機制(覆核修正版,MUST NOT 寫成「接縫零位錯」)**:鏡射只固定平面上的點、
  殼緣是參差的 —— 鏡射面取在缺口緣是把緣接縫的帶對帶錯位**壓到 ~2% diag = 恰在 wrap
  alpha 的橋接尺度內**,並把主位錯集中到缺口中線一條(~10% diag)交給 wrap 收;單邊全跨
  (V5b/V5c)與旋轉帶(V5d)的遠緣接縫是 17~34% diag、超出 wrap 能橋的尺度 ⇒ closed 都
  水密、**C500 全破**(19/25/4 開放邊、3/4/5 元件),MUST NOT 用。整組 7~8s CPU、
  複跑逐位元相同(構造路徑零亂數)。
- **判準升級:§5r④ 的三把尺不夠,六把缺一不可,每把都有本輪存證的盲區反例**:
  ①C500 拓樸(盲區:§5r 首輪 V1a 全綠卻長隧道);②kf(正面識別特徵);③**dev(反向:
  結果取樣→到原殼距離)= 幻影增料偵測器** —— R2 V1a 0.451 爆表、V5a 0.252 貼著跨 seed
  基準 0.271,kf 對這兩者全盲(0.93% vs 0.84%);**不是品質排序尺**(分不開好楔壞楔,
  MUST NOT 拿它排名);④ext[depth](合法帶 = [原殼深, 真塔深];盲區:V5b 深度 0.934 像樣
  但 C500 破);⑤**gap_after(閉合後重跑缺口偵測)≤ 3°** —— 對照組 **V0(不補丁直接
  wrap2%+C500)水密 + kf 0.7% + dev 0.8% 全綠、gap_after 卻是 101°**:wrap 與殼互在 alpha
  鄰域 ⇒ 兩把距離尺構造性全綠,而它只是把開放殼包了皮,黏土側視仍看得進殼內。門檻不是
  0(1~2 bin 量化 + 補丁抬中位數會生 1° 假縫,V5a 實測如此)、是 closed 階段的閘(C500
  粗網格噪音 4~5°);它自己的盲區 = V5c 拿貼著前板的片把方位補滿拿到 0.0 而深度根本沒
  復原;⑥黏土人眼(主判準第四次實證)。
- **黏土人眼(t2_symfill_wedge.png)**:V5a = 單一塔體、3/4 前視乾淨;缺陷 = **背側中下段
  一大片凹窩**(不是小瑕疵;候選成因兩個未分 —— 殼自己參差的下緣被鏡進補丁、或中線接縫
  10% diag 被 wrap 塌成口袋)。品質序:CTRL 天然閉合 > V5a > 其餘全滅。另 V5a closed 與
  CTRL C500 同為薄殼空腔(volume 0.033/0.038 vs bbox ~0.75)—— 外包絡對、非實心,
  遊戲道具無妨,但 500 面預算有一部分花在內壁上。
- **定案(改寫 §5r ①②,原文留著已加取代標註)**:①浮雕注救援 = **per-seed 重抽為主
  (品質);V5a 楔形補丁開為具名備援** —— 適用於「這一注的正面已被人眼挑中非保不可」
  (kf 0.84% vs 重抽跨 seed 9.3% = 差一個量級)或 GPU 不可用(7~8s CPU vs 60~110s GPU);
  ②只准 V5a 型(兩緣半跨),整片鏡射/旋轉/Poisson 維持關;③**缺口 MUST 實測不准目測**
  (目測 30° vs 實測 115°),且量測 MUST 連門檻一起釘:0.35×中位 bin、360 bin(0.2~0.5
  是平台、0.2 以下懸崖;左緣隨門檻漂 ~5°,與 margin 4° 同量級);**缺口偵測只有
  `find_gap` 一份**(gap_probe 已改轉呼 —— 舊版自帶第二份預設 0.02 的實作,同一顆殼量出
  1° vs 115° 兩個答案,原則 2 的反模式);④適用域:find_gap 取最長單一空段、V5a 構造
  隱含 span < 180°(健康帶要 ≥ 半跨)—— 多缺口/超半圈的浮雕注不在覆蓋內,仍走重抽;
  ⑤**n=1 未升常設**:整輪只測魔鬼塔 seed 1234 一顆標本(§5r 的結論就曾兩度在同一顆殼上
  被推翻),升格常設路徑前 MUST 至少再驗一顆浮雕注。
- **未跑 / 待續**:①第二顆浮雕標本(升格常設的前提,見定案⑤);②跨 seed 楔形(從 CTRL
  seed 42 的真背面剪楔補這一注 ——「同注正面 + 他注背面」若同時贏過 V5a 品質與重抽成本,
  定案①的分工要重寫);③wedge + C 路徑**不 wrap** 的對照(CTRL 證明 C 路徑自己能收拾
  2.9 萬開放邊,wrap 那一步貢獻了面積 +27% 的圓潤化,必要性未測);④margin 未掃描
  (現值 4°;g0−e 側鏡射源落在缺口內部近乎無料 = 虛設,真正的重疊只在中線與 g1 側);
  ⑤V5a 背側凹窩可否以底面切平/實心化收掉(岩石本就 `sinkBaseY` 埋底)—— 由入庫輪定;
  ⑥腳本仍住 study clone(§5o 同款:等首個入庫節點才搬 `tools/ai3d/`)**(→ §5t:C 路徑
  出貨版已搬 `tools/ai3d/solidify_parts.py`;`symfill_wedge.py` 楔形救援仍住 study clone,
  等第一顆「非救不可的浮雕注」再搬)**。

## 5t. Trial log (2026-08-07 晚, 3060-machine session — T2 首件入庫:`rock/tower_a` 改 T2 重生成 + 實體化刀落地 `tools/ai3d/solidify_parts.py`)

> 使用者指示「跑」(巨石首件入庫 + 實體化刀定案)。落點刻意選**零縫改動**的那一格:
> `rock/tower_a` 同名取代(`normalize_parts.py --base` 的既有語意)—— 消費端 tower 呼叫點、
> rnd 枚數、座號組、`MEGA_LIB` 名冊全部逐位元不動,整輪只動 GLB + 來源帳 + 工具。
> 動機不是「多一顆」是「換臉」:§5l 早記錄 SF3D 版 tower fill 0.313「量體對了,但**柱狀
> 節理全失**、頂面變圓」,而 §5o 實測 T2 C→500「柱身 + 裙狀崖錐都在」。

- **來源與 seed**:來源圖 `ov_163a0902`(CC0,Highsmith 魔鬼塔 —— 與 mesa_a 同一張;
  原 tower_a 的 `ov_f94b5c10` 退役)。**seed 42 天然閉合注**(per-seed 重抽紀律 §5m③/§5r:
  seed 1234 抽到浮雕注 —— 就是 §5r/§5s 的那顆標本;天然閉合注在手就不必動用楔形救援)。
  matte 先二值化 alpha >16→255(§5n)。
- **實體化刀定案(佇列 F.3 選項 (a) 的 repo 版)**:`tools/ai3d/solidify_parts.py` ——
  §5o C 路徑(uniform volumetric resample 實體化 + quadric)的出貨實作,pymeshlab venv
  **外部**(A2;3060 現成的家 = study clone `.venv`),pymeshlab 不出 GLB ⇒ 內部經 trimesh
  轉檔。study clone 的 `decim_gate.py`/`symfill_gate.py` 退回量測史料,出貨縫只有這一份
  (原則 2)。**參數掃描**(§5o 待續② 欠的):3×3(cells 192/256/320 × offset 0.4/0.6/0.8%)
  對 seed-42 殼**九組全數收斂水密單元件 500 面** —— 平台很寬,凍結值 256/0.006 落在平台
  中央不是揀好看的;offset 單調控制貼合度(0.4% → kf 0.73%、0.8% → 1.17%),出貨仍用
  跨族驗證值 0.006(0.004 略貼但只在這一顆殼上驗過;「太低 = 薄壁斷開」的風險面沒掃)。
- **鏈與數字**:T2 raw 47,725 面 / 29,239 開放邊 / 2,443 元件(O-Voxel 輸出本身就是撕裂
  薄殼,§5o)→ solidify 500 面水密單元件(kf_p95 0.94% / dev_p95 1.15%)→ normalize
  (Blender 同名取代,非等向 1.0×1.0 拉滿單位包絡 × FIT 0.95)→ **392 tris**。首跑 420
  太貼上限(430),重跑目標 400 收 392 —— §5j 教訓「貼著上限出貨 = 把下一次重量變成紅字」
  (前例 372/371/382 全在 90% 以下)。
- **來源帳**:`METHODS` +`trellis2_spz` 鍵(§5p 待續③ 的「等首個入庫節點」= 本輪);
  manifest 原 mesa_a/tower_a 合列**拆成兩列**(一次生成作業的語意已不成立):mesa_a 留
  sf3d、tower_a 新列記 T2 全參數(seed、掃描結論、兩段後處理)。
- **驗收全綠**:intake 240 / siteplan 187 / beacons 68 ±兩反向紅 / joints 21611-0 / gpu 54 /
  soft_stroke 73 / cel 52 / visual_prefs 124 / **megalith rnd 對帳 1000 顆逐顆相同 + 逐件
  上限 430 重推不動**(tower_a 372→392 不動 max = basalt 3114)/ `npm run bal` 全綠
  (⑦f 1.78× 不動 —— 純表現層)/ e2e 全綠(fresh server :8666)/ 對照台 0 缺件 0 孤兒
  0 未記載(tower_a 列:方法 T2-spz、來源圖、消費端 megalith、392 tris / 95% 包絡)。
  黏土人眼:柱身直紋 + 裙狀崖錐 + 平頂都在。
- **神木那半:刀已驗通,縫與預算是下一輪**(同日晚,使用者問「可以嘗試神木部分了嗎」):
  ①**枯幹走不了岩族的刀** —— 三連敗實測:凍結參數 24 元件、offset 加大 11~33 元件、
  wrap 後直接 quadric 12 元件。成因鏈:T2 對細枝主體的原殼是**空間上斷開的孤島群**
  (漂白刺果松 `ov_6f0ad84c` 實測 1,428 元件;resample 忠實所以照斷)+ 細管拓樸在低預算
  quadric 下被塌成**串珠**。②解 = `--mode wrap` 三段(已進 `solidify_parts.py`):
  alpha wrap 2% 橋接(§5r ③「形對殼碎」預留的正是這一型;wrap 後 4 元件、最大佔 99.3%)
  → 取最大元件(丟掉的 0.7% 是離體浮枝)→ **拓樸保護** quadric。**500/300/220 三級距
  全數水密單元件**(kf_p95 1.3~2.0%),黏土 C500 蒼勁多枝 ◎、C220 輪廓仍在 ⇒
  **veg 級距(node_cap 223)撐得住枯幹**;resample 模式對 tower 迴歸逐位元一致。
  ③下一輪 = 縫 + 預算同輪定案(佇列 F.1 同款):deadtree 退出 `NATURE_MANIFEST` 改走
  零件表(§5k ⑤ 的 broadleaf 前例)+ lib 列;**開列前先量** —— deadtree 住 `bare` 地貌
  (裸露地場地,量測挑 uluru 這類;現行四個綠地場地量不到它),而 veg 的 `node_cap` 是
  「成長額度 ÷ Σ(lib 列 × instance 上界)」:deadtree 列進分母 cap 就降,**既有節點
  ~215 tris 離 223 只有 8 tris 餘裕** —— cap 降過頭會把已出貨節點變紅,同時 deadtree 的
  Quaternius 檔退場又會把成長額度加回來(staleness ①③ 兩條同時動,不重量就開列 = 賭)。
- **其餘待續**:①真機冒煙(使用者下次開圖:tower 型巨岩換臉,柱狀節理看得出來);
  ②texture 掉色(§5n 待續⑥)不影響 —— partlib 只吃幾何,顏色由零件表 `c:` 給。

## 5u. Trial log (2026-08-07 夜, 3060-machine session — 樹族首件入庫:deadtree 遷零件表 + 整樹節點縫 + `tree/snag_a`)

> 使用者定案:「沒關係,能接起來就好,缺口補平當作被砍伐或雷擊損毀,自然的樹木本來就
> 不完美,繼續」⇒ §5t 神木那半的縫 + 預算,同輪定案(佇列 F.1「預算與縫 MUST 同一輪」)。

- **縫 = `VEG_DEFS` 的 def 層 `whole:`(整樹節點)**:`{ g, y, c, lib }` —— lib 載到 ⇒
  這一型**只畫那一顆節點**(保險絲零件全藏;synthMegalith tower「載到就不 add 原
  primitive」的資料路徑版);載不到 ⇒ rows = parts **逐位元**退回舊制(比任何 fuse-blob
  近似都乾淨 —— 這正是選 def 層而不是 per-part lib 的理由:枯幹沒有球形部件,per-part
  的 fuse 載不到時會畫出一顆掛著大球的樹)。三條紀律:①佈局(`vegSpan`/散布)仍只讀
  `parts`;②庫解析仍只經 `partGeo`(判「載到沒」= `partGeo(whole) !== whole.g`,
  audit_siteplan「解析恰三份」不動);③`whole.g` 只當入庫包絡與世界尺度,不是渲染備援。
  `bioLibDescs` 多吐一列 desc(fb = whole.g),`lib:` 字面計數自動平衡(原文 46 = 解析 46)。
- **deadtree 退出 `NATURE_MANIFEST`**(§5k ⑤ broadleaf 同路;§5q 定案樹族 img→3D 只收
  雕塑性主體 —— 枯幹正是首件):Quaternius DeadTree_1/2 退場(gltf 檔留在 assets 目錄,
  已無引用;要不要清檔由出貨版打包輪定),散布/佈局零 rnd 變化。
- **預算先量再開**(staleness ①③ 兩條同時動,§5t 預告的那筆帳):①uluru(bare 0.95,
  deadtree 的上界地貌)加入取樣面 —— **deadtree instance 上界 121**(blackforest 僅 15;
  綠地場地量不到它,§5t 的判斷成立);②blackforest 全場重量 1,591,970 → **1,561,264** =
  Quaternius 枯木退場釋出 **30,706** ⇒ 成長額度 592,199 → **622,905**;③`node_cap` =
  622,905 ÷ 3,038 + 20 = **225**(舊 223;分母 +121)—— 既有 veg 節點 max 214 仍綠。
  若只加分母不重量額度,cap 掉到 214.9 = 貼著既有節點零餘裕(§5t 預警的賭局,量測解掉)。
- **`tree/snag_a`**:§5p 漂白刺果松枯幹 ◎(`ov_6f0ad84c`,CC0 USFS;seed 1234 出來就 ◎
  不需重抽)→ `--mode wrap` 刀(§5t)48,673 面 1,428 元件 → **200 面水密單元件**
  (kf_p95 2.4%)→ normalize 非等向拉滿 ico(3.2)(≈ 全高 6.1m × it.s 0.7~1.4)。
  200 ≤ 225 留 11% 餘裕(§5j 教訓)。黏土:多刺蒼勁枯幹,缺枝/補痕照使用者定案讀作
  砍伐/雷擊損毀。
- **驗收全綠**:intake 244(snag_a 四條契約全過)/ siteplan 187 / soft_stroke 73(deadtree
  維持非軟性)/ beacons 68 / joints 21611-0 / gpu 54 / cel 52 / visual 124 / `npm run bal`
  全綠 / e2e 全綠(fresh :8666)/ 對照台 0 缺件 0 孤兒 0 未記載(snag_a 列:T2-spz、
  來源圖、消費端 deadtree[3]、200 tris / 95% 包絡)。
- **未跑 / 待續**:①真機冒煙(裸露地場地看枯木換臉 + 保險絲路徑不迴歸);②板根/扭曲幹
  是下一批(GIANT_DEFS 板根鰭的 per-part 縫 —— cone fuse 的非等向 normalize 已就緒,
  語料要回 F0 續抓);③`--mode wrap` 的 alpha 只在這一顆殼上驗過 2%,語料多了要掃
  (§5t 凍結值紀律同款);④卡在 §5p 的 conifer/pine 語料缺額照舊(冷卻後續抓)。

## 5v. Trial log (2026-08-07 深夜, 3060-machine session — 冠層複測:wrap 刀對六張冠層標本,§5q 定案維持、機制升級成可量的數)

> 使用者指示「再檢查有樹冠層的樹」—— wrap 刀救回枯幹之後,§5q「葉冠不走 img→3D」的
> 定案值得拿新刀重審一次(定案當時沒有這把刀)。六張冠層 T2 標本全部過刀
> (密冠橡樹 seed 1234/42/7、大橡樹 #16、南洋杉 #27、猴麵包白描 #58)。

- **閉合全勝、身分全敗 —— §5q 維持,而且第三次驗證了它那句話**(「這些方法能閉合葉冠,
  但閉合從來不是葉冠的缺口」):wrap 刀把六張全部閉成水密單元件(連 §5q 的「最壞平板」
  seed 42 都是),但 ①**平板注閉合後還是板**:密冠 1234/42、南洋杉、猴麵包的**水平深度比**
  (min(x,z)/max(x,z))= 0.01~0.08,黏土側視就是一片薄板 —— 深度不存在,閉合造不出來;
  ②**真體積樹被熔掉**:大橡樹 #16 是六張裡唯一的真 3D(深度比 **0.80**,原殼是
  幹 + 枝椏濾網 + 葉簇的漂亮橡樹,§5p 當時人眼判 △ 其實冤枉它了)—— 但 wrap 的橋接
  尺度恰好抹掉細枝濾網,380 面出來是「蠟燭熔岩插在盤子上」。**枯幹 ◎ 與冠層 ✗ 的分界
  就此講清楚:身分住在粗肢(wrap 保得住的尺度)= 可救;身分住在細絲 = 橋接即熔毀**;
  ③碎塊雲 seed 7 在 alpha 2% 撞 MemoryError、4% 閉成深度比 0.98 的圓丘(kf 5.5%)——
  是「一團東西」不是「一棵樹」,冠簇節點另有 SF3D 現役貨,不缺這一注。
- **`depth_ratio` 前篩進 `solidify_parts.py`**:< 0.15 = 浮雕/平板注,免跑閉合免看黏土
  直接判(六張標本 + 魔鬼塔兩注校準:平板 0.01~0.08 / 楔形缺口浮雕 0.70(§5s 那顆,
  楔形可救)/ 真體積 0.80~0.98)。與 §5o「fill 尺對 T2 不適用」互補:fill 量殼的封閉度、
  depth_ratio 量**形狀本身有沒有背面**。
- **順帶迴歸確認**:§5u 的 `whole:` 縫只掛在 deadtree 上,冠層樹種(broadleaf/birch/
  shrub/conifer*/mangrove + 神木)rows = parts 逐位元不變 —— uluru/blackforest 兩輪量測
  的逐型 instance 指紋全部對得上(那兩張表就是遷移後量的),soft_stroke/joints/e2e 全綠。
- 結論:樹族 img→3D 的邊界穩定在 §5q 原判 —— **只收雕塑性主體**(枯幹 ◎ 已入庫;
  板根/扭曲幹排隊),冠層維持程序冠簇 + 照片貼圖;oak16 這種真體積樹若要用,出路是
  高預算 GIANT 節點(數千面)—— 現行預算(veg 225 / tree 402)下無解,不立佇列。
  **(→ §5w 使用者手稿翻案了冠層的出路:不膨脹、用排列造體積 —— 莢化放射)**

## 5w. Trial log (2026-08-07 深夜, 3060-machine session — 使用者手稿:冠層莢化放射 + 樹幹迴轉;原型三層級黏土)

> 使用者上傳手繪流程圖:「葉冠的部分參考我的手稿處理…樹幹的部分則直接旋轉360度補滿」。
> 追問定案兩件事:①每一片 = **浮雕板沿平背鏡射閉合成有厚度的「莢」**再繞軸放射
> (不是薄片交叉);②過軸片數 **2~6 逐株隨機**。手稿把單片薄板(側視即消失)明確 X 掉。
> **這個設計繞開了 §5v 的死結**:不膨脹(wrap 熔毀路線)、用**排列**造體積 ——
> 而且「平背鏡射」對薄板是**合法鏡射**:§5r 鏡射之死是因為塔殼不是「半個物體」,
> 冠層板恰恰就是半個物體,貼背鏡射正是它的正確閉合。原型 `canopy_pods.py`(study clone;
> 測試品 = 密冠橡樹 seed 1234,§5q 判死的那張;產出 `out_pods/`)。

- **管線**:寬度剖面切幹/冠(密冠橡樹實測幹只佔底部 6%H,「葉裙拖地」樹型)→
  幹 = 寬度剖面迴轉 360°(lathe,軸過鏡射面)→ 冠 = 板 + 貼背鏡射 → **wrap 前**兩半
  先退開 sep(wrap 以圓角橋接緣邊;第一版在 wrap 後 z×3 縮放,緣面被拉成梯田狀平帶,
  黏土讀起來像切片水果 —— 厚度 MUST 在 wrap 前給)→ 水密單莢 → K 莢繞軸 180° 均分
  (莢過軸雙面 ⇒ 180° 即滿覆蓋)+ 逐莢高/徑微抖(定值,零亂數)。
- **三層級黏土**:①高模(莢 3.6k 面):K6 俯視是一頂真正的密葉冠、K4 側視莢間暗袋讀作
  葉蔭 —— 葉叢起伏全在,質感 ◎;②遊戲級(莢 100 面,K4 全樹 464):剪影仍是有機圓頂、
  花形都在,葉叢起伏被抹平 —— 與現行 ico 冠簇同級但**剪影不對稱 + 逐株 K 變化**,
  細節靠遊戲內既有的葉色抖動 + 軟性擺動補;③莢 60 面(全樹 304):可用但更鈍。
- **入庫是下一輪的縫**(本輪只驗機制):「2~6 逐株隨機」在 VEG_DEFS 的表達是新消費型態
  —— 莢 = 一顆 lib 節點、逐株 K 由**位置雜湊**推(零共享 rnd,§2.3),InstancedMesh
  逐列 instance 數會隨 K 變 ⇒ buildVegMeshes 要新機制(零縮放矩陣藏莢 or 逐莢展開
  instance 名冊),預算走 veg node_cap(100 面莢 ≤ 225 ✓)+ 逐株 Σ 上限(K=6 × 100 +
  幹 ≈ 660,超過單株 ico 冠簇現值 —— 要走 §5u 同款「先量再開」)。適用樹種:密冠/
  圓頂型闊葉(broadleaf 家族);oak16 型的枝椏濾網樹**不適用**(莢化會把濾網壓成實牆,
  §5v 的教訓換個方向再現)。
- **未跑 / 待續**:①使用者過目三層級黏土 → 選定質感檔位與適用樹種;②縫 + 預算輪
  (依 §5u 模式:量測 → 開縫 → 入庫 → 全砲火);③trunk 迴轉對「幹佔比高」的樹種
  (oak16 6%H 是特例)要重驗剖面取樣;④sep 只在密冠橡樹上調過 0.05,換語料要掃。
- **v3(同日;使用者二修,v2 的莢被退件)**:①「2~6」是**俯視瓣數**不是過軸片數 ——
  奇數瓣(3/5)用**半片**各自繞軸擺,偶數瓣 = 半片成對(同一機制的特例);②莢 MUST NOT
  直線墊厚(v2 的 sep 平移 = 使用者原話「直接墊厚浮雕,邊緣看起來是拉直的」)—— 要進
  **r-θ 座標**:瓣 = 半片剖影**繞軸部分迴轉**(與樹幹 360° 迴轉同一個框架),z 向厚度
  映成角向 Δθ 楔 ⇒ 邊緣是弧、厚度 ∝ 半徑(近軸收尖、緣端飽滿)、浮雕表面起伏跟著映成
  角向起伏。`canopy_petals.py`(半莢 wrap 閉合 → `bend_wedge` 楔彎 → K 瓣 360/K 均分、
  左右半片輪流取 = 相鄰瓣剪影不同;瓣張角 = `fill` × 360/K 留花瓣缺口)。正俯視黏土
  (新工具 `render_top.py`,out_dir MUST 傳絕對路徑 —— Blender 相對 filepath 會解析到
  磁碟根)K3 = 三瓣風車、K5 = 五瓣風車,花形與手稿一致;側視量感、葉叢起伏都在。
  待使用者校準:瓣的胖瘦(現值 fill 0.62 偏尖楔,手稿的瓣更圓潤 —— 旋鈕是 fill 與
  逐瓣 r 剖面)、質感檔位、適用樹種。
- **v4(同日;使用者手稿二 —— 尖楔瓣 X 掉,瓣要圓潤)**:瓣的角向半寬從常數改成沿
  徑向脊的**圓弧包絡** `W(u) = 0.14 + 0.86·sin(πu)^0.85`(近軸收細柄、中段鼓滿、梢端
  收圓;兩端不歸零 —— 柄與梢都留肉),`half_deg` 語意改為中段半寬、近軸爆脹以 1.9×
  夾住;fill 0.62 → 0.72。俯視 K5 = 五瓣圓瓣花(柄細中鼓梢收、緣帶鋸齒),與手稿二的
  團塊瓣一致;側視圓頂量感不退、葉隙讀作透光孔。
- **v5(同日;使用者定案黑桃瓣)**:寬度包絡改三段 ——「每瓣黑桃狀膨脹,半徑 1/3 以內
  當作樹枝(可以小一些),最大點抓半徑 2/3,膨脹拉大一點,例如 3 瓣可拉到 110~120°,
  以此類推」⇒ ①u ≤ 1/3 樹枝段:**物理**細柄(branch_w/r,近軸夾住);②1/3 → 2/3
  smoothstep 鼓到滿寬,滿寬 = **0.96 × 360/K**(K=3 ⇒ 115°,隨 K 等比);③2/3 → 梢端
  收尖,tip_p **< 1 = 凸肩**(寬度撐得久、末端急收 = 黑桃圓肩;首版 p=1.3 凹收讀成
  箭頭,被退)。K3/K5 俯視:細枝柄 + 圓肩鼓瓣 + 收尖,黑桃花形成立。

## 5x. Trial log (2026-08-07, 3060-machine session — 逐瓣 r/θ ±1/8 誤差 + 遊戲級減面檔位)

> 使用者定案:「**樹木旁瓣的 r 和 theta 加入 ±1/8 的誤差,角度總和還是 360 度**」。
> v5 的瓣是**均分**的(360k/K)、只有 ±8% 的高/徑微抖 —— 俯視讀起來是機械風車。

- **誤差 MUST 零均值**(`petal_jitter`,定值零亂數 §2.3):角格 `Δθ_k = 360/K ×(1 + e_k)`,
  `Σ e = 0` ⇒ **Σ Δθ = 360.000000° 逐位元**(K=2~6 實測全部到小數第六位);徑向那一組同樣
  零均值 ⇒ 平均冠幅不動(誤差是**重分配**不是把樹放大,同 `AOE_BUDGET.NORM` 與
  `BUILD_DPS` 的同一條)。**順序是「先減均值、再等比放大到恰好 ±1/8」** —— 反過來
  (先夾到 ±1/8 再減均值)會把總和推離 360°,而那一刀補回去的就是另一個誤差。
- **瓣心 = 自己那一格的中央**(前面各格累積 + 半格),MUST NOT 沿用 `360k/K` —— 格不等寬,
  均分擺位會和格錯開,瓣一邊咬進鄰格、另一邊留出雙倍缺口。
- **瓣寬 MUST 吃自己那一格**(`bend_wedge` 收 `span` 不收 `K`):缺口佔比恆 `1−fill`。
  「固定寬 + 只抖擺位」是**不成立**的省事版 —— 不相咬的條件是
  `e_k + e_{k+1} ≥ 2(fill−1) = −0.08`,而 ±1/8 的相鄰和下界是 −0.25。實測(fill 0.96,
  逐 K 掃最小缺口):定案版 K2~K6 = **+7.20 / +4.64 / +3.40 / +2.75 / +2.28°**(全正);
  固定寬版 = +7.20 / +0.81 / **−1.33 / −0.26 / −0.53°** ⇒ **K=4/5/6 三檔相鄰瓣真的互穿**
  (fill 0.96 是使用者鎖死的鼓滿值,要保它就只能讓寬度跟著格走)。
- **⚠ 這一條改變了入庫的縫**:θ 誤差是**角向楔彎**(非仿射),instance 矩陣表達不了 ⇒
  「一顆瓣節點 + K 個 instance 矩陣」的原計畫**不成立**(r 誤差與高度抖是等比縮放,矩陣
  照樣吃得下;只有 θ 吃不下)。三條出路,§5w 待續② 的「二選一」要一起定:
  ㋐ **烤 2+3+4+5+6 = 20 顆瓣節點**(逐 K 逐位次各一顆,誤差烤進幾何)—— 矩陣退回純
  旋轉+縮放,代價是 lib 列數 ×,`lib_instance_rows` 跟著漲;
  ㋑ **逐 instance 一個 `aSpanF` 屬性 + 頂點著色器再彎一次**(節點只烤一顆:局部座標下
  `φ = atan2(z, x)`、`φ *= aSpanF` 即精確,與既有 `CEL_SWAY` 同層可共存)—— 列數不變,
  代價是多一條著色器路徑;
  ㋒ `fill` 降到 ≤ 0.875 換回「固定寬 + 抖擺位」—— 一顆節點、零新機制,但賠掉使用者
  鎖死的鼓滿值。
- **減面(§5w 待續①「先減面再彎折」)驗通且順序有理由**:`bend_wedge` 是純頂點映射
  (不動拓樸)⇒ 先減再彎;**先彎再減會讓 quadric 拿彎過的曲面算誤差、把楔的角向弧
  當成「可以拉直的曲面」抹掉**。半莢是 wrap 出來的水密實心單元件 ⇒ 走 §5m 的直接
  quadric(§5o「先實體化」那條是給 T2 雙層薄殼的,這裡不適用),`preservetopology`
  保住水密 —— 四個檔位出來全部 `watertight=True`。
- **拓樸底 = 100/108 面,而且不報錯**:目標寫 60 拿回來的還是 100/108(preservetopology
  之下再降就得破拓樸)。與 §5o「trimesh quadric 打不到預算又不報錯」同一族,只是這次
  是 pymeshlab 的 preserve 分支 —— **面數目標 MUST 拿產出實測回讀**,不可信參數。
- **檔位實測**(每瓣目標 → 全樹面數 K2/K3/K4/K5/K6):
  100(= 拓樸底)→ 288/388/496/596/**704**;160 → 400/560/720/880/**1040**;
  225(= 現行 `node_cap`)→ 528/752/976/1200/**1424**;高模 → 8180…24380。
  人眼:100 側視是**水晶碎片**(葉叢起伏全丟、剪影開始破);160 起回到有機團塊;
  225 只比 160 好一點點。俯視三檔位都保得住黑桃花形(細枝柄 + 鼓肩 + 缺口)。
- **預算天花板 ≈ 170,是推導不是手感**:broadleaf 走瓣化 ⇒ 逐株列數由 2 變成
  `1 幹 + K 瓣`(平均 K=4 ⇒ 5),`lib_instance_rows` 3038 − 211×2 + 211×5 = **3671**,
  `622,905 / 3671 ≈ 170`。⇒ **可用區間 = [100 拓樸底, 170 預算天花板]**,`--faces 160`
  是唯一同時落在裡面又不讀成碎片的檔位(這一輪的建議值;正式數字仍走 §5u 模式,
  由 `measure_veg_tris.mjs` 對**選定樹種**重量一次)。
### 5x-b. 入庫縫定案 ㋑(逐 instance)+ 適用樹種的兩道閘(同日,使用者「那就逐 instance」)

- **㋑ 成立的理由是可證的**:`bend_wedge` 的 `φ = (t/tmax)·alpha(u; span)`,而 `alpha` 對
  `span` **幾乎**是齊次的 ⇒ 一顆基準瓣 + 逐 instance 一個純量 `aSpanF`、著色器裡
  `φ = atan2(z, x); φ *= aSpanF; (x, z) = r·(cos φ, sin φ)` 就能重現任意格寬。
  「幾乎」的兩個例外都是**刻意的**:樹枝段的 `branch_w / r`(物理細柄)與梢端保底 `0.03`
  都不隨 span 走 ⇒ **單一基準瓣打不到全域精確**。實測(相對包圍盒對角):
  | 方案 | 節點數 | draw call | 最壞偏差 |
  |---|---|---|---|
  | 單顆基準瓣(S₀ = 90°)吃全部 K | 1 | 2 | **1.63%**(集中在 K=2:span/S₀ = 2.25 ⇒ 細枝柄被撐成 2.25 倍寬,賠掉使用者鎖死的「樹枝段」) |
  | **逐 K 一顆基準瓣(K=2~6)+ `aSpanF` 只吃 ±1/8** | 6 | 6 | **0.16%**(逐 K 最壞 1.98e-3 / 1.98e-3 / 1.39e-3 / 1.25e-3 / 3.88e-4) |
  | ㋐ 全烤(逐 K 逐位次) | 21 | 21 | 0 |
  ⇒ **定案 = 逐 K 基準瓣 + 逐 instance `aSpanF` ∈ [0.875, 1.125]**。三角形預算與列數
  **與方案無關**(Σ instance 數一樣),差的只有 GLB 節點數與 draw call。
- **A39 ⑦ 連帶**:新的彎折 define 與 `aSpanF` MUST 進 `customProgramCacheKey`(不進 = three
  共用舊程式 = 那批材質整批不彎,而且不報錯);排序上先彎再交給 `CEL_SWAY` 的擺動位移
  (擺動錨在整株局部座標,彎折不動 y ⇒ 兩者正交)。
- **適用樹種:兩道閘,都是量出來的**(F0 五張語料實跑,`--faces 160` K5 俯視 + 側視):
  | 語料 | depth_ratio | 冠寬/冠高 | 結果 |
  |---|---|---|---|
  | 密冠橡樹 | 0.029 | **1.60** | ✓ 黑桃花形、側視有機團塊 |
  | 猴麵包樹(白描) | 0.012 | **1.52** | ✓ 最乾淨的一朵 |
  | 南洋杉 | 0.064 | **0.89** | ✗ **過了 dr 閘仍不成立** —— 攤成放射尖星 |
  | 大橡樹#16 | **0.804** | 1.25 | ✗ 薄刃 + 側視雙層板 |
  | 漂白枯幹 | **0.531** | 0.97 | ✗ 碎片 |
  ①**輸入閘 = `depth_ratio < 0.15`**(§5v 已進 `solidify_parts.py` 的同一支前篩):貼背鏡射
  只對「半個物體」合法,本來就有厚度的產出翻一倍就是雙層板(oak16 / juniper 兩張把這條
  演出來)。②**形狀閘 = 冠寬/冠高 ≥ ~1.2**(新):南洋杉 dr 只有 0.064、閘一穩穩過,瓣化
  出來卻是尖星 —— **錐形/尖塔樹的身分在垂直方向**,而瓣是放射鋪開的機制,兩者互斥。
  現有語料的分界很寬(1.52/1.60 ✓ vs 0.89 ✗),不是壓線判讀。
  ⇒ 對回遊戲樹型:**broadleaf 家族(橫展圓冠)+ 粗幹稀冠型可收;conifer2 / birch 這類
  直立錐形或細高型排除**(適用名冊仍待使用者定案 —— 這兩道閘只負責把不可能的先刪掉)。
- **未跑 / 待決**:①適用名冊拍板(閘已備好,使用者過目本輪對照表後定);②選定後
  `measure_veg_tris` 重量 + `node_cap` 重算 + intake 外廓契約;③`buildVegMeshes` 的
  逐株 K(位置雜湊 2~6,零共享 rnd §2.3)+ `aSpanF` instanced attribute + toon.js 彎折
  define;④全砲火 + 對照台(`veg` builder 那一列)。
  原型與黏土:study clone `canopy_petals.py`、`sheet_species.py`、`out_petals/`
  (`v6/` 高模、`game/`=100、`f160/`、`f225/`、`sp_*/` 逐樹種,各含 `top/`+`side/`;
  總表 `out_petals/species_sheet.png`)。

## 5y. Trial log (2026-08-07, 3060-machine session — v7 逐叢瓣化:可分離就分開膨脹旋轉、分層錯開)

> 使用者定案:「**如果葉冠可分離則分開膨脹、旋轉,越細的分越多旁瓣(數量無上限),
> 相鄰高度層的分岔角度盡量錯開**」。v6 是「整片冠 = 一瓣 × K」;v7 把冠拆成叢,
> 逐叢自己彎、自己轉、自己決定要複製幾瓣。

- **①可分離才分,分不開逐位元退回 v6**(原則 6):葉冠取連通元件,>1 叢走 v7,否則走
  v6 整片單瓣。`--no-split` 對照組實測與 `f160` 逐頂點 **max|Δ| = 0.0**。
- **叢的篩選 MUST 報帳**:T2 產出是**萬件等級的湯**(密冠橡樹 5,007 件 / 猴麵包樹 1,313 件 /
  南洋杉 3,657 件;面積 >0.5% 的只有 16~30 件)⇒ 由大到小取到累積 `--cover` 或撞到
  `--floor` 為止,**丟幾件、丟掉多少面積一律印出來**(靜默截斷是禁令)。實測
  密冠橡樹取 43 叢 = 面積 31.4%(丟 4,964 件 / 68.6%)、猴麵包樹取 23 叢 = 74.8%
  (丟 1,290 件 / 25.2%)—— 密冠那 68.6% 是真的細碎葉點,而 ③ 的複製把它補了回來。
- **③ 越細分越多旁瓣,無上限**:`N = round(最大叢等效直徑 ÷ 這叢等效直徑)`,下限 1、
  **不設上限**(使用者指定)。等效直徑取 `√面積`(單一數、對碎形邊界穩)。同一叢的 N 瓣
  **輪替交錯**進格位 —— 連著擺會把細枝擠成一撮,散開才是「一圈細枝」。
- **④ 相鄰高度層錯開 = 真的最大化**:層厚 = **叢高中位數**(推導不手寫)⇒ 密冠橡樹/猴麵包樹
  各 6 層;層內 Σ Δθ 仍恆 **360.000000°**(v6 的零均值誤差照舊,逐層各算一份);層間偏移
  取「本層瓣心到上一層瓣心的**最小**圓周距離最大」的那一個(720 取樣掃描)。**MUST NOT
  手寫半格或黃金角當常數** —— 各層瓣數不同(8/27/29/16/4/8),半格偏移在瓣數不等時對不齊,
  而畫面上只表現成「某兩層還是疊著」。實測偏移 154 / 229 / 46.5 / 225.5 / 0.5°。
- **⚠ 逐叢彎折會讓外圈整圈浮在空中**(v7 第一版實跑):每叢的 `bend_wedge` 在**自己的**
  徑向帶上正規化 ⇒ 一叢掛在 r ∈ [0.6, 0.8] 的,與主幹之間什麼都沒有。使用者說的
  「**分岔**」正是那一段 ⇒ 補 `twig()` 錐管(幹的冠內主幹頂 → 該叢內緣,粗細 ∝ 叢大小)。
  枝 MUST 在**楔彎之後**併入(它本來就沿 +X 直走,再彎一次會捲成弧)、但在縮放與旋轉
  **之前**(那兩步是整瓣的等比/剛體,枝要跟著走)。補完之後側視才是「樹枝 + 枝端葉團」。
- **人眼**:密冠橡樹 43 叢 / 6 層 / 144 瓣 = **真的像一棵樹**(側視圓頂 + 枝端葉團、俯視
  放射枝配葉團);猴麵包樹 23 叢 / 6 層 / 92 瓣同樣成立。這是 v6 沒有的東西 —— v6 是
  「一朵花」,v7 是「一棵有枝有叢的樹」。
- **⚠ 但它已經不是一般植被的量級了**(這一輪最重要的數字):160 面/瓣 ⇒ 密冠橡樹全樹
  **25,424** 面、猴麵包樹 **16,632** 面。往下壓的實測(40 面/瓣 + `--floor` 0.006 ⇒ 13 叢 /
  3 層 / 25 瓣 / 1,570 面)**人眼判退**:冠太開、只剩幾根刺,連 v6 的剪影都不如。
  ⇒ **v7 的可用下界遠高於 veg 預算(node_cap 225 × 逐株 Σ)**,它落在 §5v 自己點名的那條
  出路上 ——「高預算 GIANT 節點(數千面)」。定位因此分成兩層,而且**不互斥**:
  | | 機制 | 全樹面數 | 家 |
  |---|---|---|---|
  | v6 | 整片冠 × K 瓣(K=2~6) | 400~1,424 | 一般植被(broadleaf 家族) |
  | v7 | 逐叢 × 分層錯開 × 越細越多 | 16k~25k | **神木 / GIANT 級**(單株、instance 數個位數) |
  v6 的 §5x-b 入庫縫(逐 K 基準瓣 + `aSpanF`)**不受影響**;v7 因為逐叢幾何各異、瓣數無上限,
  走的是「整株烤成一顆 GIANT 節點」那條(§5u 的 `whole:` 縫已經在,deadtree 正是先例)。
- **未跑 / 待決**:①v7 要不要吃 GIANT(神木)那一格 —— 使用者定;②吃的話走 `whole:`
  縫 + GIANT 預算重量(神木 instance 數少,數千面可能撐得住);③`--cover`/`--floor`
  兩顆旋鈕與 ③ 的 N 上限(目前照使用者指定不設)要對著預算掃一次;④南洋杉那類
  §5x-b 形狀閘擋掉的樹型,v7 也不會救 —— 閘照舊。
  原型:`canopy_petals.py`(v7 路徑 + `--no-split` 對照組)、`out_petals/v7_oak`、
  `v7_baobab`、`v7_oak_lo`(各含 `top/`+`side/`)。

### 5y-b. 兩族的拆法相反(同日,使用者退掉 v7 的一刀切)

> 使用者:「**拆太多了,闊葉林不用拆這麼多份,除非是有非常顯著是不同主幹分岔。
> 針葉林的部分可以拆更細部,但最後丟棄內部的網格點,把外部包絡**」。

- **分流用的是既有那把尺**(`leaf_family` = §5x-b 的形狀閘 冠寬/冠高 ≥ 1.2),MUST NOT
  另立第二個判準 —— 兩處各判一次遲早出現「閘說闊葉、拆法走針葉」。
- **闊葉:只認顯著主幹分岔**(`major_forks`,等效直徑 ≥ `--major` 0.6 × 最大叢)。
  v7 把密冠橡樹當成 43 叢 = 把**每一團葉點**都讀成一根主枝;收緊之後密冠橡樹 43 → **2 根**、
  猴麵包樹 23 → **6 根**,留 ≤1 根就逐位元退回 v6(單幹闊葉的常態)。
- **針葉:細拆 + 外包絡**(`envelope` = 凸包(叢 ∪ 貼背鏡射))。三件事一次解決:
  ①凸包的定義就是「丟掉所有內部點」(使用者原話);②鏡射讓包絡對稱於背面,否則彎折後
  半邊瓣是刀背;③輸出天生水密單元件 ⇒ 這一族**不必跑 `wrap_close`、也不必減面**,
  每片自然落在幾十面 —— **針葉能細拆到 71 叢而不爆掉,靠的就是這一步**。
- **⚠ ③「越細分越多」的錨點沒設,收緊之後當場現形**:`N = round(dmax/d)` 讓**最大的那一叢
  恆得 1 瓣** ⇒ 密冠橡樹兩根分岔 = 全樹 **2 瓣 / 400 面**,樹沒了。比值只講相對多寡,絕對量
  要有錨(`--kbase`,逐族預設):**闊葉 4**(每根主幹分岔各自回到 v6 的 K 瓣)、**針葉 1**
  (細拆之後叢本來就有幾十個,再乘 4 直接爆)。
- **⚠ 幹與冠之間會開一段空隙**:分岔起點原本寫死 `trunk_top + 0.25H`,而密冠橡樹的
  `trunk_top` 在 6%H、冠底卻在 45%H ⇒ 主幹迴轉頂端搆不到冠。改成**最低那一叢的底**
  (推導不手寫),主幹 lathe 一起抬上去。
- **實測(160 面/瓣)**:
  | 樹型 | 叢 → 分岔/細拆 | 層 / 瓣 | 全樹面數 |
  |---|---|---|---|
  | 闊葉・密冠橡樹 | 43 → **2 根** | 2 / 9 | **1,540**(v7 是 25,424) |
  | 闊葉・猴麵包樹 | 23 → **6 根** | 2 / 32 | 5,304(v7 是 16,632) |
  | 針葉・南洋杉 | 3,657 → **71 叢** | 10 / 170 | 15,064 |
  人眼:闊葉回到「一棵蘑菇冠闊葉樹」(v7 的 144 片碎裂沒了);**南洋杉第一次成立** ——
  §5x-b 判它「攤成放射尖星、形狀閘擋掉」,細拆 + 外包絡之後是**錐形剪影 + 逐層枝叢**,
  那條形狀閘因此只適用於「整片冠 × K 瓣」的 v6,不適用於這一族(閘的適用範圍要跟著改)。
- **量級因此分成三段**(§5y 的兩段再分):闊葉走 v7 = **1.5k~5.3k 面**(比 v6 的
  400~1,424 高一階,但離針葉的 15k 還遠)、針葉走 v7 = **15k = GIANT 級**、v6 仍是
  一般植被那一格。**闊葉這一段是新出現的中間檔**,要不要開得看 GIANT / veg 兩邊的預算。
- **未跑 / 待決**:①`--major` 0.6 只在兩張闊葉語料上掃過(43→2、23→6),換語料要重掃;
  ②針葉的 `--cf-floor` 0.002 是實測選的(0.0004 → 450 叢 / 2,600 瓣 / 149,852 面爆掉、
  0.004 → 37 叢偏疏);③三段量級各自歸哪一格,等使用者定。

### 5y-c. 可見性剔除:從外面看不到的先刪,輪廓包絡是排序的結果

> 使用者:「**網格點太多的話,從外面看不到的內部開始合併刪除,最外層的輪廓包絡盡可能保留**」。

- **判準 = 曝露度**(`cull_hidden`):96 個 Fibonacci 球面方向,逐面數「從這裡射得出去的
  方向有幾個」。曝露度 0 = 完全被別的瓣包住 ⇒ 無條件刪;**預算破了才**按曝露度由低到高
  往上吃(使用者原話的前提子句是「太多的話」)。
- **「輪廓盡可能保留」MUST 是這個排序的結果,不是第二條規則**:剪影面的曝露度天然最高,
  排序自動把它們留到最後。反過來做(先 quadric 再想辦法保輪廓)行不通 —— quadric 對所有
  頂點一視同仁,吃掉的正好是稀疏的剪影邊緣,而面數看起來完全正常。
- **判定 MUST 在組裝完的整棵樹上做**:收穫來自瓣與瓣互相埋沒,逐瓣各自判等於一個都刪不掉。
- **⚠ 兩個靜默失敗,都是這一輪踩出來的**:
  ①**MUST NOT 用法向篩方向**。第一版寫 `n·d > 0` 只射朝外半球 —— 而 `lathe()` 的繞序讓
  **主幹法向朝內**,於是射線全射進實心裡、**整根樹幹被當成內部刪掉**(y-min −0.326 →
  −0.044)。面數只掉 6.7%、報表看起來完全正常。改成起點沿**射線方向**外推、完全不看法向:
  判的是「這個位置暴不暴露在外面」,與繞序無關(組裝件的繞序本來就沒人保證)。
  ②**輪廓保留度 MUST NOT 拿頂點凸包量**。凸包看不到「中間破一個洞」—— 剔到 1,500 面、
  冠上開了大洞的那一版,凸包比仍然逐方向 **100%**,守門數等於什麼都沒守到。改成
  **平行射線掃剪影覆蓋率**(逐方向 160² 條平行射線,數打得到的條數),逐方向取**最小值**
  (平均會把「某一個角度整片凹掉」平均掉,而那正是要抓的)。
- **實測(南洋杉 71 叢 / 170 瓣 / 15,064 面)**:
  | 預算 | 面數 | 刪掉 | 輪廓保留 min | 人眼 |
  |---|---|---|---|---|
  | 0(只刪看不到的) | 13,080 | **13.2%** | **99.9%** | 與原版分不出來 |
  | 8,000 | 8,000 | 46.9% | 94.0% | 仍成立 |
  | 6,000 | 6,000 | 60.2% | 81.6% | 邊緣,開始透 |
  | 4,000 | 4,000 | 73.4% | 57.6% | **破**:枝叢變散片、整棵看得穿 |
  | 2,000 | 2,000 | 86.7% | 29.4% | 廢 |
  ⇒ **13.2% 是純賺**(只刪完全看不到的,輪廓 99.9%),之後每砍一半就付一截輪廓;
  **守門線 ≈ 90%**(人眼與數字在 94% / 81.6% 之間翻轉)⇒ 針葉的可用下界 ≈ **8,000 面**。
- **收穫逐族差很多**:針葉 13.2%(170 瓣互相埋沒)、闊葉只有 **0.2~0.9%**(9~32 瓣、彼此
  幾乎不重疊,本來就沒有內部)。這一步是**針葉那一族的**省法,對闊葉近乎無效 —— 對闊葉
  仍要靠 §5y-b 的分岔數與逐瓣面數。
- **未跑 / 待決**:①`--budget` 要填多少等預算輪定;②96 個方向 / eps 0.0015×對角 兩個取樣
  參數只在這三張語料上跑過;③剔除後網格不再水密(內部被挖掉)—— 這一族本來就走
  「整株烤成一顆節點」,不吃 intake 的水密要求,但入庫時 MUST 確認外廓契約仍量得到。

### 5y-d. 減叢 vs 減面誰划算 + 三檔位的預算算術(決策用數字)

- **⚠ 兩條路線的輪廓數字原本不可比**:`silhouette_keep` 是「處理後 ÷ 這一次自己的原版」,
  減叢那一路每一階都對自己量 ⇒ 逐階都是 99.8~100%,讀起來像「減叢完全免費」。
  **統一對同一個基準量**(71 叢 / 13,080 面)之後才看得到真相:
  | 面數 | 減叢(少幾團葉,每團完整) | 減面(每團都在,打洞) |
  |---|---|---|
  | ~1,500 | — | 22% |
  | ~2,000 | **61.4%**(16 叢 / 23 瓣 / 2,123) | 29.5% |
  | ~4,000 | — | 57.6% |
  | ~6,000 | 78.5%(37 叢 / 67 瓣 / 5,877) | **81.7%** |
  | 8,000 | — | **94.1%** |
  兩條線**在 ~5,000 面交叉**:預算寬鬆時剔除幾乎免費(它只吃看不到的);預算一緊,
  剔除開始在每一團葉上打洞,而減叢是「少幾團、留下的完整」⇒ 低預算端減叢贏一倍。
- **⇒ 作業順序定案:先減叢逼近目標,再用剔除收尾**(組合實測,同一基準):
  | 組合 | 面數 | 輪廓保留 min |
  |---|---|---|
  | 37 叢 + 剔到 4,000 | 4,000 | **76.4%** |
  | 71 叢 + 剔到 4,000(純減面) | 4,000 | 57.6% |
  | 37 叢 + 剔到 3,000 | 3,000 | 67.4% |
  | 16 叢 + 剔到 1,500 | 1,500 | 57.9% |
  同樣 4,000 面,先減叢再剔面比純減面**多留 18.8pp 輪廓**。
- **預算算術**(來源:`tri_budget.json` —— veg 成長額度 **622,905**、現行植被總量上界
  212,963;instance 上界 broadleaf 211 / conifer2 73 / birch 98 / mangrove 98;
  神木 `placeGiantGroves` 上界 = 6 群 × 5~11 株 = **≤66 株**;tree 族 `kind_factor` 4
  ⇒ 換完整株 ≤ 5 × 現值(259~402)≈ **2,000 面/株**):
  | 方案 | 面數/株 | × instance 上界 | 佔成長額度 |
  |---|---|---|---|
  | v6 瓣化(K 平均 4) | ~880 | broadleaf 211 ⇒ 185,680 | **30%** ✓ |
  | v7 闊葉 | 1,537 | broadleaf 211 ⇒ 324,307 | **52%** ✓(吃掉一半) |
  | v7 針葉 @90% 門檻 | ~7,500 | conifer2 73 ⇒ 547,500 | **88%** ✗ |
  | v7 針葉 @90% 門檻 | ~7,500 | 神木 66 ⇒ 495,000 | **79%**,且已超 tree 族 `kind_factor` 上限(2,000)近 4 倍 ✗ |
  ⇒ **v7 針葉在現行預算下沒有位置**:過 90% 輪廓門檻要 7,500+ 面/株,而任何一格能給的
  只有 1,000~2,800。三條出路,**要選哪一條是使用者的決定**:
  ㋐ 降守門線(4,000 面 = 76.4%、3,000 = 67.4%);
  ㋑ 當 hero 資產(每張圖 1~3 株,13,080 面 × 3 = 39k = 6% 額度,輪廓 100%);
  ㋒ 再退掉別的東西換額度(§5u deadtree 那一輪的作法)。
  **v6 瓣化與 v7 闊葉都塞得下**,差別是 30% vs 52%。
- **未跑**:①以上是**上界算術**(instance 上界 × 面數上界),真值要 `measure_veg_tris.mjs`
  對選定樹種實跑;②神木 66 株是 `placeGiantGroves` 的**規劃上界**,地形淘汰後的真值未量;
  ③闊葉語料只有兩張(密冠橡樹 1,537 / 猴麵包樹 5,256)—— **猴麵包樹那張是 6 根分岔 × 32 瓣,
  已經是 v7 闊葉的 3.4 倍**,「1,537 面/株」不是穩定值,名冊定了要逐種重量。

### 5y-e. 共面合併:第三顆旋鈕,而且是唯一真正免費的那一顆

> 使用者:「**將相鄰且法線接近的面合併呢?**」

- **`merge_coplanar`**:法線夾角 < `--merge-deg` 的相鄰面取連通群,以該群的**邊界多邊形**
  重新三角化(`mapbox_earcut`,環依面積排序 ⇒ 最大的當外環、其餘當洞)。
  同一個平面上多餘的切割線刪掉**完全不改形狀**,所以它是三顆旋鈕裡唯一免費的。
- **順序 MUST 是「合併 → 剔除 → 減叢」**(由便宜到貴):剔除會把共面群切碎(邊界變鋸齒),
  反過來做合併的機會就沒了。
- **⚠ 沒有面積守恆守衛的話,它會靜靜地把整片挖掉**:0.1° 門檻下實測 **138/142 群**的
  邊界多邊形面積只有原群面積的 6.7% —— 那些群根本不是單純平面片(重疊 / 摺疊),
  合併下去等於把那一片刪掉,而報表只會顯示「省得更多」(面數 −30.5%),
  只有輪廓保留度掉到 **82.9%** 才抓得到。加上守衛(邊界面積 MUST 對得上群面積 ±2%,
  不對就原樣保留)之後,**每一個門檻的輪廓都回到 100%**,而省下的幅度也回到真實水準。
  門檻與省幅**非單調**(0.1° 省最少、2° 最多),因為門檻越鬆群越大、越容易碰到守衛 —— 
  這正是守衛在做事的證據,MUST NOT 拿「調鬆一點省更多」當直覺。
- **實測(同一基準 = 71 叢 / 13,080 面)**:
  | 方案 | 面數 | 輪廓保留 min |
  |---|---|---|
  | 71 叢 合併 + 剔除 | **11,258** | **99.9%** |
  | 37 叢 合併 + 剔除 | **5,110** | 78.5% |
  | 37 叢 只剔除(§5y-d) | 5,877 | 78.5% |
  | 16 叢 合併 + 剔除 | **1,791** | 61.3% |
  | 16 叢 只剔除(§5y-d) | 2,123 | 61.4% |
  ⇒ **同樣的輪廓、少 13~16% 的面**,逐階皆然。針葉的「免費那一段」因此從 §5y-c 的
  13.2% 擴到 **25.3%**(15,064 → 11,258,輪廓 99.9%)。
- **闊葉幾乎沒有共面可合**(1,540 → 1,533,−0.5%):它的瓣是 quadric 減過的有機曲面,
  本來就沒有多餘的平面切割線;針葉的瓣是**凸包**,才有那麼多共面小面可以併。
  ⇒ 這顆旋鈕與 §5y-c 的剔除一樣,**收穫集中在針葉那一族**。
- **預算連帶**:針葉過 90% 輪廓門檻的成本從 ~7,500 面/株降到 **~6,900**(× 73 = 81% 額度)
  —— 方向對,但**還是塞不下 conifer2**;§5y-d 的三條出路(降門檻 / hero 資產 / 換額度)
  維持不變。
- **未跑**:①`--merge-deg` 2.0 是實測選的(0.1~5° 掃過),換語料要重掃;②守衛的 ±2%
  只在這兩張語料上驗過;③合併後仍是三角網格(glTF 要三角形),沒有走 polygon 路線。

### 5y-f. 球面替代 / 合併太靠近的結構 —— 兩顆都做了,結論與直覺相反

> 使用者:「**進行更多簡化的幾何處理,例如使用球面、或合併太靠近的結構**」。

- **球面替代(`blob`,`--blob`)**:一叢換成貼著它主軸的**橢球** = 單位 icosphere 經 PCA 軸
  縮放(20 面 / subdiv 0,而凸包動輒 40~90 面)。軸取 **PCA 不取包圍盒**(斜插的葉叢用
  軸對齊盒量會虛胖一圈,而虛胖的球會蓋掉鄰叢的縫隙 = 剪影反而變胖);半徑取該軸投影的
  **P95 不取最大值**(單一離群點會把整顆球撐大)。
  | 門檻 | 面數 | 輪廓保留 min |
  |---|---|---|
  | 全部凸包(對照) | 11,258 | 99.9% |
  | 只換 < 0.3× 最大叢 | **10,689** | **97.5%** ← 肉眼分不出來 |
  | < 0.6× | 5,494 | 70.6% |
  | 全部換球 | 4,716 | 59.4% |
  ⇒ **只有最小的那一批值得換**(−5% 面 / −2.4pp,並排看不出差別);推到 0.6× 之後,
  同樣 5,000 面的預算下**輸給「直接少幾叢」**(5,110 面 @ 78.5%)。
- **合併太靠近的結構(`merge_near_clumps`,`--near`)**:中心距 < `near` ×(兩叢等效半徑和)
  就併成一叢(單一連結)。**與 `--cf-floor` 的差別是「併」不是「丟」** ⇒ floor 可以放到
  0.0004,丟掉的面積從 **54.5% 降到 24.4%**。
  **⚠ 但「併」MUST 只併瓣位、不併形狀**:第一版把併起來的群整個凸包,團與團之間的縫隙
  一起被包進去 = 一顆糊掉的大 blob,**等面數下輪廓比「丟碎屑」還差 27pp**(51.7% vs 78.5%)。
  改成群內**逐元件**各自取包絡之後形狀才回來。
  **⚠ 而它省不了面數**:面數 ≈(留下幾個元件)×(複製幾瓣),合併只動「幾叢」這個中間量。
  實測 floor 0.001 + near 1.2 = 22,536 面(2× 凸包對照)、輪廓 min 87.6% / **mean 102.5%**
  —— mean 破百的意思是它**比基準更飽滿**(把被丟掉的那 30% 面積找回來了)。
  ⇒ 這顆旋鈕的用途是**品質**不是預算:要一棵更密的樹就開它,要省面數它幫不上忙。
- **三次量測指向同一條原則**:等面數之下,**「少幾團完整的葉」永遠贏過「每一團都留但畫得更粗」**
  —— 減叢 > 減面(§5y-d,4,000 面 +18.8pp)、減叢 > 球面(本節,5,000 面 +7.9pp)、
  減叢 > 合併(本節,5,000 面 +26.8pp)。原因是這棵樹的**識別度住在「一團一團 + 團間的縫」**:
  粗化每一團會把所有團一起糊掉,丟掉幾團則讓剩下的維持銳利(§5y 那次「100 面/瓣 = 水晶碎片」
  被人眼判退,是同一件事的第一次現形)。
- **旋鈕總表(針葉,由便宜到貴;闊葉只有 ①⑤ 有感)**:
  | # | 旋鈕 | 代價 | 幅度(針葉) |
  |---|---|---|---|
  | ① | 共面合併 `--merge-deg` | 零 | −14% |
  | ② | 可見性剔除 `--cull` | 零 | −13% |
  | ③ | 球面替代 `--blob 0.3` | −2.4pp | −5% |
  | ④ | 合併太靠近 `--near` | **不省面**(+品質) | — |
  | ⑤ | 減叢 `--cf-floor` | 線性掉輪廓 | 任意 |
  | ⑥ | 減面 `--budget` | 最貴(< 5,000 面時) | 任意 |
  ①②③ 疊起來 = **−29%(15,064 → 10,689,輪廓 97.5%)**,之後才動 ⑤。
- **未跑**:①`--blob` 的 0.3 門檻與 P95 只在南洋杉上掃過;②`--near` 的品質模式沒有對
  「更密的樹是否值得 2× 面數」下判斷,那要看名冊定在哪一格;③闊葉對 ①②③ 幾乎無感
  (瓣少、彼此不重疊、曲面已減過),它的旋鈕只有分岔數與逐瓣面數。

### 5y-g. 降級鏈:使用者定案的**順序**做成一條可跑的階梯

> 使用者:「**減少瓣數、減少瓣與瓣的距離、減少葉冠分離的判斷標準,可以橢球、圓柱、
> 圓錐、角錐等簡易多邊形組合取代的話就取代、逐步放寬取代標準,最後剩餘的放寬合併的
> 法線夾角**」。⇒ `lod_ladder.py`,每一階只動**一顆**旋鈕(這樣「面數掉多少 / 輪廓賠多少」
> 逐階歸得了因),順序逐字照定案。

- **基本體替代 `best_prim`**:四種候選(橢球 20 面 / 圓柱 24 / 圓錐 12 / 角錐 8),主軸與
  尺寸走 `_pca_frame`(PCA + P95,與 `blob` **同一份**,MUST NOT 各寫一份);誤差 =
  「叢表面取樣點到基本體表面的 RMS 距離 ÷ 特徵長」—— 量**表面距離不量體積比**,體積比
  對薄片型的叢完全無感(兩邊都近乎零體積卻差很多)。誤差 > `--prim-tol` ⇒ 不換(原則 6)。
  **實測選型嚴重偏圓柱**(71 叢裡 65~67 選圓柱,橢球/圓錐/角錐合計 4~6):六角柱對
  「扁長葉叢」就是最好的 RMS 近似。四種都給是對的(真的有叢挑了別的),但別預期均分。
- **實測階梯**(針葉南洋杉,對同一基準 71 叢 / 13,080 面):
  | 階 | 面數 | 輪廓 min / mean |
  |---|---|---|
  | 原樣 | 11,258 | 99.9% / 100.0% |
  | ①瓣數 ×0.7 | **7,836** | 81.7% / 93.1% |
  | ①瓣數 ×0.5 | **6,206** | 78.4% / 87.5% |
  | ②瓣距 4%→2% | 6,232 | 78.6% / 87.9% |
  | ②瓣距 →1% | 6,225 | 78.8% / 88.2% |
  | ③分離門檻 ×2 | **2,949** | 65.3% / 78.7% |
  | ③分離門檻 ×4 | **1,340** | 58.9% / 71.9% |
  | ④基本體 tol .01 | 1,092 | 52.9% / 61.8% |
  | ④基本體 tol .02 | 644 | 40.9% / 51.3% |
  | ④基本體 tol .05 | **500** | 35.3% / 47.4% |
  | ⑤合併夾角 5° | 488 | 35.2% / 46.9% |
  | ⑤合併夾角 15° | 507 | 35.3% / 47.4% |
- **兩階的行為與名字不一樣,MUST 照實用**:
  ①**②「減少瓣與瓣的距離」不是面數旋鈕**(6,206 → 6,232 → 6,225,平的),它把 ① 讓出的
  角度補回去 ⇒ **零面數成本換回 +0.4pp 輪廓**。所以它 MUST 與 ① **同時**用(①減瓣數、
  ②立刻把剩下的瓣加寬補位),當成獨立的一階去期待它省面是誤讀。
  ②**⑤「放寬合併的法線夾角」排在鏈尾幾乎是 no-op**(500 → 488;放到 15° 反而回到 507 ——
  群變大之後被面積守恆守衛擋下的更多)。它的價值在鏈**頭**就已經領走了(§5y-e:2° 免費
  −14%)。⇒ 使用者把它排最後是對的**順序**,但它在那個位置的**幅度**接近零。
- **①③④ 才是真正的面數槓桿**:① 第一刀最划算(−30% 面 / −18pp);③ 幅度最大
  (6,225 → 1,340);④ 能一路壓到 **500 面** —— 這是這條鏈第一次進到一般植被的量級
  (node_cap 225 × 幾個節點),證明機制**收得下去**,只是那個檔位的輪廓只剩 35%。
- **人眼分界在 6,206 與 1,340 之間**:6,206 仍讀作針葉樹(略疏),1,340 剩兩三團浮在幹上、
  已經不是樹。⇒ **實用區間 = 6,000~11,000 面**,與 §5y-d/e 的守門線(≈90% 輪廓)一致,
  對 conifer2 的 73 株預算結論**不變**。
- **未跑**:①階梯只在南洋杉上跑過,闊葉那條(分岔數 + 逐瓣面數)沒有對應的鏈;
  ②`--nscale` / `--gap` / `--prim-tol` 的每一格都是手選的,不是解出來的 —— 要做成
  「給定預算自動選檔」還得把這張表擬成曲線;③基本體目前逐叢**獨立**挑,沒有做
  使用者說的「**組合**」(一叢用兩個以上基本體拼)—— 那是下一步。

### 5y-h. ⚠ 更正:守門線 MUST 逐槓桿分開訂 —— §5y-d「針葉塞不下」的結論作廢

> 使用者:「**先看圖片,要壓到多少面才夠?**」—— 看圖之後,先前那條全域守門線是錯的。

- **錯在哪**:§5y-c 訂的「輪廓保留 ≈ 90%」是拿**減面**(在每一團葉上打洞)那一組校準的,
  然後被 §5y-d/e **當成全域門檻**去算預算,結論是「v7 針葉在現行預算下沒有位置」。
  而降級鏈的 2,949 面那一階輪廓只有 **65.3%**,人眼卻**仍讀作針葉樹**(分層、枝叢、幹都在,
  只是稀);同樣 65% 的減面版早就破了。
- **原因**:同一個輪廓百分比,**來源不同、好看程度差很多** —— 減叢掉的是「幾團完整的葉」
  (剩下的仍銳利),減面掉的是「每一團上的洞」(全部一起糊)。⇒ **守門線 MUST 逐槓桿訂**:
  減面 ≥ 90%、**減叢 ≥ 65%**。拿單一數字跨槓桿比較,就會像 §5y-d 那樣把可行方案判死。
- **目標面數(回答使用者的問題)**:
  | 掛哪 | instance 上界 | 可負擔面/株 | 對應階 |
  |---|---|---|---|
  | **conifer2 全量,吃 1/3 額度** | 73 | **2,844** | ③門檻×2 = **2,949** ✓ |
  | conifer2,吃 1/2 額度 | 73 | 4,266 | ①×0.5 與 ③ 之間 |
  | 神木 tree 族(`kind_factor` 硬閘) | ≤66 | **2,010** | ③×2 與 ×4 之間 |
  | hero 資產 | 1~3 | 不用壓 | 原樣 11,258 |
  ⇒ **目標 ≈ 2,900 面/株,現行階梯已經打得到**;conifer2 全量 73 × 2,949 = 215,301 =
  額度的 **35%**,塞得下。**§5y-d 的「沒有位置」與那三條出路(降門檻 / hero / 換額度)
  一併作廢** —— 它是拿錯門檻算出來的。
- **人眼分界改訂在 2,949 與 1,340 之間**(§5y-g 寫的「6,206 與 1,340 之間」偏保守):
  1,340 面剩兩三團浮在幹上、層次沒了,那才是破。
- **未跑**:①這次判讀是**單張側視縮圖**,MUST 補「遊戲內實際尺寸 + 賽璐璐材質 + 勾線」
  的定場圖再確認(勾線會把稀疏處的破綻放大);②2,844 這個數字假設 conifer2 吃 1/3 額度
  —— 額度怎麼分是名冊那一輪的事;③還沒動過的槓桿 = **基本體組合**(一叢用兩三個基本體
  拼,目前每叢只挑一個),要再往下壓(例如只吃 1/6 額度)從那裡下手。

## 5z. Trial log (2026-08-08 — 簡單幾何版:旁瓣佈局照舊,葉冠整組換成基本體)

> 使用者:「**另外嘗試一個簡單幾何版本,旁瓣處理完成後葉冠直接用簡單幾何圖形取代,
> 針葉林使用多角錐,闊葉林使用多面體或橢球,樹枝樹幹使用圓柱、圓台或多面柱,尖端使用
> 細圓錐或細角錐**;可調整不同茂密程度,或拿掉葉冠變枯木;與先前對話的版本列圖比較。」
> ⇒ `simple_tree.py`(新)+ `sheet_simple.py`(列圖),產出 `out_simple/sheet_*.png` 五張。

### 5z-a. 它**不是**降級鏈的第 N 階,是另一條路線

| | §5y-g ④ 基本體替代 | 本輪 簡單幾何版 |
|---|---|---|
| 挑形狀的依據 | 逐叢 **RMS 誤差**挑四種裡最像的(實測 71 叢裡 65~67 挑到圓柱) | **樹種指定**:針葉多角錐 / 闊葉橢球或多面體 |
| 過不了門檻 | `--prim-tol` 退回凸包 ⇒ 一棵樹是**混血** | 沒有門檻、沒有退路,葉冠**整組**換掉 |
| 幹與枝 | 沿用浮雕 lathe / 錐管 | 一起換成圓台堆疊 / 收尖細錐 |
兩者 MUST NOT 互相取代:前者的目的是「在不太走鐘的前提下省面」,後者是「換一種造型語言」。

### 5z-b. 佈局 MUST 共用,否則列圖比較沒有意義

列圖比較的前提是**只有葉冠幾何這一個變因**在動 ⇒ 從 `canopy_petals.py` 抽出三個縫,
兩版同吃:`trunk_cut`(幹/冠分界)、`clump_metrics`(逐叢量測,新增 `r_out`/`y_lo`/`y_hi`
三欄只有簡單幾何版讀)、`plan_lobes`(③複製幾瓣 / ④分幾層 / 層內角格與零均值誤差 /
層間錯開偏移)。**抽出前後 v7 逐位元相同**(重跑 lod00 同參數,`max|ΔV| = 0.0`、faces 全等)
—— 這是抽縫唯一可接受的驗收方式。另補 `twig(r1 → 0)` 的單一頂點分支(= 使用者的「尖端」);
r1 > 0 的路徑逐位元不變。**MUST NOT 靠「給一個很小的 r1」假裝收尖** —— 梢端會留一圈零面積
三角形(法線 NaN),勾線那一 pass 會在每一根枝的尖端畫出一坨黑點。

### 5z-c. 基本體:面數是**算出來的**,不是問函式庫要來的

自建 `prim_cone` / `prim_bipyr` / `prim_prism`(+ trimesh icosphere 當橢球),面數精確:

| 基本體 | 面數 | 用途 |
|---|---|---|
| 多角錐 `cone(n)` | 2n−2(n=6 ⇒ **10**) | 針葉葉冠(使用者指定)、尖端 |
| 雙角錐 `bipyr(n)` | 2n(n=4 = **八面體 8**、n=6 ⇒ 12) | 闊葉的「多面體」選項 |
| 多面柱 `prism(n, taper)` | 4n−4(n=6 ⇒ **20**) | 幹與枝:taper=1 圓柱 / <1 圓台 / n 小 多面柱 |
| 橢球 `icosphere(0/1)` | **20** / 80 | 闊葉葉冠(使用者指定) |
「圓柱 / 圓台 / 多面柱」是**同一支函式的三組參數**,「細圓錐 / 細角錐」是同一支的兩個 n ——
分開寫成三支五支就是同一件事的第 N 份實作。自建的理由是**面數就是這一版的賣點**:靠
`trimesh.creation` 的慣例去猜面數,等於沒有預算。全部驗過 watertight 且體積為正(繞序正確)。

### 5z-d. 切向半徑取**弦長**,不取弧長、也不取叢自己的厚度

浮雕板的 z 向厚度趨近零(它是半個物體),v7 是把 z 映成角向楔 `bend_wedge`;**基本體不會彎**
⇒ 三個軸改成圓柱座標:徑向 ← `r_in ~ r_out`、垂直 ← 叢高、切向 ← `r_mid × sin(fill × span / 2)`。
取**弧長**會在瓣數少時(span 180°)撐出一顆比樹還寬的球;取**叢自己的 z** 會薄成一張紙。
弦長同時讓 `--gap`(瓣與瓣的距離)在本版維持原本的語意。

### 5z-e. ⚠ 幹的剖面吃到冠高 —— 剪影 88% 而「樹沒了」

第一版 `stack_trunk` 把寬度剖面吃到 `y_top`,而針葉樹走**中央主幹**時 `y_top` = 冠頂
⇒ **把冠寬讀成幹寬**,長出一根與樹冠等粗的六角柱,葉冠整個埋進去。
**兩個指標都沒有反應**:面數 2,532 正常、輪廓保留 min **88.0% / mean 96.0%**(比修好之後的
73.0% / 76.4% 還「漂亮」—— 因為那根柱子把剪影填滿了)。只有看圖才發現。
⇒ 修法:剖面 MUST 只吃 `y ≤ trunk_top`,冠內那一截 MUST 是外推的收斂錐(`r_end_f`,
與 v7 `tp += [(tp[-1][0] * 0.6, spine_top)]` 同一條規則;中央主幹取 0.35)。
**這是 §5y-h「先看圖片」的第二次現形**,而且比第一次更硬:上一次是「同一個百分比、來源不同
好看程度不同」,這一次是**百分比往錯的方向動**。⇒ 輪廓保留度 MUST NOT 單獨當守門數。

### 5z-f. 實測:針葉(南洋杉,對 v7 原樣 11,258 面量剪影)

| 版本 | 面數 | 輪廓 min / mean | 人眼 |
|---|---|---|---|
| v5 黑桃瓣 K5(整片冠) | 900 | 74.2% / 77.3% | 一朵花,不是樹 |
| v7 逐叢瓣化 原樣 | 11,258 | 100% / 100% | 基準 |
| 降級鏈 ③門檻×2 | 2,949 | 65.3% / 78.8% | 一堆浮著的板片 |
| 降級鏈 ④基本體 tol.05 | 500 | 35.3% / 47.4% | 破 |
| **簡單幾何 逐瓣多角錐 full** | **2,532** | **73.0% / 76.4%** | **分層針葉樹,枝叢清楚** |
| 簡單幾何 疊層多角錐 | **172** | 95.6% / 116.5% | 經典低模聖誕樹 |
| 簡單幾何 整冠單錐 | **82** | 83.9% / 98.1% | 一顆錐,遠景 LOD |
| 簡單幾何 枯木 bare | 144 | 8.5% / 14.2% | 只剩一根桿 + 三根枝,太光 |
| 簡單幾何 枯木 sparse | 288 | 12.5% / 17.2% | **讀作枯木** |
**同面數下贏降級鏈**:2,532 vs 2,949 —— 面數少 14%、輪廓 min 高 7.7pp(mean 反而低 2.4pp,
兩個數字打架),而**圖差得很多**:降級鏈那一階是散落的板片,簡單幾何是有層次的枝叢。
⇒ 這一組是「數字幾乎打平、圖不打平」的典型,判準只能是圖(§5y-h)。原因與 §5y-h 同一條:
降級鏈到那一階是**在每一團葉上打洞**,簡單幾何是**每一團都完整、只是換成一顆錐**。

**茂密程度階梯**(同一棵樹,一顆旋鈕同時動 ①瓣數 ②瓣距 ③分離門檻 —— §5y-g 實測 ② 不省
面數、它是 ① 的補償,MUST 同時動):

| 檔 | 面數 | 輪廓 min / mean | 人眼 |
|---|---|---|---|
| bare | 178 | 25.5% / 30.7% | 不是樹 |
| sparse | 438 | 46.0% / 53.9% | 疏但成立 |
| **mid** | **1,138** | 56.2% / 63.3% | **乾淨的分層針葉樹** |
| full | 2,532 | 73.0% / 76.4% | 較密 |
| lush | 13,464 | 84.1% / 94.2% | 密,但回到 GIANT 級面數 |
| full・四角錐 `sections 4` | 1,848 | 70.4% / 74.6% | 與六角錐幾乎分不出來 |
| full・八角錐 `sections 8` | 3,216 | 73.8% / 77.1% | 同上 |
⇒ **邊數是最便宜的旋鈕**:6 → 4 省 27% 面而人眼無感;要再省先動它,不要先動茂密度。

### 5z-g. 實測:闊葉 —— `--major` 是這一族的主旋鈕,不是茂密度

| 版本 | 面數 | 輪廓 min / mean | 人眼 |
|---|---|---|---|
| 橡樹 v5 黑桃瓣 K5 | 880 | 228% / 281% | (基準 v7 橡樹本身很薄) |
| 橡樹 v7 逐叢瓣化 | 1,533 | 100% / 100% | 基準 |
| 橡樹 簡單幾何 橢球 `major .6` | 240 | 81.6% / 94.2% | **兩坨,像蝴蝶不像樹** |
| 橡樹 簡單幾何 雙角錐 `major .6` | 168 | 72.3% / 83.2% | 同上,更有稜 |
| 橡樹 簡單幾何 八面體 `major .6` | 132 | 62.3% / 80.4% | 同上,最省 |
| **橡樹 簡單幾何 `major .3`** | 3,904 | 242% / 271% | **圓潤的團塊冠,成立** |
| 橡樹 簡單幾何 `major .15` | 14,292 | 270% / 320% | 更飽滿,但已是 GIANT 級 |
| 橡樹 整冠單橢球 | **80** | 90.2% / 113.6% | 一顆球,遠景 LOD |
| 猴麵包樹 v7 逐叢瓣化 | 5,256 | 100% / 100% | 基準 |
| **猴麵包樹 簡單幾何 橢球** | **748** | **94.1% / 100.2%** | **成立**(6 根分岔 × 32 瓣) |
- **`--major 0.6` 對簡單幾何版太緊**:§5y-b 訂它是為了收掉 v7 的「43 叢 = 43 根主枝」,而
  v7 靠**一瓣繞著彎**把 2 根分岔撐成整片冠;**基本體不會彎** ⇒ 同樣 2 根就只能是兩坨。
  ⇒ 這一族的主旋鈕是分岔數,茂密度是次要的。猴麵包樹(6 根)不必調就成立,正說明問題
  出在「分岔太少」而不是「基本體不行」。
- **剪影 % 在這一族不可跨版本讀**:v7 橡樹的瓣是**薄刃**(浮雕板減面而來),基本體是**實體**
  ⇒ 同一個剪影框裡自然覆蓋得多,242% 不代表「比基準好 2.4 倍」。這一族一律以圖為準。

**分岔開夠之後,再用茂密度把面數壓回預算**(橡樹 `--major .3`;% 只在這張表**內部**可比):

| 檔 | 面數 | 輪廓 min / mean | × broadleaf 211 | 佔成長額度 | 人眼 |
|---|---|---|---|---|---|
| bare | 536 | 169% / 206% | 113,096 | **18.2%** ✓ | 團塊少,像大灌木 |
| **sparse** | **1,276** | 215% / 244% | 269,236 | **43.2%** ✓ | **圓潤團塊冠,成立** |
| mid | 2,892 | 233% / 255% | 610,212 | 98.0% ✗ | 更密,但塞不下 |
| full | 3,904 | 242% / 271% | 823,744 | 132% ✗ | 同上 |
| sparse・雙角錐 | 892 | 195% / 220% | 188,212 | **30.2%** ✓ | 有稜的團塊 |
| **sparse・八面體** | **700** | 190% / 208% | 147,700 | **23.7%** ✓ | 最省,結晶感 |
⇒ **闊葉的答案 = `major .3` + `sparse`(1,276)或 `sparse 八面體`(700)**,兩者都同時過
成長額度與 `kind_factor`;`mid` 以上兩道閘都過不了。**換基本體比調茂密度便宜**:
橢球 20 面 → 雙角錐 12 → 八面體 8,面數掉 45% 而輪廓只掉 25pp、圖上仍是同一棵樹。

### 5z-h. 枯木是**同一副骨架的另一態**,不是另一棵樹

`--crown none` 走**同一份佈局**,只是把葉冠基本體換成收尖的細錐(= 光禿的枝,一路伸到
`r_out`),幹頂再補一根斷梢。⇒ 同一棵樹的「有葉 / 無葉」兩態,骨架逐位元同一副。
`bare` 那一檔太光(針葉 144 面、闊葉 96 面,剩一根桿加三根枝),**`sparse` + `--twig-r 0.02`
才讀作枯木**(針葉 288 面 / 闊葉 456 面)。
- **⚠ 枯木 MUST 走中央主幹**:闊葉在有葉時是「幹到冠底就分岔」(v7 的作法),而枯木沿用
  那一條的下場是**所有枝從同一點放射 = 一叢星芒**(實測闊葉枯木 456 面那一版)。葉冠一拿掉,
  遮住那個交會點的東西就沒了 ⇒ 枯木一律 `leader`(幹走到冠頂、枝**沿著幹**掛在自己的高度)。

### 5z-i. 預算算術(對 `tri_budget.json`:veg 成長額度 622,905;tree 族 `kind_factor` 硬閘 ≈ 2,000 面/株)

| 方案 | 面/株 | × instance 上界 | 佔成長額度 | `kind_factor` |
|---|---|---|---|---|
| 針葉 簡單幾何 **mid** | 1,138 | conifer2 73 ⇒ 83,074 | **13.3%** ✓ | ✓ |
| 針葉 簡單幾何 full | 2,532 | 73 ⇒ 184,836 | 29.7% ✓ | **✗ 超過 2,000** |
| 針葉 疊層多角錐 | 172 | 73 ⇒ 12,556 | 2.0% ✓ | ✓ |
| **闊葉 `major .3`・sparse** | 1,276 | broadleaf 211 ⇒ 269,236 | **43.2%** ✓ | ✓ |
| 闊葉 `major .3`・sparse 八面體 | 700 | 211 ⇒ 147,700 | **23.7%** ✓ | ✓ |
| 闊葉 `major .3`・mid | 2,892 | 211 ⇒ 610,212 | 98.0% ✗ | ✗ |
| 闊葉 整冠單橢球 | 80 | 211 ⇒ 16,880 | 2.7% ✓ | ✓ |
| 枯木 sparse(針葉) | 288 | deadtree 121 ⇒ 34,848 | 5.6% ✓ | ✓ |
⇒ **針葉的答案是 `mid` = 1,138 面/株**:同時過「成長額度」與「tree 族 `kind_factor`」兩道閘,
而 §5y-h 為 v7 訂的目標是 2,900(只過得了前者)。簡單幾何版把針葉那一格的成本壓到**四成以下**。
**闊葉是 `major .3` + `sparse`(1,276)**;兩族合計 269,236 + 83,074 = **56.6%** 額度,
其餘(shrub 1909 / birch 98 / mangrove 98 / deadtree 121)還有 43% 可用。

### 5z-k. 第二輪四條(同日,使用者看過列圖之後)

> ①「**樹枝不要全部都是水平分岔,0~30° 斜上都有可能,同一棵角度 ±3° 的誤差內,分岔高度也
> 上下錯開**」②「**闊葉林的葉冠盡量胖一點,偏心率 0.5~1**」③「**針葉林的葉冠使用雙錐體,
> 盡量細長,0.2~0.4**」④「**葉冠體積高比例重合時合併**」。

- **⚠「偏心率」在這裡讀作「短軸/長軸」而不是天文學的 `e = √(1−b²/a²)`** —— 這是一個**取捨**,
  MUST 記下來:照 `e` 讀的話,闊葉的 0.5~1 是**越來越扁長**(與同一句的「盡量胖一點」相反)、
  針葉的 0.2~0.4 反而接近球(與「盡量細長」相反)。**兩句話同時成立的只有軸比這個讀法**,
  故 `FAM_RATIO = {conifer: (0.2, 0.4), broadleaf: (0.5, 1.0)}`。若使用者要的是天文學定義,
  兩族的數對互換即可(`clamp_ratio` 不必改)。
- **① 仰角是「這一棵樹」的性質,不是逐枝亂數**:`--branch-deg` 逐株落在 0~30°,同一棵樹內
  只有 `--branch-jit` ±3° 的**零均值**誤差,走 `petal_jitter` **同一支**(§2.3 的亂數紀律 ——
  在這裡另起一條序列就是第二份決定性來源)。
- **① 掛枝高度是「解」出來的,不是另外抽的**:葉冠位置早被佈局定死 ⇒ `y_att = y_c − r_in·tanθ`。
  這一步順便兌現「分岔高度上下錯開」的一半(`r_in` 逐叢不同 ⇒ 掛點自然散開);**另一半必須
  顯式給** —— 同一叢複製出來的 N 瓣 `r_in`/`y_c` 完全相同,不另加一道零均值錯開(`--fork-jit`
  × 層厚)的話,那 N 根枝會**疊在同一個高度**上,而畫面上只表現成「這一圈枝好像是一片」。
- **① 的連帶:幹高 MUST 由最高的掛枝點反推**。斜上的枝把掛點往下推,但闊葉「幹到冠底就
  分岔」那條規則會讓內圈的高叢掛在 `fork_y` **之上** ⇒ 枝的根部懸空。⇒ `y_top =
  max(冠底或冠頂, max(y_att))`,而這也把幾何合成的順序倒過來:**先定案逐瓣,再建幹**。
- **③ 雙錐體的尖端 MUST 對齊最長軸**(`AXIS_OF[argmax(rad)]`,推導不手寫):三軸來自量測
  (徑向 ← `r_in~r_out`、垂直 ← 叢高、切向 ← 弦長),誰最長逐叢不同;把軸寫死成「徑向」,
  扁而高的叢會被擺成一根橫躺的針。順帶修掉一個潛伏的錯:`AXIS_PERM['t']` 原本寫成 `[2,1,0]`
  (尖端仍留在 Y 上 = 這個選項無效),正解是 `[0,2,1]`。
- **②③ 的夾制 MUST 保住最長軸**:`clamp_ratio` 只夾另外兩軸。三軸一起 clip 會把整顆縮小
  (`np.clip(r, lo·L, hi·L)` 對 `hi < 1` 連最長軸都會砍到 `hi·L`),剪影當場少一圈。
- **④ 與 §5y-f 的 `merge_near_clumps` 是兩件事,MUST NOT 合併成一支**:那一支量的是**叢**的
  中心距、發生在**佈局之前**、併的是**瓣位**;這一支量的是**擺好之後**兩顆冠層基本體真的
  疊了多少**體積**,門檻是「交集 ÷ 較小那顆」。代理用**等體積球**(`r_eq = (abc)^⅓`,球球
  交集有閉式解)—— 橢球對橢球的真交集沒有閉式解,而「高比例重合」這個判準本來就只需要
  「疊得多不多」。**併起來的那一顆 MUST 覆蓋成員**(圓柱框下逐軸取 `|偏移| + 該成員半徑`
  的最大值),MUST NOT 取平均半徑 —— 那會把兩顆縮成更小的一顆,剪影開洞(§5y-f「整群一次
  凸包等面數下輪廓還差 27pp」是同一個坑的另一面)。

**實測(逐條疊上去,這樣「面數掉多少 / 形變多少」歸得了因)**:

| 針葉・density mid(對 v7 11,258 量) | 面數 | 輪廓 min / mean |
|---|---|---|
| ① 第一輪(多角錐・水平枝) | 1,138 | 59.0% / 66.0% |
| ② + 雙錐體 | 1,284 | 61.7% / 68.2% |
| ③ + 軸比 .2~.4(細長) | 1,284 | **52.7% / 56.1%** |
| ④ + 分岔 18°±3° / 高度錯開 | 1,284 | 52.6% / 56.1% |
| **⑤ + 重合合併 .5 = 定案** | **1,212** | 52.8% / 56.3% |
| 分岔 0°(全水平) | 1,212 | 52.9% / 56.4% |
| 分岔 30°(最斜) | 1,212 | 52.9% / 56.4% |
| 合併門檻 .8(只併幾乎重疊) | 1,248 | 52.8% / 56.3% |

| 闊葉・major .3 + sparse(對 v7 1,533 量;% 只在表內可比) | 面數 | 輪廓 min / mean |
|---|---|---|
| ① 第一輪(橢球・水平枝) | 1,276 | 215.0% / 244.6% |
| ② + 軸比 .5~1(胖) | 1,276 | 218.9% / 256.2% |
| ③ + 分岔 18°±3° / 高度錯開 | 1,276 | 220.5% / 257.0% |
| **④ + 重合合併 .5 = 定案** | **1,236** | 220.5% / 257.0% |
| 軸比 .8~1(最胖) | **1,056** | 231.3% / 283.7% |
| 雙角錐 + 軸比 .5~1 | **868** | 204.3% / 231.8% |
| 枯木(斜枝 + 高度錯開) | 456 | 56.6% / 65.8% |

四條的性價比差很多,**而且有兩條與直覺相反**:
- **③ 軸比是這一輪最貴的一刀**(針葉 −9.0pp 輪廓、**零面數成本**)。這不是 bug ——
  「盡量細長」本來就是把體積拿掉,付的是剪影不是面數。要不要付這個價是造型決定。
- **④ 分岔仰角對剪影幾乎無感**(0° 與 30° 差 0.1pp),但幾何 `max|ΔV| = 0.165` = **樹高的 17%**
  —— 枝被葉冠遮住了。⇒ **判這一條 MUST 看枯木**,拿有葉狀態的剪影或縮圖去看等於沒看。
- **⑤ 重合合併真的免費**:針葉 −72 面(併掉 6 顆)、闊葉 −40 面(2 顆),輪廓 +0.1pp / 0.0pp。
  門檻 .8 只併掉一半(1,248)⇒ .5 是實測選的,換語料要重掃。
- **② 與 ④ 互相加成**:闊葉軸比拉到 .8~1(最胖)之後面數反而從 1,276 掉到 **1,056** ——
  胖了以後彼此重合更多、被合併掉的更多。「調胖」在這一版是**省面**的方向,不是耗面的方向。
- **雙角錐當闊葉冠也成立**(868 面,12 面/顆 vs 橢球 20):輪廓 −16pp 但圖上仍是同一棵樹,
  是目前最省的闊葉檔。

**分岔仰角只能在枯木上判**(`sheet_round2_branch.png`,針葉 288 面 / 闊葉 456 面,逐格面數相同):
0° 是一圈水平刺、30° 是明顯斜上的枝且掛點沿幹分布,兩者一眼可分;而剪影 min 從 15.9% 到
15.9%(針葉)、22.5% 到 23.9%(闊葉)—— **這個數字對這一條完全沒有解析度**。
⚠ 但同一張表也給了一個**還沒兌現**的結果:「不錯開高度」(`--fork-jit 0`)與「同株誤差 0°」
(`--branch-jit 0`)在闊葉 sparse 上**看不出差別**(剪影 ±0.1pp,圖上也分不出)——
那一檔每叢只複製一兩瓣,兩顆次級旋鈕沒有作用對象。要判它們 MUST 找**同一叢複製多瓣**的
檔位(針葉 full / lush),這一輪沒跑。

**預算連帶**(instance 上界 conifer2 73 / broadleaf 211,成長額度 622,905):
針葉定案 1,212 ⇒ **14.2%**;闊葉定案 1,236 ⇒ **41.9%**、軸比 .8~1 版 1,056 ⇒ 35.8%、
雙角錐版 868 ⇒ **29.4%**。兩族合計 **43.6%~56.1%**,`kind_factor` 2,000 那道硬閘全數通過。

### 5z-l. 第三輪兩條:淨幹下 1/4 不分岔 + 懸空葉冠放大/清理

> ①「**樹幹下面 1/4 的部分不要有樹枝分岔,未滿足的話延伸到滿足即可**」
> ②「**好幾個葉冠看起來懸空沒有連結、太稀疏,調整放大或清理**」。

- **① 延伸的是幹,不是把枝往上推**:把犯規的枝夾到那條線上,最低的一圈枝會**全部擠在同一個
  高度** —— 而「分岔高度上下錯開」才剛做完(§5z-k ①)。⇒ 往**下**延伸淨幹,量是**解**出來的:
  `Δ = (frac·Hₜ − a) / (1 − frac)`(a = 最低掛枝點離地),frac = ¼ 即 `Δ = (H − 4a)/3`。
  **「即可」= 取等號**,MUST NOT 多給 —— 多給就是憑空把樹拉長,那不是使用者要的。
  實測延伸量:針葉 21.0%H / 闊葉 29.9%H / 枯木 16.0%H(逐棵不同,因為它是解出來的)。
- **② 的真兇是第二輪自己製造的**:`r_mid` 在 `clamp_ratio` **之前**算,而夾制會把徑向半徑
  夾小 ⇒ 葉冠內緣退到枝端**之外**,中間空一截 = 看起來懸空。⇒ **內緣釘在枝端**
  (`r_mid = r_in + rad[0]`,無枝的釘到軸)是**構造保證**,不是事後檢查。
  「有沒有連結」因此分成兩層,MUST 分開處理:**與枝/幹的連結靠構造**、**與鄰居的連結是密度問題**。
- **② 的第二層才是「放大或清理」**:對鄰居的最大重疊 < `--lonely` 者先**逐步**放大到
  `--grow-max`,仍碰不到就刪。**MUST 逐步試而不是一次乘到底** —— 一次乘滿會把本來只差一點的
  那幾顆變成一坨。距離函式 `lobe_dist` 與 ④ 合併**共用一支**:兩個判定用不同的距離,
  「併掉的」與「判成孤立的」會是兩組樹。
- **⚠ 釘枝端單獨開的時候輪廓是掉的**(52.8% → **49.2%**):它把葉冠往內拉,樹**變小但變連貫**。
  ⇒ 它是「修連結」不是「加輪廓」,MUST NOT 拿剪影去驗它有沒有做對;真正把輪廓拉回來的是
  後面的孤兒放大(49.2 → 56.8)與淨幹延伸(56.8 → 60.2,多出來的那截幹落在掃描框內)。
  這一條是本輪第三次遇到「指標與目的不同軸」(前兩次:§5z-e 的胖樹幹、§5z-k 的分岔仰角)。

| 針葉・density mid | 面數 | 輪廓 min / mean |
|---|---|---|
| 第二輪定案 | 1,212 | 52.8% / 56.3% |
| + 內緣釘枝端 | 1,236 | 49.2% / 53.8% |
| + 孤兒放大 25 / 清掉 21 (`--lonely .02`) | **984** | 56.8% / 61.9% |
| **+ 淨幹 ¼ = 定案** | **1,004** | **60.2% / 65.5%** |
| `--lonely .05`(清更多) | 968 | 61.0% / 68.9% |

| 闊葉・major .3 + sparse | 面數 | 輪廓 min / mean |
|---|---|---|
| 第二輪定案 | 1,236 | 220.5% / 257.0% |
| **第三輪定案**(放大 28 / 清掉 3 / 合併 1) | **1,216** | 280.2% / 325.1% |

**面數與輪廓同時改善**(針葉 1,212 → 1,004 而輪廓 +7.4pp):清掉的是真的孤零零掛著的那 21 顆,
留下的放大之後連成團 —— 這與 §5y-f「等面數之下少幾團完整的葉永遠贏過每一團都留但畫得更粗」
是同一條原則的第四次現形。**預算**:針葉 1,004 × 73 = **11.8%**、闊葉 1,216 × 211 = **41.2%**。

### 5z-m. 第四輪:太稀疏 → **先拉長填滿空間**,還是太稀疏才刪

> 使用者:「**太稀疏的葉冠先嘗試拉長放大填滿空間,還是太稀疏再刪除**」。
> ⇒ 三段依序:㋐拉長 → ㋑等比放大 → ㋒刪除。刪除退成**最後手段**。

- **⚠ 判準也得換,不然「拉長」沒有意義**:§5z-l 的孤兒判定沿用 `sphere_overlap` 的**等體積球**
  重疊比,而等體積球是**各向同性**的 —— 它量不出「朝鄰居那個方向夠不夠長」,而使用者要的
  正是往那個方向填。⇒ 改成**方向性支撐半徑**的接觸率
  `contact = (supᵢ(u) + supⱼ(−u)) / d`,`sup(rad,u) = √Σ(rₖuₖ)²`(軸對齊橢球的閉式解),
  ≥ 1 就是真的碰到了。**合併那一支仍走體積比** —— 使用者當時的原話是「**體積**高比例重合」,
  兩個判準各自對應各自那句話,MUST NOT 互相取代;距離向量則共用 `lobe_dir`。
  (雙錐 / 多角錐內接於同一顆橢球 ⇒ `sup` 是**高估**,偏差朝「不刪」,原則 6。)
- **㋐拉長是逐軸加權,不是等比**:`f = 1 + (s−1)·w`,`w = |Δₖ| / max|Δ|` —— 朝最近鄰的**主要
  方向**拉滿、其餘按比例。等比放大填的是**體積**,拉長填的才是**那一道縫**。
- **⚠ 拉長刻意不再過 `clamp_ratio`**:軸比是「這一族長什麼樣」的預設,而孤兒本來就是例外處理;
  再夾一次等於把剛拉出去的長度收回來 —— `clamp_ratio` 保最長軸,拉長軸之後其餘兩軸會被
  推回 `lo × 新最長軸`,整顆退化成等比放大。這是「兩條規則互相抵消」的典型,MUST 記著。
- **逐顆就地更新**(後面的葉冠看得到前面剛拉長的)⇒ 一顆補上之後順帶救活鄰居,刪除數自然降。

| 針葉・density mid | 面數 | 輪廓 min / mean | 拉長 / 放大 / 刪 |
|---|---|---|---|
| 不處理(`--touch 0`) | 1,256 | 53.1% / 57.4% | — |
| **只刪不拉長**(對照組) | 1,016 | **41.9% / 47.7%** | 0 / 0 / **多** |
| **拉長→放大→刪 = 定案** | 1,220 | 57.1% / 61.9% | **16 / 0 / 3** |
| 拉長上限 4.0 | 1,256 | **65.7% / 72.7%** | 更多 / 0 / 更少 |
| `--touch 1.15`(要求更貼) | 1,220 | 62.4% / 68.8% | — |
| 闊葉 不處理 | 1,276 | 222.5% / 247.8% | — |
| **闊葉 定案** | 1,256 | 242.5% / 274.9% | **14 / 0 / 1** |

- **刪除真的退成最後手段**:針葉 21 → **3**、闊葉 3 → **1**,而且**一顆都沒用到㋑等比放大**
  —— 拉長就夠了。「只刪不拉長」那一組是這條規則的反面對照:面數最少(1,016)但輪廓掉到
  **41.9%**,圖上就是被挖得稀稀落落 —— 正是使用者要避免的那個樣子。
- **⚠ 拉長上限不宜再放大**:`--stretch-max 4.0` 的數字最漂亮(65.7%,面數只多 36),但圖上
  會長出**單一片異常大的扁平菱形** —— 一顆葉冠被拉成一大片薄板。2.5 是「填得滿但不生巨片」
  的實測選值;要更密請改 `--touch`(1.15 同面數、+5.3pp,而且不生巨片),不要改 `--stretch-max`。
- **代價**:面數從 §5z-l 的 1,004 升到 1,220(留下了 18 顆本來要刪的),輪廓 60.2% → 57.1%
  —— 拉長只填縫、不像等比放大那樣把三個軸一起吹胖。這是使用者指定的取捨,不是退化。
  預算:針葉 1,220 × 73 = **14.3%**、闊葉 1,256 × 211 = **42.6%**。

### 5z-n. 第五輪:`--touch` 定案 = **1.15**(§5z-j ⑨ 收斂;代價為零)

> 使用者 2026-08-08:「`--touch` 設 1.15」。§5z-j ⑨ 那條「造型決定」由此關閉。
> 列圖 `out_simple/sheet_touch.png`(兩族 × 兩值 × 側視/俯視,2×4)。

- **1.15 有機制解釋,不是憑感覺加的安全係數**:接觸率的支撐半徑 `sup` 是**軸對齊橢球**的
  閉式解,而葉冠基本體(雙錐 / 多角錐)**內接於**那顆橢球 ⇒ `sup` 系統性**高估**
  (§5z-m 已註明「偏差朝不刪,原則 6」)。⇒ `1.0` 是**橢球意義上**的剛好碰到,而那一對
  **實體**之間其實還隔著一道縫;1.15 是把這個系統性高估補回去的餘裕。MUST NOT 改回 1.0
  —— 1.0 是幾何上的剛好,不是畫面上的貼合。
- **代價是零**:兩族**面數逐位元不變** ⇒ **預算完全不動**(針葉 1,220 × 73 = 89,060 = **14.3%**、
  闊葉 1,256 × 211 = 265,016 = **42.5%**、合計 354,076 = **56.8%**;`kind_factor` 2,000 兩族皆過)。
  動的只有孤兒處理的**分派**:針葉 拉長 16 → **25**、等比放大 0 → **1**、刪 **3 → 3**。
  **刪除數不變是這一輪的關鍵讀數** —— 更嚴的門檻沒有把更多葉冠判死,它只是讓本來就在的
  那些多拉長一點(§5z-m「刪除退成最後手段」在更嚴的門檻下**仍然成立**)。

| `--touch` | 針葉 mid 面數 | 輪廓 min / mean | 闊葉 `major .3`+sparse 面數 | 輪廓 min / mean |
|---|---|---|---|---|
| 1.0(§5z-m 定案) | 1,220 | 57.1% / 61.9% | 1,256 | 242.5% / 274.9% |
| **1.15 = 定案** | **1,220** | **62.4% / 68.8%** | **1,256** | **266.5% / 318.5%** |

- **闊葉這一半是本輪才第一次有數字**:§5z-m 的表只量了針葉的 1.15,而**預算是逐族算的**
  (闊葉 instance 211,是針葉 73 的三倍)⇒ 少那一半,定案的代價就是猜的。補齊後才知道
  「代價為零」對兩族同時成立。
- **⚠ 輪廓這個數字對兩族讀法相反,闊葉的 +43.6pp MUST NOT 當成品質證據**:
  `silhouette_keep` 回的是 `nb / na` = **新 ÷ v7 基準**的剪影覆蓋率比,不是「保留度」。
  針葉 <100% ⇒ 越高 = 越接近 v7;**闊葉 >200% ⇒ 越高 = 離 v7 越遠(更胖)**。
  ⇒ 闊葉那一格只有**圖**能判(§5z 這一族的老規矩:判準是圖,剪影只當哨兵 —— §5z-j
  已有四次「指標與目的不同軸」的前科)。**看圖的結論**:針葉 1.15 的葉片更粗、俯視星形的
  輻條間縫隙收小 = 更貼;闊葉 1.15 的橢球顆粒變大並彼此相接、樹冠連成一團、枝幹空隙被蓋住,
  且**沒有** `--stretch-max 4.0` 那個「單一片異常大的扁平菱形」失敗型態。兩族都是使用者
  要的「同面數、圖上更密」。
- **⚠ 改預設值會讓歷史對照組靜默漂移**:`sheet_round4`(§5z-m 那張)有五格是吃預設的,
  預設一改就變成「同一個標籤、不同的數字,而且不報錯」⇒ 新增 `R4 = {'touch': 1.0}` 常數把
  §5z-m 的格子**顯式釘死**(同 R1/R2 的「對照組的定義只准有一份」)。本輪重跑逐格對上舊值
  (針葉 1,220 / 57.1% / 61.9%、闊葉 1,256 / 242.5% / 274.9%)= 這道釘子有效。
- **⚠ 原型碼未版控,定案 MUST 在此留字面紀錄**:study clone **沒有 `.git`** ⇒ 落地面只存在
  那台機器上。重建時照抄這一行:
  `ap.add_argument('--touch', type=float, default=1.15, …)`(`simple_tree.py`)。
  儲存庫端**零消費端**(`--touch` 與觸控 UI 的 `touch` 完全無關)⇒ 本輪儲存庫只有 runbook 改動。

### 5z-o. 入庫輪:走零件庫,一株 = **木質 + 葉冠兩顆節點**;預算模型換本尊

> 使用者 2026-08-08 定案:①**走零件庫**(§5z-j ③);②闊葉**保圓潤冠**,寧可從 shrub 挖額度;
> ③針葉改**疊層多角錐,凸角朝上、平整面朝下**。列圖 `out_simple/sheet_bl_budget.png`、
> 並排 `tools/.shots/veg/`。

- **一顆整樹節點行不通,MUST 是兩顆**:一列 = 一個 InstancedMesh = **一份材質** ⇒ 整株併成
  一列會同時失去 ①樹幹與葉冠同色 ②`seasonColor` 季節換色(那一列沒有 `key`)③**A39 軟性物質**
  (`vegSoftKind` 逐列判 ⇒ 只能二選一:樹幹跟著風擺,或葉子不擺)。三樣都沒有錯誤訊息。
  §5u 的 `snag_a` 能單列是因為枯幹**本來就單色、不換季、不是軟性** —— 不是「整株一列」成立。
  ⇒ `def.whole` 改成**陣列 + 全有全無**(`every`:只載到木質 = 一棵沒有葉子的樹,比整型退回
  保險絲更糟)。生成端同步拆群,**合併輸出逐頂點位元不變**(索引記群、不換序 —— 換序會讓
  §5z-f~§5z-n 四輪的產物不能宣稱可重跑)。
- **兩顆 MUST 共用一個變換**(`normalize_parts --group`,本輪新增):各自縮到自己的包絡 = 兩個
  不同的縮放 ⇒ **樹會散開**,而外廓契約與三角形預算**全綠**、只有截圖看得出來。共用之後相對
  位置烤進頂點,消費端兩列因此共用同一個 `y`(= 聯集半跨),少一個可以寫錯的地方。
- **預算模型:flat `node_cap` 對整樹節點結構性失效,改鎖整層總量**。`node_cap` 的語意是
  「一顆節點換掉一個零件」,而一株樹本來就是一顆葉團的四五倍 —— 拿它比只會恆紅。而它一向
  只是「整層總量 ≤ 成長額度」的**保守代理**(逐列均分、假設每列吃滿)⇒ 直接量本尊:
  `Σ (該型庫節點和 − 被取代的現值) × 該型 instance 上界 ≤ 成長額度`,被取代的現值 =
  whole 走 `measured_kind_tris`(整株,本輪新增 `measure_veg_tris --kinds` 量的)、逐件走 20 × 列數。
  **比代理更緊也更準**。`node_cap` 仍是逐件列(shrub/birch/mangrove)的閘,不退場。
- **量出來的第一件事:成長額度早就用掉 92.4%**,而 **shrub 一列吃 59.1%**(`bush_a09` 213 tris
  × 1909 instance)。NATURE_MANIFEST 只剩 silvergrass(§5k 定案留著)⇒ **這一桶倒不出更多額度,
  只能重分配**。使用者定案「闊葉保圓潤冠、從 shrub 挖」⇒ `bush_a09` 減面 213 → **140**
  (1909 叢的填充灌木單株 213 面本來就與它在畫面上的份量不成比例)。
- **⚠ 這一輪最貴的發現:§5z 五輪的量測面從頭到尾都不是遊戲裡那棵樹**。全部剪影都對 **v7 瓣化
  原型**量,而 v7 從來沒有出貨。以真實路徑(`loadPartLibs` + `buildVegMeshes`)並排才看得到:
  闊葉對 v7 是 267%(比 v7 胖)⇒ 對現況也胖 ⇒ **進步**(枝椏真的伸進冠內,現況那幾根枝是斷在
  半空的);針葉對 v7 只有 62%(比 v7 瘦)⇒ 對現況**更瘦** ⇒ 逐瓣散葉版讀成「光禿樹幹上的碎葉片」,
  **付 7.9 倍面數(155 → 1,220)換到比現況更稀疏的樹**。這是「指標與目的不同軸」第五次現形,
  也是最貴的一次。**新工具 `tools/shot_veg.mjs`** 把這個對照補成常設閘(照 `shot_beacons` 的形狀:
  同一型拍 fallback vs lib 兩張,走遊戲自己的 `buildVegMeshes`)—— `shot_giants` 從原文重建、
  不載零件庫,驗不到這條路。
- **針葉定案 = 疊層多角錐**(`--crown tiers`,使用者「凸角朝上、平整面朝下」):`prim_cone`
  單錐(底環 + 底蓋在 −Y、尖點在 +Y),**MUST 是 `FAM_PRIM_TIERS` 的預設而不是記得傳
  `--prim cone`**(忘了傳不報錯,只靜默出 `bipyr` 雙錐 —— 上下都尖,層與層互相戳進去,
  下緣那條平整陰影線沒了 = 針葉樹一眼可辨的特徵沒了;`sheet_simple` 的 `lonely` 前科同款)。
  8 層 × 10 面 = **172 面**(木質 92 / 葉冠 80),比現況 155 只多 17 ⇒ 整層消耗 98.2% → **85.9%**。
- **順帶修掉一個既有假證據**:新增 `sheet_simple._check_pass` 旗標對帳閘(格子設了但 `PASS`
  沒帶下去 = 靜默照預設跑)⇒ 咬到 `sheet_round3` 的「lonely .05」自 §5z-m 換判準後一直畫成定案;
  該格移除(判準本身沒了,重跑不出來),其餘吃預設的格子一律以 `R4 = {'touch': 1.0}` 顯式釘死。
- **驗收**:intake **237**(整層消耗 535,155 / 622,905 = 85.9%)/ siteplan 187 / beacons 68 /
  joints 21611-0 / soft_stroke 73 / gpu 54 / cel 52 / visual_prefs 124 / **e2e 全綠**(fresh :8666)/
  **`npm run bal` 全綠**(⑦f 1.78× 不動)/ 對照台 **0 缺件 0 孤兒 0 未記載**
  (`METHODS` + `simple_geom_tree`:AI 網格不出貨、只有佈局來自語料)。退掉的 6 列 per-part lib
  對應的 `vcone_a20/a16/a14/b09`、`vleaf_a27/a17` 六顆節點以 `--drop` 移除(先由對照台確認零消費端)。
- **未跑 / 待續**:①**定場圖仍未補**(§5z-j ②:遊戲內尺寸 + 賽璐璐 + 勾線;`shot_veg` 是黏土
  等級的並排,不是定場)—— 勾線對疊層錐是加分還是扣分仍沒量過;②真機冒煙(綠地場地看林相
  換臉 + 保險絲路徑不迴歸);③針葉**頂梢歸在木質**(使用者原話「尖端」與樹枝樹幹同組)⇒
  圖上是一根棕色細尖,現況那一版是綠的 —— 要不要改歸葉冠是造型決定,未動;④`--bole` 改總高
  那條(§5z-j ⑩)在整樹節點下已由 `--group` 的聯集包絡吸收,但 `vegSpan`(擺動分母)仍讀
  `parts` ⇒ 保險絲全高 8.95 vs 節點 8.50 有 5% 差(FIT 餘裕),純表現層、未處理。

### 5z-r. 第六輪:針葉葉冠改**星盤**(使用者手稿;上視內凹 + 下緣內凹 + 層間錯開疊加)

> 使用者 2026-08-08 附圖(五角/四角/三角星的俯視、一株針葉樹的側視、一條長弧)+ 七句話:
> 「上視圖中各角邊長內凹,側視圖中每層下緣內凹,不同層之間的平面旋轉角度錯開疊加,
> 越上層水平邊長越短、但頂部角越尖銳,頂部樹幹不要露出,此作法不需要樹枝;
> 每層幾角/每層角長/每層間距/每層錯開多少角度/層數/樹幹粗細/高度等參數視樹種而定」。
> 列圖 `out_simple/sheet_star.png`(vs 現行)、`sheet_star_knob.png`(反向驗證)、
> `sheet_star_cost.png`(價目表);遊戲真實路徑並排 `tools/.shots/veg/conifer2_*`。
> 使用者看圖後同日定案三條:**arc 全族取 2**(價目表那三張側視疊起來看不出差別,而 ×3 是
> +37% 面數)、**谷底逐樹種各給一個**、**直接入庫** ⇒ `cf2_wood_a` / `cf2_crown_a` 重烤出貨。
>
> ⚠ **章節編號跳過 p/q**:`§5z-p`(針葉圓弧裙)與 `§5z-q`(開源模組候補道)寫在分支
> `claude/3d-modeling-terrain-types-a1e620` 的**未 commit** 工作區裡(worktree
> `starred-image-annotation-e46a45`),本工作區看不到。本輪的對照組「現行 = 疊層圓弧裙 268 面」
> 就是那一輪的產物,而兩邊都動 `tree.glb` 與本檔 ⇒ 合併時 MUST 手動挑。**本輪已逐節點對過帳**:
> 那一支的 `tree.glb` 與本工作區改動前**只差 `cf2_wood_a`/`cf2_crown_a` 兩顆**(30 個節點逐一
> 比對三角形數,其餘完全相同)—— 而這兩顆正是本輪重烤的對象 ⇒ 星盤版是乾淨的取代,
> 圓弧裙那一輪**沒有其他東西會被吃掉**。合併時 `tree.glb` 取本輪這一份即可;runbook 兩節並存。

**七句話 → 七個幾何決策**,每一個都住自己那一個縫(`simple_tree.py`):

| 手稿 | 落在哪 | 怎麼做 |
|---|---|---|
| ①上視各角邊長內凹 | `prim_star` 的 ρ(t) | 極座標 `ρ = 1 − (1−notch)·sin(πt)/max sin`,谷底 MUST < 兩角之間**弦**的中點 `cos(π/n)` —— 那才是「內凹」的定義,大於它只是個鈍角多邊形 |
| ②側視每層下緣內凹 | `prim_star` 的 y(ρ) | 邊界高度跟著自己的半徑走 `y = −1 + hollow·(1−ρ)^cave`;**`cave < 1` 才是內凹**(y″ < 0 ⇒ 曲線恆在「角尖—裙心」那條弦之上)。**零面數成本** —— 凹是邊界頂點自己的高度給的,不是多鋪一圈環 |
| ③層間平面旋轉錯開 | `plan_star` 的 `ang` | `ang = k × twist`,twist 未給 = **半個角距 π/n**(錯開量的最大值,推導不手寫) |
| ④疊加 | `plan_star` 的 `ov` | 每層錐高 `A = ov·Δ·(1+sharp·f)`,`ov > 1` ⇒ 每層頂點高過上一層角尖 |
| ⑤越上層水平邊長越短 | `plan_star` 的 R 階梯 | **等比階梯**,兩端量出來(見下方坑①) |
| ⑥但頂部角越尖銳 | `plan_star` 的 `sharp` | 角長在收、錐高在漲 ⇒ 頂角半角 `atan(R/A)` 兩頭一起變小(實測 spruce 71.7° → 22.6°) |
| ⑦頂部樹幹不要露出 | `star_trunk_top` | 閉式解 `y* = y_a − (y_a−y_t)·margin·r_幹 /(notch·R)`,**量谷底母線不量角尖**(角尖那條最寬,拿它算會讓幹剛好從兩角之間的凹口穿出來 —— 而那正是轉個方位就看得到的那一面) |

- **「不需要樹枝」是刪掉一段而不是繞過它**:`limbs` 同時是幹高(`y_top`)與淨幹(`--bole`)的輸入
  ⇒ MUST 在生成處擋掉,留著空跑就是「一批看不見的枝在偷偷決定幹要多高」(§5z-o 的 tiers 正是
  那樣)。`--spire` 同輪對星盤關閉:最上層星盤自己的頂點就是樹尖,而且它是**葉冠、是綠的**;
  `--spire` 補的那一根歸木質 ⇒ 對星盤而言正好是使用者要消掉的「露出來的樹幹」
  (§5z-o 待續③ 記的「圖上是一根棕色細尖」由此關閉)。木質因此 **92 → 80 面**。
- **面數是算式不是量出來的**:一層 = **2·n·arc**(上錐面 + 下裙面各 `n·arc`),`arc` = 每個角之間
  取幾個樣本(1 = 不內凹 / 2 = 折線內凹 / 3+ = 曲線內凹)。**`arc=1 且 hollow=0` ⇒ 與 `prim_cone`
  同一顆多角錐**(體積逐位元相同,只有底蓋走扇形多 2 面)= 這一輪整組可反向驗證的錨。
- **逐句稽核 `check_star.py`**(四樹種 × 10 條 = 40 項,全綠):①②走單位體閉式、③④⑤⑥ 走**匯出
  的那顆**(以面的連通分量拆回逐層,不是重跑一次 `plan_star` —— 重跑就是拿實作驗自己)、
  ⑦ 是**射線可見性實測**(幹頂 6 點 × 144 方位全被葉冠擋下)、⑧ 木質面數 = 幹段數 × 柱面數。
  反向驗證 `--break-notch` / `--break-cave` / `--break-cover` **各只咬紅該咬的那一條**
  (`--break-cover` 把餘裕 1.25 → 0.15 ⇒ 6 個幹頂點 144 方位**全部**看得到)。
  `--break-cover` MUST 走**旗標**(`--star-cover`)傳進子行程:樹是另一個行程建的,
  在稽核端 monkeypatch 只改到本行程那一份 ⇒ 反向驗證恆綠 = 假綠。

**⚠ 坑① 逐層照抄語料的 `r_out` ⇒ 整冠塌成一根牙籤,而面數/契約/watertight 全綠。**
第一版照 `tiers` 的作法逐層取該層最遠外緣、再要求單調遞減。但語料的**最下層**是貼著幹的那幾叢
(南洋杉實測 raw R:**0.057** / 0.350 / 0.352 / **0.393** / 0.305 / 0.336 / 0.140 / 0.125 ——
最寬的是第 3 層不是第 0 層)⇒ 由下往上夾等於整冠被 0.057 封頂,輪廓保留從 tiers 的 112% 掉到
**10.2%**。⇒ 角長改成**等比階梯**:底層 = 整冠量到的最遠外緣、公比 `q` = (最上層外緣 ÷ 底層)
^(1/(L−1)) 再夾進 [tipf^(1/(L−1)), taper]。兩端都是量出來的、只有「中間怎麼排」是規則,而且
`R_k ≤` 語料最遠外緣 ⇒ **冠幅不會憑空長大**(`giantCrownR` 與碰撞柱的基準不動)。層間距同理是
**解**出來的:要求最上層的頂點恰好落在冠頂 ⇒ `Δ = S / (L−1 + ov(1+sharp))`,樹不會比語料高一截。

**⚠ 坑② `notch` 的實際深度會隨 `arc` 漂**:直接吃 `sin(πt)`,arc 2 取得到 sin(π/2)=1
(谷底真的是 notch),arc 3 只取到 sin(π/3)=0.866 ⇒ `notch=.5` 實測是 **0.567**。同一個旗標、
同一個數字,換個 arc 就是另一個形狀而且不報錯 —— 與 §5z-n 的 R4「對照組的定義只准有一份」同族。
⇒ 除以 `max(w)` 正規化;arc ≤ 2 之下是恆等,不動既有形狀。

**⚠ 第六次「指標與目的不同軸」——這次輪廓錯得最明顯**:星盤 **58~64%** 對上現行圓弧裙
**112~123%**,照數字讀是大退步。而**俯視那一格直接把話講完**:現行版從上面看是一個
**乾淨的六邊形**(一疊圓弧裙 = 同軸旋轉體,轉幾層都還是一個多邊形),星盤是一顆放射狀的星。
側視也一樣:現行版讀成「一疊燈罩 / 一座寶塔」,星盤是一眼可辨的針葉樹。`silhouette_keep` 量的是
**對 v7 那團 11k 面原型的面積覆蓋**,而星盤的內凹與兜起的裙**就是在把面積挖掉** ——
它扣的正是這一輪要加的東西。⇒ 判準仍是圖,輪廓只當「有沒有整個塌掉」的哨兵(坑① 就是它抓到的)。

**價目表(`sheet_star_cost.png`;現行 268 面)**

| 檔位 | 面數 | 對現行 | 圖上 |
|---|---|---|---|
| 5 角 × arc 2 | 240 | −10% | 角少、每層五瓣 |
| **6 角 × arc 2** | **272** | **+1%** | **與 ×3/×4 幾乎看不出差別** |
| 6 角 × arc 3 | 368 | +37% | 谷底變成一段平的,側視同上 |
| 6 角 × arc 4 | 464 | +73% | 谷底變成弧線,側視同上 |

⇒ **`arc` 這顆旋鈕在這個尺度上幾乎不影響畫面**(側視三張疊起來看不出差別、俯視也只有谷底那一小段
不同)⇒ **建議取 arc 2**:同樣一棵樹,+37% 的面數換不到看得見的東西。真正管俯視長相的是
`notch`(.35 = 細長尖角 / .70 = 寬角),那是**造型決定,留給使用者**。

**預算**(本工作區基準:整層消耗 535,155 / 622,905 = **85.9%**,conifer2 現值 172 tris;
`(節點和 − 155) × 73`):

| 冠形 | 木質 | 葉冠 | 合計 | 整層消耗 |
|---|---|---|---|---|
| §5z-o 疊層多角錐(本輪之前) | 92 | 80 | 172 | 85.9% |
| §5z-p 疊層圓弧裙(另一分支,未 commit) | 92 | 176 | 268 | 87.0% |
| **星盤 6角×2 = 出貨** | **80** | **192** | **272** | **87.1%**(實測 542,455 / 622,905)|
| 星盤 6角×3 | 80 | 288 | 368 | 88.2% |
| 星盤 6角×4 | 80 | 384 | 464 | 89.3% |

**入庫(同輪,使用者定案「直接入庫」)**

- **消費端只改一個數**:`VEG_DEFS.conifer2.whole` 葉冠那一列的包絡 `cyl(1.92,1.92,**7.41**)` →
  `cyl(1.92,1.92,**8.52**)`。理由是這一輪的形狀本身:星盤把「尖端」還給了葉冠 —— 最上層星盤
  自己的頂點就是樹尖(而且是**綠的**),舊制那根**木質**頂梢同輪退場 ⇒ **葉冠節點的頂 = 整株的頂**
  (節點縱向 [−2.13, **+4.25**],舊包絡只到 ±3.71)。沿用舊值的話 intake 會紅在「葉冠比包絡高」,
  而那正是這一輪要的形狀。木質那一列反而縮到樹尖之下(縱向 [−4.25, +3.39]),包絡不動。
  `y = 4.251`(= 聯集半跨)與 `--group CF2=1.98x4.475` 皆**不變** ⇒ 世界尺度逐位元同上一輪。
- **非等向擬合是既有性質、不是這一輪引入的**:原型的聯集長寬比 r/hy = 0.678,遊戲那個框是
  0.4425 ⇒ 縱向被拉伸 1.53×,樹比黏土列圖上更修長。八條斷言**全部在逐軸仿射下保持**
  (內凹、兜裙、遞減、越尖、幹頂覆蓋都是同軸比較)⇒ 稽核結論不受擬合影響;真正的判準是
  `shot_veg` 那兩張:**保險絲版是一疊蒼白的團塊,星盤版是一棵一眼可辨的雲杉**。
- **驗收**:intake **237**(整層 **87.1%**)/ siteplan 187 / beacons 68 / joints 11908-**0** /
  soft_stroke 73 / gpu 54 / cel 52 / visual_prefs 124 / open_tunnel 163 / underpass 161 /
  road_joint 86 / **e2e 全綠**(fresh :8666)/ **`npm run bal` 全綠**(⑦f 1.78× 不動)/
  對照台 **0 缺件 0 孤兒 0 未記載**。

- **逐樹種參數表 `STAR_SPECIES`**(手稿最後一句):鍵名對得上 `VEG_DEFS` 的四列針葉
  (fir=conifer / spruce=conifer2 / cypress=conifer3 / cedar=conifer4),讓「哪一列吃哪一組」
  不必再翻譯一次。**分工 MUST 講清楚**:層數 / 每層間距 / 角長 / 幹粗 / 高度仍由**語料**給
  (§5z-b 的佈局共用縫),而每層幾角 / 內凹深度 / 下緣凹度 / 裙深 / 尖銳度 / 錯開角度 / 逐層收分
  是**造型**(浮雕板量不出「角」這種東西)⇒ 住那張表。
- **未跑 / 待續**:①~~檔位與 `notch`~~ **已定案**(arc 2 全族 / 角數與谷底逐樹種 / 直接入庫,
  使用者 2026-08-08)—— 但**只有 `conifer2` 有庫節點**,fir/cedar/cypress 三列仍走 `parts`
  保險絲,那三組參數等於還沒上過畫面;②~~定場圖仍未補~~ **已跑完(§5z-t)**:卡了四輪的原因是**兩支工具各缺一半**
  (`shot_scene` 有管線不載庫 / `shot_veg` 載庫沒管線),補齊後量到**星盤吃到的墨比周圍舊樹還少**
  (2.61% vs 2.83%)⇒ 勾線對這個冠形**中性偏加分**;③`--star-taper` 與
  `--star-tipf` 在這張語料上**都沒有作用**(語料自己的 q = 0.849 已經比兩個夾制都嚴)⇒ 兩顆旋鈕
  等於沒驗過,換樹種語料才知道;④**闊葉不吃星盤**(手稿講的是針葉),`--crown star` 對 broadleaf
  沒有擋、但也沒有意義;⑤入庫時 `--bole` 改總高那條(§5z-j ⑩)與 `vegSpan` 的 5% 差
  (§5z-o 待續④)一併要重算;⑥層數仍吃語料(`--star-layers` 已備但只跑過預設)。

### 5z-s. 星盤第二輪 + 闊葉樹頂包覆(同日;尖銳度改由**輪廓凹面**給,所有參數加誤差)

> 使用者 2026-08-08 兩句:①「**上層的頂角不要那麼高,每層高度相近,用凹面的方法增加尖銳度,
> 旋轉角度/角長/層高等所有參數都適度加入誤差**」;②「**闊葉林的樹頂,使用闊葉樹冠包覆
> (跟其他葉冠相似的形狀)**」。兩件都已出貨(`cf2_*` / `bl_*` 四顆節點重烤)。

**①-a 尖銳度的來源換人**:舊制靠 `sharp` 逐層放大錐高(spruce 1.3 ⇒ 最上層比最下層高 2.3 倍)
—— 那正是使用者說的「頂角太高」。改成 **`--star-curve`(側輪廓凹度)**:
`R_k = R_top + (R₀ − R_top)·(1 − u^curve)`,u = k/(L−1)。斜率 `−(R₀−R_top)·curve·u^(curve−1)`
在 u 小時平緩、u 大時陡 ⇒ **下半近乎等寬、上半急速收尖** = 手稿中間那條長弧。
`sharp` 一律降到 0.10~0.20(層高全距 1.10~1.20 = 「相近」)。
**⑥「頂部角越尖銳」不需要放寬**:半角 = atan(R/A),A 幾乎不變而 R 遞減就足夠 —— 反而更尖
(spruce 名目 68.2° → 34.6°)。**舊制的等比階梯 `q^k` 是凸的**(先降快後降慢),與這一條相反。

**①-b 誤差是三組零均值抖動**(`petal_jitter` 同一支,MUST NOT 另起亂數序列):角長 / 層高 /
錯開角。**唯一仍夾制的是層高** —— 它綁著「疊加」(A > Δ),破了就是層間露出樹幹(看得見);
夾制是解出來的 `(ov−1)/ov / 2`。

**⚠ 這一輪最有價值的發現:凹面與「適度誤差」在同一個序列上互斥,必須選邊。**
curve > 1 的定義就是「下半近乎等寬」⇒ 底部相鄰兩層的角長只差 **2.3%**(spruce 實測),
而使用者要的誤差是 10% ⇒ **任何看得見的誤差都會讓底部某兩層互換名次**,稽核 ⑤⑥ 當場紅字
(實測 半角 66.6° → 68.6° 反向)。兩條路:把誤差夾到 1% 以下(那句話等於沒做),或把定律
搬到誤差之前。**選後者**,並把稽核重切成四段:
- ⑤⑥ 驗**名目階梯**(`--star-jit 0` 跑一次)—— 定律沒有鬆掉,只是搬到誤差之前的那一層;
- ⑨ 驗**誤差本身**:零均值(實測 ±0.0000)、逐層有界(≤ 該項夾制)、且**三項都真的有誤差**
  (光驗「有界」的話,誤差寫死成 0 也會全綠);
- ⑩ 驗**趨勢**:最寬在最底、最窄在最頂,且**跨 lag 層恆遞減** —— `lag` **推導不手寫**
  = 最小的 j 使名目跨 j 層的落差 > 2×誤差幅(spruce 誤差 0.10 ⇒ lag = 4)。
- ⑥-b/⑥-c 把使用者那兩句話變成可驗的形式:層高全距 **= 1 + sharp**(恆等)且 ≤ 1.25;
  **尖銳度主要來自輪廓** —— 半角取對數後 R 與 A 的貢獻可加,要求 R 那一份 ≥ 3 × A
  (spruce 1.15 vs 0.10)。只驗「有沒有變尖」的話,把 `sharp` 調回 1.3 也會過。

**②闊葉樹頂包覆:三次才對,前兩次都「全綠但沒作用」**
- 第一版:尺寸取現有葉冠的**中位數**、蓋在木質最高點 ⇒ 144 方位看得到 **45 → 45**,
  與沒有這一顆**一模一樣**。兩個成因疊在一起:㋐`rad` 是圓柱座標 (徑向, 垂直, 切向),
  而離軸的旁瓣**徑向是薄的那一軸**(實測中位數 0.039 / 0.137 / 0.069)⇒ 照抄三軸會在軸心
  生出一片**立起來的薄片**;㋑「木質最高點」在密冠橡樹上是一根**離軸 0.19 的枝梢**,
  軸心的葉團再大也蓋不到它。
- 第二版:兩個水平軸都取切向、目標改成**幹頂** ⇒ 幹頂那一個點蓋住了(0/144),
  但**截圖與改動前一模一樣** —— 真正露出來的是**分岔點到幹頂那一整段**:旁瓣一律擺在
  `r_mid > 0` 上(語料量到的是離軸的葉團)⇒ **軸心是空的**,幹就從那個洞直直戳出去。
- 定案:尺寸由「要蓋住什麼」**解**出來 —— 縱向 = 分岔到幹頂的一半、水平 = 最內圈葉團的
  **內緣**(中位數 `r_mid − 徑向半徑`),兩者再 **÷ ico 內切半徑**(`ico_inradius()`,
  推導不手寫;不除的話上段 20% 會從面上戳出來,實測仍有 24/144 而截圖只差幾根細線)。
  ⇒ **233 → 0**。「跟其他葉冠相似的形狀」因此讀成**同一顆基本體**(ico、同 key、同季節色),
  MUST NOT 讀成「同一個尺寸」—— 同尺寸那一版證明過補不起來。**成本 +20 面**(一顆 ico)。
- 稽核 ⑪ 五條含**內建反向對照**(`--no-cap` MUST 看得見);判準是**沿幹身取樣的射線可見性**,
  不是單一個點 —— 單點版正是第二版「全綠但沒作用」的成因。

**驗收**:check_star **78 條**(四樹種 × 14 + 闊葉 6)全綠 + `--break-notch/-cave/-cover`
各只咬紅一條;intake **237**(整層 **87.8%**:conifer2 272 / broadleaf 1,276)/ siteplan 187 /
beacons 68 / joints 11908-0 / soft 73 / gpu 54 / cel 52 / visual 124 / **e2e 全綠** /
**`npm run bal` 全綠** / 對照台 0-0-0。
**輪廓這次與目的同向**(前一輪是反的):spruce 58/63% → **76/87%**、fir 59/66% → 74/88%、
cypress 64/78% → 85/105% —— 凹面在收尖的同時把下半段補胖了,兩件事一起發生。

### 5z-t. 定場圖那一項終於跑得動了 —— 卡了四輪的原因是**兩支工具各缺一半**

> §5y-h ①、§5z-j ②、§5z-o 待續①、§5z-r 待續② —— 同一項(「遊戲內尺寸 + 賽璐璐 + 勾線的
> 定場圖」)連著四輪掛在「未跑」上。這一輪先問「為什麼跑不動」,答案不是沒時間:

| 工具 | 有賽璐璐 + 勾線管線 | 載零件庫 |
|---|---|---|
| `shot_scene.mjs`(定場鏡頭組) | ✅ | **❌ 從來沒載過** |
| `shot_veg.mjs`(§5z-o 新建) | **❌ 黏土** | ✅ |

⇒ 一支畫的是**保險絲那棵樹**(而檔案裡早就換成庫節點了)、另一支畫的是**沒有管線的黏土**。
兩邊都出得了圖、都不報錯 —— 這一項因此**沒有任何一支工具跑得完**。同 §5z-o 對 `shot_giants`
記的那一條(「從原文重建、不載零件庫,驗不到這條路」),只是這次卡住的是一整個驗收項目。

**補上的三件事**(本輪儲存庫改動只有這兩支工具 + 本節,**遊戲檔一格未動**):
1. **`shot_scene` 載零件庫**(`--lib=0` 保留舊行為當「前」),並把**載到幾顆**印進 log 與 meta
   —— 載入失敗時消費端逐位元退回保險絲,那與「根本沒載」畫出來的圖一模一樣,沒有讀數就分不出。
   實測 blackforest:`libN 6`、地物 mesh **1577 → 1563**(整樹節點取代多列零件)。
2. **`shot_veg` 接上 `postfx.Pipeline`**(`--post=0` 保留黏土輸出)。但**它答不了勾線那一題**,
   而且答不了的理由是結構性的:勾線 pass 的第一行對「背景是遠平面」的像素早退,而 `shot_veg`
   的背景就是清除色 ⇒ **一棵孤零零站在空背景前的樹畫不出線**(`--ink` 開關的 PNG 逐位元相同)。
   ⇒ 勾線只能在**有地形、有鄰木**的場景裡量。
3. **`shot_scene` 補一個 `veg_near` 機位**:既有機位最近的樹也在 60~100m 外,一棵樹十幾個像素高。
   位置**照樣是推導的** —— 取離兵線中段最近的那株「高 ≥ 4m 的植被 instance」,取景比例與
   `shot_veg` 同一組(距離 2.2×樹高 / 眼高 0.55×)。認樹用**幾何包圍盒的高**,不比對列名
   (名字會改,高度不會)。

**⚠ 順手咬到一個一直都壞著的旗標**:`shot_scene` 的圖層隔離 `--ink=0` / `--grade=0` / `--fxaa=0`
**從來沒有生效過**。`flag()` 回的是 `0`/`1`,而 `Pipeline` 的判定是 `opts.ink !== false` ——
**`0 !== false` 為真** ⇒ 三個旗標全是 no-op。而 `--post=0` 看起來正常,只因為它在本檔內另被當
truthy 用(`layers.post ? new Pipeline(…) : null`)—— **同一個旗標兩套解讀,壞掉的那半沒人發現**。
這一支的賣點正是「這張圖變醜是哪一層造成的」,而那個能力**一直是不存在的**。
改回布林之後 `--ink=0` 才真的產生不同的 PNG(569,817 → 557,936 bytes)。

**⚠ 第二個:機位是推導的 ⇒ `--lib` 的前後兩張站在不同的地方拍不同的樹**(blackforest 實測
`veg_near` 的 z 從 185 跑到 239 —— 因為換掉的正是拿來推導機位的那些幾何)。這一支的賣點
「改動前後各拍一次」對 `--lib` 直接不成立 ⇒ 新增 **`--stations <meta.json>` 回放**
(座標仍來自某一輪的推導,只是把「哪一輪」講清楚;meta 本來就已經把機位寫進去了)。

**勾線的答案:中性偏加分,不是扣分。** 同一機位、同一場景,量「開勾線 vs 關勾線」改變的像素:

| 區域 | 有墨像素 | 平均落墨 |
|---|---|---|
| 全幀 | 2.26% | 20.4 |
| **近景星盤針葉樹** | **2.61%** | 19.9 |
| 遠景林帶(全是保險絲幾何) | 2.83% | 18.0 |
| 地面 | 0.29% | — |

⇒ 星盤那棵樹吃到的墨**比周圍那些舊樹還少**(2.61% vs 2.83%)。§5z-j ② 擔心的「平面大、線條稀」
與「硬邊多 ⇒ 一團黑線」**兩個都沒有發生**:層與層之間的深度落差被勾線讀成乾淨的層緣,
而同一層內部的共面三角形不生線。**同機位的 lib vs 保險絲對照**(`_zoom_ink.png` / `_zoom_fuse.png`)
是這一整輪最有力的一張:舊的 conifer2 是一疊歪斜團塊頂著一根**棕色細尖**,星盤是一棵一眼可辨的雲杉。

**未跑**:①這一項只在 **blackforest** 量過(綠地);裸露地 / 市區場地的勾線密度不同,
但那與冠形無關;②`veg_near` 挑的是「離兵線中段最近的那株高 ≥ 4m 的植被」—— blackforest 挑到的
恰好是 conifer2,別的場地可能挑到別型(那不是壞掉,只是那一張圖驗的是別的東西,meta 有機位可查)。

### 5z-j. 未跑 / 待決

①**兩族的檔位是建議不是定案**(針葉 `mid` 1,138 / 闊葉 `major .3`+`sparse` 1,276)——
額度怎麼分仍是名冊那一輪的事;②~~定場圖仍未補~~ **已跑完(§5z-t,2026-08-08)**:遊戲內尺寸 + 賽璐璐 + 勾線的定場圖
終於跑得動(先修好兩支工具各缺一半的問題),而「加分還是扣分」的答案是**中性偏加分** ——
星盤針葉樹吃到的墨比周圍的舊樹還少(2.61% vs 2.83%),兩個擔心的失敗型態都沒有發生;③**入庫縫未動**:
~~簡單幾何版是逐株程序生成的**純資料件**…要不要這樣做是使用者的決定~~ **已定案:走零件庫
(使用者 2026-08-08),見 §5z-o** —— 一株 = 木質 + 葉冠**兩顆節點**(一列一份材質,併成一顆
會同時吃掉季節色與 A39 軟性),兩顆由 `normalize_parts --group` 共用同一個變換;
④`--major` 只在兩張闊葉語料上掃過(同 §5y-b 的未跑①);⑤三個新旋鈕
(`--sections` / `--trunk-knots` / `--limb-sections`)只掃過 sections,另兩個沒有;
⑥**還沒動過的槓桿仍是「基本體組合」**(一叢兩三顆拼)—— 對簡單幾何版尤其自然;
⑦第二輪的兩顆次級旋鈕(`--fork-jit` / `--branch-jit`)在**闊葉 sparse 上量不到**,要在
同一叢複製多瓣的檔位(針葉 full / lush)重判;⑧`--merge-vol .5` 與 `--branch-deg` 的
逐株分佈(0~30° 怎麼抽)都只在這三張語料上看過,**逐株抽法要等入庫縫那一輪才定**
(遊戲端是逐株位置雜湊,不是這裡的單一參數);⑨~~`--touch` 該定 1.0 還是 1.15~~ **已定案
= 1.15(使用者 2026-08-08),見 §5z-n**:兩族同面數 ⇒ 預算逐位元不動,代價為零;
⑩淨幹 `--bole .25` 只驗過三張語料,
而它會**改變樹的總高**(延伸 16~30%H)⇒ 入庫時 `giantCrownR` 與 instance 的縮放基準要一起重算;
⑪**針葉冠形自 §5z-r 起改走星盤**(使用者手稿),①~⑩ 裡凡是講「針葉葉冠長什麼樣」的
(疊層多角錐 / 圓弧裙 / 逐瓣散葉)一律以 §5z-r 為準 —— 那幾條的**佈局**部分(分層、淨幹、
語料量測)仍然有效,只有葉冠那一顆基本體換掉了。

## 5aa. Trial log (2026-08-08, 3060-machine session — 佇列 F 第一段:整棟量體的**預算 + 消費端縫**;零節點出貨)

> 使用者定案:「**ai3d_runbook.md 接著處理建築的部分**」→ 追問後選「**執行佇列 F**」,
> 明知這**推翻 `docs/ai3d_runbook.md` §0.3 的 `BUILDERS` 那一列**(同日稍早定的
> 「只做景觀樹木與石頭」)。plan §8.1 已同步標注這條覆寫。

### 5aa-a. 佇列 F 步驟 2 的「`biomes.js` 的 `BUILDERS`」是**筆誤**

`BUILDERS` 住 **`hazards.js`**(障礙物:神木/倒木/防空陣地/中繼站…),與城市建物無關。
真正的消費端是 `biomes.js` 一般建物繪製段的那個 `InstancedMesh`:
**單位 `BoxGeometry` + 6 材質群組(`[wall,wall,roof,roof,wall,wall]`,BoxGeometry 群組序
+x,−x,+y,−y,+z,−z)+ 逐實例 `scale = (w,h,d)` + 逐實例 tint**,逐立面款各一個(16 個 draw call)。
這一條差別不是名字問題:那 6 個材質群組決定了「整棟節點能不能保住立面窗格與夜間自發光」,
而 `hazards.js BUILDERS` 是逐件 primitive 的**另一種**消費端形狀。佇列 F 的原文已更正。

### 5aa-b. 先量再開 —— 而量測直接否決了「整桶換」

`measure_building_tris.mjs` 加了兩件事:①**印出 `stats.buildings`**(`--live` 只是「有沒有讓它
連出去」,Overpass 掛掉會靜默退回程序生成街區,而那一輪的 instance 數會低一個量級 = 上限
看起來很寬鬆,沒有任何錯誤訊息);②**逐實例矩陣拆解**做尺寸普查(整棟節點的 instance 上界
不是「這張圖有幾棟樓」而是「這條選取規則挑中幾棟」)。四場 `--live` 實測:

| 場地 | 建物 | 全場 tris | 建物桶合計 | 主量體 instance | >40m | >55m | >100m | 最高 |
|---|---|---|---|---|---|---|---|---|
| shibuya | 558 | 1,062,292 | 38,316 | 671 | 59 | 21 | 2 | 132m |
| manhattan | 479 | 1,183,325 | 37,108 | 590 | 100 | 55 | 9 | 132m |
| seoul | 887 | 1,225,097 | 53,644 | 1,035 | 82 | 39 | 0 | 69m |
| **taipei101** | **1,114** | 1,205,428 | **59,736** | **1,325** | **157** | **71** | 0 | 69m |

⇒ 主量體桶總量上界 **15,900 tris**(1,325 × 12)。成長額度 = 3 × 15,900 = 47,700 ⇒
**整桶換的逐節點上限只有 36 tris**(比現行的單位方盒 12 只多兩打三角形),而 §5o 已實測
**500 面就留不住 Art Deco 的退縮量體**。**「只換一個子集」因此是量出來的結論,不是偏好** ——
這正是佇列 F 步驟 1「預算與縫 MUST 同一輪定案」要防的那件事:先開 400~900 的縫再來想辦法,
生出來的每一棟還是同一團方塊。

子集大小 `pick_n` 由兩條約束反推、取較嚴者:①**畫面細節下限** cap ≥ 2 × §5o 的 500 面失敗點
⇒ N ≤ 47;②**draw call** —— 整棟節點的幾何與方盒不同 ⇒ 挑中的棟數就是額外 InstancedMesh 的
上限,而立面段現行 16 個並自述「仍是常數級」⇒ 再加同一個量級為止 ⇒ N ≤ 16。②較嚴 ⇒
`pick_n = 16`、`node_cap = 47,700 ÷ 16 = **2,981**`(最壞 16 × 2,981 = 47,696 = 最重場景的 4.0%)。
高度門檻 `min_h = 55` **沿用 biomes 既有的退縮頂塔門檻**(MUST NOT 另發明數字);四場合格
棟數 21/55/39/71 全 > 16 ⇒ 密市區恆由 `pick_n` 夾住,郊區自然少於 16 棟。

### 5aa-c. 縫的形狀(三條契約 + 一條新的材質契約)

`BLD_LIB` 收第四桶 `mass`,值的第一格**可以是陣列**(輪替名冊,同 `MEGA_LIB.block`;一款
打天下 = 同一條天際線十幾棟同剪影,就是零件庫紀律「烤整棟樓會把逐實例變化丟掉」的同一個病),
輪替除數由名冊長度推導。`bldGeo(key, i)` 是**唯一**解析縫(`libGeo(` 全檔仍恰 3 處);
`buildBldBucket.mass(n, mat, i)` 是唯一桶建構點。

- ①**碰撞/LOS 一格不動**(A30):有向盒仍是 `b.w/2`、`b.d/2`、`b.ry`,那幾行沒被碰過。
- ②**保險絲**:名冊空著或庫沒載到 ⇒ `massOk` 空 ⇒ 一棟都不挑 ⇒ 主量體全數落回單位方盒。
- ③**佈局數學只讀權威資料**:挑選只讀 `b.commercial/h/x/z`,**零 `rnd()` 消耗**(§2.3 / A4);
  等高時以 `x`/`z` 定序(不能靠 sort 的實作穩定性決定跨客戶端誰入選)。
- ④**材質**(這一輪新加的):庫節點是單一群組 ⇒ three 取材質陣列第 0 格,故傳**該立面款
  現做的 `wall` 材質**(窗格貼圖 + 夜間自發光 + 逐實例 tint 全部保住);自己 new 一份就是
  第二套立面材質,症狀是「那幾棟高樓晚上不亮」。代價 = 頂面也吃立面貼圖(換到的是最高的
  十幾棟,俯視看到頂面的機會遠低於「晚上不亮」)。⇒ **節點契約多一條:匯出端 MUST 給
  盒投影 UV**(沿用原 BoxGeometry 的 0..1 逐面慣例),否則整棟只採到 (0,0) 那一個 texel
  = 一塊沒有窗的純色板。這一刀**尚未實作**(見待續)。

另一個看不見的坑:逐實例色抖的雜湊原本吃 `inst` 的**陣列索引**,而拆桶會把索引整排往前移
⇒ 其餘每一棟的色相都跟著平移(沒有錯誤訊息,只表現成「這張圖的街廓配色跟上次不一樣」)。
改吃 `t.ord`(拆桶前的原始序);名冊空著時 `ord === i` ⇒ 逐位元同舊制。

### 5aa-c2. 那條路真的被走過一次(零節點出貨 ≠ 沒驗過)

縫開好而名冊空著時,新程式碼**一行都不會被執行** —— 「A/B 逐位元相同」只證明了它是 no-op。
故做了一次**暫時性**的實測(改完即還原,不入版控):把 `mass` 那一列指到既有的
`building/ac_a`,並讓量測探針先 `loadPartLibs()`,對同一份錄播圖資跑 shibuya。

- 主量體桶(6 材質群組)instance **671 → 658**,少掉的 **13** 棟落進**單材質且帶貼圖**的
  新 mesh:instance 分佈 5 + 4 + 2 + 1 + 1 = 13,分散在 **5 個立面款** ⇒ **額外 draw call 5 個**
  (`pick_n = 16` 是上界,實得遠低於它)。
- 那五個 mesh 的材質 `.map` 非空 ⇒ **立面貼圖(窗格 + 夜間自發光)真的接上了**,
  這正是 §5aa-c ④ 要保住的東西。
- 13 而不是 16:shibuya 的合格**建物**(commercial ∧ h > 55m)本來就只有 13 棟
  —— 普查表那欄 21 數的是**實例**(含 ≥8m 寬的裙樓/頂塔)。`pick_n` 是上限不是配額。

同一輪順帶量到一個**與這次改動無關但值得記**的數:載入零件庫之後 shibuya 全場三角形
1,062,292 → **1,282,707**(+20.8%)—— 那是 rock/tree/building 既有節點的真實成本,
而所有預算量測都是在**沒有載入零件庫**的基準上做的(這是對的:額度要從「還沒換」的現值算)。

`--boxuv` 也單獨驗過一次(拿既有 GLB 當來源 round-trip):輸出的 `TEXCOORD_0` 存在、
u ∈ [0.067, 0.929]、v ∈ [0.125, 0.902] —— 逐面 0..1 的盒投影成立。

### 5aa-d. 逐位元不變**用量的**,不是用讀的

新旗標 `measure_building_tris.mjs --osm-cache`:把 Overpass 回應錄下來重播。**不是為了快** ——
同一支指令、同一張圖(shibuya)、相隔五分鐘的兩次 `--live`,建物 558 ↔ 842 棟、
主量體 671 ↔ 982 個、煙囪 144 ↔ 249 座(±70%)⇒ 改動前後各抓各的圖資,量到的差異全是圖資的。
錄好之後跑 A/B(`git show HEAD:public/js/biomes.js` 覆蓋 → 量 → 還原):
全場三角形、mesh 數、**每一個桶的 instance 與 tris、671 筆逐實例尺寸普查**——
`JSON.stringify` 逐位元相同。

### 5aa-e. ⚠ 順手量到的欠帳:deco 那三桶的上限是拿**低估的樣本**推的

同一批四場資料重推屋頂配件桶:instance 上界 chimney 212 → **269**、tank 97 → **160**、
acbox 117 → **209**(全部在 taipei101 —— 2026-08-06 那一輪根本沒取到這張圖),
桶總量上界 50,936 → **59,736** ⇒ 逐桶上限 chimney 240 → **222**、acbox 435 → **285**,
而**已出貨的 `chimney_a` 是 234、`ac_a` 是 426 ⇒ 兩顆都會超標**。

本輪**刻意不動 deco 閘門**:使用者這一輪要的是整棟量體的縫,回頭重切兩顆已出貨資產不在
範圍內,而且 `chimney_a` 當初就是 938 → 234(3.9:1)減出來的、已經在 §5e「溫和減面無害」的
上緣,再減一刀 MUST 配黏土人眼複核。**這是欠帳**,已寫進 `tri_budget.json` 的
`families.building.resample_2026_08_08`(含 `finding` / `variance_warning` / `contamination_note`),
下一輪建築批 MUST 一併處理:二選一 —— 重減面到新上限,或改用比「跨場地取最大」更穩的上界規則
(那個統計量本身就會隨取樣次數單調往上爬,而上限跟著往下掉)。
另外記一筆:`cornices` 桶的指紋是「BoxGeometry + 材質色 ffffff」,四場都量到比主量體還多的
instance ⇒ 白色單位方盒的 InstancedMesh 不只簷口帶一種,那一桶是**高估**的(只進分子、
不進任何除數 ⇒ 不影響本輪 mass 的推導,但修 deco 閘門時 MUST 先把指紋收窄)。

### 5aa-f. 驗收

`intake_parts` 237 / `audit_siteplan` **194**(+7,`--break-mass` 反向驗證**恰 3 條紅**:
pick_n 與預算分家 / 拿掉保險絲閘 / 色抖吃拆桶後的新索引)/ `audit_object_joints --seeds 8`
21611-0 / `audit_beacons` 68 ± 反向紅 / `gpu` 54 / `soft_stroke` 73 / `cel` 52 / `visual_prefs` 124 /
`npm test` 全綠(fresh server :8666)/ `npm run bal` **全綠且逐項不動**(⑦f 1.78×、
⑦c 66.0/77.6/52.1 與上一輪逐字相同)/ 3D 零件對照台 0 缺件 / 0 孤兒 / 0 未記載。

`audit_traverse`(㋓)也跑了:**96 通過 / 19 紅**,而那 19 條是**既有基準**(記錄在案的
「泛洪鍵漏 sid / 缺鏈接與邊界裁切 / 淨空撞 deckAt 夾制 / civicblvd 舊快取」那一批,
全部是稽核端而不是遊戲破圖),與本輪無關 —— 本輪的縫在 A/B 上逐位元相同,
街廓通道寬不可能變。**節點入庫那一輪仍 MUST 再跑一次**(那時它才真的會動到量體外廓)。

### 5aa-g. 未做(下一支分支接手的就是這幾條)

1. **零節點出貨** —— 縫開好了、預算定了,但 `BLD_LIB.mass` 那一列仍是註解(同 `tank` 的處理)。
   佇列 F 步驟 4(入庫閘)與 `provenance.mjs METHODS` 的 `trellis2_spz` 都還沒被走到。
2. ~~**盒投影 UV 那一刀沒實作**~~ **已實作(本輪)**:`normalize_parts.py --boxuv <node>` ——
   剝掉來源 UV 之後依主導法線分軸重建(±X → (gz,gy)、±Y(頂/底)→ (gx,gz)、±Z → (gx,gy)),
   各面映到 0..1;`export_texcoords=True` 顯式打開(`export_materials='NONE'` 很容易讓人以為
   UV 也不用留)。round-trip 驗過(§5aa-c2)。**還沒被真的 T2 產出走過一次。**
3. **T2 生成本身沒跑** —— 語料是 §5i 那 55 張建築照(photo DB 家見環境矩陣);
   餵 T2 的 matte **MUST 先二值化 alpha**(>16 → 255,§5n),減面走 §5t 已定案的
   `solidify_parts.py`(先實體化再減面)。目標面數這一輪很寬鬆(≤ 2,981),
   §5o 那條「500 面留不住識別特徵」的限制在這個級距上不成立。
4. **真機冒煙未跑** —— 縫是 no-op 所以不急,但節點入庫那一輪 MUST 跑:
   蓋到的是**最高的十幾棟**,要看的兩件事是「夜間立面有沒有亮」與「頂塔/裙樓有沒有跟整棟
   節點自己的頂部造型疊成兩頂帽子」(本輪已讓 `lib` 只掛主量體那一列,但那是設計不是實測)。
5. ~~**`audit_traverse`(㋓)**~~ 本輪**跑了**(96/19,19 = 既有基準紅字,見 §5aa-f);
   節點入庫那一輪 MUST 再跑一次 —— 那時整棟量體的外廓才真的會變。

## 5ab. Trial log (2026-08-08 深夜, 3060-machine session — 佇列 F 第二段:deco 欠帳清掉 + **首顆整棟量體節點 `building/mass_a` 入庫**)

> 使用者對 §5aa 收尾的兩個問題各回一個字:**「減面」**(採用重取樣、把兩顆已出貨節點減到位)
> +**「開」**(生成並入庫第一顆整棟量體節點)。兩件都做完了。

### 5ab-a. deco 欠帳:採用四場取樣,兩顆節點同輪減到位

`node_caps` chimney 240 → **222** / tank 525 → **373** / acbox 435 → **285**(分子 50,936 → 59,736、
instance 上界 212/97/117 → 269/160/209,全部來自 taipei101 —— 2026-08-06 那一輪沒取到它)。
兩顆已出貨節點跟著補一刀:**chimney_a 234 → 217、ac_a 426 → 279**。

**刀落在已出貨的節點本身,不是從 SF3D 原檔重跑** —— 因為原檔**復現不出**出貨的那兩顆:
`sf3d_bld_final/{chimney,ac}/0/mesh.glb` 配 manifest 記著的 0.6×0.5 / 0.65×0.5 只得到 220 / 402,
而且黏土對照一看就是**另一顆**(垛口狀的頂沒了)。⇒ 那兩顆的真正來源(哪一批輸出的第幾顆)
**沒有被記下來**,已寫進 manifest 的 `post.source_gap`,規矩補一條:**下一批建築節點的帳
MUST 記到輸出目錄與序號**。減面比 1.08:1 / 1.53:1,遠離 §5e 的 2.4~3:1 撕裂區;黏土四格
對照(shipped vs trimmed × 兩顆)人眼複核:垛口頂/凹槽/收分/方箱頂脊全部還在。

### 5ab-b. `--cells` 在建築上不是解析度旋鈕,是**濾掉立面凹槽**的旋鈕

節點來源 = §5n 閘門那一輪就已經生好、還躺在 `out_gate/` 的 **Art Deco 摩天樓**
(`ov_5846d9e4…`,art deco skyscraper / CC0 / athrasher;T2-spz 1024_cascade seed 1234,
226.4s、torch 峰值 3,409 MiB、raw 12,187,288 面 → 匯出 49,845 面)⇒ **這一輪不必重跑 T2**
(也就避開了「free RAM 19.8GB 貼著 20GB 門檻」那個風險)。

要把它從 49,845 面的雙層薄殼(34,751 開放邊 / 3,123 元件 / v:f 0.91)壓到 ~2,900 面,走
§5t 已定案的 `solidify_parts.py --mode resample`。**預設 `--cells 256` 出來的東西讀起來是
一塊侵蝕岩,不是一棟樓** —— T2 把立面的窗格陣列生成了一整片**垂直凹槽**,而
volumetric resample 在 2,900 面的預算下把那些凹槽逐條重採樣成隨機凸起。
往**細**調(384 / 512)只是把凹槽採得更清楚 ⇒ 更糟(kf_p95 從 0.91% 掉到 0.51% ——
**表面偏差變小而畫面變差**,§5o「表面偏差量不出撕裂」的同一條在這裡換了個面貌)。

正確方向是**往粗**:讓凹槽落在取樣解析度之下被抹平,而尺度大一個量級的**退縮階梯**
完整保留。逐檔黏土對照 56 / 72 / 96 / 128 / 160 / 256 / 384 / 512:

| cells | 面 | 開放邊 | 元件 | v:f | 黏土 |
|---|---|---|---|---|---|
| 56 | 2900 | 26 | 11 | 0.49 | ✗ 裙樓斷成浮塊 |
| **72** | **2900** | **16** | **6** | **0.50** | **◎ 階梯 + 裙樓 + 冠塔都在,面平整** |
| 96 | 2900 | 40 | 5 | 0.51 | ○ 略有凹槽殘噪 |
| 128 / 160 | 2900 | 56 / 60 | 4 / 5 | 0.51 | △ 凹槽回來了 |
| 256(預設)| 2899 | 97 | 10 | 0.51 | ✗ 侵蝕岩 |
| 384 / 512 | 2900 | 134 / 180 | 24 / 20 | 0.51 | ✗ 更碎 |

⇒ **`--cells 72 --offset 0.006 --target 2900`**;normalize 非等向 `0.5x0.5` + **`--boxuv`**
⇒ `building/mass_a` **2,898 面**(上限 2,981 留餘裕)、水平徑向 0.475、縱向 ±0.47。

### 5ab-c. 一個只有截圖看得到的缺陷:附件浮在半空

節點上線後的第一張 `mass_near` 定場圖立刻現形:**看板/天線/程序頂塔浮在塔尖上方**。
成因是算術的 —— 屋頂附件一律掛在**方盒**頂 `gy + b.h`,而庫節點縱向收在 0.95×b.h
且末端本來就收成尖塔 ⇒ 130m 的樓差 3.25m,而且尖塔那一段幾乎沒有實體。

修法 = **挑中的那幾棟,純視覺附件一律不掛**(節點自帶退縮頂塔與立面,再疊一頂程序頂塔
就是「兩頂帽子」)。兩條紀律:
1. **只換「推去哪裡」,`rnd()` 照抽** —— `const vis = (arr) => (libMass ? sink : arr)`,
   19 處純視覺 push 改成 `vis(x).push(...)`。引數原樣求值 ⇒ 亂數序列在結構上不可能變
   (同 `synthMegalith` 整座型分支的「庫節點只換 add 進場景」)。
2. **帶碰撞柱的兩件 MUST NOT 進丟棄桶**(主量體 + 臨街裙樓)—— 少掛一根碰撞柱會讓
   「載到庫的客戶端」與「沒載到的」**權威幾何分家**(A30 + §2.3),而那是看不出來的。

**亂數不變是量的**:同一份錄播圖資,載庫 vs 不載庫的 `stats` 指紋
`veg 530 / megaliths 10 / beacons 9 / climbs 122` **逐項相同**(那四個都排在建物之後,
序列一動就會漂)。同一組數字也證實了縫本身仍是 no-op:不載庫時全場三角形 1,062,292 /
mesh 1573 / 主量體 671 —— 與 §5aa-d 的 base 逐位元相同。

### 5ab-d. 實測成本與畫面

shibuya(錄播圖資)載庫後:主量體桶 671 → **647**(13 棟換成庫節點 + 11 頂程序頂塔退場),
全場三角形 1,062,292 → **1,295,924**(+22.0%,**這是三族既有節點的總成本**,不是這一顆的)。
`mass_a` 自己的帳:13 × 2,898 = 37,674 tris = 最壞情況 16 × 2,981 = 47,696 的 79%,
佔該場全場 2.9%。

新機位 **`shot_scene.mjs` 的 `mass_near`**(推導不手寫:比對**幾何物件本身**找到第一個整棟
庫節點的 instance,再照它的高度反推鏡位)—— 既有機位幾乎拍不到那十幾棟,而它是**唯一吃
立面貼圖**的庫節點,盒投影 UV 一錯就是一塊沒有窗的純色板而所有離線閘門全綠。
同輪把 `libN` 的名冊補上 `building/*` 三顆(那個讀數是「庫到底載到沒」的唯一證據)。
畫面:兩棟階梯狀塔樓,窗格立面、退縮階、裙樓與冠塔都在,四周方盒樓完全不受影響。

### 5ab-e. 驗收

`intake_parts` **241** / `audit_siteplan` **197**(+3;`--break-mass` 反向 **4 條紅**)/
`audit_object_joints --seeds 8` 21611-0 / `beacons` 68 / `gpu` 54 / `soft_stroke` 73 / `cel` 52 /
`visual_prefs` 124 / `npm test` 全綠(fresh :8667)/ `npm run bal` **全綠且逐項不動** /
3D 零件對照台 0 缺件 / 0 孤兒 / 0 未記載 / `audit_traverse` **96-19**(與節點上線**前**同一組
既有基準紅字 ⇒ 街廓通道寬確實沒動,因為碰撞柱一格都沒改)。

### 5ab-f. 未做

1. **真機冒煙**(唯一還沒跑的):要看的兩件事是**夜間立面會不會亮**(庫節點吃的是該立面款
   現做的 `wall` 材質,`emissiveMap` 應該照常)與**貼著塔走一圈的碰撞**(碰撞柱仍是方盒
   ±0.5,而節點內縮到 0.475 ⇒ 貼牆時會離牆面約 2.5% 樓寬,預期是「撞得到但看起來有一點縫」)。
2. **名冊只有一顆** —— `BLD_LIB.mass` 是輪替名冊,但現在只有 `mass_a`,所以同一張圖上
   十幾棟塔樓是**同一個剪影**(尺寸各異但形狀相同)。第二、三顆的語料 `bld_tower` 還有 3 張
   沒用過;`out_gate` 裡另一棟(`ov_fde797a7`,柱廊矮量體)不適合這一桶(它不是塔樓)。
3. **`--cells` 的結論只在這一張語料上量過** —— 「往粗調濾掉立面凹槽」對所有 T2 建築產出
   應該都成立(凹槽 vs 量體的尺度差是通則),但第二顆入庫時 MUST 重跑一次逐檔黏土。
4. deco 那兩顆的**來源帳缺口**(§5ab-a)只補了規矩,沒補回歷史。

## 5ac. Trial log (2026-08-08 深夜, 3060-machine session — 鏡像貼補:**刀的位置比刀本身重要**)

> 使用者看過 §5ab 的定場圖後定案:「**圖中建築另一面是空的,使用鏡像貼補空的部分**」。

### 5ac-a. 先確認「空」是什麼意思 —— 不是破面,是**沒被拍到的那半沒有東西**

逐面法線分向量面積:±x 21.1 / 20.9%、±z 19.1 / 19.3%、±y 10.4 / 9.3% ⇒ **六個方向都有面**,
不是缺一面。真正的「空」是**內容**:單張照片只約束得到看得見的那幾面,退縮階 / 簷帶 /
裙樓只長在被拍到的那半,另一半是模型自己補的一片平板。量得出來的指標是**半空間面積
不對稱**:z 軸 12.3% / x 軸 0.6%(空的那半在網格上不是洞、是一片光滑的板 ⇒ 開放邊與
元件數都判不出來,**面積才判得出來**:細節多 = 面積大)。

### 5ac-b. 兩次失敗:鏡射放在 solidify 端,兩種寫法都把網格撕爛

| 寫法(在 `solidify_parts.py`,鏡射排在實體化之前) | 結果 |
|---|---|
| (a) 切一半 → 鏡射 → 接上 | 開放邊 16 → **362**、元件 6 → 13、**裙樓整條不見**,黏土是碎片 |
| (b) 整份鏡射 → 與原注疊合(z 軸) | 開放邊 → **1,119**、元件 → 24、v:f 0.68 |
| (b) 同上但 x 軸 | 面數 **打不到目標**(5,058)、開放邊 5,016、元件 230 = 三角形湯 |
| (b) 先 solidify 清乾淨再鏡射疊合 | 一樣壞(1,412 / 6,440 開放邊)⇒ **不是輸入髒的問題** |

共同的錯誤前提是「**後面的 resample 會幫我熔合**」。它只對**單層**輸入成立:
(a) 沿平面切下去等於再開一圈長長的自由邊,留下的與鏡射過去的是兩張各自開口的殼;
(b) 重疊的雙層殼讓等值面重採樣的內外號誌打架。`solidify_parts.py` 的 `--mirror` 因此
**整支退回**(出貨的工具不留一個會把網格撕爛的旗標);這張表是它的墓誌銘。

### 5ac-c. 刀的正確位置 = **Blender 端的 bisect + weld**

`normalize_parts.py --mirror <node>=<x|z|auto>`:Mirror modifier 的
`use_bisect_axis` + `use_clip` + `use_mirror_merge`(threshold = 該軸跨距 × 1e-3,**比例值**,
絕對值不可移植)。它走的是完全不同的路 —— **切面 + 直接焊頂點,不重建等值面**
⇒ 一條新的自由邊都不生。留哪半由**面積**決定,`auto` 再從兩個水平軸挑不對稱較大的那一軸。
MUST 排在減面**之前**(鏡射保留一半再翻一份 ⇒ 面數大致不變;排在減面之後直接把預算翻倍)。
軸是**遊戲座標**:遊戲 x = Blender X、遊戲 z = **Blender Y**(匯出 +Y up 時互換)。

實測(同一顆 `mc_72` 進去):

| | 面 | 開放邊 | 元件 | v:f |
|---|---|---|---|---|
| 不鏡射(§5ab 出貨的那顆)| 2,898 | 18 | 5 | 0.50 |
| **`--mirror auto`(挑到 z)** | **2,921** | **15** | 6 | 0.50 |
| `--mirror x` | 2,920 | 36 | 8 | 0.50 |

⇒ **鏡射後比不鏡射還乾淨**(15 < 18),面數仍在 2,981 之下。黏土六格(三版 × 正/背)
確認:左右各有一道裙樓、冠塔對稱、看不到接縫。定場圖 `mass_near`:兩棟塔樓都成了
左右對稱的階梯塔,而周圍方盒樓完全不受影響。

**MUST NOT 對非對稱典型的主體套用** —— 岩體/枯幹鏡射出來是一顆假的雙生岩。
對稱化是這一型(Art Deco 塔樓)的**取捨**,不是通則。

### 5ac-d. 驗收

`intake_parts` 241(mass_a 2,921 ≤ 2,981)/ `audit_siteplan` 197 / `object_joints` 21611-0 /
`beacons` 68 / `gpu` 54 / `soft` 73 / `cel` 52 / `visual` 124 / 對照台 0-0-0。
消費端、預算、亂數三者都沒動(換的只是同一個節點名的幾何)⇒ `npm test` / `npm run bal` /
`audit_traverse` 沿用 §5ab 那一輪的結果。

### 5ac-e. ⚠ 之前所有「多視角」複核**全部是同一個視角** —— `ry` 是 no-op

使用者回報鏡射後「還是有一些地方空的沒有補全」,回頭查才發現:`normalize_parts.py` 的
**`ry`(變化朝向)從第一天起就沒有作用**。

- 症狀:拿同一顆節點跑 ry 0/60/120/180/240/300,匯出的**包圍盒逐位元相同**
  (x ±0.378 / z ±0.420)。而 `mesh_sheet` 是固定機位 ⇒ §5ab/§5ac 那幾張「4 視角 / 6 格
  正背對照」**其實是同一張圖印了好幾次**,我從來沒有看過這顆節點的背面。
- 根因:**glTF importer 把物件的 `rotation_mode` 設成 `QUATERNION`**,而在那個模式下賦值
  `rotation_euler` 是**靜默無效**的 —— `transform_apply` 照樣回 `{'FINISHED'}`、euler 照樣歸零,
  頂點一個都沒動。修法一行:賦值前先 `ob.rotation_mode = 'XYZ'`。
  判準寫進註解:轉 60° 之後包圍盒 MUST 變(x ±0.378 → ±0.446)。
- 連帶:所有帶 `ry` 的既有節點(`rock/facet_b` 那一族「同源轉個角度別讓玩家看出同一顆」)
  **都沒有真的轉過**。所幸 `facet_a`(882 面 / r 1.0925)與 `facet_b`(588 面 / r 0.8075)
  各自有自己的來源與減面比,**沒有退化成同一顆** —— 但「同源要轉角度」這條紀律至今沒生效。
  修好之後**重跑它們會改變已出貨資產**,要不要重跑是下一輪的決定。
- 修好後補拍的四視角(0/90/180/270)確認:**外殼是完整的**,四面都有立面、沒有缺面、
  沒有中空 —— 鏡像貼補那一刀是成立的。

### 5ac-f. 那麼「還是有一些地方空的」是什麼 —— **量體內部的空洞,不是缺面**

四視角補拍之後看得到的是:①**壁柱之間的深槽**(T2 把立面窗格生成了整片垂直凹槽,
`--cells 72` 抹掉了大部分,剩下的在某些角度讀成一條條穿透的縫)②**冠塔中央的裂口**
③**裙樓中段的缺口**。這些都在**輪廓之內**,鏡射補不到(鏡射只處理「左右不對稱」)。

下一輪要處理的是**形態學閉合**這一類的操作,而不是再鏡射一次。候選(未驗):
- `--offset` 加大(等值面外推越多,窄縫越容易被橋起來)—— 代價是稜線圓潤化,
  §5o 已記過這條 trade-off,MUST 逐檔黏土;
- 重採樣前先做一次 **dilate → erode**(pymeshlab 沒有現成的,但 `generate_resampled_uniform_mesh`
  跑兩次不同 offset 就是近似的閉合);
- 或**換一張語料**:這一張的立面凹槽特別深(art deco skyscraper 的垂直線條),
  `bld_tower` 還有 3 張沒用過,其中平整立面的那種天生沒有這個問題。

## 5ad. Trial log (2026-08-09, 3060-machine session — 鏡像貼補推廣到巨岩/假山:**先量「哪一面真的是空的」,再決定用哪一把刀**)

> 使用者定案:「img to 3D 會出現另一面是空的問題,**由正面對稱的區塊去補對應的區塊**,
> 包含**建築 / 巨岩 / 假山**都這樣處理。」

### 5ad-a. 這一句是**條件句** ⇒ 先做尺,再做刀

「**會出現**另一面是空的問題,(那時)由正面對稱的區塊去補」—— 沒有空的那一面就沒有要補的東西。
而 §5ac 的教訓是這件事**不能靠眼睛決定**(§5ac-e:`ry` 是 no-op ⇒ 那幾張「多視角」其實是同一張)。
所以這一輪先補上兩支缺掉的儀器:

| 工具 | 回答的問題 | 為什麼非有不可 |
|---|---|---|
| `tools/ai3d/mesh_sym.mjs` | 四個數:①半空間面積不對稱 ②鏡射殘差 ③邊界邊 ④鬆散元件 | §5ac-a 的量法正式化。空的那半在網格上**不是洞、是一片光滑的板** ⇒ ③④ 對它完全無感,只有①判得出來 |
| `tools/ai3d/node_sheet.mjs` | 一顆節點的**四個面**長什麼樣(給 `--ref` 就舊/新兩列) | §5ac-e 那句「我從來沒有看過這顆節點的背面」的直接補救。**繞相機不轉模型** ⇒ 結構上不可能重蹈 `ry` no-op |

**閘門錨在使用者自己判定過的那一顆**:§5ac-a 量到 `mass_a` 鏡射前 z 軸 **0.123** / x 軸 0.006,
而使用者對著那張定場圖說的正是「這棟建築另一面是空的」⇒ `EMPTY_ASYM = 0.12` 是那句話的量化,
不是挑出來的數字。`mesh_sym --gate` 因此可以直接印出名冊(15 顆現役節點 → **6 顆**):

```
rock      collapse_a 0.184(x) / hoodoo_a 0.167(z) / facet_a 0.135(z) / mega_d 0.133(z) / mega_c 0.131(z)
building  chimney_a 0.214(z)          ← ac_a 0.072 與 mass_a(已補)在門檻之下
```

**MUST NOT 改成逐顆手挑的名冊**:對一顆四面都長好的岩體照樣切半鏡射,換來的不是「補滿」,
而是一顆左右對稱、接縫帶凹槽的假石頭(下面 5ad-c 有黏土留檔)。

### 5ad-b. 刀改成 `--rework`:落在**已出貨的節點**上,外廓與預算逐位元不動

`--mirror` 只在「從 SF3D 原檔重跑一顆節點」那條路上才有用,而**出貨節點的原檔多半對不回來**
(`parts_manifest` 的 `source_gap`:同一組 fit 重跑 chimney/ac 只得到 220/402,而出貨的是 234/426,
剪影明顯是另一顆)。§5ab 重減面那一輪已經走過「刀落在已出貨的節點本身」,這一輪把它做成具名旗標:

```
--rework "<node>=<x|z|auto|none>[|<warp>][|half|union]"      # 要有 --base
```

**核心不變式:動刀前先記下 `nodeExtent` 量的那兩個數(水平徑向 rMax、縱向 y 兩端),動完等比還原。**
於是 intake 的外廓契約(上界 fallback 包絡、下界 0.5×)**兩邊都不可能因為這一刀而改變**,
唯一變的是殼裡面的形狀。**面數同理只准降不准升** —— 鏡射會多出切面那一圈(+17~26% 實測),
而現役節點的預算餘裕只有 2%(chimney_a 217/222、ac_a 279/285)⇒ 一律減面回原值(比 ≤ 1.2:1,
遠離 §5e 量到的 2.4~3:1 撕裂區)。

**必要前置:先依距離焊頂點。** glTF 匯出器為了法線接縫把頂點拆開,而 **Blender 的 glTF 匯入器
預設不會焊回去** ⇒ 平面著色的節點(拆分比 ≈ 3)在 Blender 眼裡是**一堆互不相連的三角形**。
對三角形湯做 bisect 的實測下場:`hoodoo_a` 382 面 → **96 面**、`tower_a` 開放邊 0 → **170**。
焊接會抹掉自訂分裂法線 ⇒ 著色風格依**原拆分比**還原(≥2 平面 / 以下 30° 角平滑),
不還原的話低面數岩體會從有稜有角變成一顆平滑的馬鈴薯,而所有讀數都正常。

### 5ad-c. **兩把刀,依主體是不是人造的選** —— 這不是喜好問題

| 刀 | 做法 | 對誰成立 |
|---|---|---|
| `half` | bisect + clip + 焊接縫(§5ac 那一把) | 量體本來就左右對稱的東西(建築) |
| `union` | 整份鏡射 → **精確布林聯集** | 岩體 |

`half` 對圓渾的岩體會做出**葉緣**:保留的那半在切面上是最寬的斷面,而表面是**斜著**離開切面的,
翻一份接上去就在切面接成一道銳脊。四視角黏土實測(scratchpad 留檔):`mega_c` 從一顆卵石變成
**一片有中脊的葉子**、`mesa_a` 的**平頂變成尖峰**、`collapse_a` 變成楔形、`chimney_a` 變成一頂帳篷。
`union` 取的是兩者的**外包絡** ⇒ 本來就厚的那半原封不動、空的那半被鏡像撐出來,接縫是內凹的
岩溝而不是外凸的銳脊,平頂/塊狀輪廓保得住。

與 §5ac-b 失敗的「整份鏡射再疊合」**不是同一件事**:那一版是把兩張殼疊在一起交給等值面重採樣
自己想辦法(內外號誌打架 ⇒ 開放邊 1,119),這裡是真的做布林。代價是**布林要求輸入夠乾淨**:
逐顆實測 union 在 12 顆岩節點裡有 6 顆炸掉(見下表)。

### 5ad-d. 三道閘,每一道都對得上一次實測的失敗

| 閘 | 擋掉的東西 |
|---|---|
| 面數 ≥ 原值 × 0.8 | `hoodoo_a` 的 z 平面 bisect:382 → 96(同一顆的 x 平面卻好端端 616)。焊完 V=139/F=382 已經不是流形 |
| 鬆散元件 MUST NOT 增加 | `tower_a` 走 union:元件 1 → **14**,而**面數只掉 6%** —— 光看面數完全攔不住,黏土圖上是一地碎屑 |
| 邊界邊 ≤ 原值 + 5% 面數 | `mesa_a` union 175 → 257、`facet_b` union 60 → 119 |

三道閘 MUST 排在**減面之前**:減面會把碎屑磨掉一部分,讀數反而變好看。
少了這幾道,壞掉的節點會**安靜地**出貨 —— 外廓照樣還原、預算照樣綠、intake 一句話都不會說。

逐顆 × 逐刀的實測結果(✅ = 過閘):

```
            union  half        union  half              union  half
collapse_a   ✅    ✅   mega_b   ✅    ✅   mega_f        ❌    ❌(元件 1→16 / 1→4)
facet_a      ✅    ✅   mega_c   ✅    ✅   tower_a       ❌    ✅(元件 1→14)
facet_b      ❌    ✅   mega_d   ❌    ✅   mesa_a        ❌    ❌(邊界邊 175→257 / 194)
mega_a       ✅    ✅   mega_e   ❌    ✅   hoodoo_a      ❌    ❌(面 382→128 / 96)
```

### 5ad-e. 去對稱化(`warp`):**位移 MUST 只是位置的函數**

鏡射之後兩半逐位元相同 = 一顆假的雙生岩(§5ac-c 因此把岩體列為禁區)。低頻位移場沿**徑向**
推開之後,鏡射殘差回到天然岩體的水準,而「空的那一面被填滿」不受影響。

⚠ 方向 MUST 取徑向,**MUST NOT 取頂點法線**:座標重合但各自獨立的頂點(見 5ad-b)在逐頂點
法線下是不同的向量,推一下就把網格沿每一條硬邊撕開(實測 `mega_a` 開放邊 0 → **164**、
元件 1 → **7**)。位置的函數對重合頂點給出同一個位移,結構上不可能撕(實測:warp 0 與 0.05
的開放邊/元件**逐項相同**)。岩體對中心近似星形 ⇒ 徑向與法線本來就幾乎同向。

振幅錨在**天然水準**:未鏡射節點的鏡射殘差落在 0.030~0.274(中位數 ≈0.073)。掃描 0.05 / 0.08 /
0.11 三檔,0.08 讓全體落在 0.030~0.111(中位 0.075)= 正中天然帶。**但有破口的節點 MUST warp 0** ——
裂縫兩側是不同座標的頂點,位移會把縫拉開(實測 `mesa_a` 0.08:黏土圖上原本的細縫變成黑色溝壑)。
出貨取 0.05(watertight 那幾顆),換來 sym 0.020~0.064,偏保守。

### 5ad-f. 出貨的名冊(4 顆)與**沒出貨的三顆**

| 節點 | 刀 | warp | 不對稱(補完) | 面 | 判讀 |
|---|---|---|---|---|---|
| `rock/collapse_a` | union | 0.05 | x 0.184 → **0.003** | 938 → 918 | 缺角補起來;頂面多一道對稱鞍部 |
| `rock/facet_a` | union | 0(有 4 條邊界邊) | z 0.135 → **0.002** | 882 → 864 | 兩端多一道垂直裂溝 |
| `rock/mega_c` | union | 0.05 | z 0.131 → **0.014** | 274 → 268 | 同上 |
| `rock/mega_d` | half | 0(246 條邊界邊) | z 0.133 → **0.002** | 291 → 285 | **這一顆是明確的贏** —— 舊版整塊缺角 + 破洞,補完輪廓完整 |

- `rock/hoodoo_a`(0.167):**兩把刀都撐不住**(面 382→128 / 96)。根因在來源 —— 它是 §5m 的
  Hunyuan3D-2GP 產出,焊完 V=139 / F=382,閉合流形應該是 V=193 ⇒ 這顆網格本身就不是流形。
  正解是**重生成**這一顆,不是硬補。
- `building/chimney_a`(0.214):union 過不了元件閘(2→3),`half` 過閘**但黏土上是回歸** ——
  它變成一頂尖帳篷,更不像煙囪了(舊版本來就是一顆歪塊;`parts_manifest` 的 `source_gap`
  已經記過「出貨那顆的來源找不回來」)。同樣是**重生成**的活,這一輪不動它,`building.glb` 逐位元不變。
- `building/ac_a`(0.072)/ 其餘 7 顆岩節點:**在門檻之下 = 沒有空的那一面**,一格都不動。
- **樹族刻意不在這一輪**(使用者點名的是建築 / 巨岩 / 假山)。順手量到:`tree.glb` 30 顆裡有 10 顆
  過門檻(`canopy_f38`/`f5` 高達 **0.724**、`bl_wood_a` 0.449),但**冠層那一族的高不對稱不等於「空的」**
  —— 它們是**枝葉本來就疏密不均**,而且幾乎每顆都有數百條邊界邊(葉片是開放面片)⇒ 這把刀對它們
  多半會過不了 5ad-d 的閘。要不要做是另一輪的決定,數字在 `mesh_sym --gate` 隨時印得出來。
- `building/mass_a`:§5ac 已補(現值 asymZ 0.000 / symZ 0.000),這一輪不重跑。

⚠ **使用者要看的取捨**:4 顆裡 `mega_d` 是明確的贏;另外三顆是**交換** —— 空的那一面確實補滿了
(不對稱 0.13~0.18 → 0.003 以下),代價是接縫處多一道對稱的凹槽/鞍部。要收窄成「只補真的有破洞
的那幾顆」的話,把上表其餘三列從 `--rework` 拿掉重跑即可(工具是決定性的,重跑就回到舊版)。

### 5ad-g. 驗收

`intake_parts` **241**(外廓與預算逐位元不動 ⇒ 讀數與 §5ac 完全相同)/ `audit_siteplan` **197**
(`--break-shy` 3 條紅)/ `audit_beacons` **68**(`--break-extent` 1 條紅)/ `object_joints --seeds 8`
**21611 接合 / 0 異常** / `cel` 52 / `visual_prefs` 124 / `gpu` 54 / `soft_stroke` 73 /
`npm run bal` 全綠(⑦f 不動)/ `npm test` 全綠(fresh server :8666)/ 3D 對照台 0 缺件 0 孤兒 0 未記載。
**反向驗證**:`--rework "hoodoo_a=z|0"` MUST 紅字「鏡射把面數打掉了(382 → 96)」;
`--rework "tower_a=auto|0|union"` MUST 紅字「炸成碎片(鬆散元件 1 → 14)」——兩條都實測會紅。

**未跑**:①真機冒煙(走到岩體旁邊繞一圈看四面)②`audit_traverse`(㋓ 需網路;**理由上不受影響** ——
巨岩的碰撞/佈局算式 MUST NOT 讀庫幾何(`megaGeo` 檔頭),而外廓這一輪逐位元還原)。

### 5ad-h. 一個副作用要記著

`mass_a` 是唯一帶 UV 的庫節點,而 `--base` 匯入再匯出會依 UV 接縫**重新拆頂點**
(8,523 → 8,565,+0.5%);形狀、面數(2,921)、外廓、UV 對應全都不變。這一輪最後沒有動
`building.glb`(chimney_a 退回),所以沒有落地;**下次任何要動 `building.glb` 的一輪,
這 42 個重複頂點會跟著出現,不是 bug**。

## 5ae. Trial log (2026-08-09, 3060-machine session — 建築續:`mass` 名冊補到 2 顆,而**語料才是那個「另一面是空的」的根因**)

> 使用者:「繼續處理建築」。§5ab-f 的未做清單第 2 條:名冊只有一顆 ⇒ 同一張圖上挑中的
> 十幾棟塔樓是**同一個剪影**(尺寸各異、形狀相同),而所有離線閘門全綠。

### 5ae-a. 「還有 3 張沒用過」是真的,但那 3 張裡有 2 張不是建築

§5ab-f 記著 `bld_tower` 還有 3 張語料。點開來看:`ov_fde797a7` 是柱廊矮量體(那一條記對了,
不適合這一桶),而 **`ov_6588f838` / `ov_6ca0f9f9` 是同一本 1932 年畢業紀念冊的封面與封底** ——
浮雕的裝飾藝術大樓 + 一條藍緞帶,另一張是空白卡紙背面。授權合法、位元是真的 JPEG、
`--plan` 一路顯示「這一列 4/4 抓夠了」。

兩個機制**同時**放它們進來,兩個都沒有錯誤訊息:

1. 供應者 `smithsonian_african_american_history_museum` **不在 `EXCLUDED_SOURCES`** 裡
   (清單有 8 個 Smithsonian 系,就差這一個)。⇒ 本輪補上。
2. Openverse 對這個源回不出尺寸 ⇒ 帳本記 `size_unknown` ⇒ 短邊 1024 那道閘
   **結構性地量不到**(`Math.min(it.w || Infinity, …)`)。這是**刻意的行為**(檔頭寫著
   「沒回的照收並標記」),但它與 ①的漏網合起來,正好讓純館藏掃描件無條件穿過兩道閘。

處置:`screen_mattes.py --family building --human reject <兩個 id>`(人眼判決恆勝統計,
且 id 留在 `seen` ⇒ 同一張垃圾不會被重新下載)。`have()` 因此掉到 2/8,`--plan` 才開始說實話。

**教訓寫成一條規矩**:`--plan` 的「抓夠了」只證明**下載成功**,不證明**內容對**;
一列語料在第一次真的要用之前,人眼那一關等於還沒跑。

### 5ae-b. 補抓 + 選片

`bld_tower` 的 `want` 4 → **8**,查詢從 3 句擴到 6 句、全部改成**具名的單一主體**
(`stepped skyscraper setback` / `brutalist concrete tower block` / `modernist office tower` /
`gothic revival skyscraper`)—— 舊的三句在 Openverse 只有個位數結果(`art deco skyscraper`
全庫 **6 筆**)。一輪抓到 3 張(第 4 張撞 `upload.wikimedia.org` 的 429,那是**本輪網路狀態**
不入帳):

| 候選 | 判讀 |
|---|---|
| **`ov_8811db29`(Fisher Building, Detroit)** | ◎ **採用** —— 藍天下的單一主體,裙樓/塔身/退縮/綠銅錐頂/尖塔**整棟都在畫面裡** |
| `wc_378871`(GE Building) | ○ 塔身好,但埋在整片天際線裡(去背要跟一排樓打架)⇒ 留給 mass_c |
| `ov_c343cdcb`(布魯托主義板樓) | ○ 同上,已 matte 未生成 |

順手修掉一個會**中途截斷批次**的坑:`matte_photos.py` 的進度行有 `✓`,而繁中 Windows
主控台預設 cp950 ⇒ 印到那個字元就 `UnicodeEncodeError` **整支中止**(實測跑到第 4 張才死,
前 3 張的產出留著、後面的沒有,回頭看目錄只覺得「怎麼少了幾張」)。修法一行 `reconfigure`。

### 5ae-c. 生成:**配方一個字都沒改**

T2-spz `1024_cascade` / steps 12 / seed 1234 / decimate 50 / tex 1024 ⇒
**117.0s**(sample 94.7 + decode 7.0 + glb 15.4)、torch 峰值 2,890 MiB、
raw 4,309,688 面 → 匯出 49,169 面(雙層薄殼:36,435 開放邊 / 2,910 元件 / v:f 0.93)。
跑批當下 avail RAM **19.7GB**,貼著 §5n 記的 20GB 門檻 —— 這一次沒有無聲死亡,但那條
警語照舊有效。**輸出目錄與檔名記進帳本的 `gen.out` 欄**(§5ab-a 立的新規矩的第一次兌現)。

實體化沿用 §5ab-b 定案的 `--cells 72 --offset 0.006 --target 2900`(建築上它是「濾掉立面
凹槽」的旋鈕),**未重新掃描** —— 同一族、同一種主體。結果比 mass_a 乾淨:

| | 面 | 開放邊 | 元件 | v:f | kf_p95 |
|---|---|---|---|---|---|
| `mass_a`(§5ab)| 2,900 | 16 | 6 | 0.50 | 0.95% |
| **`mass_b`** | **2,900** | **0** | **1** | 0.50 | 1.06% |

normalize 非等向 `0.5x0.5` + `--boxuv` ⇒ **2,900 面**(上限 2,981)、水平徑向 0.475、縱向 ±0.475。

### 5ae-d. 最有價值的發現:**mass_b 不需要鏡像貼補**

`mesh_sym`(§5ad 那把尺)量 `mass_b`:半空間面積不對稱 **x 0.004 / z 0.014** ——
遠在 `EMPTY_ASYM = 0.12` 之下,閘門一顆都沒點名。

對照 `mass_a` 鏡射**前**的 z 0.123。兩顆同一支模型、同一組參數、同一支實體化刀,
差別只有**語料**:mass_a 的來源是夜景**crown 的緊裁特寫**(只有兩個面被拍到),
mass_b 是藍天下的**整棟**。⇒ 「另一面是空的」不是 img→3D 的固有病,是**單張照片
只約束得到被拍到的那幾面**這件事的直接後果。**上游修語料,勝過下游動刀**:
§5ad 那把刀是既有節點的補救(而它在圓渾岩體上只能換到一個交換),
新節點該做的是**挑一張把整棟拍進去的照片**。選片準則因此多一條:
**這一桶要的是「整棟入鏡」,不是「最好看的局部」**。

### 5ae-e. 兩份會靜默過期的手寫清單(名冊一擴充就中招)

`shot_scene.mjs` 裡有兩處手寫節點清單,名冊補到第 2 顆時**兩處都還只認得 `mass_a`**:
①「載到幾顆」讀數(那是「庫到底載到沒」的唯一證據);②`mass_near` 機位的認人
(挑中 `mass_b` 的那幾棟拍不到,而畫面上只表現成「這張圖好像沒換到庫節點」)。
這與 runbook 記過的 `% 3` 輪替除數是**同一個坑**:檔案在、intake 綠、而工具永遠看不到新節點。

修法 = 新增讀取縫 **`partlib.js libNames()`**(這一次真的載進來的節點名,唯讀快照):
讀數改由它推導(shibuya 實測 **46 顆**),機位改認**整個 `building/mass_*` 家族**。
`libNames()` **只給離線量測/出圖工具用** —— 遊戲路徑一律走 `libGeo(具名節點)`,
MUST NOT 拿它枚舉「有什麼就畫什麼」(那會讓畫面隨 GLB 內容漂移,而零件表才是真相)。

### 5ae-f. 驗收

`intake_parts` **245**(+4:mass_b 的三條外廓 + 一條預算,2,900 ≤ 2,981)/
`audit_siteplan` **197**(`--break-mass` **3 條紅**)/ `object_joints --seeds 8` 21611-0 /
`beacons` 68 / `cel` 52 / `visual_prefs` 124 / `gpu` 54 / `soft_stroke` 73 /
`npm run bal` 全綠 / `npm test` 全綠(fresh server :8668)/ 3D 對照台 0 缺件 0 孤兒
**0 未記載來源**(mass_b 的帳含 `gen.out`)/ 定場圖 `shot_scene --venue shibuya --live`
的 `mass_near`:畫面上**同時看得到兩種剪影** —— 階梯方塔(mass_a)與細塔身 + 尖頂(mass_b),
兩者的立面窗格都在(盒投影 UV 正常)。

**draw call 不隨名冊長度增加**:挑中的棟數上限仍是 `pick_n = 16`,每一棟最多落進一個
mesh ⇒ 額外 mesh ≤ 16(§5aa 的推導不受影響);分到哪一顆由**位置雜湊** `djAt` 決定,
零 `rnd()` 消耗。

### 5ae-g. 未做

1. **真機冒煙**(§5ab-f 第 1 條仍在):夜間立面會不會亮、貼著塔走一圈的碰撞。
2. **`building/chimney_a` 仍待重生成**(§5ad-f:鏡像兩把刀都不適用,而它的來源在
   `post.source_gap` 已記「找不回來」)。`chimney` 那一列語料同樣該重抓。
3. `measure_building_tris` 的 A/B **這一輪不適用**(改動本來就會換掉一半塔樓的幾何,
   逐位元不變不是這一輪的判準);預算那一面由 intake 的 2,981 與上面的 draw call 上界擋住。
4. mass_c(GE Building / 布魯托主義板樓,兩張都已 matte)。

## 5af. Trial log (2026-08-09, 3060-machine session — 冒煙那一項終於跑得動了,而它一跑就發現**整條建築線在 main 上是死碼**)

> 使用者:「繼續 ai3d_runbook.md」。未做清單連三輪(§5ab-f / §5ad-g / §5ae-g)的第 1 條都是
> **真機冒煙**,而它一直沒跑的原因與 §5z-t 記的一模一樣:**兩支工具各缺一半**。
> 這一輪先把工具補齊,然後那項冒煙立刻回報了一件比它自己更重要的事。

### 5af-a. 為什麼「夜間立面」三輪都沒人跑得動 —— `cfg.env` 是寫死的

`shot_scene.mjs` 從第一天起就寫著 `cfg.env = { season:'summer', time:'day', weather:'clear' }`。
而 `biomes.js` 的夜間旗標是 `cfg.env?.time === 'night'`(:6953),立面的 `emissiveMap` 只在
夜裡點亮(:7718)⇒ **沒有任何離線工具畫過夜景**。這正好是整棟量體節點唯一真正要驗的東西:
它是**唯一吃立面貼圖**的庫節點,盒投影 UV 一錯,白天看到的只是「一塊有 tint 的板」、
**夜裡才看得出是一塊沒有窗的板**(§5ab-c 那條材質契約就是為這件事立的)。

⇒ 補 `--time / --season / --weather` 透傳(非預設值進檔名後綴,免得日夜兩輪互相覆寫)。
**合法值當場驗、打錯就停**:`environment.js` 是 `TIMES[env?.time] || TIMES.day`、`biomes.js` 是
`=== 'night'` ⇒ 打成 `--time nigth` 會拍出一組**白天**的圖,而每一行讀數都正常 —— 與 §5z-t
那個 `--ink=0` no-op 是同一種失效(旗標沒作用,而畫面看起來完全合理)。

### 5af-b. 冒煙的第一個回合:**站不出來的那 15 棟**

補完旗標跑 `shot_scene --venue shibuya --live --time night`,夜景是對的(程序方盒的窗格
一格一格亮著),但 **`mass_near` 那張機位整個不見了**。換 manhattan 再跑一次,還是不見。
前一天 §5ae 明明量到 shibuya 挑中 13 棟。

先補讀數(**機位消失 MUST 講得出原因**,否則分不出「挑不到」與「認錯人」——兩者都不報錯),
答案是 `整棟量體挑中 0 棟`。往上追:

| commit | `OVER.bldCap` | `MASS.MIN_H` |
|---|---|---|
| `7135050`(PR #170 = §5aa~§5ae 整條建築線)| **170** | 55 |
| `f94515f`(PR #169 = 世界高度上限)| **`objHeightMax()` = 2 × 26 = 52** | (那支沒有這一段)|
| `8ddee35`(main,兩者合併後)| **52** | **55** |

兩個 PR **改的不是同幾行**,git 合得乾乾淨淨;壞掉的是**組合**:所有建物高度都夾 52m,
於是 `generic.filter(b => b.commercial && b.h > 55)` **結構性地永遠是空的**。
同一刀還砍掉三件更早的東西 —— 退縮頂塔(`b.h > 55`)、第二層退縮(`b.h > 100`)、
屋頂天線(`b.h > 60`)。**天際線的「婚禮蛋糕」剪影整個消失,而沒有任何東西會說**:
`intake_parts` 245 綠(它驗 GLB,不驗「這顆有沒有被擺出去」)、`audit_siteplan` 197 綠
且 `--break-mass` 照樣紅(它驗 pick_n 與預算同一份、驗保險絲、驗色抖序 —— 就是沒驗
「門檻構不構得到」)、3D 對照台 0 孤兒(名冊有引用)、`npm test` / `npm run bal` 全綠
(那兩支不模型化地物)。**兩輪 img→3D 的產出(`mass_a` 2,921 + `mass_b` 2,900 tris)
在 main 上一顆都沒有被擺出去過。**

### 5af-c. 定案與守門線

使用者定案**提高物件高度上限**(而不是把門檻改成推導值)⇒ `OBJ_F 2 → 4`(52 → **104m**)。
連帶**兩個係數都要動,而第二個使用者沒點名**:
- `CEIL_PEAK_F 2.5 → 4.5` —— `CEIL_PEAK_F > OBJ_F` 是「物件恆構不到天花板」的**結構保證**;
- `CEIL_AVG_F 4 → 6` —— 地表恆 ≤ 最高海拔 ⇒ **平均項的係數不大於峰頂項的話,平坦市區
  那一項永遠贏不了**,§WORLD_H ③ 的「取 max 的兩端各自勝出」當場退化成單一項。
  稽核 Ⅰ 因此多一條把這個前提明寫出來(舊制 4 > 2.5 剛好成立,所以從來沒人注意到它是前提)。

**守門線 = 稽核 Ⅲ 新增一條**:吃建物高度的門檻 MUST 全部 < `objHeightMax()`。
門檻**從 `biomes.js` 原文抽**(`b.h > N` 逐條 + `MIN_H: N`),不是手抄 —— 之後有人再加一條
自動跟著驗。反向驗證新旗標 `--break-cap`(把上限調回 2 倍)⇒ 紅字並**逐一列出構不到的
55 / 60 / 100m**;既有的 `--break-obj` 咬不到這一條(它是把上限往**上**推)。

### 5af-d. 冒煙結果(三輪未做的那一條,這次真的跑了)

**①夜間立面 —— 通過。** 上限抬高後 shibuya 挑中 **15~16 棟**,`mass_near_night` 上兩顆庫節點
(`mass_a` 階梯方塔 / `mass_b` 細塔身 + 尖頂)的**窗格與旁邊的程序方盒一樣亮著橘光**
⇒ 盒投影 UV 契約成立,不是「一塊沒有窗的純色板」。同一張圖上兩種剪影都在(§5ae 的
名冊擴充在夜裡照樣成立),挑中的那幾棟頭上也沒有浮在半空的附件(§5ab-c 的修法還在)。

**②岩體四面 —— 通過。** 新機位 `mega_orbit_{0,90,180,270}`:**繞相機、不轉模型**
(§5ac-e 那次「多視角其實是同一個視角」的 `ry` no-op,結構上不可能重蹈)。
shibuya 拍到 `rock/tower_a`(r 28.6m / h 43.5m),四面都是實心的,裙錐與平頂完整。

**③碰撞 —— 量,不用走的。** `intake` 的外廓讀數就是答案:`mass_a`/`mass_b` 水平徑向
**0.475**、縱向 **±0.47**,而權威有向盒是單位盒的 ±0.5 ⇒ 看得見的量體**恆收在碰撞柱之內**
(方向是對的:永遠不會「看得穿卻走不進」)。代價是「被空氣擋住」最多 2.5% 寬 / 3% 高 ——
上限抬到 104m 之後**絕對值跟著翻倍**(最壞約 3.1m)。這不是這一輪引入的,而是「有造型的
節點裝進方盒碰撞柱」的**固有**取捨(退縮與尖頂造成的落差比它大一個量級),而 A30 不准動
碰撞柱(那是與伺服器共用的權威幾何)⇒ **記錄,不修**。

### 5af-e. 順手修掉兩個「讀數正常但拍錯東西」的坑

1. **機位是在第一次 render 之前算的**,而 three 的 `matrixWorld` 要等 render 才更新 ⇒
   `Box3.setFromObject` 讀到的是舊矩陣。補 `scene.updateMatrixWorld(true)`。
2. **頂點數相同不保證是單獨一顆**:合併過的桶偶爾撞上同一個數字,而它的包圍盒橫跨整張圖
   (實測 shibuya 某一局「外接半徑 733.5m、高 39.5m」⇒ 四台相機被擺到 1.4km 外拍空氣,
   而每一行讀數都正常)。門檻吃**權威常數** `objHeightMax() × 2`,擋掉幾顆一律印出來。
   **這不是罕見案例** —— 正常門檻下 taroko 那一局就擋掉 1 顆。

### 5af-f. 驗收

`audit_world_height` **49**(47 + 2 條新斷言)/ `intake_parts` 245 / `audit_siteplan` **197**
(`--break-mass` 3 條紅)/ `audit_beacons` 68(`--break-extent` 1 紅)/ `object_joints --seeds 8`
**21611 接合 0 異常** / `cel` 52 / `visual_prefs` 124 / `gpu` 54 / `soft_stroke` 73 /
`npm test` 全綠(fresh server :8670)/ `npm run bal` 全綠且**逐項與 §5ae 逐位元相同**
(⑦f 1.78×、交付率 89.2 / 92.0 / 51.8 —— WORLD_H 不進平衡模型)。
**反向驗證**:`--break-cap` ⇒ Ⅲ 紅並列出 55 / 60 / 100m;`--break-obj` ⇒ Ⅱ 紅 2 條;
`--break-ceil` ⇒ Ⅰ・Ⅱ 紅 6 條。

**`audit_traverse`(㋓)93 過 / 19 敗 —— 敗數與改動前(§5ab 記的 96-19)相同,而且是同一組。**
這一項在本輪特別重要:門檻活過來 ⇒ `b.h > 55` 那幾行的 `rnd()` **重新被消耗** ⇒ 共享亂數序列
往後推移 ⇒ **全圖地物佈局重排**,街廓夾出來的通道寬等於整組換過一次(不是跨客戶端分歧,
是與上一版不同的一張圖)。逐條對回既有基線的四個成因,**一條新的都沒有**
(過關數 96 → 93 是逐局圖資可用性的浮動,同一支歷來 89 ~ 96 都出現過):

| 類別 | 筆數 | 場地 | 成因(既有,全是稽核端) |
|---|---|---|---|
| 航點不可達 | 10 | shibuya・manhattan・paris・yosemite・venice・civicblvd・roppongi・taroko・london・chicago | 全是「橋面中段 / 地下道引道 / 隧道洞口」⇒ 泛洪 `visited` 鍵漏 `sid` + `buildStructs` 沒鏡射 `chainWays` 與邊界裁切 |
| 橋下淨空 | 9 | shibuya 0.75m・giza 1.98/3.13・civicblvd 1.99/2.08/3.74・roppongi **0.45**/2.91・london 3.84 | 斷言與 `deckAt` 刻意的貼地夾制矛盾(`ROAD_LIFT = 0.45`;roppongi 那一筆**逐位元就是它** = 這組紅字仍是原班人馬的指紋)|

⚠ 兩件事要記著:①**第一次跑時把輸出接到 `tail -25`**,19 條紅字全部捲掉只剩總計 —— 重跑才拿得到
名單(這一支要 30 分鐘,別接管線);②收尾的 exit code 1 是那 19 條,不是工具壞了。

### 5af-g. 未做

1. **`building/chimney_a` 重生成**(§5ae-g 第 2 條原封不動)+ `chimney` 那一列語料重抓。
2. **mass_c**(GE Building / 布魯托主義板樓;⚠ §5ae 補抓的那 3 張**連同 photo-DB superset 一起沒了**,
   要重抓 —— 見下面第 4 條的語料現況)。
3. **`rock/hoodoo_a` 重生成**(§5ad-f:兩把鏡像刀都撐不住,根因是 2GP 那顆網格本身不是流形)。
   ⚠ **T2-spz 這一輪跑不動**:它要 ≥20GB avail RAM 才載得進來(§5n),而本輪機器只有 15.1/31.7GB
   (要跑得先請使用者關掉 Chrome / Discord / Spotify / Steam)。
4. **⚠ 語料現況(2026-08-09 覆核,推翻 §5ae 結尾那句)**:`self-buff-support-scaling-866a87`
   **worktree 已經不存在**,§5p 搬過去的 305 筆 superset 連同 §5ae 剛抓的 3 張一起沒了。
   全機器只剩兩份、都在 worktree 裡:`reverent-pascal-fcd63e`(533MB,manifest 2026-08-06;
   building 22 / rock 16 / tree 22 / landmark 4)與 `zen-albattani-b33990`(279MB,更舊)。
   **上面第 1、3 條要的語料還在**(`photos/building/chimney` 5 張、`photos/rock/hoodoo` 6 張 ——
   含出貨那顆的來源 `wc_112762573`);第 2 條的要重抓。
5. 真人在遊戲裡走一圈(本輪的「冒煙」仍是離線截圖 + 量測,不是真的操控機體貼著塔繞)。

## 5ag. Trial log (2026-08-09, 3060-machine session — 掛了兩輪的 `chimney_a` 重生成:**換模型不換語料**,而 hoodoo 判退)

> 使用者:「繼續」。§5af-g 的第 1、3 條(`chimney_a` / `hoodoo_a` 重生成)—— §5af 記的 RAM
> 障礙自己解除了(15.1 → **23.0GB avail**),T2-spz 載得進來,兩顆一起試。

### 5ag-a. 先看照片:兩族的語料庫裡**都躺著比出貨版更好的一張**

`screen_mattes` 那一輪的紀律(**先看照片再看網格**)這次直接決定了結果。把兩族既有的 matte
攤成 contact sheet 人眼分桶:

| 族 | 出貨版用的那一張 | 判讀 |
|---|---|---|
| chimney | `ov_551789bb` | 磚砌工業煙囪,**仰角極陡、基座出框**。「一顆歪塊」的成因寫在照片上 |
| hoodoo | `wc_112762573` | **主體只佔畫面約 15%、alpha 糊成一片**(= §F0 的「剝空/主體太小」桶)。T2 以 alpha>204 取 bbox ⇒ 餵進去的是一小塊 |

另外找到的候選:chimney 有一張 `ov_7f8d8e91`(三連磚煙囪,**平視、整組入鏡、白背景**)、
hoodoo 有一張 `ov_929bc3d9`(**乾淨單體:帽岩 + 細頸 + 基座,去背俐落**)。
兩張都完全符合 §5ae-d 立的「整棟/整株入鏡」準則 ⇒ 直覺上都該勝出。**實測兩張都判退。**

### 5ag-b. 三注一起跑(1024_cascade / steps 12 / seed 1234,配方一字未改)

| 餵入 | raw 面 | 實體化後(`--cells 72 --offset 0.006`)| 判讀 |
|---|---|---|---|
| chimney `ov_551789bb`(**舊語料**)| 2.00M → 48,316 | **270 面 / 0 開放邊 / 2 元件 / watertight / kf_p95 0.72%** | ◎ 採用 |
| chimney `ov_7f8d8e91`(三連)| 3.55M → 49,762 | 270 面 / 0 開放邊 / **6 元件** | ✗ 黏土上碎成一塊平台加兩根樁 |
| hoodoo `ov_929bc3d9` | 2.15M → 48,517 | 500 面 / 0 開放邊 / 1 元件 / kf_p95 0.98% | **✗ 讀數漂亮而黏土是浮雕板** |

**跑批當下 `ram_avail` 掉到 3.3GB** —— §5n 那條「≥20GB 才載得進來」的門檻是真的在用,不是餘裕。

### 5ag-c. hoodoo 判退:**讀數全綠而形狀是錯的**,只有黏土看得出來

新版 hoodoo 的每一個數字都比舊版好(0 開放邊、單元件、kf_p95 0.98%),而四面黏土一擺出來
就結束了:**舊版是帽岩 + 細頸 + 基座的立體團塊,新版是一片薄板**(正面寬、側面剩一條)。
單張照片只約束得到被拍到的那一面,而 hoodoo 的辨識特徵**恰好全在剪影上** ⇒ 模型沒有理由
給它厚度。這與 §5ab-b 的「表面偏差量不出撕裂」是同一句話的另一面:**幾何品質指標量不出
「這個形狀對不對」**。

⇒ **`rock/hoodoo_a` 這一輪不動**,`rock.glb` 逐位元不變。§5ad-f 說「正解是重生成」是對的,
但**重生成 MUST 走階梯上對的那一階**:`T2-spz(建築/規則幾何)→ 2GP(實心岩體)→ SF3D → procedural`
—— hoodoo 是實心岩體,而它現在這顆本來就是 2GP 出的。要重生成得回 WSL2 跑 2GP(換語料到
`ov_929bc3d9` 仍值得試,**但要換的是那一階,不是那一張**)。拿 T2 去換,是把階梯走反。

### 5ag-d. chimney 採用:**同一張照片、換模型**,而「另一面是空的」自己消失了

| | 面 | 邊界邊 | 元件 | 半空間不對稱 | 水平徑向 / 縱向 |
|---|---|---|---|---|---|
| 舊(SF3D,2026-08-06)| 234 → 217 | **189** | 2 | **0.214** | 0.570 / ±0.475 |
| 新(T2-spz,本輪)| **216** | **0** | 2 | **0.053** | 0.570 / ±0.475 |

黏土四面:舊版是**帶裂縫的歪塊**(189 條邊界邊在圖上就是那些裂口),新版是**方形斷面 +
階狀收分的磚煙囪**,四面讀起來是同一個東西。

三件事值得記著:
1. **外廓逐位元相同**(0.570 / ±0.475)⇒ 消費端的 `S=(w,h,w)` 與碰撞語意一格不動,
   這一顆是純粹的「同名取代」。
2. **不對稱 0.214 → 0.053,掉到 `EMPTY_ASYM = 0.12` 之下** ⇒ §5ad-f 把它列為「兩把鏡像刀
   都不適用」的那個問題,**重生成之後不存在了**。這是 §5ae-d「上游修勝過下游動刀」的第二次
   兌現,只是這次修的是**模型**不是語料 —— 而 §5ad 那把刀當初正是為了救這一顆才被逼出來的。
3. **三連煙囪那張輸給仰拍那張**,與 §5ae-d 的準則表面上矛盾:「整組入鏡」在那裡是對的,
   在這裡卻碎成 6 元件。差別是**主體數**:mass 那一桶要的是**一棟**,而三連煙囪是**三根柱子
   加一塊底座**,222 面的預算分不出三根柱子。⇒ 準則要補一句:**「整體入鏡」的前提是主體只有一個**;
   多主體的照片在低預算節點上會碎,而碎法是元件數,不是面數。

### 5ag-e. 驗收

`intake_parts` **245**(chimney_a 216 ≤ 222;外廓三條與舊版逐位元相同)/ `mesh_sym --gate`
名冊 16 → **15 顆**(chimney_a 退出)/ `audit_siteplan` **197**(`--break-mass` 3 紅)/
`audit_beacons` 68(`--break-extent` 1 紅)/ `object_joints --seeds 8` **21611 接合 0 異常** /
`world_height` 49 / `cel` 52 / `visual_prefs` 124 / `gpu` 54 / `soft_stroke` 73 /
`npm test` 全綠(fresh server :8672)/ `npm run bal` 全綠 /
3D 對照台 **0 缺件 0 孤兒 0 未記載**(chimney_a 那一列已拆出獨立帳,method `trellis2_spz`、
含 `gen.out`)。`parts_manifest` 由 30 → 31 列(ac_a 與 chimney_a **拆列**,同 §5t 的 mesa_a)。

⚠ §5ad-h 記的副作用如期出現:`--base` 重新匯入匯出 `building.glb` 會依 UV 接縫重拆 `mass_a`
的頂點。形狀 / 面數 / 外廓 / UV 對應全部不變。

### 5ag-f. 未做

1. **`rock/hoodoo_a` 仍待重生成 —— 但要走 2GP(WSL2),不是 T2**(理由見 5ag-c)。
   語料建議用 `ov_929bc3d9`(乾淨單體)而不是出貨版那張糊掉的。
2. **mass_c** 與 chimney 那一列的語料補抓(§5af-g 第 2、4 條原封不動)。
3. 真人在遊戲裡看一眼新煙囪(離線黏土與 intake 都過了,但屋頂配件在對局距離長什麼樣沒看過)。

## 5ah. Trial log (2026-08-09, 3060-machine session — `hoodoo_a` 終於換掉:**語料與後處理要一起換**;同輪落地使用者的兩條選片/配比定案)

> 使用者:「繼續 ai3d_runbook.md」⇒ §5ag-f 第 1 條(掛了三輪的 `rock/hoodoo_a` 重生成)。
> 中途使用者追加兩條定案:「**挑選的照片盡可能乾淨,只有目標物件無其他物件,且光源充足**」
> 與「**建築照片 50% 一般市區、25% 鄉村或觀光旅宿、25% 功能型(寺廟/教堂/醫院/車站/學校/
> 博物館/公家機構)**」。

### 5ah-a. 先把「重生成」這個處方拆開:出問題的**不只是**那張照片

§5ad-f 記的病灶是「這顆網格本身不是流形(焊完 V=139 / F=382,閉合流形應為 193)⇒ 鏡像刀
把面數打成 128/96」,處方是「重生成」。本輪第一件事是去看**原始輸出**還在不在 ——
`~/ai3d/out_hy/wc_112762573_raw.glb` 還在,而它的讀數是:

```
213,682 面 / 106,789 點 / 開放邊 0 / 元件 1 / watertight True
```

**2GP 的原生輸出一直都是水密的**。非流形是**後處理**做出來的:出貨那顆走的是
`hy3dgen FaceReducer(pymeshlab quadric)213,682 → 560` + Blender `560 → 382`,
而 quadric 在 380:1 這種比例上會把邊塌成非流形。⇒ 這一條的正解不是(只是)換照片,
是**把後處理換成 §5o/§5t 之後才有的那條路**:`solidify_parts.py --mode resample`
(體積重採樣 → quadric)。實測同一顆 raw:

| 後處理 | 面 | 焊點 | 開放邊 | 元件 | 水密 | kf_p95 |
|---|---|---|---|---|---|---|
| 舊(FaceReducer + Blender)| 382 | **139** | 0 | 1 | — | 未量 |
| 新(solidify c192/o0.004)| 382 | **192** | 0 | 1 | **True** | 1.01% |

閉合流形的理論值是 `F/2 + 2 = 193`。**這是一條會靜默傳染的路**:凡是走舊兩段式
quadric 出貨的節點都有同樣風險,而 `mesh_sym` 的「邊界邊 0」對它完全無感
(非流形不是破洞)—— 只有真的去動刀才會現形。現役 `hunyuan_2gp` 只有這一顆。

### 5ah-b. 但**只換後處理不夠** —— 黏土說話

換完後處理的那一顆:asymZ 0.167 → **0.189**、asymX 0.018 → **0.126**(兩軸都跨過
`EMPTY_ASYM`),而四面黏土上仍是 §5ag-a 講的那個東西:**一坨大團塊頂著一根小角**。
原因寫在照片上(§5ag-a 已記):`wc_112762573` 的主體只佔畫面約 15%,而 2GP 忠實地把
**底下那面崖壁**一起生了出來。

於是把 §5ag-c 的建議真的執行掉:**同一階(2GP),換語料**。`ov_929bc3d9`(Kent G. Budge,
CC0)原圖是三顆蘑菇岩 + 電線桿的坡地照 —— 髒,但**去背之後只剩一顆**(main 0.984)。
61.6s / torch 峰值 2,524 MiB(與 §5m 逐位元同一組讀數),raw 225,518 面 watertight 單元件。

| | 面 | 焊點 | 開放邊 | 元件 | 水密 | asymX / asymZ |
|---|---|---|---|---|---|---|
| 舊(出貨版)| 382 | 139 | 0 | 1 | — | 0.018 / 0.167 |
| 新語料 + 新後處理 | 382 | **193** | 0 | 1 | **True** | 0.159 / 0.028 |

**焊點恰好 193 = 閉合流形的理論值。** 黏土四面是一根**層理石柱頂著過寬帽岩、底下一圈裙狀
基座** —— 正是消費端 `synthMegalith` 那一行註解寫的「風化蘑菇岩群:細腰石柱頂著過寬帽岩」。
舊版是「團塊 + 角」,新版是蘑菇岩。

**外廓與面數逐位元相同**(水平徑向 0.950 / 縱向 ±0.950 / 382 面)⇒ 消費端的
`scale(r×1.5, h×0.55, r×1.5)` 與 `RX/RZ` 碰撞語意一格不動,純粹同名取代。

⚠ **`--node` 的目標欄 MUST 維持非等向 `1x1`**:中途一度寫成等比(`1`),外廓當場變成
徑向 0.5997 / 縱向 0.950 —— 契約仍過(下界是包絡的一半),但消費端的碰撞半徑吃的是
`r*1.5`(= 節點徑向 1.0 的位置)⇒ 整柱會比碰撞柱細 37%,而**所有離線閘門全綠**。
`1x1` 是「兩軸各自拉滿 ico(1) 包絡」,舊版就是這麼縮的。

### 5ah-c. 鏡像刀:這次**跑得動了**,而它的結果**該退**

§5ad-f 說 hoodoo_a「兩把刀都撐不住」。網格變流形之後,`union` 刀在**第一顆候選**
(舊語料 + 新後處理)上跑得乾乾淨淨:`382 → 374 面 / 邊界邊 0 → 0 / 元件 1 → 1 / 外廓逐位元還原`
—— 三道閘全過(對比 §5ad-f 的 382 → 128)。**所以那道閘從頭到尾沒有錯,它擋的是上游的爛網格。**

但黏土否決了它:z 軸聯集把**頸部**做成兩根叉開的柱子中間一個洞(第 2、4 個視角看得最清楚)。
而頸部正是 hoodoo 的辨識特徵。第二顆候選(新語料)更直接 —— `auto` 選 x 軸(0.159),
union **元件 1 → 3**、half **元件 1 → 2**,兩把刀都被 §5ad-d 的閘當場擋下。

⇒ **hoodoo_a 出貨不做鏡像貼補**,它會留在 `mesh_sym --gate` 的名單上(x 0.159)。
那個 0.159 不是「空的一面」,是**石柱本身歪 + 帽岩偏心**的天然形狀。這是這一族第一次
出現「刀能跑、閘也過、但形狀退步」與「刀跑不動」分屬兩回事的案例;§5ad-f 的那一行
(「兩把刀都撐不住 ⇒ 該重生成」)**因果講反了**:撐不住的原因在網格,而該重生成的原因在照片。

### 5ah-d. 使用者定案 ①:選片標準 = 乾淨單一主體 + 光源充足

落點是**兩支工具各一半**,而且要講清楚哪一半在哪裡:

- `fetch_photos.mjs`(下載**之前**):能驗的只有授權與尺寸;**唯一能影響「乾淨/單一主體」的
  旋鈕是查詢用字**(skill §2 量過的最大槓桿)⇒ 檔頭改寫成使用者這句話,規則仍是「具名單一主體」。
- `screen_mattes.py`(去背**之後**):「畫面裡有幾個東西」「光夠不夠」要看 matte 才量得到
  ⇒ 新增兩桶,門檻拿**已經出貨的 25 張來源**當真品名單校準(F0 那份人眼名單住在已被刪掉的
  worktree,而「出貨過」是更硬的標籤):

| 桶 | 判據 | 已出貨的極值 | 定案門檻 | 淘汰 |
|---|---|---|---|---|
| ④ 多主體 | matte 最大連通元件**面積**佔比 `main` | 最低 0.778 | `< 0.70` | 28 / 244 |
| ⑤ 光源不足 | 主體平均亮度 `lum` **且** 暗部佔比 `dark` | lum 43.5 / dark 0.632 | `lum < 35 ∧ dark ≥ 0.70` | 13 / 244 |

兩桶**零誤殺**。反向掃描把邊界量出來了:`MULTI_MAIN` 一調到 0.778 就開始誤殺
(landmark/tank `ov_6d02b9e0` —— 桁架水塔的腿會被切成好幾塊,那是**一個**主體的碎片);
`LUM_MIN 50 / DARK_FRAC 0.60` 開始誤殺 `wc_133471453`(暗色針葉)。

三個設計決定:
1. **量在 matte 不是照片上**。本輪的贏家 `ov_929bc3d9` 原圖有三顆蘑菇岩加電線桿,去背只剩一顆
   ⇒ **照片髒不等於輸入髒**。反過來也成立(§5ag-b 的三連煙囪:照片乾淨,而三個主體在 222 面的
   預算下碎成 6 元件)。
2. **取面積佔比不取塊數**。已出貨的水塔有 4 塊(腿),而「三顆蘑菇岩」是 0.35 —— 數塊數把兩者
   判成同一類,面積佔比分得開。
3. **統計分不開的一帶不淘汰,進觀察名單 sheet**(`*_screen_watch.png`,格子標上 main/lum/fill/cov)。
   本輪的實例:熱氣球那張 `main 0.760` vs 已出貨水塔 `0.778` —— 把門檻收到 0.77 去「剛好」抓到
   熱氣球就是拿兩個樣本過擬合。**人眼那一步不是懶惰,是這裡真的沒有便宜的統計特徵**(檔頭原有的
   doctrine,本輪第二次兌現)。

### 5ah-e. 順手撞到的:**既有的兩道閘是「樹形狀」的**,套到別族會吃掉真品

把選片閘第一次跑遍四族(F0 只跑過 tree)就出事:

| 閘 | 為什麼是樹形狀 | 套到別族的誤殺 |
|---|---|---|
| ① `BLANK_COV = 0.05`(畫布覆蓋率)| 樹是密實團塊 | landmark/tank `ov_6d02b9e0` 0.024・`ov_15922084` 0.092・rock/mg_tower `ov_163a0902` 0.034(**魔鬼塔那顆**)|
| ② `PRINT_FILL = 0.85`(bbox 填滿率 = 「主體是一張紙」)| 前提是主體留得下輪廓縫,而**建物就是個方盒** | building/roofcap `ov_f18913fc` 0.909 |

⇒ 兩條收成 `TREE_CAL_FAMS`(只在校準過的族當淘汰線);② 另給別族一條實測校準的
`PRINT_FILL_OTHER = 0.93`(建物已出貨最高 0.909,零誤殺)。**MUST NOT 直接放棄那兩條** ——
它們抓的東西在別族一樣存在(1932 年畢業紀念冊封面 fill 0.854、舊 hoodoo 那張 cov 0.016)
⇒ 在非校準族**降級成觀察線**,人眼看得到而不是被統計悄悄吃掉、也不是悄悄放過。
tree 族的三桶讀數 **27 / 10 / 3 與 F0 逐位元相同**(那三條一格沒動)。

⚠ 留一筆**未解**:tree/canopy `ov_71b76588` 是已出貨來源,而它的 matte cov = **0.001**
(幾乎全空)⇒ 被 tree 自己那條 ① 淘汰。F0 的校準基準是「人眼判可用的 16 張」、本輪是
「出貨過的 25 張」,兩份標籤在這一張上不一致。**刻意不動 `BLANK_COV`**(不為一個反例
放寬一條校準過的門檻);要嘛那顆節點當初不是用這張 matte 生的,要嘛 matte 後來重生過 ——
下一輪碰 tree 族時查。

### 5ah-f. 使用者定案 ②:建築語料 50 / 25 / 25

配比只約束**整棟建物**(新的 `grp` 欄),窗格/簷口/冷氣機/屋頂水塔那些是**零件**不是建物 ——
把它們算進分母,50% 就會隨「這一輪加了幾個零件列」浮動,而那與使用者說的那句話無關。

| 組 | 列 | 配額 |
|---|---|---|
| `urban` 一般市區 | tower 9・office 6・apartment 6・corner 5・rowhouse 5・shophouse 4・warehouse 5 | **40 / 80 = 50.0%** |
| `rural` 鄉村或觀光旅宿 | inn 3・barn 2・windmill 2・chalet 2・minka 2・hanok 2・medit 2・stonecottage 2・halftimber 1・adobe 1・yurt 1 | **20 / 80 = 25.0%** |
| `civic` 功能型 | temple 3・church 3・station 3・school 3・museum 2・civic 2・hospital 2・pagoda 1・lighthouse 1 | **20 / 80 = 25.0%** |

新增 12 列(office/apartment/corner/inn/temple/station/school/museum/civic/hospital + 既有列重分組),
舊的區域風格列**一列都沒刪**,只把 `want` 降下來 —— 刪列會讓已經抓到的照片變成沒人認領的孤兒,
而降 `want` 只是「不再補」(第 6 輪的跨國風格廣度因此原樣保留)。

**配比是驗出來的不是註解**:`buildingMix()` 逐列現算,`--plan` 印「目標 vs 現有」兩欄,
`buildingMixDrift()` 在每次抓取**之前**擋下偏離(反向驗證:把 `bld_tower.want` 改成 30 ⇒
`urban 60.4%` 紅字)。手寫在註解裡的比例會在下一次有人改某一列時**靜默過期**(同 §5ae-e
那兩份手寫清單),而照片是有配額成本的。

改制前(選片閘跑過四族之後的**可用**張數):`urban 6/42 = 14.3%`・`rural 26/42 = 61.9%`・
`civic 10/42 = 23.8%` —— 一般市區缺口 34 張,正是這條定案要補的那一塊。
補抓分九輪跑完(第一輪 29 張後撞 `upload.wikimedia.org` 的 IP 級 429,之後八輪各 ~11 分鐘
冷卻、共再拿 21 張)⇒ **`urban 34/81 = 42.0%`・`rural 29/81 = 35.8%`・`civic 18/81 = 22.2%`**
(起點是 14.3 / 61.9 / 23.8)。**這幾個數字算的是「下載成功」而不是「可用」** —— 新語料還沒
matte、還沒過 ④⑤ 兩桶,那一步才會把分母修回真話(§5ah-i 第 1、2 條)。

**還缺的逐列**(2026-08-09 收尾;`bld_drawing` 那一列將依 §5aj-A 拆成逐類別的設計圖列):
urban `shophouse 1/4`・`rowhouse 3/5`・`corner 4/5`;
civic `school 0/3`・`museum 0/2`・`station 1/3`・`hospital 1/2`;
rural `inn 1/3`。合計約 **14 張**,重跑同指令續補即可。
rural 之所以仍高於 25%,是**既有存量**(barn/stonecottage/pagoda 等列現值已高於新的 `want`)——
`want` 降下來只表示「不再補」,不會把已抓的照片丟掉;urban / civic 補滿之後比例自然收斂。

### 5ah-g. 資料家改成參數(`--home`)

`fetch_photos.mjs` 與 `screen_mattes.py` 都把「資料家」綁在腳本自己的目錄上,而 §5af-g 已經
記過一次代價:一個 worktree 被刪掉,305 筆 superset 跟著沒了。兩支各加一個 `--home <資料家>`
(不給 = 舊行為逐位元不變);帳本的相對路徑基準同步改吃 `HOME`(否則一給 `--home` 就會寫進
`../../…` 這種跨 worktree 的路徑)。

### 5ah-h. 驗收

`intake_parts` **245**(hoodoo_a 382 ≤ 430;外廓三條與舊版逐位元相同)/ `mesh_sym --gate`
名單 15 顆(hoodoo_a 仍在,軸由 z 改 x)/ `audit_siteplan` **197**(`--break-shy` 3 紅)/
`audit_beacons` 68(`--break-extent` 1 紅)/ `object_joints --seeds 8` **21611 接合 0 異常** /
`world_height` 49 / `cel` 52 / `visual_prefs` 124 / `gpu` 54 / `soft_stroke` 73 /
`npm test` **584 綠**(fresh server :8674;⚠ 埠不是 `PORT=` 而是 `WS_URL=ws://localhost:<port>`)/
`npm run bal` 全綠(⑦f 1.78×、交付率 89.2 / 92.0 / 51.8 —— 與 §5af/§5ag 逐項相同)。

**反向驗證**:選片閘 `MULTI_MAIN` 掃 0.60 / 0.70 / 0.778 / 0.80 / 0.90 ⇒ 0.778 起開始誤殺
已出貨來源;`LUM_MIN/DARK_FRAC` 掃 (35,0.70) / (45,0.70) / (50,0.60) ⇒ 最後一組起誤殺;
配比 `bld_tower.want = 30` ⇒ `buildingMixDrift` 紅字。

### 5ah-i. 未做

1. **建築語料只補到一半,而卡住的是「下載主機」不是「語料池」** —— 這一條量過了,別重新診斷:
   第一輪 29 張(`urban 14.3% → 33.3%`),之後三輪冷卻只再拿到 **1 / 0 / 1** 張,
   輸出裡滿版都是 `Commons 失敗(…):HTTP 429`,很容易讀成「CC0 沒料了 ⇒ 該改查詢用字」。
   **不是。** 直接打 Openverse 查(唯讀、不下載)量到的**未收且短邊 ≥1024** 的候選:

   | 查詢 | 未收 ≥1024 | | 查詢 | 未收 ≥1024 |
   |---|---|---|---|---|
   | `railway station building` | **18** | | `brick townhouse facade` | **10** |
   | `city hall building` | **18** | | `country inn building` | **8** |
   | `residential apartment block` | **8** | | `buddhist temple building` | **6** |
   | `curtain wall office building` | 5 | | `corner commercial building` | 3 |

   ⇒ 供給充足,綁住的是 `upload.wikimedia.org` 的 IP 級下載窗(大多數 Openverse CC0 命中
   都託管在那裡)。**症狀會誤導**:候選被 `hostCool` 跳過 ⇒ 該列當輪視同沒料 ⇒ 退到 Commons ⇒
   印出來的是一整排 Commons 429,而**真正的瓶頸從頭到尾是下載那一步**。
   對策只有「時間」:同指令每 ~11 分鐘重跑一輪,urban 還缺 17 張 ≈ 1~1.5 小時的無人值守滴流
   (`node tools/ai3d/fetch_photos.mjs --home <資料家> --family building --limit 40`)。
   **MUST NOT** 因為看到那排 429 就去放寬 CC0 / 1024px 兩道硬閘,或急著改查詢用字。
2. **新語料一張都還沒 matte**(新增 12 列 + 補抓的 29 張)⇒ ④⑤ 兩桶還沒看過它們,
   `--plan` 那兩欄現在算的是「下載成功」不是「可用」。順序是
   `matte_photos.py building` → `screen_mattes.py --home … --family building --sheet` → 看 watch sheet。
3. `mass_c`(§5af-g 第 2 條原封不動);新的 `bld_office`/`bld_apartment`/`bld_corner` 三列
   正是它的語料來源 ⇒ 兩件事現在合流了。
4. **`ov_71b76588` 的 cov 0.001 之謎**(§5ah-e 末)。
5. 真人在遊戲裡走到蘑菇岩旁邊繞一圈(本輪的「看」仍是離線黏土四面 + 讀數)。
6. `audit_traverse`(㋓ 需網路;**理由上不受影響** —— 巨岩碰撞與佈局算式 MUST NOT 讀庫幾何,
   而外廓這一輪逐位元還原、`rnd()` 消耗不變)。

## 5ai. Trial log (2026-08-09, 3060-machine session — 設計圖 → 3D:**這一段不是模型,是幾何**)

> 使用者:「**建築部分也加入設計圖轉 3D 的功能,轉 3D 時只要處理外層表面就好**」。

### 5ai-a. 為什麼它不該是「再接一個 img→3D 模型」

照片給的是「一個視角 + 明暗線索」,深度得**猜** —— §5ag-c 的 hoodoo 就是猜不出厚度而塌成
薄板,而讀數(0 開放邊 / 單元件 / kf_p95 0.98%)全綠。**設計圖給的是正投影的精確輪廓**:
立面 = 正面剪影、平面 = 足跡、側視 = 側面剪影。兩個以上的正交剪影決定的視覺外殼是
**解出來的**:

```
逐視圖取外輪廓 → 多邊形 → 各自沿自己那一軸拉伸成稜柱 → 稜柱取交集 = 外殼
```

⇒ 新工具 `tools/ai3d/plan_to_mesh.py`,方法鍵 `plan_hull`。**零 GPU、零權重、零亂數、
離線可驗**,下游與 img→3D 完全共用(`normalize_parts` → `intake_parts`)。
階梯因此多一階、而且排在最前面:**`設計圖 → plan_hull` ≫ `T2-spz` ≫ `2GP` ≫ `SF3D` ≫ `procedural`
—— 有設計圖就別去猜。**

### 5ai-b. 「只要處理外層表面」是兩件事,而它們剛好同一個實作

㋐ **只取最外層那條輪廓線**:設計圖裡滿是內部線條(窗格、樓層線、隔間、填充網點、尺寸線)。
   作法 = 取輪廓 → **整片填實** ⇒ 窗戶不會變成幾何凹洞、樓層線不會變成溝槽(那些是貼圖的事,
   消費端的立面材質本來就在畫窗格)。這同時是**三角形預算的主要旋鈕**:不填實的話一張立面圖
   光是窗格就能生出上千個面,而 `mass` 那一桶的逐節點上限是 2,981。
㋑ **只有外殼,沒有室內**:視覺外殼天生就是閉合的外表面,樓板/隔間/中庭一概不生成。

**這條規則在三處各擋一次**(填實 / `RETR_EXTERNAL` / `prism` 只吃 `poly.exterior`),
而這件事是**被反向驗證逼出來的**:只拆前兩處,第三處會把洞再吃掉一次 ⇒ 窗戶版仍然是
12 面盒 ⇒ **反向驗證假綠**。`--break-outer` 因此 MUST 三處一起拆(拆完紅 9 條)。

### 5ai-c. 三個「不會報錯只會給爛結果」的地方,全部量過

| # | 坑 | 症狀 | 對策 |
|---|---|---|---|
| ① | **每一張真的設計圖都有圖框** | 最直覺的寫法(從畫布邊界泛洪、淹不到的算實體)會被圖框整個框住 ⇒ 量到的外廓是**那張紙**不是那棟樓(合成實測寬度 0.6678 → **0.7366**,而網格看起來完全正常)| 改成「挑輪廓」:圖框只是另一個候選,`FRAME_MAX = 0.70` 淘汰它 —— 但**只有還剩得下候選時才淘汰**(建築佔滿整張紙是合法的)|
| ② | **渲染圖不是線稿** | 水彩/鉛筆渲染圖的墨是**調子**不是輪廓 ⇒ 門檻把陰影一起吃進來、剪影邊緣碎掉、亮處變成洞(實測那張穹頂教堂的玫瑰窗變成一個貫穿的洞)| 輪廓**內**的墨密度:CC0 六張實測 **HABS 測繪線稿 11.4% / 四張渲染圖 32~71%** ⇒ `LINEART_INK = 0.25` 硬擋 + `--allow-render` 顯式覆寫 |
| ③ | **輪廓有缺口** | 結果是**空網格**而不是錯網格 | `SOLID_MIN` 報錯並指向 `--close`;**順序 MUST 是「先驗缺口再驗渲染圖」** —— 反過來的話一條斷線的遮罩就是那條線本身、墨密度 100%,會報成「這是渲染圖」把人指到錯的方向 |

### 5ai-d. 實測:一張真的 HABS 測繪圖

`ov_dc769773`(Tudor Place 南立面測繪圖,CC0,7484×6000):圖框與標題欄被剔掉、
窗與線腳被填實、煙囪與山牆保留 ⇒ **160 面 / 82 點 / 單元件 / watertight**、輪廓 40 點、
墨密度 13.3%。遮罩圖(`--debug`)是一條乾淨的建築剪影。

⚠ 一個小殘留:圖上的**地坪線**與建築輪廓相連 ⇒ 剪影底部帶一條薄裙。對 massing 節點影響很小
(正規化會收進單位包絡),沒有為它加旋鈕 —— 加一個 `--crop-bottom` 只是把判斷交給手感。

### 5ai-e. **本輪零節點出貨,而理由是形狀不是品質**

管線通了,但 CC0 語料裡唯一那張乾淨線稿是**兩層樓的寬矮宅邸**(寬高比 3.6:1),
而目前唯一吃「整棟量體」的桶是 `BLD_LIB.mass` —— 它服務的是 **`b.h > 55m` 的商辦塔樓**,
而 `normalize_parts` 的非等向 fit 會把各軸**各自**拉滿包絡 ⇒ 一棟寬矮宅邸會被拉成一根
帶山牆與煙囪的高塔。**與其塞一顆形狀不對的進去,不如把缺口寫清楚**(同 §5ag-c 判退 hoodoo
的同一條:讀數不能替形狀背書)。要出貨需要的是**塔樓的立面測繪圖**,不是更多渲染圖。

順帶一提,`bld_drawing` 這一列**刻意不帶 `grp`**:設計圖是**輸入格式**不是建物類別,
進了分母就把使用者的 50/25/25 稀釋掉了。要不要讓設計圖也照類型配比,是使用者的決定。

### 5ai-f. 驗收

`audit_plan_mesh.py` **21 項全綠**(Ⅰ 只取外層表面 / Ⅱ 無室內幾何(體積 = 凸包、尤拉數 = 2)/
Ⅲ 圖框剔除 / Ⅳ 視覺外殼(退縮立面 × 方平面,高寬深逐項對上像素比)/ Ⅴ 單視圖深度是假設且
會講出來 / Ⅵ 決定性 + 解析度無關 / Ⅶ 缺口報錯 / Ⅶ-b 渲染圖被擋且線稿不被誤擋)。
**反向驗證**:`--break-outer` ⇒ **9 條紅**(12 面盒變 32 面、體積 0.008 vs 0.243、尤拉數 0);
`--break-frame` ⇒ 1 條紅。
遊戲程式碼一行未動 ⇒ `npm test` / `npm run bal` / 全套地物稽核**結構上不受影響**(本輪未重跑)。

### 5ai-g. 使用者條件:「跟開源工具差不多就繼續使用」⇒ **量了**

使用者問「設計圖是另外找開源設計圖?使用設計圖轉 3D 的開源工具嗎?」,並定條件:
外牆建模能力與開源工具相當就續用。答案分兩半:**圖是另外找的 CC0 開源圖**(走同一支
`fetch_photos.mjs`、同一道授權硬閘,新列 `bld_drawing`,6 張全 cc0);**轉檔工具是自己寫的**
(約 200 行,底下是 OpenCV / shapely / trimesh / manifold3d 這些開源函式庫)。

**先確認有沒有現成的可用**(2026-08-09 查):這一格**沒有**對位的開源工具 ——
`FloorplanToBlender3d`(最常被引用的那一支)吃的是**平面圖**、產的是**室內**牆與房間;
`3dfier` 吃 GIS 多邊形 + 點雲產 LOD1 擠出;`FloorNet`/`CubiCasa` 是平面圖向量化(仍是室內)。
**它們解的是「室內重建」,正好是使用者那句「只要處理外層表面」的反面。**

⇒ 對照組改成**通用演算法**而不是某個產品:`voxel visual hull + marching cubes`
(`skimage.measure.marching_cubes`,柵格類管線的標準路)與 `bbox 擠出`(下界)。
尺 = **剪影 IoU**,真值是**設計圖自己**(單視圖 = 該圖剪影;雙視圖 = 各剪影互相裁切後 —— 
視覺外殼的定義)。三者**同一張輸入、同一個三角形預算(≤2,981 = mass 桶逐節點上限)**。

| 案例 | 方法 | 面(≤預算) | 剪影 IoU | 水密 |
|---|---|---|---|---|
| 真圖 HABS 南立面(單視圖)| bbox | 12 | 0.5899 | ✔ |
| | voxel + MC | 2,980 ← 259,924 | 0.7487 | **✘** |
| | **ours** | **160** | **0.9209** | ✔ |
| 合成 退縮立面 × 方平面(雙視圖)| bbox | 12 | 0.8472 | ✔ |
| | voxel + MC | 2,980 ← 123,176 | 0.7456 | ✔ |
| | **ours** | **20** | **0.9935** | ✔ |

**不是差不多,是好一個級距,而且理由是結構性的不是巧思**:建築輪廓是分段直線,多邊形稜柱
**逐段重現**它;marching cubes 把每一個角都磨圓,而且要從十幾萬面減到遊戲預算內、又磨一次
(減完還掉了水密)。面數差 18~150 倍。⇒ 條件成立,**續用自寫的那一支**。

⚠ 誠實的邊界:①`voxel + MC` 是**我實作的通用演算法**,不是某個現成產品的跑分;
②單視圖的「深度」三者都是假設,這把尺**刻意不量它**;③解析度/減面策略調得更好,
voxel 路還有進步空間,但「圓角 + 高面數」是它的本質。

**這個對照本身踩了三次坑,每一次都給出「看起來合理但排名相反」的結果**,值得記著:
①`cv2.fillPoly` 一次丟一整批三角形會走**偶奇規則**,相鄰三角形互相抵消 ⇒ 量到的是描邊
不是面積(一顆盒子只填到 1.2%);②參考遮罩**多翻了一次 y** ⇒ 拿倒過來的樓比正的,
而**外接盒因為上下對稱反而分數最高**(0.5847 > ours 0.4317)—— 排名整個反過來;
③改用 3D IoU 時兩邊的框不同(參考是拉伸填滿立方體、候選是等比置中)⇒ 量到的是
「誰對深度做了假設」,單視圖那格 voxel 0.8052 > ours 0.4392,同樣是反的。
**三次都不會報錯。** 最後定案的尺之所以可信,是因為它的真值是輸入本身、上界是 1.0。

### 5ai-h. 未做

1. **塔樓立面測繪圖**(見 5ai-e)—— 有了才出得了第一顆 `plan_hull` 節點。
2. **多視圖那條路還沒吃過真圖**:合成測試涵蓋 front × plan,但真實 HABS 圖組的立面/平面
   是**分開的檔案且比例尺不同** ⇒ 對位規則(現在是「以 front 的高當 1.0」)還沒被真圖考驗過。
3. 低矮建物目前沒有任何「整棟量體」的消費端桶(只有 >55m 那一個)—— 要用寬矮宅邸這類語料,
   得先決定要不要開第二個桶。
4. 對照用的 `bench_hull.py` 只跑過這一次,**沒有進儲存庫**(絕對路徑、一次性的工具選型決定)。
   復現方式寫在 §5ai-g:三條路 + 剪影 IoU + 同一個三角形預算。再用到第二次就照
   「reused 就 promote」升格(同 `photo_sheet.mjs`/`mesh_sheet.mjs` 的來歷)。

## 5aj. ⭐ 下一輪的執行清單(2026-08-09 使用者定案三條;**本節就是交接狀態,從這裡開始**)

> 使用者對 §5ai-h 的三個待決問題逐一回覆:
> ①「**設計圖 + 照片總比例滿足 50 + 25 + 25 即可**」
> ②「**開**」(低矮建物的第二個「整棟量體」桶)
> ③「**只補有洞的,洞很小的話直接貼平,不需要用對稱法補**」
> 三條**都還沒實作**,本節是給下一輪照著做的規格。

### 5aj-A. 配比改成「設計圖 + 照片」合計 50/25/25

**現況**:`bld_drawing` 是單獨一列、**不帶 `grp`**、不進配比(§5ai-e 當時的理由是「輸入格式
不是建物類別」)。使用者定案推翻它:**分母含設計圖**。

**做法**(`tools/ai3d/fetch_photos.mjs`):

1. 欄位拆成**兩個正交的維度** —— `grp`(建物**類別**:urban / rural / civic,**唯一**決定配比)
   與新的 `src`(輸入**格式**:`'photo'` 預設 / `'drawing'`,決定走哪一條轉換路)。
   MUST NOT 把格式塞進 `grp`,那會讓「設計圖」變成第四個類別、50/25/25 當場算不出來。
2. `bld_drawing` 退場,改成**逐類別的設計圖列**(例:`dwg_tower` grp urban、`dwg_civic` grp civic、
   `dwg_house` grp rural),每列 `src: 'drawing'`、查詢仍走測繪圖專名(`HABS measured drawing`
   一類;泛稱的 `architectural drawing` 會撈回柱頭大樣與室內裝飾)。
3. `buildingMix()` **只看 `grp`**(現在的實作已經是這樣,所以這一步其實是「把 `grp` 補上」而不是
   改公式);群組總額維持 40 / 20 / 20 的比例,**組內**照片與設計圖各佔多少由這一輪決定並寫進註解。
4. `--plan` 多印一列 `src` 拆帳(每組各有幾張是設計圖)—— 沒有這一列,「配比對了」會蓋掉
   「這一組全是設計圖、一張照片都沒有」。

**⚠ 設計圖 MUST NOT 走照片的選片閘**:`matte_photos.py` / `screen_mattes.py` 的 ④⑤ 門檻是拿
**照片**校準的(主體面積佔比、亮度),線稿的統計完全是另一個分布,而且設計圖**根本不需要去背**
(`plan_to_mesh` 直接吃原圖)。設計圖的品質閘是 `plan_to_mesh` 自己那三道(`LINEART_INK` 擋渲染圖 /
`SOLID_MIN` 擋斷線 / `FRAME_MAX` 剔圖框)。**建議**:給 `plan_to_mesh.py` 加一個 `--screen <目錄>`
模式,把那三道跑遍設計圖語料並回寫 `entry.screen`,語意與 `screen_mattes.py` 對齊
(`have()` 才算得到「可用張數」而不是「下載成功張數」)。

### 5aj-B. 開第二個「整棟量體」桶(低矮建物)

**為什麼要開**:現在唯一吃整棟量體的桶是 `BLD_LIB.mass`,而它服務 `b.commercial && b.h > MASS.MIN_H`
(55m)。⇒ **rural / civic 那兩組語料就算抓齊了也沒有消費端**,設計圖那條路的第一顆節點也卡在這裡
(§5ai-e:唯一乾淨線稿是寬高比 3.6:1 的兩層宅邸,硬塞進塔樓桶會被非等向 fit 拉成帶山牆的高塔)。

**規格 MUST 照 §5aa 那一套推導,不可手寫**:

1. **先量再開**(§5aa-b 的紀律):`node tools/ai3d/measure_building_tris.mjs --live --osm-cache`
   量新桶的 instance 上界與桶總量(四個最密市區場地取最大)。
2. `pick_n` 取兩條約束的較嚴者:細節下限(逐節點 cap ≥ 2 × 500)與 draw call
   (額外 mesh ≤ 立面段現行的 16);`node_cap = 3 × 桶總量 ÷ pick_n`。
3. 選擇規則是**純函式、零 `rnd()`**、等高以座標定序(靠 sort 穩定性 = 跨客戶端分家)。
4. **名冊或庫取不到 ⇒ 一棟都不挑 ⇒ 逐位元同舊制**(保險絲)。
5. 碰撞/LOS 有向盒**一格不動**(A30);逐實例色抖仍吃拆桶前的原始序 `t.ord`。
6. 挑中的那幾棟純視覺附件推丟棄桶(`vis()`,只換目的地、`rnd()` 照抽),而**帶碰撞柱的兩件
   MUST NOT 進丟棄桶**。
7. 材質由呼叫端傳 ⇒ 節點 MUST 帶盒投影 UV(`normalize_parts.py --boxuv`)。
8. `pick_n` / 高度門檻在 `biomes.js` 與 `tri_budget.json` 是**同一份值**(稽核釘住相等)。
9. **逐位元不變用量的**:`measure_building_tris.mjs --live --osm-cache` 錄播 Overpass 後 A/B
   (同一張圖兩次 `--live` 差到 ±70%,各抓各的圖資量到的全是圖資差異)。

**連帶**:`audit_siteplan.mjs` 要多一組斷言 + 反向旗標(比照 `--break-mass`);
CLAUDE.md「建物零件庫消費端」那一列要補上第二個桶(名冊 ≥2 顆的規則同樣適用 —— 只有一顆時
同一張圖上挑中的那幾棟是同一個剪影)。**`audit_traverse`(㋓)**:swap 幾何零 `rnd()` 消耗 ⇒
理由上不影響佈局,但這一輪動到 `vis()` 的分流,**確認 `rnd()` 枚數不變之後**才可以省。

### 5aj-C. 鏡像貼補改成「只補有洞的;洞很小直接貼平」

**這一條推翻的是 §5ad 的觸發條件本身。** 現制的閘是 `EMPTY_ASYM = 0.12`,量的是**半空間面積
不對稱**(「沒被拍到的那半是空的」),而**那不是洞**。使用者定案把觸發條件換成**真的有洞**,
並依洞的大小分兩種補法。

**現況數據(執行 `node tools/ai3d/mesh_sym.mjs --gate` 即得,2026-08-09 出貨值)**:

| 開放邊 | 節點 |
|---|---|
| 0 | hoodoo_a・mega_a・mega_b・mega_c・collapse_a・tower_a・chimney_a・mass_b |
| 8 / 15 | facet_a・mass_a |
| 64 | facet_b |
| 167~274 | ac_a 167・mesa_a 179・mega_d 221・mega_e 264・mega_f 274 |

⚠ **最重要的一筆**:§5ad 那四顆被鏡射的節點裡,`collapse_a` 與 `mega_c` **現在的開放邊是 0**
—— 它們**本來就沒有洞**,鏡射補的是「空的那一面」;而 `mega_d` 鏡射前 246、鏡射後 **221**
(`facet_a` 4 → 8)⇒ **那把刀從頭到尾沒有關上任何一個洞**,它做的是另一件事。
使用者這一條等於把兩件事分開,而數據支持它。

**做法**:

1. **觸發條件換成洞**:`mesh_sym --gate` 的名單改以**邊界迴圈**(boundary loop)為準,不再以
   `EMPTY_ASYM` 為準。`EMPTY_ASYM` 保留為一個**印出來的欄位**(它仍是有用的診斷),但不再驅動動刀。
2. **洞的大小要有尺,而且 MUST 校準不可手寫**:建議量「該迴圈圍出的面積 ÷ 該節點總表面積」
   (與 `mesh_sym` 既有的面積語彙同一把尺),掃過全部 46 顆節點取分布再定門檻,
   紀律同 §5ah-d(拿已出貨節點當硬約束、把「從哪個值開始誤判」記下來)。
3. **小洞 → 直接貼平**(planar cap:沿邊界迴圈補一個平面蓋)。這是使用者指定的作法,
   而且比鏡射便宜得多、不會動到外廓、不產生對稱凹槽。
4. **大洞 → 才考慮鏡射**(沿用 §5ad 的 `--rework`,三道閘不變:面數 ≥0.8×、鬆散元件不增、
   邊界邊 ≤ +5% 面數;`half` 給人造物 / `union` 給圓渾岩體;有破口的節點 warp MUST 0)。
5. **回退那三顆「交換」節點**:`collapse_a` / `mega_c`(0 洞)MUST 回到鏡射前;
   `facet_a`(8 條)改走貼平。回退方式 = 從 §5ad 之前的 `rock.glb` 基準重跑,**不是**再動一次刀
   (工具是決定性的,重跑就回得去);⚠ `rock.glb` 之後又因 `hoodoo_a`(§5ah)動過一次,
   所以基準要**逐節點**取,不能整檔回滾。
6. **樹族 MUST 排除在「貼平」之外**:冠層的葉片本來就是**開放面片**(數百條邊界邊是設計,
   不是破口),把它們補平會變成實心團塊。範圍限定在實心主體(rock / building),
   或以「邊界邊佔面數比例」把「天生開放」的節點結構性地排除。
7. **文件**:CLAUDE.md §2.1 的「鏡像貼補」那一列與 §5 矩陣對應列 MUST 同步改寫 ——
   現在那一列寫的是「尺 = 半空間表面積不對稱、門檻 `EMPTY_ASYM` 錨在 mass_a 0.123」,
   這條定案之後那句話不再成立。A 編號不動(這是同一條規則的修訂,不是新規則)。

**驗收**:`intake_parts`(外廓與預算 MUST 逐位元不動)+ `node_sheet.mjs --ref <舊 glb>` 四面黏土
(這一族的錯只有截圖看得到)+ `audit_object_joints --seeds 8` + `audit_beacons` ± 反向 +
`audit_siteplan` ± 反向 + cel / visual_prefs / gpu / soft_stroke + `npm test` + `npm run bal`
(㋒ 地物幾何 ⇒ MUST 逐項不動)+ 3D 對照台 0-0-0 + **反向驗證**(拿一顆已知撐不住的節點跑鏡射,
三道閘 MUST 紅字)。

### 5aj-D. 建議的執行順序(有相依)

1. **先把 A 做完**(語料配比 + 設計圖列)—— 它最便宜,而且 B 的語料靠它。
2. **B**(第二個桶)—— 它解鎖 rural / civic / 設計圖三條語料的消費端,是目前最大的瓶頸。
3. **C**(貼平/鏡射改制)—— 與 A/B 完全獨立,可以任何時候插隊;它只動 `rock.glb`/`building.glb`。
4. 這三條都完成之後,才輪得到 §5ah-i / §5ai-h 上那些「材料到位就能做」的項目
   (mass_c、設計圖第一顆節點、真人冒煙、`audit_traverse`)。

## 5ak. Trial log (2026-08-09 第二場, 3060-machine session — §5aj-A 落地:**閘本身漏掉兩種假綠**)

> 做完的是 §5aj-A(配比含設計圖)。同一輪撞到兩件「讀數全綠而結果是錯的」——
> 一件在**判定**裡(碎屑當主體),一件在**取得**裡(整批語料下載不下來)。
> §5aj-B / §5aj-C **未動**。

### 5ak-a. `bld_drawing` 退場 → 逐類別三列;六張存量逐一人眼分類

欄位拆成正交兩維:`grp`(建物類別,**唯一**決定配比)× `src`('photo' 預設 / 'drawing')。
新列 `dwg_tower`(urban 4)・`dwg_house`(rural 2)・`dwg_civic`(civic 2)⇒ 目標
**44 / 22 / 22 = 50 / 25 / 25 整除**(不吃 `MIX_TOL` 的餘裕)。逐組設計圖配額取同一個比例
(~9%),壓得低的理由是 §5ai-e 的產出率,不是它不重要。

守門線補了一條:`src !== 'photo'` 而**沒有 `grp`** 直接 throw —— 那正是使用者這一輪推翻的
舊行為(設計圖靜默逃出分母)。`--plan` 另印**輸入格式拆帳**(逐組 photo/drawing 的目標→現有):
沒有那一列,「配比對了」會蓋掉「這一組全是設計圖、一張照片都沒有」。

存量那 6 張(+1 筆下載失敗)是**人眼**逐張看過再分類的 —— 分類寫在一次性遷移腳本裡,
**沒有進型錄**(型錄裡放名單就會在下一輪靜默過期):

| id | → | 是什麼 |
|---|---|---|
| `ov_dc769773` | dwg_civic | Tudor Place 南立面(HABS,**唯一乾淨線稿**);帕拉底奧主體 + 穹頂門廊 |
| `ov_c920cc83` | dwg_tower | 文藝復興 palazzo 立面 + 剖面(水彩渲染) |
| `ov_68a72a22` | dwg_civic | Bromley College 銅版畫(書頁掃描 + 排線) |
| `ov_806e3fc5` / `ov_95d57c48` / `ov_c9504023` | dwg_civic | 雙穹頂立面 / 教堂三視圖 / Saint-Augustin 立面,全為渲染 |

### 5ak-b. 三道閘不夠:一塊**碎屑**通過了,而讀數看起來很正常

`plan_to_mesh.py --screen <資料家>` 是這一輪新增的批次品質閘(結論回寫**同一個**
`entry.screen` 欄位 ⇒ `have()` 一視同仁;人眼判決恆勝,救濟走
`screen_mattes.py --family building --human pass <id>`,那一支不需要 matte)。第一次跑的結果是
「6 張 → render 4、**可用 2**」,而其中一張是假的:

```
✓ [plan] dwg_tower/ov_c920cc83  ink+contour(已剔除圖框)・墨密度 19.1%・實體 2.1%・最大候選外的墨塊剔除 97.6%
```

把遮罩存出來一看,那 2.1% 是**簷口的一小塊碎屑**,不是建築。成因是三道閘**互相掩護**:
palazzo 那張是「整張紙就是圖」的掃描 ⇒ **紙緣**成了最大墨輪廓(> `FRAME_MAX`)被當成圖框剔掉
⇒ 剩下最大的候選是碎屑,而它的實體佔比 2.1% **剛好爬過** `SOLID_MIN` 的 2%,墨密度也漂亮。
三個數字各自合格,合起來是錯的。

修法是一條**自我檢查**而不是調門檻:「剔掉的那塊真的是圖框」⇔「剔掉之後還剩得下一個像樣的
主體」。`FRAME_KEEP_F = 0.25`(kept ÷ dropped),**排在 `SOLID_MIN` 之前** —— 排後面的話訊息會
指向「輪廓有缺口,加大 `--close`」,那是完全錯的方向(輪廓好得很,只是挑錯了那一條)。
⚠ 這條門檻的校準樣本**只有一個**(0.024),取 0.25 是「離它一個量級、又遠低於 1」而**不是**
統計出來的;方向刻意偏保守(誤拒進人眼名單救得回來,誤放行就是拿碎屑去生節點)。
語料變多之後 MUST 重掃這一欄的分布。

稽核補 Ⅶ-c(合成「紙緣佔畫布 98% + 建築只剩碎片線」⇒ MUST 出聲且訊息指到圖框;
對照組 = 有留白的正常圖框仍生 12 面):**23 綠**,`--break-outer` 9 紅 / `--break-frame` 2 紅。

### 5ak-c. 三個設計圖列**結構性地**抓不到東西 —— HABS 在 Commons 上一律是 TIFF

新列第一次抓,回來的全是這一排:

```
✗ building/dwg_tower ← wc_34054579:非影像位元組(49492a00)
```

`49492a00` = `II*\0` = **TIFF**。查詢其實命中得非常準(`HABS ... elevation` 撈回來的是 5000px 的
典藏測繪圖),問題出在取得那一端:`sniffImage()` 只認 JPEG/PNG/WebP,而「非影像位元組」被歸類為
**持續性失敗** ⇒ 同一張永遠不再重試。也就是說**這三列在結構上永遠填不滿**,而畫面上只看得到一排 ✗。

修法是走 MediaWiki 自己算好的 JPEG 縮圖(`iiurlwidth=2400`):5000×3910 的 TIFF → 2400×1877 的
JPEG,短邊仍遠高於 1024,而且省掉幾十 MB。三個連帶紀律:
①**尺寸閘 MUST 改吃縮圖的尺寸**(吃原圖會放行一張其實只有 800px 的檔案);
②**只放行 TIFF** —— PDF/DjVu 的「縮圖」是第一頁的渲染,而 2026-08-05 那張「照片」正是 148 頁的
PDF,那正是嗅探存在的理由;③帳本裡那 12 筆 TIFF 誤拒 MUST **刪掉**(不刪 = 持續性失敗的規則
會讓它們永遠不再被試),涉及 5 個零件(building/piping 2、dormer 1、dwg_* 9)。

### 5ak-d. 順手:`matte_photos.py` 加 `--home` + 跳過設計圖;建築語料補跑選片

- **設計圖不走去背**(§5aj-A ⑤)。名冊由帳本的 `src` 欄推導,**不在 python 端手寫 `dwg_*` 清單**
  (型錄新增一列設計圖時,手寫的那一份不會有任何東西提醒你它過期了)。
- `matte_photos.py` 補上 `--home`(舊行為 = 腳本自己的目錄,逐位元不變)—— 它是最後一支還把
  「資料家」寫死成 `HERE` 的腳本,而語料家早就搬走了(§5af-g)。
- 跑完之後順手補了 §5ah-i 留下的缺口:建築 **52 張** matte 從沒跑過 ⇒ 補跑 + `screen_mattes`
  回寫 52 筆。建築族 131 張 matte:印刷品 6、葉片標本 9、多主體 16、光源不足 2 ⇒ **倖存 98**,
  觀察名單 36。
- **順帶量到一件不用改的事**:`③ 葉片標本` 那一桶在建築族抓到的 9 張,人眼看過是**半木造房屋的
  版畫**與**新藝術風格的人像圓牌**(後者是 `window` 查詢撈錯的東西)—— 也就是說 ③ 在別族**沒有**
  ①② 那種「樹形狀」的誤殺問題(§5ah-e),不需要比照放寬。

### 5ak-g. 補抓那一輪:**HABS 的相片與測繪圖共用同一套命名**

TIFF 那條路通了之後第一輪補抓,`dwg_tower` 四張全被 `frame` 判退。看圖才發現它們**根本不是設計圖**
—— 是 HABS 的**大片幅相片**(`wc_34054579` = 一棟商業街屋的正面照)。成因是命名:HABS 的相片
標題也長成 `NORTH (FRONT) ELEVATION - Commercial Building, …`,所以 `HABS drawing elevation X`
撈回來的多半是相片;而**測繪圖掃描的檔名一律以 `Photocopy of drawing` / `Photocopy of measured
drawing` 開頭**。同一條查詢實測對照:

| 查詢 | 前五筆 |
|---|---|
| `HABS drawing elevation courthouse` | 五筆**全是相片**(`SOUTH (FRONT) ELEVATION FROM SOUTHWEST - …`)|
| `photocopy of measured drawing front elevation courthouse` | 前兩筆是測繪圖掃描 |

⇒ 三個設計圖列的查詢一律改帶 `photocopy of (measured) drawing` 字面詞組(這正是 skill 那句
「查詢用字勝過所有模型旋鈕」的第 N 次印證)。改完之後 `dwg_house` 2/2、`dwg_civic` 2/2 達標
(Christ Church 南立面:墨密度 5.3%、實體 67.5%),`dwg_tower` 仍 0/4 —— 商業街屋那一組的查詢
還是撈回相片,下一輪換字再試。

**而 `frame` 這個判退理由現在身兼兩職**:①整張紙就是圖的掃描 ②這根本是相片。兩者的訊息都已
寫進同一句(相片沒有可填實的外輪廓,量到的是天空或牆面的色塊)。**閘本身沒有誤殺** ——
被它判退的九張,人眼看過全部確實不該進管線。

### 5ak-e. 驗收

- `audit_plan_mesh.py` **23 綠 / 0 紅**;`--break-outer` 9 紅、`--break-frame` 2 紅(反向驗證仍咬得住)。
- `fetch_photos.mjs --plan`:配比守門線綠(目標 44/22/22 = 50.0/25.0/25.0%);
  現有 26/74・29/74・19/74 = 35.1 / 39.2 / 25.7%(**urban 缺口最大**,而那正是 §5aj-B 那個桶的語料)。
- 設計圖現況(補抓 + 查詢改字之後):**18 張下載、4 張可用** —— `dwg_house` 2/2 ✅、
  `dwg_civic` 2/2 ✅(Tudor Place + Christ Church)、`dwg_tower` 0/4(見 §5ak-g)。
  判退 14 張:render 4(水彩/版畫渲染)、frame 10(整張紙就是圖 5 / 其實是相片 5)。
- ㋒ 這一輪一行遊戲程式碼都沒動(全在 `tools/ai3d/`)⇒ `npm test` / `npm run bal` 結構上不受影響。

### 5ak-f. 未做

- **`dwg_tower` 仍 0/4**:商業街屋那一組的查詢還是撈回 HABS 相片(§5ak-g)。下一輪換字再試
  (可試 `photocopy of drawing front elevation store building` / `… bank building` 這種帶
  建物型別的專名),或接受它由 civic/house 那兩組補足 —— 配比守門線看的是**組**不是列。
- urban 照片缺 14 張(26/40)、civic 缺 2、rural 已超額 —— 補抓清單見 `--plan`。
- §5aj-B(第二個量體桶)、§5aj-C(只補有洞的)**未動**。

## 5al. §5aj-B 的**量測與推導**(2026-08-09;「先量再開」那一步已完成,縫**尚未**動)

> §5aj-B 的第一條紀律是「先量再開」。本節是那一步的結果 —— 下一輪照著數字實作即可,
> **不必重量**。⚠ 只差一個決定,而那個決定是使用者的(見末尾)。

### 5al-a. 本輪實測(四個最密市區場地,`measure_building_tris.mjs --live --osm-cache --team 3`)

| 場地 | 建物 | facade_wall instance | 桶 tris | 高度中位數 | 最高 | > 55m |
|---|---|---|---|---|---|---|
| shibuya | 413 | 484 | 5,808 | 13.47m | 104.0m | 13 |
| manhattan | 538 | 684 | 8,208 | 15.25m | 117.3m | 108 |
| seoul | 1,192 | **1,379** | **16,548** | 12.50m | 69.8m | 58 |
| taipei101 | 524 | 617 | 7,404 | 13.19m | 121.2m | 18 |

⚠ **這一輪的 seoul 抽到 1,379 個 instance,高於帳上的上界 1,325 —— 刻意不採用**。
`variance_warning` 那一條講的正是這個:instance 上界是噪音很大的統計量(同一張圖 ±70%),
而它在推導裡是**分子**(桶總量 = instance × 12)⇒ 採用它會讓成長額度與 `node_cap` 一起**變鬆**。
規則是「MUST NOT 因為某一次抽樣變大就把 cap 調鬆」,故預算沿用 15,900 / 2,981 不動。

**低矮建物的候選池**(h ≤ 55m)= 471 / 576 / 1,321 / 599 —— 四場都**遠多於**任何合理的挑選數,
郊野場地則自然少於門檻。⇒ 這一桶在密市區恆由 `pick_n` 夾住,與高層那一桶同構。

### 5al-b. 推導(三個數字全部沿用,**唯一要決定的是怎麼切**)

第二個桶與現行 `mass` 桶吃的是**同一個** `facade_wall` 桶 ⇒ 額度是同一份:

```
成長額度 = (whole_factor − 1) × 桶總量上界 = 3 × 15,900 = 47,700 tris   (不變)
總挑選棟數 = 16                                (draw call 約束:額外 mesh ≤ 立面段現行的 16,不變)
node_cap  = 47,700 ÷ 16 = 2,981 tris           (不變 ⇒ 已出貨的 mass_a 2,921 / mass_b 2,900 仍合法)
```

⇒ **第二個桶的額度只能從這 16 棟裡切**,不是另外加的。建議 **8 / 8**:兩邊都沒有量得出來的
偏袒理由(候選池雙方都遠超過 8),而 8 棟仍足以讓一張圖上看得到差異。

**低矮桶的挑選規則**(比照高層那一條,純函式、零 `rnd()`、等高以座標定序):

- 資格 = `b.h <= MASS.MIN_H`(**同一個門檻的另一邊**,MUST NOT 另發明第三個數字)
- 排序 = **足跡面積 `b.w × b.d` 由大到小**(高層那一桶排「最高」,低矮這一桶最顯眼的是屋頂面積)
- 兩桶**互斥**:高層 = `commercial && h > MIN_H`、低矮 = `h <= MIN_H`
  ⇒ 中間那一段(**高於 55m 的非商辦**,例如高層住宅)**兩邊都不換**,維持方盒。
  這是刻意留的空隙:為它再訂一個門檻就是第三個手寫數字。

其餘九條紀律(保險絲、碰撞柱不動、色抖吃 `t.ord`、附件推丟棄桶但帶碰撞柱的兩件不推、
盒投影 UV、`pick_n`/`min_h` 兩份同值由稽核釘住、A/B 用 `--osm-cache` 錄播)**逐條照 §5aj-B**。

### 5al-c. ⚠ 使用者要決定的那一件事

「開第二個桶」在現行預算紀律下**必然要從第一個桶切額度** —— 也就是密市區裡拿到整棟庫節點的
高層商辦會從 16 棟降到 8 棟。兩個選項:

- **(a) 8 / 8 切分**(建議):`whole_factor = 4` 一格不動,`node_cap` 不動,已出貨節點不受影響。
  代價 = 高層那一桶的覆蓋率減半。
- **(b) 把 `facade_wall` 這一桶的 `whole_factor` 抬到 8**:高層維持 16 棟、低矮另加 16 棟,
  最壞情況 32 × 2,981 ≈ 95k tris = 最重場景的 **8.0%**(現在是 4.0%)。
  代價 = 這一族的整件閘從此比 tree/megalith 鬆一倍,而那條閘是跨族的共同紀律。

**這是預算/畫面的取捨,不是技術問題** ⇒ 不自行決定。使用者沒有另行指示時,下一輪照 (a) 做。

## 5am. Trial log (2026-08-09 第三場 — §5aj-B 的**縫**已開:第二個整棟量體桶(低矮建物))

> 使用者對 §5al-c 回覆「**a**」⇒ 8/8 切分定案。本節把縫開好並驗完;**名冊還是空的**
> (節點是下一輪的事,見 5am-e)。

### 5am-a. 額度:一格都沒有多出來

兩個桶吃的是**同一個** `facade_wall` 桶 ⇒ 成長額度是同一份。切分之後三個數字全部不動:

| | 改前 | 改後 |
|---|---|---|
| 成長額度 | 3 × 15,900 = 47,700 tris | **同** |
| 總挑選棟數(= 額外 draw call 上界)| 16 | **同**(高 8 + 低 8) |
| `node_cap` | 47,700 ÷ 16 = 2,981 | **同** ⇒ 已出貨的 mass_a 2,921 / mass_b 2,900 逐位元不受影響 |

`tri_budget` 因此多兩個欄位(`pick_n_high` / `pick_n_low`)而不是改 `pick_n`,並由稽核釘住
**加總 === `pick_n`** —— 分開加總對不上就是「額度憑空多出來一份」,而畫面上只表現成
「這張圖的高樓好像特別多」。

### 5am-b. 資格:兩個**既有**判準的對角線兩格,不發明第三個數字

```
              h > MIN_H(55)      h <= MIN_H
commercial    → mass(高層商辦)   → 方盒
!commercial   → 方盒             → masslow(低矮非商辦)
```

`commercial` 是既有的 OSM 型別判定(commercial/office/retail/hotel/十層以上公寓)⇒
**非商辦正好就是住宅/教堂/穀倉/學校那一類**,也正是使用者定的 rural + civic 兩條語料
抓的東西。另外兩格(低矮商辦 / 高層住宅)**刻意維持方盒**:為它們再訂一個門檻就是
第三個手寫數字,而語料裡也沒有對得上的東西。

排序兩桶各有各的:高層排**最高**、低矮排**足跡面積**(低矮建物在畫面上最顯眼的是屋頂面積,
不是高度),同值時一律再以座標定序(跨客戶端逐位元同一組)。候選池實測 471~1,321 棟
(§5al-a)⇒ 密市區恆由 `pick_n_low` 夾住,郊野場地則自然少於 8 棟。

### 5am-c. 實作只動四處,每一處都有一條「不這樣做會怎樣」

1. **探詢收成一支 `libOk(key)`**(兩個名冊共用)—— 逐桶各抄一次就是第二份實作。
2. **桶建構器仍是一份**(`buildBldBucket.mass(n, mat, i, key)`):兩桶只差名冊與挑選規則,
   幾何/材質/保險絲逐條相同。另開一支 `masslow:` 的壞法是「兩桶的保險絲不一樣」。
3. `t.lib` 由 boolean 改成**名冊鍵**('mass' / 'masslow' / null),分桶鍵 = `名冊#節點`。
4. **保險絲逐桶各自成立**:`take()` 只在該名冊真的載到節點時才挑 ⇒ 名冊空著 = 一棟都不挑
   = 逐位元同舊制。這一輪的 A/B 就是靠它證明的(下面)。

碰撞/LOS 一格不動(A30)、色抖仍吃 `t.ord`、`vis()` 分流與 `rnd()` 枚數不變 —— 三條舊斷言原樣還在。

### 5am-d. 驗收

- **逐位元不變(用量的)**:`measure_building_tris --live --osm-cache` 錄播同一份 Overpass,
  改動前後 taipei101 **全場 1,556,728 tris / mesh 2,696 / facade_wall 617 × 12** 三個數字
  逐位元相同;shibuya 同樣(484 × 12、建物相關桶 28,168)。
- `audit_siteplan` **200 綠**(新增 4 條);反向 `--break-mass2` **4 紅**(加總超額 / 資格重疊 /
  保險絲拿掉 / 門檻與預算分家);既有 `--break-mass` **4 紅** —— 其中「拿掉保險絲閘」那一條
  因為實作換了形狀改成「等高不再以座標定序」,仍是三處各壞一件事。
- `intake_parts` 245 / `object_joints --seeds 8` 21611-0 / `beacons` 68 / `gpu` 54 /
  `soft_stroke` 73 / `cel` 52 / `visual_prefs` 124 / `world_height` 49 /
  `open_tunnel` 163 / `underpass` 161 / `road_joint` 86 / `climb` 211 —— 全綠。
- `npm run bal` 全綠(⑦f 1.78×、自身型 9 台全 > 0);`npm test` 全綠(fresh server :8676)。

### 5am-e. 同輪出貨:`masslow_a` / `masslow_b` 兩顆節點

縫開好之後直接把名冊補滿(**MUST ≥2 顆**:一顆打天下 = 同一張圖上挑中的那幾棟同一個剪影)。
語料人眼挑的兩張都符合 §5ae-d 的準則(**整棟入鏡 + 3/4 視角**):
`bld_barn/ov_910e1b06`(Carol M Highsmith,紅色雙坡穀倉)與 `bld_church/ov_16f1257f`
(白色木造鄉村教堂 + 鐘樓)。配方沿用 §5ae-c **一個字沒改**。

| | raw 面 | 匯出(薄殼)| 實體化後 | 開放邊 | 元件 | kf_p95 |
|---|---|---|---|---|---|---|
| `masslow_a` 穀倉 | 5,814,558 | 47,658(21,482 開放邊 / 1,763 元件)| **2,900** | 0 | 1 | 0.83% |
| `masslow_b` 教堂 | 4,810,964 | 47,990(24,262 / 1,782)| **2,900** | 0 | 1 | 1.99% |

**唯一要調的一個旋鈕**:教堂的 `--offset` 從 0.006 調到 **0.014**。鐘樓尖頂那一段太細,
等值面重建橋不起來 —— 0.006 出 3 元件、0.010 仍 2 元件(而且「watertight: True 但 2 元件」
這種讀數最容易被當成過了);0.014 才收斂成水密單元件,代價是 kf_p95 0.83% → 1.99%,
黏土複核尖頂仍在。⇒ **實體化參數不是全族一份,是隨主體的細部尺度走**(§5t 的同一條)。

**兩顆都不需要鏡像貼補**:`mesh_sym` 量到半空間不對稱 masslow_a **0.023 / 0.015**、
masslow_b **0.037 / 0.006** —— 遠在 `EMPTY_ASYM` 0.12 之下。這是 §5ae-d 那條結論的第二次
印證(**上游修語料勝過下游動刀**):兩張都是整棟入鏡的照片,而 mass_a 那張夜景緊裁特寫
鏡射前是 0.123。

驗收(節點那一半):`intake_parts` **253 綠**、`parts_review --report` **0 缺件 / 0 孤兒 /
0 未記載**、`node_sheet` 四面黏土人眼(穀倉的山牆脊線、教堂的鐘樓尖頂四面都在)、
`shot_scene --venue taipei101 --live` 讀數 **零件庫節點 48・整棟量體挑中 16 棟**(= 8 + 8,
與預算逐位元對上)。

**順手修掉第三次的同一個坑**:`shot_scene` 的 `mass_near` 認人條件是
`n.startsWith('building/mass_')` —— 那個**底線**剛好把 `masslow_*` 整組排除。它是推導的
(§5ae-e 之後改成 `libNames()`),只是推導式太緊 ⇒ 前綴改成 `building/mass`(無底線)。

### 5am-f. 未做(下一輪)

- **真機冒煙**:低矮那 8 棟的剪影要看得出是坡屋頂量體而不是方盒(離線可先加一個
  低矮專用機位 —— 現行 `mass_near` 是對著高層那一叢拍的)。
- `audit_traverse`(㋓):整棟建物換幾何會動到街廓夾出來的通道寬。這一輪的節點外廓收在
  同一份包絡內(水平徑向 0.475 = 與 mass_a/b 同值)⇒ 理由上不影響,但**節點入庫那一輪
  不可省**(CLAUDE.md 那一列的原話)。
- `mass_c`(GE Building / 布魯托主義板樓已 matte 未生成)、`chimney_a` 的來源帳缺口。

## 5an. ⭐ 使用者定案:**外牆圖層要分型別/風格/屋頂形式,同型還要差異化,並參考 2D 照片**(2026-08-09;規格,**尚未實作**)

> 使用者原句:「不是每一棟建築外觀都用摩天大樓處理,不同類型,不同風格,平頂和斜頂等的
> 建築外牆圖層都不同;就算是摩天大樓外牆也不只一種,同一種建築也要差異化;圖層也參考 2D 照片」

### 5an-a. 現制是什麼(先量,再改)

- 立面貼圖 = `facadeTex()` 現畫的 128×256 canvas,**共 16 張**(`FACADES.residential` 8 +
  `commercial` 8),五種樣式模式(plain / curtain / hband / balcony / shop)。
- 選哪一張 = `facadeStyle(b)`:**只有兩個維度** —— ㋐ 商辦/住宅(OSM 型別)㋑ 樓高分桶
  (`FACADE_BUCKETS`,3 段)。桶內以收錄期抽好的 `b.v` 取模。
- 同一張貼圖之上,逐棟的差異**只有色調**(`PALETTE` × `blockTone` 街區家族 × 逐實例明度抖)。
- **屋頂形式完全不參與**:`gable` 是在 emit 迴圈裡才由 `rv = rnd()` 三分決定的(人字 / 四坡 /
  平頂),而那時材質早就選好了 ⇒ **斜屋頂的低層住宅照樣掛著騎樓遮陽棚與帷幕窗**。
- 用途也只有商辦/住宅兩格:`building=church` / `school` / `barn` 只要不是地標,一律落進住宅那 8 張。
- 沒有任何一個參數來自照片語料。

**規模感**(taipei101 --live 實測,§5al-a):617 棟建物、高度中位數 13.19m、> 55m 只有 18 棟
⇒ 絕大多數落在住宅低層那一桶(`idx: [3, 5, 7]`)= **約 500 棟共用 3 張貼圖**。
使用者說的「每一棟都用摩天大樓處理」在數字上是反過來的(高樓那一組反而選得比較細),
但**體感一致**:低矮那 500 棟只有 3 種立面,而且其中兩張帶著店面/陽台這種市街語彙。

### 5an-b. 四條要求 → 四個獨立的改動(依相依排序)

**① 屋頂形式進選擇維度(結構性,最先做)**

`gable` MUST 變成**建物的純函式**(同 `facadeStyle`),而不是 emit 迴圈裡的一枚 `rnd()`;
否則分組的時候還不知道這一棟是不是斜屋頂。作法沿用本檔已經用過兩次的紀律:
**`rnd()` 照抽(枚數不變 ⇒ 佈局逐位元不動),決定改吃位置雜湊**(同 `vis()` 的「只換推去哪裡」
與 `djAt` 的落點雜湊)。⚠ 直接把那一枚 `rnd()` 刪掉 = 之後每一株植被/每一棟樓的序列整條推移
(§2.3),而畫面上只表現成「這張圖的佈局變了」。

**② 用途維度**(不只商辦/住宅):OSM 的 `building=` 值本來就在(`3155` 那一段已經在讀它),
現制把它壓成一個 bool。至少要分出 **住宅 / 商辦 / 工業倉儲 / 宗教 / 教育醫療 / 農舍**六類,
而分類 MUST 在既有那一支型別判定裡擴充(第二份 `building=` 對照表 = 兩份會分家)。

**③ 同型差異化 MUST NOT 靠加 draw call**:每多一款立面就是多一個 InstancedMesh,而
**立面段現行的 16 個 draw call 正是 `mass`/`masslow` 兩桶 `pick_n` 的推導來源**(§5am-a)——
立面款一膨脹,那個預算的前提就跟著動。正解是**圖集 + 逐實例 UV**:同一張貼圖畫 N 個變體格,
逐實例用 `InstancedBufferAttribute` 給一組 uv 偏移(draw call 不變、幾何不變)。
這一條同時滿足使用者的「摩天大樓外牆也不只一種」與「同一種建築也要差異化」。

**④ 參數取自照片(不是把照片貼上去)**:語料裡每一類都有整棟入鏡的照片
(bld_office / bld_apartment / bld_warehouse / bld_barn / bld_church / bld_shophouse …)。
可以**離線量**出來的東西:窗格節奏(去背後主體內部暗區的自相關 → cols/rows)、
窗色與牆色(取樣中位色)、有沒有連續橫帶(hband)、有沒有騎樓(底層暗帶)。
產出寫成一份資料表(同 `venueText.js` 的做法),`FACADES` 改讀它 ⇒ 「量出來的,不是手寫
好看數字」。**MUST NOT 直接把照片當貼圖**:授權沒問題(CC0),但那是 2048² 的相片,
與整套賽璐璐 + 硬邊窗格的畫面語言不相容,而且 draw call/記憶體都是另一個量級。

### 5an-c. 這一輪 MUST 一起看的兩條既有約束

- **draw call 預算**:見 ② —— 改 `FACADES` 長度 MUST 回頭重推 `tri_budget` 的 `mass.pick_n`。
- **`facadeTex` 的快取鍵**是 `key` 字串,而參數(cols/rows/style)沒有進鍵 ⇒ 同名不同參數會
  **靜默拿到第一次那一張**。加維度之前要先把鍵改成參數的函式。

### 5an-d. 驗收(建議)

`audit_siteplan`(立面款與屋頂形式的對應、`rnd()` 枚數不變的逐位元 A/B)+
`measure_building_tris --live --osm-cache`(draw call 與 tris 逐位元對帳)+
`shot_scene` 的 `mass_near` / 新增一個低矮街廓機位(**這一項只有截圖看得出來**)+
`audit_cel_pipeline`(貼圖仍走 ramp/描邊那一套)+ 真機冒煙。

## 5an. Trial log (2026-08-09 第四場 — 外牆圖層:**斜頂被貼上玻璃帷幕**,以及「同一種建築也要差異化」)

> 使用者回報 + 定案:「**斜頂屋頂外觀變摩天大樓的玻璃,請修正**。不同類型、不同風格、
> 平頂和斜頂等的建築外牆圖層都要不同;**就算是摩天大樓外牆圖層也不要只有一種,同一種建築
> 也要差異化**;圖層也參考 2D 照片。」

### 5an-a. 成因:庫節點是**單一材質群組**,而方盒那條路的屋頂走另一個材質

方盒路徑是 `[wall, wall, roof, roof, wall, wall]` —— BoxGeometry 的六個材質群組裡,
第 3/4 格(±Y)吃的是**素色屋頂材質**。庫節點只有一個群組 ⇒ three 取 `material[0]` = 立面貼圖,
**整顆都貼窗格**。對平頂塔樓那是 §5aa ⑥ 就寫明的刻意取捨(俯視看得到頂面的機會低),
對**斜屋頂**卻剛好相反:那一面就是整個剪影最顯眼的地方。

### 5an-b. 外牆圖層(`wallLayer`):牆本身是什麼做的,與窗格分開

舊制**只有一種牆**(純白 + 底部暗帶),所有差異都靠窗格節奏與 tint ⇒ 每一棟的牆其實是同一面牆。
新增一層畫在窗格**之前**的圖樣,八款程序生成(Canvas2D,不進二進位資產),
**比例與配色參考語料庫的 CC0 照片**,逐款在原文註明參考哪一張:

| 圖層 | 參考照片 |
|---|---|
| `boardv` 直紋木板 + 壓縫條 | `bld_barn/ov_910e1b06`(Highsmith 紅色穀倉)|
| `boardh` 橫紋雨淋板 | `bld_church/ov_16f1257f`(白色木造教堂)|
| `stone` 亂石砌 | `bld_stonecottage/ov_3966cc35` |
| `brick` 磚砌(交丁 + 灰縫)| `bld_warehouse/ov_bd624950` |
| `stucco` 灰泥(低頻污漬)| `bld_medit/ov_f42bb333` |
| `panel` 預鑄混凝土板 | `bld_office/ov_e62e476d` |
| `spandrel` 帷幕裙板帶 | `bld_tower/ov_8811db29` |
| `plainw` 純白(**舊制**,預設)| —— |

既有 16 款(住宅 8 / 商辦 8)**逐款配一種**:摩天大樓那一組因此不再是同一面牆
(`panel` / `spandrel` / `brick` / `stucco` 四種輪著配),而「同一種建築也要差異化」是
**款式 × 窗格節奏 × 街區色相 × 逐棟 tint** 四層疊出來的,不是在貼圖裡逐棟重畫。
`plainw` 不抽亂數 ⇒ 沒指定 `wall` 的呼叫端(地標那六支)逐位元不變。

### 5an-c. 斜頂家族 `FACADES_PITCHED`

低矮那一桶(`masslow`)改吃自己的六款:木板穀倉 / 雨淋板教堂 / 石砌農舍 / 灰泥民宅 /
磚造校舍 / 深色木造 —— 窗小、亮燈率 0.12~0.20、**沒有帷幕玻璃也沒有店面遮陽棚**。
款式由**落點雜湊**選(零 `rnd()`,§2.3)⇒ 同一張圖上的穀倉彼此不同。
桶建構器仍**只有一個呼叫點**(稽核釘住 4 處)—— 材質先攤平成 `libEmit` 再一次發出去。

### 5an-d. 驗收與**還沒解決的那一半**(⚠ 這一半已於 **§5ao** 做完,以下保留當時的診斷)

新機位 `masslow_near`(§5am-f 的第一條):`mass_near` 是對著**最高**那一叢拍的,兩張永遠不同框
⇒ 低矮桶換了什麼在離線這一側**一張證據都拿不出來**。同輪也修掉「兩張機位對著同一棟拍」——
`massGeo`(兩桶合計,給讀數對帳)與 `highGeo`(只給 mass_near 取景)要分開,
拿合計去挑「第一顆」會挑到穀倉。

截圖結論:斜頂建物**不再是玻璃帷幕**,現在是灰泥/木板/石砌牆。
⚠ **但窗格仍會出現在斜屋頂面上** —— 因為單一材質群組這件事沒變,只是那張貼圖換成了
材質感的牆。要讓屋頂真的是屋頂,下一步是**屋頂帶 UV**:
`normalize_parts.py` 加 `--roofband <node>=<frac>`,把**朝上面**(Blender 軸 2 為主軸且法線向上)
的 UV 壓進 `v ∈ [0, frac]`、側面壓進 `[frac, 1]`,而 `facadeTex` 在那一帶畫屋頂色與瓦縫。
只需重跑 masslow 兩顆的 normalize(實體化 GLB 還在),平頂那兩顆可維持原狀(俯視機會低)。
`npm run bal` / `npm test` 不受影響(㋒ 純表現層)。

## 5ao. Trial log (2026-08-09 第五場 — 屋頂帶 UV:斜屋頂終於是屋頂;**順手量到已出貨的立面是上下顛倒的**)

> 接 §5an-d 的「還沒解決的那一半」。使用者那句話的前半(牆換成材質感圖層)上一場已落地,
> 這一場處理後半:**窗格仍印在斜屋頂上**。

### 5ao-a. 為什麼答案是 UV 而不是「拆材質群組」

方盒那條路的屋頂之所以是屋頂,是因為 `BoxGeometry` 有**六個材質群組**
(`[wall, wall, roof, roof, wall, wall]`)。庫節點只有**一個**群組 ⇒ three 取 `material[0]`。
「那就把節點拆成兩個群組」聽起來最直接,但它會讓**每一棟多一個 draw call** ——
而 `pick_n = 16` 的整條推導(§5aa)就是 draw call 上界,拆群組等於把那個上界砍半。
⇒ 區分移進 **UV**:朝上的面壓進 `v ∈ [0, BAND]`、其餘壓進 `[BAND, 1]`,
`facadeTex` 在畫布底部那一條畫屋頂。一個材質、一張貼圖、draw call 一格都沒有多。

### 5ao-b. 兩個數字都是量出來的(逐面積直方圖)

| | masslow_a(穀倉) | masslow_b(教堂) | 對照:mass_a / mass_b(平頂) |
|---|---|---|---|
| 牆的尖峰(n.y) | [0, 0.05] 23.7% | [0, 0.05] 20.7% | 32.3% / 28.0% |
| 屋頂的尖峰 | **[0.45, 0.55] 19.9%** | **[0.65, 0.80] 16.8%** | [0.95, 1.00] 6.4% / 2.4% |
| 中間空檔 | 0.05~0.45 幾乎是零 | 同左 | —— |
| `parity` = 朝上 ÷(朝上 + 側面) | **0.272** | **0.275** | 0.138 / 0.124 |

⇒ `ROOF_MINZ = 0.30`(兩顆共同的空檔中點)、`ROOF_BAND = 0.273`(名冊平均;
語意 = **兩帶 texel 密度相同**,瓦縫與窗框在畫面上是同一個顆粒度)。

**沿用盒投影的「主導軸」會壞掉**:主導軸等價於門檻 0.577,而穀倉的屋頂面落在 0.45~0.55
(非等向 fit 把它拉高 ⇒ 坡角變陡)⇒ **整個屋頂會被判成牆**。這也是為什麼平頂那一桶
刻意不開屋頂帶:它的 parity 只有 0.13,而俯視看得到頂面的機會本來就低(§5aa ⑥ 的原話)。

### 5ao-c. 順手量到的那個 bug:**已出貨的庫節點立面是上下顛倒的**

寫稽核時多釘了一條「牆面的 v 要隨高度遞增」,結果**四顆節點全紅**:
`corr(高度, v) = −1.0000`。成因是 glTF 的 UV 原點在左上、Blender 在左下 ⇒ **匯出端會把 v
翻過來**,而消費端那張立面貼圖是我們自己的 `CanvasTexture`(`flipY` 預設 true ⇒ v=0 採到
畫布**底部**)。⇒ 庫節點的基座暗帶印在屋簷、女兒牆帶與**店面遮陽棚印在地面**,
而方盒那條路走 `BoxGeometry` 自己的 UV 是正的 —— **同一張圖上兩種方向**,
沒有任何錯誤訊息,§5aa/§5ae 兩輪的截圖都沒看出來(窗格陣列近乎上下對稱)。
修法是在匯出前補償那一次翻轉,`--boxuv` 的兩顆一起修。

### 5ao-d. 落地了什麼

| 檔 | 改動 |
|---|---|
| `normalize_parts.py` | `--roofband <node>=<frac>[\|<minz>]`;與 `--boxuv` **同一段**(不是第二種投影);對 `--base` 裡的既有節點只重建 UV,**幾何逐位元不動**(六顆節點位置最大差 0.0e+0、索引相同);既有 UV 層先清掉(不清 = 只是加第二層,看起來像「這一輪完全沒生效」);存檔前補償匯出端的 v 翻轉 |
| `biomes.js` | `MASS.ROOF_BAND`/`ROOF_MINZ`;`facadeTex` 多兩個參數(屋頂色 + 屋頂形式),牆改畫進 `WH = H − 帶高`;新增 `roofLayer` 四款(metal / shingle / pantile / tile);`FACADES_PITCHED` 六款各配一種屋頂形式;`stone` 牆的逐塊明暗改走**灰階**(排面複核:三通道各擲 0/255 會擲出洋紅/青/黃 = 粉彩拼布,而參考照片是同色系塊石;亂數枚數維持 3 枚 ⇒ 序列不動) |
| `parts_src.mjs` | `parseGlb` 多讀 `TEXCOORD_0`;新增 `uvBandStats()`(方向 + 帶界 + parity 的唯一取數處) |
| `intake_parts.mjs` | UV 契約 16 項:有沒有 UV / 方向 / 朝上面收在帶內 / 牆不踩進帶 / **帶寬 = 量出來的 parity(±0.03)** |
| `tri_budget.json` | `families.building.{mass,masslow}.uv` + `roof_band` / `roof_minz` + `measured_roof` |
| `audit_siteplan.mjs` | 屋頂帶 5 項(兩份數字同值 / 只餵斜頂那一桶 / 牆全吃 WH / roofLayer 單一縫 / 六款「牆 × 屋頂形式」兩兩不同) |
| **`tools/shot_facades.mjs`(新)** | 立面貼圖排面:執行 biomes 原文畫出 22 款 × (貼圖 + 自發光),斜頂那六款加畫屋頂帶邊界標尺。`--only pit --cols 3` 只排改動的那幾款 |

**屋頂形式逐款參考語料庫的 CC0 照片**(人眼看過那一張,不是憑印象):
metal ← `bld_barn/ov_910e1b06`(Highsmith 紅穀倉的鍍鋅浪板)/ shingle ← `bld_church/ov_16f1257f`
(草原教堂的深色木瓦)/ pantile ← `bld_stonecottage/ov_3966cc35`(托斯卡尼石屋的紅陶筒瓦)/
tile ← `bld_chalet/ov_35100e42`(阿爾卑斯木屋的交丁方瓦)。
**看照片改掉了一個原本要寫的答案**:石砌農舍本來打算配深色石板瓦,照片上是**紅陶筒瓦**。

**圖樣 MUST NOT 假設坡向**:兩顆節點的屋脊軸實測就不同(masslow_a 屋頂面的水平法線
|x| 0.739 ≫ |z| 0.054 = 坡向 X;masslow_b 反過來 |z| 0.394 ≫ |x| 0.064),
而屋頂面吃的是**平面投影** ⇒ 同一張貼圖在兩顆上差 90°。四款一律做成
「一向排列 + 另一向接縫」的雙向紋理(真實瓦作本來就是這樣)。

### 5ao-e. 驗收

- `intake_parts` **269**(253 + 16 條 UV 契約)/ `audit_siteplan` **206**(201 + 5)
- **反向驗證三支**:①`--roofband masslow_*=0.10`(帶寬與宣告分家)⇒ intake 2 紅
  ②拿掉匯出端翻轉的補償(= 這一輪之前的實際狀態)⇒ intake **8 紅**(四顆方向全倒 + 帶界)
  ③`audit_siteplan --break-roof` ⇒ 2 紅;既有的 `--break-mass` 4 紅 / `--break-mass2` 4 紅
  / `--break-shy` 3 紅照舊
- `audit_object_joints --seeds 8`(21,611 接合 0 異常)/ beacons 68(`--break-extent` 1 紅)
  / gpu 54 / soft_stroke 73 / cel 52 / visual_prefs 124 / world_height 49
- `parts_review --report` 0 缺件 / 0 孤兒 / 0 未記載來源
- `npm test`(fresh server + `WS_URL`)、`npm run bal`:㋒ 純表現層 ⇒ 逐項不動
- 視覺:`shot_facades` 排面(22 款 + 只排斜頂六款的放大版)—— 六款的屋頂帶各是
  浪板/木瓦/筒瓦/平瓦,而 16 款商辦住宅**一條帶都沒有**(方盒那條路不傳屋頂色)

### 5ao-f. 未做

- **真機冒煙**與 `shot_scene --venue taipei101 --live` 的 `masslow_near`/`mass_near`:
  ㋓ 需 Overpass。離線這一側已由 `shot_facades` 蓋掉「貼圖長什麼樣」,
  但「貼到那顆節點上、從街上看過去長什麼樣」仍要真圖資才拍得到。
  **`mass_a`/`mass_b` 這一輪翻正了立面方向 ⇒ 那兩張機位的畫面會變**(基座暗帶回到地面)。
- `audit_traverse`(㋓):幾何逐位元不動 ⇒ 理由上不受影響,但仍列著。
- 語料觀察:`bld_minka` 的 `ov_68f57b0d` 是一張 19 世紀**鉛筆速寫**(授權/解析度/統計全過關,
  只有人眼看得出來)—— 那一列目前沒有消費端,但補圖時 MUST 先把它換掉(skill §9.5 那一族)。

## 5ap. Trial log (2026-08-09 第六場 — 層高:**窗戶壓縮到太細**;而最細的那一個不是樓,是裙樓)

> 使用者回報 + 定案:「好幾個建築的窗戶都壓縮到太細,不合理。不同建築可以有不同窗戶大小,
> 例如玻璃大樓或是落地窗,但**上下樓層間距要在合理差異範圍以內**,因為現實世界每棟建築
> 每層高度差異不大。」

### 5ap-a. 先量:舊制的層高長什麼樣

立面貼圖沒有 per-instance repeat ⇒ 一張貼圖被拉滿**那一件**的高度 ⇒ **層高 = 件高 ÷ 列數**,
而舊制的列數是**立面款自帶的常數**(`FACADES[].rows`),只靠三段樓高分桶粗調。實測:

| | h=6m | 13m | 20m | 34m | 60m | 104m |
|---|---|---|---|---|---|---|
| 住宅(現實 2.8~3.6) | **1.20** | **2.17** | 3.33 | **4.86** | **8.57** | **14.86** |
| 商辦(現實 3.2~4.6) | **0.55** | **1.18** | **1.82** | 3.09 | **4.62** | **8.00** |

**而最誇張的不是樓,是同一棟的附件件**:退縮頂塔(0.22h)與臨街裙樓(max(6, 0.12h))
有自己的高度卻吃**主體那一張**貼圖 —— 100m 塔樓的裙樓 12m 拿 16 列 = **層高 0.75m**。
⇒ 這一輪的第一個結論:**列數 MUST 逐「件」取,不是逐「棟」**。

### 5ap-b. 規則:先落在帶內,再貼近目標

```
候選 = 級距上「層高落在 [MIN, MAX] 」的列數    ← 使用者說的「合理差異範圍」
取其中 log 距離最接近該類別目標層高者        ← 層高是比例量,不是差值
沒有候選(件矮到只放得下一層)才退回最接近者
```
`MIN 2.6 / MAX 5.4`:兩者的關係本身是可推導的門檻 —— `MIN·MAX/(MAX−MIN) = 5.01m`,
**高於它的件必有合法列數**(區間 [h/MAX, h/MIN] 一定含一個級距值),低於它的只放得下
一層(層高 = 件高,而 2.6~5.0m 的單層倉庫/教堂中殿本來就合理)。
目標層高住宅 3.1 / 商辦 3.9(差 1.26× 是設計:店面與大廳本來就挑高)。

**實測結果:全域 0 點出界**,而同類的層高離散度 **1.40×**(住宅 2.62~3.66、商辦 3.30~4.61)。

### 5ap-c. 級距是 draw call 的旋鈕,而那一刀是量出來的

列數進了分桶鍵(「款 × 列數」)⇒ 級數一多桶數就長。三個版本都量過(taipei101 --live,
`measure_building_tris` 新增的 `draw` 欄):

| 級距 | 級數 | 款怎麼配 | facade 桶數 | 同類層高離散 |
|---|---|---|---|---|
| ×1.2 | 17 | 8 款自由跨帶 | **145** | 1.31× |
| ×1.5 | 8 | 綁級距帶(每帶 2 款)| ~30 | 1.67× |
| **×1.35** | **12** | **綁級距帶** | **50** | **1.40×** |

145 個桶 = 145 張 128×H 的貼圖(幾十 MB 貼圖記憶體),而畫面上完全看不出差別 ——
這是「級距越細越好」的直覺會踩到的地方。**款綁在級距帶上**(每帶兩款、由收錄期的 `v`
二選一)是另一半:讓款自由跨帶,桶就是 8 × 級數 全部 populated。
**桶數的結構上界仍是 2 × 8 款 × 12 級 = 192**(附件件吃自己的列數 ⇒ 不只落在對角線上),
實測 50、佔全場 2,732 個 mesh 的 1.8%。`pick_n` **刻意仍是 16**:立面段從 16 漲到 50
不是「整棟量體也可以變多」的許可證(那條約束的另一半 —— 細節下限 N ≤ 47 —— 沒有變)。

### 5ap-d. 順手修掉的第二件:高樓的窗**在貼圖裡**就只有 3px

層高對了,窗仍可能細:貼圖恆 128×**256**,而 35 列的塔樓一層只分到 6.6px、窗高 3px。
⇒ `facadeTexH(rows)`:每層固定 24 texel、上下限 [256, 1024]。**10 列以下維持 256**
⇒ 絕大多數建物的貼圖逐位元不變,只有高樓那幾張長高。

### 5ap-e. 落地了什麼

| 檔 | 改動 |
|---|---|
| `biomes.js` | `STOREY` 帶 + `ROW_LADDER`(級距推導自 `objHeightMax()`)+ `facadeRows()`(唯一縫)+ `LOOKS_PER_BAND`;`FACADES` 的 `rows` 欄與 `FACADE_BUCKETS` **整組退場**;立面桶改「款 × 列數」逐件分桶(方盒 / 整棟量體 / 斜頂三處同吃 `rowsOf(t)`);`facadeTexH()` |
| `audit_siteplan.mjs` | 層高十條(級距推導/遞增/級距比 < 帶寬比/**全域層高不變式**/逐類離散度/兩類目標差/逐件取列數/單一縫/舊制退場/貼圖高度)+ `--break-storey` |
| `measure_building_tris.mjs` | 逐桶印 `draw`(桶數自此是變數,而它正是 `pick_n` 那條推導引用的量)|
| `tri_budget.json` | `measured_facade_draws: 50` + 壞版留檔(145)+ `pick_n` 維持 16 的理由 |
| `shot_facades.mjs` | 排面的軸改成**樓高**,每格標「N 列 = 層高 X m」,出帶標紅 |

### 5ap-f. 驗收

- `audit_siteplan` **218**(216 + 層高;`--break-storey` 1 紅、`--break-roof` 2 / `--break-mass` 4 /
  `--break-mass2` 4 / `--break-shy` 3 / `--break-line` 3 / `--break-strike` 1 / `--break-gate` 3 照舊)
- `intake_parts` 269 / object_joints 0 異常 / beacons 68 / gpu 54 / soft_stroke 73 / cel 52 /
  visual_prefs 124 / world_height 49
- `npm test` 全過、`npm run bal` 通過(㋒ 純表現層)
- `shot_facades` 排面:20 格的層高讀數**全綠**(2.81~4.38)
- ⚠ 順手撞到的撞名:`FACADE_PX.MIN_H` 與 `MASS.MIN_H` 同名 ⇒ **兩支稽核**都改抓到 256
  (`audit_world_height` 說「構不到 256m」、`audit_siteplan` 說「門檻 256/55」)。
  兩邊都是「以原文裡的 `MIN_H` 抓那個門檻」⇒ 欄位改名 `H_MIN`/`H_MAX`,稽核那一側也錨到
  `const MASS = {`。**兩個都是紅字而不是靜默**,這次是稽核幫忙擋下來的。

### 5ap-g. 未做

- 真機冒煙與 `shot_scene --live` 的街景複看(㋓):離線這一側已由 `shot_facades` 蓋掉
  「貼圖長什麼樣」,但「一整條街看過去」要真圖資。
- `cols`(窗格**橫向**疏密)仍是款的常數,沒有跟著建物寬度走 —— 使用者這一輪只點名了
  「上下樓層間距」,橫向沒有要求,故**刻意不動**;要做的話規則與這一輪同構。

---

## 5aq. Trial log (2026-08-09 第七場 — 零件台收半成品 + 逐型歸屬修正 + 針葉三種入庫)

> 使用者:「零件台清掉半成品,將比較好的新建 3D 物件都加入」。追問後定案
> **「我指的清理是不要在零件台顯示,不是刪除」**,並選了三條來源全做、順序「先修預算再重生成」。

### 5aq-a. 半成品判定 MUST 是量出來的,而兩個常數都是語意不是校準值

判定住 `tools/ai3d/mesh_sym.mjs`(`topoStats` / `nodeFlaws`,`--flaws` 印同一份名單),
對照台 import 同一支 —— 抄第二份就是「台上收起的」與「CLI 印的」兩份名單。

| 常數 | 語意 | 為什麼不是別的寫法 |
|---|---|---|
| `HOLE_PERIM_F = 1` | 破口周長 ≥ 節點跨距 | **MUST NOT 是「open > 0 就算」**:§5aj-C 使用者定案「洞很小的話直接貼平」⇒ 小洞是待補不是半成品。實測門檻兩側有 **10× 空隙**(`mass_a` 0.29 / `facet_a` 0.50 vs `facet_b` 5.01 起)—— 不是拿兩個樣本過擬合 |
| `SOLID_MIN_TRIS = 4` | 四面體是「圍得成封閉體」的下界 | **MUST NOT 是「元件 > 1 就算」**:`chimney_a` 的兩件是 122 + 94(煙囪本體 + 帽)、`cf2_crown_a` 的八件是等大的星盤層 —— 那是設計。`mega_e` 的第二件只有 **2 個三角形** = 真碎屑 |
| `OPEN_SHELL_FAMILIES = ['tree']` | 具名豁免 | 葉冠 / 星盤 / 灌木叢是開放面片的集合(§5aj-C「樹族 MUST 排除」);拿掉豁免 ⇒ 30 顆樹族節點紅 25 顆 |

現役 6 顆:`rock/facet_b`(13 環)`mega_d`(12)`mega_e`(4 環 + 碎屑)`mega_f`(2)`mesa_a`(19)、
`building/ac_a`(16)。**節點一顆都沒刪**、遊戲照舊吃它們,「半成品」分頁看得到並說明為什麼。

同輪兩個工具端的坑:①`mesh_sym.mjs` 的掃描迴圈住**模組頂層** ⇒ 一 import 就當場掃三支 GLB
並印表(同 `fetch_photos.mjs`)—— 關進 main 守衛;②`symStats` 的鏡射殘差是 O(n²) ⇒ 對照台
只准吃 `topoStats` 那一半。另修掉 `beacon/tank` 那一列的鍵是 `undefined`(帳用 `keys:` 陣列
而程式讀 `p.key`)—— 那一列以前**覆核存不進去**、`--report` 印出一行字面的 undefined。

### 5aq-b. 「加入」的第一條路是空的 —— 而那是量出來的,不是看一眼

既有 `out_*` 池裡從未出貨的語料產物只有 5 個,逐一驗過**沒有一個能出貨**:

- `ov_fde797a7` 裝飾藝術塔(本來要當 `mass_c`)—— 黏土圖是**一個中空的、帶垂直鰭條的方盒**:
  它是**立面局部不是整棟**,違反 §5ae 那條「整棟量體那一桶要整棟入鏡」。
- 惡魔塔 `ov_f94b5c10`(asymZ **0.400**)、磚砌煙囪 `ov_7f8d8e91`(0.647)、
  猴麵包樹 `ov_3ccffb3c`(asymX 0.121)—— **背面都是空的**,而使用者當初判定「另一面是空的」
  那顆 `mass_a` 只有 0.123。補這種空面的那把鏡像刀正是 §5aj-C 要退場的東西。
- 兩張紅杉 —— 冠層,§5q 已定案不走 img→3D。

### 5aq-c. ⚠ 逐型 instance 上界一直是錯的 —— 事後用指紋反推,而同參同色是常態

`measure_veg_tris` 舊制以「幾何參數 + 材質色」把場上的 InstancedMesh 對回 `VEG_DEFS`。
兩個症狀都沒有錯誤訊息:

1. **碰撞群的 instance 數被記給群裡每一列** —— blackforest 實測 broadleaf 與 birch 同報 438。
   工具自己說「上限偏緊」,但偏緊的方向會讓 `node_cap` 的**除數虛胖** ⇒ 合格的節點被擋在門外。
2. **對不上的整批靜默丟掉** —— 舊制只對上 **80** 個 InstancedMesh,而場上有 **341** 個。

改成**問建造端**:`buildVegMeshes` 蓋 `userData.vegKind / vegRow`(它本來就知道自己在建哪一型),
指紋只留作備援並印出「N 個沒有章」。**章蓋在那一支上,而它同時服務 GIANT_DEFS / GIANT_DECO**
⇒ 濾回本族是**規則**,舊制靠 `ref` 只收得到 VEG_DEFS 是**副作用**。

修正後(blackforest):conifer2 198→**99**、broadleaf 131→**43**、birch 131→**22**,
而**層總量逐位元不變**(198,741)⇒ 錯的只是歸屬。取樣面擴到六場(＋okavango / tamsui
= mangrove 與 deadtree 的上界場地)。連帶抓到 `lib_roster.conifer2.rows` 是 **4** 而實際是 2
(星盤那一輪之後它只剩 whole 兩列)。⇒ Σ 3,038 → **2,722**、`node_cap` 225 → **249**、
整層用量 **87.8% → 75.7%**。

### 5aq-d. 針葉三種入庫:參數早就寫好了,只是從沒上過畫面

`STAR_SPECIES` 的 fir / cypress / cedar 自 §5z-r 寫出來就只有 spruce(conifer2)出過貨。
同一支生成器、同一張語料、同一份 `check_star.py`(各 78 條全綠),差異來自樹種參數
**與各自的世界包絡**(絲柏 r 1.30 × 全高 9.60 最細高、雪松 r 3.10 最寬)。

| 節點 | 面數 | 消費端 |
|---|---|---|
| `tree/cf1_wood_a` + `cf1_crown_a` | 80 + 160 | `VEG_DEFS.conifer`(冷杉) |
| `tree/cf3_wood_a` + `cf3_crown_a` | 80 + 256 | `VEG_DEFS.conifer3`(柱狀絲柏) |
| `tree/cf4_wood_a` + `cf4_crown_a` | 80 + 128 | `VEG_DEFS.conifer4`(雪松) |

**名冊是除數 ⇒ 加六列會壓到既有節點**:`node_cap` 249 → **203**,而 `vleaf_a12/a20` 是 211。
**MUST NOT 改推導式讓自己過關** —— 把 whole 列從除數裡拿掉會讓 cap 跳到 318,那是為了讓
新增品過關而放寬一道安全閘。正確動作 = 把那兩顆就地減到上限內(211 → **198**),
外廓由 `_restore_ext` **逐位元還原** ⇒ 佈局數學(`vegSpan` / 冠幅 / 淨空)一格不動。
`normalize_parts.py --rework` 因此多一個選用的第四欄 `tri_cap`(軸給 `none` = 只減面)。

整層用量 75.7% → **83.8%**。

### 5aq-e. `mass_c`:同一個模型、同一組參數,差別只有選片

使用者選的第二段(T2 重生成)。目標鎖 `mass_c` —— `BLD_LIB.mass` 只有兩顆,而 §5aq-b 已證明
現成的候補不能用。先出 `bld_tower` 那 10 張的 contact sheet(人眼第一站):**兩張是 1932 年
畢業紀念冊的封面/封底、一張是拆除中的大樓**(§5ae 記過的那個坑還在語料裡),真正
「整棟入鏡 + 光源充足」的只有帝國大廈那張。

T2 跑兩張(`ov_38b02277` 帝國大廈 / `ov_f7730e98` 現代玻璃辦公樓),同一組參數
(`1024_cascade` / steps 12 / seed 1234),結果差很多:

| | 面數 | 開放邊 | 元件 | asymX | asymZ |
|---|---|---|---|---|---|
| `ov_38b02277` | 48,748 | **0** | **1** | **0.002** | **0.001** |
| `ov_f7730e98` | 47,816 | 50 | 17 | 0.023 | 0.089 |

前者是**第一顆背面不是空的整棟量體節點**(`mass_a` 是 0.123 —— 使用者當初對著定場圖說
「另一面是空的」那一顆)。黏土四面圖:完整的退縮塔 + 尖塔,四面一致。
實體化沿用 `mass_b` 那一組(`--cells 72 --offset 0.006 --target 2900`)**一格未調**
⇒ 2,900 面 / 0 開放邊 / 1 元件 / kf_p95 0.92% / dev_p95 0.88%(mass_b 是 1.06% / 0.84%)。

**這一輪最該記的一句**:同一族的 `ov_fde797a7` 照片本身是一整棟現代主義板樓,但生出來的是
**一塊中空的、帶垂直鰭條的立面碎片** —— 而它在三角形 / 外廓 / watertight 上都可以是綠的。
⇒ **「整棟入鏡」這一條沒有離線閘門能代勞,只有黏土圖看得出來。**

`mass` 名冊 2 → **3 顆**;`pick_n` 不變(draw call 上界是「挑中幾棟」,不是名冊長度)。

### 5aq-f. 驗收

`mesh_sym --flaws` 6/48・對照台 **50 成品 + 6 收起** + **0 缺件 / 0 孤兒 / 0 未記載**・
`intake_parts` **300 綠**(輪前 269)・`audit_siteplan` 218(`--break-mass2` 4 紅)・
`audit_beacons` 68・`audit_object_joints --seeds 8` 21,611-0・`audit_soft_stroke` 73・
`audit_world_height` 49・`audit_cel_pipeline` 52・`audit_visual_prefs` 124・
`audit_gpu_lifecycle` 54・`audit:net`・`audit_solo_boot`・
`npm test` 全綠(fresh server + `WS_URL`)・`npm run bal` 全綠(⑦f 1.78×)。
反向驗證:拿掉樹族豁免 ⇒ 25/30 紅;小洞(0.29 / 0.50)與 `chimney_a` 的 122+94 兩件不誤判。

### 5aq-h. 語料清倉:300 → 163 張(使用者「刪除不符合目標 / 混雜太多干擾 / 光線不足 / 無法乾淨分離主目標的 img」)

四條判準與 `screen_mattes.py` 既有的五個桶一一對得上(①剝空/主體太小 ②印刷品 ③葉片標本
④多主體 ⑤光源不足),而門檻本來就是拿**已出貨來源**校準到零誤殺的 ⇒ 不新增第二把尺。
流程 = 統計淘汰 → 三張 reject sheet 逐格人眼複核 → 四張 watch sheet(統計分不開的那一帶)人眼判決。

| | 統計 | 人眼追加 | 合計刪除 |
|---|---|---|---|
| building | 33 | 21 | 68 |
| tree | 44 | 4 | 47 |
| rock | 10 | 15 | 26 |
| landmark | 0 | 0 | 0 |

**141 張 + 對應 matte,釋出 385.8 MB;已出貨來源 0 張被碰到。**

人眼在 reject sheet 上複核到的東西(統計抓對了):顯微雪花結晶、四張慕夏新藝術風少女圓窗畫
(掛在 `window` 底下)、十誡石版、一匹馬、穿紅外套的人、木構屋版畫、立體視鏡卡、建築藍圖、
1932 年畢業紀念冊封面/封底、紅杉前站著遊客。watch 帶再撈到的:熱氣球入鏡的蘑菇岩、
KAPADOKYA 紀念品模型、一支起司刨絲器(掛在 `sh_boxwood`)、單片紅楓葉、背包客。

**三條刻意的取捨**:

1. **帳本那一列留著當墓碑,只刪檔案** —— `fetch_photos.mjs` 的 `usable()` 不算 reject 條目,
   但**淘汰條目仍留在 `seen`** ⇒ 刪了列的下場是同一張垃圾下次原樣再抓回來。
   列上補 `pruned: { at, files }`;`id` 與 `source_url` 都還在 ⇒ 真要救得回來。
2. **統計分不開的一帶不收緊門檻**(那是 §5ah 定過的紀律)—— 進 watch sheet 交給人眼,
   而人眼在那 69 格裡只判掉 40 格:剩下的 29 格是「看得出主體、只是暗一點/小一點」,
   **刪不可逆而語料稀缺 ⇒ 邊際的留著**。
3. `wc_112762573`(舊 hoodoo 來源、§5ah 的反例存證)照樣刪 —— 它的 matte 裡站著一個人,
   確實踩到「只有目標物件」那一條。§5ah 的結論已經寫在 runbook 裡,不靠留著那張圖。

### ⚠ 5aq-i. 順手量到:樹族選片閘對**現行**出貨名單已經有一筆誤殺

`ov_71b76588`(tualang 樹冠,`canopy_h10`/`canopy_h65` 的來源)被今天這一輪判 `blank`。
檔頭寫的「拿 82 張 matte 校準、人眼已判可用的 16 張零誤殺」還在,但**那份硬約束名單自
2026-08-07 之後沒有跟著出貨名單長**(§5ah 已經把基準改成「已出貨的來源 id」,而 tree 族的
`BLANK_COV`/`MIN_CANVAS` 沒有重新對過)。本輪以 `--human pass` 救回,**門檻沒有動**
—— 為了一個樣本去鬆門檻就是過擬合(同 §5ah 熱氣球那一條)。下一次動 tree 族門檻時
MUST 先對 31 張已出貨來源掃一遍零誤殺,並把「從哪個值開始誤殺」記下來。

### 5aq-g. 未做

- **真機冒煙**:①綠地場地看**四種針葉**是不是分得出來(冷杉 / 絲柏 / 雪松 / 雲杉);
  ②`vleaf` 減面後樺樹與紅樹林的葉團(198 vs 211,肉眼應該看不出來);
  ③`shot_scene --venue taipei101 --live` 的 `mass_near` 機位看第三顆塔有沒有出現。
- `audit_traverse`(㋓ 需網路)。
- ~~語料清理~~ **DONE(§5aq-h:300 → 163 張)**;`ov_f7730e98` 的產出(17 元件)仍留在 `out_5aq/` 沒採用。
  館藏源仍沒進 `EXCLUDED_SOURCES`(那是**抓取端**的閘,這一輪只清了已經抓下來的)。
- **六場量測是離線 fallback**(`--live` 未跑)。`measured_max_instances` 的語意因此是
  「程序生成佈局下的上界」;要對真圖資也成立得補一輪 `--live`。

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

**Framing is measured, never derived from the descriptor** (2026-08-06, silent bug 4). `whole` frames
the group's own bounding sphere; `part` shows only the meshes that were **swapped**, hides the rest,
and points the camera at the **largest** hit — one node is placed many times (`rock/mega_a` sits in 7
places across a 290 m outcrop), so framing their union turns every one of them into a dot.

Finding those meshes takes two passes, in this order. First, identify them **on the generated side by
measured vertex count** (`megaGeo` / `buildBeacon` both clone, so the count survives) and pair the
original side **by position** (centre inside the node's bounding sphere × `PAIR_F`). Never assume the
two panes' traversal indices line up: the imperative megalith builder replaces several primitives
with one library node (measured 92 → 49 meshes), so index pairing misses all of them and the only
symptom is "this row fell back to whole". Second, if the count identifies nothing — beacons merge by
material (cairn: 11 parts → 8 meshes), so the node's vertices are mixed into a bucket — fall back to
the **per-index diff** = "everything this kind swapped"; that path does require equal mesh counts.

When it does fall back to `whole`, say **which** reason: "this seed doesn't use this node" (the
imperative megalith picks types per seed — and the board names a seed that does) is not the same as
"the board couldn't pair them", and writing one message for both turns a working button into a
broken-looking one. The seed set must cover every library node: `[1, 3, 7]` reached neither
`rock/mega_e` nor `rock/mega_f`, hence `[1, 7, 10]` — re-scan when nodes are added.

Hiding is not a second assembler — the group is still the game's own, vertex for vertex — and the
readout still measures the whole prop, so it cannot lie. `near`/`far` track the distance.

**Four silent bugs found so far** (this is what the board is for):

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
4. (2026-08-06) Owner: *「PR147 畫的 3D 物件在零件展示台沒有看到,只看到跟舊有物件重繪」*. Bug 3
   put the megaliths on stage; the **camera** then kept them off screen. Framing came from the
   offline descriptor and the registered collider, neither of which is the thing on stage, so one
   cause produced three symptoms: the camera always looked at `(0, y, 0)` (giant-tree canopy nodes
   sit 5.8 m off axis and never made it to the middle of the frame); the distance was `collider
   height × 1.35` with no horizontal term (a 58 m tall, 207 m wide megalith put the camera *inside*
   the rock — a flat grey wall in both panes); and unit-envelope nodes (`ico(1)` at `[0,0,0]`) could
   not be framed at all, so the 零件 button was simply disabled for `rock/mega_*`. Net effect:
   PR #147's output was on the board and unviewable. Fixed as above; `far` was also pinned at 500,
   which turned the 290 m outcrop into an all-black pane once the camera did back off far enough.

## 5ar. 採集端改制 + 首跑實測(2026-08-10 — 使用者四條:附註 / 週期跑 / 更精準的字 + 自己放圖)

使用者對著零件台的原話:「**有的沒有樹根、有的只有樹根、有的破洞,幾乎沒看到成品**」,
接著四條:①未完成的加附註 ②因為成功率太低,跑腳本週期性抓更多 img 跑 img→3D
③搜圖要用更精準的關鍵字,盡量抓背景乾淨、干擾少、目標清晰的圖 ④提供自己放圖的地方。

**① 附註 —— 「沒有樹根」大多不是破圖,是台上一列 = 一顆節點。**
`parts_review.mjs` 每一列多一個 `notes[]`,四種來源合成、**全部推導**:

| 來源 | 例 |
|---|---|
| 整件的一層(組件:`KIND_PARTS` / `VEG_DEFS`·`GIANT_DEFS`)| `tree/bl_wood_a`:「這一顆是『broadleaf』的其中一層,同一件還有 `tree/bl_crown_a`」|
| 輪替名冊(`MEGA_LIB` / `BLD_LIB`)| `building/mass_a`:「『mass』這一格有 3 顆輪替節點,逐座號挑一顆用 —— 這一顆本身就是完整的一件」|
| 量到的缺陷(`mesh_sym.nodeFlaws`)| 破口 16 條邊界環・周長 15.3× 跨距 |
| 覆核意見(`state.json` 的 note)| 太薄不立體 |

**兩種兄弟 MUST 分開講**:把輪替名冊講成「整件的一層」會讓人以為 `mass_a` 只是大樓的一層,
而它就是整棟。分流只認 `table`,MUST NOT 逐節點手寫名冊。附註畫在**清單**上(整句進 `title`)
—— 使用者那句話是掃過整份清單得到的印象,只放在細節頁等於沒答。

同輪補上**「服務中的 checkout」戳記**(標頭 + `--report` 第一行):`dev_supervisor` 的 spawn 是
`{ cwd: ROOT }` = 啟動它的那支遊戲伺服器自己的儲存庫根 ⇒ 從舊 worktree 開的台子每一件都停在
那個 commit,埠不衝突、頁面正常、沒有任何錯誤訊息。實測三支舊 server 全部少了 `mass_c` 與
三種針葉,而結論被讀成「worktree 裡調整的都沒進來」。

**② 週期採集 `tools/ai3d/harvest_loop.mjs`** —— **不是新管線**,只是把既有七站照順序、隔一段
時間再跑一輪:收編 inbox → 抓照片 → 去背 → 選片閘 → img→3D → 實心度快篩 → contact sheet。
`--every` 預設 15 分鐘(`upload.wikimedia.org` 撞 429 之後 `Retry-After: 600`,調短只會讓封鎖續期);
`--rounds 0` = 一直跑。四條紀律:每一站可缺席、只餵**新的且選片閘沒淘汰**的 matte
(`harvest_state.json`)、**刻意跑到 contact sheet 為止不入庫**(自動入庫擋不住的正是「統計全綠、
內容是一張版畫」那一類,§5h 一輪擋下六顆)、每輪一列 JSONL 進 `harvest_log.jsonl`。

**逐族選模型**(§5n:T2-spz 對建築是雙 ◎,SF3D 在同一張仰拍煙囪上出的是歪塊):building 走
`run_t2_gate.py`(餵入先過 `binarize_feed.py` —— T2 的 preprocess 以 alpha>204 取 bbox,軟 alpha
漸層段會被整段裁掉),其餘走 SF3D。**沒給 `--t2` 就不生成建築,而不是退回 SF3D** —— 悄悄退回去
只會讓語料庫多幾顆一樣要重生成的節點。

**③ 取景階梯 `CLEAN_Q`** —— 加的是**取景**(背景乾不乾淨、光夠不夠),型錄的 `q` 是**主體**
(具名單一主體句式,§5c)。混寫進同一行就再也拆不開;而且取景字必然讓候選池更小
⇒ **先跑型錄原句,缺額還在才走階梯** ⇒ 供給充足時逐位元同舊行為。逐族分開;設計圖列不套。

**④ 自己放圖 `<資料家>/inbox/<族>/<零件>/` + `--adopt`** —— 收編後與抓下來的照片走完全同一條路。
三道閘一道都不鬆:授權只收 CC0/PD(**CC-BY 也拒**)、magic bytes、短邊 ≥1024(自己解 PNG/JPEG/WebP
檔頭,A2 不准加相依)。不合格的**留在 inbox 不動**。`inbox/` MUST 在 `photos/` 之外(放進去會被
`matte_photos.py` 當成一個「族」整批去背)。

### 5ar-a. 首跑實測(3060 那台,`harvest_log.jsonl` 逐輪記帳)

| 量 | 值 |
|---|---|
| 輪數 / 總生成 | 10 輪 / **157 顆**(SF3D 111・T2-spz 46)|
| 總下載 | **12 張** —— 見下方「供給側才是瓶頸」|
| SF3D 實心度「塊狀候選 ◎」| 36~46%(逐輪 29~50% 抖動)|
| 積壓 | 148 → 31 張(rock / landmark / tree 已清空,剩 building)|

**迴圈自己的三個 bug —— 全部同一族:跑起來很正常,只是某一半靜靜地沒有輸出**

1. **選片閘只跑 tree**:`screen_mattes.py --family` 預設 `tree`,不逐族傳的話另外三族一張都不驗。
   實得影響比第一時間判斷的小(①cov / ②fill 兩條門檻本來就只在 tree 生效,非校準族只剩 ④⑤)——
   真正掉的是**那三族的觀察名單 sheet 從來沒產出**(building 15 / rock 8 / landmark 3)。
   修法:逐族各跑一次,族名 = matte 目錄 ∩ 帳本 `family`(兩邊都推導)。
2. **`out/matte/` 裡的空殼目錄**(實測 `bld_tower/` 只剩一張 .sheet —— 那是零件名不是族名)⇒
   直接拿目錄當族名會餵給 screen_mattes 一個不存在的族,回傳 1、一張都沒驗,日誌上只是一行雜訊。
3. **⑤⑥ 只吃 SF3D 目錄**,而且 `mesh_stats`/`mesh_sheet` 只認 `<i>/mesh.glb` 版面(T2 是扁平
   `<名字>.glb`)⇒ **46 顆 T2 建築既無統計也無任何一張圖**,而「人眼那一步不可省」正是這一族的
   驗收方式。修法**刻意不對稱**:⑥ contact sheet 兩路都跑(黏土縮圖與形狀假設無關);
   ⑤ 實心度快篩**只對 SF3D** —— 它的門檻是拿 SF3D 產出校準的,而 T2 原始輸出本來就是雙層撕裂
   薄殼(必須先過 `solidify_parts.py`)⇒ 同一把尺會把每顆建築判成「殼/碎片 ✗」(實測 fill 0.003~0.12),
   那是尺用錯了不是東西壞了。兩支工具同時補上扁平版面支援,舊版面逐位元不變。

**供給側才是瓶頸,不是產出率**:九輪只下載到 12 張(Openverse/Commons 的 CC0 池對這批查詢已近
抽乾,`upload.wikimedia.org` 全程 429)。`--limit` 調大無效 —— 這也正是 `CLEAN_Q` 只在缺額時
才啟用的理由(池子本來就小,先問窄的會一張都撈不到)。真正能改變供給的是**使用者自己放圖**。

**還沒做的**(交接):151+ 顆產出**一顆都還沒經過人眼**(sheet 已全數產出:9 張 T2 + 7 張 SF3D,
住 `out/{sf3d_auto,t2_auto}/<時戳>/.sheet/`);使用者判「重生」的四顆仍未重生成
(`mass_a`/`mass_b`/`masslow_a` 太薄不立體、`ac_a` 邊角已風化),候選要從 building 那批 T2 產出裡挑
(判準 = §5ae 的「整棟入鏡,不是最好看的局部」—— 那是 `mass_c` 成功而 `mass_a` 太薄的唯一差別)。

## 5as. Trial log (2026-08-10 第二場 — 人眼那一步跑完了:**169 顆全看過,零節點出貨**,而理由在供給側)

> 做的是 §5ar 交接單上那兩件:①把首跑的產出全部過人眼 ②從中挑出能重生成那四顆的候選。
> ① 做完了(結論在下面);② **做不到,而且是量出來的做不到** —— 順手撈到迴圈自己的兩個
> 「白燒 GPU」缺口,兩道閘已補上並逐條行為驗證。

### 5as-a. 先把缺的三張 sheet 補齊,再看

`out/t2_auto` 的最後三輪(22-29-34 / 22-58-26 / 23-22-01)有 GLB 沒有 sheet(迴圈被 Ctrl-C 收在
第 8 輪的 ⑥ 之前)⇒ 補跑 `mesh_sheet.mjs --cols 6 --cell 240`。**總量因此不是交接單寫的
151+,是 169**(T2 建築 64 + SF3D 105),sheet 19 張(T2 12 + SF3D 7)。

### 5as-b. 人眼複核結果(逐族;可用率是這條管線唯一真正的讀數)

| 族 | 顆數 | 可用(整件、實心、四面都有內容)| 說明 |
|---|---|---|---|
| **building**(T2-spz)| 64 | **~12(19%)** | 其餘是立面碎片、平板、開頂空盒。整棟入鏡的照片才出整棟 —— §5ae 那一條再次成立 |
| **rock**(SF3D)| 60 | 多數是能看的岩塊,但岩族名冊已有 12 顆 | 突出的只有兩顆 mesa/butte(20-08-14 #5/#8)與一顆真的長得像 dolmen 的(20-19-53 #3)|
| **tree**(SF3D)| 33 | **冠層一顆都不可用** | 全是無特徵馬鈴薯 ⇒ **§5q「葉冠不走 img→3D」再次被證實**;只有板根(20-19-53 #16~19)有形 |
| **landmark**(SF3D)| 11 | **0 —— 而且結構性地不可能** | 見 5as-d ② |

### 5as-c. 那四顆「重生」:候選掃完了,**這一批語料裡沒有更好的**

先把「太薄不立體」量出來,而不是憑印象。四面黏土(`node_sheet --nodes mass_a,mass_b,mass_c,masslow_a,masslow_b,ac_a`)
+ 逐節點 bbox 平面長寬比 `min(dx,dz)/max(dx,dz)`:

| 節點 | 平面比 | 判決 | 黏土上看到的 |
|---|---|---|---|
| mass_b | **0.276** | regen | **真的是一片板** —— 兩個側面只有 0.26 寬,消費端再把它拉到建物自己的足跡 ⇒ 整棟糊掉 |
| mass_a | 0.900 | regen | 不是薄,是**稜線被磨圓 + 立面凹槽變成侵蝕溝**,讀起來像一塊岩不像建築 |
| masslow_a | 0.701 | regen | 牆是鼓起來的平面、底緣是撕的 —— 「融化的紙盒」 |
| ac_a | 0.573 | regen(邊角已風化)| 圓角方箱。使用者的用詞就是準確的診斷 |
| **mass_c** | **0.990** | (未複核)| 稜線清楚、四面都有量體 —— **這一輪的標準件** |
| masslow_b | 0.571 | ok | 平面比比 masslow_a 還低卻被接受 ⇒ **平面比只解釋得了 mass_b 那一顆** |

⇒ 四顆裡有三顆的共同病灶是**稜線被磨圓**(`--offset` 的等值面外推 + quadric 減面各磨一次),
不是選片。而 `mass_c` 走的是**一模一樣的配方**卻沒事 ⇒ 差別仍在照片。

**候選掃描**(六顆 T2 產出 × `--cells 56~72` × `--offset 0.006~0.030`,共 27 次 solidify,每次 ~9s):

| 候選(來源)| 最佳解 | 開放邊 / 元件 / kf_p95 | 平面比 | 為什麼不出貨 |
|---|---|---|---|---|
| 陽台板樓 `ov_e9a64f2b` | c56 o0.024 | 0 / 3 / **6.31%** | 0.679 | 唯一實心的高層候選,但陽台橫帶是深凹槽:留著 = 14~33 元件,填掉 = 偏差 6.3%(出貨件是 0.83~1.99%),而填掉之後它就只是一個素方盒 —— 這一桶的存在理由正是「比方盒多一個剪影」|
| 磚造倉庫 `ov_488a02ed` | o0.014 | 0 / 2 / 1.96% | 0.434 | 量體漂亮(四坡頂 + 塔),但**旁邊浮著一塊分離元件**;`--mode resample` 沒有「取最大元件」 |
| 蒙古包 `ov_75396782` | o0.010 | **0 / 1 / 1.27%** | **0.930** | **數字是整批最好的一顆**,但 masslow 服務的是每一張圖的 `!commercial && h ≤ 55` ⇒ 進名冊等於澀谷的住宅區長出蒙古包 |
| 石屋 `ov_3966cc35` | o0.014 | 0 / 2 / 1.86% | 0.469 | 側面仍是薄卡片,沒有比現役 masslow_a 好 |
| 公寓 `ov_e6d35a2a` | o0.014 | 0 / 3 / 1.72% | 0.959 | **開頂空盒**(黏土從上方看得進去)|
| 五重塔 `ov_e3bdfbad` | o0.006 | 0 / **63** / 2.47% | — | 逐層屋簷橋不起來 |

**高層那一桶(mass)更是結構性沒有候選**:`bld_tower` 這一列的照片**全部跑過了**,
活下來的三張已經就是 mass_a / mass_b / mass_c 本身(見 5as-d ①),其餘四張是碎片/薄板
(`ov_c343cdcb` 碎裂、`ov_fde797a7` 中空立面碎片 —— §5aq 已存證、`wc_156266417` 一根細柱、
`wc_378871` 亂片)。**⇒ 這一輪零節點出貨,而理由和 §5ai 同一種:形狀不是品質。**
要動這四顆,唯一有效的輸入是**使用者自己放圖**(`--inbox` / `--adopt`,§5ar ④)——
這正是首跑實測「供給側才是瓶頸」那句話的第二次確認。

### 5as-d. 順手量到的:迴圈自己在兩個地方白燒 GPU(兩道閘已補,行為驗過)

兩者同一族:**跑起來完全正常,只是某一部分的產出從一開始就沒有出路**。

1. **已經出貨成節點的來源被重跑** —— `harvest_state.json` 只記得「**這支迴圈**餵過誰」,
   而出貨那幾顆的 matte 是更早的手動輪做的 ⇒ 64 顆 T2 產出裡有 **6 顆(9.4%)** 是
   `mass_a`/`mass_b`/`mass_c`/`masslow_a`/`masslow_b`/`chimney_a` 的**同一張照片**。
   工具是決定性的 ⇒ 同一張圖 + 同一組參數 = 同一顆網格:燒了 GPU,還把已經判過的東西
   塞回人眼複核的池子裡(這也是為什麼 5as-b 的建築「可用 12 顆」裡有三顆是舊識)。
   **閘 = 來源帳 `imgs[].id`**(`loadProvenance()`,推導不手寫)。
2. **landmark 族沒有消費端** —— 能載進遊戲的零件庫只有 `PART_LIBS = ['rock','tree','building']`,
   **沒有 `landmark.glb`**:那一族走的是 Route A(讀照片、手寫純資料 primitive 進
   `beacons.js KIND_PARTS`,§5e 的 `tank` 就是這樣出貨的)⇒ 首輪那 **11 顆 landmark 網格
   今天沒有任何東西載得到**。**閘 = `partLibs()` 推導**(哪天真的開了 `landmark.glb`,
   它自己就會回到待跑名單);**只擋生成不擋抓圖與去背**(Route A 要看照片),
   而且**不寫進 `done`**。

兩道閘都 MUST **把擋掉幾張印出來**(skill 的 no silent caps):靜默略過讀起來就是
「本輪沒有新的」,而那正是要修的那個症狀本身。

**行為驗證**(不是靜態斷言,這一支沒有離線稽核):`--rounds 1 --no-gen` 印出
「1 張已經出貨成節點 ⇒ 不重跑」;把 `harvest_state.json` 的 landmark 鍵暫時拿掉再跑 `--dry`,
印出「**10 張屬於 landmark 族 ⇒ 沒有 landmark.glb 這個消費端**」與「4 張已經出貨」,
跑完原檔還原(`--dry` 不寫 STATE,13 個 landmark 鍵原樣回來)。

### 5as-e. 驗收

`node --check` + `intake_parts` **300 綠** + `parts_review --report` **0 缺件 / 0 孤兒 / 0 未記載**
(`ac_a` 本來就已經在「半成品」那 6 顆裡)。**遊戲一行未動** ⇒ `npm test` / `npm run bal` ㋒ 不受影響。

### 5as-f. 未做 / 交接

1. **那四顆仍未重生成**,而下一步不是再掃一次語料,是**等使用者放圖**(§5ar ④ 的 `inbox/`)。
   放圖時最有效的三張:①一整棟 Art Deco / 現代高層,整棟連冠頂入鏡、光線均勻(→ mass_a / mass_b)
   ②一棟普通兩三層透天/公寓,四十五度角整棟入鏡(→ masslow_a)③一台屋頂空調冷凝機組的正面
   斜拍、背景乾淨(→ ac_a)。
2. ~~`ac_a` 路線待定~~ — **2026-08-10 使用者定案「等乾淨照片再重生成」**(維持 img→3D)⇒
   它與另外三顆併成同一件事:等 `inbox/` 的圖。改走 Route A 那一案不採用(§6-5)。
3. `--mode resample` 沒有「取最大元件」⇒ 磚造倉庫那種「量體好、旁邊浮一塊」的候選現在無解;
   `--mode wrap` 有(§5t ②),但它是給細枝主體的。要不要幫 resample 也加一道,是下一輪的題目。
4. 兩道新閘讓下一輪的有效產出率結構性上升(首輪 64 顆裡的 6 顆 + 11 顆 landmark = **26%**
   的 GPU 時間本來就沒有出路)—— 但**這個數字要下一輪的 `harvest_log.jsonl` 才驗得到**。

## 5at. Trial log (2026-08-10 第三場 — 回頭補 Route 0 與 Route A:**A 出貨一顆,0 仍是零,而理由換了**)

> 使用者:「回頭完成 0 和 A 的管線」。兩條都是**零 GPU、離線可驗**,所以都做得動。
> 結果不對稱:**A 出貨 `beacon/pylon`**(讀 4 張 CC0 照片重寫零件表);
> **0 仍然零節點,但 §5ai 記的那個理由已經不成立了** —— 換成兩個新的、量出來的。

### 5at-a. Route 0:舊的阻塞解除了,新的阻塞是**語料的形狀**與**兩視圖外殼的本質**

§5ai 當時零節點的理由是「唯一乾淨的線稿是寬矮宅邸,而唯一吃整棟量體的桶是 `mass`(商辦塔樓)」。
**§5am(2026-08-09)開了 `masslow` 之後,那個理由消失了。** 於是這一輪真的把它跑完:

兩張 HABS 圖(`wc_33743891` 東立面 / `wc_33743892` 南立面)是**同一棟**(HABS No. CA-2177)⇒
正好是 `--front` + `--side`。裁切後外殼**做出來了**:446 面 / watertight / 外廓 [3.64, 1.00, 3.72]、
**平面長寬比 0.97**(比現役每一顆 mass 節點都好)。然後它不能出貨,兩個理由:

1. **兩視圖的視覺外殼會把任何突出物變成一片刀刃。** 南立面的煙囪 × 東立面的全深度 ⇒ 煙囪
   變成貫穿整個進深的薄片;非等向 fit 再把它拉高 3.2 倍,黏土圖上是一塊帶尖刺的墩子。
   把屋頂細節裁掉重跑(massing-only)仍有殘餘鰭片,而且元件 1 → **3**。
   ⇒ **這是兩視圖外殼的結構性質,不是這張圖的問題**:要嘛給 `--plan`(屋頂平面)把刀刃切掉,
   要嘛主體本身沒有突出物。而它**在每一個讀數上都是綠的**(watertight / 外廓 / 面數)。
2. **屋頂帶 parity 對不上,而且是名冊層級的衝突。** 平頂量體 normalize 後 parity **0.147**,
   而 `masslow` 名冊的 `ROOF_BAND = 0.273` 是**兩顆坡屋頂節點的平均**(穀倉 0.272 / 教堂 0.275)。
   ⇒ 加一顆平頂進去,三顆**全部**掉出 ±0.03(平均變 0.231)。**`ROOF_BAND` 取名冊平均這件事
   只在名冊屋頂型式同質時成立** —— 這一條之前沒有人寫下來。平頂該去的是 `mass`(它量到
   0.138/0.124,刻意不開屋頂帶),但 `mass` 服務的是 `h > 55m` 的商辦塔樓。

**順手量到一個假陽性**:`plan_to_mesh` 的「這是渲染圖」閘門(輪廓內墨密度 > 25%)在這張
**真的 HABS 測繪圖**上讀到 **27.3%**(§5ai-c 校準值:HABS 11.4%、渲染 32~71%)。成因是這張
圖的尺寸線/引線/花架格柵特別密。25~32% 是**統計分不開的那一帶** ⇒ 依 skill 的
「分不開就觀察,不要收緊」,正確做法是把它降成**觀察帶**(警告 + 放行 + 記進待人眼名單),
而不是把門檻往上搬 —— 尚未實作,見 §5at-d。

### 5at-b. Route A:`beacon/pylon` 出貨(Route A 的第 2 顆)

讀 `landmark/lattice` 那 4 張 CC0 電塔照片(型錄 4/4 已滿)重寫零件表。**改的是格構本身**:
照片裡整座塔看過去就是一片 X 斜撐,而舊表是四根光禿禿的柱子 + 兩層橫擔。補兩件事:
①逐面 **X 斜撐**(下段/腰身各一組,16 塊)②上下 **橫箍**(8 塊;少了它斜撐看起來像浮在空中)。

**斜撐的長度與傾角是算出來的**(跨距/落差 → `Math.hypot`/`atan2`),不是手寫 —— 手寫的話
改一次腳的座標,斜撐就脫離腳浮在半空,而外廓稽核照樣全綠;`audit_object_joints`
(21,611 接合 / 0 異常)是這一條的守門線。

**`foot` 8.0 → 9.2**:`kindExtent` 對傾斜件是**保守**的(位置半徑 + 該件 3D 半對角,
不是真的旋轉後外廓)⇒ 12.4m 長的斜撐記 9.12m。**腳的座標一格未動** —— 這不是「塔變胖了」,
是稽核模型對斜撐收的稅,與 P2b 水塔補 X 斜撐時 foot 5.2 → 5.6 同一筆帳:**照實算改標稱**。
(檔頭那條「不用傾斜件表現外張」仍然成立:那說的是**往外張**的腳;斜撐兩端釘在腳上,
它的頂點都落在腳圍出來的方框內。)

### 5at-c. 驗收

`audit_beacons` **68 綠** + `--break-extent` 反向紅;`audit_object_joints --seeds 8` 21,611 / **0 異常**;
`intake_parts` 300;`audit_siteplan` 218;cel 52 / gpu 54 / soft_stroke 73 / world_height 49;
`npm test` 全通過(fresh server, `WS_URL=ws://localhost:8666`);`npm run bal` 全綠;
`tools/shot_beacons.mjs --kind pylon` 目視(X 斜撐與腳接得住)。來源帳已記(含 `baseline.rev`)。

### 5at-d. 未做 / 交接

1. **Route A 還剩兩款**:`mast`(語料 `landmark/dish` 3 張,型錄 3/3 已滿)、
   `depot`(`landmark/container` 3 張,3/3 已滿)。方法已驗證、語料已就位 ⇒ 純執行。
2. **Route 0 需要的是不同的語料**:一棟**沒有突出物**的簡單量體 + 兩張乾淨正交立面
   (或立面 + 屋頂平面)。`dwg_tower` 目前 0/4(9 張被選片閘淘汰)。
3. **渲染圖閘門降成觀察帶**(25~32%),連同「`ROOF_BAND` 取名冊平均只在屋頂型式同質時成立」
   這一條寫進 `tri_budget.json` 的 `staleness`。
4. 本輪的中間檔(裁切圖 / 外殼 GLB / 黏土圖)在 scratchpad,**未入庫**。

## 5au. Trial log (2026-08-10 第四場 — 圈選 + 分離 + 三道篩選:**一張照片好幾個目標,不再整張丟掉**)

> 使用者定案:「同一張照片可能有好幾個目標,**圈選目標,分離,篩選太模糊 / 太小 / 完整度太低的**,
> 再進入 img to 3D 管線」。改制前這件事是**反過來做**的 —— 選片閘 ④ 一看到多主體就把**整張照片**
> 淘汰(帳上 24 張),而勉強過閘的那幾張會把「一座水塔加一整棟房子」原封不動送上 GPU。

### 5au-a. 判決的單位從「一張照片」變成「一個目標」

新的一站 `split_targets.py` 排在去背與選片閘**之間**(順序不可對調 —— 反過來的話多目標照片會先被
④ 整張淘汰,那兩個目標從此再也回不來):

```
photos/ ──matte_photos──▶ out/matte/<fam>/<part>/<id>.png
                              └──split_targets──▶ out/targets/…/<id>~1.png, ~2.png  + 帳本 entry.targets[]
                                                      └──screen_mattes──▶ 逐目標判決 → targets[i].screen
                                                                          entry.screen = 還有一個活著就 pass
```

**圈選不需要第二個模型**:matte 的 alpha 本身就是 rembg 圈好的,缺的只有「分離」。這與 ④ 的既有
doctrine 同一條(「量在 matte 上而不是照片上:hoodoo 的贏家原圖有三顆蘑菇岩加電線桿,而去背只留下
一顆」)—— u2net 沒圈到的東西這一站也救不回來,那是已知上界不是 bug。

**分離規則 = 面積佔比 + bbox 包含,不是數塊數**(④ 檔頭量過:已出貨的桁架水塔有 4 塊,那是一個
主體的腿被 alpha 切斷)。由大到小掃元件:bbox 被既有種子蓋掉 ≥ `CONTAIN_F` 0.60 ⇒ 併回那個主體;
沒被蓋到且面積 ≥ `SEED_F` 0.12 ⇒ 新目標;兩者皆非 ⇒ 碎屑。

**單一主體且碎屑 < `DEBRIS_MIN` 3% ⇒ 一個檔都不產**(帳本也不長 `targets` 欄)⇒ 既有 181 張 matte
與它們的下游逐位元不變。切出來的檔案是**額外**的,母 matte 永遠留在原地(誤切要救得回來)。

### 5au-b. 「已出貨的來源被切開」不算誤殺 —— 校準名單本身是錯的(這一條最反直覺)

第一版跑出來,**兩張已出貨的 `landmark/tank` 被切成 2 塊**,看起來是誤殺、差點就去把門檻放寬。
把元件上色印出來一看:**那兩張本來就各有兩個物件**(一座水塔 + 一整棟房子)。它們之所以「已出貨」,
是因為走的是 **Route A(`llm_parts`)—— 人眼讀照片、手寫 primitive,matte 從來不是它的輸入**。

⇒ 零誤殺的硬約束 MUST 只算 **matte 真的餵過生成器**的來源(`CAL_METHODS` = sf3d / trellis2_spz /
hunyuan_2gp / simple_geom_tree,**27 張**),名冊由 `parts_manifest.json` 的 `method` 推導。
那 27 張在新規則下**一張都沒有被切開**。連帶發現:**既有 ④ 的門檻 0.70 當初正是拿這兩張 llm_parts
的 0.778 校準的** —— 那個數字一直在要求選片閘放行多主體照片(這一輪沒有動它,只是記下來)。

### 5au-c. 三道篩選:兩道是新的,「太小」不是

| 條件 | 住哪 | 門檻 | 校準(27 張的最不利值) | 實測淘汰 |
|---|---|---|---|---|
| 太小 | **既有的 ①** `MIN_CANVAS` | 300px | — | 切開後自動變成逐目標的量 |
| 太模糊 | ⑥ `SHARP_MIN` | 0.25 | 最低 0.473(**1.9× 邊際**) | 1(一條魚 0.156) |
| 完整度太低 | ⑦ `CUT_RUN` + 邊框接觸 | 0.35 | 頂邊最高 0.18(**1.9×**) | 2 |

「太小」**刻意不做成新的閘**:①的 `MIN_CANVAS` 量的就是「這個主體在原圖裡有多大」,切開之後它
自動變成逐目標的量(實測 `st_dolmen` 的第二顆石頭 226px ⇒ 判 blank)。多寫一條就是第二把尺。

**⑥ 模糊的三個坑,全部踩過**:
1. **只縮不放**。第一版把主體長邊**放大**到 512,結果已出貨的 canopy `ov_71b76588`(主體只有 54px)
   量出 0.057 —— 全場最低,而它是人眼救回來、後來出貨成 `canopy_h` 的。那不是「模糊」是「小」,
   而小已經有 ① 在管。改成只縮不放之後,校準名單的下限從 0.057 跳到 0.473。
2. **除以主體亮度標準差**(深色玄武岩不是失焦,同 ⑤ 的理由)。
3. **先侵蝕遮罩再取樣**。matte 的輪廓是「主體 vs 全透明」的硬邊,Laplacian 在那裡爆表 ⇒ 不侵蝕的話
   **每一張都銳利**(反向驗證 `--break-erode` 實測:模糊的那張從 0.082 變成 0.891)。

**⑥ 刻意不收到 0.30**:那會多殺一支衛星天線(0.262)與一顆砂岩(0.279),兩者都不是失焦而是
**表面本來就沒有紋理**。這把尺分不開「光滑」與「失焦」⇒ 線壓低,0.25~0.50 那一帶進觀察名單。

**⑦ 截斷 MUST 看「有沒有碰到照片邊框」,而那個資訊在去背當下就丟掉了**:畫布是「裁到主體 + 補邊」
做出來的,補完之後一棟屋頂被切掉的房子與一個平頂貨櫃長得一模一樣(實測 bld_halftimber 頂邊 run
0.88 是真的被切掉、container 0.48 只是箱子有平頂)。故 `matte_photos.py` 記 `entry.matte = {wh, origin}`
(畫布座標 + origin = 照片座標),`--rebbox` 一次補齊舊條目(**179 張 44 秒**;模型是決定性的 ⇒
不重寫 matte 只補帳)。缺這一筆 ⇒ **不評判**(寧缺勿錯)。

**只有頂邊當淘汰線**,底/左/右進觀察名單 —— 三個豁免各有一個已出貨來源當反證(這是量出來的,
不是憑感覺):底邊 = 地面接觸(`building/chimney` 底邊 run **1.00**);左右 = 橫向延伸的東西
(`tree/sh_boxwood` 左邊 run **0.82**,一排黃楊)。把三邊一起收進淘汰線,實測誤殺 2 個校準來源。

### 5au-d. 對現有 181 張語料實跑

- **切開 5 張**(→ 11 個目標)、**只清碎屑 4 張**、**171 張原樣不動**(不產檔 ⇒ 下游逐位元不變)。
- 最漂亮的一張:`landmark/tank ov_9ee6eb93` 從「一張沒法用的混合 matte」變成**一棟紅磚房 + 一座
  Dallas 水塔**兩個乾淨輸入;`rock/facet ov_b394fe26` 變成兩顆各自可用的石頭(1298px / 626px)。
- 新閘擋下 3 個:`sh_sage`(一條魚,blur)、`bld_halftimber`(cut)、`landmark/container`(cut)。
  切出來的目標另擋 3 個(`st_dolmen~2` 226px 太小、`gt_dragontree~1/~2` 76/71px 太小)。
- **零誤殺**:27 個吃 matte 的已出貨來源全數仍 pass(稽核 Ⅴ 段對真語料驗這一條)。
- 語料**幾乎沒有多目標照片是預期的** —— §5aq-h 使用者手動清倉過一輪(300 → 163),刪掉的正是
  「無法乾淨分離主目標」那一類。這一批改動的用途是**下一輪自動採集**(迴圈裡沒有人在手動清倉)。

### 5au-e. 順手修掉的兩個 bug(都是這一輪跑出來才現形的)

1. **`photos/<族>/*.jpg` 會被記成族名 `photos`**:語料佈局恆是 `photos/<族>/<零件>/*`,而
   `matte_photos.py` 的 `rglob` 收了散在外層的檔案(雲端同步、手動丟的),`parent.parent` 讓族名
   變成字面上的 `photos` ⇒ 產出落在 `out/matte/photos/<族>/`:不是合法族名 ⇒ 選片閘逐族跑永遠掃不到、
   帳本裡也沒有條目 ⇒ **63 張沒有授權帳、沒有判決、也沒有消費端的檔案**靜靜躺在那裡。
   改成只收深度剛好 2 的,並把跳過張數**印出來**(自己放的圖有正規入口 `--inbox` / `--adopt`)。
2. **`--rebbox` 順手把整批新照片也去背了**:回填模式的契約是「只補帳、不動 matte」,而第一版沒有
   擋住 `fresh` 那一條 ⇒ 一次回填產出 63 張新 matte。回填是「補上舊條目缺的欄位」,產 matte 是
   採集的一站,兩件事。

### 5au-f. 驗收

`audit_split_targets.py` **46 項全綠**(Ⅰ 畫布框取抽出後與舊算式逐位元相同 + origin 換算 /
Ⅱ 合成 matte 行為直測:並排兩顆會切、桁架碎片併回主體、碎屑不算目標、單一主體不產檔、決定性、
切出來的每一張只剩一個元件 / Ⅲ 模糊·太小·截斷各擋一次 + 底左右三邊只觀察不淘汰 /
Ⅳ 目標 id 格式只定義一次、harvest_loop 不拆檔名、②b 排在 ③ 之前、這一站零亂數 /
**Ⅴ 對真語料驗零誤殺**)。**反向驗證三支各自紅字**:`--break-contain`(碎片變獨立目標)、
`--break-erode`(模糊那張變成 0.891 = 擋不下來)、`--break-touch`(平頂的箱子被判成截斷)。

⚠ 寫反向驗證時踩到一次:斷言的**期望值 MUST NOT 隨 `--break-*` 改變**(第一版寫成
`len(seeds) == (2 if args.break_contain else 1)`)—— 那樣 break 旗標永遠是綠的,等於沒有反向驗證。
它還連帶抓出一個假綠:第一版的桁架 fixture 碎片只佔 10.3% < `SEED_F`,是被「碎屑」那條路吃掉的,
**根本沒有驗到 bbox 包含**。

相鄰:`intake_parts` 300 綠。`public/` `server/` `test/` **一行未動** ⇒ npm test / bal 天然不受影響(㋒)。

### 5au-h. 端到端跑一趟:切出來的目標真的走進 img→3D

把 5 個有消費端的目標(rock ×4、tree ×1)直接餵 SF3D(3060,峰值 6.1GB,`--remesh triangle
--target_vertex_count 520`)⇒ 812~962 tris,`mesh_stats` 判讀 **塊狀候選 ◎ ×2、實心但比例偏 ×3、
零薄殼**。人眼複核(contact sheet):

| # | 來源目標 | fill | 判讀 |
|---|---|---|---|
| 0 | `rock/facet~1` | 0.473 | **可用** —— 一顆完整的礫岩體 |
| 3 | `rock/st_dolmen~1` | 0.494 | **可用** —— 立石(menhir)形狀正確 |
| 1 | `rock/facet~2` | 0.447 | 邊緣 —— 扁楔形石板 |
| 2 | `rock/strata~1` | 0.389 | ✗ 薄片(斜拍的層理岩面 ⇒ 讀成一塊板,§5ag-c 同一族失敗) |
| 4 | `tree/gt_cryptomeria~1` | 0.268 | ✗ 扭曲細片(樹族本來就是 0%,§5q) |

**2/5 可用** —— 而關鍵是這兩顆的來源:`facet` 與 `st_dolmen` 的母照片**都通過了舊制的 ④**
(main 0.85 / 0.81)⇒ 改制前會**整張連著兩個物件**送進 SF3D,出來的是「兩顆黏在一起的石頭」。
現在一顆是乾淨的礫岩體、一顆是乾淨的立石,而 `st_dolmen` 那顆小的(226px)被 ① 正確擋掉。
樣本數只有 5,**MUST NOT** 拿它去宣稱可用率改善了多少;能說的是「這兩顆在舊制下不存在」。

**未入庫**(迴圈的紀律:人眼那一步之後,入庫是另一個決定)。rock 名冊目前已有
mega_a~f / facet_a,b / collapse_a / hoodoo_a / mesa_a / tower_a,要不要再加是使用者的決定。

### ⚠ 5au-i. 順手抓到:`mesh_sheet.mjs` 自 §5ar 起就渲染不出 SF3D 版面

`/^d+$/` —— **少了一個反斜線**(`\d`)。那個正規式在三處判「這個目錄名是不是數字」,而 SF3D 的
輸出版面正是 `<i>/mesh.glb`(0/ 1/ 2/ …)⇒ 條件恆為假 ⇒ **SF3D 那一半的 contact sheet 從
838c757(§5ar,同一天稍早)起就沒有產出過**。T2-spz 走的是扁平 `<名字>.glb` 那一條,不受影響
—— 所以建築族一直有 sheet,而 rock / tree / landmark 沒有。

**它為什麼看起來像沒事**:腳本自己是有出聲的(`找不到 <i>/mesh.glb`、exit 1),但 `harvest_loop`
的 `step()` 對非零回傳只印一行 `⚠ 回傳 1(不中斷整輪)`,在一整輪的輸出裡讀起來就是雜訊。
§5as-a 那句「先把缺的三張 sheet 補齊」補的正是這個 —— 當時只補了產物,沒有找到成因。
本輪一併修掉(三處),修完同一個目錄立刻渲染出 5 顆。

### 5au-g. 未做 / 交接

1. **`fetch_photos.mjs --plan` 的「可用張數」仍以照片為單位**:一張切出兩個可用目標的照片還是算 1。
   要不要改成算目標,會牽動 `BUILDING_MIX` 的漂移檢查 ⇒ 另案。
2. **投影上重疊的兩個目標分不開**(一顆石頭擋在另一顆前面)—— 沒有深度資訊,交給人眼,
   與「不是樹 / 含人」同一個桶。
3. **⑥⑦ 的門檻只有 1 個 / 2 個現役淘汰樣本**:語料長大之後要回頭看 `*_screen_watch.png`,
   確認 0.25~0.50 那一帶裡沒有一整群真的失焦的照片被放過去。
4. 這一輪**沒有動 ④ 的 `MULTI_MAIN` 0.70**,但已知它是拿兩張 llm_parts 校準的(§5au-b)。
   切開之後多主體那一桶實測歸零(每個目標的 `main` 都接近 1)⇒ 它現在幾乎不會再觸發。

## 5av. Trial log (2026-08-10 第五場 — Route A 第 3 顆 `beacon/mast`;而 `depot` 的「語料已就位」是**假的**)

### 5av-a. `beacon/mast`:舊表最不像的地方是**碟**

讀 `landmark/dish` 三張(型錄 3/3):#3 屋頂單面白碟 + 饋源臂、#4 屋頂三面碟(實面/網面各有)、
#5 **一整座通訊桅桿**(兩面碟 + 粗大的方位/俯仰旋轉座 + 頂端交叉天線陣)。

舊表的碟是 `['cyl', 1.5, 1.5, 0.45]` —— **一枚硬幣**:沒有深度、沒有饋源、沒有旋轉座,
而那三樣正是「這是一座通訊塔」的辨識點。重寫成:

- **碟深由焦徑比推導**:f/D = 0.4 的拋物面,深度 = D / (16 × f/D) ⇒ 3m 碟深 0.47m、2.2m 碟深 0.34m;
  饋源臂長 = 焦距。兩個數字都**不是手寫**,改碟徑會自己跟著走。
- **饋源走中心臂 + 喇叭**,刻意**不做三腳饋源支架**:那要複合尤拉角,而在兵線距離(37~90m)上
  三根 4cm 的支柱本來就看不見 —— 用不需要的複合旋轉換不到畫面,只換到 A26 那一族的風險。
- **逐面 X 斜撐**(三角斷面版的 `pylon.brace`):4 段 × 3 面 × 2 = 24 塊。三角斷面比 pylon 的
  方形多一個未知數(面的方位),解析解是 **ry = −(b + 90°)**(b = 兩根腳的角平分線):
  Euler 'XYZ' 讓長軸的水平方向 = (cos ry, −sin ry),對上弦向 (−sin b, cos b) 即得;代進去兩端點
  恰好是 `R·(cos a, sin a)` 與 `R·(cos(a+120°), sin(a+120°))`,就是那兩根腳。
  **另以 three 的 Euler XYZ 數值複驗 24 根**:端點離腳軸最大偏差 **1.6e-15 m**、端點高度恰為
  各段邊界(1.2 / 6.5 / 11.8 / 17.1 / 22)。15 件 → 54 件。

`foot` 3.8 → **3.9**(`kindExtent` 實算 3.8836)。撐大外廓的是**最下段那一圈斜撐**(最長 ⇒ 3D
半對角稅最重)**而不是碟** —— 與 pylon 9.12 / tank 5.56 同一筆帳:照實算改標稱,MUST NOT 反過來。

### ⚠ 5av-b. `shot_beacons.mjs` 的機位是照 `cairn` 寫死的 ⇒ 高的那三款從沒被拍到過

`near` d=9 / `lane` d=22 是照 13m 的疊石調的,套到 29m 的 mast 與 35m 的 pylon **只框得到基座**
—— 那兩款從頭到尾沒有一張圖看得見碟或橫擔,而每一行讀數都正常。這與零件對照台那次
「取景框 MUST 量台上真的建出來的那一團幾何」是同一課,照著修:**取景由量到的碰撞柱推導**
(`fit(m) = max(col.h, col.r·2)·m / (2·tan(fov/2))`),兩張改成 `full` + `lane`。
修完才第一次看到整座塔 —— 也才驗得了「斜撐接得住 / 碟有深度 / 交叉天線陣成形 / 沒有零件戳出碰撞柱」。

### ⚠ 5av-c. `depot` 的「語料已就位」是假的 —— 3 張 0 可用

§5at-d 寫著「`depot`(`landmark/container` 3 張,3/3 已滿)⇒ 純執行」。**把照片攤開來看**:

| # | id | 實際內容 |
|---|---|---|
| 0 | `ov_0ad2ddbc` | **維多利亞時期的玻璃魚缸**(木座上的彩繪魚缸) |
| 1 | `ov_7cd5ff72` | **同一個魚缸**,另一個角度 |
| 2 | `ov_c2d9cce0` | 港口全景:門式起重機 + 貨櫃船,貨櫃在遠處且被起重機擋著 |

查詢字是 `shipping container single`,而**博物館把玻璃容器編目成 "container"** —— 這正是 skill
記的那條結構性上界(「CC0 語料庫由數位化的館藏主導」)的一個新實例:這一次不是版畫/標本,
是**同一個英文詞在博物館編目裡的另一個意思**。型錄的「3/3 已滿」只數張數,數不出這件事。

⇒ **`depot` 改判 BLOCKED(語料)**,不是「純執行」。已把型錄查詢字改成貨櫃的具名單一主體
句式(見 `fetch_photos.mjs` 的 `container` 列),下一輪採集才有機會;在那之前 `depot` 維持
2026-08-03 的程序生成版本。**這一列的教訓值得記著**:型錄的達標數與 `--plan` 的綠字
**都只保證張數**,「這幾張到底是什麼」只有人眼知道 —— Route A 的第一步 MUST 是把照片打開來看,
而不是相信上一輪寫在交接裡的「語料已就位」。

### 5av-d. 驗收

`audit_beacons` 68 綠 + `--break-extent` / `--break-pad` 反向紅;`audit_object_joints --seeds 8`
= 11,908 接合 / 0 異常;`intake_parts` 300;`audit_siteplan` 218;cel 57 / gpu 54 / soft_stroke 73;
**`npm test` 全通過**(8620 是 `tailscaled.exe` 不可殺 ⇒ `--port 8630` + `WS_URL=ws://localhost:8630`);
**`npm run bal` 全綠**;`shot_beacons --kind mast` 新舊對照目視。來源帳 `beacon/mast` 已寫
(`llm_parts`,含 `baseline.rev = 0221cd8`);3D 零件對照台 缺件 0 / 孤兒 0 / 未記載來源 0。

### 5av-e. 未做 / 交接

1. **`depot` 等語料**(§5av-c)—— 與那四顆「重生」同一類:卡在供給側,`inbox/` 放一張乾淨的
   貨櫃堆斜拍最快。
2. Route A 至此 3/4 款(pylon / tank / mast 已讀照片重寫,depot 未);`cairn` 走的是零件庫(Route B)。
3. `shot_beacons` 的取景已改成推導,但**其餘四款沒有重拍過** —— 下次動到任一款時順手拍一張。

## 5aw. Trial log (2026-08-10 第六場 — **全自動入庫 + 人眼事後判決**;而擋得住的東西不是閘,是「可撤」)

> 使用者:「先全部自動化,人眼再審查,決定要刪除原始照片或調整參數重新處理。」
> 兩條附帶定案(問過):①自動化終點 = **寫進出貨名冊但不 commit** ②判「刪除原始照片」時**連節點一起撤下**。

### 5aw-a. 舊的那條 MUST NOT 為什麼可以改,以及改的方式**不是**加一道閘

`harvest_loop.mjs` 檔頭原本寫著「想讓它自動入庫的話,擋不住的就是『統計全綠、內容是一張版畫』
那一類(MUST NOT)」。那句話今天仍然成立 —— §5h 一輪擋下六顆內容錯誤的網格、§5ag-c 的 hoodoo
每個讀數都正常而形狀是錯的、§5av-c 三張標著 `container` 的 CC0 照片是**維多利亞玻璃魚缸**。
⇒ **這一輪一個新的統計判準都沒有加**(那是擋不住的那種東西)。改的是別的三件:

| | 為什麼它擋得住 |
|---|---|
| **不 commit** | ⑦⑧⑨ 只寫工作區。人眼永遠排在出貨之前,最壞情況是「工作區裡多了一顆醜東西」 |
| **可撤** | 判決 → `apply_verdicts.mjs`;撤節點 = GLB + 名冊 + 來源帳**三邊同時**,撤完由對照台驗收 |
| **只准追加到既有輪替名冊** | 開新格要寫 fallback 描述子,而它同時是降級幾何 + 離線外廓上界 + 縮放目標 |

第三條是**推導**不是名冊:`rosterSlots()` 只問「這一格的值是不是陣列」——
單一字串格(`MEGA_LIB.tower`、`BLD_LIB.acbox`)是**取代**語意,取代要人決定。
現役三格:`MEGA_LIB.block`(6 顆)/ `BLD_LIB.mass`(3)/ `BLD_LIB.masslow`(2)。

### 5aw-b. 「追加一顆會不會把既有節點擠爆預算」—— 量了,三格都不會,而且稽核逐位元釘住

這是這條自動化最危險的問題(症狀:某天某顆已出貨節點忽然超標,而理由與這次追加無關)。

- `MEGA_LIB.block` → `families.megalith`:除數是 **一顆巨岩最多幾件庫零件**(29,程式碼迴圈可數),
  不是名冊長度。
- `BLD_LIB.mass`/`.masslow` → 各自 `node_cap` = 47,700 ÷ `pick_n`(全圖挑幾棟),同樣與名冊長度無關;
  且 tri_budget 明文寫著 mass **刻意不併進** deco 的 `roster_size` 除數。
- 三格所屬的族(megalith / building)**都沒有 `kind_factor`** ⇒ 沒有「逐款 Σ」那道閘
  (只有 tree 有,而 tree 一個輪替格都沒有 —— 它的 `lib:` 是逐零件 1:1 的槽)。

稽核 Ⅱ 不相信上面這段話:它拿 **N 與 N+1 兩份名冊各算一次上限,要求逐位元相等**,
並額外斷言那兩族沒有 `kind_factor`。哪天有人把除數改成吃名冊長度,那一段當場紅字。

### 5aw-c. 順手補掉 `tri_budget resample_2026_08_08` 記著的那個洞

那筆記著:出貨的 `chimney_a`/`ac_a` **復現不出來** —— manifest 只記了照片與 fit,沒記
「哪一個輸出目錄的第幾顆」,而同一張照片配同一組參數得到的是另一顆網格(黏土剪影明顯不同)。
自動入庫沒有這一份就寫不出合格的來源帳 ⇒ 生成當下寫**投料帳** `<產出目錄>/.feed.json`
(`index → 母照片 id / 目標 id / 族 / 工具 / 參數`),而**沒有投料帳就不入庫**(規則 9),不猜。
SF3D 的 `<i>/mesh.glb` 那個 `i` 就是投料順序 —— 這個對應只有生成當下知道,事後回推不出來。

### 5aw-d. 五個「跑起來很正常、只是某一半靜靜地壞掉」的地方(全部在寫的時候就撞到)

1. **CRLF**:名冊追加若讀 `audit_src.readSrc`(它把換行正規化成 `\n`)再寫回去,
   等於**把整支 `biomes.js` 從 CRLF 改成 LF** —— 遊戲照跑、每一支稽核全綠,而 diff 是一萬行。
   ⇒ 解析走正規化、**讀寫走 raw 位元組**;錨點(節點名字串字面)本身不含換行,兩種檢出同解。
2. **節點序號**:拿 `names.length` 當序號的話,撤掉中間一顆之後會撞上一顆**還在服役**的節點,
   而撞名在 `normalize_parts --base` 那一側是**取代**語意(檔頭那條 `.001` 陷阱):它被無聲換掉。
   ⇒ 改成「掃現役名冊取第一個沒用到的字母」(填洞)。稽核 Ⅲ 同時斷言 length 版**會**撞名。
3. **黑名單**:判 `purge` 時直覺會把帳本條目的 `ok` 改成 False。而 `fetch_photos` 的 `seen` 是
   「`e.ok` 或持續性失敗」⇒ 改了 False 這張圖**下一輪會被重新下載**(擋了一邊、漏了另一邊,
   兩邊都不報錯)。⇒ 條目**留著、`ok` 維持 True**,淘汰以 `screen={v:'reject',why:'human'}` 表達
   (`why` 必須是 `human`,寫 `purged` 的話下一次跑統計就把判決洗掉)。這就是 `--break-blacklist` 咬的那一條。
4. **快照**:回滾若只記「有內容的那幾份」,新建的那支 `<族>.glb` 會留在工作區 —— 名冊回滾了、
   GLB 多一支 = 對照台一列孤兒,而每一支離線稽核都是綠的。⇒ 不存在的檔 MUST 記成 `null`。
   這就是 `--break-rollback` 咬的那一條。
5. **缺口判準**:對照台報表是**對齊欄位**(「缺件    0」),第一版寫 `/缺件 [1-9]/` 單一空格
   ⇒ 這道閘**永遠判乾淨**。改吃 `\s+`,而且兩站共用同一支 `gapsClean()`(各寫一份 =
   兩站對同一份缺口給出兩種答案)。

### 5aw-e. 人眼那一步:字彙從三個變四個,而「有意見」改成推導

對照台 `STATUS` 加 `✕ purge`(刪除來源圖,連節點撤下)。順手把「有意見」那個判斷從
手寫的 `['regen','reimg']` 改成由 `STATUS` 表推導 —— 手寫的那份會在加第五個出口時靜默過期
(新出口不進篩選,而畫面完全正常)。稽核 Ⅷ 逐鍵比對「對照台有的判決,第 ⑨ 站都認得」。

`apply_verdicts --dry` 對**現存的四筆判決**(§5aq 那輪判的)實跑,四種結果剛好各驗到一條:

| 節點 | 結果 |
|---|---|
| `building/mass_a` / `mass_b` | ⟳ 可撤(mass 有 3 顆,撤一顆剩 2) |
| `building/masslow_a` | ⏭ **擋下** —— 撤掉只剩 1 顆,而「輪替名冊 MUST ≥2 顆」是 `biomes.js` 自己寫的規則(要撤請 `--force`) |
| `building/ac_a` | ⏭ **擋下** —— `BLD_LIB.acbox` 是單一字串格,取代要人決定 |

### 5aw-f. 驗收

`audit_auto_intake` **77 綠**;反向驗證三支各紅**恰一條**:`--break-append` 紅在「格數不變」、
`--break-rollback` 紅在「新建的檔被刪掉」、`--break-blacklist` 紅在「seen 仍收得到它」。
`intake_parts` 300;`audit_siteplan` 218;`audit_beacons` 68;`audit_object_joints --seeds 8`
21,611 接合 / 0 異常;3D 零件對照台 缺件 0 / 孤兒 0 / 未記載 0;`harvest_loop --dry` 印得出新的 ⑦⑧;
`apply_verdicts --dry` 行為如上且**一個位元組都沒寫**。
**`npm test` 全通過**(`--port 8630`;8620 是 `tailscaled.exe` 不可殺)、**`npm run bal` 全綠**
—— 這一輪 `public/js/**` **一行都沒動**(改的全在 `tools/`),兩者 MUST 逐項不變,實得如此。

### 5aw-g. 未做 / 交接(⚠ 沙箱跑不動的那幾項)

1. **真正跑一次入庫沒有驗過**(㋓):第 ⑦ 站要 Blender + 真的 GLB,沙箱兩者都沒有。
   已驗的是它的**每一個判斷與每一條回滾路徑**(稽核 Ⅳ~Ⅶ 全部拿真品函式跑),
   沒驗的是「Blender 那一行指令拼對了沒」。⇒ **3060 那台第一次跑 MUST 用 `--limit 1` 起步**,
   跑完立刻 `git diff --stat` 看動到的是不是恰好三份檔。
2. `screen_mattes.py --purge` 的**實刪**在沙箱是拿合成語料驗的(稽核 Ⅵ 建了一個暫時資料家)。
   對真語料第一次跑之前建議先 `--dry`。
3. **`--gate-full` 每批跑一次 `npm run bal`**(約一分鐘)。`--every 15` 的節奏吃得下,
   但如果之後把輪距調短,這一項是第一個要重新算的。
4. `regen` 的覆寫表目前只有 `cells`/`offset`/`target`/`fit`/`tool` 五個旋鈕會被第 ⑦ 站吃到;
   **換 seed / 換 steps 還沒有接**(SF3D/T2 的呼叫在 `harvest_loop` 那一側)。
5. §5aj-C(鏡像貼補改制)仍未執行 —— 本輪只把它接成 `regen` 的一個可覆寫參數的位置,刀沒有動。

## 5ax. Trial log (2026-08-10 第七場 — 零件台變成駕駛艙:一顆開關 + 圖檔三態)

> 使用者:「設定腳本可以在零件台執行/關閉,會自動判斷圖檔未處理/已處理/需修正。」

### 5ax-a. 啟停:**不新開一條路**,掛既有那一支閘

`tools/dev_supervisor.mjs` 是全專案唯一「HTTP 進來 → spawn 一支行程」的路徑,三道閘
(loopback / 參數零信任 / `x-dev-tools` 非簡單標頭)都在它的 `handle` 裡。⇒ 零件台掛的是
**同一支 `handle`**,不是自己寫一份:兩個入口兩套閘的話,漏掉的那一套沒有任何錯誤訊息。
稽核 Ⅸ 直接斷言 `parts_review.mjs` **全檔沒有 `spawn(`**(`--break-spawn` 注入一個就紅)。

### 5ax-b. 採集迴圈不是伺服器 —— 而這一件差點就變成「按幾次就開幾支」

既有兩支工具都是**對照台**(dev server),`dev_supervisor` 的存活判準因此是「那個埠上有人在聽」。
採集迴圈**不聽任何埠** ⇒ 拿 `listening()` 去問它會**永遠回「沒開」**:鈕面停在「▶ 啟動」,
而背景每按一次就多開一支,兩支同時對同一個資料家寫 `harvest_state.json`,畫面完全正常。

⇒ `TOOLS[].kind` 分 `server` / `job`,差別**只在「怎麼知道它還活著」**:
job 問的是我們自己的子行程(`alive(running.get(key))`)。代價講清楚:
**終端機起的那一支這個台子看不到**(沒有埠可以探),所以 job 的狀態語意是
「這個台子有沒有在跑它」而不是「這台機器上有沒有在跑」。job 因此 MUST NOT 宣告 `port`、
MUST NOT 回 `url` —— 回一個 `http://localhost:undefined/` 會讓頁面畫出一個點不開的連結。

`kill()` 也刻意只收那一支:迴圈當下若卡在 `spawnSync`(去背 / SF3D),那支孫行程會跑完自己
那一輪。行程樹砍殺(`taskkill /T`)是平台專屬,而半途砍掉 Blender 會留下寫到一半的 GLB。
**按停 = 不再開新的一輪。**

### 5ax-c. 資料家:探測到兩個,而「取第一個」有一半機率是錯的

`provenance.photoRoots()` 早就會逐一探測姊妹 worktree,但順序是**目錄名的字典序** ——
與「哪一份是 superset」完全無關。實測本機兩個候選:**415 筆** vs **81 筆**。
⇒ 新增 `corpusHomes()`:只收真的有帳本的,**依筆數排序**,`corpusHome()` 取最多的那一個,
而且**候選全部回傳** —— 面板 MUST 把挑中的那一個顯示出來(「另有 1 個候選」),
MUST NOT 靜靜地替使用者決定。要指定別的一律回終端機帶 `--home`。

spawn 的 argv 因此多了一段推導(`argvOf`),但**參數零信任沒有鬆**:那條路徑是從檔案系統
算出來的,請求一個字都碰不到。稽核 ⑦ 段的斷言跟著改成「argv 來自 TOOLS 常數 + argvOf」。

### 5ax-d. 三態:**零新狀態檔**,四本既有的帳就夠

| 狀態 | 判準 | 下一步 |
|---|---|---|
| **需修正** | 有一筆**還沒執行**的人眼判決指著它 | 跑 `apply_verdicts` |
| 已淘汰 | 選片閘/人眼判掉、或已被 `purge` 進黑名單 | 不會再動 |
| **已處理** | 至少一個目標送過 img→3D | 出不出得了貨看節點清單 |
| **未處理** | 其餘 | 下一輪迴圈會跑到它 |

三個設計判斷,每一個都有一條「不這樣做會怎樣」:

1. **順序即語意**(需修正 > 已淘汰 > 已處理 > 未處理)。一張被選片閘判掉、但它更早生出來的
   節點還掛著待執行判決的圖,MUST 是「需修正」—— 下一步在人身上。稽核用**四條固定期望值**
   把順序釘死(其中一條刻意同時滿足「已淘汰」),分支被調換位置至少一條會紅。
2. **「已淘汰」MUST 獨立成一態**。併進「已處理」的話面板看起來「幾乎都做完了」,而其實
   那是 238 張垃圾;併進「未處理」則會讓人以為還有東西可跑。
3. **「送過生成但沒出貨」算已處理,不算需修正**。可用率 ~1/15 是這條管線的本質(skill §4),
   把它算成需修正的話 14/15 的語料都會亮紅燈 —— 那是雜訊不是資訊。

判決是**逐節點**的、狀態是**逐圖檔**的 ⇒ 對應一律經來源帳(`imgs[].id` = 母照片),
MUST NOT 去拆檔名。頁面一個判斷都不做(稽核斷言 `review.js` 全檔不出現
`harvest_state` / `screen.v` / `photo_manifest`;`--break-panel` 注入一個就紅)。

### 5ax-e. 驗收

`audit_auto_intake` **93 綠**(新增 Ⅸ 段 16 項)+ **五支**反向驗證各紅恰一條;
**`npm run audit:net` 全數通過**(⑦ 段逐工具依 kind 分流,含起真 server 打 `/dev/tools`:
`harvest:start 之後子行程還活著` / `stop 之後行程收掉了` / 無標頭 POST 403 / 亂動作 404 /
非 loopback 404 / `--cloud` 沒有這條路由);`audit_solo_boot`、`audit_ui_layout` 467、
`intake_parts` 300、對照台 0-0-0 全綠。

**真機實測**(起在 **8642** 而不是預設 8622 —— 8622 跨 session 存活著一支舊的,
在預設埠上驗到的會是舊程式碼):面板顯示 `需修正 5 / 未處理 24 / 已處理 148 / 已淘汰 238`
(合計 415 = 帳本筆數),資料家標著 `reverent-pascal-fcd63e/tools/ai3d(另有 1 個候選)`;
按「需修正」展開逐張列出「哪一張圖 → 哪一顆節點 → 什麼判決 → 下一步」;
啟動/停止走完整路徑,零 console 錯誤。

### 5ax-f. 未做 / 交接

1. **`--rounds 0` 的長時運轉沒有驗過**(這一輪只驗到啟動與停止)。第一次讓它跑整晚之前,
   建議先在終端機跑 `--rounds 2` 看兩輪的 JSONL 記帳。
2. 面板**只讀不寫**:判決仍要在下面的清單逐顆按,執行仍要回終端機跑 `apply_verdicts`。
   把「執行判決」也做成一顆鈕是下一步,但它會動到工作區的三份檔 —— 那顆鈕該不該存在
   是使用者的決定,不自行加。
3. job 的日誌只留最後 6 行(沿用既有 `LOG_LINES` 的顯示上限)。要看整輪還是得看
   `harvest_log.jsonl` 或終端機。
4. 三態的「已處理」不分「有沒有出貨」——那一層資訊在下面的節點清單裡。合成一欄的話
   會變成第五種狀態,而使用者要的是三種。

## 5ay. Trial log (2026-08-10 第八場 — 語料圖進清單可手動篩選;而「原版 vs 生成」有一半根本不同源)

> 使用者兩條:①「零件台還沒轉 3D 的 image 也都加入清單,以便對 image 手動篩選」
> ②「只比對同源物件的新舊版本,透過 img→3D 新生成與舊物件無關,不該一起比對,
> 各自陳列,標注繪製方法即可」。

### 5ay-a. 第二條先講:台子從第一天就把**不同源的兩個東西**並排

`provenance.METHODS[].kind` 分兩路,而它們的「原版」意思完全不同:

| kind | 左側「原版」是什麼 | 同源嗎 |
|---|---|---|
| `parts`(Route A 純資料件)| `baseline.rev` 那一版的**同一份零件表** | ✅ 是同一個物件的前一版 |
| `glb`(img→3D)| **保險絲 primitive**(零件庫沒載到時的降級幾何) | ❌ 那不是它的前一版,是它壞掉時的替身 |

第二列並排的下場是讀成「AI 版 vs 原版」,而那個「原版」**從來沒有出貨過** ——
`rock/mega_a` 的左邊是一顆 `ico(1)` 白球,它不是舊的巨岩,它是「GLB 載不到時畫的東西」。

⇒ `glb` 那一路改成 `now-only` 單獨陳列,右側標題改成**標注繪製方法**
(`現行 ・ 繪製方法:img→3D(SF3D)`)。`baseline-vs-now` 原樣保留 —— 那才是新舊版本。

**保險絲群組仍然會被建出來**,但降級成「換掉的是哪幾顆 mesh」的**索引**(取景用),
不佔 pane、也沒有標題。實測 `rock/mega_a` 的「零件」取景照樣印出
`(只顯示換掉的 2 顆 mesh)` —— 定位不是比對,兩件事分開之後兩邊都還在。

順手修掉一個會靜默的相依:`partFramable` 原本綁在 `mode === 'fuse-vs-lib'` 上,
改制之後那顆鈕會**整批變灰**,而灰掉的理由(「沒有節點可隔離」)是假的
⇒ 條件改成它真正的意思:`!!r.view?.node`。

### 5ay-b. 第一條:圖進清單,而**不是**倒進節點清單

415 張圖直接倒進 52 件生成物的清單裡,結果是節點被淹掉 —— 而「找不到那顆節點」
看起來就像它不見了。⇒ 上方那條窄帶的狀態鈕改成**左側清單的內容切換**
(生成物 / 需修正 / 未處理 / 已處理 / 已淘汰),按一下整欄換成那一態的圖,一張一張點。

細節頁顯示:**母照片(有去背就顯示去背後的)+ 切出來的每一個目標**。
兩張都要:目標才是真的餵進生成器的東西,只看母照片等於在判另一張圖。

⚠ 這裡踩到一個**安靜的**坑:`entry.matte` 不是路徑,是**去背的 bbox 物件**
(`{wh, origin}`)。當成路徑用會 `String()` 成 `"[object Object]"`、`existsSync` 回 false,
然後安靜地退回原圖 —— 畫面正常,而你以為在看去背後的樣子。matte 的路徑是**約定**的
`out/matte/<族>/<零件>/<id>.png`(與 `screen_mattes.apply_purge` 同一條)。

### 5ay-c. 手動篩選:三顆鈕,判決紀律一條都不搬

| 鈕 | 轉呼 | 語意 |
|---|---|---|
| ✔ 保留 | `screen_mattes.py --human pass` | 救回統計誤殺(人眼恆勝統計) |
| ✕ 淘汰 | `--human reject` | 不再送生成,**檔案留著**(Route A 仍要看照片) |
| 🗑 刪除來源圖 | `--purge` | 真刪檔 + 進黑名單(連同切出來的每一個目標) |

台子**只是按鈕**:恆勝、roll_up 到母照片、黑名單怎麼表達,全部住 `screen_mattes.py`。
兩道邊界照舊:`x-dev-tools` 標頭(會改帳本與刪檔)、**id 與 family 從帳本取**
(請求只能「挑一筆現有的」,不是把字串接進命令列)。刪除會再問一次並列出會刪掉什麼。

順手修掉 `corpusHomes()` 的一個自作主張:`--photos` / `--home` **明指**的那一個
現在永遠排第一。原本一律按帳本筆數排序,於是「我指定了 A,它讀 B」——
而這一輪的合成語料家測試(1 筆)正好被 415 筆的真語料蓋掉才發現。

### 5ay-d. 驗收

`audit_auto_intake` **104 綠**(Ⅸ 段擴到 30 項)+ **六支**反向驗證各紅恰一條;
`npm run audit:net` 全通過;`intake_parts` 300;對照台 0-0-0。

**真機實測**(8646,非預設埠):`rock/mega_a` 單一 pane 標
`▶ 現行 ・ 繪製方法:img→3D(SF3D)`;`beacon/tank` 仍是兩 pane
`◀ 原版(改寫前的零件表)` / `▶ AI 生成(現行零件表)`;「零件」取景在單 pane 下
照樣印 `(只顯示換掉的 2 顆 mesh)`。**手動篩選端到端**跑在**合成語料家**上
(不動真語料):無標頭 POST 403 → `reject` 寫回 `{v:reject, why:human}` → 狀態轉 `已淘汰`
→ `purge` 真刪檔而帳本條目留著(`ok:true` + `purged`,黑名單)。

### ⚠ 5ay-e. 這一輪自己踩到的稽核陷阱(值得記著)

`--break-panel` 的注入錨點是上一輪寫的 `harvestRows()`,而它在**同一輪**被改寫掉 ⇒
`String.replace` 變成無聲 no-op,旗標整支空轉、**反向驗證是綠的**。
這正是 CLAUDE.md ㋑ 記的那一條。修法:所有 `--break-*` 的字面注入改走 `inject()`,
**錨點不存在就 `process.exit(2)` 當場失敗**。六支旗標現在各紅恰一條,是量出來的不是宣稱的。

### 5ay-f. 未做 / 交接

1. 手動篩選只有三個出口。「救回某一個**目標**而不是整張母照片」目前要回終端機
   (`screen_mattes.py --human pass <目標 id>`)—— 台上還沒有逐目標的鈕。
2. 已淘汰那一態有 238 張,清單一次全畫。真的要逐張看的話 `photo_sheet.mjs` 的
   contact sheet 仍然比較快;台上這一份是給「查某一張為什麼被判掉」用的。
3. 圖檔那一側**沒有 3D**(它還沒轉成 3D)⇒ 右邊不掛 viewer。切回生成物清單時
   viewer 會重新掛上,實測沒有殘影,但長時間來回切換的記憶體沒有量過。

## 5az. Trial log (2026-08-12 — 使用者四條:**尺寸 / 碰撞剖面 / 只貼垂直平整牆 / 窗間距**)

> 使用者原句四條:
> ①「建築建模管線最後要再加入調整目標物件到適合的大小,避免放在遊戲後看起來真實感太差」
> ②「為何非簡單幾何的建築建模,招牌會懸空,物理碰撞實質上還是立方體?物理碰撞應該要與建模的 3D 外表一致」
> ③「建築外部的密集窗戶圖層與外掛招牌只貼垂直地面且平整的平面牆」
> ④「不同建築使用窗戶圖層間距不要都一樣,也可以使用幾乎無間距的玻璃牆」

### 5az-a. ② 的答案:不是漏做,是**當時只能那樣做**,而代價量出來大得離譜

碰撞柱是 A30 的有向盒(三端 —— 客戶端 `_collide`/`_blockerHitT`、伺服器 occ —— 只認有向盒
與圓柱),而 §5aa-c ① 明文寫著「碰撞/LOS 一格不動」。於是換上庫節點的那幾棟:**看得到的是
退縮塔/薄板/人字屋頂,撞得到的是整個 OSM 足跡的一顆方盒**。這一輪把它量了:

| 節點 | 剖面體積 ÷ 那顆方盒 | 自然平面長寬比 |
|---|---|---|
| mass_a | 0.374 | 0.900 |
| mass_b | **0.157** | **0.276** |
| mass_c | 0.376 | 1.010 |
| masslow_a | 0.366 | 0.701 |
| masslow_b | 0.256 | 1.751 |

⇒ 舊制那顆方盒有 **62%~84% 是空氣**,而那些空氣擋彈、擋 LOS、爬得上去。招牌懸空是同一件事
的另一半:`buildWorldSigns` ④ 把牌子推到 `b.d / 2`(方盒側面),而節點在牌子的高度上只有
方盒的兩成寬。§5ab-c 當時的處理是「挑中的那幾棟純視覺附件一律不掛」—— 那是繞過去,不是修好。

### 5az-b. 修法:一顆方盒換成**一疊方盒**(`bldProfile`),而剖面是量出來的純資料

- `parts_src.nodeProfile`:縱向切 16 段、逐段取 |x|/|z| **最大值**(⇒ 盒恆包住網格,A44 ③)、
  再貪心合併到剩 4 段(合併成本 = 多出來的實體體積)。5 段只比 4 段再省 4% ⇒ 取 4。
- 宣告值住 `BLD_LIB` 第三格(**純資料**)。理由是紀律不是省事:佈局數學 MUST NOT 讀庫幾何
  —— 庫載不載得到逐客戶端不同,讀它就是碰撞柱跨客戶端分家。`intake_parts` 逐顆比對宣告與
  實測 ⇒ 名冊不會靜默過期。
- **挑選與「庫載到了沒」解耦**。舊制的閘是 `if (ok.length)`,在碰撞柱還是單一方盒的年代無害;
  這一輪它是致命的(載到的登記剖面柱、沒載到的登記方盒柱 = 兩端分家)。⇒ 挑選只讀純資料,
  載入成敗只決定**畫出來的是網格還是保險絲**,而**保險絲改由同一份剖面疊出來**(`profGeo`)
  ⇒ 不論載不載得到,看到的與撞到的都是同一個形狀。
- 成本:至多 16 棟 × 3 = **+48 根碰撞柱**(`LOS.MAX_OCC` 4000 的 1.2%)。
- **地面那一段恆等於整個足跡**(見下 5az-c 的撐滿)⇒ 街廓通行寬與舊制逐位元相同,
  `audit_traverse` 不受影響;收窄的只有上面的退縮階與山牆。

### 5az-c. ① 的答案:節點根本**沒有撐滿基地**,而那同時是尺寸問題與碰撞問題

消費端拿**單位方盒**逐實例 scale(w,h,d),而節點的半寬只有 0.13~0.42 ⇒ 那幾棟塔樓縮在自己的
空地中央、外面一圈看不見的碰撞盒。改成由剖面實測外廓推導縮放(`fitScale`),最寬那一段恰好
等於 OSM 足跡;縱向同理(舊制節點收在 0.95×樓高 —— **那正是 §5ab-c 附件浮在半空的成因本體**)。

撐滿之後剩下的問題是**拉伸**:把 0.276 的薄板塞進正方形基地是橫向拉 3.6 倍。⇒ 指派時逐棟挑
「拉伸最小」的那一顆(允許整顆轉 90°,自然比取倒數),**超過 `ASPECT_MAX = 1.6` 就不換這一棟**
(退回方盒,原則 6),額度留給下一棟。逐顆沒有上限可言(薄板塔本來就只該落在長條基地上);
真正會出事的是整份名冊一顆都收不下方正基地 ⇒ 閘在**名冊層級**(`intake_parts` 的涵蓋率閘)。

### 5az-d. ③ 的答案:兩帶 → **三帶**,而「平整」那半不靠這一帶兌現

貼圖是盒投影上去的 ⇒ 面越斜,同一段 u/v 就攤在越長的表面上。舊制只分兩群(朝上 / 其餘),
退縮頂的斜切面、尖塔、屋簷底全在窗格帶裡。三帶把**傾斜**獨立成素牆帶(沒有窗)。
帶寬取該群面積佔比的名冊平均(三帶 texel 密度相同):mass 0.125 / 0.176、masslow 0.216 / 0.262。

**「平整」刻意不用逐平面分群來判**:實測 AI 網格的垂直面本來就有起伏 —— 以「同一平面的面積
佔比」判,mass_a 只認得 4~9% 的立面,把九成判成素牆只會更糟。⇒ 窗格吃「垂直」這一條(盒投影
對起伏不敏感,窗格照樣是正的),而**招牌**那半吃更嚴的一條:它掛在剖面的側面上,那些面依
構造就是垂直且平整的矩形(牌子是剛性矩形,貼圖不是)。

2026-08-09「平頂桶刻意不開屋頂帶」的理由(朝上面小、俯視機會低)**已作廢**:這一輪要擋的
不是屋頂而是斜面上的窗,而平頂塔的退縮切面正是斜面佔比最高的一群。

重烤走 `--base`:**幾何逐位元不動**(逐頂點 maxΔ = 0、三角形數一格未變),只重建 UV。

### 5az-e. ④:窗佔比是**逐款**旋鈕,而層高那條定案不動

舊制只有兩組窗格幾何(帷幕 0.86×0.62、其餘一律 0.52×0.48)⇒ 十六款樓的窗間距只有兩種。
這一輪每一款各自宣告 `win: [寬佔比, 高佔比]`(間距 = 1 − 高佔比),另加一種**立面**
`glass` —— 整面玻璃 + 髮絲級橫豎框、沒有裙板帶(它不是 `curtain` 的參數,是另一種構造)。
**層高仍夾在 `STOREY` 帶內**(2026-08-09 使用者定案不動):層高是現實約束,窗佔比是建築風格,
兩件事正交。

### 5az-f. 驗收

`intake_parts` **333 / 0**(含三帶各自的 v 界、帶寬 ≈ 面積佔比、剖面宣告 = 實測、名冊涵蓋率)/
`audit_siteplan` **229 / 0**(+`--break-prof`/`--break-fill`/`--break-glass` 三支反向驗證,
各紅 4 / 1 / 2 條;既有七支照樣咬得住)/ `audit_auto_intake` **154 / 0**(五支 `--break-*` 全咬)/
`intake_parts`・`beacons`・`object_joints`(11908 接合 0 異常)・`gpu`・`cel`・`soft_stroke`・
`visual_prefs`・`world_edge`・`world_height`・`open_tunnel`・`underpass`・`road_joint`・
`world_text`・`vernacular`・`ground_qc`・`client_syntax`・`solo_boot`・`audit:net` 全綠 /
**`npm run bal` 全綠** / **`npm test` 全綠(fresh :8673)** / 3D 零件對照台 0 缺件 / 0 孤兒 / 0 未記載。

### 5az-g. 未做(㋓ / ㋕)

1. **定場圖沒補**:`shot_scene` 的 `mass_near`/`masslow_near` 與 `shot_facades` 排面都要真瀏覽器。
   這一輪改的東西有一半是「只有截圖看得到」的 —— 三帶接縫落在哪、無縫玻璃牆讀起來像不像玻璃、
   撐滿基地之後那幾棟塔樓的比例。
2. **真機貼牆走一圈**:碰撞剖面的手感(退縮平台站得上去、上半段不再撞到空氣)只有真的走一趟
   才知道;`audit_traverse` 需要網路,也還沒跑。
3. `measure_building_tris --live --osm-cache` 的 A/B 沒重跑:保險絲幾何從 12 面變成 48 面
   (只在庫載不到時用),而 draw call 與 instance 數的推導未變。

## 5ba. Trial log (2026-08-13 — 使用者三條:**合併整平 / 只貼平整垂直牆 / 窗戶輪廓太模糊**)

> 使用者原句:「建築外部不平整的多塊法線角小的平面牆合併平整. 建築外部的密集窗戶圖層與外掛招牌
> 只貼在垂直地面且完全平整的平面牆. 窗戶圖層輪廓都太模糊」

### 5ba-a. 第 ② 條與 §5az-d 的定案直接衝突,而衝突的是**時序**不是規則

§5az-d 寫著「『平整』那半**不靠這一帶兌現**:實測 AI 網格的垂直面本來就有起伏,把九成立面判成
素牆只會更糟」。這一輪先把那句話**量出來**(`parts_src.mjs` 新增 `flatWalls` / `wallFlatness`,
從成品 GLB 量,mass_a/b/c・masslow_a/b 依序):

| | mass_a | mass_b | mass_c | masslow_a | masslow_b |
|---|---|---|---|---|---|
| 近垂直面裡真的平整(法線離自己那一群 ≤6°) | 53.9% | 61.5% | 78.9% | 90.2% | 74.1% |
| 相鄰近垂直面夾角 ∈ (0.5°, 12°] 的面積佔比 | 53.5% | 63.0% | 55.7% | 52.6% | 64.1% |
| 純傾角三帶下把平整當資格 ⇒ 素牆帶會變成 | 0.491 | 0.453 | 0.330 | 0.305 | 0.404 |

第二列就是使用者說的「不平整的多塊法線角小的平面牆」—— 它是**這一輪的驗收尺**。
⇒ 那句定案不是錯的,它描述的是「還沒整平的網格」。正確的順序是**先合併整平、再拿平整當資格**,
而使用者這一輪把兩件事放在同一句話裡講,本來就是同一輪的事。

### 5ba-b. `_planarize` 舊制的三個結構性問題(都不是「參數調小了」)

1. **分群只看法線** ⇒ 退縮塔的前牆與退縮一階之後的前牆(法線完全相同、相差一階)落進同一群,
   群的最佳平面落在兩者中間 —— 兩面本來各自是平的牆**互相被推歪**。
2. **位移上限是另一個數字**(跨距 × 0.01),與「多近算同一面牆」無關 ⇒ 該合併的合併不了。
3. **只跑一趟**,而頂點推上平面之後法線就變了、群結構沒重算;而且**沒有焊接** ——
   glTF 匯入的是逐面拆開的三角形湯(`_weld` 檔頭那個坑),共位頂點被不同群各推各的 = 沿群界撕開。

修法:分群加「平面偏移 ≤ `off_f` × 跨距」、**同一個數字**當累計位移上限(對原始位置)、
跑 `passes` 趟、`min_f` 0.02 → 0.005、自建共位對照表。**只動位置不動拓樸**(面數 / 頂點數 /
元件數 / 邊界邊 / 預算逐項不變,外廓 `_restore_ext` 逐位元還原)。
新旗標 `--replanar <node>`:對 `--base` 裡已出貨的節點就地整平(紀律同 `--rework`)。

參數掃描(JS 端先模擬,再用 Blender 跑真的;判準 = 第二列那個佔比):
`off_f` 0.02→0.03 只對 mass_a 有感(素牆帶 0.475→0.422),再大就開始把真的退縮階併掉;
`passes` 1→8 讓佔比再降三分之一而位移上限不變(累計夾制),8 趟後收斂;
`deg` 維持 12 —— 18 會讓 mass_a 的平整佔比從 64.5% **掉到 22.8%**(併過頭之後群的最佳平面誰也不貼)。

### 5ba-c. 整平之後(`--replanar` + 新 `--uvbands`,五顆全跑)

| | mass_a | mass_b | mass_c | masslow_a | masslow_b |
|---|---|---|---|---|---|
| 小角面積佔比 | 53.5→**31.2%** | 63.0→**9.3%** | 55.7→**27.9%** | 52.6→**6.9%** | 64.1→**10.0%** |
| 真的平整 | 53.9→**64.5%** | 61.5→**85.2%** | 78.9→**92.0%** | 90.2→**97.1%** | 74.1→**89.4%** |
| 二面角 p50 | 4.27→1.19° | 3.46→0.00° | 3.26→0.60° | 0.66→0.00° | 1.73→0.00° |

⚠ **p90 可以上升**(mass_a 42.8→50.0°)—— 真正的轉角不在「小角」那一欄裡,整平只會讓它們更清楚。
新帶寬:`mass` 0.129 / 0.308、`masslow` 0.205 / **0.262(與整平前逐位元相同)** ——
低矮那一桶本來就幾乎是平的,它是這一輪的對照組:改到的只有真的不平整的那幾顆。
⚠ **mass_a 的素牆 0.423 離名冊平均 0.115**,它就是那顆「整平之後還是不夠平」的節點(已在重生佇列)。
逐顆容差因此拆兩個(`band_tol` 0.06 / `plain_tol` 0.12);**MUST NOT 靠調鬆 `flat_deg` 讓它好看**。

**重烤 MUST 兩趟**:帶寬的定義是「該群的面積佔比」,而佔比要整平之後才量得到
⇒ ①`--replanar` + 舊帶寬 → 量佔比;②從**原始** base 重跑一次把量到的值烤進 `--uvbands`。
拿①的產出再跑一次 = 這一顆被推了兩倍。

### 5ba-d. 招牌那一半:剖面第五欄

「剖面側面依構造就是垂直平整的矩形」對**盒**成立、對**盒裡面那塊網格**不成立 ——
尖塔 / 山牆 / 退縮斜切面照樣落在某一段的側面上。⇒ `nodeProfile` 逐段多量一欄
「平整垂直牆佔該段面積的比例」,住名冊第五欄,`intake_parts` 逐顆比對。
二十段實測排序後最大的那個空檔在 0.288 ↔ 0.387(幾何中點 0.334 = `sign_flat_min`),
而空檔兩側恰好就是語意的兩邊。消費端 `bldFaceList` 一份篩選、兩個招牌消費端同吃,
**挑不到合格的段就整棟不掛牌**(MUST NOT 退回 `b.w/2`、`b.d/2` —— 那正是「招牌懸空」的成因本體)。

### 5ba-e. 第 ③ 條:窗戶輪廓為什麼糊

`magFilter = NearestFilter` 那行註解寫著「硬邊窗格 = 漫畫筆觸」,而它從第一天起只兌現了一半:
`cw = W / cols` 與 `ch = (WW − 26) / rows` 都是小數 ⇒ 窗的四個邊落在 texel **中間**,
Canvas2D 對非整數 `fillRect` 會反鋸齒 —— **糊是畫進貼圖裡的**,`NearestFilter` 只是把那條漸層
原封不動放大。另外兩個:窗根本**沒有輪廓**(只是一塊比牆深的色塊,兩者都是中間調),
以及 `anisotropy` 預設 1(全專案其他六張貼圖都設 4,只有立面漏了;立面幾乎永遠是掠射角)。

量化(頁內跑真品 `facadeTex`,沿橫掃描線統計窗邊的「過渡 texel」佔比):

| | res0/shop | res2/plain | com0/plain | com6/shop |
|---|---|---|---|---|
| 改前 | 29.5% | 22.1% | 29.9% | 25.5% |
| 改後 | **0%** | **0%** | **5.2%** | **0%** |

### 5ba-f. 驗收

`intake_parts` **353 / 0**;反向驗證 = 把**整平前**的 `building.glb` 餵給它 ⇒ **22 條紅**
(含「已合併整平」與「真的平整的 ≥ 60%」逐節點各一條、素牆帶寬、v 界、剖面宣告 = 實測)。
`audit_siteplan` **237 / 0**(+新的 `--break-flat` 紅 3 條;`--break-prof`/`--break-roof`
照樣紅 5 / 3 條)。`audit_auto_intake` 154 / 0・`beacons` 68 / 0・`object_joints` 11908 接合 0 異常・
`open_tunnel` 163 / 0・`underpass` 161 / 0・`road_joint` 86 / 0・`world_text` 57 / 0・
`vernacular`・`ground_tile`/`seam`/`enclave`/`qc`・`world_edge` 155 / 0・`cel_pipeline` 94 / 0・
`visual_prefs` 176 / 0・`gpu_lifecycle` 58 / 0・`soft_stroke` 139 / 0・`client_syntax` 117 /
`solo_boot`・`audit:net` 全綠。`shot_facades` 排面拍了改前 / 改後兩張。
`data.js` / `sim.js` / 伺服器一行未改 ⇒ `npm run bal` / `npm test` 結構上不受影響(㋒)。

### 5ba-g. 未做(㋓ / ㋕)

1. **`shot_scene` 的 `mass_near`/`masslow_near` 沒補**(需要網路圖資):素牆帶從 0.176 長到 0.308
   之後,那幾棟塔樓還讀不讀得出是辦公樓,只有定場照看得到。
2. **真機貼牆走一圈**:招牌落點改了(有些會沿牆滑下來、有些整棟不掛),手感只有走一趟才知道。
3. `audit_traverse`(需要網路)未跑 —— 幾何只在殼裡動、外廓逐位元還原,地面層通行寬理應不變。
4. **mass_a 仍是那顆最不平的**(平整 64.5%、素牆帶 0.423)。它本來就在重生佇列(§5as-f),
   這一輪把「它有多不平」變成了名冊上看得到的數字,而不是換掉它的替代品。

### 5ba-h. 第二輪(同日追加):**窗格貼齊面板**

> 使用者原句:「平面區域太小的話不渲染窗戶,窗戶會被裁切掉的時候也不渲染(如果是用貼圖的改成渲染)」

**括號裡那個條件沒有成立,而理由值得記著。** 盒投影的窗格網格住在**貼圖座標**裡,牆面板的
邊界卻落在任意的 u/v ⇒ 每一面牆的兩側都切到半扇窗。「逐格決定要不要畫」的前提是知道
**這一棟**的格子多大,而 `cols`(立面款)與 `rows`(由樓高推導)都是逐棟的、UV 卻烤在
共用節點上 —— 這是「貼圖做不到」的真正理由。但格數其實**與實例縮放無關**:

```
k = 面板寬(世界) ÷ 格寬(世界) = (面板寬_local × sx) ÷ (b.w ÷ cols)
  = 面板寬_local × cols ÷ 節點局部寬          ← sx 約掉了
```

而 `cols`/`rows` 正是**立面材質桶的鍵**(`wallOf(rows)` / 斜頂款)⇒ 逐「節點 × 材質桶」
烤一份對齊過的 uv 就夠,**InstancedMesh 的分組、draw call、三角形、名冊、預算全部不動**。
量過的另一條路(幾何窗)是 16 棟約 **10,700 片 = 21,400 tris** + 一條新的渲染路
(五顆節點 107 片平整牆面板,cols 7 / rows 26 的典型網格),換不到任何額外的正確性。

**三個落地細節**:
1. 格數用 `Math.round` 不是 `floor` —— floor 會在面板邊緣留一條不足一格的餘料,而那條餘料
   只能是「半扇窗」或「要另外切三角形才畫得出來的素牆」。round 讓格子伸縮去**貼滿**面板
   (伸縮 ≤ 1/(2k)),兩側邊界恆落在格線上。
2. round 成 0 的面板**整片**改吃素牆帶(= 使用者的第一句)。逐面板判定 ⇒ 不會有「一半有窗
   一半沒有」的邊界。實測 4 種網格合計 68 片被擋掉。
3. **跨面板的共用頂點要先拆**:GLB 的整棟量體節點雖是平面著色匯出(拆分比 2.93),仍有約 2%
   的頂點被兩片面板共用 —— 不拆的話後寫的那一份會把另一片邊界上的三角形整個拉歪,而那個
   歪掉的三角形恰好就長在面板邊界上,看起來正是「被裁一半的窗」。`profGeo` 保險絲全拆、零成本。

規則本體住 **`public/js/wallpanel.js`(零 import)** —— `parts_src.flatWalls` 的分群同輪改成
轉呼它(原本那份是這一輪新寫的第二份實作,353/0 逐項不變 ⇒ 兩邊數值相同)。
驗收:`audit_siteplan` **245 / 0**(新增 ⑥-d 五條,其中四條是**行為直測**:真的切一次面板、
跑四種網格,驗「格數恆為 ≥1 的整數」「u 跨距恆為 1/cols 的整數倍、v 恆為整數列」
「v 恆收在窗牆帶內」「共用頂點真的會出現」)、`intake_parts` 353 / 0、`--break-flat` 紅 3 條、
`client_syntax` 119(多一支模組)、`solo_boot`/`audit:net` 全綠。

### 5ba-i. 第三輪(同日追加):**水平處也要整平、邊角修復為直角**

> 使用者原句(圈了屋頂 / 退縮頂 / 簷口 / 牆頂交界那幾處):「那就盡可能提高平整度,水平處也要
> 盡可能整平,邊角盡量修復為直角,紅筆圈起來的地方很不平整」

第一輪只把**牆**推平。三個成因讓水平面與邊角原封不動:

| | 成因 | 修法 |
|---|---|---|
| ㋔ 邊角被磨圓 | 同時屬於兩片平面的頂點,舊制「逐群各投影一次再平均」—— 平均點恰好落在兩個平面**中間** | 解**平面交線**(2 面)/ **交點**(3 面) |
| ㋕ 平面沒吸到軸上 | 一面 3° 歪的「水平」屋頂,整平只會把它整成一面 3° 歪的平面 | 群的最佳平面接近水平/垂直就吸到恰好;門檻沿用 `wall_ny` = 0.15,**不是新數字** |
| ㋖ 碎屑不屬於任何大群 | 尖刺與屋頂碎片各自成群、都在 `min_f` 之下 ⇒ 一動不動 | 不屬於任何大群的頂點,離某個大平面在容差內就吸上去 |

五顆節點平均(牆平整 / 屋頂平整 / **近水平**平整 / 軸對齊 / 小角):

| | 牆 | 屋頂 | 近水平 | 軸對齊 | 小角 |
|---|---|---|---|---|---|
| 第一輪出貨 | 85.6% | 56.1% | 38.5% | 55.0% | 16.8% |
| **這一輪** | **89.1%** | **58.3%** | **45.5%** | **64.7%** | **7.9%** |

逐顆小角:mass_a 24.7→**14.6**、mass_b 11.1→**8.8**、mass_c 27.9→**10.8**、
masslow_a 7.9→**1.6**、masslow_b 12.2→**3.6**%。
「近水平」= |n.y| ≥ 0.85 那一群(= 使用者說的「水平處」);masslow_a 是山牆屋頂、這一欄恆 0,
平均值偏低是分母的事,逐顆看 mass_a 63.9→68.8、mass_c 68.0→75.3、masslow_b 0→44.3。

**參數掃描**:`passes` 8→16 再降 0.7pp;`off_f` 0.045 / 0.06 **全面變差**(過度變形,軸對齊
65→62→59);軸向吸附**單獨**上線會讓小角略升(16.7→18.0)—— 要配交線解才降到 8.2,
兩者是同一件事的兩半。`deg` 維持 12(18 會讓 mass_a 的平整佔比掉到 22.8%)。

**同輪修掉的兩個量測分歧**(兩者都會讓入庫閘紅字而畫面上一個像素都沒變):
1. Python 的 UV 分帶少了「**群本身也要近垂直**」那一條 —— 一片近垂直的面只要落在傾斜的群裡
   就被烤成「平整的牆」,而執行期 `wallPanels` 是連群一起判的。
2. **退化面**(焊接後面積歸零):看不見、法線是雜訊,而兩支量測對它們的分類不同。
   mass_a 兩片就足以讓「傾斜面收在素牆帶內」紅字。⇒ 整批排除,兩支吃同一份面表。

新帶寬:`mass` 0.128 / 0.275、`masslow` 0.203 / 0.259;`sign_flat_min` 重量後由 0.334 → **0.320**
(語意空檔 0.294 ↔ 0.348 的幾何中點;哪幾段合格沒有變)。
驗收:`intake_parts` **353 / 0**(整平前的 GLB 仍紅 22 條)、`audit_siteplan` **245 / 0**
(`--break-flat`/`--break-prof`/`--break-glass`/`--break-roof` 各紅 3 / 4 / 2 / 2)、
其餘 13 支離線稽核 + `auto_intake` + `audit:net` 全綠。

**還在的**:mass_b 的尖塔與 mass_c 的錐頂仍有碎屑 —— 那兩處**本來就不是平面**,
整平救不了;要換的是節點本身(重生佇列 §5as-f)。mass_a 仍是最不平的一顆(牆 74.6%)。

## 6. Open questions for the repo owner (do not guess)

0. ~~設計圖要不要進 50/25/25 配比 / 低矮建物要不要開第二個量體桶 / 鏡像貼補的觸發條件~~
   — **RESOLVED 2026-08-09**(使用者定案三條,規格見 §5aj:①配比含設計圖 ②開 ③只補有洞的、
   小洞直接貼平)。
1. Add an `HF_TOKEN` repo secret (with SF3D licence accepted) if CPU inference in Actions should ever
   be attempted; otherwise all inference stays on the 3060.
2. `fetch-photos.yml`'s push trigger is pinned to branch `claude/photo-db-img-to-3d-8j9tbe`;
   after PR #127 merges, keep only `workflow_dispatch` (edit the `on:` block) or repoint the branch.
3. ~~Accept the SF3D licence~~ — **RESOLVED 2026-08-05** (owner accepted on `winniexchang`;
   weights downloaded, P2c executed same day, §5e).
4. ~~Approve installing Blender~~ — **RESOLVED 2026-08-05** (Blender 5.2 LTS via winget, §5c).
5. ~~`ac_a`(屋頂空調機組)要重生成,還是改走 Route A?~~ — **RESOLVED 2026-08-10:使用者選
   「等乾淨照片再重生成」**(維持 Route B / img→3D,配方不變)。⇒ `ac_a` 與另外三顆同一條路:
   **等 `inbox/building/acunit/` 進來一張背景乾淨、光線充足的冷凝機組斜拍**(§5as-f 1)。
   撤下改走 Route A 純資料 primitive 那一案**不採用**,MUST NOT 自行復辟。
   ⚠ 已知代價要記著:磨圓機制(等值面外推 + quadric 各磨一次稜線)還在,而**箱體越小磨得越兇**
   ⇒ 這一顆對選片的要求比整棟量體那三顆更嚴(主體要占滿畫面、稜線要清楚)。
