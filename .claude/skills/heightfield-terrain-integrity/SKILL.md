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
cross-slope of the face it is painted on is not a path on a 1-in-2 bank.

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

---

## Rule 7 — tunnels and cuttings

- A height field **cannot have a hole in it**. A bore is a separate structure plus a
  removal of the surface over its mouth; the field above it stays the un-excavated mountain.
- Anything that asks "am I under the terrain" must therefore be **suspended inside a bore**
  (line-of-sight, slope gates, projectile blocking). Ceiling and floor are the bore's, not
  the field's.
- **Engineered faces are the one ground with nothing on them.** A vegetation sampler that
  refuses ground steeper than ~0.9 leaves every cutting bank bare — measured at 45% and 60%
  of two viewpoints' frames. Scattering more scrub is not the answer; the face has no scale
  and no evidence of anyone on it. A grid of shallow beams with growth in the cells supplies
  both, and is what a real cutting has.
- **Check the section numerically against whatever must pass through it.** An arch written
  from its radius instead of its springing put the crown 2.75 m out and ran a vehicle
  through solid rock — invisible for the structure's whole life. Write a
  `clearance()` function; it is the only thing that would ever have found it.

---

## Invariant checklist

Run all of these after any terrain change; none is optional and none is visible in a render.

| Check | Pass condition |
|---|---|
| `terrainSafety(world)` | 0.00 over every collider/platform inside a keep-out |
| Slope limiter | no node above `maxSlope · CELL` over a neighbour, per corridor |
| Both ground surfaces | any displacement applied to one applied to the other |
| Section clearance | measured against the largest thing that must pass |
| Connectivity flood fill | all waypoints reachable (see `walkable-level-verification`) |
| Tone distribution | no ground tone above ~⅓ of drawn area (see `procedural-object-detail`) |
| Determinism | same seed ⇒ bit-identical lattice; scatter windows appended, never widened |
