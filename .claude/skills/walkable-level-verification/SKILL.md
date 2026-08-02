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

### Four traps, each cost a round

1. **Key the visited set on `(cell, height bucket)`, not on the cell.**
   One bit per cell claims a stair's cells at ground height from the side before the
   climb reaches them, then refuses to revisit ⇒ every flight reports unreachable while
   being perfectly climbable. A station platform "failed" for two rounds this way.

2. **A height *tolerance* in the visited key ping-pongs forever on a slope.**
   Measured: 53.6 M visits for 770 k cells, never terminating. Use discrete buckets.

3. **Run it chunked.** ~900 k cells is ~40 s of synchronous JS — past every timeout in
   the toolchain. A synchronous run left the renderer so wedged that `location.reload()`
   timed out and the dev server had to be restarted. Run in `setTimeout` slices and poll
   a global (`window.__fill`).

4. **The cell count is not the check — the waypoint list is.**
   Cell totals are incomparable across any change to the bounds. Put a `FLOODFILL`
   waypoint list in each area's header (one coordinate per place that must be reachable:
   every deck, landing, bore end, viewpoint, gate) and assert **all of them are reached**.
   Report the count only as a secondary signal (a drop of 1 930 cells after adding a
   building is right; a drop of 40 000 is a closed route).

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
| `heightAt(x, z, fromY?)` | ground height | **pass `fromY` for anything that walks.** With it, only platforms within ~0.55 m of the current height are offered — this is what lets an elevated deck be walked *under*. Omit it and anyone stepping beneath a bridge is teleported onto it. Builders seating props keep omitting it |

### Rules that follow

- **Platform boxes must overlap, not meet.** `heightAt` is a max; a few cm of gap between
  the top tread and the terrace is a hole to fall through.
- **Steps without `platform` registration are scenery.** Nothing throws, nothing looks
  wrong, and you find out when something else depends on getting up there. Use the shared
  `steps()` helper that emits tread geometry *and* one platform per tread.
- **A ramp is a staircase to the feet and a solid to the eye — build both.** A max-over-boxes
  height query cannot express a slope, so the feet need stepped platforms; but an edge pass
  outlines every box, so *drawing* that run gives N pale slabs with a line between each.
  Register N platforms, draw **one** raked box.
- **A terrace needs a parapet, not a flush wall.** Collision resolution skips any collider
  whose top is within one step of the feet, so a retaining wall level with the terrace lets
  you walk off the drop. Stand it proud.
- **Two walkable levels cannot share a footprint at the same height.** A switchback whose
  flights stack in plan is out; use quarter turns.

---

## Geometry that silently closes routes

| Construction | Why it blocks |
|---|---|
| A prop on a footpath | A 1.15 m path plus a 0.62 m cabinet plus a trunk is closed. **Player radius is added to every side of every collider.** |
| A parked vehicle | Takes `L+2r × W+2r`, e.g. 5.1 × 2.4 m for a 4.4 × 1.7 m car. A 3.4 m lane with one in the middle leaves 0.28 m; hard against one edge leaves 1.08 m. Identical in a render. |
| Railings around a deck | Three of four sides railed = fenced in. The fill reported an overlook unreachable with the ground one cell outside it fully walkable. |
| A joint between wall panels | 0.2 m of joint reads as an opening from the alley and is a fifth of what a body needs. End runs in piers so openings are deliberate. |
| A wall end vs a kerb | A 1 m gap between a wall's end and a kerb is the only way through and is invisible in every frame. |
| Scatter that moved | Regenerating a scatter stream moves every instance; some land in routes. Only the fill finds this. |

---

## Workflow

1. Before building: **measure the parcel, do not remember it.** Query the collider list
   over the envelope and sample the height field on a grid; write the result into the
   module header as a list of what the ground is already committed to. The one time this
   was written from memory it omitted a building and the lane went through it.
2. Build. Register `platform` for every walkable surface, `collide` for every solid.
3. Add `FLOODFILL` waypoints to the header for every place that must be reachable.
4. Run the fill. **All waypoints reached** is the pass condition.
5. Record the cell count in the change note as a secondary signal.
6. Re-run after: moving any collider, changing any scatter seed or window, adding railings,
   parking anything, or widening any terrain feature.

---

## Reporting

State the seed coordinate, the bounds, the waypoint result, and the delta:

```
198 117 cells reachable from spawn over x −170…170, z −200…130
all 31 waypoints reached (incl. both bore ends, four portal mouths, four viewpoints)
−1 930 vs previous — accounted for by the new building's footprint
```

A cell count with no bounds and no waypoint result is not a verification.
