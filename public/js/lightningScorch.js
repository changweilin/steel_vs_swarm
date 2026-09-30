import * as THREE from 'three';
import { toonMat } from './toon.js';

// Child shells follow articulated parts without editing shared paint or damage materials.
export function syncLightningScorch(entity, active) {
  if (!entity.mesh) return;
  if (!active) { releaseLightningScorch(entity); return; }
  if (entity.weatherScorch) {
    for (const shell of entity.weatherScorch.shells) shell.geometry = shell.parent.geometry;
    return;
  }
  const nodes = [];
  entity.mesh.traverse(node => {
    if (node.isMesh && !node.userData.isOutline && !node.userData.teamRing && !node.userData.weatherScorch
      && node.material?.userData?.celOpts && !node.material.transparent) nodes.push(node);
  });
  const material = toonMat(0x171310, { transparent: true, opacity: .82, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, rim: 0 });
  const shells = nodes.map(node => {
    const shell = node.isSkinnedMesh ? new THREE.SkinnedMesh(node.geometry, material) : new THREE.Mesh(node.geometry, material);
    if (node.isSkinnedMesh) { shell.bindMode = node.bindMode; shell.bind(node.skeleton, node.bindMatrix); }
    if (node.morphTargetInfluences) shell.morphTargetInfluences = node.morphTargetInfluences;
    shell.userData.weatherScorch = true;
    shell.userData.noOutline = true;
    shell.renderOrder = node.renderOrder + 1;
    node.add(shell);
    return shell;
  });
  entity.weatherScorch = { material, shells };
}

export function releaseLightningScorch(entity) {
  if (!entity.weatherScorch) return;
  for (const shell of entity.weatherScorch.shells) shell.removeFromParent();
  // Geometry belongs to the original rig, including any damage deformation.
  entity.weatherScorch.material.dispose();
  delete entity.weatherScorch;
}
