import * as THREE from 'three';
import { createShoreClassifier, planShoreAnchors, planShoreFacilities } from '../../public/js/shoreline.js';
import { shoreGeometry, buildShoreFacilities } from '../../public/js/shorelineRender.js';
import { SHORE_FACILITIES, SHORELINE } from '../../public/js/shorelineCatalog.js';
import { classifyArea } from '../../public/js/osmAreas.js';
import { buildHabitatScene } from '../../public/js/habitatRender.js';
import { makeFootprintIndex } from '../../public/js/ground.js';
import { envMat, disposeTree, setCelSun } from '../../public/js/toon.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(1100, 720); renderer.setPixelRatio(1);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xc0cdc4);
scene.add(new THREE.HemisphereLight(0xffffff, 0x817860, .8));
const light = new THREE.DirectionalLight(0xfff1d5, 1.1); light.position.set(-30, 60, 35); scene.add(light); setCelSun(light.position);
const camera = new THREE.PerspectiveCamera(40, 1100 / 720, .1, 1000);
const models = [], shots = [], checks = [], memory = [];
const observation = code => ({ code, confidence: 2, sources: 3, texture: 40, coherence: 180, greenFraction: .8, brightness: 125 });
const signature = group => JSON.stringify(group.children.map(m => [m.name, [...m.geometry.attributes.position.array], m.instanceMatrix ? [...m.instanceMatrix.array] : null]));

function record(key, label, root, evidence = null) {
  renderer.render(scene, camera);
  const src = renderer.domElement.toDataURL('image/png'); shots.push({ key, src });
  const parts = [];
  root.updateMatrixWorld(true);
  root.traverse(node => {
    if (!node.isMesh) return;
    const pos = node.geometry.attributes.position, color = node.geometry.attributes.color;
    for (let k = 0; k < (node.isInstancedMesh ? node.count : 1); k++) {
      const matrix = node.matrixWorld.clone();
      if (node.isInstancedMesh) { const local = new THREE.Matrix4(); node.getMatrixAt(k, local); matrix.multiply(local); }
      const vertices = [], vector = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        vector.fromBufferAttribute(pos, i).applyMatrix4(matrix); vertices.push(...vector.toArray());
      }
      if (!vertices.every(Number.isFinite)) throw Error(key + ': non-finite geometry');
      parts.push({ vertices, faces: node.geometry.index ? [...node.geometry.index.array] : Array.from({ length: pos.count }, (_, i) => i),
        colors: color ? [...color.array] : null, color: node.material.color.toArray() });
    }
  });
  models.push({ key, label, parts: parts.slice(1), ground: parts[0], sectioned: false, shoreEvidence: evidence });
  const figure = document.createElement('figure'); if (key.startsWith('library')) figure.className = 'context';
  const image = document.createElement('img'); image.src = src; figure.append(image);
  const caption = document.createElement('figcaption'); caption.textContent = label; figure.append(caption); document.querySelector('#gallery').append(figure);
}

function ground(root, heightAt, width, depth, water = false) {
  const geo = new THREE.PlaneGeometry(width, depth, 64, 64); geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals(); root.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color:0x899379,roughness:.9})));
  if (water) {
    const sea = new THREE.PlaneGeometry(width, depth); sea.rotateX(-Math.PI / 2); sea.translate(0, .01, 0);
    root.add(new THREE.Mesh(sea, new THREE.MeshStandardMaterial({color:0x437989,roughness:.35})));
  }
}

try {
  const types = ['sea', 'lake', 'reservoir', 'pond', 'river', 'stream', 'canal', 'drain', 'ditch', 'basin', 'lagoon', 'tidal'];
  for (const type of types) {
    const root = new THREE.Group(); scene.add(root);
    const bounds = { minX: -60, maxX: 60, minZ: -30, maxZ: 30 };
    const channel = ['river','stream','canal','drain','ditch','tidal'].includes(type);
    const rounded = ['lake','reservoir','pond','basin'].includes(type);
    const width = {river:18,stream:5,canal:12,drain:3,ditch:1.5,tidal:10}[type];
    const curve = x => ['river','stream','tidal'].includes(type) ? Math.sin(x*.045)*4 : 0;
    const heightAt = channel ? (x,z)=>Math.max(-1.4,Math.min(.4,(Math.abs(z-curve(x))-width/2)*.15))
      : rounded ? (x,z)=>Math.max(-1.5,Math.min(.4,(Math.hypot(x/34,z/18)-1)*2)) : (x,z)=>z*.06;
    const evidenceAt = (x,z)=>observation(heightAt(x,z)<=0?80:['pond','stream','ditch','basin','lake'].includes(type)?30:50);
    const tags = type === 'sea' ? { natural: 'coastline' } : type === 'tidal' ? { waterway: 'tidal_channel', tidal: 'yes' } : { natural: 'water', water: type };
    const ring = rounded ? Array.from({length:64},(_,i)=>[Math.cos(i*Math.PI/32)*34,Math.sin(i*Math.PI/32)*18])
      : [[-65,-35],[65,-35],[65,0],[-65,0]];
    const areas = channel||type==='sea'?[]:[{sourceId:type,tags,classification:classifyArea(tags),worldPolygons:[{outer:ring,holes:[]}]}];
    const lines = channel ? [{tags:{waterway:type==='tidal'?'tidal_channel':type,width:String(width)},
      points:Array.from({length:21},(_,i)=>[-60+i*6,curve(-60+i*6)])}]
      : type==='sea'?[{tags,points:[[-60,0],[60,0]]}]:[];
    const classifier = createShoreClassifier({ areas, lines, evidenceAt });
    const anchors = planShoreAnchors({ bounds, heightAt, waterY: 0, classifyAt: classifier, lines });
    if (!anchors.length || anchors.some(a => a.type !== type)) throw Error('Missing shore type: ' + type);
    const points = type === 'sea' ? [{x:-25,z:5,tags:{emergency:'life_ring'}},{x:25,z:5,tags:{emergency:'lifeguard_tower'}}]
      : ['drain','ditch'].includes(type) ? [{x:0,z:width/2+4,tags:{waterway:'sluice_gate'}}]
      : type==='basin'?[{x:0,z:22,tags:{man_made:'pumping_station'}}]:[];
    const occupied = makeFootprintIndex();
    const args = { anchors, areas, points, bounds, heightAt, evidenceAt, seed: 77,
      fits: foot => !occupied.near(foot, 1), reserve: foot => occupied.add(foot) };
    const rows = planShoreFacilities(args);
    if (!rows.length) throw Error('Missing facilities: ' + type);
    ground(root,heightAt,120,60,true);
    const batch = new THREE.Group(); root.add(batch); buildShoreFacilities(batch, rows);
    const replay = new THREE.Group(); buildShoreFacilities(replay, rows);
    if (signature(batch) !== signature(replay)) throw Error(type + ': renderer replay changed'); disposeTree(replay);
    camera.position.set(15,78,100); camera.lookAt(0,0,0);
    record(type, type + ' · ' + rows.length + ' fitted facilities · OSM + satellite water support', root, { anchors, rows });
    checks.push({type,anchors:anchors.length,facilities:rows.length,draws:renderer.info.render.calls});
    scene.remove(root); disposeTree(root); renderer.render(scene,camera); memory.push({...renderer.info.memory});
  }
  for (let variant = 0; variant < SHORELINE.VARIANTS; variant++) {
    const root = new THREE.Group(); scene.add(root); ground(root,()=>-.02,44,25);
    for (const [i, kind] of Object.keys(SHORE_FACILITIES).entries()) {
      const mesh = new THREE.Mesh(shoreGeometry(kind,variant),envMat(0xffffff,{vertexColors:true}));
      mesh.position.set((i%7-3)*5.5,0,Math.floor(i/7)*5.5-8); root.add(mesh);
    }
    camera.position.set(18,36,43); camera.lookAt(0,0,0);
    record('library-'+variant,'Facility library · variant '+(variant+1)+' · '+Object.keys(SHORE_FACILITIES).join(', '),root);
    scene.remove(root); disposeTree(root); renderer.render(scene,camera); memory.push({...renderer.info.memory});
  }
  // Exercise the actual habitat seam, including reservation and low-power teardown.
  let fullShore = null;
  for (let i = 0; i < 4; i++) {
    const root = new THREE.Group(), bounds = { minX:-60,maxX:60,minZ:-30,maxZ:30 };
    const terrain = {...bounds,baseWaterY:0,waterY:i===2?.2:0,gridM:2,heightAt:(x,z)=>z*.06,evidenceAt:(x,z)=>observation(z>0?50:80)};
    const stats = buildHabitatScene(root,terrain,{seed:77,surfaceField:{sample:(x,z)=>z>0?'urban':'water'},
      shoreLines:[{tags:{natural:'coastline'},points:[[-60,0],[60,0]]}],
      roadClear:()=>false,envCodeAt:(x,z)=>z<=0?1:0,isBlocked:()=>false,low:!!(i%2),procedural:i===3});
    if(!stats.shoreline.instances) throw Error('Habitat shore seam omitted all facilities');
    const shore = root.children.filter(m=>m.name.startsWith('shore/')).map(m=>[m.name,[...m.instanceMatrix.array]]);
    if(i===0)fullShore=JSON.stringify(shore);
    else if(i<3&&JSON.stringify(shore)!==fullShore)throw Error('Low-power or tidal presentation moved shore facilities');
    if(i===3){
      if(!root.children.some(m=>m.name.startsWith('shore/')&&SHORE_FACILITIES[m.name.split('/')[1]].mapped))throw Error('Procedural facility pool omitted infrastructure');
      checks.push({type:'procedural-habitat',...stats.shoreline});
    }
    scene.add(root); renderer.render(scene,camera); scene.remove(root); disposeTree(root); renderer.render(scene,camera);
    memory.push({...renderer.info.memory});
  }
  if(memory.some(m=>m.geometries!==memory[0].geometries||m.textures!==memory[0].textures)) throw Error('Shore GPU resources leaked');
  window.__shoreReview = { models, shots, checks, memory };
} catch (error) { window.__shoreError = error.stack; throw error; }
