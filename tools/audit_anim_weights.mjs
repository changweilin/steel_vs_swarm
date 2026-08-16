// ============ 動畫權重向量稽核(⑥-3;`public/js/animweights.js` 唯一縫)============
// 用途:改 `animweights.js`、`locomotion.js` 的收尾寫入、或 `game.js` 的移動環境音消費端
// 之後跑這一支。跑法:`node tools/audit_anim_weights.mjs`
// 反向驗證:`--break-second` / `--break-thresh` / `--break-sum` / `--break-gate` / `--break-hand`
//
// ── 為什麼要有這支(2026-08-16,`docs/anime_style_plan.md` ⑥-3)──────────────
// 落地前「這台機體現在在做什麼」有三份互相矛盾的答案:
//   ① 速度:`locomotion.js` 的 `L.speed`(位移差分 + 阻尼)vs `game.js` 的 `ent._moveSpd`
//      (未阻尼、吃 8Hz 插值鋸齒,`* 0.6` 還是逐幀常數 = 幀率相依 —— 序 2 漏掉的一處)。
//   ② 離地:換樹 `MORPH.GROUND_Y` = 2 / 觀戰取景 `SPEC_CAM.FLY_M` = 2.5 / 環境音寫死的 3。
//      2~3m 之間機體已經是飛行型而音床還在踏地。
//   ③ 「他在不在動」:`_updateMoveAudio` 自己又寫了一條 `moveGate` 速度曲線。
// 三者都**沒有任何錯誤訊息**,也沒有任何既有斷言會紅 —— 每一份單看都是對的。
//
// 驗的七件事(Ⅶ 於 2026-08-16 第二輪追加:⑤-1 的餵入端與本檔是**同一個病灶的兩半** ——
// 「這台現在動多快」在這個儲存庫裡已經被推導過三次,第四次會長在植被擾動上):
//   Ⅰ **縫只有一份**:`animWeights` 恰一份宣告、恰兩個呼叫端(locomotion 的 `L.w` 與
//     game 的 `this._selfW`);`_moveSpd` 那份速度推導 MUST 已整行消失。
//   Ⅱ **離地門檻只有一份、而且是注入的**(行為證明:換一個 `groundY`,0.5 的跨越點
//     跟著搬 —— 寫死的話搬不動,而每一條原文斷言都會過)。
//   Ⅲ **數學**:地面三軌和恆為 1、缺欄回 0 不回 NaN、鍵集逐位元 = `WEIGHT_KEYS`。
//   Ⅳ **消費端**(行為直測):`ent.loco` 在重生瞬移那一幀是 `null` ⇒ 沒有守衛就是
//     NaN 進 `AudioParam.setTargetAtTime`、**把整條 requestAnimationFrame 迴圈打斷**
//     (畫面凍結,而錯誤看起來像音效壞了)。這一段真的把 `_updateMoveAudio` 的原文
//     丟進 `new Function` 跑一次,餵 `w = null`,量它交出去的每一個數。
//   Ⅴ **鍵集推導不手寫**:模組內 MUST NOT 出現逐機種 / 逐角色名冊(同 A33 ⑤);
//     消費端讀的每一個鍵 MUST ∈ `WEIGHT_KEYS`。
//   Ⅵ **模組邊界**:零 import、不吃 dt、零第二份阻尼(它讀的是別人阻尼過的量)。
//   Ⅶ **⑤-1 植被擾動的餵入端**(`game._charSlots()` → `toon.setCelChar`):速率 MUST 取自
//     **既有的**兩條阻尼縫(他機 `ent.loco.speed` / 自機 `_stepSelfWeights` 的 `_selfSpd`),
//     MUST NOT 在這裡再差分一次(那就是 `_moveSpd` 換個名字回來,而兩份速度的差別只表現成
//     「草被撥開的時機跟腳步聲對不上」);也 MUST NOT 拿 `this.vel`(攀爬 / push-out /
//     蓄力跳三條路徑都不經過它 ⇒ 「爬梯子時腳邊的草在被撥開」)。另兩條有行為證明:
//     餵入 MUST 排在 `_updateEnts` **之後**(早一步拿到的是上一幀的插值位置),
//     `?tread=0` MUST 交出**空陣列**(而不是「填了但速度是 0」——後者仍逐槽算 length())。
import { readSrc, grabMethod, grabConst } from './audit_src.mjs';

const ARGS = process.argv.slice(2);
const BRK = (n) => ARGS.includes(`--break-${n}`);
const B_SECOND = BRK('second'), B_THRESH = BRK('thresh'), B_SUM = BRK('sum');
const B_GATE = BRK('gate'), B_HAND = BRK('hand');
const B_TREAD = BRK('tread'), B_CHARSPD = BRK('charspd'), B_CHARORDER = BRK('charorder');

let pass = 0, fail = 0;
const ok = (c, name, extra = '') => {
  if (c) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};
const sec = (t) => console.log(`\n▍${t}`);
const count = (s, re) => (s.match(re) || []).length;
// 剝註解:這幾條規則本身就寫在註解裡引用那些舊寫法(`_moveSpd`、`> 3`),
// 不剝的話規則的說明會把自己判成違規,而且是永遠修不掉的那種紅字。
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
/** 字面替換:無效 MUST 當場失敗(§5.4 ㋑ —— 靜默 no-op 的 break 永遠是綠的)*/
const bust = (src, re, to, tag) => {
  const out = src.replace(re, to);
  if (out === src) {
    console.log(`✗ --break-${tag}:字面替換無效(原文已變 ⇒ 這支 break 根本沒造出壞版)`);
    process.exit(1);
  }
  return out;
};

let weightSrc = readSrc('public', 'js', 'animweights.js');
let gameSrc = readSrc('public', 'js', 'game.js');
const locoSrc = readSrc('public', 'js', 'locomotion.js');
// `CHAR` 是 S5 的契約(槽數是**成本預算常數**)—— 從 toon.js 抽真品原文,MUST NOT 在這裡
// 抄一份數字(抄了之後 lane-ink 改 N,這一支照樣綠而遊戲端已經多算了兩槽的 length())。
const CHAR = new Function(`${grabConst(readSrc('public', 'js', 'toon.js'), 'CHAR')}\nreturn CHAR;`)();

// ── 壞版注入(原文層;讀取端與執行端吃的是同一份文字)──────────────────────
if (B_SECOND) {
  gameSrc = bust(gameSrc, /( {6}cur\.set\(nx, ny, nz\);)/,
    '$1\r?\n      ent._moveSpd = (!snapped && dt > 0) ? Math.hypot(nx - px, nz - pz) / dt : (ent._moveSpd || 0) * 0.6;'
      .replace('\\r?\\n', '\n'), 'second');
}
if (B_THRESH) {
  gameSrc = bust(gameSrc, /\(ent\.loco\?\.w\?\.air \|\| 0\) > 0\.5/, '(ent.heroY || 0) > 3', 'thresh');
}
if (B_GATE) {
  gameSrc = bust(gameSrc, /const moveGate = floor \+ \(1 - floor\) \* mv;/,
    'const moveGate = cl(0.35 + b.spd * 0.09, 0.35, 1);', 'gate');
}
if (B_SUM) {
  weightSrc = bust(weightSrc, /const idle = 1 - amp;/, 'const idle = clamp01(1 - amp * 1.08);', 'sum');
}
if (B_HAND) {
  weightSrc = bust(weightSrc, /\n {2}const w = \{\};/,
    "\n  if (rig && rig.kind === 'drone') raw.run = 1;\n  const w = {};", 'hand');
}
if (B_TREAD) {   // killswitch 的早退拿掉(= 「填了但速度是 0」)⇒ Ⅶ 的空陣列行為直測 MUST 紅
  gameSrc = bust(gameSrc, /\n\s*if \(!TREAD\) return out;[^\n]*/, '', 'tread');
}
if (B_CHARSPD) {   // 速率改由 `_charSlots` 自己再推導一次(第四份「他在不在動」)⇒ Ⅶ MUST 紅
  gameSrc = bust(gameSrc, /add\(this\.pos, this\._selfSpd\);/,
    'add(this.pos, Math.hypot(this.vel.x, this.vel.z));', 'charspd');
  gameSrc = bust(gameSrc, /add\(ne\[i\]\.mesh\.position, ne\[i\]\.loco\?\.speed\);/,
    'add(ne[i].mesh.position, Math.hypot(ne[i].tgt.x - ne[i].mesh.position.x, ne[i].tgt.z - ne[i].mesh.position.z) * 60);',
    'charspd');
}
if (B_CHARORDER) {   // 餵入點移到 `_updateEnts` 之前(拿到上一幀的插值位置)⇒ Ⅶ 的順序 MUST 紅
  gameSrc = bust(gameSrc, /\n\s*setCelChar\(this\._charSlots\(\)\);/, '', 'charorder');
  gameSrc = bust(gameSrc, /(\n( +))(this\._updateEnts\(dt, now\);)/,
    '$1setCelChar(this._charSlots());$1$3', 'charorder');
}

// ── 執行原文:MUST NOT 改成 import(那樣 --break-sum / --break-hand 一支都咬不到,
//    而且看起來一樣綠)。本模組零 import ⇒ 去掉 `export ` 就能直接跑。
const W = new Function(`${weightSrc.replace(/^export /gm, '')}
return { WEIGHT_KEYS, RUN_LO, RUN_HI, AIR_BAND_F, animWeights };`)();
const { WEIGHT_KEYS, animWeights } = W;

sec('Ⅰ 縫只有一份(`animWeights` 恰一份宣告、恰兩個呼叫端)');
ok(count(weightSrc, /\nexport function animWeights\(/g) === 1,
  '`animWeights` 恰一份宣告,且住 `public/js/animweights.js`');
ok(count(code(gameSrc), /_moveSpd/g) === 0,
  'game.js 全檔 0 處 `_moveSpd` —— 第二份速度推導 MUST 已整行刪除',
  JSON.stringify(code(gameSrc).match(/.*_moveSpd.*/g) || []));
ok(count(code(gameSrc), /Math\.hypot\([^;\n]*\) \/ dt/g) === 0,
  'game.js MUST NOT 再出現「水平位移 hypot ÷ dt」這個形狀的速度推導',
  JSON.stringify(code(gameSrc).match(/.*Math\.hypot\([^;\n]*\) \/ dt.*/g) || []));
ok(count(code(locoSrc), /animWeights\(/g) === 1 && /L\.w = animWeights\(/.test(code(locoSrc)),
  'locomotion.js 恰一個呼叫端,而且寫的是 `L.w =`(唯一產生點)');
ok(count(code(gameSrc), /animWeights\(/g) === 1 && /this\._selfW = animWeights\(/.test(code(gameSrc)),
  'game.js 恰一個呼叫端(自機沒有 `loco` ⇒ 用同一支組 `this._selfW`,MUST NOT 另寫玩家版判斷)');
{
  // 自機那份位移差分是**具名例外**(自機在 `_updateEnts` 早退、沒有 loco)⇒ MUST 收在
  // `_stepSelfWeights` 一支裡面,MUST NOT 散到別處變成第三份「他在不在動」。
  const selfM = grabMethod(gameSrc, '_stepSelfWeights');
  const rest = code(gameSrc).split(code(selfM)).join('');
  ok(count(code(gameSrc), /_selfL/g) > 0 && count(rest, /_selfL/g) === 0,
    '自機的位移差分狀態 `_selfL` MUST 只住 `_stepSelfWeights`');
  ok(/lerpFPS\(6, dt\)/.test(selfM),
    '自機的阻尼 MUST 走 `lerpFPS`(與 locomotion 的 `damp` 同一支、同一個 k)');
}

sec('Ⅱ 離地門檻只有一份、而且是**注入**的(行為證明)');
ok(count(code(gameSrc), /heroY \|\| 0\) > \d/g) === 0,
  'game.js MUST NOT 再出現寫死的離地高門檻(舊制 `_moveCat` 的 `> 3` 是全專案第三個)',
  JSON.stringify(code(gameSrc).match(/.*heroY \|\| 0\) > \d.*/g) || []));
ok(/\(ent\.loco\?\.w\?\.air \|\| 0\) > 0\.5/.test(code(gameSrc)),
  '`_moveCat` 的升空判定改吃權重向量的 air 軌(門檻 0.5 = 注入的 groundY 那一點)');
{
  // 跨越點跟著注入的 groundY 搬 —— 寫死的話搬不動,而每一條原文斷言都會過
  const airAt = (g, y) => animWeights({}, null, { groundY: g, y }).air;
  ok(airAt(2, 2.0001) > 0.5 && airAt(2, 1.9999) <= 0.5,
    'groundY = 2 ⇒ air 恰在 y = 2 跨過 0.5(= locomotion 換樹的同一條線)',
    `${airAt(2, 1.9999).toFixed(6)} / ${airAt(2, 2.0001).toFixed(6)}`);
  ok(airAt(5, 5.0001) > 0.5 && airAt(5, 4.9999) <= 0.5 && airAt(5, 2) <= 0.5,
    'groundY = 5 ⇒ 跨越點跟著搬到 y = 5(⇒ 門檻真的是注入的,不是寫死的)',
    `${airAt(5, 2).toFixed(6)} / ${airAt(5, 5.0001).toFixed(6)}`);
  ok(animWeights({}, null, { groundY: 2, y: 0, flies: true }).air === 1,
    '常駐飛行體恆 air = 1(不管離地高多少)');
  ok(animWeights({}, null, { y: 9 }).air === 1 && animWeights({}, null, { y: 0 }).air === 0,
    '沒有注入 groundY ⇒ 退化成二元判定,仍不產生 NaN(降級不例外)');
}

sec('Ⅲ 數學(地面三軌和恆為 1 / 缺欄回 0 不回 NaN / 鍵集推導)');
{
  let worst = 0, bad = null;
  for (let i = 0; i <= 400; i++) {
    const amp = i / 200;                       // 0 → 2(涵蓋 L.amp 的 1.1~1.2 上界)
    const w = animWeights({ amp }, null, { top: 8 });
    const e = Math.abs((w.idle + w.walk + w.run) - 1);
    if (e > worst) { worst = e; bad = amp; }
  }
  ok(worst < 1e-9,
    `地面三軌 idle + walk + run ≡ 1(0~2×top 掃 401 點,最大誤差 ${worst.toExponential(1)})`,
    `amp = ${bad}`);
}
{
  const cases = [
    ['null 全部', animWeights(null, null, null)],
    ['空物件', animWeights({}, {}, {})],
    ['NaN / 字串 / undefined 混餵', animWeights(
      { amp: NaN, speed: 'x', landK: undefined, srg: null, brk: Infinity, morph: -1, act: NaN },
      { _aim: NaN, _chg: undefined, top: NaN }, { groundY: NaN, y: Infinity, aim: 'x' })],
  ];
  let allFinite = true, inRange = true, keysOk = true;
  for (const [, w] of cases) {
    const ks = Object.keys(w);
    if (ks.length !== WEIGHT_KEYS.length || ks.some((k, i) => k !== WEIGHT_KEYS[i])) keysOk = false;
    for (const k of WEIGHT_KEYS) {
      const v = w[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) allFinite = false;
      else if (v < 0 || v > 1) inRange = false;
    }
  }
  ok(allFinite, '缺欄 / NaN / 非數字一律回有限數,MUST NOT 回 NaN(NaN 會打斷整條幀迴圈)');
  ok(inRange, '每一格恆收在 [0, 1]');
  ok(keysOk, '鍵集**逐位元** = `WEIGHT_KEYS`(含順序)—— 由它推導,不是手寫');
  ok(animWeights(null, null, null).idle === 1,
    '完全沒有狀態的那一幀 = 靜止(idle = 1),不是全 0');
}
ok(WEIGHT_KEYS.length === 10 && new Set(WEIGHT_KEYS).size === 10
  && WEIGHT_KEYS[0] === 'idle' && WEIGHT_KEYS[1] === 'walk' && WEIGHT_KEYS[2] === 'run',
  '`WEIGHT_KEYS` 有序、無重複,而且地面三軌排在最前面',
  JSON.stringify(WEIGHT_KEYS));
{
  // 分軌單調:mv = walk + run 隨 amp 嚴格遞增到 1;run 非遞減。排名不變的保證。
  let mono = true, runMono = true, prevMv = -1, prevRun = -1;
  for (let i = 0; i <= 200; i++) {
    const w = animWeights({ amp: i / 200 }, null, {});
    const mv = w.walk + w.run;
    if (mv < prevMv - 1e-12) mono = false;
    if (w.run < prevRun - 1e-12) runMono = false;
    prevMv = mv; prevRun = w.run;
  }
  ok(mono && runMono, '`walk + run` 與 `run` 皆隨 amp 單調不減(gain-ride 的交叉淡入不得回頭)');
  const slow = animWeights({ amp: 0.2 }, null, {});
  const fast = animWeights({ amp: 1 }, null, {});
  ok(slow.walk > slow.run && fast.run > fast.walk && fast.walk === 0,
    '慢 = 以 walk 為主、頂速 = 完全落在 run(否則最快那一檔還混著 walk 床)');
}
{
  // `stepAerial` / `stepVehicle` 不寫 `L.amp` ⇒ 那幾類(直升機/坦克)的權重不得恆為 0,
  // 否則那一整類的環境音床從此不出聲,而每一條斷言都綠。
  const w = animWeights({ speed: 8 }, { top: 16 }, {});
  ok(w.walk + w.run > 0.4 && w.idle < 0.6,
    '缺 `L.amp` 的 rig(aerial / vehicle)MUST 退回 `L.speed ÷ rig.top`,不得恆為 0',
    JSON.stringify(w));
  ok(animWeights({ speed: 8 }, { top: 0 }, {}).idle === 1,
    'top 缺席 ⇒ 退化成靜止(不產生 Infinity)');
}

sec('Ⅳ 消費端(行為直測:`ent.loco === null` 的那一幀 MUST NOT 交出 NaN)');
{
  const src = grabMethod(gameSrc, '_updateMoveAudio');
  ok(/this\._entWeights\(ent\)/.test(src),
    '`_updateMoveAudio` 只經 `_entWeights` 取權重(自機/他機同一條路)');
  ok(!/\bb\.spd\b/.test(src) && !/\.spd\b/.test(src),
    '`_updateMoveAudio` MUST NOT 再出現 `b.spd` / 自己的速度曲線',
    JSON.stringify(src.match(/.*\.spd.*/g) || []));
  // 真的跑一次:餵 w = null(重生瞬移那一幀),量交出去的每一個數
  const calls = [];
  const obj = new Function('terrainEnvCode', 'SELF_BED', `return {${src}\n};`)(() => 0, false);
  const mock = {
    audio: { lowPower: false, _dead: false, ambOn: false, setMove: (...a) => calls.push(a) },
    camera: { position: { x: 0, y: 0, z: 0 }, matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } },
    ents: new Map([['a', { isSelf: false, isStatic: false, dead: false, loco: null, mesh: { visible: true, position: { x: 10, y: 0, z: 10 } } }]]),
    _moveCat: () => 'stomp',
    _entWeights(ent) { return (ent.isSelf ? this._selfW : ent.loco?.w) || null; },
    _env: { ground: 0 },
    terrain: {},
    _updatePlaceAudio() {},
  };
  let threw = null;
  try { obj._updateMoveAudio.call(mock); } catch (e) { threw = e; }
  const nums = calls.flatMap((c) => c.slice(1)).filter((v) => typeof v === 'number');
  ok(!threw, '`loco === null` 的那一幀 MUST NOT 丟例外', String(threw?.message || ''));
  ok(calls.length === 4, '四個類別各餵一次(聲道續存,靜止只是音量趨近 0)', JSON.stringify(calls.length));
  ok(nums.length > 0 && nums.every((v) => Number.isFinite(v)),
    '交給 `setMove` 的每一個數皆為有限數(NaN 進 setTargetAtTime = 整條幀迴圈斷掉)',
    JSON.stringify(calls));
  ok(calls.every((c) => c.length >= 5), '`setMove` MUST 帶第五格濕度(乾/濕兩床由同一顆 LFO 開合)');
}

sec('Ⅴ 鍵集推導不手寫、模組內無逐機種名冊');
{
  const c = code(weightSrc);
  const roster = [/\b(kind|ch|id|name|role)\s*===\s*['"]/, /\bswitch\s*\([^)]*\.kind/, /\bCHARACTERS\b/, /\bUNITS\s*\[/];
  const hit = roster.filter((re) => re.test(c));
  ok(hit.length === 0,
    '`animweights.js` MUST NOT 出現逐機種 / 逐角色名冊(同 A33 ⑤:分類一律推導)',
    JSON.stringify(c.match(/.*(kind|ch|role)\s*===\s*['"].*/g) || []));
  ok(/for \(const k of WEIGHT_KEYS\)/.test(c),
    '輸出物件的鍵集 MUST 由 `WEIGHT_KEYS` 迴圈推導(不是手寫的物件字面值)');
}
{
  const consumers = grabMethod(gameSrc, '_updateMoveAudio') + grabMethod(gameSrc, '_moveCat');
  const keys = [...code(consumers).matchAll(/\bw\??\.([A-Za-z]+)\b/g)].map((m) => m[1]);
  const bad = [...new Set(keys)].filter((k) => !WEIGHT_KEYS.includes(k));
  ok(keys.length > 0 && bad.length === 0,
    '消費端讀的每一個鍵 MUST ∈ `WEIGHT_KEYS`(手寫鍵表會在加軌 / 改名時靜默過期)',
    JSON.stringify(bad));
}

sec('Ⅵ 模組邊界(零 import / 不吃 dt / 零第二份阻尼)');
{
  const c = code(weightSrc);
  ok(count(c, /^import /gm) === 0,
    '`animweights.js` 零 import(同 gaitcurve / morphrig / visualPrefs)⇒ 離線稽核執行真品');
  ok(!/\bdt\b/.test(c),
    '本檔不吃 dt:它讀的是別人已經阻尼過的量,自己一格都不該再積分',
    JSON.stringify(c.match(/.*\bdt\b.*/g) || []));
  ok(count(c, /Math\.exp\(/g) === 0 && count(c, /Math\.min\(1, /g) === 0,
    'MUST NOT 出現第二份幀率無關性的定義(`Math.exp(-k·dt)` / `Math.min(1, k·dt)`)');
  ok(!/Math\.random\(/.test(c), '零亂數(§2.3:權重是狀態的純函式)');
}

sec('Ⅶ ⑤-1 植被擾動的餵入端(`_charSlots()` → `setCelChar`)');
{
  const charSrc = grabMethod(gameSrc, '_charSlots');
  const c = code(charSrc);
  // ---- 原文:速率一律取自既有的阻尼縫 ----
  ok(!/Math\.hypot\(/.test(c) && !/\bdt\b/.test(c),
    '`_charSlots` 內**沒有**第二份速度推導(無 `Math.hypot`、連 `dt` 都不吃)—— 它讀的是別人阻尼過的量',
    JSON.stringify(c.match(/.*(Math\.hypot|\bdt\b).*/g) || []));
  ok(!/this\.vel\b/.test(c),
    '速率 MUST NOT 取 `this.vel`(攀爬 / push-out / 蓄力跳三條路徑都不經過它 ⇒ 「爬梯子時腳邊的草在被撥開」)',
    JSON.stringify(c.match(/.*this\.vel.*/g) || []));
  ok(/\.loco\?\.speed/.test(c) && /this\._selfSpd/.test(c),
    '兩個來源都是既有的阻尼縫:他機 `ent.loco.speed`(locomotion 的位移差分 + damp)、自機 `_selfSpd`(`_stepSelfWeights` 同一份 `L`)');
  ok(count(code(gameSrc), /this\._selfSpd =/g) === 1
    && /this\._selfSpd = L\.speed;/.test(code(grabMethod(gameSrc, '_stepSelfWeights'))),
    '`_selfSpd` 恰一個寫入點,而且就寫在 `_stepSelfWeights` 的那一份 `L` 上(不是另一條差分)');
  // ---- 原文:餵入點恰一處,而且排在 `_updateEnts` 之後 ----
  const loop = code(grabMethod(gameSrc, '_loop'));
  const iFeed = loop.indexOf('setCelChar(this._charSlots());');
  const iEnts = loop.indexOf('this._updateEnts(dt, now);');
  ok(count(code(gameSrc), /setCelChar\(/g) === 1,
    '`setCelChar` 在 game.js 恰一個呼叫端(唯一寫入點)');
  ok(iFeed > 0 && iEnts > 0 && iFeed > iEnts,
    '餵入排在 `_updateEnts` **之後**(`ent.mesh.position` 那時才是本幀插值完的值)',
    `feed@${iFeed} / ents@${iEnts}`);
  ok(count(code(gameSrc), /stepCelWind\(dt\)/g) === 1,
    '`stepCelWind(dt)` 的呼叫形狀一格未動(MUST NOT 把擾動源併進它的簽章 —— `audit_soft_stroke` Ⅴ 釘死那一支)');
  // ---- 行為直測:真的跑一次 `_charSlots` 的原文 ----
  const mkFn = (tread) => new Function('TREAD', 'CHAR', `return {${charSrc}\n};`)(tread, CHAR)._charSlots;
  const ent = (pid, x, spd, o = {}) => ({
    pid, hero: true, dead: false, loco: spd == null ? null : { speed: spd },
    mesh: { visible: true, position: { x, y: 0, z: 0 } }, tgt: { x, z: 0 }, ...o,
  });
  const mkThis = (over = {}) => ({
    // `vel` 是真品上真的有的欄位(所以 mock 也要有)—— 它正是這裡**不准**用的那一個:
    // 沒有它的話 `--break-charspd` 會以 TypeError 收場而不是乾淨的紅字。
    pos: { x: 0, y: 1, z: 0 }, vel: { x: 0, y: 0, z: 0 },
    side: 'SWARM', dead: false, _selfSpd: 3.5, _specPid: null,
    camera: { position: { x: 0, y: 0, z: 0 } },
    ents: new Map([
      ['self', ent('me', 0, null, { isSelf: true })],
      ['a', ent('a', 50, 1)], ['b', ent('b', 10, 2)], ['c', ent('c', 30, 3)],
      ['d', ent('d', 20, 4)], ['e', ent('e', 5, 5)],
    ]),
    ...over,
  });
  const run = (tread, over) => mkFn(tread).call(mkThis(over));
  {
    const out = run(true, {});
    ok(out.length === CHAR.N, `槽數填滿且 **≤ CHAR.N**(N = ${CHAR.N},實得 ${out.length})`);
    ok(out[0].x === 0 && out[0].y === 1 && out[0].spd === 3.5,
      '槽 0 = 主視野機體:交戰中取 `this.pos` 與 `_selfSpd`(自機的位置權威不在 ent 上)',
      JSON.stringify(out[0]));
    ok(out.slice(1).map((s) => s.x).join(',') === '5,10,20',
      '其餘槽依「離相機距離」**升冪**(最近的先進來;50 與 30 被擠掉)',
      JSON.stringify(out.slice(1).map((s) => s.x)));
    ok(out.every((s) => Number.isFinite(s.spd) && s.spd >= 0),
      '每一格的 spd 皆為非負有限數(NaN 進 uniform 陣列 = 那批 InstancedMesh 整批消失)');
  }
  {
    const out = run(false, {});
    ok(out.length === 0,
      '`?tread=0` ⇒ **空陣列**(`setCelChar` 據此把全槽顯式歸零 ⇒ 頂點端逐槽早退 = 逐位元同舊制)',
      JSON.stringify(out));
  }
  {
    // 重生瞬移那一幀 `ent.loco` 是 null(`_updateEnts` 的 `_snapPos` 分支)
    const t = mkThis();
    t.ents.get('e').loco = null;
    const out = mkFn(true).call(t);
    ok(out[1].x === 5 && out[1].spd === 0,
      '`ent.loco === null`(重生瞬移那一幀)⇒ spd 退成 0,不是 NaN 也不是跳過那一台',
      JSON.stringify(out[1]));
  }
  {
    // 觀戰 / 陣亡過場:主視野是 `_specPid` 跟隨的那一台,而它 MUST NOT 同時佔兩格
    const out = run(true, { side: null, _specPid: 'c' });
    ok(out.length === CHAR.N && out[0].x === 30 && out[0].spd === 3,
      '觀戰時槽 0 = 正在跟隨的那一台(位置取 `ent.mesh.position`、速率取它自己的 `loco.speed`)',
      JSON.stringify(out[0]));
    ok(new Set(out.map((s) => s.x)).size === out.length,
      '跟隨中的那一台 MUST NOT 同時佔兩格(重複 = 那一台的擾動被套兩次)',
      JSON.stringify(out.map((s) => s.x)));
  }
  {
    // 沒人可跟(剛進場 / 全滅):槽 0 MUST 讓最近的機體遞補,MUST NOT 留一個空洞
    const out = run(true, { side: null, _specPid: null });
    ok(out.length === CHAR.N && out[0].x === 5,
      '沒有主視野機體時最近的那一台遞補槽 0(留空 = 白白少一台會撥草的機體)',
      JSON.stringify(out.map((s) => s.x)));
  }
  {
    // 場上機體少於 N:交出去的長度 MUST 跟著縮(setCelChar 會把剩下的槽歸零)
    const t = mkThis();
    for (const k of ['a', 'b', 'c', 'd']) t.ents.delete(k);
    const out = mkFn(true).call(t);
    ok(out.length === 2, '場上只有兩台 ⇒ 只交兩格(剩下的槽由 `setCelChar` 顯式歸零)', JSON.stringify(out.length));
  }
  {
    // 陣亡 / 不可見的機體不進槽(它們的位置停在原地 ⇒ 草會被一具屍體永遠壓著)
    const t = mkThis();
    t.ents.get('e').dead = true;
    t.ents.get('b').mesh.visible = false;
    const out = mkFn(true).call(t);
    ok(!out.slice(1).some((s) => s.x === 5 || s.x === 10),
      '陣亡 / 不可見的機體不進槽(否則草會被一具停在原地的屍體永遠壓著)',
      JSON.stringify(out.map((s) => s.x)));
  }
}

console.log(fail
  ? `\n✗ 動畫權重向量稽核:${pass} 通過 / ${fail} 失敗`
  : `\n✓ 動畫權重向量稽核:${pass} 項全通過`);
process.exit(fail ? 1 : 0);
