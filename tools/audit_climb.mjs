// 攀爬路線(長梯 / 攀岩抓點 / 垂降技術繩)+ 有向盒遮蔽稽核 —— 離線直測。
//
// 起因(2026-07-28 使用者需求):「隨機挑選(約 3 成)建築/巨石/神木,對應加入連同地面與頂端的
// 長梯/攀岩抓點/垂降技術繩,供地面單位爬上爬下,地面端梯子需放在無障礙的那一側,可到頂端立足射擊,
// 建築/巨石/神木同樣需考慮物理碰撞,所有方向皆可抵擋射擊」。
//
// 四段:
//   Ⅰ 路線規劃直測(執行 `climb.js` 真正的原文):抽樣率 / 確定性 / 固定枚數亂數 /
//     高度窗口 / 三種設施對應 / 頂端與 blockerTopAt 同源 / **地面端落在無障礙那一側** /
//     四面皆阻 → 不掛 / 水域 / 陡坡 / 圖界 / 攀爬軸在碰撞體外 / 登頂落腳點在輪廓內
//   Ⅱ 抓握索引(makeClimbIndex)邊界
//   Ⅲ **有向盒遮蔽兩端同判**:客戶端 `game.js _blockerHitT` 與伺服器 `sim.js _losBlocked` 對同一個盒
//     同一條線段 MUST 給同一個答案(牆角 / 細長樓側面 / 正面),含 sim 座標鏡射(z 反號 ⇒ ry 反號)
//   Ⅳ 靜態規則(單一縫 / A21 / A25 / 純客戶端)
//
// 為什麼用「抽原文」而不是 import:`climb.js` 與 `game.js` 的 three 走 CDN importmap,Node 端解析不了;
// 抽出來評估的仍是**真正的程式碼文字**(另抄一份公式就永遠會通過)。
// 跑法:`node tools/audit_climb.mjs`   退出碼:0 = 全綠;1 = 有紅字
//
// **改完 MUST 做反向驗證**:把 planClimbRoutes 的淨空檢查拿掉(clearance 恆 Infinity)、
// 把抽樣改成「淘汰後才抽」、把 `_blockerHitT` 寫回純圓柱,稽核 MUST 在對應條目紅字。
// (前兩者的對照組已內建於 Ⅰ-⑧ / Ⅰ-③,第三者內建於 Ⅲ。)

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BattleSim } from '../server/sim.js';
import { SOLDIER_H, HERO_SIZE, MAPGEO } from '../public/js/data.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const climbSrc = readFileSync(join(ROOT, 'public', 'js', 'climb.js'), 'utf8');
const gameSrc = readFileSync(join(ROOT, 'public', 'js', 'game.js'), 'utf8');
const mainSrc = readFileSync(join(ROOT, 'public', 'js', 'main.js'), 'utf8');
const simSrc = readFileSync(join(ROOT, 'server', 'sim.js'), 'utf8');
const helpSrc = readFileSync(join(ROOT, 'public', 'js', 'help.js'), 'utf8');
const biomeSrc = readFileSync(join(ROOT, 'public', 'js', 'biomes.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : (fail++, console.error(`  ✗ ${msg}`)); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ---------------------------------------------------------------------------
// climb.js 的「純幾何段」原文 → 可執行模組(THREE 之前的整段:常數 + 四支函式)
// ---------------------------------------------------------------------------
const MAX_BODY_R = SOLDIER_H * Math.max(...Object.values(HERO_SIZE).map((s) => s.mul[1])) * 0.317;
function loadCore(mutate = (s) => s) {
  const P0 = climbSrc.indexOf('export const CLIMB = {');
  const P1 = climbSrc.indexOf('// 3D 幾何(純表現層)');
  if (P0 < 0 || P1 <= P0) throw new Error('climb.js 找不到純幾何段');
  const body = mutate(climbSrc.slice(P0, P1)).replace(/^export /gm, '');
  return new Function('MAX_BODY_R',
    `${body}\nreturn { CLIMB, CLIMB_KIND, CLIMB_LABEL, surfacePoint, climbCandidate, planClimbRoutes, makeClimbIndex };`,
  )(MAX_BODY_R);
}
const C = loadCore();
const { CLIMB, CLIMB_KIND, surfacePoint, climbCandidate, planClimbRoutes, makeClimbIndex } = C;

// mulberry32(與 biomes.js 同款;稽核要的是確定性,不是同一個 seed)
const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const BOX = { minX: -4000, maxX: 4000, minZ: -4000, maxZ: 4000 };
const flat = () => 20;
const dry = () => 0;
const bld = (x, z, w, d, h, ry = 0) => ({
  x, z, y: 19, h, bld: 1, cl: 'bld', hw2: w / 2, hd2: d / 2, ry,
  r: Math.hypot(w, d) / 2 * 0.8,
});
const rock = (x, z, r, h) => ({ x, z, y: 18, r, h, std: 1, cl: 'rock' });
const tree = (x, z, r, h) => ({ x, z, y: 19, r, h, std: 1, cl: 'tree' });
const plan = (blockers, opt = {}) => planClimbRoutes({
  blockers,
  heightAt: opt.heightAt || flat,
  envCodeAt: opt.envCodeAt || dry,
  bounds: opt.bounds || BOX,
  rnd: mulberry32(opt.seed ?? 12345),
});

console.log('\n=== Ⅰ 路線規劃(執行 climb.js 原文)===');

// ① 抽樣率約三成
{
  const list = [];
  for (let i = 0; i < 400; i++) list.push(bld((i % 20) * 200 - 2000, Math.floor(i / 20) * 200 - 2000, 24, 18, 30));
  const r = plan(list);
  const share = r.length / list.length;
  ok(share > 0.24 && share < 0.36, `① 抽樣率 ≈ CLIMB.SHARE(實測 ${(share * 100).toFixed(1)}%,期望 30±6pp)`);
  ok(list.every(climbCandidate), '① 400 棟皆為合格候選(高度窗口內、bld 旗標)');
}

// ② 確定性:同 seed 逐項相同、不同 seed 會不同(A4)
{
  const list = [];
  for (let i = 0; i < 200; i++) list.push(bld((i % 20) * 200 - 2000, Math.floor(i / 20) * 200 - 2000, 24, 18, 30));
  const a = plan(list, { seed: 7 }), b = plan(list, { seed: 7 }), c = plan(list, { seed: 8 });
  const key = (rs) => rs.map((r) => `${r.x.toFixed(4)},${r.z.toFixed(4)},${r.kind}`).join('|');
  ok(key(a) === key(b), '② 同 seed → 逐項相同(跨客戶端一致)');
  ok(key(a) !== key(c), '② 不同 seed → 佈局不同(不是常數輸出)');
}

// ③ 抽樣紀律:每個候選固定消耗 2 枚亂數、淘汰檢查排在抽樣之後(§2.3)
//    ⇒ 把中間幾棟改成「太矮」(不合格)後,**其餘**被抽中的集合 MUST 完全不變。
//    對照組:抽樣改成「淘汰後才抽」(先 continue 再 rnd)⇒ 序列位移,集合必然改變。
{
  const mk = () => {
    const l = [];
    for (let i = 0; i < 120; i++) l.push(bld((i % 12) * 200 - 1200, Math.floor(i / 12) * 200 - 1200, 24, 18, 30));
    return l;
  };
  const base = mk();
  const short = mk();
  for (const i of [3, 17, 42, 88]) short[i].h = 4;          // 低於 MIN_H ⇒ 不合格
  const set = (rs) => new Set(rs.map((r) => `${r.b.x},${r.b.z}`));
  const A = set(plan(base, { seed: 99 })), B = set(plan(short, { seed: 99 }));
  const drop = new Set([3, 17, 42, 88].map((i) => `${base[i].x},${base[i].z}`));
  const same = [...A].filter((k) => !drop.has(k)).every((k) => B.has(k)) && [...B].every((k) => A.has(k));
  ok(same, '③ 淘汰候選 MUST NOT 擾動其餘抽樣結果(每候選固定 2 枚亂數)');

  const lateRnd = loadCore((s) => s
    .replace('    const pick = rnd();\n    const phase = rnd() * Math.PI * 2;\n    if (!climbCandidate(b)) continue;\n    if (pick >= CLIMB.SHARE) continue;',
      '    if (!climbCandidate(b)) continue;\n    const pick = rnd();\n    const phase = rnd() * Math.PI * 2;\n    if (pick >= CLIMB.SHARE) continue;'));
  const setL = (rs) => new Set(rs.map((r) => `${r.b.x},${r.b.z}`));
  const A2 = setL(lateRnd.planClimbRoutes({ blockers: base, heightAt: flat, envCodeAt: dry, bounds: BOX, rnd: mulberry32(99) }));
  const B2 = setL(lateRnd.planClimbRoutes({ blockers: short, heightAt: flat, envCodeAt: dry, bounds: BOX, rnd: mulberry32(99) }));
  const shifted = [...A2].filter((k) => !drop.has(k)).some((k) => !B2.has(k));
  ok(shifted, '③ 反向對照:改成「淘汰後才抽」MUST 讓其餘結果漂移(證明本條真的驗到了)');
}

// ④ 高度窗口
{
  const lo = [], hi = [];
  for (let i = 0; i < 200; i++) {
    lo.push(bld(i * 200 - 2000, -3000, 24, 18, CLIMB.MIN_H - 0.1));
    hi.push(tree(i * 200 - 2000, 3000, 8, CLIMB.MAX_H + 0.1));
  }
  ok(plan(lo).length === 0, `④ 高度 < MIN_H(${CLIMB.MIN_H}m)MUST 不掛路線(跳一下就上去了)`);
  ok(plan(hi).length === 0, `④ 高度 > MAX_H(${CLIMB.MAX_H}m)MUST 不掛路線(爬太久 = 站著挨打)`);
  ok(climbCandidate(bld(0, 0, 20, 20, CLIMB.MIN_H)) && climbCandidate(tree(0, 0, 6, CLIMB.MAX_H)),
    '④ 邊界值(恰為 MIN_H / MAX_H)MUST 是合格候選');
  ok(!climbCandidate({ x: 0, z: 0, y: 0, r: 3, h: 40 }), '④ 無 bld/std 旗標(橋墩/封路障礙)MUST NOT 是候選');
}

// ⑤ 三種設施 ← 結構型別(使用者列舉的三種)
{
  const list = [];
  const gx = (i) => (i % 15) * 200 - 1400, gz = (i, row) => Math.floor(i / 15) * 200 + row;
  for (let i = 0; i < 90; i++) list.push(bld(gx(i), gz(i, -2600), 24, 18, 30));
  for (let i = 0; i < 90; i++) list.push(rock(gx(i), gz(i, -400), 14, 26));
  for (let i = 0; i < 90; i++) list.push(tree(gx(i), gz(i, 1800), 9, 60));
  const rs = plan(list, { seed: 4242 });
  ok(rs.length > 40, `⑤ 三型別各 90 個 ⇒ 應抽出數十條(實測 ${rs.length})`);
  ok(rs.every((r) => r.kind === CLIMB_KIND[r.b.cl]), '⑤ 建築→長梯 / 巨石→攀岩抓點 / 神木→垂降技術繩(逐條對上)');
  ok(new Set(rs.map((r) => r.kind)).size === 3, '⑤ 三種設施皆有產出');
}

// ⑥ 頂端 = blockerTopAt 的頂面高(單一縫);地面端 = 該點地表
{
  const slope = (x) => 20 + x * 0.004;                       // 緩坡(每 100m 抬 0.4m,遠低於 STEP)
  const list = [];
  for (let i = 0; i < 60; i++) list.push(bld(i * 200 - 2000, 0, 30, 24, 40));
  const rs = plan(list, { seed: 5, heightAt: (x) => slope(x) });
  ok(rs.length > 0 && rs.every((r) => near(r.y1, r.b.y + r.b.h)),
    '⑥ 頂端 y1 MUST = b.y + b.h(= makeBlockerTopIndex 的回傳值 ⇒ 爬到頂剛好站得住)');
  ok(rs.every((r) => near(r.y0, slope(r.x), 1e-9)), '⑥ 地面端 y0 MUST = 攀爬軸那一點的地表高');
}

// ⑦ 攀爬軸 MUST 落在碰撞體外 OFF,且 OFF > 最大機體碰撞半徑(否則爬到一半被 _collide 推開)
{
  ok(CLIMB.OFF > MAX_BODY_R,
    `⑦ CLIMB.OFF(${CLIMB.OFF.toFixed(2)}m)MUST > 最大機體碰撞半徑(${MAX_BODY_R.toFixed(2)}m)`);
  const list = [bld(0, 0, 40, 16, 30, 0.7), rock(600, 0, 18, 30), tree(1200, 0, 7, 50)];
  const rs = planClimbRoutes({ blockers: list, heightAt: flat, envCodeAt: dry, bounds: BOX, rnd: () => 0 });
  ok(rs.length === 3, '⑦ rnd 恆 0(必中)+ 四周淨空 ⇒ 三個結構都掛得上');
  const outside = rs.every((r) => {
    if (r.b.hw2 != null) {
      const cs = Math.cos(r.b.ry), sn = Math.sin(r.b.ry);
      const rx = r.x - r.b.x, rz = r.z - r.b.z;
      const lx = Math.abs(rx * cs + rz * sn), lz = Math.abs(-rx * sn + rz * cs);
      // 盒外緣距離:落在某一面的正外側 ⇒ 該軸超出 hw2/hd2 恰好 OFF,另一軸仍在盒內
      return near(Math.max(lx - r.b.hw2, lz - r.b.hd2), CLIMB.OFF, 1e-6);
    }
    return near(Math.hypot(r.x - r.b.x, r.z - r.b.z) - r.b.r, CLIMB.OFF, 1e-6);
  });
  ok(outside, '⑦ 攀爬軸離結構表面恰為 OFF(有向盒走面、圓柱走半徑)');
  ok(rs.every((r) => near(Math.hypot(r.nx, r.nz), 1, 1e-9)), '⑦ 向外法線 MUST 是單位向量(A26 擺位/旋轉同調的前提)');
  ok(rs.every((r) => (r.x - r.fx) * r.nx + (r.z - r.fz) * r.nz > 0), '⑦ 攀爬軸在表面點的**外側**(法線正負號不得反)');
}

// ⑧ 地面端 MUST 落在無障礙的那一側(使用者明示)
{
  // 中央一棟樓,東 / 南 / 北 三面各堵一顆大巨石,只剩西面(−X)是空的
  const B = bld(0, 0, 40, 40, 40);
  const wall = (x, z) => ({ x, z, y: 19, r: 40, h: 40, std: 1, cl: 'rock' });
  const list = [B, wall(60, 0), wall(0, 60), wall(0, -60)];
  const rs = planClimbRoutes({ blockers: list, heightAt: flat, envCodeAt: dry, bounds: BOX, rnd: () => 0 });
  const mine = rs.filter((r) => r.b === B);
  ok(mine.length === 1, '⑧ 只有一面空著 ⇒ 仍掛得上路線(不會因為三面被堵就整棟放棄)');
  ok(mine[0] && mine[0].nx < -0.9, '⑧ 地面端 MUST 落在那唯一無障礙的一側(−X;法線指向空側)');
  ok(mine[0] && mine[0].x < B.x - B.hw2, '⑧ 梯腳座標確實在空側的牆外');

  // 反向對照:拿掉淨空檢查 ⇒ 起相位 0 的第一個方位就被採用,梯腳落進巨石裡
  // 對照組 = 完整的「舊制」:既不驗淨空、也不挑最空的一側,直接採用起相位的第一個方位
  const noClear = loadCore((s) => s
    .replace('      if (cl < CLIMB.CLEAR_R) continue;', '      // (對照組:淨空檢查已停用)')
    .replace('      if (!best || cl > best.cl) best = { ...sp, x, z, gy, cl };', '      if (!best) best = { ...sp, x, z, gy, cl };'));
  const bad = noClear.planClimbRoutes({ blockers: list, heightAt: flat, envCodeAt: dry, bounds: BOX, rnd: () => 0 })
    .filter((r) => r.b === B);
  ok(bad.length === 1 && bad[0].nx > -0.9, '⑧ 反向對照:拿掉淨空檢查 MUST 讓梯腳落到被堵的那一側(證明本條真的驗到了)');
}

// ⑨ 四面皆阻 → 寧缺勿錯,不掛路線(§4)
{
  const B = bld(0, 0, 40, 40, 40);
  const wall = (x, z) => ({ x, z, y: 19, r: 40, h: 40, std: 1, cl: 'rock' });
  const list = [B, wall(60, 0), wall(-60, 0), wall(0, 60), wall(0, -60)];
  const rs = planClimbRoutes({ blockers: list, heightAt: flat, envCodeAt: dry, bounds: BOX, rnd: () => 0 })
    .filter((r) => r.b === B);
  ok(rs.length === 0, '⑨ 四面皆有障礙 MUST 不掛路線(寧缺勿錯,不放寬約束硬塞)');
}

// ⑩ 水域 / 沼澤那一側不是「無障礙」
{
  const B = bld(0, 0, 40, 40, 40);
  const half = (x) => (x > 0 ? 0 : 1);                     // −X 半邊全是水
  const rs = planClimbRoutes({ blockers: [B], heightAt: flat, envCodeAt: (x) => half(x), bounds: BOX, rnd: () => 0 });
  ok(rs.length === 1 && rs[0].x > 0, '⑩ 水域側 MUST 不被選中(梯腳落在乾地那一側)');
  const allWet = planClimbRoutes({ blockers: [B], heightAt: flat, envCodeAt: () => 1, bounds: BOX, rnd: () => 0 });
  ok(allWet.length === 0, '⑩ 四周全是水 MUST 不掛路線');
}

// ⑪ 陡坡那一側不算「無障礙」(落腳點與基座高差 > STEP)
{
  const B = bld(0, 0, 40, 40, 40);
  const cliff = (x) => (x >= 0 ? 20 : 20 - CLIMB.STEP * 3);  // −X 是斷崖(基座落在高側)
  const rs = planClimbRoutes({ blockers: [B], heightAt: cliff, envCodeAt: dry, bounds: BOX, rnd: () => 0 });
  ok(rs.length === 1 && rs[0].x > 0, '⑪ 高差 > CLIMB.STEP 的那一側 MUST 不被選中');
  const allCliff = planClimbRoutes({
    blockers: [B], heightAt: (x, z) => (Math.hypot(x, z) > 20 ? -100 : 20),
    envCodeAt: dry, bounds: BOX, rnd: () => 0,
  });
  ok(allCliff.length === 0, '⑪ 整棟坐在孤峰上(四周皆斷崖)MUST 不掛路線');
}

// ⑫ 圖界內縮:貼著空氣牆的結構不把梯腳擺到界外
{
  const B = bld(-3990, 0, 40, 40, 40);
  const rs = planClimbRoutes({ blockers: [B], heightAt: flat, envCodeAt: dry, bounds: BOX, rnd: () => 0 });
  ok(rs.every((r) => r.x > BOX.minX + 40), '⑫ 梯腳 MUST NOT 落在圖界內縮帶之外');
}

// ⑬ 登頂落腳點在結構水平輪廓「內」(不停在邊緣;細瘦結構夾在該方向半徑的 80% 內)
{
  const list = [bld(0, 0, 40, 16, 30, 0.7), rock(600, 0, 18, 30), tree(1200, 0, 2, 50)];
  const rs = planClimbRoutes({ blockers: list, heightAt: flat, envCodeAt: dry, bounds: BOX, rnd: () => 0 });
  const inside = rs.every((r) => {
    const b = r.b;
    if (b.hw2 != null) {
      const cs = Math.cos(b.ry), sn = Math.sin(b.ry);
      const rx = r.tx - b.x, rz = r.tz - b.z;
      return Math.abs(rx * cs + rz * sn) <= b.hw2 + 1e-6 && Math.abs(-rx * sn + rz * cs) <= b.hd2 + 1e-6;
    }
    return Math.hypot(r.tx - b.x, r.tz - b.z) <= b.r + 1e-6;
  });
  ok(inside, '⑬ 登頂落腳點 MUST 落在結構水平輪廓內(踏上頂面,不是踩在邊緣掉下去)');
  // 細瘦結構(r=2m 神木,rad×0.8 = 1.6 < TOP_STEP 2.2):落腳點 MUST 仍在**表面點那一側**,
  // 不夾制的話會踏過樹心跑到對面,登頂瞬間人被送到結構的另一邊
  const thin = rs.find((r) => r.b.r === 2);
  ok(thin && Math.hypot(thin.tx - thin.b.x, thin.tz - thin.b.z) <= 2 * 0.8 + 1e-6,
    '⑬ 細瘦結構 MUST 夾在 rad×0.8 內');
  ok(thin && (thin.tx - thin.b.x) * thin.nx + (thin.tz - thin.b.z) * thin.nz >= 0,
    '⑬ 落腳點 MUST NOT 踏過結構中心到另一側(TOP_STEP 未夾制就會)');
}

// ⑬b 密集街廓仍長得出路線(CLEAR_R 的回歸閘):補間建物 pitch 36m、量體 20×16
//     ⇒ 面對面淨距 16m,梯腳(面外 OFF)離鄰棟牆面仍有餘裕。CLEAR_R 調大到吃掉它就會在這裡紅字。
{
  const list = [];
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) list.push(bld(i * 36 - 180, j * 36 - 180, 20, 16, 26));
  const rs = plan(list, { seed: 31337 });
  const share = rs.length / list.length;
  ok(share > 0.2, `⑬b 密集街廓(pitch 36m)MUST 仍有約三成掛得上(實測 ${(share * 100).toFixed(0)}%)`);
  // 每條梯腳與**其他**建物盒面的距離 MUST ≥ CLEAR_R(規劃時的承諾要在成品上成立)
  const bad = rs.filter((r) => list.some((o) => {
    if (o === r.b) return false;
    const lx = Math.abs(r.x - o.x) - o.hw2, lz = Math.abs(r.z - o.z) - o.hd2;
    return Math.hypot(Math.max(0, lx), Math.max(0, lz)) + Math.min(0, Math.max(lx, lz)) < CLIMB.CLEAR_R;
  }));
  ok(bad.length === 0, `⑬b 每條梯腳與鄰棟牆面 MUST ≥ CLEAR_R(${CLIMB.CLEAR_R}m;違規 ${bad.length} 條)`);
}

// ⑭ surfacePoint:旋轉盒的表面點落在盒面上、法線 = 該面法線(A26)
{
  const b = bld(10, -5, 60, 20, 40, 0.9);
  for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2;
    const sp = surfacePoint(b, a);
    const cs = Math.cos(b.ry), sn = Math.sin(b.ry);
    const lx = (sp.fx - b.x) * cs + (sp.fz - b.z) * sn, lz = -(sp.fx - b.x) * sn + (sp.fz - b.z) * cs;
    const onFace = near(Math.abs(lx), b.hw2, 1e-9) ? Math.abs(lz) <= b.hd2 + 1e-9
      : near(Math.abs(lz), b.hd2, 1e-9) && Math.abs(lx) <= b.hw2 + 1e-9;
    const lnx = sp.nx * cs + sp.nz * sn, lnz = -sp.nx * sn + sp.nz * cs;   // 法線轉回 local
    const axisOk = near(Math.abs(lx), b.hw2, 1e-9)
      ? near(Math.abs(lnx), 1, 1e-9) && near(lnz, 0, 1e-9) && Math.sign(lnx) === Math.sign(lx)
      : near(Math.abs(lnz), 1, 1e-9) && near(lnx, 0, 1e-9) && Math.sign(lnz) === Math.sign(lz);
    if (!onFace || !axisOk) { ok(false, `⑭ 方位 ${(a * 180 / Math.PI).toFixed(0)}° 的表面點/法線不合(A26)`); break; }
    if (k === 23) ok(true, '⑭ 旋轉盒 24 個方位:表面點落在盒面、法線 = 該面法線且朝外(A26 同調)');
  }
  const sp = surfacePoint(rock(0, 0, 12, 30), 1.234);
  ok(near(Math.hypot(sp.fx, sp.fz), 12, 1e-9) && near(sp.rad, 12, 1e-9), '⑭ 圓柱:表面點在半徑上、rad = r');
}

console.log('\n=== Ⅱ 抓握索引(makeClimbIndex)===');
{
  const B = bld(0, 0, 40, 40, 40);
  const r = planClimbRoutes({ blockers: [B], heightAt: flat, envCodeAt: dry, bounds: BOX, rnd: () => 0 })[0];
  const at = makeClimbIndex([r]);
  ok(at(r.x, r.z, r.y0) === r, 'Ⅱ 軸上、地面高 MUST 抓得到');
  ok(at(r.x, r.z, (r.y0 + r.y1) / 2) === r, 'Ⅱ 軸上、半空中 MUST 抓得到(從屋頂落下時接得住)');
  ok(at(r.x + CLIMB.GRAB_R + 0.5, r.z, r.y0) === null, 'Ⅱ 水平超出 GRAB_R MUST 抓不到');
  ok(at(r.x, r.z, r.y0 - 2) === null, 'Ⅱ 低於地面端 1m 以下 MUST 抓不到');
  ok(at(r.x, r.z, r.y1 + CLIMB.GRAB_UP - 0.1) === r, 'Ⅱ 頂端上緣容差內 MUST 抓得到(走出屋頂邊緣接得住)');
  ok(at(r.x, r.z, r.y1 + CLIMB.GRAB_UP + 1) === null, 'Ⅱ 高過頂端容差 MUST 抓不到(高空飛過不會被黏住)');
  ok(makeClimbIndex([])(0, 0, 0) === null, 'Ⅱ 空路線表:查詢一律 null(不炸)');
  // 登頂落腳點與攀爬軸的距離:登頂後 MUST NOT 立刻被同一條路線重新黏上
  ok(Math.hypot(r.tx - r.x, r.tz - r.z) > CLIMB.TOP_STEP, 'Ⅱ 登頂落腳點離軸 > TOP_STEP(踏進結構內側)');
}

console.log('\n=== Ⅲ 有向盒遮蔽:客戶端彈道 ⇄ 伺服器 LOS 兩端同判 ===');

/** 抽 game.js 的 _blockerHitT / _buildBlockGrid 原文(類別方法,2 空格縮排 → 首個 `\n  }` 收尾)*/
function pickMethod(name) {
  const P0 = gameSrc.indexOf(`\n  ${name}(`);
  if (P0 < 0) throw new Error(`game.js 找不到 ${name}`);
  const P1 = gameSrc.indexOf('\n  }\n', P0);
  if (P1 < 0) throw new Error(`game.js ${name} 收尾解析失敗`);
  const src = gameSrc.slice(P0 + 3 + name.length, P1 + 4);   // 去掉 "\n  name",留 "(args) {…}"
  return new Function(`return function ${name}${src}`)();
}
const _buildBlockGrid = pickMethod('_buildBlockGrid');
const _blockerHitT = pickMethod('_blockerHitT');
// 兩端的高度語意不同(客戶端 = 絕對 y;伺服器無地形高程,占位視為 [0,h] 的離地圓柱)——
// 測試一律給「離地高」,客戶端加上地表高 GND 再問。這是既有設計(見 sim._losBlocked 檔頭),
// 不是本次改動要解的問題;此處只驗**橫斷面幾何**兩端同判。
const GND = 20;
const clientBlocked = (blockers, a, b) => {
  const self = { _blockGrid: _buildBlockGrid.call({}, blockers) };
  return _blockerHitT.call(self, a[0], GND + a[1], a[2], b[0], GND + b[1], b[2]) != null;
};

/** 伺服器端:以真 BattleSim 收 occ 後問 _losBlocked(sim 座標 z = −three z、ry 反號) */
function fakeBattleConfig() {
  const A = [25.0330, 121.5654];
  const D = 1600, R = 6371000;
  const dLat = D * MAPGEO.REAL_SCALE / R * 180 / Math.PI;
  const B = [A[0] + dLat, A[1]];
  const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const pts = [];
  for (let t = 0; t <= 1.001; t += 0.05) {
    const u = 1 - t;
    pts.push([u * u * A[0] + 2 * u * t * mid[0] + t * t * B[0], u * u * A[1] + 2 * u * t * mid[1] + t * t * B[1]]);
  }
  return {
    center: { lat: mid[0], lng: mid[1] }, bases: { SWARM: A, STEEL: B }, lanes: [pts],
    distM: D, sizeM: D / (0.85 * Math.SQRT2), maxOverlap: 0, teamSize: 1,
    geoScaleVer: MAPGEO.GEO_SCALE_VER, synthetic: true, placeName: '攀爬稽核',
    env: { season: 'summer', time: 'day', weather: 'clear' },
  };
}
/** 客戶端 blocker → main.js 上傳格式的 occ 條目(**逐字照 main.js 的那一行寫法**) */
const toOcc = (b) => (b.hw2 != null
  ? [b.x, -b.z, Math.min(60, Math.hypot(b.hw2, b.hd2)), Math.min(300, b.h), b.hw2, b.hd2, -b.ry]
  : [b.x, -b.z, Math.min(60, b.r), Math.min(300, b.h)]);
const simCache = new Map();
function serverBlocked(blockers, a, b) {
  const key = JSON.stringify(blockers.map(toOcc));
  let sim = simCache.get(key);
  if (!sim) {
    sim = new BattleSim(fakeBattleConfig(), () => {});
    // 危險區障礙(_seedHazards)走 Math.random 佈點,也會進 _rebuildLosGrid ⇒ 隨機擋掉測試射線。
    // 本段只驗「上傳占位的橫斷面幾何」,故先清空 ents 再收料(稽核 MUST 確定性,A4)。
    sim.ents.clear();
    sim.setWorld({ occ: blockers.map(toOcc) });
    simCache.set(key, sim);
  }
  return sim._losBlocked(a[0], -a[2], a[1], b[0], -b[2], b[1]);
}
const bothAgree = (blockers, a, b, want, msg) => {
  const c = clientBlocked(blockers, a, b), s = serverBlocked(blockers, a, b);
  ok(c === want && s === want, `Ⅲ ${msg}(客戶端 ${c ? '擋' : '通'} / 伺服器 ${s ? '擋' : '通'},期望 ${want ? '擋' : '通'})`);
};
{
  // 正方形樓 40×40:牆角在對角線上離中心 28.3m,舊制圓柱 r = 0.8×28.3 = 22.6m ⇒ 角落漏擋
  const sq = [bld(0, 0, 40, 40, 60)];
  bothAgree(sq, [-60, 10, -60], [60, 10, 60], true, '對角線穿過牆角 MUST 擋(舊制圓柱在角落外 = 打穿看得見的牆)');
  bothAgree(sq, [-60, 10, 0], [60, 10, 0], true, '正面穿牆 MUST 擋');
  bothAgree(sq, [-60, 10, 60], [60, 10, 60], false, '完全繞過樓 MUST 通');
  bothAgree(sq, [-60, 70, -60], [60, 70, 60], false, '離地 70m 高過樓頂(h=60)MUST 通');

  // 細長樓 80×10:側向 12m 外是空氣,舊制圓柱 r = 0.8×40.3 = 32.2m ⇒ 誤擋
  const thin = [bld(0, 0, 80, 10, 60)];
  bothAgree(thin, [-60, 10, 12], [60, 10, 12], false, '細長樓側面 12m 外(圓內、盒外)MUST 通 —— 舊制在此誤擋');
  bothAgree(thin, [-60, 10, 0], [60, 10, 0], true, '細長樓長軸穿越 MUST 擋');
  bothAgree(thin, [0, 10, -40], [0, 10, 40], true, '細長樓短軸穿越 MUST 擋');

  // 旋轉盒:sim 座標 z 鏡射 ⇒ ry 反號(main.js 上傳的那一步)—— 兩端仍同判
  const rot = [bld(0, 0, 80, 10, 60, 0.6)];
  // local→world(繞 +ry):x_w = lx·cos − lz·sin、z_w = lx·sin + lz·cos ⇒ 長軸(local +x)= (cos, sin)
  const tX = Math.cos(0.6), tZ = Math.sin(0.6);             // 盒長軸方向
  const pX = -Math.sin(0.6), pZ = Math.cos(0.6);            // 垂直長軸(local +z)
  bothAgree(rot, [-tX * 60, 10, -tZ * 60], [tX * 60, 10, tZ * 60], true, '旋轉盒沿長軸穿越 MUST 擋(ry 反號後仍對齊)');
  bothAgree(rot, [-tX * 60 + pX * 14, 10, -tZ * 60 + pZ * 14], [tX * 60 + pX * 14, 10, tZ * 60 + pZ * 14], false,
    '旋轉盒側向 14m 外(短半寬 5m)MUST 通 —— ry 沒反號的話伺服器會在這裡誤擋');

  // 圓柱(神木/巨岩/橋墩)= 舊格式 4 欄,行為不得改變
  const trunk = [tree(0, 0, 12, 60)];
  bothAgree(trunk, [-60, 10, 0], [60, 10, 0], true, '神木樹幹(圓柱)正面 MUST 擋');
  bothAgree(trunk, [-60, 10, 20], [60, 10, 20], false, '神木樹幹側向 20m 外 MUST 通');

  // 反向對照:把 _blockerHitT 的盒分支拿掉(退回純圓柱)⇒ 兩端 MUST 分家
  const roundOnly = (() => {
    const patched = gameSrc.replace('          if (b.hw2 != null) {', '          if (false) {');
    const P0 = patched.indexOf('\n  _blockerHitT(');
    const P1 = patched.indexOf('\n  }\n', P0);
    const fn = new Function(`return function _blockerHitT${patched.slice(P0 + 3 + '_blockerHitT'.length, P1 + 4)}`)();
    return (blockers, a, b) => fn.call({ _blockGrid: _buildBlockGrid.call({}, blockers) },
      a[0], GND + a[1], a[2], b[0], GND + b[1], b[2]) != null;
  })();
  const split = roundOnly(thin, [-60, 10, 12], [60, 10, 12]) !== serverBlocked(thin, [-60, 10, 12], [60, 10, 12]);
  ok(split, 'Ⅲ 反向對照:_blockerHitT 退回純圓柱 MUST 與伺服器分家(證明兩端同判真的驗到了)');
}

console.log('\n=== Ⅳ 靜態規則(單一縫 / A21 / A25 / 純客戶端)===');
{
  // 單一縫:規劃/查詢/幾何只住 climb.js
  ok(!/planClimbRoutes\s*\(/.test(gameSrc), 'Ⅳ game.js MUST NOT 自己規劃路線(只讀 terrain.climbAt)');
  ok(/from '\.\/climb\.js'/.test(biomeSrc) && /planClimbRoutes\(/.test(biomeSrc),
    'Ⅳ biomes.js 經 climb.js 規劃(不另抄一份幾何)');
  ok(/makeClimbIndex/.test(mainSrc) && /terrain\.climbAt\s*=/.test(mainSrc), 'Ⅳ main.js 掛上 terrain.climbAt');
  ok(/rebuildClimbs/.test(mainSrc) && /rebuildClimbs\?\.\(\)/.test(gameSrc),
    'Ⅳ 碉堡淨空拆樓後 MUST 重建攀爬索引(不留通往空中的梯子)');
  ok(/if \(removed && climbs\.length\)/.test(biomeSrc), 'Ⅳ clearAround MUST 就地清掉被拆建物的路線');

  // 純客戶端:伺服器不得碰
  ok(!/climb\.js/.test(simSrc) && !/climbAt/.test(simSrc), 'Ⅳ server/sim.js MUST NOT 認識攀爬(位置本就客戶端權威)');

  // A21:操作說明的裝置分支只住 help.js,且攀爬條目有 pTouch
  const climbItem = /\{ h: '攀爬路線', p: '([^']*)', pTouch: '([^']*)' \}/.exec(helpSrc);
  ok(!!climbItem, 'Ⅳ help.js 有「攀爬路線」條目且帶 pTouch(A21)');
  ok(climbItem && /Space/.test(climbItem[1]) && /\bB\b/.test(climbItem[2]),
    'Ⅳ 鍵鼠版說 Space、觸控版說 B(兩份各自完整,不混用)');
  const mainStrings = mainSrc.replace(/^\s*\/\/.*$/gm, '').match(/(['`])(?:\\.|(?!\1)[^\\])*\1/g) || [];
  ok(!mainStrings.some((t) => /攀爬|長梯|抓點|技術繩/.test(t)),
    'Ⅳ main.js MUST NOT 另寫一份攀爬操作字串(A21:裝置分支只住 help.js)');

  // A22/A21:攀爬不另開按鍵 —— 上下走 _moveAxis 的推杆量,不直接讀 this.keys.KeyW
  const sm = /_stepClimb\(dt, now, move, ax, u\) \{[\s\S]*?\n  \}\n/.exec(gameSrc);
  ok(!!sm, 'Ⅳ game.js 有 _stepClimb(輸入 → 狀態機)');
  ok(sm && !/this\.keys\.Key[WSAD]/.test(sm[0]), 'Ⅳ _stepClimb MUST NOT 直接讀 this.keys.KeyW/S(走 _moveAxis 唯一縫)');
  ok(sm && /ax\.f \* CLIMB\.SPD/.test(sm[0]), 'Ⅳ 上下 = 前後推杆 × CLIMB.SPD(觸控搖桿天然共用,不新增鈕)');
  ok(sm && /_ccMoveF\(\)/.test(sm[0]), 'Ⅳ 攀爬速度 MUST 吃控場係數(麻痺/緩速與地面同一套規則)');

  // A25:幾何一律「單位幾何 + scale」+ markShared,MUST NOT 逐條 new Geometry
  const meshSeg = climbSrc.slice(climbSrc.indexOf('// 3D 幾何(純表現層)'));
  ok(/markShared\(new THREE\.BoxGeometry/.test(meshSeg)
    && /markShared\(new THREE\.CylinderGeometry/.test(meshSeg)
    && /markShared\(new THREE\.IcosahedronGeometry/.test(meshSeg), 'Ⅳ 三份單位幾何皆 markShared(A25)');
  const inLoop = meshSeg.slice(meshSeg.indexOf('for (const r of list)'), meshSeg.indexOf('const add ='));
  ok(!/new THREE\.\w*Geometry/.test(inLoop), 'Ⅳ 逐路線迴圈內 MUST NOT 配置新幾何(A25 單位幾何 + scale)');
  ok(/new THREE\.InstancedMesh/.test(meshSeg), 'Ⅳ 設施走 InstancedMesh(逐條 Mesh 會炸 draw call)');
  ok(/ry = Math\.atan2\(r\.nx, r\.nz\)/.test(meshSeg), 'Ⅳ 設施朝向 MUST 由路線法線推(A26:擺位與旋轉同調)');

  // 上傳格式:main.js 的 occ 與 sim.js 的 setWorld 對得上(4 欄圓柱 / 7 欄有向盒)
  ok(/rd\(b\.hw2\), rd\(b\.hd2\), Math\.round\(-b\.ry \* 1e3\) \/ 1e3/.test(mainSrc),
    'Ⅳ main.js occ 上傳:盒多帶 hw2/hd2/−ry(sim 座標 z 鏡射 ⇒ ry 反號)');
  ok(/if \(o\.length >= 7\)/.test(simSrc) && /Math\.cos\(ry\), Math\.sin\(ry\)/.test(simSrc),
    'Ⅳ sim.js setWorld 收 7 欄並預算 cos/sin(8Hz 熱路徑不重算三角函數)');
  ok(/if \(o\.length >= 8\)/.test(simSrc), 'Ⅳ sim.js _losBlocked 以「占位長度 ≥ 8」判有向盒(舊格式圓柱行為不變)');
  ok(/const r = b\.hw2 != null \? Math\.hypot\(b\.hw2, b\.hd2\) : b\.r;/.test(gameSrc),
    'Ⅳ _buildBlockGrid 登記半徑用**外接**對角(內切會漏登記貼牆角的格)');
}

console.log(`\n${fail ? '❌' : '✅'} 攀爬路線稽核:${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
