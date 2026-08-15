---
name: anime-line-control
description: Decide where ink lines appear and where they must not — per-fragment outline contribution written into an info buffer, surface-ID edges, normal/depth/ID detectors with independent thresholds, noise-broken strokes, shared-depth canopies, underwater suppression. Use when outlines are missing, everywhere, noisy, drawn on the ground/foliage/water, when a hedge inks every leaf, or when asked to make line work look drawn rather than computed.
license: MIT
compatibility: Three.js r160+ / WebGL2 (MRT required for the info-buffer path)
---

# Anime Line Control

An anime background does **not** outline everything with an edge in it. It outlines what
the artist chose. "Which pixels get a line" is therefore an **authored property**, not a
side effect of an edge detector — and the way to author it is a channel in a G-buffer.

Method sources: `messenger.abeto.co` (`outline()` in the composite pass, `gInfo` written by
every scene material), sakura-crossing `src/core/post.js` + `src/core/outline.js`.

> This skill covers **where lines go**. For the material/light/grade side of the anime look
> see `cel-shading-pipeline`; for what geometry does to line density see
> `procedural-object-detail`.

---

## The model

```
scene pass ──► RT0  rgb = colour        a = surfaceId       (material identity)
           ──► RT1  r   = packed depth  gb = encoded normal  a = outlineContribution
composite  ──► three independent detectors over RT0.a / RT1.gb / RT1.r
           ──► × outlineContribution   ──► × distance fade  ──► mix(scene, inkColour)
```

Four separate things decide a line, and each one is tunable alone:

| Signal | Source | Draws |
|---|---|---|
| **ID** | `RT0.a` — one float per material/surface class | Boundaries between *materials* on continuous geometry (grass↔rock, wet↔dry, paint↔asphalt) |
| **Normal** | `RT1.gb` — spheremap-encoded view normal | Creases on continuous geometry (roof ridge, kerb, wall corner) |
| **Depth** | `RT1.r` | Silhouettes — one object in front of another |
| **Contribution** | `RT1.a` — written per fragment by the material | **The veto and the amplifier.** 0 = never ink this |

`clamp(id + normal + depth, 0, 1) * contribution`.

**This is the whole answer to "why do some places have lines and some not".** Not the
threshold — the fourth channel.

---

## L1 — `outlineContribution`, the authored channel

Every scene material writes it. Reference patterns, all of them measured against a real
failure:

```glsl
float outlineContribution = 1.0;

#if defined(IS_DISABLED)
    outlineContribution = 0.0;             // whole object opts out
#endif

// terrain: break the stroke with noise so it reads as drawn, not as a contour map
outlineContribution *= step(0.3,  triplanarNoise.r);
outlineContribution *= step(0.13, triplanarNoise.g * triplanarNoise.b);

// characters: a sketchy contour that skips, keyed on *local* position so it
// travels with the body instead of swimming through it as the body moves
float n = sinenoise1(lPos * 12.0 + vec3(3.324, 34.2, 56.343) * surfaceId) * 0.5 + 0.5;
outlineContribution = step(0.3, n);

gInfo = vec4(packedDepth, encodeNormalSpheremap(geometryNormal), outlineContribution);
```

- **Break the stroke with a noise field, not with opacity.** A line at 60 % alpha reads
  as a soft line. A line that is *absent* for 30 % of its length reads as a pen lifting.
- **Key the character noise on local position** (`lPos`), never world or screen position.
  World position makes the gaps crawl over the model as it walks; screen position makes
  them boil.
- Terrain uses **two** noise gates at different scales: one breaks up long contours, one
  thins the total density. One gate gives evenly-dashed lines, which reads as a texture.

### The nearest-surface override

The contribution that wins at a silhouette must be the **occluder's**, not the
background's — otherwise an object with `contribution = 0` still gets outlined by the
sky behind it:

```glsl
float minDepth = centerDepth, minContrib = centerContribution;
for (int i = 1; i < 5; i++)
    if (depths[i] < minDepth) { minDepth = depths[i]; minContrib = contributions[i]; }

if (minDepth < centerDepth) {
    if (minContrib > centerContribution) centerContribution = max(centerContribution, ceil(minContrib));
    else                                 centerContribution = min(centerContribution, floor(minContrib));
}
```

`ceil`/`floor` make it a **hard** decision. A lerp here gives half-strength haloes round
everything that neighbours an opted-out surface, which is the exact artefact the channel
exists to remove.

---

## L2 — Surface ID: lines without geometry

`RT0.a` carries a per-material float. Two consequences worth designing around:

1. **A material change draws a line on flat geometry.** Terrain adds its masks into the
   ID *after* shading:

   ```glsl
   surfaceId += striations * (1.0 - grassMask);
   surfaceId += grassMask * 0.1;
   surfaceId += wetMask   * 0.12;
   ```

   That is how a smooth hillside gets ink between grass and rock, and a beach gets a line
   at the waterline, with no extra geometry and no decals.

2. **Objects that must not ink against each other share an ID.** Give a whole ground-cover
   family one ID and the seams between its tiles produce `idVariation ≡ 0` — the boundary
   is not suppressed, it *does not exist*.

Allocate IDs so no two ever collide numerically (`(k*23 & 63 + 0.5)/64` walks a 64-slot
ring), and reserve one fixed value for the ground family.

**ID edges must fade out at low resolution.** At small render sizes the ID buffer is the
noisiest of the three, so scale it separately:

```glsl
idContribution = mix(idContribution * idMinScale, idContribution, clamp(scale, 0.0, 1.0));
```

---

## L3 — Three detectors, three thresholds

```glsl
vec2 dirs[5] = vec2[5](vec2(0,0), vec2(-1,0), vec2(1,0), vec2(0,-1), vec2(0,1));
vec2 offset  = 1.0 / vec2(textureSize(tInfo, 0)) * outlineWidth * scale;
// sample RT0.a, RT1.r, RT1.gb at all five taps

vec2 idVar     = vec2((id[1]-c) - (id[2]-c), (id[3]-c) - (id[4]-c));
vec2 depthVar  = vec2((d[1]-dc) - (d[2]-dc), (d[3]-dc) - (d[4]-dc));
vec2 normalVar = vec2(distance(n[1],nc) - distance(n[2],nc),
                      distance(n[3],nc) - distance(n[4],nc));
// length() each, then fit(fit(v, range.x, range.y, 0,1), range.z, range.z+margin, 0,1)
```

Two structural points:

- **The opposed-tap form `(left − centre) − (right − centre)` is a second difference.** It
  is zero on any plane however oblique. A first difference (a depth Sobel) is large on
  every grazing surface, so the road floods with ink. This is the same conclusion sakura
  reached from the other direction; both projects converged on it independently.
- **The depth threshold is modulated by the centre normal's z:**

  ```glsl
  float depthLimit = depthRange.z + 1.0 - centerNormal.z;
  ```

  A surface turned away from the camera has a large legitimate depth gradient, so it needs
  a higher bar. Without this term, ground planes and long walls ink along their length.

`fit(fit(...))` is deliberate: the inner remap sets the **working range** of the signal,
the outer one sets the **threshold and its softness**. Collapsing them into one
`smoothstep` costs you the ability to move the threshold without also changing the
contrast.

### Resolution and distance

```glsl
float resScale = min(1.0, resolution.y / 1300.0) * uOutlineScale;   // sample radius
centerContribution *= fit(viewZ, fadeStart, fadeEnd, 1.0, 0.0);     // distance fade
```

Line width must be a **pixel** quantity. Scale it with resolution or a 4K frame gets
hairlines and a phone gets a marker pen. Fade with distance so the background dissolves
into haze instead of turning into a wireframe.

---

## L4 — Cases that need special handling

### Foliage: one depth per canopy

Leaf cards are individually silhouetted, so a tree inks into a pile of separate dark
polygons. The fix is to **write the whole canopy's depth from the trunk cluster centre**,
not from the card:

```glsl
vec4 centrPos = projectionMatrix * modelViewMatrix * vec4(centr_tree, 1.0);
vHighPrecisionZW = centrPos.zw;      // every leaf of this tree reports the same depth
```

Depth variation inside the canopy is now zero, so the detector sees one mass with one
silhouette — which is how blossom and foliage are actually drawn. Cheaper and better than
any threshold tuning.

The alternative, when cards are not an option, is sakura's: give a dense mass a **solid
dark core box** and seat blobs only on the top and outer faces, where they break the lit
silhouette.

### Water: no lines under the surface

A submerged silhouette read through water reads as a crack in the water:

```glsl
float waterDepth = getLinearDepth(1.0 - water.a, near, far);
float underwater = isWater;
if (nearestDepth < waterDepth) underwater = 0.0;     // occluder is in front of the water
vec3 outlineColor = mix(uOutlineColor, sceneColor, underwater);   // i.e. no line
```

Requires the water pass to write its own depth into its alpha and composite before the
outline. Same structure works for glass, fog volumes and anything else that should soften
what is behind it.

### Sprites and 2D layers: outline in colour space

For UI, decals, emoji bubbles and other flat layers there is no depth or normal, so run a
**colour-difference** outline over the sprite's own render target:

```glsl
delta.x = max(max3(abs(left - centre)), clamp(abs(leftA - centreA), 0.0, 1.0));
// ... four directions, take the max
color = mix(centre, uOutlineColor, smoothstep(uThreshold, uThreshold + uSmoothMargin, maxDelta));
```

Two escape hatches that are worth copying: `if (maxAlpha == 0.0) discard;` (early out on
empty regions) and **a negative colour channel as an opt-out flag** — a sprite drawn with
any component below zero is passed through un-inked, which lets one shader serve both
outlined and un-outlined sprites with no branch on the CPU side.

### Hero props: inverted hull

The screen-space pass gives a uniform line. A few objects want a heavier, deliberately
drawn contour — see `cel-shading-pipeline` L4 for the clip-space shell. Reserve it for
3–5 objects: each shell is a draw call, and the scene is draw-call bound.

---

## Buffer discipline (each of these fails silently)

| Rule | Symptom if broken |
|---|---|
| **Declare the MRT output unconditionally in every material entering the scene pass** | WebGL2: an enabled draw buffer with no matching output is `INVALID_OPERATION` and **the whole batch is not drawn**, with nothing in the console. Declaring an output with no draw buffer attached is legal — the asymmetry is why you declare always |
| Clear attachment 1 explicitly (`clearBufferfv(COLOR, 1, [0,0,0,0])`) | `clear()` uses the renderer's clear colour on *every* attachment, so the "no object here" sentinel is whatever the sky is |
| Sentinel must be checked on **all** channels before trusting the info buffer | Half-written texels ink the sky |
| `NearestFilter` on any depth texture read by a detector | Linear filtering invents depths between surfaces; a second difference amplifies them into false edges |
| Encode the normal (spheremap into two channels), do not store three | You need the fourth channel for contribution, and that channel is the entire point |
| Thin/transparent meshes `depthWrite: false`, and mark them no-outline | Petals, cables and rain get outlined into speckle |
| Keep `geometry.groups` through any pass that rebuilds geometry | A multi-material mesh with a material array and no groups is **not drawn at all** — it does not fall back to `material[0]` |

---

## Symptom → cause

| Observed | Cause |
|---|---|
| Everything has a line, frame reads as a wireframe | No contribution channel — you have an edge detector, not a line control system |
| Ground/road floods with ink | First difference instead of opposed-tap second difference, or missing the `1.0 - centerNormal.z` depth-limit term |
| A hedge/tree is a pile of dark polygons | Every leaf card reports its own depth; write the cluster centre's depth for all of them |
| Lines are perfectly even and read as a contour map | No noise gate on `outlineContribution` |
| Gaps in a character's outline swim over the body as it walks | Noise keyed on world or screen position instead of local |
| Half-strength haloes round objects that neighbour un-inked surfaces | The nearest-surface override lerps instead of `ceil`/`floor` |
| An object opted out of outlines still has one against the sky | Missing the nearest-surface override entirely |
| Lines vanish on a phone / are hairlines at 4K | Sample radius in UV, not scaled by resolution |
| Lines under the water surface | Water composited after the outline, or no depth written into the water pass alpha |
| An entire batch of objects stops rendering, console empty | A material in the scene pass does not declare the MRT output |
| Sky picks up lines | Info-buffer attachment not cleared separately, or no sky-depth early-out |
| Grass↔rock boundary has no line although the tones differ | Material masks are not being folded into `surfaceId` |

---

## Reference implementations

Both shipped projects below implement what this skill describes. Open them when a rule
here is not enough. `WebFetch` gets 403 on both sites — use `curl` / `gh`.

**sakura-crossing** — cel-shaded Japanese neighbourhood on a small planet; Three.js,
vanilla ES modules, no image assets. One squashed commit, so the tree *is* the history;
its `CLAUDE.md` trap table and `NEXT.md` carry as much as the code does.

```bash
git clone --depth 1 https://github.com/Kenton-GMI/sakura-crossing.git /c/tmp/sk
#                                                                    ↑ short path: a deep
#   temp dir fails on Windows with "cannot write keep file … Filename too long"
```

**messenger.abeto.co** — small-planet delivery game; Three.js + Svelte, no public source,
but the shipped bundle carries its GLSL verbatim in template literals.

```bash
curl -sSL --ssl-no-revoke https://messenger.abeto.co/ -o msg.html   # read the App3D-<hash>.js name
curl -sSL --ssl-no-revoke https://messenger.abeto.co/assets/App3D-<hash>.js -o App3D.js
# extract every template literal containing `void main` — 220 blocks, of which ~80 declare
# `u*` uniforms and are the app's own rather than three.js chunks. Identify a block by its
# uniform list; grep the raw bundle by name for a standalone GLSL function.
```

**Read for this skill:**

| What | Where |
|---|---|
| The whole detector, including the nearest-surface override | messenger — `grep 'float outline('` in the raw bundle, then take the enclosing template literal |
| The composite that calls it (plain, and the water-aware variant) | messenger — the two blocks whose uniforms include `uOutlineThickness, uInfoRange, uDepthRange, uNormalRange, uSmoothMargin, uInfoMinScale`; the second also has `tWater` |
| Where `outlineContribution` is authored per fragment | messenger — the block with `uSkinColor, uShowChars, uWetHeight, uMouthColor, uIsTalking, uNPCSeed` (its `IS_TERRAIN` / `IS_CHARACTER` branches and the final `gInfo = vec4(...)`) |
| One depth per canopy | messenger — the block with `uLeavesShake, uShakeSpeed, uScale`; look at `vHighPrecisionZW` being taken from `centr_tree` |
| Colour-space outline for 2D layers | messenger — the block with `tMap, uThreshold, uSmoothMargin, uOutlineColor` (note the negative-channel opt-out and the `discard` early-out) |
| The depth-only alternative (no info buffer) | sakura — `src/core/post.js`, `INK_SHADER`; and `README.md` "How the 3D-to-2D look is built" for why it is a second difference |
| Inverted hull for hero props | sakura — `src/core/outline.js` |
| What geometry does to line density | sakura — `CLAUDE.md` trap table, the rows on canopies, thin meshes and `geometry.groups` |
