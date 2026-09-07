// 場景實體部署縫：輸入已定案的幾何與變換，不參與碰撞、選址或亂數抽樣。
import * as THREE from 'three';

/** 每種外觀編譯一次；呼叫端提供矩陣寫入器，保留各物件的尺度契約。 */
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
    // 世界曲面由頂點 shader 處理；CPU 包絡不可用於視錐剔除。
    mesh.frustumCulled = false;
    mesh.name = `${name}:${variant}`;
    mesh.userData.runtimePart = { ...metadata, paletteIndex: variant };
    root.add(mesh);
  }
  const result = root.children.length === 1 ? root.children[0] : root;
  result.userData.deployment = { objects: rows.length, batches: variants.size };
  return result;
}

/** 逐款部署；讓步由啟動流程注入，所有展示／對戰共用同一建構器。 */
export async function deploySceneBatches(batches, target, build, onProgress) {
  const rows = [...batches];
  const started = performance.now();
  let objects = 0;
  for (let index = 0; index < rows.length; index++) {
    const batch = rows[index];
    const built = build(batch.entry, batch.rows);
    // 建物淨空逐一存取直接子節點；配色分組不留下中間容器。
    if (built.isGroup) target.add(...built.children.slice());
    else target.add(built);
    objects += batch.rows.length;
    await onProgress?.((index + 1) / rows.length, '部署賽璐璐 3D 場景物件…');
  }
  return { objects, prototypes: rows.length, milliseconds: performance.now() - started };
}
