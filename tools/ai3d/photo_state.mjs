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
// A2:零 npm 依賴。本檔只讀檔、不寫檔、不 spawn。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../audit_src.mjs';
import { loadProvenance } from './provenance.mjs';

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
 * @param {{reviewPath?:string, provPath?:string}} opts 只給稽核注入合成帳本用 —— 執行期一律走預設,
 *   否則「面板讀的」與「稽核驗的」會是兩份不同的東西。
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

  // 母照片 id → 它出貨成的節點(來源帳是唯一對應,MUST NOT 去拆檔名)
  const nodesOf = new Map();
  for (const p of prov.parts) {
    for (const im of p.imgs || []) {
      if (!im.id) continue;
      if (!nodesOf.has(im.id)) nodesOf.set(im.id, []);
      nodesOf.get(im.id).push(...(p.keys || []));
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

    rows.push({
      id: e.id, family: e.family, part: e.part, state,
      targets: e.targets?.length || 0,
      screen: e.screen ? `${e.screen.v}/${e.screen.why}` : null,
      purged: !!e.purged,
      nodes,
      verdict: verdicts.length ? { node: verdicts[0][0], status: verdicts[0][1].status, note: verdicts[0][1].note || null } : null,
      // 「下一步是什麼」由狀態推導 —— 面板只負責畫,MUST NOT 自己再判一次
      next: state === 'fix' ? 'node tools/ai3d/apply_verdicts.mjs'
        : state === 'todo' ? '下一輪迴圈'
          : state === 'done' ? (nodes.length ? `已出貨 ${nodes.join('、')}` : '送過生成、沒有出貨(可用率 ~1/15)')
            : '不會再動',
    });
  }
  const counts = empty();
  for (const r of rows) counts[r.state]++;
  return { home, ok: true, rows, counts };
}

const empty = () => ({ todo: 0, done: 0, fix: 0, dropped: 0 });
