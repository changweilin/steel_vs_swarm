// ============ 覆寫層檔案存取(Node 端唯一縫;dev-only)============
// `tools/humanoid_forge/specs.json` 有**兩個**寫入端:
//   覆核台 :8621 的鍛造區塊 —— 寫 `prop`(人形比例)與 `knobs`(武器長度/發光)
//   機體展示台 :8631 的紙娃娃編輯器 —— 寫 `doll`(骨架/零件/彩繪)
// 兩邊各寫各的欄位 ⇒ 寫入 MUST 是**逐欄 patch**,MUST NOT 是「整格取代」:
// 整格取代的話,在覆核台調一次比例就把另一台存的紙娃娃整份洗掉,而畫面上只表現成
// 「我昨天拖的那些東西不見了」—— 沒有任何錯誤訊息。
//
// 零 npm 依賴、零 three(兩支 dev server 同吃這一支)。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { ROOT } from '../audit_src.mjs';

export const SPECS_FILE = join(ROOT, 'tools', 'humanoid_forge', 'specs.json');

/** 讀覆寫層(缺檔/壞檔 = 全走出廠值,MUST NOT 拋 —— 看板要照開)。
 *  `file` 是給離線稽核用的:同一支邏輯換一個檔跑,MUST NOT 為了驗它另寫一份 patch 語意。 */
export async function loadSpecs(file = SPECS_FILE) {
  try {
    const j = JSON.parse(await readFile(file, 'utf8'));
    return { version: 1, mechs: {}, ...j };
  } catch { return { version: 1, mechs: {} }; }
}

async function saveSpecs(s, file = SPECS_FILE) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(s, null, 2)}\n`);
}

/**
 * 逐欄寫入一台機體的覆寫。
 *   patch === null            → 整格清掉(= 還原出廠,含紙娃娃)
 *   patch = { k: v }          → 併進去
 *   patch = { k: null }       → 只清掉 k 這一欄
 * 併完之後空掉的格子一律刪除(覆寫層只存差異;留一個空物件會讓「這台有沒有被改過」多一種答案)。
 */
export async function patchOvr(key, patch, file = SPECS_FILE) {
  const st = await loadSpecs(file);
  st.mechs = st.mechs || {};
  if (patch == null) delete st.mechs[key];
  else {
    const cur = { ...(st.mechs[key] || {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) delete cur[k];
      else cur[k] = v;
    }
    if (Object.keys(cur).length) st.mechs[key] = cur;
    else delete st.mechs[key];
  }
  await saveSpecs(st, file);
  return st;
}

/**
 * 兩支 dev server 的 `/api/forge` 路由共用的處理器(MUST NOT 各寫一份:
 * 那就是「兩個寫入端、兩套 patch 語意」,而它壞掉的樣子正是本檔頭在講的事)。
 * @returns true = 已處理(呼叫端不必再往下走)
 */
export async function handleForgeApi(req, res, send) {
  if (!req.url.startsWith('/api/forge')) return false;
  if (req.method === 'GET') {
    send(200, JSON.stringify(await loadSpecs()), 'application/json; charset=utf-8');
    return true;
  }
  if (req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* 壞 JSON 當空 */ }
    if (!body.id) { send(400, '{"error":"id?"}', 'application/json; charset=utf-8'); return true; }
    const st = await patchOvr(String(body.id), body.ovr === undefined ? null : body.ovr);
    send(200, JSON.stringify({ ok: true, mechs: st.mechs }), 'application/json; charset=utf-8');
    return true;
  }
  send(405, '{"error":"method"}', 'application/json; charset=utf-8');
  return true;
}
