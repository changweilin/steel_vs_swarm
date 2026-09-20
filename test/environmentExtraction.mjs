import assert from 'node:assert/strict';
import { environmentParts, linearEnvironmentParts } from '../public/js/environmentParts.js';
import { ENVIRONMENT_STRUCTURE_PARAMETERS } from '../public/js/environmentCatalog.js';
import { partBox, buildBoundaryRunParts, wallFit, WALL_KINDS } from '../public/js/edgewall.js';
import { partsAABB } from '../public/js/vehicles.js';
import { mat3Apply, mat3FromEulerXYZ, mat3Transpose } from '../public/js/partTransform.js';

const close = (a, b, label) => assert(Math.abs(a - b) < 1e-7, `${label}: ${a} != ${b}`);
const ends = part => [-1, 1].map(sign => {
  const offset = mat3Apply(mat3FromEulerXYZ(part.r), [0, sign * part.g[3] * (part.s?.[1] || 1) / 2, 0]);
  return part.p.map((v, i) => v + offset[i]);
});
for (let seed = 0; seed < 80; seed++) {
  for (const size of [[32, 16, 26], [12, 20, 18], [48, 10, 14]]) {
    const mine = environmentParts('mine', { seed, size });
    const benches = mine.filter(p => p.role === 'mine-bench');
    const top = partBox(benches.at(-1)), base = partBox(benches[0]);
    const machine = partsAABB(mine.filter(p => p.assembly === 'mine-excavator'));
    close(machine.y0, top.y1, 'excavator lands on the working bench');
    for (const axis of ['x', 'z']) {
      assert(machine[axis + '0'] >= top[axis + '0'] && machine[axis + '1'] <= top[axis + '1'],
        'entire excavator footprint stays on its supporting bench');
    }
    for (let i = 1; i < benches.length; i++) close(partBox(benches[i]).y0, partBox(benches[i - 1]).y1, 'benches touch');
    const belt = mine.find(p => p.role === 'conveyor');
    const supports = mine.filter(p => p.role === 'conveyor-support');
    assert.equal(supports.length, 4);
    for (const support of supports) {
      const [foot, head] = ends(support);
      close(foot[1], base.y1, 'conveyor foot contacts lower bench');
      const local = mat3Apply(mat3Transpose(mat3FromEulerXYZ(belt.r)), head.map((v, i) => v - belt.p[i]))
        .map((v, i) => v / (belt.s?.[i] || 1));
      close(local[1], -belt.g[2] / 2, 'support meets inclined belt underside');
      assert(Math.abs(local[0]) < belt.g[1] / 2 && Math.abs(local[2]) < belt.g[3] / 2);
    }
  }
  const rig = environmentParts('oilfield', { seed });
  const floor = partBox(rig.find(p => p.role === 'rig-floor'));
  const legs = rig.filter(p => p.role === 'derrick-leg').map(ends);
  assert.equal(legs.length, 4);
  const bays = rig.filter(p => p.role === 'derrick-brace').length / 8;
  const spec = ENVIRONMENT_STRUCTURE_PARAMETERS.derrick;
  assert(bays >= spec.bays[0] && bays <= spec.bays[1]);
  assert.equal(rig.filter(p => p.role === 'derrick-frame').length, (bays + 1) * 4);
  for (const [base, top] of legs) close(base[1], floor.y1, 'derrick leg lands on rig floor');
  for (const beam of rig.filter(p => ['derrick-brace', 'derrick-frame'].includes(p.role))) {
    for (const endpoint of ends(beam)) {
      assert(legs.some(([a, b]) => {
        const t = (endpoint[1] - a[1]) / (b[1] - a[1]);
        return t >= -1e-8 && t <= 1 + 1e-8
          && endpoint.every((v, i) => Math.abs(v - (a[i] + (b[i] - a[i]) * t)) < 1e-7);
      }), 'every brace and horizontal member connects to a leg');
    }
  }
  assert(rig.some(p => p.role === 'drill-string'));
  const tank = partBox(rig.find(p => p.role === 'storage-tank'));
  close(tank.y0, 0, 'storage tank is grounded');
  assert(tank.x0 > floor.x1, 'tank does not intersect the derrick floor');
  for (const len of [12, 30, 64]) {
    const def = WALL_KINDS.deeprig;
    const rows = linearEnvironmentParts('deeprig', { len, h: def.h, depth: def.depth, seed });
    assert(wallFit(rows, len, def.depth, def.h).fit);
    for (const deck of rows.filter(p => p.role === 'platform-deck')) {
      const b = partBox(deck), members = rows.filter(p => p.p[0] >= b.x0 && p.p[0] <= b.x1);
      const pontoons = members.filter(p => p.role === 'pontoon');
      assert.equal(pontoons.length, 2);
      for (const column of members.filter(p => p.role === 'platform-column')) {
        close(partBox(column).y1, b.y0, 'columns support platform deck');
        assert(pontoons.some(p => Math.abs(partBox(p).y1 - partBox(column).y0) < 1e-7));
      }
      const rigFloor = members.find(p => p.role === 'rig-floor');
      close(partBox(rigFloor).y0, b.y1, 'shared drilling rig lands on platform');
      assert(members.every(p => p.waterline === deck.waterline), 'module uses one waterline');
      assert(pontoons.every(p => partBox(p).y0 < p.waterline && partBox(p).y1 > p.waterline));
    }
  }
}
for (const kind of ['mine', 'oilfield', 'deeprig']) {
  const def = WALL_KINDS[kind];
  const options = { len: 64, depth: def.depth, h: def.h, bufferDepth: 40, seed: 42 };
  const batch = buildBoundaryRunParts(kind, options);
  assert.deepEqual(batch, buildBoundaryRunParts(kind, options));
  assert(wallFit(batch.parts, options.len, options.depth, options.h).fit);
}
console.log('PASS: 80 seeds of supported mining equipment, connected tapered derricks and waterline-aware offshore platforms.');
