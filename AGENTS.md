# Steel vs. Swarm — Global Principles & Boundaries

> Scope: principles and boundaries only. No methods, no workflows, no commands.
> Nothing in this file restricts skill selection or skill usage.
> Keywords MUST / MUST NOT / SHOULD per RFC-2119. A MUST NOT violation is an architecture violation.

## 0. Principles

1. **Server-authoritative**: HP / damage / ammo / economy / outcome settle in `server/sim.js`. Client handles input, hit reports, 8Hz snapshot interpolation, and presentational ballistics only.
2. **Single seam**: shared logic and values have exactly one settlement point. No duplicate implementations; derived values MUST NOT be hand-written.
3. **Same volumes both ends**: collision, ballistics, hits, and LOS MUST use identical geometry on client and server (same boxes / cylinders / vertical bands / radii).
4. **Presentation stays presentation**: visual-only changes MUST NOT affect authoritative geometry; staged sizes MUST derive from authoritative values.
5. **Determinism**: scene layout is bit-identical across ends; scattered paths MUST NOT use `Math.random()`.
6. **Degrade by omission**: external-service failure falls back; failed sampling returns null and is skipped; server silently drops invalid reports after validation.
7. **Real-world scale**: `SOLDIER_H` (1.8m) is the single height baseline. MUST NOT rescale to super-scale.
8. **One architecture, three transports**: cloud / LAN / solo share `server/rooms.js` and `sim.js`; only the transport switches. File and URL layouts stay mirrored.
9. **Intentional designs stay**: ammo drift (A9), blast ignoring LOS (A11), heli ignoring tower SAM (A15), 2D penetration (A18), no-crit AoE, and equivalents are deliberate trade-offs. MUST NOT "fix" them.

## 1. Technical Boundaries

- Runtime: Node.js; the only allowed npm dependency is `ws`. MUST NOT add dependencies.
- No build step, no bundler, no framework, no TypeScript.
- Comments and UI strings use Traditional Chinese.
- 3D assets prefer CC0 (`MODEL_MANIFEST` + procedural fallback).
- `reference/` is read-only. MUST NOT modify it.

## 2. Absolute Boundaries (A-Index)

| # | Boundary |
|---|---|
| A1 | Client MUST NOT mutate authoritative state first; anti-cheat stays server-side. |
| A2 | MUST NOT add npm deps / build tools / TS / frameworks. |
| A3 | MUST NOT modify `reference/`. |
| A4 | Deterministic scatter paths MUST NOT use `Math.random()`. |
| A5 | Heavy-weapon CD is `mag:1 + reload=cd` only. |
| A6 | Raycast hits units only; terrain uses analytic rays, buildings use boxes/cylinders. |
| A7 | Fly-straight-on-lost-lock is laser-guided and tower SAM only. |
| A9 | Client/server ammo micro-drift is intentional. Do not fix. |
| A11 | Blast intentionally ignores LOS and range. |
| A14 | Cel dark side has a brightness floor; hue shift stays luminance-neutral. |
| A18 | Penetration is 2D + vertical band. MUST NOT switch to 3D. |
| A22 | Gesture dispatch lives in `_fireHoldAbility()` only. |
| A25 | One-shot 3D object removal MUST release GPU resources. |
| A28 | Browser-runnable + mirrored URL layout across all three modes. |
| A30 | Collision / ballistics / server LOS MUST share one cross-section oriented box. |
| A32 | Bots MUST NOT see more or move more than humans. |
| A34 | Buildings take no multipliers; shield split is single-track only. |
| A35 | Attack-range convergence and three-axis budget. |
| A36 | Fire-rate compression moves three columns together; burst staging MUST NOT touch authoritative state. |
| A37 | Single text layer, single corpus, derived ratios, presentation-only. |
| A39 | Soft matter: one flag drives thin outlines and flutter under the alpha contract. |
| A40 | Single character/body file format; prototype layer derives from `visual`. |
| A42 | Map primary bearing and road quantization frozen before battleConfig. |
| A44 | Boundary-wall catalogue: staging ⊆ collision box, filled inner faces, single split. |

Full definitions live in `.claude/rules/antipatterns.md` and `seams-*.md`. Read them when touching the corresponding topic.
