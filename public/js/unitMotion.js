// Event-driven presentation only; no geometry or authority dependencies.
export function stepUnitSpinners(nodes, dt) {
  if (!nodes || !Number.isFinite(dt) || dt <= 0) return;
  for (const node of nodes) node.rotation[node.userData.spinAxis || 'y'] += dt * 40;
}

export function fireUnitMotion(rig, muzzle, now) {
  if (!rig?.attacks || !Number.isFinite(now)) return;
  const attack = rig.attacks.find(a => a.muzzles.includes(muzzle));
  if (attack) attack.firedAt = now;
}

export function stepUnitMotion(rig, now) {
  if (!rig?.attacks || !Number.isFinite(now)) return;
  for (const a of rig.attacks) {
    const age = now - a.firedAt;
    // Absolute event age keeps rapid salvos and distance LOD independent of FPS.
    const kick = age < 0 || age >= 0.55 ? 0
      : age < 0.035 ? age / 0.035 : Math.pow(1 - (age - 0.035) / 0.515, 3);
    a.node.position.z = -a.travel * kick;
    a.node.rotation.x = -a.lift * kick;
  }
}
