// ============ 原型參考照帳本(Node 端唯一縫;dev-only)============
// `tools/proto_refs/manifest.json` 有**兩個**寫入端:
//   採集端 `tools/fetch_protorefs.mjs` —— 抓到圖就落一列(來源/授權/作者/查詢詞)
//   看板端 `boardapi.mjs` 的三條路由    —— 使用者的判決(不符/註解)、關鍵詞覆寫、自己貼的照片
// 兩邊各寫各的,但**形狀只准有一份**:欄位散在兩支檔案裡的下場是「看板寫進去的東西採集端
// 讀不到」,而畫面上只表現成「我明明標了不符,下一輪它又抓回來同一張」。
//
// 2026-08-12 使用者:「有些機體搜索的照片完全不符合機體原型,加入標記與註解以重新搜索,
// 或是使用者直接貼上照片」⇒ 帳本多了一段 `tune`:
//   tune[key][layer] = { q: '關鍵詞覆寫', note: '為什麼原本的不對', rejects: ['已判不符的 id'] }
//
// 三條紀律:
//   ① **判不符 = 刪檔 + 進黑名單**,只刪檔不記黑名單的話下一輪採集會照原查詢詞抓回同一張
//      (採集端的去重只比對「帳本裡有沒有這一列」);黑名單一份、兩端同吃。
//   ② **關鍵詞覆寫是唯一的第二來源**:採集端的 `queryFor()` MUST 先問這裡,MUST NOT 讓
//      看板自己去呼叫採集端(那支在 import 時就會跑起來,見它的檔尾)。
//   ③ **使用者自己貼的照片 MUST 標成 `user`**:CC0 硬閘管的是「我們去抓的」那些,
//      使用者提供的圖授權由使用者自己負責 —— 混進 cc0 那一堆等於帳本在說謊。
//
// 零 npm 依賴、零 three(兩支 dev server 同吃這一支)。
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../audit_src.mjs';

export const REFS_DIR = join(ROOT, 'tools', 'proto_refs');
export const MANIFEST = join(REFS_DIR, 'manifest.json');

/** 帳本鍵 → 目錄名(`t06@flight` → `t06_flight`;`@` 不能進路徑) */
export const safeKey = (k) => String(k).replace(/@/g, '_').replace(/[^\w.-]/g, '');

export async function loadManifest(file = MANIFEST) {
  try {
    const j = JSON.parse(await readFile(file, 'utf8'));
    return { version: 1, entries: {}, tune: {}, ...j };
  } catch { return { version: 1, entries: {}, tune: {} }; }
}

export async function saveManifest(man, file = MANIFEST) {
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, `${JSON.stringify(man, null, 2)}\n`);
}

/** 這一層的圖(回的是帳本裡那個陣列本身 —— 呼叫端就地增刪) */
export const slotOf = (man, key, layer) => (((man.entries ||= {})[key] ||= {})[layer] ||= []);

/** 這一層的調校(關鍵詞覆寫 / 註解 / 黑名單);`create` 為真才會真的建出來 */
export function tuneOf(man, key, layer, create = false) {
  if (!create) return man.tune?.[key]?.[layer] || null;
  return (((man.tune ||= {})[key] ||= {})[layer] ||= { q: '', note: '', rejects: [] });
}

/** 採集端的查詢詞覆寫(空字串 = 沒有覆寫,MUST NOT 當成「查詢詞是空的」) */
export const queryOverride = (man, key, layer) => tuneOf(man, key, layer)?.q?.trim() || null;

/** 這一列被判過不符了嗎(採集端在「要不要收這一張」之前問) */
export const rejected = (man, key, layer, id) => !!tuneOf(man, key, layer)?.rejects?.includes(id);

/**
 * 判一張圖不符:**帳本移列 + 磁碟刪檔 + id 進黑名單**(三件事一起,少一件下一輪就長回來)。
 * `note` 寫在該層的調校上(「為什麼不對」是這一層的事,不是那一張圖的事 —— 圖等下就沒了)。
 */
export async function rejectImg(man, key, layer, file, note = '', dir = REFS_DIR) {
  const slot = slotOf(man, key, layer);
  const i = slot.findIndex((r) => r.file === file);
  if (i < 0) return { ok: false, why: '帳本裡沒有這一列' };
  const [row] = slot.splice(i, 1);
  const t = tuneOf(man, key, layer, true);
  if (!t.rejects.includes(row.id)) t.rejects.push(row.id);
  if (note) t.note = note;
  await rm(join(dir, safeKey(key), layer, row.file), { force: true });
  return { ok: true, id: row.id };
}

/** 逐張註解(「這張哪裡對、哪裡不對」;留著的圖才有註解,判不符的直接沒了) */
export function annotate(man, key, layer, file, note) {
  const row = slotOf(man, key, layer).find((r) => r.file === file);
  if (!row) return { ok: false, why: '帳本裡沒有這一列' };
  if (note) row.note = note; else delete row.note;
  return { ok: true };
}

/** 關鍵詞覆寫 + 這一層的註解(下一輪採集吃 q;註解是給人看的) */
export function retune(man, key, layer, { q, note }) {
  const t = tuneOf(man, key, layer, true);
  if (q !== undefined) t.q = String(q || '').trim();
  if (note !== undefined) t.note = String(note || '').trim();
  return t;
}

/** 使用者自己貼的照片:落檔 + 落帳(授權欄一律 `user`,見檔頭紀律 ③) */
export async function addUserImg(man, key, layer, buf, ext, note = '', dir = REFS_DIR) {
  const slot = slotOf(man, key, layer);
  // id 用序號而不是雜湊:同一張圖使用者可能刻意貼兩次(不同裁切),雜湊會把第二次吃掉
  const n = slot.filter((r) => r.api === 'user').length + 1;
  const id = `user_${safeKey(key)}_${layer}_${n}`;
  const file = `${id}.${ext}`;
  await mkdir(join(dir, safeKey(key), layer), { recursive: true });
  await writeFile(join(dir, safeKey(key), layer, file), buf);
  const row = { id, file, license: 'user', creator: null, source_url: null, query: null, api: 'user' };
  if (note) row.note = note;
  slot.push(row);
  return row;
}
