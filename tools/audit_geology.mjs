import assert from 'node:assert/strict';
import { GEOLOGY_TYPES, generateGeology, geologyDistribution, geologyBackgroundObject } from '../public/js/geology.js';
import { generateSharedBackgroundObject, sharedBackgroundObjectTargets } from '../public/js/backgroundObjects.js';
import { ANCIENT_MONUMENTS, ANCIENT_RUINS, ancientCandidates, ancientStoneDistribution, selectAncientStone, ancientStoneGeometry } from '../public/js/ancientStone.js';
import { REGIONAL_STONE_BUILDERS } from '../public/js/ancientStoneSites.js';
import { PHENOMENA, phenomenaProfile, phenomenaSurface } from '../public/js/geologyPhenomena.js';

let count = 0;
for (const type of Object.keys(GEOLOGY_TYPES)) {
  for (const seed of [0, 1, -12, 4294967295]) {
    const input = { region: 'egypt', climate: 'temperate', moisture: .95, vegetation: .9, conifers: .6 };
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
      if(GEOLOGY_TYPES[type].lithology !== 'manufactured') assert(row.up > 0);
      if (['cones', 'wood', 'leaves', 'grass', 'snow', 'gravel'].includes(row.surface)) assert(row.up > .82);
      if (row.surface === 'water') assert(row.up >= .995);
    }
    const bare = generateGeology(type, seed, { ...input, vegetation: 0 });
    assert.deepEqual(bare.parameters, a.generation.parameters);
    assert(bare.surfaces.filter(x => ['wood', 'leaves', 'cones', 'grass'].includes(x.kind)).every(x => x.coverage === 0));
    for (const key of GEOLOGY_TYPES[type].lithology === 'manufactured' ? [] : ['width', 'height', 'ageMa', 'roughness']) {
      assert(a.generation.parameters[key] >= GEOLOGY_TYPES[type][key][0]);
      assert(a.generation.parameters[key] <= GEOLOGY_TYPES[type][key][1]);
    }
    count++;
  }
  const key = `geology/${type}`;
  assert(sharedBackgroundObjectTargets('geology').includes(key));
  assert.equal(generateSharedBackgroundObject(key, 1, {region:'egypt'}).generation.type, type);
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

// Habitat eligibility is independent of explicitly choosing an art archetype.
const probability=(input,type)=>geologyDistribution(input).find(row=>row.type===type)?.weight||0;
assert.equal(probability({slope:0,rainfall:1,instability:1},'debris_flow'),0);
assert(probability({slope:40,rainfall:1,sediment:1},'debris_flow')>0);
assert.equal(probability({slope:40,rainfall:1,water:'none'},'landslide_lake'),0);
assert(probability({slope:40,rainfall:1,water:'river'},'landslide_lake')>0);
assert.equal(probability({volcanic:1,geothermal:0},'hot_spring'),0);
assert(probability({gasPressure:1,sediment:1,volcanic:0},'mud_volcano')>0);
assert.equal(probability({geothermal:1,springPressure:0},'geyser'),0);
assert.equal(probability({volcanic:1,activity:0},'eruption'),0);
for(const type of Object.keys(PHENOMENA)) assert.equal(probability({depth:10,geothermal:1,impact:1,gasPressure:1},type),0);
const eventSignatures=new Set();
for(const type of Object.keys(PHENOMENA)) {
  const entry=geologyBackgroundObject(type,42,{activity:1,vegetation:1,moisture:1});
  const p=entry.generation.parameters;
  assert(entry.meshData.faces.length/3<5000);
  const signature=JSON.stringify(entry.meshData.vertices);
  assert(!eventSignatures.has(signature),`${type}: distinct event silhouette`);eventSignatures.add(signature);
  for(const effect of entry.generation.effects) {
    assert([effect.x,effect.y,effect.z,effect.height,effect.radius].every(Number.isFinite));
    assert(effect.height>0 && effect.radius>0);
    assert(effect.y>=entry.bounds.min[1] && effect.y+effect.height<=entry.bounds.max[1]+1e-8);
  }
  assert.equal(geologyBackgroundObject(type,42,{activity:0}).generation.effects.length,0);
  for(const row of entry.generation.surfaceTriangles) {
    const [x,,z]=row.center,cos=Math.cos(p.strike),sin=Math.sin(p.strike);
    const feature=phenomenaSurface(type,(x*cos+z*sin)*2/p.width,(-x*sin+z*cos)*2/(p.width*p.depthRatio),p);
    if(feature) assert(!['grass','wood','leaves','cones','moss','lichen'].includes(row.surface));
  }
  if(['landslide_lake','hot_spring','fountain','geyser'].includes(type)) {
    const water=entry.generation.surfaceTriangles.filter(row=>row.surface==='water');
    assert(water.length>0,`${type}: water is visible`);
    assert(water.every(row=>row.up>=.995));
  }
  if(type==='impact_crater') assert(phenomenaProfile(type,.62,0,p)>phenomenaProfile(type,0,0,p));
}
assert(!geologyBackgroundObject('eruption',42,{activity:0}).generation.surfaceCounts.lava);

const dryStone = { moisture: 0, vegetation: 0, exposure: 0, wind: 0, temperature: 15 };
assert.equal(Object.keys(REGIONAL_STONE_BUILDERS).length,17);
for(const id of Object.keys(REGIONAL_STONE_BUILDERS)) assert(Object.hasOwn(ANCIENT_MONUMENTS,id));
const signatures=new Set();
for(const [id,spec] of Object.entries(ANCIENT_MONUMENTS)) {
  assert.deepEqual(ancientCandidates({region:spec.region}),[id]);
  assert(ancientCandidates({latitude:spec.location[0],longitude:spec.location[1]}).includes(id));
  assert.deepEqual(ancientCandidates({region:'unmatched',latitude:spec.location[0],longitude:spec.location[1]}),[]);
  const input={...dryStone,region:spec.region};
  const a=geologyBackgroundObject('monument',42,{...input,uniformScale:.5});
  const b=geologyBackgroundObject('monument',42,{...input,uniformScale:1.5});
  assert.equal(a.generation.stone.id,id);
  assert.equal(a.scalePolicy,'uniform');
  assert.equal(a.meshData.vertices.length,b.meshData.vertices.length);
  // Every vertex, including architecture openings, uses the same multiplier on all three axes.
  for(let i=0;i<a.meshData.vertices.length;i++) assert(Math.abs(a.meshData.vertices[i]*3-b.meshData.vertices[i])<1e-8,id);
  const canonical=ancientStoneGeometry(selectAncientStone(1,input,'monument'),1);
  assert(canonical.triangles.length>0);
  assert(canonical.bounds.size.every(v=>Number.isFinite(v)&&v>0));
  const signature=JSON.stringify(canonical);
  assert(!signatures.has(signature),`${id} must have its own silhouette`);signatures.add(signature);
  assert(a.meshData.faces.length/3<60000,`${id} exceeds the preview geometry budget`);
  assert.deepEqual(canonical,ancientStoneGeometry(selectAncientStone(999,input,'monument'),999),`${id} must not randomize its proportions`);
  assert(a.meshData.vertices.every(Number.isFinite));
  assert(a.generation.surfaceTriangles.every(row=>Number.isFinite(row.up)));
  const wetA=geologyBackgroundObject('monument',42,{region:spec.region,uniformScale:.5,moisture:.95,vegetation:.8});
  const wetB=geologyBackgroundObject('monument',42,{region:spec.region,uniformScale:1.5,moisture:.95,vegetation:.8});
  assert.equal(wetA.meshData.vertices.length,wetB.meshData.vertices.length,'Surface details must scale with architecture');
  wetA.meshData.vertices.forEach((v,i)=>assert(Math.abs(v*3-wetB.meshData.vertices[i])<1e-8));
}
for(const ruinType of Object.keys(ANCIENT_RUINS)) {
  const seed=42,input={...dryStone,region:'unmatched',ruinType};
  const selection=selectAncientStone(seed,input,'ruins');
  assert.equal(selection.id,ruinType);assert(selection.fallback);assert(selection.activity);
  const a=geologyBackgroundObject('ruins',seed,{...input,uniformScale:1});
  const b=geologyBackgroundObject('ruins',seed,{...input,uniformScale:2});
  assert.deepEqual(a,geologyBackgroundObject('ruins',seed,{...input,uniformScale:1}));
  assert(a.meshData.vertices.every(Number.isFinite));
  assert.equal(a.meshData.vertices.length,b.meshData.vertices.length);
  a.meshData.vertices.forEach((v,i)=>assert(Math.abs(v*2-b.meshData.vertices[i])<1e-8));
}
assert.deepEqual(ancientStoneDistribution({region:'egypt'}),[{type:'monument',weight:.5},{type:'ruins',weight:.5}]);
assert.deepEqual(ancientStoneDistribution({region:'unmatched'}),[{type:'ruins',weight:1}]);
const matched=geologyDistribution({human:1,region:'egypt'}),unmatched=geologyDistribution({human:1,region:'unmatched'});
const weight=(rows,type)=>rows.find(row=>row.type===type)?.weight||0;
assert.equal(weight(matched,'monument'),weight(matched,'ruins'));
assert.equal(weight(unmatched,'monument'),0);
assert(Math.abs(weight(unmatched,'ruins')-weight(matched,'ruins')*2)<1e-12);
const seen=new Set();let monuments=0;
for(let seed=0;seed<2048;seed++) {
  const selection=selectAncientStone(seed,{region:'egypt'});
  if(selection.kind==='monument') monuments++;else seen.add(selection.id);
  assert.equal(selection.fallback,false);
  assert.equal(selectAncientStone(seed,{region:'unmatched'}).kind,'ruins');
  assert.equal(generateGeology('masonry',seed,{region:'egypt'}).type,selection.kind);
  assert.equal(selectAncientStone(seed,{region:'egypt'},'ruins').kind,'ruins');
}
assert(monuments>2048*.45 && monuments<2048*.55);
assert.equal(seen.size,Object.keys(ANCIENT_RUINS).length);
assert.equal(generateGeology('monument',42,{region:'unmatched'}).type,'ruins');
assert(!sharedBackgroundObjectTargets('geology').includes('geology/masonry'));
assert.throws(()=>selectAncientStone(1,{ruinType:'invalid'},'ruins'),RangeError);
assert.deepEqual(ancientCandidates({latitude:29.98}),[],'Latitude alone cannot select Egypt');
assert.deepEqual(ancientCandidates({latitude:-33.45,longitude:-70.67}),[],'Mainland Chile must not select moai');
for(const uniformScale of [0,.001,-1,NaN,Infinity,11,[1,2,1]]) assert.throws(()=>selectAncientStone(1,{uniformScale}),RangeError);
assert.throws(()=>selectAncientStone(1,{scale:[1,2,1]}),TypeError);
console.log(`Geology: ${count} deterministic meshes; ${Object.keys(ANCIENT_MONUMENTS).length} regional monuments, ${Object.keys(ANCIENT_RUINS).length} activity ruins, 50/50 selection, uniform scaling and input guards passed.`);
