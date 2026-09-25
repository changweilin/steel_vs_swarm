# Procedural Ground Surfaces and Attachments

> SSOT: `public/js/groundCatalog.js` (venue purpose, landscape, surface classes, size
> and environment limits), `groundPartCatalog.js`, `proceduralGround.js`,
> `proceduralGroundParts.js`, `groundVenues.js`, `groundMarkings.js`,
> `groundLandscapes.js`, `groundVisitorSites.js`. No external model downloads, no
> generation service, no new npm dependencies.
> Verification: `node test/proceduralGround.mjs`, `node tools/audit_ground_tile.mjs`,
> `audit_ground_enclave.mjs`, `audit_ground_border.mjs`, `audit_ground_qc.mjs`,
> `audit_ground_seam.mjs`, `audit_gpu_lifecycle.mjs`, `audit_client_syntax.mjs`.

## Constraints (why, not what)

- Courts are proportions, not construction drawings: sport venues keep regulation
  ratios scaled to map space (large stadiums are not real-meter builds), and markings
  cover only the primary readable rule lines -- league/age variants are deliberately
  unpainted. Culture tags mark design origin for browsing, never nationality gates.
- Fit-or-skip grading: courts check the full rotated footprint (corners and interior,
  max 2m sampling) against per-venue height caps; failures skip without touching
  authority terrain. Hardware skips when footprint relief exceeds 0.3m so nothing
  floats on slopes.
- RNG isolation: surface-local randomness and coordinate hashes never consume other
  scene systems' shared sequences; same venue, seed, and environment rebuild
  identical results.
- Presentation-only weathering: opening weather tints base colors and textures once;
  mid-battle dynamic weather stays with the existing weather/material systems and
  never regenerates textures per frame.
