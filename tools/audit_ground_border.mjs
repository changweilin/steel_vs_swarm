// Terrain border puzzle audit (2026-08-11 user request) -- node tools/audit_ground_border.mjs
// User decision: borders between large terrain blocks use 16-direction straight/turn/fork
// puzzle pieces as type boundaries (Carcassonne-like); border pieces use trail/forest road/
// gravel path/field ridge/ditch/stream/fence/hedgerow/beach/rocks/mangrove and other natural
// or artificial divider patterns; different divider kinds can relay-link.
// System shape (ground.js):
//   BORDER_KINDS (11-kind divider catalog) + BORDER_STYLES (coarse unordered pairs)
//   + BORDER_SUB_RULES (surface-level override) + borderKindOf (single-seam resolver)
//   + planBorderPuzzle (pure-function plan: boundary edges -> corner graph chains
//   -> 16-direction greedy quantization, cut points pinned to shared corners -> tile/fork).
// This audit executes the true ground.js source (all exports dependency-free, eval extracted):
//   I catalog and kind resolution (11-kind roster / style value range / symmetry /
//     water-adjacent kinds / sub override and urban exemption)
//   II puzzle topology (straight border single-chain cover / variant not a border /
//     cliff not a border / island loop / fork three arms sharing one point /
//     in-chain relay cut point / each edge covered once / determinism)
//   III 16-direction quantization (jittered corners: chord bearing bin error <= half bin
//     11.25 deg / drift <= limit / straight compression / turn = bin change /
//     adjacent tile endpoints bit-identical)
//   IV control group (built-in reverse verification): (a) bin folding (b) drift cap
//     removed (c) relay splitting removed
//   V static wiring (single seam / old props not regressing / pure function zero rnd /
//     lift and renderOrder layer discipline)
//   VI forced dry land inside divider band (2026-08-13 user decision: water/marsh inside the
//     divider band must not trigger abnormal states) -- carpet handoff sits on the drawn line
//     while terrainEnvCode measures true terrain, differing by at most half a band width
//     (widest 9m): standing on the beach pattern while the server thinks you are in water.
//     Mask produced by ground.js bandDryAt, consumed by biomes.terrainEnvCode, installed by
//     main.js after buildBiomes -- installing early creates a border-changes-zone /
//     zone-changes-border cycle, symptom is a different map every build (each cell still
//     follows the rule, so no existing assertion can see it).
// 2026-08-13 follow-up: same-zone pairs with sharp color jumps also draw lines (I-6;
// narrow gate = CARPET_DE.LINE).
'use strict';
import { readSrc } from './audit_src.mjs';

let fail = 0;
const bad = (m) => { console.log('  ✗', m); fail++; };
const ok = (m) => console.log('  ✓', m);

// Reverse verification: --break-de pushes the same-zone color-distance gate to Infinity
// (= back to the 2026-08-11 no-lines-inside-same-zone rule) => I-6 must go red
const BREAK_DE = process.argv.includes('--break-de');
const src0 = readSrc('public', 'js', 'ground.js') + '\n' + readSrc('public', 'js', 'groundCatalog.js').replaceAll('export const ', 'const ');
const src = BREAK_DE
  ? src0.replace(/export const CARPET_DE = \{ LINE: \d+ \};/, 'export const CARPET_DE = { LINE: Infinity };')
  : src0;
if (BREAK_DE && src === src0) {
  console.log('x --break-de 替換無效(CARPET_DE 原文樣式漂移)—— 這一支會假綠,請同步稽核');
  process.exit(1);
}

// ===== Extract source (dependency-free -> eval the real thing) =====
const dirsM = src.match(/export const BORDER_DIRS = .*$/m);
const kindsM = src.match(/export const BORDER_KINDS = \{[\s\S]*?\n\};/);
const stylesM = src.match(/export const BORDER_STYLES = \{[\s\S]*?\n\};/);
const rulesM = src.match(/export const BORDER_SUB_RULES = \[[\s\S]*?\n\];/);
const kindOfM = src.match(/export function borderKindOf\(subA, subB, za, zb\) \{[\s\S]*?\n\}/);
const arcM = src.match(/export function borderCornerArc\(px, pz, ax, az, bx, bz, Lmax, hw\) \{[\s\S]*?\n\}/);
const planM = src.match(/export function planBorderPuzzle\(keys, gnx, gnz, opts = \{\}\) \{[\s\S]*?\n\}/);
const cutM = src.match(/export const BORDER_CUT = .*$/m);
const bandM = src.match(/export const BORDER_BAND = .*$/m);
const cutFnM = src.match(/export function borderCutAlpha\(d, w\) \{[\s\S]*?\n\}/);
const upM = src.match(/export function sweepUpY\(tx, tz, nx, nz\) \{.*\}/);
// 2026-08-13 addition: same-zone sharp color jumps also draw lines => borderKindOf takes three more inputs
const brickM = src.match(/const BRICK_C = \[[\s\S]*?\];/);
const hexOfM = src.match(/const hexOf = .*$/m);
const meanM = src.match(/const meanHex = \([\s\S]*?\n\};/);
const colTabM = src.match(/export const SUB_COL = \{[\s\S]*?\n\};/);
const colDistM = src.match(/export function colDist\(h1, h2\) \{[\s\S]*?\n\}/);
const deM = src.match(/export const CARPET_DE = .*$/m);
const sameM = src.match(/export const BORDER_SAME_ZONE = \{[\s\S]*?\n\};/);
if (!brickM || !hexOfM || !meanM || !colTabM || !colDistM || !deM || !sameM) {
  bad('ground.js 找不到 SUB_COL / colDist / CARPET_DE / BORDER_SAME_ZONE 原文(同地貌色距那一條)');
  console.log(`\nFAIL(${fail} 項)`); process.exit(1);
}
if (!dirsM || !kindsM || !stylesM || !rulesM || !kindOfM || !arcM || !planM || !cutM || !bandM || !cutFnM || !upM) {
  bad('ground.js 找不到 BORDER_DIRS / BORDER_KINDS / BORDER_STYLES / BORDER_SUB_RULES / BORDER_CUT / BORDER_BAND / borderKindOf / borderCutAlpha / sweepUpY / borderCornerArc / planBorderPuzzle 原文');
  console.log(`\nFAIL(${fail} 項)`); process.exit(1);
}
const build = (planText, arcText = arcM[0]) => new Function(`
  ${brickM[0]}
  ${hexOfM[0]}
  ${meanM[0]}
  ${colTabM[0].replace('export ', '')}
  ${colDistM[0].replace('export ', '')}
  ${deM[0].replace('export ', '')}
  ${sameM[0].replace('export ', '')}
  ${dirsM[0].replace('export ', '')}
  ${kindsM[0].replace('export ', '')}
  ${stylesM[0].replace('export ', '')}
  ${rulesM[0].replace('export ', '')}
  ${cutM[0].replace('export ', '')}
  ${bandM[0].replace('export ', '')}
  ${cutFnM[0].replace('export ', '')}
  ${upM[0].replace('export ', '')}
  ${kindOfM[0].replace('export ', '')}
  ${arcText.replace('export ', '')}
  ${planText.replace('export ', '')}
  return { BORDER_DIRS, BORDER_KINDS, BORDER_STYLES, BORDER_SUB_RULES, BORDER_CUT, BORDER_BAND,
           borderKindOf, borderCutAlpha, sweepUpY, borderCornerArc, planBorderPuzzle,
           SUB_COL, colDist, CARPET_DE, BORDER_SAME_ZONE };
`)();
const { BORDER_DIRS, BORDER_KINDS, BORDER_STYLES, BORDER_SUB_RULES, BORDER_CUT, BORDER_BAND,
        borderKindOf, borderCutAlpha, sweepUpY, borderCornerArc, planBorderPuzzle,
        SUB_COL, colDist, CARPET_DE, BORDER_SAME_ZONE } = build(planM[0]);
const truthCarpet = new Function(src.match(/const CARPET = \{[\s\S]*?\n\};/)[0] + '\nreturn CARPET;')();
// Painter roster (extract top-level method names only, do not eval the canvas code)
const paintersM = src.match(/const BORDER_PAINTERS = \{[\s\S]*?\n\};/);
const PAINTERS = paintersM ? [...paintersM[0].matchAll(/\n  (\w+)\(g, S, rnd\)/g)].map((m) => m[1]) : [];

// ===== Helpers =====
const grid = (gnx, gnz, fn) => {
  const keys = new Array(gnx * gnz).fill(null);
  for (let j = 0; j < gnz; j++) for (let i = 0; i < gnx; i++) keys[j * gnx + i] = fn(i, j);
  return keys;
};
// Audit coarse-zone stand-in (takes a full key 'sub#v')
const SUBZ = {
  turf: 'green', meadow: 'green', arrowbamboo: 'green', flowerfield: 'green',
  wild: 'bare', sand: 'bare', gravel: 'bare',
  concrete: 'urban', brick: 'urban', marsh: 'wet', lotus: 'wet',
  watertile: 'water', deepwater: 'water', plateau: 'alpine', icefield: 'alpine',
};
const coarseOf = (key) => SUBZ[key.slice(0, key.indexOf('#'))] || null;
const allTiles = (plan) => plan.chains.flatMap((c) => c.tiles);
const ANG = (2 * Math.PI) / BORDER_DIRS;
const angDiff = (a, b) => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
};

console.log('== Ⅰ 型錄與種類解析(執行原文)==');
{
  // 1. 11-kind roster = one item per user sentence, no more no less
  // 2026-08-13 added mudflat (user decision: dedicated mud transition between water and marsh);
  // mangrove was not removed, it stepped back to the lotus-pond vs water cell of BORDER_SUB_RULES
  // (it now lives in that one grid cell)
  const WANT = ['trail', 'forestroad', 'gravelpath', 'fieldridge', 'ditch', 'stream',
                'fence', 'hedgerow', 'beach', 'mudflat', 'rocks', 'mangrove'];
  const got = Object.keys(BORDER_KINDS);
  (got.length === WANT.length && WANT.every((k) => got.includes(k)))
    ? ok(`BORDER_KINDS = 使用者定案的 ${WANT.length} 種分界線(步道小徑…紅樹林),不多不少`)
    : bad(`BORDER_KINDS 鍵集 ${JSON.stringify(got)} ≠ 定案 ${WANT.length} 種`);
  // Transition kinds (two sides are different things) MUST be flagged wet and MUST be
  // water-adjacent kinds -- missing the flag, or flagged but drawn symmetric, both read as
  // both sides of the divider looking like the same zone (user report 2026-08-13)
  {
    const WET = ['beach', 'mangrove', 'mudflat'];
    const gotW = Object.entries(BORDER_KINDS).filter(([, d]) => d.flat?.wet).map(([k]) => k).sort();
    (gotW.length === WET.length && WET.every((k) => gotW.includes(k)))
      ? ok(`過渡型(flat.wet)恰為 ${WET.join('/')} —— v = 1 恆為水側`)
      : bad(`flat.wet 名冊 ${JSON.stringify(gotW)} ≠ ${JSON.stringify(WET)}`);
    Object.values(BORDER_KINDS).every((d) => !d.flat?.wet || d.aq)
      ? ok('過渡型全數是貼水種類(aq):不貼水的東西沒有「水側」可言')
      : bad('有 flat.wet 的種類不是 aq');
  }
  Object.values(BORDER_KINDS).every((k) => k.name && (k.flat || k.ridge)
      && (!k.flat || (k.flat.w > 0 && k.flat.tex)) && (!k.ridge || (k.ridge.w > 0 && k.ridge.h > 0)))
    ? ok('每種都有 flat(w/tex)或 ridge(w/h)幾何定義')
    : bad('BORDER_KINDS 有型錄列缺幾何定義');
  // 2026-08-11 user decision: dividers can be thicker with finer art on top =>
  // every kind MUST have a ground band: the band is the border itself (readable pattern /
  // covers the true border skipped when the 13m grid is straightened / both terrains hand
  // off under it). A pure 3D spine is one thin rod = what the user called a meaningless line
  const noFlat = Object.entries(BORDER_KINDS).filter(([, d]) => !d.flat).map(([k]) => k);
  noFlat.length === 0
    ? ok('每一種分界線都有貼地帶(純立體脊不成界;脊只是加在帶上的擺件)')
    : bad(`缺貼地帶的種類:${noFlat.join(' ')}`);
  // Band width MUST cover the quantization drift radius and still read as a pattern:
  // lower bound pinned to two mechs shoulder to shoulder = SOLDIER_H x 2
  const thin = Object.entries(BORDER_KINDS).filter(([, d]) => d.flat.w < 3);
  thin.length === 0 ? ok('每一種貼地帶寬 ≥ 3m(遠看仍讀得出是一條有圖案的界線)')
    : bad(`帶太窄:${thin.map(([k, d]) => `${k} ${d.flat.w}`).join(' ')}`);
  // The painter key is a field with a consumer: borderTex looks up BORDER_PAINTERS via
  // BORDER_KINDS[kind].flat.tex; MUST NOT fall back to the kind name (that would leave tex
  // as decoration no one reports when changed)
  const noTex = Object.entries(BORDER_KINDS).filter(([, d]) => !PAINTERS.includes(d.flat.tex)).map(([k]) => k);
  (PAINTERS.length >= Object.keys(BORDER_KINDS).length && noTex.length === 0)
    ? ok(`每一種的 flat.tex 都在 BORDER_PAINTERS 名冊內(${PAINTERS.length} 支畫筆)`)
    : bad(`flat.tex 查無畫筆:${noTex.join(' ')}(畫筆名冊 ${PAINTERS.join(',')})`);
  /BORDER_PAINTERS\[BORDER_KINDS\[kind\]\.flat\.tex\]/.test(src)
    ? ok('borderTex 經 flat.tex 取畫筆(型錄是唯一真相)')
    : bad('borderTex 未走 flat.tex ⇒ tex 欄位沒有消費端');
  BORDER_DIRS === 16 ? ok('BORDER_DIRS = 16(與道路 16 方向量化同語彙)')
    : bad(`BORDER_DIRS = ${BORDER_DIRS} ≠ 16`);

  // 2. Style table range + no-lines-inside-same-zone + full cross-zone coverage
  const ZS = ['alpine', 'bare', 'green', 'urban', 'water', 'wet'];
  Object.entries(BORDER_STYLES).every(([k, v]) => {
    const [a, b] = k.split('|');
    return ZS.includes(a) && ZS.includes(b) && a < b && BORDER_KINDS[v];
  }) ? ok('BORDER_STYLES 鍵 = 已排序且**相異**的地貌對、值全在型錄內')
    : bad('BORDER_STYLES 鍵/值越界(或殘留同地貌列)');
  ZS.every((z) => !BORDER_STYLES[`${z}|${z}`])
    ? ok('表內無任何同地貌列(2026-08-11 定案:兩側相同地貌不需要分界線)')
    : bad('BORDER_STYLES 殘留同地貌列');
  // Cross-zone: all 14 land-water and land-land pairs get a dedicated divider; water|wet
  // (water vs marsh) is continuous fluid water with no land divider
  const REP0 = { green: 'turf', bare: 'wild', urban: 'concrete', wet: 'marsh', water: 'watertile', alpine: 'plateau' };
  const miss = [];
  for (let a = 0; a < ZS.length; a++) for (let b = a + 1; b < ZS.length; b++) {
    const pair = `${ZS[a]}|${ZS[b]}`;
    if (pair === 'water|wet') {
      if (borderKindOf(REP0[ZS[a]], REP0[ZS[b]], ZS[a], ZS[b]) !== null) miss.push(pair);
    } else {
      if (!borderKindOf(REP0[ZS[a]], REP0[ZS[b]], ZS[a], ZS[b])) miss.push(pair);
    }
  }
  miss.length === 0 ? ok('14 個跨地貌對全數解得出分界線，水沼交界為純水面無陸地界線(無遺漏)')
    : bad(`跨地貌對異常:${miss.join(' ')}`);

  // 3. Symmetry: swapping sides returns the same (all zone pairs x representative surface)
  const REP = { green: 'turf', bare: 'wild', urban: 'concrete', wet: 'marsh', water: 'watertile', alpine: 'plateau' };
  let sym = true;
  for (const za of ZS) for (const zb of ZS) {
    if (borderKindOf(REP[za], REP[zb], za, zb) !== borderKindOf(REP[zb], REP[za], zb, za)) sym = false;
  }
  sym ? ok('borderKindOf 對稱(交換兩側回傳相同)') : bad('borderKindOf 不對稱');

  // 4. Water borders always resolve to water-adjacent kinds (aq): beach/rocks/mangrove
  let aqOk = true;
  for (const z of ZS) {
    const k = borderKindOf(REP[z], 'watertile', z, 'water');
    if (k && !BORDER_KINDS[k].aq) aqOk = false;
  }
  aqOk ? ok('凡含水域的交界解出的種類全帶 aq(圍籬不會站進水裡)')
    : bad('水界解出非貼水種類');

  // 5. sub override: bamboo -> forest road, flower field -> field ridge, sand -> beach;
  // urban borders exempt (artificial borders win)
  borderKindOf('arrowbamboo', 'wild', 'green', 'bare') === 'forestroad'
    ? ok('竹林↔荒野 → 林道(sub 覆寫)') : bad('arrowbamboo 覆寫失效');
  borderKindOf('flowerfield', 'wild', 'green', 'bare') === 'fieldridge'
    ? ok('花田↔荒野 → 田埂(sub 覆寫)') : bad('flowerfield 覆寫失效');
  borderKindOf('sand', 'watertile', 'bare', 'water') === 'beach'
    ? ok('沙地↔水域 → 沙灘(sub 覆寫蓋過 bare|water 的岩塊)') : bad('sand 覆寫失效');
  borderKindOf('arrowbamboo', 'concrete', 'green', 'urban') === 'hedgerow'
    ? ok('竹林↔市區 → 灌木矮牆(市區界不吃 sub 覆寫 = 人工界優先)') : bad('市區界豁免失效');
  borderKindOf('sand', 'turf', 'bare', 'green') === 'gravelpath'
    ? ok('沙地↔草皮(旱界)→ 碎石土徑(vs 名單把沙灘閘在水界)') : bad('sand vs 名單失守');
  BORDER_SUB_RULES.every((r) => BORDER_KINDS[r.kind] && Array.isArray(r.vs) && !r.vs.includes('urban'))
    ? ok('BORDER_SUB_RULES 值域合法且一律不含市區') : bad('BORDER_SUB_RULES 越界');
  // vs MUST NOT contain that sub own zone -- same-zone draws no line, listing it is a
  // permanently dead setting that never matches
  const SUBZ0 = Object.fromEntries(Object.entries(truthCarpet).flatMap(([z, l]) => l.map((s) => [s, z])));
  BORDER_SUB_RULES.every((r) => !r.vs.includes(SUBZ0[r.sub]))
    ? ok('BORDER_SUB_RULES 的 vs 一律不含自身地貌(無死設定)')
    : bad(`vs 含自身地貌:${BORDER_SUB_RULES.filter((r) => r.vs.includes(SUBZ0[r.sub])).map((r) => r.sub).join(' ')}`);

  // 6. Same zone: only the sharp-color-jump narrow gate (2026-08-13 user decision:
  // sharp color jumps also get that zone divider). 08-11 blocked per-subtype lines, not
  // this -- the watershed is CARPET_DE.LINE, so both directions need teeth below:
  (borderKindOf('turf', 'meadow', 'green', 'green') === null            // 94 < 100
    && borderKindOf('arrowbamboo', 'turf', 'green', 'green') === null   // 30
    && borderKindOf('turf', 'bushfield', 'green', 'green') === null)    // 55
    ? ok('同地貌 + 色距 < CARPET_DE.LINE → null(逐款畫線 = 大片綠地被切成網狀,仍擋著)')
    : bad('同地貌小色差仍解出分界線(密集網狀的成因)');
  (borderKindOf('wild', 'sand', 'bare', 'bare') === 'gravelpath'        // 195
    && borderKindOf('icefield', 'steppe', 'alpine', 'alpine') === 'rocks'   // 253 (snowline)
    && borderKindOf('brick', 'pavement', 'urban', 'urban') === 'hedgerow')  // 137
    ? ok('同地貌 + 色距 ≥ CARPET_DE.LINE → 該地貌的專屬界線(BORDER_SAME_ZONE)')
    : bad('顏色劇烈變化處沒有畫線(使用者 2026-08-13 定案)');
  // Symmetry + same-subtype always null + no-representative-color (feature patch) always
  // null + water has no same-zone border (shallow and deep are one water body)
  (borderKindOf('sand', 'wild', 'bare', 'bare') === borderKindOf('wild', 'sand', 'bare', 'bare')
    && borderKindOf('sand', 'sand', 'bare', 'bare') === null
    && borderKindOf('court', 'plaza', 'urban', 'urban') === null
    && borderKindOf('watertile', 'deepwater', 'water', 'water') === null)
    ? ok('同地貌分支:對稱 / 同款 null / 非底毯款 null / 水域無同地貌界')
    : bad('同地貌分支的四條邊界情形有破口');
  // The gate is neither empty nor wide open: the sorted roster really contains a few
  // adjacent pairs crossing the gate, and only a few
  {
    const carpetOrderM = src.match(/export function carpetOrder\([\s\S]*?\n\}/);
    const CO = new Function(`${brickM[0]}\n${hexOfM[0]}\n${meanM[0]}
      ${colTabM[0].replace('export ', '')}\n${colDistM[0].replace('export ', '')}
      ${carpetOrderM[0].replace('export ', '')}\nreturn carpetOrder;`)();
    let over = 0, tot = 0;
    for (const zn in truthCarpet) {
      const a = CO(truthCarpet[zn]);
      for (let i = 1; i < a.length; i++) {
        if (a[i] === a[i - 1]) continue;
        tot++;
        if (colDist(SUB_COL[a[i - 1]], SUB_COL[a[i]]) >= CARPET_DE.LINE) over++;
      }
    }
    (over > 0 && over <= tot * 0.4)
      ? ok(`底毯清單排序後的相鄰對:${over}/${tot} 跨過門檻(> 0 = 門檻不是死設定;≤ 40% = 不成網)`)
      : bad(`跨門檻相鄰對 ${over}/${tot} —— 0 = 這條規則永遠不生效,過半 = 又切回網狀`);
  }
  Object.entries(BORDER_SAME_ZONE).every(([z, k]) => BORDER_KINDS[k] && z !== 'water')
    ? ok('BORDER_SAME_ZONE 值域合法(種類都在型錄裡)且不含水域')
    : bad('BORDER_SAME_ZONE 值域越界');
  (borderKindOf('a', 'b', null, 'green') === null && borderKindOf('a', 'b', 'green', null) === null)
    ? ok('分區未知回 null(不擺,寧缺勿錯)') : bad('分區未知未回 null');
}

console.log('== Ⅱ 拼圖拓撲(planBorderPuzzle 執行原文;恆等角點)==');
{
  const N = 8;
  // driftMax mirrors the emitter ratio (cell x 0.6; identity corners: 1 unit = 1 cell) --
  // a 90-degree corner inner-point normal distance 0.707 > 0.6, so corners never merge into straights
  const opt = { coarseOf, driftMax: 0.6 };
  // 1. Straight border: grass left, wild right -> single chain, single tile (collinear
  // merged), full cover
  const keys = grid(N, N, (i) => i < 4 ? 'turf#0' : 'wild#0');
  const plan = planBorderPuzzle(keys, N, N, opt);
  plan.chains.length === 1 ? ok('直線交界成單一鏈') : bad(`直線交界鏈數 ${plan.chains.length} ≠ 1`);
  const ts = allTiles(plan);
  (ts.length === 1 && ts[0].x0 === 4 && ts[0].z0 === 0 && ts[0].x1 === 4 && ts[0].z1 === 8)
    ? ok('共線邊全併成一片直線拼圖,端點 (4,0)-(4,8) 全覆蓋')
    : bad(`直線交界 tiles=${JSON.stringify(ts)}`);
  (ts[0] && ts[0].bin === 4 && ts[0].kind === 'gravelpath' && ts[0].drift === 0)
    ? ok('方位落格 bin=4(+z 向)、綠↔裸 → 碎石土徑、drift=0')
    : bad(`直線 tile bin/kind/drift 錯誤 ${JSON.stringify(ts[0])}`);
  plan.forks.length === 0 ? ok('直線交界無岔路') : bad('直線交界誤判岔路');

  // 2. Same surface different variant: pattern is continuous, not a border
  allTiles(planBorderPuzzle(grid(N, N, (i) => i < 4 ? 'turf#0' : 'turf#1'), N, N, opt)).length === 0
    ? ok('同地表異變體不成界(變體只是換款花紋)') : bad('異變體誤生分界');

  // 3. Cliff '!' / unpaved null form no border
  const kCliff = grid(N, N, (i) => i < 3 ? 'turf#0' : i === 3 ? '!' : 'wild#0');
  allTiles(planBorderPuzzle(kCliff, N, N, opt)).length === 0
    ? ok("崖('!')隔開的兩地表不成界(交由外溢淡出)") : bad('崖界誤生分界');
  const kNull = grid(N, N, (i) => i < 3 ? 'turf#0' : i === 3 ? null : 'wild#0');
  allTiles(planBorderPuzzle(kNull, N, N, opt)).length === 0
    ? ok('未鋪(null)隔開的兩地表不成界') : bad('未鋪界誤生分界');

  // 4. 2x2 island: closed loop, four pieces, four turns, endpoints closed
  const kIsle = grid(N, N, (i, j) => (i >= 3 && i <= 4 && j >= 3 && j <= 4) ? 'wild#0' : 'turf#0');
  const pIsle = planBorderPuzzle(kIsle, N, N, opt);
  const isle = pIsle.chains[0];
  (pIsle.chains.length === 1 && isle.closed) ? ok('孤島邊界成單一閉環鏈') : bad('孤島未成閉環');
  (isle.tiles.length === 4 && isle.tiles.every((t) => t.turn))
    ? ok('閉環四邊四片、每片都是轉彎拼圖(90° 角)') : bad(`閉環 tiles=${isle.tiles.length} 或 turn 標記錯誤`);
  isle.tiles.every((t, i2) => {
    const nx = isle.tiles[(i2 + 1) % isle.tiles.length];
    return t.x1 === nx.x0 && t.z1 === nx.z0;
  }) ? ok('閉環相鄰拼圖端點逐位元共用(含尾接頭)') : bad('閉環端點開縫');

  // 5. Fork: grass left, wild top-right, urban bottom-right -> (4,4) degree 3, three
  // arms of three divider kinds relay at one point
  const kT = grid(N, N, (i, j) => i < 4 ? 'turf#0' : j < 4 ? 'wild#0' : 'concrete#0');
  const pT = planBorderPuzzle(kT, N, N, opt);
  (pT.forks.length === 1 && pT.forks[0].x === 4 && pT.forks[0].z === 4 && pT.forks[0].arms.length === 3)
    ? ok('三地貌交會 → 岔路節點 (4,4) 三臂') : bad(`岔路 ${JSON.stringify(pT.forks?.[0]?.arms)}`);
  const fkKinds = pT.forks[0]?.kinds || [];
  (fkKinds.length === 3 && ['gravelpath', 'hedgerow', 'fence'].every((k) => fkKinds.includes(k)))
    ? ok('三臂三種分界線(碎石土徑/灌木矮牆/圍籬)在岔路接力交會')
    : bad(`岔路臂種類 ${JSON.stringify(fkKinds)}`);
  (pT.chains.length === 3 && pT.chains.every((c) =>
    c.tiles.some((t) => (t.x0 === 4 && t.z0 === 4) || (t.x1 === 4 && t.z1 === 4))))
    ? ok('三條鏈各有一端逐位元落在岔路節點上(拼接零開縫)')
    : bad('鏈端未錨定岔路節點');

  // 6. In-chain relay: inject kindOf (B|C borderless) -> two divider kinds on one
  // chain, cut point exactly at (4,4)
  const kindOf2 = (a, b) => {
    const pair = [a, b].sort().join('|');
    return { 'turf|wild': 'trail', 'concrete|turf': 'fence', 'concrete|wild': null }[pair] || null;
  };
  const pR = planBorderPuzzle(kT, N, N, { coarseOf, kindOf: kindOf2 });
  (pR.chains.length === 1 && pR.forks.length === 0)
    ? ok('注入 kindOf(荒野↔市區無界)→ 邊界合成單鏈、無岔路') : bad('接力布局鏈/岔路數錯誤');
  const rT = allTiles(pR);
  (new Set(rT.map((t) => t.kind)).size === 2
    && rT.some((t) => t.kind === 'trail' && t.x1 === 4 && t.z1 === 4)
    && rT.some((t) => t.kind === 'fence' && t.x0 === 4 && t.z0 === 4))
    ? ok('同一條鏈上步道→圍籬接力,切點 (4,4) 雙方逐位元共用(接力連結)')
    : bad(`鏈內接力切分錯誤 ${JSON.stringify(rT)}`);

  // 7. Each edge covered exactly once (hashed four-zone grid): chain node order expanded
  // edge set = independently recomputed boundary edge set
  const POOL = ['turf#0', 'wild#0', 'concrete#0', 'marsh#0', '!', null];
  const kR = grid(12, 12, (i, j) => POOL[((i * 7 + j * 13 + ((i * j) % 5)) % 11) % POOL.length]);
  const pRnd = planBorderPuzzle(kR, 12, 12, opt);
  const NKW = 14;                        // Node key stride = gnx + 2 (mirrors source)
  const walked = new Set();
  let dup = false;
  for (const c of pRnd.chains) {
    for (let i2 = 1; i2 < c.ns.length; i2++) {
      const a = Math.min(c.ns[i2 - 1], c.ns[i2]), b = Math.max(c.ns[i2 - 1], c.ns[i2]);
      const ek = `${a}-${b}`;
      if (walked.has(ek)) dup = true;
      walked.add(ek);
    }
  }
  const expect = new Set();
  const at = (i, j) => (i < 0 || j < 0 || i >= 12 || j >= 12) ? null : kR[j * 12 + i];
  const solid = (k) => k != null && k !== '!';
  const subF = (k) => k.slice(0, k.indexOf('#'));
  for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) {
    const k0 = at(i, j);
    if (!solid(k0)) continue;
    const kRt = at(i + 1, j), kD = at(i, j + 1);
    if (solid(kRt) && subF(kRt) !== subF(k0) && borderKindOf(subF(k0), subF(kRt), coarseOf(k0), coarseOf(kRt)))
      expect.add(`${Math.min(j * NKW + i + 1, (j + 1) * NKW + i + 1)}-${Math.max(j * NKW + i + 1, (j + 1) * NKW + i + 1)}`);
    if (solid(kD) && subF(kD) !== subF(k0) && borderKindOf(subF(k0), subF(kD), coarseOf(k0), coarseOf(kD)))
      expect.add(`${Math.min((j + 1) * NKW + i, (j + 1) * NKW + i + 1)}-${Math.max((j + 1) * NKW + i, (j + 1) * NKW + i + 1)}`);
  }
  (!dup && walked.size === expect.size && [...expect].every((e) => walked.has(e)))
    ? ok(`雜湊格網:每條邊界邊被恰一條鏈走過恰一次(${walked.size} 邊,與獨立重算全等)`)
    : bad(`邊覆蓋不符:walked=${walked.size} expect=${expect.size} dup=${dup}`);

  // 8. Determinism: same input re-called is bit-identical
  JSON.stringify(planBorderPuzzle(kR, 12, 12, opt)) === JSON.stringify(planBorderPuzzle(kR, 12, 12, opt))
    ? ok('同輸入重呼結果位元相同(§2.3 跨客戶端一致)') : bad('重呼結果不一致');
}

console.log('== Ⅲ 16 方向量化(抖動角點)==');
// Jittered-corner stand-in (same semantics as ground.js cornerAt: pure (i,j) function,
// amplitude < 0.5 cell keeps topology from flipping)
const jitXZ = (ci, cj) => [
  ci + 0.4 * Math.sin(ci * 12.9898 + cj * 78.233),
  cj + 0.4 * Math.cos(ci * 26.651 + cj * 43.71),
];
const DRIFT = 0.6;
{
  const N = 24;
  const keys = grid(N, N, (i, j) => i + j < N ? 'turf#0' : 'wild#0');   // 45-degree staircase border
  const plan = planBorderPuzzle(keys, N, N, { coarseOf, cornerXZ: jitXZ, driftMax: DRIFT });
  const ts = allTiles(plan);
  const nEdges = plan.chains.reduce((s, c) => s + c.ns.length - 1, 0);
  ts.every((t) => angDiff(Math.atan2(t.z1 - t.z0, t.x1 - t.x0), t.bin * ANG) <= ANG / 2 + 1e-9)
    ? ok(`全部 ${ts.length} 片:弦方位與 bin 中心誤差 ≤ 半格 11.25°(16 方向落格)`)
    : bad('有 tile 弦方位落格錯誤');
  ts.every((t) => t.drift <= DRIFT + 1e-9)
    ? ok(`全部 tile 的被略過角點垂距 ≤ driftMax ${DRIFT}(量化不離開交界帶)`)
    : bad(`有 tile drift 超限(max=${Math.max(...ts.map((t) => t.drift)).toFixed(3)})`);
  ts.length <= nEdges * 0.7
    ? ok(`直段壓縮:${nEdges} 邊 → ${ts.length} 片(≤70%;鋸齒被併成直線拼圖)`)
    : bad(`壓縮不足:${nEdges} 邊 → ${ts.length} 片`);
  let turnOk = true, connOk = true;
  for (const c of plan.chains) {
    for (let t = 0; t < c.tiles.length; t++) {
      const tl = c.tiles[t];
      const prev = c.tiles[t - 1] || (c.closed ? c.tiles[c.tiles.length - 1] : null);
      if (prev && prev !== tl) {
        if (tl.turn !== (prev.bin !== tl.bin)) turnOk = false;
        if (prev.x1 !== tl.x0 || prev.z1 !== tl.z0) connOk = false;
      }
    }
  }
  turnOk ? ok('轉彎拼圖 ⇔ 與前一片 bin 不同(直線/轉彎分類正確)') : bad('turn 標記與 bin 變化不符');
  connOk ? ok('抖動角點下相鄰拼圖端點仍逐位元共用(端點錨定)') : bad('抖動角點下端點開縫');
}

console.log('== Ⅵ 接頭拼圖(轉彎/岔路是完整畫出來的一片,不是把直段對接)==');
// Half-width takes catalog true values; the sampling frame MUST also use real scale
// (cell is about 13m at runtime) -- using cell units as meters makes every band wider than
// a cell, all turns degrade to round caps, and the arc section goes unverified
const HW = Object.fromEntries(Object.entries(BORDER_KINDS).map(([k, d]) =>
  [k, Math.max(d.flat ? d.flat.w / 2 : 0, d.ridge ? d.ridge.w / 2 : 0)]));
const CELL_M = 13;
const jitM = (ci, cj) => { const [x, z] = jitXZ(ci, cj); return [x * CELL_M, z * CELL_M]; };
const OPT_J = { coarseOf, cornerXZ: jitM, driftMax: DRIFT * CELL_M, halfWidthOf: (k) => HW[k] ?? 1 };
{
  const N = 24;
  // 45-degree staircase border (many turns) + three-zone meeting chain (fork)
  const keys = grid(N, N, (i, j) => i + j < N ? 'turf#0' : 'wild#0');
  const plan = planBorderPuzzle(keys, N, N, OPT_J);
  const ts = allTiles(plan);

  // 1. Every turn gets one joint piece (bin change implies a corner)
  let turns = 0, withCor = 0;
  for (const c of plan.chains) {
    for (let t = 0; t < c.tiles.length; t++) {
      const tl = c.tiles[t];
      const prev = c.tiles[t - 1] || (c.closed ? c.tiles[c.tiles.length - 1] : null);
      if (!prev || prev === tl || prev.bin === tl.bin) continue;
      turns++;
      if (tl.c0 && tl.c0.type === 'corner') withCor++;
    }
  }
  (turns > 0 && withCor === turns)
    ? ok(`每個轉彎都配一片轉彎拼圖(${withCor}/${turns})`)
    : bad(`轉彎拼圖缺漏:${withCor}/${turns}`);
  plan.corners.length > 0 ? ok(`轉彎拼圖 ${plan.corners.length} 片`) : bad('沒有任何轉彎拼圖');

  // 2. Straight segments always pull back from joints => the joint span belongs to the
  // joint piece alone (this is the structural guarantee of no direct butt-joining)
  const cornerEnds = [];
  for (const c of plan.chains) for (const tl of c.tiles) {
    if (tl.c0) cornerEnds.push([tl, 0]);
    if (tl.c1) cornerEnds.push([tl, 1]);
  }
  cornerEnds.every(([tl, e]) => (e ? tl.tr1 : tl.tr0) > 0)
    ? ok(`接頭處的直段端點全數退縮(${cornerEnds.length} 端,無一為 0)`)
    : bad('有接頭端沒退縮 ⇒ 直段一路頂到節點 = 直接黏接');
  ts.every((tl) => tl.tr0 + tl.tr1 <= Math.hypot(tl.x1 - tl.x0, tl.z1 - tl.z0) * 0.8 + 1e-9)
    ? ok('退縮量合計 ≤ 直段長 80%(不會把整片吃掉)') : bad('退縮量過大,直段被吃光');
  ts.every((tl) => tl.len > 0) ? ok('每片直段退縮後仍有正長度') : bad('有直段退縮後長度 ≤ 0');

  // 3. Cut-point anchoring: the two cut points of a joint = the pulled-back endpoints of
  // both straight segments (bit-identical) => zero gap, zero overlap
  let anch = true;
  for (const c of plan.chains) for (const tl of c.tiles) {
    for (const [cor, ex, ez] of [[tl.c0, tl.ax, tl.az], [tl.c1, tl.bx, tl.bz]]) {
      if (!cor) continue;
      const g = cor.geo;
      const hitA = Math.abs(g.Pa[0] - ex) < 1e-9 && Math.abs(g.Pa[1] - ez) < 1e-9;
      const hitB = Math.abs(g.Pb[0] - ex) < 1e-9 && Math.abs(g.Pb[1] - ez) < 1e-9;
      if (!hitA && !hitB) anch = false;
    }
  }
  anch ? ok('接頭切點與直段退縮端點逐位元重合(端點錨定推廣到轉彎)')
       : bad('接頭切點與直段端點對不上 ⇒ 開縫或重疊');

  // 4. Arc joints: truly tangent to both arms (cut points on the circle, tangent = arm
  // direction) => the pattern bends around instead of folding
  const arcs = plan.corners.filter((c) => c.geo.mode === 'arc');
  let tang = true, radOk = true;
  for (const c of arcs) {
    const g = c.geo;
    for (const [P, arm] of [[g.Pa, c.a], [g.Pb, c.b]]) {
      const rx = P[0] - g.cx, rz = P[1] - g.cz;
      if (Math.abs(Math.hypot(rx, rz) - g.R) > 1e-6) radOk = false;
      // Tangent is perpendicular to radius => arm direction dot radius MUST be 0
      if (Math.abs((rx * arm.dx + rz * arm.dz) / g.R) > 1e-6) tang = false;
    }
    if (!(g.R > c.hw * 1.1 - 1e-9)) radOk = false;      // Inner edge does not flip
  }
  (arcs.length && radOk) ? ok(`圓弧接頭 ${arcs.length} 片:切點在圓上且 R > 1.1·半寬(內緣不翻面)`)
    : bad(arcs.length ? '圓弧半徑/切點不合' : '沒有任何圓弧接頭');
  tang ? ok('圓弧在兩個切點都與臂向相切(圖案順著彎過去)') : bad('圓弧與臂不相切 ⇒ 轉角會折斷');

  // 5. Arc vs cap routing: both compare the actual pull-back L against the arc-needed Lneed
  //    arc means L >= Lneed (fits); cap means L < Lneed (truly too tight, not a lazy default)
  const caps = plan.corners.filter((c) => c.geo.mode === 'cap');
  const Lneed = (c) => {
    const psi = Math.acos(Math.max(-1, Math.min(1, c.a.dx * c.b.dx + c.a.dz * c.b.dz)));
    return c.hw * 1.1 / Math.max(Math.tan(psi / 2), 1e-6);
  };
  caps.every((c) => Lneed(c) > c.geo.L - 1e-9)
    ? ok(`圓帽接頭 ${caps.length} 片:全數確實是「圓弧容不下帶寬」的急彎`)
    : bad('有圓帽接頭其實放得下圓弧(退化成偷懶預設)');
  arcs.every((c) => Lneed(c) <= c.geo.L + 1e-9)
    ? ok('圓弧接頭全數確實放得下(分流判準兩個方向都咬得住)')
    : bad('有圓弧接頭其實放不下(內緣會翻面)');

  // 6. Pure relay (same-direction cell, kind change) grows no turn piece and pulls back nothing
  const kindOf2 = (a, b) => {
    const pair = [a, b].sort().join('|');
    return { 'turf|wild': 'trail', 'concrete|turf': 'fence', 'concrete|wild': null }[pair] || null;
  };
  const kT = grid(8, 8, (i, j) => i < 4 ? 'turf#0' : j < 4 ? 'wild#0' : 'concrete#0');
  const pR = planBorderPuzzle(kT, 8, 8, { ...OPT_J, cornerXZ: (a, b) => [a, b], kindOf: kindOf2 });
  const relay = allTiles(pR);
  const straightRelay = [];
  for (const c of pR.chains) for (let t = 1; t < c.tiles.length; t++) {
    if (c.tiles[t - 1].bin === c.tiles[t].bin) straightRelay.push([c.tiles[t - 1], c.tiles[t]]);
  }
  (straightRelay.length > 0 && straightRelay.every(([p, q]) => !p.c1 && !q.c0 && p.tr1 === 0 && q.tr0 === 0))
    ? ok(`同方向格接力換款 ${straightRelay.length} 處:不生轉彎拼圖也不退縮(它不是轉彎)`)
    : bad(straightRelay.length ? '直線接力處誤生轉彎拼圖/誤退縮' : '本布局沒有直線接力可驗');
  relay.every((tl) => tl.ax != null && tl.bx != null) ? ok('退縮端點欄位齊備') : bad('缺退縮端點');

  // 7. Fork: equal-spaced cross-sections per arm + CCW order + all arms pulled back
  // (per-arm wedges only fit together this way)
  const pF = planBorderPuzzle(kT, 8, 8, { ...OPT_J, cornerXZ: (a, b) => [a, b] });
  const fk = pF.forks[0];
  (fk && fk.arms.length === 3 && fk.L > 0)
    ? ok(`岔路三臂、共用退縮長 L=${fk.L.toFixed(2)}(逐臂斷面等距 ⇒ 楔形規整)`)
    : bad(`岔路資料不完整 ${JSON.stringify(fk)}`);
  if (fk) {
    const ang = fk.arms.map((a) => Math.atan2(a.dz, a.dx));
    ang.every((v, i) => i === 0 || v >= ang[i - 1]) ? ok('岔路臂依方位角逆時針排序(楔形不會交叉)')
      : bad('岔路臂未排序');
    fk.arms.every((a) => a.hw > 0 && a.kind) ? ok('每臂帶自己的種類與半寬(交會處各畫各的圖案 = 接力)')
      : bad('岔路臂缺種類/半寬');
    const armEnds = [];
    for (const c of pF.chains) for (const tl of c.tiles) {
      if (tl.n0 === fk.n) armEnds.push(tl.tr0);
      if (tl.n1 === fk.n) armEnds.push(tl.tr1);
    }
    (armEnds.length === 3 && armEnds.every((t) => Math.abs(t - fk.L) < 1e-9))
      ? ok('三臂全數退縮且退縮量 = 岔路的 L(斷面共圓 ⇒ 楔形接得上)')
      : bad(`岔路臂退縮不一致 ${JSON.stringify(armEnds)} vs L=${fk?.L}`);
  }

  // 8. borderCornerArc direct test: pull-back length consistent, straight degenerate, deterministic
  const st = borderCornerArc(0, 0, 1, 0, -1, 0, 5, 1);
  (st.mode === 'straight' && st.L === 0) ? ok('borderCornerArc:兩臂反向(直線)退化為不生接頭')
    : bad('直線情形未退化');
  const rt = borderCornerArc(0, 0, 1, 0, 0, 1, 5, 1);
  (rt.mode === 'arc' && Math.abs(rt.R - 5) < 1e-9 && Math.abs(Math.abs(rt.sweep) - Math.PI / 2) < 1e-9)
    ? ok('borderCornerArc:直角轉彎 R = L、掃掠 90°(解析解正確)')
    : bad(`直角轉彎解錯誤 ${JSON.stringify(rt)}`);
  const tight = borderCornerArc(0, 0, 1, 0, Math.cos(0.3), Math.sin(0.3), 5, 3);
  (tight.mode === 'cap' && tight.L === Math.min(5, 3))
    ? ok('borderCornerArc:急彎回圓帽且退縮長收到半寬') : bad(`急彎未回圓帽 ${JSON.stringify(tight)}`);
}

console.log('== Ⅶ 掃掠繞向 / 兩側地貌切線 / 拼圖迴避(2026-08-11 使用者回報三項)==');
{
  // ---- 1. Winding: sweepUpY is the single seam, and it truly equals the triangle
  // geometric normal Y component ----
  // On screen this failure reads as a whole dead-black band, while every existing assertion
  // (vertex/alpha/UV/texture) stays green => the audit can only attack the geometric definition:
  // check against an independently computed cross product.
  let upOk = true;
  for (const [tx, tz] of [[1, 0], [0, 1], [-1, 0], [0.6, -0.8], [-0.3, -0.95]]) {
    for (const sgn of [1, -1]) {
      const nx = -tz * sgn, nz = tx * sgn;                       // Cross-section lateral (left / right normal)
      // Triangle A=(0,0), B=A+t, C=A+n: geometric normal y = uz*vx - ux*vz
      const ref = tz * nx - tx * nz;
      if (Math.sign(sweepUpY(tx, tz, nx, nz)) !== Math.sign(ref)) upOk = false;
    }
  }
  upOk ? ok('sweepUpY = 「先切向後橫向」繞向的幾何法線 y 分量(與獨立叉積逐例同號)')
    : bad('sweepUpY 與幾何叉積不符');
  // Straight segments always take cross-section n = (-dz, dx)/l => upY = -l < 0 always
  // negative: every straight piece MUST flip. This is why the 2026-08-11 field test showed
  // flat bands 100% back-facing = all dead black; pinned here as an assertion
  sweepUpY(1, 0, 0, 1) < 0 && sweepUpY(0, 1, -1, 0) < 0
    ? ok('linePath 的斷面取向恆為負 ⇒ 直段一律需要翻繞向(舊制沒翻 = 全部死黑)')
    : bad('linePath 取向假設漂移,請同步 sweepFlat 的 flipOf');
  (/const flipOf = \(path, rings\) => \{[\s\S]{0,260}?sweepUpY\(bx - ax, bz - az, nx, nz\) < 0;/.test(src))
    ? ok('flipOf 由 sweepUpY 判(直段/圓弧共用一支,不是逐處手寫繞向)')
    : bad('flipOf 未走 sweepUpY');
  (/const flip = flipOf\(path, rings\);/.test(src) && /const flip = !flipOf\(path, spans\);/.test(src))
    ? ok('flat 與 ridge 都吃 flipOf(ridge 斷面順序是鏡像 ⇒ 判準取反)')
    : bad('flat / ridge 有一邊沒接繞向判定');
  (/if \(flip\) b\.idx\.push\(p0 \+ k, p0 \+ k \+ 1, q0 \+ k, p0 \+ k \+ 1, q0 \+ k \+ 1, q0 \+ k\);/.test(src)
    && /const tri = \(a2, b2, c2\) => \(flip \? b\.idx\.push\(a2, c2, b2\) : b\.idx\.push\(a2, b2, c2\)\);/.test(src)
    && /const cap = \(a2, b2, c2\) => \(flip \? b\.idx\.push\(a2, c2, b2\) : b\.idx\.push\(a2, b2, c2\)\);/.test(src))
    ? ok('掃掠三角形(帶面 / 脊側面 / 脊端封口)全數依 flip 送繞向')
    : bad('有掃掠面沒吃 flip ⇒ 該面會被 three 反轉法線 = 死黑');
  // Fan pieces (round cap / fork wedge) expand along increasing angle => top-down they wind
  // backward, so winding is always inverted
  (/if \(s\) b\.idx\.push\(b\.base, b\.base \+ s \+ 1, b\.base \+ s\);/.test(src)
    && /b\.idx\.push\(b\.base, b\.base \+ 2 \+ s, b\.base \+ 1 \+ s\);/.test(src))
    ? ok('圓帽與岔路楔形的扇形繞向已倒轉(正面朝上)')
    : bad('扇形件繞向未倒轉 ⇒ 接頭死黑而直段正常 = 顏色不連續');
  src.includes('side: THREE.DoubleSide,   // 弦走向不定 ⇒ 繞向不定,雙面保險')
    ? bad('材質註解仍宣稱「繞向不定靠雙面保險」—— DoubleSide 只保證看得見,不保證亮度')
    : ok('不再以 DoubleSide 當繞向的替代品(它只讓背面看得見,法線照樣被反轉)');

  // ---- 2. Both terrains bounded by the divider line ----
  const W = BORDER_CUT.W;
  (borderCutAlpha(-W, W) === 0 && borderCutAlpha(W, W) === 1 && borderCutAlpha(0, W) === 0.5)
    ? ok(`borderCutAlpha 端點恆定(±${W / 2}m 外恆 0/1、線上恰 0.5)⇒ 與不透明底毯水密`)
    : bad('borderCutAlpha 端點/中點不對');
  let mono = true;
  for (let d = -W; d <= W; d += W / 16) if (borderCutAlpha(d, W) < borderCutAlpha(d - W / 16, W)) mono = false;
  mono ? ok('borderCutAlpha 單調遞增(換手只發生一次,不會來回跳)') : bad('borderCutAlpha 非單調');
  // The handoff band MUST fit inside the narrowest band width -- otherwise the handoff
  // shows outside the pattern as visible bleed
  const minHW = Math.min(...Object.values(BORDER_KINDS).map((d) => d.flat.w / 2));
  (W / 2 + BORDER_CUT.JIT / 2 <= minHW + 1e-9)
    ? ok(`換手半寬 ${(W / 2 + BORDER_CUT.JIT / 2).toFixed(2)}m ≤ 最窄帶半寬 ${minHW.toFixed(2)}m(換手恆藏在圖案底下)`)
    : bad(`換手帶比最窄的分界線還寬(${(W / 2 + BORDER_CUT.JIT / 2).toFixed(2)} > ${minHW.toFixed(2)})⇒ 滲透露在帶外`);
  // planSeamOverlays: pairs that draw a line get cut and emit NO middle transition ridge
  // (a third terrain straddling the border)
  const seamM = src.match(/export function planSeamOverlays\(keys, gnx, gnz, opts = \{\}\) \{[\s\S]*?\n\}/);
  const seamFn = seamM ? new Function(
    src.match(/export const SEAM_STYLES = \{[\s\S]*?\n\};/)[0].replace('export ', '') + '\n' +
    src.match(/export const SEAM_SOFT = .*$/m)[0].replace('export ', '') + '\n' +
    src.match(/export function seamAlpha\(a, q, st\) \{[\s\S]*?\n\}/)[0].replace('export ', '') + '\n' +
    seamM[0].replace('export ', '') + '\nreturn planSeamOverlays;')() : null;
  if (!seamFn) bad('抽不到 planSeamOverlays 原文(標題漂移,請同步稽核)');
  else {
    const N = 8;
    const zc = (k) => ({ t: 'green', w: 'bare' }[k[0]]);
    const g2 = grid(N, N, (i) => i < 4 ? 'turf#0' : 'wild#0');
    const soft = seamFn(g2, N, N, { coarseOf: zc, seed: 7 });
    const hard = seamFn(g2, N, N, { coarseOf: zc, seed: 7, hardOf: () => true });
    (soft.every((o) => !o.cut) && hard.every((o) => o.st?.band || o.cut))
      ? ok('hardOf 命中 ⇒ 逐張外溢帶 cut(鄰格方向);未命中維持舊制淡出(逐位元不變)')
      : bad('hardOf 未正確標記 cut');
    (hard.every((o) => o.cut == null || (Math.abs(o.cut.di) <= 1 && Math.abs(o.cut.dj) <= 1
                                         && (o.cut.di !== 0 || o.cut.dj !== 0))))
      ? ok('cut 帶的是鄰格方向(格索引差,非零)⇒ 消費端判得出哪一側是鄰格的地盤')
      : bad('cut 的鄰格方向不合法');
    const midSoft = seamFn(g2, N, N, { coarseOf: zc, seed: 7 }).filter((o) => o.st?.band);
    const midHard = hard.filter((o) => o.st?.band);
    (midSoft.length > 0 && midHard.length === 0)
      ? ok(`有分界線的組合不出中間過渡脊帶(舊制 ${midSoft.length} 張 → 0;它是橫跨界線的第三種地表)`)
      : bad(`中間過渡脊帶未被切線抑制(soft=${midSoft.length} hard=${midHard.length})`);
    JSON.stringify(seamFn(g2, N, N, { coarseOf: zc, seed: 7, hardOf: () => false }))
      === JSON.stringify(soft)
      ? ok('hardOf 恆 false ⇒ 逐位元同未注入(舊制不受影響)') : bad('hardOf=false 與未注入不等價');
  }

  // ---- 3. Fields / parking / courts / 3D objects MUST NOT straddle dividers ----
  (/const bdCross = \(x, z, r\) => \{[\s\S]{0,300}?bdSegD\(sg, x, z\) < r \+ sg\.hw \+ BORDER_BAND\.PAD/.test(src))
    ? ok('bdCross:足跡半徑 + 帶半寬 + PAD 淨距(迴避的是帶,不是中心線)')
    : bad('bdCross 未把帶寬與淨距算進去');
  // Rejection MUST come before the first rnd() call (same rank as roadClear) -- otherwise
  // the scatter sequence gets rewritten depending on accept/reject
  const tpM = src.match(/const tryPatch = \(x, z, sub, variant, r, rot, depth\) => \{[\s\S]*?\n  \};/);
  if (!tpM) bad('抽不到 tryPatch 原文');
  else {
    // Strip line comments first -- the comment saying before the first rnd() call itself
    // contains that token and would trip this assertion
    const body = tpM[0].replace(/\/\/[^\r\n]*/g, '');
    const iBd = body.indexOf('bdCross('), iRnd = body.indexOf('rnd()');
    (iBd > 0 && iBd < iRnd)
      ? ok('tryPatch 的分界線迴避排在首個 rnd() 之前(確定性序列不變)')
      : bad('tryPatch 的分界線迴避晚於首個 rnd() ⇒ 散布序列被改寫');
  }
  /if \(bdCross\(px, pz, dr\) \|\| roadClear\?\./.test(src)
    ? ok('addDetail 用完整幾何足跡迴避分界線與道路')
    : bad('3D 細節未迴避分界線');
  // Yield direction: the line is structure, puzzle pieces are decoration => onRegular
  // stepped down to a fuse (comment and assertion pinned together)
  src.includes('onRegular is a fuse since 2026-08-11')
    ? ok('onRegular 降級為保險絲(主力改成 tryPatch 先迴避;讓路方向已反轉)')
    : bad('讓路方向的定案沒有留在原文裡');
  // Planning MUST exist exactly once: the emitter consumes the already-planned bdPlan
  ((src.match(/planBorderPuzzle\(keys, gnx, gnz, \{/g) || []).length === 1 && src.includes('const plan = bdPlan;'))
    ? ok('planBorderPuzzle 全檔只呼叫一次,底毯切線 / 拼圖迴避 / 幾何發射同吃一份(單一縫)')
    : bad('planBorderPuzzle 被呼叫多次 ⇒ 切線與畫出來的線可能不是同一條');
  // Planning + index block takes zero shared rnd (2.3): it runs before feature scatter,
  // consuming one would shift the whole map layout
  const planBlk = src.match(/==== Terrain border puzzle: planning \+ spatial index[\s\S]*?\n  \/\/ Hetero-boundary spillover/);
  const planCode = planBlk ? planBlk[0].replace(/\/\/[^\r\n]*/g, '') : '';   // Strip line comments (same reason as tryPatch)
  (planBlk && !/\brnd\(/.test(planCode) && !planCode.includes('Math.random'))
    ? ok('規劃 + 空間索引區塊零共享 rnd()(提前呼叫不推移任何散布,§2.3)')
    : bad(planBlk ? '規劃區塊消耗了共享 rnd()' : '找不到規劃區塊(標題漂移,請同步稽核)');
  // Band-edge organic wobble: MUST take world coords so shared endpoints agree (taking
  // along-line parameters forks the seam at joints)
  (/const eN = \(x, z, s\) => 1 \+ BORDER_BAND\.EDGE_A/.test(src)
    && /vnoise\(x \* BORDER_BAND\.EDGE_W, z \* BORDER_BAND\.EDGE_W, seed \^ s\)/.test(src))
    ? ok('帶緣起伏吃世界座標的 vnoise(相鄰 tile 與接頭共用端點同值,邊緣不開叉)')
    : bad('帶緣起伏未吃世界座標');
  (/const eL = eN\(cx, cz, 0x1F17\), eR = eN\(cx, cz, 0x2E29\)/.test(src)
    && (src.match(/eN\(cx, cz, 0x1F17\)/g) || []).length === 2)
    ? ok('直段與岔路楔形取同一組起伏種子(楔形與直段接得上)')
    : bad('岔路楔形未與直段共用帶緣起伏 ⇒ 路口處帶寬對不上');
  // Yield sampling radius MUST be the wobbled outer edge, so the drawn edge always stays
  // inside the verified corridor
  (/d\.flat\.w \/ 2 \* \(1 \+ BORDER_BAND\.EDGE_A\)/.test(src))
    ? ok('hwOfKind 取起伏後的最外緣(讓路取樣與迴避半徑蓋得住真的畫出來的邊)')
    : bad('hwOfKind 仍取標稱半寬 ⇒ 起伏出去的帶緣沒被驗到');
  // Texture pitch MUST derive from band width (a fixed 9m stretches narrow bands into
  // unreadable lines)
  (/const bTexL = \(kd\) => Math\.max\(BORDER_BAND\.TEX_MIN, kd\.w \* BORDER_BAND\.TEX_F\)/.test(src)
    && !/BTEXL/.test(src))
    ? ok('貼圖一輪世界長由帶寬推導(bTexL),固定 BTEXL 已退場')
    : bad('貼圖節距仍是手寫固定值');
}

console.log('== Ⅳ 對照組(反向驗證內建:壞版本必須被抓到)==');
{
  const N = 24;
  const keys = grid(N, N, (i, j) => i + j < N ? 'turf#0' : 'wild#0');
  const opt = { coarseOf, cornerXZ: jitXZ, driftMax: DRIFT };
  // (a) bin folded to 4 directions -> section III binning check MUST have teeth
  const binBad = planM[0].replace('const STEP = (Math.PI * 2) / BORDER_DIRS;', 'const STEP = (Math.PI * 2) / 4;');
  if (binBad === planM[0]) bad('對照組 ⓐ 替換點失配(原文已漂移,請同步稽核)');
  else {
    const ts = allTiles(build(binBad).planBorderPuzzle(keys, N, N, opt));
    ts.some((t) => angDiff(Math.atan2(t.z1 - t.z0, t.x1 - t.x0), t.bin * ANG) > ANG / 2 + 1e-9)
      ? ok('對照組ⓐ:4 方向壞版本確實違反 16 方向落格(Ⅲ 檢查有牙)')
      : bad('對照組ⓐ:壞版本未呈現預期缺陷(Ⅲ 驗不到東西)');
  }
  // (b) greedy-extension drift cap removed -> honestly recomputed drift MUST blow past
  const driftBad = planM[0].replace('if (d > driftMax) { fit = false; break; }', 'if (false) { fit = false; break; }');
  if (driftBad === planM[0]) bad('對照組 ⓑ 替換點失配(原文已漂移,請同步稽核)');
  else {
    const ts = allTiles(build(driftBad).planBorderPuzzle(keys, N, N, opt));
    ts.some((t) => t.drift > DRIFT + 1e-9)
      ? ok('對照組ⓑ:無上限壞版本的 tile drift 超限(誠實重算與 Ⅲ 檢查有牙)')
      : bad('對照組ⓑ:壞版本未呈現預期缺陷(Ⅲ 驗不到東西)');
  }
  // (d) straight pull-back removed (joint end tr=0) -> VI-2 / VI-3 no-butt-join guarantee
  // MUST have teeth
  const noTrim = planM[0].replace(/A\.tl\[A\.e \? 'tr1' : 'tr0'\] = g\.L;/, "A.tl[A.e ? 'tr1' : 'tr0'] = 0;");
  if (noTrim === planM[0]) bad('對照組 ⓓ 替換點失配(原文已漂移,請同步稽核)');
  else {
    const p = build(noTrim).planBorderPuzzle(keys, N, N, OPT_J);
    let anyZero = false, anyOff = false;
    for (const c of p.chains) for (const tl of c.tiles) {
      for (const [cor, ex, ez, tr] of [[tl.c0, tl.ax, tl.az, tl.tr0], [tl.c1, tl.bx, tl.bz, tl.tr1]]) {
        if (!cor) continue;
        if (tr === 0) anyZero = true;
        const g = cor.geo;
        const hit = (Math.abs(g.Pa[0] - ex) < 1e-9 && Math.abs(g.Pa[1] - ez) < 1e-9)
                 || (Math.abs(g.Pb[0] - ex) < 1e-9 && Math.abs(g.Pb[1] - ez) < 1e-9);
        if (!hit) anyOff = true;
      }
    }
    (anyZero && anyOff)
      ? ok('對照組ⓓ:不退縮的壞版本讓直段頂到節點、切點對不上(Ⅵ-②③ 有牙)')
      : bad('對照組ⓓ:壞版本未呈現預期缺陷(Ⅵ-②③ 驗不到東西)');
  }
  // (e) arc joint degraded to straight (two straight bands butt-joined) -> VI-1 MUST have teeth
  const noArc = arcM[0].replace('if (phi < 1e-4) return', 'if (true) return');
  if (noArc === arcM[0]) bad('對照組 ⓔ 替換點失配(原文已漂移,請同步稽核)');
  else {
    const p = build(planM[0], noArc).planBorderPuzzle(keys, N, N, OPT_J);
    p.corners.length === 0
      ? ok('對照組ⓔ:轉彎不生接頭拼圖的壞版本 corners 全空(Ⅵ-① 有牙)')
      : bad('對照組ⓔ:壞版本仍生出接頭(Ⅵ-① 驗不到東西)');
  }
  // (c) relay splitting removed (one kind per chain) -> II-6 in-chain relay MUST have teeth
  const relayBad = planM[0].replace(
    "if (e === ch.kinds.length || ch.kinds[e] !== ch.kinds[s0]) { segs.push([s0, e, ch.kinds[s0]]); s0 = e; }",
    "if (e === ch.kinds.length) { segs.push([s0, e, ch.kinds[s0]]); s0 = e; }");
  if (relayBad === planM[0]) bad('對照組 ⓒ 替換點失配(原文已漂移,請同步稽核)');
  else {
    const kT = grid(8, 8, (i, j) => i < 4 ? 'turf#0' : j < 4 ? 'wild#0' : 'concrete#0');
    const kindOf2 = (a, b) => {
      const pair = [a, b].sort().join('|');
      return { 'turf|wild': 'trail', 'concrete|turf': 'fence', 'concrete|wild': null }[pair] || null;
    };
    const rT = allTiles(build(relayBad).planBorderPuzzle(kT, 8, 8, { coarseOf, kindOf: kindOf2 }));
    !(rT.some((t) => t.kind === 'trail' && t.x1 === 4 && t.z1 === 4)
      && rT.some((t) => t.kind === 'fence' && t.x0 === 4 && t.z0 === 4))
      ? ok('對照組ⓒ:整鏈單一種類的壞版本切點消失(Ⅱ-⑥ 接力檢查有牙)')
      : bad('對照組ⓒ:壞版本未呈現預期缺陷(Ⅱ-⑥ 驗不到東西)');
  }
  // (f) winding never flipped (back to the old unconditional winding) -> VII-1 source
  // assertion MUST go red
  //   sweepFlat lives in buildGroundCover (needs THREE); offline only the source is visible
  //   => the control group also cuts the source
  const noFlip = src.replace(
    /if \(flip\) b\.idx\.push\(p0 \+ k, p0 \+ k \+ 1, q0 \+ k, p0 \+ k \+ 1, q0 \+ k \+ 1, q0 \+ k\);\r?\n\s*else /,
    '');
  if (noFlip === src) bad('對照組 ⓕ 替換點失配(原文已漂移,請同步稽核)');
  else {
    !/if \(flip\) b\.idx\.push\(p0 \+ k, p0 \+ k \+ 1, q0 \+ k, p0 \+ k \+ 1, q0 \+ k \+ 1, q0 \+ k\);/.test(noFlip)
      ? ok('對照組ⓕ:拿掉繞向翻轉的壞版本被 Ⅶ① 抓到(死黑那條有牙)')
      : bad('對照組ⓕ:壞版本未呈現預期缺陷(Ⅶ① 驗不到東西)');
  }
  // (g) cut line does not suppress the middle transition ridge -> VII-2 third-terrain check
  // MUST go red (executes source)
  const seamSrc = src.match(/export function planSeamOverlays\(keys, gnx, gnz, opts = \{\}\) \{[\s\S]*?\n\}/);
  const seamBuild = (text) => new Function(
    src.match(/export const SEAM_STYLES = \{[\s\S]*?\n\};/)[0].replace('export ', '') + '\n' +
    src.match(/export const SEAM_SOFT = .*$/m)[0].replace('export ', '') + '\n' +
    src.match(/export function seamAlpha\(a, q, st\) \{[\s\S]*?\n\}/)[0].replace('export ', '') + '\n' +
    text.replace('export ', '') + '\nreturn planSeamOverlays;')();
  const midBad = seamSrc[0].replace('if (st.mid && z0 && !hard && !seenMid.has(st.mid))',
                                    'if (st.mid && z0 && !seenMid.has(st.mid))');
  if (midBad === seamSrc[0]) bad('對照組 ⓖ 替換點失配(原文已漂移,請同步稽核)');
  else {
    const N = 8, zc = (k) => ({ t: 'green', w: 'bare' }[k[0]]);
    const g3 = grid(N, N, (i) => i < 4 ? 'turf#0' : 'wild#0');
    seamBuild(midBad)(g3, N, N, { coarseOf: zc, seed: 7, hardOf: () => true }).some((o) => o.st?.band)
      ? ok('對照組ⓖ:不抑制脊帶的壞版本又冒出橫跨界線的第三種地表(Ⅶ② 有牙)')
      : bad('對照組ⓖ:壞版本未呈現預期缺陷(Ⅶ② 驗不到東西)');
  }
  // (h) cut alpha not clamped at endpoints -> VII-2 watertight check MUST go red
  // (executes source)
  const cutBad = cutFnM[0].replace('d <= -w / 2 ? 0 : d >= w / 2 ? 1 : ', '');
  if (cutBad === cutFnM[0]) bad('對照組 ⓗ 替換點失配(原文已漂移,請同步稽核)');
  else {
    const f = new Function(cutBad.replace('export ', '') + '\nreturn borderCutAlpha;')();
    (f(-BORDER_CUT.W, BORDER_CUT.W) !== 0 || f(BORDER_CUT.W, BORDER_CUT.W) !== 1)
      ? ok('對照組ⓗ:不夾端點的壞版本 α 溢出 [0,1](與不透明底毯的水密檢查有牙)')
      : bad('對照組ⓗ:壞版本未呈現預期缺陷(Ⅶ② 驗不到東西)');
  }
}

console.log('== Ⅴ 靜態接線(單一縫 / 舊制不回歸 / 圖層紀律)==');
{
  /planBorderPuzzle\(keys, gnx, gnz, \{[\s\S]{0,400}?cornerXZ: cornerAt,[\s\S]{0,200}?driftMax: cell \* 0\.6/.test(src)
    ? ok('buildGroundCover 經 planBorderPuzzle 規劃且吃底毯抖動角點 cornerAt(單一縫)')
    : bad('發射端未走 planBorderPuzzle(第二份實作?)');
  planM[0].includes('kindOf = borderKindOf')
    ? ok('planBorderPuzzle 種類解析預設走 borderKindOf(單一縫)')
    : bad('planBorderPuzzle 未接 borderKindOf');
  (!/const PROB = \{ hedge/.test(src) && !src.includes('pickKind') && !src.includes('stonewall'))
    ? ok('舊邊界遮蔽物(逐格邊擲骰 hedge/fence/stonewall/dike)已退場,不得回歸')
    : bad('舊遮蔽物殘留(pickKind/PROB/stonewall)');
  // The two old butt-join tricks MUST NOT regress
  (!/if \(j0\) \{ ax -= ux \* w2/.test(src) && !src.includes('emitRidgeT'))
    ? ok('舊制「脊端外延半寬互搭」已退場(轉彎改由掃掠圓弧的完整拼圖表達)')
    : bad('脊端外延的黏接手法殘留');
  (!src.includes('岔路拼圖:節點墊片') && !/const R = w \* 0\.8, lift/.test(src))
    ? ok('舊制「岔路圓盤墊片」已退場(改逐臂楔形,各臂帶自己的圖案)')
    : bad('岔路墊片殘留');
  (src.includes('const [path, len] = linePath(tl)') && src.includes('arcPath(g, s0, s1)'))
    ? ok('直段與轉彎共用同一支掃掠(linePath / arcPath 只換中心線)')
    : bad('轉彎未走共用掃掠(可能另寫了對接幾何)');
  src.includes('halfWidthOf: hwOfKind')
    ? ok('發射端把型錄半寬注入規劃器(接頭退縮量由真實帶寬推導,不手寫)')
    : bad('規劃器未取得帶寬 ⇒ 退縮量與帶寬脫鉤');
  src.includes('zoneOf: (i, j) => zoneGrid[j * gnx + i]')
    ? ok('地貌取 zoneGrid(格子自己的分區),不由款式反查(steppe/scree 兩屬會誤判高地)')
    : bad('未傳 zoneOf ⇒ 高地內部會長出假的跨地貌界線');
  // Yield check: straights and joints MUST share one routine (joints checking only the
  // node point leaves the swept arc unverified = dividers crossing roads)
  (/const tileRuns = \(tl, aq, hw\)/.test(src) && /const cornerOk = \(cor, aq\)/.test(src)
    && /const forkOkAt = \(fk\)/.test(src) && src.includes('for (const a of fk.arms)'))
    ? ok('轉彎沿弧取樣、岔路逐臂取樣:讓路判定與直段共用 ptOk/segOk(單一縫)')
    : bad('接頭未做逐點讓路判定 ⇒ 分界線會壓過道路走廊');
  // Yield MUST be per-segment: one boolean per piece means one parking lot erases a 900m
  // straight border
  (src.includes('for (const [r0, r1] of nf.runs)') && !/const okA = ch\.tiles\.map/.test(src))
    ? ok('讓路逐段切分(runs),不是整片全有或全無')
    : bad('讓路仍是整片判定 ⇒ 長交界會被單一障礙整條抹除');
  (src.includes('ptOk(px + nx, pz + nz, aq)') && src.includes('ptOk(px - nx, pz - nz, aq)'))
    ? ok('讓路取樣連兩側帶緣一起驗(帶有寬度,只驗中心線會讓帶緣伸進馬路)')
    : bad('讓路只驗中心線 ⇒ 帶緣仍會壓到道路走廊');
  (src.includes('if (!forkOk.get(fk.n)) continue;') && src.includes('cornerOk(tl.c0'))
    ? ok('接頭讓路失敗時直段那一端收成 α=0(不會停在半空)')
    : bad('接頭被剔除後直段端點未收尾');
  (!/rnd\(/.test(planM[0]) && !planM[0].includes('Math.random') && !planM[0].includes('THREE')
    && !/rnd\(/.test(kindOfM[0]))
    ? ok('planBorderPuzzle / borderKindOf 原文零 rnd / 零 Math.random / 零 THREE(純函式,A4)')
    : bad('規劃/解析摻入 rnd / Math.random / THREE');
  // Emitter takes zero shared rnd (2.3): layout vs appearance differences all derive from
  // seed + node-index hash
  const emitM = src.match(/==== Terrain border puzzle emission[\s\S]*?\n  \}\n\n  \/\/ ---- Feature color-block Mesh/);
  emitM && !/\brnd\(/.test(emitM[0])
    ? ok('發射端零共享 rnd() 消耗(佈局不推移其他散布,§2.3)')
    : bad(emitM ? '發射端消耗了共享 rnd()' : '找不到發射端區塊(標題漂移,請同步稽核)');
  // lift band and renderOrder layer discipline
  const liftM = src.match(/bLift = \(kind\) => ([0-9.]+) \+ bKinds\.indexOf\(kind\) \* ([0-9.]+)/);
  const nK = Object.keys(BORDER_KINDS).length;
  (liftM && +liftM[1] > 0.124 && +liftM[1] + (nK - 1) * +liftM[2] < 0.135 - 1e-9)
    ? ok(`flat 帶 lift ∈ [${liftM[1]}, ${(+liftM[1] + (nK - 1) * +liftM[2]).toFixed(4)}]:高於不規律 fade 上限 0.124、低於規律 ink 下限 0.135`)
    : bad('flat 帶 lift 越出圖層階梯(或常數漂移)');
  const roM = src.match(/renderOrder = (-[0-9.]+) \+ bKinds\.indexOf\(kind\) \* ([0-9.]+)/);
  (roM && +roM[1] > -1.2 && +roM[1] + (nK - 1) * +roM[2] < 0)
    ? ok(`flat 帶 renderOrder ∈ [${roM[1]}, ${(+roM[1] + (nK - 1) * +roM[2]).toFixed(3)}]:晚於脊帶 -1.2、早於特徵層 0`)
    : bad('flat 帶 renderOrder 越界(或常數漂移)');
  (src.match(/const subCoarse = new Map\(\)/g) || []).length === 1
    ? ok('subCoarse 分區表仍只有一份(交界樣式與界線拼圖共用,單一縫)')
    : bad('subCoarse 分區表出現多份實作');
}

// ===== VI divider band forces dry terrain (2026-08-13 user decision) =====
// Keep water/marsh inside divider bands from triggering abnormal states. This section checks
// wiring direction: the mask is produced by ground.js, consumed by biomes.terrainEnvCode,
// installed by main.js after buildBiomes. Installing early is a border-changes-zone /
// zone-changes-border cycle, symptom is a different map every build -- and no existing
// assertion can see it (each cell still follows the rule).
console.log('\n== Ⅵ 分界線帶內強制乾地(水域/沼澤不觸發異常狀態)==');
{
  const bio = readSrc('public', 'js', 'biomes.js');
  const mainSrc = readSrc('public', 'js', 'main.js');
  const dryM = src.match(/export function makeBandMask\(grid, sc, hwMax\) \{[\s\S]*?\n\}/);
  dryM ? ok('ground.js 有 makeBandMask(規則唯一縫)') : bad('ground.js 找不到 makeBandMask');
  if (dryM) {
    // Pure geometry: only asks whether distance to a center line is within that kind band
    // half-width; zero rnd / zero THREE / no terrain height
    (!/\brnd\(/.test(dryM[0]) && !dryM[0].includes('Math.random') && !dryM[0].includes('THREE')
      && !dryM[0].includes('heightAt'))
      ? ok('makeBandMask 是 (x,z) 的純函式:零 rnd / 零 THREE / 不看高程(§2.3)')
      : bad('makeBandMask 摻入 rnd / THREE / 高程查詢');
    // Half-width MUST take that indexed segment own hw (= hwOfKind, incl. edge wobble) --
    // hard-coding one number over-covers narrow kinds and under-covers the wide one, while on
    // screen it only freezes occasionally
    /<= sg\.hw\) return true;/.test(dryM[0])
      ? ok('遮罩半徑取該段自己的帶半寬 sg.hw(hwOfKind ⇒ 恰好蓋住畫出來的圖案)')
      : bad('遮罩半徑不是逐段帶半寬(寫死數字 = 與真正畫出來的帶脫鉤)');
    // Scan grid count derives from half-width (scanning only the home cell misses the
    // widest beach band near grid borders)
    /const n = Math\.max\(1, Math\.ceil\(hwMax \/ sc\)\);/.test(dryM[0])
      ? ok('掃描格數由最寬帶半寬推導,不手寫') : bad('makeBandMask 的掃描範圍寫死');
    // Lives at module level: writing it as an inner closure of buildGroundCover would pin
    // the whole build scope (A25)
    /const bandDryAt = makeBandMask\(bdGrid, BSC, BD_HW_MAX\);/.test(src)
      ? ok('遮罩由模組層工廠產出(閉包只留索引,不留整個建構作用域;A25)')
      : bad('遮罩是建構函式的內層閉包 ⇒ 底毯 buckets / 細節清單會跟著活到戰鬥結束');
  }
  src.includes('orphans: orphanQuads, bandDryAt')
    ? ok('buildGroundCover 把 bandDryAt 交出去') : bad('buildGroundCover 未回傳 bandDryAt');
  bio.includes('group.userData.bandDryAt = ground.bandDryAt')
    ? ok('biomes 只把遮罩掛進 userData(不在建圖期裝上去)') : bad('biomes 未交出 bandDryAt');
  /terrain\.inBorderBand = null;/.test(bio)
    ? ok('buildBiomes 開頭清空 terrain.inBorderBand(再戰回房重建同一個 terrain 不沿用舊遮罩)')
    : bad('buildBiomes 未清空遮罩 ⇒ 重建時界線會反過來推分區(循環相依)');
  // Clearing MUST run before buildGroundCover (otherwise it clears this round just-installed copy)
  (bio.indexOf('terrain.inBorderBand = null;') < bio.indexOf('buildGroundCover(group, terrain'))
    ? ok('清空排在 buildGroundCover 之前') : bad('清空排在建圖之後 ⇒ 等於沒清');
  /if \(terrain\.inBorderBand\?\.\(x, z\)\) return 0;/.test(bio)
    ? ok('terrainEnvCode 消費遮罩(客戶端 _envAt / bakeWetGrid / 沼澤面同吃這一支)')
    : bad('terrainEnvCode 未消費遮罩 ⇒ 帶上照樣涉水凍結/陷沼扣血');
  // Exactly one install point, and it MUST sit after buildBiomes and before bakeWetGrid
  (mainSrc.match(/terrain\.inBorderBand = /g) || []).length === 1
    ? ok('安裝點恰一處(main.js)') : bad('terrain.inBorderBand 有多個安裝點或缺席');
  {
    const iBuild = mainSrc.indexOf('await buildBiomes(cfg, terrain');
    const iSet = mainSrc.indexOf('terrain.inBorderBand = ');
    const iBake = mainSrc.indexOf('wet: bakeWetGrid(app.terrain)');
    (iBuild > 0 && iSet > iBuild && iBake > iSet)
      ? ok('安裝排在 buildBiomes 之後、bakeWetGrid 之前(兩個消費端同吃同一份規則)')
      : bad('安裝點順序錯:MUST 在 buildBiomes 之後、水沼網格烘烤之前');
  }
  // ground.js MUST NOT read this mask itself (reading it is a silent circular dependency)
  !src.includes('inBorderBand')
    ? ok('ground.js 不讀 terrain.inBorderBand(遮罩只出不進)')
    : bad('ground.js 讀了 inBorderBand ⇒ 分區與界線互相決定');
}

console.log(fail ? `\nFAIL(${fail} 項)` : '\nALL PASS');
process.exit(fail ? 1 : 0);
