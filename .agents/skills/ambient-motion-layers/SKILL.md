---
name: ambient-motion-layers
description: Make a still scene feel alive — wind sway in the vertex shader, falling and fallen blossom, stylised water as flat layers from a depth field, quantised foam bands at a shore, drifting clouds, and the speed/period rules that separate "a place with weather in it" from "a screensaver". Use when a scene looks frozen or looks busy, when adding wind/petals/leaves/water/waves/foam/clouds/ripples, or when animated geometry flies off after a bake.
license: MIT
compatibility: Three.js r160+ / WebGL2
---

# Ambient Motion Layers

Ambient motion is judged on two axes at once: **is anything moving** and **can you follow
it**. Both failures look bad and they have opposite fixes.

> The threshold, measured: a lake surface drifting at **0.5–1.1 m/s** with a **10 s**
> ripple cycle is under the speed the eye tracks and over the speed at which the water
> looks frozen. Anything faster is a swimming pool; anything slower is a photograph.

Method sources: sakura-crossing `src/world/{petals,lake,details,trees}.js`, `src/core/sky.js`;
`messenger.abeto.co` leaf and water shaders.

---

## L0 — One clock, one wind

Every swaying thing in the world reads **one** time value and **one** wind direction.
Two clocks give two rhythms in the same frame and it reads as two engines.

```glsl
float shake = sinenoise1(vec3(centr * 2.0) + vec3(-time * 0.1 * uShakeSpeed,
                                                   0.0,
                                                   time * 0.15 * uShakeSpeed))
            * PI2 * uLeavesShake * mix(0.25, 1.0, rand.y);
```

- **Phase from world position, amplitude from a per-instance random.** Phase-from-position
  is what makes a gust *travel*; amplitude-from-random is what stops every plant moving the
  same distance.
- The two time coefficients differ per axis (`-0.1`, `0.15`) so the noise field drifts
  diagonally rather than sliding along one axis.
- A separate, larger-wavelength **gust envelope** rides on top: `1 + F·sin(...)` so its mean
  is exactly 1 — it redistributes amplitude, it does not secretly increase it. The gust
  wavelength must be **much** larger than the sway wavelength; at the same order the two
  layers beat against each other and read as noise.

---

## L1 — Vegetation sway is vertex-only

**Never move a swaying plant on the CPU, and never let it touch the authoritative world.**
Sway is a vertex displacement; colliders, heights, gameplay and the server see nothing.

Leaf cards (see `procedural-object-detail` L1b-B1) get three stacked motions:

```glsl
// 1. per-card rotation about the view axis, from the shared noise field
rot = rotateZ(fit(rand.z, 0.0, 1.0, -PI2, PI2) + shake);

// 2. a small positional wobble on two orthogonal view axes at different rates
vec3 shakeX = right * sin((centr.x + centr.y) * 2.0 + 534.35 + time * 1.1)  * 0.025;
vec3 shakeZ = back  * sin((centr.z + centr.y) * 2.0 + 543.55 + time * 0.55) * 0.025;

// 3. displacement from a moving character
float distToPlayer = length(charPos - centr);
float disp = fit(distToPlayer, 0.0, fit(charSpeed, 0.0, 0.001, 0.0, 0.85), 1.0, 0.0)
           * fit(charSpeed, 0.0, 0.15, 0.0, 10.0);
if (length(disp) > 0.001) rot = rotateZ(sin(disp) * 0.15 * sign(rand.w - 0.5)) * rot;
```

Layer 3 is the one people notice and almost nobody implements: **the radius of the
disturbance is a function of the character's speed**, so walking parts the grass slightly
and running throws it. `sign(rand.w - 0.5)` makes half the cards go each way, which reads
as displacement rather than as a wave.

For cloth on a rig, the waveform is a **slow lift with a small flutter riding on it**:

```js
const s = Math.sin(t * rate + phase) * 0.75 + Math.sin(t * rate * 3.3 + phase) * 0.25;
pivot.rotation.x = base + s * amp;
```

Vary `rate`, `phase` and `amp` per piece. Eight pieces on one rate is a mechanism.

---

## L2 — Falling particles (blossom, leaves, snow, ash)

```js
const s  = Math.sin(t * p.swayFreq        + p.phase);         // large slow wave
const s2 = Math.sin(t * p.swayFreq * 2.7  + p.phase * 1.7);   // small fast flutter
p.y -= (p.fall + gust * 0.4) * dt;
p.x += (p.swayAmp * s  * 0.55 + p.drift + wind * 0.24) * dt;
p.z += (p.swayAmp * s2 * 0.32 + wind * 0.05) * dt;
p.y += lift * Math.max(0, 1 - Math.abs(p.z) / 8) * dt;        // updraught near the feature
p.angle += p.spinRate * dt * (1 + gust);
```

Eight rules, each from a specific failure:

1. **Two frequencies, not one.** One sine reads as noise; a slow wave with a fast flutter
   on it reads as air.
2. **Tumble on a per-particle random axis** (`setFromAxisAngle(p.spin, p.angle)`), not
   about Y. A field of petals all spinning about Y is a field of coins.
3. **Wrap relative to the feature's centreline**, not to world axes — otherwise a drifting
   field slowly leaves the road it is meant to be over.
4. **Restrained density.** Enough to catch the light across the frame, never enough to
   obscure it. ~1000 particles over a 19 × 64 m volume is the reference figure.
5. **Three tones**, split ~55/28/17. One tone is confetti.
6. **`depthWrite: false`, `noOutline`, `renderOrder` above the world**, or the line pass
   outlines every particle into speckle.
7. **Pre-warm at build**: step the update ~40 × 0.1 s so the very first frame already has
   particles mid-air. A scene that starts with an empty sky and fills up over ten seconds
   is the tell that this was bolted on.
8. **A gust is an input, not an internal state.** Pass `(gust, gustDir)` in from whatever
   causes it (a train passing, a door opening, a rotor). The whole field takes the shove
   together, which is what makes the cause legible.

**Fallen particles are a separate, static system**, and they are what stops a wide stretch
of ground reading as a dead field. Bias them **toward edges** — gutters, kerb lines, wall
bases, the lee of anything — because that is where wind actually leaves them:

```js
const u = rng.next();
const edge = u < 0.45 ? rng.sign() * rng.range(0.34, 0.5) : rng.range(-0.34, 0.34);
```

One instanced mesh per tone; a dozen scattered drifts still cost three draw calls.

---

## L3 — Stylised water

Two constructions, and the choice is about scale.

### 3a. Small / channel water: flat layers generated from the depth field

A single blue plane at any size above a few metres is a hole in the picture, and its tone
is usually *darker* than the sky it is meant to be reflecting. Build a stack instead, every
layer generated by **marching squares on a scalar field** rather than drawn:

| Layer | Field |
|---|---|
| body | `min(depth, distanceInsideShoreline)` |
| shallow (green — silt seen *through* water, not water) | `min(depth − 0.06, 0.85 − depth)` |
| deep (blue-violet; its **shape** is what says the basin has a middle) | `depth > 1.75` |
| sky panels | scattered, hard-edged, pale |
| echoes | see below |

The shoreline term is not optional: `depth = LEVEL − field` is true from here to the
horizon on a flat world, so without the containing polygon the lake is the planet. And a
contoured waterline is the one line the eye actually reads — a rectangle masked per cell
gives a stair-stepped one.

**Reflections are hard-edged blocks, and two properties make them read as reflection rather
than as scum:**

- **Direction.** A reflection lies along the line from the object to the viewer, so every
  block is extruded from its own stretch of shore *toward the middle of the water*, with a
  length proportional to the height of the thing reflected.
- **Breaks.** Each echo is three or four slabs with gaps. A continuous streak reads as ice.

Two kinds of echo is a language; four is noise. Measured failure: 150 sky panels at
2.2–7.0 × 0.22–0.6 m read from 20 m as **road lane markings**. 96 panels at 0.5–1.5 m read
as sky. Glint bands: very few, very pale, very long — about **2 % of the surface**.

**Moving layers**: wind lanes that **drift *and* breathe** on different periods (a lane
that only slides reads as an object crossing the water; one that also fades in and out
reads as a gust), plus a handful of ripple rings on 5–9 s cycles.

### 3b. Large / shore water: a shader with depth-difference foam

```glsl
float sceneDepth = 1.0 - textureBicubic(tSceneInfo, uv).r;   // bicubic ⇒ defined foam edge
vec3  sceneWorld = (uWorldMat * vec4(getViewPosition(sceneDepth, uv, near, far, uProjMat), 1.0)).xyz;
float worldHeightDiff = waterHeight - length(sceneWorld);    // how deep here
float viewDistDiff    = sceneDist - waterDist;

float foamMargin = fit(worldHeightDiff, 0.0, 0.3, 1.0, 0.0);
if (foamMargin > 0.0) {
    float bands = foamMargin * 4.0 - time * 0.35 + timeOffset * 2.0;
    float foam  = parabola(fract(bands), 5.0);                      // repeating band
    foam *= foamMargin * texture2D(tNoise, meshUV * 15.0 - ...).r;  // break it up
    foam  = step(0.42, foam);                                       // HARD edge
    foam *= 1.0 - step(0.99, pow(fit(viewDistDiff, 0.0, 1.0, 0.0, 1.0), 2.0));
}
```

- **Foam is a function of depth, not of the shoreline geometry**, so it wraps every rock,
  post and hull in the water for free and needs no authoring.
- **`fract` of a scrolling ramp gives repeating bands** — successive wavefronts running up
  the beach. `parabola` shapes each band; `step` gives it the hard edge cel work needs.
  Offsetting the noise lookup by `floor(bands)` makes each wave a *different* shape.
- **Waves are two layers of scrolling noise, multiplied, then `step`ed** at two thresholds
  into two extra tones. Each layer's UV is offset by a slow circular `(cos, sin)` wobble so
  the pattern never reads as a sliding texture.
- **Colour comes from depth**, not from a normal map: shore colour where
  `worldHeightDiff` is small, sea colour beyond, and the scene colour blended in through
  the shallows.
- Render water into **its own target with depth in alpha** so the composite can suppress
  outlines under the surface (`anime-line-control` L4).

**In both constructions the water surface is authoritative for nothing.** Depth queries,
wading, swimming and collision read the field or the plane, never the animated mesh.

---

## L4 — Clouds and sky motion

- **Billboard pairs**: a shade plate offset behind a light plate, two opacities, one
  texture. `depthWrite: false`, `fog: false`, negative `renderOrder`,
  `frustumCulled = false`.
- **Drift on the same wind clock as the vegetation**, wrapped with `mod` — and add half the
  wrap distance before taking the modulus, or the whole layer jumps when it wraps.
- Rings at two radii and a spread of heights; each billboard `lookAt` a point on the axis
  *below* its own height, so the ring tilts toward the viewer rather than standing as a
  wall.
- **Clouds are not lit and not inked** — depth is at the far plane, so any distance fade in
  the line pass excludes them automatically.

---

## L5 — Animating in a folded / baked scene graph

A bake that merges geometry into root space clears container transforms. Anything animated
afterwards must be marked so the bake **re-seats** it instead of folding it:

```
rigid hub (marked; re-seated on the surface with position + basis)
  └── pivot group (left at identity by the bake)
        └── mesh (rotation.x = flutter)
```

Three failure modes, all silent:

- **Animating a folded mesh** swings root-space geometry about the **world origin**. Twenty-
  four wheel discs orbited the world origin on a 7.4 m radius at nine revolutions a second,
  travelling with the train.
- **Writing `rotation.x/y/z` on a re-seated rig** throws away the placement quaternion —
  a horizontal cloth hangs as a vertical banner with its lettering on its side, and only
  for the units that were rotated to face across the street.
- **Translating a baked mesh along world X** far from the authoring origin moves it
  sideways *and downward through the surface*, because local +x there is nothing like world
  +x.

Keep a count of marked rigs in the bake statistics. If something moves and it is not in
that count, it will fly.

---

## Symptom → cause

| Observed | Cause |
|---|---|
| Scene reads as a still | Nothing on the wind clock; start with cloth and one particle system |
| Scene reads as a screensaver | Motion faster than the eye's tracking threshold, or too many layers moving at once |
| Every plant moves identically | Phase not taken from world position, or amplitude not randomised per instance |
| A gust does not read as a gust | No large-wavelength envelope, or the envelope is the same order as the sway |
| Petals read as confetti / coins | One tone; or tumbling about Y instead of a random axis |
| Petals render as scattered dots with outlines | Still writing depth, or not marked no-outline |
| The sky starts empty and fills over ten seconds | Particle field not pre-warmed at build |
| A drifting field slowly leaves the feature it sits over | Wrapped on world axes instead of the feature's centreline |
| Water reads as a hole in the picture | One flat plane; needs the layer stack or the depth shader |
| Reflections read as scum / litter | Not directed along the object→viewer line, or not broken into slabs |
| A pale dash pattern on water reads as road paint | Panels too long and too thin; make them broader and fewer |
| Foam is a soft gradient | Missing the `step` — cel foam is hard-edged |
| Foam does not follow rocks and posts | Foam driven by shoreline geometry instead of the depth difference |
| Waves read as a sliding texture | Noise UVs scrolled linearly with no circular offset |
| Cloud layer jumps when it wraps | `mod` applied without adding half the wrap first |
| Animated parts fly off / orbit the origin | Folded by the bake; needs a marked rigid hub with an inner pivot |
| A rotated animated piece rolls about its own normal | Euler written on a re-seated rig instead of on an inner pivot |

---

## Reference implementations

Both shipped projects below implement what this skill describes. `WebFetch` gets 403 on
both sites — use `curl` / `gh`.

**sakura-crossing** — cel-shaded Japanese neighbourhood on a small planet; falling and
fallen blossom, a five-layer lake, breathing cloth, and a bake that folds the whole world
into root space (which is why L5 exists).

```bash
git clone --depth 1 https://github.com/Kenton-GMI/sakura-crossing.git /c/tmp/sk
#                                                                    ↑ short path: a deep
#   temp dir fails on Windows with "cannot write keep file … Filename too long"
```

**messenger.abeto.co** — small-planet delivery game; shader-side wind and depth-driven
shore foam. The shipped bundle carries its GLSL verbatim in template literals.

```bash
curl -sSL --ssl-no-revoke https://messenger.abeto.co/ -o msg.html   # read the App3D-<hash>.js name
curl -sSL --ssl-no-revoke https://messenger.abeto.co/assets/App3D-<hash>.js -o App3D.js
# extract every template literal containing `void main`; identify a block by its uniforms.
```

**Read for this skill:**

| What | Where |
|---|---|
| Wind sway: shared noise field, per-instance amplitude, micro-shake, player displacement | messenger — the block with `uLeavesShake, uShakeSpeed, uScale`; look at `charPos` / `charSpeed` |
| Shore foam: `parabola(fract(bands))`, depth-difference driver, hard `step`, two scrolling wave layers | messenger — the block with `uColor1, uColor2, uColorWaves1, uColorWaves2, uDepthRange, uProjMat, uWorldMat` |
| Falling particles: two frequencies, random spin axis, centreline wrap, gust input, build-time pre-warm | sakura — `src/world/petals.js` (`update(dt, gust, gustDir)` and `buildFallenPetals`) |
| Water as five flat layers from a depth field; directional broken reflections; wind lanes that drift *and* breathe | sakura — `src/world/lake.js` (read the whole file header first) |
| Cloth: pivot at the mount, `sin + 0.25·sin(3.3ω)`, per-piece rate/phase | sakura — `src/world/details.js`, the `hang(...)` block |
| Clouds: billboard pairs, no depth write, no fog, negative render order | sakura — `src/core/sky.js` |
| Animating inside a folded scene graph (rigid hub + inner pivot) | sakura — `src/world/lake.js` `rigidQuad`, and the `planetRigid` rows of `AGENTS.md`'s trap table |
| The measured speed thresholds quoted at the top of this skill | sakura — `src/world/lake.js`, `buildMotion` header |
