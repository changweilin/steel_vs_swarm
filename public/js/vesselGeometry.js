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
