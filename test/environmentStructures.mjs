import assert from 'node:assert/strict';
import { environmentParts, linearEnvironmentParts } from '../public/js/environmentParts.js';
import { partBox, WALL_KINDS } from '../public/js/edgewall.js';

for (let seed = 0; seed < 80; seed++) {
  for (const kind of ['factory', 'powerplant', 'incinerator']) {
    const rows = environmentParts(kind, { seed });
    const body = partBox(rows.find(p => p.role === 'building-body'));
    const ends = rows.filter(p => p.role === 'roof-end');
    assert(ends.length > 0, `${kind}: missing roof`);
    assert.equal(ends.length, rows.filter(p => p.role === 'sawtooth-roof').length);
    for (const end of ends) {
      assert(Math.abs(partBox(end).y0 - body.y1) < 1e-8, 'roof meets wall');
      const { vertices, faces } = end.g[1];
      let volume = 0;
      for (let i = 0; i < faces.length; i += 3) {
        const [a, b, c] = faces.slice(i, i + 3).map(n => vertices.slice(n * 3, n * 3 + 3));
        volume += a[0]*(b[1]*c[2]-b[2]*c[1]) + a[1]*(b[2]*c[0]-b[0]*c[2]) + a[2]*(b[0]*c[1]-b[1]*c[0]);
      }
      assert(volume > 0, 'roof has outward winding and nonzero volume');
    }
  }
  const greenhouse = environmentParts('greenhouse', { seed });
  const ridge = partBox(greenhouse.find(p => p.role === 'ridge-frame'));
  const gables = greenhouse.filter(p => p.role === 'glass-gable');
  assert.equal(gables.length, 4);
  for (const gable of gables) assert(partBox(gable).y1 >= ridge.y0, 'gable closes up to ridge');
  for (const kind of ['windland', 'windsea', 'solarfield', 'floatsolar']) {
    const def = WALL_KINDS[kind];
    if (!def) throw new Error(`Missing catalog entry ${kind}`);
    const rows = linearEnvironmentParts(kind, { len: 30, h: def.h, depth: def.depth, seed });
    if (kind.startsWith('wind')) {
      assert.equal(rows.filter(p => p.role === 'rotor-blade').length,
        rows.filter(p => p.role === 'rotor-hub').length * 3);
    } else {
      let panel;
      for (const part of rows) {
        if (part.role === 'solar-panel') panel = part;
        if (part.role === 'panel-grid') assert.deepEqual(part.r, panel.r);
      }
      assert.equal(rows.filter(p => p.role === 'panel-pedestal').length,
        rows.filter(p => p.role === 'solar-panel').length);
    }
  }
}
console.log('PASS: 80 seeds of roof closure, gables, three-blade rotors and supported solar panels.');
