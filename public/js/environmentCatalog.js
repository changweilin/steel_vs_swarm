// Shared semantic catalog; sizes are game envelopes in metres, not survey measurements.
import { mulberry32 } from './rng.js';
import { forestEnvironment } from './forest.js';

export const ENVIRONMENT_OBJECTS = Object.freeze({
  house: { category: 'residential', bio: ['urban'], size: [14, 12, 11] },
  skyscraper: { category: 'highrise', bio: ['urban'], size: [20, 60, 18] },
  skyfall: { category: 'highrise', bio: ['urban'], size: [36, 14, 16] },
  factory: { category: 'industry', bio: ['urban'], size: [30, 18, 24] },
  powerplant: { category: 'industry', bio: ['urban'], size: [32, 26, 24] },
  incinerator: { category: 'industry', bio: ['urban'], size: [26, 28, 20] },
  mine: { category: 'extraction', bio: ['bare'], size: [32, 16, 26] },
  oilfield: { category: 'extraction', bio: ['bare'], size: [20, 22, 16] },
  greenhouse: { category: 'agriculture', bio: ['green'], size: [24, 10, 16] },
  ranch: { category: 'agriculture', bio: ['green'], size: [26, 12, 20] },
  boulder: { category: 'rock', bio: ['bare', 'green', 'wet'], size: [18, 16, 16] },
  gianttree: { category: 'giant-tree', bio: ['green', 'wet'], size: [30, 65, 30] },
  fallentree: { category: 'deadwood', bio: ['green', 'wet'], size: [28, 7, 9] },
  car: { category: 'vehicle', bio: ['urban'], size: [4.8, 1.8, 2.2] },
  icefloe: { category: 'sea-ice', bio: ['water'], size: [24, 2, 18], draft: .86 },
  iceberg: { category: 'glacial-ice', bio: ['water'], size: [38, 36, 28], draft: .84 },
  strandedship: { category: 'marine-vehicle', bio: ['wet'], size: [34, 16, 14] },
});


// Placement scale uses an isolated stream. Host envelopes never consume model randomness.
export const ENVIRONMENT_PARAMETERS = Object.freeze({
  residential: { scale: [.72, 1], floor: [2.8, 3.6], bay: [2.2, 3.6] },
  highrise: { scale: [.75, 1], floor: [3.2, 4.2], bay: [2.4, 4] },
  industry: { scale: [.8, 1], floor: [4.5, 6], bay: [3.5, 5] },
  extraction: { scale: [.8, 1] }, agriculture: { scale: [.8, 1] },
  rock: { scale: [.6, 1] }, 'giant-tree': { scale: [.75, 1] },
  deadwood: { scale: [.65, 1] }, vehicle: { scale: [.9, 1] },
  'marine-vehicle': { scale: [.8, 1] },
  'sea-ice': { scale: [.5, 1], sides: [8, 14], edge: [.78, 1], crown: [.94, 1] },
  'glacial-ice': { scale: [.65, 1], sides: [7, 12], edge: [.65, 1], crown: [.55, 1] },
});
export const ENVIRONMENT_CATEGORIES = Object.freeze(Object.fromEntries(
  Object.keys(ENVIRONMENT_PARAMETERS).map(category => [category,
    Object.keys(ENVIRONMENT_OBJECTS).filter(kind => ENVIRONMENT_OBJECTS[kind].category === category)]),
));

// Authored visual ranges, not construction specifications. Angles are radians.
export const ENVIRONMENT_STRUCTURE_PARAMETERS = Object.freeze({
  industrialRoof: { bay: [6, 10], pitch: [.18, .32], thickness: [.12, .22] },
  greenhouse: { bay: [2.5, 4], eaveRatio: [.52, .66] },
  wind: { blades: 3, chord: [.24, .38], rotorRatio: [.34, .42] },
  solar: { pitch: [.10, .18], gridLines: [4, 6] },
});
export function environmentSize(kind, seed) {
  const def = ENVIRONMENT_OBJECTS[kind];
  if (!def || !Number.isSafeInteger(seed)) throw new RangeError('Invalid environment kind or seed');
  const [lo, hi] = ENVIRONMENT_PARAMETERS[def.category].scale;
  const factor = lo + mulberry32((seed ^ 0x53495a45) >>> 0)() * (hi - lo);
  return def.size.map(value => value * factor);
}

// Climate is a placement gate, never a random shape input. Explicit ice enables authored maps.
export function environmentAvailable(kind, input = {}) {
  if (!ENVIRONMENT_OBJECTS[kind]?.draft) return true;
  if (typeof input.ice === 'boolean') return input.ice;
  const { temperature } = forestEnvironment(input.latitude, 0, input);
  return Number.isFinite(temperature) && temperature <= (kind === 'icefloe' ? 2 : 8);
}
