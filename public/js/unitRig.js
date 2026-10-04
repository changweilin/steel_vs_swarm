// Presentation joints only. Muzzle anchors stay inside the moving assembly.
import * as THREE from 'three';
import { mat } from './geo3d.js';
import { stepVehicleMotion } from './unitMotion.js';

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

/** Wheels retain their spin frame; suspension and steering belong to the axle above it. */
export function equipVehicleMotion(rig) {
  if (!rig?.wheels?.length || rig.suspension) return;
  rig.suspension = [];
  const front = Math.max(...rig.wheels.map(w => w.m.position.z));
  for (const w of rig.wheels) {
    const p = w.m.position.clone();
    const mount = partJoint(w.m.parent, 'axle', p.toArray(), [w.m]);
    rig.suspension.push({ mount, x: p.x, y: p.y, z: p.z, radius: w.r,
      steer: rig.kind === 'wheeled' && p.z === front });
  }
  if (rig.kind !== 'tracked') return;
  rig.tracks = [];
  for (const side of [-1, 1]) {
    const wheels = rig.suspension.filter(w => Math.sign(w.x) === side);
    if (!wheels.length) continue;
    const r = Math.min(...wheels.map(w => w.radius)) * 0.95;
    const rear = Math.min(...wheels.map(w => w.z)), front = Math.max(...wheels.map(w => w.z));
    const x = wheels.reduce((sum, w) => sum + w.x, 0) / wheels.length;
    const y = wheels.reduce((sum, w) => sum + w.y, 0) / wheels.length;
    const span = front - rear, length = span * 2 + Math.PI * 2 * r;
    const count = Math.max(20, Math.min(56, Math.ceil(length / (r * 0.5))));
    const wheel = rig.wheels.find(w => Math.sign(w.m.parent.position.x) === side);
    const width = (wheel?.width || wheel?.m.geometry?.parameters?.height || r * 0.7) * 0.9;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(width, r * 0.09, length / count * 0.82),
      mat(0x252a2c, { metalness: 0.7 }), count);
    mesh.name = 'track-shoes';
    mesh.frustumCulled = false;
    mesh.userData.noOutline = true;
    mesh.userData.noPaint = true;
    rig.hull.add(mesh);
    rig.tracks.push({ mesh, pose: new THREE.Object3D(), x, y, r, front, rear, span, length, count, travel: 0 });
  }
  stepVehicleMotion(rig, {}, 0, 0, 0, 0, 0);
}

export function mechanism(node, axis, amplitude, frequency, phase = 0, channel = 'rotation') {
  return { node, axis, amplitude, frequency, phase, channel, rest: node[channel][axis] };
}
