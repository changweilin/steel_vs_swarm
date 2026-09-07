import fs from 'node:fs';
import { chromium } from 'file:///C:/Users/user/Documents/app/mapping_elf/node_modules/playwright/index.mjs';
const browser = await chromium.launch({headless:true,args:['--use-gl=angle','--enable-unsafe-swiftshader']});
const page = await browser.newPage({viewport:{width:1500,height:900},deviceScaleFactor:1});
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
await page.route('**/three@0.160.0/build/three.module.js',route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync('out/forest_review/three.module.js','utf8')}));
await page.route('**/three@0.160.0/examples/jsm/**',route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync('out/forest_review/'+route.request().url().split('/examples/jsm/')[1].replaceAll('/','_'),'utf8')}));
await page.route('http://localhost:8666/public/',route=>route.fulfill({contentType:'text/html',body:'<html><head><script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.160.0/build/three.module.js","three/addons/":"https://unpkg.com/three@0.160.0/examples/jsm/"}}</script></head><body></body></html>'}));
await page.goto('http://localhost:8666/public/',{waitUntil:'domcontentloaded'});
const audit=await page.evaluate(async()=>{
const THREE=await import('three');
const {buildVegMeshes}=await import('/public/js/biomes.js');
const {TREE_SPECIES,createForestTree,forestSeed}=await import('/public/js/forest.js');
const {Pipeline}=await import('/public/js/postfx.js');
const {stepCelWind,updateCelLight,disposeTree}=await import('/public/js/toon.js');
document.body.style.cssText='margin:0;padding:18px;background:#e6e9dc;color:#263b32;font:18px sans-serif';
document.body.innerHTML='<div style="height:40px">程序植物圖鑑 · 各格自動取景 · 春季花／秋季果</div><div id="grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px"></div>';
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(470,252);renderer.toneMapping=THREE.ACESFilmicToneMapping;
const scene=new THREE.Scene();scene.background=new THREE.Color(0xe6e9dc);
const camera=new THREE.PerspectiveCamera(36,470/252,.01,2000);
scene.add(new THREE.HemisphereLight(0xffffff,0x5b604b,.6));const sun=new THREE.DirectionalLight(0xffffff,1);sun.position.set(-60,150,100);scene.add(sun);
const pipeline=new Pipeline(renderer,scene,camera,{dof:false,wipe:false});
const labels={forestBamboo:'竹叢 · 竹節／地下莖',rhododendron:'杜鵑 · 多幹／春花',banyan:'榕樹 · 傘冠／支柱根',scrubOak:'灌木櫟 · 密冠／橡實',willow:'柳樹 · 下垂枝／柔荑花序',juniper:'杜松 · 低矮多幹／球果',mangroveGrey:'海茄苳 · 呼吸根',coconut:'椰子 · 羽狀葉／椰果',baobab:'猴麵包樹 · 膨大幹／果實'};
let draws=0,triangles=0,bendMatches=true,moved=false,released=0;
for(const type of Object.keys(TREE_SPECIES)) for(const season of ['spring','summer','autumn','winter']){
 const x=Array.from({length:100},(_,i)=>(i+1)*13).find(x=>createForestTree(type,forestSeed(x,7),undefined,undefined,1,season).parts.some(p=>p.role==='flower'||p.role==='fruit'))??13;
 const meshes=buildVegMeshes(type,[{x,y:0,z:7,s:1,ry:.6,dj:0}],season);
 if(meshes.length<2||meshes.length>4)throw Error(type+' batch count');
 for(const m of meshes)scene.add(m);
 const bounds=new THREE.Box3();for(const m of meshes)bounds.union(new THREE.Box3().setFromObject(m));
 const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
 const distance=Math.max(size.y,size.x/1.86)*2.2+size.z*.5;
 camera.position.set(center.x+distance*.2,center.y+distance*.1,center.z+distance);camera.lookAt(center);
 updateCelLight(camera);pipeline.render();
 const before=renderer.domElement.toDataURL();for(let i=0;i<32;i++)stepCelWind(.25);pipeline.render();moved ||= before!==renderer.domElement.toDataURL();
 if(labels[type] && season === (['rhododendron','willow'].includes(type)?'spring':'autumn')){const cell=document.createElement('div');cell.innerHTML='<div style="height:23px">'+labels[type]+'</div>';const img=document.createElement('img');img.src=renderer.domElement.toDataURL();img.style.cssText='width:100%;display:block';cell.appendChild(img);document.getElementById('grid').appendChild(cell);}
 bendMatches &&= meshes.every(m=>['span','flex','lag','rate'].every(k=>m.material.userData.celOpts.soft[k]===meshes[0].material.userData.celOpts.soft[k]));
 draws+=meshes.length;triangles+=meshes.reduce((n,m)=>n+(m.geometry.index?.count??m.geometry.attributes.position.count)/3,0);
 const memory=renderer.info.memory.geometries;for(const m of meshes){scene.remove(m);disposeTree(m);}pipeline.render();released+=memory-renderer.info.memory.geometries;
}
return {species:Object.keys(TREE_SPECIES).length,draws,triangles,bendMatches,moved,released};
});
await page.screenshot({path:'out/forest_review/botanical.png',fullPage:true});
console.log(JSON.stringify({errors,...audit}));
await browser.close();
if(errors.length||!audit.bendMatches||!audit.moved||audit.released!==audit.draws)process.exitCode=1;


