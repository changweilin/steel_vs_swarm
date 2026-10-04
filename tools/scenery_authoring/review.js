import * as THREE from 'three';
import { makeUnit } from '../../public/js/models.js';
import { generateCivilian } from '../../public/js/civilianAppearance.js';
import { furnitureSceneGeometry, compileSceneParts, scenePartGeometry } from '../../public/js/scenePropModels.js';
import { environmentParts, environmentSize, iceFloeParameters, icebergParameters, linearEnvironmentParts, storageTankParts } from '../../public/js/environmentParts.js';
import { groundPlantParts } from '../../public/js/scenePlantParts.js';
import { buildVegMeshes } from '../../public/js/biomes.js';
import { sceneryGeometry } from '../../public/js/sceneryGeometry.js';
import { generateGroundPart } from '../../public/js/proceduralGroundParts.js';
import { GROUND_PARTS } from '../../public/js/groundPartCatalog.js';
import { disposeTree } from '../../public/js/toon.js';
import { setVisualPref } from '../../public/js/visualPrefs.js';
import { geologyBackgroundObject, elongatedGeologyMesh } from '../../public/js/geology.js';
import { GEOLOGY_MORPHOLOGIES, geologyMorphology } from '../../public/js/geologyMorphology.js';

const report = [], models = [];
function render(root, key, label) {
  root.updateMatrixWorld(true);
  const parts = [], oldMaterials = new Set();
  root.traverse(node => {
    if (!node.isMesh || node.userData.isOutline) return;
    const old = node.material;
    if (Array.isArray(old)) throw Error('Unexpected review material array');
    oldMaterials.add(old);
    node.material = new THREE.MeshStandardMaterial({ color: old.color, roughness: .78,
      vertexColors: !!old.vertexColors, side: THREE.DoubleSide, transparent: old.transparent, opacity: old.opacity });
    const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
    const position = geometry.attributes.position, colors = geometry.attributes.color;
    parts.push({ vertices: Array.from(position.array),
      faces: geometry.index ? Array.from(geometry.index.array) : Array.from({ length: position.count }, (_, i) => i),
      colors: old.vertexColors && colors ? Array.from(colors.array) : null, color: old.color.toArray() });
    geometry.dispose();
  });
  for (const material of oldMaterials) material.dispose();
  root.traverse(node => { if (node.userData.isOutline) node.visible = false; });
  models.push({ key, parts });
  const scene = new THREE.Scene(); scene.add(root);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x657486, 2.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2.8); sun.position.set(5, 9, 4); scene.add(sun);
  const box = new THREE.Box3();
  root.traverse(node => {
    if (!node.isMesh || node.userData.isOutline) return;
    node.geometry.computeBoundingBox(); box.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld));
  });
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z), camera = new THREE.PerspectiveCamera(32, 360 / 300, .01, span * 12);
  const angle = key.startsWith('civilian') ? new THREE.Vector3(.35, .16, 1.5) : new THREE.Vector3(1, .65, 1.25);
  camera.position.copy(center).add(angle.normalize().multiplyScalar(span * 2.2)); camera.lookAt(center);
  if (key.startsWith('ice')) {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(span * 2, span * 2), new THREE.MeshStandardMaterial({
      color: 0x347b99, roughness: .36, transparent: true, opacity: .5, depthWrite: false, side: THREE.DoubleSide,
    }));
    sea.rotation.x = -Math.PI / 2;
    root.add(sea);
  }
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(360, 300); renderer.setClearColor(0xd5dce2); renderer.render(scene, camera);
  const card = document.createElement('div'); card.className = 'card';
  const preview = new Image(); preview.src = renderer.domElement.toDataURL(); preview.alt = label;
  const text = document.createElement('div'); text.className = 'label'; text.textContent = label;
  card.append(preview, text); document.getElementById('grid').append(card);
  const triangles = parts.reduce((sum, part) => sum + part.faces.length / 3, 0);
  report.push({ key, triangles, size: size.toArray() });
  disposeTree(root); renderer.dispose(); renderer.forceContextLoss();
}

function colored(geometry) {
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true }));
}
function environmentModel(parts) {
  const root = new THREE.Group();
  for (const part of parts) {
    const geometry = scenePartGeometry(part);
    geometry.translate(0, -(part.waterline || 0), 0);
    root.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: part.c ?? 0xffffff, vertexColors: part.c == null && !!geometry.attributes.color,
      transparent: part.mat === 'glass', opacity: part.mat === 'glass' ? .35 : 1,
    })));
  }
  return root;
}
try {
  // The plain inspection material cannot execute the game's billboard vertex shader.
  setVisualPref('leafCard', 'off');
  const query = new URLSearchParams(location.search);
  if (query.has('geology-variants')) {
    document.querySelector('h1').textContent = '地質與山峰：依岩性限制的隨機輪廓';
    for (const [type, families] of Object.entries(GEOLOGY_MORPHOLOGIES)) for (const family of families) {
      let seed = 0;
      while (seed < 1024 && geologyMorphology(type, seed).family !== family) seed++;
      if (seed === 1024) throw Error('Missing morphology: '+type+'/'+family);
      const entry = geologyBackgroundObject(type, seed, { vegetation: 0, moisture: 0, wind: 0, exposure: 0, strike: 0 });
      render(environmentModel([{ g: ['mesh', entry.meshData] }]), `geology/${type}/${seed}`, `${type} · ${family} · seed ${seed}`);
      Object.assign(models.at(-1), { seed, type, shape: family, morphology: entry.generation.parameters.morphology });
      if (type !== 'mountain') continue;
      const mesh = elongatedGeologyMesh(type, seed, { len: 80, depth: 16, height: 14, bufferDepth: 35 });
      render(environmentModel([{ g: ['mesh', mesh.meshData] }, { g: ['mesh', mesh.bufferMeshData], p: [0,0,-25.5] }]),
        `geology/boundary/${seed}`, `山脈與緩衝區 · ${family} · seed ${seed}`);
      Object.assign(models.at(-1), { seed, type, shape: family, morphology: mesh.morphology, boundary: true });
    }
  } else if (query.has('ice-variants') || query.has('iceberg-variants')) {
    const kind = query.has('iceberg-variants') ? 'iceberg' : 'icefloe';
    document.querySelector('h1').textContent = kind === 'iceberg' ? '冰山：隨機輪廓與峰形' : '浮冰：隨機輪廓與尺寸';
    for (let seed = 0; seed < (kind === 'iceberg' ? 21 : 18); seed++) {
      const parameters = kind === 'iceberg' ? icebergParameters(seed) : iceFloeParameters(seed);
      const size = environmentSize(kind, seed);
      render(environmentModel(environmentParts(kind, { size, seed })), kind+'/'+seed,
        `${parameters.shape} · seed ${seed}`);
      Object.assign(models.at(-1), { seed, shape: parameters.shape });
    }
  } else if (query.has('environment')) {
    document.querySelector('h1').textContent = '冰體與產業設備：低面數模型';
    let baseline = null;
    if (new URLSearchParams(location.search).has('compare')) {
      const response = await fetch('./environment-before.json');
      if (!response.ok) throw Error('Missing environment baseline');
      baseline = await response.json();
    }
    for (const kind of ['icefloe','iceberg','powerplant','incinerator','greenhouse','ranch','oilfield','windland','windsea']) {
      if (baseline) {
        const before = baseline.find(row => row.kind === kind && row.seed === 42);
        if (!before) throw Error('Missing baseline: '+kind);
        render(environmentModel(before.rows), kind+'/before', kind+' · 修改前');
      }
      const rows = kind.startsWith('wind') ? linearEnvironmentParts(kind, {len:60,depth:24,h:30,seed:42}) : environmentParts(kind,{seed:42});
      render(environmentModel(rows), kind+'/after', kind+' · 修改後');
    }
    render(environmentModel(storageTankParts({w:14,h:18,d:14,seed:42})), 'tankfarm/after', '儲槽 · 修改後');
  } else {
  for (const [seed, profile] of [[1,1], [2,2], [3,3], [9,9], [22,2], [53,13], [94,14], [140,0]]) {
    const appearance = generateCivilian(seed, profile);
    render(makeUnit('civ', 'STEEL', { ch: profile, appearanceSeed: seed, ring: false }).group,
      'civilian/'+seed, `${appearance.occupation} · ${appearance.hairStyle} / ${appearance.clothing}`);
  }
  for (const kind of ['bench','planter','crate','streetlamp','signal','windturbine','transformer','acbox','scaffold','solar','conveyor','buoy'])
    render(colored(furnitureSceneGeometry(kind)), kind, kind);
  for (const kind of ['redcap','parasol']) render(colored(compileSceneParts(groundPlantParts(kind,42))), kind, kind);
  for (const type of ['holmOak','dougfir']) {
    const root = new THREE.Group(); root.add(...buildVegMeshes(type, [{ x:0,y:0,z:0,s:1 }], 'summer'));
    render(root, type, type);
  }
  render(new THREE.Mesh(sceneryGeometry('stone', [1.4,.9,1.2]), new THREE.MeshStandardMaterial({color:0x8f8b80})), 'stone', 'stone');
  for (const family of ['bin','picnic','tent']) {
    const type = Object.keys(GROUND_PARTS).find(key => GROUND_PARTS[key][0] === family);
    const root = new THREE.Group();
    for (const part of generateGroundPart(type, 2)) root.add(new THREE.Mesh(part.geo, new THREE.MeshStandardMaterial({ color: part.c })));
    render(root, type, family);
  }
  }
  window.__sceneryReview = { ready: true, report, models };
} catch (error) { window.__sceneryReview = { error: error.stack }; }
