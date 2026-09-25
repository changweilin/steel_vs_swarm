// ============ Frame-Rate Independent Damping Audit (lerpFPS / frictionFPS Single Seam) ============
// Scope: Run after modifying frictionFPS / lerpFPS in data.js or introducing target-converging damping in client modules.
// Usage: node tools/audit_damp_fps.mjs (negative test via --break-damp)
//
// Rationale:
// Legacy codebase used `x += (t - x) * Math.min(1, k * dt)`. This formula is frame-rate dependent:
// the coefficient scales linearly with dt, unlike exponential decay. Consequently, camera movements
// converge faster at 30fps than 144fps. At k = 10 after 1s, residual error at 30fps is 5.2e-6 vs
// 3.5e-5 at 144fps (~7x difference). Symptoms: higher refresh displays feel stickier; lower framerates oscillate more.
// No syntax errors or single-frame assertions catch this; it only manifests across frame rate comparisons.
//
// Enforced invariants:
//   I. Single seam: Math.exp damping implementations live strictly in data.js (frictionFPS, lerpFPS).
//      Clients MUST NOT retain Math.min(1, dt * k) or author custom Math.exp(-k * dt).
//   II. Mathematical fidelity (executed directly): complementarity, boundaries, negative clamping,
//       and semi-group additivity (two half-steps == one full step) ensuring invariance to frame rate.
//       Control baseline validates test sensitivity against the legacy formula.
//   III. Constant angular velocity limits preserved: maxTurn * dt / ang and viewLockStep cap represent
//       constant angular rate clamps (rad/s) and are inherently frame-rate independent; they must NOT become exp.
import { readSrc } from './audit_src.mjs';

const BREAK = process.argv.includes('--break-damp');
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => {
  if (c) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};
const sec = (t) => console.log(`\n▍${t}`);
const count = (s, re) => (s.match(re) || []).length;
// Strip comments before scanning for legacy patterns so explanatory comments containing legacy snippets do not trigger false violations.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const dataSrc = readSrc('public', 'js', 'data.js');
const gameSrc = readSrc('public', 'js', 'game.js');
const locoSrc = readSrc('public', 'js', 'locomotion.js');
// Explicit scan roster for modules that damp state towards targets.
// Roster covers game.js, locomotion.js, animweights.js, and wildlife.js.
const weightSrc = readSrc('public', 'js', 'animweights.js');
const wildSrc = readSrc('public', 'js', 'wildlife.js');

// ---- Execute Source: extracts declarations directly from data.js (MUST NOT import, or --break-damp mutation cannot inject) ----
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

// Legacy formula: control baseline to verify assertion sensitivity across frame rates.
const legacyLerp = (k, dt) => Math.min(1, k * dt);

sec('Ⅰ 縫只有一份');
ok(count(dataSrc, /export const frictionFPS = /g) === 1
  && count(dataSrc, /export const lerpFPS = /g) === 1,
  '`frictionFPS` / `lerpFPS` 各恰一份宣告,且都住 data.js');
ok(/export const frictionFPS = \(k, dt\) => Math\.exp\(/.test(dataSrc),
  '殘留比例是原式(`Math.exp`),逼近權重是它的補數 —— 反過來寫會讓 `v *= exp(…)` 那批消費端差最後幾位');
// Per-frame fixed coefficient: Math.min(1, dt * k) immediately followed by closing paren.
// Constant turn-rate clamp (Math.min(1, maxTurn * dt / ang)) has division before closing paren, avoiding false positives.
const LEGACY = /Math\.min\(1, *(dt \* [A-Za-z0-9_.]+|[A-Za-z0-9_.]+ \* dt)\)/g;
/** Explicit scan roster (see header). Both scan assertions MUST consume the exact same roster. */
const ROSTER = [['game.js', gameSrc], ['locomotion.js', locoSrc], ['animweights.js', weightSrc],
  ['wildlife.js', wildSrc]];
for (const [name, src] of ROSTER) {
  ok(count(code(src), LEGACY) === 0,
    `${name} MUST NOT 殘留逐幀固定係數 \`Math.min(1, dt * k)\``,
    JSON.stringify(code(src).match(LEGACY) || []));
}
// data.js contains a single named exception: viewLockStep also feeds server bot orientation (8Hz fixed tick); changing it would alter authoritative simulation.
{
  const hits = code(dataSrc).match(LEGACY) || [];
  ok(hits.length === 1 && /Math\.min\(1, VIEW_LOCK\.EASE \* dt\)/.test(code(dataSrc)),
    'data.js 只准留 `viewLockStep` 這一個具名例外(它同時是 bot 朝向的唯一寫入點)',
    JSON.stringify(hits));
}
// Duplicate exp check: Math.exp(-dt * ...) or Math.exp(-<ident> * dt) outside data.js.
const SECOND_EXP = /Math\.exp\(-(dt \* |[A-Za-z0-9_.]+ \* dt)/g;
ok(ROSTER.every(([, src]) => count(code(src), SECOND_EXP) === 0),
  '消費端 MUST NOT 自己寫第二份 `Math.exp(-k * dt)`(那是第二份幀率無關性的定義)',
  JSON.stringify(ROSTER.flatMap(([, src]) => code(src).match(SECOND_EXP) || [])));
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
// Additivity: two half-steps == one full step. This is the definition of frame-rate independence.
{
  const k = 9, dt = 1 / 60;
  const two = 1 - (1 - lerpFPS(k, dt / 2)) * (1 - lerpFPS(k, dt / 2));
  ok(Math.abs(two - lerpFPS(k, dt)) < 1e-12,
    `可加性:兩個半步 ≡ 一整步(差 ${Math.abs(two - lerpFPS(k, dt)).toExponential(1)})`);
}
// Direct frame-rate independence test: integrate a 1.0 delta for 1 second; residuals across framerates MUST match.
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
  // Control group: benchmark against legacy formula to verify test sensitivity.
  const rl = [30, 60, 144, 240].map((fps) => residual(legacyLerp, k, fps));
  ok(Math.max(...rl) / Math.min(...rl) > 5,
    `對照組:舊制 min(1, k·dt) 的殘量比 ${(Math.max(...rl) / Math.min(...rl)).toFixed(1)}× ⇒ 這把尺真的量得到`);
}
// 60fps divergence vs legacy: delta is small enough that tuning coefficients (k = 3-10) remain valid.
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
// viewLockStep turn clamp must remain linear: altering it impacts authoritative server bot orientation.
ok(/server\/bots\.js/.test(dataSrc) || /bots\.js `_turn`/.test(dataSrc),
  '`viewLockStep` 旁邊 MUST 寫著它為什麼是例外(下一個人才不會「順手修好」)');

sec('Ⅳ 背景分頁回來的第一幀(`docs/anime_style_plan.md` ⑧-3)');
// Background tab resume: rAF pauses and getDelta() reports elapsed background time (tens of seconds).
// Main loop clamp (Math.min(0.1, raw)) is the sole line of defense and MUST precede any integration.
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
