# Execution and validation gates

## Corpus homes

```text
Formal:     C:\Users\user\Documents\app\steel_vs_swarm\tools\ai3d
Restricted: C:\Users\user\Documents\study\ai3d_restricted\photos
```

The restricted path is a `photos` child. `normalizeCorpusHome()` must resolve its parent `corpus.json`, which declares
`shipping:false`. At the 2026-08-18 handoff its manifest contains 334 rows.

## Dry plan

```powershell
node tools/ai3d/replacement_plan.mjs `
  --home C:\Users\user\Documents\app\steel_vs_swarm\tools\ai3d `
  --home C:\Users\user\Documents\study\ai3d_restricted\photos

node tools/ai3d/harvest_loop.mjs --home <home> --rounds 1 --dry --no-gen --category-jobs 3
```

Expected legacy baseline: 61 total, 11 automatic, 50 manual. Recalculate rather than hard-code these counts in code.

## Restricted run

```powershell
node tools/ai3d/harvest_loop.mjs `
  --home C:\Users\user\Documents\study\ai3d_restricted\photos `
  --venv <SF3D_HOME> --t2 <T2_CHECKOUT> --hunyuan <HUNYUAN_ADAPTER> `
  --rounds 1 --category-jobs 3
```

Require `非出貨語料家`, no external photo fetch, and hard skips for Hunyuan/SF3D/T2 intake. Any restricted photo id
in active provenance is a release blocker.

## Formal smoke and continuous run

```powershell
node tools/ai3d/harvest_loop.mjs `
  --home C:\Users\user\Documents\app\steel_vs_swarm\tools\ai3d `
  --venv <SF3D_HOME> --t2 <T2_CHECKOUT> --hunyuan <HUNYUAN_ADAPTER> `
  --family <building|rock|tree> --gen-limit 1 --t2-limit 1 `
  --rounds 1 --category-jobs 3 --no-intake
```

After all route smokes pass:

```powershell
node tools/ai3d/harvest_loop.mjs `
  --home C:\Users\user\Documents\app\steel_vs_swarm\tools\ai3d `
  --venv <SF3D_HOME> --t2 <T2_CHECKOUT> --hunyuan <HUNYUAN_ADAPTER> `
  --category-jobs 3 --gen-limit 12 --t2-limit 4 --intake-limit 4 `
  --rounds 0 --every 15
```

Review and close each four-item intake batch before allowing the next batch to ship.

## Replacement application

Use `npm run parts` for human review. Apply recorded decisions with:

```powershell
node tools/ai3d/apply_verdicts.mjs `
  --home C:\Users\user\Documents\app\steel_vs_swarm\tools\ai3d
```

For `replace`, verify:

- the new source row had `replaces` before application;
- new and old keys share the same appendable roster slot;
- the new key stays active and loses its pending-auto state;
- the old key is absent from active roster, GLB nodes, and active provenance;
- archive contains the old provenance, source image, reason, and `replaced_by`.

## Per-batch pristine validation

```powershell
node tools/ai3d/audit_auto_intake.mjs
node tools/ai3d/intake_parts.mjs
node tools/parts_review.mjs --report
node tools/audit_siteplan.mjs
node tools/audit_beacons.mjs
node tools/audit_object_joints.mjs --seeds 8
node tools/audit_client_syntax.mjs
npm run bal
```

Require review-board `缺件`, `孤兒節點`, and `未記載來源` to be zero. Before final completion, follow the repository
port-cleanup procedure, start a fresh server on 8620, and run `npm test`.

## Reverse validation after code judgment changes

Run only when the corresponding code judgment was modified; each command must exit non-zero and fail the intended
assertion:

```powershell
node tools/ai3d/audit_auto_intake.mjs --break-parallel
node tools/ai3d/audit_auto_intake.mjs --break-route
node tools/ai3d/audit_auto_intake.mjs --break-corpus-path
node tools/ai3d/audit_auto_intake.mjs --break-replace
node tools/ai3d/audit_auto_intake.mjs --break-archive
node tools/ai3d/audit_auto_intake.mjs --break-redo
```

An asset-only batch does not need a new break injection, but the pristine audit remains mandatory.

## Completion accounting

Report exact keys in four groups: replaced and archived; generated but awaiting human review; blocked by runner/input;
manual Route A/fixed-slot recipes remaining. Never report the 61-item objective as complete while any key lacks an
explicit outcome.

