import assert from 'node:assert/strict';
import { buildSlopeBoundary, SLOPE_BOUNDARIES } from '../public/js/edgeSlope.js';
import { WALL_KINDS, wallCandidates, partBox, BOUNDARY_ONLY_KINDS } from '../public/js/edgewall.js';
import { EXPANDED_BOUNDARIES } from '../public/js/edgeSlope.js';

function worldRing(result, count, end, origin) {
  const p = result.parts[0], vertices = p.g[1].vertices;
  const offset = end ? vertices.length - count * 3 : 0;
  const c = Math.cos(origin.ry), s = Math.sin(origin.ry);
  return Array.from({ length: count }, (_, i) => {
    const x = vertices[offset + i * 3] + p.p[0], y = vertices[offset + i * 3 + 1] + p.p[1];
    const z = vertices[offset + i * 3 + 2] + p.p[2];
    return [origin.x + c * x + s * z, y, origin.z - s * x + c * z];
  });
}
let seams = 0;
for (const [kind, spec] of Object.entries(SLOPE_BOUNDARIES)) {
  const def = WALL_KINDS[kind];
  for (const ry of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) for (const len of [23.7, 30, 31.4])
    for (const grade of [-2.5, -.9, 0, .9, 2.5]) {
      const a = { len, depth: def.depth, h: def.h, x: 137.21, z: -258.42, ry,
        heightAt: (x, z) => 20 + grade * (x + z) + Math.sin(x / 23) * 5 + Math.cos(z / 19) * 3 };
      const b = { ...a, x: a.x + Math.cos(ry) * len, z: a.z - Math.sin(ry) * len };
      const left = buildSlopeBoundary(kind, a), right = buildSlopeBoundary(kind, b);
      assert.deepEqual(left, buildSlopeBoundary(kind, a), 'determinism');
      const lhs = worldRing(left, spec.section.length, true, a), rhs = worldRing(right, spec.section.length, false, b);
      lhs.forEach((point, i) => point.forEach((v, axis) => assert(Math.abs(v - rhs[i][axis]) < 1e-8,
        `${kind}: seam gap or vertical step, rotation ${ry}, grade ${grade}`)));
      for (const result of [left, right]) {
        for (const part of result.parts) {
          const box = partBox(part);
          assert(box.x0 >= -len / 2 - 1e-8 && box.x1 <= len / 2 + 1e-8, kind + ': longitudinal containment');
          assert(box.z0 >= -def.depth / 2 - 1e-8 && box.z1 <= def.depth / 2 + 1e-8, kind + ': depth containment');
          assert(box.y0 >= result.lo - 1.5 - 1e-8 && box.y1 <= result.hi + def.h + 1e-8, kind + ': full cluster collision');
        }
        const p = result.parts[0], mesh = p.g[1];
        assert(mesh.vertices.every(Number.isFinite));
        assert(Math.min(...mesh.vertices.filter((_, i) => i % 3 === 1)) + p.p[1] >= result.lo - 1.5);
        assert(Math.max(...mesh.vertices.filter((_, i) => i % 3 === 1)) + p.p[1] <= result.hi + def.h + 1e-8);
        // All triangle edges belong to two faces: no open side, base or end cap.
        const edges = new Map();
        for (let i = 0; i < mesh.faces.length; i += 3) for (let j = 0; j < 3; j++) {
          const a = mesh.faces[i + j], b = mesh.faces[i + (j + 1) % 3], key = [a, b].sort((a, b) => a - b).join(',');
          edges.set(key, (edges.get(key) || 0) + 1);
        }
        assert([...edges.values()].every(count => count === 2), 'watertight mesh');
      }
      seams++;
    }
}
for (const biome of ['urban', 'bare', 'green', 'wet']) {
  const candidates = wallCandidates(biome, false, 'steep');
  assert(candidates.length > 0);
  assert(candidates.every(k => SLOPE_BOUNDARIES[k]), 'exclude non-conforming rigid objects');
}
const bad = { len: 30, depth: 12, h: 8, x: 0, z: 0, heightAt: () => NaN };
for (const [kind, def] of Object.entries(EXPANDED_BOUNDARIES)) {
  const water = def.dom === 'water';
  assert(BOUNDARY_ONLY_KINDS.includes(kind), 'dense arrays remain boundary-only');
  assert(def.bio.some(bio => wallCandidates(bio, water, def.slope).includes(kind)), kind + ': reachable');
  if (!water && def.slope !== 'steep') assert(!wallCandidates(def.bio[0], false, 'steep').includes(kind));
  if (def.object || def.tanks) {
    const cluster = buildSlopeBoundary(kind, { len: 30, depth: def.depth, h: def.h,
      x: 0, z: 0, heightAt: (x, z) => x * 2 + z * .2 });
    assert(cluster.parts.filter(p => ['terrace-footing', 'root-buttress'].includes(p.role)).length >= 3,
      kind + ': dense independently supported members');
  }
}
assert.equal(buildSlopeBoundary('levee', bad), null, 'failed samples omit visual geometry');
assert.throws(() => buildSlopeBoundary('train', bad), RangeError);
console.log(`PASS: ${seams} joined boundary seams on rising/falling/curved terrain; closed meshes, collision bounds and steep eligibility.`);
