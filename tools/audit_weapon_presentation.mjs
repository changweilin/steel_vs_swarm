// Accepted shot events own emitter selection; render frequency and form swaps cannot consume rounds.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromiumOrNull,chromePath} from './pw.mjs';
import {serve} from './mech_prompt_review.mjs';
import {readSrc,grabMethod,grabConst} from './audit_src.mjs';
const output='out/weapon_revision/runtime';await mkdir(output,{recursive:true});
const specs={};for(const file of ['assets.json','morphers.json'])Object.assign(specs,JSON.parse(await readFile('tools/mech_authoring/'+file)).assets);
const arg=process.argv.indexOf('--asset'),ids=arg<0?Object.keys(specs):process.argv[arg+1].split(',');
const focused=new Set(['t08','m04','s03','t06','m05','m08']);
const server=serve(0,{threeModule:'out/forest_review/three.module.js'});
await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
const results={};let browser;
try{
  const chromium=await chromiumOrNull();assert(chromium,'Existing Playwright runtime required');
  browser=await chromium.launch({headless:true,executablePath:chromePath(),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:900,height:720}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({contentType:'text/css',body:''}));
  const clientSource=readSrc('public','js','game.js');
  const hudConstants=clientSource.slice(clientSource.indexOf('const HUD_BOTTOM_F ='),clientSource.indexOf('export const COCKPIT ='));
  // Exercise the production methods without pulling unrelated postprocessing add-ons into the offline review server.
  await page.route('**/audit-client.js',route=>route.fulfill({contentType:'text/javascript',body:
    "import * as THREE from 'three';import {fireReferenceWeapon} from '/public/js/unitMotion.js';"+hudConstants+grabConst(clientSource,'COCKPIT')+"export class BattleClient {"+['_selfMuzzle','_markFire','_cloneWpnSet','_cockpitEmission','_syncCockpitWeapon'].map(name=>grabMethod(clientSource,name)).join('\n')+'}'}));
  await page.goto(`http://127.0.0.1:${server.address().port}/?mech=${ids[0]}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__MECH_REVIEW?.preview?.unit);await page.evaluate(()=>window.__MECH_REVIEW.preview.stop());
  for(const id of ids){
    const result=await page.evaluate(async({id,spec,visual})=>{
      const T=await import('three');
      const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
      const {makeUnit}=await import('/public/js/models.js');
      const {CHARACTERS,charKind,heroWeapon}=await import('/public/js/data.js');
      const {stepLocomotion,stepCombatFx}=await import('/public/js/locomotion.js');
      const {fireReferenceWeapon}=await import('/public/js/unitMotion.js');
      const {lanceDischarge}=await import('/public/js/vfx.js');
      const {BattleClient}=await import('/audit-client.js');
      const {disposeTree}=await import('/public/js/toon.js');
      const check=(ok,why)=>{if(!ok)throw Error(id+': '+why);};
      const V=()=>new T.Vector3(),Q=()=>new T.Quaternion();
      const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(420,420);renderer.setClearColor(0x152033);
      renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.8;
      const scene=new T.Scene();scene.add(new T.HemisphereLight(0xffffff,0x667a94,2));
      const light=new T.DirectionalLight(0xffffff,2);light.position.set(6,10,8);scene.add(light);
      const camera=new T.PerspectiveCamera(38,1,.1,150),clay=new T.MeshStandardMaterial({color:0x9faebc,roughness:.8});
      const pictures={},forms={},effects=[],loaded=await new GLTFLoader().loadAsync('/public/assets/models/reference/'+id+'.glb');
      const {default:asset}=await import('/public/js/forge/assets/'+id+'.js');
      for(const entries of Object.values(asset.rig.weaponSequences))for(const entry of entries)check(loaded.scene.getObjectByName(entry.muzzle),'GLB lost actual emitter');
      disposeTree(loaded.scene);
      for(const form of spec.forms?['ground','flight']:['ground']){
        const unit=makeUnit('hero:'+charKind(id),CHARACTERS[id].side,{ring:false,ch:id}).group;scene.add(unit);
        const ent={id,pid:id,mesh:unit,sp:1,isSelf:true,heroY:form==='flight'?5:0,flies:charKind(id)==='drone'};let now=0;
        const owners=unit.userData.morph?[unit.userData.morph.ground,unit.userData.morph.air]:[unit.userData.rig];
        const tick=(dt=1/60,speed=0)=>{now+=dt;stepCombatFx(ent,now,dt);stepLocomotion(ent,dt,now,0,-speed*dt,0);unit.updateMatrixWorld(true);unit.traverse(n=>check(n.matrixWorld.elements.every(Number.isFinite),'Nonfinite '+n.name));for(let i=effects.length-1;i>=0;i--){const effect=effects[i];effect.remaining=(effect.remaining??effect.ttl)-dt;if(effect.remaining<=0){scene.remove(effect.obj);if(effect.dispose)effect.dispose();else disposeTree(effect.obj);effects.splice(i,1);}else effect.fade?.(effect.obj,effect.remaining/effect.ttl,dt);}};
        for(let i=0;i<240;i++)tick();
        const rig=unit.userData.rig,active=unit.userData.morph?(form==='flight'?unit.userData.morph.ag:unit.userData.morph.gg):unit;
        const client=Object.assign(Object.create(BattleClient.prototype),{ents:new Map([[id,ent]]),viewMode:'tps',_eyeH:()=>1,bodyYaw:0,pos:V(),camera:new T.PerspectiveCamera(),flash:new T.Group()});
        const events={light:0,heavy:0},ports={};
        const shoot=slot=>{
          const sequence=rig.weaponSequences[slot],next=(sequence.index+1)%sequence.entries.length;
          const origin=BattleClient.prototype._selfMuzzle.call(client,null,100,slot);
          check(origin.distanceTo(sequence.entries[next].muzzle.getWorldPosition(V()))<1e-6,'TPS origin misses next physical port');
          BattleClient.prototype._markFire.call(client,id,slot,now,null,true);events[slot]++;
          for(const owner of owners){fireReferenceWeapon(owner,ent.fireFx);fireReferenceWeapon(owner,ent.fireFx);}
          check(sequence.index===(events[slot]-1)%sequence.entries.length,'Emitter count drift');
          check(sequence.entries[sequence.index].muzzle===rig.wpn[slot].muz,'Flash uses inactive port');
          check(owners.every(owner=>owner.weaponSequences[slot].index===sequence.index),'Form selection restarts sequence');
          return sequence.entries[next];
        };
        for(const slot of ['light','heavy']){
          const sequence=rig.weaponSequences[slot];check(sequence?.entries.length>0,'Missing '+slot+' sequence');
          ports[slot]=sequence.entries.map(entry=>entry.muzzle.name);
          check(new Set(ports[slot]).size===ports[slot].length,'Duplicated physical port');
          if(sequence.entries.length>1){const points=sequence.entries.map(entry=>entry.muzzle.getWorldPosition(V()));check(points.every((p,i)=>points.every((q,j)=>i===j||p.distanceTo(q)>.005)),'Collapsed multi-barrel origins');}
          for(let i=0;i<sequence.entries.length*2+3;i++)shoot(slot);
          const index=sequence.index;for(const fps of [30,60,144])for(let i=0;i<fps/2;i++)tick(1/fps);
          check(sequence.index===index,'Render frames consume rounds');
          const cloned=BattleClient.prototype._cloneWpnSet.call(client,rig.wpn[slot],sequence.entries.map(entry=>entry.muzzle)),wrap=cloned.grp;
          wrap.userData.emissionMuzzles={[slot]:sequence.entries.map(entry=>cloned.pairs.get(entry.muzzle))};
          check(wrap.userData.emissionMuzzles[slot].every(Boolean),'Production cockpit clone lost a firing port');
          client.gunGroup=new T.Group();client.gunGroup.add(wrap);client._muzzle=V();client.viewMode='fpv';
          const selected=wrap.userData.emissionMuzzles[slot][(index+1)%sequence.entries.length];
          check(BattleClient.prototype._selfMuzzle.call(client,null,100,slot).distanceTo(selected.getWorldPosition(V()))<1e-6,'FPV selects different barrel');
          wrap.visible=false;
          check(BattleClient.prototype._selfMuzzle.call(client,null,100,slot).distanceTo(selected.getWorldPosition(V()))<1e-6,'Scope hiding changes firing port');
          wrap.visible=true;
          const payloads=sequence.entries.map(entry=>entry.payload).filter(Boolean);
          wrap.userData.weaponPresentation=payloads.map(source=>({name:source.name,target:cloned.pairs.get(source)}));
          client.viewMode='tps';shoot(slot);client.viewMode='fpv';
          for(const pair of wrap.userData.weaponPresentation)pair.target.scale.setScalar(1);
          client.aiming=slot==='heavy';client.wdef={heavy:true};client._syncCockpitWeapon();
          for(const pair of wrap.userData.weaponPresentation)check(pair.target.scale.distanceTo(rig.combat.nodes.get(pair.name).scale)<1e-7,'FPV rack ignores ejection');
          const last=wrap.userData.emissionMuzzles[slot][sequence.index];
          check(client.flash.position.distanceTo(client.gunGroup.worldToLocal(last.getWorldPosition(V())))<1e-6,'Frame update resets flash to first barrel');
          client.aiming=false;
          client.viewMode='tps';
        }
        const inventory=[];active.traverse(n=>{if(n.userData.authoredParts)inventory.push(...n.userData.authoredParts);});
        if(id==='t08'){check(ports.light.length===2,'Dragon must fire from both eyes');check(!inventory.some(n=>/^Light weapon|Independent forearm gun/.test(n)),'Dragon retained gun mesh');check(['cast_dish','emitter_l','emitter_r'].every(n=>/body_/.test(active.getObjectByName(n).parent.name)),'Dragon hardware remains on static tilt');}
        if(id==='m04'){check(ports.heavy.length===4,'Falcon needs four missiles');check(rig.weaponSequences.heavy.entries.every(e=>e.payload),'Missile is not individually ejectable');const fired=shoot('heavy');check(fired.payload.scale.x===.001,'Selected missile remains on rack');}
        if(id==='s03'){check(rig.wpn.light.ref.parent.name==='trunk_5','Leviathan fires away from terminal horn');check(rig.combat.charging?.length===1,'Intertusk induction missing');ent.heavyFx={phase:'charge',t0:now};for(let i=0;i<30;i++)tick();check(rig.combat.nodes.get('fx_heavy_induction').scale.y>.3,'Tusks do not charge');ent.heavyFx=null;}
        if(id==='t06'){check(!!rig.hairFlick,'Hair gesture missing');check(!inventory.some(n=>/Micro silent|Micro chest gun/.test(n)),'Wukong retains firearm');check(rig.wpn.light.muz.parent===rig.hairFlick.middle,'Emission does not follow flicking digit');}
        if(id==='m08')check(ports.light.length===2&&ports.heavy.length===2,'M08 paired weapons missing');
        for(let i=0;i<180;i++)tick();ent.fireFx=null;
        const armRanges={};if(id==='m05'&&form==='ground'){
          check(rig.knuckle,'Wolf lost primate support gait');
          for(const side of ['L','R']){const values=[];for(let i=0;i<180;i++){tick(1/60,rig.top);values.push(rig['arm'+side].rotation.x);}armRanges[side]=Math.max(...values)-Math.min(...values);check(armRanges[side]>.15,'Wolf support shoulder remains static: '+JSON.stringify({range:armRanges[side],top:rig.top,speed:ent.loco.speed,amp:ent.loco.amp,kind:rig.kind,active:rig===unit.userData.rig}));}
        }
        if(visual){
          const box=new T.Box3();active.traverse(n=>{if(n.isMesh&&!n.userData.presentationEffect&&!n.userData.isOutline){n.geometry.computeBoundingBox();box.union(n.geometry.boundingBox.clone().applyMatrix4(n.matrixWorld));}});
          const span=Math.max(...box.getSize(V()).toArray()),center=box.getCenter(V());
          const capture=(name,angle=[1.5,.65,1.9],neutral=false,focus=center,frameSpan=span)=>{
            camera.position.copy(focus).add(V().fromArray(angle).multiplyScalar(frameSpan*.85));camera.lookAt(focus);
            const saved=[];if(neutral)active.traverse(n=>{if(n.isMesh&&!n.userData.presentationEffect){saved.push([n,n.material]);n.material=clay;}});
            renderer.render(scene,camera);pictures[form+'-'+name+(neutral?'-neutral':'')]=renderer.domElement.toDataURL().split(',')[1];for(const [mesh,material]of saved)mesh.material=material;
          };
          for(const [name,angle]of [['front',[0,.25,2.2]],['side',[2.2,.25,0]],['back',[0,.25,-2.2]],['oblique',[1.5,.65,1.9]]]){capture(name,angle);capture(name,angle,true);}
          const detail=active.getObjectByName(id==='t08'?'sensor':id==='t06'?'wrist_l':['m04','s03'].includes(id)?'heavy':'gun');
          if(detail)for(const neutral of [false,true])capture('weapon-detail',[1.3,.45,1.6],neutral,detail.getWorldPosition(V()),detail.getWorldScale(V()).x*2);
          for(const slot of ['light','heavy']){
            let last=-Infinity;
            if(id==='s03'&&slot==='heavy'){ent.heavyFx={phase:'charge',t0:now};for(let frame=0;frame<60;frame++){tick();if(frame%6===0)capture('charge-'+frame,[.3,.15,2.2],false,rig.wpn.heavy.ref.getWorldPosition(V()),rig.wpn.heavy.ref.getWorldScale(V()).x*1.25);}}
            for(let frame=0;frame<180;frame++){
              if(now-last>=1/heroWeapon(id,slot).rate){const origin=BattleClient.prototype._selfMuzzle.call(client,null,100,slot);shoot(slot);last=now;const def=heroWeapon(id,slot);if(def.type==='beam'||(id==='m04'&&slot==='heavy'))lanceDischarge(scene,effects,origin,origin.clone().add(V().set(0,0,span*1.5)),def,0x80dfff);}
              tick();if(rig.hairFlick&&slot==='light')check(V().set(0,0,1).applyQuaternion(rig.hairFlick.middle.getWorldQuaternion(Q())).z>.999,'Flick emitter turns away from target');
              if(frame%6===0){capture(slot+'-'+frame);capture(slot+'-'+frame,[1.5,.65,1.9],true);if(detail)capture(slot+'-detail-'+frame,[1.3,.45,1.6],false,detail.getWorldPosition(V()),detail.getWorldScale(V()).x*2);}
            }
          }
          for(let frame=0;frame<120;frame++){ent.fireFx=null;tick(1/60,rig.top*.7);if(frame%6===0)capture('run-'+frame);}
        }
        ent.fireFx=null;for(let i=0;i<180;i++)tick();
        check(rig.weaponSequences.heavy.entries.every(e=>!e.payload||e.payload.scale.x===1),'Missile rack fails to recover');
        if(rig.hairFlick)check(rig.hairFlick.tuft.scale.x===.001,'Hair tuft remains in idle');
        for(const effect of effects.splice(0)){scene.remove(effect.obj);if(effect.dispose)effect.dispose();else disposeTree(effect.obj);}
        forms[form]={ports,events,armRanges,fps:[30,60,144]};scene.remove(unit);disposeTree(unit);
      }
      renderer.dispose();clay.dispose();return {forms,pictures};
    },{id,spec:specs[id],visual:focused.has(id)});
    for(const [name,bytes]of Object.entries(result.pictures))await writeFile(`${output}/${id}-${name}.png`,Buffer.from(bytes,'base64'));
    const hashes={};for(const file of [`public/js/forge/assets/${id}.js`,`public/assets/models/reference/${id}.glb`,`public/js/forge/combatAssets/${id}.js`])hashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
    results[id]={...result.forms,hashes};console.log('Verified weapon presentation '+id);
  }
  const inputs={};for(const file of ['public/js/locomotion.js','public/js/unitMotion.js','public/js/anatomicalPose.js','public/js/forge/referenceAsset.js','public/js/forge/combatAsset.js','public/js/game.js','public/js/charPreview.js','public/js/vfx.js'])inputs[file]=createHash('sha256').update(await readFile(file)).digest('hex');
  assert.equal(errors.length,0,errors.join('\n'));await writeFile(output+'/validation.json',JSON.stringify({assets:results,inputs,gates:{sequencing:'pass',origin:'pass',specificPresentation:'pass',independentExport:'pass',visual:'pending_inspection'}},null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
