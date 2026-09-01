// ============ 環境動態稽核(落花 / 落葉粒子)============
// 用途:改 `public/js/petals.js` 或 `biomes.js` 的落花接線之後跑這一支。
// 跑法:`node tools/audit_ambient_motion.mjs`
// 反向驗證(原則 9;每一支 MUST 讓對應那一段紅字):
//   --break-tone     色調改手寫色碼(不再由 ENV.seasons 推導)
//   --break-petal    拿掉快顫那一項(只剩慢波 = 一個正弦 = 機械擺動不是空氣)
//   --break-spin     自轉軸改成固定的世界 +Y(= 一地的硬幣)
//   --break-wrap     水平環繞改回世界軸漂移(整片花慢慢飄離它該蓋住的那叢樹)
//   --break-prewarm  拿掉建構期預跑(首幀整批擠在樹冠那一層,開場看到一批花同時開始掉)
//   --break-rnd      逐粒亂數消耗改成不固定(序列從此與「抽了幾片」耦合)
//   --break-shared   把**共享** rnd 交給規劃器(§2.3 的那一顆地雷)
//   --break-off      `?petal=0` 不再阻止建立(對照組從此不是舊制)
//
// ── 為什麼這一族需要自己的稽核(2026-08-16 `docs/anime_style_plan.md` ⑤-4)──────────
// 落花是**純表現層**:`data.js` / `sim.js` / `server/**` 一行不動 ⇒ `npm run bal` 與 e2e
// 天然不會動。它會壞掉的每一種方式都沒有錯誤訊息:
//   ① **共享 `rnd()` 被多抽一枚** ⇒ 後面每一株植被、每一棟建物的佈局整條推移,而畫面上
//      只表現成「整張圖變了」。`audit_siteplan` / `audit_beacons` / `audit_object_joints`
//      **照樣全綠**(它們驗規則不驗位置)⇒ 判準是「逐項不變」而不是「仍全綠」,而這一支
//      在源頭把它釘住:規劃器只准吃專屬 `mulberry32`,而且逐粒消耗**固定枚數**。
//   ② **只剩一個頻率**:讀起來是機械擺動不是空氣。判據 MUST 是**軌跡上量到的極值數**
//      而不是文字比對 —— 文字改對而行為仍錯是這一族最常見的假綠。
//   ③ **自轉軸塌成一個方向**:一地的硬幣。判據是 N 顆粒子軸向量的平均長度。
//   ④ **環繞取模改用世界軸**:一小時之後那叢花不在那叢樹上了,而每一幀單看都是對的。
//   ⑤ **預跑被拿掉**:首幀 y 全部擠在頂端。這一條連「看起來怪」都要等到開場那三秒。
// GLSL 一行都不在這一族裡(落花刻意走 CPU 步進,理由見 `petals.js` 檔頭)⇒ **規則層可以
// 真的執行**,這是本檔絕大多數斷言都是行為直測而不是原文比對的原因。
import { readSrc, grabFn } from './audit_src.mjs';
import { mulberry32 } from '../public/js/rng.js';
import { ENV } from '../public/js/data.js';

const BREAKS = new Set(process.argv.slice(2).filter((a) => a.startsWith('--break-')));
let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.error(`  ✗ ${msg}`)); };
const sec = (t) => console.log(`\n▍${t}`);
/** 只留「真的會執行的程式碼」—— 規則本身就寫在註解裡引用那些名字,不剝的話說明會把自己判成違規 */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const count = (s, re) => [...s.matchAll(re)].length;
/**
 * 反向驗證的字面替換。替換無效 MUST **當場失敗**(§5.4 ㋑):`readSrc` 已把換行正規化成 `\n`,
 * 但樣式一旦與原文對不上,break 會安靜地變成 no-op 而整支照樣全綠 —— 2026-08-14 的
 * `--break-roof` 就是這樣把紅字從 2 條掉成 1 條而壞版根本沒被造出來。
 * 樣式一律 CRLF 容忍(`\r?\n`),而且 **MUST NOT 綁死在任何現值上**。
 */
const bend = (src, tag, re, to) => {
  if (!BREAKS.has(tag)) return src;
  const out = src.replace(re, to);
  if (out === src) { console.error(`✗ ${tag}:替換無效(樣式沒咬到原文,反向驗證等於沒跑)`); process.exit(1); }
  return out;
};

const petalSrc0 = readSrc('public', 'js', 'petals.js');
const biomesSrc0 = readSrc('public', 'js', 'biomes.js');
const gameSrc = readSrc('public', 'js', 'game.js');

// ---- 壞版注入(規則層)----
let petalSrc = petalSrc0;
petalSrc = bend(petalSrc, '--break-tone', /hexOf\(ar, ag, ab\),/, '0xffb7c5,');
petalSrc = bend(petalSrc, '--break-petal', / \+ PETAL\.SWAY_FAST \* s2\);/, ');');
petalSrc = bend(petalSrc, '--break-spin',
  /ax: Math\.cos\(at\) \* sr, ay: az, az: Math\.sin\(at\) \* sr,/, 'ax: 0, ay: 1, az: 0,');
petalSrc = bend(petalSrc, '--break-wrap',
  /p\.ox = Math\.cos\(p\.a\) \* rad;/, 'p.ox = (p.ox + 2.5 * d) % 4000;');
petalSrc = bend(petalSrc, '--break-prewarm',
  /export function prewarmField\(f\) \{\r?\n\s*if \(!f\.ps\?\.length\) return;/,
  'export function prewarmField(f) {\n  if (f) return;');
petalSrc = bend(petalSrc, '--break-rnd',
  /const tu = rnd\(\);/, 'const tu = rad > f.r * 0.5 ? rnd() : 0.5;');

// ---- 壞版注入(接線層;`biomes.js` import three ⇒ 只驗原文)----
let biomesSrc = biomesSrc0;
biomesSrc = bend(biomesSrc, '--break-shared', /\}, petalRnd\(gseed\)\);/, '}, rnd);');
biomesSrc = bend(biomesSrc, '--break-off',
  /const petalMode = PETAL_OFF \? null : petalSeason\(season\);/,
  'const petalMode = petalSeason(season);');

// ---- 真的把規則層跑起來(零 THREE 的全部回報)----
// MUST 用原文 + `new Function` 而不是 `import`:import 進來的是真品,`--break-*` 咬不到它。
const P = new Function('mulberry32',
  `${petalSrc.replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '')}
   return { PETAL, petalSeason, petalTones, groupCrowns, planPetalFields, prewarmField, stepPetal, petalRnd };`,
)(mulberry32);
const { PETAL, petalSeason, petalTones, groupCrowns, planPetalFields, stepPetal, petalRnd } = P;

console.log('== 環境動態稽核(落花 / 落葉粒子)==');

// ---------------------------------------------------------------- Ⅰ
sec('Ⅰ 邊界(規則層 vs 幾何層)');
{
  const imports = [...petalSrc0.matchAll(/^import .*from '([^']+)'/gm)].map((m) => m[1]);
  ok(imports.length === 1 && imports[0] === './rng.js',
    `petals.js 零 THREE、只 import rng.js(實得 ${imports.join(',') || '(無)'})—— 這是本項離線可驗的唯一理由`);
  ok(!/THREE|three/.test(code(petalSrc0)), 'petals.js 原文不出現 THREE(規則是純資料,幾何住 biomes.js)');
  ok(!/Math\.random\(/.test(code(petalSrc0)), '散布路徑不得用 Math.random(A4 / §2.3)');
  ok(!/document|window|location/.test(code(petalSrc0)), 'petals.js 零 DOM(同 flags.js 的邊界)');
  ok(/from '\.\/petals\.js'/.test(biomesSrc0), 'biomes.js 從 petals.js 取規則(而不是自己抄一份)');
}

// ---------------------------------------------------------------- Ⅱ
sec('Ⅱ 季節閘與色調推導');
{
  ok(petalSeason('spring') === 'bloom'
    && petalSeason('summer') === 'leaf'
    && petalSeason('autumn') === 'leaf'
    && petalSeason('winter') === 'leaf',
    '四季專屬落花落葉: 春 = 櫻花(bloom) / 夏 = 綠葉(leaf) / 秋 = 楓紅(leaf) / 冬 = 枯葉(leaf)');
  ok(petalSeason(undefined) === null && petalSeason('invalid') === null,
    '缺季/無效季一律不下(季節閘;整段不建立 ⇒ 逐位元同舊制)');

  const tonesSrc = code(grabFn(petalSrc, 'petalTones'));
  ok(!/0x[0-9a-fA-F]{3,}/.test(tonesSrc),
    'petalTones 內沒有任何十六進位色值(三色調 MUST 由 ENV.seasons 推導,手寫那一份會在調季節色盤時靜默過期)');

  const row = { foliage: 0x204080, accent: 0x804020 };
  const t1 = petalTones(row, 'bloom');
  const t2 = petalTones({ foliage: 0x204080, accent: 0x40c060 }, 'bloom');
  ok(t1.length === 3, '恰三個色調(對應 TONE_W 三格)');
  ok(t1.every((v, i) => v !== t2[i]),
    '換掉 accent ⇒ 三個色調全部跟著換(任一格沒動 = 那一格是寫死的)');
  const t3 = petalTones(row, 'leaf');
  ok(t1[2] !== t3[2] && t1[0] === t3[0],
    '第三色調的混色比逐模式不同(落葉混得多、落花只混一點點:粉混綠會變灰,那不是花)');
  ok(PETAL.TONE_W.length === 3 && Math.abs(PETAL.TONE_W.reduce((a, b) => a + b, 0) - 1) < 1e-9,
    `三色調權重和為 1(實得 ${PETAL.TONE_W.join('/')})`);
  ok(petalTones(ENV.seasons.spring, 'bloom')[0] === ENV.seasons.spring.accent
    && petalTones(ENV.seasons.summer, 'leaf')[0] === ENV.seasons.summer.accent
    && petalTones(ENV.seasons.autumn, 'leaf')[0] === ENV.seasons.autumn.accent
    && petalTones(ENV.seasons.winter, 'leaf')[0] === ENV.seasons.winter.accent,
    '主色調 = 該季的 ENV.seasons[].accent (春櫻花 / 夏綠葉 / 秋楓紅 / 冬枯葉)');
}

// ---------------------------------------------------------------- 共用的測試場
// 八叢各 40 棵的落葉林(每叢落在自己那一個 CELL_M 格內)+ 一叢 3 棵(不足 MIN_CROWNS,MUST 被丟掉)。
// 叢數 > MAX_FIELDS ⇒ 場數上限與低功耗階梯**真的會咬到**(叢數不足時那兩條斷言是恆真的)。
const mkCrowns = () => {
  const cs = [];
  const R = mulberry32(0x1234);
  for (let g = 0; g < 8; g++) {
    const gx = (g % 4) * PETAL.CELL_M + PETAL.CELL_M / 2;
    const gz = Math.floor(g / 4) * PETAL.CELL_M + PETAL.CELL_M / 2;
    for (let i = 0; i < 40 - g; i++) {   // 逐叢棵數遞減 ⇒ 「依棵數降冪取前 K」量得到
      cs.push({ x: gx + (R() - 0.5) * 90, z: gz + (R() - 0.5) * 90, top: 12 + R() * 6, r: 3 + R() * 2 });
    }
  }
  for (let i = 0; i < 3; i++) cs.push({ x: 2000 + R() * 20, z: 2000 + R() * 20, top: 11, r: 3 });
  return cs;
};
const OPTS = {
  mode: 'leaf',
  groundAt: (x, z) => 3 + Math.sin(x * 0.01) * 2 + Math.cos(z * 0.013) * 2,
  dryAt: () => true,
  low: false,
};

// ---------------------------------------------------------------- Ⅲ
sec('Ⅲ 分群與落點(場一律由最終植被實例名冊推導)');
{
  const cs = mkCrowns();
  const gs = groupCrowns(cs, PETAL.MAX_FIELDS);
  ok(gs.length >= 1 && gs.length <= PETAL.MAX_FIELDS, `場數夾在 MAX_FIELDS(實得 ${gs.length})`);
  ok(gs.every((g) => g.n >= PETAL.MIN_CROWNS),
    `每一場至少 ${PETAL.MIN_CROWNS} 棵(孤木飄花讀起來像特效不像天氣;3 棵那一叢 MUST 被丟掉)`);
  ok(gs.every((g, i) => i === 0 || gs[i - 1].n >= g.n), '依棵數降冪定序(取前 K 才有意義)');
  // 場的中心/半徑 MUST 由該群自己的外廓推導
  const big = gs[0];
  const mine = cs.filter((c) => Math.hypot(c.x - big.cx, c.z - big.cz) <= big.r + 1e-9);
  ok(mine.length >= big.n, '場的半徑蓋得住自己那一群的每一棵冠緣(半徑推導不手寫)');
  const cell = cs.filter((c) => Math.floor(c.x / PETAL.CELL_M) === Math.floor(big.cx / PETAL.CELL_M)
    && Math.floor(c.z / PETAL.CELL_M) === Math.floor(big.cz / PETAL.CELL_M));
  ok(big.top === Math.max(...cell.map((c) => c.top)), '場的頂 = 群裡最高的冠頂');
  // 順序無關(跨客戶端逐位元一致的前提)
  const gs2 = groupCrowns([...cs].reverse(), PETAL.MAX_FIELDS);
  ok(gs.length === gs2.length && gs.every((g, i) => Math.abs(g.cx - gs2[i].cx) < 1e-9
    && Math.abs(g.cz - gs2[i].cz) < 1e-9 && g.n === gs2[i].n),
    '輸入順序反過來 ⇒ 同一組場(分群零亂數、定序含座標 tie-break)');
  // 地貌閘:水/沼上不下花
  const wet = planPetalFields(cs, { ...OPTS, dryAt: () => false }, petalRnd(1));
  ok(wet.parts.length === 0, '地貌閘全擋(水域/沼澤)⇒ 零粒子、零 mesh(寧缺勿錯)');
}

// ---------------------------------------------------------------- Ⅳ
sec('Ⅳ 逐粒運動(兩頻率 / 自轉軸 / 沿中心線環繞 / dt 夾制)');
{
  ok(PETAL.SWAY_SLOW + PETAL.SWAY_FAST < 1,
    `兩個擺幅相加 < 1(否則軌道半徑會翻負 = 花瓣瞬間跳到對面;實得 ${(PETAL.SWAY_SLOW + PETAL.SWAY_FAST).toFixed(3)})`);
  ok(PETAL.SWAY_FAST * PETAL.F_FAST > PETAL.SWAY_SLOW * PETAL.F_SLOW,
    `快顫在速度上壓得過慢波(${(PETAL.SWAY_FAST * PETAL.F_FAST).toFixed(3)} > ${(PETAL.SWAY_SLOW * PETAL.F_SLOW).toFixed(3)});反過來的話「兩頻率」只剩註解`);
  // 不可通約:與最近的小分母有理數要有距離(同 SOFT_KINDS 的 freq/BEAT 那條規則)
  let near = 1;
  for (let q = 1; q <= 6; q++) for (let p2 = 1; p2 <= 6 * q; p2++) {
    near = Math.min(near, Math.abs(PETAL.F_FAST / PETAL.F_SLOW - p2 / q));
  }
  ok(near > 0.05,
    `兩個頻率不可通約(離最近的 p/q(q≤6)有 ${near.toFixed(3)});通約 = 看得出重複點`);
  ok(PETAL.DT_MAX > 0 && PETAL.DT_MAX <= 0.25,
    `單幀 dt 夾在 ${PETAL.DT_MAX}(與 toon.stepCelWind 同值同理由:分頁切回來那一幀的 dt 是好幾秒)`);

  const { fields, parts } = planPetalFields(mkCrowns(), OPTS, petalRnd(7));
  ok(parts.length > 0 && parts.length <= PETAL.MAX_TOTAL, `粒子總數夾在 MAX_TOTAL(實得 ${parts.length})`);
  const low = planPetalFields(mkCrowns(), { ...OPTS, low: true }, petalRnd(7));
  ok(low.parts.length <= PETAL.MAX_TOTAL_LOW && low.fields.length <= PETAL.MAX_FIELDS_LOW
    && low.parts.length < parts.length,
    `低功耗階梯真的收得住(${low.parts.length} 顆 / ${low.fields.length} 場 < ${parts.length} / ${fields.length})`);

  // ── 兩頻率:判據是**軌跡上量到的極值數**,不是文字比對 ──
  // 只有慢波時軌道半徑每秒約 F_SLOW/π 個極值;加了快顫(速度上壓過慢波)之後約 F_FAST/π。
  // 期望值由 PETAL 常數推導 ⇒ `--break-petal` 不會把門檻一起帶著跑(§5.4 ㋑)。
  {
    const p = { ...parts[0] };
    const T = 20, dt = 1 / 120;
    let t = 0, prev = null, prevD = 0, ext = 0;
    for (let i = 0; i < T / dt; i++) {
      t += dt; stepPetal(p, dt, t);
      const R = Math.hypot(p.ox, p.oz);
      if (prev !== null) { const d = R - prev; if (d * prevD < 0) ext++; if (d !== 0) prevD = d; }
      prev = R;
    }
    const wantFast = PETAL.F_FAST * T / Math.PI * 0.8;
    ok(ext >= wantFast,
      `軌道半徑 ${T}s 內量到 ${ext} 個極值 ≥ ${wantFast.toFixed(1)}(慢波 + 快顫;只剩慢波約 ${(PETAL.F_SLOW * T / Math.PI).toFixed(1)} 個 = 機械擺動不是空氣)`);
  }

  // ── 自轉軸逐粒不同 ──
  {
    let sx = 0, sy = 0, sz = 0, unit = true;
    for (const p of parts) {
      sx += p.ax; sy += p.ay; sz += p.az;
      if (Math.abs(Math.hypot(p.ax, p.ay, p.az) - 1) > 1e-9) unit = false;
    }
    const mean = Math.hypot(sx, sy, sz) / parts.length;
    ok(unit, '每一片的自轉軸都是單位向量');
    ok(mean < 0.35, `自轉軸不塌成一個方向(平均長度 ${mean.toFixed(3)} < 0.35;全部繞 +Y ⇒ 1.000 = 一地的硬幣)`);
    const spins = new Set(parts.map((p) => p.sp.toFixed(6)));
    ok(spins.size > parts.length * 0.5, `自轉角速度也逐粒不同(${spins.size} / ${parts.length})`);
  }

  // ── 沿場中心線環繞:一小時之後仍蓋在那叢樹上 ──
  {
    const ps = parts.map((p) => ({ ...p }));
    const dt = 1 / 30, T = 600;
    let t = 0, worstOff = 0, minOy = Infinity, maxOyOver = -Infinity, cx = 0, cz = 0, cN = 0;
    for (let i = 0; i < T / dt; i++) {
      t += dt;
      let mx = 0, mz = 0;
      for (const p of ps) {
        stepPetal(p, dt, t);
        const off = Math.hypot(p.ox, p.oz);
        const cap = p.r * (1 + PETAL.SWAY_SLOW + PETAL.SWAY_FAST);
        if (off - cap > worstOff) worstOff = off - cap;
        if (p.oy < minOy) minOy = p.oy;
        if (p.oy - (p.h + 2 * PETAL.BOB) > maxOyOver) maxOyOver = p.oy - (p.h + 2 * PETAL.BOB);
        mx += p.ox; mz += p.oz;
      }
      if (i % 30 === 0) { cx += mx / ps.length; cz += mz / ps.length; cN++; }
    }
    const fr = Math.max(...fields.map((f) => f.r));
    // 質心量的是**時間平均**而不是某一幀 —— 有限顆粒子的瞬時質心本來就有 r/√(2N) 的統計
    // 起伏(那不是漂移);繞中心線的相位在一個週期上平均掉之後,真正的漂移才留得下來。
    const drift = Math.hypot(cx, cz) / cN;
    ok(worstOff <= 1e-6,
      `${T}s 之後每一片仍在自己的軌道包絡內(最大超出 ${worstOff.toExponential(2)}m;世界軸漂移會讓它一路跑掉)`);
    ok(drift < fr * 0.05,
      `粒子群質心的時間平均恆貼著場心(${drift.toFixed(2)}m < 場半徑 ${fr.toFixed(1)}m 的 5%)`);
    ok(minOy >= -1e-9 && maxOyOver <= 1e-6,
      `垂直恆留在自己的高度帶內(最低 ${minOy.toFixed(3)}m ≥ 0、最高超出 ${maxOyOver.toExponential(2)}m)`);
  }

  // ── dt 夾制與髒值防禦 ──
  {
    const p = { ...parts[0] };
    const y0 = p.y;
    stepPetal(p, 9, 1);
    const drop = ((y0 - p.y) % p.h + p.h) % p.h;
    ok(drop <= PETAL.FALL_MAX * PETAL.DT_MAX + 1e-9,
      `單幀 dt = 9s 只落 ${drop.toFixed(3)}m ≤ ${(PETAL.FALL_MAX * PETAL.DT_MAX).toFixed(3)}m(不夾 = 切回分頁那一瞬間整場落花瞬移)`);
    const q = { ...parts[1] };
    stepPetal(q, NaN, 1); stepPetal(q, -5, 1); stepPetal(q, undefined, 1);
    ok(Number.isFinite(q.y) && Number.isFinite(q.ox) && Number.isFinite(q.oy),
      'NaN / 負值 / undefined 的 dt 不得產生 NaN(一顆 NaN 進矩陣 = 那一批 InstancedMesh 整批消失)');
  }
}

// ---------------------------------------------------------------- Ⅴ
sec('Ⅴ 建構期預跑(首幀就是「一直在下」的樣子)');
{
  const pw = code(grabFn(petalSrc, 'prewarmField'));
  ok(/PETAL\.PREWARM_STEP/.test(pw) && /PETAL\.FALL_MIN/.test(pw),
    '預跑步數由「最慢的那一片走完整條高度帶」推導(手寫步數在高的帶上只走得了一小截,而每一條斷言都會過)');
  ok(!/\b(20|30|40|50|60)\b/.test(pw), '預跑區塊裡沒有手寫的步數常數');

  const { fields } = planPetalFields(mkCrowns(), OPTS, petalRnd(11));
  const f = fields[0];
  // 逐粒的高度帶不同(地表起伏)⇒ 一律**正規化**成自己那一條帶上的比例再看分布
  const us = f.ps.map((p) => p.y / p.h).sort((a, b) => a - b);
  let gap = us[0];
  for (let i = 1; i < us.length; i++) gap = Math.max(gap, us[i] - us[i - 1]);
  gap = Math.max(gap, 1 - us[us.length - 1]);
  ok(us[0] < 0.15 && us[us.length - 1] > 0.85,
    `首幀的 y 已經跨越整條高度帶(帶上比例 ${us[0].toFixed(2)} ~ ${us[us.length - 1].toFixed(2)};沒預跑 ⇒ 恆為 1.00)`);
  ok(gap < 0.35, `帶內沒有空段(最大間隙 ${(gap * 100).toFixed(1)}% < 35%)`);
}

// ---------------------------------------------------------------- Ⅵ
sec('Ⅵ 決定性與亂數帳(§2.3)');
{
  let n = 0;
  const seedRnd = petalRnd(21);
  const counted = () => { n++; return seedRnd(); };
  const { parts } = planPetalFields(mkCrowns(), OPTS, counted);
  ok(n === parts.length * PETAL.RND_PER_PETAL,
    `逐粒消耗固定 ${PETAL.RND_PER_PETAL} 枚(實得 ${n} 枚 / ${parts.length} 片;不固定 = 序列與「抽了幾片」耦合)`);

  const a = planPetalFields(mkCrowns(), OPTS, petalRnd(33));
  const b = planPetalFields(mkCrowns(), OPTS, petalRnd(33));
  const same = a.parts.length === b.parts.length
    && a.parts.every((p, i) => p.r === b.parts[i].r && p.y === b.parts[i].y && p.ax === b.parts[i].ax);
  ok(same, '同種子 ⇒ 逐位元同一組粒子(跨客戶端一致的前提)');
  const c = planPetalFields(mkCrowns(), OPTS, petalRnd(34));
  ok(c.parts.some((p, i) => p.r !== a.parts[i]?.r), '換種子 ⇒ 真的換一組(種子沒接上就是全場同一份)');

  const rs = code(grabFn(petalSrc, 'petalRnd'));
  ok(/mulberry32\(/.test(rs) && /\^/.test(rs),
    '專屬亂數 = 共享種子 XOR 一個專屬常數(mulberry32 是全專案唯一縫)');
}

// ---------------------------------------------------------------- Ⅶ
sec('Ⅶ 接線契約(biomes.js 原文)');
{
  const blk = code(grabFn(biomesSrc, 'buildPetals'));
  const crown = code(grabFn(biomesSrc, 'foliageCrown'));
  const B = code(biomesSrc);

  // 落點的唯一來源 = 最終的植被實例名冊
  ok(/function buildPetals\(group, terrain, items,/.test(biomesSrc) && /for \(const type in items\)/.test(blk),
    '落點由最終的植被實例名冊 items 推導(建物過濾已完成的那一份)');
  ok(/p\.key === 'foliage'/.test(crown),
    "判據是既有欄位 `key: 'foliage'`(另開一張樹種名單遲早與季節換色那一份分家)");
  const st = () => ({});
  const VEG = new Function('cyl', 'cone', 'ico',
    `${/^const VEG_DEFS = \{[\s\S]*?^\};/m.exec(biomesSrc)[0]}\nreturn VEG_DEFS;`)(st, st, st);
  const names = Object.keys(VEG);
  const leaky = names.filter((k) => new RegExp(`['"]${k}['"]`).test(blk + crown));
  ok(leaky.length === 0, `落花接線裡沒有任何逐樹種名冊${leaky.length ? `;越界:${leaky.join(',')}` : ''}`);
  const foliage = names.filter((k) => VEG[k].parts.some((p) => p.key === 'foliage'));
  ok(foliage.length > 0 && !foliage.includes('conifer') && !foliage.includes('silvergrass'),
    `落葉樹種由推導得出(${foliage.join('/')});針葉常綠與草類自動排除`);
  ok(/bb\.max\.y/.test(crown) && !/partGeo\(/.test(crown),
    '冠頂高只讀保險絲 p.g(庫幾何載不載得到逐客戶端不同,讀它 = 碰撞與落點跨客戶端分家)');

  // 零共享 rnd 消耗(§2.3 的那一顆地雷)
  ok(/planPetalFields\([\s\S]*?petalRnd\(gseed\)\)/.test(B),
    '規劃器吃的是專屬 petalRnd(gseed);共享 rnd 多抽一枚 = 後面每一株植被的佈局整條推移');
  ok(!/(?<![A-Za-z_$])g?rnd\(/.test(blk) && !/(?<![A-Za-z_$])g?rnd\(/.test(crown),
    '落花區塊內零共享 rnd()/grnd() 呼叫');
  ok(!/Math\.random\(/.test(blk), '落花區塊內零 Math.random(A4)');

  // A25 資源生命週期
  ok(count(B, /markShared\(new THREE\.PlaneGeometry\(1, 1\)\)/g) === 1
    && /_petalGeo \?\?= markShared\(/.test(B),
    '單位四邊形整場只有一份且 markShared 註冊(共用幾何被 disposeTree 放掉 ⇒ 所有借用者變空白)');
  ok(count(blk, /new THREE\.InstancedMesh\(petalGeo\(\)/g) === 1,
    '逐色調各一顆 InstancedMesh,幾何共用同一份(高頻件 MUST NOT 重配幾何)');
  ok(/userData\.noOutline = true/.test(blk), '不掛反轉外殼描邊(0.2m 的碎片會糊成一團黑)');
  ok(/depthWrite: false/.test(blk) && /transparent: true/.test(blk),
    '半透明 + 不寫深度(勾線 pass 是深度二階差分 ⇒ 落花構造上不出線)');
  ok(/castShadow = false/.test(blk) && /frustumCulled = false/.test(blk),
    '不投影 + 關 frustum(實例散佈全圖,包圍球不可靠)');
  ok(/rim: 0/.test(blk) && /envMat\(/.test(blk) && !/new THREE\.ShaderMaterial/.test(blk),
    '材質走 envMat(自寫 ShaderMaterial MUST 手動宣告 gInfo,而 envMat 連世界曲面一起免費繼承)');

  // 逐幀更新的唯一路徑
  ok(count(blk, /dynamics\.push\(/g) === 1,
    '逐幀步進只掛一條,而且掛在既有的 dynamics 桶(climb.js 檔頭:MUST NOT 在 game.js 另開第二條迴圈)');
  ok(/Math\.min\(PETAL\.DT_MAX/.test(blk), '逐幀 dt 在接線端也夾一次(與 stepCelWind 同一個理由)');
  ok(!/petals\.js|stepPetal|buildPetals/.test(code(gameSrc)), 'game.js 完全不認得落花(第二條迴圈的唯一入口)');

  // killswitch:整段不建立
  ok(/const PETAL_OFF = typeof location !== 'undefined' && \/\[\?&\]petal=0\//.test(B),
    '?petal=0 走既有慣例(同 ?sag=0 / ?morph=0 / ?gait=0)');
  ok(/const petalMode = PETAL_OFF \? null : petalSeason\(season\);/.test(B)
    && /petalMode \? buildPetals\(/.test(B),
    '關掉 = **整段不建立**(零 mesh、零 dynamics 條目);「建了但每幀不更新」不算 —— 那留著 draw call 與記憶體');

  // 排序:MUST 排在 items 定案之後
  // indexOf 比的是**呼叫點**不是函式定義(定義擺在 buildVegMeshes 旁邊,會排在前面)
  ok(B.indexOf('petalMode ? buildPetals(') > B.indexOf('const meshes = nature[type]'),
    '接線排在植被建模(= items 定案)之後');
}

console.log(`\n${fail ? '❌' : '🎉'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail ? 1 : 0);
