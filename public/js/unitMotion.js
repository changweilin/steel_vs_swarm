// Event-driven presentation only; no geometry or authority dependencies.
export function stepUnitSpinners(nodes, dt) {
  if (!nodes || !Number.isFinite(dt) || dt <= 0) return;
  for (const node of nodes) {
    const axis = node.userData.spinAxis || 'y';
    node.rotation[axis] += dt * (node.userData.spinRate ?? 40);
  }
}

export function fireUnitMotion(rig, muzzle, now) {
  if (!rig?.attacks || !Number.isFinite(now)) return;
  const attack = rig.attacks.find(a => a.muzzles.includes(muzzle));
  if (attack) attack.firedAt = now;
}

export function stepUnitMotion(rig, now) {
  if (!rig || !Number.isFinite(now)) return;
  for (const m of rig.mechanisms || []) {
    m.node[m.channel][m.axis] = m.rest + Math.sin(now * m.frequency + m.phase) * m.amplitude;
  }
  for (const a of rig.attacks || []) {
    const age = now - a.firedAt;
    // Absolute event age keeps rapid salvos and distance LOD independent of FPS.
    const kick = age < 0 || age >= 0.55 ? 0
      : age < 0.035 ? age / 0.035 : Math.pow(1 - (age - 0.035) / 0.515, 3);
    a.node.position.z = -a.travel * kick;
    a.node.rotation.x = -a.lift * kick;
    for (const m of a.cycle || []) {
      const u = age < 0 || age >= 0.55 ? 0 : Math.sin(Math.PI * Math.min(1, age / 0.55)) ** 2;
      m.node[m.channel][m.axis] = m.rest + m.amplitude * u;
    }
  }
}

/** Travel drives tread phase; event time drives suspension, so LOD never freezes a compression. */
export function stepVehicleMotion(rig, L, dt, now, speed, forward, yawRate) {
  if (!rig?.wheels?.length || dt < 0 || !Number.isFinite(dt) || !Number.isFinite(now)
    || !Number.isFinite(speed) || !Number.isFinite(forward) || !Number.isFinite(yawRate)) return;
  const scale = rig.s || 1;
  for (let i = 0; i < rig.wheels.length; i++) {
    const w = rig.wheels[i], axle = rig.suspension?.[i];
    const velocity = forward - (rig.kind === 'tracked' && axle ? yawRate * axle.x * scale : 0);
    w.m.rotation.x = (w.m.rotation.x + velocity / Math.max(0.05, w.r * scale) * dt) % (Math.PI * 2);
    if (!axle) continue;
    const drive = Math.min(1, speed / (rig.top || 10));
    axle.mount.position.y = axle.y + Math.sin(now * 12.5 + (L.ph || 0) - axle.z * 1.7) * axle.radius * 0.06 * drive;
    axle.mount.rotation.y = axle.steer ? Math.max(-0.32, Math.min(0.32, yawRate / Math.max(2, speed) * 0.6)) : 0;
  }
  for (const t of rig.tracks || []) {
    t.travel = (t.travel + (forward / scale - yawRate * t.x) * dt) % t.length;
    for (let i = 0; i < t.count; i++) {
      const d = ((i * t.length / t.count + t.travel) % t.length + t.length) % t.length;
      let z, y, angle;
      if (d < t.span) { z = t.rear + d; y = -t.r; angle = 0; }
      else if (d < t.span + Math.PI * t.r) {
        const a = (d - t.span) / t.r;
        z = t.front + Math.sin(a) * t.r; y = -Math.cos(a) * t.r; angle = -a;
      } else if (d < t.span * 2 + Math.PI * t.r) {
        z = t.front - (d - t.span - Math.PI * t.r); y = t.r; angle = Math.PI;
      } else {
        const a = (d - t.span * 2 - Math.PI * t.r) / t.r;
        z = t.rear - Math.sin(a) * t.r; y = Math.cos(a) * t.r; angle = Math.PI - a;
      }
      t.pose.position.set(t.x, t.y + y, z);
      t.pose.rotation.x = angle;
      t.pose.updateMatrix();
      t.mesh.setMatrixAt(i, t.pose.matrix);
    }
    t.mesh.instanceMatrix.needsUpdate = true;
  }
}
