import * as THREE from 'three';
import { cloneVisualMaterial } from './toon.js';
import { buildingBounds, mapBuildingId, mapBuildingHp } from './mapBuilding.js';

export function mapBuildingTarget(record) {
  const b=record.bounds, mesh=new THREE.Group();
  mesh.position.set(b.x,b.y,b.z);
  return { id:record.id,kind:'mapbuilding',record,mesh,hp:record.max,max:record.max,
    neutral:true,isStatic:true,sceneStage:0,dimR:Math.max(b.w,b.d)/2,dimH:b.h,dimTop:b.h,colH:b.h };
}

/** Vertex ownership survives batching; intact structural meshes remain merged. */
export function buildingRanges(geometries) {
  let start = 0, indexStart = 0;
  return geometries.map((geometry) => {
    const count = geometry.attributes.position.count, indexCount = geometry.index?.count || 0;
    const range = { key: geometry.userData.buildingKey, start, count, indexStart, indexCount };
    start += count; indexStart += indexCount;
    return range;
  });
}

export function registerMapBuildings(group, blockers, platforms, meshes, landmarks) {
  const records = new Map();
  for (const b of blockers) {
    if (!b.buildingKey || !(b.hw2 > 0 && b.hd2 > 0)) continue;
    if (!records.has(b.buildingKey)) records.set(b.buildingKey, { key: b.buildingKey, boxes: [], sources: [], platforms: [] });
    records.get(b.buildingKey).boxes.push(b);
  }
  for (const mesh of meshes) for (const range of mesh.userData.buildingRanges || []) {
    records.get(range.key)?.sources.push({ mesh, ...range });
  }
  for (const p of platforms) records.get(p.buildingKey)?.platforms.push(p);
  for (const lm of landmarks) {
    const record = records.get(lm.g.userData.buildingKey);
    if (record) record.direct = lm.g;
  }
  group.traverse(node => {
    const record = records.get(node.userData.buildingAttachmentKey);
    if (record) (record.attachments ??= []).push(node);
  });
  for (const [key, record] of records) {
    if (!record.sources.length && !record.direct) { records.delete(key); continue; }
    record.bounds = buildingBounds(record.boxes);
    record.id = mapBuildingId(key);
    record.max = mapBuildingHp(record.bounds.w, record.bounds.d, record.bounds.h);
    record.parent = group;
  }
  return records;
}

/** Split only the damaged building; never mutate another instance's geometry or material. */
export function detachMapBuilding(record) {
  if (record.mesh) return record.mesh;
  const root = new THREE.Group(), { x, y, z } = record.bounds;
  root.position.set(x, y, z);
  record.parent.add(root);
  if (record.direct) {
    root.attach(record.direct);
  } else {
    for (const source of record.sources) {
      const geometry = new THREE.BufferGeometry(), original = source.mesh.geometry;
      for (const [name, attribute] of Object.entries(original.attributes)) {
        geometry.setAttribute(name, new THREE.BufferAttribute(attribute.array.slice(
          source.start * attribute.itemSize, (source.start + source.count) * attribute.itemSize), attribute.itemSize, attribute.normalized));
      }
      if (original.index) geometry.setIndex(Array.from(original.index.array.slice(source.indexStart, source.indexStart+source.indexCount), (i) => i-source.start));
      geometry.translate(-x,-y,-z);
      const material = Array.isArray(source.mesh.material) ? source.mesh.material.map(cloneVisualMaterial) : cloneVisualMaterial(source.mesh.material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      root.add(mesh);
      const position = original.attributes.position;
      for (let i=source.start; i<source.start+source.count; i++) position.setXYZ(i,x,y,z);
      position.needsUpdate = true;
    }
  }
  for (const attachment of record.attachments || []) root.attach(attachment);
  record.mesh = root;
  return root;
}
