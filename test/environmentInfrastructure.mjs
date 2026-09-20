import assert from 'node:assert/strict';
import { storageTankParts, linearEnvironmentParts } from '../public/js/environmentParts.js';
import { wallParts, wallFit, partBox, WALL_KINDS, buildBoundaryRunParts } from '../public/js/edgewall.js';
import { buildSlopeBoundary } from '../public/js/edgeSlope.js';
import { partsAABB } from '../public/js/vehicles.js';
import { mat3Apply, mat3FromEulerXYZ, mat3Transpose } from '../public/js/partTransform.js';

const close = (a, b, label) => assert(Math.abs(a - b) < 1e-7, `${label}: ${a} != ${b}`);
for (let seed = 0; seed < 80; seed++) {
  for (const [w, h, d] of [[14, 18, 14], [6, 10, 8], [22, 8, 18]]) {
    const rows = storageTankParts({ w, h, d, seed });
    assert.deepEqual(rows, storageTankParts({ w, h, d, seed }));
    assert(wallFit(rows, w, d, h).fit);
    const [foot, tank, roof] = rows.map(partBox);
    close(foot.y0, 0, 'foundation grounded');
    close(foot.y1, tank.y0, 'tank supported');
    close(tank.y1, roof.y0, 'roof supported');
    close(rows[1].g[1], rows[2].g[2], 'roof matches tank radius');
    assert.equal(rows[2].g[1], 0, 'cone roof closes at apex');
  }
  for (const kind of ['barricade', 'levee', 'seawall']) {
    const def = WALL_KINDS[kind], len = 30;
    const rows = wallParts(kind, { len, depth: def.depth, h: def.h, seed, variant: 0 });
    const shared = buildSlopeBoundary(kind, { len, depth: def.depth, h: def.h - .4,
      x: seed % 997 * 11, z: seed % 953 * 7, seed, heightAt: () => .4 }).parts;
    assert.deepEqual(rows, shared, 'flat preview must use the same cross-section generator');
    close(partsAABB(rows).x0, -len / 2, 'left seam');
    close(partsAABB(rows).x1, len / 2, 'right seam');
    assert(!rows.some(p => p.role === 'battlement'), 'modern barriers have no castle teeth');
  }
  for (const len of [12, 30, 64]) {
    const def = WALL_KINDS.viaduct;
    const rows = linearEnvironmentParts('viaduct', { len, depth: def.depth, h: def.h, seed });
    assert(wallFit(rows, len, def.depth, def.h).fit);
    for (const id of new Set(rows.map(p => p.fragment))) {
      const fragment = rows.filter(p => p.fragment === id), deck = fragment.find(p => p.role === 'fallen-deck');
      const girders = fragment.filter(p => p.role === 'deck-girder'), rails = fragment.filter(p => p.role === 'deck-parapet');
      assert.equal(girders.length, 2); assert.equal(rails.length, 2);
      close(partsAABB(fragment).y0, 0, 'each tilted fragment touches ground');
      close(partsAABB(girders).y0, 0, 'girders carry the fallen slab');
      assert(Math.abs(deck.r[2]) >= .08 && Math.abs(deck.r[2]) <= .22);
      const inverse = mat3Transpose(mat3FromEulerXYZ(deck.r));
      for (const p of [...girders, ...rails]) {
        const center = mat3Apply(inverse, p.p.map((v, k) => (v - deck.p[k]) / deck.s[k]));
        const underside = p.role === 'deck-girder';
        close(center[1] + (underside ? 1 : -1) * p.g[2] / 2,
          (underside ? -1 : 1) * deck.g[2] / 2, 'deck assembly contact survives tilt and fit');
      }
    }
  }
  const run = buildBoundaryRunParts('tankfarm', { len: 80, depth: 18, bufferDepth: 40, h: 18, seed });
  for (const rows of [run.parts, run.bufferParts]) {
    assert(rows.some(p => p.role === 'tank-foundation'), 'same tank recipe in body and buffer');
    assert.equal(rows.filter(p => p.role === 'tank-foundation').length, rows.filter(p => p.role === 'storage-tank').length);
  }
  const coast = buildBoundaryRunParts('seawall', { len: 80, depth: 12, bufferDepth: 40, h: 18, seed, water: true });
  assert(coast.bufferParts.length > 0);
  assert(coast.bufferParts.every(p => p.role === 'rock-mass'), 'ordinary coast without cold eligibility does not spawn ice');
}
assert.throws(() => storageTankParts({ w: 0, h: 1, d: 1 }), RangeError);
console.log('PASS: 80 seeds of shared storage tanks, grounded bridge fragments and unified engineering cross-sections.');
