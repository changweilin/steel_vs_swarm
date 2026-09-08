import assert from 'node:assert/strict';
import { GEOLOGY_TYPES, generateGeology, geologyDistribution, geologyBackgroundObject } from '../public/js/geology.js';
import { generateSharedBackgroundObject, sharedBackgroundObjectTargets } from '../public/js/backgroundObjects.js';
import { ANCIENT_MONUMENTS, ANCIENT_RUINS, ancientCandidates, selectAncientStone, ancientStoneGeometry } from '../public/js/ancientStone.js';

let count = 0;
for (const type of Object.keys(GEOLOGY_TYPES)) {
  for (const seed of [0, 1, -12, 4294967295]) {
    const input = { climate: 'temperate', moisture: .95, vegetation: .9, conifers: .6 };
    const a = geologyBackgroundObject(type, seed, input), b = geologyBackgroundObject(type, seed, input);
    assert.deepEqual(a, b);
    const { vertices, faces, colors } = a.meshData;
    assert(vertices.length > 0 && vertices.every(Number.isFinite));
    assert.equal(colors.length, vertices.length);
    assert(colors.every(x => x >= 0 && x <= 1));
    assert(faces.every(x => Number.isInteger(x) && x >= 0 && x < vertices.length / 3));
    for (let k = 0; k < vertices.length; k++) assert(vertices[k] >= a.bounds.min[k % 3] && vertices[k] <= a.bounds.max[k % 3]);
    for (const row of a.generation.surfaceTriangles) {
      assert(row.up >= -1.000001 && row.up <= 1.000001);
      if(type !== 'masonry') assert(row.up > 0);
      if (['cones', 'wood', 'leaves', 'grass', 'snow', 'gravel'].includes(row.surface)) assert(row.up > .82);
      if (row.surface === 'water') assert(row.up >= .995);
    }
    const bare = generateGeology(type, seed, { ...input, vegetation: 0 });
    assert.deepEqual(bare.parameters, a.generation.parameters);
    assert(bare.surfaces.filter(x => ['wood', 'leaves', 'cones', 'grass'].includes(x.kind)).every(x => x.coverage === 0));
    for (const key of type === 'masonry' ? [] : ['width', 'height', 'ageMa', 'roughness']) {
      assert(a.generation.parameters[key] >= GEOLOGY_TYPES[type][key][0]);
      assert(a.generation.parameters[key] <= GEOLOGY_TYPES[type][key][1]);
    }
    count++;
  }
  const key = `geology/${type}`;
  assert(sharedBackgroundObjectTargets('geology').includes(key));
  assert.equal(generateSharedBackgroundObject(key, 1).generation.type, type);
}
for (const input of [{}, { water: 'sea', temperature: 25, depth: 12 }, { climate: 'alpine' }]) {
  assert(Math.abs(geologyDistribution(input).reduce((a, b) => a + b.weight, 0) - 1) < 1e-12);
}
for (const input of [{ water: 'lake', temperature: 25 }, { water: 'sea', temperature: 2 }, { water: 'sea', temperature: 25, depth: 100 }]) {
  assert(!geologyDistribution(input).some(x => x.type === 'reef'));
}
assert(geologyDistribution({ water: 'sea', temperature: 25, depth: 12 }).some(x => x.type === 'reef'));
const dryDune = generateGeology('dune', 42, { climate: 'arid', moisture: .1, vegetation: 0 });
assert(dryDune.surfaces.filter(x => ['mud', 'moss', 'lichen', 'water'].includes(x.kind)).every(x => x.coverage === 0));
assert.throws(() => generateGeology('missing'), RangeError);
assert.throws(() => generateGeology('granite', NaN), TypeError);
assert.throws(() => generateGeology('granite', 1, { water: 'bad' }), RangeError);

const dryStone = { moisture: 0, vegetation: 0, exposure: 0, wind: 0, temperature: 15 };
for(const [id,spec] of Object.entries(ANCIENT_MONUMENTS)) {
  assert.deepEqual(ancientCandidates({region:spec.region}),[id]);
  assert(ancientCandidates({latitude:spec.location[0],longitude:spec.location[1]}).includes(id));
  assert.deepEqual(ancientCandidates({region:'unmatched',latitude:spec.location[0],longitude:spec.location[1]}),[]);
  const input={...dryStone,region:spec.region};
  const a=geologyBackgroundObject('masonry',42,{...input,uniformScale:.5});
  const b=geologyBackgroundObject('masonry',42,{...input,uniformScale:1.5});
  assert.equal(a.generation.stone.id,id);
  assert.equal(a.scalePolicy,'uniform');
  assert.equal(a.meshData.vertices.length,b.meshData.vertices.length);
  // Every vertex, including architecture openings, uses the same multiplier on all three axes.
  for(let i=0;i<a.meshData.vertices.length;i++) assert(Math.abs(a.meshData.vertices[i]*3-b.meshData.vertices[i])<1e-8,id);
  const canonical=ancientStoneGeometry(selectAncientStone(1,input),1);
  assert.deepEqual(canonical,ancientStoneGeometry(selectAncientStone(999,input),999),`${id} must not randomize its proportions`);
  assert(a.meshData.vertices.every(Number.isFinite));
  assert(a.generation.surfaceTriangles.every(row=>Number.isFinite(row.up)));
  const wetA=geologyBackgroundObject('masonry',42,{region:spec.region,uniformScale:.5,moisture:.95,vegetation:.8});
  const wetB=geologyBackgroundObject('masonry',42,{region:spec.region,uniformScale:1.5,moisture:.95,vegetation:.8});
  assert.equal(wetA.meshData.vertices.length,wetB.meshData.vertices.length,'Surface details must scale with architecture');
  wetA.meshData.vertices.forEach((v,i)=>assert(Math.abs(v*3-wetB.meshData.vertices[i])<1e-8));
}
const seen=new Set();
for(let seed=0;seed<120;seed++) {
  const input={...dryStone,region:'unmatched'};
  const selection=selectAncientStone(seed,input);
  seen.add(selection.id);assert(selection.fallback);assert(Object.hasOwn(ANCIENT_RUINS,selection.id));
  const a=geologyBackgroundObject('masonry',seed,{...input,uniformScale:1});
  const b=geologyBackgroundObject('masonry',seed,{...input,uniformScale:2});
  assert.equal(a.meshData.vertices.length,b.meshData.vertices.length);
  a.meshData.vertices.forEach((v,i)=>assert(Math.abs(v*2-b.meshData.vertices[i])<1e-8));
}
assert.equal(seen.size,Object.keys(ANCIENT_RUINS).length);
assert.deepEqual(ancientCandidates({latitude:29.98}),[],'Latitude alone cannot select Egypt');
assert.deepEqual(ancientCandidates({latitude:-33.45,longitude:-70.67}),[],'Mainland Chile must not select moai');
for(const uniformScale of [0,.001,-1,NaN,Infinity,11,[1,2,1]]) assert.throws(()=>selectAncientStone(1,{uniformScale}),RangeError);
assert.throws(()=>selectAncientStone(1,{scale:[1,2,1]}),TypeError);
console.log(`Geology: ${count} deterministic meshes; 9 regional monuments, 9 ruin fallbacks, uniform scaling and input guards passed.`);
