import assert from 'node:assert/strict';
import { junctionBoundary, roadTransitionIndex, roadCurveIndex, roadOffsetPoint, roadPathWidthAt, roadQuadIndices } from '../public/js/roadJunctions.js';
import { planRoadSigns, speedSign, trafficSignCopies, roadDestination, ROAD_SIGN_LIMIT } from '../public/js/roadSigns.js';
import { parseOsmFeatureElements, osmFeatureQuery, OSM_FEATURE_QUERY_VERSION } from '../public/js/osmQuery.js';
import { llToXZ } from '../public/js/data.js';
import { readSrc, grabFn } from '../tools/audit_src.mjs';

const interpolate = new Function(readSrc('public', 'js', 'biomes.js').match(/const flareHw = [\s\S]*?\n};/)[0] + '\nreturn flareHw;')();
const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const intersects = (a, b, c, d) => cross(a, b, c) * cross(a, b, d) < -1e-8
  && cross(c, d, a) * cross(c, d, b) < -1e-8;
let polygons = 0;
for (const angles of [[0, 90], [0, 90, 180], [0, 90, 180, 270], [0, 120, 240],
  [0, 30, 180, 210], [0, 72, 144, 216, 288]]) {
  for (const rotation of [0, 13, 47]) for (const hw of [3.2, 6.4, 9.6]) {
    const dirs = angles.map(a => [(Math.cos((a + rotation) * Math.PI / 180)), Math.sin((a + rotation) * Math.PI / 180)]);
    const rec = { x: 17, z: -32, hw, dirs, armHw: dirs.map((_, i) => i ? 3.2 : hw), armLength: dirs.map(() => 100) };
    const boundary = junctionBoundary(rec);
    if (angles.length === 2) { assert.equal(boundary, null, 'bends use a continuous ribbon'); continue; }
    assert(boundary, `missing ${angles} / ${rotation} / ${hw}`);
    assert(boundary.points.flat().every(Number.isFinite));
    assert(boundary.radius < hw * 7);
    const p = boundary.points;
    for (let i = 0; i < p.length; i++) for (let j = i + 2; j < p.length; j++) {
      if (i === 0 && j === p.length - 1) continue;
      assert(!intersects(p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length]),
        `self-intersecting ${angles} / ${rotation} / ${hw} / ${i},${j}`);
    }
    const swapped = junctionBoundary({ ...rec, dirs: [...dirs].reverse(), armHw: [...rec.armHw].reverse(), armLength: [...rec.armLength].reverse() });
    assert.deepEqual(swapped.points, boundary.points, 'way order does not change the pavement boundary');
    polygons++;
  }
}
assert.equal(junctionBoundary({ dirs: [[1, 0]], armHw: [3] }), null);
assert.equal(junctionBoundary({ dirs: [[1, 0], [0, 1]], armHw: [NaN, 3] }), null);
const rec = { x: 0, z: 0, arms: 2, dirs: [[1, 0], [-1, 0]], armHw: [9.6, 2], hw: 9.6, armLength: [100, 100] };
const width = roadTransitionIndex([rec], interpolate);
assert.equal(width(0, 0, 9.6), width(0, 0, 2), 'both ribbons have identical seam width');
for (let x = .25; x < 50; x += .25) {
  assert(width(x, 0, 9.6) >= width(x - .25, 0, 9.6));
  assert(width(-x, 0, 2) <= width(-x + .25, 0, 2));
  assert(width(x, 0, 9.6) >= 5.8 && width(x, 0, 9.6) <= 9.6);
}
assert.equal(width(50, 0, 9.6), 9.6); assert.equal(width(-50, 0, 2), 2);
assert.equal(width(0, 30, 4), 4, 'nearby unrelated road widths remain untouched');
assert.equal(roadTransitionIndex([{ ...rec, roundabout: true }], interpolate)(0, 0, 9.6), 9.6);
assert.equal(roadTransitionIndex([{ ...rec, layer: 1 }], interpolate)(0, 0, 9.6, 0), 9.6,
  'different road layers never share a taper');

let curveTriangles = 0;
for (let degrees = 1; degrees <= 179; degrees++) for (const hw of [1.6, 5, 9.6]) {
  for (const length of [2, 50]) for (const rotation of [0, 37]) {
    const theta = degrees * Math.PI / 180, r = rotation * Math.PI / 180;
    const a = [-Math.cos(r), -Math.sin(r)], b = [Math.cos(theta + r), Math.sin(theta + r)];
    const node = { x: 0, z: 0, arms: 2, dirs: [a, b], hw, armHw: [hw, hw], armLength: [length, length] };
    const curve = roadCurveIndex([node]);
    const first = a.map(v => v * length), last = b.map(v => v * length);
    const run = curve([first, [0, 0], last]).filter(p => p.normal);
    assert(run.length > 0);
    const incoming = curve([first, [0, 0]]).at(-1), outgoing = curve([[0, 0], last])[0];
    assert.deepEqual(incoming, outgoing, 'split ways share position, tangent, width and inner radius');
    assert(Math.hypot(...incoming) <= hw + 1e-8, 'the original navigation node stays inside the road');
    for (let i = 1; i < run.length; i++) {
      const p = run[i - 1], q = run[i];
      const pr = roadOffsetPoint(p, ...p.normal, hw), pl = roadOffsetPoint(p, ...p.normal, -hw);
      const qr = roadOffsetPoint(q, ...q.normal, hw), ql = roadOffsetPoint(q, ...q.normal, -hw);
      assert([...pr, ...pl, ...qr, ...ql].every(Number.isFinite));
      const corners = [pr, pl, qr, ql], positions = corners.flatMap(([x, z]) => [x, 0, z]);
      const triangles = roadQuadIndices(positions, 0, 1, 2, 3);
      for (let k = 0; k < triangles.length; k += 3) {
        assert(cross(...triangles.slice(k, k + 3).map(j => corners[j])) <= 1e-8,
          `folded inner road face: ${degrees} degrees, width ${hw}, length ${length}`);
      }
      curveTriangles += 2;
    }
  }
}
assert.deepEqual(roadCurveIndex([{ arms: 2, armLength: [NaN, 2] }])([[0, 0], [1, 1]]), [[0, 0], [1, 1]]);
const bendNode = { ...rec, dirs: [[-1, 0], [0, 1]], armLength: [100, 100] };
const bend = roadCurveIndex([bendNode]);
const wideRun = bend([[-100, 0], [0, 0]]), narrowRun = bend([[0, 0], [0, 100]]);
const seam = wideRun.at(-1);
assert.deepEqual(seam, narrowRun[0]);
assert(wideRun.filter(p => p.hw).every(p => p.hw === seam.hw));
assert(narrowRun.filter(p => p.hw).every(p => p.hw === seam.hw), 'width changes settle on the approaches, outside the bend');
const bendWidth = roadTransitionIndex([bendNode], interpolate, bend.reachOf);
assert.equal(bendWidth(...wideRun.find(p => p.hw).slice(0, 2), 9.6), seam.hw);
assert.equal(bendWidth(...narrowRun.filter(p => p.hw).at(-1).slice(0, 2), 2), seam.hw);
assert.equal(roadPathWidthAt(wideRun, () => 9.6)(...seam.slice(0, 2), 9.6),
  roadPathWidthAt(narrowRun, () => 2)(...seam.slice(0, 2), 2));
const ordinaryBend = roadCurveIndex([{ ...bendNode, hw: 5, armHw: [5, 5] }])([[-100, 0], [0, 0], [0, 100]]);
assert(ordinaryBend.filter(p => p.normal).every(p => p.innerScale === 1), 'ordinary right-angle bends retain their full inside lane width');

assert.deepEqual(speedSign('30 mph'), { t: '30', s: 'mph', symbol: 'speed' });
assert.deepEqual(speedSign('50'), { t: '50', s: null, symbol: 'speed' });
for (const value of [null, '', 'walk', 'DE:urban', 'none', '50;70', '50 @ (wet)', '-5', '999', '70 knots']) assert.equal(speedSign(value), null);
assert.equal(trafficSignCopies({ traffic_sign: 'DE:999' }).length, 0);
assert.deepEqual(trafficSignCopies({ traffic_sign: 'DE:274[30];DE:206' }).map(c => c.t), ['30', 'STOP']);
assert.equal(trafficSignCopies({ highway: 'stop', traffic_sign: 'stop' }).length, 1);
assert.equal(roadDestination({ destination: '新宿;原宿', 'destination:ref': '305' }, 1).t, '新宿');
assert.equal(roadDestination({ destination: '新宿' }, -1), null, 'forward destinations do not leak to opposing traffic');
const run = { kind: 'road', points: [[-100, 0], [0, 0], [100, 0]], hw: 4, widths: [4, 4, 4],
  tags: { highway: 'secondary', name: '明治通り', 'name:en': 'Meiji Avenue', maxspeed: '40', 'maxspeed:backward': '30', destination: '新宿;原宿' } };
const options = { runs: [run], heightAt: () => 8, points: [{ x: 0, z: 0, tags: { highway: 'give_way' } }],
  targets: [{ x: 25, z: 30, tags: { tourism: 'attraction', name: '明治神宮' } },
    { x: -25, z: -30, tags: { amenity: 'townhall', name: '渋谷区役所' } }] };
const signs = planRoadSigns(options);
assert.deepEqual(signs, planRoadSigns(options));
for (const name of ['明治通り', '明治神宮', '渋谷区役所', '新宿']) assert(signs.some(s => s.copy.t === name));
assert(!signs.some(s => s.copy.t === 'Meiji Avenue'));
assert(signs.some(s => s.style === 'tourist')); assert(signs.some(s => s.style === 'civic'));
const forward = signs.find(s => s.copy.t === '40'), backward = signs.find(s => s.copy.t === '30');
assert.equal(forward.ry, -Math.PI / 2); assert.equal(backward.ry, Math.PI / 2);
assert(signs.every(s => Math.abs(s.z) >= run.hw + 2.8));
assert.equal(planRoadSigns({ ...options, free: () => false }).length, 0);
assert.equal(planRoadSigns({ ...options, heightAt: () => NaN }).length, 0);
assert.equal(planRoadSigns({ ...options, runs: [{ ...run, kind: 'bridge' }] }).length, 0);
assert.equal(planRoadSigns({ ...options, runs: [{ ...run, kind: 'tunnel' }] }).length, 0);
const many = planRoadSigns({ ...options, points: Array.from({ length: 150 }, (_, i) => ({ x: i - 75, z: 0, tags: { highway: 'stop' } })) });
assert(many.length <= ROAD_SIGN_LIMIT);
assert(many.some(s => s.style === 'tourist') && many.some(s => s.style === 'civic'),
  'dense traffic signs cannot crowd out local landmarks and public offices');
const crossRoad = { ...run, points: [[0, -100], [0, 100]], tags: { highway: 'secondary' } };
const beforeJunction = planRoadSigns({ runs: [run, crossRoad], heightAt: () => 8,
  points: [{ x: 0, z: 0, tags: { highway: 'stop' } }] }).find(s => s.copy.symbol === 'stop');
assert(beforeJunction && Math.abs(beforeJunction.x) > crossRoad.hw + .3, 'stop posts retreat outside intersecting carriageways');
const reverse = planRoadSigns({ runs: [{ ...run, tags: { highway: 'secondary', oneway: '-1', maxspeed: '30' } }], heightAt: () => 8 });
assert(reverse.every(s => s.ry === Math.PI / 2), 'reverse one-way faces incoming traffic');

const routed = parseOsmFeatureElements(['stop', 'give_way', 'crossing', 'traffic_signals'].map((highway, i) =>
  ({ type: 'node', lat: 25, lon: 121 + i / 10000, tags: { highway } })));
assert.equal(routed.pois.length, 4);
assert.equal(OSM_FEATURE_QUERY_VERSION, 12);
const query = osmFeatureQuery({ minLat: 24, maxLat: 25, minLng: 120, maxLng: 121 });
for (const tag of ['traffic_sign', 'give_way', 'traffic_signals', 'viewpoint', 'police', 'post_office']) assert(query.includes(tag));
for (const clause of query.split(';').filter(clause => /^node\["(?:amenity|tourism|traffic_sign|highway|traffic_calming|office)"/.test(clause))) {
  const output = query.slice(query.indexOf(clause) + clause.length + 1).split(';')[0];
  assert(/^out (?:body )?\d+$/.test(output), 'mapped sign nodes must return coordinates along with tags');
}
for (const fixture of ['shibuya_dense', 'taipei_dense']) {
  const raw = JSON.parse(readSrc('test', 'fixtures', 'osm', fixture + '.json'));
  const roads = raw.responses.roads.elements.filter(e => e.type === 'way' && e.tags?.highway && e.geometry?.length > 1);
  const runs = roads.map(e => ({ kind: e.tags.bridge ? 'bridge' : e.tags.tunnel ? 'tunnel' : 'road',
    hw: 4, tags: e.tags, points: e.geometry.map(p => llToXZ(p.lat, p.lon, raw.center)) }));
  const result = planRoadSigns({ runs, heightAt: () => 8 });
  assert(result.some(s => s.style === 'street'), fixture + ' has local road plates');
  const names = new Set(roads.map(e => e.tags.name));
  assert(result.filter(s => s.style === 'street').every(s => names.has(s.copy.t)));
}
const packCells = new Function(grabFn(readSrc('public', 'js', 'worldtext.js'), 'packCells') + '\nreturn packCells;')();
const packed = packCells(Array.from({ length: 300 }, (_, i) => ({ cw: i % 2 ? 512 : 192, ch: i % 2 ? 160 : 192 })), 2048, 2048);
assert(packed.H <= 2048 && packed.W <= 2048 && packed.dropped > 0);
console.log(`PASS: ${polygons} junction polygons, ${curveTriangles} non-folding bend faces, continuous width seams, native OSM labels, directional signs, omissions and bounded atlas.`);
