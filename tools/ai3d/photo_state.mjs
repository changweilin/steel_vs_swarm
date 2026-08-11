// ============ 圖檔三態:未處理 / 已處理 / 需修正(唯一推導縫)============
//
// 使用者需求(2026-08-10):「設定腳本可以在零件台執行/關閉,會自動判斷圖檔未處理/已處理/需修正」。
//
// **這一支不新增任何狀態檔**。三個狀態全部由既有的四本帳推導 ——
//
//   `photo_manifest.json`   這張圖存不存在、選片閘/人眼怎麼判、有沒有被切成目標、有沒有被刪
//   `harvest_state.json`    這張圖(的目標)送過 img→3D 沒有
//   `parts_manifest.json`   它出貨成哪一顆節點(來源帳)
//   `parts_review/state.json` 人眼對那顆節點的判決
//   `archive_manifest.json` 判過「⊘ 移除」而撤下來的那些(墓碑帳;來源帳裡已經沒有它了)
//
// 為什麼**一定**要推導而不是自己記一份:每一站已經各自在記帳了,再開第五本的下場是
// 「面板說未處理、迴圈說跑過了」,而兩邊都不會報錯(這正是 §5ar 三個 bug 的同一族)。
//
// ---- 判準與**順序**(順序本身就是語意,改了會讓某一態吃掉另一態)----
//
//   ① 需修正 = 有一筆**還沒執行**的人眼判決指著它(⟳ 重生 / ⇄ 換來源圖 / ✕ 刪除來源圖)
//              ⇒ 下一步動作在**人**身上(跑 apply_verdicts),排最前面
//   ② 已淘汰 = 選片閘或人眼判掉了 / 被 purge 進黑名單 / 帳本 ok:false
//              ⇒ 不會再動它。**這一態刻意獨立列出**:把它併進「已處理」會讓面板看起來
//                 「幾乎都處理完了」,而其實那是一堆垃圾;併進「未處理」則會讓人以為還有東西可跑
//   ③ 已處理 = 至少一個目標送過 img→3D(出不出得了貨是另一回事 —— 可用率 ~1/15 是這條管線的
//              本質,把「送過但沒出貨」算成需修正的話 14/15 的語料都會亮紅燈,那是雜訊不是資訊)
//   ④ 未處理 = 其餘 ⇒ **下一輪迴圈會跑到它**
//
// 判決是**逐節點**的,而狀態是**逐圖檔**的 ⇒ 對應要經來源帳(`imgs[].id` = 母照片)。
// 母照片被切成多個目標時,任一目標送過就算「已處理」—— 與 `harvest_loop.pendingMattes`
// 的單位一致(它餵的是目標)。
//
// ---- 另一個維度:**人眼碰過了沒有**(`reviewed`;2026-08-11 加)----
//
// 「已處理」只說得出「送過生成」。而使用者定案的「採集迴圈預設未覆核的全重跑」問的是另一件事:
// 這張圖的產出**有沒有人看過**。兩者刻意分成兩欄而不是加第五態 —— 一張圖可以同時
// 「已處理」且「沒人看過」(可用率 ~1/15:送過生成、沒出貨、也就沒有節點可以覆核),
// 而那正好就是要重跑的那一批。三種算「碰過」,任一成立即是:
//   ㋐ 它出貨的節點上有一筆覆核意見(含 ✔ 通過 —— 通過就是看過了)
//   ㋑ 它被判過「⊘ 移除」而進了封存帳(來源帳裡已經沒有那一列了,只有墓碑說得出來)
//   ㋒ 已淘汰(不會再動它)
// **選片閘的 `--human pass` 刻意不算**:那是對**照片**的判決(「這張可以用,放回待跑池」),
// 不是對產出的。把它算成覆核 = 人眼救回來的那幾張從此再也不會被重跑。
//
// A2:零 npm 依賴。本檔只讀檔、不寫檔、不 spawn。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../audit_src.mjs';
import { archivedPhotoIds, loadArchive, loadProvenance, partKeys } from './provenance.mjs';

export const STATES = {
  todo: { key: 'todo', label: '未處理', hint: '選片閘讓它過、還沒送過 img→3D ⇒ 下一輪迴圈會跑到它' },
  done: { key: 'done', label: '已處理', hint: '至少一個目標送過 img→3D(出不出得了貨看節點清單)' },
  fix: { key: 'fix', label: '需修正', hint: '有一筆還沒執行的人眼判決指著它 ⇒ 跑 apply_verdicts' },
  dropped: { key: 'dropped', label: '已淘汰', hint: '選片閘/人眼判掉或已進黑名單 ⇒ 不會再動' },
};

const loadJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };

/** 這張圖的「單位」:被切開就是那幾個目標,沒切就是它自己(與 pendingMattes 同一條規則) */
const unitsOf = (e) => (e.targets?.length ? e.targets : [{ id: e.id, screen: e.screen }]);

/**
 * 逐圖檔的狀態。
 * @param {string} home 資料家(`provenance.corpusHome()` 推導,或各工具的 `--home`)
 * @param {{reviewPath?:string, provPath?:string, archivePath?:string}} opts 只給稽核注入合成帳本用 ——
 *   執行期一律走預設,否則「面板讀的」與「稽核驗的」會是兩份不同的東西。
 * @returns {{home, ok, why?, rows:[], counts:{}}} `ok:false` = 這個資料家讀不到帳本(呼叫端照實說)
 */
export function photoStates(home, opts = {}) {
  if (!home) return { home: null, ok: false, why: '找不到任何有 photo_manifest.json 的資料家', rows: [], counts: empty() };
  const manPath = join(home, 'photo_manifest.json');
  if (!existsSync(manPath)) return { home, ok: false, why: `${manPath} 不存在`, rows: [], counts: empty() };
  const man = loadJson(manPath, []);
  const fed = loadJson(join(home, 'harvest_state.json'), {});
  const review = loadJson(opts.reviewPath || join(ROOT, 'tools', 'parts_review', 'state.json'), { items: {} });
  const prov = loadProvenance(opts.provPath);
  const archived = archivedPhotoIds(loadArchive(opts.archivePath));

  // 母照片 id → 它出貨成的節點(來源帳是唯一對應,MUST NOT 去拆檔名)。
  // 鍵走 `partKeys`:帳本兩種寫法都合法,直接讀 `p.keys` 會讓以 `key:` 寫的那些列
  // (現役的 mass_a/chimney_a…)算出「這張圖沒有出貨成任何節點」⇒ 面板寫「送過生成、
  // 沒有出貨」而它其實正在遊戲裡,連帶把它算成未覆核而排進重跑池。
  const nodesOf = new Map();
  for (const p of prov.parts) {
    for (const im of p.imgs || []) {
      if (!im.id) continue;
      if (!nodesOf.has(im.id)) nodesOf.set(im.id, []);
      nodesOf.get(im.id).push(...partKeys(p));
    }
  }
  // 還沒執行的人眼判決(`ok` 與空白都不算 —— apply_verdicts 執行完會把該筆刪掉)
  const pending = new Map();
  for (const [key, it] of Object.entries(review.items || {})) {
    if (!it?.status || it.status === 'ok') continue;
    pending.set(key, it);
  }

  const rows = [];
  for (const e of man) {
    const units = unitsOf(e);
    const keys = units.map((u) => `${e.family}/${e.part}/${u.id}`);
    const nodes = nodesOf.get(e.id) || [];
    const verdicts = nodes.map((k) => [k, pending.get(k)]).filter(([, v]) => v);
    const isFed = keys.some((k) => fed[k]);
    const isDropped = !e.ok || !!e.purged
      || (e.screen?.v === 'reject' && units.every((u) => (u.screen?.v ?? e.screen?.v) === 'reject'));

    let state;
    if (verdicts.length) state = 'fix';
    else if (isDropped) state = 'dropped';
    else if (isFed) state = 'done';
    else state = 'todo';

    // 人眼碰過了沒有(四條,見檔頭)。**與 `state` 正交**:一張「已處理」的圖可以完全沒人看過
    // (送過生成、沒出貨、沒有節點可覆核)—— 那正是要重跑的那一批。
    const isArchived = archived.has(e.id);
    const reviewed = isDropped || isArchived || nodes.some((k) => !!review.items?.[k]);

    rows.push({
      id: e.id, family: e.family, part: e.part, state,
      targets: e.targets?.length || 0,
      screen: e.screen ? `${e.screen.v}/${e.screen.why}` : null,
      purged: !!e.purged,
      nodes,
      reviewed,
      archived: isArchived,
      verdict: verdicts.length ? { node: verdicts[0][0], status: verdicts[0][1].status, note: verdicts[0][1].note || null } : null,
      // 「下一步是什麼」由狀態推導 —— 面板只負責畫,MUST NOT 自己再判一次
      next: state === 'fix' ? 'node tools/ai3d/apply_verdicts.mjs'
        : state === 'todo' ? '下一輪迴圈'
          : state === 'done' ? (nodes.length ? `已出貨 ${nodes.join('、')}`
            : reviewed ? '送過生成、沒有出貨;人眼已處置 ⇒ 不再自動重跑'
              : '送過生成、沒有出貨(可用率 ~1/15)⇒ 下一輪迴圈**重跑**(排在新圖之後)')
            : '不會再動',
    });
  }
  const counts = empty();
  for (const r of rows) counts[r.state]++;
  // 「未覆核」不是第五態而是另一個維度(見檔頭)⇒ 另外計一個數給面板與迴圈用
  const redo = rows.filter((r) => r.state === 'done' && !r.reviewed).length;
  return { home, ok: true, rows, counts, redo };
}

const empty = () => ({ todo: 0, done: 0, fix: 0, dropped: 0 });
