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
//   Ⅲ 只**掃**八軌:陣營小兵強化是同陣營共用、且刻意不做樂觀扣款 ⇒ 掃貨的迴圈條件永遠成立,
//     掃進去 = 一次掃光全部身家。**預約收它**(2026-08-02 使用者定案「商店的預約包含兵線升級」)
//     —— 預約是一次一階,不吃那個坑;但因為沒有樂觀扣款,同一輪多條兵線 MUST 自己記帳(`pend`),
//     否則三條線都看到同一筆錢而全數下單,後兩筆被伺服器拒 = 假的「資金不足」。
//   Ⅳ 預約不重複下單:樂觀更新會被下一份快照的權威值校正回去,若那份快照比伺服器處理購買
//     還早到(RTT > 125ms),沒有「同一階只送一次」的閘就會重送,第二筆被拒 ⇒ 玩家看到
//     一句莫名其妙的「資金不足」。逾時窗是被拒時的救濟閥,MUST NOT 短到蓋不住一次往返。
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
/** 剝掉註解再驗原文(註解裡提到某個名字不算「第二處實作」) */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

// ── 真品行為直測用的最小客戶端 ────────────────────────────────
// 四支方法的原文直接抽出來跑;`_optimisticBuy` 以測試替身代入(它已由既有路徑覆蓋,
// 這裡要驗的是「挑哪一項、挑幾次、送不送」)。
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
  { now: () => (globalThis.__t ?? 0) * 1000 });   // 真品吃 performance.now()/1000 ⇒ 這裡回毫秒

const RESEND_S = Number(/const RESERVE_RESEND_S = ([\d.]+)/.exec(gameSrc)?.[1]);
const TRACKS = Object.keys(ECON.UPGRADES);
const zeroUpg = () => Object.fromEntries(TRACKS.map((k) => [k, 0]));
const maxUpg = () => Object.fromEntries(TRACKS.map((k) => [k, ECON.UPGRADES[k].max]));

/** 造一個最小可跑的交戰客戶端;`sent` 記下所有送出的購買(小兵強化記成 `creep:<lane>`)*/
const mkClient = (money, upg = zeroUpg(), creep = [0, 0, 0], kn = BATTLE_SCORE.MAX) => {
  const sent = [];
  const c = Object.assign(Object.create(null), proto, {
    side: 'SWARM', money, upg, kn, shopOpen: false,
    creepUpg: { SWARM: creep },
    _reserve: new Set(), _resSent: {},
    hud: { feed() {}, shop() {} },
    net: { send(m) { sent.push(`${m.item}:${m.lane}`); } },
    _shopSig: null,
    // 樂觀購買替身:扣款 + 推進等級(與真品 `_optimisticBuy` 的可觀察效果一致)
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
  const L3 = upgradePrice(ECON.UPGRADES[TRACKS[0]], 2);
  ok(L2 > L1 && L3 > L2, `階梯單價嚴格遞增($${L1} < $${L2} < $${L3})—— 貪心便宜優先才會是最佳解`);

  const c = mkClient(L1 * 2 + L1 - 1);       // 剛好買得起兩階、差一元買不起第三階
  const n = c._sweepBuy();
  ok(n === 2 && c.sent.length === 2, `掃貨買到買不起為止(預期 2 階,實得 ${n})`);
  ok(c.money === L1 - 1, `餘額 = 起始 − 已購(實得 $${c.money})`);
  ok(new Set(c.sent).size === 2,
    '同樣的錢優先鋪不同軌的第一階(便宜優先的可觀察結果;退回宣告順序會把錢押在同一軌)',
    c.sent.join(','));

  const poor = mkClient(L1 - 1);
  ok(poor._sweepBuy() === 0 && poor.money === L1 - 1, '一項都買不起時掃貨不下單也不扣錢');

  // 戰鬥分數門檻(2026-08-11):錢無限但零戰績 ⇒ 只買得到每一軌的第一階
  const green = mkClient(1e9, zeroUpg(), [0, 0, 0], 0);
  ok(green._sweepBuy() === TRACKS.length,
    `戰鬥分數 0 時掃貨只買得到八軌各自的第一階(預期 ${TRACKS.length},實得 ${green.sent.length})`);
  ok(TRACKS.every((k) => green.upg[k] === 1), '第二階被戰鬥分數門檻擋下(錢再多也不行)');

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

// ── Ⅲ 掃貨只作用於八軌 / 預約收兵線升級 ────────────────────────
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

  // 鍵的格式只有一份:main.js MUST NOT 自己拼字串,一律拿 `_shopState().creepKey`
  ok(count(code(gameSrc), new RegExp(`'${RES_CREEP}'`, 'g')) === 1
    && /creepKey: \(lane\) => this\._creepResKey\(lane\)/.test(gameSrc),
    '預約鍵格式單一縫(`RES_CREEP` 一處定義 + `creepKey` 對外)');
  ok(!/creep:\$\{|'creep:'|`creep:/.test(code(mainSrc)) && /st\.creepKey\(li\)/.test(mainSrc),
    'main.js MUST NOT 自己拼預約鍵(拼錯不報錯,只會「★ 亮著卻永遠不成交」)');

  // 解鎖門檻只有一份:UI 與排程同吃 `_upgAllMax`
  ok(count(gameSrc, /\n  _upgAllMax\(/g) === 1 && /allMax: this\._upgAllMax\(\)/.test(gameSrc),
    '`_upgAllMax` 一份實作,商店 UI 走 `_shopState().allMax`');
  ok(/st\.allMax && st\.creepUpg\?\.length/.test(mainSrc)
    && !/Object\.entries\(ECON\.UPGRADES\)\.every/.test(code(mainSrc)),
    'renderShop MUST NOT 自己再算一次「八軌全滿」(兩份門檻會漂)');
}

// ── Ⅲ-b 兵線升級預約的行為 ──────────────────────────────────────
sec('Ⅲ-b 兵線升級預約');
{
  const P = CREEP_UPG.PRICE;
  // 八軌沒買滿:伺服器根本不受理 ⇒ 預約靜靜等著(送出去只會換來一句被拒的 toast)
  const early = mkClient(1e9);
  early._toggleReserve(early._creepResKey(0));
  globalThis.__t = 0;
  early._tickReserve();
  ok(early.sent.length === 0, '八軌未滿時預約不下單(門檻與伺服器 `_upgAllMax` 同一條)');
  ok(early._reserve.size === 1, '未解鎖 MUST 只是等著,MUST NOT 把它踢出名單');

  // 解鎖後:錢一夠就下單
  const c = mkClient(P - 1, maxUpg());
  c._toggleReserve(c._creepResKey(2));
  globalThis.__t = 0;
  c._tickReserve();
  ok(c.sent.length === 0, '差一元:不下單');
  c.money = P;
  c._tickReserve();
  ok(c.sent.join() === 'creep:2', `錢一夠自動下單(帶對兵線;實得 ${c.sent.join() || "無"})`);

  // 沒有樂觀扣款 ⇒ 同一階 MUST NOT 重送
  globalThis.__t = RESEND_S * 0.5;
  c._tickReserve();
  ok(c.sent.length === 1, '權威等級還沒回來之前 MUST NOT 對同一階重送(共用值不做樂觀更新)');
  c.creepUpg.SWARM[2] = 1;                    // 權威快照回來:等級前進
  c._tickReserve();
  ok(c.sent.length === 2, '權威等級一前進就買下一階,不必等逾時窗');

  // 三條兵線同時預約、錢只夠一階 ⇒ 本輪只准送一筆(否則後兩筆被拒 = 假的「資金不足」)
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

  // 滿級自動退出名單
  const full = mkClient(1e9, maxUpg(), [CREEP_UPG.MAX, 0, 0]);
  full._toggleReserve(full._creepResKey(0));
  full._tickReserve();
  ok(!full._reserve.size && full.sent.length === 0, '已滿級的兵線 MUST 自動退出名單');

  // 沒有 side:不動作
  const spec = mkClient(1e9, maxUpg());
  spec._reserve.add('creep:0'); spec.side = null;
  spec._tickReserve();
  ok(spec.sent.length === 0, '觀戰/未入座時兵線預約也不動作');
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
