# Bot design — role classification and policy learning

> Merges the former `bot_roles.md` (2026-08-08, "classify bots by their mech's stats and give each
> a different strategy") and `bot_learning.md` (2026-08-06, "design an optimally-playing bot that
> keeps learning as balance changes"). Seam index: `CLAUDE.md §2.1 D`. Per-item assertions:
> `tools/audit_bot_role.mjs`, `tools/audit_bot_policy.mjs`.

## 0. Architecture in one breath

Two layers over one knob table. **Learning tunes the shared baseline; the role classifier applies a
relative offset on top of it.** Neither adds a second decision system — `bots.js`'s state machine,
target selection and retreat flow are untouched, and `if (role === …)` behaviour branches are banned.

```
 data.js balance numbers ──► balanceFingerprint()
        │                          │ fingerprint changed ⇒ relearn
        │ HEX_AXES[].val +         ▼
        │ buildDps + heroAbility   tools/bot_learn.mjs  (real BattleSim + BotBrain self-play,
        ▼                          │                     CRN paired mirror, mirrored-Gaussian ES)
 botRoleFeats(ch)  7 features 0–1  ▼
        │ argmax Σ w·(feat − 0.5)  public/js/botPolicy.js  (tool output, zero imports)
        ▼                          │ data.js override loop, via botPolicySanitize()
 botRoleOf(ch) → raider/zoner/     ▼
        siege/support         BOT_TACTIC  (baseline; BOT_TACTIC_BASE keeps the frozen snapshot)
        │ botRoleTactic(): 11 knobs × normalised multiplier → clamp → botTacticCross
        ▼
 bots.js  BotBrain._resolveRole()  (sole resolution seam) → this.tac  (sole read seam)
```

Change any balance number and both the codex hex chart and the bot's role move **together** — that
is what makes "classify by the mech's own stats" hold up over time.

## 1. Why each half exists

**Roles.** Before this, all 32 mechs shared one `BOT_TACTIC`: same distance rings, same target
weights, same retreat line, same purchase order. A 6.4 m/s scout drone and a 26-armour siege mech
played identically — and that table can only have been right for one of them. There is no error
message; it presents as "this bot doesn't seem to know how to use its own mech" (high-mobility
short-range mechs grinding from out of range, heavy siege mechs dithering at the edge of tower
range, dedicated healers charging the front and getting deleted).

**Learning.** Bot strength splits in two:

- **Capability** — vision cone (`BOT_VIEW`), reaction/APM (`BOT_DIFF.gap/react`), accuracy
  (`aimErr`), speed/range/damage. **MUST NOT be learned** (A32: a bot may not see or move more than
  a human). Learning capability smuggles cheating back in, and on screen it only looks like "the AI
  got more accurate".
- **Trade-offs** — who to shoot first, when to disengage, how to hold distance. No single right
  answer, and **the optimum drifts with balance** (compress heavy-weapon range and `KITE_FAR`'s
  optimum moves with it). Hand-tuned constants silently go stale after every balance pass; that is
  exactly what "keeps learning as balance changes" is for.

## 2. Role classification

### 2.1 Seven features (`BOT_ROLE_FEATS`)

| Feature | Source (existing sole seam) | Why |
|---|---|---|
| `dur` | `HEX_AXES.dur.val` (armour HP + shield) | can it trade while standing |
| `armor` | `HEX_AXES.armor.val` | same, but through mitigation not HP |
| `fire` | `HEX_AXES.fire.val` (light + heavy sustained DPS) | how long an engagement window it wants |
| `zone` | `HEX_AXES.zone.val` (range × strike-footprint diameter) | how much space one shot denies |
| `mob` | `HEX_AXES.mob.val` (compressed speed) | can it catch / escape |
| `siege` | `buildDps(ch, light) + buildDps(ch, heavy)` | is stopping to break a tower worth it |
| `aid` | team-supply share of the two ability slots | do its abilities hurt or heal |

- **Always call through to the existing seam.** Computing a second DPS/EHP here presents as "the
  codex says one thing, the bot plays another", with neither side visibly wrong.
- **The first six take a log-quantile** (same as `hexBand`: position is set by ratio, not
  difference). Absolute values are not comparable — "range 190" is the longest among light weapons
  and the shortest among heavy ones.
- **`aid` deliberately skips the quantile** — it is already a 0–1 share, and quantiling would
  collapse "no such ability" vs "one such ability" into a 0/1 flag.
- The hex chart's `power` is **excluded**: it sets how often abilities fire, not how close to stand
  or who to shoot.

### 2.2 Four roles (`BOT_ROLES`)

Score = `Σ wᵢ × (featᵢ − 0.5)`, take the max. **Centring the features is where fairness comes
from**: a mech that is exactly average on everything scores 0 for all four roles instead of
favouring whichever profile has more positive weights; `Σ|w| = 1` puts the four scores on one
scale. Both are pinned by the audit.

| Role | Profile | Strategy axis |
|---|---|---|
| **raider** | high mobility, fragile, single-target | close-range picks, cleanup kills, hunt damage cores; disengage on first blood, and rally close (it can come back) |
| **zoner** | large zone, high fire | hold mid range so the area effect pays; neither chases nor closes |
| **siege** | high durability/armour, high anti-structure DPS | bite into fortifications, stay on the tower, leave only when armour is nearly gone |
| **support** | abilities supply the team | stand furthest back, cast earliest, disengage earliest (a dead support supplies nothing) |

The live roster is printed by the last section of `node tools/audit_bot_role.mjs` (2026-08-08:
raider 9 / zoner 11 / siege 9 / support 3). **The roster shifts as balance changes — that is the
feature, not a bug**; a mech whose firepower was cut should play differently. To see who changed,
diff the audit's roster before and after.

### 2.3 The strategy is a knob override

| Knob | Baseline | Meaning |
|---|---|---|
| `KITE_NEAR` | 0.55 | kiting distance ring while able to fire (high difficulty) |
| `KEEP_F` | 0.6 | general distance ring without kiting |
| `KEEP_STRUCT` | 0.85 | distance ring against structures |
| `W_OUTPUT` / `W_EXEC` | 0.7 / 1.0 | target selection: enemy damage core / nearly-dead target |
| `PRIO_HERO` / `PRIO_STRUCT` | 0.55 / 1.3 | weighted-distance discount for heroes / surcharge for structures |
| `PULL_HP` / `PULL_SP` | 0.32 / 0.5 | retreat lines: armour threshold / shield threshold |
| `RALLY_BACK_M` | 70 | how far behind the tower the rally point sits |
| `CAST_HURT` | 0.55 | HP line that triggers self-preservation / support abilities |

The last five were lifted out of hard-coded constants in `bots.js` in this round, and **each
baseline equals the old constant** ⇒ with no role override the behaviour is bit-identical to before.

**Override is redistribution, not inflation.** Each knob's four multipliers are normalised to a
**role-count-weighted geometric mean of 1** (`botRoleNorm`, the same rule as `AOE_BUDGET.NORM` /
`SPEED_COMP` / `BUILD_DPS`), so the geometric centre across all 32 mechs stays bit-anchored on the
user-settled baseline. Without that step, "give every role a small boost" quietly strengthens or
weakens the whole bot population — and `npm run sim`'s win flag is saturated against exactly that
kind of drift. `--break-norm` is the counter-example. Values in `BOT_ROLES[r].mul` are **relative**;
normalisation preserves the pairwise ratios (pinned by the audit), so tuning only requires deciding
whether a role should sit closer or further than the others.

**Clamping.** After the override each key is clamped to `BOT_ROLE.KNOBS`, then passed through
`botTacticCross` — **the same seam as the learning clamp** `botPolicySanitize` (`W_THREAT` always
heaviest, `KITE` near < far, `PULL_HP > BASE_HP`). Where a knob overlaps the learning whitelist, the
role bounds MUST sit inside the learning bounds (audit checks this). Anything that hits a bound is
printed item by item — silent truncation would mean "this role's multiplier is derived" is no longer
true of it. Two such items on 2026-08-08: siege `PRIO_STRUCT` (0.943 → 1.000 — a role may at most
reduce the structure surcharge to "no surcharge"; it **MUST NOT** become "prefer towers", which
parks the bot under a tower in crossfire) and siege `PULL_HP` (0.279 → 0.300 — below `BASE_HP` it
would head straight home and the RALLY branch would be dead code).

## 3. Policy learning

### 3.1 Learnable set (`data.js BOT_LEARN.KEYS`) and the three exclusions

| Learnable (8 keys) | Meaning |
|---|---|
| `W_THREAT` / `W_OUTPUT` / `W_EXEC` | target weights (hurts me most / enemy damage core / nearly dead) |
| `EXEC_S` | cleanup-kill harvest window, seconds |
| `RALLY_SP` / `RALLY_BACK_M` | shield line to re-engage / rally distance behind the tower |
| `KITE_NEAR` / `KITE_FAR` | kiting rings (close while able to fire / open while reloading) |

Excluded, each for a structural reason (pinned by audit Ⅱ):

1. **User-settled values** — `PULL_SP` (0.5), `BASE_HP` (0.25), `PULL_HP`, `RESUME_HP`, `EXEC_MAX`;
   `audit_bot_tactics` guards them by literal value.
2. **The ledger's clock** `THREAT_S` — decay before accumulation in `sim._hurtLog` goes through the
   same `botThreatDecay`; a per-brain second value means two clocks for one ledger (a variant of
   "a second set of books").
3. **Capability fields** (§1). Separately, the 8 whitelisted keys are consumed **only** by the
   `tactic`/`elite` branches ⇒ novice and low difficulty stay bit-identical **structurally**, not by
   remembering not to touch them.

### 3.2 Seam layout

| Seam | Where | Rule |
|---|---|---|
| Policy file | `public/js/botPolicy.js` | tool output, **never hand-edited**, zero imports; `tactic = {}` = neutral = bit-identical to the hand-written baseline |
| Clamp | `data.js botPolicySanitize()` | **one copy**, shared by the runtime override and the learning tool. Bounds (`BOT_LEARN.KEYS`) mirror `audit_bot_tactics`' guard lines ⇒ even a broken learning round cannot write an illegal value |
| Apply | `data.js` override loop | exactly one `BOT_TACTIC[k] =`; whitelist keys only |
| Read | `bots.js this.tac` | the only knob read seam (`BOT_TACTIC.` has zero occurrences in bots.js). The four `data.js` helpers (`botTargetPrio`/`botThreatDecay`/`botSalvo`/`botKiteF`) take a trailing `T = BOT_TACTIC` — omit it for old behaviour |
| Baseline | `data.js BOT_TACTIC_BASE` | frozen pre-override snapshot (same pattern as `rate0`); neutrality invariants and the final evaluation measure against it |
| Fingerprint | `data.js balanceFingerprint()` | FNV-1a over UNITS/CHARACTERS/WEAPONS/ECON/SQUAD/GAME — policy tracks the fingerprint, not the commit |
| Synthetic battlefield | `test/simrun.mjs buildConfig()` | exported and shared (the learning tool and the audit MUST NOT each copy one); simrun guards its entry point so importing it does not run it |

### 3.3 Method, and why it has this shape

- **Evaluation is real self-play**: candidate vs current policy, real `BattleSim` + real `BotBrain`,
  same difficulty on both sides. A policy's value only exists in an environment where the opponent
  is also playing — `lanesim`/`duel` have no AI decisions at all.
- **CRN + side mirroring**: per seed, `Math.random` is swapped for `mulberry32(seed)` (inside the
  tool process only, restored afterwards), and the same seed is played once with the candidate as
  SWARM and once as STEEL, then averaged. Single-match fortification damage swings 433–10298, and
  n≤3 can "prove" both improvement and regression; without paired variance reduction the signal
  drowns. Same policy + same seed ⇒ fitness is **identically 0** (audit Ⅴ's landing safeguard).
- **Fitness = Δfortification damage + Δkills×0.05 + win/loss ±2** from the candidate's side. Binary
  win/loss saturates over a long match (towers + base run to hundreds of thousands of HP, so most
  matches end undecided); fortification damage is continuous and sensitive to "is the lane moving".
  Default scenario 2v2 × 240s — the same yardstick as the existing AI-regression measurement.
- **(1+λ) ES with mirrored Gaussian perturbation (θ ± σd)**: gradient-free, noise-robust, 8
  dimensions — orders of magnitude fewer samples than RL, and every step is a complete, playable
  policy. Step size shrinks (σ ×0.7) after a round with no improvement.
- **Final gate**: per-round acceptance runs on small training seeds, so the final policy is retested
  against **the policy it would replace** on a fresh set of unused seeds. If it does not win, nothing
  is written (prefer nothing to wrong). `--force` is for debugging only.

### 3.4 Why roles are not learned per role

Search space ×4 and samples ÷4 per role, against a per-match variance of 433–10298 — the signal
would vanish entirely. The five knobs added by the roles round
(`KEEP_F`/`KEEP_STRUCT`/`PRIO_HERO`/`PRIO_STRUCT`/`CAST_HURT`) therefore stay **out** of the
learning whitelist, so `botPolicy.js` and the balance fingerprint are bit-unaffected and existing
policy files keep working. Role resolution also happens in `update()`, not the constructor: the
learning loop injects the baseline policy **after** construction (`b.tac = candTac`), which would
overwrite anything settled in the constructor.

Difficulty layering (A33): role overrides resolve only under `BOT_DIFF.tactic`, so novice/low stay
bit-identical structurally. The difficulty ladder itself is carried by the capability fields and is
unaffected by learning.

## 4. Operating

```bash
# after a balance change, once npm run bal is green:
node tools/bot_learn.mjs --iters 8 --seeds 8 --workers 4   # learn (detects a stale fingerprint, warm-starts)
node tools/bot_learn.mjs --eval                            # current policy vs hand-written baseline
node tools/bot_learn.mjs --reset                           # back to neutral at any time
node tools/audit_bot_policy.mjs                            # 40 checks (--break-clamp / --break-neutral)
node tools/audit_bot_role.mjs                              # 80 checks; last section prints the live roster
node tools/audit_bot_role.mjs --break-role|--break-norm|--break-tier
```

- A stale fingerprint **warns, it does not block** — a stale good policy still beats neutral
  (principle 6). To relearn, just run it.
- `--seeds` is paired seeds per round (×2 sides = matches per candidate). Per-match variance is
  enormous: a real round MUST use ≥8; 2–4 is for demos and smoke runs.
- Tuning a role means editing the **relative** multipliers in `BOT_ROLES[r].mul` — the water level
  returns to baseline on its own.
- Verification matrix: `CLAUDE.md §5`. Core: the two audits above +
  `audit_bot_tactics` / `audit_bot_vision` (must stay green after a read-seam change) + `npm test`
  (bots push down the lane) + `npm run sim` (still resolves, still not stuck). Under a neutral
  policy everything is bit-identical, so `npm run bal` is structurally unaffected. Judge regressions
  by **structural metrics** (skirt% / engage%), never by `npm run sim`'s win flag.

## 5. Landing measurement (2026-08-08 baseline)

Method: roles on vs `_resolveRole` disabled (= pre-change behaviour), CRN paired mirror self-play
(each seed played with roles as SWARM and as STEEL), high difficulty 3v3 × 600s × 28 matches.

| Metric | Roles | Control |
|---|---|---|
| Fitness (Δfortification damage + Δkills) | **+0.35** (SD ≈ 1.55, SE ≈ 0.29) | 0 (by definition) |
| Fortification damage dealt / taken | 3204 / 2604 | — |
| Kills | 2.0 | 1.6 |
| engage% | 21.3% | 20.1% |
| RALLY% | 11.5% | 12.8% |
| RETREAT% | 19.0% | 16.5% |
| skirt% | 1.5% | 2.0% |

**No regression; slightly stronger but inside the noise** (t ≈ 1.2; 28 paired matches still short of
95%). Whether anything broke is read from the structural metrics, not fitness: skirt% 1.5% < 2.0%
(no extra stuck bots), engage% slightly up, RALLY% slightly down (not stuck retreating). RETREAT%
rising 16.5% → 19.0% is **expected** — raider and support both have `PULL_HP` pushed up by design,
and siege disengages relatively later. This round was never meant to make bots stronger; it was
meant to make each mech play to its own numbers, with the overall level anchored by the
normalisation in §2.3. "Roughly the same in aggregate, visibly different per mech" is the intended
shape.
