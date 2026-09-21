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
import { DEFAULT_PORT as STORY_PORT } from './story_book.mjs';
import { DEFAULT_PORT as ARCH_PORT } from './arch_preview.mjs';


const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * 可啟停的工具型錄。`script`/`args` 是**常數**,MUST NOT 由請求拼出來(邊界 ③)。
 *
 * `kind` 目前只有 `server`:活著 = **那個埠上有人在聽**(使用者可能是在終端機起的,
 * 那種我們停不掉也不該假裝停得掉)。
 */
export const TOOLS = {
  codex: {
    key: 'codex',
    kind: 'server',
    label: '2D 生圖對照台',
    port: CODEX_PORT,
    script: path.join('tools', 'codex_review.mjs'),
    args: [],
    hint: '把已生成的機體圖配對到角色頭像與 3D 展示台,逐張確認勾選 / 框出局部重繪 / 重下 prompt;'
      + '同時列出缺圖與孤兒檔,並收 tools/ai3d/masters/ 那批尚未驗收的 AI 設定稿。',
  },
  story: {
    key: 'story',
    kind: 'server',
    label: '本地故事書',
    port: STORY_PORT,
    script: path.join('tools', 'story_book.mjs'),
    args: [],
    hint: '直接翻看六章 × 兩陣營的劇情與對話,不用真的通關:開戰簡報 → 前線/中段砲塔的無線電對白 '
      + '→ 主堡那一階的結算對照稿 → 勝敗文案。呈現走遊戲的真品(storyui.js / dialogue.js / style.css),'
      + '對白可自動播或逐句翻。唯讀,不動 localStorage 的通關進度。',
  },
  arch: {
    key: 'arch',
    kind: 'server',
    label: '建模隨機生成器',
    port: ARCH_PORT,
    script: path.join('tools', 'arch_preview.mjs'),
    args: [],

    hint: '建築、地質與植物建模隨機生成器：整合三大類別分頁切換，支援文化與功能維度展開、自然與人造地質成因抽樣、21 種林木植物形態與季節器官生成，包含即時 3D 預覽與參數檢驗。',
  },
};

/**
 * 真正要 spawn 的 argv。**請求碰不到這裡的任何一格**(邊界 ③):
 * 完整常數來自上面的 `TOOLS`,cwd 固定在儲存庫根。
 */
export function argvOf(t) {
  return [...t.args];
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/** 這條連線是不是從本機來的?(邊界 ②;拿不到位址一律當成不是) */
export function isLoopback(req) {
  const a = req?.socket?.remoteAddress;
  return typeof a === 'string' && LOOPBACK.has(a);
}

// ---- 行程管理 -------------------------------------------------------------
/** key → { child, log:[] }。只記我們自己開的那些(見 `owned`) */
const running = new Map();
/**
 * key → 上一次啟動的**經過**(`{ at, argv, error, exit }`)。存在的理由:
 * 「按了沒反應」有一半是**啟動失敗而畫面沒地方講**(行程頭一秒就死)。
 * 錯誤只回在那一次 POST 的回應裡的話,重新整理一次就永遠消失了 ⇒ 記著,讓輸出視窗
 * 隨時看得到「上一次按下去發生了什麼」。行程收掉也不清 —— 那正是要回頭看的時候。
 */
const lastRun = new Map();
// 輸出視窗看的是這一份 ⇒ 留得夠看完啟動期的日誌。純記憶體、逐工具封頂,不寫檔。
const LOG_LINES = 300;
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

/** 我們自己開的那支還活著嗎(停不停得掉的判準;「跑起來了嗎」另外問埠) */
const alive = (rec) => !!rec && rec.child.exitCode === null && !rec.child.killed;

/** 我們啟動的子行程觀測資料。終端機自行啟動的工具沒有可信 PID，故寧缺勿猜。 */
function monitorOf(rec) {
  if (!rec) return null;
  const endedAt = rec.endedAt || null;
  const until = endedAt ? Date.parse(endedAt) : Date.now();
  return {
    pid: rec.child.pid || null,
    startedAt: rec.startedAt,
    lastOutputAt: rec.lastOutputAt || rec.startedAt,
    endedAt,
    uptimeMs: Math.max(0, until - Date.parse(rec.startedAt)),
  };
}

async function statusOf(t) {
  const rec = running.get(t.key);
  const owned = alive(rec);
  const base = {
    key: t.key, kind: t.kind, label: t.label, hint: t.hint, owned,
    log: rec ? rec.log.slice(-6).join('\n') : '',
    run: lastRun.get(t.key) || null,
    monitor: monitorOf(rec),
  };
  // **「跑起來了嗎」直接推導成一欄 `on`**(2026-08-11 修的那個 bug 的教訓):
  // 客戶端只想知道那顆鈕要畫成啟動還是停止 —— 讓它自己挑欄位,拿錯尺的下場就是
  // 鈕面**永遠**停在「▶ 啟動」而背景其實跑著。存活判準住這裡一份,客戶端一律讀 `on`。
  const isUp = await listening(t.port);
  return {
    ...base, port: t.port, url: `http://localhost:${t.port}/`,
    listening: isUp, on: isUp,
  };
}

export async function list() {
  return Promise.all(Object.values(TOOLS).map(statusOf));
}

/**
 * @param {string} key 工具鍵(白名單比對過的)
 */
export async function start(key) {
  const t = TOOLS[key];
  if (!t) return { error: '沒有這個工具' };
  if (await listening(t.port)) return statusOf(t);   // 已經有人在聽(可能是終端機起的)⇒ 不再開第二支
  const argv = argvOf(t);
  const log = [];
  const startedAt = new Date().toISOString();
  const rec = { child: null, log, startedAt, lastOutputAt: startedAt, endedAt: null };
  // argv 全部來自 TOOLS 常數 + `argvOf` 推導出來的資料家(邊界 ③:請求只能挑一個 key);
  // cwd 固定在儲存庫根,工具自己解析相對路徑
  const child = spawn(process.execPath, [t.script, ...argv],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const keep = (buf) => {
    rec.lastOutputAt = new Date().toISOString();
  // ANSI 控制碼要**脫掉**:子行程印的訊息裡若帶色碼 —— 原樣送到頁面上就是一串
  // `[1;31m` 夾在中文裡。終端機看得懂色碼,HTML 看不懂。
    // ⚠ 樣式 MUST 從 `` 起算(而且寫成跳脫序列,不要在原始碼裡塞一個看不見的控制字元):
    //   少了 ESC 就變成「任何 `[xxx]` 都砍」,而這條迴圈自己印的 `[dry]` 會被砍成 `ry]`。
    for (const line of String(buf).replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').split(/\r?\n/)) {
      if (line.trim()) log.push(line.trim());
    }
    if (log.length > LOG_LINES) log.splice(0, log.length - LOG_LINES);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.once('exit', (code) => {
    rec.endedAt = new Date().toISOString();
    keep(`(行程結束,代碼 ${code})`);
    const r = lastRun.get(t.key);
    if (r) r.exit = code;
  });
  // spawn 本身失敗(ENOENT / 權限)會 emit 'error' —— **沒有這個監聽器就是未捕捉例外**,
  // 而這條路上的「未捕捉」會把承載它的那支伺服器(遊戲伺服器或零件台)整個帶走:
  // 使用者按了啟動,然後整個站台不見了。⇒ 收成一行日誌 + 一則錯誤,讓進度頁講得出來。
  child.once('error', (e) => {
    rec.endedAt = new Date().toISOString();
    keep(`(起不來:${e.message})`);
    const r = lastRun.get(t.key);
    if (r) r.error = `起不來:${e.message}`;
  });
  rec.child = child;
  running.set(t.key, rec);
  lastRun.set(t.key, {
    at: startedAt,
    // 完整命令列**要看得到**:啟動失敗時先看跑的到底是哪一支,不必去猜。
    argv: [t.script, ...argv],
    error: null, exit: null,
  });

  // 等到真的聽得到才回報 —— 回得太早,鈕面會先閃一下「還沒起來」再自己變好(看起來像壞掉)。
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
  // 判準走 `alive()` 那一份(**不是** `exitCode !== null`):紀錄在停掉之後刻意留著給執行進度頁
  // 看日誌 ⇒ 「這一格還在」不再等於「它還跑著」;而伺服器型工具收埠比行程退出快,只看
  // exitCode 的話第二次按停止會再 kill 一次並回報成功(而它早就不是我們的了)。
  if (!rec || !alive(rec)) return { ...(await statusOf(t)), error: '這一支不是從這裡啟動的' };
  rec.child.kill();
  const until = Date.now() + 2000;
  // 除了等它把埠放掉,還要等子行程真的結束:埠先釋放、exit 事件晚一拍時,監控資料
  // 才能在這次回應中帶回 endedAt。
  while (Date.now() < until && (rec.child.exitCode === null || await listening(t.port))) await sleep(POLL_MS);
  // **紀錄留著**(舊版在這裡 `running.delete`):停下來之後才是最想回頭看日誌的時候 ——
  // 刪掉的話執行進度頁在按下停止的那一瞬間整個清空,看起來像「剛才什麼都沒跑」。
  // 存活判準吃的是 `alive()`(exitCode 已經填上 ⇒ 恆 false),不是這個 Map 有沒有這一格:
  // 重複 stop 仍走「這一支不是從這裡啟動的」那條、再 start 仍會換上一份新的日誌。
  return statusOf(t);
}

/** 父行程收掉時把開過的子行程一起帶走(否則會有留下一支沒人管的 server)。
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
  // 執行進度:**全量**日誌 + 上一次啟動的經過(清單那一支只帶最後 6 行,不夠看一輪)。
  // 唯讀 ⇒ 不要求 `x-dev-tools`(那道閘是給「會改變狀態」的請求的);key 仍走白名單字元集。
  if (req.method === 'GET') {
    const g = urlPath.match(/^\/dev\/tools\/([a-z0-9_-]{1,32})\/log$/);
    if (g) {
      const t = TOOLS[g[1]];
      if (!t) { send(404, { error: '沒有這個工具' }); return true; }
      const rec = running.get(t.key);
      send(200, { ...(await statusOf(t)), log: rec ? rec.log.join('\n') : '' });
      return true;
    }
  }
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
