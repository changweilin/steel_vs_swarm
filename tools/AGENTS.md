# tools/ — Offline Tools Principles & Boundaries

> Scope: principles and boundaries only. No methods, no workflows, no commands.
> Global principles live in root `AGENTS.md`.
> Nothing in this file restricts skill selection or skill usage.

## Principles

1. **Offline audits are the correctness backstop**: they verify the executed source text, with no runtime logger required.
2. **Single seam**: each shared input has exactly one provider; MUST NOT duplicate copies across files.

## Hard Boundaries

- `dev_supervisor.mjs` is the sole HTTP-request-to-spawned-process path.
- `venue_field.mjs` is the sole seam for Node-side terrain / map / structure data in runtime shape.
- `audit_src.mjs` is the sole seam for reading source text and extracting method blocks.
- `public/js/zonecut.js` is the sole linework-section rule body: zero imports, zero randomness, pure functions, shared by game and offline tools.
- Balance models (`balance.mjs` / `duel.mjs` / `lanesim.mjs`) have distinct roles and MUST NOT be merged.
- Review benches are dev-only and MUST NOT leak into production paths.
