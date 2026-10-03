import * as THREE from 'three';
import { makeUnit, measureBox } from '/public/js/models.js';
import { buildBaseBattery } from '/public/js/buildingUnitModels.js';
import { stepCombatFx, stepLocomotion } from '/public/js/locomotion.js';
import { fireUnitMotion, stepUnitSpinners } from '/public/js/unitMotion.js';
import { disposeTree, setCelSun, updateCelLight } from '/public/js/toon.js';
import { FACTION_ASSETS } from '/public/js/forge/factionAssets.js';

const controls = Object.fromEntries(['role', 'motion', 'view', 'bones', 'pause'].map(id => [id, document.getElementById(id)]));
const roles = [...new Set(Object.keys(FACTION_ASSETS).map(id => id.split('_')[1]))].filter(role => !['turret', 'battery'].includes(role));
controls.role.innerHTML = roles.map(role => `<option value="${role}">${role}</option>`).join('');
let paused = false, now = 0, previous = 0;
const stages = ['SWARM', 'STEEL'].map(side => {
  const canvas = document.getElementById(side.toLowerCase());
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(720, 540, false); renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(), sun = new THREE.DirectionalLight(0xfff3dc, 2);
  sun.position.set(20, 40, 30);
  const ambient = new THREE.HemisphereLight(0xf5f3e9, 0x54636b, 1.5);
  scene.add(sun, ambient);
  return { side, renderer, scene, sun, ambient, camera: new THREE.PerspectiveCamera(36, 4 / 3, .01, 3000),
    silhouette: new THREE.MeshBasicMaterial({ color: 0x20272d }), root: null, lastShot: -1 };
});
setCelSun(stages[0].sun.position.clone().normalize());

function load() {
  const role = controls.role.value;
  for (const stage of stages) {
    if (stage.root) { stage.scene.remove(stage.root); disposeTree(stage.root); }
    const kind = role === 'base' ? `base:${stage.side}` : ['tower', 'bunker'].includes(role) ? role : `creep:${role}`;
    const root = makeUnit(kind, stage.side, { ring: false }).group;
    if (role === 'base') {
      const battery = buildBaseBattery(stage.side, measureBox(root).max.y);
      root.add(battery); root.userData.rig.attacks = battery.userData.attacks;
    }
    stage.root = root; stage.ent = { id: 1, kind: role, mesh: root }; stage.lastShot = -1;
    stage.scene.add(root);
    const bounds = measureBox(root);
    stage.center = bounds.getCenter(new THREE.Vector3());
    stage.distance = bounds.getSize(new THREE.Vector3()).length() * 1.65;
    let meshes = 0, triangles = 0;
    root.traverse(node => {
      if (!node.isMesh || node.userData.isOutline || node.userData.presentationEffect) return;
      meshes++; triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3 * (node.isInstancedMesh ? node.count : 1);
    });
    document.getElementById(stage.side.toLowerCase() + '-metric').textContent = `${meshes} mesh batches · ${Math.round(triangles).toLocaleString()} triangles`;
  }
  window.__factionReview = { roles, stages, select: (role, motion = 'idle', view = 'front') => {
    controls.role.value = role; controls.motion.value = motion; controls.view.value = view; load();
  }, setPaused: value => { paused = value; }, tick: (dt = 1 / 60) => { now += dt; render(dt); } };
}

function render(dt) {
  for (const stage of stages) {
    const { root, ent, camera, scene, center, distance } = stage;
    const rig = root.userData.rig, motion = controls.motion.value, view = controls.view.value;
    const shot = Math.floor(now / 1.35);
    if (motion === 'fire' && shot !== stage.lastShot) {
      const attacks = rig.attacks || [], attack = attacks[shot % Math.max(1, attacks.length)];
      if (attack) fireUnitMotion(rig, attack.muzzles[0], now);
      ent.fireFx = { t0: now, slot: 'light' }; stage.lastShot = shot;
    }
    if (motion === 'aim') ent.fireFx = { t0: now, slot: 'light' };
    const z = root.position.z;
    if (motion === 'run' && rig.kind !== 'static') root.position.z += dt * 5;
    stepCombatFx(ent, now, dt); stepUnitSpinners(root.userData.spin, dt);
    stepLocomotion(ent, dt, now, root.position.x, z, root.rotation.y);
    root.position.z = z;
    root.traverse(node => { if (node.isSkeletonHelper) node.visible = controls.bones.checked; });
    const yaw = view === 'back' ? Math.PI * .8 : view === 'side' ? Math.PI / 2 : Math.PI * .2;
    camera.position.copy(center).add(view === 'top' ? new THREE.Vector3(.01, distance, .01)
      : new THREE.Vector3(Math.sin(yaw) * distance, distance * .27, Math.cos(yaw) * distance));
    camera.lookAt(center); camera.updateMatrixWorld(true);
    const night = view === 'night';
    stage.ambient.intensity = night ? .24 : 1.5; stage.sun.intensity = night ? .18 : 2;
    scene.background = new THREE.Color(night ? 0x18232d : 0xc9cdc9);
    scene.overrideMaterial = view === 'silhouette' ? stage.silhouette : null;
    updateCelLight(camera); stage.renderer.render(scene, camera);
  }
}
controls.role.onchange = load;
controls.pause.onclick = () => { paused = !paused; controls.pause.textContent = paused ? 'Resume' : 'Pause'; };
try {
  load();
  function animate(time) {
    const dt = Math.min(.04, previous ? (time - previous) / 1000 : 1 / 60); previous = time;
    if (!paused) now += dt;
    render(paused ? .000001 : dt); requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
} catch (error) { document.getElementById('error').textContent = error.message; throw error; }
