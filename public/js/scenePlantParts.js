import { mulberry32 } from './rng.js';
import { sceneryMeshData } from './sceneryAppearance.js';

export const LEGACY_PLANT_SPECIES = Object.freeze({
  bamboo: 'forestBamboo', broadleaf: 'holmOak', birch: 'forestBirch',
  conifer: 'dougfir', conifer2: 'sitka', conifer3: 'juniper', conifer4: 'alerce',
  deadtree: 'deadwood', mangrove: 'mangroveGrey', sapling: 'holmOak',
  shrub: 'scrubOak', succulent: 'agave',
});
export const GROUND_PLANTS = Object.freeze(['silvergrass', 'arrowbamboo', 'reed', 'redcap', 'browncap', 'parasol', 'toadstool']);

const cylinder = (rt, rb, h, p, color, rotation = [0, 0, 0]) =>
  ({ g: ['cyl', rt, rb, h, 7], p, r: rotation, c: color });

/** Leaves are folded, tapered ribbons, not solid cones. The centre fold catches light. */
function blade(length, width, x, z, angle, lean, color, segments = 5, back = true) {
  const vertices = [], faces = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, w = width * Math.sin(Math.PI * t) * .5;
    const bend = lean * t * t, y = length * (t - .18 * t * t);
    vertices.push(-w, y, bend, 0, y + w * .22, bend - w * .18, w, y, bend);
    if (i) for (let side = 0; side < 2; side++) {
      const a = (i - 1) * 3 + side, b = i * 3 + side;
      faces.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const front = vertices.length / 3, frontFaces = faces.slice();
  if (back) vertices.push(...vertices.map((value, i) => i % 3 === 2 ? value + .004 : value));
  for (let i = 0; back && i < frontFaces.length; i += 3) {
    faces.push(frontFaces[i + 2] + front, frontFaces[i + 1] + front, frontFaces[i] + front);
  }
  return { g: ['mesh', { vertices, faces }, [width, length, Math.abs(lean) + width]],
    p: [x, 0, z], r: [0, angle, 0], c: color };
}

/** Broad patches keep blade widths in metres rather than magnifying a single tuft. */
export function groundCoverParts(kind, seed, size) {
  const rnd = mulberry32(seed), parts = [];
  const count = Math.min(160, Math.max(64, Math.ceil(size * size * 16)));
  for (let i = 0; i < count; i++) {
    const angle = rnd() * Math.PI * 2, radius = Math.sqrt(rnd()) * size * .43;
    parts.push(blade(.5 + rnd() * .5, kind === 'understory' ? .32 : .18,
      Math.cos(angle) * radius, Math.sin(angle) * radius, rnd() * Math.PI * 2,
      .08 + rnd() * .2, 0xffffff, 2, false));
  }
  return parts;
}

export function groundPlantParts(kind, seed = 0) {
  const rnd = mulberry32(seed), parts = [];
  if (['redcap', 'browncap', 'parasol', 'toadstool'].includes(kind)) {
    const cluster = kind === 'toadstool', count = cluster ? 5 : 1;
    for (let i = 0; i < count; i++) {
      const h = (cluster ? .35 : kind === 'parasol' ? 1.6 : .9) * (.85 + rnd() * .3);
      const radius = cluster ? .2 + rnd() * .12 : kind === 'parasol' ? .65 : .9;
      const x = cluster ? (rnd() - .5) * 1.1 : 0, z = cluster ? (rnd() - .5) * .9 : 0;
      const stem = radius * (kind === 'parasol' ? .12 : .22);
      parts.push(cylinder(stem * .7, stem, h, [x, h / 2, z], 0xd9c8ab));
      const color = kind === 'redcap' ? 0xb53d2f : kind === 'browncap' ? 0x78523a : 0xb88e54;
      const capSize = [radius * 2, radius * .52, radius * 2];
      parts.push({ g: ['mesh', sceneryMeshData('mushroomCap', capSize), capSize],
        p: [x, h + radius * .22, z], c: color });
      parts.push({ g: ['lathe', [[0, 0], [radius * .9, .015], [0, .05]], 14],
        p: [x, h - .05, z], c: 0xcdbb93 });
      if (kind === 'redcap') for (let j = 0; j < 9; j++) {
        const a = j * 2.4, d = radius * (.25 + rnd() * .5);
        parts.push({ g: ['ico', .055 + rnd() * .025],
          p: [x + Math.cos(a) * d, h + radius * .48 * (1 - (d / radius) ** 2), z + Math.sin(a) * d],
          s: [1, .35, 1], c: 0xe9ddbd });
      }
    }
    return parts;
  }
  if (!['silvergrass', 'arrowbamboo', 'reed', 'crop'].includes(kind)) throw new RangeError('Unknown ground plant: ' + kind);
  const reed = kind === 'reed', bamboo = kind === 'arrowbamboo';
  for (let i = 0; i < (reed ? 7 : 11); i++) {
    const a = i * 2.39996, spread = .12 + rnd() * .48;
    const x = Math.cos(a) * spread, z = Math.sin(a) * spread;
    const height = (bamboo ? 2.1 : reed ? 1.9 : 1.35) * (.65 + rnd() * .5);
    parts.push({...blade(height, reed ? .12 : .2, x, z, a, .25 + rnd() * .65,
      [0x61763b, 0x788749, 0x899653][i % 3]), key: kind === 'silvergrass' ? 'grass' : undefined});
    if (i % 2 === 0) {
      parts.push(cylinder(.016, .025, height, [x, height / 2, z], 0x87905a));
      parts.push({ g: ['lathe', [[0, 0], [.035, .04], [reed ? .055 : .11, .2], [.035, .34], [0, .4]], 7],
        p: [x, height, z], c: reed ? 0x795434 : 0xc3b58c });
    }
  }
  return parts;
}
