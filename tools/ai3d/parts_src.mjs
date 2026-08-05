// ============ AI 零件庫的「消費端真相」讀取縫(入庫檢查 + 3D 對照台共用)============
//
// 這一支回答四個問題,每一個都**只准有一份答案**:
//   ① 消費端引用了哪些 `['lib', name, <fallback primitive>]` 描述子?(執行 beacons.js 純區塊原文)
//   ② `PART_LIBS` 有哪幾族?(讀 partlib.js 原文)
//   ③ fallback primitive 的局部包絡是多少?(`fbEnvelope`)
//   ④ 一支 GLB 裡有哪些具名節點、各自的頂點與三角形數?(`parseGlb`,手寫最小 glTF 解析)
//
// **為什麼要抽出來**:2026-08-05 這四件事只住 `intake_parts.mjs`(入庫閘)。3D 對照台要問
// 一模一樣的四個問題 —— 各抄一份的下場是「入庫閘說外廓合格、對照台畫出另一個外廓」,
// 而兩邊都不會報錯(CLAUDE.md 原則 2:第二份實作即是 bug)。
//
// 原文一律走 `audit_src.readSrc`(㋑):這個工作區是 CRLF 檢出,自己 `readFileSync` 的話
// 逐行剝註解與 `split('\n')` 會靜默失效。
//
// `beaconsPure(src)` 刻意吃**傳進來的原文**而不是自己讀檔 —— 對照台要拿同一支解析器去跑
// `git show <rev>:public/js/beacons.js` 的舊版零件表(「改寫前長什麼樣」),那份原文不在工作區裡。
// A2:零 npm 依賴。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readSrc } from '../audit_src.mjs';

/** beacons.js 的純區塊邊界(THREE 以上那一段)—— 兩個消費端同吃,MUST NOT 各寫一份字串 */
export const PURE_HEAD = 'export const BEACON = {';
export const PURE_TAIL = '// ---- 建構(以下才需要 THREE)----';

/** 執行 beacons.js 純區塊原文,取回零件表與外廓函式(㋑ 驗真品,不抄公式) */
export function beaconsPure(src) {
  const i0 = src.indexOf(PURE_HEAD);
  const i1 = src.indexOf(PURE_TAIL);
  if (i0 < 0 || i1 < 0) throw new Error('beacons.js 純區塊的邊界標記找不到(檔案結構變了?)');
  return new Function(`
    ${src.slice(i0, i1).replace(/^export /gm, '')}
    return { BEACON, BEACON_KINDS, KIND_PARTS, partExtent, kindExtent };
  `)();
}

export const beaconsSrc = () => readSrc('public', 'js', 'beacons.js');

/** `PART_LIBS = [...]`(partlib.js 是唯一真相;這裡只是把它從原文讀出來給 Node 端用) */
export function partLibs(src = readSrc('public', 'js', 'partlib.js')) {
  const m = src.match(/export const PART_LIBS = \[([^\]]*)\]/);
  return m ? m[1].split(',').map((s) => s.trim().replace(/['"`]/g, '')).filter(Boolean) : [];
}

/**
 * 收集全部 lib 描述子。回傳逐筆 `{ name, family, node, fb, kind, index }`
 * (`kind` = 消費端那一款地標,`index` = 它在該款零件表裡的第幾件)。
 */
export function libDescs(KIND_PARTS) {
  const out = [];
  for (const [kind, parts] of Object.entries(KIND_PARTS)) {
    parts.forEach((p, index) => {
      if (p.g?.[0] !== 'lib') return;
      const [, name, fb] = p.g;
      out.push({ name, family: name.split('/')[0], node: name.split('/').slice(1).join('/'), fb, kind, index, p: p.p || [] });
    });
  }
  return out;
}

/**
 * fallback primitive 的**局部**包絡(零件自身座標系,不含位移):水平半徑 + 縱向半跨。
 * 偏差一律朝「算大」(與 `beacons.partExtent` 同一條紀律)。
 */
export function fbEnvelope(fb) {
  const [t, a, b, c] = fb;
  if (t === 'box') return { r: Math.hypot(a, c) / 2, hy: b / 2 };
  if (t === 'cyl') return { r: Math.max(a, b), hy: c / 2 };
  if (t === 'cone') return { r: a, hy: b / 2 };
  return { r: a, hy: a };   // ico:球
}

/**
 * 手寫最小 GLB 解析(glTF 2.0:JSON chunk + BIN chunk;只讀 POSITION 與 indices)。
 * 節點世界變換刻意不套:partlib 取的就是節點**局部**幾何(匯出端已把原點對齊接合語意)。
 */
export function parseGlb(path) {
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

/** 逐節點量外廓:水平徑向最遠點 + 縱向兩端(入庫閘與對照台同一把尺) */
export function nodeExtent(node) {
  let rMax = 0, yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < node.pos.length; i += 3) {
    rMax = Math.max(rMax, Math.hypot(node.pos[i], node.pos[i + 2]));
    yMin = Math.min(yMin, node.pos[i + 1]);
    yMax = Math.max(yMax, node.pos[i + 1]);
  }
  return { rMax, yMin, yMax, verts: node.pos.length / 3, tris: node.tris };
}

export const glbPath = (family) => join(ROOT, 'public', 'assets', 'models', 'parts', `${family}.glb`);

/** 三角形預算(量測檔;手寫數字不算數 —— 計畫書 §2.1-6) */
export function triBudget() {
  const p = join(ROOT, 'tools', 'ai3d', 'tri_budget.json');
  if (!existsSync(p)) return null;
  const b = JSON.parse(readFileSync(p, 'utf8'));
  return { ...b, cap: Math.round(b.measured_max_tris * b.factor) };
}
