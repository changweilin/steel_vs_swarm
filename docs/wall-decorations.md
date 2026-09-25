# Procedural Building Wall Decorations

> SSOT: `public/js/wallDecorationCatalog.js` (motif registry) and
> `public/js/wallDecorations.js` (selection and placement). Appearance-only;
> verification: `node test/wallDecorations.mjs`, `node tools/audit_siteplan.mjs`.

## Constraints (why, not what)

- Wall decor never affects gameplay: no collision, no new material buckets, no new
  package dependencies, zero shared-RNG consumption.
- Height gate: irregular decor generates only on low-rise buildings (height <= 24m).
  High-rises keep only regularly repeating functional fittings (balconies, canopies,
  AC units), which are exempt because their rhythm is the facade, not noise.
- Fit-or-skip: existing doors, canopies, balconies, and signs project their footprints
  first; at most 12 placement tries, then the motif is skipped whole. A motif stays
  intact or absent, never clipped in half by a depleted budget (caps: 2 groups per
  wall, 8x6m per group, 160 parts per building).
- Seamless vines: cross-tile vine bands share seam endpoint positions and tangents
  (continuous joints) while interiors grow from per-tile coordinate hashes (never
  repeating), so multi-tile runs join without visible seams or clones.
- Era guard: historic buildings take no modern ads or electronic boards. TV walls use
  static program patterns only -- no video downloads, no per-frame updates.
