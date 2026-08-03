// ============ 在地文字招牌稽核 ============
// 用法:node tools/audit_vernacular.mjs        (不需伺服器/瀏覽器/網路)
//
// 驗的是「招牌上的字對不對」與「畫上去的方式會不會靜默壞掉」。這個系統的失效**全部**
// 是無聲的 —— 沒有例外、沒有紅字,只表現成「這張圖看起來怪怪的」:
//   ・主幹抓到原名裡不存在的字串(2026-08-03 taipei101 首烤:spine=路巷、spineHits=0)
//   ・OSM 的列舉值(religion=taoist)當人看的字上牌
//   ・圖集 UV 的 v 沒翻 ⇒ 整批招牌上下顛倒
//   ・牌面長寬比 ≠ 圖集儲存格長寬比 ⇒ 字被壓成一條糊帶
//   ・去重帳漏掉合成名 ⇒ 同一個名字掛在兩塊牌上(一鎮兩家)
//   ・逐實例 UV 屬性掛在跨場共用的 geometry 上 ⇒ 上一場的招牌蓋掉這一場
//
// 三種驗法:
//   Ⅰ・Ⅱ  直接 import `vernacular.js` **真品**(該檔零 import,Node 跑得動)
//   Ⅲ     以 `audit_src` 抽 `signage.js` 的純算術原文用 `new Function` 執行真品
//          (signage.js 的 three 走 CDN importmap,Node 端 import 不進來)
//   Ⅳ・Ⅴ  讀原文驗單一縫與紀律 / 驗烘焙語料
import { readSrc, grabFn } from './audit_src.mjs';
import {
  TEXT_KINDS, SIGN_CLASSES, classifyOsm, harvestOsm, spineOf, signCopy, textW,
  flagToIso, localeOf, emptyCorpus, mergeCorpus, corpusStats, LOCALE_LEX, ELE_WORD,
} from '../public/js/vernacular.js';
import { VENUE_TEXT } from '../public/js/venueText.js';
import { mulberry32 } from '../public/js/rng.js';

let pass = 0; const fails = [];
const ok = (cond, msg) => { if (cond) pass++; else fails.push(msg); };
const sec = (t) => console.log(`\n── ${t} ──`);

/* ------------------------------ Ⅰ 語料規則 ------------------------------ */
sec('Ⅰ 分類 / 取名 / 副行 / 主幹');

ok(classifyOsm({ amenity: 'place_of_worship', building: 'yes' }) === 'worship',
  'Ⅰ① 宗教判定 MUST 先於泛用 building');
ok(classifyOsm({ building: 'church' }) === 'worship', 'Ⅰ① building=church 歸宗教');
ok(classifyOsm({ amenity: 'police' }) === 'gov', 'Ⅰ① 派出所歸政府機關');
ok(classifyOsm({ railway: 'station' }) === 'transit', 'Ⅰ① 車站歸交通');
ok(classifyOsm({ waterway: 'river' }) === 'water', 'Ⅰ① 河川歸水文');
ok(classifyOsm({ natural: 'peak' }) === 'terrain', 'Ⅰ① 山峰歸地形');
ok(classifyOsm({ shop: 'bakery' }) === 'shop', 'Ⅰ① 商店歸商家');
ok(classifyOsm({ highway: 'primary' }) === 'road', 'Ⅰ① 道路歸路名');
ok(classifyOsm({ place: 'suburb' }) === 'place', 'Ⅰ① 聚落歸地名');
ok(classifyOsm({ highway: 'bus_stop' }) === 'transit', 'Ⅰ① 公車站牌歸交通(不是路名)');
ok(classifyOsm({ building: 'yes' }) === null && classifyOsm(null) === null, 'Ⅰ① 無語意的 tag 不入語料');
ok(TEXT_KINDS.length === 8, 'Ⅰ① 八類齊全');

{
  const c = harvestOsm({ pois: [{ tags: { shop: 'books', name: '大安書局', 'name:en': 'Daan Books' } }] });
  ok(c.shop[0].t === '大安書局', 'Ⅰ② 主名取在地文字,MUST NOT 用 name:en');
  ok(c.shop[0].en === 'Daan Books', 'Ⅰ② name:en 只當拉丁副名');
}
{
  // 列舉值上牌是最容易漏的一條:值是 OSM 的英文識別字,不是人看的字
  const rows = harvestOsm({ pois: [
    { tags: { amenity: 'place_of_worship', name: '大安宮', religion: 'taoist', denomination: 'chinese' } },
    { tags: { waterway: 'river', name: '基隆河' } },
    { tags: { place: 'neighbourhood', name: '大安里', population: '4000' } },
    { tags: { shop: 'restaurant', name: '一心食堂', cuisine: 'japanese;ramen' } },
  ] });
  const subs = TEXT_KINDS.flatMap((k) => rows[k].map((e) => e.s)).filter(Boolean);
  ok(!subs.some((s) => /taoist|chinese|river|neighbourhood|japanese|ramen/i.test(s)),
    `Ⅰ③ OSM 列舉值 MUST NOT 當副行上牌(實得 ${JSON.stringify(subs)})`);
}
{
  const c = harvestOsm({ pois: [{ tags: { natural: 'peak', name: '象山', ele: '183' } }] });
  ok(c.terrain[0].s === '183 m', 'Ⅰ③ 標高是數字 ⇒ 唯一可直接上牌的數值欄');
  const rnd = mulberry32(1);
  const cp = signCopy('scenic', { ...c, locale: 'zh-Hant', spine: null }, rnd, new Set());
  ok(cp.s === '海拔 183 m', `Ⅰ③ 標高冠詞由 ELE_WORD 在取字時補(實得 ${cp.s})`);
  ok(Object.keys(ELE_WORD).every((k) => k === 'und' || LOCALE_LEX[k]),
    'Ⅰ③ ELE_WORD 的語系 MUST 都有詞表(否則補了冠詞卻沒有其他日常副行)');
}

ok(textW('大安') === 2 && Math.abs(textW('ab') - 1.1) < 1e-9, 'Ⅰ④ textW:全形 1、拉丁 0.55');
ok(flagToIso('🇹🇼') === 'TW' && flagToIso('🇯🇵') === 'JP' && flagToIso('x') === null, 'Ⅰ④ 國旗 emoji → ISO');
// 渋谷 全是漢字 ⇒ 書寫系統分不出中日,回 zh-Hant 是**刻意**的(偏差朝「看得懂」);
// 要判成 ja 得有假名。國旗問得到時一律國旗優先,這條路只在自選座標才走得到。
ok(localeOf(null, ['渋谷']) === 'zh-Hant', 'Ⅰ④ 純漢字樣本回 zh-Hant(分不出中日時的具名取捨)');
ok(localeOf('🇫🇷') === 'fr' && localeOf(null, ['ハチ公前広場']) === 'ja' && localeOf(null, ['서울']) === 'ko'
  && localeOf(null, ['Broadway']) === 'und', 'Ⅰ④ 語系:先國旗、再書寫系統、問不出來回 und');
ok(!LOCALE_LEX.und, 'Ⅰ④ und MUST 無詞表(寧可留白,也不要在巴黎的牌子上寫外語)');
for (const [loc, lex] of Object.entries(LOCALE_LEX)) {
  ok(TEXT_KINDS.every((k) => Array.isArray(lex[k]) && lex[k].length >= 3),
    `Ⅰ④ 詞表 ${loc} 八類 MUST 各 ≥3 條`);
}

{
  // 主幹:2026-08-03 首烤的真實壞法 —— 先刪非 CJK 再滑窗會生出原名裡不存在的字串
  // 名字裡的數字把兩個詞素隔開:壞版(先刪非 CJK 再滑窗)會滑出「幸福廣」這種
  // **原名裡不存在**的字串。案例 MUST 選不含地物通名的詞素,否則通名過濾會把 bug 遮掉
  //(用「松智路 5 巷」驗不出來:接出來的「路巷」本來就被通名過濾丟掉了)。
  const c = emptyCorpus('zh-Hant');
  c.road = [{ t: '幸福 2 廣場' }, { t: '幸福 8 廣場' }, { t: '幸福 11 廣場' }];
  const sp = spineOf(c);
  ok(sp === null || c.road.some((e) => e.t.includes(sp)),
    `Ⅰ⑤ 主幹 MUST 真的出現在語料裡(實得 ${sp} —— 跨間隙接出來的字串對不上任何一個名字)`);
}
{
  const c = emptyCorpus('zh-Hant');
  c.road = [{ t: '信義路一段' }, { t: '信義路二段' }, { t: '大安路' }];
  c.place = [{ t: '信義區' }];
  ok(spineOf(c) === '信義', `Ⅰ⑤ 主幹 = 出現在最多不同名字裡的地名詞素(實得 ${spineOf(c)})`);
}
{
  const c = emptyCorpus('zh-Hant');
  c.road = [{ t: '中山路' }, { t: '成功路' }, { t: '光復路' }];
  ok(spineOf(c) !== '路', 'Ⅰ⑤ 地物通名 MUST NOT 當主幹');
}
{
  const c = emptyCorpus('ja');
  c.place = [{ t: 'ひばり台' }, { t: 'ひばり山' }, { t: 'ひばり湖' }];
  ok(spineOf(c) === 'ひばり', `Ⅰ⑤ 假名地名要 3 字窗才抓得到(實得 ${spineOf(c)})`);
}
{
  const c = emptyCorpus('zh-Hant');
  c.road = [{ t: '獨一無二路' }];
  ok(spineOf(c) === null, 'Ⅰ⑤ 只出現在一個名字裡的詞不算主幹');
}
{
  const baked = emptyCorpus('ja'); baked.shop = [{ t: 'A' }];
  const live = emptyCorpus('ja'); live.shop = [{ t: 'A' }, { t: 'B' }];
  const m = mergeCorpus(baked, live);
  ok(m.shop.length === 2 && m.shop[0].t === 'A', 'Ⅰ⑥ 合併:烘焙那份排前面且同名只留一則');
}

/* ------------------------------ Ⅱ 挑字上牌 ------------------------------ */
sec('Ⅱ 挑字(語域 / 去重 / 容量 / 決定性)');

const demo = () => harvestOsm({ pois: [
  { tags: { shop: 'books', name: '大安書局', opening_hours: '09:00-21:00' } },
  { tags: { shop: 'bakery', name: '麥香坊' } },
  { tags: { amenity: 'place_of_worship', name: '大安宮' } },
  { tags: { amenity: 'police', name: '大安分局' } },
  { tags: { highway: 'primary', name: '大安路一段', ref: '市道101' } },
  { tags: { highway: 'residential', name: '信義路四段' } },
  { tags: { natural: 'peak', name: '象山', ele: '183' } },
  { tags: { waterway: 'river', name: '基隆河' } },
  { tags: { place: 'neighbourhood', name: '大安里' } },
  { tags: { railway: 'station', name: '大安站' } },
] }, 'zh-Hant');

{
  const c = demo();
  for (const cls of Object.keys(SIGN_CLASSES)) {
    const rnd = mulberry32(11), used = new Set();
    const got = [];
    for (let i = 0; i < 6; i++) { const cp = signCopy(cls, c, rnd, used); if (cp) got.push(cp); }
    ok(got.every((cp) => SIGN_CLASSES[cls].kinds.includes(cp.kind)),
      `Ⅱ① ${cls} 只挑得到自己語域的類別`);
    ok(got.every((cp) => textW(cp.t) <= SIGN_CLASSES[cls].cap.t),
      `Ⅱ② ${cls} 主名 MUST 在容量內(取字階段就篩,不是畫的時候縮)`);
    ok(got.every((cp) => !cp.s || textW(cp.s) <= SIGN_CLASSES[cls].cap.s),
      `Ⅱ② ${cls} 副行 MUST 在容量內`);
    ok(got.every((cp) => !cp.en || (SIGN_CLASSES[cls].cap.en && textW(cp.en) <= SIGN_CLASSES[cls].cap.en)),
      `Ⅱ② ${cls} 拉丁副名 MUST 在容量內(cap.en=0 即不放)`);
    const names = got.map((cp) => cp.t);
    ok(new Set(names).size === names.length, `Ⅱ③ ${cls} 同一本帳 MUST NOT 出現兩塊同名(含合成名)`);
  }
}
{
  // 一鎮一家:五類招牌共用同一本帳 ⇒ 跨類別也不得重名
  const c = demo();
  const rnd = mulberry32(5), used = new Set(), names = [];
  for (let i = 0; i < 4; i++) for (const cls of Object.keys(SIGN_CLASSES)) {
    const cp = signCopy(cls, c, rnd, used);
    if (cp) names.push(cp.t);
  }
  ok(new Set(names).size === names.length, 'Ⅱ③ 跨類別共用一本去重帳');
}
{
  const c = demo();
  const run = () => {
    const rnd = mulberry32(23), used = new Set();
    return Array.from({ length: 12 }, () => JSON.stringify(signCopy('billboard', c, rnd, used))).join('|');
  };
  ok(run() === run(), 'Ⅱ④ 決定性:同種子逐字元相同(否則同房間兩人看到不同招牌)');
}
{
  // 固定枚數是全域確定性紀律:淘汰檢查一律排在抽樣之後
  const c = demo();
  for (const cls of Object.keys(SIGN_CLASSES)) {
    let n = 0;
    const base = mulberry32(7);
    const rnd = () => { n++; return base(); };
    signCopy(cls, c, rnd, new Set());
    ok(n === 3, `Ⅱ⑤ ${cls} 每次挑字固定消耗 3 枚亂數(實得 ${n})`);
  }
}
{
  // 零字場地:有詞表 ⇒ 退回不含專名的通用牌面;無詞表 ⇒ 整批不出場(MUST NOT 亂碼/佔位符)
  const ja = emptyCorpus('ja');
  const cp = signCopy('notice', ja, mulberry32(3), new Set());
  ok(cp && LOCALE_LEX.ja.place.concat(LOCALE_LEX.ja.gov, LOCALE_LEX.ja.worship).includes(cp.t),
    'Ⅱ⑥ 零字場地(有詞表)退回通用牌面');
  ok(signCopy('notice', emptyCorpus('und'), mulberry32(3), new Set()) === null,
    'Ⅱ⑥ 零字場地(無詞表)回 null ⇒ 呼叫端退回純色牌(寧缺勿錯)');
}
{
  // 容量反例:超長名字整個進不去,而不是被畫成一團
  const c = emptyCorpus('zh-Hant');
  c.shop = [{ t: '這是一個長得不像話的店名超出容量上限' }];
  const cp = signCopy('wallsign', c, mulberry32(2), new Set());
  ok(!cp || cp.t !== c.shop[0].t, 'Ⅱ② 超出容量的語料 MUST NOT 被選中');
}

/* ---------------------------- Ⅲ 圖集版面 / UV ---------------------------- */
sec('Ⅲ 圖集版面與逐實例 UV(執行 signage.js 原文)');

const sgSrc = readSrc('public', 'js', 'signage.js');
const specI = sgSrc.indexOf('const SPEC = {');
const specSrc = sgSrc.slice(specI, sgSrc.indexOf('\n};', specI) + 3);
const SG = new Function(`${specSrc}\n${grabFn(sgSrc, 'atlasLayout')}\n${grabFn(sgSrc, 'signAspect')}\n`
  + 'return { atlasLayout, signAspect, SPEC };')();

for (const cls of Object.keys(SIGN_CLASSES)) {
  ok(SG.SPEC[cls], `Ⅲ① ${cls} MUST 有版面規格`);
  const s = SG.SPEC[cls];
  ok(Math.abs(SG.signAspect(cls) - s.cw / s.ch) < 1e-9, `Ⅲ① ${cls} signAspect === cw/ch`);
  for (const n of [1, 3, 7, 16, 24]) {
    const cells = Math.min(n, s.max);
    const L = SG.atlasLayout(cls, cells);
    ok(L.W <= 2048 && L.H <= 2048, `Ⅲ② ${cls}/${cells} 畫布 ≤2048`);
    const r = L.rect;
    let inRange = true, overlap = false;
    for (let i = 0; i < cells; i++) {
      const [u, v, w, h] = [r[i * 4], r[i * 4 + 1], r[i * 4 + 2], r[i * 4 + 3]];
      if (u < -1e-6 || v < -1e-6 || u + w > 1 + 1e-6 || v + h > 1 + 1e-6) inRange = false;
      for (let j = 0; j < i; j++) {
        const [u2, v2, w2, h2] = [r[j * 4], r[j * 4 + 1], r[j * 4 + 2], r[j * 4 + 3]];
        if (u < u2 + w2 - 1e-6 && u2 < u + w - 1e-6 && v < v2 + h2 - 1e-6 && v2 < v + h - 1e-6) overlap = true;
      }
    }
    ok(inRange, `Ⅲ② ${cls}/${cells} 每格 UV 落在 [0,1]`);
    ok(!overlap, `Ⅲ② ${cls}/${cells} 每格互不重疊(重疊 = 招牌上出現隔壁那塊牌的半個字)`);
  }
  // v 翻轉:canvas 原點在左上、UV 原點在左下 ⇒ 第 0 格(畫布最上一列)的 v 要在**上方**。
  // 案例 MUST 逼出 ≥2 列 —— 單列時 H === ch,翻與不翻都得到 v=0,測不出來。
  const cols1 = Math.max(1, Math.min(s.max, Math.floor(2048 / s.cw)));
  const n2 = Math.min(s.max, cols1 + 1);
  if (n2 > cols1) {
    const L2 = SG.atlasLayout(cls, n2);
    ok(L2.rows >= 2, `Ⅲ③ ${cls} 測資逼出多列`);
    ok(Math.abs(L2.rect[1] - (1 - s.ch / L2.H)) < 1e-9,
      `Ⅲ③ ${cls} 第 0 格的 v MUST 翻過(沒翻 = 整批招牌上下顛倒,不報錯)`);
    ok(L2.rect[1] > L2.rect[(n2 - 1) * 4 + 1],
      `Ⅲ③ ${cls} 畫布第一列 MUST 對到 UV 的上方(v 大)`);
  }
}

/* ------------------------------- Ⅳ 單一縫 ------------------------------- */
sec('Ⅳ 單一縫與紀律(讀原文)');

const vnSrc = readSrc('public', 'js', 'vernacular.js');
const bioSrc = readSrc('public', 'js', 'biomes.js');
const gndSrc = readSrc('public', 'js', 'ground.js');
const toonSrc = readSrc('public', 'js', 'toon.js');
const strip = (s) => s.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

ok(!/^\s*import\s/m.test(strip(vnSrc)),
  'Ⅳ① vernacular.js MUST 零 import(離線烘焙與稽核才吃得到同一份規則)');
for (const [name, src] of [['vernacular', vnSrc], ['signage', sgSrc]]) {
  ok(!/Math\.random\s*\(/.test(strip(src)), `Ⅳ② ${name}.js MUST NOT 用 Math.random(A4)`);
}
ok(/ClampToEdgeWrapping/.test(sgSrc) && !/RepeatWrapping/.test(strip(sgSrc)),
  'Ⅳ③ 圖集 MUST ClampToEdge(Repeat 會在格緣抓到隔壁那塊牌的字)');
ok(!/mirrored/.test(strip(sgSrc)) && !/\.repeat\.set/.test(strip(sgSrc)),
  'Ⅳ③ 雙面牌 MUST NOT 做鏡像(BoxGeometry 負向面已自己反轉 udir)');

// 長寬比是硬約束:牌面尺寸 MUST 由 signAspect 推導,MUST NOT 手寫第二個數字
{
  const bb = strip(bioSrc).match(/billboards\.push\([^\n]*\n?[^\n]*/)?.[0] || '';
  ok(/signAspect\('billboard'\)/.test(bb), 'Ⅳ④ 屋頂看板高度 MUST 由 signAspect 推導');
  const ws = strip(bioSrc).slice(strip(bioSrc).indexOf('const sh = Math.min(14'));
  ok(/signAspect\('wallsign'\)/.test(ws.slice(0, 300)), 'Ⅳ④ 直式招牌寬度 MUST 由 signAspect 推導');
  ok(/signAspect\('billboard'\)/.test(strip(gndSrc)), 'Ⅳ④ 街邊看板板高 MUST 由 signAspect 推導');
}
// 逐實例 UV 屬性掛在 geometry 上 ⇒ 跨場共用那一份就會互相蓋掉
ok(/part\.geo\.clone\(\)/.test(gndSrc),
  'Ⅳ⑤ ground.js 的圖集件 MUST 用 clone 的 geometry(DETAIL_DEFS 的 geo 是模組層共用的)');
// 圖集自帶配色 ⇒ tint 白
ok((bioSrc.match(/wsAt \? 0xffffff/g) || []).length === 1 && (bioSrc.match(/bbAt \? 0xffffff/g) || []).length === 1,
  'Ⅳ⑥ 圖集招牌的 instance tint MUST 是白(否則在已上色的招牌上再乘一次色)');
ok(/if \(at\) tint\.setHex\(0xffffff\)/.test(gndSrc), 'Ⅳ⑥ ground.js 同上');
// 純表現層:招牌不得進碰撞/權威幾何
{
  const i = bioSrc.indexOf('const signRes = buildSignage(');
  ok(i > 0, 'Ⅳ⑦ biomes.js MUST 有唯一一處 buildSignage 呼叫');
  ok((bioSrc.match(/buildSignage\(/g) || []).length === 1, 'Ⅳ⑦ buildSignage 只有一處呼叫');
  ok(!/blockers/.test(strip(sgSrc)), 'Ⅳ⑦ signage.js MUST NOT 碰 blockers(招牌是純表現層,不擋路)');
  ok(/isBlocked/.test(sgSrc), 'Ⅳ⑦ 立牌落位 MUST 避開兵線淨空走廊');
}
// 著色器補丁:順序錯不會報錯,只讓整批招牌用第 0 格
{
  const iUv = toonSrc.indexOf("replace('#include <uv_vertex>'");
  ok(iUv > 0, 'Ⅳ⑧ toon.js MUST 有 CEL_ATLAS 的 uv_vertex 補丁');
  const seg = toonSrc.slice(iUv, iUv + 400);
  ok(seg.indexOf('#include <uv_vertex>', 40) < seg.indexOf('vMapUv = aTexRect'),
    'Ⅳ⑧ 圖集重映 MUST 排在 <uv_vertex> 之後(排前面 = 改一個還沒賦值的 varying)');
  ok(/if \(atlas && mat\.map\)/.test(toonSrc),
    'Ⅳ⑧ CEL_ATLAS MUST 只在真的有 map 時開(沒有 USE_MAP 就沒有 vMapUv,補丁編不過)');
  ok((toonSrc.match(/aTexRect/g) || []).length >= 2 && !/aTexRect/.test(strip(bioSrc)),
    'Ⅳ⑧ aTexRect 的著色器宣告只住 toon.js、屬性只由 signage.js 掛');
}
// 挑字用專屬亂數:MUST NOT 動到共享 rnd 的呼叫序(否則植被/建物佈局跟著漂)
ok(/const signRnd = mulberry32\(/.test(bioSrc) && !/signAtlas\([^)]*rnd: rnd\b/.test(bioSrc),
  'Ⅳ⑨ 招牌挑字走專屬 seed,MUST NOT 用共享 rnd');
ok((bioSrc.match(/const signUsed = new Set\(\)/g) || []).length === 1,
  'Ⅳ⑨ 去重帳全世界只有一本');

/* ----------------------------- Ⅴ 烘焙語料檔 ----------------------------- */
sec('Ⅴ 烘焙語料(venueText.js)');

const ids = Object.keys(VENUE_TEXT);
ok(ids.length > 0, 'Ⅴ① 語料檔非空');
let totalRows = 0, withSpine = 0;
for (const id of ids) {
  const c = VENUE_TEXT[id];
  const st = corpusStats(c);
  totalRows += st.total;
  ok(TEXT_KINDS.every((k) => Array.isArray(c[k])), `Ⅴ② ${id} 八類鍵齊全`);
  ok(c.locale === 'und' || LOCALE_LEX[c.locale] || /^[a-z]{2}(-[A-Za-z]+)?$/.test(c.locale),
    `Ⅴ② ${id} locale 合法(實得 ${c.locale})`);
  const rows = TEXT_KINDS.flatMap((k) => c[k]);
  ok(rows.every((e) => typeof e.t === 'string' && e.t.length > 0 && e.t.length <= 40),
    `Ⅴ③ ${id} 主名非空且不過長`);
  ok(!rows.some((e) => /[ -]/.test(e.t + (e.s || '') + (e.en || ''))),
    `Ⅴ③ ${id} 語料無控制字元`);
  ok(rows.every((e) => !e.s || !/^(taoist|christian|muslim|river|stream|neighbourhood|suburb|quarter)$/i.test(e.s)),
    `Ⅴ③ ${id} 副行無 OSM 列舉值殘留`);
  if (c.spine) {
    withSpine++;
    ok(st.spineHits >= 2, `Ⅴ④ ${id} 主幹 MUST 真的出現在 ≥2 則語料裡(實得 ${st.spineHits})`);
  }
  // 每個場地至少要出得了一塊牌 —— 出不了就是這張圖整批退回純色牌
  const rnd = mulberry32(1);
  ok(Object.keys(SIGN_CLASSES).some((cls) => signCopy(cls, c, rnd, new Set())),
    `Ⅴ⑤ ${id} 至少一類招牌寫得出字`);
}
console.log(`   場地 ${ids.length}・語料 ${totalRows} 則・有主幹 ${withSpine}`);

/* ---------------------------------- 結果 ---------------------------------- */
console.log(`\n通過 ${pass} 項`);
if (fails.length) {
  console.log(`\n✗ ${fails.length} 項失敗:`);
  for (const f of fails) console.log('  ' + f);
  process.exit(1);
}
console.log('✓ 全綠');
