import {writeFile} from 'node:fs/promises';
import {chromiumOrNull, chromePath} from '../../tools/pw.mjs';
import {serve} from '../../tools/mech_prompt_review.mjs';
const server=serve(0);
await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
const chromium=await chromiumOrNull();
const browser=await chromium.launch({headless:true,executablePath:chromePath(),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/?mech=m08`);
  await page.waitForFunction(()=>window.__MECH_REVIEW?.preview?.unit?.userData.morph);
  const result=await page.evaluate(async()=>{
    const THREE=await import('three');
    const {forgeMorphUnit,specOf}=await import('/public/js/forge/forge.js');
    const {group}=forgeMorphUnit(specOf('m08@ground'),specOf('m08@flight'));
    const ground=group.userData.morph.gg,chest=ground.getObjectByName('chest');
    const wing=ground.getObjectByName('wing_l'),ulna=ground.getObjectByName('ulna_l'),outer=ground.getObjectByName('outer_l');
    const points=[];
    wing.traverse(node=>{
      if(!node.isMesh||node.userData.isOutline) return;
      if(!node.userData.authoredParts?.some(p=>/^(Fanned primary feather|Overlapping secondary feather|Layered shoulder covert)/.test(p)))return;
      let owner=node.parent;
      while(owner&&owner!==wing&&!owner.name.startsWith('leg_'))owner=owner.parent;
      if(owner?.name.startsWith('leg_'))return;
      const p=node.geometry.attributes.position;
      for(let i=0;i<p.count;i++)points.push({node,p:new THREE.Vector3().fromBufferAttribute(p,i)});
    });
    const scratch=new THREE.Vector3(),inverse=new THREE.Matrix4();
    const bounds=()=>{
      ground.updateMatrixWorld(true);
      inverse.copy(chest.matrixWorld).invert();
      const matrices=new Map();
      const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
      let worst=null;
      for(const {node,p}of points){
        if(!matrices.has(node))matrices.set(node,inverse.clone().multiply(node.matrixWorld));
        const matrix=matrices.get(node);
        scratch.copy(p).applyMatrix4(matrix);
        for(let i=0;i<3;i++){min[i]=Math.min(min[i],scratch.getComponent(i));max[i]=Math.max(max[i],scratch.getComponent(i));}
        if(!worst||Math.abs(scratch.x)>Math.abs(worst.point[0]))worst={node:node.name,parts:node.userData.authoredParts,point:scratch.toArray()};
      }
      return {min,max,worst};
    };
    const baseline=bounds(),original=[wing.rotation.y,ulna.rotation.y,outer.rotation.y];
    const leg=ground.getObjectByName('leg_FL'),legWorld=leg.getWorldPosition(new THREE.Vector3());
    let best=null;
    for(let w=1.5;w<=2.05;w+=.025)for(let u=-3.05;u<=-2.55;u+=.05)for(let o=2.0;o<=2.5;o+=.05){
      wing.rotation.y=w;ulna.rotation.y=u;outer.rotation.y=o;
      const b=bounds(),width=Math.max(Math.abs(b.min[0]),Math.abs(b.max[0]));
      if(width>=.985||b.min[1]<=.08||b.max[1]>=.56)continue;
      const score=(w-original[0])**2+(u-original[1])**2+(o-original[2])**2;
      if(!best||score<best.score)best={rotations:[w,u,o],bounds:b,score};
    }
    if(best){
      wing.rotation.y=best.rotations[0];ulna.rotation.y=best.rotations[1];outer.rotation.y=best.rotations[2];
      ground.getObjectByName('forewing_link_l').rotation.y=-best.rotations[0];
      ground.updateMatrixWorld(true);
      best.legPosition=leg.parent.worldToLocal(legWorld.clone()).toArray();
    }
    return {baseline,original,legWorld:legWorld.toArray(),best,points:points.length};
  });
  await writeFile('out/limb_grip_review/fold-probe.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}finally{await browser.close();server.close();}
