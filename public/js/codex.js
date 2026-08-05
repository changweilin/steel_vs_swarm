// ============ 圖鑑格式(角色檔案 / 機體檔案的**唯一**格式定義)============
// 2026-08-04 使用者定案:「角色與機體的完整數據與文字說明的格式完全對齊,特別是機體原型的介紹,
// 也包括不顯示與遊戲、用於文本生成、2D 生圖或 3D 建模使用的部分,都統一標準格式。」
//
// 本檔是**格式**的單一真相,不是內容的:
//   內容 → 角色 `lore.js` / 機體 `mecha.js` / 數值 `data.js` / 運動性格 `models.js`
//   格式 → 本檔(有哪些段、哪些欄、叫什麼、必不必填、怎麼組成給外部管線的那份文字)
// 「格式對齊」在這裡是**結構性**的而不是靠約定:兩種檔案共用同一張段落表 `SECTIONS` 與同一張
// 生成欄位表 `GEN_FIELDS`,`codexIssues()` 逐欄檢查兩邊的鍵集**逐位元相同** —— 有人只在角色那邊
// 加一個欄位,稽核當場紅字。靠註解寫「請保持一致」是撐不住的(舊制的 proto 自由字串就是前車之鑑:
// 32 台機體長出了 4 種標籤、8 台只有一層、變形者的兩個型態被擠在同一句話裡,而且沒有任何東西會報錯)。
//
// ---- 三條紀律 ----
// ① **值一律到原處取,MUST NOT 在本檔或 mecha.js 複製**:全高走 `heroTargetH()`、機種走 `charKind()`、
//    陣營走 `SIDES`、外觀參數走 `CHARACTERS[].visual`。抄一份的症狀是「改了 data.js,圖鑑/生圖單沒跟著動」。
// ② **對外的三份生成文字(文本 / 2D / 3D)一律由本檔組裝**,MUST NOT 在 lore/mecha 手寫第二份 ——
//    手寫的那份不會跟著欄位變,而且沒有任何錯誤訊息(只是生出來的圖與設定慢慢對不上)。
// ③ 本檔只 import `data.js`/`lore.js`/`mecha.js` 三支**純資料**檔(無 three、無 DOM),
//    所以 `tools/audit_codex.mjs` 與離線的文本/生圖/建模管線都能直接 import 真品。

import { CHARACTERS, SIDES, SOLDIER_H, charKind, heroTargetH } from './data.js';
import { LORE } from './lore.js';
import { MECHA } from './mecha.js';

// ---- 段落表(兩種檔案共用)------------------------------------------------
// show:'card' 側欄簡介 / 'modal' 立繪跳出視窗 / 'never' 不進遊戲畫面(只供外部管線)
export const SECTIONS = [
  { key: 'ident', label: '識別', show: 'card' },
  { key: 'brief', label: '簡介', show: 'card' },
  { key: 'deep', label: '詳閱', show: 'modal' },
  { key: 'gen', label: '生成', show: 'never' },
];

// ---- 原型層(機體原型的介紹:統一標準格式)--------------------------------
// **哪一台該有哪幾層是推導的,不是各寫各的**:`from` = `visual` 的哪一個欄位決定這層存不存在。
//   real   恆有(工程出處)
//   frame  ← visual.proto     人形機甲的裝甲哲學(bastion/seraph/aegis/colossus)
//   bionic ← visual.creature  獸型機體取自哪種生物
//   air    ← visual.flight    變形者的飛行型態
//   ground ← visual.ground    變形者的地面型態
// 變形者因此**恆有兩層形態原型**(舊制把兩個型態擠進同一句「A ↔ B」,那是一層不是兩層);
// 每層 = `{ src, note }`:`src` 是可直接當生圖關鍵詞的名詞,`note` 是「為什麼是它」的設計理由。
export const PROTO_LAYERS = [
  { key: 'real', label: '設計原型', from: null },
  { key: 'frame', label: '機體原型', from: 'proto' },
  { key: 'bionic', label: '仿生原型', from: 'creature' },
  { key: 'air', label: '飛行型原型', from: 'flight' },
  { key: 'ground', label: '地面型原型', from: 'ground' },
];
export const PROTO_PARTS = ['src', 'note'];

// ---- 型態姿態(變形者的地面 / 飛行)----------------------------------------
// 2026-08-05 使用者定案:「如果是變形者的飛行型態,需另外下 prompt 說明是飛行姿態」。
//
// **這一條 MUST 只有一份**,兩個消費端同吃:覆核台那顆「重下 prompt」(`imagePrompt` 取 `zh`)
// 與離線出圖管線(`tools/ai3d/prompt.mjs masterPrompt` 取 `en`/`framing`)。中英同放一格是
// 刻意的 —— 它們是**同一件事的兩種寫法**,不是兩件事;拆成兩個檔各寫一份的症狀是「工具自己
// 畫出來的是飛行姿態,人照著覆核台複製的那份不是」,而兩邊都不會報錯。
//
// `pose`/`framing` 兩欄才是這次真正的修法:舊制只說「同一台機器把零件重排」,從頭到尾**沒有
// 一個字說機體在空中**,而取景那一行還寫著 standing(站姿)—— 兩者一起把模型拉回地面。
// 2026-08-04 覆核收回來的六張飛行稿(s03 / s10 / t06 / t11 / m05 / m08)因此一律被判
// 「需要是飛行姿態」:畫的是變形完成、但站在地上的機體。
export const FORM_POSE = {
  ground: {
    label: '地面型態',
    zh: '地面(步行)型態:四肢展開承重站在地面,翼面、旋翼與推進器收折貼身',
    en: 'Draw the GROUND (walking) form: limbs deployed and bearing weight, wings, rotors and thrusters folded against the body.',
    framing: 'standing three-quarter view',
  },
  flight: {
    label: '飛行型態',
    zh: '飛行型態:機體**正在空中飛行** —— 完全離地騰空、機首朝航向前方、翼面與推進器全部展開、'
      + '四肢與起落收進機身;是同一台機器變形而來,不是另一台機器',
    en: 'Draw the FLIGHT form of the SAME machine, AIRBORNE AND IN FLIGHT — not a transformed machine standing on the ground. '
      + 'The machine is completely off the ground with nothing touching any surface, flying nose-first along its direction of travel; '
      + 'wings, rotors and thrusters fully deployed and locked out, limbs and landing gear folded into the airframe. '
      + 'It MUST read as the same machine transformed, not a different model.',
    framing: 'airborne three-quarter view seen slightly from below, the machine banked into flight, nose forward, nothing touching the ground',
  },
};

// ---- 動作姿態(每一台機體要畫的三張)----------------------------------------
// 2026-08-05:圖的第二個維度。`FORM_POSE` 講的是「機體在哪」(地面 / 空中),
// 這一張講的是「它在做什麼」(待機 / 移動 / 開重砲)—— 兩者**正交**,合起來才是一張圖的取景。
//
// 為什麼要收成表:三種姿態的名字本來只住覆核台的 `POSES`(一張只有 key/label 的清單),
// 而**姿態的語意一個字都沒有** —— 出圖端因此只畫得出 `_static`,120 格裡的 moving/heavy
// 有 38 格根本沒有工具生得出來(2026-08-05 實測)。名字與語意分兩處就是這個結果:
// 覆核台數得出「缺 38 張」,卻沒有任何東西知道那 38 張長什麼樣。
//
// `framing` 是**覆寫**不是取代:只有需要改站姿的姿態才寫,static 不寫 ⇒ 逐字沿用 `FORM_POSE`
// 那一份 ⇒ 既有的靜止稿提示詞**逐位元不變**。逐 medium 分開寫是因為「奔跑」與「高速掠過」
// 在地面與空中是兩件事,共用一句話會讓飛行體被畫成在地上跑。
export const SHOT_POSES = [
  {
    key: 'static', label: '靜止',
    zh: '待機:機體靜止不動,武器收在待命位置,重心居中',
    en: 'Action: at rest and motionless, weapons stowed at the ready, weight centred and settled.',
  },
  {
    key: 'moving', label: '移動',
    zh: '移動:機體正在全速前進,重心前傾、四肢/推進器擺到動作中段,看得出速度',
    en: 'Action: MOVING AT FULL SPEED — caught mid-motion, not posed. Weight thrown forward, limbs and thrusters '
      + 'frozen mid-cycle (one side driving, the other recovering), trailing parts swept back by the airflow.',
    framing: {
      ground: 'three-quarter view from slightly ahead, caught mid-stride at a full run, one foot off the ground',
      air: 'airborne three-quarter view seen slightly from below, in a hard fast pass, nose forward, nothing touching the ground',
    },
  },
  {
    key: 'heavy', label: '重武器',
    zh: '重武器:機體正在使用**重武器**射擊 —— 據槍/展開砲位、後座撐住,槍口朝畫面前方偏側',
    en: 'Action: FIRING THE HEAVY WEAPON — the heavy weapon is deployed and being fired right now, braced against '
      + 'recoil (legs planted or airframe pitched back), muzzle end clearly visible and pointed forward off-camera. '
      + 'Show the heavy weapon, not the light one.',
    framing: {
      ground: 'three-quarter view, braced in a firing stance, weight settled back against the recoil',
      air: 'airborne three-quarter view seen slightly from below, pitched back on the gun, nothing touching the ground',
    },
  },
];
export const SHOT_POSE_KEYS = SHOT_POSES.map((p) => p.key);

/** 這一張圖的取景 = 型態(在哪)× 動作(在做什麼)。姿態沒有覆寫就沿用型態那一份。 */
export function shotFraming(ch, form, pose) {
  const fp = formPose(ch, form);
  const medium = fp && form === 'flight' ? 'air' : 'ground';
  const p = SHOT_POSES.find((x) => x.key === pose);
  return p?.framing?.[medium] || (fp || FORM_POSE.ground).framing;
}

/** 這台機體**該有**哪幾層原型(由 visual 推導;mecha.js 少一層或多一層都是稽核紅字)*/
export function protoLayers(ch) {
  const vis = CHARACTERS[ch]?.visual || {};
  return PROTO_LAYERS.filter((L) => L.from === null || vis[L.from] != null).map((L) => L.key);
}

/** 顯示用:逐層取出 `{ key, label, src, note }`,順序 = PROTO_LAYERS 的宣告序 */
export function protoOf(ch) {
  const p = MECHA[ch]?.proto || {};
  return protoLayers(ch).map((k) => {
    const L = PROTO_LAYERS.find((x) => x.key === k);
    return { key: k, label: L.label, src: p[k]?.src || '', note: p[k]?.note || '' };
  }).filter((x) => x.src || x.note);
}

// ---- 生成段(不顯示於遊戲;角色與機體**同鍵同義**)------------------------
// 這六個鍵就是「格式完全對齊」那句話的落點:同一支外部工具讀角色與讀機體是同一段程式。
// 語意逐欄對照(左 = 機體 / 右 = 角色):
//   sil   剪影      輪廓一眼認得出什麼           / 體態與站姿的剪影
//   mass  量體比例  各部佔比與重心               / 身高體格與比例
//   mat   材質表面  表面處理、磨損、透光         / 膚髮與衣料質感
//   parts 分件      3D 可分離量體(由主到次)    / 服裝配件分件
//   tag   生圖關鍵詞 純名詞短語(給 2D 模型吃)   / 同左
//   note  生成注意  這一件最容易被畫錯/建錯的事  / 同左
// **MUST NOT 在任一邊單獨加欄**(加了就不是同一個格式);要加就兩邊一起加,並補上稽核。
export const GEN_FIELDS = [
  { key: 'sil', label: '剪影', type: 'text' },
  { key: 'mass', label: '量體比例', type: 'text' },
  { key: 'mat', label: '材質表面', type: 'text' },
  { key: 'parts', label: '分件', type: 'list' },
  { key: 'tag', label: '生圖關鍵詞', type: 'list' },
  { key: 'note', label: '生成注意', type: 'text' },
];
export const GEN_KEYS = GEN_FIELDS.map((f) => f.key);
/** 生圖關鍵詞是**名詞短語**不是句子:超過這個長度或含句號 = 寫成敘述了(稽核擋) */
export const TAG_MAX = 14;

// ---- 欄位表(兩種檔案各一份;段落與生成段共用上面兩張表)------------------
// src:'derive' 由既有縫推導(本檔不存值)/ 'lore' 住 lore.js / 'mecha' 住 mecha.js / 'char' 住 data.js
const F = (sec, key, label, type, src, req = true) => ({ sec, key, label, type, src, req });
const GEN_SPEC = (src) => GEN_FIELDS.map((f) => F('gen', f.key, f.label, f.type, src));

export const CODEX_FIELDS = {
  char: [
    F('ident', 'id', '代號', 'text', 'derive'),
    F('ident', 'name', '姓名', 'text', 'char'),
    F('ident', 'code', '呼號', 'text', 'char'),
    F('ident', 'side', '陣營', 'text', 'derive'),
    F('ident', 'kind', '機種', 'text', 'derive'),
    F('ident', 'mecha', '駕駛機體', 'text', 'derive'),
    F('brief', 'nat', '國籍', 'text', 'lore'),
    F('brief', 'age', '年齡', 'num', 'lore'),
    F('brief', 'sex', '性別', 'text', 'lore'),
    F('brief', 'role', '職務', 'text', 'lore'),
    F('brief', 'look', '外貌', 'text', 'lore'),
    F('brief', 'quote', '台詞', 'text', 'lore'),
    F('deep', 'bio', '生平', 'text', 'lore'),
    F('deep', 'hobby', '興趣', 'text', 'lore'),
    F('deep', 'expertise', '專長', 'text', 'lore'),
    F('deep', 'bond', '與機體的機緣', 'text', 'lore'),
    F('gen', 'art', '程序立繪參數', 'obj', 'lore'),
    ...GEN_SPEC('lore'),
  ],
  mecha: [
    F('ident', 'id', '代號', 'text', 'derive'),
    F('ident', 'code', '型號', 'text', 'mecha'),
    F('ident', 'name', '機體名', 'text', 'char'),
    F('ident', 'side', '陣營', 'text', 'derive'),
    F('ident', 'kind', '機種', 'text', 'derive'),
    F('ident', 'pilot', '駕駛員', 'text', 'derive'),
    F('brief', 'proto', '原型', 'layers', 'mecha'),
    F('deep', 'bond', '與駕駛員的機緣', 'text', 'lore'),
    F('gen', 'visual', '外觀參數', 'obj', 'char'),
    ...GEN_SPEC('mecha'),
  ],
};
export const CODEX_KINDS = Object.keys(CODEX_FIELDS);

// ---- 外觀詞彙(把 `visual` 的列舉值翻成生圖/建模看得懂的名詞)--------------
// 這是**顯示詞彙表**不是第二份資料:值仍只住 `data.js CHARACTERS[].visual`。
// 稽核逐值比對「現役 32 台用到的每一個列舉值都查得到」⇒ 新增機型 vocabulary 不會靜默留空。
export const VIS_WORDS = {
  frame: { quad: '四旋翼', hexa: '六旋翼', coax: '共軸雙旋翼', wing: '定翼' },
  body: { box: '方艙機身', slab: '厚板機身', wedge: '楔形機身', sphere: '球形艙', frame: '桁架機身' },
  form: { avian: '擬態翼', fixed: '定翼', biped: '雙足獸型', beast: '四足獸型' },
  wing: { zero: '零式低翼', vtail: 'V 尾', canard: '鴨翼', delta: '三角翼', twinboom: '雙尾桁' },
  creature: {
    bee: '蜜蜂', centaur: '半人馬', cthulhu: '頭足類', roo: '袋鼠', gorilla: '大猩猩', hound: '獵犬',
    ostrich: '鴕鳥', ptero: '翼龍', dragon: '機械龍', trex: '暴龍', eagle: '鷹', stego: '劍龍',
  },
  flight: {
    archo: '始祖鳥', levi: '飛鯨', uav: '固定翼', tilt: '傾轉旋翼', heli: '旋翼',
    jet: '噴射戰機', beetle: '鞘翅', owl: '夜梟',
  },
  ground: {
    raptor: '迅猛龍', elephant: '巨象', monkey: '猿猴', atlas: '負重人形', vampire: '吸血鬼',
    wolf: '狼人', beetle: '甲蟲', panther: '豹',
  },
  pod: { none: '無掛件', antenna: '天線', rack: '彈架', dish: '雷達碟', shield: '護盾', blade: '刀刃' },
  proto: { bastion: '壁壘', seraph: '熾天使', aegis: '神盾', colossus: '巨兵' },
  paint: {
    minimal: '制式極簡', camo: '迷彩', tattoo: '線描刺青', totem: '民族圖騰', flag: '旗幟徽記',
    natflag: '國旗徽記', hinomaru: '日之丸', sakura: '櫻紋', split: '雙色分割', solid: '單色',
  },
};
/** `visual` 裡不進詞彙表的欄位(純數值/幾何參數,沒有對應的名詞)*/
const VIS_NUMERIC = new Set(['hue', 'flag', 'bulk', 'split', 'splitAt', 'splitFlip']);

export const KIND_WORD = { drone: '無人機', robot: '機甲', morph: '變形機甲' };
/** 立繪髮型(`lore.js art.style` 的列舉值;稽核比對現役 32 名用到的每一個值都查得到)*/
export const HAIR_WORD = {
  long: '長髮', short: '短髮', bun: '束髮', curl: '捲髮',
  crop: '平頭', hood: '兜帽頭巾', bald: '稀疏後梳',
};

/** 立繪外觀參數翻成生圖看得懂的名詞(色值保持 `#rrggbb`,生圖模型吃得下)*/
export function artWords(ch) {
  const a = LORE[ch]?.art || {};
  return [HAIR_WORD[a.style] || a.style, a.hair && `髮色 ${a.hair}`, a.skin && `膚色 ${a.skin}`,
    a.eye && `眼色 ${a.eye}`].filter(Boolean);
}

/** 主色十六進位字串(生圖/建模管線要的是 `#rrggbb`,不是 JS 數字)*/
export function hueHex(ch) {
  const h = CHARACTERS[ch]?.visual?.hue;
  return h == null ? '' : `#${h.toString(16).padStart(6, '0')}`;
}

/**
 * 這一欄外觀描述子對這台機體**適不適用**。
 *
 * `visual` 是一張共用的欄位表,一台機體只用得到其中一部分 —— 用不到的那幾欄是換機種/改設計
 * 時留下來的**殘值**,而 `visualWords` 會照樣把它們翻成名詞送進生圖模型,變成憑空多出來的
 * 設計要求。實測(`models.js` 逐處消費點):`frame`(旋翼骨架)與 `body`(機身殼)**只有
 * `buildDrone`(多旋翼)讀**,`wing` **只有 `buildFixedWing` 讀**;擬態翼無人機
 * (`form:'avian'`,走 `buildAvianDrone`)三欄一個都不讀,它的 rig 連 `spin` 節點都沒有。
 *
 * 2026-08-04 覆核於是收到三則同樣的意見 —— t07 翼龍被寫成「共軸雙旋翼、球形艙」、
 * t08 東亞龍被寫成「六旋翼、厚板機身」、m04 獵鷹被寫成「共軸雙旋翼、方艙機身」,
 * 使用者把這幾個詞逐一手動刪掉才重下 prompt(三台的重下 prompt 差異**只有**這一項)。
 * 手刪治不了本:規則 MUST 推導,MUST NOT 靠人每次記得刪。
 */
const VIS_USED_BY_FORM = {
  avian: { frame: false, body: false, wing: false },   // 生物骨架:三欄都不讀
  fixed: { frame: false, body: false },                // 定翼:只讀 wing
};
export function visualUses(vis, key) {
  return (VIS_USED_BY_FORM[vis?.form] || {})[key] !== false;
}

/** 把 `visual` 翻成名詞短語清單(生圖用;查無詞彙的列舉值原樣帶出,稽核會抓)*/
export function visualWords(ch) {
  const vis = CHARACTERS[ch]?.visual || {};
  const out = [];
  for (const [k, v] of Object.entries(vis)) {
    if (VIS_NUMERIC.has(k) || !visualUses(vis, k)) continue;
    out.push(VIS_WORDS[k]?.[v] || `${k}:${v}`);
  }
  return out;
}

// ---- 組裝:完整檔案 --------------------------------------------------------
/** 角色完整檔案(識別/簡介/詳閱/生成四段;值一律到原處取)*/
export function charCodex(ch) {
  const c = CHARACTERS[ch];
  if (!c) return null;
  const lo = LORE[ch] || {};
  return {
    kind: 'char',
    ident: {
      id: ch, name: c.name, code: c.code,
      side: SIDES[c.side]?.name || c.side,
      kind: KIND_WORD[charKind(ch)] || charKind(ch),
      mecha: c.machine,
    },
    brief: { nat: lo.nat, age: lo.age, sex: lo.sex, role: lo.role, look: lo.look, quote: lo.quote },
    deep: { bio: lo.bio, hobby: lo.hobby, expertise: lo.expertise, bond: lo.bond },
    gen: { art: lo.art, ...pickGen(lo.gen) },
    // 推導的尺度基準:真人身高是全遊戲唯一身高單位(CLAUDE.md §2.5),MUST NOT 在 lore.js 手寫
    scaleM: SOLDIER_H,
  };
}

/** 機體完整檔案(同一組段落;`proto` 是結構化的原型層,不是自由字串)*/
export function mechaCodex(ch) {
  const c = CHARACTERS[ch];
  const m = MECHA[ch];
  if (!c || !m) return null;
  const kind = charKind(ch);
  return {
    kind: 'mecha',
    ident: {
      id: ch, code: m.code, name: c.machine,
      side: SIDES[c.side]?.name || c.side,
      kind: KIND_WORD[kind] || kind,
      pilot: c.name,
    },
    brief: { proto: protoOf(ch) },
    deep: { bond: LORE[ch]?.bond },
    gen: { visual: c.visual, ...pickGen(m.gen) },
    // 推導的尺度基準:機體全高只有 heroTargetH 一份(隨角色護甲內插),MUST NOT 在 mecha.js 手寫公尺數
    scaleM: heroTargetH(kind, ch),
  };
}

function pickGen(g) {
  const out = {};
  for (const k of GEN_KEYS) out[k] = g?.[k];
  return out;
}

export function codexOf(kind, ch) { return kind === 'mecha' ? mechaCodex(ch) : charCodex(ch); }

// ---- 組裝:外部管線的三份生成文字 ------------------------------------------
// 三份都是**推導**的:欄位一改三份自己跟著改,MUST NOT 在 lore/mecha 手寫任何一份。

/** ㈠ 文本生成:整份檔案攤成分段純文字(給 LLM 當設定輸入)*/
export function textSeed(kind, ch) {
  const d = codexOf(kind, ch);
  if (!d) return '';
  const spec = CODEX_FIELDS[kind];
  const lines = [];
  for (const sec of SECTIONS) {
    const fields = spec.filter((f) => f.sec === sec.key);
    const rows = [];
    for (const f of fields) {
      const v = d[sec.key]?.[f.key];
      const s = fmtField(f, v);
      if (s) rows.push(`- ${f.label}:${s}`);
    }
    if (sec.key === 'gen') rows.push(`- 尺度基準:${d.scaleM.toFixed(2)} m`);
    if (rows.length) lines.push(`【${sec.label}】`, ...rows);
  }
  return lines.join('\n');
}

function fmtField(f, v) {
  if (v == null || v === '') return '';
  if (f.type === 'list') return v.join('、');
  // 分隔用 ` ▸ `:原型名稱本身就含「」與 ——(`「壁壘」過裝甲型`),拿那兩種符號當分隔會讀不出邊界
  if (f.type === 'layers') return v.map((L) => `\n  · ${L.label} ▸ ${L.src}\n    ${L.note}`).join('');
  if (f.type === 'obj') return Object.entries(v).map(([k, x]) =>
    `${k}=${typeof x === 'number' && k === 'hue' ? `#${x.toString(16).padStart(6, '0')}` : x}`).join(' ');
  return String(v);
}

/** 型態 → 它自己的原型層 / 要**濾掉**的另一層。畫飛行型就別把地面型的原型當關鍵詞送進去
 *  (變形者恆有兩層,兩層一起送 = 同一張圖同時被要求長成兩種東西)。 */
const FORM_LAYER = { flight: { own: 'air', drop: 'ground' }, ground: { own: 'ground', drop: 'air' } };

/**
 * 這一台機體的這一個型態該用哪組姿態語 —— **兩個消費端的唯一入口**
 * (`imagePrompt` 與 `tools/ai3d/prompt.mjs masterPrompt`),回傳 `null` = 不分型態。
 *
 * 「有沒有這個型態」MUST **推導**(該型態的原型層存不存在),MUST NOT 比對機種字串:
 * 非變形者就算被傳進 'flight' 也拿不到飛行姿態語 —— 它根本沒有飛行型態,掛上去就是憑空
 * 多一個型態,而畫面上只表現成「這台機甲怎麼在飛」。`drop` = 畫這一型時要濾掉的另一層原型。
 */
export function formPose(ch, form) {
  const L = FORM_LAYER[form];
  if (!L || !protoLayers(ch).includes(L.own)) return null;
  return { ...FORM_POSE[form], drop: L.drop };
}

/** ㈡ 2D 生圖:名詞短語串(關鍵詞優先,句子只留剪影與材質兩句)
 *  `form` = 'ground' | 'flight'(變形者專用)、`shot` = 'static' | 'moving' | 'heavy'。
 *  兩者省略 = 不分型態/不分動作,逐位元同舊行為。 */
export function imagePrompt(kind, ch, form = null, shot = null) {
  const d = codexOf(kind, ch);
  if (!d) return '';
  const pose = kind === 'mecha' ? formPose(ch, form) : null;
  const act = kind === 'mecha' ? SHOT_POSES.find((p) => p.key === shot) : null;
  const bits = [];
  if (kind === 'mecha') {
    bits.push(d.ident.name, d.ident.kind,
      ...d.brief.proto.filter((L) => L.key !== pose?.drop).map((L) => L.src), ...visualWords(ch), hueHex(ch));
  } else {
    bits.push(`${d.ident.name}「${d.ident.code}」`, d.brief.nat, d.brief.sex, `${d.brief.age} 歲`, ...artWords(ch));
  }
  bits.push(...(d.gen.tag || []));
  // **去重**:仿生原型的 src 與 `visual.creature` 的詞彙、`tag` 的關鍵詞本來就會撞
  // (同一件事在三個縫各講一次是對的 —— 但送進生圖模型時重複的詞會變成權重灌水)。
  const seen = new Set();
  const uniq = bits.filter((b) => b && !seen.has(b) && seen.add(b));
  // 剪影/材質是「畫成什麼樣」的兩句,放在關鍵詞之後(前面的名詞才是主導);
  // 型態與動作排最後 —— 它們講的是「這一張要畫哪一型、在做什麼」,是對前面那台機器的取景指令
  return [uniq.join('、'), d.gen.sil, d.gen.mat, pose?.zh, act?.zh].filter(Boolean).join('\n');
}

/** ㈢ 3D 建模:分件單 + 尺度 + 比例 + 注意事項 */
export function modelSheet(kind, ch) {
  const d = codexOf(kind, ch);
  if (!d) return '';
  const head = kind === 'mecha'
    ? `${d.ident.code} ${d.ident.name}(${d.ident.kind}・駕駛 ${d.ident.pilot})`
    : `${d.ident.name}「${d.ident.code}」(${d.ident.side}・${d.ident.kind})`;
  const rows = [
    `全高基準:${d.scaleM.toFixed(2)} m`,
    `量體比例:${d.gen.mass}`,
    `材質表面:${d.gen.mat}`,
    `分件:${(d.gen.parts || []).map((p, i) => `${i + 1}. ${p}`).join(' / ')}`,
  ];
  if (kind === 'mecha') rows.push(`外觀參數:${fmtField({ type: 'obj' }, d.gen.visual)}`);
  rows.push(`建模注意:${d.gen.note}`);
  return [head, ...rows].join('\n');
}

// ---- 格式驗證(稽核與離線管線共用;回傳 `[]` = 全部合格)--------------------
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isList = (v) => Array.isArray(v) && v.length > 0 && v.every(isText);
/** 舊制自由字串的標籤殘留:結構化之後任何欄位裡都不該再出現「◯◯原型:」*/
const LEGACY_LABEL = /(現實|機體|體態|仿生)原型[::]/;

export function codexIssues() {
  const out = [];
  const bad = (kind, id, field, msg) => out.push({ kind, id, field, msg });
  const ids = Object.keys(CHARACTERS);

  // 兩種檔案的生成段 MUST 用同一組鍵 —— 「格式完全對齊」的核心斷言
  for (const kind of CODEX_KINDS) {
    const keys = CODEX_FIELDS[kind].filter((f) => f.sec === 'gen' && GEN_KEYS.includes(f.key)).map((f) => f.key);
    if (keys.join() !== GEN_KEYS.join()) bad(kind, '-', 'gen', `生成段欄位與 GEN_FIELDS 不一致:${keys.join()}`);
  }

  const codes = new Map();
  for (const id of ids) {
    // ---- 角色 ----
    const lo = LORE[id];
    if (!lo) { bad('char', id, '-', '缺少 lore.js 檔案'); continue; }
    if (lo.proto != null) bad('char', id, 'proto', '原型已移到 mecha.js,lore.js MUST NOT 再留自由字串');
    for (const f of CODEX_FIELDS.char) {
      if (!f.req || f.src !== 'lore') continue;
      const v = f.sec === 'gen' && f.key !== 'art' ? lo.gen?.[f.key] : lo[f.key];
      checkField('char', id, f, v);
    }
    if (!lo.art || !isText(lo.art.style)) bad('char', id, 'art', '缺少程序立繪參數');
    else if (!HAIR_WORD[lo.art.style]) bad('char', id, 'art.style', `HAIR_WORD 查無「${lo.art.style}」`);

    // ---- 機體 ----
    const me = MECHA[id];
    if (!me) { bad('mecha', id, '-', '缺少 mecha.js 檔案'); continue; }
    if (!/^[STN]-\d\d$/.test(me.code || '')) bad('mecha', id, 'code', `型號格式不合(${me.code})`);
    if (codes.has(me.code)) bad('mecha', id, 'code', `型號與 ${codes.get(me.code)} 重複`);
    codes.set(me.code, id);

    // 原型層:MUST 與 visual 推導出來的層集**完全相同**(少一層 = 介紹缺一塊、多一層 = 格式外的自創層)
    const want = protoLayers(id).join();
    const got = Object.keys(me.proto || {}).join();
    if (want !== got) bad('mecha', id, 'proto', `原型層與 visual 推導不符:應為 [${want}],實為 [${got}]`);
    for (const [k, L] of Object.entries(me.proto || {})) {
      for (const p of PROTO_PARTS) {
        if (!isText(L?.[p])) bad('mecha', id, `proto.${k}.${p}`, '空白');
        else if (LEGACY_LABEL.test(L[p])) bad('mecha', id, `proto.${k}.${p}`, '殘留舊制自由字串標籤');
      }
    }
    for (const f of CODEX_FIELDS.mecha) {
      if (!f.req || f.src !== 'mecha' || f.sec !== 'gen') continue;
      checkField('mecha', id, f, me.gen?.[f.key]);
    }

    // 外觀詞彙表 MUST 蓋得住現役用到的每一個列舉值
    for (const [k, v] of Object.entries(CHARACTERS[id].visual || {})) {
      if (VIS_NUMERIC.has(k)) continue;
      if (!VIS_WORDS[k]?.[v]) bad('mecha', id, `visual.${k}`, `VIS_WORDS 查無「${v}」`);
    }
  }

  function checkField(kind, id, f, v) {
    if (f.type === 'list') {
      if (!isList(v)) { bad(kind, id, f.key, '清單為空或含空項'); return; }
      if (f.key === 'tag') for (const t of v) {
        if (t.length > TAG_MAX || /[。,;]/.test(t)) bad(kind, id, 'tag', `「${t}」不是名詞短語`);
      }
    } else if (f.type === 'num') {
      if (typeof v !== 'number' || !Number.isFinite(v)) bad(kind, id, f.key, '非數值');
    } else if (f.type === 'obj') {
      if (!v || typeof v !== 'object') bad(kind, id, f.key, '缺少物件');
    } else if (!isText(v)) bad(kind, id, f.key, '空白');
    else if (LEGACY_LABEL.test(v)) bad(kind, id, f.key, '殘留舊制自由字串標籤');
  }

  return out;
}
