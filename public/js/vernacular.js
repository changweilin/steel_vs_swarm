// ============ 在地日常文字語料(招牌/路標/佈告欄/看板/解說牌的「寫什麼」)============
//
// **本檔零 import**(與 `rng.js` 同一條紀律):文字語料要同時被瀏覽器渲染層、離線烘焙
// (`tools/bake_venue_text.mjs`)與稽核(`tools/audit_vernacular.mjs`)吃到 —— 一旦 import
// 了 three 或 DOM,離線那兩支就只能各抄一份分類/挑字規則,那就不是同一份語料了。
//
// 分工只有兩層,MUST NOT 混:
//   本檔        = 寫什麼(分類 / 取名 / 日常副行 / 去重 / 容量篩)。純字串,不碰畫布。
//   signage.js  = 畫什麼、擺哪裡(canvas 圖集 + InstancedMesh + 逐實例 UV)。
//
// 方法來源:sakura-crossing(見 `.claude/skills/local-vernacular-signage/SKILL.md`)。
// 六條方法在本檔的落點:
//   ① 地名主幹      → `spineOf()`(圖資裡最高頻的地名詞素,不發明)
//   ② 三層文字      → 每則語料 = { t 主名, s 日常副行, en 拉丁副名 }
//   ③ 語域隨類別走  → `SIGN_CLASSES[].kinds` 決定一塊牌子讀起來是店家還是機關
//   ④ 一鎮一家      → `signCopy(..., used)` 的去重帳(連鎖走 `chain` 旗標)
//   ⑤ 表與版面分離  → 本檔只出資料,版面在 signage.js 一份
//   ⑥ 寫得下才算數  → `textW()` + `SIGN_CLASSES[].cap`,**取字階段**就按容量篩

/** 八類在地文字(= 一個人走在街上會讀到的字的絕大多數) */
export const TEXT_KINDS = ['place', 'road', 'shop', 'worship', 'transit', 'gov', 'water', 'terrain'];

/**
 * OSM tag → 類別。**唯一分類縫**:烘焙、執行期補收、稽核三個消費端同吃。
 * 順序有意義(由專到泛):`amenity=place_of_worship` 的建物同時有 `building=church`,
 * 先判宗教才不會被泛用的 building 規則吃掉。
 */
export function classifyOsm(tags) {
  if (!tags) return null;
  const t = tags;
  if (t.amenity === 'place_of_worship' || t.building === 'church' || t.building === 'temple'
      || t.building === 'mosque' || t.building === 'shrine' || t.building === 'cathedral'
      || t.building === 'chapel' || t.building === 'synagogue' || t.historic === 'wayside_shrine') return 'worship';
  if (GOV_AMENITY.has(t.amenity) || t.office === 'government' || t.amenity === 'school'
      || t.amenity === 'university' || t.amenity === 'hospital' || t.building === 'civic'
      || t.building === 'public' || t.building === 'school' || t.building === 'hospital') return 'gov';
  if (t.public_transport || t.railway === 'station' || t.railway === 'halt' || t.railway === 'tram_stop'
      || t.highway === 'bus_stop' || t.aeroway === 'terminal' || t.amenity === 'ferry_terminal') return 'transit';
  if (t.waterway || t.natural === 'water' || t.natural === 'spring' || t.water
      || t.landuse === 'reservoir' || t.man_made === 'water_tower' || t.man_made === 'pier') return 'water';
  if (t.natural === 'peak' || t.natural === 'ridge' || t.natural === 'cliff' || t.natural === 'valley'
      || t.natural === 'saddle' || t.natural === 'beach' || t.natural === 'cape'
      || t.tourism === 'viewpoint' || t.natural === 'volcano') return 'terrain';
  if (t.shop || t.craft || t.office || SHOP_AMENITY.has(t.amenity)
      || t.tourism === 'hotel' || t.tourism === 'guest_house' || t.building === 'retail'
      || t.building === 'commercial') return 'shop';
  if (t.highway && t.highway !== 'bus_stop') return 'road';
  if (t.place || t.boundary === 'administrative' || t.landuse === 'residential') return 'place';
  return null;
}
const GOV_AMENITY = new Set(['townhall', 'police', 'fire_station', 'post_office', 'courthouse',
  'library', 'community_centre', 'public_building', 'prison', 'embassy']);
const SHOP_AMENITY = new Set(['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'pharmacy',
  'bank', 'marketplace', 'fuel', 'car_repair', 'bakery', 'ice_cream', 'clinic', 'dentist',
  'veterinary', 'cinema', 'theatre', 'nightclub']);

/**
 * 主名取字優先序。**一律保留在地文字,MUST NOT 翻譯** ——
 * `name:en` 只當拉丁副名(§二),巴黎的牌子上寫英文就不是巴黎了。
 */
const NAME_KEYS = ['name', 'official_name', 'alt_name', 'short_name', 'brand', 'operator', 'ref'];
/** 拉丁副名(次要層次,只做視覺節奏) */
const ROMAN_KEYS = ['name:en', 'int_name', 'name:latin', 'brand:en'];

/** 字串正規化:壓空白、丟過長/純數字/純標點的垃圾;取不到回 null(寧缺勿錯) */
function clean(v, maxLen = 40) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s || s.length > maxLen) return null;
  if (!/[\p{L}\p{N}]/u.test(s)) return null;
  if (/^[\d\p{P}\s]+$/u.test(s)) return null;
  return s;
}

/**
 * 顯示寬度(全形字數)。CJK/諺文/假名算 1,其餘算 0.55 —— 這是「寫得下才算數」
 * (SKILL §一.6)的量尺:真實圖資的名字長度完全不受控,**取字階段**就要按這把尺篩掉,
 * 不是等畫的時候縮到看不見(畫得下 ≠ 讀得到)。
 */
export function textW(s) {
  let w = 0;
  for (const ch of String(s || '')) w += /[　-鿿가-힯＀-｠]/.test(ch) ? 1 : 0.55;
  return w;
}

/* ---------------------------------- 語言 ---------------------------------- */

/**
 * 旗幟 emoji → ISO 3166 二碼。`venues.js` 的 `country` 欄本來就有這個字串 ⇒
 * **不必在 venues.js 另開一欄語言**(第二份表遲早與旗幟分家)。
 */
export function flagToIso(flag) {
  const cps = [...String(flag || '')].map((c) => c.codePointAt(0));
  if (cps.length < 2 || cps.some((c) => c < 0x1f1e6 || c > 0x1f1ff)) return null;
  return cps.slice(0, 2).map((c) => String.fromCharCode(c - 0x1f1e6 + 65)).join('');
}

const LANG_BY_ISO = {
  TW: 'zh-Hant', HK: 'zh-Hant', MO: 'zh-Hant',
  JP: 'ja', KR: 'ko',
  FR: 'fr', DE: 'de', AT: 'de', CH: 'de',
  ES: 'es', AR: 'es', MX: 'es', CL: 'es', PE: 'es',
  IT: 'it', PT: 'pt', BR: 'pt',
  EG: 'ar', SA: 'ar', AE: 'ar', MA: 'ar',
  US: 'en', GB: 'en', AU: 'en', NZ: 'en', IE: 'en', CA: 'en', ZA: 'en', BW: 'en', KE: 'en', IN: 'en',
};

/**
 * 語系判定:①場地國旗 ②語料字符的書寫系統。兩者都問不出來回 `'und'` ——
 * **`und` 一律不套詞表**(SKILL §二:在巴黎的牌子上寫「營業中」比留白更糟)。
 * 書寫系統只分得出「有假名 = 日文 / 有諺文 = 韓文 / 有阿拉伯字母」,分不出的漢字圈
 * 一律回 `zh-Hant`(本專案 UI 語言,偏差方向朝「看得懂」)。
 */
export function localeOf(country, samples = []) {
  const iso = flagToIso(country);
  if (iso && LANG_BY_ISO[iso]) return LANG_BY_ISO[iso];
  const joined = samples.join('');
  if (/[぀-ヿ]/.test(joined)) return 'ja';
  if (/[가-힯]/.test(joined)) return 'ko';
  if (/[؀-ۿ]/.test(joined)) return 'ar';
  if (/[一-鿿]/.test(joined)) return 'zh-Hant';
  return 'und';
}

/**
 * 日常副行詞表(SKILL §一.2 的第二層 —— 「這裡真的在發生什麼」)。
 * **只收確定寫法正確的語系**;其餘語系一律 `und`(不套詞表,只用圖資自帶的字串)。
 * 每類 3~4 條就夠:招牌的副行是節奏,不是說明書。
 */
export const LOCALE_LEX = {
  'zh-Hant': {
    shop: ['營業中', '今日特價', '現做現賣', '宅配到府'],
    place: ['社區公告', '里民活動中心', '守望相助', '資源回收日'],
    road: ['慢行', '注意行人', '前有彎道', '施工中'],
    worship: ['香油添福', '安太歲', '光明燈', '早晚課'],
    transit: ['候車處', '末班車', '轉乘出口', '悠遊卡'],
    gov: ['洽公時間', '便民服務', '公告事項', '為民服務'],
    water: ['水深危險', '禁止戲水', '水位觀測', '排水幹線'],
    terrain: ['觀景平台', '步道入口', '注意落石', '海拔'],
  },
  ja: {
    shop: ['営業中', '本日特価', 'やきたて', 'おべんとう'],
    place: ['町内会', '回覧板', 'ごみ収集日', 'そうじ当番'],
    road: ['徐行', '歩行者注意', '工事中', 'この先せまい'],
    worship: ['参拝の作法', 'ご祈祷', 'おみくじ', '御朱印'],
    transit: ['のりば', '終電', '乗換口', '時刻表'],
    gov: ['受付時間', 'お知らせ', '届出', '窓口'],
    water: ['ふかい水路です', '遊泳禁止', '量水標', '用水路'],
    terrain: ['展望台', '登山口', '落石注意', '標高'],
  },
  en: {
    shop: ['OPEN DAILY', 'FRESH TODAY', 'TAKEAWAY', 'EST. 1962'],
    place: ['COMMUNITY NOTICE', 'RESIDENTS ASSOCIATION', 'BIN COLLECTION', 'NEIGHBOURHOOD WATCH'],
    road: ['SLOW', 'PEDESTRIANS', 'ROAD WORKS', 'NO ENTRY'],
    worship: ['ALL WELCOME', 'SUNDAY SERVICE', 'QUIET PLEASE', 'PARISH NOTICE'],
    transit: ['DEPARTURES', 'LAST SERVICE', 'INTERCHANGE', 'TIMETABLE'],
    gov: ['OPENING HOURS', 'PUBLIC NOTICE', 'ENQUIRIES', 'COUNTER'],
    water: ['DEEP WATER', 'NO SWIMMING', 'GAUGE', 'DRAINAGE'],
    terrain: ['VIEWPOINT', 'TRAIL HEAD', 'FALLING ROCKS', 'ELEVATION'],
  },
  fr: {
    shop: ['OUVERT', 'FAIT MAISON', 'À EMPORTER', 'DEPUIS 1962'],
    place: ['AVIS AUX HABITANTS', 'CONSEIL DE QUARTIER', 'COLLECTE DES DÉCHETS'],
    road: ['RALENTIR', 'PIÉTONS', 'TRAVAUX', 'SENS UNIQUE'],
    worship: ['SILENCE', 'MESSE', 'ENTRÉE LIBRE'],
    transit: ['DÉPARTS', 'DERNIER SERVICE', 'CORRESPONDANCE', 'HORAIRES'],
    gov: ['HORAIRES', 'AVIS AU PUBLIC', 'ACCUEIL'],
    water: ['EAU PROFONDE', 'BAIGNADE INTERDITE', 'ÉCHELLE DE CRUE'],
    terrain: ['POINT DE VUE', 'DÉPART DU SENTIER', 'CHUTES DE PIERRES', 'ALTITUDE'],
  },
  de: {
    shop: ['GEÖFFNET', 'TÄGLICH FRISCH', 'ZUM MITNEHMEN', 'SEIT 1962'],
    place: ['BEKANNTMACHUNG', 'NACHBARSCHAFT', 'ABFUHRTERMINE'],
    road: ['LANGSAM', 'FUSSGÄNGER', 'BAUSTELLE', 'EINBAHNSTRASSE'],
    worship: ['GOTTESDIENST', 'BITTE LEISE', 'OFFEN'],
    transit: ['ABFAHRT', 'LETZTE FAHRT', 'UMSTEIGEN', 'FAHRPLAN'],
    gov: ['ÖFFNUNGSZEITEN', 'BEKANNTMACHUNG', 'BÜRGERBÜRO'],
    water: ['TIEFES WASSER', 'BADEN VERBOTEN', 'PEGEL'],
    terrain: ['AUSSICHTSPUNKT', 'WANDERWEG', 'STEINSCHLAG', 'HÖHE'],
  },
  es: {
    shop: ['ABIERTO', 'DEL DÍA', 'PARA LLEVAR', 'DESDE 1962'],
    place: ['AVISO VECINAL', 'ASOCIACIÓN DE VECINOS', 'RECOGIDA DE BASURA'],
    road: ['DESPACIO', 'PEATONES', 'OBRAS', 'SENTIDO ÚNICO'],
    worship: ['MISA', 'SILENCIO', 'ENTRADA LIBRE'],
    transit: ['SALIDAS', 'ÚLTIMO SERVICIO', 'TRANSBORDO', 'HORARIO'],
    gov: ['HORARIO', 'AVISO PÚBLICO', 'ATENCIÓN AL PÚBLICO'],
    water: ['AGUA PROFUNDA', 'PROHIBIDO BAÑARSE', 'ESCALA DE AFORO'],
    terrain: ['MIRADOR', 'INICIO DEL SENDERO', 'DESPRENDIMIENTOS', 'ALTITUD'],
  },
  it: {
    shop: ['APERTO', 'DEL GIORNO', 'DA ASPORTO', 'DAL 1962'],
    place: ['AVVISO AI RESIDENTI', 'COMITATO DI QUARTIERE', 'RACCOLTA RIFIUTI'],
    road: ['RALLENTARE', 'PEDONI', 'LAVORI IN CORSO', 'SENSO UNICO'],
    worship: ['MESSA', 'SILENZIO', 'INGRESSO LIBERO'],
    transit: ['PARTENZE', 'ULTIMA CORSA', 'COINCIDENZE', 'ORARIO'],
    gov: ['ORARIO', 'AVVISO PUBBLICO', 'SPORTELLO'],
    water: ['ACQUA ALTA', 'DIVIETO DI BALNEAZIONE', 'IDROMETRO'],
    terrain: ['BELVEDERE', 'INIZIO SENTIERO', 'CADUTA MASSI', 'QUOTA'],
  },
  pt: {
    shop: ['ABERTO', 'DO DIA', 'PARA VIAGEM', 'DESDE 1962'],
    place: ['AVISO AOS MORADORES', 'ASSOCIAÇÃO DE MORADORES', 'COLETA DE LIXO'],
    road: ['DEVAGAR', 'PEDESTRES', 'OBRAS', 'MÃO ÚNICA'],
    worship: ['MISSA', 'SILÊNCIO', 'ENTRADA LIVRE'],
    transit: ['PARTIDAS', 'ÚLTIMO ÔNIBUS', 'BALDEAÇÃO', 'HORÁRIO'],
    gov: ['HORÁRIO', 'AVISO PÚBLICO', 'ATENDIMENTO'],
    water: ['ÁGUA FUNDA', 'PROIBIDO NADAR', 'RÉGUA LIMNIMÉTRICA'],
    terrain: ['MIRANTE', 'INÍCIO DA TRILHA', 'QUEDA DE PEDRAS', 'ALTITUDE'],
  },
  ko: {
    shop: ['영업중', '오늘의 특가', '포장 가능', '직접 만듭니다'],
    place: ['주민 공고', '반상회', '쓰레기 배출일'],
    road: ['서행', '보행자 주의', '공사중', '일방통행'],
    worship: ['법회 안내', '조용히', '자유 참배'],
    transit: ['승차장', '막차', '환승', '시간표'],
    gov: ['민원 시간', '공고', '안내', '창구'],
    water: ['수심 깊음', '수영 금지', '수위표'],
    terrain: ['전망대', '등산로 입구', '낙석 주의', '해발'],
  },
  ar: {
    shop: ['مفتوح', 'طازج اليوم', 'سفري'],
    place: ['إعلان للسكان', 'لجنة الحي', 'مواعيد النظافة'],
    road: ['تمهل', 'مشاة', 'أعمال طريق'],
    worship: ['مواقيت الصلاة', 'الرجاء الهدوء', 'الدخول مجاني'],
    transit: ['المغادرة', 'آخر رحلة', 'تحويل'],
    gov: ['ساعات العمل', 'إعلان عام', 'الاستعلامات'],
    water: ['مياه عميقة', 'ممنوع السباحة', 'مقياس المنسوب'],
    terrain: ['نقطة مشاهدة', 'بداية المسار', 'سقوط صخور'],
  },
};

/**
 * 地名主幹的通用後綴(SKILL §一.1)。**只在該類語料整個空掉時**才拿主幹合成一個名字
 * —— 有真名就用真名,合成名是「零字場地」的保底(SKILL §四.7),不是常態。
 */
const SPINE_SUFFIX = {
  'zh-Hant': { place: '里', road: '路', water: '川', terrain: '山', shop: '商行', gov: '事務所', worship: '宮', transit: '站' },
  ja: { place: '町', road: '通り', water: '川', terrain: '山', shop: '商店', gov: '出張所', worship: '神社', transit: '駅' },
  en: { place: ' DISTRICT', road: ' ROAD', water: ' BROOK', terrain: ' HILL', shop: ' STORES', gov: ' OFFICE', worship: ' CHAPEL', transit: ' HALT' },
  fr: { place: '', road: 'RUE ', water: '', terrain: '', shop: '', gov: 'MAIRIE ', worship: '', transit: 'GARE ' },
  de: { place: '', road: 'STRASSE', water: 'BACH', terrain: 'BERG', shop: '', gov: 'AMT ', worship: '', transit: 'BAHNHOF ' },
  es: { place: '', road: 'CALLE ', water: '', terrain: '', shop: '', gov: '', worship: '', transit: 'ESTACIÓN ' },
  it: { place: '', road: 'VIA ', water: '', terrain: '', shop: '', gov: '', worship: '', transit: 'STAZIONE ' },
  pt: { place: '', road: 'RUA ', water: '', terrain: '', shop: '', gov: '', worship: '', transit: 'ESTAÇÃO ' },
  ko: { place: '동', road: '로', water: '천', terrain: '산', shop: '상회', gov: '사무소', worship: '사', transit: '역' },
  ar: { place: '', road: 'شارع ', water: '', terrain: '', shop: '', gov: '', worship: '', transit: 'محطة ' },
};

/* -------------------------------- 語料採集 -------------------------------- */

/** 空語料(八類各一個陣列 + 語系 + 主幹) */
export function emptyCorpus(locale = 'und') {
  const c = { locale, spine: null };
  for (const k of TEXT_KINDS) c[k] = [];
  return c;
}

/**
 * 一則語料 = 三層文字(SKILL §一.2)。
 *   t  主名(在地文字,不翻譯)
 *   s  日常副行 —— **只用圖資自帶的欄位**,取不到留 null,由 `signCopy` 再退回詞表
 *   en 拉丁副名(次要層次)
 */
function entryOf(tags, kind) {
  let t = null;
  for (const k of NAME_KEYS) { t = clean(tags[k]); if (t) break; }
  if (!t) return null;
  let en = null;
  for (const k of ROMAN_KEYS) { en = clean(tags[k], 28); if (en && en !== t) break; else en = null; }
  // 副行 MUST 與主名不同:`brand` 常常就等於 `name`(H&M / H&M),照抄上牌等於同一行寫兩次
  const sRaw = clean(SUB_KEYS[kind]?.map((k) => tags[k]).find(Boolean), 24) || eleOf(tags);
  const s = sRaw && sRaw !== t ? sRaw : null;
  const e = { t, kind };
  if (s) e.s = s;
  if (en) e.en = en;
  // 連鎖 = 一鎮一家的**具名例外**(SKILL §一.4),認定 MUST 只看 `brand` ——
  // `operator` 太鬆(公車站牌都有 operator=東急バス),用它當連鎖旗標等於整批繞過去重帳,
  // 症狀是同一條路上兩塊「渋谷区役所」(2026-08-03 shibuya 截圖實測)。
  if (tags.brand || tags['brand:wikidata']) e.chain = true;
  return e;
}
/**
 * 日常副行的圖資來源(逐類)。**只收自由文字欄位**,MUST NOT 收列舉值 ——
 * `religion=taoist` / `waterway=river` / `place=neighbourhood` / `cuisine=japanese` 的值是
 * OSM 的**英文識別字**不是人看的字,直接上牌就是「在台北的廟埕告示上寫 taoist」
 * (SKILL §二:在巴黎的牌子上寫外語比留白更糟)。列舉值要上牌只能經 `LOCALE_LEX` 翻成
 * 在地說法,而那條路已經是「取不到就退回詞表」在走了。
 */
const SUB_KEYS = {
  shop: ['opening_hours', 'operator', 'brand', 'addr:street'],
  gov: ['opening_hours', 'operator', 'addr:street'],
  worship: ['opening_hours', 'operator'],
  transit: ['network', 'operator', 'ref'],
  water: ['operator'],
  terrain: ['description'],
  road: ['ref', 'destination'],
  place: [],
};
/**
 * 標高(公尺)是**數字**,跨語系都讀得懂 —— 唯一可以直接從列舉/數值欄上牌的東西。
 * 冠詞走 `ELE_WORD`;沒有該語系的冠詞就只寫數字加單位。
 */
function eleOf(tags) {
  const n = Number(tags.ele);
  return Number.isFinite(n) && n > 0 && n < 9000 ? `${Math.round(n)} m` : null;
}
/** 標高冠詞(逐語系;`signCopy` 補在數字前) */
export const ELE_WORD = {
  'zh-Hant': '海拔', ja: '標高', ko: '해발', en: 'ELEV', fr: 'ALT', de: 'HÖHE',
  es: 'ALT', it: 'QUOTA', pt: 'ALT', ar: 'ارتفاع',
};

/**
 * 從 OSM 元素採集語料。輸入是**執行期已經抓到的東西**(`fetchOsmFeatures` 的 buildings
 * 帶 tags、`fetchOsmRoads` 的 roads 帶 tags)⇒ 執行期補收**零額外網路**;
 * 烘焙時另餵 `pois`(專門查詢的宗教/交通/政府/水文/地名節點)。
 *
 * 去重以「類別 + 主名」為鍵(同一條路被切成十幾條 way 是 OSM 常態)。
 */
export function harvestOsm({ buildings = [], roads = [], pois = [] } = {}, locale = null) {
  const seen = new Set();
  const rows = [];
  for (const el of [...buildings, ...roads, ...pois]) {
    const tags = el?.tags || el;
    const kind = classifyOsm(tags);
    if (!kind) continue;
    const e = entryOf(tags, kind);
    if (!e) continue;
    const key = kind + ' ' + e.t;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(e);
  }
  const loc = locale || localeOf(null, rows.slice(0, 60).map((e) => e.t));
  const c = emptyCorpus(loc);
  for (const e of rows) c[e.kind].push(e);
  c.spine = spineOf(c);
  return c;
}

/**
 * 地名主幹(SKILL §一.1):圖資裡最高頻的地名詞素。**不發明** —— 有真實圖資時,
 * 發明一個新主幹反而把在地感洗掉。
 * 作法:對 place/road/water/terrain 四類的主名切詞(CJK 取 2 字滑窗、拼音語系取整詞),
 * 取出現在**最多不同名字**裡的那一個。單一名字裡重複不加分(「大安大安路」不是主幹)。
 */
export function spineOf(corpus) {
  const tally = new Map();
  for (const kind of ['place', 'road', 'water', 'terrain']) {
    for (const e of corpus[kind] || []) {
      for (const tok of tokens(e.t)) {
        if (!tally.has(tok)) tally.set(tok, new Set());
        tally.get(tok).add(e.t);
      }
    }
  }
  let best = null, bestN = 1;   // 只出現在一個名字裡的詞不算主幹
  for (const [tok, names] of tally) {
    if (names.size > bestN || (names.size === bestN && best && tok.length > best.length)) { best = tok; bestN = names.size; }
  }
  return best;
}
/**
 * 切詞。三條紀律,少一條主幹就會抓到「原名裡根本沒有的字串」或抓到「路」:
 *   ① 滑窗 MUST 只在**連續**的漢字/假名/諺文段內滑 —— 先把非 CJK 字元整片刪掉再滑窗,
 *      會把「松智路 5 巷」接成「松智路巷」而滑出一個原名裡不存在的 `路巷`
 *      (2026-08-03 taipei101 首烤實測:spine=路巷、spineHits=0 —— **主幹對不上任何一個
 *      名字**卻不會報錯,只表現成合成名怪怪的)。
 *   ② 2 字與 3 字窗都要 —— 中文地名詞素多半 2 字(信義/大安),日文假名地名常 3 字
 *      (ひばり)。同票時 `spineOf` 取較長者 ⇒ ひばり 贏過 ひば/ばり。
 *   ③ 含**地物通名**的窗一律丟(路/街/巷/町/丁/山/川/駅…)。那是「這是哪一種東西」,
 *      不是「這是哪裡」;不丟的話任何城市的主幹都會是「路」。
 */
function tokens(name) {
  const out = [];
  for (const run of name.match(/[㐀-鿿぀-ヿ가-힯]+/g) || []) {
    for (const n of [2, 3]) {
      for (let i = 0; i + n <= run.length; i++) {
        const tok = run.slice(i, i + n);
        if (![...tok].some((ch) => GENERIC_CJK.has(ch))) out.push(tok);
      }
    }
  }
  if (!out.length) {
    for (const w of name.split(/[\s -⁯\p{P}]+/u)) {
      const t = w.trim();
      // 數字開頭一律不是主幹(曼哈頓的「53rd」只說明這是第幾街,不說明這是哪裡)
      if (t.length >= 3 && !/^\d/.test(t) && !GENERIC_WORD.has(t.toLowerCase())) out.push(t);
    }
  }
  return out;
}
/**
 * 地物通名(中日韓):是「哪一種東西」不是「哪裡」。
 * 刻意**不收** 大/中/小 —— 收了會連「大安」「中壢」一起丟掉。
 */
// 諺文的地物通名是**多字詞**(대로 = 大路、로/길 = 路),但過濾是逐字元的 ⇒ 收字元即可。
// 代價:含這些字的真地名(역삼)會一起被排除。用一個候選換掉「首爾的主幹是『大路』」
// (2026-08-03 首烤實測 spine=대로),划算。
const GENERIC_CJK = new Set([...'路街巷弄段道橋梁線號樓層區里鄰町丁目通筋川河湖池山岳峰站駅宮寺廟祠社園場院港灣島城村莊로길동구역시군읍면천산교']);
/** 拼音語系的通用詞(不是主幹,是路的種類) */
const GENERIC_WORD = new Set(['road', 'street', 'avenue', 'lane', 'drive', 'place', 'square', 'the',
  'rue', 'boulevard', 'calle', 'avenida', 'via', 'viale', 'strasse', 'straße', 'weg', 'platz',
  'rua', 'praça', 'north', 'south', 'east', 'west', 'saint', 'sainte', 'san', 'santa', 'del', 'della', 'de',
  'general', 'général', 'president', 'président', 'maréchal', 'doctor', 'docteur', 'notre', 'dame',
  'des', 'les', 'los', 'las', 'dos', 'das', 'and', 'von', 'der', 'die', 'das',
  // 首烤實測抓到的「地物通名」(manhattan=District / paris=Allée / madrid=Plaza):
  // 那些是「這是哪一種地方」,不是「這是哪裡」—— 與 GENERIC_CJK 同一條規則
  'district', 'quarter', 'allée', 'allee', 'plaza', 'plazuela', 'praça', 'piazza', 'campo',
  'park', 'gardens', 'garden', 'bridge', 'court', 'terrace', 'walk', 'way', 'market', 'station',
  'tunnel', 'heights', 'island', 'center', 'centre', 'building', 'tower', 'hall', 'house',
  'church', 'school', 'hospital', 'hotel', 'museum', 'library', 'brücke', 'strada', 'estrada',
  // 27 場地實烤第二輪抓到的(madrid=Plaza / venice=Piazzale / rio=Travessa / barcelona=Carrer
  // / london=Lower / manhattan=53rd):全是「這是哪一種街」,不是「這是哪裡」
  'piazzale', 'travessa', 'carrer', 'largo', 'passeig', 'camino', 'chemin', 'ronda', 'paseo',
  'vicolo', 'borgo', 'gasse', 'ulica', 'lower', 'upper', 'old', 'new', 'great', 'little',
  'grand', 'grande', 'city', 'town', 'village', 'national', 'international', 'central']);

/**
 * 合併語料(烘焙語料 ← 執行期補收)。烘焙那份**排前面**:它是專門查詢抓來的,
 * 覆蓋率與品質都比「執行期順手撿到的建物 tag」高。同名只留一則。
 */
export function mergeCorpus(baked, live) {
  const out = emptyCorpus(baked?.locale || live?.locale || 'und');
  for (const kind of TEXT_KINDS) {
    const seen = new Set();
    for (const e of [...(baked?.[kind] || []), ...(live?.[kind] || [])]) {
      if (!e?.t || seen.has(e.t)) continue;
      seen.add(e.t);
      out[kind].push(e);
    }
  }
  out.spine = baked?.spine || live?.spine || spineOf(out);
  return out;
}

/* -------------------------------- 挑字上牌 -------------------------------- */

/**
 * 五種招牌的語域(SKILL §一.3)。**一塊牌子讀起來是什麼機構,由這張表決定**,
 * 不是由字體或顏色決定 —— 把基礎設施寫成商業語域(或反過來)= 整個世界的公信力
 * 當場消失,而畫面上看不出哪裡錯。
 *
 *   kinds  這種牌子會掛哪幾類文字(依序試,前面的優先)
 *   cap    各欄位的容量上限(**全形字數**,量尺 = `textW`);超過就不選那則語料
 *   sub    副行取不到圖資欄位時,退回詞表的哪一類(通常 = 自己)
 */
export const SIGN_CLASSES = {
  // 建築招牌:亞洲街景的直式長條,主名一行直排 —— 容量最小的一塊牌
  wallsign: { kinds: ['shop', 'worship', 'gov'], cap: { t: 6, s: 6, en: 12 }, sub: 'shop' },
  // 屋頂廣告看板:遠看的東西,主名大、副行短
  billboard: { kinds: ['shop', 'transit', 'place'], cap: { t: 8, s: 12, en: 18 }, sub: 'shop' },
  // 道路路標:路名 + 方向/距離
  roadsign: { kinds: ['road', 'place', 'transit'], cap: { t: 11, s: 9, en: 20 }, sub: 'road' },
  // 佈告欄:里名抬頭 + 公告事由
  notice: { kinds: ['place', 'gov', 'worship'], cap: { t: 9, s: 12, en: 0 }, sub: 'place' },
  // 風景解說牌:地名 + 標高/來歷
  scenic: { kinds: ['terrain', 'water', 'place'], cap: { t: 9, s: 16, en: 20 }, sub: 'terrain' },
};

/** 決定性取樣(專案全域紀律:MUST NOT `Math.random()` —— 否則同房間兩人看到不同招牌) */
const pick = (rnd, arr) => arr[Math.min(arr.length - 1, Math.floor(rnd() * arr.length))];

/**
 * 挑一則文案上牌。
 *
 * @param cls   `SIGN_CLASSES` 的鍵
 * @param corpus 語料
 * @param rnd   場景那條 seeded 亂數(**每次呼叫固定消耗 3 枚**:類別、語料、副行 ——
 *              固定枚數是專案的確定性紀律,淘汰檢查一律排在抽樣之後)
 * @param used  去重帳(Set of 主名;跨整個世界共用一本)。連鎖(`chain`)不入帳。
 * @returns { t, s, en, kind, reg } —— `reg` = 語域(= cls),供版面決定欄位結構
 */
export function signCopy(cls, corpus, rnd, used) {
  const spec = SIGN_CLASSES[cls];
  if (!spec) return null;
  const lex = LOCALE_LEX[corpus?.locale] || null;

  // ① 抽類別:先過濾出「這一類還有沒有寫得下又沒用過的語料」,再抽 —— 固定 1 枚
  const live = spec.kinds.filter((k) => (corpus?.[k] || []).some((e) => usable(e, spec, used)));
  const kind = live.length ? pick(rnd, live) : spec.kinds[0];

  // ② 抽語料 —— 固定 1 枚(沒有可用語料時仍然要抽掉這一枚,序列才跨場地一致)
  const pool = (corpus?.[kind] || []).filter((e) => usable(e, spec, used));
  const roll = rnd();
  const e = pool.length ? pool[Math.min(pool.length - 1, Math.floor(roll * pool.length))] : null;

  // ③ 抽副行 —— 固定 1 枚
  const bank = lex?.[kind] || lex?.[spec.sub] || null;
  const fallbackSub = bank ? pick(rnd, bank) : (rnd(), null);

  if (e) {
    if (!e.chain) used?.add(e.t);
    // 標高冠詞在**取字時**補,不在版面補:版面補等於第二處知道「什麼是標高」
    const raw = /^\d+ m$/.test(e.s || '') && ELE_WORD[corpus?.locale]
      ? `${ELE_WORD[corpus.locale]} ${e.s}` : e.s;
    const s = (raw && textW(raw) <= spec.cap.s) ? raw : (fallbackSub && textW(fallbackSub) <= spec.cap.s ? fallbackSub : null);
    const en = (spec.cap.en && e.en && textW(e.en) <= spec.cap.en) ? e.en : null;
    return { t: e.t, s, en, kind, reg: cls };
  }

  // 零字場地(離線 / 沙漠 / 圖資全空):退回**不含專名**的通用牌面 —— 主幹合成名優先,
  // 沒有主幹就只剩詞表那一行。MUST NOT 退回亂碼或英文佔位符(SKILL §四.7)。
  // 合成名 MUST 同樣進去重帳:主幹 + 通用後綴很容易**撞上真名**(spine=大安 ⇒ 合成
  // 「大安里」,而圖資裡本來就有一個大安里)—— 撞上就等於「一鎮兩家」,而畫面上只表現成
  // 同一個名字掛在兩塊牌子上。
  const syn = synth(corpus, kind);
  if (syn && textW(syn) <= spec.cap.t && !used?.has(syn)) {
    used?.add(syn);
    return { t: syn, s: fallbackSub, en: null, kind, reg: cls };
  }
  // 詞表保底也 MUST 進帳:詞表每類只有 3~4 條,不記帳的話零字場地會整排掛同一句
  //(稽核 Ⅱ③ 實測:notice 連抽六次拿到兩塊「里民活動中心」)。抽不到就不出這塊牌 —— 寧缺勿錯。
  if (fallbackSub && textW(fallbackSub) <= spec.cap.t && !used?.has(fallbackSub)) {
    used?.add(fallbackSub);
    return { t: fallbackSub, s: null, en: null, kind, reg: cls };
  }
  return null;
}

function usable(e, spec, used) {
  if (!e?.t || textW(e.t) > spec.cap.t) return false;
  return e.chain ? true : !used?.has(e.t);
}

/** 主幹合成名(保底):`<主幹> + 該類後綴`;拼音語系的後綴是前綴,由表自己帶空白 */
function synth(corpus, kind) {
  const sp = corpus?.spine;
  const sfx = SPINE_SUFFIX[corpus?.locale]?.[kind];
  if (!sp || sfx == null) return null;
  return /^[㐀-鿿가-힯]/.test(sp) || !/[A-Za-z؀-ۿ]/.test(sfx.trim())
    ? sp + sfx : sfx + sp.toUpperCase();
}

/**
 * 語料健康度(稽核與烘焙報表用):每類幾則、主幹覆蓋了幾個名字。
 * 主幹覆蓋率個位數 = 這些東西還不屬於同一個地方(SKILL §四.5)。
 */
export function corpusStats(corpus) {
  const per = {};
  let total = 0;
  for (const k of TEXT_KINDS) { per[k] = (corpus?.[k] || []).length; total += per[k]; }
  let spineHits = 0;
  if (corpus?.spine) {
    for (const k of TEXT_KINDS) for (const e of corpus[k] || []) if (e.t.includes(corpus.spine)) spineHits++;
  }
  return { locale: corpus?.locale || 'und', spine: corpus?.spine || null, total, per, spineHits };
}
