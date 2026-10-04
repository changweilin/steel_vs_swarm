import assert from 'node:assert/strict';
import { GEOLOGY_MORPHOLOGIES, geologyMorphology } from '../public/js/geologyMorphology.js';
import { GEOLOGY_TYPES, generateGeology, geologyBackgroundObject, elongatedGeologyMesh } from '../public/js/geology.js';

const dry = { width: 60, depth: 60, height: 20, strike: 0, vegetation: 0, moisture: 0, wind: 0, exposure: 0 };
// Probe emitted triangles, including their discretisation, rather than re-evaluating the profile.
function heightAt(mesh, x, z) {
  const { vertices: v, faces: f } = mesh;
  for (let i = 0; i < f.length; i += 3) {
    const a = f[i] * 3, b = f[i + 1] * 3, c = f[i + 2] * 3;
    const dx = x - v[a], dz = z - v[a + 2];
    const bx = v[b] - v[a], bz = v[b + 2] - v[a + 2], cx = v[c] - v[a], cz = v[c + 2] - v[a + 2];
    const det = bx * cz - bz * cx;
    if (Math.abs(det) < 1e-12) continue;
    const u = (dx * cz - dz * cx) / det, w = (bx * dz - bz * dx) / det;
    if (u >= -1e-8 && w >= -1e-8 && u + w <= 1 + 1e-8) return v[a + 1] + u * (v[b + 1] - v[a + 1]) + w * (v[c + 1] - v[a + 1]);
  }
  return 0;
}

let meshes = 0, boundaries = 0;
for (const [type, families] of Object.entries(GEOLOGY_MORPHOLOGIES)) {
  const seen = new Set(), signatures = new Set();
  for (let seed = 0; seed < 64; seed++) {
    const entry = geologyBackgroundObject(type, seed, dry), { morphology: m } = entry.generation.parameters;
    seen.add(m.family);
    assert.deepEqual(m, geologyMorphology(type, seed));
    if (seed === 0) assert.deepEqual(entry, geologyBackgroundObject(type, seed, dry));
    signatures.add(JSON.stringify(entry.meshData.vertices));
    const { vertices: v, faces: f } = entry.meshData;
    assert(v.every(Number.isFinite));
    assert(f.every(i => Number.isInteger(i) && i >= 0 && i < v.length / 3));
    const limit = Math.hypot(60, 60) * (GEOLOGY_TYPES[type].maxHeightDiagonalRatio ?? Infinity);
    for (let i = 1; i < v.length; i += 3) assert(v[i] >= 0 && v[i] <= limit + 1e-8);
    for (let i = 0; i < f.length; i += 3) {
      const a = f[i] * 3, b = f[i + 1] * 3, c = f[i + 2] * 3;
      const up = (v[b + 2] - v[a + 2]) * (v[c] - v[a]) - (v[b] - v[a]) * (v[c + 2] - v[a + 2]);
      assert(up > 0, `${type}/${seed}: terrain face must point upward`);
    }
    const probe = (x, z) => heightAt(entry.meshData, (m.offsetX + x * m.spanX) * 30, (m.offsetZ + z * m.spanZ) * 30);
    if (['dome', 'rounded'].includes(m.family)) assert(probe(0, 0) > probe(.7, 0) + 3);
    if (m.family === 'saddle') {
      const saddle = probe(0, 0), left = probe(-m.separation, -m.bend), right = probe(m.separation, m.bend);
      assert(Math.min(left, right) > saddle + 1, `${seed}: two summits must retain a lower saddle`);
      assert(saddle > 2, `${seed}: the saddle must connect the peaks`);
    }
    if (m.family === 'arete') {
      const crest = m.bend * Math.sin(m.phase);
      assert(probe(0, crest) > probe(0, crest + .5) + 7, `${seed}: arete retains narrow flanks`);
    }
    if (['mesa', 'butte', 'cuesta'].includes(m.family)) {
      assert(probe(0, 0) > probe(m.topRadius + m.scarpWidth + .08, 0) + 7);
      if (m.family !== 'cuesta') assert(Math.abs(probe(-.05, 0) - probe(.05, 0)) < 1);
      else assert(probe(-.15, 0) > probe(.15, 0), `${seed}: cuesta cap follows its dip`);
    }
    meshes++;
    if (seed >= 8) continue;
    const ridge = elongatedGeologyMesh(type, seed, { len: 80, depth: 16, height: 14, bufferDepth: 35 });
    assert.deepEqual(ridge.morphology, m);
    assert.equal(ridge.undulation.pattern, null);
    const seam = new Map();
    for (let i = 0; i < ridge.meshData.vertices.length; i += 3) {
      const [x, y, z] = ridge.meshData.vertices.slice(i, i + 3);
      assert(y >= 0 && y <= 14);
      if (Math.abs(z + 8) < 1e-8) seam.set(x, y);
      if (Math.abs(x) === 40 || z === 8) assert.equal(y, 0);
    }
    let joined = 0;
    for (let i = 0; i < ridge.bufferMeshData.vertices.length; i += 3) {
      const [x, y, z] = ridge.bufferMeshData.vertices.slice(i, i + 3);
      assert(y >= 0 && y <= 14);
      if (z === 17.5) { assert.equal(y, seam.get(x)); joined++; }
      if (Math.abs(x) === 40 || z === -17.5) assert.equal(y, 0);
    }
    assert(joined > 0);
    for (const [x, y] of seam) assert(Math.abs(ridge.surfaceHeightAt(x, -8) - y) < 1e-6);
    boundaries++;
  }
  assert.deepEqual([...seen].sort(), [...families].sort());
  assert.equal(signatures.size, 64, `${type}: shapes must vary inside each family`);
}
for (const type of ['basalt', 'dune', 'crater', 'reef', 'river', 'eruption', 'monument', 'ruins']) {
  assert.equal(geologyMorphology(type, 42), null);
  assert.equal(generateGeology(type, 42).parameters.morphology, undefined);
}
for (const seed of [NaN, Infinity, .5, '1']) assert.throws(() => geologyMorphology('mountain', seed), TypeError);
console.log(`Geology morphology: ${meshes} rock meshes, ${boundaries} joined ranges; family traits, height caps, winding and seeded replay passed.`);
