import assert from 'node:assert/strict';
import { readSrc } from '../tools/audit_src.mjs';
import { junctionBoundary } from '../public/js/roadJunctions.js';

const src = readSrc('public', 'js', 'biomes.js');
const start = src.indexOf('  const fillLift =');
const end = src.indexOf('  // ---- 立體結構的線工授權', start);
assert(start >= 0 && end > start);
const fill = new Function('C', `with (C) { ${src.slice(start, end)} }`);
const terrain = { minX: -100, maxX: 100, minZ: -100, maxZ: 100, heightAt: () => 20 };
function run(x, z, mode = 3, dirs = [[1, 0], [0, 1], [-1, 0]]) {
  const b = { base: 0, pos: [], nrm: [], uv: [], col: [], idx: [] };
  const rec = { x, z, hw: 5, main: true, arms: mode, dirs, armHw: dirs.map((_, i) => i ? 2 : 5) };
  rec.boundary = junctionBoundary(rec);
  fill({ terrain, inb: 40, CLAMP: 2, ROAD_LIFT: .1,
    nodeArms: new Map([[0, rec]]),
    THREE: { Vector2: class { constructor(x, y) { this.x = x; this.y = y; } },
      ShapeUtils: { triangulateShape: () => [[0, 1, 2]] } },
    classify: () => 'urban', bucketOf: () => b,
    rnd: () => { throw new Error('junction fills must not consume shared randomness'); } });
  for (let i = 0; i < b.pos.length; i += 3) {
    assert(b.pos[i] >= -60 && b.pos[i] <= 60 && b.pos[i + 2] >= -60 && b.pos[i + 2] <= 60,
      `junction escaped road bounds: ${b.pos[i]}, ${b.pos[i + 2]}`);
  }
  return b;
}
assert(run(0, 0).idx.length > 0, 'interior fitted junction remains intact');
assert.equal(run(0, 0, 2, [[1, 0], [-1, 0]]).idx.length, 0, 'width transitions modify ribbons without overlay plates');
for (const sign of [-1, 1]) for (const swap of [false, true]) {
  for (const d of [57, 100, 250]) {
    const [x, z] = swap ? [0, d * sign] : [d * sign, 0];
    assert.equal(run(x, z).idx.length, 0, 'outside and partially outside fitted junctions omitted');
  }
  assert(run(swap ? 0 : 48 * sign, swap ? 48 * sign : 0).idx.length > 0,
    'full polygon near boundary still fits');
}
const q = Math.SQRT1_2;
assert.equal(run(57, 57, 2, [[q, q], [-q, q]]).idx.length, 0, 'rotated bend footprint checked');
console.log('roadJunctionBounds: fitted polygons, all edges, full footprints and overlay-free transitions passed');
