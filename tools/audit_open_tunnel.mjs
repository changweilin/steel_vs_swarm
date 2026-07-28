// ============ 明隧道稽核(側向土牆體檢 + 明隧道構件)============
// 用途:隧道的「覆蓋」只在**中心線**上判定(`tunnelCoverIntervals`:地表 ≥ 路面 + CLEAR + ROOF_T),
// 側向的土牆厚度沒人管 —— 山腰蜿蜒路 / 縫合蓋廊段 / 引道開挖擦邊處,單邊土牆可能只剩幾公尺
// 甚至被挖穿,從外面看就是一片混凝土浮在山坡上、坡面與結構之間一道看穿到洞內的縫。
// 這種地方現實中蓋的是**明隧道**(gallery / rock shed):結構自己站在地面上,有外露頂板、
// 落地的擋土 facade、扶壁。判定住 `biomes.js tunnelWallProfile()`(單一縫)。
//
// 本稽核驗兩層:
//   Ⅰ 判定(真的執行 `tunnelWallProfile` 的原始碼文字):
//     ① 深埋隧道(四面都是山)MUST 全程 open=false —— **舊行為不得回歸**(否則整張圖的隧道
//        都會長出明隧道構件)
//     ② 單邊土牆薄 → **只有那一側** open(使用者情境:山腰蜿蜒路)
//     ③ 土牆被挖穿(側坡低於路面)→ open,且 gy < 路面 ⇒ facade 落地基準沉到地表之下
//     ④ 縫合蓋廊段(兩側地表都低於頂板)→ 兩側都 open
//     ⑤ 覆蓋段之外(cov=false)MUST NOT open(那裡的牆本來就收成零高)
//     ⑥ 單點抖動 MUST 膨脹到鄰格(不留 6m 長的孤立 facade)
//     ⑦ 門檻邊界:地表 = 頂板頂面 MUST NOT open;低 1cm MUST open
//     ⑧ 取樣 MUST 量到 WALL_MIN 整數點(最外圈的凹陷也要抓到 —— `d += SAMP` 的寫法會漏掉)
//     ⑨ gy 取前後一格窗口最小值(頂點間距 6m > 側向取樣距,單點值會讓 facade 底緣漏縫)
//     ⑩ 法線 nx/nz:單位長、與切線正交、兩側互為相反 —— facade / 頂板 / 扶壁共用這一份
//   Ⅱ 構件(靜態規則,three 走 CDN 沙箱無法真渲染):
//     牆緞帶 MUST 吃 `galBase`/`TUN.ROOF_T`、頂板 MUST 外挑 EAVE 且 EAVE > 天花板小段的 0.6、
//     扶壁 MUST NOT 進 cols(碰撞柱)、明隧道 MUST NOT 動 tunnelSegs/ceilSegs/hw(純表現層)。
//
// 為什麼用「抽原文」而不是 import:`biomes.js` 的 three 走 CDN importmap,Node 端解析不了;
// 抽出來評估的仍是**真正的程式碼文字**(另抄一份公式就永遠會通過)。
// 跑法:`node tools/audit_open_tunnel.mjs`
// 退出碼:0 = 全綠;1 = 有紅字
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(ROOT, 'public', 'js', 'biomes.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : (fail++, console.error(`  ✗ ${msg}`)); };

// ---- 抽出 TUN 旋鈕 + tunnelWallProfile 原文 ----
const tunSrc = /const TUN = \{([\s\S]*?)\};/.exec(src);
if (!tunSrc) throw new Error('找不到 TUN 旋鈕(biomes.js 結構已變?)');
const TUN = Object.fromEntries(
  tunSrc[1].replace(/\/\/.*$/gm, '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => { const [k, v] = s.split(':').map((t) => t.trim()); return [k, v === 'LOS.TUN_CLEAR_M' ? 8 : +v]; }),
);
const undSrc = /const UND = \{([\s\S]*?)\};/.exec(src);
if (!undSrc) throw new Error('找不到 UND 旋鈕(biomes.js 結構已變?)');
const UND = Object.fromEntries(
  undSrc[1].replace(/\/\/.*$/gm, '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => { const [k, v] = s.split(':').map((t) => t.trim()); return [k, +v]; }),
);
const P0 = src.indexOf('const TUN_WALL_SAMP');
const P1 = src.indexOf('\n}', src.indexOf('function tunnelWallProfile(')) + 2;
if (P0 < 0 || P1 <= P0) throw new Error('找不到 tunnelWallProfile 區塊');
const BLOCK = src.slice(P0, P1);
const tunnelWallProfile = new Function('TUN', `${BLOCK}\nreturn tunnelWallProfile;`)(TUN);

// ---- 測試場景:一條沿 +X 的直隧道,路面平直 ----
const HW = 9, FLOOR = 20;
const N = 21;
const pts = Array.from({ length: N }, (_, i) => [i * 6, 0]);       // 頂點間距 6m(= ROAD_SEG)
const floors = pts.map(() => FLOOR);
const covAll = pts.map(() => true);
const TOP = FLOOR + TUN.CLEAR + TUN.ROOF_T;                        // 頂板頂面
// 注意軸向:隧道沿 +X ⇒ 切線 (1,0) ⇒ 側向法線 nx = dz·side = 0、nz = −dx·side = −side,
// 亦即 **side +1 量的是 z<0 那一側**(測資照此佈置,寫反了會驗到另一面)。
const mk = (fn) => (x, z) => fn(x, z);
const prof = (heightAt, cov = covAll, side = 1) => tunnelWallProfile(pts, floors, cov, heightAt, HW, side);

// ① 深埋:四面都高過頂板 ⇒ 全程不是明隧道(舊行為不得回歸)
{
  const h = mk(() => TOP + 30);
  for (const side of [1, -1]) {
    const p = prof(h, covAll, side);
    ok(p.every((g) => !g.open), `① 深埋隧道 side=${side} MUST 全程 open=false(實得 ${p.filter((g) => g.open).length} 點)`);
  }
}

// ② 單邊土牆薄(山腰路):+z 側山、−z 側懸崖 ⇒ 只有 −z 那一側是明隧道
{
  const h = mk((x, z) => (z < 0 ? TOP + 25 : FLOOR - 4));   // −z = 山、+z = 懸崖
  const pPos = prof(h, covAll, 1), pNeg = prof(h, covAll, -1);
  ok(pPos.every((g) => !g.open), '② 山側(+1)MUST NOT 判成明隧道');
  ok(pNeg.every((g) => g.open), '② 懸崖側(−1)MUST 全程判成明隧道');
  ok(pNeg.every((g) => g.gy <= FLOOR - 4 + 1e-6), '② 懸崖側 gy MUST 落在側坡地表高');
}

// ③ 挖穿(側坡低於路面)⇒ facade 落地基準 galBase = min(路面−0.3, gy−0.8) 沉到地表之下
{
  const h = mk((x, z) => (z > 0 ? FLOOR - 12 : TOP + 25));
  const p = prof(h, covAll, -1);
  const base = p.map((g) => Math.min(FLOOR - 0.3, g.gy - 0.8));
  ok(p.every((g) => g.open), '③ 挖穿側 MUST 判成明隧道');
  ok(base.every((b) => b <= FLOOR - 12 - 0.8 + 1e-6), '③ 挖穿側 facade 底緣 MUST 沉到側坡地表之下(不留看穿的縫)');
}

// ④ 縫合蓋廊段:兩側地表都低於頂板(但中心線覆蓋成立)⇒ 兩側都是明隧道
{
  const h = mk(() => TOP - 3);
  for (const side of [1, -1]) ok(prof(h, covAll, side).every((g) => g.open), `④ 蓋廊段 side=${side} MUST 判成明隧道`);
}

// ⑤ 覆蓋段之外一律不立(敞開段/洞口的牆本來就收成零高)
{
  const h = mk(() => FLOOR - 5);                                   // 到處都薄
  const cov = pts.map((_, i) => i >= 8 && i <= 12);
  const p = prof(h, cov);
  ok(p.every((g, i) => g.open === (i >= 8 && i <= 12)), '⑤ open MUST 只落在覆蓋段內');
}

// ⑥ 單點抖動 MUST 膨脹一格(不留孤立 facade)
{
  const h = mk((x) => (Math.abs(x - 60) < 3 ? TOP - 2 : TOP + 20));   // 只有頂點 10 那一格薄
  const p = prof(h);
  ok(p[10].open && p[9].open && p[11].open, '⑥ 單點薄 MUST 膨脹到前後一格');
  ok(!p[8].open && !p[12].open, '⑥ 膨脹 MUST 只有一格(不無限擴散)');
}

// ⑦ 門檻邊界:恰好等於頂板頂面 = 藏得住(不判明隧道);低 1cm 就判
{
  ok(prof(mk(() => TOP)).every((g) => !g.open), '⑦ 地表 = 頂板頂面 MUST NOT 判成明隧道');
  ok(prof(mk(() => TOP - 0.01)).every((g) => g.open), '⑦ 地表低於頂板頂面 1cm MUST 判成明隧道');
}

// ⑧ 取樣 MUST 涵蓋 WALL_MIN 整數點(最外圈的凹陷抓得到)
{
  const dFar = HW + TUN.WALL_MIN;
  const h = mk((x, z) => (Math.abs(z + dFar) < 0.4 ? TOP - 5 : TOP + 20));
  ok(prof(h).some((g) => g.open), `⑧ 側向 ${dFar}m(WALL_MIN 整數點)的凹陷 MUST 量得到`);
  // 反面:比 WALL_MIN 更外側的凹陷不該影響判定(否則門檻等於無限大)
  const hOut = mk((x, z) => (Math.abs(z + dFar + 6) < 0.4 ? TOP - 5 : TOP + 20));
  ok(prof(hOut).every((g) => !g.open), '⑧ WALL_MIN 之外的凹陷 MUST NOT 觸發明隧道');
}

// ⑨ gy 取前後一格的窗口最小值
{
  const h = mk((x) => (Math.abs(x - 60) < 3 ? 5 : 40));
  const p = prof(h);
  ok(p[9].gy <= 5 + 1e-6 && p[11].gy <= 5 + 1e-6, '⑨ gy MUST 取前後一格窗口最小值(頂點間距 > 側向取樣距)');
}

// ⑩ 側向法線:單位長、與切線正交、兩側互為相反
{
  const diag = Array.from({ length: 6 }, (_, i) => [i * 4, i * 3]);   // 斜向(切線 (0.8, 0.6))
  const f = diag.map(() => FLOOR), c = diag.map(() => true);
  const a = tunnelWallProfile(diag, f, c, () => TOP + 20, HW, 1);
  const b = tunnelWallProfile(diag, f, c, () => TOP + 20, HW, -1);
  ok(a.every((g) => Math.abs(Math.hypot(g.nx, g.nz) - 1) < 1e-9), '⑩ 側向法線 MUST 為單位長');
  ok(a.every((g) => Math.abs(g.nx * 0.8 + g.nz * 0.6) < 1e-9), '⑩ 側向法線 MUST 與切線正交');
  ok(a.every((g, i) => Math.abs(g.nx + b[i].nx) < 1e-12 && Math.abs(g.nz + b[i].nz) < 1e-12),
    '⑩ 兩側法線 MUST 互為相反');
}

// ---- Ⅱ 構件幾何(執行 biomes.js 真正的發射器原文,不另抄一份公式)----
// 抽出「明隧道體檢 preamble + 牆緞帶/扶壁迴圈 + 頂板/女兒牆區塊」三段連續原文,以樁件跑一次,
// 逐頂點量出來的位置/朝向就是遊戲真的會畫的東西 —— 擺位與旋轉方向不同調(見全域 A26)在此露餡。
const B0 = src.indexOf('        const floorsV = cum.map((s) => tFloorAt(s));');
const B1 = src.indexOf('        // 橫樑 + 天花燈', B0);
if (B0 < 0 || B1 <= B0) throw new Error('找不到明隧道構件區塊');
const EMIT = src.slice(B0, B1);
for (const need of ['tunnelWallProfile(run, floorsV, covV', 'const galBase =', 'buts.push(', 'const RW = hw + TUN.EAVE']) {
  if (!EMIT.includes(need)) throw new Error(`抽出的構件區塊缺少 ${need}`);
}
// under/tBaseAt/UND/cope 是地下道(平地下穿)那一路的參數 —— 本稽核一律以 under=false 跑,
// 亦即「山體隧道 = 舊行為」;地下道自己的幾何由 tools/audit_underpass.mjs 驗。
const emit = new Function('TUN', 'UND', 'tunnelWallProfile', 'run', 'nP', 'cum', 'hw', 'tFloorAt', 'tBaseAt',
  'covS', 'terrain', 'ceilOf', 'under', 'wall', 'buts', 'galRoof', 'cope',
  `${EMIT}\nreturn { galP, floorsV, covV };`);

/** 跑一次發射器;回傳三個桶 + profile */
function build(heightAt, { cov = () => true, floor = FLOOR } = {}) {
  const cum2 = pts.map((p) => p[0]);                       // 沿 +X 直線 ⇒ 弧長 = x
  const wall = { pos: [], nrm: [], idx: [], base: 0 }, buts = [];
  const galRoof = { pos: [], nrm: [], idx: [], base: 0 };
  const cope = { pos: [], nrm: [], idx: [], base: 0 };
  const out = emit(TUN, UND, tunnelWallProfile, pts, pts.length, cum2, HW, () => floor, () => floor, cov,
    { heightAt }, (s) => floor + TUN.CLEAR, false, wall, buts, galRoof, cope);
  return { ...out, wall, buts, galRoof, cope, cum: cum2 };
}
const TOPY = FLOOR + TUN.CLEAR + TUN.ROOF_T;               // 頂板頂面(= ceilOf + ROOF_T)
const wallV = (b) => Array.from({ length: b.wall.pos.length / 3 }, (_, k) =>
  [b.wall.pos[k * 3], b.wall.pos[k * 3 + 1], b.wall.pos[k * 3 + 2]]);

// Ⅱ-a 深埋隧道:三個桶的產出 MUST 與舊制逐點相同(牆 = 路面−0.3 ~ 天花+0.2、無頂板無扶壁)
{
  const b = build(() => TOPY + 30);
  const v = wallV(b);
  ok(v.length === pts.length * 4, `Ⅱ-a 深埋 牆頂點數 MUST 不變(實得 ${v.length})`);
  ok(v.every((p, k) => Math.abs(p[1] - (k % 2 ? FLOOR + TUN.CLEAR + 0.2 : FLOOR - 0.3)) < 1e-9),
    'Ⅱ-a 深埋 牆底/牆頂 MUST 維持舊公式(舊行為不得回歸)');
  ok(v.every((p) => Math.abs(Math.abs(p[2]) - HW) < 1e-9), 'Ⅱ-a 牆面 MUST 貼在 ±hw');
  ok(b.galRoof.idx.length === 0 && b.buts.length === 0, 'Ⅱ-a 深埋 MUST NOT 長出頂板/扶壁(白付幾何成本)');
}

// Ⅱ-b 山腰路(−z 山 / +z 懸崖,懸崖高 CLIFF):只有懸崖側改明隧道
const CLIFF = FLOOR - 6;
{
  const b = build((x, z) => (z < 0 ? TOPY + 25 : CLIFF));
  const [pPos, pNeg] = b.galP;                             // side +1 量 z<0(山)、side −1 量 z>0(崖)
  ok(pPos.every((g) => !g.open) && pNeg.every((g) => g.open), 'Ⅱ-b 只有懸崖側判成明隧道');
  // 牆緞帶:前半 = side +1(山側,z = −hw)、後半 = side −1(崖側,z = +hw)
  const v = wallV(b), half = pts.length * 2;
  const hill = v.slice(0, half), gal = v.slice(half);
  ok(hill.every((p, k) => Math.abs(p[1] - (k % 2 ? FLOOR + TUN.CLEAR + 0.2 : FLOOR - 0.3)) < 1e-9),
    'Ⅱ-b 山側牆 MUST 維持舊公式(單邊改制 MUST NOT 波及另一邊)');
  ok(gal.every((p) => Math.abs(p[2] - HW) < 1e-9), 'Ⅱ-b 明隧道 facade MUST 立在懸崖那一側');
  ok(gal.every((p, k) => (k % 2 ? Math.abs(p[1] - TOPY) < 1e-9 : p[1] <= CLIFF - 0.8 + 1e-9)),
    'Ⅱ-b facade:底緣沉到側坡地表之下、頂緣 = 頂板頂面');
  // 頂板:水平、頂面高、半寬 = hw + EAVE、法線朝上
  const rv = Array.from({ length: b.galRoof.pos.length / 3 }, (_, k) =>
    [b.galRoof.pos[k * 3], b.galRoof.pos[k * 3 + 1], b.galRoof.pos[k * 3 + 2]]);
  const top = rv.filter((p) => Math.abs(p[1] - TOPY) < 1e-9);
  ok(rv.length > 0 && top.length > 0, 'Ⅱ-b 明隧道段 MUST 長出外露頂板');
  const roofN = Array.from({ length: b.galRoof.nrm.length / 3 }, (_, k) => b.galRoof.nrm[k * 3 + 1]);
  ok(roofN.slice(0, (pts.length - 1) * 4).every((n) => n === 1), 'Ⅱ-b 頂面法線 MUST 朝上');
  ok(top.every((p) => Math.abs(Math.abs(p[2]) - (HW + TUN.EAVE)) < 1e-9),
    `Ⅱ-b 頂板半寬 MUST = hw + EAVE(${HW + TUN.EAVE})—— 蓋過天花板小段的 hw+0.6`);
  // 女兒牆:只立在明隧道側(z = +RW),高 = PARAPET
  const par = rv.filter((p) => p[1] > TOPY + 1e-9);
  ok(par.length > 0 && par.every((p) => Math.abs(p[2] - (HW + TUN.EAVE)) < 1e-9),
    'Ⅱ-b 女兒牆 MUST 只立在明隧道側的頂板邊緣');
  ok(par.every((p) => Math.abs(p[1] - (TOPY + TUN.PARAPET)) < 1e-9), 'Ⅱ-b 女兒牆高 MUST = PARAPET');
  // 扶壁:只在明隧道側、間距 ≥ BUT_GAP、底頂與 facade 同源、**朝向與擺位同調**(A26)
  ok(b.buts.length > 0, 'Ⅱ-b 明隧道段 MUST 有扶壁');
  ok(b.buts.every((t) => t.z > HW), 'Ⅱ-b 扶壁 MUST 站在明隧道側的牆外');
  ok(b.buts.every((t) => Math.abs(t.z) - t.d / 2 < HW + 1e-9), 'Ⅱ-b 扶壁內緣 MUST 埋進牆面(不留縫)');
  ok(b.buts.every((t) => Math.abs(t.y1 - TOPY) < 1e-9 && t.y0 <= CLIFF - 0.8 + 1e-9),
    'Ⅱ-b 扶壁 MUST 自 facade 底緣頂到簷口(與牆同源)');
  ok(b.buts.every((t, k) => k === 0 || t.x - b.buts[k - 1].x >= TUN.BUT_GAP - 1e-9),
    `Ⅱ-b 扶壁間距 MUST ≥ BUT_GAP(${TUN.BUT_GAP}m)`);
  // 旋轉方向 MUST 與擺位方向同調:ry 的 local +X = (cos ry, −sin ry) MUST = 該側法線
  const nOpen = [b.galP[1][0].nx, b.galP[1][0].nz];
  ok(b.buts.every((t) => Math.abs(Math.cos(t.ry) - nOpen[0]) < 1e-9 && Math.abs(-Math.sin(t.ry) - nOpen[1]) < 1e-9),
    'Ⅱ-b 扶壁的 local +X(由 ry 推)MUST = 擺位用的側向法線(見全域 A26:差 90°/差正負號)');
}

// Ⅱ-c 斜向隧道:facade / 頂板 / 扶壁 MUST 一律沿同一組法線擺(軸向路容易矇混過關)
{
  const diag = Array.from({ length: 9 }, (_, i) => [i * 4.8, i * 3.6]);   // 切線 (0.8, 0.6)
  const nx = 0.6, nz = -0.8;                                             // side +1 的法線
  const cum2 = diag.map((_, i) => i * 6);
  const wall = { pos: [], nrm: [], idx: [], base: 0 }, buts = [];
  const galRoof = { pos: [], nrm: [], idx: [], base: 0 };
  // 側坡:沿 side +1 法線那半邊挖低 ⇒ 只有該側是明隧道
  const heightAt = (x, z) => ((x - diag[0][0]) * nx + (z - diag[0][1]) * nz > 1 ? CLIFF : TOPY + 25);
  const cope = { pos: [], nrm: [], idx: [], base: 0 };
  const r = emit(TUN, UND, tunnelWallProfile, diag, diag.length, cum2, HW, () => FLOOR, () => FLOOR, () => true,
    { heightAt }, () => FLOOR + TUN.CLEAR, false, wall, buts, galRoof, cope);
  ok(r.galP[0].every((g) => g.open) && r.galP[1].every((g) => !g.open), 'Ⅱ-c 斜向:只有低側判成明隧道');
  const off = (x, z, i) => (x - diag[i][0]) * nx + (z - diag[i][1]) * nz;   // 沿法線的側向位移
  const lat = (x, z, i) => (x - diag[i][0]) * 0.8 + (z - diag[i][1]) * 0.6; // 沿切線的位移(應為 0)
  let okWall = true;
  for (let i = 0; i < diag.length; i++) {
    const k = i * 2 * 3;                                   // 前半 = side +1
    okWall = okWall && Math.abs(off(wall.pos[k], wall.pos[k + 2], i) - HW) < 1e-9
      && Math.abs(lat(wall.pos[k], wall.pos[k + 2], i)) < 1e-9;
  }
  ok(okWall, 'Ⅱ-c 斜向 facade MUST 恰好沿法線外移 hw(不含切線分量)');
  ok(buts.length > 0 && buts.every((t) => {
    let bi = 0, bd = Infinity;                             // 最近頂點 = 該支扶壁的錨點
    diag.forEach((p, i) => { const d = Math.hypot(t.x - p[0], t.z - p[1]); if (d < bd) { bd = d; bi = i; } });
    return Math.abs(off(t.x, t.z, bi) - (HW + t.d / 2 - 0.15)) < 1e-9 && Math.abs(lat(t.x, t.z, bi)) < 1e-9;
  }), 'Ⅱ-c 斜向扶壁 MUST 恰好貼在 facade 外側(擺位無切線分量偏移)');
  ok(buts.every((t) => Math.abs(Math.cos(t.ry) - nx) < 1e-9 && Math.abs(-Math.sin(t.ry) - nz) < 1e-9),
    'Ⅱ-c 斜向扶壁朝向 MUST 仍等於側向法線');
}

// ---- Ⅲ 純表現層(靜態規則:碰撞/走廊/通行寬一律不動)----
const S0 = src.indexOf('      if (strc && total > 8) {');
const S1 = src.indexOf('      // ---- 高架橋外觀', S0);
const STRC = src.slice(S0, S1);
ok(/const galP = \[1, -1\]\.map\(\(side\) => \{[\s\S]{0,400}?tunnelWallProfile\(run, floorsV, covV/.test(STRC),
  'Ⅲ 明隧道判定 MUST 走 tunnelWallProfile 單一縫');
ok(/return under \? prof\.map\(\(g\) => \(\{ \.\.\.g, open: false \}\)\) : prof;/.test(STRC),
  'Ⅲ 地下道 MUST 一律非明隧道(它的頂是沒被開挖的原地表;引道轉換帶的碗緣會讓體檢誤判)');
ok((STRC.match(/galBase\(i, g\)/g) || []).length >= 2, 'Ⅲ 牆緞帶與扶壁 MUST 共用 galBase(各寫一份就會分家)');
ok(/buts\.length >= TUN\.BUT_MAX/.test(STRC), 'Ⅲ 扶壁 MUST 吃全圖實例上限 BUT_MAX');
ok(!/cols\.push\([^)]*\bb(?:ut)?\./.test(src.slice(src.indexOf('if (buts.length)'))),
  'Ⅲ 扶壁 MUST NOT 登記碰撞柱(cols)—— 它們站在坡面上,登記了就是山坡上的隱形障礙');
for (const name of ['tunnelSegs', 'ceilSegs']) {
  const i0 = STRC.indexOf(`${name}.push`);
  ok(i0 > 0 && !/gal|\.open/.test(STRC.slice(i0, i0 + 400)),
    `Ⅲ ${name}(碰撞/天花)MUST NOT 吃明隧道判定 —— 純表現層,伺服器 slab 不得漂移`);
}
ok(!/hw = [^\n]*gal/.test(STRC), 'Ⅲ 通行寬 hw MUST NOT 隨明隧道改變(伺服器 slab / 規則 #5 不得漂移)');
ok(TUN.EAVE > 0.6, `Ⅲ TUN.EAVE(${TUN.EAVE})MUST > 天花板小段的 hw+0.6(否則天花板邊緣露在簷外)`);

console.log(`\n明隧道稽核:${pass} 綠 / ${fail} 紅`);
process.exit(fail ? 1 : 0);
