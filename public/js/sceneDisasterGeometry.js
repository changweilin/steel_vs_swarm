import * as THREE from 'three';
import { AMBIENT_SURFACES } from './ambientMeshData.js';
import { runtimeMeshDataGeometry } from './runtimePartModel.js';

// Radial rings share their angular phase, keeping the surface closed after deformation.
function ringsGeometry(rings, sides, point) {
  const vertices = [], faces = [];
  for (let row = 0; row < rings; row++) for (let i = 0; i < sides; i++) {
    vertices.push(...point(row, i * Math.PI * 2 / sides));
    if (!row) continue;
    const a = (row - 1) * sides + i, b = (row - 1) * sides + (i + 1) % sides;
    const c = row * sides + i, d = row * sides + (i + 1) % sides;
    faces.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(faces);
  geometry.computeVertexNormals();
  return geometry;
}

export function flameGeometry(radius, height) {
  const geometry = runtimeMeshDataGeometry(AMBIENT_SURFACES.flame);
  geometry.deleteAttribute('color');
  geometry.scale(radius * 2, height, radius * 2);
  return geometry;
}

export function smokeGeometry(radius) {
  const geometry = new THREE.IcosahedronGeometry(radius, 1), p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + .13 * Math.sin(x / radius * 5) * Math.cos(z / radius * 4) + .08 * Math.sin(y / radius * 6);
    p.setXYZ(i, x * k, y * k * .82, z * k);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function brokenGroundGeometry(radius, depth) {
  const profile = [[0, -depth], [.62, -depth], [.81, -.08], [.9, .08], [1, 0]];
  const geometry = ringsGeometry(profile.length, 32, (row, a) => {
    const edge = .92 + .05 * Math.sin(a * 5) + .025 * Math.cos(a * 9);
    return [Math.cos(a) * radius * profile[row][0] * edge, profile[row][1],
      Math.sin(a) * radius * profile[row][0] * edge];
  });
  // The crater is viewed from above; reverse the radial sweep's inward-facing winding.
  const indices = geometry.index.array;
  for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  geometry.computeVertexNormals();
  return geometry;
}
