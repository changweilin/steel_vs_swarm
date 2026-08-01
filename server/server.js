// ============ 無人戰略:鋼鐵與蜂群 — 對戰伺服器(雲端 / 區網 Tailscale 共用)============
// 本檔 = **傳輸層**:HTTP 靜態檔 + WebSocket + 健康檢查;房間/配對/戰鬥生命週期全在 `server/rooms.js`
// (`RoomHub`,與傳輸層無關),單機版由瀏覽器直接 new 同一支 —— 三種連線機制共用同一份房間邏輯。
//
// 三種機制對應的啟動方式:
//   ・雲端  `node server/server.js --cloud`      (PORT 由平台注入;不廣播區網位址,房間數設上限)
//   ・區網  `node server/server.js --lan --https`(印出 Tailscale / 區網網址與自簽憑證說明)
//   ・單機  完全不用本檔(見 `public/js/localhost.js` + `tools/build_solo.mjs`)
//
// 【同時多路徑】區網模式 MUST 讓有線 LAN / WiFi / Tailscale **同時**都連得進來,不需為某一條路重跑或重設。
// 監聽 0.0.0.0 只解決了 TCP 那一半,另外三件事沒做就是「某一條路靜靜連不上」:
//   ①自簽憑證的 SAN 在第一次生成時就凍住 —— 之後才接上的 WiFi / Tailscale 位址不在裡面,
//     那條路徑的瀏覽器直接擋在憑證主體不符(見 ensureCert:SAN 取聯集,缺涵蓋才重簽)。
//   ②介面是會熱插拔的(WiFi 換網、`tailscale up` 晚於開伺服器)⇒ 位址集合要持續盯,
//     變了就重簽並熱換 secure context(見 ADDR_WATCH_MS 那段),否則只能重啟伺服器。
//   ③`--https` 之下 `http://<ip>:PORT` 是死的,而桌機瀏覽器打 IP 預設補的就是 http ——
//     故同一個埠用第一個位元組分流(0x16 = TLS)同時吃 http 與 https(見 demux)。
//
// 【URL 佈局】瀏覽器看到的路徑 **MUST** 鏡射儲存庫佈局:`/public/**` 與 `/server/*.js`,`/` 302 到 `/public/`。
// 理由:單機版的瀏覽器要 import `/server/rooms.js`,而它 import `../public/js/data.js` ——
// 只有鏡射佈局能讓 `data.js` 在整個瀏覽器分頁裡是**同一個模組實例**(否則主程式與 sim 各拿一份平衡數值)。
// GitHub Pages 的靜態單機版用同一套佈局(見 `tools/build_solo.mjs`),故 dev 與線上完全一致。
import http from 'http';
import https from 'https';
import net from 'net';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { RoomHub } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const SERVER_DIR = __dirname;
// 單機版在瀏覽器裡會 import 這三支(權威模擬 + 電腦玩家 + 房間中樞);server.js 自己**不**對外提供。
const BROWSER_SERVER_FILES = new Set(['sim.js', 'bots.js', 'rooms.js']);

// 命令列參數:`--port 8620` 或 `--port=8620`(PowerShell 不吃 PORT=xxx 前綴)
function argVal(...names) {
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    for (const n of names) {
      if (a[i] === n) return a[i + 1];
      if (a[i].startsWith(n + '=')) return a[i].slice(n.length + 1);
    }
  }
  return undefined;
}
const hasFlag = (...names) => process.argv.slice(2).some((a) => names.includes(a));

const PORT = argVal('--port', '-p') || process.env.PORT || 8620;
const HOST = argVal('--host') || process.env.HOST || '0.0.0.0';
// 連線機制:--cloud 雲端節點 / --lan 區網(含 Tailscale)。兩者都不給 = 區網(本機開發預設)。
// `--lan` 明確指定區網(壓過環境變數;讓 `npm run lan` 在設了 SVS_CLOUD 的機器上仍是區網)
const CLOUD = !hasFlag('--lan') && (hasFlag('--cloud') || process.env.SVS_CLOUD === '1');
const LINK_MODE = CLOUD ? 'cloud' : 'lan';
// 雲端節點的房間上限:單一節點被開房洗滿會拖垮全部對局(每間房一支 8Hz tick)。區網不限。
const MAX_ROOMS = Number(argVal('--max-rooms') || process.env.SVS_MAX_ROOMS || (CLOUD ? 24 : 0)) || 0;
// `--https`:用自簽憑證起 TLS。手機陀螺儀**必須**要這個 ——
// 瀏覽器只在 secure context(https 或 localhost)才送 deviceorientation 事件,
// 用 http://<區網 IP> 開的話感測器**靜默不作動**(沒有錯誤、沒有權限提示,就是不動)。
// 雲端一律由平台/反向代理終止 TLS,不在這裡起(見 docs/deploy.md)。
const USE_HTTPS = hasFlag('--https', '--tls') && !CLOUD;
const CERT_DIR = path.join(ROOT_DIR, '.certs');   // 已入 .gitignore(自簽私鑰 MUST NOT 進版控)
const KEY_FILE = path.join(CERT_DIR, 'key.pem');
const CRT_FILE = path.join(CERT_DIR, 'cert.pem');
// 這張憑證簽過哪些名字。沒有這份紀錄就只能「每次開機都重簽」(隊友天天被要求重按一次憑證例外)
// 或「有檔案就用」(= 現行 bug:後來才接上的網路那條路徑永遠蓋不到)。
const SAN_FILE = path.join(CERT_DIR, 'san.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

/**
 * 本機所有非內部 IPv4,附上「這是哪一種網路」。
 * Tailscale 的位址落在 CGNAT 段 100.64.0.0/10(tailscale0 / utun 介面)—— 玩家連的是這一組,
 * 與家用區網 192.168.x 分開列出,不然一長串位址不知道該給隊友哪一個。
 */
function netAddrs() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name in ifaces) {
    for (const i of ifaces[name] || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      const o = i.address.split('.').map(Number);
      const ts = o[0] === 100 && o[1] >= 64 && o[1] <= 127;   // 100.64.0.0/10(CGNAT = Tailscale)
      out.push({ ip: i.address, iface: name, kind: ts ? 'tailscale' : 'lan' });
    }
  }
  return out;
}
const lanIps = () => netAddrs().map((a) => a.ip);

/** Tailscale MagicDNS 名稱(裝了 tailscale CLI 才拿得到;拿不到回 null,不影響用 IP 連) */
function magicDnsName() {
  try {
    const j = JSON.parse(execFileSync('tailscale', ['status', '--json'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).toString());
    const dns = j?.Self?.DNSName;
    return dns ? dns.replace(/\.$/, '') : null;
  } catch {
    return null;
  }
}
// MagicDNS 名字可能晚於伺服器才有(`tailscale up` 在後面才跑)⇒ 位址監看那段會補問一次,故不是 const
let TS_NAME = CLOUD ? null : magicDnsName();

/** 憑證 MUST 涵蓋的名字:localhost + 迴路 + 當下每一條路徑的 IPv4 + MagicDNS */
function sanNames() {
  return [
    'DNS:localhost', 'IP:127.0.0.1',
    ...lanIps().map((ip) => `IP:${ip}`),
    ...(TS_NAME ? [`DNS:${TS_NAME}`] : []),
  ];
}

/** 現用憑證簽過的名字;讀不到/壞掉一律當成沒簽過(下一步就會重簽) */
function certSan() {
  if (!fs.existsSync(KEY_FILE) || !fs.existsSync(CRT_FILE)) return [];
  try {
    const j = JSON.parse(fs.readFileSync(SAN_FILE, 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

const readCertPair = () => ({ key: fs.readFileSync(KEY_FILE), cert: fs.readFileSync(CRT_FILE) });

/** 現用憑證還蓋不到的名字(只有在缺 openssl 時才會非空;啟動訊息會據此提醒) */
let certGaps = [];

/**
 * 自簽憑證(`--https` 用):`.certs/{key,cert}.pem`,缺涵蓋就用系統 openssl 重簽一張 10 年期的。
 * SAN 帶上 localhost + 127.0.0.1 + 當下所有區網/Tailscale IP + MagicDNS 名 —— 隊友直接連才不會被判憑證主體不符
 * (仍會有「不安全連線」警告:自簽憑證沒有 CA 背書,點「繼續前往」即可,secure context 照樣成立)。
 *
 * 【SAN 取聯集,而非「有檔案就用」也非「每次重簽」】位址是會來回的(WiFi 換網、Tailscale 重連、插拔網路線)。
 *   ・有檔案就用 ⇒ 之後才出現的位址永遠蓋不到,那條路徑靜靜連不上(這正是同時多路徑的頭號病灶)。
 *   ・每次重簽   ⇒ 憑證指紋天天變,隊友每天被要求重按一次憑證例外。
 *   取聯集則是「只在真的多出沒簽過的名字時才重簽」,且舊名字留著 —— 關掉 WiFi 再開回來不會又要重按。
 *
 * 沒有 openssl:有舊憑證就沿用舊的(降級不例外,蓋不到的名字記進 certGaps),完全沒有才回 null 讓呼叫端退回 http。
 * **MUST NOT** 把生成的私鑰寫進版控(見 .gitignore)。
 */
function ensureCert() {
  const have = new Set(certSan());
  const want = sanNames();
  const missing = want.filter((n) => !have.has(n));
  if (have.size && missing.length === 0) { certGaps = []; return readCertPair(); }

  const san = [...new Set([...have, ...want])];
  try {
    fs.mkdirSync(CERT_DIR, { recursive: true });
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
      '-keyout', KEY_FILE, '-out', CRT_FILE,
      '-subj', '/CN=steel-vs-swarm',
      '-addext', `subjectAltName=${san.join(',')}`,
    ], { stdio: 'ignore' });
    fs.writeFileSync(SAN_FILE, JSON.stringify(san));
    certGaps = [];
    console.log(`  ✓ 已${have.size ? '重簽' : '生成'}自簽憑證(${CERT_DIR});新增涵蓋:${missing.join(', ')}`);
    return readCertPair();
  } catch {
    certGaps = missing;
    return have.size ? readCertPair() : null;
  }
}

/** 靜態檔輸出(開發用:一律 no-cache,改了客戶端普通 F5 就拿得到新碼) */
function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache, must-revalidate',
    });
    res.end(data);
  });
}

const handler = (req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);

  // 健康檢查(雲端平台的 liveness/readiness probe;區網跑也無害)
  if (urlPath === '/healthz') {
    const s = hub.stats();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, mode: LINK_MODE, uptime: Math.round(process.uptime()), maxRooms: MAX_ROOMS, ...s }));
    return;
  }
  // 根目錄 → 鏡射佈局的入口(見檔頭「URL 佈局」)。保留查詢字串,`?mode=solo` 之類的旗標才不會掉。
  if (urlPath === '/' || urlPath === '/index.html') {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.writeHead(302, { Location: `/public/${q}` });
    res.end();
    return;
  }
  // 單機版要用的三支伺服器模組(白名單;server.js 本身 MUST NOT 外流)
  if (urlPath.startsWith('/server/')) {
    const name = urlPath.slice('/server/'.length);
    if (!BROWSER_SERVER_FILES.has(name)) { res.writeHead(404); res.end('404'); return; }
    sendFile(res, path.join(SERVER_DIR, name));
    return;
  }
  if (urlPath.startsWith('/public/')) {
    const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath.slice('/public/'.length)));
    if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
    sendFile(res, urlPath.endsWith('/') ? path.join(filePath, 'index.html') : filePath);
    return;
  }
  res.writeHead(404); res.end('404');
};

// TLS 起不來(沒 openssl)就退回 http:伺服器照樣能跑,只是手機陀螺儀不會動(見 ensureCert 註解)
const tlsPair = USE_HTTPS ? ensureCert() : null;
const SECURE = !!tlsPair;

// ---------------- 單埠雙協定(同一個埠同時吃 http 與 https)----------------
// 三條路徑的隊友拿到網址的方式不一樣:手機要 https 才有陀螺儀(secure context),
// 桌機直接打 `192.168.1.5:8620` 被瀏覽器補成的卻是 http。分兩個埠 = 兩組網址要記且一定有人記錯,
// 所以在這裡看連線的第一個位元組分流:0x16 = TLS handshake 的 ContentType.handshake,其餘一律當明文 HTTP。
// 兩個 http.Server 都不 listen(),只接收 net 前置伺服器 emit 過來的 socket。
const plainServer = http.createServer(handler);
const httpsServer = SECURE ? https.createServer(tlsPair, handler) : null;

// 連上卻一個位元組都不送的 socket 不留(埠掃描器 / 半開連線):否則每一條都吃住一個 fd 直到對端超時
const PROBE_MS = 10 * 1000;
function demux(sock) {
  const timer = setTimeout(() => sock.destroy(), PROBE_MS);
  sock.once('error', () => {});   // 探測期的 RST MUST NOT 變成未處理事件把整支伺服器帶走
  sock.once('close', () => clearTimeout(timer));
  // 【MUST 全程停在 paused 模式】只准 `read(1)` + `unshift`,MUST NOT 用 `once('data')` + `resume()`:
  // TLSSocket 是在 nextTick 才把 socket 已緩衝的位元組補餵給 TLS 引擎(node `_tls_wrap.js` initRead),
  // 而 resume() 會在那之前就把 unshift 回去的位元組以 'data' 事件流掉 —— 沒有人接 = 握手第一段憑空消失,
  // 表徵是「https 連得上但永遠不回應」(明文 http 那半反而正常,所以很容易誤判成憑證問題)。
  const peek = () => {
    const head = sock.read(1);
    if (head === null) { sock.once('readable', peek); return; }
    clearTimeout(timer);
    sock.unshift(head);           // 位元組原封不動還回串流,交給真正的伺服器自己解析
    (head[0] === 0x16 ? httpsServer : plainServer).emit('connection', sock);
  };
  peek();
}
// 沒開 TLS 就沒有要分流的東西 —— 直接讓 http 伺服器自己 listen(與改制前逐位元相同的路徑)
const listener = SECURE ? net.createServer(demux) : plainServer;

/** 房間中樞:雲端與區網共用同一支(單機版由瀏覽器另 new 一個實例) */
const hub = new RoomHub({
  urls: () => (CLOUD ? [] : lanUrls()),   // 雲端不廣播節點內網位址(對玩家沒意義,且是資訊外洩)
  log: (...a) => console.log(...a),
  maxRooms: MAX_ROOMS,
});

function lanUrls() {
  const proto = SECURE ? 'https' : 'http';
  const out = netAddrs().map((a) => `${proto}://${a.ip}:${PORT}`);
  if (TS_NAME) out.unshift(`${proto}://${TS_NAME}:${PORT}`);
  return out;
}

// ---------------- WebSocket ----------------
// maxPayload 1MiB:最大合法訊息 = world 障礙上傳(occ 4000 + cor 2400 ≈ 250KB,留 4 倍餘裕)。
// ws 預設 100MiB —— 惡意巨型訊息會讓單執行緒 JSON.parse 阻塞全部房間,先在框架層封頂。
//
// `noServer` + 兩個 http 伺服器各自轉交 upgrade:ws / wss 共用**同一個** WebSocketServer 實例。
// MUST NOT 改成一邊一個實例 —— 心跳掃的是 `wss.clients`,分兩份就有一半的死連線不會被回收
// (座位 connected 恆 true ⇒ RoomHub 的無真人收房永遠不啟動,見下方心跳註解)。
const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
for (const s of [plainServer, httpsServer]) {
  if (!s) continue;
  s.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
}

// 心跳:偵測「髒斷線」(手機收後台/分頁被殺/網路中斷 —— TCP 不送 FIN,'close' 永遠不觸發)。
// 沒有心跳,死連線的座位 connected 恆為 true ⇒ RoomHub 的「對局無真人逾時收房」(noHumanMs)
// 永遠不會啟動,首頁戰區列表就一直看得到進行中的無人 bot 對局。
// 瀏覽器對 ping 自動回 pong(不用改客戶端);兩個週期沒回應就 terminate → 觸發 'close' → 座位進入斷線流程。
const HEARTBEAT_MS = 15 * 1000;
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const sess = hub.attach((msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); });
  ws.on('message', (raw) => {
    ws.isAlive = true;   // 有訊息進來 = 連線活著(對局中 pos 回報比 pong 更即時)
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    sess.recv(m);
  });
  ws.on('close', () => sess.close());
});
const hbTimer = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }   // terminate 觸發 'close' → sess.close()
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);
hbTimer.unref?.();
wss.on('close', () => clearInterval(hbTimer));

// ---------------- 介面熱插拔 ----------------
// WiFi 連上 / 換網、`tailscale up`、插拔網路線常常晚於伺服器啟動。位址是 `netAddrs()` 現問現答所以
// 網址清單本來就會跟著變,但**憑證不會** —— 新位址不在 SAN 裡,那條路徑的瀏覽器就直接擋在憑證主體不符。
// 故位址集合一變就重簽並熱換 secure context(`setSecureContext` 只影響之後的握手,既有連線不受影響),
// 不然「三條路同時通」實際上得重啟伺服器才成立。雲端不需要(位址固定且不廣播)。
const ADDR_WATCH_MS = 20 * 1000;
const addrSig = () => netAddrs().map((a) => a.ip).sort().join(',');
if (!CLOUD) {
  let lastSig = addrSig();
  const addrTimer = setInterval(() => {
    const sig = addrSig();
    if (sig === lastSig) return;
    lastSig = sig;
    // Tailscale 是後來才起來的話,這時候才問得到 MagicDNS 名(問過有值就不再問,CLI 呼叫不便宜)
    if (!TS_NAME && netAddrs().some((a) => a.kind === 'tailscale')) TS_NAME = magicDnsName();
    console.log('  ⟳ 網路介面有變動,現在可用的網址:');
    for (const u of lanUrls()) console.log(`      ${u}`);
    if (!SECURE) return;
    const t = ensureCert();
    if (t) httpsServer.setSecureContext(t);
  }, ADDR_WATCH_MS);
  addrTimer.unref?.();
}

// 雲端平台(fly.io / Render / Railway…)關機時送 SIGTERM,寬限期內要收乾淨:
// 停掉全部房間 tick,否則容器被硬殺前還在跑模擬,玩家看到的是「畫面凍住」而非明確斷線。
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`\n⏹ 收到 ${sig},停止全部戰局並關閉…`);
    hub.shutdown();
    wss.close();
    listener.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

listener.listen(PORT, HOST, () => {
  const proto = SECURE ? 'https' : 'http';
  console.log('==============================================');
  console.log('  無人戰略:鋼鐵與蜂群  Drone Tactics: Steel vs. Swarm');
  console.log(`  連線機制:${CLOUD ? '☁ 雲端伺服器節點' : '🛰 區網 / Tailscale 對戰'}`);
  if (CLOUD) {
    console.log(`  監聽:  ${HOST}:${PORT}(TLS 交由平台或反向代理終止)`);
    console.log(`  健康檢查:GET /healthz  ・ 戰區上限 ${MAX_ROOMS} 間`);
    console.log('  玩家端:大廳選「雲端伺服器」並填入本節點的公開網址(wss://…)');
  } else {
    console.log(`  本機:  ${proto}://localhost:${PORT}`);
    const addrs = netAddrs();
    // 有線 / WiFi / Tailscale 全部同時開著,附介面名讓房主知道哪個網址該給哪個隊友
    for (const a of addrs.filter((x) => x.kind === 'tailscale')) console.log(`  Tailscale:${proto}://${a.ip}:${PORT}   (${a.iface})`);
    if (TS_NAME) console.log(`  MagicDNS: ${proto}://${TS_NAME}:${PORT}`);
    for (const a of addrs.filter((x) => x.kind === 'lan')) console.log(`  區網:  ${proto}://${a.ip}:${PORT}   (${a.iface})`);
    if (SECURE) {
      console.log(`  ℹ 以上每個網址都同時吃 https 與 http(同一個埠 ${PORT});手機請用 https,陀螺儀瞄準需要 secure context。`);
    }
    if (certGaps.length) {
      console.log(`  ⚠ 自簽憑證還蓋不到:${certGaps.join(', ')} —— 缺 openssl 無法重簽,這幾條路徑會被瀏覽器擋在憑證主體不符。`);
    }
    if (!addrs.some((a) => a.kind === 'tailscale')) {
      console.log('  ℹ 沒偵測到 Tailscale 位址(100.64.0.0/10)。跨網對戰請先 `tailscale up`,');
      console.log('     隊友裝好 Tailscale 並加入同一個 tailnet 後,直接連上面的 Tailscale 網址即可。');
    }
    if (addrs.some((a) => a.kind === 'lan')) {
      console.log('  ℹ 區網連不上但 Tailscale 連得上 = 十之八九是防火牆:Windows 需允許 node 在「私人網路」接受連入。');
    }
  }
  if (USE_HTTPS && !SECURE) {
    console.log('  ⚠ --https 需要系統 openssl 來生自簽憑證,找不到 ⇒ 已退回 http。');
  }
  if (!SECURE && !CLOUD) {
    // 手機陀螺儀最常見的「完全沒反應」就是這個:http://<區網 IP> 不是 secure context
    console.log('  ℹ 手機陀螺儀瞄準需要 secure context:請改用  npm run lan');
    console.log('     (自簽憑證會有一次「不安全連線」警告,點繼續前往即可;http 下感測器靜默不作動)');
  }
  console.log('==============================================');
});
