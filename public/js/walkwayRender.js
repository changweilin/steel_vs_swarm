// Authored members and terrain-clipped paving remain presentation-only; each battle owns its GPU buffers.
import * as THREE from 'three';
import { envMat } from './toon.js';
import { mulberry32 } from './rng.js';
import { drapeHabitatPanel } from './habitat.js';
import { WALKWAY_SURFACES, WALKWAY_DETAIL } from './walkwayCatalog.js';
import { WALKWAY_MESHES } from './walkwayMeshData.js';
import { HABITAT_SCENE } from './habitatCatalog.js';

/** post: caller owns the returned geometry; dimensions and placement never come from mesh readback. */
export function walkwayGeometry(kind) {
  const data = WALKWAY_MESHES[kind];
  if (!data) throw new RangeError('Unknown walkway model: ' + kind);
  const geo = new THREE.BufferGeometry(), colors = [], color = new THREE.Color();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(data.vertices, 3));
  for (const hex of data.colors) {
    color.setHex(hex); colors.push(color.r, color.g, color.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/** post: caller owns a deterministic texture; texture noise consumes no shared scene stream. */
export function walkwayTexture(key) {
  const spec = WALKWAY_SURFACES[key];
  if (!spec) throw new RangeError('Unknown walkway surface: ' + key);
  const canvas = document.createElement('canvas'), size = 256;
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d'), rnd = mulberry32(0x57414c4b ^ [...key].reduce((n, c) => Math.imul(n, 31) + c.charCodeAt(0) | 0, 0));
  g.fillStyle = '#ddd9cf'; g.fillRect(0, 0, size, size);
  const { pattern } = spec;
  const rect = (x, y, w, h) => {
    const tone = 186 + Math.floor(rnd() * 55);
    g.fillStyle = `rgb(${tone},${tone},${tone})`; g.fillRect(x + 1, y + 1, w - 2, h - 2);
  };
  if (['pavers', 'bricks', 'setts', 'tiles', 'slabs', 'grass-grid'].includes(pattern)) {
    const rows = pattern === 'slabs' ? 2 : pattern === 'tiles' ? 4 : 8;
    const height = size / rows, width = pattern === 'bricks' ? height * 2 : pattern === 'pavers' ? height * 2 : height;
    g.fillStyle = pattern === 'grass-grid' ? '#597349' : '#77746d'; g.fillRect(0, 0, size, size);
    for (let row = 0; row < rows; row++) for (let x = -width; x < size; x += width) {
      const offset = ['bricks', 'pavers', 'setts'].includes(pattern) ? row % 2 * width / 2 : 0;
      rect(x + offset, row * height, width, height);
      if (pattern === 'grass-grid') {
        g.fillStyle = '#698552'; g.fillRect(x + 7, row * height + 7, width - 14, height - 14);
      }
    }
  } else if (pattern === 'planks') {
    g.fillStyle = '#635a4b'; g.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 32) {
      rect(0, y, size, 32);
      g.strokeStyle = 'rgba(93,80,58,.28)'; g.lineWidth = .8;
      for (let i = 0; i < 5; i++) {
        g.beginPath(); g.moveTo(0, y + 5 + i * 4); g.bezierCurveTo(80, y + 3 + i * 4, 175, y + 9 + i * 4, 256, y + 5 + i * 4); g.stroke();
      }
      for (const x of [8, 248]) { g.fillStyle = '#66635d'; g.fillRect(x, y + 8, 2, 2); }
    }
  } else if (pattern === 'grating') {
    g.fillStyle = '#737c7d'; g.fillRect(0, 0, size, size);
    g.fillStyle = '#d8ddda';
    for (let y = 0; y < size; y += 16) g.fillRect(0, y, size, 4);
    for (let x = 0; x < size; x += 32) g.fillRect(x, 0, 3, size);
  } else if (pattern === 'flagstones' || pattern === 'cobbles') {
    g.fillStyle = '#77766d'; g.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 32) for (let x = -32; x < size; x += 32) {
      const offset = y % 64 ? 16 : 0, tone = 184 + Math.floor(rnd() * 50);
      g.fillStyle = `rgb(${tone},${tone},${tone})`;
      g.beginPath();
      if (pattern === 'cobbles') g.ellipse(x + offset + 16, y + 16, 14, 12, rnd() * .3, 0, Math.PI * 2);
      else { g.moveTo(x + offset + 2, y + 3); g.lineTo(x + offset + 28, y + 1); g.lineTo(x + offset + 30, y + 28); g.lineTo(x + offset + 1, y + 30); }
      g.closePath(); g.fill();
    }
  } else {
    for (let i = 0; i < 900; i++) {
      const tone = 170 + Math.floor(rnd() * 75), x = rnd() * size, y = rnd() * size;
      g.fillStyle = `rgba(${tone},${tone},${tone},.65)`;
      if (pattern === 'gravel') { g.beginPath(); g.ellipse(x, y, 1 + rnd() * 4, 1 + rnd() * 2, rnd() * 3, 0, 7); g.fill(); }
      else g.fillRect(x, y, 1 + rnd() * 2, 1 + rnd() * 2);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** post: material disposal releases its private paving texture; disposeTree does not own arbitrary material maps. */
export function walkwayMaterial(color, key, options = {}) {
  const texture = walkwayTexture(key), material = envMat(color, { ...options, map: texture });
  material.addEventListener('dispose', () => texture.dispose());
  return material;
}

/** pre: panels already fit complete footprints. post: terrain draping and low kerbs add no standing or collision indexes. */
export function buildWalkwaySurfaces(group, panels, terrain, { low = false, pathEdges = [], canDetailAt } = {}) {
  const buckets = new Map(), detail = new Map(), color = new THREE.Color();
  const append = (kind, x, z, ry, sx, sy, sz) => {
    const data = WALKWAY_MESHES[kind], vertices = [], colors = [], c = Math.cos(ry), s = Math.sin(ry);
    for (let i = 0; i < data.vertices.length; i += 3) {
      const lx = data.vertices[i] * sx, lz = data.vertices[i + 2] * sz;
      const px = x + lx * c + lz * s, pz = z - lx * s + lz * c;
      const height = terrain.heightAt(px, pz);
      if (!Number.isFinite(height) || canDetailAt && !canDetailAt(px, pz)) return;
      vertices.push(px, height + HABITAT_SCENE.STREET_LIFT_M + data.vertices[i + 1] * sy, pz);
      color.setHex(data.colors[i / 3]); colors.push(color.r, color.g, color.b);
    }
    if (!detail.has(kind)) detail.set(kind, { vertices: [], colors: [] });
    detail.get(kind).vertices.push(...vertices); detail.get(kind).colors.push(...colors);
  };
  let kerbs = 0, details = 0;
  const kerbLimit = low ? WALKWAY_DETAIL.LOW_KERB_LIMIT : WALKWAY_DETAIL.KERB_LIMIT;
  const detailLimit = low ? WALKWAY_DETAIL.LOW_DETAIL_LIMIT : WALKWAY_DETAIL.DETAIL_LIMIT;
  for (const panel of panels) {
    const key = panel.surface?.key || 'concrete', spec = WALKWAY_SURFACES[key];
    if (!buckets.has(key)) buckets.set(key, { vertices: [], colors: [], uv: [] });
    const bucket = buckets.get(key), vertices = drapeHabitatPanel(panel, terrain), c = Math.cos(panel.ry), s = Math.sin(panel.ry);
    bucket.vertices.push(...vertices);
    color.setHex(spec.color).multiplyScalar(.95 + (panel.seed % 81) / 1000);
    for (let i = 0; i < vertices.length; i += 3) {
      bucket.colors.push(color.r, color.g, color.b);
      bucket.uv.push((vertices[i] * c + vertices[i + 2] * s) / spec.repeat,
        (-vertices[i] * s + vertices[i + 2] * c) / spec.repeat);
    }
    const across = -(panel.side || 1) * (panel.width - WALKWAY_DETAIL.KERB_W_M) / 2;
    const x = panel.x - s * across, z = panel.z + c * across;
    const kerb = panel.tags?.[`sidewalk:${panel.side === -1 ? 'left' : 'right'}:kerb`]
      ?? panel.tags?.['sidewalk:both:kerb'] ?? panel.tags?.['sidewalk:kerb'] ?? panel.tags?.kerb;
    if (spec.hard && kerb !== 'no' && kerb !== 'flush' && kerb !== 'lowered' && kerbs < kerbLimit) {
      append('kerb', x, z, Math.PI / 2 - panel.ry, WALKWAY_DETAIL.KERB_W_M, WALKWAY_DETAIL.KERB_H_M, panel.hw * 2);
      kerbs++;
    }
    const tactile = panel.tags?.[`sidewalk:${panel.side === -1 ? 'left' : 'right'}:tactile_paving`]
      ?? panel.tags?.['sidewalk:both:tactile_paving'] ?? panel.tags?.['sidewalk:tactile_paving'] ?? panel.tags?.tactile_paving;
    if (tactile === 'yes' && details < detailLimit) {
      const off = across * .7;
      append('tactile', panel.x - s * off, panel.z + c * off, -panel.ry, panel.hw * 2, 1, .65);
      details++;
    }
    if (spec.hard && panel.habitat === 'built' && panel.seed % 11 === 0 && details < detailLimit) {
      append('drain', x, z, -panel.ry, .7, .45, .6); details++;
    }
    if (panel.tags?.handrail === 'yes' && details < detailLimit) {
      append('handrail', panel.x + s * across, panel.z - c * across, -panel.ry, panel.hw * 2, 1, 1); details++;
    }
  }
  for (const anchor of pathEdges) {
    const { tags, ry } = anchor, c = Math.cos(ry), s = Math.sin(ry);
    for (const [side, name] of [[-1, 'left'], [1, 'right']]) {
      if ((tags['handrail:' + name] ?? tags.handrail) !== 'yes' || details >= detailLimit) continue;
      const off = side * Math.max(.2, anchor.width / 2 - .4);
      const count = Math.ceil(anchor.length / HABITAT_SCENE.STREET_STEP_M), length = anchor.length / count;
      for (let i = 0; i < count && details < detailLimit; i++) {
        const along = (i + .5) * length - anchor.length / 2;
        append('handrail', anchor.x + c * along - s * off, anchor.z + s * along + c * off, -ry, length, 1, 1);
        details++;
      }
    }
  }
  for (const [key, b] of buckets) {
    if (!b.vertices.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.vertices, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(b.colors, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2)); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, walkwayMaterial(0xffffff, key, { vertexColors: true, wash: .06, land: true,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    mesh.name = 'habitat/street-verges/' + key; mesh.receiveShadow = true; group.add(mesh);
  }
  for (const [kind, b] of detail) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.vertices, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(b.colors, 3)); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, envMat(0xffffff, { vertexColors: true }));
    mesh.name = 'walkway/' + kind; mesh.receiveShadow = true; group.add(mesh);
  }
  return { materials: buckets.size, kerbs, details };
}
