import * as THREE from 'three';
import { buildRoads } from '../../public/js/biomes.js';
import { buildHabitatScene } from '../../public/js/habitatRender.js';
import { walkwayGeometry } from '../../public/js/walkwayRender.js';
import { WALKWAY_SURFACES, WALKWAY_FURNITURE } from '../../public/js/walkwayCatalog.js';
import { sceneFurnitureParts } from '../../public/js/sceneFurnitureParts.js';
import { compileSceneParts } from '../../public/js/scenePropModels.js';
import { makeFootprintIndex } from '../../public/js/ground.js';
import { envMat, disposeTree, setCelSun, setLandField } from '../../public/js/toon.js';
import { buildLandField } from '../../public/js/landfield.js';
import { mulberry32 } from '../../public/js/rng.js';
import { xzToLL } from '../../public/js/data.js';

const center = { lat: 25, lng: 121, rot: 0 }, renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(1100, 660); renderer.setPixelRatio(1);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xc0cdc4);
scene.add(new THREE.HemisphereLight(0xffffff, 0x817860, .8));
const light = new THREE.DirectionalLight(0xfff1d5, 1.1); light.position.set(-30, 60, 35); scene.add(light); setCelSun(light.position);
const camera = new THREE.PerspectiveCamera(40, 1100 / 660, .1, 1000);
const models = [], shots = [], checks = [], textures = {}, memory = [];
const obs = code => ({ code, confidence: 2, sources: 6, texture: 100, coherence: 180,
  greenFraction: code === 50 ? .05 : .8, grayFraction: .7, brightness: 130, landform: 1 });
const road = (points, tags) => ({ tags, geometry: points.map(([x,z]) => { const [lat,lon] = xzToLL(x,z,center); return { lat,lon }; }) });
const signature = group => {
  const rows = [];
  group.traverse(node => {
    if (!node.isMesh) return;
    for (const attr of Object.values(node.geometry.attributes)) if (![...attr.array].every(Number.isFinite)) throw Error('Non-finite geometry');
    rows.push([node.name, [...node.geometry.attributes.position.array], node.instanceMatrix ? [...node.instanceMatrix.array] : null]);
  });
  return JSON.stringify(rows);
};

function record(key, label, root, context = false) {
  renderer.render(scene, camera);
  const src = renderer.domElement.toDataURL('image/png'); shots.push({ key, src });
  const geometry = [];
  root.updateMatrixWorld(true);
  root.traverse(node => {
    if (!node.isMesh) return;
    if (node.name.startsWith('habitat/') && node.name.split('/').length > 2 && !node.name.startsWith('habitat/street-verges/')) return;
    const pos = node.geometry.attributes.position, colors = node.geometry.attributes.color, uv = node.geometry.attributes.uv;
    const material = Array.isArray(node.material) ? node.material[0] : node.material;
    let texture = null;
    if (material.map?.image?.toDataURL) {
      texture = key + '-' + Object.keys(textures).length;
      textures[texture] = material.map.image.toDataURL('image/png');
    }
    const count = node.isInstancedMesh ? node.count : 1;
    for (let instance = 0; instance < count; instance++) {
      const matrix = node.matrixWorld.clone();
      if (node.isInstancedMesh) { const local = new THREE.Matrix4(); node.getMatrixAt(instance, local); matrix.multiply(local); }
      const vertices = [], colorValues = [], vector = new THREE.Vector3(), color = new THREE.Color();
      if (node.instanceColor) node.getColorAt(instance, color);
      for (let i = 0; i < pos.count; i++) {
        vector.fromBufferAttribute(pos, i).applyMatrix4(matrix); vertices.push(...vector.toArray());
        if (colors) colorValues.push(colors.getX(i) * color.r, colors.getY(i) * color.g, colors.getZ(i) * color.b);
      }
      geometry.push({ vertices, faces: node.geometry.index ? [...node.geometry.index.array] : Array.from({ length: pos.count }, (_, i) => i),
        colors: colors ? colorValues : null, color: material.color.toArray().map((v,i) => v * (colors ? 1 : color.toArray()[i])),
        texture, uvs: uv ? [...uv.array] : null });
    }
  });
  models.push({ key, label, parts: geometry.slice(1), ground: geometry[0], sectioned: false,
    camera: camera.position.toArray(), target: camera.userData.target });
  const figure = document.createElement('figure'); if (context) figure.className = 'context';
  const image = document.createElement('img'); image.src = src; figure.append(image);
  const caption = document.createElement('figcaption'); caption.textContent = label; figure.append(caption); document.querySelector('#gallery').append(figure);
}

function ground(root, terrain, color) {
  const geo = new THREE.PlaneGeometry(terrain.worldW, terrain.worldH, 48, 48); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrain.heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals(); root.add(new THREE.Mesh(geo, envMat(color, { land: true, rim: 0 })));
}

async function surfaceField(terrain, zone) {
  const field = await buildLandField({terrain,center,areas:[],classifyPureAt:()=>zone,envCodeAt:()=>0,projectAt:()=>[0,0],seed:789});
  setLandField(field.data,field.nx,field.nz,field.bounds,field.appearance);
  return field;
}

try {
  for (const key of Object.keys(WALKWAY_SURFACES)) {
    const root = new THREE.Group(); scene.add(root);
    const terrain = { minX: -60, maxX: 60, minZ: -40, maxZ: 40, worldW: 120, worldH: 80, gridM: 120 / 48,
      heightAt: () => 4, natureAt: () => 4, envCodeAt: () => 0, sampleColor: () => [90,105,80], evidenceAt: () => obs(30) };
    await surfaceField(terrain,'green'); ground(root, terrain, 0x849275);
    const result = buildRoads(root, [road([[-20,0],[20,0]], { highway: 'pedestrian', surface: key })], terrain, center, null, mulberry32(71));
    if (!result.built || !root.children.some(m => m.userData.walkwaySurface?.key === key)) throw Error('Missing production surface: ' + key);
    camera.position.set(10, 21, 28); camera.lookAt(0,4,0); camera.userData.target = [0,4,0];
    record(key, key.replaceAll('_',' ') + ' · OSM surface tag', root);
    checks.push({ key, built: result.built, draws: renderer.info.render.calls });
    scene.remove(root); disposeTree(root);
  }
  for (const name of ['urban-sidewalks','park-path','forest-trail']) {
    const urban = name === 'urban-sidewalks', forest = name === 'forest-trail', zone = urban ? 'urban' : 'green';
    const tags = urban ? { highway: 'residential', lanes: '2', sidewalk: 'both', 'sidewalk:left:width': '2',
      'sidewalk:left:surface': 'bricks', 'sidewalk:right:surface': 'concrete', 'sidewalk:left:tactile_paving': 'yes', 'sidewalk:right:kerb': 'lowered' }
      : { highway: 'path', surface: forest ? 'ground' : 'wood', handrail: forest ? 'no' : 'yes' };
    const terrain = { minX: -65, maxX: 65, minZ: -40, maxZ: 40, worldW: 130, worldH: 80, gridM: 130 / 48,
      heightAt: (x,z) => 4 + x * .025 + z * .01, natureAt: () => 4, envCodeAt: () => 0,
      sampleColor: () => urban ? [110,110,110] : [80,115,65], evidenceAt: () => obs(urban ? 50 : forest ? 10 : 30) };
    const field = await surfaceField(terrain,zone);
    const root = new THREE.Group(); scene.add(root); ground(root, terrain, urban ? 0xb0ada0 : 0x83936c);
    const hw = urban ? 3.2 : 1.1;
    const roads = [{ a: [-58,0], b: [58,0], hw: hw + 1.5, tags }];
    const roadIndex = makeFootprintIndex([{ x:0,z:0,hw:58,hd:hw+1.5,ry:0,r:Math.hypot(58,hw+1.5) }]);
    const points = urban ? [{x:-30,z:14,tags:{amenity:'bench'}},{x:0,z:-12,tags:{amenity:'bicycle_parking'}},
      {x:30,z:13,tags:{amenity:'drinking_water'}}] : [{x:20,z:12,tags:{leisure:'picnic_table'}}, {x:-24,z:-12,tags:{tourism:'information',information:'guidepost'}}];
    const args = { surfaceField: field, seed: 789, roadSegments: roads, walkwayPoints: points,
      roadClear: (_x,_z,foot) => roadIndex.near(foot), envCodeAt: () => 0, isBlocked: () => false };
    const batch = new THREE.Group(); root.add(batch); const stats = buildHabitatScene(batch, terrain, args);
    const replay = new THREE.Group(); buildHabitatScene(replay, terrain, args);
    if (signature(batch) !== signature(replay)) throw Error(name + ': renderer replay changed'); disposeTree(replay);
    const low = new THREE.Group(), lowStats = buildHabitatScene(low, terrain, {...args,low:true});
    low.traverse(node => {
      if (!node.isMesh) return;
      const full = batch.children.find(child => child.name === node.name);
      const a = node.instanceMatrix?.array || node.geometry.attributes.position.array;
      const b = full?.instanceMatrix?.array || full?.geometry.attributes.position.array;
      if (!b || [...a].some((v,i) => v !== b[i])) throw Error(name + ': low-power layout changed');
    }); disposeTree(low);
    buildRoads(root, [road([[-58,0],[58,0]], tags)], terrain, center, null, mulberry32(71));
    if (urban && stats.walkway.materials !== 2 || !urban && stats.walkway.pathAnchors < 1) throw Error('Missing context paths or sidewalks');
    camera.position.set(10,76,83); camera.lookAt(0,4,0); camera.userData.target = [0,4,0];
    record(name, urban ? 'Urban sidewalks · left brick, right concrete · tactile strip, drains, mapped furniture'
      : forest ? 'Forest trail · ground surface · coordinate-seeded benches and trail markers'
        : 'Park boardwalk · fitted wooden handrails · mapped picnic table and guidepost', root, true);
    checks.push({ name, stats, lowStats, draws: renderer.info.render.calls });
    scene.remove(root); disposeTree(root); renderer.render(scene,camera); memory.push({...renderer.info.memory});
  }
  const root = new THREE.Group(); scene.add(root);
  const floor = new THREE.PlaneGeometry(36,24); floor.rotateX(-Math.PI/2); floor.translate(0,-.02,0);
  root.add(new THREE.Mesh(floor,envMat(0x9ba596)));
  for (const [i,kind] of Object.keys(WALKWAY_FURNITURE).entries()) {
    const geo = kind === 'bench' || kind === 'planter' ? compileSceneParts(sceneFurnitureParts(kind)) : walkwayGeometry(kind);
    const mesh = new THREE.Mesh(geo,envMat(0xffffff,{vertexColors:true})); mesh.position.set((i%5-2)*6,0,Math.floor(i/5)*8-4); root.add(mesh);
  }
  camera.position.set(8,25,30); camera.lookAt(0,0,0); camera.userData.target = [0,0,0];
  record('facilities','Facility library · bench, planter, bin, bicycle rack, bollard, fountain, picnic table, shelter, information board, trail marker',root,true);
  scene.remove(root); disposeTree(root);
  window.__walkwayReview = { models, shots, checks, textures, memory };
} catch (error) { window.__walkwayError = error.stack; throw error; }
