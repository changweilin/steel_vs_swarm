import * as THREE from 'three';
import { mergeGeos } from './beacons.js';
import { envMat } from './toon.js';

/** Static structures stay batched; only declared moving assemblies acquire a pivot. */
export function buildPartMotion(parts, geometryOf) {
  const root = new THREE.Group(), sets = new Map(), joints = [];
  for (const part of parts) {
    if (!part.motion) continue;
    const id = part.motion.id;
    if (!sets.has(id)) sets.set(id, []);
    sets.get(id).push(part);
  }
  for (const rows of sets.values()) {
    const motion = rows[0].motion;
    if (!['spin', 'swing'].includes(motion.kind) || !['x', 'y', 'z'].includes(motion.axis)
      || !motion.pivot?.every(Number.isFinite) || motion.pivot.length !== 3
      || !Number.isFinite(motion.speed)) throw new RangeError('Invalid part motion: ' + motion.id);
    const pivot = new THREE.Group();
    pivot.name = motion.id;
    pivot.position.set(...motion.pivot);
    const geos = rows.map(part => {
      const geo = geometryOf(part);
      geo.translate(-motion.pivot[0], -motion.pivot[1], -motion.pivot[2]);
      return geo;
    });
    const mesh = new THREE.Mesh(mergeGeos(geos, rows.map(p => p.c ?? null)),
      envMat(0xffffff, { vertexColors: true, wash: .35, cool: .4 }));
    mesh.frustumCulled = false;
    pivot.add(mesh); root.add(pivot);
    joints.push({ pivot, motion });
  }
  root.userData.partMotionUpdate = now => {
    if (!Number.isFinite(now) || root.userData.partMotionPaused) return;
    for (const { pivot, motion: m } of joints) {
      const phase = now * m.speed + (m.phase || 0);
      pivot.rotation[m.axis] = m.kind === 'spin' ? phase % (Math.PI * 2)
        : Math.sin(phase) * (m.amplitude ?? 0.08);
    }
  };
  root.userData.partMotionUpdate(0);
  return root;
}
