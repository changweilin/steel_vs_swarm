---
name: character-and-creature-motion
description: Make characters, birds and small animals move fluidly instead of on rails — GPU flocks that follow an authored curve with noise and spring, additive animation weight vectors instead of crossfades, batched skinned crowds in one draw call, procedural blinking and mouth shapes with no CPU state, and frame-rate-independent damping. Use when animation snaps between states, birds fly in visible loops, a crowd costs a draw call each, faces are dead, or motion changes with frame rate.
license: MIT
compatibility: Three.js r160+ / WebGL2
---

# Character and Creature Motion

Two different "stiff" complaints, two different causes:

- **Stiff transitions** — the pose is fine but the change between poses is a cut.
  Fix: weights, not states (L2).
- **Stiff paths** — the motion is smooth but obviously computed.
  Fix: an authored path plus noise plus a spring, never one or the other (L1).

Method sources: `messenger.abeto.co` (GPGPU flock sim, batched skinned characters, face
shader); sakura-crossing (prop-scale and count rules).

> In this repository, gait and rig mechanics already live in `gaitcurve.js`,
> `locomotion.js` and `morphrig.js`. This skill is about the layers *around* a rig:
> flocks, blending, crowds, faces and damping.

---

## L0 — Frame-rate-independent damping (do this before anything else)

Every smoothing constant in this skill is wrong if it is applied per frame. A 60 Hz
constant on a 144 Hz screen damps 2.4× harder, and on a 30 Hz phone 2× softer — so the
same code produces different *behaviour*, not just different smoothness. That is the most
commonly shipped animation bug in browser 3D.

```js
const dtRatio    = dt * 60;                              // frames of 1/60 elapsed
const frictionFPS = (f, r) => Math.pow(f, r);            // multiplicative decay
const lerpFPS     = (a, b, k, r) => a + (b - a) * (1 - Math.pow(1 - k, r));
```

Use `frictionFPS` for velocities, `lerpFPS` for values chasing a target. Never
`v *= 0.99` or `a += (b - a) * 0.25` in an update loop.

---

## L1 — Flocks and wandering creatures: curve + noise + spring + friction

A bird on a spline reads as a bird on a spline; a bird on pure noise reads as a bug. The
construction that reads as flight is **all four terms**, and it runs entirely on the GPU as
a ping-pong position/velocity simulation:

```glsl
// target: a point on an authored flight path, baked into an RGB texture
float offset   = floor(hash11(prevPos.w * 8.54534) / (1.0 / uGroups));   // which sub-flock
float speed    = 2.0 * uDirection * uSpeed * mix(0.75, 1.0, step(0.3, hash11(vUv.x)));
float progress = time * speed + (curveWidth / uGroups) * offset + uSeed * 12.4234;
vec3  target   = mix(texelFetch(tCurve, ivec2(mod(progress,       curveWidth), 0), 0).rgb,
                     texelFetch(tCurve, ivec2(mod(progress + 1.0, curveWidth), 0), 0).rgb,
                     fract(abs(progress)));

// 1. wander — three axes, three seeds, three time scales
float n = 0.005 * uNoise * dtRatio;
prevVel.x += sinenoise1(prevPos.xyz + prevVel.w *  53.5645 + time * 0.05 ) * n;
prevVel.y += sinenoise1(prevPos.xyz + prevVel.w * 653.8667 + time * 0.10 ) * n;
prevVel.z += sinenoise1(prevPos.xyz + prevVel.w *  21.6546 + time * 0.025) * n;

// 2. spring toward the target — weak
prevVel.xyz += (target - prevPos.xyz) * 0.0003 * dtRatio;

// 3. friction — frame-rate independent
prevVel.xyz *= frictionFPS(0.99, dtRatio);
prevPos.xyz += prevVel.xyz * dtRatio;
```

Why each term is load-bearing:

| Term | Without it |
|---|---|
| **Authored curve** | The flock wanders into buildings, off the map, and out of frame. The curve is the art direction: it decides what the birds are *for* in the composition |
| **Per-axis noise with different time scales** | The wander is spherical and reads as jitter. Different scales per axis give the long, uneven arcs birds actually fly |
| **Weak spring (0.0003)** | Strong spring = the curve, visibly. This number is the entire "randomness" dial |
| **Friction** | The spring integrates into an oscillation and the flock orbits the path |
| **Groups** | Every bird sits at the same point on the curve. `uGroups` spreads them into sub-flocks by hashing their id |
| **Per-bird speed jitter** | The flock stays in perfect formation forever |

`uSnap` teleports every agent onto its target in one frame — needed for spawn, respawn and
teleport, and it must zero the velocity too.

**Bake the curve as a texture, not as a spline evaluated on the CPU**: it costs one
`texelFetch` pair, it is trivially loopable with `mod`, and re-authoring a route is
re-baking one row of pixels.

### Count and scale rules for small creatures

- **Counts carry meaning.** Two reads as a pair; three reads as a few; four or more reads
  as a flock. Choose the number for what it should say.
- **A dark prop under 0.3 m reads as a dot.** A perched bird needs the two features that
  carry its silhouette at distance — the wedge tail held up off the wire and the beak clear
  of a flat head — or it should not be there. Three black circles hanging over a train was
  the first thing every viewer asked about.
- Birds in the sky are the cheapest life in a scene; birds at eye level are the most
  expensive, because they invite inspection.

---

## L2 — Character animation: weights, not states

**Play every clip at once, disabled, and drive a weight vector.**

```js
mixer   = new AnimationMixer(model);
actions = clips.map((clip, i) => {
  const a = mixer.clipAction(clip.clone());
  a.setEffectiveTimeScale(options[i]?.speed || 1);
  a.play();
  a.enabled = false;            // enabled by weight, per frame
  return a;
});
// each frame: weights[] ← locomotion state, then apply to actions
```

Why this beats `crossFadeTo` / a state machine:

- **A blend is continuous and interruptible.** A crossfade has a duration and a state; two
  inputs arriving inside that window produce a visible snap or a stuck pose.
- **The weight vector is readable by everything else.** Footstep volume, dust, camera
  shake and cloth all key off `weights[walk] + weights[run]` — one number that is already
  correct, instead of each system re-deriving "is the character walking" from velocity and
  disagreeing at the edges. (See `game-audio-layering` L2.)
- **Per-clip `timeScale`** lets one run clip serve several speeds without re-authoring.

Layers to add on top, in order of value:

1. **Aim / brace.** When the character is doing something with the upper body while
   moving, collapse the upper-body secondary motion (pelvis sway, roll, counter-rotation)
   toward zero and hold the head tighter, while the legs keep running. Drive it from the
   *action's* hold window, not from a general "aiming" flag — standing still is not a
   firing pose.
2. **Landing depth from the peak of the jump**, latched during flight and cleared on
   contact. Without it a 1 m hop and a 6 m drop land identically, and at the apex the
   character stands in mid-air because up- and down-velocity are both ≈0 there.
3. **Secondary cloth** — see `procedural-object-detail` L1b-A.
4. **Local wetness / dust lines** keyed on local Y with a jagged boundary.

---

## L3 — Crowds: one draw call, one bone texture

A `BatchedMesh` whose bone texture has **one row per instance** puts a whole crowd of
independently animated skinned characters in a single draw call:

```glsl
mat4 getBoneMatrix(const in float i, const in float id) {   // id = batch index = row
  int x = int(i) * 4, y = int(id);
  return mat4(texelFetch(boneTexture, ivec2(x,     y), 0),
              texelFetch(boneTexture, ivec2(x + 1, y), 0),
              texelFetch(boneTexture, ivec2(x + 2, y), 0),
              texelFetch(boneTexture, ivec2(x + 3, y), 0));
}
...
float batchID = getIndirectIndex(gl_DrawID);
vSurfaceId += 0.02535 * batchID;      // every instance gets its own outline/ID identity
vIsLocal    = batchID == 0.0 ? 1 : 0; // reserve row 0 for the player
```

Practical points:

- **Reserve batch 0 for the player** so player-only effects (`vIsLocal`) are a comparison,
  not a uniform.
- **Derive per-instance visual variety from `batchID`**, not from a uniform: surface id,
  blink phase, colour row. One draw call cannot carry per-instance uniforms, and this is
  the substitute.
- **Upload one geometry per frame** when swapping meshes into the batch. Draining the whole
  queue on the frame a character changes outfit is a visible hitch.
- The **depth/shadow material needs the same custom skinning**, or the crowd's shadows do
  not follow their animation. It is a separate `onBeforeCompile` with the same chunk
  replacements — easy to forget, and the symptom is a field of static shadows under moving
  characters.

---

## L4 — Faces with no CPU state

Both of these live entirely in the fragment shader, cost nothing, and never desync.

**Blinking** — overlap three `fract` cycles on coprime intervals so the maximum is a
pseudo-random, non-repeating pulse:

```glsl
float eyeTime = time * 3.0 + blinkSeed * 23.73464;
float l1 = fract(eyeTime / 22.0) * 22.0 - 22.0 + 1.0;
float l2 = fract(eyeTime / 34.0) * 34.0 - 34.0 + 1.0;
float l3 = fract(eyeTime / 57.0) * 57.0 - 57.0 + 1.0;
float eyeProgress = max(0.0, max(max(l1, l2), l3));       // 0 most of the time, ramps to 1
float sprite = floor(eyeProgress * 3.0);                  // closed / half / open
```

`blinkSeed` comes from `batchID` for a crowd member and from a uniform for a named NPC, so
a crowd never blinks in unison. Intervals must be coprime or the pattern repeats visibly.

**Mouth shapes** — a three-channel mask (r: mouth, g: teeth, b: tongue) in a four-frame
strip, re-picked at 8 Hz while a `uIsTalking` flag is up:

```glsl
float offset = uIsTalking > 0.5 ? floor(hash11(floor(time * 8.0)) * 3.0) : 0.0;
```

Two mechanics worth copying:

- **Put the eye and mouth regions outside the `[0,1]` UV range** (`vUv.y > 1.0`,
  `vUv.y < 0.0`) so one material serves the whole head and the branch is a UV test, not a
  second draw call or a second material.
- **`aastep(0.5, mask)`** on the sprite lookup — a hard cel edge that is still antialiased.
  A raw `step` crawls; a `smoothstep` with fixed margins goes soft at distance.

---

## L5 — Or: no characters at all

Worth stating because one reference project takes it and it is a coherent choice.
Sakura-crossing has **no people anywhere** — not as geometry, not as silhouettes, not
painted on any poster or sign — and everything the place has to say is said by what has
been left out, pinned up, parked, knocked over or forgotten. It survived two accidental
breaches (painted passengers in train windows; a photo studio's window display), both
caught only because a head z-fought the glass at 6 mm.

If you take this route, the rule has to be absolute: the moment a figure goes in "for
scale" it is not a constraint any more. Use the interior instead — a rail, seat backs, a
ceiling strip.

---

## Symptom → cause

| Observed | Cause |
|---|---|
| Motion is faster/snappier on a high-refresh screen | Per-frame damping constants; use `frictionFPS` / `lerpFPS` |
| Birds visibly fly a loop | Spring too strong, or no noise term |
| Birds jitter in place | Noise without an authored target, or one time scale on all three axes |
| The flock orbits the path | No friction term |
| The whole flock is at one point on the path | No group offset by hashed id |
| Animation snaps between walk and run | Crossfade state machine; use a weight vector |
| Footstep audio and animation disagree at the edges | Audio re-derives "is walking" from velocity instead of reading the weights |
| A jump landing looks the same from any height | Landing depth not latched from the flight peak |
| Character stands upright at the apex of a jump | Up and down velocity are both ≈0 there; needs a peak-derived float pose |
| A crowd costs one draw call per character | Not batched; needs a bone texture with a row per instance |
| A crowd's shadows do not animate | Depth material missing the same custom skinning |
| Every crowd member blinks together | Blink seed not derived from `batchID` |
| Blinking has an obvious period | Intervals not coprime |
| A wardrobe/mesh change hitches the frame | Whole geometry upload queue drained in one frame |
| Small birds/animals read as dots | Under 0.3 m with no silhouette-carrying features |

---

## Reference implementations

`WebFetch` gets 403 on both sites — use `curl` / `gh`.

**messenger.abeto.co** — small-planet delivery game with a player character, NPCs, crowds
and bird flocks. This is the primary source for this skill: it does all four layers
(flock, weights, batched crowd, shader faces). No public source, but the shipped bundle
carries its GLSL verbatim in template literals and its JS is readable when de-minified
enough to grep.

```bash
curl -sSL --ssl-no-revoke https://messenger.abeto.co/ -o msg.html   # read the App3D-<hash>.js name
curl -sSL --ssl-no-revoke https://messenger.abeto.co/assets/App3D-<hash>.js -o App3D.js
# extract every template literal containing `void main` — 220 blocks, ~80 of which declare
# `u*` uniforms and are the app's own. Identify a block by its uniform list; grep the raw
# bundle by name for JS symbols.
```

**sakura-crossing** — the counter-example: a world with **no people at all**, and the
argument for why that is a coherent choice (L5).

```bash
git clone --depth 1 https://github.com/Kenton-GMI/sakura-crossing.git /c/tmp/sk
#                                                                    ↑ short path: a deep
#   temp dir fails on Windows with "cannot write keep file … Filename too long"
```

**Read for this skill:**

| What | Where |
|---|---|
| GPGPU flock step: curve texture, per-axis noise, weak spring, `frictionFPS`, groups, `uSnap` | messenger — the block with `uNoise, uGroups, uSnap, uSpeed, uSeed, uDirection, tCurve` (writes `outPos` and `outVel` to two attachments) |
| Batched skinned crowd: bone texture with a row per instance, `batchID`-derived variety | messenger — the vertex block containing `getBoneMatrix(const in float i, const in float id)` and `getIndirectIndex(gl_DrawID)` |
| Weight-vector animation, per-clip `timeScale`, one geometry upload per frame | messenger — `grep 'animationProps'` in the raw bundle |
| Blinking from three coprime `fract` cycles; mouth sprite strip at 8 Hz | messenger — the block with `uSkinColor, uMouthColor, uIsTalking, uNPCSeed`; look at `eyeTime`, `interval1/2/3`, `hash11(floor(time * 8.0))` |
| The same weight vector reused by the audio mixer | messenger — `grep 'volumes.walk'`; and `game-audio-layering` L2 |
| The depth material needing the same custom skinning | messenger — `grep 'depthCharsMaterial'` |
| The no-people rule, its two accidental breaches and how they were caught | sakura — `NEXT.md` "Rules that must not be broken"; `CLAUDE.md` trap table, the `addGlass` row |
| Prop-scale rules for small creatures (the crows) | sakura — `CLAUDE.md` trap table, "A prop under 0.3 m will read as a dot" |
