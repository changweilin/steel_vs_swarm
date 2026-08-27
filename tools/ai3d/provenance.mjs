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
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
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
  plan_hull: {
    key: 'plan_hull',
    label: '設計圖→3D(正投影視覺外殼)',
    kind: 'glb',
    short: '設計圖外殼',
    doc: '使用者 2026-08-09 定案「建築部分也加入設計圖轉 3D 的功能,轉 3D 時只要處理外層表面就好」。**這一支不是另一個生成模型,是幾何**:照片只給一個視角 + 明暗線索(深度得用模型猜,§5ag-c 的 hoodoo 就是猜不出厚度而塌成薄板),而設計圖給的是**正投影的精確輪廓** ⇒ 逐視圖取外輪廓 → 沿自己那一軸拉伸成稜柱 → **稜柱取交集** = 視覺外殼,解出來的不是生成出來的。零 GPU / 零權重 / 零亂數 / 離線可驗(`tools/ai3d/audit_plan_mesh.py` 18 項 + `--break-outer`/`--break-frame` 反向)。**階梯上排在 T2-spz 之前:有設計圖就別去猜。**「只要處理外層表面」是兩件事而剛好同一個實作 —— ㋐只取最外層那條輪廓線(窗/樓層線/隔間一律填掉,那些是貼圖的事)㋑只有外殼沒有室內。實作 `tools/ai3d/plan_to_mesh.py`,下游與 img→3D 完全共用(normalize_parts → intake_parts)',
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
    label: '多面體宣告式純幾何零件列 (v5, 無關照片)',
    kind: 'parts',
    short: 'v5幾何件',
    doc: '規則/人造多面體幾何(地標、建物模組、公設)—— 零二進位重量、零授權曝險、無關照片，離線稽核量得到外廓(計畫書 §8)',
  },
  gemini_v6: {
    key: 'gemini_v6',
    label: 'Gemini 讀照片 → 寫多面體零件列(v6)',
    kind: 'parts',
    short: 'Gemini v6',
    doc: 'Gemini 3.7 / GPT 5.6 Luna 直讀照片以結構化輸出回傳多面體零件列(取代 v5 的 Python CV + 手寫規則,與 v5 並存)',
  },
  'gpt-5.6-luna_local': {
    key: 'gpt-5.6-luna_local',
    label: 'GPT-5.6 Luna 視覺 → 多面體零件列(v6)',
    kind: 'parts',
    short: 'Luna v6',
    doc: 'GPT-5.6 Luna 在工作樹內讀取 YOLO26 schema-v2 裁圖、遮罩與 metric-depth 證據，逐目標重建宣告式多面體；固定三視圖由獨立 reviewer 複核，不呼叫外部影像 API。',
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
 * **封存帳**(2026-08-11 使用者需求:「加入移除鍵,移除遊戲與零件台,放到封存區」)。
 *
 * 判 `⊘ 移除`的那一顆會被撤得乾乾淨淨(GLB / 名冊 / 來源帳三邊,同 `regen`/`reimg`)——
 * 而撤完之後**沒有任何一本帳說得出它存在過**:來源帳那一列就是它的說明,刪掉之後
 * 「這顆為什麼不見了」「它吃的是哪張圖」「能不能再生一次」全部無解,而台上看起來就是
 * 「本來就沒有這顆」。⇒ 撤下來的那一列原封不動搬進這裡當**墓碑**(同語料庫那條
 * 「被淘汰的照片刪檔、留帳」的規矩)。
 *
 * 這**不是第五本帳**(`photo_state` 檔頭那條):它記的是**別處已經沒有的東西**,
 * 而不是把別人記過的事再抄一份。三個消費端:零件台的「封存區」分頁、
 * `photo_state` 的「這張圖人眼碰過了」、`harvest_loop` 的「不再自動重跑」。
 *
 * 網格本身**不留**(GLB 節點真的被 `--drop` 掉了):留得住的是配方 + 來源圖,
 * 而那才是重生一顆所需要的東西 —— 存一份 GLB 拷貝反而會變成第二個「載得到的節點」。
 */
export const ARCHIVE_PATH = join(ROOT, 'tools', 'ai3d', 'archive_manifest.json');

/** 讀封存帳(不存在 = 還沒封存過任何東西,不是例外)。回 `{ version, parts, byKey }` */
export function loadArchive(path = ARCHIVE_PATH) {
  let raw = { version: 1, parts: [] };
  if (existsSync(path)) {
    try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch { raw = { version: 0, parts: [] }; }
  }
  const parts = Array.isArray(raw.parts) ? raw.parts : [];
  const byKey = new Map();
  for (const p of parts) for (const k of (p.keys || [])) byKey.set(k, p);
  return { version: raw.version || 0, parts, byKey };
}

/** 封存帳裡記著的**母照片 id**(「這張圖人眼已經處置過」的其中一種) */
export const archivedPhotoIds = (arch = loadArchive()) =>
  new Set(arch.parts.flatMap((p) => (p.imgs || []).map((i) => i.id)).filter(Boolean));

/**
 * 一列帳掛著哪幾個鍵 —— **兩種寫法都合法**(`key:` 單顆 / `keys: []` 一組同源節點,見
 * `loadProvenance` 裡的理由)⇒ 正規化只准有這一份。
 *
 * 為什麼是縫而不是各寫各的:2026-08-11 實測到 `apply_verdicts.withdraw()` 只讀 `keys`,
 * 於是**以 `key:` 寫的那些列在判決時整列查不到** —— 節點從 GLB 與名冊撤掉了、來源帳那一列
 * 卻留著,而且「這顆吃哪張圖」查出來是空的 ⇒ 判 `⇄ 換來源圖` / `✕ 刪除來源圖` 會回報
 * 「0 張」而看起來一切正常(下一輪照樣把同一張圖抓回來重跑)。
 */
export const partKeys = (p) => (Array.isArray(p?.keys) && p.keys.length ? p.keys : (p?.key ? [p.key] : []));

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
    // 改一個參數就得改 N 個地方(而漏改的那幾筆看起來仍然正常)。正規化走 `partKeys` 那一份。
    const keys = partKeys(p);
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
 * worktree** ⇒ 逐一探測:呼叫端指定 → 本 checkout → 主檢出 → 每一個姊妹 worktree。
 * 路徑裡帶著照片 id,命中就一定是同一張,不會挑錯。
 *
 * ⚠ 姊妹 worktree 那一圈 **MUST NOT 綁在「ROOT 自己是不是 worktree」上**(2026-08-11 修):
 * 照片 gitignore ⇒ **主檢出的 `tools/ai3d/` 永遠沒有 `photo_manifest.json`**,語料一律住某個
 * worktree。舊版只在 ROOT 匹配 `.claude/worktrees/<名>` 時才掃姊妹 ⇒ 從**主檢出**跑的時候
 * 候選集只剩它自己那一個(沒有帳本)⇒ `corpusHome()` 回 null ⇒ 採集迴圈那顆鈕按下去只回
 * 「找不到任何有 photo_manifest.json 的資料家」。而開發時每一支稽核與每一次手測都是在 worktree
 * 裡跑的(那裡正好匹配)⇒ 全綠,只有使用者從主檢出 `npm start` / `npm run parts` 時壞掉。
 */
export function photoRoots(extra = null) {
  const roots = [];
  if (extra) roots.push(resolve(extra));
  roots.push(join(ROOT, 'tools', 'ai3d'));
  // ROOT 是 worktree ⇒ 回推一層拿到主檢出;不是 ⇒ ROOT 自己就是主檢出(重複的由 Set 收掉)
  const mClaude = ROOT.replace(/\\/g, '/').match(/^(.*)\/\.claude\/worktrees\/[^/]+$/);
  const mGemini = ROOT.replace(/\\/g, '/').match(/^(.*)\/\.gemini\/antigravity\/worktrees\/[^/]+\/[^/]+$/);
  const main = mClaude ? mClaude[1] : (mGemini ? mGemini[1] : ROOT);
  roots.push(join(main, 'tools', 'ai3d'));
  const wtClaude = join(main, '.claude', 'worktrees');
  if (existsSync(wtClaude)) {
    for (const d of readdirSync(wtClaude)) roots.push(join(wtClaude, d, 'tools', 'ai3d'));
  }
  const wtGemini = join(main, '.gemini', 'antigravity', 'worktrees', 'steel_vs_swarm');
  if (existsSync(wtGemini)) {
    for (const d of readdirSync(wtGemini)) roots.push(join(wtGemini, d, 'tools', 'ai3d'));
  }
  return [...new Set(roots)].filter((r) => existsSync(r));
}

/**
 * **註冊在案的儲存庫外資料家**(2026-08-11 使用者需求:「版權問題不在專案的管線也要顯示在
 * 零件台」)。
 *
 * 版權未確認的那一份**刻意住儲存庫之外** ⇒ `photoRoots()` 推導不到它(那是設計,見
 * `corpusMeta` 紀律 ③)。代價是它在台上**整份看不見**,而「台上沒有」跟「沒跑過」長得
 * 一模一樣 —— 使用者手動放進去的建築/樹木照片就是這樣消失的:迴圈那顆鈕按下去跑的永遠是
 * 另一個家,而畫面上沒有任何錯誤訊息。
 *
 * ⇒ 開一條**明講**的註冊縫,而不是把它併回 `photoRoots()`:
 *   ・`<任一 photoRoot>/corpus_homes.json` —— gitignore 的本機指標檔(`{"homes":[絕對路徑]}`,
 *     裸陣列也收)。放在主檢出那一份就對每一個 worktree 生效(那些目錄本來就互相掃得到)。
 *   ・環境變數 `SVS_PHOTO_HOMES` —— 以平台的路徑分隔符分隔(CI / 一次性覆寫)。
 *
 * **出貨那道閘一格未動**:註冊只讓它「看得見、選得到」,能不能進遊戲仍然只由 `<家>/corpus.json`
 * 的 `shipping` 決定(`harvest_loop` 強制 `--no-intake`),而 `corpusHome()` 的**預設**挑選
 * MUST NOT 挑到非出貨家(見該函式)。⇒ 「不會被誤拿去出貨」仍是構造保證,只是那道保證從
 * 「推導不到」搬到「推導得到但預設不選,而且它本來就進不了第 ⑦⑧ 站」。
 */
export function extraHomes() {
  const out = [];
  const push = (p) => { const r = p && resolve(p.trim()); if (r && !out.includes(r) && existsSync(r)) out.push(r); };
  for (const root of photoRoots()) {
    const f = join(root, 'corpus_homes.json');
    if (!existsSync(f)) continue;
    try {
      const j = JSON.parse(readFileSync(f, 'utf8'));
      for (const p of Array.isArray(j) ? j : (j.homes || [])) push(String(p));
    } catch { /* 讀不懂就當沒註冊(寧缺勿錯:壞掉的指標檔 MUST NOT 變成亂讀目錄的後門) */ }
  }
  for (const p of (process.env.SVS_PHOTO_HOMES || '').split(delimiter)) if (p) push(p);
  return out;
}

/**
 * **資料家**候選(= `photoRoots()` ∪ `extraHomes()` 裡真的有帳本的那幾個),依帳本筆數由多到少。
 *
 * 為什麼要排序而不是「取第一個」:語料家會搬(§5af-g:一個 worktree 被刪掉,整份 superset
 * 跟著沒了),而探測順序是**目錄名的字典序**,與「哪一份是 superset」完全無關 ——
 * 實測兩個候選 415 筆 vs 81 筆,取第一個有 50% 機率挑到那份小的,而畫面上只表現成
 * 「語料怎麼變少了」。⇒ 取筆數最多的那一個,**並且把其他候選一起回傳**:
 * 呼叫端(零件台的圖檔面板)MUST 把挑中的那一個顯示出來,MUST NOT 靜靜地替使用者決定。
 *
 * 每一列都帶著 `shipping`/`why`(`corpusMeta` 那一份,不是第二次判斷):非出貨語料與正式語料
 * 長得一模一樣,而人眼判決是照著台上做的 ⇒ 呼叫端 MUST 標出來。
 *
 * 這一支是「資料家在哪」的唯一推導縫。要指定別的一律走各工具的 `--home` 參數。
 */
export function corpusHomes(extra = null) {
  const out = [];
  for (const root of [...photoRoots(extra), ...extraHomes()]) {
    if (out.some((o) => o.home === root)) continue;
    const man = join(root, 'photo_manifest.json');
    if (!existsSync(man)) continue;
    let n = 0;
    try { n = JSON.parse(readFileSync(man, 'utf8')).length || 0; } catch { continue; }
    const meta = corpusMeta(root);
    // **明指的那一個永遠排第一**(`--photos` / `--home`):筆數排序是「沒人告訴我用哪個」
    // 時的推導,拿它去覆蓋使用者明講的選擇就是自作主張(而症狀是「我指定了 A,它讀 B」)。
    out.push({
      home: root, entries: n, explicit: !!extra && root === resolve(extra),
      shipping: meta.shipping, why: meta.why, declared: meta.declared,
    });
  }
  return out.sort((a, b) => (b.explicit - a.explicit) || (b.entries - a.entries));
}

/**
 * 挑中的那一個資料家(沒有任何候選 ⇒ null,呼叫端印理由,MUST NOT 假裝有)。
 *
 * **預設 MUST 是出貨家**:註冊縫(`extraHomes`)讓版權未確認的那一份看得見了,而它的筆數
 * 排序完全可能剛好在前面 —— 沒有這一條的話,「什麼都沒指定就按啟動」會去跑一個不進遊戲的家,
 * 而那正是原本靠「推導不到」擋住的事。要跑它一律得**明講**(`--home` / `--photos`,
 * 或零件台上從候選清單裡挑一個)。全部候選都不出貨時仍回第一個 —— 那時使用者只有那一份,
 * 假裝沒有比較糟(呼叫端會標「非出貨」)。
 */
export const corpusHome = (extra = null) => {
  const all = corpusHomes(extra);
  if (all[0]?.explicit) return all[0].home;
  return (all.find((h) => h.shipping) || all[0])?.home ?? null;
};

/**
 * **模型棧家**(`.venv` 與 `vendor/stable-fast-3d/` 住哪)—— 與語料家是**兩件事**。
 *
 * runbook §5d 記著兩者刻意不同住:weights/venv 在一個 worktree、照片在另一個
 * (本機實測 venv 在 `zen-albattani-*`、語料在 `reverent-pascal-*`)⇒ `harvest_loop`
 * 的 `--venv` 與 `--home` 是兩個獨立參數。呼叫端只推導語料家、讓 venv 家預設等於它的話,
 * `harvest_loop` 找不到 python ⇒ **去背 / 圈選分離 / 選片閘 / 生成四站全部跳過**,
 * 而鈕面照樣顯示「執行中」、每一輪照樣印「本輪:生成 0」——
 * 看起來完全正常,只是這個迴圈永遠不會產出任何東西。
 *
 * 排序:有 SF3D vendor 的排前面(只有 venv 沒有 vendor 的那一份跑得了去背與選片、
 * 跑不了生成)。推不到回 null ⇒ 呼叫端 MUST NOT 硬塞一個路徑進去。
 */
export function venvHomes() {
  const out = [];
  for (const root of photoRoots()) {
    const py = [join(root, '.venv', 'Scripts', 'python.exe'), join(root, '.venv', 'bin', 'python')];
    if (!py.some((p) => existsSync(p))) continue;
    out.push({ home: root, sf3d: existsSync(join(root, 'vendor', 'stable-fast-3d', 'run.py')) });
  }
  return out.sort((a, b) => b.sf3d - a.sf3d);
}

/** 挑中的那一個模型棧家(沒有 ⇒ null;`harvest_loop` 會印「找不到 venv python」並跳過那幾站) */
export const venvHome = () => venvHomes()[0]?.home ?? null;

/**
 * **資料家的身分宣告** `<家>/corpus.json`(2026-08-11 使用者定案:「授權問題的照片放在專案外
 * 一樣的路徑跑 img to 3D 管線,**先別放遊戲中**」)。
 *
 * 為什麼是一個檔而不是一個旗標:使用者選的是「只跑到 contact sheet 就停」,而那條路唯一的
 * 弱點就是「每次都要記得加 `--no-intake`」—— 忘記一次就進了第 ⑦⑧ 站。把它掛在**家**上面,
 * 忘不掉:同一個家不管誰用什麼指令跑,答案都一樣。
 *
 * 兩個消費端:`fetch_photos --adopt`(非出貨家才收非 CC0,並逐筆蓋 `restricted` 戳記)、
 * `harvest_loop`(非出貨家強制 `--no-intake`)。
 *
 * 三條紀律:
 *   ① **沒有這個檔 = 出貨用**(舊行為逐位元不變 —— 現役那 415 筆一個字都沒動)。
 *   ② **讀不懂就當出貨用**(寧缺勿錯:壞掉的宣告檔 MUST NOT 變成放行非 CC0 的後門)。
 *   ③ 這個家刻意住**儲存庫之外** ⇒ `photoRoots()` 永遠推導不到它,只有明著帶
 *      `--home` / `--photos` 才讀得到。⇒「不會被誤拿去出貨」是**構造保證**,不是紀律。
 */
export function normalizeCorpusHome(home) {
  if (!home) return home;
  const root = resolve(home);
  const parent = dirname(root);
  return basename(root).toLowerCase() === 'photos' && existsSync(join(parent, 'corpus.json')) ? parent : root;
}

export function corpusMeta(home) {
  const p = join(normalizeCorpusHome(home) || '', 'corpus.json');
  if (!home || !existsSync(p)) return { shipping: true, why: null, declared: false };
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return { shipping: j.shipping !== false, why: j.why || null, declared: true };
  } catch { return { shipping: true, why: null, declared: false }; }   // 紀律 ②
}

/** 這個家的產出可不可以進遊戲?(沒宣告 = 可以,逐位元同舊行為) */
export const corpusShips = (home) => corpusMeta(home).shipping;

/** 解析一張來源圖的實體路徑;找不到回 null(對照台照實顯示「原圖不在本機」,MUST NOT 假裝有) */
export function resolvePhoto(file, roots) {
  if (!file) return null;
  const rel = file.replace(/\\/g, '/');
  const allRoots = [...new Set([...(roots || []), ...extraHomes()])];
  for (const r of allRoots) {
    const candidates = [
      join(r, rel),
      join(r, 'photos', rel),
      join(r, rel.startsWith('photos/') ? rel.slice('photos/'.length) : `photos/${rel}`),
      join(r, 'photos', rel.startsWith('photos/') ? rel.slice('photos/'.length) : rel),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        try {
          if (!statSync(p).isDirectory()) return { path: p, root: r };
        } catch {}
      }
    }
  }
  return null;
}
