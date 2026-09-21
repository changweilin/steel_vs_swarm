// Render-free loft geometry shared by vessels and boundary scenery.
export function loftMeshData(sections) {
  const ringN = sections[0].ring.length;
  const pos = [];
  for (const section of sections) {
    if (section.ring.length !== ringN) throw new Error('loftGeometry 截面頂點數不一致');
    for (const [x, y] of section.ring) pos.push(x, y, section.z);
  }

  const idx = [];
  for (let s = 0; s < sections.length - 1; s++) {
    const a0 = s * ringN, b0 = (s + 1) * ringN;
    for (let j = 0; j < ringN; j++) {
      const k = (j + 1) % ringN;
      idx.push(a0 + j, a0 + k, b0 + k, a0 + j, b0 + k, b0 + j);
    }
  }
  for (let j = 1; j < ringN - 1; j++) idx.push(j + 1, j, 0);
  const front = (sections.length - 1) * ringN;
  for (let j = 1; j < ringN - 1; j++) idx.push(front, front + j, front + j + 1);

  return { vertices: pos, faces: idx };
}

export const hullRing = (halfW, deckY, chineY, keelY) => [
  [-halfW, deckY], [-halfW * 0.82, chineY], [0, keelY],
  [halfW * 0.82, chineY], [halfW, deckY],
];

export function vesselHullSections(v, ring = (w, y, d) => hullRing(w, y, -d * .65, -d), fine = false, flat = false) {
  const { length: L, beam: B, draft: D, freeboard: F } = v;
  return [
    { z: -L / 2, ring: ring(B * (fine ? .018 : .34), F, D * .65) },
    { z: -L * .32, ring: ring(B * .5, F, D) },
    { z: L * .23, ring: ring(B * .5, F, D) },
    { z: L * .43, ring: ring(B * (flat ? .39 : .25), F * 1.08, D * .7) },
    { z: L / 2, ring: ring(B * (flat ? .32 : .015), F * 1.12, D * .16) },
  ];
}

// 法線群組：共用頂點的面只在夾角容限內共用法線，超過即拆頂點。
// 呼叫端傳index＋position陣列，拿回逐面獨立法線（仍帶順序index，合批相容）。
// 預設 30°：圓頂相鄰環 11~26° 保持平滑，屋脊／簷口／柱頂底蓋回到脆直線。
export function facetMeshData(data, deg = 30) {
  const cos = Math.cos(deg * Math.PI / 180);
  const fCount = data.faces.length / 3, faceN = new Array(fCount);
  for (let f = 0; f < fCount; f++) {
    const p = [0, 1, 2].map((k) => {
      const i = data.faces[f * 3 + k] * 3;
      return [data.vertices[i], data.vertices[i + 1], data.vertices[i + 2]];
    });
    const ab = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const ac = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const m = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const l = Math.hypot(m[0], m[1], m[2]);
    faceN[f] = l > 1e-12 ? [m[0] / l, m[1] / l, m[2] / l] : null;
  }
  const incident = new Map();
  for (let f = 0; f < fCount; f++) {
    if (!faceN[f]) continue;
    for (let k = 0; k < 3; k++) {
      const vi = data.faces[f * 3 + k];
      if (!incident.has(vi)) incident.set(vi, []);
      incident.get(vi).push(f);
    }
  }
  const vertices = [], normals = [], faces = [];
  for (let f = 0; f < fCount; f++) {
    for (let k = 0; k < 3; k++) {
      const vi = data.faces[f * 3 + k];
      let nx = 0, ny = 1, nz = 0;
      if (faceN[f]) {
        // deg <= 0 = 全平面：不分群，每面各自法線（拉伸圖元的光滑法線已失真，直接攤平）。
        const group = cos >= 1 ? [f] : (incident.get(vi) || []).filter((g) =>
          faceN[g][0] * faceN[f][0] + faceN[g][1] * faceN[f][1] + faceN[g][2] * faceN[f][2] >= cos);
        nx = 0; ny = 0; nz = 0;
        for (const g of group) { nx += faceN[g][0]; ny += faceN[g][1]; nz += faceN[g][2]; }
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
      }
      vertices.push(data.vertices[vi * 3], data.vertices[vi * 3 + 1], data.vertices[vi * 3 + 2]);
      normals.push(nx, ny, nz);
      faces.push(vertices.length / 3 - 1);
    }
  }
  return { vertices, faces, normals };
}
