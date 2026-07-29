// ============ 橋上砲塔墩座台「可繞行」稽核(離線直測,執行 biomes.js 原文)============
// 起因(2026-07-28 使用者回報):「倫敦跨河大橋:在橋上砲塔左右側移動時會跌下去。」
// 根因:砲塔擺在兵線側邊 TOWER_SIDE_OFF=15m,橋面半寬僅 8m ⇒ 砲塔坐在橋緣外的外伸墩座台上。
//   舊版台面沿橋軸半長 = TOWER_PAD_R(10.5),站立面連側向容差僅 ±13.5m;砲塔基座半徑 6.76m ⇒
//   繞到砲塔左右側沿橋軸走約 7m 就掉出台緣(deckY→null → surfaceAt 落回河面)。
// 修法:台面沿橋軸半長改 TOWER_PAD_AXIS(> PAD_R),左右各留充裕走位帶;碰撞柱半徑 TOWER_BASE_R 不變
//   (⇒ 伺服器 occ/LOS/平衡不動)。此稽核**抽 biomes.js 的 planTowerBridgePads / makeDeckIndex 原文**執行。
//
// 跑法:node tools/audit_bridge_tower_pad.mjs   退出碼:0 = 全綠;1 = 有紅字
// **改完 MUST 反向驗證**:把 TOWER_PAD_AXIS 寫回舊值(10.5)⇒ 「砲塔左右走位」段 MUST 紅字(內建對照組)。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME } from '../public/js/data.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(ROOT, 'public', 'js', 'biomes.js'), 'utf8');
const DECK_MARGIN = 3.0;   // main.js:62(站立查詢側向容差)—— surfaceAt 用同一值
const MY_R = 1.43;         // 最大機體地面碰撞半徑(climb.js:MAX_BODY_R)

// planTowerBridgePads(純幾何) + makeDeckIndex 的**原文**切片 → 可執行模組(不碰 THREE)。
function loadCore(mutate = (s) => s) {
  const P0 = src.indexOf('const TOWER_PAD_R = 10.5;');
  const P1 = src.indexOf('function buildTowerBridgePads');
  const D0 = src.indexOf('export function makeDeckIndex(decks) {');
  const D1 = src.indexOf('export function makeTunnelIndex(');
  if (P0 < 0 || P1 <= P0 || D0 < 0 || D1 <= D0) throw new Error('biomes.js 切片標記找不到');
  const body = mutate(src.slice(P0, P1) + '\n' + src.slice(D0, D1)).replace(/^export /gm, '');
  return new Function('GAME',
    `${body}\nreturn { planTowerBridgePads, makeDeckIndex, TOWER_PAD_R, TOWER_PAD_AXIS, TOWER_PAD_OUT, TOWER_BASE_R };`,
  )(GAME);
}

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : (fail++, console.error(`  ✗ ${msg}`)); };

// 直線橋:沿 +x、中心 z=0、半寬 hw、橋面高 y=10、x∈[40,160]。terrain.heightAt 恆 0(水面在橋下)。
function straightBridge(hw) {
  const decks = [];
  for (let x = 40; x < 160; x += 6) decks.push({ x1: x, z1: 0, y1: 10, x2: x + 6, z2: 0, y2: 10, hw });
  return decks;
}
const terrain = { heightAt: () => 0 };
const CP = { x: 100, z: 0, nx: 0, nz: 1 };   // 兵線中心點,法線 +z ⇒ 左右塔在 z=±15

// 一座砲塔可繞行 = 沿橋軸(z=tz 那條線)離砲塔中心「基座半徑 + walk」以內 deckY 皆非 null。
function walkPastBase(deckY, tx, tz) {
  let d = 0;
  while (d <= 40 && deckY(tx + d, tz, DECK_MARGIN) != null && deckY(tx - d, tz, DECK_MARGIN) != null) d += 0.25;
  return d;   // 首次掉出台緣的沿橋軸距離(自砲塔中心)
}
// 水側徑向走位帶(2026-07-29 修的核心):自砲塔沿「外法線(遠離橋心)」方向走,首次掉出台緣的距離。
// dirx/dirz = 該塔朝水側的外法線;橋內側由主橋面接手,故只量朝水側這一維。
function walkRadialOut(deckY, tx, tz, dirx, dirz) {
  let d = 0;
  while (d <= 40 && deckY(tx + dirx * d, tz + dirz * d, DECK_MARGIN) != null) d += 0.25;
  return d;
}

// ---------------------------------------------------------------------------
console.log('Ⅰ 墩座台幾何 + 常數');
const C = loadCore();
const { planTowerBridgePads, makeDeckIndex, TOWER_PAD_R, TOWER_PAD_AXIS, TOWER_PAD_OUT, TOWER_BASE_R } = C;
ok(Math.abs(TOWER_BASE_R - (10.5 * 0.62 + 0.25)) < 1e-9, `TOWER_BASE_R 不變(碰撞/LOS 不動):${TOWER_BASE_R}`);
ok(TOWER_PAD_AXIS > TOWER_PAD_R, `沿橋軸半長 TOWER_PAD_AXIS(${TOWER_PAD_AXIS})> 徑向舊值 TOWER_PAD_R(${TOWER_PAD_R})`);
ok(TOWER_PAD_OUT > TOWER_PAD_R, `水側徑向 reach TOWER_PAD_OUT(${TOWER_PAD_OUT})> 舊值 TOWER_PAD_R(${TOWER_PAD_R})(2026-07-29 繞塔水側走位)`);

const decks = straightBridge(8);
const plan = planTowerBridgePads([CP], decks, terrain);
ok(plan.pads.length === 2, `左右各一座砲塔:pads=${plan.pads.length}`);
ok(plan.slabs.length === 2, `兩片外伸台面:slabs=${plan.slabs.length}`);
ok(plan.newDecks.length === 2, `兩段站立面:newDecks=${plan.newDecks.length}`);
ok(plan.cols.length === 4, `每塔 2 柱(基座 + 墩身):cols=${plan.cols.length}`);
// 所見(視覺板沿橋軸半寬)= 所站(站立面段的側向半寬)= TOWER_PAD_AXIS
for (const sp of plan.slabs) ok(Math.abs(sp.d / 2 - TOWER_PAD_AXIS) < 1e-9, `視覺板沿橋軸半寬 = TOWER_PAD_AXIS`);
for (const d of plan.newDecks) ok(Math.abs(d.hw - TOWER_PAD_AXIS) < 1e-9, `站立面段側向半寬 = TOWER_PAD_AXIS`);

// ---------------------------------------------------------------------------
console.log('Ⅱ 砲塔可繞行(核心修正)');
const deckY = makeDeckIndex([...decks, ...plan.newDecks]);
const WALK = 8;   // 沿橋軸「基座外側」最少可站走位帶(遊戲公尺)—— 舊版僅 ~7.2m ⇒ 掉橋
for (const s of [-1, 1]) {
  const tx = CP.x + CP.nx * GAME.TOWER_SIDE_OFF * s, tz = CP.z + CP.nz * GAME.TOWER_SIDE_OFF * s;
  // ① 沿橋軸走位帶 ≥ 基座半徑 + WALK
  const reach = walkPastBase(deckY, tx, tz);
  ok(reach >= TOWER_BASE_R + WALK, `s=${s} 沿橋軸走位帶 ${reach.toFixed(1)}m ≥ 基座 ${TOWER_BASE_R.toFixed(1)} + ${WALK}`);
  // ② 繞行整圈(推擠半徑 ~ 基座 + 機體)全程站得住
  let holes = 0;
  for (let deg = 0; deg < 360; deg += 5) {
    const a = deg * Math.PI / 180, rr = TOWER_BASE_R + MY_R + 0.5;
    if (deckY(tx + rr * Math.cos(a), tz + rr * Math.sin(a), DECK_MARGIN) == null) holes++;
  }
  ok(holes === 0, `s=${s} 貼基座繞行整圈無掉點(holes=${holes})`);
  // ③ 水側徑向走位帶 ≥ 基座半徑 + WALK(2026-07-29:繞塔水側走稍寬弧線不掉水;舊版只到 TOWER_PAD_R=10.5)
  const rout = walkRadialOut(deckY, tx, tz, CP.nx * s, CP.nz * s);
  ok(rout >= TOWER_BASE_R + WALK, `s=${s} 水側徑向走位帶 ${rout.toFixed(1)}m ≥ 基座 ${TOWER_BASE_R.toFixed(1)} + ${WALK}`);
}

// ---------------------------------------------------------------------------
console.log('Ⅲ 邊界:砲塔整座落在寬橋內 ⇒ 不加外伸台(只補基座障礙柱)');
const wide = straightBridge(34);   // hw=34 ⇒ vOut=15+16=31 ≤ 33.5 ⇒ 不加台(主橋面本身即夠寬繞行)
const planW = planTowerBridgePads([CP], wide, terrain);
ok(planW.slabs.length === 0, `寬橋不加外伸台面:slabs=${planW.slabs.length}`);
ok(planW.cols.length === 2, `仍補基座障礙柱(每塔 1,無墩身):cols=${planW.cols.length}`);
const deckYW = makeDeckIndex([...wide, ...planW.newDecks]);
for (const s of [-1, 1]) {
  const tx = CP.x + CP.nx * GAME.TOWER_SIDE_OFF * s, tz = CP.z + CP.nz * GAME.TOWER_SIDE_OFF * s;
  ok(walkPastBase(deckYW, tx, tz) >= TOWER_BASE_R + WALK, `s=${s} 寬橋上砲塔照樣可繞行`);
}

// ---------------------------------------------------------------------------
console.log('Ⅳ 反向驗證:TOWER_PAD_AXIS 寫回舊值(=TOWER_PAD_R)⇒ 走位帶不足');
const Cold = loadCore((s) => s.replace('const TOWER_PAD_AXIS = 15;', 'const TOWER_PAD_AXIS = 10.5;'));
const planOld = Cold.planTowerBridgePads([CP], straightBridge(8), terrain);
const deckYold = Cold.makeDeckIndex([...straightBridge(8), ...planOld.newDecks]);
let oldBad = false;
for (const s of [-1, 1]) {
  const tx = CP.x + CP.nx * GAME.TOWER_SIDE_OFF * s, tz = CP.z + CP.nz * GAME.TOWER_SIDE_OFF * s;
  if (Cold.makeDeckIndex && Cold.planTowerBridgePads) {
    const reach = walkPastBase(deckYold, tx, tz);
    if (reach < Cold.TOWER_BASE_R + WALK) oldBad = true;
  }
}
ok(oldBad, '舊值(10.5)下沿橋軸走位帶 < 基座 + 8 ⇒ 對照組如預期不足(稽核有牙齒)');
// TOWER_PAD_OUT 寫回舊值(=TOWER_PAD_R 10.5)⇒ 水側徑向走位帶不足(繞塔水側掉水)
const ColdOut = loadCore((s) => s.replace('const TOWER_PAD_OUT = 16;', 'const TOWER_PAD_OUT = 10.5;'));
const planOO = ColdOut.planTowerBridgePads([CP], straightBridge(8), terrain);
const deckYOO = ColdOut.makeDeckIndex([...straightBridge(8), ...planOO.newDecks]);
let outBad = false;
for (const s of [-1, 1]) {
  const tx = CP.x + CP.nx * GAME.TOWER_SIDE_OFF * s, tz = CP.z + CP.nz * GAME.TOWER_SIDE_OFF * s;
  if (walkRadialOut(deckYOO, tx, tz, CP.nx * s, CP.nz * s) < ColdOut.TOWER_BASE_R + WALK) outBad = true;
}
ok(outBad, '舊值(10.5)下水側徑向走位帶 < 基座 + 8 ⇒ 對照組如預期不足(稽核有牙齒)');

// ---------------------------------------------------------------------------
console.log(`\n${fail === 0 ? '✅ 全綠' : '❌ 有紅字'}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
