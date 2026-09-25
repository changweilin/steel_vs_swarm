import * as THREE from 'three';
import { runtimeMeshDataGeometry } from './runtimePartModel.js';
import { facetMeshData } from './vesselGeometry.js';
import { CYL_FACET_DEG } from './architectureRoofParts.js';

// 柱體頂底蓋與側面在 three 原生幾何中共用圈頂點，平均後簷口整圈色帶；
// 拆成法線群組（仍帶順序 index，合批相容），方盒本已逐面拆點故略過。
export function facetCylinderGeometry(geometry, deg = CYL_FACET_DEG) {
  const position = geometry.attributes.position, uv = geometry.attributes.uv, index = geometry.index;
  const srcFaces = [...index.array];
  const flat = facetMeshData({ vertices: [...position.array], faces: srcFaces }, deg);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(flat.vertices, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(flat.normals, 3));
  if (uv) {
    const uvs = new Float32Array(flat.faces.length * 2);
    for (let f = 0; f < flat.faces.length; f++) {
      uvs[f * 2] = uv.getX(srcFaces[f]); uvs[f * 2 + 1] = uv.getY(srcFaces[f]);
    }
    out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }
  out.setIndex(flat.faces);
  return out;
}

// 非均勻縮放會把光滑法線場拉壞（塗鴉泡泡／菱形葉的橢圓化），逐面攤平；
// 均勻縮放保持圓潤（水塔／柱盤），只拆頂底蓋。
const uniformScale = (s) => !s || (s[0] === s[1] && s[1] === s[2]);

// Rendering adapter only; placement and shape decisions live in the pure generators.
export function architecturePartGeometry(part) {
  const [type, a, b, c, segments] = part.g;
  const geometry = type === 'mesh' ? runtimeMeshDataGeometry(a)
    : type === 'box' ? new THREE.BoxGeometry(a, b, c)
    : type === 'cyl' ? facetCylinderGeometry(new THREE.CylinderGeometry(a, b, c, segments || 8),
      uniformScale(part.s) ? CYL_FACET_DEG : 0)
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
