#!/usr/bin/env node
/**
 * img→3D 週期性採集迴圈(2026-08-10 使用者定案:「因為成功率太低,跑腳本週期性抓更多 img
 * 執行 img to 3D 的流程」)。
 *
 * 它**不是新的一條管線** —— 每一站都是既有工具,這一支只負責「照順序、隔一段時間、再跑一輪」:
 *
 *   ⓪ 收編 inbox   fetch_photos.mjs --adopt      使用者自己放的圖(零網路,永遠先跑)
 *   ① 抓照片       fetch_photos.mjs --limit N    型錄缺額 + 取景階梯(CLEAN_Q)
 *   ② 去背         matte_photos.py               photos/ → out/matte/
 *   ②b 圈選 + 分離 split_targets.py              一張多目標的 matte → out/targets/ 逐目標各一張
 *   ③ 選片閘       screen_mattes.py --sheet      統計七桶淘汰(逐**目標**)+ 倖存者 contact sheet
 *   ④ img→3D      vendor/stable-fast-3d/run.py  只餵**這一輪新過閘**的目標
 *   ⑤ 實心度快篩   mesh_stats.mjs                薄殼/碎片排序
 *   ⑥ contact sheet mesh_sheet.mjs               人眼複核那一步的輸入
 *   ⑦ 自動入庫     auto_intake.mjs               normalize → intake 閘 → 名冊追加 → 來源帳
 *   ⑧ 收尾稽核     auto_intake --gate-full       紅字 ⇒ 整輪回滾(逐位元)
 *
 * 為什麼要週期跑而不是一次跑完(這三條都是量出來的,不是保守):
 *   ・**限流是逐主機的、而且以十分鐘計**:upload.wikimedia.org 撞 429 之後 `Retry-After: 600`,
 *     之後每十分鐘只放 2~3 張(fetch_photos 檔頭)。一輪抓不完不是失敗,是這個來源的節奏
 *     ⇒ 預設 `--every 15`(分鐘)留餘裕。把它調到 5 分鐘不會更快,只會讓封鎖一直續期。
 *   ・**可用率 ~1/15**(skill §4):照片與網格兩階段各刷掉一次 ⇒ 產出是機率的,只能靠輪數累積。
 *   ・**人眼那一步仍然不可省**(§5h 一輪擋下六顆內容錯誤的網格)—— 2026-08-10 使用者定案
 *     「先全部自動化,人眼再審查,決定要刪除原始照片或調整參數重新處理」⇒ 人眼**沒有被省掉,
 *     是換到入庫之後**。舊版檔頭那條「MUST NOT 自動入庫」於此改寫,而讓它擋得住的不是
 *     多一道統計閘(那正是擋不住「統計全綠、內容是一張版畫」的那種東西),是三件結構性的:
 *       ㋐ **不 commit** —— ⑦⑧ 只寫工作區;沒有 commit 就是沒有出貨,人眼永遠排在出貨之前。
 *       ㋑ **可撤** —— 對照台四種判決由 `apply_verdicts.mjs` 執行:`purge` 連原始照片一起刪
 *          並進黑名單、`reimg`/`regen` 撤節點重來。撤節點 = GLB + 名冊 + 來源帳三邊同時。
 *       ㋒ **只准追加到既有輪替名冊** —— 開新格要寫 fallback 描述子(降級幾何 + 離線外廓
 *          上界 + 縮放目標三合一),那是設計不是轉換,自動化不碰。
 *     ⇒ 最壞情況是「工作區裡多了一顆醜東西」,而不是「出貨了一張版畫」。
 *     `--no-intake` 退回 2026-08-10 之前的行為(只跑到 contact sheet)。
 *
 * 紀律:
 *   ① **每一站都可以缺席**(原則 6):沒有 venv / 沒有 vendor / 沒有 GPU ⇒ 印出理由跳過那一站,
 *      其餘照跑。沙箱裡 ①④ 天生跑不動(CLAUDE.md ㋓:無外網、無 GPU),⓪②③⑤⑥ 仍有意義。
 *   ② **只餵新的**:已經送過 SF3D 的 matte 記在 `<資料家>/harvest_state.json`,重跑不會把
 *      整個語料庫重算一遍(390 張 × 7 秒 = 45 分鐘,而且每一輪都燒同樣的電)。
 *   ③ **選片閘淘汰的不餵**:那一批本來就是要丟的,送進 SF3D 等於拿 GPU 去證明它們是垃圾。
 *      同一條的另外兩半(2026-08-10 §5as 首輪實測補上,見 `pendingMattes` 檔頭):
 *      **已經出貨成節點的來源不重跑**(同一張圖 + 同一組參數 = 同一顆網格)、
 *      **沒有消費端的族不生成**(`PART_LIBS` 推導;landmark 走 Route A,沒有 landmark.glb)。
 *   ④ 一輪一列 JSONL 記在 `<資料家>/harvest_log.jsonl` —— 「跑了幾輪、每輪產出幾顆」是這一批
 *      改動唯一能回答「成功率有沒有變好」的東西,不記就只剩印象。
 *
 * 用法(在 3060 那台跑;資料家是**參數**,見 fetch_photos.mjs 檔頭的同一條):
 *   node tools/ai3d/harvest_loop.mjs --home <資料家> --rounds 8 --every 15
 *   node tools/ai3d/harvest_loop.mjs --home <資料家> --rounds 1 --family tree
 *   node tools/ai3d/harvest_loop.mjs --home <資料家> --no-gen        只跑採集端(無 GPU 的機器)
 *   node tools/ai3d/harvest_loop.mjs --home <資料家> --no-intake     只跑到 contact sheet(舊行為)
 *   node tools/ai3d/harvest_loop.mjs --home <資料家> --no-redo       不重跑未覆核的(送過就不再送)
 *   node tools/ai3d/harvest_loop.mjs --home <資料家> --dry           只印每一站要跑什麼,不執行
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { partLibs } from './parts_src.mjs';
import { corpusMeta, loadProvenance, normalizeCorpusHome } from './provenance.mjs';
import { photoStates } from './photo_state.mjs';
import { dataFamilies, gpuFamilies, routeFor } from './pipeline_policy.mjs';
import { legacyJobs } from './replacement_plan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };

const HOME = normalizeCorpusHome(opt('home', HERE));
// venv 與 vendor 未必與語料同住(runbook §5d:weights/venv 在一個資料家、照片在另一個)
const VENV_HOME = opt('venv', HOME);
// `--rounds 0`(或負數)= 一直跑下去:採集是機率的(可用率 ~1/15),而「跑到夠為止」
// 本來就沒有一個算得出來的輪數 ⇒ 讓它跑著,靠 Ctrl-C 或排程器收工。
const ROUNDS = Number(opt('rounds', 1));
const FOREVER = !(ROUNDS > 0);
const EVERY_MIN = Number(opt('every', 15));
const LIMIT = Number(opt('limit', 20));
const GEN_LIMIT = Number(opt('gen-limit', 12));
// T2-spz 每張 59~226s、而且載入時 pipeline 是 19GB CPU 常駐(§5n)⇒ 一輪切小一點,
// 否則單輪就吃掉一個小時、`--every` 的節奏整個失去意義。
const T2_LIMIT = Number(opt('t2-limit', 4));
const FAMILY = opt('family');
const DRY = flag('dry');
const NO_GEN = flag('no-gen');
// **非出貨語料家強制停在 contact sheet**(2026-08-11 使用者定案)。旗標掛在**家**上面
// (`<家>/corpus.json` 的 shipping:false),不是掛在指令列上 —— 使用者選的就是「只跑到
// contact sheet 就停」這條路,而它唯一的弱點是「每次都要記得加 --no-intake」,忘一次就
// 進了第 ⑦⑧ 站。沒宣告的家逐位元同舊行為。
const CORPUS = corpusMeta(HOME);
const NO_INTAKE = flag('no-intake') || !CORPUS.shipping;
// 一輪最多自動入庫幾顆。刻意小:名冊每多一顆,同一張圖上的剪影分佈就整個重排
// (`bldGeo`/`megaGeo` 的輪替除數是名冊長度)⇒ 一次塞十顆等於一次改十次全場外觀,
// 而人眼要在對照台上逐顆比對的正是那個差別。
const INTAKE_LIMIT = Number(opt('intake-limit', 4));
// **未覆核的重跑**(2026-08-11 使用者定案:「採集迴圈預設未覆核的全重跑(順位在後面)」)。
// 預設開;`--no-redo` 退回 2026-08-11 之前的行為(送過就永遠不再送)。細節見 `pendingMattes`。
const NO_REDO = flag('no-redo');
// 只平行 CPU 的去背 / 分離 / 篩選。GPU 模型維持單通道批次；同卡平行載入會超過 12GB。
const CATEGORY_JOBS = Math.max(1, Number(opt('category-jobs', Math.min(3, availableParallelism()))));

// **逐族選模型,不是全族一把**(runbook §5n 量出來的:T2-spz 對建築/規則幾何是雙 ◎,
// SF3D 在同一張仰拍煙囪上出的是一顆歪塊)。`--t2` 指到 TRELLIS.2-stableprojectorz 的 checkout;
// 沒給就整族退回 SF3D(降級不例外)—— 但那對建築是**已知比較差**的那一條,會印出來說明。
const T2_FAMS = new Set(['building']);
const T2_HOME = opt('t2');
const T2_PY = T2_HOME ? join(T2_HOME, '.venv', 'Scripts', process.platform === 'win32' ? 'python.exe' : 'python') : null;
const T2_GATE = T2_HOME ? join(T2_HOME, 'run_t2_gate.py') : null;
const T2_BIN = T2_HOME ? join(T2_HOME, 'binarize_feed.py') : null;
const t2Ready = !!(T2_PY && existsSync(T2_PY) && existsSync(T2_GATE) && existsSync(T2_BIN));
// Hunyuan 的官方 entrypoint 隨 checkout 版本變動；skill 明令不得猜旗標。這裡只接一支外部
// adapter，契約固定為 `<adapter> <images...> --output-dir <dir>`，輸出可為 `<i>/mesh.glb`
// 或 `<target-id>.glb`。adapter 內部才依該 checkout 的 README 呼叫 2GP shape-only。
const HUNYUAN = opt('hunyuan');
const hunyuanReady = !!(HUNYUAN && existsSync(HUNYUAN));

const PY = join(VENV_HOME, '.venv', 'Scripts', process.platform === 'win32' ? 'python.exe' : 'python');
const PY_NIX = join(VENV_HOME, '.venv', 'bin', 'python');
const python = existsSync(PY) ? PY : existsSync(PY_NIX) ? PY_NIX : null;
const SF3D = join(VENV_HOME, 'vendor', 'stable-fast-3d', 'run.py');
const MATTE_DIR = join(HOME, 'out', 'matte');
const STATE = join(HOME, 'harvest_state.json');
const LOG = join(HOME, 'harvest_log.jsonl');
const MANIFEST = join(HOME, 'photo_manifest.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

/** 跑一站;缺工具不是例外(紀律 ①)—— 回 { ok, skipped, out }。 */
function step(label, cmd, args, opts = {}) {
  // **結構性的略過在 `--dry` 底下也要講**(`opts.hard`)。`--dry` 是拿來確認「這一輪會做
  // 什麼」的,而「非出貨語料家不進第 ⑦⑧ 站」正是要在那裡看得到的事 —— 印成 `[dry] 自動入庫`
  // 等於謊報它會入庫,而那正是這道閘要保證不會發生的事。
  // 其餘的略過(「這一輪沒有新產出」那種)仍讓 `--dry` 先講:那是**因為 dry 才沒產出**,
  // 真的跑起來會有,提前報成略過反而不實。
  if (opts.skip && opts.hard) { console.log(`  ⏭  ${label}:${opts.skip}`); return { ok: true, skipped: opts.skip }; }
  if (DRY) { console.log(`  [dry] ${label}: ${cmd} ${args.join(' ')}`); return { ok: true, dry: true }; }
  if (opts.skip) { console.log(`  ⏭  ${label}:${opts.skip}`); return { ok: true, skipped: opts.skip }; }
  console.log(`  ▶ ${label}`);
  const r = spawnSync(cmd, args, { cwd: opts.cwd || ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  for (const line of out.split(/\r?\n/)) if (line.trim()) console.log(`     ${line}`);
  if (r.error) { console.warn(`  ⚠ ${label} 起不來:${r.error.message}(跳過,其餘照跑)`); return { ok: false, out }; }
  if (r.status !== 0) console.warn(`  ⚠ ${label} 回傳 ${r.status}(不中斷整輪)`);
  return { ok: r.status === 0, out };
}

async function stepAsync(label, cmd, args, opts = {}) {
  if (opts.skip && opts.hard) return step(label, cmd, args, opts);
  if (DRY) return step(label, cmd, args, opts);
  if (opts.skip) return step(label, cmd, args, opts);
  return await new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || ROOT, shell: process.platform === 'win32' && !/[\\/]/.test(cmd),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks = [];
    child.stdout.on('data', (buf) => chunks.push(buf));
    child.stderr.on('data', (buf) => chunks.push(buf));
    child.on('error', (error) => resolve({ ok: false, out: '', error }));
    child.on('close', (code) => {
      const out = Buffer.concat(chunks).toString('utf8');
      console.log(`  ▶ ${label}`);
      for (const line of out.split(/\r?\n/)) if (line.trim()) console.log(`     ${line}`);
      if (code) console.warn(`  ⚠ ${label} 回傳 ${code}(不中斷整輪)`);
      resolve({ ok: code === 0, out });
    });
  });
}

async function mapLimit(rows, limit, fn) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, rows.length) }, async () => {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      await fn(row);
    }
  });
  await Promise.all(workers);
}

const loadJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };

/**
 * 這一輪要餵 img→3D 的**目標**:**新的** ∧ **選片閘沒淘汰** ∧ **已出貨的來源不重跑**
 * ∧ **這一族真的有消費端**。淘汰名單以帳本的 id 為鍵(matte 檔名 = 照片 id + .png)。
 *
 * 2026-08-10 §5au 起單位是**目標**不是照片:`split_targets.py` 把多目標的 matte 切成
 * `entry.targets[]`,有切的就餵那幾張、母 matte 不餵(餵了 = 同一批像素送兩次 GPU,而且
 * 那一張本來就是「一座水塔加一整棟房子」)。兩條紀律:
 *   ・**目標 → 母照片的對應 MUST 由帳本推導**(`entry.targets[].id`),MUST NOT 去拆檔名 ——
 *     命名規則只在 `split_targets.py` 定義一次,這邊再拼一次就是第二份實作,而它壞掉的樣子是
 *     「已出貨的來源被重新餵上 GPU」(§5as-d 那個坑),沒有任何錯誤訊息。
 *   ・**「已出貨」比對的是母照片 id**:目標是同一張照片切出來的,來源帳記的是照片。
 *
 * 後兩道閘 2026-08-10 補(§5as 的首輪實測;兩者都是「跑起來很正常,只是那幾顆 GPU 白燒」):
 *
 * ① **已出貨的來源**(來源帳 `imgs[].id`):`harvest_state.json` 只記得**這支迴圈**餵過誰,
 *    而已出貨那幾顆的 matte 是更早的手動輪做的 ⇒ 首輪實測 64 顆 T2 產出裡有 **6 顆**
 *    (9.4%)是 mass_a / mass_b / mass_c / masslow_a / masslow_b / chimney_a 的**同一張照片**。
 *    同一張圖 + 同一組參數 = 同一顆網格(工具是決定性的),燒了 GPU 還把已經判過的東西
 *    塞回人眼複核的池子裡。
 *
 * ② **沒有消費端的族**:能載進遊戲的零件庫只有 `PART_LIBS`(推導,MUST NOT 手寫)——
 *    現役是 rock / tree / building。`landmark` 族**沒有 landmark.glb**,它走的是 Route A
 *    (讀照片、手寫純資料 primitive 進 `beacons.js KIND_PARTS`)⇒ 首輪那 11 顆 landmark 網格
 *    今天沒有任何東西載得到。這一閘**只擋生成**:照片與 matte 照收(Route A 要看照片),
 *    而且**不寫進 `done`** —— 哪天真的開了 `landmark.glb`,它自己就會回到待跑名單。
 *
 * ---- 未覆核的**重跑**(2026-08-11 使用者定案:「預設未覆核的全重跑(順位在後面)」)----
 *
 * 紀律 ② 的「只餵新的」有一個代價:可用率 ~1/15 ⇒ **十四份之十四**的語料送過一次生成之後
 * 就永遠躺在 `harvest_state.json` 裡不再被碰,而它們絕大多數根本沒有人看過(沒出貨就沒有節點,
 * 沒有節點就沒有東西可以覆核)。新圖抓完之後這支迴圈就會空轉,而畫面上只表現成「本輪生成 0」。
 * ⇒ 「已經餵過**而且沒人看過**」的那些排在新圖**後面**重跑一次。
 *
 * 三件事要講清楚:
 *   ㋐ **順位在後面是使用者指定的,也是對的**:新圖是這一輪唯一沒被試過的東西,額度先給它。
 *   ㋑ 「覆核過了沒有」**MUST 走 `photo_state.photoStates()` 那一份推導**(節點覆核 / 封存帳 /
 *      已淘汰),MUST NOT 在這裡自己判 —— 那正是「面板說未處理、迴圈說跑過了」那一族的成因。
 *      已出貨的仍由上面那道 `shipped` 閘擋著(等人覆核,不是等重跑)。
 *   ㋒ **同一張圖 + 同一組參數 = 同一顆網格**(工具是決定性的)⇒ 重跑的價值不在「這次會不會
 *      比較好看」,而在**下游整條管線一直在動**(圈選分離、實體化參數、破口閘、名冊額度都改過)
 *      ⇒ 同一顆網格這次可能過得了閘。要真的換一顆網格得改參數:判 `⟳ 重生` 寫進
 *      `intake_overrides.json`,那一條路仍然只有人眼開得了。
 *   排序取**最早餵過的優先**:`--rounds 0` 跑起來時,每輪只吃得下 GEN_LIMIT 顆,不排序的話
 *   會反覆重跑同樣那十幾張(而它們每一輪都變成「最新餵過的」)。
 */
function pendingMattes(done) {
  if (!existsSync(MATTE_DIR)) return [];
  const man = loadJson(MANIFEST, []);
  const rejected = new Set(man.filter((e) => e.screen?.v === 'reject').map((e) => e.id));
  // 母照片 id → 它切出來的目標(帳本是唯一真相,見檔頭)
  const split = new Map(man.filter((e) => e.targets?.length).map((e) => [e.id, e.targets]));
  const shipped = new Set(loadProvenance().parts.flatMap((p) => (p.imgs || []).map((i) => i.id)).filter(Boolean));
  const consumable = new Set(partLibs());
  // 「餵過但沒人看過」的母照片(推導縫 = photo_state;`--no-redo` 退回舊行為)
  const unreviewed = NO_REDO ? new Set()
    : new Set(photoStates(HOME).rows.filter((r) => r.state === 'done' && !r.reviewed).map((r) => r.id));
  const legacy = new Map();
  for (const job of legacyJobs()) {
    const k = `${job.family}/${job.part || ''}`;
    if (!legacy.has(k)) legacy.set(k, []);
    legacy.get(k).push(job.key);
  }
  const out = [], replacements = [], redo = [], held = { shipped: 0, cut: 0, noSeam: new Map() };
  for (const fam of readdirSync(MATTE_DIR, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    if (FAMILY && fam.name !== FAMILY) continue;
    const famDir = join(MATTE_DIR, fam.name);
    for (const part of readdirSync(famDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      for (const f of readdirSync(join(famDir, part.name))) {
        if (!f.toLowerCase().endsWith('.png')) continue;
        const id = f.replace(/\.png$/i, '');
        if (shipped.has(id)) { held.shipped++; continue; }   // 母照片出過貨 ⇒ 連它的目標一起不重跑
        if (!consumable.has(fam.name)) { held.noSeam.set(fam.name, (held.noSeam.get(fam.name) || 0) + 1); continue; }
        // 被切開的照片:餵目標、不餵母 matte(母 matte 裡是好幾個物件)
        const units = split.has(id)
          ? split.get(id).filter((t) => t.screen?.v !== 'reject')
              .map((t) => ({ id: t.id, path: join(HOME, t.file) }))
          : (rejected.has(id) ? [] : [{ id, path: join(famDir, part.name, f) }]);
        if (split.has(id)) held.cut += split.get(id).length - units.length;
        for (const u of units) {
          const key = `${fam.name}/${part.name}/${u.id}`;
          if (!existsSync(u.path)) continue;
          // `pid` = **母照片** id(目標是它切出來的)。來源帳記的是照片、而「已出貨」與
          // 「刪除來源圖」兩件事都以母照片為單位 ⇒ 投料帳 MUST 同時帶著兩層,
          // 少了 pid 的話第 ⑦ 站只能去拆檔名(而命名規則只在 split_targets.py 定義一次)。
          const unit = { key, fam: fam.name, part: part.name, id: u.id, pid: id, path: u.path };
          if (!done[key]) {
            const q = legacy.get(`${fam.name}/${part.name}`);
            if (q?.length) replacements.push({ ...unit, replaces: q.shift() });
            else out.push(unit);
          }
          else if (unreviewed.has(id)) redo.push({ ...unit, fedAt: String(done[key]), redo: true });
        }
      }
    }
  }
  // **擋掉幾張 MUST 印出來**(skill「no silent caps」):靜默略過讀起來就是「本輪沒有新的」,
  // 而那正是要修的那個症狀 —— 看起來一切正常,只是某一半沒有輸出。
  if (held.shipped) console.log(`  ·  ${held.shipped} 張已經出貨成節點(來源帳 imgs[].id)⇒ 不重跑`);
  if (held.cut) console.log(`  ·  ${held.cut} 個切出來的目標被選片閘淘汰(太模糊 / 太小 / 完整度太低)`);
  for (const [fam, n] of held.noSeam) console.log(`  ·  ${n} 張屬於 ${fam} 族 ⇒ 沒有 ${fam}.glb 這個消費端(PART_LIBS),生成了也載不進遊戲`);
  // 最早餵過的先重跑(見檔頭 ㋒ 的排序那一段);**接在新的後面**,額度先給沒試過的
  redo.sort((a, b) => a.fedAt.localeCompare(b.fedAt));
  if (redo.length) console.log(`  ·  ${redo.length} 個已餵過但**沒人覆核**的目標排在新圖後面重跑(--no-redo 關掉)`);
  else if (!NO_REDO && !out.length) console.log('  ·  沒有未覆核的可以重跑(每一張都有人看過了)');
  if (replacements.length) console.log(`  ·  ${replacements.length} 個候選優先供 8/15 前舊件逐一替代；新件通過人眼後才撤舊件`);
  return [...replacements, ...out, ...redo];
}


/** matte 目錄裡真的有東西的那幾族(推導;手寫一份清單會在型錄加族時靜默過期)。 */
function screenFams() {
  if (!existsSync(MATTE_DIR)) return [];
  // **與帳本取交集**:matte 目錄裡會留下前幾輪的空殼(實測 `out/matte/bld_tower/` 只剩一張
  // .sheet,那是零件名不是族名)⇒ 直接拿目錄當族名會餵給 screen_mattes 一個不存在的族,
  // 它回傳 1、一張都沒驗,而日誌上只是一行「回傳 1(不中斷整輪)」很容易被讀成雜訊。
  // 合法族名只有帳本知道(型錄加一族時它自己會長出來)⇒ 兩邊都推導,不手寫清單。
  const legit = new Set(loadJson(MANIFEST, []).map((e) => e.family).filter(Boolean));
  return readdirSync(MATTE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && legit.has(d.name)).map((d) => d.name);
}

function corpusFams() {
  const rows = loadJson(MANIFEST, []);
  return [...new Set(rows.filter((row) => row.ok && (!FAMILY || row.family === FAMILY)).map((row) => row.family).filter(Boolean))].sort();
}

/**
 * 投料帳 `<產出目錄>/.feed.json` —— 第 ⑦ 站的入場券(沒有它就不入庫,規則 9)。
 * 兩層 id 都要記:`id` = 母照片(來源帳與「已出貨/黑名單」都以它為單位)、
 * `target` = 這一顆真的吃進去的那張(可能是切出來的目標)。
 */
function writeFeed(dir, pend, gen) {
  const items = pend.map((p, index) => ({
    index, id: p.pid, target: p.id, family: p.fam, part: p.part,
    matte: relative(HOME, p.path).split('\\').join('/'), replaces: p.replaces || null, ...gen,
  }));
  writeFileSync(join(dir, '.feed.json'),
    JSON.stringify({ at: new Date().toISOString(), home: HOME, python, items }, null, 2));
}

async function round(n) {
  const tag = ts();
  console.log(`\n══ 第 ${n}${FOREVER ? "" : `/${ROUNDS}`} 輪(${tag})資料家 ${HOME}`);
  if (!CORPUS.shipping) console.log(`   ⚠ 非出貨語料家:${CORPUS.why || '不進遊戲'}`);
  const rec = { round: n, at: new Date().toISOString(), home: HOME, adopted: 0, fetched: 0, generated: 0 };

  // 非出貨家允許既有本機照片先入「候選帳」，但授權欄維持 unverified，且第 ⑦⑧ 站仍被硬擋。
  if (!CORPUS.shipping) step('限制授權照片編目', process.execPath,
    ['tools/ai3d/index_restricted_photos.mjs', '--home', HOME]);

  // ⓪ 收編 inbox —— 零網路,所以永遠先跑:使用者放進去的圖不必等抓取那一站成不成功
  const a = step('收編 inbox(自己放的圖)', process.execPath,
    ['tools/ai3d/fetch_photos.mjs', '--adopt', '--home', HOME]);
  rec.adopted = Number(a.out?.match(/收編 (\d+) 張/)?.[1] || 0);

  // ① 抓照片。**非出貨語料家不抓**(2026-08-11 實測踩到):型錄補缺是為了餵**出貨**語料庫,
  // 在非出貨家跑它有三個代價,而且三個都沒有錯誤訊息 ——
  //   ㋐ 限流是 **IP 級**的(upload.wikimedia.org 撞 429 之後十分鐘只放 2~3 張)⇒ 它花掉的
  //      是正牌語料庫的額度;
  //   ㋑ 抓下來的是 CC0,卻從此困在一個「不進遊戲」的家裡 —— 它本來是可以出貨的;
  //   ㋒ 兩份語料開始長得一樣,而這個家存在的理由就是「跟正式語料分開」。
  // ⓪ 收編 inbox 照跑(零網路、就是這個家的輸入)。
  const f = step('抓照片', process.execPath,
    ['tools/ai3d/fetch_photos.mjs', '--limit', String(LIMIT), '--home', HOME,
      ...(FAMILY ? ['--family', FAMILY] : [])],
    { skip: CORPUS.shipping ? null : '非出貨語料家不補型錄缺額(限流是 IP 級的,額度留給正式語料庫)', hard: !CORPUS.shipping });
  rec.fetched = Number(f.out?.match(/本輪下載 (\d+) 張/)?.[1] || 0);
  rec.throttled = /限流/.test(f.out || '');

  // ② 去背 / ②b 圈選+分離 / ③ 選片閘
  const noPy = python ? null : `找不到 venv python(${PY})—— 去背/分離/選片/生成四站跳過`;
  const families = FAMILY ? [FAMILY] : corpusFams();
  console.log(`  ·  分類平行 ${CATEGORY_JOBS} 工: ${families.map((f) => `${f}→${routeFor(f).method}`).join('、')}`);
  await mapLimit(families, CATEGORY_JOBS, async (fam) => {
    await stepAsync(`去背 · ${fam}`, python || 'python', ['matte_photos.py', fam, '--home', HOME], { cwd: HERE, skip: noPy });
    // 同一分類內仍嚴格維持 去背 → 分離 → 篩選；不同分類才平行。
    await stepAsync(`圈選 + 分離 · ${fam}`, python || 'python',
      ['split_targets.py', '--sheet', '--home', HOME, '--family', fam], { cwd: HERE, skip: noPy });
    await stepAsync(`選片閘 · ${fam}`, python || 'python',
      ['screen_mattes.py', '--sheet', '--home', HOME, '--family', fam], { cwd: HERE, skip: noPy });
  });

  // ④ img→3D:只餵這一輪新過閘的(紀律 ②③),而且**逐族選模型**(§5n:建築走 T2-spz)
  const done = loadJson(STATE, {});
  const all = pendingMattes(done);
  // 逐族切額度時**順序不能重排**:`pendingMattes` 已經把「新的在前、未覆核重跑的在後」
  // 排好了(使用者定案的順位),這裡再 sort 一次就等於把那個順位丟掉
  const gpuFams = new Set(gpuFamilies(families));
  const dataFams = dataFamilies(families);
  if (dataFams.length) console.log(`  ·  ${dataFams.join('、')} 走 Route A 純資料零件；保留照片供零件台/人工寫表，不送 GPU`);
  const t2Pend = all.filter((p) => gpuFams.has(p.fam) && T2_FAMS.has(p.fam)).slice(0, T2_LIMIT);
  const hyPend = all.filter((p) => routeFor(p.fam).method === 'hunyuan_2gp').slice(0, GEN_LIMIT);
  const sfPend = all.filter((p) => gpuFams.has(p.fam)
    && !T2_FAMS.has(p.fam) && routeFor(p.fam).method !== 'hunyuan_2gp').slice(0, GEN_LIMIT);
  rec.redone = [...hyPend, ...sfPend, ...t2Pend].filter((p) => p.redo).length;
  const outDir = join(HOME, 'out', 'sf3d_auto', tag);
  const hyDir = join(HOME, 'out', 'hunyuan_auto', tag);
  const t2Dir = join(HOME, 'out', 't2_auto', tag);
  const feedDir = join(t2Dir, 'feed');

  // ④-a Hunyuan3D-2GP shape-only(巨岩)。paint stage 永不跑；沒有 adapter 時保留候選，
  // 不暗中改用 SF3D 產出「新版」來替代舊件。
  const hySkip = NO_GEN ? '--no-gen'
    : (hunyuanReady ? null : `沒給 --hunyuan adapter 或路徑不對(${HUNYUAN || '未指定'})⇒ 巨岩本輪不生成`)
    || (hyPend.length ? null : '沒有新的巨岩 matte 要跑');
  if (!hySkip && !DRY) mkdirSync(hyDir, { recursive: true });
  const hyIsPy = /\.py$/i.test(HUNYUAN || '');
  const hy = step(`img→3D · Hunyuan3D-2GP(${hyPend.length} 張)`, hyIsPy ? (python || 'python') : (HUNYUAN || 'hunyuan-adapter'),
    [...(hyIsPy ? [HUNYUAN] : []), ...hyPend.map((p) => p.path), '--output-dir', hyDir], { skip: hySkip });
  const hyMade = !hySkip && !DRY && hy.ok;
  if (hyMade) {
    for (const p of hyPend) done[p.key] = tag;
    rec.generated += hyPend.length;
    rec.hunyuanDir = relative(HOME, hyDir).split('\\').join('/');
    writeFeed(hyDir, hyPend, {
      tool: 'hunyuan_2gp', runner: `${HUNYUAN} — ${hyIsPy ? python : 'executable adapter'}`,
      params: 'shape-only; no paint; adapter contract v1',
    });
  }

  // ④-b SF3D(雕塑樹)。規則人造物已走 Route A，巨岩由 Hunyuan 主路由處理。
  const genSkip = NO_GEN ? '--no-gen'
    : noPy || (existsSync(SF3D) ? null : `找不到 SF3D(${SF3D})`)
    || (sfPend.length ? null : '沒有新的 matte 要跑');
  if (!genSkip && !DRY) mkdirSync(outDir, { recursive: true });
  const g = step(`img→3D · SF3D(${sfPend.length} 張)`, python || 'python',
    [SF3D, ...sfPend.map((p) => p.path), '--output-dir', outDir,
      '--texture-resolution', '512', '--remesh_option', 'triangle', '--target_vertex_count', '520'],
    { skip: genSkip });
  const sfMade = !genSkip && !DRY && g.ok;
  if (sfMade) {
    for (const p of sfPend) done[p.key] = tag;
    rec.generated += sfPend.length;
    rec.outDir = relative(HOME, outDir).split('\\').join('/');
    // **投料帳**:index → 哪一張圖。SF3D 的輸出目錄是 `<i>/mesh.glb`,而 `i` 就是**投料順序**
    // —— 這份對應只有生成當下知道,事後從檔名回推不出來。tri_budget 的 resample_2026_08_08
    // 記著這個洞的代價:出貨的 chimney_a/ac_a 因為沒記「哪個輸出目錄的第幾顆」而**復現不出**
    // (同一張照片配同一組參數得到的是另一顆網格,黏土剪影明顯不同)。第 ⑦ 站沒有這一份就不入庫。
    writeFeed(outDir, sfPend, {
      tool: 'sf3d',
      runner: `${SF3D} — ${python}`,
      params: '--texture-resolution 512 --remesh_option triangle --target_vertex_count 520',
    });
  }

  // ④-c T2-spz(建築)。餵入 MUST 先二值化 —— T2 的 preprocess 以 alpha>204 取 bbox,
  // 軟 alpha 的漸層段會被整段裁掉(§5n「同一張 matte ≠ 同一個輸入」,hoodoo 基座變石板的成因)。
  // 沒給 `--t2` 就**不生成**而不是退回 SF3D:後者對建築是量出來比較差的那一條(§5n 雙 ◎ vs 歪塊),
  // 悄悄退回去只會讓語料庫多幾顆一樣要重生成的節點。
  const t2Skip = NO_GEN ? '--no-gen'
    : (t2Ready ? null : `沒給 --t2 或路徑不對(${T2_HOME || '未指定'})⇒ 建築這一族本輪不生成`)
    || (t2Pend.length ? null : '沒有新的建築 matte 要跑');
  if (!t2Skip && !DRY) mkdirSync(feedDir, { recursive: true });
  const bin = step(`二值化餵入(${t2Pend.length} 張)`, T2_PY || 'python',
    [T2_BIN, ...t2Pend.map((p) => p.path), '--out', feedDir],
    { skip: t2Skip, cwd: T2_HOME || ROOT });
  const t2 = step(`img→3D · T2-spz(${t2Pend.length} 張)`, T2_PY || 'python',
    [T2_GATE, ...t2Pend.map((p) => join(feedDir, `${p.key.split('/').pop()}.png`)), '--out', t2Dir],
    { skip: t2Skip || (bin.ok ? null : '二值化沒成功'), cwd: T2_HOME || ROOT });
  const t2Made = !t2Skip && !DRY && t2.ok;
  if (t2Made) {
    for (const p of t2Pend) done[p.key] = tag;
    rec.generated += t2Pend.length;
    rec.t2Dir = relative(HOME, t2Dir).split('\\').join('/');
    // T2 的版面是扁平 `<目標 id>.glb` ⇒ 對應看檔名就有,但**母照片 id 仍然只有這裡知道**
    writeFeed(t2Dir, t2Pend, { tool: 'trellis2_spz', runner: `${T2_GATE} — ${T2_PY}`, params: 'run_t2_gate.py(預設)' });
  }
  if (!DRY) writeFileSync(STATE, JSON.stringify(done, null, 2));


  // ⑤ 實心度快篩 —— **只對 SF3D 那一路**。門檻(fill ≥ 0.22 / 0.10)是拿 SF3D 產出校準的,
  // 而 T2-spz 的原始輸出**本來就是雙層撕裂薄殼**(provenance METHODS 那一條:必須先過
  // solidify_parts.py 才進 normalize;實測 48k 面 / 6k 開放邊 / 200 元件)⇒ 同一把尺量下去
  // 會把每一顆建築都判成「殼/碎片 ✗」,而那是尺用錯了不是東西壞了(skill:門檻內建形狀假設)。
  const noOut = sfMade ? null : '這一輪 SF3D 沒有新產出';
  step('實心度快篩', process.execPath, ['tools/ai3d/mesh_stats.mjs', outDir], { skip: noOut });

  // ⑥ contact sheet —— **兩路都要**。黏土縮圖與形狀假設無關,而它正是「人眼那一步」的輸入:
  // 少了 T2 這一半,建築族從頭到尾沒有任何一張圖可以看(症狀只會表現成「產出率好像很低」)。
  step('contact sheet · SF3D', process.execPath, ['tools/ai3d/mesh_sheet.mjs', outDir], { skip: noOut });
  step('contact sheet · Hunyuan', process.execPath, ['tools/ai3d/mesh_sheet.mjs', hyDir],
    { skip: hyMade ? null : '這一輪 Hunyuan 沒有新產出' });
  step('contact sheet · T2', process.execPath, ['tools/ai3d/mesh_sheet.mjs', t2Dir],
    { skip: t2Made ? null : '這一輪 T2 沒有新產出' });

  // ⑦⑧ 自動入庫 + 收尾稽核(2026-08-10;`--no-intake` 退回舊行為)。**逐批各跑一次** ——
  // 兩批的投料帳分開,而第 ⑦ 站的入場券就是投料帳。收尾稽核由 `--gate-full` 在該支裡跑完,
  // 紅字它自己整批回滾(逐位元)⇒ 這裡只要把回報記進本輪的帳。
  rec.intake = 0; rec.rolledBack = 0;
  for (const [label, dir, skip] of [
    ['Hunyuan', hyDir, hyMade ? null : '這一輪 Hunyuan 沒有新產出'],
    ['SF3D', outDir, noOut], ['T2', t2Dir, t2Made ? null : '這一輪 T2 沒有新產出'],
  ]) {
    const s = NO_INTAKE
      ? (CORPUS.shipping ? '--no-intake' : `非出貨語料家(corpus.json shipping:false)⇒ 停在 contact sheet,不進遊戲`)
      : skip;
    const r = step(`自動入庫 · ${label}`, process.execPath,
      ['tools/ai3d/auto_intake.mjs', '--src', dir, '--home', HOME,
        '--limit', String(INTAKE_LIMIT), '--gate-full'], { skip: s, hard: NO_INTAKE });
    if (r.out) {
      rec.intake += Number(r.out.match(/自動入庫:收 (\d+) 顆/)?.[1] || 0);
      if (/整輪回滾/.test(r.out)) { rec.rolledBack += 1; rec.intake = 0; }
    }
  }

  if (!DRY) appendFileSync(LOG, `${JSON.stringify(rec)}\n`);
  console.log(`  ── 本輪:收編 ${rec.adopted}・下載 ${rec.fetched}・生成 ${rec.generated}`
    + `${rec.generated && rec.redone ? `(其中 ${rec.redone} 顆是未覆核重跑)` : ''}`
    + `・入庫 ${rec.intake}${rec.rolledBack ? `(回滾 ${rec.rolledBack} 批)` : ''}`
    + `${rec.throttled ? '(撞到來源限流)' : ''}`);
  return rec;
}

async function main() {
  if (!existsSync(join(HOME, 'photos')) && !existsSync(join(HOME, 'inbox'))) {
    console.warn(`⚠ ${HOME} 底下既沒有 photos/ 也沒有 inbox/ —— `
      + '資料家給錯了嗎?(--home;見 fetch_photos.mjs 檔頭「語料家會搬」那一條)');
  }
  const all = [];
  for (let i = 1; FOREVER || i <= ROUNDS; i++) {
    all.push(await round(i));
    if ((FOREVER || i < ROUNDS) && !DRY) {
      console.log(`\n… 等 ${EVERY_MIN} 分鐘再跑下一輪(來源限流以十分鐘計;調短不會更快)`);
      await sleep(EVERY_MIN * 60_000);
    }
  }
  const sum = (k) => all.reduce((a, r) => a + (r[k] || 0), 0);
  console.log(`\n🎯 ${all.length} 輪合計:收編 ${sum('adopted')}・下載 ${sum('fetched')}・生成 ${sum('generated')}`
    + `・入庫 ${sum('intake')}`);
  console.log(`   紀錄 ${LOG}`);
  if (NO_INTAKE && !CORPUS.shipping) {
    console.log('   下一步(非出貨語料家:停在 contact sheet,刻意不進第 ⑦⑧ 站):');
    console.log(`     npm run parts -- --photos ${HOME} —— 在零件台上跟其他版本並排比較`);
  } else if (NO_INTAKE) {
    console.log('   下一步(--no-intake:停在 contact sheet):挑幾顆 → normalize_parts.py → intake_parts.mjs → npm run parts');
  } else {
    console.log('   下一步(人眼那一步沒有省掉,是換到入庫之後):');
    console.log('     ① npm run parts —— 逐顆覆核,判 ✔ / ⟳ 重生 / ⇄ 換來源圖 / ✕ 刪除來源圖');
    console.log(`     ② node tools/ai3d/apply_verdicts.mjs --home ${HOME} —— 把判決執行掉`);
    console.log('     ③ 通過的那幾顆才 commit(**這一支從不 commit** —— 沒 commit 就是還沒出貨)');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
