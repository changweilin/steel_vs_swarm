// ============ 水域／沼澤主堡大型承台稽核（執行 biomes.js 原文）============
// 起因：主堡落在水域或沼澤時，裸地形會讓主堡、重生點與治癒光環泡在水中。
// 修法：以 HERO_HEAL_R 推導承台半徑，視覺板／decks 站立面／支撐柱同一次規劃；
//       basePadY 再讓主堡本體與治癒光環共用台面高度。乾地主堡不得生成承台。
//
// 跑法：node tools/audit_base_water_pad.mjs
// 反向：node tools/audit_base_water_pad.mjs --break-wet
import { GAME, WATER } from '../public/js/data.js';
import { readSrc } from './audit_src.mjs';

const bio = readSrc('public', 'js', 'biomes.js');
const main = readSrc('public', 'js', 'main.js');
const game = readSrc('public', 'js', 'game.js');
const BREAK = process.argv.includes('--break-wet');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function sourceUnderTest() {
  const towerA = bio.indexOf('const TOWER_PAD_R = 10.5;');
  const towerB = bio.indexOf('function planTowerBridgePads', towerA);
  const baseA = bio.indexOf('// ---- 水域／沼澤主堡承台 ----');
  const baseB = bio.indexOf('function buildBaseWaterPads', baseA);
  if (towerA < 0 || towerB <= towerA || baseA < 0 || baseB <= baseA) {
    throw new Error('biomes.js 主堡承台切片標記找不到');
  }
  let src = `${bio.slice(towerA, towerB)}\n${bio.slice(baseA, baseB)}`;
  if (BREAK) {
    const bad = 'if (terrainEnvCode(terrain, base.x, base.z) !== 0) continue;';
    const good = 'if (terrainEnvCode(terrain, base.x, base.z) === 0) continue;';
    if (!src.includes(good)) throw new Error('--break-wet 替換目標不存在');
    src = src.replace(good, bad);
  }
  return src;
}

const core = await new AsyncFunction('GAME', 'WATER', 'terrainEnvCode',
  `${sourceUnderTest()}\nreturn { planBaseWaterPads, BASE_PAD_R, BASE_PAD_T, TOWER_PAD_R };`,
)(GAME, WATER, (terrain, x, z) => terrain.codeAt(x, z));

let pass = 0, fail = 0;
const ok = (v, msg) => { v ? pass++ : (fail++, console.error(`  ✗ ${msg}`)); };
const bases = [{ side: 'SWARM', x: 0, z: 0 }, { side: 'STEEL', x: 400, z: 0 }];
const terrain = {
  waterY: WATER.LEVEL,
  minX: -200, minZ: -200, gridM: 8,
  codeAt: (x) => x < 200 ? 2 : 0,
  heightAt: (x, z) => (x === 8 && z === 8 ? 20 : x < 200 ? Math.max(-2, 0.004 * (x + z)) : 12),
};

console.log('Ⅰ 濕地條件與尺寸推導');
const plan = core.planBaseWaterPads(bases, terrain);
ok(plan.pads.length === 1 && plan.pads[0].side === 'SWARM', `只替水／沼主堡建台：${plan.pads.length}`);
const spawnR = Math.hypot(GAME.HERO_SPAWN_OFF, GAME.HERO_SPAWN_SIDE);
ok(Math.abs(core.BASE_PAD_R - (Math.max(GAME.HERO_HEAL_R, spawnR) + core.TOWER_PAD_R)) < 1e-9,
  `承台半徑由治癒光環與重生偏移共同推導：${core.BASE_PAD_R}`);
ok(core.BASE_PAD_R > GAME.HERO_HEAL_R, '承台完整涵蓋治癒光環並保留外緣');
ok(spawnR < core.BASE_PAD_R, `重生偏移 ${spawnR.toFixed(1)}m 在承台 ${core.BASE_PAD_R.toFixed(1)}m 內`);

console.log('Ⅱ 所見、所站與支撐一致');
ok(plan.slabs.length === 1 && plan.newDecks.length === 1, '每座濕地主堡一片視覺板 + 一片站立面');
const slab = plan.slabs[0], deck = plan.newDecks[0], pad = plan.pads[0];
ok(slab.size / 2 === core.BASE_PAD_R && deck.hw === core.BASE_PAD_R
  && deck.x1 === -core.BASE_PAD_R && deck.x2 === core.BASE_PAD_R, '視覺板與 decks 覆蓋同一方形台面');
ok(pad.y >= terrain.waterY + WATER.SWAMP_BAND + core.BASE_PAD_T, '台面高過沼澤水面與完整板厚');
ok(pad.y >= 20 + core.BASE_PAD_T, '台面取遍地形格點，最高峰不穿出台面');
ok(plan.piers.length === 9 && plan.cols.length === 9, `3×3 支撐柱與碰撞柱齊備：${plan.piers.length}/${plan.cols.length}`);

console.log('Ⅲ 高度與淨空接線');
ok(bio.indexOf('function planBaseWaterPads') > bio.indexOf('export function makeDeckIndex'),
  '主堡承台材質位於凍結的 buildRoads → makeDeckIndex 授權區之外');
ok(/buildBaseWaterPads\(group, basesW, terrain, roadRes\.decks, roadRes\.cols\)/.test(bio), '承台併入道路 decks／cols 單一縫');
ok(/terrain\.basePadY\s*=/.test(main) && /biomes\.userData\.basePads/.test(main), 'main 安裝 basePadY');
ok(/e\.k === 'base'\) ent\.padY = this\.terrain\.basePadY/.test(game), '主堡本體讀 basePadY');
ok(/ent\.padY \?\? this\.terrain\.heightAt\(wx, wz\)/.test(game), '治癒光環與主堡共用 padY');
ok(/terrainEnvCode\(terrain, base\.x, base\.z\) !== 0\) blockArea\(blocked, base\.x, base\.z, BASE_PAD_R\)/.test(bio),
  '濕地主堡在散布前登記完整承台淨空');

console.log(`\n${fail === 0 ? '✅ 全綠' : '❌ 有紅字'}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
