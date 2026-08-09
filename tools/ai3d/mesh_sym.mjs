#!/usr/bin/env node
// ============ 零件庫節點的「另一面空不空」量測(鏡像貼補的閘門與驗收)============
//
// 使用者 2026-08-09 定案:「img to 3D 會出現另一面是空的問題,由正面對稱的區塊去補對應的
// 區塊,包含建築 / 巨岩 / 假山都這樣處理」。要**補哪些節點**與**補完算不算數**都需要一把尺,
// 而 §5ac-a 已經量出那把尺長什麼樣:
//
//   單張照片只約束得到看得見的那幾面 ⇒ 沒被拍到的那半不是**破洞**,是模型自己補上的
//   一片**光滑的板**。開放邊與元件數對它完全無感(它是封閉的、連通的),
//   **半空間表面積**才判得出來:細節多 = 同樣的投影面積要用更多三角形去包 = 面積大。
//
// 四個數,各回答一個問題:
//   ① `asymX/asymZ` 半空間面積不對稱 = |A₊ − A₋| / A —— **這一面是不是空的**(閘門:要不要鏡射)
//   ② `sym` 鏡射殘差 = 頂點到「自己的鏡像」最近點距離 ÷ 該軸跨距 —— **是不是一顆假的雙生岩**
//      (鏡射完恆為 0;去對稱化之後要回到天然岩體的水準,基準取本檔量得到的未鏡射節點)
//   ③ `open` 邊界邊數 / ④ `comp` 連通元件數 —— **網格有沒有被這一刀撕爛**(§5ac-b 的兩次失敗
//      就是靠這兩個數看出來的:開放邊 16 → 362 / 元件 6 → 13)
//
// ③④ MUST 先**依座標焊頂點**再算:GLB 帶法線 ⇒ 匯出器在法線接縫處把頂點拆開,
// 直接拿索引算的話每一條硬邊都被讀成邊界邊,任何一顆節點都會報出幾百條開放邊(全是假的)。
//
// 用法:
//   node tools/ai3d/mesh_sym.mjs                          # 掃 PART_LIBS 每一族
//   node tools/ai3d/mesh_sym.mjs --glb <path> [--json]    # 指定一支 GLB
//   node tools/ai3d/mesh_sym.mjs --ref <a.glb> --glb <b.glb>   # 兩支對照(鏡射前 vs 後)
//   node tools/ai3d/mesh_sym.mjs --gate                   # 印「哪幾顆該補」的名冊(見下)
// A2:零 npm 依賴。
import { existsSync } from 'node:fs';
import { parseGlb, partLibs, glbPath } from './parts_src.mjs';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const has = (n) => argv.includes(`--${n}`);

// 焊接容差:跨距的 1e-4(比例值 —— 絕對值不可移植,§5r ⑥)
const WELD_F = 1e-4;

// 「這一面是空的」的門檻(半空間面積不對稱)。**錨在使用者自己看過並判定為空的那一顆**:
// §5ac-a 量到 `mass_a` 鏡射前 z 軸 **0.123**、x 軸 0.006,而使用者對著那張定場圖說的正是
// 「圖中建築另一面是空的」⇒ 0.12 是那個判斷的量化,不是挑出來的數字。
// 用途:使用者 2026-08-09 的要求是**條件句**(「img to 3D **會出現**另一面是空的問題,
// 由正面對稱的區塊去補對應的區塊」)—— 沒有空的那一面就沒有要補的東西,而對一顆四面
// 都長好的岩體照樣切半鏡射,換來的只是一顆左右對稱、接縫處帶凹槽的假石頭(§5ad 黏土留檔)。
// 所以「補哪幾顆」MUST 是量出來的,MUST NOT 是逐顆手挑的名冊。
export const EMPTY_ASYM = 0.12;

/** 依座標焊頂點:回 { map: 原索引 → 焊後索引, n: 焊後頂點數, pos: 焊後座標 } */
function weld(pos, span) {
  const q = Math.max(span * WELD_F, 1e-9);
  const key = new Map(), map = new Uint32Array(pos.length / 3), out = [];
  for (let i = 0; i < pos.length; i += 3) {
    const k = `${Math.round(pos[i] / q)}|${Math.round(pos[i + 1] / q)}|${Math.round(pos[i + 2] / q)}`;
    let id = key.get(k);
    if (id === undefined) { id = out.length / 3; key.set(k, id); out.push(pos[i], pos[i + 1], pos[i + 2]); }
    map[i / 3] = id;
  }
  return { map, n: out.length / 3, pos: Float32Array.from(out) };
}

/** 一顆節點的四個數(node = parseGlb 的一列) */
export function symStats(node) {
  const { pos, idx } = node;
  const nv = pos.length / 3;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], pos[i + a]); hi[a] = Math.max(hi[a], pos[i + a]); }
  }
  const span = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];

  // ① 半空間面積不對稱(逐軸;水平兩軸 x / z 才有意義,y 一併印出當對照)
  const aP = [0, 0, 0], aN = [0, 0, 0];
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t] * 3, i1 = idx[t + 1] * 3, i2 = idx[t + 2] * 3;
    const ux = pos[i1] - pos[i0], uy = pos[i1 + 1] - pos[i0 + 1], uz = pos[i1 + 2] - pos[i0 + 2];
    const vx = pos[i2] - pos[i0], vy = pos[i2 + 1] - pos[i0 + 1], vz = pos[i2 + 2] - pos[i0 + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const ar = Math.hypot(cx, cy, cz) / 2;
    for (let a = 0; a < 3; a++) {
      const c = (pos[i0 + a] + pos[i1 + a] + pos[i2 + a]) / 3;
      (c >= mid[a] ? aP : aN)[a] += ar;
    }
  }
  const asym = [0, 1, 2].map((a) => (aP[a] + aN[a] > 0 ? Math.abs(aP[a] - aN[a]) / (aP[a] + aN[a]) : 0));

  // ② 鏡射殘差(逐水平軸):頂點 → 自己的鏡像點雲最近點,除以該軸跨距
  //    暴力最近點:節點都在數千頂點以下,O(n²) 只有幾百萬次比較
  const symRes = [0, 1, 2].map((a) => {
    if (!(span[a] > 0)) return 0;
    let acc = 0;
    for (let i = 0; i < pos.length; i += 3) {
      let best = Infinity;
      for (let j = 0; j < pos.length; j += 3) {
        // 鏡像點 = 把 j 這一點在 a 軸上對 mid 翻過去
        let d = 0;
        for (let b = 0; b < 3; b++) {
          const q = b === a ? 2 * mid[a] - pos[j + b] : pos[j + b];
          d += (pos[i + b] - q) ** 2;
          if (d >= best) break;
        }
        if (d < best) best = d;
      }
      acc += Math.sqrt(best);
    }
    return acc / nv / span[a];
  });

  // ③④ 拓樸(MUST 焊完再算)
  const w = weld(pos, Math.max(...span));
  const edge = new Map();
  let comps = 0;
  const adj = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const a = w.map[idx[t]], b = w.map[idx[t + 1]], c = w.map[idx[t + 2]];
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      if (p === q) continue;
      const k = p < q ? `${p}_${q}` : `${q}_${p}`;
      edge.set(k, (edge.get(k) || 0) + 1);
      if (!adj.has(p)) adj.set(p, []); if (!adj.has(q)) adj.set(q, []);
      adj.get(p).push(q); adj.get(q).push(p);
    }
  }
  let open = 0;
  for (const c of edge.values()) if (c === 1) open++;
  const seen = new Set();
  for (const v of adj.keys()) {
    if (seen.has(v)) continue;
    comps++; const st = [v]; seen.add(v);
    while (st.length) { const u = st.pop(); for (const n2 of adj.get(u) || []) if (!seen.has(n2)) { seen.add(n2); st.push(n2); } }
  }

  return {
    tris: node.tris, verts: nv, welded: w.n, open, comps,
    asymX: asym[0], asymY: asym[1], asymZ: asym[2],
    symX: symRes[0], symZ: symRes[2],
    span: { x: span[0], y: span[1], z: span[2] },
  };
}

function scan(path) {
  const nodes = parseGlb(path);
  const rows = [];
  for (const [name, n] of nodes) rows.push({ name, ...symStats(n) });
  rows.sort((a, b) => Math.max(b.asymX, b.asymZ) - Math.max(a.asymX, a.asymZ));
  return rows;
}

const targets = opt("glb") ? [opt("glb")] : partLibs().map((f) => glbPath(f));
const refRows = opt('ref') ? new Map(scan(opt('ref')).map((r) => [r.name, r])) : null;
const all = [];
for (const gp of targets) {
  if (!gp || !existsSync(gp)) { console.error(`跳過(不存在):${gp}`); continue; }
  const rows = scan(gp);
  all.push(...rows);
  if (has('json')) continue;
  console.log(`\n=== ${gp} ===`);
  console.log('節點'.padEnd(20) + '  tris   焊點  開放邊 元件 | asymX asymZ (空的那一面) | symX  symZ (鏡射殘差)');
  for (const r of rows) {
    const ref = refRows?.get(r.name);
    const d = (v, o) => (ref ? `${v.toFixed(3)}→${o.toFixed(3)}` : v.toFixed(3));
    console.log(
      r.name.padEnd(20) + String(r.tris).padStart(6) + String(r.welded).padStart(7)
      + String(r.open).padStart(7) + String(r.comps).padStart(5) + ' | '
      + (ref ? `${ref.asymX.toFixed(3)}→` : '') + r.asymX.toFixed(3) + '  '
      + (ref ? `${ref.asymZ.toFixed(3)}→` : '') + r.asymZ.toFixed(3) + ' | '
      + (ref ? `${ref.symX.toFixed(3)}→` : '') + r.symX.toFixed(3) + ' '
      + (ref ? `${ref.symZ.toFixed(3)}→` : '') + r.symZ.toFixed(3),
    );
  }
}
if (has('json')) console.log(JSON.stringify(all, null, 1));

if (has('gate')) {
  const hit = all.filter((r) => Math.max(r.asymX, r.asymZ) >= EMPTY_ASYM);
  console.log(`\n=== 該補的節點(半空間面積不對稱 ≥ ${EMPTY_ASYM};錨 = §5ac-a 的 mass_a 0.123)===`);
  for (const r of hit) {
    console.log(`  ${r.name.padEnd(14)} 軸 ${r.asymX >= r.asymZ ? 'x' : 'z'}`
      + ` ・不對稱 ${Math.max(r.asymX, r.asymZ).toFixed(3)}`
      + ` ・邊界邊 ${r.open}${r.open ? '(有實體破口,warp MUST 0 —— 位移會把裂縫拉開)' : ''}`);
  }
  console.log(`  合計 ${hit.length} / ${all.length} 顆`);
}
