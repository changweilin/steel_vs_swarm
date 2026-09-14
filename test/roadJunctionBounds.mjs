import assert from 'node:assert/strict';
import { readSrc } from '../tools/audit_src.mjs';

const src = readSrc('public', 'js', 'biomes.js');
const start = src.indexOf('  const fillLift =');
const end = src.indexOf('  // ---- 立體結構的線工授權', start);
assert(start >= 0 && end > start);
const fill = new Function('C', `with (C) { ${src.slice(start, end)} }`);
const terrain = { minX: -100, maxX: 100, minZ: -100, maxZ: 100, heightAt: () => 20 };
function run(x, z, mode = 3, dirs = [[1, 0], [-1, 0]]) {
  const b = { base: 0, pos: [], nrm: [], uv: [], col: [], idx: [] };
  fill({ terrain, inb: 40, CLAMP: 2, ROAD_LIFT: .1,
    nodeArms: new Map([[0, { x, z, hw: 5, main: true, arms: mode, dirs, armHw: [5, 2] }]]),
    classify: () => 'urban', bucketOf: () => b,
    rnd: () => { throw new Error('junction fills must not consume shared randomness'); } });
  for (let i = 0; i < b.pos.length; i += 3) {
    assert(b.pos[i] >= -60 && b.pos[i] <= 60 && b.pos[i + 2] >= -60 && b.pos[i + 2] <= 60,
      `junction escaped road bounds: ${b.pos[i]}, ${b.pos[i + 2]}`);
  }
  return b;
}
assert.equal(run(0, 0).idx.length, 30, 'interior junction retains all ten triangles');
assert.equal(run(0, 0, 2).idx.length, 6, 'interior width transition remains intact');
for (const sign of [-1, 1]) for (const swap of [false, true]) {
  for (const d of [57, 100, 250]) {
    const [x, z] = swap ? [0, d * sign] : [d * sign, 0];
    assert.equal(run(x, z).idx.length, 0, 'outside and partially outside discs omitted');
    assert.equal(run(x, z, 2).idx.length, 0, 'outside and partially outside transitions omitted');
  }
  assert.equal(run(swap ? 0 : 55 * sign, swap ? 55 * sign : 0).idx.length, 30,
    'disc tangent to boundary still fits');
}
const q = Math.SQRT1_2;
assert.equal(run(54, 54, 2, [[q, q], [-q, -q]]).idx.length, 0, 'rotated transition footprint checked');
console.log('roadJunctionBounds: interior fills, all edges, full footprints and diagonal transitions passed');
