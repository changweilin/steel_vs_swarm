// ============ 幀率無關阻尼稽核(`lerpFPS` / `frictionFPS` 唯一縫)============
// 用途:改 `data.js` 的 `frictionFPS`/`lerpFPS`、或在任何客戶端模組裡新增「逐漸逼近目標值」
// 的寫法之後跑這一支。跑法:`node tools/audit_damp_fps.mjs`(反向驗證 `--break-damp`)。
//
// ── 為什麼要有這支(2026-08-16,`docs/anime_style_plan.md` ⑥-1)──────────────
// 舊制到處是 `x += (t − x) * Math.min(1, k · dt)`。**它是幀率相依的**:那個係數對 dt 是
// 線性的,而指數衰減不是 ⇒ 同一段運鏡在 30fps 收斂得比 144fps 快。k = 10 時,一秒之後
// 30fps 的殘量是 5.2e−6、144fps 是 3.5e−5 —— 差了將近七倍。
// 症狀:高刷新率的機器上鏡頭/砲塔/上身「比較黏」,低幀率反而更晃。
// **沒有任何錯誤訊息,也沒有任何既有斷言會紅** —— 每一幀單看都是對的,只有跨幀率比才看得出來。
//
// 驗的三件事:
//   Ⅰ **縫只有一份**:`Math.exp` 的阻尼形只准住 `data.js` 那兩行;客戶端 MUST NOT 殘留
//     `Math.min(1, dt * k)`,也 MUST NOT 自己再寫一份 `Math.exp(-k * dt)`。
//   Ⅱ **數學(執行原文)**:互補、邊界、負值防禦,以及本項的核心 ——
//     **可加性**(跑兩個半步 ≡ 跑一整步)⇒ 幀率一改結果不動。內建對照組:同一組斷言
//     餵舊制公式 MUST 量得出差別(不然這條斷言等於恆真)。
//   Ⅲ **恆定角速度的夾制刻意留著**:`maxTurn * dt / ang`、`viewLockStep` 的 `cap` 是
//     「每秒最多轉幾弧度」,本來就幀率無關,改成 exp 就是把轉速上限變成軟的。
import { readSrc } from './audit_src.mjs';

const BREAK = process.argv.includes('--break-damp');
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => {
  if (c) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};
const sec = (t) => console.log(`\n▍${t}`);
const count = (s, re) => (s.match(re) || []).length;
// 掃「有沒有殘留舊寫法」一律先剝註解 —— 這幾條規則本身就寫在註解裡引用那個舊寫法,
// 不剝的話規則的說明會把自己判成違規(而且是永遠修不掉的那種紅字)。
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const dataSrc = readSrc('public', 'js', 'data.js');
const gameSrc = readSrc('public', 'js', 'game.js');
const locoSrc = readSrc('public', 'js', 'locomotion.js');

// ── 執行原文:把那兩行抽出來真的跑一次(MUST NOT 改成 import —— 那樣 --break-damp 就咬不到)
const m = dataSrc.match(/export const frictionFPS = [^\r\n]*\r?\nexport const lerpFPS = [^\r\n]*/);
if (!m) {
  console.log('✗ 抽不到 `frictionFPS` / `lerpFPS` 的宣告(兩行 MUST 相鄰,且順序 = 殘留比例在前)');
  process.exit(1);
}
let seam = m[0].replace(/export /g, '');
if (BREAK) {
  const before = seam;
  seam = seam.replace(/const lerpFPS = [^\r\n]*/,
    'const lerpFPS = (k, dt) => Math.min(1, Math.max(0, k) * Math.max(0, dt));');
  if (seam === before) {
    console.log('✗ --break-damp:字面替換無效(原文已變 ⇒ 這支 break 根本沒造出壞版)');
    process.exit(1);
  }
}
const { lerpFPS, frictionFPS } = new Function(`${seam}\nreturn { lerpFPS, frictionFPS };`)();

// 舊制公式:內建對照組(證明 Ⅱ 的幀率無關斷言真的量得到差別)
const legacyLerp = (k, dt) => Math.min(1, k * dt);

sec('Ⅰ 縫只有一份');
ok(count(dataSrc, /export const frictionFPS = /g) === 1
  && count(dataSrc, /export const lerpFPS = /g) === 1,
  '`frictionFPS` / `lerpFPS` 各恰一份宣告,且都住 data.js');
ok(/export const frictionFPS = \(k, dt\) => Math\.exp\(/.test(dataSrc),
  '殘留比例是原式(`Math.exp`),逼近權重是它的補數 —— 反過來寫會讓 `v *= exp(…)` 那批消費端差最後幾位');
// 逐幀固定係數:`Math.min(1, dt * k)` / `Math.min(1, k * dt)` 且**緊接著收括號**。
// 恆定角速度夾制(`Math.min(1, maxTurn * dt / ang)`)不收括號 ⇒ 結構上不會誤傷(見 Ⅲ)。
const LEGACY = /Math\.min\(1, *(dt \* [A-Za-z0-9_.]+|[A-Za-z0-9_.]+ \* dt)\)/g;
for (const [name, src] of [['game.js', gameSrc], ['locomotion.js', locoSrc]]) {
  ok(count(code(src), LEGACY) === 0,
    `${name} MUST NOT 殘留逐幀固定係數 \`Math.min(1, dt * k)\``,
    JSON.stringify(code(src).match(LEGACY) || []));
}
// data.js 的**唯一**一處是具名例外:`viewLockStep` 同時餵伺服器的 bot 朝向(8Hz 固定 tick),
// 改成指數逼近就是權威側的行為改變(見那一段註解)。多出第二處 = 有人偷偷把舊寫法帶回來。
{
  const hits = code(dataSrc).match(LEGACY) || [];
  ok(hits.length === 1 && /Math\.min\(1, VIEW_LOCK\.EASE \* dt\)/.test(code(dataSrc)),
    'data.js 只准留 `viewLockStep` 這一個具名例外(它同時是 bot 朝向的唯一寫入點)',
    JSON.stringify(hits));
}
// 第二份 exp:`Math.exp(-dt * …)` / `Math.exp(-<ident> * dt)`(data.js 的那一份是縫本身,排除)
const SECOND_EXP = /Math\.exp\(-(dt \* |[A-Za-z0-9_.]+ \* dt)/g;
ok(count(code(gameSrc), SECOND_EXP) === 0 && count(code(locoSrc), SECOND_EXP) === 0,
  '消費端 MUST NOT 自己寫第二份 `Math.exp(-k * dt)`(那是第二份幀率無關性的定義)',
  JSON.stringify([...(code(gameSrc).match(SECOND_EXP) || []), ...(code(locoSrc).match(SECOND_EXP) || [])]));
ok(/import \{ MORPH, lerpFPS \} from '\.\/data\.js';/.test(locoSrc)
  && /const damp = \(c, t, k, dt\) => c \+ \(t - c\) \* lerpFPS\(k, dt\);/.test(locoSrc),
  'locomotion.js 的 `damp()` MUST 轉呼這一支(它曾是第二份實作)');
ok(/lerpFPS, frictionFPS/.test(gameSrc) || (/\blerpFPS\b/.test(gameSrc) && /\bfrictionFPS\b/.test(gameSrc)),
  'game.js 兩支都 import 得到');

sec('Ⅱ 數學(執行原文;--break-damp 這一段的幀率無關 MUST 紅)');
ok(frictionFPS(10, 0) === 1 && lerpFPS(10, 0) === 0, 'dt = 0 ⇒ 完全不動(暫停幀不會偷偷位移)');
ok(frictionFPS(0, 1) === 1 && lerpFPS(0, 1) === 0, 'k = 0 ⇒ 完全不動(關掉阻尼 = 不套用)');
ok(lerpFPS(-5, 0.1) === 0 && lerpFPS(3, -1) === 0, '負的 k / 負的 dt 一律夾成 0(降級不例外)');
ok(Math.abs((lerpFPS(7, 1 / 60) + frictionFPS(7, 1 / 60)) - 1) < 1e-15,
  '逼近權重 + 殘留比例 ≡ 1(兩支同一份 exp)');
ok(lerpFPS(7, 1 / 60) > 0 && lerpFPS(7, 1 / 60) < 1 && lerpFPS(7, 1e6) <= 1,
  '值域收在 [0, 1](大 dt 不會過衝)');
ok(lerpFPS(7, 1 / 30) > lerpFPS(7, 1 / 60), '同一個 k:幀越長,單幀走得越多');
// **可加性**:兩個半步 ≡ 一整步。這就是「幀率無關」的定義本身。
{
  const k = 9, dt = 1 / 60;
  const two = 1 - (1 - lerpFPS(k, dt / 2)) * (1 - lerpFPS(k, dt / 2));
  ok(Math.abs(two - lerpFPS(k, dt)) < 1e-12,
    `可加性:兩個半步 ≡ 一整步(差 ${Math.abs(two - lerpFPS(k, dt)).toExponential(1)})`);
}
// 幀率無關直測:1.0 的差距積分一秒,不同幀率的殘量 MUST 幾乎相同
const residual = (f, k, fps) => {
  let e = 1;
  for (let i = 0; i < fps; i++) e -= e * f(k, 1 / fps);
  return e;
};
{
  const k = 10;
  const r = [30, 60, 144, 240].map((fps) => residual(lerpFPS, k, fps));
  const spread = Math.max(...r) / Math.min(...r);
  ok(spread < 1 + 1e-9,
    `幀率無關:30/60/144/240fps 的殘量比 ${spread.toFixed(12)}(MUST ≈ 1)`,
    JSON.stringify(r.map((v) => v.toExponential(3))));
  // 對照組:同一把尺量舊制 MUST 量得出差別 —— 沒有這一條,上面那句可能只是恆真
  const rl = [30, 60, 144, 240].map((fps) => residual(legacyLerp, k, fps));
  ok(Math.max(...rl) / Math.min(...rl) > 5,
    `對照組:舊制 min(1, k·dt) 的殘量比 ${(Math.max(...rl) / Math.min(...rl)).toFixed(1)}× ⇒ 這把尺真的量得到`);
}
// 60fps 上與舊制的落差:這一改**不是逐位元中性**,但落差 MUST 小到不用重調任何 k
{
  const worst = Math.max(...[3, 4, 5, 6, 8, 9, 10].map((k) =>
    Math.abs(lerpFPS(k, 1 / 60) - legacyLerp(k, 1 / 60)) / legacyLerp(k, 1 / 60)));
  ok(worst < 0.1,
    `60fps 上與舊制的相對落差 ≤ ${(worst * 100).toFixed(1)}%(現役 k = 3~10;超過就要回頭重調係數)`);
}

sec('Ⅲ 兩種「看起來像阻尼但不是」的東西刻意不動');
ok(/Math\.min\(1, maxTurn \* dt \/ ang\)/.test(gameSrc),
  '導引頭轉向是「每秒最多轉幾弧度」的夾制,本來就幀率無關 ⇒ MUST NOT 改成 exp');
ok(/const cap = VIEW_LOCK\.W \* dt;/.test(dataSrc),
  '`viewLockStep` 的角速度上限維持線性');
// 這一條釘的是「不要好心幫它改」:改了就是動到權威側的 bot 朝向(原則 1),
// 而且要照 §5.6 補一輪 AI 退化量測 —— 那是使用者的決定,不是這一輪順手做掉的事。
ok(/server\/bots\.js/.test(dataSrc) || /bots\.js `_turn`/.test(dataSrc),
  '`viewLockStep` 旁邊 MUST 寫著它為什麼是例外(下一個人才不會「順手修好」)');

sec('Ⅳ 背景分頁回來的第一幀(`docs/anime_style_plan.md` ⑧-3)');
// 分頁切走時 rAF 停擺,切回來的第一筆 `getDelta()` 是整段隱藏時間(數十秒)。
// 逐處的 `Math.min(1, dt·k)` 曾經順手擋住一部分,而阻尼改成 exp 之後**那些權宜全沒了**
// ⇒ 主迴圈那一道夾制從此是唯一防線,MUST 排在任何積分之前。
{
  const loop = gameSrc.slice(gameSrc.indexOf('  _loop() {'));
  const head = loop.slice(0, loop.indexOf('this._updateAaMode()'));
  ok(/const raw = this\.clock\.getDelta\(\);/.test(head) && /let dt = Math\.min\(0\.1, raw\);/.test(head),
    '主迴圈 MUST 先把 dt 夾住(切回分頁的第一幀不得積分數十秒)');
  ok(/this\._tickResGov\(raw \* 1000, now\);/.test(head),
    '自適應解析度吃的仍是**未夾制**的真實幀時(夾過的量不到真實負載)');
  ok(head.indexOf('let dt = Math.min(0.1, raw);') < head.indexOf('this.touch?.tick(dt)'),
    '夾制 MUST 排在第一個消費 dt 的地方之前');
}

console.log(fail
  ? `\n✗ 幀率無關阻尼稽核:${pass} 通過 / ${fail} 失敗`
  : `\n✓ 幀率無關阻尼稽核:${pass} 項全通過`);
process.exit(fail ? 1 : 0);
