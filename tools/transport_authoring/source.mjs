import { writeFileSync, mkdirSync } from 'node:fs';
import { VEHICLE_PROFILES, vehicleBackgroundObject } from '../../public/js/vehicleCatalog.js';
import { INDIVIDUAL_BODIES } from '../../public/js/vehicleIndividualBodies.js';

const output = new URL('../../out/transport_review/', import.meta.url);
mkdirSync(output, { recursive: true });
const vehicles = Object.entries(VEHICLE_PROFILES).map(([key, spec]) => ({
  key, spec, individual: INDIVIDUAL_BODIES[key] || null,
  entry: vehicleBackgroundObject(key, 42, { sourceGeometry: true }),
}));
writeFileSync(new URL('source.json', output), JSON.stringify({ vehicles }));
console.log(`${vehicles.length} source vehicle descriptors`);
