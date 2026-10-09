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
    shots[slot] = { hand, elbow, shoulder, sign: shoulder === left ? 1 : -1, staff: !!held.staff };
  }
  if (rig.archery) shots.light = { sign: -1, bow: true };
  const bird = rig.wings?.some(wing => wing.hand) && !rig.axialWave?.stableHead;
  const head = bird ? (nodes.get('sensor') || nodes.get('head')) : rig.head;
  const neck = rig.flightAxial?.neck || rig.humNeck || rig.neck;
  const body = [rig.hips || (rig.rider ? rig.neck : rig.spine), rig.waist, rig.humChest || rig.chest].filter(Boolean);
  const touched = new Set([...body, head, neck].filter(Boolean));
  for (const shot of Object.values(shots)) if (shot.hand) {
    touched.add(shot.shoulder); touched.add(shot.elbow); touched.add(shot.hand);
  }
  group.updateWorldMatrix(true, true);
  return { group, shots, bird, head, neck, body, bases: [...touched].map(node => ({node, q: node.quaternion.clone()})),
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
    const angle = -shot.sign * (shot.bow ? .65 : shot.staff ? .60 : .75) * weight;
    p.body.forEach((node, i) => {
      yaw.setFromAxisAngle(p.v[0].set(0,1,0), angle * (i === 0 ? .20 : i === 1 ? .30 : .50));
      node.quaternion.premultiply(yaw);
    });
    if (shot.hand) {
      const [point, delta, pole, upper, rest, endpoint] = p.v;
      const lengthA = shot.elbow.position.length(), lengthB = shot.hand.position.length();
      // Put the elbow below the shoulder and the forearm along the target axis.
      p.group.updateWorldMatrix(true, true);
      shot.shoulder.getWorldPosition(point); p.group.worldToLocal(point);
      pole.copy(point).add(delta.set(-shot.sign * lengthA * .28, -lengthA * Math.sqrt(1-.28*.28), 0));
      point.copy(pole).add(rest.set(0,0,lengthB));
      p.group.localToWorld(pole); shot.shoulder.parent.worldToLocal(pole); pole.sub(shot.shoulder.position);
      p.group.localToWorld(point);
      endpoint.copy(point); shot.shoulder.parent.worldToLocal(endpoint);
      delta.copy(endpoint).sub(shot.shoulder.position);
      const distance = Math.max(Math.abs(lengthA-lengthB)+1e-5, Math.min(lengthA+lengthB-1e-5, delta.length()));
      delta.normalize();
      const reach = (lengthA*lengthA-lengthB*lengthB+distance*distance)/(2*distance);
      pole.addScaledVector(delta,-pole.dot(delta)).normalize();
      upper.copy(delta).multiplyScalar(reach).addScaledVector(pole,Math.sqrt(Math.max(0,lengthA*lengthA-reach*reach)));
      original.copy(shot.shoulder.quaternion);
      local.setFromUnitVectors(rest.copy(shot.elbow.position).normalize(),upper.normalize());
      shot.shoulder.quaternion.copy(original).slerp(local,weight);
      shot.shoulder.updateWorldMatrix(true,false);
      endpoint.copy(point); shot.shoulder.worldToLocal(endpoint);
      local.setFromUnitVectors(rest.copy(shot.hand.position).normalize(),endpoint.sub(shot.elbow.position).normalize());
      shot.elbow.quaternion.slerp(local,weight);
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
