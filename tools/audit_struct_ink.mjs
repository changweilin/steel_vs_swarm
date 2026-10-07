// ============ Solid-structure ink authorization / portal surface groups / portal reflector bands (order 12b item 9) ============
// 2026-08-16. Offline guard for plan section 9 Solid-structure re-render. First sentence of 9 is frozen: existing tech stays untouched
// Geometry / collision / slab / decks / cols / corridors / tunFloorAt / underpassPlan / strucHw /
// tunRoofTop / tunnelWallProfile all stay byte-identical; this round touches only material and shading layers. That half is guarded by seven existing audits
// (audit_open_tunnel / audit_underpass / audit_layer_block / audit_road_joint /
// audit_road_bed / audit_bridge_* / audit_water_skirt); any of them going red means
// a visual change leaked into geometry; this audit only checks whether the material layer follows the rules.
//
// Why these five fail silently (= reason this audit exists):
//   9-1/9-2 Material bypassing the cel entry means no gInfo declaration, so the whole batch is not drawn with zero console output.
//            WebGL2 rule: enabled draw buffer with no matching output is INVALID_OPERATION,
//            and it throws no exception and no warning -- visually the whole tunnel disappears. Today all 22 structure materials go through
//            envMat/toonMat so gInfo is unconditionally emitted by applyCelPatch, so these two items are zero-change;
//            guard that nobody adds new THREE.MeshBasicMaterial here in the future.
//            Warning: this audit MUST NOT duplicate the per-file scan of audit_cel_pipeline VI for self-written ShaderMaterial gInfo declaration
//            (same rule in two implementations will diverge); that audit asks whether declared, this audit asks
//            whether this structure zone bypasses the cel entry, which is a harder layer (no bypass means no need to ask about declaration).
//   9-3      Contribution (outlineContribution) handwritten numbers: roster silently expires when parts are added, showing only
//            as thinner lines on one variant. Rule is S4 -- caller MUST pass spacing or size already computed while laying out parts;
//            the only allowed handwritten value is the named veto INK_CONTRIB_NONE.
//   9-4     Portal concrete (parapet / wing walls / collar / exposed roof slab) each drawing one nextSurfId means
//            the id channel of INK_MRT draws lines inside the same structure. After sharing the named id, lines shrink to the outer edge,
//            while the concrete-to-hillside line above still renders via SURF_ID.LAND = 0.
//   9-5     Fixing dark interiors by swapping to a lighter base color: frozen rule is that dark cavities need emissive,
//            not a lighter base color (vending-machine pickup lesson), while swapping base color turns the whole tunnel white in daylight.
//
// Sections:
//   I Zero native materials in structure block (gate for 9-1 / 9-2) + 22 materials each through cel entry
//   II Contribution authorization table: order x base-color x authorization frozen + RHS always derived + values in k/15 + bandPitchM behavior test
//   III Portal concrete shares named id + id gap clears postfx parsed threshold + interior parts keep per-material ids
//   IV Base colors frozen bitwise + brightening only via emissive
//   V Ink authorization and material emission block zero shared rnd consumption (section 2.3)
//
// Reverse verification (section 0 principle 9; literal replacement tolerates CRLF with CR LF pattern, failed replacement MUST exit 1;
// expected values MUST NOT change with --break-*):
//   --break-rawmat    one extra native material in structure block => I MUST go red
//   --break-contrib   railing contribution changed to handwritten constant (bypassing derivation seam) => II MUST go red with 2 failures
//   --break-surf      three surf: SURF_ID.CONCRETE removed => III MUST go red
//   --break-emissive  yellow cells changed to lighter base color with emissive removed => IV MUST go red with 2 failures
import { readSrc } from './audit_src.mjs';
import { SOLDIER_H, INK_CTR, inkCtrM } from '../public/js/data.js';

const A = process.argv.slice(2);
const BRK = {
  rawmat: A.includes('--break-rawmat'), contrib: A.includes('--break-contrib'),
  surf: A.includes('--break-surf'), emissive: A.includes('--break-emissive'),
};
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
/** Strip comments. Warning: block comments only strip the line-leading form (a server marker inside a line comment would be taken as block start) */
const code = (s) => s.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const die = (m) => { console.log(`x ${m}`); process.exit(1); };

const bioRaw = readSrc('public', 'js', 'biomes.js');
const toonSrc = readSrc('public', 'js', 'toon.js');
const postSrc = readSrc('public', 'js', 'postfx.js');

// ---- Bad-version injection (literal replacement; no-op means exit 1) ----------------------------------------------
let bioSrc = bioRaw;
const brk = (re, to, tag) => {
  const before = bioSrc;
  bioSrc = bioSrc.replace(re, to);
  if (bioSrc === before) die(`--break-${tag} 的字面替換沒有生效(原文改了?)`);
};
if (BRK.rawmat) {
  // Bad version: one extra native material in structure block bypassing the cel entry (the kind with no gInfo declaration)
  brk(/(\r?\n\s*cm\.frustumCulled = false; cm\.userData\.noOutline = true;)/,
    '$1\n    const _dbgMat = new THREE.MeshBasicMaterial({ color: 0x4a4d47 });', 'rawmat');
}
if (BRK.contrib) {
  // Bad version: contribution changed to handwritten constant (bypassing inkRepeat derivation seam)
  brk(/contrib: inkRepeat\(bandPitchM\(rail\)\)/, 'contrib: 0.5333', 'contrib');
}
if (BRK.surf) {
  // Bad version: portal concrete falls back to per-material nextSurfId
  brk(/\s*surf: SURF_ID\.CONCRETE,?/g, '', 'surf');
}
if (BRK.emissive) {
  // Bad version: the path explicitly forbidden by plan item 9-5 -- lighter base color instead of emissive
  brk(/const stripeLit = envMat\(0xf2c230, \{ wash: 0\.2, cool: 0\.2, contrib: stripeCtr,\r?\n\s*emissive: new THREE\.Color\(0x6a5210\), emissiveIntensity: 0\.55 \}\);/,
    'const stripeLit = envMat(0xffe98a, { wash: 0.2, cool: 0.2, contrib: stripeCtr });', 'emissive');
}
const bioC = code(bioSrc);

// ---- Genuine derivation seam (execute toon.js original text, MUST NOT copy a second formula in this file) -----------------
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

// ---- Surface-id arithmetic (also parse the genuine article: grid of LAND / CONCRETE / nextSurfId) -----------------
const LAND_SURF_ID = Number(/const LAND_SURF_ID = ([\d.]+);/.exec(toonSrc)?.[1]);
const surfIdSrc = /export const SURF_ID = \{[^}]*\};/.exec(toonSrc)?.[0];
if (surfIdSrc == null || !Number.isFinite(LAND_SURF_ID)) die('抽不到 toon.js 的 SURF_ID / LAND_SURF_ID(S3 契約改了?)');
const SURF_ID = new Function('LAND_SURF_ID', `${strip(surfIdSrc)}\nreturn SURF_ID;`)(LAND_SURF_ID);
// id threshold MUST be parsed from postfx.js original text (hardcoding 0.004 silently breaks when postfx changes)
const idThr = [...postSrc.matchAll(/step\(\s*([\d.]+),\s*idv\s*\)/g)].map((m) => Number(m[1]));
if (!idThr.length) die('抽不到 postfx.js 勾線 pass 的 id 門檻 step( X, idv )');
const ID_THR = idThr[0];

// ---- Structure block (buildRoads to makeDeckIndex, includes planTowerBridgePads / buildTowerBridgePads) ----
const R0 = bioC.indexOf('function buildRoads(');
const R1 = bioC.indexOf('export function makeDeckIndex(');
if (R0 < 0 || R1 <= R0) die('抽不到結構區塊(buildRoads → makeDeckIndex 的錨點改了?)');
const REG = bioC.slice(R0, R1);

/** Scan every material construction in the block (cel entry + balanced-paren argument text) */
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

// ============================================================ Authorization table (frozen: order x base color x authorization)
// Authorization column has three forms:
//   null                    = keep default 1. MUST NOT write contrib: 1 -- inkQuant(1) is strictly
//                             === 1, writing it disguises a derived value of 1 as a handwritten constant.
//   inkRepeat-style         = derived expression, MUST match character-for-character (any change means manual line tuning here)
//   INK_CONTRIB_NONE        = named veto (the only allowed handwritten value)
// Reason column is a criterion not a note: every null-authorization entry must answer why the derived value is 1.
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
  // Structural guarantee for 9-1 moving to the new cel entry: structure side needs no change; shading-school swap is inferred
  // on the toon.js side -- as long as nobody builds a material here directly.
  ok(!/new THREE\.ShaderMaterial|onBeforeCompile/.test(REG),
    '結構區塊 MUST NOT 自寫 ShaderMaterial 或就地補 onBeforeCompile(那會繞過 INK_INFO_DECL;逐檔掃描住 audit_cel_pipeline Ⅵ,本條只擋這一區)');
}

console.log('\nⅡ 貢獻授權(⑨-3;S4:推導不手寫,唯一容許手寫的是具名否決值)');
{
  // ---- a Per-item match: order x base color x authorization ----
  let colOk = 0, ctrOk = 0;
  CALLS.forEach((c, i) => {
    const t = TABLE[i];
    if (!t) return;
    if (c.col === t[0]) colOk++;
    if ((c.ctr ?? null) === t[1]) ctrOk++;
  });
  ok(colOk === TABLE.length, `逐件底色對得上授權表(${colOk}/${TABLE.length};對不上 = 有人插了一支材質或換了底色)`);
  ok(ctrOk === TABLE.length, `逐件授權值對得上授權表(${ctrOk}/${TABLE.length})`);
  // ---- b Default batch MUST NOT hand-write contrib: 1 ----
  const wrote1 = CALLS.filter((c, i) => TABLE[i] && TABLE[i][1] === null && c.ctr !== null);
  ok(wrote1.length === 0,
    `推導值本來就是 1 的 ${TABLE.filter((t) => t[1] === null).length} 件 MUST 維持預設(實得 ${wrote1.length} 件手寫;inkQuant(1) 嚴格 === 1 ⇒ 寫進去是把推導偽裝成常數)`);
  // ---- c RHS is always a derivation seam or named veto (the hard gate for no hand-writing) ----
  const resolve = (rhs) => {
    if (/^(inkRepeat|inkCtrM)\s*\(/.test(rhs) || rhs === 'INK_CONTRIB_NONE') return rhs;
    // One named intermediate: two materials share one computed value, so hoisting to const is correct
    const def = new RegExp(`const ${rhs.replace(/[^\w$]/g, '')} = ([^;]+);`).exec(REG)?.[1]?.trim();
    return def || rhs;
  };
  const bad = CALLS.filter((c) => c.ctr !== null)
    .map((c) => ({ c, r: resolve(c.ctr) }))
    .filter(({ r }) => !(/^(inkRepeat|inkCtrM)\s*\(/.test(r) || r === 'INK_CONTRIB_NONE'));
  ok(bad.length === 0,
    `每一個授權值 MUST 由 inkRepeat() / inkCtrM() 推導,或是具名否決 INK_CONTRIB_NONE(實得 ${bad.length} 個手寫:${bad.map((b) => `${b.c.col}→${b.c.ctr}`).join(' ') || '—'})`);
  ok(!/contrib:\s*[\d.]/.test(REG), '結構區塊 MUST NOT 出現字面數字的 contrib(名冊會在加構件時靜默過期)');
  // ---- d Value range: one of 16 levels ----
  const vals = [inkRepeat(0.18), inkRepeat(0.56), inkRepeat(1.0), inkRepeat(1.08), inkRepeat(4.5), INK_CONTRIB_NONE];
  ok(vals.every((v) => Number.isFinite(v) && v >= 0 && v <= 1 && Math.abs(v * INK_TOP - Math.round(v * INK_TOP)) < 1e-9),
    `授權值恆落在 k/${INK_TOP}(§0-c 的低半位元組只有 ${INK_LEVELS} 階;不量化就與編碼端的 round 對不上)`);
  ok(inkQuant(1) === 1, 'inkQuant(1) 嚴格 === 1(預設那一批「逐位元同舊制」的證明面)');
  // ---- e Semantics: ribbon family below 1, column row exactly 1 today, denser means fainter ----
  ok(inkRepeat(1.08) > 0 && inkRepeat(1.08) < 1,
    `欄杆帶高 1.08m ⇒ 貢獻 ${inkRepeat(1.08).toFixed(4)} ∈ (0,1)(計畫要的「中等」;0 = 橋整個沒有線,1 = 沒做)`);
  ok(inkRepeat(0.56) < inkRepeat(1.08),
    '越密的帶越淡(標線 0.56m < 欄杆 1.08m ⇒ 推導是單調的,不是逐款挑的)');
  const colGap = Number(/COL_GAP: ([\d.]+)/.exec(bioC)?.[1]);
  ok(Number.isFinite(colGap) && inkRepeat(colGap) === 1,
    `柱距 ${colGap}m ≥ INK_REPEAT_M ${INK_REPEAT_M}m ⇒ 今天恰為 1 = 舊制(把柱距收到 3.6m 以下它會自己讓步)`);
  ok(inkCtrM(INK_CTR.FULL_M) === 1 && inkCtrM(INK_CTR.NONE_M) === 0,
    '尺寸軸那一支(inkCtrM)兩端的定義沒有被動過(本區暫無消費端,但它是 S4 的另一半)');
  // ---- f bandPitchM behavior direct test (executes genuine source text) ----
  const bp0 = bioC.indexOf('const bandPitchM = (b) =>');
  const bp1 = bioC.indexOf('return m;\n  };', bp0);
  if (bp0 < 0 || bp1 < 0) die('抽不到 bandPitchM 原文(⑨-3 的量尺)');
  const bandPitchM = new Function(`${bioC.slice(bp0, bp1 + 14)}\nreturn bandPitchM;`)();
  // Ribbon: lower and upper edges at the same x,z enter as pairs; one pair is pinched degenerate by terrain at the approach girder
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
  // Interior parts keep per-material ids: same-color cross beam is deliberately excluded because vault-beam-column lines must stay
  const beams = CALLS.filter((c) => c.col === '0x9a958c' && c.surf === null);
  ok(beams.length === 1,
    `同色但**不吃**具名號的 MUST 恰一支 = 洞內橫樑(實得 ${beams.length} 支;收進同一族 = 洞內只剩法線折邊,柱與矮牆那種近乎共面的界線整段消失)`);
  // Id arithmetic: gaps to terrain and to per-material ids both clear the threshold
  ok(Math.abs(SURF_ID.CONCRETE - SURF_ID.LAND) > ID_THR,
    `混凝土(${SURF_ID.CONCRETE}) 與地貌(${SURF_ID.LAND})的差 ${Math.abs(SURF_ID.CONCRETE - SURF_ID.LAND).toFixed(6)} > 門檻 ${ID_THR}(⇒ 坑門↔上方山坡那條線照樣出得來)`);
  const halfGrid = [...Array(64).keys()].map((k) => (k + 0.5) / 64);   // Value range of nextSurfId
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
  // Nine base colors named by plan 9-5 MUST stay bitwise identical -- swapping base color turns the whole run white in daylight
  const FROZEN = ['0x8f8b83', '0x4a4d47', '0x9a958c', '0x938e85', '0x8b8880', '0x0e1013', '0xf2c230', '0x1a1a1a', '0xece7d2'];
  const cols = CALLS.map((c) => c.col);
  const miss = FROZEN.filter((h) => !cols.includes(h));
  ok(miss.length === 0, `九個結構底色逐位元不動(缺 ${miss.join(' ') || '無'})`);
  // Brightening only via emissive, exactly two places: portal reflector bright cell plus ceiling lamp
  const lit = CALLS.filter((c) => c.emi !== null);
  ok(lit.length === 2 && lit.every((c) => c.col === '0xf2c230' || c.col === '0xece7d2'),
    `洞內/洞口的提亮只准由 emissive 提供,而且恰兩處(實得 ${lit.length} 處:${lit.map((c) => c.col).join(' ')})`);
  const stripeLit = CALLS.find((c) => c.col === '0xf2c230');
  ok(!!stripeLit && stripeLit.emi === 'new THREE.Color(0x6a5210)' && /emissiveIntensity: 0\.55/.test(stripeLit.args),
    '洞口警示條紋的亮格帶 emissive(黑格不帶 —— 反光帶的語意就是「亮的那一半」)');
  ok(CALLS.some((c) => c.col === '0x1a1a1a' && c.emi === null), '暗格 MUST NOT 跟著發光');
  // Both materials are hoisted outside the stripe loop: old regime built one per cell, 48 portals x 8 cells = 384 materials overflowing 64 surfId slots
  ok(/const stripeLit = envMat\(/.test(REG) && /const stripeDark = envMat\(/.test(REG)
    && REG.indexOf('const stripeLit = envMat(') < REG.indexOf('for (let si = 0; si < stripeN; si++)'),
    '條紋的兩支材質 MUST 提到 stripe 迴圈之外(逐格各建一支 = 每座洞口 8 支、全圖最多 384 支,而 nextSurfId 只有 64 個槽)');
  // Ceiling lamp: change no line here; it is already emissive and already InstancedMesh
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
