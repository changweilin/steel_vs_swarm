import { computeOrientedRoofFrame } from './architectureStyles.js';
import { roofDimensions, sectionRoofProfile } from './roofProfiles.js';
import { loftMeshData } from './vesselGeometry.js';

// Closed sections use the same loft seam as other procedural solids.
function sectionMesh(section, length) {
  section = section.map(([x, y]) => [x, Math.abs(y) < 1e-12 ? 0 : y]);
  const ring = [[section[0][0], 0], [section.at(-1)[0], 0], ...[...section].reverse()]
    .filter((p, i, all) => !i || p.some((n, k) => n !== all[i - 1][k]));
  if (ring.at(-1).every((n, k) => n === ring[0][k])) ring.pop();
  const mesh = loftMeshData([{ z: -length / 2, ring }, { z: length / 2, ring }]);
  // Section horizontal axis becomes -Z; extrusion axis becomes X (proper rotation).
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    const x = mesh.vertices[i]; mesh.vertices[i] = mesh.vertices[i + 2]; mesh.vertices[i + 2] = -x;
  }
  return mesh;
}

export function architecturalRoofParts(poly, y, style, actualRoofForm = null, metrics = null, targetH = 10) {
  const form = actualRoofForm || style?.actualRoofForm || style?.roofForm;
  if (!form || form === 'flat' || poly.holes?.length) return [];
  const frame = computeOrientedRoofFrame(poly);
  if (!frame || frame.len < 1.2 || frame.span < 1.2) return [];
  const { len, span, cx, cz, angle } = frame;
  const { rise, eave } = roofDimensions(span, targetH), L = len + eave * 2, S = span + eave * 2;
  const rows = [], ca = Math.cos(angle), sa = Math.sin(angle);
  const add = (g, x = 0, lift = 0, z = 0) => {
    rows.push({ g, p: [cx + x * ca - z * sa, y + lift, cz + x * sa + z * ca],
      r: [0, -angle, 0], c: style.roof, role: 'architecture-roof', colorVariant: style.variant, roofForm: form });
  };
  const mesh = (data, x = 0, lift = 0, z = 0) => {
    const mins = [Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < data.vertices.length; i++) {
      const axis = i % 3; mins[axis] = Math.min(mins[axis], data.vertices[i]); maxs[axis] = Math.max(maxs[axis], data.vertices[i]);
    }
    const center = mins.map((v, i) => (v + maxs[i]) / 2);
    const vertices = data.vertices.map((v, i) => v - center[i % 3]);
    add(['mesh', { ...data, vertices }, maxs.map((v, i) => v - mins[i])], x + center[0], lift + center[1], z + center[2]);
  };
  const section = (profile, length = L, lift = 0, offset = 0) => mesh(sectionMesh(profile, length), 0, lift, offset);
  const hip = (width, depth, topWidth, topDepth, height, lift = 0) => {
    if (topWidth === 0 && topDepth === 0) {
      mesh({ vertices: [-width/2,0,depth/2, width/2,0,depth/2, width/2,0,-depth/2, -width/2,0,-depth/2, 0,height,0],
        faces: [0,2,1,0,3,2,0,1,4,1,2,4,2,3,4,3,0,4] }, 0, lift);
      return;
    }
    // Loft in Y, then rotate into place, keeping winding and cap orientation.
    const ring = (w, d) => [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]];
    const data = loftMeshData([{ z: 0, ring: ring(width, depth) }, { z: height, ring: ring(topWidth, topDepth) }]);
    for (let i = 0; i < data.vertices.length; i += 3) {
      const z = data.vertices[i + 1]; data.vertices[i + 1] = data.vertices[i + 2]; data.vertices[i + 2] = -z;
    }
    mesh(data, 0, lift);
  };
  const profile = sectionRoofProfile(form, span, targetH);
  if (profile) {
    // Butterfly is concave: split at the valley so every cap is convex.
    if (form === 'butterfly') {
      const data = { vertices: [], faces: [] };
      for (let i = 1; i < profile.length; i++) {
        const half = sectionMesh(profile.slice(i - 1, i + 1), L), offset = data.vertices.length / 3;
        data.faces.push(...half.faces.map(index => index + offset)); data.vertices.push(...half.vertices);
      }
      mesh(data);
    }
    else section(profile);
    if (form === 'crowstep') for (const side of [-1, 1]) for (let i = 0; i < 7; i++) {
      const stepW = span / 7, z = -span / 2 + (i + .5) * stepW;
      const h = rise * (1 - Math.max(0, Math.abs(z) - stepW / 2) / (S / 2)) + .22;
      add(['box', .22, h, stepW], side * len / 2, h / 2, z);
    }
  } else if (form === 'dome') {
    const radius = Math.min(span, len) / 2, vertices = [], faces = [], n = 14, rings = 8;
    vertices.push(0, radius, 0);
    for (let j = 1; j <= rings; j++) for (let i = 0; i < n; i++) {
      const t = j * Math.PI / (2 * rings), a = i * Math.PI * 2 / n;
      vertices.push(radius * Math.sin(t) * Math.cos(a), radius * Math.cos(t), radius * Math.sin(t) * Math.sin(a));
    }
    for (let i = 0; i < n; i++) faces.push(0, 1 + (i + 1) % n, 1 + i);
    for (let j = 0; j < rings - 1; j++) for (let i = 0; i < n; i++) {
      const a = 1 + j * n + i, b = 1 + j * n + (i + 1) % n;
      faces.push(a, b, b + n, a, b + n, a + n);
    }
    const base = vertices.length / 3; vertices.push(0, 0, 0);
    for (let i = 0; i < n; i++) faces.push(base, 1 + (rings - 1) * n + i, 1 + (rings - 1) * n + (i + 1) % n);
    mesh({ vertices, faces });
  } else if (form === 'vault' || form === 'curved_ridge') {
    const limit = form === 'vault' ? Math.PI / 2 : Math.PI * .3, base = Math.cos(limit);
    section(Array.from({ length: 17 }, (_, i) => {
      const a = -limit + i * limit / 8;
      return [Math.sin(a) * S / (2 * Math.sin(limit)), (Math.cos(a) - base) * rise / (1 - base)];
    }));
  } else if (form === 'spire') {
    add(['cyl', 0, Math.min(span, len) * .425, rise * 2.2, 8], 0, rise * 1.1);
  } else if (form === 'shed') section([[-S/2, 0], [S/2, rise * .85]]);
  else if (form === 'mansard') {
    hip(L, S, span * .84 * L / S, span * .84, rise * .55);
    hip(span * .84 * L / S, span * .84, span * .5 * L / S, span * .5, rise * .35, rise * .55);
  } else if (form === 'wudian') {
    hip(L, S, span * .56 * L / S, span * .56, rise);
    add(['box', span * .56 * L / S, .15, .2], 0, rise + .075);
  } else if (form === 'xieshan') {
    hip(L, S, span * .76 * L / S, span * .76, rise * .45);
    section([[-span*.38,0],[0,rise*.55],[span*.38,0]], L * .75, rise * .45);
    add(['box', L * .75 + .2, .14, .18], 0, rise + .07);
  } else if (form === 'tiered') {
    for (let i = 0; i < 3; i++) {
      const s = 1 - i * .24;
      hip(L * s, S * s, 0, 0, rise * .4, rise * i * .32);
    }
  } else if (form === 'stepped') {
    for (let i = 0; i < 3; i++) add(['box', len * (1 - i * .22), rise * .28, span * (1 - i * .22)], 0, rise * .28 * (.5 + i));
  } else {
    const n = form === 'sawtooth' ? Math.min(4, Math.max(2, Math.floor(span / 4))) : 1;
    const width = form === 'yingshan' ? span : span / n + eave * 2;
    const length = form === 'yingshan' ? len : form === 'xuanshan' ? L + .6 : L;
    for (let i = 0; i < n; i++) section([[-width/2,0],[0,rise / (n > 1 ? 1.4 : 1)],[width/2,0]], length, 0, (i - (n - 1) / 2) * span / n);
    if (form === 'xuanshan') add(['box', L + .8, .14, .14], 0, rise + .07);
  }
  return rows;
}
