// ============ 場地主方位烘焙(2026-08-10)============
// 使用者定案:「先找出地圖上下左右對準哪一個方向時,可以對齊最多的大馬路組成正交網格」。
// 本工具離線量出每個預設場地的主方位,寫進 `public/js/venueGrid.js`(純資料,人手 MUST NOT 編輯)。
//
// **為什麼是離線烘焙,不是建圖時算**:旋轉是投影的一部分,而投影是**兩端共用的權威座標框**
// (客戶端 `terrain.llToWorld` / 伺服器 `sim.llToMeters`)。在建圖期算有兩個致命點:
//   ① 地形 `buildTerrain` 跑在抓道路**之前** —— 那時還沒有路網可量;
//   ② 就算硬抓,`startPrebuild` 是每台客戶端**各跑一次**的,而 Overpass 逐局可能失敗/被截斷
//      ⇒ 不同客戶端量到不同角度 ⇒ **整個世界的座標對不上**(比「少幾座橋」嚴重一個量級:
//      所有單位的位置都會差一個旋轉)。
// 真正的規則因此是「θ MUST 在 battleConfig 定案**之前**就凍結成常數」(A42 ③):預設場地烤成
// 資料檔(本工具),自訂地圖由房主在「存入最愛」那一次量一次寫死(`main.resolveMapRot`,
// 與本工具共用 `roadGridRotDeg`)。拿不到一律 0(不旋轉,逐位元同舊制)。
//
// 取樣面 = **大馬路**:使用者說的是「對齊最多的大馬路」,不是「對齊最多的路」。定義只有
// `roadgrid.GRID_HW` 一份(`.source` 直接就是 Overpass 查詢字串)。
//
// 推導只有 `public/js/roadgrid.js roadGridRotDeg()` 一份(它內含的 `gridAngle()` 另供
// `ground.js` 的擺件格網使用)。
//
// ⚠ **本工具 MUST 冪等**:抓取範圍與量測框都在 rot=0 的框裡算 —— `venueConfig` 會把上一輪
// 烤出來的 rot 寫進 center,而旋轉只讓 `battleBBox` 長大,不剝掉就會一輪比一輪偏(見 bakeOne)。
// 重烤基準(MUST 逐一吻合):manhattan −28.995 / barcelona 42.803 / shibuya 14.527 /
// kyoto −2.542 / chicago −0.003。
//
// 用法:
//   node tools/bake_venue_grid.mjs              # 全部場地
//   node tools/bake_venue_grid.mjs --only taipei,berlin
//   node tools/bake_venue_grid.mjs --dry        # 只印,不寫檔
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './audit_src.mjs';
import { VENUES, venueConfig } from '../public/js/venues.js';
import { battleBBox, llToXZ } from '../public/js/data.js';
import { GRID_HW, roadGridRotDeg, waySegs } from '../public/js/roadgrid.js';

const OSM_UA = 'steel-vs-swarm/1.0 (venue grid bake)';
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const REQ_MS = 45000, DEAD_N = 2, ROUNDS = 2;
const RETRYABLE = new Set([429, 502, 503, 504]);
const fails = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 鏡像輪替 MUST 逐站計時(§2.4):一組鏡像共用一個逾時 = 任一站掛住就吃光整份預算 */
async function overpass(q) {
  let retryable = false;
  for (let round = 0; round < ROUNDS; round++) {
    for (const url of OVERPASS) {
      if ((fails.get(url) || 0) >= DEAD_N) continue;
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': OSM_UA },
          body: 'data=' + encodeURIComponent(q),
          signal: AbortSignal.timeout(REQ_MS),
        });
        if (!r.ok) {
          fails.set(url, (fails.get(url) || 0) + 1);
          retryable = retryable || RETRYABLE.has(r.status);
          continue;
        }
        const d = await r.json();
        if (d.remark) { retryable = true; continue; }
        fails.set(url, 0);
        return d.elements || [];
      } catch {
        fails.set(url, (fails.get(url) || 0) + 1);
        retryable = true;
      }
    }
    if (!retryable) return null;
    retryable = false;
    await sleep(3000 * (round + 1));
  }
  return null;
}

/**
 * 一個場地的主方位(度)。回 null = 量不到(該場地不寫進表 ⇒ 執行期 rot=0 不旋轉)。
 * bbox 取 **L1**(teamSize=1):同一個場地不同人數只差方框大小,地籍格網是同一個
 * —— 一個場地一個角度,MUST NOT 逐人數各烤一份(那會讓同一張圖在 1v1 與 5v5 轉不同角度)。
 */
async function bakeOne(v) {
  const cfg0 = venueConfig(v, 1);
  // ⚠ 抓取範圍 MUST 也在 **rot = 0** 的框裡算,否則烘焙**不是冪等的**:`venueConfig` 會把
  // 上一輪烤出來的 rot 寫進 center,而旋轉只會讓 `battleBBox` 長大(實測 shibuya 1.77×、
  // barcelona 2.27×)⇒ 第二輪在一塊大得多的區域上取樣,量到的主方位跟著漂
  // (實測 shibuya 14.53° → 19.49°,而三個檔案都沒改、稽核也全綠)。
  // 量測框(下面的 `c`)本來就不帶 rot;這裡是同一條規則的另一半。
  const cfg = { ...cfg0, center: { lat: cfg0.center.lat, lng: cfg0.center.lng } };
  const bb = battleBBox(cfg);
  const bbs = `${bb.minLat.toFixed(5)},${bb.minLng.toFixed(5)},${bb.maxLat.toFixed(5)},${bb.maxLng.toFixed(5)}`;
  // 取樣面(大馬路)只有 `roadgrid.GRID_HW` 一份 —— `.source` 直接就是 Overpass 要的字串,
  // 在這裡手寫第二次 = 改了取樣面卻只改到一邊,而兩條路徑仍然各自算得出一個角度。
  const q = `[out:json][timeout:60];way["highway"~"${GRID_HW.source}"](${bbs});out geom 900;`;
  const els = await overpass(q);
  if (!els) return { rotDeg: null, why: '圖資取得失敗' };
  const ways = els
    .filter((e) => e.type === 'way' && e.geometry && GRID_HW.test(e.tags?.highway || ''))
    .map((e) => ({ tags: e.tags, geometry: e.geometry }));
  if (!ways.length) return { rotDeg: null, why: '此範圍沒有大馬路' };
  // 量測框 MUST 是**未旋轉**的(`c` 不帶 rot);取樣面、量測、取負號三件事全在
  // `roadGridRotDeg` 這一支裡 —— 執行期(自訂地圖存入最愛)吃的是同一支。
  const c = { lat: cfg.center.lat, lng: cfg.center.lng };
  const toXZ = (p) => llToXZ(p.lat, p.lon, c);
  const rotDeg = roadGridRotDeg(ways, toXZ);
  if (rotDeg == null) return { rotDeg: null, why: '線段長度不足' };
  const totalM = waySegs(ways, toXZ, (w) => GRID_HW.test(w.tags?.highway || ''))
    .reduce((s, g) => s + Math.hypot(g[2] - g[0], g[3] - g[1]), 0);
  return { rotDeg, ways: ways.length, km: totalM / 1000 };
}

const argv = process.argv.slice(2);
const only = (argv.find((s) => s.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const onlyIdx = argv.indexOf('--only');
if (onlyIdx >= 0 && argv[onlyIdx + 1]) only.push(...argv[onlyIdx + 1].split(','));
const dry = argv.includes('--dry');

const list = VENUES.filter((v) => !only.length || only.includes(v.id));
const out = {};
let okN = 0;
for (const v of list) {
  const r = await bakeOne(v);
  if (r.rotDeg == null) {
    console.log(`  ✗ ${v.id.padEnd(14)} ${r.why}(執行期 rot=0,不旋轉)`);
    continue;
  }
  out[v.id] = +r.rotDeg.toFixed(4);
  okN++;
  console.log(`  ✓ ${v.id.padEnd(14)} rot ${r.rotDeg.toFixed(3).padStart(8)}°  (大馬路 ${r.ways} 條 / ${r.km.toFixed(1)} 遊戲公里)`);
  await sleep(1200);   // 對鏡像客氣一點
}
console.log(`\n量到 ${okN} / ${list.length} 個場地`);
if (dry) { console.log('(--dry:未寫檔)'); process.exit(0); }
if (!okN) { console.log('一個都沒量到 —— 不覆蓋既有檔案'); process.exit(1); }

// 部分烘焙(--only)MUST 合併既有表,MUST NOT 把沒烤到的場地洗掉
let prev = {};
try { ({ VENUE_GRID: prev } = await import('../public/js/venueGrid.js')); } catch { /* 首次烘焙 */ }
const merged = { ...prev, ...out };
const body = Object.keys(merged).sort().map((k) => `  ${k}: ${merged[k]},`).join('\n');
const src = `// ============ 場地主方位(離線烘焙,人手 MUST NOT 編輯)============
// 由 \`node tools/bake_venue_grid.mjs\` 產生。值 = **度**,語意 = 「把地圖轉這麼多度,
// 該場地的大馬路就會對齊世界軸(組成正交網格)」= 大馬路 mod 90° 主方位的負值,∈ [−45, 45]。
// 消費端只有 \`venues.js venueConfig()\`(寫進 cfg.center.rot,單位換成弧度);
// 場地不在表內 ⇒ 0 = 不旋轉 = 逐位元同舊制(自訂地圖與舊的「我的最愛」都走這一條)。
// 改 \`roadgrid.js gridAngle()\` 或取樣面(大馬路的定義)MUST 重烤。
export const VENUE_GRID = {
${body}
};
`;
writeFileSync(join(ROOT, 'public/js/venueGrid.js'), src, 'utf8');
console.log('已寫入 public/js/venueGrid.js');
