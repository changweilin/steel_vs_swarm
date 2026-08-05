---
name: heightfield-terrain-integrity
description: Add hills, cuttings, embankments, water and tunnels to a world that already has flat built content, without the terrain coming up through roads, buildings or parked objects. Covers the third-surface pattern, measured keep-outs, slope limiting, path benching, water as contour vs water as hole, and the invariant checks that must be run rather than assumed. Use when adding relief/terrain/hills/lakes/tunnels to an existing level, or when ground is poking through built geometry.
license: MIT
compatibility: any engine with a separate terrain mesh and a scalar height query
---

# Height-Field Terrain Integrity

Adding relief to a world that was authored flat breaks it in ways that render fine.
Measured example before the rule below existed: **7 346 m² of walkable ground with the
displaced surface standing above the flat grid, 21 colliders sitting on it, worst case
1.68 m** — terrain coming up through roads, lanes, kerbs and the tyres of parked cars.

Method source: sakura-crossing `src/world/hills.js`, `landform.js`, `lakeform.js`.

---

## Rule 0 — every ground surface must share every displacement

If the world has more than one ground representation (a terrain grid **and** a distant
sphere/skirt/LOD mesh, say), **any displacement applied to one must be applied to the
other by the same amount**, or the one you forgot comes up through the one you didn't.

This is the single most expensive class of bug here. If you cannot guarantee both, do not
displace — use Rule 1 instead.

---

## Rule 1 — relief is a *third surface*, not a displacement

Do not modify the existing ground. Add a new field and a new mesh:

```js
// query:  the height everything stands on
world.heightAt(x, z)  =  flatGroundY(x, z) + hillAt(x, z)

// drawn:  the hill's own mesh, in the SAME relationship to the reference plane
//         that the flat grid already has
hillMeshY(x, z)       =  flatGroundY(x, z) + fieldAt(x, z) - GRID_DROP
```

`GRID_DROP` is however far the existing flat grid already sits below the plane props are
seated on. With it:

- where the field is **positive**, the hill mesh is above the grid and hides it;
- where it is **negative**, the hill is buried and the grid is what you see;
- the two meet along the contour `field = 0`, which is a **line, not an area**, so there
  is nothing to z-fight over.

An object on a hillside and an object on a pavement are then seated **by the same call,
with the same clearance**. Nothing in the existing ground modules changes.

**Add the field at the height-query seam, not inside a base profile that anything coarser
also samples.** If a distant LOD / sphere / skirt samples the same base function, its
larger facets chord across the fine lattice and poke through the hill mesh. The relief
belongs in `heightAt` / `groundAt`; the coarse surface never sees it.

---

## Rule 2 — one node function, read by both the mesh and the query

```js
nodeAt(i, j)   // the ONLY place a height is ever computed
```

Both the mesh builder and `hillAt` read it through the **same** two-triangle interpolation.
The surface you walk on and the surface you see are then identical to the bit.

Consequences worth knowing:

- Piecewise-linear over a lattice means the drawn surface is **genuinely faceted**, which
  a stylised renderer wants. Subdividing on the way to another projection does not soften
  it — the midpoint of an edge of a planar triangle is on the plane.
- **Roughness cannot be continuous noise sampled anywhere.** Anything evaluated *between*
  nodes breaks the agreement. Make a hash of the **lattice index** part of the node value.
- **Split cells on alternating diagonals — in the mesh AND the query.** One diagonal for
  every cell gives the whole hillside a diagonal grain that a depth-edge ink pass draws
  as parallel straight creases. It costs one bit; but the query must use the same rule
  as the mesh or they stop being the same surface.
- **A per-facet tone keys off the facet's own plane gradient** (`hypot(dh/dx, dh/dz)` from
  the triangle's plane), not off the biggest drop across its edges — on a uniform ramp
  the diagonal edge falls 2× either side and misclassifies the whole toe.
- **Tones that are a boundary the eye reads as a line** (a waterline, a plantation floor)
  are decided **once per cell at the cell centre**. Per-triangle jitter on such a
  boundary produces a zip of alternating triangles.
- **Refining the lattice: halve only, and add a roughness octave at the new size.**
  Halving the cell on its own buys smaller flat cards — the normal turn per facet is set
  by roughness wavelength against cell size, so it *halves*. Add an octave whose radius
  matches the new facet size, and halve any node-jitter amplitude with the cell (jitter
  has no length scale of its own; unhalved it becomes per-node fizz). Halve-only matters
  because everything that samples the lattice at fixed stations (cap edges, corridors)
  stays on nodes only if the old spacing is a multiple of the new.

---

## Rule 3 — keep-outs, measured and then verified

Maintain a list of rectangles where the field must be exactly 0, plus corridors along any
linear structure that must stay flat.

- **Measure them off the live collider list, not from memory.**
- **Bound corridors by the same constants the structure uses**, so they cannot drift apart
  when the structure is shortened.
- A corridor may be closed locally (at a tunnel's longitude, say) — that is what lets
  relief cross a linear structure.

**Then check it rather than believing it:**

```js
terrainSafety(world)   // sample every collider and platform inside a keep-out;
                       // report the worst height found. MUST read 0.00
```

Reference result: `0.00` over 13 263 samples across 1 435 colliders; worst 0.267 m at
three metres *outside* a keep-out, which is the mask doing nothing much rather than the
mask shaping a slope. Run it after adding a summit, moving a keep-out, or building
anything within ~20 m of relief.

---

## Rule 4 — slope limiting

Relax the lattice repeatedly, **lowering only**, any node standing more than
`maxSlope · CELL` above a neighbour.

- Lowering only means keep-outs and buried aprons survive the pass.
- Use **different limits per corridor**: a railway cutting is steep on purpose (~1.9);
  open hillside is not (~0.52).
- **The limiter must run before the roughness**, or it flattens the very thing the
  roughness exists for.
- A limiter pinned along a **straight** line produces a perfectly uniform ramp with no
  oblique route up it. If players must climb it, break the pin.

---

## Rule 5 — paths are a surface treatment, not platforms

An axis-aligned platform box cannot express a slope, so **register nothing** on the relief:
what carries the player is the height field itself. Sweep a ribbon of geometry that follows
the field.

**Bench every path**: cut and fill it into the slope it crosses. A path that inherits the
cross-slope of the face it is painted on is not a path on a 1-in-2 bank — the walker
(which has no slope limit) climbs it happily, the connectivity fill refuses every step,
and nobody notices for rounds. **Cut alone is not enough**: it takes the uphill shoulder
off and leaves every hollow, and what stops a walker-rules fill is climbing *out* of a
hollow. The **fill half must be refused inside any keep-out** — raising ground there takes
the safety check off 0.00.

**A diagonal flight cannot be faked with axis-aligned platforms** — five overlapping AABBs
maxed together are the same ramp shifted up-slope. Run flights along an axis or grade the
ground under them (see `walkable-level-verification`).

Have the path sweeper **return the measured gradient of every leg**, and place steps where
that says — not where a hand-written list says. A leg over ~0.28 must look like a stair or
the path reads as unmaintained.

**A road needs a designed longitudinal profile; a footpath must not have one.** Give route
vertices an optional target height: where present the bench cuts and fills to it (a lane
whose natural line is flat for 18 m then climbs 3.1 m in 12 needs this); where absent the
profile is sampled (a stepped hill path should follow the ground, and any profile gentle
enough to feel graded implies a seven-metre cutting). Sampled routes want vertices 4–6 m
apart — the bench interpolates *between* them, and two distant samples fill new hillside.

---

## Rule 6 — water: above the datum is a contour, below it is a hole

Choose by **size**, not by what the water is:

| | Channel / trench | Lake / reservoir |
|---|---|---|
| Mechanism | **a hole**: faces removed from every ground surface, sealed by its own structure, plus a height-query cut | **a contour**: a flat surface at `groundY + LEVEL − GRID_DROP`, hidden wherever the ground is higher |
| Cost | three cooperating layers and a cut edge to seal all the way round | nothing — same trick as Rule 1 |
| Verdict | fine for 5 m, absurd for 110 m | free shoreline irregularity, depth available as `LEVEL − field` |

The contour form means **no existing module has to change**, and the shoreline is a contour
of the terrain so it is irregular for nothing. The price is that the water is perched —
which is exactly what a reservoir is. If it must be a lowland lake, you need the hole.

**Widening a hole past the structure that seals it gives a view straight through the world.**

**Survey before you build:** export a `naturalAt(x, z)` giving what the terrain would do
*before* the water feature is folded in. Once the dam/embankment is in the lattice there is
no way to ask "where was the valley mouth" any more. Every dam and channel coordinate
should be read off that survey, not drawn by hand.

**Derive the rim from the shoreline, never build it from summits.** A continuous rim made
of scattered bumps needs dozens of them and any later change to any one drains the lake —
a bump is at ~56% of its height half a radius out. Making the rim a function of the
shoreline (within crest distance of the water, ground = `LEVEL + bank·s`) makes
containment **structural** rather than hoped for.

**A body of water fails globally, and nothing renders the failure.** The surface finds the
lowest point on the whole rim; a 0.3 m notch anywhere drains the basin without changing a
pixel. The only meaningful test is a **leak flood fill** — fill `field < LEVEL` from a
seed in the basin and assert it stops at the shore. Per-point freeboard sampling passes
while a gully twenty metres out drains the lot. (Measured on a first rim attempt: 20 of 32
shore stretches had ground below water level within 2 m — not a leak, no lake at all.)

**A fill term whose baseline is not zero cannot be multiplied by a keep-out mask.**
Ordinary summits fade to zero under the mask and that is correct; a rim or embankment is a
height *above the water level*, so masking it toward zero digs it under the water — a
spillway at exactly the masked spot. Fade toward the field's floor instead:
`FLOOR + (v − FLOOR) · keep`.

**Depth-derived dressing works in field units, not ground distance.** A drawdown margin
defined as "0.85 m of field below LEVEL" is `fall ÷ slope` wide on the ground — eight
metres on the reed flat, none on the steep revetment — which is physically right and free.

---

## Rule 7 — tunnels and cuttings

- A height field **cannot have a hole in it**. A bore is a separate structure plus a
  removal of the surface over its mouth; the field above it stays the un-excavated mountain.
  You cannot make a height field vertical either, so there is no way to express a portal
  face in it: cut a **lattice-aligned notch** out of the field and fill it with an
  authored cap + portals + lining.
- **The cap must *continue* the terrain, not stand on it.** Blending a cap from its crest
  out to the terrain at only two edges leaves a full-height lens open at the portal planes
  — a dam, not a portal. A bilinear **Coons patch from all four boundary curves**
  interpolates every edge exactly, so at the portal planes the cap *is* the hillside's own
  edge.
- **The cap's sample stations must be lattice nodes.** The cap samples the field along its
  notch edges and chords in between, so the two surfaces meet only where its stations land
  on nodes. Derive station counts from `CELL`, never from `round(length / k)` — measured
  1.69 m of open sky along one edge when they disagreed. Then **measure the worst gap
  along every cap edge and assert 0.0000**.
- **A portal wall splits at the coping line** — concrete below, the hillside's own surface
  above, with the coping between; running the concrete up to the cap's edge produces a
  tent no portal has ever had. And size the coping to where the wall actually *reaches*
  that line, sampled finely — quantised to the wall's own station spacing it overhangs
  like a diving board.
- **Hold an extruded shape's holes clear of its outer contour by a real margin** (~0.5 m).
  A hole touching the contour makes the triangulator fill it — a wedge of concrete across
  the mouth, nearly invisible from outside, half the frame from inside.
- Anything that asks "am I under the terrain" must therefore be **suspended inside a bore**
  (line-of-sight, slope gates, projectile blocking). Ceiling and floor are the bore's, not
  the field's. Same for builders seating props **on a cap**: the field query answers with
  the flat grade inside a notch (correctly — it was cut out), so rock/tuft placers need an
  optional `yAt` override or they seat everything fifteen metres under the cap.
- **Engineered faces are the one ground with nothing on them.** A vegetation sampler that
  refuses ground steeper than ~0.9 leaves every cutting bank bare — measured at 45% and 60%
  of two viewpoints' frames. Scattering more scrub is not the answer; the face has no scale
  and no evidence of anyone on it. A grid of shallow beams with growth in the cells supplies
  both, and is what a real cutting has. Four rules make the grid read as engineering:
  - **March rows by arc length along the slope from the toe**, so the grid does not
    stretch as the bank deepens and simply stops where the bank dies.
  - **Divide a member's plan half-width by `hypot(1, grade·normal)`** so it is constant
    width *on the ground* whichever way it runs.
  - **Seek forward for ground that is actually steep** before laying anything — a face
    treatment started at the caller's nominal toe breaks out the moment the local gradient
    dips below threshold, and 26 triangles of crib is indistinguishable from the feature
    not existing.
  - **Anything that covers a measured area must be told what is already standing in it**
    — a viewpoint platform sits on the crest of the very face being treated; the module
    that placed it is the only thing that knows, so it hands back its footprint and the
    treatment runs after it. And derive quad winding from a reference point via cross
    product (a helper), never by hand — a hand-written winding for a surface with four
    orientations faced every cell into the hillside, single-sided, rendering as bare
    earth showing between the beams.
- **Check the section numerically against whatever must pass through it.** An arch written
  from its radius instead of its springing put the crown 2.75 m out and ran a vehicle
  through solid rock — invisible for the structure's whole life. Write a
  `clearance()` function; it is the only thing that would ever have found it. Same for a
  face treatment: report the worst height the terrain reaches above the laid cells,
  against the lift.

---

## Invariant checklist

Run all of these after any terrain change; none is optional and none is visible in a render.

| Check | Pass condition |
|---|---|
| `terrainSafety(world)` | 0.00 over every collider/platform inside a keep-out |
| Slope limiter | no node above `maxSlope · CELL` over a neighbour, per corridor |
| Both ground surfaces | any displacement applied to one applied to the other |
| Section clearance | measured against the largest thing that must pass |
| Face-treatment clearance | worst terrain height above laid cells < lift |
| Cap-edge agreement | worst gap between cap and field along every notch edge = 0.0000 |
| Water containment | leak flood fill from a basin seed stops at the shore |
| Connectivity flood fill | all waypoints reachable (see `walkable-level-verification`) |
| Bench effectiveness | worst axial rise on every route within the fill's step limit |
| Tone distribution | no ground tone above ~⅓ of drawn area (see `procedural-object-detail`) |
| Determinism | same seed ⇒ bit-identical lattice; scatter windows appended, never widened |

Re-derive published figures (areas, summit heights, cell counts) after any lattice or
octave change rather than comparing — a finer lattice samples a different set of points
and every derived number legitimately moves.
