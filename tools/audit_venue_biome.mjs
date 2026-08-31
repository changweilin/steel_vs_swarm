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
//   `--offline` 只跑 Ⅰ(宣告自洽 + 建物管線不讀 mix + 裁剪 + 名冊)—— 那一段純離線,
//   `ci.yml` 收這一半;完整版(含 Ⅱ/Ⅲ 的圖資實測)掛在 `lane-scenarios.yml`。
// 退出碼:0 = 沒有未裁決的落差且無未驗;1 = 有未裁決的落差 or 有未驗(需要人看)
//
// 反向驗證(兩支都落在 Ⅰ 的離線斷言上 ⇒ 不需要網路):
//   --break-clip    退回「整條 way 全算」的舊制  ⇒ Ⅰ 的裁剪四條 MUST 紅
//   --break-roster  名冊退化成整場地放行        ⇒ Ⅰ 的「新種類照樣紅」MUST 紅
import { writeFileSync } from 'node:fs';
import { VENUES, venueConfig } from '../public/js/venues.js';
import { BIOMES, battleBBox } from '../public/js/data.js';
import { R_EARTH, d2r, landcoverFor } from './venue_field.mjs';
import { readSrc } from './audit_src.mjs';

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

// ---- 多邊形裁到 L1 bbox 內(Sutherland–Hodgman;2026-08-11)----
// 【為什麼非裁不可】Overpass 的 `out geom` 回的是**整條 way 的完整幾何** —— 只要碰到 bbox 一個
// 角就整片算進來。而這支量的是「這個**戰場方框**裡長什麼樣」,不是「碰到方框的多邊形總共多大」。
// 沒裁之前 hehuanshan 被一塊 4.28 km² 的 `landuse=residential`(埔里鎮,**3.4 倍於 1.24 km² 的
// 方框**)一手蓋掉 ⇒ 量出 urban 99%,而合歡山戰場裡一棟樓都不在那塊多邊形裡。uluru / okavango /
// venice / rio 全是同一個病:錨點旁邊那個城鎮的 landuse 整片被算進來。
// 症狀之所以難看出來,是因為它**不會報錯**:數字合理、排版整齊、每一輪都一樣,只是量錯了東西
// —— 照著它調 `mix` 會把宣告改成「錨點鄰鎮的地貌」,而那正是這支稽核要抓的毛病本身。
// 裁剪矩形是凸的 ⇒ S–H 對凹多邊形產生的退化橋接邊面積為 0,鞋帶公式仍給正確面積。
function clipToBBox(geom, b) {
  const EDGES = [
    [(p) => p.lon >= b.minLng, 'lon', b.minLng], [(p) => p.lon <= b.maxLng, 'lon', b.maxLng],
    [(p) => p.lat >= b.minLat, 'lat', b.minLat], [(p) => p.lat <= b.maxLat, 'lat', b.maxLat],
  ];
  let poly = geom;
  for (const [inside, ax, at] of EDGES) {
    if (!poly.length) return [];
    const out = [];
    const cut = (p, q) => {          // p→q 與該邊界線的交點(線性內插;ax 那一軸恆等於 at)
      const t = (at - p[ax]) / (q[ax] - p[ax]);
      return ax === 'lon' ? { lon: at, lat: p.lat + (q.lat - p.lat) * t }
                          : { lat: at, lon: p.lon + (q.lon - p.lon) * t };
    };
    for (let i = 0, n = poly.length; i < n; i++) {
      const p = poly[i], q = poly[(i + 1) % n], pi = inside(p), qi = inside(q);
      if (pi) out.push(p);
      if (pi !== qi) out.push(cut(p, q));
    }
    poly = out;
  }
  return poly;
}
/** 裁進 bbox 之後的面積(完全在框外 ⇒ 0) */
const clippedAreaM2 = (geom, b, lat0) => {
  if (ARG['break-clip']) return polyAreaM2(geom, lat0);    // 退回舊制:整條 way 全算(反向驗證)
  const p = clipToBBox(geom, b);
  return p.length >= 3 ? polyAreaM2(p, lat0) : 0;
};

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
  // 反向:宣告 urban ≥ MAJOR 卻幾乎沒有樓 ⇒ 「說是市區但空地一片」。這是 urban 軸唯一的
  // 反向判據 —— landcover 的 urban 佔比不能用(見 JUDGED_AXES)。
  BUILT_LOW: 0.03,
};

const BIO_KEYS = Object.keys(BIOMES);

// ---- 可信軸(2026-08-11 使用者裁決後收緊)----
// 【為什麼不是每一軸都拿來判】OSM 的地被標註對不同地貌的**可靠度差很多**,拿不可靠的軸去判
// 就是逐輪誤報,而誤報多了這份清單就沒有人看 —— 那才是這支稽核真正的死法。
//   ・`water` OSM 一定畫(河海湖是製圖的骨架)⇒ 雙向可信。
//   ・`green` / `bare` **互相污染**:紅色沙漠被標成 `natural=scrub`(→ green)、高山碎石坡標
//     `scrub` 或整片不標。uluru 宣告 bare 95% 量到 0%、giza 宣告 bare 85% 量到 green 97%
//     ——兩張圖的宣告都沒錯,錯的是拿「裸露 vs 灌木」這條 OSM 自己都不一致的界線去判。
//     ⇒ 合併成一軸「未開發地」:分不出來的東西不判,分得出來的(開發 vs 未開發)才判。
//   ・`urban` 的 landcover 佔比**兩個方向都不可信**:密市區的街廓很少被畫成
//     `landuse=residential`(paris 量到 0%,而建蔽率 18%);反過來鎮級 landuse 可以劃滿整框
//     卻只有幾十棟樓(hehuanshan 量到 98%,而建蔽率 2.5%)。⇒ 退出 landcover 比對,
//     「是不是市區」一律由**建蔽率**判(BUILT_HIGH / BUILT_LOW 雙向)。
//   ・`wet` OSM 極少畫(`natural=wetland` 只在保護區才標)⇒ 不判。
const JUDGED_AXES = [
  ['water', ['water']],
  ['未開發地', ['green', 'bare']],
];

// ---- 已裁決名冊(2026-08-11 使用者裁決)----
// 【這一張表存在的理由】`mix` 是**手寫的美術宣告**,不是實測值 —— 使用者 2026-08-11 定案
// 「保持 mix,承認它是美術宣告」。下面這些場地的錨點為了拿到路網被搬到鄰鎮(`venues.js` 的
// `ll` 註解寫得很清楚),而 `mix` 仍描述那個地標;這是**刻意的取捨**,不是待修的 bug。
// 但「已裁決」MUST NOT 等於「這支稽核從此不判」:名冊**之外**的落差照樣紅字 ⇒ 之後有人動
// `mix`、搬錨點、或 OSM 那一帶被重畫,還是會被抓出來。名冊裡的落差消失了也會印(stale),
// 但不判 —— 圖資本來就會變,那不是誰的錯。
// 【赦免的是「種類」不是「場地」】整個場地放行 = 橡皮圖章:hehuanshan 今天被赦免的是
// 「未開發地量不到」,明天它的建蔽率從 2.5% 跳到 40%(那一帶被蓋滿)也會一起被吞掉,
// 而那正是需要有人知道的事。⇒ 名冊逐筆列出**接受哪幾種**落差,新種類照樣紅。
const ACCEPTED = {
  yangmingshan: { kinds: ['built:high'], why: '錨點 = 天母(要路網);宣告描述的是陽明山' },
  aokigahara: { kinds: ['built:high'], why: '錨點 = 河口湖町(要路網);宣告描述的是青木原樹海' },
  blackforest: { kinds: ['built:high'], why: '錨點 = 鎮上(要路網);宣告描述的是黑森林' },
  hehuanshan: { kinds: ['axis:未開發地'], why: '錨點 = 埔里(要路網);宣告描述的是合歡山' },
  iguazu: { kinds: ['axis:water', 'built:high'], why: '錨點 = 鎮上(要路網);瀑布與水體不在 L1 方框內' },
  tamsui: { kinds: ['axis:water'], why: '錨點 = 淡水市街(要路網);宣告描述的是河口濕地' },
  rio: { kinds: ['axis:未開發地'], why: '錨點 = 市區(要路網);宣告的綠地是周邊山體,不在 L1 方框內' },
};
/** 落差扣掉名冊赦免的那幾種 ⇒ 剩下的就是「沒有人看過」的,MUST 紅 */
function unaccepted(id, notes) {
  if (ARG['break-roster']) return ACCEPTED[id] ? [] : notes;   // 退化成整場地放行(反向驗證)
  const kinds = ACCEPTED[id]?.kinds || [];
  return notes.filter((n) => !kinds.includes(n.kind));
}

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
  const bio = readSrc('public', 'js', 'biomes.js');
  const i0 = bio.indexOf('  // ---- 聚落場(單一縫)');
  const i1 = bio.indexOf('  // 市區補間:把被 8 倍世界撐開的街廓填回連續街區');
  ok(i0 > 0 && i1 > i0 && !/\bmix\b/.test(bio.slice(i0, i1).replace(/\/\/.*$/gm, '')),
    '建物管線(聚落場 + 街廓配置)不讀 venue.mix —— 地貌一律由圖資判,宣告不參與');
  // 2026-08-05 補上同一條防線的另外兩個出口(使用者回報「綠地/裸露地建築太多」):
  // 邊界樓也是建物(進 generic ⇒ 碰撞/立面同路)⇒ 市區判定 MUST 過聚落場;
  // 備援程序街區 MUST 只在圖資查詢失敗時觸發(查到零建物 = 真實答案,不是降級的理由)。
  const bare = bio.replace(/\/\/.*$/gm, '');
  ok(/biome === 'urban' && !settlement\?\.\(x, z\)/.test(bare),
    '邊界樓(placeBoundary)的市區判定過聚落場 —— mix / 衛星誤判不得憑空生出建物');
  ok(/if \(!osmSource && \(!mix \|\| \(mix\.urban \|\| 0\) > 0\.1\)/.test(bare),
    '備援程序街區只在圖資查詢失敗(!osmSource)且宣告有市區成分時觸發 —— 查詢成功但零面域 ⇒ 荒野維持荒野');

  // ---- 裁剪(2026-08-11;離線直測,CI 收得到)----
  // 這一組守的是**量測本身**:沒裁之前一塊 3.4 倍於方框的鎮級 landuse 就能把組成整個蓋掉,
  // 而輸出看起來完全正常(數字合理、每輪一樣)⇒ 只有拿已知答案的方框去對才抓得到。
  const B = { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 };   // 單位框(面積 = 1° × 1° 的 m²)
  const A1 = bboxAreaM2(B), lat0 = 0.5;
  const sq = (x0, y0, x1, y1) => [{ lon: x0, lat: y0 }, { lon: x1, lat: y0 }, { lon: x1, lat: y1 }, { lon: x0, lat: y1 }];
  const near = (a, b) => Math.abs(a - b) / A1 < 1e-6;
  ok(clippedAreaM2(sq(2, 2, 3, 3), B, lat0) === 0, '裁剪:完全在方框外 ⇒ 面積 0(碰不到就不該計入)');
  ok(near(clippedAreaM2(sq(0.25, 0.25, 0.75, 0.75), B, lat0), A1 * 0.25),
    '裁剪:完全在框內 ⇒ 面積不變(裁剪 MUST NOT 順手改動本來就合格的那些)');
  ok(near(clippedAreaM2(sq(0.5, 0, 5, 1), B, lat0), A1 * 0.5),
    '裁剪:跨出框 ⇒ 只算框內那一半(hehuanshan 的 4.28 km² 鎮級 landuse 就是靠這一條收回來的)');
  ok(near(clippedAreaM2(sq(-3, -3, 4, 4), B, lat0), A1),
    '裁剪:整個方框被包住 ⇒ 上限恰是方框(否則單一多邊形就能量出 340% 的地被覆蓋)');

  // ---- 已裁決名冊(2026-08-11;離線直測,CI 收得到)----
  // 名冊是**使用者的裁決**被編碼進來,不是把 Ⅲ 關掉 —— 這三條就是那條界線。
  const N = (kind) => [{ kind, text: '' }];
  const listed = Object.keys(ACCEPTED)[0], listedKind = ACCEPTED[listed].kinds[0];
  ok(unaccepted('__nobody__', N('built:high')).length === 1,
    '名冊:沒被裁決過的場地 ⇒ 落差原樣留下(名冊 MUST NOT 變成「反正都放行」)');
  ok(unaccepted(listed, N(listedKind)).length === 0,
    `名冊:已裁決的那一種落差 ⇒ 赦免(${listed}/${listedKind})`);
  ok(unaccepted(listed, N('__newkind__')).length === 1,
    '名冊:已裁決場地冒出**新種類**落差 ⇒ 照樣紅(整個場地放行 = 橡皮圖章)');
  ok(Object.keys(ACCEPTED).every((id) => VENUES.some((v) => v.id === id)),
    '名冊:條目全部是現役場地 id(場地改名 ⇒ 赦免會靜默套不上而不是報錯)');
  ok(Object.values(ACCEPTED).every((a) => a.why && a.kinds?.length),
    '名冊:每一筆 MUST 有理由與種類(沒寫理由的赦免,三個月後沒有人知道能不能撤)');
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
    const a = clippedAreaM2(c.geometry, bbox, lat0);
    area[k] += a; covered += a;
  }
  let built = 0;
  for (const b of lc.buildings) built += clippedAreaM2(b.geometry, bbox, lat0);
  const measured = Object.fromEntries(BIO_KEYS.map((k) => [k, covered > 0 ? area[k] / covered : 0]));
  const coverF = Math.min(1, covered / boxA);      // 有標註的面積佔 bbox 多少(信心)
  const builtF = Math.min(1, built / boxA);        // 建蔽率

  const notes = [];
  const thin = coverF < TOL.COVER_MIN;
  if (!thin) {
    // 只比對**可信軸**(見 JUDGED_AXES):水體、以及 green+bare 合併的「未開發地」。
    for (const [name, keys] of JUDGED_AXES) {
      const d = keys.reduce((s, k) => s + (v.mix[k] || 0), 0);
      const m = keys.reduce((s, k) => s + measured[k], 0);
      const kind = `axis:${name}`;
      if (d >= TOL.MAJOR && m < TOL.MAJOR_MIN) notes.push({ kind, text: `宣告 ${name} ${(d * 100) | 0}% 但圖資只有 ${(m * 100) | 0}%` });
      if (m >= TOL.SURPRISE && d < TOL.SURPRISE_DECL) notes.push({ kind, text: `圖資 ${name} ${(m * 100) | 0}% 但宣告只有 ${(d * 100) | 0}%` });
    }
  }
  // urban 只由建蔽率判(雙向)—— landcover 的 urban 佔比兩個方向都不可信,見 JUDGED_AXES。
  const du = v.mix.urban || 0;
  if (du <= TOL.URBAN_LOW && builtF >= TOL.BUILT_HIGH) {
    notes.push({ kind: 'built:high', text: `宣告非市區(urban ${(du * 100) | 0}%)但建蔽率 ${(builtF * 100).toFixed(1)}%` });
  }
  if (du >= TOL.MAJOR && builtF < TOL.BUILT_LOW) {
    notes.push({ kind: 'built:low', text: `宣告市區(urban ${(du * 100) | 0}%)但建蔽率只有 ${(builtF * 100).toFixed(1)}%` });
  }
  const fmt = (o) => BIO_KEYS.filter((k) => o[k] > 0.005).map((k) => `${k} ${(o[k] * 100) | 0}%`).join('・') || '—';
  rows.push({ id: v.id, type: v.type, declared: v.mix, measured, coverF, builtF, notes,
    buildings: lc.buildings.length, capped: lc.capped, thin });
  console.log(`  ${(v.id + ' ').padEnd(15, '·')} ${v.type.padEnd(4)} 宣告[${fmt(v.mix)}]  圖資[${fmt(measured)}]`
    + `  地被覆蓋 ${(coverF * 100) | 0}%  建蔽 ${(builtF * 100).toFixed(1)}%（${lc.buildings.length} 棟${lc.capped ? '，頂到額度' : ''}）`
    + (thin ? '  ⓘ 地被標註太稀疏,組成只報不判' : '')
    + (notes.length ? `\n${' '.repeat(19)}⚠️ ${notes.map((n) => n.text).join(';')}` : ''));
}

// ---- Ⅲ 不符清單 ----
console.log('\nⅢ 不符合宣告類型的地圖');
{
  const bad = rows.map((r) => ({ ...r, fresh: unaccepted(r.id, r.notes) })).filter((r) => r.notes.length);
  const nFresh = bad.reduce((s, r) => s + r.fresh.length, 0);
  if (!bad.length) console.log('  (無)');
  for (const r of bad) {
    if (r.fresh.length) console.log(`  ${r.id}(${r.type}):${r.fresh.map((n) => n.text).join(';')}`);
    const pardoned = r.notes.filter((n) => !r.fresh.includes(n));
    if (pardoned.length) console.log(`  ・已裁決 ${r.id}(${r.type}):${pardoned.map((n) => n.text).join(';')}`
      + `\n      ↳ ${ACCEPTED[r.id].why}`);
  }
  // 名冊裡的落差消失了 ⇒ 印出來但不判(圖資會變,那不是誰的錯;留著過期條目才是問題)
  const stale = Object.entries(ACCEPTED).flatMap(([id, a]) => {
    const r = rows.find((x) => x.id === id);
    return r ? a.kinds.filter((k) => !r.notes.some((n) => n.kind === k)).map((k) => `${id}/${k}`) : [];
  });
  if (stale.length) console.log(`  ⓘ 已裁決名冊有 ${stale.length} 筆不再落差(圖資變了?可以撤掉):${stale.join('、')}`);
  ok(!nFresh, `${rows.length} 個實測到的場地沒有**未裁決**的落差`
    + `${nFresh ? ` —— ${nFresh} 筆不符` : ''}`
    + `(已裁決 ${bad.reduce((s, r) => s + r.notes.length - r.fresh.length, 0)} 筆,見上)`);
  // **讀這份清單的注意事項(不是程式的毛病,是圖資的性質)**:
  // OSM 的地被多邊形對「市區」是**系統性偏低**的 —— 密市區的街廓很少被畫成
  // `landuse=residential`(那是郊區/新市鎮的畫法),而公園綠地一定會被畫出來
  // ⇒ 巴黎那種「宣告 urban 80% 但地被 urban 0%」多半是標註習慣,不是地貌judgement 錯。
  // 判「這裡到底是不是市區」一律以**建蔽率**為準(它量的是真的被樓蓋住的地),
  // 地被組成只用來看「綠地/裸露/水體」那幾軸。兩個數字擺在一起就是為了這件事。
  console.log('\n  ⓘ 讀法:地被的 urban 軸兩個方向都不可信(密市區街廓少被畫成 landuse=residential;'
    + '\n     反過來鎮級 landuse 可以劃滿整框卻只有幾十棟樓)⇒ 它已退出比對,「是不是市區」只看'
    + '**建蔽率**。\n     green/bare 互相污染(沙漠常被標成 scrub)⇒ 合併成「未開發地」一軸判。');
  const built = rows.filter((r) => (r.declared.urban || 0) <= TOL.URBAN_LOW && r.builtF >= TOL.BUILT_HIGH)
    .sort((a, b) => b.builtF - a.builtF);
  if (built.length) {
    console.log(`  ⓘ 宣告非市區卻蓋滿樓的場地(建蔽率排序):`
      + built.map((r) => `${r.id} ${(r.builtF * 100).toFixed(1)}%`).join('、'));
  }
}

if (ARG.json) writeFileSync(ARG.json, JSON.stringify({ tol: TOL, rows }, null, 1));
console.log(`\n${fail || unverified ? '❌' : '✅'} 通過 ${pass} 項`
  + `${fail ? `,失敗 ${fail} 項` : ''}${unverified ? `,未驗 ${unverified} 個場地(取不到圖資)` : ''}`);
process.exit(fail || unverified ? 1 : 0);
