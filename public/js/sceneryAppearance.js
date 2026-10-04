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

// Original vertices retain seeded outlines and extrema before flotation is solved.
export function fracturedIceData(data) {
  const source = SCENERY_MESHES.iceFracture;
  const patch = [];
  for (let i = 0; i < source.faces.length; i += 3) {
    const face = source.faces.slice(i, i + 3);
    if (face.every(v => source.vertices[v * 3 + 1] > -.499999)) patch.push(face);
  }
  const vertices = data.vertices.slice(), colors = data.colors.slice(), faces = [];
  const low = [0, 1, 2].map(axis => Math.min(...vertices.filter((_, i) => i % 3 === axis)));
  const high = [0, 1, 2].map(axis => Math.max(...vertices.filter((_, i) => i % 3 === axis)));
  for (let i = 0; i < data.faces.length; i += 3) {
    const ids = data.faces.slice(i, i + 3), points = ids.map(id => data.vertices.slice(id * 3, id * 3 + 3));
    const a = points[1].map((v, k) => v - points[0][k]), b = points[2].map((v, k) => v - points[0][k]);
    const normal = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
    const area = Math.hypot(...normal), edge = Math.max(Math.hypot(...a), Math.hypot(...b),
      Math.hypot(...points[2].map((v, k) => v - points[1][k])));
    if (!(area > 0 && edge > 0)) throw new RangeError('Degenerate ice face');
    const mapped = new Map();
    for (const id of new Set(patch.flat())) {
      const [x, y, z] = source.vertices.slice(id * 3, id * 3 + 3);
      const weights = [-x-z, z+.5, x+.5], corner = weights.findIndex(w => w > .999999);
      if (corner >= 0) { mapped.set(id, ids[corner]); continue; }
      const inset = (.5-y) * source.size[1] * area / edge;
      mapped.set(id, vertices.length / 3);
      for (let axis = 0; axis < 3; axis++) {
        const value = weights.reduce((sum, w, k) => sum + w * points[k][axis], 0) - normal[axis] / area * inset;
        vertices.push(Math.max(low[axis], Math.min(high[axis], value)));
        colors.push(weights.reduce((sum, w, k) => sum + w * data.colors[ids[k] * 3 + axis], 0));
      }
    }
    for (const face of patch) faces.push(...face.map(id => mapped.get(id)));
  }
  return { vertices, faces, colors, baseVertexCount: data.vertices.length / 3 };
}

// The seeded profile owns the silhouette and bore; the authored strip only recesses its skin.
export function industrialShellData(profile, thickness, sides = 16, detailed = true) {
  const source = SCENERY_MESHES.industrialCourse, height = profile.at(-1)[0];
  const radiusAt = level => {
    const index = profile.findIndex(p => p[0] >= level), b = profile[Math.max(1, index)], a = profile[Math.max(1, index)-1];
    return a[1] + (b[1]-a[1]) * (level-a[0]) / (b[0]-a[0]);
  };
  const stations = new Map(profile.map(([level, radius]) => [level, [radius, radius]]));
  if (detailed) {
    const course = new Map();
    for (let i = 0; i < source.vertices.length; i += 3) {
      const [x,y,z] = source.vertices.slice(i, i+3);
      course.set(y, Math.max(course.get(y) || 0, Math.hypot(x,z)));
    }
    const count = Math.min(source.maxCourses, Math.max(1, Math.ceil(height / source.size[1])));
    for (let row = 0; row < count; row++) for (const [y, radius] of course) {
      const level = (row+y+.5) * height / count;
      if (level <= 0 || level >= height || stations.has(level)) continue;
      const outer = radiusAt(level), inset = Math.min(thickness/3, outer * Math.max(0, 1-radius*2));
      stations.set(level, [outer-inset, outer]);
    }
  }
  const rows = [...stations].sort((a,b) => a[0]-b[0]);
  const outline = [...rows.map(([y,[outer]]) => [y,outer]),
    ...rows.slice().reverse().map(([y,[,original]]) => [y,original-thickness])];
  const vertices = [], faces = [];
  for (const [y,r] of outline) for (let i = 0; i < sides; i++) {
    const angle = i * Math.PI * 2 / sides;
    vertices.push(r*Math.cos(angle), y-height/2, r*Math.sin(angle));
  }
  for (let row = 0; row < outline.length; row++) for (let i = 0; i < sides; i++) {
    const next = (row+1)%outline.length, j = (i+1)%sides;
    const a = row*sides+i, b = next*sides+i, c = next*sides+j, d = row*sides+j;
    faces.push(a,b,c,a,c,d);
  }
  return { vertices, faces };
}

const channelRoles = new Set(['eave-frame','ridge-frame','frame-post','roof-rafter','crown-block']);
export function applyEnvironmentAppearance(parts) {
  return parts.map(part => {
    const [type,a,b,c] = part.g;
    let name, size;
    if (type === 'box' && part.role === 'rotor-blade') { name = 'turbineBlade'; size = [a,b,c]; }
    else if (type === 'box' && channelRoles.has(part.role)) { name = 'steelChannel'; size = [a,b,c]; }
    else if (type === 'cyl' && ['storage-tank','feed-silo'].includes(part.role) && a === b) {
      name = 'industrialCourse'; size = [a*2,c,a*2];
    } else return part;
    return { ...part, g: ['mesh', sceneryMeshData(name, size), size] };
  });
}
