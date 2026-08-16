// 地貌拼圖的顏色與花紋(2026-08-12 使用者需求)稽核 —— node tools/audit_ground_tile.mjs
//
// 使用者原話(同一則的前兩項):
//   ①「地貌拼圖有時候綠突然變紅又突然變灰,如果是同一類型(市區/綠地/裸露地/水域/濕地),
//      盡可能不要短距離快速變化地貌拼圖顏色」
//   ②「同顏色的地貌拼圖上面可以繪製多個不同的紋路/圖案/點綴/裝飾等細節,同顏色的相鄰拼圖的
//      紋路/圖案/點綴/裝飾等細節盡可能是不同的」
//   ③「邊界延伸不可進入的緩衝空間也要貼地貌拼圖」
//
// 病灶(①):選款是「低頻雜訊 t → 清單索引」的**逐格**取值。清單有 10~12 款、款與款之間的
// 顏色跨度很大(綠地清單裡 turf 綠 / flowerfield 紅 / deadwood 灰),而 t 的梯度在雜訊場的
// 陡處可以在十幾公尺內橫掃好幾個索引 ⇒ 沿著那條帶走過去就是綠→紅→灰。每一格自己都「照規則」
// 選的,舊有的每一條斷言(水密/外溢/界線)也照樣全綠 —— 這正是本稽核存在的理由。
//
// 三個縫,逐條釘死:
//   Ⅰ 選款區塊 `carpetLotAt` —— 抖動格點的最近點分割(jittered-Voronoi)。抖動 MUST < 半格
//     (否則最近的 lot 中心會落在 3×3 候選之外 = 分割破洞);純函式、決定性;
//     **換款間距**由內建對照組量:同一份場、取值點改回格心(= 舊制)的連續同款長度 vs
//     lot 版本 —— 這一條是「顏色不會短距離快速變化」唯一可量的東西。
//   Ⅱ 逐格花紋 `planCarpetVariants` —— 硬條件「共邊的同款鄰格恆不同變體」、軟條件「連對角
//     也盡量不同」、異款不受約束、決定性、零 rnd。對照組 = 舊制低頻雜訊變體。
//   Ⅲ 靜態規則(執行原文)—— 底色不隨變體漂移(baseFill)、選款走 lot 中心、keys 兩段組裝、
//     同款異變體不發外溢、緩衝空間底毯(鏡射 / 粗格 / bufferHeightAt / 同一批 buckets /
//     零 rnd)、貼地面發射只有 emitFace 一份實作(且圖內已不再經過它)。
//   Ⅳ **認養地形三角形**(2026-08-13 使用者定案 A;「陸域地貌拼圖改成直接對地形渲染」的那一半)
//     —— 舊制底毯自己切 3×3、頂點取 heightAt ⇒ 頂點在地形上而**頂點之間是直的**,跨過地形
//     折角的弦沉下去就是「斜坡破圖」。新制把「畫什麼」與「畫在哪些三角形上」分家:規劃格
//     照舊(含抖動),發射改成逐地形四邊形認養主人格 ⇒ 皮的三角形 === 地形的三角形。
//     這一段量幾何規則(inQuad 的分割恰一個主人、主人恆在 3×3 內、invBil 四角恆等與共用邊
//     同值)與接線(索引序與 terrain.js 逐字同向、灘線閘仍整格判、圖內不再套貼合抬升、
//     地形頂點數推導不手寫)。
//   Ⅴ **農牧地表的四季設計**(2026-08-13 使用者「田除了田也加入菜園/牧場/魚塭與果園等農牧區,
//     包含原本的田在內依四季不同而對應設計」)—— 舊制季節只有 `SEASON_TINT` 一個乘色濾鏡。
//     抽畫筆原文餵一個會記錄繪圖呼叫的假 2D context,四季兩兩 MUST 畫出不同的東西且
//     **不只是換底色**(只差底色 = 那條濾鏡又回來了);另驗名冊對齊(吃 season 的畫筆 ⇔ 標
//     `seasonal` 的 DEFS,漏標 = 調兩次色)、季節只進快取鍵(draw call 不變)、牧場註冊齊全。
//
//   Ⅵ **選款清單的顏色路徑**(2026-08-13 使用者再次回報「同一類型盡可能不要短距離快速變化
//     子類別」)—— Ⅰ 的區塊只解決了換款的**頻率**,幅度一格未動:清單的索引相鄰若不是顏色
//     相鄰(綠地那一份是 meadow 土黃 → deadwood 灰 → turf 綠),t 再平滑顏色照樣在跳。
//     新制把代表色收成一張表(SUB_COL,畫筆與排序同吃)、清單排成一條顏色路徑(carpetOrder)。
//     這一段驗名冊涵蓋(雙向)、畫筆真的吃這張表、排序保留重數與同款成段、瓶頸步距不變差,
//     以及兩個消費端(carpetLists 冬季覆寫之後 / enclave 樣式)都排到了。
//   Ⅶ **同顏色拼圖上的多種點綴**(使用者「草地的小花,沙地的小石頭,水域的游魚,以此類推」)
//     —— 逐款底毯地表 MUST 撒得出兩種以上的點綴(舊制沙地只有小石頭、沼澤只有蘆葦、深水
//     一片全空);游魚 MUST 進 AQ_DET 且 MUST 沉在水面下(貼在面上 = 浮在水上的魚)。
//
// 反向驗證:`--break-lot`   取值點改回格心 ⇒ Ⅰ 紅(換款間距垮回舊制)
//           `--break-var`   花紋改回低頻雜訊 ⇒ Ⅱ 紅(共邊同款同變體)
//           `--break-order` 清單維持原序 ⇒ Ⅵ 紅(索引相鄰不再是顏色相鄰)
//           `--break-adopt` 認養退回對角線拆三角形 ⇒ Ⅳ 紅(凹四邊形與鄰格重疊認養)
// 讀原文走 `audit_src.mjs` 單一縫(CRLF 工作區逐行剝註解會靜默失效)。
//
// ---- 接縫紀律:共面的兩片是**硬幣拋**不是圖層(2026-08-16 併入,`docs/anime_style_plan.md` ④-4;
//      純註解,零斷言改動)----
// Ⅳ 那一段(認養地形三角形)把圖內三層(底毯 / 外溢 / 脊帶)做成與地形**刻意共面**的皮 ——
// 那是 2026-08-13 使用者定案的解法,也是這一族陷阱的正中央。完整的規則是:
//
//  ㋐ **兩片同高共面的面,渲染器隨鏡頭位置任意贏一片**(逐幀、逐機位都可能換人)。它不是
//     「圖層」,是一枚每幀重拋的硬幣。判讀法只有一條,而且它是**反直覺**的:
//
//       > **改了材質而畫面逐像素完全相同,永遠不是「這個材質改動很細微」——
//       > 那一面根本沒有被畫。**
//
//     參考專案實測過三次:屋頂平板與它蓋住的量體同高(材質連續加深三次,三張截圖逐位元相同)、
//     暖簾掛在正立面線 + 0.06 而門楣板的面也落在那裡、選單列與蓋住它的面板共面(五顆鈕看不見三顆)。
//     本專案的對應處方**不是**「再加一點高度」而是兩條:
//       ・**lift 階梯**(`ground.js`:底毯 `CLIFT` 0.070 < 外溢 [0.100, 0.107] < 不規律 fade
//         [0.110, 0.124] < 規律 ink [0.135, 0.172] < 道路 0.18)—— 每一層都有自己的一格,
//         而那個間距是被 `SAG` 的上限吃掉的(`SAG.ROAD` 0.10 < 路面 0.18 − 底毯 0.07 的餘裕);
//       ・**`polygonOffset`** —— 給「本來就該同高」的那幾件(`biomes.js` 的路面 −2 / 橋面 −3 /
//         明隧道頂板 −1 / `UND.COPE` 緣石帶 −1):抬不動的地方就把它往鏡頭拉。
//     ⇒ **加第六層地被、或讓任何新的貼地件與地形同高之前,MUST 先問它拿到階梯上的哪一格**;
//     兩件擠進同一格的症狀是「某個角度看得到、換個角度不見了」,而本支的每一條斷言照樣全綠
//     (它量的是**規劃**:選款 / 變體 / 認養歸屬,不是「畫出來之後誰贏」)。
//  ㋑ **共面是這一段刻意選的,所以它的保證 MUST 由「同一份三角形」給,不是由高度差給。**
//     Ⅳ 釘的「索引序與 `terrain.js` 的 `(a,c,b)(b,c,d)` 逐字同向」正是這件事:同一組頂點 +
//     同一個繞向 ⇒ 兩片在數值上是同一個平面、深度值逐位元相同 ⇒ **z-fight 不是被壓下去、
//     是不存在**。反過來說,任何「順手把認養那一層抬 1 cm」的修法都會**再造一次破圖**
//     (那正是 `audit_ground_drape` 量的另一半:抬過頭 = 草皮蓋過馬路)。
//  ㋒ **驗收面不在這一支。**「誰贏了那枚硬幣」只有像素比得出來 ⇒ `tools/shot_scene.mjs` 的
//     定場照 A/B(㋓)是唯一的判決面,而它的檔頭寫著同一條判讀法。本支守的是**上游**:
//     認養歸屬恰一個主人、共用邊逐位元同值、圖內不再套 `drapeSag`。
'use strict';
import { readSrc } from './audit_src.mjs';

let fail = 0;
const bad = (m, x = '') => { console.log('  ✗', m, x); fail++; };
const ok = (m) => console.log('  ✓', m);
const t = (m, cond, x = '') => (cond ? ok(m) : bad(m, x));

const BREAK_LOT = process.argv.includes('--break-lot');
const BREAK_VAR = process.argv.includes('--break-var');
const BREAK_ADOPT = process.argv.includes('--break-adopt');
const BREAK_ORDER = process.argv.includes('--break-order');

const src = readSrc('public', 'js', 'ground.js');
const grab = (re, name) => {
  const m = src.match(re);
  if (!m) { console.log(`x ground.js 原文抽取失敗:${name}`); process.exit(1); }
  return m[0].replace('export ', '');
};
// 四支皆零依賴純函式/純資料 ⇒ 抽原文直接執行真品(抄一份公式進稽核 = 驗自己抄對沒有)
const VNOISE = grab(/function vnoise\(x, z, seed\) \{[\s\S]*?\n\}/, 'vnoise');
const LOT_CFG = grab(/export const CARPET_LOT = .*$/m, 'CARPET_LOT');
const SEL_CFG = grab(/export const CARPET_SEL = .*$/m, 'CARPET_SEL');
const LOT_FN = grab(/export function carpetLotAt\([\s\S]*?\n\}/, 'carpetLotAt');
const VAR_FN = grab(/export function planCarpetVariants\([\s\S]*?\n\}/, 'planCarpetVariants');
// 顏色路徑排序那一族(2026-08-13):代表色表 + 色距 + 排序,四支同樣零依賴 ⇒ 執行真品
const BRICK = grab(/const BRICK_C = \[[\s\S]*?\];/, 'BRICK_C');
const HEXOF = grab(/const hexOf = .*$/m, 'hexOf');
const MEANH = grab(/const meanHex = \([\s\S]*?\n\};/, 'meanHex');
const COLTAB = grab(/export const SUB_COL = \{[\s\S]*?\n\};/, 'SUB_COL');
const COLD = grab(/export function colDist\(h1, h2\) \{[\s\S]*?\n\}/, 'colDist');
const ORDER = grab(/export function carpetOrder\([\s\S]*?\n\}/, 'carpetOrder');
const CARPET = new Function(`${src.match(/const CARPET = \{[\s\S]*?\n\};/)[0]}\nreturn CARPET;`)();
const ENCST = new Function(`${src.match(/export const ENCLAVE_STYLES = \{[\s\S]*?\n\};/)[0].replace('export ', '')}
  return ENCLAVE_STYLES;`)();
const M = new Function(`${VNOISE}\n${LOT_CFG}\n${SEL_CFG}\n${LOT_FN}\n${VAR_FN}
  ${BRICK}\n${HEXOF}\n${MEANH}\n${COLTAB}\n${COLD}\n${ORDER}
  return { vnoise, CARPET_LOT, CARPET_SEL, carpetLotAt, planCarpetVariants,
           SUB_COL, colDist, carpetOrder };`)();
const { vnoise, CARPET_LOT, CARPET_SEL, carpetLotAt, planCarpetVariants,
        SUB_COL, colDist, carpetOrder } = M;

console.log('== Ⅰ 選款區塊(顏色的最小尺度)==');
{
  t(`抖動 ${CARPET_LOT.JIT} < 0.5 格距(超過的話最近的 lot 中心會落在 3×3 候選之外 = 分割破洞)`,
    CARPET_LOT.JIT < 0.5 - 1e-9);
  t(`區塊間距 ${CARPET_LOT.CELLS} 格(以底毯格數計 ⇒ 改 cell 自己跟著走,不手寫公尺數)`,
    Number.isInteger(CARPET_LOT.CELLS) && CARPET_LOT.CELLS >= 3);
  // 3×3 候選夠不夠:與 7×7 暴力搜尋逐格比對(這是 JIT < 0.5 的行為證明,不是重述那個常數)
  const S = CARPET_LOT.CELLS, JIT = CARPET_LOT.JIT, SEED = 0xC0FFEE | 0;
  const site = (li, lj) => [
    (li + 0.5 + (vnoise(li, lj, (SEED ^ 0x1F3A) | 0) - 0.5) * 2 * JIT) * S,
    (lj + 0.5 + (vnoise(li, lj, (SEED ^ 0x77C1) | 0) - 0.5) * 2 * JIT) * S];
  let brute = 0;
  for (let j = -20; j < 60; j++) {
    for (let i = -20; i < 60; i++) {
      const gi = Math.floor(i / S), gj = Math.floor(j / S);
      let bi = null, bd = Infinity;
      for (let oj = -3; oj <= 3; oj++) {
        for (let oi = -3; oi <= 3; oi++) {
          const [cx, cz] = site(gi + oi, gj + oj);
          const d = (cx - i - 0.5) ** 2 + (cz - j - 0.5) ** 2;
          if (d < bd) { bd = d; bi = [gi + oi, gj + oj]; }
        }
      }
      const got = carpetLotAt(i, j, SEED);
      if (got[0] !== bi[0] || got[1] !== bi[1]) brute++;
    }
  }
  t('最近點分割正確:3×3 候選與 7×7 暴力搜尋逐格同解(6400 格)', brute === 0, `（${brute} 格分歧）`);
  t('決定性(同輸入重呼逐位元相同)',
    JSON.stringify(carpetLotAt(7, 11, SEED)) === JSON.stringify(carpetLotAt(7, 11, SEED)));
  t('純函式:carpetLotAt / planCarpetVariants 原文零 rnd / 零 Math.random / 零 THREE(§2.3、A4)',
    !/\brnd\s*\(|Math\.random|THREE/.test(LOT_FN) && !/\brnd\s*\(|Math\.random|THREE/.test(VAR_FN));

  // ---- 換款間距:兩組對照 ----
  //   ㋐ 現行公式 + 取值點改回格心 —— 量的是「lot 這一層自己有沒有在做事」;
  //   ㋑ **凍結的出貨基準**(2026-08-12 那一版:格心取值 + W 0.006 + SPAN 2.2)—— 量的是
  //      「使用者這一輪回報的東西改善了多少」。㋑ 的兩個數字 MUST 手寫並標明是歷史值:
  //      跟著 CARPET_SEL 走的話,調完頻率之後這一條就是拿新制跟新制比,恆綠(2026-08-13
  //      實測:㋐ 的短段比例自己就掉到 4%,舊的「≤ 對照組 1/4」當場失去牙齒)。
  const LEGACY = { W: 0.006, SPAN: 2.2 };
  const CELL = 13, LIST = CARPET.bare.length;
  const pickAt = (wx, wz, cfg = CARPET_SEL) => {
    const t2 = Math.min(0.999, Math.max(0,
      (vnoise(wx * cfg.W, wz * cfg.W, SEED) - 0.5) * cfg.SPAN + 0.5));
    return (t2 * LIST) | 0;
  };
  const runs = (useLot, cfg = CARPET_SEL) => {
    const out = [];
    for (let j = 0; j < 160; j++) {
      let cur = -1, len = 0;
      for (let i = 0; i < 160; i++) {
        let wx, wz;
        if (useLot) {
          const [, , li, lj] = carpetLotAt(i, j, SEED);
          wx = li * CELL; wz = lj * CELL;
        } else { wx = (i + 0.5) * CELL; wz = (j + 0.5) * CELL; }
        const s = pickAt(wx, wz, cfg);
        if (s === cur) len++;
        else { if (cur >= 0) out.push(len); cur = s; len = 1; }
      }
      out.push(len);
    }
    return out.sort((a, b) => a - b);
  };
  const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  const lot = runs(!BREAK_LOT), cellC = runs(false), legacy = runs(false, LEGACY);
  const lotP50 = q(lot, 0.5) * CELL, cellP50 = q(cellC, 0.5) * CELL, legP50 = q(legacy, 0.5) * CELL;
  // 「短距離快速變化」= **短**的那一截有多常見(平均值看不出來:舊制的分布是雙峰的 ——
  // 大片穩定區 + 雜訊場陡處那幾條「每一格都換一款」的帶,而使用者看到的正是後者)
  const shortShare = (a) => a.filter((v) => v * CELL < CELL * 2).length / a.length;
  const lotR = shortShare(lot), cellR = shortShare(cellC), legR = shortShare(legacy);
  // 下界錨在區塊間距:同一個 lot 內恆為同一款 ⇒ 一段同款至少要有一個 lot 那麼寬
  const floorM = CARPET_LOT.CELLS * CELL * 0.8;
  t(`同款連續長度中位數 ${lotP50.toFixed(0)}m ≥ 一個區塊 ${floorM.toFixed(0)}m`
    + `(同公式取格心 ${cellP50.toFixed(0)}m / 2026-08-12 出貨基準 ${legP50.toFixed(0)}m)`,
    lotP50 >= floorM, `（每 ${lotP50.toFixed(0)}m 才換一次顏色）`);
  // 短段比例只跟**出貨基準**比:同公式取格心那一組印出來當參考,但它已經吃了新的低頻場
  // ⇒ 它自己就很低,拿它當門檻等於拿新制跟新制比(有牙的是上面那條中位數)
  t(`「走不到兩格就換色」${(lotR * 100).toFixed(1)}% ≤ 2026-08-12 出貨基準 ${(legR * 100).toFixed(0)}% 的`
    + `四分之一(同公式取格心 ${(cellR * 100).toFixed(1)}%)`,
    lotR <= legR / 4, `（這一條就是使用者說的「短距離快速變化」）`);
  if (BREAK_LOT) console.log('  （--break-lot:取值點改回格心 ⇒ 上面兩條 MUST 紅字）');
}

console.log('\n== Ⅱ 逐格花紋(同顏色的相鄰拼圖畫不同的圖案)==');
{
  const V = 3, SEED = 0x5EED | 0;
  // 舊制對照組:變體 = 低頻雜訊(波長遠大於格距)⇒ 大片同變體
  const oldVar = (subs, gnx, gnz) => {
    const out = new Array(gnx * gnz).fill(0);
    for (let j = 0; j < gnz; j++) {
      for (let i = 0; i < gnx; i++) {
        out[j * gnx + i] = Math.min(V - 1, (vnoise(i * 0.03, j * 0.03, SEED) * V) | 0);
      }
    }
    return out;
  };
  const plan = BREAK_VAR ? oldVar : (s, a, b) => planCarpetVariants(s, a, b, { seed: SEED, variants: V });
  // 格網:大片同款 + 異款區塊 + '!' 崖 + null 未鋪(三種非款值都要走到)
  const N = 40;
  const subs = new Array(N * N).fill(null);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      subs[j * N + i] = (i === 7 && j === 7) ? '!' : (i === 9 && j === 9) ? null
        : (i < 24 ? 'turf' : (i < 32 ? 'meadow' : 'turf'));
    }
  }
  const stat = (v) => {
    let edgeSame = 0, edgeN = 0, diagSame = 0, diagN = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const s = subs[j * N + i];
        if (s == null || s === '!') continue;
        for (const [di, dj, edge] of [[1, 0, 1], [0, 1, 1], [1, 1, 0], [-1, 1, 0]]) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          if (subs[nj * N + ni] !== s) continue;               // 約束只在同款之間成立
          const same = v[nj * N + ni] === v[j * N + i];
          if (edge) { edgeN++; if (same) edgeSame++; } else { diagN++; if (same) diagSame++; }
        }
      }
    }
    return { edgeSame, edgeN, diagSame, diagN };
  };
  const out = plan(subs, N, N);
  const A = stat(out), C = stat(oldVar(subs, N, N));   // C = 舊制對照組(低頻雜訊變體)
  t(`共邊的同款鄰格**恆**不同變體(${A.edgeN} 對;硬條件)`, A.edgeN > 0 && A.edgeSame === 0,
    `（${A.edgeSame} 對同變體 = 兩張一樣的貼圖貼在一起）`);
  // 對角只共用一個角點,而 3 變體 × 8 鄰在數學上做不到全異(一個 2×2 方塊裡四格兩兩相鄰,
  // 要全異得要 4 色 = 每款多一個 mesh)—— 使用者原話也是「**盡可能**」。有牙的門檻錨在對照組:
  // 舊制那一版的對角同變體率接近 1.0,新制 MUST 掉到一半以下
  t(`對角的同款鄰格「盡可能」不同:同變體率 ${(A.diagSame / A.diagN).toFixed(2)}(舊制對照組 ` +
    `${(C.diagSame / C.diagN).toFixed(2)})`,
    A.diagN > 0 && A.diagSame / A.diagN < 0.55 && A.diagSame / A.diagN < C.diagSame / C.diagN * 0.7,
    `（同變體 ${A.diagSame}/${A.diagN}）`);
  t('三個變體都用得到(只用兩個 = 白白少一種花紋)',
    new Set(out.filter((v, k) => subs[k] != null && subs[k] !== '!')).size === V);
  t("'!' 崖與 null 未鋪格不指派變體(維持 0,不影響 keys 組裝)",
    out[7 * N + 7] === 0 && out[9 * N + 9] === 0);
  t('決定性(同一份輸入跑兩次逐位元相同)',
    JSON.stringify(planCarpetVariants(subs, N, N, { seed: SEED, variants: V })) === JSON.stringify(
      planCarpetVariants(subs, N, N, { seed: SEED, variants: V })));
  // 異款不受約束:兩款交界處,雙方各自挑各自的(不會因為隔壁是別款就綁手綁腳)
  const border = [];
  for (let j = 0; j < N; j++) border.push(out[j * N + 23], out[j * N + 24]);
  t('異款之間不設限(交界兩側各挑各的:異款本來就是兩張不同的貼圖)', new Set(border).size >= 2);
  if (BREAK_VAR) console.log('  （--break-var:變體改回低頻雜訊 ⇒ 共邊那一條 MUST 紅字）');
}

console.log('\n== Ⅲ 靜態規則(執行原文)==');
{
  const strip = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  // ① 底色不隨變體漂移(「**同顏色的**相鄰拼圖」這句話本身的要求)
  const bf = grab(/function baseFill\(hex, rnd\) \{[\s\S]*?\n\}/, 'baseFill');
  t('baseFill 不把底色抖開(同種地表的全部變體共用同一個底色 ⇒ 逐格換變體 ≠ 逐格換顏色)',
    !/rnd\(\)\s*-\s*0\.5/.test(bf) && /return `rgb\(\$\{hex >> 16 & 255\}/.test(bf));
  t('仍照抽三枚亂數(每一支畫筆後續的筆觸序列逐位元同舊制 —— 改的只有底色那一格)',
    /for \(let k = 0; k < 3; k\+\+\) rnd\(\);/.test(bf));
  t('舊的 vary(逐變體抖底色)已無殘留', !/\bvary\(/.test(strip(src)));
  // ② 選款取 lot 中心、變體整張一次挑
  const subFn = grab(/const cellSubAt = \(i, j, zn\) => \{[\s\S]*?\n  \};/, 'cellSubAt');
  t('cellSubAt 的取值點 = 選款區塊中心(carpetLotAt 單一縫;場的公式一格未動)',
    /const \[, , li, lj\] = carpetLotAt\(i, j, seed\);/.test(subFn)
    && /vnoise\(lx \* CARPET_SEL\.W, lz \* CARPET_SEL\.W, seed\)/.test(subFn)
    && /qcVal\(lx, lz, QC_SEL_W\)/.test(subFn)
    && /const QC_SEL_W = CARPET_SEL\.QC_W;/.test(src));
  t('cellSubAt 只回款名(變體不在這裡挑 —— 逐格獨立挑一定挑得出相鄰同款同變體)',
    !/#\$\{/.test(subFn) && /return list\[\(t \* list\.length\) \| 0\];/.test(subFn));
  t('keys 兩段組裝:整張挑顏色(subGrid)→ 整張挑花紋(planCarpetVariants)→ 合成 key',
    /subGrid\[j \* gnx \+ i\] = cellSubAt\(i, j, zoneGrid\[j \* gnx \+ i\]\)/.test(src)
    && /const varGrid = planCarpetVariants\(subGrid, gnx, gnz, \{ seed, variants: CARPET_VARIANTS \}\)/.test(src)
    && /const key = `\$\{sub\}#\$\{varGrid\[j \* gnx \+ i\]\}`;/.test(src));
  t('enclave 換裝仍接在選款上(唯一真相 ENCLAVE_STYLES;水深仍逐格看)',
    /encRt\.get\(encGrid\[j \* gnx \+ i\]\)\?\.style\.carpet \|\| carpetLists\[zn\]/.test(subFn)
    && /'deepwater' : 'watertile'/.test(subFn));
  // ③ 同款異變體不發外溢(不然整張圖多兩層半透明底毯)
  const seamFn = grab(/export function planSeamOverlays\(keys, gnx, gnz, opts = \{\}\) \{[\s\S]*?\n\}/, 'planSeamOverlays');
  t('planSeamOverlays:同款異變體不發外溢(共用底色 ⇒ 沒有要 cross-fade 的東西)',
    /if \(subOf\(kn\) === subOf\(k0\)\) continue;/.test(seamFn));
  // ④ 緩衝空間底毯
  const bufSeg = src.slice(src.indexOf('// ==== 緩衝空間的底毯'), src.indexOf('// ==== 地貌界線拼圖:規劃'));
  t('緩衝空間底毯存在且只在拿得到 bufferHeightAt 時才鋪(降級不例外,原則 6)',
    bufSeg.length > 400 && /if \(terrain\.bufferHeightAt\) \{/.test(bufSeg));
  t('高度走 terrain.bufferHeightAt(裙的外推高度唯一縫;拿 heightAt 會被夾回圖界)',
    /terrain\.bufferHeightAt,\s*null, null, null\)/.test(bufSeg) && !/terrain\.heightAt/.test(bufSeg));
  t('分區與選款鏡射回圖內取(三角波在圖界上恆等 ⇒ 接縫兩側同款)',
    /const mirror = \(v, lo, hi\) => \{/.test(bufSeg) && /keys\[kj \* gnx \+ ki\]/.test(bufSeg));
  t('格距放粗(BUF_CELL_F;原尺寸鋪滿要多兩倍半的格子)', /const bcell = cell \* BUF_CELL_F;/.test(bufSeg));
  t('發射進圖內同一批 buckets(底毯 carpetBuckets / 外溢 spillBuckets ⇒ 一個 draw call 都沒有多)',
    /emitFace\(carpetBuckets,/.test(bufSeg) && /emitFace\(ov\.st\?\.band \? bandBuckets : spillBuckets,/.test(bufSeg));
  t('圖內那一格沒鋪(崖/灘線/灰帶)⇒ 界外也不鋪(寧缺勿錯)',
    /if \(!key \|\| key === '!'\) continue;/.test(bufSeg));
  t('零共享 rnd 消耗(§2.3:插在建構流程任何位置都不推移植被佈局)',
    !/\brnd\s*\(/.test(bufSeg) && !/Math\.random/.test(bufSeg));
  t('界線拼圖 / 特徵拼圖 / 3D 細節都不進緩衝空間(那些要吃共享 rnd 序列與空間索引)',
    !/tryPatch|addDetail|planBorderPuzzle|scatterDetails/.test(bufSeg));
  // 粗格 + 硬邊 = 一床方塊拼被(2026-08-12 實拍):角點抖動 + 交界外溢缺一不可,
  // 而外溢 MUST 走圖內那一支規劃器(單一縫)
  t('角點抖動,但圖界那兩條線上的角點不動(那是與真地形的接縫,動了就開縫)',
    /\(i === nOut \|\| i === inX\) \? 0 :/.test(bufSeg) && /\(j === nOut \|\| j === inZ\) \? 0 :/.test(bufSeg));
  t('交界外溢走圖內同一支 planSeamOverlays(單一縫;少了它粗格之間就是硬邊直角)',
    /for \(const ov of planSeamOverlays\(bkeys, bnx, bnz,/.test(bufSeg));
  // ⑤ 貼地面發射只有一份實作,而且**圖內不再經過它**(2026-08-13 起圖內走認養,見 Ⅳ)
  t('貼地 3×3 面只有 emitFace 一份實作 + face9 一份排列,且只剩緩衝空間在呼叫',
    (src.match(/const emitFace = /g) || []).length === 1
    && (src.match(/const face9 = /g) || []).length === 1
    && (strip(src).match(/emitFace\(/g) || []).length === 2
    && (strip(bufSeg).match(/emitFace\(/g) || []).length === 2);
  t('高度來源由呼叫端注入(圖內 terrain.heightAt / 緩衝空間 terrain.bufferHeightAt)',
    /const emitFace = \(bmap, key, G, hAt, alphas, st, cut\) => \{/.test(src)
    && /G\.map\(\(\[px, pz\]\) => hAt\(px, pz\)\)/.test(src));
}

// ==== Ⅳ 認養地形三角形(2026-08-13 使用者定案「A 認養地形三角形」)====
// 舊制底毯自己切 3×3,頂點取 heightAt ⇒ 頂點在地形上而頂點之間是直的;地形是逐格三角化的
// 高度場 ⇒ 跨過折角的弦沉在地形下(斜坡破圖)。新制:皮的三角形 === 地形的三角形。
// 這一段量兩種東西 ——
//   ㋐**幾何規則**(抽 inQuad / invBil 原文直接跑):認養分割 MUST 是「每個點恰一個主人」
//     (缺一個 = 那塊地形直接露出來、多一個 = 兩張皮互疊 z-fighting),而且主人恆在 3×3 內;
//     反雙線性在四角恆等 ⇒ 相鄰格共用的地形頂點兩邊算出同一個 α,外溢不開縫。
//   ㋑**接線**(執行原文):索引序與 terrain.js 的三角化逐字同向、灘線閘仍整格判、圖內不再
//     套貼合抬升、地形頂點數推導不手寫。
// 反向驗證 `--break-adopt`:認養判定退回「拿對角線把四邊形拆成兩個三角形」——
// 抖動後的四邊形可以是凹的,對角線會跑到多邊形外 ⇒「無重疊」那一條 MUST 紅字(實測 13 個探針
// 被兩格同時認養 = 兩張皮互疊)。
console.log('\n== Ⅳ 認養地形三角形 ==');
{
  const strip = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const IN_Q = grab(/  const inQuad = \(Q, px, pz\) => \{[\s\S]*?\n  \};/, 'inQuad');
  const INV_B = grab(/  const invBil = \(Q, px, pz\) => \{[\s\S]*?\n  \};/, 'invBil');
  const GEO = new Function(`${IN_Q}\n${INV_B}\nreturn { inQuad, invBil };`)();
  t('inQuad / invBil 原文零 rnd / 零 Math.random / 零 THREE(§2.3、A4)',
    !/\brnd\s*\(|Math\.random|THREE/.test(IN_Q + INV_B));

  // 合成一張抖動角點格(振幅 = ground.js clampD 的 0.45 上界),用**真品** inQuad 認養
  const JIT = 0.45, SEED = 0x5EED | 0;
  const corn = (i, j) => [
    i + (vnoise(i, j, (SEED ^ 0x9E37) | 0) - 0.5) * 2 * JIT,
    j + (vnoise(i, j, (SEED ^ 0x85EB) | 0) - 0.5) * 2 * JIT];
  const quad = (i, j) => [corn(i, j), corn(i + 1, j), corn(i + 1, j + 1), corn(i, j + 1)];
  // 對照組:拿對角線拆兩個三角形(凹四邊形會漏/重)—— --break-adopt 換上它
  const triSide = (A, B, C, px, pz) => (B[0] - A[0]) * (pz - A[1]) - (B[1] - A[1]) * (px - A[0]);
  const inTri = (A, B, C, px, pz) => {
    const s = Math.sign(triSide(A, B, C, px, pz)), u = Math.sign(triSide(B, C, A, px, pz)),
          v = Math.sign(triSide(C, A, B, px, pz));
    return (s >= 0 && u >= 0 && v >= 0) || (s <= 0 && u <= 0 && v <= 0);
  };
  const OWN = BREAK_ADOPT
    ? (Q, px, pz) => inTri(Q[0], Q[1], Q[2], px, pz) || inTri(Q[0], Q[2], Q[3], px, pz)
    : GEO.inQuad;
  const LO = 4, HI = 20, STEP = 0.137;          // 探針步距刻意取無理數狀:避開恰落在格線上
  let none = 0, dup = 0, far = 0, probes = 0, concave = 0;
  for (let i = LO; i < HI; i++) {
    for (let j = LO; j < HI; j++) {
      const Q = quad(i, j);                      // 凹不凹:對角線 P0P2 是否落在多邊形外
      const mid = [(Q[0][0] + Q[2][0]) / 2, (Q[0][1] + Q[2][1]) / 2];
      if (!GEO.inQuad(Q, mid[0], mid[1])) concave++;
    }
  }
  for (let px = LO + 1; px < HI - 1; px += STEP) {
    for (let pz = LO + 1; pz < HI - 1; pz += STEP) {
      probes++;
      const owners = [];
      for (let i = LO; i < HI; i++) for (let j = LO; j < HI; j++) if (OWN(quad(i, j), px, pz)) owners.push([i, j]);
      if (!owners.length) { none++; continue; }
      if (owners.length > 1) dup++;
      // 主人恆在名義格的 3×3 內(ground.js 的候選範圍就是這個;抖動 < 0.45 的行為證明)
      if (owners.some(([i, j]) => Math.abs(i - Math.floor(px)) > 1 || Math.abs(j - Math.floor(pz)) > 1)) far++;
    }
  }
  t(`抖動 ${JIT} 格會生出凹四邊形(${concave} / ${(HI - LO) ** 2} 格)—— 對角線拆法本來就不成立`,
    concave > 0);
  t(`認養分割無破洞:每個點都有主人(${probes} 個探針)`, none === 0, `（${none} 個無主 ⇒ 那塊地形直接露出來）`);
  t('認養分割無重疊:沒有點被兩格同時認養(半開邊)', dup === 0, `（${dup} 個重複 ⇒ 兩張皮互疊 z-fighting）`);
  t('主人恆落在名義格的 3×3 候選內(ground.js 只掃 3×3 的行為證明)', far === 0, `（${far} 個落在候選之外）`);

  // 反雙線性:四角恆等 + 共用邊上兩格算出同一個 α(外溢淡出不開縫)
  let cornErr = 0, seamErr = 0;
  const A4 = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let i = LO; i < HI; i++) {
    for (let j = LO; j < HI; j++) {
      const Q = quad(i, j);
      Q.forEach((P, k) => {
        const [u, v] = GEO.invBil(Q, P[0], P[1]);
        if (Math.abs(u - A4[k][0]) > 1e-6 || Math.abs(v - A4[k][1]) > 1e-6) cornErr++;
      });
    }
  }
  const alphaOf = (i, j) => 0.5 + 0.5 * vnoise(i * 3.1, j * 3.1, SEED);   // 任一份角點 α 場
  const bil = (Q, aa, px, pz) => {
    const [u, v] = GEO.invBil(Q, px, pz);
    return (1 - u) * (1 - v) * aa[0] + u * (1 - v) * aa[1] + u * v * aa[2] + (1 - u) * v * aa[3];
  };
  for (let i = LO; i < HI - 1; i++) {
    for (let j = LO; j < HI - 1; j++) {
      // (i,j) 的右邊 P1P2 === (i+1,j) 的左邊 P0P3(共用兩顆角點)
      const QL = quad(i, j), QR = quad(i + 1, j);
      const aL = [alphaOf(i, j), alphaOf(i + 1, j), alphaOf(i + 1, j + 1), alphaOf(i, j + 1)];
      const aR = [alphaOf(i + 1, j), alphaOf(i + 2, j), alphaOf(i + 2, j + 1), alphaOf(i + 1, j + 1)];
      for (let s = 0; s <= 1; s += 0.25) {
        const px = QL[1][0] + (QL[2][0] - QL[1][0]) * s, pz = QL[1][1] + (QL[2][1] - QL[1][1]) * s;
        if (Math.abs(bil(QL, aL, px, pz) - bil(QR, aR, px, pz)) > 1e-6) seamErr++;
      }
    }
  }
  t('反雙線性在四角恆等(α 端點 0/1 不漂 ⇒ 與不透明底毯仍水密)', cornErr === 0, `（${cornErr} 個角偏差）`);
  t('共用邊上兩格算出同一個 α(相鄰外溢共用的那顆地形頂點不開縫)', seamErr === 0, `（${seamErr} 個取樣分歧）`);

  // ---- 接線(執行原文)----
  const emitSeg = src.slice(src.indexOf('const emitCell = (bmap, key, ti, tj, alphas, st, cut) => {'),
                            src.indexOf('// ==== 多層次地貌:整張 coarse'));
  const adoptSeg = src.slice(src.indexOf('const cellQuads = new Array(gnx * gnz);'),
                             src.indexOf('const emitCell = (bmap, key, ti, tj, alphas, st, cut) => {'));
  const tsrc = readSrc('public', 'js', 'terrain.js');
  t('索引序與 terrain.js 的三角化逐字同向(反對角線 —— 共面的本錢就在這一行)',
    /const a = i \* N \+ j, b = a \+ 1, c = a \+ N, d = c \+ 1;/.test(tsrc)
    && /idx\.push\(a, c, b, b, c, d\);/.test(tsrc)
    && /for \(const \[px, pz\] of \[\[x0, z0\], \[x1, z0\], \[x0, z1\], \[x1, z1\]\]\)/.test(emitSeg)
    && /b\.idx\.push\(b\.base, b\.base \+ 2, b\.base \+ 1, b\.base \+ 1, b\.base \+ 2, b\.base \+ 3\);/.test(emitSeg));
  t('頂點取地形格點座標(tvx / tvz),不再自己切 face9 子格',
    /const x0 = tvx\(quads\[n\]\), x1 = tvx\(quads\[n\] \+ 1\);/.test(emitSeg)
    && /const z0 = tvz\(quads\[n \+ 1\]\), z1 = tvz\(quads\[n \+ 1\] \+ 1\);/.test(emitSeg));
  t('圖內底毯 / 外溢 / 脊帶不再套貼合抬升(共面 ⇒ 虧損恆 0;再抬就是浮在地形上)',
    !/drapeSag/.test(emitSeg) && !/drapeSag/.test(adoptSeg));
  t('灘線閘仍以 face9 九點整格判(landCells 與共享 rnd 序列逐位元同舊制)',
    /const G = face9\(Q\[0\], Q\[1\], Q\[2\], Q\[3\]\);/.test(emitSeg)
    && /Math\.min\(\.\.\.G\.map\(\(\[px, pz\]\) => terrain\.heightAt\(px, pz\)\)\) < 0\.45/.test(emitSeg));
  t('地形頂點數推導不手寫(terrain 只給 x 軸格距;z 軸要用 worldH 自己回推)',
    /const NTV = Math\.round\(terrain\.worldW \/ terrain\.gridM\) \+ 1;/.test(src)
    && /const TGX = terrain\.worldW \/ \(NTV - 1\), TGZ = terrain\.worldH \/ \(NTV - 1\);/.test(src)
    && !/TERRAIN\.GRID_N|GRID_N/.test(src));
  t('認養表建一次、零共享 rnd 消耗(§2.3:不推移植被佈局)',
    !/\brnd\s*\(/.test(strip(adoptSeg)) && /for \(let dj = -1; dj <= 1 && own < 0; dj\+\+\)/.test(adoptSeg)
    && /for \(let di = -1; di <= 1; di\+\+\)/.test(adoptSeg));
  t('無主四邊形記帳外露(結構上恆 0;> 0 = 抖動幅度或候選範圍有人動過,畫面上只是偶爾一格禿掉)',
    /orphanQuads\+\+/.test(adoptSeg) && /orphans: orphanQuads/.test(src));
  if (BREAK_ADOPT) console.log('  （--break-adopt:認養退回對角線拆三角形 ⇒「無重疊」那一條 MUST 紅字）');
}

// ==== Ⅴ 農牧地表的四季設計(2026-08-13 使用者需求)====
// 使用者原話:「田除了田也加入菜園/牧場/魚塭與果園等農牧區,**包含原本的田在內依四季不同
// 而對應設計**」。舊制的季節只有 `SEASON_TINT` 一個乘色濾鏡 —— 那是把整張圖調黃,不是
// 「秋天的水田長什麼樣」。這一段量三件事:
//   ㋐**真的畫了不同的東西**:同一支畫筆跑四季,用一個會記錄每一次繪圖呼叫的假 2D context
//     收下指令流,四季兩兩 MUST 不同。只調底色也會讓指令流不同,所以另外要求**不只底色不同**
//     (去掉第一個 fillStyle 之後仍有差異)—— 否則這一條就退化成在驗那個乘色濾鏡。
//   ㋑**名冊對齊**:畫筆吃 season 的那一批 ⇔ DEFS 標 `seasonal` 的那一批。少標一個就是
//     **調兩次色**(畫筆已經畫成金黃,再乘一層 0xffd9a8 = 褪色的舊照片),而畫面上只是
//     「秋天的田看起來髒髒的」,沒有任何斷言看得出來。
//   ㋒**draw call 不變**:季節只進 groundTex 的快取鍵,bucket 鍵仍是 `sub#variant`。
console.log('\n== Ⅴ 農牧地表四季設計 ==');
{
  const strip = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  // ㋑ 兩份名冊(畫筆簽章 vs DEFS 旗標)MUST 逐一對上
  const painterSeason = [...src.matchAll(/\n {2}(\w+)\(g, S, rnd, season\) \{/g)].map((m) => m[1]).sort();
  const defSeasonal = [...src.matchAll(/\n {2}(\w+):\s*\{[^\n]*seasonal: 1/g)].map((m) => m[1]).sort();
  t(`吃季節的畫筆 ${painterSeason.length} 支 = 標 seasonal 的地表 ${defSeasonal.length} 種`,
    painterSeason.length > 0 && JSON.stringify(painterSeason) === JSON.stringify(defSeasonal),
    `（畫筆 ${painterSeason.join(',')} / DEFS ${defSeasonal.join(',')}）`);
  for (const need of ['paddy', 'dryfield', 'veggiefield', 'orchard', 'pasture', 'teafield',
                      'vineyard', 'fishpond', 'greenhouse', 'abandonedfarm']) {
    if (!painterSeason.includes(need)) bad(`使用者點名的農牧地表 ${need} 沒有四季設計`);
  }
  if (painterSeason.length >= 10) ok('使用者點名的農牧地表(水田/旱田/菜園/果園/牧場/茶園/葡萄園/魚塭/溫室/廢棄農田)全數有四季設計');

  // ㋐ 行為:抽畫筆原文 + 假 context,四季兩兩比對指令流
  const helpers = ['function mulberry32\\(seed\\) \\{[\\s\\S]*?\\n\\}',
                   'const SEASON_I = .*$', 'const seasonI = .*$',
                   'function brushBlob\\(g, x, y, r, rnd\\) \\{[\\s\\S]*?\\n\\}',
                   'function baseFill\\(hex, rnd\\) \\{[\\s\\S]*?\\n\\}']
    .map((re, i) => grab(new RegExp(re, i === 1 || i === 2 ? 'm' : ''), `helper${i}`)).join('\n');
  const bodies = painterSeason
    .map((k) => grab(new RegExp(`\\n {2}${k}\\(g, S, rnd, season\\) \\{[\\s\\S]*?\\n {2}\\},`), `painter:${k}`))
    .join('\n');
  const P = new Function(`${helpers}\nconst P = {${bodies}\n};\nreturn { P, mulberry32 };`)();
  // 假 2D context:把「設了什麼色、畫了什麼」收成一條指令流(不畫像素也量得到差異)
  const recCtx = () => {
    const log = [];
    const h = { beginPath: 0, closePath: 0, fill: 0, stroke: 0, save: 0, restore: 0 };
    const c = { get log() { return log; } };
    for (const k of ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'globalAlpha', 'font']) {
      let v; Object.defineProperty(c, k, { get: () => v, set: (nv) => { v = nv; log.push(`${k}=${nv}`); } });
    }
    for (const k of ['fillRect', 'strokeRect', 'moveTo', 'lineTo', 'arc', 'rect', 'clip',
                     'quadraticCurveTo', 'bezierCurveTo', 'ellipse', 'setLineDash', 'translate', 'rotate']) {
      c[k] = (...a) => log.push(`${k}(${a.map((n) => (typeof n === 'number' ? n.toFixed(2) : n)).join()})`);
    }
    for (const k in h) c[k] = () => log.push(`${k}()`);
    return c;
  };
  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  let sameAny = 0, tintOnly = 0;
  for (const k of painterSeason) {
    const runs = SEASONS.map((sn) => {
      const g = recCtx();
      P.P[k](g, 256, P.mulberry32(0x1234), sn);
      return g.log;
    });
    for (let a = 0; a < 4; a++) {
      for (let b2 = a + 1; b2 < 4; b2++) {
        const ja = JSON.stringify(runs[a]), jb = JSON.stringify(runs[b2]);
        if (ja === jb) { sameAny++; bad(`${k}:${SEASONS[a]} 與 ${SEASONS[b2]} 畫出完全一樣的東西`); }
        // 只換底色 = 這一條退化成乘色濾鏡:把第一個 fillStyle 拿掉之後 MUST 仍有差
        else if (JSON.stringify(runs[a].slice(1)) === JSON.stringify(runs[b2].slice(1))) {
          tintOnly++; bad(`${k}:${SEASONS[a]} 與 ${SEASONS[b2]} 只差一個底色(那就是舊的乘色濾鏡)`);
        }
      }
    }
  }
  if (!sameAny && !tintOnly) ok(`${painterSeason.length} 支畫筆 × 四季 兩兩畫出不同的東西,且不只是換底色`);

  // ㋒ 接線
  t('季節只進 groundTex 的快取鍵,bucket 鍵仍是 sub#variant(一場一個季節 ⇒ draw call 不變)',
    /const ck = `\$\{key\}@\$\{season\}`;/.test(src) && /_texCache\.set\(ck, t\)/.test(src)
    && /PAINTERS\[sub\]\(cv\.getContext\('2d'\), S, mulberry32\(0x67D0 \^ hs\), season\)/.test(src)
    && !/bucketOf\([^)]*season/.test(src));
  t('畫筆種子仍只由 sub#variant 導(同一塊田的壟溝與缺株位置四季不動,只有作物換了)',
    /for \(let i = 0; i < key\.length; i\+\+\) hs = \(hs \* 31 \+ key\.charCodeAt\(i\)\) \| 0;/.test(src));
  t('兩個 mesh 消費端都把 season 傳進去,且對 seasonal 地表跳過 SEASON_TINT(免調兩次色)',
    (strip(src).match(/groundTex\(sub, \+v, [^)]*, season\)/g) || []).length === 2
    && (strip(src).match(/&& !DEFS\[sub\]\.seasonal|&& !def\.seasonal/g) || []).length === 2);
  // 新地表 pasture:五處註冊缺一不可(少一處的症狀各不相同,而都不會報錯)
  const reg = [['PAINTERS', /\n {2}pasture\(g, S, rnd, season\) \{/], ['DEFS', /\n {2}pasture:\s*\{/],
               ['SIZE', /pasture: \[\d+, \d+\]/], ['ZONES.green', /'veggiefield', 'pasture'/],
               ['FAMS.rectFarm', /'abandonedfarm', 'pasture'\]/], ['scatterDetails', /sub === 'pasture'/]];
  const missing = reg.filter(([, re]) => !re.test(src)).map(([n]) => n);
  t(`牧場 pasture 六處註冊齊全(${reg.map(([n]) => n).join(' / ')})`, missing.length === 0,
    `（缺:${missing.join(', ')}）`);
}

console.log('\n== Ⅵ 選款清單的顏色路徑(換款的「幅度」那一半)==');
{
  // 病灶:CARPET_LOT 只讓換款**沒那麼頻繁**,跳的幅度一格未動 —— 清單的索引相鄰若不是顏色
  // 相鄰(綠地那一份的 meadow 土黃 → deadwood 灰 → turf 綠),t 再平滑顏色照樣在跳。
  // ① 代表色名冊 MUST **恰好**涵蓋會出現在底毯上的款(雙向比對;多寫一款 = 沒有消費端的
  //    裝飾欄位,少寫一款 = 那一款排序時被整份清單原地退回,而畫面上只是「這一區還在跳」)
  const want = new Set(['deepwater']);   // 深水不在任何清單裡(cellSubAt 依水深直接指派),仍是底毯款
  for (const zn in CARPET) for (const s of CARPET[zn]) want.add(s);
  for (const k in ENCST) for (const s of ENCST[k].carpet || []) want.add(s);
  const have = new Set(Object.keys(SUB_COL));
  const miss = [...want].filter((s) => !have.has(s));
  const extra = [...have].filter((s) => !want.has(s));
  t(`SUB_COL 恰涵蓋底毯款(CARPET ∪ ENCLAVE_STYLES[].carpet;${want.size} 款)`,
    miss.length === 0 && extra.length === 0, `（缺:${miss.join(',')} 多:${extra.join(',')}）`);
  // ② 畫筆真的吃這張表(否則排序用的是一份與畫面無關的色票)
  const notFed = [...want].filter((s) => s !== 'brick'
    && !new RegExp(`\\n  ${s}\\(g, S, rnd(?:, season)?\\) \\{[\\s\\S]{0,900}?baseFill\\(SUB_COL\\.${s},`).test(src));
  t('每一款底毯畫筆的底色都取自 SUB_COL(brick 是具名例外:代表色由 BRICK_C 推導)',
    notFed.length === 0, `（沒吃到的:${notFed.join(',')}）`);
  t('brick 的代表色由磚色陣列推導,不手寫第二個數字',
    /brick: meanHex\(BRICK_C\)/.test(src) && /const cs = BRICK_C;/.test(src));
  // ③ 排序本身:純函式、保留重數、同款相鄰、瓶頸步距不比原序差
  t('carpetOrder 原文零 rnd / 零 Math.random / 零 THREE(§2.3、A4)',
    !/\brnd\s*\(|Math\.random|THREE/.test(ORDER));
  // 重數指紋 MUST 與鍵序無關(排完插入序本來就變了,直接 JSON.stringify 物件永遠不相等)
  const cnt = (l) => JSON.stringify(Object.entries(
    l.reduce((m2, s) => (m2[s] = (m2[s] || 0) + 1, m2), {})).sort());
  const maxStep = (l) => {
    let mx = 0;
    for (let i = 1; i < l.length; i++) mx = Math.max(mx, colDist(SUB_COL[l[i - 1]], SUB_COL[l[i]]));
    return mx;
  };
  const lists = { ...CARPET };
  for (const k in ENCST) if (ENCST[k].carpet) lists['enc:' + k] = ENCST[k].carpet;
  let weightBad = 0, adjBad = 0, worse = 0, improved = 0;
  for (const k in lists) {
    const a = lists[k], b = BREAK_ORDER ? a.slice() : carpetOrder(a);
    if (cnt(a) !== cnt(b)) weightBad++;   // 重數 = 權重,不得變
    for (const s of new Set(b)) {                                          // 同款 MUST 連成一段
      const f = b.indexOf(s), l = b.lastIndexOf(s);
      if (l - f + 1 !== b.filter((q) => q === s).length) adjBad++;
    }
    const m0 = maxStep(a), m1 = maxStep(b);
    if (m1 > m0 + 1e-9) worse++;
    if (m1 < m0 - 1e-9) improved++;
  }
  t('排序保留重數(重複項 = 權重,排完各款佔比逐位元不變)', weightBad === 0);
  t('同款排在一起(權重成為漸層上的一段平台,不是散在清單各處)', adjBad === 0);
  t('沒有任何一份清單的最大相鄰色距被排壞', worse === 0);
  t(`實際改善的清單數 ${improved}/${Object.keys(lists).length}(0 = 排序沒有在做事)`, improved > 0);
  // ④ 兩個消費端都排到了(冬季覆寫之後、enclave 樣式也要;少一條就是「有些地方還在跳色」)
  t('carpetLists 在冬季覆寫之後才排序(冬季那兩份是新組的清單)',
    src.indexOf('for (const zn in carpetLists) carpetLists[zn] = carpetOrder(carpetLists[zn]);')
      > src.indexOf("carpetLists.alpine = ['icefield'"));
  t('enclave 樣式的底毯清單也排序,且不就地改寫模組級常數',
    /carpet: carpetOrder\(st\.carpet\)/.test(src) && /const style = st\.carpet \? \{ \.\.\.st,/.test(src));
  // ⑤ 紅磚地與水泥地的**實得**佔比(2026-08-13 使用者「大幅調降使用率」)。
  // 這一條 MUST 量實得而不是數格數:選款是「雜訊 → 清單索引」,而雜訊的邊際分布不是均勻的
  // ⇒ 逐槽位的實得佔比與宣告權重不一樣(見 CARPET_SEL 檔頭)。舊制 concrete 又剛好排在
  // 首尾兩個被加成的槽位上 —— 只數格數的話會算出 3/7,實得是 40%。
  {
    const CELL = 13, SEED = 0x5A17C0 | 0;
    const share = (list, want) => {
      const l = carpetOrder(list);
      let hit = 0, tot = 0;
      for (let j = 0; j < 260; j++) for (let i = 0; i < 260; i++) {
        const [, , li, lj] = carpetLotAt(i, j, SEED);
        let t2 = (vnoise(li * CELL * CARPET_SEL.W, lj * CELL * CARPET_SEL.W, SEED) - 0.5)
                 * CARPET_SEL.SPAN + 0.5;
        t2 = Math.min(0.999, Math.max(0, t2));
        tot++;
        if (want.includes(l[(t2 * l.length) | 0])) hit++;
      }
      return hit / tot;
    };
    // 凍結的出貨基準 = 2026-08-12 的市區底毯清單(**不排序**,那時還沒有 carpetOrder)
    const LEGACY_URBAN = ['concrete', 'pavement', 'lawn', 'brick', 'concrete', 'park', 'pavement'];
    const now = share(CARPET.urban, ['brick', 'concrete']);
    const was = share(LEGACY_URBAN.slice(), ['brick', 'concrete']);   // slice ⇒ 不被就地排序
    t(`紅磚地 + 水泥地實得佔市區底毯 ${(now * 100).toFixed(0)}% ≤ 出貨基準 ${(was * 100).toFixed(0)}% 的一半`,
      now <= was / 2, '（使用者 2026-08-13「大幅調降使用率」）');
    (CARPET.urban.filter((s) => s === 'brick').length === 1
      && CARPET.urban.filter((s) => s === 'concrete').length === 1
      && !src.match(/urban: \['helipad'[^\]]*'brick'/))
      ? ok('brick / concrete 在市區底毯各只剩一格,且 brick 已退出特徵層 ZONES.urban')
      : bad('brick / concrete 的格數或特徵層名冊未依定案收斂');
  }
  if (BREAK_ORDER) console.log('  （--break-order:清單維持原序 ⇒ 上面「實際改善的清單數」MUST 紅字）');
}

console.log('\n== Ⅶ 同顏色拼圖上的多種點綴(2026-08-13「草地的小花/沙地的小石頭/水域的游魚」)==');
{
  const scatFn = grab(/function scatterDetails\(sub, x, z, r, rot, def, zn, enc = null\) \{[\s\S]*?\n  \}/, 'scatterDetails');
  const DEFS_SRC = src.match(/const DETAIL_DEFS = \{[\s\S]*?\n\};/)[0];
  const NEW = ['fish', 'shell', 'mushroom'];
  t(`新增三款點綴 ${NEW.join(' / ')} 都有零件表`,
    NEW.every((n) => new RegExp(`\\n  ${n}:\\s*\\[`).test(DEFS_SRC)));
  t('三款都登記了 TILT 與 REG(漏了的那一款會恆直立且恆隨機朝向,不會報錯)',
    NEW.every((n) => new RegExp(`${n}: [\\d.]+`).test(src.match(/const TILT = \{[\s\S]*?\n\};/)[0])
      && new RegExp(`${n}: [\\d.]+`).test(src.match(/const REG = \{[\s\S]*?\n\};/)[0])));
  // 游魚:MUST 進 AQ_DET(免岸線淘汰)且 MUST 沉在水面下(貼在面上 = 浮在水上的魚)
  t("fish 進 AQ_DET(水生細節,免吃岸線高度淘汰)", /AQ_DET = new Set\(\['reed', 'lotuspad', 'fish'\]\)/.test(src));
  t('fish 走 DIVE(沉在水面下)且水深不足就不擺(§4 寧缺勿錯)',
    /const DIVE = \{ fish: [\d.]+ \};/.test(src)
    && /if \(wy == null \|\| terrain\.heightAt\(px, pz\) > wy - dive - [\d.]+\) return;/.test(src)
    && /y = wy - dive;/.test(src));
  // 每一款底毯 MUST 有至少兩種點綴(「同顏色的拼圖上面可以繪製**多個不同**的細節」)
  const carpetSubs = new Set();
  for (const zn in CARPET) for (const s of CARPET[zn]) carpetSubs.add(s);
  const thin = [];
  for (const s of carpetSubs) {
    const m2 = scatFn.match(new RegExp(`sub === '${s}'[\\s\\S]*?(?=\\n *else if|\\n *\\}$)`));
    if (!m2) { thin.push(`${s}(無分支)`); continue; }
    const kinds = new Set([...m2[0].matchAll(/(?:scatter|addDetail)\('(\w+)'/g)].map((x) => x[1]));
    if (kinds.size < 2) thin.push(`${s}(${kinds.size})`);
  }
  t(`每一款底毯地表都撒得出兩種以上的點綴(${carpetSubs.size} 款)`, thin.length === 0,
    `（只有一種:${thin.join(', ')}）`);
  t('水域三款(淺水/深水/荷塘)都有游魚', /sub === 'deepwater'\) scatter\('fish'/.test(scatFn)
    && /scatter\('fish', 3 \+ \(rnd\(\) \* 4 \| 0\), 0\.8, 0\.5\);\n *\}/.test(scatFn)
    && /sub === 'lotus'[\s\S]*?scatter\('fish'/.test(scatFn));
}

for (const [f, m] of [['--break-lot', '取值點改回格心,Ⅰ MUST 紅字(顏色又開始短距離亂跳)'],
  ['--break-var', '變體改回低頻雜訊,Ⅱ MUST 紅字(相鄰同款貼同一張貼圖)'],
  ['--break-order', '清單維持原序,Ⅵ MUST 紅字(索引相鄰不再是顏色相鄰)'],
  ['--break-adopt', '認養退回對角線拆三角形,Ⅳ MUST 紅字(凹四邊形的對角線跑到形外 ⇒ 與鄰格重疊認養)']]) {
  if (process.argv.includes(f)) console.log(`\n（${f}:${m}）`);
}
console.log(`\n${fail === 0 ? '🎉 ALL PASS' : `❌ FAIL(${fail} 項)`}`);
process.exit(fail === 0 ? 0 : 1);
