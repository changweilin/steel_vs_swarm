---
name: generator-table-catalog
description: Build a whole catalogue of buildings, appliances, street furniture and vehicles from one generator per family plus a table of rows — the frontage convention, real recesses, derived hardware, per-material baking and instancing, and the draw-call arithmetic. Use when adding buildings/shops/houses/vehicles/machines/props, when a street reads as copies of one house, when two hand-placed copies of the same assembly disagree, or when prop count is eating the frame budget.
license: MIT
compatibility: Three.js or any procedural 3D scene
---

# Generator + Table Catalogue

**A kind is a table row, not a function.** One generator per *family*, one row per kind,
and everything else derived from the row's numbers.

The bug class this exists to prevent is specific and recurring: two hand-placed copies of
the same assembly, neither of which joins up. In the reference project both copies of a
bicycle had the fork 0.3 m short of the front hub, the seat stay running out through the
far side of the wheel, and no chain stays at all — and neither copy looked wrong in a
screenshot.

Method sources: sakura-crossing `src/world/{shops,buildings,housing,vehicles,props}.js`;
`messenger.abeto.co` (the authored-asset alternative: glTF + `BatchedMesh` + KTX2).

> Related: `procedural-canvas-textures` (every sign, plate and livery on these objects),
> `procedural-object-detail` (what varies and what must not), `anime-line-control`
> (why a five-box prop must be merged before it is outlined).

---

## L0 — Choose the axis of the family before writing anything

A family is a set of objects that **share a construction and differ in a small, named
way**. Get the axis wrong and the generator fights you forever.

| Family | The shared construction | The row |
|---|---|---|
| Shops | glazed recess, fascia, blade sign, awning, shutter | tenant key, colours, floors, shutter position |
| Detached houses | one volume, one roof, one frontage | roof kind, wall/roof index, floors, bay count |
| Terrace (連棟) | N narrow units sharing party walls | **door colour, clutter, one shutter down — and nothing else** |
| Walk-up block | access gallery, open stair, one repeated balcony | storeys, unit count |
| Vehicles | body wedge + glasshouse + wheels under arches | 11 numbers (below) |
| Appliances / machines | box body with a notched opening | panel art, lamp colours, opening geometry |

**A terrace that varies its walls is not a terrace, it is a row of houses.** This is the
single most common family-axis error: variety applied to the property that defines the
family destroys the family. Same for a shopping street — it reads as a street *because*
the units share a construction and differ only in colour, signage and clutter.

---

## L1 — The frontage convention

**Author every generator facing one axis (+Z) and rotate the whole group by `face`.**

```js
const FACE_RY = { 'z+': 0, 'z-': Math.PI, 'x+': Math.PI / 2, 'x-': -Math.PI / 2 };
```

Branching on the axis inside every measurement is how a stair's underside climbs away from
the treads it carries. With one convention:

- every in-unit offset (`doorAt`, window pitch, sign position) is in the **unit's frame**;
- everything stood **outside** the unit is placed in world space but authored facing +Z, so
  a unit whose frontage looks −x needs `ry = -π/2` on all of it. Getting this backwards
  points the vending machine's back at the street and nothing throws.

Corollary that bites once per project: **a positive in-unit offset moves the other way in
world space on a rotated frontage.** Specify the door 1.4 m east of centre in the unit's
frame, then build the porch in world space, and the canopy, steps, mat and both lamps land
on the wrong side of the doorway with one lamp inside it.

---

## L2 — Depth is built outward; a recess must be real

**You cannot carve a recess into a box.** A panel written *behind* a solid face is inside
the render — no error, no throw, just a blank wall. Recorded instances from one project:
five lattice screens at `front − 0.04` (none drawn), every windscreen laid along its body
wedge's centreline (every car with a body-coloured screen), brake levers at the cowl's own
half-width (inside it), a map tilted about its own centre "for depth" (bottom edge swung
behind the posts it bolts to).

**Fake depth by stacking outward:**

```
backing board  +0.04
sill / posts   +0.08     ← deeper than the board, shallower than the battens: it frames them
battens        +0.12
```

**Build a real cavity where something has to go in or come out.** A shopfront's solid
volume stops ~0.9 m short of the frontage line, with piers and a header framing the hole —
that is what gives the glass something to be *in front of*. A glazed decal on a solid box
reads as a sticker, every time. Same for a machine's delivery port, a locker recess, a
bathhouse lobby.

Two derived rules:

- **A pocket is only visible along a sight line shallower than `atan(height / depth)`.**
  A 0.135 m tall, 0.17 m deep port is 38°, and the player standing at the machine's own
  collider looks down at 70° — so the item inside is invisible from the only place you can
  stand to use it. 0.165 over 0.11 is 56°, which works from about a metre out.
- **When two constraints on a moving part cross, the part should not move.** A hinged flap
  long enough to cover a 0.11 m pocket sweeps the whole cavity; deepening the pocket breaks
  the sight-line rule. Fixed and translucent is both correct and what the real thing is.

---

## L3 — The vehicle row (worked example of "derive everything")

A vehicle in a stylised frame is read from four things and nothing else: the proportion of
glasshouse to body, the rake of the two screens, where the wheels sit under the arches, and
the mirrors. So that is all the table carries.

```js
kei: {
  L: 3.40, W: 1.48, R: 0.28,     // overall length, width, wheel radius
  axle: [-1.15, 1.15],           // the two axle centres in x — wheels drawn *there*
  sill: 0.34, waist: 0.92,       // bottom and top of the lower body mass
  roof: 1.72,                    // height to the roof panel
  cab: [-0.90, 0.60],            // where the glasshouse meets the waist, rear and front
  rakeF: 0.42, rakeR: 0.30,      // how far the roof edge is set *back* from each of those
  side: [-0.80, 0.50],           // extent of the side glazing
  extra: [],                     // box body / load bed / raised roof
}
```

Arches, bumpers, lamps, plates, seams, handles, mirrors and wipers are all derived from
those numbers, so **a new kind is a row and not a function**.

Three points that generalise past vehicles:

- **`waist` is one height.** On a car drawn this way the bonnet, the boot lid and the
  window sill are the same line; pretending otherwise costs two masses and reads no better.
- **The screens are drawn between two points**, not as a box given a guessed tilt.
  See L5.
- **`side` is the whole difference between a van and a minivan** — one number. Look for
  that number in every family you build.

Conventions to fix once: authored **along +x with the nose at +x**, origin at ground level
at the centre of the footprint, so `ry` *is* the direction the nose faces. Then a country
that drives on the left means a vehicle at the east kerb of a north–south street noses −z
and one at the west kerb noses +z — which is half of what makes a row of parked cars read
as a street.

---

## L4 — Appliances, machines and street furniture

The small stuff is where a place stops looking like a demo, and it is also where the draw
calls go. Rules:

- **Merge a multi-box body into one mesh before outlining it.** A vending machine as five
  boxes gets a contour on every internal seam. Merge, then notch the opening out of the
  merged geometry.
- **Whatever face a prop is *used* from carries all of it** — slot, plate, keypad, handle.
  A posting slot on −z and the name plate on +z is a prop you cannot tell the front of.
- **A prop under 0.3 m reads as a dot** unless it has the one or two features that carry
  its silhouette at distance (for a perched bird: the wedge tail held clear of the wire and
  the beak clear of a flat head).
- **A saturated lamp is the one part that has to be small.** 0.26 × 0.20 in flat red is the
  loudest thing in any frame with a car park in it; real clusters are smaller, deeper and
  split by a housing bar.
- **Wall-mounted units:** `ry = atan2(nx, nz)` of the wall's outward normal, and the back
  face **touches the wall** — draw bracket arms spanning the stand-off, or the unit is a
  box hanging in the air casting its own shadow onto the wall.
- **Anything inside an unlit recess needs `emissive`, not a lighter colour.** See
  `cel-shading-pipeline`.

---

## L5 — Assemblies are built from joints

```js
const J = { BB: [...], HB: [...], SC: [...], HT: [...] };   // named joints
strut(g, mat, J.BB, J.HB);   // length and rake derived from the two endpoints
```

Applies to anything with **two or more connected members** — and "two" is not an
exaggeration: a canopy stay written as a 1.2 m box at a centre and an angle put one end on
the canopy and the other in mid-air a metre clear of the wall it was bracing, on both
canopies of the same building.

| Trap | Correct derivation |
|---|---|
| A raked flight's soffit/stringer | A box along Z rotated by *t* about X sends its **+z end down**; a box along X rotated by *t* about Z sends its **+x end up**. One `rake` constant serves both — guessing gives an underside that climbs away from its treads |
| A cylinder along the ground | `CylinderGeometry`'s axis is +y; a rail along z needs `rx = π/2`, or it is a column standing through the roof |
| The tip of a rotated part | Apply the rotation to the offset (`applyEuler`). A part rotates about its **centre**, so the tip is centre + R·(0, h/2, 0) — hand-derived sin/cos put every limb 0.4 m off, at 90° to the lean |
| A glass pane over a raked panel | Offset along the panel's **outward** normal, and derive which of the two normals is outward (the one pointing away from the cabin centre) |
| A prop's stand-off from its post | Rotate the offset with the plate, not in world axes — otherwise it only clears at `ry ≈ 0` |
| A sign plate bolted to a post | The plate must be **thicker than the post**, or the post comes through the printed face |

---

## L6 — Draw-call arithmetic (do this before the family grows)

Scenes of this kind are **draw-call bound**, not fill bound. Measured on the reference
project: halving the internal resolution changed 19.3 → 19.1 ms; shrinking the shadow
cascade from ±34 m to ±22 m gave 19.7 → 18.4 ms. Counting draw calls is the only
diagnostic that resolves anything.

The pattern that matters:

```
static parts of one building   →  bake() per material   →  ~6–8 draw calls per building
one prop placed dozens of times →  bake one item into N geometries by material,
                                   then instance the N                ← the fix
```

A prop group that is a dozen separate meshes and gets placed dozens of times is the whole
problem. An 11-mesh planter placed 40 times is 440 calls; the same planter baked into three
material geometries and instanced is 3.

Also:

- **Anything world-scale is never frustum-culled** after a bake that folds geometry into
  root space, because its bounding sphere is the whole world. Keep dressing (fencing,
  furniture, planting, signage) bounded to the district; only the structure runs the whole
  way. Moving three layers off one such ring saved a fifth of the whole scene's triangles
  and nobody could see the difference.
- Baked district-scale meshes **are** exactly culled (identity transform, root-space
  geometry), so leave culling on; instanced meshes stay unculled on purpose.
- Long geometry authored as a 2-vertex box needs a subdivision pass to survive any
  world-space warp — and **a multi-material mesh must keep `geometry.groups` through it**,
  or it is not drawn at all (see `cel-shading-pipeline`).

---

## L7 — When the assets are authored instead of generated

If there is an artist and a glTF pipeline, the same discipline moves up a level:

- **`BatchedMesh` + one bone texture with a row per instance** puts a whole crowd of
  animated characters in one draw call; each instance indexes its own row with
  `getBoneMatrix(i, batchID)`.
- **Upload one geometry per frame** (`_buffersToUpload` drained one entry at a time) when
  swapping meshes into a batch, or a wardrobe change hitches the frame.
- **KTX2 + Draco/meshopt** for every texture and mesh, with a `-highq` variant and a
  smaller one selected by device tier (see `mobile-webgl-interaction`).
- The table does not go away — it becomes the manifest of which glTF node, which material
  slot and which colour row each kind uses, and it still carries the reason each kind
  exists.

---

## L8 — Placement is a separate, auditable table

When placing many of one expensive thing, put **every placement in one file, one row each,
with a `note` saying why it is there.** A distribution cannot be reviewed 30 lines at a
time across 22 modules, and half the placements sit one metre from something that would
make them wrong.

- Cap the on-street count hard. 18 vehicles total / 8 on carriageways read as a town;
  36 / 20 read as a car park with houses.
- **Fill the marked parking the districts already drew, first.** An empty bay beside one
  parked vehicle does more work than a second vehicle in it. Kerbside is seasoning.
- Never let two face each other across a road — the eye reads the gap as impassable, which
  is a composition bug, not a collision bug.
- **Probing a new prop against the existing collider list does not see the other new
  props.** Any pass that places many of one thing needs a **pairwise check over its own
  list**; two cars 1.6 m apart with 4.05 m of body each drove through one another for a
  whole round and from every angle one hid the join.
- Record the places that have **none**, and why (nothing can drive there).
- Re-run the connectivity check after adding furniture — anywhere, not just in the block
  you touched. A 0.4 m pole adds the player radius on every side and can seal a link in a
  *different* district that has been fine for rounds.

---

## Symptom → cause

| Observed | Cause |
|---|---|
| A street reads as copies of one house | Variation on the wrong axis, or no row table at all |
| A terrace reads as a row of separate huts | Walls/roofs varied — vary door colour and clutter only |
| A shopfront reads as a sticker | No real recess; the volume must stop short of the frontage |
| A screen/panel/lattice is simply absent | Written behind a solid face — depth is built outward |
| Two members of an assembly do not meet | Placed by centre + angle instead of between two named joints |
| A car has a body-coloured windscreen | Pane laid along the wedge's centreline instead of offset along its outward normal |
| Every internal seam of a machine is outlined | Multi-box body not merged before the contour pass |
| A wall unit hangs in the air with its own shadow | Back face not touching the wall; no bracket arms across the stand-off |
| A machine's animation "does nothing" | The thing it moves is inside opaque geometry — check where it actually is before the logic |
| The item in a recess cannot be seen from the interaction spot | Pocket angle shallower than the standing eye angle |
| Frame time collapses after adding props | Multi-mesh prop groups placed many times; bake per material and instance |
| A far district submits triangles from every camera | World-scale geometry is never culled — bound the dressing to the district |
| Half the district's signs vanish after a geometry pass | `geometry.groups` dropped from a multi-material mesh |

---

## Reference implementations

Two shipped projects, one per approach — sakura generates its catalogue, messenger authors
it. `WebFetch` gets 403 on both sites; use `curl` / `gh`.

**sakura-crossing** — cel-shaded Japanese neighbourhood on a small planet; Three.js,
vanilla ES modules, no image assets. Every building, shop, vehicle and prop in it is
generated from a table.

```bash
git clone --depth 1 https://github.com/Kenton-GMI/sakura-crossing.git /c/tmp/sk
#                                                                    ↑ short path: a deep
#   temp dir fails on Windows with "cannot write keep file … Filename too long"
```

**messenger.abeto.co** — small-planet delivery game with authored glTF assets; the shipped
bundle shows the batching and streaming side.

```bash
curl -sSL --ssl-no-revoke https://messenger.abeto.co/ -o msg.html   # read the App3D-<hash>.js name
curl -sSL --ssl-no-revoke https://messenger.abeto.co/assets/App3D-<hash>.js -o App3D.js
```

**Read for this skill:**

| What | Where |
|---|---|
| One generator, nine tenants; the real glazed recess | sakura — `src/world/shops.js` (read the file header first) |
| Detached-house generator, and why the roster arrays are append-only | sakura — `src/world/buildings.js` |
| The three residential types a detached generator is missing, and the terrace rule | sakura — `src/world/housing.js` header |
| The vehicle `SPEC` row and the four things a stylised vehicle is read from | sakura — `src/world/vehicles.js` header — the clearest statement of this pattern anywhere in either project |
| Street furniture, joints-not-positions, `makeBikeRack`'s bake-then-instance fix | sakura — `src/world/props.js` |
| Placement as an auditable table with a reason per row, plus the pairwise overlap check | sakura — `src/world/traffic.js`, and `NEXT.md` "機動車 — putting the town's traffic in" |
| Draw-call arithmetic, measured | sakura — `AGENTS.md` "Conventions", the bake/instancing bullet |
| Batched skinned meshes, per-instance bone-texture rows, one geometry upload per frame | messenger — `grep 'getBatchingMatrix'` and `_buffersToUpload` in the raw bundle |
| Compressed asset pipeline (KTX2 / Draco / meshopt, `-highq` variants) | messenger — `grep 'ktx2\|KTX2\|DRACO\|meshopt'` in the raw bundle, and the asset filename list |
