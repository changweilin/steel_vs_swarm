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
export const biomesSrc = () => readSrc('public', 'js', 'biomes.js');

/** 由 `const NAME = {` 起,以括號配對取回整個區塊(不靠行數,零件表加減行不會漂) */
function blockOf(src, name) {
  const i = src.indexOf(`const ${name} = {`);
  if (i < 0) throw new Error(`biomes.js 找不到 ${name}`);
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error(`${name} 的括號沒有收尾`);
}

/**
 * biomes 的植被/神木零件表裡的 `lib:` 列(第二個消費端;beacons 走 `['lib', …]` 描述子,
 * 這邊是 `{ g: ico(5), lib: 'tree/canopy_a5' }` —— **保險絲仍是 `g`**,只是形式不同)。
 *
 * 做法:執行 `VEG_DEFS`/`GIANT_DEFS` 原文,但把 `cyl/cone/ico` 換成**回傳描述子陣列**的樁,
 * 於是 `p.g` 就與 beacons 的 fallback primitive 同一套字彙 ⇒ `fbEnvelope` 一份實作兩邊同吃
 * (抄第二份包絡公式 = 兩個消費端對同一顆樹冠給出兩種上界)。Node 端沒有 three(A2)。
 *
 * `srcLibCount` 是**原文裡 `lib:` 的總數**:可執行的只有上面兩張表,若有人把 lib 列加進
 * `GIANT_DECO`(它直接用 THREE.TorusGeometry,樁餵不進去)或別處,兩個數字就對不上 ——
 * 入庫閘據此紅字,MUST NOT 靜默跳過(那等於那一列從來沒被驗過)。
 */
export function bioLibDescs(src = biomesSrc()) {
  const stub = `
    const cyl = (r1, r2, h, n = 5) => ['cyl', r1, r2, h, n];
    const cone = (r, h, n = 5) => ['cone', r, h, n];
    const ico = (r) => ['ico', r];
  `;
  const { VEG_DEFS, GIANT_DEFS } = new Function(
    `${stub}\n${blockOf(src, 'VEG_DEFS')};\n${blockOf(src, 'GIANT_DEFS')};\nreturn { VEG_DEFS, GIANT_DEFS };`,
  )();
  const out = [];
  for (const [table, defs] of [['VEG_DEFS', VEG_DEFS], ['GIANT_DEFS', GIANT_DEFS]]) {
    for (const [kind, def] of Object.entries(defs)) {
      def.parts.forEach((p, index) => {
        if (!p.lib) return;
        out.push({
          name: p.lib, family: p.lib.split('/')[0], node: p.lib.split('/').slice(1).join('/'),
          fb: p.g, kind, index, table, consumer: 'biomes',
          // 預算依**消費角色**不依 GLB 家族(同 megalith 那一列的理由):神木一張圖幾十株、
          // 一般植被上萬株,同一支 tree.glb 裡的節點按誰在用它決定上限。
          //   GIANT_DEFS → families.tree(單件 ≤ 最重整株 + 逐株 kind_factor)
          //   VEG_DEFS   → families.veg(InstancedMesh 逐列反推的 node_cap)
          budgetFam: table === 'VEG_DEFS' ? 'veg' : 'tree',
          p: [p.px || 0, p.y || 0, p.pz || 0],
        });
      });
      // 整樹節點(def.whole;§5u,2026-08-08 起是**一列以上**的陣列 —— 木質 / 葉冠分列,
      // 理由見 biomes.js buildVegMeshes)。lib 全載到 ⇒ 整型只畫這幾顆,佈局仍讀 parts。
      // fb = whole[i].g = 入庫包絡與世界尺度(不是 fallback 渲染 —— 載不到時渲染的是 parts)。
      (def.whole || []).forEach((w, wi) => {
        if (!w.lib) return;
        out.push({
          name: w.lib, family: w.lib.split('/')[0], node: w.lib.split('/').slice(1).join('/'),
          fb: w.g, kind, index: def.parts.length + wi, table, consumer: 'biomes',
          budgetFam: table === 'VEG_DEFS' ? 'veg' : 'tree',
          // `whole: true` = 這一列取代的是**整株**(不是一個零件)⇒ 預算的基準是該型現值
          // `kind_tris`,不是單件的 20;逐件上限對它沒有語意(一株樹當然比一顆葉團大)。
          whole: true,
          p: [w.px || 0, w.y || 0, w.pz || 0],
        });
      });
    }
  }
  // 計數 MUST 先剝行註解(㋑):檔頭與零件表的說明裡就寫著 `lib: '家族/節點'` 這種範例,
  // 算進去的話這道閘從第一天就紅字,而紅字的理由與「有 lib 列驗不到」完全無關
  const bare = src.replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\/\/[^\n]*$/gm, '');
  return { rows: out, srcLibCount: (bare.match(/\blib:\s*'/g) || []).length, GIANT_DEFS, VEG_DEFS };
}

/**
 * 巨岩零件庫名冊(第三個消費端;`biomes.js MEGA_LIB` —— 命令式建造端 synthMegalith/
 * decorateMegalith 的呼叫點守衛)。契約:**單位包絡** = fallback `['ico', 1]`(水平徑向 ≤1、
 * 縱向 ±1),呼叫端以 mesh.scale 拉尺寸 ⇒ 入庫閘照一般規則驗,只是包絡恆為單位球。
 * 預算走 `families.megalith`(一顆巨岩最多 29 件庫零件 ⇒ 逐件上限比 rock 族緊得多)。
 */
export function megaLibDescs(src = biomesSrc()) {
  const MEGA_LIB = new Function(`${blockOf(src, 'MEGA_LIB')}; return MEGA_LIB;`)();
  const names = Object.values(MEGA_LIB).flat().filter(Boolean);
  return {
    MEGA_LIB,
    rows: names.map((name) => ({
      name, family: name.split('/')[0], node: name.split('/').slice(1).join('/'),
      fb: ['ico', 1], kind: 'megalith', index: 0, table: 'MEGA_LIB',
      consumer: 'biomes-mega', budgetFam: 'megalith', p: [0, 0, 0],
    })),
  };
}

/**
 * 建物配件零件庫名冊(第四個消費端;`biomes.js BLD_LIB` —— 屋頂配件 InstancedMesh 桶的
 * 呼叫點守衛)。契約:**單位包絡** —— 桶的 instance scale 就是尺寸,fallback = 該桶現行的
 * 單位 primitive(box(1,1,1) / cyl(1,1,1));一顆節點的幾何被全桶 instance 共用 ⇒ 預算走
 * `families.building` 的**逐桶節點上限**(node_caps:由「配件桶總量 × whole_factor ÷
 * 名冊桶數 ÷ 該桶實測最大 instance 數」推導 —— 逐件看毫無意義,GPU 成本 = 節點 tris × instance 數)。
 */
export function bldLibDescs(src = biomesSrc()) {
  const BLD_LIB = new Function(`${blockOf(src, 'BLD_LIB')}; return BLD_LIB;`)();
  return {
    BLD_LIB,
    // 名冊值的第一格可以是**字串或陣列**(2026-08-08 佇列 F:整棟量體 `mass` 是輪替名冊 ——
    // 一款打天下的話同一條天際線會出現十幾棟一樣的剪影)。攤平時 MUST 保留 `index`:
    // 同一桶的每一顆節點共用同一個 node_cap,但缺件/孤兒/來源帳是逐顆的。
    rows: Object.entries(BLD_LIB).flatMap(([key, [name, fb]]) =>
      (Array.isArray(name) ? name : [name]).map((n, index) => ({
        name: n, family: n.split('/')[0], node: n.split('/').slice(1).join('/'),
        fb, kind: key, index, table: 'BLD_LIB',
        consumer: 'biomes-bld', budgetFam: 'building', p: [0, 0, 0],
      }))),
  };
}

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
 * 手寫最小 GLB 解析(glTF 2.0:JSON chunk + BIN chunk;讀 POSITION、indices、TEXCOORD_0)。
 * 節點世界變換刻意不套:partlib 取的就是節點**局部**幾何(匯出端已把原點對齊接合語意)。
 * UV 只有整棟量體那一桶有(`--boxuv` / `--roofband`),沒有的節點回 `uv: null`
 * —— 消費端 MUST 自己判空,MUST NOT 拿零長度陣列冒充「有 UV 但全是 0」。
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
  const out = new Map();   // name → { pos: Float32Array, idx: Uint32Array, uv: Float32Array|null, tris: number }
  for (const node of json.nodes || []) {
    if (node.mesh == null || !node.name) continue;
    const mesh = json.meshes[node.mesh];
    let tris = 0; const posArrs = [], idxArrs = [], uvArrs = [];
    for (const prim of mesh.primitives) {
      const pos = acc(prim.attributes.POSITION);
      uvArrs.push(prim.attributes.TEXCOORD_0 != null ? acc(prim.attributes.TEXCOORD_0) : null);
      // 多 primitive 時頂點是串接的 ⇒ 索引 MUST 加上前面幾段的頂點數(不加 = 第二段
      // 的三角形全部指回第一段 = 面積/連通量出來是另一顆網格,而且不會報錯)
      const base = posArrs.reduce((s, a) => s + a.length / 3, 0);
      const src = prim.indices != null ? acc(prim.indices) : null;
      const n = src ? src.length : pos.length / 3;
      const ix = new Uint32Array(n);
      for (let k = 0; k < n; k++) ix[k] = (src ? src[k] : k) + base;
      posArrs.push(pos); idxArrs.push(ix);
      tris += n / 3;
    }
    const total = posArrs.reduce((s, a) => s + a.length, 0);
    const pos = new Float32Array(total);
    let o = 0; for (const a of posArrs) { pos.set(a, o); o += a.length; }
    const idx = new Uint32Array(idxArrs.reduce((s, a) => s + a.length, 0));
    o = 0; for (const a of idxArrs) { idx.set(a, o); o += a.length; }
    // UV 與頂點同序(串接同一份 base 位移)；只要有一段沒有 TEXCOORD_0 就整顆算沒有 UV
    // —— 半份 UV 拼出來的陣列會讓消費端拿到「對得起來的長度、對不起來的值」
    let uv = null;
    if (uvArrs.every((a) => a)) {
      uv = new Float32Array(uvArrs.reduce((s, a) => s + a.length, 0));
      o = 0; for (const a of uvArrs) { uv.set(a, o); o += a.length; }
    }
    out.set(node.name, { pos, idx, uv, tris });
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

/**
 * 逐節點量 **UV 的方向與屋頂帶**(整棟量體那一桶的節點契約;入庫閘的唯一取數處)。
 * 回傳 `null` = 這顆沒有 UV。量的是**消費端座標**:GLB 存的值就是 three 取樣用的 v,
 * 而消費端那張 `CanvasTexture` 的 `flipY` 是預設的 true ⇒ v=0 採到畫布底部。
 *   `corr`     牆面(近垂直)頂點的 corr(高度, v) —— MUST > 0,否則立面是**上下顛倒**的
 *              (基座暗帶印在屋簷)。這件事沒有任何錯誤訊息,只有貼圖排面看得出來。
 *   `upMaxV`   朝上面(n.y > minz)的 v 上界 —— 屋頂帶在 [0, frac] ⇒ MUST ≤ frac
 *   `wallMinV` 近垂直面的 v 下界 —— MUST ≥ frac(牆不准踩進屋頂帶)
 *   `parity`   朝上面積 ÷(朝上 + 側面)= 兩帶 texel 密度相同時的 frac(`roof_band` 的推導式)
 */
export function uvBandStats(node, minz = 0.30) {
  const { pos, idx, uv } = node;
  if (!uv) return null;
  let upA = 0, sideA = 0, upMaxV = 0, wallMinV = 1;
  const ys = [], vs = [];
  for (let i = 0; i < idx.length; i += 3) {
    const A = idx[i], B = idx[i + 1], C = idx[i + 2];
    const a = A * 3, b = B * 3, c = C * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz);
    if (!L) continue;
    const up = ny / L, area = L / 2;
    const vv = [uv[A * 2 + 1], uv[B * 2 + 1], uv[C * 2 + 1]];
    if (up > minz) { upA += area; upMaxV = Math.max(upMaxV, ...vv); continue; }
    if (Math.abs(up) <= minz) sideA += area;
    // 「牆」取近垂直的那一群(±0.15):斜的過渡面兩邊都不算,免得把屋簷底當成牆
    if (Math.abs(up) < 0.15) {
      wallMinV = Math.min(wallMinV, ...vv);
      for (const V of [A, B, C]) { ys.push(pos[V * 3 + 1]); vs.push(uv[V * 2 + 1]); }
    }
  }
  let corr = 0;
  if (ys.length > 2) {
    const n = ys.length, my = ys.reduce((s, x) => s + x, 0) / n, mv = vs.reduce((s, x) => s + x, 0) / n;
    let sxy = 0, sxx = 0, svv = 0;
    for (let i = 0; i < n; i++) { const dx = ys[i] - my, dv = vs[i] - mv; sxy += dx * dv; sxx += dx * dx; svv += dv * dv; }
    corr = sxx && svv ? sxy / Math.sqrt(sxx * svv) : 0;
  }
  return { corr, upMaxV, wallMinV, upA, sideA, parity: upA / Math.max(upA + sideA, 1e-9) };
}

export const glbPath = (family) => join(ROOT, 'public', 'assets', 'models', 'parts', `${family}.glb`);

/**
 * 三角形預算(量測檔;手寫數字不算數 —— 計畫書 §2.1-6)。
 * 頂層 = 預設(rock 族沿用);`families.<fam>` 有的話那一族改吃自己那份量測
 * —— 一顆巨岩與一株神木不是同一個量級,共用一個數字必然是「對其中一邊太鬆」。
 * `kindCap` 是**逐件之外的第二道**:單件合格不代表整株合格(見 tree 族 justification)。
 */
export function triBudget() {
  const p = join(ROOT, 'tools', 'ai3d', 'tri_budget.json');
  if (!existsSync(p)) return null;
  const b = JSON.parse(readFileSync(p, 'utf8'));
  const famOf = (fam) => (fam && b.families?.[fam]) || b;
  return {
    ...b,
    cap: Math.round(b.measured_max_tris * b.factor),
    capOf: (fam) => { const f = famOf(fam); return Math.round(f.measured_max_tris * f.factor); },
    whatOf: (fam) => famOf(fam).measured_what,
    /** 該族「逐株(逐款)」的庫零件三角形上限;沒有這一族的量測就回 null(= 沒有這道閘) */
    kindCap: (fam, kind) => {
      const f = b.families?.[fam];
      const cur = f?.kind_tris?.[kind];
      return cur == null || f.kind_factor == null ? null : { cur, cap: Math.round(cur * f.kind_factor) };
    },
    /**
     * 逐桶節點上限(InstancedMesh 消費端專用;building / veg 族):一顆節點被全桶 instance
     * 共用,逐件上限要由實測 instance 數反推。兩種寫法,取哪一種由該族的幾何學決定:
     *   `node_caps[kind]` = 逐桶各有一個上限(building:三個桶的 instance 數同量級,
     *                       故均分「總額度」再各自除以自己的 instance 數)
     *   `node_cap`        = 全族一個上限(veg:名冊列均分「成長額度」⇒ 推導出來就是單一值;
     *                       逐型再寫一次只是同一個數字抄 N 遍,而抄本會漂)
     *   `families[fam][kind].node_cap` = 該桶**自己有一整塊推導區**時住在自己那一塊
     *                       (building 的 `mass`:整棟量體不與屋頂配件共分額度,額度來自
     *                        它自己換掉的那一桶 ⇒ 量測/推導/staleness 收在同一個物件裡,
     *                        MUST NOT 為了讓查表方便再把數字抄一份進 `node_caps`)
     * 三者都沒有就回 null(intake 退回 capOf)。
     */
    nodeCap: (fam, kind) => b.families?.[fam]?.node_caps?.[kind]
      ?? b.families?.[fam]?.[kind]?.node_cap ?? b.families?.[fam]?.node_cap ?? null,
  };
}
