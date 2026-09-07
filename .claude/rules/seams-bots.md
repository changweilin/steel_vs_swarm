# §2.1 D — Computer Players (single seams)

> Layer 2: full definitions. Principles live in root `AGENTS.md`; assertion details live in audit script headers (layer 4).

| Topic | Single seam | Constraints | Guards |
|---|---|---|---|
| Operation tempo | `BOT_DIFF`/`BOT_OPS`, `botOpGap()`, `bots._op()` | MUST NOT write separate tick-count throttles; sustained fire obeys reaction time only. | — |
| Vision | `BOT_VIEW`, `botFovHalf()`, `bots._turn()`, bearing source `sim._hurtLog()` | Enemy gate lives in acquisition; heading has one write point stepping through one stepper; alert bearings come only from the server log. | `audit_bot_vision` |
| Tactics | `BOT_DIFF.tactic`/`elite`, `BOT_TACTIC`, `botTargetPrio()`, `botThreatDecay()`; ledger `sim._hurtLog()`/`_dmgOut()` | Tiers recognized by flag only, MUST NOT compare difficulty strings; priorities normalized to in-set shares; threat fades old accounts before adding; retreat needs all gates. | `audit_bot_tactics` |
| Role classification | `BOT_ROLE_FEATS`/`BOT_ROLES`, `botRoleOf()`, `botRoleMul()`, consumer `bots._resolveRole()` | Derived classification, MUST NOT hardcode per-character rosters; strategy overrides knobs only; overrides normalized to geometric mean one. | `audit_bot_role` |
| Learning policy | `botPolicy.js` (tool-generated, zero-import, MUST NOT hand-edit), `BOT_TACTIC_BASE`, `BOT_LEARN`, `botPolicySanitize()` | Learns tradeoffs only — vision, speed, and accuracy MUST NOT enter the whitelist; locked values unlearnable; single clamp shared by runtime and tooling; empty policy is neutral. | `audit_bot_policy` |
| Collision bodies | `selfCollider()`, `COLLIDE_KINDS`, server `solidResolve()`/`solidPush()`, caller `bots._move()` | Bots follow human collision exactly; single body volume; sweep and push-out both required; unit-then-world ordering (world wins). | `audit_bot_vision`, `audit_npc_collide` |

Assertion details live in layer-4 audit script headers.
