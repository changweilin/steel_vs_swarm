// ============ 開發工具的啟停(dev-only;設定頁那顆「▶ 啟動 / ⏹ 停止」的後端)============
// 使用者需求(2026-08-04):「生圖對照台開啟鍵旁邊加入後端啟用/關閉的按鍵」。
//
// 瀏覽器沒辦法自己開一支 Node 行程 ⇒ 一定要有人在 Node 端 spawn。這支就是那個人。
// 四條邊界(每一條都是「這個東西如果外流會怎樣」的答案):
//
//   ① **住 `tools/` 不住 `server/`** —— 它不是傳輸層的一部分;`server/server.js` 只負責把
//      **loopback 來的**請求轉進來(而且是動態 import:雲端節點連載都不載)。
//      `tools/build_solo.mjs` 只複製 `public/**` 與白名單的三支 server 模組 ⇒ 出貨版沒有這支。
//   ② **只服務本機** —— 這是一個「會開行程的 HTTP 端點」。`npm run lan` 會把伺服器攤在區網/
//      Tailscale 上,所以閘門是 remoteAddress MUST 是 loopback,且 `--cloud` 一律不掛這條路由。
//   ③ **參數零信任** —— spawn 的 argv **完全來自本檔的 `TOOLS` 常數**,請求只能挑一個 key。
//      客戶端送什麼進來都不會變成命令列的一部分。
//   ④ **改變狀態的請求要一個非簡單標頭**(`x-dev-tools: 1`)—— 擋 CSRF:惡意網頁可以叫瀏覽器
//      POST 到 http://localhost:8620/,但送不出自訂標頭(那需要 CORS 預檢,而我們不回應預檢)。
//
// 埠號**不在這裡** —— 從被啟動的那支工具自己 import(單一真相縫)。
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT as CODEX_PORT } from './codex_review.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** 可啟停的工具型錄。`script`/`args` 是**常數**,MUST NOT 由請求拼出來(邊界 ③) */
export const TOOLS = {
  codex: {
    key: 'codex',
    label: '2D 生圖對照台',
    port: CODEX_PORT,
    script: path.join('tools', 'codex_review.mjs'),
    args: [],
    hint: '把已生成的機體圖配對到角色頭像與 3D 展示台,逐張確認勾選 / 框出局部重繪 / 重下 prompt;'
      + '同時列出缺圖與孤兒檔,並收 tools/ai3d/masters/ 那批尚未驗收的 AI 設定稿。',
  },
};

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/** 這條連線是不是從本機來的?(邊界 ②;拿不到位址一律當成不是) */
export function isLoopback(req) {
  const a = req?.socket?.remoteAddress;
  return typeof a === 'string' && LOOPBACK.has(a);
}

// ---- 行程管理 -------------------------------------------------------------
/** key → { child, log:[] }。只記我們自己開的那些(見 `owned`) */
const running = new Map();
const LOG_LINES = 40;
const START_WAIT_MS = 5000;
const PROBE_MS = 400;
const POLL_MS = 100;    // 等待迴圈的間隔:連不上時 ECONNREFUSED 是立刻回的,不歇會變成猛敲那個埠
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 那個埠上有沒有人在聽?——「開得起來嗎」對使用者而言就是這件事,而不是「我的子行程還活著嗎」。
 *  兩者都要報:使用者可能是在終端機 `npm run codex` 起的,那種我們停不掉(也不該假裝停得掉)。 */
function listening(port) {
  return new Promise((res) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    const done = (v) => { s.destroy(); res(v); };
    s.setTimeout(PROBE_MS);
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.once('timeout', () => done(false));
  });
}

async function statusOf(t) {
  const rec = running.get(t.key);
  return {
    key: t.key, label: t.label, hint: t.hint, port: t.port,
    url: `http://localhost:${t.port}/`,
    listening: await listening(t.port),
    owned: !!rec && rec.child.exitCode === null && !rec.child.killed,
    log: rec ? rec.log.slice(-6).join('\n') : '',
  };
}

export async function list() {
  return Promise.all(Object.values(TOOLS).map(statusOf));
}

export async function start(key) {
  const t = TOOLS[key];
  if (!t) return { error: '沒有這個工具' };
  if (await listening(t.port)) return statusOf(t);          // 已經有人在聽(可能是終端機起的)⇒ 不再開第二支
  const log = [];
  // argv 全部來自 TOOLS 常數(邊界 ③);cwd 固定在儲存庫根,工具自己解析相對路徑
  const child = spawn(process.execPath, [t.script, ...t.args],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const keep = (buf) => {
    for (const line of String(buf).split(/\r?\n/)) if (line.trim()) log.push(line.trim());
    if (log.length > LOG_LINES) log.splice(0, log.length - LOG_LINES);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.once('exit', (code) => keep(`(行程結束,代碼 ${code})`));
  running.set(t.key, { child, log });

  // 等到真的聽得到才回報 —— 回得太早,鈕面會先閃一下「還沒起來」再自己變好(看起來像壞掉)
  const until = Date.now() + START_WAIT_MS;
  while (Date.now() < until && child.exitCode === null) {
    if (await listening(t.port)) break;
    await sleep(POLL_MS);
  }
  return statusOf(t);
}

export async function stop(key) {
  const t = TOOLS[key];
  if (!t) return { error: '沒有這個工具' };
  const rec = running.get(key);
  // 停得掉的只有我們自己開的那支。終端機起的一律不碰 —— 去 kill 一個「埠上剛好有人在聽」的
  // 行程,等於憑一個埠號決定殺誰(§原則 6:寧缺勿錯)。
  if (!rec || rec.child.exitCode !== null) return { ...(await statusOf(t)), error: '這一支不是從這裡啟動的' };
  rec.child.kill();
  const until = Date.now() + 2000;
  while (Date.now() < until && await listening(t.port)) await sleep(POLL_MS);   // 等它把埠放掉
  running.delete(key);
  return statusOf(t);
}

/** 父行程收掉時把開過的子行程一起帶走(否則 8621 會留下一支沒人管的 server)。
 *  只涵蓋得了「正常收掉」那幾條路:`taskkill /F` 是 SIGKILL,handler 根本不會跑,
 *  那種情況下子行程會留著 —— 下次按「▶ 啟動」會看到它還在聽,鈕是灰的並說明「不是從這裡啟動的」。 */
for (const sig of ['exit', 'SIGINT', 'SIGTERM']) {
  process.once(sig, () => {
    for (const { child } of running.values()) { try { child.kill(); } catch { /* 已經死了 */ } }
    if (sig !== 'exit') process.exit(0);
  });
}

// ---- HTTP 介面 ------------------------------------------------------------
/**
 * `server/server.js` 唯一的接點。回傳 true = 已經處理掉這個請求。
 * **呼叫端 MUST 先擋掉非 loopback 與雲端模式**(`isLoopback` 就在本檔,拿去用);
 * 這裡再擋一次是因為「只擋一層」的東西遲早會被搬到別的呼叫端而漏掉。
 */
export async function handle(req, res, urlPath) {
  if (!urlPath.startsWith('/dev/tools')) return false;
  const send = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  if (!isLoopback(req)) { res.writeHead(404); res.end('404'); return true; }
  if (req.method === 'GET' && urlPath === '/dev/tools') { send(200, { tools: await list() }); return true; }
  if (req.method === 'POST') {
    // 邊界 ④:非簡單標頭 ⇒ 跨來源的網頁送不出來(預檢我們不回應)
    if (req.headers['x-dev-tools'] !== '1') { send(403, { error: '缺少 x-dev-tools 標頭' }); return true; }
    const m = urlPath.match(/^\/dev\/tools\/([a-z0-9_-]{1,32})\/(start|stop)$/);
    if (!m) { send(404, { error: '沒有這個動作' }); return true; }
    const out = m[2] === 'start' ? await start(m[1]) : await stop(m[1]);
    send(out.error && !out.key ? 404 : 200, out);
    return true;
  }
  send(405, { error: '方法不支援' });
  return true;
}
