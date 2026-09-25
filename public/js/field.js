// ============ Surface Property Field (deterministic scattered ellipse field; sole seam) ============
// Evaluates low-frequency, non-directional spatial variance ("more or less than surroundings") --
// driving terrain ramp selection (terrain.js imageless path) and weathering/moss/rust density.
//
// Value noise evaluates each point independently, yielding uniform speckle across large areas without regional clustering;
// pure distance fields (distance to water, blast center, elevation) stay constant over uniform zones.
// A scattered ellipse field sprinkles a small number of large ellipses with individual weights, evaluated via weighted average.
//
// Core invariants:
//   1. MUST use weighted average `s / max(W_MIN, w)`, MUST NOT sum -- summation saturates into a constant as ellipses overlap.
//   2. Lower bound `W_MIN` on denominator is required: uncovered voids where w -> 0 would divide toward +-infinity.
//      Clamping gracefully returns void areas to neutral 0.5.
//   3. Deterministic scatter (AGENTS.md principle 3): caller provides seed (battle center);
//      each ellipse consumes exactly 6 random numbers without rejection sampling -> bit-identical across clients.
import { mulberry32 } from './rng.js';

const W_MIN = 0.55;      // Lower bound on weighted average denominator (invariant 2)
const N_BLOB = 26;       // Ellipse count: too few loses regional structure, too many cancels toward constant

/**
 * Construct a property field.
 * @param seed   Integer seed (caller uses battle center, matching biomes.js scatter)
 * @param span   Arena span (meters); ellipse radii derive from span, MUST NOT be hardcoded
 * @returns (x, z) => 0..1 (0.5 = neutral; uncovered areas default to neutral)
 */
export function makeField(seed, span) {
  const rnd = mulberry32(seed >>> 0);
  const R0 = span * 0.10, R1 = span * 0.34;    // Ellipse radius range: < 1/10 span becomes high-frequency noise
  const blobs = [];
  for (let i = 0; i < N_BLOB; i++) {
    // Exactly 6 numbers: center x/z, radii a/b, rotation, value. No rejection sampling -> sequence stays aligned.
    const cx = (rnd() - 0.5) * span * 1.2;
    const cz = (rnd() - 0.5) * span * 1.2;
    const ra = R0 + rnd() * (R1 - R0);
    const rb = R0 + rnd() * (R1 - R0);
    const th = rnd() * Math.PI;
    const val = rnd();
    blobs.push({ cx, cz, ia: 1 / ra, ib: 1 / rb, ca: Math.cos(th), sa: Math.sin(th), val });
  }
  return (x, z) => {
    let s = 0, w = 0;
    for (const b of blobs) {
      const dx = x - b.cx, dz = z - b.cz;
      const u = (dx * b.ca + dz * b.sa) * b.ia, v = (-dx * b.sa + dz * b.ca) * b.ib;
      const d2 = u * u + v * v;
      if (d2 >= 1) continue;
      const k = 1 - d2;                        // Smooth falloff to 0 at boundary (no hard circle edges)
      s += b.val * k; w += k;
    }
    return w > 0 ? s / Math.max(W_MIN, w) : 0.5;   // Invariants 1 & 2: weighted average + denominator clamp
  };
}

/**
 * Tone ladder: partitions property field into n steps, returning `(x, z) => 0..n-1`.
 *
 * Thresholds evaluate local field quantiles, MUST NOT use fixed constants:
 * The field is a weighted average of sparse ellipses; distribution drifts with seed.
 * Fixed thresholds can concentrate over 50% of the terrain into a single ramp step on certain seeds.
 * Quantile sampling guarantees each ramp step spans ~1/n of the terrain regardless of seed.
 * Jitter adds a coarse hash offset coarser than the field and finer than sample grid to break isoline contour rings.
 *
 * @param field  Output of makeField
 * @param b      Sampling bounds { minX, maxX, minZ, maxZ } (terrain mesh world bounds)
 * @param n      Number of steps
 * @param jitM   Jitter cell width (meters); amplitude fixed to +-25% of one step
 */
export function makeToneLadder(field, b, n, jitM) {
  const S = 96;                                   // Quantile sample grid (deterministic: fixed resolution)
  const vals = new Float32Array(S * S);
  for (let i = 0; i < S; i++) {
    const z = b.minZ + (b.maxZ - b.minZ) * (i + 0.5) / S;
    for (let j = 0; j < S; j++) vals[i * S + j] = field(b.minX + (b.maxX - b.minX) * (j + 0.5) / S, z);
  }
  const sorted = Float32Array.from(vals).sort();
  const th = [];
  for (let k = 1; k < n; k++) th.push(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * k / n))]);
  // Jitter amplitude = +-25% of one step: larger creates noise, smaller reveals isolines
  const amp = ((sorted[sorted.length - 1] - sorted[0]) / n) * 0.5;
  return (x, z) => {
    const v = field(x, z), h = (coarseHash(x, z, jitM) - 0.5) * amp;
    let k = 0;
    while (k < th.length && v > th[k] + h) k++;
    return k;
  };
}

/**
 * Bake field into a small 2D grid for weathering density texture (sole seam).
 *
 * Pre-baked to a texture because evaluating 26 ellipses per pixel on large terrain
 * costs millions of tests per frame. Since the field is low-frequency (radius >= 1/10 span),
 * a 64x64 grid is an order of magnitude finer than the smallest feature and interpolates smoothly.
 *
 * Returns Uint8Array rather than THREE.DataTexture to preserve zero-dependency Node execution for audits;
 * toon.js maintains the sole seam for DataTexture construction.
 *
 * @param field  Output of makeField
 * @param b      World bounds { minX, maxX, minZ, maxZ }
 * @param size   Grid dimension
 * @returns Uint8Array (size x size; row = z, col = x; 0..255 mapped to field 0..1)
 */
export function bakeFieldTexture(field, b, size = 64) {
  const out = new Uint8Array(size * size);
  for (let i = 0; i < size; i++) {
    const z = b.minZ + (b.maxZ - b.minZ) * (i + 0.5) / size;
    for (let j = 0; j < size; j++) {
      const x = b.minX + (b.maxX - b.minX) * (j + 0.5) / size;
      const v = field(x, z);
      out[i * size + j] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
  }
  return out;
}

/**
 * Coarse hash for threshold jitter (0..1).
 * Threshold jitter prevents uniform isolines from forming contour map rings.
 * Grid MUST be much smaller than ellipses and coarser than sample points to avoid high-frequency white noise.
 */
export function coarseHash(x, z, cellM) {
  const i = Math.floor(x / cellM), j = Math.floor(z / cellM);
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
