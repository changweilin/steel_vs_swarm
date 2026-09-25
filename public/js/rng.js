// ============ Deterministic RNG (mulberry32; sole seam for the project) ============
// Determinism (AGENTS.md principle 3): cross-client scene consistency rests on this module (battle center as seed); scatter paths MUST NOT use `Math.random()`.
// Standalone module with zero imports so offline audits can replay the same sequence in Node;
// `hazards.js` / `biomes.js` import three (CDN importmap, unloadable in Node) --
// keeping RNG clear of three avoids forcing every tool to copy mulberry32 and diverge from the single sequence.
// `hazards.js` re-exports the legacy entry point for compatibility.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
