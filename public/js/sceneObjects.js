// Scene-entity deploy seam: takes finalized geometry and transforms; no collision, siting, or random sampling here.
import * as THREE from 'three';

/** Compile each appearance once; the caller supplies the matrix writer, preserving each object's scale contract. */
export function deploySceneObjects(rows, { variantOf, geometryOf, material, matrixOf, name, metadata }) {
  if (!Array.isArray(rows) || !rows.length) throw new TypeError('場景部署缺少實體');
  const variants = new Map();
  for (const row of rows) {
    const variant = variantOf(row);
    if (!variants.has(variant)) variants.set(variant, []);
    variants.get(variant).push(row);
  }
  const root = new THREE.Group();
  root.name = name;
  const matrix = new THREE.Matrix4();
  for (const [variant, instances] of variants) {
    const mesh = new THREE.InstancedMesh(geometryOf(variant), material, instances.length);
    instances.forEach((row, index) => {
      matrixOf(row, matrix);
      if (!matrix.elements.every(Number.isFinite) || matrix.determinant() <= 0) {
        throw new RangeError(`場景實體變換無效:${name}:${index}`);
      }
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    // World curvature is handled by the vertex shader; CPU envelopes MUST NOT drive frustum culling.
    mesh.frustumCulled = false;
    mesh.name = `${name}:${variant}`;
    mesh.userData.runtimePart = { ...metadata, paletteIndex: variant };
    root.add(mesh);
  }
  const result = root.children.length === 1 ? root.children[0] : root;
  result.userData.deployment = { objects: rows.length, batches: variants.size };
  return result;
}

/** Deploy per prototype; yields are injected by the boot flow so every showcase and battle shares one builder. */
export async function deploySceneBatches(batches, target, build, onProgress) {
  const rows = [...batches];
  const started = performance.now();
  let objects = 0;
  for (let index = 0; index < rows.length; index++) {
    const batch = rows[index];
    const built = build(batch.entry, batch.rows);
    // Access direct child nodes for building clearance; palette groups leave no intermediate containers.
    if (built.isGroup) target.add(...built.children.slice());
    else target.add(built);
    objects += batch.rows.length;
    await onProgress?.((index + 1) / rows.length, '部署賽璐璐 3D 場景物件…');
  }
  return { objects, prototypes: rows.length, milliseconds: performance.now() - started };
}
