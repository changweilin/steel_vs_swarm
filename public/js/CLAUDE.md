# public/js — Client Trigger Card

> Tier-1 SSOT is root `AGENTS.md`. Module boundaries live in `public/js/.AGENTS.md`;
> the file responsibility map lives in `public/js/.claude.md` (open manually).
> Topic definitions live in `.claude/rules/seams-*.md`; annotation standard lives
> in `.claude/rules/contracts.md`; per-assertion formulas live
> in `tools/audit_*.mjs` headers. Commands live in `package.json`.

Before touching any module in this directory:

1. Check the responsibility map in `.claude.md` for the file's boundary, then read the matching rule file in full.
2. After editing, run `node tools/audit_client_syntax.mjs` — most modules need CDN `three`, so no offline audit can import them; a syntax break stays green everywhere and shows as a blank page.
