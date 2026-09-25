# Codebase Comment i18n Handover Spec (Next Session Direct Run)

> Context: Transferred from OpenCode session `ses_f28422112ffeCEWhCmbyjOnLUI` (interrupted by API 429 rate limit).
> Aligned with `AGENTS.md` §1 Documentation Discipline: English code comments, Traditional Chinese in-game strings/dialogue only.

---

## 1. Current State & Completed Items

1. **Committed Pilot Batch (`8ce6a3c9`)** — 12 files:
   - `public/js/rng.js`, `public/js/backgroundObjects.js`, `public/js/buildingFunctions.js`
   - `public/js/castparticles.js`, `public/js/sceneObjects.js`, `public/js/venueGrid.js`
   - `public/js/venueText.js`, `public/js/heritageSites.js`, `public/js/runtimeParts.js`
   - `public/js/towerBuildings.js`, `public/js/regionalArchitecture.js`, `public/js/partTransform.js`

2. **Completed in This Handover Commit** — 4 files:
   - `public/js/botPolicy.js` (from Batch A)
   - `public/js/forge/mechs/s02.js` (from Batch B)
   - `public/js/forge/mechs/s05.js` (from Batch B)
   - `public/js/forge/mechs/s11.js` (from Batch B)

---

## 2. Pending Batches & Files (Direct Execution List)

### Batch A: Core & Helper Modules (22 files remaining)
```
public/js/tip.js
public/js/help.js
public/js/npcicon.js
public/js/pedestrian.js
public/js/field.js
public/js/osmBuilding.js
public/js/dialogue.js
public/js/geo3d.js
public/js/net.js
public/js/balancePrefs.js
public/js/storyui.js
public/js/geocache.js
public/js/showcase.js
public/js/cutin.js
public/js/story.js
public/js/wallDecorations.js
public/js/localhost.js
public/js/netmode.js
public/js/portraits.js
public/js/vehicleCatalog.js
public/js/osmQuery.js
public/js/venueLanes.js
```

### Batch B: Forge Mech & Geometry Modules (12 files remaining)
```
public/js/forge/mechs/m01_flight.js
public/js/forge/mechs/m05_flight.js
public/js/forge/mechs/m06.js
public/js/forge/mechs/s03_flight.js
public/js/forge/mechs/s04.js
public/js/forge/mechs/s10_flight.js
public/js/forge/mechs/s08.js
public/js/forge/mechs/m07_flight.js
public/js/forge/mechs/_morph.js
public/js/forge/mechs/index.js
public/js/forge/geo.js
public/js/forge/roster.js
```

### Batch C: Audit Tools & Specs (12 files)
```
tools/audit_shop_auto.mjs
tools/audit_damp_fps.mjs
tools/audit_aoe_trim.mjs
tools/audit_tree_joints.mjs
tools/audit_muzzle.mjs
tools/audit_client_syntax.mjs
tools/audit_lane_navigation.mjs
tools/audit_audio_layers.mjs
tools/audit_world_text.mjs
tools/bake_venue_grid.mjs
tools/audit_leaf_card.mjs
tools/audit_view_lock.mjs
```

---

## 3. Strict Execution Invariants

1. **Target Comments Only**:
   - Translate ONLY `//` and `/* ... */` comment blocks.
   - NEVER modify logic, AST nodes, identifiers, or string literals.
   - Traditional Chinese in-game content (e.g. `label: '...'`, part descriptions, dialogue/lore texts) MUST NOT be translated.
2. **Comment Style**:
   - "Why, Not What": keep non-obvious constraints, failure modes, invariants, authority seams.
   - Drop self-evident prose that restates the code.
   - Strip dated history notes (e.g. `2026-08-03 ...`) while preserving live invariant rules without dates.
   - **Audit tool headers (Batch C)**: Tier-4 specifications (formulas, assertion contracts) MUST be translated with full fidelity, not thinned out.
3. **Typography & Encoding**:
   - Pure ASCII characters for punctuation: `--` for em-dash, `->` for arrows, `+-` for ±, `x` for ×.
   - No markdown backticks inside GLSL-adjacent template string comments.
4. **Line Endings**:
   - All files MUST preserve CRLF line endings. Verify before and after edits.

---

## 4. Verification & Commit Protocol

Run after each batch:
```bash
# 1. Syntax check on each edited file
node --check <file>

# 2. Client syntax suite validation (must pass all 336 files)
node tools/audit_client_syntax.mjs

# 3. For tools/ edits: verify node can execute each tool
node --check tools/<tool>.mjs
```

Recommended commit structure:
- `docs(i18n): convert Batch A client comments to English Why-only`
- `docs(i18n): convert Batch B forge comments to English Why-only`
- `docs(i18n): convert Batch C audit spec comments to English Why-only`

---

## 5. Next Session Copy-Paste Instruction

```markdown
Please continue and execute the comment i18n task defined in `docs/comment-translation-handover.md`.
Execute Batch A (22 files), Batch B (12 files), and Batch C (12 files) following the strict invariants (Why-only English comments, CRLF preservation, zero changes to code/in-game Chinese strings).
Verify with `node --check` and `node tools/audit_client_syntax.mjs`, then commit per batch.
```
