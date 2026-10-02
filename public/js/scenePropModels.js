import * as THREE from 'three';
import { createForestTree } from './forest.js';
import { runtimeMeshDataGeometry, runtimePrimitiveGeometry } from './runtimePartModel.js';
import { sceneryGeometry } from './sceneryGeometry.js';
import { mergeGeos } from './beacons.js';
import { envMat, disposeTree } from './toon.js';
import { geologyBackgroundObject } from './geology.js';
import { generateVessel } from './vesselCatalog.js';
import { buildGeneratedVesselMesh } from './vesselModels.js';
import { sceneFurnitureParts } from './sceneFurnitureParts.js';

/** Compile existing descriptors without introducing another placement or collision system. */
export function scenePartGeometry(part) {
  const [type, a, b, c, sides] = part.g;
  let geometry;
  if (type === 'mesh') geometry = runtimeMeshDataGeometry(a);
  else if (type === 'box') geometry = runtimePrimitiveGeometry({ type: 'box', dimensions: [a, b, c] });
  else if (type === 'cyl') geometry = new THREE.CylinderGeometry(a, b, c, sides || 8);
  else if (type === 'cone') geometry = new THREE.ConeGeometry(a, b, c || 8);
  else if (type === 'crown') geometry = sceneryGeometry('crown', [a * 2, a * 2, a * 2]);
  else if (type === 'ico') {
    geometry = new THREE.IcosahedronGeometry(a, 1);
  }
  else if (type === 'lathe') geometry = new THREE.LatheGeometry(a.map(p => new THREE.Vector2(...p)), b || 16);
  else if (type === 'torus') geometry = new THREE.TorusGeometry(a, b, c || 6, sides || 16);
  else throw new RangeError('Unsupported scene primitive: ' + type);
  if (!geometry) throw new TypeError('Invalid scene mesh');
  geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...(part.p || [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.r || [0, 0, 0]))),
    new THREE.Vector3(...(part.s || [1, 1, 1]))));
  return geometry;
}

export function compileSceneParts(parts) {
  if (!parts.length) throw new RangeError('Empty scene model');
  return mergeGeos(parts.map(scenePartGeometry), parts.map(part => part.c ?? null));
}

/** Only visual geometry is fitted. The caller retains its authoritative envelope. */
export function fitSceneGeometry(geometry, size, referenceBounds = null) {
  if (!Array.isArray(size) || size.length !== 3 || size.some(n => !Number.isFinite(n) || n <= 0)) {
    throw new RangeError('Scene dimensions must be positive finite numbers');
  }
  geometry.computeBoundingBox();
  const box = referenceBounds || geometry.boundingBox, span = box.getSize(new THREE.Vector3());
  if (![span.x, span.y, span.z].every(n => Number.isFinite(n) && n > 0)) throw new RangeError('Degenerate scene model');
  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  geometry.scale(size[0] / span.x, size[1] / span.y, size[2] / span.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function forestSceneGeometry(type, seed, size, season = 'summer') {
  const tree = createForestTree(type, seed, undefined, undefined, 1, season);
  const parts = tree.parts.map(part => {
    const g = part.g.parameters;
    return {
      g: g.height ? ['cyl', g.radiusTop, g.radiusBottom, g.height, g.radialSegments]
        : [part.role === 'leaf' ? 'crown' : 'ico', g.radius],
      p: [part.px || 0, part.y || 0, part.pz || 0],
      r: [part.rx || 0, part.ry || 0, part.rz || 0],
      s: [part.sx || 1, part.sy || 1, part.sz || 1], c: part.c, hidden: part.hidden, role: part.role,
    };
  });
  if (type === 'fallenLog') {
    const trunk = parts.find(part => part.role === 'trunk');
    const direction = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(...trunk.r));
    for (const sign of [-1, 1]) for (let ring = 0; ring < 4; ring++) {
      const radius = trunk.g[sign < 0 ? 2 : 1] * (.94 - ring * .19);
      const p = new THREE.Vector3(...trunk.p).addScaledVector(direction, sign * (trunk.g[3] / 2 + ring * .004));
      parts.push({ g: ['cyl', radius, radius, .012, 12], p: p.toArray(), r: trunk.r,
        c: ring % 2 ? 0x9a7952 : 0xc1a078, role: 'wood' });
    }
  }
  // Leaf shedding must never enlarge or move the winter trunk inside its collider.
  const envelope = compileSceneParts(parts.filter(part => !['snow', 'flower', 'fruit'].includes(part.role)));
  envelope.computeBoundingBox();
  const bounds = envelope.boundingBox.clone();
  envelope.dispose();
  return fitSceneGeometry(compileSceneParts(parts.filter(part => !part.hidden)), size, bounds);
}

export function furnitureSceneGeometry(kind, size = null) {
  const geometry = compileSceneParts(sceneFurnitureParts(kind));
  return size ? fitSceneGeometry(geometry, size) : geometry;
}

export function furnitureSceneBatches(kind, height) {
  const buckets=new Map();
  for(const part of sceneFurnitureParts(kind)) {
    const key=part.e || 0;
    if(!buckets.has(key))buckets.set(key,[]);
    buckets.get(key).push(part);
  }
  const rows=[...buckets].map(([e,parts])=>({g:compileSceneParts(parts),y:0,c:0xffffff,e:e||undefined}));
  const bounds=new THREE.Box3();
  for(const row of rows){row.g.computeBoundingBox();bounds.union(row.g.boundingBox);}
  const scale=height/bounds.max.y;
  for(const row of rows)row.g.scale(scale,scale,scale);
  return rows;
}

export function vesselSceneGeometry(seed, size) {
  const model = buildGeneratedVesselMesh(generateVessel(seed, { id: 'container' }), { wake: false });
  model.rotation.y = Math.PI / 2;
  model.updateMatrixWorld(true);
  const geos = [], colors = [];
  model.traverse(node => {
    if (!node.isMesh || node.userData.isOutline) return;
    geos.push(node.geometry.clone().applyMatrix4(node.matrixWorld));
    colors.push(node.material.color.getHex());
  });
  const geometry = mergeGeos(geos, colors);
  disposeTree(model);
  geometry.computeBoundingBox();
  const span = geometry.boundingBox.getSize(new THREE.Vector3());
  const scale = Math.min(size[0] / span.x, size[1] / span.y, size[2] / span.z);
  return fitSceneGeometry(geometry, [span.x * scale, span.y * scale, span.z * scale]);
}

export function geologySceneGeometry(type, seed, size) {
  const model = geologyBackgroundObject(type, seed, { segments: 12, vegetation: 0 });
  return fitSceneGeometry(runtimeMeshDataGeometry(model.meshData), size);
}

export function addSceneGeometry(group, geometry, name) {
  const mesh = new THREE.Mesh(geometry, envMat(0xffffff, { vertexColors: true, wash: .35, cool: .4, rim: .035 }));
  mesh.name = name;
  // Keep the compiled assembly rigid: independent part jitter would reopen branch joints.
  mesh.userData.sceneAssembly = true;
  group.add(mesh);
  return mesh;
}
