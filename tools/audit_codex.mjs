// ============ 角色 / 機體檔案格式 稽核 ============
// 用途:改 `public/js/codex.js`(`SECTIONS`/`PROTO_LAYERS`/`GEN_FIELDS`/`CODEX_FIELDS`/`VIS_WORDS`/
// `HAIR_WORD`/`protoLayers`/`charCodex`/`mechaCodex`/`textSeed`/`imagePrompt`/`modelSheet`/
// `codexIssues`)、`public/js/mecha.js`、`public/js/lore.js` 的 `gen` 段,或 `main.js protoHTML`
// 與 `data.js CHARACTERS[].visual` 的列舉值之後跑。
//
// 使用者定案(2026-08-04):「角色與機體的完整數據與文字說明的格式完全對齊,特別是機體原型的介紹,
// 也包括不顯示與遊戲、用於文本生成、2D 生圖或 3D 建模使用的部分,都統一標準格式。」
// 五條可量測的不變式:
//
//   ① 格式對齊是**結構性**的      —— 兩種檔案的生成段鍵集逐位元相同,而且都由 `GEN_FIELDS` 這**一張**
//      表推導。靠註解寫「請保持一致」撐不住:舊制的 proto 自由字串就是前車之鑑(32 台長出 4 種標籤、
//      8 台只有一層、變形者的兩個型態被擠在同一句話裡,而且沒有任何東西會報錯)。
//   ② 原型層由 `visual` 推導      —— 少一層 = 那台機體的介紹缺一塊、多一層 = 格式外的自創層,兩者
//      都是紅字而不是「那台剛好比較短」。變形者因此**恆有兩層形態原型**(飛行型 + 地面型)。
//   ③ 32 × 2 份檔案全數填滿      —— 每一欄非空、`tag` 是名詞短語不是句子、型號唯一且 1:1。
//   ④ 單一縫                    —— 值到原處取(全高走 `heroTargetH`、主色走 `visual.hue`),
//      三份生成文字由 codex.js 組裝;`mecha.js` 零 import、`main.js` 不再切標籤字串。
//   ⑤ 生成輸出真的是推導的        —— 直接執行真品:改一個欄位,三份輸出跟著變(手寫的第二份不會)。
//
//   ⑥ 型態姿態只有一份            —— 2026-08-05 使用者定案「變形者的飛行型態要另外下 prompt 說明是
//      飛行姿態」。`FORM_POSE` 是那句話的**唯一**落點,覆核台(`imagePrompt` 的 zh)與離線出圖管線
//      (`tools/ai3d/prompt.mjs` 的 en/framing)同吃 —— 各寫一份的症狀是「工具畫的是飛行姿態、
//      人照著覆核台複製的那份不是」,兩邊都不報錯。
//
// 跑法:`node tools/audit_codex.mjs`(不需伺服器/瀏覽器/網路)
// 反向驗證:`--break-layer`(抽掉一台機體的原型層)/ `--break-align`(角色生成段多一個欄位)
//           / `--break-pose`(飛行姿態語退回舊制「只說零件重排、不說在空中」)
//           —— 三者 MUST 分別讓 ②③ / ① / ⑥ 紅字,否則等於沒驗到(CLAUDE.md 原則 9)。
// 讀原文走 `audit_src.mjs` 單一縫(含換行正規化)。
import { readSrc } from './audit_src.mjs';
import {
  SECTIONS, PROTO_LAYERS, PROTO_PARTS, GEN_FIELDS, GEN_KEYS, TAG_MAX, CODEX_FIELDS, CODEX_KINDS,
  VIS_WORDS, HAIR_WORD, KIND_WORD, FORM_POSE, SHOT_POSES, SHOT_POSE_KEYS, shotFraming,
  protoLayers, protoOf, charCodex, mechaCodex,
  textSeed, imagePrompt, modelSheet, codexIssues, visualWords, artWords, hueHex,
} from '../public/js/codex.js';
import { masterPrompt } from './ai3d/prompt.mjs';
import { MECHA } from '../public/js/mecha.js';
import { LORE } from '../public/js/lore.js';
import { CHARACTERS, charKind, heroTargetH } from '../public/js/data.js';

const BREAK_LAYER = process.argv.includes('--break-layer');
const BREAK_ALIGN = process.argv.includes('--break-align');
const BREAK_POSE = process.argv.includes('--break-pose');
if (BREAK_LAYER) delete MECHA.t06.proto.air;                       // 變形者少一層形態原型
if (BREAK_ALIGN) CODEX_FIELDS.char.push({ sec: 'gen', key: 'pose', label: '姿勢', type: 'text', src: 'lore', req: true });
// 舊制原文:只說「同一台機器把零件重排」,一個字都沒提機體在空中,取景還寫著站姿
if (BREAK_POSE) {
  FORM_POSE.flight.zh = '飛行型態:同一台機器的零件重新排列';
  FORM_POSE.flight.en = 'Draw the FLIGHT form of the SAME machine: the same parts rearranged.';
  FORM_POSE.flight.framing = 'standing three-quarter view';
}

const codexSrc = readSrc('public', 'js', 'codex.js');
const mechaSrc = readSrc('public', 'js', 'mecha.js');
const loreSrc = readSrc('public', 'js', 'lore.js');
const mainSrc = readSrc('public', 'js', 'main.js');

const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
const mechaCode = strip(mechaSrc);
const loreCode = strip(loreSrc);
const codexCode = strip(codexSrc);
const mainCode = strip(mainSrc);

const IDS = Object.keys(CHARACTERS);
let pass = 0, fail = 0;
const t = (name, ok) => { if (ok) { pass++; } else { fail++; console.log(`  ❌ ${name}`); } };
const sec = (s) => console.log(`\n── ${s} ──`);

// ══ Ⅰ 格式對齊(這一段就是使用者那句話的落點)═════════════════════════════
sec('Ⅰ 格式對齊:兩種檔案同一組段落、同一組生成欄位');
t('恰兩種檔案(角色 / 機體)', CODEX_KINDS.length === 2 && CODEX_KINDS.includes('char') && CODEX_KINDS.includes('mecha'));
t('段落表恰四段(識別/簡介/詳閱/生成)且只有一份定義',
  SECTIONS.length === 4 && SECTIONS.map((s) => s.key).join() === 'ident,brief,deep,gen'
  && (codexCode.match(/export const SECTIONS\s*=/g) || []).length === 1);
t('生成段 = 不顯示於遊戲(show:never)', SECTIONS.find((s) => s.key === 'gen').show === 'never');
for (const kind of CODEX_KINDS) {
  const secs = [...new Set(CODEX_FIELDS[kind].map((f) => f.sec))];
  t(`${kind} 的段落全部出自 SECTIONS(沒有自創段)`, secs.every((k) => SECTIONS.some((s) => s.key === k)));
  t(`${kind} 四段都有欄位(沒有空段)`, SECTIONS.every((s) => CODEX_FIELDS[kind].some((f) => f.sec === s.key)));
}
{
  // 核心斷言:兩邊的生成段鍵集**逐位元相同**,而且順序也一樣(順序一亂,外部管線的欄位對照就錯位)
  const g = (kind) => CODEX_FIELDS[kind].filter((f) => f.sec === 'gen' && GEN_KEYS.includes(f.key)).map((f) => f.key).join();
  t('角色與機體的生成段鍵集逐位元相同', g('char') === g('mecha') && g('char') === GEN_KEYS.join());
  const extra = (kind) => CODEX_FIELDS[kind].filter((f) => f.sec === 'gen' && !GEN_KEYS.includes(f.key)).map((f) => f.key);
  // 生成段只准多出「該檔案專屬的參數物件」那一格(角色 art / 機體 visual),其餘一律要進 GEN_FIELDS
  t('角色生成段除了 art 之外沒有第二份欄位表', extra('char').join() === 'art');
  t('機體生成段除了 visual 之外沒有第二份欄位表', extra('mecha').join() === 'visual');
}
t('GEN_FIELDS 只有一份定義、GEN_KEYS 由它推導(MUST NOT 手寫鍵清單)',
  (codexCode.match(/export const GEN_FIELDS\s*=/g) || []).length === 1
  && /GEN_KEYS\s*=\s*GEN_FIELDS\.map/.test(codexCode));
t('生成欄位恰六欄且型別齊備',
  GEN_FIELDS.length === 6 && GEN_FIELDS.every((f) => f.key && f.label && ['text', 'list'].includes(f.type)));
t('lore.js / mecha.js 沒有自帶第二份欄位表(格式只住 codex.js)',
  !/GEN_FIELDS|CODEX_FIELDS|SECTIONS/.test(loreCode) && !/GEN_FIELDS|CODEX_FIELDS|SECTIONS/.test(mechaCode));

// ══ Ⅱ 原型層:機體原型的介紹統一標準格式 ══════════════════════════════════
sec('Ⅱ 原型層:層集由 visual 推導,逐台比對');
t('原型層表只有一份、每層都標了推導來源',
  (codexCode.match(/export const PROTO_LAYERS\s*=/g) || []).length === 1
  && PROTO_LAYERS.length === 5 && PROTO_LAYERS.filter((L) => L.from === null).length === 1);
t('每層恰兩欄(src 名稱 / note 設計理由)—— 揉成一句就退回自由字串了',
  PROTO_PARTS.length === 2 && PROTO_PARTS.join() === 'src,note');
{
  let okLayer = 0, okOrder = 0, morphTwo = 0, frameN = 0, bionicN = 0;
  for (const id of IDS) {
    const vis = CHARACTERS[id].visual;
    // 逐台**獨立重算**該有哪幾層(不呼叫 protoLayers,否則等於拿被測者驗自己)
    const want = ['real',
      vis.proto != null && 'frame', vis.creature != null && 'bionic',
      vis.flight != null && 'air', vis.ground != null && 'ground'].filter(Boolean);
    const got = Object.keys(MECHA[id].proto);
    if (want.join() === got.join()) okLayer++;
    if (protoOf(id).map((L) => L.key).join() === want.join()) okOrder++;
    if (charKind(id) === 'morph' && got.includes('air') && got.includes('ground')) morphTwo++;
    if (got.includes('frame')) frameN++;
    if (got.includes('bionic')) bionicN++;
  }
  t(`32 台的原型層與 visual 推導逐台相符(${okLayer}/32)`, okLayer === 32);
  t('顯示序 = PROTO_LAYERS 宣告序(設計原型恆在最前)', okOrder === 32);
  t(`8 台變形者恆有飛行型 + 地面型兩層(${morphTwo}/8)`, morphTwo === 8
    && IDS.filter((id) => charKind(id) === 'morph').length === 8);
  t(`4 台人形機甲恆有機體原型(${frameN})`, frameN === 4);
  t(`12 台獸型機體恆有仿生原型(${bionicN})`, bionicN === 12);
}
t('原型層總數 = 32 + 4 + 12 + 8 + 8 = 64',
  IDS.reduce((n, id) => n + Object.keys(MECHA[id].proto).length, 0) === 64);
{
  const layers = IDS.flatMap((id) => protoOf(id));
  t('每層的 src 是名詞而非整句(不含句號)', layers.every((L) => !/。/.test(L.src)));
  t('每層的 note 有實質內容(≥ 10 字)', layers.every((L) => L.note.length >= 10));
  t('沒有任何一層把 note 寫成 src 的複製', layers.every((L) => L.note !== L.src));
}
t('舊制的自由字串標籤已整組退場(lore.js 無 proto 欄、mecha.js 無「◯◯原型:」)',
  !/^\s*proto:\s*'/m.test(loreCode) && !/(現實|機體|體態|仿生)原型[::]/.test(mechaCode));

// ══ Ⅲ 內容齊備 ═══════════════════════════════════════════════════════════
sec('Ⅲ 內容齊備:32 名角色 × 32 台機體全數填滿');
{
  const iss = codexIssues();
  if (iss.length) for (const i of iss.slice(0, 12)) console.log(`     · ${i.kind} ${i.id} ${i.field}:${i.msg}`);
  t(`格式驗證全數通過(codexIssues 回傳 ${iss.length} 筆)`, iss.length === 0);
}
t('32 名角色都有 lore 檔案與 mecha 檔案(1:1,一台機體恰一名駕駛)',
  IDS.length === 32 && IDS.every((id) => LORE[id] && MECHA[id])
  && Object.keys(MECHA).length === 32 && Object.keys(LORE).length === 32);
{
  const codes = IDS.map((id) => MECHA[id].code);
  t('機體型號唯一且格式一致(S-01 / T-01 / N-01)',
    new Set(codes).size === 32 && codes.every((c) => /^[STN]-\d\d$/.test(c)));
  const pre = (p) => codes.filter((c) => c.startsWith(p)).length;
  t('型號前綴對得上陣營編制(蜂群 12 / 鋼鐵 12 / 傭兵 8)',
    pre('S-') === 12 && pre('T-') === 12 && pre('N-') === 8);
}
{
  let tagN = 0, partN = 0;
  for (const id of IDS) for (const src of [LORE[id].gen, MECHA[id].gen]) {
    if (src.tag.every((x) => x.length <= TAG_MAX && !/[。,;]/.test(x))) tagN++;
    if (src.parts.length >= 4) partN++;
  }
  t(`生圖關鍵詞全部是名詞短語(${tagN}/64 份檔案)`, tagN === 64);
  t(`3D 分件清單每份 ≥ 4 件(${partN}/64)`, partN === 64);
}
t('外觀詞彙表蓋得住現役用到的每一個列舉值(新增機型不會靜默留空)',
  IDS.every((id) => visualWords(id).every((w) => !/^\w+:/.test(w))));
t('髮型詞彙表蓋得住現役 32 名的每一個 style', IDS.every((id) => HAIR_WORD[LORE[id].art.style]));
t('機種詞彙表蓋得住三個機種', ['drone', 'robot', 'morph'].every((k) => KIND_WORD[k]));

// ══ Ⅳ 單一縫 ═════════════════════════════════════════════════════════════
sec('Ⅳ 單一縫:值到原處取、格式只有一份、生成文字只由 codex.js 組裝');
t('mecha.js 零 import(離線稽核與生成管線直接吃真品)', !/^\s*import\s/m.test(mechaCode));
t('codex.js 只 import 三支純資料檔(無 three / 無 DOM)',
  [...codexCode.matchAll(/^import[\s\S]*?from '([^']+)';/gm)].map((m) => m[1]).sort().join() === './data.js,./lore.js,./mecha.js');
t('mecha.js MUST NOT 手寫機體全高(公尺數走 heroTargetH 推導)', !/\d\s*(m\b|公尺|米)/.test(mechaCode));
t('mecha.js MUST NOT 複製主色/機種/陣營(那三樣住 data.js)',
  !/0x[0-9a-f]{6}/i.test(mechaCode) && !/kind\s*:/.test(mechaCode) && !/side\s*:/.test(mechaCode));
t('全高只有 heroTargetH 一個來源(codex.js 恰一處呼叫)',
  (codexCode.match(/heroTargetH\(/g) || []).length === 1);
t('三份生成文字各只有一份實作',
  ['textSeed', 'imagePrompt', 'modelSheet'].every((f) =>
    (codexCode.match(new RegExp(`export function ${f}\\(`, 'g')) || []).length === 1));
t('lore.js / mecha.js MUST NOT 自己手寫第二份生圖提示或建模單',
  !/imagePrompt|modelSheet|textSeed/.test(loreCode) && !/imagePrompt|modelSheet|textSeed/.test(mechaCode));
t('main.js 的 protoHTML 只負責畫:不再切標籤字串、不再自帶標籤表',
  /function protoHTML\(id\)/.test(mainCode) && /protoOf\(/.test(mainCode)
  && !/PROTO_LABEL/.test(mainCode) && !/(現實|機體|體態|仿生)原型[::]/.test(mainCode));
{
  // 分隔符 MUST NOT 是「」或 ——:原型名稱本身就含這兩種符號(`「壁壘」過裝甲型`、
  // `T-14 阿瑪塔的「乘員艙獨立裝甲」哲學`),拿它們當框會套成兩層引號、與 note 裡的 —— 撞在一起
  const fn = mainCode.slice(mainCode.indexOf('function protoHTML('));
  const body = fn.slice(0, fn.indexOf('\n}'));
  t('原型的顯示分隔靠 <b> 而不是標點(名稱本身含「」與 ——)',
    /<b>\$\{esc\(L\.src\)\}<\/b>/.test(body) && !/[「」]/.test(body) && !/——/.test(body));
  t('style.css 有 .cd-proto b 的樣式(分隔靠顏色與留白)', readSrc('public', 'css', 'style.css').includes('.cd-proto b'));
  const layerLine = textSeed('mecha', 't01');
  t('文本種子的原型層也不用「」/—— 當分隔(t01 的名稱本身就含兩者)',
    layerLine.includes('機體原型 ▸ 「壁壘」過裝甲型'));
}
{
  // 2D 生圖管線是 `protoOf` 的第二個消費端,而它的失效方式**完全無聲**:舊制讀 lore 的自由字串
  // `proto`,那個欄位結構化之後取到 undefined → 空字串 → 被 `filter(Boolean)` 濾掉 ⇒ 提示詞裡
  // 最權威的設計敘述整段消失,只表現成「生出來的圖跟設定對不上」(2026-08-05 實測 18 張設定稿)。
  // 故除了原文比對,還 MUST **執行真品**確認那一行真的帶著這台的原型層。
  const promptSrc = readSrc('tools', 'ai3d', 'prompt.mjs');
  t('2D 生圖提示詞從 codex.js 取設計敘述(MUST NOT 回頭讀 lore 的 proto 自由字串)',
    /import \{[^}]*protoOf[^}]*\} from '[^']*codex\.js'/.test(promptSrc)
    && !/loreOf|\.proto\b/.test(strip(promptSrc)));
  const brief = IDS.map((id) => masterPrompt(id, protoLayers(id).includes('air') ? 'ground' : null));
  t('每一台的設定稿提示詞都帶著非空的設計敘述',
    brief.every((p) => /Design brief \(authoritative, Traditional Chinese\):\n  · \S/.test(p)));
  t('設計敘述逐層 = protoOf(該台)(內容真的是推導的,不是另寫一份)',
    IDS.every((id, i) => protoOf(id).every((L) => brief[i].includes(`${L.label} ▸ ${L.src}:${L.note}`))));
}
t('main.js 從 codex.js 取原型(MUST NOT 自己 import MECHA 再拼)',
  /import \{[^}]*protoOf[^}]*\} from '\.\/codex\.js'/.test(mainSrc) && !/from '\.\/mecha\.js'/.test(mainSrc));
t('codexIssues 只有一份實作(稽核與離線管線同吃)',
  (codexCode.match(/export function codexIssues\(/g) || []).length === 1);

// ══ Ⅴ 生成輸出行為直測(執行真品)═════════════════════════════════════════
sec('Ⅴ 生成輸出:三份文字逐台可用,且真的是推導的');
{
  let seedOK = 0, imgOK = 0, mdlOK = 0;
  for (const id of IDS) for (const kind of CODEX_KINDS) {
    const seed = textSeed(kind, id), img = imagePrompt(kind, id), mdl = modelSheet(kind, id);
    // 文本生成:四段都在、生成段附上推導的尺度基準
    if (SECTIONS.every((s) => seed.includes(`【${s.label}】`)) && /尺度基準:[\d.]+ m/.test(seed)) seedOK++;
    // 2D:關鍵詞在第一行、剪影與材質各自成行
    if (img.split('\n').length === 3 && img.split('\n')[0].includes('、')) imgOK++;
    // 3D:全高 + 比例 + 材質 + 分件(編號)+ 注意
    if (/全高基準:[\d.]+ m/.test(mdl) && /分件:1\. /.test(mdl) && /建模注意:/.test(mdl)) mdlOK++;
  }
  t(`文本生成種子四段齊備(${seedOK}/64)`, seedOK === 64);
  t(`2D 生圖提示格式一致(${imgOK}/64)`, imgOK === 64);
  t(`3D 建模單格式一致(${mdlOK}/64)`, mdlOK === 64);
}
{
  // 機體的 2D 提示 MUST 帶得到原型出處與主色(那是它與角色提示最大的差別)
  const img = imagePrompt('mecha', 's06');
  t('機體提示帶原型出處', img.includes('半人馬(代號「凱隆」)'));
  t('機體提示帶主色十六進位(生圖管線吃 #rrggbb 不吃 JS 數字)', img.includes(hueHex('s06')) && /^#[0-9a-f]{6}$/.test(hueHex('s06')));
  t('提示不重複同一個詞(原型 src 與 visual 詞彙本來就會撞)',
    (() => { const w = img.split('\n')[0].split('、'); return new Set(w).size === w.length; })());
  const cimg = imagePrompt('char', 's05');
  t('角色提示帶立繪參數(髮型翻成名詞、色值保持 #rrggbb)',
    artWords('s05').every((w) => cimg.includes(w)) && cimg.includes('短髮') && cimg.includes('#ff7fb0'));
}
{
  // ⑤ 推導的證據:動一個欄位,三份輸出跟著動(手寫的第二份不會)
  const before = [textSeed('mecha', 's01'), imagePrompt('mecha', 's01'), modelSheet('mecha', 's01')];
  const keep = MECHA.s01.gen.tag;
  MECHA.s01.gen.tag = ['稽核探針'];
  const after = [textSeed('mecha', 's01'), imagePrompt('mecha', 's01'), modelSheet('mecha', 's01')];
  MECHA.s01.gen.tag = keep;
  t('改 tag ⇒ 文本種子與 2D 提示跟著變、3D 建模單不變(tag 只餵生圖)',
    after[0] !== before[0] && after[1] !== before[1] && after[2] === before[2]
    && after[1].includes('稽核探針'));
  const kh = MECHA.s01.gen.parts;
  MECHA.s01.gen.parts = ['稽核件'];
  const m2 = modelSheet('mecha', 's01');
  MECHA.s01.gen.parts = kh;
  t('改 parts ⇒ 3D 建模單跟著變', m2.includes('1. 稽核件'));
}
{
  // 全高是推導的:同一台機體的建模單高度 MUST 等於 heroTargetH(不是 mecha.js 裡的一個數字)
  const okH = IDS.every((id) =>
    modelSheet('mecha', id).includes(`全高基準:${heroTargetH(charKind(id), id).toFixed(2)} m`));
  t('建模單的全高逐台 = heroTargetH(改 mods.armor 會自己跟著動)', okH);
  t('角色的尺度基準 = 真人身高單位(CLAUDE.md §2.5)', charCodex('s01').scaleM === 1.8);
  t('機甲比無人機高(全高真的隨機種/護甲走,不是同一個常數)',
    mechaCodex('t01').scaleM > mechaCodex('s05').scaleM);
}
{
  // 完整檔案 MUST 是「到原處取」而不是複製:改 data.js 的機體名,檔案跟著變
  const keep = CHARACTERS.s02.machine;
  CHARACTERS.s02.machine = '稽核機';
  const ok = mechaCodex('s02').ident.name === '稽核機' && charCodex('s02').ident.mecha === '稽核機';
  CHARACTERS.s02.machine = keep;
  t('識別段的值到 data.js 取(mecha.js/lore.js 沒有第二份)', ok);
}

// ══ Ⅵ 型態姿態:飛行稿要真的是飛行姿態,而且只有一份定義 ══════════════════
sec('Ⅵ 型態姿態(變形者飛行 / 地面):單一縫 + 真的說了「在空中」');
{
  const promptSrc = readSrc('tools', 'ai3d', 'prompt.mjs');
  const promptCode = strip(promptSrc);
  const reviewCode = strip(readSrc('tools', 'codex_review', 'review.js'));

  t('恰兩個型態(地面 / 飛行),每個都有 zh / en / framing 三欄',
    Object.keys(FORM_POSE).sort().join() === 'flight,ground'
    && Object.values(FORM_POSE).every((p) => ['label', 'zh', 'en', 'framing']
      .every((k) => typeof p[k] === 'string' && p[k].trim())));

  // 這一條就是使用者那句話:飛行稿 MUST 講明機體「在空中」。舊制只講「零件重排」——
  // 而「重排」在地面上也成立,所以收回來的六張全是站著的變形後姿態。
  t('飛行姿態語明講機體離地在飛(中文)', /在空中|騰空|離地/.test(FORM_POSE.flight.zh));
  t('飛行姿態語明講機體離地在飛(英文)',
    /\bAIRBORNE\b/.test(FORM_POSE.flight.en) && /off the ground|in flight/i.test(FORM_POSE.flight.en));
  t('飛行取景 MUST NOT 是站姿(standing 會把模型拉回地面)',
    !/standing/i.test(FORM_POSE.flight.framing) && /airborne|flight/i.test(FORM_POSE.flight.framing));
  t('地面取景逐字維持舊制(非變形者吃這一組 ⇒ 舊提示詞逐位元不變)',
    FORM_POSE.ground.framing === 'standing three-quarter view');

  // 單一縫:兩個消費端都 import,誰都不准自己寫一句飛行姿態
  t('出圖管線吃 codex.FORM_POSE(MUST NOT 自帶第二份姿態語)',
    /import \{[^}]*FORM_POSE[^}]*\} from '\.\.\/\.\.\/public\/js\/codex\.js'/.test(promptCode)
    && !/Draw the (FLIGHT|GROUND) form/.test(promptCode));
  t('覆核台的重下 prompt 帶型態**與動作**(不帶 = 好幾格共用同一份提示詞)',
    /imagePrompt\('mecha', r\.id, s\.form, s\.pose\)/.test(reviewCode));
  t('FORM_POSE 只有一份定義', (codexCode.match(/export const FORM_POSE/g) || []).length === 1);

  // 行為直測:同一台變形者,兩型的提示詞 MUST 不同,且各自只帶自己那一層原型
  const air = imagePrompt('mecha', 'm07', 'flight');
  const gnd = imagePrompt('mecha', 'm07', 'ground');
  const none = imagePrompt('mecha', 'm07');
  t('同一台變形者兩型提示詞不同', air !== gnd);
  t('飛行提示詞帶飛行姿態語、地面的不帶',
    air.includes(FORM_POSE.flight.zh) && !gnd.includes(FORM_POSE.flight.zh)
    && gnd.includes(FORM_POSE.ground.zh));
  t('畫哪一型就只帶哪一層原型(兩層一起送 = 同一張圖被要求長成兩種東西)',
    air.includes(MECHA.m07.proto.air.src) && !air.includes(MECHA.m07.proto.ground.src)
    && gnd.includes(MECHA.m07.proto.ground.src) && !gnd.includes(MECHA.m07.proto.air.src));
  t('不給型態 ⇒ 逐位元同舊行為(三行、兩層原型都在)',
    none.split('\n').length === 3
    && none.includes(MECHA.m07.proto.air.src) && none.includes(MECHA.m07.proto.ground.src));
  t('非變形者不受影響(沒有型態層可濾,也不掛姿態語)',
    imagePrompt('mecha', 't01', 'flight') === imagePrompt('mecha', 't01'));
}
{
  // ── 動作姿態(第二個維度):覆核台數得出「缺 38 張 moving/heavy」,出圖端就要生得出來 ──
  const reviewSrc = strip(readSrc('tools', 'codex_review.mjs'));
  const promptCode = strip(readSrc('tools', 'ai3d', 'prompt.mjs'));
  t('恰三種動作(靜止/移動/重武器),每一種都有 zh/en',
    SHOT_POSE_KEYS.join() === 'static,moving,heavy'
    && SHOT_POSES.every((p) => ['key', 'label', 'zh', 'en'].every((k) => typeof p[k] === 'string' && p[k].trim())));
  t('覆核台的姿態清單由 SHOT_POSES 推導(MUST NOT 自己列第二份)',
    /POSES = SHOT_POSES\.map/.test(reviewSrc) && !/key: 'moving'/.test(reviewSrc));
  t('出圖端吃同一份動作語(MUST NOT 自帶第二份)',
    /SHOT_POSES/.test(promptCode) && !/FIRING THE HEAVY WEAPON/.test(promptCode));
  // 靜止**不覆寫取景** ⇒ 既有的靜止稿提示詞逐位元不變(這是這次擴充最容易破的一條)
  t('靜止不覆寫取景(舊有靜止稿的提示詞逐位元不變)',
    !SHOT_POSES.find((p) => p.key === 'static').framing
    && shotFraming('t01', null, 'static') === FORM_POSE.ground.framing
    && shotFraming('m07', 'flight', 'static') === FORM_POSE.flight.framing);
  t('移動/重武器的取景逐 medium 分開(地面奔跑 ≠ 空中高速掠過)',
    ['moving', 'heavy'].every((k) => {
      const f = SHOT_POSES.find((p) => p.key === k).framing;
      return f && f.ground && f.air && f.ground !== f.air;
    }));
  t('飛行的三種動作取景一律不含站姿、且都講明離地',
    SHOT_POSE_KEYS.every((k) => {
      const s = shotFraming('m07', 'flight', k);
      return !/standing/i.test(s) && /airborne/i.test(s);
    }));
  t('地面機體的三種動作取景各不相同(三張圖不該是同一個取景)',
    new Set(SHOT_POSE_KEYS.map((k) => shotFraming('t01', null, k))).size === 3);
  {
    const a = imagePrompt('mecha', 't01', null, 'heavy');
    const b = imagePrompt('mecha', 't01', null, 'moving');
    t('同一台機體三種動作的提示詞互不相同',
      a !== b && a !== imagePrompt('mecha', 't01', null, 'static'));
    t('不給動作 ⇒ 逐位元同舊行為(三行)', imagePrompt('mecha', 't01').split('\n').length === 3);
  }
}
{
  // 設計敘述真的送得出去 —— 舊制取的是 2026-08-04 已退場的 `lore.proto`,恆為空:
  // 提示詞看起來仍然很長,但機體的權威敘述一次都沒送出過,而且沒有錯誤訊息。
  const promptCode = strip(readSrc('tools', 'ai3d', 'prompt.mjs'));
  t('出圖管線的設計敘述取機體檔案(MUST NOT 復辟已退場的 lore.proto)',
    /mechaCodex|protoOf/.test(promptCode) && !/loreOf\(/.test(promptCode));

  // 用不到的外觀欄位 MUST NOT 送進生圖(換機種留下的殘值 = 憑空多一條設計要求)。
  // 適用性 MUST 對得上 models.js 的**實際消費點**:frame/body 只有 buildDrone 讀、
  // wing 只有 buildFixedWing 讀 —— 這一條靠原文反查,models.js 一改就紅字。
  const modelsCode = strip(readSrc('public', 'js', 'models.js'));
  const consumedIn = (fn, key) => {
    const at = modelsCode.indexOf(`function ${fn}(`);
    const end = modelsCode.indexOf('\nfunction ', at + 1);
    return new RegExp(`vis\\??\\.${key}\\b`).test(modelsCode.slice(at, end < 0 ? undefined : end));
  };
  t('擬態翼無人機不讀 frame/body(models.js 原文反查)',
    !consumedIn('buildAvianDrone', 'frame') && !consumedIn('buildAvianDrone', 'body'));
  t('定翼無人機不讀 frame/body、只讀 wing(models.js 原文反查)',
    !consumedIn('buildFixedWing', 'frame') && !consumedIn('buildFixedWing', 'body')
    && consumedIn('buildFixedWing', 'wing'));
  const AVIAN = Object.keys(CHARACTERS).filter((id) => CHARACTERS[id].visual?.form === 'avian');
  t(`擬態翼機體的生圖詞不含旋翼/機身殼(${AVIAN.length} 台)`, AVIAN.length > 0 && AVIAN.every((id) => {
    const v = CHARACTERS[id].visual;
    const w = visualWords(id);
    return !w.includes(VIS_WORDS.frame?.[v.frame]) && !w.includes(VIS_WORDS.body?.[v.body]);
  }));
  t('多旋翼機體照舊帶旋翼骨架詞(這一刀 MUST 只切用不到的那幾台)', (() => {
    const q = Object.keys(CHARACTERS).find((id) => {
      const v = CHARACTERS[id].visual || {};
      return v.frame && v.frame !== 'wing' && v.form !== 'avian' && v.form !== 'fixed';
    });
    return q && visualWords(q).includes(VIS_WORDS.frame[CHARACTERS[q].visual.frame]);
  })());
}

console.log(`\n${fail === 0 ? '🎉' : '❌'} 角色 / 機體檔案格式稽核:${pass} 通過 / ${fail} 失敗`);
process.exit(fail === 0 ? 0 : 1);
