// Closed faceted ice meshes. Y=0 is the keel; the host places the waterline.
import { mulberry32 } from './rng.js';
import { ENVIRONMENT_OBJECTS, ENVIRONMENT_PARAMETERS } from './environmentCatalog.js';

export function iceParts(kind, size, seed) {
  const def = ENVIRONMENT_OBJECTS[kind], spec = ENVIRONMENT_PARAMETERS[def?.category];
  if (!def?.draft || !Number.isSafeInteger(seed) || !Array.isArray(size)
    || size.length !== 3 || size.some(v => !Number.isFinite(v) || v <= 0)) {
    throw new RangeError('Invalid ice model inputs');
  }
  const rnd = mulberry32(seed >>> 0), sample = range => range[0] + rnd() * (range[1] - range[0]);
  const n = Math.floor(sample([spec.sides[0], spec.sides[1] + 1]));
  const [w, h, d] = size, phase = rnd() * Math.PI * 2;
  const outline = Array.from({ length: n }, (_, i) => {
    const angle = phase + (i + .2 * (rnd() - .5)) / n * Math.PI * 2;
    const radius = sample(spec.edge);
    return [Math.cos(angle) * w * .5 * radius, Math.sin(angle) * d * .5 * radius];
  });
  const vertices = [], faces = [], colors = [];
  const tabular = kind === 'icefloe' || rnd() < .4;
  for (let ring = 0; ring < 3; ring++) for (const [x, z] of outline) {
    const factor = ring === 0 ? .55 : ring === 1 ? 1 : tabular ? .94 : .52;
    const y = ring === 0 ? 0 : ring === 1 ? h * def.draft
      : h * (def.draft + (1 - def.draft) * sample(spec.crown));
    vertices.push(x * factor, y, z * factor);
    colors.push(...(ring === 0 ? [.25, .55, .66] : ring === 1 ? [.53, .77, .84] : [.85, .94, .97]));
  }
  // Center fans cap both ends; rings share indices, so no cracks or open undersides.
  vertices.push(0, 0, 0, 0, h, 0);
  colors.push(.25, .55, .66, .91, .97, 1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push(3 * n, i, j, 3 * n + 1, 2 * n + j, 2 * n + i);
    for (let ring = 0; ring < 2; ring++) {
      const a = ring * n + i, b = ring * n + j, c = b + n, e = a + n;
      faces.push(a, e, b, b, e, c);
    }
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  vertices.forEach((value, i) => {
    min[i % 3] = Math.min(min[i % 3], value); max[i % 3] = Math.max(max[i % 3], value);
  });
  const center = min.map((value, i) => (value + max[i]) / 2);
  const dimensions = max.map((value, i) => value - min[i]);
  const mesh = { vertices: vertices.map((value, i) => value - center[i % 3]), faces, colors };
  return [{ g: ['mesh', mesh, dimensions], p: center, c: null,
    role: kind === 'icefloe' ? 'sea-ice' : 'glacial-ice' }];
}
