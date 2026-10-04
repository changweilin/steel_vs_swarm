import { buildReferenceAsset } from './referenceAsset.js';
import { FACTION_ASSETS } from './factionAssets.js';
import { mechanism } from '../unitRig.js';
import { weldSmooth } from './geo.js';

/** Bind authored bones to the existing NPC and building weapon API. */
export function buildFactionAsset(role, side) {
  const asset = FACTION_ASSETS[`${side.toLowerCase()}_${role}`];
  if (!asset) return null;
  const { group, rig, nodes } = buildReferenceAsset(asset, { moveSig: asset.rig.moveSig });
  const nodeOf = name => {
    const node = nodes.get(name);
    if (!node) throw new Error(`Missing faction joint: ${asset.id}/${name}`);
    return node;
  };
  const bindMechanism = entry => mechanism(nodeOf(entry.node), entry.axis,
    entry.amplitude, entry.frequency ?? 0, entry.phase ?? 0, entry.channel ?? 'rotation');
  rig.attacks = asset.rig.attacks.map(entry => ({ ...entry, node: nodeOf(entry.node),
    muzzles: entry.muzzles.map(nodeOf), firedAt: -Infinity, cycle: entry.cycle.map(bindMechanism) }));
  rig.mechanisms = asset.rig.mechanisms.map(bindMechanism);
  if (asset.rig.wheels) rig.wheels = asset.rig.wheels.map(entry => ({ ...entry, m: nodeOf(entry.node) }));
  if (rig.hull) rig.hullY0 = rig.hull.position.y;
  const bindings = asset.rig.bindings;
  if (bindings.turret) {
    group.userData.turret = nodeOf(bindings.turret);
    group.userData.turret.userData.pitch = nodeOf(bindings.pitch);
    group.userData.turret.userData.muzzles = bindings.turretMuzzles?.map(nodeOf);
    group.userData.turret.userData.attacks = rig.attacks;
    group.userData.turret.userData.muzzleAxis = '+z';
  }
  for (const key of ['gunTilt']) if (bindings[key]) group.userData[key] = nodeOf(bindings[key]);
  for (const key of ['turretMuzzles', 'pivots', 'muzzles']) {
    if (bindings[key]) group.userData[key] = bindings[key].map(nodeOf);
  }
  if (bindings.pitches) bindings.pitches.forEach((name, i) => {
    const pitch = nodeOf(name);
    pitch.rotation.x = -.14;
    group.userData.pivots[i].userData.pitch = pitch;
  });
  if (bindings.turretSeatF != null) group.userData.turretSeatF = bindings.turretSeatF;
  group.userData.attacks = rig.attacks;
  group.userData.modelReference = asset.id;
  rig.lightGlow = [];
  // The shared exporter preserves hard face normals; the outline needs its existing welded copy.
  group.traverse(node => {
    if (node.isMesh && !node.userData.noOutline) node.geometry.userData.outlineGeo = weldSmooth(node.geometry);
  });
  rig.muzzles.light?.n.traverse(node => {
    if (node.isMesh && node.material.emissiveIntensity) rig.lightGlow.push({ mesh: node, base: node.material.emissiveIntensity });
  });
  return group;
}
