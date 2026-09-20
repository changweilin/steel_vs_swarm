import assert from 'node:assert/strict';
import { environmentParts } from '../public/js/environmentParts.js';
import { partBox } from '../public/js/edgewall.js';

const close = (a, b, message) => assert(Math.abs(a - b) < 1e-7, `${message}: ${a} != ${b}`);
function shell(part) {
  const { vertices, faces } = part.g[1], points = [];
  for (let i = 0; i < vertices.length; i += 3) points.push(vertices.slice(i, i + 3));
  const edges = new Map();
  let volume = 0;
  for (let i = 0; i < faces.length; i += 3) {
    const ids = faces.slice(i, i + 3), [a, b, c] = ids.map(n => points[n]);
    volume += a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    for (let j = 0; j < 3; j++) {
      const from = ids[j], to = ids[(j + 1) % 3], key = [Math.min(from, to), Math.max(from, to)].join(',');
      const edge = edges.get(key) || { count: 0, direction: 0 };
      edge.count++; edge.direction += from < to ? 1 : -1; edges.set(key, edge);
    }
    // No triangle may cover the vertical axis: a pipe mouth must remain open.
    const cross = (p, q) => p[0] * q[2] - p[2] * q[0];
    const signs = [cross(a, b), cross(b, c), cross(c, a)];
    assert(signs.some(v => v < -1e-9) && signs.some(v => v > 1e-9), 'no solid disk or triangle across the bore');
  }
  assert(volume > 0, 'outward shell winding');
  for (const edge of edges.values()) assert(edge.count === 2 && edge.direction === 0, 'watertight wall with opposite shared edges');
  return points;
}
for (let seed = 0; seed < 80; seed++) for (const kind of ['factory', 'powerplant', 'incinerator']) {
  const rows = environmentParts(kind, { seed });
  assert.deepEqual(rows, environmentParts(kind, { seed }), 'seeded reproducibility');
  const body = partBox(rows.find(p => p.role === 'building-body'));
  const stacks = rows.filter(p => p.role === 'chimney'), bands = rows.filter(p => p.role === 'stack-band');
  assert.equal(stacks.length, bands.length);
  for (let i = 0; i < stacks.length; i++) {
    const stack = stacks[i], band = bands[i], points = shell(stack), bandPoints = shell(band);
    close(partBox(stack).y0, body.y1, 'stack enters the hall at the wall top');
    assert(partBox(band).y1 < partBox(stack).y1, 'band below mouth');
    const bottom = points[0], top = points[16];
    for (const point of bandPoints.slice(bandPoints.length / 2)) {
      const y = (point[1] * band.s[1] + band.p[1] - stack.p[1]) / stack.s[1];
      const r = bottom[0] + (top[0] - bottom[0]) * (y - bottom[1]) / (top[1] - bottom[1]);
      close(Math.hypot(point[0], point[2]) * band.s[0], r * stack.s[0], 'band inner wall follows stack taper');
    }
  }
  if (kind !== 'powerplant') continue;
  const tower = rows.find(p => p.role === 'cooling-tower'), points = shell(tower);
  const basin = partBox(rows.find(p => p.role === 'cooling-basin'));
  close(basin.y0, 0, 'basin grounded');
  assert(basin.x0 > body.x1, 'tower separated from hall');
  const radii = points.slice(0, points.length / 2).filter((_, i) => i % 16 === 0).map(p => p[0]);
  const throat = Math.min(...radii), neck = radii.indexOf(throat);
  assert(neck > 0 && neck < radii.length - 1 && throat < radii[0] && throat < radii.at(-1), 'interior throat and flared mouth');
  const supports = rows.filter(p => p.role === 'cooling-support');
  assert.equal(supports.length, 12);
  for (const post of supports) {
    close(partBox(post).y0, basin.y1, 'support rests on basin');
    close(partBox(post).y1, partBox(tower).y0, 'support reaches shell');
    const radial = Math.hypot(post.p[0] - tower.p[0], post.p[2] - tower.p[2]);
    const inner = points.at(-16)[0] * tower.s[0], outer = radii[0] * tower.s[0];
    assert(radial > inner && radial < outer, 'support axis under shell wall');
  }
}
console.log('PASS: 80 seeds of open industrial stacks, conforming bands, manifold cooling shells and supported intake gaps.');
