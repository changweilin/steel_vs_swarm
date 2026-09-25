# Ground-Vehicle Classification and Look Generation

> SSOT: `public/js/vehicleCatalog.js` (128 prototypes, 23 consists), `vehicleParts.js`,
> `vehicleIndustry.js`, `vehicleEquipment.js`, `vehicleConsists.js`, `vehicleVariants.js`,
> `vehicleEveryday.js`, `vehicleIndividualBodies.js`. All background presentation:
> nominal sizes are art envelopes, never engineering specs or combat numbers.
> Verification: `node test/vehicleDiversity.mjs`, `node test/vehicleAttachments.mjs`,
> `node test/vehicleVariants.mjs`, `node test/vehicleEveryday.mjs`,
> `tools/audit_vehicle_spec.mjs`, `tools/audit_background_objects.mjs`,
> `tools/audit_gpu_lifecycle.mjs`, `tools/audit_client_syntax.mjs`.

## Constraints (why, not what)

- Compatibility intersection: purpose, running gear, power, and venue select by
  compatible-table intersection. Empty results return an empty set; unreasonable
  combos fail loud. Power is a static look classification (exhaust, battery, pantograph
  follow it) with no driving, weapon, or passenger simulation added.
- Proportion safety: widths/heights derive from each type's own ratios, never sampled
  independently (which would breed flat or stretched cars). Tonnage, tire, suspension,
  and cargo variants ride an independent seed sequence so they never shift existing
  color, age, or scene randomness; they MUST NOT alter combat, collision, or handling.
- Authority geometry untouched: parking-lot collision columns keep their contract via
  `collisionOnly` markers skipped by the renderer. Looks MUST NOT be reverse-engineered
  into collision, and consists place only where the host collision box fits one car.
- Fixed rail interface: trains share the game gauge (1.435m) and coupler height
  (0.85m); semi-trailer fifth-wheel/kingpin height is fixed at 1.2m so units join
  at connection points instead of overlapping.
- Attachment tests screen for floating parts only (1.5cm envelope gap); envelope
  intersection cannot prove surface contact, so visual spot-checks stay mandatory.
