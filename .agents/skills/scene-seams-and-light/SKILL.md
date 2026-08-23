---
name: scene-seams-and-light
description: Join districts, ground surfaces and areas so no seam is visible or walkable-into — one continuous ground with masks instead of tiles, build order as a dependency, junction paving arithmetic, coplanar-face coin tosses, sight-line corridors, horizon and fog budget, and area-to-area transitions. Use when ground tiles show their joins, a district boundary reads as a cut, the player falls through a threshold, paving z-fights, a scene "has no depth", or a transition between areas feels abrupt.
license: MIT
compatibility: Three.js or any procedural 3D scene
---

# Scene Seams and Light

Three different things get called "the seam problem" and they have different fixes:

1. **Material seams** — you can see where one ground treatment becomes another.
2. **Geometric seams** — two surfaces meet at the same height and fight, or do not quite
   meet and leave a hole.
3. **Perceptual seams** — the space reads as a set of rooms rather than one place.

Method sources: sakura-crossing (`src/world/{index,ground,street,district}.js`, the trap
table in `AGENTS.md`); `messenger.abeto.co` (one-mesh terrain with shader masks, wipe
transitions, ambience spheres).

---

## L1 — Do not tile the ground. Mask one surface.

**Both reference projects have no ground tiles at all**, and this is the single largest
structural difference from a tile-based world.

| | Tiled ground | Masked single surface |
|---|---|---|
| Ground is | N patches, each with its own material | one mesh (or one height field) with **one** material |
| Variety comes from | picking a patch style per cell | masks computed in the fragment shader from noise + geometry |
| Seams | must be hidden — cross-fades, overlays, border pieces, corner puzzles | **do not exist**, because there is no boundary object |
| Cost of a new ground type | a patch style, a border style for every existing neighbour, and a corner case | one more `step()` in the shader |
| Lines between types | need a separate decision | fall out of `surfaceId` for free |

```glsl
vec4 n = triplanar(tNoise, worldNormal, worldPos * 0.4, 1.0);
float grassMask = step(0.15, max(0.0, -n.r*1.5 + dot(worldNormal, up)) - n.g*0.35 + 0.1 - n.b*0.05);
float wetMask   = 1.0 - step(0.334, height * 0.015 + n.g * 0.006);

vec2 colorUV = vUv;
if (grassMask > 0.5) colorUV = vec2(0.15, 0.95);   // index into a palette strip
if (wetMask   > 0.5) colorUV = vec2(0.21, 0.54);
baseColor = applyTerrainColor(worldNormal, worldPos, texture2D(tColors, colorUV).rgb);

surfaceId += grassMask * 0.1;    // the boundary now inks — see `anime-line-control`
```

Points that make it work:

- **The palette is a tiny colour strip, not per-type textures.** Every ground type is a
  UV coordinate into one image, so adding a type costs nothing and the palette can be
  re-graded in one place.
- **Masks are `step`, with the threshold jittered by noise.** A blend is the one soft edge
  in a quantised frame. See `procedural-object-detail` L1b-C.
- **Two orthogonal terms per mask minimum** (a geometric one and a noise one), or you get
  either a perfect contour or a random spatter.
- **Built ground is a separate element id**, not a mask — `if (vElementId == 1)` selects
  the natural surface; roads and slabs take their colour straight from the atlas.

### The appearance budget: one base plus 2–4 *reasoned* overrides per zone

A tiled ground picks its style from a weighted list. That pick has **no reason**, which is
why such systems always grow three patches on top of it: a coarse "lot" scale so the style
does not change too often, a colour-path ordering so the change is not too large, and a
cross-fade overlay so the change is not too visible. All three exist to hide the fact that
nothing decided anything.

The masked form replaces the list with a short ladder:

```
base appearance for the zone
  + step(geometric term ⊕ noise term) → override A
  + step(…)                          → override B
  + step(…)                          → override C          // 2–4 overrides, then stop
```

**Every override must have a geometric reason** — slope band, height band, distance to
water, distance to built footprint, a cover/attribute field. Reference ladders:

| Zone | Base | Overrides |
|---|---|---|
| grass / green | short turf | long meadow (cover field high) · scrub (moderate slope) · flowers (low-frequency noise pocket, ~5 %) |
| bare / dry | wild ground | gravel (slope) · sand (near water, low) · cracked earth (flat and dry) |
| urban | pavement | lawn (open-space pocket) · park (larger pocket) · concrete (near built footprint) |
| wetland | marsh | lotus / open water (depth) |
| water | shallow | deep (depth) |
| alpine | plateau | scree (steep) · icefield (high) |

Three to five appearances per zone is the working budget, and it is a real ceiling: in the
masked form **each appearance is shader code, not a data row**. Anything that needs more
variety than the ladder gives should not be ground cover — it should be a *feature patch*
(a paddy field, a car park, a solar farm), which is a bounded object with a real edge and
therefore has no seam problem in the first place.

That split is the part people get wrong when collapsing an existing tile system:
**collapse the carpet that covers everything; keep the discrete feature patches.** They
look like the same list and they are not the same problem.

If a tile system already exists and cannot be removed, the mitigations are: one shared
`surfaceId` for the whole ground family (so tile-to-tile joins produce no line at all), a
tile-selection scale much coarser than the tile itself, and ordering the style list as a
**colour path** so adjacent indices are adjacent colours. But the above is the structure
the reference projects chose, and each of those mitigations is a patch for the missing
reason.

### What collapses with the tiles

Worth knowing before costing the change, because the win is larger than "no seams":

- the carpet stops being a **separate layer of skin** over the ground and becomes the
  ground mesh itself — so any adopt/drape/sag machinery that existed to keep a second
  surface glued to the first retires with it;
- the carpet's draw calls collapse to roughly **one**, from however many
  `style × variant` buckets there were;
- and the three patches above (lot scale, colour-path ordering, cross-fade overlays) all
  retire, along with any enclave planner and any rule that let the *rendering* decide a
  gameplay classification because the two disagreed by half a tile.

---

## L1b — Put the boundary on a real edge and it needs no hiding

L1 removes the *tile* seam. This removes the *reason* a boundary looks wrong.

**A ground-cover change that happens where nothing happens is a seam. The same change at a
road kerb, a river bank, a field boundary or a break of slope is a fact.** No amount of
cross-fading, border tiling or noise makes the first one read correctly, and nothing at all
is needed to make the second one read correctly.

So classify **regions**, not cells:

```
1. collect the linework that really divides ground
     roads and tracks (ranked)   railways   watercourses and coastline
     landuse / natural polygon outlines     administrative edges (low priority)
     derived: the contour where slope crosses the "you can build a road on it" threshold
2. rasterise it as walls into the classification grid
3. flood fill the complement  → one region id per face
4. label each region ONCE, aggregating evidence over the whole face
5. absorb the wall pixels into the nearest face
```

This is a planar subdivision, but built with a raster flood fill rather than a half-edge
structure — orders of magnitude less code, no numerical fragility, and no dependency.

Four rules, each from a way this goes wrong:

- **Rank the linework; do not let every path partition.** In a dense city every footpath
  becomes a boundary and the result is faces of a few square metres — noise again, with
  more machinery.
- **Merge any face below a minimum area into its largest neighbour.** Same rule, and same
  reason, as merging small planar patches in a mesh: a scale of detail below what the
  boundary is *for* is not detail.
- **Evidence has a trust ladder, and aggregating over a face changes where each source
  sits on it.** Real map polygons beat image classification beats hand-written declaration.
  Aggregating per face demotes the image classifier from "the decision" to "the tiebreak",
  which also shrinks any per-client divergence in fetching imagery.
- **Structure footprints are keep-outs for the partition.** A road centreline that runs
  under a viaduct will otherwise cut the ground beneath it into two faces with two
  different covers, and the piers stand on the boundary.

Both reference projects classify per point rather than per region — they are set in
invented places with no map data, so there is no real linework to partition by. **This
layer is what a world built from real geodata can do that they cannot**, and it is the
cheapest large win available to such a world.

---

## L2 — Geometric seams: the coin-toss family

**Two coplanar faces at the same height are a coin toss, not a layer.** The renderer wins
one of them arbitrarily, per camera position, and the tell is unmistakable once you know it:

> **A material edit that produces a pixel-identical frame is never a subtle material
> problem — that face is not being drawn.**

Recorded instances from one project: a roof deck's slab laid at the same height as the
building mass it closes (three successive material darkenings, all pixel-identical); a
noren hung at exactly the frontage line + 0.06 where the doorway board's face also lands;
a selection-button row coplanar with a panel that covered three of five buttons.

Rules:

| Situation | Rule |
|---|---|
| Two slabs meeting at one height | One **butts** against the other's edge line; they never overlap |
| A mass closed by a slab | The mass stops 0.10 m short; the slab closes the top |
| Anything hung over a doorway | Clear the wall by ≥ 0.10 m |
| A curved paved area (street + turning circle) | **One polygon**, not a rectangle plus a disc. A `THREE.Shape` — rectangle, `absarc` the long way, back along the far edge — extruded and `rotateX(-π/2)`. Shape space is `(x, −z)`, so the arc sweeps *clockwise* |
| A T junction | **Three different numbers**: the carriageway runs to the far kerb line of the road it meets, the footways stop at the near one, the minor arm butts against the major one's kerb line. Paving both arms to their own centre lines leaves an unpaved quadrant with a notched corner in the middle of the frame |
| A kerb where anything drives over it | **Split it** and drop it (40 mm rather than 105) — every side road, car park and apron. A kerb carries no collider anywhere, so no connectivity check will ever find one running across a car-park entrance |
| Two ground surfaces covering the same area | **Any displacement applied to one must be applied to the other by the same amount.** Two surfaces 65 mm apart, with relief applied to only one, put the lower one up *through* the road, the kerbs and the tyres of anything parked on them — 7 346 m² of it, worst 1.68 m |
| A grid that samples a curve | The chord across a convex curve runs `f''h²/8` **above** it (9 mm at 2 m rows). Drop each row by its own chord excess, or the interpolated surface floats over the plane the props are seated on |
| Where one area's platform stops | The next one's must **start** — 0.6 m of unowned threshold drops the player 1.79 m to the natural grade, and once down there they cannot get back up. Two modules each ending their own work correctly is exactly how this happens |
| Platform boxes | Must **overlap** (~40 mm), never meet: a max-over-platforms height query is exclusive on all four sides, so a query landing on a joint matches neither and returns the grade. Players almost never land on a joint; a 0.35 m flood-fill grid lands on one every time |

**The reference plane is not the rendered ground.** Verify by firing a ray *down onto the
mesh* and comparing with the height query — the query agreeing with itself proves nothing.
In one project everything standing on bare ground floated 78 mm for the entire life of the
project because the terrain mesh was drawn 75 mm below the plane every prop was seated
from, and two other modules had grown constants to match it.

---

## L3 — Build order is a dependency graph

**A new area is a module that returns its planting; it does not plant.** Tree, petal and
scatter builders merge the whole world into a handful of instanced meshes, so they must run
once, at the end — planting inside an area multiplies the draw calls by the number of areas.

**Order in the area list is ground-query order.** An area that sits against another's
surfaces must run after them; anything that seats clutter on laid surfaces runs last but
one. Get it wrong and props seat on the bare grade, buried or floating by exactly the
thickness of the surface that had not been laid yet.

**Start a new area by measuring the land, not by remembering it.** Query the collider list
over the envelope and the ground height on a grid *before choosing a single coordinate*,
and write the result into the module header as a list of what the parcel is already spoken
for. The one time that list was written from memory it left out a shop, and the new lane
went through it for six metres — every frame of which looked correct.

**A module nobody imports builds nothing, silently.** Three finished areas sat complete and
unreferenced for a whole round.

---

## L4 — Perceptual seams: making one place instead of several rooms

- **Sight-line corridors, not keep-out discs.** A cone from a viewpoint is arbitrarily
  narrow at its apex, so a 32° fan leaves a 4 m gap five metres out — and a tree five
  metres from a viewing platform *is* the view. Keep-outs are half-widths that start wide
  (≈9 m) and open with distance.
- **A gap cut for a view admits nothing within about a metre of its axis for the first
  ten.** A utility pole 0.2 m off the centre line of a 1.8 m gap fills the whole opening.
- **Anything at eye height in a narrow passage must be checked from both directions.**
  A warning plate a quarter-metre inside a 2 m link is the entire view through it.
- **A long wall must end in a pier.** 2.2 m of concrete terminating in nothing reads as a
  grey card standing on the paving.
- **A gap between two wall panels is read as a way through.** Either close the run properly
  or leave a real (≥1.8 m) opening.
- **Elevation changes what a screen is.** A deck 7 m up is *inside* the canopy layer, so a
  single tree five metres off the deck end closes the whole distance west.
- **Two objects facing each other across a route read as a barrier** even when the gap is
  walkable. Composition, not collision.

---

## L5 — Depth, horizon and light coherence

**Visible depth is a budget, and it has one knob.** On a small-planet world the ground
horizon is `√(2Rh)` — about 23 m at R = 160. Shrinking R pulls the horizon in and hides
more of the area; growing it flattens the world. On a flat world the same budget is set by
the fog range, and it must be spent deliberately:

```
fog near/far  ≈  line-fade start/end   ← distance is handed to fog, not to lines
```

Matching them is what stops the background becoming a wireframe at the exact distance the
haze is meant to take over. Sky, fog and the far grade must all agree that "the horizon is
the fog colour", or there is a visible ring where the dome meets the ground.

Layers that build depth without geometry, cheapest first:

1. **Distant hill silhouettes** — 2–3 unlit layers of pure silhouette at decreasing value.
   Painted background flats; they cost three draw calls and they are most of the depth.
2. **Two cloud opacities** — a shade plate offset behind a light plate on each billboard.
3. **Aerial perspective in the grade**, not per material — a second fog colour near the
   camera, applied in the composite as an exact identity when the fog factor reaches 1, so
   the "horizon = fog colour" relationship is untouched.
4. **Ground shade discs** under canopies — low-opacity dark discs with `depthWrite: false`
   and no outline. Cheaper than real leaf shadows and they read better.

**Light harmony is three decisions, and they belong together** (details in
`cel-shading-pipeline` L3):

- one warm key that is the only shadow caster;
- one **cool fill at ~50 % of the key** — quantised shading tints direct light only, so
  this lamp is what keeps shadows readable and coloured rather than dark;
- a hemisphere whose **ground colour is chromatic**, not grey.

Every area shares those three. An area that sets its own lights is a room.

---

## L6 — Transitions between areas

Two kinds, and they are used together:

**Continuous (walked).** The seam is physical: the ground, the ambience bed and the
palette all change over a distance, and nothing snaps. Ambience uses overlapping spheres
with a margin (see `game-audio-layering`); ground uses masks (L1); planting density and
species change over 15–25 m, which is the scale at which a typical view holds 4–5 patches.

**Cut (camera moves, story beat, fast travel).** Then a **wipe** is the most legible
"this is animation" cue available, and it costs one full-screen pass:

```glsl
float inc1 = 0.3 * uWipe1;                       // inclination scales with progress
float uv1  = vUv.y - (1.0 - vUv.x) * inc1;
color = mix(color, uWipeColor, falloff(uv1, 1.0, -inc1, 1e-6, uWipe1));
// a second wipe with the mirrored inclination reveals the new scene
```

Two independent 0→1 uniforms (`uWipe1` covers, `uWipe2` reveals) plus an overlay colour and
a flash driven by vibrance + brightness/contrast rather than a white fade. Object-level
appearance during a transition uses a **dissolve**, never alpha — see
`cel-shading-pipeline` L7.

---

## L7 — One district policy for roads, plots, terrain and density

When a procedural world has named spatial regimes (town, settlement, approach, wild), encode
them once as data and make every generator query that same policy. A district is not a colour
label added after generation; it is a shared set of constraints:

```js
const DISTRICT_POLICY = Object.freeze({
  town:       { roadDensity: 1.0, plotChance: 0.9, flatten: 1.0, propDensity: 0.8 },
  settlement: { roadDensity: 0.6, plotChance: 0.55, flatten: 0.7, propDensity: 1.0 },
  approach:   { roadDensity: 0.35, plotChance: 0.2, flatten: 0.35, propDensity: 0.7 },
  wild:       { roadDensity: 0.08, plotChance: 0.0, flatten: 0.0, propDensity: 0.45 },
});
```

The numbers are illustrative; measure them for the project. The invariant is that road growth,
plot admission, terrain flattening, traffic eligibility and decorative density receive the same
district id. Do not duplicate these thresholds in five modules.

Evaluate policy from stable world-space fields or frozen authored boundaries. If a border needs
softness, interpolate a deterministic influence value while retaining one categorical owner for
identity and de-duplication. This prevents a plot from being admitted by the town rule while its
foundation is shaped by the wild rule.

Audit cross-consumer agreement at sampled points: district id, flatten weight, road permission
and plot permission must be mutually compatible. Also render both sides of every boundary; a
correct data classification can still produce an abrupt perceptual seam.

Method source: `winchxyz/bikini-bottom` `src/gen/world.js` and `src/gen/city.js`.

---

## Verification

**Every seam bug in this skill threw nothing, logged nothing, and looked correct in a
screenshot.** The three tools that actually find them:

1. **A connectivity flood fill** on a 0.35 m grid with the player's own radius and step
   height, keyed on **(cell, height bucket)** — see `walkable-level-verification`. It finds
   sealed thresholds, blocked links, and props that close a lane. Re-run it after adding
   furniture *anywhere*, not just in the area you touched.
2. **A linear trace along a route**, carrying the feet height forward the way the player
   does. This is the only thing that finds an unowned threshold between two areas: a walk
   at 0.15 m steps prints the fall in one line.
3. **A downward ray onto the rendered mesh**, compared against the height query. Finds the
   whole "reference plane is not the ground" family.

And one diagnostic worth internalising: **a pale surface filling half a frame is worth one
raycast, not three guesses.** Render, `camera.updateMatrixWorld(true)`, fire a ray at the
middle of it, read back the mesh name and its parent. Guessing from the shape was wrong
three times out of three.

---

## Symptom → cause

| Observed | Cause |
|---|---|
| Ground tile joins visible as a grid | Tiled ground with per-tile colour; move to masks on one surface, or give the whole family one `surfaceId` |
| A boundary between ground types has no line | Masks not folded into `surfaceId` |
| Paving flickers between two tones as the camera moves | Two coplanar slabs — butt them, or stop one 0.10 m short |
| A notched corner of bare ground at a junction | Junction paved to two centre lines instead of three different lines |
| A wedge of grass across a car-park entrance | Kerb run not split where vehicles cross |
| The player falls through a doorway between two areas | Unowned threshold — one area's platform ends before the next begins |
| A flood fill stops partway up a staircase a walk completes | Platform boxes meet instead of overlapping |
| Props float or sink by a constant amount | Seated from the profile instead of the dressed ground query, or the mesh is drawn off the reference plane |
| The lower ground surface pokes through the road | A displacement applied to one of two co-located surfaces |
| A district reads as a room | Its own lights, or its own fog, or a wall/hedge closing every sight line |
| The background turns into a wireframe at mid distance | Fog range and line-fade range disagree |
| A ring where the sky meets the ground | Far grade / fog colour / dome bottom stop not agreeing |
| A viewpoint's view is one tree | Keep-out disc instead of a widening corridor |
| A transition between areas feels abrupt | No wipe and no ambience overlap — the two halves of the same problem |

---

## Reference implementations

Both shipped projects below implement what this skill describes, and **neither of them
tiles the ground** — which is the load-bearing observation in L1. `WebFetch` gets 403 on
both sites; use `curl` / `gh`.

**sakura-crossing** — 26 districts on a small planet, all walkable and connected, verified
by flood fill. Its `AGENTS.md` trap table is the single densest source of seam bugs
available anywhere, and every row is a bug that threw nothing and looked correct.

```bash
git clone --depth 1 https://github.com/Kenton-GMI/sakura-crossing.git /c/tmp/sk
#                                                                    ↑ short path: a deep
#   temp dir fails on Windows with "cannot write keep file … Filename too long"
```

**messenger.abeto.co** — small-planet delivery game; one terrain mesh with shader masks,
and full-screen wipes between beats.

```bash
curl -sSL --ssl-no-revoke https://messenger.abeto.co/ -o msg.html   # read the App3D-<hash>.js name
curl -sSL --ssl-no-revoke https://messenger.abeto.co/assets/App3D-<hash>.js -o App3D.js
```

**Read for this skill:**

| What | Where |
|---|---|
| Masked single-surface ground: element ids, grass/wet masks, palette-strip UVs | messenger — the `IS_TERRAIN` branch of the block with `uSkinColor, uShowChars, uWetHeight …` |
| Diagonal wipes, overlay and flash | messenger — the block with `uWipe1, uWipe2, uWipeColor, uOverlay, uOverlayColor, uFlash` |
| Ambience spheres with margins (the audible half of a walked transition) | messenger — `grep 'ambianceSpheres'` in the raw bundle |
| **The seam trap table** — coplanar coin tosses, junction paving, kerb splits, unowned thresholds, platform overlap, the reference-plane bug | sakura — `AGENTS.md`, "Traps that have already bitten" |
| Build order as a dependency; "a district returns its planting" | sakura — `AGENTS.md` "Conventions"; `src/world/index.js` `districts` array |
| The civil-works kit every area reuses (`pad`, `lane`, `steps`, `wallRun`, `dapple`) | sakura — `src/world/ground.js` |
| Two ground surfaces sharing every displacement; terrain grid chord excess | sakura — `src/world/street.js`, and the `RELIEF`/`TERRAIN_DROP` rows of the trap table |
| Horizon budget, fog matched to line fade, distant hill flats | sakura — `src/core/sky.js`, `src/world/planet.js` header |
| How routes are actually verified (flood fill, linear trace, downward ray) | sakura — `NEXT.md` "How to check a route — do this before you believe one" |
