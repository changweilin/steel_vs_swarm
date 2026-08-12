// ============ 兩座看板共用的 dev 路由(dev-only)============
// 三條路由,兩個掛載點(機體展示台 :8631 / 機體美術覆核台 :8641):
//   POST /__shot/<name>   headless 截圖落盤
//   GET  /api/protoimgs   2D 定案圖名冊
//   GET  /api/protorefs   CC0 真實原型照名冊
//
// `/api/protoimgs`(2D 定案圖)與 `/api/protorefs`(CC0 真實原型照)自 2026-08-12 第五輪起
// 有**兩個**掛載點:機體展示台 :8631 與機體美術覆核台 :8641(「紙娃娃系統與原型照片也加入
// 機體美術台整合」)。名冊推導只准有一份 —— 兩邊各寫一份的下場是同一格在兩座看板上列出
// 不一樣的圖(其中一邊漏收 `@form` 後綴或漏掉某個原型層),而兩邊看起來都很正常。
//
// 兩條名冊紀律(從展示台原地搬過來,一格未改):
//   ① 2D 定案圖的名冊 = `public/assets/cyberpunk_art/mechs/` **目錄本身**;
//   ② 原型照的名冊 = `tools/proto_refs/manifest.json` **採集帳本** + `roster.protoRefsOf()`
//      的原型層。帳本沒有那一格 = 還沒採集(回空陣列讓看板明講),**不是**錯誤。
// 客戶端一律 MUST NOT 自己拼檔名(拼出來的路徑在圖還沒採集時是 404,而畫面上只是破圖)。
//
// 零 npm 依賴、零 three。
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../audit_src.mjs';
import { rosterEntries } from './roster.js';

const JSON_T = 'application/json; charset=utf-8';

/**
 * 兩支 dev server 的原型圖路由(MUST NOT 各寫一份)。
 * @returns true = 已處理(呼叫端不必再往下走)
 */
export async function handleBoardApi(req, res, send) {
  const url = req.url.split('?')[0];
  const q = new URLSearchParams(req.url.split('?')[1] || '');

  // 截圖落盤:兩座看板的 pane 都可能不合成(rAF 不跑 ⇒ 一般截圖工具逾時),
  // 一律走「手動步進 + 顯式渲染一幀 + POST 回來」這條路(.claude/skills/headless-3d-inspection)。
  // **這條路由是覆核台這次才有的**:它先前沒有任何 headless 檢視,所以「按鍵蓋住機體」
  // 這種純視覺的壞法在離線這一端一條都量不到 —— 只有人打開頁面才看得見(2026-08-12 使用者回報)。
  if (req.method === 'POST' && url.startsWith('/__shot/')) {
    const name = url.slice('/__shot/'.length).replace(/[^\w.-]/g, '');
    if (!name) { send(400, '{"error":"name?"}', JSON_T); return true; }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString('utf8');
    const b64 = body.startsWith('data:') ? body.slice(body.indexOf(',') + 1) : body;
    const dir = join(ROOT, 'tools', 'humanoid_forge', 'shots');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name + '.png'), Buffer.from(b64, 'base64'));
    send(200, JSON.stringify({ ok: true, path: `tools/humanoid_forge/shots/${name}.png` }), JSON_T);
    return true;
  }
  if (req.method !== 'GET') return false;

  // 2D 定案圖:地面型排前(人形鍛造建模的是地面人形),姿態 static → moving → heavy
  if (url === '/api/protoimgs') {
    const id = (q.get('id') || '').replace(/[^\w]/g, '');
    if (!id) { send(400, '{"error":"id?"}', JSON_T); return true; }
    const dir = join(ROOT, 'public', 'assets', 'cyberpunk_art', 'mechs');
    const files = (await readdir(dir).catch(() => []))
      .filter((f) => f.startsWith(`${id}_`) && /\.(png|jpe?g)$/i.test(f));
    const score = (f) => (f.includes('_flight_') ? 10 : 0)
      + (f.includes('moving') ? 1 : f.includes('heavy') ? 2 : 0);
    files.sort((a, b) => score(a) - score(b) || (a < b ? -1 : 1));
    send(200, JSON.stringify({
      imgs: files.map((f) => ({ file: f, url: `/public/assets/cyberpunk_art/mechs/${f}` })),
    }), JSON_T);
    return true;
  }

  // 真實原型參考照:授權與作者逐張帶出去(圖說就是這批圖的授權憑據)
  if (url === '/api/protorefs') {
    const key = q.get('key') || '';
    const entry = rosterEntries().find((e) => e.key === key);
    if (!entry) { send(404, '{"error":"key?"}', JSON_T); return true; }
    let man = { entries: {} };
    try { man = JSON.parse(await readFile(join(ROOT, 'tools', 'proto_refs', 'manifest.json'), 'utf8')); }
    catch { /* 還沒採集過 */ }
    const safe = key.replace(/@/g, '_').replace(/[^\w.-]/g, '');
    const layers = entry.protos.map((L) => ({
      key: L.key, label: L.label, src: L.src, note: L.note,
      imgs: ((man.entries?.[key] || {})[L.key] || []).map((r) => ({
        file: r.file, license: r.license, creator: r.creator, source_url: r.source_url,
        url: `/tools/proto_refs/${safe}/${L.key}/${r.file}`,
      })),
    }));
    send(200, JSON.stringify({ key, layers }), JSON_T);
    return true;
  }
  return false;
}
