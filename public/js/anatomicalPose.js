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
  for (const shot of braces) {
    touched.add(shot.shoulder); touched.add(shot.elbow); touched.add(shot.hand);
  }
  group.updateWorldMatrix(true, true);
  return { group, shots, braces, bird, head, neck, body, bases: [...touched].map(node => ({node, q: node.quaternion.clone()})),
    gaze: head ? group.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(head.getWorldQuaternion(new THREE.Quaternion())) : null,
    q: Array.from({length: 5}, () => new THREE.Quaternion()), v: Array.from({length: 6}, () => new THREE.Vector3()), applied: false };
}

/** Pre: called before locomotion/morph evaluation. Post: last frame's overlay cannot accumulate. */
export function resetAnatomicalPose(rig) {
  const pose = rig?.anatomical;
  if (!pose?.applied) return;
  for (const base of pose.bases) base.node.quaternion.copy(base.q);
  pose.applied = false;
}

/** Pre: locomotion/morph channels settled. Post: held weapons brace inward; gaze stays forward. */
export function stepAnatomicalPose(rig, blend = 1) {
  const p = rig.anatomical;
  if (!p) return;
  for (const base of p.bases) base.q.copy(base.node.quaternion);
  p.applied = true;
  const weight = Math.max(0, Math.min(1, rig._fireAim || 0)) * blend;
  const shot = p.shots[rig._aimSlot || 'light'];
  const [yaw, parent, target, local, original] = p.q;
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
      // Always-forward companion weapons need the same arm correction after the body turns.
      if (arm !== shot && !arm.alwaysForward) continue;
      const [point, delta, pole, upper, rest, endpoint] = p.v;
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
      endpoint.copy(point); arm.shoulder.parent.worldToLocal(endpoint);
      delta.copy(endpoint).sub(arm.shoulder.position);
      const distance = Math.max(Math.abs(lengthA-lengthB)+1e-5, Math.min(lengthA+lengthB-1e-5, delta.length()));
      delta.normalize();
      const reach = (lengthA*lengthA-lengthB*lengthB+distance*distance)/(2*distance);
      pole.addScaledVector(delta,-pole.dot(delta)).normalize();
      upper.copy(delta).multiplyScalar(reach).addScaledVector(pole,Math.sqrt(Math.max(0,lengthA*lengthA-reach*reach)));
      original.copy(arm.shoulder.quaternion);
      local.setFromUnitVectors(rest.copy(arm.elbow.position).normalize(),upper.normalize());
      arm.shoulder.quaternion.copy(original).slerp(local,weight);
      arm.shoulder.updateWorldMatrix(true,false);
      endpoint.copy(point); arm.shoulder.worldToLocal(endpoint);
      local.setFromUnitVectors(rest.copy(arm.hand.position).normalize(),endpoint.sub(arm.elbow.position).normalize());
      arm.elbow.quaternion.slerp(local,weight);
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
