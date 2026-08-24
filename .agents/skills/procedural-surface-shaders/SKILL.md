---
name: procedural-surface-shaders
description: Shade many merged WebGL objects with one material while preserving distinct textureless surfaces through packed per-vertex metadata and world-space or triplanar procedural patterns. Use when draw-call reduction requires a shared master surface shader. Do not use for Canvas2D signs, cel-light bands, outline detection, geometry scatter, or offline PBR texture generation.
license: MIT
compatibility: WebGL2 / Three.js RawShaderMaterial or ShaderMaterial; textureless and merged procedural scenes
---

# Procedural Surface Shaders

One shader program can preserve many authored-looking surfaces if surface identity travels with the vertices instead of with separate material objects.

Method source: `winchxyz/bikini-bottom` `src/core/{builder,materials,glsl}.js`.

## Boundary

This skill owns only the surface-data contract and procedural surface evaluation:

```text
geometry batch
  -> packed base colour + pattern id + scale + gloss + detail + surface identity
  -> procedural pattern sample
  -> albedo multiplier + gloss delta + stable identity
```

- Text, signs, liveries, decals, and alpha masks belong to `procedural-canvas-textures`.
- Light bands, shadow hue, grading, LUTs, and AA belong to `cel-shading-pipeline`.
- Depth/normal/identity edge interpretation belongs to `anime-line-control`.
- Geometry variation, foliage silhouettes, scatter, and weathering placement belong to `procedural-object-detail`.
- Offline albedo/normal/roughness generation belongs to `ai-pbr-texturing`.

Do not duplicate those systems inside a master surface shader. Return the data they consume.

## 1. Pack the material row per vertex

Use normalized integer attributes where precision permits:

```js
geometry.setAttribute('surfaceColor', new THREE.BufferAttribute(new Uint8Array(colors), 4, true));
geometry.setAttribute('surfaceParams', new THREE.BufferAttribute(new Uint8Array(params), 4, true));
```

A useful four-byte parameter row is:

```text
R pattern id     integer after round(x * 255)
G pattern scale  logarithmic encoding across the supported world-unit range
B gloss          0..1
A detail amount  0..1
```

Keep tint participation in the colour alpha or in a separate bit/byte. Wheels, glass, lamps, and trim commonly keep their authored colour while body panels accept an instance tint.

Rules:

- Decode once. If the CPU colour API already converted sRGB to linear, convert back before storing sRGB bytes or the shader will apply the transfer twice.
- Pattern ids are an append-only ABI. Reordering the table silently repaints every standing object.
- Record the byte layout next to both writer and shader declaration; changing one without the other produces plausible but wrong surfaces.
- All merged attributes must have exactly the position count. Fail the build on a mismatch.

## 2. One surface generator, narrow variants

Build one shader generator and express variants with a small set of defines or injected snippets:

- static opaque world;
- foliage with vertex sway;
- instanced moving props;
- terrain with a different terracing factor;
- transparent glass as a separate material contract.

Do not turn every object kind into a shader variant. A variant is justified by render state, vertex animation, or a genuinely different output contract—not by a new colour or pattern.

The shadow/depth pass must repeat every vertex deformation and alpha discard used by the colour pass. Otherwise the object and its shadow occupy different geometry.

## 3. Evaluate patterns in stable coordinates

Use world-space or triplanar sampling for surfaces that cross many merged primitives. UV-only patterns reveal every primitive boundary and scale change.

```glsl
vec4 surface = patternSample(patternId, worldPos, worldNormal, uv, patternScale, detail);
albedo *= surface.rgb;
gloss = clamp(gloss + surface.a, 0.0, 1.0);
```

- Use triplanar coordinates for stone, concrete, corrosion, soil, and other direction-independent fields.
- Use explicit local/UV coordinates when direction carries meaning: planks, brick courses, grating, shingles, stripes.
- Derive pattern scale in real-world units. Rescaling an object must not rescale brick or rivet size accidentally.
- Skip expensive pattern branches when their contribution is below a measured threshold.
- Hard-mask categorical material changes in a cel scene; smooth blends create the only soft boundary in the frame.

Procedural patterns must be deterministic functions of supplied coordinates and stable ids. Do not consume scene RNG in the shader contract.

## 4. Preserve stable surface identity

The line/info pass needs a stable identity that does not fluctuate across a continuous colour field.

- Hash a discrete surface row or explicit surface id, not continuously varying albedo.
- Pin one identity for continuous terrain unless an authored material boundary should ink.
- Fold categorical pattern masks into identity only when their boundary is meant to draw a line.
- Never derive collision, navigation, or authority from a procedural pattern.

## 5. Batch admission

The CPU geometry batcher belongs to `generator-table-catalog`; this skill only defines what may share the shader contract.

Objects may share a batch when they have compatible:

- transparency and depth-write state;
- shadow participation;
- vertex animation;
- culling lifetime and spatial partition;
- surface attribute schema.

Keep glass, alpha-tested foliage, animated pivots, and one-shot/disposable objects out of a static opaque batch. Partition world-scale geometry by district or cell so draw-call savings do not destroy frustum culling.

## Verification

1. Assert equal vertex counts for position, normal, UV, colour, parameters, and every optional attribute.
2. Render a pattern-id chart with identical geometry and verify each row selects exactly one pattern.
3. Render the same patterned object at two scales; world-unit pattern size must remain constant.
4. Compare colour, shadow/depth, and info outputs after every vertex-animation change.
5. Verify surface identity is constant across a continuous field and changes at one intentional categorical boundary.
6. Report draw calls, triangles, and resident buffer bytes separately. Fewer draws can still use more memory.

## Reference implementation

- Packed attributes and transform-stack batch writer: `https://github.com/winchxyz/bikini-bottom/blob/main/src/core/builder.js`
- Master surface shader and two-attachment output: `https://github.com/winchxyz/bikini-bottom/blob/main/src/core/materials.js`
- Procedural pattern functions: `https://github.com/winchxyz/bikini-bottom/blob/main/src/core/glsl.js`

