---
name: procedural-object-detail
description: Generate lifelike, non-repeating 3D object detail — deterministic seeding, parametric generators, scatter attribute fields, threshold jitter, semantic placement. Use when repeated objects look too uniform, terrain reads as one flat colour, vegetation/buildings need variation, scatter/weathering/wear is requested, or a region "reads as flat".
license: MIT
compatibility: Three.js or any procedural 3D scene
---

# Procedural Object Detail

**Rule: every variation must be derivable from a reason. RNG volume is not a reason.**
Dice are the last implementation step, not the design.

Method source: sakura-crossing (`C:/Users/user/Documents/study/sakura-crossing`),
files `src/world/hills.js`, `src/world/buildings.js`, `src/world/details.js`.

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
- **One moving thing.** A few cloth/flag pieces on different `rate`/`phase`;
  waveform `sin(t·r+φ)·0.75 + sin(t·r·3.3+φ)·0.25` (slow lift + small flutter).

---

## Reads-as table

| Construction | Actually reads as |
|---|---|
| One blob generator rescaled as a second species | Field of identical bubbles |
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
