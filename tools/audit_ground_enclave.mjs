// 多層次地貌:大區域中的小區域組合風格(2026-07-29)稽核 —— node tools/audit_ground_enclave.mjs
// 使用者需求「大區域中的小區域的樣貌風格不同:市區內的小綠地可能是公園/私人庭園、小水域
// 可能是公園埤塘/滯洪池、小裸露地可能是待建工地;綠地中的小市區可能是農村市集…以此類推,
// 建立多種可能的組合風格」。
// 判定唯一縫 = ground.js planEnclaves(純函式零依賴,本稽核抽原文 eval 執行真品):
//   Ⅰ 判定直測(小區域整元件標鍵 / 大區域不標 / 面積門檻 / 外側不夠單一不標 / 崖圈不算
//      邊界 / 查無組合不標 / 巢狀兩層各自成立 / 水域 enclave / 4-鄰不含對角 / 決定性)
//   Ⅱ 對照組(反向驗證內建):拿掉外側單一門檻 / 拿掉面積上限 ⇒ 壞版本必呈現預期缺陷
//   Ⅲ 樣式表完整性(鍵合法、carpet ⊆ 底毯/特徵清單聯集(coarse 歸屬查得到)、
//      feats ⊆ DEFS∩SIZE、水域樣式 det 合法、門檻常數 sanity)
//   Ⅳ 靜態規則(單一縫:cellKeyAt 換 carpet / tryPatch 放行閘 / 沿街陣列 enclave 池 /
//      watertile det 三款 / 兩個 scatterDetails 呼叫端都傳 enc / 純函式零 rnd)
'use strict';
import { readFileSync } from 'node:fs';

let fail = 0;
const bad = (m) => { console.log('  ✗', m); fail++; };
const ok = (m) => console.log('  ✓', m);

const src = readFileSync(new URL('../public/js/ground.js', import.meta.url), 'utf8');

// ===== 抽原文(零依賴 → eval 執行真品)=====
const encCfgM = src.match(/export const ENCLAVE = \{.*$/m);
const stylesM = src.match(/export const ENCLAVE_STYLES = \{[\s\S]*?\n\};/);
const fnM = src.match(/export function planEnclaves\(zones, gnx, gnz, opts = \{\}\) \{[\s\S]*?\n\}/);
const defsM = src.match(/\nconst DEFS = \{[\s\S]*?\n\};/);
const zonesM = src.match(/\nconst ZONES = \{[\s\S]*?\n\};/);
const carpetM = src.match(/\nconst CARPET = \{[\s\S]*?\n\};/);
const sizeM = src.match(/\nconst SIZE = \{[\s\S]*?\n\};/);
if (!encCfgM || !stylesM || !fnM || !defsM || !zonesM || !carpetM || !sizeM) {
  bad('ground.js 找不到 ENCLAVE / ENCLAVE_STYLES / planEnclaves / DEFS / ZONES / CARPET / SIZE 原文');
  console.log(`\nFAIL(${fail} 項)`); process.exit(1);
}
const build = (planText) => new Function('THREE', `
  ${encCfgM[0].replace('export ', '')}
  ${stylesM[0].replace('export ', '')}
  ${planText.replace('export ', '')}
  return { planEnclaves, ENCLAVE, ENCLAVE_STYLES };
`)({});
const { planEnclaves, ENCLAVE, ENCLAVE_STYLES } = build(fnM[0]);
// DEFS 內含 THREE 幾何?否 —— DEFS/ZONES/CARPET/SIZE 皆純資料(DETAIL_DEFS 才有 THREE,不抽)
const DATA = new Function(`
  ${defsM[0]}
  ${zonesM[0]}
  ${carpetM[0]}
  ${sizeM[0]}
  return { DEFS, ZONES, CARPET, SIZE };
`)();

// ===== 工具:格網建構 =====
const grid = (gnx, gnz, fn) => {
  const zs = new Array(gnx * gnz).fill(null);
  for (let j = 0; j < gnz; j++) for (let i = 0; i < gnx; i++) zs[j * gnx + i] = fn(i, j);
  return zs;
};
const inRect = (i, j, x0, z0, w, h) => i >= x0 && i < x0 + w && j >= z0 && j < z0 + h;

console.log('== Ⅰ planEnclaves 判定直測(執行原文)==');
{
  // ① 都會公園:16×16 市區裡 4×4 綠地 → 整個元件標 'green@urban',市區格不標
  const N = 16;
  const zs = grid(N, N, (i, j) => inRect(i, j, 6, 6, 4, 4) ? 'green' : 'urban');
  const out = planEnclaves(zs, N, N);
  let allIn = true, allOut = true;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const v = out[j * N + i];
    if (inRect(i, j, 6, 6, 4, 4)) { if (v !== 'green@urban') allIn = false; }
    else if (v != null) allOut = false;
  }
  allIn ? ok('市區內 4×4 小綠地:整個元件標 green@urban(公園/私人庭園)') : bad('小綠地元件未整塊標 green@urban');
  allOut ? ok('包裹側(市區大區域)不標(維持本色)') : bad('大區域被誤標');

  // ② 大區域不標:13×13 = 169 格 > MAX_CELLS(160)
  const M = 20;
  const zsBig = grid(M, M, (i, j) => inRect(i, j, 3, 3, 13, 13) ? 'green' : 'urban');
  planEnclaves(zsBig, M, M).every((v) => v == null)
    ? ok(`大區域(169 格 > MAX_CELLS ${ENCLAVE.MAX_CELLS})不標:大綠地維持本色`)
    : bad('超過 MAX_CELLS 的大區域被誤標成 enclave');

  // ③ 面積下限:孤格(1 < MIN_CELLS)不標、2 格相鄰標
  const zs1 = grid(8, 8, (i, j) => (i === 4 && j === 4) ? 'green' : 'urban');
  planEnclaves(zs1, 8, 8).every((v) => v == null)
    ? ok(`孤格(1 < MIN_CELLS ${ENCLAVE.MIN_CELLS})不標(影像雜訊斑點交給交界軟化)`)
    : bad('孤格被誤標');
  const zs2 = grid(8, 8, (i, j) => (j === 4 && (i === 3 || i === 4)) ? 'green' : 'urban');
  const out2 = planEnclaves(zs2, 8, 8);
  (out2[4 * 8 + 3] === 'green@urban' && out2[4 * 8 + 4] === 'green@urban')
    ? ok('2 格相鄰小區域達 MIN_CELLS:標')
    : bad('2 格小區域未標');

  // ④ 外側不夠單一:綠地跨在市區|裸露地半分邊界上(外側 8:8 = 50% < OUTER_MIN)→ 不標
  const zs4 = grid(16, 16, (i, j) => inRect(i, j, 6, 6, 4, 4) ? 'green' : (i < 8 ? 'urban' : 'bare'));
  planEnclaves(zs4, 16, 16).every((v) => v == null)
    ? ok(`外側分區各半(50% < OUTER_MIN ${ENCLAVE.OUTER_MIN}):交界犬牙不標`)
    : bad('外側混雜的區塊被誤判成被包住');

  // ⑤ 崖圈不算邊界:2×2 綠地被 '!' 整圈圍住 → 無實心邊界,不標
  const zs5 = grid(10, 10, (i, j) => inRect(i, j, 4, 4, 2, 2) ? 'green'
    : inRect(i, j, 3, 3, 4, 4) ? '!' : 'urban');
  planEnclaves(zs5, 10, 10).every((v) => v == null)
    ? ok("崖 '!' 圈住的區塊:無實心邊界,不標(被崖圈住 ≠ 被誰包住)")
    : bad('全崖邊界的區塊被誤標');

  // ⑥ 查無組合維持原樣:'wet' 包在 'alpine' 裡(表無 wet@alpine)→ 不標
  const zs6 = grid(10, 10, (i, j) => inRect(i, j, 4, 4, 2, 2) ? 'wet' : 'alpine');
  planEnclaves(zs6, 10, 10).every((v) => v == null)
    ? ok('查無組合(wet@alpine):維持原分區樣貌不標')
    : bad('表上沒有的組合被硬標');

  // ⑦ 巢狀兩層:市區 > 6×6 綠地 > 2×2 裸露地 → 綠環標 green@urban、內核標 bare@green
  const zs7 = grid(16, 16, (i, j) => inRect(i, j, 7, 7, 2, 2) ? 'bare'
    : inRect(i, j, 5, 5, 6, 6) ? 'green' : 'urban');
  const out7 = planEnclaves(zs7, 16, 16);
  let ring = true, core = true;
  for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
    const v = out7[j * 16 + i];
    if (inRect(i, j, 7, 7, 2, 2)) { if (v !== 'bare@green') core = false; }
    else if (inRect(i, j, 5, 5, 6, 6)) { if (v !== 'green@urban') ring = false; }
  }
  (ring && core)
    ? ok('巢狀兩層:綠環 = green@urban(公園)、內核 = bare@green(廢耕地)各自成立')
    : bad(`巢狀判定錯(ring=${ring} core=${core})`);

  // ⑧ 水域 enclave:3×3 水包在市區 = 埤塘/滯洪池;包在綠地 = 天然湖泊
  for (const [outer, key, label] of [['urban', 'water@urban', '公園埤塘/滯洪池'], ['green', 'water@green', '天然湖泊/堰塞湖']]) {
    const zsW = grid(12, 12, (i, j) => inRect(i, j, 5, 5, 3, 3) ? 'water' : outer);
    const outW = planEnclaves(zsW, 12, 12);
    (outW[5 * 12 + 5] === key && ENCLAVE_STYLES[key])
      ? ok(`${outer} 內小水域 → ${key}(${label};det=${ENCLAVE_STYLES[key].det})`)
      : bad(`${outer} 內小水域未標 ${key}`);
  }

  // ⑨ 4-鄰不含對角:2×2 綠地 + 對角斜接孤格 → 孤格是獨立元件(1 格不標),2×2 照標
  const zs9 = grid(10, 10, (i, j) => (inRect(i, j, 4, 4, 2, 2) || (i === 6 && j === 6)) ? 'green' : 'urban');
  const out9 = planEnclaves(zs9, 10, 10);
  (out9[4 * 10 + 4] === 'green@urban' && out9[6 * 10 + 6] == null)
    ? ok('連通 = 4-鄰(對角斜接不併元件:孤格獨立淘汰、主塊照標)')
    : bad('對角斜接被誤併成同一元件');

  // ⑩ 觸圖界不標:貼著地圖邊的小綠條(三面被市區圍)延伸到圖外、範圍不明 → 不標
  const zsE = grid(10, 10, (i, j) => (j === 0 && i >= 4 && i <= 6) ? 'green' : 'urban');
  planEnclaves(zsE, 10, 10).every((v) => v == null)
    ? ok('觸圖界的區域不標(貼圖邊 = 延伸到圖外,不算被包住;寧缺勿錯)')
    : bad('觸圖界的區域被誤標');

  // ⑪ 決定性:同輸入兩次逐位元相同
  JSON.stringify(planEnclaves(zs7, 16, 16)) === JSON.stringify(planEnclaves(zs7, 16, 16))
    ? ok('決定性:同輸入兩次輸出逐位元相同(§2.3)')
    : bad('同輸入兩次輸出不同');
}

console.log('== Ⅱ 對照組(內建反向驗證:壞版本必呈現預期缺陷)==');
{
  // ⓐ 拿掉外側單一門檻 ⇒ 交界犬牙(外側各半)被誤標
  const noDomText = fnM[0].replace('if (bestN < nb * outerMin) continue;', ';');
  if (noDomText === fnM[0]) bad('對照組ⓐ改寫落空(原文結構變了?)');
  else {
    const noDom = build(noDomText).planEnclaves;
    const zs4 = grid(16, 16, (i, j) => inRect(i, j, 6, 6, 4, 4) ? 'green' : (i < 8 ? 'urban' : 'bare'));
    noDom(zs4, 16, 16).some((v) => v != null)
      ? ok('對照組ⓐ:拿掉外側單一門檻 → 犬牙誤標(門檻存在必要)')
      : bad('對照組ⓐ未呈現預期缺陷(門檻其實沒作用?)');
  }
  // ⓑ 拿掉面積上限 ⇒ 大區域被誤標
  const noMaxText = fnM[0].replace('comp.length > maxCells', 'false');
  if (noMaxText === fnM[0]) bad('對照組ⓑ改寫落空(原文結構變了?)');
  else {
    const noMax = build(noMaxText).planEnclaves;
    const zsBig = grid(20, 20, (i, j) => inRect(i, j, 3, 3, 13, 13) ? 'green' : 'urban');
    noMax(zsBig, 20, 20).some((v) => v === 'green@urban')
      ? ok('對照組ⓑ:拿掉面積上限 → 大區域誤標(上限存在必要)')
      : bad('對照組ⓑ未呈現預期缺陷(上限其實沒作用?)');
  }
  // ⓒ 拿掉觸圖界淘汰 ⇒ 圖界綠條被誤標
  const noEdgeText = fnM[0].replace('if (edge || comp.length < minCells', 'if (comp.length < minCells');
  if (noEdgeText === fnM[0]) bad('對照組ⓒ改寫落空(原文結構變了?)');
  else {
    const noEdge = build(noEdgeText).planEnclaves;
    const zsE = grid(10, 10, (i, j) => (j === 0 && i >= 4 && i <= 6) ? 'green' : 'urban');
    noEdge(zsE, 10, 10).some((v) => v === 'green@urban')
      ? ok('對照組ⓒ:拿掉觸圖界淘汰 → 圖界區域誤標(規則存在必要)')
      : bad('對照組ⓒ未呈現預期缺陷(圖界規則其實沒作用?)');
  }
}

console.log('== Ⅲ 樣式表完整性 ==');
{
  const { DEFS, ZONES, CARPET, SIZE } = DATA;
  const COARSE = new Set(['green', 'bare', 'urban', 'wet', 'water', 'alpine']);
  const carpetUnion = new Set();
  for (const lists of [CARPET, ZONES]) for (const zn in lists) for (const s of lists[zn]) carpetUnion.add(s);
  let keyBad = 0, carpetBad = 0, featBad = 0, detBad = 0, waterBad = 0;
  const styleN = Object.keys(ENCLAVE_STYLES).length;
  for (const k in ENCLAVE_STYLES) {
    const st = ENCLAVE_STYLES[k];
    const [inner, outer] = k.split('@');
    if (!COARSE.has(inner) || !COARSE.has(outer) || inner === outer) { keyBad++; bad(`樣式鍵不合法:${k}`); }
    for (const s of st.carpet || []) {
      if (!DEFS[s]) { carpetBad++; bad(`${k} carpet 引用不存在的地表:${s}`); }
      else if (!carpetUnion.has(s)) { carpetBad++; bad(`${k} carpet 的 ${s} 不在底毯/特徵清單聯集(coarse 歸屬查不到)`); }
    }
    for (const s of st.feats || []) {
      if (!DEFS[s] || !SIZE[s]) { featBad++; bad(`${k} feats 引用無 DEFS/SIZE 的地表:${s}`); }
    }
    if (st.det && !['pond', 'lake', 'spring'].includes(st.det)) { detBad++; bad(`${k} det 樣態未知:${st.det}`); }
    if (inner === 'water' && (st.carpet || st.feats)) { waterBad++; bad(`${k}:水域 enclave 不得帶 carpet/feats(水面強制水拼圖)`); }
  }
  keyBad || ok(`全部 ${styleN} 款樣式鍵合法(內@外皆 coarse 分區、內≠外)`);
  carpetBad || ok('全部 carpet 地表存在且 coarse 歸屬查得到(subCoarse/交界樣式不落空)');
  featBad || ok('全部 feats 地表存在且有 SIZE(主散佈半徑可解)');
  detBad || ok('水域 det 樣態 ⊆ {pond, lake, spring}');
  waterBad || ok('水域樣式純 det(不帶 carpet/feats)');
  styleN >= 12
    ? ok(`組合覆蓋:${styleN} 款(市區/綠地/裸露地/濕地/高地互包,使用者「建立多種可能的組合風格」)`)
    : bad(`樣式僅 ${styleN} 款,未覆蓋多種組合`);
  (ENCLAVE.MIN_CELLS >= 1 && ENCLAVE.MIN_CELLS <= ENCLAVE.MAX_CELLS && ENCLAVE.OUTER_MIN >= 0.5 && ENCLAVE.OUTER_MIN <= 1)
    ? ok(`門檻 sanity:MIN ${ENCLAVE.MIN_CELLS} ≤ MAX ${ENCLAVE.MAX_CELLS}、OUTER_MIN ${ENCLAVE.OUTER_MIN} ∈ [0.5,1](過半才算被包)`)
    : bad('ENCLAVE 門檻常數不合理');
}

console.log('== Ⅳ 靜態規則(單一縫 / 消費端接線)==');
{
  !/function planEnclaves[\s\S]*?\n\}/.exec(src)[0].match(/\brnd\(|Math\.random|THREE\./)
    ? ok('planEnclaves 原文零 rnd / 零 Math.random / 零 THREE(純函式,A4/§2.3)')
    : bad('planEnclaves 摻入 rnd / Math.random / THREE');
  /const encGrid = planEnclaves\(zoneGrid, gnx, gnz/.test(src)
    ? ok('buildGroundCover 經 planEnclaves 取 encGrid(判定單一縫)')
    : bad('包裹判定未走 planEnclaves(第二份實作?)');
  (src.match(/export const ENCLAVE_STYLES = \{/g) || []).length === 1
    ? ok('ENCLAVE_STYLES 組合表只有一份(樣式唯一真相)')
    : bad('ENCLAVE_STYLES 出現多份');
  /encRt\.get\(encGrid\[j \* gnx \+ i\]\)\?\.style\.carpet \|\| carpetLists\[zn\]/.test(src)
    ? ok('底毯 cellKeyAt:enclave 格換 carpet 清單(查無 = 原分區清單)')
    : bad('cellKeyAt 未接 enclave carpet 換裝');
  /!subZones\.get\(sub\)\?\.has\(zn\) && !enc\?\.set\.has\(sub\)/.test(src)
    ? ok('tryPatch 分區把關:enclave 格內放行樣式地表(僅限格內,不外漏)')
    : bad('tryPatch 未接 enclave 放行閘(或把關被整個拿掉)');
  /enc\.arr \?\?= \(enc\.style\.feats \|\| \[\]\)\.filter\(\(s\) => arrayable\.has\(s\)\)/.test(src)
    ? ok('沿街規律陣列:enclave 內只鋪該樣式的可陣列型(公園裡不長一般停車陣列)')
    : bad('沿街陣列未接 enclave 池');
  /encM\?\.style\.feats\?\.length \? encM\.style\.feats : zoneLists\[zoneAt\(x, z\)\]/.test(src)
    ? ok('特徵層主散佈:enclave 內改抽樣式 feats 池')
    : bad('主散佈未接 enclave feats 池');
  (/det === 'pond'/.test(src) && /det === 'lake'/.test(src) && /det === 'spring'/.test(src))
    ? ok('watertile 水生點綴三樣態(pond 荷葉 / lake 蘆葦岸 / spring 稀疏)接線齊全')
    : bad('watertile det 分支缺樣態');
  (/scatterDetails\(sub, x, z, r, rot, def, zn, enc\)/.test(src)
   && /scatterDetails\(sub, cx2, cz2, cell \* 0\.55, rnd\(\) \* Math\.PI \* 2, DEFS\[sub\], zoneAt\(cx2, cz2\), encAt\(cx2, cz2\)\)/.test(src))
    ? ok('scatterDetails 兩個呼叫端(特徵拼圖 / 底毯細節)都帶 enc 情境')
    : bad('scatterDetails 呼叫端缺 enc(水域點綴查不到包裹情境)');
}

console.log(fail ? `\nFAIL(${fail} 項)` : '\nPASS 全數通過');
process.exit(fail ? 1 : 0);
