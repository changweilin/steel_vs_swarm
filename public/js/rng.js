// ============ Deterministic RNG (mulberry32; sole seam for the project) ============
// Why zero imports: offline audits replay this same sequence in Node, while
// `hazards.js` / `biomes.js` import three (CDN importmap, unloadable in Node).
// A three-coupled RNG would force every tool to copy mulberry32 and diverge.
// `hazards.js` re-exports the legacy entry point for compatibility.
/**
 * Deterministic PRNG stream.
 * pre: `seed` is the battle-center-derived integer (same input = same stream).
 * post: returns a function yielding successive values in [0, 1).
 * invariant: zero imports; scatter paths MUST NOT substitute `Math.random()`.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
