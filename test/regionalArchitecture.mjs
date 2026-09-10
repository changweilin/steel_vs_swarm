import assert from 'node:assert/strict';
import { register } from 'node:module';
const modules = {
  three: new URL('../out/forest_review/three.module.js', import.meta.url).href,
  'three/addons/utils/BufferGeometryUtils.js': new URL('../out/forest_review/utils_BufferGeometryUtils.js', import.meta.url).href,
};
register('data:text/javascript,' + encodeURIComponent(`const modules = ${JSON.stringify(modules)};
export async function resolve(s, c, next) { return modules[s] ? { url: modules[s], shortCircuit: true } : next(s, c); }`), import.meta.url);
const THREE = await import('three');

const { architecturalRoof, architecturalFacade, buildOsmPolygonBuildings } = await import('../public/js/osmBuilding.js');
const { REGIONAL_STYLES, REGIONAL_CULTURES, FACADE_GEOMETRY_LIMIT } = await import('../public/js/regionalArchitecture.js');
const { getRoofElevation } = await import('../public/js/buildingAppurtenances.js');
const { chooseArchitecture, detectCulturalRegion } = await import('../public/js/buildingDiversity.js');
const { ROOF_FORMS, FACADE_TYPES, ROOF_APPURTENANCE_COMPATIBILITY, computeOrientedRoofFrame } = await import('../public/js/architectureStyles.js');
const rect=(angle=0)=>({outer:[[-10,-6],[10,-6],[10,6],[-10,6]].map(([x,z])=>[x*Math.cos(angle)-z*Math.sin(angle),x*Math.sin(angle)+z*Math.cos(angle)]),holes:[]});
for(const [region, row] of Object.entries(REGIONAL_CULTURES)) for(const country of row.countries) assert.equal(detectCulturalRegion({country}),region,country);
assert.equal(detectCulturalRegion({country:'CH'}),'europe_alpine');
assert.equal(detectCulturalRegion({lat:35.7,lon:139.7}),'japan');
assert.equal(detectCulturalRegion({lat:52.37,lon:4.9}),'low_countries');
assert.equal(detectCulturalRegion({lat:27.7,lon:85.3}),'south_asia');
for(const form of ['steep_gable','crowstep','gambrel','butterfly']) for(const height of [6,14]) for(const angle of [0,.53,Math.PI/2]) {
 const poly=rect(angle),frame=computeOrientedRoofFrame(poly);
 const geos=architecturalRoof(poly,height,{roof:0x777777,variant:0},form,null,height);
 const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});const mesh=new THREE.Mesh(geos[0],material);mesh.updateMatrixWorld(true);
 for(const v of [-4.2,-1.7,0,2.3,4.8]) {
  const x=frame.cx+frame.normalX*v,z=frame.cz+frame.normalZ*v;
  const hits=new THREE.Raycaster(new THREE.Vector3(x,100,z),new THREE.Vector3(0,-1,0)).intersectObject(mesh);
  assert.ok(hits.length,form+' ray missed');
  assert.ok(Math.abs(hits[0].point.y-getRoofElevation(x,z,poly,form,{frame},height,height))<1e-4,form+' attachment elevation differs from mesh');
 }
 geos.forEach(g=>g.dispose());material.dispose();
 assert.ok(ROOF_APPURTENANCE_COMPATIBILITY[form]);
}
const signatures=new Set();
for(const [id,row] of Object.entries(REGIONAL_STYLES)) {
 assert.ok(ROOF_FORMS[row.roofForm]);assert.ok(FACADE_TYPES[row.wallType]);
 const style={...row,id,profile:'plain',variant:1,functionInfo:{category:row.categories[0]}};
 const poly=rect(.37);const area={sourceId:id,tags:{building:'house',height:'10'},classification:{kind:'house',generator:'polygonBuilding'},worldPolygons:[poly]};
 const group=new THREE.Group();const result=buildOsmPolygonBuildings(group,[area],{terrain:{heightAt:()=>0},architectureOf:()=>style});
 assert.equal(result.generated,1);assert.equal(group.children.length,3);
 assert.ok(group.children.every(m=>m.geometry.attributes.position.array.every(Number.isFinite)));
 signatures.add(group.children[2].geometry.attributes.position.count);
 const edges=result.blockers;
 const details=architecturalFacade(edges,style,.28);
 assert.ok(details.length<=FACADE_GEOMETRY_LIMIT.regional);
 assert.ok(details.length>=edges.length,'every wall needs details');
 details.forEach(g=>g.dispose());
 const selected=new Set();
 for(let i=0;i<300;i++) {
  const choice=chooseArchitecture(11,i,{region:row.region,building:{tags:{building:row.categories.includes('rural')?'farm':'house',height:'10'}}});
  selected.add(choice.id);
 }
 assert.ok(selected.has(id),id+' unreachable in own region');
 for(let i=0;i<30;i++) {
  const high=chooseArchitecture(11,i,{region:row.region,building:{tags:{building:'office',height:'70'}}});
  assert.ok(!high.maxHeight || high.maxHeight>=70);
  const steep=chooseArchitecture(11,i,{region:row.region,slope:45});
  assert.equal(steep.foundation,'retaining');
 }
}
assert.ok(signatures.size>=10,'regional styles must differ geometrically');
console.log('PASS: 16 regional styles, country resolution, all 4 roof profiles raycast correctly, detail limits, height and slope gates');
