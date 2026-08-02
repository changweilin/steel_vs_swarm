// ============ 射速壓縮 + 連發演出 稽核 ============
// 用途:改 `data.js` 的 `FIRE_RATE`/`RATE_DEF`/`rateComp()`/`compressWeapon()`/`fireBurstN()`/
// `fireBurstGap()`、任何角色武器的 `rate`/`dmg`/`mag`、`recoilTier` 的射速分級,
// 或 `game.js` 的 `_queueBurst`/`_tickBurstFx`/`_burstEchoSelf`/`_burstEchoOther`,
// 或 `tools/lanesim.mjs` 的 `reFire()` 之後跑。
//
// 使用者定案(2026-08-02):「DPS 不變、降低輕重武器射速,射速越高降越多,拉近射速差異、
// 但射速的排名不變,高射速武器動畫做對應調整,例如機槍做成 3 連發實質一次傷害,
// 整體看起來攻擊動畫是連續的」。這五條全部是**可量測的不變式**,本稽核逐條釘死:
//
//   ① DPS 不變     —— 爆發 DPS(dmg × rate)與**持續** DPS(彈夾週期攤平)雙軌都不准漂。
//                     只驗爆發那一項是這條最容易被放過的破口:少了 `mag ×f`,持續 DPS
//                     最多虛胖 33.5%(彈夾撐得更久 = 裝填次數變少),而爆發 DPS 完全正常。
//   ② 越快降越多   —— 折減率 `1 − rateComp(r)/r` 對 r 單調不減。
//   ③ 拉近差異     —— 壓縮後的射速全距比值嚴格小於壓縮前。
//   ④ 排名不變     —— `rateComp` 嚴格遞增(這是保證,不是巧合);另在實際 32 角資料上逐對複驗。
//   ⑤ 連發演出     —— N = round(rate0/rate)、視覺脈衝率 ≈ 原射速、N 發**平均鋪滿**擊發週期
//                     (打成「一串急促連發 + 一段空白」就不是使用者要的「看起來連續」)。
//
// 另兩條反模式:
//   ⑥ 連發是**純表現層**:補畫路徑 MUST NOT 送任何網路訊息、MUST NOT 進 `this.bullets`、
//      MUST NOT 扣彈藥 —— 任一條破了就是 A1(客戶端自己加傷害),而畫面上只看得到「傷害偏高」。
//   ⑦ `recoilTier` MUST 吃壓縮**前**的 `rate0`:壓縮後全部輕武器都掉到 7 以下,
//      `rate >= 7` 那一條會整條失效,機槍當場從 high 掉成 med(手感無聲改變)。
//
// Ⅴ 另驗 `lanesim.reFire`:模型舊制 `next = t + 1/rate` 每發丟棄不滿一格的殘量 ⇒ 有效射速
// 被步進格點吃掉最多 43%,量到的是「射速落在格點哪一側」而不是武器強弱。壓縮把全部輕武器
// 重新落到格點上,這個舊 bug 因此會在 bal ⑦c 上表現成「某個機種憑空變強」。
//
// 跑法:`node tools/audit_fire_rate.mjs`(不需伺服器/瀏覽器)
// 讀原文與抽方法走 `audit_src.mjs` 單一縫(含換行正規化 —— 逐行剝註解在 CRLF 工作區會靜默失效)。
import { readSrc, grabMethod, grabFn } from './audit_src.mjs';
import {
  FIRE_RATE, RATE_DEF, rateComp, compressWeapon, fireBurstN, fireBurstGap,
  CHARACTERS, heroWeapon, recoilName, tierVal, GAME,
} from '../public/js/data.js';

const src = readSrc('public', 'js', 'game.js');
const dataSrc = readSrc('public', 'js', 'data.js');
const laneSrc = readSrc('tools', 'lanesim.mjs');

/** 「全檔只有 N 處」這類計數 MUST 只數**執行原文**(註解/import 也提得到同一個名字) */
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
const code = strip(src).split("} from './data.js';").slice(1).join("} from './data.js';");
const laneCode = strip(laneSrc);

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const count = (s, needle) => s.split(needle).length - 1;
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

/** 現役全部角色武器(32 角 × 兩槽位) */
const WS = Object.entries(CHARACTERS).flatMap(([ch, c]) => ['light', 'heavy']
  .filter((s) => c[s]).map((slot) => ({ ch, slot, w: c[slot] })));
/** 這把武器壓縮**前**的射速(未壓縮者沒有 rate0 ⇒ rate 本身就是原值) */
const rate0Of = (w) => w.rate0 ?? w.rate ?? RATE_DEF;
const LVLS = [1, 2, 3, 4];

// ---------------------------------------------------------------------------
console.log('■ Ⅰ 壓縮曲線(rateComp:錨點以下不動 / 越快降越多 / 嚴格遞增 ⇒ 排名不變)');
// ---------------------------------------------------------------------------
{
  t('錨點 PIVOT === RATE_DEF(推導不手寫)', FIRE_RATE.PIVOT === RATE_DEF, `${FIRE_RATE.PIVOT} vs ${RATE_DEF}`);
  // 錨點的理由:32 把重武器一把都沒有標 rate,全部落在預設值上 ⇒ 那就是現役射速帶的底。
  const heavyNoRate = WS.filter((x) => x.slot === 'heavy').every((x) => x.w.rate0 === undefined && x.w.rate === undefined);
  t('32 把重武器皆未標 rate(錨點落在預設值上的理由)', heavyNoRate);

  t('錨點以下逐位元原值', [0.5, 1, 2.2, 2.9, RATE_DEF].every((r) => rateComp(r) === r));
  // 嚴格遞增 = 排名不變的**保證**。整數倍率制(rate/N)會在這裡當場紅字:
  // rate 8 → 4.0 而 rate 9 → 3.0。
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

  // 反向驗證的錨:K ≥ 1 ⇒ 整套規則逐位元退場(改壞了要驗得出來)
  const K0 = FIRE_RATE.K;
  FIRE_RATE.K = 1;
  const off = [2.2, 5, 10, 18, 40].every((r) => rateComp(r) === r)
    && compressWeapon({ rate: 10, dmg: [11, 14, 17], mag: [40, 50, 60] }) === null;
  FIRE_RATE.K = K0;
  t('K ≥ 1 ⇒ 逐位元回到舊制(反向驗證的錨)', off);

  // 常數 MUST NOT 被消費端手抄
  t('game.js 原文無手寫連發數 / 壓縮指數', !/fireBurstN\s*=|FIRE_RATE\.(K|PIVOT|BURST_MAX)/.test(code));
  t('game.js MUST NOT 自己 round(rate0 / rate)', !/Math\.round\([^)]*rate0/.test(code));
}

// ---------------------------------------------------------------------------
console.log('■ Ⅱ DPS 不變(compressWeapon 純函式:合成掃描,爆發 + 持續雙軌)');
// ---------------------------------------------------------------------------
{
  // 合成掃描:涵蓋現役 rate 2.2~18 / mag 7~110 / reload 1.8~12 的整個值域。
  // 用純函式而不是比對「壓縮前的檔案」—— 稽核 MUST NOT 依賴 git 或第二份資料副本。
  //
  // **唯一的誤差來源是 mag 的整數化**(`st.ammo` 逐發遞減 ⇒ 彈夾必須是整數),其上限是
  // 半發 ÷ 壓縮後彈夾發數。掃描因此只涵蓋「壓縮後仍有 MAG_MIN 發以上」的組合,
  // 並在 Ⅲ 另外釘住**現役武器一把都沒有掉出這個範圍**(否則這裡的保證就不適用了)。
  // 現役被壓縮武器的 Lv1 彈夾最小值(Ⅲ 另外釘住它)—— 拿來當「保證適用範圍」的門檻,
  // MUST NOT 手寫:資料一動,這裡的門檻自己跟著動。
  // (整套規則關掉時沒有任何武器被壓縮 ⇒ 退回 1,讓下面的統計自然變成空集合而不是 Infinity)
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
          // **結構性上界**:唯一的誤差源是彈夾整數化,最多差半發 ⇒ 週期最多差 (0.5/r1) 秒、
          // 持續 DPS 再加上「彈夾少了半發」那一項。兩條都**逐案例**驗(不設門檻、不手寫百分比):
          // 破了就代表誤差跑進了整數化以外的地方 = 三欄的縮放規則寫錯了,而那是看不出來的。
          const bound = (0.5 / r1) / cyc0 + 1e-9;
          if (Math.abs(cyc1 / cyc0 - 1) > bound) { inBound = false; worst = `週期 rate ${rate} mag ${mag} reload ${reload}`; }
          if (Math.abs(s1 / s0 - 1) > bound + 0.5 / m1 + 1e-6) { inBound = false; worst = `持續 rate ${rate} mag ${mag} reload ${reload}`; }
          maxBurst = Math.max(maxBurst, Math.abs(d1 * r1 / (dmg[i] * rate) - 1));
          if (m1 < MAG_MIN) continue;   // 以下兩個「現役規模」的統計只看彈夾 ≥ 現役最小值的組合
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
  // 門檻取**結構性上界**(推導不手寫):寫死 1% 只是在記錄「現在剛好多少」,
  // 資料一動就變成假紅字;寫成上界則永遠問的是「誤差有沒有跑出整數化的範圍」。
  t(`持續 DPS(彈夾週期攤平)不變 — ${cases} 組(彈夾 ≥ ${MAG_MIN} 發)最大偏差 ${(maxSus * 100).toFixed(2)}%(上界 ${(maxBnd * 100).toFixed(2)}%)`, maxSus <= maxBnd);
  t(`彈夾週期 mag/rate + reload 不變 — 最大偏差 ${(maxCyc * 100).toFixed(2)}%`, maxCyc <= maxBnd);
  // 少了 mag ×f 這一項的舊坑:持續 DPS 會虛胖(這裡直接把「沒縮 mag」的反例算出來釘住)
  const bad = (() => {
    const rate = 10, mag = 40, reload = 2, dmg = 11, out = compressWeapon({ rate, dmg, mag });
    if (!out) return null;   // 整套規則關掉(K ≥ 1):沒有反例可算,這一條連同 Ⅱ 一起無意義
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
  // ④ 排名不變:逐對複驗(不只信曲線,連實際落地的數值一起驗)
  const pairs = WS.map((x) => ({ ...x, r0: tierVal(rate0Of(x.w), 1), r1: tierVal(x.w.rate ?? RATE_DEF, 1) }));
  let ok = true, why = '';
  for (const a of pairs) for (const b of pairs) {
    if (a.r0 < b.r0 && !(a.r1 <= b.r1 + 1e-9)) { ok = false; why = `${a.ch}.${a.slot} ${a.r0}→${a.r1} vs ${b.ch}.${b.slot} ${b.r0}→${b.r1}`; }
    if (a.r0 === b.r0 && !near(a.r1, b.r1)) { ok = false; why = `同射速壓縮後不同:${a.ch} ${b.ch}`; }
  }
  t('射速排名逐對不變(含同值仍同值)', ok, why);

  // ③ 拉近差異
  const r0s = pairs.map((p) => p.r0), r1s = pairs.map((p) => p.r1);
  const sp0 = Math.max(...r0s) / Math.min(...r0s), sp1 = Math.max(...r1s) / Math.min(...r1s);
  t(`射速全距比值收窄 ${sp0.toFixed(2)}× → ${sp1.toFixed(2)}×`, sp1 < sp0 * 0.6);

  // 重武器逐位元不動(它們全在錨點上;動到就是錨點被改壞了)
  const hv = WS.filter((x) => x.slot === 'heavy');
  t('32 把重武器一把都沒被壓縮(rate0 未掛)', hv.every((x) => x.w.rate0 === undefined), `${hv.filter((x) => x.w.rate0 !== undefined).map((x) => x.ch)}`);
  t('重武器解析後 rate 仍 = RATE_DEF', hv.every((x) => heroWeapon(x.ch, 'heavy', 1, true).rate === RATE_DEF));
  t('重武器連發數恆 1(N > 1 只發生在輕武器)',
    hv.every((x) => fireBurstN(heroWeapon(x.ch, 'heavy', 1, true)) === 1));

  // ⑦ 後座分級 MUST 吃壓縮前的 rate0
  t('recoilTier 讀 rate0(原文)', /rate0\s*\?\?\s*w\.rate/.test(strip(dataSrc).split('export function recoilTier')[1].slice(0, 400)));
  t('機槍(s01 輕武器)後座仍是「高」', recoilName(CHARACTERS.s01.light, 'light') === '高');

  // mag 至少 1 發、整數(st.ammo 逐發遞減)
  t('壓縮後 mag 全為 ≥ 1 的整數', WS.every((x) => LVLS.every((lv) => {
    const m = tierVal(x.w.mag ?? 1, lv);
    return Number.isInteger(m) && m >= 1;
  })));
  // Ⅱ 的「DPS 不變」保證以「壓縮後彈夾 ≥ 5 發」為前提(整數化誤差 ≤ 半發 ÷ 彈夾發數)。
  // 被壓縮的武器一旦掉到這個範圍以下,那份保證就不適用了 —— 這裡把前提本身釘住。
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
  // 使用者指定的例子:機槍(s01 雙聯 5.56 機槍艙,原射速 10)= 3 連發
  t('使用者指定:機槍(s01 輕武器)= 3 連發', fireBurstN(defs.find((x) => x.ch === 's01' && x.slot === 'light').def) === 3,
    `${fireBurstN(defs.find((x) => x.ch === 's01' && x.slot === 'light').def)}`);
  // N 隨原射速單調不減(高射速武器連發數不得比低射速的少)
  const srt = defs.filter((x) => x.slot === 'light').sort((a, b) => tierVal(rate0Of(a.w), 1) - tierVal(rate0Of(b.w), 1));
  let nMono = true;
  for (let i = 1; i < srt.length; i++) if (fireBurstN(srt[i].def) < fireBurstN(srt[i - 1].def)) nMono = false;
  t('連發數隨原射速單調不減', nMono);

  // 「看起來連續」= N 發平均鋪滿整個擊發週期 ⇒ 週期內間隔 === 跨週期間隔
  t('fireBurstGap × N × rate === 1(平均鋪滿擊發週期)',
    defs.every((x) => near(fireBurstGap(x.def) * fireBurstN(x.def) * x.def.rate, 1)));
  // 視覺脈衝率(N × 壓縮後射速)貼回原射速。整數連發數只能取到最近的整數 ⇒ 這一條的
  // 正確說法是「N 是 rate0/rate 的**最近整數**」(差 ≤ 半發),而不是「脈衝率誤差 < x%」——
  // 後者在 N 的捨入邊界(rate0 5 → N 1)必然是 −33%,寫成百分比只是把捨入界改個說法。
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
  // 三個消費端(自機 FPV / 他人 tracer / bot·僚機 shot)全走同一支排程器
  t('排程只經 _queueBurst(3 個消費端)', count(code, 'this._queueBurst(') === 2 && count(code, 'this._burstEchoOther(') === 2);
  t('連發數/間隔的真相只有 data.js(game.js 不自算)',
    count(code, 'fireBurstN(') === 2 && count(code, 'fireBurstGap(') === 1);

  const self = grabMethod(src, '_burstEchoSelf');
  const other = grabMethod(src, '_burstEchoOther');
  const both = strip(self + other);
  // ⑥ A1:補畫 MUST NOT 送網路訊息 / 進權威彈體 / 扣彈藥電力
  t('補畫路徑無任何 net.send(A1)', !/net[?.]*\.send/.test(both));
  t('補畫路徑不進 this.bullets(那條路徑會回報命中 = 傷害翻倍)', !/this\.bullets/.test(both));
  t('補畫路徑不扣彈藥 / 電力', !/\bst\.ammo|this\.mp\s*=/.test(both));
  t('補畫路徑不動 lastFireAt / reloadEnd(射速閘仍由真正的擊發把關)', !/lastFireAt|reloadEnd/.test(both));
  // 視覺彈體走既有物件池(A25:一次性 3D 物件 MUST 回收)
  t('自機補畫走 _spawnVisShell(純視覺彈體,回池)', /_spawnVisShell\(/.test(self));
  t('_spawnVisShell 的 heavy 參數預設 true(既有重武器呼叫端逐位元不變)',
    /_spawnVisShell\(from, to, def, side, ch, mv = null, heavy = true\)/.test(code));
  // 佇列在陣亡 / 換座機時 MUST 清掉(閉包會在新機體上補畫舊武器的槍口)
  t('陣亡 / 換座機清 _burstQ', count(code, 'this._burstQ = null;') === 2);
  // 回穩窗計**發**不計扳機次數
  t('連射回穩窗以「發」計(_burstN 加 fireBurstN)', /_burstN\[id\]\s*\|\|\s*0\)\s*\+\s*fireBurstN\(def\)/.test(code));
}

// ---------------------------------------------------------------------------
console.log('■ Ⅵ 前線交戰模型(lanesim.reFire:長期平均射速 = 標稱,與步進無關)');
// ---------------------------------------------------------------------------
{
  t('reFire 一份實作', count(laneCode, 'function reFire(') === 1);
  t('三個排程端全吃 reFire(機體槽位 / NPC / 砲塔)', count(laneCode, 'reFire(') === 4);
  t('原文無殘留的 `= t + 1 /`(舊制丟殘量寫法)', !/=\s*t\s*\+\s*1\s*\//.test(laneCode));

  // reFire 的殘量夾制吃 LANE.DT ⇒ 每個步進 MUST 各自建一份(共用一份 = 量到的是兩個步進混搭)
  const mk = (dt) => new Function('LANE', `${grabFn(laneSrc, 'reFire')}; return reFire;`)({ DT: dt });
  const DT = GAME.TICK_MS / 1000;
  /** 逐步進模擬出的長期平均射速 */
  const measure = (rate, dt) => {
    const reFire = mk(dt);
    let next = 0, n = 0;
    const T = 400;
    for (let t0 = 0; t0 < T; t0 += dt) if (t0 >= next) { n++; next = reFire(next, t0, 1 / rate); }
    return n / T;
  };
  // 標稱射速 MUST 打得出來,只受「一個步進最多一發」這個步進本身的天花板限制
  // (舊制 `next = t + 1/rate` 在 rate 7 / 步進 0.125 只打得出 4.0 = −43%,遠在天花板之下)。
  for (const rate of [2.2, 3.49, 3.91, 4.45, 7, 10]) {
    const want = Math.min(rate, 1 / DT), e = Math.abs(measure(rate, DT) / want - 1);
    t(`rate ${rate} 長期平均射速 = ${want}(偏差 ${(e * 100).toFixed(2)}%)`, e < 0.02);
  }
  t('現役壓縮後射速全在步進天花板之下(不受 1/DT 夾制)',
    WS.every((x) => LVLS.every((lv) => tierVal(x.w.rate ?? RATE_DEF, lv) < 1 / DT)));
  t('步進無關:rate 3.91 在 dt 0.05 / 0.125 / 0.2 三段一致',
    [0.05, 0.125, 0.2].every((dt) => Math.abs(measure(3.91, dt) / 3.91 - 1) < 0.02));
  // 空窗 MUST NOT 把發數存起來事後連射
  {
    const iv = 1 / 4;
    const reFire = mk(DT);
    let next = reFire(0, 0, iv);
    next = reFire(next, 60, iv);            // 中間 60 秒沒有目標
    t('空窗後只補一格(不得把空窗期的發數存起來連射)', next >= 60 - DT && next <= 60 + iv);
  }
}

console.log(`\n${fail === 0 ? '🎉' : '❌'} 射速壓縮稽核:${pass} 通過 / ${fail} 失敗`);
process.exit(fail === 0 ? 0 : 1);
