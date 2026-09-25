// ============ Client Module Syntax Gate (Offline; no server/browser/network required) ============
// Rationale: Several client modules (vfx.js, toon.js, environment.js, postfx.js, forge/*.js) have no Node-side
// consumers (they depend on browser three.js imports from CDN) and are never imported during normal npm test runs.
// A syntax break in these files remains silent until a browser loads the page.
// In particular, GLSL shader code embedded within JS template literals does not treat backticks inside GLSL `//`
// comments as escaped, prematurely closing the template literal.
//
// Enforcement disciplines:
//   1. Roster MUST be dynamically derived from the filesystem -- handwritten lists silently rot when new modules are added.
//   2. Target files MUST be copied to temporary .mjs files for `node --check` -- Node parses .js as CommonJS by default,
//      which falsely rejects top-level ES module `import` syntax.
//   3. Source files MUST be read via `readSrc()` with CRLF preserved -- bit-identical copying ensures reported line numbers
//      match the original `public/js/` files exactly.
//
// Section III rationale:
//   `node --check` alone is insufficient if the premature backtick terminates a template literal in a position that
//   still forms valid JS (e.g. `` `...`.a(...) ``). The JS parser succeeds, but the shader string is truncated and causes
//   runtime crashes. Section III parses character streams to guarantee no template-closing backtick falls on a GLSL `//` line.
//
// Usage:
//   node tools/audit_client_syntax.mjs
//   node tools/audit_client_syntax.mjs --break-glsl   Negative verification: injects backtick into vfx.js SHIELD_VERT comment (MUST fail).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, readSrc } from './audit_src.mjs';

const ARG = new Set(process.argv.slice(2));
const BREAK_GLSL = ARG.has('--break-glsl');

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.error(`  ✗ ${msg}`)); };

/**
 * Injects a backtick into the first GLSL comment inside vfx.js SHIELD_VERT for negative verification.
 * Stale anchors MUST throw immediately to prevent false positives in negative tests.
 */
const injectBacktick = (src) => {
  const i = src.indexOf('const SHIELD_VERT = /* glsl */`');
  if (i < 0) throw new Error('--break-glsl 錨點過期:vfx.js 找不到 SHIELD_VERT 樣板字串');
  const m = /\n[ \t]*\/\/[^\n]*/.exec(src.slice(i));
  if (!m) throw new Error('--break-glsl 錨點過期:SHIELD_VERT 裡沒有 // 註解可注入');
  const at = i + m.index + m[0].length;   // Injects at comment end, prematurely closing the template literal.
  return `${src.slice(0, at)}\`${src.slice(at)}`;
};

// ============ I. Roster: File-derived, MUST NOT be handwritten ============
console.log('Ⅰ 名冊(由 public/js 目錄推導;含子目錄)');
// Recursive discovery: public/js/forge/ and subdirectories contain client-only modules
// that lack Node consumers; a non-recursive scan silently misses them.
const listJs = (rel) => readdirSync(join(ROOT, ...rel), { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? listJs([...rel, d.name])
    : d.name.endsWith('.js') ? [[...rel.slice(2), d.name].join('/')] : []));
const FILES = listJs(['public', 'js']).sort();
{
  ok(FILES.length > 0, `列到 ${FILES.length} 支客戶端模組`);
  // Empty roster guard: an empty list passes trivially; ensure known GLSL-bearing modules are detected.
  for (const f of ['vfx.js', 'toon.js', 'environment.js'])
    ok(FILES.includes(f), `帶 GLSL 樣板字串的 ${f} 在名冊內`);
  // Verify subdirectory traversal reached forge modules.
  ok(FILES.includes('forge/forge.js') && FILES.includes('forge/mechs/t01.js'),
    '子目錄(forge/ 與 forge/mechs/)在名冊內');
}

// ============ II. Per-file `node --check` ============
console.log('\nⅡ 逐支解析(node --check;副檔名換成 .mjs 才走 ES module 解析)');
{
  const dir = mkdtempSync(join(tmpdir(), 'svs-syntax-'));
  for (const f of FILES) {
    let src = readSrc('public', 'js', ...f.split('/'));
    if (BREAK_GLSL && f === 'vfx.js') src = injectBacktick(src);
    const tmp = join(dir, f.replace(/\.js$/, '.mjs').replace(/\//g, '__'));
    writeFileSync(tmp, src);
    let err = '';
    try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
    catch (e) {
      const out = String(e.stderr || e.message);
      const msg = (out.split('\n').find((l) => /Error/.test(l)) || '解析失敗').trim();
      const ln = /\.mjs:(\d+)/.exec(out);   // Byte-for-byte temp mirror preserves original source line numbers.
      err = ln ? `${msg} @ public/js/${f}:${ln[1]}` : msg;
    }
    ok(!err, `public/js/${f}${err ? ` —— ${err}` : ''}`);
  }
}

// ============ III. Template Literal GLSL Comments MUST NOT Contain Backticks ============
// Character stream parser tracks template literal nesting and interpolation blocks (${...}).
// A violation occurs when a template-closing backtick resides on a GLSL line comment (//),
// which truncates shader source regardless of whether surrounding JS syntax remains parseable.
console.log('\nⅢ 樣板字串裡的 GLSL 註解不得出現反引號(解析得過、shader 被截斷)');
function tickInGlslComment(src) {
  const hits = [];
  const st = [];                 // Stack for ${...} interpolation depths; matching '}' resumes template literal.
  let s = 'n', line = 1, cmtLine = false, atLineHead = true;
  for (let i = 0; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (c === '\n') { line++; if (s === 'l') s = 'n'; cmtLine = false; atLineHead = true; continue; }
    if (s === 'n') {
      if (c === '/' && d === '/') { s = 'l'; i++; }
      else if (c === '/' && d === '*') { s = 'b'; i++; }
      else if (c === "'" || c === '"') { s = c; }
      else if (c === '`') { s = 't'; cmtLine = false; }
      else if (c === '{' && st.length) st[st.length - 1].depth++;
      else if (c === '}' && st.length) { if (st[st.length - 1].depth === 0) { st.pop(); s = 't'; } else st[st.length - 1].depth--; }
    } else if (s === 'b') { if (c === '*' && d === '/') { s = 'n'; i++; } }
    else if (s === "'" || s === '"') { if (c === '\\') i++; else if (c === s) s = 'n'; }
    else if (s === 'l') { /* Line comment consumes characters until newline */ }
    else if (s === 't') {
      if (c === '\\') { i++; atLineHead = false; continue; }
      if (c === '$' && d === '{') { st.push({ depth: 0 }); s = 'n'; i++; atLineHead = false; continue; }
      if (c === '`') { if (cmtLine) hits.push(line); s = st.length ? 'n' : 'n'; cmtLine = false; continue; }
      if (atLineHead && c === '/' && d === '/') { cmtLine = true; atLineHead = false; i++; continue; }
      if (c !== ' ' && c !== '\t') atLineHead = false;
    }
  }
  return hits;
}
{
  // Self-test: detector MUST trigger on known malformed snippet to prevent silent no-op regressions.
  const probe = tickInGlslComment('const a = `\n  void main() {\n  // 註解 `裡面有反引號`\n  }\n`;');
  ok(probe.length > 0, `偵測器自我驗證:對已知壞法回報 ${probe.length} 處`);
  for (const f of FILES) {
    let src = readSrc('public', 'js', f);
    if (BREAK_GLSL && f === 'vfx.js') src = injectBacktick(src);
    const hits = tickInGlslComment(src);
    ok(hits.length === 0, `public/js/${f}${hits.length ? ` —— GLSL 註解裡的反引號截斷樣板 @ 第 ${hits.join(', ')} 行` : ''}`);
  }
}

console.log(`\n${fail ? '❌' : '✅'} 通過 ${pass} 項${fail ? `,失敗 ${fail} 項` : ''}`);
if (BREAK_GLSL && !fail) {
  console.error('❌ 反向驗證失敗:故意寫壞了但稽核全綠 —— 這條守門線沒有真的在守');
  process.exit(1);
}
process.exit(fail && !BREAK_GLSL ? 1 : 0);
