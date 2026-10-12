// Exercise the shipped solver over full cycles: independent grips, toe-out stance, stow/sole clearance,
// alternating muzzles, flexible tails and unobstructed horn/launcher paths. Geometry checks use actual vertices.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromiumOrNull, chromePath } from './pw.mjs';
import { serve } from './mech_prompt_review.mjs';

const output='out/appearance_motion';
const option=process.argv.indexOf('--asset');
const ids=option<0?['s06','s07','s09','m02','t12','t03','t06','s10','t11','m05','m07']:process.argv[option+1].split(',');
const inputHashes={};
for(const file of ['locomotion.js','anatomicalPose.js','unitMotion.js','models.js','forge/forge.js','forge/referenceAsset.js',...ids.map(id=>`forge/assets/${id}.js`)]) {
  inputHashes[file]=createHash('sha256').update(await readFile('public/js/'+file)).digest('hex');
}
await mkdir(output,{recursive:true});
const server=serve(0,{threeModule:'out/forest_review/three.module.js'});
await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
let browser;
try {
  const chromium=await chromiumOrNull();assert(chromium,'Existing browser runtime required');
  browser=await chromium.launch({headless:true,executablePath:chromePath(),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:900,height:720}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({contentType:'text/css',body:''}));
  await page.goto(`http://127.0.0.1:${server.address().port}/?mech=t01`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__MECH_REVIEW?.preview?.unit);
  await page.evaluate(()=>window.__MECH_REVIEW.preview.stop());
  const results={};
  for(const id of ids) {
    const result=await page.evaluate(async id=>{
      const T=await import('three');
      const {makeUnit}=await import('/public/js/models.js');
      const {CHARACTERS,charKind,heroWeapon}=await import('/public/js/data.js');
      const {stepLocomotion,stepCombatFx}=await import('/public/js/locomotion.js');
      const {disposeTree}=await import('/public/js/toon.js');
      const check=(ok,message)=>{if(!ok)throw Error(id+': '+message);};
      const point=()=>new T.Vector3(),q=()=>new T.Quaternion();
      const bounds=root=>{
        const b=new T.Box3();root.updateWorldMatrix(true,true);
        root.traverse(mesh=>{
          if(!mesh.isMesh||mesh.userData.presentationEffect||mesh.userData.isOutline)return;
          const vertices=mesh.geometry.attributes.position;
          for(let i=0;i<vertices.count;i++)b.expandByPoint(point().fromBufferAttribute(vertices,i).applyMatrix4(mesh.matrixWorld));
        });return b;
      };
      const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(420,420);renderer.setClearColor(0x18212e);
      const scene=new T.Scene();scene.add(new T.HemisphereLight(0xffffff,0x617086,1.4));
      const light=new T.DirectionalLight(0xffffff,1.6);light.position.set(6,10,8);scene.add(light);
      const camera=new T.PerspectiveCamera(38,1,.1,200),pictures={},metrics={};
      for(const action of ['idle','run','light','heavy','def','atk']) {
        const unit=makeUnit(`hero:${charKind(id)}`,CHARACTERS[id].side,{ring:false,ch:id}).group;
        const ent={id,mesh:unit,sp:1,heroY:0};let now=0,lastShot=-Infinity;
        const rig=unit.userData.rig,speed=action==='run'?rig.top:0;
        check(!unit.userData.decoyPod,'retired external carrier mount remains');
        const tick=dt=>{
          now+=dt;
          if(['light','heavy'].includes(action)&&now-lastShot>=1/heroWeapon(id,action).rate){ent.fireFx={t0:now,slot:action};lastShot=now;}
          stepCombatFx(ent,now,dt);stepLocomotion(ent,dt,now,0,-speed*dt,unit.rotation.y);unit.updateMatrixWorld(true);
          unit.traverse(n=>check(n.matrixWorld.elements.every(Number.isFinite),'nonfinite '+n.name));
        };
        if(action==='def'||action==='atk')ent.castFx={t0:0,slot:action};
        const xBefore=rig.wpn.light.ref.getWorldPosition(point()).x;
        let soleMargin=Infinity,handGap=Infinity;
        for(let frame=0;frame<180;frame++) {
          tick(1/60);
          if(rig.stowedWeapons) {
            const sole=Math.min(...['L','R'].map(side=>bounds(rig['legChain'+side].at(-1).g).min.y));
            for(const control of rig.stowedWeapons) {
              const margin=bounds(control.node).min.y-sole;soleMargin=Math.min(soleMargin,margin);
              check(margin>=-.001,'weapon falls below the soles');
            }
          }
          if(id==='s09') {
            const hands=['L','R'].map(side=>rig['armChain'+side].at(-1).g.getWorldPosition(point()));
            handGap=Math.min(handGap,hands[0].distanceTo(hands[1]));check(hands[0].distanceTo(hands[1])>.35,'forepaws collapse together');
          }
          if(frame>=120&&rig.stance)check(rig.legL.rotation.y>.15&&rig.legR.rotation.y<-.15,'toe-out stance lost');
        }
        if(id==='s06') {
          check(rig.archery.arrow.parent.name==='wrist_l'&&rig.archery.bow.parent.name==='wrist_r','bow/arrow do not have independent hands');
          if(action!=='light')check(rig.archery.hand.getWorldPosition(point()).distanceTo(rig.archery.nock.getWorldPosition(point()))>.4,'non-light action prepares a bow shot');
          if(action==='light') {
            const a=rig.archery;
            check(a.hand.getWorldPosition(point()).distanceTo(a.head.getWorldPosition(point()))<.65,'draw hand misses the face anchor');
            const upper=a.bowElbow.getWorldPosition(point()).sub(a.bowShoulder.getWorldPosition(point())).normalize();
            const lower=a.bowHand.getWorldPosition(point()).sub(a.bowElbow.getWorldPosition(point())).normalize();
            check(upper.dot(lower)>.90,'bow arm stays folded at full draw');
            const drawArm=a.hand.getWorldPosition(point()).sub(a.elbow.getWorldPosition(point())).normalize();
            const arrow=point().set(0,0,1).applyQuaternion(rig.wpn.light.ref.getWorldQuaternion(q()));
            check(drawArm.dot(arrow)>.90,'draw elbow does not align behind the arrow');
            ent.castFx={t0:now,slot:'atk'};
            for(let frame=0;frame<18;frame++)tick(1/60);
            check(a.hand.getWorldPosition(point()).distanceTo(a.nock.getWorldPosition(point()))>.4,'casting retains the previous bow shot pose');
            ent.castFx=null;tick(1/60);
          }
          if(action==='idle')check(rig.launcher.pods.every(p=>Math.abs(p.node.position.x)<.7),'idle rocket boxes stay spread');
          if(action==='heavy') {
            check(rig.launcher.pods.every(p=>Math.abs(p.node.position.x)>1.2),'launch boxes do not open');
            const frame=[];rig.launcher.pivot.traverse(mesh=>{if(mesh.isMesh&&mesh.userData.authoredParts?.some(part=>part.startsWith('Low dorsal launcher crossbeam')))frame.push(mesh);});
            for(const pod of rig.launcher.pods) {
              const origin=pod.node.localToWorld(point().set(0,.08+Math.sign(pod.deploy)*.05,0));
              const inward=point().set(-Math.sign(pod.deploy),0,0).applyQuaternion(pod.node.getWorldQuaternion(q()));
              check(new T.Raycaster(origin,inward,0,4).intersectObjects(frame,false).length>0,'deployed pod has no supporting crossarm path');
            }
            const direction=point().set(0,1,0).applyQuaternion(rig.wpn.heavy.ref.getWorldQuaternion(q()));
            check(new T.Raycaster(rig.muzzles.heavy.n.getWorldPosition(point()),direction,0,20).intersectObject(unit.getObjectByName('hum_waist'),true).length===0,'rocket path crosses rider');
          }
        }
        if(id==='s07') {
          check(unit.getObjectByName('emitter_l').parent.name==='tent_1_11','shield is not held by front tentacle');
          const tool=unit.getObjectByName('cast_dish');check(tool.parent.name==='tent_3_11','attack tool is not held by rear tentacle');
          check(tool.getWorldPosition(point()).y>rig.head.getWorldPosition(point()).y,'rear attack tool is below the head');
          if(action==='light')check(Math.abs(rig.wpn.light.ref.getWorldPosition(point()).x)<Math.abs(xBefore)*.6,'firing tentacle does not converge');
        }
        if(id==='m02') {
          check(rig.alternating.weapons.map(w=>w.parent.name).join(',')==='elbow_r,elbow_l','guns are not on separate forearms');
          if(action==='light') {
            const previous=rig.alternating.index;ent.fireFx={t0:now+.01,slot:'light'};tick(1/60);
            check(previous!==rig.alternating.index,'left/right guns do not alternate');
            for(const [name,parent]of rig.combat.joints)if(parent===rig.alternating.muzzles[0].name)
              check(rig.combat.nodes.get(name).parent===rig.alternating.muzzles[rig.alternating.index],'flash stays on the inactive gun');
            check(rig.muzzles.light.n!==rig.wpn.light.muz,'next shot repeats the previous muzzle');
          }
        }
        if(id==='t06')check(rig.wpn.light.ref.parent.name==='wrist_l','light gun stays in the staff hand');
        if(['light','heavy'].includes(action)) {
          const weapon=rig.wpn[action],axis=weapon.fwd;
          const direction=point().set(axis==='x'?1:0,axis==='y'?1:0,axis==='z'?1:0).applyQuaternion(weapon.ref.getWorldQuaternion(q()));
          check(direction.z>.95,'active muzzle points away from target');
        }
        if(id==='t11')check(rig.wpn.light.ref.parent.name==='shoulder_r'&&rig.wpn.heavy.ref.parent.name==='shoulder_l','weapons remain buried at the head');
        if(id==='m07'&&action==='heavy') {
          check(rig.dorsalLift.node.position.y>rig.dorsalLift.rest+1,'dorsal gun does not lift');
          const direction=point().set(0,0,1).applyQuaternion(rig.wpn.heavy.ref.getWorldQuaternion(q()));
          check(new T.Raycaster(rig.muzzles.heavy.n.getWorldPosition(point()),direction,0,20).intersectObject(rig.head,true).length===0,'dorsal muzzle path strikes horn');
          const body=[];unit.traverse(mesh=>{if(mesh.isMesh&&mesh.userData.authoredParts?.some(part=>part.startsWith('Dorsal cannon lift foot')))body.push(mesh);});
          const down=point().set(0,-1,0).applyQuaternion(rig.dorsalLift.node.getWorldQuaternion(q()));
          const travel=(rig.dorsalLift.height+.24)*rig.dorsalLift.node.getWorldScale(point()).y;
          check(new T.Raycaster(rig.dorsalLift.node.getWorldPosition(point()),down,0,travel).intersectObjects(body,false).length>0,'raised dorsal gun loses its lift support');
        }
        if(id==='s10'&&action==='run') {
          const before=rig.tailSegs.map(n=>n.quaternion.clone());for(let i=0;i<20;i++)tick(1/60);
          check(rig.tailSegs.filter((n,i)=>n.quaternion.angleTo(before[i])>.04).length>=3,'running tail remains rigid');
        }
        metrics[action]={soleMargin:Number.isFinite(soleMargin)?soleMargin:null,handGap:Number.isFinite(handGap)?handGap:null};
        const box=bounds(unit),center=box.getCenter(point()),size=box.getSize(point()),span=Math.max(size.x,size.y,size.z);
        scene.add(unit);
        for(const [view,offset] of [['oblique',[1.25,.55,1.6]],['front',[0,.25,2.2]],['side',[2.2,.25,0]],['back',[0,.25,-2.2]],['top',[0,2.2,.01]]]) {
          camera.position.copy(center).add(point().fromArray(offset).multiplyScalar(span));camera.lookAt(center);renderer.render(scene,camera);
          pictures[action+'-'+view]=renderer.domElement.toDataURL('image/png').split(',')[1];
        }
        scene.remove(unit);disposeTree(unit);
      }
      renderer.dispose();return {metrics,pictures};
    },id);
    for(const [name,bytes]of Object.entries(result.pictures))await writeFile(`${output}/${id}-${name}.png`,Buffer.from(bytes,'base64'));
    results[id]=result.metrics;console.log('Equipment verified '+id);
  }
  assert.equal(errors.length,0,errors.join('\n'));
  await writeFile(`${output}/runtime-validation.json`,JSON.stringify({inputs:inputHashes,metrics:results,gates:{structure:'pass',motion:'pass',visual:'pending_image_inspection'}},null,2));
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
