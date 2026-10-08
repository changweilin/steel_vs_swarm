import assert from 'node:assert/strict';
import { register } from 'node:module';
const modules = {
  three: new URL('../out/forest_review/three.module.js', import.meta.url).href,
  'three/addons/utils/BufferGeometryUtils.js': new URL('../out/forest_review/utils_BufferGeometryUtils.js', import.meta.url).href,
};
register('data:text/javascript,' + encodeURIComponent(`const modules = ${JSON.stringify(modules)};
export async function resolve(s,c,next) { return modules[s] ? {url:modules[s],shortCircuit:true} : next(s,c); }`), import.meta.url);
const { EXTERIOR_SCHEMES, resolveExteriorScheme, getEdgeFrame } = await import('../public/js/architectureStyles.js');
const { chooseArchitecture, createArchitecturePlanner } = await import('../public/js/buildingDiversity.js');
const { architecturalFacadeParts, architecturalEntranceParts } = await import('../public/js/architectureFacadeParts.js');
const { architecturePartGeometry } = await import('../public/js/architecturePartGeometry.js');
const { EXTERIOR_MESHES } = await import('../public/js/architectureExteriorMeshData.js');
const { FACADE_GEOMETRY_LIMIT } = await import('../public/js/regionalArchitecture.js');
const { doorFinish } = await import('../public/js/buildingAppurtenances.js');

const counts = {}, random = Math.random;
Math.random = () => { throw Error('Exterior planning consumed nondeterministic randomness'); };
try {
  for (let seed = 0; seed < 10000; seed++) {
    const style = chooseArchitecture(17, `building/${seed}`, { urban: true });
    const exterior = resolveExteriorScheme(style);
    assert.deepEqual(exterior, resolveExteriorScheme(style, 'different-wall'));
    assert(exterior.depth >= 0.35 && exterior.depth < 0.75);
    counts[exterior.kind] = (counts[exterior.kind] || 0) + 1;
  }
} finally { Math.random = random; }
assert.deepEqual(Object.keys(counts).sort(), Object.keys(EXTERIOR_SCHEMES).sort());
assert(counts.plain >= 400 && counts.plain <= 600, 'plain walls remain a small 5% share');

const parcel = { sourceId: 'community/one', tags: { landuse: 'residential' },
  worldPolygons: [{ outer: [[-100,-100],[100,-100],[100,100],[-100,100]], holes: [] }] };
const buildings = [0, 40].map(x => ({ sourceId: `house/${x}`, centroid: { x, z: 0 }, tags: { building: 'apartments' } }));
const options = { terrain: { heightAt: () => 10 }, seed: 73 };
const planner = createArchitecturePlanner({ ...options, areas: [parcel, ...buildings] });
const reversed = createArchitecturePlanner({ ...options, areas: [...buildings, parcel].reverse() });
const plans = buildings.map(b => planner(b));
assert.equal(plans[0].exteriorKey, plans[1].exteriorKey, 'community identity wins over individual houses');
assert.deepEqual(resolveExteriorScheme(plans[0]), resolveExteriorScheme(plans[1]));
assert.deepEqual(doorFinish(plans[0].exteriorKey, 'residential'), doorFinish(plans[1].exteriorKey, 'residential'));
buildings.forEach((b, i) => assert.deepEqual(plans[i], reversed(b), 'input ordering does not change community styles'));
const sameBuilding = { ...buildings[0], centroid: { x: 300, z: 300 } };
const alone = createArchitecturePlanner(options);
assert.equal(alone(sameBuilding, { outer: [[300,300],[310,300],[310,310],[300,310]] }).exteriorKey,
  alone(sameBuilding, { outer: [[312,300],[322,300],[322,310],[312,310]] }).exteriorKey, 'multiple polygons retain one building vocabulary');

for (const [name, mesh] of Object.entries(EXTERIOR_MESHES)) {
  const edges = new Map(); let volume = 0;
  for (let i = 0; i < mesh.faces.length; i += 3) {
    const ids = mesh.faces.slice(i, i + 3), [a,b,c] = ids.map(v => mesh.vertices.slice(v * 3, v * 3 + 3));
    volume += a[0] * (b[1]*c[2]-b[2]*c[1]) + a[1] * (b[2]*c[0]-b[0]*c[2]) + a[2] * (b[0]*c[1]-b[1]*c[0]);
    for (let j = 0; j < 3; j++) {
      const from = ids[j], to = ids[(j + 1) % 3], key = `${Math.min(from,to)}:${Math.max(from,to)}`;
      const edge = edges.get(key) || { count: 0, winding: 0 };
      edge.count++; edge.winding += from < to ? 1 : -1; edges.set(key, edge);
    }
  }
  assert(volume > 0, name + ': outward-facing mesh');
  assert([...edges.values()].every(edge => edge.count === 2 && edge.winding === 0), name + ': closed manifold');
  assert(mesh.faces.length / 3 <= 48, name + ': bounded authored mesh');
}

const rectangle = [[-12,-8],[12,-8],[12,8],[-12,8]];
const makeEdges = (ring, h) => ring.map((a,i) => {
  const b = ring[(i + 1) % ring.length];
  return { x:(a[0]+b[0])/2, z:(a[1]+b[1])/2, y:0, h, hw2:Math.hypot(b[0]-a[0],b[1]-a[1])/2,
    ry:Math.atan2(b[1]-a[1],b[0]-a[0]), sourceId:'exterior/fixture' };
});
const roles = new Set();
for (const [kind, spec] of Object.entries(EXTERIOR_SCHEMES)) {
  const style = { id:'modern', wall:0xd3c8b7, trim:0x546575, glass:0x68a5c2, roof:0x555e69,
    exteriorKey:'fixture', exterior:{kind, entrance:spec.entrance, depth:0.65, period:1, ornament:'tile'},
    functionInfo:{key:'commercial_office',type:'office',category:'commercial'},
    functionalWindows:{shape:'rect',bayStep:6,storeyH:3.2} };
  for (const ring of [rectangle, [...rectangle].reverse()]) for (const h of [3.2, 12.8, 104]) {
    const hole = [[-4,-3],[4,-3],[4,3],[-4,3]];
    const poly = { outer:ring, holes: h === 12.8 ? [hole] : [] };
    const edges = [...makeEdges(ring,h), ...poly.holes.flatMap(points => makeEdges(points,h))];
    const parts = architecturalFacadeParts(edges, style, 0.28, [], poly);
    assert.deepEqual(parts, architecturalFacadeParts(edges, style, 0.28, [], poly));
    const structural = parts.filter(p => p.exteriorScheme);
    assert(structural.length <= FACADE_GEOMETRY_LIMIT.exterior, 'one bounded supplement across all walls');
    if (kind === 'plain') assert.equal(structural.length, 0);
    else assert(structural.length > 0, `${kind}: detail survives tall/short buildings`);
    for (const part of parts) {
      const geo = architecturePartGeometry(part); geo.computeBoundingBox();
      assert(geo.attributes.position.array.every(Number.isFinite));
      assert(geo.boundingBox.min.y >= -1e-4 && geo.boundingBox.max.y <= h + 1e-4, part.role + ': storey envelope');
      geo.dispose();
    }
    for (const part of structural) {
      roles.add(part.role);
      const edge = edges.find(e => Math.abs((part.p[0]-e.x)*Math.cos(e.ry)+(part.p[2]-e.z)*Math.sin(e.ry)) <= e.hw2
        && Math.abs((part.p[0]-e.x)*-Math.sin(e.ry)+(part.p[2]-e.z)*Math.cos(e.ry)) < 1.5);
      assert(edge);
      const frame = getEdgeFrame(edge,poly), geo = architecturePartGeometry(part);
      geo.translate(-edge.x,0,-edge.z); geo.rotateY(-frame.rotY); geo.computeBoundingBox();
      assert(geo.boundingBox.min.z >= 0.11, part.role + ': outward, never buried in solid walls');
      assert(geo.boundingBox.min.x >= -edge.hw2 - 1e-4 && geo.boundingBox.max.x <= edge.hw2 + 1e-4, 'no corner overhang');
      geo.dispose();
    }
  }
  const entrance = architecturalEntranceParts({x:0,z:0,y:0,h:3.2,hw2:4,ry:0},0,2.4,2.7,style,0.28);
  assert.equal(entrance.length, kind === 'plain' ? 0 : 1);
  for (const part of entrance) {
    roles.add(part.role);
    const geo = architecturePartGeometry(part); geo.computeBoundingBox();
    assert(geo.boundingBox.min.y >= -1e-4 && geo.boundingBox.max.y <= 3.2, 'portal meets the ground and stays below roof');
    geo.dispose();
  }
}
for (const role of ['facade-balcony','facade-bay_windows','facade-recessed_windows','facade-niche',
  'facade-pilaster','facade-eave','entrance-recess','entrance-portal','entrance-canopy']) assert(roles.has(role), role);
assert.deepEqual(architecturalEntranceParts({x:0,z:0,y:0,h:2,hw2:1,ry:0},0,2,2,{},0.28), []);
console.log('PASS: seeded facade distribution, community/multipolygon consistency, closed Blender members, outward orientation, tall-building budgets and fitted entrances.', counts);
