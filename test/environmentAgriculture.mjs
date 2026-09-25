import assert from 'node:assert/strict';
import { environmentParts, ENVIRONMENT_STRUCTURE_PARAMETERS } from '../public/js/environmentParts.js';
import { ROOF_SEAT_SINK } from '../public/js/architectureRoofParts.js';
import { partBox } from '../public/js/edgewall.js';
import { mat3Apply, mat3FromEulerXYZ } from '../public/js/partTransform.js';

const close = (a, b, message) => assert(Math.abs(a - b) < 1e-7, `${message}: ${a} != ${b}`);
const world = (part, point) => mat3Apply(mat3FromEulerXYZ(part.r), point.map((v, i) => v * (part.s?.[i] || 1)))
  .map((v, i) => v + part.p[i]);
const ends = part => [-1, 1].map(sign => world(part, [0, sign * part.g[3] / 2, 0]));
const variants = new Set();
for (let seed = 0; seed < 80; seed++) {
  for (const kind of ['house', 'ranch']) for (const size of [[26, 12, 20], [12, 20, 18], [40, 8, 14]]) {
    const rows = environmentParts(kind, { seed, size });
    assert.deepEqual(rows, environmentParts(kind, { seed, size }), 'seed reproduction');
    const main = rows.find(p => p.role === 'building-body'), body = partBox(main);
    const roof = rows.filter(p => p.role === 'architecture-roof');
    assert(main.architecture, 'house participates in the shared architecture catalog');
    if (main.architecture.roofForm === 'flat') assert.equal(roof.length, 0);
    else {
      assert(roof.length > 0, 'non-flat style has roof geometry');
      assert(Math.abs(Math.min(...roof.map(p => partBox(p).y0)) - (body.y1 - ROOF_SEAT_SINK)) < 0.05, 'roof assembly rests on wall');
    }
    if (kind !== 'ranch') continue;
    const posts = rows.filter(p => p.role === 'fence-post');
    assert.equal(new Set(posts.map(p => `${p.p[0]},${p.p[2]}`)).size, posts.length, 'no doubled corner posts');
    for (const post of posts) close(partBox(post).y0, 0, 'fence post is grounded');
    for (const rail of rows.filter(p => p.role === 'fence-rail')) {
      assert(rail.g[3] <= ENVIRONMENT_STRUCTURE_PARAMETERS.ranch.fenceBay[1] + 1e-7, 'bounded unsupported span');
      for (const end of ends(rail)) assert(posts.some(p => Math.hypot(end[0] - p.p[0], end[2] - p.p[2]) < 1e-7
        && end[1] < partBox(p).y1), 'every rail end meets a supporting post');
    }
    const gateRails = rows.filter(p => p.role === 'gate-rail');
    assert.equal(gateRails.length, 2);
    assert.equal(rows.filter(p => p.role === 'gate-stile').length, 2);
    const gateEnds = ends(gateRails[0]);
    for (const end of gateEnds) assert(posts.some(p => {
      const b = partBox(p);
      return Math.abs(end[2] - p.p[2]) < 1e-7
        && Math.min(Math.abs(end[0] - b.x0), Math.abs(end[0] - b.x1)) < 1e-7;
    }), 'gate frame reaches its hinge/latch posts');
    const gateMin = Math.min(...gateEnds.map(p => p[0])), gateMax = Math.max(...gateEnds.map(p => p[0]));
    for (const rail of rows.filter(p => p.role === 'fence-rail')) {
      const points = ends(rail);
      if (!points.every(p => Math.abs(p[2] - gateEnds[0][2]) < 1e-7)) continue;
      assert(Math.max(...points.map(p => p[0])) <= gateMin || Math.min(...points.map(p => p[0])) >= gateMax,
        'fixed fence rails must not cross the gate');
    }
    const brace = rows.find(p => p.role === 'gate-brace');
    for (const end of ends(brace)) assert(gateRails.some(p => ends(p).some(v => Math.hypot(...v.map((n, k) => n - end[k])) < 1e-7)),
      'gate brace terminates at frame corners');
    const silo = partBox(rows.find(p => p.role === 'feed-silo'));
    close(silo.y0, 0, 'silo is grounded');
    close(partBox(rows.find(p => p.role === 'silo-roof')).y0, silo.y1, 'silo cap meets tank');
    variants.add(posts.length + ':' + main.architecture.style + ':' + (body.x1 - body.x0));
  }
}
assert(variants.size > 30, 'seeded roofs and fences vary');
console.log('PASS: 80 seeds × 3 envelopes of shared house roofs, supported ranch fences, braced gates and grounded silos.');
