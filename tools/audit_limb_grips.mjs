// Proximal joint exposure is the signed distance to the actual torso surface along the local lateral axis.
// Grasp origins equal the wrist contact in world space; inverse weapon scale preserves grasp dimensions.
// Ulna and manus must each move relative to their parent, with elbow folding greater during rising shoulder motion.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromiumOrNull,chromePath} from './pw.mjs';
import {serve} from './mech_prompt_review.mjs';

const output='out/limb_grip_review/runtime';
const specs={};
for(const file of ['assets.json','morphers.json']) Object.assign(specs,JSON.parse(await readFile('tools/mech_authoring/'+file)).assets);
const selection=process.argv.indexOf('--asset');
const ids=selection<0?Object.keys(specs):process.argv[selection+1].split(',');
assert(ids.every(id=>specs[id]),'Unknown asset');
await mkdir(output,{recursive:true});
const server=serve(0,{threeModule:'out/forest_review/three.module.js'});
await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
let browser;
const results={};
try{
  const chromium=await chromiumOrNull();assert(chromium,'Existing browser runtime required');
  browser=await chromium.launch({headless:true,executablePath:chromePath(),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:900,height:720}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({contentType:'text/css',body:''}));
  await page.goto(`http://127.0.0.1:${server.address().port}/?mech=${ids[0]}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__MECH_REVIEW?.preview?.unit);
  await page.evaluate(()=>window.__MECH_REVIEW.preview.stop());
  for(const id of ids){
    const result=await page.evaluate(async({id,spec})=>{
      const T=await import('three');
      const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
      const {makeUnit}=await import('/public/js/models.js');
      const {CHARACTERS,charKind,heroWeapon}=await import('/public/js/data.js');
      const {stepLocomotion,stepCombatFx}=await import('/public/js/locomotion.js');
      const {disposeTree}=await import('/public/js/toon.js');
      const check=(ok,message)=>{if(!ok)throw Error(id+': '+message);};
      const point=()=>new T.Vector3();
      const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
      renderer.setSize(600,600);renderer.setClearColor(0x18212e);
      renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.8;
      const scene=new T.Scene();scene.add(new T.HemisphereLight(0xffffff,0x617086,2));
      const light=new T.DirectionalLight(0xffffff,2);light.position.set(6,10,8);scene.add(light);
      const camera=new T.PerspectiveCamera(38,1,.1,150);
      const clay=new T.MeshStandardMaterial({color:0x9aa9b8,roughness:.8,metalness:0});
      const pictures={},metrics={};
      const glb=await new GLTFLoader().loadAsync('/public/assets/models/reference/'+id+'.glb');
      check(glb.animations.length>=8,'Independent export lost clips');
      for(const held of spec.rig.heldWeapons || []) check(glb.scene.getObjectByName(held.grip),'Export lost grasp frame');
      metrics.exportClips=glb.animations.map(a=>a.name);disposeTree(glb.scene);
      for(const form of spec.forms?['ground','flight']:['ground']){
        const unit=makeUnit(`hero:${charKind(id)}`,CHARACTERS[id].side,{ring:false,ch:id}).group;
        const ent={id,mesh:unit,sp:1,heroY:form==='flight'?5:0,flies:charKind(id)==='drone'};
        let now=0;
        const tick=(speed=0)=>{now+=1/60;stepCombatFx(ent,now,1/60);stepLocomotion(ent,1/60,now,0,-speed/60,0);unit.updateMatrixWorld(true);};
        for(let i=0;i<300;i++)tick();
        const rig=unit.userData.morph?(form==='flight'?unit.userData.morph.air:unit.userData.morph.ground):unit.userData.rig;
        let authored;
        const active=unit.userData.morph?(form==='flight'?unit.userData.morph.ag:unit.userData.morph.gg):unit;
        active.traverse(node=>{if(node.userData.referenceAsset?.id===id)authored??=node;});
        check(authored,'Missing registry provenance');
        const bodyName=/^(hips|pelvis|spine|waist|chest|hum_chest|hum_waist|hunch|mesothorax|metathorax|body_[0-9]+)$/;
        const rootNames=[...new Set([
          ...spec.joints.filter(([name])=>/^(shoulder_[lr]|hip_[lr]|leg_[FMH][LR]|(?:fore|hind)_hip_[lr])$/.test(name)).map(j=>j[0]),
          ...(spec.rig.tents || []).map(chain=>chain[0].g),
          ...(rig.wings || []).filter(wing=>wing.hand).map(wing=>wing.w.name),
        ])];
        const body=[];
        authored.traverse(mesh=>{if(mesh.isMesh && !mesh.userData.isOutline && !mesh.userData.presentationEffect &&
          bodyName.test(mesh.parent.name))body.push(mesh);});
        const exposures={};
        for(const name of rootNames){
          const node=authored.getObjectByName(name),sign=/(_r|[FMH]R)$/.test(name)?-1:1;
          let frame=node.parent;while(frame!==authored&&!bodyName.test(frame.name))frame=frame.parent;
          const local=frame.worldToLocal(node.getWorldPosition(point()));
          const axis=spec.recipe==='octopod'?point().set(local.x,0,local.z).normalize():point().set(sign,0,0);
          const origin=frame.localToWorld(local.clone().addScaledVector(axis,20));
          const direction=axis.clone().negate().transformDirection(frame.matrixWorld);
          const hit=new T.Raycaster(origin,direction,0,100).intersectObjects(body,false)[0];
          if(!hit)continue;
          const surface=frame.worldToLocal(hit.point.clone());
          const exposed=local.clone().sub(surface).dot(axis);exposures[name]=exposed;
          const corrected=frame.localToWorld(local.clone().addScaledVector(axis,Math.max(0,.12-exposed)));
          node.parent.worldToLocal(corrected);
          check(exposed>=.045,`${form}/${name} embedded in body: ${exposed}; parent-space correction=${corrected.toArray()}`);
        }
        let maximumContactError=0,maximumScaleError=0;
        const wings=[];
        const renderImage=(name,neutral=false)=>{
          const hidden=[];
          if(neutral){
            unit.traverse(node=>{
              if(node.visible&&(node.userData.isOutline||node.userData.presentationEffect)){hidden.push(node);node.visible=false;}
            });
            scene.overrideMaterial=clay;
          }
          renderer.render(scene,camera);pictures[name]=renderer.domElement.toDataURL('image/png').split(',')[1];
          scene.overrideMaterial=null;for(const node of hidden)node.visible=true;
        };
        const capture=(name,neutral=false)=>{
          const bounds=new T.Box3().setFromObject(active),center=bounds.getCenter(point()),span=Math.max(...bounds.getSize(point()).toArray());
          for(const [view,offset]of Object.entries({front:[0,.16,2.3],side:[2.3,.15,0],back:[0,.16,-2.3],top:[0,2.6,.01],oblique:[1.5,.65,1.9]})){
            if(name!=='idle' && view!=='oblique')continue;
            camera.position.copy(center).add(point().fromArray(offset).multiplyScalar(span));camera.lookAt(center);
            renderImage(form+'-'+name+(neutral?'-neutral':'')+'-'+view,neutral);
          }
        };
        scene.add(unit);capture('idle');capture('idle',true);
        for(const held of rig.anatomical?.grips || []){
          const center=held.grip.getWorldPosition(point()),box=new T.Box3().setFromObject(held.grip);
          const span=Math.max(...box.getSize(point()).toArray(),.3),sign=Math.sign(held.node.parent.getWorldPosition(point()).x) || 1;
          camera.position.copy(center).add(point().set(sign*1.55,.55,1.85).multiplyScalar(span));camera.lookAt(center);
          renderImage(form+'-grip-'+held.node.name);
          renderImage(form+'-grip-neutral-'+held.node.name,true);
        }
        for(const action of ['run','light','heavy','shield']){
          delete ent.fireFx;delete ent.heavyFx;ent.df=action==='shield';
          const speed=action==='run'?(rig.top || 10):0;
          let lastShot=-Infinity;
          let animationCamera,animationCenter;
          for(let frame=0;frame<360;frame++){
            if(['light','heavy'].includes(action)&&now-lastShot>=1/heroWeapon(id,action).rate){ent.fireFx={t0:now,slot:action};lastShot=now;}
            tick(speed);
            unit.traverse(node=>check(node.matrixWorld.elements.every(Number.isFinite),'Nonfinite '+node.name));
            for(const held of rig.anatomical?.grips || []){
              const hand=held.node.parent,contact=hand.localToWorld(held.contact.clone());
              const error=contact.distanceTo(held.grip.getWorldPosition(point()));maximumContactError=Math.max(maximumContactError,error);
              check(error<1e-4,'Hand leaves '+held.node.name+' grip by '+error);
              const scale=held.grip.getWorldScale(point()),parentScale=hand.getWorldScale(point());
              const scaleError=scale.distanceTo(parentScale);maximumScaleError=Math.max(maximumScaleError,scaleError);
              check(scaleError<1e-4,'Hand scales with stowed weapon');
              const angle=held.grip.getWorldQuaternion(new T.Quaternion()).angleTo(held.node.getWorldQuaternion(new T.Quaternion()));
              check(angle<1e-5,'Fist twists across the grip');
            }
            if(action==='run' && rig.wings?.some(w=>w.hand)){
              wings.push(rig.wings.filter(w=>w.hand).map(w=>[w.w.rotation.z*w.sgn,w.outer.rotation.y*w.sgn,w.hand.rotation.y*w.sgn,w.hand.rotation.x]));
              if(frame>=240 && frame%15===0){
                capture('cycle-'+((frame-240)/15));capture('cycle-'+((frame-240)/15),true);
              }
              if(frame>=240 && frame%2===0){
                if(!animationCamera){
                  const box=new T.Box3().setFromObject(active),span=Math.max(...box.getSize(point()).toArray());
                  animationCenter=box.getCenter(point());
                  animationCamera=animationCenter.clone().add(point().set(1.5,.65,1.9).multiplyScalar(span*1.15));
                }
                camera.position.copy(animationCamera);camera.lookAt(animationCenter);
                renderImage(form+'-animation-'+((frame-240)/2)+'-oblique');
                renderImage(form+'-animation-neutral-'+((frame-240)/2)+'-oblique',true);
              }
            }
          }
          capture(action);
        }
        const wingRanges=[];
        if(wings.length)for(let i=0;i<wings[0].length;i++){
          const ranges=[0,1,2,3].map(axis=>Math.max(...wings.map(f=>f[i][axis]))-Math.min(...wings.map(f=>f[i][axis])));
          check(ranges.slice(0,3).every(v=>v>.045),'Humerus/ulna/manus chain remains rigid');
          const up=[],down=[];
          for(let frame=1;frame<wings.length;frame++)(wings[frame][i][0]>wings[frame-1][i][0]?up:down).push(wings[frame][i][1]);
          const average=a=>a.reduce((s,v)=>s+v,0)/a.length;
          check(average(up)>average(down),'Elbow folds on the power stroke');
          wingRanges.push(ranges);
        }
        metrics[form]={exposures,maximumContactError,maximumScaleError,wingRanges,frames:1440};
        scene.remove(unit);disposeTree(unit);
      }
      clay.dispose();renderer.dispose();return {metrics,pictures};
    },{id,spec:specs[id]});
    for(const [name,bytes]of Object.entries(result.pictures))await writeFile(`${output}/${id}-${name}.png`,Buffer.from(bytes,'base64'));
    const hashes={};
    for(const file of [`public/js/forge/assets/${id}.js`,`public/assets/models/reference/${id}.glb`])hashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
    results[id]={...result.metrics,hashes};console.log('Attachments verified '+id);
  }
  assert.equal(errors.length,0,errors.join('\n'));
  await writeFile(output+'/validation.json',JSON.stringify({assets:results,gates:{structure:'pass',motion:'pass',independentExport:'pass',visual:'pending_image_inspection'}},null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
