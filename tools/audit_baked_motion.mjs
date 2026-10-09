// Exact GLB tracks must reproduce sampled authored joint transforms after independent import.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromiumOrNull, chromePath } from './pw.mjs';
import { serve } from './mech_prompt_review.mjs';
import { CHARACTERS } from '../public/js/data.js';

const output='out/anatomical_motion/after',ids=[];
const samples={};
for(const id of Object.keys(CHARACTERS)){
  let report;
  for(const directory of ['morph_reference','mech_reference']){
    try{report=JSON.parse(await readFile(`out/${directory}/${id}/validation.json`,'utf8'));break;}catch{}
  }
  if(!report?.motionSource)continue;
  samples[id]=JSON.parse(await readFile(`${output}/${id}.json`,'utf8'));
  samples[id].clips=Object.fromEntries(Object.entries(samples[id].clips).filter(([clip])=>report.motionSource.clips.includes(clip)));
  samples[id].nodes=report.motionSource.nodes;
  ids.push(id);
}
const server=serve(0,{threeModule:process.env.THREE_MODULE||'out/forest_review/three.module.js'});
await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
const chromium=await chromiumOrNull();
assert(chromium,'Baked-motion verification requires the existing browser runtime');
let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:chromePath(),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage();
  await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({contentType:'text/css',body:''}));
  await page.goto(`http://127.0.0.1:${server.address().port}/?mech=t01`,{waitUntil:'domcontentloaded'});
  const result={};
  for(const id of ids){
    result[id]=await page.evaluate(async sample=>{
      const THREE=await import('three');
      const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
      const gltf=await new GLTFLoader().loadAsync(`/public/assets/models/reference/${sample.id}.glb`);
      const mixer=new THREE.AnimationMixer(gltf.scene);
      const expected=new THREE.Quaternion(),position=new THREE.Vector3();
      let count=0,drift=0,angular=0;
      for(const [name,data] of Object.entries(sample.clips)){
        const clip=gltf.animations.find(clip=>clip.name===name);
        if(!clip)throw new Error(sample.id+': missing exported clip '+name);
        mixer.stopAllAction();const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
        for(let frame=0;frame<data.frames.length;frame+=6){
          // Blender action keys start at frame one, which glTF retains as a positive time.
          mixer.setTime((frame+1)/data.fps);
          for(const [name,at,q] of data.frames[frame]){
            if(name.startsWith('fx_'))continue;
            const node=gltf.scene.getObjectByName(name);
            if(!node)throw new Error(sample.id+': missing exported joint '+name);
            const distance=node.position.distanceTo(position.fromArray(at));
            const angle=node.quaternion.angleTo(expected.fromArray(q));
            if(distance>2e-4||angle>2e-3)throw new Error(`${sample.id}/${clip.name}/${frame}/${name}: export drift ${distance}, rotation ${angle}`);
            drift=Math.max(drift,distance);angular=Math.max(angular,angle);count++;
          }
        }
      }
      mixer.stopAllAction();mixer.uncacheRoot(gltf.scene);
      gltf.scene.traverse(node=>{if(node.isMesh){node.geometry.dispose();for(const material of [node.material].flat())material.dispose();}});
      return {jointSamples:count,maximumPivotError:drift,maximumAngularError:angular};
    },samples[id]);
    console.log('GLB motion verified '+id);
  }
  await writeFile(`${output}/export-validation.json`,JSON.stringify(result,null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
