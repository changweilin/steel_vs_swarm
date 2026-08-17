# AI 3D Asset Pipeline — Plan and Execution Runbook(蒸餾版 2026-08-15)

> **Audience: AI agents.** Merged 2026-08-11 from the former `ai3d_asset_plan.md` (settled
> decisions) and this runbook (state + trial log). Companion skills:
> `.claude/skills/photo-to-3d-pipeline/` (the procedure), `photo-to-prop-forge/` (static contract),
> `mech-part-forge/` (dynamic contract).
> §0–§4 are **live state — keep them current**. §5* is the trial log, referenced by anchor
> (`§5aj-C` etc.) from ~25 files under `tools/ai3d/`, from `public/js/biomes.js` / `beacons.js`
> source comments, and from CLAUDE.md ⇒ **anchors must never be renumbered or deleted**.
>
> **2026-08-15 蒸餾**:§5 由 5,700 行逐輪敘事壓成**逐節結論索引** —— 每一節保留錨點與它的
> 定案 / 閘門開關 / 決定性數字 / MUST NOT,敘事(當輪怎麼查、試了幾種寫法、逐張黏土講評)
> 移出。**要看全文走 git**:`git log -p --follow docs/ai3d_runbook.md`(蒸餾前最後一版 = 本檔
> 上一個 commit)。方法論那一半已經住 SKILL,本檔不重複;兩者分工:**SKILL 寫「怎麼做」,
> 本檔寫「這個 repo 量到什麼、定案了什麼」**。

---

## 0. Settled decisions

Goal: raise detail density of **dynamic units** (mechs / building-unit NPCs) and **static props**
(buildings, giant trees, megaliths, landmarks) one tier without touching the rig contract,
determinism, or A2 (zero npm deps). Hardware anchor: **RTX 3060 12GB**.

| Item | Decision | Reason |
|---|---|---|
| Output form | **Part-library GLB + existing assembly code** | Assembly / paint / gait / jitter stay where they are ⇒ per-instance variation, determinism and `partJitter` unchanged; zero contact with the rig contract |
| Auto-rigging (UniRig et al.) | **Deliberately not used** | This rig is not a skinned skeleton, it is a **named part hierarchy** (`rig.legL` / `rig.chest` / `rig.muzzles`…) driven per frame by `locomotion.js`. A skinned skeleton scraps `MOVE_SIG` / `CAST_SIG` and three audits at once |
| Part splitting | **P3-SAM** as cross-validation only | Per-slot generation guarantees the mapping; P3-SAM only checks the parts still read as one machine |
| Decimate / clean / export | **Blender headless (bpy)** | Offline, no npm, scriptable |
| 2D drafts | **`agy`** for mechs (subscription quota) / local **FLUX.1 Kontext dev GGUF** for bulk | Gemini CLI dropped consumer tiers 2026-06-18; the paid-API route is archived |
| Photo sourcing | **Openverse API** + Wikimedia Commons, **CC0/PD only** | A hard gate, not a recommendation — a rock baked into the repo has nowhere to carry attribution, and a licence violation produces no error message |

### 0.1 The img→3D ladder (measured on this card, not assumed)

`T2-spz (buildings / anything textured) → Hunyuan3D-2GP (solid rock) → SF3D (fast prescreen) →
keep the procedural part`. Drop a rung whenever one fails. **Never change a rule or a contract to
make a tool fit.**

| Tool | Verdict | Measured |
|---|---|---|
| TRELLIS.2-4B / TRELLIS 1, official builds | ❌ **out on this card** (§5l) | TRELLIS 1 clears cond/sparse-structure/slat but flexicubes extraction OOMs with 9.58GB free after every offload trick; TRELLIS.2-4B needs 24GB and floors at 512³. The old "8GB@256 / 12GB@512" line conflated two generations |
| **TRELLIS.2 stableprojectorz fork** | ✅ **open** (§5n) | Native Windows, prebuilt cp311 wheels, per-stage CPU offload: 7/7 @1024³, torch peak ≤3.4GB, 59–226s/image. **The real threshold is system RAM** — the model sits in CPU at ~19GB and loading dies silently below ~20GB free |
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
   success, i.e. layout diverging per client (§2.3). **Do not "fix" this into a vertex scan.**

### 0.3 Method split by geometry class

| Family | Method | Why |
|---|---|---|
| Landmarks `KIND_PARTS` | **LLM reads photos → writes pure-data part rows** ("Route A") | Part tables are already pure-data primitives — the only reason `audit_beacons` Ⅰ can verify extents offline. Zero binary weight, zero licence exposure. Output is **part-table data rows, not three.js code** (A38) |
| Megaliths `MEGALITHS`, giant-tree sculptural parts | **img→3D → partlib GLB** | Organic and irregular — primitives cannot express them; the only class worth the GLB payload |
| Building whole masses (`biomes.js` general-building InstancedMesh) | **img→3D GLB** (queue F) | Overrides the 2026-08-08 "organic only" narrowing — see below |
| Building roof deco `BLD_LIB` | GLB, already shipped | Different consumer from the masses; both are true |
| Small vegetation, generic building masses | **Stay procedural** | Wholesale GLB swap explodes draw calls and the triangle budget |
| `CIVIC_PARTS` civic props | **Declined** (user, 2026-08-08) | — |
| Mechs / NPCs | Track A only (§0.4) | Out of scope of the static proposal |

**Scope history, because it reads as a contradiction otherwise.** On 2026-08-08 the user narrowed
scope to *"only complex organic shapes — landscape trees, rocks"*, declining `CIVIC_PARTS`. Later the
same day they directed "now handle the buildings" and chose **execute queue F**. So building masses
are **in**, via the GLB lane. Nothing already shipped was removed.

**"Just add more rows" is not free.** For trees the roster **is** the knob and it is at its economic
limit: `node_cap = growth allowance ÷ Σ(roster rows × that type's instance ceiling) + current part
tris`. Every new `lib:` row is another instance-row in the divisor — wiring *every* canopy clump
would drop the cap into the 2.4–3:1 decimation band where Blender tears holes in the canopy shell,
and **extents and budget both stay green in that state**; it only shows up in a screenshot. Within
trees, "build more" means **swapping which clumps are wired**. Rocks still have headroom.

### 0.4 Track A — dynamic (slot contract)

Slots are already defined per chassis kind (`models.js` is authoritative): `aerial` —
`tilt`/body/`wpn.{light,heavy}.g`/`muzzles.*.n`; `biped`/`quad` — `hips` `chest` `neck` `head`
`legL/R` `armL/R` `legChainL/R` `armChainL/R` `tailSegs` `gunR/gunL`; `morph` — `torso` `head`
limbs + `kneeL/R` `ankleL/R` `elbowL/R` `wristL/R` `vents` `thrusters` `rotors` `flapWings`.

- Muzzle nodes and `rig.wpn` local pose **must not move** — forward-facing muzzles rely on a
  build-time world-alignment inverse. `audit_muzzle.mjs` must stay green after a re-skin.
- Whole-unit bbox drift **≤ ±5%**, or `fitToHeight` rescales and the health bar / marker / glow skew.
- Hydraulic-style **single-end anchored, angled** parts must not become two-end joint-spanning parts
  — the gait will stretch them apart.
- **Transformers get one part set, not two** for *generation* purposes: split images are drawn from
  the ground form (pivots are legible there); flight masters are for **acceptance**. ⚠ The shipped
  runtime has since moved to **two trees** (`forge/`, 2026-08-14, CLAUDE.md §2.1 F) — this row is
  about what to feed the generator, not about how the game holds the model.
- Gates: `audit_muzzle` + `audit_cockpit` + `audit_cast_jump` + `audit_gpu_lifecycle` green,
  `shot_units.mjs` before/after, and `npm test` / `npm run bal` **bit-identical**.

### 0.5 Prompt spec for image→3D inputs

Nine rules, all of them in every prompt: ①exactly one object, isolated, complete ②uncropped, ~85% of
frame, even margins ③three-quarter view ~35° yaw / ~20° elevation, long-lens (100mm) ④flat even
ambient light, no cast shadow, no rim light ⑤flat single-colour neutral background (#808080), no
gradient, no ground plane ⑥**fully opaque — no glass, transparency, glow or emissive** (the #1
failure mode) ⑦crisp panel lines and bolts, matte surface ⑧no text, logos, arrows, dimensions,
watermark or turntable sheet ⑨≥1024 short side, square.

Pre-processing: matte to alpha (`rembg`/BiRefNet), check the alpha edge for leftover outline strokes,
never submit a short side < 1024. A matte fed to T2 **must be binarised** (alpha >16 → 255): T2 crops
to an `alpha>204` bbox and eats a soft matte.

**Two prompt seams, both in `codex.js`, neither writable by its consumers:**

- `FORM_POSE` — the flight master **must state the machine is off the ground and in flight**, and its
  framing must not contain `standing` (six of eight flight masters came back as correctly transformed
  airframes standing on the ground).
- `SHOT_POSES` — pose (static / moving / heavy) is **orthogonal** to form; `shotFraming()` composes
  them; `moving`/`heavy` declare framing **per medium**. Design anchor: `slots.mjs refShotOf()`
  resolves in two tiers — **a rejected shot is never an anchor**.

Recurring lesson from the first review pass: most review notes were not art direction, they were the
artist hand-patching pipeline bugs (a design brief that was never sent, a limb count contradicting
itself, stale `visual` fields fed to chassis that no longer consume them).

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
ruling "only fill actual holes; cap small ones flat" — spec written, not implemented).

`depot`'s "corpus is ready" was **false** — the count was met but the photos were two Victorian glass
aquaria and one harbour panorama. **Roster counts and `--plan`'s green only ever guarantee *how
many*; Route A's first step is to open the photos.**

### Shipped

Evidence for every row is the cited trial-log section.

| Item | Shipped | §ref |
|---|---|---|
| Corpus images in the review list + "original vs generated" split to same-source pairs only | 2026-08-10 | §5ay |
| Parts board as cockpit — harvest-loop start/stop + three photo states | 2026-08-10 | §5ax |
| Fully automatic intake + after-the-fact human verdicts (⑦⑧⑨) | 2026-08-10 | §5aw |
| Target selection + separation + three screens (several subjects per photo) | 2026-08-10 | §5au |
| Route A parts: `beacon/mast`, `beacon/pylon` | 2026-08-10 | §5av, §5at-b |
| Harvest loop + first full run (169 outputs, all human-reviewed, zero nodes shipped) | 2026-08-10 | §5ar, §5as |
| Parts board hides work-in-progress; per-type veg attribution fix; 7 new nodes | 2026-08-09 | §5aq |
| Building line: storey height, roof-band UV, facade layers, low-rise mass bucket, mix incl. drawings | 2026-08-09 | §5ak–§5ap |
| Drawing→3D visual hull `plan_hull` (function shipped, zero nodes) | 2026-08-09 | §5ai |
| `hoodoo_a` replaced (corpus **and** post-processing together); selection + building-mix rulings | 2026-08-09 | §5ah |
| `chimney_a` regenerated (same photo, different model); hoodoo rejected | 2026-08-09 | §5ag |
| Smoke test finally ran — and found the whole building line was dead code on main | 2026-08-09 | §5af |
| `mass` roster to 2 nodes; the corpus is the root cause of "the other side is empty" | 2026-08-09 | §5ae |
| Mirror-fill extended to megaliths (measure which side is empty, then pick the cutter) | 2026-08-09 | §5ad |
| `building/mass_a` — first whole-mass node; deco caps cleared | 2026-08-08 | §5ab, §5ac |
| Whole-mass budget + consumption seam (queue F steps 1–2) | 2026-08-08 | §5aa |
| Canopy shape: petal route vs simple-geometry route → whole-tree nodes; star canopy | 2026-08-08 | §5w–§5z-t |
| Tree corpus rework F0 (selection gate, usable-count ledger, resampling) | 2026-08-07 | §5p, §5q |
| First T2 node (`rock/tower_a`) + `solidify_parts.py`; first tree node (`tree/snag_a`) + `whole:` seam | 2026-08-07 | §5t, §5u |
| Thin-shell decimation gate — direct decimation **closed**, solidify-then-decimate **open** | 2026-08-07 | §5o |
| TRELLIS.2-spz gate **open**; Hunyuan3D-2GP gate **open** + `rock/hoodoo_a`; official TRELLIS **out** | 2026-08-06 | §5n, §5m, §5l |
| Scale-out batches: buildings D-4, megaliths D-5, trees D-6 | 2026-08-06 | §5i, §5j, §5k |
| D-1 giant-tree canopies, D-2 megalith seam, D-3 per-species canopy split | 2026-08-05 | §5g, §5h |
| P1 seam (`partlib.js`), photo fetcher + DB integrity, P2b/P2c, `giantCrownR` by contract, review board | 2026-08-05 | §5b–§5f, §7 |
| Plane merge / denoise / small-block merge / base seal (four rounds) | 2026-08-12~14 | §5az–§5bd |

**Blocked:** Track A / P3 mech slots — `agy` returned 429 RESOURCE_EXHAUSTED for every slot across
two rounds (model-level quota, `--no-ref` too). `models.js` is deliberately untouched: a seam with no
real parts to calibrate against is a 10×-expensive failure. Resume with
`node tools/ai3d/gen2d.mjs --only t01 --no-ref --limit 7`.

---

## 2. Environment — 只留 SKILL 沒有的

`photo-to-3d-pipeline` SKILL §1 已有那張「哪個環境能做什麼」的矩陣與 Wikimedia 節流數字,
**不在此重複**。這裡只留該 SKILL 沒有寫、而且會讓人白燒一輪的四條:

- **官方 TRELLIS 死在 WSL 的磁碟而不是 VRAM**:`ext4.vhdx` 在宿主端長不了,而 WSL 內 `df` 報的
  是虛擬 1TB(會騙人)。`wsl --manage Ubuntu --move D:\wsl\Ubuntu` 走約 29 分鐘。
- **原生 Windows 不建 CUDA extension**(無 MSVC)⇒ 那一族一律 WSL2;而 T2-spz 的 fork 有預建
  cp311 wheel,所以它反過來只跑原生 Windows,且 `ATTN_BACKEND=xformers` **必須顯式設**。
- **sandbox 對 artifact 也沒有 ingress**:MCP 給的是簽章 blob URL(proxy 403),`api.github.com`
  REST 回「GitHub access is not enabled for this session」⇒ 不要再測一次。
- **HF Space 路線沒有出口**:`dynamic_space` 只認 MCP-enabled space,`stabilityai/stable-fast-3d`
  不是 ⇒ Space fallback 只能由 3060/瀏覽器驅動。
- 目前的資料家絕對路徑與 venv 位置**故意不寫在版控裡**(它們會搬)—— 見記憶 `ai3d-pipeline-state`
  與 §5d。

## 3. Fixed rules (violating any of these = revert, no discussion)

1. **Parts, never finished props** — assembly and variation stay in existing code.
2. **CC0/PD only; photos never enter the repo** — only part-library GLBs do.
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

Steps A–F0 are **all shipped** — see §1. What remains:

1. **Wait for photos in `inbox/`**, then regenerate the four blocked nodes + `depot` (§1).
2. **First real `auto_intake` run on the 3060 with `--limit 1`**, then `git diff --stat` immediately:
   exactly three files should move (`<family>.glb`, the `biomes.js` roster, `parts_manifest.json`).
3. **§5aj-C** — hole-driven fill (§1).
4. **Real-device smoke + `audit_traverse`.**
5. **Track A (mechs)** — do not start before the static batches are stable. Blocked on `agy` quota.

Standing discipline for any new family: **measure the family before generating for it**, and **match
the AI part to the fallback's *shape*, not to the slot's name**.

---

## 5. Trial log — 蒸餾索引

> 每一節保留原錨點;內容 = 該輪的**定案 / 閘門開關 / 決定性數字 / MUST NOT**。逐輪敘事與逐張
> 黏土講評走 git 歷史。子節錨點只保留**被外部引用**的那些(source 註解、CLAUDE.md、記憶)。

### 2026-08-05 起步(§5b–§5f、§5、§5d)

- **§5b / §5c / §5e / §5f** — P1 縫 `partlib.js` → 照片抓取 → SF3D 授權開通當日跑完 P2c(首批 GLB
  零件)→ biomes `p.lib` 縫 + `giantCrownR` **由契約解**(不是頂點掃描,見 §0.2 ⑦)。
- **§5d** — SF3D gate 二探:token 健康但 repo `gated: auto` ⇒ 本人按同意即開。**資料家記錄**(venv
  帶絕對路徑,MUST NOT 搬;fetcher 要從那份跑)。**magic-bytes 閘上線**:`sniffImage()` 只收
  JPEG/PNG/WebP —— 兩支 Internet Archive **PDF** 以 `ok` 躺在「乾淨」的 DB 裡(licence 是真的、
  bytes 是假的)。第二個 bug:`replace(HERE + '/', '')` 對分隔符敏感 ⇒ Windows 靜默 no-op、
  manifest 記下**跑抓取那個 worktree 的絕對路徑**(28 列)⇒ 產物 MUST NOT 編碼它是哪台機器抓的。
- **§5**(sandbox)— Actions run 1:118 筆 / 35 ok / **0 授權違規**;artifact ingress 與 HF Space
  兩條路都不通(見 §2)。

### 2026-08-05~06 規模化(§5g–§5k)

- **§5g / §5h** — 神木冠層 D-1、巨岩縫 D-2(命令式建造端的第一個消費端:`megaGeo` MUST clone)、
  逐樹種冠簇 D-3。人眼只需複核前幾名,**工作清單順序 = 優先序**。
- **§5i**(建築首批;使用者「大量下載不同國家/城市/小鎮/風格的建築物照片再 img→3D,**無視舊有
  物件直接畫,禁止使用原版重繪**」)— 本輪最重要的方法結論:**InstancedMesh 桶的預算與 rock/tree
  是不同的幾何學**(逐節點上限 = 桶 instance 上界推導,不是逐顆);人造直線輪廓的減面路線與岩族
  **相反**;抓取節流是**小時級長時窗**(連續 7 輪 ≈80 分鐘 0 張)。
- **§5j**(巨岩第二批,同一句使用者定案)— **人眼那一步 MUST 先看照片,再看網格**;逐件上限由
  「解析值當分母、量測值當分子」推導(430,舊 306)—— 拿抽樣當分母會把閘門算鬆,**而鬆掉的閘門
  不報錯**;出貨 MUST 留餘裕(421 貼著 430 = 沒有餘裕)。同輪抓到**兩處共用 `rnd()` 混進局部種子**
  的建造器(`cliffPlant` 蕈傘色 / `nest` 蛋位與停棲鳥)⇒ 300 顆裡 62 顆跨客戶端分家。
- **§5k**(樹族第二批,同一句)— 定案「連 Quaternius 一起換掉」;`whole_factor = 4.0` 是**量出來
  的**;量測工具的指紋 MUST 問真品(`ico(0.9)` 同時是 shrub 與 conifer2 ⇒ 兩族互相灌);尺寸階
  MUST 逐列一顆;**Quaternius 退場讓 aokigahara 全場三角形大幅下降**(反向的好消息)。

### 2026-08-06~07 三道模型閘門(§5l–§5o)

- **§5l** — 官方 TRELLIS **閘門關**(這張卡跑不動,排除所有可疑因素後的結論,見 §0.1/§2);同輪
  記下 SF3D 在「都市建築 / 知名神木 / 知名巨岩」三族的 fill 基準,是 §0.3 分流原則第一次有實測。
- **§5m** — **Hunyuan3D-2GP 閘門開**,首個 2GP 節點 `rock/hoodoo_a` 出貨(帽岩/細頸/基座全保住 ——
  細頸正是 SF3D 最容易掉的識別特徵)。原生 3D 擴散推得出深度、單前饋推不出。
- **§5n** — **T2-spz 閘門開,§5l「頭兩階是空的」被 fork 翻案**:7/7 @1024_cascade。**餵 T2 的
  matte MUST 先二值化**;`ATTN_BACKEND=xformers` 必須顯式設。零節點出貨 ⇒ `METHODS` 不加鍵。
- **§5o** — **薄殼直接減面閘門關,「先實體化再減面」把它打開**:T2(O-Voxel)產出 500 面時
  468~479 元件 = 幾乎每一面都是孤立三角形。**人眼複核 MUST 剝貼圖(clay pass),但 clay 也看不出
  不封閉** ⇒「不封閉」在物件尺度上看不見,MUST NOT 拿它當封閉性判準。

### 2026-08-07 首件入庫與救援閘門(§5p–§5v)

- **§5p** — F0 執行:選片閘上線、語料帳改「可用張數」、**T2 載入與 rembg MUST NOT 同時跑**。
- **§5q** — **定案:葉冠不走 img→3D。**①冠簇維持程序 ico + 照片貼圖;②img→3D 對樹族**只收雕塑性
  主體**(枯幹/板根/扭曲幹);③冠層照片降為貼圖與輪廓參考。理由:葉冠在 T2 上是**逐 seed 抽籤**
  而三種結果都不能用(平板 / 浮雕 / 碎塊雲),重抽沒有出口;斜側路線在**採集端**就死了。
- **§5r / §5s** — 岩石浮雕救援:**整片鏡射/旋轉/Poisson 閘門關**(T2 浮雕殼撕裂遍佈,鏡射把殼從
  中剖半);**§5s 部分翻案:補丁照洞剪、缺口緣鏡射(V5a 兩緣半跨)可用**。缺口 **MUST 實測不准
  目測**(目測 30° vs 實測 115°);n=1 未升常設。
- **§5t** — **T2 首件入庫 `rock/tower_a` + 實體化刀 `tools/ai3d/solidify_parts.py` 落地**(參數
  3×3 掃描)。枯幹走不了岩族的刀(三連敗)。
- **§5u** — 樹族首件 `tree/snag_a` + **整樹節點縫**(`whole:` 是一列以上的陣列);使用者定案:
  「缺口補平當作被砍伐或雷擊損毀,自然的樹木本來就不完美,繼續」。
- **§5v** — 冠層以新刀複測:**§5q 原判維持**,機制升級成可量的數。

### 2026-08-07~08 冠層造型(§5w–§5z-t)

- **§5w / §5x / §5y** — 使用者手稿:莢化放射 + 樹幹迴轉;逐瓣 r/θ **±1/8 誤差且零均值**
  (`Σ Δθ = 360.000000°` 逐位元);v7 逐叢瓣化。三顆旋鈕的順序定案:**合併 → 剔除 → 減叢**(由便宜
  到貴)。共面合併**沒有面積守恆守衛就會靜靜把整片挖掉**(0.1° 門檻下 138/142 群)。
  - **§5y-h** ⚠ 更正:**守門線 MUST 逐槓桿分開訂**,§5y-d「針葉塞不下」的結論作廢 —— 減叢與減面
    掉的東西不同(前者掉團、後者糊洞),拿同一條全域門檻算預算會得到錯的結論。
- **§5z** — 簡單幾何版(使用者:針葉多角錐 / 闊葉橢球或多面體 / 幹枝圓柱圓台 / 尖端細錐)。
  **它不是降級鏈的第 N 階,是另一條路線**,兩者 MUST NOT 互相取代。逐輪定案:第二輪四條 → 第三輪
  淨幹下 ¼ 不分岔(「即可」= 取等號,MUST NOT 多給)→ 第四輪先拉長填滿再刪。
  - **§5z-j** 未跑 / 待決(檔位是建議不是定案那一批;⑨ 已由 §5z-n 收斂)。
  - **§5z-n** `--touch` 定案 **1.15**,**面數逐位元不變 ⇒ 預算完全不動**;⚠ 輪廓這個數字對針葉與
    闊葉讀法相反,闊葉的 +43.6pp MUST NOT 當成品質證據。
  - **§5z-o** 入庫輪:一株 = **木質 + 葉冠兩顆節點**(一列 = 一個 InstancedMesh = 一份材質 ⇒ 整株
    併成一顆行不通),且**兩顆 MUST 共用一個變換**(各自縮到自己的包絡 ⇒ 樹會散開,而外廓與預算
    全綠、只有截圖看得出來)。使用者定案「闊葉保圓潤冠、從 shrub 挖額度」。
  - **§5z-r** 針葉葉冠改**星盤**(上視內凹 + 下緣內凹 + 層間錯開):谷底 MUST < 兩角之間**弦**的
    中點,否則只是鈍角多邊形;角長改**等比階梯**且 `R_k ≤` 語料最遠外緣 ⇒ **冠幅不會憑空長大**
    (`giantCrownR` 與碰撞柱基準不動);`arc` 取 2(×3 換不到看得見的東西)。
  - **§5z-t** 定場圖那一項終於跑得動 —— 卡四輪的原因是**兩支工具各缺一半**(`shot_scene` 有管線
    不載庫 / `shot_veg` 載庫沒管線);**孤零零一棵樹在空背景前畫不出線**(勾線 pass 在遠平面早退)。

### 2026-08-08~09 整棟量體(§5aa–§5ai)

- **§5aa** — 佇列 F 第一段:**先量再開,而量測直接否決了「整桶換」**(整桶換的逐節點上限只有
  36 tris,而 §5o 已實測 500 面才留得住退縮量體)⇒ **「只換一個子集」是量出來的結論,不是偏好**;
  高度門檻 `min_h = 55` 沿用既有退縮頂塔門檻,MUST NOT 另發明數字。逐位元不變 **MUST 用量的**
  (同一張圖兩次 `--live` 差 ±70%)。
- **§5ab** — 首顆整棟量體節點 `building/mass_a` 入庫;`--cells` 在建築上不是解析度旋鈕,是**濾掉
  立面凹槽**的旋鈕(`--cells 72 --offset 0.006 --target 2900`)。
  - **§5ab-c** 一個只有截圖看得到的缺陷:**附件浮在半空**(庫節點止於 0.95×b.h,屋頂附件坐在盒
    頂)⇒ 丟棄桶;**帶碰撞柱的兩件 MUST NOT 進丟棄桶**。
- **§5ac** — 鏡像貼補:**刀的位置比刀本身重要**。
  - **§5ac-a** 「空」不是破面,是**沒被拍到的那半沒有東西**(六個方向都有面,是半空間**不對稱**)。
  - **§5ac-b** 兩次失敗:鏡射放在 solidify 端,兩種寫法都把網格撕爛(不是輸入髒的問題)。
  - **§5ac-c** 刀的正確位置 = **Blender 端 bisect + weld**,且 MUST 排在減面**之前**;
    **MUST NOT 對非對稱典型的主體套用**(岩體/枯幹鏡射出來是一顆假的雙生岩)。
  - **§5ac-e** ⚠ 之前所有「多視角」複核**全部是同一個視角** —— `rotation_euler` 在
    `rotation_mode='QUATERNION'` 下是 no-op(判準:轉 60° 後包圍盒 MUST 變)。
- **§5ad** — 鏡像貼補推廣到巨岩/假山:**先量哪一面真的是空的,再決定用哪一把刀**。閘門錨在使用者
  自己判定過的那一顆(`EMPTY_ASYM = 0.12`),**MUST NOT 改成逐顆手挑名冊**;兩把刀依主體是不是
  人造的選(`half` / `union`;union 在 12 顆岩節點裡炸掉 6 顆);三道閘 MUST 排在減面之前;
  去對稱化 `warp` 的**位移 MUST 只是位置的函數**(取頂點法線會沿每條硬邊撕開),**有破口的節點
  MUST warp 0**。
  - **§5ad-g** 驗收 + 反向驗證:`--rework "hoodoo_a=z|0"` MUST 紅字「鏡射把面數打掉了(382→96)」;
    `"tower_a=auto|0|union"` MUST 紅字「炸成碎片(元件 1→14)」。
- **§5ae** — `mass` 名冊補到 2 顆;**語料才是「另一面是空的」的根因**(mass_b 整棟入鏡 ⇒ 半空間
  不對稱遠在門檻之下,**不需要鏡像貼補**)。
  - **§5ae-e** 兩份會靜默過期的**手寫清單**(名冊一擴充就中招)⇒ 改由家族推導。
  - **§5ae-f** 驗收。
- **§5af** — 冒煙終於跑得動,一跑就發現**整條建築線在 main 上是死碼**;使用者定案**提高物件高度
  上限**(`OBJ_F 2 → 4`)而不是把門檻改成推導值;守門線 = 吃建物高度的門檻 MUST 全部 <
  `objHeightMax()`。
  - **§5af-g** 未做清單(`chimney_a`/`hoodoo_a` 重生成即由此接手)。
- **§5ag** — `chimney_a` 重生成:**換模型不換語料**;hoodoo 判退。
  - **§5ag-c** **讀數全綠而形狀是錯的,只有黏土看得出來** ⇒ 重生成 MUST 走階梯上**對的那一階**。
- **§5ah** — `hoodoo_a` 換掉:**語料與後處理要一起換**;⚠ `--node` 目標欄 MUST 維持非等向 `1x1`
  (寫成等比 ⇒ 整柱比碰撞柱細 37%,而所有離線閘門全綠)。
  - **§5ah-d** 使用者定案①:選片 = **乾淨單一主體 + 光源充足**(門檻逐桶列表,對照已出貨極值)。
    **照片髒不等於輸入髒**,反過來也成立。
  - 同輪使用者定案②:建築語料 **50 / 25 / 25**。
- **§5ai** — 設計圖 → 3D:**這一段不是模型,是幾何**(視覺外殼)。三個「不報錯只給爛結果」的地方
  全部量過:①每張設計圖都有**圖框**(泛洪會量到那張紙)②**渲染圖不是線稿**(輪廓內墨密度:HABS
  測繪 11.4% vs 渲染圖 32~71% ⇒ `LINEART_INK = 0.25`)③輪廓有缺口 ⇒ **空網格**,且**順序 MUST 是
  先驗缺口再驗渲染圖**。
  - **§5ai-e** **本輪零節點出貨,而理由是形狀不是品質** —— 與其塞一顆形狀不對的,不如把缺口寫清楚。

### 2026-08-09 交接規格(§5aj)

- **§5aj** ⭐ 三條**使用者定案、當時都還沒實作**的規格:
  - **§5aj-A** 配比改成「設計圖 + 照片」合計 50/25/25(分母含設計圖;**MUST NOT 把格式塞進 `grp`**;
    **設計圖 MUST NOT 走照片的選片閘**)。→ §5ak 落地。
  - **§5aj-B** 開第二個「整棟量體」桶(低矮建物);規格 MUST 照 §5aa 那一套推導。→ §5am 落地。
  - **§5aj-C** 鏡像貼補改成「**只補有洞的;洞很小直接貼平**」—— 觸發條件由半空間不對稱換成**真的
    有洞**(現行那把刀「從頭到尾沒有關上任何一個洞」);洞的大小 MUST 校準不可手寫;**回退那三顆
    交換節點**;**樹族 MUST 排除在貼平之外**(葉片是開放面片,是設計不是損傷);文件 MUST 同步。
    **⚠ 仍未實作** —— CLAUDE.md 兩列帶著 ⚠,記憶 `open-user-decisions` 也記著。
  - **§5aj-D** 建議的執行順序(有相依)。
- **§5ak** — §5aj-A 落地,而**閘本身漏掉兩種假綠**。
  - **§5ak-b** 三道閘互相掩護,一塊**簷口碎屑**(2.1%)通過了 ⇒ 補 Ⅶ-c 合成案例。
  - **§5ak-c** 三個設計圖列**結構性地**抓不到東西 —— HABS 在 Commons 上一律是 **TIFF**,而尺寸閘
    MUST 改吃**縮圖**尺寸;帳本裡那 12 筆 TIFF 誤拒 MUST 刪掉(留著 = 永久失敗不再重試)。
  - **§5ak-g** 補抓那一輪:**HABS 的相片與測繪圖共用同一套命名** ⇒ `frame` 這個判退理由身兼兩職
    (整張紙就是圖 / 這根本是相片);閘本身沒有誤殺。
- **§5al / §5am** — 低矮建物桶:量測 → 使用者選 (a) **8/8 切分** → 縫開好、`masslow_a`/`masslow_b`
  同輪出貨(**輪替名冊 MUST ≥2 顆**);資格是兩個**既有**判準的對角線兩格,不發明第三個數字;
  **實體化參數不是全族一份,是隨主體的細部尺度走**。
  - **§5al-b** 推導(額度只能從既有 16 棟裡切,不是另外加的)。**§5al-c** 使用者要決定的那一件事。
- **§5an / §5ao / §5ap** — 外牆圖層(使用者:「斜頂屋頂外觀變摩天大樓的玻璃,請修正」+ 分型別/
  風格/屋頂形式 + 同型差異化):成因是**庫節點是單一材質群組**;答案是 **UV 三帶**不是拆材質群組;
  順手量到**已出貨的立面是上下顛倒的**(`corr(高度, v) = −1.0000`,glTF 原點左上 vs Blender 左下)。
  層高:**列數 MUST 逐「件」取不是逐「棟」**(立面貼圖沒有 per-instance repeat),先落在帶內再貼近
  目標,級距是 draw call 旋鈕。⚠ `FACADE_PX.MIN_H` 與 `MASS.MIN_H` 撞名。
  - **§5an-d** 驗收(建議)。
- **§5aq** — 零件台收半成品 + 逐型歸屬修正 + 針葉三種入庫。半成品判定的兩個常數**是語意不是校準**
  (`HOLE_PERIM_F`/`SOLID_MIN_TRIS`);`OPEN_SHELL_FAMILIES = ['tree']` 是具名豁免。
  - **§5aq-b** 「加入」的第一條路是空的 —— **量出來的**,不是看一眼。
  - **§5aq-h** 語料清倉 300 → 163 張(使用者刪除不符目標/干擾多/光線不足/無法乾淨分離者)。
  - ⚠ **§5aq-i** 樹族選片閘對**現行**出貨名單已有一筆誤殺 ⇒ 動門檻前 MUST 對已出貨來源掃零誤殺。

### 2026-08-10 採集迴圈與自動化(§5ar–§5ay)

- **§5ar** — 採集端改制(使用者四條:附註 / 週期跑 / 更精準的字 + 自己放圖):**兩種兄弟 MUST 分開
  講**(輪替名冊 ≠ 整件的一層);`inbox/` MUST 在 `photos/` 之外;先跑型錄原句,缺額還在才走階梯
  ⇒ 供給充足時逐位元同舊行為。實測撞到**三支舊 server**(跨 session 存活)讓結論被讀成「調整都沒
  進來」。
- **§5as** — 人眼那一步跑完:**169 顆全看過,零節點出貨**,理由在**供給側**;冠層再次確認不可用。
  - **§5as-d** 迴圈自己在兩個地方**白燒 GPU**(兩道閘已補);兩道閘都 MUST **把擋掉幾張印出來**。
  - **§5as-f** 未做 / 交接 —— 其中 `ac_a` 維持 img→3D「等乾淨照片」;**2026-08-14 追加**:
    `chimney_a` 也進這張清單,而那幾處縫與凹槽**不再排任何刀**,要修的是**來源照片的取景**。
  - ⚠ `normalize_parts.py` 檔頭引用的「§5as 的逐格對照」(`OFF_F` 等參數的逐顆掃描表)是敘事,
    **已隨本輪蒸餾移出** ⇒ 要重看那張表走 git;參數本身仍在該檔頭與 `tri_budget.json`。
- **§5at** — 回頭補 Route 0 與 Route A:**A 出貨一顆(`beacon/pylon`),0 仍是零而理由換了**
  (兩視圖外殼的結構性質,不是這張圖的問題);`ROOF_BAND` 取名冊平均**只在屋頂型式同質時成立**。
- **§5au** — 圈選 + 分離 + 三道篩選(使用者:「同一張照片可能有好幾個目標,圈選、分離、篩選太模糊/
  太小/完整度太低的」):判決單位從「一張照片」變成「一個目標」;新站排在去背與選片閘**之間**
  (順序不可對調);**「已出貨的來源被切開」不算誤殺**(校準名單本身要限縮到真的餵過生成器的);
  「太小」刻意不做成新閘(切開後 `MIN_CANVAS` 自動變成逐目標的量);**截斷 MUST 看有沒有碰到照片
  邊框**,而那個資訊在去背當下就丟掉了 ⇒ 補帳;缺這一筆 ⇒ **不評判**(寧缺勿錯)。
  ⚠ 寫反向驗證時踩到:**斷言的期望值 MUST NOT 隨 `--break-*` 改變**。
- **§5av** — Route A 第 3 顆 `beacon/mast`;⚠ `shot_beacons` 機位照 `cairn` 寫死 ⇒ 高的三款從沒被
  拍到過(取景 MUST 由量到的碰撞柱推導)。
  - **§5av-c** `depot` 的「語料已就位」是**假的**(3 張 0 可用)⇒ 改判 **BLOCKED(語料)**;
    **Route A 的第一步 MUST 是把照片打開來看**。
- **§5aw** — **全自動入庫 + 人眼事後判決**(使用者:「先全部自動化,人眼再審查」;附帶定案:終點 =
  寫進名冊但**不 commit**、判「刪除原始照片」時**連節點一起撤下**)。**擋得住的東西不是閘,是
  「可撤」** ⇒ 這一輪一個新的統計判準都沒有加。五個「跑起來很正常、只是某一半靜靜地壞掉」的地方
  全部在寫的時候撞到(不存在的檔 MUST 記成 `null`;兩站共用同一支 `gapsClean()`)。
- **§5ax** — 零件台變成駕駛艙:一顆開關 + 圖檔三態。**採集迴圈不是伺服器** ⇒ job MUST NOT 宣告
  `port`、MUST NOT 回 `url`;資料家探測到兩個而「取第一個」有一半機率是錯的(415 vs 81 筆)⇒
  **面板 MUST 把挑中的那個顯示出來**;三態**零新狀態檔**(四本既有的帳就夠),「已淘汰」MUST 獨立
  成一態。真機實測起在 **8642** 而不是預設埠。
- **§5ay** — 語料圖進清單可手動篩選;**「原版 vs 生成」有一半根本不同源**(img→3D 那一路的「原版」
  是保險絲降級幾何,從來沒出貨過)⇒ 單獨陳列並標注繪製方法。

### 2026-08-12~14 建築外殼四輪(§5az–§5bd)

- **§5az**(使用者四條:尺寸 / 碰撞剖面 / 只貼垂直平整牆 / 窗間距)— 一顆方盒換成**一疊方盒**
  (`bldProfile`,剖面是量出來的**純資料**);節點根本沒有撐滿基地 ⇒ 由剖面實測外廓推導縮放;
  兩帶 UV → **三帶**;窗佔比是**逐款**旋鈕而層高那條定案不動。
- **§5ba**(使用者三條:合併整平 / 只貼平整垂直牆 / 窗戶輪廓太模糊)— 與 §5az-d「平整不靠分群判」
  **衝突的是時序不是規則**:正確順序是**先合併整平、再拿平整當資格**,兩件事 MUST 同一輪落地。
  **重烤 MUST 兩趟**(帶寬 = 整平後才量得到的面積佔比);招牌改吃**剖面第五欄**,挑不到合格的段
  就整棟不掛牌。同日追加兩輪:**窗格貼齊面板**、**水平處也整平 + 邊角修復為直角**。
- **§5bb** 第四輪:**小區塊併入角度最接近的鄰居**(使用者句)。前三輪只處理大群,`min_f` 之下的
  碎塊整塊被略過 ⇒ 五顆節點仍是 225~651 群。四條紀律(比鄰居的面積、共邊、角度上界 ∈ (deg, 45°)、
  併得過去才併);第三句「收斂成多面柱體/錐台/…」是**驗收語不是演算法**。
  - **§5bb-e** **曲面體保護的行為直測**:四顆標準幾何體 `--replanar` 之後併入 0 次、位移 0.0000。
- **§5bc** 第五輪:**合併之前先去噪**(使用者句)。順序就是重點;手法 MUST 是**雙邊**法線濾波 +
  頂點回推(一般平滑會磨掉上一輪修回來的稜線);`dn_deg` MUST < `flat_deg`;位移共用同一個上限。
  - **§5bc-c** 曲面體保護**仍是結構性的**(24 面圓柱相鄰面差 15° ⇒ 值域權重 0.0009 ⇒ 位移 0.0000)。
- **§5bd** 第六輪:使用者圈的「破洞」**量出來不是洞** —— 是底面內凹成穹頂、整顆靠一圈扇貝狀毛邊
  站在地上 ⇒ **封底**(由下往上第一個朝下命中,只壓底緣帶;破口太多就不封底)。三次嘗試前兩次都會
  靜默弄壞別的地方。改制**凹陷深度上限**:深度 MUST 相對**凸包**量(從包圍盒量會把圓柱削成方柱)、
  「穿過去不處理」MUST 是**區塊級**判定(逐點側射會把甜甜圈填成圓餅)、由上往下那一向預設不套。
  - **§5bd-h** `CAVITY_F` **是掃出來的,不是使用者提的 0.20**:取 **0.25**(三項全部優於 0.20,
    且是掃描的內部最佳點);差距落在貪心分群的離散跳動裡 ⇒ 取值 MUST 看**平均**,**MUST NOT 逐顆
    挑**。**2026-08-14 使用者定案:走「重生節點」** ⇒ 形態學閉運算 / voxel remesh **不採用,
    MUST NOT 自行復辟**。

### 2026-08-18 分類平行採集與 8/15 前舊件替代

- CPU 前處理依 family 平行(`--category-jobs`)，每族內仍維持去背 → 分離 → 篩選；三支 Python 以
  跨行程鎖按 family 原子合併帳本。GPU 保持單通道，避免 12GB 卡同時載入模型。
- 模型路由對齊 §0.1 與最新 skill：building → T2-spz；rock → Hunyuan3D-2GP shape-only；
  sculptural tree → SF3D；landmark / vehicle / ship → Route A 純資料零件。Hunyuan 只接外部 adapter，
  不猜 checkout entrypoint；缺席時明示跳過，不用 SF3D 冒充替代版。
- `replacement_plan.mjs` 以 `at < 2026-08-15` 建立逐件清單。新件投料帳帶 `replaces`；只有同一輪替槽
  才能自動標記。零件台判 `⇢ replace` 後才撤舊件，舊來源列搬進封存帳並記 `replaced_by`。
- 固定槽與 Route A 零件不猜配方，列為「人工配方」；它們仍在同一份 61 件清單中，不會被靜默略過。
- 外部 restricted 語料先由 `index_restricted_photos.mjs` 編目，但 `corpus.json shipping:false` 仍強制
  停在 contact sheet；不得自動入庫或成為替代物。

---

## 6. Open questions for the repo owner (do not guess)

0. ~~設計圖要不要進 50/25/25 / 低矮建物要不要開第二個桶 / 鏡像貼補的觸發條件~~ — **RESOLVED
   2026-08-09**(三條定案,規格見 §5aj)。
1. Add an `HF_TOKEN` repo secret (with SF3D licence accepted) if CPU inference in Actions should ever
   be attempted; otherwise all inference stays on the 3060.
2. `fetch-photos.yml`'s push trigger is pinned to branch `claude/photo-db-img-to-3d-8j9tbe`; keep
   only `workflow_dispatch` or repoint the branch.
3. ~~Accept the SF3D licence~~ / ~~Approve installing Blender~~ — **RESOLVED 2026-08-05**(§5c/§5e)。
4. ~~`ac_a` 要重生成還是改走 Route A?~~ — **RESOLVED 2026-08-10:等乾淨照片再重生成**(維持
   img→3D,配方不變);撤下改走 Route A 純資料 primitive 那一案**不採用,MUST NOT 自行復辟**。
   ⚠ 已知代價:磨圓機制(等值面外推 + quadric 各磨一次稜線)還在,而**箱體越小磨得越兇** ⇒ 這一顆
   對選片的要求比整棟量體那三顆更嚴。

---

## 7. Review board — 3D 零件對照台

使用者定案(2026-08-05):「在設定頁面另外建立…生成的 3D 物件與原版 3D 物件比較的工具,須說明使用
哪個生成方法與 img,操作比照生圖對照台」。`npm run parts`(埠 8622,經 `dev_supervisor.mjs TOOLS`
註冊 ⇒ 遊戲設定頁那一列由伺服器推導);`--report` 不開瀏覽器印配對表。

一列的內容、資料住哪、缺件/孤兒/未記載三個 0 的規則,全部住 `tools/ai3d/parts_src.mjs` 與
`provenance.mjs`(頁面只負責畫),**本檔不再複寫**。留三條會靜默壞掉的:

- **排序**:`libGeo` 是模組狀態 ⇒ 每一個「原版」MUST 在 `loadPartLibs()` **之前**建好並快取。
  弄錯的產物是**兩個一模一樣的 pane 和零錯誤訊息** —— 一個很有自信、而且錯的「AI 版跟原版很像」。
- **一個消費端一支 builder**(`beacon` → `buildBeacon`,`veg` → `buildVegMeshes`,`mega` → biomes
  自己那一串):巨岩那一支 MUST 是**合成**岩(具名 `MEGALITHS[].build` 不吃任何庫零件 ⇒ 兩邊會
  逐位元相同);未知 builder 現在**畫不出東西並記錄**,不是靜默。
- **取景是量出來的,不是從描述子推的**;`part` 只顯示**真的被換掉**的那些 mesh。
