#!/usr/bin/env node
/**
 * ============ 第 ⑦ 站:自動入庫(2026-08-10 使用者定案「先全部自動化,人眼再審查」)============
 *
 * 在此之前 `harvest_loop.mjs` 刻意停在 contact sheet,檔頭寫著「想讓它自動入庫的話,擋不住的
 * 就是『統計全綠、內容是一張版畫』那一類(MUST NOT)」。這一輪把那條改成 **自動入庫 + 事後可撤**,
 * 而讓它擋得住的不是多一道統計閘(那正是擋不住的那種東西),是三件結構性的東西:
 *
 *   ① **不 commit** —— 自動入庫只寫工作區。沒有 commit 就是沒有出貨,人眼永遠排在出貨之前。
 *   ② **可撤** —— 對照台判 `purge`/`reimg` 時 `apply_verdicts.mjs` 把節點從 GLB、名冊、來源帳
 *      三邊同時撤掉;判 `purge` 連原始照片一起刪並進黑名單(使用者定案「連節點一起撤下」)。
 *   ③ **只准追加到既有輪替名冊** —— 開新格要寫 fallback primitive 描述子,而那個描述子同時是
 *      降級幾何 + 離線外廓上界 + 縮放目標,三件都要人決定。可追加的格由 `intake_recipes.rosterSlots()`
 *      **推導**(值是陣列的那些格),MUST NOT 手寫清單。
 *
 * ---- 這一站做什麼 ----
 *
 *   對每一顆候選網格:快照三份檔 → (T2 才要)實體化 → normalize → intake 閘 → 名冊追加
 *   → 重新解析驗證 → 來源帳 → 逐顆快閘。**任何一步紅字 ⇒ 還原那三份快照**,逐位元。
 *
 * ---- 為什麼「回滾」是這條自動化真正的本錢 ----
 *
 * 入庫會動三份檔(`<族>.glb` / `biomes.js` 名冊 / `parts_manifest.json`),而它們之間的一致性
 * 正是 3D 零件對照台的三種缺口(缺件 / 孤兒 / 未記載來源)。半途失敗只還原其中兩份 = 台上多一列
 * 紅字,而遊戲照樣跑、每一支離線稽核照樣綠。⇒ 快照一律以 **Buffer** 讀寫(不帶編碼):
 * 這個工作區是 CRLF 檢出,用字串讀寫會在還原時把換行正規化,而 diff 看起來是「整檔都改了」。
 *
 * ---- 來源帳的那個洞(這一輪順手補上)----
 *
 * `tri_budget.json` 的 `resample_2026_08_08` 記著一筆:出貨的 chimney_a/ac_a **復現不出來**,
 * 因為 manifest 只記了照片與 fit、沒記「哪一個輸出目錄的第幾顆」,而同一張照片配同一組參數
 * 得到的是另一顆網格。⇒ 自動入庫**要求** `<產出目錄>/.feed.json`(harvest_loop 生成當下寫的
 * 投料帳:index → 母照片 id / 目標 id / 工具 / 參數)。沒有這一份就**不入庫**(規則 9:
 * 說不出方法與圖的東西不算完成),而不是猜一個。
 *
 * 用法(在 3060 那台跑;沙箱沒有 Blender ⇒ 會印理由跳過):
 *   node tools/ai3d/auto_intake.mjs --src <資料家>/out/t2_auto/<時戳> --home <資料家>
 *   node tools/ai3d/auto_intake.mjs --src ... --dry        只印每一顆要下什麼指令
 *   node tools/ai3d/auto_intake.mjs --src ... --gate-full  收尾多跑 npm test / npm run bal
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROOT } from '../audit_src.mjs';
import { biomesSrc, glbPath, parseGlb, nodeProfile, partLibs, triBudget } from './parts_src.mjs';
import { topoStats, nodeFlaws } from './mesh_sym.mjs';
import { scanDir, verdictOf } from './mesh_stats.mjs';
import { MANIFEST_PATH, loadProvenance } from './provenance.mjs';
import {
  rosterSlots, nextNodeName, normalizeArgs, splitNodeName, fitWithinEnvelope,
} from './intake_recipes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };

const SRC = opt('src');
const HOME = opt('home', HERE);
const LIMIT = Number(opt('limit', 4));
const DRY = flag('dry');
const GATE_FULL = flag('gate-full');
const BIOMES = join(ROOT, 'public', 'js', 'biomes.js');
const PHOTO_MANIFEST = join(HOME, 'photo_manifest.json');
// 人眼判 `⟳ 重生(同圖換參數)` 之後,`apply_verdicts.mjs` 把要換的參數寫在這裡(鍵 = 母照片 id)。
// **覆寫表只有一份**、兩站同吃 —— 各自記一份的話「調了參數卻還是同一顆網格」查不出理由。
const OVERRIDES = join(HOME, 'intake_overrides.json');

const loadJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };

/** blender 可執行檔(缺席不是例外 —— 原則 6:印理由跳過) */
function blenderBin() {
  const cand = [process.env.BLENDER || '', 'blender',
    'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'];
  for (const c of cand) {
    if (!c) continue;
    const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
    if (!r.error) return c;
  }
  return null;
}

function run(label, cmd, args, opts = {}) {
  if (DRY) { console.log(`  [dry] ${label}: ${cmd} ${args.join(' ')}`); return { ok: true, dry: true }; }
  // Windows 的 `npm` 是 npm.cmd ⇒ spawnSync 直接給 'npm' 會 ENOENT,而 ENOENT 在這裡的
  // 症狀是「收尾稽核回報失敗 ⇒ 整輪回滾」:入庫每次都白做,而理由與被驗的東西無關
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || ROOT, encoding: 'utf8', maxBuffer: 64 << 20,
    shell: process.platform === 'win32' && !/[\\/]/.test(cmd),
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  if (opts.echo !== false) for (const l of out.split(/\r?\n/)) if (l.trim()) console.log(`     ${l}`);
  if (r.error) return { ok: false, out, why: `起不來:${r.error.message}` };
  return { ok: r.status === 0, out, why: r.status ? `回傳 ${r.status}` : null };
}

// ---- 快照 / 還原(逐位元;不存在的檔記成 null ⇒ 還原時刪掉)-----------------
const TRACKED = () => [BIOMES, MANIFEST_PATH];
/**
 * 快照。**不存在的檔 MUST 記成 `null`** —— 入庫會**新建**一支還沒出現過的 `<族>.glb`,
 * 只記「有內容的那幾份」的話回滾會把那支新檔留在工作區:名冊已還原、GLB 卻多一支,
 * 對照台當場多一列孤兒,而每一支離線稽核都是綠的。
 */
export function snapshot(extra = []) {
  const m = new Map();
  for (const p of [...TRACKED(), ...extra]) m.set(p, existsSync(p) ? readFileSync(p) : null);
  return m;
}
export function restore(snap) {
  for (const [p, buf] of snap) {
    if (buf === null) { if (existsSync(p)) unlinkSync(p); continue; }
    if (!existsSync(p) || !readFileSync(p).equals(buf)) writeFileSync(p, buf);
  }
}

// ---- 名冊追加(錨定在「最後一顆既有節點名」)---------------------------------
/**
 * 錨點刻意取**最後一顆既有節點的字串字面**而不是格名或行號:
 *   ・格名(`mass:`)在註解裡出現過好幾次;行號會隨註解增刪而漂。
 *   ・節點名是**執行原文得到的**(`rosterSlots` 跑的是真品 `biomes.js`)⇒ 它一定在;
 *     而它若不是**恰好出現一次**,就代表我對這份原文的理解是錯的 ⇒ 當場失敗,不猜。
 *
 * ⚠ 吃的是 **raw 位元組解出來的字串**,不是 `biomesSrc()` —— 後者(`audit_src.readSrc`)會把
 * 換行正規化成 `\n`,拿它寫回去等於**把整支 biomes.js 從 CRLF 改成 LF**:遊戲照跑、每一支
 * 稽核照樣綠,而 diff 是「一萬行全改」。錨點本身不含換行 ⇒ 兩種檢出下計數與插入點都一樣。
 */
export function appendRoster(src, slot, newName, prof = null) {
  const last = slot.names[slot.names.length - 1];
  const anchor = `'${last}'`;
  const n = src.split(anchor).length - 1;
  if (n !== 1) return { ok: false, why: `名冊錨點 ${anchor} 在 biomes.js 出現 ${n} 次(要恰 1 次才敢動刀)` };
  const i = src.indexOf(anchor) + anchor.length;
  let out = `${src.slice(0, i)}, '${newName}'${src.slice(i)}`;
  // **剖面與名冊同序**(2026-08-12):第三格是逐節點一筆的輪廓剖面,少補一筆就會讓
  // `bldProfile(key, i)` 錯位 —— 碰撞柱長成別顆節點的形狀,而畫面與所有既有閘門都正常。
  // 錨點取**具名哨兵註解**(名字裡有格名 ⇒ 兩個格不會互相插錯):剖面是巢狀陣列,
  // 拿「最後一筆的字面」當錨等於要求我把格式抄得逐字元相同,那遲早會錯。
  if (slot.profs) {
    if (!prof?.length) return { ok: false, why: `${slot.id} 是有剖面的格,但這一顆量不到剖面` };
    const sent = `/* +prof:${slot.key} */`;
    const m = out.split(sent).length - 1;
    if (m !== 1) return { ok: false, why: `剖面錨點 ${sent} 出現 ${m} 次(要恰 1 次才敢動刀)` };
    const j = out.indexOf(sent);
    const row = `[${prof.map((s) => `[${s.join(', ')}]`).join(', ')}],\n    `;
    out = `${out.slice(0, j)}${row}${out.slice(j)}`;
  }
  return { ok: true, src: out };
}

/**
 * 追加後**重新執行真品原文**驗證(不是比對我剛才拼的字串 —— 那只會證明我拼對了自己)。
 * 四條:①格數不變 ②目標格恰多一顆且在最後 ③**其餘每一格逐位元不變,含 fallback 描述子**
 *      ④有剖面的格,剖面筆數 MUST 與名冊同長且**其餘每一筆逐位元不變**。
 */
export function verifyRoster(newSrc, slot, newName, prof = null) {
  let after;
  try { after = rosterSlots(newSrc); } catch (e) { return { ok: false, why: `追加後 biomes.js 解析不了:${e.message}` }; }
  const before = rosterSlots();
  if (after.length !== before.length) return { ok: false, why: `名冊格數 ${before.length} → ${after.length}(自動入庫 MUST NOT 開新格)` };
  for (const b of before) {
    const a = after.find((x) => x.id === b.id);
    if (!a) return { ok: false, why: `格 ${b.id} 不見了` };
    if (JSON.stringify(a.fb) !== JSON.stringify(b.fb)) return { ok: false, why: `格 ${b.id} 的 fallback 描述子被動到了` };
    const want = b.id === slot.id ? [...b.names, newName] : b.names;
    if (JSON.stringify(a.names) !== JSON.stringify(want)) {
      return { ok: false, why: `格 ${b.id} 名冊對不上(期望 ${JSON.stringify(want)},實得 ${JSON.stringify(a.names)})` };
    }
    if (b.profs || a.profs) {
      const wantP = b.id === slot.id ? [...(b.profs || []), prof] : b.profs;
      if (JSON.stringify(a.profs) !== JSON.stringify(wantP)) {
        return { ok: false, why: `格 ${b.id} 剖面對不上(名冊 ${a.names.length} 顆 / 剖面 ${a.profs?.length ?? 0} 筆)` };
      }
    }
  }
  return { ok: true };
}

// ---- 候選 → 名冊格 -----------------------------------------------------------
/**
 * 建築族有兩個輪替格,而消費端自己的判準(`commercial && h > 55m`)在一顆網格上量不到 ——
 * 網格沒有公尺。可用的訊號只有**它自己的比例**,而那條線是**定義**不是校準值:
 *   高過寬(aspect < 1)⇒ 高層量體 `mass`;寬過高(aspect ≥ 1)⇒ 低矮量體 `masslow`。
 * 巨岩那格則直接沿用 `mesh_stats` 已經校準好的塊狀帶(同一組常數,MUST NOT 抄第二份)。
 */
export function pickSlot(slots, family, row) {
  const cands = slots.filter((s) => s.family === family && s.recipe);
  if (cands.length <= 1) return cands[0] || null;
  const low = row.aspect >= 1;
  return cands.find((s) => (s.key === 'masslow') === low) || cands[0];
}

// ---- 主流程 ------------------------------------------------------------------
function main() {
  if (!SRC || !existsSync(SRC)) {
    console.error(`用法:node tools/ai3d/auto_intake.mjs --src <產出目錄> [--home <資料家>]\n找不到 --src(${SRC})`);
    process.exit(1);
  }
  const feed = loadJson(join(SRC, '.feed.json'), null);
  if (!feed?.items?.length) {
    console.log(`⏭  ${SRC} 沒有投料帳 .feed.json ⇒ **不入庫**`);
    console.log('   (規則 9:來源帳要說得出「哪一張圖、哪個輸出目錄的第幾顆」。'
      + '手動產出的批次請先補一份 .feed.json,或走人工 normalize_parts → intake_parts。)');
    return 0;
  }
  const blender = blenderBin();
  if (!blender && !DRY) { console.log('⏭  找不到 Blender ⇒ 這一站跳過(其餘照跑;原則 6)'); return 0; }

  const budget = triBudget();
  const slots = rosterSlots();
  const libs = new Set(partLibs());
  const shipped = new Set(loadProvenance().parts.flatMap((p) => (p.imgs || []).map((i) => i.id)).filter(Boolean));
  const byIdx = new Map(feed.items.map((it) => [String(it.index), it]));
  const byName = new Map(feed.items.map((it) => [String(it.target || it.id), it]));

  const rows = scanDir(SRC);
  const took = [], held = [];
  const roundSnap = snapshot();

  for (const row of rows) {
    if (took.length >= LIMIT) { held.push([row.sub, `本輪額度 ${LIMIT} 顆已滿`]); continue; }
    const item = byIdx.get(row.sub) || byName.get(row.sub);
    if (!item) { held.push([row.sub, '投料帳裡查無此顆(說不出吃哪一張圖)']); continue; }
    if (shipped.has(item.id)) { held.push([row.sub, `母照片 ${item.id} 已經出過貨`]); continue; }
    // SF3D 那一路才吃實心度快篩 —— T2 的原始輸出本來就是雙層撕裂薄殼(門檻是拿 SF3D 校準的,
    // 同一把尺量下去每一顆建築都是「殼/碎片 ✗」,那是尺用錯不是東西壞了)。T2 靠實體化 + 破口閘。
    if (item.tool === 'sf3d' && verdictOf(row) !== '塊狀候選 ◎') { held.push([row.sub, `實心度快篩:${verdictOf(row)}`]); continue; }
    const slot = pickSlot(slots, item.family, row);
    if (!slot) { held.push([row.sub, `${item.family} 族沒有可自動追加的輪替名冊格`]); continue; }
    if (!libs.has(slot.family)) { held.push([row.sub, `${slot.family} 不在 PART_LIBS(載不進遊戲)`]); continue; }
    const fitChk = fitWithinEnvelope(slot);
    if (!fitChk.ok) { held.push([row.sub, `${slot.id} 的配方 fit 超過 fallback 包絡`]); continue; }
    const nodeName = nextNodeName(slot);
    if (!nodeName) { held.push([row.sub, `${slot.id} 的字母序號用完了(26 顆)`]); continue; }

    const r = intakeOne({ row, item, slot, nodeName, blender, budget, feed });
    if (r.ok) { took.push({ nodeName, slot, sub: row.sub, id: item.id }); slot.names.push(nodeName); }
    else held.push([row.sub, r.why]);
  }

  console.log(`\n── 自動入庫:收 ${took.length} 顆、擋 ${held.length} 顆`);
  for (const t of took) console.log(`   ✅ ${t.nodeName} ← ${t.sub}(${t.id})`);
  // **擋掉幾顆 MUST 印出來**(skill「no silent caps」):靜默略過讀起來就是「這一批沒東西」
  for (const [sub, why] of held) console.log(`   ⏭  ${sub}:${why}`);

  if (took.length && GATE_FULL && !DRY) {
    console.log('\n── 收尾全套稽核(--gate-full)');
    const bad = fullBattery();
    if (bad) {
      console.log(`\n❌ 收尾稽核紅字(${bad})⇒ **整輪回滾**`);
      restore(roundSnap);
      for (const t of took) dropNode(t.slot.family, t.nodeName, blender);
      return 1;
    }
  }
  if (took.length) {
    console.log('\n下一步(人眼那一步沒有被省掉,只是換到後面):npm run parts 逐顆覆核 →');
    console.log('   通過就 commit;判 ✕ 刪除來源圖 / ⟳ 重生 / ⇄ 換來源圖 ⇒ node tools/ai3d/apply_verdicts.mjs --home <資料家>');
  }
  return 0;
}

/** 逐顆:快照 → (實體化) → normalize → intake 閘 → 名冊 → 來源帳 → 快閘;任一步紅字整顆還原 */
function intakeOne({ row, item, slot, nodeName, blender, budget, feed }) {
  const glb = glbPath(slot.family);
  const snap = snapshot([glb]);
  const { node } = splitNodeName(nodeName);
  const undo = (why) => { restore(snap); return { ok: false, why }; };

  // ① T2-spz 的產出 MUST 先實體化(雙層撕裂薄殼;provenance METHODS 那一條)
  let src = row.path;
  if (item.tool === 'trellis2_spz') {
    const sp = slot.recipe.solidify || { cells: 72, offset: 0.006, target: 2900 };
    const solid = join(SRC, `${row.sub}.solid.glb`);
    // 實體化跑在 `tools/ai3d/.venv`(trimesh);`--python` > 投料帳 > PATH,缺席時由 run() 的
    // 「起不來」帶著理由回來,而不是拿系統 python 去撞一個沒有 trimesh 的環境
    const ov = loadJson(OVERRIDES, {})[item.id] || {};
    const s = run(`實體化 ${row.sub}`, opt('python') || feed.python || 'python',
      ['solidify_parts.py', '--in', row.path, '--out', solid, '--mode', 'resample',
        '--cells', String(ov.cells ?? item.cells ?? sp.cells),
        // `offset` 是唯一逐顆需要調的那一個(§5am:masslow_b 要 0.014,0.006 出破口)
        '--offset', String(ov.offset ?? item.offset ?? sp.offset),
        '--target', String(ov.target ?? item.target ?? sp.target)], { cwd: HERE });
    if (!s.ok) return undo(`實體化失敗(${s.why})`);
    if (!DRY) src = solid;
  }

  // ② normalize:`--base` 保留既有節點逐位元原樣(重跑舊節點會讓它們有機會位元漂移)
  const args = normalizeArgs(slot, nodeName, src, budget);
  if (!args) return undo(`${slot.id} 沒有配方或算不出三角形上限`);
  const nz = run(`normalize ${node}`, blender,
    ['--background', '--python', join('tools', 'ai3d', 'normalize_parts.py'), '--',
      ...(existsSync(glb) ? ['--base', glb] : []), '--out', glb, ...args]);
  if (!nz.ok) return undo(`normalize 失敗(${nz.why})`);

  // ③ 外廓契約 + 三角形預算(真品閘,不是我自己再算一次)
  const ip = run('intake 閘', process.execPath, ['tools/ai3d/intake_parts.mjs', '--glb', glb], { echo: false });
  if (!ip.ok) { console.log(ip.out.split(/\r?\n/).filter((l) => l.includes('❌')).map((l) => `     ${l}`).join('\n')); return undo('intake 閘紅字'); }

  // ④ 破口 / 碎屑(既有量測;T2 那一路真正的守門員)+ **輪廓剖面實測**(2026-08-12)
  let prof = null;
  if (!DRY) {
    const n = parseGlb(glb).get(node);
    if (!n) return undo('normalize 之後 GLB 裡找不到這顆節點');
    const flaws = nodeFlaws(topoStats(n), slot.family);
    if (flaws.length) return undo(`半成品:${flaws.map((f) => `${f.label}(${f.detail})`).join('、')}`);
    // 剖面是消費端拿來登記**碰撞柱**、疊保險絲幾何、掛招牌、貼合尺寸的那一份形狀
    // (`biomes.js bldProfile` 檔頭)。它 MUST 是量出來的、與名冊同序寫進第三格 ——
    // 佈局數學讀不到庫幾何(讀了就是碰撞柱跨客戶端分家)⇒ 沒有這一步就沒有第二條路。
    if (slot.profs) {
      const ps = budget?.families?.[slot.budgetFam]?.profile_spec;
      if (!ps) return undo('tri_budget 缺 families.building.profile_spec(剖面量測參數)');
      prof = nodeProfile(n, { bands: ps.bands, maxSlabs: ps.slabs })?.slabs || null;
      if (!prof) return undo('量不到輪廓剖面(節點是空的?)');
    }
  }

  // ⑤ 名冊追加 + 重新執行真品原文驗證(讀寫走 raw,驗證走正規化 —— 見 appendRoster 檔頭)
  if (!DRY) {
    const app = appendRoster(readFileSync(BIOMES, 'utf8'), slot, nodeName, prof);
    if (!app.ok) return undo(app.why);
    writeFileSync(BIOMES, Buffer.from(app.src, 'utf8'));
    const v = verifyRoster(biomesSrc(), slot, nodeName, prof);
    if (!v.ok) return undo(v.why);
  }

  // ⑥ 來源帳(規則 9)
  if (!DRY) writeProvenance({ item, slot, nodeName, row, feed });

  // ⑦ 逐顆快閘:名冊與 GLB 一致(缺件 / 孤兒 / 未記載來源三種缺口)
  if (!DRY && !gapsClean()) return undo('對照台出現缺口(缺件/孤兒/未記載來源)');

  console.log(`  ✅ ${nodeName}`);
  return { ok: true };
}

/** 來源帳一列:方法 + 圖 + **哪個輸出目錄的第幾顆**(補上 tri_budget 記著的那個洞) */
function writeProvenance({ item, slot, nodeName, row, feed }) {
  const man = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const photos = loadJson(PHOTO_MANIFEST, []);
  const ph = photos.find((e) => e.id === item.id) || {};
  const rev = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout?.trim() || null;
  man.parts.push({
    method: item.tool === 'trellis2_spz' ? 'trellis2_spz' : 'sf3d',
    consumer: `biomes ${slot.table}.${slot.key} 輪替名冊`,
    rev,
    at: new Date().toISOString().slice(0, 10),
    auto: true,                                   // 自動入庫的那幾顆:人眼尚未複核(對照台據此排前面)
    imgs: [{
      role: 'primary', id: item.id, target: item.target || null,
      family: item.family, part: item.part || null,
      query: ph.query || null, api: ph.api || null, license: ph.license || null,
      creator: ph.creator || null, source_url: ph.source_url || null, file: ph.file || null,
    }],
    gen: {
      tool: item.tool, runner: item.runner || null, params: item.params || null,
      // ⚠ 這兩欄就是 tri_budget resample_2026_08_08 那筆缺口的修法:沒有它們,
      //   同一張照片配同一組參數**復現不出**出貨的那一顆(實測差到剪影都不同)
      out_dir: relative(ROOT, SRC).split('\\').join('/'),
      out_index: row.sub,
      measured: `fill ${row.fill.toFixed(3)}・aspect ${row.aspect.toFixed(2)}・原始 ${row.tris} tris`,
    },
    post: {
      tool: 'tools/ai3d/auto_intake.mjs → normalize_parts.py(Blender headless)',
      fit: slot.recipe.fit,
      solidify: item.tool === 'trellis2_spz' ? (slot.recipe.solidify || null) : null,
      note: '自動入庫(第 ⑦ 站):名冊追加走 intake_recipes 的推導,人眼複核排在入庫之後(對照台)',
    },
    note: `自動入庫;投料帳 ${feed.at || '?'} 第 ${row.sub} 顆`,
    keys: [nodeName],
  });
  writeFileSync(MANIFEST_PATH, Buffer.from(`${JSON.stringify(man, null, 2)}\n`, 'utf8'));
}

/**
 * 對照台的三種缺口(缺件 / 孤兒 / 未記載來源)—— **這一支做完的事由它驗收**,
 * 判準 MUST NOT 自己再算一次(對照台那份是由消費端零件表 ∪ GLB 節點 ∪ 來源帳推導的)。
 * 樣式吃 `\s+`:報表是對齊欄位(「缺件    0」),寫死一個空格會**永遠判乾淨**。
 * 第 ⑦ 站與第 ⑨ 站同吃這一支(各寫一份 = 兩站對同一份缺口給出兩種答案)。
 */
export function gapsClean() {
  const r = spawnSync(process.execPath, ['tools/parts_review.mjs', '--report'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  if (!/缺件\s+\d/.test(out)) return false;         // 報不出來就是不乾淨(不准當成沒問題)
  return !/缺件\s+[1-9]|孤兒節點\s+[1-9]|未記載來源\s+[1-9]/.test(out);
}

/** 把節點從 GLB 撤掉(回滾與 apply_verdicts 共用) */
export function dropNode(family, nodeName, blender = blenderBin()) {
  const glb = glbPath(family);
  if (!blender || !existsSync(glb)) return false;
  const { node } = splitNodeName(nodeName);
  const r = spawnSync(blender, ['--background', '--python', join('tools', 'ai3d', 'normalize_parts.py'), '--',
    '--base', glb, '--out', glb, '--drop', node], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0;
}

/** 收尾全套(㋔ 的相鄰稽核 + 兩支「MUST 逐項不變」);回 null = 全綠 */
function fullBattery() {
  const jobs = [
    ['object_joints', process.execPath, ['tools/audit_object_joints.mjs', '--seeds', '8']],
    ['siteplan', process.execPath, ['tools/audit_siteplan.mjs']],
    ['beacons', process.execPath, ['tools/audit_beacons.mjs']],
    ['bal', 'npm', ['run', 'bal']],
  ];
  for (const [label, cmd, args] of jobs) {
    const r = run(label, cmd, args, { echo: false });
    if (!r.ok) return label;
  }
  return null;
}

// ---- CLI ----(`dropNode` 要給 apply_verdicts.mjs import ⇒ 主流程 MUST 關在這道閘裡,
//      否則 `import { dropNode }` 會順便跑一次自動入庫)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
