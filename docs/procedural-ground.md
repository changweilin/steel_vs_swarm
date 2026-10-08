# Procedural Ground Surfaces and Attachments

> SSOT: `public/js/groundCatalog.js` (venue purpose, landscape, surface classes, size
> and environment limits), `groundPartCatalog.js`, `proceduralGround.js`,
> `proceduralGroundParts.js`, `groundMarkings.js` (the former `groundVenues.js`,
> `groundLandscapes.js` and `groundVisitorSites.js` were consolidated into the
> catalogs). No external model downloads, no
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
- Ground and geology consume `seasonalEnvironment.js` so explicit temperatures,
  latitude/elevation cooling and snow availability agree with plant presentation.
  Snow paints above natural surface patterns; tropical winter alone does not create
  snow, and known geology continues to drive soil pH and mineral fragments.
- Decorative flower visibility and grass/crop colors read each instance's environment
  after placement. Dormancy cannot alter scatter consumption or physical-detail
  collision; manufactured accessories retain their original colors.
- Boundary and buffer rock covers use `seasonalSurface.js` on existing linear vertex
  colors. Upward-facing surfaces retain snow; vertical walls and undersides do not.
  Wetness darkens exposed stone without changing topology, bounds or colliders.
- Generic rock landforms share the ground mineral palette in `seasonalEnvironment.js`.
  Named rock types and vegetated hills retain their authored materials; substrate
  changes affect vertex colors without consuming randomness or rebuilding geometry.
- Ground textures sample local elevation. Quantized cover/growth states share
  textures and geometry batches, while placement seeds and seam heights stay
  independent of those states. One map can contain both bare valleys and snowy peaks.
- Buffer props and backdrop constructors accept the same environmental snapshot.
  Summit snow uses the temperature and moisture at its elevation, including high
  alpine summer snow; the seasonal label alone cannot create snow in warm climates.
