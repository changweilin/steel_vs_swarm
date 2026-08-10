// ============ 客戶端模組語法閘(離線;不需伺服器 / 瀏覽器 / 網路)============
// 對應 2026-08-09 在 steel-swarm-curved-map 工作區實測到的靜默破壞:`public/js/vfx.js` 的
// `SHIELD_VERT` 是 JS 樣板字串裝著 GLSL,而樣板字串對反引號沒有轉義概念 —— 在 GLSL 的 `//`
// 註解裡打一個反引號,**整支 .js 當場語法錯誤**,而 node 報的位置指向註解那一行的中文字,
// 讀起來完全像是別的問題(編碼壞了?字型?),沒有任何線索指向「那個反引號把字串收掉了」。
//
// 為什麼整套回歸驗證抓不到:當時 `npm test`、`npm run bal`、`node tools/shot_scene.mjs`、
// 全部 `tools/audit_*.mjs` **一起全綠** —— 它們沒有任何一支載入 vfx.js。而 vfx.js 要 CDN 上的
// three ⇒ Node 端根本 import 不了它,連「載入一次看會不會炸」這條路都不存在。破壞只會在
// **真人第一次開頁面**時現形。同樣沒有任何 Node 端消費者的還有 game.js / models.js / mobile.js /
// postfx.js …… 這一批的共通點是:改壞了,離線防線一格都不會紅。
//
// 這支就是補上那一格:把 `public/js/*.js` **逐支**丟給 `node --check`。三條實作紀律:
//   ・名冊 MUST 由目錄推導 —— 手寫清單會在新增模組時靜默過期(新檔案永遠不在閘門內,
//     而閘門照樣全綠);
//   ・副檔名 MUST 換成 `.mjs`:`node --check` 對 `.js` 走 CommonJS 解析,頂層 `import` 一律紅
//     (整批誤報,而且長得像「我改壞了」,不像「稽核本身設錯了」);
//   ・讀原文 MUST 走 `audit_src.mjs readSrc()`(㋑ CRLF 紀律)。原文逐位元照抄進暫存檔 ⇒
//     node 報的行號與原檔一致,錯誤訊息直接指得回 `public/js/xxx.js:行號`。
//
// 這支守得住的是「解析不過」。守不住、只能靠人守的那一半紀律:**凡是把 GLSL 放進 JS 樣板
// 字串的檔案,它的 GLSL 註解裡 MUST NOT 出現反引號** —— 現役是 vfx.js 的 `SHIELD_VERT` /
// `SHIELD_FRAG`、toon.js 的世界曲面與賽璐璐補丁、environment.js 的天空穹頂。反引號剛好收在
// 一個「後面接得起來」的位置時,檔案解析得過而 shader 原始碼從那裡被截斷,那是本閘門看不到的。
//
// 用法:
//   node tools/audit_client_syntax.mjs
//   node tools/audit_client_syntax.mjs --break-glsl   反向驗證:往 vfx.js `SHIELD_VERT` 的第一行
//                                                     GLSL 註解注入一個反引號 ⇒ 該支 MUST 紅
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, readSrc } from './audit_src.mjs';

const ARG = new Set(process.argv.slice(2));
const BREAK_GLSL = ARG.has('--break-glsl');

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.error(`  ✗ ${msg}`)); };

/**
 * 反向驗證用:把一個反引號注入 vfx.js `SHIELD_VERT` 裡的第一行 GLSL 註解。
 * 錨點過期 MUST 當場丟例外 —— 注入無效卻靜靜跑完,break 會永遠是綠的(㋑)。
 */
const injectBacktick = (src) => {
  const i = src.indexOf('const SHIELD_VERT = /* glsl */`');
  if (i < 0) throw new Error('--break-glsl 錨點過期:vfx.js 找不到 SHIELD_VERT 樣板字串');
  const m = /\n[ \t]*\/\/[^\n]*/.exec(src.slice(i));
  if (!m) throw new Error('--break-glsl 錨點過期:SHIELD_VERT 裡沒有 // 註解可注入');
  const at = i + m.index + m[0].length;   // 注在該註解行的行尾 ⇒ 樣板字串在此收掉
  return `${src.slice(0, at)}\`${src.slice(at)}`;
};

// ============ Ⅰ 名冊:由目錄推導,MUST NOT 手寫 ============
console.log('Ⅰ 名冊(由 public/js 目錄推導)');
const FILES = readdirSync(join(ROOT, 'public', 'js')).filter((f) => f.endsWith('.js')).sort();
{
  ok(FILES.length > 0, `列到 ${FILES.length} 支客戶端模組`);
  // 目錄搬家 / glob 寫錯會讓名冊變成空陣列,而「零支全部通過」在畫面上與全綠一模一樣。
  // 這三支是已知把 GLSL 塞進樣板字串的檔案 —— 它們不在名冊裡就是名冊本身壞了。
  for (const f of ['vfx.js', 'toon.js', 'environment.js'])
    ok(FILES.includes(f), `帶 GLSL 樣板字串的 ${f} 在名冊內`);
}

// ============ Ⅱ 逐支 `node --check` ============
console.log('\nⅡ 逐支解析(node --check;副檔名換成 .mjs 才走 ES module 解析)');
{
  const dir = mkdtempSync(join(tmpdir(), 'svs-syntax-'));
  for (const f of FILES) {
    let src = readSrc('public', 'js', f);
    if (BREAK_GLSL && f === 'vfx.js') src = injectBacktick(src);
    const tmp = join(dir, f.replace(/\.js$/, '.mjs'));
    writeFileSync(tmp, src);
    let err = '';
    try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
    catch (e) {
      const out = String(e.stderr || e.message);
      const msg = (out.split('\n').find((l) => /Error/.test(l)) || '解析失敗').trim();
      const ln = /\.mjs:(\d+)/.exec(out);   // 暫存檔逐位元照抄 ⇒ 行號就是原檔行號
      err = ln ? `${msg} @ public/js/${f}:${ln[1]}` : msg;
    }
    ok(!err, `public/js/${f}${err ? ` —— ${err}` : ''}`);
  }
}

console.log(`\n${fail ? '❌' : '✅'} 通過 ${pass} 項${fail ? `,失敗 ${fail} 項` : ''}`);
if (BREAK_GLSL && !fail) {
  console.error('❌ 反向驗證失敗:故意寫壞了但稽核全綠 —— 這條守門線沒有真的在守');
  process.exit(1);
}
process.exit(fail && !BREAK_GLSL ? 1 : 0);
