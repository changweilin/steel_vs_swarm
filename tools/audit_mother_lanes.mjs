// ============ 同一張圖稽核:1~3 條兵線共用三線母體 ============
// 使用者定案(2026-09-25):標準戰場 1~3 條兵線用同一張圖 ——
//   L1 = 母體中路、L2 = 母體左右兩路、L3 = 全開;框架(主堡/中心/尺寸)與人數無關。
// 斷言:
//   Ⅰ 預設場地:venueConfig(v, teamSize) × teamSize 1..5，主堡/中心/尺寸逐位元相同，
//      啟用兵線 == 母體子集(laneSubsetFor)，laneIds 對齊母體下標，母體恆 3 線且端點即主堡，
//      啟用兵線過 laneSeparationAudit + towerLayoutAudit、兩堡距離 ≥ 對角線 80%(開房三閘同標準)。
//   Ⅱ 擴充地圖:同種子/來源的 mixed/random × teamSize 1..5，同圖同母體、啟用為子集。
//   Ⅲ 合成縫:synthLane 確定性(同輸入同輸出)、端點精確落堡、salt 換流不動端點。
//   Ⅳ 換邊縫:rooms.js rollSideSwap 連 motherLanes 一起反轉(原文斷言)。
// 劇情戰役不進母體(專用 m1 單線)，Ⅰ 另驗其恆單線且無母體。
// 用法:node tools/audit_mother_lanes.mjs
import { MAPGEO, lanesFor, laneCountFor, laneSubsetFor, MOTHER_LANES, laneSeparationAudit, towerLayoutAudit } from '../public/js/data.js';
import { VENUES, venueConfig, synthLane } from '../public/js/venues.js';
import { mixedMapConfig, randomMapConfig } from '../public/js/mapgen.js';
import { readSrc } from './audit_src.mjs';

let pass = 0, fail = 0;
const ok = (v, msg) => { v ? pass++ : (fail++, console.error(`  ✗ ${msg}`)); };
const J = (o) => JSON.stringify(o);

const EARTH = 6371000, SC = 1 / MAPGEO.REAL_SCALE;
const toGame = (lanes, o) => {
  const cosO = Math.cos(o[0] * Math.PI / 180);
  return lanes.map((lane) => lane.map(([lat, lng]) => [
    (lng - o[1]) * Math.PI / 180 * EARTH * cosO * SC,
    (lat - o[0]) * Math.PI / 180 * EARTH * SC,
  ]));
};

console.log('Ⅰ 預設場地:同圖同母體');
{
  let cfgs = 0;
  for (const v of VENUES) {
    const byTs = [];
    for (let ts = 1; ts <= 5; ts++) byTs.push(venueConfig(v, ts));
    cfgs += byTs.length;
    const base0 = byTs[0];
    for (let ts = 1; ts <= 5; ts++) {
      const cfg = byTs[ts - 1];
      const L = laneCountFor(ts, false);
      ok(J(cfg.bases) === J(base0.bases), `${v.id} ts=${ts} 主堡與 ts=1 相同`);
      ok(J(cfg.center) === J(base0.center), `${v.id} ts=${ts} 中心與 ts=1 相同`);
      ok(cfg.sizeM === base0.sizeM && cfg.diagM === base0.diagM, `${v.id} ts=${ts} 尺寸與 ts=1 相同`);
      ok(cfg.laneCount === L && cfg.lanes.length === L, `${v.id} ts=${ts} 啟用 ${L} 線`);
      ok(J(cfg.laneIds) === J(laneSubsetFor(L)), `${v.id} ts=${ts} laneIds=${J(cfg.laneIds)}`);
      ok(cfg.motherLanes?.length === MOTHER_LANES, `${v.id} ts=${ts} 母體恆 ${MOTHER_LANES} 線`);
      ok(J(cfg.motherLanes) === J(base0.motherLanes), `${v.id} ts=${ts} 母體與 ts=1 相同`);
      cfg.lanes.forEach((lane, k) => {
        if (J(lane) !== J(cfg.motherLanes[cfg.laneIds[k]])) { ok(false, `${v.id} ts=${ts} 第${k}線 == 母體[${cfg.laneIds[k]}]`); }
        else pass++;
      });
      // 母體端點即主堡(共享端點是子集關係的前提)
      cfg.motherLanes.forEach((lane, k) => {
        ok(J(lane[0]) === J(cfg.bases.SWARM) && J(lane[lane.length - 1]) === J(cfg.bases.STEEL),
          `${v.id} ts=${ts} 母體[${k}]端點即主堡`);
      });
      // 開房三閘同標準(主堡距離/分離/砲塔)
      ok(cfg.distM >= cfg.diagM * MAPGEO.MIN_DIST_FRAC - 1e-9, `${v.id} ts=${ts} 兩堡 ≥ 對角線 80%`);
      const game = toGame(cfg.lanes, cfg.lanes[0][0]);
      ok(laneSeparationAudit(game).ok, `${v.id} ts=${ts} 啟用兵線分離`);
      ok(towerLayoutAudit(game, false).ok, `${v.id} ts=${ts} 啟用兵線砲塔合規`);
    }
    // 劇情戰役:恆單線、無母體、不動舊制
    const story = venueConfig(v, 5, 'SWARM');
    ok(story.lanes.length === 1 && story.laneCount === 1, `${v.id} 劇情恆單線`);
    ok(story.motherLanes === undefined, `${v.id} 劇情無母體`);
    ok(story.defSide === 'SWARM', `${v.id} 劇情防守方攜帶`);
  }
  console.log(`  (場地 ${VENUES.length} × 人數 5 + 劇情,共 ${cfgs} 份 battleConfig)`);
}

console.log('Ⅱ 擴充地圖:同種子同圖');
{
  const sources = VENUES.slice(0, 3).map((v) => ({ name: v.name, ll: v.ll, mix: v.mix, weight: 1 }));
  const cfgs = [1, 2, 3, 4, 5].map((ts) => mixedMapConfig(sources, { teamSize: ts, seed: 12345 }));
  ok(cfgs.every((c) => J(c.bases) === J(cfgs[0].bases) && c.sizeM === cfgs[0].sizeM), 'mixed 同種子跨人數同圖');
  cfgs.forEach((c, i) => {
    const L = lanesFor(i + 1);
    ok(c.lanes.length === L && J(c.laneIds) === J(laneSubsetFor(L)), `mixed ts=${i + 1} 啟用子集`);
    ok(c.motherLanes?.length === 3 && J(c.motherLanes) === J(cfgs[0].motherLanes), `mixed ts=${i + 1} 母體相同`);
  });
  const anchors = VENUES.map((v) => ({ ll: v.ll }));
  const rcfgs = [1, 3, 5].map((ts) => randomMapConfig({ teamSize: ts, seed: 777, anchors }));
  ok(rcfgs.every((c) => J(c.bases) === J(rcfgs[0].bases) && c.sizeM === rcfgs[0].sizeM), 'random 同種子跨人數同圖');
  rcfgs.forEach((c, k) => {
    const L = lanesFor([1, 3, 5][k]);
    ok(c.lanes.length === L && J(c.laneIds) === J(laneSubsetFor(L)), `random ts=${[1, 3, 5][k]} 啟用子集`);
  });
}

console.log('Ⅲ 合成縫確定性');
{
  const A = [25.0339, 121.5645], B = [25.041, 121.572];
  for (const salt of [0, 1, 2]) {
    for (const side of [1, 0, -1]) {
      const p = synthLane(A, B, side, salt), q = synthLane(A, B, side, salt);
      ok(J(p) === J(q), `synthLane side=${side} salt=${salt} 確定性`);
      ok(J(p[0]) === J(A) && J(p[p.length - 1]) === J(B), `synthLane side=${side} salt=${salt} 端點落堡`);
    }
  }
  ok(J(synthLane(A, B, 0)) === J(synthLane(A, B, 0, 0)), 'salt 省略 == salt 0(舊制逐位元)');
}

console.log('Ⅳ 換邊縫');
{
  const src = readSrc('server', 'rooms.js');
  ok(src.includes('cfg.motherLanes'), 'rollSideSwap 處理 motherLanes(隨 lanes 同反轉)');
}

console.log(`\n總結:通過 ${pass},失敗 ${fail}(MUST 0)`);
process.exit(fail ? 1 : 0);
