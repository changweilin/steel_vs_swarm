import * as THREE from 'three';
import { runtimeMeshDataGeometry } from './runtimePartModel.js';

// Rendering adapter only; placement and shape decisions live in the pure generators.
export function architecturePartGeometry(part) {
  const [type, a, b, c, segments] = part.g;
  const geometry = type === 'mesh' ? runtimeMeshDataGeometry(a)
    : type === 'box' ? new THREE.BoxGeometry(a, b, c)
    : type === 'cyl' ? new THREE.CylinderGeometry(a, b, c, segments || 8)
    : null;
  if (!geometry) throw new RangeError('Unsupported architecture primitive: ' + type);
  geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...part.p),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.r || [0, 0, 0]))),
    new THREE.Vector3(...(part.s || [1, 1, 1]))));
  if (!geometry.attributes.uv) geometry.setAttribute('uv',
    new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
  const color = new THREE.Color(part.c).multiplyScalar(.94 + (part.colorVariant || 0) * .06);
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set([color.r, color.g, color.b], i);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}
