import * as THREE from 'three';
import { compileSceneParts, scenePartGeometry } from './scenePropModels.js';
import { mergeGeos } from './beacons.js';
import { lodSlot } from './lod.js';
import { envMat, celWindTime, getWeatherDynamics } from './toon.js';
import { wildlifeInit, wildlifeStep, wildlifeHeading, animalParts, wingAngle, tailAngle } from './wildlife.js';

// Each species shares one batch per articulated part across every habitat route.
export function buildWildlifeBatches(group, populations, { probe, bounds, waterY, validAt, wetAt, low = false } = {}) {
  const batches = [], states = [], matrix = new THREE.Matrix4(), root = new THREE.Matrix4();
  const joint = new THREE.Matrix4(), rotation = new THREE.Quaternion(), local = new THREE.Quaternion();
  const position = new THREE.Vector3(), size = new THREE.Vector3(), heading = [0, 0, 1];
  const forward = new THREE.Vector3(0, 0, 1), direction = new THREE.Vector3();
  const axisX = new THREE.Vector3(1, 0, 0), axisY = new THREE.Vector3(0, 1, 0), axisZ = new THREE.Vector3(0, 0, 1);
  let total = 0;
  const budget = low ? 64 : 128;
  for (const { species, routes, density = 1 } of populations) {
    if (!(density > 0) || total >= budget) continue;
    const animals = [];
    for (const route of routes) {
      const count = Math.min(budget - total, Math.max(1, Math.round(route.count * Math.min(1.5, density))));
      if (!count) break;
      const st = wildlifeInit({ ...route, count });
      states.push({ st, elapsed: 0 });
      for (let i = 0; i < count; i++) animals.push({ st, i });
      total += count;
    }
    if (!animals.length) continue;
    const parts = animalParts(species), staticParts = parts.filter(p => !p.leg && !p.tail && !p.wing);
    const articulated = parts.filter(p => p.leg || p.tail || p.wing);
    const make = (geo, name) => {
      const mesh = new THREE.InstancedMesh(geo, envMat(0xffffff, { vertexColors: true, wash: .15, cool: .3, rim: 0 }), animals.length);
      mesh.name = `wildlife-${species}-${name}`;
      mesh.frustumCulled = false; mesh.castShadow = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(mesh);
      return mesh;
    };
    const body = make(compileSceneParts(staticParts), 'body');
    const limbs = articulated.map(part => ({ part, pivot: new THREE.Vector3(...part.p),
      rest: new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.r || [0, 0, 0]))),
      mesh: make(mergeGeos([scenePartGeometry({ ...part, p: [0, 0, 0], r: [0, 0, 0] })],
        [part.g[1].colors ? null : part.c]), part.key) }));
    batches.push({ species, animals, body, limbs });
  }
  const write = (t, dyn) => {
    for (const batch of batches) {
      const { species, animals, body, limbs } = batch;
      for (let index = 0; index < animals.length; index++) {
        const { st, i } = animals[index], spec = st.spec, j = i * 3;
        const x = st.pos[j], z = st.pos[j + 2], ground = probe(x, z);
        if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(ground)) {
          root.makeScale(0, 0, 0); body.setMatrixAt(index, root);
          for (const limb of limbs) limb.mesh.setMatrixAt(index, root);
          continue;
        }
        const airborne = species === 'bird' || spec.flying;
        const aquatic = species === 'fish';
        const activity = airborne ? dyn.activity ?? 1 : 1;
        let visible = Number.isFinite(ground) && x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ
          && (index + .5) / animals.length <= activity;
        let y = st.pos[j + 1];
        if (aquatic) {
          visible &&= Number.isFinite(waterY) && ground < waterY - .4 && (!wetAt || wetAt(x, z));
          y = Math.max(ground + .15, Math.min(waterY - .25, y));
          if (!Number.isFinite(y)) y = 0;
        } else if (!airborne) {
          visible &&= !validAt || validAt(x, z);
          y = ground + spec.GROUND_OFFSET;
        } else y = Math.max(ground + .4, y);
        wildlifeHeading(st, i, heading);
        direction.set(heading[0], airborne || aquatic ? heading[1] : 0, heading[2]);
        rotation.identity();
        if (direction.lengthSq() > 1e-9) rotation.setFromUnitVectors(forward, direction.normalize());
        const moving = Math.min(1, Math.hypot(st.vel[j], st.vel[j + 2]) / spec.SPEED);
        const stride = (t * (spec.STRIDE_HZ || spec.BOUNCE_HZ || 2.8) + st.wing[i]) * Math.PI * 2;
        const hop = spec.BOUNCE_AMP ? Math.max(0, Math.sin(stride)) * spec.BOUNCE_AMP * moving : 0;
        position.set(x, y + hop, z); size.setScalar(visible ? 1 : 0);
        root.compose(position, rotation, size); body.setMatrixAt(index, root);
        for (const { part, mesh, pivot, rest } of limbs) {
          if (part.wing) local.setFromAxisAngle(axisZ, wingAngle(st, i, t) * part.wing);
          else if (part.tail) local.setFromAxisAngle(axisY, tailAngle(st, i, t));
          else local.setFromAxisAngle(axisX, Math.sin(stride) * .5 * moving * part.leg);
          local.multiply(rest);
          joint.compose(pivot, local, unitScale);
          matrix.multiplyMatrices(root, joint); mesh.setMatrixAt(index, matrix);
        }
      }
      body.instanceMatrix.needsUpdate = true;
      for (const limb of limbs) limb.mesh.instanceMatrix.needsUpdate = true;
    }
  };
  let flockFrame = 0;
  const flockDiv = low ? 4 : 2;
  const update = (dt, t = celWindTime(), dyn = getWeatherDynamics()) => {
    if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(t)) return;
    flockFrame++;
    // Route integration is staggered; joint poses still follow the shared clock every frame.
    for (let i = 0; i < states.length; i++) {
      const state = states[i];
      state.elapsed = Math.min(.25, state.elapsed + Math.min(.25, dt));
      if (!lodSlot(flockFrame, i, flockDiv)) continue;
      wildlifeStep(state.st, t, state.elapsed);
      state.elapsed = 0;
    }
    write(t, dyn);
  };
  write(0, getWeatherDynamics());
  return { total, batches, update };
}
const unitScale = new THREE.Vector3(1, 1, 1);
