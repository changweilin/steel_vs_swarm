// Each battle owns bounded authored shore batches; these meshes never enter movement or hit authority.
import * as THREE from 'three';
import { envMat } from './toon.js';
import { SHORE_MESHES } from './shorelineMeshData.js';

/** post: caller owns the returned geometry. */
export function shoreGeometry(kind, variant = 0) {
  const data = SHORE_MESHES[kind + '/' + variant];
  if (!data) throw new RangeError('Unknown shore model: ' + kind + '/' + variant);
  const geo = new THREE.BufferGeometry(), colors = [], color = new THREE.Color();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(data.vertices, 3));
  for (const hex of data.colors) { color.setHex(hex); colors.push(color.r, color.g, color.b); }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/** pre: rows are fitted world-space plans. post: buffers/materials belong to group and existing disposeTree teardown. */
export function buildShoreFacilities(group, rows) {
  const buckets = new Map(), matrix = new THREE.Matrix4();
  for (const row of rows) {
    const key = row.kind + '/' + row.variant;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }
  for (const [key, items] of buckets) {
    const [kind, variant] = key.split('/');
    const mesh = new THREE.InstancedMesh(shoreGeometry(kind, +variant), envMat(0xffffff, { vertexColors: true }), items.length);
    mesh.name = 'shore/' + key;
    for (let i = 0; i < items.length; i++) {
      const row = items[i];
      matrix.makeRotationY(row.ry); matrix.scale(new THREE.Vector3(row.scale, row.scale, row.scale));
      matrix.setPosition(row.x, row.y, row.z); mesh.setMatrixAt(i, matrix);
    }
    mesh.computeBoundingBox(); mesh.computeBoundingSphere(); mesh.receiveShadow = true;
    group.add(mesh);
  }
  return { instances: rows.length, batches: buckets.size };
}
