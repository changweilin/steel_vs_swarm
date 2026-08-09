#!/usr/bin/env node
// ============ SF3D 產出的「實心度」快篩(挑選流程的統計前置)============
//
// §5c/§5e 的量測結論:CC0 語料過 SF3D 的可用率 ~1/15,病灶是**薄殼/碎片**(博物館掃描、
// 場景照裁切)。薄殼在 contact sheet 上要人眼逐顆看;但它有一個便宜的統計特徵 ——
// **封閉網格的有號體積 ÷ 包圍盒體積**:實心塊 ≥ ~0.25,薄殼/碎片趨近 0(或因翻面呈負)。
// 這一支對每個 mesh.glb 算三個數:體積比、三角形數、長寬比(r/hy),把「顯然是殼」的
// 淘汰掉,只留候選給人眼(或直接依排名取用)。**它是前篩不是驗收** —— 入庫仍走
// intake_parts 的外廓/預算閘 + 對照台人眼。
//
// 用法:node tools/ai3d/mesh_stats.mjs <dir>   # 掃 <dir>/**/mesh.glb(SF3D 逐圖子目錄)
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseGlb } from './parts_src.mjs';
import { readFileSync } from 'node:fs';

const dir = process.argv[2];
if (!dir) { console.error('用法:node tools/ai3d/mesh_stats.mjs <sf3d 輸出目錄>'); process.exit(1); }

// parseGlb 只回 POSITION + tris;體積要 indices ⇒ 這裡自己解一次(同一支手寫解析器的
// 延伸;仍零 npm 依賴)。
function meshVolume(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) return null;
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len + (len % 4 ? 4 - len % 4 : 0);
  }
  const acc = (i) => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
    const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const compN = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const CT = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[a.componentType];
    return new CT(bin.buffer, bin.byteOffset + start, a.count * compN);
  };
  let vol = 0, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives) {
      const pos = acc(prim.attributes.POSITION);
      for (let i = 0; i < pos.length; i += 3) {
        minX = Math.min(minX, pos[i]); maxX = Math.max(maxX, pos[i]);
        minY = Math.min(minY, pos[i + 1]); maxY = Math.max(maxY, pos[i + 1]);
        minZ = Math.min(minZ, pos[i + 2]); maxZ = Math.max(maxZ, pos[i + 2]);
      }
      if (prim.indices == null) continue;
      const idx = acc(prim.indices);
      for (let i = 0; i < idx.length; i += 3) {
        const a3 = idx[i] * 3, b3 = idx[i + 1] * 3, c3 = idx[i + 2] * 3;
        // 有號四面體體積(對原點);封閉網格加總 = 真體積
        vol += (pos[a3] * (pos[b3 + 1] * pos[c3 + 2] - pos[b3 + 2] * pos[c3 + 1])
              - pos[a3 + 1] * (pos[b3] * pos[c3 + 2] - pos[b3 + 2] * pos[c3])
              + pos[a3 + 2] * (pos[b3] * pos[c3 + 1] - pos[b3 + 1] * pos[c3])) / 6;
      }
    }
  }
  const bbox = (maxX - minX) * (maxY - minY) * (maxZ - minZ);
  return { vol: Math.abs(vol), bbox, fill: bbox > 0 ? Math.abs(vol) / bbox : 0,
           w: maxX - minX, h: maxY - minY, d: maxZ - minZ };
}

// **兩種版面都要吃**:SF3D 是逐圖子目錄 `<i>/mesh.glb`,T2-spz 是**扁平** `<名字>.glb`。
// 只認前者的話,建築那一族(2026-08-10 起走 T2)在這支眼裡永遠是空的 —— 而空的輸出與
// 「這一批都很好」印出來一模一樣(表頭照印、一列都沒有),沒有任何錯誤訊息。
const entries = [];
for (const sub of readdirSync(dir)) {
  if (sub.toLowerCase().endsWith('.glb')) { entries.push([sub.slice(0, -4), join(dir, sub)]); continue; }
  entries.push([sub, join(dir, sub, 'mesh.glb')]);
}
const rows = [];
for (const [sub, p] of entries) {
  try { statSync(p); } catch { continue; }
  const v = meshVolume(p);
  if (!v) continue;
  const nodes = parseGlb(p);
  const tris = [...nodes.values()].reduce((s, n) => s + n.tris, 0);
  // 長寬比:水平最大跨 ÷ 縱向跨(塊狀 ≈ 0.8~1.6;柱/板會偏離)
  const aspect = Math.max(v.w, v.d) / Math.max(1e-6, v.h);
  rows.push({ sub, tris, fill: v.fill, aspect });
}
rows.sort((a, b) => b.fill - a.fill);
console.log('name'.padEnd(46), 'tris', 'fill', 'aspect', ' 判讀');
for (const r of rows) {
  const verdict = r.fill >= 0.22 ? (r.aspect >= 0.6 && r.aspect <= 2.2 ? '塊狀候選 ◎' : '實心但比例偏(柱/板)')
    : r.fill >= 0.1 ? '偏薄' : '殼/碎片 ✗';
  console.log(r.sub.padEnd(46), String(r.tris).padStart(4), r.fill.toFixed(3), r.aspect.toFixed(2), ' ' + verdict);
}
