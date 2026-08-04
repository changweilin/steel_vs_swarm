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
//   ③ **配對規則是推導的** —— 檔名 `<角色 id>[_<型態>]_<姿態>.png`,而「這台該有哪幾個型態」
//      由 `visual.flight`/`visual.ground` 推導(與 `codex.js protoLayers()` 同一條規則)。
//      缺圖與孤兒檔一律**列出來**,MUST NOT 靜默略過 —— 覆核台把漏掉的東西藏起來就沒有意義了
//      (現況:32 台裡 11 台一張都沒有、s07 只有 3 張中的 1 張)。
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
import { extname, join, normalize, sep } from 'node:path';
import { ROOT } from './audit_src.mjs';
import { CHARACTERS, SIDES, charKind } from '../public/js/data.js';
import { KIND_WORD } from '../public/js/codex.js';

const ART_DIR = join(ROOT, 'public', 'assets', 'cyberpunk_art', 'mechs');
const ART_URL = 'public/assets/cyberpunk_art/mechs';
const STATE_FILE = join(ROOT, 'tools', 'codex_review', 'state.json');

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
/** 這台機體**應該**有哪幾張圖(檔名 → slot 鍵) */
export function wantShots(id) {
  const out = [];
  for (const form of formsOf(id)) for (const p of POSES) {
    const file = [id, form, p.key].filter(Boolean).join('_') + '.png';
    out.push({ slot: file.replace(/\.png$/, ''), file, form, pose: p.key, poseLabel: p.label });
  }
  return out;
}

/** 配對表:逐角色列出該有的圖、實際有沒有;另外收「檔案在但對不到任何角色」的孤兒。
 * 孤兒不是壞掉,是**機體換過手**:s03 的三張是她還是無人機時出的圖,2026-08-03 換成變形者之後
 * 檔名少了型態段就對不上了。所以孤兒可由覆核台**指派**到某一格(`state.assign`),
 * 不必改檔名 —— 但 MUST 仍列在孤兒清單裡直到被指派,靜默吃掉才是真的壞掉。 */
export async function manifest(assign = {}) {
  const files = existsSync(ART_DIR)
    ? (await readdir(ART_DIR)).filter((f) => f.toLowerCase().endsWith('.png'))
    : [];
  const pool = new Set(files);
  const bySlot = new Map();   // slot → 指派過來的檔名
  for (const [file, slot] of Object.entries(assign)) if (pool.has(file)) bySlot.set(slot, file);
  const rows = [];
  for (const id of Object.keys(CHARACTERS)) {
    const c = CHARACTERS[id];
    const shots = wantShots(id).map((s) => {
      const file = pool.has(s.file) ? s.file : bySlot.get(s.slot);
      const has = !!file;
      if (has) pool.delete(file);
      return { ...s, has, file: file || s.file, assigned: has && file !== s.file, url: has ? `${ART_URL}/${file}` : null };
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
  return { rows, orphans: [...pool].sort(), total: files.length };
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
  const { rows, orphans, total } = await manifest(st.assign);
  let want = 0, have = 0, done = 0;
  const missing = [];
  for (const r of rows) {
    for (const s of r.shots) {
      want++;
      if (s.has) { have++; if (st.items?.[s.slot]?.status === 'ok') done++; }
      else missing.push(`${r.id} ${s.form ? `${s.form}/` : ''}${s.pose}`);
    }
  }
  console.log('機體美術覆核 — 配對表');
  console.log(`  圖檔    ${total} 張(對得上 ${have} / 應有 ${want})`);
  console.log(`  已確認  ${done} / ${have}`);
  console.log(`  缺圖    ${missing.length} 張${missing.length ? `:${missing.join('、')}` : ''}`);
  console.log(`  孤兒檔  ${orphans.length} 個${orphans.length ? `:${orphans.join('、')}` : ''}`);
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

async function serve() {
  const i = process.argv.indexOf('--port');
  const port = i > 0 ? Number(process.argv[i + 1]) : 8621;
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

if (process.argv.includes('--report')) await report();
else await serve();
