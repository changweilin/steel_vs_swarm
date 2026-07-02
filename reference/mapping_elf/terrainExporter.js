/**
 * Mapping Elf — 3D-Print Terrain Exporter (Plan §IV)
 *
 * Turns the 3D viewer's height field + land-cover families + draped route into a
 * printable solid and encodes it as:
 *   • STL  (binary) — a single watertight terrain solid with a raised route ridge
 *                     merged in (§IV-1 "printable ridge").
 *   • 3MF  (OPC zip) — the same geometry as coloured objects: the terrain carries
 *                     a per-triangle material keyed on land-cover family (§IV-3
 *                     water / vegetation / soil / urban / land) and the route
 *                     ridge is its own coloured object, so an AMS-style multicolour
 *                     printer assigns a filament per feature (§IV-2).
 *
 * Input `source` is produced by TerrainViewer.getExportSource():
 *   { N, X, Y, Z, family, route, baseZ, sizeMm }
 * with X/Y/Z in print millimetres (Z-up), `family` a per-grid Uint8 (see MATERIALS
 * order) and `route` an array of draped [x,y,z] points on the surface.
 */
import JSZip from 'jszip';

// Material palette. The index order IS the 3MF basematerials pindex and the
// per-grid `family` value: 0 land, 1 green, 2 soil, 3 urban, 4 water, 5 route.
const MATERIALS = [
  { name: 'Land', color: '#C2B280FF' },
  { name: 'Vegetation', color: '#4F8F3FFF' },
  { name: 'Soil', color: '#C8A96AFF' },
  { name: 'Urban', color: '#9AA0A6FF' },
  { name: 'Water', color: '#2B86D9FF' },
  { name: 'Route', color: '#E8663AFF' },
];
const MAT_LAND = 0;
const MAT_ROUTE = 5;

// Round to 3 dp to keep the 3MF XML compact without losing print precision.
const fmt = (n) => {
  const v = Math.round((Number.isFinite(n) ? n : 0) * 1000) / 1000;
  return Object.is(v, -0) ? 0 : v;
};

const escXml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Build the watertight terrain solid: the height-field grid on top, a skirt of
// perimeter walls, and a floor at baseZ. Returns an indexed mesh where every top
// triangle carries its land-cover family (walls/floor default to land).
function assembleTerrain(src) {
  const { N, X, Y, Z, family, baseZ } = src;
  const verts = [];
  const tris = [];
  for (let idx = 0; idx < N * N; idx++) verts.push(X[idx], Y[idx], Z[idx]);

  const at = (i, j) => i * N + j;
  // Majority family of a triangle's three grid corners (tie → first corner).
  const famOf = (a, b, c) => {
    const fa = family[a], fb = family[b], fc = family[c];
    if (fb === fc && fb !== fa) return fb;
    if (fa === fc && fa !== fb) return fa;
    return fa;
  };

  // Top surface — checkerboard diagonal split, matching the on-screen mesh.
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < N - 1; j++) {
      const a = at(i, j), b = at(i, j + 1), c = at(i + 1, j), d = at(i + 1, j + 1);
      if ((i + j) & 1) {
        tris.push([a, b, d, famOf(a, b, d)]);
        tris.push([a, d, c, famOf(a, d, c)]);
      } else {
        tris.push([a, b, c, famOf(a, b, c)]);
        tris.push([b, d, c, famOf(b, d, c)]);
      }
    }
  }

  // Perimeter loop of top-grid vertices (single occurrence each, closed).
  const perim = [];
  for (let j = 0; j < N; j++) perim.push(at(0, j));          // south edge (i=0)
  for (let i = 1; i < N; i++) perim.push(at(i, N - 1));       // east edge
  for (let j = N - 2; j >= 0; j--) perim.push(at(N - 1, j));  // north edge
  for (let i = N - 2; i >= 1; i--) perim.push(at(i, 0));      // west edge

  // Matching bottom perimeter vertices dropped to the base plane.
  const bot = [];
  for (const p of perim) {
    const bi = verts.length / 3;
    verts.push(verts[p * 3], verts[p * 3 + 1], baseZ);
    bot.push(bi);
  }

  // Walls between the top ring and the base ring.
  const M = perim.length;
  for (let m = 0; m < M; m++) {
    const a = perim[m], b = perim[(m + 1) % M];
    const ba = bot[m], bb = bot[(m + 1) % M];
    tris.push([a, b, bb, MAT_LAND]);
    tris.push([a, bb, ba, MAT_LAND]);
  }

  // Flat floor as a fan across the (rectangular) base ring.
  for (let m = 1; m < M - 1; m++) {
    tris.push([bot[0], bot[m + 1], bot[m], MAT_LAND]);
  }

  return { verts, tris };
}

// Build a closed triangular-prism ridge that follows the draped route, sitting on
// the surface and rising `ridgeMm` above it (Plan §IV-1). Its own object/colour.
function assembleRidge(route, { ridgeMm = 2.2, ridgeHalfMm = 1.4 } = {}) {
  const verts = [];
  const tris = [];
  if (!Array.isArray(route) || route.length < 2) return { verts, tris };

  // Drop consecutive duplicate/near-duplicate points so the perpendicular is stable.
  const pts = [];
  for (const p of route) {
    const q = pts[pts.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4) pts.push(p);
  }
  if (pts.length < 2) return { verts, tris };

  const addV = (x, y, z) => { const i = verts.length / 3; verts.push(x, y, z); return i; };
  const L = [], R = [], A = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let dx = next[0] - prev[0], dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const px = -dy, py = dx;                 // horizontal perpendicular
    const [x, y, z] = pts[i];
    L.push(addV(x + px * ridgeHalfMm, y + py * ridgeHalfMm, z));
    R.push(addV(x - px * ridgeHalfMm, y - py * ridgeHalfMm, z));
    A.push(addV(x, y, z + ridgeMm));
  }
  for (let i = 0; i < pts.length - 1; i++) {
    tris.push([L[i], L[i + 1], A[i + 1], MAT_ROUTE], [L[i], A[i + 1], A[i], MAT_ROUTE]);       // left slope
    tris.push([A[i], A[i + 1], R[i + 1], MAT_ROUTE], [A[i], R[i + 1], R[i], MAT_ROUTE]);       // right slope
    tris.push([L[i], R[i], R[i + 1], MAT_ROUTE], [L[i], R[i + 1], L[i + 1], MAT_ROUTE]);       // underside
  }
  const n = pts.length - 1;
  tris.push([L[0], A[0], R[0], MAT_ROUTE]);   // start cap
  tris.push([L[n], R[n], A[n], MAT_ROUTE]);   // end cap
  return { verts, tris };
}

// Encode one or more indexed meshes as a binary STL triangle soup (materials are
// dropped — STL has no standard colour).
function encodeStlBinary(meshes) {
  let count = 0;
  for (const m of meshes) count += m.tris.length;
  const buf = new ArrayBuffer(84 + count * 50);
  const dv = new DataView(buf);
  const tag = 'Mapping Elf 3D terrain export';
  for (let i = 0; i < tag.length && i < 80; i++) dv.setUint8(i, tag.charCodeAt(i));
  dv.setUint32(80, count, true);

  let off = 84;
  const put = (x, y, z) => { dv.setFloat32(off, x, true); dv.setFloat32(off + 4, y, true); dv.setFloat32(off + 8, z, true); off += 12; };
  for (const { verts, tris } of meshes) {
    for (const t of tris) {
      const a = t[0] * 3, b = t[1] * 3, c = t[2] * 3;
      const ax = verts[a], ay = verts[a + 1], az = verts[a + 2];
      const bx = verts[b], by = verts[b + 1], bz = verts[b + 2];
      const cx = verts[c], cy = verts[c + 1], cz = verts[c + 2];
      let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const nl = Math.hypot(nx, ny, nz) || 1;
      put(nx / nl, ny / nl, nz / nl);
      put(ax, ay, az); put(bx, by, bz); put(cx, cy, cz);
      dv.setUint16(off, 0, true); off += 2;
    }
  }
  return new Blob([buf], { type: 'model/stl' });
}

// Assemble the 3D/3dmodel.model XML: a coloured terrain object (per-triangle
// family material) plus an optional route object.
function encode3mfModelXml(terrain, route) {
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">');
  out.push('<resources>');
  out.push('<basematerials id="1">');
  for (const m of MATERIALS) out.push(`<base name="${escXml(m.name)}" displaycolor="${m.color}"/>`);
  out.push('</basematerials>');

  out.push('<object id="2" type="model" pid="1" pindex="0"><mesh><vertices>');
  for (let i = 0; i < terrain.verts.length; i += 3) {
    out.push(`<vertex x="${fmt(terrain.verts[i])}" y="${fmt(terrain.verts[i + 1])}" z="${fmt(terrain.verts[i + 2])}"/>`);
  }
  out.push('</vertices><triangles>');
  for (const t of terrain.tris) out.push(`<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}" pid="1" p1="${t[3]}"/>`);
  out.push('</triangles></mesh></object>');

  const hasRoute = route && route.tris.length > 0;
  if (hasRoute) {
    out.push('<object id="3" type="model" pid="1" pindex="5"><mesh><vertices>');
    for (let i = 0; i < route.verts.length; i += 3) {
      out.push(`<vertex x="${fmt(route.verts[i])}" y="${fmt(route.verts[i + 1])}" z="${fmt(route.verts[i + 2])}"/>`);
    }
    out.push('</vertices><triangles>');
    for (const t of route.tris) out.push(`<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`);
    out.push('</triangles></mesh></object>');
  }

  out.push('</resources>');
  out.push('<build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>');
  if (hasRoute) out.push('<item objectid="3" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>');
  out.push('</build>');
  out.push('</model>');
  return out.join('\n');
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

export class TerrainExporter {
  static get MATERIALS() { return MATERIALS; }

  // Binary STL: terrain solid + route ridge merged into one triangle soup (§IV-1).
  static buildSTL(source, filenameBase = 'mapping-elf-terrain') {
    const terrain = assembleTerrain(source);
    const route = assembleRidge(source.route);
    const meshes = route.tris.length ? [terrain, route] : [terrain];
    return {
      blob: encodeStlBinary(meshes),
      filename: `${filenameBase}.stl`,
      mimeType: 'model/stl',
    };
  }

  // Multicolour 3MF (OPC zip) with per-feature colour groups (§IV-2 / §IV-3).
  static async build3MF(source, filenameBase = 'mapping-elf-terrain') {
    const terrain = assembleTerrain(source);
    const route = assembleRidge(source.route);
    const modelXml = encode3mfModelXml(terrain, route);

    const zip = new JSZip();
    zip.file('[Content_Types].xml', CONTENT_TYPES_XML);
    zip.folder('_rels').file('.rels', RELS_XML);
    zip.folder('3D').file('3dmodel.model', modelXml);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    return {
      blob: new Blob([blob], { type: 'model/3mf' }),
      filename: `${filenameBase}.3mf`,
      mimeType: 'model/3mf',
    };
  }

  // Convenience dispatcher.
  static async export(source, format = 'stl', filenameBase = 'mapping-elf-terrain') {
    if (!source || !source.N) throw new Error('沒有可匯出的地形資料');
    return format === '3mf'
      ? this.build3MF(source, filenameBase)
      : this.buildSTL(source, filenameBase);
  }

  static async download({ blob, filename, mimeType }) {
    const { platform } = await import('../platform/index.js');
    return platform.downloadFile({ filename, mimeType, content: blob });
  }
}

export { MATERIALS };
