import * as THREE from 'three';
import { mergeGeos } from './beacons.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { envMat } from './toon.js';
import { paintTrack, paintBasketball, paintVenue } from './groundMarkings.js';
import { generateGroundPart } from './proceduralGroundParts.js';
import { drapeHabitatPanel } from './habitat.js';
import { sportLocalToWorld } from './osmSports.js';

const surfaces = { asphalt: 0x5c666c, concrete: 0xa6a89c, clay: 0xb58263, sand: 0xc3aa7b,
  grass: 0x63845b, artificial_turf: 0x547d5c, tartan: 0xb46950 };

/** Markings reuse the authored court vocabulary; only fitted equipment creates solid boxes. */
export function createOsmSportRenderer(group, terrain) {
  const batches = new Map(), equipment = [], blockers = [], footprints = [];
  const add = p => {
    const { hw, hd, id, scale } = p.sport;
    const corners = [[-hw,-hd],[-hw,hd],[hw,hd],[hw,-hd]].map(([u, v]) => {
      const [x, z] = sportLocalToWorld(p.x, p.z, p.ry, u, v);
      return [x, terrain.heightAt(x, z), z];
    });
    const vertices = drapeHabitatPanel({ corners }, terrain);
    if (!vertices.length) return false;
    const rawSurface = p.area.tags?.surface, surface = Object.hasOwn(surfaces, rawSurface) ? rawSurface : '';
    const key = `${id}/${surface}/${p.sport.lanes || ''}`;
    if (!batches.has(key)) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
      const g = canvas.getContext('2d');
      const color = Object.hasOwn(surfaces, surface) ? surfaces[surface] : p.sport.color;
      g.fillStyle = '#' + color.toString(16).padStart(6, '0'); g.fillRect(0, 0, 512, 512);
      g.scale(512, 512);
      if (id === 'track') paintTrack(g, p.sport.lanes, '#' + color.toString(16).padStart(6, '0'));
      else if (id === 'court') paintBasketball(g);
      else paintVenue(g, id);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
      batches.set(key, { geos: [], material: envMat(0xffffff, { map: texture, vertexColors: true, land: true, rim: 0 }) });
    }
    const geometry = new THREE.BufferGeometry(), uv = [], colors = [];
    const observation = terrain.evidenceAt?.(p.x, p.z);
    const light = observation?.confidence && (observation.sources & 2)
      ? Math.max(.9, Math.min(1.08, 1 + (observation.brightness - 125) / 1200)) : 1;
    const c = Math.cos(p.ry), s = Math.sin(p.ry);
    for (let i = 0; i < vertices.length; i += 3) {
      const dx = vertices[i] - p.x, dz = vertices[i + 2] - p.z;
      uv.push(.5 + (dx * c - dz * s) / (2 * hw), .5 - (dx * s + dz * c) / (2 * hd));
      colors.push(light, light, light);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals(); batches.get(key).geos.push(geometry);
    footprints.push({ x: p.x, z: p.z, r: Math.hypot(hw, hd), hw, hd, ry: -p.ry });
    for (const [kind, u, v, angle] of p.sport.equipment) {
      const [x, z] = sportLocalToWorld(p.x, p.z, p.ry, u * hw * 2, v * hd * 2);
      const y = terrain.heightAt(x, z), ry = p.ry + angle;
      const rows = generateGroundPart(kind, 0);
      const localBounds = new THREE.Box3();
      for (const row of rows) {
        row.geo.scale(scale, scale, scale); row.geo.computeBoundingBox(); localBounds.union(row.geo.boundingBox);
        const color = new THREE.Color(row.c), values = new Float32Array(row.geo.attributes.position.count * 3);
        for (let i = 0; i < values.length; i += 3) values.set([color.r, color.g, color.b], i);
        row.geo.setAttribute('color', new THREE.BufferAttribute(values, 3));
        if (!row.geo.index) row.geo.setIndex(Array.from({ length: row.geo.attributes.position.count }, (_, i) => i));
        row.geo.rotateY(ry); row.geo.translate(x, y, z); equipment.push(row.geo);
      }
      const extent = localBounds.getSize(new THREE.Vector3()), center = localBounds.getCenter(new THREE.Vector3());
      const [cx, cz] = sportLocalToWorld(x, z, ry, center.x, center.z);
      blockers.push({ x: cx, z: cz, y: y + localBounds.min.y, h: extent.y,
        hw2: extent.x / 2, hd2: extent.z / 2, r: Math.hypot(extent.x, extent.z) / 2,
        ry, cl: 'prop', osmArea: 1, sourceId: p.sourceId });
    }
    return true;
  };
  const flush = () => {
    const emit = (geos, material, name, textured = false) => {
      if (!geos.length) return;
      const geometry = geos.length === 1 ? geos[0] : textured
        ? mergeGeometries(geos) : mergeGeos(geos, geos.map(() => null));
      if (textured && geos.length > 1) for (const geo of geos) geo.dispose();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name; mesh.userData.osmAreaBatch = 'sports'; group.add(mesh);
    };
    for (const [key, batch] of batches) emit(batch.geos, batch.material, `osm-sports/${key}`, true);
    if (equipment.length) emit(equipment, envMat(0xffffff, { vertexColors: true }), 'osm-sports/equipment');
    return { blockers, footprints };
  };
  return { add, flush };
}
