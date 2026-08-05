#!/usr/bin/env node
// ============ AI 零件庫入庫檢查器(runbook §4-C.3;partlib.js 檔頭「離線外廓契約」的匯出端那一半)============
//
// 驗兩件事,缺一不可:
//   ① **外廓契約**:`['lib', name, <fallback primitive>]` 的離線外廓 = fallback 的外廓
//      (audit_beacons Ⅰ 因此在 Node 端就能給保守上界)。這個等式要成立,前提是
//      **GLB 零件的實測外廓 ≤ fallback primitive 的外廓** —— 本工具逐節點量頂點驗:
//      水平徑向(XZ 離原點最遠)與縱向跨距都 MUST 收在 fallback 的包絡內。
//      違反 = 執行期 `beaconCollider` 量出來的柱可能大於規劃期預留(A30 家族)。
//   ② **三角形預算**:預算 MUST 來自量測檔 `tri_budget.json`(記錄「量的是什麼、
//      量到多少、係數為何」),MUST NOT 在本檔手寫一個好看的數字(計畫書 §2.1-6)。
//
// 描述子的真相在**消費端零件表**(beacons.js KIND_PARTS 的 `['lib', …]` 列)——
// 本工具以 `new Function` 執行 beacons.js 純區塊抽出全部 lib 描述子(㋑ 執行原文驗真品),
// 逐一對照 GLB 節點;GLB 解析為手寫最小實作(glTF 2.0 GLB:JSON chunk + BIN chunk,
// 只讀 POSITION 與 indices;A2:零 npm 依賴)。
//
// 用法:node tools/ai3d/intake_parts.mjs [--glb public/assets/models/parts/rock.glb]
//        (省略 --glb = 掃 PART_LIBS 列出的每一族)
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.log(`  ❌ ${m}`); } };

// ---- 讀消費端真品:beacons.js 純區塊 → KIND_PARTS 的 lib 描述子;partlib.js → PART_LIBS ----
const norm = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');   // 同 audit_src:CRLF 正規化
const beaconsSrc = norm(join(ROOT, 'public', 'js', 'beacons.js'));
const i0 = beaconsSrc.indexOf('export const BEACON = {');
const i1 = beaconsSrc.indexOf('// ---- 建構(以下才需要 THREE)----');
const B = new Function(`
  ${beaconsSrc.slice(i0, i1).replace(/^export /gm, '')}
  return { KIND_PARTS, partExtent };
`)();
const partlibSrc = norm(join(ROOT, 'public', 'js', 'partlib.js'));
const libsM = partlibSrc.match(/export const PART_LIBS = \[([^\]]*)\]/);
const PART_LIBS = libsM ? libsM[1].split(',').map((s) => s.trim().replace(/['"`]/g, '')).filter(Boolean) : [];

// 收集全部 lib 描述子:family → [{ name, fallback, kind }]
const libDescs = new Map();
for (const [kind, parts] of Object.entries(B.KIND_PARTS)) {
  for (const p of parts) {
    if (p.g[0] !== 'lib') continue;
    const [, name, fb] = p.g;
    const fam = name.split('/')[0];
    if (!libDescs.has(fam)) libDescs.set(fam, []);
    libDescs.get(fam).push({ name, fb, kind });
  }
}

// ---- fallback primitive 的**局部**包絡(零件自身座標系,不含位移)----
// 水平半徑 + 縱向半跨;偏差一律朝「算大」(與 partExtent 同一條紀律)。
function fbEnvelope(fb) {
  const [t, a, b, c] = fb;
  if (t === 'box') return { r: Math.hypot(a, c) / 2, hy: b / 2 };
  if (t === 'cyl') return { r: Math.max(a, b), hy: c / 2 };
  if (t === 'cone') return { r: a, hy: b / 2 };
  return { r: a, hy: a };   // ico:球
}

// ---- 手寫 GLB 解析(只讀 POSITION / indices / 節點樹)----
function parseGlb(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error('不是 GLB(magic 不符)');
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4E4F534A) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004E4942) bin = chunk;
    off += 8 + len + (len % 4 ? 4 - len % 4 : 0);
  }
  if (!json || !bin) throw new Error('GLB 缺 JSON/BIN chunk');
  const acc = (i) => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
    const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const compN = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[a.componentType];
    return new CT(bin.buffer, bin.byteOffset + start, a.count * compN);
  };
  // 節點世界變換刻意不套:partlib 取的就是節點**局部**幾何(匯出端已把原點對齊接合面)。
  const out = new Map();   // name → { pos: Float32Array, tris: number }
  for (const node of json.nodes || []) {
    if (node.mesh == null || !node.name) continue;
    const mesh = json.meshes[node.mesh];
    let tris = 0; const posArrs = [];
    for (const prim of mesh.primitives) {
      const pos = acc(prim.attributes.POSITION);
      posArrs.push(pos);
      tris += (prim.indices != null ? json.accessors[prim.indices].count : pos.length / 3) / 3;
    }
    const total = posArrs.reduce((s, a) => s + a.length, 0);
    const pos = new Float32Array(total);
    let o = 0; for (const a of posArrs) { pos.set(a, o); o += a.length; }
    out.set(node.name, { pos, tris });
  }
  return out;
}

// ---- 三角形預算(量測檔;手寫數字不算數)----
const budgetPath = join(HERE, 'tri_budget.json');
const budget = existsSync(budgetPath) ? JSON.parse(readFileSync(budgetPath, 'utf8')) : null;

// ---- 主流程 ----
const argv = process.argv.slice(2);
const gi = argv.indexOf('--glb');
const targets = gi >= 0 ? [argv[gi + 1]] : PART_LIBS.map((f) => join(ROOT, 'public', 'assets', 'models', 'parts', `${f}.glb`));

console.log(`消費端 lib 描述子:${[...libDescs.values()].flat().length} 筆(${[...libDescs.keys()].join(', ') || '無'});PART_LIBS = [${PART_LIBS.join(', ') || '空'}]`);
if (!targets.length || targets.every((t) => !t)) { console.log('沒有要驗的 GLB(PART_LIBS 為空且未給 --glb)'); process.exit(0); }

for (const glbPath of targets) {
  const fam = glbPath.replace(/\\/g, '/').split('/').pop().replace('.glb', '');
  console.log(`\n== ${fam} ← ${glbPath}`);
  if (!existsSync(glbPath)) { ok(false, `GLB 存在(${glbPath})`); continue; }
  let nodes;
  try { nodes = parseGlb(glbPath); } catch (e) { ok(false, `GLB 可解析:${e.message}`); continue; }
  ok(nodes.size > 0, `具名 mesh 節點 ${nodes.size} 個(${[...nodes.keys()].join(', ')})`);
  const descs = libDescs.get(fam) || [];
  ok(descs.length > 0, `消費端有引用這一族的 lib 描述子(${descs.length} 筆)`);
  for (const { name, fb, kind } of descs) {
    const node = nodes.get(name.split('/').slice(1).join('/'));
    if (!node) { ok(false, `${kind}:${name} 在 GLB 裡有對應節點(缺 = 執行期整件走 fallback)`); continue; }
    // ① 外廓契約:實測 ≤ fallback 包絡(水平徑向 + 縱向兩端)
    const env = fbEnvelope(fb);
    let rMax = 0, yMin = Infinity, yMax = -Infinity;
    for (let i = 0; i < node.pos.length; i += 3) {
      rMax = Math.max(rMax, Math.hypot(node.pos[i], node.pos[i + 2]));
      yMin = Math.min(yMin, node.pos[i + 1]); yMax = Math.max(yMax, node.pos[i + 1]);
    }
    ok(rMax <= env.r + 1e-6, `${name}:水平徑向 ${rMax.toFixed(3)} ≤ fallback ${env.r.toFixed(3)}(${JSON.stringify(fb)})`);
    ok(yMax <= env.hy + 1e-6 && yMin >= -env.hy - 1e-6, `${name}:縱向 [${yMin.toFixed(2)}, ${yMax.toFixed(2)}] 收在 ±${env.hy.toFixed(2)} 內`);
    // 虛胖檢查(與 audit_beacons「foot 沒有虛胖」同方向):GLB 遠小於 fallback ⇒ 上界失真
    ok(rMax >= env.r * 0.5, `${name}:fallback 沒有虛胖(實測佔 ${(rMax / env.r * 100).toFixed(0)}%)`);
    // ② 三角形預算(推導自量測檔)
    if (!budget) ok(false, `${name}:tri_budget.json 存在(預算 MUST 量測,不准手寫)`);
    else {
      const cap = Math.round(budget.measured_max_tris * budget.factor);
      ok(node.tris <= cap, `${name}:三角形 ${node.tris} ≤ 預算 ${cap}(${budget.measured_what} 實測 ${budget.measured_max_tris} × ${budget.factor})`);
    }
  }
}

console.log(`\n${fail ? '❌' : '✅'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail ? 1 : 0);
