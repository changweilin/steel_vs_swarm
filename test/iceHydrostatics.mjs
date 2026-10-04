import assert from 'node:assert/strict';
import { iceHydrostatics, iceWaterline, floatIceMesh, ICE_DENSITY, SEAWATER_DENSITY } from '../public/js/iceHydrostatics.js';
import { environmentParts, environmentSize, iceFloeParameters, icebergParameters, linearEnvironmentParts, floatingIceClear } from '../public/js/environmentParts.js';
import { partAABB } from '../public/js/vehicles.js';
import { loftMeshData } from '../public/js/vesselGeometry.js';
import { mat3Apply, mat3FromEulerXYZ } from '../public/js/partTransform.js';

const ratio = ICE_DENSITY / SEAWATER_DENSITY;
const near = (a, b, tolerance = 1e-8) => assert(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
function box(w, h, d) {
  const ring = [[-w/2,h/2],[-w/2,-h/2],[w/2,-h/2],[w/2,h/2]];
  return loftMeshData([{z:-d/2,ring},{z:d/2,ring}]);
}
function transform(data, rotation, scale = [1,1,1], position = [0,0,0]) {
  const matrix = mat3FromEulerXYZ(rotation), vertices = [];
  for (let i = 0; i < data.vertices.length; i += 3) {
    vertices.push(...mat3Apply(matrix, data.vertices.slice(i,i+3).map((v,k) => v * scale[k])).map((v,k) => v + position[k]));
  }
  return {...data,vertices};
}
const prism = box(20,2,12), full = iceHydrostatics(prism), half = iceHydrostatics(prism,0);
near(full.volume,480); full.center.forEach(v => near(v,0));
near(half.volume,240); half.center.forEach((v,i) => near(v,i===1?-.5:0));
near(half.waterplane.area,240);
half.waterplane.secondMoments.forEach((v,i) => near(v,[8000,0,2880][i]));
near(iceWaterline(prism).waterline,-1 + 2 * ratio);
const moved = transform(prism,[0,0,0],[1,1,1],[13,7,-21]);
const movedHalf = iceHydrostatics(moved,7);
near(movedHalf.volume,half.volume);
movedHalf.center.forEach((v,i) => near(v,half.center[i]+[13,7,-21][i]));
movedHalf.waterplane.secondMoments.forEach((v,i) => near(v,half.waterplane.secondMoments[i]));
near(iceHydrostatics(prism,-2).volume,0);
near(iceHydrostatics(prism,2).volume,full.volume);
const flat = floatIceMesh(prism);
near(flat.metacentricHeight,12**2/(12*ratio*2) - (1-ratio));
const tall = floatIceMesh(box(2,20,2));
const heights = tall.vertices.filter((_,i) => i%3===1);
near(Math.max(...heights)-Math.min(...heights),2,1e-5);
assert(tall.metacentricHeight > 0, 'elongated ice lies on its side in a stable pose');
const oblique = floatIceMesh(transform(box(30,16,8),[0,Math.PI/4,0]));
assert(oblique.metacentricHeight > 0, 'an oblique unstable roll mode settles without randomness');
for (const badRatio of [0,1,-.1,NaN,Infinity]) assert.throws(() => iceWaterline(prism,badRatio),RangeError);
assert.throws(() => floatIceMesh({vertices:[],faces:[]}),RangeError);

function checkEquilibrium(data, waterline, perturb = false) {
  const full = iceHydrostatics(data), wet = iceHydrostatics(data,waterline);
  near(wet.volume / full.volume,ratio,2e-9);
  const span = Math.cbrt(full.volume);
  near(wet.center[0],full.center[0],span*2e-7);
  near(wet.center[2],full.center[2],span*2e-7);
  const [xx,xz,zz] = wet.waterplane.secondMoments, dy = wet.center[1]-full.center[1];
  const a = zz/wet.volume+dy, c = xx/wet.volume+dy;
  const minimum = (a+c-Math.hypot(a-c,2*xz/wet.volume))/2;
  assert(minimum > 0, 'both roll and pitch have restoring stiffness');
  if (!perturb) return;
  const energy = full.center[1]-wet.center[1];
  for (const rotation of [[.001,0,0],[-.001,0,0],[0,0,.001],[0,0,-.001]]) {
    const tilted = iceWaterline(transform(data,rotation));
    assert(tilted.full.center[1]-tilted.submerged.center[1] > energy, 'small tilts increase ice/water potential energy');
  }
}
let samples = 0;
for (const kind of ['icefloe','iceberg']) for (let seed = 0; seed < 80; seed++) {
  const sizes = [environmentSize(kind,seed),[12,30,18],[48,30,18]];
  for (const size of sizes) for (const yaw of [true,false]) {
    const options = {size,seed,yaw}, [part] = environmentParts(kind,options);
    checkEquilibrium(transform(part.g[1],part.r,part.s,part.p),part.waterline,seed===42);
    assert.deepEqual(environmentParts(kind,options),[part], 'deterministic equilibrium');
    samples++;
  }
}
for (let seed = 0; seed < 20; seed++) {
  for (const part of linearEnvironmentParts('seaice',{len:48,depth:18,h:8,seed})) {
    checkEquilibrium(transform(part.g[1],part.r,part.s,part.p),part.waterline);
    samples++;
  }
}
const shapes = new Map(), lengths = [], thicknesses = [], proportions = new Set();
for (let seed = 0; seed < 256; seed++) {
  const parameters = iceFloeParameters(seed), size = environmentSize('icefloe',seed);
  assert.deepEqual(parameters,iceFloeParameters(seed), 'floe shape parameters are repeatable');
  const [part] = environmentParts('icefloe',{size,seed,yaw:false}), bounds = partAABB(part);
  const w = bounds.x1-bounds.x0, h = bounds.y1-bounds.y0, d = bounds.z1-bounds.z0;
  lengths.push(Math.max(w,d)); thicknesses.push(h);
  proportions.add((size[0]/size[2]).toFixed(3)+':'+(size[1]/size[0]).toFixed(3));
  const vertices = part.g[1].vertices, n = (part.g[1].baseVertexCount-2)/3;
  const outline = Array.from({length:n},(_,i)=>[vertices[(n+i)*3],vertices[(n+i)*3+2]]);
  const concave = outline.some((a,i) => {
    const b = outline[(i+1)%n], c = outline[(i+2)%n];
    return (b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]) < 0;
  });
  const group = shapes.get(parameters.shape) || { count:0, concave:false, aspect:0 };
  group.count++; group.concave ||= concave; group.aspect = Math.max(group.aspect,w/d);
  shapes.set(parameters.shape,group);
  checkEquilibrium(transform(part.g[1],part.r,part.s,part.p),part.waterline);
  samples++;
}
assert.deepEqual([...shapes.keys()].sort(),['angular','elongated','jagged','lobed','notched','rounded']);
assert([...shapes.values()].every(group=>group.count>=20), 'shape families occur across seeds');
for (const shape of ['notched','jagged','lobed']) assert(shapes.get(shape).concave, `${shape} creates actual concave silhouettes`);
assert(shapes.get('elongated').aspect>4, 'elongated floes have distinct plan proportions');
assert(Math.max(...lengths)/Math.min(...lengths)>5, 'deployed floes span small and large fragments');
assert(Math.max(...thicknesses)/Math.min(...thicknesses)>8, 'thickness varies independently of footprint');
assert(proportions.size>240, 'floe sizes vary beyond uniform scaling');
for (const badSeed of [NaN,Infinity,1.5]) assert.throws(()=>iceFloeParameters(badSeed),RangeError);
const bergShapes = new Map(), bergLengths = [], bergHeights = [], bergProportions = new Set();
for (let seed = 0; seed < 256; seed++) {
  const parameters = icebergParameters(seed), size = environmentSize('iceberg',seed);
  assert.deepEqual(parameters,icebergParameters(seed), 'iceberg parameters are repeatable');
  const [part] = environmentParts('iceberg',{size,seed,yaw:false}), bounds = partAABB(part);
  const w = bounds.x1-bounds.x0, h = bounds.y1-bounds.y0, d = bounds.z1-bounds.z0;
  bergLengths.push(Math.max(w,d)); bergHeights.push(h);
  bergProportions.add((size[0]/size[2]).toFixed(3)+':'+(size[1]/size[0]).toFixed(3));
  assert(bounds.y0<part.waterline && bounds.y1>part.waterline, 'icebergs straddle sea level');
  const n = (part.g[1].baseVertexCount-2)/3, vertices = part.g[1].vertices;
  const crestY = i => vertices[(2*n+(i+n)%n)*3+1]*part.s[1]+part.p[1];
  let exposedPeaks = 0;
  for (let i = 0; i < n; i++) {
    if (crestY(i)>part.waterline && crestY(i)-Math.max(crestY(i-1),crestY(i+1))>h*.025) exposedPeaks++;
  }
  const group = bergShapes.get(parameters.shape) || { count:0, aspect:0, exposedPeaks:0 };
  group.count++; group.aspect = Math.max(group.aspect,Math.max(w,d)/Math.min(w,d));
  group.exposedPeaks = Math.max(group.exposedPeaks,exposedPeaks); bergShapes.set(parameters.shape,group);
  checkEquilibrium(transform(part.g[1],part.r,part.s,part.p),part.waterline,seed<7);
  samples++;
}
assert.deepEqual([...bergShapes.keys()].sort(),['dome','fractured','multipeak','pinnacle','ridge','tabular','wedge']);
assert([...bergShapes.values()].every(group=>group.count>=20), 'iceberg families occur across seeds');
assert(bergShapes.get('multipeak').exposedPeaks>=2, 'multiple distinct peaks emerge above the resolved waterline');
assert(bergShapes.get('ridge').aspect>4, 'ridge icebergs retain an elongated footprint after settling');
assert(Math.max(...bergLengths)/Math.min(...bergLengths)>5, 'icebergs span small and large masses');
assert(Math.max(...bergHeights)/Math.min(...bergHeights)>10, 'iceberg heights vary beyond uniform scaling');
assert(bergProportions.size>240, 'iceberg dimensions vary independently');
for (const badSeed of [NaN,Infinity,1.5]) assert.throws(()=>icebergParameters(badSeed),RangeError);
const [ice] = environmentParts('iceberg',{seed:42});
assert(floatingIceClear(ice,{waterY:0,bedAt:()=>-100}));
assert(!floatingIceClear(ice,{waterY:0,bedAt:()=>-ice.waterline+.1}), 'ice never intersects the seabed');
assert(!floatingIceClear(ice,{waterY:0,bedAt:()=>NaN}), 'unknown depth omits ice');
assert(!floatingIceClear(ice,{waterY:NaN,bedAt:()=>-100}), 'unknown sea level omits ice');
assert(!floatingIceClear(ice,{waterY:0,bedAt:()=>-100,waterAt:()=>false}), 'coastline inside footprint omits ice');
for (const yaw of [0,Math.PI/2]) {
  assert(!floatingIceClear(ice,{x:50,z:80,yaw,waterY:0,
    bedAt:(x,z)=>Math.hypot(x-50,z-80)<1?.1:-100}), 'interior shoals rotate with the footprint');
}
console.log(`Ice hydrostatics: analytical volumes, six floe and seven iceberg families, stable poses, ${samples} deployed scene/boundary equilibria passed.`);
