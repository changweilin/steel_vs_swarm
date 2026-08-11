// 地貌界線拼圖(2026-08-11 使用者需求)稽核 —— node tools/audit_ground_border.mjs
// 使用者定案:「不同類型大面積地貌區塊之間的邊界,透過設計 16 個方向的直線/轉彎/岔路的
// 拼圖可以組合拼接,作為地貌類型的分界(拼圖概念類似卡卡頌),地貌界線拼圖可以採用
// 步道小徑/林道/碎石土徑/田埂/水溝/小溪/圍籬/灌木矮牆/沙灘/岩塊/紅樹林等自然或人工
// 分界線作為專屬拼貼圖案,不同類型的分界線可接力連結」。
// 系統形狀(ground.js):
//   BORDER_KINDS(11 種分界線型錄)+ BORDER_STYLES(coarse 無序對)+ BORDER_SUB_RULES
//   (地表級覆寫)+ borderKindOf(解析唯一縫)+ planBorderPuzzle(純函式規劃:邊界邊 →
//   角點圖成鏈 → 16 方向貪婪量化,切點恆錨定共享角點 → tile/岔路)。
// 本稽核「執行 ground.js 真正的原文」(全部 export 零依賴,抽原文 eval):
//   Ⅰ 型錄與種類解析(11 種名冊 / 樣式表值域 / 對稱 / 水界貼水 / sub 覆寫與市區豁免)
//   Ⅱ 拼圖拓撲(直線交界單鏈全覆蓋 / 變體不成界 / 崖不成界 / 孤島閉環 / 岔路三臂共點
//      / 鏈內接力切點 / 邊覆蓋恰一次 / 決定性)
//   Ⅲ 16 方向量化(抖動角點:弦方位落格 ≤ 半格 11.25° / drift ≤ 上限 / 直段壓縮 /
//      轉彎 = bin 改變 / 相鄰 tile 端點逐位元共用)
//   Ⅳ 對照組(反向驗證內建):ⓐ bin 摺疊 ⓑ 拿掉 drift 上限 ⓒ 拿掉接力切分
//   Ⅴ 靜態接線(單一縫 / 舊遮蔽物不回歸 / 純函式零 rnd / lift 與 renderOrder 圖層紀律)
'use strict';
import { readSrc } from './audit_src.mjs';

let fail = 0;
const bad = (m) => { console.log('  ✗', m); fail++; };
const ok = (m) => console.log('  ✓', m);

const src = readSrc('public', 'js', 'ground.js');

// ===== 抽原文(零依賴 → eval 執行真品)=====
const dirsM = src.match(/export const BORDER_DIRS = .*$/m);
const kindsM = src.match(/export const BORDER_KINDS = \{[\s\S]*?\n\};/);
const stylesM = src.match(/export const BORDER_STYLES = \{[\s\S]*?\n\};/);
const rulesM = src.match(/export const BORDER_SUB_RULES = \[[\s\S]*?\n\];/);
const kindOfM = src.match(/export function borderKindOf\(subA, subB, za, zb\) \{[\s\S]*?\n\}/);
const arcM = src.match(/export function borderCornerArc\(px, pz, ax, az, bx, bz, Lmax, hw\) \{[\s\S]*?\n\}/);
const planM = src.match(/export function planBorderPuzzle\(keys, gnx, gnz, opts = \{\}\) \{[\s\S]*?\n\}/);
if (!dirsM || !kindsM || !stylesM || !rulesM || !kindOfM || !arcM || !planM) {
  bad('ground.js 找不到 BORDER_DIRS / BORDER_KINDS / BORDER_STYLES / BORDER_SUB_RULES / borderKindOf / borderCornerArc / planBorderPuzzle 原文');
  console.log(`\nFAIL(${fail} 項)`); process.exit(1);
}
const build = (planText, arcText = arcM[0]) => new Function(`
  ${dirsM[0].replace('export ', '')}
  ${kindsM[0].replace('export ', '')}
  ${stylesM[0].replace('export ', '')}
  ${rulesM[0].replace('export ', '')}
  ${kindOfM[0].replace('export ', '')}
  ${arcText.replace('export ', '')}
  ${planText.replace('export ', '')}
  return { BORDER_DIRS, BORDER_KINDS, BORDER_STYLES, BORDER_SUB_RULES, borderKindOf, borderCornerArc, planBorderPuzzle };
`)();
const { BORDER_DIRS, BORDER_KINDS, BORDER_STYLES, BORDER_SUB_RULES, borderKindOf, borderCornerArc, planBorderPuzzle } = build(planM[0]);
const truthCarpet = new Function(src.match(/const CARPET = \{[\s\S]*?\n\};/)[0] + '\nreturn CARPET;')();

// ===== 工具 =====
const grid = (gnx, gnz, fn) => {
  const keys = new Array(gnx * gnz).fill(null);
  for (let j = 0; j < gnz; j++) for (let i = 0; i < gnx; i++) keys[j * gnx + i] = fn(i, j);
  return keys;
};
// 稽核用 coarse 分區替身(吃整支 key 'sub#v')
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
  // ① 11 種名冊 = 使用者原句逐項(不多不少)
  const WANT = ['trail', 'forestroad', 'gravelpath', 'fieldridge', 'ditch', 'stream',
                'fence', 'hedgerow', 'beach', 'rocks', 'mangrove'];
  const got = Object.keys(BORDER_KINDS);
  (got.length === WANT.length && WANT.every((k) => got.includes(k)))
    ? ok(`BORDER_KINDS = 使用者定案的 11 種分界線(步道小徑…紅樹林),不多不少`)
    : bad(`BORDER_KINDS 鍵集 ${JSON.stringify(got)} ≠ 定案 11 種`);
  Object.values(BORDER_KINDS).every((k) => k.name && (k.flat || k.ridge)
      && (!k.flat || (k.flat.w > 0 && k.flat.tex)) && (!k.ridge || (k.ridge.w > 0 && k.ridge.h > 0)))
    ? ok('每種都有 flat(w/tex)或 ridge(w/h)幾何定義')
    : bad('BORDER_KINDS 有型錄列缺幾何定義');
  BORDER_DIRS === 16 ? ok('BORDER_DIRS = 16(與道路 16 方向量化同語彙)')
    : bad(`BORDER_DIRS = ${BORDER_DIRS} ≠ 16`);

  // ② 樣式表值域 + 「同地貌不畫線」+ 跨地貌全覆蓋
  const ZS = ['alpine', 'bare', 'green', 'urban', 'water', 'wet'];
  Object.entries(BORDER_STYLES).every(([k, v]) => {
    const [a, b] = k.split('|');
    return ZS.includes(a) && ZS.includes(b) && a < b && BORDER_KINDS[v];
  }) ? ok('BORDER_STYLES 鍵 = 已排序且**相異**的地貌對、值全在型錄內')
    : bad('BORDER_STYLES 鍵/值越界(或殘留同地貌列)');
  ZS.every((z) => !BORDER_STYLES[`${z}|${z}`])
    ? ok('表內無任何同地貌列(2026-08-11 定案:兩側相同地貌不需要分界線)')
    : bad('BORDER_STYLES 殘留同地貌列');
  // 跨地貌 15 對 MUST 全數有解 —— 沒有哪一種地貌交界是畫不出來的
  const REP0 = { green: 'turf', bare: 'wild', urban: 'concrete', wet: 'marsh', water: 'watertile', alpine: 'plateau' };
  const miss = [];
  for (let a = 0; a < ZS.length; a++) for (let b = a + 1; b < ZS.length; b++) {
    if (!borderKindOf(REP0[ZS[a]], REP0[ZS[b]], ZS[a], ZS[b])) miss.push(`${ZS[a]}|${ZS[b]}`);
  }
  miss.length === 0 ? ok('15 個跨地貌對全數解得出分界線(無遺漏)')
    : bad(`跨地貌對缺解:${miss.join(' ')}`);

  // ③ 對稱:交換兩側回傳相同(全分區對 × 代表地表)
  const REP = { green: 'turf', bare: 'wild', urban: 'concrete', wet: 'marsh', water: 'watertile', alpine: 'plateau' };
  let sym = true;
  for (const za of ZS) for (const zb of ZS) {
    if (borderKindOf(REP[za], REP[zb], za, zb) !== borderKindOf(REP[zb], REP[za], zb, za)) sym = false;
  }
  sym ? ok('borderKindOf 對稱(交換兩側回傳相同)') : bad('borderKindOf 不對稱');

  // ④ 水界一律貼水種類(aq):沙灘/岩塊/紅樹林
  let aqOk = true;
  for (const z of ZS) {
    const k = borderKindOf(REP[z], 'watertile', z, 'water');
    if (k && !BORDER_KINDS[k].aq) aqOk = false;
  }
  aqOk ? ok('凡含水域的交界解出的種類全帶 aq(圍籬不會站進水裡)')
    : bad('水界解出非貼水種類');

  // ⑤ sub 覆寫:竹林→林道、花田→田埂、沙→沙灘;市區界豁免(人工界優先)
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
  // `vs` 不得含該 sub 自己的地貌 —— 同地貌不畫線,列進去是永遠不命中的死設定
  const SUBZ0 = Object.fromEntries(Object.entries(truthCarpet).flatMap(([z, l]) => l.map((s) => [s, z])));
  BORDER_SUB_RULES.every((r) => !r.vs.includes(SUBZ0[r.sub]))
    ? ok('BORDER_SUB_RULES 的 vs 一律不含自身地貌(無死設定)')
    : bad(`vs 含自身地貌:${BORDER_SUB_RULES.filter((r) => r.vs.includes(SUBZ0[r.sub])).map((r) => r.sub).join(' ')}`);

  // ⑥ 同地貌 / 分區未知 → null(寧缺勿錯)
  (borderKindOf('turf', 'meadow', 'green', 'green') === null
    && borderKindOf('arrowbamboo', 'turf', 'green', 'green') === null
    && borderKindOf('wild', 'sand', 'bare', 'bare') === null)
    ? ok('同地貌恆回 null(含 sub 覆寫也擋掉)= 結構保證,不靠查表查不到')
    : bad('同地貌仍解出分界線(密集網狀的成因)');
  (borderKindOf('a', 'b', null, 'green') === null && borderKindOf('a', 'b', 'green', null) === null)
    ? ok('分區未知回 null(不擺,寧缺勿錯)') : bad('分區未知未回 null');
}

console.log('== Ⅱ 拼圖拓撲(planBorderPuzzle 執行原文;恆等角點)==');
{
  const N = 8;
  // driftMax 鏡射發射端比率(cell × 0.6;恆等角點 1 單位 = 1 格)——
  // 90° 轉角的內點垂距 0.707 > 0.6 ⇒ 轉角不會被併進直段
  const opt = { coarseOf, driftMax: 0.6 };
  // ① 直線交界:左半草皮、右半荒野 → 單鏈、單 tile(共線全併)、全覆蓋
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

  // ② 同地表異變體:花紋連續,不成界
  allTiles(planBorderPuzzle(grid(N, N, (i) => i < 4 ? 'turf#0' : 'turf#1'), N, N, opt)).length === 0
    ? ok('同地表異變體不成界(變體只是換款花紋)') : bad('異變體誤生分界');

  // ③ 崖 '!' / 未鋪 null 不成界
  const kCliff = grid(N, N, (i) => i < 3 ? 'turf#0' : i === 3 ? '!' : 'wild#0');
  allTiles(planBorderPuzzle(kCliff, N, N, opt)).length === 0
    ? ok("崖('!')隔開的兩地表不成界(交由外溢淡出)") : bad('崖界誤生分界');
  const kNull = grid(N, N, (i) => i < 3 ? 'turf#0' : i === 3 ? null : 'wild#0');
  allTiles(planBorderPuzzle(kNull, N, N, opt)).length === 0
    ? ok('未鋪(null)隔開的兩地表不成界') : bad('未鋪界誤生分界');

  // ④ 孤島 2×2:閉環、四片、四轉彎、端點閉合
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

  // ⑤ 岔路:左草皮、右上荒野、右下市區 → (4,4) 度數 3,三臂三種分界線共點接力
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

  // ⑥ 鏈內接力:注入 kindOf(B|C 無界)→ 一條鏈上兩種分界線,切點恰在 (4,4)
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

  // ⑦ 邊覆蓋恰一次(雜湊四地貌格網):鏈節點序展開的邊集 = 獨立重算的邊界邊集
  const POOL = ['turf#0', 'wild#0', 'concrete#0', 'marsh#0', '!', null];
  const kR = grid(12, 12, (i, j) => POOL[((i * 7 + j * 13 + ((i * j) % 5)) % 11) % POOL.length]);
  const pRnd = planBorderPuzzle(kR, 12, 12, opt);
  const NKW = 14;                        // 節點鍵步幅 = gnx + 2(鏡射原文)
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

  // ⑧ 決定性:同輸入重呼位元相同
  JSON.stringify(planBorderPuzzle(kR, 12, 12, opt)) === JSON.stringify(planBorderPuzzle(kR, 12, 12, opt))
    ? ok('同輸入重呼結果位元相同(§2.3 跨客戶端一致)') : bad('重呼結果不一致');
}

console.log('== Ⅲ 16 方向量化(抖動角點)==');
// 抖動角點替身(語意同 ground.js cornerAt:純 (i,j) 函數、幅度 <0.5 格拓撲不翻面)
const jitXZ = (ci, cj) => [
  ci + 0.4 * Math.sin(ci * 12.9898 + cj * 78.233),
  cj + 0.4 * Math.cos(ci * 26.651 + cj * 43.71),
];
const DRIFT = 0.6;
{
  const N = 24;
  const keys = grid(N, N, (i, j) => i + j < N ? 'turf#0' : 'wild#0');   // 45° 階梯交界
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
// 半寬取型錄真值;**取樣框也要用真實尺度**(執行期 cell ≈ 13m)—— 拿格單位當公尺會讓
// 每一條帶都比格子還寬,轉彎全數退圓帽,圓弧那一段等於沒驗到
const HW = Object.fromEntries(Object.entries(BORDER_KINDS).map(([k, d]) =>
  [k, Math.max(d.flat ? d.flat.w / 2 : 0, d.ridge ? d.ridge.w / 2 : 0)]));
const CELL_M = 13;
const jitM = (ci, cj) => { const [x, z] = jitXZ(ci, cj); return [x * CELL_M, z * CELL_M]; };
const OPT_J = { coarseOf, cornerXZ: jitM, driftMax: DRIFT * CELL_M, halfWidthOf: (k) => HW[k] ?? 1 };
{
  const N = 24;
  // 45° 階梯交界(轉彎多)+ 三分區交點鏈(岔路)
  const keys = grid(N, N, (i, j) => i + j < N ? 'turf#0' : 'wild#0');
  const plan = planBorderPuzzle(keys, N, N, OPT_J);
  const ts = allTiles(plan);

  // ① 每個轉彎都有一片接頭拼圖(bin 改變 ⇒ 必有 corner)
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

  // ② 直段一律自接頭退縮 ⇒ 接頭那段空間專屬接頭拼圖(這就是「不直接黏接」的結構保證)
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

  // ③ 切點錨定:接頭的兩個切點 = 兩側直段退縮後的端點(逐位元)⇒ 零開縫、零重疊
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

  // ④ 圓弧接頭:真的與兩臂相切(切點在圓上、切線方向 = 臂向)⇒ 圖案彎過去而非折過去
  const arcs = plan.corners.filter((c) => c.geo.mode === 'arc');
  let tang = true, radOk = true;
  for (const c of arcs) {
    const g = c.geo;
    for (const [P, arm] of [[g.Pa, c.a], [g.Pb, c.b]]) {
      const rx = P[0] - g.cx, rz = P[1] - g.cz;
      if (Math.abs(Math.hypot(rx, rz) - g.R) > 1e-6) radOk = false;
      // 切線 ⊥ 半徑 ⇒ 臂向與半徑的內積必須是 0
      if (Math.abs((rx * arm.dx + rz * arm.dz) / g.R) > 1e-6) tang = false;
    }
    if (!(g.R > c.hw * 1.1 - 1e-9)) radOk = false;      // 內緣不翻面
  }
  (arcs.length && radOk) ? ok(`圓弧接頭 ${arcs.length} 片:切點在圓上且 R > 1.1·半寬(內緣不翻面)`)
    : bad(arcs.length ? '圓弧半徑/切點不合' : '沒有任何圓弧接頭');
  tang ? ok('圓弧在兩個切點都與臂向相切(圖案順著彎過去)') : bad('圓弧與臂不相切 ⇒ 轉角會折斷');

  // ⑤ 圓弧 / 圓帽的分流判準:兩者都以「實際用的退縮長 L」對上「圓弧所需的 Lneed」
  //    圓弧 ⇒ L ≥ Lneed(放得下);圓帽 ⇒ L < Lneed(真的容不下,不是偷懶的預設)
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

  // ⑥ 純接力(同方向格換款)不生轉彎拼圖、也不退縮
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

  // ⑦ 岔路:逐臂等距斷面 + 逆時針排序 + 全臂退縮(逐臂楔形才拼得起來)
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

  // ⑧ borderCornerArc 直測:退縮長回傳一致、直線退化、決定性
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

console.log('== Ⅳ 對照組(反向驗證內建:壞版本必須被抓到)==');
{
  const N = 24;
  const keys = grid(N, N, (i, j) => i + j < N ? 'turf#0' : 'wild#0');
  const opt = { coarseOf, cornerXZ: jitXZ, driftMax: DRIFT };
  // ⓐ bin 摺疊成 4 方向 → Ⅲ 的落格檢查必須有牙
  const binBad = planM[0].replace('const STEP = (Math.PI * 2) / BORDER_DIRS;', 'const STEP = (Math.PI * 2) / 4;');
  if (binBad === planM[0]) bad('對照組 ⓐ 替換點失配(原文已漂移,請同步稽核)');
  else {
    const ts = allTiles(build(binBad).planBorderPuzzle(keys, N, N, opt));
    ts.some((t) => angDiff(Math.atan2(t.z1 - t.z0, t.x1 - t.x0), t.bin * ANG) > ANG / 2 + 1e-9)
      ? ok('對照組ⓐ:4 方向壞版本確實違反 16 方向落格(Ⅲ 檢查有牙)')
      : bad('對照組ⓐ:壞版本未呈現預期缺陷(Ⅲ 驗不到東西)');
  }
  // ⓑ 拿掉貪婪延伸的 drift 上限 → 誠實重算的 drift 必須爆表
  const driftBad = planM[0].replace('if (d > driftMax) { fit = false; break; }', 'if (false) { fit = false; break; }');
  if (driftBad === planM[0]) bad('對照組 ⓑ 替換點失配(原文已漂移,請同步稽核)');
  else {
    const ts = allTiles(build(driftBad).planBorderPuzzle(keys, N, N, opt));
    ts.some((t) => t.drift > DRIFT + 1e-9)
      ? ok('對照組ⓑ:無上限壞版本的 tile drift 超限(誠實重算與 Ⅲ 檢查有牙)')
      : bad('對照組ⓑ:壞版本未呈現預期缺陷(Ⅲ 驗不到東西)');
  }
  // ⓓ 拿掉直段退縮(接頭端 tr=0)→ Ⅵ-② / Ⅵ-③ 的「不直接黏接」保證必須有牙
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
  // ⓔ 圓弧接頭退化成直線(等同把兩段直帶對接)→ Ⅵ-① 必須有牙
  const noArc = arcM[0].replace('if (phi < 1e-4) return', 'if (true) return');
  if (noArc === arcM[0]) bad('對照組 ⓔ 替換點失配(原文已漂移,請同步稽核)');
  else {
    const p = build(planM[0], noArc).planBorderPuzzle(keys, N, N, OPT_J);
    p.corners.length === 0
      ? ok('對照組ⓔ:轉彎不生接頭拼圖的壞版本 corners 全空(Ⅵ-① 有牙)')
      : bad('對照組ⓔ:壞版本仍生出接頭(Ⅵ-① 驗不到東西)');
  }
  // ⓒ 拿掉接力切分(整鏈一種)→ Ⅱ-⑥ 的鏈內接力必須有牙
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
  // 「直接黏接」的兩個舊作法 MUST NOT 回歸
  (!/if \(j0\) \{ ax -= ux \* w2/.test(src) && !src.includes('emitRidgeT'))
    ? ok('舊制「脊端外延半寬互搭」已退場(轉彎改由掃掠圓弧的完整拼圖表達)')
    : bad('脊端外延的黏接手法殘留');
  (!src.includes('岔路拼圖:節點墊片') && !/const R = w \* 0\.8, lift/.test(src))
    ? ok('舊制「岔路圓盤墊片」已退場(改逐臂楔形,各臂帶自己的圖案)')
    : bad('岔路墊片殘留');
  (src.includes('const [path, len] = linePath(tl)') && src.includes('arcPath(g, s0, s1)'))
    ? ok('直段與轉彎共用同一支掃掠(linePath / arcPath 只換中心線)')
    : bad('轉彎未走共用掃掠(可能另寫了對接幾何)');
  src.includes('halfWidthOf: (k)')
    ? ok('發射端把型錄半寬注入規劃器(接頭退縮量由真實帶寬推導,不手寫)')
    : bad('規劃器未取得帶寬 ⇒ 退縮量與帶寬脫鉤');
  src.includes('zoneOf: (i, j) => zoneGrid[j * gnx + i]')
    ? ok('地貌取 zoneGrid(格子自己的分區),不由款式反查(steppe/scree 兩屬會誤判高地)')
    : bad('未傳 zoneOf ⇒ 高地內部會長出假的跨地貌界線');
  // 讓路判定:直段與接頭 MUST 同一支(接頭只驗節點 = 分界線會橫過馬路)
  (/const tileRuns = \(tl, aq, hw\)/.test(src) && /const cornerOk = \(cor, aq\)/.test(src)
    && /const forkOkAt = \(fk\)/.test(src) && src.includes('for (const a of fk.arms)'))
    ? ok('轉彎沿弧取樣、岔路逐臂取樣:讓路判定與直段共用 ptOk/segOk(單一縫)')
    : bad('接頭未做逐點讓路判定 ⇒ 分界線會壓過道路走廊');
  // 讓路 MUST 逐段:整片一個布林的話,900m 直線交界上任何一處停車場會讓整條線消失
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
  // 發射端零共享 rnd(§2.3):佈局與外觀差異一律由 seed + 節點索引雜湊決定
  const emitM = src.match(/==== 地貌界線拼圖發射[\s\S]*?\n  \}\n\n  \/\/ ---- 特徵色塊 Mesh/);
  emitM && !/\brnd\(/.test(emitM[0])
    ? ok('發射端零共享 rnd() 消耗(佈局不推移其他散布,§2.3)')
    : bad(emitM ? '發射端消耗了共享 rnd()' : '找不到發射端區塊(標題漂移,請同步稽核)');
  // lift 帶與 renderOrder 圖層紀律
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

console.log(fail ? `\nFAIL(${fail} 項)` : '\nALL PASS');
process.exit(fail ? 1 : 0);
