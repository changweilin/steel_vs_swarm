// Linear vertex colors only: weather cannot change mesh topology or collision bounds.
const linear = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const snowColor = [0xe9, 0xf0, 0xf4].map(v => linear(v / 255));

export function seasonalSurfaceColors(mesh, environment, origin = [0, 0, 0], ry = 0, upward = null) {
  const { vertices, faces, colors } = mesh;
  const { snow, wetness } = environment;
  if (!(snow > 0 || wetness > 0)) return colors;
  const normals = new Float64Array(vertices.length);
  for (let i = 0; i < faces.length; i += 3) {
    const a = faces[i] * 3, b = faces[i + 1] * 3, c = faces[i + 2] * 3;
    const ux = vertices[b] - vertices[a], uy = vertices[b + 1] - vertices[a + 1], uz = vertices[b + 2] - vertices[a + 2];
    const vx = vertices[c] - vertices[a], vy = vertices[c + 1] - vertices[a + 1], vz = vertices[c + 2] - vertices[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const j of [a, b, c]) { normals[j] += nx; normals[j + 1] += ny; normals[j + 2] += nz; }
  }
  const result = colors.slice(), ca = Math.cos(ry), sa = Math.sin(ry);
  for (let i = 0; i < vertices.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    const up = upward?.[i / 3] ?? (length > 0 ? normals[i + 1] / length : 0);
    const x = origin[0] + ca * vertices[i] + sa * vertices[i + 2];
    const z = origin[2] - sa * vertices[i] + ca * vertices[i + 2];
    const patch = .8 + .2 * Math.sin(x * .23 + Math.sin(z * .19));
    const cover = snow * Math.max(0, Math.min(1, (up - .45) / .5)) * patch;
    for (let k = 0; k < 3; k++) {
      const base = colors[i + k] * (1 - .22 * wetness);
      result[i + k] = base + (snowColor[k] - base) * cover;
    }
  }
  return result;
}
