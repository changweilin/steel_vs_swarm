# Vessel Generation and Loadout Design

> SSOT: `public/js/vesselCatalog.js` (compatibility, materials, envelopes),
> `vesselLayout.js` (hull/cabin, loadout zones, outfit sampling), `vesselModels.js`,
> `vesselEquipmentModels.js` (built from the same config). Photo-reconstructed exact
> scales stay in `tools/ai3d/ship_scale_catalog.mjs`; this pipeline manages
> procedural hulls only. Verification: `node test/vessels.mjs` (43 hulls x 100 seeds,
> slot exclusivity, clearance, wake, disposal), `tools/audit_aquatics.mjs`,
> `tools/audit_gpu_lifecycle.mjs`, `tools/audit_client_syntax.mjs`.

## Constraints (why, not what)

- Background only: adds no weapon damage, ammo, or combat AI. Displayed aircraft counts
  are bounded showcase numbers, not full wing complements.
- Design envelopes, not naval data: all numbers are game art envelopes. Displacement is
  a size-derived tonnage estimate, never GT or DWT; per-hull dimensions live in the
  catalog, not here.
- Capacity-bounded loadouts: every zone has allowed kinds, slots, min/max occupancy,
  deck height, and tiers. Counts are space-limited with aisles kept; barrels, booms,
  wings, and rotors MUST fit entirely inside their reserved bounding boxes.
- Hull-type discipline: oilers never render exposed LNG spheres (separate ball vs
  membrane covers); small hulls take capped light mounts, never full VLS spreads;
  open boats float slightly above the surface on shallow seats so the shared water
  plane never clips through cabin floors.
- Fit-or-skip placement: scene budgets cap cruise/moored/research hulls; deck width
  joins the site check, and shallow water or narrow channels skip instead of forcing
  carriers and long freighters into small maps.
