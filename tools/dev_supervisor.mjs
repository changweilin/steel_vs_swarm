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
import { DEFAULT_PORT as PARTS_PORT } from './parts_review.mjs';
import { corpusHome } from './ai3d/provenance.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * 可啟停的工具型錄。`script`/`args` 是**常數**,MUST NOT 由請求拼出來(邊界 ③)。
 *
 * `kind` 有兩種,而差別**只在「怎麼知道它還活著」**:
 *   `server` —— 對照台那兩支。活著 = **那個埠上有人在聽**(使用者可能是在終端機起的,
 *               那種我們停不掉也不該假裝停得掉)。
 *   `job`   —— 2026-08-10 加入的採集迴圈。它**不聽任何埠** ⇒ 拿 `listening()` 去問它
 *               會**永遠回報「沒開」**,鈕面就停在「▶ 啟動」而背景其實跑著好幾支
 *               (每按一次就多開一支,而畫面完全正常)。⇒ 活著 = 我們自己的子行程還在。
 *               代價要講清楚:終端機起的那一支我們**看不到**(沒有埠可以探),
 *               所以 job 的狀態語意是「**這個台子有沒有在跑它**」而不是「機器上有沒有在跑」。
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
  parts: {
    key: 'parts',
    kind: 'server',
    label: '3D 零件對照台',
    port: PARTS_PORT,
    script: path.join('tools', 'parts_review.mjs'),
    args: [],
    hint: '把 docs/ai3d_runbook.md 生成的 3D 物件與原版並排比較(同一顆座號、同一顆相機):'
      + '零件庫 GLB vs 保險絲 primitive、純資料件 vs 改寫前的零件表;逐件說明用哪個生成方法、'
      + '吃哪一張來源圖(授權與出處),並列出缺件 / 孤兒節點 / 未記載來源。',
  },
  harvest: {
    key: 'harvest',
    kind: 'job',
    label: 'img→3D 採集迴圈',
    script: path.join('tools', 'ai3d', 'harvest_loop.mjs'),
    // `--rounds 0` = 一直跑到按停為止(採集是機率的,「跑到夠為止」沒有一個算得出來的輪數);
    // `--every 15` 是來源限流的節奏(撞到 429 之後 Retry-After 600s,調短只會讓封鎖續期)。
    args: ['--rounds', '0', '--every', '15'],
    // 資料家**不是常數**(語料家會搬)⇒ 由 `corpusHome()` 從檔案系統推導後接在 args 後面。
    // 它仍然沒有違反邊界 ③:那是我們自己算出來的路徑,**請求一個字都碰不到**。
    needsHome: true,
    hint: '收編 inbox → 抓照片 → 去背 → 圈選分離 → 選片閘 → img→3D → 快篩 → contact sheet '
      + '→ 自動入庫 → 收尾稽核,每 15 分鐘一輪,按停為止。入庫只寫工作區**不 commit**;'
      + '人眼複核排在入庫之後(就在這個台子上),判決由 tools/ai3d/apply_verdicts.mjs 執行。',
  },
};

/** 真正要 spawn 的 argv(常數 + 推導出來的資料家)。**請求碰不到這裡的任何一格**(邊界 ③) */
export function argvOf(t) {
  if (!t.needsHome) return [...t.args];
  const home = corpusHome();
  return home ? [...t.args, '--home', home] : null;    // 找不到語料 ⇒ null,呼叫端印理由不啟動
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
const LOG_LINES = 40;
const START_WAIT_MS = 5000;
const JOB_SETTLE_MS = 1200;   // job 沒有埠可等 ⇒ 等「有沒有立刻死掉」(起不來都是頭一秒的事)
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

/** 我們自己開的那支還活著嗎(job 的存活判準;server 另外還要問埠) */
const alive = (rec) => !!rec && rec.child.exitCode === null && !rec.child.killed;

async function statusOf(t) {
  const rec = running.get(t.key);
  const owned = alive(rec);
  const base = {
    key: t.key, kind: t.kind, label: t.label, hint: t.hint, owned,
    log: rec ? rec.log.slice(-6).join('\n') : '',
  };
  // job 沒有埠 ⇒ **不回 url / listening**(回一個假的 `http://localhost:undefined/` 會讓
  // 客戶端畫出一個點不開的連結,而那看起來像「台子壞了」)。`running` 就是它的 listening。
  if (t.kind === 'job') return { ...base, running: owned, home: t.needsHome ? corpusHome() : null };
  return {
    ...base, port: t.port, url: `http://localhost:${t.port}/`,
    listening: await listening(t.port),
  };
}

export async function list() {
  return Promise.all(Object.values(TOOLS).map(statusOf));
}

export async function start(key) {
  const t = TOOLS[key];
  if (!t) return { error: '沒有這個工具' };
  if (t.kind === 'job') {
    // job 沒有埠可以探 ⇒ 「已經在跑了嗎」只能問自己那支。少了這一道,每按一次啟動就多開
    // 一支採集迴圈:兩支同時對同一個資料家寫 harvest_state.json,而畫面完全正常。
    if (alive(running.get(t.key))) return statusOf(t);
  } else if (await listening(t.port)) return statusOf(t);   // 已經有人在聽(可能是終端機起的)⇒ 不再開第二支
  const argv = argvOf(t);
  if (!argv) return { ...(await statusOf(t)), error: '找不到任何有 photo_manifest.json 的資料家(語料家會搬 ⇒ 請用終端機帶 --home 跑)' };
  const log = [];
  // argv 全部來自 TOOLS 常數 + `argvOf` 推導出來的資料家(邊界 ③:請求只能挑一個 key);
  // cwd 固定在儲存庫根,工具自己解析相對路徑
  const child = spawn(process.execPath, [t.script, ...argv],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const keep = (buf) => {
    for (const line of String(buf).split(/\r?\n/)) if (line.trim()) log.push(line.trim());
    if (log.length > LOG_LINES) log.splice(0, log.length - LOG_LINES);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.once('exit', (code) => keep(`(行程結束,代碼 ${code})`));
  running.set(t.key, { child, log });

  // 等到真的聽得到才回報 —— 回得太早,鈕面會先閃一下「還沒起來」再自己變好(看起來像壞掉)。
  // job 沒有埠可以等 ⇒ 改成「等它**沒有立刻死掉**」:採集迴圈第一件事是印資料家與第一輪標題,
  // 起不來(路徑錯/相依缺)是在頭一秒就退出的,而那正是要讓使用者看到的那一種失敗。
  const until = Date.now() + (t.kind === 'job' ? JOB_SETTLE_MS : START_WAIT_MS);
  while (Date.now() < until && child.exitCode === null) {
    if (t.kind !== 'job' && await listening(t.port)) break;
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
  // server 等它把埠放掉;job 沒有埠 ⇒ 等行程真的收掉(採集迴圈可能正卡在 15 分鐘的等待,
  // 但 `kill()` 對它是立刻的 —— 等的是 Node 把 exitCode 填上)
  while (Date.now() < until && (t.kind === 'job' ? rec.child.exitCode === null : await listening(t.port))) await sleep(POLL_MS);
  running.delete(key);
  return statusOf(t);
}

// ⚠ `kill()` 只收掉我們開的**那一支**。採集迴圈當下若正卡在 `spawnSync`(去背 / SF3D 那幾站),
// 那支孫行程會跑完自己那一輪才消失 —— 這是刻意不做行程樹砍殺(`taskkill /T` 是平台專屬,
// 而半途砍掉 Blender/SF3D 會留下寫到一半的 GLB)。按下停止 = **不再開新的一輪**。

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
