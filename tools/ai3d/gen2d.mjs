#!/usr/bin/env node
/**
 * 2D 圖片生成驅動(docs/ai3d_runbook.md §0.5)
 *
 * 路線 A:`agy --print`(Antigravity 內建 Nano Banana Pro,訂閱額度、無 API key)。
 *
 * 三條紀律:
 *   ① **可續跑**:產出存在就跳過。額度耗盡是常態(§5.0 ⚠),不是例外 —— 中斷後重跑
 *      MUST 只補沒畫的那幾張,MUST NOT 從頭重畫(重畫 = 把額度花在已完成的東西上)。
 *   ② **記帳**:每一張都寫進 gen_manifest.json(prompt / 來源 / 時間 / 位元組數)。
 *      重畫哪幾張、為什麼重畫,查得回來。
 *   ③ **降級不例外**(原則 6):agy 沒吐圖就記 fail 繼續下一張,MUST NOT 中止整批。
 *
 * ⚠ 輸出格式:agy 的 generate_image **只出 JPEG**(已實測,要求 PNG 也一樣出 jpg)。
 *    這裡刻意保留 .jpg 副檔名 —— 轉成 .png 只是把 JPEG 壓縮雜訊包進無損容器,
 *    反而讓 §5.3 的 matte 步驟誤以為邊緣是乾淨的。alpha 邊緣 MUST 在去背後額外目視檢查。
 *
 * 用法:
 *   node tools/ai3d/gen2d.mjs --plan                 只印工作清單(不呼叫 agy)
 *   node tools/ai3d/gen2d.mjs --masters              畫缺漏的設定稿
 *   node tools/ai3d/gen2d.mjs --kind robot           畫某機種的切圖(§5.0.1 順序)
 *   node tools/ai3d/gen2d.mjs --only t01             單一角色
 *   node tools/ai3d/gen2d.mjs --limit 5              本輪最多幾張(批次 ≤5,§6)
 *   node tools/ai3d/gen2d.mjs --redo t01/leg         強制重畫某一張
 *   node tools/ai3d/gen2d.mjs --no-ref               切圖:無參考圖模式(agy 沒有 read_file 權限時)
 *   node tools/ai3d/gen2d.mjs --masters --ref        設定稿:改用參考圖當設計錨(需 agy 真的讀得到檔;
 *                                                    1.1.10 實測讀不到 —— 見 buildJobs 的 anchor 那一段)
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import {
  workList, masterQueue, refShotOf, masterPath, mastersOf, starOf, REPO,
  auditCoverage, auditQueue, auditStars,
} from './slots.mjs';
import { masterPrompt, slotPrompt, slotPromptNoRef, auditLexicon } from './prompt.mjs';
import { SHOT_POSE_KEYS as SHOT_ORDER } from '../../public/js/codex.js';

const OUT = join(REPO, 'tools', 'ai3d');
const DRAFTS = join(OUT, 'drafts');
const NEW_MASTERS = join(OUT, 'masters');
const MANIFEST = join(OUT, 'gen_manifest.json');
const BRAIN = join(homedir(), '.gemini', 'antigravity-cli', 'brain');
const AGY_TIMEOUT_MS = 6 * 60 * 1000;

/** 產出路徑一律以儲存庫根為基準記帳(印在畫面上的也是同一份) */
const relOut = p => p.replace(REPO + '\\', '').replace(REPO + '/', '').replace(/\\/g, '/');

const argv = process.argv.slice(2);
const flag = n => argv.includes(`--${n}`);
const val = n => { const i = argv.indexOf(`--${n}`); return i < 0 ? null : argv[i + 1]; };

const OPT = {
  plan: flag('plan'), masters: flag('masters'), noRef: flag('no-ref'), ref: flag('ref'),
  kind: val('kind'), only: val('only'), redo: val('redo'),
  limit: val('limit') ? Number(val('limit')) : Infinity,
};

// ── 記帳 ──────────────────────────────────────────────────────────────
function loadManifest() {
  if (!existsSync(MANIFEST)) return { generated: [], failed: [] };
  try { return JSON.parse(readFileSync(MANIFEST, 'utf8')); }
  catch { return { generated: [], failed: [] }; }
}
function saveManifest(m) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n');
}

// ── agy 呼叫 ──────────────────────────────────────────────────────────
/** 呼叫前先記錄 brain 目錄現況,呼叫後取「新出現且最新」的圖檔。 */
function brainSnapshot() {
  const seen = new Set();
  if (!existsSync(BRAIN)) return seen;
  for (const d of readdirSync(BRAIN)) {
    const sub = join(BRAIN, d);
    try { for (const f of readdirSync(sub)) seen.add(join(sub, f)); } catch { /* 非目錄 */ }
  }
  return seen;
}
function newestNew(before) {
  let best = null, bestT = 0;
  if (!existsSync(BRAIN)) return null;
  for (const d of readdirSync(BRAIN)) {
    const sub = join(BRAIN, d);
    let files; try { files = readdirSync(sub); } catch { continue; }
    for (const f of files) {
      const p = join(sub, f);
      if (before.has(p) || !/\.(jpe?g|png|webp)$/i.test(f)) continue;
      const t = statSync(p).mtimeMs;
      if (t > bestT) { best = p; bestT = t; }
    }
  }
  return best;
}

/**
 * cont=true ⇒ 接續上一段對話(`agy -c`)。
 * 變形者的地面/飛行設定稿 MUST 在**同一段對話**裡畫(§5.0.1 MUST 3)——
 * 分兩次呼叫 = 兩個獨立的想像,剪影會分家,而分家的症狀要到 P4c 拿零件去對飛行型態
 * 才看得出來「這兩張根本不是同一台機器」。
 */
function runAgy(prompt, cont = false) {
  const before = brainSnapshot();
  let stdout = '';
  try {
    stdout = execFileSync('agy', cont ? ['-c', '--print', prompt] : ['--print', prompt],
      { encoding: 'utf8', timeout: AGY_TIMEOUT_MS, maxBuffer: 8 << 20, cwd: REPO });
  } catch (e) {
    stdout = String(e.stdout || '') + String(e.stderr || e.message || '');
  }
  return { file: newestNew(before), stdout: stdout.trim().slice(0, 600) };
}

// ── 工作項 ────────────────────────────────────────────────────────────
function buildJobs() {
  const jobs = [];
  if (OPT.masters) {
    // 順序 = **覆核優先序**(slots.mjs `masterQueue()` 單一縫;2026-08-05 使用者定案):
    // 通過數少的先畫、0 通過的最前面。舊制只排「機甲 → 無人機 → 變形者」而且只看檔案在不在
    // ⇒ 被覆核退回的設定稿一張都排不進來(那條線是斷的,見 slots.mjs 同一段)。
    // 機種序退居同分時的次要鍵,仍在 masterQueue 裡吃 §5.0.1。
    for (const q of masterQueue()) {
      if (OPT.only && q.ch !== OPT.only) continue;
      // 設計錨(`refShotOf` 單一縫:已通過的優先,其次是前一輪剛畫、還在等覆核的那張)。
      // 有錨 ⇒ 每一張都對著它畫;**沒有錨 ⇒ 整台機體的待畫張數串在同一段對話裡**(agy -c),
      // 由第一張定案設計。兩條路的目的是同一個:同一台機器的每一張圖都不該各想像各的
      // (覆核意見「機體仿照移動那張的外觀重繪此動作」出現了六次)。
      // §5.0.1 MUST 3(變形者地面/飛行必須同一段對話)是這一條的特例,自動被涵蓋。
      // ⚠ 參考圖預設**關閉**(`--ref` 才開)。agy 1.1.10 的 headless 模式下,
      // README 記載的 `permissions.allow: ["read_file(…)"]` 規則**已不生效**(逐一實測過
      // 反斜線 glob / 正斜線 glob / 絕對檔名 / `*…*` 四種寫法,一律仍回
      // 「auto-denied」);唯一有效的是 `--dangerously-skip-permissions`,而那會連
      // edit_file 與 command 一起放行 —— 讓一個 headless agent 拿到儲存庫的寫入與執行權,
      // 為了一張參考圖不值得。**沒有參考圖不是災難**:設計敘述(mecha.js 的
      // sil/mass/mat/parts/note)本來就是設計的權威,實測 s07_heavy 是在讀檔被拒的情況下
      // 生出來的,仍與 s07_static 是同一台機器。取不到就走同一段對話串接(原則 6:降級不例外)。
      const anchor = OPT.ref ? refShotOf(q.ch, null) : null;
      const shots = q.need.slice().sort((a, b) =>
        // 地面型先(關節樞軸最清楚,是飛行型的錨)、靜止先(它是另外兩張的錨)
        (a.form === 'flight') - (b.form === 'flight')
        || SHOT_ORDER.indexOf(a.pose) - SHOT_ORDER.indexOf(b.pose));
      shots.forEach((s, i) => {
        jobs.push({
          id: s.slot, ch: q.ch, kind: 'master', form: s.form, pose: s.pose,
          out: join(NEW_MASTERS, `${s.slot}.jpg`),
          ref: anchor ? `${anchor.slot}${anchor.tier === 2 ? '(未驗收)' : ''}` : null,
          prompt: masterPrompt(q.ch, s.form, s.pose, anchor?.path ?? null),
          cont: !anchor && i > 0,
        });
      });
    }
    return jobs;
  }
  for (const w of workList()) {
    if (OPT.kind && w.kind !== OPT.kind) continue;
    if (OPT.only && w.ch !== OPT.only) continue;
    // 參考圖兩個來源:已入庫的 public/assets/…/*.png,以及本管線剛畫、**尚未經人工驗收**
    // 的 tools/ai3d/masters/*.jpg。後者不收的話,剛補畫的 t10/t12/m02/m06 會被判成
    // 「沒有設定稿」而整批跳過 —— 而那正是 P4a 的主線。
    // 變形者一律取**地面型態**當參考(§5.0.1 MUST 2:關節樞軸在地面姿勢最清楚)。
    const refOf = m => {
      const inRepo = masterPath(m);
      if (existsSync(inRepo)) return inRepo;
      const fresh = join(NEW_MASTERS, `${m}.jpg`);
      return existsSync(fresh) ? fresh : null;
    };
    const refs = mastersOf(w.ch).filter(refOf);
    // ★ 星號優先(2026-08-05 使用者定案:「img to 3D 時如果外觀有衝突,以星號圖片為主」)。
    // 切圖就是 image→3D 的輸入,而它只吃**一張**參考圖 ⇒ 這裡就是「外觀衝突」唯一被解決的地方。
    // 舊規則(地面型設定稿)是一條幾何規則,退居星號之後:同一台機體的三種動作 × 兩種型態
    // 不會完全一樣,誰才是那台機器只有人看得出來。星號解析不到檔案 ⇒ 回 null ⇒ 逐位元走舊規則
    // (`starOf` 檔頭;那種情況由 `auditStars()` 紅字,不靠這裡沉默吸收)。
    const star = starOf(w.ch);
    const ref = star ? star.slot : (refs.find(m => m.includes('_ground_')) || refs[0] || null);
    const refFile = star ? star.path : (ref ? refOf(ref) : null);
    for (const s of w.slots) {
      jobs.push({ id: `${w.ch}/${s.slot}`, ch: w.ch, kind: 'slot', slot: s.slot,
        mirror: !!s.mirror, ref: ref || null, star: !!star,
        out: join(DRAFTS, w.ch, `${s.slot}.jpg`),
        prompt: (!OPT.noRef && refFile) ? slotPrompt(w.ch, s, refFile) : slotPromptNoRef(w.ch, s),
        needsRef: !refFile });
    }
  }
  return jobs;
}

// ── 主流程 ────────────────────────────────────────────────────────────
// 兩支稽核**每次執行都跑**:它們紅字代表提示詞是錯的(槽位漏畫 / 原始代碼漏進提示詞),
// 那種錯要到組裝完或看圖才發現,而那時額度已經花掉了。
{
  const cov = auditCoverage(), lex = auditLexicon(), qq = auditQueue(), st = auditStars();
  // 佇列的警告(0 通過但還沒被判退)只印出來不擋:那是「還沒覆核到」而不是壞掉
  const warn = qq.filter(p => p.startsWith('⚠')), qbad = qq.filter(p => !p.startsWith('⚠'));
  if (cov.length || lex.length || qbad.length || st.length) {
    console.log('❌ 稽核未通過,先修好再畫(否則畫出來的東西掛不上去):');
    for (const p of [...cov, ...lex, ...qbad, ...st]) console.log('  ' + p);
    process.exit(1);
  }
  for (const p of warn) console.log(p);
  if (flag('audit')) { console.log('✅ rig 節點涵蓋 + 描述子詞表 + 補圖優先序 + ★ 外觀權威 四支稽核通過'); process.exit(0); }
}

const jobs = buildJobs();
const man = loadManifest();

if (OPT.plan) {
  const todo = jobs.filter(j => !existsSync(j.out));
  console.log(`工作項 ${jobs.length} 張,已完成 ${jobs.length - todo.length},待畫 ${todo.length}`);
  const noRef = todo.filter(j => j.needsRef);
  if (noRef.length) console.log(`⚠ 其中 ${noRef.length} 張沒有設定稿可當參考(先跑 --masters)`);
  // ★ 標出來:哪幾張是照使用者指定的那一張畫的、哪幾張仍走舊規則,在下筆之前就要看得見
  for (const j of todo.slice(0, 400)) console.log('  ' + j.id + (j.mirror ? '  (鏡射件,只畫左)' : '')
    + (j.star ? `  ★${j.ref}` : '') + (j.needsRef ? '  ⚠無參考圖' : ''));
  process.exit(0);
}

let done = 0, ok = 0, fail = 0;
for (const j of jobs) {
  if (done >= OPT.limit) break;
  // `--redo s10` = 整隻(所有姿態一起,才會在同一段對話裡重畫);
  // `--redo s10_ground_static` / `--redo t01/leg` = 只那一張。
  const forced = OPT.redo && (OPT.redo === j.id || OPT.redo === j.ch);
  // 已經畫出來的不重畫(續跑紀律 ①)。設定稿那條線 `reviewUnits` 已經先濾過一次,
  // 這裡是切圖與 `--redo` 共用的最後一道
  if (existsSync(j.out) && !forced) continue;
  if (j.needsRef && !OPT.noRef) { console.log(`skip ${j.id}(缺設定稿;先跑 --masters,或加 --no-ref)`); continue; }

  done++;
  process.stdout.write(`[${done}] ${j.id} … `);
  const { file, stdout } = runAgy(j.prompt, !!j.cont);
  if (!file) {
    fail++;
    console.log('✗ 沒有產出');
    console.log('    agy: ' + stdout.replace(/\n/g, '\n    '));
    man.failed.push({ id: j.id, at: new Date().toISOString(), note: stdout.slice(0, 300) });
    saveManifest(man);
    continue;
  }
  mkdirSync(dirname(j.out), { recursive: true });
  copyFileSync(file, j.out);
  ok++;
  const bytes = statSync(j.out).size;
  console.log(`✓ ${(bytes / 1024).toFixed(0)}KB → ${relOut(j.out)}`);
  man.generated = man.generated.filter(g => g.id !== j.id);
  // `out` 記**相對於儲存庫根**:絕對路徑會把帳本綁死在產出當下那個 worktree 上,
  // 而 worktree 一收掉,帳本裡每一筆的路徑就全部指向不存在的地方(2026-08-04 實例)。
  man.generated.push({ id: j.id, ch: j.ch, kind: j.kind, slot: j.slot ?? null,
    form: j.form ?? null, pose: j.pose ?? null,
    // `star` = 這張的參考圖是使用者指定的外觀權威(而不是舊規則挑的地面型設定稿)。
    // 查得回來才知道某一批切圖是照哪一版外觀畫的
    ref: j.ref ?? null, star: !!j.star, mirror: !!j.mirror, out: relOut(j.out), src: file, bytes,
    format: 'jpeg (agy generate_image 只出 JPEG)', at: new Date().toISOString(), prompt: j.prompt });
  saveManifest(man);
}

console.log(`\n本輪:嘗試 ${done},成功 ${ok},失敗 ${fail}。`);
console.log(`帳本:${MANIFEST}`);
if (fail) console.log('失敗多半是額度用盡(§5.0 ⚠)—— 直接重跑,已完成的會自動跳過。');
