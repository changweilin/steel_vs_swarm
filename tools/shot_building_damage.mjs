// Browser integration: batched neighbours, real snapshot consumer, rooftop/wall collision, and combat models.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromiumOrNull, chromePath, serve, skipNoPlaywright } from './pw.mjs';
import { readSrc, grabMethod } from './audit_src.mjs';

const chromium=await chromiumOrNull();
if (!chromium) skipNoPlaywright('建築損毀截圖量測');
const server=await serve(), browser=await chromium.launch({headless:true,executablePath:chromePath()});
try {
  const page=await browser.newPage({viewport:{width:1280,height:2200},deviceScaleFactor:1});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error') console.error(m.text());});
  if (process.env.THREE_MODULE) {
    const body=await readFile(process.env.THREE_MODULE,'utf8');
    await page.route('**/three@0.160.0/build/three.module.js',r=>r.fulfill({contentType:'text/javascript',body}));
  }
  if (process.env.THREE_GEOMETRY_UTILS) {
    const body=await readFile(process.env.THREE_GEOMETRY_UTILS,'utf8');
    await page.route('**/utils/BufferGeometryUtils.js',r=>r.fulfill({contentType:'text/javascript',body}));
  }
  await page.route('**/main.js',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await page.goto(server.url,{waitUntil:'domcontentloaded'});
  const game=readSrc('public','js','game.js');
  const methods=['_syncMapBuildings','_updateSceneHpBar','_updateDamageStage','_buildBlockGrid','_blockerHitT','_obstHitT'].map(name=>grabMethod(game,name));
  const result=await page.evaluate(async methods=>{
    const THREE=await import('three');
    const {buildOsmPolygonBuildings}=await import('/public/js/osmBuilding.js');
    const {createArchitecturePlanner}=await import('/public/js/buildingDiversity.js');
    const {registerMapBuildings,detachMapBuilding,mapBuildingTarget}=await import('/public/js/mapBuildingRender.js');
    const {MAP_BUILDING,collapseBuildingBoxes,buildingRoofIndex}=await import('/public/js/mapBuilding.js');
    const {applySceneDamage,sceneDamageStage,sceneDamageProfile,sceneDamageBurst}=await import('/public/js/sceneDamage.js');
    const {DMG_FX,makeDamageFx}=await import('/public/js/vfx.js');
    const {disposeTree,setCelSun,updateCelLight}=await import('/public/js/toon.js');
    const {buildBuildingUnit}=await import('/public/js/buildingUnitModels.js');
    const {buildNpcModel}=await import('/public/js/npcModels.js');
    const check=(ok,message)=>{if(!ok) throw new Error(message);};
    const deps={THREE,MAP_BUILDING,collapseBuildingBoxes,buildingRoofIndex,detachMapBuilding,applySceneDamage,sceneDamageStage,sceneDamageProfile,sceneDamageBurst,disposeTree,makeDamageFx,DMG_FX};
    const prototype=new Function('D',`const {${Object.keys(deps).join(',')}}=D; return {${methods.join(',')}};`)(deps);
    const area=(id,x,height=12)=>({sourceId:id,centroid:{x,z:0},tags:{building:'house',height:String(height)},classification:{generator:'polygonBuilding',kind:'house'},
      worldPolygons:[{outer:[[x-5,-5],[x+5,-5],[x+5,5],[x-5,5]],holes:[]}]});
    const city=()=>{
      const group=new THREE.Group();
      const areas=[area('left',100),area('right',125)],terrain={heightAt:()=>0};
      const built=buildOsmPolygonBuildings(group,areas,{terrain,architectureOf:createArchitecturePlanner({areas,terrain,seed:42})});
      const records=registerMapBuildings(group,built.blockers,built.platforms,built.meshes,[]);
      check(records.size===2,'each building keeps its own identity');
      check(built.meshes.length<=3,'intact buildings retain material batching');
      return {group,built,records};
    };
    const context=(c)=>Object.assign(Object.create(prototype),{scene:new THREE.Scene(),effects:[],damaged:new Set(),
      terrain:{blockers:c.built.blockers,rebuildBlockerTops(){},rebuildClimbs(){},climbs:[]},
      mapBuildings:new Map([...c.records].map(([key,r])=>[key,mapBuildingTarget(r)])),
      _blockGrid:prototype._buildBlockGrid(c.built.blockers),_slabHitT:()=>null,
      _buildingRoofHit:buildingRoofIndex(c.built.platforms)});
    const c=city(), ctx=context(c), left=ctx.mapBuildings.get('left/0'), right=c.records.get('right/0');
    ctx.scene.add(c.group);
    const neighbours=right.sources.map(s=>Array.from(s.mesh.geometry.attributes.position.array.slice(s.start*3,(s.start+s.count)*3)));
    ctx._syncMapBuildings([]);
    ctx._syncMapBuildings([['left/0',left.max/2,left.max]]);
    check(left.sceneStage===1 && ctx.effects.length===2,'50% transitions once');
    ctx._syncMapBuildings([['left/0',left.max/2,left.max]]);
    check(ctx.effects.length===2,'repeated snapshot stays quiet');
    check(right.sources.every((s,i)=>JSON.stringify(neighbours[i])===JSON.stringify(Array.from(s.mesh.geometry.attributes.position.array.slice(s.start*3,(s.start+s.count)*3)))),'neighbour geometry stays unchanged');
    check(!right.mesh,'undamaged neighbour stays batched');
    check(ctx._obstHitT(100,30,0,100,0,0)!==null && ctx._hitBuildingKey==='left/0','roof impacts retain owner');
    const barPositions=Array.from(left.bar.children[0].geometry.attributes.position.array);
    ctx._syncMapBuildings([['left/0',left.max/4,left.max]]);
    check(left.sceneStage===2 && ctx.effects.length===4,'25% transitions once');
    check(JSON.stringify(barPositions)===JSON.stringify(Array.from(left.bar.children[0].geometry.attributes.position.array)),'HP bar never deforms');
    ctx._syncMapBuildings([['left/0',0,left.max]]);
    for (const e of ctx.effects) e.dispose?.();
    check(left.collapsed && Math.abs(left.mesh.scale.y-MAP_BUILDING.RUBBLE_H)<1e-8,'terminal pose settles on animation disposal');
    check(ctx._obstHitT(90,8,0,110,8,0)===null,'collapsed building releases upper collision');
    check(ctx._obstHitT(90,1,0,110,1,0)!==null,'rubble retains low collision');
    const count=ctx.effects.length;
    ctx._syncMapBuildings([['left/0',0,left.max]]);
    check(ctx.effects.length===count,'duplicate terminal snapshot is quiet');
    const late=context(city());
    late._syncMapBuildings([['left/0',0,left.max]]);
    check(late.effects.length===0,'late join does not replay destruction');
    const rows=[];
    for(const side of ['SWARM','STEEL']) for(const kind of ['tower','base']) rows.push({label:`${kind} ${side}`,kind,build:()=>buildBuildingUnit(kind==='base'?`base:${side}`:kind,side)});
    for(const side of ['GUER','MILI']) rows.push({label:`bunker ${side}`,kind:'bunker',build:()=>buildNpcModel('bunker',side)});
    rows.push({label:'Map house',kind:'mapbuilding',build:()=>{const c=city();const root=detachMapBuilding(c.records.get('left/0'));root.removeFromParent();root.position.set(0,0,0);return root;}});
    // Shared templates must not let one damaged tower deform another tower.
    const template=buildBuildingUnit('tower','STEEL'), shared=template.clone(true), bb=new THREE.Box3().setFromObject(template);
    const first=shared.children.find(o=>o.isMesh), before=first?.geometry.attributes.position.array.slice();
    applySceneDamage({id:1,kind:'tower',mesh:template,dimR:10,dimH:bb.max.y},2);
    check(before && before.every((v,i)=>v===first.geometry.attributes.position.array[i]),'combat templates stay immutable');
    const damaged=template.children.find(o=>o.isMesh);
    check(damaged.material!==first.material && damaged.material.customProgramCacheKey()===first.material.customProgramCacheKey(),'damage preserves isolated shader variants');
    document.body.innerHTML='';
    document.body.style.cssText='margin:0;background:#e7e1d5;color:#292b30;font:16px sans-serif';
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    renderer.setSize(300,240);renderer.toneMapping=THREE.ACESFilmicToneMapping;
    setCelSun(new THREE.Vector3(.4,.8,.4));
    for(const row of rows){
      const line=document.createElement('div');line.style.cssText='display:flex;gap:10px;padding:8px';document.body.append(line);
      for(let stage=0;stage<4;stage++){
        const mesh=row.build(), box=new THREE.Box3().setFromObject(mesh), size=box.getSize(new THREE.Vector3());
        const ent={id:42,kind:row.kind,mesh,dimR:Math.max(size.x,size.z)/2,dimH:size.y,dimTop:box.max.y};
        applySceneDamage(ent,stage);
        if(stage===3) mesh.scale.y=MAP_BUILDING.RUBBLE_H;
        if(stage===1 || stage===2){const fx=makeDamageFx({r:ent.dimR,top:ent.dimTop,h:ent.dimH,fire:sceneDamageProfile(row.kind).fire,surfaceCracks:false});fx.userData.setStage(stage);fx.userData.update(.016,1);mesh.add(fx);}
        const scene=new THREE.Scene();scene.background=new THREE.Color(0xe7e1d5);scene.add(mesh,new THREE.HemisphereLight(0xffffff,0x625d54,.8));
        const sun=new THREE.DirectionalLight(0xffffff,1.5);sun.position.set(20,40,30);scene.add(sun);
        const extent=Math.max(size.x,size.y,size.z), camera=new THREE.PerspectiveCamera(35,300/240,.1,1000);
        const center=box.getCenter(new THREE.Vector3());
        camera.position.copy(center).add(new THREE.Vector3(extent*1.4,extent*.9,extent*1.7));camera.lookAt(center);camera.updateMatrixWorld();updateCelLight(camera);
        renderer.render(scene,camera);
        const cell=document.createElement('div');cell.innerHTML=`<div>${row.label} — ${[100,50,25,0][stage]}%</div>`;
        const img=document.createElement('img');img.src=renderer.domElement.toDataURL();cell.append(img);line.append(cell);disposeTree(mesh);
      }
    }
    renderer.dispose();
    return {models:rows.length,appearances:rows.length*4,batchedNeighbours:'isolated',snapshots:'verified'};
  },methods);
  assert.deepEqual(errors,[]);
  await mkdir('tools/.shots',{recursive:true});
  await page.screenshot({path:'tools/.shots/building-damage.png',fullPage:true});
  console.log(JSON.stringify(result));
} finally { await browser.close(); await server.close(); }
