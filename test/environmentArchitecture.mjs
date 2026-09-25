import assert from 'node:assert/strict';
import { ENVIRONMENT_BUILDINGS, ENVIRONMENT_OBJECTS } from '../public/js/environmentCatalog.js';
import { environmentBuildingPlan } from '../public/js/environmentParts.js';
import { environmentParts } from '../public/js/environmentParts.js';
import { ROOF_FORMS, ARCHITECTURE_STYLES } from '../public/js/architectureStyles.js';
import { architecturalRoofParts, ROOF_SEAT_SINK } from '../public/js/architectureRoofParts.js';
import { partBox } from '../public/js/edgewall.js';

for (const [kind, spec] of Object.entries(ENVIRONMENT_BUILDINGS)) {
  const styles = new Set(), shapes = new Set();
  for (let seed = 0; seed < 80; seed++) {
    const size = ENVIRONMENT_OBJECTS[kind].size, plan = environmentBuildingPlan(kind, size, seed);
    assert.deepEqual(plan, environmentBuildingPlan(kind, size, seed), 'repeatable architecture plan');
    for (const [value, span, range] of [[plan.w, size[0], spec.width], [plan.d, size[2], spec.depth], [plan.bodyH, size[1], spec.body]]) {
      assert(value / span >= range[0] && value / span <= range[1], 'authored structural range');
    }
    assert.equal(plan.style.wall, ARCHITECTURE_STYLES[plan.style.id].wall, 'shared palette');
    if (spec.affinity) assert(plan.style.affinity.split('|').some(key => spec.affinity.includes(key)), 'compatible function/style');
    assert(plan.parts.every(p => partBox(p).y0 >= -1e-7), 'facade must not lift grounded assembly');
    assert(plan.parts.some(p => p.role === 'window'), 'functional facade is generated');
    styles.add(plan.style.id);
    shapes.add(JSON.stringify(plan.parts.map(({ g, p, r }) => ({ g, p, r }))));
  }
  assert(styles.size > 1, kind + ': multiple compatible architectural styles');
  assert(shapes.size > 60, kind + ': geometry varies, not only color');
}

const poly = { outer: [[-10,-6],[10,-6],[10,6],[-10,6]], holes: [] };
for (const form of Object.keys(ROOF_FORMS)) {
  const rows = architecturalRoofParts(poly, 8, { roof: 0x777777 }, form);
  if (form === 'flat') { assert.equal(rows.length, 0); continue; }
  assert(rows.length > 0, form + ': roof exists');
  assert(Math.abs(Math.min(...rows.map(p => partBox(p).y0)) - (8 - ROOF_SEAT_SINK)) < 1e-7, form + ': roof meets wall');
  for (const part of rows.filter(p => p.g[0] === 'mesh')) {
    const { vertices, faces } = part.g[1], edges = new Map(); let volume = 0;
    for (let i = 0; i < faces.length; i += 3) {
      const ids = faces.slice(i, i + 3), [a,b,c] = ids.map(n => vertices.slice(n * 3, n * 3 + 3));
      const ab = b.map((v,k) => v-a[k]), ac = c.map((v,k) => v-a[k]);
      const normal = [ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0]];
      assert(Math.hypot(...normal) > 1e-10, form + ': no degenerate triangles');
      volume += a[0]*(b[1]*c[2]-b[2]*c[1]) + a[1]*(b[2]*c[0]-b[0]*c[2]) + a[2]*(b[0]*c[1]-b[1]*c[0]);
      for (let j = 0; j < 3; j++) {
        const from = ids[j], to = ids[(j+1)%3], key = [Math.min(from,to),Math.max(from,to)].join(',');
        const edge = edges.get(key) || { count: 0, winding: 0 };
        edge.count++; edge.winding += from < to ? 1 : -1; edges.set(key, edge);
      }
    }
    assert(volume > 0, form + ': outward roof winding');
    assert([...edges.values()].every(e => e.count === 2 && e.winding === 0), form + ': closed roof volume');
  }
}
for (let seed = 0; seed < 80; seed++) {
  const rows = environmentParts('skyfall', { seed });
  assert(rows.find(p => p.role === 'building-body').architecture.function === 'commercial_skyscraper');
  assert(Math.abs(Math.min(...rows.map(p => partBox(p).y0))) < 1e-7, 'fallen assembly grounded after rigid rotation');
}
console.log('PASS: 400 seeded building plans, functional style/shape diversity, all closed roof forms and 80 fallen towers.');
