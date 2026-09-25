# Geology Object Generation

> SSOT: `public/js/geology.js` (`GEOLOGY_TYPES`, `GEOLOGY_SURFACES`, `BATTLE_GEOLOGY`),
> `ancientStone.js` (selection and weights), `ancientRuins.js` (ruin geometry).
> Stylized renderable geology consumed through the `backgroundObjects.js` shared
> catalog outlet. Preview via `npm run preview:gen`, geology tab on
> http://127.0.0.1:8644 -- loopback only, never mounted on the live battle server.
> Verification: `node tools/audit_geology.mjs`, `node tools/audit_battle_geology.mjs`.

## Constraints (why, not what)

- Data ranges are art defaults, not surveys: natural widths/heights/ages/roughness
  sample from catalog intervals, overrideable with positive finite meters; measured
  bounds come from output vertices. Ages date formation, never exposure; weathering
  reads `exposure`, never rock age. Peak height over the unrotated footprint diagonal
  MUST respect each entry's `maxHeightDiagonalRatio` (reefs/flats lowest, cliffs and
  towers keep native steepness); post-grid peaks rescale preserving platform/pool
  proportions. Vegetation debris, vents, and terrain altitude never count as outcrop
  height.
- Heightfield honesty: arches and hoodoos are excluded from legacy migration because
  heightfields cannot express holes or overhangs -- never fake solid arches or
  floating caprocks. Natural geology uses 28x28 heightfields; no caves, overhangs,
  fluid simulation, reflective water, or measured strata anywhere.
- Steep gate is unpassable by weights: above 45 degrees, auto-sampling drops every
  entry without `terrainFit` before normalizing (currently only cliff, basalt, fin
  qualify); rain, volcanic, human, or water weights MUST NOT bypass it. Explicit
  category selection is a bench override, never a placeability claim.
- Drape-or-null: any non-finite sampled height returns `null` for the whole object
  and the caller skips; callers pass `slope` as the full-footprint maximum. Unsampled
  calls keep the horizontal-datum standalone model.
- Scatter isolation: boulder fields use an independent coordinate seed stream (one
  type seed per cluster, per-rock shape kept); later geology extensions consume zero
  shared scene randomness. Cover probability caps at 90% with bare rock as remainder;
  attachments sample already-generated triangle centroids with matching normals.
- Monument fixed-proportion contract: relic bodies keep fixed part ratios and
  positions; seeds change only overall scale, heading, and surface. `uniformScale`
  is a single number (sampled 0.5-1.5, explicit 0.01-10); three-axis `scale` throws.
  Region circles are art-applicability zones, never borders or historical claims;
  unmatched coordinates sample generic ruins, which means "no catalog match", never
  "no history here". Qin mausoleum never fabricates the unexcavated palace.
- Never combat geometry: visual meshes MUST NOT be fed to battle raycasts; natural
  crags join the existing scatter/height/blocker pipeline while the rest stay
  standalone. Human-made entries use fixed templates with uniform scaling only.
