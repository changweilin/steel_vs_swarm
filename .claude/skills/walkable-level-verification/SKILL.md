---
name: walkable-level-verification
description: Prove a 3D level is actually navigable — connectivity flood fill, walkable-surface API semantics (collider vs platform vs cut), and the geometry that silently blocks routes. Use when adding a district/room/route/stair/ramp/bridge/tunnel, when players report being stuck or falling through, when props are placed near a passage, or before believing any new path works.
license: MIT
compatibility: any 3D level with an axis-aligned collider/platform height query
---

# Walkable Level Verification

**A route is not verified by looking at it.** Renders show geometry, not reachability.
Every failure in this catalogue rendered perfectly and threw nothing.

Method source: sakura-crossing `NEXT.md` (calls the flood fill "the single most valuable
tool here") and `src/world/index.js` / `src/core/player.js`.

---

## The flood fill

Grid BFS from the spawn using **the player's own movement rules**, not a navmesh.

```
grid step   ≈ player radius (0.35 m for r = 0.34)
per cell    resolve against colliders exactly as the player does
step up     accept if height delta ≤ step limit
step down   accept if drop ≤ fall limit (or unlimited if falling is allowed)
```

### Seven traps, each cost a round

1. **Key the visited set on `(cell, height bucket)`, not on the cell.**
   One bit per cell claims a stair's cells at ground height from the side before the
   climb reaches them, then refuses to revisit ⇒ every flight reports unreachable while
   being perfectly climbable. A station platform "failed" for two rounds this way.

2. **A height *tolerance* in the visited key ping-pongs forever on a slope.**
   Measured: 53.6 M visits for 770 k cells, never terminating. Use discrete buckets:
   `seen.add(cell * 64 + Math.round(y / 0.3))` converged in 12 M.

3. **Bucket the colliders spatially before running.** A fill that walks the whole
   collider list per neighbour test is O(cells × colliders) — measured 3 × 10⁹ ops at
   2 731 colliders, wedging the page so hard `location.reload()` timed out. A 6–8 m
   grid of collider lists is ten lines and took the same fill to 9 s.

4. **Run it chunked, budgeted by visits.** ~900 k cells is ~40 s of synchronous JS —
   past every timeout in the toolchain. Run in `setTimeout` slices of ~200–250 k
   *visits* (yielding per BFS layer instead adds ~8 s of pure timer clamp), stash state
   on a global (`window.__fill`), poll it. If one region still exceeds the tool
   timeout, run disjoint windows in **separate calls** with their own seeds.

5. **Widen the bounds when the world grows — and print them with every figure.**
   A grid that stops one district short returns a clean, confident, entirely false
   "unreachable" for everything past the edge. Check the bounds against the new area's
   envelope *before* believing a single probe. Quote bounds + seed + tool with any
   number, and **re-derive rather than compare** — totals from different windows or
   fill versions are not comparable.

6. **The cell count is not the check — the waypoint list is.**
   Put a `FLOODFILL` waypoint list in each area's header (one coordinate per place that
   must be reachable: every deck, landing, bore end, viewpoint, gate) and assert **all
   of them are reached**. Report the count only as a secondary signal, and attribute
   deltas by re-running with the new colliders spliced out (measured example: a new
   district cost 4 719 cells — 3 358 its own buildings, 972 its vehicles, the rest its
   trees; nothing sealed).

7. **A grid probe returning "unreachable" one or two cells off is usually a bad probe
   point, not a blockage.** Cell centres move when the bounds change, and a waypoint
   written on a building's frontage line is inside its collider once the player radius
   is added. Report the **distance to the nearest reached cell**, never a boolean —
   then confirm with a scan line (below). And a waypoint placed *inside a parking bay*
   correctly goes unreachable the moment something parks there: re-run with the new
   colliders spliced out — if the baseline reads the same, it was never a route; move
   the probe onto ground you can actually stand on and say so in the header.

### Diagnosing a failed probe in one call

```js
// scan line across the suspect gap — shows exactly where it closes
let s = ''; for (let i = 0; i <= 20; i++) s += reached(x0 + span * i / 20, z) ? '.' : '#';
// '.############........'  → blocked for 1.9 m, open for the last metre

// coarse ASCII map of the region — read the shape of the walls straight out of it
// (print '.'/'#' over an x/z grid)

// collider-hunt the exact point — names the box that seals it
colliders.filter((c) => c.top > y + STEP &&
  x > c.x0 - R && x < c.x1 + R && z > c.z0 - R && z < c.z1 + R);
```

**Do not drive the walker at a waypoint and call a stall a blockage** — it stalls on
anything a real player would sidestep.

### The linear trace — the fill's complement, not its substitute

A grid fill lands cell centres on platform joints; a walker's float coordinate almost
never does. So keep a second tool: **walk a route at ~0.15 m steps carrying the feet
height forward exactly as the player does**, printing the height at each step.

- It finds **cross-module seam holes** the fill's bucketing can blur: two districts each
  ended their platforms correctly and nobody owned the joint — 0.6 m of threshold with
  no platform, a 1.79 m fall in the middle of a gateway. The trace prints the fall in
  one line.
- It acquits staircases the fill wrongly condemns (see platform-joint trap below).

### Alternative for a single question

**"Can this be seen / reached from there" is a raycast, not a screenshot**, and needs no
browser: import the builder in Node with `document` stubbed by a proxy that no-ops every
Canvas2D call (geometry never depends on canvas contents), step the animation, fire a ray
from a plausible eye toward the target and stop just short. The result names **which mesh
is in the way and for how many frames**.

---

## Walkable-surface API semantics

Typical seam (adapt names, keep the semantics):

| Call | Meaning | Trap |
|---|---|---|
| `collide(x0,z0,x1,z1,top,bottom?)` | a solid the body is pushed out of | `bottom` makes it start at a height, so feet more than ~1.9 m below pass under. Needed for a rooftop parapet that must not be a wall at street level |
| `platform(p)` | a surface the feet can stand **on**; `heightAt` takes the **max** | a collider will not do this — its top is always above the feet |
| `cut(...)` | pulls ground **down** (excavations); platforms cannot | without it the height query follows the un-excavated surface |
| `heightAt(x, z, fromY?)` | ground height | **pass `fromY` for anything that walks.** With it, only platforms within ~0.55 m of the current height are offered — this is what lets an elevated deck be walked *under*. Omit it and anyone stepping beneath a bridge is teleported onto it. Builders seating props keep omitting it — **except props on an elevated platform, which need their `y` given explicitly** (the no-`fromY` answer up there is the ground far below). Apply **cuts first, then platforms**: lower the bank to the excavation, then let the path slab raise it back |

Two runtime patterns on top of the static seam:

- **A collider that must exist only sometimes** (a crossing gate, a drawbridge) is not
  added/removed from the list — its `top` is toggled between the barrier height and a
  value below the ground (a top under `feet + STEP` is skipped everywhere, so it is
  inert). No list mutation, no iterator invalidation.
- **Anything that adds colliders/interactables at runtime** (a summonable vehicle) must
  be balanced by count: exercise the full cycle (summon, use, put away) and assert both
  lists return to their starting lengths. And its spawn position is **searched**, not
  assumed — probe several distances × angles for clearance and a ground-height delta
  under ~0.5 m (or it spawns on a roof or in a channel), with a degraded fallback rather
  than a refusal.

### Rules that follow

- **Platform boxes must overlap, not meet.** `heightAt` is a max; a few cm of gap between
  the top tread and the terrace is a hole to fall through. **And if the platform test is
  exclusive on its edges, treads that exactly meet are a knife edge**: a query landing on
  the joint matches *neither* platform and returns the grade. A player's float coordinate
  practically never lands there — a 0.35 m grid fill lands there **every time**, so the
  tool built to find holes manufactures them. Overlap treads by ~40 mm in the shared
  helper. Symptom: a fill that stops dead partway up a staircase a linear trace walks
  without complaint.
- **Steps without `platform` registration are scenery.** Nothing throws, nothing looks
  wrong, and you find out when something else depends on getting up there. Use the shared
  `steps()` helper that emits tread geometry *and* one platform per tread.
- **A ramp is a staircase to the feet and a solid to the eye — build both.** A max-over-boxes
  height query cannot express a slope, so the feet need stepped platforms; but an edge pass
  outlines every box, so *drawing* that run gives N pale slabs with a line between each.
  Register N platforms, draw **one** raked box.
- **An axis-aligned platform cannot express a *diagonal* tread.** A 0.2 m tread's AABB on
  a diagonal flight is a metre deep; five of them overlap any point; the max is the same
  ramp shifted half a metre up-slope. Run flights along an axis, or grade the ground.
- **A terrace needs a parapet, not a flush wall.** Collision resolution skips any collider
  whose top is within one step of the feet, so a retaining wall level with the terrace lets
  you walk off the drop. Stand it proud.
- **A barrier must clear the feet by decisively more than the step limit** (~2.5× is
  safe). A channel-edge barrier 0.24 m above the path, against a 0.38 m step, is skipped
  outright — what actually kept people out of the water for years was the railing behind
  it. A kerb you can step over is fine, but do not also believe it is a fence.
- **A collider whose *geometry* follows a grade needs one collider per segment**, each
  taking the profile at its own **low** end. One flat box topped at the mid-height leaves
  the ends inside the step limit ⇒ skipped ⇒ not a barrier there at all. Same on curves:
  collider and geometry must be derived from the **same angles** — an arc drawn in five
  sections and collided as one chord AABB fences the view while the fill walks through
  it, invisible to both tools at once.
- **A railed platform is a solid object from underneath** if its rail colliders' `bottom`
  starts near the deck — a walker on the ground 1 m below is inside all four rails, and
  no `bottom` value fixes it (the rail's base *is* the deck). Route paths past elevated
  decks, not under their rails, and put the entry gap on the side the ground actually
  lets you walk up — which is not the same side twice.
- **Two walkable levels cannot share a footprint at the same height.** A switchback whose
  flights stack in plan is out; use quarter turns.

---

## Geometry that silently closes routes

| Construction | Why it blocks |
|---|---|
| A prop on a footpath | A 1.15 m path plus a 0.62 m cabinet plus a trunk is closed. **Player radius is added to every side of every collider.** A 0.4 m pole takes 1.08 m of clear ground — one pole on one street sealed a 1.4 m squeeze in a *different* district built by a different module. |
| Two facing colliders | Each is inflated by `r` on every side, so two of them need `2r` (~0.7 m) of clear ground before a single cell between them is walkable. A parapet end 0.7 m from a house sealed both stair flights off a bridge for the structure's whole life. **Probe the *top* of a flight, not the bottom.** |
| A parked vehicle | Takes `L+2r × W+2r`, e.g. 5.1 × 2.4 m for a 4.4 × 1.7 m car. A 3.4 m lane with one in the middle leaves 0.28 m; hard against one edge leaves 1.08 m. Identical in a render. Two vehicles centred in adjacent bays leave zero — park them to the outside of their own lines. |
| A gate between posts | If the posts carry no collider, the usable opening is `w − 2r`: a 1.1 m gate reads fine and passes 0.42 m. **~1.8 m is the working minimum** for a gated opening. |
| Railings around a deck | Three of four sides railed = fenced in. The fill reported an overlook unreachable with the ground one cell outside it fully walkable. A 0.09 m rail takes 0.86 m of ground — the entire width of a ridge top. |
| A box around an open-fronted structure | A collider round a shelter is a shelter you cannot stand in. Only the **back panel** colliders; open cheeks, posts and slim frangible furniture (wands, stop poles, a 0.11 m pole on a 1.55 m footway) go without one. |
| A generator's overhang | Anything a generator builds *outside* its own footprint (an external stair, a deep eave, balconies) is outside the collide box you guessed. **Derive the extent from the generator's own numbers**, never from memory. |
| A joint between wall panels | 0.2 m of joint reads as an opening from the alley and is a fifth of what a body needs. End runs in piers so openings are deliberate. |
| A wall end vs a kerb | A 1 m gap between a wall's end and a kerb is the only way through and is invisible in every frame. |
| A kerb | Invisible to **every** check: no collider (fill walks over it), not visible edge-on from the road. Split kerbs and drop them wherever anything drives across (side roads, car parks, aprons). |
| Scatter that moved | Regenerating a scatter stream moves every instance; some land in routes. Only the fill finds this. |

**Probing a new prop against the collider list does not see the other new props** — none
of the same sweep's siblings exists as a collider until the sweep runs, so every position
"passes" while two of them interpenetrate. Any pass that places many of one thing needs a
**pairwise check over its own list**, run automatically in dev.

---

## Workflow

1. Before building: **measure the parcel, do not remember it.** Query the collider list
   over the envelope and sample the height field on a grid; write the result into the
   module header as a list of what the ground is already committed to. The one time this
   was written from memory it omitted a building and the lane went through it.
2. Build. Register `platform` for every walkable surface, `collide` for every solid.
3. Add `FLOODFILL` waypoints to the header for every place that must be reachable.
4. Run the fill — **every area's waypoints, not just the one you touched** (furniture on
   one street can seal a squeeze in another module's district). **All waypoints reached**
   is the pass condition.
5. Record the cell count in the change note as a secondary signal, attributed by the
   splice-out re-run.
6. Re-run after: moving any collider, changing any scatter seed or window, adding railings,
   parking anything, adding street furniture anywhere, or widening any terrain feature.
7. For any single route the fill flags (or any cross-module threshold), run the linear
   trace before concluding anything.

Related global check: **a body of water fails globally, and nothing renders the failure** —
a 0.3 m notch anywhere in a 400 m rim drains the basin without changing a pixel. Verify
containment with the same machinery: a flood fill on `ground < waterLevel` from a seed in
the basin must stop at the shore. Per-point freeboard sampling passes while a gully twenty
metres out drains the lot. (Terrain-side rules: see `heightfield-terrain-integrity`.)

---

## Reporting

State the seed coordinate, the bounds, the tool version, the waypoint result, and the
attributed delta:

```
198 117 cells reachable from seed (89, −60) over x −170…170, z −200…130
all 31 waypoints reached (incl. both bore ends, four portal mouths, four viewpoints)
−4 719 vs splice-out re-run — 3 358 buildings, 972 vehicles, 389 trees; nothing sealed
```

A cell count with no bounds and no waypoint result is not a verification. And numbers
from different bounds, seeds or fill versions are **not comparable** — re-derive, never
compare.
