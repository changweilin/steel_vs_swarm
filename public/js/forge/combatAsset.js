import * as THREE from 'three';
import { COMBAT_ASSETS } from './combatAssets.js';
import { makeShieldMaterial } from '../vfx.js';
import { characterShieldTexture } from '../castfx.js';
import { sampleCombatKeys } from './combatKeys.js';
export { sampleCombatKeys } from './combatKeys.js';

/** Every effect is attached to the shipped rig, never to a second simulation or animation loop. */
export function attachCombatAsset(group, nodes, id, form) {
  const asset = COMBAT_ASSETS[id];
  if (!asset) return null;
  const profile = asset.combat;
  const detached = new Set([...(profile.transported || []),
    ...Object.values(profile.fields || {}).flatMap(field => field.nodes)]);
  const hull = [], owners = new Map();
  if (form) group.traverse(mesh => {
    if (!mesh.isMesh || mesh.userData.presentationEffect || mesh.parent.name === 'barrier') return;
    mesh.geometry.computeBoundingBox();
    const owner = mesh.parent;
    if (!owners.has(owner)) owners.set(owner, new THREE.Box3());
    mesh.updateMatrix();
    owners.get(owner).union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrix));
  });
  for (const [node, box] of owners) hull.push({ node, center: box.getCenter(new THREE.Vector3()), half: box.getSize(new THREE.Vector3()).multiplyScalar(.5) });
  for (const [name, parent, position] of asset.joints) {
    if (nodes.has(name)) throw new Error(`Duplicate combat attachment: ${id}/${name}`);
    const owner = parent ? nodes.get(parent) : group;
    if (!owner) throw new Error(`Missing combat attachment: ${id}/${parent}`);
    const node = new THREE.Bone();
    node.name = name;
    node.position.fromArray(position);
    node.scale.setScalar(.001);
    node.visible = false;
    if (form) node.userData.mtag = `${id}/joint/${name}`;
    owner.add(node); nodes.set(name, node);
  }
  const materials = new Map();
  for (const part of asset.meshes) {
    // Transported geometry belongs to projectileMesh, not an invisible duplicate on every rig.
    if (detached.has(part.parent)) continue;
    const desc = asset.materials[part.material];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(part.normals, 3));
    geometry.setIndex(part.indices);
    const key = part.material + (part.parent === 'fx_guard' ? '/guard' : '');
    let material = materials.get(key);
    if (!material) {
      material = part.material === 'fx_membrane' && part.parent === 'fx_guard'
        ? makeShieldMaterial(profile.intent.color, { planar: true, hexR: profile.shield.halfWidth,
          accent: profile.intent.accent, pattern: characterShieldTexture(id),
          aspect: profile.shield.halfWidth / profile.shield.halfHeight })
        : new THREE.MeshBasicMaterial({ color: desc.color, transparent: true, opacity: desc.opacity,
          depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      // The guard has a shader while the ion cone uses the same authored material region.
      materials.set(key, material);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = part.parent + '/' + part.material;
    mesh.userData.presentationEffect = true;
    mesh.userData.noOutline = true; mesh.userData.noPaint = true;
    mesh.userData.geoKeep = true;
    mesh.raycast = () => {};
    if (form) mesh.userData.mtag = `${id}/mesh/${mesh.name}`;
    nodes.get(part.parent).add(mesh);
  }
  const guard = nodes.get(profile.shield.node);
  guard.userData.authoredCombat = true;
  guard.userData.mat = materials.get('fx_membrane/guard');
  guard.userData.hit = (strength = 1) => {
    const uniform = guard.userData.mat.uniforms.uFlash;
    uniform.value = Math.max(uniform.value, strength);
  };
  return { ...profile, guard, nodes, hull, group, inverse: new THREE.Matrix4(), local: new THREE.Matrix4(),
    detached,
    clips: Object.fromEntries(Object.entries(profile.clips).map(([slot, clip]) => [slot,
      { ...clip, tracks: clip.tracks.filter(track => !detached.has(track.node))
        .map(track => ({ ...track, target: nodes.get(track.node) })) }])) };
}

/** Live morph and firing poses can exceed endpoint envelopes; cached joint bounds avoid vertex scans. */
export function clearMorphCombatShield(rig) {
  const combat = rig.combat;
  if (!combat?.hull.length || !combat.guard.visible || !combat.group.visible) return;
  combat.group.updateWorldMatrix(true, true);
  combat.inverse.copy(combat.group.matrixWorld).invert();
  let front = -Infinity;
  for (const { node, center, half } of combat.hull) {
    combat.local.multiplyMatrices(combat.inverse, node.matrixWorld);
    const e = combat.local.elements;
    front = Math.max(front, e[2] * center.x + e[6] * center.y + e[10] * center.z + e[14]
      + Math.abs(e[2]) * half.x + Math.abs(e[6]) * half.y + Math.abs(e[10]) * half.z);
  }
  combat.guard.position.z = Math.max(combat.shield.center[2], front + combat.shield.clearance);
}

export function stepAuthoredCombat(rig, ent, now) {
  const combat = rig.combat;
  if (!combat || !Number.isFinite(now)) return;
  for (const [name, , position] of combat.joints) {
    if (name === combat.shield.node) continue;
    const node = combat.nodes.get(name);
    node.visible = false;
    node.scale.setScalar(.001);
    node.position.fromArray(position);
    node.rotation.set(0, 0, 0);
  }
  if (ent.dead) return;
  for (const [slot, clip] of Object.entries(combat.clips)) {
    const event = slot === 'light' || slot === 'heavy' ? ent.fireFx : ent.castFx;
    if (event?.slot !== slot || !Number.isFinite(event.t0)) continue;
    const time = (now - event.t0) / clip.duration;
    if (time < 0 || time >= 1) continue;
    for (const track of clip.tracks) {
      if (combat.transported?.includes(track.node)) continue;
      track.target[track.channel][track.axis] = sampleCombatKeys(track.keys, time);
      track.target.visible = true;
    }
  }
}
