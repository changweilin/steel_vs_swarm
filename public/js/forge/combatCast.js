import * as THREE from 'three';
import { COMBAT_ASSETS } from './combatAssets.js';
import { markShared } from '../toon.js';
import { sampleCombatKeys } from './combatKeys.js';

const GEOMETRY = new WeakMap();
function geometryOf(part) {
  let geometry = GEOMETRY.get(part);
  if (geometry) return geometry;
  geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(part.normals, 3));
  geometry.setIndex(part.indices);
  GEOMETRY.set(part, markShared(geometry));
  return geometry;
}

/** Pre: r is the settled event radius in world metres. Invariant: authored field vertices remain inside that radius. */
export function spawnAuthoredCast(scene, effects, P, ch, slot) {
  const asset = COMBAT_ASSETS[ch], field = asset?.combat.fields?.[slot];
  if (!field) return false;
  const radius = P.r > 0 ? P.r : P.scale * .6;
  if (!Number.isFinite(radius) || radius <= 0 || !P.at?.isVector3) return true;
  const group = new THREE.Group(), nodes = new Map();
  for (const name of field.nodes) {
    const node = new THREE.Group();
    node.name = name; node.scale.setScalar(.001);
    group.add(node); nodes.set(name, node);
  }
  for (const part of asset.meshes) {
    const node = nodes.get(part.parent);
    if (!node) continue;
    const desc = asset.materials[part.material];
    const mesh = new THREE.Mesh(geometryOf(part), new THREE.MeshBasicMaterial({ color: desc.color,
      transparent: true, opacity: desc.opacity, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true }));
    mesh.userData.noOutline = true;
    mesh.userData.presentationEffect = true;
    mesh.raycast = () => {};
    node.add(mesh);
  }
  const tracks = field.tracks.map(track => ({ ...track, target: nodes.get(track.node) }));
  const duration = Math.min(field.duration, P.dur > 0 ? P.dur : field.duration);
  const origin = P.casterPos?.();
  group.rotation.y = origin ? Math.atan2(P.at.x - origin.x, P.at.z - origin.z) : 0;
  group.scale.setScalar(radius);
  group.userData.castPresentation = true;
  group.userData.authoredCast = { ch, slot, radius, ranged: P.r > 0 };
  group.userData.castLayers = field.nodes;
  const update = (object, fraction) => {
    if (!Number.isFinite(fraction)) return;
    const anchor = field.follows ? P.casterPos?.() : null;
    object.position.copy(anchor || P.at);
    for (const track of tracks) track.target[track.channel][track.axis] = sampleCombatKeys(track.keys, 1 - fraction);
  };
  update(group, 1);
  scene.add(group);
  effects.push({ obj: group, ttl: duration, fade: update });
  return true;
}
