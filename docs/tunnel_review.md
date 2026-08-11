# Tunnels, underpasses and galleries — portal transparency and structural review

> Merges the former `tunnel_portal_plan.md` (portal transparency, shipped 2026-07-23) and
> `docs/tunnel_review_0731.md` (two-round multi-angle structural review, 2026-07-31 and
> 2026-08-01). **All of it is closed work**; the rules it produced live in `CLAUDE.md` A29/A6b and
> the headers of `tools/audit_open_tunnel.mjs` / `audit_underpass.mjs`. Kept here: the root cause
> that explains the design, the invariants, and the items deliberately left undone.

## 1. Why a portal used to be a black plate

The map is a **heightfield** — one height per `(x,z)` — which structurally cannot express "mountain
above, bore below". Tunnels therefore use a *真下沉* design: over a covered section the mountain
surface is kept as-is (it **is** the tunnel roof) and the road plus an opaque ceiling are laid
underneath it; only the open approach cuttings dig the surface down to road level.

The price is that at the portal the surface must drop from mountain height to road height, and that
one-cell-wide (~8.3m) cliff face stands across the tunnel cross-section, below the ceiling, where
neither the side walls nor the ceiling can hide it. The old solution was a **dark plate** — an
opaque, outward-facing (FrontSide) plane inside the portal opening. Neither shortcut works: remove
the plate and you look straight into the earth wall; dig the covered section down too and the
mountain disappears (a heightfield cannot overhang) — it becomes an open trench, not a tunnel.

The interior is a **fully sealed opaque box** (road ribbon floor over the whole run, DoubleSide side
walls and ceiling over the covered section, always-on emissive ceiling lamps, all with
`frustumCulled=false`), which is why punching the earth wall reveals the interior rather than the
sky.

## 2. What shipped: grid holes + a portal collar

1. **Regular grid holes** — per portal, take the terrain cells the bore covers and delete triangles
   from the **draw** index. Grid-aligned, purely geometric, no `rnd`.
2. **A portal collar** — an opaque funnel skirt lofted from the ragged grid edge to the bore
   rectangle (floor→ceiling, ±hw), reusing the existing portal concrete `envMat`. It closes the
   sawtooth gap between square cell edges and a diagonal bore, and reads as a genuine headwall/wing
   wall (a corner can span about one cell, ~8m — the collar is a real structure, not trim).
3. **The dark plate was demoted to a fallback**, re-attached only when `touched[pi]` is false.

### Invariants (MUST)

1. **Only draw triangles are deleted; `heights[]` is untouched** — `heightAt`, collision and fog LOS
   all read the array, not the triangles. Purely visual: units still cannot shoot or walk through
   the mountain. (Verified: post-punch `heightAt` is bit-identical to before.)
2. **Determinism** — hole selection is pure geometry over one cached copy of the map data, so every
   client punches the same hole (CLAUDE.md §2.3).
3. **No new dependency, no build step** — the collar is procedural geometry on an existing material.
4. **`heights[]` unchanged ⇒ no re-bake** — `REAL_SCALE`/`GEO_SCALE_VER` untouched, `venueLanes`
   unaffected.

### Four places the implementation had to overrule the plan

1. **The ground-cover layer must give way too** (the plan missed it): the landcover carpet and its
   detail instances are a **separate layer**, so digging only the terrain still leaves a patch of
   grass pasted on the cliff face. `punchPortalHoles(bores, covers)` therefore also takes the
   `buildGroundCover` children and applies the same yardstick (mesh punched / InstancedMesh scaled
   to zero).
2. **The collar *is* DoubleSide**, contradicting the plan's MUST NOT. That prohibition targets a
   plane **crossing the tunnel cross-section** — get that one's facing wrong and exiting the tunnel
   shows a black wall. The collar's outer ring lies on the terrain and its inner ring hugs the bore
   wall, so it is geometrically always outside the tube and can never cross the section; single-sided
   would instead mean one mis-wound face = a see-through hole. Watertightness wins; normals are still
   oriented from a reference point above the portal so lighting is right.
3. **"Did the punch succeed" must be read from `touched`, not `rims`.** In a parallel twin-bore
   tunnel the two portals sit 3–6m apart with heavily overlapping bores, and the shared triangles are
   claimed by the first portal only. The second then sees an empty `rims`, concludes failure, and
   re-attaches its black plate — directly behind the first portal's opening (2 of 8 portals at
   jinlong).
4. **Two long-standing road bugs only became visible once you could see inside** and were fixed in
   the same batch: (a) a structural tunnel is **always asphalt** — road biome is classified from the
   midpoint satellite pixel, and a tunnel's midpoint samples the **mountain above the covered
   section**, so it was being paved as a dirt track; (b) tunnels **do** get lane markings — the old
   code skipped `!strc` entirely because ground-sampled markings would be painted on the hilltop, so
   the fix is a baseline-height parameter on `putMark`/`emitLine` (fed `tFloorAt`, same source as the
   road ribbon), **not** a loosened guard. Street lamps must still be skipped (`!strc`) — the poles
   would spear the ceiling; interior lighting is the ceiling lamps.

## 3. Structural review

Method: `tools/shot_tunnels.mjs` — 24 images per structure (outside 60m/25m head-on, ±45° obliques,
inside looking back, 20m/45m looking out, upward, six directions from mid-bore, cross and axial
aerials) plus five quantitative scans: ①cross-section terrain residue ②sky visible at the portal
③cross-section obstruction by any object ④see-through from above ⑤hemisphere sky sampling inside.

Round 1 (2026-07-31) used synthetic ways in the sandbox; round 2 (2026-08-01) used real Overpass
data on this machine (see `CLAUDE.md` and the memory notes for the User-Agent / global-Playwright
setup). Venues: mountain tunnel = Taipei Jinlong; gallery = Taroko Yanzikou; underpass = Taipei
Civic Blvd.

**Verdict: the structures themselves behave as designed.** Seven real defects were found and fixed;
each has an audit assertion and a reverse-verification.

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | A wedge of terrain stuck in the gallery end cross-section ("a rock in the tunnel") | The punch test was "**any vertex** inside the corridor"; an ~8.3m cell can straddle the section with all three vertices outside | Triangle × corridor-rectangle **overlap** (2D SAT). Vertical bounds untouched |
| 2 | Earth-coloured slivers floating just inside the portal | The corridor's longitudinal bound stopped at the portal plane, so the cell **outside** still leaned into the section | Portal bores carry `out = TUN.MOUTH_OUT` (~one cell); gallery bores keep 0 (their "outside" is the neighbouring segment) |
| 3 | Road width jumps at the portal | Inside the structure the section is central carriageway + lay-by verges out to `strucHw`, but the outside flare only paved asphalt | The verge shrinks on the **same `fhw`** as the flare; the carriageway edge never moves |
| 4 | Props hanging over the cutting edge | Corridor clearance radius `hw + 4` was narrower than the excavation footprint | Structural runs use `hw + STRUCT_CLEAR_PAD`; bridges keep `hw + 4` (different semantics) |
| 5 | Giant trees intruding into the section | `placeGiantGroves` clearance asked `blocked.has(cellKey)` — **the centre cell only**, on a 10m grid, while a trunk radius can exceed 10m | Named footprint radius `foot = def.r * s * 1.6` as a single seam shared by `sinkBaseY` and `areaFree`; the rejection test moved **after** the size draw (§2.3 sampling discipline) |
| 6 | A 1m residual ring outside the gallery eaves with street trees standing on already-excavated ground | `STRUCT_CLEAR_PAD` was a hand-written 8 while the widest of three excavation footprints is `hw + TUN.GAL_CLEAR_W` (9) | `STRUCT_CLEAR_PAD = max(7, UND.COPE, TUN.GAL_CLEAR_W)` — derived, never hand-written |
| 7 | **A dark brown slab rising from the floor to the ceiling, read by eye as a fallen tree trunk** — the last piece of the long-reported "something stuck in the tunnel" | `punchPortalHoles` deletes terrain triangles and cover instances; **the road ribbon is a different mesh** and was never in scope. Where a section is classified as a gallery the premise is that the surface lies between floor and roof — so another road's ribbon on the hillside lay right across the bore | Ground-level road ribbons and markings do not emit faces inside **another** road's bore. `inTunBore` consumes the **same corridor list** `markGradeCorridors` returns (plus a derived roof underside `cy = tunFloorAt + TUN.CLEAR`) — never a second tunnel profile computed in `buildRoads`. Three rules: ground segments only (`!strc && !brg`); passing **above the roof is always allowed** (a road on the hill over a tunnel is the whole point); vertices are still emitted, only faces are dropped, so indices — and therefore layout and downstream flare bases — do not shift. All three consumers (ribbon index, solid lines, dashed lines) are gated |

Identification technique worth reusing: when something is stuck in a section, ray-hit
characteristics name the culprit — instanced or not, `vertexColors`/`map`/`polygonOffset` presence,
vertex count, material colour, bounding-box extent. Defect 7 was identified as the green-minor-road
ribbon batch purely from `0x77603f` + `polygonOffset` + a map-wide bounding box.

## 4. Known non-defects

- **Sky visible between gallery columns** (23–59 of 240 samples) is the design — the columns are
  transparent and passable, and both ends judge it the same way.
- **Two "cross-section obstructions" at Jinlong** sit dead centre of the portal at 7.2/7.4m against
  `hw=8`: the **portal frame itself** narrowing the section by 0.8m, inside the scan's `hw − 0.6`
  threshold. A known false positive of the scan.
- **The grey stepped wedges either side of a portal** are the hillside excavation face outside the
  ±hw corridor — `punchPortalHoles` only clears inside the corridor and `carveTunnels` deliberately
  keeps a sloped band within `PROT_M` of the cover transition, because that band is the reference
  surface for the punch and the collar (`audit_open_tunnel` Ⅴ-a pins it). On real data it reads as
  slope revetment continuous with the headwall. **Ruled: leave it alone** — widening it would move
  the collar's reference surface and break Ⅴ-a for no real gain.

## 5. Still open

- **No headwall on a fully covered gallery's end faces** — closed as **will not fix**. Both real-data
  venues (Jinlong 21 gallery segments / 4 portals; Yanzikou 76 / 8) failed to reproduce it: real OSM
  tunnel chains always have buried segments at their ends, so gallery segments fall mid-chain. It is
  specific to synthetic ways (which are gallery end to end). Changing it means touching the portal
  condition `c0 >= 4 / c1 <= total − 4`, which moves the `userData.portals` count invariant and the
  `TUN.PORTAL_MAX` budget. **Reopen if it is ever seen on real data.**
- **"See-through from above" has no trustworthy number yet.** The reported 1453/63180 at Yanzikou was
  a measurement artefact: the sampling frame is "structure-chain bounding box + 40m" and that chain
  hugs the map edge, so the extra columns fell **off the map** where there is no terrain (proof: 59
  of the first 60 hits lie on one complete column at `x = 789.4` — a real hole does not form a
  north-south line). The frame is now clamped inside the terrain, but the ~2h run has not been
  repeated.
- **Underpasses have never been run on real data** (Civic Blvd's mapped underpass is a service way,
  which `underpassPlan` has always declined). Their round-1 scans were all zero.
- **No in-game smoke test** — this was all offline scene building and screenshots; nobody has walked
  or fired inside a bore in a real session.
