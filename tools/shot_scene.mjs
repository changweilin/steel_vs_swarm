// ============ 固定機位定場鏡頭組(V-A;每次視覺改動的前後對照基準)============
// 為什麼要有這一支:既有五支 `shot_*.mjs` 都是**逐功能**的(機體 / 隧道 / 季節 / 巨物 / 鳥巢),
// 沒有任何一組「每個地點各一張、改動前後各拍一次」的定場照 ⇒ 只要回歸發生在**正在改的
// 那個功能之外**,就完全看不見。渲染管線一改(ramp / 天空 / 地形 / 勾線 / 調色 / 描邊)動到的
// 是**整個畫面**,沒有這組基準就等於沒有驗收。
//
// 機位是**推導的,不是手打座標**(手打的一改兵線就對不上,而且看不出來):
//   spawn      兩座主堡,朝兵線方向       spawn_over  以主堡為中心俯查周遭路網
//   lane_mid   各兵線中段                portal_a/b   第一座結構隧道的兩端洞口(有才拍)
//   bridge     第一座橋的橋頭(有才拍)   hilltop      全圖最高點俯瞰兵線
//   waterline  水岸(有水域才拍)         aerial       圖心高空俯瞰
//   road_tangle 剪枝後窄路仍最密集的一格(只在即時 OSM 路網存在時拍)
//   edge_wall  邊界牆(退一步看那一段是哪一款)   edge_far     邊界抬高看緩衝空間與視線邊界背景
//
// 圖層隔離:`--ink=0` / `--dof=0` / `--grade=0` / `--fxaa=0` / `--post=0` / `--curve=0` 各關一層,同一組機位再拍一次
// ⇒ 「這張圖變醜是哪一層造成的」變成可回答的問題,而不是憑印象猜。
//
// ---- A/B 判讀法:**逐位元相同不等於「改動是中性的」**(2026-08-16 併入,
//      `docs/anime_style_plan.md` ④-4;純註解,零行為改動)----
// 這一支是本專案**唯一的像素比對器** ⇒ 「md5 相同」這四個字在整套驗證矩陣裡的份量最重,
// 而它有兩個**方向相反**的意思,分不清就會把最貴的那一種缺陷讀成好消息:
//
//   ㋐ **旋鈕關著 / 純結構重構 ⇒ 逐張相同是要的結果**(「這一輪沒有漏到畫面上」的證明)。
//      前例:2026-08-13 那一輪 13 張定場照 md5 全同、④-1 轉場旋鈕 def = 0 的驗收面也是它。
//      這種比對 MUST 講清楚**比的是哪一組旗標**,而且 pre / post MUST 在**同一輪環境**下拍
//      (見 `docs/shots_baseline.md`:`-prefs` 那一組跨進程不穩定;2026-08-17 起 meta 保留完整
//      浮點機位,舊版把機位四捨五入過的 meta MUST NOT 拿來做像素 A/B)。
//
//   ㋑ **改了材質 / 顏色 / 貼圖而畫面逐像素完全相同 ⇒ 那一面根本沒有被畫。**
//      這是共面兩片的**硬幣拋**(renderer 隨鏡頭任意贏一片),不是「改得太細看不出來」——
//      而後者正是每個人的第一直覺,於是同一個缺陷可以在三次「再加深一點」之後仍然活著
//      (參考專案實測:屋頂平板與它蓋住的量體同高,連續三次加深材質、三張截圖逐位元相同)。
//      本專案的對應處方是 lift 階梯與 `polygonOffset`(全文住 `audit_ground_tile.mjs` 檔頭
//      的「接縫紀律」那一段;`audit_open_tunnel.mjs:56` 也記著同一條)。
//
//   ⇒ **判讀順序 MUST 是「先問這一輪該落在哪一種」再看 md5**:預期會變而沒變 = ㋑ 的紅燈,
//      MUST 用 `--ink=0` / `--post=0` 之類的圖層隔離、或把那一面單獨挪高一點,確認它到底
//      有沒有進 draw call —— **MUST NOT** 就此推論成「這個改動是中性的」。
//      ⚠ 這一族**沒有任何離線稽核看得到**:共面的兩片在每一支 audit 上都是合法的(它們量的是
//      規劃與幾何規則,不是「畫出來之後誰贏」),所以這條判讀法本身就是驗收面的一部分。
//
// 前置與 shot_tunnels.mjs 完全相同(Playwright + terrarium 高程 + 合成圖資),
// **找不到 playwright 就印一行說明並以 0 結束**(A2:MUST NOT 寫進 package.json)。
// 用法:node tools/shot_scene.mjs [--venue taroko] [--team 1] [--out DIR] [--ink=0] [--dof=0] [--curve=0] [--live|--scene-cache FILE]
//                                [--pref inkMrt=on] [--pref lutSrc=baked]  ← 設定頁旋鈕
//                                [--time day|dusk|night] [--season …] [--weather …]
import fs from 'node:fs';
import path from 'node:path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumOrNull, chromePath, serve, skipNoPlaywright } from './pw.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const flag = (k) => !process.argv.includes(`--${k}=0`);   // ⚠ MUST 回**布林**:`Pipeline` 的判定是
// `opts.ink !== false`,而 `0 !== false` 為真 ⇒ 回 0/1 的話 `--ink=0`/`--grade=0`/`--fxaa=0`
// **全部是 no-op**(2026-08-08 §5z-t 實測:`--ink=0` 與預設的 PNG 逐位元相同,而那不是
// 「勾線沒作用」,是**旗標沒作用**)。`post` 之所以看起來正常,只因為它在本檔內另被當
// truthy 用(`layers.post ? new Pipeline(...) : null`)—— 一個旗標兩套解讀,壞掉的那半沒人發現。
const has = (k) => process.argv.includes(k);
const VENUE = arg('--venue', 'taroko');
const TEAM = +arg('--team', '1');
const OUT = path.resolve(arg('--out', join(ROOT, 'tools', `.shots_scene/${VENUE}`)));
const LIVE = has('--live');
// `--scene-cache` 走 biomes.commitOsmIn 的正式中繼縫，固定同一份已處理 OSM 輸入。
// Overpass 偶發回空時若直接接受，前後圖其實是兩個世界；那不能當道路剪枝證據。
const SCENE_CACHE = arg('--scene-cache', '');
const OSM_CACHE = SCENE_CACHE ? JSON.parse(fs.readFileSync(path.resolve(SCENE_CACHE), 'utf8')) : null;
// `--stations <meta.json>`:**照抄前一輪推導出來的完整浮點機位**再拍一次。
// 為什麼需要:機位是由**世界幾何**推導的(離兵線最近的那株喬木、最高點、第一座橋…),
// 回放不是手打座標(座標仍來自某一輪的推導),
// 只是把「哪一輪」講清楚 —— 而 meta 本來就已經把機位寫進去了。
const STATIONS = arg('--stations', '');
const REPLAY = STATIONS ? JSON.parse(fs.readFileSync(STATIONS, 'utf8')).stations : null;
const ONLY = arg('--only', '').split(',').map((s) => s.trim()).filter(Boolean);
const INK_SELF = arg('--ink-self', '');
const INK_GRAZE = arg('--ink-graze', '');
// `--probe-ndc x,y`:對 `--only` 指定的鏡頭射一條螢幕空間射線,把前八個命中寫進 meta。
// 用來把「截圖上看起來像凸起」變成可重現的幾何證據;座標範圍皆為 -1..1。
const PROBE_NDC = arg('--probe-ndc', '');
const PROBE = PROBE_NDC ? PROBE_NDC.split(',').map(Number) : null;
if (PROBE && (PROBE.length !== 2 || PROBE.some((v) => !Number.isFinite(v) || v < -1 || v > 1))) {
  console.error('--probe-ndc 格式為 x,y,且兩值皆須介於 -1..1');
  process.exit(1);
}
const PORT = +arg('--port', 8632);
// `--time night`(+ `--season` / `--weather`):環境本來寫死 `summer/day/clear`,而**夜間是
// 一整條沒有任何離線工具走過的路** —— `biomes.js` 的 `night` 旗標(`cfg.env?.time === 'night'`)
// 只在夜裡把立面的 `emissiveMap` 點亮,而整棟量體節點正是**唯一吃立面貼圖**的庫節點:
// 盒投影 UV 一錯,白天看到的是「一塊有 tint 的板」、夜裡才會看到「一塊沒有窗的板」,
// 而外廓契約、三角形預算、`--report` 全部照樣綠(§5ab-c 的材質契約就是為這件事立的)。
// 這與 §5z-t 記的是同一種病:**兩支工具各缺一半** ⇒ 那一項就永遠卡著沒人跑得動。
// 非預設值 MUST 進檔名後綴,否則日夜兩輪互相覆寫、事後分不出手上這張是哪一輪。
const ENV = { season: arg('--season', 'summer'), time: arg('--time', 'day'), weather: arg('--weather', 'clear') };
// `--elapsed <真實秒>`:日夜循環走到第幾秒(2026-08-14)。`--time` 從此只是**起點** ——
// 沒有這一支的話,整條時間流逝(以及跟著太陽轉的影子)在離線工具裡一張都拍不到,
// 而每一行讀數照樣正常(同下面 `--time night` 那一段記的病)。600 秒 = 遊戲 8 小時。
// `--shadow=0` 與其他圖層開關同一組:拍「有影子 / 沒影子」的前後對照。
const ELAPSED = +arg('--elapsed', '0');
const ENV_DEF = { season: 'summer', time: 'day', weather: 'clear' };
// 合法值 MUST 對 `data.js ENV` 驗過再送進去,而且**打錯要當場停**:`environment.js` 是
// `TIMES[env?.time] || TIMES.day`、`biomes.js` 是 `=== 'night'` ⇒ 打成 `--time nigth`
// 拍出來的是一組**白天**的圖,而每一行讀數(地物數、庫節點數、機位)都正常。
// 這就是 §5z-t 那個 `--ink=0` no-op 的同一種失效:旗標沒作用,而畫面看起來完全合理。
{
  const { ENV: CAT } = await import(new URL('../public/js/data.js', import.meta.url));
  for (const [k, pool] of [['season', 'seasons'], ['time', 'times'], ['weather', 'weathers']]) {
    if (!CAT[pool][ENV[k]]) {
      console.error(`--${k} 只收 ${Object.keys(CAT[pool]).join(' / ')},收到「${ENV[k]}」`);
      process.exit(1);
    }
  }
}
const LAYERS = {
  ink: flag('ink'), dof: flag('dof'), grade: flag('grade'), fxaa: flag('fxaa'),
  post: flag('post'), shadow: flag('shadow'),
  // 世界曲面(2026-08-09):它是**唯一**改 three 共用 chunk 的一層,而且只在遠景才看得出來 ⇒
  // 前後對照時最需要能單獨關掉。開關住頁面的 query(`toon.js installWorldCurve` 在模組載入時讀),
  // 所以這一層與其他幾層不同:走探針頁的網址,不是走 `Pipeline` 的 opts。
  curve: flag('curve'),
};
// `--pref k=v`(可重複):把設定頁的旋鈕(visualPrefs.js)在載入前種進 localStorage。
// 為什麼一定要有:**預設值就是「這一項不生效」**(該檔紀律①)⇒ 折邊勾線、3D LUT、空氣透視、
// 陰影偏色這幾層在定場照裡**一張都沒被拍到過**,而它們動的是整個畫面。
// 值一律當字串種進去,visualPrefs 自己的夾制會把非法值退回預設(名單外的選項不得穿過去)。
const PREFS = {};
process.argv.forEach((a, i) => {
  if (a !== '--pref') return;
  const [k, ...v] = String(process.argv[i + 1] || '').split('=');
  if (k && v.length) PREFS[k] = v.join('=');
});
const SUFFIX = Object.entries(LAYERS).filter(([, v]) => !v).map(([k]) => `_no-${k}`).join('')
  + Object.entries(ENV).filter(([k, v]) => v !== ENV_DEF[k]).map(([, v]) => `_${v}`).join('')
  // 旋鈕 MUST 進檔名(同 ENV):兩輪互相覆寫的話事後分不出手上這張是開著還是關著
  + Object.entries(PREFS).map(([k, v]) => `_${k}-${v}`).join('')
  + (INK_SELF ? `_self-${INK_SELF}` : '') + (INK_GRAZE ? `_graze-${INK_GRAZE}` : '')
  + (ELAPSED ? `_t${Math.round(ELAPSED)}s` : '');

const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('定場鏡頭組');
fs.mkdirSync(OUT, { recursive: true });

const THREE_CDN = 'https://unpkg.com/three@0.160.0/build/three.module.js';
const threeLocal = [process.env.THREE_DIR, join(ROOT, 'node_modules', 'three')]
  .filter(Boolean).find((d) => fs.existsSync(join(d, 'build', 'three.module.js')));

const srv = await serve(PORT);
const browser = await chromium.launch({
  executablePath: chromePath(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 300)));
if (Object.keys(PREFS).length) {
  console.log('  旋鈕', JSON.stringify(PREFS));
  await page.addInitScript((p) => {
    try { localStorage.setItem('svs_visual', JSON.stringify(p)); } catch { /* 無所謂 */ }
  }, PREFS);
}

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
// 定裝掃描只在工具伺服器攔截常數；正式來源保持不動，選定後才回寫。
if (INK_SELF || INK_GRAZE) {
  let postSrc = fs.readFileSync(join(ROOT, 'public', 'js', 'postfx.js'), 'utf8');
  if (INK_SELF) postSrc = postSrc.replace(/SELF_F:\s*[\d.]+,/, `SELF_F: ${Number(INK_SELF).toFixed(2)},`);
  if (INK_GRAZE) postSrc = postSrc.replace(/GRAZE_K:\s*[\d.]+,/, `GRAZE_K: ${Number(INK_GRAZE).toFixed(2)},`);
  await page.route('**/public/js/postfx.js', (r) => r.fulfill({
    status: 200, contentType: 'text/javascript; charset=utf-8', body: postSrc,
  }));
}
// 圖磚一律由 Node 轉送(瀏覽器直連在沙箱/代理環境常被擋)
const relay = async (route, contentType) => {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(route.request().url());
      if (!r.ok) continue;
      return route.fulfill({ status: 200, contentType, body: Buffer.from(await r.arrayBuffer()),
        headers: { 'access-control-allow-origin': '*' } });
    } catch { /* 再試 */ }
  }
  route.abort();
};
await page.route(/elevation-tiles-prod/, (r) => relay(r, 'image/png'));
await page.route(/arcgisonline\.com/, (r) => relay(r, 'image/jpeg'));
if (!LIVE) {
  // 圖資取不到就走引擎自己的程序生成 fallback(§2.4);那一份是**確定性**的 ⇒ 定場照可重現
  const osm = (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"elements":[]}' });
  await page.route('**/overpass**', osm);
  await page.route('**/api/interpreter**', osm);
}

const PROBE_URL = `${srv.url}public/__scene_probe.html`;
// `--curve=0` 靠網址傳(見 LAYERS.curve);route 樣式因此 MUST 收得下 query string ——
// 用精確網址攔截的話,帶了 `?curve=0` 的那一次會直接漏到真實檔案系統上變成 404。
const PROBE_NAV = LAYERS.curve ? PROBE_URL : `${PROBE_URL}?curve=0`;
await page.route(`${PROBE_URL}**`, (r) => r.fulfill({
  status: 200, contentType: 'text/html; charset=utf-8',
  body: `<!DOCTYPE html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"${THREE_CDN}","three/addons/":"https://unpkg.com/three@0.160.0/examples/jsm/"}}</script>
<style>html,body{margin:0;background:#000}canvas{display:block}</style></head>
<body><canvas id="c" width="1280" height="720"></canvas></body></html>`,
}));
await page.goto(PROBE_NAV, { waitUntil: 'domcontentloaded' });

const shots = await page.evaluate(async ({ venueId, teamSize, layers, replay, only, env, elapsed, probe, osmCache }) => {
  const THREE = await import('three');
  const { VENUES, venueConfig } = await import('/public/js/venues.js');
  const { buildTerrain } = await import('/public/js/terrain.js');
  const { buildBiomes, commitOsmIn } = await import('/public/js/biomes.js');
  const { ROAD_PRUNE } = await import('/public/js/roadgrid.js');
  const { applyEnvironment } = await import('/public/js/environment.js');
  const { Pipeline } = await import('/public/js/postfx.js');
  const { updateCelLight, worldCurveOn } = await import('/public/js/toon.js');
  const { SOLDIER_H, WATER, solveTowerSites, MAPGEO, objHeightMax, edgeWallInsetM, edgeWallHM, dofNearM, dofFarM, curveKneeM, curveHorizonM }
    = await import('/public/js/data.js');

  const venue = VENUES.find((v) => v.id === venueId);
  if (!venue) throw new Error(`找不到場地 ${venueId}`);
  const cfg = venueConfig(venue, teamSize);
  cfg.env = { ...env };

  // 這一支跑的是真的賽璐璐 + 勾線管線,拍的是保險絲程序幾何(與玩家看到的同一套)。
  const terrain = await buildTerrain(cfg, () => {});
  if (osmCache?.roads?.length) {
    commitOsmIn(terrain.bbox, {
      roads: osmCache.roads,
      feats: {
        buildings: osmCache.buildings || [], rails: osmCache.rails || [], falls: osmCache.falls || [],
        crossings: osmCache.crossings || [], pois: osmCache.pois || [], entrances: osmCache.entrances || [],
        covers: osmCache.covers || [],
        waters: osmCache.waters || [], boundaries: osmCache.boundaries || [],
      },
    });
  }
  // buildBiomes 回傳的是 **group 本身**,結構清單住 group.userData(main.js 的 `ud` 就是它)
  let bio = null, biomeErr = null;
  try { bio = await buildBiomes(cfg, terrain, () => {}); } catch (e) { biomeErr = String(e && e.message || e); }
  const ud = bio?.userData || {};
  // 地物數量進 meta:圖資取不到時 biomes 走程序生成 fallback,數量會掉 —— 那不是渲染回歸,
  // 但**看起來一模一樣**(空曠的山谷),所以一律印出來,免得拿兩張不同世界的圖在比顏色。
  let objN = 0;
  if (bio) bio.traverse((o) => { if (o.isMesh || o.isInstancedMesh) objN++; });
  const scene = new THREE.Scene();
  scene.add(terrain.group);
  if (bio) scene.add(bio);
  const envFx = applyEnvironment(scene, terrain, cfg.env, { shadow: layers.shadow });

  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !layers.post });
  // 陰影圖的開關住 renderer(同 game.js);關著時 `castShadow` 旗標整組惰性
  // ⇒ `--shadow=0` 拍出來的就是這批改動之前的畫面
  renderer.shadowMap.enabled = !!layers.shadow;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(1);
  renderer.setSize(1280, 720, false);
  const camera = new THREE.PerspectiveCamera(68, 1280 / 720, 0.5,
    Math.max(terrain.worldW, terrain.worldH) * 2);
  scene.add(camera);
  const pipe = layers.post ? new Pipeline(renderer, scene, camera, layers) : null;
  // 景深的兩個轉折點 MUST 餵進去,理由與 `--time night` 那一段同源:沒餵 = `_dofRange` 恆為
  // null = 這一 pass **永遠不掛**,而每一張定場照、每一行讀數都照樣正常 ⇒ 這支工具就再也
  // 拍不到交付版本真正長的樣子(而它的賣點正是「改動前後各拍一次」)。距離到 data.js 取。
  pipe?.setDof(dofNearM(), dofFarM());

  // ---- 機位推導(零手打座標)----
  // 機位是在**第一次 render 之前**算的,而 three 的 `matrixWorld` 要等到 render 才更新
  // ⇒ 任何 `Box3.setFromObject` / `applyMatrix4(matrixWorld)` 讀到的都是上一輪(或單位)矩陣。
  // 2026-08-09 實測:`mega_orbit` 因此量到「外接半徑 733.5m」的岩塊(真值 3m 級),
  // 四台相機被擺到 1.4km 外拍空氣 —— 而輸出的每一行讀數都正常。
  scene.updateMatrixWorld(true);
  const R_EARTH = 6371000, d2r = (d) => d * Math.PI / 180, S = MAPGEO.REAL_SCALE;
  const toW = (lat, lng) => [
    (lng - cfg.center.lng) * Math.PI / 180 * R_EARTH * Math.cos(d2r(cfg.center.lat)) / S,
    -((lat - cfg.center.lat) * Math.PI / 180 * R_EARTH / S),
  ];
  const lanes = (cfg.lanes || []).map((l) => l.map(([a, b]) => toW(a, b)));
  const surf = (x, z) => terrain.heightAt(x, z);
  const EYE = SOLDIER_H * 1.1;
  const stations = [];
  const add = (name, p, look, up = EYE) => stations.push({ name, p: [p[0], surf(p[0], p[1]) + up, p[1]], look });

  for (const side of ['SWARM', 'STEEL']) {
    const b = toW(cfg.bases[side][0], cfg.bases[side][1]);
    const l0 = lanes[0] || [];
    const aim = l0.length ? l0[Math.floor(l0.length / 2)] : [0, 0];
    add(`spawn_${side}`, b, [aim[0], surf(aim[0], aim[1]) + EYE, aim[1]]);
    const span = ROAD_PRUNE.TANGLE_CELL_M;
    stations.push({ name: `spawn_over_${side}`,
      p: [b[0], surf(b[0], b[1]) + span * 0.72, b[1] + span * 0.38],
      look: [b[0], surf(b[0], b[1]), b[1]] });
  }
  const sites = solveTowerSites(lanes);
  sites.forEach((laneSites, li) => {
    const s0 = laneSites[0];
    if (s0?.SWARM) {
      const c = s0.SWARM, aim = [c.x + c.nx * 40, c.z + c.nz * 40];
      add(`first_tower_L${li + 1}`, [c.x - c.nx * 30, c.z - c.nz * 30], [aim[0], surf(aim[0], aim[1]) + EYE, aim[1]]);
    }
    const lane = lanes[li] || [];
    if (lane.length > 3) {
      const m = lane[Math.floor(lane.length / 2)], n = lane[Math.floor(lane.length / 2) + 1];
      add(`lane_mid_L${li + 1}`, m, [n[0], surf(n[0], n[1]) + EYE, n[1]]);
    }
  });
  // 結構:引擎已經把隧道/橋的實際幾何算好了,直接拿它自己的清單(MUST NOT 另解一次)
  const tuns = (ud.tunnels || []).filter((t) => !t.open);
  if (tuns.length) {
    const t = tuns[0], tl = tuns[tuns.length - 1];
    add('portal_a', [t.x1, t.z1], [t.x2, surf(t.x2, t.z2) + EYE, t.z2], 3);
    add('portal_b', [tl.x2, tl.z2], [tl.x1, surf(tl.x1, tl.z1) + EYE, tl.z1], 3);
  }
  const decks = ud.decks || [];
  if (decks.length) {
    const d = decks[0];
    stations.push({ name: 'bridge', p: [d.x1, surf(d.x1, d.z1) + EYE + 6, d.z1],
      look: [d.x2, surf(d.x2, d.z2) + EYE, d.z2] });
  }
  // 行人設施機位從實際 instance 推導；固定看第一筆，前後比較不會因鏡頭手調而失真。
  const firstInstancePosition = (names) => {
    const o = names.map((name) => bio?.getObjectByName(name)).find((x) => x?.isInstancedMesh && x.count);
    if (!o) return null;
    const local = new THREE.Matrix4(), world = new THREE.Matrix4(), pos = new THREE.Vector3();
    o.getMatrixAt(0, local);
    world.multiplyMatrices(o.matrixWorld, local);
    return pos.setFromMatrixPosition(world);
  };
  const entranceP = firstInstancePosition(['ped-entrance-station-roof', 'ped-entrance-underpass-roof']);
  if (entranceP) stations.push({ name: 'ped_entrance',
    p: [entranceP.x + 12, entranceP.y + 6, entranceP.z + 12],
    look: [entranceP.x, entranceP.y - 1.4, entranceP.z] });
  const footbridgeP = firstInstancePosition(['ped-footbridge-beams']);
  if (footbridgeP) stations.push({ name: 'ped_footbridge',
    p: [footbridgeP.x + 18, footbridgeP.y + 8, footbridgeP.z + 18],
    look: [footbridgeP.x, footbridgeP.y - 1.5, footbridgeP.z] });
  // **喬木近景**(2026-08-08 §5z-t):勾線是**螢幕空間**的 pass,門檻吃「離相機多遠 + 掠射角」,
  // 而且**背景是天空(深度 = far)的那一格會早退** ⇒ 一棵孤零零站在空背景前的樹**畫不出線**
  // (`shot_veg` 實測 `--ink=1` 與 `--ink=0` 的 PNG **逐位元相同**)。「勾線對這個冠形是加分
  // 還是扣分」因此**只能在有地形、有鄰木的場景裡**量 —— 而既有機位最近的樹也在 60~100m 外,
  // 一棵樹只有十幾個像素高。⇒ 補一個機位,**位置照樣是推導的**:取離兵線中段最近的那一株
  // 「高 ≥ 4m 的植被 instance」,取景比例與 `shot_veg` 同一組(距離 2.2×樹高、眼高 0.55×),
  // 兩支的圖才比得起來。認樹用**幾何包圍盒的高**,不比對列名 —— 名字會改,高度不會。
  {
    const cands = [];
    if (bio) bio.traverse((o) => {
      if (!o.isInstancedMesh || !o.geometry) return;
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      const h = (bb.max.y - bb.min.y) * (o.scale?.y || 1);
      if (h < 4) return;                                  // 灌木 / 草不算
      const m = new THREE.Matrix4(), v = new THREE.Vector3();
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        v.setFromMatrixPosition(m).applyMatrix4(o.matrixWorld);
        cands.push([v.x, v.z, h]);
      }
    });
    const l0 = lanes[0] || [];
    const ref = l0.length ? l0[Math.floor(l0.length / 2)] : [0, 0];
    let best = null;
    for (const c of cands) {
      const d = (c[0] - ref[0]) ** 2 + (c[1] - ref[1]) ** 2;
      if (!best || d < best[0]) best = [d, c];
    }
    if (best) {
      const [tx, tz, th] = best[1];
      const dist = th * 2.2, base = surf(tx, tz);
      stations.push({
        name: 'veg_near',
        p: [tx + dist * 0.80, base + th * 0.55, tz + dist * 0.60],
        look: [tx, base + th * 0.45, tz],
      });
    }
  }
  // 全圖最高點俯瞰兵線(掃格,零亂數)
  {
    let best = null;
    for (let x = terrain.minX + 60; x < terrain.maxX - 60; x += 40) {
      for (let z = terrain.minZ + 60; z < terrain.maxZ - 60; z += 40) {
        const h = surf(x, z);
        if (!best || h > best[2]) best = [x, z, h];
      }
    }
    const l0 = lanes[0] || [];
    const aim = l0.length ? l0[Math.floor(l0.length / 2)] : [0, 0];
    add('hilltop', [best[0], best[1]], [aim[0], surf(aim[0], aim[1]), aim[1]]);
  }
  if (terrain.waterY != null) {   // 水岸:第一個「腳下乾、前方濕」的格點
    let found = null;
    for (let x = terrain.minX + 40; x < terrain.maxX - 40 && !found; x += 25) {
      for (let z = terrain.minZ + 40; z < terrain.maxZ - 40; z += 25) {
        if (surf(x, z) > WATER.LEVEL + 1 && surf(x + 25, z) < WATER.LEVEL) { found = [x, z]; break; }
      }
    }
    if (found) {
      add('waterline', found, [found[0] + 120, WATER.LEVEL, found[1]]);
      // 水岸高空俯瞰 (視覺確認水岸與淺水浪花)
      stations.push({
        name: 'water_shore_aerial',
        p: [found[0] - 15, WATER.LEVEL + 35, found[1] - 15],
        look: [found[0] + 25, WATER.LEVEL, found[1] + 25],
      });
    }

    // 水中構造物/橋墩近景與高空俯瞰 (特寫與俯瞰水面切面同心波前)
    if (ud.decks && ud.decks.length) {
      const d = ud.decks[0];
      const midX = (d.x1 + d.x2) / 2, midZ = (d.z1 + d.z2) / 2;
      stations.push({
        name: 'water_pier',
        p: [midX - 16, WATER.LEVEL + 10, midZ - 16],
        look: [midX, WATER.LEVEL, midZ],
      });
      stations.push({
        name: 'water_pier_aerial',
        p: [midX - 14, WATER.LEVEL + 32, midZ - 14],
        look: [midX, WATER.LEVEL, midZ],
      });
    }

    // 水下遺跡/沉船高空俯瞰
    const wb = (ud.blockers || []).find((b) => b.cl?.startsWith('aquatic_'));
    if (wb) {
      stations.push({
        name: 'water_relic_aerial',
        p: [wb.x - 12, WATER.LEVEL + 28, wb.z - 12],
        look: [wb.x, WATER.LEVEL, wb.z],
      });
    }
  }
  {
    const d = ud.stats?.roadPrune?.denseAfter;
    if (d) {
      const span = ROAD_PRUNE.TANGLE_CELL_M;
      stations.push({ name: 'road_tangle',
        p: [d.x, surf(d.x, d.z) + span * 0.72, d.z + span * 0.38],
        look: [d.x, surf(d.x, d.z), d.z] });
    }
  }
  // **世界邊界**(2026-08-11 邊界牆改吃型錄之後補的兩張):這一整套 —— 障礙環的 15 款型式、
  // 緩衝空間的地貌拼圖與 3D 物件、視線邊界的假山/假海/假森林/假城市 —— 全是**只有站在
  // 邊界往外看**才看得到的東西,而既有 11 個機位沒有任何一個朝那個方向。位置照樣是推導的:
  // 站在夾制線內側一步(玩家能走到的最外緣),沿四條邊各取「離圖心那一側的中點」。
  //   edge_wall 貼著牆看牆(型式對不對、有沒有浮在坡上、內面有沒有破洞)
  //   edge_far  站同一點但抬高、看向緩衝空間深處(拼圖接縫、布景、背景天際線)
  {
    const eIn = edgeWallInsetM();
    const cx = (terrain.minX + terrain.maxX) / 2, cz = (terrain.minZ + terrain.maxZ) / 2;
    // 四條邊各量一次「這一側是不是水」,優先挑陸域那一側(水域那一側拍到的是海堤/貨輪,
    // 也要看 —— 故第二張刻意挑**另一種**水陸域,兩張合起來兩種都拍得到)
    const sides = [
      { p: [cx, terrain.minZ + eIn], out: [cx, terrain.minZ - 1] },
      { p: [cx, terrain.maxZ - eIn], out: [cx, terrain.maxZ + 1] },
      { p: [terrain.minX + eIn, cz], out: [terrain.minX - 1, cz] },
      { p: [terrain.maxX - eIn, cz], out: [terrain.maxX + 1, cz] },
    ].map((s) => ({
      ...s,
      wet: terrain.waterY != null && surf(s.p[0], s.p[1]) < terrain.waterY + WATER.SHORE,
      // 這一側的地有多陡(用來挑機位;取樣距與 `buildEdgeWall` 的坡度取樣同量級)
      rise: Math.abs(surf(s.p[0] + (s.out[0] - s.p[0] ? 0 : 12), s.p[1] + (s.out[1] - s.p[1] ? 0 : 12))
        - surf(s.p[0] - (s.out[0] - s.p[0] ? 0 : 12), s.p[1] - (s.out[1] - s.p[1] ? 0 : 12))),
    }));
    // `edge_wall` 挑**最平的那一側**:峽谷型場地四條邊都掛在崖上,相機無論退多遠都被地形塞滿
    // (taroko 實測整張圖只有兩塊色)。這一張要看的是「牆長什麼樣」,而崖面那一款在
    // `aerial` / `hilltop` 本來就看得到。
    const dry = sides.filter((s) => !s.wet);
    const wall = (dry.length ? dry : sides).slice().sort((a, b) => a.rise - b.rise)[0];
    const far = sides.find((s) => s.wet !== wall.wet) || wall;
    // 站在夾制線**退開一段**再拍:貼著站的話相機就埋在環體裡(taroko 那一段是 30m 高的
    // 懸崖峭壁,實測整個畫面只有兩塊色)。退距與抬高一律由**物件高度上限**推導 —— 型錄最高
    // 的那一款(懸崖 30m)也收在那個天花板之下,故它就是「一定框得住」的那把尺。
    const backF = objHeightMax() * 0.4;
    const wIn = [wall.p[0] - Math.sign(wall.out[0] - wall.p[0]) * backF,
      wall.p[1] - Math.sign(wall.out[1] - wall.p[1]) * backF];
    const base = surf(wIn[0], wIn[1]);
    stations.push({
      name: 'edge_wall',
      p: [wIn[0], base + EYE + edgeWallHM() * 0.6, wIn[1]],
      look: [wall.out[0], base + edgeWallHM(), wall.out[1]],
    });
    const fb = surf(far.p[0], far.p[1]);
    stations.push({
      name: 'edge_far',
      p: [far.p[0], fb + objHeightMax() * 0.35, far.p[1]],
      look: [far.p[0] + (far.out[0] - far.p[0]) * 400, fb, far.p[1] + (far.out[1] - far.p[1]) * 400],
    });
  }
  {   // 空拍:圖心正上方(相機直接定位,這一支不經過玩家狀態機)
    const span = Math.max(terrain.worldW, terrain.worldH);
    const cx = (terrain.minX + terrain.maxX) / 2, cz = (terrain.minZ + terrain.maxZ) / 2;
    stations.push({ name: 'aerial', p: [cx, surf(cx, cz) + span * 0.45, cz + span * 0.35], look: [cx, surf(cx, cz), cz] });
  }

  const out = [];
  const probeHits = [];
  let glError = 0;
  // 回放 MUST 整組取代(不是補進去):混著用會拍出「一半新機位、一半舊機位」的圖組,
  // 而檔名一模一樣 ⇒ 之後沒有任何東西能分辨哪幾張可以比。
  const all = replay && replay.length ? replay : stations;
  const use = only.length ? all.filter((s) => only.includes(s.name)) : all;
  for (const st of use) {
    camera.position.set(st.p[0], st.p[1], st.p[2]);
    camera.lookAt(st.look[0], st.look[1], st.look[2]);
    camera.updateMatrixWorld(true);
    envFx.update(0.016, camera, elapsed);
    updateCelLight(camera);
    if (pipe) pipe.render(); else renderer.render(scene, camera);
    glError ||= renderer.getContext().getError();
    if (probe) {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(probe[0], probe[1]), camera);
      const hits = ray.intersectObjects(scene.children, true).slice(0, 8).map((h) => ({
        distance: h.distance,
        point: h.point.toArray(),
        type: h.object.type,
        name: h.object.name || '',
        instanceId: h.instanceId ?? null,
        vertices: h.object.geometry?.attributes?.position?.count ?? null,
        material: Array.isArray(h.object.material)
          ? h.object.material.map((m) => m?.name || m?.color?.getHexString?.() || '')
          : (h.object.material?.name || h.object.material?.color?.getHexString?.() || ''),
      }));
      probeHits.push({ name: st.name, ndc: [...probe], hits });
    }
    out.push({ name: st.name, png: canvas.toDataURL('image/png'),
      p: [...st.p], look: [...st.look] });
  }
  return { shots: out, tunnels: tuns.length, decks: decks.length, water: terrain.waterY != null, objN, biomeErr, imagery: !!terrain.sampleColor, glError,
    roadPrune: ud.stats?.roadPrune || null, pedestrian: ud.stats?.pedestrian || null,
    probeHits, curveOn: worldCurveOn(), curveKnee: curveKneeM(), curveHorizon: curveHorizonM() };
}, { venueId: VENUE, teamSize: TEAM, layers: LAYERS, replay: REPLAY, only: ONLY,
  env: ENV, elapsed: ELAPSED, probe: PROBE, osmCache: OSM_CACHE });

for (const s of shots.shots) {
  fs.writeFileSync(join(OUT, `${s.name}${SUFFIX}.png`), Buffer.from(s.png.split(',')[1], 'base64'));
  console.log(`  ${s.name}${SUFFIX}  eye=${s.p.map((v) => Math.round(v)).join(',')}`
    + `  →  ${s.look.map((v) => Math.round(v)).join(',')}`);
}
if (shots.biomeErr) console.log(`  ⚠ buildBiomes 例外:${shots.biomeErr}`);
console.log(`  地物 mesh ${shots.objN}・隧道 ${shots.tunnels}・橋 ${shots.decks}`
  + `・水域 ${shots.water ? '有' : '無'}・衛星影像 ${shots.imagery ? '有' : '無'}`);
// 曲面裝上了沒有 MUST 印出來,理由與景深那一段同源:錨點對不上 / 網址旗標打錯,
// 兩者都會安靜地拍出一疊**平面**定場照,而每一行讀數與每一張圖看起來都正常 ——
// 而這支工具的賣點正是「改動前後各拍一次」,拍到的若是同一件事就什麼都比不出來。
console.log(`  世界曲面 ${shots.curveOn ? `已裝(拐點 ${Math.round(shots.curveKnee)}m / 地平線 ${Math.round(shots.curveHorizon)}m)`
  : (LAYERS.curve ? '⚠ 未裝(three 錨點對不上?)' : '關閉(--curve=0)')}`);
console.log(`  真 GPU gl.getError() = ${shots.glError}`);
if (shots.roadPrune?.edges) {
  const p = shots.roadPrune;
  console.log(`  道路剪枝 ${p.inputWays}→${p.outputWays} ways・${p.removedEdges}/${p.edges} edges・${p.removedM.toFixed(0)}m`
    + `（小環 ${p.cycleM.toFixed(0)}m）・死路 ${p.deadEndsBefore}→${p.deadEndsAfter}`);
  console.log(`  道路種類 ${Object.entries(p.byHighway || {}).map(([k, v]) =>
    `${k}:${v.before}→${v.after}(均${(v.beforeM / v.before).toFixed(0)}m)`).join('・')}`);
  if (p.focusBefore?.length === p.focusAfter?.length) {
    console.log(`  重生圈候選窄路 ${p.focusBefore.map((v, i) =>
      `${['SWARM', 'STEEL'][i] || i}:${v.m.toFixed(0)}→${p.focusAfter[i].m.toFixed(0)}m`).join('・')}`);
  }
  if (p.loopBefore && p.loopAfter) {
    console.log(`  面積 < ${p.loopAfter.thresholdM2}m² 的小閉環 ${p.loopBefore.small}→${p.loopAfter.small}`
      + `（重生圈 ${p.loopBefore.focusSmall}→${p.loopAfter.focusSmall}）`);
  }
  if (p.parallelProtected) {
    console.log(`  並排保護 結構旁一般道路 ${p.parallelProtected.structure} edges・雙向分隔車道 ${p.parallelProtected.divided} edges`);
  }
  if (p.nearClosed) {
    const nearFaces = Number.isFinite(p.loopBefore?.nearClosedSmall) && Number.isFinite(p.loopAfter?.nearClosedSmall)
      ? `・所成小環 ${p.loopBefore.nearClosedSmall}→${p.loopAfter.nearClosedSmall}` : '';
    console.log(`  死端近接閉合 ${p.nearClosed.links} 處（最大間距 ${p.nearClosed.maxGapM.toFixed(1)}m，只用於面積分析）${nearFaces}`);
  }
  if (p.rejected) console.log(`  小環候選未剪 ${Object.entries(p.rejected).map(([k, v]) => `${k}:${v}`).join('・')}`);
}
if (shots.pedestrian) {
  const p = shots.pedestrian;
  console.log(`  行人規劃 天橋 ${p.footbridges}・地下路線移除 ${p.undergroundRemoved}`
    + `・入口 ${p.entrances}・老街 ${p.oldstreet}・自行車道 ${p.cycleway}・商圈步道 ${p.promenade}`);
}
for (const p of shots.probeHits) {
  console.log(`  射線 ${p.name} ndc=${p.ndc.join(',')}`);
  for (const h of p.hits) console.log(`      · ${h.type}${h.instanceId == null ? '' : `#${h.instanceId}`} ${h.material}`
    + ` v${h.vertices ?? '-'} d${h.distance.toFixed(2)} @${h.point.map((v) => v.toFixed(2)).join(',')}`);
}
fs.writeFileSync(join(OUT, `meta${SUFFIX}.json`), JSON.stringify({
  venue: VENUE, team: TEAM, layers: LAYERS, env: ENV,
  tunnels: shots.tunnels, decks: shots.decks, water: shots.water,
  objN: shots.objN, biomeErr: shots.biomeErr, imagery: shots.imagery, glError: shots.glError,
  probeHits: shots.probeHits, roadPrune: shots.roadPrune, pedestrian: shots.pedestrian,
  stations: shots.shots.map((s) => ({ name: s.name, p: s.p, look: s.look })),
}, null, 2));
console.log(`\n${shots.shots.length} 張 → ${OUT}`);
await browser.close();
srv.close();
if (shots.glError !== 0) throw new Error(`WebGL 錯誤:gl.getError() = ${shots.glError}`);
