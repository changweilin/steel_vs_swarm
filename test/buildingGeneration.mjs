import assert from 'node:assert/strict';
import { register } from 'node:module';
const modules = {
  three: new URL('../out/forest_review/three.module.js', import.meta.url).href,
  'three/addons/utils/BufferGeometryUtils.js': new URL('../out/forest_review/utils_BufferGeometryUtils.js', import.meta.url).href,
};
register('data:text/javascript,' + encodeURIComponent(`const modules = ${JSON.stringify(modules)};
export async function resolve(s, c, next) { return modules[s] ? { url: modules[s], shortCircuit: true } : next(s, c); }`), import.meta.url);
const THREE = await import('three');
const { architecturalRoof, buildOsmPolygonBuildings } = await import('../public/js/osmBuilding.js');
const { ARCHITECTURE_STYLES, CULTURAL_REGIONS } = await import('../public/js/architectureStyles.js');
const { chooseArchitecture, createArchitecturePlanner } = await import('../public/js/buildingDiversity.js');
const { analyzeApprovedBuilding, fitApprovedPolygon, fitApprovedBuilding } = await import('../public/js/approvedBuildingModels.js');
const { generateBackgroundObject } = await import('../public/js/backgroundObjects.js');
const { BUILDING_PARTS } = await import('../public/js/runtimeParts.js');
const rectangle = (w, d, angle = 0) => ({ outer: [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]]
  .map(([x,z]) => [x*Math.cos(angle)-z*Math.sin(angle), x*Math.sin(angle)+z*Math.cos(angle)]), holes: [] });
const style = { ...ARCHITECTURE_STYLES.alpine, id: 'alpine', profile: 'plain', variant: 0 };
for (const form of ['gable','xuanshan','yingshan','sawtooth','vault','curved_ridge','wudian','xieshan','mansard','shed','tiered']) {
  for (const angle of [0, Math.PI/6, Math.PI/2]) {
    const geos = architecturalRoof(rectangle(20,10,angle), 12, style, form, null, 10);
    for (const geo of geos) {
      assert.ok(geo.attributes.position.array.every(Number.isFinite));
      geo.translate(0,-12,0); geo.rotateY(angle); geo.computeBoundingBox();
      assert.ok(geo.boundingBox.min.y >= -1e-4, form + ' penetrates wall top');
      if (geo === geos[0] && ['gable','xuanshan','yingshan'].includes(form)) {
        const pos=geo.attributes.position;
        for(let i=0;i<pos.count;i++) if(pos.getY(i)>3.19 && pos.getY(i)<3.21) {
          assert.ok(Math.abs(pos.getZ(i))<1e-4, form + ' ridge must lie on long axis');
        }
      }
      geo.dispose();
    }
  }
}
for (const region of Object.keys(CULTURAL_REGIONS)) for(let i=0;i<200;i++) {
  assert.equal(chooseArchitecture(9,i,{slope:45, region}).foundation,'retaining');
}
const poly=rectangle(20,10);
const area={sourceId:'regression/1', tags:{building:'house',height:'10'}, centroid:{x:0,z:0},
  classification:{generator:'polygonBuilding',kind:'house'},worldPolygons:[poly]};
const terrain={heightAt:x=>x};
const planner=createArchitecturePlanner({terrain,seed:4});
const slopeStyle=planner(area,poly);
assert.equal(slopeStyle.foundation,'retaining');
const slope=buildOsmPolygonBuildings(new THREE.Group(),[area],{terrain,architectureOf:()=>slopeStyle});
assert.ok(slope.platforms[0].y>20);
assert.ok(slope.blockers.length>4);
assert.ok(slope.blockers.every(b=>b.h>0 && Number.isFinite(b.y)));
assert.equal(fitApprovedBuilding({x:0,z:0,w:20,d:10,h:10},slopeStyle),null);
const detached={key:'test-detached',generation:{mainPartCount:2},parts:[0,100].map(x=>({type:'box',dimensions:[2,2,2],position:[x,1,0]}))};
assert.equal(analyzeApprovedBuilding(detached).reason,'disconnected_structure');
const rejected={}; let accepted=0, replacements=0;
for(const source of BUILDING_PARTS) for(let variant=0;variant<4;variant++) {
  const entry=generateBackgroundObject(source.key,variant);
  const analysis=analyzeApprovedBuilding(entry);
  if(!analysis.accepted) { rejected[analysis.reason]=(rejected[analysis.reason]||0)+1; continue; }
  accepted++;
  if(!analysis.rectangular) continue;
  const [w,h,d]=analysis.bounds.size;
  const base=rectangle(w,d);
  for(let seed=0;seed<4;seed++) {
    const geometry=fitApprovedPolygon(base,h,style,seed);
    if(!geometry) continue;
    const group=new THREE.Group();
    const result=buildOsmPolygonBuildings(group,[{...area,tags:{building:'house',height:String(h)},worldPolygons:[base]}],{
      terrain:{heightAt:()=>0},architectureOf:()=>style,modelOf:()=>geometry,
    });
    assert.equal(group.children.length,1,'replacement must not retain procedural walls/roof');
    assert.equal(result.generated,1);
    assert.equal(result.blockers.length,geometry.userData.buildingVolumes.length);
    assert.equal(result.platforms.length,result.blockers.length);
    result.blockers.forEach((b,i)=>assert.equal(b.ty,result.platforms[i].y));
    assert.ok(group.children[0].geometry.attributes.position.array.every(Number.isFinite));
    replacements++; break;
  }
}
assert.ok(accepted>0); assert.ok(replacements>0,'retained models must actually enter new generator');
console.log({accepted,rejected,replacements});


// A replacement and a procedural building sharing a material bucket must merge successfully.
const mixed = new THREE.Group();
const painted = new THREE.BoxGeometry(20,10,10);
painted.setAttribute('color',new THREE.BufferAttribute(new Float32Array(painted.attributes.position.count*3),3));
const otherPoly = rectangle(20,10); otherPoly.outer=otherPoly.outer.map(([x,z])=>[x+50,z]);
buildOsmPolygonBuildings(mixed,[area,{...area,sourceId:'regression/2',worldPolygons:[otherPoly]}],{
 terrain:{heightAt:()=>0},architectureOf:()=>style,modelOf:p=>p.outer[0][0]<0?painted:null,
});
assert.ok(mixed.children.every(m=>m.geometry?.attributes.position.array.every(Number.isFinite)));
assert.equal(fitApprovedPolygon({outer:[[0,0],[20,0],[0,10]],holes:[]},10,style),null);
assert.equal(fitApprovedPolygon({...poly,holes:[rectangle(2,2).outer]},10,style),null);

console.log('PASS: roof axes, slopes, assembly rejection, exclusive replacement, batch merge, matching collision');
