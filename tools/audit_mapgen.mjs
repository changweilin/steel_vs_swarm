// ============ 擴充地圖生成稽核:混合地圖 / 隨機地圖 ============
// 斷言:
//   Ⅰ mix 夾限唯一縫:水域+沼澤 ≤ 50%、總和恆 1、null 安全、加權混合正確。
//   Ⅱ 確定性:同輸入逐位元同輸出(跨端同一張圖的前提);不同種子不同構。
//   Ⅲ 非現實:隨機地圖中心 ≠ 任一錨點、帶程序化起伏(與現實地圖不同構)。
//   Ⅳ 幾何合規:生成兵線過 towerLayoutAudit + laneSeparationAudit(開房驗證同標準)。
//   Ⅴ 縫完整性:terrain 消費 procRelief、venue_field 鏡射、rooms 驗水域+正規化 gen。
//   Ⅵ 起伏性質:procReliefAt ∈ [-1,1]、確定性、sanitize 夾振幅。
//
// 跑法:node tools/audit_mapgen.mjs
// 反向:node tools/audit_mapgen.mjs --break-clamp   (夾限失效 → Ⅰ 紅字)
//      node tools/audit_mapgen.mjs --break-seam    (縫字串移除 → Ⅴ 紅字)
import { MAPGEO, lanesFor, towerLayoutAudit, laneSeparationAudit } from '../public/js/data.js';
import { mulberry32 } from '../public/js/rng.js';
import * as mapgen from '../public/js/mapgen.js';
import { readSrc } from './audit_src.mjs';

const BREAK_CLAMP = process.argv.includes('--break-clamp');
const BREAK_SEAM = process.argv.includes('--break-seam');

let pass = 0, fail = 0;
const ok = (v, msg) => { v ? pass++ : (fail++, console.error(`  ✗ ${msg}`)); };

// ---- 被驗的夾限:真品走 import;--break-clamp 時載壞版原文 ----
let clampBiomeMix = mapgen.clampBiomeMix;
if (BREAK_CLAMP) {
  const src = readSrc('public', 'js', 'mapgen.js');
  const good = 'const f = MAX_WATER_WET / ww;';
  if (!src.includes(good)) throw new Error('--break-clamp 替換目標不存在');
  const badSrc = src
    .replace(/^import .*$/gm, '')
    .replace(/^export (const|function) /gm, '$1 ')
    .replace(good, 'const f = 1;');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const mod = await new AsyncFunction('MAPGEO', 'BIOMES', 'lanesFor', 'targetDistFor', 'sideMFor', 'mulberry32',
    `${badSrc}\nreturn { clampBiomeMix };`)(
    (await import('../public/js/data.js')).MAPGEO,
    (await import('../public/js/data.js')).BIOMES,
    lanesFor,
    (await import('../public/js/data.js')).targetDistFor,
    (await import('../public/js/data.js')).sideMFor,
    mulberry32);
  clampBiomeMix = mod.clampBiomeMix;
}

console.log('Ⅰ mix 夾限唯一縫');
{
  const over = clampBiomeMix({ urban: 0.2, green: 0.1, bare: 0, water: 0.5, wet: 0.4 });
  ok(over.water + over.wet <= 0.5 + 1e-9, `水域+沼澤壓回 50%: ${(over.water + over.wet).toFixed(3)}`);
  ok(Math.abs(Object.values(over).reduce((s, v) => s + v, 0) - 1) < 1e-4, '總和恆為 1(容四捨五入量化)');
  ok(over.urban > 0 && over.green > 0, '非水成分比例保留');
  const norm = mapgen.clampBiomeMix({ urban: 2, green: 1 });
  ok(Math.abs(norm.urban - 2 / 3) < 1e-3 && Math.abs(norm.green - 1 / 3) < 1e-3, '一般比例正規化');
  ok(mapgen.clampBiomeMix(null) === null, 'null 回 null(寧缺勿錯)');
  ok(mapgen.clampBiomeMix({})?.green === 1, '全零退回綠地');
  const blend = mapgen.blendBiomeMix([
    { mix: { urban: 1 }, weight: 1 },
    { mix: { green: 1 }, weight: 3 },
  ]);
  ok(Math.abs(blend.urban - 0.25) < 1e-3 && Math.abs(blend.green - 0.75) < 1e-3, '加權混合 1:3');
  ok(mapgen.blendBiomeMix([]) === null, '無來源回 null');
}

console.log('Ⅱ 確定性');
{
  const srcs = [
    { name: '甲', ll: [25.03, 121.56], mix: { urban: 0.8, green: 0.2 }, ampF: 1, weight: 1 },
    { name: '乙', ll: [35.66, 139.72], mix: { green: 0.6, bare: 0.4 }, ampF: 1.2, weight: 2 },
  ];
  const a = JSON.stringify(mapgen.mixedMapConfig(srcs, { teamSize: 5 }));
  const b = JSON.stringify(mapgen.mixedMapConfig(srcs, { teamSize: 5 }));
  ok(a === b, '混合:同輸入逐位元同輸出');
  const anchors = [{ ll: [25.03, 121.56] }, { ll: [35.66, 139.72] }];
  const r1 = JSON.stringify(mapgen.randomMapConfig({ teamSize: 3, seed: 99, anchors }));
  const r2 = JSON.stringify(mapgen.randomMapConfig({ teamSize: 3, seed: 99, anchors }));
  ok(r1 === r2, '隨機:同種子逐位元同輸出');
  const r3 = JSON.stringify(mapgen.randomMapConfig({ teamSize: 3, seed: 100, anchors }));
  ok(r1 !== r3, '隨機:不同種子不同構');
}

console.log('Ⅲ 非現實(學習分佈但不相同)');
{
  const anchors = [{ ll: [25.034009, 121.563871] }, { ll: [35.659538, 139.700442] }];
  let novel = true;
  for (let s = 1; s <= 20; s++) {
    const c = mapgen.randomMapConfig({ teamSize: 5, seed: s, anchors });
    for (const a of anchors) {
      const dx = (c.center.lng - a.ll[1]) * 111320 * Math.cos(a.ll[0] * Math.PI / 180);
      const dz = (c.center.lat - a.ll[0]) * 110600;
      if (Math.hypot(dx, dz) < 100) novel = false;
    }
    if (!c.procRelief || !(c.procRelief.amp > 0)) novel = false;
    if (c.gen?.mode !== 'random') novel = false;
  }
  ok(novel, '20 種子:中心距任一錨點 >100m 且帶程序化起伏');
}

console.log('Ⅳ 幾何合規(開房驗證同標準)');
{
  // rooms.js lanesToGame 同換算(原點取首點,towerLayoutAudit 只用相對距離)
  const EARTH = 6371000, SC = 1 / MAPGEO.REAL_SCALE;
  const toGame = (lanes) => {
    const o = lanes[0][0], cosO = Math.cos(o[0] * Math.PI / 180);
    return lanes.map((l) => l.map(([la, ln]) => [
      (ln - o[1]) * Math.PI / 180 * EARTH * cosO * SC,
      (la - o[0]) * Math.PI / 180 * EARTH * SC,
    ]));
  };
  let geoBad = 0;
  const anchors = [{ ll: [25.03, 121.56] }, { ll: [35.66, 139.72] }, { ll: [40.75, -73.98] }];
  for (let s = 1; s <= 30; s++) {
    for (const ts of [1, 2, 3, 4, 5]) {
      const cfgs = [
        mapgen.randomMapConfig({ teamSize: ts, seed: s, anchors }),
        mapgen.mixedMapConfig([
          { name: '甲', ll: anchors[(s - 1) % 3].ll, mix: { urban: 0.7, green: 0.3 }, weight: 1 },
          { name: '乙', ll: anchors[s % 3].ll, mix: { green: 0.5, water: 0.4, wet: 0.3 }, weight: 1 },
        ], { teamSize: ts }),
      ];
      for (const c of cfgs) {
        const g = toGame(c.lanes);
        const towerOk = towerLayoutAudit(g, false).ok;
        const sepOk = laneSeparationAudit(g).ok;
        const laneOk = c.lanes.length === lanesFor(ts) && c.laneCount === lanesFor(ts);
        const distOk = c.distM >= c.diagM * 0.8;
        const ww = (c.venue.mix.water || 0) + (c.venue.mix.wet || 0);
        if (!towerOk || !sepOk || !laneOk || !distOk || !(ww <= 0.5 + 1e-9)) {
          geoBad++;
          console.error(`  ✗ seed=${s} ts=${ts} ${c.gen.mode}: tower=${towerOk} sep=${sepOk} lane=${laneOk} dist=${distOk} ww=${ww.toFixed(2)}`);
        }
      }
    }
  }
  ok(geoBad === 0, `30 種子×5 人數×2 模式全合規(壞 ${geoBad})`);
}

console.log('Ⅴ 縫完整性');
{
  let terrain = readSrc('public', 'js', 'terrain.js');
  let field = readSrc('tools', 'venue_field.mjs');
  let rooms = readSrc('server', 'rooms.js');
  if (BREAK_SEAM) {
    // 壞版:抽掉縫字串(期望值不變 ⇒ 存在斷言 MUST 紅)
    terrain = terrain.replaceAll('procReliefAt', 'procRelief__GONE');
    field = field.replaceAll('procReliefAt', 'procRelief__GONE');
    rooms = rooms.replaceAll('MAX_WATER_WET', 'MAX_WATER_WET__GONE');
  }
  ok(/from '.\/mapgen\.js'/.test(terrain) && /procReliefAt\(proc\.seed/.test(terrain), 'terrain 消費程序化起伏');
  ok(/sanitizeProcRelief\(cfg\.procRelief\)/.test(terrain), 'terrain 走淨化縫(振幅上限)');
  ok(/from '..\/public\/js\/mapgen\.js'/.test(field) && /procReliefAt\(proc\.seed/.test(field), 'venue_field 離線鏡射同段');
  ok(/MAX_WATER_WET/.test(rooms) && /水域\+沼澤/.test(rooms), 'rooms 驗水域+沼澤上限');
  ok(/sanitizeProcRelief\(cfg\.procRelief\)/.test(rooms), 'rooms 正規化 procRelief');
  ok(/cfg\.gen\?\.mode === 'mixed' \|\| cfg\.gen\?\.mode === 'random'/.test(rooms), 'rooms 正規化 gen 模式');
}

console.log('Ⅵ 起伏性質');
{
  ok(Math.abs(mapgen.procReliefAt(7, 100, 200) - mapgen.procReliefAt(7, 100, 200)) === 0, '起伏確定性');
  let mn = Infinity, mx = -Infinity, sum = 0, n = 0;
  for (let x = -500; x <= 500; x += 50) {
    for (let z = -500; z <= 500; z += 50) {
      const v = mapgen.procReliefAt(7, x, z);
      mn = Math.min(mn, v); mx = Math.max(mx, v); sum += v; n++;
    }
  }
  ok(mn >= -1 && mx <= 1, `值域 [-1,1](實測 ${mn.toFixed(2)}~${mx.toFixed(2)})`);
  ok(Math.abs(sum / n) < 0.2, `近零均值(實測 ${(sum / n).toFixed(3)})`);
  ok(mapgen.procReliefAt(7, 0, 0) !== mapgen.procReliefAt(8, 0, 0), '多種子多樣');
  ok(mapgen.sanitizeProcRelief({ seed: 1, amp: 99 }).amp === mapgen.PROC_RELIEF_MAX_M, '振幅夾上限');
  ok(mapgen.sanitizeProcRelief({ seed: 1, amp: 0 }) === null, '零振幅回 null(關閉)');
  ok(mapgen.sanitizeProcRelief(null) === null, '缺席回 null(舊存檔逐位元同舊制)');
}

console.log(`\n${fail === 0 ? '✅ 全綠' : '❌ 有紅字'}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
