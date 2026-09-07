// 本機視覺驗收：僅測試伺服器，正式遊戲不包含此路由。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../public/js/', import.meta.url));
const page = `<!doctype html><meta charset="utf-8"><title>建築文化與年代驗收</title>
<style>body{margin:0;background:#d9e5ed;color:#273649;font:16px sans-serif}header{position:absolute;top:18px;left:28px}h1{font-size:22px;margin:0 0 6px}#labels{position:absolute;inset:0;pointer-events:none}span{position:absolute;font-weight:600;background:#ffffffc9;padding:5px 9px;border-radius:4px}canvas{display:block}</style>
<header><h1>多元文化・古今交錯</h1>相同 24 × 18 公尺圖資輪廓，八種實體建築語彙</header><div id="labels"></div>
<script type="importmap">{"imports":{"three":"/three.mjs","three/addons/utils/BufferGeometryUtils.js":"/utils.mjs","three/addons/postprocessing/Pass.js":"/pass.mjs"}}</script>
<script type="module">
import * as THREE from 'three';
import { buildOsmPolygonBuildings } from '/js/osmBuilding.js';
import { ARCHITECTURE_STYLES } from '/js/architectureStyles.js';
import { sceneObjectMat } from '/js/toon.js';
import { Pipeline } from '/js/postfx.js';
const renderer = new THREE.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(devicePixelRatio);document.body.append(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(0xd9e5ed);
scene.add(new THREE.HemisphereLight(0xffffff,0x99a5bc,2.2));const light=new THREE.DirectionalLight(0xffeed6,2.2);light.position.set(-35,80,40);scene.add(light);
const aspect=innerWidth/innerHeight, camera=new THREE.PerspectiveCamera(42,aspect,0.1,500);camera.position.set(95,125,150);camera.lookAt(0,0,0);
const labels=[];
Object.entries(ARCHITECTURE_STYLES).forEach(([id,style],i)=>{
 const x=(i%4-1.5)*34,z=(Math.floor(i/4)-0.5)*35;
 const area={sourceId:id,tags:{building:'house',height:'10'},classification:{kind:'house',generator:'polygonBuilding'},worldPolygons:[{outer:[[x-12,z-9],[x+12,z-9],[x+12,z+9],[x-12,z+9]],holes:[]}]};
 buildOsmPolygonBuildings(scene,[area],{terrain:{heightAt:()=>0},architectureOf:()=>({...style,id,variant:1,profile:'plain'}),materialOf:()=>({wall:sceneObjectMat(0xffffff,{vertexColors:true}),roof:sceneObjectMat(0xffffff,{vertexColors:true})})});
 const label=document.createElement('span');label.textContent=style.label;document.querySelector('#labels').append(label);labels.push({label,point:new THREE.Vector3(x,0,z+12)});
});
const floor=new THREE.Mesh(new THREE.PlaneGeometry(210,130),new THREE.MeshLambertMaterial({color:0xc1cdbf}));floor.rotation.x=-Math.PI/2;floor.position.y=-0.05;scene.add(floor);
new Pipeline(renderer,scene,camera,{dof:false,grade:false}).render();labels.forEach(({label,point})=>{point.project(camera);label.style.left=((point.x+1)*innerWidth/2-45)+'px';label.style.top=((-point.y+1)*innerHeight/2)+'px'});
document.body.dataset.ready='true';
</script>`;
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let body, type = 'text/javascript';
    if (url.pathname === '/') { body = page; type = 'text/html'; }
    else if (url.pathname === '/three.mjs') body = await readFile(process.env.THREE_MODULE);
    else if (url.pathname === '/pass.mjs') body = await readFile(process.env.THREE_PASS);
    else if (url.pathname === '/utils.mjs') body = await readFile(process.env.THREE_BUFFER_UTILS);
    else if (url.pathname.startsWith('/js/')) {
      const file = path.resolve(root, url.pathname.slice(4));
      if (!file.startsWith(root)) throw new Error('路徑不在模組目錄內');
      body = await readFile(file);
    } else { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }); res.end(body);
  } catch (error) { res.writeHead(500); res.end(String(error)); }
}).listen(8644, '127.0.0.1', () => console.log('建築驗收：http://127.0.0.1:8644'));
