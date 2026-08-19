// ============ 立體結構的線工授權 / 坑門表面群組 / 洞口反光帶(序 12b ⑨)============
// 2026-08-16。計畫 §⑨「立體結構重新渲染」的**離線防線**。⑨ 的第一句是定案:**既有技術一行不動**
// —— 幾何 / 碰撞 / slab / decks / cols / 走廊 / `tunFloorAt` / `underpassPlan` / `strucHw` /
// `tunRoofTop` / `tunnelWallProfile` 全部原封不動,本輪只動材質與著色層。那一半由既有七支
// (`audit_open_tunnel` / `audit_underpass` / `audit_layer_block` / `audit_road_joint` /
// `audit_road_bed` / `audit_bridge_*` / `audit_water_skirt`)守著,**它們任何一支變紅就是
// 視覺改動漏進了幾何**;本支只驗「材質那一層有沒有照規則做」。
//
// 為什麼這五件會靜默壞掉(= 本支存在的理由):
//   ⑨-1/⑨-2 **材質沒經 cel 入口 ⇒ 沒有 `gInfo` 宣告 ⇒ 那一批物件整批不畫,console 一個字都沒有**。
//            WebGL2 的規則是「啟用中的 draw buffer 沒有對應 output = INVALID_OPERATION」,
//            而它不會拋例外、不會警告 —— 畫面上就是隧道整段消失。今天 22 支結構材質全部走
//            `envMat`/`toonMat` ⇒ `gInfo` 由 `applyCelPatch` 無條件寫出 ⇒ **這兩項是零改動**,
//            要守的是「以後也不准有人在這裡 `new THREE.MeshBasicMaterial`」。
//            ⚠ 本支 MUST NOT 重寫 `audit_cel_pipeline` Ⅵ 的「自寫 ShaderMaterial 要宣告 gInfo」
//            那道逐檔掃描(同一條規則兩份實作 = 兩份會分家);那一支問「宣告了沒」,本支問
//            「結構這一區有沒有繞過 cel 入口」,是**更硬的一層**(繞不過就不必問宣告)。
//   ⑨-3     貢獻(`outlineContribution`)**手寫數字**:名冊會在加構件時靜默過期,而畫面上
//            只表現成「這一款東西的線比別人淡」。規則是 S4 ——「呼叫端 MUST 傳自己排零件時
//            已經算出來的間距或尺寸」,唯一容許手寫的是具名否決值 `INK_CONTRIB_NONE`。
//   ⑨-4     坑門混凝土(額牆 / 翼牆 / collar / 外露頂板)**各抽一個 `nextSurfId()`** ⇒
//            `INK_MRT` 的 id 那一項會在**同一座構造物內部**畫線。共用具名號之後線收窄到外緣,
//            而混凝土↔上方山坡那一條靠 `SURF_ID.LAND = 0` 照樣出得來。
//   ⑨-5     「洞內太暗」被**換成淺一點的底色**修掉:既有定案是「不亮的凹處要 `emissive`,
//            不是換淺一點的顏色」(自動販賣機取出口那一課),而換底色的症狀是白天整條發白。
//
// 段別:
//   Ⅰ 結構區塊零原生材質(⑨-1 / ⑨-2 的守門)+ 22 支逐支經 cel 入口
//   Ⅱ 貢獻授權表:順序 × 底色 × 授權三欄凍結 + RHS 一律推導 + 值 ∈ k/15 + `bandPitchM` 行為直測
//   Ⅲ 坑門混凝土共用具名號 + 號差跨得過 postfx **解析出來**的門檻 + 洞內構件維持逐材質號
//   Ⅳ 底色逐位元凍結 + 提亮只准由 `emissive` 提供
//   Ⅴ 線工授權與材質發射區塊**零共享 `rnd()` 消耗**(§2.3)
//
// 反向驗證(§0 原則 9;字面替換 CRLF 容忍 `\r?\n`,替換無效 MUST 當場 exit 1;
// **期望值 MUST NOT 隨 --break-* 改變**):
//   --break-rawmat    結構區塊裡多一支原生材質 ⇒ Ⅰ MUST 紅
//   --break-contrib   欄杆的貢獻改成手寫常數(繞過推導縫)⇒ Ⅱ MUST 紅 2 條
//   --break-surf      三處 `surf: SURF_ID.CONCRETE` 拿掉 ⇒ Ⅲ MUST 紅
//   --break-emissive  黃格改成「換淺一點的底色 + 拿掉 emissive」⇒ Ⅳ MUST 紅 2 條
import { readSrc } from './audit_src.mjs';
import { SOLDIER_H, INK_CTR, inkCtrM } from '../public/js/data.js';

const A = process.argv.slice(2);
const BRK = {
  rawmat: A.includes('--break-rawmat'), contrib: A.includes('--break-contrib'),
  surf: A.includes('--break-surf'), emissive: A.includes('--break-emissive'),
};
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
/** 剝註解。⚠ 區塊註解**只剝行首那一種**(`//` 註解裡的 `server/**` 會被當成區塊起點) */
const code = (s) => s.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const die = (m) => { console.log(`x ${m}`); process.exit(1); };

const bioRaw = readSrc('public', 'js', 'biomes.js');
const toonSrc = readSrc('public', 'js', 'toon.js');
const postSrc = readSrc('public', 'js', 'postfx.js');

// ---- 壞版注入(字面替換;無效即 exit 1)----------------------------------------------
let bioSrc = bioRaw;
const brk = (re, to, tag) => {
  const before = bioSrc;
  bioSrc = bioSrc.replace(re, to);
  if (bioSrc === before) die(`--break-${tag} 的字面替換沒有生效(原文改了?)`);
};
if (BRK.rawmat) {
  // 壞版:結構區塊裡多一支**繞過 cel 入口**的原生材質(= 沒有 gInfo 宣告的那一種)
  brk(/(\r?\n\s*cm\.frustumCulled = false; cm\.userData\.noOutline = true;)/,
    '$1\n    const _dbgMat = new THREE.MeshBasicMaterial({ color: 0x4a4d47 });', 'rawmat');
}
if (BRK.contrib) {
  // 壞版:貢獻改成手寫常數(繞過 `inkRepeat` 推導縫)
  brk(/contrib: inkRepeat\(bandPitchM\(rail\)\)/, 'contrib: 0.5333', 'contrib');
}
if (BRK.surf) {
  // 壞版:坑門混凝土退回逐材質 `nextSurfId()`
  brk(/\s*surf: SURF_ID\.CONCRETE,?/g, '', 'surf');
}
if (BRK.emissive) {
  // 壞版:計畫 ⑨-5 明文禁止的那條路 —— 換淺一點的底色代替 emissive
  brk(/const stripeLit = envMat\(0xf2c230, \{ wash: 0\.2, cool: 0\.2, contrib: stripeCtr,\r?\n\s*emissive: new THREE\.Color\(0x6a5210\), emissiveIntensity: 0\.55 \}\);/,
    'const stripeLit = envMat(0xffe98a, { wash: 0.2, cool: 0.2, contrib: stripeCtr });', 'emissive');
}
const bioC = code(bioSrc);

// ---- 真品的推導縫(**執行 toon.js 原文**,MUST NOT 在本檔抄第二份公式)-----------------
const INK_LEVELS = Number(/export const INK_LEVELS = (\d+);/.exec(toonSrc)?.[1]);
if (!INK_LEVELS) die('抽不到 toon.js 的 INK_LEVELS(S1 契約改了?)');
const INK_TOP = INK_LEVELS - 1;
const quantSrc = /export const inkQuant = [^\n]+;/.exec(toonSrc)?.[0];
const repeatMSrc = /export const INK_REPEAT_M = [^\n]+;/.exec(toonSrc)?.[0];
const repeatSrc = /export const inkRepeat = [^\n]+;/.exec(toonSrc)?.[0];
if (!quantSrc || !repeatMSrc || !repeatSrc) die('抽不到 toon.js 的 inkQuant / INK_REPEAT_M / inkRepeat(S4 契約改了?)');
const strip = (s) => s.replace('export ', '');
const inkQuant = new Function('INK_TOP', `${strip(quantSrc)}\nreturn inkQuant;`)(INK_TOP);
const INK_REPEAT_M = new Function('SOLDIER_H', `${strip(repeatMSrc)}\nreturn INK_REPEAT_M;`)(SOLDIER_H);
const inkRepeat = new Function('inkQuant', 'INK_REPEAT_M',
  `${strip(repeatSrc)}\nreturn inkRepeat;`)(inkQuant, INK_REPEAT_M);
const INK_CONTRIB_NONE = Number(/export const INK_CONTRIB_NONE = ([\d.]+);/.exec(toonSrc)?.[1]);

// ---- 表面號的算術(同樣**解析真品**:LAND / CONCRETE / nextSurfId 的格)-----------------
const LAND_SURF_ID = Number(/const LAND_SURF_ID = ([\d.]+);/.exec(toonSrc)?.[1]);
const surfIdSrc = /export const SURF_ID = \{[^}]*\};/.exec(toonSrc)?.[0];
if (surfIdSrc == null || !Number.isFinite(LAND_SURF_ID)) die('抽不到 toon.js 的 SURF_ID / LAND_SURF_ID(S3 契約改了?)');
const SURF_ID = new Function('LAND_SURF_ID', `${strip(surfIdSrc)}\nreturn SURF_ID;`)(LAND_SURF_ID);
// id 門檻 **MUST 從 postfx.js 原文解析**(手寫 0.004 的話有人改了 postfx 這一條就靜默失效)
const idThr = [...postSrc.matchAll(/step\(\s*([\d.]+),\s*idv\s*\)/g)].map((m) => Number(m[1]));
if (!idThr.length) die('抽不到 postfx.js 勾線 pass 的 id 門檻 step( X, idv )');
const ID_THR = idThr[0];

// ---- 結構區塊(buildRoads → makeDeckIndex,含 planTowerBridgePads / buildTowerBridgePads)----
const R0 = bioC.indexOf('function buildRoads(');
const R1 = bioC.indexOf('export function makeDeckIndex(');
if (R0 < 0 || R1 <= R0) die('抽不到結構區塊(buildRoads → makeDeckIndex 的錨點改了?)');
const REG = bioC.slice(R0, R1);

/** 掃出區塊內每一支材質建構(cel 入口 + 平衡括號取引數原文)*/
const CALLS = [];
{
  const re = /\b(envMat|toonMat|toonPlain)\(/g;
  let m;
  while ((m = re.exec(REG))) {
    let i = m.index + m[0].length, d = 1;
    while (i < REG.length && d > 0) {
      const c = REG[i];
      if (c === '(') d++; else if (c === ')') d--;
      i++;
    }
    const args = REG.slice(m.index + m[0].length, i - 1);
    const col = args.split(',')[0].trim();
    CALLS.push({
      fn: m[1], args, col,
      ctr: /(?:^|[,{\s])contrib:\s*([^,}]+)/.exec(args)?.[1]?.trim() ?? null,
      surf: /(?:^|[,{\s])surf:\s*([^,}]+)/.exec(args)?.[1]?.trim() ?? null,
      emi: /(?:^|[,{\s])emissive:\s*([^,}]+)/.exec(args)?.[1]?.trim() ?? null,
    });
  }
}

// ============================================================ 授權表(凍結:順序 × 底色 × 授權)
// 「授權」欄三種值:
//   null                    = 維持預設 1。**MUST NOT 寫 `contrib: 1`** —— `inkQuant(1)` 嚴格
//                             === 1,寫進去只是把「推導值剛好是 1」偽裝成一個手寫常數。
//   'inkRepeat(…)' 之類     = 推導表達式,MUST 逐字相同(改了就是有人在這裡手動調線)
//   'INK_CONTRIB_NONE'      = 具名否決(唯一容許手寫的那一個)
// 「理由」欄不是註解而是**判準**:授權值是 null 的每一件,理由都要能回答「為什麼推導值是 1」。
const TABLE = [
  ['b.color', null, null, '路面:跨向節距 = 車道寬 ≫ INK_REPEAT_M'],
  ['0xf2edda', 'inkRepeat(bandPitchM(mark))', null, '標線:塗料不是構件,實測對距 0.18~0.56m'],
  ['0x8a867e', null, null, '避車道人行道:鋪面,緣石那條線是要的'],
  ['0xaab2b8', 'inkRepeat(bandPitchM(rail))', null, '欄杆緞帶:帶高 1.08m(計畫的「欄杆立柱 → 中等」)'],
  ['0x5c636a', 'inkRepeat(bandPitchM(girder))', null, '邊梁緞帶:帶高 1.0m,同一族的第二條'],
  ['0x565d64', null, null, '橋面底板:對距 = 橋寬 10~20m,橋腹輪廓是剪影'],
  ['0x8f8b83', null, null, '地下道擋土牆:帶高 = TUN.CLEAR + 0.5'],
  ['0x9a958c', null, 'SURF_ID.CONCRETE', '明隧道外露頂板:坑門混凝土家族'],
  ['0x8b8880', null, null, '引道緣石帶:帶寬 = UND.COPE'],
  ['0x938e85', 'inkRepeat(TUN.COL_GAP)', null, '明隧道柱列:唯一真正會變雜訊的重複構件'],
  ['0x4a4d47', null, null, '地下道天花板:整片頂面'],
  ['0x9a958c', null, null, '橫樑:洞內構件,MUST 維持逐材質號(它與拱頂之間的線是要的)'],
  ['0xece7d2', null, null, '天花照明:節距 12m;洞內最需要的一條輪廓'],
  ['0x9aa0a4', null, null, '高架橋墩身'],
  ['0x8f959a', null, null, '高架橋墩頂帽梁'],
  ['0x9a958c', null, 'SURF_ID.CONCRETE', '洞口 collar 漏斗裙:坑門混凝土家族'],
  ['0x9a958c', null, 'SURF_ID.CONCRETE', '門洞額牆 + 翼牆(lintel 就是「坑門冠石」的實際落點)'],
  ['0x0e1013', 'INK_CONTRIB_NONE', null, '洞口暗面:降級用的黑布幕,不是構造物'],
  ['0xf2c230', 'stripeCtr', null, '洞口警示條紋(亮格):節距 = stripeW'],
  ['0x1a1a1a', 'stripeCtr', null, '洞口警示條紋(暗格):同上'],
  ['0x8f959a', null, null, '砲塔墩座台'],
  ['0x9aa0a4', null, null, '砲塔墩座墩身'],
];

console.log('Ⅰ 結構區塊零原生材質(⑨-1 / ⑨-2:繞過 cel 入口 = 沒有 gInfo = 整批不畫而 console 無訊息)');
{
  const raw = REG.match(/new THREE\.(Mesh[A-Za-z]*|Raw)?(Shader)?Material\s*\(/g) || [];
  ok(raw.length === 0,
    `結構區塊(buildRoads → makeDeckIndex)零原生材質(實得 ${raw.length} 支;MUST 全部走 envMat/toonMat ⇒ gInfo 由 applyCelPatch 無條件寫出)`);
  ok(CALLS.length === TABLE.length,
    `結構材質 ${TABLE.length} 支逐支在授權表上(實得 ${CALLS.length} 支 —— 加第 ${TABLE.length + 1} 支 MUST 有人先做決定)`);
  ok(CALLS.every((c) => c.fn === 'envMat' || c.fn === 'toonMat' || c.fn === 'toonPlain'),
    '入口只有 cel 家族三支(envMat / toonMat / toonPlain)');
  // 這一條是「⑨-1 改走新版 cel()」的**構造保證**:結構端一行都不必改,材質換學派是
  // toon.js 那一側的推論 —— 只要沒有人在這裡自己建材質。
  ok(!/new THREE\.ShaderMaterial|onBeforeCompile/.test(REG),
    '結構區塊 MUST NOT 自寫 ShaderMaterial 或就地補 onBeforeCompile(那會繞過 INK_INFO_DECL;逐檔掃描住 audit_cel_pipeline Ⅵ,本條只擋這一區)');
}

console.log('\nⅡ 貢獻授權(⑨-3;S4:推導不手寫,唯一容許手寫的是具名否決值)');
{
  // ---- a 逐件比對:順序 × 底色 × 授權 ----
  let colOk = 0, ctrOk = 0;
  CALLS.forEach((c, i) => {
    const t = TABLE[i];
    if (!t) return;
    if (c.col === t[0]) colOk++;
    if ((c.ctr ?? null) === t[1]) ctrOk++;
  });
  ok(colOk === TABLE.length, `逐件底色對得上授權表(${colOk}/${TABLE.length};對不上 = 有人插了一支材質或換了底色)`);
  ok(ctrOk === TABLE.length, `逐件授權值對得上授權表(${ctrOk}/${TABLE.length})`);
  // ---- b 預設那一批 MUST NOT 手寫 `contrib: 1` ----
  const wrote1 = CALLS.filter((c, i) => TABLE[i] && TABLE[i][1] === null && c.ctr !== null);
  ok(wrote1.length === 0,
    `推導值本來就是 1 的 ${TABLE.filter((t) => t[1] === null).length} 件 MUST 維持預設(實得 ${wrote1.length} 件手寫;inkQuant(1) 嚴格 === 1 ⇒ 寫進去是把推導偽裝成常數)`);
  // ---- c RHS 一律是推導縫或具名否決(這一條才是「不手寫」的硬閘)----
  const resolve = (rhs) => {
    if (/^(inkRepeat|inkCtrM)\s*\(/.test(rhs) || rhs === 'INK_CONTRIB_NONE') return rhs;
    // 一層具名中繼(兩支材質共用同一個算出來的值 ⇒ 提成 const 是對的)
    const def = new RegExp(`const ${rhs.replace(/[^\w$]/g, '')} = ([^;]+);`).exec(REG)?.[1]?.trim();
    return def || rhs;
  };
  const bad = CALLS.filter((c) => c.ctr !== null)
    .map((c) => ({ c, r: resolve(c.ctr) }))
    .filter(({ r }) => !(/^(inkRepeat|inkCtrM)\s*\(/.test(r) || r === 'INK_CONTRIB_NONE'));
  ok(bad.length === 0,
    `每一個授權值 MUST 由 inkRepeat() / inkCtrM() 推導,或是具名否決 INK_CONTRIB_NONE(實得 ${bad.length} 個手寫:${bad.map((b) => `${b.c.col}→${b.c.ctr}`).join(' ') || '—'})`);
  ok(!/contrib:\s*[\d.]/.test(REG), '結構區塊 MUST NOT 出現字面數字的 contrib(名冊會在加構件時靜默過期)');
  // ---- d 值域:16 階之一 ----
  const vals = [inkRepeat(0.18), inkRepeat(0.56), inkRepeat(1.0), inkRepeat(1.08), inkRepeat(4.5), INK_CONTRIB_NONE];
  ok(vals.every((v) => Number.isFinite(v) && v >= 0 && v <= 1 && Math.abs(v * INK_TOP - Math.round(v * INK_TOP)) < 1e-9),
    `授權值恆落在 k/${INK_TOP}(§0-c 的低半位元組只有 ${INK_LEVELS} 階;不量化就與編碼端的 round 對不上)`);
  ok(inkQuant(1) === 1, 'inkQuant(1) 嚴格 === 1(預設那一批「逐位元同舊制」的證明面)');
  // ---- e 語意:緞帶族 < 1、柱列今天恰 1、越密越淡 ----
  ok(inkRepeat(1.08) > 0 && inkRepeat(1.08) < 1,
    `欄杆帶高 1.08m ⇒ 貢獻 ${inkRepeat(1.08).toFixed(4)} ∈ (0,1)(計畫要的「中等」;0 = 橋整個沒有線,1 = 沒做)`);
  ok(inkRepeat(0.56) < inkRepeat(1.08),
    '越密的帶越淡(標線 0.56m < 欄杆 1.08m ⇒ 推導是單調的,不是逐款挑的)');
  const colGap = Number(/COL_GAP: ([\d.]+)/.exec(bioC)?.[1]);
  ok(Number.isFinite(colGap) && inkRepeat(colGap) === 1,
    `柱距 ${colGap}m ≥ INK_REPEAT_M ${INK_REPEAT_M}m ⇒ 今天恰為 1 = 舊制(把柱距收到 3.6m 以下它會自己讓步)`);
  ok(inkCtrM(INK_CTR.FULL_M) === 1 && inkCtrM(INK_CTR.NONE_M) === 0,
    '尺寸軸那一支(inkCtrM)兩端的定義沒有被動過(本區暫無消費端,但它是 S4 的另一半)');
  // ---- f `bandPitchM` 行為直測(抽真品原文執行)----
  const bp0 = bioC.indexOf('const bandPitchM = (b) =>');
  const bp1 = bioC.indexOf('return m;\n  };', bp0);
  if (bp0 < 0 || bp1 < 0) die('抽不到 bandPitchM 原文(⑨-3 的量尺)');
  const bandPitchM = new Function(`${bioC.slice(bp0, bp1 + 14)}\nreturn bandPitchM;`)();
  // 緞帶:同一 (x,z) 的下緣與上緣成對推入;其中一對被地表夾成退化(引道口的邊梁)
  const ribbon = { pos: [0, 0, 0, 0, 1.08, 0, 5, 2, 0, 5, 3.08, 0, 9, 4, 0, 9, 4, 0] };
  ok(Math.abs(bandPitchM(ribbon) - 1.08) < 1e-9,
    `緞帶帶高量得對(實得 ${bandPitchM(ribbon).toFixed(4)}m)`);
  ok(bandPitchM({ pos: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1.08, 0] }) > 0,
    '退化對(邊梁被地表夾住的那幾段)MUST NOT 把結果拉成 0 —— 取 max 不是 min(取 min = 整條邊梁的墨線一起消失,而畫面上只是「橋腹沒有線」)');
  ok(bandPitchM({ pos: [] }) === 0 && inkRepeat(bandPitchM({ pos: [] })) === 0,
    '空桶回 0(那一桶根本沒有幾何 ⇒ 沒有線要畫;不會回 NaN 把整個貢獻打成 NaN)');
  ok(!/\brnd\s*\(|Math\.random/.test(bioC.slice(bp0, bp1)), 'bandPitchM 零亂數(§2.3)');
}

console.log('\nⅢ 坑門混凝土家族共用具名號(⑨-4;同一座構造物內部 MUST NOT 出線)');
{
  const withSurf = CALLS.filter((c) => c.surf !== null);
  ok(withSurf.length === 3 && withSurf.every((c) => c.surf === 'SURF_ID.CONCRETE'),
    `恰三處吃具名號(額牆/翼牆 + collar + 外露頂板;實得 ${withSurf.length} 處)`);
  ok(withSurf.every((c) => c.col === '0x9a958c'),
    '三處 MUST 是同一個底色(它們在現實中就是同一座構造物 —— 註解自己寫了)');
  // 洞內構件維持逐材質號:同色的橫樑刻意**不收**(拱頂 / 樑 / 柱之間的線是要的)
  const beams = CALLS.filter((c) => c.col === '0x9a958c' && c.surf === null);
  ok(beams.length === 1,
    `同色但**不吃**具名號的 MUST 恰一支 = 洞內橫樑(實得 ${beams.length} 支;收進同一族 = 洞內只剩法線折邊,柱與矮牆那種近乎共面的界線整段消失)`);
  // 號的算術:與地貌、與逐材質號都跨得過門檻
  ok(Math.abs(SURF_ID.CONCRETE - SURF_ID.LAND) > ID_THR,
    `混凝土(${SURF_ID.CONCRETE}) 與地貌(${SURF_ID.LAND})的差 ${Math.abs(SURF_ID.CONCRETE - SURF_ID.LAND).toFixed(6)} > 門檻 ${ID_THR}(⇒ 坑門↔上方山坡那條線照樣出得來)`);
  const halfGrid = [...Array(64).keys()].map((k) => (k + 0.5) / 64);   // nextSurfId 的值域
  ok(halfGrid.every((v) => Math.abs(v - SURF_ID.CONCRETE) > ID_THR),
    '具名號與 nextSurfId 的半整數格恆不撞號(撞號 = 別處少一條該有的線,而且逐場地不同)');
  ok(/const nextSurfId = \(surfaceKey = null\) => \{[\s\S]*?SURF_ID\.OVERFLOW[\s\S]*?% SURF_SLOT_N/.test(toonSrc),
    'nextSurfId 是穩定鍵值配號 + 半整數格，耗盡後不回繞(這一條一變,上面那個不撞號的推論就要重算)');
  ok(/if \(land\) mat\.userData\.celSurfId = LAND_SURF_ID;/.test(toonSrc)
    && toonSrc.indexOf('if (land) mat.userData.celSurfId = LAND_SURF_ID;') < toonSrc.indexOf('else if (surf != null)'),
    '地貌恆勝出(三分支順序 land → surf → nextSurfId;反過來的話同時傳兩個時地貌會掉出共用號)');
}

console.log('\nⅣ 底色逐位元凍結 + 提亮只准由 emissive 提供(⑨-5)');
{
  // 九個底色(計畫 ⑨-5 點名的那一組)MUST 逐位元不動 —— 換底色的症狀是「白天整條發白」
  const FROZEN = ['0x8f8b83', '0x4a4d47', '0x9a958c', '0x938e85', '0x8b8880', '0x0e1013', '0xf2c230', '0x1a1a1a', '0xece7d2'];
  const cols = CALLS.map((c) => c.col);
  const miss = FROZEN.filter((h) => !cols.includes(h));
  ok(miss.length === 0, `九個結構底色逐位元不動(缺 ${miss.join(' ') || '無'})`);
  // 提亮只准由 emissive 提供,而且只有兩處(洞口反光帶的亮格 + 天花燈)
  const lit = CALLS.filter((c) => c.emi !== null);
  ok(lit.length === 2 && lit.every((c) => c.col === '0xf2c230' || c.col === '0xece7d2'),
    `洞內/洞口的提亮只准由 emissive 提供,而且恰兩處(實得 ${lit.length} 處:${lit.map((c) => c.col).join(' ')})`);
  const stripeLit = CALLS.find((c) => c.col === '0xf2c230');
  ok(!!stripeLit && stripeLit.emi === 'new THREE.Color(0x6a5210)' && /emissiveIntensity: 0\.55/.test(stripeLit.args),
    '洞口警示條紋的亮格帶 emissive(黑格不帶 —— 反光帶的語意就是「亮的那一半」)');
  ok(CALLS.some((c) => c.col === '0x1a1a1a' && c.emi === null), '暗格 MUST NOT 跟著發光');
  // 兩支材質提到 stripe 迴圈外:舊制逐格各建一支 ⇒ 48 座洞口 × 8 格 = 384 支材質沖爛 64 個 surfId 槽
  ok(/const stripeLit = envMat\(/.test(REG) && /const stripeDark = envMat\(/.test(REG)
    && REG.indexOf('const stripeLit = envMat(') < REG.indexOf('for (let si = 0; si < stripeN; si++)'),
    '條紋的兩支材質 MUST 提到 stripe 迴圈之外(逐格各建一支 = 每座洞口 8 支、全圖最多 384 支,而 nextSurfId 只有 64 個槽)');
  // 天花燈:一行都不改(它早就是 emissive、早就是 InstancedMesh)
  const lamp = CALLS.find((c) => c.col === '0xece7d2');
  ok(!!lamp && lamp.fn === 'toonMat' && /emissiveIntensity: 0\.9/.test(lamp.args),
    '天花燈逐位元不動(MUST NOT 為了「洞內太暗」調高它的強度 —— 處方是「亮的東西自己亮」,不是整體提亮)');
}

console.log('\nⅤ 線工授權與材質發射區塊零共享 rnd 消耗(§2.3)');
{
  const M0 = bioC.indexOf('const bandPitchM = (b) =>');
  if (M0 < 0) die('抽不到材質發射區塊的起點');
  const MAT = bioC.slice(M0, R1);
  ok(!/\brnd\s*\(/.test(MAT),
    '本輪動到的整段(線工授權 + 22 支材質 + 門洞/條紋)零 `rnd()`(抽一枚就把後面每一株植被、每一棟建物的佈局整條推移,而畫面上只表現成「整張圖變了」)');
  ok(!/Math\.random\s*\(/.test(MAT), '零 Math.random(A4)');
  ok(!/\bsurfGroup\s*\(/.test(REG),
    '結構走的是**具名**號(SURF_ID.CONCRETE)不是 surfGroup() 的循環號 —— 兩者都零亂數,但坑門是一個「類別」不是一個「實例」');
}

console.log(`\n${fail ? '❌' : '✅'} 立體結構線工稽核:通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail ? 1 : 0);
