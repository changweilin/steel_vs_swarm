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
// 描述子的真相在**消費端零件表**,而消費端現在有兩個(形式不同、保險絲語意相同):
//   - `beacons.js KIND_PARTS` 的 `['lib', name, <fallback primitive>]` 列(地標)
//   - `biomes.js VEG_DEFS/GIANT_DEFS` 的 `{ g: ico(5), lib: 'tree/canopy_a5' }` 列(植被/神木)
// 讀原文、執行純區塊、解析 GLB、算 fallback 包絡這四件事全部住 `parts_src.mjs`(單一縫:
// 3D 對照台問的是一模一樣的四個問題,各抄一份 = 入庫閘與對照台對同一顆石頭給出兩種外廓)。
//
// 用法:node tools/ai3d/intake_parts.mjs [--glb public/assets/models/parts/rock.glb]
//        (省略 --glb = 掃 PART_LIBS 列出的每一族)
import { existsSync } from 'node:fs';
import {
  beaconsPure, beaconsSrc, partLibs, libDescs as collectLibDescs, bioLibDescs, megaLibDescs, bldLibDescs,
  fbEnvelope, parseGlb, nodeExtent, glbPath, triBudget,
} from './parts_src.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.log(`  ❌ ${m}`); } };

// ---- 讀兩個消費端真品 + partlib.js 的 PART_LIBS ----
const B = beaconsPure(beaconsSrc());
const PART_LIBS = partLibs();
const bio = bioLibDescs();
const mega = megaLibDescs();
const bld = bldLibDescs();

// family → [{ name, fb, kind, … }]
const libDescs = new Map();
const all = [...collectLibDescs(B.KIND_PARTS).map((d) => ({ ...d, consumer: 'beacons' })), ...bio.rows, ...mega.rows, ...bld.rows];
for (const d of all) {
  if (!libDescs.has(d.family)) libDescs.set(d.family, []);
  libDescs.get(d.family).push(d);
}

const budget = triBudget();

// biomes 原文裡的 `lib:` 筆數 MUST 與可執行零件表解析到的相同 —— 對不上代表有 lib 列住在
// 樁餵不進去的表(如 GIANT_DECO 直接用 THREE.TorusGeometry)⇒ 那一列從來沒被驗過(不准靜默跳過)
ok(bio.rows.length === bio.srcLibCount,
  `biomes 的 lib 列全部驗得到(原文 ${bio.srcLibCount} 筆,可執行零件表解析 ${bio.rows.length} 筆)`);

// ---- 主流程 ----
const argv = process.argv.slice(2);
const gi = argv.indexOf('--glb');
const targets = gi >= 0 ? [argv[gi + 1]] : PART_LIBS.map((f) => glbPath(f));

console.log(`消費端 lib 描述子:${[...libDescs.values()].flat().length} 筆(${[...libDescs.keys()].join(', ') || '無'});PART_LIBS = [${PART_LIBS.join(', ') || '空'}]`);
if (!targets.length || targets.every((t) => !t)) { console.log('沒有要驗的 GLB(PART_LIBS 為空且未給 --glb)'); process.exit(0); }

for (const gp of targets) {
  const fam = gp.replace(/\\/g, '/').split('/').pop().replace('.glb', '');
  console.log(`\n== ${fam} ← ${gp}`);
  if (!existsSync(gp)) { ok(false, `GLB 存在(${gp})`); continue; }
  let nodes;
  try { nodes = parseGlb(gp); } catch (e) { ok(false, `GLB 可解析:${e.message}`); continue; }
  ok(nodes.size > 0, `具名 mesh 節點 ${nodes.size} 個(${[...nodes.keys()].join(', ')})`);
  const descs = libDescs.get(fam) || [];
  ok(descs.length > 0, `消費端有引用這一族的 lib 描述子(${descs.length} 筆)`);
  const perKind = new Map();   // kind → Σ 庫零件三角形(逐株閘用)
  const seen = new Set();
  for (const { name, fb, kind, consumer, budgetFam } of descs) {
    // 逐件預算依**消費角色**取(巨岩塊走 families.megalith:一顆巨岩最多 14 件庫零件,
    // 上限比同一支 GLB 裡的 beacons 疊石緊得多 —— 族相同、角色不同、預算不同)。
    // InstancedMesh 消費端(building 桶)另有**逐桶**節點上限:一顆節點被全桶共用,
    // 上限由該桶實測最大 instance 數反推(nodeCap),有這一份就以它為準。
    const cap = budget?.nodeCap(budgetFam || fam, kind) ?? budget?.capOf(budgetFam || fam);
    const node = nodes.get(name.split('/').slice(1).join('/'));
    if (!node) { ok(false, `${kind}:${name} 在 GLB 裡有對應節點(缺 = 執行期整件走 fallback)`); continue; }
    perKind.set(kind, (perKind.get(kind) || 0) + node.tris);
    // ① 外廓契約:實測 ≤ fallback 包絡(水平徑向 + 縱向兩端)。同一個節點被多列共用時,
    //    每一列都要各自驗 —— 包絡是**那一列的** fallback,不是節點的屬性(小 ico 那列才是緊的那個)
    const env = fbEnvelope(fb);
    const { rMax, yMin, yMax } = nodeExtent(node);
    const tag = `${name} ← ${consumer}:${kind}`;
    ok(rMax <= env.r + 1e-6, `${tag}:水平徑向 ${rMax.toFixed(3)} ≤ fallback ${env.r.toFixed(3)}(${JSON.stringify(fb)})`);
    ok(yMax <= env.hy + 1e-6 && yMin >= -env.hy - 1e-6, `${tag}:縱向 [${yMin.toFixed(2)}, ${yMax.toFixed(2)}] 收在 ±${env.hy.toFixed(2)} 內`);
    // 虛胖檢查(與 audit_beacons「foot 沒有虛胖」同方向):GLB 遠小於 fallback ⇒ 上界失真
    ok(rMax >= env.r * 0.5, `${tag}:fallback 沒有虛胖(實測佔 ${(rMax / env.r * 100).toFixed(0)}%)`);
    // ② 三角形預算(推導自量測檔;逐件)—— 同一個節點只報一次
    if (!budget) ok(false, `${name}:tri_budget.json 存在(預算 MUST 量測,不准手寫)`);
    else if (!seen.has(name)) {
      seen.add(name);
      ok(node.tris <= cap, `${name}:三角形 ${node.tris} ≤ 單件預算 ${cap}(${budget.whatOf(budgetFam || fam)})`);
    }
  }
  // ③ 逐株(逐款)閘:單件合格 ≠ 整株合格 —— 一株神木十幾件,全換掉每一件都「合格」卻是 20 倍
  for (const [kind, tris] of perKind) {
    const k = budget?.kindCap(fam, kind);
    if (!k) continue;
    ok(tris <= k.cap, `${kind}:庫零件合計 ${tris} tris ≤ 逐株預算 ${k.cap}(現值 ${k.cur} × ${budget.families[fam].kind_factor})`);
  }
}

console.log(`\n${fail ? '❌' : '✅'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail ? 1 : 0);
