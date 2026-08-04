// ============ 機體美術覆核台(臨時工具;dev-only,不進遊戲)============
// 使用者需求(2026-08-04):「將已生成的每張機體圖配對到角色頭像、現有機體 3D 展示台,
// 點擊後出現武器招式等機體資訊、遊戲未公開的隱藏資訊,提供使用者確認勾選、局部重繪或重新下 prompt」。
//
// 這支是**開發期的覆核台**,不是遊戲的一部分。三條邊界:
//   ① **住 `tools/` 不住 `public/`** —— `tools/build_solo.mjs` 是把 `public/**` 整包複製過去的,
//      放進 public 就會跟著出貨到單機版與 GitHub Pages。頁面改由這支自己的 dev server 供應,
//      `server/server.js`(傳輸層)一行都不動(CLAUDE.md §1 分層職責)。
//   ② **唯讀遊戲資料** —— 頁面 import 的是真品 `data.js`/`codex.js`/`charPreview.js`,
//      MUST NOT 由本工具寫回任何一支;覆核結果只寫 `tools/codex_review/state.json`(本工具自己的檔)。
//      重新下的 prompt 也只存在那裡 —— 它是**覆核產物**,不是第二份 `imagePrompt`(A40 ⑥)。
//   ③ **配對規則是推導的** —— 檔名 `<角色 id>[_<型態>]_<姿態>`,而「這台該有哪幾個型態」
//      由 `visual.flight`/`visual.ground` 推導(與 `codex.js protoLayers()` 同一條規則)。
//      缺圖與孤兒檔一律**列出來**,MUST NOT 靜默略過 —— 覆核台把漏掉的東西藏起來就沒有意義了。
//      圖有**兩個來源**(見 `SOURCES`):已入庫的 `public/assets/…/mechs/`,以及 AI 管線剛畫、
//      **尚未驗收**的 `tools/ai3d/masters/`。後者收進來,這座台子才接得上「生成 → 驗收 → 入庫」
//      那條線;但兩者的計數 MUST 分開,合併就等於把「還沒有正式圖」藏起來
//      (2026-08-04 那 18 張走完整條線之後,「一張都沒有的角色」從 11 台掉到 1 台)。
//
// 跑法:
//   node tools/codex_review.mjs            # 起 dev server(預設 :8621),瀏覽器開印出來的網址
//   node tools/codex_review.mjs --report   # 不開瀏覽器,直接印配對表(缺圖/孤兒/覆核進度)
//   node tools/codex_review.mjs --port 9000
//
// A2:零 npm 依賴(node:http/fs/path);three 仍走 CDN importmap,與遊戲同一版。
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './audit_src.mjs';
import { CHARACTERS, SIDES, charKind } from '../public/js/data.js';
import { KIND_WORD } from '../public/js/codex.js';

const STATE_FILE = join(ROOT, 'tools', 'codex_review', 'state.json');

/** 圖的**兩個來源**。配對規則兩邊同一條:檔名(去副檔名)= slot(`<角色 id>[_<型態>]_<姿態>`)。
 *
 *  ① `art` 已入庫 —— `public/assets/cyberpunk_art/mechs/`,驗收通過才會出現在這裡(進版控)。
 *  ② `ai`  AI 設定稿 —— `tools/ai3d/masters/`,`tools/ai3d/gen2d.mjs --masters` 剛畫出來的,
 *     **尚未驗收**(那一層刻意不進版控,見 tools/ai3d/.gitignore)。
 *
 *  收 ② 正是這座覆核台缺的那一段:生成 → masters/(未驗收)→ **在這裡驗收** → 搬進 public/assets(入庫)。
 *  兩件事 MUST 分得開:AI 稿 MUST NOT 併進「已入庫」的計數裡(併了就是把「這一格還沒有正式圖」
 *  藏起來,而檔頭 ③「缺圖與孤兒一律列出來」正是為了不藏)。
 *  masters/ 現在是空的(那 18 張已經走完整條線)—— **不是死碼**:下一批 `--masters` 一畫出來
 *  就又會出現在那裡等驗收,而它們一入庫,② 就會再度空掉。 */
// `ext` 是**副檔名清單**:入庫層兩種都有 —— 早期那 61 張是 .png,agy 產的一律是 .jpg
// (`generate_image` 只出 JPEG;轉成 .png 只是把壓縮雜訊包進無損容器,見 tools/ai3d/README「已知限制 1」)。
// 只認一種的話,入庫的那批會整批變成孤兒。
export const SOURCES = [
  { key: 'art', label: '入庫', ext: ['.png', '.jpg'], url: 'public/assets/cyberpunk_art/mechs',
    dir: join(ROOT, 'public', 'assets', 'cyberpunk_art', 'mechs') },
  { key: 'ai', label: 'AI 稿', ext: ['.jpg'], url: 'tools/ai3d/masters',
    dir: join(ROOT, 'tools', 'ai3d', 'masters') },
];
const SRC_BY_KEY = Object.fromEntries(SOURCES.map((s) => [s.key, s]));

/** 姿態(檔名末段):與現有出圖批次的命名一致 */
export const POSES = [
  { key: 'static', label: '靜止' },
  { key: 'moving', label: '移動' },
  { key: 'heavy', label: '重武器' },
];
/** 型態:變形者兩型各一組,其餘機體只有一組(無型態前綴)。**由 visual 推導,MUST NOT 手寫名單** */
export function formsOf(id) {
  const vis = CHARACTERS[id]?.visual || {};
  return vis.flight != null && vis.ground != null ? ['flight', 'ground'] : [null];
}
/** 這台機體**應該**有哪幾張圖(slot 鍵 = 檔名去副檔名);`file` 是「入庫」那個來源的本名 */
export function wantShots(id) {
  const out = [];
  for (const form of formsOf(id)) for (const p of POSES) {
    const slot = [id, form, p.key].filter(Boolean).join('_');
    out.push({ slot, file: `${slot}${SOURCES[0].ext[0]}`, form, pose: p.key, poseLabel: p.label });
  }
  return out;
}

/** 配對表:逐角色列出該有的圖、實際有沒有;另外收「檔案在但對不到任何角色」的孤兒。
 * 孤兒不是壞掉,是**機體換過手**:s03 的三張是她還是無人機時出的圖,2026-08-03 換成變形者之後
 * 檔名少了型態段就對不上了(AI 稿那批同一回事:s12 的兩張畫的是她還是變形者時的機體,
 * 2026-08-04 那台整組搬去 s03)。所以孤兒可由覆核台**指派**到某一格(`state.assign`),
 * 不必改檔名 —— 但 MUST 仍列在孤兒清單裡直到被指派,靜默吃掉才是真的壞掉。 */
export async function manifest(assign = {}) {
  // 檔名 → 來源。兩個來源共用一個池 ⇒ 指派、孤兒、佔位規則都只有一套
  const pool = new Map();
  for (const s of SOURCES) {
    if (!existsSync(s.dir)) continue;   // AI 管線沒跑過就沒有那個目錄(原則 6:少一個來源不是錯)
    for (const f of await readdir(s.dir)) {
      // 同一個檔名同時在兩個來源裡(剛入庫、masters/ 還留著一份)⇒ **先宣告的贏**,
      // 覆寫會讓已經驗收入庫的那張被判成「AI 稿」,計數與虛線框一起說謊
      if (s.ext.some((e) => f.toLowerCase().endsWith(e)) && !pool.has(f)) pool.set(f, s.key);
    }
  }
  const bySlot = new Map();   // slot → 指派過來的檔名
  for (const [file, slot] of Object.entries(assign)) if (pool.has(file)) bySlot.set(slot, file);
  const rows = [];
  for (const id of Object.keys(CHARACTERS)) {
    const c = CHARACTERS[id];
    const shots = wantShots(id).map((s) => {
      // 本名(逐來源 `<slot><副檔名>`)優先於指派;來源之間的優先序 = SOURCES 的宣告序
      // ⇒ 入庫圖永遠蓋過 AI 稿(同一格兩張時,畫面上要看到的是驗收過的那張)
      const natural = SOURCES.flatMap((x) => x.ext.map((e) => `${s.slot}${e}`));
      const file = natural.find((f) => pool.has(f)) ?? bySlot.get(s.slot);
      if (!file) return { ...s, has: false, src: null, assigned: false, url: null };
      const src = pool.get(file);
      pool.delete(file);
      return { ...s, has: true, file, src, assigned: !natural.includes(file),
        url: `${SRC_BY_KEY[src].url}/${file}` };
    });
    rows.push({
      id, name: c.name, code: c.code, machine: c.machine,
      side: c.side, sideName: SIDES[c.side]?.name || c.side,
      kind: charKind(id), kindWord: KIND_WORD[charKind(id)] || charKind(id),
      avatar: `public/assets/avatars/${id}.png`,
      portrait: `public/assets/characters/${id}_base.png`,
      shots,
    });
  }
  // 剩下的就是孤兒:檔名的角色 id 不存在,或型態/姿態不在推導出來的清單裡
  const orphans = [...pool.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([file, src]) => ({ file, src, url: `${SRC_BY_KEY[src].url}/${file}` }));
  return { rows, orphans, sources: SOURCES.map(({ key, label }) => ({ key, label })) };
}

async function loadState() {
  try { return JSON.parse(await readFile(STATE_FILE, 'utf8')); }
  catch { return { version: 1, items: {} }; }
}
async function saveState(s) {
  await mkdir(join(ROOT, 'tools', 'codex_review'), { recursive: true });
  await writeFile(STATE_FILE, `${JSON.stringify(s, null, 2)}\n`);
}

// ---- --report:不開瀏覽器的配對表 ----------------------------------------
async function report() {
  const st = await loadState();
  const { rows, orphans } = await manifest(st.assign);
  // 逐來源分開數:AI 稿併進「有圖」就是把「這一格還沒有正式圖」藏起來(檔頭 ③)
  let want = 0, done = 0;
  const bySrc = Object.fromEntries(SOURCES.map((s) => [s.key, 0]));
  const missing = [];
  for (const r of rows) {
    for (const s of r.shots) {
      want++;
      if (s.has) { bySrc[s.src]++; if (st.items?.[s.slot]?.status === 'ok') done++; }
      else missing.push(`${r.id} ${s.form ? `${s.form}/` : ''}${s.pose}`);
    }
  }
  const have = SOURCES.reduce((n, s) => n + bySrc[s.key], 0);
  console.log('機體美術覆核 — 配對表');
  console.log(`  應有    ${want} 格 — ${SOURCES.map((s) => `${s.label} ${bySrc[s.key]}`).join(' / ')}`);
  console.log(`  已確認  ${done} / ${have}`);
  console.log(`  缺圖    ${missing.length} 張${missing.length ? `:${missing.join('、')}` : ''}`);
  console.log(`  孤兒檔  ${orphans.length} 個${orphans.length ? `:${orphans.map((o) => o.file).join('、')}` : ''}`);
  const noArt = rows.filter((r) => r.shots.every((s) => !s.has)).map((r) => r.id);
  if (noArt.length) console.log(`  一張都沒有的角色(${noArt.length}):${noArt.join(' ')}`);
}

// ---- dev server ----------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};

function safePath(url) {
  // 只准讀儲存庫內的檔案(覆核台會被指到 public/js 與 public/assets,那兩處都在 ROOT 底下)
  const p = normalize(join(ROOT, decodeURIComponent(url.split('?')[0])));
  return p.startsWith(ROOT + sep) || p === ROOT ? p : null;
}

/** 這支自己的預設埠 —— **它是這個數字的唯一真相**。
 *  `tools/dev_supervisor.mjs`(設定頁那顆啟停鈕的後端)MUST import 這一個常數,
 *  MUST NOT 自己抄一份:抄了之後某次改埠,啟停鈕會啟得起來卻探不到、鈕面永遠停在「▶ 啟動」。 */
export const DEFAULT_PORT = 8621;

async function serve() {
  const i = process.argv.indexOf('--port');
  const port = i > 0 ? Number(process.argv[i + 1]) : DEFAULT_PORT;
  const srv = createServer(async (req, res) => {
    const send = (code, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };
    try {
      if (req.url.startsWith('/api/review')) {
        if (req.method === 'GET') {
          const st = await loadState();
          return send(200, JSON.stringify({ ...(await manifest(st.assign)), state: st }));
        }
        if (req.method === 'POST') {
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const st = await loadState();
          st.items = st.items || {};
          st.assign = st.assign || {};
          // 一次只覆寫一格(整份覆寫會讓兩個分頁互相蓋掉對方剛存的覆核)
          if (body.slot) {
            if (body.item === null) delete st.items[body.slot];
            else st.items[body.slot] = { ...body.item, at: new Date().toISOString() };
          }
          if (body.assignFile) {
            if (body.assignSlot) st.assign[body.assignFile] = body.assignSlot;
            else delete st.assign[body.assignFile];
          }
          await saveState(st);
          return send(200, JSON.stringify({ ok: true, items: st.items, assign: st.assign }));
        }
        return send(405, '{"error":"method"}');
      }
      let url = req.url.split('?')[0];
      if (url === '/' || url === '') url = '/tools/codex_review/index.html';
      const p = safePath(url);
      if (!p) return send(403, '{"error":"path"}');
      // three 走 CDN(A2);但 `node_modules/three/` 若已裝(.gitignore 那條「開發期才裝的 three」),
      // 就把 importmap 改指本機 —— 離線/代理擋 unpkg 時 3D 展示台才活得下來。
      // 拿不到也不會整頁死:review.js 是動態 import(原則 6 降級不例外)。
      if (url.endsWith('/index.html') && existsSync(join(ROOT, 'node_modules', 'three', 'build', 'three.module.js'))) {
        const html = (await readFile(p, 'utf8'))
          .replace('https://unpkg.com/three@0.160.0/build/three.module.js', '/node_modules/three/build/three.module.js')
          .replace('https://unpkg.com/three@0.160.0/examples/jsm/', '/node_modules/three/examples/jsm/');
        return send(200, html, MIME['.html']);
      }
      const s = await stat(p).catch(() => null);
      if (!s || !s.isFile()) return send(404, 'not found', 'text/plain; charset=utf-8');
      send(200, await readFile(p), MIME[extname(p)] || 'application/octet-stream');
    } catch (e) {
      send(500, JSON.stringify({ error: String(e?.message || e) }));
    }
  });
  srv.listen(port, () => {
    console.log(`機體美術覆核台 → http://localhost:${port}/`);
    console.log(`  覆核結果寫入 ${STATE_FILE.replace(ROOT + sep, '')}(記得 commit —— 容器回收後不留)`);
  });
}

// 只有「直接被執行」時才起 server —— `tools/dev_supervisor.mjs` 要 import 這一支拿 `DEFAULT_PORT`
// (埠號的單一真相縫),沒有這道閘,那支 import 會**在遊戲伺服器的行程裡**把覆核台也一起開起來,
// 而且停不掉(它不是子行程)。
if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
  if (process.argv.includes('--report')) await report();
  else await serve();
}
