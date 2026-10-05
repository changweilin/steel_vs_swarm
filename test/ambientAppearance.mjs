import assert from 'node:assert/strict';
import { WILDLIFE_MESHES, AMBIENT_SURFACES } from '../public/js/ambientMeshData.js';
import { SMALL_ANIMALS, planSmallAnimalRoutes, planFishRoutes, planCatRoutes, planDogRoutes, planFlockRoutes,
  wildlifeInit, wildlifeStep } from '../public/js/wildlife.js';
import { planPetalFields, petalRnd, stepPetal } from '../public/js/petals.js';

const species = ['bird', 'fish', 'cat', 'dog', 'rabbit', 'squirrel', 'duck', 'frog', 'turtle', 'butterfly'];
assert.deepEqual(Object.keys(WILDLIFE_MESHES).sort(), species.sort());
for (const [name, parts] of Object.entries(WILDLIFE_MESHES)) {
  assert(parts.some(p => p.key === 'body'), name + ' has no body');
  let triangles = 0;
  for (const part of parts) {
    assert.equal(part.g[0], 'mesh');
    const { vertices, faces } = part.g[1];
    assert(vertices.every(Number.isFinite));
    assert(faces.every(v => Number.isInteger(v) && v >= 0 && v < vertices.length / 3));
    assert(faces.length % 3 === 0 && vertices.length % 3 === 0);
    for (let i = 0; i < faces.length; i += 3) {
      const [a, b, c] = faces.slice(i, i + 3).map(index => vertices.slice(index * 3, index * 3 + 3));
      const u = b.map((v, axis) => v - a[axis]), v = c.map((n, axis) => n - a[axis]);
      assert(Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) > 1e-10,
        `${name}/${part.key} contains a zero-area triangle`);
    }
    triangles += faces.length / 3;
  }
  assert(triangles < 2000, name + ' exceeds the ambient triangle budget');
  if (['bird', 'butterfly'].includes(name)) assert.equal(parts.filter(p => p.wing).length, 2);
  if (['cat', 'dog', 'rabbit', 'squirrel', 'frog', 'turtle'].includes(name)) assert.equal(parts.filter(p => p.leg).length, 4);
}
assert(AMBIENT_SURFACES.leaf.faces.length > 6 && AMBIENT_SURFACES.petal.faces.length > 6);
assert.notDeepEqual(AMBIENT_SURFACES.leaf.vertices, AMBIENT_SURFACES.petal.vertices);
const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
const anchors = { groves: [{ x: 20, z: 15, r: 15 }], shore: [[-20, 0], [0, 20], [20, 0], [0, -20]],
  settlements: [{ x: 0, z: 0, r: 10 }] };
for (const name of Object.keys(SMALL_ANIMALS)) {
  const options = { anchors, bounds, probe: () => 0, validAt: () => true };
  const routes = planSmallAnimalRoutes(name, options);
  assert(routes.length > 0, name + ' has no valid habitat route');
  assert.deepEqual(planSmallAnimalRoutes(name, options), routes);
  assert.equal(planSmallAnimalRoutes(name, { ...options, anchors: {} }).length, 0);
  assert.equal(planSmallAnimalRoutes(name, { ...options, validAt: () => false }).length, 0);
  assert.equal(planSmallAnimalRoutes(name, { ...options, probe: () => NaN }).length, 0);
  const st = wildlifeInit(routes[0]);
  for (let i = 1; i <= 600; i++) wildlifeStep(st, i / 60, 1 / 60);
  assert(st.pos.every(Number.isFinite) && st.vel.every(Number.isFinite));
  assert(planSmallAnimalRoutes(name, { ...options, low: true }).every(route => route.count < routes[0].count));
}
for (const planner of [planFlockRoutes, planCatRoutes, planDogRoutes]) {
  assert.equal(planner({ anchors, bounds, probe: () => NaN }).length, 0);
}
assert.equal(planFishRoutes({ anchors, bounds, probe: () => 1, waterY: 0 }).length, 0, 'Fish cannot inhabit dry ground');
assert.equal(planFishRoutes({ anchors, bounds, probe: () => NaN, waterY: 0 }).length, 0);
assert.equal(planFishRoutes({ anchors, bounds, probe: () => 0, waterY: 3, wetAt: () => false }).length, 0);
assert(planFishRoutes({ anchors, bounds, probe: () => 0, waterY: 3 }).length > 0, 'A zero-height bed is valid');
for (const name of ['duck', 'frog', 'turtle']) {
  const routes = planSmallAnimalRoutes(name, { anchors: { shore: [[0, 0]] }, bounds,
    probe: () => 0, validAt: x => x > 0 });
  assert(routes.length > 0, name + ' cannot find a dry bank beside a shoreline');
  assert(routes.every(route => Array.from(route.pts).every((v, i) => i % 3 !== 0 || v > 0)));
}
const crowns = Array.from({ length: 5 }, (_, i) => ({ x: i, z: 0, r: 3, top: 6 }));
assert.equal(planPetalFields(crowns, { mode: 'leaf', dryAt: () => true, groundAt: () => NaN }, petalRnd(1)).parts.length, 0);

const leaf = { h: 3, y: .001, vy: .5, r: 1, a: 0, w: .1, ang: 0, sp: 1, p1: 1, p2: 2, ox: .8, oz: .2 };
stepPetal(leaf, .1, .1);
assert(leaf.groundTime > 0 && leaf.y === 0 && leaf.oy > 0);
const settled = [leaf.ox, leaf.oz];
stepPetal(leaf, .1, .2);
assert.deepEqual([leaf.ox, leaf.oz], settled, 'A settled leaf cannot orbit through the soil');
stepPetal(leaf, .1, .3, { windAmp: 2, windDir: [1, 0] });
assert(leaf.y > 0 && leaf.lifted && leaf.groundTime === 0, 'A gust should lift a settled leaf');
const phase = leaf.slowPhase;
stepPetal(leaf, 0, 9999, { windAmp: .5, windDir: [0, 1] });
assert.equal(leaf.slowPhase, phase, 'Wind changes cannot multiply elapsed age into a phase jump');
for (const windDir of [[], [1], [NaN, 0], [0, Infinity]]) {
  const p = { ...leaf };
  stepPetal(p, .1, 1, { windAmp: 2, windDir });
  assert([p.ox, p.oz, p.oy].every(Number.isFinite), 'Malformed wind poisoned a leaf');
}
console.log('Ten authored species, articulated meshes, habitat omission, replay, budgets, grounded leaves and gust lift passed.');
