// Export production building batches so Blender inspection uses the shipped facade seam.
import { register } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const modules = {
  three: new URL('../../out/forest_review/three.module.js', import.meta.url).href,
  'three/addons/utils/BufferGeometryUtils.js': new URL('../../out/forest_review/utils_BufferGeometryUtils.js', import.meta.url).href,
};
register('data:text/javascript,' + encodeURIComponent(`const modules = ${JSON.stringify(modules)};
export async function resolve(s,c,next) { return modules[s] ? {url:modules[s],shortCircuit:true} : next(s,c); }`), import.meta.url);
const THREE = await import('three');
const { buildOsmPolygonBuildings } = await import('../../public/js/osmBuilding.js');
const { EXTERIOR_SCHEMES, resolveExteriorScheme } = await import('../../public/js/architectureStyles.js');
const { chooseArchitecture } = await import('../../public/js/buildingDiversity.js');
const models = [];
for (const [kind, spec] of Object.entries(EXTERIOR_SCHEMES)) {
  const functionInfo = { key:'residential_apartment', type:'apartment', category:'residential' };
  const source = chooseArchitecture(31, 'facade-review', { functionInfo, urban:true });
  const exterior = { ...resolveExteriorScheme(source), kind, entrance:spec.entrance, period:1, depth:0.7 };
  const style = { ...source, id:'modern', wall:0xd5ccb9, roof:0x485a63, trim:0x56636b, glass:0x547f90,
    facade:'concrete', detail:null, roofForm:'flat', targetHeight:12.8, exterior,
    functionalWindows:{shape:'rect',bayStep:6,storeyH:3.2} };
  const poly = { outer:[[-12,-8],[12,-8],[12,8],[-12,8]], holes:[] };
  const group = new THREE.Group();
  const result = buildOsmPolygonBuildings(group, [{ sourceId:'review/one', centroid:{x:0,z:0},
    tags:{building:'apartments',height:'12.8'}, classification:{kind:'house',generator:'polygonBuilding'}, worldPolygons:[poly] }],
    { terrain:{heightAt:()=>0,waterY:-10}, architectureOf:()=>style });
  const rows = result.meshes.map(mesh => {
    const geo = mesh.geometry;
    return { name:mesh.name, vertices:[...geo.attributes.position.array],
      faces:geo.index ? [...geo.index.array] : Array.from({length:geo.attributes.position.count},(_,i)=>i),
      colors:[...geo.attributes.color.array] };
  });
  models.push({ kind, rows });
  group.traverse(obj => obj.geometry?.dispose());
}
const out = new URL('../../out/facade_review/', import.meta.url);
await mkdir(out,{recursive:true});
await writeFile(new URL('review.json',out),JSON.stringify({models}));
console.log('Exported 8 production facade families to out/facade_review/review.json');
