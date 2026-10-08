// ============ Fire-rate compression + burst presentation audit ============
// Purpose: run after changing `data.js` `FIRE_RATE`/`RATE_DEF`/`rateComp()`/`compressWeapon()`/`fireBurstN()`/
// `fireBurstGap()`, any character weapon `rate`/`dmg`/`mag`, `recoilTier` fire-rate tiers,
// or `game.js` `_queueBurst`/`_tickBurstFx`/`_burstEchoSelf`/`_burstEchoOther`,
// or `tools/lanesim.mjs` `reFire()`.
//
// User decision (2026-08-02): "DPS unchanged, lower light/heavy fire rates, higher rates drop more,
// narrowing rate spread but preserving rate ranking; high-rate weapons get matching animation,
// e.g. MG as 3-round burst dealing one logical hit, so attack animation looks continuous".
// All five are **measurable invariants**, each pinned below:
//
//   1 DPS unchanged — burst DPS (dmg x rate) and **sustained** DPS (magazine-cycle averaged) must both hold.
//                    Verifying burst only is the easiest hole: without `mag x f`, sustained DPS
//                    inflates up to 33.5% (longer magazine = fewer reloads) while burst DPS looks fine.
//   2 Faster drops more — reduction `1 - rateComp(r)/r` is non-decreasing in r.
//   3 Narrower spread — post-compression rate max/min ratio strictly smaller than before.
//   4 Ranking unchanged — `rateComp` strictly increasing (a guarantee, not coincidence);
//                        re-verified pairwise on the live 32-character dataset.
//   5 Burst presentation — N = round(rate0/rate), visual pulse rate ~= original rate, N shots spread
//                    **evenly** across the firing cycle (a "rapid burst + gap" is not the
//                    continuous look the user asked for).
//
// Two more anti-patterns:
//   6 Burst is **presentational only**: the fill-in path MUST NOT send network messages,
//      MUST NOT enter `this.bullets`, MUST NOT consume ammo — any breach is A1 (client-side
//      self-added damage) showing only as inflated damage numbers.
//   7 `recoilTier` MUST consume pre-compression `rate0`: after compression every light weapon
//      drops below 7, so the `rate >= 7` branch would go dead and MGs would silently drop
//      from high to med (feel changes with no error).
//
// V also verifies `lanesim.reFire`: the old model `next = t + 1/rate` discarded sub-tick
// remainder every shot, so effective rate lost up to 43% to step quantization — measuring
// "which side of the grid the rate falls on" instead of weapon strength. Compression re-seats
// every light weapon on the grid, so this old bug would otherwise surface in bal 7c as
// "some chassis inexplicably stronger".
//
// Usage: `node tools/audit_fire_rate.mjs` (no server/browser needed)
// Source reading/method extraction go through the `audit_src.mjs` single seam (newline
// normalization included — naive per-line comment stripping silently fails on CRLF checkouts).
import { readSrc, grabMethod, grabFn } from './audit_src.mjs';
import {
  FIRE_RATE, RATE_DEF, rateComp, compressWeapon, fireBurstN, fireBurstGap,
  CHARACTERS, heroWeapon, recoilName, tierVal, GAME,
} from '../public/js/data.js';

const src = readSrc('public', 'js', 'game.js');
const dataSrc = readSrc('public', 'js', 'data.js');
const laneSrc = readSrc('tools', 'lanesim.mjs');

/** "Only N occurrences in the whole file" counts MUST scan **executable source** only (comments/imports may mention the same name) */
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
const code = strip(src).split("} from './data.js';").slice(1).join("} from './data.js';");
const laneCode = strip(laneSrc);

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const count = (s, needle) => s.split(needle).length - 1;
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

/** Every live character weapon (32 characters x two slots) */
const WS = Object.entries(CHARACTERS).flatMap(([ch, c]) => ['light', 'heavy']
  .filter((s) => c[s]).map((slot) => ({ ch, slot, w: c[slot] })));
/** Pre-compression rate of a weapon (uncompressed weapons have no rate0, so rate itself is the original) */
const rate0Of = (w) => w.rate0 ?? w.rate ?? RATE_DEF;
const LVLS = [1, 2, 3, 4];

// ---------------------------------------------------------------------------
console.log('■ Ⅰ 壓縮曲線(rateComp:錨點以下不動 / 越快降越多 / 嚴格遞增 ⇒ 排名不變)');
// ---------------------------------------------------------------------------
{
  t('錨點 PIVOT === RATE_DEF(推導不手寫)', FIRE_RATE.PIVOT === RATE_DEF, `${FIRE_RATE.PIVOT} vs ${RATE_DEF}`);
  // Why the anchor: none of the 32 heavy weapons tags a rate, all sit on the default — that is the floor of the live rate band.
  const heavyNoRate = WS.filter((x) => x.slot === 'heavy').every((x) => x.w.rate0 === undefined && x.w.rate === undefined);
  t('32 把重武器皆未標 rate(錨點落在預設值上的理由)', heavyNoRate);

  t('錨點以下逐位元原值', [0.5, 1, 2.2, 2.9, RATE_DEF].every((r) => rateComp(r) === r));
  // Strict increase is the **guarantee** behind rank preservation. An integer-ratio scheme
  // (rate/N) fails here: rate 8 -> 4.0 while rate 9 -> 3.0.
  let mono = true, cut = [];
  for (let r = 0.2; r <= 40; r += 0.01) {
    if (rateComp(r + 0.01) <= rateComp(r) - 1e-12) mono = false;
    cut.push([r, 1 - rateComp(r) / r]);
  }
  t('嚴格遞增(射速排名不變的保證)', mono);
  let cutMono = true;
  for (let i = 1; i < cut.length; i++) if (cut[i][1] < cut[i - 1][1] - 1e-12) cutMono = false;
  t('折減率隨射速單調不減(「射速越高降越多」)', cutMono);
  t('折減率恆 ≥ 0(只降不升)', cut.every(([, c]) => c >= -1e-12));

  // Reverse-verification anchor: K >= 1 drops the whole rule set bit-identically (a broken rule must be detectable)
  const K0 = FIRE_RATE.K;
  FIRE_RATE.K = 1;
  const off = [2.2, 5, 10, 18, 40].every((r) => rateComp(r) === r)
    && compressWeapon({ rate: 10, dmg: [11, 14, 17], mag: [40, 50, 60] }) === null;
  FIRE_RATE.K = K0;
  t('K ≥ 1 ⇒ 逐位元回到舊制(反向驗證的錨)', off);

  // Constants MUST NOT be hand-copied by consumers
  t('game.js 原文無手寫連發數 / 壓縮指數', !/fireBurstN\s*=|FIRE_RATE\.(K|PIVOT|BURST_MAX)/.test(code));
  t('game.js MUST NOT 自己 round(rate0 / rate)', !/Math\.round\([^)]*rate0/.test(code));
}

// ---------------------------------------------------------------------------
console.log('■ Ⅱ DPS 不變(compressWeapon 純函式:合成掃描,爆發 + 持續雙軌)');
// ---------------------------------------------------------------------------
{
  // Synthetic sweep: covers the full live envelope (rate 2.2~18 / mag 7~110 / reload 1.8~12).
  // Uses pure functions, never a "pre-compression snapshot" — the audit MUST NOT depend on git or a second data copy.
  //
  // **The only error source is mag integer rounding** (`st.ammo` decrements per shot, so magazines
  // must be integers), bounded by half a round over the compressed magazine size. The sweep therefore
  // only covers combos with at least MAG_MIN rounds post-compression, and section III pins that
  // **no live weapon falls outside this range** (otherwise the guarantee below would not apply).
  // Live minimum Lv1 magazine of compressed weapons (pinned separately in III) — the threshold for
  // the "guarantee applies" scope. Derived, MUST NOT be hand-written: it follows the data.
  // (With the whole rule set off, no weapon is compressed ⇒ falls back to 1, so the stats below
  // naturally become an empty set instead of Infinity)
  const trimmedMags = Object.values(CHARACTERS)
    .flatMap((c) => ['light', 'heavy'].map((sl) => c[sl]))
    .filter((w) => w?.rate0 !== undefined).map((w) => tierVal(w.mag ?? 1, 1));
  const MAG_MIN = trimmedMags.length ? Math.min(...trimmedMags) : 1;
  let maxBurst = 0, maxSus = 0, maxCyc = 0, maxBnd = 0, cases = 0, anchored = 0, inBound = true, worst = '';
  for (const rate of [2.2, 2.4, 3, 3.2, 3.5, 4.5, 5, 5.5, 6, 6.5, 7, 8, 9, 10, 12, 14, 16, 18]) {
    for (const mag of [7, 15, 20, 30, 40, 50, 60, 70, 90, 110]) {
      for (const reload of [1.8, 2.2, 2.8, 7, 8, 11, 12]) {
        const dmg = [11, 14, 17];
        const out = compressWeapon({ rate, dmg, mag, reload });
        if (!out) { anchored++; continue; }
        for (let i = 0; i < 3; i++) {
          const r1 = tierVal(out.rate, i + 1), d1 = tierVal(out.dmg, i + 1), m1 = tierVal(out.mag, i + 1);
          const cyc0 = mag / rate + reload, cyc1 = m1 / r1 + reload;
          const s0 = dmg[i] * mag / cyc0, s1 = d1 * m1 / cyc1;
          // **Structural bound**: the only error source is magazine integer rounding (at most half a
          // round ⇒ cycle off by at most (0.5/r1) seconds, plus the "half round missing" term on
          // sustained DPS). Both verified **per case** (no threshold, no hand-written percent):
          // a breach means the error leaked outside integer rounding = the three-column scaling
          // rule is wrong, invisibly.
          const bound = (0.5 / r1) / cyc0 + 1e-9;
          if (Math.abs(cyc1 / cyc0 - 1) > bound) { inBound = false; worst = `週期 rate ${rate} mag ${mag} reload ${reload}`; }
          if (Math.abs(s1 / s0 - 1) > bound + 0.5 / m1 + 1e-6) { inBound = false; worst = `持續 rate ${rate} mag ${mag} reload ${reload}`; }
          maxBurst = Math.max(maxBurst, Math.abs(d1 * r1 / (dmg[i] * rate) - 1));
          if (m1 < MAG_MIN) continue;   // The two "live-scale" stats below only cover magazines >= the live minimum
          cases++;
          maxSus = Math.max(maxSus, Math.abs(s1 / s0 - 1));
          maxCyc = Math.max(maxCyc, Math.abs(cyc1 / cyc0 - 1));
          maxBnd = Math.max(maxBnd, bound + 0.5 / m1);
        }
      }
    }
  }
  t(`錨點(含)以下一律原樣回傳 — ${anchored} 組`, anchored > 0);
  t(`爆發 DPS(dmg × rate)不變 — 最大偏差 ${(maxBurst * 100).toFixed(3)}%`, maxBurst < 0.005);
  t('唯一誤差源是彈夾整數化(逐案例 ≤ 半發的週期上界)', inBound, worst);
  // Thresholds are **structural bounds** (derived, never hand-written): a fixed 1% would only record
  // "how much it happens to be now" and turn into a false red the moment data moves; as a bound it
  // always asks "did the error escape integer rounding".
  t(`持續 DPS(彈夾週期攤平)不變 — ${cases} 組(彈夾 ≥ ${MAG_MIN} 發)最大偏差 ${(maxSus * 100).toFixed(2)}%(上界 ${(maxBnd * 100).toFixed(2)}%)`, maxSus <= maxBnd);
  t(`彈夾週期 mag/rate + reload 不變 — 最大偏差 ${(maxCyc * 100).toFixed(2)}%`, maxCyc <= maxBnd);
  // The old hole without the mag x f term: sustained DPS would inflate (computed here directly as a counter-example)
  const bad = (() => {
    const rate = 10, mag = 40, reload = 2, dmg = 11, out = compressWeapon({ rate, dmg, mag });
    if (!out) return null;   // Whole rule set off (K >= 1): no counter-example exists, this line is moot together with II
    const r1 = tierVal(out.rate, 1), d1 = tierVal(out.dmg, 1);
    return (d1 * mag / (mag / r1 + reload)) / (dmg * mag / (mag / rate + reload)) - 1;
  })();
  if (bad === null) console.log('  ⚪ 反例:整套壓縮已關閉(K ≥ 1),Ⅱ 全段無作用');
  else t(`反例:mag 不跟著縮 ⇒ 持續 DPS 虛胖 ${(bad * 100).toFixed(1)}%(MUST > 10% 才擋得住)`, bad > 0.1);
}

// ---------------------------------------------------------------------------
console.log('■ Ⅲ 現役 32 角資料(排名不變 / 差異拉近 / 重武器逐位元不動)');
// ---------------------------------------------------------------------------
{
  // 4 Rank preservation: pairwise re-verification (trust the curve and the landed values)
  const pairs = WS.map((x) => ({ ...x, r0: tierVal(rate0Of(x.w), 1), r1: tierVal(x.w.rate ?? RATE_DEF, 1) }));
  let ok = true, why = '';
  for (const a of pairs) for (const b of pairs) {
    if (a.r0 < b.r0 && !(a.r1 <= b.r1 + 1e-9)) { ok = false; why = `${a.ch}.${a.slot} ${a.r0}→${a.r1} vs ${b.ch}.${b.slot} ${b.r0}→${b.r1}`; }
    if (a.r0 === b.r0 && !near(a.r1, b.r1)) { ok = false; why = `同射速壓縮後不同:${a.ch} ${b.ch}`; }
  }
  t('射速排名逐對不變(含同值仍同值)', ok, why);

  // 3 Narrower spread
  const r0s = pairs.map((p) => p.r0), r1s = pairs.map((p) => p.r1);
  const sp0 = Math.max(...r0s) / Math.min(...r0s), sp1 = Math.max(...r1s) / Math.min(...r1s);
  t(`射速全距比值收窄 ${sp0.toFixed(2)}× → ${sp1.toFixed(2)}×`, sp1 < sp0 * 0.6);

  // Heavy weapons bit-identical (all sit on the anchor; any move means the anchor was broken)
  const hv = WS.filter((x) => x.slot === 'heavy');
  t('32 把重武器一把都沒被壓縮(rate0 未掛)', hv.every((x) => x.w.rate0 === undefined), `${hv.filter((x) => x.w.rate0 !== undefined).map((x) => x.ch)}`);
  t('重武器解析後 rate 仍 = RATE_DEF', hv.every((x) => heroWeapon(x.ch, 'heavy', 1, true).rate === RATE_DEF));
  t('重武器連發數恆 1(N > 1 只發生在輕武器)',
    hv.every((x) => fireBurstN(heroWeapon(x.ch, 'heavy', 1, true)) === 1));

  // 7 Recoil tiers MUST consume pre-compression rate0
  t('recoilTier 讀 rate0(原文)', /rate0\s*\?\?\s*w\.rate/.test(strip(dataSrc).split('export function recoilTier')[1].slice(0, 400)));
  t('機槍(s01 輕武器)後座仍是「高」', recoilName(CHARACTERS.s01.light, 'light') === '高');

  // mag is at least 1 round and integral (st.ammo decrements per shot)
  t('壓縮後 mag 全為 ≥ 1 的整數', WS.every((x) => LVLS.every((lv) => {
    const m = tierVal(x.w.mag ?? 1, lv);
    return Number.isInteger(m) && m >= 1;
  })));
  // Section II's "DPS unchanged" guarantee assumes post-compression magazines >= 5 rounds
  // (integer-rounding error <= half a round over magazine size). Once a compressed weapon drops
  // below this range, the guarantee stops applying — so the premise itself is pinned here.
  const trimmed = WS.filter((x) => x.w.rate0 !== undefined);
  const minMag = Math.min(...trimmed.map((x) => tierVal(x.w.mag ?? 1, 1)));
  t(`被壓縮武器的 Lv1 彈夾最小 ${minMag} 發 ≥ 5(Ⅱ 的誤差上界前提)`, minMag >= 5);
}

// ---------------------------------------------------------------------------
console.log('■ Ⅳ 連發演出(fireBurstN / fireBurstGap:脈衝率 ≈ 原射速、平均鋪滿擊發週期)');
// ---------------------------------------------------------------------------
{
  const defs = WS.map((x) => ({ ...x, def: heroWeapon(x.ch, x.slot, 1, true) }));
  t('N ∈ [1, BURST_MAX]', defs.every((x) => {
    const n = fireBurstN(x.def);
    return Number.isInteger(n) && n >= 1 && n <= FIRE_RATE.BURST_MAX;
  }));
  // User-specified example: MG (s01 twin 5.56 gun pod, original rate 10) = 3-round burst
  t('使用者指定:機槍(s01 輕武器)= 3 連發', fireBurstN(defs.find((x) => x.ch === 's01' && x.slot === 'light').def) === 3,
    `${fireBurstN(defs.find((x) => x.ch === 's01' && x.slot === 'light').def)}`);
  // Burst count is non-decreasing with original rate (a faster weapon must not burst less)
  const srt = defs.filter((x) => x.slot === 'light').sort((a, b) => tierVal(rate0Of(a.w), 1) - tierVal(rate0Of(b.w), 1));
  let nMono = true;
  for (let i = 1; i < srt.length; i++) if (fireBurstN(srt[i].def) < fireBurstN(srt[i - 1].def)) nMono = false;
  t('連發數隨原射速單調不減', nMono);

  // "Looks continuous" = N shots spread evenly across the whole firing cycle, so the
  // in-cycle gap === the cross-cycle gap
  t('fireBurstGap × N × rate === 1(平均鋪滿擊發週期)',
    defs.every((x) => near(fireBurstGap(x.def) * fireBurstN(x.def) * x.def.rate, 1)));
  // Visual pulse rate (N x compressed rate) tracks the original rate. Integer burst counts can
  // only land on the nearest integer, so the correct statement is "N is the **nearest integer**
  // to rate0/rate" (off by <= half a round), not "pulse error < x%" — the latter just renames the
  // rounding boundary (rate0 5 -> N 1 is inherently -33%).
  t('N 取 rate0/rate 的最近整數(差 ≤ 0.5)', defs.every((x) => {
    const ratio = tierVal(rate0Of(x.w), 1) / x.def.rate;
    return Math.abs(fireBurstN(x.def) - ratio) <= 0.5 + 1e-9 || ratio > FIRE_RATE.BURST_MAX;
  }));
  const err = defs.map((x) => Math.abs(fireBurstN(x.def) * x.def.rate / tierVal(rate0Of(x.w), 1) - 1));
  t(`視覺脈衝率 ≈ 原射速 — 最大偏差 ${(Math.max(...err) * 100).toFixed(1)}%(捨入界 33.3%)`, Math.max(...err) <= 1 / 3 + 1e-9);
  t('未壓縮武器 N = 1 ⇒ gap = 擊發週期本身(整段 no-op)',
    defs.filter((x) => x.w.rate0 === undefined).every((x) => near(fireBurstGap(x.def), 1 / x.def.rate)));
}

// ---------------------------------------------------------------------------
console.log('■ Ⅴ 連發是純表現層(game.js 原文:單一排程縫 + 不碰權威狀態)');
// ---------------------------------------------------------------------------
{
  t('_queueBurst 一份實作', count(code, '_queueBurst(def, fn) {') === 1);
  t('_tickBurstFx 一份實作、一個呼叫點', count(code, '_tickBurstFx(now) {') === 1 && count(code, 'this._tickBurstFx(') === 1);
  t('_tickBurstFx 排在 _tickWeapons 之後(本幀擊發同幀進佇列)',
    code.indexOf('this._tickWeapons(') < code.indexOf('this._tickBurstFx('));
  // Three consumers (own FPV / others' tracers / bot-wingman shots) share one scheduler
  t('排程只經 _queueBurst(3 個消費端)', count(code, 'this._queueBurst(') === 2 && count(code, 'this._burstEchoOther(') === 2);
  t('連發數/間隔的真相只有 data.js(game.js 不自算)',
    count(code, 'fireBurstN(') === 2 && count(code, 'fireBurstGap(') === 1);

  const self = grabMethod(src, '_burstEchoSelf');
  const other = grabMethod(src, '_burstEchoOther');
  const both = strip(self + other);
  // 6 A1: fill-in rendering MUST NOT send network messages / enter authoritative projectiles / consume ammo or power
  t('補畫路徑無任何 net.send(A1)', !/net[?.]*\.send/.test(both));
  t('補畫路徑不進 this.bullets(那條路徑會回報命中 = 傷害翻倍)', !/this\.bullets/.test(both));
  t('補畫路徑不扣彈藥 / 電力', !/\bst\.ammo|this\.mp\s*=/.test(both));
  t('補畫路徑不動 lastFireAt / reloadEnd(射速閘仍由真正的擊發把關)', !/lastFireAt|reloadEnd/.test(both));
  // Visual shells go through the existing object pool (A25: one-shot 3D objects MUST be recycled)
  t('自機補畫走 _spawnVisShell(純視覺彈體,回池)', /_spawnVisShell\(/.test(self));
  t('_spawnVisShell 的 heavy 參數預設 true(既有重武器呼叫端逐位元不變)',
    /_spawnVisShell\(from, to, def, side, ch, mv = null, heavy = true\)/.test(code));
  // Queue MUST be cleared on death / chassis swap (a closure would paint the old weapon's muzzle on the new chassis)
  t('陣亡 / 換座機清 _burstQ', count(code, 'this._burstQ = null;') === 2);
  // Recovery window counts **rounds**, not trigger pulls
  t('連射回穩窗以「發」計(_burstN 加 fireBurstN)', /_burstN\[id\]\s*\|\|\s*0\)\s*\+\s*fireBurstN\(def\)/.test(code));
}

// ---------------------------------------------------------------------------
console.log('■ Ⅵ 前線交戰模型(lanesim.reFire:長期平均射速 = 標稱,與步進無關)');
// ---------------------------------------------------------------------------
{
  t('reFire 一份實作', count(laneCode, 'function reFire(') === 1);
  t('三個排程端全吃 reFire(機體槽位 / NPC / 砲塔)', count(laneCode, 'reFire(') === 4);
  t('原文無殘留的 `= t + 1 /`(舊制丟殘量寫法)', !/=\s*t\s*\+\s*1\s*\//.test(laneCode));

  // reFire's remainder clamp consumes LANE.DT, so each step size MUST build its own instance
  // (sharing one mixes two step sizes into the measurement)
  const mk = (dt) => new Function('LANE', `${grabFn(laneSrc, 'reFire')}; return reFire;`)({ DT: dt });
  const DT = GAME.TICK_MS / 1000;
  /** Long-run average rate as produced by stepwise simulation */
  const measure = (rate, dt) => {
    const reFire = mk(dt);
    let next = 0, n = 0;
    const T = 400;
    for (let t0 = 0; t0 < T; t0 += dt) if (t0 >= next) { n++; next = reFire(next, t0, 1 / rate); }
    return n / T;
  };
  // Nominal rate MUST be achievable, limited only by the step's own ceiling of one shot per step
  // (old `next = t + 1/rate` delivered only 4.0 at rate 7 / step 0.125 = -43%, far below the ceiling).
  for (const rate of [2.2, 3.49, 3.91, 4.45, 7, 10]) {
    const want = Math.min(rate, 1 / DT), e = Math.abs(measure(rate, DT) / want - 1);
    t(`rate ${rate} 長期平均射速 = ${want}(偏差 ${(e * 100).toFixed(2)}%)`, e < 0.02);
  }
  t('現役壓縮後射速全在步進天花板之下(不受 1/DT 夾制)',
    WS.every((x) => LVLS.every((lv) => tierVal(x.w.rate ?? RATE_DEF, lv) < 1 / DT)));
  t('步進無關:rate 3.91 在 dt 0.05 / 0.125 / 0.2 三段一致',
    [0.05, 0.125, 0.2].every((dt) => Math.abs(measure(3.91, dt) / 3.91 - 1) < 0.02));
  // Idle windows MUST NOT bank shots for a later burst
  {
    const iv = 1 / 4;
    const reFire = mk(DT);
    let next = reFire(0, 0, iv);
    next = reFire(next, 60, iv);            // 60 idle seconds with no target
    t('空窗後只補一格(不得把空窗期的發數存起來連射)', next >= 60 - DT && next <= 60 + iv);
  }
}

console.log(`\n${fail === 0 ? '🎉' : '❌'} 射速壓縮稽核:${pass} 通過 / ${fail} 失敗`);
process.exit(fail === 0 ? 0 : 1);
