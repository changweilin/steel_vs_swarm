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
//   Ⅵ 分界線帶內強制乾地(2026-08-13 使用者「確保水域/沼澤在分界線的區塊內不會觸發異常
//     狀態」)—— 底毯的換手在**畫出來的那條線**上,而 terrainEnvCode 量的是真實地形,兩者
//     最多差半個帶寬(最寬 9m):你站在沙灘的圖案上,伺服器算的卻是泡在水裡。遮罩由
//     ground.js `bandDryAt` 產出、biomes.terrainEnvCode 消費、main.js 在 buildBiomes
//     **之後**裝上 —— 裝早了就是「界線改分區、分區又改界線」的循環,而症狀是同一張圖每次
//     建出來都不一樣(每一格都還是「照規則」選的,沒有任何既有斷言看得見)。
// 2026-08-13 另一項:同地貌之間「顏色劇烈變化」也畫線(Ⅰ⑥;窄門 = CARPET_DE.LINE)。
'use strict';
import { readSrc } from './audit_src.mjs';

let fail = 0;
const bad = (m) => { console.log('  ✗', m); fail++; };
const ok = (m) => console.log('  ✓', m);

// 反向驗證:`--break-de` 把同地貌色距門檻推到 +∞(= 退回 2026-08-11 的「同地貌恆不畫線」)
// ⇒ Ⅰ⑥ 的「顏色劇烈變化處有線」與「跨門檻相鄰對 > 0」MUST 紅字
const BREAK_DE = process.argv.includes('--break-de');
const src0 = readSrc('public', 'js', 'ground.js');
const src = BREAK_DE
  ? src0.replace(/export const CARPET_DE = \{ LINE: \d+ \};/, 'export const CARPET_DE = { LINE: Infinity };')
  : src0;
if (BREAK_DE && src === src0) {
  console.log('x --break-de 替換無效(CARPET_DE 原文樣式漂移)—— 這一支會假綠,請同步稽核');
  process.exit(1);
}

// ===== 抽原文(零依賴 → eval 執行真品)=====
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
// 2026-08-13 追加:同地貌之間「顏色劇烈變化」也畫線 ⇒ borderKindOf 多吃三份資料
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
// 畫筆名冊(逐頂層方法名抽,不 eval 整包 canvas 程式碼)
const paintersM = src.match(/const BORDER_PAINTERS = \{[\s\S]*?\n\};/);
const PAINTERS = paintersM ? [...paintersM[0].matchAll(/\n  (\w+)\(g, S, rnd\)/g)].map((m) => m[1]) : [];

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
  // 2026-08-13 追加泥灘(使用者「水域與沼澤的分界使用專屬的泥地過渡帶」);紅樹林沒有被撤掉,
  // 它退到 BORDER_SUB_RULES 的蓮花池↔水域那一格
  const WANT = ['trail', 'forestroad', 'gravelpath', 'fieldridge', 'ditch', 'stream',
                'fence', 'hedgerow', 'beach', 'mudflat', 'rocks', 'mangrove'];
  const got = Object.keys(BORDER_KINDS);
  (got.length === WANT.length && WANT.every((k) => got.includes(k)))
    ? ok(`BORDER_KINDS = 使用者定案的 ${WANT.length} 種分界線(步道小徑…紅樹林),不多不少`)
    : bad(`BORDER_KINDS 鍵集 ${JSON.stringify(got)} ≠ 定案 ${WANT.length} 種`);
  // 過渡型(兩側是不同性質的東西)MUST 標 wet 且 MUST 是貼水種類 —— 該標而沒標、或標了卻把
  // 圖案畫成對稱,症狀都是「分界線的兩側看起來是同一種區域」(使用者 2026-08-13 回報)
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
  // 2026-08-11 使用者定案「分界線可以粗一點、上面的圖畫可以更細緻」⇒ **每一種都要有貼地帶**:
  // 貼地帶才是界線本體(看得出圖案 / 蓋住 13m 格網被拉直時跳過的那段真實界線 / 兩側地貌在它
  // 底下換手)。純立體脊只有一根細桿 = 使用者說的「意義不明的線條」
  const noFlat = Object.entries(BORDER_KINDS).filter(([, d]) => !d.flat).map(([k]) => k);
  noFlat.length === 0
    ? ok('每一種分界線都有貼地帶(純立體脊不成界;脊只是加在帶上的擺件)')
    : bad(`缺貼地帶的種類:${noFlat.join(' ')}`);
  // 帶寬 MUST 蓋得住量化位移半徑之外還讀得出圖案:下限錨在「兩台機體並肩」= SOLDIER_H×2
  const thin = Object.entries(BORDER_KINDS).filter(([, d]) => d.flat.w < 3);
  thin.length === 0 ? ok('每一種貼地帶寬 ≥ 3m(遠看仍讀得出是一條有圖案的界線)')
    : bad(`帶太窄:${thin.map(([k, d]) => `${k} ${d.flat.w}`).join(' ')}`);
  // 畫筆鍵是**有消費端的欄位**:borderTex 取 BORDER_KINDS[kind].flat.tex 去查 BORDER_PAINTERS,
  // MUST NOT 退回「拿種類名當畫筆鍵」(那讓 tex 變成改了也不會有人報錯的裝飾欄位)
  const noTex = Object.entries(BORDER_KINDS).filter(([, d]) => !PAINTERS.includes(d.flat.tex)).map(([k]) => k);
  (PAINTERS.length >= Object.keys(BORDER_KINDS).length && noTex.length === 0)
    ? ok(`每一種的 flat.tex 都在 BORDER_PAINTERS 名冊內(${PAINTERS.length} 支畫筆)`)
    : bad(`flat.tex 查無畫筆:${noTex.join(' ')}(畫筆名冊 ${PAINTERS.join(',')})`);
  /BORDER_PAINTERS\[BORDER_KINDS\[kind\]\.flat\.tex\]/.test(src)
    ? ok('borderTex 經 flat.tex 取畫筆(型錄是唯一真相)')
    : bad('borderTex 未走 flat.tex ⇒ tex 欄位沒有消費端');
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

  // ⑥ 同地貌:只有「顏色劇烈變化」那一道窄門(2026-08-13 使用者「顏色劇烈變化處也使用
  //    對應地貌的分界線覆蓋」)。08-11 擋掉的是「逐款畫線」,不是這一條 —— 兩者的分水嶺
  //    就是 CARPET_DE.LINE,所以下面**兩個方向都要有牙**:小色差恆 null、大色差恆有線。
  (borderKindOf('turf', 'meadow', 'green', 'green') === null            // 94 < 100
    && borderKindOf('arrowbamboo', 'turf', 'green', 'green') === null   // 30
    && borderKindOf('turf', 'bushfield', 'green', 'green') === null)    // 55
    ? ok('同地貌 + 色距 < CARPET_DE.LINE → null(逐款畫線 = 大片綠地被切成網狀,仍擋著)')
    : bad('同地貌小色差仍解出分界線(密集網狀的成因)');
  (borderKindOf('wild', 'sand', 'bare', 'bare') === 'gravelpath'        // 195
    && borderKindOf('icefield', 'steppe', 'alpine', 'alpine') === 'rocks'   // 253(雪線)
    && borderKindOf('brick', 'pavement', 'urban', 'urban') === 'hedgerow')  // 137
    ? ok('同地貌 + 色距 ≥ CARPET_DE.LINE → 該地貌的專屬界線(BORDER_SAME_ZONE)')
    : bad('顏色劇烈變化處沒有畫線(使用者 2026-08-13 定案)');
  // 對稱 + 同款恆 null + 沒有代表色(特徵拼圖)恆 null + 水域沒有同地貌界(深淺水本是同一片水)
  (borderKindOf('sand', 'wild', 'bare', 'bare') === borderKindOf('wild', 'sand', 'bare', 'bare')
    && borderKindOf('sand', 'sand', 'bare', 'bare') === null
    && borderKindOf('court', 'plaza', 'urban', 'urban') === null
    && borderKindOf('watertile', 'deepwater', 'water', 'water') === null)
    ? ok('同地貌分支:對稱 / 同款 null / 非底毯款 null / 水域無同地貌界')
    : bad('同地貌分支的四條邊界情形有破口');
  // 門檻不是空的也不是全開:排序後的清單裡**真的有**跨過門檻的相鄰對,而且是少數
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

console.log('== Ⅶ 掃掠繞向 / 兩側地貌切線 / 拼圖迴避(2026-08-11 使用者回報三項)==');
{
  // ---- ① 繞向:sweepUpY 是唯一縫,且它真的等於「三角形幾何法線的 y 分量」 ----
  // 這條在畫面上壞掉的樣子是「整段帶死黑」,而所有既有斷言(頂點/α/UV/貼圖)照樣全綠 ⇒
  // 稽核只能從**幾何定義**下手:拿獨立算的叉積對答案。
  let upOk = true;
  for (const [tx, tz] of [[1, 0], [0, 1], [-1, 0], [0.6, -0.8], [-0.3, -0.95]]) {
    for (const sgn of [1, -1]) {
      const nx = -tz * sgn, nz = tx * sgn;                       // 斷面橫向(左法線 / 右法線)
      // 三角形 A=(0,0)、B=A+t、C=A+n:幾何法線 y = uz*vx − ux*vz
      const ref = tz * nx - tx * nz;
      if (Math.sign(sweepUpY(tx, tz, nx, nz)) !== Math.sign(ref)) upOk = false;
    }
  }
  upOk ? ok('sweepUpY = 「先切向後橫向」繞向的幾何法線 y 分量(與獨立叉積逐例同號)')
    : bad('sweepUpY 與幾何叉積不符');
  // 直段的斷面橫向恆取 n = (−dz, dx)/l ⇒ upY = −l < 0 恆為負:**每一片直段都要翻**。
  // 這就是 2026-08-11 實測「flat 帶 100% 背面朝上 = 全部死黑」的成因,寫成斷言釘住
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
  // 扇形件(圓帽 / 岔路楔形)沿遞增角展開 ⇒ 俯視是逆向,繞向恆倒過來
  (/if \(s\) b\.idx\.push\(b\.base, b\.base \+ s \+ 1, b\.base \+ s\);/.test(src)
    && /b\.idx\.push\(b\.base, b\.base \+ 2 \+ s, b\.base \+ 1 \+ s\);/.test(src))
    ? ok('圓帽與岔路楔形的扇形繞向已倒轉(正面朝上)')
    : bad('扇形件繞向未倒轉 ⇒ 接頭死黑而直段正常 = 顏色不連續');
  src.includes('side: THREE.DoubleSide,   // 弦走向不定 ⇒ 繞向不定,雙面保險')
    ? bad('材質註解仍宣稱「繞向不定靠雙面保險」—— DoubleSide 只保證看得見,不保證亮度')
    : ok('不再以 DoubleSide 當繞向的替代品(它只讓背面看得見,法線照樣被反轉)');

  // ---- ② 兩側地貌以分界線為界 ----
  const W = BORDER_CUT.W;
  (borderCutAlpha(-W, W) === 0 && borderCutAlpha(W, W) === 1 && borderCutAlpha(0, W) === 0.5)
    ? ok(`borderCutAlpha 端點恆定(±${W / 2}m 外恆 0/1、線上恰 0.5)⇒ 與不透明底毯水密`)
    : bad('borderCutAlpha 端點/中點不對');
  let mono = true;
  for (let d = -W; d <= W; d += W / 16) if (borderCutAlpha(d, W) < borderCutAlpha(d - W / 16, W)) mono = false;
  mono ? ok('borderCutAlpha 單調遞增(換手只發生一次,不會來回跳)') : bad('borderCutAlpha 非單調');
  // 換手帶 MUST 收在**最窄**那一種的帶寬之內 —— 否則換手處露在圖案之外就是看得見的滲透
  const minHW = Math.min(...Object.values(BORDER_KINDS).map((d) => d.flat.w / 2));
  (W / 2 + BORDER_CUT.JIT / 2 <= minHW + 1e-9)
    ? ok(`換手半寬 ${(W / 2 + BORDER_CUT.JIT / 2).toFixed(2)}m ≤ 最窄帶半寬 ${minHW.toFixed(2)}m(換手恆藏在圖案底下)`)
    : bad(`換手帶比最窄的分界線還寬(${(W / 2 + BORDER_CUT.JIT / 2).toFixed(2)} > ${minHW.toFixed(2)})⇒ 滲透露在帶外`);
  // planSeamOverlays:有線的組合 ⇒ 帶 cut 且**不出**中間過渡脊帶(橫跨界線的第三種地表)
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

  // ---- ③ 田/停車場/球場/3D 物件不得橫跨分界線 ----
  (/const bdCross = \(x, z, r\) => \{[\s\S]{0,300}?bdSegD\(sg, x, z\) < r \+ sg\.hw \+ BORDER_BAND\.PAD/.test(src))
    ? ok('bdCross:足跡半徑 + 帶半寬 + PAD 淨距(迴避的是帶,不是中心線)')
    : bad('bdCross 未把帶寬與淨距算進去');
  // 拒絕 MUST 排在首個 rnd() 之前(與 roadClear 同位)—— 否則散布序列被拒絕與否改寫
  const tpM = src.match(/const tryPatch = \(x, z, sub, variant, r, rot, depth\) => \{[\s\S]*?\n  \};/);
  if (!tpM) bad('抽不到 tryPatch 原文');
  else {
    // 剝掉行註解再找 —— 註解裡寫著「排在首個 rnd() 之前」的那個 `rnd()` 會讓這條斷言誤判
    const body = tpM[0].replace(/\/\/[^\r\n]*/g, '');
    const iBd = body.indexOf('bdCross('), iRnd = body.indexOf('rnd()');
    (iBd > 0 && iBd < iRnd)
      ? ok('tryPatch 的分界線迴避排在首個 rnd() 之前(確定性序列不變)')
      : bad('tryPatch 的分界線迴避晚於首個 rnd() ⇒ 散布序列被改寫');
  }
  /if \(detCount >= detCap \|\| isBlocked\(px, pz\) \|\| bdCross\(px, pz, 0\)\) return;/.test(src)
    ? ok('addDetail 早退含分界線迴避(3D 擺件不站在界線上;與既有早退同位,不吃 rnd)')
    : bad('3D 細節未迴避分界線');
  // 讓路的方向:界線是結構、拼圖是點綴 ⇒ onRegular 降級為保險絲(註解與斷言一起釘住)
  src.includes('onRegular 自 2026-08-11 起是**保險絲**')
    ? ok('onRegular 降級為保險絲(主力改成 tryPatch 先迴避;讓路方向已反轉)')
    : bad('讓路方向的定案沒有留在原文裡');
  // 規劃 MUST 只有一份:發射端吃的是上面就規劃好的 bdPlan
  ((src.match(/planBorderPuzzle\(keys, gnx, gnz, \{/g) || []).length === 1 && src.includes('const plan = bdPlan;'))
    ? ok('planBorderPuzzle 全檔只呼叫一次,底毯切線 / 拼圖迴避 / 幾何發射同吃一份(單一縫)')
    : bad('planBorderPuzzle 被呼叫多次 ⇒ 切線與畫出來的線可能不是同一條');
  // 規劃 + 索引區塊零共享 rnd(§2.3):它排在特徵散布之前,吃一枚就把整張圖的佈局推移
  const planBlk = src.match(/==== 地貌界線拼圖:規劃 \+ 空間索引[\s\S]*?\n  \/\/ 異類交界/);
  const planCode = planBlk ? planBlk[0].replace(/\/\/[^\r\n]*/g, '') : '';   // 剝行註解(理由同 tryPatch)
  (planBlk && !/\brnd\(/.test(planCode) && !planCode.includes('Math.random'))
    ? ok('規劃 + 空間索引區塊零共享 rnd()(提前呼叫不推移任何散布,§2.3)')
    : bad(planBlk ? '規劃區塊消耗了共享 rnd()' : '找不到規劃區塊(標題漂移,請同步稽核)');
  // 帶緣有機起伏:吃**世界座標**才會在共用端點上同值(吃沿線參數 = 接頭處開叉)
  (/const eN = \(x, z, s\) => 1 \+ BORDER_BAND\.EDGE_A/.test(src)
    && /vnoise\(x \* BORDER_BAND\.EDGE_W, z \* BORDER_BAND\.EDGE_W, seed \^ s\)/.test(src))
    ? ok('帶緣起伏吃世界座標的 vnoise(相鄰 tile 與接頭共用端點同值,邊緣不開叉)')
    : bad('帶緣起伏未吃世界座標');
  (/const eL = eN\(cx, cz, 0x1F17\), eR = eN\(cx, cz, 0x2E29\)/.test(src)
    && (src.match(/eN\(cx, cz, 0x1F17\)/g) || []).length === 2)
    ? ok('直段與岔路楔形取同一組起伏種子(楔形與直段接得上)')
    : bad('岔路楔形未與直段共用帶緣起伏 ⇒ 路口處帶寬對不上');
  // 讓路取樣半徑 MUST 是**起伏後的最外緣**,畫出來的邊才恆在驗過的走廊裡
  (/d\.flat\.w \/ 2 \* \(1 \+ BORDER_BAND\.EDGE_A\)/.test(src))
    ? ok('hwOfKind 取起伏後的最外緣(讓路取樣與迴避半徑蓋得住真的畫出來的邊)')
    : bad('hwOfKind 仍取標稱半寬 ⇒ 起伏出去的帶緣沒被驗到');
  // 貼圖節距 MUST 隨帶寬推導(固定 9m 會把窄帶橫向拉扁成「意義不明的線條」)
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
  // ⓕ 繞向不翻(退回舊制的無條件繞向)→ Ⅶ① 的原文斷言必須紅
  //   sweepFlat 住 buildGroundCover 裡(要 THREE),離線只驗得到原文 ⇒ 對照組也對原文動刀
  const noFlip = src.replace(
    /if \(flip\) b\.idx\.push\(p0 \+ k, p0 \+ k \+ 1, q0 \+ k, p0 \+ k \+ 1, q0 \+ k \+ 1, q0 \+ k\);\r?\n\s*else /,
    '');
  if (noFlip === src) bad('對照組 ⓕ 替換點失配(原文已漂移,請同步稽核)');
  else {
    !/if \(flip\) b\.idx\.push\(p0 \+ k, p0 \+ k \+ 1, q0 \+ k, p0 \+ k \+ 1, q0 \+ k \+ 1, q0 \+ k\);/.test(noFlip)
      ? ok('對照組ⓕ:拿掉繞向翻轉的壞版本被 Ⅶ① 抓到(死黑那條有牙)')
      : bad('對照組ⓕ:壞版本未呈現預期缺陷(Ⅶ① 驗不到東西)');
  }
  // ⓖ 切線不抑制中間過渡脊帶 → Ⅶ② 的「橫跨界線的第三種地表」檢查必須紅(**執行原文**)
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
  // ⓗ 切線 α 不夾端點 → Ⅶ② 的水密檢查必須紅(**執行原文**)
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
  src.includes('halfWidthOf: hwOfKind')
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

// ===== Ⅵ 分界線帶內不觸發地形異常狀態(2026-08-13 使用者定案)=====
// 「確保水域/沼澤在分界線的區塊內不會觸發異常狀態」。這一段驗的是**接線的方向**:遮罩由
// ground.js 產出、biomes.terrainEnvCode 消費、main.js 在 buildBiomes **之後**裝上。
// 裝早了就是「界線改分區、分區又改界線」的循環相依,而症狀是同一張圖每次建出來都不一樣 ——
// 這件事沒有任何既有斷言看得見(每一格都還是「照規則」選的)。
console.log('\n== Ⅵ 分界線帶內強制乾地(水域/沼澤不觸發異常狀態)==');
{
  const bio = readSrc('public', 'js', 'biomes.js');
  const mainSrc = readSrc('public', 'js', 'main.js');
  const dryM = src.match(/export function makeBandMask\(grid, sc, hwMax\) \{[\s\S]*?\n\}/);
  dryM ? ok('ground.js 有 makeBandMask(規則唯一縫)') : bad('ground.js 找不到 makeBandMask');
  if (dryM) {
    // 純幾何:只問「離中心線的垂距 ≤ 該種類的帶半寬」,零 rnd / 零 THREE / 不吃 terrain 高程
    (!/\brnd\(/.test(dryM[0]) && !dryM[0].includes('Math.random') && !dryM[0].includes('THREE')
      && !dryM[0].includes('heightAt'))
      ? ok('makeBandMask 是 (x,z) 的純函式:零 rnd / 零 THREE / 不看高程(§2.3)')
      : bad('makeBandMask 摻入 rnd / THREE / 高程查詢');
    // 半寬 MUST 取索引裡那一段自己的 hw(= hwOfKind,含帶緣起伏)—— 寫死一個數字就是
    // 「窄的那幾種多蓋一圈、寬的那一種蓋不滿」,而畫面上只是偶爾還會凍結一下
    /<= sg\.hw\) return true;/.test(dryM[0])
      ? ok('遮罩半徑取該段自己的帶半寬 sg.hw(hwOfKind ⇒ 恰好蓋住畫出來的圖案)')
      : bad('遮罩半徑不是逐段帶半寬(寫死數字 = 與真正畫出來的帶脫鉤)');
    // 掃描格數由半寬推導(只掃自己那一格 ⇒ 最寬的沙灘帶在格界附近查不到自己那一段)
    /const n = Math\.max\(1, Math\.ceil\(hwMax \/ sc\)\);/.test(dryM[0])
      ? ok('掃描格數由最寬帶半寬推導,不手寫') : bad('makeBandMask 的掃描範圍寫死');
    // **住模組層**:寫成 buildGroundCover 的內層閉包會把整個建構作用域一起留住(A25)
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
  // 清空 MUST 排在 buildGroundCover 之前(否則清的是這一輪剛裝上的那一份)
  (bio.indexOf('terrain.inBorderBand = null;') < bio.indexOf('buildGroundCover(group, terrain'))
    ? ok('清空排在 buildGroundCover 之前') : bad('清空排在建圖之後 ⇒ 等於沒清');
  /if \(terrain\.inBorderBand\?\.\(x, z\)\) return 0;/.test(bio)
    ? ok('terrainEnvCode 消費遮罩(客戶端 _envAt / bakeWetGrid / 沼澤面同吃這一支)')
    : bad('terrainEnvCode 未消費遮罩 ⇒ 帶上照樣涉水凍結/陷沼扣血');
  // 安裝點恰一處,且 MUST 在 buildBiomes 之後、bakeWetGrid 之前
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
  // ground.js MUST NOT 自己讀這面遮罩(讀了就是循環相依,而且是靜默的)
  !src.includes('inBorderBand')
    ? ok('ground.js 不讀 terrain.inBorderBand(遮罩只出不進)')
    : bad('ground.js 讀了 inBorderBand ⇒ 分區與界線互相決定');
}

console.log(fail ? `\nFAIL(${fail} 項)` : '\nALL PASS');
process.exit(fail ? 1 : 0);
