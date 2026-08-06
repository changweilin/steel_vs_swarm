#!/usr/bin/env node
/**
 * families.megalith 三角形預算量測(tri_budget.json 的量測來源;§2.1-6:預算由量測推導,
 * MUST NOT 手寫好看數字)。
 *
 * 為什麼要有這一支(2026-08-06):`families.megalith` 的逐件上限 =
 * `whole_factor × 最重整顆 ÷ 同顆最多庫零件數`,而那兩個輸入原本**量的不是同一個東西** ——
 *   分子 `measured_max_tris: 1071` 只量 `synthMegalith`(岩體本身);
 *   分母 `max_lib_parts_per_rock: 14` 也只數 synthMegalith 的三個迴圈(marble 8 + 崩落塊 4
 *   + 伴生丘 2),**漏掉 `decorateMegalith` 的疊石堆**(最多 3 堆 × 每堆 5 顆 = 15 顆,
 *   而 `megaLibDescs` 自己的檔頭就寫著這份名冊服務「synthMegalith/decorateMegalith」)。
 * 分母漏數 ⇒ 逐件上限被高估;分子漏量 ⇒ 又被低估。兩個方向的偏差都沒有錯誤訊息,
 * 只表現成「這道閘放行了它不該放行的東西」或反過來。故本支把兩者收在**同一次量測**裡:
 * 量的一律是「遊戲裡真的擺出去的那一顆」= `placeMegaliths` 的建造順序
 * (synthMegalith → decorateMegalith → jitterMegalith → bakeContactAO)。
 *
 * 量法(與 tree/building 兩族同律):playwright 頁內執行 **真品** biomes.js 匯出的那三支 +
 * 真 three,逐 mesh `index.count/3` 加總。不需地形/圖資/網路 —— 巨岩的幾何與場地無關。
 *
 * 兩趟(同一組種子、同一條 rnd 序列,故逐顆可對齊):
 *   ① 保險絲趟(不載入零件庫)→ **現值**三角形(= 閘門要比的那個「現值」);
 *   ② 零件庫趟(loadPartLibs)→ 逐顆**庫零件件數**(以 `libGeo` 的頂點數指紋比對 clone)。
 * ② 只在有 `rock.glb` 且名冊非空時有意義;指紋撞號會明講(MUST NOT 靜默取一個)。
 *
 * 用法:node tools/ai3d/measure_megalith_tris.mjs [--seeds 200] [--port 8643]
 */
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumOrNull, chromePath, serve, skipNoPlaywright } from '../pw.mjs';
import { megaLibDescs } from './parts_src.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const SEEDS = +arg('--seeds', '200');
const PORT = +arg('--port', 8643);

const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('巨岩三角形預算量測');

const srv = await serve(PORT);
const browser = await chromium.launch({
  executablePath: chromePath(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 300)));

const THREE_CDN = 'https://unpkg.com/three@0.160.0/build/three.module.js';
const threeLocal = [process.env.THREE_DIR, join(ROOT, 'node_modules', 'three')]
  .filter(Boolean).find((d) => fs.existsSync(join(d, 'build', 'three.module.js')));
if (threeLocal) {
  await page.route('**/three@0.160.0/build/three.module.js',
    (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(join(threeLocal, 'build', 'three.module.js'), 'utf8') }));
  await page.route('**/three@0.160.0/examples/jsm/**', (r) => {
    const rel = r.request().url().split('/examples/jsm/')[1].split('?')[0];
    const f = join(threeLocal, 'examples', 'jsm', rel);
    return fs.existsSync(f)
      ? r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f, 'utf8') })
      : r.abort();
  });
}

// 資產網址是**相對**的(URL 佈局鏡射儲存庫佈局,A28)⇒ 探針頁 MUST 掛 <base href="/public/">,
// 少了它 rock.glb 一律 404 而零件庫**靜默**退回保險絲 —— 第 ② 趟會量到「一顆庫零件都沒有」
// 而看起來完全正常(runbook §7 沉默 bug 1 同款)。
const PROBE_URL = `${srv.url}public/__mega_probe.html`;
await page.route(PROBE_URL, (r) => r.fulfill({
  status: 200, contentType: 'text/html; charset=utf-8',
  body: `<!DOCTYPE html><html><head><meta charset="utf-8"><base href="/public/">
<script type="importmap">{"imports":{"three":"${THREE_CDN}","three/addons/":"https://unpkg.com/three@0.160.0/examples/jsm/"}}</script>
</head><body><canvas id="c" width="320" height="200"></canvas></body></html>`,
}));
await page.goto(PROBE_URL, { waitUntil: 'domcontentloaded' });

const MEGA_NAMES = megaLibDescs().rows.map((r) => r.name);
const res = await page.evaluate(async ({ seeds, names }) => {
  const THREE = await import('three');
  const { synthMegalith, decorateMegalith, jitterMegalith } = await import('/public/js/biomes.js');
  const { bakeContactAO } = await import('/public/js/toon.js');
  const { loadPartLibs, libGeo, PART_LIBS } = await import('/public/js/partlib.js');
  const { mulberry32 } = await import('/public/js/rng.js');

  const tri = (g) => Math.round(((g.index ? g.index.count : g.attributes.position?.count) || 0) / 3);
  const vtx = (g) => g.attributes.position?.count || 0;

  // 一顆巨岩 = placeMegaliths 的建造順序。s 掃描:decorateMegalith 的 `fit`/`seat` 會隨
  // 世界尺寸決定放不放得下疊石堆 ⇒ 件數的最大值出現在哪個 s 是量出來的,不是猜的。
  // s 的取值域鏡射 placeMegaliths:(0.9 + rnd()*0.5) × OVER.mega × cell.sf。
  const S_SWEEP = [0.9, 1.1, 1.3, 1.6, 2.0];
  // 亂數枚數計數器:`draws` 給下面那道「有無零件庫,rnd() 枚數 MUST 逐位元相同」的檢查用
  const draws = [];
  const build = (seed, s) => {
    const raw = mulberry32(seed);
    let n = 0;
    const rnd = () => { n++; return raw(); };
    draws.push(n);   // 佔位,回填在下方
    const slot = draws.length - 1;
    const done = () => { draws[slot] = n; };
    const g = new THREE.Group();
    const meta = synthMegalith(g, rnd);
    decorateMegalith(g, meta.anchor, rnd, s);
    jitterMegalith(g, (seed % 5) / 5, meta.col.r);
    bakeContactAO(g, 6);
    done();
    return { g, main: meta.main };
  };

  const sweep = (countLib, libVtx) => {
    let maxTris = 0, maxTrisAt = null, maxParts = 0, maxPartsAt = null;
    const perMain = {}, all = [];
    for (let i = 0; i < seeds; i++) {
      const seed = (i * 2654435761) >>> 0;
      for (const s of S_SWEEP) {
        const { g, main } = build(seed, s);
        let t = 0, lib = 0;
        g.traverse((o) => {
          if (!o.isMesh && !o.isInstancedMesh) return;
          t += tri(o.geometry) * (o.isInstancedMesh ? o.count : 1);
          if (countLib && libVtx.has(vtx(o.geometry))) lib++;
        });
        all.push(t);
        if (t > maxTris) { maxTris = t; maxTrisAt = { seed, s, main }; }
        if (lib > maxParts) { maxParts = lib; maxPartsAt = { seed, s, main }; }
        perMain[main] = Math.max(perMain[main] || 0, t);
      }
    }
    all.sort((a, b) => a - b);
    const q = (p) => all[Math.min(all.length - 1, Math.floor(all.length * p))];
    return { maxTris, maxTrisAt, maxParts, maxPartsAt, perMain, n: all.length,
      min: all[0], p50: q(0.5), p90: q(0.9) };
  };

  // ① 保險絲趟(零件庫未載入 ⇒ megaGeo 恆 null ⇒ 純程序幾何 = 閘門要比的「現值」)
  const fuse = sweep(false, null);
  const drawsFuse = draws.slice();   // 這一趟逐顆的 rnd() 枚數(下面與零件庫趟逐顆比對)

  // ② 零件庫趟
  await loadPartLibs();
  const loaded = [];
  const libVtx = new Map();          // 頂點數 → 節點名(指紋;撞號要明講)
  const clash = [];
  void PART_LIBS;
  // 名冊 MUST 由 Node 端經 `parts_src.megaLibDescs()` 讀 biomes.js 原文傳進來(單一縫)——
  // 在這裡手抄一份節點清單,名冊一擴充就會漏數,而漏數只表現成「件數比實際少」= 上限算鬆。
  for (const name of names) {
    const g = libGeo(name);
    if (!g) continue;
    loaded.push(name);
    const v = vtx(g);
    if (libVtx.has(v)) clash.push(`${libVtx.get(v)} ↔ ${name}(頂點數 ${v})`);
    else libVtx.set(v, name);
  }
  const base = draws.length;
  const lib = libVtx.size ? sweep(true, libVtx) : null;
  // **有無零件庫,rnd() 枚數 MUST 逐顆逐位元相同**(§2.3 / A4)。這是「整座型」節點
  // (tower/mesa:載到庫就不 add 原 primitive)最容易壞的地方 —— 只要有一個 rnd() 掉進
  // `if (!g2)` 分支裡,載入成功與失敗就會走出兩條共享序列,而畫面上只表現成「這張圖的
  // 植被/巨岩佈局跟隊友的不一樣」,沒有任何錯誤訊息。
  const drawsLib = draws.slice(base);
  const drawDiff = drawsLib.map((v, i) => (v === drawsFuse[i] ? null : `#${i} ${drawsFuse[i]}→${v}`))
    .filter(Boolean);
  return { fuse, lib, loaded, clash, libLoaded: libVtx.size, drawDiff, drawN: drawsLib.length };
}, { seeds: SEEDS, names: MEGA_NAMES });

await browser.close();
await srv.close();

// 分母(同顆最多庫零件數)MUST 取**迴圈上限的解析值**,MUST NOT 取上面那個抽樣最大值:
// 抽樣 max 只是「這 N 顆裡最多的那顆」,拿它當分母會把上限算得比該有的鬆(而鬆掉的閘門
// 不會報錯)。抽樣值的用途是**反向核對這份逐項清單**:量到的件數若超過解析上限,就是
// 清單漏數了某個呼叫點(正是這一支存在的理由 —— 舊帳漏掉 decorateMegalith 的疊石堆)。
// **岩型分支之間互斥**(一顆巨岩只跑 `main` 那一支)⇒ 分支項取「吃庫零件的分支裡最大的
// 那一個」而不是相加:marble 8 件穩居最大,tower/mesa 各只有 1 件(整座一顆)、hoodoo 最多
// 4 根柱 —— 都比 marble 少,故新增這幾個分支**不會**推高分母。崩落塊/伴生丘/疊石則是
// 每一型都會跑到,與分支項相加。
const ANALYTIC = [
  ['synthMegalith 岩型分支最大者(marble 堆塊;tower/mesa 各 1、hoodoo ≤4 均較小)', 'nB = 5 + floor(rnd×4)', 8],
  ['synthMegalith 崩落岩塊', 'nB = 2 + floor(rnd×3)', 4],
  ['synthMegalith 伴生圓丘', 'nSub = floor(rnd×3)', 2],
  ['decorateMegalith 疊石堆', 'n = 1 + floor(rnd×3) 堆 × 每堆 n = 3 + floor(rnd×3) 顆', 3 * 5],
];
const analyticN = ANALYTIC.reduce((a, r) => a + r[2], 0);

const f = res.fuse;
console.log(`\n巨岩三角形預算量測(${SEEDS} 顆種子 × 5 個尺寸 = ${f.n} 顆;建造順序 = placeMegaliths)`);
console.log(`  現值三角形(synthMegalith + decorateMegalith + jitterMegalith,保險絲路徑)`);
console.log(`    min ${f.min} / p50 ${f.p50} / p90 ${f.p90} / **max ${f.maxTris}**`
  + `(seed ${f.maxTrisAt?.seed} s=${f.maxTrisAt?.s} 型 ${f.maxTrisAt?.main})`);
console.log('  逐岩型最重:' + Object.entries(f.perMain).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${k} ${v}`).join(' / '));
if (res.clash.length) console.log('  ⚠ 指紋撞號(件數會少算):' + res.clash.join('、'));
console.log(`  同顆最多庫零件數(解析上限,逐呼叫點迴圈最大值):**${analyticN}** 件`);
for (const [what, how, n] of ANALYTIC) console.log(`    ${String(n).padStart(2)}  ${what}(${how})`);
if (res.lib) {
  if (res.drawDiff.length) {
    console.log(`  ❌ 有無零件庫的 rnd() 枚數不同(${res.drawDiff.length}/${res.drawN} 顆):`
      + res.drawDiff.slice(0, 5).join('、') + ' —— 共享序列會分家(§2.3 / A4)');
    process.exitCode = 1;
  } else {
    console.log(`  ✅ 有無零件庫的 rnd() 枚數逐顆相同(${res.drawN} 顆;§2.3 決定性)`);
  }
  console.log(`  抽樣核對(載入 ${res.libLoaded} 顆節點:${res.loaded.join('、')})`
    + `:實際量到最多 ${res.lib.maxParts} 件`
    + `(seed ${res.lib.maxPartsAt?.seed} s=${res.lib.maxPartsAt?.s} 型 ${res.lib.maxPartsAt?.main})`);
  if (res.lib.maxParts > analyticN) {
    console.log(`  ❌ 抽樣值超過解析上限 ⇒ 上面那份逐項清單漏數了某個呼叫點,先補齊再用這個上限`);
    process.exitCode = 1;
  }
} else {
  console.log('  抽樣核對:零件庫未載入到任何巨岩節點 ⇒ 這一半沒核到(不要拿 0 當結論)');
}
console.log(`  ⇒ 逐件上限 = whole_factor 4.0 × ${f.maxTris} ÷ ${analyticN}`
  + ` = ${Math.round(4.0 * f.maxTris / analyticN)}`);
