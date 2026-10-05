import * as THREE from 'three';
import { envMat } from './hazards.js';
import { ROAD_STRUCTURE_MESHES } from './roadStructureMeshData.js';

// Each caller owns its geometry. No cache retains disposed GPU buffers across battles.
export function roadStructureGeo(kind, w = 1, h = 1, d = 1) {
  const row = ROAD_STRUCTURE_MESHES[kind];
  if (!row || ![w, h, d].every(v => Number.isFinite(v) && v > 0)) throw new RangeError(`Invalid road member: ${kind}`);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(row.vertices, 3));
  geometry.setIndex(row.faces);
  geometry.scale(w, h, d);
  // Flat faces keep concrete chamfers legible in the shipped cel renderer.
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  flat.computeVertexNormals();
  return flat;
}

export function roadBarrierGeo(band) {
  const row = ROAD_STRUCTURE_MESHES.barrier;
  const vertices = [], indices = [];
  for (let i = 0; i < band.idx.length; i += 6) {
    const k = band.idx[i], next = k + 2, base = vertices.length / 3;
    for (let v = 0; v < row.vertices.length; v += 3) {
      const t = row.vertices[v + 2] + .5;
      const a = k * 3, b = next * 3;
      const nx = band.nrm[a] * (1 - t) + band.nrm[b] * t;
      const nz = band.nrm[a + 2] * (1 - t) + band.nrm[b + 2] * t;
      const y0 = band.pos[a + 1] * (1 - t) + band.pos[b + 1] * t;
      const y1 = band.pos[a + 4] * (1 - t) + band.pos[b + 4] * t;
      vertices.push(band.pos[a] * (1 - t) + band.pos[b] * t + nx * row.vertices[v] * .55,
        y0 + (row.vertices[v + 1] + .5) * (y1 - y0),
        band.pos[a + 2] * (1 - t) + band.pos[b + 2] * t + nz * row.vertices[v] * .55);
    }
    for (const face of row.faces) indices.push(base + face);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  const flat = geometry.toNonIndexed(); geometry.dispose(); flat.computeVertexNormals();
  return flat;
}

export function buildRoadStructureDetails(group, runs, terrain, decks, { roundaboutIsland, roadWidth }) {
  const curbs = [], joints = [], drains = [], junctions = [];
  const junctionMap = new Map();
  const add = (rows, x, y, z, ry, w, h, d) => rows.push({ x, y, z, ry, w, h, d });
  const seen = new Set();
  for (const run of runs) {
    if (run.kind === 'road' && run.tags.junction === 'roundabout') {
      const island = roundaboutIsland(run.points, roadWidth(run.tags) / 2);
      if (!island) continue;
      const key = `${island.x.toFixed(2)},${island.z.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const count = Math.max(16, Math.ceil(Math.PI * 2 * island.r / 2));
      for (let i = 0; i < count; i++) {
        const a = i / count * Math.PI * 2, b = (i + 1) / count * Math.PI * 2;
        const x = island.x + Math.cos((a + b) / 2) * island.r;
        const z = island.z + Math.sin((a + b) / 2) * island.r;
        add(curbs, x, terrain.heightAt(x, z) + .18, z, -(a + b) / 2,
          .28, .36, 2 * island.r * Math.sin((b - a) / 2) + .04);
      }
    }
    if (run.kind === 'road') continue;
    if (run.kind === 'bridge') for (const [x, z] of run.junctions || []) {
      const i = run.points.findIndex(p => Math.hypot(p[0] - x, p[1] - z) < .01);
      if (i < 0) continue;
      const y = run.floors[i], key = `${x.toFixed(3)},${z.toFixed(3)},${y.toFixed(3)}`;
      const last = junctionMap.get(key);
      if (last) { last.hw = Math.min(last.hw, run.hw); last.count++; }
      else junctionMap.set(key, { x, y, z, hw: run.hw, count: 1 });
    }
    let distance = 0, nextJoint = 18, nextDrain = 5;
    for (let i = 1; i < run.points.length; i++) {
      const a = run.points[i - 1], b = run.points[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6) continue;
      const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len, ry = Math.atan2(dx, dz);
      if (run.kind === 'bridge' && distance + len >= nextJoint && joints.length < 240) {
        const t = Math.max(0, Math.min(1, (nextJoint - distance) / len));
        const y = run.floors[i - 1] + (run.floors[i] - run.floors[i - 1]) * t;
        add(joints, a[0] + dx * len * t, y + .015, a[1] + dz * len * t, ry, run.hw * 2, .025, .16);
        nextJoint += 24;
      }
      if (distance + len >= nextDrain && drains.length < 480) {
        const t = Math.max(0, Math.min(1, (nextDrain - distance) / len));
        const y = run.floors[i - 1] + (run.floors[i] - run.floors[i - 1]) * t;
        for (const side of [-1, 1]) add(drains, a[0] + dx * len * t + dz * (run.hw - .35) * side,
          y + .016, a[1] + dz * len * t - dx * (run.hw - .35) * side, ry, .32, .025, .7);
        nextDrain += 14;
      }
      distance += len;
    }
  }
  for (const j of junctionMap.values()) {
    if (j.count < 2) continue;
    add(junctions, j.x, j.y - .61, j.z, 0, j.hw * 2, 1.2, j.hw * 2);
    decks.push({ x1: j.x - j.hw, z1: j.z, y1: j.y, x2: j.x + j.hw, z2: j.z, y2: j.y, hw: j.hw });
  }
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const p = new THREE.Vector3(), scale = new THREE.Vector3();
  for (const [name, rows, color, kind] of [['roundabout-curbs', curbs, 0xb3ada0, 'platform_slab'],
    ['bridge-expansion-joints', joints, 0x343c40, 'platform_slab'], ['road-drains', drains, 0x41494c, 'crossing_head'],
    ['bridge-junction-decks', junctions, 0x555b61, 'platform_slab']]) {
    if (!rows.length) continue;
    const mesh = new THREE.InstancedMesh(roadStructureGeo(kind), envMat(color, { wash: .25, cool: .4 }), rows.length);
    mesh.name = name; mesh.frustumCulled = false; mesh.userData.noOutline = true;
    rows.forEach((r, i) => {
      q.setFromEuler(e.set(0, r.ry, 0)); p.set(r.x, r.y, r.z); scale.set(r.w, r.h, r.d);
      matrix.compose(p, q, scale); mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }
}
