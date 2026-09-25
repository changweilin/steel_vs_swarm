// ============ Shop Sweep / Reservation Audit ============
// Sweep = immediately buys all currently affordable upgrades in greedy sequence.
// Reservation = watches target track and automatically orders when funds suffice (even if shop UI closed).
// Scope: tests game.js (_sweepPick, _sweepBuy, _toggleReserve, _tickReserve, _shopState),
//        main.js renderShop sweep/reserve buttons, and ECON.UPGRADES / upgradePrice.
// Usage: node tools/audit_shop_auto.mjs [-v]
//
// Invariants enforced:
//   I. Affordability single seam: _sweepPick is the sole judge of purchasability.
//      UI must not re-implement price checks.
//   II. Greedy cheapest-first: price(lvl) strictly increases with level -> buying lowest priced
//       items first yields the maximum number of tier upgrades per budget.
//   III. Sweep operates exclusively on the 8 mech tracks: creep lane upgrades are shared across
//        faction teammates without optimistic balance deduction; sweeping them would drain balance infinitely.
//        Reservation accepts creep lane upgrades, but processes one tier at a time and maintains
//        local pending accounting across lanes to prevent false "insufficient funds" server rejects.
//   IV. Reservation deduplication: late snapshots (RTT > 125ms) can roll back optimistic balance
//       before the server order resolves. The client MUST NOT resend orders for the same tier
//       until authoritative confirmation or until the retry window (RESERVE_RESEND_S) elapses.
import { readSrc, grabMethod } from './audit_src.mjs';
import { ECON, upgradePrice, canUpgrade, BATTLE_SCORE, CREEP_UPG } from '../public/js/data.js';

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
/** Strips comments before source verification so mentions in comments do not count as duplicate implementations. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

// ---- Minimal Client for Behavior Verification ----
// Extracts methods directly from source; _optimisticBuy is substituted with test spy.
const RES_CREEP = /const RES_CREEP = '([^']+)'/.exec(gameSrc)?.[1];
const proto = new Function(
  'ECON', 'upgradePrice', 'canUpgrade', 'CREEP_UPG', 'RESERVE_RESEND_S', 'RES_CREEP', 'performance',
  `return ({
    ${grabMethod(gameSrc, '_sweepPick')},
    ${grabMethod(gameSrc, '_sweepBuy')},
    ${grabMethod(gameSrc, '_toggleReserve')},
    ${grabMethod(gameSrc, '_tickReserve')},
    ${grabMethod(gameSrc, '_upgAllMax')},
    ${grabMethod(gameSrc, '_creepResKey')},
    ${grabMethod(gameSrc, '_resCreepLane')},
  });`,
)(ECON, upgradePrice, canUpgrade, CREEP_UPG, Number(/const RESERVE_RESEND_S = ([\d.]+)/.exec(gameSrc)?.[1]), RES_CREEP,
  { now: () => (globalThis.__t ?? 0) * 1000 });   // Real runtime uses performance.now()/1000 -> returns ms here.

const RESEND_S = Number(/const RESERVE_RESEND_S = ([\d.]+)/.exec(gameSrc)?.[1]);
const TRACKS = Object.keys(ECON.UPGRADES);
const zeroUpg = () => Object.fromEntries(TRACKS.map((k) => [k, 0]));
const maxUpg = () => Object.fromEntries(TRACKS.map((k) => [k, ECON.UPGRADES[k].max]));

/** Creates minimal runnable client harness; sent tracks emitted orders. */
const mkClient = (money, upg = zeroUpg(), creep = [0, 0, 0], kn = BATTLE_SCORE.MAX) => {
  const sent = [];
  const c = Object.assign(Object.create(null), proto, {
    side: 'SWARM', money, upg, kn, shopOpen: false,
    creepUpg: { SWARM: creep },
    _reserve: new Set(), _resSent: {},
    hud: { feed() {}, shop() {} },
    net: { send(m) { sent.push(`${m.item}:${m.lane}`); } },
    _shopSig: null,
    // Optimistic purchase spy: deducts balance + advances tier (observable behavior matches _optimisticBuy).
    _optimisticBuy(item) {
      const up = ECON.UPGRADES[item];
      const lvl = this.upg[item] || 0;
      if (!canUpgrade(up, lvl, this.money, this.kn)) return;
      this.money -= upgradePrice(up, lvl); this.upg[item] = lvl + 1;
      sent.push(item);
    },
  });
  c.sent = sent;
  return c;
};

// -- I. Decision single seam ------------------------------------------------
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

// -- II. Sweep buy: greedy cheapest-first ----------------------------------
sec('Ⅱ 掃貨(貪心便宜優先)');
{
  const L1 = upgradePrice(ECON.UPGRADES[TRACKS[0]], 0);
  const L2 = upgradePrice(ECON.UPGRADES[TRACKS[0]], 1);
  const L3 = upgradePrice(ECON.UPGRADES[TRACKS[0]], 2);
  ok(L2 > L1 && L3 > L2, `階梯單價嚴格遞增($${L1} < $${L2} < $${L3})—— 貪心便宜優先才會是最佳解`);

  const c = mkClient(L1 * 2 + L1 - 1);       // Exactly enough for 2 tiers; 1 coin short of tier 3.
  const n = c._sweepBuy();
  ok(n === 2 && c.sent.length === 2, `掃貨買到買不起為止(預期 2 階,實得 ${n})`);
  ok(c.money === L1 - 1, `餘額 = 起始 − 已購(實得 $${c.money})`);
  ok(new Set(c.sent).size === 2,
    '同樣的錢優先鋪不同軌的第一階(便宜優先的可觀察結果;退回宣告順序會把錢押在同一軌)',
    c.sent.join(','));

  const poor = mkClient(L1 - 1);
  ok(poor._sweepBuy() === 0 && poor.money === L1 - 1, '一項都買不起時掃貨不下單也不扣錢');

  // Battle score gate: infinite money with zero score unlocks only tier 1 per track.
  const green = mkClient(1e9, zeroUpg(), [0, 0, 0], 0);
  ok(green._sweepBuy() === TRACKS.length,
    `戰鬥分數 0 時掃貨只買得到八軌各自的第一階(預期 ${TRACKS.length},實得 ${green.sent.length})`);
  ok(TRACKS.every((k) => green.upg[k] === 1), '第二階被戰鬥分數門檻擋下(錢再多也不行)');

  // Fully upgraded pool: sweep MUST stop without looping to safety cap.
  const full = mkClient(999999, Object.fromEntries(TRACKS.map((k) => [k, ECON.UPGRADES[k].max])));
  ok(full._sweepBuy() === 0, '八軌全滿時掃貨不下單(滿級軌 MUST 被跳過)');

  // Infinite funds: sweep buys all 8 tracks to capacity exactly.
  const rich = mkClient(1e9);
  const total = TRACKS.reduce((s, k) => s + ECON.UPGRADES[k].max, 0);
  ok(rich._sweepBuy() === total,
    `資金無限時掃貨恰好買滿八軌共 ${total} 階(推導不手寫)`);
  ok(TRACKS.every((k) => rich.upg[k] === ECON.UPGRADES[k].max), '每一軌都停在自己的 max,不超買');
}

// -- III. Sweep affects 8 tracks only / reservation accepts creep upgrades --
sec('Ⅲ 掃貨只作用於八軌;預約收陣營小兵強化');
{
  const sweep = code(grabMethod(gameSrc, '_sweepBuy')) + code(grabMethod(gameSrc, '_sweepPick'));
  ok(!/creep/i.test(sweep),
    '掃貨 MUST NOT 碰陣營小兵強化 —— 它是同陣營共用、且刻意不做樂觀扣款,'
    + '掃進去 = 迴圈條件永遠成立 = 一次掃光全部身家');
  const rich = mkClient(1e9, maxUpg());
  rich._sweepBuy();
  ok(rich.sent.length === 0, '八軌全滿(小兵強化已解鎖)時掃貨仍一筆都不下單');

  const c = mkClient(1e9);
  c._toggleReserve('creep');
  ok(c._reserve.size === 0, '沒帶兵線索引的 `creep` 不是合法鍵 ⇒ 預約 MUST 拒收');
  c._toggleReserve('toString');
  ok(c._reserve.size === 0, '原型鏈鍵名(toString)MUST NOT 混進預約名單');
  c._toggleReserve(c._creepResKey(3));
  ok(c._reserve.size === 0, '不存在的兵線(索引越界)MUST 拒收');
  c._toggleReserve(c._creepResKey(1));
  ok(c._reserve.size === 1, '合法兵線鍵 MUST 收得進預約名單(使用者定案:預約包含兵線升級)');
  ok(/Object\.hasOwn\(ECON\.UPGRADES, item\)/.test(grabMethod(gameSrc, '_toggleReserve')),
    '八軌的合法性仍以 `Object.hasOwn` 判定(與伺服器 `buy()` 同一條規則)');

  // Single seam for key format: main.js MUST NOT assemble strings independently.
  ok(count(code(gameSrc), new RegExp(`'${RES_CREEP}'`, 'g')) === 1
    && /creepKey: \(lane\) => this\._creepResKey\(lane\)/.test(gameSrc),
    '預約鍵格式單一縫(`RES_CREEP` 一處定義 + `creepKey` 對外)');
  ok(!/creep:\$\{|'creep:'|`creep:/.test(code(mainSrc)) && /st\.creepKey\(li\)/.test(mainSrc),
    'main.js MUST NOT 自己拼預約鍵(拼錯不報錯,只會「★ 亮著卻永遠不成交」)');

  // Single seam for unlock requirement: UI and scheduler share _upgAllMax.
  ok(count(gameSrc, /\n  _upgAllMax\(/g) === 1 && /allMax: this\._upgAllMax\(\)/.test(gameSrc),
    '`_upgAllMax` 一份實作,商店 UI 走 `_shopState().allMax`');
  ok(/st\.allMax && st\.creepUpg\?\.length/.test(mainSrc)
    && !/Object\.entries\(ECON\.UPGRADES\)\.every/.test(code(mainSrc)),
    'renderShop MUST NOT 自己再算一次「八軌全滿」(兩份門檻會漂)');
}

// -- III-b. Creep upgrade reservation behavior -----------------------------
sec('Ⅲ-b 兵線升級預約');
{
  const P = CREEP_UPG.PRICE;
  // Tracks incomplete: server rejects orders -> reservation remains pending.
  const early = mkClient(1e9);
  early._toggleReserve(early._creepResKey(0));
  globalThis.__t = 0;
  early._tickReserve();
  ok(early.sent.length === 0, '八軌未滿時預約不下單(門檻與伺服器 `_upgAllMax` 同一條)');
  ok(early._reserve.size === 1, '未解鎖 MUST 只是等著,MUST NOT 把它踢出名單');

  // Once unlocked: auto-orders as soon as balance suffices.
  const c = mkClient(P - 1, maxUpg());
  c._toggleReserve(c._creepResKey(2));
  globalThis.__t = 0;
  c._tickReserve();
  ok(c.sent.length === 0, '差一元:不下單');
  c.money = P;
  c._tickReserve();
  ok(c.sent.join() === 'creep:2', `錢一夠自動下單(帶對兵線;實得 ${c.sent.join() || "無"})`);

  // No optimistic balance deduction -> MUST NOT resend same tier.
  globalThis.__t = RESEND_S * 0.5;
  c._tickReserve();
  ok(c.sent.length === 1, '權威等級還沒回來之前 MUST NOT 對同一階重送(共用值不做樂觀更新)');
  c.creepUpg.SWARM[2] = 1;                    // Authoritative snapshot arrives: tier advances.
  c._tickReserve();
  ok(c.sent.length === 2, '權威等級一前進就買下一階,不必等逾時窗');

  // Simultaneous reservations across 3 lanes with budget for 1 tier: dispatch only 1 order per tick.
  const three = mkClient(P, maxUpg());
  [0, 1, 2].forEach((li) => three._toggleReserve(three._creepResKey(li)));
  globalThis.__t = 0;
  three._tickReserve();
  ok(three.sent.length === 1,
    `同一輪的餘額 MUST 自己記帳(共用值沒有樂觀扣款);實得 ${three.sent.length} 筆`);
  const rich2 = mkClient(P * 3, maxUpg());
  [0, 1, 2].forEach((li) => rich2._toggleReserve(rich2._creepResKey(li)));
  rich2._tickReserve();
  ok(rich2.sent.length === 3, '錢夠三階時三條兵線同輪成交');

  // Automatically evicts from list when max tier reached.
  const full = mkClient(1e9, maxUpg(), [CREEP_UPG.MAX, 0, 0]);
  full._toggleReserve(full._creepResKey(0));
  full._tickReserve();
  ok(!full._reserve.size && full.sent.length === 0, '已滿級的兵線 MUST 自動退出名單');

  // Spectator / unseated: inert without side assignment.
  const spec = mkClient(1e9, maxUpg());
  spec._reserve.add('creep:0'); spec.side = null;
  spec._tickReserve();
  ok(spec.sent.length === 0, '觀戰/未入座時兵線預約也不動作');
}

// -- IV. Reservation: place order when funds suffice; no repeat per tier ---
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

  // Delayed authoritative snapshot rolls state back to pre-purchase value: MUST NOT resend same tier.
  c.money = P0; c.upg[item] = 0;
  globalThis.__t = RESEND_S * 0.5;
  c._tickReserve();
  ok(c.sent.length === 1,
    '權威值還沒回來之前 MUST NOT 對同一階重複下單(第二筆會被伺服器拒 ⇒ 假的「資金不足」)');

  // Timeout fallback: releases retry lock only after resend window expires.
  globalThis.__t = RESEND_S * 1.5;
  c._tickReserve();
  ok(c.sent.length === 2, `逾時 ${RESEND_S}s 後放行重送(被拒時才不會把這一軌永久卡死)`);
  ok(RESEND_S > 0.125,
    `重送窗 ${RESEND_S}s MUST 蓋得住一次網路往返 + 一份 8Hz 快照(0.125s)`);

  // Authoritative tier advance unlocks next tier without waiting for timeout.
  const d = mkClient(1e9);
  d._toggleReserve(item);
  globalThis.__t = 0;
  d._tickReserve();
  const after = d.sent.length;
  globalThis.__t = 0;                       // Time frozen: unlocked by tier advance.
  d._tickReserve();
  ok(d.sent.length > after, '權威等級一前進就能買下一階,不必等逾時窗');

  // Automatically evicts from list when max tier reached.
  const e = mkClient(1e9, { ...zeroUpg(), [item]: up.max });
  e._toggleReserve(item);
  globalThis.__t = 0;
  e._tickReserve();
  ok(!e._reserve.has(item) && e.sent.length === 0, '已滿級的軌 MUST 自動退出名單(留著是死預約)');

  // Second toggle cancels reservation.
  const f = mkClient(0);
  f._toggleReserve(item); f._toggleReserve(item);
  ok(f._reserve.size === 0, '再按一次 = 取消預約');

  // Spectator / unseated: inert without side assignment.
  const g = mkClient(1e9);
  g.side = null; g._reserve.add(item);
  g._tickReserve();
  ok(g.sent.length === 0 && g._sweepBuy() === 0, '沒有 side(觀戰/未入座)時掃貨與預約都不動作');
}

console.log(fail
  ? `\n✗ 商店掃貨 / 預約稽核:${fail} 項未通過(共 ${pass + fail})`
  : `\n✓ 商店掃貨 / 預約稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
