// ============ Memory-Tier & Comment-Discipline Audit (SSOT guard) ============
// Scope: memory tier is strict (root/server/tools/public-js AGENTS.md + CLAUDE.md,
// `.claude/rules/*.md` hold zero CJK); legacy code (`tools/`, `public/`,
// `server/*.js`, `test/`) is grandfathered under a ratchet -- reported info-only,
// failed only on growth versus the baseline next to this file. Narrative
// content (`docs/`, asset READMEs) is not code and is not scanned.
// Usage: node tools/audit_comment_discipline.mjs
//
// Failure modes guarded by this audit:
//   1. Tier bleed: deterministic checks (commands, thresholds, formulas) drift
//      back into Tier-1/2 prose, where they rot. Tier-1 holds principles only;
//      commands live in package.json, formulas in audit headers (layer 4).
//      Past regression: duplicated determinism/data.js invariants across the
//      public/js trigger card, module map, and Tier-1 -- fixed in one place,
//      stale in the others.
//   2. Pointer desync: a CLAUDE.md stops referencing root AGENTS.md as Tier-1
//      SSOT, so agents enter at the wrong tier.
//   3. Orphaned standard: AGENTS.md cites `.claude/rules/contracts.md` but the
//      file is renamed/deleted, leaving the DbC rule pointing nowhere.
//   4. Legacy regrowth: new Chinese comments land in code while the legacy lines
//      still await translation, so a future zero-tolerance gate can never ship.
//      The ratchet pins per-file counts; translate a file, then lower its
//      baseline entry (zero entries are dropped).
// Why mechanical: tier placement is decidable by text scan (line counts,
// forbidden substrings, pointer presence). Human review judges signal quality;
// this audit judges placement only.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './audit_src.mjs';

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

// ---- I. Tier-1 stays lean: principles only, no commands ----
{
  const ag = read('AGENTS.md');
  t('Tier-1 AGENTS.md <= 60 lines', ag.split('\n').length <= 60, `(${ag.split('\n').length})`);
  t('Tier-1 holds no shell commands', !/(npm run|npm test|node tools\/)/.test(ag));
  t('Tier-1 points at Tier-2/4 homes', ag.includes('.claude/rules/') && ag.includes('tools/audit_'));
}

// ---- II. DbC single seam exists; Tier-2 holds no commands ----
{
  t('contracts.md exists (DbC single seam)', existsSync(join(ROOT, '.claude', 'rules', 'contracts.md')));
  const dir = join(ROOT, '.claude', 'rules');
  const bad = readdirSync(dir).filter((f) => f.endsWith('.md'))
    .filter((f) => /(npm run|npm test|node tools\/)/.test(read('.claude', 'rules', f)));
  t('Tier-2 rules hold no shell commands', bad.length === 0, bad.join(','));
}

// ---- III. All CLAUDE.md pointers stay synced on Tier-1 SSOT ----
{
  // Exception allowlist with recorded why: the public/js trigger card names
  // the syntax gate because most client modules need CDN three and import
  // failure is silent (blank page); the command is a workflow trigger, and
  // package.json remains the command SSOT.
  const cards = ['CLAUDE.md', 'server/CLAUDE.md', 'tools/CLAUDE.md', 'public/js/CLAUDE.md'];
  const desynced = cards.filter((c) => {
    const s = read(...c.split('/'));
    return !(s.includes('Tier-1 SSOT is') && s.includes('AGENTS.md'));
  });
  t('every CLAUDE.md cites root AGENTS.md as Tier-1 SSOT', desynced.length === 0, desynced.join(','));
}

// ---- IV. Comment language: strict memory tier, ratcheted legacy ----
// Why this shape: the language rule (Tier-1 §1) binds comments, while
// Traditional Chinese UI/narrative stays inside string literals of content
// modules. Memory prose is already CJK-free, so zero tolerance ships today;
// legacy code still holds thousands of Chinese comment lines, so zero tolerance
// there ships never while new ones keep landing -- hence the per-file ratchet.
// A string-aware scan enforces the rule with zero allowlist: string content
// passes, comment CJK fails. Regex literals are recognized via the
// previous-significant-token heuristic so a UI-text assertion matching rendered
// Traditional Chinese (which stays in strings) keeps passing.
{
  const CJK = /[\u4e00-\u9fff]/;
  const BT = String.fromCharCode(96);
  const REG_WORD = /^(return|typeof|case|do|else|in|of|new|delete|void|yield|await|throw|instanceof)$/;
  const stripStrings = (src) => {
    let out = '', i = 0;
    const n = src.length, st = [{ t: 'code' }];
    let prevSig = '^', sig = '';
    const pushSig = (ch) => { sig = (sig + ch).slice(-64); };
    const cur = () => st[st.length - 1];
    while (i < n) {
      const c = src[i], s = cur();
      if (s.t === 'code') {
        if (s.tpl && c === '{') { s.d++; out += c; prevSig = c; pushSig(c); i++; continue; }
        if (s.tpl && c === '}') {
          if (s.d === 0) { out += ' '; st.pop(); prevSig = '}'; pushSig('}'); i++; continue; }
          s.d--; out += c; prevSig = c; pushSig(c); i++; continue;
        }
        // `//` and `/*` always open comments in valid JS (a regex can never
        // start with `*`, and `//` as regex-start is an ASI hazard that never
        // appears); escaped slashes inside regexes are consumed by the regex
        // branch below before this test is ever reached.
        if (c === '/' && src[i + 1] === '/') {
          const j = src.indexOf('\n', i);
          out += src.slice(i, j < 0 ? n : j); i = j < 0 ? n : j; continue;
        }
        if (c === '/' && src[i + 1] === '*') {
          const j = src.indexOf('*/', i + 2);
          out += src.slice(i, j < 0 ? n : j + 2); i = j < 0 ? n : j + 2; continue;
        }
        if (c === '"' || c === "'" || c === BT) { out += ' '; st.push({ t: 'str', q: c }); i++; continue; }
        if (c === '/') {
          // Regex literal iff previous significant token opens an expression
          // (sliding 64-char window keeps this O(1) on large files).
          const wm = /([A-Za-z0-9_$]+)$/.exec(sig);
          const word = wm && wm[1];
          if (/[(,=:[!&|?{;+*/%^~<>-]$/.test(sig) || sig === '' || /[)\]]$/.test(sig) || (word && REG_WORD.test(word))) {
            let j = i + 1, cls = false;
            while (j < n) {
              const d = src[j];
              if (d === '\\') { j += 2; continue; }
              if (d === '[') cls = true;
              else if (d === ']') cls = false;
              else if (d === '/' && !cls) break;
              else if (d === '\n') break;
              j++;
            }
            const flags = /^[gimsuy]*/.exec(src.slice(j + 1))[0];
            for (let k = i; k < j + 1 + flags.length; k++) out += ' ';
            i = j + 1 + flags.length; prevSig = 'x'; pushSig('x'); continue;
          }
          out += c; prevSig = c; pushSig(c); i++; continue;
        }
        if (/\s/.test(c)) { out += c; i++; continue; }
        if (/[A-Za-z0-9_$)>\]]/.test(c)) {
          const m = /([A-Za-z0-9_$]+)$/.exec(sig + c);
          prevSig = m ? m[1] : c; pushSig(c);
        } else { prevSig = c; pushSig(c); }
        out += c; i++; continue;
      } else {
        if (c === '\\') { out += '  '; i += 2; continue; }
        if (s.q === BT && c === '$' && src[i + 1] === '{') {
          out += '  '; st.push({ t: 'code', tpl: true, d: 0 }); i += 2; continue;
        }
        if (c === s.q) { out += ' '; st.pop(); i++; continue; }
        if (c === '\n' && s.q !== BT) { out += '\n'; st.pop(); i++; continue; }
        out += (c === '\n' ? '\n' : ' '); i++; continue;
      }
    }
    return out;
  };

  // ---- IVa. Memory tier: zero CJK (strict) ----
  // Why code spans are stripped first: memory files reference identifiers inside
  // spans, and a span-wrapped token is not prose.
  {
    const stripMd = (s) => s.replace(/```[\s\S]*?```/g, '\n').replace(/`[^`\n]*`/g, ' ');
    const MEM = ['AGENTS.md', 'CLAUDE.md', 'server/CLAUDE.md', 'server/AGENTS.md',
      'tools/CLAUDE.md', 'tools/AGENTS.md', 'public/js/CLAUDE.md',
      'public/js/.claude.md', 'public/js/.AGENTS.md',
      ...readdirSync(join(ROOT, '.claude', 'rules')).filter((f) => f.endsWith('.md'))
        .map((f) => `.claude/rules/${f}`)];
    const bad = MEM.filter((m) => CJK.test(stripMd(read(...m.split('/')))));
    t('memory tier holds no CJK', bad.length === 0, bad.join(','));
  }

  // ---- IVb. Legacy code: ratchet (fail on growth only) ----
  // Why per-file counts: a single total lets one file grow while another
  // shrinks. Keys use forward slashes so the baseline is portable across
  // checkouts; a missing key means zero allowed, so new files enter clean.
  {
    const base = JSON.parse(read('tools', 'audit_comment_discipline.baseline.json'));
    const SKIP = new Set(['node_modules', '.git', 'out', 'dist', '.certs', 'docs']);
    const walk = (d, acc = []) => {
      for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
        const rel = join(d, e.name);
        if (e.isDirectory()) {
          if (SKIP.has(e.name)) continue;
          walk(rel, acc);
        } else if (/\.(m?js|css|html)$/.test(e.name) && e.name !== 'README.md') acc.push(rel);
      }
      return acc;
    };
    const keyOf = (f) => f.split(/[\\/]+/).join('/');
    const countCjk = (key, src) => {
      if (key.endsWith('.html')) {
        // HTML: only <!-- --> comment regions are bound; visible text stays.
        const spans = src.match(/<!--[\s\S]*?-->/g) || [];
        return spans.filter((s) => CJK.test(s)).length;
      }
      return stripStrings(src).split('\n').filter((l) => CJK.test(l)).length;
    };
    const grown = [];
    let total = 0, files = 0;
    for (const f of walk('.')) {
      const key = keyOf(f);
      const n = countCjk(key, read(...key.split('/')));
      if (!n) continue;
      files++; total += n;
      if (n > (base[key] ?? 0)) grown.push(`${key} ${base[key] ?? 0}->${n}`);
    }
    console.log(`  … legacy CJK: ${total} lines across ${files} files (info-only; gate fails on growth)`);
    t('legacy CJK never grows (ratchet)', grown.length === 0,
      grown.slice(0, 10).join(' ') + (grown.length > 10 ? ` …(${grown.length})` : ''));
  }
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
