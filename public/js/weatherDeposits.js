import * as THREE from 'three';
import { envMat, disposeTree } from './toon.js';
import { weatherSurfaceCover, WEATHER_SURFACE } from './weatherState.js';
import { mulberry32 } from './rng.js';

// A camera-local mesh samples fixed world coordinates: moving the camera cannot reseed dunes.
export function makeWeatherDeposits(scene, terrain, { lowPower = false, surface } = {}) {
  const n = lowPower ? 64 : 96, step = 3, half = n * step / 2;
  const geo = new THREE.PlaneGeometry(n * step, n * step, n, n);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, envMat(0xc7a365, { rim: 0, wash: .15, land: true, bands: 4 }));
  mesh.receiveShadow = true;
  mesh.visible = false;
  scene.add(mesh);
  const positions = geo.attributes.position, bases = new Float32Array(positions.count), factors = new Float32Array(positions.count);
  const cells = new Int32Array(positions.count), dunes = [], spacing = 36;
  let columns = 0;
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
        const minCellX = Math.floor((x - half) / spacing) - 1, minCellZ = Math.floor((z - half) / spacing) - 1;
        columns = Math.floor((x + half) / spacing) - minCellX + 2;
        const rows = Math.floor((z + half) / spacing) - minCellZ + 2;
        dunes.length = 0;
        for (let iz = 0; iz < rows; iz++) for (let ix = 0; ix < columns; ix++) {
          const cellX = minCellX + ix, cellZ = minCellZ + iz;
          const rnd = mulberry32(Math.imul(cellX, 73856093) ^ Math.imul(cellZ, 19349663));
          const yaw = (rnd() - .5) * .8;
          dunes.push({ x: (cellX + .3 + rnd() * .4) * spacing, z: (cellZ + .3 + rnd() * .4) * spacing,
            threshold: .02 + rnd() * .65, height: .75 + rnd() * .5, cos: Math.cos(yaw), sin: Math.sin(yaw) });
        }
        for (let i = 0; i < positions.count; i++) {
          const px = x + positions.getX(i), pz = z + positions.getZ(i), h = heightAt(px, pz);
          cells[i] = (Math.floor(pz / spacing) - minCellZ) * columns + Math.floor(px / spacing) - minCellX;
          bases[i] = Number.isFinite(h) ? h : 0;
          const grade = Math.max(Math.abs(heightAt(px + step, pz) - h), Math.abs(heightAt(px, pz + step) - h)) / step;
          const inside = px > terrain.minX && px < terrain.maxX && pz > terrain.minZ && pz < terrain.maxZ;
          const dry = !Number.isFinite(terrain.waterY) || h > terrain.waterY || terrain.inDryBand?.(px, pz);
          const exposed = !surface || surface(px, pz) <= h + .25;
          factors[i] = inside && dry && exposed && Number.isFinite(grade) ? Math.max(0, 1 - grade / WEATHER_SURFACE.flatGrade) : 0;
        }
      }
      for (const dune of dunes) {
        const growth = Math.max(0, (amount - dune.threshold) / (1 - dune.threshold));
        dune.rx = 3.5 + growth * 20.5; dune.rz = 4 + growth * 28;
        dune.rise = growth * (5 + growth * 3) * dune.height;
      }
      for (let i = 0; i < positions.count; i++) {
        const lx = positions.getX(i), lz = positions.getZ(i), px = cx + lx, pz = cz + lz;
        let rise = 0;
        // Overlapping world-seeded footprints merge without seams at cell boundaries.
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const dune = dunes[cells[i] + dz * columns + dx];
          if (dune.rise <= 0) continue;
          const ox = px - dune.x, oz = pz - dune.z;
          const u = (ox * dune.cos + oz * dune.sin) / dune.rx, v = (-ox * dune.sin + oz * dune.cos) / dune.rz;
          const windward = u < 0 ? 1.15 : .8;
          const mound = Math.max(0, 1 - u * u / (windward * windward) - v * v);
          rise += dune.rise * mound * mound;
        }
        const edge = Math.min(1, (half - Math.max(Math.abs(lx), Math.abs(lz))) / 18);
        // The edge sits below the surface, avoiding a rectangular overlay boundary.
        positions.setY(i, bases[i] - .035 + rise * factors[i] * Math.max(0, edge));
      }
      positions.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
    },
    dispose() { scene.remove(mesh); disposeTree(mesh); },
  };
}
