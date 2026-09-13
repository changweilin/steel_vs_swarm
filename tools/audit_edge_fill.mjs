// Exercise the shipped pure mesh generator: mixed ends, mitered corners, roofs,
// and solid closures. No copied geometry or source-reading implementation.
import assert from 'node:assert/strict';
import { buildSlopeBoundary } from '../public/js/edgeSlope.js';
import { WALL_KINDS } from '../public/js/edgewall.js';

const kinds = Object.keys(WALL_KINDS).filter(k => WALL_KINDS[k].bufferFill);
const crest = Math.min(...kinds.map(k => WALL_KINDS[k].depth)) / 2;
const round = n => Math.round(n * 1e6) / 1e6;
const terrains = [() => 4, (x, z) => 4 + x * .6 + z * .35,
  (x, z) => 4 + Math.sin(x * .13) * 5 + Math.cos(z * .11) * 3];
function make(kind, fx, fz, ry, heightAt, joins) {
  const def = WALL_KINDS[kind];
  const x = fx - Math.round(Math.sin(ry)) * def.depth / 2;
  const z = fz - Math.round(Math.cos(ry)) * def.depth / 2;
  const input = { len: 24, depth: def.depth, h: def.h, x, z, ry, heightAt,
    fill: { depth: 62.5, crest, heightAt, joins } };
  const result = buildSlopeBoundary(kind, input);
  return { result, input };
}
const join = (kind, corner = false) => ({ kind, h: WALL_KINDS[kind].h, depth: WALL_KINDS[kind].depth, corner });
function tops({ result, input }) {
  const ca = Math.round(Math.cos(input.ry)), sa = Math.round(Math.sin(input.ry));
  return [...result.parts, ...result.bufferParts].flatMap(p => {
    const mesh = p.g[1], rows = [];
    assert(mesh.vertices.every(Number.isFinite));
    assert(mesh.colors.every(Number.isFinite));
    assert(mesh.faces.every(i => Number.isInteger(i) && i >= 0 && i < mesh.vertices.length / 3));
    for (let i = 0; i < mesh.surfaceVertexCount * 3; i += 3) {
      const [u, y, v] = mesh.vertices.slice(i, i + 3).map((n, a) => n + p.p[a]);
      rows.push([input.x + ca * u + sa * v, y, input.z - sa * u + ca * v,
        ...mesh.colors.slice(i, i + 3)].map(round));
    }
    // Every top vertex has a corresponding bottom at or below sampled ground.
    if (mesh.bottomVertexOffset) for (let i = 0; i < mesh.faces.length; i += 3) {
      const face = mesh.faces.slice(i, i + 3);
      assert(!face.some(v => v < mesh.surfaceVertexCount) || face.every(v => v < mesh.surfaceVertexCount),
        'side faces must not share roof normals');
    }
    const offset = (mesh.bottomVertexOffset || 0) * 3;
    for (let i = 0; i < offset; i += 3) assert(mesh.vertices[i + 1 + offset] <= mesh.vertices[i + 1]);
    return rows;
  });
}
const unique = rows => [...new Set(rows.map(r => JSON.stringify(r)))].sort();
let seams = 0;
for (const heightAt of terrains) for (const a of kinds) for (const b of kinds) {
  for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const ca = Math.round(Math.cos(ry)), sa = Math.round(Math.sin(ry));
    const left = make(a, -12 * ca, 12 * sa, ry, heightAt, [null, join(b)]);
    const right = make(b, 12 * ca, -12 * sa, ry, heightAt, [join(a), null]);
    const seam = item => unique(tops(item).filter(([x, , z]) => Math.abs(ca * x - sa * z) < 1e-5));
    assert(seam(left).length > 30);
    assert.deepEqual(seam(left), seam(right), `${a}/${b} orientation ${ry}`);
    assert.deepEqual(left.result, buildSlopeBoundary(a, left.input));
    seams++;
  }
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const ca = Math.round(Math.cos(angle)), sa = Math.round(Math.sin(angle));
    const north = make(a, 12 * ca, -12 * sa, angle, heightAt, [join(b, true), null]);
    const west = make(b, 12 * sa, 12 * ca, angle + Math.PI / 2, heightAt, [null, join(a, true)]);
    const diagonal = item => unique(tops(item).filter(([x, , z]) => {
      const u = ca * x - sa * z, v = sa * x + ca * z;
      return u <= 0 && Math.abs(u - v) < 1e-5;
    }));
    assert.deepEqual(diagonal(north), diagonal(west), a + '/' + b + ' corner ' + angle);
    assert(diagonal(north).length > 30);
    seams++;
  }
}
for (const kind of kinds) {
  const flat = make(kind, 0, 0, 0, terrains[0], [null, null]);
  const rows = tops(flat).filter(([x]) => x === 0);
  const roof = rows.filter(([, , z]) => z <= -crest);
  assert(roof.length > 20);
  const heights = roof.map(r => r[1]), h = WALL_KINDS[kind].h;
  assert(Math.max(...heights) - Math.min(...heights) > h * .10, 'buffer roof has visible natural relief');
  assert(heights.every(y => y >= 4 + h * .40 && y <= 4 + h), 'relief stays filled and within the height envelope');
  const along = [...new Map(tops(flat).filter(([, , z]) => z === -40)
    .map(([x, y]) => [x, y])).entries()].sort((a, b) => a[0] - b[0]);
  const outward = [...new Map(roof.filter(([, , z]) => z <= -24)
    .map(([, y, z]) => [z, y])).entries()].sort((a, b) => a[0] - b[0]);
  for (const [axis, samples] of [['along', along], ['outward', outward]]) {
    assert(samples.length > 5);
    const values = samples.map(s => s[1]);
    assert(Math.max(...values) - Math.min(...values) > h * .08, `${axis} relief remains visible`);
    const slopes = samples.slice(1).map((s, i) => (s[1] - samples[i][1]) / (s[0] - samples[i][0]));
    assert(Math.max(...slopes) - Math.min(...slopes) > h * .0005, `${axis} roof must curve rather than form a tilted plane`);
  }
  assert(rows.some(([, , z]) => z === -62.5), 'reaches buffer outer edge');
  for (const wall of ['citywall', 'levee']) {
    const rock = make(kind, -12, 0, 0, terrains[0], [null, join(wall)]);
    const masonry = make(wall, 12, 0, 0, terrains[0], [join(kind), null]);
    const rockEnd = tops(rock).filter(([x]) => x === 0);
    // Masonry starts on the same longitudinal plane; their solid depth intervals overlap.
    const p = masonry.result.parts[0], v = p.g[1].vertices;
    assert(rockEnd.some(([, y, z]) => z < 0 && z > -WALL_KINDS[wall].depth && y > 4));
    assert(v.some((u, i) => i % 3 === 0 && Math.abs(u + p.p[0] + masonry.input.x) < 1e-5));
  }
  for (const wall of ['citywall', 'levee']) {
    const item = make(kind, 12, 0, 0, terrains[0], [join(wall, true), null]);
    const surface = tops(item);
    assert(surface.some(([x, y, z]) => x < -2 && z === 0 && y > 4), 'mixed corner contacts masonry above ground');
    assert(surface.some(([x, , z]) => x === -62.5 && z === 0), 'mixed corner fills entire square');
  }
  assert.equal(buildSlopeBoundary(kind, { ...flat.input,
    fill: { ...flat.input.fill, heightAt: () => NaN } }), null);
}
console.log(`Boundary fill: ${seams} mixed/corner seams, continuous roofs, masonry contacts and invalid-sample omission passed.`);
