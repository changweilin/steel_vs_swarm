import assert from 'node:assert/strict';
import { environmentParts, linearEnvironmentParts } from '../public/js/environmentParts.js';
import { partBox, WALL_KINDS } from '../public/js/edgewall.js';
import { mat3Apply, mat3FromEulerXYZ } from '../public/js/partTransform.js';

for (let seed = 0; seed < 80; seed++) {
  for (const kind of ['tetrapod', 'wetpods']) {
    const def = WALL_KINDS[kind];
    const rows = linearEnvironmentParts(kind, { len: 30, depth: def.depth, h: def.h, seed });
    for (const core of rows.filter(p => p.role === 'breakwater-core')) {
      const arms = rows.filter(p => p.role === 'breakwater-arm' && p.pod === core.pod);
      assert.equal(arms.length, 4, 'tetrapods have four distinct tapered legs');
      const directions = arms.map(p => mat3Apply(mat3FromEulerXYZ(p.r), [0, 1, 0]));
      for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
        assert(Math.abs(directions[a].reduce((sum, v, k) => sum + v * directions[b][k], 0) + 1/3) < 1e-9,
          'tetrahedral legs must not collapse into crossed cylinders');
      }
      for (const arm of arms) {
        const axis = mat3Apply(mat3FromEulerXYZ(arm.r), [0, 1, 0]);
        assert(axis.every((v, k) => Math.abs(arm.p[k] - v * arm.g[3] / 2 - core.p[k]) < 1e-9),
          'all leg roots meet the core');
      }
    }
  }
  const rack = linearEnvironmentParts('oysterracks', { len: 30, depth: 14, h: 14, seed });
  const posts = rack.filter(p => p.role === 'rack-post');
  for (const rail of rack.filter(p => p.role === 'longline')) {
    const supports = posts.filter(p => p.p[2] === rail.p[2] && Math.abs(p.p[0] - rail.p[0]) < rail.g[1] / 2);
    assert.equal(supports.length, 2, 'each rail needs both end posts');
    for (const post of supports) {
      assert.equal(partBox(post).y0, 0, 'rack posts are grounded');
      assert(Math.abs(partBox(post).y1 - rail.p[1]) < 1e-9);
    }
  }
  assert(rack.some(p => p.role === 'oyster-cluster'));
  assert(rack.every(p => !p.motion && !p.waterline), 'intertidal racks remain fixed');
  const cage = linearEnvironmentParts('searanch', { len: 30, depth: 16, h: 12, seed });
  assert(cage.some(p => p.role === 'cage-bottom'), 'nets include a bottom');
  for (const part of cage) {
    assert.equal(part.motion.kind, 'float');
    assert.equal(part.motion.pivot[1], part.waterline, 'float pivot is at the water surface');
    if (part.role === 'cage-float') assert.equal(part.p[1] - part.waterline, 0, 'float straddles water');
    if (part.role === 'cage-bottom') assert(partBox(part).y1 < part.waterline, 'net bottom is underwater');
  }
  for (const kind of ['factory', 'powerplant', 'incinerator']) {
    const rows = environmentParts(kind, { seed });
    const body = partBox(rows.find(p => p.role === 'building-body'));
    const ends = rows.filter(p => p.role === 'architecture-roof');
    const form = rows.find(p => p.role === 'building-body').architecture.roofForm;
    assert.equal(ends.length > 0, form !== 'flat', `${kind}: style determines roof`);
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
console.log('PASS: 80 seeds of roofs, rotors, solar panels, tetrahedral legs, supported oyster racks and floating net cages.');
