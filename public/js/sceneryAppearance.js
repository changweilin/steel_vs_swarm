import { SCENERY_MESHES } from './sceneryMeshData.js';
import { facetMeshData } from './vesselGeometry.js';

// CPU data only: each renderer still owns and disposes its BufferGeometry.
const surfaces = new Map();
export function sceneryMeshData(name, dimensions) {
  const source = SCENERY_MESHES[name];
  if (!source || !Array.isArray(dimensions) || dimensions.length !== 3
    || dimensions.some(n => !Number.isFinite(n) || n <= 0)) throw new RangeError('Invalid scenery surface');
  if (!surfaces.has(name)) surfaces.set(name, facetMeshData(source));
  const data = surfaces.get(name), normals = [];
  for (let i = 0; i < data.normals.length; i += 3) {
    const n = data.normals.slice(i, i + 3).map((v, axis) => v / dimensions[axis]);
    const length = Math.hypot(...n);
    normals.push(...n.map(v => v / length));
  }
  return { vertices: data.vertices.map((n, i) => n * dimensions[i % 3]), normals, faces: data.faces };
}

export function sceneryBoxData(dimensions) {
  const cut = Math.min(...dimensions) * .065;
  const source = SCENERY_MESHES.beveledBox;
  // A physical edge width avoids stretched chamfers on long planks and thin panels.
  return facetMeshData({ vertices: source.vertices.map((n, i) => Math.sign(n)
    * (dimensions[i % 3] / 2 - (.5 - Math.abs(n)) * cut / .1)), faces: source.faces });
}

export function applyFurnitureAppearance(kind, parts) {
  if (kind === 'planter') parts[0].g = ['mesh', sceneryMeshData('planterShell', [1.5, .6, 1.5]), [1.5, .6, 1.5]];
  if (kind === 'windturbine') for (const part of parts) {
    if (part.g[0] === 'box' && part.g[2] === 3.3) {
      const size = part.g.slice(1, 4);
      part.g = ['mesh', sceneryMeshData('turbineBlade', size), size];
    }
  }
  return parts;
}
