#!/usr/bin/env node
/**
 * ============ 第 ⑨ 站:把 3D 零件對照台的人眼判決**執行掉** ============
 *
 * 2026-08-10 使用者定案:「先全部自動化,人眼再審查,決定要刪除原始照片或調整參數重新處理」。
 * 第 ⑦ 站(`auto_intake.mjs`)負責前半;這一支負責後半 —— 把台上的判決變成真的動作。
 *
 * 判決字彙的唯一真相是 `tools/parts_review/review.js` 的 `STATUS`,五個出口在這裡各對一個動作:
 *
 *   ✔ ok      什麼都不做(它已經是出貨狀態;commit 是使用者的事,這一支**不 commit**)
 *   ⟳ regen   同一張圖換參數重跑:撤節點 → 寫覆寫參數 → 把它從「已餵過」名單放回待跑池
 *   ⇄ reimg   換來源圖:撤節點 + 這張圖標記不再挑(**照片留著** —— Route A 仍要看照片)
 *   ⊘ archive 移除:撤節點 + **原來源帳整列搬進封存帳**,照片留著、不再自動重跑
 *   ✕ purge   刪除來源圖:撤節點 + **真的刪檔** + 進黑名單(使用者定案「連節點一起撤下」)
 *
 * `archive` 與 `regen`/`reimg` 的差別是**下一步在誰身上**:那兩個是「這顆不行,再試一次」
 * ⇒ 照片回到待跑池;`archive` 是使用者 2026-08-11 要的「移除遊戲與零件台,放到封存區」——
 * 這顆結案了,不要再自動生成它,但它存在過的事實(方法 / 來源圖 / 授權 / 量測)MUST 留著。
 * 撤完之後來源帳裡那一列就沒了 ⇒ **不搬進封存帳的話,那些事實整組消失**,而台上看起來
 * 就像它從來沒有出現過。
 *
 * ---- 「撤節點」是三件事,少做一件就是對照台上的一道缺口 ----
 *
 * ①GLB 移除(`normalize_parts.py --drop`)②`biomes.js` 名冊移除 ③來源帳移除。
 * 只做 ① = 名冊指到不存在的節點(**缺件**,執行期整件走 fallback);只做 ①② = 帳上掛著一顆
 * 沒人用的節點(**未記載/孤兒**)。三者都做完之後 MUST 再問一次對照台 —— 這一支自己做的事,
 * 由**別人**驗收(對照台的三種缺口是同一份推導,不是我再算一次)。
 *
 * ---- 一條刻意的煞車 ----
 *
 * 撤到輪替名冊只剩 1 顆時**停下來要 `--force`**:`biomes.js` 那兩行寫著「輪替名冊 MUST ≥2 顆」
 * ——一款打天下的話,同一張圖上挑中的十幾棟塔樓是同一個剪影,而所有離線閘門全綠。
 * 自動化 MUST NOT 靜靜地把它撤成 1。
 *
 * 用法:
 *   node tools/ai3d/apply_verdicts.mjs --home <資料家>            # 執行所有待辦判決
 *   node tools/ai3d/apply_verdicts.mjs --home <資料家> --dry      # 只印要做什麼
 *   node tools/ai3d/apply_verdicts.mjs --home <資料家> --only building/mass_d
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROOT } from '../audit_src.mjs';
import { ARCHIVE_PATH, MANIFEST_PATH, loadArchive, partKeys } from './provenance.mjs';
import { rosterSlots } from './intake_recipes.mjs';
import { dropNode, gapsClean } from './auto_intake.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };

const HOME = opt('home', HERE);
const ONLY = opt('only');
const DRY = flag('dry');
const FORCE = flag('force');
const STATE_FILE = join(ROOT, 'tools', 'parts_review', 'state.json');
const BIOMES = join(ROOT, 'public', 'js', 'biomes.js');
const OVERRIDES = join(HOME, 'intake_overrides.json');
const HARVEST_STATE = join(HOME, 'harvest_state.json');

const loadJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, v) => writeFileSync(p, Buffer.from(`${JSON.stringify(v, null, 2)}\n`, 'utf8'));

/** 最小輪替顆數 —— 語意住 `biomes.js`(「輪替名冊 MUST ≥2 顆」),這裡只是那條規則的執行面 */
const ROSTER_MIN = 2;

/**
 * 名冊移除:錨定在**節點名字串字面**(同 appendRoster 的理由),三種位置各一條樣式。
 * 讀寫一律走 raw 位元組解出來的字串 —— `readSrc` 會把 CRLF 正規化成 LF,拿它寫回去
 * 等於把整支 biomes.js 換行全改(遊戲照跑、稽核全綠、diff 一萬行)。
 */
export function removeRoster(src, name, slots = null) {
  // **剖面與名冊同序**(2026-08-12):撤節點時第三格那一筆也要撤,否則 `bldProfile(key, i)`
  // 從這一顆之後整排錯位 —— 碰撞柱長成別顆節點的形狀,而畫面與所有既有閘門都正常。
  // 先撤剖面再撤名字:撤完名字之後就查不到它排第幾了。
  let out = src;
  const list = slots || rosterSlots(src.replace(/\r\n?/g, '\n'));
  const slot = list.find((s) => s.profs && s.names.includes(name));
  if (slot) {
    const i = slot.names.indexOf(name);
    const row = `[${slot.profs[i].map((s) => `[${s.join(', ')}]`).join(', ')}],`;
    const n = out.split(row).length - 1;
    if (n !== 1) return { ok: false, why: `剖面樣式 ${row.slice(0, 40)}… 出現 ${n} 次(要恰 1 次才敢動刀)` };
    const j = out.indexOf(row);
    // 連同該行的縮排與換行一起收掉(留下空行 = 追加/撤下不再逐位元可逆)
    let a = j; while (a > 0 && (out[a - 1] === ' ' || out[a - 1] === '\t')) a--;
    let b = j + row.length; while (out[b] === '\r' || out[b] === '\n') b++;
    out = out.slice(0, a) + out.slice(b);
  }
  for (const pat of [`, '${name}'`, `'${name}', `, `'${name}'`]) {
    const n = out.split(pat).length - 1;
    if (n === 1) return { ok: true, src: out.replace(pat, '') };
    if (n > 1) return { ok: false, why: `移除樣式 ${pat} 出現 ${n} 次(要恰 1 次才敢動刀)` };
  }
  return { ok: false, why: `biomes.js 裡找不到 '${name}'` };
}

function run(label, cmd, args, opts = {}) {
  if (DRY) { console.log(`  [dry] ${label}: ${cmd} ${args.join(' ')}`); return { ok: true, dry: true }; }
  const r = spawnSync(cmd, args, { cwd: opts.cwd || ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  if (opts.echo !== false) for (const l of out.split(/\r?\n/)) if (l.trim()) console.log(`     ${l}`);
  return { ok: !r.error && r.status === 0, out };
}

/** 撤節點三件事(GLB / 名冊 / 來源帳);回 { ok, why } */
function withdraw(key) {
  const slots = rosterSlots();
  const slot = slots.find((s) => s.names.includes(key));
  if (!slot) return { ok: false, why: `${key} 不在任何輪替名冊格裡(單一字串格的取代要人決定,自動化不碰)` };
  if (slot.names.length - 1 < ROSTER_MIN && !FORCE) {
    return { ok: false, why: `撤掉之後 ${slot.id} 只剩 ${slot.names.length - 1} 顆 —— 名冊 MUST ≥${ROSTER_MIN} 顆(要撤請加 --force,並記得補一顆)` };
  }
  const man = loadJson(MANIFEST_PATH, null);
  if (!man) return { ok: false, why: '讀不到來源帳' };

  // ① GLB
  if (!DRY && !dropNode(slot.family, key)) return { ok: false, why: `從 ${slot.family}.glb 移除節點失敗(Blender 起不來?)` };
  if (DRY) console.log(`  [dry] 從 ${slot.family}.glb --drop ${key.split('/').pop()}`);
  // ② 名冊
  const rm = removeRoster(readFileSync(BIOMES, 'utf8'), key);
  if (!rm.ok) return { ok: false, why: rm.why };
  if (!DRY) writeFileSync(BIOMES, Buffer.from(rm.src, 'utf8'));
  // ③ 來源帳(整列只服務這一顆才刪列;一列掛多顆時只拔掉那一個 key)。
  // 鍵一律走 `partKeys` 正規化 —— 帳本**兩種寫法都合法**,而舊版只讀 `keys` ⇒ 以 `key:` 寫的
  // 那些列(現役的 mass_a/mass_b/mass_c/chimney_a… 都是)在這裡查出來是空的:節點撤了、
  // 帳留著、而且「這顆吃哪張圖」是空集合 ⇒ 判 ⇄/✕ 會回報「0 張」而看起來完全正常。
  const rows = man.parts.filter((p) => partKeys(p).includes(key));
  for (const p of rows) {
    const ks = partKeys(p);
    if (ks.length === 1) man.parts.splice(man.parts.indexOf(p), 1);
    else p.keys = ks.filter((k) => k !== key);   // 兩種寫法都收斂成 keys
  }
  if (!DRY) writeJson(MANIFEST_PATH, man);
  return { ok: true, slot, rows };
}

/** 這一顆吃的是哪些照片(母照片 id / 目標 id / 族 / 零件)—— 全部由來源帳推導 */
function imgsOf(rows) {
  return rows.flatMap((p) => p.imgs || []).filter((i) => i.id);
}

/**
 * 墓碑一列(`⊘ 移除` 專用)。**欄位一律抄自剛被撤掉的那一列來源帳**,MUST NOT 在這裡重新
 * 描述那顆節點 —— 抄一份就是第二種說法,而原版已經不存在、對不起來也沒人會知道。
 * `at` 是**封存那一刻**(列的自己的時間;原本的出貨日另外留在 `shipped_at`)。
 */
function archiveRow(key, rows, it, slot) {
  const rec = rows[0] || {};
  return {
    keys: [key],
    at: new Date().toISOString(),
    why: it.note || null,
    family: slot?.family || null,
    slot: slot?.id || null,
    shipped_at: rec.at || null,
    method: rec.method || null,
    consumer: rec.consumer || null,
    rev: rec.rev || null,
    imgs: rec.imgs || [],
    gen: rec.gen || null,
    post: rec.post || null,
    note: rec.note || null,
  };
}

function main() {
  const state = loadJson(STATE_FILE, { items: {} });
  const todo = Object.entries(state.items || {})
    .filter(([key, it]) => it?.status && it.status !== 'ok' && (!ONLY || key === ONLY));
  if (!todo.length) { console.log('沒有待執行的判決(只有 ✔ 通過 或空白)'); return 0; }

  const ovr = loadJson(OVERRIDES, {});
  const hstate = loadJson(HARVEST_STATE, {});
  const arch = loadArchive();
  let done = 0, held = 0;

  for (const [key, it] of todo) {
    console.log(`\n── ${key}:${it.status}${it.note ? `(${it.note})` : ''}`);
    const w = withdraw(key);
    if (!w.ok) { console.log(`   ⏭  ${w.why}`); held++; continue; }
    const imgs = imgsOf(w.rows);

    if (it.status === 'regen') {
      // 同一張圖換參數:覆寫表以**母照片 id** 為鍵(auto_intake 與 harvest_loop 同吃這一份)
      for (const im of imgs) {
        ovr[im.id] = { ...(ovr[im.id] || {}), at: new Date().toISOString(), note: it.note || null,
          // 覆寫哪一欄由使用者填;這裡只把「上一次用的是什麼」記下來當起點,
          // 空著就是「用配方的預設再跑一次」(換 seed 的效果來自生成器本身不是決定性的那一半)
          from: { tool: w.rows[0]?.gen?.tool || null, params: w.rows[0]?.gen?.params || null } };
        // 從「已餵過」名單放回待跑池 —— 不放回去的話迴圈永遠跳過它(紀律 ②),
        // 而畫面上只表現成「判了重生卻什麼都沒發生」
        for (const k of Object.keys(hstate)) if (k.endsWith(`/${im.target || im.id}`)) delete hstate[k];
      }
      console.log(`   ⟳ ${DRY ? '(dry)會' : '已'}撤節點;覆寫表 ${imgs.length} 筆 → ${OVERRIDES}`
        + '(要調的參數請直接編這一份:cells/offset/target/fit/tool)');
    } else if (it.status === 'archive') {
      // 移除 = 撤下(上面 withdraw 已經做完三件事)+ **把那一列搬進墓碑帳**。
      // 照片一格不動:使用者要的是「不要在遊戲與台上出現」,不是「這張照片不能用」——
      // 同一張圖之後想換個參數重生仍然合法(手動 `--only` 走 regen 那一條)。
      // 不重跑靠的是 `photo_state` 把封存帳算成「人眼已處置」(⇒ 不進未覆核重跑池),
      // 而不是在這裡改語料帳本 —— 判決的紀律只有 `screen_mattes.py` 一份。
      arch.parts.push(archiveRow(key, w.rows, it, w.slot));
      console.log(`   ⊘ ${DRY ? '(dry)會' : '已'}撤節點並封存(${imgs.length} 張來源圖留著;`
        + `帳 ${ARCHIVE_PATH.replace(ROOT, '').replace(/^[\\/]/, '')})`);
    } else if (it.status === 'reimg' || it.status === 'purge') {
      // **兩個判決吃的 id 不同一層,而那是使用者的用字決定的**:
      //   ✕ 刪除來源圖 → **母照片**(整張連同它切出來的每一個目標一起刪)
      //   ⇄ 換來源圖   → 有目標就只擋那一個目標(同一張照片切出來的另一個目標可能是好的)
      const ids = [...new Set(imgs.map((i) => (it.status === 'purge' ? i.id : (i.target || i.id))))];
      const fam = imgs[0]?.family;
      const py = opt('python') || join(HOME, '.venv', 'Scripts', process.platform === 'win32' ? 'python.exe' : 'python');
      if (it.status === 'purge') {
        // 真刪 + 黑名單(唯一縫住 screen_mattes.py;這一支 MUST NOT 自己刪檔 ——
        // 刪了而帳本沒記,下一輪 fetch 會把同一張圖抓回來,日誌上完全正常)
        const r = run('刪除來源圖', py, ['screen_mattes.py', '--home', HOME, '--family', fam, '--purge', ids.join(',')], { cwd: HERE });
        if (!r.ok) { console.log('   ⏭  刪圖失敗 ⇒ 節點已撤但照片還在(下一輪會再抓一次,先修這個)'); held++; continue; }
      } else {
        const r = run('標記不再挑', py, ['screen_mattes.py', '--home', HOME, '--family', fam, '--human', 'reject', ids.join(',')], { cwd: HERE });
        if (!r.ok) { console.log('   ⏭  標記失敗'); held++; continue; }
      }
      console.log(`   ${it.status === 'purge' ? '✕ 已撤節點 + 刪圖 + 進黑名單' : '⇄ 已撤節點;照片留著但不再挑'}(${ids.length} 張)`);
    }
    delete state.items[key];       // 判決執行完就不再是待辦(帳只留還沒做的)
    done++;
  }

  if (!DRY) {
    writeJson(STATE_FILE, state);
    writeJson(OVERRIDES, ovr);
    if (existsSync(HARVEST_STATE)) writeJson(HARVEST_STATE, hstate);
    // 封存帳只在真的有東西進去時才落地(空檔案會讓「有沒有封存過」看起來像有)
    if (arch.parts.length) writeJson(ARCHIVE_PATH, { version: 1, parts: arch.parts });
  }
  const clean = DRY ? true : gapsClean();
  console.log(`\n── 執行 ${done} 筆、擱置 ${held} 筆;對照台缺口:${clean ? '乾淨' : '**有缺口 —— 先修再 commit**'}`);
  if (done) {
    console.log('   判 regen 的請編 intake_overrides.json 後重跑 harvest_loop;判 purge/reimg 的下一輪自動不會再挑到。');
    console.log('   判 archive 的已進封存區(零件台「封存區」分頁看得到;來源圖留著但不再自動重跑)。');
  }
  return clean ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
