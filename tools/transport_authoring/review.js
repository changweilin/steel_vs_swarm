import * as THREE from 'three';
import { vehicleBackgroundObject } from '../../public/js/vehicleCatalog.js';
import { mergeRuntimeParts } from '../../public/js/runtimePartModel.js';
import { generateVessel } from '../../public/js/vesselCatalog.js';
import { buildGeneratedVesselMesh } from '../../public/js/vesselModels.js';
import { disposeTree } from '../../public/js/toon.js';

const vehicles = ['compactSedan','hatchback','sportsCar','familySUV','cargoVan','militaryPickup','truck','dieselLocomotive'];
const vessels = ['skiff','patrol','yacht','trawler'];
const report = [];

function render(root, label) {
  const card = document.createElement('div'); card.className = 'card';
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(360,245); renderer.setClearColor(0xd5dce2);
  const scene = new THREE.Scene();scene.add(root);
  scene.add(new THREE.HemisphereLight(0xffffff,0x647487,2.2));
  const light = new THREE.DirectionalLight(0xffffff,3);light.position.set(5,9,4);scene.add(light);
  const box = new THREE.Box3().setFromObject(root),size = box.getSize(new THREE.Vector3()),center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x,size.y,size.z), camera = new THREE.PerspectiveCamera(32,360/245,.01,span*12);
  camera.position.copy(center).add(new THREE.Vector3(1,.65,1.25).normalize().multiplyScalar(span*2.15));
  camera.lookAt(center);
  renderer.render(scene,camera);
  const preview = new Image();preview.src = canvas.toDataURL('image/png');preview.alt = label;
  const text = document.createElement('div');text.className='label';text.textContent=label;
  card.append(preview,text);document.getElementById('grid').append(card);
  let triangles=0;root.traverse(o=>{if(o.geometry)triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;});
  report.push({label,triangles,size:size.toArray()});
  disposeTree(root);renderer.dispose();renderer.forceContextLoss();
}

try {
  for (const key of vehicles) for (const sourceGeometry of [true,false]) {
    const entry=vehicleBackgroundObject(key,42,{sourceGeometry});
    const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.64,metalness:.14});
    render(new THREE.Mesh(mergeRuntimeParts(entry.parts),material),`${entry.name}／${sourceGeometry?'原模型':'Blender 修改'}`);
  }
  for(const key of vessels) {
    const v=generateVessel(42,{id:key});
    const root=buildGeneratedVesselMesh(v,{wake:false});
    const originals=new Set();root.traverse(o=>{if(o.material){originals.add(o.material);o.material=new THREE.MeshStandardMaterial({color:o.material.color,roughness:.68,metalness:.12});}});
    for(const material of originals)material.dispose();
    render(root,`${v.name||key}／Blender 船體`);
  }
  window.__transportReview={ready:true,models:report};
} catch(error) {window.__transportReview={error:error.stack};}
