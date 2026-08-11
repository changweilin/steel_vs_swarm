#!/usr/bin/env node
// ============ 自動入庫 + 人眼事後判決迴路的稽核(2026-08-10)============
//
// 被驗的那條縫:`intake_recipes.mjs`(配方)/ `auto_intake.mjs`(第 ⑦ 站)/
// `apply_verdicts.mjs`(第 ⑨ 站)/ `screen_mattes.py --purge`(黑名單)。
//
// **為什麼這一支存在**:自動入庫把「東西進不進遊戲」從人手交給腳本,而這條路上每一種壞法
// 都是**沒有錯誤訊息**的那一種 ——
//   ・開了一個新名冊格(fallback 描述子是腳本瞎編的)⇒ 載入失敗時降級成一個錯的形狀
//   ・回滾只還原兩份檔 ⇒ 對照台多一列缺件/孤兒,而遊戲照跑、稽核全綠
//   ・追加讓預算除數變小 ⇒ 既有節點集體超標(而超標的理由與這次追加無關)
//   ・黑名單只擋一邊 ⇒ 判了「刪除來源圖」,下一輪又把同一張圖抓回來重跑一次
//   ・節點名用 `names.length` 當序號 ⇒ 撤掉中間一顆之後撞名,而撞名在 normalize `--base`
//     那一側是**取代**語意:一顆還在服役的節點被無聲換掉,兩邊讀數都正常
//
// 反向驗證(原則 9;每一支都 MUST 讓對應段落紅字):
//   --break-append     追加的產物多開一格   ⇒ Ⅳ 紅
//   --break-rollback   快照不記「本來不存在」 ⇒ Ⅶ 紅
//   --break-blacklist  刪圖時把 ok 改成 false ⇒ Ⅵ 紅
//   --break-spawn      零件台自己 spawn 行程 ⇒ Ⅸ 紅(閘門變成兩份)
//   --break-panel      面板自己判圖檔狀態    ⇒ Ⅸ 紅(第六本帳)
//   --break-pane       保險絲又被當成「原版」並排 ⇒ Ⅸ 紅(那不是同源新舊版本)
//   --break-home       掃姊妹 worktree 又綁回「ROOT 是不是 worktree」 ⇒ Ⅸ 紅(從主檢出找不到語料)
//   --break-corpus     第 ⑦⑧ 站的閘退回只看指令列旗標 ⇒ Ⅹ 紅(非出貨語料家會進遊戲)
// Ⅸ 的**三態順序**沒有 break 旗標,理由是它已經被四條固定期望值釘死(todo/done/dropped/fix
// 各一條,且 fix 那一條刻意同時滿足 dropped)—— 分支被調換位置時至少有一條會紅。
//
// 零 npm 依賴;Ⅵ 需要 python + numpy/PIL/scipy(`screen_mattes.py` 的既有相依),
// 缺席就整段標「未驗」而不是靜默跳過(原則 6:降級要看得見)。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROOT, readSrc } from '../audit_src.mjs';
import { biomesSrc, fbEnvelope, triBudget } from './parts_src.mjs';
import {
  RECIPES, rosterSlots, nextNodeName, slotTriCap, slotUv, normalizeArgs, fitWithinEnvelope, splitNodeName,
} from './intake_recipes.mjs';
import { appendRoster, verifyRoster, snapshot, restore, pickSlot } from './auto_intake.mjs';
import { removeRoster } from './apply_verdicts.mjs';
import { photoStates, STATES } from './photo_state.mjs';
import { corpusMeta } from './provenance.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BREAK_APPEND = process.argv.includes('--break-append');
const BREAK_ROLLBACK = process.argv.includes('--break-rollback');
const BREAK_BLACKLIST = process.argv.includes('--break-blacklist');
const BREAK_SPAWN = process.argv.includes('--break-spawn');
const BREAK_PANEL = process.argv.includes('--break-panel');
const BREAK_PANE = process.argv.includes('--break-pane');
const BREAK_HOME = process.argv.includes('--break-home');
const BREAK_CORPUS = process.argv.includes('--break-corpus');

let pass = 0, fail = 0, unverified = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.log(`  ❌ ${m}`); } };
const skip = (m) => { unverified++; console.log(`  ⚠ 未驗:${m}`); };

/**
 * `--break-*` 的字面注入。**替換無效 MUST 當場失敗**(㋑):被改名/刪掉的錨點會讓注入變成
 * 無聲 no-op,而那時 `--break-*` 是**綠的** —— 反向驗證看起來跑了,其實什麼都沒驗到。
 * (2026-08-10 實測踩到一次:`--break-panel` 的錨點函式在同一輪被改寫掉,旗標整支空轉。)
 */
function inject(src, anchor, replacement, flag) {
  if (!src.includes(anchor)) {
    console.error(`\n💥 ${flag} 的注入錨點不存在(「${anchor}」)—— 反向驗證會變成無聲 no-op`);
    process.exit(2);
  }
  return src.replace(anchor, replacement);
}

const RAW = readFileSync(join(ROOT, 'public', 'js', 'biomes.js'), 'utf8');
const slots = rosterSlots();
const budget = triBudget();

// ============ Ⅰ 配方表與消費端雙向釘住 ============
console.log('\nⅠ 配方表與消費端雙向釘住(可自動追加的格 = 值是陣列的那些格,推導不手寫)');
{
  ok(slots.length > 0, `推導出 ${slots.length} 個輪替名冊格(${slots.map((s) => s.id).join(', ')})`);
  for (const s of slots) {
    ok(!!s.recipe, `${s.id} 有配方(沒有 = 這一格永遠自動不了,而畫面與今天一樣沒有錯誤訊息)`);
    if (!s.recipe) continue;
    const f = fitWithinEnvelope(s);
    ok(f.ok, `${s.id} 的 fit ${s.recipe.fit} 收在 fallback 包絡內(r ${f.env.r.toFixed(3)} / hy ${f.env.hy.toFixed(3)})`);
    ok(slotTriCap(s, budget) > 0, `${s.id} 的逐件三角形上限算得出來(${slotTriCap(s, budget)},推導自量測檔)`);
    ok(s.names.length >= 1, `${s.id} 名冊非空(${s.names.length} 顆)`);
  }
  for (const id of Object.keys(RECIPES)) {
    ok(slots.some((s) => s.id === id), `配方鍵 ${id} 對得上一個現役名冊格(對不上 = 手寫鍵已過期)`);
  }
  // UV 契約與三角形上限 MUST 取量測檔那一份(抄第二份 ⇒ 匯出端與 intake 用兩個帶寬,兩邊都不報錯)
  for (const s of slots.filter((x) => x.recipe)) {
    const uv = slotUv(s, budget);
    const declared = budget?.families?.[s.budgetFam]?.[s.budgetKind]?.uv ?? null;
    ok(uv === declared, `${s.id} 的 UV 契約取自 tri_budget(${uv ?? '無'})`);
    const args = normalizeArgs(s, nextNodeName(s), 'SRC.glb', budget) || [];
    const wantUv = uv === 'roofband' ? '--roofband' : uv ? '--boxuv' : null;
    ok(wantUv ? args.includes(wantUv) : !args.some((a) => a === '--boxuv' || a === '--roofband'),
      `${s.id} 的 normalize 旗標與 UV 契約同調(${wantUv || '不吃貼圖'})`);
  }
}

// ============ Ⅱ 預算不隨名冊長度改變 ============
console.log('\nⅡ 預算不隨名冊長度改變(追加一顆 MUST NOT 讓既有節點集體超標)');
{
  for (const s of slots.filter((x) => x.recipe)) {
    const before = slotTriCap(s, budget);
    // 名冊長度 +1 的同一格(其餘一切不動)—— 上限 MUST 逐位元相等
    const grown = { ...s, names: [...s.names, nextNodeName(s)] };
    const after = slotTriCap(grown, budget);
    ok(before === after, `${s.id}:名冊 ${s.names.length} → ${grown.names.length} 顆,逐件上限 ${before} 不變`);
  }
  // 逐款 Σ 那道閘(`kind_factor`)只有 tree 族有,而 tree 沒有任何輪替名冊格 ——
  // 哪天有人給 megalith/building 加上 kind_factor,追加就會把既有節點一起擠爆 ⇒ 這裡先擋住
  for (const s of slots.filter((x) => x.recipe)) {
    ok(budget?.families?.[s.budgetFam]?.kind_factor == null,
      `${s.budgetFam} 族沒有逐款 Σ 閘(有的話「追加一顆」會連帶影響同款既有節點)`);
  }
}

// ============ Ⅲ 命名推導(不撞名、不用 length 當序號)============
console.log('\nⅢ 節點命名推導');
{
  for (const s of slots.filter((x) => x.recipe)) {
    const n = nextNodeName(s);
    ok(!!n && !s.names.includes(n), `${s.id} → ${n}(不撞現役名冊)`);
    ok(splitNodeName(n).prefix === s.prefix, `${n} 的前綴沿用同格兄弟(${s.prefix})`);
  }
  // **中間撤掉一顆之後**仍不撞名 —— 這一條就是「MUST NOT 用 names.length 當序號」的執行版:
  // a,b,c 撤掉 b ⇒ length 2 ⇒ 用 length 會給出 `_c`,而 c 還在服役(normalize --base 撞名 = 取代)
  const s = slots.find((x) => x.recipe && x.names.length >= 3);
  if (s) {
    const holed = { ...s, names: s.names.filter((_, i) => i !== 1) };
    const n = nextNodeName(holed);
    // 撤掉中間那一顆之後,序號是**有洞**的。兩件事各驗一次:
    //   ㋐ 推導版填洞、而且填的那個名字沒有人在用(那一顆已經連 GLB 節點一起撤掉了)
    //   ㋑ 拿 `names.length` 當序號的話會撞上一顆**還在服役**的節點 —— 而撞名在
    //      `normalize_parts --base` 那一側是「取代」語意:它會被無聲換掉,兩邊讀數都正常
    const lengthBased = `${s.family}/${s.prefix}_${String.fromCharCode(97 + holed.names.length)}`;
    ok(!holed.names.includes(n), `${s.id} 撤掉中間一顆後 → ${n},不撞現役名冊`);
    ok(holed.names.includes(lengthBased),
      `拿 length 當序號會給出 ${lengthBased} —— 它還在服役 ⇒ 推導版避開了這個撞名`);
  } else skip('沒有 ≥3 顆的名冊格可以驗「中間撤掉一顆」');
}

// ============ Ⅳ 只准追加(verifyRoster 是那道閘)============
console.log('\nⅣ 只准追加到既有格');
{
  const s = slots[0];
  const n = nextNodeName(s);
  const a = appendRoster(RAW, s, n);
  ok(a.ok, `${s.id}:錨定追加成功(${a.ok ? '' : a.why})`);
  if (a.ok) {
    // `--break-append`:讓追加的產物**多開一格**(腳本瞎編一個 fallback 描述子的那種壞法)
    let produced = a.src;
    if (BREAK_APPEND) {
      produced = inject(produced, 'const MEGA_LIB = {',
        "const MEGA_LIB = {\n  bogus: ['rock/bogus_a', 'rock/bogus_b'],", '--break-append');
    }
    const v = verifyRoster(produced.replace(/\r\n?/g, '\n'), s, n);
    ok(v.ok, `追加後重新執行真品原文:格數不變、目標格恰多一顆、其餘逐位元不變${v.ok ? '' : ` ── ${v.why}`}`);
    // 換行 MUST 原樣(readSrc 會正規化成 \n;拿它寫回去 = 整支 biomes.js 換行全改)
    ok(RAW.includes('\r\n') === a.src.includes('\r\n'), '追加不改變換行形式(CRLF 工作區逐位元安全)');
  }
  // 三種「不是純追加」的產物 MUST 被擋下來
  const bogusSlot = RAW.replace(/const MEGA_LIB = \{/, "const MEGA_LIB = {\n  bogus: ['rock/bogus_a'],");
  ok(!verifyRoster(bogusSlot.replace(/\r\n?/g, '\n'), s, n).ok, '開新格 ⇒ 擋下');
  const other = slots.find((x) => x.id !== s.id);
  if (other) {
    const touched = RAW.replace(`'${other.names[other.names.length - 1]}'`,
      `'${other.names[other.names.length - 1]}', '${other.family}/sneaky_z'`);
    ok(!verifyRoster(touched.replace(/\r\n?/g, '\n'), s, n).ok, '順手動到別格的名冊 ⇒ 擋下');
  }
  const fbTouched = RAW.replace("mass: [['building/mass_a'", "mass: [['building/mass_a'")
    .replace(/masslow: \[\[('building\/masslow_a'[^\]]*)\], \['box', 1, 1, 1\]\]/,
      "masslow: [[$1], ['box', 2, 1, 1]]");
  ok(!verifyRoster(fbTouched.replace(/\r\n?/g, '\n'), s, n).ok, '動到別格的 fallback 描述子 ⇒ 擋下');
}

// ============ Ⅴ 撤下:名冊移除逐位元可逆 ============
console.log('\nⅤ 撤下(apply_verdicts 的名冊移除)');
{
  for (const s of slots.filter((x) => x.recipe)) {
    const n = nextNodeName(s);
    const a = appendRoster(RAW, s, n);
    if (!a.ok) { ok(false, `${s.id} 追加失敗,無法驗往返`); continue; }
    const r = removeRoster(a.src, n);
    ok(r.ok && r.src === RAW, `${s.id}:追加 → 撤下 **逐位元**回到原文${r.ok ? '' : ` ── ${r.why}`}`);
  }
  // 頭 / 中 / 尾三種位置都要能撤(樣式只有三條,少一條就是「撤不掉而且理由看不出來」)
  const s = slots.find((x) => x.names.length >= 3);
  if (s) {
    for (const [pos, name] of [['頭', s.names[0]], ['中', s.names[1]], ['尾', s.names[s.names.length - 1]]]) {
      const r = removeRoster(RAW, name);
      ok(r.ok && !r.src.includes(`'${name}'`), `${s.id} 撤掉${pos}一顆(${name})`);
    }
  } else skip('沒有 ≥3 顆的名冊格可以驗頭/中/尾三種位置');
  ok(!removeRoster(RAW, 'rock/not_a_real_node').ok, '撤一顆不存在的 ⇒ 明確失敗(不靜默略過)');
}

// ============ Ⅵ 黑名單:兩個消費端同吃一份 ============
console.log('\nⅥ 刪除來源圖的黑名單(fetch 的 seen / usable 與 harvest 的 rejected 同吃一份)');
{
  // 真品原文裡的兩個判準(㋑:抄一份公式進稽核就永遠會通過)
  const fsrc = readSrc('tools', 'ai3d', 'fetch_photos.mjs');
  const usableSrc = fsrc.match(/const usable = (\(e\) => [^;]+);/)?.[1];
  // seen 的載重那一半就是 `e.ok ||` —— 「條目在不在 seen 裡」決定同一張圖會不會被重新下載,
  // 而 purge 之所以 MUST 維持 `ok: true` 就是為了留在這個集合裡
  const persistSrc = fsrc.match(/const PERSIST_FAIL_RE = (\/.+\/);/)?.[1];
  const seenSrc = fsrc.match(/&& \(e\.ok \|\| PERSIST_FAIL_RE\.test\(e\.error \|\| ''\)\)\)/)?.[0];
  ok(!!usableSrc, 'fetch_photos.mjs 的 usable() 抽得到(抽不到 = 這一段在驗一個不存在的東西)');
  ok(!!seenSrc && !!persistSrc, 'fetch_photos.mjs 的 seen 判準抽得到(它決定「同一張圖會不會被重新下載」)');
  const hsrc = readSrc('tools', 'ai3d', 'harvest_loop.mjs');
  ok(/screen\?\.v === 'reject'/.test(hsrc), 'harvest_loop.pendingMattes 的淘汰判準吃 screen.v === reject');

  const py = spawnSync('python', ['-c', 'import numpy,PIL,scipy'], { encoding: 'utf8' });
  if (py.status !== 0) skip('沒有 python + numpy/PIL/scipy ⇒ apply_purge 的行為直測跳過');
  else {
    const home = mkdtempSync(join(tmpdir(), 'svs-purge-'));
    try {
      mkdirSync(join(home, 'photos', 'rock', 'facet'), { recursive: true });
      mkdirSync(join(home, 'out', 'matte', 'rock', 'facet'), { recursive: true });
      writeFileSync(join(home, 'photos', 'rock', 'facet', 'zz_x.jpg'), 'not-a-real-jpeg');
      writeFileSync(join(home, 'out', 'matte', 'rock', 'facet', 'zz_x.png'), 'not-a-real-png');
      writeFileSync(join(home, 'photo_manifest.json'), JSON.stringify([{
        family: 'rock', part: 'facet', id: 'zz_x', ok: true, license: 'cc0',
        file: 'photos/rock/facet/zz_x.jpg',
        screen: { v: 'pass', why: 'stats', at: '2026-01-01T00:00:00Z' },
      }], null, 2));
      const r = spawnSync('python', ['screen_mattes.py', '--home', home, '--family', 'rock', '--purge', 'zz_x'],
        { cwd: HERE, encoding: 'utf8' });
      ok(r.status === 0, `screen_mattes.py --purge 跑得起來${r.status === 0 ? '' : `(${(r.stderr || '').split('\n').slice(-3).join(' ')})`}`);
      const after = JSON.parse(readFileSync(join(home, 'photo_manifest.json'), 'utf8'));
      const e = after.find((x) => x.id === 'zz_x');
      ok(!existsSync(join(home, 'photos', 'rock', 'facet', 'zz_x.jpg')), '原圖真的被刪掉');
      ok(!existsSync(join(home, 'out', 'matte', 'rock', 'facet', 'zz_x.png')), '它的 matte 也被刪掉(留著 = 下一輪又推進管線一次)');
      ok(!!e, '帳本條目**留著**(條目本身就是黑名單)');
      if (e) {
        // `--break-blacklist`:把 ok 改成 false —— 直覺上「這張不能用了」該這樣寫,
        // 而它會讓 seen 判準漏掉這一筆 ⇒ **下一輪重新下載同一張圖**,兩邊都不報錯
        if (BREAK_BLACKLIST) e.ok = false;
        ok(!!e.purged, 'purged 戳記寫上了');
        ok(e.screen?.v === 'reject' && e.screen?.why === 'human',
          `淘汰以 screen 表達且 why = human(統計重跑不覆寫;實得 ${e.screen?.v}/${e.screen?.why})`);
        // 兩個判準都用**真品原文**執行(抄一份公式進稽核就永遠會通過)
        const usable = new Function(`return ${usableSrc}`)();
        ok(!usable(e), 'usable() 判 false ⇒ 不再算進「已經抓夠了」');
        const seen = new Function(`const PERSIST_FAIL_RE = ${persistSrc}; return (e) => (e.ok || PERSIST_FAIL_RE.test(e.error || ''));`)();
        ok(seen(e), 'seen 判準仍收得到它 ⇒ **不會被重新下載**(這一條就是 --break-blacklist 咬的那一條)');
        ok(e.screen.v === 'reject', 'harvest 的 rejected 集合吃得到 ⇒ 不會再被送上 GPU');
      }
    } finally { rmSync(home, { recursive: true, force: true }); }
  }
}

// ============ Ⅶ 回滾逐位元 ============
console.log('\nⅦ 回滾(入庫失敗 MUST 逐位元回到入庫前)');
{
  const home = mkdtempSync(join(tmpdir(), 'svs-roll-'));
  try {
    const kept = join(home, 'kept.txt');
    const born = join(home, 'born.glb');      // 入庫**新建**的那支 GLB:回滾要把它刪掉
    writeFileSync(kept, Buffer.from('原文第一行\r\n原文第二行\r\n', 'utf8'));
    let snap = snapshot([kept, born]);
    // `--break-rollback`:快照不記「本來不存在」的檔(只記有內容的那幾份)——
    // 最像真的那種壞法,而它的症狀是「名冊回滾了、GLB 卻多一支」= 對照台一列孤兒
    if (BREAK_ROLLBACK) snap = new Map([...snap].filter(([, v]) => v !== null));
    writeFileSync(kept, Buffer.from('被入庫改過了\n', 'utf8'));
    writeFileSync(born, Buffer.from('新生成的 GLB', 'utf8'));
    restore(snap);
    ok(readFileSync(kept, 'utf8') === '原文第一行\r\n原文第二行\r\n', '既有檔逐位元還原(含 CRLF)');
    ok(!existsSync(born), '入庫新建的檔被刪掉(留著 = 對照台一列孤兒,而每一支稽核都是綠的)');
  } finally { rmSync(home, { recursive: true, force: true }); }

  // 真品:第 ⑦ 站每一條失敗路徑都經過同一個 `undo`(各寫一份還原 = 漏掉其中一條)
  const asrc = readSrc('tools', 'ai3d', 'auto_intake.mjs');
  const undoN = (asrc.match(/return undo\(/g) || []).length;
  const restoreN = (asrc.match(/\brestore\(/g) || []).length;
  ok(undoN >= 6, `逐顆入庫的失敗出口全部走 undo(${undoN} 條)`);
  ok(restoreN <= 3, `還原只由 undo 與整輪回滾呼叫(restore 出現 ${restoreN} 次,散開就會漏)`);
  ok(/沒有投料帳 \.feed\.json/.test(asrc), '沒有投料帳就不入庫(規則 9:說不出方法與圖的不算完成)');
  const vsrc0 = readSrc('tools', 'ai3d', 'apply_verdicts.mjs');
  ok(!/git (commit|push)/.test(asrc) && !/git (commit|push)/.test(vsrc0),
    '⑦⑨ 兩站都不 commit / push(「沒 commit 就是還沒出貨」是人眼那道閘的本錢)');
  // 缺口判準只有一份,而且吃 `\s+` —— 報表是對齊欄位(「缺件    0」),寫死一個空格
  // 會讓這道閘**永遠判乾淨**:入庫留下一列缺件而每一支稽核都是綠的
  ok(/缺件\\s\+/.test(asrc), '缺口樣式吃 \\s+(報表是對齊欄位,寫死單一空格會永遠判乾淨)');
  ok((vsrc0.match(/function gapsClean/g) || []).length === 0 && /gapsClean/.test(vsrc0),
    '第 ⑨ 站的缺口判準 import 自第 ⑦ 站(各寫一份 = 兩站對同一份缺口給出兩種答案)');
}

// ============ Ⅷ 判決字彙 ↔ 動作 ============
console.log('\nⅧ 對照台判決字彙與 apply_verdicts 的動作一一對應');
{
  const rsrc = readSrc('tools', 'parts_review', 'review.js');
  const block = rsrc.match(/const STATUS = \{([\s\S]*?)\n\};/)?.[1] || '';
  const keys = [...block.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
  ok(keys.length >= 4, `判決字彙 ${keys.length} 個(${keys.join(', ')})`);
  ok(keys.includes('purge'), 'purge(✕ 刪除來源圖)在字彙裡 —— 人眼搬到入庫之後,判決就要能撤');
  const vsrc = readSrc('tools', 'ai3d', 'apply_verdicts.mjs');
  for (const k of keys) {
    ok(new RegExp(`'${k}'`).test(vsrc), `apply_verdicts 認得 ${k}`);
  }
  // 「有意見」MUST 由 STATUS 推導 —— 手寫第二份清單會在加第五個出口時靜默過期
  ok(!/\['regen',\s*'reimg'\]/.test(rsrc), '「有意見」不是手寫的狀態清單(由 STATUS 推導)');
  ok(/STATUS\[st\]\?\.\[1\] === 'flag'/.test(rsrc), '「有意見」= STATUS 表裡標 flag 的那些');
}

// ============ Ⅸ 圖檔三態 + 零件台啟停 ============
console.log('\nⅨ 圖檔三態(未處理/已處理/需修正)與零件台的啟停閘門');
{
  // (a) 四種組合各驗一次 —— **這四條合起來就把分支順序釘死了**:任何一個分支被調到別的
  //     位置,至少一條會紅。這就是這一段的反向驗證(順序本身是語意,不是實作細節)。
  const home = mkdtempSync(join(tmpdir(), 'svs-state-'));
  try {
    const rev = join(home, 'review.json');
    const prov = join(home, 'prov.json');
    writeFileSync(join(home, 'photo_manifest.json'), JSON.stringify([
      { family: 'rock', part: 'facet', id: 'p_todo', ok: true },
      { family: 'rock', part: 'facet', id: 'p_done', ok: true },
      { family: 'rock', part: 'facet', id: 'p_drop', ok: true, screen: { v: 'reject', why: 'blank' } },
      // 同時「被淘汰」與「有待執行判決」—— 判決 MUST 贏(下一步在人身上)
      { family: 'rock', part: 'facet', id: 'p_fix', ok: true, screen: { v: 'reject', why: 'blank' } },
    ]));
    writeFileSync(join(home, 'harvest_state.json'), JSON.stringify({
      'rock/facet/p_done': 'x', 'rock/facet/p_fix': 'x',
    }));
    writeFileSync(prov, JSON.stringify({
      version: 1,
      parts: [{ method: 'sf3d', keys: ['rock/mega_z'], imgs: [{ id: 'p_fix', license: 'cc0', source_url: 'x' }] }],
    }));
    writeFileSync(rev, JSON.stringify({ version: 1, items: { 'rock/mega_z': { status: 'regen', note: '太薄' } } }));
    const st = photoStates(home, { reviewPath: rev, provPath: prov });
    const of = (id) => st.rows.find((r) => r.id === id)?.state;
    ok(st.ok, '合成資料家讀得起來');
    ok(of('p_todo') === 'todo', '未送過生成、沒被淘汰 ⇒ 未處理');
    ok(of('p_done') === 'done', '送過生成 ⇒ 已處理');
    ok(of('p_drop') === 'dropped', '被選片閘判掉 ⇒ 已淘汰(獨立一態,不併進已處理/未處理)');
    ok(of('p_fix') === 'fix', '有待執行的人眼判決 ⇒ 需修正(**勝過**已淘汰與已處理)');
    ok(st.rows.length === 4 && st.rows.every((r) => STATES[r.state]),
      '每一列恰好落在一個宣告過的狀態(互斥且涵蓋)');
    ok(Object.values(st.counts).reduce((a, b) => a + b, 0) === st.rows.length, '計數加總 = 列數');
  } finally { rmSync(home, { recursive: true, force: true }); }

  // (b) 「已執行的判決」不算 —— apply_verdicts 做完會把該筆刪掉,`ok` 也不是待辦
  ok(/it\.status === 'ok'/.test(readSrc('tools', 'ai3d', 'photo_state.mjs')),
    '✔ 通過不算待執行判決(否則每一張出貨過的圖都會永遠停在「需修正」)');

  // (c) 啟停閘門**只有一份**:零件台掛的是 dev_supervisor 的 handle,MUST NOT 自己 spawn
  let prSrc = readSrc('tools', 'parts_review.mjs');
  if (BREAK_SPAWN) {
    prSrc = inject(prSrc, "if (u.pathname.startsWith('/dev/tools'))",
      "if (u.pathname === '/api/run') { spawn(process.execPath, ['x']); }\n      if (u.pathname.startsWith('/dev/tools'))", '--break-spawn');
  }
  ok(/import\('\.\/dev_supervisor\.mjs'\)/.test(prSrc) && /sup\.handle\(req, res/.test(prSrc),
    '零件台的啟停走 dev_supervisor.handle(全專案唯一「HTTP → spawn」的閘門)');
  ok(!/\bspawn\s*\(/.test(prSrc),
    '零件台自己不 spawn(兩個入口兩套閘 ⇒ 漏掉的那一套沒有任何錯誤訊息)');

  // (d) argv 零信任:資料家是**推導**出來的,請求碰不到
  const dsSrc = readSrc('tools', 'dev_supervisor.mjs');
  ok(/export function argvOf\(t\)/.test(dsSrc) && !/argvOf\([^)]*req/.test(dsSrc),
    'argvOf 只吃工具本身(請求進不了命令列)');
  ok(/spawn\(process\.execPath, \[t\.script, \.\.\.argv\]/.test(dsSrc), 'spawn 的 argv 來自 argvOf');
  ok(/corpusHome\(\)/.test(dsSrc), '資料家由 corpusHome() 推導(語料家會搬,寫死等於下次就錯)');
  // 語料家與模型棧家是**兩件事**(runbook §5d 刻意不同住)。少了 `--venv`,harvest_loop 的
  // VENV_HOME 預設成 --home ⇒ 去背/圈選分離/選片閘/生成四站全跳過,而鈕面顯示「執行中」、
  // 每輪照印「生成 0」—— 迴圈啟動了,但永遠產不出東西,且沒有任何錯誤訊息。
  ok(/venvHome\(\)/.test(dsSrc) && /'--venv'/.test(dsSrc),
    '模型棧家另外由 venvHome() 推導後帶 --venv(讓它預設等於語料家 = 四站全部靜默跳過)');
  ok(/argv\.push\('--t2', process\.env\.SVS_T2_HOME\)/.test(dsSrc),
    'T2-spz 的 checkout 在儲存庫之外 ⇒ 由環境變數給,MUST NOT 寫死某一台機器的路徑');
  ok(!/venvHome\(\)\s*\|\|\s*corpusHome\(\)|corpusHome\(\)\s*\|\|\s*venvHome\(\)/.test(dsSrc),
    '兩個家 MUST NOT 互相當預設值(推不到就不加旗標,降級不例外)');
  // job 的存活判準 MUST NOT 是埠 —— 採集迴圈不聽任何埠,拿 listening 去問它會永遠回「沒開」,
  // 而每按一次啟動就多開一支(兩支同時寫 harvest_state.json,畫面完全正常)
  ok(/kind === 'job'/.test(dsSrc) && /alive\(running\.get\(t\.key\)\)/.test(dsSrc),
    'job 的「已經在跑了嗎」問的是自己的子行程,不是埠');

  // (e) 面板只負責畫 —— 判準一個都不准住在頁面上
  let rvSrc = readSrc('tools', 'parts_review', 'review.js');
  if (BREAK_PANEL) {
    rvSrc = inject(rvSrc, 'function renderPhotoBody(id) {',
      "function renderPhotoBody(id) {\n  const st = r.screen.v === 'reject' ? 'dropped' : 'todo';", '--break-panel');
  }
  // 驗的是「頁面有沒有**算**狀態」,不是「有沒有提到那幾個字」——
  // 顯示伺服器算好的 `r.screen` / 在說明文字裡寫 `photo_manifest.json` 都不是判斷。
  ok(!/screen\??\.v\s*===|screen\??\.v\s*\?|harvest_state/.test(rvSrc),
    '頁面不自己判狀態(它會與迴圈說出兩套話,而兩邊都不會報錯)');
  ok(/x-dev-tools/.test(rvSrc), '頁面送出的 POST 帶 x-dev-tools 標頭(邊界 ④)');

  // (f) **只比對同源物件的新舊版本**(2026-08-10 使用者定案)。
  //     保險絲 primitive 不是庫節點的前一版(它是降級路徑),並排會讀成
  //     「AI 版 vs 原版」而那個「原版」從來沒有出貨過。
  let paneSrc = rvSrc;
  if (BREAK_PANE) {
    paneSrc = inject(paneSrc, 'const PANE_LABEL = {',
      "const PANE_LABEL = {\n  'fuse-vs-lib': ['原版(保險絲 primitive)', 'AI 生成'],", '--break-pane');
  }
  ok(!/'fuse-vs-lib'/.test(paneSrc), '並排模式裡沒有「保險絲 vs 庫節點」(那不是同源新舊版本)');
  ok(/'baseline-vs-now'/.test(paneSrc), '同源新舊版本(改寫前/後的同一份零件表)仍然並排');
  ok(/繪製方法/.test(paneSrc), '單獨陳列時 MUST 標注繪製方法(使用者定案的那一句)');
  ok(!/'fuse-vs-lib'/.test(prSrc), '伺服器端也不再送出 fuse-vs-lib 這個模式');
  // 「零件」取景不該綁在並排與否上 —— 綁了的話 GLB 那一路改單獨陳列之後整批變灰,
  // 而灰掉的理由(「沒有節點可隔離」)是假的
  ok(/const partFramable = \(r\) => !!r\.view\?\.node/.test(paneSrc),
    '「零件」取景的條件是「有沒有 GLB 節點可隔離」,不是「有沒有在並排」');

  // (g) 語料圖的兩支 API:路徑與 argv **一律從帳本取**,請求只能「挑一筆現有的」
  ok(/man\.find\(\(x\) => x\.id === id\)/.test(prSrc),
    '/api/photo 的檔案路徑由帳本解析(讓請求決定路徑 = 開一個任意讀檔的洞)');
  ok(/join\('out', 'matte'/.test(prSrc),
    'matte 走約定路徑(`entry.matte` 是去背 bbox 物件不是路徑,當路徑用會安靜地退回原圖)');
  ok(/man\.find\(\(x\) => x\.id === body\.id\)/.test(prSrc) && /\.\.\.act\]/.test(prSrc),
    '/api/screen 的 id 與 family 從帳本取,不是把請求字串接進命令列');
  ok(/'--human', 'pass'.*'--human', 'reject'.*'--purge'/s.test(prSrc)
    && !/photo_manifest[\s\S]{0,200}writeFile/.test(prSrc),
    '/api/screen 只轉呼 screen_mattes(判決紀律住那一支,這裡 MUST NOT 自己改帳本)');
  ok(/x-dev-tools'\] !== '1'/.test(prSrc), '/api/screen 也要 x-dev-tools 標頭(它會改帳本與刪檔)');

  // (h) 明指的資料家排第一 —— 筆數排序是「沒人告訴我用哪個」時的推導,不該蓋掉明講的選擇
  ok(/b\.explicit - a\.explicit/.test(readSrc('tools', 'ai3d', 'provenance.mjs')),
    '`--photos` / `--home` 明指的資料家排在筆數排序之前');

  // (i) **從主檢出也要找得到語料**(2026-08-11 修的那個 bug)。
  //     照片 gitignore ⇒ 主檢出的 `tools/ai3d/` 永遠沒有帳本,語料一律住某個 worktree。
  //     舊版把「掃姊妹 worktree」綁在「ROOT 自己是不是 worktree」上 ⇒ 使用者從主檢出
  //     `npm start` / `npm run parts` 時 `corpusHome()` 回 null,採集迴圈那顆鈕按下去只說
  //     「找不到任何有 photo_manifest.json 的資料家」。而開發時每一支稽核都在 worktree 裡跑
  //     (那裡剛好匹配)⇒ **全綠**。⇒ 這一條 MUST 是**行為**斷言:搭一棵主檢出形狀的假樹,
  //     語料只放在姊妹 worktree,直接問 `corpusHome()`。原文斷言驗不到這種「只在別的
  //     checkout 形狀下才成立」的錯。
  const fake = mkdtempSync(join(tmpdir(), 'svs-home-'));
  try {
    let pvSrc = readSrc('tools', 'ai3d', 'provenance.mjs');
    if (BREAK_HOME) {
      // 單行注入(㋑:含換行的字面替換在 CRLF 工作區是無聲 no-op)——
      // 把「不是 worktree 就用 ROOT 自己」改掉 = 等價於那一圈沒跑
      pvSrc = inject(pvSrc, 'const main = m ? m[1] : ROOT;',
        "const main = m ? m[1] : join(ROOT, '__no_sweep__');", '--break-home');
    }
    mkdirSync(join(fake, 'tools', 'ai3d'), { recursive: true });
    writeFileSync(join(fake, 'tools', 'audit_src.mjs'),
      "import { dirname } from 'node:path';\nimport { fileURLToPath } from 'node:url';\n"
      + 'export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));\n');
    writeFileSync(join(fake, 'tools', 'ai3d', 'provenance.mjs'), pvSrc);
    // 語料只住姊妹 worktree(如實重現:主檢出那一份沒有帳本)
    const corpus = join(fake, '.claude', 'worktrees', 'corpus-wt', 'tools', 'ai3d');
    mkdirSync(corpus, { recursive: true });
    writeFileSync(join(corpus, 'photo_manifest.json'), JSON.stringify([{ id: 'a' }, { id: 'b' }]));
    const mod = await import(pathToFileURL(join(fake, 'tools', 'ai3d', 'provenance.mjs')).href);
    const got = mod.corpusHome();
    ok(got !== null && resolve(got) === resolve(corpus),
      'ROOT 是主檢出時也掃得到姊妹 worktree 的語料(否則採集迴圈在使用者那台永遠啟動不了)');
  } finally { rmSync(fake, { recursive: true, force: true }); }
}

// ============ Ⅹ 非出貨語料家(corpus.json) ============
// 2026-08-11 使用者定案:「授權問題的照片放在專案外一樣的路徑跑 img to 3D 管線,**先別放
// 遊戲中**」+ 出貨閘選「只跑到 contact sheet 就停」。那條路唯一的弱點是「每次都要記得加
// `--no-intake`」⇒ 旗標改掛在**家**上面(`<家>/corpus.json`),忘不掉。
console.log('\nⅩ 非出貨語料家(corpus.json:授權未確認的那一份只跑到 contact sheet)');
{
  const dir = mkdtempSync(join(tmpdir(), 'svs-corpus-'));
  try {
    // (a) 預設與退化方向 —— **兩個都 MUST 是「當出貨用」**:沒宣告要逐位元同舊行為,
    //     而壞掉的宣告檔 MUST NOT 變成放行非 CC0 的後門(寧缺勿錯)
    ok(corpusMeta(dir).shipping === true, '沒有 corpus.json ⇒ 出貨用(現役語料逐位元同舊行為)');
    ok(corpusMeta(null).shipping === true, '家是 null ⇒ 出貨用');
    writeFileSync(join(dir, 'corpus.json'), '{ 這不是 JSON');
    ok(corpusMeta(dir).shipping === true, 'corpus.json 讀不懂 ⇒ 當出貨用(壞掉的宣告 MUST NOT 變成後門)');
    writeFileSync(join(dir, 'corpus.json'), JSON.stringify({ shipping: false, why: '授權未確認' }));
    const m = corpusMeta(dir);
    ok(m.shipping === false && m.declared === true && /授權/.test(m.why || ''),
      'shipping:false 讀得出來,而且理由帶得出來(面板要標給人看)');
    // 只有明講 false 才算 —— 少了這一條,任何一個手滑寫進去的鍵都會變成「不出貨」
    writeFileSync(join(dir, 'corpus.json'), JSON.stringify({ note: 'x' }));
    ok(corpusMeta(dir).shipping === true, '沒寫 shipping 欄 ⇒ 仍是出貨用(只有明講 false 才算)');
  } finally { rmSync(dir, { recursive: true, force: true }); }

  // (b) 兩個消費端。第 ⑦⑧ 站的閘是**推導自家**而不是指令列旗標
  let hlSrc = readSrc('tools', 'ai3d', 'harvest_loop.mjs');
  if (BREAK_CORPUS) {
    hlSrc = inject(hlSrc, "const NO_INTAKE = flag('no-intake') || !CORPUS.shipping;",
      "const NO_INTAKE = flag('no-intake');", '--break-corpus');
  }
  ok(/const NO_INTAKE = flag\('no-intake'\) \|\| !CORPUS\.shipping;/.test(hlSrc),
    '非出貨語料家強制 --no-intake(掛在家上面,不是靠每次記得加旗標)');
  // `--dry` 也要講:dry 是拿來確認「這一輪會做什麼」的,印成 [dry] 自動入庫 = 謊報會入庫
  ok(/opts\.skip && opts\.hard/.test(hlSrc) && /hard: NO_INTAKE/.test(hlSrc),
    '結構性的略過在 --dry 底下也照講(否則 dry 會謊報它要入庫)');
  // 2026-08-11 實測踩到:非出貨家照樣去補型錄缺額,抓了 8 張 CC0 進來。限流是 IP 級的
  // ⇒ 它花掉的是正牌語料庫的額度,而抓下來的 CC0 從此困在「不進遊戲」的家裡
  ok(/非出貨語料家不補型錄缺額/.test(hlSrc),
    '非出貨語料家不跑第 ① 站抓照片(限流是 IP 級的,而抓到的 CC0 會被困在不出貨的家裡)');

  // (c) 授權硬閘**只在非出貨家鬆掉「是不是 CC0」這一條**,而且仍要求有記
  let fpSrc = readSrc('tools', 'ai3d', 'fetch_photos.mjs');
  ok(/if \(meta\.shipping\) \{[\s\S]{0,200}?licenceOk\(rec\.license\)/.test(fpSrc),
    'CC0/PD 硬閘在出貨家一字未改(A 級 MUST:烤進 repo 的零件沒地方放署名)');
  ok(/非出貨家仍要記授權/.test(fpSrc),
    '非出貨家鬆的只有「是不是 CC0」—— 仍 MUST 逐張記下實際授權(不記 = 沒有帳)');
  ok(/restricted: meta\.shipping \? undefined : true/.test(fpSrc),
    '非出貨家收進來的逐筆蓋 restricted 戳記(帳本自己說得出「這張不能出貨」)');

  // (d) 面板 MUST 標出來 —— 非出貨語料長得跟正式語料一模一樣
  ok(/corpus: corpusMeta\(home\)/.test(readSrc('tools', 'parts_review.mjs')),
    '/api/photos 帶出這個家出不出貨');
  ok(/corpus\.shipping === false/.test(readSrc('tools', 'parts_review', 'review.js')),
    '零件台把非出貨語料標出來(不標的話台上兩份混在一起,而人眼判決是照著台上做的)');
}

console.log(`\n${fail ? '❌' : '✅'} 通過 ${pass} 項,失敗 ${fail} 項${unverified ? `,未驗 ${unverified} 項` : ''}`);
process.exit(fail ? 1 : 0);
