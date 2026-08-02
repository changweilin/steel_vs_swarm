---
name: procedural-canvas-textures
description: Draw every texture at runtime with Canvas2D instead of shipping image assets — signage, posters, plates, liveries, price strips, alpha masks, decals. Covers the cache/variant system, text fitting, aspect-ratio matching, and the traps that render as blur or mirror writing rather than as errors. Use when adding signs/labels/decals/UI-on-geometry, when asked to avoid binary assets, or when a texture looks smeared, mirrored or unreadable.
license: MIT
compatibility: browser Canvas2D + Three.js CanvasTexture (or any engine accepting a canvas)
---

# Procedural Canvas Textures

Ship **zero binary image assets**. Every sign, poster, price strip, livery and alpha mask
is drawn with Canvas2D at start-up. Keeps the repo small, makes every string editable in
code, and makes localisation and variants free.

Method source: sakura-crossing `src/core/textures.js` (134 exported generators).

**Art direction constraint that makes this work:** keep everything **flat and
low-frequency** — crisp shapes and type, never photographic noise. Procedural canvas art
is good at flat colour and text and bad at grain; a stylised target (cel, flat, low-poly)
is what makes that a feature.

---

## Core plumbing

```js
const cache = new Map();

function make(w, h, draw, { srgb = true, repeat = null, aniso = 4 } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = true;
  draw(c, w, h);
  const tex = new THREE.CanvasTexture(cv);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  if (repeat) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(repeat[0], repeat[1]); }
  tex.needsUpdate = true;
  return tex;
}

const cached = (key, fn) => (cache.has(key) ? cache.get(key) : (cache.set(key, fn()), cache.get(key)));
```

**Every generator is `cached(key, …)`.** Textures are shared across hundreds of instances;
uncached generation is both a memory leak and a shader-program explosion (a mapped material
usually cannot be reused from a plain colour cache).

---

## Variants: a `variant` index or a `kind` string

```js
export const poster = (variant = 0) => cached('poster' + variant, () =>
  make(320, 448, (c, w, h) => {
    const sets = [
      { bg: '#fdf7e8', bar: PAL.red,   t: 'Spring Fair', s: 'April 5' },
      { bg: '#eef6fd', bar: PAL.blue,  t: 'Residents',   s: 'Cleaning rota' },
    ];
    const st = sets[variant % sets.length];
    /* draw from st */
  }));
```

- `variant` (number, `% length`) for interchangeable members of one family — callers can
  pass a seeded `rng.int(0, n-1)`.
- `kind` (string, with a `?? default`) when the caller means a **specific** thing
  (`shopFascia('conbini')`, `noren('ramen')`). Never make a semantic choice an integer.
- Keep sets **appended, never reordered** — every call site holds an index.

---

## Text helpers

Text is the whole reason to do this, and unfitted text is the most common defect.

```js
function fitText(c, text, maxW, size, font, weight = 'bold') {
  let s = size;
  do { c.font = `${weight} ${s}px ${font}`;
       if (c.measureText(text).width <= maxW) break;
       s -= 2; } while (s > 6);
  return s;
}

function centered(c, text, x, y, maxW, size, color, weight = 'bold', spacing = 0) {
  const s = fitText(c, text, maxW, size, FONT, weight);
  c.fillStyle = color; c.textBaseline = 'middle';
  if (!spacing) { c.textAlign = 'center'; c.fillText(text, x, y); return s; }
  c.textAlign = 'left';                       // manual letter-spacing
  const chars = [...text];
  const total = chars.reduce((a, ch) => a + c.measureText(ch).width + spacing, -spacing);
  let cx = x - total / 2;
  for (const ch of chars) { c.fillText(ch, cx, y); cx += c.measureText(ch).width + spacing; }
  return s;
}

function vertical(c, text, x, y0, step, size, color) {   // CJK vertical setting
  c.font = `bold ${size}px ${FONT}`; c.fillStyle = color;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  [...text].forEach((ch, i) => c.fillText(ch, x, y0 + i * step));
}
```

- **Always `fitText`.** A hard-coded size overflows the moment a string is translated or a
  variant gets a longer name, and it clips silently.
- **Iterate with `[...text]`**, not `text.split('')` — the latter splits surrogate pairs.
- **Declare a font stack with explicit fallbacks** for the scripts you use; a missing font
  substitutes silently and changes every metric.
- Manual letter-spacing (`spacing`) is needed for display type; `letterSpacing` on canvas
  is not universally supported.

---

## Aspect ratio is the number-one trap

**Check the texture's aspect against the face it lands on, before drawing anything else.**

A 512 × 128 texture on a 0.24 × 1.5 m post face is a 25-fold horizontal crush. It renders
as an unreadable vertical smear — **not as an error**. If a decal looks blurry, compare the
two ratios first; it is almost never a filtering problem.

Pick canvas dimensions from the *physical* face:
`canvasW / canvasH ≈ faceW / faceH`, then scale to a resolution that gives ~200–400 px
per metre at the closest viewing distance.

---

## Two-sided plates: do **not** mirror

`BoxGeometry` builds each face with its own `udir` and already reverses it on the negative
face of every axis, so **one map reads correctly from both sides of a plate**. Adding a
mirrored copy is what *produces* the mirror writing it was meant to prevent.

This was wrong on every two-sided sign in the reference project until it was verified by
rendering the same plate from both sides. Do that check.

Related geometry rule: **a sign plate must be thicker than the post it is bolted to.**
A 0.04 plate sitting 0.03 in front of a 0.09 post lets the post come through the printed
face. Two-sided plates: ~0.12 thick, centred on the post. Single-sided: in front of it.

---

## Masks and repeats

- **Alpha masks** (netting, foliage, petals): draw genuinely transparent gaps, do not fake
  with low opacity. A flat panel at low opacity reads as tinted glass, not as mesh; a real
  lattice mipmaps down to a pale wash at distance instead of aliasing.
- **Tiling** (shutters, cladding, ballast): use a small canvas + `RepeatWrapping`. Bake
  the lighting cue into the pattern — alternating light/dark bands plus a shadow line reads
  as slats, whereas one flat colour reads as a hole.
- Set `colorSpace = SRGBColorSpace` on colour maps; leave masks/data maps linear.
- `anisotropy = 4` is enough for signage viewed obliquely.

---

## Building a texture set

1. **One module** exports every generator. One cache, one font stack, one palette import.
2. **Colours come from the shared palette**, not from hex literals scattered in draw calls —
   otherwise signage drifts away from the world's colour scheme.
3. **Small helper vocabulary first** (`centered`, `vertical`, `fitText`, `hex(n)`), then the
   generators; each generator should be 10–30 lines of flat drawing.
4. **Name generators after the object**, not the appearance (`vendPrice`, `warningPlate`,
   `busTimetable`), so call sites read as the world.
5. **Instantiate lazily.** Generators are called at build time of the object that needs them;
   the cache makes repeats free.

---

## Symptom → cause

| Observed | Cause |
|---|---|
| Vertical or horizontal smear instead of type | Canvas aspect vs face aspect mismatch |
| Mirror writing on one side of a sign | An explicit mirror was added; box faces already handle it |
| Post/edge cuts through printed characters | Plate thinner than what it is mounted on |
| Text clipped or overflowing on one variant only | Fixed font size instead of `fitText` |
| Glyphs render as boxes or wrong metrics | Font missing from the stack; silent substitution |
| Memory climbing with object count | Generator not `cached`; a texture per instance |
| Netting looks like tinted glass | Low-opacity panel instead of a real alpha lattice |
| Colours drift from the rest of the scene | Hex literals in draw calls instead of the palette |
