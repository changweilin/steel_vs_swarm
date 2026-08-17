// ============ 音效層級稽核(地點床 / 移動床 / 事件音 / BGM 階梯)============
// 用途:改 `public/js/audio.js`、`game.js` 的量測端、或 `public/audio/README.md` 的來源帳
// 之後跑這一支。跑法:`node tools/audit_audio_layers.mjs`
// 反向驗證:`--break-prio` / `--break-base` / `--break-margin` / `--break-sync`
//           `--break-take` / `--break-tier` / `--break-licence`
//
// ── 為什麼要有這支(2026-08-16,`docs/anime_style_plan.md` ⑦)────────────────
// 音效這一族的正確性有一半只有耳朵驗得到,但**最貴的那幾種錯全部是離線就量得到的**:
//   ① **兩床同時響**(累加取代 first-match-wins):交界處總音量爆掉,而每一個 gain
//      單看都還在 [0,1]。
//   ② **恆亮床沒了**:分區邊界被聽成一個洞。
//   ③ **濕床另建第二顆 LFO**:走進水裡會踏空一拍 —— 兩顆振盪器在任何靜態斷言上
//      都看不出問題,它就是「同相」這件事唯一的失效模式。
//   ④ **低階早退加了、補載入沒加**:關掉低功耗之後音效永久停在 Layer 1 合成,
//      **有聲音、沒有錯誤訊息、每一條既有斷言全綠**,使用者只會說「設定好像沒作用」。
//   ⑤ **常駐床誤走 `_play`**:去重窗與 `_MAX_VOICES` 會在齊射時把它丟掉,
//      症狀是「打得最兇的時候環境音整片消失」。
//   ⑥ **授權污染**:一列 `CC BY` 就改掉整個 repo 的散布條件。
//
// ⚠ `audio.js` 透過 `mobile.js` 間接 import THREE ⇒ Node 端 import 不了整支。
//   本檔全程走 `readSrc` + `grabConst`/`grabFn`/`grabMethod` + `new Function`,
//   **MUST NOT 改成 import** —— 那樣每一支 `--break-*` 都咬不到,而且看起來一樣綠。
// ⚠ 本檔 MUST NOT 出現帶前導斜線的 `audio` 路徑字面 —— `audit_net_modes.mjs` 的
//   `strayPaths` 掃的就是 `tools/*.mjs`,踩到會紅在一個完全不相干的訊息上。
//   路徑一律 `join(ROOT, 'public', 'audio')` 與不帶前導斜線的相對字串。
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readSrc, grabConst, grabFn, grabMethod, grabBlock } from './audit_src.mjs';

const ARGS = process.argv.slice(2);
const BRK = (n) => ARGS.includes(`--break-${n}`);
const B_PRIO = BRK('prio'), B_BASE = BRK('base'), B_MARGIN = BRK('margin');
const B_SYNC = BRK('sync'), B_TAKE = BRK('take'), B_TIER = BRK('tier'), B_LIC = BRK('licence');

let pass = 0, fail = 0;
const ok = (c, name, extra = '') => {
  if (c) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};
const note = (t) => console.log(`  · ${t}`);
const sec = (t) => console.log(`\n▍${t}`);
const count = (s, re) => (s.match(re) || []).length;
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

let audioSrc = readSrc('public', 'js', 'audio.js');
const gameSrc = readSrc('public', 'js', 'game.js');
let readmeSrc = readSrc('public', 'audio', 'README.md');

// ── 壞版注入 ────────────────────────────────────────────────────
if (B_PRIO) {
  // 累加所有 g > 0 的床、回傳整份 map(參考專案 symptom 表的『Overlapping zones both play』)
  audioSrc = bust(audioSrc,
    /if \(g > 0\) return \{ id: a\.id, g \};\r?\n {2}\}\r?\n {2}return null;/,
    'if (g > 0) out[a.id] = g;\n  }\n  return Object.keys(out).length ? { id: Object.keys(out)[0], g: Object.values(out).reduce((s, v) => s + v, 0), out } : null;',
    'prio');
  audioSrc = bust(audioSrc, /export function ambienceMix\(q\) \{/,
    'export function ambienceMix(q) {\n  const out = {};', 'prio');
}
if (B_BASE) {
  audioSrc = bust(audioSrc, /(const AMB_BASE = \{[^}]*vol: )[0-9.]+/, '$10', 'base');
}
if (B_MARGIN) {
  audioSrc = bust(audioSrc, /(const AMBIENCE = \[[\s\S]*?\n\];)/,
    (m) => m.replace(/m: [0-9.]+ \}/g, 'm: 0.5 }'), 'margin');
}
if (B_SYNC) {
  audioSrc = bust(audioSrc, /nw\.connect\(bp\); nw\.start\(\); chopOn\(lfo, bp, trim\);/,
    "nw.connect(bp); nw.start();\n      const lfo2 = ctx.createOscillator(); lfo2.type = 'sine'; lfo2.frequency.value = 2.6; lfo2.start();\n      chopOn(lfo2, bp, trim);",
    'sync');
}
if (B_TAKE) {
  audioSrc = bust(audioSrc, /const _RATE_JIT = [0-9.]+;/, 'const _RATE_JIT = 0;', 'take');
  audioSrc = bust(audioSrc, /if \(i === prev\) i = \(i \+ 1\) % takes\.length;/, 'i = prev ?? 0;', 'take');
}
if (B_TIER) {
  audioSrc = bust(audioSrc, /\n {4}if \(this\.lowPower\) \{ this\._loadBgm\(\); return; \}/, '', 'tier');
}
if (B_LIC) {
  readmeSrc = bust(readmeSrc, /(\| `sfx\/fire_missile\.ogg` \|[^\n]*\n)/,
    '$1| `sfx/x.ogg` | 測試 | 某站(**CC BY 4.0**) |\n', 'licence');
}

// ── 執行原文(名冊 + 純函式解析器)────────────────────────────────────
// ⚠ `grabConst` 的大括號配對只認 `{`/`}` ⇒ **頂層陣列**(`AMBIENCE`)會被截在第一個元素。
//   地點環境音那一段本來就是**連續**的一塊(名冊 + 純函式),直接取兩個錨點之間的原文:
//   起點 = `const AMB_BASE`,終點 = `ambienceMix` 函式本體的結尾(那一支走 grabFn,函式的
//   大括號配對是對的)。`_clamp` 是同檔的小工具,補一份定義進沙箱即可。
const ambFn = grabFn(audioSrc, 'ambienceMix');
const ambStart = audioSrc.indexOf('const AMB_BASE');
const ambEnd = audioSrc.indexOf(ambFn) + ambFn.length;
if (ambStart < 0 || ambEnd <= ambStart) {
  console.log('✗ 抽不到「地點環境音」那一段連續區塊(名冊與純函式 MUST 相鄰)');
  process.exit(1);
}
const ambSrcBits = [
  'const _clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);',
  audioSrc.slice(ambStart, ambEnd).replace(/^export /gm, ''),
].join('\n');
const A = new Function(`${ambSrcBits}\nreturn { AMB_BASE, AMBIENCE, ambienceMix };`)();
const { AMB_BASE, AMBIENCE, ambienceMix } = A;
const MOVE = new Function(`${grabConst(audioSrc, '_MOVE')}\nreturn _MOVE;`)();
const BGM = new Function(`${grabConst(audioSrc, 'BGM_MANIFEST')}\nreturn BGM_MANIFEST;`)();
const SFX = new Function(`${grabConst(audioSrc, 'SFX_MANIFEST')}\nreturn SFX_MANIFEST;`)();
const bgmUrl = new Function(`${grabConst(audioSrc, 'BGM_MANIFEST')}\n${grabFn(audioSrc, 'bgmUrl')}\nreturn bgmUrl;`)();

sec('Ⅰ 名冊結構(純資料 + 純函式;恆亮床刻意不在名冊裡)');
ok(Array.isArray(AMBIENCE) && AMBIENCE.length >= 4,
  `\`AMBIENCE\` 是陣列(現役 ${AMBIENCE.length} 床)—— **順序就是優先序**`);
ok(AMBIENCE.every((a) => a.id && a.url && typeof a.vol === 'number'
  && typeof a.r === 'number' && typeof a.m === 'number'),
  '每一列 MUST 齊備 `{ id, url, vol, r, m }`');
ok(new Set(AMBIENCE.map((a) => a.id)).size === AMBIENCE.length, '床的 id 不重複');
ok(!AMBIENCE.some((a) => a.id === AMB_BASE.id),
  '恆亮床 `AMB_BASE` MUST NOT 出現在 `AMBIENCE` 裡(它無條件、無球,放進名冊就要為它發明一組永遠成立的 r/m)');
{
  const fnSrc = grabFn(audioSrc, 'ambienceMix');
  ok(!/\bthis\b/.test(fnSrc) && !/THREE|document|window|localStorage/.test(fnSrc),
    '`ambienceMix` MUST 是純的(不碰 this / THREE / DOM)⇒ 離線稽核抽得出來直接跑');
  ok(count(code(audioSrc), /export function ambienceMix\(/g) === 1,
    'gain 公式全專案恰一份(`ambienceMix`)');
}

sec('Ⅱ 優先序:first-match-wins(行為;--break-prio MUST 紅)');
{
  // tunnel 與 water 同時成立(兩者都是二元查詢 0 = 在裡面)
  const both = ambienceMix({ tunnel: 0, water: 0, swamp: 0, camp: 0, urban: 0, forest: 0 });
  const first = AMBIENCE[0].id;
  ok(both && both.id === first,
    `多床同時在範圍內 ⇒ 只有宣告序在前的那一床有增益(現役第一順位 = ${first})`,
    JSON.stringify(both));
  ok(both && Object.keys(both).length === 2 && both.g <= 1 && both.g > 0,
    '回傳恰一床 `{ id, g }`,增益 ∈ (0, 1] —— MUST NOT 回一整份 map(那就是兩床一起響)',
    JSON.stringify(both));
}
ok(ambienceMix({}) === null && ambienceMix({ camp: 999, urban: 9, forest: 9 }) === null,
  '所有床都不在範圍內 ⇒ 回 null(此時只剩恆亮床,分區邊界不會被聽成一個洞)');
{
  let mono = true;
  for (let d = 0; d <= 60; d += 0.5) {
    const a = ambienceMix({ camp: d }), b = ambienceMix({ camp: d + 0.5 });
    const ga = a?.id === 'camp' ? a.g : 0, gb = b?.id === 'camp' ? b.g : 0;
    if (gb > ga + 1e-12) mono = false;
  }
  ok(mono, '單一床的增益隨查詢值單調不增(越遠越小,不得回頭)');
}

sec('Ⅲ 恆亮床與「邊界的性格」(--break-base / --break-margin MUST 紅)');
ok(AMB_BASE.vol > 0,
  `恆亮床音量 > 0(現值 ${AMB_BASE.vol})—— 它是「所有床都不在範圍內」時唯一的聲音`);
ok(AMB_BASE.url && AMB_BASE.id, '恆亮床有自己的 url 與 id');
{
  const ms = AMBIENCE.map((a) => a.m);
  ok(new Set(ms).size >= 2,
    `淡入寬度 \`m\` 至少兩個相異值(現役 ${new Set(ms).size} 種)—— 全部一樣 = 每個交界都同一種味道`,
    JSON.stringify(ms));
  ok(AMBIENCE.every((a) => a.m > 0 && a.r > 0 && a.vol > 0), '每一列的 r / m / vol 皆 > 0');
}
{
  // 邊界的兩端:查詢值 = r ⇒ 恰好熄;= r − m ⇒ 恰好滿
  const a = AMBIENCE[AMBIENCE.length - 1];
  const at = (q) => { const w = ambienceMix({ [a.id]: q }); return w?.id === a.id ? w.g : 0; };
  ok(Math.abs(at(a.r - a.m) - 1) < 1e-12 && at(a.r) === 0 && at(a.r + 1) === 0,
    '增益曲線:查詢值 = r 恰熄、= r − m 恰滿(邊界兩端都是定義,不是校準)');
}

sec('Ⅳ 常駐床:MUST NOT 走 `_play`、MUST NOT 每幀 pause');
{
  const setAmb = grabMethod(audioSrc, 'setAmbience');
  const ride = grabMethod(audioSrc, '_ambRide');
  const voice = grabMethod(audioSrc, '_ambVoice');
  ok(!/this\._play\(/.test(setAmb + ride + voice),
    '地點床 MUST NOT 走 `_play`(那條路有去重窗與 `_MAX_VOICES` ⇒ 齊射時環境音整片消失)');
  ok(!/\.pause\(\)/.test(setAmb + ride),
    '每幀的 ride MUST NOT `pause()`(那正是「離開再回來,床從頭開始」的病因)');
  ok(/setTargetAtTime/.test(ride),
    '音量 ride MUST 走與移動床同一套 `setTargetAtTime`(天生 click-free、幀率無關)');
  ok(!/decodeAudioData/.test(voice) && /new Audio\(\)/.test(voice),
    '常駐床 MUST 走 `HTMLAudioElement` 串流,MUST NOT `decodeAudioData`(七床常駐 PCM ≈ 數十 MB)');
  ok(/_stopAmbience/.test(grabMethod(audioSrc, 'dispose')),
    '只有 `dispose()` 收床');
  ok(/ambOn/.test(setAmb) && /get\('amb'\) !== '0'/.test(audioSrc),
    'killswitch `?amb=0` 讓 `setAmbience` 整支早退(A/B 對照的入口)');
}
{
  const upd = grabMethod(gameSrc, '_updatePlaceAudio');
  ok(/setAmbience\(/.test(upd), 'game.js 的量測端恰一處呼叫 `setAmbience`');
  ok(count(code(gameSrc), /setAmbience\(/g) === 1, '呼叫端恰一處(MUST NOT 散在多個迴圈裡)');
  ok(/this\._env\?\.ground/.test(upd) && !/_envAt\(\)/.test(upd),
    'water / swamp 讀當幀已算好的 `this._env.ground`,MUST NOT 再算第二份地形取樣');
  ok(/this\._blockGrid/.test(grabMethod(gameSrc, '_ambDensityAt')),
    '密度查詢 MUST 複用既有的 A6 碰撞網格,MUST NOT 另建第二個索引');
  ok(/this\._ambDens\?\.clear\(\)/.test(grabMethod(gameSrc, '_clearAroundBunker')),
    '密度快取 MUST 與 `_blockGrid` **同一處**失效(拆平的街廓不留幽靈市區聲)');
  {
    // 64m 硬階梯是聽得出來的:走過格界 MUST 是連續的(雙線性內插),而每一條
    // gain 斷言在階梯版上都會過。行為直測:沿 x 掃過一整個格界,量最大單步跳變。
    const src = grabMethod(gameSrc, '_ambDensityAt');
    const obj = new Function(`return {${src}\n};`)();
    const grid = new Map([['0,0', [{ bld: 1 }, { bld: 1 }, { bld: 1 }, { bld: 1 }, { bld: 1 },
      { bld: 1 }, { bld: 1 }, { bld: 1 }, { bld: 1 }, { bld: 1 }, { bld: 1 }, { bld: 1 },
      { bld: 1 }, { bld: 1 }, { bld: 1 }, { bld: 1 }, { bld: 1 }, { bld: 1 }, { bld: 1 },
      { bld: 1 }, { bld: 1 }, { bld: 1 }, { bld: 1 }, { bld: 1 }, { bld: 1 }, { bld: 1 }]]]);
    const mock = { _blockGrid: { C: 64, grid } };
    let prev = obj._ambDensityAt.call(mock, -80, 32).bld, jump = 0;
    for (let x = -80; x <= 160; x += 1) {
      const v = obj._ambDensityAt.call(mock, x, 32).bld;
      jump = Math.max(jump, Math.abs(v - prev)); prev = v;
    }
    ok(jump > 0 && jump < 0.05,
      `走過 64m 格界 MUST 是連續的(逐公尺最大跳變 ${jump.toFixed(4)} —— 硬階梯會是 1.0)`);
  }
}

sec('Ⅴ ⑦-2 乾/濕同相:chop LFO 恰一顆、兩條鏈掛同一顆(--break-sync MUST 紅)');
{
  const voice = grabMethod(audioSrc, '_moveVoice');
  const stomp = voice.slice(voice.indexOf('} else {'));
  ok(count(stomp, /createOscillator\(\)/g) === 0,
    'stomp 分支 MUST NOT 自己 `createOscillator()` —— 濕床掛的是 `chopped()` 回傳的**那一顆**',
    JSON.stringify(stomp.match(/.*createOscillator\(\).*/g) || []));
  ok(/const lfo = chopped\(/.test(stomp) && /chopOn\(lfo,/.test(stomp),
    '乾床建 LFO、濕床 `chopOn(lfo, …)` 掛同一顆 ⇒「同相」是構造保證而不是一段同步程式');
  ok(count(code(voice), /chopOn\(/g) === 1, '第二條鏈的掛法恰一處');
  ok(typeof MOVE.stomp_wet === 'number' && MOVE.stomp_wet > 0,
    `\`_MOVE\` 有 \`stomp_wet\` 一列(濕床的靜態音色配平;現值 ${MOVE.stomp_wet})`);
}
{
  const sm = grabMethod(audioSrc, 'setMove');
  ok(/setMove\(cat, gain, pan = 0, rate = 1, wet = 0\)/.test(sm),
    '`setMove` 簽章補第五格 `wet`,預設 0 ⇒ 其餘類別逐位元同舊制');
  ok(/v\.dry\.gain\.setTargetAtTime\(1 - w,/.test(sm) && /v\.wet\.gain\.setTargetAtTime\(w,/.test(sm),
    '乾/濕交叉淡入權重恆和為 1(不會出現雙重腳步,也不會在交界少掉一拍)');
  ok(/setMove\(cat, presence, pan, rate, wet\)/.test(grabMethod(gameSrc, '_updateMoveAudio')),
    'game.js 的量測端真的把濕度傳下來');
}

sec('Ⅵ ⑦-3 多 take + rate 抖動(--break-take MUST 紅;去重窗兩個現值是對照組)');
{
  const jit = Number(/const _RATE_JIT = ([0-9.]+);/.exec(audioSrc)?.[1]);
  ok(jit >= 0.05 && jit <= 0.10, `抖動幅度 ∈ [0.05, 0.10](現值 ${jit})`);
  // 對照組:break 咬的 MUST 是 take/抖動,而不是順手把去重窗一起改掉
  ok(/const _DEDUP_S = 0\.045;/.test(audioSrc), '對照組:去重窗 `_DEDUP_S` 維持 0.045(齊射的收斂靠它)');
  ok(/const _MAX_VOICES = 24;/.test(audioSrc), '對照組:發聲上限 `_MAX_VOICES` 維持 24');
}
{
  // 管線行為直測(資產未到位 ⇒ 名冊仍全是單字串,不能拿「至少一槽有多 take」當硬斷言)
  const src = grabMethod(audioSrc, '_playSample');
  const picked = [];
  // ⚠ 注入的 MUST 是**原文裡那個值**(可能已被 --break-take 改掉)—— 寫死 0.07 的話,
  //   壞版跑的仍是好版的抖動幅度,這一段就量不到 break 真正做的事(§5.4 ㋑)。
  const jitSrc = Number(/const _RATE_JIT = ([0-9.]+);/.exec(audioSrc)?.[1]);
  const obj = new Function('_RATE_JIT', `return {${src}\n};`)(jitSrc);
  const mock = {
    _buffers: { x: [{ duration: 1 }, { duration: 1 }, { duration: 1 }] },
    _lastTake: new Map(),
    _ctx: {
      createBufferSource: () => ({
        buffer: null, playbackRate: { value: 1 }, connect() {}, start() {}, disconnect() {},
      }),
    },
    _bus: () => ({ gain: { value: 0 }, disconnect() {} }),
    _count() {},
  };
  const rates = [];
  for (let i = 0; i < 60; i++) {
    let cap = null;
    mock._ctx.createBufferSource = () => (cap = {
      buffer: null, playbackRate: { value: 1 }, connect() {}, start() {}, disconnect() {},
    });
    obj._playSample.call(mock, 'x', 1, 0);
    picked.push(mock._buffers.x.indexOf(cap.buffer));
    rates.push(cap.playbackRate.value);
  }
  let repeat = 0;
  for (let i = 1; i < picked.length; i++) if (picked[i] === picked[i - 1]) repeat++;
  ok(repeat === 0, `多 take:連續兩次 MUST NOT 挑到同一顆(60 次裡重複 ${repeat} 次)`);
  ok(new Set(picked).size === 3, '三個 take 都被挑到過(不是永遠只播第一顆)');
  ok(rates.every((r) => Math.abs(r - 1) <= 0.10 + 1e-9) && new Set(rates).size > 1,
    `\`playbackRate\` 真的在抖、而且收在 ±10% 之內(相異值 ${new Set(rates).size} 個)`);
  ok(/duration \/ rate/.test(src),
    '`_count` 的時長 MUST 除以 rate —— 不除的話聲部計數釋放錯位,`_MAX_VOICES` 緩慢漂掉');
  // 單字串 MUST 解析成長度 1 的陣列 ⇒ 行為逐位元同舊制
  const singles = Object.values(SFX).filter((v) => typeof v === 'string').length;
  ok(singles + Object.values(SFX).filter((v) => Array.isArray(v)).length === Object.keys(SFX).length,
    `\`SFX_MANIFEST\` 的值型別只准 \`string | string[]\`(現役單字串 ${singles} 槽)`);
  ok(/Array\.isArray\(val\) \? val : \[val\]/.test(grabBlock(audioSrc, 'async _loadSamples()')),
    '註冊端把單字串解析成長度 1 的陣列(舊名冊逐位元同舊制)');
}
{
  // A4:`Math.random()` 在本檔只准出現在三處(白噪 / take 挑選 / rate 抖動)
  const c = code(audioSrc);
  ok(count(c, /Math\.random\(/g) === 3,
    '`Math.random()` 在 audio.js 恰三處(白噪 / take 挑選 / rate 抖動)—— 逐事件、不進共享 rnd 序列',
    JSON.stringify(c.match(/.*Math\.random\(.*/g) || []));
  ok(!/from '\.\/rng\.js'/.test(audioSrc),
    'audio.js MUST NOT import `rng.js`(它不在確定性散布路徑上)');

}

sec('Ⅶ ⑦-4 低記憶體階梯(--break-tier MUST 紅;另兩條是對照組)');
{
  const ls = grabBlock(audioSrc, 'async _loadSamples()');
  const early = ls.indexOf('if (this.lowPower)');
  const loop = ls.indexOf('for (const [id, val] of Object.entries(SFX_MANIFEST))');
  ok(early >= 0 && loop >= 0 && early < loop,
    '低階早退 MUST 排在 fetch 迴圈**之前**(整份 SFX 名冊不註冊 —— decoded buffer 才是真實成本)');
  ok(/this\._loadBgm\(\); return;/.test(ls), '低階仍載 BGM(串流本就低耗),只是走行動版編碼');
  // 對照組:這兩條在 --break-tier 下 MUST 仍綠(證明 break 咬的是早退)
  ok(count(code(audioSrc), /export function bgmUrl\(/g) === 1
    && count(code(audioSrc), /bgmUrl\(/g) >= 2,
    '對照組:`bgmUrl` 取檔唯一縫恰一份宣告,且真的被用到');
  ok(!/BGM_MANIFEST\[[^\]]*\]\s*[;)]/.test(code(audioSrc).replace(grabFn(audioSrc, 'bgmUrl'), '')),
    '對照組:BGM 取檔 MUST 全走 `bgmUrl`,MUST NOT 有第二處直接索引 `BGM_MANIFEST`');
  ok(/else if \(this\._ctx && !this\._sfxLoaded\) this\._loadSamples\(\);/.test(grabMethod(audioSrc, 'setLowPower')),
    '對照組:`setLowPower(false)` MUST 有補載入路徑(漏了 = 「設定好像沒作用」而斷言全綠)');
  ok(Object.values(BGM).every((e) => e && e.hi),
    '`BGM_MANIFEST` 逐場景 `{ hi, low }` 兩種編碼');
  ok(bgmUrl('menu', false) === BGM.menu.hi && bgmUrl('menu', true) === BGM.menu.low
    && bgmUrl('nope', true) === null,
    '`bgmUrl` 行為:低階取 low、一般取 hi、查無回 null');
  {
    const noLow = new Function(`const BGM_MANIFEST = { m: { hi: 'a.ogg' } };\n${grabFn(audioSrc, 'bgmUrl')}\nreturn bgmUrl;`)();
    ok(noLow('m', true) === 'a.ogg', '個別行動版編碼缺席時自動退回桌機版(降級不例外)');
  }
}

sec('Ⅷ 授權來源帳(雙向比對;--break-licence MUST 紅)');
{
  const rows = [...readmeSrc.matchAll(/^\| `([^`]+)` \|([^|]*)\|([^|]*)\|/gm)]
    .map((m) => ({ file: m[1], use: m[2].trim(), src: m[3].trim() }));
  ok(rows.length >= 9, `來源帳解析得到 ${rows.length} 列`);
  const badLic = rows.filter((r) => !/CC0/.test(r.src) || /CC BY|-NC|BY-SA/.test(r.src));
  ok(badLic.length === 0,
    '每一列 MUST 是 CC0,MUST NOT 出現 `CC BY` / `-NC` / `BY-SA`(一列就污染整個 repo 的散布條件)',
    JSON.stringify(badLic.map((r) => `${r.file} ← ${r.src}`)));
  // 實體檔案 → 表(**紅字**方向):放了檔卻沒登記 = 授權來歷不明
  const root = join(ROOT, 'public', 'audio');
  const disk = [];
  const walk = (dir, pre) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p, `${pre}${e}/`);
      else if (/\.(ogg|mp3|wav|m4a|opus)$/i.test(e)) disk.push(`${pre}${e}`);
    }
  };
  walk(root, '');
  const listed = new Set(rows.map((r) => r.file));
  const orphan = disk.filter((f) => !listed.has(f));
  ok(orphan.length === 0,
    `實體存在的音檔 MUST 全部登記在來源帳(實測 ${disk.length} 個檔)`,
    JSON.stringify(orphan));
  // 表 → 實體檔案(**待補清單**方向,刻意不判紅:資產一天沒到、CI 不該一天紅)
  const missing = rows.map((r) => r.file).filter((f) => !existsSync(join(root, f)));
  ok(true, `登記但尚未到位 ${missing.length} 個(待補清單,刻意不判紅 —— 缺檔時該床靜默、base 頂著)`);
  if (missing.length) note(`待補:${missing.join(' / ')}`);
  // 名冊 → 表:audio.js 宣告的每一個 url MUST 在來源帳裡有一列
  const urls = [
    ...Object.values(SFX).flatMap((v) => (Array.isArray(v) ? v : [v])),
    ...Object.values(BGM).flatMap((e) => [e.hi, e.low].filter(Boolean)),
    AMB_BASE.url, ...AMBIENCE.map((a) => a.url),
  ].map((u) => u.replace(/^audio\//, ''));
  const unlisted = urls.filter((u) => !listed.has(u));
  ok(unlisted.length === 0,
    `\`audio.js\` 名冊宣告的每一個檔 MUST 在來源帳裡有一列(實測 ${urls.length} 個宣告)`,
    JSON.stringify(unlisted));
}

console.log(fail
  ? `\n✗ 音效層級稽核:${pass} 通過 / ${fail} 失敗`
  : `\n✓ 音效層級稽核:${pass} 項全通過`);
process.exit(fail ? 1 : 0);
