import { ENVIRONMENT_BUILDINGS } from './environmentCatalog.js';
import { BUILDING_FUNCTIONS } from './buildingFunctions.js';
import { chooseArchitecture } from './buildingDiversity.js';
import { calculateFootprintMetrics, resolveAdaptiveRoofForm } from './architectureStyles.js';
import { architecturalFacadeParts } from './architectureFacadeParts.js';
import { architecturalRoofParts } from './architectureRoofParts.js';
import { mulberry32 } from './rng.js';

export function environmentBuildingPlan(kind, size, seed) {
  const spec = ENVIRONMENT_BUILDINGS[kind];
  if (!spec) throw new RangeError('Unknown environment building: ' + kind);
  const rnd = mulberry32(seed), sample = range => range[0] + rnd() * (range[1] - range[0]);
  const [width, height, depth] = size;
  const w = width * sample(spec.width), d = depth * sample(spec.depth), bodyH = height * sample(spec.body);
  const functional = BUILDING_FUNCTIONS[spec.type];
  const functionInfo = functional ? { type: spec.type, key: functional.range, category: functional.category, locked: true }
    : { type: spec.type, key: spec.key, category: spec.category, locked: false };
  const style = chooseArchitecture(seed, `environment/${kind}`, { functionInfo, affinity: spec.affinity,
    urban: kind !== 'house', rural: kind === 'house', building: { tags: { height: bodyH } } });
  const poly = { outer: [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]], holes: [] };
  const metrics = calculateFootprintMetrics(poly);
  const roofForm = resolveAdaptiveRoofForm(style.roofForm, metrics, bodyH, functionInfo.category);
  const edges = poly.outer.map((a, i) => {
    const b = poly.outer[(i + 1) % 4], dx = b[0] - a[0], dz = b[1] - a[1];
    return { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, y: 0, h: bodyH,
      hw2: Math.hypot(dx, dz) / 2, ry: Math.atan2(dz, dx), sourceId: `environment/${kind}/${seed}` };
  });
  const parts = [{ g: ['box', w, bodyH, d], p: [0, bodyH / 2, 0], c: style.wall, role: 'building-body',
    architecture: { style: style.id, roofForm, function: functionInfo.key, seed } },
    ...architecturalFacadeParts(edges, style, .12),
    ...architecturalRoofParts(poly, bodyH, style, roofForm, metrics, bodyH)];
  return { parts, style, w, d, bodyH };
}
