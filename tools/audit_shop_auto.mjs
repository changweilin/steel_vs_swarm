// ============ 商店掃貨 / 預約稽核(2026-08-02 使用者需求)============
// 使用者定調一句:「商店加入掃貨與預約選項」。
//   掃貨 = 把**現在買得起的**升級一次買到底;
//   預約 = 掛上某一軌,**錢一夠就自動下單**(商店關著也算)。
// 用途:改 `game.js _sweepPick`/`_sweepBuy`/`_toggleReserve`/`_tickReserve`/`_shopState`、
//      `main.js renderShop` 的掃貨鈕與預約鈕、或 `ECON.UPGRADES`/`upgradePrice` 之後跑這一支。
// 跑法:`node tools/audit_shop_auto.mjs [-v]`(純原文 + 真品行為直測,不需瀏覽器/外網)
//
// 這支要釘住的**四件事**(每一件壞掉都不會報錯,只會「錢莫名其妙變少」或「按了沒反應」):
//   Ⅰ 判定單一縫:「買不買得起」只有 `_sweepPick` 一份 —— UI 端自己再算一次的下場是
//     鈕面說可以按、按下去卻沒動作(或反過來),而畫面上看不出哪一邊錯。
//   Ⅱ 貪心便宜優先:階梯單價 `price(lvl)` 隨等級遞增 ⇒ 先買便宜的,同一筆錢換到最多階。
//     退回「宣告順序」不會報錯,只是同樣的錢少買一兩階(玩家幾乎不可能自己發現)。
//   Ⅲ 只掃八軌:陣營小兵強化是**同陣營共用**的無底金錢去化,而且刻意不做樂觀更新 ——
//     掃/預約進去就是把錢全倒進兵線,且因為沒有樂觀扣款,迴圈條件永遠成立 = 一次掃光全部身家。
//   Ⅳ 預約不重複下單:樂觀更新會被下一份快照的權威值校正回去,若那份快照比伺服器處理購買
//     還早到(RTT > 125ms),沒有「同一階只送一次」的閘就會重送,第二筆被拒 ⇒ 玩家看到
//     一句莫名其妙的「資金不足」。逾時窗是被拒時的救濟閥,MUST NOT 短到蓋不住一次往返。
import { readSrc, grabMethod } from './audit_src.mjs';
import { ECON, upgradePrice } from '../public/js/data.js';

const gameSrc = readSrc('public', 'js', 'game.js');
const mainSrc = readSrc('public', 'js', 'main.js');
const htmlSrc = readSrc('public', 'index.html');

const verbose = process.argv.includes('-v');
let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; if (verbose) console.log(`  ✓ ${msg}`); }
  else { fail++; console.log(`  ✗ ${msg}${extra ? ` — ${extra}` : ''}`); }
};
const sec = (t) => console.log(`\n▍${t}`);
const count = (src, re) => (src.match(re) || []).length;
/** 剝掉註解再驗原文(註解裡提到某個名字不算「第二處實作」) */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

// ── 真品行為直測用的最小客戶端 ────────────────────────────────
// 四支方法的原文直接抽出來跑;`_optimisticBuy` 以測試替身代入(它已由既有路徑覆蓋,
// 這裡要驗的是「挑哪一項、挑幾次、送不送」)。
const proto = new Function(
  'ECON', 'upgradePrice', 'RESERVE_RESEND_S', 'performance',
  `return ({
    ${grabMethod(gameSrc, '_sweepPick')},
    ${grabMethod(gameSrc, '_sweepBuy')},
    ${grabMethod(gameSrc, '_toggleReserve')},
    ${grabMethod(gameSrc, '_tickReserve')},
  });`,
)(ECON, upgradePrice, Number(/const RESERVE_RESEND_S = ([\d.]+)/.exec(gameSrc)?.[1]),
  { now: () => (globalThis.__t ?? 0) * 1000 });   // 真品吃 performance.now()/1000 ⇒ 這裡回毫秒

const RESEND_S = Number(/const RESERVE_RESEND_S = ([\d.]+)/.exec(gameSrc)?.[1]);
const TRACKS = Object.keys(ECON.UPGRADES);
const zeroUpg = () => Object.fromEntries(TRACKS.map((k) => [k, 0]));

/** 造一個最小可跑的交戰客戶端;`sent` 記下所有送出的購買 */
const mkClient = (money, upg = zeroUpg()) => {
  const sent = [];
  const c = Object.assign(Object.create(null), proto, {
    side: 'SWARM', money, upg, shopOpen: false,
    _reserve: new Set(), _resSent: {},
    hud: { feed() {}, shop() {} },
    _shopSig: null,
    // 樂觀購買替身:扣款 + 推進等級(與真品 `_optimisticBuy` 的可觀察效果一致)
    _optimisticBuy(item) {
      const up = ECON.UPGRADES[item];
      const lvl = this.upg[item] || 0;
      if (lvl >= up.max) return;
      const price = upgradePrice(up, lvl);
      if (this.money < price) return;
      this.money -= price; this.upg[item] = lvl + 1;
      sent.push(item);
    },
  });
  c.sent = sent;
  return c;
};

// ── Ⅰ 判定單一縫 ────────────────────────────────────────────────
sec('Ⅰ 判定單一縫');
ok(count(gameSrc, /\n  _sweepPick\(/g) === 1, '`_sweepPick` 只有一份實作');
ok(count(code(gameSrc), /this\._sweepPick\(\)/g) === 2,
  '`_sweepPick` 恰兩個消費端(掃貨迴圈 + `_shopState` 的 sweepable)',
  `目前 ${count(code(gameSrc), /this\._sweepPick\(\)/g)} 處`);
ok(!/upgradePrice\(/.test(code(mainSrc).slice(code(mainSrc).indexOf('function renderShop'),
  code(mainSrc).indexOf('function renderShop') + 1200)),
  'renderShop 的掃貨區塊 MUST NOT 自己算單價(可用狀態一律吃 game.js 的 sweepable)');
ok(/sweepable: this\._sweepPick\(\) != null/.test(gameSrc),
  '`sweepable` 由 `_sweepPick` 推導,MUST NOT 另寫一次「有沒有買得起的」');
ok(count(gameSrc, /\n  _tickReserve\(/g) === 1 && count(code(gameSrc), /this\._tickReserve\(\)/g) === 1,
  '`_tickReserve` 一份實作 + 一個呼叫點(快照落地處)');
ok(/this\._tickReserve\(\);[\s\S]{0,400}?if \(this\.shopOpen\) \{/.test(gameSrc),
  '預約排程 MUST 排在商店重繪簽章之前,且 MUST NOT 關在 `if (shopOpen)` 裡'
  + '(預約的用途正是「關著商店去打仗,錢到了自己買」)');
ok(htmlSrc.includes('id="shopSweepBtn"') && /st\.sweep\(\)/.test(mainSrc)
  && /st\.toggleReserve\(item\)/.test(mainSrc),
  'UI 只負責呼叫 `sweep` / `toggleReserve`,名單與排程都住 game.js');

// ── Ⅱ 掃貨:貪心便宜優先 ────────────────────────────────────────
sec('Ⅱ 掃貨(貪心便宜優先)');
{
  const L1 = upgradePrice(ECON.UPGRADES[TRACKS[0]], 0);
  const L2 = upgradePrice(ECON.UPGRADES[TRACKS[0]], 1);
  ok(L2 > L1, `階梯單價隨等級遞增(Lv0→1 $${L1} < Lv1→2 $${L2})—— 貪心便宜優先才會是最佳解`);

  const c = mkClient(L1 * 2 + L1 - 1);       // 剛好買得起兩階、差一元買不起第三階
  const n = c._sweepBuy();
  ok(n === 2 && c.sent.length === 2, `掃貨買到買不起為止(預期 2 階,實得 ${n})`);
  ok(c.money === L1 - 1, `餘額 = 起始 − 已購(實得 $${c.money})`);
  ok(new Set(c.sent).size === 2,
    '同樣的錢優先鋪不同軌的第一階(便宜優先的可觀察結果;退回宣告順序會把錢押在同一軌)',
    c.sent.join(','));

  const poor = mkClient(L1 - 1);
  ok(poor._sweepBuy() === 0 && poor.money === L1 - 1, '一項都買不起時掃貨不下單也不扣錢');

  // 滿級池:掃貨 MUST 停手(且不會空轉到迴圈上限)
  const full = mkClient(999999, Object.fromEntries(TRACKS.map((k) => [k, ECON.UPGRADES[k].max])));
  ok(full._sweepBuy() === 0, '八軌全滿時掃貨不下單(滿級軌 MUST 被跳過)');

  // 錢無限:掃貨恰好把八軌買滿,一階不多一階不少
  const rich = mkClient(1e9);
  const total = TRACKS.reduce((s, k) => s + ECON.UPGRADES[k].max, 0);
  ok(rich._sweepBuy() === total,
    `資金無限時掃貨恰好買滿八軌共 ${total} 階(推導不手寫)`);
  ok(TRACKS.every((k) => rich.upg[k] === ECON.UPGRADES[k].max), '每一軌都停在自己的 max,不超買');
}

// ── Ⅲ 只作用於八軌 ─────────────────────────────────────────────
sec('Ⅲ 只作用於八軌(陣營小兵強化不得混入)');
{
  const sweep = code(grabMethod(gameSrc, '_sweepBuy')) + code(grabMethod(gameSrc, '_sweepPick'));
  ok(!/creep/i.test(sweep),
    '掃貨 MUST NOT 碰陣營小兵強化 —— 它是同陣營共用、且刻意不做樂觀扣款,'
    + '掃進去 = 迴圈條件永遠成立 = 一次掃光全部身家');
  ok(!/creep/i.test(code(grabMethod(gameSrc, '_tickReserve'))), '預約同理');
  const c = mkClient(1e9);
  c._toggleReserve('creep');
  ok(c._reserve.size === 0, '`creep` 不是八軌成員 ⇒ 預約 MUST 拒收(Object.hasOwn 閘)');
  c._toggleReserve('toString');
  ok(c._reserve.size === 0, '原型鏈鍵名(toString)MUST NOT 混進預約名單');
  ok(/Object\.hasOwn\(ECON\.UPGRADES, item\)/.test(grabMethod(gameSrc, '_toggleReserve')),
    '合法性以 `Object.hasOwn` 判定(與伺服器 `buy()` 同一條規則)');
}

// ── Ⅳ 預約:錢一夠就下單、同一階只送一次 ────────────────────────
sec('Ⅳ 預約');
{
  const item = TRACKS[0], up = ECON.UPGRADES[item];
  const P0 = upgradePrice(up, 0);

  const c = mkClient(0);
  c._toggleReserve(item);
  ok(c._reserve.has(item), '按一次 = 掛上名單');
  globalThis.__t = 0;
  c._tickReserve();
  ok(c.sent.length === 0, '錢不夠:預約不下單(靜靜等著)');

  c.money = P0;
  c._tickReserve();
  ok(c.sent.length === 1 && c.upg[item] === 1, '錢一夠就自動下單');

  // 權威快照晚到:money/upg 被校正回購買**前**的值 ⇒ MUST NOT 對同一階重送
  c.money = P0; c.upg[item] = 0;
  globalThis.__t = RESEND_S * 0.5;
  c._tickReserve();
  ok(c.sent.length === 1,
    '權威值還沒回來之前 MUST NOT 對同一階重複下單(第二筆會被伺服器拒 ⇒ 假的「資金不足」)');

  // 逾時救濟閥:真的被拒時,等超過重送窗才放行
  globalThis.__t = RESEND_S * 1.5;
  c._tickReserve();
  ok(c.sent.length === 2, `逾時 ${RESEND_S}s 後放行重送(被拒時才不會把這一軌永久卡死)`);
  ok(RESEND_S > 0.125,
    `重送窗 ${RESEND_S}s MUST 蓋得住一次網路往返 + 一份 8Hz 快照(0.125s)`);

  // 權威等級前進 = 正常解鎖下一階(不必等逾時)
  const d = mkClient(1e9);
  d._toggleReserve(item);
  globalThis.__t = 0;
  d._tickReserve();
  const after = d.sent.length;
  globalThis.__t = 0;                       // 時間不動:靠「等級前進」解鎖
  d._tickReserve();
  ok(d.sent.length > after, '權威等級一前進就能買下一階,不必等逾時窗');

  // 滿級自動退出名單
  const e = mkClient(1e9, { ...zeroUpg(), [item]: up.max });
  e._toggleReserve(item);
  globalThis.__t = 0;
  e._tickReserve();
  ok(!e._reserve.has(item) && e.sent.length === 0, '已滿級的軌 MUST 自動退出名單(留著是死預約)');

  // 再按一次 = 取消
  const f = mkClient(0);
  f._toggleReserve(item); f._toggleReserve(item);
  ok(f._reserve.size === 0, '再按一次 = 取消預約');

  // 觀戰 / 未入座:沒有 side 就沒有商店
  const g = mkClient(1e9);
  g.side = null; g._reserve.add(item);
  g._tickReserve();
  ok(g.sent.length === 0 && g._sweepBuy() === 0, '沒有 side(觀戰/未入座)時掃貨與預約都不動作');
}

console.log(fail
  ? `\n✗ 商店掃貨 / 預約稽核:${fail} 項未通過(共 ${pass + fail})`
  : `\n✓ 商店掃貨 / 預約稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
