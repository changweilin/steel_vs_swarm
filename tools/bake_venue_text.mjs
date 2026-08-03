// ============ 預設場地在地文字語料離線烘焙 ============
// 用法:node tools/bake_venue_text.mjs        (ONLY=taipei101,kyoto 可只跑指定場地)
// 產出 public/js/venueText.js。改 `vernacular.js` 的分類/取名規則後 MUST 重跑。
//
// 為什麼要烘焙(而不是執行期抓):
//   ① 執行期那兩支 Overpass 查詢(建物 / 道路)只帶得回**建物與道路**的 tag —— 宗教、
//      交通、政府機關、水文、地名、地形這六類根本沒被查過,執行期怎麼撿都撿不到。
//      為了招牌再多發一個查詢 = 每一場開局多一次限流風險(全域 §2.4)。
//   ② 語料是**純文字**、與幾何無關 ⇒ 烤一次即定案,不需要跟著 GEO_SCALE_VER 走。
//   ③ 離線/沙漠/限流時仍出得了字(全域原則 6 降級不例外)。
// 執行期仍會把當場抓到的建物/道路 tag **併進來**(`mergeCorpus`,零額外網路)——
// 烘焙那份排前面(專門查詢,覆蓋率高),執行期那份補漏。
//
// 分類/取名/副行規則一律 import `public/js/vernacular.js` 真品,MUST NOT 在本檔另抄一份
// (抄一份 = 烘焙語料與執行期補收的語料走兩套規則,而畫面上只表現成「有些牌子怪怪的」)。
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { VENUES } from '../public/js/venues.js';
import { harvestOsm, mergeCorpus, corpusStats, localeOf, spineOf, textW, TEXT_KINDS } from '../public/js/vernacular.js';

const OUT = new URL('../public/js/venueText.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const CACHE = new URL('./.text_cache/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });

const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 查詢半徑:L3 地圖真實邊長 0.6km × MAP_EXPAND 1.33 ⇒ 半對角 ≈0.57km,而錨點是**主堡**
// 不是地圖中心(兩堡真實距離 L3 ≈0.72km)⇒ 錨點到最遠邊角 ≈0.93km。取 1100m 有餘裕。
// 多抓一點沒有代價 —— 語料只是字,擺不擺得上牌由 `signCopy` 的容量篩決定。
const RAD = 1100;
// 查詢版本:改 `query()` MUST +1。快取鍵不含它 = 改了查詢仍讀到舊回應,
// 而「路名為什麼還是 0」完全查不出來(2026-08-03 拆兩段 out 時踩到)。
const QV = 2;

// 每類保留上限(見下方 trim 的排序規則)。招牌全場最多百餘塊 ⇒ 這個量已經遠夠用,
// 上限存在的理由是檔案大小,不是覆蓋率。
const KEEP = { shop: 48, road: 40, place: 24, transit: 20, gov: 20, worship: 16, water: 16, terrain: 16 };

const UA = 'steel-vs-swarm/1.0 (venue vernacular text bake)';
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/**
 * 一個請求、**兩段 out**(各自額度)。選擇子刻意都掛 `["name"]` —— 沒有名字的元素對語料
 * 沒有任何價值,先在伺服器端濾掉才不會把額度浪費在無名建物上。
 *
 * 為什麼路名要獨立一段:Overpass 的 `out N` 是**整個 union 一起數**、而且**先輸出 node**。
 * 曼哈頓中城 1.1km 內的 POI 節點就上千個 ⇒ 單一 union 的額度在輪到 way 之前就用完,
 * road 直接掛零(2026-08-03 首烤實測:manhattan / seoul 的 road 都是 0,而 shop 滿額 48)。
 * 那不會報錯,只表現成「這兩張圖沒有路標」。
 */
function query(lat, lng) {
  const a = `(around:${RAD},${lat},${lng})`;
  return `[out:json][timeout:120];`
    + `way["name"]["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian)$"]${a};`
    + `out center tags 600;`
    + `(`
    + `nwr["name"]["shop"]${a};`
    + `nwr["name"]["craft"]${a};`
    + `nwr["name"]["office"]${a};`
    + `nwr["name"]["amenity"]${a};`
    + `nwr["name"]["tourism"]${a};`
    + `nwr["name"]["building"~"^(retail|commercial|church|temple|mosque|shrine|cathedral|chapel|synagogue|civic|public|school|hospital)$"]${a};`
    + `nwr["name"]["railway"~"^(station|halt|tram_stop)$"]${a};`
    + `nwr["name"]["public_transport"~"^(station|stop_position)$"]${a};`
    + `nwr["name"]["highway"="bus_stop"]${a};`
    + `nwr["name"]["waterway"]${a};`
    + `nwr["name"]["natural"~"^(water|spring|peak|ridge|cliff|valley|saddle|beach|cape|volcano)$"]${a};`
    + `nwr["name"]["historic"="wayside_shrine"]${a};`
    + `node["name"]["place"]${a};`
    + `);out center tags 2400;`;
}

async function overpass(id, lat, lng) {
  const f = `${CACHE}/${id}.json`;
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const q = query(lat, lng);
  for (let a = 0; a < 6; a++) {
    const url = ENDPOINTS[a % ENDPOINTS.length];
    try {
      // Content-Type 必須明講(同 bake_venue_lanes:Node fetch 預設 text/plain ⇒ Overpass 406)
      const resp = await fetch(url, {
        method: 'POST',
        // User-Agent 不可省:overpass-api.de 前面那層 Apache 對**沒有 UA** 的請求一律
        // 406 Not Acceptable(回的是 Apache 的錯誤頁,不是 Overpass 的)——
        // 看起來像查詢語法錯誤,實際上換個鏡像就過,極容易誤診。
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(120000),
      });
      if (!resp.ok) { log(`  overpass ${resp.status} @${new URL(url).host}, retry`); await sleep(3000 * (a + 1)); continue; }
      const d = await resp.json();
      const els = d.elements || [];
      if (d.remark) { log('  remark:', d.remark.slice(0, 80)); }   // 截斷/逾時:不入庫
      else writeFileSync(f, JSON.stringify(els));
      return els;
    } catch (e) { log('  overpass err', e.message); await sleep(3000 * (a + 1)); }
  }
  // 備援:OSM 官方 /map(公共 Overpass 鏡像對雲端 IP 常態拒絕)。回的是該 bbox 全部
  // 原始元素 —— 對語料反而更好用:`classifyOsm` 本來就會把沒興趣的濾掉。
  const els = await osmApiAll(lat, lng);
  if (els) { writeFileSync(f, JSON.stringify(els)); return els; }
  return null;
}

/** OSM /map 備援:回傳帶 tags 的元素陣列(語料只吃 tags,不需要幾何) */
async function osmApiAll(lat, lng) {
  const dLat = RAD / 111320, dLng = RAD / (111320 * Math.cos(lat * Math.PI / 180));
  const bb = `${(lng - dLng).toFixed(5)},${(lat - dLat).toFixed(5)},${(lng + dLng).toFixed(5)},${(lat + dLat).toFixed(5)}`;
  for (const host of ['https://api.openstreetmap.org', 'https://overpass-api.de']) {
    const url = host.includes('overpass')
      ? `${host}/api/map?bbox=${bb}` : `${host}/api/0.6/map.json?bbox=${bb}`;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
      if (!r.ok) { log(`  /map ${r.status} @${new URL(url).host}`); continue; }
      const d = await r.json();
      return (d.elements || []).filter((e) => e.tags);
    } catch (e) { log('  /map err', e.message); }
  }
  return null;
}

/**
 * 主幹在單一類別裡的配額上限。**主幹優先不能變成主幹獨佔** —— 巴黎首烤實測:
 * spine 抓到 `Général`(法文街名的常見成分),40 條路名裡前 12 條全是「Rue du Général X」,
 * 整條街讀起來像同一個人的紀念園區。主幹的作用是讓世界屬於同一個地方(SKILL §一.1),
 * 不是把其他名字擠掉;配額之外一律讓給別的名字。
 */
const SPINE_SHARE = 0.4;

/**
 * 每類裁到 KEEP 上限。規則**推導、不手挑**(重烤才可重現):
 *   ① 含主幹地名的優先,但最多佔 `SPINE_SHARE`
 *   ② 同組內短的優先 —— 招牌容量是硬上限,長名字本來就上不了大部分的牌(SKILL §一.6)
 *   ③ 仍同分則按字典序 —— 純粹為了可重現
 */
function trim(corpus) {
  const sp = corpus.spine;
  const byLen = (a, b) => textW(a.t) - textW(b.t) || (a.t < b.t ? -1 : 1);
  for (const k of TEXT_KINDS) {
    const cap = KEEP[k] ?? 24;
    const hit = corpus[k].filter((e) => sp && e.t.includes(sp)).sort(byLen);
    const rest = corpus[k].filter((e) => !(sp && e.t.includes(sp))).sort(byLen);
    const quota = Math.max(1, Math.ceil(cap * SPINE_SHARE));
    const out = [...hit.slice(0, quota), ...rest.slice(0, cap - Math.min(quota, hit.length))];
    // 其中一邊不夠多時互相補位(整體仍不超過 cap)
    if (out.length < cap) out.push(...hit.slice(quota, quota + cap - out.length));
    corpus[k] = out.slice(0, cap);
  }
  return corpus;
}

/** 緊湊序列化:一則語料一行,欄位順序固定 ⇒ 重烤的 diff 只有真的變動的那幾行 */
function ser(corpus) {
  const q = (s) => JSON.stringify(s);
  const rows = [`    locale: ${q(corpus.locale)}, spine: ${corpus.spine ? q(corpus.spine) : 'null'},`];
  for (const k of TEXT_KINDS) {
    const list = corpus[k];
    if (!list.length) { rows.push(`    ${k}: [],`); continue; }
    rows.push(`    ${k}: [`);
    for (const e of list) {
      const parts = [`t:${q(e.t)}`];
      if (e.s) parts.push(`s:${q(e.s)}`);
      if (e.en) parts.push(`en:${q(e.en)}`);
      if (e.chain) parts.push('chain:1');
      rows.push(`      {${parts.join(',')}},`);
    }
    rows.push('    ],');
  }
  return rows.join('\n');
}

const HEAD = `// ============ 預設場地在地文字語料(離線烘焙,勿手改)============
// 由 tools/bake_venue_text.mjs 產生:Overpass 真實圖資 → 八類在地文字。
// 每則語料 = { t 主名(在地文字,未翻譯), s 日常副行, en 拉丁副名, chain 連鎖旗標 }。
// 分類/取名/副行/裁切規則全部住 public/js/vernacular.js —— 本檔只是它的輸出。
// 執行期會把當場抓到的建物/道路 tag 併進來(mergeCorpus),本檔是底本不是全部。
export const VENUE_TEXT = {`;

async function main() {
  const list = VENUES.filter((v) => v.ll && (!ONLY.length || ONLY.includes(v.id)));
  const prev = existsSync(OUT) ? (await import(`file://${OUT.replace(/\\/g, '/')}`)).VENUE_TEXT : {};
  const out = { ...prev };
  for (const v of list) {
    const [lat, lng] = v.ll;
    log(`[${v.id}] ${v.name}  ${lat},${lng}`);
    const els = await overpass(`${v.id}_r${RAD}_q${QV}`, lat, lng);
    if (!els) { log('  圖資取得失敗,保留舊語料'); continue; }
    // 語系:先問國旗(venues.js 的 country 欄),問不出來才看語料的書寫系統
    const locale = localeOf(v.country, els.slice(0, 200).map((e) => e.tags?.name).filter(Boolean));
    const corpus = trim(harvestOsm({ pois: els }, locale));
    corpus.spine = spineOf(corpus) || corpus.spine;
    const st = corpusStats(corpus);
    log(`  locale=${st.locale} spine=${st.spine} total=${st.total} spineHits=${st.spineHits}`,
      TEXT_KINDS.map((k) => `${k}:${st.per[k]}`).join(' '));
    out[v.id] = corpus;
    await sleep(1500);   // 鏡像禮貌
  }
  const body = Object.keys(out).sort().map((id) => `  ${id}: {\n${ser(out[id])}\n  },`).join('\n');
  writeFileSync(OUT, `${HEAD}\n${body}\n};\n`, 'utf8');
  log(`\n寫入 ${OUT}(${Object.keys(out).length} 個場地)`);
}

main();
