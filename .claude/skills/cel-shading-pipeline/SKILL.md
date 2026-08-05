---
name: cel-shading-pipeline
description: Render 2D celluloid/anime-style frames from 3D scenes — quantised toon ramps, hue-shifted shadows, screen-space ink from a second difference of depth, inverted-hull outlines, split-tone grade, FXAA. Use for toon/cel shading, outline or ink passes, MeshToonMaterial setup, post-processing passes, or when a frame "looks like 3D, not animation" / outlines are missing or noisy.
license: MIT
compatibility: Three.js r150+ / WebGL2
---

# Cel Shading Pipeline

**Cel shading is five layers, not one shader.** Each covers what the previous cannot.

```
scene ──► rtScene (half-float colour + depth texture)
      ──► ink pass    second difference of linear depth
      ──► grade pass  split-tone + linear→sRGB
      ──► fxaa pass   → screen
   plus  material layer: quantised ramp + shadow hue shift
   plus  a few hero props: inverted-hull outline
```

**Excluded on purpose: bloom, depth of field, motion blur, tone mapping.**
All four are sources of photographic feel.

Method source: sakura-crossing `src/core/{toon,post,outline}.js`, `src/main.js`.

---

## L1 — Quantised ramp + shadow hue shift (do this first)

### 1a. Ramp

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

Large surfaces need a **value ladder**, designed by relative luminance, not by hue:

```
lightest  0.754   lands on the largest area; only 0.053 above mid
second    0.739   same value, decisively different hue ⇒ reads as cover change, not light change
mid       0.701
foreign   0.700   same value as mid, separated by hue only
darkest   0.574   0.127 step — form is carried by the dark end
```

Measured failure: lightest set to 0.806 bleached the whole hill — it is the lightest
tone, on the largest area, already in the ramp's top band.

**Treat the palette module as a design document.** Next to each colour family record its
*measured* relative luminance (`0.2126R + 0.7152G + 0.0722B`), the reason for the value
(which ramp band it lands in on what area share), and the values that **failed** and why.
Keep every colour table **append-only** — `wall:`/`roof:` indices are baked into standing
geometry, and reordering repaints half the world silently. Per area, a narrow gamut plus
one or two saturated accents, each with its reason written down.

### 1b. Shadow hue shift — the one line that matters

Patch `lights_toon_pars_fragment`:

```glsl
// before
vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;

// after
vec3 celBand = getGradientIrradiance( geometryNormal, directLight.direction );
vec3 irradiance = celBand * mix( uShadowTint, vec3(1.0), celBand ) * directLight.color;
```

`celBand` serves as both brightness and blend weight: lit bands ×1.0, dark bands pulled
toward a cool tint. Shadows change **hue**, not just value. This is the difference
between "anime cel" and "low-poly 3D".

```js
mat.onBeforeCompile = (s) => { s.uniforms.uShadowTint = uni; /* replace chunk */ };
mat.customProgramCacheKey = () => 'celTint_' + hex;   // omit ⇒ three shares one program across tints
```

Cache materials by parameter signature or the scene compiles hundreds of programs — but
**force no-cache for materials carrying a `map`/`alphaMap`** (textures are not shareable
by signature).

Two robustness rules for any ShaderChunk string replacement:

- **Guard the anchor** (`chunk.includes(anchorLine)`): a three.js upgrade that rewrites
  the chunk must *disable the patch*, not crash the app.
- **A silently-disabled patch needs a visible fallback check** — the failure mode is
  "shadows quietly stop being tinted", which nobody reports. Keep one automated frame
  or uniform check that goes red when the patch stops landing.

### 1c. `flatShading: true` by default

Smooth normals on low-poly geometry produce gradients that cross band boundaries and
smear. Flat shading puts each facet in one band.

**Exception: very thin geometry needs `flat: false`.** At reed/cable thickness only one
facet is ever visible, and a flat facet turned from the sun is near-black.

### 1d. Band count

| Case | bands |
|---|---|
| General | 3 |
| Small dark parts (tyres, cables, dark armour) | 2 — the mid band muddies them |
| Pale masses (blossom, snow, smoke, backlit glass) | `soft` / `soft3` — ramps shape **direct** light only; a low dark band drops to ambient and goes violet-black |

---

## L2 — Lighting: coloured shadows, not dark ones

```js
const sun = new THREE.DirectionalLight(0xfff1d8, 2.25);   // key, only shadow caster
sun.position.set(-52, 62, 56);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.035;

const fill = new THREE.DirectionalLight(0xa9bdf5, 1.08);  // cool, ~50% of key
fill.position.set(48, 26, -44);

const bounce = new THREE.DirectionalLight(0xd8cbe8, 0.34); // from below-front
bounce.position.set(10, -18, 40);

const hemi = new THREE.HemisphereLight(0xdcecff, 0xb6a6c6, 1.12); // ground colour must be chromatic
```

Fill at half the key is deliberate: L1b's tint only affects **direct** light, so this
lamp is what keeps shadows readable.

Use `PCFShadowMap`, not PCFSoft — cel needs crisp shadow shapes. Snap the shadow camera
to a grid following the player to stop shimmer.

---

## L3 — Screen-space ink: second difference of depth

O(1) draw calls, independent of object count; inks terrain, environment and distance
uniformly.

```glsl
#include <packing>
uniform sampler2D tDiffuse, tDepth;
uniform vec2  uTexel;
uniform float uNear, uFar;
uniform vec3  uInk;
uniform float uThickness, uSens, uConcave, uConcaveAmount;
uniform float uFadeStart, uFadeEnd, uStrength, uSkyDepth;
varying vec2 vUv;

float linearDepth( vec2 uv ) {
  return -perspectiveDepthToViewZ( texture2D( tDepth, uv ).x, uNear, uFar );
}

void main() {
  vec3 col = texture2D( tDiffuse, vUv ).rgb;
  vec2  t  = uTexel * uThickness;
  float dc = linearDepth( vUv );

  if ( dc > uSkyDepth ) { gl_FragColor = vec4( col, 1.0 ); return; }

  float dl = linearDepth( vUv - vec2( t.x, 0.0 ) );
  float dr = linearDepth( vUv + vec2( t.x, 0.0 ) );
  float du = linearDepth( vUv + vec2( 0.0, t.y ) );
  float dd = linearDepth( vUv - vec2( 0.0, t.y ) );

  float sx = ( dl + dr - 2.0 * dc ) / dc;      // second difference, distance-normalised
  float sy = ( du + dd - 2.0 * dc ) / dc;

  float convex  = max( 0.0,  sx ) + max( 0.0,  sy );
  float concave = max( 0.0, -sx ) + max( 0.0, -sy );

  float edge = smoothstep( uSens * 0.32, uSens, convex );
  edge = max( edge, smoothstep( uConcave, uConcave * 3.4, concave ) * uConcaveAmount );
  edge *= 1.0 - smoothstep( uFadeStart, uFadeEnd, dc );
  edge *= uStrength;

  vec3 line = mix( uInk, col * 0.42, 0.22 );   // keep a trace of base hue
  gl_FragColor = vec4( mix( col, line, clamp( edge, 0.0, 1.0 ) ), 1.0 );
}
```

Starting values: `uSens 0.0042`, `uConcave 0.026`, `uConcaveAmount 0.42`,
`uFadeStart 40`, `uFadeEnd 98` (metres), `uSkyDepth 420`.

**Four decisions, each fixing a specific failure:**

1. **Second difference, not first.** A first difference (depth Sobel) is large on grazing
   surfaces, so the whole road floods with ink. The second difference is **zero on any
   plane regardless of obliquity** — it fires only on real silhouettes and creases.
   This is the only depth-only edge detector that works without a normal buffer.
2. **Split convex/concave.** Convex full strength; concave ×0.42, mimicking the lighter
   contact lines an animator draws. Merging via `abs()` makes inside corners as black as
   silhouettes.
3. **Ink is not pure colour** — mix in some of the underlying colour or it looks pasted on.
4. **Fade with distance** so background dissolves into fog instead of getting busy.

```js
uThickness = 1.05 + 0.55 * scale;   // keeps lines ~2 device px at any resolution
```

`uThickness` (sample radius) is the parameter that replaces a normal buffer: too small
inks only aliasing, too large swallows window frames.

```js
const opts = { type: THREE.HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter,
               depthBuffer: true, stencilBuffer: false, colorSpace: THREE.NoColorSpace };
rtScene.depthTexture = new THREE.DepthTexture(2, 2);
rtScene.depthTexture.format = THREE.DepthFormat;
rtScene.depthTexture.type = THREE.UnsignedIntType;
rtScene.depthTexture.minFilter = rtScene.depthTexture.magFilter = THREE.NearestFilter;
```

`NearestFilter` on the depth texture is load-bearing: linearly filtered depth invents
values between surfaces, and a second difference amplifies them into false edges.

**Model for the ink pass** — the pass changes what geometry reads as:

- A hedge/bush row as instanced leaf blobs reads as **separate dark polyhedra**, because
  the ink fires on every blob's own silhouette no matter how densely they pack. Give such
  masses a solid dark core box and seat blobs only on the top and outer faces, where they
  break the lit silhouette.
- Ground pads want to be **shallow slabs, not planes** — the thin ink line around a
  forecourt's edge is what makes paving read as paving.
- Cheap tree shade: low-opacity dark discs (`depthWrite: false`, `noOutline`) beat real
  leaf shadows and cost nothing in the ink pass.

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
- Pre-process geometry with `mergeVertices(1e-4)` + `computeVertexNormals()` for smooth
  normals, or the shell splits at hard edges. Hard-normal geometry needs a separate
  smooth copy.
- `side: BackSide`, `castShadow = false`, `renderOrder = mesh.renderOrder - 1`.
- `InstancedMesh`: **share the same `instanceMatrix`**, don't copy.
- `SkinnedMesh`: `shell.bind(o.skeleton, o.bindMatrix)` to share the skeleton.

**Why not everywhere:** the ink pass already outlines every silhouette; 50 extra shells
are 50 extra draw calls in a scene that is measurably draw-call bound (~3050 calls /
20 ms at the heaviest view). Reserve shells for props needing a heavier, deliberate contour.

---

## L5 — Grade + FXAA

Grade in **linear space**, then convert manually (so `renderer.toneMapping = NoToneMapping`
and RTs use `NoColorSpace`).

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

**AA: supersample + FXAA, not MSAA.** MSAA does nothing for lines produced in a pass —
they are not on geometry edges.

```js
let scale = dpr < 1.5 ? 1.5 : Math.min(dpr, 2);
if (w * h * scale * scale > pixelBudget) scale = Math.max(1, Math.sqrt(pixelBudget / (w * h)));
renderer.setPixelRatio(1);
renderer.setSize(w, h, true);   // canvas = display size; RTs carry the scale
```

---

## Sky: painted backdrop, not atmosphere

Three-stop `BackSide` dome with **deliberate residual banding**:

```glsl
float t = clamp( h * 1.15 + 0.02, 0.0, 1.0 );
float q = floor( t * 26.0 ) / 26.0;
t = mix( t, q, 0.35 );
```

Clouds: billboards, `depthWrite: false`, `fog: false`, two opacities layered.
Match linear fog range to the ink fade range — distance is handed to fog, not to lines.

---

## Geometry-side discipline

| Rule | Symptom if broken |
|---|---|
| Transparent materials never cast shadows | Glazed cabinet shadows its own contents; stock goes muddy |
| Thin / transparent meshes `depthWrite: false` | Ink pass outlines petals and cables into speckle |
| Pale canopies / masses never `receiveShadow` | Ramps shape direct light only ⇒ **dark circles floating in the sky** |
| Thin overhanging copings `castShadow = false` | Self-shadow lands as a sawtooth row, not a line |
| Closed sky/planet spheres `castShadow = false` | The far hemisphere renders into the shadow map and drops the **entire world** into shadow — everything uniformly dark for no visible reason |
| Ground-hugging decals marked `noOutline` | Road patches / tyre marks / lane paint get inked |
| Lift very dark base colours | Dark green in the bottom band lands within a few % of ink; glazing, seams and shut lines stop existing. A prop that lives in *permanent* shade wants near-white |
| Anything inside an unlit recess gets `emissive` (~0.4) | The recess and its contents are all on the ramp's bottom band within a few % of each other; **choosing a lighter colour buys nothing when the surface gets no direct light**. Emissive lifts value while keeping the shading — the lit-button trick |
| Saturated lamp/accent surfaces stay small | A 0.26 m flat-red lamp is the loudest thing in any frame; real clusters are smaller, deeper, and split by housing bars |
| Check texture aspect against the face | 512×128 on a 0.24×1.5 m face is 25× horizontal crush — renders as blur, not an error |
| Single-sided planes must face the viewer they exist for | A painted interior / poster / curtain on a frontage looking −z is back-face culled — simply absent, no error. `rotation.y = atan2(nx, nz)` for outward normal `(nx, nz)` |
| Merge a multi-box body into one mesh before hull-outlining it | Per-mesh contour ink draws every internal seam of a five-box prop |
| Dispose one-shot geometry/materials; register shared geometry first | Frame time degrades over play session |
| Multi-material meshes must keep `geometry.groups` through every rebuild pass | A material array without groups is **not drawn at all**, silently — one subdivision/`toNonIndexed()` pass took out all 54 signs at once and looked like an art choice |

### Normals under a cel ramp

- **`computeVertexNormals()` on a non-indexed geometry IS flat shading** — every vertex
  gets the face normal, and `flat: false` on the material changes nothing. Any pass that
  rebuilds geometry as a bare position list (CSG cuts, subdivision) de-indexes it. For
  analytic surfaces take normals analytically (radial for a sphere: one loop, exact);
  otherwise `mergeVertices` before computing.
- **Re-read `geometry.attributes.position` after any pass that replaces it.** Writing the
  normal buffer from the pre-pass attribute gives a shorter array; three.js does not
  complain — it shades the tail of the mesh with whatever is in memory.
- **A smooth analytic surface under a cel ramp has no shading on it.** Near-coplanar
  ground quantises to one band with a hard straight edge. The fix is geometry (faceting,
  scattered bumps), not tone — and never sine-based bumps: a plane wave gives every ridge
  the same bearing and the ink pass draws them as parallel straight lines
  (see `procedural-object-detail` L2).

---

## Port order (value per effort)

1. `MeshToonMaterial` + hand-written 3-stop ramp + `flatShading` — 80% of "cartoon".
2. Patch `lights_toon_pars_fragment` for shadow tint — one GLSL line, the key 20%.
   Include `customProgramCacheKey`.
3. Strong cool fill (~50% of key) + chromatic hemisphere ground — zero shader cost.
4. Depth second-difference ink pass — ~60 lines GLSL, no normal buffer, no G-buffer.
5. Supersample + FXAA — line quality lives here.
6. Split-tone grade + lift.
7. Inverted hull, last, for 3–5 hero objects only.

Steps 1–3 give usable cel shading. **Step 4 is what moves it from "toon rendering" to
"animation background".**

---

## Symptom → cause

| Observed | Cause |
|---|---|
| A whole slope in one tone with a few straight ink creases | Ramp bands cannot be crossed (L1a). Needs a value ladder, not more relief |
| Entire road flooded with ink | First difference used; switch to second |
| Inside corners as black as silhouettes | `abs()` merged convex and concave |
| Lines vanish at distance / bloat up close | Hull extruded in object space; use clip space × `clip.w` |
| Grey shadows, frame reads as low-poly 3D | Missing L1b shadow tint, or fill too weak |
| Petals / cables render as scattered dots | Thin meshes still writing depth |
| Dark circles hanging in the sky | Pale masses with `receiveShadow` on |
| Dark vehicle/mech is a flat silhouette | Base colour too dark; bottom band ≈ ink colour |
| The shading terminator is a staircase of triangles | Face normals where smooth were intended — `computeVertexNormals` on non-indexed geometry (see "Normals under a cel ramp") |
| A detail inside a recess is invisible however light its colour | It is on the ramp's bottom band with everything around it — needs `emissive`, not a lighter colour |
| Material colour edit produces a **pixel-identical** frame | That face is not being drawn — two coplanar faces. Never a subtle material problem |
| Bad aliasing on mobile | MSAA is a bandwidth cost on tilers and does nothing for pass-drawn lines |
