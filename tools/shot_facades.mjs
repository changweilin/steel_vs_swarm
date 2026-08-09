// ============ 立面貼圖視覺閉環(22 款排面 + 屋頂帶標尺)============
// 用法:node tools/shot_facades.mjs [--out tools/.shots/facades]
// 前置:playwright(全域安裝即可;找不到就明確跳過,不擋 CI)。
//
// 為什麼要有這一支:立面貼圖是**畫出來才看得見**的東西,而它壞掉的樣子一律沒有錯誤訊息。
// 已經各踩過一次的兩種:
//   ① **上下顛倒**(2026-08-09 量到):glTF 的 UV 原點在左上、Blender 在左下,匯出端會把 v
//      翻過來,而消費端這張 `CanvasTexture` 的 `flipY` 是預設的 true ⇒ 庫節點的立面是倒的
//      (基座暗帶印在屋簷、遮陽棚印在頂樓),而方盒那條路是正的 —— 同一張圖上兩種方向。
//   ② **窗格印在斜屋頂上**(使用者 2026-08-09 回報):庫節點只有一個材質群組。
// 兩者都只在「看著那張貼圖」時一秒可見,而所有離線閘門全綠。
// 這一支**執行 biomes.js 原文**(不改它的匯出面):把 `wallLayer` / `roofLayer` / `facadeTex`
// 與三張款式表切出來在頁內 eval —— 與離線稽核同一條紀律(驗真品,不抄一份近似)。
//
// 排面上每一款畫兩格:左 = 貼圖本身(**上下翻轉**成 three 取樣後的方向:v=0 在下),
// 右 = 夜間自發光圖。斜頂那六款在 v ∈ [0, ROOF_BAND] 那一條畫紅色標尺 = 屋頂帶的邊界。
import fs from 'node:fs';
import path from 'node:path';
import { chromiumOrNull, chromePath, serve, skipNoPlaywright } from './pw.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('--out', 'tools/.shots/facades'));
// `--only pit` = 只排這幾款(款名前綴);格子數少 ⇒ 同一張圖上每一款看得更大
const ONLY = arg('--only', '');
const COLS = +arg('--cols', 8);

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

const res = await page.evaluate(async ({ ONLY, COLS }) => {
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
    slice('function wallLayer(', '\nfunction facadeTex('),
    slice('function roofLayer(', '\nfunction facadeTex('),
    slice('function facadeTex(', '\n// 一般建物外牆色盤'),
    slice('const FACADES = {', '\n// **斜頂低矮建物專用'),
    slice('const FACADES_PITCHED = [', '\n// ---- 街區色相家族'),
    slice('const MASS = {', '\n// 桶建構表'),
  ].join('\n');
  const mk = new Function('mulberry32', `
    const _facadeCache = new Map();
    const THREE = { CanvasTexture: class { constructor(c) { this.image = c; } }, SRGBColorSpace: 1, NearestFilter: 2 };
    ${code}
    return { facadeTex, FACADES, FACADES_PITCHED, MASS };
  `);
  const { facadeTex, FACADES, FACADES_PITCHED, MASS } = mk(mulberry32);

  // ⚠ `roof` 欄**三張表都有**(方盒那條路拿它當屋頂面的 tint),但屋頂帶只有斜頂那一桶吃
  // —— 排面 MUST 照著遊戲的呼叫端傳參,否則會畫出 16 款「其實沒有的屋頂帶」而看起來很正常
  const rows = [
    ...FACADES.residential.map((d) => ({ ...d, grp: '住宅', roof: 0, rf: '' })),
    ...FACADES.commercial.map((d) => ({ ...d, grp: '商辦', roof: 0, rf: '' })),
    ...FACADES_PITCHED.map((d) => ({ ...d, grp: '斜頂' })),
  ].filter((d) => !ONLY || d.key.startsWith(ONLY));
  if (!rows.length) throw new Error(`--only ${ONLY}:一款都沒對到`);
  const CW = 128, CH = 256, PAD = 10, LAB = 96;
  const cellW = CW * 2 + PAD * 3 + LAB, cellH = CH + PAD * 2 + 16;
  const cv = document.createElement('canvas');
  cv.width = cellW * COLS; cv.height = cellH * Math.ceil(rows.length / COLS);
  const cx = cv.getContext('2d');
  cx.fillStyle = '#141619'; cx.fillRect(0, 0, cv.width, cv.height);
  cx.font = '13px sans-serif'; cx.textBaseline = 'top';
  rows.forEach((d, i) => {
    const t = facadeTex(d.key, d.cols, d.rows, d.winC, d.lit, d.style, d.wall, d.roof, d.rf);
    const ox = (i % COLS) * cellW, oy = Math.floor(i / COLS) * cellH;
    cx.fillStyle = '#cfd6dd';
    cx.fillText(`${d.grp} ${d.key}`, ox + PAD, oy + 2);
    cx.fillText(`${d.wall || 'plainw'}${d.rf ? ' / ' + d.rf : ''}`, ox + PAD, oy + 18);
    // **照畫布原樣貼**:`flipY` 預設為真 ⇒ v=0 採到畫布**底部**,而牆的 UV 是 v = 高度 ⇒
    // 畫布底邊 = 地面、頂邊 = 屋頂線,正好就是「這面牆站起來的樣子」。翻過來反而是錯的。
    for (const [k, img] of [[0, t.map.image], [1, t.emissiveMap.image]]) {
      const x = ox + PAD + k * (CW + PAD), y = oy + 36;
      cx.drawImage(img, x, y);
      cx.strokeStyle = '#59616b'; cx.strokeRect(x - 0.5, y - 0.5, CW + 1, CH + 1);
      if (d.roof) {   // 屋頂帶邊界(v = ROOF_BAND);翻轉後它在下緣往上 BAND 的位置
        const by = y + CH - Math.round(CH * MASS.ROOF_BAND);
        cx.strokeStyle = '#e0483a'; cx.beginPath(); cx.moveTo(x, by + 0.5); cx.lineTo(x + CW, by + 0.5); cx.stroke();
      }
    }
  });
  return { png: cv.toDataURL('image/png'), n: rows.length, band: MASS.ROOF_BAND };
}, { ONLY, COLS });

if (res.error) { console.error(res.error); process.exit(1); }
fs.writeFileSync(path.join(OUT, 'facades.png'), Buffer.from(res.png.split(',')[1], 'base64'));
console.log(`✅ ${res.n} 款立面貼圖(屋頂帶 ${res.band})→ ${path.join(OUT, 'facades.png')}`);
if (errs.length) { console.log('⚠ 頁面錯誤:'); errs.slice(0, 8).forEach((e) => console.log('   ' + e)); }
await browser.close();
srv.close();
