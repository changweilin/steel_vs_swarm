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
//   node tools/ai3d/mesh_sym.mjs --flaws                  # 印「哪幾顆是半成品」(對照台同一支判定)
// A2:零 npm 依賴。
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parseGlb, partLibs, glbPath } from './parts_src.mjs';

// **CLI 那一段 MUST 關在 main 守衛裡**:3D 零件對照台 import 本檔取 `topoStats`/`nodeFlaws`
// (半成品判定的唯一縫),而舊制的掃描迴圈住在模組頂層 ⇒ 一 import 就當場掃三支 GLB 並把
// 整張表印進伺服器的 stdout(同 `fetch_photos.mjs` 的 main() 頂層呼叫那個坑)。
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

// ---- 「這顆還沒封起來」的兩把尺(3D 零件對照台的半成品判定同吃這一支)----------
//
// 使用者 2026-08-09:「零件台清掉半成品」+「我指的清理是**不要在零件台顯示,不是刪除**」。
// 「哪幾顆是半成品」MUST 是量出來的(同 `EMPTY_ASYM` 那條紀律:逐顆手挑的名冊改了幾何
// 之後沒有任何東西會提醒你它過期了)。兩個常數都是**語意**不是校準值:
//
//   ① `HOLE_PERIM_F = 1` —— 破口總周長 ÷ 節點最大跨距。1 的意思是「洞的緣比整顆節點
//      自己還長」。**MUST NOT 改成「open > 0 就算」**:§5aj-C 使用者定案「洞很小的話
//      直接貼平」⇒ 小洞是待補不是半成品。現役量測在門檻兩側有 10× 空隙(mass_a 0.29 /
//      facet_a 0.50 vs facet_b 5.01 起),不是拿兩個樣本過擬合出來的數字。
//   ② `SOLID_MIN_TRIS = 4` —— 四面體是「圍得成一個封閉體」的下界 ⇒ 三角形數少於它的
//      元件在結構上不可能是實體,只可能是碎屑(mega_e 的第二件只有 2 個三角形)。
//      **MUST NOT 改成「元件 > 1 就算」**:chimney_a 的兩件是 122 + 94(煙囪本體 + 帽)、
//      cf2_crown_a 的八件是等大的星盤層 —— 那是設計,不是撕爛。
//
// **樹族具名豁免**(§5aj-C 使用者定案「樹族 MUST 排除在貼平之外」):葉冠 / 針葉星盤 /
// 灌木叢是**開放面片的集合**,數百條邊界邊是設計。豁免 MUST 附在這裡而不是散在消費端。
export const HOLE_PERIM_F = 1;
export const SOLID_MIN_TRIS = 4;
export const OPEN_SHELL_FAMILIES = ['tree'];

/**
 * 逐節點的缺陷清單(空陣列 = 這顆是成品)。吃 `topoStats` 的輸出 —— 量測與判定分開,
 * 是為了讓對照台**只跑拓樸那一半**(鏡射殘差是 O(n²),放進 8Hz 以外的地方都嫌慢)。
 */
export function nodeFlaws(t, family) {
  if (OPEN_SHELL_FAMILIES.includes(family)) return [];
  const out = [];
  if (t.perimF >= HOLE_PERIM_F) {
    out.push({ code: 'hole', label: '破口', detail: `${t.loops} 條邊界環・周長 ${t.perimF.toFixed(1)}× 跨距` });
  }
  const debris = t.compTris.filter((n) => n < SOLID_MIN_TRIS);
  if (debris.length) {
    out.push({ code: 'debris', label: '碎屑', detail: `${debris.length} 件圍不成封閉體(${debris.join('/')} 個三角形)` });
  }
  return out;
}

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

/**
 * 拓樸那一半(③④ + 破口尺寸 + 逐元件三角形數)。**與 ①② 分開的理由**:鏡射殘差是
 * O(n²) 的暴力最近點,而對照台每次重整都要問「這顆是不是半成品」—— 那一題只吃拓樸。
 * ③④ MUST 先焊頂點(見檔頭)。
 */
export function topoStats(node) {
  const { pos, idx } = node;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], pos[i + a]); hi[a] = Math.max(hi[a], pos[i + a]); }
  }
  const span = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const S = Math.max(...span);
  const w = weld(pos, S);

  const edge = new Map();
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

  // 邊界邊 → 條數 / 總周長 / 幾條環(一個開放的底面 = 一條環;撕爛 = 很多條)
  const badj = new Map();
  let open = 0, perim = 0;
  for (const [k, c] of edge) {
    if (c !== 1) continue;
    open++;
    const [p, q] = k.split('_').map(Number);
    perim += Math.hypot(w.pos[p * 3] - w.pos[q * 3], w.pos[p * 3 + 1] - w.pos[q * 3 + 1], w.pos[p * 3 + 2] - w.pos[q * 3 + 2]);
    if (!badj.has(p)) badj.set(p, []); if (!badj.has(q)) badj.set(q, []);
    badj.get(p).push(q); badj.get(q).push(p);
  }
  const flood = (g) => {
    const cid = new Map(); let n = 0;
    for (const v of g.keys()) {
      if (cid.has(v)) continue;
      const id = n++; const st = [v]; cid.set(v, id);
      while (st.length) { const u = st.pop(); for (const x of g.get(u) || []) if (!cid.has(x)) { cid.set(x, id); st.push(x); } }
    }
    return { cid, n };
  };
  const loops = flood(badj).n;
  const { cid, n: comps } = flood(adj);
  const compTris = new Array(comps).fill(0);
  for (let t = 0; t < idx.length; t += 3) {
    const id = cid.get(w.map[idx[t]]);
    if (id != null) compTris[id]++;
  }
  compTris.sort((a, b) => b - a);

  return {
    tris: node.tris, verts: pos.length / 3, welded: w.n,
    open, loops, perimF: S > 0 ? perim / S : 0, comps, compTris,
    lo, hi, mid, span: { x: span[0], y: span[1], z: span[2] },
  };
}

/** 一顆節點的四個數(node = parseGlb 的一列) */
export function symStats(node) {
  const { pos } = node;
  const nv = pos.length / 3;
  const topo = topoStats(node);
  const { mid } = topo;
  const idx = node.idx;
  const span = [topo.span.x, topo.span.y, topo.span.z];

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

  // ③④ 拓樸走 `topoStats`(單一縫;它已經焊過頂點了)
  return {
    ...topo,
    asymX: asym[0], asymY: asym[1], asymZ: asym[2],
    symX: symRes[0], symZ: symRes[2],
  };
}

function scan(path) {
  const nodes = parseGlb(path);
  // 家族 = 檔名(與 partlib 的 `家族/節點` 命名同一條規則);`--glb` 指到任意檔也照這條讀
  const family = path.replace(/\\/g, '/').split('/').pop().replace(/\.glb$/i, '');
  const rows = [];
  for (const [name, n] of nodes) {
    const s = symStats(n);
    rows.push({ name, family, ...s, flaws: nodeFlaws(s, family) });
  }
  rows.sort((a, b) => Math.max(b.asymX, b.asymZ) - Math.max(a.asymX, a.asymZ));
  return rows;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) main();

function main() {
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

if (has('flaws')) {
  const hit = all.filter((r) => r.flaws.length);
  console.log(`\n=== 半成品(3D 零件對照台預設不顯示的那幾顆;破口周長 ≥ ${HOLE_PERIM_F}× 跨距`
    + ` 或 有元件 < ${SOLID_MIN_TRIS} 個三角形;${OPEN_SHELL_FAMILIES.join('/')} 族豁免)===`);
  for (const r of hit) {
    console.log(`  ${`${r.family}/${r.name}`.padEnd(22)} ${r.flaws.map((f) => `${f.label}:${f.detail}`).join(' ・ ')}`);
  }
  console.log(`  合計 ${hit.length} / ${all.length} 顆`);
}
}
