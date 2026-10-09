// The real registry and locomotion driver must preserve species motion and equipment clearance together.
import { mkdir, writeFile } from 'node:fs/promises';
import { chromiumOrNull, chromePath } from './pw.mjs';
import { serve } from './mech_prompt_review.mjs';

const root = 'out/mech_reference/motion';
const ids = ['s01','s02','s06','s07','t06','s03','t07','m04'];
await mkdir(root, {recursive:true});
const server = serve(0, {threeModule:'out/forest_review/three.module.js'});
await new Promise(resolve => server.listening ? resolve() : server.once('listening',resolve));
const chromium = await chromiumOrNull();
const browser = await chromium.launch({headless:true,executablePath:chromePath(),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page = await browser.newPage({viewport:{width:900,height:800}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({contentType:'text/css',body:''}));
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/?mech=s01`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__MECH_REVIEW?.preview?.unit);
  const results = await page.evaluate(async(ids)=>{
    const THREE=await import('three');
    const {makeUnit}=await import('/public/js/models.js');
    const {CHARACTERS,charKind}=await import('/public/js/data.js');
    const {stepLocomotion,stepCombatFx}=await import('/public/js/locomotion.js');
    const {stepUnitSpinners}=await import('/public/js/unitMotion.js');
    const {disposeTree}=await import('/public/js/toon.js');
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    renderer.setSize(900,800);renderer.setClearColor(0x18212e);
    document.body.replaceChildren(renderer.domElement);
    const scene=new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff,0x617086,3));
    const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(6,10,8);scene.add(light);
    const camera=new THREE.PerspectiveCamera(38,900/800,.1,100);
    window.motionReview={renderer,scene,camera};
    const result={};
    for(const id of ids){
      const unit=makeUnit(`hero:${charKind(id)}`,CHARACTERS[id].side,{ring:false,ch:id}).group;
      const ent={id,mesh:unit,heroY:id==='s03'?5:0,flies:id==='s03',sp:1};
      let now=0;
      const step=(speed=0,turn=0)=>{now+=1/60;const pyaw=unit.rotation.y;unit.rotation.y+=turn/60;stepCombatFx(ent,now,1/60);stepLocomotion(ent,1/60,now,0,-speed/60,pyaw);stepUnitSpinners(unit.userData.spin,1/60);unit.updateMatrixWorld(true);};
      for(let i=0;i<180;i++)step(5);
      const rig=unit.userData.rig;
      const check=(ok,msg)=>{if(!ok)throw new Error(id+': '+msg);};
      unit.traverse(n=>check(n.matrixWorld.elements.every(Number.isFinite),'nonfinite '+n.name));
      if(id==='s01'){
        const front=rig.rotorWings.filter(w=>w.phase===0),rear=rig.rotorWings.filter(w=>w.phase!==0);
        check(front.every((w,i)=>Math.abs(w.node.rotation.z*w.sign+rear[i].node.rotation.z*rear[i].sign)<1e-8),'front/rear phases drift');
        result[id]={period:1/front[0].frequency,maxWingAngle:front[0].lift,rotors:unit.userData.spin.length};
      }
      if(id==='s07'){
        const light=rig.wpn.light.ref,heavy=rig.wpn.heavy.ref;
        check(light.parent.name==='tent_0_11' && heavy.parent.name==='tent_2_11','weapons are not held by lateral upper tentacles');
        const raised=(weapon,root)=>weapon.getWorldPosition(new THREE.Vector3()).y-unit.getObjectByName(root).getWorldPosition(new THREE.Vector3()).y;
        let minimumElevation=Infinity;
        for(let frame=0;frame<Math.ceil(60/rig.tentacleWaves[0].frequency);frame++){
          step(5);
          const elevations=[raised(light,'tent_0'),raised(heavy,'tent_2')];
          check(elevations.every(y=>y>.3),'upper tentacles hold weapons too low: '+elevations.join(', '));
          minimumElevation=Math.min(minimumElevation,...elevations);
        }
        result[id]={terrestrialDriver:!rig.cephalopod,chains:rig.tentacleWaves.length,weaponHolders:[light.parent.name,heavy.parent.name],minimumElevation};
      }
      if(rig.flightAxial){
        const axial=rig.flightAxial;
        check(axial.waist.parent===axial.pelvis && axial.chest.parent===axial.waist,'axial body regions are fused');
        check(axial.neck.parent===axial.chest && axial.head.parent===axial.neck,'cervical chain is bypassed');
        check(rig.wings.every(w=>w.w.parent===axial.chest),'wing shoulders bypass thorax');
        result[id]={axialHierarchy:true,waistPitch:axial.waist.rotation.x};
      }
      if(id==='t06'){
        check(rig.tailSegs.length===8,'tail missing');check(rig.hips.position.y<rig.hipsY0-.2,'no crouching run');
        result[id]={tail:8,crouch:rig.hipsY0-rig.hips.position.y};
      }
      if(id==='s03'){
        const tail=rig.swim.tail.at(-1),before=tail.rotation.x;
        for(let i=0;i<40;i++)step(5);
        check(Math.abs(tail.rotation.x-before)>.04,'whale tail is frozen');
        result[id]={tailPitchChange:Math.abs(tail.rotation.x-before)};
      }
      if(id==='s06'){
        const solidBounds=(root)=>{
          const box=new THREE.Box3();
          root.traverse(n=>{if(n.isMesh && !n.userData.presentationEffect){n.geometry.computeBoundingBox();box.union(n.geometry.boundingBox.clone().applyMatrix4(n.matrixWorld));}});
          return box;
        };
        let heightMargin=Infinity;
        const head=unit.getObjectByName('head'),base=rig.launcher.base;
        const heightCheck=()=>{
          const margin=solidBounds(head).max.y-solidBounds(base).max.y;
          check(margin>=-1e-5,'launcher rises above the helmet');heightMargin=Math.min(heightMargin,margin);
        };
        heightCheck();
        ent.heavyFx={t0:now,phase:'charge'};
        for(let i=0;i<100;i++){step(3);heightCheck();}
        check(rig.launcher.lift.position.y>rig.launcher.extension*.9,'support failed to extend');
        const direction=new THREE.Vector3(0,1,0).applyQuaternion(rig.launcher.pivot.getWorldQuaternion(new THREE.Quaternion()));
        check(direction.z>.95,'rack failed to aim after extending');
        const rider=unit.getObjectByName('hum_waist');
        const ray=new THREE.Raycaster(rig.muzzles.heavy.n.getWorldPosition(new THREE.Vector3()),direction,0,20);
        check(ray.intersectObject(rider,true).length===0,'rocket path strikes rider');
        result[id]={extension:rig.launcher.lift.position.y,forward:direction.toArray()};
        delete ent.heavyFx;
        for(let i=0;i<300;i++){step(0);heightCheck();}
        check(rig.launcher.lift.position.y<.01,'support failed to retract');
        check(Math.abs(rig.launcher.pivot.rotation.x)<.01,'rack retracts while aiming through the rider');
        for(const [speed,turn] of [[rig.top,0],[rig.top,1.8],[rig.top,-1.8],[0,0]]){
          ent.heavyFx={t0:now,phase:'charge'};
          for(let frame=0;frame<100;frame++){step(speed,turn);heightCheck();}
          delete ent.heavyFx;
          for(let frame=0;frame<150;frame++){step(speed,turn);heightCheck();}
        }
        unit.rotation.y=0;
        for(let frame=0;frame<300;frame++){step(0);heightCheck();}
        result[id].minimumHeadClearance=heightMargin;
      }
      let source;
      unit.traverse(node=>{if(node.userData.referenceAsset?.id===id)source??=node.userData.referenceAsset.source;});
      check(source,'missing authored source identity');
      result[id]={...result[id],source};
      scene.add(unit);
      const box=new THREE.Box3().setFromObject(unit),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
      camera.position.copy(center).add(new THREE.Vector3(Math.max(size.x,size.y,size.z)*1.25,size.y*.6,Math.max(size.x,size.y,size.z)*1.6));camera.lookAt(center);
      renderer.render(scene,camera);
      await new Promise(resolve=>setTimeout(resolve,20));
      window.motionReview.units ??= {};
      window.motionReview.units[id]={unit,ent,center,size,step,charge:()=>{
        ent.heavyFx={t0:now,phase:'charge'};for(let i=0;i<100;i++)step(3);
      }};
      scene.remove(unit);
    }
    window.motionReview.show=(id,side=false)=>{
      const v=window.motionReview.units[id],{scene,camera,renderer}=window.motionReview;
      for(const entry of Object.values(window.motionReview.units))scene.remove(entry.unit);
      scene.add(v.unit);
      const span=Math.max(v.size.x,v.size.y,v.size.z);
      camera.position.copy(v.center).add(side?new THREE.Vector3(span*2.2,v.size.y*.25,0):new THREE.Vector3(span*1.25,v.size.y*.6,span*1.6));camera.lookAt(v.center);renderer.render(scene,camera);
    };
    const activeAxes={};
    for(const id of Object.keys(CHARACTERS)){
      const unit=makeUnit(`hero:${charKind(id)}`,CHARACTERS[id].side,{ring:false,ch:id}).group;
      const ent={id,mesh:unit,sp:1,heroY:0};
      let now=0;
      const tick=()=>{now+=1/60;stepCombatFx(ent,now,1/60);stepLocomotion(ent,1/60,now,0,-6/60,0);unit.updateMatrixWorld(true);};
      activeAxes[id]=[];
      for(const form of charKind(id)==='morph'?['ground','flight']:['ground']){
        ent.heroY=form==='flight'?5:0;
        for(let i=0;i<300;i++)tick();
        for(const slot of ['light','heavy']){
          if(slot==='heavy'){
            ent.heavyFx={t0:now,phase:'charge'};
            for(let i=0;i<100;i++)tick();
            ent.heavyFx={t0:now,phase:'fire'};
          }else delete ent.heavyFx;
          for(let i=0;i<160;i++){
            ent.fireFx={t0:now,slot};tick();
          }
          const weapon=unit.userData.rig.wpn[slot],axis=weapon.fwd;
          const local=new THREE.Vector3(axis.endsWith('x')?1:0,axis.endsWith('y')?1:0,axis.endsWith('z')?1:0);
          if(axis.startsWith('-'))local.negate();
          const direction=local.applyQuaternion(weapon.ref.getWorldQuaternion(new THREE.Quaternion()));
          if(direction.z<.95)throw new Error(`${id}/${form}/${slot}: active firing axis ${direction.z}`);
          activeAxes[id].push({form,slot,forward:direction.z});
        }
      }
      disposeTree(unit);
    }
    return {metrics:result,activeAxes};
  },ids);
  for(const id of ids){
    await page.evaluate(id=>window.motionReview.show(id),id);await page.screenshot({path:`${root}/${id}.png`});
    await page.evaluate(id=>window.motionReview.show(id,true),id);await page.screenshot({path:`${root}/${id}-side.png`});
  }
  await page.evaluate(()=>{window.motionReview.units.s06.charge();window.motionReview.show('s06');});
  await page.screenshot({path:`${root}/s06-heavy.png`});
  for(const id of ['s01','s07','t06','s03'])for(let frame=0;frame<8;frame++){
    await page.evaluate(({id})=>{const v=window.motionReview.units[id];for(let i=0;i<(id==='s01'?120:24);i++)v.step(id==='t06'?10:6);window.motionReview.show(id,true);},{id});
    await page.screenshot({path:`${root}/${id}-cycle-${frame}.png`});
  }
  if(errors.length)throw new Error(errors.join('\n'));
  await writeFile(`${root}/runtime.json`,JSON.stringify(results,null,2));
  console.log(JSON.stringify(results));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
