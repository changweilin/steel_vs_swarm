// ============ 單機模式開機稽核(真瀏覽器,不含 three)============
// 用法:node tools/audit_solo_boot.mjs
//
// 單機版最容易「靜靜壞掉」的地方不是遊戲邏輯,而是**模組解析**:
//   `/public/js/localhost.js` → `../../server/rooms.js` → `../public/js/data.js`
// 這條鏈只在「URL 佈局鏡射儲存庫佈局」時成立(見 server.js 檔頭)。Node 端的稽核驗不到它 ——
// 只有真的用瀏覽器去 import 才算數。本檔用一頁合成頁只載入傳輸層(不碰 three,故 CDN 被擋也能跑),
// 跑完一整局:建房 → 選陣營 → 準備 → 開戰 → 收快照,並驗 `data.js` 在分頁裡只有**一個模組實例**。
//
// 找不到 playwright 就跳過(與其他量測工具同規則,不擋 CI)。
import { chromiumOrNull, chromePath, serve, skipNoPlaywright } from './pw.mjs';

const chromium = await chromiumOrNull();
if (!chromium) skipNoPlaywright('單機模式開機稽核');

let bad = 0;
const ok = (cond, msg) => {
  if (cond) console.log(`  ✅ ${msg}`);
  else { bad++; console.log(`  ❌ ${msg}`); }
};

// 合成頁掛在 /public/ 之下 —— 相對 import 才與真正的 index.html 同一組解析基準
const PAGE = `<!DOCTYPE html><meta charset="utf-8"><body><script type="module">
import { makeNet } from './js/net.js';
import { setNetMode, netMode, wsUrl } from './js/netmode.js';
import * as dataFromClient from './js/data.js';

window.__R = { logs: [], errs: [] };
setNetMode('solo');
window.__R.mode = netMode();
window.__R.ws = wsUrl();

const inbox = [];
const net = makeNet({
  sync: (m) => inbox.push(m), rooms: (m) => inbox.push(m), error: (m) => inbox.push(m),
  info: (m) => inbox.push(m), battleConfig: (m) => inbox.push(m),
  field: (m) => inbox.push(m), snap: (m) => inbox.push(m), other: (m) => inbox.push(m),
});
window.__R.made = !!net && net.mode === 'solo';
window.__inbox = inbox;
window.__net = net;

// 平衡數值只准有一份:客戶端與瀏覽器內權威模擬 import 的 data.js MUST 是同一個模組實例
window.__sameData = async () => {
  const viaHub = await import('../server/rooms.js').then(() => import('../public/js/data.js'));
  return viaHub === dataFromClient;
};
</script></body>`;

const srv = await serve(8633);
const browser = await chromium.launch({ executablePath: chromePath() });
const page = await browser.newPage();
const pageErrs = [];
page.on('pageerror', (e) => pageErrs.push(String(e.message)));
// 只攔這一頁;其餘請求照常(本稽核不需要任何 CDN 資源)
await page.route('**/public/__solo.html', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE }));

console.log('▍單機模式開機(真瀏覽器)');
await page.goto(`${srv.url}public/__solo.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__R && window.__net, null, { timeout: 15000 }).catch(() => {});

const boot = await page.evaluate(() => window.__R || null);
ok(!!boot, '合成頁載入成功');
ok(boot?.mode === 'solo', `連線機制 = solo(實得 ${boot?.mode}）`);
ok(boot?.ws === null, '單機不產生 WebSocket 網址');
ok(boot?.made === true, 'makeNet() 回傳單機傳輸層');

// 權威模擬(rooms.js → sim.js/bots.js)由瀏覽器動態載入 —— 這一步驗的就是鏡射佈局的 import 鏈
const same = await page.evaluate(() => window.__sameData()).catch(() => null);
ok(same === true, 'data.js 在分頁裡只有一個模組實例(平衡數值不分家)');

// 跑一局:1v1 合成戰場(與 test/e2e.mjs 的 fakeBattleConfig 同一組幾何規則)
const played = await page.evaluate(async () => {
  const A = [25.0330, 121.5654], D = 1600, R = 6371000;
  const dLat = (D / R) * 180 / Math.PI;
  const B = [A[0] + dLat, A[1]];
  const lane = [];
  for (let i = 0; i <= 20; i++) lane.push([A[0] + (B[0] - A[0]) * i / 20, A[1] + (B[1] - A[1]) * i / 20]);
  const cfg = {
    center: [(A[0] + B[0]) / 2, A[1]], bases: { SWARM: A, STEEL: B },
    lanes: [lane], distM: D, diagM: D, placeName: '單機開機測試',
  };
  const net = window.__net, inbox = window.__inbox;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const last = (t) => [...inbox].reverse().find((m) => m.t === t);
  net.send({ t: 'createRoom', name: '單機指揮官', roomName: '開機測試', teamSize: 1, battleConfig: cfg });
  await wait(300);
  const pin = last('sync')?.lobby?.pin || null;
  net.send({ t: 'pickSide', side: 'SWARM' });
  net.send({ t: 'setReady', ready: true });
  net.send({ t: 'startBattle' });
  await wait(300);
  const gotCfg = !!last('battleConfig');
  net.send({ t: 'loaded' });
  await wait(1200);
  const snaps = inbox.filter((m) => m.t === 'snap');
  const errs = inbox.filter((m) => m.t === 'error').map((m) => m.msg);
  const s = snaps.at(-1);
  return {
    pin, gotCfg, errs, snaps: snaps.length,
    hasBase: !!s?.ents?.some((e) => e.k === 'base'),
    hasTower: !!s?.ents?.some((e) => e.k === 'tower'),
    hasHero: !!s?.ents?.some((e) => e.act),
  };
}).catch((e) => ({ err: String(e) }));

ok(/^\d{4}$/.test(played?.pin || ''), `瀏覽器內開出房間(PIN ${played?.pin}）`);
ok(played?.errs?.length === 0, `開局無錯誤訊息${played?.errs?.length ? `(${played.errs.join('/')})` : ''}`);
ok(played?.gotCfg === true, '收到 battleConfig(客戶端據此建地形)');
ok(played?.snaps >= 5, `8Hz 快照持續送達(${played?.snaps} 份)`);
ok(played?.hasBase && played?.hasTower, '快照含主堡與防禦塔(權威模擬在瀏覽器端跑起來)');
ok(played?.hasHero === true, '英雄實體在場(含自動補位的電腦玩家)');
ok(pageErrs.length === 0, `分頁無未捕捉例外${pageErrs.length ? `(${pageErrs[0]})` : ''}`);

// 收攤:切回連線模式時 MUST 停掉 8Hz tick,否則背景空轉吃電
const stopped = await page.evaluate(async () => {
  const before = window.__inbox.filter((m) => m.t === 'snap').length;
  window.__net.kill();
  await new Promise((r) => setTimeout(r, 600));
  return window.__inbox.filter((m) => m.t === 'snap').length === before;
});
ok(stopped === true, 'kill() 後模擬完全停止(不留背景迴圈)');

await browser.close();
srv.close();
console.log(bad === 0 ? '\n🎉 單機模式開機稽核全數通過' : `\n💥 ${bad} 項未通過`);
process.exit(bad === 0 ? 0 : 1);
