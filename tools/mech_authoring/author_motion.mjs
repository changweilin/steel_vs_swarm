// Sample the shipped solver instead of maintaining a second Blender locomotion implementation.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromiumOrNull, chromePath } from '../pw.mjs';
import { serve } from '../mech_prompt_review.mjs';
import { CHARACTERS } from '../../public/js/data.js';
import { blenderMcp } from './mcp.mjs';
import path from 'node:path';

const baseline = process.argv.includes('--baseline');
const selected = process.argv.indexOf('--asset');
const ids = selected < 0 ? Object.keys(CHARACTERS) : process.argv[selected + 1].split(',');
const output = 'out/anatomical_motion/' + (baseline ? 'before' : 'after');
const files = ['locomotion.js', 'anatomicalPose.js', 'forge/referenceAsset.js', 'gaitcurve.js', 'unitMotion.js'];
const sources = {};
for (const file of files) {
  if (baseline && file === 'anatomicalPose.js') continue;
  sources[file] = baseline ? execFileSync('git',['show','HEAD:public/js/'+file],{encoding:'utf8'})
    : await readFile('public/js/'+file,'utf8');
}
await mkdir(output, {recursive:true});
const server = serve(0, {threeModule:process.env.THREE_MODULE || 'out/forest_review/three.module.js'});
await new Promise(resolve => server.listening ? resolve() : server.once('listening',resolve));
const chromium = await chromiumOrNull();
if (!chromium) throw new Error('Motion authoring requires the existing browser runtime');
let browser;
try {
  browser = await chromium.launch({headless:true,executablePath:chromePath(),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport:{width:1000,height:800}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({contentType:'text/css',body:''}));
  if (baseline) for (const [file,body] of Object.entries(sources)) {
    await page.route('**/public/js/'+file,route=>route.fulfill({contentType:'text/javascript',body}));
  }
  await page.goto(`http://127.0.0.1:${server.address().port}/?mech=t01`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__MECH_REVIEW?.preview?.unit);
  await page.evaluate(()=>window.__MECH_REVIEW.preview.stop());
  await page.evaluate(async()=>{
    const THREE=await import('three');
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    renderer.setSize(1000,800);renderer.setClearColor(0x18212e);
    document.body.replaceChildren(renderer.domElement);
    const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x617086,3));
    const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(6,10,8);scene.add(light);
    window.motion={THREE,renderer,scene,camera:new THREE.PerspectiveCamera(38,1.25,.1,100)};
  });
  const results={};
  for (const id of ids) {
    const sampled=await page.evaluate(async id=>{
      const {makeUnit}=await import('/public/js/models.js');
      const {CHARACTERS,charKind}=await import('/public/js/data.js');
      const {stepLocomotion,stepCombatFx}=await import('/public/js/locomotion.js');
      const {disposeTree}=await import('/public/js/toon.js');
      const {THREE,scene,camera,renderer}=window.motion;
      if(window.motion.unit){scene.remove(window.motion.unit);disposeTree(window.motion.unit);}
      const clips={},metrics={},pictures={};
      for(const form of charKind(id)==='morph'?['ground','flight']:['ground']) {
        for(const action of ['idle','run','light','heavy']) {
          const unit=makeUnit(`hero:${charKind(id)}`,CHARACTERS[id].side,{ring:false,ch:id}).group;
          const ent={id,mesh:unit,sp:1,heroY:form==='flight'?5:0,flies:charKind(id)==='drone'};
          let now=0;
          const speed=action==='run'?(unit.userData.rig.top||10):0;
          const tick=(speed,slot)=>{
            now+=1/60;
            if(slot)ent.fireFx={t0:now,slot};
            stepCombatFx(ent,now,1/60);stepLocomotion(ent,1/60,now,0,-speed/60,0);unit.updateMatrixWorld(true);
          };
          for(let i=0;i<240;i++)tick(speed, ['light','heavy'].includes(action)?action:null);
          const rig=unit.userData.rig;
          const frameCount=action==='idle'&&rig.tailSegs?.length>1?360:240;
          let authored;
          const active=unit.userData.morph?(form==='flight'?unit.userData.morph.ag:unit.userData.morph.gg):unit;
          active.traverse(node=>{if(node.userData.referenceAsset?.id===id)authored??=node;});
          const nodes=[];authored.traverse(node=>{if(node.isBone && !node.name.startsWith('fx_'))nodes.push(node);});
          if(!nodes.length)throw new Error(id+': authored joint inventory missing');
          const name=(form==='flight'?'flight_':'')+action;
          const box=new THREE.Box3().setFromObject(unit),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),span=Math.max(size.x,size.y,size.z);
          camera.position.copy(center).add(new THREE.Vector3(span*1.25,size.y*.6,span*1.6));camera.lookAt(center);
          const frames=[];
          const head=rig.anatomical?.head || rig.head || authored.getObjectByName('sensor');
          const ranges={},start=head?.getWorldQuaternion(new THREE.Quaternion());
          let headAngle=0,forward=1,forearm=1;
          for(let frame=0;frame<=frameCount;frame++) {
            tick(speed,['light','heavy'].includes(action)?action:null);
            frames.push(nodes.map(node=>[node.name,node.position.toArray(),node.quaternion.toArray(),node.scale.toArray()]));
            for(const node of nodes) {
              if(!node.matrixWorld.elements.every(Number.isFinite))throw new Error(id+': nonfinite '+node.name);
              const row=ranges[node.name]??={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
              node.rotation.toArray().slice(0,3).forEach((v,i)=>{row.min[i]=Math.min(row.min[i],v);row.max[i]=Math.max(row.max[i],v);});
            }
            if(head)headAngle=Math.max(headAngle,start.angleTo(head.getWorldQuaternion(new THREE.Quaternion())));
            if(['light','heavy'].includes(action)) {
              const weapon=rig.wpn[action],axis=weapon.fwd;
              const direction=new THREE.Vector3(axis.endsWith('x')?1:0,axis.endsWith('y')?1:0,axis.endsWith('z')?1:0);
              if(axis.startsWith('-'))direction.negate();
              direction.applyQuaternion(weapon.ref.getWorldQuaternion(new THREE.Quaternion()));forward=Math.min(forward,direction.z);
              const shot=rig.anatomical?.shots[action];
              if(shot?.hand)forearm=Math.min(forearm,shot.hand.getWorldPosition(new THREE.Vector3()).sub(shot.elbow.getWorldPosition(new THREE.Vector3())).normalize().dot(direction));
            }
            if(frame%30===0 && (rig.wings?.some(w=>w.hand) || rig.anatomical?.shots[action]) && action!=='idle') {
              scene.add(unit);renderer.render(scene,camera);scene.remove(unit);
              pictures[name+'-'+frame]=renderer.domElement.toDataURL('image/png').split(',')[1];
            }
          }
          clips[name]={fps:60,frames};
          metrics[name]={headAngle,forward,forearm,ranges:Object.fromEntries(Object.entries(ranges).map(([key,value])=>[key,value.max.map((v,i)=>v-value.min[i])]))};
          if(form==='ground'&&action==='run') {
            const box=new THREE.Box3().setFromObject(unit),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),span=Math.max(size.x,size.y,size.z);
            camera.position.copy(center).add(new THREE.Vector3(span*1.25,size.y*.6,span*1.6));camera.lookAt(center);
            scene.add(unit);renderer.render(scene,camera);scene.remove(unit);
            pictures['run-overview']=renderer.domElement.toDataURL('image/png').split(',')[1];
          }
          disposeTree(unit);
        }
      }
      return {id,clips,metrics,pictures};
    },id);
    const {pictures,...motion}=sampled;
    await writeFile(`${output}/${id}.json`,JSON.stringify(motion));
    for(const [name,bytes] of Object.entries(pictures))await writeFile(`${output}/${id}-${name}.png`,Buffer.from(bytes,'base64'));
    results[id]=sampled.metrics;
    await writeFile(`${output}/${id}.png`,Buffer.from(pictures['run-overview'],'base64'));
    console.log('Sampled '+id);
  }
  if(errors.length)throw new Error(errors.join('\n'));
  const hashes=Object.fromEntries(Object.entries(sources).map(([file,source])=>[file,createHash('sha256').update(source).digest('hex')]));
  let previous={};
  try{previous=JSON.parse(await readFile(`${output}/validation.json`,'utf8')).metrics;}catch{}
  await writeFile(`${output}/validation.json`,JSON.stringify({sources:hashes,metrics:{...previous,...results}},null,2));
} finally {
  await browser?.close();await new Promise(resolve=>server.close(resolve));
}
if (!baseline && process.argv.includes('--bake')) {
  const script=path.resolve('tools/mech_authoring/bake_motion.py');
  const promptIndex=process.argv.indexOf('--user-prompt');
  const userPrompt=promptIndex<0?'Inspect and adjust authored creature motion in Blender':process.argv[promptIndex+1];
  const code=`import bpy, subprocess\nr=subprocess.run([bpy.app.binary_path,'--background','--factory-startup','--python-exit-code','1','--python',${JSON.stringify(script)},'--',*${JSON.stringify(ids)}],capture_output=True,text=True,encoding='utf8',errors='replace',timeout=600,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))\nif r.returncode: raise RuntimeError(r.stdout[-4000:]+r.stderr[-4000:])\nprint('\\n'.join(line for line in r.stdout.splitlines() if line.startswith('MOTION_BAKED ')))`;
  const result=await blenderMcp('execute_blender_code',{code,user_prompt:userPrompt},650000);
  for(const item of result.content||[])if(item.type==='text'){
    if(/Traceback|Error executing|error_type/.test(item.text))throw new Error(item.text);
    console.log(item.text);
  }
}
