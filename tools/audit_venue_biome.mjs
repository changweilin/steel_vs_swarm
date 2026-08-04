// ============ 場地地貌宣告 vs 圖資實測(2026-08-04)============
// 使用者問:「太魯閣、合歡山不在市區還這麼多建築?**有正確從圖資判斷地貌嗎**?
//            檢查不符合類型的地圖」。
//
// 答案(這支稽核存在的理由):`VENUES[].mix` / `.type` 是**手寫的場地宣告**,不是實測值 ——
// 與 `scen` / `relief`「MUST 由實測產生」的紀律完全相反。而且它的消費端只有兩個:
//   `biomes.js classify()`(地被色階與植被加權)與 `placeBoundary()`(邊界帶要不要長樓)。
// **建物一格都不吃它** —— 建物只由「圖資裡有沒有建物」決定。於是只要錨點被搬到有路網的
// 聚落(`venues.js` 的 ll 註解寫得很清楚:合歡山 → 埔里鎮、陽明山 → 天母、青木原 → 河口湖町、
// 烏魯魯 → Yulara、奧卡萬戈 → Maun、威尼斯 → Mestre…),那張圖拿到的就是那個城鎮的建物,
// 而宣告仍寫著「裸露地 80%」。這支稽核把兩者擺在一起,讓落差看得見。
//
// 量兩件**互相獨立**的事(刻意不合併成一個數字,見 venue_field.landcoverFor 檔頭):
//   ① **地被組成**:landuse / natural / leisure 多邊形面積佔比 → 對上宣告的 `mix`
//   ② **建蔽率**:建物輪廓面積 ÷ bbox 面積 → 對上宣告的 `mix.urban`
// 兩者都在 **L1 bbox**(`battleBBox(venueConfig(v, 1))`,與場景掃描同一個框)內量。
//
// 判定門檻(`TOL`)是**判斷值**,語意寫在常數旁邊 —— 這支的用途是「把該看的圖挑出來」,
// 不是把 27 張圖全部判死。門檻放寬到「差一個量級才算不符」。
//
// 網路:Overpass(與 biomes.js 同一組鏡像),結果快取在 `tools/.scen_cache/`。
// 取不到圖資的場地一律標成**未驗**,MUST NOT 洗成通過(原則 6 / 矩陣通則 ④):
// 收尾的「通過 N 項」裡不會包含它們,而且只要有未驗就不報全綠。
//
// 用法:node tools/audit_venue_biome.mjs [--only=taroko,hehuanshan] [--offline] [--json=out.json]
//   `--offline` 只跑 Ⅰ(宣告自洽 + 建物管線不讀 mix)—— 那一段純離線,`ci.yml` 收這一半;
//   完整版(含 Ⅱ/Ⅲ 的圖資實測)掛在 `lane-scenarios.yml`,與其餘要外網的稽核同一支。
// 退出碼:0 = 全數相符且無未驗;1 = 有不符 or 有未驗(需要人看)
import { writeFileSync, readFileSync } from 'node:fs';
import { VENUES, venueConfig } from '../public/js/venues.js';
import { BIOMES, battleBBox } from '../public/js/data.js';
import { R_EARTH, d2r, landcoverFor } from './venue_field.mjs';

const ARG = Object.fromEntries(process.argv.slice(2).map((s) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(s);
  return m ? [m[1], m[2] ?? '1'] : ['_', s];
}));
const ONLY = (ARG.only || '').split(',').filter(Boolean);

// ---- OSM tag → 地貌鍵(單一縫)----
// 鍵集 MUST 與 `data.js BIOMES` 同一組 —— 宣告與實測用不同的字彙就沒得比。
// 分類只收「說得出地貌」的 tag;其餘(landuse=railway / natural=tree_row 之類的線狀物)
// 一律不歸類,計入「未標註」⇒ 覆蓋率低的場地自動標成低信心,而不是硬湊一個組成出來。
const COVER_KIND = [
  ['water', /^(natural=(water|bay|strait|spring)|landuse=(reservoir|basin|salt_pond)|waterway=riverbank)$/],
  ['wet', /^(natural=(wetland|mud)|landuse=aquaculture)$/],
  ['bare', /^(natural=(bare_rock|scree|shingle|sand|rock|cliff|glacier|desert|dune)|landuse=(quarry|salt_pond|landfill))$/],
  ['green', /^(natural=(wood|scrub|grassland|heath|fell|moor)|landuse=(forest|grass|meadow|farmland|farmyard|orchard|vineyard|allotments|village_green|greenfield|plant_nursery|recreation_ground)|leisure=(park|garden|golf_course|nature_reserve|recreation_ground))$/],
  ['urban', /^(landuse=(residential|commercial|industrial|retail|construction|military|education|institutional|garages|port|brownfield)|natural=)$/],
];
/** tag 物件 → 地貌鍵(無法歸類回 null) */
export function coverKind(tags) {
  for (const k of ['landuse', 'natural', 'leisure', 'waterway']) {
    const v = tags?.[k];
    if (!v) continue;
    const s = `${k}=${v}`;
    for (const [kind, re] of COVER_KIND) if (re.test(s)) return kind;
  }
  return null;
}

// ---- 幾何:經緯度多邊形面積(平方公尺)----
// 等距圓柱投影 + 鞋帶公式。L1 bbox 只有數百公尺見方 ⇒ 投影誤差遠小於「差一個量級」的門檻。
function polyAreaM2(geom, lat0) {
  const c = Math.cos(d2r(lat0));
  let a = 0;
  for (let i = 0, n = geom.length; i < n; i++) {
    const p = geom[i], q = geom[(i + 1) % n];
    a += (p.lon * c * R_EARTH * d2r(1)) * (q.lat * R_EARTH * d2r(1))
       - (q.lon * c * R_EARTH * d2r(1)) * (p.lat * R_EARTH * d2r(1));
  }
  return Math.abs(a) / 2;
}

const bboxAreaM2 = (b) => (b.maxLat - b.minLat) * d2r(1) * R_EARTH
  * (b.maxLng - b.minLng) * d2r(1) * R_EARTH * Math.cos(d2r((b.minLat + b.maxLat) / 2));

// ---- 判定門檻(判斷值;語意寫在這裡)----
const TOL = {
  // 宣告某個地貌 ≥ MAJOR 卻在圖資裡量到 < MAJOR_MIN ⇒ 不符(宣告的主成分根本不存在)
  MAJOR: 0.30, MAJOR_MIN: 0.08,
  // 圖資量到某個地貌 ≥ SURPRISE 而宣告 < SURPRISE_DECL ⇒ 不符(圖資的主成分沒被宣告)
  SURPRISE: 0.35, SURPRISE_DECL: 0.10,
  // 地被覆蓋率(有 landuse/natural 標註的面積 ÷ bbox)低於此 ⇒ 樣本太少,只報不判
  COVER_MIN: 0.15,
  // 建蔽率:宣告 urban ≤ URBAN_LOW 卻蓋到 ≥ BUILT_HIGH ⇒ 「不在市區卻一堆樓」
  //   台北信義計畫區這種真市區的建蔽率在 20~30%;山區聚落 <2%。取 8% =「明顯是個城鎮」。
  URBAN_LOW: 0.25, BUILT_HIGH: 0.08,
};

const BIO_KEYS = Object.keys(BIOMES);

let pass = 0, fail = 0, unverified = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`    ✓ ${m}`); } else { fail++; console.log(`    ✗ ${m}`); } };

const list = VENUES.filter((v) => !ONLY.length || ONLY.includes(v.id));
console.log(`== 場地地貌宣告 vs 圖資實測 ==  場地 ${list.length}、L1 bbox、`
  + `門檻 主成分 ${TOL.MAJOR}/${TOL.MAJOR_MIN}・意外 ${TOL.SURPRISE}/${TOL.SURPRISE_DECL}・建蔽 ${TOL.BUILT_HIGH}\n`);

// ---- Ⅰ 宣告自身的自洽性(純離線,不需網路)----
console.log('Ⅰ 宣告自洽(mix 鍵集 / 總和 / type 對得上主成分)');
{
  const TYPE_OF = { green: '綠地', bare: '裸露地', urban: '市區', water: '水體', wet: '濕地' };
  let bad = [];
  for (const v of VENUES) {
    const keys = Object.keys(v.mix || {});
    const sum = keys.reduce((s, k) => s + v.mix[k], 0);
    const top = keys.slice().sort((a, b) => v.mix[b] - v.mix[a])[0];
    const single = v.mix[top] >= 0.8;
    if (!keys.length || keys.some((k) => !BIO_KEYS.includes(k))) bad.push(`${v.id}:鍵不合法`);
    else if (Math.abs(sum - 1) > 1e-6) bad.push(`${v.id}:mix 總和 ${sum.toFixed(2)}`);
    // 單一型(≥80%)的 type MUST 就是那個主成分;混合型 MUST 標「混合」
    else if (single && v.type !== TYPE_OF[top]) bad.push(`${v.id}:單一型主成分 ${top} 但 type=${v.type}`);
    else if (!single && v.type !== '混合' && v.type !== TYPE_OF[top]) bad.push(`${v.id}:type=${v.type} 對不上 ${top}`);
  }
  ok(!bad.length, `${VENUES.length} 個場地的 mix 鍵集/總和/type 自洽${bad.length ? ` —— ${bad.join('、')}` : ''}`);
  // 這一條是本檔存在的理由,釘住它免得日後有人「順手」把 mix 接進建物管線:
  // mix 是宣告不是實測 ⇒ 它 MUST NOT 決定權威幾何(建物是碰撞柱 + LOS 遮蔽)。
  const bio = readFileSync(new URL('../public/js/biomes.js', import.meta.url), 'utf8');
  const i0 = bio.indexOf('  // ---- 聚落場(單一縫)');
  const i1 = bio.indexOf('  // 市區補間:把被 8 倍世界撐開的街廓填回連續街區');
  ok(i0 > 0 && i1 > i0 && !/\bmix\b/.test(bio.slice(i0, i1).replace(/\/\/.*$/gm, '')),
    '建物管線(聚落場 + 街廓配置)不讀 venue.mix —— 地貌一律由圖資判,宣告不參與');
}

if (ARG.offline) {
  console.log(`\n(--offline:略過 Ⅱ/Ⅲ 的圖資實測)\n${fail ? '❌' : '✅'} 通過 ${pass} 項${fail ? `,失敗 ${fail} 項` : ''}`);
  process.exit(fail ? 1 : 0);
}

// ---- Ⅱ 逐場地實測 ----
console.log('\nⅡ 圖資實測(地被組成 + 建蔽率)');
const rows = [];
for (const v of list) {
  const cfg = venueConfig(v, 1);
  const bbox = battleBBox(cfg);
  const lc = await landcoverFor(v.id, bbox);
  if (!lc) {
    unverified++;
    console.log(`  ${(v.id + ' ').padEnd(15, '·')} ⚠️ 取不到圖資(Overpass 不可達)⇒ 未驗`);
    continue;
  }
  const lat0 = (bbox.minLat + bbox.maxLat) / 2;
  const boxA = bboxAreaM2(bbox);
  const area = Object.fromEntries(BIO_KEYS.map((k) => [k, 0]));
  let covered = 0;
  for (const c of lc.covers) {
    const k = coverKind(c.tags);
    if (!k) continue;
    const a = polyAreaM2(c.geometry, lat0);
    area[k] += a; covered += a;
  }
  let built = 0;
  for (const b of lc.buildings) built += polyAreaM2(b.geometry, lat0);
  const measured = Object.fromEntries(BIO_KEYS.map((k) => [k, covered > 0 ? area[k] / covered : 0]));
  const coverF = Math.min(1, covered / boxA);      // 有標註的面積佔 bbox 多少(信心)
  const builtF = Math.min(1, built / boxA);        // 建蔽率

  const notes = [];
  const thin = coverF < TOL.COVER_MIN;
  if (!thin) {
    for (const k of BIO_KEYS) {
      const d = v.mix[k] || 0, m = measured[k];
      if (d >= TOL.MAJOR && m < TOL.MAJOR_MIN) notes.push(`宣告 ${k} ${(d * 100) | 0}% 但圖資只有 ${(m * 100) | 0}%`);
      if (m >= TOL.SURPRISE && d < TOL.SURPRISE_DECL) notes.push(`圖資 ${k} ${(m * 100) | 0}% 但宣告只有 ${(d * 100) | 0}%`);
    }
  }
  if ((v.mix.urban || 0) <= TOL.URBAN_LOW && builtF >= TOL.BUILT_HIGH) {
    notes.push(`宣告非市區(urban ${((v.mix.urban || 0) * 100) | 0}%)但建蔽率 ${(builtF * 100).toFixed(1)}%`);
  }
  const fmt = (o) => BIO_KEYS.filter((k) => o[k] > 0.005).map((k) => `${k} ${(o[k] * 100) | 0}%`).join('・') || '—';
  rows.push({ id: v.id, type: v.type, declared: v.mix, measured, coverF, builtF, notes,
    buildings: lc.buildings.length, capped: lc.capped, thin });
  console.log(`  ${(v.id + ' ').padEnd(15, '·')} ${v.type.padEnd(4)} 宣告[${fmt(v.mix)}]  圖資[${fmt(measured)}]`
    + `  地被覆蓋 ${(coverF * 100) | 0}%  建蔽 ${(builtF * 100).toFixed(1)}%（${lc.buildings.length} 棟${lc.capped ? '，頂到額度' : ''}）`
    + (thin ? '  ⓘ 地被標註太稀疏,組成只報不判' : '')
    + (notes.length ? `\n${' '.repeat(19)}⚠️ ${notes.join(';')}` : ''));
}

// ---- Ⅲ 不符清單 ----
console.log('\nⅢ 不符合宣告類型的地圖');
{
  const bad = rows.filter((r) => r.notes.length);
  if (!bad.length) console.log('  (無)');
  for (const r of bad) console.log(`  ${r.id}(${r.type}):${r.notes.join(';')}`);
  ok(!bad.length, `${rows.length} 個實測到的場地全部符合宣告${bad.length ? ` —— ${bad.length} 個不符` : ''}`);
}

if (ARG.json) writeFileSync(ARG.json, JSON.stringify({ tol: TOL, rows }, null, 1));
console.log(`\n${fail || unverified ? '❌' : '✅'} 通過 ${pass} 項`
  + `${fail ? `,失敗 ${fail} 項` : ''}${unverified ? `,未驗 ${unverified} 個場地(取不到圖資)` : ''}`);
process.exit(fail || unverified ? 1 : 0);
