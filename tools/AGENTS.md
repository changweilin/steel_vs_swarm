# tools/ — Offline Tools Principles & Boundaries

> Scope: principles and boundaries only. No methods, no workflows, no commands.
> Global principles live in root `AGENTS.md`.
> Full definitions live in `.claude/rules/` (`verification`, `seams-world`).
> Nothing in this file restricts skill selection or skill usage.

## Principle

- **Offline audits are the correctness backstop**: they verify the executed source text, with no runtime logger required.

## Behavioral Boundaries

- **One spawn path**: HTTP-request-to-spawned-process has exactly one gated path.
- **One world-data provider**: Node-side runtime-shaped terrain / map / structure data comes from one seam; consumers MUST NOT keep private copies.
- **One source-reading provider**: reading source text and extracting blocks goes through one seam, so audits verify what actually ships.
- **Separate balance models**: each balance model keeps its distinct role and MUST NOT be merged.
- **Dev-only benches**: review and showcase benches MUST NOT leak into production paths.
