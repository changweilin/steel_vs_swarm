import * as THREE from 'three';
import { envMat, disposeTree } from './toon.js';
import { weatherSurfaceCover, WEATHER_SURFACE } from './weatherState.js';

// A camera-local mesh samples fixed world coordinates: moving the camera cannot reseed dunes.
export function makeWeatherDeposits(scene, terrain, { lowPower = false, surface } = {}) {
  const n = lowPower ? 64 : 96, step = 3, half = n * step / 2;
  const geo = new THREE.PlaneGeometry(n * step, n * step, n, n);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, envMat(0xc7a365, { rim: 0, wash: .15, land: true }));
  mesh.receiveShadow = true;
  mesh.visible = false;
  scene.add(mesh);
  const positions = geo.attributes.position, bases = new Float32Array(positions.count), factors = new Float32Array(positions.count);
  let cx = NaN, cz = NaN, wait = 0, previous = -1;
  const heightAt = (x, z) => terrain.heightAt(x, z);
  return {
    update(dt, camera, state) {
      const amount = weatherSurfaceCover(state.sand);
      mesh.visible = amount > .005;
      if (!mesh.visible) return;
      wait -= dt;
      const x = Math.floor(camera.position.x / 24) * 24, z = Math.floor(camera.position.z / 24) * 24;
      const moved = x !== cx || z !== cz;
      if (!moved && wait > 0) return;
      wait = .2;
      if (!moved && Math.abs(previous - amount) < .001) return;
      previous = amount;
      if (moved) {
        cx = x; cz = z;
        mesh.position.set(x, 0, z);
        for (let i = 0; i < positions.count; i++) {
          const px = x + positions.getX(i), pz = z + positions.getZ(i), h = heightAt(px, pz);
          bases[i] = Number.isFinite(h) ? h : 0;
          const grade = Math.max(Math.abs(heightAt(px + step, pz) - h), Math.abs(heightAt(px, pz + step) - h)) / step;
          const inside = px > terrain.minX && px < terrain.maxX && pz > terrain.minZ && pz < terrain.maxZ;
          const dry = !Number.isFinite(terrain.waterY) || h > terrain.waterY || terrain.inDryBand?.(px, pz);
          const exposed = !surface || surface(px, pz) <= h + .25;
          factors[i] = inside && dry && exposed && Number.isFinite(grade) ? Math.max(0, 1 - grade / WEATHER_SURFACE.flatGrade) : 0;
        }
      }
      for (let i = 0; i < positions.count; i++) {
        const lx = positions.getX(i), lz = positions.getZ(i), px = cx + lx, pz = cz + lz;
        const cellX = Math.floor(px / 24), cellZ = Math.floor(pz / 24);
        const seed = Math.sin(cellX * 127.1 + cellZ * 311.7) * 43758.5453;
        const threshold = (seed - Math.floor(seed)) * .8;
        const growth = Math.max(0, (amount - threshold) / (1 - threshold));
        const dx = (px / 24 - cellX - .5) * 2, dz = (pz / 24 - cellZ - .5) * 2;
        const radius = .15 + growth * .85;
        const mound = Math.max(0, 1 - (dx * dx + dz * dz) / (radius * radius));
        const edge = Math.min(1, (half - Math.max(Math.abs(lx), Math.abs(lz))) / 18);
        // The edge sits below the surface, avoiding a rectangular overlay boundary.
        positions.setY(i, bases[i] - .035 + 1.6 * growth * mound * mound * factors[i] * Math.max(0, edge));
      }
      positions.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
    },
    dispose() { scene.remove(mesh); disposeTree(mesh); },
  };
}
