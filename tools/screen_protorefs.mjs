// ============ 原型參考照的構圖篩選(全身 + 背景乾淨;dev-only)============
// 2026-08-13 使用者:「必須搜索全身照,盡可能背景乾淨,現有的照片不符合條件的也重新搜索」。
//
// 分工:**量在 Python(`screen_protorefs.py`,PIL)、判與寫帳本在這裡**。
// Node 端沒有影像解碼而本專案零 npm 依賴(A2)⇒ 像素的事只能交給 PIL;而帳本的形狀只准有
// 一份(refstore.mjs 檔頭)⇒ Python 那邊 MUST NOT 自己寫 manifest,否則兩邊遲早對不上,
// 症狀是「我明明判退了,採集端還是抓回同一張」。
//
// 判準三條(`SCREEN`;都刻意保守 —— 寧可留下讓人看,也不要靜靜丟掉好圖):
//   bg_clean  邊框環落在主背景色容差內的比例 ≥ BG_MIN     ← 「背景乾淨」
//   coverage  主體佔畫面比例 ∈ [COV_MIN, COV_MAX]          ← 太小 = 一點點;太大 = 特寫
//   edge_touch 主體壓在邊框的比例 ≤ TOUCH_MAX              ← 壓邊 = 被裁掉 = 看不到全身
// 「全身」沒有辨識器也量得出來的部分就是這三項的組合:主體整個在框內、四周留白、背景單純。
// 真正的「這是不是整隻/整架」需要模型,那是另一回事 —— 這裡不假裝做得到(取名 `framed`)。
//
// 沒有 Python/PIL ⇒ **降級成不篩**(回 null),MUST NOT 把整批圖當成不合格(原則 6)。
//
// 跑法:
//   node tools/screen_protorefs.mjs                 # 重新打分現有全部,只印報告
//   node tools/screen_protorefs.mjs --annotate      # 逐張把不合格的理由寫成註解(**不刪圖**)
//   node tools/screen_protorefs.mjs --apply         # 判退(刪檔 + 進黑名單 + 記註解)
//   node tools/screen_protorefs.mjs --key t01 --apply
//
// `--annotate` 與 `--apply` 的差別是**現在補不補得到替代品**:判退會把圖刪掉,而這些層
// 一旦刪光又抓不到新的(圖庫限流/還沒接 Google 金鑰),看板上就是一片空 —— 比留著不合格
// 的圖還糟。所以預設是「標出來給人看」,真的能重搜時才 `--apply`。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './audit_src.mjs';
import {
  REFS_DIR, loadManifest, saveManifest, safeKey, rejectImg, retune, annotate,
} from './humanoid_forge/refstore.mjs';

/** 構圖門檻(唯一縫:採集端的即時篩選與這支的重新打分同吃一份) */
export const SCREEN = {
  BG_MIN: 0.55,      // 邊框環有 55% 以上落在同一個背景色 ⇒ 算「乾淨」
  COV_MIN: 0.03,     // 主體至少要佔 3%(再小就是一個點)
  COV_MAX: 0.85,     // 超過 85% 幾乎貼滿畫面 ⇒ 多半是特寫
  TOUCH_MAX: 0.10,   // 主體壓邊超過 10% ⇒ 被裁掉了
  BATCH: 40,         // 一次餵給 python 幾個路徑(Windows 的命令列長度有上限)
};

/** 這一張過不過;回 { ok, why[] } —— 理由要逐條留著,判退時要寫進帳本給下一輪看 */
export function verdict(m) {
  const why = [];
  if (m.error) return { ok: false, why: [`讀不到(${m.error})`] };
  if (m.bg_clean < SCREEN.BG_MIN) why.push(`背景雜(乾淨度 ${m.bg_clean.toFixed(2)} < ${SCREEN.BG_MIN}）`);
  if (m.coverage > SCREEN.COV_MAX) why.push(`像特寫(主體佔 ${(m.coverage * 100).toFixed(0)}%）`);
  if (m.coverage < SCREEN.COV_MIN) why.push(`主體太小(佔 ${(m.coverage * 100).toFixed(1)}%）`);
  if (m.edge_touch > SCREEN.TOUCH_MAX) why.push(`主體壓邊(${(m.edge_touch * 100).toFixed(0)}%,多半被裁掉)`);
  return { ok: !why.length, why };
}

const PY = join(ROOT, 'tools', 'screen_protorefs.py');

/** 跑一批;回 Map<路徑, 量測>。Python 不在 ⇒ 回 null(呼叫端一律當成「不篩」) */
export async function screenFiles(paths) {
  if (!paths.length || !existsSync(PY)) return new Map();
  const out = new Map();
  for (let i = 0; i < paths.length; i += SCREEN.BATCH) {
    const chunk = paths.slice(i, i + SCREEN.BATCH);
    const lines = await new Promise((res) => {
      const ps = spawn('python', [PY, ...chunk], { cwd: ROOT });
      let buf = '';
      ps.stdout.on('data', (d) => { buf += d; });
      ps.on('error', () => res(null));                       // 沒有 python ⇒ 不篩
      ps.on('close', () => res(buf.trim() ? buf.trim().split('\n') : []));
    });
    if (lines === null) return null;
    for (const l of lines) {
      try { const m = JSON.parse(l); out.set(m.file.replace(/\\/g, '/'), m); } catch { /* 壞行跳過 */ }
    }
  }
  return out;
}

/** 單張:合格嗎(採集端下載完當場問)。不篩 ⇒ 回 null,呼叫端 MUST 當成「沒意見」 */
export async function screenOne(path) {
  const r = await screenFiles([path]);
  if (!r) return null;
  const m = r.get(path.replace(/\\/g, '/')) || [...r.values()][0];
  return m ? { ...verdict(m), m } : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (f, d = null) => { const i = argv.indexOf(f); return i < 0 ? d : argv[i + 1]; };
  const only = arg('--key'), apply = argv.includes('--apply'), note = argv.includes('--annotate');

  const man = await loadManifest();
  const jobs = [];
  for (const [key, layers] of Object.entries(man.entries || {})) {
    if (only && key !== only) continue;
    for (const [layer, rows] of Object.entries(layers)) {
      for (const r of rows) {
        // 使用者自己貼的照片**不篩**:他知道自己要什麼,而構圖判準是給「機器抓回來的」用的
        if (r.api === 'user') continue;
        jobs.push({ key, layer, row: r, path: join(REFS_DIR, safeKey(key), layer, r.file) });
      }
    }
  }
  const scored = await screenFiles(jobs.map((j) => j.path));
  if (scored === null) {
    console.log('沒有 python/PIL ⇒ 這一輪不篩(降級,不是失敗)');
    return;
  }

  let pass = 0;
  const bad = [];
  for (const j of jobs) {
    const m = scored.get(j.path.replace(/\\/g, '/'));
    if (!m) continue;
    const v = verdict(m);
    if (v.ok) { pass++; continue; }
    bad.push({ ...j, why: v.why, m });
  }
  console.log(`打分 ${jobs.length} 張:合格 ${pass} ・ 不合格 ${bad.length}`);
  for (const b of bad.slice(0, 60)) {
    console.log(`  ✗ ${b.key}/${b.layer}/${b.row.file}  ${b.why.join(' / ')}`);
  }
  if (bad.length > 60) console.log(`  …另外 ${bad.length - 60} 張`);

  if (note && !apply) {
    // 只標不刪:理由寫進每一張的註解(看板上就看得到),圖留著 —— 現在還沒有替代品
    for (const b of bad) annotate(man, b.key, b.layer, b.row.file, `構圖不合格:${b.why.join(' / ')}`);
    // 合格的那些把舊註解清掉(否則改過門檻之後,畫面上還留著上一輪的判語)
    for (const j of jobs) {
      const m = scored.get(j.path.replace(/\\/g, '/'));
      if (m && verdict(m).ok && /^構圖不合格/.test(j.row.note || '')) annotate(man, j.key, j.layer, j.row.file, '');
    }
    await saveManifest(man);
    console.log(`\n已在 ${bad.length} 張上標註理由(圖沒有刪)。看板的「參考圖」分頁看得到;`
      + '確定要換掉時再跑 --apply。');
    return;
  }
  if (!apply) {
    console.log('\n(只是打分。標註理由:--annotate;真的判退並讓下一輪重搜:--apply)');
    return;
  }
  // 判退 = 刪檔 + 移列 + 進黑名單(refstore 單一縫),並把理由寫成該層的註解 ——
  // 註解是給下一輪與人看的:「這一層之前抓到的都是雜背景/特寫」
  const byLayer = new Map();
  for (const b of bad) {
    await rejectImg(man, b.key, b.layer, b.row.file, '');
    const k = `${b.key}|${b.layer}`;
    byLayer.set(k, (byLayer.get(k) || 0) + 1);
  }
  for (const [k, n] of byLayer) {
    const [key, layer] = k.split('|');
    const t = retune(man, key, layer, {});
    const tag = `構圖篩選判退 ${n} 張(要全身照、背景乾淨)`;
    t.note = t.note && !t.note.includes('構圖篩選判退') ? `${t.note};${tag}` : tag;
  }
  await saveManifest(man);
  console.log(`\n已判退 ${bad.length} 張(刪檔 + 進黑名單);下一輪採集會重新找這幾層。`);
}

const entry = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (entry) main().catch((e) => { console.error(e); process.exit(1); });
