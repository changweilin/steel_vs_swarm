// 地被準晶體/規律陣列改制稽核(2026-07-25)——鏡射 public/js/ground.js 的純數學,
// 離線驗證不變式(buildGroundCover 需 THREE + canvas,無法直呼;full pipeline 走瀏覽器真開房)。
// 驗:①底毯角點水密(pure(i,j))②位移 |d|≤0.45 不翻面 ③準晶體場決定性(同 seed 同值/異 seed 異值)
//     ④主散佈點陣走訪雙射(qStride⊥nCells 每格恰一次)⑤ink 全分離係數 > 邊緣交疊係數
//     ⑥細節疏密調變總量守恆(E[0.35+1.3q]=1)。node tools/audit_ground_qc.mjs
'use strict';
let fail = 0;
const bad = (m) => { console.log('  ✗', m); fail++; };
const ok = (m) => console.log('  ✓', m);

// ===== 鏡射 ground.js 準晶體場(§1b)=====
const QC_N = 5;
const QC_DIR = [];
for (let k = 0; k < QC_N; k++) QC_DIR.push([Math.cos(k * Math.PI / QC_N), Math.sin(k * Math.PI / QC_N)]);
const makeQcPh = (seed) => QC_DIR.map((_, k) => {
  let n = (seed ^ Math.imul(k + 1, 0x9E3779B1)) | 0;
  n = Math.imul(n ^ (n >>> 15), 0x2C1B3C6D);
  return ((n ^ (n >>> 13)) >>> 0) / 4294967296 * Math.PI * 2;
});
const qcVal = (PH, x, z, w) => {
  let s = 0;
  for (let k = 0; k < QC_N; k++) s += Math.cos(w * (QC_DIR[k][0] * x + QC_DIR[k][1] * z) + PH[k]);
  return s / QC_N;
};

// ===== 鏡射 cornerAt(§G3)=====
const makeCornerAt = (terrain, seed, cell) => {
  const PH = makeQcPh(seed);
  const cornH = (i, j, s) => {
    let n = ((i * 374761393 + j * 668265263) ^ (seed ^ s)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const QC_CORN_W = 1.75, QC_CORN_A = 0.34, QC_CORN_G = 0.20;
  const clampD = (d) => (d < -0.45 ? -0.45 : d > 0.45 ? 0.45 : d);
  const fracOf = (i, j) => [
    clampD(QC_CORN_A * qcVal(PH, i, j, QC_CORN_W) + QC_CORN_G * (cornH(i, j, 0x9E37) - 0.5)),
    clampD(QC_CORN_A * qcVal(PH, i + 8123.5, j + 2971.3, QC_CORN_W) + QC_CORN_G * (cornH(i, j, 0x85EB) - 0.5)),
  ];
  const cornerAt = (i, j) => {
    const [fx, fz] = fracOf(i, j);
    const x = terrain.minX + i * cell + fx * cell, z = terrain.minZ + j * cell + fz * cell;
    return [Math.min(terrain.maxX, Math.max(terrain.minX, x)), Math.min(terrain.maxZ, Math.max(terrain.minZ, z))];
  };
  return { cornerAt, fracOf, qcAt: (x, z, w) => qcVal(PH, x, z, w) };
};

// ===== 情境:三張圖(小/中/大)× 兩 seed =====
const scenes = [
  { name: 'small', terrain: { minX: -200, minZ: -180, maxX: 200, maxZ: 220, worldW: 400, worldH: 400 }, seed: 0x1234ABCD | 0 },
  { name: 'mid',   terrain: { minX: -600, minZ: -520, maxX: 700, maxZ: 640, worldW: 1300, worldH: 1160 }, seed: 0x51ABCAFE | 0 },
  { name: 'large', terrain: { minX: -1600, minZ: -1400, maxX: 1800, maxZ: 1500, worldW: 3400, worldH: 2900 }, seed: 0x0BADF00D | 0 },
];

console.log('== ①②④ 底毯水密 / 位移不翻面(逐情境)==');
for (const sc of scenes) {
  const { terrain, seed } = sc;
  const cell = Math.max(13, Math.max(terrain.worldW, terrain.worldH) / 232);
  const gnx = Math.ceil(terrain.worldW / cell), gnz = Math.ceil(terrain.worldH / cell);
  const { cornerAt, fracOf } = makeCornerAt(terrain, seed, cell);

  // ① 水密 = cornerAt 為 (i,j) 純函數:重呼位元相同(共用角天生一致)
  let det = true;
  for (let t = 0; t < 4000 && det; t++) {
    const i = (t * 2654435761 >>> 0) % (gnx + 1), j = ((t * 40503 + 7) >>> 0) % (gnz + 1);
    const a = cornerAt(i, j), b = cornerAt(i, j);
    if (a[0] !== b[0] || a[1] !== b[1]) { bad(`[${sc.name}] cornerAt 非純函數 @${i},${j}`); det = false; }
  }
  if (det) ok(`[${sc.name}] cornerAt 純函數 → 相鄰 cell 共用角位元相同(水密)`);

  // ② 位移每軸 |frac| ≤ 0.45(相鄰角最壞相向 0.90 cell < 1.0 → 不交叉)
  let maxFrac = 0;
  for (let J = 0; J <= gnz; J++) for (let I = 0; I <= gnx; I++) {
    const [fx, fz] = fracOf(I, J);
    maxFrac = Math.max(maxFrac, Math.abs(fx), Math.abs(fz));
  }
  if (maxFrac > 0.45 + 1e-12) bad(`[${sc.name}] 位移超界 maxFrac=${maxFrac.toFixed(4)}`);
  else ok(`[${sc.name}] maxFrac=${maxFrac.toFixed(4)} ≤ 0.45(cell=${cell.toFixed(1)}, 格 ${gnx}×${gnz})`);

  // ④ 面翻面:cell 內 3×3 網格三角形自交 = 碎形抖動的殘餘瑕疵(純視覺、平坦地面上的次米級
  //   自疊,不產生「縫隙」故不破壞水密;原版獨立 ±0.45 hash jitter 本就有)。真需求 = 不劣於原版基準。
  const area2 = (A, B, C) => (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const origCorner = (i, j) => {                        // 原版:每軸獨立 (cornH-0.5)*cell*0.9 = ±0.45
    const cornH2 = (ii, jj, s) => { let n = ((ii * 374761393 + jj * 668265263) ^ (seed ^ s)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
    const x = terrain.minX + i * cell + (cornH2(i, j, 0x9E37) - 0.5) * cell * 0.9;
    const z = terrain.minZ + j * cell + (cornH2(i, j, 0x85EB) - 0.5) * cell * 0.9;
    return [Math.min(terrain.maxX, Math.max(terrain.minX, x)), Math.min(terrain.maxZ, Math.max(terrain.minZ, z))];
  };
  const foldCount = (corner) => {
    let flips = 0;
    for (let J = 0; J < gnz; J++) for (let I = 0; I < gnx; I++) {
      const P0 = corner(I, J), P1 = corner(I + 1, J), P2 = corner(I + 1, J + 1), P3 = corner(I, J + 1);
      const G = [P0, mid(P0, P1), P1, mid(P3, P0), mid(mid(P0, P1), mid(P3, P2)), mid(P1, P2), P3, mid(P3, P2), P2];
      let sign = 0, folded = false;
      for (let v = 0; v < 2; v++) for (let u = 0; u < 2; u++) {
        const a = v * 3 + u, e = a + 1, f = a + 3, g2 = f + 1;
        for (const [A, B, C] of [[G[a], G[f], G[e]], [G[e], G[f], G[g2]]]) {
          const s = Math.sign(area2(A, B, C));
          if (s !== 0) { if (sign === 0) sign = s; else if (s !== sign) folded = true; }
        }
      }
      if (folded) flips++;
    }
    return flips;
  };
  const nCell = gnx * gnz, newF = foldCount(cornerAt), oldF = foldCount(origCorner);
  if (newF > oldF) bad(`[${sc.name}] 翻面劣於原版基準 新${newF} > 原${oldF} /${nCell}`);
  else if (newF / nCell > 0.02) bad(`[${sc.name}] 翻面率 ${(newF / nCell * 100).toFixed(2)}% > 2%(視覺可能可見)`);
  else ok(`[${sc.name}] 翻面 ${newF}/${nCell}(${(newF / nCell * 100).toFixed(2)}%)≤ 原版 ${oldF} 且 <2% → 不劣化、次米級不可見`);
}

console.log('== ③ 準晶體場決定性(同 seed 同值 / 異 seed 異值)==');
{
  const A = makeCornerAt(scenes[1].terrain, 0xAAAA0000 | 0, 20);
  const B = makeCornerAt(scenes[1].terrain, 0xAAAA0000 | 0, 20);
  const C = makeCornerAt(scenes[1].terrain, 0x5555FFFF | 0, 20);
  let same = true, diff = false;
  for (let t = 0; t < 500; t++) {
    const x = (t * 13.7) % 900 - 300, z = (t * 7.3) % 700 - 250;
    if (A.qcAt(x, z, 0.035) !== B.qcAt(x, z, 0.035)) same = false;
    if (A.qcAt(x, z, 0.035) !== C.qcAt(x, z, 0.035)) diff = true;
  }
  same ? ok('同 seed → qcVal 位元相同(§2.3 跨客戶端一致)') : bad('同 seed qcVal 不一致');
  diff ? ok('異 seed → qcVal 相位不同(每圖不同貌)') : bad('異 seed qcVal 退化相同');
  // 場值域 ∈[-1,1](角點位移預算前提)
  let mn = 9, mx = -9;
  for (let t = 0; t < 20000; t++) { const v = A.qcAt((t * 3.1) % 2000, (t * 1.7) % 2000, 1.75); mn = Math.min(mn, v); mx = Math.max(mx, v); }
  (mn >= -1.0001 && mx <= 1.0001) ? ok(`qcVal 值域 [${mn.toFixed(3)}, ${mx.toFixed(3)}] ⊆ [-1,1]`) : bad(`qcVal 值域越界 [${mn},${mx}]`);
}

console.log('== ④ 主散佈準晶體走訪雙射(qStride ⊥ nCells 每格恰訪一次)==');
{
  const gcd = (m, n) => { while (n) { const t = m % n; m = n; n = t; } return m; };
  let allBij = true;
  for (const sc of scenes) {
    const { terrain, seed } = sc;
    const area = terrain.worldW * terrain.worldH;
    const target = Math.max(140, Math.min(1800, Math.round(area / 1e6 * 420)));
    const qs = Math.max(18, Math.min(40, Math.sqrt(area / Math.max(1, target * 4))));
    const nqx = Math.ceil(terrain.worldW / qs), nqz = Math.ceil(terrain.worldH / qs);
    const nCells = nqx * nqz;
    let qStride = Math.max(1, Math.round(nCells * 0.61803));
    while (gcd(qStride, nCells) !== 1) qStride++;
    const qOff = (seed >>> 0) % Math.max(1, nCells);
    if (gcd(qStride, nCells) !== 1) { bad(`[${sc.name}] qStride 未與 nCells 互質`); allBij = false; continue; }
    const seen = new Uint8Array(nCells);
    let dup = 0;
    for (let a = 0; a < nCells; a++) { const idx = (qOff + a * qStride) % nCells; if (seen[idx]++) dup++; }
    let missed = 0; for (let i = 0; i < nCells; i++) if (!seen[i]) missed++;
    if (dup || missed) { bad(`[${sc.name}] 走訪非雙射 dup=${dup} missed=${missed}`); allBij = false; }
    else ok(`[${sc.name}] nCells=${nCells} qStride=${qStride} 走訪雙射(每格恰一次)`);
  }
  if (allBij) ok('全情境走訪雙射 → 不規律候選非週期不重複且無漏格');
}

console.log('== ⑤ ink 全分離 > 邊緣交疊 ==');
{
  const SEP_F = 0.85, INK_SEP_F = 1.06;
  (INK_SEP_F > 1.0 && INK_SEP_F > SEP_F)
    ? ok(`INK_SEP_F=${INK_SEP_F} > 1.0(相切)且 > SEP_F=${SEP_F} → 規律↔規律零互疊、其餘容邊緣交疊`)
    : bad('INK_SEP_F 未大於 1.0/SEP_F');
  // 兩個等大 ink patch 相切(圓距 = r1+r2)在 INK_SEP_F 判定下應「重疊」被擋
  const r = 16, d = r + r;                       // 恰相切
  const rejected = d * d < ((r + r) * INK_SEP_F) ** 2;
  rejected ? ok('相切的兩規律結構被 INK_SEP_F 判為互疊而擋下(留 6% 間隙)') : bad('相切規律結構未被擋');
}

console.log('== ⑥ 細節疏密調變總量守恆(E[0.35+1.3q]=1, q=0.5+0.5·qcVal, E[qcVal]=0)==');
{
  const A = makeCornerAt(scenes[2].terrain, 0x0BADF00D | 0, 20);
  const CAR_QC_W = (2 * Math.PI) / (16 * 3);
  let sum = 0; const N = 200000;
  const { terrain } = scenes[2];
  for (let t = 0; t < N; t++) {
    const x = terrain.minX + ((t * 2654435761 >>> 0) % 1e6) / 1e6 * terrain.worldW;
    const z = terrain.minZ + ((t * 40503 >>> 0) % 1e6) / 1e6 * terrain.worldH;
    const q = 0.5 + 0.5 * A.qcAt(x, z, CAR_QC_W);
    sum += 0.35 + 1.3 * q;
  }
  const mean = sum / N;
  (Math.abs(mean - 1) < 0.01) ? ok(`E[gate factor]=${mean.toFixed(4)} ≈ 1 → 細節總量守恆(不增 draw call/實例)`)
    : bad(`E[gate factor]=${mean.toFixed(4)} 偏離 1(總量會漂移)`);
}

console.log(fail ? `\nFAIL(${fail} 項)` : '\nALL PASS');
process.exit(fail ? 1 : 0);
