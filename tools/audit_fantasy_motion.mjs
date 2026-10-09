// Exact shipped creature joints must preserve grasp contacts, head stability and reversible morphs.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromiumOrNull, chromePath } from './pw.mjs';
import { serve } from './mech_prompt_review.mjs';

const output = 'out/fantasy_refinement';
await mkdir(output,{recursive:true});
const identities = {};
for (const id of ['m05','s06','t08']) identities[id] = createHash('sha256')
  .update(await readFile(`public/assets/models/reference/${id}.glb`)).digest('hex');
const server = serve(0);
await new Promise(resolve => server.listening ? resolve() : server.once('listening',resolve));
const chromium = await chromiumOrNull();
assert(chromium,'Existing Playwright runtime required');
let browser;
try {
  browser = await chromium.launch({headless:true,executablePath:chromePath(),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport:{width:800,height:650}});
  const errors = [];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({contentType:'text/css',body:''}));
  await page.goto(`http://127.0.0.1:${server.address().port}/?mech=s06`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__MECH_REVIEW?.preview?.unit);
  const measurements = await page.evaluate(async()=>{
    const THREE = await import('three');
    const {GLTFLoader} = await import('three/addons/loaders/GLTFLoader.js');
    const {makeUnit} = await import('/public/js/models.js');
    const {CHARACTERS,charKind} = await import('/public/js/data.js');
    const {stepLocomotion,stepCombatFx} = await import('/public/js/locomotion.js');
    const {disposeTree} = await import('/public/js/toon.js');
    const result = {runtime:{},exports:{}};
    const check = (value,label)=>{if(!value)throw new Error(label);};
    const vector = ()=>new THREE.Vector3();
    for(const id of ['m05','s06','t08']){
      result.runtime[id] = [];
      for(const fps of [30,60,144]){
        const unit = makeUnit(`hero:${charKind(id)}`,CHARACTERS[id].side,{ring:false,ch:id}).group;
        const ent = {id,mesh:unit,sp:1,heroY:0};
        let now = 0;
        const step=(speed=0,turn=0)=>{
          now+=1/fps;stepCombatFx(ent,now,1/fps);
          stepLocomotion(ent,1/fps,now,0,-speed/fps,-turn/fps);unit.updateMatrixWorld(true);
        };
        for(let i=0;i<fps*2;i++)step(5);
        const rig=unit.userData.rig,measure={fps};
        let contact=0,headDrift=0,clawPitch=0;
        const head=unit.getObjectByName('sensor'),anchor=head?.getWorldPosition(vector());
        const wave=[];
        for(let i=0;i<fps*3;i++){
          if(i===fps)ent.fireFx={slot:'light',t0:now};
          step(5,i<fps?0:.8);
          if(id==='s06'){
            const a=rig.archery;
            contact=Math.max(contact,a.hand.getWorldPosition(vector()).distanceTo(a.nock.getWorldPosition(vector())));
            check(contact<.015,'s06: drawing hand lost bowstring contact: '+JSON.stringify({gap:contact,
              shoulder:a.shoulder.getWorldPosition(vector()).toArray(),nock:a.nock.getWorldPosition(vector()).toArray(),
              hand:a.hand.getWorldPosition(vector()).toArray(),upper:a.elbow.position.toArray(),lower:a.hand.position.toArray()}));
          }
          if(id==='t08'){
            headDrift=Math.max(headDrift,head.getWorldPosition(vector()).distanceTo(anchor));
            check(headDrift<1e-5,'t08: leading head oscillates: '+headDrift);
            wave.push(rig.axialWave.chain[12].rotation.y);
            check(rig.axialWave.chain.length>16,'t08: axial chain not refined');
          }
          if(id==='m05'){
            check(rig.predatory.hunch.rotation.x>.45,'m05: hunch lost');
            check(rig.armL.rotation.x<-.5 && rig.armR.rotation.x<-.5,'m05: claw arms became gait swing');
            clawPitch=rig.armL.rotation.x;
          }
          unit.traverse(n=>check(n.matrixWorld.elements.every(Number.isFinite),id+': nonfinite '+n.name));
        }
        if(id==='t08')check(Math.max(...wave)-Math.min(...wave)>.12,'t08: body wave frozen');
        if(id==='m05'){
          ent.heroY=5;for(let i=0;i<fps*3;i++)step(5);
          check(unit.userData.rig.kind==='aerial','m05: flight endpoint failed');
          check(!unit.userData.rig.predatory,'m05: ground claw pose leaks into flight');
          ent.heroY=0;for(let i=0;i<fps*3;i++)step(0);
          check(unit.userData.rig.kind==='biped','m05: ground recovery failed');
        }
        Object.assign(measure,{handStringGap:contact,headDrift,clawPitch});
        result.runtime[id].push(measure);disposeTree(unit);
      }
      const gltf = await new GLTFLoader().loadAsync(`/public/assets/models/reference/${id}.glb`);
      const scene=gltf.scene,mixer=new THREE.AnimationMixer(scene);
      const clips=gltf.animations.map(a=>a.name);
      let headDrift=0,handGap=0,loopChange=0;
      for(const name of id==='m05'?['run','to_flight','to_ground','flight_idle']:['run','light']){
        mixer.stopAllAction();const clip=THREE.AnimationClip.findByName(gltf.animations,name);
        check(clip,'Missing exact-export clip '+id+'/'+name);
        mixer.clipAction(clip).play();
        let anchor;
        for(let i=0;i<=60;i++){
          mixer.setTime(clip.duration*i/60);scene.updateMatrixWorld(true);
          if(id==='t08'){
            const p=scene.getObjectByName('sensor').getWorldPosition(vector());anchor??=p.clone();
            headDrift=Math.max(headDrift,p.distanceTo(anchor));
            check(headDrift<1e-4,'t08: exported head wobbles');
          }
          if(id==='s06'){
            const wrist=scene.getObjectByName('wrist_l'),nock=scene.getObjectByName('bow_nock');
            handGap=Math.max(handGap,wrist.getWorldPosition(vector()).distanceTo(nock.getWorldPosition(vector())));
            check(handGap<.04,`s06: exported hand loses string in ${name} sample ${i}: ${handGap}`);
          }
        }
        loopChange+=clip.tracks.length;
      }
      result.exports[id]={clips,headDrift,handGap,animatedTracks:loopChange};
      disposeTree(scene);
    }
    window.fantasy={THREE,GLTFLoader,makeUnit,CHARACTERS,charKind,stepLocomotion,stepCombatFx};
    return result;
  });
  assert.deepEqual(errors,[]);
  for(const [id,clip] of [['m05','run'],['s06','light'],['t08','run']]){
    const evidence = await page.evaluate(async({id,clip})=>{
      const {THREE,GLTFLoader,makeUnit,CHARACTERS,charKind,stepLocomotion,stepCombatFx}=window.fantasy;
      const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
      renderer.setSize(520,420);renderer.setClearColor(0x202832);
      const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x637088,3));
      const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(5,9,7);scene.add(light);
      const camera=new THREE.PerspectiveCamera(36,520/420,.1,100);
      const sheet=document.createElement('canvas');sheet.width=520*4;sheet.height=450*2;
      const context=sheet.getContext('2d');context.fillStyle='#202832';context.fillRect(0,0,sheet.width,sheet.height);
      const unit=makeUnit(`hero:${charKind(id)}`,CHARACTERS[id].side,{ring:false,ch:id}).group;
      const ent={id,mesh:unit,sp:1,heroY:0};scene.add(unit);
      let now=0;
      const step=(speed)=>{now+=1/60;stepCombatFx(ent,now,1/60);stepLocomotion(ent,1/60,now,0,-speed/60,0);unit.updateMatrixWorld(true);};
      for(let i=0;i<180;i++)step(id==='t08'?8:5);
      const box=new THREE.Box3().setFromObject(unit),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
      const span=Math.max(size.x,size.y,size.z);
      camera.position.copy(center).add(id==='t08'?new THREE.Vector3(span*.3,span*1.5,span*.8):new THREE.Vector3(span*1.5,span*.55,span*.75));
      camera.lookAt(center);
      const period=id==='t08'?1/unit.userData.rig.axialWave.frequency:1.2;
      const frames=[];
      if(id==='s06')ent.fireFx={slot:'light',t0:now};
      for(let i=0;i<8;i++){
        for(let k=0;k<Math.round(period*60/8);k++)step(id==='t08'?8:5);
        renderer.render(scene,camera);
        context.drawImage(renderer.domElement,(i%4)*520,Math.floor(i/4)*450);
        context.fillStyle='#edf4ff';context.font='18px sans-serif';context.fillText(`${id} ${clip} - ${(i*period/8).toFixed(2)}s`,(i%4)*520+15,Math.floor(i/4)*450+442);
        frames.push(renderer.domElement.toDataURL('image/png').split(',')[1]);
      }
      renderer.dispose();return {sheet:sheet.toDataURL('image/png').split(',')[1],frames};
    },{id,clip});
    await writeFile(`${output}/${id}-cycle.png`,Buffer.from(evidence.sheet,'base64'));
    for(let i=0;i<evidence.frames.length;i++)await writeFile(`${output}/${id}-frame-${i}.png`,Buffer.from(evidence.frames[i],'base64'));
  }
  await writeFile(`${output}/motion-validation.json`,JSON.stringify({identities,measurements},null,2));
  console.log(JSON.stringify(measurements));
} finally {
  await browser?.close();await new Promise(resolve=>server.close(resolve));
}
