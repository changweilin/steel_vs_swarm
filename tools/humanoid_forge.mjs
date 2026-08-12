// ============ 人形鍛造台 dev server(dev-only,不進遊戲)============
// 研究成果原型:AniCompanion(three-vrm)的「標準化人形特徵」建模法移植到本專案機體制 ——
// 人形特徵表(對齊 VRM 1.0 必要骨)→ 機器人零件款式 → 既有 rig 契約的具名零件樹,
// 由真品 locomotion.js 驅動。頁面與規格住 tools/humanoid_forge/。
//
// 三條邊界(同 codex_review.mjs):
//   ① 住 tools/ 不住 public/ —— build:solo 是整包複製 public/**,放進去就跟著出貨。
//   ② 唯讀遊戲模組 —— 頁面 import 真品 toon.js / paint.js / locomotion.js,一支都不寫回。
//   ③ 零 npm 依賴(node:http/fs/path);three 走 CDN importmap,與遊戲同一版(A2)。
//
// 跑法:
//   node tools/humanoid_forge.mjs            # 起 dev server(預設 :8631)
//   node tools/humanoid_forge.mjs --port 9000
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { ROOT } from './audit_src.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
};

function safePath(url) {
  // 只准讀儲存庫內的檔案(頁面會指到 public/js 與 tools/humanoid_forge,皆在 ROOT 底下)
  const p = normalize(join(ROOT, decodeURIComponent(url.split('?')[0])));
  return p.startsWith(ROOT + sep) || p === ROOT ? p : null;
}

/** 這支自己的預設埠 —— 它是這個數字的唯一真相(8620 遊戲 / 8621 codex / 8622 parts / 8623 story)。 */
const DEFAULT_PORT = 8631;

const i = process.argv.indexOf('--port');
const port = i > 0 ? Number(process.argv[i + 1]) : DEFAULT_PORT;
const srv = createServer(async (req, res) => {
  const send = (code, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };
  try {
    let url = req.url.split('?')[0];
    // 截圖落盤(headless 檢視:pane 不合成時 window.__shot 顯式渲染一幀 POST 回來)
    if (req.method === 'POST' && url.startsWith('/__shot/')) {
      const name = url.slice('/__shot/'.length).replace(/[^\w.-]/g, '');
      if (!name) return send(400, 'name?');
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const s = Buffer.concat(chunks).toString('utf8');
      const b64 = s.startsWith('data:') ? s.slice(s.indexOf(',') + 1) : s;
      const dir = join(ROOT, 'tools', 'humanoid_forge', 'shots');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${name}.png`), Buffer.from(b64, 'base64'));
      return send(200, JSON.stringify({ ok: true, path: `tools/humanoid_forge/shots/${name}.png` }), MIME['.json']);
    }
    // 2D 原型圖名冊(2026-08-12 使用者:「下載原型圖片放在機體台,3D建模時需參考2D圖片」):
    // 名冊 = public/assets/cyberpunk_art/mechs/ 目錄本身(單一真相,MUST NOT 客戶端拼檔名);
    // 地面型排前(人形鍛造建模的是地面人形),姿態 static → moving → heavy。
    if (req.method === 'GET' && url === '/api/protoimgs') {
      const q = new URLSearchParams(req.url.split('?')[1] || '');
      const id = (q.get('id') || '').replace(/[^\w]/g, '');
      if (!id) return send(400, 'id?');
      const dir = join(ROOT, 'public', 'assets', 'cyberpunk_art', 'mechs');
      const files = (await readdir(dir).catch(() => []))
        .filter((f) => f.startsWith(`${id}_`) && /\.(png|jpe?g)$/i.test(f));
      const score = (f) => (f.includes('_flight_') ? 10 : 0)
        + (f.includes('moving') ? 1 : f.includes('heavy') ? 2 : 0);
      files.sort((a, b) => score(a) - score(b) || (a < b ? -1 : 1));
      return send(200, JSON.stringify({
        imgs: files.map((f) => ({ file: f, url: `/public/assets/cyberpunk_art/mechs/${f}` })),
      }), MIME['.json']);
    }
    if (url === '/' || url === '') url = '/tools/humanoid_forge/index.html';
    const p = safePath(url);
    if (!p) return send(403, 'forbidden');
    // 離線/代理擋 unpkg 時,若開發期已裝本機 three,把 importmap 改指本機(同 codex_review.mjs:293)
    if (url.endsWith('/index.html') && existsSync(join(ROOT, 'node_modules', 'three', 'build', 'three.module.js'))) {
      const html = (await readFile(p, 'utf8'))
        .replace('https://unpkg.com/three@0.160.0/build/three.module.js', '/node_modules/three/build/three.module.js')
        .replace('https://unpkg.com/three@0.160.0/examples/jsm/', '/node_modules/three/examples/jsm/');
      return send(200, html, MIME['.html']);
    }
    const s = await stat(p).catch(() => null);
    if (!s || !s.isFile()) return send(404, 'not found');
    send(200, await readFile(p), MIME[extname(p)] || 'application/octet-stream');
  } catch (e) {
    send(500, String(e?.message || e));
  }
});
srv.listen(port, () => {
  console.log(`人形鍛造台:http://localhost:${port}/`);
});
