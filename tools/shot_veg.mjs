// 一般植被零件庫視覺閉環(2026-08-08 §5z-o;整樹節點 `VEG_DEFS.whole` 首批的截圖稽核)
// 同一型植被拍兩張:fallback(不載零件庫 = 舊畫面)vs lib(載入 tree.glb 的整樹節點),
// 走的是**遊戲自己的** `buildVegMeshes` —— 這一點是重點:整樹節點的縫(`whole` 全載到才切換)、
// 材質分列(木質硬 / 葉冠軟且吃季節色)、以及「兩顆節點有沒有真的組成一棵樹」都只在那條路徑上成立。
// 另寫一份組裝器 = 台上那棵跟遊戲裡那棵不是同一棵,而且不會報錯(對照台檔頭紀律 ①)。
//
// **為什麼這一支不能用 shot_giants**:那一支從 biomes.js **原文**重建 GIANT_DEFS、不載零件庫,
// 驗不到 lib 這條路;而整樹節點最大的破圖風險正是「兩顆節點各自縮放 ⇒ 樹散開」(normalize_parts
// `--group` 就是為它加的),那必須在載了庫的真實路徑上看。
//
// 前置:伺服器執行中;Playwright 借用 mapping_elf 的安裝(同 shot_beacons.mjs)。
// **2026-08-08 §5z-t 補上賽璐璐 + 勾線**:在此之前這一支是**黏土**的(自己開一顆
//   `WebGLRenderer` 直接 render,沒有 `postfx.Pipeline`)⇒ 它答得了「兩顆節點有沒有組成一棵樹」,
//   答不了「這個冠形在**賽璐璐勾線**下讀起來如何」。而後者正是 §5y-h / §5z-j / §5z-o / §5z-r
//   連著四輪掛在「未跑」上的那一項 —— 因為另一支有管線的(`shot_scene`)**不載零件庫**,
//   兩邊各缺一半,誰都跑不完那一項。`--post=0` 保留舊的黏土輸出當對照。
// 用法:node tools/shot_veg.mjs [--url http://localhost:8666] [--kinds conifer2,broadleaf,shrub]
//       [--season summer] [--post=0 黏土] [--ink=0 只關勾線]
import { chromium } from 'file:///C:/Users/user/Documents/app/mapping_elf/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('--out', 'tools/.shots/veg'));
const URL = arg('--url', 'http://localhost:8666');
const KINDS = arg('--kinds', 'conifer2,broadleaf,shrub,deadtree').split(',');
const SEASON = arg('--season', 'summer');
const flag = (k) => !process.argv.includes(`--${k}=0`);   // ⚠ MUST 回**布林**:`Pipeline` 的判定是
// `opts.ink !== false`,而 `0 !== false` 為真 ⇒ 回 0/1 的話 `--ink=0`/`--grade=0`/`--fxaa=0`
// **全部是 no-op**(2026-08-08 §5z-t 實測:`--ink=0` 與預設的 PNG 逐位元相同,而那不是
// 「勾線沒作用」,是**旗標沒作用**)。`post` 之所以看起來正常,只因為它在本檔內另被當
// truthy 用(`layers.post ? new Pipeline(...) : null`)—— 一個旗標兩套解讀,壞掉的那半沒人發現。
const LAYERS = { ink: flag('ink'), grade: flag('grade'), fxaa: flag('fxaa'), post: flag('post') };
const SUFFIX = Object.entries(LAYERS).filter(([, v]) => !v).map(([k]) => `_no-${k}`).join('');
const SIZE = 720;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });

for (const useLib of [false, true]) {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  const shots = await page.evaluate(async ({ useLib, KINDS, SEASON, SIZE, layers }) => {
    const THREE = await import('three');
    const { loadPartLibs } = await import('/public/js/partlib.js');
    const { buildVegMeshes } = await import('/public/js/biomes.js');
    const { Pipeline } = await import('/public/js/postfx.js');
    const { updateCelLight } = await import('/public/js/toon.js');
    if (useLib) await loadPartLibs();          // false = 保險絲路徑,證明降級 = 舊畫面

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    // `antialias` MUST 與管線互斥:開了管線就由 FXAA 那一 pass 負責(同 shot_scene),
    // 兩邊都開 = 多付一次 MSAA 而畫面不變。
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: !layers.post });
    renderer.setSize(SIZE, SIZE, false);
    renderer.setClearColor(0x2a2e36, 1);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
    const pipe = layers.post ? new Pipeline(renderer, scene, camera, layers) : null;
    const dir = new THREE.DirectionalLight(0xffffff, 2.1);
    dir.position.set(6, 9, 4);
    scene.add(dir, new THREE.HemisphereLight(0xdff1ff, 0x2b2f38, 1.1));
    scene.add(new THREE.GridHelper(30, 30, 0x4a5160, 0x3a4050));

    const out = [];
    for (const kind of KINDS) {
      // 三株並排:同一型的 instance 變化(朝向/微傾斜)也一起看
      const items = [-4, 0, 4].map((x, i) => ({ x, y: 0, z: 0, s: 1, ry: i * 1.1 }));
      const ms = buildVegMeshes(kind, items, SEASON);
      ms.forEach((m) => scene.add(m));
      // 量真的建出來的那一團(取景 MUST 量台上的幾何,不是宣告值 —— 對照台那條同款教訓)
      const bb = new THREE.Box3();
      ms.forEach((m) => { m.geometry.computeBoundingBox(); bb.expandByObject(m); });
      const top = Math.max(1, bb.max.y);
      for (const [tag, dist, hy] of [['near', top * 2.1, top * 0.55], ['lane', top * 4.2, top * 0.8]]) {
        camera.position.set(dist * 0.80, hy, dist * 0.60);
        camera.lookAt(0, top * 0.45, 0);
        // 勾線門檻吃「離相機多遠 + 掠射角」⇒ MUST 每次移動相機後重算光向與矩陣,
        // 否則暗面與線寬會停在上一個機位(而畫面照樣出得來)。
        camera.updateMatrixWorld(true);
        if (pipe) { updateCelLight(camera); pipe.render(); } else renderer.render(scene, camera);
        out.push({
          name: `${kind}_${tag}_${useLib ? 'lib' : 'fallback'}`,
          png: canvas.toDataURL('image/png'),
          rows: ms.length, top: top.toFixed(2),
          tris: ms.reduce((t, m) => t + Math.round(((m.geometry.index ? m.geometry.index.count
            : m.geometry.attributes.position.count) || 0) / 3), 0),
        });
      }
      ms.forEach((m) => scene.remove(m));
    }
    return out;
  }, { useLib, KINDS, SEASON, SIZE, layers: LAYERS });
  for (const s of shots) {
    fs.writeFileSync(path.join(OUT, `${s.name}${SUFFIX}.png`), Buffer.from(s.png.split(',')[1], 'base64'));
    console.log(`${s.name}${SUFFIX}.png  列數 ${s.rows}  全高 ${s.top}m  單株 ${s.tris} tris`);
  }
  await page.close();
}
await browser.close();
console.log('OUT:', OUT);
