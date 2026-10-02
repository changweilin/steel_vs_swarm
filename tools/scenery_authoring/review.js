import * as THREE from 'three';
import { makeUnit } from '../../public/js/models.js';
import { generateCivilian } from '../../public/js/civilianAppearance.js';
import { furnitureSceneGeometry, compileSceneParts } from '../../public/js/scenePropModels.js';
import { groundPlantParts } from '../../public/js/scenePlantParts.js';
import { buildVegMeshes } from '../../public/js/biomes.js';
import { sceneryGeometry } from '../../public/js/sceneryGeometry.js';
import { generateGroundPart } from '../../public/js/proceduralGroundParts.js';
import { GROUND_PARTS } from '../../public/js/groundPartCatalog.js';
import { disposeTree } from '../../public/js/toon.js';
import { setVisualPref } from '../../public/js/visualPrefs.js';

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
      vertexColors: !!old.vertexColors, side: THREE.DoubleSide });
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
try {
  // The plain inspection material cannot execute the game's billboard vertex shader.
  setVisualPref('leafCard', 'off');
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
  window.__sceneryReview = { ready: true, report, models };
} catch (error) { window.__sceneryReview = { error: error.stack }; }
