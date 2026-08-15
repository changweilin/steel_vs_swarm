---
name: cel-shading-pipeline
description: Make a 3D frame read as an anime background — quantised or hard-cut lighting, hue-shifted shadows, quantised speculars, 3D-LUT grade, painted sky, stylised dissolves, supersample + FXAA. Use for toon/cel shading, MeshToonMaterial or custom-BRDF setup, post-processing chains, colour palettes, or when a frame "looks like 3D, not animation".
license: MIT
compatibility: Three.js r160+ / WebGL2
---

# Cel Shading Pipeline

**Cel shading is layers, not a shader.** Each covers what the previous cannot.

```
scene ──► rtScene (half-float colour + depth, optionally + info buffer)
      ──► line pass    see `anime-line-control`
      ──► grade pass   split-tone or 3D LUT, then linear→sRGB
      ──► fxaa pass    → screen
   plus  material layer: quantised light + shadow hue shift
   plus  a few hero props: inverted-hull outline
```

**Excluded on purpose: bloom, depth of field, motion blur, tone mapping.** All four are
sources of photographic feel.

Method sources: sakura-crossing `src/core/{toon,post,outline,sky,palette}.js`;
`messenger.abeto.co` scene materials and composite pass. Where the two differ, both are
recorded below with the case each one is right for.

> **Line placement is a separate discipline** — which pixels get ink, and which must never,
> lives in `anime-line-control`. Read that before touching an edge threshold.

---

## L1 — Quantised light (two schools; pick per project, not per object)

### School A — gradient ramp (`MeshToonMaterial` + `gradientMap`)

```js
const RAMPS = {
  2: [96, 255],
  3: [92, 178, 255],
  4: [80, 142, 202, 255],
  soft:  [180, 255],       // high-key: pale masses (blossom, snow, backlit glass)
  soft3: [172, 214, 255],
};
// N×1 DataTexture, NearestFilter, no mipmaps
```

three samples at `dotNL * 0.5 + 0.5`, so **band boundaries are fixed by texel count**.
3 bands ⇒ UV edges at 1/3, 2/3 ⇒ **`dotNL = ±1/3`**.

Consequence to compute and record for your ramp: at `dotNL = 0.8`, a facet must turn
~**35°** to cross a band.

> **Therefore: direct light cannot shape a gentle slope. Only material value can.**

### School B — hard cut on accumulated diffuse (custom fragment on Phong/Lambert)

```glsl
vec3 hsv = rgb2hsv(baseColor);
hsv.r -= 0.02;          // hue: rotate slightly toward cool
hsv.b *= 0.5;           // value: half
vec3 colorShadow = hsv2rgb(hsv);

float totalShadow = reflectedLight.directDiffuse.r * dirShadowFactor;
#ifdef HARD_CUT_SHADOW
    float shadowCut = smoothstep(0.10, 0.15, totalShadow);   // characters
#else
    float shadowCut = smoothstep(0.20, 0.40, totalShadow);   // everything else
#endif
outgoingLight = mix(colorShadow, baseColor, shadowCut);
outgoingLight += reflectedLight.indirectDiffuse;
```

Two things this buys that a ramp cannot:

- **Shadow-map occlusion and N·L are quantised by the same cut.** With a ramp, cast
  shadows are a separate multiply and can land mid-band; here a cast shadow produces the
  *same* two-tone edge as a terminator, which is what an animator draws.
- **Per-object cut hardness.** Characters get a knife edge (0.10→0.15), the world gets a
  softer one (0.20→0.40), from one `#define`. A ramp is a texture — changing hardness
  means another texture and another program.

Cost: you are writing the fragment shader, so you inherit `lights_fragment_begin` and
every three.js upgrade touches you. School A is the cheaper port; School B is the better
look for a scene with characters in it.

**Do not mix them in one scene.** Two quantisation schemes give two different terminator
shapes on adjacent objects and it reads as a bug.

### 1b. Shadow hue shift — the one line that matters (School A)

Patch `lights_toon_pars_fragment`:

```glsl
// before
vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
// after
vec3 celBand = getGradientIrradiance( geometryNormal, directLight.direction );
vec3 irradiance = celBand * mix( uShadowTint, vec3(1.0), celBand ) * directLight.color;
```

`celBand` serves as both brightness and blend weight: lit bands ×1.0, dark bands pulled
toward a cool tint. Shadows change **hue**, not just value. This is the difference between
"anime cel" and "low-poly 3D". School B gets the same result from the HSV hue rotation.

```js
mat.onBeforeCompile = (s) => { s.uniforms.uShadowTint = uni; /* replace chunk */ };
mat.customProgramCacheKey = () => 'celTint_' + hex;   // omit ⇒ three shares one program across tints
```

Cache materials by parameter signature or the scene compiles hundreds of programs — but
**force no-cache for materials carrying a `map`/`alphaMap`**.

Two robustness rules for any ShaderChunk string replacement:

- **Guard the anchor** (`chunk.includes(anchorLine)`): a three.js upgrade that rewrites the
  chunk must *disable* the patch, not crash the app.
- **A silently-disabled patch needs a visible fallback check** — the failure mode is
  "shadows quietly stop being tinted", which nobody reports.

### 1c. Quantised specular, suppressed on up-facing surfaces

```glsl
outgoingLight += smoothstep(0.01, 0.011, reflectedLight.directSpecular)
               * specularAmount                                  // 0.075 world, 0.0 characters
               * fit(dot(worldNormal, vec3(0,1,0)), 0.95, 0.9, 0.0, 1.0);
```

`smoothstep(0.01, 0.011, …)` is a **step** — a hard-edged highlight shape, not a falloff.
The up-facing term exists because a quantised highlight on a floor or a roof reads as a
white patch of missing texture. Characters take zero: skin and cloth with a specular
plate on them stop reading as drawn.

### 1d. `flatShading: true` by default

Smooth normals on low-poly geometry produce gradients that cross band boundaries and
smear. Flat shading puts each facet in one band.

**Exception: very thin geometry needs `flat: false`.** At reed/cable thickness only one
facet is ever visible, and a flat facet turned from the sun is near-black.

### 1e. Band count / cut choice

| Case | Setting |
|---|---|
| General | 3 bands / soft cut |
| Small dark parts (tyres, cables, dark armour) | 2 bands — the mid band muddies them |
| Pale masses (blossom, snow, smoke, backlit glass) | `soft`/`soft3` — ramps shape **direct** light only; a low dark band drops to ambient and goes violet-black |
| Characters | hard cut (School B), no specular |

---

## L2 — Palette as a design document

Large surfaces need a **value ladder**, designed by relative luminance, not by hue:

```
lightest  0.754   lands on the largest area; only 0.053 above mid
second    0.739   same value, decisively different hue ⇒ reads as cover change, not light change
mid       0.701
foreign   0.700   same value as mid, separated by hue only
darkest   0.574   0.127 step — form is carried by the dark end
```

Measured failure: lightest set to 0.806 bleached the whole hill — it is the lightest tone,
on the largest area, already in the ramp's top band.

Next to each colour family record its *measured* relative luminance
(`0.2126R + 0.7152G + 0.0722B`), the reason for the value (which ramp band it lands in, on
what area share), and the values that **failed** and why. Keep every colour table
**append-only** — `wall:`/`roof:` indices are baked into standing geometry, and reordering
repaints half the world silently. Per area: a narrow gamut plus one or two saturated
accents, each with its reason written down.

---

## L3 — Lighting: coloured shadows, not dark ones

```js
const sun = new THREE.DirectionalLight(0xfff1d8, 2.25);   // key, only shadow caster
sun.position.set(-52, 62, 56);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.035;

const fill   = new THREE.DirectionalLight(0xa9bdf5, 1.08);   // cool, ~50% of key
const bounce = new THREE.DirectionalLight(0xd8cbe8, 0.34);   // from below-front
const hemi   = new THREE.HemisphereLight(0xdcecff, 0xb6a6c6, 1.12); // chromatic ground
```

Fill at half the key is deliberate: the L1b tint affects **direct** light only, so this
lamp is what keeps shadows readable.

Shadow map type is a real fork: **`PCFShadowMap`** keeps shadow shapes crisp, which suits
School A (the ramp already quantises, so a soft map fights it). **`PCFSoftShadowMap`**
suits School B, where the `smoothstep` cut re-quantises the softened value and the
softness buys you a shorter, cleaner terminator instead of stair-stepping. Snap the shadow
camera to a grid following the player to stop shimmer.

---

## L4 — Inverted hull, hero props only

```glsl
uniform float uThickness;   // NDC units; ~0.004 ≈ 2px at 1080p
uniform vec2  uResolution;
void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  #ifdef USE_INSTANCING
    mv = modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
  #endif
  vec3 n = normalize( normalMatrix * normal );
  vec4 clip  = projectionMatrix * mv;
  vec3 clipN = normalize( ( projectionMatrix * vec4( n, 0.0 ) ).xyz );
  vec2 aspect = vec2( uResolution.y / uResolution.x, 1.0 );
  clip.xy += clipN.xy * aspect * uThickness * clip.w * 0.5;   // ×clip.w cancels perspective divide
  gl_Position = clip;
}
```

- **`× clip.w`** gives constant *pixel* width at any distance. Object-space extrusion in
  world metres makes distant lines vanish and near ones bloat.
- **`aspect`** correction, else horizontal lines are thicker than vertical.
- Pre-process with `mergeVertices(1e-4)` + `computeVertexNormals()` for smooth normals, or
  the shell splits at hard edges.
- `side: BackSide`, `castShadow = false`, `renderOrder = mesh.renderOrder - 1`.
- `InstancedMesh`: **share the same `instanceMatrix`**, don't copy.
  `SkinnedMesh`: `shell.bind(o.skeleton, o.bindMatrix)`.
- **Merge a multi-box body into one mesh first** — a per-mesh contour inks every internal
  seam of a five-box prop.

**Why not everywhere:** the screen-space pass already outlines every silhouette; 50 shells
are 50 draw calls in a scene that is measurably draw-call bound.

---

## L5 — Grade: split-tone, or a 3D LUT

Grade in **linear space**, then convert manually (`renderer.toneMapping = NoToneMapping`,
RTs `NoColorSpace`).

### 5a. Split-tone (no assets, tunable in code)

```glsl
vec3 c = texture2D( tDiffuse, vUv ).rgb;
float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
float k = smoothstep( 0.02, 0.55, l );

c *= mix( uShadowTint, uLightTint, k );          // cool violet darks / warm paper lights
c += vec3( uWarmth, uWarmth * 0.45, 0.0 ) * l * 0.35;
c  = c + uLift * ( 1.0 - k );                    // shadows never crushed to black
c  = mix( vec3( l ), c, uSaturation );
c *= 1.0 - uVignette * pow( clamp( length( vUv - 0.5 ) * 1.42, 0.0, 1.0 ), 2.6 );
gl_FragColor = vec4( linearToSRGB( max( c, vec3( 0.0 ) ) ), 1.0 );
```

`uShadowTint 0xada8d0`, `uLightTint 0xfff7e8`, `uSaturation 1.12`, `uLift 0.032`,
`uVignette 0.15`, `uWarmth 0.05`.

### 5b. 3D LUT (art-directable, one texture)

```glsl
sceneColor = apply3DLUTTetrahedral(sceneColor, tLUT, uLUTIntensity);
```

A `sampler3D` with **tetrahedral** interpolation, shipped as one compressed texture
(`lut.ktx2`). Three rules:

- **The LUT replaces split-tone; it does not stack on it.** They are the same operation
  written twice, and the colourist grading in an external tool is looking at the ungraded
  image.
- If `sampler3D` is not available, use the **2D strip** layout (width = size², height =
  size) and interpolate the blue axis manually between two slices with a half-texel inset.
  That is the format every external grading tool exports, and it works in GLSL1.
- `flipY = false`, `NoColorSpace`, and index in **sRGB** space — 32 slices on a linear
  axis give the shadows two or three steps.

**Intensity 0 must be bit-identical to no LUT at all**, so the feature can be shipped off
by default and A/B'd.

### 5c. AA: supersample + FXAA, not MSAA

MSAA does nothing for lines produced in a pass — they are not on geometry edges.

```js
let scale = dpr < 1.5 ? 1.5 : Math.min(dpr, 2);
if (w * h * scale * scale > pixelBudget) scale = Math.max(1, Math.sqrt(pixelBudget / (w * h)));
renderer.setPixelRatio(1);
renderer.setSize(w, h, true);   // canvas = display size; RTs carry the scale
```

---

## L6 — Sky: painted backdrop, not atmosphere

Three-stop `BackSide` dome with **deliberate residual banding**:

```glsl
float t = clamp( h * 1.15 + 0.02, 0.0, 1.0 );
float q = floor( t * 26.0 ) / 26.0;
t = mix( t, q, 0.35 );                  // mostly smooth, with a faint painted step
vec3 col = mix( uHaze, uMid, smoothstep( 0.0, 0.30, t ) );
col = mix( col, uTop, smoothstep( 0.26, 0.92, t ) );
col = mix( col, uHaze, smoothstep( 0.12, -0.05, h ) * 0.6 );   // warmth low, opposite the sun
```

Clouds: billboard pairs (a shade plate offset behind a light plate), `depthWrite: false`,
`fog: false`, `renderOrder` negative, `frustumCulled = false`. Distant hills: pure unlit
silhouette layers.

**Match linear fog range to the line-fade range** — distance is handed to fog, not to lines.

---

## L7 — Appear and disappear: dissolve, never alpha

Fading a cel object's opacity makes it a ghost, and a transparent cel material loses its
own outline. Dither the *coverage* instead and keep the material opaque:

```glsl
float lineFade(vec3 p, float size, float amount) {          // scanline bands
  float h = size * 0.5;
  return 1.0 - step(amount * 1.01, abs(mod(p.y, size) - h) / h);
}
float sphereFade(vec3 p, float size, float amount) {        // 3D dot grid
  float h = size * 0.5;
  return clamp(1.0 - step(amount * 1.85, length(mod(p, size) - h) / h), 0.0, 1.0);
}
...
if (showAmount < 0.001) discard;
```

Used for near-camera clipping (`lineFade` over ~0.1–0.5 m), for distance culling
(`FADE_AWAY` with `sphereFade`), and for spawning characters in. Because it `discard`s,
the depth and info buffers stay consistent and the line pass follows the dissolve for free.

Screen transitions are the same instinct at frame scale: two **inclined wipes** driven by
independent 0→1 uniforms, plus an overlay colour and a flash that runs
vibrance + brightness/contrast rather than a white fade:

```glsl
float inc1 = 0.3 * uWipe1;
float uv1  = vUv.y - (1.0 - vUv.x) * inc1;
color = mix(color, uWipeColor, falloff(uv1, 1.0, -inc1, 1e-6, uWipe1));
```

A diagonal wipe is the single most legible "this is animation" cue in a transition, and it
costs one full-screen pass.

---

## Geometry-side discipline

| Rule | Symptom if broken |
|---|---|
| Transparent materials never cast shadows | Glazed cabinet shadows its own contents; stock goes muddy |
| Thin / transparent meshes `depthWrite: false` | Line pass outlines petals and cables into speckle |
| Pale canopies / masses never `receiveShadow` | Ramps shape direct light only ⇒ **dark circles floating in the sky** |
| Thin overhanging copings `castShadow = false` | Self-shadow lands as a sawtooth row, not a line |
| Closed sky/planet spheres `castShadow = false` | The far hemisphere renders into the shadow map and drops the **entire world** into shadow |
| Lift very dark base colours | Dark green in the bottom band lands within a few % of ink; glazing and shut lines stop existing. A prop in *permanent* shade wants near-white |
| Anything inside an unlit recess gets `emissive` (~0.4) | Recess and contents are all on the bottom band within a few % of each other; **a lighter colour buys nothing when the surface gets no direct light** |
| Saturated lamp/accent surfaces stay small | A 0.26 m flat-red lamp is the loudest thing in any frame |
| Check texture aspect against the face | 512×128 on a 0.24×1.5 m face is 25× horizontal crush — renders as blur, not an error |
| Single-sided planes must face the viewer they exist for | A painted interior on a frontage looking −z is back-face culled — simply absent. `rotation.y = atan2(nx, nz)` |
| Multi-material meshes keep `geometry.groups` through every rebuild | A material array without groups is **not drawn at all**, silently |
| Dispose one-shot geometry/materials; register shared geometry | Frame time degrades over a play session |

### Normals under quantised light

- **`computeVertexNormals()` on a non-indexed geometry IS flat shading** — every vertex
  gets the face normal, and `flat: false` changes nothing. Any pass that rebuilds geometry
  as a bare position list (CSG, subdivision) de-indexes it. Take normals analytically where
  the surface is analytic (radial for a sphere: one loop, exact); otherwise `mergeVertices`
  first.
- **Re-read `geometry.attributes.position` after any pass that replaces it.** Writing the
  normal buffer from the pre-pass attribute gives a shorter array; three.js does not
  complain — it shades the tail of the mesh with whatever is in memory.
- **A smooth analytic surface under quantised light has no shading on it.** Near-coplanar
  ground quantises to one band with a hard straight edge. The fix is geometry, not tone —
  and never sine-based bumps: a plane wave gives every ridge the same bearing and the line
  pass draws them as parallel straight lines (see `procedural-object-detail`).

---

## Port order (value per effort)

1. Quantised light + hand-written ramp (or the HSV cut) + `flatShading` — 80 % of "cartoon".
2. Shadow hue shift — one GLSL line, the key 20 %. Include `customProgramCacheKey`.
3. Strong cool fill (~50 % of key) + chromatic hemisphere ground — zero shader cost.
4. **Line pass** — see `anime-line-control`. This is what moves it from "toon rendering"
   to "animation background".
5. Supersample + FXAA — line quality lives here.
6. Split-tone grade + lift; swap for a LUT once there is an art director.
7. Quantised specular, dissolves, wipes.
8. Inverted hull, last, for 3–5 hero objects only.

---

## Symptom → cause

| Observed | Cause |
|---|---|
| A whole slope in one tone with a few straight creases | Bands cannot be crossed (L1). Needs a value ladder, not more relief |
| Grey shadows, frame reads as low-poly 3D | Missing the shadow hue shift, or the fill is too weak |
| Cast shadows land mid-band while terminators are crisp | School A with a soft shadow map; either switch to PCF or move to School B |
| Two objects side by side quantise differently | Schools A and B mixed in one scene |
| Dark circles hanging in the sky | Pale masses with `receiveShadow` on |
| A white patch on a roof or floor | Quantised specular with no up-facing suppression |
| Characters read as plastic | Specular not zeroed on skin/cloth; or soft cut where a hard cut belongs |
| A detail inside a recess is invisible however light its colour | It is on the bottom band with everything around it — needs `emissive` |
| Material colour edit produces a **pixel-identical** frame | That face is not being drawn — two coplanar faces. Never a subtle material problem |
| Grade looks doubled / muddy after adding a LUT | LUT stacked on top of split-tone instead of replacing it |
| LUT inverts the green axis | Texture `flipY` left at three's default `true` |
| Objects fading in look like ghosts | Alpha fade instead of a dissolve `discard` |
| Bad aliasing on mobile | MSAA is a bandwidth cost on tilers and does nothing for pass-drawn lines |

---

## Reference implementations

One project per school, both shipped. Open them when a rule here is not enough.
`WebFetch` gets 403 on both sites — use `curl` / `gh`.

**sakura-crossing (School A)** — cel-shaded Japanese neighbourhood on a small planet;
Three.js, vanilla ES modules, **no image assets**. One squashed commit, so the tree *is*
the history; its `CLAUDE.md` trap table and `NEXT.md` carry as much as the code does.

```bash
git clone --depth 1 https://github.com/Kenton-GMI/sakura-crossing.git /c/tmp/sk
#                                                                    ↑ short path: a deep
#   temp dir fails on Windows with "cannot write keep file … Filename too long"
```

**messenger.abeto.co (School B)** — small-planet delivery game; Three.js + Svelte, no
public source, but the shipped bundle carries its GLSL verbatim in template literals.

```bash
curl -sSL --ssl-no-revoke https://messenger.abeto.co/ -o msg.html   # read the App3D-<hash>.js name
curl -sSL --ssl-no-revoke https://messenger.abeto.co/assets/App3D-<hash>.js -o App3D.js
# extract every template literal containing `void main` — 220 blocks, ~80 of which declare
# `u*` uniforms and are the app's own. Identify a block by its uniform list.
```

**Read for this skill:**

| What | Where |
|---|---|
| School A end to end: ramps, `gradientMap`, the `lights_toon_pars_fragment` patch, material caching | sakura — `src/core/toon.js` |
| School B end to end: HSV shadow cut, hard/soft `#define`, quantised specular, dissolves | messenger — the block with `uSkinColor, uShowChars, uWetHeight, uMouthColor, uIsTalking, uNPCSeed`; look for `shadowCut`, `colorShadow`, `lineFade`, `sphereFade` |
| Grade: split-tone + lift + vignette + linear→sRGB, and FXAA | sakura — `src/core/post.js`, `GRADE_SHADER` / `FXAA_SHADER` |
| Grade: 3D LUT, tetrahedral | messenger — the composite blocks, `apply3DLUTTetrahedral(sceneColor, tLUT, uLUTIntensity)`; asset is `lut.ktx2` |
| Screen wipes / flash for transitions | messenger — the block with `uWipe1, uWipe2, uWipeColor, uOverlay, uOverlayColor, uFlash` |
| Painted sky dome with deliberate banding, cloud pairs, distant hill flats | sakura — `src/core/sky.js` |
| Palette as a design document (measured luminances, append-only tables) | sakura — `src/core/palette.js`, `src/world/buildings.js` header |
| Two-light anime setup and the RT/supersample scaling | sakura — `src/main.js`, `src/core/post.js` `Pipeline.setSize` |
| The geometry-side discipline table, with the symptom each row was written from | sakura — `CLAUDE.md`, "Traps that have already bitten" |
