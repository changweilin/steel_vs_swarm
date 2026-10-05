import { MAPGEO, targetDistFor, MOTHER_LANES, llToXZ, xzToLL } from '../public/js/data.js';
import { synthLane } from '../public/js/venues.js';

// Deliberately fictional service fixtures exercise receipt and topology validation without networking.
export function mockSearchRoads(anchor) {
  const origin = { lat: anchor[0], lng: anchor[1], rot: 0 };
  const d = targetDistFor(MOTHER_LANES);
  const centers = [[0, 0], [0, -d * .5], [d * .5, 0], [0, d * .5], [-d * .5, 0]];
  const ways = [];
  let id = 1;
  for (const [cx, cz] of centers) for (let i = 0; i < MAPGEO.CANDIDATE_BEARINGS / 2; i++) {
    const angle = i * 2 * Math.PI / MAPGEO.CANDIDATE_BEARINGS;
    const [lat, lng] = xzToLL(cx, cz, origin), local = { lat, lng, rot: 0 };
    const A = xzToLL(-Math.sin(angle) * d / 2, Math.cos(angle) * d / 2, local).map(v => +v.toFixed(6));
    const B = xzToLL(Math.sin(angle) * d / 2, -Math.cos(angle) * d / 2, local).map(v => +v.toFixed(6));
    for (const salt of [0, 7]) for (const side of [1, 0, -1]) ways.push({ id: id++, tags: { highway: 'residential' },
      geometry: synthLane(A, B, side, salt).map(([lat, lon]) => ({ lat, lon })) });
  }
  return ways;
}

export function mockRouteData(points, shape = 0) {
  const A = points[0], B = points.at(-1), origin = { lat: A[0], lng: A[1] };
  const [bx, bz] = llToXZ(...B, origin);
  let side = 0;
  if (points.length === 3) {
    const [vx, vz] = llToXZ(...points[1], origin); side = Math.sign(bx * vz - bz * vx);
  }
  const coords = synthLane(A, B, side, shape);
  return { code: 'Ok', waypoints: points.map(() => ({ hint: '' })), routes: [{ distance: Math.hypot(bx, bz) * MAPGEO.REAL_SCALE,
    geometry: { coordinates: coords.map(p => [p[1], p[0]]) }, legs: [{ annotation: { nodes: coords.map((_, i) => i + 1) } }] }] };
}
