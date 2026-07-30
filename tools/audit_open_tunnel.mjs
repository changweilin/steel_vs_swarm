// ============ 明隧道稽核(側向土牆體檢 + 柱列構件 + 兩端可穿透)============
// 用途:隧道的「覆蓋」只在**中心線**上判定(`tunnelCoverIntervals`:地表 ≥ 路面 + CLEAR + ROOF_T),
// 側向的土牆厚度沒人管 —— 山腰蜿蜒路 / 縫合蓋廊段 / 引道開挖擦邊處,單邊土牆可能只剩幾公尺
// 甚至被挖穿,從外面看就是一片混凝土浮在山坡上、坡面與結構之間一道看穿到洞內的縫。
// 這種地方現實中蓋的是**明隧道**(gallery / rock shed):深入地形的那一側跟隧道一樣是整面牆,
// 展露出地形的那一側 = 落地矮牆 + **連續柱列**撐外露頂板,柱間透明可見**可穿透**
// (2026-07-30 使用者定案柱列改制;判定住 `biomes.js tunnelWallProfile()` 單一縫)。
//
// 本稽核驗四層:
//   Ⅰ 判定(真的執行 `tunnelWallProfile` 的原始碼文字):
//     ① 深埋隧道(四面都是山)MUST 全程 open=false —— **舊行為不得回歸**(否則整張圖的隧道
//        都會長出明隧道構件)
//     ② 單邊土牆薄 → **只有那一側** open(使用者情境:山腰蜿蜒路)
//     ③ 土牆被挖穿(側坡低於路面)→ open,且 gy < 路面 ⇒ 矮牆落地基準沉到地表之下
//     ④ 縫合蓋廊段(兩側地表都低於頂板)→ 兩側都 open
//     ⑤ 覆蓋段之外(cov=false)MUST NOT open(那裡的牆本來就收成零高)
//     ⑥ 單點抖動 MUST 膨脹到鄰格(不留 6m 長的孤立開口)
//     ⑦ 門檻邊界:地表 = 頂板頂面 MUST NOT open;低 1cm MUST open
//     ⑧ 取樣 MUST 量到 WALL_MIN 整數點(最外圈的凹陷也要抓到 —— `d += SAMP` 的寫法會漏掉)
//     ⑨ gy 取前後一格窗口最小值(頂點間距 6m > 側向取樣距,單點值會讓矮牆底緣漏縫)
//     ⑩ 法線 nx/nz:單位長、與切線正交、兩側互為相反 —— 矮牆 / 頂板 / 柱列共用這一份
//   Ⅱ 構件(執行 biomes.js 真正的發射器原文;three 走 CDN 沙箱無法真渲染):
//     深埋隧道三個桶 MUST 逐點同舊制;開放側 = 矮牆(galBase → 路面+SILL)+ 連續柱列
//     (落地 → 頂板頂面,間距 COL_GAP、A26 朝向同調)+ 外露頂板(hw+EAVE 簷口)+
//     簷口封邊帶(天花底面 → 女兒牆頂);深埋側 MUST 維持整面牆不受波及。
//   Ⅲ 靜態規則:幾何(hw / fy / cy / ceilSegs / 走廊)一律不動,gal 只是 tunnelSegs 的
//     **註記欄**;柱列 MUST NOT 進碰撞柱(cols);main.js slab 第 7 欄 MUST 上傳 gal。
//   Ⅳ 兩端可穿透(import 真 `BattleSim` 數值直測):開放側穿出的射線/爆風 MUST 放行、
//     實牆側/天花 MUST 照擋、gal=0 舊行為逐位元不變;side 位元在 z 鏡射上傳下 MUST 不換手。
//
// 為什麼 Ⅰ~Ⅲ 用「抽原文」而不是 import:`biomes.js` 的 three 走 CDN importmap,Node 端解析
// 不了;抽出來評估的仍是**真正的程式碼文字**(另抄一份公式就永遠會通過)。Ⅳ 的 sim.js 是
// 瀏覽器可執行模組,直接 import 真品。
// 跑法:`node tools/audit_open_tunnel.mjs`
// 退出碼:0 = 全綠;1 = 有紅字
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BattleSim } from '../server/sim.js';
import { MAPGEO } from '../public/js/data.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(ROOT, 'public', 'js', 'biomes.js'), 'utf8');
const mainSrc = readFileSync(join(ROOT, 'public', 'js', 'main.js'), 'utf8');

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

// ③ 挖穿(側坡低於路面)⇒ 矮牆落地基準 galBase = min(路面−0.3, gy−0.8) 沉到地表之下
{
  const h = mk((x, z) => (z > 0 ? FLOOR - 12 : TOP + 25));
  const p = prof(h, covAll, -1);
  const base = p.map((g) => Math.min(FLOOR - 0.3, g.gy - 0.8));
  ok(p.every((g) => g.open), '③ 挖穿側 MUST 判成明隧道');
  ok(base.every((b) => b <= FLOOR - 12 - 0.8 + 1e-6), '③ 挖穿側矮牆底緣 MUST 沉到側坡地表之下(不留看穿的縫)');
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

// ⑥ 單點抖動 MUST 膨脹一格(不留孤立開口)
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

// ⑧ 取樣 MUST 涵蓋 WALL_MIN 整數點(最外圈的凹陷抓得到)。2026-07-31 近帶岩背改制後,
//    「只有最外圈凹陷、近帶仍高」不再判 open(那是岩脊後的谷,牆背有實體支撐)——
//    取樣涵蓋改以 gy 驗證(gy = 全取樣窗最小值,最外圈凹陷 MUST 反映在 gy)。
{
  const dFar = HW + TUN.WALL_MIN;
  const h = mk((x, z) => (Math.abs(z + dFar) < 0.4 ? TOP - 5 : TOP + 20));
  ok(prof(h).some((g) => g.gy <= TOP - 5 + 1e-6), `⑧ 側向 ${dFar}m(WALL_MIN 整數點)的凹陷 MUST 量得到(反映在 gy)`);
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

// ⑪ 近帶岩背(2026-07-31 使用者回報「山壁側牆沒建完整、走得穿」;燕子口岩脊實案):
//    牆背 NEAR_W 內只要有取樣點高過頂板 = 牆背貼著實體土/岩 ⇒ MUST 維持整面牆,
//    即使更外側(岩脊後)落谷 —— 柱列開向一面岩壁 = 玩家看到的「山壁側只有矮牆」。
{
  const dRock = HW + 0.5;                                  // 岩脊:貼牆第一枚取樣點就是高岩
  const hFin = mk((x, z) => (Math.abs(z) <= dRock + 0.4 ? TOP + 4 : FLOOR - 20));
  ok(prof(hFin).every((g) => !g.open), '⑪ 近帶岩背(岩脊,脊後落谷)MUST NOT 判成明隧道');
  // 對照:近帶(NEAR_W 內)全低、更外側才升高 ⇒ 照樣是明隧道(柱間看出去是上坡,合法)
  const hRise = mk((x, z) => (Math.abs(z) <= HW + TUN.NEAR_W + 0.1 ? FLOOR - 3 : TOP + 20));
  ok(prof(hRise).every((g) => g.open), '⑪ 近帶全低、遠處升高 MUST 照判明隧道(開口面向低地)');
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
// 柱列改制後體檢 preamble(floorsV/covV/galP/galMask)搬到碰撞段迴圈之前(tunnelSegs 要吃
// gal 註記),構件發射器(galBase/牆緞帶/柱列/頂板)仍接在後面 —— 抽**兩段**連續原文縫合,
// 中間的 tunnelSegs/ceilSegs 迴圈(碰撞幾何)不進本測(它由 Ⅲ 靜態規則與 audit_underpass 顧)。
const B0 = src.indexOf('        const floorsV = cum.map((s) => tFloorAt(s));');
const B0e = src.indexOf('        for (let i = 0; i < nP - 1; i++) {', B0);
const C0 = src.indexOf('        // facade 落地基準', B0);
const B1 = src.indexOf('        // 橫樑 + 天花燈', C0);
if (B0 < 0 || B0e <= B0 || C0 <= B0e || B1 <= C0) throw new Error('找不到明隧道構件區塊');
const EMIT = src.slice(B0, B0e) + src.slice(C0, B1);
for (const need of ['tunnelWallProfile(run, floorsV, covV', 'const galBase =', 'galCols.push(', 'const RW = hw + TUN.EAVE']) {
  if (!EMIT.includes(need)) throw new Error(`抽出的構件區塊缺少 ${need}`);
}
// under/tBaseAt/UND/cope 是地下道(平地下穿)那一路的參數 —— 本稽核一律以 under=false 跑,
// 亦即「山體隧道 = 舊行為」;地下道自己的幾何由 tools/audit_underpass.mjs 驗。
const emit = new Function('TUN', 'UND', 'tunnelWallProfile', 'run', 'nP', 'cum', 'total', 'at', 'hw', 'tFloorAt', 'tBaseAt',
  'covS', 'terrain', 'ceilOf', 'under', 'wall', 'galCols', 'galRoof', 'cope', 'galBores',
  `${EMIT}\nreturn { galP, galMask, floorsV, covV, galBores };`);

/** 跑一次發射器;回傳三個桶 + profile + 洞內打洞 bore */
function build(heightAt, { cov = () => true, floor = FLOOR } = {}) {
  const cum2 = pts.map((p) => p[0]);                       // 沿 +X 直線 ⇒ 弧長 = x
  const total2 = cum2[cum2.length - 1];
  const at2 = (s) => [s, 0, 1, 0];                         // 直線:弧長 s → (x=s, z=0),切線 (1,0)
  const wall = { pos: [], nrm: [], idx: [], base: 0 }, galCols = [];
  const galRoof = { pos: [], nrm: [], idx: [], base: 0 };
  const cope = { pos: [], nrm: [], idx: [], base: 0 };
  const galBores = [];
  const out = emit(TUN, UND, tunnelWallProfile, pts, pts.length, cum2, total2, at2, HW, () => floor, () => floor, cov,
    { heightAt }, (s) => floor + TUN.CLEAR, false, wall, galCols, galRoof, cope, galBores);
  return { ...out, wall, galCols, galRoof, cope, cum: cum2 };
}
const TOPY = FLOOR + TUN.CLEAR + TUN.ROOF_T;               // 頂板頂面(= ceilOf + ROOF_T)
const wallV = (b) => Array.from({ length: b.wall.pos.length / 3 }, (_, k) =>
  [b.wall.pos[k * 3], b.wall.pos[k * 3 + 1], b.wall.pos[k * 3 + 2]]);

// Ⅱ-a 深埋隧道:三個桶的產出 MUST 與舊制逐點相同(牆 = 路面−0.3 ~ 天花+0.2、無頂板無柱列)
{
  const b = build(() => TOPY + 30);
  const v = wallV(b);
  ok(v.length === pts.length * 4, `Ⅱ-a 深埋 牆頂點數 MUST 不變(實得 ${v.length})`);
  ok(v.every((p, k) => Math.abs(p[1] - (k % 2 ? FLOOR + TUN.CLEAR + 0.2 : FLOOR - 0.3)) < 1e-9),
    'Ⅱ-a 深埋 牆底/牆頂 MUST 維持舊公式(舊行為不得回歸)');
  ok(v.every((p) => Math.abs(Math.abs(p[2]) - HW) < 1e-9), 'Ⅱ-a 牆面 MUST 貼在 ±hw');
  ok(b.galRoof.idx.length === 0 && b.galCols.length === 0, 'Ⅱ-a 深埋 MUST NOT 長出頂板/柱列(白付幾何成本)');
  ok(pts.slice(0, -1).every((_, i) => b.galMask(i) === 0),
    'Ⅱ-a 深埋 gal 遮罩 MUST 全 0(slab 上傳逐位元不變、伺服器行為不漂移)');
  ok(b.galBores.length === 0, 'Ⅱ-a 深埋 MUST NOT 發洞內打洞 bore(地表恆高於天花,發了是白帳)');
}

// Ⅱ-b 山腰路(−z 山 / +z 懸崖,懸崖高 CLIFF):只有懸崖側改明隧道(矮牆 + 柱列)
const CLIFF = FLOOR - 6;
{
  const b = build((x, z) => (z < 0 ? TOPY + 25 : CLIFF));
  const [pPos, pNeg] = b.galP;                             // side +1 量 z<0(山)、side −1 量 z>0(崖)
  ok(pPos.every((g) => !g.open) && pNeg.every((g) => g.open), 'Ⅱ-b 只有懸崖側判成明隧道');
  ok(pts.slice(0, -1).every((_, i) => b.galMask(i) === 2),
    'Ⅱ-b gal 遮罩 MUST 只記懸崖側(bit2 = side −1)—— 上傳給伺服器的開放側與畫出來的同一側');
  // 牆緞帶:前半 = side +1(山側,z = −hw)、後半 = side −1(崖側,z = +hw)
  const v = wallV(b), half = pts.length * 2;
  const hill = v.slice(0, half), gal = v.slice(half);
  ok(hill.every((p, k) => Math.abs(p[1] - (k % 2 ? FLOOR + TUN.CLEAR + 0.2 : FLOOR - 0.3)) < 1e-9),
    'Ⅱ-b 山側牆 MUST 維持舊公式(單邊改制 MUST NOT 波及另一邊)');
  ok(gal.every((p) => Math.abs(p[2] - HW) < 1e-9), 'Ⅱ-b 明隧道矮牆 MUST 立在懸崖那一側');
  ok(gal.every((p, k) => (k % 2 ? Math.abs(p[1] - (FLOOR + TUN.SILL)) < 1e-9 : p[1] <= CLIFF - 0.8 + 1e-9)),
    'Ⅱ-b 矮牆:底緣沉到側坡地表之下、頂緣 = 路面 + SILL(牆上是透明可穿透的柱間開口)');
  ok(TUN.SILL + 0.5 < TUN.CLEAR, 'Ⅱ-b SILL MUST 遠低於淨空(矮牆之上真的有開口,不是換皮 facade)');
  // 頂板:水平、頂面高、半寬 = hw + EAVE、法線朝上
  const rv = Array.from({ length: b.galRoof.pos.length / 3 }, (_, k) =>
    [b.galRoof.pos[k * 3], b.galRoof.pos[k * 3 + 1], b.galRoof.pos[k * 3 + 2]]);
  const top = rv.filter((p) => Math.abs(p[1] - TOPY) < 1e-9);
  ok(rv.length > 0 && top.length > 0, 'Ⅱ-b 明隧道段 MUST 長出外露頂板');
  const roofN = Array.from({ length: b.galRoof.nrm.length / 3 }, (_, k) => b.galRoof.nrm[k * 3 + 1]);
  ok(roofN.slice(0, (pts.length - 1) * 4).every((n) => n === 1), 'Ⅱ-b 頂面法線 MUST 朝上');
  ok(top.every((p) => Math.abs(Math.abs(p[2]) - (HW + TUN.EAVE)) < 1e-9),
    `Ⅱ-b 頂板半寬 MUST = hw + EAVE(${HW + TUN.EAVE})—— 蓋過天花板小段的 hw+0.6`);
  // 簷口封邊帶 + 女兒牆:只立在明隧道側(z = +RW),自天花底面(TOPY − ROOF_T)拉到女兒牆頂
  const par = rv.filter((p) => p[1] > TOPY + 1e-9);
  ok(par.length > 0 && par.every((p) => Math.abs(p[2] - (HW + TUN.EAVE)) < 1e-9),
    'Ⅱ-b 女兒牆 MUST 只立在明隧道側的頂板邊緣');
  ok(par.every((p) => Math.abs(p[1] - (TOPY + TUN.PARAPET)) < 1e-9), 'Ⅱ-b 女兒牆高 MUST = PARAPET');
  const beam = rv.filter((p) => p[1] < TOPY - 1e-9);
  ok(beam.length > 0 && beam.every((p) => Math.abs(p[1] - (TOPY - TUN.ROOF_T)) < 1e-9
      && Math.abs(p[2] - (HW + TUN.EAVE)) < 1e-9),
    'Ⅱ-b 封邊帶底緣 MUST = 天花底面(頂板橫斷面不外露;柱頂沒進帶後緣)');
  // 柱列:只在明隧道側、連續(間距 ∈ [COL_GAP, COL_GAP+ROAD_SEG])、落地頂天、**朝向與擺位同調**(A26)
  ok(b.galCols.length >= pts.length - 2, `Ⅱ-b 開放段 MUST 長出連續柱列(實得 ${b.galCols.length} 支)`);
  ok(b.galCols.every((t) => t.z > HW), 'Ⅱ-b 柱列 MUST 站在明隧道開放側的牆線上');
  ok(b.galCols.every((t) => Math.abs(t.z) - t.d / 2 < HW + 1e-9), 'Ⅱ-b 柱內緣 MUST 埋進牆線(不留縫)');
  ok(b.galCols.every((t) => Math.abs(t.y1 - TOPY) < 1e-9 && t.y0 <= CLIFF - 0.8 + 1e-9),
    'Ⅱ-b 柱列 MUST 自矮牆底緣(落地)頂到頂板頂面(柱子真的撐著頂板)');
  ok(b.galCols.every((t, k) => k === 0 || t.x - b.galCols[k - 1].x >= TUN.COL_GAP - 1e-9),
    `Ⅱ-b 柱間距 MUST ≥ COL_GAP(${TUN.COL_GAP}m)`);
  ok(b.galCols.every((t, k) => k === 0 || t.x - b.galCols[k - 1].x <= TUN.COL_GAP + 6 + 1e-9),
    'Ⅱ-b 柱間距 MUST ≤ COL_GAP + ROAD_SEG(連續柱列,不是稀疏扶壁)');
  // 旋轉方向 MUST 與擺位方向同調:ry 的 local +X = (cos ry, −sin ry) MUST = 該側法線
  const nOpen = [b.galP[1][0].nx, b.galP[1][0].nz];
  ok(b.galCols.every((t) => Math.abs(Math.cos(t.ry) - nOpen[0]) < 1e-9 && Math.abs(-Math.sin(t.ry) - nOpen[1]) < 1e-9),
    'Ⅱ-b 柱列的 local +X(由 ry 推)MUST = 擺位用的側向法線(見全域 A26:差 90°/差正負號)');
  // 洞內打洞 bore(2026-07-31):明隧道段 MUST 發 bore(側坡地表斜穿洞內斷面,靠
  // punchPortalHoles 同一把尺清掉);相鄰 bore MUST 交疊(走廊自錨點 0.5m 起算,不交疊
  // 會留條狀殘牆);幾何欄位與 punch 契約一致(hw 同段、slope = 平直剖面 0)。
  ok(b.galBores.length > 0, 'Ⅱ-b 明隧道段 MUST 發洞內打洞 bore');
  ok(b.galBores.every((g) => g.hw === HW && Math.abs(g.slope) < 1e-9 && Math.abs(g.y - FLOOR) < 1e-9),
    'Ⅱ-b bore 幾何 MUST 對齊段剖面(hw / 路面高 / 平直 slope)');
  const covSpan = b.galBores.reduce((a, g) => a + g.depth, 0);
  ok(covSpan >= b.cum[b.cum.length - 1], 'Ⅱ-b bore 走廊總長 MUST 蓋滿明隧道段(含交疊,不留縫)');
}

// Ⅱ-c 斜向隧道:矮牆 / 頂板 / 柱列 MUST 一律沿同一組法線擺(軸向路容易矇混過關)
{
  const diag = Array.from({ length: 9 }, (_, i) => [i * 4.8, i * 3.6]);   // 切線 (0.8, 0.6)
  const nx = 0.6, nz = -0.8;                                             // side +1 的法線
  const cum2 = diag.map((_, i) => i * 6);
  const wall = { pos: [], nrm: [], idx: [], base: 0 }, galCols = [];
  const galRoof = { pos: [], nrm: [], idx: [], base: 0 };
  // 側坡:沿 side +1 法線那半邊挖低 ⇒ 只有該側是明隧道
  const heightAt = (x, z) => ((x - diag[0][0]) * nx + (z - diag[0][1]) * nz > 1 ? CLIFF : TOPY + 25);
  const cope = { pos: [], nrm: [], idx: [], base: 0 };
  const at3 = (s) => [diag[0][0] + 0.8 * s, diag[0][1] + 0.6 * s, 0.8, 0.6];
  const r = emit(TUN, UND, tunnelWallProfile, diag, diag.length, cum2, cum2[cum2.length - 1], at3, HW,
    () => FLOOR, () => FLOOR, () => true,
    { heightAt }, () => FLOOR + TUN.CLEAR, false, wall, galCols, galRoof, cope, []);
  ok(r.galP[0].every((g) => g.open) && r.galP[1].every((g) => !g.open), 'Ⅱ-c 斜向:只有低側判成明隧道');
  const off = (x, z, i) => (x - diag[i][0]) * nx + (z - diag[i][1]) * nz;   // 沿法線的側向位移
  const lat = (x, z, i) => (x - diag[i][0]) * 0.8 + (z - diag[i][1]) * 0.6; // 沿切線的位移(應為 0)
  let okWall = true;
  for (let i = 0; i < diag.length; i++) {
    const k = i * 2 * 3;                                   // 前半 = side +1
    okWall = okWall && Math.abs(off(wall.pos[k], wall.pos[k + 2], i) - HW) < 1e-9
      && Math.abs(lat(wall.pos[k], wall.pos[k + 2], i)) < 1e-9;
  }
  ok(okWall, 'Ⅱ-c 斜向矮牆 MUST 恰好沿法線外移 hw(不含切線分量)');
  ok(galCols.length > 0 && galCols.every((t) => {
    let bi = 0, bd = Infinity;                             // 最近頂點 = 該支柱的錨點
    diag.forEach((p, i) => { const d = Math.hypot(t.x - p[0], t.z - p[1]); if (d < bd) { bd = d; bi = i; } });
    return Math.abs(off(t.x, t.z, bi) - (HW + t.d / 2 - 0.15)) < 1e-9 && Math.abs(lat(t.x, t.z, bi)) < 1e-9;
  }), 'Ⅱ-c 斜向柱列 MUST 恰好貼在牆線外側(擺位無切線分量偏移)');
  ok(galCols.every((t) => Math.abs(Math.cos(t.ry) - nx) < 1e-9 && Math.abs(-Math.sin(t.ry) - nz) < 1e-9),
    'Ⅱ-c 斜向柱列朝向 MUST 仍等於側向法線');
}

// ---- Ⅲ 靜態規則(碰撞幾何不動;gal 只是註記;柱列不進碰撞柱)----
const S0 = src.indexOf('      if (strc && total > 8) {');
const S1 = src.indexOf('      // ---- 高架橋外觀', S0);
const STRC = src.slice(S0, S1);
ok(/const galP = \[1, -1\]\.map\(\(side\) => \{[\s\S]{0,400}?tunnelWallProfile\(run, floorsV, covV/.test(STRC),
  'Ⅲ 明隧道判定 MUST 走 tunnelWallProfile 單一縫');
ok(/return under \? prof\.map\(\(g\) => \(\{ \.\.\.g, open: false \}\)\) : prof;/.test(STRC),
  'Ⅲ 地下道 MUST 一律非明隧道(它的頂是沒被開挖的原地表;引道轉換帶的碗緣會讓體檢誤判)');
ok((STRC.match(/galBase\(i, g\)/g) || []).length >= 2, 'Ⅲ 矮牆緞帶與柱列 MUST 共用 galBase(各寫一份就會分家)');
ok(/galCols\.length >= TUN\.COL_MAX/.test(STRC), 'Ⅲ 柱列 MUST 吃全圖實例上限 COL_MAX');
ok(!/cols\.push/.test(STRC) && !/cols\.push\([^)]*gal/i.test(src.slice(src.indexOf('if (galCols.length)'))),
  'Ⅲ 柱列 MUST NOT 登記碰撞柱(cols)—— 伺服器 slab 開放側是整段放行,無逐柱語意,登記了就是兩端分家的隱形障礙');
{
  // tunnelSegs:gal MUST 以 `gal: galMask(i)` 註記上車;幾何欄位(座標/路面/天花/hw/by)MUST 與 gal 無關
  const i0 = STRC.indexOf('tunnelSegs.push');
  const seg = STRC.slice(i0, STRC.indexOf('});', i0));
  ok(i0 > 0 && /gal: galMask\(i\)/.test(seg), 'Ⅲ 覆蓋段 tunnelSegs MUST 附 gal 開放側註記(伺服器才知道哪一側可穿)');
  ok(!/gal/.test(seg.replace(/gal: galMask\(i\)[^\n]*/, '')),
    'Ⅲ tunnelSegs 幾何欄位 MUST 與 gal 無關(gal 只是註記,碰撞/站立/天花不得漂移)');
  const c0 = STRC.indexOf('ceilSegs.push');
  ok(c0 > 0 && !/gal|\.open/.test(STRC.slice(c0, c0 + 200)),
    'Ⅲ ceilSegs(天花)MUST NOT 吃明隧道判定 —— 頂板規則與一般隧道相同');
}
ok(!/hw = [^\n]*gal/.test(STRC), 'Ⅲ 通行寬 hw MUST NOT 隨明隧道改變(伺服器 slab / 規則 #5 不得漂移)');
ok(TUN.EAVE > 0.6, `Ⅲ TUN.EAVE(${TUN.EAVE})MUST > 天花板小段的 hw+0.6(否則天花板邊緣露在簷外)`);
// ---- Ⅲ-b 洞內淨空三消費端(2026-07-31 使用者回報「洞內石頭/地形卡住」)----
// ① 散布淨空:markGradeCorridors 的覆蓋段跳過 MUST 帶明隧道例外,判定走 tunnelWallProfile 單一縫
{
  const M0 = src.indexOf('function markGradeCorridors(');
  const M1 = src.indexOf('\nfunction buildRoads(', M0);
  const MGC = src.slice(M0, M1);
  ok(/tunnelWallProfile\(run, floorsV, covV/.test(MGC),
    'Ⅲ-b markGradeCorridors 明隧道淨空 MUST 走 tunnelWallProfile 單一縫(另寫第二份判定即分家)');
  ok(/!tw\.sink/.test(MGC), 'Ⅲ-b 地下道(tw.sink)MUST NOT 判明隧道淨空(恆非明隧道)');
  ok(/&& !galOpenAt\?\.\(i\)/.test(MGC),
    'Ⅲ-b 覆蓋段跳過淨空 MUST 帶明隧道例外(明隧道段地表斜穿洞內,照鋪地物就長在洞裡)');
}
// ② 洞內打洞:bore MUST 收進 punchPortalHoles 的**同一次**呼叫(index 壓實不可重入,
//    二次呼叫會把壓實後殘留在尾端的舊三角形掃回 index = 已刪的土牆復活)
ok((src.match(/terrain\.punchPortalHoles\(/g) || []).length === 1,
  'Ⅲ-b punchPortalHoles MUST 只呼叫一次(bore 清單合併,不重入)');
ok(/const boreRecs = \[\.\.\.portals, \.\.\.galBores\]/.test(src),
  'Ⅲ-b 洞口 + 明隧道 bore MUST 合併成同一份清單(collar 迴圈同吃)');
ok(/covV\[k\] && galAny\(k\)/.test(STRC),
  'Ⅲ-b 洞內 bore MUST 只在「覆蓋且有明隧道側」的小段發(深埋段天然 no-op,不發省帳)');
// main.js:slab 第 7 欄 MUST 上傳 gal(僅 ty=2;open 段照舊不上傳)
const upTun = /\.\.\.tunnels\.filter\(\(d\) => !d\.open\)\.map\(\(d\) => (\[[^\n]*\])\),/.exec(mainSrc);
ok(!!upTun, 'Ⅲ main.js 隧道 slab 上傳 MUST 保留 !d.open 過濾(露天路塹不是洞內)');
ok(!!upTun && /2, d\.gal \|\| 0\]$/.test(upTun[1]),
  'Ⅲ main.js 隧道 slab MUST 以第 7 欄上傳 gal 開放側遮罩(漏傳 = 伺服器照舊全擋 = 看得到打不到)');

// ---- Ⅳ 兩端可穿透(真 BattleSim 數值直測:開放側放行、實牆/天花照擋、gal=0 舊行為不變)----
// 用 main.js 抽出的**真上傳映射**把 three 座標段轉成 sim slab(z 鏡射),再對真 sim 開打:
// 側別位元「不換手」的宣稱在這裡以數值釘死(A30 的 ry 反號前科 —— 對稱性主張一律直測)。
function fakeBattleConfig() {
  const A = [25.0330, 121.5654];
  const D = 1600, R = 6371000;
  const realD = D * MAPGEO.REAL_SCALE;
  const dLat = realD / R * 180 / Math.PI;
  const B = [A[0] + dLat, A[1]];
  const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const lane = [];
  for (let t = 0; t <= 1.001; t += 0.05) lane.push([A[0] + (B[0] - A[0]) * t, A[1]]);
  const sizeM = D / (0.85 * Math.SQRT2);
  return { center: { lat: mid[0], lng: mid[1] }, bases: { SWARM: A, STEEL: B }, lanes: [lane],
    sizeM, diagM: sizeM * Math.SQRT2, distM: D, geoScaleVer: MAPGEO.GEO_SCALE_VER,
    maxOverlap: 0.05, synthetic: true, placeName: '稽核戰區',
    env: { season: 'summer', time: 'day', weather: 'clear' } };
}
{
  const rd = (v) => Math.round(v * 10) / 10;
  const mapTun = new Function('rd', 'd', `return ${upTun[1]};`);
  // three 座標:隧道沿 +X、中心線 z=10、半寬 8。切線 (1,0) ⇒ 世界 side +1 法線 = (0,−1)(z 減小側)。
  const mkSim = (gal) => {
    const sim = new BattleSim(fakeBattleConfig());
    sim._ingestSlabs({ slabs: [mapTun(rd, { x1: 0, z1: 10, x2: 100, z2: 10, hw: 8, gal })] });
    return sim;
  };
  const IN = { hero: true, lev: 2 }, OUT = { hero: true, lev: 0 };
  {
    const s = mkSim(1)._slabGrid && mkSim(1);   // gal=1:世界 side +1(three z<10 側 = sim z>−10 側)開放
    ok(!!s._slabGrid, 'Ⅳ slab 網格建立(經真 main.js 上傳映射)');
    ok(!s._slabBlocked(50, -10, 50, 20, IN, OUT), 'Ⅳ gal=1:洞內 → 開放側(世界 +1)穿出 MUST 放行(柱間看得到就打得到)');
    ok(!s._slabBlocked(50, 20, 50, -10, OUT, IN), 'Ⅳ gal=1:攻守互換同判(外 → 內經柱間)MUST 放行');
    ok(s._slabBlocked(50, -10, 50, -40, IN, OUT), 'Ⅳ gal=1:洞內 → 深埋側(世界 −1)穿出 MUST 照擋(整面牆)');
    ok(!s._slabBlocked(50, -10, 130, -10, IN, OUT), 'Ⅳ gal=1:沿軸出洞口 MUST 照放行(舊行為)');
    ok(s._slabBlocked(30, -10, 70, -10, IN, OUT), 'Ⅳ gal=1:天花正上方 ↔ 洞內(同 ribbon 層不符)MUST 照擋(頂板規則與一般隧道相同)');
    ok(!s._losBlocked(50, -10, 2, 50, 20, 2, IN, OUT), 'Ⅳ gal=1:_losBlocked 佈線 —— 開放側經 slab 路徑放行');
    // 爆風 _slabSep:柱間同判;沿軸/正上方維持隔離(A11 是水平繞射近似,不含洞口衍射)
    ok(!s._slabSep(2, 50, -10, { hero: true, lev: 0, x: 50, z: 20 }), 'Ⅳ gal=1:洞內爆心 → 開放側目標 MUST 不隔離(爆風與直擊同判)');
    ok(!s._slabSep(0, 50, 20, { hero: true, lev: 2, x: 50, z: -10 }), 'Ⅳ gal=1:開放側爆心 → 洞內目標 MUST 不隔離');
    ok(s._slabSep(2, 50, -10, { hero: true, lev: 0, x: 50, z: -40 }), 'Ⅳ gal=1:洞內爆心 → 深埋側目標 MUST 照隔離');
    ok(s._slabSep(0, 130, -10, { hero: true, lev: 2, x: 50, z: -10 }), 'Ⅳ gal=1:洞口外爆心 → 洞內目標 MUST 照隔離(沿軸舊行為)');
    ok(s._slabSep(0, 50, -10, { hero: true, lev: 2, x: 50, z: -10 }), 'Ⅳ gal=1:天花正上方爆心 → 洞內目標 MUST 照隔離');
  }
  {
    const s = mkSim(2);   // gal=2:世界 side −1(three z>10 側 = sim z<−10 側)開放 —— 位元側別鏡像釘死
    ok(!s._slabBlocked(50, -10, 50, -40, IN, OUT), 'Ⅳ gal=2:世界 −1 側 MUST 放行(側別位元在 z 鏡射下不換手)');
    ok(s._slabBlocked(50, -10, 50, 20, IN, OUT), 'Ⅳ gal=2:世界 +1 側 MUST 照擋(位元寫反會在此紅字)');
  }
  {
    const s = mkSim(0);   // gal=0(深埋):逐位元舊行為
    ok(s._slabBlocked(50, -10, 50, 20, IN, OUT) && s._slabBlocked(50, -10, 50, -40, IN, OUT),
      'Ⅳ gal=0:兩側 MUST 照擋(深埋隧道舊行為逐位元不變)');
    ok(!s._slabBlocked(50, -10, 130, -10, IN, OUT), 'Ⅳ gal=0:沿軸出洞口 MUST 照放行');
    ok(s._slabSep(2, 50, -10, { hero: true, lev: 0, x: 50, z: 20 }), 'Ⅳ gal=0:爆風洞內↔洞外 MUST 照隔離');
  }
}

// ---- Ⅴ 明隧道地形整備(2026-07-31:落石棚強制覆蓋 / 柱外淨空帶 / 敞開段殘峰開挖)----
// 以 terrain.js **執行原文**建 33² 合成高度場直測 carveTunnels / carveGalleryBands;
// biomes 端的接線(強制覆蓋 / 同 tag 併鏈 / strip 收集)以靜態規則釘住。
{
  const tsrc = readFileSync(join(ROOT, 'public', 'js', 'terrain.js'), 'utf8');
  // ---- 靜態規則 ----
  ok(/way\.tags\.tunnel === 'avalanche_protector' && tot >= TUN_COV_MIN/.test(src),
    'Ⅴ tunnel=avalanche_protector MUST 整段強制覆蓋(落石棚的頂是建的不是山;短殘段仍剔)');
  ok(/kind !== 'tunnel' \|\| a\.tags\?\.tunnel === b\.tags\?\.tunnel/.test(src),
    'Ⅴ 隧道鏈 MUST 同 tunnel 值才併(混併 = 強制覆蓋旗標被種子 way 的 tags 吃掉)');
  ok((src.match(/terrain\.carveGalleryBands\(/g) || []).length === 1,
    'Ⅴ carveGalleryBands MUST 只有一個呼叫端(與 carveTunnels 同批、開挖前判定)');
  ok(/tunnelWallProfile\(pts, floors, covV2, hAt, hwWay, side\)/.test(src),
    'Ⅴ 淨空帶 strip MUST 走 tunnelWallProfile 單一縫(開挖前高度)');
  ok(src.indexOf('galStrips.push') < src.indexOf('terrain.carveTunnels(tunnelRuns'),
    'Ⅴ strip 收集 MUST 在 carveTunnels 執行之前(整批用開挖前高度判定)');
  // ---- 執行原文:carveTunnels / carveGalleryBands ----
  const c0 = tsrc.indexOf('  const CUT_W = 2.5;');
  const cEnd = tsrc.indexOf('function punchPortalHoles');
  const c1 = tsrc.lastIndexOf('/**', cEnd);
  if (c0 < 0 || c1 <= c0) throw new Error('找不到 terrain 開挖區塊');
  const CARVE = tsrc.slice(c0, c1);
  const N2 = 33, MINX = -80, MAXX = 80, MINZ = -80, MAXZ = 80;   // 格距 5m
  const mkTerr = (hf) => {
    const heights = new Float32Array(N2 * N2);
    for (let i = 0; i < N2; i++) for (let j = 0; j < N2; j++) {
      heights[i * N2 + j] = hf(MINX + (MAXX - MINX) * j / (N2 - 1), MINZ + (MAXZ - MINZ) * i / (N2 - 1));
    }
    const geo = { getAttribute: () => ({ array: new Float32Array(N2 * N2 * 3) }), computeVertexNormals() {} };
    const fns = new Function('N', 'minX', 'maxX', 'minZ', 'maxZ', 'heights', 'geo', 'imagery', 'mat', 'WATER', 'heightAt',
      `${CARVE}\nreturn { carveTunnels, carveGalleryBands, gradeRoadBeds, carvedAt: (k) => !!carvedNodes?.[k] };`)(
      N2, MINX, MAXX, MINZ, MAXZ, heights, geo, null, null, { LEVEL: -9999, SWAMP_BAND: 0 },
      (x, z) => heights[Math.round((z - MINZ) / 5) * N2 + Math.round((x - MINX) / 5)]);
    const at = (x, z) => heights[Math.round((z - MINZ) / 5) * N2 + Math.round((x - MINX) / 5)];
    return { heights, at, ...fns };
  };
  const FLOOR2 = 20, ROOFTOP = FLOOR2 + TUN.CLEAR + TUN.ROOF_T;
  const runPts = []; for (let x = -60; x <= 60; x += 6) runPts.push([x, 0]);
  const runFloors = runPts.map(() => FLOOR2);
  // Ⅴ-a 敞開段殘峰:高過門檻的節點 MUST 在 run 內部被無條件開挖;覆蓋端斜壁帶維持舊判準
  {
    const t = mkTerr((x, z) => {
      if (Math.abs(x) < 3 && Math.abs(z) < 3) return 45;            // run 內部殘峰(≥ 門檻)
      if (Math.abs(x - 55) < 3 && Math.abs(z) < 3) return 45;       // 覆蓋端保護帶內、路廊上的殘峰
      if (Math.abs(x - 55) < 3 && Math.abs(z - 15) < 3) return 45;  // 覆蓋端保護帶內、斜壁帶的轉換崖
      return FLOOR2 + 2;                                            // 其餘:略高於路面(舊判準本來就挖)
    });
    t.carveTunnels([{ pts: runPts, floors: runFloors, hw: 8, covA: false, covB: true }], { clear: TUN.CLEAR, hw: TUN.HW });
    ok(Math.abs(t.at(0, 0) - FLOOR2) < 1e-6, 'Ⅴ-a run 內部殘峰 MUST 被無條件開挖到路面(否則是一道橫在路上的岩牆)');
    ok(Math.abs(t.at(55, 0) - FLOOR2) < 1e-6, 'Ⅴ-a 覆蓋端保護帶內的**路廊**殘峰 MUST 照挖(崖可以留在路旁,不可以橫在路上)');
    ok(Math.abs(t.at(55, 15) - 45) < 1e-6, 'Ⅴ-a 覆蓋端保護帶內的**斜壁帶**轉換崖 MUST 保留(門洞打洞 + collar 的基準面)');
    ok(Math.abs(t.at(0, 25) - (FLOOR2 + 2)) < 1e-6, 'Ⅴ-a 走廊外 MUST 不動');
  }
  // Ⅴ-b 深埋不變式:全程低於門檻的地形,新舊規則 MUST 逐位元同結果(路廊壓到路面)
  {
    const t = mkTerr(() => FLOOR2 + 5);
    t.carveTunnels([{ pts: runPts, floors: runFloors, hw: 8, covA: true, covB: true }], { clear: TUN.CLEAR, hw: TUN.HW });
    ok(Math.abs(t.at(0, 0) - FLOOR2) < 1e-6 && Math.abs(t.at(0, 5) - FLOOR2) < 1e-6,
      'Ⅴ-b 低於門檻的走廊 MUST 照舊全深開挖(新內部規則對舊行為零擾動)');
  }
  // Ⅴ-c 柱外淨空帶:開放側 [hw−0.5, hw+GAL_CLEAR_W] 的土脊 MUST 開到路面;外緣 taper;
  //      對側/帶外/strip 端外/低於路面 MUST 不動(只降不升)
  {
    const berm = (z) => (z < -7 && z > -18 ? FLOOR2 + 4 : FLOOR2 - 6);
    const t = mkTerr((x, z) => (z < -5 ? berm(z) : ROOFTOP + 20));   // z<0 = side +1(臨谷側);z>0 山體
    const stripPts = []; for (let x = -30; x <= 30; x += 6) stripPts.push([x, 0]);
    t.carveGalleryBands([{ pts: stripPts, floors: stripPts.map(() => FLOOR2), hw: 8, side: 1 }],
      { clear: TUN.CLEAR, roofT: TUN.ROOF_T, clearW: TUN.GAL_CLEAR_W });
    ok(Math.abs(t.at(0, -10) - FLOOR2) < 1e-6, 'Ⅴ-c 開放側帶內土脊 MUST 開挖到路面(柱間不再是一面土牆)');
    ok(t.at(0, -15) < FLOOR2 + 4 - 0.5 && t.at(0, -15) > FLOOR2, 'Ⅴ-c 外緣 3m MUST smoothstep 收回原地表(不留直角土階)');
    ok(Math.abs(t.at(0, 10) - (ROOFTOP + 20)) < 1e-6, 'Ⅴ-c 山體側 MUST 毫髮無傷(岩背不進 strip)');
    ok(Math.abs(t.at(0, -25) - (FLOOR2 - 6)) < 1e-6, 'Ⅴ-c 帶外 MUST 不動');
    ok(Math.abs(t.at(45, -10) - berm(-10)) < 1e-6, 'Ⅴ-c strip 端外 MUST 不動(端帽不外溢,轉換崖不被蝕)');
    // 只降不升:路面高於帶內地表時 MUST 不填(openness 對這刀穩定的前提)
    const t2 = mkTerr((x, z) => FLOOR2 - 3);
    t2.carveGalleryBands([{ pts: stripPts, floors: stripPts.map(() => FLOOR2), hw: 8, side: 1 }],
      { clear: TUN.CLEAR, roofT: TUN.ROOF_T, clearW: TUN.GAL_CLEAR_W });
    ok(Math.abs(t2.at(0, -10) - (FLOOR2 - 3)) < 1e-6, 'Ⅴ-c 帶內低於路面 MUST 不動(只降不升,不憑空長路堤)');
  }
}

console.log(`\n明隧道稽核:${pass} 綠 / ${fail} 紅`);
process.exit(fail ? 1 : 0);
