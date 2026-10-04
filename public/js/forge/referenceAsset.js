import * as THREE from 'three';
import { mat, jetFlame, sph } from '../geo3d.js';
import { attachCombatAsset } from './combatAsset.js';

/** Blender batches static parts per joint/material; each unit owns its disposable GPU resources. */
export function buildReferenceAsset(asset, spec) {
  const form = asset.forms?.[spec.form];
  const group = new THREE.Group(), nodes = new Map();
  group.name = asset.id;
  group.userData.referenceAsset = { id: asset.id, source: asset.source };
  for (const [name, parent, position] of asset.joints) {
    const node = new THREE.Bone();
    node.name = name;
    if (form) node.userData.mtag = `${asset.id}/joint/${name}`;
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
    if (form) mesh.userData.mtag = `${asset.id}/mesh/${mesh.name}`;
    mesh.userData.authoredParts = part.parts;
    if (desc.emission || desc.opacity != null) mesh.userData.noOutline = true;
    nodeOf(part.parent).add(mesh);
  }
  const bindTrack = track => ({ ...track, node: nodeOf(track.node) });
  for (const [name, pose] of Object.entries(form?.transforms || {})) {
    const node = nodeOf(name);
    if (pose.position) node.position.fromArray(pose.position);
    if (pose.rotation) node.rotation.fromArray(pose.rotation);
  }
  const rig = { ...asset.rig, ...form?.rig, kind: form?.kind || asset.kind, s: 1,
    moveSig: spec.moveSig, castSig: spec.castSig };
  // The quadruped driver requires a collection even when the reference has no tail.
  if (rig.kind === 'quad' && rig.tailSegs == null) rig.tailSegs = [];
  for (const key of ['hips', 'waist', 'chest', 'head', 'legL', 'legR', 'armL', 'armR', 'tilt',
    'spine', 'neck', 'humChest', 'humNeck', 'legFL', 'legFR', 'legHL', 'legHR', 'hull']) {
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
  for (const key of ['legChainL', 'legChainR', 'armChainL', 'armChainR', 'chFL', 'chFR', 'chML', 'chMR', 'chHL', 'chHR']) {
    if (rig[key]) rig[key] = rig[key].map(joint => ({ ...joint, g: nodeOf(joint.g) }));
  }
  for (const key of ['tailSegs', 'armSh', 'armEl', 'midLegs', 'midKnees', 'midTarsi']) {
    if (rig[key]) rig[key] = rig[key].map(nodeOf);
  }
  if (rig.tents) rig.tents = rig.tents.map(chain => chain.map(joint => ({ ...joint, g: nodeOf(joint.g) })));
  if (rig.insectLegs) rig.insectLegs = rig.insectLegs.map(leg => ({ ...leg,
    root: nodeOf(leg.root), lift: nodeOf(leg.lift), chain: rig[leg.chain] }));
  if (rig.tentacleWaves) rig.tentacleWaves = rig.tentacleWaves.map(wave => ({ ...wave, chain: wave.chain.map(nodeOf) }));
  if (rig.axialWave) rig.axialWave = { ...rig.axialWave, chain: rig.axialWave.chain.map(nodeOf) };
  if (rig.groundWings) rig.groundWings = rig.groundWings.map(wing => ({ ...wing,
    w: nodeOf(wing.w), outer: nodeOf(wing.outer), hand: nodeOf(wing.hand) }));
  if (rig.wings) rig.wings = rig.wings.map(wing => ({ ...wing, w: nodeOf(wing.w), outer: nodeOf(wing.outer),
    ...(wing.hand ? { hand: nodeOf(wing.hand) } : {}) }));
  for (const wing of rig.wings || []) {
    if (!wing.hand) continue;
    wing.w.rotation.z = wing.sgn * (wing.dihedral || 0);
    wing.outer.rotation.y = wing.sgn * (wing.elbowSweep || 0);
    wing.hand.rotation.y = wing.sgn * (wing.wristSweep || 0);
  }
  for (const wing of rig.groundWings || []) {
    [wing.w,wing.outer,wing.hand].forEach((node,i) => { node.rotation.y = wing.sgn * wing.fold[i]; });
    wing.w.rotation.z = wing.sgn * -.30;
  }
  if (!form) for (const held of rig.heldWeapons || []) nodeOf(held.node).rotation.x = held.pitch;
  const W = { muzzles: {}, wpn: {}, lightGlowM: [], heavyGlowM: [], heavyPivot: [] };
  for (const [slot, weapon] of Object.entries(asset.rig.wpn)) {
    const muzzle = nodeOf(weapon.muzzle);
    W.muzzles[slot] = { n: muzzle, r: weapon.r };
    W.wpn[slot] = { nodes: weapon.nodes.map(nodeOf), ref: nodeOf(weapon.ref), muz: muzzle, fwd: weapon.fwd || 'z',
      ...(weapon.aimJoint ? { aimJoint: nodeOf(weapon.aimJoint) } : {}), alwaysForward: !!weapon.alwaysForward };
    muzzle.traverse(mesh => {
      if (mesh.isMesh && mesh.material.emissiveIntensity) W[`${slot}GlowM`].push(mesh);
    });
  }
  rig.muzzles = W.muzzles;
  rig.wpn = W.wpn;
  const shield = asset.motion.shield;
  if (shield) {
    rig.shield = { ...shield, phase: 0, barrier: nodeOf(shield.barrier), hinges: shield.hinges.map(bindTrack) };
    if (shield.arm) {
      rig.shield.arm = { ...shield.arm,
        shoulder: nodeOf(shield.arm.shoulder), elbow: nodeOf(shield.arm.elbow), wrist: nodeOf(shield.arm.wrist) };
    }
    rig.shield.posture = spec.form === 'flight' ? 0 : 1;
    rig.shield.pose = (shield.pose || []).map(track => ({
      node: nodeOf(track.node),
      rest: new THREE.Quaternion().setFromEuler(new THREE.Euler(...track.rest)),
      deploy: new THREE.Quaternion().setFromEuler(new THREE.Euler(...track.rotation)),
    }));
    for (const hinge of rig.shield.hinges) hinge.node.rotation[hinge.axis] = hinge.rest;
    rig.shield.barrier.visible = false;
    rig.shield.barrier.scale.setScalar(.001);
    rig.combat = attachCombatAsset(group, nodes, asset.id, form);
    if (rig.combat) {
      rig.shield.barrier = rig.combat.guard;
      rig.shield.combat = rig.combat;
    }
  }
  rig.referenceMotion = {
    fire: asset.motion.fire.map(bindTrack), charge: asset.motion.charge.map(bindTrack), cast: asset.motion.cast.map(bindTrack),
    fireSpin: asset.motion.fireSpin ? bindTrack(asset.motion.fireSpin) : null,
  };
  for (const tracks of [rig.referenceMotion.fire, rig.referenceMotion.charge, rig.referenceMotion.cast]) {
    for (const track of tracks) if (track.channel === 'scale') track.node.scale[track.axis] = track.rest;
  }
  if (spec.form === 'flight' && asset.motion.jets) {
    // Exhaust is presentation geometry; ground height fitting uses only the shared rigid inventory.
    rig.jets = asset.motion.jets.map(entry => {
      const jet = jetFlame(nodeOf(entry.node), entry.radius, entry.length, ...entry.position,
        new THREE.Color(asset.materials.glow.color));
      jet.g.rotation.z = entry.roll;
      const cloud = entry.cloud, vapor = asset.materials.vapor;
      for (let i = 0; i < cloud.count; i++) {
        const u = i / (cloud.count - 1), angle = i * 2.399;
        const radius = cloud.radius * (.55 + .75 * Math.sin(Math.PI * (.25 + .75 * u)));
        const node = sph(jet.g, radius, Math.cos(angle) * cloud.radius * (.35 + .9 * u),
          -entry.length - u * cloud.radius * 3.4, Math.sin(angle) * cloud.radius * (.35 + .9 * u),
          new THREE.Color(vapor.color), { transparent: true, opacity: vapor.opacity, depthWrite: false,
            emissive: new THREE.Color(vapor.color), emissiveIntensity: vapor.emission });
        node.scale.set(1.15, .72, 1.15);
      }
      jet.g.traverse(node => { node.userData.presentationEffect = true; node.userData.noOutline = true; });
      return { ...jet, idle: entry.idle, lenF: entry.lenF };
    });
  }
  group.userData.spin = (rig.spin || []).map((entry, i) => {
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
  return { group, rig, joints: [joints], weapons: W, spin: group.userData.spin, nodes };
}
