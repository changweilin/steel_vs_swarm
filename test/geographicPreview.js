import * as THREE from 'three';
import { buildTerrain } from '/js/terrain.js';
import { buildBiomes } from '/js/biomes.js';
import { VENUES, venueConfig } from '/js/venues.js';
import { disposeTree } from '/js/toon.js';
import { loadVenueEvidence } from '/js/mapEvidenceLoader.js';

export const GEOGRAPHIC_COPY = Object.freeze({
  title: '🛰 地理融合場景',
  description: '衛星覆蓋 × OSM 輪廓 × 高程地形 · 建築／林相／植被／地表／水域',
  idle: '選擇場地後建立融合場景。',
  failed: '場景建立失敗，請重試。',
  missing: '部分來源缺失，顯示可用資料與程序備援。',
  complete: '衛星、OSM 與高程資料已融合。',
  prior: '土地覆蓋先驗：ESA WorldCover 2021。',
  geology: '岩性未知；地表岩塊為程序外觀。',
  exported: 'Blender 場景已匯出。',
  exportPartial: '部分無效或不支援的模型已略過，缺失清單保存在匯出檔中。',
  exportFailed: '場景匯出失敗。',
});

async function encodeChannel(values, Type) {
  const stream = new Blob([new Type(values).buffer]).stream().pipeThrough(new CompressionStream('deflate'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(text);
}

/** The studio uses the battle builders so geographic placement has no second settlement. */
export function createGeographicPreview({ scene, onProgress, onReady }) {
  let record = null, epoch = 0, pending = false;
  function clear() {
    epoch++;
    if (record) {
      scene.remove(record.root);
      disposeTree(record.root);
      record = null;
    }
  }
  async function build(venueId, environment) {
    if (pending) return null;
    const venue = VENUES.find(v => v.id === venueId);
    if (!venue) throw new RangeError('Unknown geographic venue');
    clear();
    const token = epoch;
    pending = true;
    const root = new THREE.Group();
    root.name = 'geographic/' + venueId;
    try {
      const cfg = venueConfig(venue, 1);
      cfg.env = { ...environment };
      const progress = (fraction, label) => { if (token === epoch) onProgress(label, fraction); };
      const terrain = await buildTerrain(cfg, progress);
      const surface = {};
      const material = terrain.mesh.material, compile = material.onBeforeCompile;
      material.onBeforeCompile = function(shader, renderer) {
        compile.call(this, shader, renderer);
        surface.appearance = shader.uniforms.uLandAppearance;
        surface.rect = shader.uniforms.uLandRect;
      };
      root.add(terrain.group);
      if (token !== epoch) return null;
      const biomes = await buildBiomes(cfg, terrain, progress);
      root.add(biomes);
      const prior = await loadVenueEvidence(cfg);
      if (token !== epoch) return null;
      const stats = biomes.userData.stats;
      const metadata = { venue: { id: venue.id, name: venue.name }, center: cfg.center,
        environment: cfg.env, scale: 'game-metres', sourceQuality: terrain.sourceQuality,
        elevationFallback: terrain.usedFallback, stats, geology: 'unknown',
        hydrology: { waterY: terrain.waterY, marine: terrain.isMarine },
        sources: { worldCover: prior ? { source: prior.source, digest: prior.digest } : null,
          osm: { attribution: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL-1.0' } } };
      record = { root, terrain, biomes, metadata, surface };
      scene.add(root);
      onReady(record);
      return record;
    } finally {
      pending = false;
      if (record?.root !== root) disposeTree(root);
    }
  }
  return { clear, build, get record() { return record; }, get pending() { return pending; } };
}

/** Keep shared geometry and instance transforms; Blender expands them without regenerating models. */
export async function geographicSnapshot(record) {
  if (!record?.root) throw new TypeError('No geographic scene to export');
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error('Snapshot requires little-endian typed arrays');
  const geometries = [], meshes = [], omitted = [], seen = new Map();
  const local = new THREE.Matrix4(), world = new THREE.Matrix4(), tint = new THREE.Color();
  record.root.updateMatrixWorld(true);
  const nodes = [];
  record.root.traverseVisible(node => { if (node.isMesh) nodes.push(node); });
  for (const node of nodes) {
    if (node.isSkinnedMesh) { omitted.push({ name: node.name, reason: 'skinning' }); continue; }
    const geo = node.geometry, position = geo?.getAttribute('position');
    if (!position || position.itemSize !== 3) continue;
    if (!seen.has(geo.uuid)) {
      const vertices = [], colors = [], indices = [];
      const color = geo.getAttribute('color');
      const image = node === record.terrain.mesh ? record.surface?.appearance?.value?.image : null;
      const rect = record.surface?.rect?.value;
      for (let i = 0; i < position.count; i++) {
        vertices.push(position.getX(i), position.getY(i), position.getZ(i));
        if (image?.data && rect) {
          const x = Math.max(0, Math.min(image.width - 1, Math.floor((position.getX(i) - rect.x) * rect.z * image.width)));
          const z = Math.max(0, Math.min(image.height - 1, Math.floor((position.getZ(i) - rect.y) * rect.w * image.height)));
          const offset = (z * image.width + x) * 4;
          if (image.data[offset + 3]) {
            tint.setRGB(image.data[offset] / 255, image.data[offset + 1] / 255, image.data[offset + 2] / 255, THREE.SRGBColorSpace);
            colors.push(...tint.toArray()); continue;
          }
        }
        if (color) colors.push(color.getX(i), color.getY(i), color.getZ(i));
        else if (image?.data) colors.push(1, 1, 1);
      }
      const count = geo.index?.count ?? position.count;
      const start = geo.drawRange.start, end = Math.min(count, start + geo.drawRange.count);
      for (let i = start; i < end; i++) indices.push(geo.index ? geo.index.getX(i) : i);
      if (![...vertices, ...colors].every(Number.isFinite) || indices.length % 3) {
        omitted.push({ name: node.name, parent: node.parent?.name, reason: 'non-finite geometry or incomplete triangles' });
        continue;
      }
      if (!indices.every(i => Number.isInteger(i) && i >= 0 && i < position.count)) {
        omitted.push({ name: node.name, reason: 'invalid triangle indices' }); continue;
      }
      seen.set(geo.uuid, geometries.length);
      const groups = geo.groups.map(g => ({ materialIndex: g.materialIndex,
        start: Math.max(start, g.start) - start, count: Math.max(0, Math.min(end, g.start + g.count) - Math.max(start, g.start)) }));
      geometries.push({ vertices: await encodeChannel(vertices, Float32Array), colors: await encodeChannel(colors, Float32Array),
        indices: await encodeChannel(indices, Uint32Array), vertexCount: position.count, indexCount: indices.length, groups });
    }
    const materials = (Array.isArray(node.material) ? node.material : [node.material]).map(mat => ({
      color: mat.color?.toArray() || [1, 1, 1], vertexColors: !!mat.vertexColors || node === record.terrain.mesh && !!record.surface?.appearance?.value,
      opacity: mat.transparent ? mat.opacity : 1, roughness: mat.roughness ?? .85,
      metalness: mat.metalness ?? 0,
    }));
    const instances = [];
    for (let i = 0; i < (node.isInstancedMesh ? node.count : 1); i++) {
      if (node.isInstancedMesh) { node.getMatrixAt(i, local); world.multiplyMatrices(node.matrixWorld, local); }
      else world.copy(node.matrixWorld);
      tint.setRGB(1, 1, 1);
      if (node.isInstancedMesh && node.instanceColor) node.getColorAt(i, tint);
      if (![...world.elements, ...tint.toArray()].every(Number.isFinite)) {
        omitted.push({ name: node.name, instance: i, reason: 'non-finite transform or tint' }); continue;
      }
      instances.push({ matrix: world.toArray(), color: tint.toArray() });
    }
    meshes.push({ name: node.name || 'mesh', geometry: seen.get(geo.uuid), materials, instances });
  }
  return { schema: 'steel-geographic-scene-v1', encoding: 'typed-le-deflate-base64', axis: 'Y-up',
    metadata: record.metadata, geometries, meshes, omitted };
}

export function geographicVenues() { return VENUES.filter(v => !v.synthetic); }
