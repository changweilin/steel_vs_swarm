import * as THREE from 'three';
import { mat } from '../geo3d.js';

/** Blender batches static parts per joint/material; each unit owns its disposable GPU resources. */
export function buildReferenceAsset(asset, spec) {
  const group = new THREE.Group(), nodes = new Map();
  group.name = asset.id;
  group.userData.referenceAsset = { id: asset.id, source: asset.source };
  for (const [name, parent, position] of asset.joints) {
    const node = new THREE.Bone();
    node.name = name;
    node.position.fromArray(position);
    (parent ? nodes.get(parent) : group).add(node);
    nodes.set(name, node);
  }
  const nodeOf = name => {
    const node = nodes.get(name);
    if (!node) throw new Error(`Missing authored joint: ${asset.id}/${name}`);
    return node;
  };
  for (const part of asset.meshes) {
    const desc = asset.materials[part.material];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(part.normals, 3));
    geometry.setIndex(part.indices);
    const color = new THREE.Color(desc.color);
    const mesh = new THREE.Mesh(geometry, mat(color, {
      metalness: desc.metal || 0,
      emissive: desc.emission ? color : 0,
      emissiveIntensity: desc.emission || 0,
      transparent: desc.opacity != null,
      opacity: desc.opacity ?? 1,
      depthWrite: desc.opacity == null,
      side: desc.opacity == null ? THREE.FrontSide : THREE.DoubleSide,
    }));
    mesh.name = `${part.parent}/${part.material}`;
    mesh.userData.authoredParts = part.parts;
    if (desc.emission || desc.opacity != null) mesh.userData.noOutline = true;
    nodeOf(part.parent).add(mesh);
  }
  const bindTrack = track => ({ ...track, node: nodeOf(track.node) });
  const rig = { ...asset.rig, kind: asset.kind, s: 1,
    moveSig: spec.moveSig, castSig: spec.castSig };
  for (const key of ['hips', 'chest', 'head', 'legL', 'legR', 'armL', 'armR', 'tilt',
    'spine', 'neck', 'humChest', 'humNeck', 'legFL', 'legFR', 'legHL', 'legHR']) {
    if (typeof rig[key] === 'string') rig[key] = nodeOf(rig[key]);
  }
  if (rig.hips) rig.hipsY0 = rig.hips.position.y;
  if (rig.head) rig.headY0 = rig.head.position.y;
  if (rig.tilt) rig.tiltY0 = rig.tilt.position.y;
  if (rig.spine) rig.hipsY0 = rig.spine.position.y;
  if (rig.neck) rig.neckY0 = rig.neck.position.y;
  for (const key of ['gunR', 'gunL']) {
    if (rig[key]) rig[key] = { ...rig[key], g: nodeOf(rig[key].g) };
  }
  for (const key of ['legChainL', 'legChainR', 'armChainL', 'armChainR', 'chFL', 'chFR', 'chHL', 'chHR']) {
    if (rig[key]) rig[key] = rig[key].map(joint => ({ ...joint, g: nodeOf(joint.g) }));
  }
  for (const key of ['tailSegs', 'armSh', 'armEl']) {
    if (rig[key]) rig[key] = rig[key].map(nodeOf);
  }
  if (rig.tents) rig.tents = rig.tents.map(chain => chain.map(joint => ({ ...joint, g: nodeOf(joint.g) })));
  if (rig.wings) rig.wings = rig.wings.map(wing => ({ ...wing, w: nodeOf(wing.w), outer: nodeOf(wing.outer) }));
  const W = { muzzles: {}, wpn: {}, lightGlowM: [], heavyGlowM: [], heavyPivot: [] };
  for (const [slot, weapon] of Object.entries(asset.rig.wpn)) {
    const muzzle = nodeOf(weapon.muzzle);
    W.muzzles[slot] = { n: muzzle, r: weapon.r };
    W.wpn[slot] = { nodes: weapon.nodes.map(nodeOf), ref: nodeOf(weapon.ref), muz: muzzle, fwd: weapon.fwd || 'z' };
    muzzle.traverse(mesh => {
      if (mesh.isMesh && mesh.material.emissiveIntensity) W[`${slot}GlowM`].push(mesh);
    });
  }
  rig.muzzles = W.muzzles;
  rig.wpn = W.wpn;
  const shield = asset.motion.shield;
  rig.shield = { ...shield, phase: 0, barrier: nodeOf(shield.barrier), hinges: shield.hinges.map(bindTrack) };
  if (shield.arm) {
    rig.shield.arm = { ...shield.arm,
      shoulder: nodeOf(shield.arm.shoulder), elbow: nodeOf(shield.arm.elbow), wrist: nodeOf(shield.arm.wrist) };
  }
  for (const hinge of rig.shield.hinges) hinge.node.rotation[hinge.axis] = hinge.rest;
  rig.shield.barrier.visible = false;
  rig.shield.barrier.scale.setScalar(.001);
  rig.referenceMotion = {
    fire: asset.motion.fire.map(bindTrack), charge: asset.motion.charge.map(bindTrack), cast: asset.motion.cast.map(bindTrack),
    fireSpin: asset.motion.fireSpin ? bindTrack(asset.motion.fireSpin) : null,
  };
  group.userData.spin = (asset.rig.spin || []).map((entry, i) => {
    const node = nodeOf(typeof entry === 'string' ? entry : entry.node);
    node.userData.spinAxis = typeof entry === 'string' ? 'y' : entry.axis;
    node.userData.spinRate = typeof entry === 'string' ? (i % 2 ? -40 : 40) : entry.rate;
    return node;
  });
  const joints = new THREE.SkeletonHelper(group);
  joints.matrix = new THREE.Matrix4();
  joints.visible = false;
  joints.material.depthTest = false;
  joints.renderOrder = 20;
  group.add(joints);
  group.userData.rig = rig;
  return { group, rig, joints: [joints], weapons: W, spin: group.userData.spin };
}
