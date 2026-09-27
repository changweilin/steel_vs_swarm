// Execute damage on production rigs: immutable articulation, healing, stages and missile snapshots.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromiumOrNull, chromePath, serve } from './pw.mjs';
import { readSrc, grabMethod, grabFn } from './audit_src.mjs';
import { BattleSim } from '../server/sim.js';
import { MAPGEO } from '../public/js/data.js';
const config=new Function('MAPGEO',`${grabFn(readSrc('test','e2e.mjs'),'fakeBattleConfig')};return fakeBattleConfig(1);`)(MAPGEO);
const sim=new BattleSim(config);
sim.missiles.push({id:999,x:0,y:2,z:0,hp:25,maxHp:100});
assert.deepEqual(sim.snapshot().sm.find(m=>m.id===999),{id:999,x:0,y:2,z:0,hp:25,m:100});
assert.equal(sim._serializeEnt({id:1,kind:'moon',isMoon:true,x:0,z:0,y:4.5,hp:25,maxHp:100}).y,4.5);
assert.equal(sim._serializeEnt({id:2,kind:'slab',isSlab:true,x:0,z:0,ang:1.2,hp:25,maxHp:100}).ang,1.2);
const chromium=await chromiumOrNull();
assert.ok(chromium,'Playwright is required');
const server=await serve(), browser=await chromium.launch({headless:true,executablePath:chromePath()});
try {
  const page=await browser.newPage({viewport:{width:1200,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  for(const [env,url] of [['THREE_MODULE','**/three@0.160.0/build/three.module.js'],['THREE_GEOMETRY_UTILS','**/utils/BufferGeometryUtils.js']]) {
    if(process.env[env]) { const body=await readFile(process.env[env],'utf8'); await page.route(url,r=>r.fulfill({contentType:'text/javascript',body})); }
  }
  await page.route('**/main.js',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await page.goto(server.url,{waitUntil:'domcontentloaded'});
  const game=readSrc('public','js','game.js');
  const result=await page.evaluate(async methods=>{
    const THREE=await import('three');
    const {UNITS,CHARACTERS}=await import('/public/js/data.js');
    const {buildNpcModel}=await import('/public/js/npcModels.js');
    const {buildSummonModel}=await import('/public/js/summonModels.js');
    const {forgeMech,specOf}=await import('/public/js/forge/forge.js');
    const {entryKey}=await import('/public/js/forge/roster.js');
    const {applySceneDamage,sceneDamageStage,sceneDamageProfile,sceneDamageBurst,releaseMobileDamage}=await import('/public/js/sceneDamage.js');
    const {projectileMesh,buildHpSkillObject,makeDamageFx,DMG_FX}=await import('/public/js/vfx.js');
    const {disposeTree,setCelSun,updateCelLight}=await import('/public/js/toon.js');
    const check=(ok,msg)=>{if(!ok)throw new Error(msg);};
    for(const kind of Object.keys(UNITS)) check(sceneDamageProfile(kind),`missing profile ${kind}`);
    check(!sceneDamageProfile('relay') && !sceneDamageProfile('fire'),'invulnerable visuals omitted');
    const rows=[];
    for(const kind of ['soldier','rocketeer','howitzer','tank','apc','heli','civilian']) rows.push({kind,build:()=>buildNpcModel(kind==='civilian'?'civ':`creep:${kind}`,'STEEL')});
    for(const kind of ['drone_wingman','assault_rover','heli_squad','main_battle_tank','veteran_squad','carnival_heli']) rows.push({kind,build:()=>buildSummonModel(`summon:${kind}`,'SWARM')});
    for(const [id,ch] of Object.entries(CHARACTERS)) {
      const spec=specOf(entryKey(id,ch.kind==='morph' ? 'ground' : null));
      if(spec) rows.push({kind:ch.kind,label:id,build:()=>forgeMech(spec).group});
      if(ch.kind==='morph') {
        const air=specOf(entryKey(id,'flight'));
        if(air)rows.push({kind:'morph',label:`${id} air`,build:()=>forgeMech(air).group});
      }
    }
    for(const kind of ['tree','moon','slab'])rows.push({kind,build:()=>buildHpSkillObject(kind)});
    rows.push({kind:'missile',build:()=>projectileMesh({type:'missile'},{hue:0xff6633})});
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(280,210);renderer.toneMapping=THREE.ACESFilmicToneMapping;
    document.body.innerHTML='';document.body.style.cssText='margin:0;background:#e7e1d5;color:#292b30;font:14px sans-serif';
    setCelSun(new THREE.Vector3(.4,.8,.4));
    let appearances=0;
    for(const row of rows) {
      const mesh=row.build(),box=new THREE.Box3().setFromObject(mesh),size=box.getSize(new THREE.Vector3());
      const ent={id:42,kind:row.kind,mesh,dimR:Math.max(size.x,size.z)/2,dimH:size.y,dimTop:box.max.y};
      const original=[];mesh.traverse(n=>{if(n.isMesh)original.push({n,g:n.geometry,p:n.geometry.attributes.position.array.slice(),q:n.quaternion.clone(),c:n.material.color?.clone()});});
      applySceneDamage(ent,0);
      const line=document.createElement('div');line.style.cssText='display:flex;gap:8px;padding:8px';
      // Keep the review sheet compact while testing every character and stance.
      const draw=!row.label || !document.querySelector(`[data-kind="${row.kind}"]`);
      if(draw){line.dataset.kind=row.kind;document.body.append(line);}
      for(const stage of [0,1,2,3]) {
        applySceneDamage(ent,stage);check(ent.sceneStage===stage,`${row.kind} stage ${stage}`);
        if(sceneDamageProfile(row.kind).mobile)for(const {n,g,p,q} of original){check(n.geometry===g && p.every((v,i)=>v===g.attributes.position.array[i]),'shared vertices remain intact');check(n.quaternion.equals(q),'articulation remains intact');}
        const scars=ent.mobileDamage?.scars.length;
        applySceneDamage(ent,stage);check(scars===ent.mobileDamage?.scars.length,'repeat snapshot cannot duplicate scars');
        if(draw){
          const scene=new THREE.Scene();scene.background=new THREE.Color(0xe7e1d5);scene.add(mesh,new THREE.HemisphereLight(0xffffff,0x625d54,1));
          let fx;
          if(stage===1 || stage===2){fx=makeDamageFx({r:ent.dimR,top:ent.dimTop,h:ent.dimH,fire:sceneDamageProfile(row.kind).fire,surfaceCracks:false});fx.userData.setStage(stage);fx.userData.update(.016,1);mesh.add(fx);}
          const scaleY=mesh.scale.y;
          if(stage===3)mesh.scale.y*=sceneDamageProfile(row.kind).mobile ? .6 : .18;
          const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(20,40,30);scene.add(light);
          const extent=Math.max(size.x,size.y,size.z),center=box.getCenter(new THREE.Vector3()),camera=new THREE.PerspectiveCamera(35,280/210,.01,2000);
          camera.position.copy(center).add(new THREE.Vector3(extent*1.4,extent*.9,extent*1.7));camera.lookAt(center);camera.updateMatrixWorld();updateCelLight(camera);renderer.render(scene,camera);
          const cell=document.createElement('div');cell.textContent=`${row.label || row.kind} ${[100,50,25,0][stage]}%`;const img=document.createElement('img');img.src=renderer.domElement.toDataURL();cell.append(img);line.append(cell);
          mesh.scale.y=scaleY;if(fx){fx.removeFromParent();disposeTree(fx);}
        }
        appearances++;
      }
      applySceneDamage(ent,0);
      if(ent.mobileDamage){
        check(ent.mobileDamage.scars.every(s=>!s.visible),'healing hides scars');
        for(const [mat,color] of ent.mobileDamage.colors)check(mat.color.equals(color),'respawn restores exact material');
        const scar=ent.mobileDamage.scars[0];
        if(scar){const parent=scar.parent;parent.rotation.y+=.4;check(scar.parent===parent,'scars remain attached to moving parts');}
      }
      releaseMobileDamage(ent);disposeTree(mesh);
    }
    const deps={THREE,projectileMesh,buildHpSkillObject,sceneDamageStage,sceneDamageBurst,sceneDamageProfile,applySceneDamage,releaseMobileDamage,disposeTree,makeDamageFx,DMG_FX};
    const proto=new Function('D',`const {${Object.keys(deps)}}=D;return {${methods.join(',')}};`)(deps);
    const ctx=Object.assign(Object.create(proto),{scene:new THREE.Scene(),effects:[],damaged:new Set(),samMeshes:new Map(),ents:new Map(),
      spinners:new Set(),flamers:new Set(),_unregisterViewOccluders(){},_updateHpBar(){},terrain:{heightAt:()=>100}});
    for(const death of [false,true]) {
      const mesh=buildNpcModel('creep:tank','STEEL'),ent={id:81,kind:'tank',mesh,dimR:4,dimH:3};
      ctx.scene.add(mesh);ctx.ents.set(ent.id,ent);applySceneDamage(ent,2);
      const damage=ent.mobileDamage;let disposed=0;
      for(const material of damage.materials.values())material.addEventListener('dispose',()=>disposed++);
      const before=ctx.effects.length;
      ctx._removeEnt(ent.id,ent,death);
      check(!ctx.ents.has(ent.id),'removed units leave combat lookup');
      if(death){
        check(ctx.effects.length>before && ent.sceneStage===3,'death triggers terminal appearance and animation');
        const fade=ctx.effects.at(-1);fade.fade(mesh,.5);check(mesh.scale.y<1,'terminal animation advances');fade.dispose();
      } else check(ctx.effects.length===before && !mesh.parent,'fog omission creates no death animation');
      check(disposed===damage.materials.size,'owned damage materials are released');
    }
    ctx.effects=[];
    for(const [id,k] of ['tree','moon','slab'].entries()) {
      const ent=ctx._spawnEnt({id,k,s:'STEEL',x:10,z:20,y:k==='moon'?4.5:0,ang:.5,hp:25,m:100});
      check(ent.sceneStage===2 && ent.mesh.position.y===(k==='moon'?104.5:100),'skill body restores snapshot stage and world height');
      check(ctx.effects.length===0,'restored skill body does not replay transition');
    }
    for(const ent of ctx.ents.values())disposeTree(ent.mesh);ctx.damaged.clear();
    ctx._syncMissiles([{id:9,x:0,y:5,z:0,hp:25,m:100}]);check(!ctx.effects.length,'late missile snapshot does not replay damage');
    check(ctx.samMeshes.get(9).sceneStage===2,'missile reads authoritative HP');
    ctx._syncMissiles([{id:9,x:0,y:5,z:0,hp:25,m:100}]);check(!ctx.effects.length,'missile repeated snapshot stays quiet');
    ctx._syncMissiles([],[{e:'boom',missileId:9}]);check(ctx.effects.length>0 && ctx.damaged.size===0,'interception emits terminal burst and releases live FX');
    renderer.dispose();
    return {models:rows.length,appearances,healing:true,articulation:true,missileSnapshots:true};
  },['_syncMissiles','_updateDamageStage','_spawnEnt','_removeEnt'].map(n=>grabMethod(game,n)));
  assert.deepEqual(errors,[]);await mkdir('tools/.shots',{recursive:true});
  await page.screenshot({path:'tools/.shots/unit-damage.png',fullPage:true});console.log(JSON.stringify(result));
} finally {await browser.close();await server.close();}
