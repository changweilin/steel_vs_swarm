// ============ 在地文字招牌稽核 ============
// 用法:node tools/audit_vernacular.mjs        (不需伺服器/瀏覽器/網路)
//
// 驗的是「招牌上的字對不對」與「畫上去的方式會不會靜默壞掉」。這個系統的失效**全部**
// 是無聲的 —— 沒有例外、沒有紅字,只表現成「這張圖看起來怪怪的」:
//   ・主幹抓到原名裡不存在的字串(2026-08-03 taipei101 首烤:spine=路巷、spineHits=0)
//   ・OSM 的列舉值(religion=taoist)當人看的字上牌
//   ・去重帳漏掉合成名 ⇒ 同一個名字掛在兩塊牌上(一鎮兩家)
//
// 三種驗法:
//   Ⅰ・Ⅱ  直接 import `vernacular.js` **真品**(該檔零 import,Node 跑得動)
//   Ⅲ     讀原文驗「語料 → 世界文字」的接線(圖集/UV/裝箱住 worldtext ⇒ 由
//          `audit_world_text.mjs` Ⅴ 驗,本支不重複)
//   Ⅳ・Ⅴ  讀原文驗單一縫與紀律 / 驗烘焙語料
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readSrc, ROOT } from './audit_src.mjs';
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

/* ------------------------- Ⅲ 語料 → 世界文字的接線 ------------------------- */
sec('Ⅲ 接線(worldtext.js 是唯一的文字圖層)');

const wtSrc = readSrc('public', 'js', 'worldtext.js');
const bioSrc = readSrc('public', 'js', 'biomes.js');
const vnSrc = readSrc('public', 'js', 'vernacular.js');
const gndSrc = readSrc('public', 'js', 'ground.js');
const strip = (t) => t.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// 舊 signage.js(第二份圖集 + 第二套逐實例 UV 規則)MUST 已整支退場 —— 一個世界
// 兩套文字圖層就是「第二份實作即是 bug」(原則 2)。
ok(!existsSync(join(ROOT, 'public', 'js', 'signage.js')), 'Ⅲ① signage.js 已退場(文字圖層只有 worldtext 一份)');
for (const [name, src] of [['biomes', bioSrc], ['ground', gndSrc]]) {
  ok(!/signage\.js|signAtlas|applySignAtlas/.test(src), `Ⅲ① ${name}.js 無 signage.js 殘留`);
}
// 五種語料庫語域 MUST 都在 worldtext 的樣式表裡(表與消費端分家 = 掛了卻沒有版面)
for (const cls of Object.keys(SIGN_CLASSES)) {
  ok(new RegExp(`^  ${cls}: \\{ cw:`, 'm').test(wtSrc), `Ⅲ② worldtext 有 ${cls} 的版面規格`);
  ok(new RegExp(`style: '${cls}'`).test(bioSrc), `Ⅲ② biomes 掛得出 ${cls}`);
}
// 挑字只有一條路:signCopy → sheet.add({ copy })
ok((bioSrc.match(/signCopy\(/g) || []).length === 1, 'Ⅲ③ biomes 只有一處呼叫 signCopy(copyOf)');
ok(/const copyOf = \(cls\) =>/.test(bioSrc), 'Ⅲ③ 語料庫挑字收斂成單一入口 copyOf');
// 取名規則只有一份:worldtext 只是薄殼
ok(/return pickName\(tags, lang, MAX_CHARS\);/.test(wtSrc),
  'Ⅲ④ resolveName 只是 pickName 的薄殼(取名規則住 vernacular,零 import ⇒ 稽核吃得到真品)');
ok(!/NAME_KEYS|name:zh-Hant/.test(strip(wtSrc)), 'Ⅲ④ worldtext 沒有第二份取名規則');
/* ------------------------------- Ⅳ 單一縫 ------------------------------- */
sec('Ⅳ 單一縫與紀律(讀原文)');

ok(!/^\s*import\s/m.test(strip(vnSrc)),
  'Ⅳ① vernacular.js MUST 零 import(離線烘焙與稽核才吃得到同一份規則)');
ok(!/Math\.random\s*\(/.test(strip(vnSrc)), 'Ⅳ② vernacular.js MUST NOT 用 Math.random(A4)');
ok(!/Math\.random\s*\(/.test(strip(wtSrc)), 'Ⅳ② worldtext.js MUST NOT 用 Math.random(A4)');
// 挑字用專屬亂數:MUST NOT 動到共享 rnd 的呼叫序(否則植被/建物佈局跟著漂)
ok(/const signRnd = mulberry32\(/.test(bioSrc) && /rnd: signRnd/.test(bioSrc),
  'Ⅳ③ 招牌挑字走專屬 seed,MUST NOT 用共享 rnd');
ok((bioSrc.match(/const signUsed = new Set\(\)/g) || []).length === 1,
  'Ⅳ③ 一鎮一家的去重帳全世界只有一本');
// 純表現層:招牌不得進碰撞/權威幾何
ok(!/blockers/.test(strip(wtSrc)), 'Ⅳ④ worldtext MUST NOT 碰 blockers(招牌是純表現層,不擋路)');
ok(/isBlocked/.test(bioSrc), 'Ⅳ④ 立牌落位 MUST 避開兵線淨空走廊');
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
