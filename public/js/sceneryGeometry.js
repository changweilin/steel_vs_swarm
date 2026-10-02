import * as THREE from 'three';
import { runtimeMeshDataGeometry, runtimePrimitiveGeometry } from './runtimePartModel.js';
import { sceneryMeshData } from './sceneryAppearance.js';

export const sceneryGeometry = (name, dimensions) => runtimeMeshDataGeometry(sceneryMeshData(name, dimensions));

export function sceneryBoxGeometry(dimensions) {
  const geometry = runtimePrimitiveGeometry({ type: 'box', dimensions });
  geometry.deleteAttribute('color');
  if (!geometry.attributes.uv) geometry.setAttribute('uv',
    new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
  return geometry;
}
