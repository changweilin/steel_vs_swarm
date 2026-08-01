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
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  LINK_MODES, LINK_MODE_KEYS, DEFAULT_LINK_MODE, netMode, setNetMode,
  wsUrl, modeReady, normalizeCloudUrl, soloOnly,
} from '../public/js/netmode.js';
import { readSrc, grabMethod } from './audit_src.mjs';

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
// index.html 的三顆靜態鈕(版型稽核要量得到)與 LINK_MODES **MUST** 逐字一致 —— 改文案只改一邊 = 版型量到舊寬度
const html = read('public', 'index.html');
for (const k of LINK_MODE_KEYS) {
  const m = html.match(new RegExp(`<button id="link_${k}"[^>]*>([^<]*)</button>`));
  const want = `${LINK_MODES[k].icon} ${LINK_MODES[k].label}`;
  ok(!!m && m[1].trim() === want, `index.html 的 #link_${k} 鈕面 = LINK_MODES 的「${want}」${m ? `(實際「${m[1].trim()}」)` : '(找不到)'}`);
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

console.log(bad === 0 ? '\n🎉 三種連線機制稽核全數通過' : `\n💥 ${bad} 項未通過`);
process.exit(bad === 0 ? 0 : 1);
