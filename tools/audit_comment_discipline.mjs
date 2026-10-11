// ============ Memory-Tier & Tier-Placement Audit (SSOT guard) ============
// Scope: tier placement only (Tier-1 leanness, DbC seam, CLAUDE.md pointers).
// The comment-language gate (former section IV: strict memory-tier zero-CJK
// plus legacy per-file ratchet against the baseline next to this file) was
// removed at maintainer request; new Chinese comments in code no longer fail
// this audit. Narrative content (`docs/`, asset READMEs) is not code and is
// not scanned.
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
//      (Former mode 4, legacy comment-CJK regrowth, retired with section IV.)
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

// Section IV (comment-language gate) removed; see file header.
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
