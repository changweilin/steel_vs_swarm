import { mat3Apply, mat3FromEulerXYZ } from './partTransform.js';

// Reference homogeneous ice and surface seawater densities, in kg/m³.
export const ICE_DENSITY = 917;
export const SEAWATER_DENSITY = 1025;

// The omitted horizontal cap passes through the tetrahedron origin, so its
// volume and first moments are zero. Cut edges still supply waterplane moments.
export function iceHydrostatics({ vertices, faces }, waterline = Infinity) {
  const points = [];
  for (let i = 0; i < vertices.length; i += 3) points.push(vertices.slice(i, i + 3));
  const originY = Number.isFinite(waterline) ? waterline : 0;
  let v6 = 0, mx = 0, my = 0, mz = 0;
  let area2 = 0, sx = 0, sz = 0, xx = 0, xz = 0, zz = 0;
  for (let i = 0; i < faces.length; i += 3) {
    const triangle = faces.slice(i, i + 3).map(id => points[id]);
    let polygon = triangle;
    if (triangle.some(p => p[1] > waterline)) {
      polygon = [];
      for (let j = 0; j < 3; j++) {
        const a = triangle[j], b = triangle[(j + 1) % 3];
        const insideA = a[1] <= waterline, insideB = b[1] <= waterline;
        if (insideA) polygon.push(a);
        if (insideA !== insideB) {
          const t = (waterline - a[1]) / (b[1] - a[1]);
          polygon.push([a[0] + t * (b[0] - a[0]), waterline, a[2] + t * (b[2] - a[2])]);
        }
      }
    }
    if (polygon.length < 3) continue;
    for (let j = 1; j < polygon.length - 1; j++) {
      const a = polygon[0], b = polygon[j], c = polygon[j + 1];
      const ay = a[1] - originY, by = b[1] - originY, cy = c[1] - originY;
      const det = a[0] * (by * c[2] - b[2] * cy)
        + ay * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * cy - by * c[0]);
      v6 += det;
      mx += det * (a[0] + b[0] + c[0]);
      my += det * (ay + by + cy);
      mz += det * (a[2] + b[2] + c[2]);
    }
    if (polygon.every(p => p[1] === waterline)) continue;
    for (let j = 0; j < polygon.length; j++) {
      const a = polygon[j], b = polygon[(j + 1) % polygon.length];
      if (a[1] !== waterline || b[1] !== waterline) continue;
      const cross = a[0] * b[2] - b[0] * a[2];
      area2 += cross;
      sx += (a[0] + b[0]) * cross;
      sz += (a[2] + b[2]) * cross;
      xx += (a[0] ** 2 + a[0] * b[0] + b[0] ** 2) * cross;
      zz += (a[2] ** 2 + a[2] * b[2] + b[2] ** 2) * cross;
      xz += (2 * a[0] * a[2] + a[0] * b[2] + b[0] * a[2] + 2 * b[0] * b[2]) * cross;
    }
  }
  const volume = v6 / 6, area = area2 / 2;
  const cx = area > 0 ? sx / (6 * area) : 0, cz = area > 0 ? sz / (6 * area) : 0;
  return { volume, center: volume > 0 ? [mx / (4 * v6), originY + my / (4 * v6), mz / (4 * v6)] : [0, originY, 0],
    waterplane: { area, center: [cx, cz], secondMoments: [
      xx / 12 - area * cx * cx, xz / 24 - area * cx * cz, zz / 12 - area * cz * cz,
    ] } };
}

export function iceWaterline(data, densityRatio = ICE_DENSITY / SEAWATER_DENSITY) {
  if (!Number.isFinite(densityRatio) || densityRatio <= 0 || densityRatio >= 1) {
    throw new RangeError('Ice flotation requires a density ratio between zero and one');
  }
  const full = iceHydrostatics(data);
  if (!Number.isFinite(full.volume) || full.volume <= 0) throw new RangeError('Ice requires an outward closed volume');
  let low = Infinity, high = -Infinity;
  for (let i = 1; i < data.vertices.length; i += 3) {
    low = Math.min(low, data.vertices[i]); high = Math.max(high, data.vertices[i]);
  }
  const target = full.volume * densityRatio;
  let waterline = low + (high - low) * densityRatio, submerged;
  for (let i = 0; i < 32; i++) {
    submerged = iceHydrostatics(data, waterline);
    const error = submerged.volume - target;
    if (Math.abs(error) <= full.volume * 1e-10) return { waterline, full, submerged };
    if (error > 0) high = waterline; else low = waterline;
    const next = waterline - error / submerged.waterplane.area;
    waterline = Number.isFinite(next) && next > low && next < high ? next : (low + high) / 2;
  }
  throw new RangeError('Ice displacement did not converge');
}

function flotationState(data, densityRatio) {
  const state = iceWaterline(data, densityRatio), g = state.full.center, b = state.submerged.center;
  const [xx, xz, zz] = state.submerged.waterplane.secondMoments, v = state.submerged.volume;
  const a = zz / v + b[1] - g[1], c = xx / v + b[1] - g[1], cross = -xz / v;
  return { ...state, stiffness: [a, cross, c],
    metacentricHeight: (a + c - Math.hypot(a - c, 2 * cross)) / 2,
    gradient: [b[2] - g[2], g[0] - b[0]], energy: g[1] - b[1] };
}

function rotateMesh(data, x, z) {
  const matrix = mat3FromEulerXYZ([x, 0, z]), vertices = [];
  for (let i = 0; i < data.vertices.length; i += 3) vertices.push(...mat3Apply(matrix, data.vertices.slice(i, i + 3)));
  return { ...data, vertices };
}

// Static equilibrium only: minimize combined ice/water potential, then require
// restoring stiffness in both horizontal axes. A height percentage cannot do this.
export function floatIceMesh(data, densityRatio = ICE_DENSITY / SEAWATER_DENSITY) {
  const full = iceHydrostatics(data), scale = Math.cbrt(full.volume);
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('Ice requires an outward closed volume');
  const centered = { ...data, vertices: data.vertices.map((v, i) => v - full.center[i % 3]) };
  for (const [x, z] of [[0, 0], [Math.PI / 2, 0], [0, Math.PI / 2], [Math.PI, 0]]) {
    let mesh = rotateMesh(centered, x, z), state = flotationState(mesh, densityRatio);
    for (let iteration = 0; iteration < 48; iteration++) {
      const [gx, gz] = state.gradient, [a, cross, c] = state.stiffness;
      if (Math.hypot(gx, gz) < scale * 1e-7 && state.metacentricHeight > scale * 1e-7) {
        return { ...mesh, waterline: state.waterline, metacentricHeight: state.metacentricHeight };
      }
      const det = a * c - cross * cross;
      let rx, rz;
      if (state.metacentricHeight > scale * 1e-5) {
        rx = (-c * gx + cross * gz) / det; rz = (cross * gx - a * gz) / det;
      } else {
        const damping = Math.max(scale * .05, Math.abs(a), Math.abs(c));
        rx = -gx / damping; rz = -gz / damping;
        if (Math.hypot(rx, rz) < .02) {
          // Zero torque can also be an unstable equilibrium. Perturb its weakest
          // eigenvector; testing only world axes can miss an oblique roll mode.
          let vx = cross, vz = state.metacentricHeight - a;
          const length = Math.hypot(vx, vz);
          if (length < scale * 1e-12) { vx = a <= c ? 1 : 0; vz = a <= c ? 0 : 1; }
          else { vx /= length; vz /= length; }
          const sign = vx * gx + vz * gz > 0 ? -1 : 1;
          rx = vx * .2 * sign; rz = vz * .2 * sign;
        }
      }
      const limit = Math.max(1, Math.hypot(rx, rz) / .3);
      rx /= limit; rz /= limit;
      let improved = false;
      for (let step = 0; step < 10; step++) {
        const candidate = rotateMesh(mesh, rx, rz), next = flotationState(candidate, densityRatio);
        if (next.energy < state.energy) { mesh = candidate; state = next; improved = true; break; }
        rx /= 2; rz /= 2;
      }
      if (!improved) break;
    }
  }
  throw new RangeError('Ice has no converged stable flotation pose');
}
