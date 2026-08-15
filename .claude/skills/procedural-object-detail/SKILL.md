---
name: procedural-object-detail
description: Generate lifelike, non-repeating 3D object detail and readable silhouettes — deterministic seeding, parametric generators, fitted vs loose cloth, leaf-card canopies, moss/grass/wet encrustation on rock, scatter attribute fields, threshold jitter, semantic placement. Use when repeated objects look too uniform, a canopy reads as a blob or a lampshade, clothing reads as painted-on, rock reads as one flat colour, or scatter/weathering/wear is requested.
license: MIT
compatibility: Three.js or any procedural 3D scene
---

# Procedural Object Detail

**Rule: every variation must be derivable from a reason. RNG volume is not a reason.**
Dice are the last implementation step, not the design.

Method sources: sakura-crossing `src/world/{hills,buildings,details,trees,props}.js`;
`messenger.abeto.co` leaf-card canopy shader, terrain triplanar masks, character shader.

> Related: `anime-line-control` (what the line pass does to a dense mass),
> `generator-table-catalog` (how a family of built objects is described),
> `ambient-motion-layers` (how any of this moves).

---

## Diagnose before adding anything

When a region "looks fake / flat", **measure first**:

1. Sample the frame and compute **per-material / per-tone area share**. Any single tone
   over ~35% is the defect.
2. Identify the **physical cause** of uniformity (one aspect, one slope, one height,
   all facets in the same light band).
3. Pick a variation axis **orthogonal to that cause**. Light can't separate it → use
   material value. Value can't → use hue. Shape can't → use a cover attribute.

Scattering more objects is almost never the fix. An empty face is not the problem;
a face with **no scale reference and no evidence of use** is.

---

## L0 — Deterministic RNG

```js
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function rngKit(seed) {
  const r = mulberry32(seed);
  return { next: r,
    range:  (a, b) => a + (b - a) * r(),
    int:    (a, b) => Math.floor(a + (b - a + 1) * r()),
    pick:   (arr)  => arr[Math.floor(r() * arr.length) % arr.length],
    chance: (p)    => r() < p,
    sign:   ()     => (r() < 0.5 ? -1 : 1) };
}
```

| Rule | Failure if broken |
|---|---|
| No `Math.random()` in any scene-generation path | Clients / reloads diverge |
| Fixed RNG draws per candidate; **reject-tests run after sampling** | "Skip sampling when rejected" desyncs the whole stream |
| Seeds are **stable IDs in data tables** (per house/tree/pole), not a global counter | Inserting one object reshuffles every later one |
| Removing a random call from a generator leaves a **burnt draw** (`rng.next()` with a comment) | Everything after it in the stream moves — the whole object repaints for an unrelated edit |
| Palette/roster arrays are **appended, never reordered** | Every index in the world shifts; half the scene repaints |

**Extending a scatter window: append a second RNG, never widen the first.**

```js
const FIELD = (() => {
  const rng = rngKit(778213);
  const out = [];
  for (let k = 0; k < 170; k++) out.push(blob(rng));
  const rngE = rngKit(884117);           // east extension; first 170 stay bit-identical
  for (let k = 0; k < 60; k++) out.push(blob(rngE));
  return out;
})();
```

Widening redraws the whole stream — every tree moves, some into a walkable route,
and only a connectivity flood fill finds that.

---

## L1 — Parametric generators

**A kind is a table row, not a function.**

```js
const SPEC = {
  kei: { L: 3.40, W: 1.48, R: 0.28, axle: [-1.15, 1.15], sill: 0.34, waist: 0.92,
         roof: 1.72, cab: [-0.9, 0.6], rakeF: 0.42, rakeR: 0.30, side: [-0.8, 0.5] },
};
// arches, bumpers, lamps, plates, seams, mirrors all derived from those numbers
```

Bug class this prevents: two hand-placed copies of the same assembly, neither joined up.

### Choose what varies — and what must not

| Family | Varies | **Fixed on purpose** |
|---|---|---|
| Detached house | roof kind (weighted pick), wall/roof index, floors, bay count (derived from width) | eave depth, floor height |
| Terrace / row house | **door colour, clutter, one shutter down** | wall, roof, window — varying walls stops it being a terrace |
| Same-model vehicle/mech | livery, wear, loadout, micro-jitter | silhouette |
| Vegetation | size, yaw, lean, detail seed | joint relationships |

Wrong axis is worse than no variation: recolouring each unit of a terrace yields
a row of separate huts, not a varied terrace.

### Build assemblies from joints, not positions

```js
const J = { BB: [...], HB: [...], SC: [...], HT: [...] };
strut(g, mat, J.BB, J.HB);    // length and rake derived from the two endpoints
```

Applies to anything with **two or more connected members**. Hand-placed centres+angles
fail silently and only show after a rotation.

### Depth is built outward — you cannot carve a recess into a box

The single most repeated silent failure family. A panel written *behind* a solid face is
simply inside the render: lattice screens at `front − 0.04` (five frontages, none drawn),
windscreens laid along a body wedge's centreline (every car with a body-coloured screen),
brake levers written at the cowl's own half-width (inside it), a map tilted about its own
centre "for depth" (bottom edge swings behind the posts it bolts to).

- Fake depth by stacking **outward**: backing board `+0.04`, battens `+0.12`, sill/posts
  `+0.08` (deeper than the board, shallower than the battens, so they frame it).
- Where a real cavity is required (an opening that must admit or emit an object), the
  volume itself must be cut back — returns either side, a header over — or notched out of
  multiple boxes merged into one mesh.
- A pane over a raked panel is offset along the panel's **outward normal**, and which
  normal is outward is *derived* (points away from the interior centre), not assumed.
- A tilt is for a hood — a hood overhangs nothing.

### Orientation is derived, never guessed

Author every generator facing **one convention axis** and rotate the group by `face` —
branching on axis inside each measurement is how stairs climb away from their treads.
Then:

| Case | Derivation |
|---|---|
| Wall-mounted prop (fan unit, plate, poster) | `ry = atan2(nx, nz)` of the wall's **outward normal**; the back face must touch the wall (draw bracket arms across any stand-off) |
| Pavement clutter outside a frontage | Faces the way the shop does — placed in world space but authored facing the convention axis, so a unit looking −x needs `ry = −π/2` on everything stood outside it |
| A bench / seat pair | `ry` is a function of **which side of the space it stands on** — one constant for a pair is guaranteed wrong for one of them ("two benches facing the view" both faced away) |
| Bay markings / wheel stops | Nose in from a convention end; a bay entered from the other end needs `ry = π` on **both** |
| Rotated part's tip position | Apply the rotation to the offset (`applyEuler`), never hand-derive the trig — a part rotates about its **centre**, and hand-derived sin/cos put every limb 0.4 m off at 90° to the lean |
| Cylinders along the ground | `CylinderGeometry`'s axis is +y; a rail along z needs `rx = π/2` or it is a column standing through the roof |
| In-unit offsets (`doorAt` etc.) | Are in the **unit's frame**; on a rotated frontage a positive offset moves the other way in world space |
| Ride-on / close-use props | A prop authored to be read from outside **has no inside** — render from the new viewpoint before making anything enterable; the fault will be an absence, not a bug |

### Micro-jitter: only degrees of freedom that cannot break joints

```js
jr   = 1 + hash01(partId, dj) * amp;              // horizontal radius, INCREASE ONLY
spin = (hash01(partId ^ K, dj) - 0.5) * Math.PI * 2;  // spin about own extrusion axis
```

- **Increase only.** Shrinking opens joints that were "just touching" → FLOAT/DETACHED.
- **Spin only for axis-centred parts** (`px === 0 && pz === 0`). Offset parts seat via
  specific-facing vertices; spinning detaches them.
- **Never jitter `y` / `px` / `pz` / longitudinal scale** — those open stacked seams.
- Use an integer hash (not `Math.sin`) for cross-engine bit-identity.

---

## L1b — The three silhouette families

Most "it looks fake" reports are about **outline**, not surface. Three families cover
nearly all of them, and each is built by a different mechanism.

### A. Cloth — fitted and loose are two constructions, not one with a parameter

| | Fitted (shirt, trousers, gloves, uniform) | Loose (skirt, coat, cape, noren, banner, flag) |
|---|---|---|
| Silhouette belongs to | the **body** | the **garment** |
| Built as | skin weights on the body mesh, offset outward ~1–2 cm | its own geometry with its own root |
| Motion | none of its own — it is the body | secondary, driven after the pose |
| Gets | a **hem line** where it ends, and a cuff/collar/waist that reads at 20 m | a pivot at the **mount** and free travel at the **hem** |
| Fails as | a painted-on texture, because nothing breaks the body's outline | a rigid board, or a flag rotating about its own centre |

Rules that hold for both:

- **A garment reads by its terminations.** Cuff, collar, hem, waist, opening. At the
  distance these are seen, the cut of a sleeve is invisible and the *edge* of the sleeve is
  the whole silhouette. Give a fitted garment 2–3 real edges before you give it a fold.
- **Loose cloth pivots at its mount, never at its centre.** A noren hung off the eaves and
  rotated about its own centre swings its top edge through the lintel it hangs from. Put a
  pivot group at the hanging bar and animate that; the mesh sits at identity under it.
- **In a baked/folded scene graph, an animated pivot needs an explicit rigid marker.** A
  bake that folds geometry into world space clears container transforms, so
  `rotation.x = flutter` afterwards swings root-space geometry about the world origin.
  Marked groups are re-seated with the rig intact and an inner pivot left at identity.
- **Waveform: slow lift + small flutter**, not one sine —
  `sin(t·r + φ)·0.75 + sin(t·r·3.3 + φ)·0.25`, with `rate` and `phase` varied per piece.
  Eight pieces on one rate is a mechanism; eight on eight rates is wind.
- **Local wetness / mud / dust is a value ramp against a jagged waterline**, keyed on the
  garment's *local* Y so it travels with the body:

  ```glsl
  float line = uWetHeight + (sin(lPos.x * 30.0) - 1.0) * 0.012;   // jag the boundary
  vec3 wet = rgb2hsv(outgoingLight); wet.b = max(wet.b - 0.1, wet.b * 0.75);
  outgoingLight = mix(outgoingLight, hsv2rgb(wet), step(lPos.y, line));
  ```

  A straight boundary reads as a rendering bug. One sine across the body fixes it.

### B. Canopies — cards that face the camera and radiate from the cluster centre

A canopy is the hardest silhouette in an outlined scene: leaf geometry inks into porridge,
and a blob mass inks into a pile of polyhedra. Two constructions work.

**B1. Camera-facing leaf cards, screen-space radial (best-looking, needs a shader).**
Each card is a quad at a cluster centre `centr`, with the tree's own centre `centr_tree`
also on the attribute. In the vertex shader, project **both** and rotate the card in
**screen space** so it points away from the tree centre:

```glsl
vec2 quad2D = (proj * mv * vec4(centr,      1.0)).xy / w * aspect;
vec2 bush2D = (proj * mv * vec4(centr_tree, 1.0)).xy / w * aspect;
rot = rotateZ(atan(dir.y, dir.x) - PI2 * 0.25);   // dir = normalize(quad2D - bush2D)
pos = centr + right * p.x + up * p.y + back * p.z;
```

The cards therefore fan outward on screen from **every** viewing angle, which is what gives
a canopy its ragged edge instead of a circular one. Mix in a non-radial `detail` class
(plain randomly-rotated cards) for the interior mass; only the outer shell needs radial.

Three things that come free and must not be skipped:

- **UV mirroring per card** (`mix(uv, vec2(1.0-uv.x, uv.y), step(0.5, rand.x))`) — halves
  the visible repetition for zero cost.
- **Per-card scale from `rand`** (`mix(0.5, 1.0, rand.w)`) — a uniform card size reads as
  a stipple pattern.
- **Every card writes the *tree's* depth**, not its own, so the line pass sees one mass.
  See `anime-line-control` L4.

**B2. Faceted blob mass in three tones (no shader, works with any material system).**
Clusters of low-poly blobs in three values of one hue read as painted blossom or foliage
far better than leaf geometry. Constraints, all measured:

- **Unit size must be small enough that the eye reads the mass, not the unit.** A 4 m
  canopy filled with 40 units of `0.5·S` reads as six floating lozenges; the same volume
  needs ~120 units of ~0.3 m.
- Three tones, one hue. Two reads flat; four reads as noise.
- The canopy **must not `receiveShadow`** — quantised light shapes direct light only, so a
  self-shadowed blob drops to ambient and hangs in the sky as a dark circle. It still casts.
- A **dense hedge or bush mass needs a solid dark core box**, with blobs seated only on the
  top and outer faces.

**Conifer whorls are a third case:** one circular cone per tier is a stack of lampshades.
Per-tier ellipse 0.84–1.18 plus 2–3° of tilt breaks every rim out of the horizontal and
costs nothing in the instance matrix.

### C. Encrusted surfaces — moss, grass, wet, lichen on rock

The whole family is **one primary surface with masks derived from cheap fields**, never
scattered geometry. Scattering moss meshes over a hillside costs draw calls and still
reads as litter.

```glsl
vec4 n = triplanar(tNoise, worldNormal, worldPos * 0.4, 1.0);   // seamless on any face

// grass takes hold where the face is flat-ish AND the noise allows it
float grassMask = step(0.15, max(0.0, -n.r * 1.5 + dot(worldNormal, up))
                            - n.g * 0.35 + 0.1 - n.b * 0.05);
// wet takes hold low down
float wetMask   = 1.0 - step(0.334, height * 0.015 + n.g * 0.006);

// rock striations: a low-frequency sine of position folded into a noise lookup,
// thresholded — bedding planes, not marble
float s = sin(height*0.1 + dot(localNormal, vec3(0.5)) + dot(worldPos, vec3(2.0)));
float striations = step(0.47, texture(tNoise, vec2(s*0.01, height*0.07 - s*0.02)).g
                             + n.r*0.2 + n.g*0.05);
```

Four rules:

1. **Every mask is a `step`, not a blend.** Cel shading quantises light; a smoothly blended
   material boundary is the one soft edge in the frame and it looks like a mistake. Hard
   masks with a noise-jittered threshold is the whole technique.
2. **Fold the mask into `surfaceId`** so the boundary draws a line
   (`surfaceId += grassMask * 0.1`). Otherwise grass on rock is two flat colours meeting
   with nothing between them. See `anime-line-control` L2.
3. **A mask must combine at least two orthogonal terms.** `dot(normal, up)` alone gives a
   perfect contour; noise alone gives a random spatter; together they give a shelf of grass
   on the ledges with a ragged edge — which is what it actually looks like.
4. **The noise must be triplanar**, sampled on world position, or every vertical face gets
   the texture smeared down it and the seam between projections is visible on every rock.

**Break the line on encrusted surfaces too**: `outlineContribution *= step(0.3, n.r)` —
a rock whose every crease is inked is a technical drawing.

---

## L2 — Attribute fields

Use **scattered ellipse fields**, not Perlin/Simplex.

```js
const FIELD = (() => {
  const rng = rngKit(SEED);
  const out = [];
  for (let k = 0; k < N; k++) {
    const r = rng.range(RMIN, RMAX);
    out.push({ x: rng.range(X0, X1), z: rng.range(Z0, Z1),
               rx: r * rng.range(0.7, 1.45), rz: r * rng.range(0.7, 1.45),
               h: rng.range(HMIN, HMAX) * (rng.chance(0.5) ? -1 : 1) });  // half negative
  }
  return out;
})();
// index each blob into a spatial hash grid covering its bounds
```

**Never sine.** `sin(ax+bz)·cos(cz−dx)` is a plane wave: it has a direction, so all
ridges run parallel on one bearing and the ink pass draws them as straight lines.

### Composition law depends on the field's semantics

| Semantics | Law | Why |
|---|---|---|
| **Displacement** (height, relief) | `sum`, then clamp | Displacements add |
| **Attribute** (cover, moisture, wear, rust) | **`sum / max(FLOOR, weight)`** | Sum saturates |

```js
export function coverAt(x, z) {
  const a = GRID.get(key(x, z)); if (!a) return 0;
  let s = 0, w = 0;
  for (const b of a) {
    const dx = (x - b.x) / b.rx, dz = (z - b.z) / b.rz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= 1) continue;
    const g = (1 - d2) * (1 - d2);
    s += b.h * g; w += g;
  }
  return w > 0 ? s / Math.max(0.55, w) : 0;   // floor lets it fade out, not step, at edges
}
```

Measured failure of the sum form: blobs cover the window ~2×, so the sum exceeds ±1
nearly everywhere and the clamp flattens it — p75 and p95 both exactly 1.00.
A constant is worse than nothing: it doesn't vary **and** it shifts every threshold.

**Do not derive the attribute field from terrain.** Anything keyed on slope/height is
constant over a uniform slope — which is the problem, not the fix. Same for wear: rust
must not be purely a function of height, nor damage purely a function of blast distance.

**Scale:** size patches so a typical view holds 4–5 of them. Measured: 460 blobs at
r 9–26 average to 40–60 m patches — a 40 m slope holds 1.5 of them, giving two flat
areas instead of one. 1100 blobs at r 6–17 give 15–25 m patches; same slope holds 4–5.

---

## L3 — Threshold jitter

Every "if value > X switch material" boundary must be displaced by the cell's own hash,
or it reads as a contour line.

```js
if (slope > 0.88 + tj * 0.22 - cover * 0.10) return TONE_BARE;
if (lit > 0.08 && cover + (h - 6.0) * 0.02 > 0.42 + tj * 0.30) return TONE_DRY;
```

**Match jitter granularity to the job:**

- `hash` — per cell, handed to the cell's two triangles with **opposite signs**.
  Correct for breaking up a lozenge pattern. Wrong for anything that changes hue:
  a cell sitting on the threshold becomes one tan triangle beside one green one,
  and a 4.5 m² colour patch reads as a fault, not a scar.
- `tj` — **one level coarser** (hash of `i>>1, j>>1`, mixed 80/20 with the fine hash).
  Use for hue/tone boundaries.

**Target distribution: no tone above one third.** Measured after fix: 8/10/27/24/31%
(before: 57/36/7).

---

## L4 — Semantic placement

Deliberately **small**: a few legible objects, each where the eye already goes, beats
a hundred scattered ones.

- **Counts carry meaning.** Three birds: two reads as a pair, four as a flock.
- **Scatter is a rejection chain, not a density.** Roll N times, pass 5–6 filters
  (field height, water, slope, distance to path, distance to nodes, inside plantation),
  then a zone-biased chance — biased **toward** the sparse belt the player actually sees.
- **Secondary attributes query the primary field.** Moss only where `coverAt < -0.1`,
  so it reads as ground rather than as a stain.
- **Wear is a tone change, not grime.** Road patches: 0.012 m slabs, `noOutline`.
  Tyre marks: opacity 0.09, `depthWrite: false`.
- **Scale anchor.** Place one vertical object of known size. A row of cones is a saw;
  a row of blobs is a scallop; vertical is the only thing the eye can compare slope against.
- **A plantation is not a scatter.** A second species built as a *stand* — a rotated
  rectangle with a hard edge, a regular grid inside, nothing else inside it, its own
  ground tone under it — is what gives a slope its scale and a ridge its saw edge. And a
  block of tall anything defeats keep-out **discs** sized for scatter: what holds a sight
  line open through a block is a **corridor**, not a bigger radius (a sector from a point
  is arbitrarily narrow at its apex — one tree at the apex is the whole view).
- **One moving thing.** A few cloth/flag pieces on different `rate`/`phase`;
  waveform `sin(t·r+φ)·0.75 + sin(t·r·3.3+φ)·0.25` (slow lift + small flutter).
- **Pre-warm ambient particle systems** (petals, leaves, rain) by stepping the update
  ~40 × 0.1 s at build — the first frame should already have them mid-air. Bias fallen
  ones toward edges and walls (that is where wind actually leaves them); wrap drifting
  ones relative to the *feature's centreline*, not world axes.

### Distribution is a single auditable table

When placing many of one expensive thing (vehicles, hero props), put **every placement in
one file, one row each, with a `note` saying why it is there** — a distribution cannot be
reviewed 30 lines at a time across 22 modules, and half the placements are one metre from
something that would make them wrong; the note is what stops the next round moving them.
Measured composition rules that generalise:

- Cap the on-road count hard (18 total / 8 on carriageways read as a town; 36/20 read as
  a car park with houses).
- **Fill the marked parking the districts already drew first** — an empty bay beside one
  parked vehicle does more work than a second vehicle in it. Kerbside is seasoning.
- Never let two face each other across a road (the eye reads the gap as impassable), and
  keep drive-side orientation consistent — it costs nothing and is most of why a parked
  row reads as a street.
- Some places have none *because nothing can drive there* — record that reason too.
- Run a **pairwise overlap audit over the table itself** in dev (rotated AABBs), and keep
  a **flood-fill checkpoint list in the file header** for every passage the table could
  seal (see `walkable-level-verification`).

### Frontage dressing wants a frame and a slot allocator

Dress plots in the plot's own frame: `at(u, v)` with `u` along the frontage and `v`
outward, plus derived `outRy` (against-wall) and `flankRy(side)`. Then allocate frontage
positions through one `take(halfWidth, preferred)` that walks outward in 0.3 m steps over
a `used[]` interval list — **with the doorway reserved before any prop is placed** —
and skip props that do not fit rather than pushing them into the road. Every placed thing
seats on the *dressed* ground query, never the raw profile. The one prop that bypassed
the allocator in the reference project is the one that ended up buried in a front step.

---

## Reads-as table

| Construction | Actually reads as |
|---|---|
| One blob generator rescaled as a second species | Field of identical bubbles |
| A hedge/mass as instanced blobs only | A row of separate dark polyhedra — an edge/ink pass fires on every blob's own silhouette. Needs a solid core with blobs on top and outer faces only |
| Blob unit too large (4 m canopy from 40 × 0.5 m units) | A few floating lozenges. Unit must be small enough that the eye reads the mass: ~0.3 m ⇒ 120 units |
| Cone radius < 0.04 m | Dark skewer (one facet wide, near-black when turned from sun) |
| Cone radius > 0.05 m | Tent peg |
| Conifer whorl as one circular cone per tier | Stack of lampshades. Use per-tier ellipse 0.84–1.18 + 2–3° tilt |
| 150 water panels at 2.2–7.0 × 0.22–0.6 m | Road lane markings. Use 96 at 0.5–1.5 m |
| Dark prop under 0.3 m | A dot. Needs 1–2 silhouette-carrying features or omit it |
| Translucent card as netting | Unidentified coloured rectangle. Use a genuinely holed texture on an open box |
| Long wall ending mid-frame | A grey card standing on the ground. Terminate runs in a pier |
| Two vehicles at opposite kerbs | An impassable slot (composition bug, not collision) |

---

## Verification

1. **Quantify distribution** and write the numbers into the source comment as the
   regression baseline. Cheapest available regression detector.
2. **Three-view screenshots** (front / side / top) for any assembly. Single view misses joints.
3. **Offline joint audit** running the same part×instance transform seam the renderer uses;
   classify FLOAT / PARTIAL / DETACHED / ISOLATED as hard failures; exemptions carry reasons.
4. **Reverse-verify any changed predicate**: rewrite it to the broken version and confirm
   the audit goes red. Otherwise nothing was verified.
5. **Re-run connectivity checks after changing any scatter seed or window** — moved objects
   can block routes and nothing else finds it.

---

## Reference implementations

Both shipped projects below implement what this skill describes. `WebFetch` gets 403 on
both sites — use `curl` / `gh`.

**sakura-crossing** — cel-shaded Japanese neighbourhood on a small planet; Three.js,
vanilla ES modules, no image assets. One squashed commit, so the tree *is* the history.

```bash
git clone --depth 1 https://github.com/Kenton-GMI/sakura-crossing.git /c/tmp/sk
#                                                                    ↑ short path: a deep
#   temp dir fails on Windows with "cannot write keep file … Filename too long"
```

**messenger.abeto.co** — small-planet delivery game; the shipped bundle carries its GLSL
verbatim in template literals.

```bash
curl -sSL --ssl-no-revoke https://messenger.abeto.co/ -o msg.html   # read the App3D-<hash>.js name
curl -sSL --ssl-no-revoke https://messenger.abeto.co/assets/App3D-<hash>.js -o App3D.js
# extract every template literal containing `void main` — 220 blocks, ~80 of which declare
# `u*` uniforms and are the app's own. Identify a block by its uniform list.
```

**Read for this skill:**

| What | Where |
|---|---|
| Leaf cards, screen-space radial rotation, per-card UV mirroring and scale, wind, player displacement | messenger — the block with `uLeavesShake, uShakeSpeed, uScale` and attributes `centr, centr_tree, rand, detail, leavescolor` |
| Terrain masks: grass / wet / striations from triplanar noise, folded into `surfaceId` | messenger — the `IS_TERRAIN` branch of the block with `uSkinColor, uShowChars, uWetHeight …` |
| Local wetness with a jagged waterline on a character | same block, the `vIsLocal == 1` branch |
| Blob-mass canopies in three tones; the trunk-tip rotation derivation | sakura — `src/world/trees.js` (read the long comment about `applyEuler`) |
| Attribute fields, cover field, threshold jitter, plantation stands, benching | sakura — `src/world/hills.js` |
| Seeded RNG kit and the burnt-draw discipline | sakura — `src/core/util.js`, `rngKit` |
| Cloth hangs: pivot at the mount, `sin + 0.25·sin(3.3ω)`, per-piece rate/phase | sakura — `src/world/details.js`, the `hang(...)` block |
| The "reads-as" failures in this skill, each with the frame it was reported from | sakura — `CLAUDE.md` trap table (reeds, crows, willow fronds, conifer whorls, water panels) |
