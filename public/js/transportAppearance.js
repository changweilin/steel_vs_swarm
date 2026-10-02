import { TRANSPORT_MESHES, TRANSPORT_TIRE_MESH, VEHICLE_MESH_RECIPES, VEHICLE_BADGE_OFFSETS } from './transportMeshData.js';
import { facetMeshData } from './vesselGeometry.js';

/** Blender owns the surfaces; the generator retains colors, equipment and authority envelopes. */
export function applyVehicleAppearance(v, rows) {
  const recipe = VEHICLE_MESH_RECIPES[v.key];
  const basis = [v.length, v.height, v.width];
  const replacements = new Map((recipe || []).map(item => [`${item.role}:${item.slot}`, item]));
  const counts = new Map();
  for (const row of rows) {
    const slot = counts.get(row.role) || 0;
    counts.set(row.role, slot + 1);
    if (row.role.startsWith('brand_') && VEHICLE_BADGE_OFFSETS[v.key]) {
      row.p = row.p.map((n,i) => n+VEHICLE_BADGE_OFFSETS[v.key][i]*basis[i]);
    }
    if (row.role === 'tire' && row.g[0] === 'cyl' && !['rail', 'tracked'].includes(v.type)) {
      const radius = row.g[1], depth = row.g[3];
      const tireBasis = [radius, depth, radius];
      row.g = ['mesh', facetMeshData({ vertices: TRANSPORT_TIRE_MESH.vertices.map((n,i) => n*tireBasis[i%3]),
        faces: TRANSPORT_TIRE_MESH.faces }), [radius*2,depth,radius*2]];
      continue;
    }
    const item = replacements.get(`${row.role}:${slot}`);
    if (!item || row.g[0] !== 'box') continue;
    const source = TRANSPORT_MESHES[item.mesh];
    const meshData = facetMeshData({ vertices: source.vertices.map((n, i) => n * basis[i % 3]), faces: source.faces });
    row.g = ['mesh', meshData, item.size.map((n, i) => n * basis[i])];
    row.p = row.p.map((n, i) => n + item.offset[i] * basis[i]);
    row.r = [0, 0, 0];
  }
}
