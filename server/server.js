// ============ Steel vs. Swarm — battle server (cloud / LAN-over-Tailscale) ============
// This file = transport layer: HTTP static + WebSocket + health checks. Room/matchmaking/battle
// lifecycle lives entirely in `server/rooms.js` (`RoomHub`, transport-independent); solo news the same
//
// Start modes (three mechanisms, one room core):
//   - cloud  `node server/server.js --cloud`       (PORT injected by platform; no LAN broadcast, room cap)
//   - lan    `node server/server.js --lan --https` (prints Tailscale / LAN URLs and self-signed cert notes)
//   - solo   never touches this file (see `public/js/localhost.js` + `tools/build_solo.mjs`)
//
// Multipath: LAN mode MUST serve wired LAN / WiFi / Tailscale simultaneously with no per-path reruns.
// Listening on 0.0.0.0 solves only the TCP half; skipping the other three leaves one path silently unreachable:
//   (1) self-signed cert SANs freeze at first generation -- later-joined WiFi / Tailscale addresses
//     fall outside them, and that path's browsers block on cert-name mismatch (see ensureCert: union the
//   (2) interfaces hot-plug (WiFi swaps, `tailscale up` after server start), so watch the address set and
//     re-sign + hot-swap the secure context on change (see ADDR_WATCH_MS), or only a restart recovers.
//   (3) under `--https`, `http://<ip>:PORT` is dead while desktop browsers default-typed URLs to http --
//     hence one port demuxes on the first byte (0x16 = TLS) to serve both http and https (see demux).
//
// URL layout: browser-visible paths MUST mirror the repo layout: `/public/**` and `/server/*.js`, `/` 302s to `/public/`.
// Why: solo browsers import `/server/rooms.js`, which imports `../public/js/data.js` -- only the mirrored
// layout keeps `data.js` a single module instance per tab (otherwise app and sim hold divergent balance numbers).
// The GitHub Pages static solo build uses the same layout (see `tools/build_solo.mjs`), so dev and live agree.
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
// Solo build imports these three modules in-browser (authoritative sim + bots + room hub); server.js itself is NOT served.
const BROWSER_SERVER_FILES = new Set(['sim.js', 'bots.js', 'rooms.js']);

// CLI args:`--port 8620` or `--port=8620` (PowerShell does not accept PORT=xxx prefix)
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
// Connection mechanism:--cloud hosted node / --lan LAN (incl. Tailscale). Neither given = LAN (local dev default).
// `--lan` forces LAN explicitly (overrides env; lets `npm run lan` stay LAN even when SVS_CLOUD is set)
const CLOUD = !hasFlag('--lan') && (hasFlag('--cloud') || process.env.SVS_CLOUD === '1');
const LINK_MODE = CLOUD ? 'cloud' : 'lan';
// Pinned OSM browser-acceptance dev-only input/output routes. Normal deployments (`--cloud` or production)
// do not mount them: fixtures only from loopback, screenshots only from same-machine audit tooling.
const DEV_BROWSER_IO = !CLOUD && process.env.NODE_ENV !== 'production';
const OSM_FIXTURE_NAMES = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const OSM_BROWSER_SHOT_ROOT = path.join(ROOT_DIR, 'tools', '.shots');
const OSM_BROWSER_SHOT_DIR = path.join(OSM_BROWSER_SHOT_ROOT, 'osm_browser');
// Room cap on cloud nodes: one 8Hz tick per room, so a flood of rooms would drag down every game. LAN uncapped.
const MAX_ROOMS = Number(argVal('--max-rooms') || process.env.SVS_MAX_ROOMS || (CLOUD ? 24 : 0)) || 0;
// `--https`: serve TLS with a self-signed cert. Phone gyro REQUIRES this --
// browsers only emit deviceorientation in a secure context (https or localhost),
// http://<LAN IP> leaves the sensor silently dead (no error, no permission prompt, just no motion).
// Cloud always terminates TLS at the platform/reverse proxy, never here (see docs/deploy.md).
const USE_HTTPS = hasFlag('--https', '--tls') && !CLOUD;
const CERT_DIR = path.join(ROOT_DIR, '.certs');   // Listed in .gitignore (self-signed private key MUST NOT enter version control)
const KEY_FILE = path.join(CERT_DIR, 'key.pem');
const CRT_FILE = path.join(CERT_DIR, 'cert.pem');
// Which names this cert was signed for. Without this record the only options are "re-sign on every boot" (teammates re-approve the exception daily)
// or "reuse file if present" (= current bug: paths joining the network later are never covered).
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
 * All local non-internal IPv4s, tagged with which network each is.
 * Tailscale addresses live in CGNAT 100.64.0.0/10 (tailscale0 / utun iface) -- players use these,
 * listed separately from home LAN 192.168.x so a long address list still tells teammates which one to use.
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

/** Tailscale MagicDNS name (only if tailscale CLI is installed; null otherwise, IP connect unaffected) */
function magicDnsName() {
  try {
    const j = JSON.parse(execFileSync('tailscale', ['status', '--json'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).toString());
    const dns = j?.Self?.DNSName;
    return dns ? dns.replace(/\.$/, '') : null;
  } catch {
    return null;
  }
}
// MagicDNS name may appear later than the server (`tailscale up` runs afterwards) => the address watcher re-asks once, hence not const
let TS_NAME = CLOUD ? null : magicDnsName();

/** Names the cert MUST cover: localhost + loopback + every current path IPv4 + MagicDNS */
function sanNames() {
  return [
    'DNS:localhost', 'IP:127.0.0.1',
    ...lanIps().map((ip) => `IP:${ip}`),
    ...(TS_NAME ? [`DNS:${TS_NAME}`] : []),
  ];
}

/** Names the active cert was signed for; unreadable/broken reads as unsigned (next step re-signs) */
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

/** Names the active cert still does not cover (non-empty only without openssl; startup message reports it) */
let certGaps = [];

/**
 * Self-signed cert for `--https`:`.certs/{key,cert}.pem`, re-signed with system openssl for 10 years when coverage is missing.
 * SAN covers localhost + 127.0.0.1 + all current LAN/Tailscale IPs + MagicDNS name -- teammates connect directly without cert-subject mismatch
 * (an "unsafe connection" warning remains: self-signed has no CA backing, click through and secure context still holds).
 *
 * [SAN takes the union, never "reuse file" nor "re-sign every time"] Addresses come and go (WiFi swaps, Tailscale reconnects, cable replugs).
 *   - reuse file => later-appearing addresses are never covered, that path silently fails to connect (the top multipath failure).
 *   - re-sign every time => fingerprint changes daily, teammates must re-approve the exception daily.
 *   Union means "re-sign only when a truly uncovered name appears", keeping old names -- toggling WiFi off/on does not force re-approval.
 *
 * Without openssl: reuse the old cert if any (degrade by omission, uncovered names recorded in certGaps), null only when none exists so the caller falls back to http.
 * MUST NOT commit the generated private key (see .gitignore).
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

/** Static file serving (dev: always no-cache, so a plain F5 picks up client edits) */
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

function loopbackReq(req) {
  const addr = String(req.socket?.remoteAddress || '').replace(/^::ffff:/u, '');
  return addr === '127.0.0.1' || addr === '::1' || addr === '0:0:0:0:0:0:0:1';
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
}

/** Bounded read of dev screenshot POST; on overflow still drains the request before replying to avoid a half-open socket. */
async function readBody(req, maxBytes) {
  const chunks = [];
  let total = 0, over = false;
  for await (const chunk of req) {
    total += chunk.length;
    if (total <= maxBytes) chunks.push(chunk);
    else over = true;
  }
  if (over) throw new Error(`body 超過 ${maxBytes} bytes`);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Pinned OSM fixture input (dev-only). Parsing goes through the production OSM parser in tools/osm_fixture;
 * the browser still receives relay input, which must flow back through main.js sanitize/fit/commit/buildBiomes.
 */
async function serveOsmFixture(req, res, urlPath) {
  if (!DEV_BROWSER_IO || req.method !== 'GET' || !loopbackReq(req)
    || req.headers['x-dev-tools'] !== '1') {
    res.writeHead(404); res.end('404'); return;
  }
  const m = /^\/__osm_fixture\/([A-Za-z0-9][A-Za-z0-9_-]*)$/u.exec(urlPath);
  if (!m || !OSM_FIXTURE_NAMES.test(m[1])) { res.writeHead(404); res.end('404'); return; }
  try {
    // Lazy load: production games never pull the fixture parser/fs into the server process.
    const mod = await import('../tools/osm_fixture.mjs');
    const fixture = mod.loadOsmFixture(m[1], mod.DEFAULT_FIXTURE_DIR);
    const parsed = fixture && mod.fixtureOsm(fixture);
    if (!fixture || !parsed?.features || !Array.isArray(parsed.roads)) {
      sendJson(res, 404, { ok: false, error: 'fixture 不存在或契約無效' });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      version: mod.FIXTURE_VERSION,
      name: fixture.name,
      venue: fixture.venue?.id || null,
      center: fixture.center || null,
      bbox: fixture.bbox,
      relay: {
        bbox: fixture.bbox,
        areas: parsed.features.areas,
        pointFeatures: parsed.features.pointFeatures,
        roads: parsed.roads,
      },
    });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String(e?.message || e) });
  }
}

/**
 * Browser fixed-view PNG drop (dev-only). Folder lives under tools/.shots/ already in .gitignore,
 * so acceptance artifacts never enter version control; sidecar JSON keeps the frame renderer.info and camera readout.
 */
async function serveOsmShot(req, res) {
  if (!DEV_BROWSER_IO || req.method !== 'POST' || !loopbackReq(req)
    || req.headers['x-dev-tools'] !== '1') {
    res.writeHead(404); res.end('404'); return;
  }
  try {
    const body = JSON.parse(await readBody(req, 18 << 20));
    const name = String(body?.name || '');
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$/u.test(name)) {
      sendJson(res, 400, { ok: false, error: 'shot name 無效' }); return;
    }
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/u.exec(String(body?.dataUrl || ''));
    if (!match) { sendJson(res, 400, { ok: false, error: '只收 PNG dataURL' }); return; }
    const png = Buffer.from(match[1], 'base64');
    const sig = '89504e470d0a1a0a';
    if (!png.length || png.subarray(0, 8).toString('hex') !== sig || png.length > (12 << 20)) {
      sendJson(res, 400, { ok: false, error: 'PNG 位元組無效或超限' }); return;
    }
    const requestedDir = body?.outputDir == null ? OSM_BROWSER_SHOT_DIR
      : path.resolve(ROOT_DIR, String(body.outputDir));
    const shotRoot = path.resolve(OSM_BROWSER_SHOT_ROOT);
    if (requestedDir !== shotRoot && !requestedDir.startsWith(`${shotRoot}${path.sep}`)) {
      sendJson(res, 400, { ok: false, error: '截圖輸出目錄必須在 tools/.shots/ 下' }); return;
    }
    fs.mkdirSync(requestedDir, { recursive: true });
    const pngPath = path.join(requestedDir, `${name}.png`);
    const metaPath = path.join(requestedDir, `${name}.json`);
    fs.writeFileSync(pngPath, png);
    const meta = body.meta && typeof body.meta === 'object' ? body.meta : {};
    fs.writeFileSync(metaPath, JSON.stringify({ ...meta, name, bytes: png.length }, null, 2));
    sendJson(res, 200, {
      ok: true,
      path: path.relative(ROOT_DIR, pngPath).replaceAll(path.sep, '/'),
      metaPath: path.relative(ROOT_DIR, metaPath).replaceAll(path.sep, '/'),
      bytes: png.length,
    });
  } catch (e) {
    sendJson(res, 400, { ok: false, error: String(e?.message || e) });
  }
}

// Dev-tool start/stop (dev-only; the start/stop button on the settings page).
// This endpoint SPAWNS a process, so all three gates are required: (1) cloud nodes never even load it (CLOUD check before
// import) (2) loopback only (gate lives in `tools/dev_supervisor.mjs`, same logic as spawn)
// (3) shipping builds have no `tools/` at all (build_solo only copies public/** plus three allowlisted files) => failed import means no such route.
// Lazy load: normal games never reach here, so that module plus its data.js/codex.js imports stay out of memory.
let _devSup = null;
const devSup = () => (_devSup ||= import('../tools/dev_supervisor.mjs').catch(() => null));

const handler = (req, res) => {
  // Broken URLs (bare %, truncated UTF-8 sequences) make decodeURIComponent throw URIError --
  // uncaught here = whole process exits = everyone disconnects, while port scanners send such junk daily.
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400); res.end('400'); return;
  }

  if (urlPath.startsWith('/__osm_fixture/')) {
    serveOsmFixture(req, res, urlPath);
    return;
  }
  if (urlPath === '/__shot') {
    serveOsmShot(req, res);
    return;
  }

  if (!CLOUD && urlPath.startsWith('/dev/tools')) {
    devSup().then(async (m) => {
      if (!m || !(await m.handle(req, res, urlPath))) { res.writeHead(404); res.end('404'); }
    }).catch(() => { res.writeHead(500); res.end('500'); });
    return;
  }

  // Health check (cloud liveness/readiness probe; harmless on LAN)
  if (urlPath === '/healthz') {
    const s = hub.stats();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, mode: LINK_MODE, uptime: Math.round(process.uptime()), maxRooms: MAX_ROOMS, ...s }));
    return;
  }
  // Root -> mirrored-layout entry (see header "URL layout"). Keeps the query string so flags like `?mode=solo` survive.
  if (urlPath === '/' || urlPath === '/index.html') {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.writeHead(302, { Location: `/public/${q}` });
    res.end();
    return;
  }
  // Three server modules for the solo build (allowlist; server.js itself MUST NOT leak out)
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

// TLS failed to come up (no openssl) falls back to http: server still runs, only phone gyro stays dead (see ensureCert note)
const tlsPair = USE_HTTPS ? ensureCert() : null;
const SECURE = !!tlsPair;

// ---------------- Single-port dual-protocol (one port serves both http and https) ----------------
// Teammates get URLs differently per path: phones need https for gyro (secure context),
// desktops typing `192.168.1.5:8620` get http auto-completed by the browser. Two ports = two URL sets nobody remembers,
// so branch on the first byte here: 0x16 = TLS handshake ContentType.handshake, everything else as plaintext HTTP.
// Neither http.Server listens(); both receive sockets emitted from the net front server.
const plainServer = http.createServer(handler);
const httpsServer = SECURE ? https.createServer(tlsPair, handler) : null;

// Sockets that connect but send zero bytes are not kept (port scanners / half-open): each would otherwise hold an fd until peer timeout
const PROBE_MS = 10 * 1000;
function demux(sock) {
  const timer = setTimeout(() => sock.destroy(), PROBE_MS);
  sock.once('error', () => {});   // RST during probing MUST NOT become an unhandled event taking down the server
  sock.once('close', () => clearTimeout(timer));
  // [MUST stay in paused mode throughout] Only `read(1)` + `unshift`, MUST NOT use `once('data')` + `resume()`:
  // TLSSocket feeds already-buffered bytes to the TLS engine only on nextTick (node `_tls_wrap.js` initRead),
  // while resume() would flush the unshifted bytes as 'data' before that -- nobody listens = first handshake fragment lost,
  // symptom is "https connects but never responds" (plaintext http half still works, easily misread as a cert problem).
  const peek = () => {
    const head = sock.read(1);
    if (head === null) { sock.once('readable', peek); return; }
    clearTimeout(timer);
    sock.unshift(head);           // Return the byte untouched to the stream for the real server to parse
    (head[0] === 0x16 ? httpsServer : plainServer).emit('connection', sock);
  };
  peek();
}
// Without TLS there is nothing to demux -- let the http server listen directly (bit-identical path to before the rework)
const listener = SECURE ? net.createServer(demux) : plainServer;

/** Room hub: cloud and LAN share one (solo news a separate instance in-browser) */
const hub = new RoomHub({
  urls: () => (CLOUD ? [] : lanUrls()),   // Cloud never broadcasts node LAN addresses (meaningless to players, and an info leak)
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
// maxPayload 4MiB: largest legal message = world upload (occ 12000 + cor/slabs 6000 each + wet + hgt).
// Trunks and fixed props in occ push large 5v5 maps past the old 4000 entries; keeping 2MiB would drop legal world
// messages at the WebSocket layer. The cap is still enforced by ws before JSON.parse to bound input.
// 2026-08-01 coarse height grid hgt added (ridge occlusion, anti-over-the-hill shots): measured L3 ~55KB, theory cap 131KB
// (LOS.HGT_MAX squared x 2 chars) => total packet up to ~800KB, old 1MiB left only 1.3x headroom. Exceeding it closes the
// connection at ws level = host world silently fails to upload (LOS / corridor / ridge all dead), so keep ample headroom.
// ws default 100MiB -- a malicious giant message would block the single thread in JSON.parse for all rooms, cap at framework level first.
// 2026-08-10 road relay `t:'osm'` added (host raw Overpass data): measured (tools/measure_osm_relay.mjs,
// dense 5v5 downtown) barcelona 1051KB / paris 1068KB / manhattan 972KB => 4MiB still keeps ample headroom,
// no compression or perMessageDeflate needed; world and osm are separate messages and never stack.
// Client also self-caps with `OSM_RELAY.MAX_BYTES` (1.8MB): drops feats first, then abandons the whole relay --
// if ws rejects this one with 1009, it is the HOST connection that drops, looking exactly like a dead server.
// Changing either cap MUST review both sides together (4MiB here and MAX_BYTES in osmrelay.js).
//
// `noServer` + both http servers forwarding upgrade: ws / wss share ONE WebSocketServer instance.
// MUST NOT split into one instance per side -- heartbeat sweeps `wss.clients`, split halves leave dead connections unreaped
// (seat connected stays true => RoomHub abandoned-game reap never starts, see heartbeat note below).
const wss = new WebSocketServer({ noServer: true, maxPayload: 4 << 20 });
for (const s of [plainServer, httpsServer]) {
  if (!s) continue;
  s.on('upgrade', (req, socket, head) => {
    try {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } catch {
      try { socket.destroy(); } catch { /* ignore */ }
    }
  });
}

// Heartbeat: detect dirty disconnects (phone backgrounded / tab killed / network cut -- TCP sends no FIN, 'close' never fires).
// Without it, dead seats stay connected=true => RoomHub abandoned-game timeout (noHumanMs)
// never starts, and the lobby keeps listing dead bot-vs-bot games.
// Browsers auto-reply pong to ping (no client change); two missed cycles terminate -> 'close' -> seat enters disconnect flow.
const HEARTBEAT_MS = 15 * 1000;
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  // Send failure (half-open peer, message serialize error) drops only this message: uncaught = one throw in tick broadcast,
  // whole process exits = whole room disconnects.
  const sess = hub.attach((msg) => {
    if (ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(msg)); } catch { /* drop, heartbeat reaps this connection */ }
  });
  // One malformed/malicious client message MUST NOT take down the server: catch, log, drop (degrade by omission).
  ws.on('message', (raw) => {
    ws.isAlive = true;   // Inbound message = connection alive (in-game pos reports beat pong)
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    try { sess.recv(m); } catch (e) { console.log(`⚠ 客戶端訊息處理異常已攔截並丟棄:${String(e?.message || e)}`); }
  });
  ws.on('error', () => {});   // Uncaught 'error' becomes an unhandled exception taking down the server
  ws.on('close', () => { try { sess.close(); } catch (e) { console.log(`⚠ 連線收尾異常已攔截:${String(e?.message || e)}`); } });
});
const hbTimer = setInterval(() => {
  for (const ws of wss.clients) {
    try {
      if (ws.isAlive === false) { ws.terminate(); continue; }   // terminate fires 'close' -> sess.close()
      ws.isAlive = false;
      ws.ping();
    } catch { /* ping/terminate on a half-open socket may throw, next heartbeat round reaps */ }
  }
}, HEARTBEAT_MS);
hbTimer.unref?.();
wss.on('close', () => clearInterval(hbTimer));

// ---------------- Interface hot-plug ----------------
// WiFi join/swap, `tailscale up`, cable replugs often land after server start. Addresses come from `netAddrs()` on demand so
// the URL list follows, but the CERT does not -- a new address outside SAN gets browsers blocked on cert-subject mismatch.
// Hence re-sign and hot-swap the secure context on address-set change (`setSecureContext` affects only later handshakes, live connections unaffected),
// otherwise "three paths at once" only holds after a server restart. Cloud skips this (fixed, unbroadcast addresses).
const ADDR_WATCH_MS = 20 * 1000;
const addrSig = () => netAddrs().map((a) => a.ip).sort().join(',');
if (!CLOUD) {
  let lastSig = addrSig();
  const addrTimer = setInterval(() => {
    const sig = addrSig();
    if (sig === lastSig) return;
    lastSig = sig;
    // Tailscale started later means the MagicDNS name is only resolvable now (skip re-query once known, CLI calls are not cheap)
    if (!TS_NAME && netAddrs().some((a) => a.kind === 'tailscale')) TS_NAME = magicDnsName();
    console.log('  ⟳ 網路介面有變動,現在可用的網址:');
    for (const u of lanUrls()) console.log(`      ${u}`);
    if (!SECURE) return;
    const t = ensureCert();
    if (t) httpsServer.setSecureContext(t);
  }, ADDR_WATCH_MS);
  addrTimer.unref?.();
}

// Cloud platforms (fly.io / Render / Railway...) send SIGTERM on shutdown, drain cleanly inside the grace window:
// stop every room tick, otherwise the sim keeps running until the hard kill and players see a freeze instead of a clean disconnect.
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
    // Wired / WiFi / Tailscale all live at once, with iface names so the host knows which URL goes to which teammate
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
    // The most common "gyro does nothing" on phones is exactly this: http://<LAN IP> is not a secure context
    console.log('  ℹ 手機陀螺儀瞄準需要 secure context:請改用  npm run lan');
    console.log('     (自簽憑證會有一次「不安全連線」警告,點繼續前往即可;http 下感測器靜默不作動)');
  }
  console.log('==============================================');
});
