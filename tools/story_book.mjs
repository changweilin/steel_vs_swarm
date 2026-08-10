// ============ 本地故事書(臨時工具;dev-only,不進遊戲)============
// 使用者需求(2026-08-11):「設定加入本地網頁故事書:可以直接看劇情與對話,
// **完全仿照正式遊戲的呈現**,只是可以隨時換頁,不用真的遊戲通關」。
//
// 那句話的工程意思只有一個:**兩邊 MUST 是同一份標記 + 同一份 CSS + 同一支演出**。
//   ・章節卡 / 開戰簡報 / 結算文案 → `public/js/storyui.js`(2026-08-11 自 main.js 抽出的唯一縫)
//   ・階段對話演出            → `public/js/dialogue.js`(遊戲用的就是這一支)
//   ・樣式                    → `public/css/style.css` 原檔,本工具的 `book.css` **只畫台子的框**
// 「長得很像」的第二份版面等於讓故事書從此獨立演化:遊戲改了排版而它沒跟上,
// 你在這裡看到的東西就再也沒有在遊戲裡出現過 —— 那不叫覆核,叫看另一個作品。
//
// 三條邊界(與 codex_review / parts_review 同一套):
//   ① **住 `tools/` 不住 `public/`** —— `tools/build_solo.mjs` 是把 `public/**` 整包複製過去的,
//      放進 public 就會跟著出貨到單機版與 GitHub Pages。頁面由這支自己的 dev server 供應,
//      `server/server.js` 一行都不動。
//   ② **唯讀** —— 只讀 `story.js`/`storytalk.js`/`storyui.js`/`dialogue.js`,不寫回任何一支,
//      也**不碰 localStorage 的通關進度**(`svs_story_*`)。故事書全開是**參數**
//      (`chapterCardHTML(..., { unlocked: true })`),不是把進度寫滿 —— 寫滿的話,
//      使用者下次真的開遊戲會發現自己「已經通關了」,而那不是他要的。
//   ③ **零 npm 依賴**(node:http/fs/path);頁面不需要 three(storyui/dialogue/portraits 全是純模組)。
//
// 跑法:
//   node tools/story_book.mjs            # 起 dev server(預設 :8623),瀏覽器開印出來的網址
//   node tools/story_book.mjs --report   # 不開瀏覽器,直接印頁面索引(幾章 × 幾頁 / 缺哪一頁)
//   node tools/story_book.mjs --port 9000
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './audit_src.mjs';
import { SIEGE } from '../public/js/data.js';
import { STORY, chapterSide } from '../public/js/story.js';
import { talkOf, stageKey } from '../public/js/storytalk.js';
import { venueName } from '../public/js/storyui.js';

/** 這支自己的預設埠 —— **它是這個數字的唯一真相**(同 codex_review / parts_review 的註)。
 *  `tools/dev_supervisor.mjs`(設定頁那顆啟停鈕的後端)MUST import 這一個常數,MUST NOT 自己抄。 */
export const DEFAULT_PORT = 8623;

export const SIDES2 = ['STEEL', 'SWARM'];

/**
 * 一章一陣營的頁序 —— **推導自 `SIEGE.STAGES`**,MUST NOT 在頁面端手寫「簡報/前線/中段/主堡/結算」。
 * 攻堅階段以後若加一階(例如中間再插一排塔),故事書會自己多一頁;手寫的那份不會,
 * 而症狀是「有一階的對白在故事書裡看不到」——沒有錯誤訊息。
 */
export function pagesOf(chId, side) {
  const out = [{ key: 'brief', label: '開戰簡報', kind: 'brief' }];
  for (let i = 0; i < SIEGE.STAGES.length; i++) {
    out.push({
      key: `talk:${stageKey(i)}`, kind: i === SIEGE.BASE ? 'scene' : 'radio', stage: i,
      label: `${SIEGE.NAMES[i]}・對話`, missing: !talkOf(chId, side, stageKey(i)),
    });
  }
  out.push({ key: 'over', label: '戰役結算', kind: 'over' });
  return out;
}

/** 頁面索引(`--report` 與 API 共用一份;缺頁一律列出來,MUST NOT 靜默略過) */
export function index() {
  return STORY.map((ch, i) => ({
    id: ch.id, act: ch.act, i, venue: venueName(ch),
    sides: Object.fromEntries(SIDES2.map((s) => [s, {
      title: chapterSide(ch, s).title,
      pages: pagesOf(ch.id, s),
    }])),
  }));
}

async function report() {
  const ix = index();
  let miss = 0;
  for (const c of ix) {
    console.log(`\n${c.act}  ${c.venue}`);
    for (const s of SIDES2) {
      const d = c.sides[s];
      const cells = d.pages.map((p) => (p.missing ? `⚠${p.label}` : p.label)).join(' › ');
      miss += d.pages.filter((p) => p.missing).length;
      console.log(`  ${s === 'STEEL' ? '協約' : '同盟'} 《${d.title}》  ${cells}`);
    }
  }
  const total = ix.reduce((n, c) => n + SIDES2.reduce((m, s) => m + c.sides[s].pages.length, 0), 0);
  console.log(`\n共 ${ix.length} 章 × 2 陣營 = ${total} 頁;缺頁 ${miss}`);
  if (miss) process.exitCode = 1;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};

function safePath(url) {
  // 只准讀儲存庫內的檔案(故事書會被指到 public/js、public/css、public/assets)
  const p = normalize(join(ROOT, decodeURIComponent(url.split('?')[0])));
  return p.startsWith(ROOT + sep) || p === ROOT ? p : null;
}

async function serve() {
  const i = process.argv.indexOf('--port');
  const port = i > 0 ? Number(process.argv[i + 1]) : DEFAULT_PORT;
  const srv = createServer(async (req, res) => {
    const send = (code, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };
    try {
      let url = req.url.split('?')[0];
      if (url === '/api/index') return send(200, JSON.stringify(index()));
      if (url === '/' || url === '') url = '/tools/story_book/index.html';
      const p = safePath(url);
      if (!p) return send(403, '{"error":"path"}');
      const s = await stat(p).catch(() => null);
      if (!s || !s.isFile()) return send(404, 'not found', 'text/plain; charset=utf-8');
      send(200, await readFile(p), MIME[extname(p)] || 'application/octet-stream');
    } catch (e) {
      send(500, JSON.stringify({ error: String(e?.message || e) }));
    }
  });
  srv.listen(port, () => {
    console.log(`本地故事書 → http://localhost:${port}/`);
    console.log('  ← → 翻頁、↑ ↓ 換章、Tab 換陣營;對白可自動播或逐句翻。唯讀,不動通關進度。');
  });
}

// 只有「直接被執行」時才起 server —— `dev_supervisor.mjs` 要 import 這一支拿 `DEFAULT_PORT`
// (埠號的單一真相縫),沒有這道閘,那支 import 會在遊戲伺服器的行程裡把故事書也開起來且停不掉。
if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
  if (process.argv.includes('--report')) await report();
  else await serve();
}
