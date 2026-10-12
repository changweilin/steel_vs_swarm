// Authored overlays preserve rigid pivot connections and share the game's motion clock.
import * as THREE from 'three';

/** Pre: authored nodes are in their endpoint pose. Post: controls derive from weapon ancestry. */
export function anatomicalRig(group, rig, nodes) {
  const shots = {};
  for (const [slot, weapon] of Object.entries(rig.wpn)) {
    const ancestors = [];
    for (let node = weapon.ref; node && node !== group; node = node.parent) ancestors.push(node);
    const held = rig.heldWeapons?.find(entry => ancestors.includes(nodes.get(entry.node)));
    if (!held || rig.groundWings || rig.kind === 'aerial') continue;
    const hand = nodes.get(held.forearmTip || held.hand), elbow = hand.parent, shoulder = elbow.parent;
    const left = rig.armL || (rig.limb?.foreRole === 'grasp' ? rig.legFL : null);
    const right = rig.armR || (rig.limb?.foreRole === 'grasp' ? rig.legFR : null);
    if (![left, right].includes(shoulder)) continue;
    shots[slot] = { hand, elbow, shoulder, sign: shoulder === left ? 1 : -1, alwaysForward: !!weapon.alwaysForward };
  }
  if (rig.archery) {
    const hand = rig.wpn.light.aimJoint, elbow = hand.parent, shoulder = elbow.parent;
    shots.light = { hand, elbow, shoulder, sign: shoulder === rig.armSh[0] ? -1 : 1, bow: true };
  }
  const bird = rig.wings?.some(wing => wing.hand) && !rig.axialWave?.stableHead;
  const head = bird ? (nodes.get('sensor') || nodes.get('head')) : rig.head;
  const neck = rig.flightAxial?.neck || rig.humNeck || rig.neck;
  const body = [rig.hips || (rig.rider ? rig.neck : rig.spine),
    rig.waist || (rig.rider ? rig.humChest.parent : null), rig.humChest || rig.chest].filter(Boolean);
  const braces = Object.values(shots).filter(shot => shot.hand);
  const touched = new Set([...body, head, neck].filter(Boolean));
  if (rig.stance) for (const node of [rig.legL,rig.legR,rig.armL,rig.armR]) if (node) touched.add(node);
  for (const shot of braces) {
    touched.add(shot.shoulder); touched.add(shot.elbow); touched.add(shot.hand);
  }
  group.updateWorldMatrix(true, true);
  const controls = (rig.stowedWeapons || []).map(weapon => {
    const node = weapon.node, envelopes=[];
    node.traverse(mesh => {
      if (!mesh.isMesh || mesh.userData.presentationEffect || mesh.userData.isOutline) return;
      mesh.geometry.computeBoundingBox();
      const box=mesh.geometry.boundingBox,corners=[];
      for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])corners.push(new THREE.Vector3(x,y,z));
      envelopes.push({mesh,corners});
    });
    return {...weapon,position:node.position.clone(),q:node.quaternion.clone(),size:node.scale.clone(),envelopes,
      carry:weapon.carryAxis ? new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3(...weapon.carryAxis)) : null,
      stow:node.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...weapon.rotation)))};
  });
  const grips=(rig.heldWeapons || []).map(held=>({node:nodes.get(held.node),grip:nodes.get(held.grip),
    anchor:nodes.get(held.grip).position.clone(),contact:new THREE.Vector3(...held.contact)}));
  const feet = controls.length ? ['L','R'].map(side => rig['legChain'+side].at(-1).g) : [];
  return { group, shots, braces, bird, head, neck, body, bases: [...touched].map(node => ({node, q: node.quaternion.clone()})),
    controls,feet,grips,
    gaze: head ? group.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(head.getWorldQuaternion(new THREE.Quaternion())) : null,
    q: Array.from({length: 5}, () => new THREE.Quaternion()), v: Array.from({length: 6}, () => new THREE.Vector3()), applied: false };
}

/** Pre: called before locomotion/morph evaluation. Post: last frame's overlay cannot accumulate. */
export function resetAnatomicalPose(rig) {
  const pose = rig?.anatomical;
  if (!pose) return;
  for (const control of pose.controls) {
    control.node.position.copy(control.position); control.node.quaternion.copy(control.q); control.node.scale.copy(control.size);
  }
  if (rig.archery) {
    rig.archery.bow.quaternion.copy(rig.archery.bowRotation);
    rig.archery.arrow.position.copy(rig.archery.arrowRest);
    rig.archery.arrow.quaternion.copy(rig.archery.arrowRotation);
  }
  if (!pose.applied) return;
  for (const base of pose.bases) base.node.quaternion.copy(base.q);
  pose.applied = false;
}

/** Pre: locomotion/morph channels settled. Post: held weapons brace inward; gaze stays forward. */
export function stepAnatomicalPose(rig, blend = 1) {
  const p = rig.anatomical;
  if (!p) return;
  for (const base of p.bases) base.q.copy(base.node.quaternion);
  for (const control of p.controls) control.node.quaternion.copy(control.q);
  p.applied = true;
  if (rig.stance && rig.kind === 'biped') {
    for (const [side,sign] of [['L',1],['R',-1]]) {
      rig['leg'+side].rotation.y = sign*rig.stance.toeOut;
      rig['leg'+side].rotation.z = sign*rig.stance.hipSplay;
      if (rig.stance.armSplay) rig['arm'+side].rotation.z = sign*(.10+rig.stance.armSplay);
    }
  }
  const weight = Math.max(0, Math.min(1, (rig.archery ? rig._bowAim : rig._fireAim) || 0)) * blend;
  const shot = p.shots[rig._aimSlot || 'light'];
  const [yaw, parent, target, local] = p.q;
  if (shot && weight > 1e-5) {
    // Mirrored hands reverse the oblique stance; axial regions share the turn.
    const angle = -shot.sign * .75 * weight;
    p.body.forEach((node, i) => {
      const share = p.body.length === 1 ? 1 : p.body.length === 2 ? (i ? .60 : .40)
        : i === 0 ? .20 : i === 1 ? .30 : .50;
      yaw.setFromAxisAngle(p.v[0].set(0,1,0), angle * share);
      node.quaternion.premultiply(yaw);
    });
    for (const arm of p.braces) {
      if (arm.bow) continue;
      // Always-forward companion weapons need the same arm correction after the body turns.
      if (arm !== shot && !arm.alwaysForward) continue;
      const [point, delta, pole, , rest, endpoint] = p.v;
      const lengthA = arm.elbow.position.length(), lengthB = arm.hand.position.length();
      // Put the elbow below the shoulder and the forearm along the target axis.
      p.group.updateWorldMatrix(true, true);
      arm.shoulder.getWorldPosition(point); p.group.worldToLocal(point);
      const inward = -Math.sign(point.x) * Math.min(Math.abs(point.x), lengthA * .28);
      pole.copy(point).add(delta.set(inward, -Math.sqrt(lengthA * lengthA - inward * inward), 0));
      if (arm.bow) {
        // A perpendicular bow grip must keep the nock within the opposite arm's reach.
        rig.archery.shoulder.getWorldPosition(endpoint); p.group.worldToLocal(endpoint);
        point.set(0, point.y - lengthA * .25,
          (point.z + endpoint.z) * .5 + rig.archery.restDraw + lengthB * .25);
      } else point.copy(pole).add(rest.set(0,0,lengthB));
      p.group.localToWorld(pole); arm.shoulder.parent.worldToLocal(pole); pole.sub(arm.shoulder.position);
      p.group.localToWorld(point);
      poseArmToPoint(p,arm,weight);
    }
  }
  if (!p.head || (!p.bird && (!shot || weight <= 1e-5))) return;
  const gazeWeight = p.bird ? blend : weight;
  p.group.getWorldQuaternion(target); target.multiply(p.gaze);
  if (p.neck && p.neck !== p.head) {
    p.neck.parent.getWorldQuaternion(parent);
    local.copy(parent).invert().multiply(target);
    p.neck.quaternion.slerp(local, gazeWeight * .55);
  }
  p.head.parent.getWorldQuaternion(parent);
  local.copy(parent).invert().multiply(target);
  p.head.quaternion.slerp(local, gazeWeight);
}

function poseArmToPoint(p,arm,weight) {
  // The target is world-space; the pole is shoulder-parent-space so bone lengths survive both overlays.
  const [point,delta,pole,upper,rest,endpoint]=p.v;
  const local=p.q[3],original=p.q[4];
  const lengthA=arm.elbow.position.length(),lengthB=arm.hand.position.length();
  endpoint.copy(point);arm.shoulder.parent.worldToLocal(endpoint);
  delta.copy(endpoint).sub(arm.shoulder.position);
  const distance=Math.max(Math.abs(lengthA-lengthB)+1e-5,Math.min(lengthA+lengthB-1e-5,delta.length()));
  delta.normalize();
  const reach=(lengthA*lengthA-lengthB*lengthB+distance*distance)/(2*distance);
  pole.addScaledVector(delta,-pole.dot(delta));
  if(pole.lengthSq()<1e-10)pole.set(0,0,1).addScaledVector(delta,-delta.z);
  pole.normalize();
  upper.copy(delta).multiplyScalar(reach).addScaledVector(pole,Math.sqrt(Math.max(0,lengthA*lengthA-reach*reach)));
  original.copy(arm.shoulder.quaternion);
  local.setFromUnitVectors(rest.copy(arm.elbow.position).normalize(),upper.normalize());
  arm.shoulder.quaternion.copy(original).slerp(local,weight);
  arm.shoulder.updateWorldMatrix(true,false);
  endpoint.copy(point);arm.shoulder.worldToLocal(endpoint);
  local.setFromUnitVectors(rest.copy(arm.hand.position).normalize(),endpoint.sub(arm.elbow.position).normalize());
  arm.elbow.quaternion.slerp(local,weight);
}

/** Pre: aiming and morph channels settled. Post: equipment clears the lowest sole without accumulating offsets. */
export function stepEquipmentPose(rig, state = rig) {
  if (rig.dorsalMount) rig.dorsalMount.node.position.y=rig.dorsalMount.height;
  if (rig.dorsalLift) {
    const lift=rig.dorsalLift,weight=Math.max(0,Math.min(1,state._aimH || 0));
    lift.node.position.y=lift.rest+lift.height*weight;
  }
  const p = rig.anatomical;
  if (!p) return;
  const placeGrip=held=>{
    held.node.position.copy(p.v[0].copy(held.anchor).applyQuaternion(held.node.quaternion).negate().add(held.contact));
    held.grip.position.copy(held.anchor).divide(held.node.scale);
    held.grip.scale.set(1/held.node.scale.x,1/held.node.scale.y,1/held.node.scale.z);
  };
  for (const held of p.grips) placeGrip(held);
  if (!p.controls.length) return;
  const aim = Math.max(0,Math.min(1,state._fireAim || 0));
  p.group.updateWorldMatrix(true,true);
  let floor = Infinity;
  for (const foot of p.feet) foot.traverse(mesh => {
    if (!mesh.isMesh || mesh.userData.presentationEffect || mesh.userData.isOutline) return;
    mesh.geometry.computeBoundingBox();
    floor = Math.min(floor,mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld).min.y);
  });
  for (const control of p.controls) {
    const minimumY=()=>{
      let minimum=Infinity;
      node.updateWorldMatrix(true,true);
      for(const {mesh,corners}of control.envelopes)for(const corner of corners)minimum=Math.min(minimum,p.v[0].copy(corner).applyMatrix4(mesh.matrixWorld).y);
      minimum=Math.min(minimum,rig.wpn[control.slot].muz.getWorldPosition(p.v[0]).y);
      return minimum;
    };
    const weight = (state._aimSlot || 'light') === control.slot ? aim : 0, node = control.node;
    p.q[0].copy(node.quaternion);
    if (control.carry) {
      p.group.getWorldQuaternion(p.q[1]);p.q[1].multiply(control.carry);
      node.parent.getWorldQuaternion(p.q[2]);p.q[1].premultiply(p.q[2].invert());
      node.quaternion.copy(p.q[1]).slerp(p.q[0],weight);
    } else node.quaternion.copy(control.stow).slerp(p.q[0],weight);
    node.scale.copy(control.size).multiplyScalar(control.scale+(1-control.scale)*weight);
    const held=p.grips.find(entry=>entry.node===node);
    if (held) placeGrip(held);
    node.updateWorldMatrix(true,false);
    let minimum = minimumY();
    if (!Number.isFinite(floor) || minimum >= floor+control.clearance) continue;
    if (held) {
      // Lift the grasp with the same two-link arm solver; independent weapon translation detaches the wrist.
      const arm=p.braces.find(entry=>entry.hand===node.parent);
      if(!arm)continue;
      const orientation=node.getWorldQuaternion(new THREE.Quaternion());
      arm.hand.getWorldPosition(p.v[0]);p.v[0].y+=floor+control.clearance-minimum;
      arm.elbow.getWorldPosition(p.v[2]);arm.shoulder.parent.worldToLocal(p.v[2]);p.v[2].sub(arm.shoulder.position);
      poseArmToPoint(p,arm,1);
      node.parent.getWorldQuaternion(p.q[2]);node.quaternion.copy(p.q[2].invert().multiply(orientation));
      placeGrip(held);node.updateWorldMatrix(true,true);
      minimum=minimumY();
      if(minimum<floor+control.clearance && weight>0 && weight<.95){
        p.group.getWorldQuaternion(p.q[1]);node.parent.getWorldQuaternion(p.q[2]);
        node.quaternion.copy(p.q[2].invert().multiply(p.q[1]));placeGrip(held);node.updateWorldMatrix(true,true);
      }
      continue;
    }
    node.getWorldPosition(p.v[0]);p.v[0].y += floor+control.clearance-minimum;
    node.parent.worldToLocal(p.v[0]);node.position.copy(p.v[0]);node.updateWorldMatrix(true,true);
  }
}
