import assert from 'node:assert/strict';
import { planLaneGuidance, LANE_SIGN_RESERVE, LANE_MARK_LIMIT } from '../public/js/laneGuidancePlan.js';
import { ROAD_STRUCTURE_MESHES } from '../public/js/roadStructureMeshData.js';
import { LANE_GUIDANCE_SIZE, laneGuidanceHeights } from '../public/js/laneGuidanceSize.js';
import { readSrc, grabMethod } from '../tools/audit_src.mjs';

const profile = (points, y = 8) => ({ samples: points.map(([x, z]) => ({ x, y, z })) });
const route = profile([[0, 0], [64, 0], [64, -64], [180, -64]]);
const before = JSON.stringify(route);
const guide = planLaneGuidance([route], { laneIds: [2], surfaceAt: () => 8 });
assert.equal(JSON.stringify(route), before, 'presentation must not mutate the authoritative route');
assert.deepEqual(guide, planLaneGuidance([route], { laneIds: [2], surfaceAt: () => 8 }), 'placement must replay without randomness');
assert(guide.signs.length && guide.markers.length);
assert(guide.signs.every(p => p.id === 2 && p.copy.ref === '03'), 'subset maps retain their mother-lane identity');
assert(guide.signs.every(p => p.copy.t === '戰備道'), 'the route title uses the requested wording');
assert(guide.signs.some(p => p.arrow === 'left') && guide.signs.some(p => p.arrow === 'right'), 'opposite approaches see the corresponding bend');
for (let i = 0; i < guide.signs.length; i += 2) {
  const a = guide.signs[i], b = guide.signs[i + 1];
  assert(Math.abs(Math.cos(a.ry - b.ry) + 1) < 1e-9, 'plates face opposing approaches');
}
const large = planLaneGuidance([0, 1, 2].map(z => profile([[0, z * 80], [60000, z * 80]])));
assert(large.signs.length <= LANE_SIGN_RESERVE && large.markers.length <= LANE_MARK_LIMIT, 'world size cannot grow GPU batches without bounds');
assert.deepEqual(planLaneGuidance([null, profile([[0, 0]]), profile([[0, 0], [0, 0]])]), { markers: [], signs: [] });
const repeated = planLaneGuidance([profile([[0, 0], [0, 0], [80, 0]])]);
assert(repeated.signs.every(p => Object.values(p).filter(v => typeof v === 'number').every(Number.isFinite)));
assert.deepEqual(planLaneGuidance([route], { surfaceAt: () => NaN }), { markers: [], signs: [] }, 'failed sampling omits furniture');
assert.deepEqual(planLaneGuidance([route], { surfaceAt: () => 20 }), { markers: [], signs: [] }, 'bridge-edge furniture cannot jump onto another level');
assert.deepEqual(planLaneGuidance([route], { contains: () => false }), { markers: [], signs: [] }, 'outside-map furniture is omitted');
const buried = planLaneGuidance([route], { surfaceAt: () => 8,
  ceilingAt: () => 8 + laneGuidanceHeights().top });
assert.equal(buried.signs.length, 0, 'tall panels cannot penetrate tunnel slabs');
assert(buried.markers.length > 0, 'low-clearance routes retain short reflectors');
const compact = planLaneGuidance([route], { surfaceAt: () => 8,
  ceilingAt: () => 8 + laneGuidanceHeights().top + .3 });
assert(compact.signs.length > 0 && compact.signs.every(p => p.h <= LANE_GUIDANCE_SIZE.panelH), 'compact panels fit a passable low ceiling');
const runs = kind => [{ kind, tags: { highway: 'primary' }, points: [[0, 0], [200, 0]],
  hw: kind === 'road' ? 18 : 8, floors: kind === 'road' ? [null, null] : [8, 8] }];
const highway = planLaneGuidance([profile([[0, 0], [200, 0]])], { roadRuns: runs('road') });
assert(highway.markers.every(p => Math.abs(p.z) > 18), 'wide-road posts remain outside the carriageway');
const tunnel = planLaneGuidance([profile([[0, 0], [200, 0]])], { roadRuns: runs('tunnel') });
assert(tunnel.signs.every(p => Math.abs(p.z) + p.h * 4 / 2 + .15 < 8), 'narrowed tunnel plates fit inside the wall envelope');
const bridge = planLaneGuidance([profile([[0, 0], [200, 0]])], { roadRuns: runs('bridge') });
assert(bridge.markers.every(p => Math.abs(p.z) + .2 < 8), 'bridge supports stay on their deck');
for (const kind of ['lane_panel', 'lane_hood', 'lane_delineator', 'lane_arrow']) {
  const mesh = ROAD_STRUCTURE_MESHES[kind];
  assert(mesh && mesh.vertices.every(Number.isFinite) && mesh.faces.every(i => i >= 0 && i < mesh.vertices.length / 3));
}
const game = readSrc('public', 'js', 'game.js');
assert(!/_laneDash|laneSideLines|_updateLaneDashes/.test(game), 'retired moving ribbons must have no update or texture owner');
const init = grabMethod(game, '_initLanes');
assert(init.indexOf('_buildLaneSurf()') < init.indexOf('planLaneGuidance(this._laneSurf'), 'guidance consumes the settled NPC profile');
assert(/disposeTree\(this.laneGuidance\)/.test(grabMethod(game, 'dispose')), 'each battle releases its guide instances');
assert(!/Math.random|mulberry32|blockers.push/.test(readSrc('public', 'js', 'laneGuidancePlan.js')), 'guidance cannot change layout randomness or authority');
assert(!/blockers|collider|solidResolve/.test(readSrc('public', 'js', 'laneGuidance.js')), 'rendered dimensions never enter player or NPC collision');
console.log('PASS: lane identity, opposing bend directions, deterministic placement, atlas/instance bounds, missing surfaces, layered heights, tunnel clearance and ribbon retirement.');
