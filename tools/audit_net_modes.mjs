// ============ 三種連線機制稽核(離線靜態規則 + netmode 直測)============
// 用法:node tools/audit_net_modes.mjs
//
// 守的是三條會「靜靜壞掉」的線:
//   ①【瀏覽器安全】單機版把 `server/rooms.js`→`sim.js`/`bots.js` 直接跑在瀏覽器裡。
//     任何人日後在這三支加一行 `import fs from 'fs'` 或 `process.env.X`,伺服器版照跑、單機版整支炸,
//     而且只有在真的按下「單機模式」時才看得出來 —— 所以在這裡先擋。
//   ②【單一真相縫】房間/配對/戰鬥生命週期只准住 `rooms.js`;`server.js` 只做傳輸層,
//     客戶端只准經 `makeNet()` 取傳輸層、只准經 `netmode.js` 判斷模式。
//   ③【佈局鏡射】dev 伺服器與靜態單機版出的 URL 佈局必須一致(`/public/**` + `/server/*.js`),
//     否則 `data.js` 會被載入兩次(兩份平衡數值),或單機版 import 直接 404。
//   ④【同時多路徑】區網模式要讓有線 LAN / WiFi / Tailscale 同時都連得進來。壞掉的方式全都是靜默的:
//     憑證 SAN 凍在第一次生成、介面熱插拔後沒重簽、`--https` 之下明文 http 是死的、
//     兩個 WebSocketServer 讓心跳只掃到一半的連線 —— 每一條都只有「某一個隊友連不上」看得出來。
import fs from 'fs';
import path from 'path';
import net from 'net';
import os from 'os';
import http from 'http';
import https from 'https';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';
import {
  LINK_MODES, LINK_MODE_KEYS, DEFAULT_LINK_MODE, netMode, setNetMode,
  wsUrl, modeReady, normalizeCloudUrl, soloOnly,
} from '../public/js/netmode.js';
import { readSrc, grabMethod, grabFn } from './audit_src.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const exists = (...p) => fs.existsSync(path.join(ROOT, ...p));

let bad = 0;
const ok = (cond, msg) => {
  if (cond) console.log(`  ✅ ${msg}`);
  else { bad++; console.log(`  ❌ ${msg}`); }
};

// ---------------- ① 瀏覽器安全:單機版會載入的伺服器模組 ----------------
console.log('▍瀏覽器安全(單機版直接在分頁裡執行的伺服器模組)');
// 單機版會載入的三支。**新增檔案時 MUST 同步加進這裡與 build_solo.mjs / server.js 的白名單**
const BROWSER_SERVER_FILES = ['rooms.js', 'sim.js', 'bots.js'];
const NODE_BUILTINS = /^(node:)?(fs|path|os|http|https|net|url|crypto|child_process|worker_threads|zlib|stream|events|ws)$/;
for (const f of BROWSER_SERVER_FILES) {
  const src = read('server', f);
  const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  const builtin = imports.filter((s) => NODE_BUILTINS.test(s));
  ok(builtin.length === 0, `server/${f} MUST NOT import Node 內建模組${builtin.length ? `(發現 ${builtin.join('/')})` : ''}`);
  // 註解裡提到 process/Buffer 是說明用,只掃程式碼:先剝掉行註解與區塊註解
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/\bprocess\s*\./.test(code), `server/${f} MUST NOT 用 process.*`);
  ok(!/\bBuffer\b/.test(code) && !/\brequire\s*\(/.test(code), `server/${f} MUST NOT 用 Buffer / require()`);
  // 相對 import 一律要指得到真的存在的檔(鏡射佈局下瀏覽器解析結果與 Node 相同)
  for (const s of imports.filter((x) => x.startsWith('.'))) {
    ok(exists('server', path.dirname(s) === '.' ? s : s), `server/${f} 的 import「${s}」指得到檔案`);
  }
}

// ---------------- ② 單一真相縫 ----------------
console.log('\n▍單一真相縫(房間邏輯 / 傳輸層 / 模式判定各只有一份)');
const serverJs = read('server', 'server.js');
const roomsJs = read('server', 'rooms.js');
ok(/import\s*\{[^}]*RoomHub[^}]*\}\s*from\s*'\.\/rooms\.js'/.test(serverJs), 'server.js MUST 由 rooms.js 取得 RoomHub');
ok(!/new\s+BattleSim\b/.test(serverJs), 'server.js MUST NOT 自己 new BattleSim(房間生命週期只住 rooms.js)');
ok(!/new\s+BotBrain\b/.test(serverJs), 'server.js MUST NOT 自己 new BotBrain');
for (const seam of ['startBattle', 'snapshotFor', 'roomListPayload', 'validateBattleConfig']) {
  ok(roomsJs.includes(seam), `rooms.js 保有房間結算縫「${seam}」`);
}
// 主堡陣營歸屬 50% 對調(2026-08-01「再戰不換邊」):實作一份、擲點兩個,且都留在房間階段。
// 原文一律經 audit_src.readSrc(CRLF 工作區的計數才準;見 CLAUDE.md §5 ㋑)。
const roomsSrc = readSrc('server', 'rooms.js');
const swapImpl = (roomsSrc.match(/cfg\.bases\.SWARM = cfg\.bases\.STEEL/g) || []).length;
ok(swapImpl === 1, `主堡對調 MUST 只有一份實作 rollSideSwap(實際 ${swapImpl} 處)`);
const swapCalls = (roomsSrc.match(/rollSideSwap\(/g) || []).length - 1;   // 扣掉函式定義本身
ok(swapCalls === 2, `主堡對調 MUST 在「開房」與「再戰回房」各擲一次(實際 ${swapCalls} 處呼叫)`);
ok(/backToRoom[\s\S]{0,400}?rollSideSwap\(/.test(roomsSrc),
  '再戰回房 MUST 重擲主堡歸屬(只在開房擲 = 同一間房永遠從同一端開場)');
ok(!grabMethod(roomsSrc, 'startBattle').includes('rollSideSwap'),
  '擲點 MUST 留在房間階段,MUST NOT 移進 startBattle(客戶端房間階段的地形預建會整份作廢)');
const mainJs = read('public', 'js', 'main.js');
ok(!/\bnew\s+Net\s*\(/.test(mainJs), 'main.js MUST NOT 自己 new Net(傳輸層唯一入口 = makeNet)');
ok(/makeNet\s*\(/.test(mainJs), 'main.js MUST 經 makeNet() 建傳輸層');
// 模式判定不准散落:main.js 只准問 netmode.js,不准自己看 location.host / 硬寫 'solo'
const mainCode = mainJs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok(!/location\.host\b/.test(mainCode), 'main.js MUST NOT 自己判斷 location.host(模式判定只住 netmode.js)');
const netJs = read('public', 'js', 'net.js');
ok(/from\s*'\.\/netmode\.js'/.test(netJs), 'net.js MUST 由 netmode.js 取得模式與網址');
ok(/from\s*'\.\/localhost\.js'/.test(netJs), 'net.js MUST 由 localhost.js 取得單機傳輸層');

// ---------------- ③ 佈局鏡射(dev 伺服器 ⇄ 靜態單機版)----------------
console.log('\n▍URL 佈局鏡射(dev 與 GitHub Pages 靜態版必須同一套路徑)');
ok(/BROWSER_SERVER_FILES/.test(serverJs), 'server.js MUST 有瀏覽器可取用的伺服器模組白名單');
const wl = serverJs.match(/BROWSER_SERVER_FILES\s*=\s*new Set\(\[([^\]]*)\]\)/);
const wlFiles = wl ? [...wl[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort() : [];
ok(JSON.stringify(wlFiles) === JSON.stringify([...BROWSER_SERVER_FILES].sort()),
  `server.js 白名單 = ${BROWSER_SERVER_FILES.join('/')}(實際:${wlFiles.join('/') || '無'})`);
ok(!wlFiles.includes('server.js'), 'server.js 本身 MUST NOT 對瀏覽器外流');
ok(/urlPath\.startsWith\('\/public\/'\)/.test(serverJs) && /urlPath\.startsWith\('\/server\/'\)/.test(serverJs),
  'dev 伺服器 MUST 同時提供 /public/** 與 /server/*.js');
ok(/302/.test(serverJs) && /Location:\s*`\/public\//.test(serverJs), 'dev 伺服器根目錄 MUST 轉址到 /public/(舊書籤照樣能用)');
ok(/\/healthz/.test(serverJs), 'server.js MUST 提供 /healthz 健康檢查(雲端 probe)');

const buildJs = read('tools', 'build_solo.mjs');
const bs = buildJs.match(/SERVER_FILES\s*=\s*\[([^\]]*)\]/);
const bsFiles = bs ? [...bs[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort() : [];
ok(JSON.stringify(bsFiles) === JSON.stringify([...BROWSER_SERVER_FILES].sort()),
  `build_solo.mjs 複製清單與 dev 白名單一致(實際:${bsFiles.join('/') || '無'})`);
ok(!bsFiles.includes('server.js'), 'build_solo.mjs MUST NOT 把 server.js 複製進靜態版');
ok(/\.nojekyll/.test(buildJs), 'build_solo.mjs MUST 產生 .nojekyll(否則 GitHub Pages 的 Jekyll 會吃掉檔案)');
ok(/\.\/public\//.test(buildJs) && !/href="\/public/.test(buildJs),
  '靜態版入口 MUST 用相對網址(GitHub Pages 專案站台在子路徑,絕對路徑會 404)');

// 量測工具的合成頁也吃同一套佈局:舊的絕對路徑 `/js/…` 在鏡射佈局下是 404,
// 而 playwright 的 import 失敗只會變成「waitForFunction 逾時」,看不出是路徑問題 —— 故在這裡擋。
// 排除本檔:下面那條偵測樣式本身就長得像舊路徑,會掃到自己
const toolFiles = fs.readdirSync(path.join(ROOT, 'tools')).filter((f) => f.endsWith('.mjs') && f !== 'audit_net_modes.mjs');
const strayPaths = toolFiles.filter((f) => /['"`]\/(js|css|assets|audio)\//.test(read('tools', f)));
ok(strayPaths.length === 0, `量測工具 MUST 用 /public/… 絕對路徑${strayPaths.length ? `(仍用舊路徑:${strayPaths.join('/')})` : ''}`);

// 單機傳輸層的 import 路徑:`/public/js/` 出發的 `../../server/rooms.js` = `/server/rooms.js`
const localJs = read('public', 'js', 'localhost.js');
const hub = localJs.match(/HUB_URL\s*=\s*'([^']+)'/);
ok(!!hub, 'localhost.js MUST 用具名常數指出權威主機模組路徑');
if (hub) {
  const resolved = path.normalize(path.join('public', 'js', hub[1]));
  ok(exists(resolved), `localhost.js 的「${hub[1]}」在鏡射佈局下指到 ${resolved}`);
}

// ---------------- ④ 模式表與網址正規化(netmode.js 直測)----------------
console.log('\n▍連線機制解析(netmode.js)');
ok(JSON.stringify(LINK_MODE_KEYS) === JSON.stringify(['cloud', 'lan', 'solo']), '三種機制齊備:cloud / lan / solo');
for (const k of LINK_MODE_KEYS) {
  const m = LINK_MODES[k];
  ok(!!m && !!m.icon && !!m.label && !!m.hint, `機制「${k}」有圖示/鈕面/說明`);
  ok(!/[（(]/.test(m.label), `機制鈕面「${m.label}」MUST NOT 含括號補述(見 audit_ui_layout 規則 0)`);
}
ok(DEFAULT_LINK_MODE === 'lan', '預設機制 = 區網(開出本頁的主機)');
// index.html 只保留三顆結構鈕,文案由 main.js 從 LINK_MODES 灌入 —— 避免靜態/動態兩份文案漂移
const html = read('public', 'index.html');
const main = read('public', 'js', 'main.js');
ok(/b\.textContent\s*=\s*`\$\{m\.icon\} \$\{m\.label\}`/.test(main),
  'main.js MUST 從 LINK_MODES 灌入連線機制鈕面');
for (const k of LINK_MODE_KEYS) {
  const m = html.match(new RegExp(`<button id="link_${k}"[^>]*>([^<]*)</button>`));
  ok(!!m && !m[1].trim(), `index.html 的 #link_${k} 只保留結構,不得內嵌連線機制文案`);
}
ok(soloOnly() === false, 'Node 環境沒有 location ⇒ 不會被誤判成靜態單機站台');
ok(netMode() === 'lan', '無網址參數/無記憶 ⇒ 解析成預設的區網模式');
ok(wsUrl('solo') === null, '單機 MUST NOT 產生 WebSocket 網址');
ok(modeReady('solo') === true, '單機不需任何設定就 ready');
ok(wsUrl('cloud') === null && modeReady('cloud') === false, '雲端沒填節點網址 ⇒ 不 ready(呼叫端提示而非硬連)');
ok(setNetMode('solo') === true && netMode() === 'solo', 'setNetMode 可切到單機');
ok(setNetMode('solo') === false, '切到同一個機制回 false(不必重建傳輸層)');
ok(setNetMode('nope') === false, '未知機制一律拒絕');

const CASES = [
  ['wss://node.example.com', 'wss://node.example.com'],
  ['https://node.example.com', 'wss://node.example.com'],
  ['http://192.168.1.10:8620', 'ws://192.168.1.10:8620'],
  ['ws://100.90.1.2:8620', 'ws://100.90.1.2:8620'],
  ['', null],
  ['   ', null],
  ['ftp://node.example.com', null],
];
for (const [inp, want] of CASES) {
  const got = normalizeCloudUrl(inp);
  ok(got === want, `節點網址正規化「${inp || '(空)'}」→ ${want === null ? '拒絕' : want}${got === want ? '' : `(實得 ${got})`}`);
}

// ---------------- ⑤ GitHub Actions:單機特化版的產線 ----------------
console.log('\n▍GitHub Actions(單機特化版產線)');
const wfDir = path.join(ROOT, '.github', 'workflows');
ok(fs.existsSync(wfDir), '.github/workflows 存在');
const wfs = fs.existsSync(wfDir) ? fs.readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)) : [];
const allWf = wfs.map((f) => fs.readFileSync(path.join(wfDir, f), 'utf8')).join('\n');
ok(/build_solo\.mjs/.test(allWf), '有 workflow 呼叫 tools/build_solo.mjs 產出單機版');
ok(/actions\/deploy-pages/.test(allWf), '有 workflow 部署到 GitHub Pages');
ok(/audit_net_modes\.mjs/.test(allWf), 'CI MUST 跑本稽核(三機制的回歸防線)');
const installs = [...allWf.matchAll(/npm\s+(?:i|install|add)\s+([^\s\n#]+)/g)].map((m) => m[1]).filter((p) => !p.startsWith('-'));
ok(installs.length === 0, `workflow MUST NOT 安裝額外 npm 套件${installs.length ? `(發現 ${installs.join('/')})` : ''};唯一依賴 ws,見 /CLAUDE.md A2`);

// ---------------- ⑥ 同時多路徑(有線 LAN / WiFi / Tailscale 一起通)----------------
console.log('\n▍同時多路徑(server.js 傳輸層)');
const srvSrc = readSrc('server', 'server.js');

// (a) 單埠雙協定:第一個位元組分流,且**非 TLS 模式維持原路徑**(不為了分流讓 npm start 也繞一層)
const demuxSrc = grabFn(srvSrc, 'demux');
ok(/0x16/.test(demuxSrc), 'demux MUST 以第一個位元組 0x16(TLS handshake)分流 http / https');
ok(/\bunshift\(/.test(demuxSrc), 'demux MUST 把探測位元組 unshift 回串流(交給真正的伺服器解析)');
ok(!/\.resume\(/.test(demuxSrc),
  'demux MUST NOT 用 resume() —— TLSSocket 在 nextTick 才補餵已緩衝位元組,先 resume 會把握手第一段流掉(https 連得上但永不回應)');
ok(/SECURE\s*\?\s*net\.createServer\(demux\)\s*:\s*plainServer/.test(srvSrc),
  '沒開 TLS MUST 維持 http 伺服器自己 listen(分流層只在 --https 之下才存在)');

// (b) WebSocketServer 只有一份:心跳掃的是 wss.clients,分兩份就有一半死連線回收不掉
const wssNew = (srvSrc.match(/new\s+WebSocketServer\s*\(/g) || []).length;
ok(wssNew === 1, `server.js MUST 只有一個 WebSocketServer 實例(實際 ${wssNew} 處;心跳 wss.clients 才涵蓋 ws + wss)`);
ok(/noServer:\s*true/.test(srvSrc) && /handleUpgrade\(/.test(srvSrc),
  'WebSocketServer MUST 用 noServer + 兩個 http 伺服器各自轉交 upgrade');

// (c) 憑證 SAN 取聯集:蓋不到才重簽、簽過的名字留著
const certSrc = grabFn(srvSrc, 'ensureCert');
ok(/missing\.length === 0/.test(certSrc) && /\.\.\.have/.test(certSrc),
  'ensureCert MUST 只在「現用位址有沒簽過的」時重簽,且新 SAN = 舊 ∪ 新(位址會來回,簽過的名字 MUST 留著)');
ok(!/if\s*\(fs\.existsSync\([^)]*\)\s*&&\s*fs\.existsSync\([^)]*\)\)\s*return/.test(certSrc),
  'ensureCert MUST NOT 退回「有憑證檔就直接用」(之後才上線的路徑永遠蓋不到 = 同時多路徑的頭號病灶)');
ok(/have\.size\s*\?\s*readCertPair\(\)\s*:\s*null/.test(certSrc),
  '沒有 openssl 但有舊憑證 MUST 沿用舊的(降級不例外),完全沒有才回 null 讓呼叫端退回 http');

// (d) 介面熱插拔:位址集合一變就重簽並熱換 secure context
ok(/setSecureContext\(/.test(srvSrc),
  '位址監看 MUST 熱換 secure context(不然 WiFi/Tailscale 晚一步上線就得重啟伺服器)');
ok(/if\s*\(!CLOUD\)\s*\{[\s\S]{0,600}?addrSig\(\)/.test(srvSrc), '位址監看 MUST 只在非雲端跑(雲端位址固定且不廣播)');
ok(/let TS_NAME/.test(srvSrc), 'MagicDNS 名 MUST 可後補(`tailscale up` 常晚於伺服器啟動)');

// (e) 行為直測:起一支真的 server,同一個埠四種打法全通
const freePort = () => new Promise((res) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const probeHttp = (mod, port) => new Promise((res) => {
  const r = mod.request({ host: '127.0.0.1', port, path: '/healthz', rejectUnauthorized: false }, (s) => {
    let b = ''; s.on('data', (c) => { b += c; });
    s.on('end', () => { try { res(s.statusCode === 200 && JSON.parse(b).ok === true); } catch { res(false); } });
  });
  r.on('error', () => res(false));
  r.setTimeout(5000, () => { r.destroy(); res(false); });
  r.end();
});
const probeWs = (url) => new Promise((res) => {
  const w = new WebSocket(url, { rejectUnauthorized: false });
  const t = setTimeout(() => { w.terminate(); res(false); }, 5000);
  w.on('open', () => w.send(JSON.stringify({ t: 'listRooms' })));
  w.on('message', (raw) => { clearTimeout(t); w.close(); try { res(JSON.parse(raw).t === 'rooms'); } catch { res(false); } });
  w.on('error', () => { clearTimeout(t); res(false); });
});

const port = await freePort();
const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js'), '--lan', '--https', '--port', String(port)],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
let boot = '';
srv.stdout.on('data', (d) => { boot += d; });
srv.stderr.on('data', (d) => { boot += d; });
await new Promise((r) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    if (/={10,}\s*$/.test(boot.trim()) || Date.now() - t0 > 15000) { clearInterval(iv); r(); }
  }, 100);
});
try {
  ok(await probeHttp(http, port), `明文 http://127.0.0.1:${port}/healthz 在 --https 之下照樣通(桌機打 IP 被瀏覽器補的就是 http)`);
  ok(await probeWs(`ws://127.0.0.1:${port}`), 'ws:// 走得到同一個 RoomHub');
  // 沒有 openssl ⇒ 伺服器已退回 http,TLS 那半沒得驗(降級不例外;此時上面兩項仍 MUST 通過)
  const secure = /https:\/\/localhost/.test(boot);
  if (!secure) {
    console.log('  ⏭  跳過 TLS 半場:此機器沒有 openssl,伺服器已退回 http(見啟動訊息)');
  } else {
    ok(await probeHttp(https, port), `同一個埠的 https://127.0.0.1:${port}/healthz 也通(單埠雙協定)`);
    ok(await probeWs(`wss://127.0.0.1:${port}`), 'wss:// 走得到同一個 RoomHub');
    // 憑證 MUST 涵蓋當下每一條路徑,不只第一次生成時那幾個
    const san = JSON.parse(fs.readFileSync(path.join(ROOT, '.certs', 'san.json'), 'utf8'));
    const ifs = Object.values(os.networkInterfaces()).flat().filter((i) => i.family === 'IPv4' && !i.internal);
    const uncovered = ifs.map((i) => `IP:${i.address}`).filter((n) => !san.includes(n));
    ok(san.includes('DNS:localhost') && uncovered.length === 0,
      `自簽憑證 SAN MUST 涵蓋當下每一個對外 IPv4${uncovered.length ? `(漏:${uncovered.join(', ')})` : `(${ifs.length} 條路徑)`}`);
  }
  // ------------- ⑦ 開發工具啟停端點(dev-only;會開行程 ⇒ 閘門是安全邊界)-------------
  // 2026-08-04 使用者定案:設定頁的「2D 生圖對照台」旁邊加一顆啟動/停止鈕。
  // 這是本專案唯一一個「HTTP 進來 → spawn 一支行程」的路徑,所以閘門本身就是要稽核的東西。
  console.log('\n▍開發工具啟停(/dev/tools)');
  const supSrc = read('tools', 'dev_supervisor.mjs');

  // (a) 靜態:三道閘 + 參數零信任 + 埠號不抄第二份
  ok(/if\s*\(!CLOUD\s*&&\s*urlPath\.startsWith\('\/dev\/tools'\)\)/.test(srvSrc),
    'server.js MUST 在 `!CLOUD` 之下才掛這條路由(雲端節點連載都不載)');
  ok(/import\('\.\.\/tools\/dev_supervisor\.mjs'\)/.test(srvSrc) && /\.catch\(\(\) => null\)/.test(srvSrc),
    'MUST 動態 import 且載不到就當沒有這條路由(出貨版沒有 tools/)');
  // 埠號**逐支**都要從那支工具自己 import(抄一份 = 改埠之後啟得起來卻探不到,鈕面永遠停在
  // 「▶ 啟動」)。這一條 MUST 隨 TOOLS 一起長:新增一支工具就會多一列 import 要驗。
  {
    const sup = await import('./dev_supervisor.mjs');
    const srcOf = { codex: 'codex_review', parts: 'parts_review', story: 'story_book' };
    for (const key of Object.keys(sup.TOOLS)) {
      const t = sup.TOOLS[key];
      ok(t.kind === 'server' || t.kind === 'job', `${key}:kind 是 server / job 其中之一(實得 ${t.kind})`);
      ok(!/^\d+$/.test(String(t.script)) && t.script.startsWith('tools' + path.sep),
        `${key}:script 是 tools/ 底下的常數路徑`);
      // **只有 server 有埠**。2026-08-10 加入的採集迴圈是 `job` —— 它不聽任何埠,
      // 拿 `listening()` 去問它會永遠回「沒開」,鈕面停在「▶ 啟動」而背景每按一次多開一支。
      if (t.kind !== 'server') {
        ok(t.port === undefined, `${key}(job):MUST NOT 宣告埠(有埠 = 存活判準會被誤用成探埠)`);
        continue;
      }
      const mod = srcOf[key];
      ok(!!mod && new RegExp(`import \\{ DEFAULT_PORT as \\w+ \\} from '\\./${mod}\\.mjs'`).test(supSrc),
        `${key}:埠號 MUST 從 tools/${mod || '?'}.mjs import,MUST NOT 抄一份`);
      const m = await import(`./${mod}.mjs`);
      ok(t.port === m.DEFAULT_PORT,
        `${key}:TOOLS 的埠(${t.port})= 工具自己的 DEFAULT_PORT(${m.DEFAULT_PORT})`);
    }
    const ports = Object.values(sup.TOOLS).filter((t) => t.kind === 'server').map((t) => t.port);
    ok(new Set(ports).size === ports.length, `每一支伺服器型工具的埠互不相同(${ports.join(', ')})`);
    // job 的存活判準 MUST 是「我們自己的子行程還在」;server 才問埠
    ok(/const alive = \(rec\) =>/.test(supSrc) && /kind === 'job'/.test(supSrc),
      'job 的存活判準是自己的子行程(沒有埠可以探)');
  }
  // argv 仍然零信任,只是多了一段**推導**:`argvOf` 會把資料家接上去(語料家會搬 ⇒ 寫死等於下次就錯),
  // 而那條路徑是從檔案系統算出來的 —— 請求一個字都碰不到。
  // 2026-08-11 起請求可以**指名**要跑哪一個資料家(儲存庫外那一份不給挑就永遠跑不到),
  // 而鬆的方式 MUST 是**索引**:第二個參數是已經解析好的路徑,解析只發生在 `start` 裡面。
  ok(/spawn\(process\.execPath, \[t\.script, \.\.\.argv\]/.test(supSrc)
    && /export function argvOf\(t, home = null\)/.test(supSrc)
    && /corpusHomes\(\)\[homeIdx\]\?\.home/.test(supSrc)
    && !/argvOf\([^)]*req/.test(supSrc)
    && !/spawn\([^)]*req\./.test(supSrc),
    'spawn 的 argv MUST 來自 TOOLS 常數 + argvOf 推導,請求只能挑一個 key 與一個索引(參數零信任)');
  ok(/\/\^\\\/dev\\\/tools\\\/\(\[a-z0-9_-\]\{1,32\}\)\\\/\(start\|stop\)\$\//.test(supSrc)
    || /\[a-z0-9_-\]\{1,32\}/.test(supSrc),
    '動作路徑 MUST 以白名單字元集比對(key 進不了命令列,也進不了檔案路徑)');
  ok(/x-dev-tools'\] !== '1'/.test(supSrc),
    '改變狀態的請求 MUST 要一個非簡單標頭(擋跨來源網頁的 CSRF)');
  // 「還是不是我們的」判準 MUST 與 `alive()` 同一份:紀錄在停掉之後刻意留著(執行進度頁要看
  // 日誌)⇒「這一格還在」不再等於「它還跑著」,而伺服器型工具收埠比行程退出快 ——
  // 只看 exitCode 的話第二次按停止會再 kill 一次並回報成功。
  ok(/if\s*\(!rec \|\| !alive\(rec\)\)/.test(supSrc),
    '停止 MUST 只停自己開的那支(憑一個埠號決定殺誰 = 寧缺勿錯的反面)');
  ok(!/running\.delete\(/.test(supSrc),
    '停掉之後日誌留著(刪掉 = 按下停止的瞬間執行進度頁整個清空,看起來像剛才什麼都沒跑)');
  ok(!read('tools', 'build_solo.mjs').includes('dev_supervisor'),
    '單機打包 MUST NOT 把這支複製出去(它只複製 public/** 與白名單三支 server 模組)');

  // (b) 行為直測:同一支跑著的伺服器,loopback 通、區網位址 404
  const devReq = (host, p, opts = {}) => new Promise((res) => {
    const r = http.request({ host, port, path: p, method: opts.method || 'GET', headers: opts.headers || {} }, (s) => {
      let b = ''; s.on('data', (c) => { b += c; });
      s.on('end', () => res({ code: s.statusCode, body: b }));
    });
    r.on('error', () => res({ code: 0, body: '' }));
    r.setTimeout(8000, () => { r.destroy(); res({ code: 0, body: '' }); });
    r.end();
  });
  const lo = await devReq('127.0.0.1', '/dev/tools');
  let tools = [];
  try { tools = JSON.parse(lo.body).tools || []; } catch { /* 下一行會紅 */ }
  ok(lo.code === 200 && ['codex', 'parts', 'harvest'].every((k) => tools.some((t) => t.key === k)),
    'loopback 拿得到工具清單(codex 2D 生圖對照台 / parts 3D 零件對照台 / harvest 採集迴圈)');
  ok(tools.filter((t) => t.kind === 'server')
    .every((t) => typeof t.url === 'string' && /^http:\/\/localhost:\d+\/$/.test(t.url)),
    '伺服器型工具自己帶網址(客戶端因此一個埠號都不用寫死)');
  // job 回一個假的 `http://localhost:undefined/` 會讓客戶端畫出一個點不開的連結,
  // 而那看起來像「台子壞了」⇒ 沒有埠就**不要回網址**
  ok(tools.filter((t) => t.kind === 'job').every((t) => t.url === undefined && t.port === undefined),
    '工作型工具不回網址也不回埠(沒有埠就不要假裝有)');
  const lan = Object.values(os.networkInterfaces()).flat()
    .find((i) => i.family === 'IPv4' && !i.internal)?.address;
  if (!lan) console.log('  ⏭  跳過區網位址那一項:這台機器沒有對外 IPv4');
  else {
    const out = await devReq(lan, '/dev/tools');
    ok(out.code === 404, `非 loopback(${lan})MUST 拿到 404 —— 隊友連進來看不到這個端點`);
  }
  ok((await devReq('127.0.0.1', '/dev/tools/codex/start', { method: 'POST' })).code === 403,
    '沒帶 `x-dev-tools` 標頭的 POST MUST 被拒(擋 CSRF)');
  ok((await devReq('127.0.0.1', '/dev/tools/codex/nope', {
    method: 'POST', headers: { 'x-dev-tools': '1' },
  })).code === 404, '沒有的動作 MUST 404(而不是被當成 start)');

  // (c) **逐支**真的啟停一次(啟不起來的工具在鈕面上只表現成「按了沒反應」)。
  //     那個埠已經有人在聽(使用者自己在終端機跑著)就跳過 —— MUST NOT 洗成通過。
  const sup = await import('./dev_supervisor.mjs');
  for (const t of await sup.list()) {
    if (t.listening) {
      console.log(`  ⏭  跳過 ${t.key} 啟停直測:${t.port} 已經有人在聽(可能是終端機跑著的那一支)`);
      ok((await sup.stop(t.key)).error === '這一支不是從這裡啟動的',
        `${t.key}:別人起的那一支停不掉,而且明講原因`);
      continue;
    }
    const started = await sup.start(t.key);
    // **「起來了」對兩種 kind 是兩件事**:server 問埠、job 問自己的子行程。
    // 這裡拿錯尺的下場正是這一輪要防的那個 bug —— job 永遠回報「沒起來」。
    const up = t.kind === 'job' ? started.running : started.listening;
    // job 起不來最常見的理由是「這台機器上沒有語料」,那不是回歸 ⇒ 標未驗而不是紅字
    if (t.kind === 'job' && !up && started.error) {
      console.log(`  ⏭  跳過 ${t.key} 啟停直測:${started.error}`);
      continue;
    }
    ok(up && started.owned,
      `${t.key}:start 之後${t.kind === 'job' ? '子行程還活著' : `埠 ${started.port} 真的聽得到`},而且是我們開的`);
    // 設定頁的背景行程監控只准讀管理者交出的觀測資料；PID 與起訖時間不可由客戶端猜。
    ok(Number.isInteger(started.monitor?.pid) && !!started.monitor?.startedAt
      && !!started.monitor?.lastOutputAt && started.monitor.uptimeMs >= 0,
    `${t.key}:啟動後回報背景行程的 PID、起始時間與持續時間`);
    const stopped = await sup.stop(t.key);
    ok(!(t.kind === 'job' ? stopped.running : stopped.listening) && !stopped.owned,
      `${t.key}:stop 之後${t.kind === 'job' ? '行程收掉了' : '埠放掉了'}`);
    ok(!!stopped.monitor?.endedAt && stopped.monitor.uptimeMs >= 0,
      `${t.key}:停止後保留背景行程的結束時間與持續時間`);
    ok((await sup.stop(t.key)).error === '這一支不是從這裡啟動的', `${t.key}:重複 stop 不炸,而且明講原因`);
  }
} finally {
  srv.kill();
}

// 雲端節點根本不掛這條路由(上面那支是 --lan;這裡另起一支 --cloud 對照)
{
  const cport = await freePort();
  const csrv = spawn(process.execPath,
    [path.join(ROOT, 'server', 'server.js'), '--cloud', '--port', String(cport)],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let cboot = '';
  csrv.stdout.on('data', (d) => { cboot += d; });
  await new Promise((r) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (/={10,}\s*$/.test(cboot.trim()) || Date.now() - t0 > 15000) { clearInterval(iv); r(); }
    }, 100);
  });
  try {
    const got = await new Promise((res) => {
      const r = http.request({ host: '127.0.0.1', port: cport, path: '/dev/tools' }, (s) => {
        s.resume(); s.on('end', () => res(s.statusCode));
      });
      r.on('error', () => res(0));
      r.setTimeout(8000, () => { r.destroy(); res(0); });
      r.end();
    });
    ok(got === 404, `雲端模式(--cloud)MUST NOT 有 /dev/tools(實際 ${got})`);
  } finally {
    csrv.kill();
  }
}

console.log(bad === 0 ? '\n🎉 三種連線機制稽核全數通過' : `\n💥 ${bad} 項未通過`);
process.exit(bad === 0 ? 0 : 1);
