import assert from 'node:assert/strict';
import { BOUNDARY_SURFACES } from '../public/js/boundaryMeshData.js';
import { boundaryRockHeight } from '../public/js/boundaryAppearance.js';
import { wallParts, wallFit, WALL_KINDS, buildBoundaryRunParts } from '../public/js/edgewall.js';
import { buildSlopeBoundary } from '../public/js/edgeSlope.js';
import { elongatedGeologyMesh } from '../public/js/geology.js';
import { mat3Apply, mat3FromEulerXYZ } from '../public/js/partTransform.js';

const kinds = ['citywall','levee','seawall','canalbank','barricade','tetrapod','wetpods','cliff','landslide','debris','viaduct'];
const budget = kind => ['tetrapod','wetpods'].includes(kind) ? 15000 : 8000;
function verify(parts, kind) {
  let triangles = 0;
  for (const {g} of parts) {
    if (g[0] !== 'mesh') continue;
    const data = g[1];
    assert(data.vertices.every(Number.isFinite), kind);
    assert(data.faces.every(i=>Number.isInteger(i) && i>=0 && i<data.vertices.length/3), kind);
    assert.equal(data.colors.length, data.vertices.length);
    assert(data.colors.every(n=>Number.isFinite(n) && n>=0 && n<=1), kind);
    for (let i=0;i<data.vertices.length;i++) assert(Math.abs(data.vertices[i])<=g[2][i%3]/2+1e-6,
      kind+': authored surface stays inside its descriptor');
    if (data.normals) for (let i=0;i<data.normals.length;i+=3)
      assert(Math.abs(Math.hypot(...data.normals.slice(i,i+3))-1)<1e-9);
    triangles += data.faces.length/3;
  }
  assert(triangles>0 && triangles<=budget(kind), kind+': triangle budget '+triangles);
  return triangles;
}
for (const [name,data] of Object.entries(BOUNDARY_SURFACES.meshes)) {
  assert(data.faces.length/3<=80, name+': local surface budget');
  for(let i=0;i<data.faces.length;i+=3) {
    const [a,b,c]=data.faces.slice(i,i+3).map(index=>data.vertices.slice(index*3,index*3+3));
    const ab=b.map((n,k)=>n-a[k]),ac=c.map((n,k)=>n-a[k]);
    assert(Math.hypot(ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0])>1e-10, name);
  }
}
const report={};
for(const kind of kinds) for(const seed of [0,1,42,983]) {
  const def=WALL_KINDS[kind], input={len:30,depth:def.depth,h:def.h,seed};
  const parts=wallParts(kind,input);
  assert.deepEqual(parts,wallParts(kind,input));
  assert(wallFit(parts,30,def.depth,def.h).fit, kind+': collision envelope');
  report[kind]=Math.max(report[kind]||0,verify(parts,kind));
  if(['citywall','levee','seawall','canalbank','barricade'].includes(kind)) {
    const terrain=(x,z)=>x*.3+z*.1;
    const joined=buildSlopeBoundary(kind,{...input,x:10,z:20,heightAt:terrain});
    verify(joined.parts,kind);
    assert.deepEqual(joined,buildSlopeBoundary(kind,{...input,x:10,z:20,heightAt:terrain}));
    assert.equal(buildSlopeBoundary(kind,{...input,x:0,z:0,heightAt:()=>NaN}),null);
  }
}
for(const len of [24,60,120]) for(const kind of ['citywall','levee','tetrapod']) {
  const def=WALL_KINDS[kind];
  assert(wallFit(wallParts(kind,{len,depth:def.depth,h:def.h,seed:7}),len,def.depth,def.h).fit);
}
for(const y of [0,.1,2,15,30]) {
  const a=boundaryRockHeight(y,-11,2,30),b=boundaryRockHeight(y,0,2,30);
  assert(a>=0 && a<=y);
  assert(Math.abs(a-b)<1e-12,'periodic fracture tile');
}
const rock=elongatedGeologyMesh('cliff',42,{len:30,depth:18,height:30,bufferDepth:32,surface:boundaryRockHeight});
assert(rock.meshData.vertices.every(Number.isFinite));
assert.throws(()=>elongatedGeologyMesh('cliff',42,{len:30,depth:18,height:30,surface:()=>NaN}),RangeError);
const bodySeam=[],bufferSeam=[];
for(let i=0;i<rock.meshData.vertices.length;i+=3) if(Math.abs(rock.meshData.vertices[i+2]+9)<1e-6)
  bodySeam.push(rock.meshData.vertices.slice(i,i+3));
for(let i=0;i<rock.bufferMeshData.vertices.length;i+=3) if(Math.abs(rock.bufferMeshData.vertices[i+2]-16)<1e-6)
  bufferSeam.push([rock.bufferMeshData.vertices[i],rock.bufferMeshData.vertices[i+1],-9]);
const unique=rows=>[...new Set(rows.map(p=>JSON.stringify(p)))].sort();
assert.deepEqual(unique(bodySeam),unique(bufferSeam),'fracture deformation retains the buffer seam');
const buffer=buildBoundaryRunParts('citywall',{len:30,depth:5,h:14,bufferDepth:32,seed:42,joins:[null,null]});
assert(buffer.bufferParts.filter(p=>p.role==='buffer-wall').every(p=>p.g[0]==='mesh'));
for(let seed=0;seed<80;seed++) for(const kind of ['tetrapod','wetpods']) {
  const def=WALL_KINDS[kind],parts=wallParts(kind,{len:30,depth:def.depth,h:def.h,seed});
  assert(wallFit(parts,30,def.depth,def.h).fit);
  for(const core of parts.filter(p=>p.role==='breakwater-core')) {
    const legs=parts.filter(p=>p.pod===core.pod && p.role==='breakwater-arm');
    assert.equal(legs.length,4);
    const axes=legs.map(p=>mat3Apply(mat3FromEulerXYZ(p.r),[0,1,0]));
    for(let i=0;i<4;i++) {
      assert(axes[i].every((v,k)=>Math.abs(legs[i].p[k]-v*legs[i].g[2][1]/2-core.p[k])<1e-9),'cast leg root');
      for(let j=i+1;j<4;j++) assert(Math.abs(axes[i].reduce((sum,v,k)=>sum+v*axes[j][k],0)+1/3)<1e-9,'tetrahedral pose');
    }
  }
}
const cliff=wallParts('cliff',{len:30,depth:18,h:30,seed:42})[0];
for(const x of [-5,0,5]) {
  const nearest=Math.min(...cliff.g[1].vertices.filter((_,i)=>i%3===0).map(v=>Math.abs(v-x)));
  assert(cliff.g[1].vertices.some((v,i)=>i%3===0 && Math.abs(v-x)<=nearest+1e-6
    && Math.abs(cliff.g[1].vertices[i+2])<1e-6 && cliff.g[1].vertices[i+1]+cliff.p[1]>18),'broad cliff crest');
}
console.log('Boundary appearance: deterministic envelopes, slopes, fracture seams and triangle budgets passed.',report);
