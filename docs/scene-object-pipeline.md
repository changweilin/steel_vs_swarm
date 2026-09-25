# Scene Object Startup Generation and Placement

> SSOT: the generating source files plus `tools/audit_siteplan.mjs`,
> `tools/audit_world_edge.mjs`, and `tools/audit_client_syntax.mjs` headers.
> This note states current-state constraints only; per-round work logs, dates,
> counts, and transitional recipes are omitted by design.

## Current-state constraints (why, not what)

- Environment buildings share the OSM/architecture generator (`chooseArchitecture`,
  `architecturalFacadeParts`, `architecturalRoofParts`): one facade/roof rule set,
  so style, window, trim, and adaptive-roof behavior cannot drift between OSM and
  environment paths.
- Damaged infrastructure reuses solid-body placement (whole-envelope fit, rigid
  topple onto terrain): debris reads as destroyed construction, never as new buildings.
- Hollow shells (chimneys, cooling towers) stay open-channel solids with marker rings
  derived from the wall at their height, so rings neither bury nor float after taper.
- Slope/coast engineering previews render through the shipped section builders, so
  previews and battlefield sections share one source instead of a second recipe.
- Placement skips cleanly on failing ground (over-steep, water-unqualified, no
  structure fit): missing props are preferable to terrain edits that hide gaps.
