// ============ AI 生成 3D 物件的來源帳:方法字彙 + 讀取 + 照片解析 ============
//
// 使用者需求(2026-08-05):3D 對照台「**須說明使用哪個生成方法與 img**」。
// 那兩件事在此之前只存在於 `docs/ai3d_runbook.md` 的散文裡(§5b/§5e 的「批跑第 6 顆」),
// 沒有任何工具讀得到 ⇒ 收成一份機器可讀的帳 `parts_manifest.json` + 這一支讀取器。
//
// 三條紀律:
//   ① **字彙住這裡、事實住 JSON**:`METHODS` 是方法分流的字彙(計畫書 §8 那張表的程式碼形式),
//      JSON 只准引用鍵;未知鍵 MUST 報成 issue,MUST NOT 靜默當成「別的方法」。
//   ② **不複製推導得到的數字**:fallback 幾何 / 外廓 / 三角形數一律由消費端零件表與 GLB 實測來
//      (`parts_src.mjs`)。帳裡只記「哪個方法、哪張圖、什麼參數」這種**推導不出來**的事。
//   ③ **沒有帳就明講沒有帳**(原則 6 / 覆核台檔頭「不准藏」):`loadProvenance` 只負責如實回報,
//      對照台把「未記載來源」當成一種待辦狀態列出來,MUST NOT 讓一顆來路不明的石頭看起來正常。
//
// 照片不進儲存庫(runbook §3 規則 2)⇒ 只記相對路徑,能不能顯示由 `photoRoots` 當下解析。
// A2:零 npm 依賴。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from '../audit_src.mjs';

/**
 * 方法字彙 = 計畫書 §8「方法分流」那張表。`kind` 決定對照台怎麼比:
 *   - `glb`  執行期兩條路徑同時存在(保險絲 primitive vs 零件庫 GLB)⇒ 直接左右對照。
 *   - `parts` 生成物**就是零件表本身**,執行期沒有第二份 ⇒ 原版來自 `baseline.rev`
 *     (對照台以 `git show` 供應那一版模組,由**那一版自己的 buildBeacon** 建)。
 */
export const METHODS = {
  sf3d: {
    key: 'sf3d',
    label: 'img→3D(SF3D)',
    kind: 'glb',
    short: 'SF3D',
    doc: '有機/不規則幾何(岩體、樹冠)—— primitive 表達不出來,值得付 GLB 的重量與離線外廓契約(計畫書 §8)',
  },
  hunyuan_2gp: {
    key: 'hunyuan_2gp',
    label: 'img→3D(Hunyuan3D-2GP)',
    kind: 'glb',
    short: '2GP',
    doc: 'SF3D 的兩個已量測失敗型態(細頸斷裂、規則人造量體塌成立面殼)的上一階:原生 3D 擴散 + mmgp CPU offload,WSL2/3060 實測峰值 2.5GB / ~62s(runbook §5m;TRELLIS 兩階在這張卡量測出局 §5l)',
  },
  trellis2_spz: {
    key: 'trellis2_spz',
    label: 'img→3D(TRELLIS.2 stableprojectorz fork)',
    kind: 'glb',
    short: 'T2-spz',
    doc: '幾何 + PBR 一次出的 O-Voxel 原生 3D:官方 TRELLIS.2 在 12GB 卡出局(§5l),IgorAherne fork 以預編 wheel + 逐階段 CPU offload 翻案(§5n:7/7@1024³、峰值 ≤3.4GB、59~226s/張、載入需 ≥20GB 空閒 RAM)。輸出是撕裂薄殼 ⇒ MUST 先過 tools/ai3d/solidify_parts.py(§5o C 路徑:實體化再減面)才進 normalize;岩石類逐 seed 重抽(§5r)+ V5a 楔形補丁備援(§5s)',
  },
  simple_geom_tree: {
    key: 'simple_geom_tree',
    label: '語料導出佈局 + 基本體重建(簡單幾何版整樹)',
    kind: 'glb',
    short: '簡單幾何樹',
    doc: '§5z~§5z-o 那一路線:照片 → T2 浮雕殼**只當語料**(從它導出叢/層/瓣的佈局),葉冠與幹枝**整組換成基本體**重建 —— 所以 GLB 裡沒有一個頂點來自 AI 網格,但佈局是從那張照片量出來的。與 `procedural` 的分界就在這裡(那一支完全不看語料);與 `sf3d`/`trellis2_spz` 的分界是「AI 網格有沒有出貨」。葉冠**刻意不走 img→3D**(§5q:逐 seed 三注全不可用),雕塑性主體才走(§5u snag_a)。一株 = 木質 + 葉冠**兩顆節點**,由 normalize_parts `--group` 共用同一個變換烤出(各自縮放會把樹拆散)',
  },
  llm_parts: {
    key: 'llm_parts',
    label: 'LLM 讀照片 → 寫純資料零件列',
    kind: 'parts',
    short: '純資料件',
    doc: '規則/人造幾何(地標、建物模組、公設)—— 零二進位重量、零授權曝險,而且離線稽核量得到外廓(計畫書 §8)',
  },
  procedural: {
    key: 'procedural',
    label: '純程序生成(未經 AI)',
    kind: 'parts',
    short: '程序',
    doc: '小型植被與一般建物量體:整批換 GLB 會炸掉 draw call 與三角形預算,變化交給既有的抖動/散布(計畫書 §8)',
  },
};

export const MANIFEST_PATH = join(ROOT, 'tools', 'ai3d', 'parts_manifest.json');

/**
 * 讀來源帳並**驗一遍**。回傳 `{ version, parts, byKey, issues }`;
 * 檔案不存在不是例外(還沒生成過任何東西)—— 回空帳 + 一則 issue。
 */
export function loadProvenance(path = MANIFEST_PATH) {
  const issues = [];
  if (!existsSync(path)) {
    issues.push({ level: 'warn', msg: `來源帳不存在:${path}(還沒有任何 AI 生成物?)` });
    return { version: 0, parts: [], byKey: new Map(), issues };
  }
  let raw;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { return { version: 0, parts: [], byKey: new Map(), issues: [{ level: 'err', msg: `來源帳解析失敗:${e.message}` }] }; }
  const parts = Array.isArray(raw.parts) ? raw.parts : [];
  const byKey = new Map();
  for (const p of parts) {
    // 一次生成作業可能產出**一組同源節點**(尺寸階梯:同一張圖、同一組參數,只是烤成
    // 幾個級距)⇒ 允許 `keys: []` 一筆帳掛多個鍵。拆成 N 筆會讓同一件事有 N 份說明,
    // 改一個參數就得改 N 個地方(而漏改的那幾筆看起來仍然正常)。
    const keys = Array.isArray(p.keys) && p.keys.length ? p.keys : (p.key ? [p.key] : []);
    if (!keys.length) { issues.push({ level: 'err', msg: '有一筆沒有 key / keys' }); continue; }
    if (keys.some((k) => byKey.has(k))) issues.push({ level: 'err', msg: `${keys.join('、')}:重複記載(兩筆帳 = 沒有帳)` });
    const tag = keys.join('、');
    if (!METHODS[p.method]) issues.push({ level: 'err', msg: `${tag}:方法「${p.method}」不在 METHODS 字彙裡` });
    if (!p.imgs?.length) issues.push({ level: 'warn', msg: `${tag}:沒有記載任何來源圖` });
    for (const im of p.imgs || []) {
      if (!im.license) issues.push({ level: 'err', msg: `${tag}:來源圖 ${im.id || '?'} 沒有授權欄(CC0/PD 是硬閘)` });
      if (!im.source_url) issues.push({ level: 'warn', msg: `${tag}:來源圖 ${im.id || '?'} 沒有出處連結` });
    }
    if (METHODS[p.method]?.kind === 'parts' && !p.baseline?.rev) {
      issues.push({ level: 'warn', msg: `${tag}:純資料件沒有 baseline.rev ⇒ 對照台畫不出「原版」那一半` });
    }
    for (const k of keys) byKey.set(k, p);
  }
  return { version: raw.version || 0, parts, byKey, issues };
}

/**
 * 照片可能住哪裡。照片是 gitignore 的(runbook §3 規則 2),而 §5d 記著資料家目錄住**另一個
 * worktree** ⇒ 逐一探測:呼叫端指定 → 本 worktree → 主檢出 → 每一個姊妹 worktree。
 * 路徑裡帶著照片 id,命中就一定是同一張,不會挑錯。
 */
export function photoRoots(extra = null) {
  const roots = [];
  if (extra) roots.push(resolve(extra));
  roots.push(join(ROOT, 'tools', 'ai3d'));
  const m = ROOT.replace(/\\/g, '/').match(/^(.*)\/\.claude\/worktrees\/[^/]+$/);
  if (m) {
    const main = m[1];
    roots.push(join(main, 'tools', 'ai3d'));
    const wt = join(main, '.claude', 'worktrees');
    if (existsSync(wt)) {
      for (const d of readdirSync(wt)) roots.push(join(wt, d, 'tools', 'ai3d'));
    }
  }
  return [...new Set(roots)].filter((r) => existsSync(r));
}

/** 解析一張來源圖的實體路徑;找不到回 null(對照台照實顯示「原圖不在本機」,MUST NOT 假裝有) */
export function resolvePhoto(file, roots) {
  if (!file) return null;
  const rel = file.replace(/\\/g, '/');
  for (const r of roots) {
    const p = join(r, rel);
    if (existsSync(p)) return { path: p, root: r };
  }
  return null;
}
