// Presentation joints only. Muzzle anchors stay inside the moving assembly.
import * as THREE from 'three';

export function partJoint(parent, name, position, parts) {
  const joint = new THREE.Group();
  joint.name = name;
  joint.position.set(...position);
  parent.add(joint);
  parent.updateWorldMatrix(true, true);
  for (const part of parts) joint.attach(part);
  return joint;
}

export function limbChain(limb, splitY, footY = null, proximalCount = 1) {
  // Builders order proximal pieces first and the foot last; attachments follow the distal joint.
  const distal = limb.children.slice(proximalCount);
  const joint = partJoint(limb, footY == null ? 'elbow' : 'knee', [0, splitY, 0], distal);
  const chain = [{ g: joint, base: 0, k: footY == null ? -0.7 : 0.8, d: 0.2 }];
  if (footY != null) {
    const foot = partJoint(joint, 'ankle', [0, footY - splitY, 0], [distal.at(-1)]);
    chain.push({ g: foot, base: 0, k: -0.35, d: 0.45 });
  }
  return chain;
}

export function recoilMount(parent, parts, muzzles, travel, lift = 0.035) {
  const node = partJoint(parent, 'recoil', [0, 0, 0], parts);
  return { node, muzzles, travel, lift, firedAt: -Infinity };
}
