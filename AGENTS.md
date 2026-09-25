# Steel vs. Swarm — Global Principles & Boundaries

> Scope: principles and boundaries only.
> Nothing in this file restricts skill selection or skill usage.
> Keywords MUST / MUST NOT per RFC-2119. A MUST NOT violation is an architecture violation.
> Full definitions live in `.claude/rules/`; read the relevant rule file when touching a topic.

## 0. Principles

1. **Server-authoritative**: HP / damage / ammo / economy / outcome settle in the server simulation. Clients handle input, hit reports, snapshot interpolation, and presentational ballistics only.
2. **Single seam**: shared logic and values have exactly one settlement point. No duplicate implementations; derived values MUST NOT be hand-written.
3. **Determinism**: scene layout is bit-identical across ends; scatter paths MUST NOT use nondeterministic randomness; new content MUST NOT disturb the shared deterministic sequence.
4. **Degrade by omission**: external-service failure falls back; failed sampling is skipped; the server silently drops invalid reports after validation. Missing data is preferable to broken battles.
5. **One architecture, three transports**: cloud / LAN / solo share one simulation and room core; only the transport switches. File and URL layouts stay mirrored.
6. **Intentional designs stay**: blast coverage, penetration dimensionality, ammo micro-drift, and AoE behavior are deliberate performance and gameplay trade-offs. MUST NOT "repair" them into inconsistency with the shipped balance.

## 1. Documentation Discipline

- **Language**: docs and code comments are English. In-game UI strings and narrative dialogue stay Traditional Chinese and live in their content modules only.
- **Disclosure**: Tier-1 holds principles only. Definitions live in `.claude/rules/`; per-assertion formulas live in `tools/audit_*.mjs` headers; commands live in `package.json`. MUST NOT duplicate them here.
- **Signal**: state the non-obvious "why" (constraint, failure mode, invariant). MUST NOT restate what the code plainly shows, and MUST NOT log completed history, dates, or transitional notes.

## 1. Technical Boundaries

- Runtime: Node.js with a single websocket dependency. MUST NOT add dependencies.
- No build step, no bundler, no framework, no TypeScript.

## 2. Behavioral Boundaries

- **Fairness**: bots MUST NOT perceive or move beyond human limits; buildings take no multipliers; shield and armor handling stays single-track; fire-rate and budget adjustments move together without touching authority state.
