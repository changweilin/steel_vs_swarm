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
//   Ⅴ 上下兩端提示箭頭:尺寸相對兵線 chevron 縮小、朝向(底端朝上 / 頂端朝下)、
//     擺位基底正交且右手(A26)、動畫掛在既有的 dynamics 桶
//   Ⅵ 相鄰結構相接:七成機率 / 設施架在較高者 / 下端落腳在較低者的屋頂 /
//     四條硬約束(相鄰距離・高差・抓握距離・第三者擋道)/ A→B 與 B→A 只留一條
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
import { SOLDIER_H, HERO_SIZE, MAPGEO, SLOPE, slopeDeg, slopeBlocked } from '../public/js/data.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// LF 正規化:git 存 LF,但 autocrlf 下 Windows 工作區是 CRLF。全檔的跨行切片標記(DRAW、pickMethod
// 的 `\n  }\n`、箭頭區塊的 `\n}\n`、_stepClimb 的正則)一律以 `\n` 書寫,不正規化就只在 Linux 綠。
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const climbSrc = read('public', 'js', 'climb.js');
const gameSrc = read('public', 'js', 'game.js');
const mainSrc = read('public', 'js', 'main.js');
const simSrc = read('server', 'sim.js');
const helpSrc = read('public', 'js', 'help.js');
const biomeSrc = read('public', 'js', 'biomes.js');

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
  return new Function('MAX_BODY_R', 'SLOPE', 'slopeDeg',
    `${body}\nreturn { CLIMB, CLIMB_KIND, CLIMB_LABEL, surfacePoint, attachFaces, climbCandidate,`
    + ` siteSlopeDeg, climbShare, facilityEndY, planClimbRoutes, makeClimbIndex };`,
  )(MAX_BODY_R, SLOPE, slopeDeg);
}
const C = loadCore();
const { CLIMB, CLIMB_KIND, surfacePoint, attachFaces, climbCandidate, planClimbRoutes, makeClimbIndex } = C;
const { siteSlopeDeg, climbShare, facilityEndY } = C;

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
  const r = plan(list).filter((q) => !q.link);   // 抽樣率只算地面路線(相鄰相接是額外的)
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

  const DRAW = '    const pick = rnd();\n    const phase = rnd() * Math.PI * 2;\n    const linkRoll = rnd();\n';
  const lateRnd = loadCore((s) => {
    if (!s.includes(DRAW)) throw new Error('③ 對照組:抽樣區塊原文找不到(改過就要同步改稽核)');
    const GATE = '    const deg = siteSlopeDeg(b, heightAt);\n    if (pick >= climbShare(deg)) continue;';
    if (!s.includes(GATE)) throw new Error('③ 對照組:抽中門檻原文找不到(改過就要同步改稽核)');
    return s.replace(`${DRAW}    if (!climbCandidate(b)) continue;`,
      `    if (!climbCandidate(b)) continue;\n${DRAW}`);
  });
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
  ok(rs.every((r) => near(r.vy0, r.y0) && near(r.vy1, r.y1)),
    '⑥ 沒帶實測頂面(b.ty)時,設施端點 MUST 貼齊攀爬柱兩端(行為與舊制逐位元相同)');
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
      const cs = Math.cos(r.b.ry), sn = -Math.sin(r.b.ry);   // 與 surfacePoint 同慣例
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
      const cs = Math.cos(b.ry), sn = -Math.sin(b.ry);   // 與 surfacePoint 同慣例(見該函式檔頭)
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
  const rs = plan(list, { seed: 31337 }).filter((q) => !q.link);
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
    const cs = Math.cos(b.ry), sn = -Math.sin(b.ry);
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

  // 上下方向(2026-07-30「塗層雙面阻擋」):盒的頂面/底面 MUST 不分方向都擋。
  // 舊制客戶端只驗「入點高度」+ 頂面加掛 `dy < 0` ⇒ 由下往上斜穿樓體(入點在盒底之下)
  // 整條漏放,而伺服器一向是「穿越區間 ∩ [0,h]」語意 ⇒ 客戶端算命中、伺服器算被擋 = 靜默丟包。
  bothAgree(sq, [-30, -20, 0], [30, 70, 0], true,
    '由下往上斜穿樓體 MUST 擋(入點在盒底之下 —— 舊制客戶端漏放、伺服器照擋 = 傷害靜默蒸發)');
  bothAgree(sq, [30, 70, 0], [-30, -20, 0], true, '同一條線反向(由上往下)MUST 同判');
  bothAgree(sq, [-30, 70, 0], [30, 70, 0], false, '全程高過樓頂 MUST 通(不因雙面判定而誤擋)');

  // 細長樓 80×10:側向 12m 外是空氣,舊制圓柱 r = 0.8×40.3 = 32.2m ⇒ 誤擋
  const thin = [bld(0, 0, 80, 10, 60)];
  bothAgree(thin, [-60, 10, 12], [60, 10, 12], false, '細長樓側面 12m 外(圓內、盒外)MUST 通 —— 舊制在此誤擋');
  bothAgree(thin, [-60, 10, 0], [60, 10, 0], true, '細長樓長軸穿越 MUST 擋');
  bothAgree(thin, [0, 10, -40], [0, 10, 40], true, '細長樓短軸穿越 MUST 擋');

  // 旋轉盒:sim 座標 z 鏡射 ⇒ ry 反號(main.js 上傳的那一步)—— 兩端仍同判
  const rot = [bld(0, 0, 80, 10, 60, 0.6)];
  // local→world = 建物實例矩陣 three Euler(0,ry,0):x_w = lx·cos + lz·sin、z_w = −lx·sin + lz·cos
  // ⇒ 長軸(local +x)= (cos, −sin)。**這一組向量就是「看得見的樓的長軸」**:寫成 (cos, +sin)
  // 的舊版等於在驗一個鏡射的盒子(差 2·ry)—— 見 climb.js surfacePoint 檔頭
  const tX = Math.cos(0.6), tZ = -Math.sin(0.6);            // 盒長軸方向
  const pX = Math.sin(0.6), pZ = Math.cos(0.6);             // 垂直長軸(local +z)
  bothAgree(rot, [-tX * 60, 10, -tZ * 60], [tX * 60, 10, tZ * 60], true, '旋轉盒沿長軸穿越 MUST 擋(ry 反號後仍對齊)');
  bothAgree(rot, [-tX * 60 + pX * 14, 10, -tZ * 60 + pZ * 14], [tX * 60 + pX * 14, 10, tZ * 60 + pZ * 14], false,
    '旋轉盒側向 14m 外(短半寬 5m)MUST 通 —— ry 沒反號 / 盒面鏡射的話會在這裡誤擋');

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
  ok(/if \(o\.length >= 7\)/.test(simSrc) && /Math\.cos\(ry\), -Math\.sin\(ry\)/.test(simSrc),
    'Ⅳ sim.js setWorld 收 7 欄並預算 cos/**−**sin(8Hz 熱路徑不重算三角函數;−sin = 盒面朝向慣例)');
  ok(/if \(o\.length >= 8\)/.test(simSrc), 'Ⅳ sim.js _losBlocked 以「占位長度 ≥ 8」判有向盒(舊格式圓柱行為不變)');
  ok(/const r = b\.hw2 != null \? Math\.hypot\(b\.hw2, b\.hd2\) : b\.r;/.test(gameSrc),
    'Ⅳ _buildBlockGrid 登記半徑用**外接**對角(內切會漏登記貼牆角的格)');
}

console.log('\n=== Ⅴ 上下兩端提示箭頭(執行 climb.js 的發射器原文)===');

// buildClimbArrows 只用到 THREE 的一小撮 API,故以最小替身執行**真正的原文**
// (另抄一份矩陣公式就永遠會通過;makeBasis/setPosition 的定義是 three 的公開契約)。
function loadArrows() {
  const P0 = climbSrc.indexOf('export const CLIMB_ARROW = {');
  const P1 = climbSrc.indexOf('function buildClimbArrows(g, list) {');
  const P2 = climbSrc.indexOf('\n}\n', P1) + 2;
  if (P0 < 0 || P1 < 0 || P2 <= P1) throw new Error('climb.js 找不到提示箭頭區塊');
  const body = (climbSrc.slice(P0, climbSrc.indexOf('\n\n', P0)) + '\n' + climbSrc.slice(P1, P2))
    .replace(/^export /gm, '');
  class V3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    crossVectors(a, b) {
      return this.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
    }
    multiplyScalar(k) { return this.set(this.x * k, this.y * k, this.z * k); }
  }
  class M4 {
    constructor() { this.e = new Array(16).fill(0); this.e[15] = 1; }
    makeBasis(x, y, z) {
      this.e = [x.x, x.y, x.z, 0, y.x, y.y, y.z, 0, z.x, z.y, z.z, 0, 0, 0, 0, 1];
      return this;
    }
    setPosition(v) { this.e[12] = v.x; this.e[13] = v.y; this.e[14] = v.z; return this; }
  }
  const THREE = {
    Vector3: V3, Matrix4: M4,
    BoxGeometry: class { translate() { return this; } },
    MeshBasicMaterial: class { constructor(o) { Object.assign(this, o); } },
    InstancedMesh: class {
      constructor(geo, mat, n) { this.geo = geo; this.mat = mat; this.count = n; this.userData = {}; this.mtx = []; this.instanceMatrix = {}; }
      setMatrixAt(i, m) { this.mtx[i] = m.e.slice(); }
    },
  };
  return new Function('THREE', 'markShared', 'UNIT',
    `${body}\nreturn { CLIMB_ARROW, buildClimbArrows };`)(THREE, (x) => x, {});
}
const AR = loadArrows();
const A = AR.CLIMB_ARROW;
{
  // 兵線 chevron 的桿長/張角(game.js _initLanes)—— 「縮到適當大小」是相對它定義的
  const LANE_BAR = +/const BAR_L = ([\d.]+), SPREAD = ([\d.]+);/.exec(gameSrc)[1];
  const LANE_SP = +/const BAR_L = [\d.]+, SPREAD = ([\d.]+);/.exec(gameSrc)[1];
  ok(A.BAR < LANE_BAR * 0.45 && A.BAR > LANE_BAR * 0.2,
    `Ⅴ 桿長 MUST 明顯短於兵線 chevron(攀爬 ${A.BAR}m vs 兵線 ${LANE_BAR}m,期望 0.2~0.45 倍)`);
  ok(near(A.SPREAD, LANE_SP, 1e-9), `Ⅴ 半張角 MUST 與兵線同(${A.SPREAD})—— 縮的是尺寸不是語彙`);
  ok(A.T <= 0.15, `Ⅴ 桿厚 ${A.T}m = 貼片(不是空中的立體箭頭)`);

  // 建一組:一棟朝 +X 的樓 + 一棵神木,兩端各 N 支 chevron × 2 根桿
  const B = bld(0, 0, 40, 40, 40);
  const routes = planClimbRoutes({ blockers: [B, tree(400, 0, 8, 50)], heightAt: flat, envCodeAt: dry, bounds: BOX, rnd: () => 0 });
  ok(routes.length === 2, 'Ⅴ 測試場地產出 2 條路線');
  const g = { userData: {}, add(m) { (this.kids ??= []).push(m); } };
  AR.buildClimbArrows(g, routes);
  const [up, dn] = g.kids;
  ok(g.kids.length === 2, 'Ⅴ 上行 / 下行各一個 InstancedMesh(2 個 draw call)');
  ok(up.count === routes.length * A.N * 2 && dn.count === up.count,
    `Ⅴ 每端 N=${A.N} 支 chevron × 2 根桿 × ${routes.length} 條路線(實得 ${up.count} / ${dn.count})`);
  ok(up.mat.color === A.UP && dn.mat.color === A.DOWN, 'Ⅴ 上行青綠 / 下行琥珀(兩端一眼分得出方向)');
  ok(typeof g.userData.update === 'function', 'Ⅴ 動畫掛在 group.userData.update(併進 biomes 既有的 dynamics 桶)');

  // 解出每根桿的基底與位置:three Matrix4 為 column-major
  const cols = (e) => ({
    X: { x: e[0], y: e[1], z: e[2] }, Y: { x: e[4], y: e[5], z: e[6] },
    Z: { x: e[8], y: e[9], z: e[10] }, P: { x: e[12], y: e[13], z: e[14] },
  });
  const len = (v) => Math.hypot(v.x, v.y, v.z);
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

  let orthoBad = 0, handBad = 0, faceBad = 0, lenBad = 0;
  for (const mesh of [up, dn]) {
    for (const e of mesh.mtx) {
      const { X, Y, Z } = cols(e);
      if (Math.abs(dot(X, Y)) > 1e-9 || Math.abs(dot(Y, Z)) > 1e-9 || Math.abs(dot(X, Z)) > 1e-9) orthoBad++;
      const c = cross(X, Y);                       // 右手系:X × Y MUST 同向於 Z(不得鏡射)
      if (dot(c, Z) <= 0) handBad++;
      if (Math.abs(len(Y) - A.T) > 1e-9) faceBad++;          // 厚度軸 = 向外法線,恆為 T
      if (len(Z) > A.BAR + 1e-9 || len(Z) < A.BAR * 0.3) lenBad++;   // 桿長 ≤ BAR(脹縮只會縮)
    }
  }
  ok(orthoBad === 0, `Ⅴ 擺位基底 MUST 正交(違規 ${orthoBad} 根)`);
  ok(handBad === 0, `Ⅴ 擺位基底 MUST 是右手系(鏡射會讓貼片翻面;違規 ${handBad} 根)`);
  ok(faceBad === 0, `Ⅴ 厚度軸 MUST = 向外法線且不隨脹縮改變(違規 ${faceBad} 根)`);
  ok(lenBad === 0, `Ⅴ 桿長 MUST 夾在 BAR 以內(違規 ${lenBad} 根)`);

  // 朝向:桿自頂點往「後方」延伸 d = −Z ⇒ 上行的 d.y MUST < 0(頂點朝上)、下行 MUST > 0
  const upBad = up.mtx.filter((e) => -cols(e).Z.y >= 0).length;
  const dnBad = dn.mtx.filter((e) => -cols(e).Z.y <= 0).length;
  ok(upBad === 0, `Ⅴ 底端 chevron 頂點 MUST 朝上(這裡可以上去;違規 ${upBad} 根)`);
  ok(dnBad === 0, `Ⅴ 頂端 chevron 頂點 MUST 朝下(這裡可以下來;違規 ${dnBad} 根)`);
  // 同一支的兩根桿 MUST 對稱(左右各張開 SPREAD)⇒ 兩兩配對的 Z 垂直分量相同、水平分量相反
  const zs = up.mtx.map((e) => cols(e).Z);
  ok(near(zs[0].y, zs[1].y, 1e-9) && near(zs[0].x, -zs[1].x, 1e-9) && near(zs[0].z, -zs[1].z, 1e-9),
    'Ⅴ 同一支 chevron 的兩根桿 MUST 對稱張開(差正負號 = 變成折線而不是 ㄑ,見 A26)');

  // 位置:底端自 y0+FOOT 起往上、頂端自 y1+HEAD 起往下;水平一律落在攀爬軸外 OUT
  const rmap = new Map(routes.map((r) => [`${r.x.toFixed(3)}`, r]));
  const posOk = (mesh, dir) => mesh.mtx.every((e) => {
    const { P } = cols(e);
    const r = routes.reduce((best, q) => {
      const d = Math.hypot(q.x + q.nx * A.OUT - P.x, q.z + q.nz * A.OUT - P.z);
      return !best || d < best.d ? { r: q, d } : best;
    }, null);
    if (!r || r.d > 1e-6) return false;                       // 水平 MUST 恰在「軸 + OUT·法線」
    const y0 = dir > 0 ? r.r.y0 + A.FOOT : r.r.y1 + A.HEAD;
    return dir > 0 ? (P.y >= y0 - 1e-9 && P.y <= y0 + A.RUN + 1e-9)
                   : (P.y <= y0 + 1e-9 && P.y >= y0 - A.RUN - 1e-9);
  });
  ok(rmap.size >= 1 && posOk(up, 1), `Ⅴ 底端箭頭 MUST 自 y0+${A.FOOT}m 起、在 ${A.RUN}m 循環內往上流`);
  ok(posOk(dn, -1), `Ⅴ 頂端箭頭 MUST 自 y1+${A.HEAD}m 起、在 ${A.RUN}m 循環內往下流`);
  ok(A.OUT > 0, 'Ⅴ 箭頭 MUST 落在攀爬軸再往外(不與長梯/抓點/繩本體疊在一起)');

  // 動畫:推進後位置 MUST 改變且仍在同一個循環窗口內(不會飄走)
  const before = up.mtx.map((e) => cols(e).P.y);
  g.userData.update(0.5);
  const after = up.mtx.map((e) => cols(e).P.y);
  ok(before.some((v, i) => Math.abs(v - after[i]) > 1e-6), 'Ⅴ update(dt) MUST 真的推動箭頭(流動感)');
  ok(posOk(up, 1) && posOk(dn, -1), 'Ⅴ 推進後仍夾在各自的循環窗口內(不會沿著牆飄走)');

  // 靜態:biomes 併進既有 dynamics 桶,game.js MUST NOT 另開第二條更新迴圈
  ok(/dynamics\.push\(climbMesh\.userData\.update\)/.test(biomeSrc),
    'Ⅴ biomes.js MUST 把箭頭動畫併進既有的 dynamics 桶(火車/瀑布同一條路徑)');
  ok(!/climbArrow|CLIMB_ARROW/.test(gameSrc), 'Ⅴ game.js MUST NOT 另寫一份箭頭更新迴圈');
}

console.log('\n=== Ⅵ 相鄰結構相接(執行 climb.js 原文)===');
{
  // 場地:一棟 40m 高的樓,東側緊貼(表面距 2m)一棟 20m 高的樓 —— 高差 20m > LINK_DROP
  const mkPair = (gap, hiH, loH) => {
    const HI = bld(0, 0, 40, 40, hiH);                     // 面 x = ±20
    const LO = bld(20 + gap + 15, 0, 30, 30, loH);         // 面 x = 20+gap
    return [HI, LO];
  };
  const one = (bs, seed = 0) => planClimbRoutes({
    blockers: bs, heightAt: flat, envCodeAt: dry, bounds: BOX, rnd: seed === 0 ? () => 0 : mulberry32(seed),
  });

  {
    const [HI, LO] = mkPair(2, 40, 20);
    const rs = one([HI, LO]);
    const links = rs.filter((r) => r.link);
    ok(links.length === 1, `Ⅵ 相鄰(表面距 2m)+ 高差 20m ⇒ MUST 架出 1 條相接路線(實得 ${links.length})`);
    const L = links[0];
    ok(L && L.b === HI && L.link === LO, 'Ⅵ 設施 MUST 架在**較高者**的牆面上、接到較低者');
    ok(L && near(L.y1, HI.y + HI.h) && near(L.y0, LO.y + LO.h),
      'Ⅵ 上端 = 高者頂面、下端 = **低者頂面**(兩端都是 blockerTopAt 的回傳值)');
    ok(L && near(Math.abs(L.x - HI.x) - HI.hw2, CLIMB.OFF, 1e-6),
      'Ⅵ 攀爬軸仍離高者表面恰為 OFF(與一般路線同一把尺)');
    ok(L && L.nx > 0.9, 'Ⅵ 架設面 MUST 是「面向鄰居」的那一面');
    // 下端落腳點:MUST 在低者的水平輪廓內(不然放手就從兩棟之間的縫掉到地面)
    ok(L && Math.abs(L.bx - LO.x) <= LO.hw2 + 1e-6 && Math.abs(L.bz - LO.z) <= LO.hd2 + 1e-6,
      'Ⅵ 下端落腳點 MUST 落在低者的屋頂輪廓內');
    ok(L && Math.hypot(L.bx - L.x, L.bz - L.z) < CLIMB.GRAB_R,
      `Ⅵ 落腳點與攀爬軸的水平距離 MUST < GRAB_R(${CLIMB.GRAB_R}m)—— 站在低頂上要抓得到`);
    ok(L && L.kind === CLIMB_KIND[HI.cl], 'Ⅵ 設施型別跟著**架設面所屬的結構**走');
    // 抓握索引:站在低者屋頂上 MUST 抓得到這條
    const at = makeClimbIndex(rs);
    ok(at(L.bx, L.bz, L.y0) === L, 'Ⅵ 站在低者屋頂的落腳點上 MUST 抓得到相接路線');
  }

  // ① 太遠不算相鄰
  {
    const [HI, LO] = mkPair(CLIMB.LINK_GAP + 1.5, 40, 20);
    ok(one([HI, LO]).filter((r) => r.link).length === 0,
      `Ⅵ 表面距 > LINK_GAP(${CLIMB.LINK_GAP}m)MUST 不相接(從低頂搆不到高牆上的梯子)`);
    // 抓握距離是**獨立**的一道閘:把 LINK_GAP 開到很大,遠處仍 MUST 不相接
    const wide = loadCore((t) => t.replace('  LINK_GAP: 3.0,', '  LINK_GAP: 30,'));
    const run = (bs) => wide.planClimbRoutes({ blockers: bs, heightAt: flat, envCodeAt: dry, bounds: BOX, rnd: () => 0 })
      .filter((r) => r.link).length;
    ok(run(mkPair(8, 40, 20)) === 0, 'Ⅵ 就算放寬 LINK_GAP,落腳點超出 GRAB_R MUST 仍不相接(抓握閘獨立生效)');
    ok(run(mkPair(2, 40, 20)) === 1, 'Ⅵ 對照:同一支放寬版在真正相鄰時仍架得出來(不是整支被關掉)');
  }
  // ② 高差不足 = 一階台階,不是通道
  {
    const [HI, LO] = mkPair(2, 40, 40 - CLIMB.LINK_DROP + 1);
    ok(one([HI, LO]).filter((r) => r.link).length === 0,
      `Ⅵ 兩頂高差 < LINK_DROP(${CLIMB.LINK_DROP}m)MUST 不相接`);
  }
  // ③ 鄰居不是「頂面站得住」的結構(橋墩/封路障礙)⇒ 不相接
  {
    const [HI] = mkPair(2, 40, 20);
    const pier = { x: 37, z: 0, y: 19, r: 15, h: 21 };     // 無 bld/std 旗標
    ok(one([HI, pier]).filter((r) => r.link).length === 0,
      'Ⅵ 鄰居沒有 bld/std 旗標(橋墩/封路障礙)MUST 不相接 —— 頂面本來就站不住');
  }
  // ④ 第三座結構擋在通道上
  {
    const [HI, LO] = mkPair(2, 40, 20);
    const wall = { x: 24, z: 0, y: 19, r: 3, h: 40, std: 1, cl: 'rock' };   // 卡在兩棟之間、頂到 40m
    ok(one([HI, LO, wall]).filter((r) => r.link).length === 0,
      'Ⅵ 通道上有第三座結構 MUST 不相接(§4 寧缺勿錯)');
  }
  // ⑤ A→B 與 B→A 只留一條(兩棟都抽中時不得長出兩條同樣的路線)
  {
    const [HI, LO] = mkPair(2, 40, 20);
    const rs = one([HI, LO]);                              // rnd 恆 0 ⇒ 兩棟都抽中、兩次都擲出相接
    ok(rs.filter((r) => !r.link).length === 2, 'Ⅵ 兩棟都掛得上地面路線(對照:相接不是取代)');
    ok(rs.filter((r) => r.link).length === 1, 'Ⅵ A→B 與 B→A MUST 去重成一條');
  }
  // ⑥ 七成機率:**逐結構**擲骰(需求文字就是「一個有路線的結構…有 7 成機率…相接」)。
  //    量測要隔離掉「兩棟都抽中 ⇒ 兩次獨立擲骰、去重後合成 1−0.3² = 91%」這個複合效應,
  //    故把鄰居壓到 MIN_H 以下(不是候選、拿不到自己的地面路線,但仍是合法的相接目標)
  //    ⇒ 每對恰好一次擲骰,link / ground 就是那 7 成本身。
  {
    const bs = [];
    const N = 400;
    for (let i = 0; i < N; i++) {
      const cx = (i % 20) * 190 - 1900, cz = Math.floor(i / 20) * 190 - 1900;
      bs.push(bld(cx, cz, 40, 40, 40));                     // 候選(高)
      bs.push(bld(cx + 37, cz, 30, 30, CLIMB.MIN_H - 1));   // 非候選(矮)但仍是 bld ⇒ 可當相接目標
    }
    const rs = one(bs, 20260728);
    const ground = rs.filter((r) => !r.link).length;
    const link = rs.filter((r) => r.link).length;
    ok(rs.every((r) => !r.link || r.b.h === 40), 'Ⅵ 矮鄰居 MUST 沒有自己的地面路線(隔離成立)');
    const rate = link / ground;
    ok(rate > CLIMB.LINK - 0.10 && rate < CLIMB.LINK + 0.10,
      `Ⅵ 逐結構相接率 ≈ CLIMB.LINK(實測 ${(rate * 100).toFixed(1)}%,期望 ${(CLIMB.LINK * 100)}±10pp;${link}/${ground})`);
    // 反向對照:機率寫死成 1 ⇒ 每條地面路線都該長出一條相接
    const always = loadCore((t) => t.replace('  LINK: 0.7,', '  LINK: 1,'));
    const all = always.planClimbRoutes({ blockers: bs, heightAt: flat, envCodeAt: dry, bounds: BOX, rnd: mulberry32(20260728) });
    const nAll = all.filter((r) => r.link).length, gAll = all.filter((r) => !r.link).length;
    ok(nAll === gAll && nAll > link, `Ⅵ 反向對照:LINK 寫死 1 ⇒ 每條地面路線都相接(${link}/${ground} → ${nAll}/${gAll})`);
  }

  // ⑦ 下端落腳點是路線自帶的 bx/bz,game.js 落地時 MUST 用它(不然從縫裡掉到地面)
  ok(/this\.pos\.set\(r\.bx, r\.y0, r\.bz\)/.test(gameSrc),
    'Ⅵ game.js 下端落地 MUST 用 r.bx/r.bz(相接路線的落腳點在低者屋頂,不是攀爬軸)');
  ok(/c\.link && !live\.has\(c\.link\)/.test(biomeSrc),
    'Ⅵ 碉堡淨空拆掉低者時 MUST 一併撤掉相接路線(下端落腳點會懸空)');
  // 一般地面路線的 bx/bz = 攀爬軸本身(行為與舊版相同)
  {
    const rs = one([bld(0, 0, 40, 40, 40)]);
    ok(rs.length === 1 && near(rs[0].bx, rs[0].x) && near(rs[0].bz, rs[0].z),
      'Ⅵ 一般地面路線的 bx/bz MUST = 攀爬軸(舊行為不得回歸)');
  }
}

console.log('\n=== Ⅶ 設施「正面」規則:面對結構、不要有其他角度(2026-07-30 使用者需求)===');
{
  // ---- ① 有向盒:候選只有四個面法線,附著點是**面中心** ----
  const B = bld(12, -7, 60, 24, 40, 0.83);
  const faces = attachFaces(B);
  ok(faces.length === 4, 'Ⅶ 有向盒的正面候選 MUST 恰好四個(四面牆),不是 16 個方位');
  const cs = Math.cos(B.ry), sn = -Math.sin(B.ry);   // 與 surfacePoint 同慣例(見該函式檔頭)
  const toLocal = (x, z) => [(x - B.x) * cs + (z - B.z) * sn, -(x - B.x) * sn + (z - B.z) * cs];
  const centred = faces.every((f) => {
    const [lx, lz] = toLocal(f.fx, f.fz);
    // 面中心 = 一軸貼齊半寬、另一軸恰為 0(落在面上任意一點 ⇒ 斜插在牆邊)
    return (near(Math.abs(lx), B.hw2, 1e-9) && near(lz, 0, 1e-9))
        || (near(Math.abs(lz), B.hd2, 1e-9) && near(lx, 0, 1e-9));
  });
  ok(centred, 'Ⅶ 每個正面的附著點 MUST 是該面**中心**(牆角/面上任意點 = 設施斜插在牆邊)');
  const axisAligned = faces.every((f) => {
    const [lnx, lnz] = [f.nx * cs + f.nz * sn, -f.nx * sn + f.nz * cs];
    return near(Math.abs(lnx) + Math.abs(lnz), 1, 1e-9)
      && (near(Math.abs(lnx), 1, 1e-9) || near(Math.abs(lnz), 1, 1e-9));
  });
  ok(axisAligned, 'Ⅶ 正面法線 MUST 是盒的軸向(±local x / ±local z),不得是任意角度');
  // 四個面各不相同、且成兩組相反 ⇒ 真的是四面牆
  const dirs = faces.map((f) => `${f.nx.toFixed(3)},${f.nz.toFixed(3)}`);
  ok(new Set(dirs).size === 4, 'Ⅶ 四個正面互不重複');

  // ---- ② 規劃結果:每條盒結構路線的法線 MUST 是該結構的正面之一 ----
  const list = [];
  for (let i = 0; i < 60; i++) {
    // 各棟不同朝向(0~π)+ 長寬比不同 ⇒ 鏡射慣例錯掉就對不上
    list.push(bld((i % 8) * 90 - 360, Math.floor(i / 8) * 90 - 360, 30 + (i % 3) * 10, 14, 24 + (i % 4) * 6,
                  (i / 60) * Math.PI));
  }
  const rs = plan(list, { seed: 4242 }).filter((r) => !r.link);
  const onFace = rs.every((r) => attachFaces(r.b).some((f) =>
    near(f.nx, r.nx, 1e-9) && near(f.nz, r.nz, 1e-9) && near(f.fx, r.fx, 1e-6) && near(f.fz, r.fz, 1e-6)));
  ok(rs.length > 5 && onFace,
    `Ⅶ ${rs.length} 條路線的附著點/法線 MUST 全部落在該結構的正面上(斜角一條都不准)`);

  // ---- ③ 視覺 vs 碰撞盒朝向同調(本次修的根因)----
  // 建物實例矩陣吃 three 的 Euler(0, ry, 0);biomes.js 把「局部 → 世界」寫在 `toW` 這一支
  // (屋頂配件/煙囪/裙樓都靠它擺位)。碰撞盒的 local 軸反解 MUST 是它的反矩陣,否則
  // **看得見的牆與擋彈/掛梯的牆差 2·ry**(45° 的樓就差 90°)。
  ok(/const toW = \(ox, oz\) => \[b\.x \+ ox \* ca \+ oz \* sa, b\.z - ox \* sa \+ oz \* ca\]/.test(biomeSrc),
    'Ⅶ biomes.js 的視覺擺位式 `toW` MUST 維持 three Euler(0,ry,0) 的展開(本節的對照組據此而立)');
  const meshToW = (b, lx, lz) => {            // ← 與上一行驗過的 toW 同式(ca=cos(ry), sa=sin(ry))
    const ca = Math.cos(b.ry), sa = Math.sin(b.ry);
    return [b.x + lx * ca + lz * sa, b.z - lx * sa + lz * ca];
  };
  const sameWall = attachFaces(B).every((f) => {
    const [lx, lz] = toLocal(f.fx, f.fz);                       // 碰撞盒認定的面中心(local)
    const [wx, wz] = meshToW(B, lx, lz);                        // 同一個 local 點,用**視覺**矩陣擺回世界
    return near(wx, f.fx, 1e-6) && near(wz, f.fz, 1e-6);
  });
  ok(sameWall, 'Ⅶ 碰撞盒的面中心 MUST 與**視覺**實例矩陣擺出的同一點重合(sn 寫成 +sin 就是鏡射盒)');

  // ---- ④ 圓柱(神木):旋轉對稱 ⇒ 維持 16 方位;巨岩帶 attA 則只准實測驗過的方位 ----
  ok(attachFaces(tree(0, 0, 8, 40), 0.3).length === CLIMB.AZ,
    `Ⅶ 圓柱(神木)MUST 維持 ${CLIMB.AZ} 方位掃描(幹身旋轉對稱,任一徑向都是正面)`);
  const rk = { ...rock(0, 0, 20, 40), attA: [{ a: 0.4, gap: 0.7, top: 1.1 }, { a: 2.9, gap: 0.2, top: 0 }] };
  const af = attachFaces(rk, 1.1);
  ok(af.length === 2 && near(af[0].gap, 0.7) && near(af[1].arm, 0),
    'Ⅶ 巨岩:帶 attA 時 MUST 只回那些方位,並把逐方位實測的 gap/top 帶進路線');
  const rkRoute = planClimbRoutes({ blockers: [rk], heightAt: flat, envCodeAt: dry, bounds: BOX, rnd: () => 0 })[0];
  ok(rkRoute && near(rkRoute.gap, rkRoute.arm === 0 ? 0.2 : 0.7),
    'Ⅶ 路線 MUST 沿用被選中那個正面的 gap(設施靠上岩面,不是浮在碰撞圈上)');
  const noAtt = planClimbRoutes({ blockers: [{ ...rock(0, 0, 20, 40), attA: [] }], heightAt: flat, envCodeAt: dry, bounds: BOX, rnd: () => 0 });
  ok(noAtt.length === 0, 'Ⅶ 巨岩一個方位都驗不過(attA 空)⇒ MUST 不掛路線(寧缺勿錯,好過一條浮空的)');

  // ---- ⑤ 頂端錨件的跨接臂:結構頂端比路線半徑細時 MUST 伸回結構上 ----
  const P0 = climbSrc.indexOf('const anch = (inner, outer, w, h) => {');
  const P1 = climbSrc.indexOf('\n    };', P0);
  ok(P0 > 0 && P1 > P0, 'Ⅶ buildClimbMeshes MUST 保留頂端錨件的跨接臂 `anch()`(單一縫)');
  if (P0 > 0) {
    // 執行真正的原文:r/off/arm 由外層閉包提供 ⇒ 以最小替身注入
    const mk = new Function('r', 'off', 'arm', `${climbSrc.slice(P0, P1 + 6)}\n    return anch;`);
    for (const arm of [0, 3.4]) {
      const r = { fx: 100, fz: 0, nx: 1, nz: 0 };
      const off = 0.35, A = mk(r, off, arm)(0.2, 0.8, 0.7, 0.28);
      const inner = A.cx - r.fx - A.L / 2;      // 錨件內端(沿法線、相對結構表面)
      const outer = A.cx - r.fx + A.L / 2;
      ok(near(inner, -(arm + 0.2), 1e-9) && near(outer, off + 0.8, 1e-9),
        `Ⅶ 跨接臂(arm=${arm}):內端 MUST 咬進結構 0.2m、外端 MUST 蓋住設施(實測 ${inner.toFixed(2)}~${outer.toFixed(2)})`);
    }
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== Ⅷ 設施端點貼齊可見實體面(屋頂不平的結構,設施 MUST NOT 高出屋頂)===');
{
  // ---- ① facilityEndY 的曲線(執行 climb.js 原文)----
  ok(near(facilityEndY(50, null), 50), 'Ⅷ 沒量到實體頂面(ty 缺)⇒ 設施端點 = 攀爬柱端點(退回舊制)');
  ok(near(facilityEndY(50, 49.5), 49.5), 'Ⅷ 量到的屋頂低一截 ⇒ 設施收到屋頂上(長梯不再高出屋頂)');
  ok(near(facilityEndY(50, 53), 50), 'Ⅷ 量到的值高過攀爬柱 ⇒ MUST 不理(設施 MUST NOT 長得比攀爬柱高)');
  ok(near(facilityEndY(50, 50), 50), 'Ⅷ 兩者等高 ⇒ 不動');
  ok(near(facilityEndY(50, 20), 50 - CLIMB.GRAB_UP),
    `Ⅷ 落差 MUST 夾在 GRAB_UP(${CLIMB.GRAB_UP}m)內 —— 碰撞柱高過實體太多是結構自己的事,設施不准斷開`);
  ok(!/GRAB_UP: [\d.]+,[\s\S]{0,200}facilityEndY/.test(climbSrc) || /yAuth - CLIMB\.GRAB_UP/.test(climbSrc),
    'Ⅷ 夾制量 MUST 取自 CLIMB.GRAB_UP(推導不手寫第二個容差)');

  // ---- ② 規劃結果:帶 ty 的結構,vy1 收到屋頂而 y1(站立面)MUST 一動不動 ----
  const H = 40, TRIM = 0.5;
  const B = { ...bld(0, 0, 40, 30, H), ty: 19 + H - TRIM };     // b.y = 19 ⇒ 碰撞柱頂 59、可見屋頂 58.5
  const r = planClimbRoutes({ blockers: [B], heightAt: flat, envCodeAt: dry, bounds: BOX, rnd: () => 0 })[0];
  ok(r && near(r.y1, B.y + B.h), 'Ⅷ 攀爬柱頂 y1 MUST 仍 = b.y + b.h(站立面/_collide 垂直閘都吃它,動了人會被推下屋頂)');
  ok(r && near(r.vy1, B.ty), 'Ⅷ 設施頂端 vy1 MUST = 實測屋頂 b.ty');
  ok(r && near(r.y1 - r.vy1, TRIM), `Ⅷ 一般建物的碰撞柱刻意高 ${TRIM}m ⇒ 設施 MUST 正好收掉這一截`);
  ok(r && near(r.vy0, r.y0), 'Ⅷ 地面路線的設施底端 = 地面(只收頂端)');

  // ---- ③ 相鄰相接:兩端各自貼齊該座結構的實體面(下端**往下延伸**到低者的屋頂)----
  const Hi = { ...bld(0, 0, 40, 30, 60), ty: 19 + 60 - 0.5 };
  const Lo = { ...bld(37, 0, 30, 30, 30), ty: 19 + 30 - 0.5 };
  const lk = planClimbRoutes({ blockers: [Hi, Lo], heightAt: flat, envCodeAt: dry, bounds: BOX, rnd: () => 0 })
    .find((q) => q.link);
  ok(!!lk, 'Ⅷ 相鄰兩棟 MUST 架得起相接路線(本節的前提)');
  ok(lk && near(lk.y1, Hi.y + Hi.h) && near(lk.y0, Lo.y + Lo.h), 'Ⅷ 相接路線的攀爬柱兩端 MUST 仍是兩座碰撞柱頂');
  ok(lk && near(lk.vy1, Hi.ty), 'Ⅷ 相接路線上端 MUST 收到高者的實體屋頂');
  ok(lk && near(lk.vy0, Lo.ty) && lk.vy0 < lk.y0,
    'Ⅷ 相接路線下端 MUST **往下**延伸到低者的實體屋頂(不然梯腳浮在低頂上方半公尺)');

  // ---- ④ 設施幾何真的吃 vy(執行 buildClimbMeshes 原文的垂直範圍)----
  const meshSeg = climbSrc.slice(climbSrc.indexOf('export function buildClimbMeshes'));
  ok(/const y0 = r\.vy0 \?\? r\.y0, y1 = r\.vy1 \?\? r\.y1;/.test(meshSeg),
    'Ⅷ buildClimbMeshes 的垂直範圍 MUST 取自 vy0/vy1(設施端點)');
  const facBody = meshSeg.slice(meshSeg.indexOf('for (const r of list)'), meshSeg.indexOf('// 材質每型別各一份'))
    .replace(/const y0 = r\.vy0 \?\? r\.y0, y1 = r\.vy1 \?\? r\.y1;/, '');   // ← 唯一准許的取值處(上一條已釘住)
  ok(!/\br\.y0\b|\br\.y1\b/.test(facBody),
    'Ⅷ 設施幾何段 MUST NOT 再直接引用 r.y0/r.y1(攀爬柱與設施的分工不得混用)');
  // 提示箭頭刻意仍吃 y0/y1(標的是「人站在哪裡」,不是實體面)
  const arrSeg = climbSrc.slice(climbSrc.indexOf('function buildClimbArrows'));
  ok(/r\.y0 \+ A\.FOOT/.test(arrSeg) && /r\.y1 \+ A\.HEAD/.test(arrSeg),
    'Ⅷ 提示箭頭刻意仍吃 y0/y1(底端 = 落地點、頂端 = 站立面)');

  // ---- ⑤ 生成端:三種結構都把實測值餵進來(biomes.js 原文)----
  ok(/ty: gy \+ b\.h - 0\.5/.test(biomeSrc), 'Ⅷ biomes.js 一般建物 MUST 帶可見盒頂 ty(碰撞柱高 0.5m)');
  ok(/ty: gy \+ ph - 0\.5/.test(biomeSrc), 'Ⅷ biomes.js 裙樓 MUST 帶可見盒頂 ty');
  ok(/const lmTop = rockProbe\(g\)\.topAt\(bx, bz\);/.test(biomeSrc)
    && /ty: lmTop,/.test(biomeSrc), 'Ⅷ biomes.js 地標 MUST **實測**屋頂(LANDMARK_COL.h 是擋彈高,不是屋頂高)');
  ok(/ty: probe\.topAt\(x, z\)/.test(biomeSrc), 'Ⅷ biomes.js 巨岩 MUST **實測**岩頂(碰撞柱高 1.5m + 圓頂比 col.h 低)');
  // 神木:垂直沒有落差(碰撞柱頂 = 樹尖),但幹身**向上收窄** ⇒ 走 arm 跨接臂而不是 ty
  ok(/tr: trunkR\(def\.h \* s\)/.test(biomeSrc),
    'Ⅷ biomes.js 神木 MUST 帶頂端幹半徑 tr(繩錨靠 r − tr 的跨接臂伸回幹身,否則吊在空中)');
  const tr = { ...tree(0, 0, 9, 60), tr: 2.6 };
  const trRoute = planClimbRoutes({ blockers: [tr], heightAt: flat, envCodeAt: dry, bounds: BOX, rnd: () => 0 })[0];
  ok(trRoute && near(trRoute.arm, 9 - 2.6), 'Ⅷ 圓柱結構的跨接臂 MUST = r − tr(收窄多少就伸多長)');
  ok(near(attachFaces(tree(0, 0, 9, 60))[0].arm ?? 0, 0), 'Ⅷ 沒帶 tr 的等徑柱體 ⇒ 跨接臂 0(行為不變)');
}

// ---------------------------------------------------------------------------
console.log('\n=== Ⅸ 抽中機率 ← 地形陡度(越陡越高;不可陡上 = 100%)===');
{
  // ---- ① 曲線(執行 climb.js 原文;轉折點與 slopeMoveF 同一組,推導不手寫)----
  ok(near(climbShare(0), CLIMB.SHARE), 'Ⅸ 平地 = 基準 CLIMB.SHARE');
  ok(near(climbShare(SLOPE.EASE_DEG), CLIMB.SHARE), 'Ⅸ 平緩帶上限仍 = 基準(這種地形走路就上得去)');
  ok(near(climbShare(SLOPE.BLOCK_DEG), 1), 'Ⅸ 阻擋角 = 100%');
  ok(climbShare(SLOPE.BLOCK_DEG * 3) === 1, 'Ⅸ 更陡仍夾在 100%(MUST NOT 溢出)');
  const mid = climbShare((SLOPE.EASE_DEG + SLOPE.BLOCK_DEG) / 2);
  ok(mid > CLIMB.SHARE && mid < 1, `Ⅸ 中段落在基準與 1 之間(實測 ${(mid * 100).toFixed(1)}%)`);
  let mono = true;
  for (let d = 0; d < 60; d += 0.5) if (climbShare(d + 0.5) < climbShare(d) - 1e-12) mono = false;
  ok(mono, 'Ⅸ 機率 MUST 隨陡度單調不減(「越陡的地形越高」)');
  ok(near(climbShare(-25), climbShare(25)), 'Ⅸ 取絕對值:同一道坡從上/從下量 MUST 同機率');
  // 「不可陡上 = 100%」由曲線推導,不是另寫一條 if ⇒ 拿 slopeBlocked 逐度反查
  let blockedAll1 = true;
  for (let d = 0; d <= 90; d += 0.25) if (slopeBlocked(d) && climbShare(d) !== 1) blockedAll1 = false;
  ok(blockedAll1, 'Ⅸ 凡 slopeBlocked(爬不上去)的坡度 MUST 一律 100%(逐度反查,含 BLOCK_DEG 邊界)');
  ok(!/slopeBlocked/.test(climbSrc.slice(climbSrc.indexOf('export function climbShare'),
    climbSrc.indexOf('export function facilityEndY'))),
    'Ⅸ climbShare MUST NOT 另寫一條 slopeBlocked 分支(兩份判定調 BLOCK_F 就分家)');

  // ---- ② 陡度量測 siteSlopeDeg:取樣距離走 SLOPE.PROBE_M 單一縫、取最陡的一個方位 ----
  ok(/SLOPE\.PROBE_M/.test(climbSrc) && !/const\s+\w*PROBE\w*\s*[:=]\s*[\d.]/.test(climbSrc),
    'Ⅸ 取樣距離 MUST 取自 SLOPE.PROBE_M(MUST NOT 另手寫一個尺度)');
  const B = bld(0, 0, 40, 30, 40);
  ok(near(siteSlopeDeg(B, flat), 0), 'Ⅸ 平地 ⇒ 0°');
  const ramp = (k) => (x) => 20 + x * k;                    // 沿 +X 的等坡面
  for (const deg of [10, 20, 35]) {
    const k = Math.tan(deg * Math.PI / 180);
    ok(near(siteSlopeDeg(B, ramp(k)), deg, 1e-6), `Ⅸ 等坡面 ${deg}° ⇒ 量得 ${deg}°`);
  }
  // 取樣環半徑(與 siteSlopeDeg 同式):地形特徵擺在環外一點點,才量得到
  const RING = Math.hypot(B.hw2, B.hd2) + CLIMB.OFF;
  // 只有一個方位陡(其餘平)⇒ 仍 MUST 認出來(取最陡的一段,不是平均)
  const oneSide = (x, z) => (x > RING && Math.abs(z) < 20 ? 20 + (x - RING) * 1.0 : 20);
  ok(siteSlopeDeg(B, oneSide) > 40, 'Ⅸ 只有一側是陡壁 ⇒ MUST 取最陡的那一個方位(不得平均掉)');
  // 崖頂(四周全是下坡):MUST 仍判為陡地形 —— 只認上坡的話這裡會被當成平地
  const cliffTop = (x, z) => 20 - Math.max(0, Math.hypot(x, z) - RING) * 1.2;
  ok(siteSlopeDeg(B, cliffTop) > SLOPE.BLOCK_DEG, 'Ⅸ 坐在崖頂(四周下坡)MUST 仍判為不可陡上的地形');

  // ---- ③ 行為直測:同一批結構、同一 seed,只換地形陡度 ⇒ 抽中數量單調上升、陡到底 100% ----
  const list = [];
  for (let i = 0; i < 300; i++) list.push(bld((i % 20) * 200 - 2000, Math.floor(i / 20) * 200 - 2000, 24, 18, 30));
  const share = (k) => planClimbRoutes({
    blockers: list, heightAt: ramp(k), envCodeAt: dry, bounds: BOX, rnd: mulberry32(20260731),
  }).filter((q) => !q.link).length / list.length;
  const flatShare = share(0);
  const midShare = share(Math.tan(24 * Math.PI / 180));
  const steepShare = share(Math.tan((SLOPE.BLOCK_DEG + 8) * Math.PI / 180));
  ok(flatShare > 0.24 && flatShare < 0.36, `Ⅸ 平地 ≈ 30%(實測 ${(flatShare * 100).toFixed(1)}%)`);
  ok(midShare > flatShare + 0.15, `Ⅸ 24° 斜面明顯更高(實測 ${(midShare * 100).toFixed(1)}%)`);
  ok(near(steepShare, 1), `Ⅸ 不可陡上的地形 MUST 全部掛上(實測 ${(steepShare * 100).toFixed(1)}%)`);
  ok(flatShare < midShare && midShare < steepShare, 'Ⅸ 三檔陡度 MUST 嚴格遞增');

  // ---- ③b 相鄰相接也隨坡度(2026-07-31 使用者追加)----
  // 隔離法同 Ⅵ⑥:鄰居壓到 MIN_H 以下(不是候選、拿不到自己的地面路線,仍是合法的相接目標)
  // ⇒ 每對恰好一次擲骰,link/ground 就是那個機率本身。
  {
    ok(near(climbShare(0, CLIMB.LINK), CLIMB.LINK), 'Ⅸ 相接:平地 = 基準 CLIMB.LINK');
    ok(near(climbShare(SLOPE.BLOCK_DEG, CLIMB.LINK), 1), 'Ⅸ 相接:阻擋角 = 100%');
    ok(climbShare(20, CLIMB.LINK) > climbShare(20), 'Ⅸ 同一坡度下相接機率 MUST 高於地面路線(基準本來就高)');
    const pairs = [];
    for (let i = 0; i < 400; i++) {
      const cx = (i % 20) * 190 - 1900, cz = Math.floor(i / 20) * 190 - 1900;
      pairs.push(bld(cx, cz, 40, 40, 40));                     // 候選(高)
      pairs.push(bld(cx + 37, cz, 30, 30, CLIMB.MIN_H - 1));   // 非候選(矮)但仍是合法相接目標
    }
    const rate = (k) => {
      const rs = planClimbRoutes({
        blockers: pairs, heightAt: ramp(k), envCodeAt: dry, bounds: BOX, rnd: mulberry32(20260728),
      });
      const g = rs.filter((r) => !r.link).length;
      return g ? rs.filter((r) => r.link).length / g : 0;
    };
    const flatLink = rate(0);
    const steepLink = rate(Math.tan((SLOPE.BLOCK_DEG + 8) * Math.PI / 180));
    ok(flatLink > CLIMB.LINK - 0.1 && flatLink < CLIMB.LINK + 0.1,
      `Ⅸ 相接:平地 ≈ CLIMB.LINK(實測 ${(flatLink * 100).toFixed(1)}%)`);
    ok(near(steepLink, 1), `Ⅸ 相接:不可陡上的地形 MUST 每條地面路線都相接(實測 ${(steepLink * 100).toFixed(1)}%)`);
    // 反向對照:相接門檻寫死回 CLIMB.LINK ⇒ 陡地形不再 100%
    const fixedLink = loadCore((s) => s.replace(
      'if (linkRoll < climbShare(deg, CLIMB.LINK)) {', 'if (linkRoll < CLIMB.LINK) {'));
    const rs2 = fixedLink.planClimbRoutes({
      blockers: pairs, heightAt: ramp(Math.tan((SLOPE.BLOCK_DEG + 8) * Math.PI / 180)),
      envCodeAt: dry, bounds: BOX, rnd: mulberry32(20260728),
    });
    const bad2 = rs2.filter((r) => r.link).length / rs2.filter((r) => !r.link).length;
    ok(bad2 < CLIMB.LINK + 0.1, 'Ⅸ 反向對照:相接門檻寫死回定值 MUST 讓陡地形掉回七成(證明本條真的驗到了)');
    // 曲線只有一份:相接 MUST NOT 另寫一條 ramp
    ok(!/BLOCK_DEG - SLOPE\.EASE_DEG[\s\S]*BLOCK_DEG - SLOPE\.EASE_DEG/.test(climbSrc),
      'Ⅸ 坡度曲線 MUST 只有一份(相接不得另寫第二條 ramp)');
  }

  // ---- ④ 反向對照:門檻寫死回 CLIMB.SHARE ⇒ 陡地形不再 100%(證明本節真的驗到了)----
  const fixed = loadCore((s) => s.replace(
    'if (pick >= climbShare(deg)) continue;', 'if (pick >= CLIMB.SHARE) continue;'));
  const bad = fixed.planClimbRoutes({
    blockers: list, heightAt: ramp(Math.tan((SLOPE.BLOCK_DEG + 8) * Math.PI / 180)),
    envCodeAt: dry, bounds: BOX, rnd: mulberry32(20260731),
  }).filter((q) => !q.link).length / list.length;
  ok(bad < 0.4, 'Ⅸ 反向對照:門檻寫死回定值 MUST 讓陡地形掉回三成(證明本條真的驗到了)');

  // ---- ⑤ 量測 MUST NOT 消耗亂數(排在三枚抽樣之後也不能擾動序列;§2.3)----
  let draws = 0;
  const counting = () => { draws++; return 0.99; };          // 恆不中 ⇒ 只數抽樣枚數
  planClimbRoutes({ blockers: list, heightAt: ramp(1), envCodeAt: dry, bounds: BOX, rnd: counting });
  ok(draws === list.length * 3, `Ⅸ 每候選仍固定消耗 3 枚亂數(實測 ${draws} / 期望 ${list.length * 3}）`);
}

console.log(`\n${fail ? '❌' : '✅'} 攀爬路線稽核:${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
