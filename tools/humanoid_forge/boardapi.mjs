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
// 帳本的形狀與判決語意只有一份(refstore.mjs);查詢詞的推導也只有一份(fetch_protorefs
// 的 `queryFor`)—— 看板要顯示「這一層現在是用什麼關鍵詞找的」,MUST 到那裡取,
// MUST NOT 自己再翻一次代號表(翻出來的與採集端下一輪真的用的會是兩個東西)。
import {
  loadManifest, saveManifest, slotOf, tuneOf, safeKey, rejectImg, annotate, retune, addUserImg,
} from './refstore.mjs';
import { queryFor } from '../fetch_protorefs.mjs';
import { sniffImage } from '../ai3d/fetch_photos.mjs';

const JSON_T = 'application/json; charset=utf-8';
const MAX_UPLOAD = 6e6;   // 與採集端的單張上限同一個數量級(這些圖只是拿來看的)

/** 讀 POST 的 JSON body(壞 JSON 當空物件 —— 這是 dev 路由,壞輸入只該不動作) */
async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

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
  // ---- 原型照的判決 / 重搜 / 自己貼(2026-08-12 使用者:「有些機體搜索的照片完全不符合
  // 機體原型,加入標記與註解以重新搜索,或是使用者直接貼上照片」)----
  // 三條路由全部只改帳本(refstore 單一縫);**這裡不連外網** —— 重搜是下一次跑
  // `node tools/fetch_protorefs.mjs` 的事,看板負責的是把「要找什麼」講清楚。
  if (req.method === 'POST' && url.startsWith('/api/protorefs/')) {
    const act = url.slice('/api/protorefs/'.length);
    const b = await readJson(req);
    const key = String(b.key || ''), layer = String(b.layer || '');
    if (!key || !layer || !rosterEntries().some((e) => e.key === key)) {
      send(400, '{"error":"key/layer?"}', JSON_T); return true;
    }
    const man = await loadManifest();
    let out = { ok: false };
    if (act === 'reject') {
      out = await rejectImg(man, key, layer, String(b.file || ''), String(b.note || ''));
    } else if (act === 'annotate') {
      out = annotate(man, key, layer, String(b.file || ''), String(b.note || ''));
    } else if (act === 'retune') {
      out = { ok: true, tune: retune(man, key, layer, { q: b.q, note: b.note }) };
    } else if (act === 'upload') {
      // 使用者直接貼上的照片:dataURL → 位元組。**MUST 嗅探真實位元組**(副檔名與
      // content-type 都是輸入方說了算),而授權欄一律 `user`(refstore 檔頭紀律 ③)
      const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/s.exec(String(b.data || ''));
      if (!m) { send(400, '{"error":"只收 png/jpeg/webp 的 dataURL"}', JSON_T); return true; }
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > MAX_UPLOAD) { send(413, '{"error":"圖太大(> 6MB)"}', JSON_T); return true; }
      if (!sniffImage(buf)) { send(400, '{"error":"非影像位元組"}', JSON_T); return true; }
      const row = await addUserImg(man, key, layer, buf, m[1] === 'jpeg' ? 'jpg' : m[1], String(b.note || ''));
      out = { ok: true, row };
    } else { send(404, '{"error":"act?"}', JSON_T); return true; }
    if (out.ok) await saveManifest(man);
    send(out.ok ? 200 : 400, JSON.stringify(out), JSON_T);
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
    const man = await loadManifest();
    const safe = safeKey(key);
    const layers = entry.protos.map((L) => {
      const t = tuneOf(man, key, L.key);
      return {
        key: L.key, label: L.label, src: L.src, note: L.note,
        // 「這一層現在是用什麼關鍵詞找的」:覆寫優先,沒有覆寫就印推導出來的那一個
        // (欄位空白 = 使用者還沒改過,MUST NOT 讓他自己猜現在在找什麼)
        q: t?.q || queryFor(entry, L) || '',
        over: !!t?.q, tuneNote: t?.note || '', rejects: t?.rejects?.length || 0,
        imgs: slotOf(man, key, L.key).map((r) => ({
          file: r.file, license: r.license, creator: r.creator, source_url: r.source_url,
          note: r.note || '', user: r.api === 'user',
          url: `/tools/proto_refs/${safe}/${L.key}/${r.file}`,
        })),
      };
    });
    send(200, JSON.stringify({ key, layers }), JSON_T);
    return true;
  }
  return false;
}
