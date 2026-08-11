// 地被準晶體/規律陣列改制稽核(2026-07-25)——鏡射 public/js/ground.js 的純數學,
// 離線驗證不變式(buildGroundCover 需 THREE + canvas,無法直呼;full pipeline 走瀏覽器真開房)。
// 驗:①底毯角點水密(pure(i,j))②位移 |d|≤0.45 不翻面 ③準晶體場決定性(同 seed 同值/異 seed 異值)
//     ④主散佈點陣走訪雙射(qStride⊥nCells 每格恰一次)⑤ink 全分離係數 > 邊緣交疊係數
//     ⑥細節疏密調變總量守恆(E[0.35+1.3q]=1)
//     ⑦規律結構都市規劃朝向(2026-07-29:gridA 主方位執行原文 + ink 恆對齊三段退避靜態規則)
// node tools/audit_ground_qc.mjs
'use strict';
import { readSrc, grabFn } from './audit_src.mjs';
import { gridAngle } from '../public/js/roadgrid.js';
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

console.log('== ⑤ 功能性區塊 / 3D 物件不可互相重疊(2026-08-11 使用者定案;執行原文)==');
{
  // 幾何全部**執行 ground.js 的原文**(自己抄一份公式去驗 = 只驗到自己抄對沒有)
  const gsrc = readSrc('public', 'js', 'ground.js');
  const pick = (re, name) => {
    const m = gsrc.match(re);
    if (!m) { bad(`ground.js 抽不到 ${name} 原文(漂移,請同步稽核)`); return ''; }
    return m[0].replace('export ', '');
  };
  const G = new Function([
    pick(/export const PATCH_GAP = .*$/m, 'PATCH_GAP'),
    pick(/export const DET_GAP = .*$/m, 'DET_GAP'),
    pick(/export function obbDist\(px, pz, o\) \{[\s\S]*?\n\}/, 'obbDist'),
    pick(/export function obbNear\(a, b, gap\) \{[\s\S]*?\n\}/, 'obbNear'),
    pick(/export function footNear\(a, b, gap\) \{[\s\S]*?\n\}/, 'footNear'),
  ].join('\n') + '\nreturn { PATCH_GAP, DET_GAP, obbDist, obbNear, footNear };')();
  const rect = (x, z, hw, hd, ry) => ({ x, z, hw, hd, ry, r: Math.hypot(hw, hd) });
  const circ = (x, z, r) => ({ x, z, r });

  // ① obbDist:盒內 0、沿軸外推 = 超出量、斜角 = 角點距離
  const B = rect(0, 0, 4, 2, 0);
  (G.obbDist(0, 0, B) === 0 && G.obbDist(3, 1, B) === 0
    && Math.abs(G.obbDist(6, 0, B) - 2) < 1e-9
    && Math.abs(G.obbDist(7, 5, B) - Math.hypot(3, 3)) < 1e-9)
    ? ok('obbDist:盒內 0 / 沿軸 = 超出量 / 斜角 = 角點距離') : bad('obbDist 幾何不對');
  // 旋轉同調:轉 90° 後長短軸互換(軸向寫反會讓「看得見的長邊」與「擋得住的長邊」差 90°)
  const R90 = rect(0, 0, 4, 2, Math.PI / 2);
  (Math.abs(G.obbDist(0, 6, R90) - 2) < 1e-9 && G.obbDist(0, 3, R90) === 0)
    ? ok('obbDist 的 ry 軸向與 emitRect 同調(局部 x 軸 = (cos, sin)))') : bad('obbDist 旋轉軸向寫反');

  // ② 這一輪要修的病灶:等面積圓近似會放行「角疊角」的兩塊功能性區塊
  //    半寬 16 / 半深 11.2 的兩塊沿長軸相距 30 —— 真實足跡疊了 2m,而等面積圓(13.4)
  //    連舊制**最嚴**的那條(INK_SEP_F 1.06)都放行(ink↔fade 走 0.85 更寬)
  const r0 = 16, asp = 0.7, rEff = r0 * Math.sqrt(asp), D2 = 30;
  const A2 = rect(0, 0, r0, r0 * asp, 0), B2 = rect(D2, 0, r0, r0 * asp, 0);
  const circleSaysOk = (D2 * D2) >= ((rEff + rEff) * 1.06) ** 2;
  (circleSaysOk && G.footNear(A2, B2, G.PATCH_GAP))
    ? ok('等面積圓放行、真實足跡擋下的「切穿」案例被抓到(這就是改判定的理由)')
    : bad(circleSaysOk ? 'footNear 沒擋下互切的兩塊功能性區塊' : '對照案例失效(常數漂移,請同步稽核)');
  // ③ 分離軸上真的分開了就 MUST 放行(否則沿街格陣與農田拼布會被自己的規則拆散)
  const B3 = rect(2 * r0 + 1.6, 0, r0, r0 * asp, 0);      // 陣列相鄰 tile:邊緣間距 = ARR_GAP 1.6
  const B4 = rect(0, 2 * r0 * asp + 1.2, r0, r0 * asp, 0); // 家族延伸:邊緣間距 1.2
  (!G.footNear(A2, B3, G.PATCH_GAP) && !G.footNear(A2, B4, G.PATCH_GAP))
    ? ok(`PATCH_GAP=${G.PATCH_GAP} 放得過陣列間隙 1.6 與家族延伸間隙 1.2(格陣不被自己拆散)`)
    : bad(`PATCH_GAP=${G.PATCH_GAP} 太大,沿街格陣/農田拼布會被擋掉`);
  (G.PATCH_GAP > 0 && G.PATCH_GAP < 1.2)
    ? ok('PATCH_GAP ∈ (0, 1.2):留得出結構間隙又不拆散既有佈局') : bad('PATCH_GAP 越界');
  // ④ 混合型(rect ↔ blob):圓心到盒的最近點判定,兩個方向對稱
  const C1 = circ(r0 + 3, 0, 4);                          // 圓緣壓進盒(距盒 3 < 4)
  const C2 = circ(r0 + 9, 0, 4);                          // 圓緣離盒 5 > PATCH_GAP
  (G.footNear(A2, C1, G.PATCH_GAP) && G.footNear(C1, A2, G.PATCH_GAP)
    && !G.footNear(A2, C2, G.PATCH_GAP) && !G.footNear(C2, A2, G.PATCH_GAP))
    ? ok('rect ↔ blob 混合判定正確且兩個方向對稱(自然拼圖不會疊上功能性區塊)')
    : bad('rect ↔ blob 判定不對稱或判錯');
  // ⑤ 圓↔圓退化成距離判定
  (G.footNear(circ(0, 0, 3), circ(0, 5, 3), 0) && !G.footNear(circ(0, 0, 3), circ(0, 7, 3), 0))
    ? ok('blob ↔ blob 退化成圓距判定') : bad('圓↔圓判定不對');

  // ⑥ 接線:功能性區塊只要**任一方**是 ink 就走真實足跡(舊制的 `depth === 0` 把陣列
  //    tile 與家族延伸排除在外 ⇒ 沿街格陣可以切穿農田);3D 物件足跡量零件實幾何
  /if \(isInk \|\| p\.ink\) \{ if \(footNear\(foot, p\.foot, PATCH_GAP\)\) return true; continue; \}/.test(gsrc)
    ? ok('overlapPs:任一方是功能性區塊即走 footNear(不再看 depth)')
    : bad('overlapPs 未接真實足跡判定');
  /overlapPs\(x, z, rEff, foot, def\.edge === 'ink'\)/.test(gsrc)
    ? ok('tryPatch 以 def.edge 判功能性區塊(陣列 tile 與家族延伸一併納管)')
    : bad('tryPatch 仍以 depth 排除陣列/家族延伸');
  (/function detailR\(type\) \{[\s\S]*?computeBoundingBox\(\)/.test(gsrc)
    && /const dr = detailR\(type\) \* s;/.test(gsrc) && /if \(!detFree\(px, pz, dr\)\) return;/.test(gsrc))
    ? ok('3D 物件足跡量零件實幾何 × 實例縮放,擺放前逐件查(detFree)')
    : bad('3D 物件互不重疊未接上(或足跡是手寫的)');
  /for \(const f of il\) if \(f !== curInk && footNear\(me, f, 0\)\) return false;/.test(gsrc)
    ? ok('3D 物件不得站進**別人的**功能性區塊(自己那一塊 curInk 豁免)')
    : bad('3D 物件可以站進別人的功能性區塊');
  // ⑦ 對照組(反向驗證):把 footNear 退回「一律圓近似」⇒ ② 的切穿案例必須又被放行
  const fnSrc = gsrc.match(/export function footNear\(a, b, gap\) \{[\s\S]*?\n\}/);
  const fnBad = fnSrc && fnSrc[0].replace(
    'if (a.hd && b.hd) return obbNear(a, b, gap);',
    'if (a.hd && b.hd) return Math.hypot(a.x - b.x, a.z - b.z) < a.r * 0.72 + b.r * 0.72 + gap;');
  if (!fnBad || fnBad === fnSrc[0]) bad('對照組替換點失配(footNear 原文已漂移,請同步稽核)');
  else {
    const bad2 = new Function(
      pick(/export function obbDist\(px, pz, o\) \{[\s\S]*?\n\}/, 'obbDist') + '\n' +
      pick(/export function obbNear\(a, b, gap\) \{[\s\S]*?\n\}/, 'obbNear') + '\n' +
      fnBad.replace('export ', '') + '\nreturn footNear;')();
    !bad2(A2, B2, G.PATCH_GAP)
      ? ok('對照組:退回圓近似的壞版本又放行了互切的兩塊功能性區塊(② 有牙)')
      : bad('對照組:壞版本未呈現預期缺陷(② 驗不到東西)');
  }
  // 拒絕 MUST 排在首個 rnd() 之前(否則散布序列被「有沒有被擋」改寫)
  const adM = gsrc.match(/const addDetail = \(type, px, pz, s, tintHex = null, sy = 1, ry = null\) => \{[\s\S]*?\n  \};/);
  if (!adM) bad('抽不到 addDetail 原文');
  else {
    const body = adM[0].replace(/\/\/[^\r\n]*/g, '');
    const iF = body.indexOf('detFree('), iR = body.indexOf('rnd()');
    (iF > 0 && iF < iR) ? ok('addDetail 的重疊拒絕排在首個 rnd() 之前(確定性序列不變)')
      : bad('addDetail 的重疊拒絕晚於首個 rnd()');
  }
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

console.log('== ⑦ 規律結構都市規劃朝向(球場/操場/停車場/太陽能板 ↔ 道路格網一致)==');
{
  const gsrc = readSrc('public', 'js', 'ground.js');
  const bsrc = readSrc('public', 'js', 'biomes.js');
  // —— 執行 gridA 原文(全圖格網主方位:道路線段長度加權的 mod 90° 圓平均)——
  // `\r?\n`:CRLF 檢出(Windows core.autocrlf)下 `;\n` 抽不到原文 ⇒ 整段體檢靜默不驗
  // 公式本體自 2026-08-10 起住 `roadgrid.js gridAngle`(場地主方位的離線烘焙吃同一支)⇒ 沙箱注入它。
  // 這一段因此同時驗兩件事:ground.js 這個消費端有沒有把線段餵對、那支共用公式的行為對不對。
  const gm = gsrc.match(/const GRID_FAR_R2 = [\s\S]*?gridA = gridAngle\(segs\);\r?\n  \}/);
  if (!gm) bad('ground.js 找不到 gridA 主方位原文');
  else {
    const runGrid = (body, roadPolys, ga = gridAngle) =>
      new Function('roadPolys', 'gridAngle', `${body}\nreturn { GRID_FAR_R2, gridA };`)(roadPolys, ga);
    const deg = (d) => d * Math.PI / 180;
    const road = (a, len, n = 4) => {   // 方位 a、總長 len 的折線
      const pts = [];
      for (let i = 0; i <= n; i++) pts.push([Math.cos(a) * len * i / n, Math.sin(a) * len * i / n]);
      return [pts, 4];
    };
    const diff90 = (a, b) => {          // mod 90° 圓距(度)
      let d = Math.abs(a - b) % 90;
      return Math.min(d, 90 - d);
    };
    const g1 = runGrid(gm[0], [road(deg(25), 500)]);
    diff90(g1.gridA * 180 / Math.PI, 25) < 0.5
      ? ok(`單一 25° 幹道 → gridA=${(g1.gridA * 180 / Math.PI).toFixed(1)}°(mod 90° 對齊)`)
      : bad(`gridA=${(g1.gridA * 180 / Math.PI).toFixed(1)}° ≠ 25°(mod 90°)`);
    const g2 = runGrid(gm[0], [road(deg(25), 500), road(deg(115), 500), road(deg(-65), 300)]);
    diff90(g2.gridA * 180 / Math.PI, 25) < 0.5
      ? ok('垂直街道網(25°/115°/-65°)不互相抵銷 → 4 倍角圓平均仍回 25° 格網')
      : bad(`垂直街道抵銷:gridA=${(g2.gridA * 180 / Math.PI).toFixed(1)}°`);
    const g3 = runGrid(gm[0], [road(deg(30), 1000), road(deg(60), 10)]);
    diff90(g3.gridA * 180 / Math.PI, 30) < 2
      ? ok('長度加權:1000m 的 30° 幹道壓過 10m 支線')
      : bad(`長度加權失效:gridA=${(g3.gridA * 180 / Math.PI).toFixed(1)}°`);
    (runGrid(gm[0], []).gridA === null && runGrid(gm[0], null).gridA === null)
      ? ok('無道路圖資 → gridA=null(離線備援退回隨機,行為不變)')
      : bad('無圖資時 gridA 非 null');
    g1.GRID_FAR_R2 > 46 * 46
      ? ok(`離路擴大半徑 GRID_FAR ${Math.sqrt(g1.GRID_FAR_R2)}m > 近路 46m(找得到同街區幹道)`)
      : bad('GRID_FAR 未大於近路半徑');
    // 對照組:拿掉 4 倍角摺疊 → 垂直街道互相抵銷/平均偏斜,mod 90° 檢查必紅。
    // 摺疊自 2026-08-10 起住 `roadgrid.js gridAngle` ⇒ 要動刀的是**那一支的原文**,
    // 在 ground.js 這段消費端原文上做字串替換是無聲的 no-op(對照組會永遠通過 = 沒驗到)。
    const gaSrc = grabFn(readSrc('public', 'js', 'roadgrid.js'), 'gridAngle');
    const flatGA = new Function(`return ${gaSrc
      .replace('Math.atan2(dz, dx) * 4', 'Math.atan2(dz, dx) * 1')
      .replace('Math.atan2(sz, sx) / 4', 'Math.atan2(sz, sx) / 1')}`)();
    if (flatGA.toString() === gaSrc) bad('對照組:gridAngle 的 4 倍角替換沒生效(原文樣式已變)');
    const gBad = runGrid(gm[0], [road(deg(25), 500), road(deg(115), 500)], flatGA);
    (gBad.gridA === null || diff90(gBad.gridA * 180 / Math.PI, 25) >= 0.5)
      ? ok('對照組:無摺疊的平均在垂直街道下失準(4 倍角檢查有牙)')
      : bad('對照組:無摺疊版本竟仍正確(檢查驗不到東西)');
  }
  // —— 靜態規則:ink 恆對齊三段退避 / 亂數紀律 / roadDirAt 半徑參數 ——
  const inkIdx = gsrc.indexOf('if (ink) {');
  (inkIdx > 0 && gsrc.lastIndexOf('const ra = rnd()', inkIdx) > 0 && gsrc.lastIndexOf('const roll = rnd()', inkIdx) > 0
    && gsrc.lastIndexOf('const ra = rnd()', inkIdx) < inkIdx && gsrc.lastIndexOf('const roll = rnd()', inkIdx) < inkIdx)
    ? ok('orient:兩枚 rnd 恆在 ink 分支前抽好(對齊與否不改變 rnd 消耗序列,§2.3)')
    : bad('orient 亂數紀律失守(ink 分支前未固定抽 2 枚)');
  gsrc.includes('roadDirAt(x, z) ?? roadDirAt(x, z, GRID_FAR_R2)') && /\?\? gridA/.test(gsrc)
    ? ok('ink 三段退避:近路路向 → 擴大半徑街區幹道 → 全圖格網主方位')
    : bad('ink 三段退避鏈缺失');
  gsrc.includes("orient(x, z, DEFS[sub].reg, true, DEFS[sub].edge === 'ink')")
    ? ok('主散佈迴圈對 ink 規律結構恆走都市規劃朝向(不吃 reg 擲骰)')
    : bad('主散佈迴圈未對 ink 傳遞恆對齊旗標');
  (bsrc.includes('const roadDirAt = (x, z, r2 = RD_R2)') && bsrc.includes('Math.ceil(Math.sqrt(r2) / RD_CELL)'))
    ? ok('biomes.js roadDirAt 半徑可覆寫且掃描窗由半徑推導(預設行為 = 舊版 span 2)')
    : bad('roadDirAt 半徑參數/掃描窗推導缺失');
}

console.log(fail ? `\nFAIL(${fail} 項)` : '\nALL PASS');
process.exit(fail ? 1 : 0);
