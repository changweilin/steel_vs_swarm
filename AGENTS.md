# Steel vs. Swarm — Global Principles & Boundaries

> Scope: principles and boundaries only.
> Nothing in this file restricts skill selection or skill usage.
> Keywords MUST / MUST NOT per RFC-2119. A MUST NOT violation is an architecture violation.
> Full definitions live in `.claude/rules/`; read the relevant rule file when touching a topic.

## 0. Principles

1. **Server-authoritative**: HP / damage / ammo / economy / outcome settle in the server simulation. Clients handle input, hit reports, snapshot interpolation, and presentational ballistics only.
2. **Single seam**: shared logic and values have exactly one settlement point. No duplicate implementations; derived values MUST NOT be hand-written.
3. **Same volumes both ends**: collision, ballistics, hits, and LOS share one oriented-box convention with identical geometry on client and server, so hit judgment never diverges silently.
4. **Presentation stays presentation**: visual-only changes MUST NOT affect authoritative geometry; text, outlines, staging, and staged sizes stay presentation-only and derive from authoritative values.
5. **Determinism**: scene layout is bit-identical across ends; scatter paths MUST NOT use nondeterministic randomness; new content MUST NOT disturb the shared deterministic sequence.
6. **Degrade by omission**: external-service failure falls back; failed sampling is skipped; the server silently drops invalid reports after validation. Missing data is preferable to broken battles.
7. **Real-world scale**: human height is the single baseline for the whole game. MUST NOT rescale to super-scale.
8. **One architecture, three transports**: cloud / LAN / solo share one simulation and room core; only the transport switches. File and URL layouts stay mirrored.
9. **Intentional designs stay**: blast coverage, penetration dimensionality, ammo micro-drift, and AoE behavior are deliberate performance and gameplay trade-offs. MUST NOT "repair" them into inconsistency with the shipped balance.

## 1. Technical Boundaries

- Runtime: Node.js with a single websocket dependency. MUST NOT add dependencies.
- No build step, no bundler, no framework, no TypeScript.
- 3D assets prefer CC0 with a procedural fallback.

## 2. Behavioral Boundaries

- **Fairness**: bots MUST NOT perceive or move beyond human limits; buildings take no multipliers; shield and armor handling stays single-track; fire-rate and budget adjustments move together without touching authority state.
- **Rendering contract**: dark sides keep a brightness floor with luminance-neutral shifts; one flag drives soft-matter outlines and flutter.
- **World stability**: map bearing and road quantization freeze before battle configuration; boundary staging stays inside collision.
