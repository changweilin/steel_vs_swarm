// Terrain patch color and pattern audit (2026-08-12 user request) -- node tools/audit_ground_tile.mjs
//
// User words (first two items of the same message):
//   1. Patches sometimes flip green-red-gray suddenly; within one type (urban/green/bare/
//      water/wet), avoid fast short-range color jumps as much as possible
//   2. Same-color patches can carry different patterns/motifs/sprinkles; adjacent same-color
//      patches should differ whenever possible
//   3. The off-limits buffer ring past the border must also get terrain patches
//
// Lesion (1): picking is per-cell low-frequency-noise t -> roster index. Rosters hold 10-12
// kinds with wide color spans (green roster: turf green / flowerfield red / deadwood gray),
// and t gradients can sweep several indices within a dozen meters on steep noise slopes =>
// walking that band reads green-red-gray. Each cell follows the rule, and every old assertion
// (watertight/spillover/border) stays green -- which is why this audit exists.
//
// Three seams, pinned one by one:
//   I Picking block carpetLotAt -- jittered-grid nearest-point split (jittered-Voronoi).
//     Jitter MUST stay under half a cell (else the nearest lot center falls outside the 3x3
//     candidates = split hole); pure function, deterministic; swap spacing is measured by a
//     built-in control: same field with sampling back at cell centers (= old rule) vs lot
//     version -- the only measurable proxy for no fast short-range color jumps.
//   II Per-cell pattern planCarpetVariants -- hard rule: edge-adjacent same-kind neighbors
//     always differ; soft rule: diagonals differ too; other kinds unconstrained;
//     deterministic, zero rnd. Control = old low-frequency-noise variant.
//   III Static rules (execute source) -- base color does not drift with variant (baseFill),
//     picking uses lot centers, keys assembled in two passes, same-kind different-variant
//     emits no spillover, buffer-ring carpet (mirror / coarse cells / bufferHeightAt / same
//     buckets / zero rnd), ground-face emission has only the emitFace implementation
//     (and in-map no longer routes through it).
//   IV Adopt-terrain-triangles (2026-08-13 user decision A; the half that renders land patches
//     directly onto terrain) -- old carpet cut its own 3x3 with heightAt vertices: vertices
//     sit on terrain but edges between them are straight, so chords crossing terrain creases
//     sink = slope breakage. New rule separates what to draw from which triangles to draw on:
//     planning grid unchanged (incl. jitter), emission adopts one owner quad per terrain quad
//     => skin triangles equal terrain triangles. This section measures geometry rules (inQuad
//     split has exactly one owner, owners stay inside 3x3, invBil corner identity and shared
//     edge agreement) and wiring (index order matches terrain.js literally, beach gate still
//     whole-cell, in-map no longer takes drape lift, terrain vertex count derived not written).
//   V Four-season farm surfaces (2026-08-13 user request: fields plus veggie plots, pasture,
//     fish ponds, orchards, all season-aware) -- old seasons were one SEASON_TINT multiply
//     filter. Feed painter sources into a recording fake 2D context: all four seasons MUST
//     draw different things and not just the base color (base-color-only = that filter again);
//     also roster alignment (painters taking season match DEFS flagged seasonal, missing flag
//     = double tinting), season only enters the cache key (draw calls unchanged), pasture
//     registration complete.
//
//   VI Picking-roster color path (2026-08-13 user follow-up: same type should not jump
//     sub-kinds at short range) -- block I fixed swap frequency only, amplitude untouched:
//     if roster index adjacency is not color adjacency (green roster: meadow tan, deadwood
//     gray, turf green), colors still jump no matter how smooth t is. New rule collects
//     representative colors into one table (SUB_COL, shared by painters and sorter) and sorts
//     rosters into color paths (carpetOrder). This section checks roster coverage (both
//     directions), painters really eat the table, sorting keeps multiplicity and same-kind
//     runs, bottleneck step never worsens, and both consumers (post-winter-override
//     carpetLists / enclave styles) are sorted.
//   VII Many sprinkles on same-color patches (user: flowers on grass, pebbles on sand, fish
//     in water, and so on) -- every carpet surface MUST scatter at least two sprinkle kinds
//     (old sand had only pebbles, marsh only reeds, deep water empty); fish MUST enter AQ_DET
//     and MUST sink below the surface (on-surface = floating fish).
//
// Reverse verification: --break-lot restores cell-center sampling => I goes red (spacing
//   collapses to the old rule); --break-var restores low-frequency-noise variants => II goes
//   red (edge-adjacent same-kind shares one variant); --break-order keeps roster order =>
//   VI goes red (index adjacency is no longer color adjacency); --break-adopt restores
//   diagonal-split triangles => IV goes red (concave quads double-claimed with neighbors)
// Source text goes through the audit_src.mjs single seam (CRLF workspaces: per-line comment
// stripping silently breaks).
//
// ---- Seam discipline: two coplanar sheets are a COIN TOSS, not layers (merged 2026-08-16,
//      plan doc 4-4; comments only, zero assertion changes) ----
// Section IV (adopt-terrain-triangles) makes three in-map layers (carpet / spillover / ridge
// band) deliberately coplanar with terrain -- that is the 2026-08-13 user-decided fix, and the
// exact center of this trap family. The full rule:
//
//  (a) Two coplanar sheets at the same height: the renderer lets either win depending on
//     camera position (may flip per frame and per camera). It is not layers, it is a coin
//     re-tossed every frame. Only one reading rule, and it is counter-intuitive:
//
//       > A material change with a pixel-identical frame never means a subtle change --
//       > that face was never drawn at all.
//
//     Reference project measured it three times: a roof slab coplanar with the mass it covers
//     (material darkened three times, three screenshots bit-identical), a shutter hanging on
//     the facade line plus 0.06 where the lintel face also lands, a menu bar coplanar with its
//     cover panel (three of five buttons invisible). This project prescription is NOT more
//     height but two rules:
//       - Lift staircase (ground.js: carpet CLIFT 0.070 < spillover 0.100-0.107 < irregular
//         fade 0.110-0.124 < regular ink 0.135-0.172 < road 0.18) -- every layer owns one step,
//         and that spacing is eaten by the SAG cap (SAG.ROAD 0.10 < road 0.18 minus carpet
//         0.07 headroom);
//       - polygonOffset -- for things that MUST be coplanar (biomes.js road -2 / bridge -3 /
//         tunnel roof -1 / UND.COPE curb -1): where lifting is impossible, pull toward camera.
//     => Before adding a sixth ground layer, or making any new decal coplanar with terrain,
//     MUST ask which staircase step it owns; two things squeezed into one step read as visible
//     from one angle and gone from another, while every assertion in this file stays green
//     (it measures planning: picking / variant / adoption, not who won the draw).
//  (b) Coplanarity is deliberate here, so its guarantee MUST come from the same triangles,
//     not from height gaps. Section IV pins index order literally matching terrain.js
//     (a,c,b)(b,c,d): same vertices + same winding => both sheets are numerically one plane
//     with bit-identical depth => z-fighting is not suppressed, it does not exist. Conversely,
//     any handy lift-1cm fix on the adopted layer re-creates breakage (that is the other half
//     audit_ground_drape measures: over-lift = grass over road).
//  (c) The verdict surface is not this file. Only pixels can tell who won the toss, so the
//     staged shots A/B of tools/shot_scene.mjs are the sole judge, and its header states the
//     same reading rule. This file guards the upstream: exactly one adoption owner, shared
//     edges bit-identical, in-map no longer takes drapeSag.
'use strict';
import { DEFS, SURFACES } from '../public/js/groundCatalog.js';
import { GROUND_PARTS } from '../public/js/groundPartCatalog.js';
import { paintGround, surfaceEnvironment } from '../public/js/proceduralGround.js';
import { readSrc } from './audit_src.mjs';

let fail = 0;
const bad = (m, x = '') => { console.log('  ✗', m, x); fail++; };
const ok = (m) => console.log('  ✓', m);
const t = (m, cond, x = '') => (cond ? ok(m) : bad(m, x));

const BREAK_LOT = process.argv.includes('--break-lot');
const BREAK_VAR = process.argv.includes('--break-var');
const BREAK_ADOPT = process.argv.includes('--break-adopt');
const BREAK_ORDER = process.argv.includes('--break-order');

const src = readSrc('public', 'js', 'ground.js') + '\n' + readSrc('public', 'js', 'groundCatalog.js').replaceAll('export const ', 'const ');
const grab = (re, name) => {
  const m = src.match(re);
  if (!m) { console.log(`x ground.js 原文抽取失敗:${name}`); process.exit(1); }
  return m[0].replace('export ', '');
};
// All four are dependency-free pure functions/data => extract source and run the real thing
// (copying a formula into the audit only verifies the copy)
const VNOISE = grab(/function vnoise\(x, z, seed\) \{[\s\S]*?\n\}/, 'vnoise');
const LOT_CFG = grab(/export const CARPET_LOT = .*$/m, 'CARPET_LOT');
const SEL_CFG = grab(/export const CARPET_SEL = .*$/m, 'CARPET_SEL');
const LOT_FN = grab(/export function carpetLotAt\([\s\S]*?\n\}/, 'carpetLotAt');
const VAR_FN = grab(/export function planCarpetVariants\([\s\S]*?\n\}/, 'planCarpetVariants');
// The color-path sorting family (2026-08-13): representative table + distance + sort;
// same four dependency-free => run the real thing
const BRICK = grab(/const BRICK_C = \[[\s\S]*?\];/, 'BRICK_C');
const HEXOF = grab(/const hexOf = .*$/m, 'hexOf');
const MEANH = grab(/const meanHex = \([\s\S]*?\n\};/, 'meanHex');
const COLTAB = grab(/export const SUB_COL = \{[\s\S]*?\n\};/, 'SUB_COL');
const COLD = grab(/export function colDist\(h1, h2\) \{[\s\S]*?\n\}/, 'colDist');
const ORDER = grab(/export function carpetOrder\([\s\S]*?\n\}/, 'carpetOrder');
const CARPET = new Function(`${src.match(/const CARPET = \{[\s\S]*?\n\};/)[0]}\nreturn CARPET;`)();
const ENCST = new Function(`${src.match(/export const ENCLAVE_STYLES = \{[\s\S]*?\n\};/)[0].replace('export ', '')}
  return ENCLAVE_STYLES;`)();
const M = new Function(`${VNOISE}\n${LOT_CFG}\n${SEL_CFG}\n${LOT_FN}\n${VAR_FN}
  ${BRICK}\n${HEXOF}\n${MEANH}\n${COLTAB}\n${COLD}\n${ORDER}
  return { vnoise, CARPET_LOT, CARPET_SEL, carpetLotAt, planCarpetVariants,
           SUB_COL, colDist, carpetOrder };`)();
const { vnoise, CARPET_LOT, CARPET_SEL, carpetLotAt, planCarpetVariants,
        SUB_COL, colDist, carpetOrder } = M;

console.log('== Ⅰ 選款區塊(顏色的最小尺度)==');
{
  t(`抖動 ${CARPET_LOT.JIT} < 0.5 格距(超過的話最近的 lot 中心會落在 3×3 候選之外 = 分割破洞)`,
    CARPET_LOT.JIT < 0.5 - 1e-9);
  t(`區塊間距 ${CARPET_LOT.CELLS} 格(以底毯格數計 ⇒ 改 cell 自己跟著走,不手寫公尺數)`,
    Number.isInteger(CARPET_LOT.CELLS) && CARPET_LOT.CELLS >= 3);
  // Is the 3x3 candidate set enough: compare cell-by-cell against 7x7 brute force (this is
  // the behavioral proof of JIT < 0.5, not a restatement of the constant)
  const S = CARPET_LOT.CELLS, JIT = CARPET_LOT.JIT, SEED = 0xC0FFEE | 0;
  const site = (li, lj) => [
    (li + 0.5 + (vnoise(li, lj, (SEED ^ 0x1F3A) | 0) - 0.5) * 2 * JIT) * S,
    (lj + 0.5 + (vnoise(li, lj, (SEED ^ 0x77C1) | 0) - 0.5) * 2 * JIT) * S];
  let brute = 0;
  for (let j = -20; j < 60; j++) {
    for (let i = -20; i < 60; i++) {
      const gi = Math.floor(i / S), gj = Math.floor(j / S);
      let bi = null, bd = Infinity;
      for (let oj = -3; oj <= 3; oj++) {
        for (let oi = -3; oi <= 3; oi++) {
          const [cx, cz] = site(gi + oi, gj + oj);
          const d = (cx - i - 0.5) ** 2 + (cz - j - 0.5) ** 2;
          if (d < bd) { bd = d; bi = [gi + oi, gj + oj]; }
        }
      }
      const got = carpetLotAt(i, j, SEED);
      if (got[0] !== bi[0] || got[1] !== bi[1]) brute++;
    }
  }
  t('最近點分割正確:3×3 候選與 7×7 暴力搜尋逐格同解(6400 格)', brute === 0, `（${brute} 格分歧）`);
  t('決定性(同輸入重呼逐位元相同)',
    JSON.stringify(carpetLotAt(7, 11, SEED)) === JSON.stringify(carpetLotAt(7, 11, SEED)));
  t('純函式:carpetLotAt / planCarpetVariants 原文零 rnd / 零 Math.random / 零 THREE(§2.3、A4)',
    !/\brnd\s*\(|Math\.random|THREE/.test(LOT_FN) && !/\brnd\s*\(|Math\.random|THREE/.test(VAR_FN));

  // ---- Swap spacing: two controls ----
  //   (a) Current formula with sampling back at cell centers -- measures whether the lot
  //   layer itself does anything;
  //   (b) Frozen ship baseline (2026-08-12 build: cell-center sampling + W 0.006 + SPAN 2.2)
  //      -- measures how much this round improved the user-reported issue. The two numbers of
  //      (b) MUST be hand-written and labeled historical: following CARPET_SEL would compare
  //      new against new after a frequency tune and stay green forever (2026-08-13 measurement:
  //      the short-run share of (a) alone dropped to 4%, so the old quarter-of-control gate
  //      lost its teeth on the spot).
  const LEGACY = { W: 0.006, SPAN: 2.2 };
  const CELL = 13, LIST = CARPET.bare.length;
  const pickAt = (wx, wz, cfg = CARPET_SEL) => {
    const t2 = Math.min(0.999, Math.max(0,
      (vnoise(wx * cfg.W, wz * cfg.W, SEED) - 0.5) * cfg.SPAN + 0.5));
    return (t2 * LIST) | 0;
  };
  const runs = (useLot, cfg = CARPET_SEL) => {
    const out = [];
    for (let j = 0; j < 160; j++) {
      let cur = -1, len = 0;
      for (let i = 0; i < 160; i++) {
        let wx, wz;
        if (useLot) {
          const [, , li, lj] = carpetLotAt(i, j, SEED);
          wx = li * CELL; wz = lj * CELL;
        } else { wx = (i + 0.5) * CELL; wz = (j + 0.5) * CELL; }
        const s = pickAt(wx, wz, cfg);
        if (s === cur) len++;
        else { if (cur >= 0) out.push(len); cur = s; len = 1; }
      }
      out.push(len);
    }
    return out.sort((a, b) => a - b);
  };
  const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  const lot = runs(!BREAK_LOT), cellC = runs(false), legacy = runs(false, LEGACY);
  const lotP50 = q(lot, 0.5) * CELL, cellP50 = q(cellC, 0.5) * CELL, legP50 = q(legacy, 0.5) * CELL;
  // Short-range flicker = how common the SHORT runs are (means hide it: the old distribution
  // is bimodal -- large stable areas plus steep-noise bands swapping every cell, and the user
  // sees the latter)
  const shortShare = (a) => a.filter((v) => v * CELL < CELL * 2).length / a.length;
  const lotR = shortShare(lot), cellR = shortShare(cellC), legR = shortShare(legacy);
  // Lower bound pinned to block spacing: one lot always yields one kind => a same-kind run
  // is at least one lot wide
  const floorM = CARPET_LOT.CELLS * CELL * 0.8;
  t(`同款連續長度中位數 ${lotP50.toFixed(0)}m ≥ 一個區塊 ${floorM.toFixed(0)}m`
    + `(同公式取格心 ${cellP50.toFixed(0)}m / 2026-08-12 出貨基準 ${legP50.toFixed(0)}m)`,
    lotP50 >= floorM, `（每 ${lotP50.toFixed(0)}m 才換一次顏色）`);
  // Short-run share compares ONLY against the ship baseline: the same-formula cell-center
  // group prints as reference, but it already eats the new low-frequency field => it is low on
  // its own, so gating on it compares new against new (the median line above has the teeth)
  t(`「走不到兩格就換色」${(lotR * 100).toFixed(1)}% ≤ 2026-08-12 出貨基準 ${(legR * 100).toFixed(0)}% 的`
    + `四分之一(同公式取格心 ${(cellR * 100).toFixed(1)}%)`,
    lotR <= legR / 4, `（這一條就是使用者說的「短距離快速變化」）`);
  if (BREAK_LOT) console.log('  （--break-lot:取值點改回格心 ⇒ 上面兩條 MUST 紅字）');
}

console.log('\n== Ⅱ 逐格花紋(同顏色的相鄰拼圖畫不同的圖案)==');
{
  const V = 3, SEED = 0x5EED | 0;
  // Old-rule control: variant = low-frequency noise (wavelength far above cell pitch) =>
  // large same-variant sheets
  const oldVar = (subs, gnx, gnz) => {
    const out = new Array(gnx * gnz).fill(0);
    for (let j = 0; j < gnz; j++) {
      for (let i = 0; i < gnx; i++) {
        out[j * gnx + i] = Math.min(V - 1, (vnoise(i * 0.03, j * 0.03, SEED) * V) | 0);
      }
    }
    return out;
  };
  const plan = BREAK_VAR ? oldVar : (s, a, b) => planCarpetVariants(s, a, b, { seed: SEED, variants: V });
  // Grid: large same-kind area + other-kind block + '!' cliff + null unpaved (all three
  // non-kind values exercised)
  const N = 40;
  const subs = new Array(N * N).fill(null);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      subs[j * N + i] = (i === 7 && j === 7) ? '!' : (i === 9 && j === 9) ? null
        : (i < 24 ? 'turf' : (i < 32 ? 'meadow' : 'turf'));
    }
  }
  const stat = (v) => {
    let edgeSame = 0, edgeN = 0, diagSame = 0, diagN = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const s = subs[j * N + i];
        if (s == null || s === '!') continue;
        for (const [di, dj, edge] of [[1, 0, 1], [0, 1, 1], [1, 1, 0], [-1, 1, 0]]) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          if (subs[nj * N + ni] !== s) continue;               // Constraint binds only same-kind pairs
          const same = v[nj * N + ni] === v[j * N + i];
          if (edge) { edgeN++; if (same) edgeSame++; } else { diagN++; if (same) diagSame++; }
        }
      }
    }
    return { edgeSame, edgeN, diagSame, diagN };
  };
  const out = plan(subs, N, N);
  const A = stat(out), C = stat(oldVar(subs, N, N));   // C = old-rule control (low-frequency-noise variants)
  t(`共邊的同款鄰格**恆**不同變體(${A.edgeN} 對;硬條件)`, A.edgeN > 0 && A.edgeSame === 0,
    `（${A.edgeSame} 對同變體 = 兩張一樣的貼圖貼在一起）`);
  // Diagonals share only one corner, and 3 variants x 8 neighbors cannot all differ (four
  // cells of a 2x2 block are pairwise adjacent, so full difference needs 4 colors = one more
  // mesh per kind) -- the user words say best effort too. The toothed gate pins to the control:
  // the old build diagonal same-variant rate is near 1.0, the new rule MUST drop below half
  t(`對角的同款鄰格「盡可能」不同:同變體率 ${(A.diagSame / A.diagN).toFixed(2)}(舊制對照組 ` +
    `${(C.diagSame / C.diagN).toFixed(2)})`,
    A.diagN > 0 && A.diagSame / A.diagN < 0.55 && A.diagSame / A.diagN < C.diagSame / C.diagN * 0.7,
    `（同變體 ${A.diagSame}/${A.diagN}）`);
  t('三個變體都用得到(只用兩個 = 白白少一種花紋)',
    new Set(out.filter((v, k) => subs[k] != null && subs[k] !== '!')).size === V);
  t("'!' 崖與 null 未鋪格不指派變體(維持 0,不影響 keys 組裝)",
    out[7 * N + 7] === 0 && out[9 * N + 9] === 0);
  t('決定性(同一份輸入跑兩次逐位元相同)',
    JSON.stringify(planCarpetVariants(subs, N, N, { seed: SEED, variants: V })) === JSON.stringify(
      planCarpetVariants(subs, N, N, { seed: SEED, variants: V })));
  // Other kinds unconstrained: at a two-kind border each side picks its own (neighbors of
  // another kind never tie hands)
  const border = [];
  for (let j = 0; j < N; j++) border.push(out[j * N + 23], out[j * N + 24]);
  t('異款之間不設限(交界兩側各挑各的:異款本來就是兩張不同的貼圖)', new Set(border).size >= 2);
  if (BREAK_VAR) console.log('  （--break-var:變體改回低頻雜訊 ⇒ 共邊那一條 MUST 紅字）');
}

console.log('\n== Ⅲ 靜態規則(執行原文)==');
{
  const strip = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  // 1. Base color does not drift with variant (demanded by the words same-colored neighbors)
  const bf = grab(/function baseFill\(hex, rnd\) \{[\s\S]*?\n\}/, 'baseFill');
  t('baseFill 不把底色抖開(同種地表的全部變體共用同一個底色 ⇒ 逐格換變體 ≠ 逐格換顏色)',
    !/rnd\(\)\s*-\s*0\.5/.test(bf) && /return `rgb\(\$\{hex >> 16 & 255\}/.test(bf));
  t('仍照抽三枚亂數(每一支畫筆後續的筆觸序列逐位元同舊制 —— 改的只有底色那一格)',
    /for \(let k = 0; k < 3; k\+\+\) rnd\(\);/.test(bf));
  t('舊的 vary(逐變體抖底色)已無殘留', !/\bvary\(/.test(strip(src)));
  // 2. Picking uses lot centers; variants picked once per whole sheet
  const subFn = grab(/const cellSubAt = \(i, j, zn\) => \{[\s\S]*?\n  \};/, 'cellSubAt');
  t('cellSubAt 的取值點 = 選款區塊中心(carpetLotAt 單一縫;場的公式一格未動)',
    /const \[, , li, lj\] = carpetLotAt\(i, j, seed\);/.test(subFn)
    && /vnoise\(lx \* CARPET_SEL\.W, lz \* CARPET_SEL\.W, seed\)/.test(subFn)
    && /qcVal\(lx, lz, QC_SEL_W\)/.test(subFn)
    && /const QC_SEL_W = CARPET_SEL\.QC_W;/.test(src));
  t('cellSubAt 只回款名(變體不在這裡挑 —— 逐格獨立挑一定挑得出相鄰同款同變體)',
    !/#\$\{/.test(subFn) && /return list\[\(t \* list\.length\) \| 0\];/.test(subFn));
  t('keys 兩段組裝:整張挑顏色(subGrid)→ 整張挑花紋(planCarpetVariants)→ 合成 key',
    /subGrid\[j \* gnx \+ i\] = cellSubAt\(i, j, zoneGrid\[j \* gnx \+ i\]\)/.test(src)
    && /const varGrid = planCarpetVariants\(subGrid, gnx, gnz, \{ seed, variants: CARPET_VARIANTS \}\)/.test(src)
    && /const key = `\$\{sub\}#\$\{varGrid\[j \* gnx \+ i\]\}`;/.test(src));
  t('enclave 換裝仍接在選款上(唯一真相 ENCLAVE_STYLES;水深仍逐格看)',
    /encRt\.get\(encGrid\[j \* gnx \+ i\]\)\?\.style\.carpet \|\| carpetLists\[zn\]/.test(subFn)
    && /'deepwater' : 'watertile'/.test(subFn));
  // 3. Same-kind different-variant emits no spillover (else two extra translucent carpets)
  const seamFn = grab(/export function planSeamOverlays\(keys, gnx, gnz, opts = \{\}\) \{[\s\S]*?\n\}/, 'planSeamOverlays');
  t('planSeamOverlays:同款異變體不發外溢(共用底色 ⇒ 沒有要 cross-fade 的東西)',
    /if \(subOf\(kn\) === subOf\(k0\)\) continue;/.test(seamFn));
  // 4. Buffer-ring carpet
  const bufSeg = src.slice(src.indexOf('// ==== Buffer-ring carpet'), src.indexOf('// ==== Terrain border puzzle: planning'));
  t('surfaceField 路徑停用緩衝底毯；相容路徑只在拿得到 bufferHeightAt 時才鋪',
    bufSeg.length > 400 && /if \(!surfaceField && terrain\.bufferHeightAt\) \{/.test(bufSeg));
  t('高度走 terrain.bufferHeightAt(裙的外推高度唯一縫;拿 heightAt 會被夾回圖界)',
    /terrain\.bufferHeightAt,\s*null, null, null\)/.test(bufSeg) && !/terrain\.heightAt/.test(bufSeg));
  t('分區與選款鏡射回圖內取(三角波在圖界上恆等 ⇒ 接縫兩側同款)',
    /const mirror = \(v, lo, hi\) => \{/.test(bufSeg) && /keys\[kj \* gnx \+ ki\]/.test(bufSeg));
  t('格距放粗(BUF_CELL_F;原尺寸鋪滿要多兩倍半的格子)', /const bcell = cell \* BUF_CELL_F;/.test(bufSeg));
  t('發射進圖內同一批 buckets(底毯 carpetBuckets / 外溢 spillBuckets ⇒ 一個 draw call 都沒有多)',
    /emitFace\(carpetBuckets,/.test(bufSeg) && /emitFace\(ov\.st\?\.band \? bandBuckets : spillBuckets,/.test(bufSeg));
  t('圖內那一格沒鋪(崖/灘線/灰帶)⇒ 界外也不鋪(寧缺勿錯)',
    /if \(!key \|\| key === '!'\) continue;/.test(bufSeg));
  t('零共享 rnd 消耗(§2.3:插在建構流程任何位置都不推移植被佈局)',
    !/\brnd\s*\(/.test(bufSeg) && !/Math\.random/.test(bufSeg));
  t('界線拼圖 / 特徵拼圖 / 3D 細節都不進緩衝空間(那些要吃共享 rnd 序列與空間索引)',
    !/tryPatch|addDetail|planBorderPuzzle|scatterDetails/.test(bufSeg));
  // Coarse cells + hard edges read as a quilt (2026-08-12 field photo): corner jitter plus
  // border spillover are both required, and spillover MUST use the in-map planner (single seam)
  t('角點抖動,但圖界那兩條線上的角點不動(那是與真地形的接縫,動了就開縫)',
    /\(i === nOut \|\| i === inX\) \? 0 :/.test(bufSeg) && /\(j === nOut \|\| j === inZ\) \? 0 :/.test(bufSeg));
  t('交界外溢走圖內同一支 planSeamOverlays(單一縫;少了它粗格之間就是硬邊直角)',
    /for \(const ov of planSeamOverlays\(bkeys, bnx, bnz,/.test(bufSeg));
  // 5. Ground-face emission has exactly one implementation, and in-map no longer routes
  // through it (in-map adopted terrain since 2026-08-13, see IV)
  t('貼地 3×3 面只有 emitFace 一份實作 + face9 一份排列,且只剩緩衝空間在呼叫',
    (src.match(/const emitFace = /g) || []).length === 1
    && (src.match(/const face9 = /g) || []).length === 1
    && (strip(src).match(/emitFace\(/g) || []).length === 2
    && (strip(bufSeg).match(/emitFace\(/g) || []).length === 2);
  t('高度來源由呼叫端注入(圖內 terrain.heightAt / 緩衝空間 terrain.bufferHeightAt)',
    /const emitFace = \(bmap, key, G, hAt, alphas, st, cut\) => \{/.test(src)
    && /G\.map\(\(\[px, pz\]\) => hAt\(px, pz\)\)/.test(src));
}

// ==== IV Adopt-terrain-triangles (2026-08-13 user decision: A adopt-terrain-triangles) ====
// Old carpet cut its own 3x3 with heightAt vertices: vertices sit on terrain but edges between
// them are straight; terrain is a per-cell triangulated height field, so chords crossing a
// crease sink under it (slope breakage). New rule: skin triangles equal terrain triangles.
// This section measures two things --
//   (a) Geometry rules (run extracted inQuad / invBil sources): adoption MUST give each point
//     exactly one owner (zero owners = bare terrain showing; two = two skins z-fighting), and
//     owners always stay inside 3x3; inverse-bilinear is identity at corners => shared terrain
//     vertices compute the same alpha on both sides, spillover never gaps.
//   (b) Wiring (execute source): index order literally matches terrain.js triangulation, beach
//     gate still whole-cell, in-map no longer takes drape lift, terrain vertex count derived.
// Reverse verification --break-adopt: adoption falls back to diagonal-split triangles -- a
// jittered quad can be concave with its diagonal outside the polygon => the no-overlap line
// MUST go red (measured: 13 probes double-claimed = two skins stacked).
console.log('\n== Ⅳ 認養地形三角形 ==');
{
  const strip = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const IN_Q = grab(/  const inQuad = \(Q, px, pz\) => \{[\s\S]*?\n  \};/, 'inQuad');
  const INV_B = grab(/  const invBil = \(Q, px, pz\) => \{[\s\S]*?\n  \};/, 'invBil');
  const GEO = new Function(`${IN_Q}\n${INV_B}\nreturn { inQuad, invBil };`)();
  t('inQuad / invBil 原文零 rnd / 零 Math.random / 零 THREE(§2.3、A4)',
    !/\brnd\s*\(|Math\.random|THREE/.test(IN_Q + INV_B));

  // Build one jittered-corner grid (amplitude = ground.js clampD upper bound 0.45) and adopt
  // with the genuine inQuad
  const JIT = 0.45, SEED = 0x5EED | 0;
  const corn = (i, j) => [
    i + (vnoise(i, j, (SEED ^ 0x9E37) | 0) - 0.5) * 2 * JIT,
    j + (vnoise(i, j, (SEED ^ 0x85EB) | 0) - 0.5) * 2 * JIT];
  const quad = (i, j) => [corn(i, j), corn(i + 1, j), corn(i + 1, j + 1), corn(i, j + 1)];
  // Control: split into two triangles along a diagonal (concave quads leak/overlap) --
  // --break-adopt swaps this in
  const triSide = (A, B, C, px, pz) => (B[0] - A[0]) * (pz - A[1]) - (B[1] - A[1]) * (px - A[0]);
  const inTri = (A, B, C, px, pz) => {
    const s = Math.sign(triSide(A, B, C, px, pz)), u = Math.sign(triSide(B, C, A, px, pz)),
          v = Math.sign(triSide(C, A, B, px, pz));
    return (s >= 0 && u >= 0 && v >= 0) || (s <= 0 && u <= 0 && v <= 0);
  };
  const OWN = BREAK_ADOPT
    ? (Q, px, pz) => inTri(Q[0], Q[1], Q[2], px, pz) || inTri(Q[0], Q[2], Q[3], px, pz)
    : GEO.inQuad;
  const LO = 4, HI = 20, STEP = 0.137;          // Probe step deliberately irrational-like: avoids landing on grid lines
  let none = 0, dup = 0, far = 0, probes = 0, concave = 0;
  for (let i = LO; i < HI; i++) {
    for (let j = LO; j < HI; j++) {
      const Q = quad(i, j);                      // Concave or not: does diagonal P0P2 fall outside the polygon
      const mid = [(Q[0][0] + Q[2][0]) / 2, (Q[0][1] + Q[2][1]) / 2];
      if (!GEO.inQuad(Q, mid[0], mid[1])) concave++;
    }
  }
  for (let px = LO + 1; px < HI - 1; px += STEP) {
    for (let pz = LO + 1; pz < HI - 1; pz += STEP) {
      probes++;
      const owners = [];
      for (let i = LO; i < HI; i++) for (let j = LO; j < HI; j++) if (OWN(quad(i, j), px, pz)) owners.push([i, j]);
      if (!owners.length) { none++; continue; }
      if (owners.length > 1) dup++;
      // Owners always stay inside the nominal 3x3 (that is ground.js scan range; behavioral
      // proof for jitter < 0.45)
      if (owners.some(([i, j]) => Math.abs(i - Math.floor(px)) > 1 || Math.abs(j - Math.floor(pz)) > 1)) far++;
    }
  }
  t(`抖動 ${JIT} 格會生出凹四邊形(${concave} / ${(HI - LO) ** 2} 格)—— 對角線拆法本來就不成立`,
    concave > 0);
  t(`認養分割無破洞:每個點都有主人(${probes} 個探針)`, none === 0, `（${none} 個無主 ⇒ 那塊地形直接露出來）`);
  t('認養分割無重疊:沒有點被兩格同時認養(半開邊)', dup === 0, `（${dup} 個重複 ⇒ 兩張皮互疊 z-fighting）`);
  t('主人恆落在名義格的 3×3 候選內(ground.js 只掃 3×3 的行為證明)', far === 0, `（${far} 個落在候選之外）`);

  // Inverse-bilinear: corner identity + both cells agree on shared edges (spillover never gaps)
  let cornErr = 0, seamErr = 0;
  const A4 = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let i = LO; i < HI; i++) {
    for (let j = LO; j < HI; j++) {
      const Q = quad(i, j);
      Q.forEach((P, k) => {
        const [u, v] = GEO.invBil(Q, P[0], P[1]);
        if (Math.abs(u - A4[k][0]) > 1e-6 || Math.abs(v - A4[k][1]) > 1e-6) cornErr++;
      });
    }
  }
  const alphaOf = (i, j) => 0.5 + 0.5 * vnoise(i * 3.1, j * 3.1, SEED);   // Any corner alpha field
  const bil = (Q, aa, px, pz) => {
    const [u, v] = GEO.invBil(Q, px, pz);
    return (1 - u) * (1 - v) * aa[0] + u * (1 - v) * aa[1] + u * v * aa[2] + (1 - u) * v * aa[3];
  };
  for (let i = LO; i < HI - 1; i++) {
    for (let j = LO; j < HI - 1; j++) {
      // Right edge P1P2 of (i,j) equals left edge P0P3 of (i+1,j) (two shared corners)
      const QL = quad(i, j), QR = quad(i + 1, j);
      const aL = [alphaOf(i, j), alphaOf(i + 1, j), alphaOf(i + 1, j + 1), alphaOf(i, j + 1)];
      const aR = [alphaOf(i + 1, j), alphaOf(i + 2, j), alphaOf(i + 2, j + 1), alphaOf(i + 1, j + 1)];
      for (let s = 0; s <= 1; s += 0.25) {
        const px = QL[1][0] + (QL[2][0] - QL[1][0]) * s, pz = QL[1][1] + (QL[2][1] - QL[1][1]) * s;
        if (Math.abs(bil(QL, aL, px, pz) - bil(QR, aR, px, pz)) > 1e-6) seamErr++;
      }
    }
  }
  t('反雙線性在四角恆等(α 端點 0/1 不漂 ⇒ 與不透明底毯仍水密)', cornErr === 0, `（${cornErr} 個角偏差）`);
  t('共用邊上兩格算出同一個 α(相鄰外溢共用的那顆地形頂點不開縫)', seamErr === 0, `（${seamErr} 個取樣分歧）`);

  // ---- Wiring (execute source) ----
  const emitSeg = src.slice(src.indexOf('const emitCell = (bmap, key, ti, tj, alphas, st, cut) => {'),
                            src.indexOf('// ==== Multi-level terrain: full-map coarse'));
  const adoptSeg = src.slice(src.indexOf('const cellQuads = new Array(gnx * gnz);'),
                             src.indexOf('const emitCell = (bmap, key, ti, tj, alphas, st, cut) => {'));
  const tsrc = readSrc('public', 'js', 'terrain.js');
  t('索引序與 terrain.js 的三角化逐字同向(反對角線 —— 共面的本錢就在這一行)',
    /const a = i \* N \+ j, b = a \+ 1, c = a \+ N, d = c \+ 1;/.test(tsrc)
    && /idx\.push\(a, c, b, b, c, d\);/.test(tsrc)
    && /for \(const \[px, pz\] of \[\[x0, z0\], \[x1, z0\], \[x0, z1\], \[x1, z1\]\]\)/.test(emitSeg)
    && /b\.idx\.push\(b\.base, b\.base \+ 2, b\.base \+ 1, b\.base \+ 1, b\.base \+ 2, b\.base \+ 3\);/.test(emitSeg));
  t('頂點取地形格點座標(tvx / tvz),不再自己切 face9 子格',
    /const x0 = tvx\(quads\[n\]\), x1 = tvx\(quads\[n\] \+ 1\);/.test(emitSeg)
    && /const z0 = tvz\(quads\[n \+ 1\]\), z1 = tvz\(quads\[n \+ 1\] \+ 1\);/.test(emitSeg));
  t('圖內底毯 / 外溢 / 脊帶不再套貼合抬升(共面 ⇒ 虧損恆 0;再抬就是浮在地形上)',
    !/drapeSag/.test(emitSeg) && !/drapeSag/.test(adoptSeg));
  t('灘線閘仍以 face9 九點整格判(landCells 與共享 rnd 序列逐位元同舊制)',
    /const G = face9\(Q\[0\], Q\[1\], Q\[2\], Q\[3\]\);/.test(emitSeg)
    && /Math\.min\(\.\.\.G\.map\(\(\[px, pz\]\) => terrain\.heightAt\(px, pz\)\)\) < 0\.45/.test(emitSeg));
  t('地形頂點數推導不手寫(terrain 只給 x 軸格距;z 軸要用 worldH 自己回推)',
    /const NTV = Math\.round\(terrain\.worldW \/ terrain\.gridM\) \+ 1;/.test(src)
    && /const TGX = terrain\.worldW \/ \(NTV - 1\), TGZ = terrain\.worldH \/ \(NTV - 1\);/.test(src)
    && !/TERRAIN\.GRID_N|GRID_N/.test(src));
  t('認養表建一次、零共享 rnd 消耗(§2.3:不推移植被佈局)',
    !/\brnd\s*\(/.test(strip(adoptSeg)) && /for \(let dj = -1; dj <= 1 && own < 0; dj\+\+\)/.test(adoptSeg)
    && /for \(let di = -1; di <= 1; di\+\+\)/.test(adoptSeg));
  t('無主四邊形記帳外露(結構上恆 0;> 0 = 抖動幅度或候選範圍有人動過,畫面上只是偶爾一格禿掉)',
    /orphanQuads\+\+/.test(adoptSeg) && /orphans: orphanQuads/.test(src));
  if (BREAK_ADOPT) console.log('  （--break-adopt:認養退回對角線拆三角形 ⇒「無重疊」那一條 MUST 紅字）');
}

// ==== V Four-season farm surfaces (2026-08-13 user request) ====
// User words: fields plus veggie plots, pasture, fish ponds, orchards and other farm areas, all
// season-aware including the original fields. Old seasons were one SEASON_TINT multiply filter
// (tints the whole map yellow) -- not what an autumn paddy looks like. This section measures
// three things:
//   (a) Really draws different things: run one painter through four seasons into a recording
//     fake 2D context; every pair MUST differ, and not by base color alone (base-color-only
//     would re-verify that multiply filter: drop the first fillStyle and MUST still differ).
//   (b) Roster alignment: painters taking season match DEFS flagged seasonal. One missing flag
//     double-tints (painter already gold, times one more 0xffd9a8 = faded photo), while on screen
//     autumn fields just look dirty, invisible to every assertion.
//   (c) Draw calls unchanged: season only enters the groundTex cache key, bucket keys stay
//     sub#variant.
console.log('\n== Ⅴ 農牧地表四季設計 ==');
{
  const strip = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const painterSeason = Object.keys(SURFACES).filter(k => SURFACES[k].landscape === 'cultivated' || k === 'fishpond');
  t('季節材質由程序生成器處理，全部場所停用第二次季節乘色', Object.values(DEFS).every(d => d.seasonal));
  // Fake 2D context: record set-colors and draw calls into a command stream (differences
  // measurable without painting pixels)
  const recCtx = () => {
    const log = [];
    const h = { beginPath: 0, closePath: 0, fill: 0, stroke: 0, save: 0, restore: 0 };
    const c = { get log() { return log; } };
    for (const k of ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'globalAlpha', 'font']) {
      let v; Object.defineProperty(c, k, { get: () => v, set: (nv) => { v = nv; log.push(`${k}=${nv}`); } });
    }
    for (const k of ['fillRect', 'strokeRect', 'moveTo', 'lineTo', 'arc', 'rect', 'clip',
                     'quadraticCurveTo', 'bezierCurveTo', 'ellipse', 'setLineDash', 'translate', 'rotate', 'scale', 'fillText']) {
      c[k] = (...a) => log.push(`${k}(${a.map((n) => (typeof n === 'number' ? n.toFixed(2) : n)).join()})`);
    }
    for (const k in h) c[k] = () => log.push(`${k}()`);
    return c;
  };
  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  let sameAny = 0, tintOnly = 0;
  for (const k of painterSeason) {
    const runs = SEASONS.map((sn) => {
      const g = recCtx();
      paintGround(g, 256, k, 0x1234, surfaceEnvironment({ season: sn }));
      return g.log;
    });
    for (let a = 0; a < 4; a++) {
      for (let b2 = a + 1; b2 < 4; b2++) {
        const ja = JSON.stringify(runs[a]), jb = JSON.stringify(runs[b2]);
        if (ja === jb) { sameAny++; bad(`${k}:${SEASONS[a]} 與 ${SEASONS[b2]} 畫出完全一樣的東西`); }
        // Base-color-only = this line degrades to the multiply filter: drop the first fillStyle
        // and MUST still differ
        else if (JSON.stringify(runs[a].slice(1)) === JSON.stringify(runs[b2].slice(1))) {
          tintOnly++; bad(`${k}:${SEASONS[a]} 與 ${SEASONS[b2]} 只差一個底色(那就是舊的乘色濾鏡)`);
        }
      }
    }
  }
  if (!sameAny && !tintOnly) ok(`${painterSeason.length} 支畫筆 × 四季 兩兩畫出不同的東西,且不只是換底色`);

  t('材質快取區分 fit，場所與底毯共用程序畫筆', src.includes('paintGround(cv.getContext') && src.includes('/'+ '$' + '{fit}') && !/bucketOf\([^)]*season/.test(src));
  t('兩個 Mesh 消費端使用同一場次材質快取', (strip(src).match(/map: textureOf\(/g) || []).length === 2);

}

console.log('\n== Ⅵ 選款清單的顏色路徑(換款的「幅度」那一半)==');
{
  // Lesion: CARPET_LOT only makes swaps less frequent, amplitude untouched -- if roster
  // index adjacency is not color adjacency (green roster: meadow tan, deadwood gray, turf
  // green), colors still jump no matter how smooth t is.
  // 1. Representative roster MUST cover exactly the kinds reaching carpet (both directions;
  //    one extra = decoration with no consumer; one missing = that kind falls back to roster
  //    order at sort time, reading on screen as this area still jumps)
  const want = new Set(['deepwater']);   // Deep water is in no roster (cellSubAt assigns by depth), still a carpet kind
  for (const zn in CARPET) for (const s of CARPET[zn]) want.add(s);
  for (const k in ENCST) for (const s of ENCST[k].carpet || []) want.add(s);
  const have = new Set(Object.keys(SUB_COL));
  const miss = [...want].filter((s) => !have.has(s));
  const extra = [...have].filter((s) => !want.has(s));
  t(`SUB_COL 恰涵蓋底毯款(CARPET ∪ ENCLAVE_STYLES[].carpet;${want.size} 款)`,
    miss.length === 0 && extra.length === 0, `（缺:${miss.join(',')} 多:${extra.join(',')}）`);
  // 2. Painters really eat this table (else sorting uses swatches unrelated to the frame)
  t('程序畫筆使用 SUB_COL 作為底色', /paintGround\([^;]+SUB_COL\[sub\]/.test(src));
  t('brick 代表色仍由色票推導', /brick: meanHex\(BRICK_C\)/.test(src));
  // 3. Sorting itself: pure function, keeps multiplicity, same-kind runs, bottleneck step
  // never worse than roster order
  t('carpetOrder 原文零 rnd / 零 Math.random / 零 THREE(§2.3、A4)',
    !/\brnd\s*\(|Math\.random|THREE/.test(ORDER));
  // Multiplicity fingerprint MUST NOT depend on key order (insertion order changes after
  // sorting; direct object stringify never compares equal)
  const cnt = (l) => JSON.stringify(Object.entries(
    l.reduce((m2, s) => (m2[s] = (m2[s] || 0) + 1, m2), {})).sort());
  const maxStep = (l) => {
    let mx = 0;
    for (let i = 1; i < l.length; i++) mx = Math.max(mx, colDist(SUB_COL[l[i - 1]], SUB_COL[l[i]]));
    return mx;
  };
  const lists = { ...CARPET };
  for (const k in ENCST) if (ENCST[k].carpet) lists['enc:' + k] = ENCST[k].carpet;
  let weightBad = 0, adjBad = 0, worse = 0, improved = 0;
  for (const k in lists) {
    const a = lists[k], b = BREAK_ORDER ? a.slice() : carpetOrder(a);
    if (cnt(a) !== cnt(b)) weightBad++;   // Multiplicity = weight, MUST NOT change
    for (const s of new Set(b)) {                                          // Same kind MUST form one run
      const f = b.indexOf(s), l = b.lastIndexOf(s);
      if (l - f + 1 !== b.filter((q) => q === s).length) adjBad++;
    }
    const m0 = maxStep(a), m1 = maxStep(b);
    if (m1 > m0 + 1e-9) worse++;
    if (m1 < m0 - 1e-9) improved++;
  }
  t('排序保留重數(重複項 = 權重,排完各款佔比逐位元不變)', weightBad === 0);
  t('同款排在一起(權重成為漸層上的一段平台,不是散在清單各處)', adjBad === 0);
  t('沒有任何一份清單的最大相鄰色距被排壞', worse === 0);
  t(`實際改善的清單數 ${improved}/${Object.keys(lists).length}(0 = 排序沒有在做事)`, improved > 0);
  // 4. Both consumers sorted (post-winter-override, and enclave styles; missing one leaves
  // some area still jumping)
  t('carpetLists 在冬季覆寫之後才排序(冬季那兩份是新組的清單)',
    src.indexOf('for (const zn in carpetLists) carpetLists[zn] = carpetOrder(carpetLists[zn]);')
      > src.indexOf("carpetLists.alpine = ['icefield'"));
  t('enclave 樣式的底毯清單也排序,且不就地改寫模組級常數',
    /carpet: carpetOrder\(st\.carpet\)/.test(src) && /const style = st\.carpet \? \{ \.\.\.st,/.test(src));
  // 5. Realized share of brick and concrete (2026-08-13 user decision: cut usage sharply).
  // This line MUST measure realized share, not roster cells: picking is noise -> roster index,
  // and the noise marginal is not uniform => per-slot realized share differs from declared
  // weight (see CARPET_SEL header). Old concrete sat exactly on the two boosted end slots --
  // counting cells gives 3/7, realized is 40 percent.
  {
    const CELL = 13, SEED = 0x5A17C0 | 0;
    const share = (list, want) => {
      const l = carpetOrder(list);
      let hit = 0, tot = 0;
      for (let j = 0; j < 260; j++) for (let i = 0; i < 260; i++) {
        const [, , li, lj] = carpetLotAt(i, j, SEED);
        let t2 = (vnoise(li * CELL * CARPET_SEL.W, lj * CELL * CARPET_SEL.W, SEED) - 0.5)
                 * CARPET_SEL.SPAN + 0.5;
        t2 = Math.min(0.999, Math.max(0, t2));
        tot++;
        if (want.includes(l[(t2 * l.length) | 0])) hit++;
      }
      return hit / tot;
    };
    // Frozen ship baseline = 2026-08-12 urban carpet roster (unsorted; carpetOrder did not
    // exist yet)
    const LEGACY_URBAN = ['concrete', 'pavement', 'lawn', 'brick', 'concrete', 'park', 'pavement'];
    const now = share(CARPET.urban, ['brick', 'concrete']);
    const was = share(LEGACY_URBAN.slice(), ['brick', 'concrete']);   // slice => sort never mutates in place
    t(`紅磚地 + 水泥地實得佔市區底毯 ${(now * 100).toFixed(0)}% ≤ 出貨基準 ${(was * 100).toFixed(0)}% 的一半`,
      now <= was / 2, '（使用者 2026-08-13「大幅調降使用率」）');
    (CARPET.urban.filter((s) => s === 'brick').length === 1
      && CARPET.urban.filter((s) => s === 'concrete').length === 1
      && !src.match(/urban: \['helipad'[^\]]*'brick'/))
      ? ok('brick / concrete 在市區底毯各只剩一格,且 brick 已退出特徵層 ZONES.urban')
      : bad('brick / concrete 的格數或特徵層名冊未依定案收斂');
  }
  if (BREAK_ORDER) console.log('  （--break-order:清單維持原序 ⇒ 上面「實際改善的清單數」MUST 紅字）');
}

console.log('\n== Ⅶ 同顏色拼圖上的多種點綴(2026-08-13「草地的小花/沙地的小石頭/水域的游魚」)==');
{
  const scatFn = grab(/function scatterDetails\(sub, x, z, r, rot, def, zn, enc = null, density = 1\) \{[\s\S]*?\n  \}/, 'scatterDetails');
  const NEW = ['fish', 'shell', 'mushroom'];
  t(`新增三款點綴 ${NEW.join(' / ')} 都有零件表`,
    NEW.every(n => GROUND_PARTS[n]));
  t('三款都登記了 TILT 與 REG(漏了的那一款會恆直立且恆隨機朝向,不會報錯)',
    NEW.every((n) => new RegExp(`${n}: [\\d.]+`).test(src.match(/const TILT = \{[\s\S]*?\n\};/)[0])
      && new RegExp(`${n}: [\\d.]+`).test(src.match(/const REG = \{[\s\S]*?\n\};/)[0])));
  // Fish: MUST enter AQ_DET (skip shoreline culling) and MUST sink below the surface
  // (on-surface = floating fish)
  t("fish 進 AQ_DET(水生細節,免吃岸線高度淘汰)", /AQ_DET = new Set\(\['reed', 'lotuspad', 'fish'\]\)/.test(src));
  t('fish 走 DIVE(沉在水面下)且水深不足就不擺(§4 寧缺勿錯)',
    /const DIVE = \{ fish: [\d.]+ \};/.test(src)
    && /if \(wy == null \|\| terrain\.heightAt\(px, pz\) > wy - dive - [\d.]+\) return;/.test(src)
    && /y = wy - dive;/.test(src));
  // Every carpet kind MUST scatter at least two sprinkle kinds (several different details
  // on same-color patches)
  const carpetSubs = new Set();
  for (const zn in CARPET) for (const s of CARPET[zn]) carpetSubs.add(s);
  const thin = [];
  for (const s of carpetSubs) {
    const kinds = new Set(SURFACES[s].parts);
    if (kinds.size < 2) thin.push(`${s}(${kinds.size})`);
  }
  t(`每一款底毯地表都撒得出兩種以上的點綴(${carpetSubs.size} 款)`, thin.length === 0,
    `（只有一種:${thin.join(', ')}）`);
  t('水域三款(淺水/深水/荷塘)都有游魚', ['watertile', 'deepwater', 'lotus'].every(s => SURFACES[s].parts.includes('fish')));
  t('散布與固定配置都使用附件資料表', scatFn.includes('GROUND_ATTACHMENTS[sub]')
    && scatFn.includes('Object.entries(scatterRules)') && scatFn.includes('recipe.fixed || []'));
}

for (const [f, m] of [['--break-lot', '取值點改回格心,Ⅰ MUST 紅字(顏色又開始短距離亂跳)'],
  ['--break-var', '變體改回低頻雜訊,Ⅱ MUST 紅字(相鄰同款貼同一張貼圖)'],
  ['--break-order', '清單維持原序,Ⅵ MUST 紅字(索引相鄰不再是顏色相鄰)'],
  ['--break-adopt', '認養退回對角線拆三角形,Ⅳ MUST 紅字(凹四邊形的對角線跑到形外 ⇒ 與鄰格重疊認養)']]) {
  if (process.argv.includes(f)) console.log(`\n（${f}:${m}）`);
}
console.log(`\n${fail === 0 ? '🎉 ALL PASS' : `❌ FAIL(${fail} 項)`}`);
process.exit(fail === 0 ? 0 : 1);
