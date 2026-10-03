import assert from 'node:assert/strict';
import { WALL_KINDS, BOUNDARY_BUFFER_LAYOUTS, buildBoundaryRunParts, boundaryFillCrest, partBox } from '../public/js/edgewall.js';

const natural = Object.keys(BOUNDARY_BUFFER_LAYOUTS).filter(k => BOUNDARY_BUFFER_LAYOUTS[k].continuousGeology);
const terrains = [() => 4, (x,z) => 4 + x * .3 + z * .2];
const joint = (kind, corner = false) => ({ kind, h: WALL_KINDS[kind].h, depth: WALL_KINDS[kind].depth, corner });
const round = n => Math.round(n * 1e5) / 1e5;
const unique = rows => [...new Set(rows.map(p => JSON.stringify(p.map(round))))].sort();
function make(kind, fx, fz, ry, heightAt, joins, seed = 42, season = 'summer') {
  const def = WALL_KINDS[kind], ca = Math.round(Math.cos(ry)), sa = Math.round(Math.sin(ry));
  const input = { len: 24, depth: def.depth, bufferDepth: 64 - def.depth, h: def.h,
    x: fx - sa * def.depth / 2, z: fz - ca * def.depth / 2, ry,
    heightAt, bufferHeightAt: heightAt, joins, seed, season, crest: boundaryFillCrest(),
    environment: { latitude: 60, weather: season === 'winter' ? 'snow' : 'clear' } };
  return { input, result: buildBoundaryRunParts(kind, input) };
}
function surface({ input, result }) {
  assert(result.terrainJoined, 'exercise the deployed geology entry');
  const ca = Math.round(Math.cos(input.ry)), sa = Math.round(Math.sin(input.ry));
  return [...result.parts, ...result.bufferParts].flatMap(p => {
    const mesh = p.g[1];
    assert(mesh.vertices.every(Number.isFinite));
    assert(mesh.faces.every(i => Number.isInteger(i) && i >= 0 && i < mesh.vertices.length / 3));
    assert.equal(mesh.colors.length, mesh.vertices.length);
    const rows = [];
    for (let i = 0; i < mesh.surfaceVertexCount * 3; i += 3) {
      const [u,y,v] = mesh.vertices.slice(i,i+3).map((n,a) => n + p.p[a]);
      rows.push([input.x + ca*u + sa*v, y, input.z - sa*u + ca*v, ...mesh.colors.slice(i,i+3)]);
    }
    return rows;
  });
}
let seams = 0;
const random = Math.random;
try {
  Math.random = () => { throw new Error('Boundary joins consumed shared randomness'); };
  for (const heightAt of terrains) for (const a of natural) for (const b of natural) {
    for (const ry of [0, Math.PI/2, Math.PI, -Math.PI/2]) {
      const ca = Math.round(Math.cos(ry)), sa = Math.round(Math.sin(ry));
      const left = make(a,-12*ca,12*sa,ry,heightAt,[null,joint(b)],101,'winter');
      const right = make(b,12*ca,-12*sa,ry,heightAt,[joint(a),null],202,'winter');
      const end = item => unique(surface(item).filter(([x,,z]) => Math.abs(ca*x-sa*z) < 1e-5));
      assert(end(left).length > 25);
      assert.deepEqual(end(left),end(right), `${a}/${b}: unequal seeds, depths and heights at ${ry}`);
      const north = make(a,12*ca,-12*sa,ry,heightAt,[joint(b,true),null],303,'winter');
      const west = make(b,12*sa,12*ca,ry+Math.PI/2,heightAt,[null,joint(a,true)],404,'winter');
      const diagonal = item => unique(surface(item).filter(([x,,z]) => {
        const u=ca*x-sa*z,v=sa*x+ca*z;
        return u<=0 && Math.abs(u-v)<1e-5;
      }));
      assert(diagonal(north).length > 25);
      assert.deepEqual(diagonal(north),diagonal(west), `${a}/${b}: deployed corner ${ry}`);
      seams += 2;
    }
  }
  for (const kind of natural) {
    const item = make(kind,0,0,0,terrains[1],[joint('solarfield'),null]);
    const end = surface(item).filter(([x]) => Math.abs(x+12)<1e-5);
    assert(end.length > 25);
    assert(end.every(([x,y,z]) => Math.abs(y-(terrains[1](x,z)-.4))<1e-5), kind+': taper to discrete array');
    assert.deepEqual(item.result,buildBoundaryRunParts(kind,item.input));
    assert.notDeepEqual(item.result,buildBoundaryRunParts(kind,{...item.input,seed:43}),kind+': retain seeded interior relief');
    const invalid = buildBoundaryRunParts(kind,{...item.input,bufferHeightAt:()=>NaN});
    assert.equal(invalid.parts.length+invalid.bufferParts.length,0,kind+': omit failed terrain samples');
    const floor = 3.3, flat = make(kind,0,0,0,terrains[0],[joint(kind),joint(kind)]);
    const clipped = buildBoundaryRunParts(kind,{...flat.input,floorY:floor});
    assert(clipped.parts.every(p=>partBox(p).y0>=floor-1e-6),kind+': buried toes stay in the fixed ring');
    assert.deepEqual(clipped.bufferParts,flat.result.bufferParts,kind+': ring floor leaves the skirt unchanged');
  }
  const arrays = ['solarfield','windland','gianttree','skyfall','iceberg'];
  let layouts=0,extended=0;
  for (const kind of arrays) for (const other of ['citywall','levee','cliff','tetrapod',...arrays]) for (const corner of [false,true]) {
    const def=WALL_KINDS[kind], joins=[joint(other,corner),joint(other,corner)];
    const input={len:120,depth:def.depth,bufferDepth:64,h:def.h,joins,seed:777};
    const result=buildBoundaryRunParts(kind,input);
    assert.deepEqual(result,buildBoundaryRunParts(kind,input));
    assert(result.parts.length>0,kind+': retain complete boundary units');
    for (const part of [...result.parts,...result.bufferParts]) {
      if(part.boundaryUnit==null) continue;
      const b=partBox(part),buffer=!!part.boundaryBuffer;
      assert(b.z1<=(buffer?-def.depth/2:def.depth/2)+.35+1e-6);
      assert(b.z0>=-def.depth/2-(buffer?64:0)-.35-1e-6);
      const limit=60+(buffer&&corner?def.depth/2-b.z1:0);
      assert(b.x1<=limit+1e-6 && -b.x0<=limit+1e-6,kind+': whole units respect the shared corner diagonal');
      if(buffer&&(b.x0< -60 || b.x1>60)) extended++;
    }
    if(BOUNDARY_BUFFER_LAYOUTS[kind].type==='artificial' && !BOUNDARY_BUFFER_LAYOUTS[kind].ruined && kind!==other)
      assert(result.parts.some(p=>p.role==='boundary-frame'),kind+': deliberate array termination');
    layouts++;
  }
  assert(extended>0,'arrays fill their half of an outward corner');
  for(const kind of Object.keys(BOUNDARY_BUFFER_LAYOUTS).filter(k=>!natural.includes(k)))
    for(const len of [24,120]) for(const other of ['solarfield','cliff']) {
      const def=WALL_KINDS[kind],joins=[joint(other,true),joint(other,true)];
      const result=buildBoundaryRunParts(kind,{len,depth:def.depth,bufferDepth:64,h:def.h,joins,seed:42});
      for(const part of [...result.parts,...result.bufferParts]) {
        const b=partBox(part);
        assert(Object.values(b).every(Number.isFinite),kind+': finite short/long joint geometry');
        if(part.boundaryUnit==null) continue;
        const buffer=!!part.boundaryBuffer,limit=len/2+(buffer?def.depth/2-b.z1:0);
        assert(b.x1<=limit+1e-6&&-b.x0<=limit+1e-6,kind+': complete units stay in their joint region');
      }
      layouts++;
    }
  for(const kind of ['seawall','canalbank','barricade']) {
    const def=WALL_KINDS[kind];
    const result=buildBoundaryRunParts(kind,{len:24,depth:def.depth,h:def.h,joins:[joint('solarfield'),joint('tetrapod',true)]});
    assert.equal(result.parts.filter(p=>p.role==='boundary-abutment').length,2);
  }
  assert.throws(()=>buildBoundaryRunParts('cliff',{len:24,depth:18,h:30,joins:[joint('cliff')]}),TypeError);
  assert.throws(()=>buildBoundaryRunParts('cliff',{len:24,depth:18,h:30,joins:[{kind:'missing'},null]}),RangeError);
  console.log(`Boundary joins: ${seams} deployed natural seams/corners and ${layouts} layout combinations passed.`);
} finally { Math.random=random; }
