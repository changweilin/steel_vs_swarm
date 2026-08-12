// ============ 立面貼圖視覺閉環(逐樓高排面 + 層高讀數 + 屋頂帶標尺)============
// 用法:node tools/shot_facades.mjs [--heights 6,10,16,26,45,70,104] [--only pit] [--cols 7]
// 前置:playwright(全域安裝即可;找不到就明確跳過,不擋 CI)。
//
// 為什麼要有這一支:立面貼圖是**畫出來才看得見**的東西,而它壞掉的樣子一律沒有錯誤訊息。
// 已經各踩過一次的三種:
//   ① **上下顛倒**(2026-08-09 量到):glTF 的 UV 原點在左上、Blender 在左下,匯出端會把 v
//      翻過來,而消費端這張 `CanvasTexture` 的 `flipY` 是預設的 true ⇒ 庫節點的立面是倒的
//      (基座暗帶印在屋簷、遮陽棚印在頂樓),而方盒那條路是正的 —— 同一張圖上兩種方向。
//   ② **窗格印在斜屋頂上**(使用者 2026-08-09 回報):庫節點只有一個材質群組。
//   ③ **窗戶壓縮到太細**(使用者 2026-08-09 回報):貼圖被拉滿那一件的高度 ⇒
//      層高 = 件高 ÷ 列數,而舊制列數是款自帶的常數(商辦 13m 的樓 → 層高 1.1m)。
// 三者都只在「看著那張貼圖」時一秒可見,而所有離線閘門全綠。
// 這一支**執行 biomes.js 原文**(不改它的匯出面):把 `wallLayer` / `roofLayer` / `facadeTex`
// 與款式表 / 層高規則切出來在頁內 eval —— 與離線稽核同一條紀律(驗真品,不抄一份近似)。
//
// 排面的**軸是樓高**(列數由它推導),每一格標著「N 列 = 層高 X m」並在出帶時標紅;
// 左 = 貼圖本身、右 = 夜間自發光圖。有屋頂色那幾款畫兩道紅色標尺 = 屋頂帶 / 素牆帶邊界
// (`MASS.UVB`;2026-08-12 起是三條帶,見 biomes.js 那一段檔頭)。
import fs from 'node:fs';
import path from 'node:path';
import { chromiumOrNull, chromePath, serve, skipNoPlaywright } from './pw.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('--out', 'tools/.shots/facades'));
// `--only pit` = 只排這幾款(款名前綴);格子數少 ⇒ 同一張圖上每一款看得更大
const ONLY = arg('--only', '');
const COLS = +arg('--cols', 8);
// 排面的軸是**樓高**(列數由它推導)——「窗戶太細」就是層高太小,這裡一眼看得到
const HEIGHTS = (arg('--heights', '6,10,16,26,45,70,104') || '').split(',').map(Number).filter((n) => n > 0);

const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('立面貼圖排面');
fs.mkdirSync(OUT, { recursive: true });

const srv = await serve(8634);
const browser = await chromium.launch({ executablePath: chromePath() });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 300)); });
await page.goto(srv.url, { waitUntil: 'domcontentloaded' });

const res = await page.evaluate(async ({ ONLY, COLS, HEIGHTS }) => {
  const { mulberry32 } = await import('/public/js/rng.js');
  const src = await (await fetch('/public/js/biomes.js')).text();
  // 原文切片:兩個畫圖函式 + 三張表。錨點用「宣告的第一行」與「下一個頂層宣告」——
  // 切不到就丟例外(靜默切到空字串會畫出一片白,看起來像「這一款就是純白牆」)
  const slice = (from, to) => {
    const i = src.indexOf(from), j = src.indexOf(to, i + 1);
    if (i < 0 || j < 0) throw new Error(`biomes.js 切不到原文:${from}`);
    return src.slice(i, j);
  };
  const code = [
    // wallLayer → facadeTex 之間的整段(含 roofLayer 與貼圖解析度常數)一次切走:
    // 分成兩片會把中間那一段切兩次,而 `function` 可以重複宣告、`const` 不行
    // ⇒ 症狀是「加一個常數就整支炸掉」,而它與那個常數本身無關
    slice('function wallLayer(', '\nfunction facadeTex('),
    slice('function facadeTex(', '\n// 一般建物外牆色盤'),
    slice('const FACADES = {', '\n// **斜頂低矮建物專用'),
    slice('const FACADES_PITCHED = [', '\n// ---- 街區色相家族'),
    // 結束錨點取**程式碼**:註解一改就切不到,而症狀是整支炸掉或切到空字串
    slice('const STOREY = {', 'function facadeStyle('),
    slice('const MASS = {', '\n// 桶建構表'),
  ].join('\n');
  const mk = new Function('mulberry32', 'objHeightMax', `
    const _facadeCache = new Map();
    const THREE = { CanvasTexture: class { constructor(c) { this.image = c; } }, SRGBColorSpace: 1, NearestFilter: 2 };
    ${code}
    return { facadeTex, FACADES, FACADES_PITCHED, MASS, STOREY, ROW_LADDER, facadeRows };
  `);
  const { objHeightMax } = await import('/public/js/data.js');
  const { facadeTex, FACADES, FACADES_PITCHED, MASS, STOREY, ROW_LADDER, facadeRows } = mk(mulberry32, objHeightMax);

  // ⚠ `roof` 欄**三張表都有**(方盒那條路拿它當屋頂面的 tint),但屋頂帶只有斜頂那一桶吃
  // —— 排面 MUST 照著遊戲的呼叫端傳參,否則會畫出 16 款「其實沒有的屋頂帶」而看起來很正常
  //
  // **列數不在款表上**(2026-08-09):它由那一件的高度推導 ⇒ 排面的軸是**樓高**,
  // 而每一格標著「N 列 = 層高 X m」—— 使用者回報的「窗戶壓縮到太細」就是那個 X。
  const rows = [];
  for (const [cat, grp] of [['residential', '住宅'], ['commercial', '商辦']]) {
    for (const h of HEIGHTS) {
      const d = FACADES[cat][HEIGHTS.indexOf(h) % FACADES[cat].length];
      const rw = facadeRows(h, cat === 'commercial');
      rows.push({ ...d, grp: `${grp} ${h}m`, rw, storey: h / rw, roof: 0, rf: '' });
    }
  }
  for (const d of FACADES_PITCHED) {
    const h = 9;                                   // 低矮那一桶的代表高度(兩層半的穀倉/教堂)
    const rw = facadeRows(h, false);
    rows.push({ ...d, grp: `斜頂 ${h}m`, rw, storey: h / rw });
  }
  const shown = rows.filter((d) => !ONLY || d.key.startsWith(ONLY) || d.grp.includes(ONLY));
  if (!shown.length) throw new Error(`--only ${ONLY}:一款都沒對到`);
  const CW = 128, CH = 256, PAD = 10, LAB = 110;
  const cellW = CW * 2 + PAD * 3 + LAB, cellH = CH + PAD * 2 + 32;
  const cv = document.createElement('canvas');
  cv.width = cellW * COLS; cv.height = cellH * Math.ceil(shown.length / COLS);
  const cx = cv.getContext('2d');
  cx.fillStyle = '#141619'; cx.fillRect(0, 0, cv.width, cv.height);
  cx.font = '13px sans-serif'; cx.textBaseline = 'top';
  shown.forEach((d, i) => {
    const t = facadeTex(`${d.key}r${d.rw}`, d.cols, d.rw, d.winC, d.lit, d.style, d.wall, d.roof, d.rf,
      d.roof ? MASS.UVB.masslow : null, d.win);
    const ox = (i % COLS) * cellW, oy = Math.floor(i / COLS) * cellH;
    cx.fillStyle = '#cfd6dd';
    cx.fillText(`${d.grp} ${d.key}`, ox + PAD, oy + 2);
    cx.fillText(`${d.wall || 'plainw'}${d.rf ? ' / ' + d.rf : ''}`, ox + PAD, oy + 18);
    // 層高就是使用者說的那個量:出帶就標紅
    const bad = d.storey < STOREY.MIN - 1e-9 || d.storey > STOREY.MAX + 1e-9;
    cx.fillStyle = bad ? '#e0483a' : '#8fd694';
    cx.fillText(`${d.rw} 列 = 層高 ${d.storey.toFixed(2)}m`, ox + PAD, oy + 34);
    cx.fillStyle = '#cfd6dd';
    // **照畫布原樣貼**:`flipY` 預設為真 ⇒ v=0 採到畫布**底部**,而牆的 UV 是 v = 高度 ⇒
    // 畫布底邊 = 地面、頂邊 = 屋頂線,正好就是「這面牆站起來的樣子」。翻過來反而是錯的。
    for (const [k, img] of [[0, t.map.image], [1, t.emissiveMap.image]]) {
      const x = ox + PAD + k * (CW + PAD), y = oy + 52;
      // 縮到固定格子:貼圖本身的高度隨列數變(facadeTexH),但牆上看到的比例
      // 是**建物**決定的 ⇒ 排面一律用同一個框,格子才可比
      cx.drawImage(img, x, y, CW, CH);
      cx.strokeStyle = '#59616b'; cx.strokeRect(x - 0.5, y - 0.5, CW + 1, CH + 1);
      if (d.roof) {   // 兩條帶界(v = roof、roof+plain);翻轉後它們在下緣往上的位置
        cx.strokeStyle = '#e0483a';
        for (const f of [MASS.UVB.masslow.roof, MASS.UVB.masslow.roof + MASS.UVB.masslow.plain]) {
          const by = y + CH - Math.round(CH * f);
          cx.beginPath(); cx.moveTo(x, by + 0.5); cx.lineTo(x + CW, by + 0.5); cx.stroke();
        }
      }
    }
  });
  return { png: cv.toDataURL('image/png'), n: shown.length, band: `${MASS.UVB.masslow.roof}/${MASS.UVB.masslow.plain}`, ladder: ROW_LADDER.join(','), storey: [STOREY.MIN, STOREY.MAX] };
}, { ONLY, COLS, HEIGHTS });

if (res.error) { console.error(res.error); process.exit(1); }
fs.writeFileSync(path.join(OUT, 'facades.png'), Buffer.from(res.png.split(',')[1], 'base64'));
console.log(`✅ ${res.n} 格立面貼圖(層高帶 ${res.storey.join('~')}m・列數級距 ${res.ladder}・屋頂/素牆帶 ${res.band})→ ${path.join(OUT, 'facades.png')}`);
if (errs.length) { console.log('⚠ 頁面錯誤:'); errs.slice(0, 8).forEach((e) => console.log('   ' + e)); }
await browser.close();
srv.close();
