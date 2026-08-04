#!/usr/bin/env node
/**
 * 2D 圖片生成驅動(docs/ai3d_asset_plan.md §5)
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
 *   node tools/ai3d/gen2d.mjs --no-ref               無參考圖模式(agy 沒有 read_file 權限時)
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { workList, missingMasters, masterPath, mastersOf, REPO, KIND_ORDER, auditCoverage } from './slots.mjs';
import { masterPrompt, slotPrompt, slotPromptNoRef, auditLexicon } from './prompt.mjs';
import { CHARACTERS } from '../../public/js/data.js';

const CH_KIND = Object.fromEntries(Object.entries(CHARACTERS).map(([id, c]) => [id, c.kind]));

const OUT = join(REPO, 'tools', 'ai3d');
const DRAFTS = join(OUT, 'drafts');
const NEW_MASTERS = join(OUT, 'masters');
const MANIFEST = join(OUT, 'gen_manifest.json');
const BRAIN = join(homedir(), '.gemini', 'antigravity-cli', 'brain');
const AGY_TIMEOUT_MS = 6 * 60 * 1000;

const argv = process.argv.slice(2);
const flag = n => argv.includes(`--${n}`);
const val = n => { const i = argv.indexOf(`--${n}`); return i < 0 ? null : argv[i + 1]; };

const OPT = {
  plan: flag('plan'), masters: flag('masters'), noRef: flag('no-ref'),
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
    // 順序 MUST 吃 §5.0.1(機甲 → 無人機 → 變形者):額度有限 ⇒ 先畫的那批才是先交付的
    // 里程碑,照 CHARACTERS 宣告序畫等於把額度花在最難的變形者上。
    const rank = ch => KIND_ORDER.indexOf(CH_KIND[ch]);
    const need = missingMasters().sort((a, b) => rank(a.ch) - rank(b.ch));
    const chs = [...new Set(need.map(m => m.ch))];
    for (const ch of chs) {
      if (OPT.only && ch !== OPT.only) continue;
      // 變形者:地面/飛行**成對**送 —— 只缺一張也兩張一起重畫(§5.0.1 MUST 3)。
      // 跳過已存在的那張 = 飛行稿接不到地面稿那段對話,剪影必分家;多畫一張是這條
      // MUST 的價錢,不是浪費。
      const all = mastersOf(ch);
      const pair = all.length > 1;
      all.forEach((master, i) => {
        const form = master.includes('_ground_') ? 'ground' : master.includes('_flight_') ? 'flight' : null;
        jobs.push({ id: master, ch, kind: 'master', out: join(NEW_MASTERS, `${master}.jpg`),
          prompt: masterPrompt(ch, form), cont: pair && i > 0, pair, force: pair });
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
    const ref = refs.find(m => m.includes('_ground_')) || refs[0] || null;
    const refFile = ref ? refOf(ref) : null;
    for (const s of w.slots) {
      jobs.push({ id: `${w.ch}/${s.slot}`, ch: w.ch, kind: 'slot', slot: s.slot,
        mirror: !!s.mirror, ref: ref || null,
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
  const cov = auditCoverage(), lex = auditLexicon();
  if (cov.length || lex.length) {
    console.log('❌ 稽核未通過,先修好再畫(否則畫出來的東西掛不上去):');
    for (const p of [...cov, ...lex]) console.log('  ' + p);
    process.exit(1);
  }
  if (flag('audit')) { console.log('✅ rig 節點涵蓋 + 描述子詞表 兩支稽核通過'); process.exit(0); }
}

const jobs = buildJobs();
const man = loadManifest();

if (OPT.plan) {
  const todo = jobs.filter(j => !existsSync(j.out));
  console.log(`工作項 ${jobs.length} 張,已完成 ${jobs.length - todo.length},待畫 ${todo.length}`);
  const noRef = todo.filter(j => j.needsRef);
  if (noRef.length) console.log(`⚠ 其中 ${noRef.length} 張沒有設定稿可當參考(先跑 --masters)`);
  for (const j of todo.slice(0, 400)) console.log('  ' + j.id + (j.mirror ? '  (鏡射件,只畫左)' : '') + (j.needsRef ? '  ⚠無參考圖' : ''));
  process.exit(0);
}

let done = 0, ok = 0, fail = 0;
for (const j of jobs) {
  if (done >= OPT.limit) break;
  // 成對工作項(變形者雙型態)只在**兩張都已存在**時才跳過
  const pairDone = j.pair && mastersOf(j.ch).every(m => existsSync(join(NEW_MASTERS, `${m}.jpg`)));
  // `--redo s10` = 整隻(變形者則兩型態一起,才會在同一段對話裡重畫);
  // `--redo s10_ground_static` / `--redo t01/leg` = 只那一張。
  const forced = OPT.redo && (OPT.redo === j.id || OPT.redo === j.ch);
  if ((j.pair ? pairDone : existsSync(j.out)) && !forced) continue;
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
  console.log(`✓ ${(bytes / 1024).toFixed(0)}KB → ${j.out.replace(REPO + '\\', '').replace(REPO + '/', '')}`);
  man.generated = man.generated.filter(g => g.id !== j.id);
  man.generated.push({ id: j.id, ch: j.ch, kind: j.kind, slot: j.slot ?? null,
    ref: j.ref ?? null, mirror: !!j.mirror, out: j.out, src: file, bytes,
    format: 'jpeg (agy generate_image 只出 JPEG)', at: new Date().toISOString(), prompt: j.prompt });
  saveManifest(man);
}

console.log(`\n本輪:嘗試 ${done},成功 ${ok},失敗 ${fail}。`);
console.log(`帳本:${MANIFEST}`);
if (fail) console.log('失敗多半是額度用盡(§5.0 ⚠)—— 直接重跑,已完成的會自動跳過。');
